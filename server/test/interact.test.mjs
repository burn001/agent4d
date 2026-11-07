// Interactive 패널: 별칭(조합 수·고정·영구 저장), 상태 파일 원자적 쓰기(Windows rename 재시도), 기기 서명(시각·nonce·위조),
// 교차 세션 전달 규약(정규 주소·열쇠 파일·두 줄 꼴 — 실제 로컬 파이프/소켓으로), transcript 응답 읽기, HTTP 흐름(꺼짐·등록·승인·보냄·감사),
// 관리 경로(로컬 관리자만), CLI(bin/interact.mjs 별칭 지정)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from '../index.mjs';
import { DemoManager } from '../demo.mjs';
import { ADJ, NOUN1, NOUN2, ALIAS_SPACE, aliasOf, pickAlias, aliasKey } from '../interact-alias.mjs';
import { InteractStore, writeAtomic, deviceIdOf, PENDING_MAX } from '../interact-store.mjs';
import { InteractHub, adminOp, signingString, sha256hex, TS_SKEW_MS } from '../interact.mjs';
import { canonicalAddr, keyHash, buildWire, wrapBody, sendToSession, readFeed, feedItem, listPeerSessions, fromNameOf, withNotice, stripNotice, NOTICE_EN, PeerError, markHeadless } from '../interact-peer.mjs';
import { main as ixMain } from '../../bin/interact.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'a4d-ix-'));
const TOKEN = 'view-token-' + 'v'.repeat(32);
const ADMIN = 'admin-secret-' + 's'.repeat(32);

function newDevice() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = publicKey.export({ format: 'jwk' });
  const jwk = { kty: 'EC', crv: 'P-256', x: j.x, y: j.y };
  return { privateKey, jwk, id: deviceIdOf(jwk) };
}
function signHeaders(dev, pathname, raw, { ts = Date.now(), nonce = crypto.randomBytes(16).toString('base64url') } = {}) {
  const sig = crypto.sign('sha256', Buffer.from(signingString('POST', pathname, ts, nonce, sha256hex(Buffer.from(raw)))), { key: dev.privateKey, dsaEncoding: 'ieee-p1363' });
  return { 'x-a4d-device': dev.id, 'x-a4d-ts': String(ts), 'x-a4d-nonce': nonce, 'x-a4d-sig': sig.toString('base64url') };
}

test('별칭: 세 목록 한·영 짝(영어는 소문자 낱말), 낱말 겹침 없음, 조합 5만 넘음, 꼴(형용사+명사+의+명사 / a-b-c)', () => {
  for (const L of [ADJ, NOUN1, NOUN2]) {
    for (const [ko, en] of L) { assert.ok(ko && en, '짝'); assert.match(en, /^[a-z]+$/, en); }
    assert.equal(new Set(L.map((x) => x[0])).size, L.length, '한글 겹침');
    assert.equal(new Set(L.map((x) => x[1])).size, L.length, '영어 겹침');
  }
  assert.ok(ALIAS_SPACE >= 50_000, `조합 ${ALIAS_SPACE}`);
  assert.deepEqual(aliasOf([0, 0, 0]), { ko: '푸른하늘의고양이', en: 'blue-sky-cat' });
  assert.equal(aliasOf([999, 0, 0]), null);
  // 충돌하면 다시 뽑기: 처음 두 번은 이미 쓰는 번호를 내는 난수
  const seq = [0, 0, 0, 0, 0, 0, 1, 2, 3];
  const al = pickAlias(new Set(['0.0.0', aliasOf([0, 0, 0]).ko]), () => seq.shift() ?? 0);
  assert.deepEqual(al.ix, [1, 2, 3]);
  assert.equal(aliasKey('Blue-Sky-Cat'), aliasKey('blue sky cat'));
});

test('상태 저장: 등록 → 승인 대기·별칭 고정, 재시작(새 인스턴스) 뒤 같은 기기 같은 별칭, 찾기(한·영 별칭·id 앞부분)', () => {
  const home = tmp();
  const s1 = new InteractStore({ home });
  assert.equal(s1.enabled(), false, '기본 꺼짐');
  const d = newDevice();
  const r1 = s1.register(d.jwk, { remote: true, ua: 'x' });
  assert.equal(r1.created, true);
  assert.equal(r1.client.status, 'pending');
  assert.ok(r1.client.alias.ko.includes('의'));
  const r2 = s1.register(d.jwk);
  assert.equal(r2.created, false);
  assert.equal(r2.client.alias.en, r1.client.alias.en);
  const s2 = new InteractStore({ home }); // 서버 재시작
  assert.equal(s2.get(d.id).alias.en, r1.client.alias.en, '재시작 뒤 같은 별칭');
  assert.equal(s2.register(d.jwk).client.alias.ko, r1.client.alias.ko);
  const j = JSON.parse(fs.readFileSync(path.join(home, 'interact', 'clients.json'), 'utf8'));
  assert.equal(j.clients[0].id, d.id); assert.ok(j.clients[0].jwk && j.clients[0].createdAt && j.clients[0].lastSeen);
  assert.equal(s2.find(r1.client.alias.ko).hit.id, d.id);
  assert.equal(s2.find(r1.client.alias.en.replace(/-/g, ' ').toUpperCase()).hit.id, d.id);
  assert.equal(s2.find(d.id.slice(0, 6)).hit.id, d.id);
  assert.ok(s2.find('없는별칭').none);
  // 승인 대기 상한
  for (let i = 0; i < PENDING_MAX + 3; i++) s2.register(newDevice().jwk);
  assert.ok(s2.clients().filter((c) => c.status === 'pending').length <= PENDING_MAX);
  assert.equal(deviceIdOf({ kty: 'EC', crv: 'P-384', x: 'a', y: 'b' }), null);
});

test('원자적 쓰기: Windows 잠금(EPERM·EBUSY)은 재시도, 끝내 실패하면 throw·임시 파일 지움', () => {
  const dir = tmp();
  const f = path.join(dir, 'x.json');
  let n = 0;
  writeAtomic(f, '{"a":1}', { renameSync: (a, b) => { if (n++ < 2) throw Object.assign(new Error('locked'), { code: n === 1 ? 'EPERM' : 'EBUSY' }); fs.renameSync(a, b); } });
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":1}');
  assert.equal(n, 3);
  assert.throws(() => writeAtomic(f, '{"a":2}', { tries: 3, renameSync: () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); } }), /locked/);
  assert.deepEqual(fs.readdirSync(dir).filter((x) => x.endsWith('.tmp')), [], '임시 파일 남지 않음');
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":1}', '실패하면 예전 내용 그대로');
});

test('서명 확인: 맞는 서명 통과, 위조·다른 경로·오래된 시각·nonce 재사용·모르는 기기 거부', () => {
  const store = new InteractStore({ home: tmp() });
  const hub = new InteractHub({ store });
  const d = newDevice();
  store.register(d.jwk);
  const raw = '{"a":1}';
  const reqOf = (h) => ({ headers: h });
  const h = signHeaders(d, '/interact/feed', raw);
  assert.deepEqual(hub.verify(reqOf(h), '/interact/feed', Buffer.from(raw)), { ok: true, id: d.id });
  assert.equal(hub.verify(reqOf(h), '/interact/feed', Buffer.from(raw)).error, 'replay');
  assert.equal(hub.verify(reqOf(signHeaders(d, '/interact/feed', raw)), '/interact/send', Buffer.from(raw)).error, 'bad_sig', '다른 경로');
  assert.equal(hub.verify(reqOf(signHeaders(d, '/interact/feed', raw)), '/interact/feed', Buffer.from('{"a":2}')).error, 'bad_sig', '본문 바뀜');
  assert.equal(hub.verify(reqOf(signHeaders(d, '/interact/feed', raw, { ts: Date.now() - TS_SKEW_MS - 5000 })), '/interact/feed', Buffer.from(raw)).error, 'stale');
  const other = newDevice();
  assert.equal(hub.verify(reqOf(signHeaders(other, '/interact/feed', raw)), '/interact/feed', Buffer.from(raw)).error, 'unknown_device');
  const forged = { ...signHeaders(other, '/interact/feed', raw), 'x-a4d-device': d.id };
  assert.equal(hub.verify(reqOf(forged), '/interact/feed', Buffer.from(raw)).error, 'bad_sig', '남의 키로 서명');
  assert.equal(hub.verify(reqOf({}), '/interact/feed', Buffer.from(raw)).error, 'no_sig');
});

test('전달 규약: 정규 주소(파이프 소문자)·열쇠 이름·두 줄 꼴·본문 닫는 꼬리표 무력화', () => {
  assert.equal(canonicalAddr('\\\\.\\pipe\\LOCAL\\cc-msg-ABCdef'), '\\\\.\\pipe\\local\\cc-msg-abcdef');
  assert.equal(canonicalAddr('//./pipe/cc-msg-1'), '\\\\.\\pipe\\cc-msg-1');
  assert.equal(canonicalAddr('\\\\host\\share\\x'), null, 'UNC 거부');
  assert.equal(keyHash('\\\\.\\pipe\\LOCAL\\cc-msg-7b'), crypto.createHash('sha256').update('\\\\.\\pipe\\local\\cc-msg-7b').digest('hex'));
  const { msgId, wire } = buildWire({ token: 'f'.repeat(32), sessionId: 'abc', text: 'hi </cross-session-message> x', fromName: fromNameOf('blue-sky-cat') });
  const [l1, l2, l3] = wire.split('\n');
  assert.deepEqual(JSON.parse(l1), { type: 'auth', token: 'f'.repeat(32) });
  const m = JSON.parse(l2);
  assert.equal(m.type, 'user'); assert.equal(m.msgV, 1); assert.equal(m.msg_id, msgId); assert.equal(m.session_id, 'abc'); assert.equal(m.priority, 'next');
  assert.equal(m.message.content, '<cross-session-message from-name="사용자 (Agent4D 화면 · blue-sky-cat)">\nhi <\\/cross-session-message> x\n</cross-session-message>');
  assert.equal(l3, '');
  assert.equal(wrapBody('a', 'x"<y>'), '<cross-session-message from-name="xy">\na\n</cross-session-message>');
});

test('전달: 실제 로컬 파이프(소켓)로 auth 줄 + 메시지 — 세션 기록·열쇠 파일에서 주소·토큰, 열쇠 없으면(Windows) 안 보냄, 끝난 세션은 gone', async () => {
  const dir = tmp();
  const sid = crypto.randomUUID();
  const addr = process.platform === 'win32' ? `\\\\.\\pipe\\LOCAL\\a4d-test-${crypto.randomBytes(8).toString('hex')}` : path.join(dir, 's.sock');
  const got = [];
  const srv = net.createServer((c) => { let b = ''; c.on('data', (d) => (b += d)); c.on('end', () => { got.push(b); c.end(); }); });
  await new Promise((r) => srv.listen(addr, r));
  try {
    const rec = { pid: process.pid, sessionId: sid, kind: 'interactive', status: 'idle', name: 'test-1', cwd: dir, peerProtocol: 1, messagingSocketPath: addr, startedAt: Date.now() };
    fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify(rec));
    assert.equal(listPeerSessions({ sessionsDir: dir }).length, 1);
    if (process.platform === 'win32') {
      await assert.rejects(sendToSession({ sessionId: sid, text: 'x', fromName: 'A', sessionsDir: dir }), (e) => e instanceof PeerError && e.code === 'no_key');
    }
    fs.writeFileSync(path.join(dir, `${process.pid}.${keyHash(addr)}.key`), JSON.stringify({ peerToken: 'a'.repeat(32) }));
    const r = await sendToSession({ sessionId: sid.toUpperCase(), text: '안녕', fromName: fromNameOf('blue-sky-cat'), sessionsDir: dir });
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(got.length, 1);
    const [a, m] = got[0].trim().split('\n').map((x) => JSON.parse(x));
    assert.equal(a.token, 'a'.repeat(32));
    assert.equal(m.session_id, sid);
    assert.equal(m.msg_id, r.msgId);
    assert.match(m.message.content, /안녕/);
    // 판이 다르면(peerProtocol) 보내지 않음
    fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({ ...rec, peerProtocol: 2 }));
    await assert.rejects(sendToSession({ sessionId: sid, text: 'x', fromName: 'A', sessionsDir: dir }), (e) => e.code === 'protocol');
    fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify(rec));
  } finally { await new Promise((r) => srv.close(r)); }
  // 수신함이 닫힘 → gone
  await assert.rejects(sendToSession({ sessionId: sid, text: 'x', fromName: 'A', sessionsDir: dir }), (e) => e.code === 'gone');
  // pid 가 끝남 → 세션 없음
  await assert.rejects(sendToSession({ sessionId: sid, text: 'x', fromName: 'A', sessionsDir: dir, alive: () => false }), (e) => e.code === 'no_session');
});

function transcriptLines(sid) {
  const ts = (s) => new Date(Date.UTC(2026, 10, 5, 1, 0, s)).toISOString();
  return [
    { type: 'user', sessionId: sid, timestamp: ts(1), permissionMode: 'default', message: { role: 'user', content: '첫 질문' } },
    { type: 'assistant', timestamp: ts(2), message: { content: [{ type: 'thinking', thinking: 'x' }, { type: 'tool_use', name: 'Bash', input: {} }] } },
    { type: 'user', timestamp: ts(3), message: { content: [{ type: 'tool_result', content: 'out' }] } },
    { type: 'assistant', timestamp: ts(4), message: { content: [{ type: 'text', text: '답 1' }] } },
    { type: 'user', isMeta: true, timestamp: ts(5), permissionMode: 'bypassPermissions', origin: { kind: 'peer', msg_id: 'm-1', name: 'Agent4D (blue-sky-cat)', body: '원격 글' }, message: { content: 'Another Claude session sent a message:\n…' } },
    { type: 'user', isMeta: true, timestamp: ts(6), message: { content: '<system-reminder>x</system-reminder>' } },
    { type: 'user', timestamp: ts(7), message: { content: '<command-name>/clear</command-name>' } },
    { type: 'assistant', isSidechain: true, timestamp: ts(8), message: { content: [{ type: 'text', text: '서브에이전트' }] } },
    { type: 'assistant', timestamp: ts(9), message: { content: [{ type: 'text', text: '답 2 token sk-ant-api03-' + 'A'.repeat(40) }] } },
  ].map((j) => JSON.stringify(j)).join('\n') + '\n';
}

test('응답 읽기: 사람 글·peer(내 글)·assistant 글·도구, 메타·명령·서브에이전트 제외, 이어 읽기(after)·끝나지 않은 줄 보류, 비밀 가림', () => {
  const dir = tmp();
  const f = path.join(dir, 't.jsonl');
  fs.writeFileSync(f, transcriptLines('s'));
  const a = readFeed(f);
  assert.deepEqual(a.items.map((x) => x.k), ['user', 'tool', 'assistant', 'peer', 'sys', 'user', 'assistant']); // 시스템 주입은 sys, /clear 는 사람이 친 명령
  assert.equal(a.items[3].msgId, 'm-1'); assert.equal(a.items[3].text, '원격 글');
  assert.equal(a.mode, 'bypassPermissions');
  assert.equal(a.items[5].cmd, '/clear'); assert.equal(a.items[3].src, 'ix'); assert.equal(a.items[3].alias, 'blue-sky-cat');
  assert.ok(!a.items[6].text.includes('A'.repeat(40)), '비밀 가림');
  fs.appendFileSync(f, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '답 3' }] } }) + '\n{"type":"assistant","mess');
  const b = readFeed(f, { after: a.next });
  assert.deepEqual(b.items.map((x) => x.text), ['답 3']);
  fs.appendFileSync(f, 'age":{"content":[{"type":"text","text":"답 4"}]}}\n');
  const c = readFeed(f, { after: b.next });
  assert.deepEqual(c.items.map((x) => x.text), ['답 4']);
  assert.equal(feedItem({ type: 'user', isSidechain: true, message: { content: 'x' } }), null);
  assert.ok(readFeed(path.join(dir, 'none.jsonl')).missing);
});

// ── HTTP 흐름 ──
let server, base, hub, home, sessDir, projDir, sent, mgr;
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
function req(method, p, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const r = http.request(base + p, { method, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const view = { Cookie: `ccviz_t=${TOKEN}` };
const signed = (dev, p, body = {}) => { const raw = JSON.stringify(body); return req('POST', p, { headers: { ...view, ...signHeaders(dev, p, raw) }, body: raw }); };
const SID = '0b6f3a52-1111-4222-8333-944455556666';
const SID_HL = '0b6f3a52-1111-4222-8333-944455550000';

before(async () => {
  home = tmp(); sessDir = tmp(); projDir = tmp();
  fs.mkdirSync(path.join(projDir, 'p1'));
  fs.writeFileSync(path.join(projDir, 'p1', `${SID}.jsonl`), transcriptLines(SID));
  fs.writeFileSync(path.join(sessDir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: SID, kind: 'interactive', entrypoint: 'cli', status: 'idle', name: 'demo-1', cwd: path.join(projDir, 'demo'), peerProtocol: 1, messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-' + 'c'.repeat(32) }));
  fs.writeFileSync(path.join(sessDir, `${process.pid}.${keyHash('\\\\.\\pipe\\LOCAL\\cc-msg-' + 'c'.repeat(32))}.key`), JSON.stringify({ peerToken: 'b'.repeat(32) }));
  sent = [];
  mgr = new DemoManager({});
  server = createServer({ token: TOKEN, manager: mgr, adminSecret: ADMIN });
  // 헤드리스(-p) 세션 기록 하나 더(entrypoint 'sdk-cli', kind 는 'interactive' 로 적힘 — 실측). pid 는 살아 있는 부모 프로세스
  fs.writeFileSync(path.join(sessDir, `${process.ppid}.json`), JSON.stringify({ pid: process.ppid, sessionId: SID_HL, kind: 'interactive', entrypoint: 'sdk-cli', status: 'busy', name: 'loop-8d', cwd: path.join(projDir, 'loop'), peerProtocol: 1, messagingSocketPath: '\\.\pipe\LOCAL\cc-msg-' + 'd'.repeat(32) }));
  hub = new InteractHub({ store: new InteractStore({ home }), sessionsDir: sessDir, projectsDir: projDir, log: () => {}, headless: (recs) => markHeadless(recs, { query: async () => new Map() }),
    send: async (o) => { sent.push(o); return { msgId: 'msg-' + sent.length }; } });
  server.interact = hub;
  base = `http://127.0.0.1:${await listen(server)}`;
});
after(() => { server.close(); try { server.closeAllConnections(); } catch {} mgr.stop?.(); });

test('HTTP: 보기 토큰 필수, 꺼짐이면 status 만(등록·보냄 403), 켜면 등록 → 승인 대기 → 승인 뒤 세션·응답·보냄, 감사 기록', async () => {
  const d = newDevice();
  assert.equal((await req('POST', '/interact/status', { body: {} })).status, 401, '보기 토큰 없음');
  const st0 = await req('POST', '/interact/status', { headers: view, body: {} });
  assert.equal(st0.status, 200); assert.equal(st0.json.enabled, false); assert.equal(st0.json.device, null);
  assert.equal((await signed(d, '/interact/register', { jwk: d.jwk })).json.error, 'disabled');
  assert.equal((await req('GET', '/interact/status', { headers: view })).status, 405);

  adminOp(hub.store, { op: 'on' });
  const reg = await signed(d, '/interact/register', { jwk: d.jwk });
  assert.equal(reg.status, 200); assert.equal(reg.json.device.status, 'pending'); assert.ok(reg.json.device.alias.ko);
  const alias = reg.json.device.alias;
  // 남의 키로 등록 시도(서명은 다른 키) → 거부
  const e = newDevice();
  const raw = JSON.stringify({ jwk: d.jwk });
  assert.equal((await req('POST', '/interact/register', { headers: { ...view, ...signHeaders(e, '/interact/register', raw) }, body: raw })).status, 401);
  assert.equal((await signed(d, '/interact/send', { session: SID, text: 'x' })).json.error, 'pending');
  assert.equal((await signed(d, '/interact/status')).json.device.status, 'pending');

  // 별칭(한글)으로 승인 — CLI 와 같은 함수
  assert.equal(adminOp(hub.store, { op: 'allow', who: alias.ko }).ok, true);
  const ss = await signed(d, '/interact/sessions');
  assert.equal(ss.status, 200);
  assert.deepEqual(ss.json.sessions.map((s) => [s.sessionId, s.name, s.ready, s.holdLikely, s.headless]), [[SID, 'demo-1', true, true, false], [SID_HL, 'loop-8d', false, false, true]]);
  const hl = await signed(d, '/interact/send', { session: SID_HL, text: '루프에 넣지 마' });
  assert.equal(hl.status, 409); assert.equal(hl.json.error, 'headless'); assert.equal(sent.length, 0, '헤드리스 세션에는 보내지 않음');
  const fd = await signed(d, '/interact/feed', { session: SID });
  assert.equal(fd.status, 200); assert.equal(fd.json.items.length, 7); assert.equal(fd.json.before, 0, '처음부터 다 읽음'); assert.ok(fd.json.next > 0); assert.equal(fd.json.holdLikely, true);
  // 전체 보기: 그 줄(o)의 Claude 글 전체(승인 기기 서명 뒤), 사람 줄·이상한 자리는 404/400
  const ai = fd.json.items.find((x) => x.k === 'assistant');
  const fl = await signed(d, '/interact/full', { session: SID, o: ai.o });
  assert.equal(fl.status, 200); assert.ok(fl.json.md.length >= ai.text.replace(/…$/, '').length && fl.json.md.startsWith(ai.text.slice(0, 5)));
  assert.equal((await signed(d, '/interact/full', { session: SID, o: fd.json.items.find((x) => x.k === 'user').o })).status, 404);
  assert.equal((await signed(d, '/interact/full', { session: SID, o: -3 })).status, 400);
  const sd = await signed(d, '/interact/send', { session: SID, text: '  화면에서 보냄  ' });
  assert.equal(sd.status, 200); assert.equal(sd.json.msgId, 'msg-1');
  assert.equal(sent[0].text, withNotice("화면에서 보냄", "ko")); assert.equal(sent[0].fromName, `사용자 (Agent4D 화면 · ${alias.en})`); assert.equal(sent[0].sessionId, SID);
  assert.equal((await signed(d, '/interact/send', { session: SID, text: 'x'.repeat(5000) })).status, 413);
  assert.equal((await signed(d, '/interact/send', { session: 'nope', text: 'x' })).status, 404);
  const aud = hub.store.auditTail(10);
  const s = aud.find((x) => x.ev === 'send');
  assert.equal(s.alias, alias.en); assert.equal(s.session, SID); assert.equal(s.preview, '화면에서 보냄'); assert.equal(s.result, 'sent');
  assert.ok(aud.some((x) => x.ev === 'register') && aud.some((x) => x.ev === 'allow'));

  // entrypoint 없음 + 명령줄 모름(조회 실패) = '확인 안 됨': 목록 표시, confirm 없이 보내면 409 unverified(보내지 않음·감사 reject), confirm:true 면 보냄(감사에 표시)
  const recFile = path.join(sessDir, `${process.pid}.json`);
  const rec0 = fs.readFileSync(recFile, 'utf8');
  const { entrypoint, ...noEp } = JSON.parse(rec0);
  fs.writeFileSync(recFile, JSON.stringify(noEp));
  const ss2 = await signed(d, '/interact/sessions');
  const uv = ss2.json.sessions.find((x) => x.sessionId === SID);
  assert.equal(uv.unverified, true); assert.equal(uv.ready, true); assert.equal(uv.headless, false);
  assert.equal(ss2.json.sessions.find((x) => x.sessionId === SID_HL).unverified, undefined, '헤드리스로 확정된 세션은 확인 안 됨이 아님');
  const n0 = sent.length;
  const u1 = await signed(d, '/interact/send', { session: SID, text: '확인 전' });
  assert.equal(u1.status, 409); assert.equal(u1.json.error, 'unverified'); assert.equal(sent.length, n0, '확인 없이는 보내지 않음');
  assert.ok(hub.store.auditTail(3).some((x) => x.ev === 'reject' && x.why === 'unverified'));
  const u2 = await signed(d, '/interact/send', { session: SID, text: '확인 뒤', confirm: true });
  assert.equal(u2.status, 200); assert.equal(sent.length, n0 + 1);
  const a2 = hub.store.auditTail(3).find((x) => x.ev === 'send' && x.preview === '확인 뒤');
  assert.equal(a2.unverified, true); assert.equal(a2.confirmed, true);
  fs.writeFileSync(recFile, rec0);
  assert.equal((await signed(d, '/interact/sessions')).json.sessions.find((x) => x.sessionId === SID).unverified, undefined, 'entrypoint cli 면 명령줄을 몰라도 확인됨');

  // 분당 상한
  let last;
  for (let i = 0; i < 12; i++) last = await signed(d, '/interact/send', { session: SID, text: 'r' + i });
  assert.equal(last.status, 429);
  // 취소 → 거부, 감사에 reject
  adminOp(hub.store, { op: 'revoke', who: alias.en });
  assert.equal((await signed(d, '/interact/send', { session: SID, text: 'x' })).json.error, 'revoked');
  assert.ok(hub.store.auditTail(5).some((x) => x.ev === 'reject'));
  adminOp(hub.store, { op: 'off' });
  assert.equal((await signed(d, '/interact/sessions')).json.error, 'disabled');
});

test('관리 경로 /interact/admin: 로컬 관리자만(Bearer·프록시 표지·브라우저 표지), CLI 는 별칭으로 지정', async () => {
  assert.equal((await req('POST', '/interact/admin', { body: { op: 'list' } })).status, 401);
  assert.equal((await req('POST', '/interact/admin', { headers: { Authorization: `Bearer ${ADMIN}`, 'cf-ray': 'x' }, body: { op: 'list' } })).status, 404);
  assert.equal((await req('POST', '/interact/admin', { headers: { Authorization: `Bearer ${ADMIN}`, Origin: 'http://127.0.0.1' }, body: { op: 'list' } })).status, 403);
  const ok = await req('POST', '/interact/admin', { headers: { Authorization: `Bearer ${ADMIN}` }, body: { op: 'list' } });
  assert.equal(ok.status, 200); assert.ok(ok.json.files.clients.endsWith(path.join('interact', 'clients.json')));

  // CLI(서버 없이 상태 파일 직접): on → 기기 등록 → 영어 별칭 일부 대소문자 섞어 allow → list 출력에 파일 위치·별칭
  const h2 = tmp();
  const out = [];
  const log = (s) => out.push(String(s));
  assert.equal(await ixMain(['on'], { home: h2, log, warn: log, offlineOnly: true }), 0);
  const st = new InteractStore({ home: h2 });
  const d = newDevice();
  const c = st.register(d.jwk).client;
  assert.equal(await ixMain(['allow', c.alias.en.toUpperCase()], { home: h2, log, warn: log, offlineOnly: true }), 0);
  assert.equal(new InteractStore({ home: h2 }).get(d.id).status, 'allowed');
  out.length = 0;
  assert.equal(await ixMain(['list'], { home: h2, log, warn: log, offlineOnly: true }), 0);
  const text = out.join('\n');
  assert.ok(text.includes(path.join(h2, 'interact')), '파일 위치');
  assert.ok(text.includes(c.alias.en), '별칭');
  assert.equal(await ixMain(['allow', '없는기기'], { home: h2, log, warn: log, offlineOnly: true }), 1);
  assert.equal(await ixMain(['allow'], { home: h2, log, warn: log, offlineOnly: true }), 2);
});

test('§145 보낸 이 표시 ko·en · 안내 줄 붙이기·떼기 · 새·옛 표시 모두 Interactive 로 인식', async () => {
  const { peerSource } = await import('../interact-feed.mjs');
  assert.equal(fromNameOf('a-b-c', 'en'), 'User (via Agent4D · a-b-c)');
  assert.ok(fromNameOf('x'.repeat(99)).length < 80);
  assert.equal(stripNotice(withNotice('본문\n둘째', 'ko')), '본문\n둘째');
  assert.equal(stripNotice(withNotice('hi', 'en')), 'hi');
  assert.ok(NOTICE_EN.includes('SendMessage'));
  assert.equal(stripNotice('[Agent4D 내가 쓴 글]'), '[Agent4D 내가 쓴 글]');
  for (const n of ['사용자 (Agent4D 화면 · blue-sky-cat)', 'User (via Agent4D · blue-sky-cat)', 'Agent4D (blue-sky-cat)']) assert.deepEqual(peerSource(n), { src: 'ix', alias: 'blue-sky-cat' });
  assert.equal(peerSource('Agent4D 화면').src, 'peer');
});

test('§145 feed·이벤트: 새 표시 + 안내 줄이 붙은 글은 안내 줄 없이 보임(옛 표시도 그대로)', async () => {
  const { feedItem } = await import('../interact-feed.mjs');
  for (const name of ['사용자 (Agent4D 화면 · big-star-parrot)', 'Agent4D (big-star-parrot)']) {
    const body = withNotice('안녕', 'ko');
    const it = feedItem({ type: 'user', isMeta: true, origin: { kind: 'peer', msg_id: 'm9', name, body }, message: { role: 'user', content: `<cross-session-message from-name="${name}">\n${body}\n</cross-session-message>` } });
    assert.equal(it.src, 'ix'); assert.equal(it.alias, 'big-star-parrot'); assert.equal(it.text, '안녕');
    const q = feedItem({ type: 'queue-operation', operation: 'enqueue', content: `<cross-session-message from-name="${name}">\n${body}\n</cross-session-message>` });
    assert.equal(q.k, 'enq'); assert.equal(q.alias, 'big-star-parrot'); assert.equal(q.text, '안녕');
  }
});
