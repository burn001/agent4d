// 화면 비율 인지 섬 배치·맞춤 자세 순수 함수 시험
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availRect, needRepack, projExtent, fitScale, bestPose, arrangements, chooseArrangement, chooseGridCols, gridRects, REPACK_TOL } from '../overview/fill-pack.mjs';
import { computeOverview } from '../overview/layout.mjs';

const isl = (hw, hd) => ({ box: { hw, hd } });
const V2 = (aspect) => ({ aspect, elevMin: 90, elevMax: 90 });                    // 2D(위에서 내려다봄)
const V3 = (aspect) => ({ aspect, elevMin: 52, elevMax: 72, elevDef: 52 });       // Flow 3D 고도 범위

const spreadX = (list, best) => { const xs = list.map((c) => best.centers.get(c).x); return Math.max(...xs) - Math.min(...xs); };
const spreadZ = (list, best) => { const zs = list.map((c) => best.centers.get(c).z); return Math.max(...zs) - Math.min(...zs); };

test('availRect: 덮개를 뺀 가용 영역', () => {
  const a = availRect(1440, 900, { top: 0, bottom: 150 });
  assert.equal(a.w, 1440); assert.equal(a.h, 750); assert.ok(Math.abs(a.aspect - 1.92) < 1e-9);
  assert.equal(availRect(0, 0).aspect, 1);
});

test('needRepack: 25% 이상 바뀔 때만', () => {
  assert.equal(needRepack(1.6, 1.6), false);
  assert.equal(needRepack(1.6, 1.4), false);           // 14%
  assert.equal(needRepack(1.6, 1.6 / (1 + REPACK_TOL)), true);
  assert.equal(needRepack(1.6, 0.62), true);           // 가로 → 세로
  assert.equal(needRepack(null, 0.62), false);         // 이전 값 없음
});

test('projExtent·fitScale: 고도에 따른 세로 단축', () => {
  const r = [{ x0: -10, x1: 10, z0: -5, z1: 5 }];
  const top = projExtent(r, 0, 90), low = projExtent(r, 0, 30);
  assert.ok(Math.abs(top.sw - 20) < 1e-9 && Math.abs(top.sh - 10) < 1e-9);
  assert.ok(Math.abs(low.sh - 5) < 1e-9);
  const f = fitScale(20, 10, 2);
  assert.ok(Math.abs(f.scale - 0.1) < 1e-9 && Math.abs(f.occ - 1) < 1e-9);
  // 방위각 90° 면 가로·깊이가 바뀐다
  const rot = projExtent(r, 90, 90);
  assert.ok(Math.abs(rot.sw - 10) < 1e-9 && Math.abs(rot.sh - 20) < 1e-9);
});

test('bestPose: 세로가 모자라면 덜 내려다보고, 가로가 모자라면 더 내려다봐 세로를 채움', () => {
  const wide = [{ x0: -10, x1: 10, z0: -10, z1: 10 }];
  const a = bestPose(wide, { aspect: 2, elevMin: 20, elevMax: 70, elevDef: 45 });
  assert.equal(a.el, 30); // sin(30)=0.5 → 20×10, 가용 2:1 에 딱
  assert.ok(a.occ > 0.98);
  const b = bestPose(wide, { aspect: 0.5, elevMin: 20, elevMax: 70, elevDef: 45 });
  assert.ok(b.el >= 65, String(b.el)); // 가로가 한계 — 배율은 같고 세로 점유가 큰 고도
});

test('섬 2개: 가로 화면은 좌우, 세로 화면은 위아래 (2D·3D)', () => {
  const list = [isl(14, 10), isl(12, 9)];
  for (const mk of [V2, V3]) {
    const land = chooseArrangement(list, mk(1440 / 760));
    assert.ok(spreadX(list, land) > spreadZ(list, land), 'landscape → side by side');
    const port = chooseArrangement(list, mk(900 / 1290));
    assert.ok(spreadZ(list, port) > spreadX(list, port), 'portrait → stacked');
    const phone = chooseArrangement(list, mk(390 / 700));
    assert.ok(spreadZ(list, phone) > spreadX(list, phone));
  }
});

test('후보: 줄·열·크기 순, 중복 없음', () => {
  const list = [isl(5, 5), isl(10, 3), isl(4, 8)];
  const a = arrangements(list);
  const keys = a.map((x) => x.kind + ':' + x.groups.map((g) => g.map((c) => list.indexOf(c)).join(',')).join('|'));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(a.some((x) => x.kind === 'rows' && x.k === 1));
  assert.ok(a.some((x) => x.kind === 'cols' && x.k === 1));
  assert.ok(a.some((x) => x.sorted));
});

test('고른 배치는 모든 후보 중 배율 최대(5개·여러 비율)', () => {
  const list = [isl(16, 12), isl(9, 7), isl(7, 6), isl(11, 4), isl(6, 6)];
  for (const A of [0.46, 0.62, 1, 1.6, 1.92, 2.4]) {
    const best = chooseArrangement(list, V3(A));
    for (const a of arrangements(list)) {
      const rects = list.map((c) => { const p = a.centers.get(c); return { x0: p.x - c.box.hw, x1: p.x + c.box.hw, z0: p.z - c.box.hd, z1: p.z + c.box.hd + 1.5 }; });
      assert.ok(bestPose(rects, V3(A)).scale <= best.scale * 1.0061, `A=${A}`);
    }
  }
});

test('chooseGridCols: 세로 화면은 1열, 가로 화면은 2열(동 2개, 위에서 본 2D)', () => {
  const items = [{ w: 40, d: 30 }, { w: 36, d: 28 }];
  assert.equal(chooseGridCols(items, { aspect: 1.9, elevMin: 90, elevMax: 90 }), 2);
  assert.equal(chooseGridCols(items, { aspect: 0.6, elevMin: 90, elevMax: 90 }), 1);
  assert.equal(gridRects(items, 1, 12).length, 2);
});

// ── computeOverview 통합: 비율이 바뀔 때만 재배치(자리 유지와 공존) ──
let ord = 0;
const N = (id, parentId, kind, projectId, extra = {}) => ({ id, parentId, kind, projectId, status: 'active', _order: ord++, lastActivityAt: '2026-10-23T05:00:00Z', meta: {}, ...extra });
function world(p = 2, k = 7) {
  ord = 0;
  const nodes = new Map(), roots = [], projects = [];
  for (let i = 0; i < p; i++) {
    const pid = 'proj-' + i;
    projects.push({ projectId: pid, name: 'P' + i, live: true, active: i === 0, temp: false });
    const mid = `s:${pid}-m0`;
    nodes.set(mid, N(mid, null, 'main', pid, { sessionId: `${pid}-m0` }));
    roots.push({ nodeId: mid, projectId: pid, sessionId: `${pid}-m0` });
    for (let c = 0; c < k; c++) nodes.set(`a:${pid}-${c}`, N(`a:${pid}-${c}`, mid, 'subagent', pid));
  }
  return { nodes, roots, projects };
}
const axisOf = (ov) => { const [a, b] = ov.clusters; return Math.abs(a.center.x - b.center.x) > Math.abs(a.center.z - b.center.z) ? 'x' : 'z'; };

test('computeOverview(view): 가로 → 좌우, 세로로 바꾸면 다시 배치(위아래), 작은 변화는 자리 유지', () => {
  const w = world();
  const o1 = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: 0, view: V3(1.9) });
  assert.equal(axisOf(o1), 'x');
  assert.equal(o1.packAspect, 1.9);
  // 작은 변화(10%): 자리 그대로
  const o2 = computeOverview(w.nodes, w.roots, w.projects, o1, { nowMs: 0, view: V3(1.72) });
  assert.deepEqual(o2.clusters.map((c) => c.center), o1.clusters.map((c) => c.center));
  assert.equal(o2.packSeq, o1.packSeq);
  assert.equal(o2.packAspect, 1.9); // 배치를 고른 비율을 물려받음
  // 세로 화면: 다시 배치
  const o3 = computeOverview(w.nodes, w.roots, w.projects, o2, { nowMs: 0, view: V3(0.62) });
  assert.equal(axisOf(o3), 'z');
  assert.equal(o3.packSeq, o2.packSeq + 1);
  assert.equal(o3.packAspect, 0.62);
  // 다시 가로
  const o4 = computeOverview(w.nodes, w.roots, w.projects, o3, { nowMs: 0, view: V3(1.9) });
  assert.equal(axisOf(o4), 'x');
});

test('computeOverview: view 없으면 예전 그대로(packAspect null)', () => {
  const w = world();
  const o = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: 0, aspect: 1.6 });
  assert.equal(o.packAspect, null);
});

// ── 복셀 캠퍼스: 동 2개, 2D 평면도(위에서) — 가로 화면은 2열, 세로 화면은 1열, 비율이 바뀌면 다시 ──
import { computeCampus } from '../voxel/campus.mjs';
function campusWorld() {
  let o = 0;
  const list = [], roots = [], projects = [];
  for (let i = 0; i < 2; i++) {
    const pid = 'p' + i;
    projects.push({ projectId: pid, name: 'P' + i, live: true, active: i === 0 });
    const mid = `s:${pid}m0`;
    list.push({ id: mid, parentId: null, kind: 'main', projectId: pid, status: 'active', order: o++, meta: {}, lastActivityAt: '2026-10-23T05:00:00Z' });
    roots.push({ nodeId: mid, projectId: pid });
    for (let c = 0; c < 4; c++) list.push({ id: `a:${pid}c${c}`, parentId: mid, kind: 'subagent', projectId: pid, status: 'active', order: o++, meta: {}, lastActivityAt: '2026-10-23T05:00:00Z' });
  }
  return { list, roots, projects };
}
const bAxis = (lay) => { const [a, b] = lay.buildings; return Math.abs(a.origin.x - b.origin.x) > Math.abs(a.origin.z - b.origin.z) ? 'x' : 'z'; };
test('computeCampus(view): 가로 → 나란히, 세로 → 앞뒤, 비율이 바뀔 때만 슬롯 다시', () => {
  const w = campusWorld();
  const flat = (aspect) => ({ aspect, elevMin: 90, elevMax: 90 });
  const a = computeCampus(w.list, w.roots, w.projects, null, { nowMs: 0, view: flat(2) });
  assert.equal(bAxis(a), 'x');
  const b = computeCampus(w.list, w.roots, w.projects, a, { nowMs: 0, view: flat(1.8) });
  assert.equal(b.packSeq, a.packSeq);
  const c = computeCampus(w.list, w.roots, w.projects, b, { nowMs: 0, view: flat(0.55) });
  assert.equal(bAxis(c), 'z');
  assert.equal(c.packSeq, b.packSeq + 1);
  const legacy = computeCampus(w.list, w.roots, w.projects, null, { nowMs: 0 });
  assert.equal(legacy.packAspect, undefined);
});

test('bestPose: 방위각 범위(복셀) — 범위 안에서 고름', () => {
  const r = [{ x0: -30, x1: 30, z0: -5, z1: 5 }];
  const p = bestPose(r, { aspect: 2, elevMin: 30, elevMax: 52, elevDef: 40, yaw0: 45, yawMin: 17, yawMax: 73 });
  assert.ok(p.yaw >= 17 && p.yaw <= 73);
  const e = projExtent(r, 45, 40), def = fitScale(e.sw, e.sh, 2).scale;
  assert.ok(p.scale >= def - 1e-12); // 기본 자세(방위 45°·고도 40°)보다 덜 채우지 않음
});

import { perspPose } from '../overview/fill-pack.mjs';
test('perspPose: 원근 맞춤 거리 최소 자세(범위 안), 세로 화면에 앞뒤로 긴 배치면 더 내려다봄', () => {
  const pts = [];
  for (let z = -40; z <= 40; z += 10) for (const x of [-8, 8]) pts.push({ p: { x, y: 0, z }, r: 2 });
  const t = Math.tan((50 * Math.PI) / 360);
  const port = perspPose(pts, { elevMin: 20, elevMax: 72, elevDef: 30 }, t * 0.6, t);
  const land = perspPose(pts, { elevMin: 20, elevMax: 72, elevDef: 30 }, t * 1.8, t);
  assert.ok(port.el >= 20 && port.el <= 72 && land.el >= 20 && land.el <= 72);
  assert.ok(port.el >= land.el, `${port.el} ${land.el}`);
});

test('원근(view.fov) 평가: 섬 2개 가로 화면 좌우·세로 화면 위아래', () => {
  const list = [isl(14, 10), isl(12, 9)];
  const V = (aspect) => ({ aspect, fov: 50, elevMin: 52, elevMax: 72, elevDef: 52 });
  const land = chooseArrangement(list, V(2.2));
  assert.ok(spreadX(list, land) > spreadZ(list, land));
  const port = chooseArrangement(list, V(0.6));
  assert.ok(spreadZ(list, port) > spreadX(list, port));
});

// ── 다시 배치 진동(2026-10-25): 다중 세션에서 섬이 늘고 줄 때마다 약 10～30초마다 섬 전체가 자리를 바꾸던 것 ──
import { REPACK_HOLD_MS, REPACK_MIN_MS } from '../overview/layout.mjs';
test('computeOverview: 섬 크기가 오르내리고 라벨 몫 비율이 흔들려도 다시 배치는 드물게(유지 + 비키기, 기다림·최소 간격)', () => {
  const w = world(4, 3);
  const extra = (on) => { for (let c = 0; c < 9; c++) { const id = `a:proj-1-x${c}`; if (on) w.nodes.set(id, N(id, 's:proj-1-m0', 'subagent', 'proj-1')); else w.nodes.delete(id); } };
  let ov = null, repacks = 0, held = 0;
  const whys = new Set();
  for (let t = 0; t <= 180000; t += 500) {
    extra(Math.floor(t / 9000) % 2 === 1);                    // 9초마다 서브에이전트 9개가 생겼다 사라짐(크기 ±25% 넘게)
    const lab = Math.floor(t / 7000) % 2 ? 1.5 : 1.9;            // 라벨 몫만 바뀐 비율(화면·패널 그대로)
    const view = { ...V3(lab), baseAspect: 2.0 };
    const o = computeOverview(w.nodes, w.roots, w.projects, ov, { nowMs: t, view });
    if (ov && o.packSeq !== ov.packSeq) { repacks++; whys.add(o.repackWhy); }
    if (o.repackWhy === 'held') held++;
    for (let i = 0; i < o.clusters.length; i++) for (let j = i + 1; j < o.clusters.length; j++) {
      const A = o.clusters[i], B = o.clusters[j];
      assert.ok(Math.abs(A.center.x - B.center.x) >= A.box.hw + B.box.hw - 1e-6 || Math.abs(A.center.z - B.center.z) >= A.box.hd + B.box.hd - 1e-6, `겹침 t=${t}`);
    }
    ov = o;
  }
  assert.ok(repacks <= Math.ceil(180000 / REPACK_MIN_MS) + 1, `다시 배치 ${repacks}번 (${[...whys]})`);
  assert.ok(held > 0);
  // 화면 비율 자체가 바뀌면(가로 → 세로) 기다리지 않고 바로
  const o2 = computeOverview(w.nodes, w.roots, w.projects, ov, { nowMs: 180500, view: { ...V3(0.6), baseAspect: 0.62 } });
  assert.equal(o2.repackWhy, 'aspect');
  assert.equal(o2.packSeq, ov.packSeq + 1);
  assert.ok(REPACK_HOLD_MS >= 5000);
});
