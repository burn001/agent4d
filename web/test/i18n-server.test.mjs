// 서버 문구 번역기: 실제 서버 템플릿 함수가 ASCII 입력으로 만든 문구를 영어로 바꾸면 한글이 남지 않음,
// 한국어에선 원문 그대로, 모르는 문구·데이터는 그대로.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _setLangForTest } from '../i18n.mjs';
import { localizeServerText, localizeLine, localizePanel, localizeEvent, localizeSnapshot, localizeNode, localizePlans, localizeArt, localizeArtifacts, localizeProjects, localizeTimeline } from '../i18n-server.mjs';
import { toolBrief, resultBrief } from '../../server/brief.mjs';
import { inputPanel, resultPanel, progressPanel, tailPanel, sanitizePanel } from '../../server/panel.mjs';
import { mainRoleLabel, claudePLabel } from '../../server/session.mjs';
import { parsePlanMarkdown, PlanTracker, planStart } from '../../server/plans.mjs';
import { Graph } from '../../server/graph.mjs';
import { artStart } from '../../server/artifacts.mjs';

const HANGUL = /[\uAC00-\uD7A3]/;
const en = (fn) => { _setLangForTest('en'); try { return fn(); } finally { _setLangForTest('ko'); } };
const clone = (x) => JSON.parse(JSON.stringify(x));

// 도구 입력·결과(ASCII 데이터) → 서버가 만든 요약
const BRIEFS = () => {
  const out = [];
  const ib = (n, i) => { const b = toolBrief(n, i); out.push(b.brief, b.detail); };
  ib('Bash', { command: 'npm test', description: 'run tests', run_in_background: true });
  ib('Read', { file_path: 'D:/r/src/app.js', offset: 10, limit: 20 });
  ib('Read', { file_path: 'D:/r/src/app.js', limit: 20 });
  ib('Read', { file_path: 'D:/r/doc.pdf', pages: '1-5' });
  ib('Edit', { file_path: 'D:/r/src/app.js', old_string: 'a', new_string: 'a\nb', replace_all: true });
  ib('MultiEdit', { file_path: 'D:/r/src/app.js', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] });
  ib('Write', { file_path: 'D:/r/notes.md', content: 'x\ny\nz' });
  ib('Agent', { description: 'explore', subagent_type: 'Explore', run_in_background: true });
  ib('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] });
  const rb = (...a) => out.push(resultBrief(...a));
  rb('Bash', { backgroundTaskId: 'b123' }, '', true);
  rb('Bash', { stdout: 'ok 3', interrupted: true }, '', true);
  rb('Grep', { numFiles: 3, mode: 'content', numLines: 12 }, '', true);
  rb('Grep', { numFiles: 3, mode: 'count', numMatches: 7 }, '', true);
  rb('Grep', { numFiles: 3, mode: 'files_with_matches' }, '', true);
  rb('Glob', { numFiles: 100, truncated: true }, '', true);
  rb('Read', { file: { numLines: 40, totalLines: 300 } }, '', true);
  rb('Write', { type: 'create', structuredPatch: [{ lines: ['+a', '+b'] }] }, '', true);
  rb('WebSearch', { results: [{}, {}] }, '', true);
  rb('Agent', { totalToolUseCount: 12, totalDurationMs: 34000 }, '', true);
  rb('Agent', { isAsync: true }, '', true);
  rb('Skill', { commandName: 'pdf' }, '', true);
  rb('TaskStop', null, '', true);
  rb('WebFetch', null, 'boom', false);
  return out.filter(Boolean);
};

const PANELS = () => {
  const ps = [
    inputPanel('Read', { file_path: 'D:/r/a.js', offset: 5, limit: 9 }),
    inputPanel('Edit', { file_path: 'D:/r/a.js', old_string: 'a', new_string: 'b', replace_all: true }),
    inputPanel('Agent', { description: 'x', subagent_type: 'Explore', run_in_background: true, prompt: 'look around' }),
    inputPanel('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress', activeForm: 'doing b' }] }),
    resultPanel('Bash', { command: 'npm test' }, { backgroundTaskId: 'b9' }, '', null, true),
    resultPanel('Bash', { command: 'npm test' }, { stdout: 'ok', interrupted: true }, '', null, true),
    resultPanel('Read', { file_path: 'D:/r/a.js' }, { file: { content: 'a\nb', numLines: 2, startLine: 3, totalLines: 50 } }, '', null, true),
    resultPanel('Read', { file_path: 'D:/r/.env' }, null, 'K=V', null, true),
    resultPanel('Read', { file_path: 'D:/r/a.png' }, { type: 'image' }, '', null, true),
    resultPanel('Grep', { pattern: 'x' }, { mode: 'count', numMatches: 4, content: 'a:1' }, '', null, true),
    resultPanel('Glob', { pattern: '*.js' }, { filenames: ['a.js'], numFiles: 1 }, '', null, true),
    resultPanel('Agent', { description: 'x' }, { isAsync: true }, '', null, true),
    resultPanel('Agent', { description: 'x' }, { content: [{ text: 'done it' }], totalToolUseCount: 3, totalDurationMs: 5000 }, '', null, true),
    progressPanel({ title: 'x', prompt: 'go', tools: 4, texts: 2, recent: ['Read a.js'] }, { nodeId: 'a:1' }),
    progressPanel({ title: 'x', prompt: 'go', tools: 4, texts: 0, recent: [], result: ['완료'] }, { nodeId: 'a:1' }),
    tailPanel('$ tail', ['x'], { nodeId: 'b:1' }, { secret: true }),
    { mode: 'generic', part: 'result', title: 'x', lines: ['\ufffd\ufffd\ufffd\ufffd\x85\x86\x87 abc'], marks: 'o' },
  ];
  return ps.map((p) => sanitizePanel(p));
};

test('영어: 서버 도구 요약(brief·detail)에 한글이 남지 않음, 데이터는 그대로', () => {
  const src = BRIEFS();
  assert.ok(src.some((s) => HANGUL.test(s)), '서버 원문은 한국어 템플릿');
  const out = en(() => src.map(localizeServerText));
  for (const [i, s] of out.entries()) assert.ok(!HANGUL.test(s), `남은 한글: ${src[i]} → ${s}`);
  const has = (s) => out.includes(s);
  assert.ok(has('read 40 lines / 300'));
  assert.ok(has('12 matching lines') && has('7 matches') && has('3 files') && has('100 files+'));
  assert.ok(has('background b123') && has('started in background') && has('stopped') && has('loaded pdf'));
  assert.ok(has('12 tool calls · 34s') && has('new file +2 −0') && has('2 result sets'));
  assert.ok(has('from line 10, 20 lines') && has('from start, 20 lines') && has('pages 1-5'));
  assert.ok(has('app.js +2 −1 (all)') && has('notes.md 3 lines') && has('2 edits · r/src/app.js'));
  assert.ok(has('run tests · background') && has('Explore · background'));
  assert.ok(has('2 to-dos') && has('done 1/2') && has('failed · boom'));
  assert.ok(out.some((s) => /^exit 0 · interrupted · ok 3$/.test(s)));
});

test('영어: 패널 제목·장식 줄·서버가 통째로 만든 줄에 한글이 남지 않음', () => {
  const ps = PANELS();
  const out = en(() => ps.map((p) => localizePanel(clone(p))));
  for (const p of out) {
    assert.ok(!HANGUL.test(p.title || ''), p.title);
    for (const l of p.lines) assert.ok(!HANGUL.test(l), `남은 한글: ${l}`);
  }
  const lines = out.flatMap((p) => p.lines);
  assert.ok(lines.includes('lines 3–4 / 50'));
  assert.ok(lines.includes('[secret path — content omitted]') && lines.includes('[image — content omitted]') && lines.includes('[binary line omitted]'));
  assert.ok(lines.includes('progress · 4 tool calls · 2 messages'));
  assert.ok(out.some((p) => p.title === 'To-dos 1/2'));
  assert.ok(lines.includes('[>] doing b'), '할 일 글은 데이터');
});

test('영어: 노드 라벨(메인·임시·기동기·claude -p)·계획 제목·작업 대상', () => {
  const main = mainRoleLabel('D:\\r\\proj', null);
  const tmpLabel = claudePLabel('12345678-aaaa-4bbb-8ccc-1234567890ab', { path: 'C:\\x\\y', temp: true });
  const labels = ['메인', main, '메인 · (임시) scratch', '기동기 · relaunch.sh', '러너 · autopilot.sh', tmpLabel];
  const out = en(() => labels.map(localizeServerText));
  for (const s of out) assert.ok(!HANGUL.test(s), s);
  assert.equal(out[0], 'Main');
  assert.match(out[1], /^Main · .*proj$/);
  assert.equal(out[2], 'Main · (temp) scratch');
  assert.equal(out[3], 'Launcher · relaunch.sh');

  // 계획: 실제 PlanTracker(Graph) 가 낸 meta.plans
  const g = new Graph({ rootSessionId: 'm', keepAll: true, localSeq: true });
  const T = (s) => new Date(Date.UTC(2026, 9, 24, 0, 0, s)).toISOString();
  g.addNode({ id: 's:m', kind: 'main', label: mainRoleLabel('D:\\r\\proj') }, T(0));
  const pt = new PlanTracker({ graph: g });
  const run = (name, input, ts, tur = {}) => pt.end(planStart(name, input), { ok: true, tur, nodeId: 's:m', ts });
  run('TodoWrite', { todos: [{ content: 'server', status: 'in_progress' }, { content: 'web', status: 'pending' }] }, T(1));
  run('TaskCreate', { subject: '' }, T(2), { task: { id: '7' } });
  const plans = clone(g.get('s:m').meta.plans);
  assert.ok(plans.some((p) => p.title === '할 일') && plans.some((p) => p.title === '작업 목록'));
  en(() => localizePlans(plans));
  assert.ok(plans.some((p) => p.title === 'To-dos') && plans.some((p) => p.title === 'Tasks'));
  assert.ok(plans.flatMap((p) => p.items).some((it) => it.t === 'Task 7'));
  assert.ok(plans.flatMap((p) => p.items).some((it) => it.t === 'server'), '할 일 글은 데이터');
  for (const p of plans) { assert.ok(!HANGUL.test(p.title)); for (const it of p.items) assert.ok(!HANGUL.test(it.t)); }
  const ph = parsePlanMarkdown('# x\n### 단계 1 — Deploy\n**단계 1 상태**: ✅ done\n### 단계 2 — Verify\n**단계 2 상태**: pending\n');
  const pp = [{ title: 'x', items: clone(ph.items) }];
  en(() => localizePlans(pp));
  assert.deepEqual(pp[0].items.map((x) => x.t), ['Phase 1 — Deploy', 'Phase 2 — Verify']);

  const art = clone(artStart('Artifact', { action: 'publish', title: 'report' }).concat(artStart('Bash', { command: 'node regsearch.mjs q' })));
  assert.ok(art.some((r) => r.d === '산출물'));
  en(() => localizeArt(art));
  for (const r of art) assert.ok(!HANGUL.test(`${r.n} ${r.d || ''}`), JSON.stringify(r)); // id 는 열쇠(표시 안 함)
});

test('영어: 이벤트·스냅샷·타임라인·/artifacts·/projects 필드를 제자리에서', () => {
  const panel = sanitizePanel(resultPanel('Read', { file_path: 'D:/r/a.js' }, { file: { content: 'a', numLines: 1, startLine: 1, totalLines: 9 } }, '', null, true));
  const ev = { type: 'tool-end', nodeId: 's:m', brief: resultBrief('Read', { file: { numLines: 1, totalLines: 9 } }, '', true), panel,
    art: [{ k: 'output', id: 'artifact:r', n: 'r', d: '산출물' }] };
  const add = { type: 'node-add', nodeId: 's:x', node: { id: 's:x', label: '메인 · (임시) t', meta: {}, openTools: [{ brief: '3개 파일', panel: clone(panel) }] } };
  const upd = { type: 'node-update', nodeId: 's:m', patch: { label: '기동기 · go.sh', meta: { plans: [{ title: '할 일', items: [{ t: 'write tests' }] }] } } };
  const usr = { type: 'user', nodeId: 's:m', origin: 'task-notification', text: '이벤트: build done' };
  const img = { type: 'user', nodeId: 's:m', origin: 'human', text: 'see [이미지] 이것 좀' };
  en(() => { for (const e of [ev, add, upd, usr, img]) localizeEvent(e); });
  assert.equal(ev.brief, 'read 1 line / 9');
  assert.ok(!HANGUL.test(JSON.stringify(ev)) && !HANGUL.test(JSON.stringify(add)) && !HANGUL.test(JSON.stringify(upd)) && !HANGUL.test(usr.text));
  assert.equal(img.text, 'see [image] 이것 좀', '사람이 쓴 글은 그대로, 서버 꼬리표만');

  const snap = { root: 's:m', nodes: [{ id: 's:m', label: '메인', meta: {}, openTools: [] }], recent: [{ type: 'tool-end', brief: '중지함' }], projects: [{ projectId: 'p', name: '(임시) scratch' }] };
  en(() => localizeSnapshot(snap));
  assert.equal(snap.nodes[0].label, 'Main');
  assert.equal(snap.recent[0].brief, 'stopped');
  assert.equal(snap.projects[0].name, '(temp) scratch');
  const tl = { nodes: [{ id: 's:m', label: '메인 · proj' }] };
  en(() => localizeTimeline(tl));
  assert.equal(tl.nodes[0].label, 'Main · proj');
  const body = { items: [{ k: 'service', id: 'svc:x', n: '사내 규정' }], nodes: { 's:m': '메인 · title' } };
  en(() => localizeArtifacts(body));
  assert.equal(body.nodes['s:m'], 'Main · title');
  assert.equal(body.items[0].n, 'Internal regulations');
  const pr = { projects: [{ name: '(임시) a' }, { name: 'b' }] };
  en(() => localizeProjects(pr));
  assert.deepEqual(pr.projects.map((p) => p.name), ['(temp) a', 'b']);
  // 노드 하나
  const n = en(() => localizeNode({ id: 'b', label: '러너 · r.sh', meta: {} }));
  assert.equal(n.label, 'Runner · r.sh');
});

test('한국어: 원문 그대로(같은 객체·같은 문자열)', () => {
  for (const s of BRIEFS()) assert.equal(localizeServerText(s), s);
  const ps = PANELS();
  for (const p of ps) assert.deepEqual(localizePanel(clone(p)), p);
  const ev = { type: 'node-add', node: { label: '메인 · (임시) x', meta: { plans: [{ title: '할 일', items: [{ t: '작업 3' }] }] }, openTools: [] } };
  const before = clone(ev);
  assert.equal(localizeEvent(ev), ev);
  assert.deepEqual(ev, before);
});

test('모르는 문구·데이터는 그대로, 두 번 돌려도 같음', () => {
  en(() => {
    for (const s of ['안녕하세요', '파일 구조를 먼저 확인하겠습니다.', 'npm test', '', '오류: 파일을 찾을 수 없음', '서브에이전트 대량 분기', 'grep "할 일" docs']) assert.equal(localizeServerText(s), s);
    assert.equal(localizeLine('3개 파일'), '3개 파일', '데이터 줄에는 조각 규칙을 쓰지 않음');
    assert.equal(localizeServerText(null), null);
    assert.equal(localizeServerText(42), 42);
    const once = localizeServerText('exit 1 · 중단됨 · 실패');
    assert.equal(once, 'exit 1 · interrupted · failed');
    assert.equal(localizeServerText(once), once);
    // 계획 문서 제목·항목 글(데이터)은 그대로
    const pp = [{ title: '배포 계획', items: [{ t: '서버 고치기' }, { t: '작업 3개 남음' }] }];
    localizePlans(pp);
    assert.deepEqual(pp, [{ title: '배포 계획', items: [{ t: '서버 고치기' }, { t: '작업 3개 남음' }] }]);
    assert.equal(localizeEvent(null), null);
    assert.equal(localizeSnapshot(undefined), undefined);
  });
});
