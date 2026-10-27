// git 동작 붙잡기 — 순수 장부(GitHold·gitHoldPick)와 2D 디렉터(같은 규칙을 3D camera.js 도 씀)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHold, gitHoldStarts, gitHoldPick, gitHoldLabel, gitLinger, GIT_HOLD } from '../camera-core.mjs';
import { IXFX, ixPortalPts, PORTAL } from '../ix-core.mjs';

const start = (op, tu = 't1', nodeId = 'a', extra = {}) => ({ type: 'tool-start', nodeId, toolUseId: tu, tool: 'Bash', ix: { v: 1, cat: 'github', op, phase: 'start' }, ...extra });
const end = (tu = 't1', nodeId = 'a', ok = true, ix = {}) => ({ type: 'tool-end', nodeId, toolUseId: tu, ok, ix: { v: 1, cat: 'github', op: 'push', phase: 'end', ok, ...ix } });

test('시작: 대상 op 의 github tool-start 만 — 조회성·CI 대기·다른 범주·quiet·서버 묶음·몰림 정리·8배속↑ 은 아님', () => {
  for (const op of GIT_HOLD.OPS) assert.equal(gitHoldStarts(start(op)), true, op);
  for (const op of ['pr-view', 'api', 'repo', 'pr-checks', 'run', 'release']) assert.equal(gitHoldStarts(start(op)), false, op);
  assert.equal(gitHoldStarts({ ...start('push'), ix: { cat: 'db', op: 'query', phase: 'start' } }), false);
  assert.equal(gitHoldStarts({ ...start('push'), ix: { cat: 'github', op: 'push', phase: 'progress' } }), false);
  assert.equal(gitHoldStarts(start('push'), { quiet: true }), false, '스크럽·밀린 이벤트');
  assert.equal(gitHoldStarts(start('push'), { batch: true }), false, '서버 묶음(§108.4)');
  assert.equal(gitHoldStarts(start('push', 't1', 'a', { coalesced: 3 })), false, '몰림 정리');
  assert.equal(gitHoldStarts(start('push'), { speed: 8 }), false, '8배속↑');
  assert.equal(gitHoldStarts(start('push'), { speed: 4 }), true);
  assert.equal(gitHoldStarts({ ...start('push'), toolUseId: null }), false);
});

test('수명: 시작 → 붙잡음, tool-end 뒤 github 잔광(3.6초 ÷ √배속)이 끝나면 풀림 — 실패(붉은 깜빡임)도 같은 잔광 안', () => {
  const g = new GitHold();
  assert.equal(g.event(start('push'), 10, 10000), true);
  assert.deepEqual(g.active(11, 11000).map((h) => h.id), ['a']);
  g.event(end('t1', 'a', false), 15, 15000);
  const h = g.active(15, 15000)[0];
  assert.equal(h.ok, false);
  assert.equal(h.lin, IXFX.LINGER.github);
  assert.equal(g.active(15 + IXFX.LINGER.github - 0.01, 18000).length, 1, '잔광 중');
  assert.equal(g.active(15 + IXFX.LINGER.github, 19000).length, 0, '잔광 끝');
  assert.equal(gitLinger(4), IXFX.LINGER.github / 2);
  assert.equal(gitLinger(0.5), IXFX.LINGER.github, '느린 재생도 실시간 잔광 그대로');
});

test('상한: 끝이 안 오면 MAX 초(렌더러 시계 — 재생은 가상 시계) 뒤 풀림, 끝난 뒤 잔광은 상한과 무관하게 마저', () => {
  const g = new GitHold();
  g.event(start('clone'), 0, 0);
  assert.equal(g.active(100, GIT_HOLD.MAX * 1000).length, 1, '가상 시계로 아직 20초 — 실시간이 흘러도(일시정지) 그대로');
  assert.equal(g.active(100, GIT_HOLD.MAX * 1000 + 1).length, 0);
  g.event(start('push', 't2'), 0, 0);
  g.event(end('t2'), 19, 19000);
  assert.equal(g.active(21, 21000).length, 1, '19초에 끝남 → 22.6초까지');
});

test('겹침: 최근 순, 같은 호출 다시 시작은 하나로 · 백그라운드 push 는 출력 끝·띄운 노드 끝까지 · node-remove 는 지움', () => {
  const g = new GitHold();
  g.event(start('commit', 'c1', 'a'), 0, 0);
  g.event(start('push', 'p1', 'b'), 1, 1000);
  assert.deepEqual(g.active(2, 2000).map((h) => h.op), ['push', 'commit']);
  // 백그라운드로 띄운 push: tool-end(progress, bg) 로는 안 끝남
  g.event(start('push', 'p2', 'c'), 2, 2000);
  g.event({ type: 'tool-end', nodeId: 'c', toolUseId: 'p2', ok: true, ix: { cat: 'github', op: 'push', phase: 'progress', bg: 1 } }, 3, 3000);
  g.event({ type: 'node-add', node: { id: 'bg1', meta: { toolUseId: 'p2' } } }, 3, 3000);
  assert.equal(g.active(10, 10000).find((h) => h.key === 'p2').tEnd, null);
  g.event({ type: 'node-update', nodeId: 'c', patch: { status: 'done' } }, 10, 10000);
  assert.equal(g.active(10, 10000).find((h) => h.key === 'p2').tEnd, null, '호출한 노드가 끝나도 bg 는 띄운 노드 기준');
  g.event({ type: 'node-update', nodeId: 'bg1', patch: { status: 'error' } }, 11, 11000);
  const p2 = g.active(11, 11000).find((h) => h.key === 'p2');
  assert.equal(p2.tEnd, 11); assert.equal(p2.ok, false);
  // 출력 끝(ref)
  g.event(start('pull', 'q1', 'd'), 11, 11000);
  g.event({ type: 'output', nodeId: 'bgq', ix: { cat: 'github', op: 'pull', phase: 'end', ref: 'q1' } }, 12, 12000);
  assert.equal(g.active(12, 12000).find((h) => h.key === 'q1').tEnd, 12);
  // 몰림 정리 tool-summary
  g.event({ type: 'tool-summary', nodeId: 'a', ids: ['c1'] }, 12, 12000);
  assert.equal(g.active(12, 12000).find((h) => h.key === 'c1').tEnd, 12);
  g.event({ type: 'node-remove', ids: ['b'] }, 12, 12000);
  assert.equal(g.active(12, 12000).some((h) => h.id === 'b'), false);
});

test('우선순위: 꺼짐·수동 조작·상세 팝업·입력 따라가기면 없음, 범위 밖 노드는 건너뜀, 겹치면 가장 최근 것(+ 같은 세션 트리)', () => {
  const list = [{ id: 'x', op: 'push' }, { id: 'y', op: 'commit' }, { id: 'z', op: 'pull' }, { id: 'w', op: 'fetch' }];
  assert.deepEqual(gitHoldPick(list, { enabled: false }), []);
  assert.deepEqual(gitHoldPick(list, { auto: false }), [], '수동 조작(10초 규칙)');
  assert.deepEqual(gitHoldPick(list, { inspect: true }), [], '노드 클릭 팝업 머묾');
  assert.deepEqual(gitHoldPick(list, { prompt: true }), [], 'Follow my prompts');
  assert.deepEqual(gitHoldPick(list, {}, (id) => id !== 'x').map((h) => h.id), ['y'], '범위 밖 x 는 건너뛰고 다음 최근 것');
  assert.deepEqual(gitHoldPick(list, { follow: true }).map((h) => h.id), ['x']);
  assert.deepEqual(gitHoldPick(list, {}).map((h) => h.id), ['x'], '무리를 안 주면 가장 최근 하나');
  const grp = (id) => (id === 'z' ? 'S2' : 'S1');
  assert.deepEqual(gitHoldPick(list, {}, () => true, grp).map((h) => h.id), ['x', 'y', 'w'].slice(0, GIT_HOLD.N), '같은 세션 트리만 함께(다른 세션 z 는 뺌)');
  assert.equal(gitHoldLabel('push'), 'git push');
  assert.equal(gitHoldLabel('pr-merge', (k) => '~' + k), '~prMerge');
});

test('포털 점: 흐름 = 뿌리 위 포털 고리, Planet = 위성 궤도 네 점(뿌리 반지름 + ro)', () => {
  const f = ixPortalPts('flow', { x: 1, y: 0, z: 2 }, 1);
  assert.equal(f.length, 1);
  assert.deepEqual([f[0].x, f[0].y, f[0].z], [1 + PORTAL.flow.x, PORTAL.flow.y, 2 + PORTAL.flow.z]);
  const p = ixPortalPts('planet', { x: 0, y: 0, z: 0 }, 2);
  assert.equal(p.length, 4);
  assert.equal(Math.max(...p.map((q) => q.x)), 2 + PORTAL.planet.ro);
  assert.equal(ixPortalPts('flow', null), null);
});

// ---------- 2D 디렉터(three 없이 돌아감 — 3D camera.js 도 같은 _gitStep 규칙) ----------
async function director2d() {
  globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
  const { Director2D } = await import('../flat/camera2d.js');
  const node = (id, o = {}) => ({ id, label: id, status: 'active', projectId: o.pid || 'P', rootSessionId: o.sid || 'S', parentId: o.parent || null });
  const mk = (id, x, z, o) => ({ id, node: node(id, o), target: { x, y: 0, z }, pos: { x, y: 0, z }, r: 1, icons: { size: 0 } });
  const vis = new Map([['a', mk('a', 0, 0)], ['b', mk('b', 40, 0)], ['q', mk('q', 80, 0, { pid: 'Q' })]]);
  const canvas = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  let clock = 1e6;
  const view = {
    vis, canvas, W: 800, H: 600, cam: { x: 0, z: 0, D: 30 }, invalidate() {}, has: (id) => vis.has(id), children: () => [], parentOf: new Map(),
    nodeCluster: (id) => vis.get(id).node.projectId, clusters: () => [], clock: () => clock,
    ix: { holdPts: (id) => [{ x: vis.get(id).target.x + 0.6, y: 0, z: vis.get(id).target.z - 6, r: 2 }] },
  };
  const d = new Director2D(view, (id) => vis.get(id) && vis.get(id).node);
  return { d, view, vis, tick: (sec) => { clock += sec * 1000; } };
}

test('2D 디렉터: 시작 → 붙잡기(맞춤 = 그 노드 + 포털, 칩 git push), 끝 + 잔광 → 해제', async () => {
  const { d } = await director2d();
  const t0 = performance.now() / 1000;
  d.update(0.016, t0);
  d.noteEvent(start('push', 'p1', 'b'), { speed: 1 });
  let chip = '';
  d.onStatus = (s) => { chip = s.text; };
  d.update(0.016, t0 + 0.1);
  assert.ok(d.gitHold && d.gitHold[0].id === 'b');
  assert.match(chip, /git push/);
  const pts = d._fitPts(t0 + 0.1);
  assert.deepEqual(pts.map((q) => Math.round(q.p.x)), [40, 41], '노드 b + 포털만(a 는 빠짐)');
  // 끝 + 잔광
  d.git.m.get('p1').tEnd = t0 + 0.2; // tool-end 를 받은 것과 같다
  d.update(0.016, t0 + 0.2 + IXFX.LINGER.github - 0.05);
  assert.ok(d.gitHold, '잔광 중엔 그대로');
  d.update(0.016, t0 + 0.2 + IXFX.LINGER.github + 0.01);
  assert.equal(d.gitHold, null);
  assert.equal(d._fitPts(t0 + 4).length, 3, '원래 규칙(활성 노드 전체)');
  assert.doesNotMatch(chip, /git/);
});

test('2D 디렉터: 수동 조작·상세 팝업이 이기고, 범위 밖·quiet·묶음은 무시, 따라가기는 그 노드 샷', async () => {
  const { d } = await director2d();
  const t0 = performance.now() / 1000;
  d._manual();
  d.noteEvent(start('push', 'p1', 'a'));
  d.update(0.016, t0);
  assert.equal(d.gitHold, null, '수동 조작 중');
  d.resumeAuto();
  d.update(0.016, t0 + 0.1);
  assert.equal(d.gitHold[0].id, 'a', '복귀하면 아직 진행 중인 동작을 붙잡음');
  d.inspect({ type: 'node', id: 'b' });
  d.update(0.016, t0 + 0.2);
  assert.equal(d.gitHold, null, '팝업 머묾');
  d.release(); d.update(0.016, t0 + 0.3);
  // 범위: 프로젝트 P 선택 → Q 섬 노드 q 의 push 는 붙잡지 않음
  d.git.clear();
  d.setScope({ mode: 'all', focusProject: 'P' });
  d.noteEvent(start('push', 'p2', 'q'));
  d.update(0.016, t0 + 0.4);
  assert.equal(d.gitHold, null, '범위 밖');
  d.noteEvent(start('push', 'p3', 'b'), { quiet: true });
  d.noteEvent(start('push', 'p4', 'b'), { batch: true });
  d.noteEvent(start('push', 'p5', 'b', { coalesced: 2 }));
  d.noteEvent(start('push', 'p6', 'b'), { speed: 16 });
  d.update(0.016, t0 + 0.5);
  assert.equal(d.gitHold, null, 'quiet·묶음·몰림·16배속');
  d.setCamMode('follow');
  d.noteEvent(start('merge', 'm1', 'b'));
  d.update(0.016, t0 + 0.6);
  assert.equal(d.shot.type, 'node'); assert.equal(d.shot.id, 'b'); assert.equal(d.shot.git, true);
  const f = d._frame(d.shot, t0 + 0.6);
  assert.ok(f.z < 0, '노드 샷에 포털(위쪽)까지');
  d.noteEvent(end('m1', 'b'));
  d.update(0.016, t0 + 0.6 + IXFX.LINGER.github + 0.2);
  assert.equal(d.gitHold, null);
  assert.notEqual(d.shot.git, true, '풀리면 원래 순환으로');
});
