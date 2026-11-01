// 범위·표시 고르기 밖 노드는 카메라 대상이 아니다 — 숨긴 다른 프로젝트 메인에 사람 입력이 와도 카메라가 허공으로 가지 않음
// 재현: ?mock=1&scope=project:demo-alpha&prompts=4000 (overview mock 이 프로젝트를 돌아가며 메인에 사람 입력)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { camVisible, fxShown } from '../camera-core.mjs';
import { createOverviewMock } from '../overview/mock.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const V = (o = {}) => ({ node: { id: 'x', rootSessionId: 'S1', ...(o.node || {}) }, ...o });

test('camVisible: 보이는가 + 범위(세션·프로젝트·전체) + §99 숨긴 세션', () => {
  assert.equal(camVisible(V()), true);
  for (const k of ['hidden', 'gone', 'projOut']) assert.equal(camVisible(V({ [k]: true })), false, k);
  assert.equal(camVisible(V({ exiting: 0.2 })), false, '퇴장 중');
  assert.equal(camVisible(V({ scopeK: 0.3 })), false, '희미');
  assert.equal(camVisible(V(), { dim: true }), false, '복셀 나가는 프로젝트(_isOut)');
  assert.equal(camVisible(null), false);
  const all = { mode: 'all', focusProject: null, focusSession: null };
  assert.equal(camVisible(V(), { scope: all, pid: 'P' }), true);
  assert.equal(camVisible(V(), { scope: all, pid: null }), false, '전체 보기 = 섬이 있는 노드만');
  assert.equal(camVisible(V(), { scope: { ...all, focusProject: 'P' }, pid: 'P' }), true);
  assert.equal(camVisible(V(), { scope: { ...all, focusProject: 'P' }, pid: 'Q' }), false, '다른 프로젝트');
  assert.equal(camVisible(V(), { scope: { ...all, focusSession: 'S1' }, pid: 'Q' }), true, '세션 선택 = 그 트리');
  assert.equal(camVisible(V(), { scope: { ...all, focusSession: 'S2' }, pid: 'P' }), false);
  assert.equal(camVisible(V(), { scope: { mode: 'session' }, pid: null }), true, '단일 세션 스트림은 범위 없음');
  assert.equal(camVisible(V(), { hide: new Set(['s:S1']) }), false, '표시 고르기로 숨긴 세션');
  assert.equal(camVisible(V(), { hide: new Set(['s:S9']) }), true);
});

test('fxShown: 숨김·끝남·나가는 프로젝트 노드엔 연출 없음', () => {
  assert.equal(fxShown(V()), true);
  assert.equal(fxShown(V({ scopeK: 0.35 })), true, 'recent 고정 희미는 그대로');
  for (const k of ['hidden', 'gone', 'projOut']) assert.equal(fxShown(V({ [k]: true })), false, k);
  assert.equal(fxShown(undefined), false);
});

/** overview mock 스냅샷 → 2D 디렉터(3D camera.js 와 같은 _visibleId 규칙) */
async function scenario() {
  globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
  const { Director2D } = await import('../flat/camera2d.js');
  const m = createOverviewMock({ projects: 4, mainsPerProject: [2, 1, 0, 1], seed: 2026 });
  const snap = m.snapshot();
  const vis = new Map();
  let i = 0;
  for (const n of snap.nodes) { const x = (i++ % 10) * 20, z = Math.floor(i / 10) * 20; vis.set(n.id, { id: n.id, node: n, target: { x, y: 0, z }, pos: { x, y: 0, z }, r: 1, icons: { size: 0 } }); }
  const canvas = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  const view = {
    vis, canvas, W: 800, H: 600, cam: { x: 0, z: 0, D: 30 }, invalidate() {}, has: (id) => vis.has(id), children: () => [], parentOf: new Map(),
    nodeCluster: (id) => (vis.get(id) ? vis.get(id).node.projectId : null), clusters: () => [], clock: () => Date.now(), pf: { hide: new Set() },
  };
  const d = new Director2D(view, (id) => vis.get(id) && vis.get(id).node);
  return { d, m, vis, view };
}

test('재현: 프로젝트 하나 선택 중 다른 프로젝트 메인에 사람 입력 → 카메라 그대로, 선택한 프로젝트 메인이면 그 메인으로', async () => {
  const { d, m, vis } = await scenario();
  d.setScope({ mode: 'all', focusProject: 'demo-alpha' });
  // 렌더러가 하는 것처럼 다른 프로젝트는 나가는(projOut) 상태 — 페이드가 끝나 hidden 이 되기 전에도 막아야 한다
  for (const v of vis.values()) if (v.node.projectId !== 'demo-alpha') v.projOut = true;
  const before = JSON.stringify(d.shot);
  const other = m.promptEvent('demo-beta');
  assert.ok(other && other.type === 'user' && other.origin === 'human' && other.projectId === 'demo-beta');
  assert.equal(d.promptFocus(other.nodeId), 0, '숨긴 프로젝트 메인으로 날아가지 않음');
  assert.equal(d.prompt == null, true);
  assert.equal(JSON.stringify(d.shot), before);
  // projOut 표시가 없어도(범위 판정만으로) 막힘
  for (const v of vis.values()) v.projOut = false;
  assert.equal(d.promptFocus(m.promptEvent('demo-delta').nodeId), 0, '범위 밖');
  const mine = m.promptEvent('demo-alpha');
  assert.ok(d.promptFocus(mine.nodeId) > 0, '선택한 프로젝트 메인은 Follow my prompts 그대로');
  assert.equal(d.shot.id, mine.nodeId);
  // 비추는 중에 다른 프로젝트로 범위를 바꾸면 그 프레임에 입력 비추기를 놓는다
  d.setScope({ mode: 'all', focusProject: 'demo-beta' });
  assert.equal(d._promptStep(performance.now() / 1000), false);
  assert.equal(d.prompt, null);
});

test('재현: 단일 세션 범위·§99 숨긴 세션도 같은 원칙', async () => {
  const { d, m, view } = await scenario();
  const a0 = m.promptEvent('demo-alpha'); // p0m0
  d.setScope({ mode: 'all', focusSession: a0.rootSessionId, focusNode: a0.nodeId });
  const beta = m.promptEvent('demo-beta');
  assert.equal(d.promptFocus(beta.nodeId), 0, '세션 하나만 볼 때 다른 세션 메인');
  d.mode = 'auto'; d.prompt = null;
  assert.ok(d.promptFocus(a0.nodeId) > 0, '그 세션 메인은 그대로');
  d.prompt = null;
  d.setScope({ mode: 'all' });
  view.pf.hide = new Set(['s:' + beta.rootSessionId]);
  assert.equal(d.promptFocus(beta.nodeId), 0, '표시 고르기로 숨긴 세션');
  view.pf.hide = new Set();
  assert.ok(d.promptFocus(beta.nodeId) > 0, '다시 보이면 따라감');
});

test('mock ?prompts=<ms>: 프로젝트를 돌아가며 메인에 사람 입력(app 이 넘김)', async () => {
  assert.match(src('../app.js'), /promptEveryMs: Number\(params\.get\('prompts'\)\)/);
  const m = createOverviewMock({ projects: 4, mainsPerProject: [2, 1, 0, 1], seed: 7, promptEveryMs: 30 });
  const got = [];
  m.start((ev) => { if (ev.type === 'user' && ev.origin === 'human' && ev.ix && ev.ix.op === 'prompt') got.push(ev.projectId); });
  await new Promise((r) => setTimeout(r, 200));
  m.stop();
  assert.ok(new Set(got).size >= 2, `여러 프로젝트에 입력: ${got.join(',')}`);
});

test('3D·연출 쪽도 같은 판정을 쓴다(소스 확인 — three 를 node 에서 못 불러옴)', () => {
  const c3 = src('../camera.js');
  assert.match(c3, /import \{ camVisible \} from '\.\/camera-core\.mjs'/);
  const pf = c3.slice(c3.indexOf('  promptFocus('), c3.indexOf('  focusNode('));
  assert.equal((pf.match(/_visibleId\(/g) || []).length, 2, 'promptFocus·_promptStep 모두 범위·표시 판정');
  assert.match(c3, /HAS\(this\.view, id\) && this\._visibleId\(id\), \(id\) =>/, 'git 붙잡기도 같은 판정');
  assert.match(c3, /_shownId\(id\) \{ return camVisible\(/);
  const c2 = src('../flat/camera2d.js');
  assert.match(c2, /_visibleId\(id\) \{/);
  const sc = src('../scene.js');
  for (const f of ['ripple(id, color) {', 'wave(id, color, scale = 1, at = null) {']) assert.match(sc.slice(sc.indexOf('  ' + f), sc.indexOf('  ' + f) + 120), /fxShown\(v\)/, f);
  const vx = src('../voxel/office.js');
  for (const f of ['ripple(id, color) {', 'wave(id, color, scale = 1) {']) assert.match(vx.slice(vx.indexOf('  ' + f), vx.indexOf('  ' + f) + 80), /_isOut\(id\)/, f);
});
