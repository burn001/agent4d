// 자동 카메라 대상 고르기·다시 고르기 규칙
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isShown, isLive, scoreOf, pickBest, shotLost, shotStale, shownAncestor, fitFrame, flightPose, boxCenter, requiredDist, FitHold, isBusy, WINDOW, STALE_DWELL, QUIET } from '../camera-core.mjs';

const V = (status, o = {}) => ({ node: { status }, icons: { size: o.open || 0 }, hidden: !!o.hidden, gone: !!o.gone, exiting: o.exiting ?? null, scopeK: o.scopeK });

test('보이는 노드만 후보: 퇴장(gone·exiting)·숨김·다른 프로젝트 희미·복셀 희미는 제외', () => {
  assert.equal(isShown(V('active')), true);
  assert.equal(isShown(V('active', { hidden: true })), false);
  assert.equal(isShown(V('active', { gone: true })), false);
  assert.equal(isShown(V('done', { exiting: 12.3 })), false, '퇴장 페이드 중');
  assert.equal(isShown(V('active', { scopeK: 0.15 })), false);
  assert.equal(isShown(V('active', { scopeK: 0.35 })), false, 'recent 루트 희미(0.35)도 순환 밖');
  assert.equal(isShown(V('active', { scopeK: 1 })), true);
  assert.equal(isShown(V('active'), true), false, '복셀 _isDim');
  assert.equal(isShown(null), false);
});

test('활동 판정: 끝난 노드는 마지막 이벤트가 최근이어도 후보가 아니다(곧 퇴장), 열린 도구는 늘 활동', () => {
  const now = 100;
  assert.equal(isLive(V('active'), null, now), true);
  assert.equal(isLive(V('idle'), now - 3, now), true, '최근 이벤트');
  assert.equal(isLive(V('idle'), now - WINDOW - 1, now), false);
  assert.equal(isLive(V('done'), now - 0.5, now), false, '방금 끝난 노드');
  assert.equal(isLive(V('stopped'), now - 0.5, now), false);
  assert.equal(isLive(V('error'), now - 2, now), true, '오류는 남아 있으므로 후보');
  assert.equal(isLive(V('done', { open: 1 }), null, now), true);
});

test('점수: 창 안 이벤트 수 + 열린 도구×2 + 새 노드 5', () => {
  const now = 50;
  assert.equal(scoreOf([10, 40, 45, 49], 0, null, now), 3);
  assert.equal(scoreOf([49], 2, null, now), 5);
  assert.equal(scoreOf(null, 0, now - 1, now), 5);
  assert.equal(scoreOf(null, 0, now - 6, now), 0);
});

test('고르기: 최고 점수, 직전 대상 제외 — 단 다음 후보가 조용하면(점수 0) 활동 중인 직전 대상을 유지', () => {
  assert.equal(pickBest([['a', 3], ['b', 7]], null), 'b');
  assert.equal(pickBest([['a', 3], ['b', 7]], 'b'), 'a', '둘 다 활동 → 번갈아');
  assert.equal(pickBest([['a', 0], ['b', 7]], 'b'), 'b', '예전엔 조용한 a 로 넘어가 활동 노드를 놓쳤다');
  assert.equal(pickBest([['a', 0], ['b', 0]], 'a'), 'b', '모두 조용하면 번갈아');
  assert.equal(pickBest([['b', 2], ['a', 2]], null), 'a', '동률은 id 순(결정적)');
  assert.equal(pickBest([], 'x'), null);
  assert.equal(pickBest([['x', 4]], 'x'), 'x', '후보 하나면 유지');
});

test('샷 잃음: node-remove·완료 퇴장·숨김·희미, 사라진 섬', () => {
  const vis = new Map([['a', V('active')], ['g', V('done', { gone: true, hidden: true })], ['e', V('done', { exiting: 1 })], ['d', V('active', { scopeK: 0.15 })]]);
  const view = { vis, has: (id) => vis.has(id), clusterTarget: (pid) => (pid === 'P' ? { center: { x: 0, y: 0, z: 0 }, r: 5 } : null) };
  assert.equal(shotLost(view, { type: 'node', id: 'a' }), false);
  assert.equal(shotLost(view, { type: 'node', id: 'zz' }), true, 'node-remove');
  assert.equal(shotLost(view, { type: 'node', id: 'g' }), true, '퇴장 끝(gone) — 예전엔 has() 만 봐서 빈 자리를 8초 비췄다');
  assert.equal(shotLost(view, { type: 'node', id: 'e' }), true, '퇴장 페이드 중');
  assert.equal(shotLost(view, { type: 'node', id: 'd' }), true);
  assert.equal(shotLost(view, { type: 'node', id: 'a' }, (id) => id === 'a'), true, '복셀 희미');
  assert.equal(shotLost(view, { type: 'cluster', pid: 'P' }), false);
  assert.equal(shotLost(view, { type: 'cluster', pid: 'Q' }), true);
  assert.equal(shotLost(view, { type: 'overview' }), false);
});

test('끝나거나 조용해진 대상: 잠깐 머문 뒤 다른 노드가 지금 일하면 넘어간다', () => {
  const t = 10 + STALE_DWELL + 0.1;
  assert.equal(shotStale(V('done'), null, 10, t, true), true);
  assert.equal(shotStale(V('done'), null, 10, 10.5, true), false, '막 고른 직후');
  assert.equal(shotStale(V('done'), null, 10, 20, false), false, '다른 일하는 노드 없음');
  assert.equal(shotStale(V('idle'), 20 - QUIET - 1, 10, 20, true), true, '조용한 대기 노드');
  assert.equal(shotStale(V('active'), 19, 10, 20, true), false, '방금 이벤트');
  assert.equal(shotStale(V('done', { open: 1 }), null, 10, 20, true), false, '도구 열림');
  assert.equal(isBusy(V('idle'), 19, 20), true);
  assert.equal(isBusy(V('active'), 20 - QUIET - 0.1, 20), false);
});

test('대체 대상: 보이는 첫 조상', () => {
  const par = { c: 'b', b: 'a', a: null };
  const shown = new Set(['a']);
  assert.equal(shownAncestor('c', (id) => par[id], (id) => shown.has(id)), 'a');
  shown.add('b');
  assert.equal(shownAncestor('c', (id) => par[id], (id) => shown.has(id)), 'b');
  assert.equal(shownAncestor('a', (id) => par[id], () => true), null);
});

test('프레임 맞추기: 다 들어가면 예전과 같은 상자 중심, 넘치면 대상·활동 노드를 지키고 먼 자식을 뺀다', () => {
  const P = (x, z, r = 1, must = false) => ({ p: { x, y: 0, z }, r, must });
  const f0 = fitFrame([P(0, 0), P(10, 0), P(-10, 0)], 100);
  assert.deepEqual([f0.center.x, f0.center.z, f0.r, f0.used], [0, 0, 11, 3]);
  // 대상이 왼쪽 끝, 자식들이 오른쪽으로 길게 — 거리 상한에 걸리면 대상이 화면 밖으로 밀려나던 경우
  const pts = [P(-50, 0, 2), P(-45, 0), P(0, 0), P(40, 0), P(90, 0)];
  const f = fitFrame(pts, 30);
  assert.ok(f.r <= 30, 'r ' + f.r);
  assert.ok(Math.abs(f.center.x - -50) + 2 <= f.r + 1e-9, '대상이 경계구 안');
  // 활동 노드(must)는 가까운 일반 자식보다 먼저
  const g = fitFrame([P(0, 0), P(5, 0), P(-20, 0, 1, true)], 14);
  assert.ok(g.center.x < 0, '활동 노드 쪽으로: ' + g.center.x);
  assert.equal(fitFrame([], 10), null);
});

test('비행 자세: 양 끝 일치, 중간에 시선점으로 파고들지 않음, 멀리 옮기면 가운데서 물러남', () => {
  const ft = { x: 0, y: 0, z: 0 }, fp = { x: 0, y: 30, z: 30 };
  const tc = { x: 100, y: 0, z: 0 }, dir = { x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 };
  const near = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) < 1e-6;
  const p0 = flightPose(ft, fp, tc, dir, 20, 0);
  assert.ok(near(p0.pos, fp) && near(p0.tgt, ft));
  const p1 = flightPose(ft, fp, tc, dir, 20, 1);
  assert.ok(near(p1.tgt, tc));
  assert.ok(Math.abs(Math.hypot(p1.pos.x - 100, p1.pos.y, p1.pos.z) - 20) < 1e-6);
  const pm = flightPose(ft, fp, tc, dir, 20, 0.5);
  const dm = Math.hypot(pm.pos.x - pm.tgt.x, pm.pos.y - pm.tgt.y, pm.pos.z - pm.tgt.z);
  assert.ok(dm > Math.hypot(30, 30), '섬 사이 이동은 가운데서 물러남: ' + dm.toFixed(1));
  // 제자리에서 다가가기만 할 때는 호 없음, 거리 단조
  const q = flightPose(ft, fp, ft, dir, 10, 0.5);
  const dq = Math.hypot(q.pos.x, q.pos.y, q.pos.z);
  assert.ok(dq < Math.hypot(30, 30) && dq > 10, '' + dq);
});

test('전체 맞춤 거리: 모든 점이 여백 안, 점이 늘면 멀어지고 화면 모서리에 정확히 닿음', () => {
  // 카메라가 -z 를 봄: R=(1,0,0) U=(0,1,0) F=(0,0,-1)
  const R = { x: 1, y: 0, z: 0 }, U = { x: 0, y: 1, z: 0 }, F = { x: 0, y: 0, z: -1 };
  const P = (x, y, z = 0, r = 0) => ({ p: { x, y, z }, r });
  const pts = [P(-10, 0), P(10, 0), P(0, 5)];
  const c = boxCenter(pts);
  assert.deepEqual(c, { x: 0, y: 2.5, z: 0 });
  const D = requiredDist(pts, c, R, U, F, 0.5, 0.5);
  assert.ok(Math.abs(D - 20) < 1e-9, '가로 반폭 10 / tan 0.5 = 20: ' + D);
  // 투영 확인: 모든 점 |x/depth| ≤ tanH
  for (const q of pts) assert.ok(Math.abs(q.p.x - c.x) / (D + (q.p.z - c.z) * F.z) <= 0.5 + 1e-9, '화면 안');
  const D2 = requiredDist(pts.concat([P(30, 0)]), c, R, U, F, 0.5, 0.5);
  assert.ok(D2 > D);
  assert.ok(requiredDist([P(0, 0, 0, 3)], { x: 0, y: 0, z: 0 }, R, U, F, 0.5, 0.5) >= 6, '반지름 덧댐');
});

test('맞춤 유지(히스테리시스): 작은 변화엔 그대로, 넘치면 바로, 줄어들면 잠시 뒤에, 거리 범위 지킴', () => {
  const h = new FitHold({ grow: 1.0, shrink: 0.72, shift: 0.22, hold: 2.5, headroom: 1.1, fastShrink: 0 }); // 크게 줄 때 빨리 다가가기는 아래 따로
  const C = (x) => ({ x, y: 0, z: 0 });
  assert.equal(h.step(0, { c: C(0), D: 100 }, Infinity), true, '처음은 맞춤');
  assert.ok(Math.abs(h.D - 110) < 1e-9);
  assert.equal(h.step(1, { c: C(2), D: 104 }, 106), false, '노드 하나 늘어도 지금 구도에 담기면 그대로');
  assert.equal(h.step(2, { c: C(0), D: 90 }, 92), false, '조금 줄어도 그대로');
  assert.equal(h.step(3, { c: C(0), D: 115 }, 115), true, '지금 구도로 못 담으면 바로 물러남');
  assert.ok(Math.abs(h.D - 126.5) < 1e-9);
  assert.equal(h.step(4, { c: C(0), D: 50 }, 50), false, '크게 줄어도 바로 다가가지 않음');
  assert.equal(h.step(5.5, { c: C(0), D: 50 }, 50), false);
  assert.equal(h.step(6.6, { c: C(0), D: 50 }, 50), true, '2.5초 이어지면 다가감');
  assert.ok(Math.abs(h.D - 55) < 1e-9);
  assert.equal(h.step(7, { c: C(20), D: 50 }, 54), false, '중심이 벗어나도 바로는 안 움직임');
  assert.equal(h.step(9.6, { c: C(20), D: 50 }, 54), true, '이어지면 중심 옮김');
  assert.equal(h.c.x, 20);
  const g = new FitHold();
  g.step(0, { c: C(0), D: 2 }, Infinity, 22, 600);
  assert.equal(g.D, 22, '노드 하나뿐이면 최소 거리');
  g.step(1, { c: C(0), D: 900 }, 900, 22, 600);
  assert.equal(g.D, 600, '최대 거리');
  assert.equal(g.step(2, { c: C(0), D: 950 }, 950, 22, 600), false, '이미 최대면 되풀이 맞춤 없음');
});

test('§78 자동 카메라 깊이: 가까운 자식 고르기·수동 최소 거리 바닥·상수', async () => {
  const { ZOOM, autoFloor, nearestKids } = await import('../camera-core.mjs');
  const pos = { a: { x: 10, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 }, c: { x: 3, y: 0, z: 0 }, d: { x: 1, y: 0, z: 0 } };
  assert.deepEqual(nearestKids(['a', 'b', 'c', 'd'], (k) => pos[k], { x: 0, y: 0, z: 0 }, 3), ['b', 'd', 'c']);
  assert.deepEqual(nearestKids(['a', 'b'], (k) => pos[k], { x: 0, y: 0, z: 0 }, 3), ['a', 'b']);
  assert.equal(autoFloor(2, 3), 3);
  assert.equal(autoFloor(14, 3), 14);
  assert.equal(autoFloor(5, undefined), 5);
  assert.ok(ZOOM.NODE_K > 0 && ZOOM.NODE_K <= 1 && ZOOM.NODE_MIN_R_K > 0 && ZOOM.NODE_MIN_R_K <= 1);
  // 2D 노드 샷 바닥(MIN_R 7 × K / 0.93)이 수동 최소 D_MIN 4 보다 크다 — 자동이 수동 한계보다 붙지 않음
  assert.ok((7 * ZOOM.NODE_MIN_R_K) / 0.93 >= 4);
});

test('§41.5 맞춤 대상: 활성(작업 중·열린 도구, 끝나지 않음)만 — 활성이 없으면 보이는 노드 전부', async () => {
  const { isFitActive, pickFitIds } = await import('../camera-core.mjs');
  assert.equal(isFitActive(V('active')), true);
  assert.equal(isFitActive(V('idle')), false);
  assert.equal(isFitActive(V('idle'), 1), true, '열린 도구');
  assert.equal(isFitActive(V('done'), 1), false, '끝난 노드는 열린 도구가 남아도 아님');
  assert.equal(isFitActive(V('stopped')), false);
  assert.equal(isFitActive(V('error')), false);
  assert.deepEqual(pickFitIds([['a', false], ['b', true], ['c', true]]), ['b', 'c']);
  assert.deepEqual(pickFitIds([['a', false], ['b', false]]), ['a', 'b'], '활성이 없으면 전부');
  assert.deepEqual(pickFitIds([]), []);
});

test('§41.5 패널 자리 기억: 0.5초 칸 합집합을 keep 초 동안, 지나면 비움 · 모서리 점', async () => {
  const { PanelMemo, boxCorners } = await import('../camera-core.mjs');
  const m = new PanelMemo(4, 0.5);
  assert.equal(m.get('a', 0), null);
  m.put('a', 0.1, { x0: 1, x1: 3, y0: -1, y1: 1 });
  m.put('a', 0.3, { x0: -2, x1: 0, y0: 0, y1: 2 }); // 같은 칸 → 합침
  assert.deepEqual(m.get('a', 0.3), { x0: -2, x1: 3, y0: -1, y1: 2 });
  m.put('a', 2.0, { x0: 0, x1: 1, y0: 0, y1: 5 });
  assert.deepEqual(m.get('a', 3), { x0: -2, x1: 3, y0: -1, y1: 5 }, '닫힌 패널 자리도 keep 초 동안');
  assert.deepEqual(m.get('a', 4.6), { x0: 0, x1: 1, y0: 0, y1: 5 }, '오래된 칸은 빠짐');
  assert.equal(m.get('a', 9), null);
  const cs = boxCorners({ x: 10, y: 0, z: 5 }, { x0: -1, x1: 2, y0: 0, y1: 3 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 0);
  assert.equal(cs.length, 4);
  assert.deepEqual(cs.map((q) => [q.p.x, q.p.y]), [[9, 0], [9, 3], [12, 0], [12, 3]]);
  assert.ok(cs.every((q) => q.p.z === 5 && q.panel));
});

test('§41.5 투영 맞춤: 노드 + 패널 모서리가 여백 6% 띠를 한 축 꽉 채움, 패널 쪽으로 가운데가 옮겨 감', async () => {
  const { refineFit, requiredDist, boxCenter, FIT } = await import('../camera-core.mjs');
  // 위에서 비스듬히(고도 35°) 보는 카메라
  const el = (35 * Math.PI) / 180, dir = { x: 0, y: Math.sin(el), z: Math.cos(el) };
  const F = { x: -dir.x, y: -dir.y, z: -dir.z };
  const rl = Math.hypot(F.z, F.x); const R = { x: -F.z / rl, y: 0, z: F.x / rl };
  const U = { x: R.y * F.z - R.z * F.y, y: R.z * F.x - R.x * F.z, z: R.x * F.y - R.y * F.x };
  const t = Math.tan((50 * Math.PI) / 360), aspect = 16 / 9;
  const tanH = t * aspect * (1 - FIT.M), tanV = t * (1 - FIT.M);
  const node = { p: { x: 0, y: 0, z: 0 }, r: 1.5 };
  const panel = [[3, 1], [3, 3], [6, 1], [6, 3]].map(([x, y]) => ({ p: { x: R.x * x + U.x * y, y: R.y * x + U.y * y, z: R.z * x + U.z * y }, r: 0.12 }));
  const pts = [node, ...panel];
  const { c, D } = refineFit(pts, boxCenter(pts), R, U, F, tanH, tanV, 4);
  // 모든 점이 화면 안, 가로나 세로 한쪽이 여백 끝에 닿음
  let mx = 0, my = 0, x0 = Infinity, x1 = -Infinity;
  for (const { p, r } of pts) {
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    const x = dx * R.x + dy * R.y + dz * R.z, y = dx * U.x + dy * U.y + dz * U.z, z = dx * F.x + dy * F.y + dz * F.z;
    const dep = D + z;
    mx = Math.max(mx, (Math.abs(x) + r) / dep / tanH); my = Math.max(my, (Math.abs(y) + r) / dep / tanV);
    x0 = Math.min(x0, (x - r) / dep); x1 = Math.max(x1, (x + r) / dep);
  }
  assert.ok(mx <= 1 + 1e-6 && my <= 1 + 1e-6, '잘림 없음');
  assert.ok(Math.max(mx, my) > 0.97, '한 축이 꽉 참');
  assert.ok(Math.abs((x0 + x1) / 2) < 0.02 * tanH, '투영 상자 가운데가 화면 가운데');
  // 노드만 맞출 때보다 멀지만, 노드를 크게 담은 경계구(예전 반지름 r×1.15+0.9 의 구 전체)보다는 가깝다
  assert.ok(D > requiredDist([node], node.p, R, U, F, tanH, tanV));
});

test('§41.5 히스테리시스: 작은 넘침(GROW 안)은 기다리고, 크게 줄면 FAST_HOLD 초 뒤 다가감', async () => {
  const { FitHold, FIT } = await import('../camera-core.mjs');
  const C = (x) => ({ x, y: 0, z: 0 });
  const h = new FitHold();
  h.step(0, { c: C(0), D: 100 }, Infinity);
  const D0 = h.D;
  assert.equal(h.step(0.5, { c: C(0), D: D0 }, D0 * 1.01), false, '1% 넘침은 그대로(여백 안)');
  assert.equal(h.step(1, { c: C(0), D: D0 * 1.1 }, D0 * 1.1), true, '크게 넘치면 바로 물러남');
  const D1 = h.D;
  assert.equal(h.step(2, { c: C(0), D: D1 * 0.4 }, D1 * 0.4), false, '크게 줄어도 바로는 아님');
  assert.equal(h.step(2 + FIT.FAST_HOLD - 0.05, { c: C(0), D: D1 * 0.4 }, D1 * 0.4), false);
  assert.equal(h.step(2 + FIT.FAST_HOLD + 0.01, { c: C(0), D: D1 * 0.4 }, D1 * 0.4), true, '활성 집합이 줄면 짧게만 기다림');
  const D2 = h.D;
  assert.equal(h.step(4, { c: C(0), D: D2 * 0.8 }, D2 * 0.8), false, '조금 줄면 평소대로(2초)');
  assert.equal(h.step(5.5, { c: C(0), D: D2 * 0.8 }, D2 * 0.8), false);
  assert.equal(h.step(6.1, { c: C(0), D: D2 * 0.8 }, D2 * 0.8), true);
});
