// 에이전트 과열 공용 코어 — 순수 함수, DOM·three 없음, node --test 대상(web/test/heat.test.mjs).
// 2026-10-30 신호 열화(화면 전체 후처리)를 폐지하고, 에이전트(노드)마다 자기 컨텍스트 비율(meta.ctx.pct = 창 대비 %)에 따라
// 표현이 달라지게 바꿨다. 이 모듈은 "얼마나 뜨거운가"만 정하고, 어떻게 보일지는 표현(흐름·Planet·복셀, 3D·2D)이 정한다.
//
//  · 입력: 노드의 meta.ctx({used, limit, pct, estimated, basis, base?}) — main·subagent·claude-p·workflow-agent 등 값이 있는 모든 에이전트.
//    서버(server/ctx.mjs CtxTracker)가 응답 usage 로 채우고, mock(ctx-mock.mjs)·--demo(server/ctx.mjs seedDemoCtx)도 같은 모양.
//  · 출력: heatOf(c) → { heat: 0..1 연속값, stage: 0|1|2|3, pct, estimated }
//      stage 0 평상(< 30%) · 1 데움(30%～) · 2 과열(70%～) · 3 위험(90%～)
//      heat  = (pct - 30) / 70 를 0..1 로 자른 값 — 30% 에서 0, 100% 에서 1(30% 미만은 0)
//      heat 축의 단계 경계는 HOT_H(≈0.571, 70%)·CRIT_H(≈0.857, 90%) — 표현은 이 두 상수만 쓴다(숫자를 하드코딩하지 말 것)
//  · 재생·보관함·전체 보기: 노드 상태(그 시점 meta.ctx)만으로 계산하므로 같은 시점이면 같은 값이다(시계·난수 없음).
//  · compact 로 급락하면 목표 heat 가 바로 0 근처로 떨어진다 — 화면은 approachHeat()/HeatBook 으로 몇 초에 걸쳐 식힌다
//    (오를 땐 빠르게 RISE_TAU, 내릴 땐 초당 1/COOL_S 씩 — 꽉 찬 과열이 다 식는 데 약 4초).
//  · 움직임 줄이기(prefers-reduced-motion): 이 모듈은 판단하지 않는다. 각 표현 뷰가 이미 들고 있는 view.reduced
//    (flowview/flow-view.js·planet-view.js·voxel/office.js·flat/flat-view.js — matchMedia('(prefers-reduced-motion: reduce)'))
//    를 그대로 써서 연기 흐름·흔들림·깜빡임을 멈추고, 색·글로우 같은 정지 표현만 남긴다.

export const HEAT = Object.freeze({
  WARM_PCT: 30,   // stage 1 데움 — heat 가 0 에서 오르기 시작(2026-10-30 50 → 30)
  HOT_PCT: 70,    // stage 2 과열
  CRIT_PCT: 90,   // stage 3 위험
  FULL_PCT: 100,  // heat 1
  RISE_TAU: 0.35, // 오를 때 지수 접근 시간 상수(초) — 1초면 거의 다 따라감
  COOL_S: 4,      // 내릴 때 heat 1 → 0 이 걸리는 시간(초). 선형
});

/** heat 축의 과열 시작(70%) ≈ 0.571 */
export const HOT_H = (HEAT.HOT_PCT - HEAT.WARM_PCT) / (HEAT.FULL_PCT - HEAT.WARM_PCT);
/** heat 축의 위험 시작(90%) ≈ 0.857 */
export const CRIT_H = (HEAT.CRIT_PCT - HEAT.WARM_PCT) / (HEAT.FULL_PCT - HEAT.WARM_PCT);
/** 데움 안의 작은 문턱 — 50% 부터 옅은 연기 한두 가닥·아지랑이(복셀은 머리 위 옅은 김). 단계(stage)는 아니다(2026-10-30) */
export const WISP_PCT = 50;
/** heat 축의 옅은 연기 시작(50%) ≈ 0.286 */
export const WISP_H = (WISP_PCT - HEAT.WARM_PCT) / (HEAT.FULL_PCT - HEAT.WARM_PCT);

/** 단계 표(카드·툴팁·시험 공용). key 는 i18n 사전 sound.ctx.heat.<key> */
export const HEAT_STAGES = Object.freeze([
  Object.freeze({ stage: 0, key: 'cool', min: 0 }),
  Object.freeze({ stage: 1, key: 'warm', min: HEAT.WARM_PCT }),
  Object.freeze({ stage: 2, key: 'hot', min: HEAT.HOT_PCT }),
  Object.freeze({ stage: 3, key: 'crit', min: HEAT.CRIT_PCT }),
]);

const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);

/** meta.ctx → 창 대비 %(0～100). 값이 없거나 이상하면 0 */
export function ctxPctOf(c) {
  const p = c && Number(c.pct);
  return Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
}

/** % → 단계 0|1|2|3 */
export function heatStageOf(pct) {
  const p = Number(pct);
  if (!Number.isFinite(p)) return 0;
  return p >= HEAT.CRIT_PCT ? 3 : p >= HEAT.HOT_PCT ? 2 : p >= HEAT.WARM_PCT ? 1 : 0;
}

/** % → heat 0..1(30% 이하 0, 100% 1, 사이는 선형) */
export function heatOfPct(pct) {
  const p = Number(pct);
  if (!Number.isFinite(p)) return 0;
  return clamp01((p - HEAT.WARM_PCT) / (HEAT.FULL_PCT - HEAT.WARM_PCT));
}

/** 값이 없을 때 돌려주는 고정 객체(새 객체를 만들지 않음 — 프레임마다 불러도 쓰레기 없음) */
export const NO_HEAT = Object.freeze({ heat: 0, stage: 0, pct: 0, estimated: false, known: false });

/**
 * meta.ctx → { heat, stage, pct, estimated, known }. known = 값이 있었나(없으면 NO_HEAT).
 * estimated(창 크기 추정, 200k 기본값)는 표현이 원하면 조금 약하게 그리는 데 쓸 수 있다 — 값 자체는 그대로.
 */
export function heatOf(c) {
  if (!c || !Number.isFinite(Number(c.pct))) return NO_HEAT;
  const pct = ctxPctOf(c);
  return { heat: heatOfPct(pct), stage: heatStageOf(pct), pct, estimated: !!c.estimated, known: true };
}

/** 노드(store.nodes 값 또는 view.vis 의 v.node) → heatOf(node.meta.ctx) */
export const nodeHeat = (node) => heatOf(node && node.meta ? node.meta.ctx : null);

/**
 * 화면용 보간: 지금 그리는 값 prev 를 목표 target 쪽으로 dt(초)만큼.
 * 오를 땐 빠르게(지수, RISE_TAU), 내릴 땐 선형으로 천천히(초당 1/COOL_S) — compact 급락이 "식는" 모습이 된다.
 * prev 가 없으면(처음 본 노드) 바로 target. opts.snap(재생 seek·표현 바꿈·보관함 열기)도 바로 target.
 */
export function approachHeat(prev, target, dt, { snap = false } = {}) {
  const t = clamp01(Number(target) || 0);
  if (snap || prev == null || !Number.isFinite(prev)) return t;
  const d = Math.max(0, Number(dt) || 0);
  if (t >= prev) return prev + (t - prev) * (1 - Math.exp(-d / HEAT.RISE_TAU));
  return Math.max(t, prev - d / HEAT.COOL_S);
}

/**
 * 노드별 보간 장부(표현마다 하나). 프레임마다 step(id, node, dt) → 그릴 heat(0..1).
 *   const hb = new HeatBook();
 *   const h = hb.step(v.id, v.node, dt);        // 보간된 값
 *   const s = hb.stage(v.id);                    // 목표 단계(보간 없음, 0..3)
 *   hb.prune(view.vis)                           // 사라진 노드 정리(Map·Set 처럼 has(id) 가 있는 것)
 *   hb.clear()                                   // 재생 seek·표현 전환 → 다음 step 은 바로 목표값
 */
export class HeatBook {
  constructor() { this.m = new Map(); }
  step(id, node, dt, opts) {
    const h = nodeHeat(node);
    let e = this.m.get(id);
    if (!e) { e = { v: h.heat, stage: h.stage, pct: h.pct }; this.m.set(id, e); return e.v; }
    e.v = approachHeat(e.v, h.heat, dt, opts);
    e.stage = h.stage; e.pct = h.pct;
    return e.v;
  }
  get(id) { const e = this.m.get(id); return e ? e.v : 0; }
  stage(id) { const e = this.m.get(id); return e ? e.stage : 0; }
  prune(keep) { for (const id of this.m.keys()) if (!keep || !keep.has(id)) this.m.delete(id); }
  clear() { this.m.clear(); }
  get size() { return this.m.size; }
}
