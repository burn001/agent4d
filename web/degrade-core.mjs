// 신호 열화 2차 순수 규칙 — DOM·three 없음, node --test 대상.
//  · 기준(basis): 'abs' 절대 토큰량(기본) · 'pct' 창 대비 %. 어느 쪽이든 '열화 수준'(0～100, 예전 % 와 같은 눈금)으로 바꿔
//    단계(stageOf)·셰이더·오디오·정화 판정이 같은 값을 쓴다.
//  · 세션 열화 세기 D(0～1) — 메인 잔상·글자 깨짐·흐름선 끊김의 공통 입력.
//  · 문턱 버스트(단계가 오르는 순간 0.5초), 글자 깨짐·패킷 소실·선 끊김의 결정적 해시.
//  · 렌더러가 읽는 실행 상태 DEG(ctx-ui 가 채움). 꺼져 있으면 degOf() 가 바로 0 — 렌더러 비용 0.
import { stageOf, STAGES } from './ctx-core.mjs';

export const BASIS_ABS = 'abs';
export const BASIS_PCT = 'pct';
export const DEFAULT_BASIS = BASIS_ABS;
export const normBasis = (v) => (v === BASIS_PCT ? BASIS_PCT : BASIS_ABS);

/**
 * 절대량 기준 = 대화로 늘어난 양(used − 기준선). 기준선(base)은 노드별 첫 유효 응답 usage — 시스템 프롬프트·도구·스킬·메모리만으로
 * 이미 수십 k 라 그 위에 쌓인 양으로 잰다. compact 뒤에도 원래 기준선을 유지하되 그보다 작아지면 낮춘다(= 지금까지 본 최솟값).
 * 늘어난 양 → 열화 수준(예전 % 눈금) 꺾은선. 이 PC 실측(최근 14일 메인 498세션, 2026-10-24): 첫 응답 중앙값 63k(10～90% 54～73k),
 * 세션 최대 증가량 중앙값 +100k · 75% +199k · 90% +268k · 95% +334k · 99% +477k, 머문 시간 비율 ≥+50k 81% · ≥+150k 37% · ≥+300k 4.7% · ≥+500k 0.2%.
 * → +50k 그레인 시작 · +100k 주사선 · +150k 색수차·글리치(뚜렷) · +300k 데이터모시(심함) · +500k 최대·"세션 정리 권장".
 */
export const ABS_KNOTS = [[0, 0], [50e3, 20], [100e3, 40], [150e3, 58], [300e3, 75], [500e3, 95], [600e3, 100]];
/** 단계 경계 증가량(STAGES 와 같은 순서) — 카드 단계표 */
export const ABS_STAGE_TOKENS = [0, 50e3, 100e3, 150e3, 300e3];
/** 권장 문구·험 기준 열화 수준: 절대량 +500k(95), 창 대비 75% */
export const ABS_RECOMMEND = 500e3;
export const recommendLevel = (basis) => (normBasis(basis) === BASIS_ABS ? 95 : 75);
/** 기준선을 모를 때(서버가 base 를 안 보낸 예전 값·세션 중간에 처음 본 스냅샷) 쓰는 상한 — 첫 응답 실측 중앙값 근처 */
export const FALLBACK_BASE = 60e3;
/** 기준선: 서버 base → 이 화면에서 본 최솟값(seen) → min(지금 값, FALLBACK_BASE) */
export function baseOf(c, seen = null) {
  if (!c) return 0;
  const u = Number(c.used) || 0;
  if (c.base != null && isFinite(c.base)) return Math.min(u, c.base);
  if (seen != null && isFinite(seen)) return Math.min(u, seen);
  return Math.min(u, FALLBACK_BASE);
}
export const grownOf = (c, seen = null) => (c ? Math.max(0, (Number(c.used) || 0) - baseOf(c, seen)) : 0);

export function absLevel(used) {
  const u = Number(used);
  if (!isFinite(u) || u <= 0) return 0;
  for (let i = 1; i < ABS_KNOTS.length; i++) {
    const [x1, y1] = ABS_KNOTS[i];
    if (u <= x1) { const [x0, y0] = ABS_KNOTS[i - 1]; return y0 + ((u - x0) / (x1 - x0)) * (y1 - y0); }
  }
  return 100;
}

/** meta.ctx → 열화 수준(0～100). 기준이 창 대비면 pct 그대로, 절대량이면 늘어난 양(seen: 기준선을 모를 때 이 화면에서 본 최솟값) */
export function levelOf(c, basis = DEFAULT_BASIS, seen = null) {
  if (!c) return 0;
  if (normBasis(basis) === BASIS_PCT) return isFinite(c.pct) ? Math.max(0, Math.min(100, c.pct)) : 0;
  return Math.round(absLevel(grownOf(c, seen)) * 10) / 10;
}
export const stageOfCtx = (c, basis, seen) => stageOf(levelOf(c, basis, seen));

/** 단계표 문구: 절대량이면 토큰, 창 대비면 % */
export function stageTable(basis = DEFAULT_BASIS) {
  const abs = normBasis(basis) === BASIS_ABS;
  return STAGES.map((s, i) => ({ key: s.key, name: s.name, at: abs ? (i ? '+' + Math.round(ABS_STAGE_TOKENS[i] / 1000) + 'k' : '+0') : s.min + '%' }));
}

/** 열화 수준 → 세션 열화 세기 D(0～1). 20(그레인 시작)에서 0, 95 에서 1 */
export function degD(level) {
  const L = Number(level) || 0;
  return Math.max(0, Math.min(1, (L - 20) / 75));
}
/** 세기 슬라이더(0～1, 기본 0.5 = 배율 1)를 곱한 D */
export const degScaled = (level, strength) => Math.min(1, degD(level) * Math.max(0, Math.min(1, strength)) * 2);

/** 단계 넘김: 이전·다음 열화 수준 → {dir:'up'|'down'|null, from, to}. 처음 값(prev 없음)은 넘김 아님 */
export function stageCross(prevLevel, nextLevel) {
  if (prevLevel == null || nextLevel == null || !isFinite(prevLevel) || !isFinite(nextLevel)) return { dir: null, from: null, to: null };
  const a = stageOf(prevLevel), b = stageOf(nextLevel);
  return { dir: b > a ? 'up' : b < a ? 'down' : null, from: a, to: b };
}

/** 버스트를 낼지: 단계가 올랐고, 조용한(스크럽·밀린 이벤트·재생 seek) 이벤트가 아니고, 움직임 줄이기·꺼짐이 아닐 때 */
export function burstWanted(cross, { quiet = false, reduced = false, enabled = true, strength = 0.5 } = {}) {
  return !!cross && cross.dir === 'up' && cross.to >= 1 && !quiet && !reduced && enabled && strength > 0;
}

export const BURST_MS = 500;
export const BURST_GAP_MS = 2500; // 같은 세션에서 연달아 넘기면(빠른 재생) 2.5초에 한 번만
/** 버스트 세기 곡선(0～1): 앞 15% 꽉 차게, 뒤로 줄어듦. 끝나면 0 */
export function burstEnv(t0, now, dur = BURST_MS) {
  if (t0 == null) return 0;
  const k = (now - t0) / dur;
  if (k < 0 || k >= 1) return 0;
  return k < 0.15 ? 1 : (1 - k) / 0.85;
}
export class BurstBook {
  constructor() { this.m = new Map(); }
  /** 시작했으면 true(간격 안이면 false) */
  start(key, now) {
    const e = this.m.get(key);
    if (e && now - e.t0 < BURST_GAP_MS) return false;
    this.m.set(key, { t0: now });
    return true;
  }
  get(key, now) {
    const e = this.m.get(key);
    if (!e) return 0;
    const k = burstEnv(e.t0, now);
    if (k <= 0 && now - e.t0 > BURST_GAP_MS) this.m.delete(key);
    return k;
  }
  any(now) { for (const e of this.m.values()) if (now - e.t0 < BURST_MS) return true; return false; }
  clear() { this.m.clear(); }
  get size() { return this.m.size; }
}

// ---- 결정적 해시(0～1). 난수 대신 써서 같은 시각이면 같은 모습(재현·시험) ----
export function hash2(a, b) {
  let h = Math.imul((a | 0) ^ 0x27d4eb2d, 0x9e3779b1) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca77);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
export function seedOf(s) {
  if (typeof s === 'number') return (s * 100003) | 0;
  let h = 2166136261;
  const t = String(s ?? '');
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

// ---- 글자 깨짐 ----
export const GLYPHS = ['▒', '?', '░', '▓', '#', '¿'];
/** D → 요소마다 초당 깨짐 횟수·지속(ms)·바뀌는 글자 비율 */
export function textGlitchPlan(D) {
  const d = Math.max(0, Math.min(1, D || 0));
  if (d <= 0) return { rate: 0, ms: 0, frac: 0 };
  return { rate: 0.12 + 1.3 * Math.pow(d, 1.2), ms: Math.round(110 + 300 * d), frac: 0.1 + 0.32 * d };
}
const isBlank = (c) => c === ' ' || c === ' ' || c === '\n' || c === '\t' || c === '·' || c === '…';
/** 글자 일부를 GLYPHS 로(공백·구분점은 그대로, 적어도 한 글자). 원문은 바꾸지 않고 새 문자열 */
export function glitchStr(s, frac, seed = 0) {
  const t = String(s ?? '');
  if (!t || frac <= 0) return t;
  const chars = Array.from(t);
  let hit = 0, first = -1;
  for (let i = 0; i < chars.length; i++) {
    if (isBlank(chars[i])) continue;
    if (first < 0) first = i;
    const h = hash2(seed, i);
    if (h < frac) { chars[i] = GLYPHS[Math.floor(hash2(seed + 7, i) * GLYPHS.length)]; hit++; }
  }
  if (!hit && first >= 0) chars[first] = GLYPHS[Math.floor(hash2(seed + 3, first) * GLYPHS.length)];
  return chars.join('');
}
/**
 * 캔버스 글(2D 카드·이름)용: 시각 t(초)에 이 글이 깨져 보여야 하면 깨진 문자열, 아니면 원문 그대로(새 문자열 없음).
 * 글마다 위상(seed)이 달라 한꺼번에 깨지지 않는다
 */
export function glitchAt(s, D, t, seed = 0) {
  if (!(D > 0) || !s) return s;
  const p = textGlitchPlan(D);
  const P = 1 / p.rate, ph = t / P + hash2(seed, 11);
  const w = Math.floor(ph);
  if (ph - w >= (p.ms / 1000) / P) return s;
  if (hash2(seed, w) > 0.75) return s; // 칸마다 조금씩 빠져 규칙적으로 보이지 않게
  return glitchStr(s, p.frac, seed ^ (w * 2654435761));
}

// ---- 흐름선·패킷 ----
/** 패킷이 이 구간(u)에서 사라지나 — 양 끝 12%는 늘 보임(어디서 와서 어디로 가는지는 남김) */
export function packetGone(seed, u, D) {
  if (!(D > 0) || u < 0.12 || u > 0.88) return false;
  return hash2(seed, Math.floor(u * 9)) < D * 0.5;
}
/** 선 조각 i 가 시각 t 에 끊겼나(약 0.3초마다 바뀜) */
export function lineGap(seed, i, t, D) {
  if (!(D > 0)) return false;
  return hash2(seed * 31 + i, Math.floor(t * 3.3)) < D * 0.38;
}
/** 선 밝기 배율(잡음 깜빡임) 1-0.75D ～ 1 */
export function lineFlicker(seed, t, D) {
  if (!(D > 0)) return 1;
  const h = hash2(seed, Math.floor(t * 14));
  return 1 - D * 0.75 * h * h;
}
/** 선 정점 흔들림(-0.5～0.5)×D */
export function lineJitter(seed, i, t, D) {
  if (!(D > 0)) return 0;
  return (hash2(seed + i * 17, Math.floor(t * 20)) - 0.5) * D;
}

// ---- 메인 노드 잔상·윤곽 이중화·끊김(화면 px) ----
export const GHOST_LAG = 0.2; // 잔상이 늦게 따라오는 시간(초)
/**
 * 시각 t 의 메인 노드 화면 오프셋. out = {ax, ay(본체), bx, by(잔상)} — 화면 px(위가 +y), dpr 곱하기 전.
 * 본체는 D 에 비례해 흔들리고 가끔 끊겨 튄다(stutter), 잔상은 0.2초 전 흔들림 + 늘 조금 비켜 난 윤곽(이중화).
 * reduced: 흔들림·끊김 없이 고정된 이중 윤곽만
 */
export function ghostOffsets(D, t, seed, reduced, out) {
  out.ax = 0; out.ay = 0; out.bx = 0; out.by = 0; out.stutter = false;
  if (!(D > 0)) return out;
  const c0 = 2 + 5 * D;
  if (reduced) { out.bx = c0; out.by = -c0 * 0.4; return out; }
  const A = 2 + 6 * D, ph = (seed & 1023) / 163;
  const wx = (tt) => A * (Math.sin(tt * 2.1 + ph) * 0.7 + Math.sin(tt * 5.3 + ph * 2) * 0.3);
  const wy = (tt) => A * 0.6 * Math.cos(tt * 1.7 + ph);
  out.ax = wx(t); out.ay = wy(t);
  out.bx = wx(t - GHOST_LAG) + c0; out.by = wy(t - GHOST_LAG) - c0 * 0.4;
  const slot = Math.floor(t / 0.11);
  if (hash2(seed, slot) < 0.04 + 0.14 * D) {
    out.stutter = true;
    const J = 5 + 12 * D;
    out.ax += (hash2(seed + 1, slot) - 0.5) * 2 * J; out.ay += (hash2(seed + 2, slot) - 0.5) * J;
  }
  return out;
}

// ---- 실행 상태(ctx-ui 가 채우고 렌더러가 읽음) ----
export const DEG = {
  on: false,          // 하나라도 열화 중(꺼짐·세기 0·모두 문턱 아래면 false → degOf 0)
  reduced: false,
  t: 0,               // 초(600초 주기로 감김, 일시정지 중 멈춤)
  base: new Map(),    // nodeId → D(세션 기준)
  sessOf: new Map(),  // nodeId → 세션 키('full' | 's:<id>')
  burst: new Map(),   // 세션 키 → 버스트 0～1(프레임마다)
};
/** 노드의 열화 세기(버스트 포함, 0～1). 꺼져 있으면 0 */
export function degOf(id) {
  if (!DEG.on || id == null) return 0;
  const b = DEG.base.get(id) || 0;
  if (!DEG.burst.size) return b;
  const k = DEG.burst.get(DEG.sessOf.get(id)) || 0;
  return k ? Math.min(1, b + k * 0.9) : b;
}
/** 두 노드(흐름선 양 끝) 중 큰 값 */
export const degOfLink = (a, b) => (DEG.on ? Math.max(degOf(a), degOf(b)) : 0);

/** 2D 캔버스 끊긴 선 무늬(setLineDash 용, out 배열 재사용) — 약 0.3초마다 바뀜. unit = 화면 px 단위 */
export function brokenDash(seed, t, D, unit, out) {
  const f = Math.floor(t * 3.3);
  out[0] = unit * (2 + 6 * hash2(seed, f)); out[1] = unit * (0.6 + 3.2 * D * hash2(seed + 1, f));
  out[2] = unit * (1 + 4 * hash2(seed + 2, f)); out[3] = unit * (0.4 + 2.6 * D * hash2(seed + 3, f));
  return out;
}

/**
 * 필름 그레인 진폭(화면 값 /255 단위, 세기 배율 1 기준). L = 열화 수준/100.
 * 그레인 시작(수준 20 = +50k)부터 ±10, 58(150k) ±20, 95(500k) ±30. 셰이더(noise.js)·2D(flat-degrade.js)가 같은 식
 */
export function grainAmp(L) {
  const x = Number(L) || 0;
  const ss = (a, b) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return ss(0.18, 0.22) * (10 + 10 * ss(0.20, 0.58) + 10 * ss(0.58, 0.95));
}
