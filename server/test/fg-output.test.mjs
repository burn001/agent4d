// 포그라운드 셸 실시간 출력: transcript 에 id 가 없는 tasks/<무작위 id>.output 을 결과 전인 포그라운드 Bash 에 잇는다.
// 가짜 임시 폴더(CCVIZ_CLAUDE_TMP)에 출력 파일을 만들고·덧붙이고·지우며 라이브 런타임이 따라오는지 본다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { encodeCwd } from '../parse.mjs';

const M = 'ffffffff-6666-4666-8666-666666666666';
const cwd = 'D:\\work\\fgdemo';
let root, index, rt, mainFile, tasks;
const base = { sessionId: M, cwd, version: '2.1.309', entrypoint: 'cli' };
const T = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const line = (r) => JSON.stringify(r) + '\n';
const A = (msAgo, block, extra = {}) => ({ type: 'assistant', timestamp: T(msAgo), ...base, ...extra, message: { role: 'assistant', model: 'm', content: [block] } });
const R = (msAgo, id, text, tur, extra = {}) => ({ type: 'user', timestamp: T(msAgo), ...base, ...extra, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, toolUseResult: tur });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-fg-'));
  const projects = path.join(root, 'projects');
  const tmpClaude = path.join(root, 'tmp', 'claude');
  process.env.CCVIZ_CLAUDE_TMP = tmpClaude;
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  const dir = path.join(projects, encodeCwd(cwd));
  fs.mkdirSync(dir, { recursive: true });
  mainFile = path.join(dir, `${M}.jsonl`);
  // 메인: 결과 전인 포그라운드 Bash(tu_fg1, 5초 전) + 동기 Agent(서브에이전트 sub1)
  fs.writeFileSync(mainFile, [
    { type: 'user', timestamp: T(20_000), ...base, message: { role: 'user', content: '오래 걸리는 명령 돌려 주세요' } },
    A(6000, { type: 'tool_use', id: 'tu_agent', name: 'Agent', input: { description: '하위 작업', prompt: '돌려라' } }),
    A(5000, { type: 'tool_use', id: 'tu_fg1', name: 'Bash', input: { command: 'node long.mjs', description: '긴 명령' } }),
  ].map(line).join(''));
  // 서브에이전트: 결과 전인 포그라운드 Bash(tu_fg2, 3초 전) — 출력은 부모 세션 폴더 tasks/ 에 생긴다
  const sub = path.join(dir, M, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-sub1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: '하위 작업', toolUseId: 'tu_agent', spawnDepth: 1, requestShape: 'foreground' }));
  const sx = { isSidechain: true, agentId: 'sub1' };
  fs.writeFileSync(path.join(sub, 'agent-sub1.jsonl'), [
    { type: 'user', timestamp: T(5900), ...base, ...sx, message: { role: 'user', content: '돌려라' } },
    A(3000, { type: 'tool_use', id: 'tu_fg2', name: 'Bash', input: { command: 'npm test', description: '시험' } }, sx),
  ].map(line).join(''));
  tasks = path.join(tmpClaude, encodeCwd(cwd), M, 'tasks'); // 아직 없음 — 생기면 잡아야 한다
  index = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'sessions') });
  await index.refresh();
  rt = new RootRuntime({ sessionId: M, index });
  await rt.start();
});

after(() => { rt?.close(); fs.rmSync(root, { recursive: true, force: true }); });

async function waitFor(fn, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { await rt.scanAll(); await rt.pollAll(); if (fn()) return true; await sleep(100); }
  return fn();
}
const outs = (tuid) => rt.graph.ring.filter((e) => e.type === 'output' && e.toolUseId === tuid);

test('§101 출력 파일 → 생성 시각이 가장 가까운 열린 호출(서브에이전트 tu_fg2), 다음 파일은 메인 tu_fg1', async () => {
  assert.ok(rt._fg.open.has('tu_fg1') && rt._fg.open.has('tu_fg2'));
  fs.mkdirSync(tasks, { recursive: true });
  const f1 = path.join(tasks, 'bq7x1k2a9.output');
  fs.writeFileSync(f1, 'PASS a.test\n');
  assert.ok(await waitFor(() => outs('tu_fg2').length > 0), 'tu_fg2 출력');
  const e = outs('tu_fg2').at(-1);
  assert.equal(e.nodeId, 'a:sub1');
  assert.equal(e.fg, true);
  assert.equal(e.panel.part, 'tail');
  assert.deepEqual(e.panel.ref, { nodeId: 'a:sub1', toolUseId: 'tu_fg2' });
  assert.ok(e.panel.lines.includes('PASS a.test'));
  assert.ok(e.text.includes('PASS a.test'));

  const f2 = path.join(tasks, 'bmm5wdk0q.output');
  fs.writeFileSync(f2, 'step 1/3\n');
  assert.ok(await waitFor(() => outs('tu_fg1').length > 0), 'tu_fg1 출력');
  assert.equal(outs('tu_fg1').at(-1).nodeId, `s:${M}`);
  // 덧붙인 줄도 같은 꼬리 패널로
  fs.appendFileSync(f2, 'step 2/3\n');
  assert.ok(await waitFor(() => outs('tu_fg1').some((x) => x.panel?.lines?.includes('step 2/3'))));
  const p = outs('tu_fg1').at(-1).panel;
  assert.deepEqual(p.lines.slice(-2), ['step 1/3', 'step 2/3']);
  // 스냅샷 openTools 도 지금 꼬리
  const ot = rt.graph.get(`s:${M}`).openTools.find((t) => t.toolUseId === 'tu_fg1');
  assert.equal(ot.panel.part, 'tail');
});

test('§101 짝이 없는 새 파일(열린 호출이 모두 연결됨)은 잇지 않는다', async () => {
  const f3 = path.join(tasks, 'zzorphan1.output');
  fs.writeFileSync(f3, 'nobody\n');
  await waitFor(() => false, 2500);
  assert.ok(![...rt._fg.byFile.keys()].includes(f3));
  assert.ok(!rt.graph.ring.some((e) => e.type === 'output' && /nobody/.test(e.text || '')));
  fs.rmSync(f3);
});

test('§101 파일이 사라지면 끊고 tail 정리, tool_result 가 오면 끊고 더는 출력 없음', async () => {
  const f1 = path.join(tasks, 'bq7x1k2a9.output');
  fs.rmSync(f1);
  assert.ok(await waitFor(() => !rt._fg.byTu.has('tu_fg2')), '파일 삭제 → 끊김');
  assert.ok(!rt.tails.has(f1));

  const f2 = path.join(tasks, 'bmm5wdk0q.output');
  fs.appendFileSync(mainFile, line(R(0, 'tu_fg1', 'step 3/3', { stdout: 'step 1/3\nstep 2/3\nstep 3/3', stderr: '' })));
  assert.ok(await waitFor(() => !rt._fg.byTu.has('tu_fg1')), '결과 → 끊김');
  assert.ok(!rt.tails.has(f2));
  assert.ok(!rt._fg.open.has('tu_fg1'));
  const n = outs('tu_fg1').length;
  fs.appendFileSync(f2, 'late line\n');
  await waitFor(() => false, 1500);
  assert.equal(outs('tu_fg1').length, n, '결과 뒤 출력 없음');
  const end = rt.graph.ring.find((e) => e.type === 'tool-end' && e.toolUseId === 'tu_fg1');
  assert.ok(end && end.panel && end.panel.part !== 'tail');
  fs.rmSync(f2);
});

test('§101 재생(offline)에는 영향 없음', async () => {
  const off = new RootRuntime({ sessionId: M, index, offline: true });
  try {
    await off.loadOffline();
    assert.equal(off._fg.open.size, 0);
    assert.ok(!off.graph.ring.some((e) => e.type === 'output' && e.fg));
  } finally { off.close(); }
});

// /clear 뒤 세션: 기록 sessionId 와 임시 폴더 세션 ID 가 다르다(실측: 레코드 최상위 session_id = 임시 폴더 세션 ID,
// 비동기 Agent tool_result 의 toolUseResult.outputFile 도 그 폴더). 두 단서 각각으로 출력 파일을 찾는지
for (const via of ['session_id', 'outputFile']) {
  test(`§101.2 /clear 뒤 임시 폴더 세션 ID 가 달라도 잇는다(단서: ${via})`, async () => {
    const S = via === 'session_id' ? 'aaaaaaaa-7777-4777-8777-777777777777' : 'bbbbbbbb-8888-4888-8888-888888888888';
    const P = via === 'session_id' ? 'cccccccc-9999-4999-8999-999999999999' : 'dddddddd-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const b = { sessionId: S, cwd, version: '2.1.309', entrypoint: 'cli', ...(via === 'session_id' ? { session_id: P } : {}) };
    const tmpClaude = process.env.CCVIZ_CLAUDE_TMP;
    const ptasks = path.join(tmpClaude, encodeCwd(cwd), P, 'tasks');
    const recs = [
      { type: 'user', timestamp: T(20_000), ...b, message: { role: 'user', content: '돌려 주세요' } },
      ...(via === 'outputFile' ? [
        { type: 'assistant', timestamp: T(15_000), ...b, message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'tu_bga', name: 'Agent', input: { description: '뒤 작업', prompt: 'x', run_in_background: true } }] } },
        { type: 'user', timestamp: T(14_000), ...b, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_bga', content: 'Async agent launched' }] },
          toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'bgagent9', description: '뒤 작업', outputFile: path.join(ptasks, 'bgagent9.output') } },
      ] : []),
      { type: 'assistant', timestamp: T(4000), ...b, message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'tu_c1', name: 'Bash', input: { command: 'node slow.mjs', description: '느린 명령' } }] } },
    ];
    fs.writeFileSync(path.join(path.dirname(mainFile), `${S}.jsonl`), recs.map(line).join(''));
    await index.refresh();
    const r2 = new RootRuntime({ sessionId: S, index });
    try {
      await r2.start();
      fs.mkdirSync(ptasks, { recursive: true });
      fs.writeFileSync(path.join(ptasks, 'bx6sy31s0.output'), 'tick 1\n');
      const got = () => r2.graph.ring.some((e) => e.type === 'output' && e.toolUseId === 'tu_c1' && e.fg && e.panel?.lines?.includes('tick 1'));
      const t0 = Date.now();
      while (Date.now() - t0 < 6000 && !got()) { await r2.scanAll(); await r2.pollAll(); await sleep(100); }
      assert.ok(got(), '다른 세션 ID 폴더의 출력');
      assert.equal(r2.graph.ring.find((e) => e.toolUseId === 'tu_c1' && e.type === 'output').nodeId, `s:${S}`);
    } finally { r2.close(); }
  });
}
