// 화면 원격 조작: 관리자 판정(루프백·프록시 표지·브라우저·Bearer), 릴레이 경유 거부(실제 bin/relay.mjs), Worker 미프록시,
// 화면 등록(데이터 SSE·명령 전용 SSE)·명령 전달·ack 수집·시간 초과·끊김·화면 없음·--client·이름 해석, CLI(bin/ctl.mjs)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../index.mjs';
import { DemoManager } from '../demo.mjs';
import { checkLocalAdmin, isLoopbackAddr, proxyMarkers, remoteOf } from '../control.mjs';
import { main as ctlMain, pickPort } from '../../bin/ctl.mjs';
import worker from '../../cloudflare/src/worker.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = 'view-token-' + 'v'.repeat(32);
const ADMIN = 'admin-secret-' + 's'.repeat(32);
let server, base, port, mgr, relay, relayBase, webRoot;

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

function req(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const r = http.request(url, { method, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json, text }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const admin = (extra = {}) => ({ Authorization: `Bearer ${ADMIN}`, ...extra });
const view = { Cookie: `ccviz_t=${TOKEN}` }; // 브라우저처럼 쿠키(X-CCVIZ-Token 헤더는 Worker 가 붙이는 원격 표지)

/** SSE 를 열고 이벤트마다 onEvent({event, data}). close() 로 닫음 */
function openSse(url, headers, onEvent) {
  return new Promise((resolve, reject) => {
    const r = http.get(url, { headers }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const o = {};
          for (const line of block.split('\n')) { const j = line.indexOf(':'); if (j <= 0) continue; const k = line.slice(0, j), v = line.slice(j + 1).replace(/^ /, ''); o[k] = k === 'data' ? JSON.parse(v) : v; }
          if (o.event) onEvent(o);
        }
      });
      res.on('error', () => {});
      resolve({ status: res.statusCode, close: () => r.destroy() });
    });
    r.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
}
/** 화면 흉내: 등록 → control 이 오면 reply(msg) 결과로 ack */
async function fakeScreen(id, { name = 'Test screen', path: p = '/events?scope=all', reply = () => ({ ok: true }), baseUrl = base, headers = view } = {}) {
  const got = [];
  let hello = null;
  const sse = await openSse(`${baseUrl}${p}${p.includes('?') ? '&' : '?'}client=${id}&cname=${encodeURIComponent(name)}`, headers, async (e) => {
    if (e.event === 'ctl-hello') hello = e.data;
    if (e.event === 'control') {
      got.push(e.data);
      const r = reply(e.data);
      if (r) await req('POST', `${base}/control/ack`, { headers: view, body: { client: id, cmdId: e.data.id, state: { view: 'flow', theme: e.data.args.value || 'auto' }, ...r } });
    }
  });
  await waitFor(() => hello);
  return { got, sse, get hello() { return hello; } };
}
async function waitFor(fn, ms = 3000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); } }

before(async () => {
  webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a4d-ctl-web-'));
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>t</title>');
  mgr = new DemoManager();
  server = createServer({ token: TOKEN, manager: mgr, webRoot, adminSecret: ADMIN });
  port = await listen(server);
  base = `http://127.0.0.1:${port}`;
  // 실제 릴레이(bin/relay.mjs)를 띄운다: 터널(cloudflared)은 이 릴레이에 붙으므로 원격 경로 = 릴레이 경유
  const probe = http.createServer();
  const rp = await listen(probe);
  await new Promise((r) => probe.close(r));
  relay = spawn(process.execPath, [path.join(HERE, '..', '..', 'bin', 'relay.mjs'), '--listen', String(rp), '--target', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { let out = ''; relay.stdout.on('data', (c) => { out += c; if (out.includes('CCVIZ_RELAY_READY')) resolve(); }); relay.on('exit', () => reject(new Error('relay exited'))); });
  relayBase = `http://127.0.0.1:${rp}`;
});
after(() => { try { relay.kill(); } catch {} server.close(); try { server.closeAllConnections(); } catch {} mgr.stop?.(); });

// ───────── 관리자 판정(순수) ─────────
const fakeReq = (headers = {}, addr = '127.0.0.1') => ({ headers: { host: '127.0.0.1:7788', ...headers }, socket: { remoteAddress: addr } });
test('관리자 판정: 루프백 + Bearer 만 통과', () => {
  assert.equal(checkLocalAdmin(fakeReq({ authorization: `Bearer ${ADMIN}` }), ADMIN).ok, true);
  assert.equal(checkLocalAdmin(fakeReq({ authorization: `Bearer ${ADMIN}` }, '::ffff:127.0.0.1'), ADMIN).ok, true);
  assert.deepEqual(checkLocalAdmin(fakeReq({}), ADMIN), { ok: false, status: 401, reason: 'unauthorized' });
  assert.equal(checkLocalAdmin(fakeReq({ authorization: 'Bearer nope' }), ADMIN).status, 401);
  assert.equal(checkLocalAdmin(fakeReq({ authorization: `Bearer ${TOKEN}` }), ADMIN).status, 401, '보기 토큰으로는 못 보냄');
  assert.equal(checkLocalAdmin(fakeReq({ authorization: `Bearer ${ADMIN}` }), null).status, 503);
});
test('관리자 판정: 원격 주소·Host·프록시 표지·브라우저 표지는 거부', () => {
  const ok = { authorization: `Bearer ${ADMIN}` };
  assert.equal(checkLocalAdmin(fakeReq(ok, '192.168.0.5'), ADMIN).reason, 'not_loopback');
  assert.equal(checkLocalAdmin(fakeReq({ ...ok, host: 'evil.example:7788' }), ADMIN).reason, 'bad_host');
  for (const h of ['x-agent4d-relay', 'cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'forwarded', 'cdn-loop', 'x-ccviz-token']) {
    const r = checkLocalAdmin(fakeReq({ ...ok, [h]: '1' }), ADMIN);
    assert.deepEqual([r.ok, r.status, r.reason], [false, 404, 'proxied'], h);
  }
  assert.equal(checkLocalAdmin(fakeReq({ ...ok, origin: 'http://127.0.0.1:7788' }), ADMIN).reason, 'browser');
  assert.equal(checkLocalAdmin(fakeReq({ ...ok, 'sec-fetch-site': 'same-origin' }), ADMIN).reason, 'browser');
  assert.equal(isLoopbackAddr('127.0.0.2'), true);
  assert.equal(isLoopbackAddr('10.0.0.1'), false);
  assert.deepEqual(proxyMarkers(fakeReq({ 'cf-ray': 'x', 'x-forwarded-for': '1.2.3.4' })), ['cf-ray', 'x-forwarded-for']);
  assert.equal(remoteOf(fakeReq({})), false);
  assert.equal(remoteOf(fakeReq({ 'x-agent4d-relay': '1' })), true);
});

// ───────── HTTP: 인증·경유 ─────────
test('POST /control: 비밀 없음 401 · 프록시 표지 404 · 브라우저 403 · 보기 토큰만으로 401', async () => {
  const body = { cmd: 'theme', args: { value: 'light' } };
  assert.equal((await req('POST', `${base}/control`, { body })).status, 401);
  assert.equal((await req('POST', `${base}/control`, { body, headers: view })).status, 401);
  assert.equal((await req('POST', `${base}/control`, { body, headers: admin({ 'X-CCVIZ-Token': TOKEN }) })).status, 404, 'Worker 가 붙이는 토큰 헤더 = 원격 표지');
  assert.equal((await req('POST', `${base}/control`, { body, headers: admin({ 'X-Forwarded-For': '203.0.113.9' }) })).status, 404);
  assert.equal((await req('POST', `${base}/control`, { body, headers: admin({ 'Cf-Connecting-Ip': '203.0.113.9' }) })).status, 404);
  assert.equal((await req('POST', `${base}/control`, { body, headers: admin({ 'X-Agent4D-Relay': '1' }) })).status, 404);
  assert.equal((await req('POST', `${base}/control`, { body, headers: admin({ Origin: base }) })).status, 403);
  assert.equal((await req('GET', `${base}/control/clients`, { headers: view })).status, 401);
});
test('릴레이 경유: /control·/control/clients 는 올바른 비밀이어도 404(릴레이에서 끊김 + 서버도 표지로 거부)', async () => {
  const body = { cmd: 'theme', args: { value: 'light' } };
  for (const p of ['/control', '/control/', '/CONTROL', '/%63ontrol', '/control/clients', '/control/clients/']) {
    const r = await req(p.startsWith('/control/c') ? 'GET' : 'POST', relayBase + p, { body: p.startsWith('/control/c') ? null : body, headers: admin() });
    assert.ok(r.status === 404 || r.status === 401, `${p} → ${r.status}`);
    assert.notEqual(r.status, 200, p);
  }
  // 릴레이가 경로 검사를 못 하는 변형이라도 서버가 x-agent4d-relay 표지로 거부한다는 것: 같은 요청을 표지만 붙여 직접
  assert.equal((await req('POST', `${base}/control`, { body, headers: admin({ 'X-Agent4D-Relay': '1' }) })).status, 404);
  // 릴레이를 거친 일반 요청에는 표지가 붙는다(원격 화면으로 표시)
  const s = await fakeScreen('relayscr-01', { baseUrl: relayBase });
  assert.equal(s.hello.remote, true, '릴레이 경유 화면은 원격');
  s.sse.close();
});
test('Worker: /control 관리 경로는 프록시하지 않음(404), 화면용 /control/events·/control/ack 는 토큰 검사로', async () => {
  // Node 에는 Workers 전용 crypto.subtle.timingSafeEqual 이 없다 → 시험용 대체
  if (!crypto.subtle.timingSafeEqual) crypto.subtle.timingSafeEqual = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
  const env = { VIEW_TOKEN: TOKEN, ADMIN_SECRET: ADMIN, CCVIZ: { get: async () => null } };
  const W = (p, init = {}) => worker.fetch(new Request('https://a4d.example.workers.dev' + p, init), env);
  for (const p of ['/control', '/control/', '/Control', '/control/clients', '/control/anything', '/%63ontrol']) {
    const r = await W(p, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}`, Cookie: `ccviz_t=${TOKEN}` }, body: '{}' });
    assert.equal(r.status, 404, p);
  }
  assert.equal((await W('/control/events')).status, 401, '토큰 없음 → 401(프록시 대상)');
  assert.equal((await W('/control/events', { headers: { Cookie: `ccviz_t=${TOKEN}` } })).status, 503, '토큰 있음 → origin 으로(테스트엔 origin 없음)');
  assert.equal((await W('/controls')).status, 401, '비슷한 이름은 관리 경로 아님');
});

// ───────── 전달·ack ─────────
test('화면 없음: no_clients', async () => {
  const r = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'theme', args: { value: 'light' } } });
  assert.equal(r.status, 200);
  assert.equal(r.json.error, 'no_clients');
  assert.equal(r.json.sent, 0);
});
test('잘못된 명령·값은 보내지 않음', async () => {
  const s = await fakeScreen('badcmd-01');
  const a = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'explode', args: {} } });
  assert.equal(a.json.error, 'unknown_command');
  const b = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'theme', args: { value: 'pink' } } });
  assert.equal(b.json.error, 'bad_value');
  assert.equal(s.got.length, 0);
  s.sse.close();
});
test('데이터 SSE(scope=all)로 등록 → 명령 전달 → ack 수집, 목록·상태', async () => {
  const s1 = await fakeScreen('scrA-0001', { name: 'Edge · Windows · 1920×1080' });
  const s2 = await fakeScreen('scrB-0002', { name: 'Chrome · macOS', path: '/events?session=auto', reply: () => ({ ok: true, pendingGesture: true }) });
  assert.equal(s1.hello.id, 'scrA-0001');
  assert.equal(s1.hello.remote, false);
  const r = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'theme', args: { value: 'light' } } });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.sent, 2);
  assert.equal(r.json.applied, 2);
  assert.deepEqual(s1.got.map((m) => [m.cmd, m.args.value, m.temp]), [['theme', 'light', false]]);
  assert.equal(r.json.results.find((x) => x.client === 'scrB-0002').pendingGesture, true);
  const L = await req('GET', `${base}/control/clients`, { headers: admin() });
  assert.equal(L.status, 200);
  const a = L.json.clients.find((c) => c.id === 'scrA-0001');
  assert.equal(a.name, 'Edge · Windows · 1920×1080');
  assert.equal(a.state.theme, 'light', 'ack 가 알려 준 상태');
  // --client: 이름 부분일치로 하나만
  const one = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'view', args: { value: 'voxel' }, client: 'macos', temp: true } });
  assert.equal(one.json.sent, 1);
  assert.equal(s2.got.at(-1).temp, true);
  assert.equal(s1.got.length, 1);
  const none = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'view', args: { value: 'voxel' }, client: 'zzz' } });
  assert.equal(none.json.error, 'no_match');
  s1.sse.close(); s2.sse.close();
  await waitFor(async () => true);
});
test('실패 ack·시간 초과·끊김', async () => {
  const s1 = await fakeScreen('fail-0001', { reply: () => ({ ok: false, error: 'remote_off' }) });
  const s2 = await fakeScreen('mute-0002', { reply: () => null }); // 답 없음
  const r = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'pause', args: {}, wait: 400 } });
  assert.equal(r.json.ok, false);
  assert.equal(r.json.results.find((x) => x.client === 'fail-0001').error, 'remote_off');
  assert.equal(r.json.results.find((x) => x.client === 'mute-0002').error, 'timeout');
  // 기다리는 중 끊기면 disconnected
  const p = req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'pause', args: {}, wait: 5000 } });
  await waitFor(() => s2.got.length === 2);
  s2.sse.close();
  s1.sse.close();
  const r2 = await p;
  assert.equal(r2.json.results.find((x) => x.client === 'mute-0002').error, 'disconnected');
  await waitFor(() => !server.control.clients.has('mute-0002'));
  // 끊긴 뒤엔 없음 → 재연결 때 재생하지 않음
  const r3 = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'pause', args: {} } });
  assert.equal(r3.json.error, 'no_clients');
});
test('명령 전용 SSE(/control/events, 재생 중 화면) · ack 는 보기 토큰 필요', async () => {
  assert.equal((await req('GET', `${base}/control/events?client=x`)).status, 401);
  const s = await fakeScreen('replay-0001', { path: '/control/events' });
  const r = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'live', args: {} } });
  assert.equal(r.json.applied, 1);
  assert.equal((await req('POST', `${base}/control/ack`, { body: { client: 'replay-0001' } })).status, 401);
  assert.equal((await req('POST', `${base}/control/ack`, { headers: view, body: { client: 'nobody-01' } })).status, 404);
  s.sse.close();
});
test('이름 해석: project:alpha → demo-alpha, 모호하면 후보, session 앞부분', async () => {
  const s = await fakeScreen('scope-0001');
  const r = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'scope', args: { value: 'project:alpha' } } });
  assert.equal(r.json.ok, true);
  assert.deepEqual(s.got.at(-1).args, { scope: 'project', projectId: 'demo-alpha', name: 'alpha' });
  const amb = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'scope', args: { value: 'project:demo' } } });
  assert.equal(amb.json.error, 'ambiguous');
  assert.ok(amb.json.candidates.length >= 4);
  const nf = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'scope', args: { value: 'project:zeta' } } });
  assert.equal(nf.json.error, 'not_found');
  const sa = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'scope', args: { value: 'session:bbbbbbbb' } } });
  assert.equal(sa.json.error, 'ambiguous', 'b001·b002 둘 다 앞부분이 같음');
  const ss = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'scope', args: { value: 'session:보고서' } } });
  assert.equal(ss.json.ok, true, '제목 부분일치');
  assert.equal(s.got.at(-1).args.sessionId, 'bbbbbbbb-0000-4000-8000-00000000b001');
  const vis = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'visible', args: { action: 'only', target: 'project:beta' } } });
  assert.deepEqual(s.got.at(-1).args, { action: 'only', projectId: 'demo-beta', name: 'beta' });
  assert.equal(vis.json.ok, true);
  const all = await req('POST', `${base}/control`, { headers: admin(), body: { cmd: 'scope', args: { value: 'all' } } });
  assert.deepEqual(s.got.at(-1).args, { scope: 'all' });
  assert.equal(all.json.ok, true);
  s.sse.close();
});

// ───────── CLI ─────────
test('CLI ctl: 화면 없음 알림·적용 결과·clients·포트 고르기', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'a4d-ctl-home-'));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ adminSecret: ADMIN, viewToken: TOKEN, port: 1 }));
  const run = async (argv) => { const out = [], err = []; const code = await ctlMain(argv, { home, log: (s) => out.push(s), warn: (s) => err.push(s) }); return { code, out: out.join('\n'), err: err.join('\n') }; };
  process.env.CCVIZ_LANG = 'en';
  await waitFor(() => server.control.clients.size === 0); // 앞 시험 화면이 다 끊길 때까지
  const a = await run(['theme', 'light', '--port', String(port)]);
  assert.equal(a.code, 1);
  assert.match(a.err, /No viewer is open/);
  const s = await fakeScreen('cli-00001', { name: 'CLI screen', reply: (m) => ({ ok: true, pendingGesture: m.cmd === 'sound' ? true : undefined }) });
  const b = await run(['sound', 'on', '--port', String(port)]);
  assert.equal(b.code, 0);
  assert.match(b.out, /Applied: 1\/1 viewer\(s\) · sound/);
  assert.match(b.out, /needs one click/);
  const c = await run(['clients', '--port', String(port)]);
  assert.match(c.out, /cli-00001 {2}CLI screen {2}\[local\]/);
  const d = await run(['theme', 'pink', '--port', String(port)]);
  assert.equal(d.code, 2);
  const e = await run(['scope', 'project:demo', '--port', String(port)]);
  assert.equal(e.code, 1);
  assert.match(e.err, /More than one match/);
  const f = await run(['theme', 'dark', '--port', '1']);
  assert.match(f.err, /not responding/);
  s.sse.close();
  delete process.env.CCVIZ_LANG;
  assert.equal(pickPort({ port: '7900' }, { port: 7788 }, { port: 7791, serverPid: 1 }), 7900);
  assert.equal(pickPort({}, { port: 7788 }, { port: 7791, serverPid: 1 }), 7791);
  assert.equal(pickPort({}, { port: 7788 }, {}), 7788);
});
