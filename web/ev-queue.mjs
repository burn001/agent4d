// SSE 이벤트 처리 예산 큐 — 이벤트 몰림 조절(웹 쪽). 순수(DOM·three 없음, node --test 대상 web/test/ev-queue.test.mjs)
//  · SSE 메시지는 바로 처리하지 않고 큐에 넣는다. 프레임(rAF)마다 처리 예산(BUDGET_MS, 최소 1건)만큼 apply
//  · 큐가 HIGH 를 넘으면 '따라잡기' — 넘친 앞부분은 quiet(연출·소리 없이)로 빠르게 적용(QUIET_MS 안에서), LOW 아래로 내려가면 해제
//  · 숨긴 탭(hidden())이면 rAF 가 멈추므로 setTimeout 으로 모두 quiet 처리
//  · 순서는 늘 들어온 순서 그대로(일반·quiet 섞여도)

export const EVQ = {
  BUDGET_MS: 6,     // 프레임마다 일반 처리 예산
  QUIET_MS: 12,     // 프레임마다 넘친 앞부분 quiet 처리 예산
  HIGH: 200,        // 이 건수를 넘으면 따라잡기
  LOW: 50,          // 이 아래로 내려가면 해제
  HIDDEN_MS: 50,    // 숨긴 탭 처리 간격
  HIDDEN_CHUNK_MS: 20, // 숨긴 탭 한 번 처리 예산
  BATCH_FX: 40,     // 서버 묶음(batch) 하나에서 연출하는 뒤쪽 건수(앞의 것은 quiet)
};

/**
 * 서버 묶음 이벤트(`event: batch` data {events}) → 큐 항목. 정리된 묶음이라도 한꺼번에 오므로 뒤쪽 BATCH_FX 건만 연출,
 * 앞의 것은 quiet(상태·패널은 그대로 반영). 순서는 그대로.
 */
export function batchItems(d, fx = EVQ.BATCH_FX) {
  const evs = d && Array.isArray(d.events) ? d.events : [];
  const cut = evs.length - fx;
  return evs.map((ev, i) => (i < cut ? { ev, quiet: true } : { ev }));
}

/**
 * @param {{apply:(item, {quiet:boolean})=>void, onCatchup?:(n:number)=>void,
 *   raf?:(fn)=>any, setTimeout?:(fn, ms)=>any, now?:()=>number, hidden?:()=>boolean} & Partial<typeof EVQ>} o
 *   onCatchup(n) — 따라잡는 중이면 남은 건수(바뀔 때마다), 끝나면 0
 */
export class EvQueue {
  constructor(o) {
    this.o = { ...EVQ, ...o };
    this.apply = o.apply;
    this.onCatchup = o.onCatchup || (() => {});
    this.raf = o.raf || ((fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16)));
    this.timeout = o.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this.now = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.hidden = o.hidden || (() => typeof document !== 'undefined' && !!document.hidden);
    this.q = [];
    this.head = 0;            // 처리한 앞자리(배열 앞 지우기 비용을 줄임)
    this.scheduled = false;
    this.catching = false;
    this.gen = 0;             // clear()·wake() 뒤 남은 예약을 무시
    this.stats = { applied: 0, quiet: 0, frames: 0, maxLen: 0 };
  }

  get length() { return this.q.length - this.head; }

  push(item) {
    this.q.push(item);
    const n = this.length;
    if (n > this.stats.maxLen) this.stats.maxLen = n;
    this._schedule();
  }

  /** 모두 버림(새 연결·snapshot 이 앞 것을 대신할 때) */
  clear() {
    this.q = []; this.head = 0; this.gen++; this.scheduled = false;
    if (this.catching) { this.catching = false; this.onCatchup(0); }
  }

  /** 남은 것을 지금 모두 처리(quiet 여부는 따라잡기 규칙대로) — 시험·연결 끊기 전 */
  drainNow() { while (this.length) this._step(Infinity, Infinity); }

  /** 탭 숨김·보임이 바뀌었을 때(visibilitychange): 걸어 둔 rAF 가 숨김 동안 멈추지 않게 예약을 다시 */
  wake() {
    if (!this.scheduled) return;
    this.scheduled = false; this.gen++;
    this._schedule();
  }

  _schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    const g = this.gen;
    if (this.hidden()) this.timeout(() => this._tick(g, true), this.o.HIDDEN_MS);
    else this.raf(() => this._tick(g, false));
  }

  _tick(g, viaTimer) {
    if (g !== this.gen) return;
    this.scheduled = false;
    const hid = this.hidden();
    if (hid) this._hiddenStep();
    else if (viaTimer) { this._schedule(); return; } // 숨김이 풀림 → 프레임으로
    else { this.stats.frames++; this._step(this.o.QUIET_MS, this.o.BUDGET_MS); }
    if (this.length) this._schedule();
    else this._compact();
  }

  /** 숨긴 탭: 보이지 않으니 모두 quiet, 한 번에 HIDDEN_CHUNK_MS 만큼 */
  _hiddenStep() {
    const t0 = this.now();
    let k = 0;
    while (this.length && (k === 0 || this.now() - t0 < this.o.HIDDEN_CHUNK_MS)) { this._one(true); k++; }
    this._catchState();
  }

  /** 한 프레임: 넘친 앞부분(HIGH 초과분) quiet → 예산 안에서 일반(최소 1건) */
  _step(quietMs, budgetMs) {
    const t0 = this.now();
    if (this.length > this.o.HIGH && !this.catching) { this.catching = true; }
    while (this.length > this.o.HIGH && this.now() - t0 < quietMs) this._one(true);
    const t1 = this.now();
    let k = 0;
    while (this.length && (k === 0 || this.now() - t1 < budgetMs)) {
      // 일반 처리 중에도 아직 HIGH 를 넘으면(예산이 모자라 quiet 를 다 못 함) 그 건은 quiet
      this._one(this.length > this.o.HIGH);
      k++;
    }
    this._catchState();
  }

  _catchState() {
    const n = this.length;
    if (!this.catching && n > this.o.HIGH) this.catching = true;
    if (this.catching && n < this.o.LOW) { this.catching = false; this.onCatchup(0); return; }
    if (this.catching) this.onCatchup(n);
  }

  _one(quiet) {
    const item = this.q[this.head];
    this.q[this.head] = undefined;
    this.head++;
    if (item && item.quiet) quiet = true; // 항목이 정한 quiet(묶음 앞부분)
    if (quiet) this.stats.quiet++;
    this.stats.applied++;
    try { this.apply(item, { quiet }); } catch (e) { if (typeof console !== 'undefined') console.warn('ev apply', e); }
    if (this.head > 1024 && this.head * 2 > this.q.length) this._compact();
  }

  _compact() { if (this.head) { this.q = this.q.slice(this.head); this.head = 0; } }
}
