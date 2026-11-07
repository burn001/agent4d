// 질문창에 Agent4D 화면에서 답하기(Remote Control 브리지): id 꼴·링크, SSE 읽기, 열린 질문 찾기, answers 만들기(단일·복수·기타·빠짐),
// 보내기(가짜 fetch — 주소·머리·본문 꼴, 401·404·답 없음), 자격 읽기(만료), /interact/ask 경로(승인 기기·Remote Control 없음·헤드리스·감사)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { cseOf, rcLink, parseSse, pendingAsks, buildAnswers, answerViaRc, readOauth, readControlEvents, RcError, RC_API } from '../rc-answer.mjs';
import { InteractHub, adminOp, signingString, sha256hex } from '../interact.mjs';
import { InteractStore, deviceIdOf } from '../interact-store.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'a4d-rc-'));
const BID = 'session_TESTabc123';
const Q = { questions: [
  { question: 'Agent4D probe: which color?', header: 'Color', multiSelect: false, options: [{ label: 'Red (warm)', description: 'w' }, { label: 'Blue (cool)', description: 'c' }] },
  { question: 'Which extras?', header: 'Extras', multiSelect: true, options: [{ label: 'A', description: '' }, { label: 'B', description: '' }, { label: 'C', description: '' }] },
] };
const REQ = (rid, tu, input = Q, tool = 'AskUserQuestion') => ({ event_id: 'e-' + rid, sequence_num: '3', source: 'worker', payload: { type: 'control_request', request_id: rid, request: { subtype: 'can_use_tool', tool_name: tool, input, tool_use_id: tu } } });
const RESP = (rid) => ({ source: 'client', payload: { type: 'control_response', response: { subtype: 'success', request_id: rid, response: { behavior: 'allow' } } } });
const sse = (evs) => evs.map((e) => `event: client_event\ndata: ${JSON.stringify(e)}\n\n`).join('');

/** 가짜 fetch: GET 스트림은 주어진 이벤트를 두 조각으로 흘리고 열어 둔다(조용해지면 읽는 쪽이 끊음), POST 는 기록 */
function fakeFetch(evs, { streamStatus = 200, postStatus = 200 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers, body: init.body });
    if ((init.method || 'GET') === 'GET') {
      if (streamStatus !== 200) return new Response('no', { status: streamStatus });
      const txt = sse([{ connection_status: 'connected' }, ...evs]);
      const half = Math.floor(txt.length / 2);
      const body = new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode(txt.slice(0, half))); setTimeout(() => c.enqueue(new TextEncoder().encode(txt.slice(half))), 5); },
        cancel() {},
      });
      init.signal?.addEventListener('abort', () => {});
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify({ results: [{ sequence_num: '9' }] }), { status: postStatus });
  };
  f.calls = calls;
  return f;
}
const AUTH = { token: 'tok-' + 'x'.repeat(20), org: '909be2c2-cf46-4aac-8bac-cb7fd2f56c8b' };
const FAST = { maxMs: 1500, quietMs: 60 };

test('id 꼴: session_·cse_ 서로 바꿈, 앱 링크는 Claude 앱 세션 주소, 이상한 꼴은 null', () => {
  assert.equal(cseOf(BID), 'cse_TESTabc123');
  assert.equal(cseOf('cse_TESTabc123'), 'cse_TESTabc123');
  assert.equal(rcLink('cse_TESTabc123'), 'https://claude.ai/code/' + BID);
  for (const bad of [null, '', 'session_', 'session_../x', 'abc_TESTabc1', 'session_a"b']) { assert.equal(cseOf(bad), null, String(bad)); assert.equal(rcLink(bad), null); }
});

test('SSE 조각 → 이벤트(꼬리는 남김) · 열린 AskUserQuestion 만(답·취소된 것, 다른 도구, 다른 요청 빼고)', () => {
  const p = parseSse('data: {"a":1}\n\ndata: {"b"');
  assert.deepEqual(p.events, [{ a: 1 }]); assert.equal(p.rest, 'data: {"b"');
  const evs = [REQ('r1', 'tu_1'), REQ('r2', 'tu_2'), RESP('r1'), REQ('r3', 'tu_3', { command: 'ls' }, 'Bash'),
    { payload: { type: 'control_request', request_id: 'r4', request: { subtype: 'initialize' } } }, REQ('r5', 'tu_5'), { payload: { type: 'control_cancel_request', request_id: 'r5' } }];
  const m = pendingAsks(evs);
  assert.deepEqual([...m.keys()], ['tu_2']);
  assert.equal(m.get('tu_2').requestId, 'r2');
  assert.deepEqual(pendingAsks([null, 3, {}, { payload: 'x' }]).size, 0);
});

test('answers: 질문 문구·라벨은 브리지 요청 원문에서 — 단일은 하나(직접 입력 우선), 복수는 라벨 + 직접 입력을 ", " · 빠지면 incomplete', () => {
  assert.deepEqual(buildAnswers(Q, [{ q: 0, o: [1] }, { q: 1, o: [2, 0, 0, 9] }]), { 'Agent4D probe: which color?': 'Blue (cool)', 'Which extras?': 'A, C' });
  assert.deepEqual(buildAnswers(Q, [{ q: 0, o: [0], other: ' 보라 ' }, { q: 1, o: [1], other: '직접' }]), { 'Agent4D probe: which color?': '보라', 'Which extras?': 'B, 직접' });
  assert.throws(() => buildAnswers(Q, [{ q: 0, o: [1] }]), (e) => e instanceof RcError && e.code === 'incomplete');
  assert.throws(() => buildAnswers(Q, [{ q: 0, o: [7] }, { q: 1, o: [0] }]), (e) => e.code === 'incomplete');
  assert.throws(() => buildAnswers({}, []), (e) => e.code === 'bad_pick');
  assert.equal(buildAnswers(Q, [{ q: 0, other: 'x'.repeat(5000) }, { q: 1, o: [0] }])['Agent4D probe: which color?'].length, 2000);
});

test('보내기: 제어 스트림(control_only=1) 읽고 → 그 tool_use 요청에 control_response(allow + 원래 input + answers) POST — 실측 꼴', async () => {
  const f = fakeFetch([REQ('rid-1', 'toolu_01', Q)]);
  const r = await answerViaRc({ bridgeSessionId: BID, toolUseId: 'toolu_01', picks: [{ q: 0, o: [1] }, { q: 1, o: [0] }], fetchImpl: f, auth: AUTH, readOpts: FAST });
  assert.equal(r.ok, true); assert.equal(r.requestId, 'rid-1');
  const [g, p] = f.calls;
  assert.equal(g.url, `${RC_API}/v1/code/sessions/cse_TESTabc123/events/stream?control_only=1`);
  assert.equal(g.headers.Accept, 'text/event-stream');
  assert.equal(p.method, 'POST'); assert.equal(p.url, `${RC_API}/v1/code/sessions/cse_TESTabc123/events`);
  assert.equal(p.headers.Authorization, `Bearer ${AUTH.token}`); assert.equal(p.headers['x-organization-uuid'], AUTH.org); assert.equal(p.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(p.body);
  assert.equal(body.events.length, 1);
  const pl = body.events[0].payload;
  assert.equal(pl.type, 'control_response'); assert.match(pl.uuid, /^[0-9a-f-]{36}$/);
  assert.deepEqual(pl.response.subtype, 'success'); assert.equal(pl.response.request_id, 'rid-1');
  assert.equal(pl.response.response.behavior, 'allow'); assert.equal(pl.response.response.toolUseID, 'toolu_01');
  assert.deepEqual(pl.response.response.updatedInput.questions, Q.questions, '원래 questions 그대로');
  assert.deepEqual(pl.response.response.updatedInput.answers, { 'Agent4D probe: which color?': 'Blue (cool)', 'Which extras?': 'A' });
});

test('보내기 실패: 답이 이미 들어감 → not_pending(보내지 않음) · 스트림 401/403 → auth · 404 → no_rc · POST 500 → post · 이상한 id → no_rc', async () => {
  const done = fakeFetch([REQ('r1', 'tu_1'), RESP('r1')]);
  await assert.rejects(answerViaRc({ bridgeSessionId: BID, toolUseId: 'tu_1', picks: [], fetchImpl: done, auth: AUTH, readOpts: FAST }), (e) => e.code === 'not_pending');
  assert.equal(done.calls.filter((c) => c.method === 'POST').length, 0);
  for (const [st, code] of [[401, 'auth'], [403, 'auth'], [404, 'no_rc'], [500, 'stream']])
    await assert.rejects(answerViaRc({ bridgeSessionId: BID, toolUseId: 'tu_1', picks: [], fetchImpl: fakeFetch([], { streamStatus: st }), auth: AUTH, readOpts: FAST }), (e) => e.code === code, String(st));
  await assert.rejects(answerViaRc({ bridgeSessionId: BID, toolUseId: 'tu_1', picks: [{ q: 0, o: [0] }, { q: 1, o: [0] }], fetchImpl: fakeFetch([REQ('r1', 'tu_1')], { postStatus: 500 }), auth: AUTH, readOpts: FAST }), (e) => e.code === 'post');
  await assert.rejects(answerViaRc({ bridgeSessionId: 'nope', toolUseId: 'tu_1', picks: [], auth: AUTH }), (e) => e.code === 'no_rc');
  // 끝나지 않는 스트림도 상한 안에 끊긴다
  const t0 = Date.now();
  const evs = await readControlEvents('cse_TESTabc123', AUTH, { fetchImpl: fakeFetch([REQ('r9', 'tu_9')]), maxMs: 400, quietMs: 10_000 });
  assert.ok(Date.now() - t0 < 1500); assert.equal(pendingAsks(evs).size, 1);
});

test('자격: ~/.claude/.credentials.json + ~/.claude.json 조직 — 없거나 만료면 no_auth(값은 오류에 싣지 않음)', () => {
  const home = tmp(), uj = path.join(home, 'u.json');
  assert.throws(() => readOauth({ home, userJson: uj }), (e) => e.code === 'no_auth');
  fs.writeFileSync(path.join(home, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'secret-tok', expiresAt: Date.now() + 3600_000 } }));
  fs.writeFileSync(uj, JSON.stringify({ oauthAccount: { organizationUuid: 'org-1' } }));
  assert.deepEqual(readOauth({ home, userJson: uj }), { token: 'secret-tok', org: 'org-1' });
  fs.writeFileSync(path.join(home, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'secret-tok', expiresAt: Date.now() - 1 } }));
  assert.throws(() => readOauth({ home, userJson: uj }), (e) => e.code === 'no_auth' && !String(e.message + e.detail).includes('secret-tok'));
});

// ── /interact/ask 경로(허브 직접) ──
function newDevice() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = publicKey.export({ format: 'jwk' });
  const jwk = { kty: 'EC', crv: 'P-256', x: j.x, y: j.y };
  return { privateKey, jwk, id: deviceIdOf(jwk) };
}
async function call(hub, dev, pathname, body) {
  const raw = JSON.stringify(body);
  const ts = Date.now(), nonce = crypto.randomBytes(16).toString('base64url');
  const sig = crypto.sign('sha256', Buffer.from(signingString('POST', pathname, ts, nonce, sha256hex(Buffer.from(raw)))), { key: dev.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const req = Object.assign(Readable.from([Buffer.from(raw)]), { method: 'POST', headers: { 'x-a4d-device': dev.id, 'x-a4d-ts': String(ts), 'x-a4d-nonce': nonce, 'x-a4d-sig': sig }, socket: { remoteAddress: '127.0.0.1' } });
  let out = null;
  await hub.handle(req, {}, new URL('http://x' + pathname), { sendJson: (res, status, json) => { out = { status, json }; }, headers: {} });
  return out;
}

test('/interact/ask: 승인 기기만 · Remote Control 세션이면 rcAnswer(브리지 id·tool_use·picks) → 200 + 링크, 감사 ask-answer · 없으면 409 no_rc · 헤드리스 409 · 실패 코드 전달', async () => {
  const home = tmp(), sessionsDir = path.join(home, 'sessions');
  fs.mkdirSync(sessionsDir);
  const SID = crypto.randomUUID();
  const rec = { pid: process.pid, sessionId: SID, kind: 'interactive', entrypoint: 'cli', name: 'probe', cwd: home, peerProtocol: 1, messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-' + 'a'.repeat(32), bridgeSessionId: BID, status: 'waiting', waitingFor: 'input needed' };
  fs.writeFileSync(path.join(sessionsDir, `${process.pid}.json`), JSON.stringify(rec));
  const calls = [];
  let fail = null;
  const hub = new InteractHub({ store: new InteractStore({ home }), sessionsDir, projectsDir: home, headless: async (rs) => { for (const r of rs) r.headless = false; return rs; },
    rcAnswer: async (a) => { calls.push(a); if (fail) throw new RcError(fail); return { ok: true, requestId: 'r', answers: { q: 'Blue (cool)' } }; }, log: () => {} });
  adminOp(hub.store, { op: 'on' });
  const d = newDevice();
  await call(hub, d, '/interact/register', { jwk: d.jwk });
  const body = { session: SID, toolUseId: 'toolu_01Pq6WnW7uTtk1WBXH7Q1dVn', picks: [{ q: 0, o: [1] }] };
  assert.equal((await call(hub, d, '/interact/ask', body)).json.error, 'pending', '승인 전');
  assert.equal(calls.length, 0);
  adminOp(hub.store, { op: 'allow', who: d.id.slice(0, 8) });
  // 세션 목록에 앱 링크
  const ss = await call(hub, d, '/interact/sessions', {});
  assert.equal(ss.json.sessions.find((s) => s.sessionId === SID).remote, 'https://claude.ai/code/' + BID);
  const ok = await call(hub, d, '/interact/ask', body);
  assert.equal(ok.status, 200); assert.equal(ok.json.ok, true); assert.equal(ok.json.via, 'rc'); assert.equal(ok.json.link, 'https://claude.ai/code/' + BID);
  assert.deepEqual(calls[0], { bridgeSessionId: BID, toolUseId: body.toolUseId, picks: body.picks });
  const a = hub.store.auditTail(5).find((x) => x.ev === 'ask-answer');
  assert.equal(a.result, 'answered'); assert.equal(a.session, SID); assert.equal(a.toolUseId, body.toolUseId); assert.equal(a.preview, 'Blue (cool)');
  for (const [code, st] of [['not_pending', 409], ['auth', 502], ['incomplete', 400]]) {
    fail = code;
    const r = await call(hub, d, '/interact/ask', body);
    assert.equal(r.status, st, code); assert.equal(r.json.error, code); assert.equal(r.json.link, 'https://claude.ai/code/' + BID, '실패해도 앱 링크');
  }
  fail = null;
  assert.equal((await call(hub, d, '/interact/ask', { ...body, toolUseId: 'x' })).status, 400);
  assert.equal((await call(hub, d, '/interact/ask', { ...body, picks: 'x' })).status, 400);
  // Remote Control 없는 세션 → 409 no_rc(rcAnswer 부르지 않음)
  const n = calls.length;
  fs.writeFileSync(path.join(sessionsDir, `${process.pid}.json`), JSON.stringify({ ...rec, bridgeSessionId: undefined }));
  const nr = await call(hub, d, '/interact/ask', body);
  assert.equal(nr.status, 409); assert.equal(nr.json.error, 'no_rc'); assert.equal(calls.length, n);
  assert.equal((await call(hub, d, '/interact/sessions', {})).json.sessions.find((s) => s.sessionId === SID).remote, undefined);
  // 헤드리스 → 409
  fs.writeFileSync(path.join(sessionsDir, `${process.pid}.json`), JSON.stringify({ ...rec, entrypoint: 'sdk-cli' }));
  hub.headless = async (rs) => { for (const r of rs) r.headless = true; return rs; };
  const hl = await call(hub, d, '/interact/ask', body);
  assert.equal(hl.status, 409); assert.equal(hl.json.error, 'headless'); assert.equal(calls.length, n);
  assert.ok(hub.store.auditTail(5).filter((x) => x.ev === 'ask-answer' && x.result === 'failed').some((x) => x.why === 'headless'));
});
