// 몰림 모드 — 적응형 내보내기 주기 · 창 정리(coalesce) 규칙 · batch · since
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SseOut, coalesce } from '../sse-out.mjs';
import { formatEvent } from '../sse.mjs';

function fakeRes() {
  const r = new EventEmitter();
  r.out = ''; r.ok = true; r.writes = 0;
  r.write = (s) => { r.out += s; r.writes++; return r.ok; };
  r.end = () => { r.ended = true; };
  r.msgs = () => r.out.split('\n\n').filter(Boolean).filter((b) => !b.startsWith('retry')).map((b) => {
    const m = {}; for (const l of b.split('\n')) { const i = l.indexOf(': '); if (i > 0) m[l.slice(0, i)] = l.slice(i + 2); }
    if (m.data) m.data = JSON.parse(m.data);
    return m;
  });
  return r;
}
/** 시계를 손으로 움직이는 타이머(지연 ms 를 기억) */
function clockTimers() {
  let t = 0;
  const q = new Set();
  return {
    now: () => t,
    set: (fn, ms) => { const h = { fn, at: t + ms, ms }; q.add(h); return h; },
    clear: (h) => q.delete(h),
    advance(ms) {
      const end = t + ms;
      for (;;) { const due = [...q].filter((h) => h.at <= end).sort((a, b) => a.at - b.at)[0]; if (!due) break; t = due.at; q.delete(due); due.fn(); }
      t = end;
    },
    get pending() { return [...q].map((h) => h.ms); },
  };
}
const fmt = (e) => formatEvent('ev', e, e.seq);
const fmtB = (evs, id) => formatEvent('batch', { events: evs }, id);
const ev = (seq, type, nodeId, extra = {}) => ({ seq, ts: `t${seq}`, type, nodeId, ...extra });
const upd = (seq, nodeId, patch, extra = {}) => ({ seq, ts: `t${seq}`, type: 'node-update', nodeId, patch, ...extra });

test('정리 규칙: node-update 는 다른 종류가 끼어도 노드·시대마다 하나(node-add 앞으로 못 당김·보존 update 가 끊음)', () => {
  const out = coalesce([
    upd(1, 'a', { meta: { x: 1 } }), ev(2, 'tool-start', 'a', { toolUseId: 'u' }), upd(3, 'a', { status: 'done' }), ev(4, 'text', 'b', { text: 'q' }),
    upd(5, 'a', { meta: { y: 2 } }), ev(6, 'node-add', 'a', { node: { id: 'a' } }), upd(7, 'a', { label: 'L' }), upd(8, 'a', { label: 'M' }),
    upd(9, 'a', {}, { ix: { op: 'reply' } }), upd(10, 'a', { meta: { z: 1 } }), upd(11, 'a', { meta: { z: 2 } }),
  ]);
  const u = out.filter((e) => e.type === 'node-update');
  assert.deepEqual(u.map((e) => e.seq), [5, 8, 9, 11]);
  assert.deepEqual(u[0].patch, { meta: { x: 1, y: 2 }, status: 'done' });
  assert.equal(u[0].coalesced, 3);
  assert.deepEqual(u[1].patch, { label: 'M' });
  assert.ok(!('coalesced' in u[2]), '보존(ix)은 원문');
  assert.deepEqual(out.map((e) => e.seq), [2, 4, 5, 6, 8, 9, 11], 'seq 오름차순');
});

test('정리 규칙: 같은 창에서 node-remove 된 노드는 그 앞 이벤트(node-add 포함)를 버림 — remove·중요 이벤트는 남김', () => {
  const out = coalesce([
    ev(1, 'node-add', 'g', { node: { id: 'g' } }), ev(2, 'node-add', 'h', { node: { id: 'h', parentId: 'g' } }), upd(3, 'g', { meta: { a: 1 } }),
    ev(4, 'tool-start', 'h', { toolUseId: 'u' }), ev(5, 'result', 'g', { text: 'r' }), ev(6, 'output', 'k', { text: 'o' }),
    ev(7, 'node-remove', 'g', { subtree: true, ids: ['h', 'g'] }), upd(8, 'g', { meta: { a: 2 } }),
  ]);
  assert.deepEqual(out.map((e) => `${e.seq}:${e.type}`), ['5:result', '6:output', '7:node-remove', '8:node-update']);
});

test('정리 규칙: 짝이 맞은 짧은 도구는 노드마다 마지막 1개만 원문, 나머지는 tool-summary(열린 것·짝 없는 끝·ix 는 원문)', () => {
  const evs = [ev(1, 'tool-end', 'a', { toolUseId: 'old', ok: true })];
  let s = 1;
  for (let i = 0; i < 5; i++) {
    evs.push(ev(++s, 'tool-start', 'a', { toolUseId: 'T' + i, cat: i % 2 ? 'read' : 'search', ...(i === 1 ? { art: [{ id: 'f' }] } : {}) }));
    evs.push(ev(++s, 'tool-end', 'a', { toolUseId: 'T' + i, ok: i !== 2 }));
  }
  evs.push(ev(++s, 'tool-start', 'a', { toolUseId: 'open' }));
  evs.push(ev(++s, 'tool-start', 'a', { toolUseId: 'ix', ix: { v: 1 } }), ev(++s, 'tool-end', 'a', { toolUseId: 'ix' }));
  const out = coalesce(evs);
  assert.deepEqual(out.map((e) => `${e.seq}:${e.type}:${e.toolUseId || ''}`), ['1:tool-end:old', '9:tool-summary:', '10:tool-start:T4', '11:tool-end:T4', '12:tool-start:open', '13:tool-start:ix', '14:tool-end:ix']);
  const sm = out[1];
  assert.equal(sm.n, 4); assert.deepEqual(sm.cats, { search: 2, read: 2 }); assert.equal(sm.fail, 1);
  assert.deepEqual(sm.ids, ['T0', 'T1', 'T2', 'T3']); assert.equal(sm.coalesced, 8); assert.equal(sm.ts, 't9');
  assert.deepEqual(sm.arts, [{ type: 'tool-start', toolUseId: 'T1', art: [{ id: 'f' }] }], '작업 대상 장부용 art 는 빠짐없이');
  // 짝 뒤에 같은 id 가 다시 열리면 그 짝은 요약하지 않음(요약의 닫기가 다시 연 것을 닫지 않게)
  const re = coalesce([ev(1, 'tool-start', 'a', { toolUseId: 'X' }), ev(2, 'tool-end', 'a', { toolUseId: 'X' }), ev(3, 'tool-start', 'a', { toolUseId: 'X' }),
    ev(4, 'tool-start', 'a', { toolUseId: 'Y' }), ev(5, 'tool-end', 'a', { toolUseId: 'Y' }), ev(6, 'tool-start', 'a', { toolUseId: 'Z' }), ev(7, 'tool-end', 'a', { toolUseId: 'Z' })], { toolKeep: 0 });
  assert.deepEqual(re.map((e) => `${e.seq}:${e.type}`), ['1:tool-start', '2:tool-end', '3:tool-start', '7:tool-summary']);
});

test('정리 규칙: output 은 스트림마다 마지막 꼬리 + 줄 수 합 · text 는 노드·role 마다 마지막 · thinking 은 글자 수 합 · 중요 이벤트 보존', () => {
  const out = coalesce([
    ev(1, 'output', 'b', { text: 'a\nb\n' }), ev(2, 'output', 'b', { text: 'c\n', toolUseId: 'x' }), ev(3, 'user', 'm', { text: 'hi' }), ev(4, 'output', 'b', { text: 'd\n' }),
    ev(5, 'text', 'm', { role: 'assistant', text: '1' }), ev(6, 'thinking', 'm', { chars: 10 }), ev(7, 'text', 'm', { role: 'system', text: 's' }),
    ev(8, 'text', 'm', { role: 'assistant', text: '2' }), ev(9, 'thinking', 'm', { chars: 5 }), ev(10, 'output', 'b', { text: 'e', ix: { v: 1 } }),
    ev(11, 'conflict', 'm', { file: 'f' }), ev(12, 'session-msg', 'm'),
  ]);
  assert.deepEqual(out.map((e) => `${e.seq}:${e.type}`), ['2:output', '3:user', '4:output', '7:text', '8:text', '9:thinking', '10:output', '11:conflict', '12:session-msg']);
  const o = out[2];
  assert.equal(o.text, 'a\nb\nd\n'); assert.equal(o.lineCount, 3); assert.equal(o.coalesced, 2);
  assert.equal(out[4].text, '2'); assert.equal(out[4].coalesced, 2);
  assert.equal(out[5].chars, 15);
  assert.ok(!('coalesced' in out[0]) && !('coalesced' in out[6]));
});

test('평소 모드는 지연 없음(node-update 만 100ms 창) · 몰림 진입 → 창 250→500→1000ms·batch · 끊기면 평소로 · 해제 히스테리시스', () => {
  const res = fakeRes(), tm = clockTimers();
  const o = new SseOut(res, { format: fmt, formatBatch: fmtB, timers: tm, now: tm.now });
  let seq = 0;
  // 평소: 100ms 마다 text 1 + node-update 1(초당 20건)
  for (let i = 0; i < 30; i++) {
    const w = res.writes;
    o.event(ev(++seq, 'text', 'a', { text: 'x' }));
    assert.equal(res.writes, w + 1, 'text 는 곧바로 씀');
    o.event(upd(++seq, 'a', { meta: { i } }));
    assert.deepEqual(tm.pending, [100], 'node-update 는 100ms 창');
    tm.advance(100);
    assert.equal(res.writes, w + 2, '100ms 안에 나감');
  }
  assert.equal(o.stats.bursts, 0);
  assert.equal(o.burst, false);
  // 몰림: 1ms 마다 이벤트
  const before = res.msgs().length;
  let entered = -1;
  const wins = [];
  for (let i = 0; i < 2500; i++) {
    o.event(ev(++seq, i % 3 ? 'output' : 'text', 'b' + (i % 4), { text: 'l' + i }));
    if (o.burst && entered < 0) entered = i;
    const p = tm.pending; if (p.length && wins.at(-1) !== p[0]) wins.push(p[0]);
    tm.advance(1);
  }
  assert.ok(entered >= 0 && entered < 40, `곧 몰림 모드(${entered}번째)`);
  assert.deepEqual(wins.slice(0, 3), [250, 500, 1000], '창이 두 배씩 1s 까지');
  const ms = res.msgs().slice(before);
  const batches = ms.filter((m) => m.event === 'batch');
  assert.ok(batches.length >= 2 && batches.length <= 6, `묶음 ${batches.length}`);
  const sent = ms.reduce((k, m) => k + (m.event === 'batch' ? m.data.events.length : m.event === 'ev' ? 1 : 0), 0);
  assert.ok(sent < 120, `2500건 → ${sent}건`);
  for (const b of batches) assert.equal(Number(b.id), b.data.events.at(-1).seq, '묶음 id = 마지막 seq');
  // 유입이 끊기면 남은 창을 다 내보내고, 다음 이벤트는 유입률이 낮으니 평소처럼 곧바로
  tm.advance(2000);
  assert.equal(o.win.length, 0);
  { const w = res.writes; o.event(ev(++seq, 'text', 'c', { text: 't' })); assert.equal(res.writes, w + 1); }
  assert.equal(o.burst, false);
  // 초당 30건(진입 50·해제 20 사이)은 다시 몰림으로 들어가지 않음 — 곧바로 씀
  for (let i = 0; i < 60; i++) { const w = res.writes; o.event(ev(++seq, 'text', 'c', { text: 't' })); assert.equal(res.writes, w + 1); tm.advance(33); }
  assert.equal(o.stats.bursts, 1);
  // 몰림 중 초당 30건이면 몰림 유지(히스테리시스)
  for (let i = 0; i < 100; i++) { o.event(ev(++seq, 'text', 'c', { text: 't' })); tm.advance(1); }
  assert.equal(o.burst, true);
  for (let i = 0; i < 60; i++) { o.event(ev(++seq, 'text', 'c', { text: 't' })); tm.advance(33); }
  assert.equal(o.burst, true, '초당 30건 → 해제(20) 위라 몰림 유지');
  for (let i = 0; i < 10; i++) { o.event(ev(++seq, 'text', 'c', { text: 't' })); tm.advance(200); }
  assert.equal(o.burst, false, '초당 5건 → 평소로');
  const ids = res.msgs().filter((m) => m.id).map((m) => Number(m.id));
  for (let i = 1; i < ids.length; i++) assert.ok(ids[i] > ids[i - 1], 'seq 단조 증가');
  assert.equal(ids.at(-1), seq, '마지막 seq 까지 모두 나감');
});

test('몰림 중 원문(projects 등)은 창을 먼저 비우고 뒤에 · 막힌 연결은 창이 drain 까지 커져 한 번에 정리', () => {
  const res = fakeRes(), tm = clockTimers();
  const o = new SseOut(res, { format: fmt, formatBatch: fmtB, timers: tm, now: tm.now });
  let seq = 0;
  for (let i = 0; i < 100; i++) o.event(ev(++seq, 'output', 'b', { text: 'x\n' }));
  assert.equal(o.burst, true);
  o.raw(formatEvent('projects', { p: 1 }));
  const ms = res.msgs();
  assert.equal(ms.at(-1).event, 'projects');
  assert.equal(ms.at(-2).event, 'ev', '창이 먼저(한 건으로 정리)');
  assert.equal(ms.at(-2).data.lineCount + ms.length - 2, 100, '평소로 나간 것 + 정리된 줄 수 = 100');
  // 막힘: 창이 쓰면서 막힘 → 3초 동안 쓰지 않고 drain 에 한 번에
  res.ok = false;
  o.event(ev(++seq, 'output', 'b', { text: 'y\n' })); tm.advance(300);
  assert.equal(o.blocked, true);
  const w = res.writes;
  for (let i = 0; i < 3000; i++) { o.event(ev(++seq, 'output', 'b', { text: 'z\n' })); tm.advance(1); }
  assert.equal(res.writes, w, '막힌 동안 쓰지 않음');
  res.ok = true; res.emit('drain');
  assert.equal(res.writes, w + 1);
  const last = res.msgs().at(-1);
  assert.equal(last.data.lineCount, 3000); assert.equal(Number(last.id), seq);
});

test('HTTP: batch=1 연결만 event: batch(옛 웹은 정리된 ev) · 링버퍼는 원본 · since 재접속은 묶음 id 다음부터', async (t) => {
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
  const tm = clockTimers();
  const open = async (q) => {
    const req = new EventEmitter(); req.headers = {}; req.socket = {};
    const res = fakeRes(); res.writeHead = () => {};
    t.after(() => req.emit('close'));
    await handleEvents(req, res, new URL('http://x/events?session=s1' + q), manager, { sseOut: { timers: tm, now: tm.now } });
    return { req, res };
  };
  const A = await open('&batch=1'), B = await open('');
  for (let i = 0; i < 200; i++) emit({ ts: 't' + i, type: i % 2 ? 'output' : 'text', nodeId: 'a', text: 'q' + i });
  tm.advance(300);
  const ba = A.res.msgs().filter((m) => m.event === 'batch'), evB = B.res.msgs().filter((m) => m.event === 'ev');
  assert.ok(ba.length >= 1, 'batch=1 이면 묶음');
  assert.equal(B.res.msgs().filter((m) => m.event === 'batch').length, 0, '옛 웹에는 묶음 없이 ev');
  assert.ok(evB.length < 80, `옛 웹도 정리된 이벤트(${evB.length})`);
  assert.equal(Number(ba.at(-1).id), 200);
  assert.equal(ring.length, 200, '링버퍼는 원본 그대로');
  assert.ok(ring.every((e) => !('coalesced' in e)));
  A.req.emit('close'); B.req.emit('close');
  emit({ ts: 'z', type: 'result', nodeId: 'a', text: 'r' });
  const C = await open('&batch=1&since=200');
  assert.deepEqual(C.res.msgs().filter((m) => m.event === 'ev').map((m) => Number(m.id)), [201]);
  C.req.emit('close');
});

test('허브(scope=all) 경로도 몰림 정리·batch', async (t) => {
  const { handleOverviewEvents } = await import('../sse.mjs');
  const subs = new Set();
  const hub = {
    hseq: 0, wake: async () => {}, snapshot: () => ({ scope: 'all', seq: hub.hseq, nodes: [] }), eventsSince: () => null,
    subscribe: (s) => { subs.add(s); return () => subs.delete(s); },
    projectsState: { projects: [] }, rootsPayload: () => [],
  };
  const emit = (e) => { e.seq = ++hub.hseq; for (const s of subs) s.onEvent(e); };
  const tm = clockTimers();
  const req = new EventEmitter(); req.headers = {}; req.socket = {};
  const res = fakeRes(); res.writeHead = () => {};
  t.after(() => req.emit('close'));
  await handleOverviewEvents(req, res, new URL('http://x/events?scope=all&batch=1'), hub, { sseOut: { timers: tm, now: tm.now } });
  for (let i = 0; i < 300; i++) emit({ ts: 't' + i, type: 'node-update', nodeId: 'n' + (i % 3), patch: { meta: { ctx: i } }, projectId: 'p', rootSessionId: 'r' });
  emit({ ts: 'x', type: 'node-remove', nodeId: 'n2', subtree: true, ids: ['n2'], projectId: 'p', rootSessionId: 'r' });
  tm.advance(300);
  const evs = res.msgs().flatMap((m) => (m.event === 'batch' ? m.data.events : m.event === 'ev' ? [m.data] : []));
  assert.ok(evs.length < 60, `301건 → ${evs.length}건`);
  assert.equal(evs.at(-1).type, 'node-remove');
  assert.ok(!evs.slice(-3).some((e) => e.nodeId === 'n2' && e.type === 'node-update' && e.seq > 50), '지워진 노드의 창 안 update 는 버림');
  req.emit('close');
});
