// 이벤트 몰림 조절(서버) — node-update 병합 · 다른 종류가 끼면 비움 · backpressure · 넘치면 snapshot
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SseOut, mergeable, mergeUpdate } from '../sse-out.mjs';
import { formatEvent } from '../sse.mjs';

/** 가짜 res: write 반환값을 바꿀 수 있고, 쓴 글을 SSE 메시지로 되읽는다 */
function fakeRes() {
  const r = new EventEmitter();
  r.out = ''; r.ok = true; r.writes = 0;
  r.write = (s) => { r.out += s; r.writes++; return r.ok; };
  r.end = () => { r.ended = true; };
  r.msgs = () => r.out.split('\n\n').filter(Boolean).map((b) => {
    const m = {}; for (const l of b.split('\n')) { const i = l.indexOf(': '); if (i > 0) m[l.slice(0, i)] = l.slice(i + 2); }
    if (m.data) m.data = JSON.parse(m.data);
    return m;
  });
  return r;
}
/** 손으로 돌리는 타이머 */
function fakeTimers() {
  const q = new Set();
  return { set: (fn) => { const h = { fn }; q.add(h); return h; }, clear: (h) => q.delete(h), run: () => { for (const h of [...q]) { q.delete(h); h.fn(); } }, get size() { return q.size; } };
}
const fmt = (e) => formatEvent('ev', e, e.seq);
const upd = (seq, nodeId, patch, extra = {}) => ({ seq, ts: `t${seq}`, type: 'node-update', nodeId, patch, ...extra });

test('mergeable·mergeUpdate: 웹 reducer 와 같은 얕은 병합(meta 는 키 단위, 마지막 값 우선)', () => {
  assert.equal(mergeable(upd(1, 'a', { meta: { run: 1 } })), true);
  assert.equal(mergeable(upd(1, 'a', { status: 'done' })), false, '상태 바뀜은 순서대로');
  assert.equal(mergeable(upd(1, 'a', { parentId: 'x' })), false, '구조 바뀜은 순서대로');
  assert.equal(mergeable(upd(1, 'a', {}, { ix: { op: 'reply' } })), false, '연출 정보가 붙은 것은 합치지 않음');
  assert.equal(mergeable({ seq: 1, type: 'tool-start', nodeId: 'a' }), false);
  const m = mergeUpdate(upd(1, 'a', { label: 'x', meta: { run: { a: 1 }, ctx: 10 } }), upd(2, 'a', { meta: { run: { b: 2 } } }));
  assert.deepEqual(m, { seq: 2, ts: 't2', type: 'node-update', nodeId: 'a', patch: { label: 'x', meta: { run: { b: 2 }, ctx: 10 } } });
});

test('같은 노드 node-update 는 100ms 창 안에서 하나로 — seq 는 마지막, 내보내는 seq 는 오름차순', () => {
  const res = fakeRes(), tm = fakeTimers();
  const o = new SseOut(res, { format: fmt, timers: tm });
  o.event(upd(1, 'a', { meta: { run: 1 } }));
  o.event(upd(2, 'b', { meta: { ctx: 5 } }));
  o.event(upd(3, 'a', { meta: { run: 2, plans: [] } }));
  o.event(upd(4, 'a', { label: 'L' }));
  assert.equal(res.out, '', '창이 닫히기 전에는 쓰지 않음');
  tm.run();
  const ms = res.msgs();
  assert.deepEqual(ms.map((m) => Number(m.id)), [2, 4], 'b(2) 다음 a(4) — 합친 것은 마지막 자리로');
  assert.deepEqual(ms[1].data.patch, { meta: { run: 2, plans: [] }, label: 'L' });
  assert.equal(res.writes, 1, '한 번에 씀');
  assert.equal(o.stats.merged, 2);
});

test('다른 종류 이벤트·원문이 끼면 그 전에 비움(상대 순서 유지)', () => {
  const res = fakeRes(), tm = fakeTimers();
  const o = new SseOut(res, { format: fmt, timers: tm });
  o.event(upd(1, 'a', { meta: { run: 1 } }));
  o.event({ seq: 2, ts: 't2', type: 'tool-start', nodeId: 'a', toolUseId: 'u' });
  o.event(upd(3, 'a', { meta: { run: 2 } }));
  o.event(upd(4, 'a', { status: 'done' })); // 상태 바뀜 → 앞 것 비우고 그대로
  o.event(upd(5, 'a', { meta: { run: 3 } }));
  o.raw(formatEvent('limits', { ok: true }));
  o.event(upd(6, 'a', { meta: { run: 4 } }));
  tm.run();
  const ms = res.msgs();
  assert.deepEqual(ms.map((m) => m.event + ':' + (m.id || '')), ['ev:1', 'ev:2', 'ev:3', 'ev:4', 'ev:5', 'limits:', 'ev:6']);
  // 다른 맥락(전체 보기 프로젝트가 다른 같은 id)은 합치지 않음
  const res2 = fakeRes(), o2 = new SseOut(res2, { format: fmt, timers: tm });
  o2.event(upd(1, 'a', { meta: { x: 1 } }, { projectId: 'p1' }));
  o2.event(upd(2, 'a', { meta: { x: 2 } }, { projectId: 'p2' }));
  tm.run();
  assert.deepEqual(res2.msgs().map((m) => Number(m.id)), [1, 2]);
});

test('backpressure: write 가 false 면 drain 까지 모았다가 정리해서 한 번에(막힌 동안 모은 것은 몰림 창과 같은 규칙)', () => {
  const res = fakeRes(), tm = fakeTimers();
  const o = new SseOut(res, { format: fmt, timers: tm });
  res.ok = false;
  o.event({ seq: 1, ts: 't', type: 'tool-start', nodeId: 'a' });
  assert.equal(o.blocked, true);
  const w = res.writes;
  for (let i = 2; i <= 50; i++) o.event({ seq: i, ts: 't', type: 'output', nodeId: 'a', text: 'x' + i });
  for (let i = 51; i <= 80; i++) o.event(upd(i, 'a', { meta: { run: i } }));
  tm.run();
  assert.equal(res.writes, w, '막힌 동안 res.write 를 부르지 않음');
  res.ok = true;
  res.emit('drain');
  assert.equal(res.writes, w + 1, 'drain 에 모은 것을 한 번에');
  const ms = res.msgs();
  assert.deepEqual(ms.map((m) => Number(m.id)), [1, 50, 80], 'output 49건 → 마지막 하나, node-update 30건 → 하나');
  assert.equal(ms[1].data.coalesced, 49);
  assert.equal(ms[1].data.lineCount, 49);
  assert.match(ms[1].data.text, /x49x50$/);
  assert.equal(ms[2].data.patch.meta.run, 80);
});

test('큐 폭주 → 모은 것을 버리고 drain 때 snapshot 하나 + 그 뒤 이벤트 · 넘친 동안 limits 는 마지막 것만', () => {
  const res = fakeRes(), tm = fakeTimers();
  let seq = 0;
  const o = new SseOut(res, { format: fmt, timers: tm, maxItems: 5, winMax: 10, resync: () => formatEvent('snapshot', { seq, nodes: [] }, seq) });
  res.ok = false;
  for (let i = 0; i < 300; i++) o.event({ seq: ++seq, ts: 't', type: 'output', nodeId: 'a', text: 'y' });
  assert.equal(o.overflow, true);
  assert.equal(o.buf.length, 0, '모은 것을 버림');
  o.raw(formatEvent('limits', { v: 1 }));
  o.raw(formatEvent('limits', { v: 2 }));
  o.raw(': ping\n\n');
  const before = res.out.length;
  res.ok = true;
  res.emit('drain');
  o.event({ seq: ++seq, ts: 't', type: 'output', nodeId: 'a', text: 'z' });
  tm.run(); // 몰림 창(300건이 한꺼번에 왔으므로 몰림 모드)
  const ms = res.msgs().filter((m) => res.out.indexOf(`id: ${m.id}`) >= before || m.event !== 'ev');
  const tail = res.out.slice(before).split('\n\n').filter(Boolean);
  assert.match(tail[0], /^event: snapshot\nid: 300\n/);
  assert.match(tail[1], /^event: limits\ndata: \{"v":2\}/);
  assert.match(tail[2], /^event: ev\nid: 301\n/);
  assert.equal(tail.length, 3);
  assert.equal(o.stats.resyncs, 1);
  assert.ok(ms.length > 0);
});

test('HTTP: /events 라이브 경로가 node-update 를 합쳐 보내고 since 재접속이 이어짐', async (t) => {
  const { handleEvents } = await import('../sse.mjs');
  const subs = new Set();
  let lastSeq = 0;
  const ring = [];
  const graph = {
    get lastSeq() { return lastSeq; },
    snapshot: () => ({ seq: lastSeq, nodes: [] }),
    eventsSince: (s) => (Number.isFinite(s) ? ring.filter((e) => e.seq > s) : null),
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
  const emit = (e) => { e.seq = ++lastSeq; ring.push(e); for (const f of subs) f(e); };
  const manager = { resolve: async () => 's1', acquire: async () => ({ graph }), release: () => {} };
  const req = new EventEmitter(); req.headers = {}; req.socket = {};
  const res = fakeRes(); res.writeHead = () => {}; res.on = res.on.bind(res);
  t.after(() => req.emit('close'));
  await handleEvents(req, res, new URL('http://x/events?session=s1'), manager, {});
  for (let i = 0; i < 20; i++) emit({ ts: 't', type: 'node-update', nodeId: 'a', patch: { meta: { run: { lastOut: i } } } });
  emit({ ts: 't', type: 'tool-end', nodeId: 'a', toolUseId: 'u' });
  const ms = res.msgs().filter((m) => m.event === 'ev');
  assert.deepEqual(ms.map((m) => Number(m.id)), [20, 21]);
  assert.equal(ms[0].data.patch.meta.run.lastOut, 19);
  req.emit('close');
  // 재접속 since=20 → 21 부터
  const res2 = fakeRes(); res2.writeHead = () => {};
  const req2 = new EventEmitter(); req2.headers = {}; req2.socket = {};
  t.after(() => req2.emit('close'));
  await handleEvents(req2, res2, new URL('http://x/events?session=s1&since=20'), manager, {});
  assert.deepEqual(res2.msgs().filter((m) => m.event === 'ev').map((m) => Number(m.id)), [21]);
  req2.emit('close');
});

test('HTTP: /events?scope=all 허브 경로도 합쳐 보냄(프로젝트 맥락 같을 때만)', async (t) => {
  const { handleOverviewEvents } = await import('../sse.mjs');
  const subs = new Set();
  const hub = {
    hseq: 0, wake: async () => {}, snapshot: () => ({ scope: 'all', seq: hub.hseq, nodes: [] }), eventsSince: () => null,
    subscribe: (s) => { subs.add(s); return () => subs.delete(s); },
    projectsState: { projects: [] }, rootsPayload: () => [],
  };
  const emit = (e) => { e.seq = ++hub.hseq; for (const s of subs) s.onEvent(e); };
  const req = new EventEmitter(); req.headers = {}; req.socket = {};
  const res = fakeRes(); res.writeHead = () => {};
  t.after(() => req.emit('close'));
  await handleOverviewEvents(req, res, new URL('http://x/events?scope=all'), hub, {});
  for (let i = 0; i < 10; i++) emit({ ts: 't', type: 'node-update', nodeId: 'a', patch: { meta: { ctx: i } }, projectId: 'p', rootSessionId: 'r' });
  emit({ ts: 't', type: 'text', nodeId: 'a', projectId: 'p', rootSessionId: 'r' });
  const ms = res.msgs();
  assert.equal(ms.find((m) => m.event).event, 'snapshot');
  assert.deepEqual(ms.filter((m) => m.event === 'ev').map((m) => Number(m.id)), [10, 11]);
  req.emit('close');
});
