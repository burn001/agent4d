// bg 끝 판정 누락 수리
// (1) 진짜 끝(알림·TaskStop) 뒤에 늦게 읽힌 출력(끝 표지 [exited …]·[killed]·종료 직전 출력)이 노드를 되살려 영구 idle 로 남던 것
// (2) 서브에이전트가 띄운 bg — 끝 알림은 그 에이전트에게만 가므로 에이전트가 끝나면 신호가 오지 않는다 → '에이전트 종료로 끊김'
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { buildReplay } from '../replay.mjs';
import { encodeCwd } from '../parse.mjs';

const M = '5e5e00a0-0000-4000-8000-0000000000a0';
const cwd = 'D:\\work\\bgend';
const NEW_MSG = 'If it exits while you are still working you will be notified, but it is terminated when you give your final response and no notification can follow that — so do not end your turn to wait for it.';
const OLD_MSG = 'You will be notified when it completes. To check interim output, use Read on that file path.';
const line = (r) => JSON.stringify(r) + '\n';
let root, dir, outDir, t0, index, mainFile;
const T = (s) => new Date(t0 + s * 1000).toISOString();
const base = { sessionId: M, cwd, version: '2.1.310', entrypoint: 'cli' };
const sx = (aid) => ({ isSidechain: true, agentId: aid });
const U = (s, text, x = {}) => ({ type: 'user', timestamp: T(s), ...base, ...x, message: { role: 'user', content: text } });
const A = (s, block, x = {}) => ({ type: 'assistant', timestamp: T(s), ...base, ...x, message: { role: 'assistant', model: 'm', content: [block] } });
const R = (s, id, text, tur, x = {}) => ({ type: 'user', timestamp: T(s), ...base, ...x, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, toolUseResult: tur });
const BG = (s, tuid, taskId, msg, x = {}) => [
  A(s, { type: 'tool_use', id: tuid, name: 'Bash', input: { command: `grep -rn x . | head`, description: taskId, run_in_background: true } }, x),
  R(s + 1, tuid, `Command running in background with ID: ${taskId}. Output is being written to: ${path.join(outDir, taskId + '.output')}. ${msg}`, { stdout: '', stderr: '', backgroundTaskId: taskId }, x),
];
const NOTIF = (taskId, status, summary) => `<task-notification>\n<task-id>${taskId}</task-id>\n<output-file>${path.join(outDir, taskId + '.output')}</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`;
const out = (taskId, text, mtimeMs) => {
  const f = path.join(outDir, taskId + '.output');
  fs.writeFileSync(f, text);
  const d = new Date(mtimeMs); fs.utimesSync(f, d, d);
};
const sub = (aid, desc, tuid) => {
  const sd = path.join(dir, M, 'subagents');
  fs.mkdirSync(sd, { recursive: true });
  fs.writeFileSync(path.join(sd, `agent-${aid}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: desc, toolUseId: tuid, spawnDepth: 1 }));
  return path.join(sd, `agent-${aid}.jsonl`);
};

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-bgend-'));
  const projects = path.join(root, 'projects');
  const sessions = path.join(root, 'sessions');
  dir = path.join(projects, encodeCwd(cwd));
  outDir = path.join(root, 'tasks');
  for (const d of [sessions, dir, outDir]) fs.mkdirSync(d, { recursive: true });
  t0 = Date.now() - 3600_000; // 1시간 전
  // 메인: (1) 되살아남 시나리오 bg 셋 + (2) 서브에이전트 넷
  mainFile = path.join(dir, `${M}.jsonl`);
  const agent = (s, tuid, desc) => A(s, { type: 'tool_use', id: tuid, name: 'Agent', input: { description: desc, prompt: desc } });
  const agentDone = (s, tuid, aid) => R(s, tuid, '끝', { status: 'completed', agentId: aid, content: [{ type: 'text', text: '끝' }] });
  fs.writeFileSync(mainFile, [
    U(0, '시험'),
    ...BG(5, 'tu_ex', 'b_ex', OLD_MSG), ...BG(6, 'tu_ts', 'b_ts', OLD_MSG), ...BG(7, 'tu_kl', 'b_kl', OLD_MSG),
    agent(8, 'tu_a1', '새 판'), agent(8, 'tu_a2', '옛 판'), agent(8, 'tu_a3', '아직 씀'),
    A(8, { type: 'tool_use', id: 'tu_a4', name: 'Agent', input: { description: '되살아남', prompt: 'x', run_in_background: true } }),
    R(9, 'tu_a4', 'Async agent launched successfully.', { isAsync: true, status: 'async_launched', agentId: 'sa4', description: '되살아남' }),
    agentDone(60, 'tu_a1', 'sa1'), agentDone(60, 'tu_a2', 'sa2'), agentDone(60, 'tu_a3', 'sa3'),
    U(60, NOTIF('sa4', 'completed', 'Agent "되살아남" completed')),
  ].map(line).join(''));
  out('b_ex', 'work\n', t0 + 20_000);
  out('b_ts', '', t0 + 6_000);
  out('b_kl', '1..100\n', t0 + 30_000);
  // 서브에이전트 sa1: 새 판 안내(최종 응답 때 끔) — 출력은 끝(60초) 전 12초에 멎음
  fs.writeFileSync(sub('sa1', '새 판', 'tu_a1'), [U(9, '돌려라', sx('sa1')), ...BG(10, 'tu_n1', 'b_n1', NEW_MSG, sx('sa1')), A(59, { type: 'text', text: '끝' }, sx('sa1'))].map(line).join(''));
  out('b_n1', '', t0 + 12_000);
  // sa2: 옛 판 안내 — 셸이 멎은 채 남음(실측: 출력 끝 뒤 몇 시간째 bash 가 살아 있고 CPU 0). 출력은 15초에 멎음
  fs.writeFileSync(sub('sa2', '옛 판', 'tu_a2'), [U(9, '돌려라', sx('sa2')), ...BG(10, 'tu_o2', 'b_o2', OLD_MSG, sx('sa2')), A(59, { type: 'text', text: '끝' }, sx('sa2'))].map(line).join(''));
  out('b_o2', 'a.txt\nb.txt\n', t0 + 15_000);
  // sa3: 옛 판 — 에이전트는 끝났지만 출력이 20초 전에도 바뀜(아직 일함) → 닫지 않는다
  fs.writeFileSync(sub('sa3', '아직 씀', 'tu_a3'), [U(9, '돌려라', sx('sa3')), ...BG(10, 'tu_o3', 'b_o3', OLD_MSG, sx('sa3')), A(59, { type: 'text', text: '끝' }, sx('sa3'))].map(line).join(''));
  out('b_o3', 'epoch 1\nepoch 2\n', Date.now() - 20_000);
  // sa4: 비동기 — 60초에 끝 알림, 100초에 SendMessage 로 되살아나 아직 일함(그 뒤 끝 알림 없음) → 닫지 않는다
  fs.writeFileSync(sub('sa4', '되살아남', 'tu_a4'), [U(9, '돌려라', sx('sa4')), ...BG(10, 'tu_o4', 'b_o4', OLD_MSG, sx('sa4')), A(59, { type: 'text', text: '끝' }, sx('sa4')),
    U(100, '추가 지시', sx('sa4')), A(101, { type: 'tool_use', id: 'tu_w4', name: 'Bash', input: { command: 'sleep 900', description: '기다림', timeout: 900000 } }, sx('sa4'))].map(line).join(''));
  out('b_o4', 'x\n', t0 + 15_000);
  // 세션 프로세스는 살아 있음(세션 종료 끊김이 끼어들지 않게)
  fs.writeFileSync(path.join(sessions, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: M, cwd, kind: 'interactive', entrypoint: 'cli', status: 'busy' }));
  index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
  await index.refresh();
});
after(() => { fs.rmSync(root, { recursive: true, force: true }); });

const ended = (n) => ['done', 'error', 'stopped'].includes(n.status);
const agentEndOk = (n, endIso, msg) => {
  assert.equal(n.status, 'stopped', msg);
  assert.equal(n.meta.stopReason, 'agent-end', msg);
  assert.equal(n.endedAt, endIso, msg);
  assert.equal(n.meta.run.ended, Date.parse(endIso), msg);
  assert.equal(n.meta.rc, undefined, '종료 코드 미상');
};

test('주인 에이전트가 끝난 bg → 에이전트 종료로 끊김(새 판 안내·옛 판 정체) · 아직 쓰는 출력·되살아난 에이전트는 그대로 — 라이브·재생 같음', async () => {
  const check = (get, how) => {
    agentEndOk(get('b:b_n1'), T(60), `${how} 새 판: 끝 = 에이전트 끝`);
    agentEndOk(get('b:b_o2'), T(60), `${how} 옛 판: 출력이 정체 문턱 넘게 멎음`);
    assert.ok(!ended(get('b:b_o3')), `${how} 출력이 아직 바뀌는 bg 는 닫지 않음 (${get('b:b_o3').status})`);
    assert.ok(!ended(get('b:b_o4')), `${how} 끝난 뒤 다시 일하는 에이전트의 bg 는 닫지 않음 (${get('b:b_o4').status})`);
  };
  const rt = new RootRuntime({ sessionId: M, index, jobRules: null });
  await rt.start();
  try {
    rt.sweep();
    check((id) => rt.graph.get(id), '라이브');
  } finally { rt.close(); }
  const data = await buildReplay({ sessionId: M, index, jobRules: null });
  check((id) => data.finalState.nodes.get(id), '재생');
  assert.equal(data.stats.finalMismatch, 0);
});

test('라이브: 진짜 끝(알림 completed·TaskStop·알림 killed) 뒤 늦게 읽힌 끝 표지·출력은 노드를 되살리지 않는다', async () => {
  const rt = new RootRuntime({ sessionId: M, index, jobRules: null });
  await rt.start();
  try {
    const g = rt.graph;
    for (const id of ['b:b_ex', 'b:b_ts', 'b:b_kl']) assert.ok(!ended(g.get(id)), `${id} 처음엔 안 끝남`);
    // 끝 신호가 먼저 읽힘(실측: queue-operation enqueue 와 출력 끝 표지가 같은 초에 생김 — 어느 쪽이 먼저 읽힐지 모름)
    const now = new Date(Date.now() - 2000).toISOString();
    const add = (r) => fs.appendFileSync(mainFile, line({ ...r, timestamp: now }));
    add({ type: 'queue-operation', operation: 'enqueue', sessionId: M, content: NOTIF('b_ex', 'completed', 'Background command "b_ex" completed (exit code 0)') });
    add(A(0, { type: 'tool_use', id: 'tu_stop', name: 'TaskStop', input: { task_id: 'b_ts' } }));
    add(U(0, NOTIF('b_kl', 'killed', 'Background command "b_kl" was stopped')));
    await rt.pollAll({ all: true });
    assert.equal(g.get('b:b_ex').status, 'done');
    assert.equal(g.get('b:b_ts').meta.stopReason, 'taskstop');
    assert.equal(g.get('b:b_kl').meta.stopReason, 'killed');
    const before = Object.fromEntries(['b:b_ex', 'b:b_ts', 'b:b_kl'].map((id) => [id, g.get(id).endedAt]));
    // 그 뒤 출력 파일에 표지·종료 직전 출력이 붙는다
    fs.appendFileSync(path.join(outDir, 'b_ex.output'), '\n[exited with code 0]\n');
    fs.appendFileSync(path.join(outDir, 'b_ts.output'), '\n[killed]\n');
    fs.appendFileSync(path.join(outDir, 'b_kl.output'), '100/100\n2 failed, 98 passed in 20.0s\n');
    await rt.pollAll({ all: true });
    await new Promise((r) => setTimeout(r, 350)); // 출력 묶음 타이머(250ms)
    rt.sweep();
    for (const [id, st] of [['b:b_ex', 'done'], ['b:b_ts', 'stopped'], ['b:b_kl', 'stopped']]) {
      const n = g.get(id);
      assert.equal(n.status, st, `${id} 되살아나지 않음`);
      assert.equal(n.endedAt, before[id], `${id} 끝 시각 그대로`);
      assert.ok(n.meta.run.ended, `${id} meta.run.ended 유지`);
    }
    assert.equal(g.get('b:b_ex').meta.rc, 0);
    assert.ok(g.ring.some((e) => e.type === 'output' && e.nodeId === 'b:b_kl' && /98 passed/.test(e.text)), '늦은 출력은 출력 이벤트로는 보인다');
  } finally { rt.close(); }
});
