// SSE 송신·heartbeat
import { externalEv, externalSnap } from './artifacts.mjs'; // 외부 링크: 작업 대상 경로 접기
import { SseOut } from './sse-out.mjs'; // 이벤트 몰림 조절(병합·backpressure·넘치면 snapshot · 몰림 모드 정리·batch)
const PING_MS = 15_000;

export function sseHeaders(extra = {}) {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
    ...extra,
  };
}

export function formatEvent(event, data, id) {
  let s = '';
  if (event) s += `event: ${event}\n`;
  if (id != null) s += `id: ${id}\n`;
  s += `data: ${JSON.stringify(data)}\n\n`; // JSON.stringify 는 줄바꿈을 \n 으로 이스케이프 → 한 줄
  return s;
}

/** 묶음 이벤트(`event: batch`, data {events:[…]}, id = 마지막 seq) — 받을 줄 아는 웹(`&batch=1`)에만. 아니면 이벤트마다 ev */
function batchOf(url, X) {
  if (url.searchParams.get('batch') !== '1') return null;
  return (evs, id) => formatEvent('batch', { events: evs.map(X) }, id);
}

/**
 * /events 처리. manager 는 resolve/acquire/release/onAuto 를 가진다.
 * @param {{headers?:object}} opts
 */
export async function handleEvents(req, res, url, manager, opts = {}) {
  const param = url.searchParams.get('session') || 'auto';
  const sinceRaw = url.searchParams.get('since') ?? req.headers['last-event-id'];
  const since = sinceRaw != null && sinceRaw !== '' ? Number(sinceRaw) : NaN;

  let sid = await manager.resolve(param);
  let rt = null;
  if (sid) {
    try { rt = await manager.acquire(sid); } catch { rt = null; }
  }
  if (!rt) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', ...(opts.headers || {}) });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  req.socket.setNoDelay?.(true);
  req.socket.setTimeout?.(0);
  res.writeHead(200, sseHeaders(opts.headers));
  res.write('retry: 3000\n\n');

  let closed = false;
  let unsub = null;
  const X = opts.external ? externalEv : (e) => e, XS = opts.external ? externalSnap : (s) => s;
  const snapOf = (g) => formatEvent('snapshot', XS(g.snapshot()), g.lastSeq);
  const out = new SseOut(res, { format: (e) => formatEvent('ev', X(e), e.seq), formatBatch: batchOf(url, X), resync: () => snapOf(rt.graph), ...(opts.sseOut || {}) });
  const write = (s) => { if (!closed) out.raw(s); };
  const send = (e) => { if (!closed) out.event(e); };

  const attach = (runtime, allowSince) => {
    const g = runtime.graph;
    const evs = allowSince ? g.eventsSince(since) : null;
    if (evs) for (const e of evs) send(e);
    else write(snapOf(g));
    unsub = g.subscribe(send);
  };
  attach(rt, true);
  const limitsOff = attachLimits(write, opts.limits);

  let autoUnsub = null;
  if (param === 'auto' && manager.onAuto) {
    autoUnsub = manager.onAuto(async (newSid) => {
      if (closed || newSid === sid) return;
      let next;
      try { next = await manager.acquire(newSid); } catch { return; }
      if (closed) { manager.release(next); return; }
      unsub?.();
      manager.release(rt);
      rt = next; sid = newSid;
      write(formatEvent('root', { sessionId: newSid }));
      attach(rt, false);
    });
  }

  const ping = setInterval(() => write(': ping\n\n'), PING_MS);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    out.close();
    unsub?.();
    autoUnsub?.();
    limitsOff();
    manager.release(rt);
  };
  req.on('close', cleanup);
  res.on('error', cleanup);
}

/** 3차: 연결 직후 limits 한 번 + 값이 바뀔 때. id 없음. 보는 사람 수에 넣는다 */
function attachLimits(write, limits) {
  if (!limits) return () => {};
  const offViewer = limits.addViewer();
  let off = () => {};
  Promise.resolve(limits.get({ waitMs: 0 })).then((cur) => write(formatEvent('limits', cur))).catch(() => {});
  off = limits.onChange((cur) => write(formatEvent('limits', cur)));
  return () => { off(); offViewer(); };
}

/**
 * 3차: /events?scope=all&since=<hseq>. hub 는 OverviewHub. 기본 구독자만(비활성 세션은 장면에 싣지 않는다)
 * snapshot(전체 보기 형식) → ev(id = hseq) · projects · limits · 15초 ping
 */
export async function handleOverviewEvents(req, res, url, hub, opts = {}) {
  const sinceRaw = url.searchParams.get('since') ?? req.headers['last-event-id'];
  const since = sinceRaw != null && sinceRaw !== '' ? Number(sinceRaw) : NaN;
  await hub.wake();
  req.socket.setNoDelay?.(true);
  req.socket.setTimeout?.(0);
  res.writeHead(200, sseHeaders(opts.headers));
  res.write('retry: 3000\n\n');
  let closed = false;
  const X = opts.external ? externalEv : (e) => e, XS = opts.external ? externalSnap : (s) => s;
  const out = new SseOut(res, { format: (e) => formatEvent('ev', X(e), e.seq), formatBatch: batchOf(url, X), resync: () => formatEvent('snapshot', XS(hub.snapshot()), hub.hseq), ...(opts.sseOut || {}) });
  const write = (s) => { if (!closed) out.raw(s); };
  const send = (e) => { if (!closed) out.event(e); };
  const sub = {
    inactive: false,
    onEvent: send,
    onProjects: (p) => write(formatEvent('projects', p)),
  };
  // 스냅샷과 구독을 같은 틱에 해서 사이 이벤트를 놓치지 않는다
  const evs = hub.eventsSince(since);
  if (evs) for (const e of evs) send(e);
  else write(formatEvent('snapshot', XS(hub.snapshot()), hub.hseq));
  const unsub = hub.subscribe(sub);
  if (evs) write(formatEvent('projects', { projects: hub.projectsState.projects, roots: hub.rootsPayload() }));
  const limitsOff = attachLimits(write, opts.limits);
  const ping = setInterval(() => write(': ping\n\n'), PING_MS);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    out.close();
    unsub();
    limitsOff();
  };
  req.on('close', cleanup);
  res.on('error', cleanup);
}
