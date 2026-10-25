// 배경 환경(바닥 그리드·기상)의 순수 값·규칙. DOM·three 없이 node --test 로 시험한다(web/test/env.test.mjs).

// ───────── 바닥 그리드(3ds Max 홈 그리드 풍) ─────────
import { t as _t } from '../i18n.mjs';
/** 표현별 바닥 높이·칸·세기. 노드·빔·글자가 늘 앞서도록 아주 흐리게. gain = 가까이 다가갈 때 더하는 세기 배수 */
export const GROUND_TUNE = {
  // 흐름(Flow): 높이 계층 — 바닥(작업 대상 층 −2.2·섬 원판 −2.5) 바로 아래(예전 −1.2 는 노드 평면 y 0 바로 아래였다). 깊은 남색 허공 위 가산 혼합
  flow: {
    y: -2.7, cell: 2.5,
    dark: { minor: '#3b4f86', major: '#5a6fae', axisX: '#b4505a', axisY: '#4f9a6a', alpha: 0.46, gain: 1.4, additive: true },
    light: { minor: '#9aa8c8', major: '#7f8fb6', axisX: '#c46a72', axisY: '#5f9e78', alpha: 0.17, gain: 0.6, additive: false },
  },
  // Planet: 예전 GridHelper(y −12, 5칸) 자리를 대신한다(그리드를 끄면 예전 GridHelper 가 돌아옴)
  planet: {
    y: -12, cell: 5,
    dark: { minor: '#55669a', major: '#7083b8', axisX: '#c0606a', axisY: '#5aa874', alpha: 0.5, gain: 0.9, additive: false },
    light: { minor: '#a3aec4', major: '#8592ae', axisX: '#c46a72', axisY: '#5f9e78', alpha: 0.32, gain: 0.5, additive: false },
  },
  // 복셀: 건물 바닥판(y −0.2, 두께 0.24 → 아래면 −0.32)보다 아래 — 불투명 바닥·건물이 가려 건물 바깥 지면에만 보인다
  voxel: {
    y: -0.36, cell: 2,
    dark: { minor: '#4a5a84', major: '#6476a2', axisX: '#b4565f', axisY: '#509a6b', alpha: 0.45, gain: 0.8, additive: true },
    light: { minor: '#aab4c8', major: '#8e9ab3', axisX: '#c46a72', axisY: '#5f9e78', alpha: 0.3, gain: 0.4, additive: false },
  },
};
export function groundTune(mode, isLight) {
  const t = GROUND_TUNE[mode] || GROUND_TUNE.flow;
  return { y: t.y, cell: t.cell, ...(isLight ? t.light : t.dark) };
}
/** 거리 페이드 반경: 카메라가 멀수록 넓게(가까이서도 최소 70) */
export function gridFade(camDist) { return Math.max(70, (camDist || 0) * 2.0); }
/** 가까이 다가가면 보이는 선이 적어 더 허전해 보이므로 세기를 조금 올린다(먼 조망 1배 → 거리 30 이하 1+max 배) */
export function gridGain(camDist, max = 1.4) { const d = Number(camDist) || 0; return 1 + max * Math.max(0, Math.min(1, (120 - d) / 90)); }

// ───────── 기상 ─────────
export const WEATHER_MODES = ['auto', 'off', 'fog', 'rain', 'snow'];
export const WEATHER_LABEL = Object.fromEntries(WEATHER_MODES.map((m) => [m, _t('scene.wx.' + m)]));
export function normWeather(v) { const s = String(v || '').toLowerCase(); return WEATHER_MODES.includes(s) ? s : null; }

/** 입자 수(모바일·좁은 화면은 줄임). 비 줄기·눈송이·물방울 튐 */
export function particleCounts({ width = 1440, mobile = false } = {}) {
  const small = mobile || width < 720;
  return small ? { rain: 700, snow: 420, splash: 90 } : { rain: 2200, snow: 1300, splash: 260 };
}

/**
 * '자동' 기상 규칙(근거) — 세션 상태에 은근히 반응, 과하지 않게.
 *  - 상시: 아주 옅은 흐르는 안개(fog 0.35).
 *  - 최근 60초 오류(tool-end ok:false·status error·result 실패) 3건 이상 → 가는 비(rain 0.35～0.6, 오류 수에 비례), 마지막 오류 뒤 45초 유지.
 *  - 최근 5분 이벤트 0(긴 유휴) → 안개 짙게(0.35 → 최대 0.8, 5분～15분에 걸쳐 서서히).
 *  - 눈은 자동으로 내리지 않는다.
 * 입력: {nowMs, errorTimes:[ms…], lastEventMs}. 출력: {fog, rain, snow} 각 0..1(세기).
 */
export function autoWeather({ nowMs, errorTimes = [], lastEventMs = null } = {}) {
  const recent = errorTimes.filter((t) => nowMs - t <= 60_000);
  const lastErr = errorTimes.length ? Math.max(...errorTimes) : -Infinity;
  let rain = 0;
  if (recent.length >= 3) rain = Math.min(0.6, 0.35 + (recent.length - 3) * 0.05);
  else if (nowMs - lastErr <= 45_000 && errorTimes.filter((t) => lastErr - t <= 60_000).length >= 3) rain = 0.3;
  let fog = 0.35;
  if (lastEventMs != null) {
    const idle = nowMs - lastEventMs;
    if (idle > 300_000) fog = 0.35 + 0.45 * Math.min(1, (idle - 300_000) / 600_000);
  }
  return { fog, rain, snow: 0 };
}

/** 모드 → 목표 세기. 수동 모드는 상시(안개는 비·눈에도 옅게 깔림) */
export function weatherTarget(mode, auto = { fog: 0.35, rain: 0, snow: 0 }) {
  switch (mode) {
    case 'off': return { fog: 0, rain: 0, snow: 0 };
    case 'fog': return { fog: 0.85, rain: 0, snow: 0 };
    case 'rain': return { fog: 0.45, rain: 1, snow: 0 };
    case 'snow': return { fog: 0.4, rain: 0, snow: 1 };
    default: return { ...auto };
  }
}

/** 세기를 부드럽게 따라감(초당 rate) */
export function approach(cur, target, dt, rate = 0.5) {
  const d = target - cur;
  const step = rate * Math.max(0, dt);
  return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
}

/** 오류 이벤트 판정(자동 비의 근거) */
export function isErrorEvent(ev) {
  if (!ev) return false;
  if (ev.type === 'tool-end' && ev.ok === false) return true;
  if (ev.type === 'node-update' && ev.patch && ev.patch.status === 'error') return true;
  if (ev.type === 'result' && ev.ok === false) return true;
  return false;
}
