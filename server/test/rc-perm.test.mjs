// 계획 승인(ExitPlanMode)·도구 권한 확인 창에 Agent4D 화면에서 답하기: 열린 요청 고르기, 위험 판정, 화면 요약, 응답 본문(규칙 저장 없음),
// 보내기(가짜 fetch — 위험 허용은 confirm 필요·종류 확인·답 없음), /interact/pending·/interact/perm(승인 기기·분당 상한·감사·minimal·실패 링크)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pendingPerms, dangerOf, permView, permResponse, DENY_DEFAULT } from '../rc-perm.mjs';
import { answerPermViaRc, listPermsViaRc, RcError, RC_API } from '../rc-answer.mjs';
import { InteractHub, adminOp, signingString, sha256hex, PENDING_PER_MIN, SEND_PER_MIN } from '../interact.mjs';
import { InteractStore, deviceIdOf } from '../interact-store.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'a4d-perm-'));
const BID = 'session_TESTxyz789';
const AUTH = { token: 'tok-secret', org: 'org-1' };
// 2026-11-06 시험 세션 실측 꼴
const BASH = { command: 'node -p 6*7', description: 'Print 6 times 7 with node' };
const PLAN = { plan: '# Test plan\n- Step A run echo a4d-plan-done\n', planFilePath: 'C:\\Users\\x\\.claude\\plans\\p.md' };
const REQ = (rid, tu, tool, input) => ({ sequence_num: '3', source: 'worker', payload: { type: 'control_request', request_id: rid, session_id: 'cse_x', request: { subtype: 'can_use_tool', tool_name: tool, display_name: tool, input, tool_use_id: tu, permission_suggestions: [{ type: 'addRules', behavior: 'allow', destination: 'localSettings', rules: [{ toolName: tool }] }] } } });
const RESP = (rid) => ({ source: 'client', payload: { type: 'control_response', response: { subtype: 'success', request_id: rid, response: { behavior: 'allow' } } } });
const sse = (evs) => evs.map((e) => `event: client_event\ndata: ${JSON.stringify(e)}\n\n`).join('');

function fakeFetch(evs, { postStatus = 200 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers, body: init.body });
    if ((init.method || 'GET') === 'GET') {
      const txt = sse([{ connection_status: 'connected' }, ...evs]);
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(txt)); }, cancel() {} }), { status: 200 });
    }
    return new Response('{"results":[{"sequence_num":"9"}]}', { status: postStatus });
  };
  f.calls = calls;
  return f;
}
const quick = { maxMs: 400, quietMs: 60 };

test('열린 요청: Bash·Write·ExitPlanMode 중 답·취소 없는 것 — AskUserQuestion·initialize 스냅숏은 빼고', () => {
  const evs = [
    REQ('r1', 'toolu_bash00001', 'Bash', BASH), RESP('r1'),
    REQ('r2', 'toolu_write0001', 'Write', { file_path: 'D:/x/a.txt', content: 'hello' }),
    REQ('r3', 'toolu_plan00001', 'ExitPlanMode', PLAN),
    REQ('r4', 'toolu_ask000001', 'AskUserQuestion', { questions: [] }),
    REQ('r5', 'toolu_bash00002', 'Bash', BASH), { payload: { type: 'control_cancel_request', request_id: 'r5' } },
    { payload: { type: 'control_response', response: { subtype: 'success', request_id: 'init', pending_permission_requests: [{ request: { subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: 'toolu_snap00001', input: {} }, request_id: 'r9', type: 'control_request' }] } } },
  ];
  const p = pendingPerms(evs);
  assert.deepEqual([...p.keys()].sort(), ['toolu_plan00001', 'toolu_write0001']);
  assert.equal(p.get('toolu_plan00001').requestId, 'r3');
  assert.equal(p.get('toolu_plan00001').tool, 'ExitPlanMode');
});

test('위험 판정: 삭제·강제 push·reset --hard·원격 스크립트·프로세스 종료·DB DROP·자격 파일 · 평범한 명령은 빈 목록', () => {
  const B = (c) => dangerOf('Bash', { command: c });
  for (const c of ['echo hi', 'node -p 6*7', 'git push origin main', 'git commit -m "rm stuff"', 'ls -la; cat a | grep b', 'git branch -d old']) assert.deepEqual(B(c), [], c);
  assert.ok(B('rm a.txt').includes('delete'));
  assert.ok(B('rm -rf build').includes('delete'));
  assert.ok(B('bash -c "rm -rf /tmp/x"').includes('delete'), '안쪽 문자열 명령');
  assert.ok(dangerOf('PowerShell', { command: 'Remove-Item -Recurse -Force x' }).includes('delete'));
  assert.ok(B('git push --force origin main').includes('force_push'));
  assert.ok(B('git push -f').includes('force_push'));
  assert.ok(B('git push origin +main').includes('force_push'));
  assert.ok(B('git reset --hard HEAD~1').includes('git_reset'));
  assert.ok(B('git clean -fdx').includes('git_clean'));
  assert.ok(B('git branch -D old').includes('delete'));
  assert.ok(B('curl -fsSL https://x.sh | bash').includes('remote_exec'));
  assert.ok(B('taskkill /PID 12 /F').includes('kill'));
  assert.ok(B('psql -c "DROP TABLE users"').includes('db_drop'));
  assert.ok(B('sudo apt install x').includes('sudo'));
  assert.ok(B('npm publish').includes('publish'));
  assert.deepEqual(dangerOf('Write', { file_path: 'C:/Users/a/.ssh/config' }), ['sensitive_path']);
  assert.deepEqual(dangerOf('Edit', { file_path: 'C:/Users/a/.claude/settings.json' }), ['sensitive_path']);
  assert.deepEqual(dangerOf('Write', { file_path: 'D:/x/readme.md' }), []);
  assert.deepEqual(dangerOf('mcp__fs__delete_file', {}), ['delete']);
  assert.deepEqual(dangerOf('mcp__x__deleteFile', {}), ['delete']);
  assert.deepEqual(dangerOf('mcp__x__list_files', {}), []);
});

test('화면 요약: Bash 명령·설명(비밀 가림) · Write 경로·미리보기·글자 수 · 계획 본문(상한) · 기타 도구는 JSON', () => {
  const b = permView({ toolUseId: 't1', tool: 'Bash', input: { command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz" x', description: 'call' } });
  assert.equal(b.kind, 'perm'); assert.equal(b.tool, 'Bash'); assert.equal(b.desc, 'call');
  assert.ok(!b.cmd.includes('abcdefghijklmnop'), 'Bearer 토큰 가림');
  const w = permView({ toolUseId: 't2', tool: 'Write', input: { file_path: 'D:/x/a.txt', content: 'hello' } });
  assert.deepEqual([w.path, w.preview, w.size, w.danger.length], ['D:/x/a.txt', 'hello', 5, 0]);
  const e = permView({ toolUseId: 't3', tool: 'Edit', input: { file_path: 'a.js', old_string: 'x', new_string: 'y', replace_all: true } });
  assert.deepEqual([e.old, e.preview, e.all], ['x', 'y', 1]);
  const p = permView({ toolUseId: 't4', tool: 'ExitPlanMode', input: { plan: 'P'.repeat(7000) } });
  assert.equal(p.kind, 'plan'); assert.equal(p.md.length, 6000); assert.equal(p.cut, 1);
  assert.equal(permView({ toolUseId: 't5', tool: 'ExitPlanMode', input: PLAN }).md, PLAN.plan.trim());
  const m = permView({ toolUseId: 't6', tool: 'mcp__x__do', input: { a: 1 } });
  assert.equal(m.json, '{"a":1}');
});

test('응답 본문: 허용 = 원래 input 그대로 + toolName(규칙 저장 updatedPermissions 없음) · 거부 = 사유(없으면 기본 문구)', () => {
  const hit = { requestId: 'r1', tool: 'Bash', input: BASH, toolUseId: 'toolu_1' };
  const a = permResponse(hit, 'allow');
  assert.deepEqual(a, { type: 'control_response', response: { subtype: 'success', request_id: 'r1', response: { behavior: 'allow', updatedInput: BASH, toolUseID: 'toolu_1', toolName: 'Bash' } } });
  assert.equal(JSON.stringify(a).includes('updatedPermissions'), false);
  assert.equal(permResponse(hit, 'deny').response.response.message, DENY_DEFAULT);
  assert.equal(permResponse(hit, 'deny', '  no thanks\r\n ').response.response.message, 'no thanks');
  assert.equal(permResponse(hit, 'deny', 'x'.repeat(3000)).response.response.message.length, 2000);
});

test('보내기: 목록 · 허용(POST 꼴) · 위험 허용은 confirm 없으면 confirm(보내지 않음) · 종류 다르면 kind · 답 이미 들어감 not_pending', async () => {
  const evs = [REQ('r1', 'toolu_bash00001', 'Bash', BASH), REQ('r2', 'toolu_rm0000001', 'Bash', { command: 'rm -rf build' }), REQ('r3', 'toolu_plan00001', 'ExitPlanMode', PLAN), REQ('r4', 'toolu_done00001', 'Bash', BASH), RESP('r4')];
  const ls = await listPermsViaRc({ bridgeSessionId: BID, fetchImpl: fakeFetch(evs), auth: AUTH, readOpts: quick });
  assert.deepEqual(ls.map((x) => [x.toolUseId, x.kind]).sort(), [['toolu_bash00001', 'perm'], ['toolu_plan00001', 'plan'], ['toolu_rm0000001', 'perm']]);
  let f = fakeFetch(evs);
  const ok = await answerPermViaRc({ bridgeSessionId: BID, toolUseId: 'toolu_bash00001', decision: 'allow', fetchImpl: f, auth: AUTH, readOpts: quick });
  assert.equal(ok.ok, true); assert.equal(ok.kind, 'perm'); assert.equal(ok.what, 'node -p 6*7');
  const post = f.calls.find((c) => c.method === 'POST');
  assert.equal(post.url, `${RC_API}/v1/code/sessions/cse_TESTxyz789/events`);
  const pl = JSON.parse(post.body).events[0].payload;
  assert.equal(pl.response.request_id, 'r1'); assert.deepEqual(pl.response.response.updatedInput, BASH); assert.ok(pl.uuid);
  assert.equal(post.headers.Authorization, 'Bearer tok-secret');
  // 위험: confirm 없으면 거절, 거부는 confirm 없이 됨
  f = fakeFetch(evs);
  await assert.rejects(answerPermViaRc({ bridgeSessionId: BID, toolUseId: 'toolu_rm0000001', decision: 'allow', fetchImpl: f, auth: AUTH, readOpts: quick }), (e) => e instanceof RcError && e.code === 'confirm');
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
  const rm = await answerPermViaRc({ bridgeSessionId: BID, toolUseId: 'toolu_rm0000001', decision: 'allow', confirm: true, fetchImpl: fakeFetch(evs), auth: AUTH, readOpts: quick });
  assert.deepEqual(rm.danger, ['delete']);
  f = fakeFetch(evs);
  await answerPermViaRc({ bridgeSessionId: BID, toolUseId: 'toolu_rm0000001', decision: 'deny', message: 'not now', fetchImpl: f, auth: AUTH, readOpts: quick });
  assert.equal(JSON.parse(f.calls.find((c) => c.method === 'POST').body).events[0].payload.response.response.message, 'not now');
  // 계획: 거부 + 피드백 · 종류 확인
  f = fakeFetch(evs);
  const pr = await answerPermViaRc({ bridgeSessionId: BID, toolUseId: 'toolu_plan00001', decision: 'deny', message: 'add step B', kind: 'plan', fetchImpl: f, auth: AUTH, readOpts: quick });
  assert.equal(pr.kind, 'plan');
  assert.deepEqual(JSON.parse(f.calls.find((c) => c.method === 'POST').body).events[0].payload.response.response, { behavior: 'deny', message: 'add step B', toolUseID: 'toolu_plan00001', toolName: 'ExitPlanMode' });
  await assert.rejects(answerPermViaRc({ bridgeSessionId: BID, toolUseId: 'toolu_plan00001', decision: 'allow', kind: 'perm', fetchImpl: fakeFetch(evs), auth: AUTH, readOpts: quick }), (e) => e.code === 'kind');
  await assert.rejects(answerPermViaRc({ bridgeSessionId: BID, toolUseId: 'toolu_done00001', decision: 'allow', fetchImpl: fakeFetch(evs), auth: AUTH, readOpts: quick }), (e) => e.code === 'not_pending');
  await assert.rejects(answerPermViaRc({ bridgeSessionId: BID, toolUseId: 'toolu_bash00001', decision: 'maybe', fetchImpl: fakeFetch(evs), auth: AUTH, readOpts: quick }), (e) => e.code === 'bad_pick');
  await assert.rejects(answerPermViaRc({ bridgeSessionId: BID, toolUseId: 'toolu_bash00001', decision: 'allow', fetchImpl: fakeFetch(evs, { postStatus: 500 }), auth: AUTH, readOpts: quick }), (e) => e.code === 'post');
});

// ── /interact/pending·/interact/perm(허브 직접) ──
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

test('/interact/pending·/interact/perm: 승인 기기만 · 열린 창 목록(캐시·minimal) · 허용/거부 → 감사 perm-answer · 실패 코드와 앱 링크 · Remote Control 없음 409 · 분당 상한', async () => {
  const home = tmp(), sessionsDir = path.join(home, 'sessions');
  fs.mkdirSync(sessionsDir);
  const SID = crypto.randomUUID();
  const rec = { pid: process.pid, sessionId: SID, kind: 'interactive', entrypoint: 'cli', name: 'probe', cwd: home, peerProtocol: 1, messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-' + 'a'.repeat(32), bridgeSessionId: BID, status: 'waiting', waitingFor: 'permission prompt' };
  fs.writeFileSync(path.join(sessionsDir, `${process.pid}.json`), JSON.stringify(rec));
  let t0 = Date.now();
  const lists = [], answers = [];
  let fail = null;
  const items = [permView({ toolUseId: 'toolu_bash00001', tool: 'Bash', input: BASH }), permView({ toolUseId: 'toolu_plan00001', tool: 'ExitPlanMode', input: PLAN })];
  const hub = new InteractHub({ store: new InteractStore({ home }), sessionsDir, projectsDir: home, now: () => t0, headless: async (rs) => { for (const r of rs) r.headless = false; return rs; },
    rcPerms: async (a) => { lists.push(a); if (fail) throw new RcError(fail); return items; },
    rcPerm: async (a) => { answers.push(a); if (fail) throw new RcError(fail); return { ok: true, tool: 'Bash', kind: 'perm', decision: a.decision, danger: [], what: 'node -p 6*7' }; }, log: () => {} });
  adminOp(hub.store, { op: 'on' });
  const d = newDevice();
  await call(hub, d, '/interact/register', { jwk: d.jwk });
  const body = { session: SID, toolUseId: 'toolu_bash00001', decision: 'allow', kind: 'perm' };
  assert.equal((await call(hub, d, '/interact/pending', { session: SID })).json.error, 'pending', '승인 전 목록');
  assert.equal((await call(hub, d, '/interact/perm', body)).json.error, 'pending', '승인 전 답');
  assert.equal(lists.length + answers.length, 0);
  assert.ok(hub.store.auditTail(5).some((x) => x.ev === 'reject'), '승인 전 시도 감사');
  adminOp(hub.store, { op: 'allow', who: d.id.slice(0, 8) });
  const pd = await call(hub, d, '/interact/pending', { session: SID });
  assert.equal(pd.status, 200); assert.equal(pd.json.items.length, 2); assert.equal(pd.json.link, 'https://claude.ai/code/' + BID);
  assert.deepEqual(lists[0], { bridgeSessionId: BID });
  await call(hub, d, '/interact/pending', { session: SID });
  assert.equal(lists.length, 1, '8초 안 같은 세션은 캐시');
  // minimal: 글 없이 종류·도구만
  hub.privacy = 'minimal'; t0 += 9000;
  const mn = await call(hub, d, '/interact/pending', { session: SID });
  assert.equal(mn.json.items[0].cmd, undefined); assert.equal(mn.json.items[1].md, undefined); assert.equal(mn.json.items[0].tool, 'Bash'); assert.equal(mn.json.items[0].minimal, 1);
  hub.privacy = 'summary';
  // 답
  const ok = await call(hub, d, '/interact/perm', body);
  assert.equal(ok.status, 200); assert.equal(ok.json.ok, true); assert.equal(ok.json.decision, 'allow');
  assert.deepEqual(answers[0], { bridgeSessionId: BID, toolUseId: 'toolu_bash00001', decision: 'allow', message: '', confirm: false, kind: 'perm' });
  const au = hub.store.auditTail(5).find((x) => x.ev === 'perm-answer');
  assert.equal(au.result, 'answered'); assert.equal(au.decision, 'allow'); assert.equal(au.tool, 'Bash'); assert.equal(au.preview, 'node -p 6*7'); assert.equal(au.session, SID);
  await call(hub, d, '/interact/perm', { ...body, decision: 'deny', message: 'no', confirm: true });
  assert.equal(answers[1].message, 'no'); assert.equal(answers[1].confirm, true);
  assert.equal(hub.store.auditTail(5).filter((x) => x.ev === 'perm-answer').pop().reason, 'no');
  for (const [code, st] of [['not_pending', 409], ['confirm', 400], ['kind', 409], ['auth', 502]]) {
    fail = code;
    const r = await call(hub, d, '/interact/perm', body);
    assert.equal(r.status, st, code); assert.equal(r.json.error, code); assert.equal(r.json.link, 'https://claude.ai/code/' + BID, '실패해도 앱 링크');
  }
  t0 += 9000;
  const pf = await call(hub, d, '/interact/pending', { session: SID });
  assert.equal(pf.status, 502); assert.equal(pf.json.error, 'auth');
  fail = null;
  assert.equal((await call(hub, d, '/interact/perm', { ...body, decision: 'always' })).status, 400, '항상 허용 같은 결정은 없음');
  assert.equal((await call(hub, d, '/interact/perm', { ...body, toolUseId: 'x' })).status, 400);
  // 분당 상한(답 = 보내기와 같은 10건, 목록 = 30건)
  hub.sends.clear(); hub.permReads.clear(); hub._pendCache.clear();
  let last;
  for (let i = 0; i <= SEND_PER_MIN; i++) last = await call(hub, d, '/interact/perm', body);
  assert.equal(last.status, 429);
  for (let i = 0; i <= PENDING_PER_MIN; i++) { last = await call(hub, d, '/interact/pending', { session: SID }); }
  assert.equal(last.status, 429);
  // Remote Control 없음 → 409(브리지 부르지 않음)
  hub.sends.clear(); hub.permReads.clear(); hub._pendCache.clear();
  const n = answers.length;
  fs.writeFileSync(path.join(sessionsDir, `${process.pid}.json`), JSON.stringify({ ...rec, bridgeSessionId: undefined }));
  assert.equal((await call(hub, d, '/interact/perm', body)).json.error, 'no_rc');
  assert.equal((await call(hub, d, '/interact/pending', { session: SID })).json.error, 'no_rc');
  assert.equal(answers.length, n);
});

test('브리지 429: 읽기·쓰기 → upstream_rate(Retry-After) · 허브는 물러나는 동안 브리지를 부르지 않고 503 + 앱 링크', async () => {
  const f429 = async () => new Response('slow down', { status: 429, headers: { 'retry-after': '90' } });
  await assert.rejects(listPermsViaRc({ bridgeSessionId: BID, fetchImpl: f429, auth: AUTH, readOpts: quick }), (e) => e.code === 'upstream_rate' && e.detail === 90);
  const home = tmp(), sessionsDir = path.join(home, 'sessions');
  fs.mkdirSync(sessionsDir);
  const SID = crypto.randomUUID();
  fs.writeFileSync(path.join(sessionsDir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: SID, kind: 'interactive', entrypoint: 'cli', name: 'probe', cwd: home, peerProtocol: 1, messagingSocketPath: '\\.\pipe\LOCAL\cc-msg-' + 'b'.repeat(32), bridgeSessionId: BID, status: 'waiting', waitingFor: 'permission prompt' }));
  let t0 = Date.now(), n = 0;
  const hub = new InteractHub({ store: new InteractStore({ home }), sessionsDir, projectsDir: home, now: () => t0, headless: async (rs) => { for (const r of rs) r.headless = false; return rs; },
    rcPerms: async () => { n++; throw new RcError('upstream_rate', 90); }, rcPerm: async () => { n++; return { ok: true }; }, rcAnswer: async () => { n++; return { ok: true, answers: {} }; }, log: () => {} });
  adminOp(hub.store, { op: 'on' });
  const d = newDevice();
  await call(hub, d, '/interact/register', { jwk: d.jwk });
  adminOp(hub.store, { op: 'allow', who: d.id.slice(0, 8) });
  const a = await call(hub, d, '/interact/pending', { session: SID });
  assert.equal(a.status, 503); assert.equal(a.json.error, 'upstream_rate'); assert.equal(n, 1);
  const b = await call(hub, d, '/interact/perm', { session: SID, toolUseId: 'toolu_bash00001', decision: 'allow' });
  assert.equal(b.status, 503); assert.equal(b.json.error, 'upstream_rate'); assert.equal(b.json.link, 'https://claude.ai/code/' + BID); assert.ok(b.json.retryIn > 60);
  const c = await call(hub, d, '/interact/ask', { session: SID, toolUseId: 'toolu_ask000001', picks: [{ q: 0, o: [0] }] });
  assert.equal(c.status, 503, '§148 질문창 답도 같이 물러남');
  assert.equal(n, 1, '물러나는 동안 브리지를 부르지 않음');
  assert.ok(hub.store.auditTail(5).some((x) => x.ev === 'perm-answer' && x.why === 'upstream_rate'));
  t0 += 91_000;
  hub.rcPerms = async () => { n++; return []; };
  // 서명 시각은 실제 시계 — 시계 차 상한 안이라 통과
  assert.equal((await call(hub, d, '/interact/pending', { session: SID })).status, 200);
});
