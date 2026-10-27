// SSE 연결별 내보내기 큐 — 이벤트 몰림 조절(서버 쪽)
//  · 평소: 같은 노드의 node-update 는 MERGE_MS 창 안에서 patch 를 합친다(마지막 값 우선, meta 는 키 단위 — 웹 reducer 와 같은 얕은 병합)
//    합칠 수 없는 이벤트·원문(limits·projects·root·ping)이 오면 그 전에 모인 것을 먼저 비운다(상대 순서 유지)
//  · 몰림 모드: 연결 유입이 초당 BURST_IN 건을 넘으면 창(BURST_MS → 최대 BURST_MAX_MS)에 모아 상태 기준으로 정리(coalesce)한 뒤
//    `event: batch` 하나로 보낸다. 초당 BURST_OUT 건 아래로 내려가면 평소로. 막힌(backpressure) 연결도 같은 창에 모아 drain 때 정리해 보냄
//  · res.write 가 false 면 'drain' 까지 모아 두었다가 한 번에 쓴다(느린 연결·터널에서 소켓 버퍼 누적 방지)
//  · 모아 둔 것이 MAX_ITEMS 건 또는 MAX_BYTES 를 넘으면 버리고, drain 때 snapshot 하나로 다시 맞춘다
// 재생 API·링버퍼는 이 큐를 쓰지 않는다(정리는 내보내기 단계에서만).
import { truncateTail, LIMITS } from './parse.mjs';

export const SSEQ = {
  MERGE_MS: 100,             // node-update 병합 창
  MAX_ITEMS: 5000,           // 막힌 동안 모아 둘 상한(건)
  MAX_BYTES: 4 * 1024 * 1024, // 막힌 동안 모아 둘 상한(바이트, UTF-16 길이 근사)
  // 몰림 모드
  BURST_IN: 50,              // 최근 RATE_MS 안 유입이 이 건수를 넘으면 몰림 모드
  BURST_OUT: 20,             // 이 아래로 내려가면 평소로(히스테리시스)
  RATE_MS: 1000,             // 유입률 창(100ms 칸 10개)
  BURST_MS: 250,             // 몰림 창 첫 길이
  BURST_MAX_MS: 1000,        // 몰림이 이어지면 창을 두 배씩, 이 길이까지
  WIN_MAX: 20000,            // 창 하나에 모을 상한(넘으면 바로 정리해 보냄)
  TOOL_KEEP: 1,              // 노드마다 창 안에서 짝이 맞은 도구 중 원문으로 남길 개수(나머지는 tool-summary)
};

// node-update 에서 이 밖의 키(ix·synth 등 연출 정보)가 있으면 합치지 않는다
const PLAIN_KEYS = new Set(['seq', 'ts', 'type', 'nodeId', 'patch', 'projectId', 'rootSessionId', 'sessionId']);
const CTX_KEYS = ['projectId', 'rootSessionId', 'sessionId'];

/** 합칠 수 있는 node-update 인가: 연출 키 없음 · patch 에 구조(parentId)·상태(status) 변화 없음 */
export function mergeable(e) {
  if (!e || e.type !== 'node-update' || !e.nodeId || !e.patch || typeof e.patch !== 'object') return false;
  for (const k of Object.keys(e)) if (!PLAIN_KEYS.has(k)) return false;
  const p = e.patch;
  if ('parentId' in p || 'depth' in p || 'status' in p) return false;
  if (p.meta != null && typeof p.meta !== 'object') return false;
  return true;
}

/** a 뒤에 b 를 합친 node-update(웹 reducer: Object.assign(n, rest) · n.meta = {...n.meta, ...meta}) */
export function mergeUpdate(a, b) {
  const patch = { ...a.patch, ...b.patch };
  if (a.patch.meta || b.patch.meta) patch.meta = { ...(a.patch.meta || {}), ...(b.patch.meta || {}) };
  return { ...a, ...b, patch };
}

const sameCtx = (a, b) => CTX_KEYS.every((k) => a[k] === b[k]);

// ───────────── 몰림 창 정리(coalesce) — 순수 ─────────────
// 보존(순서 그대로): user·result·conflict·session-msg·watch·node-add·node-remove·그 밖 모르는 종류 · ix 가 붙은 모든 이벤트
const KEEP_TYPES = new Set(['user', 'result', 'conflict', 'session-msg', 'watch']);
/** 정리 대상이 아닌 이벤트(중요·연출 정보) */
export function important(e) { return !e || KEEP_TYPES.has(e.type) || e.ix != null; }
/** 몰림 창에서 합칠 수 있는 node-update: 연출 키 없음(상태·구조 변화는 같은 시대(epoch) 안에서 합침) */
function burstMergeable(e) {
  if (!e || e.type !== 'node-update' || !e.nodeId || !e.patch || typeof e.patch !== 'object') return false;
  for (const k of Object.keys(e)) if (!PLAIN_KEYS.has(k)) return false;
  return e.patch.meta == null || typeof e.patch.meta === 'object';
}
const ctxOf = (e) => `${e.projectId ?? ''}\u0001${e.rootSessionId ?? ''}\u0001${e.sessionId ?? ''}`;
const ctxFields = (e) => { const o = {}; for (const k of CTX_KEYS) if (e[k] !== undefined) o[k] = e[k]; return o; };
const countLines = (s) => (s ? String(s).split('\n').filter((x) => x.trim()).length : 0);
const idsOf = (e) => (Array.isArray(e.ids) && e.ids.length ? e.ids : [e.nodeId]);

/**
 * 몰림 창의 이벤트 열을 상태 기준으로 정리한다(원본은 고치지 않음). 불변식: 결과를 웹 reducer 로 적용한 상태(노드·상태·openTools·meta·lastActivityAt)
 * == 원본 전부를 적용한 상태(web/test/coalesce.test.mjs 속성 시험). 내보내는 이벤트는 seq 오름차순, 각 seq 는 그것이 대신하는 마지막 원본의 seq.
 *  · node-remove: 같은 창에서 그 앞의 그 노드(ids) 이벤트는 버림(node-add 포함, 중요 이벤트는 남김)
 *  · node-update: 노드·시대(node-add/node-remove/보존 node-update 사이)마다 하나로(patch 마지막 값 우선, meta 키 단위)
 *  · tool-start/tool-end: 같은 창·시대에서 짝이 맞은 것은 노드마다 마지막 TOOL_KEEP 개만 원문, 나머지(2건 이상)는 tool-summary 한 건
 *    {n, cats:{cat:건}, fail, ids:[toolUseId], arts:[{type,toolUseId,ok?,art}]} — 열린 채 남는 tool-start·짝 없는 tool-end 는 원문
 *  · output: 노드·스트림(toolUseId·fg)마다 마지막 것 하나(글은 이어 붙인 꼬리, lineCount = 줄 수 합)
 *  · text: 노드·role 마다 마지막 것, thinking: 노드마다 마지막 것(chars 는 합)
 *  · 둘 이상을 대신한 이벤트에는 coalesced:n
 * @param {object[]} evs
 * @param {{toolKeep?:number}} [o]
 */
export function coalesce(evs, o = {}) {
  const toolKeep = o.toolKeep ?? SSEQ.TOOL_KEEP;
  const N = evs.length;
  if (N < 2) return evs.slice();
  // 1) node-remove 앞의 그 노드 이벤트 버리기(뒤에서 앞으로)
  const drop = new Uint8Array(N);
  const removed = new Set();
  for (let i = N - 1; i >= 0; i--) {
    const e = evs[i];
    if (!e) { drop[i] = 1; continue; }
    if (e.type === 'node-remove') { for (const id of idsOf(e)) removed.add(id); continue; }
    if (!removed.size || important(e)) continue;
    const id = e.type === 'node-add' ? (e.node && e.node.id) || e.nodeId : e.nodeId;
    if (id != null && removed.has(id)) drop[i] = 1;
  }
  // 2) 앞에서 뒤로: 시대(epoch)·묶음
  const epoch = new Map();
  const ep = (id) => epoch.get(id) || 0;
  const bump = (id) => epoch.set(id, ep(id) + 1);
  const out = [];            // {seq, ev, i}
  const groups = new Map();  // key → {ev, n, seq, i, ...}
  const starts = new Map();  // 도구 key → {e, i}
  const pairs = new Map();   // 노드 시대 key → [[start, end, 도구 key], ...]
  const lastStart = new Map(); // 도구 key → 마지막 tool-start 자리(짝 뒤에 같은 id 가 다시 열리면 그 짝은 요약하지 않음)
  const raw = (e, i) => out.push({ seq: e.seq, ev: e, i });
  for (let i = 0; i < N; i++) {
    if (drop[i]) continue;
    const e = evs[i];
    const id = e.nodeId;
    const nk = () => `${ctxOf(e)}\u0002${id}\u0002${ep(id)}`;
    switch (e.type) {
      case 'node-add': { bump((e.node && e.node.id) || id); raw(e, i); continue; }
      case 'node-remove': { for (const x of idsOf(e)) bump(x); raw(e, i); continue; }
      case 'node-update': {
        if (!burstMergeable(e)) { bump(id); raw(e, i); bump(id); continue; } // 보존 node-update 를 넘어 합치지 않음
        const k = 'u' + nk(), g = groups.get(k);
        if (g) { g.ev = mergeUpdate(g.ev, e); g.n++; g.seq = e.seq; g.i = i; } else groups.set(k, { ev: e, n: 1, seq: e.seq, i });
        continue;
      }
      case 'tool-start': {
        if (e.toolUseId) lastStart.set(nk() + '\u0002' + e.toolUseId, i);
        if (important(e) || !e.toolUseId) { raw(e, i); continue; }
        const k = nk() + '\u0002' + e.toolUseId;
        if (starts.has(k)) { raw(e, i); continue; } // 같은 id 가 다시(서버가 거의 내지 않음) — 원문
        starts.set(k, { e, i });
        continue;
      }
      case 'tool-end': {
        const k = e.toolUseId ? nk() + '\u0002' + e.toolUseId : null;
        const s = k && !important(e) ? starts.get(k) : null;
        if (!s) { raw(e, i); continue; }
        starts.delete(k);
        const pk = nk();
        if (!pairs.has(pk)) pairs.set(pk, []);
        pairs.get(pk).push([s, { e, i }, k]);
        continue;
      }
      case 'output': {
        if (important(e)) { raw(e, i); continue; }
        const k = `o${nk()}\u0002${e.toolUseId ?? ''}\u0002${e.fg ? 1 : 0}`, g = groups.get(k);
        if (g) { g.ev = e; g.n++; g.seq = e.seq; g.i = i; g.text.push(e.text || ''); g.lines += countLines(e.text); }
        else groups.set(k, { ev: e, n: 1, seq: e.seq, i, out: true, text: [e.text || ''], lines: countLines(e.text) });
        continue;
      }
      case 'text': case 'thinking': {
        if (important(e)) { raw(e, i); continue; }
        const k = e.type === 'text' ? 't' + nk() + '\u0002' + (e.role ?? '') : 'k' + nk(), g = groups.get(k);
        if (g) { g.ev = e; g.n++; g.seq = e.seq; g.i = i; g.chars += Number(e.chars) || 0; }
        else groups.set(k, { ev: e, n: 1, seq: e.seq, i, chars: Number(e.chars) || 0, think: e.type === 'thinking' });
        continue;
      }
      default: raw(e, i);
    }
  }
  for (const { e, i } of starts.values()) raw(e, i); // 열린 채 남은 도구
  for (const g of groups.values()) {
    let ev = g.ev;
    if (g.n > 1) {
      ev = { ...ev, coalesced: g.n };
      if (g.out) { ev.text = truncateTail(g.text.join(''), LIMITS.output); ev.lineCount = g.lines; }
      if (g.think) ev.chars = g.chars;
    }
    out.push({ seq: g.seq, ev, i: g.i });
  }
  for (let ps of pairs.values()) {
    ps.sort((a, b) => a[1].i - b[1].i); // 끝난 순서
    for (const p of ps) if (lastStart.get(p[2]) > p[1].i) { raw(p[0].e, p[0].i); raw(p[1].e, p[1].i); p.dead = true; } // 요약의 ids 닫기가 다시 연 것을 닫지 않게
    ps = ps.filter((p) => !p.dead);
    const cut = Math.max(0, ps.length - Math.max(0, toolKeep));
    let sum = ps.slice(0, cut);
    const keep = ps.slice(cut);
    if (sum.length === 1) { keep.unshift(sum[0]); sum = []; } // 한 건이면 그대로
    for (const [s, x] of keep) { raw(s.e, s.i); raw(x.e, x.i); }
    if (!sum.length) continue;
    let last = null, li = -1, fail = 0;
    const cats = {}, ids = [], arts = [];
    for (const [s, x] of sum) {
      const c = s.e.cat || x.e.cat || 'other';
      cats[c] = (cats[c] || 0) + 1;
      ids.push(s.e.toolUseId);
      if (x.e.ok === false) fail++;
      for (const y of [s, x]) {
        if (y.e.art) arts.push({ type: y.e.type, toolUseId: y.e.toolUseId, ...(y.e.ok === false ? { ok: false } : {}), art: y.e.art });
        if (y.i > li) { li = y.i; last = y.e; }
      }
    }
    const ev = { seq: last.seq, ts: last.ts, type: 'tool-summary', nodeId: last.nodeId, ...ctxFields(last), n: sum.length, cats, fail, ids, coalesced: sum.length * 2 };
    if (arts.length) ev.arts = arts;
    out.push({ seq: last.seq, ev, i: li });
  }
  out.sort((a, b) => (typeof a.seq === 'number' && typeof b.seq === 'number' ? a.seq - b.seq : 0) || a.i - b.i);
  return out.map((x) => x.ev);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {{format:(e)=>string, formatBatch?:(evs:object[], id:number)=>string, resync?:()=>string, mergeMs?, maxItems?, maxBytes?, timers?, now?:()=>number,
 *   burstIn?, burstOut?, rateMs?, burstMs?, burstMaxMs?, winMax?, toolKeep?}} o
 *   format(ev) → SSE 글(id = ev.seq) · formatBatch(evs, id) → `event: batch` 글(없으면 이벤트마다 format)
 *   resync() → 넘쳤을 때 보낼 snapshot SSE 글(없으면 연결을 닫음)
 */
export class SseOut {
  constructor(res, o) {
    this.res = res;
    this.format = o.format;
    this.formatBatch = o.formatBatch || null;
    this.resync = o.resync || null;
    this.mergeMs = o.mergeMs ?? SSEQ.MERGE_MS;
    this.maxItems = o.maxItems ?? SSEQ.MAX_ITEMS;
    this.maxBytes = o.maxBytes ?? SSEQ.MAX_BYTES;
    this.burstIn = o.burstIn ?? SSEQ.BURST_IN;
    this.burstOut = o.burstOut ?? SSEQ.BURST_OUT;
    this.rateMs = o.rateMs ?? SSEQ.RATE_MS;
    this.burstMs = o.burstMs ?? SSEQ.BURST_MS;
    this.burstMaxMs = o.burstMaxMs ?? SSEQ.BURST_MAX_MS;
    this.winMax = o.winMax ?? SSEQ.WIN_MAX;
    this.toolKeep = o.toolKeep ?? SSEQ.TOOL_KEEP;
    this.timers = o.timers || { set: setTimeout, clear: clearTimeout };
    this.now = o.now || (() => Date.now());
    this.pending = new Map();   // nodeId → 합친 node-update(삽입 순서 = 마지막 seq 순)
    this.timer = null;
    this.blocked = false;       // write 가 false 를 돌려 drain 을 기다리는 중
    this.buf = [];              // 막힌 동안 모은 SSE 글
    this.bufBytes = 0;
    this.overflow = false;      // 넘쳐서 snapshot 으로 다시 맞출 차례
    this.late = new Map();      // 넘친 동안 온 원문(종류별 마지막) — snapshot 뒤에 보냄
    this.closed = false;
    // 몰림 모드
    this.burst = false;
    this.win = [];              // 몰림 창(또는 막힌 동안) 모은 원본 이벤트
    this.winTimer = null;
    this.winMs = this.burstMs;
    this.rb = new Array(10).fill(0); // 유입률: rateMs/10 칸 10개
    this.rs = -1;               // 마지막 칸 번호
    this.stats = { merged: 0, writes: 0, drains: 0, resyncs: 0, in: 0, out: 0, bursts: 0, batches: 0, winIn: 0, winOut: 0 };
    this._onDrain = () => this._drain();
  }

  _slot(slot) {
    if (this.rs < 0 || slot - this.rs >= 10) this.rb.fill(0);
    else for (let k = this.rs + 1; k <= slot; k++) this.rb[k % 10] = 0;
    if (slot > this.rs) this.rs = slot;
  }

  /** 최근 rateMs 안 유입 건수 */
  rate() {
    const slot = Math.floor(this.now() / (this.rateMs / 10));
    if (slot !== this.rs) this._slot(slot);
    let n = 0; for (const x of this.rb) n += x;
    return n;
  }

  /** 그래프·허브 이벤트 */
  event(e) {
    if (this.closed) return;
    if (this.overflow) return; // 다시 맞출 snapshot 에 들어감
    this.stats.in++;
    const r = this.rate() + 1;
    this.rb[this.rs % 10]++;
    if (!this.burst && r > this.burstIn) this._enterBurst();
    else if (this.burst && r < this.burstOut && !this.blocked) this._exitBurst();
    if (this.burst || this.blocked) {
      this.win.push(e);
      if (this.win.length >= this.winMax) this._flushWin();
      else this._armWin();
      return;
    }
    if (mergeable(e)) {
      const cur = this.pending.get(e.nodeId);
      if (cur && sameCtx(cur, e)) {
        this.pending.delete(e.nodeId); // 뒤로 옮김 — 내보내는 seq 가 늘 오름차순이 되게(웹은 seq ≤ 마지막이면 버림)
        this.pending.set(e.nodeId, mergeUpdate(cur, e));
        this.stats.merged++;
      } else {
        if (cur) this.flush();
        this.pending.set(e.nodeId, e);
      }
      if (!this.timer && !this.blocked) this.timer = this.timers.set(() => { this.timer = null; if (!this.blocked) this.flush(); }, this.mergeMs);
      return;
    }
    this.flush();
    this._outEv([e]);
  }

  /** 원문(ping·limits·projects·root·snapshot) — 모인 이벤트를 먼저 비운다 */
  raw(s) {
    if (this.closed) return;
    if (this.overflow) { // 다시 맞추기 전: ping·projects(허브 snapshot 에 들어 있음)는 버리고, 그 밖(limits 등)은 종류별 마지막 것만 snapshot 뒤에
      const m = /^event: ([\w-]+)\n/.exec(s);
      if (m && m[1] !== 'projects') this.late.set(m[1], s);
      return;
    }
    if (this.blocked && s.startsWith(':')) return; // 막힌 동안 ping 은 쓸모없음(창을 끊지도 않음)
    this.flush();
    this._flushWin();
    this._out(s);
  }

  /** 모인 node-update 를 내보낸다(평소 모드) */
  flush() {
    if (this.timer) { this.timers.clear(this.timer); this.timer = null; }
    if (!this.pending.size) return;
    const evs = [...this.pending.values()];
    this.pending.clear();
    let s = '';
    for (const e of evs) s += this.format(e);
    this.stats.out += evs.length;
    this._out(s);
  }

  _outEv(evs) {
    this.stats.out += evs.length;
    if (evs.length > 1 && this.formatBatch) { this.stats.batches++; this._out(this.formatBatch(evs, evs[evs.length - 1].seq)); return; }
    let s = '';
    for (const e of evs) s += this.format(e);
    this._out(s);
  }

  _enterBurst() {
    this.flush(); // 평소 창에 모인 것 먼저(seq 순서)
    this.burst = true;
    this.winMs = this.burstMs;
    this.stats.bursts++;
  }

  _exitBurst() {
    this._flushWin();
    this.burst = false;
    this.winMs = this.burstMs;
  }

  _armWin() {
    if (this.winTimer || this.blocked || !this.burst) return;
    this.winTimer = this.timers.set(() => { this.winTimer = null; this._onWin(); }, this.winMs);
  }

  _onWin() {
    if (this.closed || this.blocked) return; // 막혔으면 drain 때
    this._flushWin();
    if (!this.burst) return;
    if (this.rate() < this.burstOut) { this.burst = false; this.winMs = this.burstMs; }
    else this.winMs = Math.min(this.burstMaxMs, this.winMs * 2); // 몰림이 이어지면 창을 늘림
  }

  /** 몰림 창을 정리해 내보낸다 */
  _flushWin() {
    if (this.winTimer) { this.timers.clear(this.winTimer); this.winTimer = null; }
    if (!this.win.length) return;
    const src = this.win;
    this.win = [];
    const evs = coalesce(src, { toolKeep: this.toolKeep });
    this.stats.winIn += src.length; this.stats.winOut += evs.length;
    if (evs.length) this._outEv(evs);
  }

  _out(s) {
    if (!s || this.closed) return;
    if (this.overflow) return;
    if (this.blocked) {
      this.buf.push(s); this.bufBytes += s.length;
      if (this.buf.length > this.maxItems || this.bufBytes > this.maxBytes) this._overflow();
      return;
    }
    this.stats.writes++;
    let ok = true;
    try { ok = this.res.write(s); } catch { ok = true; }
    if (ok === false) this._block();
  }

  _block() {
    if (this.blocked) return;
    this.blocked = true;
    this.res.once('drain', this._onDrain);
  }

  _overflow() {
    this.overflow = true;
    this.buf = []; this.bufBytes = 0;
    this.pending.clear();
    this.win = [];
    if (this.timer) { this.timers.clear(this.timer); this.timer = null; }
    if (this.winTimer) { this.timers.clear(this.winTimer); this.winTimer = null; }
  }

  _drain() {
    if (this.closed) return;
    this.blocked = false;
    this.stats.drains++;
    if (this.overflow) {
      this.overflow = false;
      this.stats.resyncs++;
      if (!this.resync) { this.close(); try { this.res.end(); } catch { /* 이미 닫힘 */ } return; }
      let out = this.resync(); // 그 순간 상태 — 뒤 이벤트는 seq 가 더 크다
      for (const x of this.late.values()) out += x;
      this.late.clear();
      this._out(out);
      return;
    }
    const s = this.buf.join('');
    this.buf = []; this.bufBytes = 0;
    if (s) this._out(s);
    if (this.blocked) return;
    if (this.win.length) { // 막힌 동안 모은 것 — 정리해서 한 번에(느린 연결일수록 더 많이 정리됨)
      if (this.burst) this._onWin();
      else this._flushWin();
    }
    if (!this.blocked && this.pending.size && !this.timer) this.timer = this.timers.set(() => { this.timer = null; if (!this.blocked) this.flush(); }, this.mergeMs);
  }

  close() {
    this.closed = true;
    if (this.timer) { this.timers.clear(this.timer); this.timer = null; }
    if (this.winTimer) { this.timers.clear(this.winTimer); this.winTimer = null; }
    this.pending.clear(); this.buf = []; this.win = [];
    this.res.off?.('drain', this._onDrain);
  }
}
