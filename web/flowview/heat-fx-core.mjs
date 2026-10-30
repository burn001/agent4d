// 흐름(Flow) 과열 연출 순수 값 — DOM·three·시계·난수 없음, node --test 대상(web/test/heat-fx.test.mjs).
// 3D(heat-fx.js)와 2D(flat/flow2d.js)가 같은 표를 쓴다: "얼마나 뜨거운가"는 heat-core.mjs(HeatBook) 가 정하고,
// 여기서는 화면에 그릴 heat(0..1, 보간된 값) → 모습(색·글로우·맥동·연기 가닥 수·불티·경고 파문)과 입자 하나의 자리를 정한다.
//
//  모습 단계(그리는 heat 기준 — compact 로 식을 때 단계를 거꾸로 거쳐 내려온다):
//    0 평상(heat 0)        아무것도 없음(비용 0)
//    1 데움(0 < h < HOT_H)       테두리·코어·글로우가 호박빛으로 뚜렷하게(30% 부터 눈에 띄게, 40% 면 한눈에) · 50%(WISP_H)부터 옅은 연기 한두 가닥 + 아지랑이
//    2 과열(HOT_H ≤ h < CRIT_H)  붉은 글로우 맥동 · 위로 피어오르는 연기 가닥 몇 줄 · 가끔 불티
//    3 위험(CRIT_H ≤ h)          짙은 연기 기둥 · 빨간 빠른 맥동 · 바닥에서 퍼지는 경고 파문
//  경계 HOT_H(≈0.571 = 70%)·CRIT_H(≈0.857 = 90%)는 heat-core.mjs 가 계산한 값(데움 30% 에서 heat 0).
//  입자는 상태가 없다: (입자 번호, 시각, 노드 씨앗)만으로 자리가 정해져(주기 함수) 장부·할당이 필요 없고 재생·보관함에서도 같은 모양이다.
//  움직임 줄이기(reduced)면 연기·불티·파문 없이 정지 글로우(맥동 없음)만.
import { HOT_H, CRIT_H, WISP_H } from '../heat-core.mjs';

export const HFX = Object.freeze({
  HAZE_MAX: 2,          // 데움 아지랑이 기운 수
  PUFF_MAX: 16,         // 노드당 연기 덩이 상한(위험 꽉 참)
  EMBER_MAX: 4,         // 노드당 불티 상한
  PUFF_LIFE: 2.8,       // 연기 덩이 한 생(초)
  EMBER_LIFE: 1.3,      // 불티 한 생(초)
  RISE: 3.2,            // 연기 오름 높이(노드 반지름 단위, 위험에서 ×1.35)
  RIPPLE_S: 1.6,        // 위험 경고 파문 주기(초)
  LOD_FULL_PX: 26,      // 노드 화면 반지름이 이만큼 이상이면 입자 전부
  LOD_MIN_PX: 6,        // 이보다 작으면 입자 없이 글로우만
  TOTAL_MAX: 900,       // 장면 전체 입자 상한(3D)
  FPS_2D: 15,           // 2D: 연기가 움직이는 동안 다시 그리는 빠르기(배경 움직임 등급)
});

const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);
const fract = (x) => x - Math.floor(x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** 결정적 해시(0..1) — 노드 씨앗·입자 번호에서 */
export const hash01 = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);

/** 그리는 heat → 모습 단계 0..3 (경계는 heat-core 단계표 70%·90% 와 같은 자리: HOT_H·CRIT_H) */
export const heatLookStage = (h) => (h >= CRIT_H ? 3 : h >= HOT_H ? 2 : h > 0.004 ? 1 : 0);

// 열 색 표(다크 = 빛, 라이트 = 진한 잉크 — 곱하기 잉크로 칠한다). 호박 → 주황 → 빨강 → 짙은 빨강
const RAMP_DARK = [[0, [1.0, 0.72, 0.30]], [HOT_H, [1.0, 0.46, 0.16]], [CRIT_H, [1.0, 0.20, 0.12]], [1, [0.95, 0.10, 0.10]]];
const RAMP_LIGHT = [[0, [0.86, 0.50, 0.06]], [HOT_H, [0.85, 0.32, 0.04]], [CRIT_H, [0.78, 0.12, 0.06]], [1, [0.66, 0.05, 0.06]]];
/** heat → rgb(0..1 배열, out 재사용) */
export function heatColor(h, light, out = [0, 0, 0]) {
  const R = light ? RAMP_LIGHT : RAMP_DARK, x = clamp01(h);
  let i = 0;
  while (i < R.length - 2 && x > R[i + 1][0]) i++;
  const [a, ca] = R[i], [b, cb] = R[i + 1], t = clamp01((x - a) / (b - a));
  for (let k = 0; k < 3; k++) out[k] = ca[k] + (cb[k] - ca[k]) * t;
  return out;
}
/** rgb 배열 → css 'rgb(…)' */
export const rgbCss = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

/** 연기 색(회색). 다크 = 밝은 회색 연기(남색 허공 위), 라이트 = 회색 잉크. 위험일수록 짙게 */
export function smokeColor(h, light, out = [0, 0, 0]) {
  const k = clamp01((h - HOT_H) / (1 - HOT_H));
  const g = light ? 0.52 - 0.18 * k : 0.7 - 0.14 * k;
  out[0] = g; out[1] = g * 1.01; out[2] = g * 1.05;
  return out;
}

/**
 * 맥동 0..1(1 = 가장 밝음): 데움은 거의 없음, 과열 ~1.1Hz, 위험 ~2Hz. reduced 면 1(정지).
 * t = 초, seed = 노드 씨앗(노드마다 위상이 다르게)
 */
export function heatPulse(h, t, seed = 0, reduced = false) {
  if (reduced || h < HOT_H) return 1;
  const hz = h >= CRIT_H ? 2.0 : 1.1;
  const amp = h >= CRIT_H ? 0.45 : 0.3;
  return 1 - amp * (0.5 - 0.5 * Math.cos(2 * Math.PI * (t * hz + seed)));
}

/**
 * 데움 곡선(3D 칩 셰이더·메인 몸·2D 공용 — 셰이더는 warmTintGlsl 같은 식). x = heat 0..1.
 * 2026-10-30 "40% 인데 눈에 띄는 변화가 없다" → 바닥값을 올리고 앞쪽이 빨리 오르는 거듭제곱으로:
 *   glow 30% 0.22 · 40% ≈0.40 · 50% ≈0.53 · 70% ≈0.73 · 100% 1   (예전 0.08 · 0.13 · 0.22 · 0.68 · 1)
 *   tint 30% 0.16 · 40% ≈0.31 · 50% ≈0.39 · 70% ≈0.55 · 85%↑ 0.68 (예전 0.06 · 0.10 · 0.18 · 0.52 · 0.68)
 */
export const warmGlow = (x) => 0.22 + 0.78 * Math.pow(clamp01(x), 0.75);
export const warmTint = (x) => 0.16 + 0.52 * Math.pow(Math.min(1, clamp01(x) / 0.85), 0.7);
/** warmTint 의 GLSL 식(v = heat 변수 이름) */
export const warmTintGlsl = (v) => `(0.16 + 0.52 * pow(min(1.0, ${v} / 0.85), 0.7))`;
/** warmGlow 의 GLSL 식 */
export const warmGlowGlsl = (v) => `(0.22 + 0.78 * pow(clamp(${v}, 0.0, 1.0), 0.75))`;

/**
 * 노드 하나의 연출 양. h = 그리는 heat, px = 노드 화면 반지름(거리 LOD), reduced = 움직임 줄이기, estimated = 창 추정(조금 약하게).
 * → { stage, glow(0..1 글로우 세기), tint(테두리·코어 물듦 0..1), wisp(데움 옅은 연기 세기 0..1), haze, puffs, embers, ripple(bool) } — 개수는 정수.
 */
export function heatLook(h, px = 999, reduced = false, estimated = false, out = {}) {
  const x = clamp01(h) * (estimated ? 0.85 : 1);
  const stage = heatLookStage(x);
  out.stage = stage;
  // 데움(30～70%): 30% 부터 뚜렷하게(glow 0.22·tint 0.16), 40% 면 한눈에(0.40·0.31), 70% 로 갈수록 짙게(warmGlow·warmTint)
  out.glow = stage ? warmGlow(x) : 0;
  out.tint = stage ? warmTint(x) : 0;
  const lod = reduced ? 0 : clamp01((px - HFX.LOD_MIN_PX) / (HFX.LOD_FULL_PX - HFX.LOD_MIN_PX));
  // 50%(WISP_H)부터 데움 안에서 옅은 연기 한두 가닥 + 아지랑이 — 문턱 뒤 0.07 에 걸쳐 짙어짐(툭 튀지 않게), 과열(4 가닥↑)로 이어짐
  out.wisp = stage === 1 ? smooth(WISP_H, WISP_H + 0.07, x) : 0;
  out.haze = out.wisp > 0 && lod > 0 ? Math.ceil(HFX.HAZE_MAX * lod) : 0;
  const pf = stage >= 2 ? (stage === 3 ? 10 + 6 * smooth(CRIT_H, 1, x) : 4 + 5 * smooth(HOT_H, CRIT_H, x)) : out.wisp > 0 ? (x >= (WISP_H + HOT_H) / 2 ? 2 : 1) : 0;
  out.puffs = Math.round(Math.min(HFX.PUFF_MAX, pf) * lod);
  out.embers = stage >= 2 ? Math.round((stage === 3 ? HFX.EMBER_MAX : 2) * lod) : 0;
  out.ripple = stage === 3 && !reduced && lod > 0;
  return out;
}

/**
 * 연기 덩이 i(0..n-1)의 지금 모습 — 노드 윗면 가운데 기준, 노드 반지름 단위.
 * → out { u(나이 0..1), x, y(오름), z, size, alpha(0..1) }. 가닥 셋에 나눠 올라가며 흔들리고, 오를수록 커지고 옅어진다.
 */
export function puffAt(i, n, t, seed, h, out = {}) {
  const life = HFX.PUFF_LIFE * (h >= CRIT_H ? 0.85 : 1);
  const u = fract(t / life + i / Math.max(1, n) + seed * 0.37);
  const strand = i % 3, sh = hash01(seed * 13 + strand * 7.1);
  const a0 = sh * Math.PI * 2 + strand * 2.1;
  const base = 0.28 + 0.18 * hash01(seed * 5 + i);
  const sway = Math.sin(t * 1.3 + i * 1.7 + seed * 9) * 0.22 * u;
  const lean = 0.35 * u * u;                       // 바람에 살짝 기움(노드마다 방향 다름)
  const la = seed * 6.283;
  out.u = u;
  out.x = Math.cos(a0) * base * (1 - u * 0.5) + sway + Math.cos(la) * lean;
  out.z = Math.sin(a0) * base * (1 - u * 0.5) + Math.sin(la) * lean;
  out.y = u * HFX.RISE * (h >= CRIT_H ? 1.15 : 1);
  out.size = (0.42 + 0.9 * u) * (h >= CRIT_H ? 1.2 : 1);
  // 굴뚝 연기처럼 윗면 가까이가 가장 짙고(빠르게 나타남) 오를수록 옅어진다 — 위로 멀리 가는 흐린 빛기둥으로 읽히지 않게
  out.alpha = (u < 0.1 ? u / 0.1 : 1) * Math.pow(1 - u, 1.25);
  return out;
}

/** 아지랑이 기운 i — 노드 바로 위에서 크고 흐리게 일렁임. → out { x, y, z, size, alpha } */
export function hazeAt(i, t, seed, out = {}) {
  const u = fract(t / 3.6 + i * 0.5 + seed * 0.21);
  out.x = Math.sin(t * 0.9 + i * 2 + seed * 7) * 0.15; out.z = 0;
  out.y = 0.15 + u * 0.9;
  out.size = 1.0 + 0.5 * u;
  out.alpha = Math.sin(Math.PI * u) * 0.5;
  return out;
}

/**
 * 불티 i — 노드 둘레에서 튀어 오르는 작은 점. 과열은 '가끔'(주기의 일부만 보임), 위험은 자주.
 * → out { on, x, y, z, size, alpha }
 */
export function emberAt(i, t, seed, h, out = {}) {
  const life = HFX.EMBER_LIFE;
  const cyc = t / life + i * 0.41 + seed * 0.73;
  const u = fract(cyc), k = Math.floor(cyc);
  const chance = h >= CRIT_H ? 0.8 : 0.35;              // 이번 생에 튈 확률(결정적)
  out.on = hash01(k * 3.7 + i * 11 + seed * 17) < chance;
  const a = hash01(k * 1.3 + i + seed * 5) * Math.PI * 2;
  const r = 0.35 + 0.5 * u;
  out.x = Math.cos(a) * r; out.z = Math.sin(a) * r;
  out.y = 0.1 + u * 1.9 - u * u * 0.6;
  out.size = 0.08 * (1 - 0.5 * u);
  out.alpha = out.on ? (1 - u) * (u < 0.1 ? u / 0.1 : 1) : 0;
  return out;
}

/** 위험 경고 파문 위상(0..1, 바닥에서 퍼지는 고리) — 반지름 = 1 + 1.2u, 알파 = (1-u)² */
export const rippleAt = (t, seed) => fract(t / HFX.RIPPLE_S + seed * 0.5);

/** 노드가 연출 대상인가: 끝남·중지·오류·퇴장·숨김은 꺼짐 */
export function heatEligible(v) {
  if (!v || v.gone || v.hidden || v.exiting != null) return false;
  const st = v.node && v.node.status;
  return st !== 'done' && st !== 'stopped' && st !== 'error';
}
