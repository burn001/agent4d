// Planet 과열 연출 순수 규칙 — DOM·three·시계·난수 없음, node --test 대상(web/test/planet-heat.test.mjs).
// heat-core.mjs 가 정한 노드별 heat(0..1, 보간된 값)를 Planet 3D(planet-heat.js)·2D(flat/planet-heat2d.js)가 같은 세기로 그리도록
// "얼마나·무엇을" 만 정한다. 단계는 보간된 heat 에서 다시 읽는다(식는 동안 연기가 먼저 걷히고 글로우가 마지막에 꺼지게).
//   heat 0.0(30%)          ─ 데움: 표면·이음선·테두리 주황 + 둘레 호박 글로우(30% 부터 뚜렷, 40% 면 한눈에, 70% 로 갈수록 짙게)
//   heat 0.0～WISP_H(30～50%) ─ 데움 안: 극·해치에서 가는 김 한 가닥(30% 부터 늘 피어오름, 50% 면 한두 가닥 — 과열 가닥으로 이어짐)
//   멀리서도(전체 보기 기본 카메라, 행성이 몇 px) 읽히게 화면 px 하한이 있는 후광(haloPx)·연기(smokePx)·몸 색 물듦(tint)·궤도 링/위성 단계색(ring)
//   heat HOT_H ≈0.571(70%)  ─ 과열: 붉은 글로우 맥동, 균열 용암빛, 해치·극 연기 가닥
//   heat CRIT_H ≈0.857(90%) ─ 위험: 짙은 연기 꼬리(부모 반대쪽), 붉은 코로나 맥동, 가끔 불티·작은 플레어
//   경계는 heat-core.mjs 의 HOT_H·CRIT_H(공용 상수)를 그대로 쓴다.
import { HOT_H, CRIT_H, WISP_H, heatOfPct } from './heat-core.mjs';

export const PHEAT = Object.freeze({
  HOT_H,             // ≈0.571 — 과열이 시작되는 heat(70%, heat-core 공용)
  CRIT_H,            // ≈0.857 — 위험이 시작되는 heat(90%, heat-core 공용)
  WISP_H,            // ≈0.286 — 데움 안 옅은 연기가 시작되는 heat(50%, heat-core 공용)
  RAMP: 0.08,        // 단계 문턱 뒤 이 heat 만큼 걸쳐 그 단계 연출이 다 켜짐(문턱에서 툭 튀지 않게)
  EST_K: 0.85,       // 창 크기 추정(estimated) 노드는 조금 약하게
  OFF_S: 0.7,        // 완료·중지·퇴장 → 연출이 꺼지는 시간(초). 켜질 땐 바로
  PX_GLOW: 0.8,      // 본체 화면 반지름이 이 px 미만이면 아무것도 안 그림
  PX_SMOKE: 6,       // 연기·불티는 이 px 이상만
  PX_FULL: 16,       // 이 px 이상이면 노드당 연기 상한 최대
  CAP_MID: 8,        // 노드당 살아 있는 연기 입자 상한(중간 거리)
  CAP_NEAR: 26,      // 〃 (가까이)
  CAP_FAR: 6,        // 〃 (멀리 — 본체가 PX_FAR～PX_SMOKE px, 연기는 화면 px 하한 크기로 커져 가닥으로 읽힘)
  PX_FAR: 1.2,       // 이 px 이상이면 멀리서도 연기(2026-10-30 "Planet 도 과열 표현이 잘 안 보인다")
  REF_H: 1440,       // 화면 px 하한(haloPx·smokePx)의 기준 화면 높이(CSS px) — 화면 높이에 비례(0.6～1.4배)
  POOL: 768,         // 3D 장면 공용 연기 입자 풀
  RGB_LO: heatOfPct(65), // 이 heat 부터 주황 → 빨강으로 바뀌기 시작(65%)
  RGB_HI: heatOfPct(95), // 〃 끝(95%)
  ORANGE: Object.freeze([1.0, 0.55, 0.16]),
  RED: Object.freeze([1.0, 0.2, 0.07]),
});

const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);
const ramp = (x, a, w) => clamp01((x - a) / w);

/** 보간된 heat → 그릴 단계 0..3 (heat-core heatStageOf 와 같은 문턱을 heat 축으로) */
export function heatDrawStage(h) {
  return h >= PHEAT.CRIT_H ? 3 : h >= PHEAT.HOT_H ? 2 : h > 0.001 ? 1 : 0;
}

/**
 * heat(0..1) → 연출 세기. 같은 입력이면 같은 값(3D·2D·재생 공용). reduced = 움직임 줄이기(연기·불티·플레어·맥동 없음, 정지 글로우만).
 *  haloPx 후광 화면 px 하한 · tint 몸 색 물듦 · ring 궤도 링·위성 단계색 · smokePx 연기 크기 화면 px 하한(멀리서 읽히는 큰 신호)
 *  warm  0..1 데움(표면·이음선 주황, 테두리) · wisp 0..1 데움 가는 김(30%↑, 50% 꽉) · hot 0..1 과열(균열·맥동·연기 가닥) · crit 0..1 위험(연기 꼬리·코로나·불티·플레어)
 *  glow  글로우 세기 · glowR 글로우 반지름(본체 배) · pulse 맥동 진폭 · pulseHz
 *  smoke 연기 가닥 입자/초 · tail 꼬리 입자/초(부모 반대쪽) · shade 연기 짙기 0(옅은 회색)..1(짙은 회색)
 *  ember 불티/초 · flare 플레어 확률/초 · color [r,g,b] 0..1(주황 → 빨강)
 */
export function heatLook(h, { reduced = false, estimated = false } = {}) {
  const x = clamp01(Number(h) || 0);
  const k = estimated ? PHEAT.EST_K : 1;
  const warm = warmOf(x);
  const hot = ramp(x, PHEAT.HOT_H, PHEAT.RAMP);
  const crit = ramp(x, PHEAT.CRIT_H, PHEAT.RAMP * 0.75);
  const wisp = x > 0.001 ? 0.45 + 0.55 * ramp(x, 0, PHEAT.WISP_H) : 0; // 30% 부터 가는 김(50% 에서 꽉)
  const move = reduced ? 0 : 1;
  return {
    stage: heatDrawStage(x), warm: warm * k, wisp: wisp * k, hot: hot * k, crit: crit * k,
    glow: (0.68 * warm + 0.2 * hot + 0.32 * crit) * k, // 멀리서도 읽히게 데움부터 밝게(40% ≈0.31 · 70% 0.88 · 95% 1.2)
    glowR: 1.6 + 0.45 * hot + 0.6 * crit,
    haloPx: 9 + 14 * warm + 9 * hot + 12 * crit, // 후광 반지름 화면 px 하한(본체 둘레에 더함, REF_H 기준) — 30% ≈12 · 40% ≈15 · 70% 32 · 95% 44
    tint: warm * (0.55 + 0.45 * hot) * k, // 몸 전체 색 물듦(멀리서 몸 색으로 읽힘)
    ring: (0.4 * warm + 0.3 * hot + 0.2 * crit) * k, // 궤도 링·위성 단계색 몫
    smokePx: 7 + 2.5 * hot + 4 * crit, // 연기 기준 반지름 화면 px 하한(REF_H 기준) — 멀리서도 가닥이 보이게
    pulse: move * (0.3 * hot + 0.15 * crit),
    pulseHz: 0.55 + 0.65 * crit,
    smoke: move * (1.5 * wisp * (1 - hot) + 3.4 * hot + 2 * crit) * k, // 30%↑ 가는 김 초당 0.7 → 50% 1.5 → 과열 3.4
    tail: move * 9 * crit * k,
    shade: 0.25 * hot + 0.7 * crit, // 위험 = 짙은 검은 연기
    ember: move * 1.6 * crit * k,
    flare: move * 0.14 * crit,
    color: heatRgb(x),
  };
}

/**
 * 데움 세기 0..1(3D 셰이더 MECH_F·SUBT_F·뚜르비용·2D 공용): 30% 에서 0.2 → 40% ≈0.46 → 50% ≈0.66 → 70%(HOT_H) 에서 1.
 * 2026-10-30 "40% 인데 변화가 안 보인다" → 바닥 0.06 → 0.2, 1.5제곱 → 0.8제곱(앞쪽이 빨리 오름, 40% 에서 예전의 약 2.6배). 셰이더는 같은 식을 GLSL 로(`warmGlsl`).
 */
export function warmOf(x) {
  return x > 0.001 ? 0.2 + 0.8 * Math.pow(Math.min(1, x / PHEAT.HOT_H), 0.8) : 0;
}
/** warmOf 의 GLSL 식(v = heat 변수 이름) */
export const warmGlsl = (v) => `(${v} > 0.001 ? 0.2 + 0.8 * pow(min(1.0, ${v} / ${PHEAT.HOT_H.toFixed(6)}), 0.8) : 0.0)`;

/** heat → [r,g,b](0..1): 데움 주황 → 위험 빨강(65%～95% 사이에서 바뀜) */
export function heatRgb(h, out = [0, 0, 0]) {
  const t = clamp01((clamp01(h) - PHEAT.RGB_LO) / (PHEAT.RGB_HI - PHEAT.RGB_LO));
  const s = t * t * (3 - 2 * t), A = PHEAT.ORANGE, B = PHEAT.RED;
  out[0] = A[0] + (B[0] - A[0]) * s; out[1] = A[1] + (B[1] - A[1]) * s; out[2] = A[2] + (B[2] - A[2]) * s;
  return out;
}

/** heat → CSS rgba(2D). a = 알파 */
export function heatCss(h, a) {
  const c = heatRgb(h);
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/** 노드당 살아 있는 연기 입자 상한(본체 화면 반지름 px 기준 거리 LOD) */
export function smokeCap(px) {
  return px >= PHEAT.PX_FULL ? PHEAT.CAP_NEAR : px >= PHEAT.PX_SMOKE ? PHEAT.CAP_MID : px >= PHEAT.PX_FAR ? PHEAT.CAP_FAR : 0;
}

/** 화면 px 하한 배율(화면 높이 H CSS px → REF_H 기준, 0.6～1.4) */
export function farK(H) {
  const k = (Number(H) || PHEAT.REF_H) / PHEAT.REF_H;
  return k < 0.6 ? 0.6 : k > 1.4 ? 1.4 : k;
}

/** heat → 궤도 링·위성·시안 부품 단계색 몫(0..0.9) — heatLook(h).ring 과 같은 값(프레임마다 객체 없이) */
export function heatRingK(h, estimated = false) {
  const x = clamp01(Number(h) || 0);
  return (0.4 * warmOf(x) + 0.3 * ramp(x, PHEAT.HOT_H, PHEAT.RAMP) + 0.2 * ramp(x, PHEAT.CRIT_H, PHEAT.RAMP * 0.75)) * (estimated ? PHEAT.EST_K : 1);
}

/** 연출을 켜 둘 노드인가: 완료·중지·퇴장·숨김은 끔(오류는 켬 — 과열로 쓰러진 모습도 보이게) */
export function heatLive(v) {
  if (!v || v.hidden || v.gone || v.exiting != null) return false;
  const st = v.node && v.node.status;
  return st !== 'done' && st !== 'stopped';
}

/** 켜짐 계수: 켜질 땐 바로 1, 꺼질 땐 OFF_S 초에 걸쳐 0 */
export function heatOnStep(prev, live, dt) {
  if (live) return 1;
  return Math.max(0, (prev ?? 0) - Math.max(0, Number(dt) || 0) / PHEAT.OFF_S);
}

const fract = (x) => x - Math.floor(x);
/** 결정적 해시 0..1(2D 연기 흔들림·플레어 시각 — 난수 없이 시각·번호로) */
export function hh(a, b = 0, c = 0) { return fract(Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453); }

/**
 * 2D 연기 입자 하나(상태 없이 시각만으로): 가닥 strand 의 i 번째(n 개 중) — 수명 life 초를 n 칸으로 엇갈려 태어남.
 * 돌려주는 값: { t: 0..1 나이, k: 몇 번째 생인지(정수 — 흔들림 시드), jit: -1..1 옆 흔들림 }
 * 같은 now 면 같은 값(재생·보관함·다시 그리기 모두 같게).
 */
export function puff2D(now, i, n, life, seed, out = {}) {
  const u = now / life + seed + i / n;
  const k = Math.floor(u);
  out.t = u - k; out.k = k; out.jit = hh(k, i, seed) * 2 - 1;
  return out;
}

/** 2D 플레어 세기(0..1): 위험 단계에서 period 초마다 한 번 꼴로 짧게(시드마다 다른 때·방향) */
export function flare2D(now, seed, crit, period = 5.3) {
  if (!(crit > 0)) return { k: 0, ang: 0 };
  const u = now / period + seed * 7.31, n = Math.floor(u), f = u - n;
  if (hh(n, seed) > 0.55) return { k: 0, ang: 0 };
  const k = f < 0.09 ? Math.sin((f / 0.09) * Math.PI) : 0;
  return { k: k * crit, ang: hh(n, seed, 3) * Math.PI * 2 };
}
