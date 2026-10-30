// 설정 files 꼬리: 주인(러너·기동기)이 바뀌면 옛 주인 아래 끝나지 않은 작업을 닫는다 — 교체된 기동기가 퇴장할 수 있게
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { compileJobRules, JobBook } from '../jobs.mjs';
import { RootRuntime } from '../session.mjs';
import { exitEligible } from '../../web/flow-core.mjs';

const RULES = compileJobRules({ sets: [{ name: 'loop', files: [{ path: 'runner.out', owner: 'runner' }], rules: [
  { on: 'end', re: '^종료', job: 'loop' },
  { on: 'phase', re: '^사이클 (?<phase>[0-9]+)', job: 'loop', title: '자율 루프' },
] }] });

test('JobBook.closeStream: 그 스트림이 세운 끝나지 않은 작업만 done(정체 없이) · 내부 필드는 밖으로 안 나감', () => {
  const b = new JobBook({ rules: RULES });
  const t0 = '2026-10-29T12:00:00.000Z';
  b.feed('file:runner.out', 'r1', '사이클 1\n', t0, { file: true });
  b.feed('file:other.out', 'r1', '::agent4d {"id":"x","state":"running"}\n', t0, { file: true });
  const ups = b.closeStream('r1', 'file:runner.out', '2026-10-29T12:05:00.000Z', '주인 바뀜');
  assert.equal(ups.length, 1);
  assert.equal(ups[0].jobId, 'loop');
  assert.equal(ups[0].job.state, 'done');
  assert.equal(ups[0].job.endedAt, '2026-10-29T12:05:00.000Z');
  assert.equal(ups[0].job.stale, false);
  assert.equal(ups[0].job._stream, undefined);
  assert.equal(b.jobs.get('r1').get('x').state, 'running', '다른 스트림 작업은 그대로');
  assert.deepEqual(b.closeStream('r1', 'file:runner.out', '2026-10-29T12:06:00.000Z'), [], '이미 끝난 것은 다시 안 냄');
  // 끝 시각은 마지막 박동보다 앞서지 않는다
  b.feed('file:runner.out', 'r2', '사이클 2\n', '2026-10-29T13:00:00.000Z', { file: true });
  assert.equal(b.closeStream('r2', 'file:runner.out', '2026-10-29T12:59:00.000Z')[0].job.endedAt, '2026-10-29T13:00:00.000Z');
});

test('러너 교체 · 기동기 교체(superseded): 옛 주인 아래 파일 작업이 닫혀 끝난 기동기 하위 전체가 퇴장 대상', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-jobfiles-'));
  const SID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
  const index = { findSession: () => null, procs: new Map() };
  const rt = new RootRuntime({ sessionId: SID, index, jobRules: RULES, extJobs: null });
  try {
    const g = rt.graph;
    const T = (m) => new Date(Date.parse('2026-10-29T12:00:00.000Z') + m * 60_000).toISOString();
    const add = (n) => g.addNode({ sessionId: SID, label: n.id, status: 'active', lastActivityAt: n.startedAt, meta: {}, ...n }, n.startedAt);
    add({ id: `s:${SID}`, parentId: null, kind: 'main', startedAt: T(0), meta: { cwd: dir } });
    add({ id: 'b:L1', parentId: null, kind: 'bash-bg', startedAt: T(1), meta: { launcher: {} } });
    add({ id: 'b:L1-r1', parentId: 'b:L1', kind: 'bash-bg', startedAt: T(2), meta: { runner: {} } });
    rt._jobFiles();
    rt.jobFeed('file:runner.out', '사이클 1\n', T(3), { ownerId: 'b:L1-r1', file: true });
    assert.equal(g.get('j:b:L1-r1:loop').status, 'active');
    // 다음 러너: 옛 러너 끝 → 옛 러너 아래 loop 닫힘
    rt.finish('b:L1-r1', true, T(10), { meta: { endReason: 'next-runner' } });
    add({ id: 'b:L1-r2', parentId: 'b:L1', kind: 'bash-bg', startedAt: T(10), meta: { runner: {} } });
    rt._jobFiles();
    const j1 = g.get('j:b:L1-r1:loop');
    assert.equal(j1.status, 'done'); assert.equal(j1.endedAt, T(10)); assert.equal(j1.meta.job.state, 'done');
    rt.jobFeed('file:runner.out', '사이클 2\n', T(11), { ownerId: 'b:L1-r2', file: true });
    assert.equal(g.get('j:b:L1-r2:loop').status, 'active');
    // 기동기 교체(STOP 걷고 다시 띄움): 옛 기동기·러너 끝, 새 기동기만 있음(러너 전 — 주인은 새 기동기)
    rt.finish('b:L1-r2', true, T(20), { meta: { endReason: 'launcher-ended' } });
    rt.finish('b:L1', true, T(20), { meta: { endReason: 'superseded' } });
    add({ id: 'b:L2', parentId: null, kind: 'bash-bg', startedAt: T(21), meta: { launcher: {} } });
    rt._jobFiles();
    assert.equal(g.get('j:b:L1-r2:loop').status, 'done');
    rt.jobFeed('file:runner.out', '사이클 1\n', T(22), { ownerId: 'b:L2', file: true });
    // 새 기동기의 첫 러너가 뜨면 기동기 아래 loop 도 닫힌다(러너 아래로 이어 섬)
    add({ id: 'b:L2-r1', parentId: 'b:L2', kind: 'bash-bg', startedAt: T(23), meta: { runner: {} } });
    rt._jobFiles();
    assert.equal(g.get('j:b:L2:loop').status, 'done');
    assert.equal(g.get('j:b:L2:loop').endedAt, T(23));
    // '완료 표시' 끔 퇴장 판정(웹 공통 코어): 옛 기동기 하위 전체가 대상, 새 기동기는 남음
    const el = exitEligible(new Map([...g.nodes.values()].map((n) => [n.id, n])), [`s:${SID}`], { nowMs: Date.parse(T(30)) });
    for (const id of ['b:L1', 'b:L1-r1', 'b:L1-r2', 'j:b:L1-r1:loop', 'j:b:L1-r2:loop', 'j:b:L2:loop']) assert.ok(el.has(id), id);
    assert.ok(!el.has('b:L2') && !el.has('b:L2-r1'));
  } finally {
    rt.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
