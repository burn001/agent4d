import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeFixture, rmFixture, IDS } from './fixtures/build.mjs';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime, mainRoleLabel, claudePProject, claudePLabel } from '../session.mjs';

let fx, index, rt;

before(async () => {
  fx = makeFixture();
  process.env.CCVIZ_CLAUDE_TMP = fx.tmpClaude;
  index = new SessionIndex({ projectsDir: fx.projects, sessionsDir: fx.sessions });
  await index.refresh();
  rt = new RootRuntime({ sessionId: IDS.main, index });
  await rt.start();
});

after(() => { rt?.close(); rmFixture(fx); });

const node = (id) => rt.graph.get(id);
async function waitFor(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { await rt.scanAll(); await rt.pollAll(); if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return fn();
}

test('메인 노드: 라벨(역할 표기, §44)·meta.title(ai-title)·idle(turn_duration)·모델', () => {
  const m = node(`s:${IDS.main}`);
  assert.equal(m.kind, 'main');
  assert.equal(m.label, String.raw`메인 · work\demo`);
  assert.equal(m.meta.title, '시각화 도구 제작');
  assert.ok(!m.meta.customTitle);
  assert.equal(m.depth, 0);
  assert.equal(m.model, 'claude-test-1');
  assert.equal(m.meta.cwd, fx.cwd);
  // live status busy 이므로 sweep 이 idle 로 바꾸지 않지만, turn_duration 이 idle 로 만든다
  assert.equal(m.status, 'idle');
  assert.equal(m.openTools.length, 0);
});

test('§4.1 서브에이전트: toolUseId 로 부모, 손자는 에이전트 transcript 로, fork 는 parentAgentId, 고아는 루트', () => {
  const a1 = node('a:agentaaa1');
  assert.equal(a1.kind, 'subagent');
  assert.equal(a1.parentId, `s:${IDS.main}`);
  assert.equal(a1.meta.background, true);
  assert.equal(a1.status, 'done'); // task-notification completed
  const g = node('a:agentccc3');
  assert.equal(g.parentId, 'a:agentaaa1');
  assert.equal(g.depth, 2);
  const f = node('a:agentddd4');
  assert.equal(f.parentId, 'a:agentaaa1');
  const o = node('a:agenteee5');
  assert.equal(o.parentId, `s:${IDS.main}`);
  const b2 = node('a:agentbbb2');
  assert.equal(b2.status, 'done'); // 포그라운드 Agent tool_result
  const res = rt.graph.ring.filter((e) => e.type === 'result');
  assert.ok(res.some((e) => e.nodeId === 'a:agentaaa1' && e.text.includes('조사 결과 요약 & 정리')));
  assert.ok(res.some((e) => e.nodeId === 'a:agentbbb2' && e.text.includes('이상 없음')));
});

test('§4.2 워크플로: w 노드·journal 에이전트·result·완료 알림', () => {
  const w = node('w:wf_test-001');
  assert.equal(w.kind, 'workflow');
  assert.equal(w.parentId, `s:${IDS.main}`);
  assert.equal(w.label, 'demo-flow');
  assert.equal(w.status, 'done');
  const a = node('a:wfagent01');
  assert.equal(a.kind, 'workflow-agent');
  assert.equal(a.parentId, 'w:wf_test-001');
  assert.equal(a.meta.phase, 'Design');
  assert.equal(a.status, 'done');
  const b = node('a:wfagent02');
  assert.equal(b.parentId, 'w:wf_test-001');
  assert.equal(b.label, 'build:y');
  assert.ok(rt.graph.ring.some((e) => e.type === 'result' && e.nodeId === 'a:wfagent01' && e.text === '설계 완료'));
});

test('§4.4 백그라운드 bash: 노드·출력 tail·완료·명령 마스킹', () => {
  const b = node('b:bgtask001');
  assert.equal(b.kind, 'bash-bg');
  assert.equal(b.label, '개발 서버');
  assert.equal(b.status, 'done');
  assert.ok(!b.meta.command.includes('abcd1234secret'), b.meta.command);
  assert.ok(rt.graph.ring.some((e) => e.type === 'output' && e.nodeId === 'b:bgtask001' && e.text.includes('line2')));
  assert.ok(!rt.graph.has('b:afore0001'));
  // toolUseResult 없는 워크플로 에이전트 transcript
  const wb = node('b:bgwf0002');
  assert.ok(wb);
  assert.equal(wb.parentId, 'a:wfagent02');
  assert.equal(wb.label, 'wf 서버');
  assert.ok(rt.graph.ring.some((e) => e.type === 'output' && e.nodeId === 'b:bgwf0002'));
  const wm = node('m:monwf003');
  assert.ok(wm);
  assert.equal(wm.parentId, 'a:wfagent02');
  assert.equal(wm.meta.timeoutMs, 1800000);
  assert.equal(wb.status, 'error'); // attachment(queued_command) 알림
  assert.ok(!rt.graph.has('b:fake0001')); // 본문 중간의 문구는 무시
  // 같은 알림 중복(attachment + user) 은 한 번만
  assert.equal(rt.graph.ring.filter((e) => e.type === 'user' && e.origin === 'task-notification' && e.text === 'Agent done').length, 1);
});

test('§4.5 Monitor: 파일 출력, 알림 event 대체, 만료', () => {
  const m1 = node('m:mon00001');
  assert.equal(m1.kind, 'monitor');
  assert.equal(m1.meta.timeoutMs, 1800000);
  assert.ok(rt.graph.ring.some((e) => e.type === 'output' && e.nodeId === 'm:mon00001' && e.text.includes('새 알림')));
  const m2 = node('m:mon00002');
  assert.equal(m2.status, 'done');
  assert.ok(rt.graph.ring.some((e) => e.type === 'output' && e.nodeId === 'm:mon00002' && e.text.includes('홍길동 <a@b.c>')));
});

test('§4.3 claude -p: 힌트·stdout·휴리스틱 매칭과 재귀', () => {
  for (const sid of [IDS.childHint, IDS.childStdout, IDS.childHeur]) {
    const c = node(`s:${sid}`);
    assert.ok(c, sid);
    assert.equal(c.kind, 'claude-p');
    assert.equal(c.parentId, `s:${IDS.main}`);
    assert.equal(c.depth, 1);
    assert.equal(c.status, 'done');
  }
  assert.equal(node(`s:${IDS.childHint}`).meta.toolUseId, 'toolu_cp1');
  assert.equal(node(`s:${IDS.childStdout}`).meta.toolUseId, 'toolu_cp2');
  assert.equal(node(`s:${IDS.childHeur}`).meta.toolUseId, 'toolu_cp3');
  assert.ok(!rt.graph.has(`s:${IDS.stray}`));
  // 자식의 서브에이전트(재귀)
  const ca = node('a:childagent1');
  assert.ok(ca);
  assert.equal(ca.parentId, `s:${IDS.childHint}`);
  assert.equal(ca.depth, 2);
  assert.ok(index.claimedChildren.has(IDS.childHint));
  // label: 부모(D:\work\demo)와 다른 프로젝트(C:\scratch\probe) → 프로젝트 이름 + sid8, 첫 프롬프트는 meta.title
  assert.equal(node(`s:${IDS.childHint}`).label, 'claude -p · probe · 22222222');
  assert.equal(node(`s:${IDS.childHint}`).meta.title, null); // 첫 프롬프트('say hi')는 부제로 쓰지 않음
  assert.equal(node(`s:${IDS.childHeur}`).label, 'claude -p · probe · 44444444');
});

test('§44.2 claudePProject·claudePLabel: scratchpad 는 부모 프로젝트, 형제는 sid8 로 구분', () => {
  const tmp = process.env.CCVIZ_CLAUDE_TMP;
  const psid = '3f9c2e71-5a0b-4c8d-9e16-7b2a4d6f8c03';
  const scratch = path.join(tmp, 'D--DEV-REPOS-demo-api', psid, 'scratchpad', 'ptest');
  const lookup = (sid) => (sid === psid ? { cwd: String.raw`D:\DEV_REPOS\demo_api`, projectDir: 'D--DEV-REPOS-demo-api' } : null);
  const pr = claudePProject(scratch, 'x', lookup);
  assert.deepEqual(pr, { path: String.raw`D:\DEV_REPOS\demo_api`, temp: false });
  assert.equal(claudePLabel('5c2e9f04-aaaa', pr), 'claude -p · demo_api');
  // 부모 head 를 모르면 임시 폴더 경로의 <enc> 역추정
  assert.equal(claudePLabel('5c2e9f04-aaaa', claudePProject(scratch, 'x', null)), String.raw`claude -p · demo\api`); // 역추정은 손실(_ → \)
  // cwd 없이 폴더 id 만: scratchpad 인코딩 안의 <enc>
  assert.equal(claudePLabel('1', claudePProject(null, `C--Users-dev-AppData-Local-Temp-claude-D--work-demo-${psid}-scratchpad`)), String.raw`claude -p · work\demo`);
  // 자식: 부모와 같은 프로젝트면 sid8, 다르면 프로젝트 + sid8
  const par = claudePProject(String.raw`D:\DEV_REPOS\demo_api`, null);
  assert.equal(claudePLabel('5c2e9f04-aaaa', pr, par), 'claude -p · 5c2e9f04');
  assert.equal(claudePLabel('8b4d1a6e-bbbb', claudePProject(String.raw`D:\other\place`, null), par), 'claude -p · place · 8b4d1a6e');
  // 임시 폴더(주인 세션 없음)는 (임시)
  assert.equal(claudePLabel('9', claudePProject(String.raw`C:\Users\u\AppData\Local\Temp\job`, null)), String.raw`claude -p · (임시) Temp\job`);
  assert.equal(claudePLabel('abcdef0123', null), 'claude -p · abcdef01');
});

test('§44.2 독립 claude -p 루트: label "claude -p · <프로젝트>", 첫 프롬프트는 meta.title', async () => {
  const r = new RootRuntime({ sessionId: IDS.stray, index, offline: true });
  try {
    await r.loadOffline();
    const n = r.graph.get(`s:${IDS.stray}`);
    assert.equal(n.kind, 'main');
    assert.equal(n.label, 'claude -p · probe');
    assert.equal(n.meta.title, null); // 첫 프롬프트는 부제로 쓰지 않음
  } finally { r.close(); }
});

test('§44.2 claude -p 자식에 늦게 온 ai-title 은 label 불변·meta.title 만', async () => {
  const file = index.findSession(IDS.childStdout).file;
  fs.appendFileSync(file, JSON.stringify({ type: 'ai-title', aiTitle: '자식 자동 제목', sessionId: IDS.childStdout }) + String.fromCharCode(10));
  assert.ok(await waitFor(() => node(`s:${IDS.childStdout}`).meta.title === '자식 자동 제목'));
  assert.equal(node(`s:${IDS.childStdout}`).label, 'claude -p · probe · 33333333');
});

test('이벤트: 타입·cat·redact·thinking 글자 수', () => {
  const ring = rt.graph.ring;
  const types = new Set(ring.map((e) => e.type));
  for (const t of ['node-add', 'node-update', 'tool-start', 'tool-end', 'text', 'thinking', 'user', 'result', 'output']) assert.ok(types.has(t), t);
  const th = ring.find((e) => e.type === 'thinking');
  assert.equal(th.chars, 6);
  assert.equal(th.text, undefined);
  const txt = ring.find((e) => e.type === 'text' && e.text.includes('시작하겠습니다'));
  assert.ok(!txt.text.includes('abcdefghijklmnop'));
  const human = ring.find((e) => e.type === 'user' && e.origin === 'human');
  assert.ok(human && !human.text.includes('hunter2'));
  const sk = ring.find((e) => e.type === 'tool-start' && e.tool === 'Skill');
  assert.equal(sk.cat, 'skill');
  assert.equal(sk.skill, 'writing-style');
  const mcpEnd = ring.find((e) => e.type === 'tool-end' && e.tool === 'mcp__demo__lookup');
  assert.equal(mcpEnd.ok, false);
  assert.equal(mcpEnd.cat, 'mcp');
  assert.equal(node(`s:${IDS.main}`).counts.errors, 1);
  // 시각순 정렬·seq 단조
  for (let i = 1; i < ring.length; i++) assert.ok(ring[i].seq > ring[i - 1].seq);
});

test('실시간 append: 새 tool_use·부분 줄·서브에이전트 신규 파일', async () => {
  const got = [];
  const unsub = rt.graph.subscribe((e) => got.push(e));
  const M = IDS.main;
  const rec = fx.A(M, 70, fx.TU('toolu_live1', 'Grep', { pattern: 'live' }));
  const line = JSON.stringify(rec) + '\n';
  fs.appendFileSync(fx.mainFile, line.slice(0, 20));
  await rt.pollAll();
  assert.equal(got.filter((e) => e.type === 'tool-start').length, 0);
  fs.appendFileSync(fx.mainFile, line.slice(20));
  await waitFor(() => got.some((e) => e.toolUseId === 'toolu_live1'));
  const ts = got.find((e) => e.type === 'tool-start' && e.toolUseId === 'toolu_live1');
  assert.ok(ts);
  assert.equal(ts.cat, 'search');
  assert.equal(node(`s:${M}`).status, 'active');
  // 새 서브에이전트
  const sub = path.join(fx.proj, M, 'subagents');
  fs.writeFileSync(path.join(sub, 'agent-agentfff6.meta.json'), JSON.stringify({ description: '새 에이전트', toolUseId: 'toolu_live1', spawnDepth: 1 }));
  fs.writeFileSync(path.join(sub, 'agent-agentfff6.jsonl'), JSON.stringify(fx.A(M, 71, { type: 'text', text: '새로 시작' }, { isSidechain: true })) + '\n');
  await waitFor(() => got.some((e) => e.type === 'text' && e.nodeId === 'a:agentfff6'));
  const add = got.find((e) => e.type === 'node-add' && e.nodeId === 'a:agentfff6');
  assert.ok(add);
  assert.equal(add.node.parentId, `s:${M}`);
  assert.ok(got.some((e) => e.type === 'text' && e.nodeId === 'a:agentfff6'));
  // 백그라운드 출력 append → output (합쳐서)
  fs.appendFileSync(fx.monOut, 'more1\nmore2\n');
  await waitFor(() => got.some((e) => e.type === 'output' && e.nodeId === 'm:mon00001' && e.text.includes('more2')));
  assert.ok(got.some((e) => e.type === 'output' && e.nodeId === 'm:mon00001' && e.text.includes('more2')));
  unsub();
});

test('SessionIndex: 목록·auto·.key 무시·isChild', async () => {
  await index.refresh();
  assert.ok(!index.live.has('77777777-7777-4777-8777-777777777777'));
  assert.equal(index.liveStatus(IDS.main), 'busy');
  const list = await index.list(30);
  const me = list.find((s) => s.sessionId === IDS.main);
  assert.ok(me && me.live && me.liveStatus === 'busy' && !me.isChild && me.entrypoint === 'cli');
  assert.ok(list.find((s) => s.sessionId === IDS.stray).isChild);
  assert.equal(await index.autoPick(), IDS.main);
});

test('§44 mainRoleLabel: 프로젝트 이름 규칙(baseName)·임시 폴더·cwd 없을 때 폴더 id 역추정', () => {
  assert.equal(mainRoleLabel(String.raw`D:\DEV_REPOS\demo_api`, 'D--DEV-REPOS-demo-api'), '메인 · demo_api');
  assert.equal(mainRoleLabel(String.raw`D:\work\Projects\2026\ `.trim()), String.raw`메인 · Projects\2026`);
  assert.equal(mainRoleLabel(String.raw`C:\Users\u\AppData\Local\Temp\job`), String.raw`메인 · (임시) Temp\job`);
  assert.equal(mainRoleLabel(null, 'D--work-demo'), String.raw`메인 · work\demo`);
  assert.equal(mainRoleLabel(null, null), '메인');
});

test('§44 늦게 온 ai-title 은 label 을 덮지 않고 meta.title 만, custom-title 은 label 로', async () => {
  const file = index.findSession(IDS.main).file;
  const add = (r) => fs.appendFileSync(file, JSON.stringify({ ...r, sessionId: IDS.main }) + String.fromCharCode(10));
  add({ type: 'ai-title', aiTitle: '재부팅 후 인계 지시 집행 sk-ant-api03-abcdefghijklmnopqrstu' });
  assert.ok(await waitFor(() => node(`s:${IDS.main}`).meta.title?.startsWith('재부팅 후 인계')));
  const m = node(`s:${IDS.main}`);
  assert.equal(m.label, String.raw`메인 · work\demo`);
  assert.ok(!m.meta.title.includes('sk-ant-api03'), 'meta.title 도 마스킹');
  add({ type: 'custom-title', customTitle: '내가 붙인 이름' });
  assert.ok(await waitFor(() => node(`s:${IDS.main}`).label === '내가 붙인 이름'));
  add({ type: 'ai-title', aiTitle: '또 다른 자동 제목' });
  assert.ok(await waitFor(() => node(`s:${IDS.main}`).meta.title === '또 다른 자동 제목'));
  assert.equal(node(`s:${IDS.main}`).label, '내가 붙인 이름');
});

test('§66 파일 도구 tool-start 에 정규화 경로(file), 경로 마스킹 규칙 통과', () => {
  const e = rt.graph.ring.find((x) => x.type === 'tool-start' && x.toolUseId === 'toolu_read1');
  assert.ok(e && e.file, JSON.stringify(e));
  assert.deepEqual(e.file, { k: 'd:/work/demo/src/app.js', n: 'app.js', w: 0 });
});
