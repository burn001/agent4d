// 화면 비율 인지 섬 배치 · 맞춤 카메라 자세 — 순수 함수, three 를 import 하지 않는다(node 시험 대상).
//
// 가용 영역(무대 − 위·아래 덮개 − 라벨 자리)의 가로세로비 A 와 카메라 고도 범위를 입력으로,
// 섬(프로젝트) 경계 상자들의 가능한 배치(줄 k 개·열 k 개, 순서 유지·크기 순)를 모두 늘어놓고
// '맞춤 배율'(가용 영역에 꽉 맞췄을 때 세계 1 단위의 화면 크기 — 노드 평균 화면 크기에 비례)이 가장 큰 배치를 고른다.
// 3D 는 고도 el 에서 바닥 깊이가 sin(el) 만큼 줄어 보이는 것(세로 단축)을 반영하고, 고도도 함께 고른다(정사영 근사 —
// 실제 거리·시선점은 camera-core refineFit 이 원근으로 다시 맞춘다).

import { refineFit } from '../camera-core.mjs';

export const REPACK_TOL = 0.25;   // 가용 비율이 이만큼(25%) 넘게 바뀌면 섬을 다시 배치(그 밖에는 자리 유지, 카메라만 다시 맞춤)
export const TIE = 0.006;         // 배율 차가 이 비율 안이면 같은 것으로 본다(앞 후보 = 순서 유지·줄 배치 우선)
const D2R = Math.PI / 180;

/** 가용 영역: 무대 W×H 에서 위·아래·좌·우 덮개(px)를 뺀 것 */
export function availRect(W, H, ins = {}) {
  const w = Math.max(1, (W || 1) - (ins.left || 0) - (ins.right || 0));
  const h = Math.max(1, (H || 1) - (ins.top || 0) - (ins.bottom || 0));
  return { w, h, aspect: w / h };
}

/** 이전 배치 비율 → 지금 비율이 tol 넘게 바뀌었나(가로↔세로 전환·패널 접기/펴기 등) */
export function needRepack(prevAspect, aspect, tol = REPACK_TOL) {
  if (!(prevAspect > 0) || !(aspect > 0)) return false;
  return Math.max(prevAspect / aspect, aspect / prevAspect) >= 1 + tol - 1e-9;
}

/**
 * 정사영 화면 크기: 바닥 위 사각형들(rects: {x0,x1,z0,z1})을 방위각 yaw(도, 0 = 카메라가 +z 쪽에서 −z 를 봄)·고도 el(도)로 볼 때
 * 화면 가로 sw·세로 sh(세계 단위). hy = 바닥 위 높이(노드·라벨, 세로에 cos(el) 만큼 더해짐)
 */
export function projExtent(rects, yaw = 0, el = 90, hy = 0) {
  const a = yaw * D2R, s = Math.sin(el * D2R), c = Math.cos(el * D2R);
  const ca = Math.cos(a), sa = Math.sin(a);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const r of rects) {
    for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]]) {
      // 오른쪽 R = (cos a, 0, −sin a), 화면 깊이(앞 = 아래) = x·sin a + z·cos a
      const sx = x * ca - z * sa, dz = x * sa + z * ca;
      if (sx < x0) x0 = sx; if (sx > x1) x1 = sx;
      const sy = dz * s;
      if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
    }
  }
  if (!rects.length) return { sw: 0, sh: 0 };
  return { sw: x1 - x0, sh: y1 - y0 + Math.max(0, hy) * c };
}

/** 가용 비율 A 에 꽉 맞춘 배율(가용 높이 = 1 기준)과 점유율(가로·세로 중 작은 쪽) */
export function fitScale(sw, sh, A) {
  if (!(sw > 0) && !(sh > 0)) return { scale: Infinity, occ: 1, occW: 1, occH: 1 };
  const scale = Math.min(sw > 0 ? A / sw : Infinity, sh > 0 ? 1 / sh : Infinity);
  const occW = (sw * scale) / A, occH = sh * scale;
  return { scale, occ: Math.min(occW, occH), occW, occH };
}

/**
 * 맞춤 자세 고르기: yaw 범위(없으면 yaw0 고정)·고도 범위 [elevMin, elevMax] 를 훑어 배율 최대.
 * 배율이 거의 같으면(TIE) 점유율(작은 쪽)이 큰 것 → 기본 자세(yaw0·elevDef)에 가까운 것.
 * 결과: 높이가 모자라면 덜 내려다보고(세로 단축 ↑), 가로가 모자라 위아래가 남으면 더 내려다봐 세로를 채운다.
 * view = { aspect, elevMin, elevMax, elevDef, yaw0=0, yawMin?, yawMax?, hy=0 }
 */
export function bestPose(rects, view) {
  const A = view.aspect > 0 ? view.aspect : 1.6;
  const lo = Number.isFinite(view.elevMin) ? view.elevMin : 90, hi = Number.isFinite(view.elevMax) ? view.elevMax : lo;
  const def = Math.max(lo, Math.min(hi, Number.isFinite(view.elevDef) ? view.elevDef : (lo + hi) / 2));
  const y0 = Number.isFinite(view.yaw0) ? view.yaw0 : 0;
  const yawList = Number.isFinite(view.yawMin) && Number.isFinite(view.yawMax) && view.yawMax > view.yawMin
    ? ((k) => Array.from({ length: k + 1 }, (_, i) => view.yawMin + ((view.yawMax - view.yawMin) * i) / k))(Math.max(2, Math.ceil((view.yawMax - view.yawMin) / 4)))
    : [y0];
  const elList = hi > lo ? Array.from({ length: Math.ceil(hi - lo) + 1 }, (_, i) => Math.min(hi, lo + i)) : [lo];
  let best = null;
  for (const yaw of yawList) for (const el of elList) {
    const { sw, sh } = projExtent(rects, yaw, el, view.hy || 0);
    const f = fitScale(sw, sh, A);
    const dev = Math.abs(el - def) / 90 + Math.abs(Math.atan2(Math.sin((yaw - y0) * D2R), Math.cos((yaw - y0) * D2R))) / Math.PI;
    const cand = { yaw, el, ...f, sw, sh, dev };
    if (!best) { best = cand; continue; }
    const r = cand.scale / best.scale;
    if (r > 1 + TIE) best = cand;
    else if (r >= 1 - TIE) {
      if (cand.occ > best.occ + 0.01 || (Math.abs(cand.occ - best.occ) <= 0.01 && cand.dev < best.dev - 1e-9)) best = cand;
    }
  }
  return best;
}

// ───────────── 배치 후보 ─────────────

const hwOf = (c) => (c.box ? c.box.hw : c.hw != null ? c.hw : c.r);
const hdOf = (c) => (c.box ? c.box.hd : c.hd != null ? c.hd : c.r);

/** 순서 유지 줄 나누기(packRows 와 같은 규칙): k 줄, 폭을 고르게 */
export function splitRows(list, k, gap, sizeOf = hwOf) {
  const n = list.length;
  const width = (row) => row.reduce((s, c, i) => s + 2 * sizeOf(c) + (i ? gap : 0), 0);
  const target = width(list) / k;
  const rows = [];
  let cur = [];
  for (let i = 0; i < n; i++) {
    const c = list[i], left = n - i, rowsLeft = k - rows.length;
    if (cur.length && (width([...cur, c]) > target * 1.08 || left < rowsLeft) && rows.length < k - 1) { rows.push(cur); cur = []; }
    cur.push(c);
  }
  if (cur.length) rows.push(cur);
  return rows;
}

/** 줄 배치 → 중심들(줄 안 가로 가운데 맞춤, 줄 사이 gap+tag). 반환 Map(item → {x, z}) */
function placeRows(rows, gap, tag) {
  const out = new Map();
  let z = 0;
  rows.forEach((row, ri) => {
    const hmax = Math.max(...row.map(hdOf));
    if (ri) z += hmax;
    let x = 0;
    row.forEach((c, i) => { if (i) x += hwOf(row[i - 1]) + hwOf(c) + gap; out.set(c, { x, z }); });
    const mid = (out.get(row[0]).x - hwOf(row[0]) + out.get(row[row.length - 1]).x + hwOf(row[row.length - 1])) / 2;
    for (const c of row) out.get(c).x -= mid;
    z += hmax + gap + tag;
  });
  return out;
}

/** 열 배치 → 중심들(열 안 세로 가운데 맞춤, 섬 사이 gap+tag — 이름표가 섬 아래) */
function placeCols(cols, gap, tag) {
  const out = new Map();
  let x = 0;
  cols.forEach((col, ci) => {
    const wmax = Math.max(...col.map(hwOf));
    if (ci) x += wmax;
    let z = 0;
    col.forEach((c, i) => { if (i) z += hdOf(col[i - 1]) + hdOf(c) + gap + tag; out.set(c, { x, z }); });
    const mid = (out.get(col[0]).z - hdOf(col[0]) + out.get(col[col.length - 1]).z + hdOf(col[col.length - 1])) / 2;
    for (const c of col) out.get(c).z -= mid;
    x += wmax + gap;
  });
  return out;
}

/** 중심 Map → 바닥 사각형들(이름표 자리 tag 를 섬 아래에 포함) */
function rectsOf(list, centers, tag) {
  return list.map((c) => { const p = centers.get(c); return { x0: p.x - hwOf(c), x1: p.x + hwOf(c), z0: p.z - hdOf(c), z1: p.z + hdOf(c) + tag * 0.5 }; });
}

/**
 * 배치 후보 전부: 줄 k(1..n)·열 k(1..n) × (주어진 순서, 크기 큰 순). 같은 모양은 한 번만.
 * 반환 [{kind:'rows'|'cols', k, sorted, groups, centers:Map}]
 */
export function arrangements(list, { gap = 3, tag = 3 } = {}) {
  const n = list.length;
  if (!n) return [];
  const orders = [{ sorted: false, l: list }];
  const bySize = list.slice().sort((a, b) => hwOf(b) * hdOf(b) - hwOf(a) * hdOf(a));
  if (bySize.some((c, i) => c !== list[i])) orders.push({ sorted: true, l: bySize });
  const out = [], seen = new Set();
  for (const { sorted, l } of orders) for (let k = 1; k <= n; k++) {
    for (const kind of ['rows', 'cols']) {
      const groups = kind === 'rows' ? splitRows(l, k, gap, hwOf) : splitRows(l, k, gap + tag, hdOf);
      const key = kind + ':' + groups.map((g) => g.map((c) => list.indexOf(c)).join(',')).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const centers = kind === 'rows' ? placeRows(groups, gap, tag) : placeCols(groups, gap, tag);
      out.push({ kind, k: groups.length, sorted, groups, centers });
    }
  }
  return out;
}

/**
 * 가장 좋은 배치: 각 후보를 bestPose 로 평가(그 배치에 맞는 고도 포함)해 배율 최대. 배율이 TIE 안이면 앞 후보(순서 유지·줄).
 * view = bestPose 와 같음(2D 는 elevMin = elevMax = 90). 반환 {centers:Map, kind, k, sorted, pose, scale}
 */
export function chooseArrangement(list, view, opts = {}) {
  const tag = opts.tag ?? 3;
  let best = null;
  const tv = view.fov > 0 ? Math.tan((view.fov * Math.PI) / 360) : 0;
  for (const a of arrangements(list, opts)) {
    const rects = rectsOf(list, a.centers, tag);
    let pose = bestPose(rects, view), scale = pose.scale;
    if (tv) {
      // 3D(view.fov): 섬 상자 꼭짓점을 실제 원근으로 맞춰 본 거리로 비교(정사영 근사는 높은 고도·깊은 배치를 과대평가)
      const pts = [];
      for (const r of rects) for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]]) pts.push({ p: { x, y: 0, z }, r: 1 });
      const pp = perspPose(pts, view, tv * view.aspect, tv);
      if (pp) { pose = { ...pose, yaw: pp.yaw, el: pp.el }; scale = 1 / pp.D; }
    }
    const cand = { ...a, pose, scale };
    if (!best || cand.scale > best.scale * (1 + TIE)) best = cand;
  }
  return best;
}

/** 지금 자리(c.center)대로 놓인 섬들의 맞춤 배율(자세 포함) — 자리 유지 vs 다시 배치 비교용 */
export function scaleOf(list, view, tag = 3) {
  if (!list.length) return Infinity;
  return bestPose(list.map((c) => ({ x0: c.center.x - hwOf(c), x1: c.center.x + hwOf(c), z0: c.center.z - hdOf(c), z1: c.center.z + hdOf(c) + tag * 0.5 })), view).scale;
}
export const KEEP_GAIN = 1.15; // 다시 배치하면 맞춤 배율이 이만큼(15%) 넘게 커질 때만 자리 유지를 버린다(과 공존)

/**
 * 격자(열 수 cols)로 놓은 동들의 바닥 사각형 — 복셀 캠퍼스 slotSeq 순서(열 0, 1, −1, 2 …·행은 뒤로)를 흉내 낸 근사.
 * items = [{w, d}], gap = 동 사이
 */
export function gridRects(items, cols, gap) {
  const order = [0];
  for (let k = 1; order.length < cols; k++) { order.push(k); if (order.length < cols) order.push(-k); }
  const colW = new Map(), rowD = new Map(), slot = [];
  items.forEach((it, i) => {
    const col = order[i % cols], row = Math.floor(i / cols);
    slot.push({ col, row });
    colW.set(col, Math.max(colW.get(col) || 0, it.w + gap));
    rowD.set(row, Math.max(rowD.get(row) || 0, it.d + gap));
  });
  const cx = new Map(), rz = new Map();
  const cs = [...colW.keys()].sort((a, b) => a - b);
  let x = 0;
  for (const c of cs) { cx.set(c, x + colW.get(c) / 2); x += colW.get(c); }
  let z = 0;
  for (const r of [...rowD.keys()].sort((a, b) => a - b)) { rz.set(r, -(z + rowD.get(r) / 2)); z += rowD.get(r); }
  return items.map((it, i) => { const s = slot[i], X = cx.get(s.col), Z = rz.get(s.row); return { x0: X - it.w / 2, x1: X + it.w / 2, z0: Z - it.d / 2, z1: Z + it.d / 2 }; });
}

/** 복셀 캠퍼스 열 수 고르기: 1..maxCols 중 배율 최대(같으면 예전 규칙 ceil(√n) 에 가까운 것) */
export function chooseGridCols(items, view, { gap = 12, maxCols = 4 } = {}) {
  const n = items.length;
  if (n <= 1) return 1;
  const legacy = Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(n))));
  let best = null;
  for (let c = 1; c <= Math.min(maxCols, n); c++) {
    const pose = bestPose(gridRects(items, c, gap), view);
    const cand = { c, scale: pose.scale, dev: Math.abs(c - legacy) };
    if (!best || cand.scale > best.scale * (1 + TIE) || (cand.scale >= best.scale * (1 - TIE) && cand.dev < best.dev)) best = cand;
  }
  return best.c;
}

/**
 * 원근 자세 고르기(카메라용): bestPose 의 정사영 근사 대신 실제 원근 투영 맞춤(camera-core refineFit)으로 고도(2° 간격)·방위(범위가 있으면 6° 간격)를
 * 훑어 시선 거리 D 가 가장 짧은(= 노드가 가장 큰) 자세. D 가 1% 안이면 점유율(작은 쪽)이 큰 것 → 기본 자세에 가까운 것.
 * pts = [{p:{x,y,z}, r}](맞춤 여백 포함), view = bestPose 와 같음, tanH·tanV = 여백 반영한 반화각 탄젠트. 반환 {yaw, el, D, occ}
 */
export function perspPose(pts, view, tanH, tanV) {
  if (!pts.length) return null;
  const lo = Number.isFinite(view.elevMin) ? view.elevMin : 45, hi = Number.isFinite(view.elevMax) ? view.elevMax : lo;
  const def = Math.max(lo, Math.min(hi, Number.isFinite(view.elevDef) ? view.elevDef : (lo + hi) / 2));
  const y0 = Number.isFinite(view.yaw0) ? view.yaw0 : 0;
  const ranged = Number.isFinite(view.yawMin) && Number.isFinite(view.yawMax) && view.yawMax > view.yawMin;
  const span = (a, b, st) => { const k = Math.max(1, Math.ceil((b - a) / st)); return Array.from({ length: k + 1 }, (_, i) => a + ((b - a) * i) / k); };
  const yaws = ranged ? span(view.yawMin, view.yawMax, 6) : [y0];
  const els = hi > lo ? span(lo, hi, 2) : [lo];
  const c0 = boxC(pts);
  const all = [];
  let best = null;
  for (const yaw of yaws) for (const el of els) {
    const a = yaw * D2R, e = el * D2R;
    const dir = { x: Math.sin(a) * Math.cos(e), y: Math.sin(e), z: Math.cos(a) * Math.cos(e) };
    const F = { x: -dir.x, y: -dir.y, z: -dir.z }, rl = Math.hypot(F.z, F.x) || 1;
    const R = { x: -F.z / rl, y: 0, z: F.x / rl }, U = { x: R.y * F.z - R.z * F.y, y: R.z * F.x - R.x * F.z, z: R.x * F.y - R.y * F.x };
    const f = refineFit(pts, c0, R, U, F, tanH, tanV, 2);
    let x0 = Infinity, x1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const { p, r } of pts) {
      const dx = p.x - f.c.x, dy = p.y - f.c.y, dz = p.z - f.c.z;
      const x = dx * R.x + dy * R.y + dz * R.z, y = dx * U.x + dy * U.y + dz * U.z, d = Math.max(1e-3, f.D + dx * F.x + dy * F.y + dz * F.z);
      x0 = Math.min(x0, (x - r) / d); x1 = Math.max(x1, (x + r) / d); v0 = Math.min(v0, (y - r) / d); v1 = Math.max(v1, (y + r) / d);
    }
    const occ = Math.min((x1 - x0) / (2 * tanH), (v1 - v0) / (2 * tanV));
    const dev = Math.abs(el - def) / 90 + Math.abs(Math.atan2(Math.sin((yaw - y0) * D2R), Math.cos((yaw - y0) * D2R))) / Math.PI;
    all.push({ yaw, el, D: f.D, occ, dev });
  }
  const dMin = Math.min(...all.map((c) => c.D));
  for (const c of all) {
    if (c.D > dMin * 1.01) continue;
    if (!best || c.occ > best.occ + 0.02 || (Math.abs(c.occ - best.occ) <= 0.02 && c.dev < best.dev)) best = c;
  }
  return best;
}
const boxC = (pts) => {
  let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
  for (const { p } of pts) { lx = Math.min(lx, p.x); ly = Math.min(ly, p.y); lz = Math.min(lz, p.z); hx = Math.max(hx, p.x); hy = Math.max(hy, p.y); hz = Math.max(hz, p.z); }
  return { x: (lx + hx) / 2, y: (ly + hy) / 2, z: (lz + hz) / 2 };
};
