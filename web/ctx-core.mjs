// 컨텍스트 사용률 게이지·신호 열화의 순수 규칙. DOM·three 없음 — node --test 대상.
import { levelOf as limitLevel, WARN_PCT, DANGER_PCT } from './limits.js';
import { t as tr, fmtNum } from './i18n.mjs';

export { WARN_PCT, DANGER_PCT };

/**
 * 열화 단계 경계(창 대비 %) — 셰이더(noise.js)·2D(flat-degrade.js)·세기 D·그레인 진폭(degrade-core)·로우패스·험·권장 문구가
 * 모두 여기서 가져다 쓴다. 2026-10-26 "30% 넘으면 필름 그레인부터"로 20/40/58/75/95 → 30/50/70/90/98
 */
export const GRAIN_PCT = 30;      // 필름 그레인 시작
export const SCAN_PCT = 50;       // 주사선·색 바램
export const CHROMA_PCT = 70;     // 색수차·비네팅·글리치·배경음악 로우패스 시작
export const MOSH_PCT = 90;       // 데이터모시·험·"세션 정리 권장"
export const TOP_PCT = 98;        // 데이터모시·세기 D 가 꽉 차는 곳
export const GRAIN_FADE = [28, 32]; // 그레인이 0 에서 첫 진폭으로 켜지는 전이 구간

// name 은 지금 언어(사전 sound.ctx.stage.<key>): 선명·필름 그레인·주사선·색 바램·색수차·비네팅·글리치·데이터모시·험
const stage = (min, key) => ({ min, key, get name() { return tr(`sound.ctx.stage.${key}`); } });
export const STAGES = [
  stage(0, 'clean'),
  stage(GRAIN_PCT, 'grain'),
  stage(SCAN_PCT, 'scan'),
  stage(CHROMA_PCT, 'chroma'),
  stage(MOSH_PCT, 'mosh'),
];
export const NOISE_MIN_PCT = GRAIN_PCT;   // 이보다 낮으면 후처리 자체를 건너뛴다(비용 0)
export const RECOMMEND_PCT = MOSH_PCT;    // "세션 정리 권장" 문구
export const DEFAULT_STRENGTH = 0.5;

/** 사용률 → 단계 번호(0～4) */
export function stageOf(pct) {
  if (pct == null || !isFinite(pct)) return 0;
  let s = 0;
  for (let i = 0; i < STAGES.length; i++) if (pct >= STAGES[i].min) s = i;
  return s;
}

/** 게이지 색 단계: 기존 한도 게이지와 같은 규칙(70%↑ warn, 90%↑ danger) */
export const gaugeLevel = (pct) => limitLevel(pct);

const clamp01 = (x) => Math.max(0, Math.min(1, x));
export function smoothstep(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

/**
 * 효과 세기(셰이더·오디오와 같은 식). strength 0～1(기본 0.5 = 배율 1).
 * @returns {{L, amp, grain, scan, fade, chroma, vignette, glitch, mosh, lowpassHz, hum}}
 */
export function noiseParams(pct, strength = DEFAULT_STRENGTH) {
  const L = clamp01((pct || 0) / 100);
  const amp = Math.max(0, Math.min(1, strength)) * 2;
  const G = GRAIN_PCT / 100, S = SCAN_PCT / 100, C = CHROMA_PCT / 100, M = MOSH_PCT / 100, T = TOP_PCT / 100;
  const g0 = smoothstep(G, S, L), g = g0 * Math.sqrt(g0), s = smoothstep(S, C, L), c = smoothstep(C, M, L), m = smoothstep(M, T, L);
  // 배경음악 로우패스: CHROMA_PCT(70%) 부터 20kHz → 100% 에서 약 700Hz(세기가 셀수록 더 많이 깎음)
  const lp = smoothstep(C, 1.0, L) * Math.min(1, amp);
  return {
    L, amp,
    grain: g * amp, scan: s * amp, fade: s * amp, chroma: c * amp, vignette: c * amp, glitch: c * amp, mosh: m * Math.min(amp, 1.5),
    lowpassHz: Math.round(20000 * Math.pow(700 / 20000, lp)),
    hum: m * Math.min(1, amp),
  };
}

/** 후처리가 필요한가(하나라도 NOISE_MIN_PCT(30%) 이상이거나 정화 연출 중) */
export function noiseNeeded(levels, { enabled = true, strength = DEFAULT_STRENGTH, purging = false } = {}) {
  if (!enabled || !(strength > 0)) return false;
  if (purging) return true;
  return levels.some((p) => p >= NOISE_MIN_PCT);
}

/**
 * 급락(= /compact·자동 compact, 같은 세션에서 컨텍스트가 크게 줄어듦) 판정.
 * 이전 30%(NOISE_MIN_PCT) 이상에서 15%p 넘게, 그리고 이전의 70% 이하로 떨어졌을 때.
 */
export function isCtxDrop(prev, next) {
  if (!prev || !next || !isFinite(prev.pct) || !isFinite(next.pct)) return false;
  return prev.pct >= NOISE_MIN_PCT && prev.pct - next.pct >= 15 && next.pct <= prev.pct * 0.7;
}

/** 패널에 줄을 남길 구간(50·70·90 을 넘을 때만 — 매 응답마다 줄이 생기지 않게) */
export const NOTE_BANDS = [50, WARN_PCT, DANGER_PCT];
export function bandOf(pct) { let b = 0; for (const t of NOTE_BANDS) if (pct >= t) b++; return b; }

/**
 * node-update 의 ctx 변화 → 패널 줄 메모. 없으면 null.
 * @returns {{kind:'drop', from, to} | {kind:'up', pct, level} | null}
 */
export function ctxNote(prev, next) {
  if (!next) return null;
  if (isCtxDrop(prev, next)) return { kind: 'drop', from: prev.pct, to: next.pct };
  const b0 = prev ? bandOf(prev.pct) : 0, b1 = bandOf(next.pct);
  if (b1 > b0) return { kind: 'up', pct: next.pct, level: gaugeLevel(next.pct) };
  return null;
}

export function fmtTokens(n) {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1e6) return (Math.round(n / 1e5) / 10).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(Math.round(n));
}
export function pctText(p) {
  if (p == null || !isFinite(p)) return '—';
  return (p >= 10 ? Math.round(p) : Math.round(p * 10) / 10) + '%';
}
// 창 크기 근거(tag·observed·family·default) → 사전 sound.ctx.basis.<키>
const basisText = (b) => (['tag', 'observed', 'family', 'default'].includes(b) ? tr(`sound.ctx.basis.${b}`) : '');
/** 짧은 표시: `42% · 84k/200k` (추정이면 분모 뒤 `?`) */
export function ctxShort(c) {
  if (!c) return '';
  return `${pctText(c.pct)} · ${fmtTokens(c.used)}/${fmtTokens(c.limit)}${c.estimated ? '?' : ''}`;
}
/** 툴팁 여러 줄 */
// level: 열화 수준(기준 선택 — 절대량이면 늘어난 토큰으로 잰 값, 생략하면 pct), rec: 권장 문구 수준
export function ctxTitle(c, name = '', level = null, rec = RECOMMEND_PCT) {
  if (!c) return name ? `${name}\n${tr('sound.ctx.none')}` : tr('sound.ctx.none');
  const lv = level == null ? c.pct : level;
  const st = STAGES[stageOf(lv)];
  return [
    name && name,
    tr('sound.ctx.t.used', { pct: pctText(c.pct), used: fmtNum(Number(c.used)), limit: fmtNum(Number(c.limit)) }),
    tr('sound.ctx.t.window', { basis: basisText(c.basis) || (c.estimated ? tr('sound.ctx.estimated') : '') }),
    tr('sound.ctx.t.degrade', { stage: st.name }) + (lv >= rec ? tr('sound.ctx.t.recommend') : ''),
    tr('sound.ctx.t.source'),
  ].filter(Boolean).join('\n');
}

const SESSION_KINDS = new Set(['main', 'claude-p']);
/**
 * 상단 바 게이지가 보여 줄 노드.
 * 1) 포커스 노드(값이 있으면) 2) 단일 세션: 루트 3) 전체 보기: 고른 세션 메인 → 고른 프로젝트(또는 전체) 메인 중 가장 높은 것
 * @param {{nodes:Map, focusId?, root?, streamAll?, sel?, roots?:Array}} s
 * @returns {{id:string, why:'focus'|'root'|'session'|'max'}|null}
 */
export function pickGaugeNode({ nodes, focusId = null, root = null, streamAll = false, sel = null, roots = [] }) {
  const has = (id) => { const n = id && nodes.get(id); return n && n.meta && n.meta.ctx ? n : null; };
  if (has(focusId)) return { id: focusId, why: 'focus' };
  if (!streamAll) return has(root) ? { id: root, why: 'root' } : null;
  if (sel && sel.scope === 'session' && has('s:' + sel.sessionId)) return { id: 's:' + sel.sessionId, why: 'session' };
  const fp = sel && sel.scope !== 'all' ? sel.projectId || null : null;
  // /clear 로 끝난 앞 세션(새 메인 meta.clearedFrom)과, live 루트가 하나라도 있으면 지난(recent) 루트는 후보에서 뺀다.
  // 예전엔 /clear 앞 세션이 '지난 메인'으로 10분(살아 있는 기동기가 있으면 더) 머무는 동안 그 큰 값이 '최고'로 남았다.
  const cleared = new Set();
  for (const n of nodes.values()) { const cf = n && n.meta && n.meta.clearedFrom; if (cf) cleared.add('s:' + cf); }
  const inScope = (r) => !fp || !r.projectId || r.projectId === fp;
  const liveOnly = roots.some((r) => r.live === true && !r.orphanSdk && inScope(r));
  let best = null;
  const cand = roots.length ? roots.filter((r) => !liveOnly || r.live === true).map((r) => 's:' + r.sessionId) : [...nodes.keys()];
  for (const id of cand) {
    const n = has(id);
    if (!n || !SESSION_KINDS.has(n.kind) || (n.parentId && !roots.length) || cleared.has(id)) continue;
    if (fp && n.projectId && n.projectId !== fp) continue;
    if (!best || n.meta.ctx.pct > best.meta.ctx.pct) best = n;
  }
  return best ? { id: best.id, why: 'max' } : null;
}

/** 전체 보기 국소 열화 대상: 세션(루트)별 사용률이 문턱 이상인 것 중 높은 순 max 개 */
export function rankRegions(entries, max = 6, min = NOISE_MIN_PCT) {
  return entries.filter((e) => e.pct >= min || e.purging).sort((a, b) => ((b.purging ? 1 : 0) - (a.purging ? 1 : 0)) || b.pct - a.pct).slice(0, max);
}

/** 정화 연출 진행도(0～1, 끝나면 null). durMs 동안 왼쪽→오른쪽으로 쓸려 나감 */
export const PURGE_MS = 1400;
export function purgeProgress(startMs, nowMs, durMs = PURGE_MS) {
  if (startMs == null) return null;
  const k = (nowMs - startMs) / durMs;
  return k >= 1 || k < 0 ? null : k;
}

/** 신호 열화 국소 영역 상한(셰이더 배열 길이) — noise.js 에서 옮김 */
export const MAX_REGIONS = 6;

/** 정화 연출 상태(세션별). 급락을 보면 start, 프레임마다 get */
export class PurgeBook {
  constructor() { this.m = new Map(); }
  start(key, oldL, nowMs = performance.now()) { this.m.set(key, { t0: nowMs, oldL }); }
  get(key, nowMs = performance.now()) {
    const e = this.m.get(key);
    if (!e) return null;
    const p = purgeProgress(e.t0, nowMs, PURGE_MS);
    if (p == null) { this.m.delete(key); return null; }
    return { p, oldL: e.oldL };
  }
  get size() { return this.m.size; }
  clear() { this.m.clear(); }
}
