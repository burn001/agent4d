// 계획 보드: 계획 출처 정규화(TodoWrite·Task·ExitPlanMode·체크박스 md·단계 설계서·셸 grep·Workflow phases) →
// 소유 노드 meta.plans. 러너 아래 회차가 만진 단계 설계서는 러너의 계획 + 항목마다 처리한 회차.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Graph } from '../graph.mjs';
import { PlanTracker, planStart, parsePlanMarkdown, phaseStatus, workflowPhases, planTitleOf, normStatus, PLAN } from '../plans.mjs';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { LauncherIndex } from '../launcher.mjs';
import { buildReplay } from '../replay.mjs';

const DESIGN = (st) => `# 축 설계
## §3 단계
### 단계 0 — 재측정
**단계 0 상태**: ${st[0]}
### 단계 1 — ADR · 배선
**단계 1 상태**: ${st[1]}
### 단계 2 — 배포
**단계 2 상태**: ${st[2]}
`;

test('파서: 단계 설계서·체크박스·ExitPlanMode 느슨한 목록·Workflow phases·상태 매핑·제목', () => {
  const d = parsePlanMarkdown(DESIGN(['✅ **닫힘**(2026-10-24)', '◑ 미착지', '⏸ 외부 대기']));
  assert.equal(d.kind, 'phases');
  assert.equal(d.title, '축 설계');
  assert.deepEqual(d.items.map((x) => [x.k, x.t, x.s, x.hold || 0]), [['단계 0', '단계 0 — 재측정', 'done', 0], ['단계 1', '단계 1 — ADR · 배선', 'pending', 0], ['단계 2', '단계 2 — 배포', 'pending', 1]]);
  assert.equal(phaseStatus('🔧 진행 중').s, 'in_progress');
  assert.equal(phaseStatus('◑ 미착지').s, 'pending');
  const c = parsePlanMarkdown('## 남은 작업\n- [x] 서버 모델\n- [ ] **웹** 보드 `plan-ui`\n  - [~] 팝업\n```\n- [ ] 코드 안은 무시\n```');
  assert.equal(c.kind, 'checkbox');
  assert.deepEqual(c.items.map((x) => [x.t, x.s]), [['서버 모델', 'done'], ['웹 보드 plan-ui', 'pending'], ['팝업', 'in_progress']]);
  assert.equal(parsePlanMarkdown('- [ ] 하나만'), null, '체크박스 하나는 계획 아님(기본 2개)');
  assert.equal(parsePlanMarkdown('그냥 글'), null);
  const lp = parsePlanMarkdown('# 계획\n## 배경\n글\n1. 서버\n2. 웹\n3. 시험', { loose: true });
  assert.deepEqual(lp.items.map((x) => x.t), ['서버', '웹', '시험']);
  const hp = parsePlanMarkdown('# 계획\n## 요약\n## 서버 바꾸기\n## 웹 바꾸기', { loose: true });
  assert.deepEqual(hp.items.map((x) => x.t), ['서버 바꾸기', '웹 바꾸기'], '요약 같은 절 제목은 빼고 나머지 ## 제목');
  assert.deepEqual(workflowPhases("export const meta = { name: 'x', phases: [ { title: 'Design', detail: 'a [b]' }, { title: \"Build\" }, { title: `Ship` } ] }; phase('Design')"), ['Design', 'Build', 'Ship']);
  assert.deepEqual(workflowPhases('no phases'), []);
  assert.equal(planTitleOf('D:\\Works\\26.10.23 시각화\\_STATUS.md'), '26.10.23 시각화/_STATUS.md');
  assert.equal(planTitleOf('/r/docs/plans/2026-10-24-x-execution-design.md'), '2026-10-24-x-execution-design.md');
  assert.equal(normStatus('completed'), 'done'); assert.equal(normStatus('in_progress'), 'in_progress'); assert.equal(normStatus('?'), 'pending');
});

test('planStart: 출처별 서술자(md 만 파일 계획, 셸은 md 경로를 든 명령만, 쓰는 명령 표지)', () => {
  assert.equal(planStart('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress', activeForm: 'b 중' }] }).items.length, 2);
  assert.deepEqual(planStart('TaskUpdate', { taskId: 3, status: 'completed' }), { src: 'tasks', op: 'update', id: '3', s: 'completed', t: null });
  assert.equal(planStart('ExitPlanMode', { plan: '# P\n1. a\n2. b' }).parsed.items.length, 2);
  assert.equal(planStart('Write', { file_path: 'src/a.js', content: '- [ ] a\n- [ ] b' }), null);
  const w = planStart('Write', { file_path: 'docs/plan.md', content: '- [ ] a\n- [ ] b' }, { cwd: 'D:\\r' });
  assert.equal(w.key, 'd:/r/docs/plan.md'); assert.equal(w.base, 'docs/plan.md');
  assert.equal(planStart('Edit', { file_path: '/d/R/docs/x.md', old_string: 'a', new_string: 'b' }).key, 'd:/r/docs/x.md');
  const sh = planStart('Bash', { command: "grep -n '단계 . 상태' docs/plans/x-design.md" }, { cwd: '/d/r' });
  assert.equal(sh.src, 'shell'); assert.equal(sh.writes, false); assert.equal(sh.files[0].key, 'd:/r/docs/plans/x-design.md');
  assert.equal(planStart('Bash', { command: "python3 - <<'EOF'\np='docs/x.md'\nEOF" }).writes, true);
  assert.equal(planStart('Bash', { command: 'ls -la' }), null);
  assert.equal(planStart('Workflow', { script: "meta={phases:[{title:'A'}]}" }).phases[0], 'A');
});

/** 메인 → 서브에이전트, 메인 → 기동기 → 러너 → 회차(cycle 2·3) → 회차 안 서브에이전트 */
function tree(privacy = 'summary') {
  const g = new Graph({ rootSessionId: 'm', privacy, keepAll: true, localSeq: true });
  const T = (s) => new Date(Date.UTC(2026, 9, 24, 0, 0, s)).toISOString();
  g.addNode({ id: 's:m', kind: 'main', label: '메인' }, T(0));
  g.addNode({ id: 'a:sub', parentId: 's:m', kind: 'subagent', label: '서브' }, T(1));
  g.addNode({ id: 'b:L', parentId: 's:m', kind: 'bash-bg', label: '기동기 · relaunch.sh', meta: { launcher: { script: 'relaunch.sh', via: ['relaunch.sh', 'autopilot.sh'] } } }, T(2));
  g.addNode({ id: 'b:L-r1', parentId: 'b:L', kind: 'bash-bg', label: '러너 · autopilot.sh', meta: { runner: { script: 'autopilot.sh', instance: 1, launcher: 'b:L' } } }, T(3));
  g.addNode({ id: 's:c2', parentId: 'b:L-r1', kind: 'claude-p', label: '회차 2', meta: { cycle: 2 } }, T(4));
  g.addNode({ id: 's:c3', parentId: 'b:L-r1', kind: 'claude-p', label: '회차 3', meta: { cycle: 3 } }, T(5));
  g.addNode({ id: 'a:c3sub', parentId: 's:c3', kind: 'subagent', label: '회차 3 서브' }, T(6));
  return { g, T, plans: (id) => g.get(id).meta.plans };
}
const run = (pt, name, input, nodeId, ts, tur = {}, ok = true, cwd = 'D:/r') => pt.end(planStart(name, input, { cwd }), { ok, tur, nodeId, ts });

test('PlanTracker: TodoWrite 전이(처리 시각·노드 유지)·Task 만들기/고치기/지우기·ExitPlanMode·실패 무시·node-update 로 냄', () => {
  const { g, T, plans } = tree();
  const pt = new PlanTracker({ graph: g });
  run(pt, 'TodoWrite', { todos: [{ content: '서버', status: 'in_progress' }, { content: '웹', status: 'pending' }] }, 's:m', T(10));
  let p = plans('s:m')[0];
  assert.equal(p.src, 'todo'); assert.deepEqual(p.items.map((x) => x.s), ['in_progress', 'pending']);
  run(pt, 'TodoWrite', { todos: [{ content: '서버', status: 'completed' }, { content: '웹', status: 'in_progress' }, { content: '시험', status: 'pending' }] }, 's:m', T(20));
  p = plans('s:m')[0];
  assert.deepEqual(p.items.map((x) => [x.s, x.at]), [['done', Date.parse(T(20))], ['in_progress', Date.parse(T(20))], ['pending', Date.parse(T(20))]]);
  run(pt, 'TodoWrite', { todos: [{ content: '서버', status: 'completed' }, { content: '웹', status: 'in_progress' }] }, 's:m', T(30));
  p = plans('s:m')[0];
  assert.equal(p.items.length, 2, '빠진 항목은 지움');
  assert.equal(p.items[0].at, Date.parse(T(20)), '상태 그대로면 처리 시각 유지');
  const ups = g.ring.filter((e) => e.type === 'node-update' && e.patch?.meta && 'plans' in e.patch.meta);
  assert.equal(ups.length, 3, '바뀔 때만 node-update');
  run(pt, 'TodoWrite', { todos: [{ content: 'x', status: 'pending' }] }, 's:m', T(31), {}, false);
  assert.equal(plans('s:m')[0].items.length, 2, '실패한 호출은 무시');
  // Task 계열
  run(pt, 'TaskCreate', { subject: '보드 그리기' }, 'a:sub', T(40), { task: { id: '7' } });
  run(pt, 'TaskCreate', { subject: '팝업' }, 'a:sub', T(41), { task: { id: '8' } });
  run(pt, 'TaskUpdate', { taskId: '7', status: 'in_progress' }, 'a:sub', T(42));
  run(pt, 'TaskUpdate', { taskId: '7', status: 'completed' }, 's:m', T(43));
  run(pt, 'TaskUpdate', { taskId: '8', status: 'deleted' }, 'a:sub', T(44));
  const tp = plans('a:sub')[0];
  assert.equal(tp.src, 'tasks');
  assert.deepEqual(tp.items.map((x) => [x.t, x.s, x.by]), [['보드 그리기', 'done', 's:m']], '다른 노드가 고쳐도 같은 목록(주인은 만든 노드)');
  run(pt, 'ExitPlanMode', { plan: '# 계획 보드\n1. 서버 모델\n2. 웹 보드\n3. 시험' }, 's:m', T(50));
  const ep = plans('s:m').find((x) => x.src === 'exitplan');
  assert.equal(ep.title, '계획 보드'); assert.equal(ep.items.length, 3);
  assert.ok(plans('s:m').length <= PLAN.PER_NODE);
});

test('체크박스 md: Write → Edit(기억한 본문에 적용) → 본문 모르는 Edit 은 바뀐 줄만, 주인은 트리 위쪽, 읽기만으로는 안 만듦', () => {
  const { g, T, plans } = tree();
  const pt = new PlanTracker({ graph: g });
  run(pt, 'Read', { file_path: 'D:/r/notes/todo-list.md' }, 's:m', T(5), { file: { content: '- [ ] a\n- [ ] b', numLines: 2, startLine: 1, totalLines: 2 } });
  assert.equal(plans('s:m'), undefined, '읽기만으로는 계획을 만들지 않음');
  run(pt, 'Write', { file_path: 'D:/r/work/_STATUS.md', content: '# 작업\n## 남은 작업\n- [ ] 서버\n- [ ] 웹\n- [ ] 시험' }, 'a:sub', T(10));
  assert.equal(plans('a:sub')[0].title, 'work/_STATUS.md');
  run(pt, 'Edit', { file_path: 'D:/r/work/_STATUS.md', old_string: '- [ ] 서버', new_string: '- [x] 서버' }, 's:m', T(20));
  assert.equal(plans('a:sub'), null, '메인이 만지면 메인 계획으로 옮김(트리 위쪽)');
  let p = plans('s:m')[0];
  assert.deepEqual(p.items.map((x) => x.s), ['done', 'pending', 'pending']);
  assert.equal(p.items[0].by, 's:m');
  pt.docs.clear(); // 본문을 모름(긴 세션 LRU 밀림 등)
  run(pt, 'Edit', { file_path: 'D:/r/work/_STATUS.md', old_string: '- [ ] 웹', new_string: '- [x] 웹\n- [ ] 문서' }, 's:m', T(30));
  p = plans('s:m')[0];
  assert.deepEqual(p.items.map((x) => [x.t, x.s]), [['서버', 'done'], ['웹', 'done'], ['시험', 'pending'], ['문서', 'pending']]);
  run(pt, 'Write', { file_path: 'D:/r/work/_STATUS.md', content: '체크박스 없음' }, 's:m', T(40));
  assert.equal(plans('s:m'), null, '체크박스가 없어지면 계획도 없앰');
});

test('러너: 회차가 읽은 단계 설계서 = 러너의 계획, 항목마다 처리 회차, 셸 grep 으로 상태 갱신, 늦게 읽힌 옛 관찰은 새 상태를 못 덮음', () => {
  const { g, T, plans } = tree();
  const pt = new PlanTracker({ graph: g });
  const F = 'D:/r/docs/plans/2026-10-24-x-execution-design.md';
  run(pt, 'Read', { file_path: F }, 's:c2', T(100), { file: { content: DESIGN(['◑ 미착지', '◑ 미착지', '◑ 미착지']), numLines: 9, startLine: 1, totalLines: 9 } });
  let p = plans('b:L-r1')[0];
  assert.equal(p.src, 'phases'); assert.equal(p.cy, 2); assert.equal(p.by, 's:c2');
  run(pt, 'Edit', { file_path: F, old_string: '**단계 0 상태**: ◑ 미착지', new_string: '**단계 0 상태**: ✅ **닫힘**' }, 's:c2', T(110));
  // 회차 3: 기억한 본문은 회차 2 것이라 쓰지 않고, grep 으로 본 표식 + 회차 안 서브에이전트의 Edit
  run(pt, 'Bash', { command: "grep -n '단계 . 상태' docs/plans/2026-10-24-x-execution-design.md" }, 's:c3', T(200), { stdout: '4:**단계 0 상태**: ✅ **닫힘**\n6:**단계 1 상태**: ✅ **닫힘**\n8:**단계 2 상태**: ◑ 미착지' }, true, 'D:/r');
  run(pt, 'Edit', { file_path: F, old_string: '**단계 2 상태**: ◑ 미착지', new_string: '**단계 2 상태**: ✅ **닫힘**' }, 'a:c3sub', T(220));
  p = plans('b:L-r1')[0];
  assert.deepEqual(p.items.map((x) => [x.t, x.s, x.cy]), [['단계 0 — 재측정', 'done', 2], ['단계 1 — ADR · 배선', 'done', 3], ['단계 2 — 배포', 'done', 3]]);
  assert.equal(p.items[2].by, 's:c3', '회차 안 서브에이전트가 고쳐도 처리 회차는 그 회차');
  assert.equal(p.cy, 3);
  // 메인(감독)이 나중에 옛 본문 사본을 읽은 기록이 늦게 처리됨(시각은 앞) → 새 상태 유지, 주인도 러너 그대로
  run(pt, 'Read', { file_path: F }, 's:m', T(150), { file: { content: DESIGN(['✅', '◑ 미착지', '◑ 미착지']), numLines: 9, startLine: 1, totalLines: 9 } });
  p = plans('b:L-r1')[0];
  assert.deepEqual(p.items.map((x) => x.s), ['done', 'done', 'done']);
  assert.equal(plans('s:m'), undefined);
  // 낸 시각은 줄지 않음(재생 정렬 뒤에도 마지막 계산이 마지막)
  const ts = g.ring.filter((e) => e.nodeId === 'b:L-r1' && e.patch?.meta?.plans !== undefined).map((e) => Date.parse(e.ts));
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
});

test('Workflow: meta.phases → 단계, 에이전트가 들어간 단계까지 완료·지금 단계 진행, 끝나면 모두 완료(순서 무관)', () => {
  const { g, T, plans } = tree();
  g.addNode({ id: 'w:run1', parentId: 's:m', kind: 'workflow', label: 'viz-build' }, T(1));
  const pt = new PlanTracker({ graph: g });
  pt.workflowPhase('w:run1', 'Build', T(30)); // 저널이 Workflow 결과보다 먼저 읽힘
  pt.workflowDefine('w:run1', ['Design', 'Build', 'Verify'], T(10));
  assert.deepEqual(plans('w:run1')[0].items.map((x) => x.s), ['done', 'in_progress', 'pending']);
  pt.workflowPhase('w:run1', 'design', T(12));
  assert.deepEqual(plans('w:run1')[0].items.map((x) => x.s), ['done', 'in_progress', 'pending']);
  pt.workflowEnd('w:run1', true, T(90));
  assert.deepEqual(plans('w:run1')[0].items.map((x) => x.s), ['done', 'done', 'done']);
  assert.equal(plans('w:run1')[0].title, 'viz-build');
});

test('minimal: 글·제목 없이 상태·수만, 비밀은 마스킹', () => {
  const { g, T } = tree('minimal');
  const pt = new PlanTracker({ graph: g });
  run(pt, 'TodoWrite', { todos: [{ content: 'sk-ant-api03-SECRETSECRETSECRET 넣기', status: 'pending' }, { content: 'b', status: 'completed' }] }, 's:m', T(10));
  const p = g.get('s:m').meta.plans[0];
  assert.deepEqual(p.items.map((x) => [x.t, x.s]), [['', 'pending'], ['', 'done']]);
  assert.equal(p.title, '');
});

test('라이브 = 재생: 합성 transcript(TodoWrite·체크박스 md·ExitPlanMode·실패 Edit) → 같은 최종 meta.plans', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-plan-'));
  const prevTmp = process.env.CCVIZ_CLAUDE_TMP;
  try {
    const cwd = 'D:/work/planp';
    const enc = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
    const SID = 'ffffffff-5555-4555-8555-ffffffffffff';
    const projects = path.join(root, 'projects'), sessions = path.join(root, 'sessions');
    const proj = path.join(projects, enc(cwd));
    for (const d of [proj, sessions]) fs.mkdirSync(d, { recursive: true });
    process.env.CCVIZ_CLAUDE_TMP = path.join(root, 'tmp');
    const P = Date.now() - 2 * 86400_000, T = (s) => new Date(P + s * 1000).toISOString();
    const base = { sessionId: SID, cwd, version: '2.1.309', entrypoint: 'cli' };
    const A = (s, id, name, input) => ({ type: 'assistant', timestamp: T(s), ...base, message: { model: 'm', role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
    const R = (s, id, tur, err = false) => ({ type: 'user', timestamp: T(s), ...base, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: err }] }, toolUseResult: tur });
    const recs = [
      { type: 'user', timestamp: T(0), ...base, origin: { kind: 'human' }, promptSource: 'user', message: { role: 'user', content: '계획 시험' } },
      A(1, 't1', 'TodoWrite', { todos: [{ content: '모델', status: 'in_progress', activeForm: '모델 만드는 중' }, { content: '보드', status: 'pending' }] }), R(2, 't1', {}),
      A(3, 'w1', 'Write', { file_path: 'D:/work/planp/PLAN.md', content: '# 계획\n- [ ] 서버\n- [ ] 웹' }), R(4, 'w1', { type: 'create' }),
      A(5, 'e1', 'Edit', { file_path: 'PLAN.md', old_string: '- [ ] 서버', new_string: '- [x] 서버' }), R(6, 'e1', { structuredPatch: [] }),
      A(7, 'e2', 'Edit', { file_path: 'PLAN.md', old_string: '- [ ] 웹', new_string: '- [x] 웹' }), R(8, 'e2', null, true),
      A(9, 't2', 'TodoWrite', { todos: [{ content: '모델', status: 'completed' }, { content: '보드', status: 'in_progress' }] }), R(10, 't2', {}),
      A(11, 'x1', 'ExitPlanMode', { plan: '# 다음\n1. 시험\n2. 문서' }), R(12, 'x1', {}),
      { type: 'system', subtype: 'turn_duration', durationMs: 1000, timestamp: T(20), ...base },
    ];
    fs.writeFileSync(path.join(proj, `${SID}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const old = (P + 60_000) / 1000;
    fs.utimesSync(path.join(proj, `${SID}.jsonl`), old, old);
    const index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
    await index.refresh();
    for (const e of index.entries.values()) e.birthtimeMs = e.mtimeMs;
    const rt = new RootRuntime({ sessionId: SID, index });
    await rt.start(); rt.close();
    const live = rt.graph.get(`s:${SID}`).meta.plans;
    const data = await buildReplay({ sessionId: SID, index });
    let rep;
    for (const x of data.events) { const e = x.e || x; if (e.nodeId === `s:${SID}` && e.type === 'node-update' && e.patch?.meta && 'plans' in e.patch.meta) rep = e.patch.meta.plans; }
    const sig = (pl) => pl.map((p) => [p.src, p.title, p.items.map((i) => [i.t, i.s, i.at])]).sort();
    assert.deepEqual(sig(rep), sig(live));
    const byS = Object.fromEntries(live.map((p) => [p.src, p]));
    assert.deepEqual(byS.todo.items.map((i) => [i.t, i.s]), [['모델', 'done'], ['보드', 'in_progress']]);
    assert.deepEqual(byS.file.items.map((i) => [i.t, i.s]), [['서버', 'done'], ['웹', 'pending']], '실패한 Edit 은 반영 안 함');
    assert.equal(byS.file.title, 'planp/PLAN.md');
    assert.deepEqual(byS.exitplan.items.map((i) => i.t), ['시험', '문서']);
  } finally {
    if (prevTmp == null) delete process.env.CCVIZ_CLAUDE_TMP; else process.env.CCVIZ_CLAUDE_TMP = prevTmp;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});

test('러너 실구조(합성 레포): 재기동기 → 러너 → 회차 Read·Edit → 러너 meta.plans + 회차 번호, 라이브·재생 같음', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-planrun-'));
  try {
    const M = 'b8b8b8b8-8888-4888-8888-888888888888';
    const E = [0, 1].map((i) => `f${i}f${i}f${i}f${i}-0000-4000-8000-00000000000${i}`);
    const enc = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
    const projects = path.join(root, 'projects');
    fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
    const repo = path.join(root, 'repo');
    fs.mkdirSync(path.join(repo, '.loop'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.loop', 'relaunch.sh'), '#!/usr/bin/env bash\nnohup bash scripts/runner.sh >> r.out 2>&1 < /dev/null &\n');
    fs.writeFileSync(path.join(repo, 'scripts', 'runner.sh'), '#!/usr/bin/env bash\nfor i in 1 2; do cat p.md | claude -p --output-format json > o.json; done\n');
    const now = Date.now();
    const T = (sec) => new Date(now - 3000_000 + sec * 1000).toISOString();
    const base = (sid, ep = 'cli') => ({ sessionId: sid, cwd: repo, version: '2.1.309', entrypoint: ep });
    const pdir = path.join(projects, enc(repo));
    const write = (sid, recs) => { fs.mkdirSync(pdir, { recursive: true }); fs.writeFileSync(path.join(pdir, `${sid}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); };
    write(M, [
      { type: 'user', timestamp: T(1), ...base(M), message: { role: 'user', content: '루프를 띄운다' } },
      { type: 'assistant', timestamp: T(10), ...base(M), message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'toolu_rl', name: 'Bash', input: { command: 'nohup bash .loop/relaunch.sh > /dev/null 2>&1 &' } }] } },
      { type: 'user', timestamp: T(11), ...base(M), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_rl', content: '' }] }, toolUseResult: { stdout: '' } },
      { type: 'assistant', timestamp: T(2900), ...base(M), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '감독 중' }] } },
    ]);
    const F = path.join(repo, 'docs', 'plans', 'axis-execution-design.md');
    const A = (sid, s, id, name, input) => ({ type: 'assistant', timestamp: T(s), ...base(sid, 'sdk-cli'), message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id, name, input }] } });
    const R = (sid, s, id, tur) => ({ type: 'user', timestamp: T(s), ...base(sid, 'sdk-cli'), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, toolUseResult: tur });
    [[100, ['◑ 미착지', '◑ 미착지', '◑ 미착지'], 0], [300, ['✅ 닫힘', '◑ 미착지', '◑ 미착지'], 1]].forEach(([sec, st, i]) => {
      const sid = E[i];
      write(sid, [
        { type: 'user', timestamp: T(sec), ...base(sid, 'sdk-cli'), promptSource: 'sdk', message: { role: 'user', content: `자율 사이클 ${i + 1}회 — 축 A\n\n본문` } },
        A(sid, sec + 5, `r${i}`, 'Read', { file_path: F }), R(sid, sec + 6, `r${i}`, { type: 'text', file: { filePath: F, content: DESIGN(st), numLines: 9, startLine: 1, totalLines: 9 } }),
        A(sid, sec + 50, `e${i}`, 'Edit', { file_path: F, old_string: `**단계 ${i} 상태**: ◑ 미착지`, new_string: `**단계 ${i} 상태**: ✅ 닫힘` }), R(sid, sec + 51, `e${i}`, { filePath: F }),
        { type: 'assistant', timestamp: T(sec + 100), ...base(sid, 'sdk-cli'), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '끝' }] } },
      ]);
      fs.utimesSync(path.join(pdir, `${sid}.jsonl`), new Date(Date.parse(T(sec + 100))), new Date(Date.parse(T(sec + 100))));
    });
    fs.utimesSync(path.join(pdir, `${M}.jsonl`), new Date(Date.parse(T(2900))), new Date(Date.parse(T(2900))));
    const index = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'sessions') });
    const results = [];
    for (const offline of [false, true]) {
      await index.refresh();
      index.claimedChildren.clear();
      index.launchers = new LauncherIndex(index, { bootMs: 0 });
      const rt = new RootRuntime({ sessionId: M, index, offline });
      try {
        if (offline) await rt.loadOffline();
        else { await rt.start(); for (let k = 0; k < 20 && !rt.graph.get(`s:${E[1]}`); k++) { await rt.scanAll(); await new Promise((r) => setTimeout(r, 50)); } rt.sweep(); }
        const runner = [...rt.graph.nodes.values()].find((n) => n.meta?.runner);
        assert.ok(runner, '러너 노드');
        const pl = runner.meta.plans;
        assert.ok(pl && pl.length === 1, '러너가 단계 설계서 계획을 가짐');
        results.push(pl[0]);
        assert.equal(rt.graph.get(`s:${E[1]}`).meta.plans, undefined, '회차 노드에는 없음(러너 쪽)');
      } finally { rt.close(); }
    }
    for (const p of results) {
      assert.equal(p.src, 'phases');
      assert.deepEqual(p.items.map((x) => [x.s, x.cy ?? null]), [['done', 1], ['done', 2], ['pending', null]]);
    }
    assert.deepEqual(results[0].items.map((x) => [x.t, x.s, x.at]), results[1].items.map((x) => [x.t, x.s, x.at]), '라이브·재생 같은 답');
  } finally { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} }
});

test('데모: 실제 PlanTracker 로 메인 할 일·워크플로 단계(진행 중 Build)를 내고 걸음마다 한 칸씩', async () => {
  const { planDemoSeed, planDemoStep, PLAN_DEMO_TODOS } = await import('../plan-demo.mjs');
  const g = new Graph({ rootSessionId: 'demo', keepAll: true, localSeq: true });
  g.addNode({ id: 's:demo', kind: 'main', label: '데모' });
  g.addNode({ id: 'w:wf_demo-001', parentId: 's:demo', kind: 'workflow', label: '빌드' });
  const rt = { graph: g, sessionId: 'demo', N: (id) => id };
  planDemoSeed(rt);
  assert.deepEqual(g.get('w:wf_demo-001').meta.plans[0].items.map((x) => x.s), ['done', 'in_progress', 'pending', 'pending']);
  let todo = g.get('s:demo').meta.plans[0];
  assert.equal(todo.items.length, PLAN_DEMO_TODOS.length);
  assert.equal(todo.items.filter((x) => x.s !== 'pending').length, 0);
  planDemoStep(rt); planDemoStep(rt); planDemoStep(rt);
  todo = g.get('s:demo').meta.plans[0];
  assert.deepEqual(todo.items.slice(0, 2).map((x) => x.s), ['done', 'in_progress']);
});
