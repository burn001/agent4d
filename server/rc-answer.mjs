// 질문창에 Agent4D 화면에서 답하기 — Remote Control(claude.ai/code) 세션 브리지 경로.
// 이 PC 의 Claude Code 세션이 Remote Control 로 붙어 있으면(세션 기록 bridgeSessionId), 열린 AskUserQuestion 창은
// 세션 브리지에 control_request(can_use_tool) 로 올라가 있다. claude.ai 웹이 답하는 것과 같은 길로 control_response 를 보내면
// 터미널 창이 그 답으로 닫힌다(2026-11-06 시험 세션에서 실측). 터미널·Claude 앱에서 먼저 답하면 그쪽이 이기고, 여기서는 'not_pending'.
//
// 규약(Claude Code 2.1.318 번들의 SessionsV2Client·RemoteSessionManager 에서 읽음, 공개되지 않은 API — 바뀌면 깨질 수 있다):
//  · 읽기  GET  https://api.anthropic.com/v1/code/sessions/cse_<id>/events/stream?control_only=1   (text/event-stream, 처음부터 다시 보내 줌)
//  · 쓰기  POST https://api.anthropic.com/v1/code/sessions/cse_<id>/events   {events:[{payload:{type:'control_response', response:{subtype:'success',
//          request_id, response:{behavior:'allow', updatedInput:{...원래 input, answers:{질문문구: 라벨}}, toolUseID}}, uuid}}]}
//  · 머리  Authorization: Bearer <Claude OAuth access token> · anthropic-version 2023-06-01 · x-organization-uuid · Content-Type
//  · 자격  ~/.claude/.credentials.json claudeAiOauth.accessToken(만료면 쓰지 않음 — 갱신하지 않는다), 조직 = ~/.claude.json oauthAccount.organizationUuid
//          (macOS 처럼 자격이 키체인에만 있으면 no_auth → 화면은 「Claude 앱에서 답하기」 링크로)
// 토큰·머리는 어디에도(로그·감사·응답) 내지 않는다.
// 같은 길로 계획 승인(ExitPlanMode)·도구 권한 확인 창에도 답한다(listPermsViaRc·answerPermViaRc, 판정·본문은 rc-perm.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { claudeHome } from './discovery.mjs';
import { pendingPerms, permView, permResponse, dangerOf } from './rc-perm.mjs';

export const RC_API = 'https://api.anthropic.com';
export const RC_APP = 'https://claude.ai/code';
export const READ_MAX_MS = 6000;   // 이벤트 다시 받기 상한
export const READ_QUIET_MS = 900;  // 마지막 이벤트 뒤 이만큼 조용하면 다 받은 것으로
export const READ_MAX_BYTES = 8 << 20;
export const POST_TIMEOUT_MS = 10_000;
export const OTHER_MAX = 2000;     // '기타(직접 입력)' 한 칸 상한

export class RcError extends Error {
  constructor(code, detail) { super(code); this.code = code; if (detail != null) this.detail = detail; }
}

const ID_RE = /^(?:session|cse)_([A-Za-z0-9_-]{8,80})$/;
/** 세션 기록 bridgeSessionId(session_… | cse_…) → 브리지 id(cse_…) · 앱 링크. 모르는 꼴이면 null */
export const cseOf = (bid) => { const m = ID_RE.exec(String(bid || '')); return m ? `cse_${m[1]}` : null; };
export const rcLink = (bid) => { const m = ID_RE.exec(String(bid || '')); return m ? `${RC_APP}/session_${m[1]}` : null; };

/** 이 PC 의 Claude OAuth 자격(값은 돌려주되 출력 금지) — 없거나 만료면 RcError('no_auth') */
export function readOauth({ home = claudeHome(), userJson = path.join(os.homedir(), '.claude.json'), now = Date.now() } = {}) {
  let tok = null, exp = null, org = null;
  try { const c = JSON.parse(fs.readFileSync(path.join(home, '.credentials.json'), 'utf8'))?.claudeAiOauth; tok = typeof c?.accessToken === 'string' ? c.accessToken : null; exp = Number(c?.expiresAt) || null; } catch {}
  try { const j = JSON.parse(fs.readFileSync(userJson, 'utf8')); org = j?.oauthAccount?.organizationUuid || null; } catch {}
  if (!tok || !org) throw new RcError('no_auth');
  if (exp && exp < now + 30_000) throw new RcError('no_auth', 'expired');
  return { token: tok, org };
}

const headersOf = ({ token, org }) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-organization-uuid': org, 'User-Agent': 'agent4d-rc-answer' });

/** SSE 본문 조각들 → JSON 이벤트들(남은 꼬리 돌려줌) */
export function parseSse(buf) {
  const out = [];
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const blk = buf.slice(0, i); buf = buf.slice(i + 2);
    const data = blk.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data) continue;
    try { out.push(JSON.parse(data)); } catch {}
  }
  return { events: out, rest: buf };
}

/** 브리지 이벤트 다시 받기(제어 이벤트만). 조용해지거나 상한에 닿으면 끊는다 */
export async function readControlEvents(cse, auth, { fetchImpl = fetch, maxMs = READ_MAX_MS, quietMs = READ_QUIET_MS, maxBytes = READ_MAX_BYTES } = {}) {
  const ac = new AbortController();
  const hard = setTimeout(() => ac.abort(), maxMs);
  let quiet = null;
  const bump = () => { clearTimeout(quiet); quiet = setTimeout(() => ac.abort(), quietMs); };
  const events = [];
  try {
    let r;
    try { r = await fetchImpl(`${RC_API}/v1/code/sessions/${cse}/events/stream?control_only=1`, { headers: { ...headersOf(auth), Accept: 'text/event-stream' }, signal: ac.signal }); }
    catch (e) { throw new RcError(e?.name === 'AbortError' ? 'timeout' : 'network'); }
    if (r.status === 401 || r.status === 403) throw new RcError('auth', r.status);
    if (r.status === 404) throw new RcError('no_rc', 404);
    if (r.status === 429) throw new RcError('upstream_rate', retryAfterS(r)); // 브리지 읽기도 분당 상한이 있다(실측) — 물러난다
    if (!r.ok || !r.body) throw new RcError('stream', r.status);
    bump();
    const dec = new TextDecoder();
    const reader = r.body.getReader();
    const stop = () => { reader.cancel().catch(() => {}); }; // 끊으면 읽기를 바로 놓는다(본문이 신호를 모르는 경우도)
    ac.signal.addEventListener('abort', stop, { once: true });
    let buf = '', n = 0;
    try {
      while (!ac.signal.aborted) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        n += value.length;
        buf += dec.decode(value, { stream: true });
        const p = parseSse(buf); buf = p.rest;
        if (p.events.length) { events.push(...p.events); bump(); }
        if (n > maxBytes) break;
      }
    } catch (e) { if (e?.name !== 'AbortError' && !ac.signal.aborted) throw new RcError('stream', 'read'); }
    finally { ac.signal.removeEventListener('abort', stop); stop(); }
    return events;
  } finally { clearTimeout(hard); clearTimeout(quiet); try { ac.abort(); } catch {} }
}

/** 이벤트들 → 아직 답 없는 AskUserQuestion 요청(tool_use_id → {requestId, input}) */
export function pendingAsks(events) {
  const reqs = new Map(); const done = new Set();
  for (const e of events || []) {
    const p = e && typeof e === 'object' ? (e.payload && typeof e.payload === 'object' ? e.payload : e) : null;
    if (!p) continue;
    if (p.type === 'control_request' && typeof p.request_id === 'string' && p.request?.subtype === 'can_use_tool' && p.request.tool_name === 'AskUserQuestion') reqs.set(p.request_id, p.request);
    else if (p.type === 'control_response' && typeof p.response?.request_id === 'string') done.add(p.response.request_id);
    else if (p.type === 'control_cancel_request' && typeof p.request_id === 'string') done.add(p.request_id);
  }
  const out = new Map();
  for (const [rid, rq] of reqs) {
    if (done.has(rid) || !rq.input || !Array.isArray(rq.input.questions)) continue;
    out.set(String(rq.tool_use_id || ''), { requestId: rid, input: rq.input, toolUseId: rq.tool_use_id || null });
  }
  return out;
}

/**
 * 화면에서 고른 것 → answers(질문 문구 → 답 글). 질문 문구·라벨은 브리지 요청의 원래 input 에서 가져온다(카드 글은 잘렸을 수 있음).
 * picks = [{q:질문 번호, o:[선택지 번호…], other?:직접 입력}] — 단일 선택은 하나(직접 입력이 있으면 그것), 복수는 라벨들 + 직접 입력을 ', ' 로
 * 모든 질문에 답이 있어야 한다(없으면 RcError('incomplete'))
 */
export function buildAnswers(input, picks) {
  const qs = Array.isArray(input?.questions) ? input.questions : [];
  if (!qs.length) throw new RcError('bad_pick', 'no_questions');
  const by = new Map();
  for (const p of Array.isArray(picks) ? picks : []) if (p && Number.isInteger(p.q)) by.set(p.q, p);
  const answers = {};
  qs.forEach((q, qi) => {
    const p = by.get(qi) || {};
    const opts = Array.isArray(q.options) ? q.options : [];
    const idx = [...new Set((Array.isArray(p.o) ? p.o : []).filter((j) => Number.isInteger(j) && j >= 0 && j < opts.length))].sort((a, b) => a - b);
    const other = typeof p.other === 'string' ? p.other.replace(/\r\n/g, '\n').trim().slice(0, OTHER_MAX) : '';
    let a;
    if (q.multiSelect) a = [...idx.map((j) => opts[j].label), ...(other ? [other] : [])].join(', ');
    else a = other || (idx.length ? opts[idx[0]].label : '');
    if (!a) throw new RcError('incomplete', qi);
    answers[q.question] = a;
  });
  return answers;
}

/**
 * 답 보내기: 브리지에서 그 tool_use 의 열린 요청을 찾아 answers 를 채운 allow 를 보낸다.
 * @returns {{ok:true, requestId, answers}}  실패는 RcError(code: no_rc·no_auth·auth·not_pending·incomplete·bad_pick·stream·network·timeout·post)
 */
export async function answerViaRc({ bridgeSessionId, toolUseId, picks, fetchImpl = fetch, auth = null, readOpts = {} }) {
  const cse = cseOf(bridgeSessionId);
  if (!cse) throw new RcError('no_rc');
  const a = auth || readOauth();
  const evs = await readControlEvents(cse, a, { fetchImpl, ...readOpts });
  const pend = pendingAsks(evs);
  const hit = pend.get(String(toolUseId || ''));
  if (!hit) throw new RcError('not_pending', pend.size);
  const answers = buildAnswers(hit.input, picks);
  await postControl(cse, a, { type: 'control_response', response: { subtype: 'success', request_id: hit.requestId, response: { behavior: 'allow', updatedInput: { ...hit.input, answers }, ...(hit.toolUseId ? { toolUseID: hit.toolUseId } : {}) } } }, { fetchImpl });
  return { ok: true, requestId: hit.requestId, answers };
}

/** 브리지에 control_response 하나 올리기(uuid 붙임). 실패는 RcError(auth·post·network·timeout) */
export async function postControl(cse, auth, payload, { fetchImpl = fetch } = {}) {
  const ac = new AbortController();
  const tm = setTimeout(() => ac.abort(), POST_TIMEOUT_MS);
  let r;
  try { r = await fetchImpl(`${RC_API}/v1/code/sessions/${cse}/events`, { method: 'POST', headers: headersOf(auth), body: JSON.stringify({ events: [{ payload: { ...payload, uuid: crypto.randomUUID() } }] }), signal: ac.signal }); }
  catch (e) { throw new RcError(e?.name === 'AbortError' ? 'timeout' : 'network'); }
  finally { clearTimeout(tm); }
  if (r.status === 401 || r.status === 403) throw new RcError('auth', r.status);
  if (r.status === 429) throw new RcError('upstream_rate', retryAfterS(r));
  if (!r.ok) throw new RcError('post', r.status);
}
/** 429 Retry-After(초) — 없거나 이상하면 60 */
export const retryAfterS = (r) => { const v = Number(r?.headers?.get?.('retry-after')); return Number.isFinite(v) && v > 0 && v < 3600 ? Math.ceil(v) : 60; };

// ── 계획 승인·도구 권한 확인 창 ──
/** 열린 계획·권한 요청 목록(화면 카드 모양 — permView). 실패는 RcError */
export async function listPermsViaRc({ bridgeSessionId, fetchImpl = fetch, auth = null, readOpts = {} }) {
  const cse = cseOf(bridgeSessionId);
  if (!cse) throw new RcError('no_rc');
  const a = auth || readOauth();
  const evs = await readControlEvents(cse, a, { fetchImpl, ...readOpts });
  return [...pendingPerms(evs).values()].map(permView);
}

/**
 * 허용·거부 보내기. 위험 명령(dangerOf) 허용은 confirm:true 가 있어야 한다(화면의 두 번 누르기를 서버도 확인).
 * kind 를 주면('plan'|'perm') 열린 요청 종류가 같아야 한다(카드가 가리킨 창이 아니면 보내지 않음).
 * @returns {{ok:true, requestId, tool, decision, danger}}  실패는 RcError(no_rc·no_auth·auth·not_pending·kind·confirm·bad_pick·stream·network·timeout·post)
 */
export async function answerPermViaRc({ bridgeSessionId, toolUseId, decision, message = '', confirm = false, kind = null, fetchImpl = fetch, auth = null, readOpts = {} }) {
  if (decision !== 'allow' && decision !== 'deny') throw new RcError('bad_pick', 'decision');
  const cse = cseOf(bridgeSessionId);
  if (!cse) throw new RcError('no_rc');
  const a = auth || readOauth();
  const evs = await readControlEvents(cse, a, { fetchImpl, ...readOpts });
  const pend = pendingPerms(evs);
  const hit = pend.get(String(toolUseId || ''));
  if (!hit) throw new RcError('not_pending', pend.size);
  const k = hit.tool === 'ExitPlanMode' ? 'plan' : 'perm';
  if (kind && kind !== k) throw new RcError('kind', k);
  const danger = k === 'perm' ? dangerOf(hit.tool, hit.input) : [];
  if (decision === 'allow' && danger.length && confirm !== true) throw new RcError('confirm', danger.join(','));
  await postControl(cse, a, permResponse(hit, decision, message), { fetchImpl });
  return { ok: true, requestId: hit.requestId, tool: hit.tool, kind: k, decision, danger, what: whatOf(hit) };
}
/** 감사용 한 줄(명령·경로·URL) — 호출하는 쪽이 다시 가림·자름 */
const whatOf = (hit) => { const v = permView(hit); return v.cmd || v.path || v.url || (v.kind === 'plan' ? 'plan' : v.json || ''); };
