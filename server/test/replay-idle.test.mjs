// 재생 대기 합성 보강(4차): 끝 구간에 닫히지 않은 도구가 남은(중단된) 세션도 마지막 기록 + 60초에 대기로 바뀌어 라이브와 같다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { buildReplay, ReplayCache, pageOf } from '../replay.mjs';

const M = 'eeeeeeee-1111-4111-8111-111111111111';
let root, index;
before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-ridle-'));
  const cwd = 'D:\\work\\idle';
  const dir = path.join(root, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  const t0 = Date.now() - 20 * 60_000; // 20분 전 시작, 마지막 기록은 그 3초 뒤(닫히지 않은 Bash)
  const T = (s) => new Date(t0 + s * 1000).toISOString();
  const base = { sessionId: M, cwd, version: '2.1.309', entrypoint: 'cli' };
  const recs = [
    { type: 'user', timestamp: T(0), ...base, message: { role: 'user', content: '오래 걸리는 작업' } },
    { type: 'assistant', timestamp: T(2), ...base, message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'toolu_long', name: 'Bash', input: { command: 'sleep 9999' } }] } },
    { type: 'assistant', timestamp: T(3), ...base, message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: 'a' } }] } },
  ];
  fs.writeFileSync(path.join(dir, `${M}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const old = new Date(t0 + 3000);
  fs.utimesSync(path.join(dir, `${M}.jsonl`), old, old);
  index = new SessionIndex({ projectsDir: path.join(root, 'projects'), sessionsDir: path.join(root, 'sessions') });
  await index.refresh();
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('끝 구간: 닫히지 않은 도구가 있어도 프로세스가 busy 가 아니면 마지막 기록 + 60초에 대기(라이브 sweep 과 같음)', async () => {
  const data = await buildReplay({ sessionId: M, index });
  const main = `s:${M}`;
  assert.equal(data.finalState.nodes.get(main).status, 'idle', '재생 끝 상태 대기');
  const idle = data.events.filter((e) => e.nodeId === main && e.type === 'node-update' && e.patch?.status === 'idle');
  assert.equal(idle.length, 1);
  // 열린 포그라운드 셸(sleep 9999, timeout 없음)은 그 상한(tool_use + 10분 + 1분)까지 대기 금지 → max(마지막 기록 + 60초, 상한)
  const shellStart = Date.parse(data.events.find((e) => e.type === 'tool-start' && e.toolUseId === 'toolu_long').ts);
  const lastRec = Date.parse(data.events.filter((e) => e.nodeId === main && !e.synth).at(-1).ts);
  assert.equal(idle[0].t, Math.max(lastRec + 60_000, shellStart + 660_000), '열린 셸 상한 뒤 대기');
  assert.ok(data.finalState.nodes.get(main).openTools.length >= 1, '열린 도구는 그대로(라이브와 같음)');
  const live = new RootRuntime({ sessionId: M, index });
  await live.start();
  try {
    live.sweep();
    assert.equal(live.graph.get(main).status, 'idle', '라이브도 대기');
  } finally { live.close(); }
});

test('캐시: 빌드가 오래 걸린 세션은 빌드 시간 30배 안에서는 다시 만들지 않는다, 페이지마다 builtAt', async () => {
  const cache = new ReplayCache({ index, reuseMs: 0 });
  const a = await cache.get(M);
  assert.equal(pageOf(a, { from: 1, limit: 2 }).builtAt, a.builtAt);
  a.fingerprint = 'changed'; a.buildMs = 10_000; a.builtAt = new Date(Date.now() - 60_000).toISOString(); // 60초 전, 빌드 10초 → 300초 재사용
  const b = await cache.get(M);
  assert.equal(b, a);
  assert.equal(cache.jobs.size, 0, '다시 만들지 않음');
  a.builtAt = new Date(Date.now() - 400_000).toISOString(); // 300초 넘음 → 뒤에서 다시
  const c = await cache.get(M);
  assert.equal(c, a); assert.equal(c.stale, true);
  assert.equal(cache.jobs.size, 1);
  await cache.jobs.get(M).promise;
});
