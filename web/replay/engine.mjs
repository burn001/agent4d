// 재생 엔진. DOM 에 기대지 않는다(document 는 있으면 visibility 만 씀) → node --test 로 시험.
//   const eng = new ReplayEngine({ api, sessionId, sink, onState });
//   await eng.open(); eng.play();
// api.getJson(path, query) → Promise<{status, body}>   path: 'timeline' | 'replay/events' | 'replay/snapshot' | 'sessions'
// sink.onSnapshot(snap, {replay:true}) · sink.onEvent(ev, {replay:true, quiet, speed}) · sink.onClock(vt, {skippedMs?})

import { createState, applyEvent, cloneState, toSnapshot, stateFromSnapshot } from './state.mjs';
import { computeHighlights } from './highlights.mjs';
import { t } from '../i18n.mjs';
import { localizeEvent, localizeSnapshot, localizeTimeline } from '../i18n-server.mjs'; // 서버 문구(재생은 앱 SSE 수신을 거치지 않음)

export const SPEEDS = [0.5, 1, 2, 4, 8, 16, 32];
export const IDLE_GAP_MS = 4000;     // 이벤트 간격이 이보다 길면 유휴로 본다
export const IDLE_LEAD_MS = 1000;    // 직전 이벤트 뒤 이만큼은 실제로 흘려보낸다
export const IDLE_LAND_MS = 300;     // 다음 이벤트 이만큼 앞에 내려앉는다
export const PAGE_LIMIT = 5000;
export const KEYFRAME_EVERY = 500;
export const FRAME_DISPATCH = 300;   // 프레임당 일반 디스패치
export const FOLD_OVER = 3000;       // 밀린 것이 이보다 많으면 스냅샷 한 번으로 접는다
export const MAX_FRAME_DT = 100;

export function clampSpeed(x) {
  x = Number(x);
  if (!isFinite(x)) return 1;
  return Math.max(SPEEDS[0], Math.min(SPEEDS[SPEEDS.length - 1], x));
}
/** dir = +1/−1 → 단계표에서 다음 속도 */
export function stepSpeed(cur, dir) {
  cur = clampSpeed(cur);
  if (dir > 0) return SPEEDS.find((s) => s > cur + 1e-9) ?? SPEEDS[SPEEDS.length - 1];
  return [...SPEEDS].reverse().find((s) => s < cur - 1e-9) ?? SPEEDS[0];
}

const tOf = (e) => (typeof e.t === 'number' ? e.t : Date.parse(e.ts));

/** 서버 없이 재생할 때: 시각순 안정 정렬 + t·rseq·seq 부여 (서버 의 축소판) */
export function normalizeEvents(raw) {
  // 같은 ms 는 원래 순서 유지(서버가 이미 인과 순서로 정렬해 보낸다고 보고 타입 순위로 다시 섞지 않음)
  const arr = raw.map((e, i) => ({ e, i, t: tOf(e) }));
  arr.sort((a, b) => a.t - b.t || a.i - b.i);
  return arr.map((x, k) => ({ ...x.e, t: x.t, rseq: k + 1, seq: k + 1 }));
}

/** 시험·개발용: 지정한 위치 뒤의 모든 이벤트 시각을 ms 만큼 미룬다. spec = [{after:index, ms}] */
export function injectGaps(raw, spec) {
  const shiftAt = new Array(raw.length).fill(0);
  for (const g of spec) for (let i = g.after + 1; i < raw.length; i++) shiftAt[i] += g.ms;
  return raw.map((e, i) => {
    if (!shiftAt[i]) return e;
    const t = tOf(e) + shiftAt[i];
    const out = { ...e, ts: new Date(t).toISOString() };
    if (typeof e.t === 'number') out.t = t;
    if (out.node) out.node = { ...out.node, startedAt: out.node.startedAt ? new Date(Date.parse(out.node.startedAt) + shiftAt[i]).toISOString() : out.node.startedAt, lastActivityAt: out.ts };
    if (out.patch && out.patch.endedAt) out.patch = { ...out.patch, endedAt: out.ts };
    return out;
  });
}

/** TimelineResp 를 정렬된 이벤트(t 있음)로 계산 */
export function computeTimeline(events, { buckets = 240, sessionId = null, root = null, title = '', complete = true, builtAt = null, buildMs = 0 } = {}) {
  buckets = Math.max(50, Math.min(1000, Math.round(buckets) || 240));
  const startT = events.length ? events[0].t : Date.now();
  const endT = events.length ? events[events.length - 1].t : startT;
  const dur = Math.max(1, endT - startT);
  const size = Math.max(1, Math.ceil(dur / buckets));
  const z = () => new Array(buckets).fill(0);
  const counts = z(), tools = z(), errors = z(), spawns = z();
  const gaps = [];
  const nodes = new Map();
  let prev = null;
  for (const e of events) {
    const b = Math.min(buckets - 1, Math.floor((e.t - startT) / size));
    counts[b]++;
    if (e.type === 'tool-start') tools[b]++;
    if ((e.type === 'tool-end' || e.type === 'result') && e.ok === false) errors[b]++;
    if (e.type === 'node-update' && e.patch && e.patch.status === 'error') errors[b]++;
    if (e.type === 'node-add' && e.node) {
      if (e.node.kind !== 'main') spawns[b]++;
      if (!root && (e.node.kind === 'main' || !e.node.parentId)) root = e.node.id;
      if (!nodes.has(e.node.id)) nodes.set(e.node.id, { id: e.node.id, kind: e.node.kind, label: e.node.label, parentId: e.node.parentId ?? null, depth: e.node.depth ?? 0, startTs: e.ts, endTs: null });
    }
    if (e.type === 'node-update' && e.patch && nodes.has(e.nodeId)) {
      const ni = nodes.get(e.nodeId);
      if (e.patch.status === 'done' || e.patch.status === 'error' || e.patch.status === 'stopped') ni.endTs = e.patch.endedAt || e.ts;
      else if (e.patch.status === 'active') ni.endTs = null;
      if (e.patch.label) ni.label = e.patch.label;
      if ('parentId' in e.patch) ni.parentId = e.patch.parentId;
    }
    if (prev && e.t - prev.t >= 60000) gaps.push({ from: prev.ts || new Date(prev.t).toISOString(), to: e.ts || new Date(e.t).toISOString() });
    prev = e;
  }
  return {
    sessionId, root, title,
    startTs: new Date(startT).toISOString(), endTs: new Date(endT).toISOString(), durationMs: endT - startT,
    eventCount: events.length, nodeCount: nodes.size, complete, builtAt: builtAt || new Date().toISOString(), buildMs,
    buckets: { size, counts, tools, errors, spawns },
    gaps,
    highlights: computeHighlights(events), // 볼거리 시점(서버 timelineOf 와 같은 함수)
    nodes: [...nodes.values()],
  };
}

/**
 * 메모리 이벤트로 /timeline·/replay/events·/replay/snapshot·/sessions 를 흉내 낸다(node 시험·?mock=1·?demo=1 재생용).
 * opts: { sessionId, title, buildPolls(202 를 몇 번 낼지), delayMs, complete, sessions(목록 응답 대체), pageMax }
 */
export function createLocalReplayApi(rawEvents, opts = {}) {
  const { sessionId = 'demo-replay', title = t('replay.demoTitle'), buildPolls = 0, delayMs = 0, complete = true, pageMax = 5000 } = opts;
  const events = normalizeEvents(rawEvents);
  const tl = computeTimeline(events, { sessionId, title, complete });
  let polls = buildPolls;
  const calls = [];
  const wait = () => (delayMs ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve());
  const ok = (body) => ({ status: 200, body });
  const sessions = opts.sessions || {
    sessions: [{
      sessionId, projectDir: 'demo', cwd: 'D:\\demo\\project', title, entrypoint: 'cli', isChild: false,
      mtime: tl.endTs, sizeBytes: 0, live: false, liveStatus: null,
      startedAt: tl.startTs, endedAt: tl.endTs, durationMs: tl.durationMs, eventCount: events.length, eventCountEst: events.length, replayCached: true,
    }],
    auto: sessionId,
    projects: [{ projectDir: 'demo', cwd: 'D:\\demo\\project', sessions: 1, lastMtime: tl.endTs }],
  };
  const known = (s) => s === sessionId || s === 'auto';
  return {
    events, timeline: tl, calls,
    async getJson(path, q = {}) {
      calls.push({ path, q: { ...q } });
      await wait();
      if (path === 'sessions') return ok(sessions);
      if (!known(q.session)) return { status: 404, body: { error: 'not_found' } };
      if (path === 'timeline') {
        if (polls > 0) {
          const done = buildPolls - polls;
          polls--;
          return { status: 202, body: { building: true, progress: { bytesRead: done * 1000, bytesTotal: buildPolls * 1000, files: 1 } } };
        }
        const b = Number(q.buckets) || 240;
        return ok(b === 240 ? tl : computeTimeline(events, { sessionId, title, complete, buckets: b }));
      }
      if (path === 'replay/events') {
        const limit = Math.max(1, Math.min(pageMax, Number(q.limit) || 2000));
        let from = Number(q.from) || 1;
        if (q.fromT != null && q.from == null) {
          const ft = Number(q.fromT);
          const i = events.findIndex((e) => e.t >= ft);
          from = i < 0 ? events.length + 1 : i + 1;
        }
        const slice = events.slice(from - 1, from - 1 + limit);
        const next = from - 1 + slice.length < events.length ? from + slice.length : null;
        return ok({ sessionId, builtAt: tl.builtAt, from, next, total: events.length, events: slice.map((e) => ({ ...e })) });
      }
      if (path === 'replay/snapshot') {
        const at = Number(q.at);
        const st = createState({ root: tl.root, sessionId });
        let last = 0;
        for (const e of events) { if (e.t > at) break; applyEvent(st, e); last = e.rseq; }
        const recent = events.slice(Math.max(0, last - 300), last);
        const snap = toSnapshot(st, recent);
        return ok({ sessionId, root: snap.root, at, rseq: last, seq: last, nodes: snap.nodes, recent: snap.recent });
      }
      return { status: 404, body: { error: 'not_found' } };
    },
  };
}

// ───────────────────────────── 엔진 ─────────────────────────────

export class ReplayEngine {
  constructor({ api, sessionId = 'auto', sink = {}, onState = null, raf, caf, now, doc, pageLimit = PAGE_LIMIT, speed = 1, compressIdle = true, pollMs = 1000 } = {}) {
    this.api = api;
    this.sessionId = sessionId;
    this.sink = sink;
    this._onState = onState;
    this._raf = raf || ((fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(() => fn(this._now()), 16)));
    this._caf = caf || ((id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id)));
    this._now = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this._doc = doc !== undefined ? doc : (typeof document !== 'undefined' ? document : null);
    this.pageLimit = pageLimit;
    this.pollMs = pollMs;
    this._subs = { state: new Set(), clock: new Set() };

    this.status = 'loading';
    this.vt = 0; this.startT = 0; this.endT = 0;
    this.speed = clampSpeed(speed);
    this.compressIdle = !!compressIdle;
    this.skippedIdleMs = 0;
    this.progress = null;
    this.complete = true;
    this.error = null;
    this.timeline = null;
    this.title = '';
    this.root = null;

    this.ev = [];            // rseq-1 위치에 저장(드문드문 찰 수 있음)
    this.total = 0;
    this.loaded = 0;
    this.contig = 0;         // 앞에서부터 빈틈없이 적재된 개수
    this.kf = [];            // [{index, t, state}] state = ev[0..index-1] 적용 결과
    this._kfState = null;
    this.st = null;          // 재생 위치까지 적용한 상태(밀림 접기용)
    this.ptr = 0;            // 다음에 낼 이벤트 index
    this._anchorT = 0;       // ptr-1 이 비어 있을 때(원격 seek 직후) 유휴 계산 기준

    this._want = null;
    this._loading = false;
    this._closed = false;
    this._rafId = 0;
    this._lastWall = 0;
    this._resumeAfterBuffer = false;
    this._autoPaused = false;
    this._seekToken = 0;
    this._loaderKick = null;

    this._onVis = () => {
      if (!this._doc) return;
      if (this._doc.hidden) { if (this.status === 'playing' || this.status === 'buffering') { this._autoPaused = true; this.pause(); } }
      else if (this._autoPaused) { this._autoPaused = false; this.play(); }
    };
    if (this._doc && this._doc.addEventListener) this._doc.addEventListener('visibilitychange', this._onVis);
  }

  // ---------- 구독 ----------
  on(type, fn) { this._subs[type].add(fn); return () => this._subs[type].delete(fn); }
  get state() {
    return {
      status: this.status, vt: this.vt, startTs: this.startT, endTs: this.endT, speed: this.speed, compressIdle: this.compressIdle,
      loaded: this.loaded, total: this.total, contig: this.contig, skippedIdleMs: this.skippedIdleMs, progress: this.progress,
      complete: this.complete, error: this.error, sessionId: this.sessionId, title: this.title,
    };
  }
  _emit() {
    const s = this.state;
    if (this._onState) try { this._onState(s); } catch (e) { console.error(e); }
    for (const f of this._subs.state) try { f(s); } catch (e) { console.error(e); }
  }
  _clock(extra = {}) {
    if (this.sink.onClock) try { this.sink.onClock(this.vt, extra); } catch (e) { console.error(e); }
    for (const f of this._subs.clock) try { f(this.vt, extra); } catch (e) { console.error(e); }
  }
  _setStatus(s) { if (this.status !== s) { this.status = s; this._emit(); } }

  // ---------- 열기 ----------
  async open() {
    this._setStatus('loading');
    const tl = await this._fetchTimeline();
    if (!tl || this._closed) return false;
    this._applyTimeline(tl);
    this._resetBuffers();
    this.st = createState({ root: this.root, sessionId: this.sessionId });
    if (this.total > 0) {
      const ok = await this._loadPage(0);
      if (!ok || this._closed) return false;
      if (this.ev[0] === undefined) { const ok2 = await this._loadPage(0); if (!ok2 || this._closed) return false; } // 첫 페이지 사이 빌드 교체
    }
    this.vt = this.startT;
    this._anchorT = this.startT;
    this.ptr = 0;
    this._snapshot(this.st, []);
    this.status = 'ready';
    this._emit();
    this._clock();
    this._runLoader();
    return true;
  }

  _applyTimeline(tl) {
    localizeTimeline(tl);
    this.timeline = tl;
    if (tl.sessionId) this.sessionId = tl.sessionId;
    this.title = tl.title || '';
    this.root = tl.root || null;
    this.startT = Date.parse(tl.startTs);
    this.endT = Date.parse(tl.endTs);
    if (!isFinite(this.endT) || this.endT < this.startT) this.endT = this.startT;
    this.total = tl.eventCount | 0;
    this.complete = tl.complete !== false;
    this.builtAt = tl.builtAt || null;
    this.progress = null;
  }

  /** 받은 이벤트·keyframe 을 비우고 새 타임라인 기준으로 다시 시작(빌드 교체) */
  _resetBuffers() {
    this.ev = new Array(this.total);
    this.loaded = 0;
    this.contig = 0;
    this._kfState = createState({ root: this.root, sessionId: this.sessionId });
    this.kf = [{ index: 0, t: this.startT, state: cloneState(this._kfState) }];
  }

  async _fetchTimeline() {
    let fails = 0;
    while (!this._closed) {
      let r;
      try { r = await this.api.getJson('timeline', { session: this.sessionId, buckets: 240, wait: 0 }); }
      catch (e) { r = { status: 0, body: null }; }
      if (this._closed) return null;
      if (r.status === 200 && r.body) return r.body;
      if (r.status === 202) {
        this.progress = (r.body && r.body.progress) || null;
        this.status = 'loading';
        this._emit();
        await this._sleep(this.pollMs);
        continue;
      }
      if (r.status === 404) return this._fail(t('replay.err.notFound'));
      if (r.status === 401) return this._fail(t('replay.err.authShort'));
      if (++fails > 3) return this._fail(t('replay.err.data'));
      await this._sleep(this.pollMs * 2);
    }
    return null;
  }

  _fail(msg) { this.error = msg; this.status = 'error'; this._emit(); return null; }
  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /** from = 0-based index. 성공하면 true */
  async _loadPage(from) {
    let tries = 0;
    while (!this._closed) {
      let r;
      try { r = await this.api.getJson('replay/events', { session: this.sessionId, from: from + 1, limit: this.pageLimit }); }
      catch (e) { r = { status: 0, body: null }; }
      if (this._closed) return false;
      if (r.status === 200 && r.body) {
        const b = r.body;
        // 빌드가 바뀌었다(라이브 세션을 뒤에서 다시 만듦): 순번(rseq)이 달라졌을 수 있어 섞지 않는다.
        // 새 타임라인을 받아 버퍼를 비우고, 지금 보던 시각으로 다시 이동(서버 스냅샷 → 이어 받기)
        if (b.builtAt && this.builtAt && b.builtAt !== this.builtAt) {
          const tl = await this._fetchTimeline();
          if (!tl || this._closed) return false;
          const vt = this.vt;
          this._applyTimeline(tl);
          this._resetBuffers();
          this.rebuilds = (this.rebuilds || 0) + 1;
          if (this.status !== 'loading') this.seek(Math.max(this.startT, Math.min(this.endT, vt)));
          return true;
        }
        if (typeof b.total === 'number' && b.total > this.total) { this.total = b.total; this.ev.length = b.total; }
        for (const e of b.events || []) {
          if (typeof e.t !== 'number') e.t = Date.parse(e.ts);
          localizeEvent(e);
          const i = (e.rseq || e.seq) - 1;
          if (i < 0) continue;
          if (this.ev[i] === undefined) this.loaded++;
          this.ev[i] = e;
          if (typeof e.seq !== 'number') e.seq = i + 1;
        }
        this._extendContig();
        this._emit();
        return true;
      }
      if (r.status === 409) { // 서버 캐시가 비워졌다 → 다시 만들게 한다
        const tl = await this._fetchTimeline();
        if (!tl) return false;
        continue;
      }
      if (r.status === 404 || r.status === 401) { this._fail(t(r.status === 404 ? 'replay.err.notFound' : 'replay.err.authShort')); return false; }
      if (++tries > 4) { this._fail(t('replay.err.events')); return false; }
      await this._sleep(500 * tries);
    }
    return false;
  }

  _extendContig() {
    while (this.contig < this.total && this.ev[this.contig] !== undefined) {
      const i = this.contig;
      if (i > 0 && i % KEYFRAME_EVERY === 0) this.kf.push({ index: i, t: this.ev[i].t, state: cloneState(this._kfState) });
      applyEvent(this._kfState, this.ev[i]);
      this.contig++;
    }
  }

  async _runLoader() {
    if (this._loading || this._closed) return;
    this._loading = true;
    try {
      while (!this._closed) {
        let from = null;
        if (this._want != null && this._want < this.total && this.ev[this._want] === undefined) from = this._want;
        else if (this.contig < this.total) {
          // 앞쪽 빈틈 중 첫 빈칸
          from = this.contig;
          this._want = null;
        } else { this._want = null; break; }
        // 이미 적재된 구간을 다시 받지 않도록, from 부터 빈칸만
        while (from < this.total && this.ev[from] !== undefined) from++;
        if (from >= this.total) { if (this._want != null) this._want = null; continue; }
        const ok = await this._loadPage(from);
        if (!ok) break;
        if (this._want != null && this.ev[this._want] !== undefined) this._want = null;
        if (this.status === 'buffering' && this.ev[this.ptr] !== undefined) {
          this.status = this._resumeAfterBuffer ? 'playing' : 'paused';
          this._lastWall = this._now();
          this._emit();
          if (this.status === 'playing') this._schedule();
        }
      }
    } finally { this._loading = false; }
  }

  // ---------- 조작 ----------
  play() {
    if (this._closed || this.status === 'loading' || this.status === 'error') return;
    if (this.status === 'ended' || (this.ptr >= this.total && this.vt >= this.endT)) this.seek(this.startT);
    this._autoPaused = false;
    if (this.ptr < this.total && this.ev[this.ptr] === undefined) {
      this._resumeAfterBuffer = true; this._want = this.ptr; this._setStatus('buffering'); this._runLoader(); return;
    }
    this._lastWall = this._now();
    this._setStatus('playing');
    this._schedule();
  }
  pause() {
    if (this.status === 'playing' || this.status === 'buffering' || this.status === 'ready') {
      this._resumeAfterBuffer = false;
      this._cancel();
      this._setStatus('paused');
    }
  }
  toggle() { if (this.status === 'playing' || this.status === 'buffering') this.pause(); else this.play(); }
  setSpeed(x) { this.speed = clampSpeed(x); this._emit(); }
  setCompressIdle(on) { this.compressIdle = !!on; this._emit(); }

  /** 가상 시각 target(epoch ms)으로 이동 */
  seek(target) {
    if (this._closed || !this.timeline) return Promise.resolve(false);
    target = Math.max(this.startT, Math.min(this.endT, Number(target)));
    if (!isFinite(target)) return Promise.resolve(false);
    const token = ++this._seekToken;
    const wasPlaying = this.status === 'playing' || (this.status === 'buffering' && this._resumeAfterBuffer);
    const local = this.contig === this.total || (this.contig > 0 && this.ev[this.contig - 1].t > target) || (this.contig === 0 && this.total > 0 && this.ev[0] && this.ev[0].t > target);
    if (local) {
      const i = this._lastIndexAtOrBefore(target, this.contig); // −1 가능
      let k = this.kf.length - 1;
      while (k > 0 && this.kf[k].index > i + 1) k--;
      const st = cloneState(this.kf[k].state);
      for (let j = this.kf[k].index; j <= i; j++) applyEvent(st, this.ev[j]);
      this.st = st;
      this.ptr = i + 1;
      this.vt = target;
      this._anchorT = target;
      this._snapshot(st, this.ev.slice(Math.max(0, i - 299), i + 1));
      this._afterSeek(wasPlaying);
      return Promise.resolve(true);
    }
    // 적재 범위 밖: 서버 스냅샷
    this._cancel();
    this._resumeAfterBuffer = wasPlaying;
    this._setStatus('buffering');
    return (async () => {
      let r;
      try { r = await this.api.getJson('replay/snapshot', { session: this.sessionId, at: Math.round(target) }); }
      catch (e) { r = { status: 0 }; }
      if (token !== this._seekToken || this._closed) return false;
      if (r.status === 409) { const tl = await this._fetchTimeline(); if (!tl || token !== this._seekToken) return false; return this.seek(target); }
      if (r.status !== 200 || !r.body) { this._setStatus('paused'); return false; }
      const b = localizeSnapshot(r.body);
      const st = stateFromSnapshot({ root: b.root || this.root, sessionId: this.sessionId, seq: b.rseq ?? b.seq ?? 0, nodes: b.nodes });
      this.st = st;
      this.ptr = b.rseq ?? b.seq ?? 0;
      this.vt = target;
      this._anchorT = target;
      for (const e of b.recent || []) { const i = (e.rseq || e.seq) - 1; if (i >= 0 && this.ev[i] === undefined) { if (typeof e.t !== 'number') e.t = Date.parse(e.ts); this.ev[i] = e; this.loaded++; } }
      this._extendContig();
      this._snapshot(st, b.recent || []);
      this._want = this.ptr;
      this._runLoader();
      if (this.ptr < this.total && this.ev[this.ptr] === undefined) { this._emit(); this._clock(); return true; }
      this._afterSeek(wasPlaying);
      return true;
    })();
  }

  _afterSeek(wasPlaying) {
    if (wasPlaying) {
      this._lastWall = this._now();
      this.status = 'playing';
      this._schedule();
    } else if (this.status !== 'ready') this.status = 'paused';
    if (this.ptr >= this.total && this.vt >= this.endT) { this.status = 'ended'; this._cancel(); }
    this._emit();
    this._clock();
  }

  /** [0, lim) 안에서 t ≤ target 인 마지막 index(없으면 −1) */
  _lastIndexAtOrBefore(target, lim) {
    let lo = 0, hi = lim; // 첫 t > target
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.ev[m].t <= target) lo = m + 1; else hi = m; }
    return lo - 1;
  }

  close() {
    this._closed = true;
    this._cancel();
    this._seekToken++;
    if (this._doc && this._doc.removeEventListener) this._doc.removeEventListener('visibilitychange', this._onVis);
    this._subs.state.clear(); this._subs.clock.clear();
  }

  // ---------- 프레임 ----------
  _schedule() { if (!this._rafId && !this._closed) this._rafId = this._raf((w) => this._frame(w)) || -1; }
  _cancel() { if (this._rafId && this._rafId !== -1) this._caf(this._rafId); this._rafId = 0; }

  _frame(wall) {
    this._rafId = 0;
    if (this._closed || this.status !== 'playing') return;
    if (typeof wall !== 'number') wall = this._now();
    const dt = Math.min(MAX_FRAME_DT, Math.max(0, wall - this._lastWall));
    this._lastWall = wall;
    this.tick(dt);
    if (this.status === 'playing') this._schedule();
  }

  /** 벽시계 dt(ms) 만큼 진행. 시험에서 직접 부를 수 있다 */
  tick(dtWall) {
    if (this.status !== 'playing') return;
    if (this.ptr < this.total && this.ev[this.ptr] === undefined) {
      this._resumeAfterBuffer = true; this._want = this.ptr; this._cancel(); this._setStatus('buffering'); this._runLoader(); return;
    }
    let vt = this.vt + Math.min(MAX_FRAME_DT, dtWall) * this.speed;
    let skipped = 0;
    if (this.compressIdle) {
      const nextT = this.ptr < this.total ? this.ev[this.ptr].t : this.endT;
      const prevT = this.ptr > 0 && this.ev[this.ptr - 1] ? Math.max(this.ev[this.ptr - 1].t, Math.min(this._anchorT, nextT)) : this._anchorT;
      if (nextT - prevT > IDLE_GAP_MS && vt >= prevT + IDLE_LEAD_MS && vt < nextT - IDLE_LAND_MS) {
        skipped = nextT - IDLE_LAND_MS - vt;
        vt = nextT - IDLE_LAND_MS;
        this.skippedIdleMs += skipped;
      }
    }
    if (vt > this.endT) vt = this.endT;
    this.vt = vt;
    this._dispatchDue();
    this._clock(skipped ? { skippedMs: skipped } : {});
    if (this.ptr >= this.total && this.vt >= this.endT) { this._cancel(); this._setStatus('ended'); }
  }

  _dispatchDue() {
    const vt = this.vt;
    let j = this.ptr;
    while (j < this.total && this.ev[j] !== undefined && this.ev[j].t <= vt) j++;
    const n = j - this.ptr;
    if (n === 0) return;
    if (n > FOLD_OVER) {
      for (let k = this.ptr; k < j; k++) applyEvent(this.st, this.ev[k]);
      this.ptr = j;
      this._snapshot(this.st, this.ev.slice(Math.max(0, j - 300), j));
      return;
    }
    let c = 0;
    const onEvent = this.sink.onEvent;
    for (let k = this.ptr; k < j; k++) {
      const e = this.ev[k];
      applyEvent(this.st, e);
      this.ptr = k + 1;
      if (onEvent) try { onEvent(e, { replay: true, quiet: c >= FRAME_DISPATCH, speed: this.speed }); } catch (err) { console.error(err); }
      c++;
    }
  }

  _snapshot(st, recent) {
    const snap = toSnapshot(st, recent);
    if (!snap.root) snap.root = this.root;
    if (!snap.sessionId) snap.sessionId = this.sessionId;
    if (this.sink.onSnapshot) try { this.sink.onSnapshot(snap, { replay: true }); } catch (e) { console.error(e); }
  }
}
