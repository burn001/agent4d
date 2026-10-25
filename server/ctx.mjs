// 컨텍스트 사용률. transcript 의 assistant 메시지 usage 로 세션(노드)별 컨텍스트 크기를 잰다.
// 순수 함수만 — session.mjs·demo.mjs·시험이 같이 쓴다.

export const CTX_DEFAULT = 200_000;
export const CTX_1M = 1_000_000;

/**
 * 컨텍스트 사용량 = input_tokens + cache_creation_input_tokens + cache_read_input_tokens (출력 토큰은 다음 요청의 입력이 될 때 센다).
 * Claude Code 상태줄과 같은 식. 값이 없거나 0 이면 null(합성 메시지·오류 응답).
 */
export function usageTokens(usage) {
  if (!usage || typeof usage !== 'object') return null;
  let t = 0;
  for (const k of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
    const v = Number(usage[k]);
    if (Number.isFinite(v) && v > 0) t += v;
  }
  return t > 0 ? Math.round(t) : null;
}

// 모델 id 에 1M 창 표기가 붙은 경우(`claude-sonnet-4-5[1m]`, `…-1m`)
const TAG_1M_RE = /\[1m\]|(?:^|[-_])1m(?:$|[-_\]])/i;
// 이 PC transcript 실측(2026-10-23, 최근 14일 1943개 파일): 같은 모델 id 로 200k 를 넘겨 compact 없이 이어진 모델.
//   claude-opus-5-5 최대 784,587 토큰(200k 초과 응답 38,827건), claude-opus-4-8 최대 472,465(633건).
//   haiku-5-5(최대 78,612)·sonnet-5-5(최대 119,196)는 200k 를 넘긴 적이 없어 모른다 → 기본값 + 추정.
// transcript 의 message.model 에는 `[1m]` 표기가 남지 않는다(실측 0건 — 표기는 skill 목록 첨부 글에만 있음).
const FAMILY_1M_RE = /claude-opus-5|claude-opus-4-8/i;

/**
 * 컨텍스트 창(분모) 판정.
 * @param {string|null} model  message.model (또는 requestedModel)
 * @param {number} maxSeen     이 노드에서 지금까지 본 가장 큰 사용량
 * @returns {{limit:number, basis:'tag'|'observed'|'family'|'default', estimated:boolean}}
 *  basis: tag = 모델 id 의 1M 표기, observed = 이 세션에서 200k 를 넘김(그 자체가 1M 창 증거),
 *         family = 이 PC 실측으로 1M 창이 확인된 모델 계열, default = 근거 없음(200k, estimated)
 */
export function contextWindow(model, maxSeen = 0) {
  const m = String(model || '');
  if (TAG_1M_RE.test(m)) return { limit: CTX_1M, basis: 'tag', estimated: false };
  if (maxSeen > CTX_DEFAULT) return { limit: CTX_1M, basis: 'observed', estimated: false };
  if (FAMILY_1M_RE.test(m)) return { limit: CTX_1M, basis: 'family', estimated: false };
  return { limit: CTX_DEFAULT, basis: 'default', estimated: true };
}

/** 노드 meta.ctx 값: {used, limit, pct(소수 1자리), estimated, basis} */
export function ctxValue(used, model, maxSeen = used) {
  const w = contextWindow(model, Math.max(maxSeen || 0, used || 0));
  const pct = Math.round((used / w.limit) * 1000) / 10;
  return { used, limit: w.limit, pct: Math.min(100, pct), estimated: w.estimated, basis: w.basis };
}

/**
 * 노드별 상태를 들고 assistant 레코드마다 부르는 추적기. 바뀐 경우에만 새 ctx 를 돌려준다.
 * 한 응답의 내용 블록마다 같은 usage 가 되풀이되므로 used 가 같으면 null.
 * /compact 뒤에는 다음 응답이 작은 값을 낸다(그대로 반영 — 웹이 급락을 '정화'로 그린다). /clear 는 새 세션(새 transcript)이다.
 */
export class CtxTracker {
  constructor() { this.m = new Map(); }
  /** @returns {object|null} 새 meta.ctx 또는 null(변화 없음·무시) */
  update(nodeId, msg) {
    if (!msg || typeof msg !== 'object') return null;
    const model = typeof msg.model === 'string' ? msg.model : '';
    if (model.startsWith('<')) return null; // <synthetic> 등 — usage 0
    const used = usageTokens(msg.usage);
    if (!used) return null;
    let s = this.m.get(nodeId);
    if (!s) { s = { used: 0, max: 0, model: '', base: used }; this.m.set(nodeId, s); }
    if (s.used === used && s.model === model) return null;
    s.used = used; s.model = model;
    if (used > s.max) s.max = used;
    // 기준선: 첫 유효 응답 값. compact 뒤 작은 값으로 다시 잡지 않고 원래 값을 유지하되, 그보다 작아지면 낮춘다(= 최솟값)
    if (used < s.base) s.base = used;
    return { ...ctxValue(used, model, s.max), base: s.base };
  }
  forget(nodeId) { this.m.delete(nodeId); }
}

// ───────────── --demo 합성 값 ─────────────
const DEMO_KINDS = new Set(['main', 'claude-p', 'subagent', 'workflow-agent']);
const DEMO_MAIN_BASE = { '': 0.22, 'a1-': 0.8, 'a2-': 0.47, 'b1-': 0.63, 'c1-': 0.12 };
const hash01 = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; };

/** 데모 그래프의 에이전트류 노드에 처음 값을 넣는다(메인은 런타임마다 다른 수준 → 전체 보기 섬마다 열화 정도가 다름) */
export function seedDemoCtx(g, px = '', ts) {
  for (const n of g.nodes.values()) {
    if (!DEMO_KINDS.has(n.kind)) continue;
    const isMain = n.kind === 'main';
    const limit = contextWindow(n.model).limit;
    const frac = isMain ? (DEMO_MAIN_BASE[px] ?? 0.3) : 0.04 + hash01(n.id) * 0.4;
    const used = Math.round(limit * frac);
    // 기준선: 데모는 대화가 이미 진행된 세션처럼 시작값의 60% 를 첫 응답으로 둔다(섬마다 늘어난 양이 다르게)
    g.updateNode(n.id, { meta: { ctx: { ...ctxValue(used, n.model), base: Math.round(used * 0.6) } } }, ts);
  }
}

/** 데모 한 걸음: 고른 노드 사용량을 올리고, 96% 를 넘으면 compact 처럼 18% 로 떨어뜨린다 */
export function stepDemoCtx(g, nodeId, ts) {
  const n = g.get(nodeId);
  const c = n && n.meta && n.meta.ctx;
  if (!c) return;
  const inc = c.limit * (n.kind === 'main' ? 0.03 : 0.02);
  const used = c.pct >= 96 ? Math.round(c.limit * 0.18) : Math.round(c.used + inc);
  const base = c.base != null ? Math.min(c.base, used) : undefined;
  g.updateNode(nodeId, { meta: { ctx: base != null ? { ...ctxValue(used, n.model), base } : ctxValue(used, n.model) } }, ts);
}
