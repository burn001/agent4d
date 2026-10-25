// 사용자 입력 빛줄기 — 순수 규칙(three·DOM 없음, node --test 대상). 화면 공간 오버레이(prompt-fx.js)가 3D 세 표현·2D 공용으로 쓴다.
// 순서: (카메라가 메인으로 옮겨 가면) ① 모임 — 화면 테두리의 무작위 한 점으로 가장자리를 따라 에너지 가닥이 흘러 모이며 밝아짐(차징)
// ② 발사 — 모인 점에서 처음엔 바깥쪽으로 살짝 휘었다가 메인으로 감겨 들어가는 매끈한 3차 베지어, 점점 빨라지며 꽂힘('슈욱')
// ③ 흡수 — 머리가 메인에 닿으면 파문·점등, 꼬리는 메인 쪽으로 빨려 들어가며 사라짐. 메인이 화면 밖이면 그쪽 가장자리로 날아가 사라짐.
// 꼬리 폭은 화면 px 로 일정(원근 없음) — 그래서 3D 에서도 가까운 쪽이 굵어지지 않는다.

/** 모임(차징) 시간·가장자리 따라 모이는 범위(px)·안쪽 들임(px) */
export const CHARGE = { dur: 0.32, spread: 190, inset: 26, strands: 12 };
/** 발사 시간(초): 화면 거리(px)에 비례, 0.6～0.9 */
export function flightDur(px) { return +(0.6 + 0.3 * Math.max(0, Math.min(1, (Number(px) || 0) / 1400))).toFixed(4); }
/** 전체 길이(모임 + 발사) — 0.92～1.22초 */
export function missileDur(px) { return CHARGE.dur + flightDur(px); }
/** 흡수 뒤 꼬리가 빨려 들어가는 시간·도착 고리 */
export const ABSORB = { dur: 0.3, ring: 34 };
/** 움직임 줄이기: 모임 없이 목표 앞 짧은 직선, 0.45초 */
export const MISSILE_REDUCED = { dur: 0.45, len: 90 };
/** 머리가 작아지기 시작하는 발사 진행 비율 */
export const ABSORB_FROM = 0.88;
/** 꼬리: 표본 수·길이(곡선 매개변수 몫)·머리 폭(px) */
export const TRAIL = { N: 40, SPAN: 0.42, W: 3.4 };

/** 발사 진행 → 곡선 매개변수: 처음부터 빠르게 출발(속도 0 이 아님)해 끝으로 갈수록 가속하며 꽂힘(ease-in) */
export function flightEase(k) {
  const x = Math.max(0, Math.min(1, k));
  return 0.3 * x + 0.7 * x * x;
}
/** 3차 베지어 한 점({x,y} 또는 {x,y,z}) */
export function bez(out, p0, c1, c2, p1, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  out.x = a * p0.x + b * c1.x + c * c2.x + d * p1.x;
  out.y = a * p0.y + b * c1.y + c * c2.y + d * p1.y;
  if (p0.z != null) out.z = a * p0.z + b * c1.z + c * c2.z + d * p1.z;
  return out;
}
/** 꼬리 i 번째 표본(0 = 머리)의 곡선 매개변수·폭 배율(머리 1 → 끝 0)·알파 배율. tail0 = 꼬리 끝 하한(흡수 때 머리 쪽으로 당김) */
export function trailAt(t, i, N = TRAIL.N, span = TRAIL.SPAN, tail0 = 0) {
  const f = i / (N - 1);
  const t0 = Math.max(tail0, t - span);
  const ti = t - (t - Math.min(t, t0)) * f;
  return { t: Math.max(0, ti), w: Math.pow(1 - f, 1.25), a: Math.pow(1 - f, 1.6) };
}

/** 둘레 매개변수 u(0..1, 위 → 오른쪽 → 아래 → 왼쪽, 시계방향) → 가장자리 점·안쪽 법선·접선 */
export function borderPoint(W, H, u) {
  const P = 2 * (W + H);
  let d = (((u % 1) + 1) % 1) * P;
  if (d < W) return { x: d, y: 0, nx: 0, ny: 1, tx: 1, ty: 0, edge: 'top' };
  d -= W;
  if (d < H) return { x: W, y: d, nx: -1, ny: 0, tx: 0, ty: 1, edge: 'right' };
  d -= H;
  if (d < W) return { x: W - d, y: H, nx: 0, ny: -1, tx: -1, ty: 0, edge: 'bottom' };
  d -= W;
  return { x: 0, y: H - d, nx: 1, ny: 0, tx: 0, ty: -1, edge: 'left' };
}
/**
 * 모일 점 고르기: 무작위 후보 여럿 중 목표와 적당히 떨어진(화면 짧은 변의 0.35 배 이상) 점. 모서리 코앞(48px)은 피한다.
 * rnd = () => [0,1). 반환 = borderPoint + 안쪽으로 들인 모임 점 (gx, gy)
 */
export function pickBorder(W, H, tx, ty, rnd = Math.random, prevEdge = null) {
  const minD = Math.min(W, H) * 0.35;
  let best = null, bestS = -Infinity;
  for (let i = 0; i < 8; i++) {
    const b = borderPoint(W, H, rnd());
    const along = b.edge === 'top' || b.edge === 'bottom' ? b.x : b.y, len = b.edge === 'top' || b.edge === 'bottom' ? W : H;
    if (along < 48 || along > len - 48) continue;
    const gx = b.x + b.nx * CHARGE.inset, gy = b.y + b.ny * CHARGE.inset;
    const d = Math.hypot(tx - gx, ty - gy);
    const s = (d >= minD ? 1 : d / minD - 1) + (b.edge === prevEdge ? -0.4 : 0) + rnd() * 0.3; // 연달아 같은 변은 덜
    if (s > bestS) { bestS = s; best = { ...b, gx, gy }; }
  }
  if (!best) { const b = borderPoint(W, H, 0.125); best = { ...b, gx: b.x, gy: b.y + CHARGE.inset }; }
  return best;
}
const rot = (x, y, a) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
/**
 * 발사 곡선 제어점(화면 px): 출발 방향 = 목표 방향을 side(±1) 쪽으로 0.7rad 돌린 방향(바깥으로 살짝 휨, 테두리 밖을 향하면 반대쪽),
 * 끝 = 목표로 반대쪽에서 감겨 들어감. c2 는 목표 기준 상대 벡터(off2)로 돌려줘 목표가 움직여도 모양을 유지한다.
 */
export function flightCurve(g, T, side = 1) {
  const dx = T.x - g.gx, dy = T.y - g.gy, L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  // 목표 방향을 side 쪽으로 0.7rad 돌려 출발(바깥으로 휨). 그 방향이 화면 밖(테두리 쪽)을 향하면 반대로 돌림
  let s = rot(ux, uy, side * 0.7);
  if (s.x * g.nx + s.y * g.ny < 0.15) { side = -side; s = rot(ux, uy, side * 0.7); }
  if (s.x * g.nx + s.y * g.ny < 0.15) { const bx = ux + g.nx, by = uy + g.ny, bl = Math.hypot(bx, by) || 1; s = { x: bx / bl, y: by / bl }; }
  const c1 = { x: g.gx + s.x * L * 0.42, y: g.gy + s.y * L * 0.42 };
  const e = rot(-ux, -uy, -side * 0.45);
  const off2 = { x: e.x * L * 0.3, y: e.y * L * 0.3 };
  return { p0: { x: g.gx, y: g.gy }, c1, off2, L };
}
/**
 * 목표가 화면 밖(또는 카메라 뒤)이면 화면 가운데 → 목표 방향 반직선이 들인 사각형(inset)과 만나는 점. 안이면 그대로.
 * 반환 {x, y, on}
 */
export function edgeClamp(W, H, x, y, inset = 14, behind = false) {
  const cx = W / 2, cy = H / 2;
  let dx = x - cx, dy = y - cy;
  if (behind) { dx = -dx; dy = -dy; }
  const inside = !behind && x >= inset && x <= W - inset && y >= inset && y <= H - inset;
  if (inside) return { x, y, on: true };
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dy = 1;
  const kx = dx !== 0 ? (W / 2 - inset) / Math.abs(dx) : Infinity, ky = dy !== 0 ? (H / 2 - inset) / Math.abs(dy) : Infinity;
  const k = Math.min(kx, ky);
  return { x: cx + dx * k, y: cy + dy * k, on: false };
}

/**
 * 입력 때 카메라를 메인으로 옮길지('Follow my prompts'): 켬 + 자동 카메라 켬 + 최근 수동 조작 없음 + 상세 팝업 없음 + 노드 있음.
 * 재생 배속이 크면 짧게(>2× → 0.45초), 8× 이상이면 옮기지 않는다. 반환 {move, dur, hold}
 */
export const PROMPT_CAM = { dur: 0.75, short: 0.45, hold: 2.5, lead: 0.15 };
export function promptCamPlan({ follow = true, enabled = true, manual = false, hold = false, dragging = false, has = true, speed = 1, paused = false } = {}) {
  const no = { move: false, dur: 0, hold: 0 };
  if (!follow || !enabled || manual || hold || dragging || !has || paused || speed >= 8) return no;
  return { move: true, dur: speed > 2 ? PROMPT_CAM.short : PROMPT_CAM.dur, hold: PROMPT_CAM.hold };
}
/** 카메라 이동 시간 → 빛줄기 모임 시작 지연(이동 끝 직전에 겹쳐 모이기 시작, 발사는 이동이 끝난 화면에서) */
export function launchDelay(camDur) { return camDur > 0 ? Math.max(0, camDur - PROMPT_CAM.lead) : 0; }
