// ?mock=1 · ?demo=1 · 전체 보기 mock 용 컨텍스트 사용률 합성기. 순수 — 난수를 쓰지 않아 mock 결정성을 해치지 않는다.
// 기존 이벤트 흐름 뒤에 node-update {meta:{ctx}} 를 끼워 넣는다. 메인은 약 6% 에서 시작해 응답마다 올라 97% 를 넘으면
// compact 처럼 12% 로 떨어진다(식는 모습 시험). 하위 에이전트는 나타난 순서대로 네 갈래(SUB_TIERS) — 낮게 시작해 빨리 오르다 95% 에서
// 떨어지는 것, 60%(데움)·80%(과열)·95%(위험) 근처에 머무는 것 — 라서 한 화면에 과열 단계가 고루 보인다(미리 보기).
const AGENT_KINDS = new Set(['main', 'claude-p', 'subagent', 'workflow-agent']);
const STEP_TYPES = new Set(['text', 'tool-start', 'thinking']);
// mock 창 500k(6% 30k → 97% 485k → compact 12% 60k). 과열 단계는 % 로만 정해져 창 크기와 무관하다
export const MOCK_LIMIT = 500_000;

/** 하위 에이전트 갈래(나타난 순서 % 4): null = 낮게 시작해 오름, 수 = 그 % 에 머묾(95% 갈래만 걸음마다 +0.2%p 기어 올라 99% 넘으면 compact — 식는 모습) */
export const SUB_TIERS = [null, 0.6, 0.8, 0.95];
const holdStep = (t) => (t >= 0.9 ? 0.002 : 0);

const hash01 = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; };
const val = (used, limit, base) => ({ used, limit, pct: Math.min(100, Math.round((used / limit) * 1000) / 10), estimated: false, basis: 'mock', base: Math.min(used, base) });

export class MockCtx {
  /**
   * @param {{mainStart?:number, mainStep?:number, roots?:boolean, limit?:number, mainBase?:number}} o  roots: 전체 보기 — 메인마다 다른 시작 수준.
   *   limit: 창(분모, 기본 MOCK_LIMIT). mainBase: 메인 기준선(첫 응답, 토큰, 카드의 '늘어난 양' 표시용) — 없으면 첫 값. 전체 보기는 40k
   */
  constructor({ mainStart = 0.06, mainStep = 0.01, roots = false, limit = MOCK_LIMIT, mainBase = null } = {}) {
    this.used = new Map();
    this.base = new Map();
    this.tier = new Map(); // 하위 에이전트 id → SUB_TIERS 값
    this.subN = 0;
    this.mainStart = mainStart; this.mainStep = mainStep; this.roots = roots; this.limit = limit;
    this.mainBase = mainBase != null ? mainBase : roots ? 40_000 : null;
  }
  _isMain(n) { return n.kind === 'main' || (n.kind === 'claude-p' && !n.parentId); }
  _val(id, u, node) {
    let b = this.base.get(id);
    if (b == null) { b = node && this._isMain(node) && this.mainBase != null ? this.mainBase : u; this.base.set(id, b); }
    if (u < b) { b = u; this.base.set(id, b); }
    return val(u, this.limit, b);
  }
  _tierOf(node) {
    if (!this.tier.has(node.id)) this.tier.set(node.id, SUB_TIERS[this.subN++ % SUB_TIERS.length]);
    return this.tier.get(node.id);
  }
  _start(node) {
    if (this._isMain(node)) {
      // 전체 보기: 메인마다 10/42/80/94% 중 하나(평상·데움·과열·위험 — 단계 30/70/90) → 섬마다 메인 과열 정도가 다르다
      const k = Math.floor(hash01(node.id) * 4);
      // ?ctx= 고정이면 전체 보기도 그 값 둘레(±10%p)로 — README·영상 촬영 화면에 경고(85%↑ 빨강)가 뜨지 않게
      if (this.roots && this.mainStep === 0) return Math.max(0.02, Math.min(0.97, this.mainStart + [-0.1, -0.04, 0.04, 0.1][k]));
      return this.roots ? [0.1, 0.42, 0.8, 0.94][k] : this.mainStart;
    }
    const t = this._tierOf(node);
    return t != null ? t : 0.03 + hash01(node.id) * 0.12;
  }
  _step(node) {
    if (this._isMain(node)) return this.mainStep;
    const t = this._tierOf(node);
    return t != null ? holdStep(t) : 0.015 + hash01(node.id + 'r') * 0.01;
  }
  _cap(node) { return this._isMain(node) ? (node.kind === 'main' ? 0.97 : 0.95) : this._tierOf(node) != null ? 0.99 : 0.95; }

  /** 스냅샷 노드에 처음 값을 넣는다(제자리 수정) */
  seed(snap) {
    for (const n of (snap && snap.nodes) || []) {
      if (!AGENT_KINDS.has(n.kind)) continue;
      const u = Math.round(this.limit * this._start(n));
      this.used.set(n.id, u);
      n.meta = { ...(n.meta || {}), ctx: this._val(n.id, u, n) };
    }
    return snap;
  }

  /**
   * 이벤트 하나 뒤에 낼 ctx 갱신들.
   * @param {object} ev  원래 이벤트
   * @param {(id)=>object|null} getNode  노드 조회(종류 판정)
   */
  after(ev, getNode) {
    if (!ev || !ev.nodeId) return [];
    if (ev.type === 'node-add' && ev.node && AGENT_KINDS.has(ev.node.kind)) {
      const u = Math.round(this.limit * this._start(ev.node));
      this.used.set(ev.node.id, u);
      return [{ ts: ev.ts, type: 'node-update', nodeId: ev.node.id, patch: { meta: { ctx: this._val(ev.node.id, u, ev.node) } } }];
    }
    if (!STEP_TYPES.has(ev.type)) return [];
    const n = getNode(ev.nodeId);
    if (!n || !AGENT_KINDS.has(n.kind) || !this.used.has(n.id)) return [];
    const step = this._step(n);
    if (step <= 0) return []; // ?ctx= 고정
    let u = this.used.get(n.id) + Math.round(this.limit * step);
    if (step > 0 && u / this.limit > this._cap(n)) u = Math.round(this.limit * 0.12); // compact
    this.used.set(n.id, u);
    return [{ ts: ev.ts, type: 'node-update', nodeId: n.id, patch: { meta: { ctx: this._val(n.id, u, n) } } }];
  }

  /** 녹화된 이벤트 배열(로컬 재생)에 끼워 넣고 seq 를 다시 매긴다 */
  inject(events) {
    const kinds = new Map();
    const out = [];
    for (const ev of events) {
      if (ev.type === 'node-add' && ev.node) kinds.set(ev.node.id, ev.node);
      out.push({ ...ev });
      for (const x of this.after(ev, (id) => kinds.get(id) || null)) out.push(x);
    }
    out.forEach((e, i) => { e.seq = i + 1; });
    return out;
  }
}
