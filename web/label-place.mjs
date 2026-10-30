// 화면 공간 라벨 배치 — 순수 함수. three·DOM 없음(3D scene.js·2D flat-view.js·복셀 office 가 같이 씀).
// 라벨 상자가 이미 놓인 라벨뿐 아니라 **다른 노드(칩·도형) 원판**·**장애물 사각형**(홀로그램 도구 패널·말풍선·섬 이름표)과도
// 겹치지 않게 고른다. 후보마다 모드(보통 → 줄임 → 이름만) × 밀기(0 → 조금 더 멀리) 순으로 시도해 처음 빈 자리를 쓰고,
//  - 그래도 없으면 고정 라벨(pin)은 더 멀리 세로로 쌓은 자리(farShifts, 노드까지 리더선)를 찾고,
//  - force(포커스·호버)는 자리가 없어도 보통 모드로 보이고,
//  - 단단한 고정(pin === true: 루트·섬 메인·배치 장치)은 라벨·장애물과 겹치지 않는 자리가 있으면 노드에 걸쳐도 흐리게(dim) 보이고,
//  - 나머지(작업 중 노드 pin === 'soft' 포함)는 숨긴다 — 겹친 채 흐리게 남지 않는다.

/** 기본 밀기 순서: 제자리 → 노드에서 더 떨어뜨림(dy px) → 옆으로(라벨 폭 × kx) → 둘 다 → 더 멀리 */
export const LABEL_SHIFTS = [0, 12, [0.42, 0], [-0.42, 0], [0.42, 12], [-0.42, 12], 26];
/** 고정 라벨이 마지막에 쓰는 먼 자리(세로로 쌓기 · 리더선): 노드에서 멀어지는 쪽 dy, 옆 kx */
export const LABEL_FAR_SHIFTS = [40, [0.55, 40], [-0.55, 40], 56, [0.55, 56], [-0.55, 56], 74, [0.7, 74], [-0.7, 74], 94];
/** 이만큼 이상 밀린 라벨은 노드까지 리더선(px) */
export const LEAD_MIN = 34;
/** 리더선 길이 상한(px): 이보다 멀리 밀려야 하면 리더선을 길게 긋지 않고 라벨을 숨긴다(긴 선이 연결선처럼 보였다) */
export const LEAD_MAX = 60;

/** 상자 [x0, y0, x1, y1] 끼리 겹침 */
export function boxHit(a, b) { return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]; }

/** 상자와 원판 {x, y, r} 겹침(상자 안 가장 가까운 점까지 거리 < r) */
export function boxDisc(b, d) {
  const cx = d.x < b[0] ? b[0] : d.x > b[2] ? b[2] : d.x;
  const cy = d.y < b[1] ? b[1] : d.y > b[3] ? b[3] : d.y;
  const dx = cx - d.x, dy = cy - d.y;
  return dx * dx + dy * dy < d.r * d.r;
}

/** 기준점(x, y)·위/아래·간격·밀기(dy: 노드에서 멀어지는 쪽, dx: 가로 px)로 라벨 상자 */
export function labelBox(c, m, dy, dx = 0) {
  const x0 = c.x + dx - m.w / 2, x1 = c.x + dx + m.w / 2;
  if (c.up) { const b = c.y - c.gap - dy; return [x0, b - m.h, x1, b]; }
  const t = c.y + c.gap + dy;
  return [x0, t, x1, t + m.h];
}

/** 글자 폭 추정(px): 한글·한자·전각은 글자 크기만큼, 그 밖은 0.62 배 — 실제 폭을 아직 못 잰 라벨 모드용 */
export function textWidth(s, px = 11) {
  let w = 0;
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    w += c >= 0x1100 && (c <= 0x11ff || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60)) ? px : px * 0.62;
  }
  return Math.ceil(w);
}

/**
 * @param cands [{id, x, y, up, gap, force?, pin?(true | 'soft'), modes:[{w, h, compact, mini?}]}] 우선순위 순(앞이 먼저 자리를 잡음)
 * @param discs [{id, x, y, r}] 화면의 노드 원판(자기 노드는 id 로 뺀다)
 * @param opts  { pad = 2(원판 여유 px), bounds = [x0, x1](가로로 이 밖에 잘리는 자리는 걸침과 같이 봄),
 *               shifts = [0](밀기: 수 = dy px(노드에서 멀어지는 쪽), [kx, dy] = 가로로 라벨 폭 × kx 만큼도),
 *               vbounds = [y0, y1](세로로 이 밖이면 잘림), farShifts = [](고정 라벨만 마지막에 쓰는 먼 자리, 리더선), rects = [[x0, y0, x1, y1]…](피할 사각형: 도구 패널·말풍선·섬 이름표) }
 * @returns Map id → {compact, mini, dx, dy, dim, lead, box}
 */
export function placeLabels(cands, discs, opts = {}) {
  const pad = opts.pad ?? 2, shifts = opts.shifts || [0], bounds = opts.bounds || null;
  const far = opts.farShifts || [], rects = opts.rects || [];
  const boxes = [];
  const out = new Map();
  const nodeHit = (box, id) => {
    for (const d of discs) { if (d.id === id) continue; if (boxDisc(box, { x: d.x, y: d.y, r: d.r + pad })) return true; }
    return false;
  };
  const labelHit = (box) => { for (const b of boxes) if (boxHit(box, b)) return true; return false; };
  const rectHit = (box) => { for (const r of rects) if (boxHit(box, r)) return true; return false; };
  const vb = opts.vbounds || null;
  const outside = (box) => (!!bounds && (box[0] < bounds[0] || box[2] > bounds[1])) || (!!vb && (box[1] < vb[0] || box[3] > vb[1])); // 화면 밖으로 잘림(가로·세로)
  const shiftOf = (sh, m) => [Array.isArray(sh) ? sh[1] : sh, Array.isArray(sh) ? Math.round(sh[0] * m.w) : 0];
  for (const c of cands) {
    let got = null, soft = null;
    for (const m of c.modes) {
      for (const sh of shifts) {
        const [dy, dx] = shiftOf(sh, m);
        const box = labelBox(c, m, dy, dx);
        if (labelHit(box)) continue;
        const rh = rectHit(box);
        if (!rh && !outside(box) && !nodeHit(box, c.id)) { got = { compact: !!m.compact, mini: !!m.mini, dx, dy, dim: false, lead: 0, box }; break; }
        // 걸쳐야 하면 작은 쪽(장애물 사각형에 걸친 자리는 흐리게도 쓰지 않음 — 패널·말풍선에 가려진다)
        if (!rh && (!soft || (m.compact && !soft.compact) || (m.mini && !soft.mini))) soft = { compact: !!m.compact, mini: !!m.mini, dx, dy, dim: true, lead: 0, box };
      }
      if (got) break;
    }
    // 고정 라벨: 더 멀리 쌓은 자리(작은 모드부터) — 노드까지 리더선
    if (!got && c.pin && far.length) {
      const ms = [...c.modes].reverse();
      for (const m of ms) {
        for (const sh of far) {
          const [dy, dx] = shiftOf(sh, m);
          if (Math.hypot(dx, dy) > LEAD_MAX) continue; // 너무 먼 자리 = 긴 리더선 → 쓰지 않음
          const box = labelBox(c, m, dy, dx);
          if (labelHit(box) || rectHit(box) || outside(box) || nodeHit(box, c.id)) continue;
          got = { compact: !!m.compact, mini: !!m.mini, dx, dy, dim: false, lead: dy >= LEAD_MIN ? dy : 0, box };
          break;
        }
        if (got) break;
      }
    }
    if (!got && c.force) { const m = c.modes[0]; got = { compact: !!m.compact, mini: !!m.mini, dx: 0, dy: 0, dim: false, lead: 0, box: labelBox(c, m, 0) }; }
    if (!got && c.pin === true && soft) got = soft;
    if (!got) continue;
    boxes.push(got.box);
    out.set(c.id, got);
  }
  return out;
}

/**
 * 말풍선 같은 떠 있는 상자를 막는 상자(라벨)에서 비키게: 세로로 steps 만큼 차례로 옮겨 보며 처음 빈 자리의 dy.
 * 다 막히면 null(숨김 또는 흐리게는 부르는 쪽이 정함).
 */
export function dodgeBox(box, blockers, steps = [0, -18, 18, -36, 36, -54, 54]) {
  for (const dy of steps) {
    const b = [box[0], box[1] + dy, box[2], box[3] + dy];
    let hit = false;
    for (const o of blockers) if (boxHit(b, o)) { hit = true; break; }
    if (!hit) return dy;
  }
  return null;
}

/**
 * 맞춤 경계에 라벨 포함: 화면 맨 위(아래) 쪽 노드들의 라벨이 노드 위(아래)로 얼마나 나가는가(px).
 * placed = placeLabels 결과, cands = 후보(x, y = 노드 화면 자리), discs = 노드 원판. near = 맨 위·아래에서 이만큼 안의 노드만 본다.
 * @returns {{top:number, bottom:number}}
 */
export function labelReserve(placed, cands, discs, near = 48) {
  let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (const d of discs) { y0 = Math.min(y0, d.y - d.r); y1 = Math.max(y1, d.y + d.r); x0 = Math.min(x0, d.x - d.r); x1 = Math.max(x1, d.x + d.r); }
  let top = 0, bottom = 0, left = 0, right = 0;
  if (!Number.isFinite(y0)) return { top, bottom, left, right };
  const cmap = new Map(cands.map((c) => [c.id, c]));
  const dmap = new Map(discs.map((d) => [d.id, d]));
  for (const [id, r] of placed) {
    const c = cmap.get(id), d = dmap.get(id);
    if (!c || !r.box) continue;
    const ny0 = d ? d.y - d.r : c.y, ny1 = d ? d.y + d.r : c.y;
    if (ny0 <= y0 + near) top = Math.max(top, y0 - r.box[1]);
    if (ny1 >= y1 - near) bottom = Math.max(bottom, r.box[3] - y1);
    // 가로: 맨 왼쪽·오른쪽 노드 밖으로 나간 라벨 폭(좁은 화면에서 양 끝 메인 이름이 잘리던 것)
    const nx0 = d ? d.x - d.r : c.x, nx1 = d ? d.x + d.r : c.x;
    if (nx0 <= x0 + near) left = Math.max(left, x0 - r.box[0]);
    if (nx1 >= x1 - near) right = Math.max(right, r.box[2] - x1);
  }
  const cl = (v) => Math.max(0, Math.min(160, v));
  return { top: cl(top), bottom: cl(bottom), left: cl(left), right: cl(right) };
}

/** 라벨 여유 부드럽게: 늘 때는 바로, 줄 때는 천천히(맞춤이 라벨 자리 따라 흔들리지 않게), 6px 단위 */
export function smoothReserve(prev, next) {
  const f = (a, b) => { a = a || 0; b = b || 0; const v = b >= a ? b : a + (b - a) * 0.25; return Math.round(v / 6) * 6; };
  const q = (v) => Math.round((v || 0) / 6) * 6;
  if (!prev) return { top: q(next.top), bottom: q(next.bottom), left: q(next.left), right: q(next.right) };
  return { top: f(prev.top, next.top), bottom: f(prev.bottom, next.bottom), left: f(prev.left, next.left), right: f(prev.right, next.right) };
}

/**
 * 계획 보드(월드 고정 판 — 화면 상자가 카메라에 따라 커지고 작아지고 옮겨 감)를 피한 실제 배치와, 보드를 빼고 놓은 **맞춤용 배치**를 함께.
 * 자동 카메라 맞춤(라벨 점· 라벨 자리)은 맞춤용 배치를 쓴다 — 실제 배치를 쓰면 카메라 이동 → 보드 화면 상자 변화 →
 * 라벨이 옆·먼 자리로 밀리거나 숨음 → 맞춤 점 변화 → 카메라 이동의 되먹임이 생겨, 보드나 그 곁 러너·회차 라벨이 걸릴 때마다 구도가 움찔거렸다.
 * board 가 비면 한 번만 배치(fit === placed). opts.rects = 보드 아닌 장애물(도구 패널·말풍선·섬 이름표).
 * @returns {{placed: Map, fit: Map}}
 */
export function placeLabelsBoard(cands, discs, opts = {}, board = []) {
  if (!board || !board.length) { const placed = placeLabels(cands, discs, opts); return { placed, fit: placed }; }
  const placed = placeLabels(cands, discs, { ...opts, rects: [...(opts.rects || []), ...board] });
  return { placed, fit: placeLabels(cands, discs, opts) };
}
