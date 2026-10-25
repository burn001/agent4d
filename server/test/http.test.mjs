import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { makeFixture, rmFixture, IDS } from './fixtures/build.mjs';
import { createServer, createRealManager } from '../index.mjs';
import { DemoManager } from '../demo.mjs';
import { prefersKo } from '../auth.mjs';

const TOKEN = 'test-token-' + 'a'.repeat(32);
let fx, server, base, mgr, webRoot, demoServer, demoBase, demoMgr;

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
  });
}

/** SSE 를 ms 동안 받아 이벤트 배열로 */
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
        resolve({ status: res.statusCode, headers: res.headers, evs });
      }, ms);
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
}

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

before(async () => {
  fx = makeFixture();
  process.env.CCVIZ_CLAUDE_TMP = fx.tmpClaude;
  webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-web-'));
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>t</title>');
  fs.mkdirSync(path.join(webRoot, 'assets'));
  fs.writeFileSync(path.join(webRoot, 'assets', 'bgm.mp3'), Buffer.alloc(1000, 7));
  fs.writeFileSync(path.join(path.dirname(webRoot), 'ccviz-secret.txt'), 'secret');
  mgr = createRealManager({ projectsDir: fx.projects, sessionsDir: fx.sessions });
  await mgr.index.refresh();
  server = createServer({ token: TOKEN, manager: mgr, webRoot });
  base = await listen(server);
  demoMgr = new DemoManager();
  demoServer = createServer({ token: TOKEN, manager: demoMgr, webRoot });
  demoBase = await listen(demoServer);
});

after(() => {
  server?.close(); demoServer?.close(); mgr?.stop(); demoMgr?.stop();
  server?.closeAllConnections?.(); demoServer?.closeAllConnections?.();
  rmFixture(fx);
  fs.rmSync(webRoot, { recursive: true, force: true });
});

const H = { 'x-ccviz-token': TOKEN };

test('/healthz 인증 없음', async () => {
  const r = await get(`${base}/healthz`);
  assert.equal(r.status, 200);
  const { version } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(JSON.parse(r.body), { ok: true, version }); // 근거는 package.json 하나
});

test('토큰 없으면 401 (HTML/JSON)', async () => {
  const a = await get(`${base}/`, { 'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8' });
  assert.equal(a.status, 401);
  assert.match(a.body, /토큰이 필요합니다/);
  const e = await get(`${base}/`, { 'accept-language': 'en-US,en;q=0.9,ko;q=0.8' });
  assert.equal(e.status, 401);
  assert.match(e.body, /Access token required/); // 기본 영어, ko 가 맨 앞일 때만 한국어
  assert.match((await get(`${base}/`)).body, /lang="en"/);
  const b = await get(`${base}/state`);
  assert.equal(b.status, 401);
  assert.deepEqual(JSON.parse(b.body), { error: 'unauthorized' });
  assert.equal((await get(`${base}/events`)).status, 401);
  assert.equal((await get(`${base}/sessions?t=nope`)).status, 401);
});

test('?t → 쿠키 + 302, 쿠키로 접근', async () => {
  const r = await get(`${base}/?t=${TOKEN}&session=auto`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/?session=auto');
  const ck = r.headers['set-cookie'][0];
  assert.match(ck, /^ccviz_t=.+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/);
  const ok = await get(`${base}/`, { cookie: ck.split(';')[0] });
  assert.equal(ok.status, 200);
  assert.match(ok.body, /<title>t<\/title>/);
});

test('정적: Range 206, traversal 차단', async () => {
  const r = await get(`${base}/assets/bgm.mp3`, { ...H, range: 'bytes=10-19' });
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], 'bytes 10-19/1000');
  assert.equal(r.headers['content-type'], 'audio/mpeg');
  assert.equal(r.body.length, 10);
  const t = await get(`${base}/..%2fccviz-secret.txt`, H);
  assert.ok(t.status === 403 || t.status === 404, String(t.status));
  assert.ok(!t.body.includes('secret'));
  assert.equal((await get(`${base}/nope.js`, H)).status, 404);
  assert.equal((await get(`${base}/nope.js`, H)).body, 'Not found');
  assert.equal((await get(`${base}/nope.js`, { ...H, 'accept-language': 'ko' })).body, '찾을 수 없습니다');
});

test('정적: ETag·Last-Modified 조건부 요청이면 304(본문 없음), 바뀌면 200', async () => {
  const a = await get(`${base}/assets/bgm.mp3`, H);
  assert.equal(a.status, 200);
  assert.ok(a.headers.etag && a.headers['last-modified']);
  const b = await get(`${base}/assets/bgm.mp3`, { ...H, 'if-none-match': a.headers.etag });
  assert.equal(b.status, 304);
  assert.equal(b.body.length, 0);
  const c = await get(`${base}/assets/bgm.mp3`, { ...H, 'if-modified-since': a.headers['last-modified'] });
  assert.equal(c.status, 304);
  const d = await get(`${base}/assets/bgm.mp3`, { ...H, 'if-none-match': 'W/"other"' });
  assert.equal(d.status, 200);
  assert.equal(d.body.length, a.body.length);
});

test('/sessions·/state', async () => {
  const s = JSON.parse((await get(`${base}/sessions`, H)).body);
  assert.equal(s.auto, IDS.main);
  assert.ok(s.sessions.length >= 2 && s.sessions.length <= 30);
  const st = JSON.parse((await get(`${base}/state?session=auto`, H)).body);
  assert.equal(st.root, `s:${IDS.main}`);
  assert.equal(st.sessionId, IDS.main);
  assert.ok(st.nodes.length > 10);
  assert.ok(st.recent.length <= 300);
  assert.ok(Number.isInteger(st.seq));
  assert.equal((await get(`${base}/state?session=99999999-9999-4999-8999-999999999999`, H)).status, 404);
});

test('/events SSE: snapshot → ev, since 재접속', async () => {
  // 붙인 줄은 500ms 폴링으로 읽힌다. 900ms 창은 부하가 크면(시험 파일 동시 실행) 폴링 한두 번이 밀려 ev 를 놓쳤다 → 2초 창
  const p = sse(`${base}/events?session=auto`, H, 2000);
  setTimeout(() => {
    fs.appendFileSync(fx.mainFile, JSON.stringify(fx.A(IDS.main, 80, { type: 'text', text: 'SSE 실시간' })) + '\n');
  }, 200);
  const r = await p;
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/event-stream/);
  assert.equal(r.headers['x-accel-buffering'], 'no');
  assert.equal(r.evs[0].retry, '3000');
  const snap = r.evs.find((e) => e.event === 'snapshot');
  assert.ok(snap && snap.data.root === `s:${IDS.main}`);
  const ev = r.evs.find((e) => e.event === 'ev' && e.data.type === 'text' && e.data.text === 'SSE 실시간');
  assert.ok(ev, JSON.stringify(r.evs.map((e) => e.event)));
  assert.equal(Number(ev.id), ev.data.seq);
  // since: 링 안이면 snapshot 없이 ev 만
  const sinceSeq = snap.data.seq;
  const r2 = await sse(`${base}/events?session=${IDS.main}&since=${sinceSeq}`, H, 300);
  assert.ok(!r2.evs.some((e) => e.event === 'snapshot'));
  assert.ok(r2.evs.some((e) => e.event === 'ev' && e.data.text === 'SSE 실시간'));
  // Last-Event-ID 헤더도 since 로
  const r3 = await sse(`${base}/events?session=${IDS.main}`, { ...H, 'last-event-id': String(ev.data.seq) }, 300);
  assert.ok(!r3.evs.some((e) => e.event === 'snapshot'));
  // 링 밖이면 snapshot
  const r4 = await sse(`${base}/events?session=${IDS.main}&since=1`, H, 300);
  assert.ok(r4.evs.some((e) => e.event === 'snapshot'));
});

test('--demo: 모든 kind 와 이벤트 형식', async () => {
  const st = JSON.parse((await get(`${demoBase}/state`, H)).body);
  const kinds = new Set(st.nodes.map((n) => n.kind));
  for (const k of ['main', 'subagent', 'workflow', 'workflow-agent', 'claude-p', 'bash-bg', 'monitor']) assert.ok(kinds.has(k), k);
  const s = JSON.parse((await get(`${demoBase}/sessions`, H)).body);
  assert.equal(s.sessions.length, 1);
  const r = await sse(`${demoBase}/events`, H, 300);
  assert.ok(r.evs.some((e) => e.event === 'snapshot'));
});

test('Accept-Language: ko 가 가장 앞설 때만 한국어(§86)', () => {
  assert.equal(prefersKo('ko-KR,ko;q=0.9,en;q=0.8'), true);
  assert.equal(prefersKo('en-US,en;q=0.9,ko;q=0.8'), false);
  assert.equal(prefersKo('en;q=0.5,ko;q=0.9'), true);
  assert.equal(prefersKo(''), false);
  assert.equal(prefersKo(undefined), false);
});
