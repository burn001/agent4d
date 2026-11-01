// 워크플로 에이전트 끝 판정 수리
// (1) 라이브: 저널 result 와 에이전트의 마지막 기록이 같은 poll 에 읽히면 저널(먼저 붙은 꼬리)이 먼저 처리돼 끝 시각이 묵은
//     lastActivityAt 이 되고, 바로 뒤 읽힌 마지막 기록(그보다 늦은 시각)이 노드를 되살려 60초 뒤 idle 로 영구 잔류하던 것
// (2) 라이브 첫 적재: 저널이 에이전트 기록보다 먼저 읽혀 endedAt 이 EPOCH(1970)가 되던 것
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { buildReplay } from '../replay.mjs';
import { encodeCwd } from '../parse.mjs';

const M = '5e5e00a0-0000-4000-8000-0000000000b1';
const cwd = 'D:\work\wfend';
const RUN = 'wf_end-001';
const line = (r) => JSON.stringify(r) + '\n';
let root, dir, wdir, journal, index, t0;
const T = (s) => new Date(t0 + s * 1000).toISOString();
const base = { sessionId: M, cwd, version: '2.1.310', entrypoint: 'cli' };
const sx = (aid) => ({ isSidechain: true, agentId: aid });
const U = (s, text, x = {}) => ({ type: 'user', timestamp: T(s), ...base, ...x, message: { role: 'user', content: text } });
const A = (s, text, x = {}) => ({ type: 'assistant', timestamp: T(s), ...base, ...x, message: { role: 'assistant', model: 'm', content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
const agentFile = (aid) => path.join(wdir, `agent-${aid}.jsonl`);
const meta = (aid, label) => fs.writeFileSync(path.join(wdir, `agent-${aid}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: label, workflowPhase: 'Implement', spawnDepth: 1 }));
const started = (aid, label) => ({ type: 'started', key: `v2:${aid}`, agentId: aid, label, phase: 'Implement' });
const result = (aid, r = '끝') => ({ type: 'result', key: `v2:${aid}`, agentId: aid, result: r });

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-wfend-'));
  const projects = path.join(root, 'projects');
  const sessions = path.join(root, 'sessions');
  dir = path.join(projects, encodeCwd(cwd));
  wdir = path.join(dir, M, 'subagents', 'workflows', RUN);
  for (const d of [sessions, wdir]) fs.mkdirSync(d, { recursive: true });
  t0 = Date.now() - 600_000; // 10분 전
  fs.writeFileSync(path.join(dir, `${M}.jsonl`), [U(0, '워크플로 돌려')].map(line).join(''));
  // 이미 끝난 에이전트(첫 적재 대상) wa1 + 아직 일하는 에이전트 wb1·wc1(시험 중 끝냄)
  meta('wa1', 'impl:A'); meta('wb1', 'impl:B'); meta('wc1', 'impl:C');
  fs.writeFileSync(agentFile('wa1'), [U(1, '해라', sx('wa1')), A(30, '다 했습니다', sx('wa1'))].map(line).join(''));
  fs.writeFileSync(agentFile('wb1'), [U(1, '해라', sx('wb1'))].map(line).join(''));
  fs.writeFileSync(agentFile('wc1'), [U(1, '해라', sx('wc1'))].map(line).join(''));
  journal = path.join(wdir, 'journal.jsonl');
  fs.writeFileSync(journal, [{ type: 'launched' }, started('wa1', 'impl:A'), started('wb1', 'impl:B'), started('wc1', 'impl:C'), result('wa1')].map(line).join(''));
  fs.writeFileSync(path.join(sessions, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: M, cwd, kind: 'interactive', entrypoint: 'cli', status: 'busy' }));
  index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
  await index.refresh();
});
after(() => { fs.rmSync(root, { recursive: true, force: true }); });

test('워크플로 에이전트: 첫 적재 끝 시각은 마지막 기록(EPOCH 아님) · 저널 result 와 마지막 기록이 같은 poll 이어도 되살아나지 않음 · 재개 저널이면 다시 산다', async () => {
  const rt = new RootRuntime({ sessionId: M, index, jobRules: null, extJobs: null });
  await rt.start();
  try {
    const g = rt.graph;
    const a = g.get('a:wa1');
    assert.equal(a.kind, 'workflow-agent');
    assert.equal(a.status, 'done');
    assert.equal(a.endedAt, T(30), '첫 적재: 끝 시각 = 마지막 기록 (1970 아님)');
    assert.ok(!['done', 'error'].includes(g.get('a:wb1').status), '저널 result 전은 안 끝남');
    // 실측 경합: 에이전트가 마지막 응답을 쓰고 몇 ms 뒤 워크플로가 저널 result 를 쓴다 → 한 poll 에 둘 다 읽히면 저널(먼저 붙은 꼬리)부터
    const s1 = Math.round((Date.now() - t0) / 1000) - 90; // 90초 전 기록 — 되살아나면 sweep 이 곧바로 idle 로 떨어뜨린다(예전 증상)
    fs.appendFileSync(agentFile('wb1'), line(A(s1, '구현 끝', sx('wb1'))));
    fs.appendFileSync(journal, line(result('wb1', { summary: 'B 끝' })));
    await rt.pollAll({ all: true });
    const b = g.get('a:wb1');
    assert.equal(b.status, 'done', `뒤늦게 읽힌 자기 기록이 되살리지 않음 (${b.status})`);
    assert.equal(b.endedAt, T(s1), '끝 시각은 마지막 기록까지 늘어남');
    assert.ok(g.ring.some((e) => e.type === 'result' && e.nodeId === 'a:wb1' && e.text === 'B 끝'));
    rt.sweep(); // 유휴 문턱(60초)이 지난 기록이어도 끝난 채

    assert.equal(g.get('a:wb1').status, 'done');
    // 아직 일하는 에이전트는 result 전까지 그대로 살아 있다
    fs.appendFileSync(agentFile('wc1'), line(A(s1 + 88, '중간 보고', sx('wc1'))));
    await rt.pollAll({ all: true });
    assert.equal(g.get('a:wc1').status, 'active', '저널 result 없는 에이전트는 끝내지 않음');
    // 재개: 같은 에이전트를 다시 띄운 저널(started) 뒤의 기록은 다시 살린다
    fs.appendFileSync(journal, line(started('wb1', 'impl:B')));
    await rt.pollAll({ all: true });
    fs.appendFileSync(agentFile('wb1'), line(U(s1 + 1, '다시', sx('wb1'))));
    await rt.pollAll({ all: true });
    assert.equal(g.get('a:wb1').status, 'active', '재개된 에이전트는 되살아남');
  } finally { rt.close(); }
  // 재생도 같은 끝(첫 적재 판정)
  const data = await buildReplay({ sessionId: M, index, jobRules: null });
  const ra = data.finalState.nodes.get('a:wa1');
  assert.equal(ra.status, 'done');
});
