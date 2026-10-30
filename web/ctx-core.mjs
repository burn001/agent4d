// 컨텍스트 사용률 게이지의 순수 규칙. DOM·three 없음 — node --test 대상.
// 신호 열화는 2026-10-30 폐지 — 에이전트별 과열 표현(heat-core.mjs)으로 대체.
import { levelOf as limitLevel, WARN_PCT, DANGER_PCT } from './limits.js';
import { t as tr, fmtNum } from './i18n.mjs';
import { HEAT, HEAT_STAGES, heatStageOf } from './heat-core.mjs';

export { WARN_PCT, DANGER_PCT };

/** 급락(compact) 판정에 쓰는 이전 값 하한(%) — 이보다 낮던 세션의 하락은 패널에 '정리' 줄을 남기지 않는다 */
export const DROP_MIN_PCT = 30;

/** 게이지 색 단계: 기존 한도 게이지와 같은 규칙(70%↑ warn, 90%↑ danger) */
export const gaugeLevel = (pct) => limitLevel(pct);

/**
 * 급락(= /compact·자동 compact, 같은 세션에서 컨텍스트가 크게 줄어듦) 판정.
 * 이전 30%(DROP_MIN_PCT) 이상에서 15%p 넘게, 그리고 이전의 70% 이하로 떨어졌을 때.
 */
export function isCtxDrop(prev, next) {
  if (!prev || !next || !isFinite(prev.pct) || !isFinite(next.pct)) return false;
  return prev.pct >= DROP_MIN_PCT && prev.pct - next.pct >= 15 && next.pct <= prev.pct * 0.7;
}

/** 패널에 줄을 남길 구간(30·70·90 을 넘을 때만 — 매 응답마다 줄이 생기지 않게) */
export const NOTE_BANDS = [HEAT.WARM_PCT, WARN_PCT, DANGER_PCT]; // 첫 칸 = 과열 데움 시작(30)과 같게
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
/** 툴팁 여러 줄: 사용량 · 창 근거 · 과열 단계(창 대비 %) · 출처 */
export function ctxTitle(c, name = '') {
  if (!c) return name ? `${name}\n${tr('sound.ctx.none')}` : tr('sound.ctx.none');
  return [
    name && name,
    tr('sound.ctx.t.used', { pct: pctText(c.pct), used: fmtNum(Number(c.used)), limit: fmtNum(Number(c.limit)) }),
    tr('sound.ctx.t.window', { basis: basisText(c.basis) || (c.estimated ? tr('sound.ctx.estimated') : '') }),
    tr('sound.ctx.t.heat', { stage: heatName(heatStageOf(c.pct)) }),
    tr('sound.ctx.t.source'),
  ].filter(Boolean).join('\n');
}
/** 과열 단계 이름(지금 언어): 평상·데움·과열·위험 */
export const heatName = (stage) => tr(`sound.ctx.heat.${HEAT_STAGES[Math.max(0, Math.min(3, stage | 0))].key}`);

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

// ── 기준선(첫 유효 응답 usage) — 카드·툴팁의 '시작 63k · 늘어난 양 +152k' 표시용(예전 degrade-core.mjs 에서 옮김) ──
// compact 뒤에도 원래 기준선을 유지하되 그보다 작아지면 낮춘다(= 지금까지 본 최솟값).
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
