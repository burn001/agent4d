// 3차: 전체 보기 허브·scope=all 스트림·/projects·/limits HTTP (합성 데이터만)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { makeOverviewFixture, OV, CWD, enc } from './fixtures/overview-build.mjs';
import { createServer, createRealManager } from '../index.mjs';
import { DemoManager } from '../demo.mjs';

const TOKEN = 'test-token-' + 'b'.repeat(32);
const H = { 'x-ccviz-token': TOKEN };
let fx, mgr, hub, server, base, webRoot, demoMgr, demoServer, demoBase;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 10_000, step = 100) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); }
}
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      const c = []; res.on('data', (x) => c.push(x));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c).toString('utf8') }));
    }).on('error', reject);
  });
}
function sse(url, headers = {}, ms = 800) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      setTimeout(() => {
        req.destroy();
        const evs = buf.split('\n\n').filter(Boolean).map((block) => {
          const o = {};
          for (const line of block.split('\n')) {
            const i = line.indexOf(':');
            if (i === 0) { o.comment = line.slice(1).trim(); continue; }
            const k = line.slice(0, i), v = line.slice(i + 1).replace(/^ /, '');
            o[k] = k === 'data' ? JSON.parse(v) : v;
          }
          return o;
        });
        resolve({ status: res.statusCode, headers: res.headers, evs, bytes: buf.length });
      }, ms);
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
}
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

/** 가짜 한도 수집기(실제 파일·네트워크 없음) */
function fakeLimits() {
  const L = { ok: true, source: 'statusline', capturedAt: new Date().toISOString(), ageSec: 0, stale: false,
    five_hour: { pct: 7, resetsAt: new Date(Date.now() + 3600e3).toISOString(), resetsInSec: 3600, source: 'statusline', capturedAt: new Date().toISOString(), expired: false },
    seven_day: null, plan: null };
  const ls = new Set();
  return { viewers: 0, get: async () => L, onChange: (fn) => { ls.add(fn); return () => ls.delete(fn); }, addViewer() { this.viewers++; return () => { this.viewers--; }; }, fire() { for (const f of ls) f(L); } };
}

before(async () => {
  fx = makeOverviewFixture();
  process.env.CCVIZ_CLAUDE_TMP = path.join(fx.root, 'tmp', 'claude');
  mgr = createRealManager({ projectsDir: fx.projects, sessionsDir: fx.sessions,
    hubOptions: { intervalMs: 250, orphanDelayMs: 600, graceMs: 1500, sleepMs: 800, projectsMinMs: 0 } });
  await mgr.index.refresh();
  hub = mgr.overview();
  webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-ovweb-'));
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>t</title>');
  server = createServer({ token: TOKEN, manager: mgr, webRoot, limits: fakeLimits() });
  base = await listen(server);
  demoMgr = new DemoManager({ overviewOptions: { matchEveryMs: 3600_000, hub: { orphanDelayMs: 0, intervalMs: 200, projectsMinMs: 0 } } });
  demoServer = createServer({ token: TOKEN, manager: demoMgr, webRoot, limits: fakeLimits() });
  demoBase = await listen(demoServer);
});

after(() => {
  server?.close(); demoServer?.close(); server?.closeAllConnections?.(); demoServer?.closeAllConnections?.();
  mgr?.stop(); demoMgr?.stop();
  fx?.rm();
  fs.rmSync(webRoot, { recursive: true, force: true });
});

test('허브: 여러 프로젝트 루트를 붙들고 노드마다 projectId·rootSessionId, claude -p 자식은 부모 클러스터', async () => {
  const got = [];
  const unsub = hub.subscribe({ inactive: false, onEvent: (e) => got.push(e), onProjects: () => {} });
  await hub.wake();
  const snap = await waitFor(() => { const s = hub.snapshot(); return s.nodes.some((n) => n.id === `s:${OV.orphan}`) && s.nodes.some((n) => n.id === `s:${OV.child}`) ? s : null; });
  assert.ok(snap, '독립 sdk-cli·claude -p 자식이 나타나야 함');
  assert.equal(snap.scope, 'all');
  assert.equal(snap.root, null);
  for (const n of snap.nodes) assert.ok(n.projectId && n.rootSessionId, n.id);
  const by = new Map(snap.nodes.map((n) => [n.id, n]));
  assert.equal(by.get(`s:${OV.a1}`).projectId, enc(CWD.works));
  assert.deepEqual([by.get(`s:${OV.a1}`).meta.live, by.get(`s:${OV.a1}`).meta.liveStatus, by.get(`s:${OV.a1}`).meta.tier], [true, 'busy', 'live']);
  assert.equal(by.get(`a:agenta1x`).rootSessionId, OV.a1);
  const child = by.get(`s:${OV.child}`);
  assert.equal(child.kind, 'claude-p');
  assert.equal(child.projectId, enc(CWD.works)); // 임시 폴더 cwd 여도 부모 클러스터
  assert.equal(child.rootSessionId, OV.a1);
  const orphan = by.get(`s:${OV.orphan}`);
  assert.equal(orphan.projectId, enc(CWD.appdb));
  assert.equal(orphan.meta.orphanSdk, true);
  assert.ok(by.has(`s:${OV.b1}`) && by.has(`s:${OV.k1}`));
  assert.ok(!by.has(`s:${OV.dead}`) && !by.has(`s:${OV.aOld}`));
  // 노드 id 중복 없음
  assert.equal(new Set(snap.nodes.map((n) => n.id)).size, snap.nodes.length);
  const roots = snap.roots.map((r) => r.sessionId).sort();
  assert.deepEqual(roots, [OV.a1, OV.b1, OV.k1, OV.orphan].sort());
  assert.ok(snap.projects.some((p) => p.projectId === enc(CWD.works) && p.name === 'Projects\\2026'));
  // 허브 이벤트는 자기 seq(hseq): 단조 증가, 노드 사본에도 projectId
  const seqs = got.map((e) => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.ok(got.filter((e) => e.type === 'node-add').every((e) => e.node.projectId && e.node.rootSessionId));
  // 런타임은 RootManager 와 공유, LRU 와 별도로 고정
  assert.ok(mgr.pinned.has(OV.a1) && mgr.pinned.has(OV.orphan));
  unsub();
});

test('독립 sdk-cli 가 나중에 매칭되면 node-remove(독립 서브트리) → node-add(부모 아래) 순서', async () => {
  const got = [];
  const unsub = hub.subscribe({ inactive: false, onEvent: (e) => got.push(e), onProjects: () => {} });
  fx.matchOrphan();
  const ok = await waitFor(() => got.some((e) => e.type === 'node-add' && e.nodeId === `s:${OV.orphan}`), 15_000);
  assert.ok(ok, JSON.stringify(got.map((e) => [e.type, e.nodeId])));
  const iRm = got.findIndex((e) => e.type === 'node-remove' && e.ids.includes(`s:${OV.orphan}`));
  const iAdd = got.findIndex((e) => e.type === 'node-add' && e.nodeId === `s:${OV.orphan}`);
  assert.ok(iRm >= 0 && iRm < iAdd, `remove ${iRm} < add ${iAdd}`);
  const rm = got[iRm];
  assert.equal(rm.subtree, true);
  assert.equal(rm.rootSessionId, OV.orphan);
  const add = got[iAdd];
  assert.equal(add.node.kind, 'claude-p');
  assert.equal(add.node.parentId, `s:${OV.b1}`);
  assert.equal(add.rootSessionId, OV.b1);
  await waitFor(() => !hub.roots.has(OV.orphan));
  const snap = hub.snapshot();
  assert.equal(snap.nodes.filter((n) => n.id === `s:${OV.orphan}`).length, 1);
  assert.ok(!snap.roots.some((r) => r.sessionId === OV.orphan));
  assert.ok(!mgr.pinned.has(OV.orphan));
  unsub();
});

test('live 에서 빠지면 recent 표시 → 유예 뒤 서브트리 node-remove, since 재접속', async () => {
  const got = [];
  const unsub = hub.subscribe({ inactive: false, onEvent: (e) => got.push(e), onProjects: () => {} });
  const since = hub.hseq;
  fs.unlinkSync(path.join(fx.sessions, '105.json'));
  const upd = await waitFor(() => got.find((e) => e.type === 'node-update' && e.nodeId === `s:${OV.k1}` && e.patch?.meta?.live === false), 8000);
  assert.ok(upd);
  assert.equal(upd.patch.meta.tier, 'recent');
  const rm = await waitFor(() => got.find((e) => e.type === 'node-remove' && e.nodeId === `s:${OV.k1}`), 8000);
  assert.ok(rm && rm.ids.includes(`s:${OV.k1}`));
  const evs = hub.eventsSince(since);
  assert.ok(evs && evs.some((e) => e.type === 'node-remove'));
  assert.equal(hub.eventsSince(hub.hseq + 5), null);
  unsub();
});

test('구독자가 없으면 잠들고(루트 unpin) 다음 구독 때 다시 계산', async () => {
  const ok = await waitFor(() => !hub.awake, 5000);
  assert.ok(ok);
  assert.equal(mgr.pinned.size, 0);
  assert.equal(hub.roots.size, 0);
  await hub.wake();
  assert.ok(hub.roots.has(OV.a1));
});

test('HTTP: /projects·/limits·scope=all 은 토큰 없으면 401, scope 없는 기존 응답 그대로', async () => {
  for (const p of ['/projects', '/limits', '/state?scope=all', '/events?scope=all']) {
    const r = await get(`${base}${p}`);
    assert.equal(r.status, 401, p);
    assert.match(r.headers['content-type'], /json/, p);
  }
  const pr = JSON.parse((await get(`${base}/projects`, H)).body);
  assert.ok(pr.generatedAt && pr.projects.some((p) => p.name === 'demo_api'));
  const lim = JSON.parse((await get(`${base}/limits`, H)).body);
  assert.equal(lim.five_hour.pct, 7);
  assert.equal((await get(`${base}/state?scope=project:x`, H)).status, 400);
  const st = JSON.parse((await get(`${base}/state?scope=all`, H)).body);
  assert.equal(st.scope, 'all');
  assert.ok(st.nodes.length >= 4 && st.nodes.every((n) => n.projectId));
  // scope 없는 기존 /state 는 단일 세션 형식(projectId 없음)
  const one = JSON.parse((await get(`${base}/state?session=${OV.a1}`, H)).body);
  assert.equal(one.root, `s:${OV.a1}`);
  assert.ok(!('scope' in one) && one.nodes.every((n) => !('projectId' in n)));
});

test('HTTP SSE scope=all: snapshot(id=hseq) → projects·limits, since 재접속은 snapshot 없이', async () => {
  const r = await sse(`${base}/events?scope=all`, H, 1200);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/event-stream/);
  const snap = r.evs.find((e) => e.event === 'snapshot');
  assert.ok(snap && snap.data.scope === 'all' && Number(snap.id) === snap.data.seq);
  assert.ok(Array.isArray(snap.data.projects) && Array.isArray(snap.data.roots));
  assert.ok(r.evs.some((e) => e.event === 'limits' && e.data.five_hour.pct === 7 && e.id === undefined));
  assert.ok(r.bytes < 1.5 * 1024 * 1024);
  const r2 = await sse(`${base}/events?scope=all&since=${snap.data.seq}`, H, 400);
  assert.ok(!r2.evs.some((e) => e.event === 'snapshot'));
  assert.ok(r2.evs.some((e) => e.event === 'projects'));
  // 단일 세션 SSE 에도 limits 한 번
  const r3 = await sse(`${base}/events?session=${OV.a1}`, H, 500);
  assert.ok(r3.evs.some((e) => e.event === 'snapshot') && r3.evs.some((e) => e.event === 'limits'));
});

test('--demo 전체 보기: 프로젝트 4개(§66 같은 프로젝트 live 메인 3·2·5), 독립 claude -p 매칭 시 remove → add', async () => {
  const pr = JSON.parse((await get(`${demoBase}/projects`, H)).body);
  assert.deepEqual(pr.projects.map((p) => p.projectId), ['demo-alpha', 'demo-beta', 'demo-gamma', 'demo-delta']);
  const dh = demoMgr.overview();
  await dh.wake();
  await waitFor(() => dh.roots.size >= 11, 3000);
  const st = JSON.parse((await get(`${demoBase}/state?scope=all`, H)).body);
  const roots = st.roots.map((r) => r.projectId);
  assert.equal(roots.filter((x) => x === 'demo-alpha').length, 3);
  assert.equal(roots.filter((x) => x === 'demo-beta').length, 3); // 메인 2 + 독립 claude -p
  assert.equal(roots.filter((x) => x === 'demo-delta').length, 5);
  assert.ok(Array.isArray(st.conflicts));
  assert.ok(!roots.includes('demo-gamma')); // recent 는 기본 장면에 없음
  const kinds = new Set(st.nodes.map((n) => n.kind));
  for (const k of ['main', 'subagent', 'workflow', 'workflow-agent', 'claude-p', 'bash-bg', 'monitor']) assert.ok(kinds.has(k), k);
  assert.equal(new Set(st.nodes.map((n) => n.id)).size, st.nodes.length);
  const inact = JSON.parse((await get(`${demoBase}/state?scope=all&inactive=1`, H)).body);
  assert.ok(Array.isArray(inact.roots));
  const got = [];
  const unsub = dh.subscribe({ inactive: false, onEvent: (e) => got.push(e), onProjects: () => {} });
  const osid = demoMgr.ov.orphan;
  demoMgr.ov.matchNow();
  const iRm = got.findIndex((e) => e.type === 'node-remove' && e.ids.includes(`s:${osid}`));
  const iAdd = got.findIndex((e) => e.type === 'node-add' && e.nodeId === `s:${osid}`);
  assert.ok(iRm >= 0 && iRm < iAdd, JSON.stringify(got.map((e) => [e.type, e.nodeId])));
  assert.equal(got[iAdd].node.kind, 'claude-p');
  unsub();
  // 데모 단일 세션은 1·2차 그대로
  const s1 = JSON.parse((await get(`${demoBase}/state`, H)).body);
  assert.equal(s1.root, 's:00000000-0000-4000-8000-00000000demo');
  const lim = JSON.parse((await get(`${demoBase}/limits`, H)).body);
  assert.ok(lim.five_hour);
});
