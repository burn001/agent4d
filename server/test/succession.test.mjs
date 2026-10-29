// /clear 승계: 같은 프로세스가 /clear 로 새 세션을 시작해도 살아 있는 백그라운드 작업은 새 메인 아래로 이어 붙는다.
// 실측(2026-10-24, Claude Code 2.1.309) 모양을 합성: 옛 세션 꼬리의 '/clear' 대기열 기록, 새 세션 머리의 로컬 명령 clear,
// 서브에이전트 기록은 새 세션 폴더로 옮겨 이어 씀(meta.json 없음), 백그라운드 출력은 옛 세션 임시 폴더, 끝 알림은 새 세션 기록으로.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex, parseHead } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { buildReplay } from '../replay.mjs';
import { OverviewHub } from '../overview.mjs';
import { Graph } from '../graph.mjs';
import { isClearRecord, clearEnqueueTimes, openTasksAt, findClearPredecessor } from '../succession.mjs';

const P = 'aaaaaaaa-1111-4111-8111-111111111111'; // 옛 메인
const S = 'bbbbbbbb-2222-4222-8222-222222222222'; // /clear 뒤 새 메인
const X = 'cccccccc-3333-4333-8333-333333333333'; // 같은 프로젝트 다른 세션(관계없음)
const enc = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
const cwd = 'D:\\work\\cleardemo';
let root, index, clearIso, tasksDir;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-clear-'));
  const projects = path.join(root, 'projects');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  const now = Date.now();
  const T = (sec) => new Date(now - 1200_000 + sec * 1000).toISOString();
  clearIso = T(600);
  const dir = path.join(projects, enc(cwd));
  fs.mkdirSync(path.join(dir, P, 'subagents'), { recursive: true });
  fs.mkdirSync(path.join(dir, S, 'subagents'), { recursive: true });
  tasksDir = path.join(root, 'tmp', 'claude', enc(cwd), P, 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  const base = (sid) => ({ sessionId: sid, cwd, version: '2.1.309', entrypoint: 'cli' });
  const A = (sid, sec, block, side = false) => ({ type: 'assistant', timestamp: T(sec), ...base(sid), isSidechain: side, message: { role: 'assistant', model: 'm', content: [block] } });
  const R = (sid, sec, id, text, tur, side = false) => ({ type: 'user', timestamp: T(sec), ...base(sid), isSidechain: side, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, ...(tur ? { toolUseResult: tur } : {}) });
  const NOTE = (sid, sec, id, status, extra = '') => ({ type: 'user', timestamp: T(sec), ...base(sid), origin: { kind: 'task-notification' },
    message: { role: 'user', content: `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>${id} ${status}</summary>${extra}\n</task-notification>` } });
  const AGENT = (sid, sec, tuid, agentId, desc) => [
    A(sid, sec, { type: 'tool_use', id: tuid, name: 'Agent', input: { description: desc, subagent_type: 'designer', prompt: '하라', run_in_background: true } }),
    R(sid, sec + 1, tuid, `Async agent launched successfully.\nagentId: ${agentId}`, { isAsync: true, status: 'async_launched', agentId, description: desc }),
  ];
  const BG = (sid, sec, tuid, taskId, desc, side = false) => [
    A(sid, sec, { type: 'tool_use', id: tuid, name: 'Bash', input: { command: `node job.mjs # ${desc}`, description: desc, run_in_background: true } }, side),
    R(sid, sec + 1, tuid, `Command running in background with ID: ${taskId}. Output is being written to: ${path.join(tasksDir, taskId + '.output')}`, { stdout: '', stderr: '', backgroundTaskId: taskId }, side),
  ];
  const MON = (sid, sec, tuid, taskId, desc, mins) => [
    A(sid, sec, { type: 'tool_use', id: tuid, name: 'Monitor', input: { command: 'bash watch.sh', description: desc } }),
    R(sid, sec + 1, tuid, `Monitor started (task ${taskId}, expires in ${mins}m unless the source ends first)`, null),
  ];
  // 옛 메인 P: 살아 있는 서브에이전t A1·bash B1·Monitor M1 / 끝난 A2(알림)·B2(알림)·B3(TaskStop)·M2(시한 지남)
  const pRecs = [
    { type: 'user', timestamp: T(1), ...base(P), message: { role: 'user', content: '일을 시작하자' } },
    ...MON(P, 5, 'tu_m2', 'mon2', '옛 감시', 5),
    ...AGENT(P, 10, 'tu_a1', 'a1aaaa', '축 설계'),
    ...AGENT(P, 20, 'tu_a2', 'a2bbbb', '검증'),
    ...BG(P, 30, 'tu_b1', 'bg1', '긴 빌드'),
    ...BG(P, 40, 'tu_b2', 'bg2', '짧은 빌드'),
    ...BG(P, 50, 'tu_b3', 'bg3', '개발 서버'),
    ...MON(P, 400, 'tu_m1', 'mon1', '루프 감시', 30),
    NOTE(P, 100, 'bg2', 'completed'),
    NOTE(P, 200, 'a2bbbb', 'completed', '\n<result>검증 끝</result>'),
    A(P, 300, { type: 'tool_use', id: 'tu_stop', name: 'TaskStop', input: { task_id: 'bg3' } }),
    R(P, 301, 'tu_stop', 'Successfully stopped task: bg3', { message: 'ok', task_id: 'bg3' }),
    { type: 'system', subtype: 'turn_duration', timestamp: T(590), ...base(P), durationMs: 1000, pendingBackgroundAgentCount: 1 },
    { type: 'queue-operation', operation: 'enqueue', timestamp: new Date(Date.parse(clearIso) - 40).toISOString(), sessionId: P, content: '/clear' },
  ];
  fs.writeFileSync(path.join(dir, `${P}.jsonl`), pRecs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  // A1 의 /clear 앞 기록(옛 폴더) — 안에서 띄운 bash SB1(살아 있음)
  const a1Pre = [
    { type: 'user', timestamp: T(11), ...base(P), isSidechain: true, agentId: 'a1aaaa', message: { role: 'user', content: '축을 세워라' } },
    ...BG(P, 60, 'tu_sb1', 'sb1', '서브 빌드', true).map((r) => ({ ...r, agentId: 'a1aaaa' })),
  ];
  fs.writeFileSync(path.join(dir, P, 'subagents', 'agent-a1aaaa.jsonl'), a1Pre.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, P, 'subagents', 'agent-a1aaaa.meta.json'), JSON.stringify({ agentType: 'designer', description: '축 설계', toolUseId: 'tu_a1', requestShape: 'background' }));
  fs.writeFileSync(path.join(dir, P, 'subagents', 'agent-a2bbbb.jsonl'), JSON.stringify({ type: 'user', timestamp: T(21), ...base(P), isSidechain: true, message: { role: 'user', content: '검증' } }) + '\n');
  fs.writeFileSync(path.join(dir, P, 'subagents', 'agent-a2bbbb.meta.json'), JSON.stringify({ agentType: 'verifier', description: '검증', toolUseId: 'tu_a2', requestShape: 'background' }));
  // 새 메인 S: 머리 기록은 시각 순이 아니다(실측) — 훅 기록이 먼저, 로컬 명령 clear 가 첫 user 뒤
  const sRecs = [
    { type: 'queue-operation', operation: 'enqueue', timestamp: T(608), sessionId: S, content: 'start' },
    { type: 'attachment', timestamp: T(604), ...base(S), attachment: { type: 'hook_success', hookName: 'SessionStart:clear', content: '' } },
    { type: 'user', timestamp: T(609), ...base(S), message: { role: 'user', content: 'start' } },
    { type: 'system', subtype: 'local_command', timestamp: clearIso, ...base(S), content: '', commandRun: { command: 'clear', args: '' } },
    A(S, 612, { type: 'text', text: '이어서 봅니다' }),
    NOTE(S, 700, 'bg1', 'completed'),
  ];
  fs.writeFileSync(path.join(dir, `${S}.jsonl`), sRecs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  // A1 이 /clear 뒤 새 세션 폴더로 옮겨 이어 쓴 기록(meta.json 없음) — 거기서 Monitor 를 하나 더 건다
  const a1Post = [
    { type: 'assistant', timestamp: T(605), ...base(S), isSidechain: true, agentId: 'a1aaaa', message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '계속 설계 중' }] } },
    A(S, 650, { type: 'tool_use', id: 'tu_am', name: 'Monitor', input: { command: 'tail -f log', description: '러너 감시' } }, true),
    R(S, 651, 'tu_am', 'Monitor started (task amon, expires in 30m unless the source ends first)', null, true),
  ];
  fs.writeFileSync(path.join(dir, S, 'subagents', 'agent-a1aaaa.jsonl'), a1Post.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(tasksDir, 'bg1.output'), 'building...\n');
  fs.writeFileSync(path.join(tasksDir, 'mon1.output'), 'tick\n');
  // 관계없는 세션(같은 프로젝트, /clear 시각과 멀다)
  fs.writeFileSync(path.join(dir, `${X}.jsonl`), JSON.stringify({ type: 'user', timestamp: T(2), ...base(X), message: { role: 'user', content: '딴 일' } }) + '\n');
  const old = new Date(now - 1200_000 + 3000);
  fs.utimesSync(path.join(dir, `${X}.jsonl`), old, old);
  index = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'sessions') });
  index.taskRoots = [path.join(root, 'tmp', 'claude')];
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('/clear 표지: 머리의 로컬 명령·훅(가장 이른 시각), 옛 꼬리의 /clear 대기열', () => {
  assert.ok(isClearRecord({ type: 'system', subtype: 'local_command', commandRun: { command: 'clear' } }));
  assert.ok(isClearRecord({ type: 'attachment', attachment: { type: 'hook_success', hookName: 'SessionStart:clear' } }));
  assert.ok(isClearRecord({ type: 'user', message: { content: '<command-name>/clear</command-name>' } }));
  assert.ok(!isClearRecord({ type: 'system', subtype: 'local_command', commandRun: { command: 'compact' } }));
  const h = parseHead(fs.readFileSync(path.join(root, 'projects', enc(cwd), `${S}.jsonl`), 'utf8'));
  assert.equal(h.clearAt, clearIso);
  assert.equal(h.firstPrompt, 'start');
  assert.equal(clearEnqueueTimes('{"type":"queue-operation","operation":"enqueue","timestamp":"2026-10-24T08:22:15.654Z","content":"/clear"}')[0], Date.parse('2026-10-24T08:22:15.654Z'));
});

test('앞 세션 찾기·열린 작업 판정(끝난 것 제외)', async () => {
  await index.refresh();
  const p = await findClearPredecessor(index, index.findSession(S));
  assert.equal(p.entry.sessionId, P);
  assert.equal(p.evidence, 'queue-clear');
  assert.equal(await findClearPredecessor(index, index.findSession(P)), null);
  const open = openTasksAt(fs.readFileSync(path.join(root, 'projects', enc(cwd), `${P}.jsonl`), 'utf8'), Date.parse(clearIso), { from: P });
  assert.deepEqual(open.map((x) => `${x.kind}:${x.id}`).sort(), ['agent:a1aaaa', 'bash:bg1', 'monitor:mon1']);
});

test('새 메인 런타임: 살아 있는 서브에이전트·bash·Monitor 는 새 메인 아래(승계), 끝난 것은 없음 · 끝 알림은 새 기록으로 끝냄', async () => {
  await index.refresh();
  const rt = new RootRuntime({ sessionId: S, index });
  try {
    await rt.start();
    const g = rt.graph;
    const main = g.get(`s:${S}`);
    assert.equal(main.meta.clearedFrom, P);
    const a1 = g.get('a:a1aaaa');
    assert.ok(a1, '서브에이전트 승계');
    assert.equal(a1.parentId, `s:${S}`);
    assert.equal(a1.meta.inheritedFrom, P);
    assert.equal(a1.meta.agentType, 'designer');
    assert.equal(a1.label, '축 설계');
    assert.ok(!['done', 'error', 'stopped'].includes(a1.status));
    assert.ok(a1.counts.texts >= 1, '새 폴더 기록을 이어 읽음');
    const b1 = g.get('b:bg1');
    assert.equal(b1.parentId, `s:${S}`);
    assert.equal(b1.meta.inheritedFrom, P);
    assert.equal(b1.status, 'done', '새 세션 기록의 완료 알림');
    const m1 = g.get('m:mon1');
    assert.equal(m1.parentId, `s:${S}`);
    assert.ok(!['done', 'error', 'stopped'].includes(m1.status));
    assert.equal(g.get('b:sb1')?.parentId, 'a:a1aaaa', '서브에이전트 안에서 띄운 살아 있는 bash 도 승계');
    assert.equal(g.get('m:amon')?.parentId, 'a:a1aaaa', '/clear 뒤 서브에이전트가 건 Monitor');
    for (const id of ['a:a2bbbb', 'b:bg2', 'b:bg3', 'm:mon2']) assert.ok(!g.has(id), `끝난 작업은 옛 메인에: ${id}`);
    assert.deepEqual([...rt.inheritedIds].sort(), ['a:a1aaaa', 'b:bg1', 'b:sb1', 'm:mon1']);
    // 출력 파일은 옛 세션 임시 폴더
    await rt.findOutputs();
    assert.ok(rt.outputs.get('m:mon1')?.file?.includes(P));
  } finally { rt.close(); }
  // 옛 메인 런타임은 그대로(끝난 것 포함, 옛 기록 기준)
  const rp = new RootRuntime({ sessionId: P, index });
  try {
    await rp.start();
    for (const id of ['a:a1aaaa', 'a:a2bbbb', 'b:bg1', 'b:bg2', 'b:bg3', 'm:mon1', 'm:mon2']) assert.ok(rp.graph.has(id), id);
    assert.equal(rp.inheritedIds, undefined);
  } finally { rp.close(); }
});

test('재생: 같은 기록이면 같은 승계(새 메인 시작에 함께 뜸)', async () => {
  await index.refresh();
  const data = await buildReplay({ sessionId: S, index });
  const fin = data.finalState.nodes;
  for (const id of ['a:a1aaaa', 'b:bg1', 'm:mon1', 'b:sb1']) assert.equal(fin.get(id)?.parentId, id === 'b:sb1' ? 'a:a1aaaa' : `s:${S}`, id);
  assert.equal(fin.get('a:a1aaaa').meta.inheritedFrom, P);
  for (const id of ['a:a2bbbb', 'b:bg2', 'm:mon2']) assert.ok(!fin.has(id), id);
  const add = data.events.find((e) => e.type === 'node-add' && e.nodeId === 'a:a1aaaa');
  assert.ok(Date.parse(add.ts) >= Date.parse(data.events[0].ts));
});

test('허브: 옛 루트가 먼저 붙어 있어도 승계 노드(와 그 아래)는 새 루트 소유, 옛 루트가 빠져도 남는다', async () => {
  await index.refresh();
  const rts = new Map();
  const mk = async (sid) => { const rt = new RootRuntime({ sessionId: sid, index }); await rt.start(); rts.set(sid, rt); return rt; };
  await mk(P); await mk(S);
  let spec = [{ sid: P, live: false }];
  const src = {
    async desired() { return { roots: spec.map((r) => ({ sessionId: r.sid, projectId: 'p', live: r.live, liveStatus: r.live ? 'busy' : null, tier: r.live ? 'live' : 'recent', orphanSdk: false })) }; },
    async acquire(sid) { return rts.get(sid); }, release() {}, async projects() { return []; },
  };
  const hub = new OverviewHub({ source: src, intervalMs: 60_000, projectsMinMs: 0, graceMs: 60_000 });
  const got = [];
  hub.subscribe({ inactive: true, onEvent: (e) => got.push(e), onProjects() {} });
  try {
    await hub.wake();
    assert.equal(hub.owner.get('a:a1aaaa'), P);
    spec = [{ sid: P, live: false }, { sid: S, live: true }];
    await hub.tick();
    assert.equal(hub.owner.get('a:a1aaaa'), S);
    assert.equal(hub.owner.get('b:bg1'), S);
    assert.equal(hub.owner.get('a:a2bbbb'), P, '끝난 것은 옛 메인');
    const rm = got.find((e) => e.type === 'node-remove' && e.handoff && e.nodeId === 'a:a1aaaa');
    assert.ok(rm && rm.rootSessionId === P);
    const snap = hub.snapshot({ inactive: true });
    const a1 = snap.nodes.filter((n) => n.id === 'a:a1aaaa');
    assert.equal(a1.length, 1);
    assert.equal(a1[0].rootSessionId, S);
    assert.equal(a1[0].parentId, `s:${S}`);
    assert.ok(snap.nodes.every((n) => !n.parentId || snap.nodes.some((x) => x.id === n.parentId)), '부모 없는 노드 없음');
    // 옛 루트 퇴장 → 새 루트 것은 그대로
    spec = [{ sid: S, live: true }];
    await hub.tick();
    assert.ok(!hub.roots.has(P));
    assert.equal(hub.owner.get('a:a1aaaa'), S);
  } finally { hub.stop(); for (const rt of rts.values()) rt.close(); }
});

test('허브: 먼저 붙은 루트가 빠지면 뒤 루트의 같은 노드를 이어서 내보낸다(중복 id 재제공)', async () => {
  const rts = new Map();
  for (const sid of ['A', 'B']) {
    const g = new Graph({ rootSessionId: sid, localSeq: true });
    g.addNode({ id: `s:${sid}`, parentId: null, kind: 'main', label: 'm', sessionId: sid, meta: {} });
    g.addNode({ id: 'a:shared', parentId: `s:${sid}`, kind: 'subagent', label: 'x', sessionId: sid, meta: {} });
    g.finishLoad();
    rts.set(sid, { graph: g });
  }
  let spec = ['A', 'B'];
  const src = {
    async desired() { return { roots: spec.map((sid) => ({ sessionId: sid, projectId: 'p', live: true, liveStatus: 'busy', tier: 'live', orphanSdk: false })) }; },
    async acquire(sid) { return rts.get(sid); }, release() {}, async projects() { return []; },
  };
  const hub = new OverviewHub({ source: src, intervalMs: 60_000, projectsMinMs: 0, graceMs: -1 });
  const got = [];
  hub.subscribe({ inactive: true, onEvent: (e) => got.push(e), onProjects() {} });
  try {
    await hub.wake();
    assert.equal(hub.owner.get('a:shared'), 'A');
    spec = ['B'];
    await hub.tick(); await hub.tick();
    assert.equal(hub.owner.get('a:shared'), 'B');
    assert.ok(got.some((e) => e.type === 'node-add' && e.nodeId === 'a:shared' && e.rootSessionId === 'B'));
  } finally { hub.stop(); }
});

test('허브(§74.4): 옛 메인이 분리 실행으로 띄운 살아 있는 기동기는 새 메인 옆(spawnedBy), 그동안 옛 루트는 퇴장하지 않음', async () => {
  const gP = new Graph({ rootSessionId: 'P', localSeq: true });
  gP.addNode({ id: 's:P', parentId: null, kind: 'main', label: 'm', sessionId: 'P', meta: {} });
  gP.addNode({ id: 'b:L', parentId: null, kind: 'bash-bg', label: '기동기 · run.sh', sessionId: 'P', meta: { launcher: { script: 'run.sh' }, detached: true, spawnedBy: 's:P' } });
  gP.finishLoad();
  const gS = new Graph({ rootSessionId: 'S', localSeq: true });
  gS.addNode({ id: 's:S', parentId: null, kind: 'main', label: 'm', sessionId: 'S', meta: { clearedFrom: 'P' } });
  gS.finishLoad();
  const rts = new Map([['P', { graph: gP }], ['S', { graph: gS, inheritedFrom: new Set(['P']), inheritedIds: new Set() }]]);
  let spec = [{ sid: 'P', live: true }];
  const src = {
    async desired() { return { roots: spec.map((r) => ({ sessionId: r.sid, projectId: 'p', live: r.live, liveStatus: null, tier: r.live ? 'live' : 'recent', orphanSdk: false })) }; },
    async acquire(sid) { return rts.get(sid); }, release() {}, async projects() { return []; },
  };
  const hub = new OverviewHub({ source: src, intervalMs: 60_000, projectsMinMs: 0, graceMs: -1 });
  const got = [];
  hub.subscribe({ inactive: false, onEvent: (e) => got.push(e), onProjects() {} });
  try {
    await hub.wake();
    spec = [{ sid: 'S', live: true }]; // /clear: 옛 메인은 live 에서 빠지고 새 메인이 live
    await hub.tick(); await hub.tick();
    assert.ok(hub.roots.has('P'), '넘긴 기동기가 살아 있는 동안 옛 루트 유지');
    const L = hub.snapshot().nodes.find((n) => n.id === 'b:L');
    assert.equal(L.meta.spawnedBy, 's:S');
    assert.equal(L.meta.inheritedFrom, 'P');
    assert.ok(got.some((e) => e.type === 'node-update' && e.nodeId === 'b:L' && e.patch.meta?.spawnedBy === 's:S'));
    gP.updateNode('b:L', { status: 'done', endedAt: new Date().toISOString() });
    await hub.tick();
    assert.ok(!hub.roots.has('P'), '기동기가 끝나면 옛 루트 퇴장');
  } finally { hub.stop(); }
});

test('허브(§74.8): 서버가 /clear 뒤에 기동해 옛 메인이 처음부터 recent 로 붙어도, 살아 있는 기동기·러너·회차는 보인다', async () => {
  // 실기록 꼴(익명화): 옛 메인 P 가 relimit-restart.sh 를 nohup 으로 띄움 → 러너 → 회차 claude -p(진행 중), 그 뒤 /clear 로 S.
  // 서버는 /clear 뒤 재기동 — 첫 tick 부터 P 는 live 가 아닌 recent(launcherOf)라 leftAt 이 없다
  const gP = new Graph({ rootSessionId: 'P', localSeq: true });
  gP.addNode({ id: 's:P', parentId: null, kind: 'main', label: 'm', sessionId: 'P', meta: {} });
  gP.addNode({ id: 'b:L', parentId: null, kind: 'bash-bg', label: '기동기 · relimit-restart.sh', sessionId: 'P', meta: { launcher: { script: 'relimit-restart.sh' }, detached: true, spawnedBy: 's:P' } });
  gP.addNode({ id: 'b:L-r1', parentId: 'b:L', kind: 'bash-bg', label: '러너 · autopilot.sh', sessionId: 'P', meta: {} });
  gP.addNode({ id: 's:R', parentId: 'b:L-r1', kind: 'claude-p', label: 'claude -p · R', sessionId: 'R', meta: {} });
  gP.finishLoad();
  const gS = new Graph({ rootSessionId: 'S', localSeq: true });
  gS.addNode({ id: 's:S', parentId: null, kind: 'main', label: 'm', sessionId: 'S', meta: { clearedFrom: 'P' } });
  gS.finishLoad();
  const rts = new Map([['P', { graph: gP }], ['S', { graph: gS, inheritedFrom: new Set(['P']), inheritedIds: new Set() }]]);
  const spec = [{ sid: 'S', live: true }, { sid: 'P', live: false }]; // desired() 순서 그대로: live 메인 먼저, 기동기가 붙든 옛 메인 뒤
  const src = {
    async desired() { return { roots: spec.map((r) => ({ sessionId: r.sid, projectId: 'p', live: r.live, liveStatus: null, tier: r.live ? 'live' : 'recent', orphanSdk: false })) }; },
    async acquire(sid) { return rts.get(sid); }, release() {}, async projects() { return []; },
  };
  const hub = new OverviewHub({ source: src, intervalMs: 60_000, projectsMinMs: 0, graceMs: 600_000 });
  hub.subscribe({ inactive: false, onEvent() {}, onProjects() {} });
  try {
    await hub.wake();
    await hub.tick();
    const ids = new Set(hub.snapshot().nodes.map((n) => n.id));
    for (const id of ['b:L', 'b:L-r1', 's:R']) assert.ok(ids.has(id), `보여야 함: ${id}`);
    const L = hub.snapshot().nodes.find((n) => n.id === 'b:L');
    assert.equal(L.meta.spawnedBy, 's:S');
    assert.equal(L.meta.inheritedFrom, 'P');
    // 기동기가 끝나면 옛 루트는 다시 숨는다(recent 로 붙은 끝난 메인은 보이지 않음 — 예전 그대로)
    gP.updateNode('b:L', { status: 'done', endedAt: new Date().toISOString() });
    await hub.tick();
    assert.ok(!hub.snapshot().nodes.some((n) => n.id === 's:R'));
  } finally { hub.stop(); }
});

test('허브(§74.10): 새 메인이 §48.4 로 같은 기동기를 이어받았으면(b:adopt-…) 옛 기동기는 넘기지 않는다 — 같은 루프가 기동기 둘로 보이지 않게', async () => {
  // 실측 꼴(실제 프로젝트 10-28 22시): 옛 메인 P 의 nohup 기동기 b:toolu_L(회차 9, 지금 idle) + /clear 사슬 끝 새 메인 S 가 그 뒤 회차를 이어받은 b:adopt-toolu_L(진행 중)
  const gP = new Graph({ rootSessionId: 'P', localSeq: true });
  gP.addNode({ id: 's:P', parentId: null, kind: 'main', label: 'm', sessionId: 'P', meta: {} });
  gP.addNode({ id: 'b:toolu_L', parentId: null, kind: 'bash-bg', label: '기동기 · relimit-restart.sh', sessionId: 'P', meta: { toolUseId: 'toolu_L', launcher: { script: 'relimit-restart.sh' }, detached: true, spawnedBy: 's:P' } });
  gP.addNode({ id: 'b:toolu_L-r1', parentId: 'b:toolu_L', kind: 'bash-bg', label: '러너 · autopilot.sh', sessionId: 'P', meta: {} });
  gP.finishLoad();
  const gS = new Graph({ rootSessionId: 'S', localSeq: true });
  gS.addNode({ id: 's:S', parentId: null, kind: 'main', label: 'm', sessionId: 'S', meta: { clearedFrom: 'P' } });
  gS.finishLoad();
  const rts = new Map([['P', { graph: gP }], ['S', { graph: gS, inheritedFrom: new Set(['P']), inheritedIds: new Set() }]]);
  const spec = [{ sid: 'S', live: true }, { sid: 'P', live: false }];
  const src = {
    async desired() { return { roots: spec.map((r) => ({ sessionId: r.sid, projectId: 'p', live: r.live, liveStatus: null, tier: r.live ? 'live' : 'recent', orphanSdk: false })) }; },
    async acquire(sid) { return rts.get(sid); }, release() {}, async projects() { return []; },
  };
  const hub = new OverviewHub({ source: src, intervalMs: 60_000, projectsMinMs: 0, graceMs: 600_000 });
  hub.subscribe({ inactive: false, onEvent() {}, onProjects() {} });
  try {
    await hub.wake();
    await hub.tick();
    assert.ok(hub.snapshot().nodes.some((n) => n.id === 'b:toolu_L'), '이어받기 전: 넘긴 기동기(§74.4)가 보인다');
    // 새 회차가 S 로 인계됨 → S 런타임이 이어받은 기동기를 둔다
    gS.addNode({ id: 'b:adopt-toolu_L', parentId: null, kind: 'bash-bg', label: '기동기 · relimit-restart.sh', sessionId: 'S', meta: { toolUseId: 'toolu_L', launcher: { script: 'relimit-restart.sh' }, detached: true, spawnedBy: 's:S', adopted: { fromSession: 'P' } } });
    gS.addNode({ id: 'b:adopt-toolu_L-r1', parentId: 'b:adopt-toolu_L', kind: 'bash-bg', label: '러너 · autopilot.sh', sessionId: 'S', meta: {} });
    await hub.tick();
    const ids = hub.snapshot().nodes.map((n) => n.id);
    assert.ok(ids.includes('b:adopt-toolu_L') && ids.includes('b:adopt-toolu_L-r1'));
    assert.ok(!ids.includes('b:toolu_L') && !ids.includes('b:toolu_L-r1'), '옛 기동기·러너는 숨음(같은 루프 하나만)');
    assert.equal(ids.filter((id) => /toolu_L$/.test(id)).length, 1);
  } finally { hub.stop(); }
});

test('§39.9 자동 세션(--session auto): /clear 로 이어받은 새 세션으로 120초를 기다리지 않고 바로 넘어간다', async () => {
  const dir = path.join(root, 'projects', enc(cwd));
  const fp = path.join(dir, `${P}.jsonl`), fs_ = path.join(dir, `${S}.jsonl`);
  const keep = [fs.statSync(fp), fs.statSync(fs_)];
  try {
    const now = Date.now();
    // 옛 세션이 방금까지 더 활발했던 것처럼(활동 시각 최신) — 예전 규칙이면 지금 세션(P)이 120초 동안 유지됐다
    fs.utimesSync(fp, new Date(now), new Date(now));
    fs.utimesSync(fs_, new Date(now - 10_000), new Date(now - 10_000));
    await index.refresh();
    index.autoCurrent = P;
    assert.equal(await index.autoPick(), S);
    // 관계없는 세션이 지금이면(이어받은 게 아님) 바로 넘어가지 않는다
    index.autoCurrent = X;
    fs.utimesSync(path.join(dir, `${X}.jsonl`), new Date(now - 5_000), new Date(now - 5_000));
    await index.refresh();
    assert.equal(await index.autoPick(), X);
  } finally {
    fs.utimesSync(fp, keep[0].atime, keep[0].mtime);
    fs.utimesSync(fs_, keep[1].atime, keep[1].mtime);
    index.autoCurrent = null;
  }
});
