// 사용자 입력 빛줄기 — 순수 규칙(three·DOM 없음). 3D(missile3d.js)·2D(flat-draw.js)가 같은 곡선·꼬리 규칙을 쓴다.
// 시청자(카메라) 앞 화면 하단 가운데에서 출발해, 처음엔 살짝 아래·옆으로 흘렀다가 목표(메인 노드)로 휘어 들어가는 부드러운 3차 베지어.
// 출발점·첫 제어점은 쏜 순간 고정, 둘째 제어점·끝점은 매 프레임 목표를 따라감(카메라가 움직여도 출발점은 그대로, 목표만 추적).

/** 비행 시간(초): 거리(세계 단위 또는 화면 px/10)에 비례, 0.9～1.3 */
export function missileDur(dist) { return Math.max(0.9, Math.min(1.3, 0.9 + (Number(dist) || 0) / 160)); }
/** 움직임 줄이기: 짧은 직선(목표 앞 25% → 목표), 0.45초 */
export const MISSILE_REDUCED = { dur: 0.45, frac: 0.25 };
/** 머리가 흡수되는 마지막 구간(비행 진행 비율) */
export const ABSORB_FROM = 0.86;
/** 꼬리: 표본 수·길이(곡선 매개변수 몫)·끝으로 갈수록 가늘고 투명 */
export const TRAIL = { N: 32, SPAN: 0.5 };

/** 진행 → 곡선 매개변수: 처음 천천히(쏜 뒤 흘림) 뒤로 빨라짐(유도 가속), 끝에서 살짝 늦춤 */
export function flightEase(k) {
  const x = Math.max(0, Math.min(1, k));
  const a = x * x * (3 - 2 * x);             // smoothstep
  return 0.35 * x + 0.65 * a;                 // 출발이 0 속도에 붙지 않게 조금 섞음
}
/** 3차 베지어 한 점(객체 {x,y,z} 또는 {x,y}) */
export function bez(out, p0, c1, c2, p1, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  out.x = a * p0.x + b * c1.x + c * c2.x + d * p1.x;
  out.y = a * p0.y + b * c1.y + c * c2.y + d * p1.y;
  if (p0.z != null) out.z = a * p0.z + b * c1.z + c * c2.z + d * p1.z;
  return out;
}
/** 꼬리 i 번째 표본(0 = 머리)의 매개변수·폭 배율·알파 배율 */
export function trailAt(t, i, N = TRAIL.N, span = TRAIL.SPAN) {
  const f = i / (N - 1);
  const ti = Math.max(0, t - span * f * Math.min(1, t / span + 0.15));
  const w = Math.pow(1 - f, 1.35);
  const a = Math.pow(1 - f, 1.8);
  return { t: ti, w, a };
}
/**
 * 2D 제어점(화면 px): 출발 = 화면 아래 가운데(조금 아래), 첫 제어점 = 옆(side ±1)·아래로 흘림, 둘째 = 목표 위쪽 앞에서 내려꽂힘.
 * 반환 {p0, c1, c2, p1}
 */
export function missile2D(W, H, tx, ty, side = 1) {
  const p0 = { x: W / 2, y: H + 6 };
  const L = Math.hypot(tx - p0.x, ty - p0.y) || 1;
  const c1 = { x: p0.x + side * L * 0.32, y: p0.y - L * 0.12 };
  const c2 = { x: tx - side * L * 0.12, y: ty + L * 0.28 };
  return { p0, c1, c2, p1: { x: tx, y: ty }, L };
}
