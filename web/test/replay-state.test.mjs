// node --test "web/test/replay-state.test.mjs"   (시험 ①～④ + 페이지·원격 seek·빌드 대기)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createState, applyEvent, cloneState, toSnapshot, stateFromSnapshot, summarize } from '../replay/state.mjs';
import { ReplayEngine, createLocalReplayApi, normalizeEvents, injectGaps, computeTimeline, clampSpeed, stepSpeed, SPEEDS } from '../replay/engine.mjs';
import { MockGenerator } from '../mock.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEMO = readFileSync(join(here, '..', 'demo-events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function genEvents(seconds, seed = 7, stress = 0) {
  const gen = new MockGenerator({ seed, startMs: Date.parse('2026-10-20T05:00:00.000Z'), stress });
  const out = [];
  while (true) {
    const nextAt = Math.min(...gen.q.map((x) => x.at));
    if (nextAt > seconds * 1000) break;
    out.push(...gen.next().events);
  }
  return out;
}
const N = (o) => JSON.parse(JSON.stringify(o));
const node = (id, extra = {}) => ({ id, parentId: null, kind: 'main', label: id, status: 'active', startedAt: 'T0', endedAt: null, lastActivityAt: 'T0', depth: 0, meta: { a: 1 }, counts: {}, openTools: [], ...extra });

// 기준: 처음부터 t ≤ at 까지 적용
function reference(events, at, root = null) {
  const st = createState({ root });
  for (const e of events) { if (e.t > at) break; applyEvent(st, e); }
  return st;
}

/** 가짜 raf + 시계. drive(ms, step) 로 벽시계를 흘린다 */
function fakeClock() {
  let now = 0; const q = [];
  return {
    raf: (fn) => { q.push(fn); return q.length; },
    caf: () => {},
    now: () => now,
    async drive(ms, step = 16) {
      const end = now + ms;
      while (now < end) {
        now += step;
        const fns = q.splice(0);
        for (const f of fns) f(now);
        if (!fns.length) await new Promise((r) => setImmediate(r));
      }
    },
    async until(pred, maxMs = 1e7, step = 16) {
      let waited = 0;
      while (!pred() && waited < maxMs) { await this.drive(step * 50, step); waited += step * 50; }
    },
  };
}

/** sink 가 받은 것으로 상태를 다시 세우고, 누락·중복을 검사 */
function recordingSink() {
  const s = { st: createState(), lastSeq: 0, events: 0, quiet: 0, snapshots: 0, violations: [], clocks: 0, skipped: 0 };
  s.onSnapshot = (snap) => { s.st = stateFromSnapshot(snap); s.lastSeq = snap.seq; s.snapshots++; };
  s.onEvent = (ev, o) => {
    if (ev.seq !== s.lastSeq + 1) s.violations.push(`seq ${ev.seq} after ${s.lastSeq}`);
    s.lastSeq = ev.seq; s.events++; if (o.quiet) s.quiet++;
    applyEvent(s.st, ev);
  };
  s.onClock = (vt, x) => { s.clocks++; if (x && x.skippedMs) s.skipped += x.skippedMs; };
  return s;
}

// ───────────────────────── ① reducer = app.js store 의미 ─────────────────────────
test('reducer: app.js onEvent 와 같은 store 갱신 규칙', () => {
  const st = createState();
  // node-add 새 노드 → root 지정(kind main), lastActivityAt 은 node 값 유지
  applyEvent(st, { seq: 1, ts: 'T1', type: 'node-add', nodeId: 's:m', node: node('s:m') });
  assert.equal(st.root, 's:m');
  assert.equal(st.nodes.get('s:m').lastActivityAt, 'T0');
  // 자식(parentId 있음)은 root 를 바꾸지 않음
  applyEvent(st, { seq: 2, ts: 'T2', type: 'node-add', nodeId: 'a:1', node: node('a:1', { kind: 'subagent', parentId: 's:m', depth: 1 }) });
  assert.equal(st.root, 's:m');
  // 원본 노드 객체와 공유하지 않음
  const src = node('a:2', { kind: 'subagent', parentId: 's:m' });
  applyEvent(st, { seq: 3, ts: 'T3', type: 'node-add', nodeId: 'a:2', node: src });
  src.meta.a = 99; src.openTools.push({ toolUseId: 'x' });
  assert.equal(st.nodes.get('a:2').meta.a, 1);
  assert.equal(st.nodes.get('a:2').openTools.length, 0);
  // 이미 있는 노드의 node-add → 덮어쓰기 + lastActivityAt = ts
  applyEvent(st, { seq: 4, ts: 'T4', type: 'node-add', nodeId: 'a:1', node: node('a:1', { kind: 'subagent', parentId: 's:m', label: '새 이름', depth: 1 }) });
  assert.equal(st.nodes.get('a:1').label, '새 이름');
  assert.equal(st.nodes.get('a:1').lastActivityAt, 'T4');
  // node-update: 얕은 병합, meta 는 meta 끼리 얕은 병합
  applyEvent(st, { seq: 5, ts: 'T5', type: 'node-update', nodeId: 'a:1', patch: { status: 'done', endedAt: 'T5', meta: { skill: 'x' } } });
  const a1 = st.nodes.get('a:1');
  assert.equal(a1.status, 'done'); assert.equal(a1.endedAt, 'T5'); assert.deepEqual(a1.meta, { a: 1, skill: 'x' }); assert.equal(a1.lastActivityAt, 'T5');
  // tool-start: 추가, 같은 toolUseId 중복 무시
  const ts = { type: 'tool-start', nodeId: 's:m', toolUseId: 'tu1', tool: 'Bash', cat: 'shell', skill: null, text: '명령' };
  applyEvent(st, { ...ts, seq: 6, ts: 'T6' });
  applyEvent(st, { ...ts, seq: 7, ts: 'T7' });
  assert.deepEqual(st.nodes.get('s:m').openTools, [{ toolUseId: 'tu1', tool: 'Bash', cat: 'shell', skill: null, startedAt: 'T6', text: '명령' }]);
  assert.equal(st.nodes.get('s:m').lastActivityAt, 'T7');
  // tool-end: 제거
  applyEvent(st, { seq: 8, ts: 'T8', type: 'tool-end', nodeId: 's:m', toolUseId: 'tu1', ok: true });
  assert.deepEqual(st.nodes.get('s:m').openTools, []);
  // text·user·output·result·thinking: 상태는 lastActivityAt 만
  for (const [i, type] of ['text', 'user', 'output', 'result', 'thinking'].entries()) applyEvent(st, { seq: 9 + i, ts: 'X' + i, type, nodeId: 's:m', text: 'x' });
  assert.equal(st.nodes.get('s:m').lastActivityAt, 'X4');
  // 모르는 노드 이벤트는 무시(노드 생기지 않음), seq 는 전진
  applyEvent(st, { seq: 20, ts: 'T20', type: 'tool-start', nodeId: 'a:none', toolUseId: 'z' });
  assert.equal(st.nodes.has('a:none'), false); assert.equal(st.seq, 20);
  // seq ≤ 현재 seq 는 버림(app 의 ev.seq <= store.seq 필터)
  assert.equal(applyEvent(st, { seq: 20, ts: 'T', type: 'node-update', nodeId: 's:m', patch: { status: 'idle' } }), false);
  assert.equal(st.nodes.get('s:m').status, 'active');
  // parentId 없는 첫 노드도 root
  const s2 = createState();
  applyEvent(s2, { seq: 1, ts: 'T', type: 'node-add', nodeId: 'a:x', node: node('a:x', { kind: 'subagent' }) });
  assert.equal(s2.root, 'a:x');
  // cloneState 는 깊은 복사, toSnapshot 은 생성 순서
  const c = cloneState(st); c.nodes.get('s:m').meta.a = 5;
  assert.equal(st.nodes.get('s:m').meta.a, 1);
  assert.deepEqual(toSnapshot(st).nodes.map((n) => n.id), ['s:m', 'a:1', 'a:2']);
});

test('normalizeEvents: 시각 순 안정 정렬, rseq·seq·t 부여', () => {
  const ev = normalizeEvents([{ ts: '2026-01-01T00:00:02Z', type: 'a' }, { ts: '2026-01-01T00:00:01Z', type: 'b' }, { ts: '2026-01-01T00:00:01Z', type: 'c' }]);
  assert.deepEqual(ev.map((e) => e.type), ['b', 'c', 'a']);
  assert.deepEqual(ev.map((e) => e.rseq), [1, 2, 3]);
  assert.deepEqual(ev.map((e) => e.seq), [1, 2, 3]);
  assert.equal(ev[0].t, Date.parse('2026-01-01T00:00:01Z'));
});

test('computeTimeline: 버킷·공백·노드 출현', () => {
  const events = normalizeEvents(injectGaps(DEMO, [{ after: 300, ms: 120000 }]));
  const tl = computeTimeline(events, { buckets: 100, sessionId: 'x' });
  assert.equal(tl.buckets.counts.length, 100);
  assert.equal(tl.buckets.counts.reduce((a, b) => a + b, 0), events.length);
  assert.ok(tl.buckets.spawns.reduce((a, b) => a + b, 0) > 3);
  assert.ok(tl.buckets.errors.reduce((a, b) => a + b, 0) >= 1);
  assert.equal(tl.gaps.length, 1);
  assert.ok(Date.parse(tl.gaps[0].to) - Date.parse(tl.gaps[0].from) >= 120000);
  assert.equal(tl.root, 's:demo-main-0001');
  assert.ok(tl.nodes.some((n) => n.kind === 'claude-p'));
  assert.ok(tl.nodes.filter((n) => n.endTs).length >= 1);
});

test('속도 단계: clamp·step', () => {
  assert.equal(clampSpeed(100), 32); assert.equal(clampSpeed(0.1), 0.5); assert.equal(clampSpeed('x'), 1);
  assert.equal(stepSpeed(1, 1), 2); assert.equal(stepSpeed(1, -1), 0.5); assert.equal(stepSpeed(32, 1), 32); assert.equal(stepSpeed(0.5, -1), 0.5);
  assert.equal(stepSpeed(3, 1), 4); assert.equal(stepSpeed(3, -1), 2);
  assert.deepEqual(SPEEDS, [0.5, 1, 2, 4, 8, 16, 32]);
});

// ───────────────────────── ② seek == 처음부터 적용 ─────────────────────────
test('seek: 아무 지점이나 처음부터 적용한 결과와 같다(keyframe·페이지 경계 포함)', async () => {
  const raw = genEvents(420, 11); // 수천 건 → keyframe 여러 개, 페이지 여러 개
  const api = createLocalReplayApi(raw, { sessionId: 'sx' });
  const events = api.events;
  assert.ok(events.length > 1500, `events ${events.length}`);
  const clk = fakeClock();
  const sink = recordingSink();
  const eng = new ReplayEngine({ api, sessionId: 'sx', sink, raf: clk.raf, caf: clk.caf, now: clk.now, doc: null, pageLimit: 700 });
  assert.equal(await eng.open(), true);
  await clk.until(() => eng.contig === eng.total, 1e6);
  assert.equal(eng.contig, events.length);
  assert.ok(eng.kf.length >= Math.floor(events.length / 500));
  const t0 = events[0].t, t1 = events[events.length - 1].t;
  const points = [t0 - 1, t0, t0 + 1, events[499].t, events[500].t, events[700].t, events[1401].t, (t0 + t1) / 2, t1 - 1, t1, t1 + 5000];
  for (let k = 0; k < 25; k++) points.push(t0 + ((k * 7919) % 1000) / 1000 * (t1 - t0));
  for (const p of points) {
    await eng.seek(p);
    const ref = reference(events, Math.max(t0, Math.min(t1, p)), api.timeline.root);
    assert.deepEqual(summarize(sink.st), summarize(ref), `seek ${p - t0}`);
    assert.equal(sink.st.seq, ref.seq);
    assert.equal(eng.vt, Math.max(t0, Math.min(t1, p)));
  }
  // seek 뒤 재생 → 끝까지 가면 최종 상태 동일
  await eng.seek(events[1000].t);
  eng.setSpeed(32); eng.play();
  await clk.until(() => eng.status === 'ended', 1e7);
  assert.deepEqual(summarize(sink.st), summarize(reference(events, Infinity, api.timeline.root)));
  assert.deepEqual(sink.violations, []);
  eng.close();
});

test('seek: 적재 범위 밖이면 /replay/snapshot 으로 가고 그 뒤 페이지를 먼저 받는다', async () => {
  const raw = genEvents(300, 5);
  const api = createLocalReplayApi(raw, { sessionId: 'rs', delayMs: 5 });
  const events = api.events;
  const sink = recordingSink();
  const clk = fakeClock();
  const eng = new ReplayEngine({ api, sessionId: 'rs', sink, raf: clk.raf, caf: clk.caf, now: clk.now, doc: null, pageLimit: 200 });
  await eng.open();
  assert.ok(eng.contig < events.length, 'still loading');
  const target = events[events.length - 50].t;
  await eng.seek(target);
  assert.ok(api.calls.some((c) => c.path === 'replay/snapshot'), 'used server snapshot');
  assert.deepEqual(summarize(sink.st), summarize(reference(events, target, api.timeline.root)));
  // 그 다음 페이지가 contig 보다 먼저 온다
  await new Promise((r) => setTimeout(r, 60));
  const evCalls = api.calls.filter((c) => c.path === 'replay/events').map((c) => c.q.from);
  assert.ok(evCalls.some((f) => f > events.length - 60), `priority page requested: ${evCalls.join(',')}`);
  eng.play();
  eng.setSpeed(8);
  await clk.until(() => eng.status === 'ended', 2e5);
  assert.equal(eng.status, 'ended');
  assert.deepEqual(summarize(sink.st), summarize(reference(events, Infinity, api.timeline.root)));
  assert.deepEqual(sink.violations, []);
  eng.close();
});

// ───────────────────────── ③ 유휴 압축 ─────────────────────────
test('유휴 압축: 4초 넘는 간격만, 직전+1초 뒤 다음−300ms 로 건너뜀', async () => {
  const gaps = [{ after: 100, ms: 180000 }, { after: 400, ms: 3000 }, { after: 600, ms: 600000 }];
  const raw = injectGaps(DEMO.slice(0, 800), gaps);
  const api = createLocalReplayApi(raw);
  const events = api.events;
  const clk = fakeClock();
  const sink = recordingSink();
  const eng = new ReplayEngine({ api, sessionId: 'demo-replay', sink, raf: clk.raf, caf: clk.caf, now: clk.now, doc: null });
  await eng.open();
  eng.setSpeed(4);
  eng.play();
  await clk.until(() => eng.status === 'ended', 1e7);
  // 기대치: 간격 g>4000 마다 g − 1000 − 300 (프레임 이동량만큼 오차)
  let expect = 0;
  for (let i = 1; i < events.length; i++) { const g = events[i].t - events[i - 1].t; if (g > 4000) expect += g - 1300; }
  assert.ok(expect > 780000 - 10000);
  assert.ok(Math.abs(eng.skippedIdleMs - expect) < 64 * 4 * 20, `skipped ${eng.skippedIdleMs} vs ${expect}`);
  assert.equal(Math.round(sink.skipped), Math.round(eng.skippedIdleMs));
  assert.deepEqual(sink.violations, []);
  assert.equal(sink.lastSeq, events.length);
  // 끄면 건너뛰지 않음
  const sink2 = recordingSink();
  const clk2 = fakeClock();
  const e2 = new ReplayEngine({ api, sessionId: 'demo-replay', sink: sink2, raf: clk2.raf, caf: clk2.caf, now: clk2.now, doc: null, compressIdle: false });
  await e2.open();
  e2.setSpeed(32); e2.play();
  await clk2.drive(20000, 50);
  assert.equal(e2.skippedIdleMs, 0);
  e2.close(); eng.close();
});

// ───────────────────────── ④ 0.5×～32× 누락·중복 0 ─────────────────────────
test('속도별 재생: 0.5×～32× 에서 이벤트 누락·중복 0, quiet·접기 규칙', async () => {
  const raw = injectGaps(genEvents(200, 3), [{ after: 50, ms: 90000 }]);
  const api = createLocalReplayApi(raw, { sessionId: 'sp' });
  const events = api.events;
  const final = summarize(reference(events, Infinity, api.timeline.root));
  for (const sp of SPEEDS) {
    const clk = fakeClock();
    const sink = recordingSink();
    const eng = new ReplayEngine({ api, sessionId: 'sp', sink, raf: clk.raf, caf: clk.caf, now: clk.now, doc: null, pageLimit: 1000 });
    await eng.open();
    eng.setSpeed(sp); eng.play();
    await clk.until(() => eng.status === 'ended', 1e8, 16);
    assert.equal(eng.status, 'ended', `speed ${sp}`);
    assert.deepEqual(sink.violations, [], `speed ${sp}`);
    assert.equal(sink.lastSeq, events.length, `speed ${sp}`);
    assert.equal(sink.events, events.length, `speed ${sp}: 접기 없이 전부 디스패치`);
    assert.deepEqual(summarize(sink.st), final, `speed ${sp}`);
    eng.close();
  }
});

test('밀린 이벤트: 프레임당 300건 넘으면 quiet, 3000건 넘으면 스냅샷 하나로 접기', async () => {
  // 같은 ms 에 몰린 4000건 + 그 1초 뒤 400건
  const base = Date.parse('2026-10-23T00:00:00Z');
  const raw = [{ type: 'node-add', nodeId: 's:m', node: node('s:m'), ts: new Date(base).toISOString() }];
  for (let i = 0; i < 4000; i++) raw.push({ type: 'text', nodeId: 's:m', role: 'assistant', text: 'x', ts: new Date(base + 10).toISOString() });
  for (let i = 0; i < 400; i++) raw.push({ type: 'text', nodeId: 's:m', role: 'assistant', text: 'y', ts: new Date(base + 1010).toISOString() });
  const api = createLocalReplayApi(raw, { sessionId: 'f' });
  const clk = fakeClock(); const sink = recordingSink();
  const eng = new ReplayEngine({ api, sessionId: 'f', sink, raf: clk.raf, caf: clk.caf, now: clk.now, doc: null });
  await eng.open();
  const snaps0 = sink.snapshots;
  eng.play();
  await clk.until(() => eng.status === 'ended', 1e6);
  assert.equal(sink.snapshots, snaps0 + 1, 'folded once');
  assert.equal(sink.quiet, 100, '400 in one frame → 100 quiet');
  assert.equal(sink.lastSeq, raw.length);
  assert.deepEqual(sink.violations, []);
  eng.close();
});

test('열기: 202(빌드 중) 진행률을 알리고 1초 간격으로 다시 부른다, 404 는 오류', async () => {
  const api = createLocalReplayApi(DEMO, { buildPolls: 2 });
  const states = [];
  const eng = new ReplayEngine({ api, sessionId: 'demo-replay', sink: {}, onState: (s) => states.push(s), doc: null, pollMs: 10 });
  assert.equal(await eng.open(), true);
  assert.ok(states.some((s) => s.status === 'loading' && s.progress && s.progress.bytesTotal === 2000));
  assert.equal(eng.status, 'ready');
  assert.equal(api.calls.filter((c) => c.path === 'timeline').length, 3);
  eng.close();
  const bad = new ReplayEngine({ api, sessionId: 'nope', sink: {}, doc: null, pollMs: 10 });
  assert.equal(await bad.open(), false);
  assert.equal(bad.status, 'error');
});

test('조작: 일시정지 중 진행 없음, 끝에서 play 는 처음부터, 숨김 탭 자동 정지', async () => {
  const api = createLocalReplayApi(DEMO.slice(0, 200));
  const clk = fakeClock(); const sink = recordingSink();
  const doc = { hidden: false, _l: null, addEventListener(_, f) { this._l = f; }, removeEventListener() {} };
  const eng = new ReplayEngine({ api, sessionId: 'demo-replay', sink, raf: clk.raf, caf: clk.caf, now: clk.now, doc });
  await eng.open();
  eng.play(); await clk.drive(500);
  const vt1 = eng.vt; assert.ok(vt1 > eng.startT);
  eng.pause(); await clk.drive(500);
  assert.equal(eng.vt, vt1); assert.equal(eng.status, 'paused');
  eng.toggle(); assert.equal(eng.status, 'playing');
  doc.hidden = true; doc._l();
  assert.equal(eng.status, 'paused');
  doc.hidden = false; doc._l();
  assert.equal(eng.status, 'playing');
  eng.setSpeed(32);
  await clk.until(() => eng.status === 'ended');
  eng.play();
  assert.equal(eng.status, 'playing');
  assert.ok(eng.vt <= eng.startT + 100);
  // 끝 → 처음 seek 은 스냅샷(seq 를 낮춤): 시작 시각과 같은 ms 의 이벤트까지만 적용된 상태
  assert.equal(sink.lastSeq, api.events.filter((e) => e.t <= eng.startT).length);
  eng.close();
});

test('빌드 교체: 여러 페이지를 받는 사이 서버가 다시 만들면(builtAt 변경) 버퍼를 비우고 새 빌드로 이어 받아 끝 상태 = 새 빌드', async () => {
  const raw = genEvents(420, 13);
  const cut = Math.floor(raw.length * 0.8);
  const apiA = createLocalReplayApi(raw.slice(0, cut), { sessionId: 'rb' });
  const apiB = createLocalReplayApi(raw, { sessionId: 'rb' });
  apiA.timeline.builtAt = '2026-10-23T00:00:00.000Z';
  apiB.timeline.builtAt = '2026-10-23T00:00:30.000Z';
  let cur = apiA, pages = 0;
  const api = { calls: [], async getJson(p, q) { this.calls.push(p); if (p === 'replay/events' && ++pages === 2) cur = apiB; return cur.getJson(p, q); } };
  const clk = fakeClock();
  const sink = recordingSink();
  const eng = new ReplayEngine({ api, sessionId: 'rb', sink, raf: clk.raf, caf: clk.caf, now: clk.now, doc: null, pageLimit: 400 });
  assert.equal(await eng.open(), true);
  await clk.until(() => eng.total === apiB.events.length && eng.contig === eng.total, 1e6);
  assert.equal(eng.rebuilds, 1, '빌드 교체를 한 번 알아챔');
  assert.equal(eng.builtAt, apiB.timeline.builtAt);
  assert.equal(eng.total, apiB.events.length);
  for (let i = 0; i < eng.total; i++) assert.equal(eng.ev[i].rseq, apiB.events[i].rseq, `ev ${i}`);
  eng.setSpeed(32); eng.play();
  await clk.until(() => eng.status === 'ended', 1e7);
  assert.deepEqual(summarize(sink.st), summarize(reference(apiB.events, Infinity, apiB.timeline.root)));
  assert.deepEqual(sink.violations, []);
  eng.close();
});
