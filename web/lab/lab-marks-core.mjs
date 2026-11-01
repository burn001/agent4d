// 【모듈 규격 · T3 연구소 표지·보간(marks)】 순수(three·DOM 없음), node --test 대상(web/test/lab-marks.test.mjs). .
//
// ┌ export ─────────────────────────────────────────────────────────────────────────────────────────┐
// │ radialLerp(from, to, cx, cz, k, out?)  각은 to 의 각, 반지름만 from → to 로 k(0..1) 보간 → {x, z}(설계)          │
// │ RadiusTween(t0, ts, reduced)          반지름 바뀜 보간 시계: 1.2초 ÷ √배속, 움직임 줄이기 = 즉시. k(now) = ease 0..1        │
// │ cableSegs(from, to, cx, cz, out?)     주인 책상 앞 → 기자재 바닥 케이블 조각 [{ax,az,bx,bz}] — 직선 1 또는 방사 1 + 호 ≤ 5   │
// │ labMarks(layout, bulkChips, nowSec, opts, out?) → [{id,text,cls,x,y,z}] 머리 위 ×N 칩 · 주인별 '+n' 묶음 표지(합 ≤ 6)       │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// 3D 쪽 쓰는 곳: lab-view.js(_relayout · _drawMachineAt · _drawDynamic 보간, _extraLabels 표지), lab-props.js(drawLabRigCables).
import { LAB, polar, thetaOf, dTheta, DEG } from './lab-const.mjs';
import { rigShelfSlots } from './lab-rig-core.mjs';

export const LAB_MARKS = {
  TWEEN_S: 1.2,       // 반지름 보간 시간(배속 1)
  CHIP_S: 4,          // ×N 칩 유지(초)
  CHIP_Y: 2.1,        // 사람 머리 위 칩 높이(발밑 + )
  MORE_Y: 1.35,       // '+n' 표지 높이(바닥 + )
  MAX: 6,             // 표지 합 상한
  CABLE_SEGS: 6,      // 케이블 한 줄 조각 상한
  CABLE_STRAIGHT: 1.5, // 호 길이가 이보다 짧으면 직선 한 조각
  CABLE_ARC_STEP: 2.5, // 호 조각 길이(대략)
};

const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);
/** 부드러운 출발·도착(cubic in-out) */
export const easeInOut = (u) => { u = clamp01(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };

/**
 * 극좌표 보간: 각은 to 의 각 그대로, 반지름만 |from − c| → |to − c| 를 k 로 선형(ease 는 RadiusTween 이 k 에 이미 넣음).
 * k = 0 → to 각의 from 반지름, k = 1 → to.
 */
export function radialLerp(from, to, cx, cz, k, out = {}) {
  const r0 = Math.hypot(from.x - cx, from.z - cz), r1 = Math.hypot(to.x - cx, to.z - cz);
  const kk = clamp01(k), r = r0 + (r1 - r0) * kk;
  if (r1 < 1e-9) { out.x = cx + (from.x - cx) * (1 - kk); out.z = cz + (from.z - cz) * (1 - kk); return out; } // 중심 = 각 없음
  const s = r / r1;
  out.x = cx + (to.x - cx) * s; out.z = cz + (to.z - cz) * s;
  return out;
}

/** 반지름 보간 시계. ts = 배속(√ 로 줄임), reduced = 움직임 줄이기(즉시 끝) */
export class RadiusTween {
  constructor(t0, ts = 1, reduced = false, dur = LAB_MARKS.TWEEN_S) {
    this.t0 = t0;
    this.dur = reduced ? 0 : dur / Math.sqrt(Math.max(1, Number(ts) || 1));
  }
  /** 0..1(ease) */
  k(now) { return this.dur <= 0 ? 1 : easeInOut((now - this.t0) / this.dur); }
  done(now) { return this.dur <= 0 || now >= this.t0 + this.dur; }
}

/**
 * 케이블 조각: from(주인 책상 앞) → to(기자재 바닥). 각 차가 작으면 직선 1조각,
 * 아니면 from 각으로 방사(반지름 from → to) 1조각 + to 반지름 호(짧은 쪽) ≤ 5조각. 끝점은 from·to 와 정확히 같다.
 * out(선택) = 다시 쓸 배열 — 안의 조각 객체를 재사용하고 길이를 맞춘다.
 * @returns [{ax, az, bx, bz}](= out)
 */
export function cableSegs(from, to, cx, cz, out = []) {
  out.length = cableSegsInto(from, to, cx, cz, out);
  return out;
}
const _cq = { x: 0, z: 0 }, _cp = { x: 0, z: 0 };
/** cableSegs 의 할당 없는 꼴(프레임마다 부르는 drawLabRigCables 용): out 의 조각 객체를 재사용해 채우고 개수를 돌려준다(앞 n 개만 유효) */
export function cableSegsInto(from, to, cx, cz, out) {
  const r0 = Math.hypot(from.x - cx, from.z - cz), r1 = Math.hypot(to.x - cx, to.z - cz);
  const th0 = thetaOf(cx, cz, from.x, from.z), th1 = thetaOf(cx, cz, to.x, to.z), d = dTheta(th0, th1);
  const arc = Math.abs(d) * DEG * r1;
  if (arc < LAB_MARKS.CABLE_STRAIGHT || r0 < 1e-6 || r1 < 1e-6) { putSeg(out, 0, from.x, from.z, to.x, to.z); return 1; }
  let k = 0, ax = from.x, az = from.z;
  const tx = to.x, tz = to.z;
  if (Math.abs(r1 - r0) > 1e-6) { const p = polar(cx, cz, r1, th0, _cp); putSeg(out, k++, ax, az, p.x, p.z); ax = p.x; az = p.z; }
  const n = Math.max(1, Math.min(LAB_MARKS.CABLE_SEGS - k, Math.ceil(arc / LAB_MARKS.CABLE_ARC_STEP)));
  for (let i = 1; i <= n; i++) {
    let qx = tx, qz = tz;
    if (i !== n) { const q = polar(cx, cz, r1, th0 + (d * i) / n, _cq); qx = q.x; qz = q.z; }
    putSeg(out, k++, ax, az, qx, qz);
    ax = qx; az = qz;
  }
  return k;
}
function putSeg(out, i, ax, az, bx, bz) {
  const g = out[i] || (out[i] = { ax: 0, az: 0, bx: 0, bz: 0 });
  g.ax = ax; g.az = az; g.bx = bx; g.bz = bz;
}


// ── labMarks 재사용 버퍼(프레임·0.2초 이름표 갱신마다 새 배열·쌍·클로저·정렬 사본 0) ──
const _live = [];               // 살아 있는 ×N 칩 주인 id(정렬용)
const _seenMore = new Set();    // 여러 구역 방이 공유하는 rigMore 한 번만
const _ownersOf = new WeakMap(); // rigMore Map → {size, ids(정렬)} — 배치가 바뀔 때만 다시
const _shelfOf = new WeakMap();  // lab → {cx, cz, rP, sh} 보조 선반 칸 — 반지름이 바뀔 때만 다시
const _pp = { x: 0, z: 0, floorY: 0 };
const _idBulk = new Map(), _idMore = new Map(); // 노드 id → 표지 id 문자열
const _txt = { '×': [], '+': [] };                // 수 → '×n' / '+n'
let _chips = null;
const byRecent = (a, b) => { const A = _chips.get(a), B = _chips.get(b); return (B.until - A.until) || (a < b ? -1 : a > b ? 1 : 0); };
const strOf = (C, pre, id) => { let s = C.get(id); if (s === undefined) { if (C.size > 512) C.clear(); s = pre + id; C.set(id, s); } return s; };
const numTxt = (p, n) => { const a = _txt[p]; if (n < 1000) return a[n] || (a[n] = p + n); return p + n; };
function putMark(out, i, id, text, cls, x, y, z) {
  const m = out[i] || (out[i] = { id: '', text: '', cls: '', x: 0, y: 0, z: 0 });
  m.id = id; m.text = text; m.cls = cls; m.x = x; m.y = y; m.z = z;
}
/** 사람 지금 자리(posOf 가 있으면 그것, 없으면 배치 자리) → _pp 또는 posOf 가 돌려준 객체 | null */
function markPos(id, posOf, seat) {
  if (posOf) { const p = posOf(id, _pp); if (p) return p; }
  const s = seat ? seat.get(id) : null;
  if (!s) return null;
  _pp.x = s.x; _pp.z = s.z; _pp.floorY = s.floorY || 0;
  return _pp;
}
function ownersOf(more) {
  let e = _ownersOf.get(more);
  if (!e || e.size !== more.size) { e = { size: more.size, ids: [...more.keys()].sort() }; _ownersOf.set(more, e); }
  return e.ids;
}
function shelfOf(lab, cx, cz) {
  const rP = lab.rP || LAB.PLATFORM.R_DEFAULT;
  let e = _shelfOf.get(lab);
  if (!e || e.cx !== cx || e.cz !== cz || e.rP !== rP) { e = { cx, cz, rP, sh: rigShelfSlots(cx, cz, rP) }; _shelfOf.set(lab, e); }
  return e.sh;
}

/**
 * 연구소 3D 표지(순수). 머리 위 ×N 칩이 먼저, 그 뒤 주인별 '+n'(rigMore), 합 ≤ LAB_MARKS.MAX. farAll(전체 보기 원경) = [].
 * @param layout   computeLab / computeLabCampus 결과({rooms[].lab.rigMore:Map 주인 → 수, seat:Map})
 * @param bulkChips Map nodeId → {n, until(초)} (LabView._bulkChip)
 * @param nowSec   지금(초, bulkChips.until 과 같은 시계)
 * @param opts     { farAll, posOf(id, out) → {x, z, floorY}|null }(사람 지금 자리 — out 을 채워 돌려주면 할당 0, 없으면 layout.seat)
 * @param out      (선택) 다시 쓸 배열 — 표지 객체를 재사용하고 길이를 맞춘다(LabView 는 넘김)
 * @returns [{id, text, cls, x, y, z}](= out)
 * 책상 없는 주인 여럿('+n')은 주인 순서대로 보조 선반 칸을 뒤에서부터 하나씩 써서 같은 자리에 겹치지 않는다.
 */
export function labMarks(layout, bulkChips, nowSec, opts = {}, out = []) {
  let k = 0;
  if (opts.farAll || !layout) { out.length = 0; return out; }
  const seat = layout.seat instanceof Map ? layout.seat : null;
  const posOf = typeof opts.posOf === 'function' ? opts.posOf : null;
  // ① ×N 칩(같은 사람 하나에 하나, 최근 것 먼저)
  if (bulkChips && bulkChips.size) {
    _live.length = 0;
    for (const id of bulkChips.keys()) { const c = bulkChips.get(id); if (c && c.until > nowSec && c.n > 0) _live.push(id); }
    if (_live.length > 1) { _chips = bulkChips; _live.sort(byRecent); _chips = null; }
    for (let i = 0; i < _live.length && k < LAB_MARKS.MAX; i++) {
      const id = _live[i], p = markPos(id, posOf, seat);
      if (!p) continue;
      putMark(out, k++, strOf(_idBulk, 'labchip:bulk:', id), numTxt('×', bulkChips.get(id).n), 'lab-chip bulk', p.x, (p.floorY || 0) + LAB_MARKS.CHIP_Y, p.z);
    }
    _live.length = 0;
  }
  // ② '+n' 묶음 표지: 주인 책상 옆 · 주인 자리가 없으면 보조 선반 칸 앞(주인 순서대로 마지막 칸부터 하나씩 — 겹치지 않게)
  _seenMore.clear();
  for (const r of layout.rooms || []) {
    if (k >= LAB_MARKS.MAX) break;
    const lab = r && r.lab, more = lab && lab.rigMore;
    if (!(more instanceof Map) || !more.size || _seenMore.has(more)) continue;
    _seenMore.add(more);
    const owners = ownersOf(more), cx = lab.cx || 0, cz = lab.cz || 0;
    let j = 0; // 책상 없는 주인 순번
    for (let i = 0; i < owners.length && k < LAB_MARKS.MAX; i++) {
      const o = owners[i], n = more.get(o);
      if (!(n > 0)) continue;
      const s = seat ? seat.get(o) : null;
      let x, z, y0 = 0;
      if (s && Number.isFinite(s.deskX)) { // 책상 옆(−θ 쪽 1.3 — 책상 사이 틈. 책상 앞은 시료 카드, 팀장 콘솔 +θ 쪽도 시료 카드)
        const a = thetaOf(cx, cz, s.deskX, s.deskZ) * DEG;
        x = s.deskX - Math.cos(a) * 1.3; z = s.deskZ + Math.sin(a) * 1.3; y0 = s.floorY || 0;
      } else {
        const sh = shelfOf(lab, cx, cz);
        if (!sh.length) continue;
        const q = j++, slot = sh[sh.length - 1 - (q % sh.length)], lap = Math.floor(q / sh.length); // 칸보다 많으면 한 바퀴 더(0.7m씩 앞으로)
        const d = 0.7 + lap * 0.7;
        x = slot.x + Math.sin(slot.face) * d; z = slot.z + Math.cos(slot.face) * d;
      }
      putMark(out, k++, strOf(_idMore, 'labchip:more:', o), numTxt('+', n), 'lab-chip more', x, y0 + LAB_MARKS.MORE_Y, z);
    }
  }
  _seenMore.clear();
  out.length = k;
  return out;
}
