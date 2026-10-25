// 재생 API — 합성 fixture 만 사용
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { makeReplayFixture, rmReplayFixture, ageIndex, RIDS } from './fixtures/replay-build.mjs';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import {
  buildReplay, buildReplayFromEvents, createState, applyEvent, snapshotAt, pageOf, timelineOf, ReplayCache, KEYFRAME_EVERY,
} from '../replay.mjs';
import { createServer, createRealManager } from '../index.mjs';
import { DemoManager } from '../demo.mjs';

const TOKEN = 'replay-token-' + 'b'.repeat(32);
const H = { 'x-ccviz-token': TOKEN };
let fx, index, data, liveRt;
let mgr, server, base, pmgr, pserver, pbase, dmgr, dserver, dbase;

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const body = res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw) : raw;
        resolve({ status: res.statusCode, headers: res.headers, wire: raw.length, body: body.toString('utf8') });
      });
    }).on('error', reject);
  });
}
const J = async (url, headers = H) => { const r = await get(url, headers); return { ...r, json: JSON.parse(r.body) }; };

before(async () => {
  fx = makeReplayFixture();
  process.env.CCVIZ_CLAUDE_TMP = fx.tmpClaude;
  index = new SessionIndex({ projectsDir: fx.projects, sessionsDir: fx.sessions });
  await index.refresh();
  ageIndex(index);
  // 라이브 런타임(1차 동작)은 서버 기동 1시간 전보다 옛 claude -p 자식을 찾지 않는다
  liveRt = new RootRuntime({ sessionId: RIDS.main, index });
  await liveRt.start();
  liveRt.close();
  data = await buildReplay({ sessionId: RIDS.main, index });

  mgr = createRealManager({ projectsDir: fx.projects, sessionsDir: fx.sessions });
  await mgr.index.refresh(); ageIndex(mgr.index);
  server = createServer({ token: TOKEN, manager: mgr, webRoot: fx.root });
  base = await listen(server);
  pmgr = createRealManager({ projectsDir: fx.projects, sessionsDir: fx.sessions, project: fx.otherProjectDir });
  await pmgr.index.refresh(); ageIndex(pmgr.index);
  pserver = createServer({ token: TOKEN, manager: pmgr, webRoot: fx.root, project: fx.otherProjectDir });
  pbase = await listen(pserver);
  dmgr = new DemoManager();
  dserver = createServer({ token: TOKEN, manager: dmgr, webRoot: fx.root });
  dbase = await listen(dserver);
});

after(() => {
  for (const s of [server, pserver, dserver]) { s?.close(); s?.closeAllConnections?.(); }
  mgr?.stop(); pmgr?.stop(); dmgr?.stop();
  rmReplayFixture(fx);
});

const nodeAddT = (id) => data.events.find((e) => e.type === 'node-add' && e.nodeId === id)?.t;
const evsOf = (id) => data.events.filter((e) => e.nodeId === id);

test('§14.1 재구성: 모든 kind 노드, 최종 상태 = 오프라인 그래프', () => {
  const kinds = new Set(data.nodeIndex.map((n) => n.kind));
  for (const k of ['main', 'subagent', 'workflow', 'workflow-agent', 'claude-p', 'bash-bg', 'monitor']) assert.ok(kinds.has(k), k);
  assert.equal(data.root, `s:${RIDS.main}`);
  assert.equal(data.title, '재생 시험');
  assert.equal(data.stats.finalMismatch, 0);
  assert.equal(data.complete, true);
  assert.equal(data.startTs, fx.T(0));
  const st = data.finalState;
  assert.equal(st.nodes.get('a:ragent01').status, 'done');
  assert.equal(st.nodes.get('a:rwa01').status, 'done');
  assert.equal(st.nodes.get('b:rbg001').status, 'done');
  assert.equal(st.nodes.get('w:wf_r-001').status, 'done');
  // 시간 순 결과·종료: 워크플로 에이전트 result 는 그 에이전트 마지막 기록 시각
  const r = data.events.find((e) => e.type === 'result' && e.nodeId === 'a:rwa01');
  assert.equal(r.t, Date.parse(fx.T(20)));
});

test('§14.1 1시간 넘게 지난 claude -p 자식: 라이브는 못 찾고 재생은 찾는다', () => {
  assert.equal(liveRt.graph.has(`s:${RIDS.child}`), false);
  const c = data.nodeIndex.find((n) => n.id === `s:${RIDS.child}`);
  assert.ok(c, 'claude-p 자식');
  assert.equal(c.kind, 'claude-p');
  assert.equal(c.parentId, `s:${RIDS.main}`);
  assert.equal(nodeAddT(`s:${RIDS.child}`), Date.parse(fx.T(40))); // 부모 Bash tool_use 시각
  assert.ok(evsOf(`s:${RIDS.child}`).some((e) => e.type === 'text'));
  assert.equal(data.finalState.nodes.get(`s:${RIDS.child}`).status, 'done');
});

test('§14.1-1 node-add 시각 = 생성 계기 tool_use / 첫 기록', () => {
  assert.equal(nodeAddT(`s:${RIDS.main}`), Date.parse(fx.T(0)));
  assert.equal(nodeAddT('a:ragent01'), Date.parse(fx.T(3)));
  assert.equal(nodeAddT('w:wf_r-001'), Date.parse(fx.T(10)));
  assert.equal(nodeAddT('a:rwa01'), Date.parse(fx.T(12)));
  assert.equal(nodeAddT('b:rbg001'), Date.parse(fx.T(30)));
  assert.equal(nodeAddT('m:rmon01'), Date.parse(fx.T(60)));
  const add = data.events.find((e) => e.type === 'node-add' && e.nodeId === 'a:ragent01');
  assert.equal(add.node.status, 'active');
  assert.equal(add.node.endedAt, null);
  assert.deepEqual(add.node.openTools, []);
  assert.equal(add.node.startedAt, fx.T(3));
});

test('§14.1-6 정렬·번호: t 비감소, 같은 t 는 타입 순위, rseq=seq=1..N', () => {
  const R = { 'node-add': 0, 'node-update': 1, 'tool-start': 2, 'tool-end': 4 };
  const rk = (t) => R[t] ?? 3;
  data.events.forEach((e, i) => {
    assert.equal(e.rseq, i + 1);
    assert.equal(e.seq, i + 1);
    assert.equal(e.t, Date.parse(e.ts));
    if (i) {
      const p = data.events[i - 1];
      assert.ok(p.t <= e.t, `시각 역전 ${i}`);
      if (p.t === e.t) assert.ok(rk(p.type) <= rk(e.type), `타입 순위 ${i}`);
    }
  });
});

test('§14.1-2·3 범위 밖 시각 고정과 인과 순서', () => {
  const lo = Date.parse(data.startTs), hi = Date.parse(data.endTs) + 5000;
  for (const e of data.events) assert.ok(e.t >= lo && e.t <= hi, `범위 ${e.type} ${e.nodeId}`);
  const bad = data.events.find((e) => e.nodeId === 'a:rwa02' && e.type === 'text' && e.text.includes('시계가 틀린'));
  assert.ok(bad.synth);
  assert.ok(bad.t >= nodeAddT('a:rwa02'));
  // 부모 등장 ≤ 자식 등장 ≤ 자식 이벤트
  const addT = new Map(data.events.filter((e) => e.type === 'node-add').map((e) => [e.nodeId, e.t]));
  for (const e of data.events) {
    if (e.type === 'node-add') { if (e.node.parentId) assert.ok(addT.get(e.node.parentId) <= e.t, `부모 먼저 ${e.nodeId}`); continue; }
    assert.ok(addT.get(e.nodeId) <= e.t, `등장 뒤 이벤트 ${e.type} ${e.nodeId}`);
  }
  // 같은 toolUseId 의 시작 ≤ 끝 (23.5초 결과가 24초 시작 뒤로)
  const s = data.events.find((e) => e.type === 'tool-start' && e.toolUseId === 'toolu_rwa2_grep');
  const en = data.events.find((e) => e.type === 'tool-end' && e.toolUseId === 'toolu_rwa2_grep');
  assert.ok(s.rseq < en.rseq && s.t <= en.t);
  assert.ok(en.synth);
});

test('§14.1-4 백그라운드 출력 배분: 줄 위치 비례, 진짜 시각 알림이 있으면 모니터 파일은 쓰지 않음', () => {
  const outs = evsOf('b:rbg001').filter((e) => e.type === 'output');
  assert.ok(outs.length >= 1);
  const lo = Date.parse(fx.T(30)), hi = Date.parse(fx.T(90));
  for (const o of outs) { assert.ok(o.synth); assert.ok(o.t >= lo && o.t <= hi); }
  const all = outs.map((o) => o.text).join('\n');
  assert.ok(all.includes('bg line 1') && all.includes('bg line 10'));
  assert.equal(outs[outs.length - 1].t, hi); // 마지막 줄 = 종료 시각
  const mon = evsOf('m:rmon01').filter((e) => e.type === 'output');
  assert.deepEqual(mon.map((e) => e.text), ['첫 이벤트', '둘째 이벤트']);
  assert.deepEqual(mon.map((e) => e.t), [Date.parse(fx.T(70)), Date.parse(fx.T(80))]);
  assert.ok(mon.every((e) => !e.synth));
});

test('§14.1-4 출력 60조각 상한', async () => {
  // 600자 넘는 출력을 많이 만들어 조각 수 확인(합성 런타임 없이 직접)
  const fx2 = makeReplayFixture();
  try {
    const fs = await import('node:fs');
    fs.writeFileSync(fx2.bgOut, Array.from({ length: 2000 }, (_, i) => `row ${i} ${'x'.repeat(40)}`).join('\n') + '\n');
    process.env.CCVIZ_CLAUDE_TMP = fx2.tmpClaude;
    const ix = new SessionIndex({ projectsDir: fx2.projects, sessionsDir: fx2.sessions });
    await ix.refresh(); ageIndex(ix);
    const d = await buildReplay({ sessionId: RIDS.main, index: ix });
    const outs = d.events.filter((e) => e.nodeId === 'b:rbg001' && e.type === 'output');
    assert.ok(outs.length <= 60 && outs.length >= 30, `조각 ${outs.length}`);
    for (const o of outs) assert.ok(o.text.length <= 600);
    for (let i = 1; i < outs.length; i++) assert.ok(outs[i].t >= outs[i - 1].t);
  } finally {
    process.env.CCVIZ_CLAUDE_TMP = fx.tmpClaude;
    rmReplayFixture(fx2);
  }
});

test('§14.1-5 대기 합성: 60초 넘는 공백 → last+60s idle, 다음 기록에 active', () => {
  const ups = evsOf('a:ragent01').filter((e) => e.type === 'node-update' && e.patch?.status);
  const idle = ups.find((e) => e.patch.status === 'idle');
  assert.ok(idle && idle.synth);
  assert.equal(idle.t, Date.parse(fx.T(7)) + 60_000);
  const act = ups.find((e) => e.patch.status === 'active' && e.t > idle.t);
  assert.ok(act && act.synth);
  assert.equal(act.t, Date.parse(fx.T(200)));
  const done = ups.find((e) => e.patch.status === 'done');
  assert.equal(done.t, Date.parse(fx.T(250)));
  // 진행 중 상태 표: 100초 시점엔 idle, 210초 시점엔 active
  assert.equal(snapshotAt(data, Date.parse(fx.T(100))).nodes.find((n) => n.id === 'a:ragent01').status, 'idle');
  assert.equal(snapshotAt(data, Date.parse(fx.T(210))).nodes.find((n) => n.id === 'a:ragent01').status, 'active');
});

// 큰 합성 이벤트 열(keyframe 여러 개)
function synthEvents(n) {
  const T0 = Date.parse('2026-10-01T00:00:00.000Z');
  const ts = (k) => new Date(T0 + k * 700).toISOString();
  const ev = [{ type: 'node-add', nodeId: 's:x', ts: ts(0), node: { id: 's:x', parentId: null, kind: 'main', label: 'x', status: 'active', meta: {}, openTools: [], depth: 0 } }];
  let k = 1;
  for (let i = 0; ev.length < n; i++) {
    const nid = `a:${i % 7}`;
    if (i < 7) ev.push({ type: 'node-add', nodeId: nid, ts: ts(k++), node: { id: nid, parentId: 's:x', kind: 'subagent', label: `a${i}`, status: 'active', meta: { skill: null }, openTools: [], depth: 1 } });
    ev.push({ type: 'tool-start', nodeId: nid, ts: ts(k), toolUseId: `t${i}`, tool: 'Read', cat: 'read', skill: null, text: 'f' });
    if (i % 5 === 0) ev.push({ type: 'node-update', nodeId: nid, ts: ts(k), patch: { status: i % 10 ? 'idle' : 'active', meta: { skill: `s${i}` } } });
    if (i % 3) ev.push({ type: 'tool-end', nodeId: nid, ts: ts(k + 1), toolUseId: `t${i}`, tool: 'Read', cat: 'read', ok: true, durationMs: 1, text: '' });
    k += 2;
  }
  return ev;
}

test('§14.3 keyframe·snapshot = 처음부터 적용한 결과 (아무 지점)', async () => {
  const d = await buildReplayFromEvents({ sessionId: 'syn', events: synthEvents(3500) });
  assert.ok(d.keyframes.length >= 4);
  assert.equal(d.keyframes[1].rseq, KEYFRAME_EVERY);
  const points = [d.events[0].t - 1, d.events[0].t, d.events[999].t, d.events[1000].t, d.events[2345].t, d.events[d.events.length - 1].t + 5];
  for (const at of points) {
    const snap = snapshotAt(d, at);
    const st = createState();
    let n = 0;
    for (const e of d.events) { if (e.t > at) break; applyEvent(st, e); n++; }
    assert.equal(snap.rseq, n);
    assert.equal(snap.seq, n);
    assert.deepEqual(snap.nodes, [...st.nodes.values()], `at=${at}`);
    assert.equal(snap.recent.length, Math.min(300, n));
    if (n) assert.equal(snap.recent[snap.recent.length - 1].rseq, n);
  }
  // 실제 재구성 데이터도 마지막 지점 = 최종 상태
  const last = snapshotAt(data, Date.parse(data.endTs) + 1);
  assert.deepEqual(last.nodes, [...data.finalState.nodes.values()]);
});

test('reducer = app.js store 의미(node-add 덮어쓰기·meta 얕은 병합·openTools·lastActivityAt·root)', () => {
  const st = createState();
  applyEvent(st, { seq: 1, type: 'node-add', nodeId: 'a:1', ts: 't1', node: { id: 'a:1', parentId: 's:r', kind: 'subagent', meta: { a: 1 }, openTools: [] } });
  assert.equal(st.root, null); // parentId 있는 subagent 는 root 가 아님
  applyEvent(st, { seq: 2, type: 'node-add', nodeId: 's:r', ts: 't2', node: { id: 's:r', parentId: null, kind: 'main', meta: {}, openTools: [] } });
  assert.equal(st.root, 's:r');
  applyEvent(st, { seq: 3, type: 'node-update', nodeId: 'a:1', ts: 't3', patch: { status: 'idle', meta: { b: 2 } } });
  assert.deepEqual(st.nodes.get('a:1').meta, { a: 1, b: 2 });
  applyEvent(st, { seq: 4, type: 'tool-start', nodeId: 'a:1', ts: 't4', toolUseId: 'u', tool: 'Bash', cat: 'shell', skill: null, text: 'x' });
  applyEvent(st, { seq: 5, type: 'tool-start', nodeId: 'a:1', ts: 't5', toolUseId: 'u', tool: 'Bash', cat: 'shell', skill: null, text: 'x' });
  assert.equal(st.nodes.get('a:1').openTools.length, 1);
  assert.equal(st.nodes.get('a:1').openTools[0].startedAt, 't4');
  applyEvent(st, { seq: 6, type: 'tool-end', nodeId: 'a:1', ts: 't6', toolUseId: 'u' });
  assert.equal(st.nodes.get('a:1').openTools.length, 0);
  assert.equal(st.nodes.get('a:1').lastActivityAt, 't6');
  applyEvent(st, { seq: 7, type: 'node-add', nodeId: 'a:1', ts: 't7', node: { id: 'a:1', parentId: 's:r', kind: 'subagent', label: 'new', meta: { c: 3 }, openTools: [] } });
  assert.equal(st.nodes.get('a:1').label, 'new');
  assert.deepEqual(st.nodes.get('a:1').meta, { c: 3 });
  assert.equal(st.nodes.get('a:1').lastActivityAt, 't7');
  applyEvent(st, { seq: 8, type: 'text', nodeId: 'zz', ts: 't8' }); // 없는 노드는 무시
  assert.equal(st.seq, 8);
});

test('§14.3 페이지: 경계·next·fromT·limit 상한', async () => {
  const d = await buildReplayFromEvents({ sessionId: 'syn', events: synthEvents(1234) });
  const got = [];
  let from = 1, pages = 0;
  while (from) { const p = pageOf(d, { from, limit: 100 }); got.push(...p.events); from = p.next; pages++; assert.equal(p.total, d.events.length); }
  assert.equal(pages, Math.ceil(d.events.length / 100));
  assert.deepEqual(got.map((e) => e.rseq), d.events.map((e) => e.rseq));
  const last = pageOf(d, { from: d.events.length, limit: 100 });
  assert.equal(last.events.length, 1); assert.equal(last.next, null);
  const past = pageOf(d, { from: d.events.length + 50 });
  assert.equal(past.events.length, 0); assert.equal(past.next, null);
  const t = d.events[500].t;
  const ft = pageOf(d, { fromT: t, limit: 3 });
  assert.ok(ft.events[0].t >= t && d.events[ft.from - 2].t < t);
  assert.equal(pageOf(d, { from: 1, limit: 99999 }).events.length, Math.min(5000, d.events.length));
});

test('타임라인: 버킷 합 = 이벤트 수, 버킷 개수 50..1000, 공백 구간', () => {
  const tl = timelineOf(data, 10);
  assert.equal(tl.buckets.counts.length, 50);
  assert.equal(tl.buckets.counts.reduce((a, b) => a + b, 0), tl.eventCount);
  assert.equal(tl.eventCount, data.events.length);
  assert.ok(tl.buckets.spawns.reduce((a, b) => a + b, 0) >= 6);
  assert.ok(tl.gaps.some((g) => Date.parse(g.to) - Date.parse(g.from) >= 60_000));
  assert.equal(timelineOf(data, 5000).buckets.counts.length, 1000);
  assert.equal(tl.nodes.length, data.nodeIndex.length);
});

test('캐시: 같은 지문이면 재사용, wait=0 은 즉시 building, 단일 비행', async () => {
  const cache = new ReplayCache({ index, max: 2 });
  const r0 = await cache.get(RIDS.main, { wait: false });
  assert.equal(r0.building, true);
  const [a, b] = await Promise.all([cache.get(RIDS.main), cache.get(RIDS.main)]);
  assert.equal(a, b);
  assert.equal(await cache.get(RIDS.main, { refresh: true }), a); // 지문 같음 → 다시 만들지 않음
  assert.equal(cache.peek(RIDS.main), a);
  await assert.rejects(cache.get('00000000-0000-4000-8000-000000000000'), (e) => e.code === 'ENOSESSION');
});

test('HTTP: 토큰 없으면 401, 빌드 전 409, /timeline → /replay/events·snapshot, gzip', async () => {
  for (const p of ['/timeline', '/replay/events', '/replay/snapshot?at=0']) {
    const r = await get(`${base}${p}${p.includes('?') ? '&' : '?'}session=${RIDS.main}`, { accept: 'text/html' });
    assert.equal(r.status, 401, p);
    assert.equal(JSON.parse(r.body).error, 'unauthorized');
  }
  assert.equal((await get(`${base}/replay/events?session=${RIDS.main}`, H)).status, 409);
  assert.equal((await get(`${base}/timeline?session=00000000-0000-4000-8000-000000000000`, H)).status, 404);
  const tl = await J(`${base}/timeline?session=${RIDS.main}&buckets=120`);
  assert.equal(tl.status, 200);
  assert.equal(tl.headers['cache-control'], 'no-store');
  assert.equal(tl.json.buckets.counts.length, 120);
  assert.ok(tl.json.nodes.some((n) => n.kind === 'claude-p'));
  const ev = await J(`${base}/replay/events?session=${RIDS.main}&from=1&limit=5`);
  assert.equal(ev.status, 200);
  assert.equal(ev.json.events.length, 5);
  assert.equal(ev.json.next, 6);
  assert.ok(ev.json.events.every((e) => typeof e.t === 'number' && typeof e.rseq === 'number'));
  const all = await get(`${base}/replay/events?session=${RIDS.main}&limit=5000`, { ...H, 'accept-encoding': 'gzip' });
  const allJ = JSON.parse(all.body);
  assert.equal(allJ.total, tl.json.eventCount);
  if (Buffer.byteLength(all.body) >= 64 * 1024) assert.equal(all.headers['content-encoding'], 'gzip');
  const sn = await J(`${base}/replay/snapshot?session=${RIDS.main}&at=${Date.parse(fx.T(100))}`);
  assert.equal(sn.status, 200);
  assert.ok(sn.json.nodes.some((n) => n.id === 'a:ragent01' && n.status === 'idle'));
  assert.equal(sn.json.seq, sn.json.rseq);
  // 마스킹: 재생 이벤트도 같은 redact 경로(합성 fixture 의 평문 비밀 없음 확인용으로 길이 제한만 검사)
  assert.ok(allJ.events.every((e) => e.text == null || e.text.length <= 600));
  // /sessions 확장
  const s = await J(`${base}/sessions?limit=200&kind=main`);
  assert.ok(Array.isArray(s.json.projects) && s.json.projects.length >= 2);
  assert.ok(s.json.sessions.every((x) => !x.isChild));
  const m = s.json.sessions.find((x) => x.sessionId === RIDS.main);
  assert.equal(m.startedAt, fx.T(0));
  assert.equal(m.endedAt, fx.T(260));
  assert.equal(m.durationMs, 260_000);
  assert.equal(m.replayCached, true);
  assert.equal(m.eventCount, tl.json.eventCount);
  assert.ok(m.eventCountEst >= 1);
  const sAll = await J(`${base}/sessions?limit=200`);
  assert.ok(sAll.json.sessions.some((x) => x.sessionId === RIDS.child && x.isChild));
  const sP = await J(`${base}/sessions?project=${fx.otherProjectDir}`);
  assert.deepEqual(sP.json.sessions.map((x) => x.sessionId), [RIDS.other]);
  assert.equal((await J(`${base}/sessions?limit=1`)).json.sessions.length, 1);
});

test('HTTP: config.project 밖 세션은 재생 API 404, /sessions 질의 project 는 좁히기만', async () => {
  assert.equal((await get(`${pbase}/timeline?session=${RIDS.main}`, H)).status, 404);
  assert.equal((await get(`${pbase}/replay/events?session=${RIDS.main}`, H)).status, 404);
  assert.equal((await get(`${pbase}/replay/snapshot?session=${RIDS.main}&at=0`, H)).status, 404);
  assert.equal((await get(`${pbase}/timeline?session=${RIDS.other}`, H)).status, 200);
  // 라이브 API 도 같은 제한(/state·/events)
  assert.equal((await get(`${pbase}/state?session=${RIDS.main}`, H)).status, 404);
  assert.equal((await get(`${pbase}/events?session=${RIDS.main}`, H)).status, 404);
  assert.equal((await get(`${pbase}/state?session=${RIDS.other}`, H)).status, 200);
  const s = await J(`${pbase}/sessions?project=${fx.projectDir}`);
  assert.deepEqual(s.json.sessions, []);
  const s2 = await J(`${pbase}/sessions?limit=50`);
  assert.ok(s2.json.sessions.every((x) => x.projectDir === fx.otherProjectDir));
  assert.ok(s2.json.projects.every((x) => x.projectDir === fx.otherProjectDir));
});

test('HTTP --demo: demo-replay 세션', async () => {
  const s = await J(`${dbase}/sessions?limit=10`);
  assert.ok(s.json.sessions.some((x) => x.sessionId === 'demo-replay'));
  const tl = await J(`${dbase}/timeline?session=demo-replay`);
  assert.equal(tl.status, 200);
  assert.ok(tl.json.eventCount >= 1000);
  const kinds = new Set(tl.json.nodes.map((n) => n.kind));
  for (const k of ['main', 'subagent', 'claude-p', 'bash-bg', 'monitor']) assert.ok(kinds.has(k), k);
  const ev = await J(`${dbase}/replay/events?session=demo-replay&from=1&limit=2000`);
  assert.equal(ev.json.events.length, Math.min(2000, tl.json.eventCount));
  for (let i = 1; i < ev.json.events.length; i++) assert.ok(ev.json.events[i].t >= ev.json.events[i - 1].t);
  const sn = await J(`${dbase}/replay/snapshot?session=demo-replay&at=${Date.parse(tl.json.endTs)}`);
  assert.equal(sn.json.rseq, tl.json.eventCount);
  // ?replay=auto(→ 라이브 데모 세션)도 데모 재생으로(예전 404)
  const auto = await J(`${dbase}/timeline?session=auto`);
  assert.equal(auto.status, 200);
  assert.equal(auto.json.sessionId, 'demo-replay');
});

test('§14.1-5·7 끝까지 재생한 최종 상태 = 라이브 RootRuntime 상태(status 포함, 끝 구간 대기 합성)', () => {
  const diffs = [];
  for (const n of liveRt.graph.nodes.values()) {
    const r = data.finalState.nodes.get(n.id);
    if (!r) continue; // 라이브가 못 찾는 옛 claude -p 자식은 위 시험에서 따로 확인
    for (const f of ['status', 'kind', 'parentId', 'depth']) {
      if ((r[f] ?? null) !== (n[f] ?? null)) diffs.push(`${n.id}.${f}: replay=${r[f]} live=${n[f]}`);
    }
  }
  assert.deepEqual(diffs, []);
  // 메인은 끝 구간에서 대기로 바뀌고, 그 합성 이벤트는 마지막 기록 + 60초
  const main = `s:${RIDS.main}`;
  assert.equal(data.finalState.nodes.get(main).status, liveRt.graph.get(main).status);
});

test('캐시: 대기열 상한을 넘으면 EBUSY, 바뀐 지문은 있는 빌드를 바로 주고 뒤에서 다시 만든다', async () => {
  const cache = new ReplayCache({ index, max: 2, maxPending: 1, reuseMs: 0 });
  cache.get(RIDS.main, { wait: false });
  await assert.rejects(cache.get(RIDS.other, { wait: false }), (e) => e.code === 'EBUSY');
  const a = await cache.get(RIDS.main);
  // 재사용 간격은 max(reuseMs, 빌드 시간×30) — 부하로 빌드가 2초를 넘으면 60초 전 빌드도 '방금 만든 것'이 되어 stale 이 안 붙었다(간헐 실패).
  // 빌드 시간과 무관하게 재사용 간격을 넘도록 한참 전 빌드로 둔다
  a.fingerprint = 'changed'; a.builtAt = new Date(Date.now() - 24 * 3600_000).toISOString();
  const b = await cache.get(RIDS.main);
  assert.equal(b, a); // 기다리지 않고 기존 빌드
  assert.equal(b.stale, true);
  assert.ok(cache.jobs.has(RIDS.main)); // 뒤에서 다시 만드는 중
  const c = await cache.jobs.get(RIDS.main).promise;
  assert.notEqual(c, a);
  assert.equal(c.stale, false);
});

test('HTTP: /replay/events 같은 페이지는 직렬화 결과를 재사용', async () => {
  await J(`${base}/timeline?session=${RIDS.main}`);
  const u = `${base}/replay/events?session=${RIDS.main}&from=1&limit=50`;
  const [r1, r2] = await Promise.all([get(u, H), get(u, H)]);
  assert.equal(r1.status, 200); assert.equal(r1.body, r2.body);
  assert.equal(JSON.parse(r1.body).events.length, Math.min(50, JSON.parse(r1.body).total));
});
