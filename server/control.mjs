// 화면 원격 조작: 서버를 띄운 PC 의 CLI(`agent4d ctl …`)가 보낸 명령을 열려 있는 화면들에 전달하고 적용 결과(ack)를 모은다.
//  · 화면 → 서버: 기존 SSE(/events, 단일·전체 범위)에 client·cname 을 붙여 연결하면 등록. 재생 중처럼 데이터 SSE 가 없을 때는 /control/events(명령 전용 SSE)
//  · 서버 → 화면: SSE 이벤트 `ctl-hello {id, name, remote}`(등록 직후) · `control {id, cmd, args, temp, ts}`
//  · 화면 → 서버: POST /control/ack (보기 토큰 인증) {client, cmdId?, ok, error?, detail?, pendingGesture?, state?, name?}
//  · 보내기: POST /control · 목록: GET /control/clients — **로컬 관리자만**(isLocalAdmin: 루프백 소켓 + 프록시 표지 없음 + 브라우저 표지 없음 + adminSecret Bearer)
// 연결이 끊긴 화면에 보낸 명령은 버린다(재연결 때 재생하지 않음). 로그에는 명령 종류·화면 수만 남긴다(값 없음).
import crypto from 'node:crypto';
import { safeEqual } from './auth.mjs';
import { formatEvent } from './sse.mjs';
import { normalizeCmd, matchProject, matchSession, matchClients, CLIENT_ID_RE, cleanName } from '../web/control-core.mjs';

const ACK_WAIT_DEFAULT = 8000; // 저사양·헤드리스에서 표현 전환·재개(상태 다시 받기)가 4초를 넘는 일이 있었다
const ACK_WAIT_MAX = 20000;
const BODY_MAX = 16 * 1024;

/** 루프백 소켓 주소(127.0.0.0/8 · ::1 · ::ffff:127.x) */
export function isLoopbackAddr(a) {
  const s = String(a || '').toLowerCase();
  return s === '::1' || /^127\./.test(s) || /^::ffff:127\./.test(s);
}

/**
 * 프록시(릴레이·cloudflared·Worker)를 거친 요청의 표지. 하나라도 있으면 원격 경유로 본다.
 *  - x-agent4d-relay: bin/relay.mjs 가 붙임(들어온 같은 헤더는 지우고 다시 붙임)
 *  - cf-*: cloudflared 가 origin 요청에 붙임(Cf-Connecting-Ip·Cf-Ray·Cf-Visitor…), cdn-loop: Cloudflare
 *  - x-forwarded-*, forwarded, x-real-ip: cloudflared·Worker(X-Forwarded-Proto/Host)·일반 프록시
 *  - x-ccviz-token: Worker 가 origin 요청에 늘 붙임(CLI 는 보내지 않음)
 */
export const PROXY_MARKERS = ['x-agent4d-relay', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-ipcountry', 'cf-worker', 'cf-ew-via', 'cdn-loop',
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip', 'x-ccviz-token'];
export function proxyMarkers(req) {
  const h = req?.headers || {};
  return PROXY_MARKERS.filter((k) => h[k] != null);
}
const isLocalHostHeader = (host) => /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])(:\d+)?$/i.test(String(host || ''));

/** 화면이 원격(터널·Worker·릴레이 경유)으로 붙었나 — 목록 표시용 */
export function remoteOf(req) {
  return proxyMarkers(req).length > 0 || !isLoopbackAddr(req?.socket?.remoteAddress) || !isLocalHostHeader(req?.headers?.host);
}

/**
 * 명령을 보낼 자격(로컬 관리자). 넷 다 맞아야 한다:
 *  ① 소켓 주소가 루프백 ② Host 가 루프백 이름(DNS 리바인딩 차단) ③ 프록시 표지 없음(릴레이도 127.0.0.1 에서 붙으므로 ①만으론 부족)
 *  ④ 브라우저 표지(Origin·Sec-Fetch-Site) 없음 — 로컬 웹 페이지의 CSRF 차단, CLI 는 보내지 않음 ⑤ Authorization: Bearer <adminSecret>
 * @returns {{ok:true}|{ok:false, status:number, reason:string}}
 */
export function checkLocalAdmin(req, adminSecret) {
  if (!adminSecret) return { ok: false, status: 503, reason: 'no_admin_secret' };
  if (!isLoopbackAddr(req.socket?.remoteAddress)) return { ok: false, status: 404, reason: 'not_loopback' };
  if (!isLocalHostHeader(req.headers.host)) return { ok: false, status: 404, reason: 'bad_host' };
  const pm = proxyMarkers(req);
  if (pm.length) return { ok: false, status: 404, reason: 'proxied' };
  if (req.headers.origin != null || req.headers['sec-fetch-site'] != null) return { ok: false, status: 403, reason: 'browser' };
  const m = /^Bearer\s+(.+)$/.exec(String(req.headers.authorization || ''));
  if (!m || !safeEqual(m[1].trim(), adminSecret)) return { ok: false, status: 401, reason: 'unauthorized' };
  return { ok: true };
}

export function readBody(req, max = BODY_MAX) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(Object.assign(new Error('too large'), { code: 'E2BIG' })); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(n ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(Object.assign(e, { code: 'EJSON' })); } });
    req.on('error', reject);
  });
}

const newId = () => crypto.randomBytes(6).toString('base64url');

/** 화면 등록·명령 전달·ack 모으기 */
export class ControlHub {
  /**
   * @param {{ manager?: object, log?: (msg:string)=>void, now?: ()=>number }} o
   */
  constructor({ manager = null, log = (m) => console.error(m), now = Date.now } = {}) {
    this.manager = manager;
    this.log = log;
    this.now = now;
    this.clients = new Map(); // id → { id, name, autoName, remote, conns: [{write, seq}], connectedAt, lastSeen, state }
    this.pending = new Map(); // cmdId → { targets:Set, results:Map, done, timer }
    this._seq = 0;
  }

  /** SSE 응답 하나를 화면으로 등록(이미 SSE 헤더를 쓴 뒤). 돌려준 함수 = 해제 */
  attach(req, res, url) {
    const id = url.searchParams.get('client');
    if (!id || !CLIENT_ID_RE.test(id)) return () => {};
    if (!res.headersSent || res.writableEnded || res.statusCode !== 200) return () => {}; // SSE 가 열렸을 때만(404·401 JSON 은 이미 끝남)
    const name = cleanName(url.searchParams.get('cname')) || null;
    const remote = remoteOf(req);
    const t = this.now();
    let c = this.clients.get(id);
    if (!c) { c = { id, name, remote, conns: [], connectedAt: new Date(t).toISOString(), lastSeen: t, state: null }; this.clients.set(id, c); }
    if (name) c.name = name;
    c.remote = remote;
    c.lastSeen = t;
    const conn = { seq: ++this._seq, write: (s) => { if (!res.writableEnded && !res.destroyed) res.write(s); } };
    c.conns.push(conn);
    conn.write(formatEvent('ctl-hello', { id, name: c.name, remote }));
    let gone = false;
    const off = () => {
      if (gone) return;
      gone = true;
      const cur = this.clients.get(id);
      if (!cur) return;
      cur.conns = cur.conns.filter((x) => x !== conn);
      if (!cur.conns.length) {
        this.clients.delete(id);
        // 기다리던 명령: 끊김으로 끝냄(재연결 때 재생하지 않음)
        for (const p of this.pending.values()) if (p.targets.has(id) && !p.results.has(id)) { p.results.set(id, { ok: false, error: 'disconnected' }); this._check(p); }
      }
    };
    req.on('close', off);
    res.on('error', off);
    return off;
  }

  /** 지금 화면 목록(관리자 응답용) */
  list() {
    return [...this.clients.values()].map((c) => ({
      id: c.id, name: c.name || null, remote: !!c.remote, connections: c.conns.length,
      connectedAt: c.connectedAt, lastSeenAt: new Date(c.lastSeen).toISOString(), lastSeenSec: Math.max(0, Math.round((this.now() - c.lastSeen) / 1000)),
      state: c.state,
    }));
  }

  /** POST /control/ack 본문 처리. 모르는 화면·명령이면 false */
  ack(body) {
    const id = body && typeof body.client === 'string' ? body.client : null;
    const c = id && this.clients.get(id);
    if (!c) return false;
    c.lastSeen = this.now();
    if (body.state && typeof body.state === 'object') c.state = sanitizeState(body.state);
    if (body.name != null) { const n = cleanName(body.name); if (n) c.name = n; }
    if (!body.cmdId) return true;
    const p = this.pending.get(String(body.cmdId));
    if (!p || !p.targets.has(id)) return false;
    p.results.set(id, { ok: !!body.ok, error: body.ok ? undefined : String(body.error || 'failed').slice(0, 40),
      detail: body.detail != null ? String(body.detail).slice(0, 200) : undefined, pendingGesture: body.pendingGesture ? true : undefined });
    this._check(p);
    return true;
  }

  _check(p) {
    if (p.done || p.results.size < p.targets.size) return;
    p.finish();
  }

  /** 프로젝트·세션 이름 해석(scope·visible·replay). 실패면 {ok:false, error, candidates} */
  async resolve(n) {
    const a = n.args;
    const target = a.target;
    if (!target && !(n.cmd === 'replay')) return { ok: true, cmd: n.cmd, args: a };
    if (n.cmd === 'replay') {
      if (['current', 'auto', 'now'].includes(String(a.session).toLowerCase())) return { ok: true, cmd: n.cmd, args: { ...a, session: 'current' } };
      const r = await this._session(a.session);
      return r.ok ? { ok: true, cmd: n.cmd, args: { ...a, session: r.session.sessionId } } : r;
    }
    if (target.kind === 'all') return { ok: true, cmd: n.cmd, args: n.cmd === 'scope' ? { scope: 'all' } : { action: 'all' } };
    if (target.kind === 'project') {
      const projects = await this._projects();
      const r = matchProject(projects, target.q);
      if (!r.ok) return r;
      const base = { projectId: r.project.projectId, name: r.project.name };
      return { ok: true, cmd: n.cmd, args: n.cmd === 'scope' ? { scope: 'project', ...base } : { action: a.action, ...base } };
    }
    const r = await this._session(target.q);
    if (!r.ok) return r;
    const s = r.session;
    const base = { sessionId: s.sessionId, projectId: s.projectId || null, name: s.title || null };
    return { ok: true, cmd: n.cmd, args: n.cmd === 'scope' ? { scope: 'session', ...base } : { action: a.action, ...base } };
  }

  async _projects() {
    const m = this.manager;
    if (!m || !m.projectList) return [];
    try { const out = await m.projectList({ inactive: true }); return out?.projects || []; } catch { return []; }
  }
  async _session(q) {
    const projects = await this._projects();
    const pool = [];
    for (const p of projects) for (const s of [...(p.liveList || []), ...(p.recentList || [])]) pool.push({ sessionId: s.sessionId, title: s.title || null, projectId: p.projectId });
    if (this.manager?.list) {
      try { for (const s of await this.manager.list(200, { extended: true })) pool.push({ sessionId: s.sessionId, title: s.title || null, projectId: s.projectDir || null }); } catch { /* 목록 없음 */ }
    }
    return matchSession(pool, q);
  }

  /**
   * 명령 보내기: 검사 → 이름 해석 → 대상 화면에 control 이벤트 → ack 를 waitMs 까지 기다림.
   * @returns {Promise<object>} {ok, cmd, args, sent, results:[{client,name,ok,error?,detail?,pendingGesture?}]} | {ok:false, error, …}
   */
  async send({ cmd, args, client = null, temp = false, waitMs = ACK_WAIT_DEFAULT } = {}) {
    const n0 = normalizeCmd(cmd, args);
    if (!n0.ok) return n0;
    const n = await this.resolve(n0);
    if (!n.ok) return { ...n, cmd: n0.cmd };
    const all = [...this.clients.values()];
    if (!all.length) { this.log(`[ccviz] control ${n.cmd}: no screens`); return { ok: false, error: 'no_clients', cmd: n.cmd, args: n.args, sent: 0, results: [] }; }
    const targets = matchClients(all, client);
    if (!targets.length) return { ok: false, error: 'no_match', cmd: n.cmd, sent: 0, results: [], clients: this.list().map(({ id, name }) => ({ id, name })) };
    const cmdId = newId();
    const wait = Math.max(200, Math.min(ACK_WAIT_MAX, Number(waitMs) || ACK_WAIT_DEFAULT));
    const p = { targets: new Set(targets.map((c) => c.id)), results: new Map(), done: false };
    const finished = new Promise((resolve) => {
      p.finish = () => { if (p.done) return; p.done = true; clearTimeout(p.timer); this.pending.delete(cmdId); resolve(); };
      p.timer = setTimeout(p.finish, wait);
    });
    this.pending.set(cmdId, p);
    const ev = formatEvent('control', { id: cmdId, cmd: n.cmd, args: n.args, temp: !!temp, ts: new Date(this.now()).toISOString() });
    for (const c of targets) { const conn = c.conns[c.conns.length - 1]; if (conn) conn.write(ev); } // 같은 화면이 잠깐 둘 이상 붙어 있으면(범위 전환 중) 가장 새 연결로
    await finished;
    const results = targets.map((c) => ({ client: c.id, name: c.name || null, ...(p.results.get(c.id) || { ok: false, error: 'timeout' }) }));
    const okN = results.filter((r) => r.ok).length;
    this.log(`[ccviz] control ${n.cmd} → ${okN}/${results.length}`); // 종류·수만(값 없음)
    return { ok: okN > 0, cmd: n.cmd, args: n.args, sent: targets.length, applied: okN, results };
  }
}

/** 화면이 알려 온 상태: 아는 키만, 짧게 */
const STATE_KEYS = ['view', 'dim', 'theme', 'themeResolved', 'scope', 'scopeLabel', 'sound', 'soundStatus', 'paused', 'replaying', 'replaySession', 'lang', 'accept', 'panel', 'artifacts', 'plans', 'grid', 'weather', 'noise', 'camera', 'camMode', 'mode', 'size'];
export function sanitizeState(s) {
  const out = {};
  for (const k of STATE_KEYS) {
    const v = s[k];
    if (v == null) continue;
    if (typeof v === 'boolean' || typeof v === 'number') out[k] = v;
    else out[k] = String(v).slice(0, 120);
  }
  return out;
}

/**
 * HTTP 라우트(index.mjs 가 인증 앞에서 부름). 처리했으면 true.
 *  POST /control           관리자: {cmd, args, client?, temp?, wait?}
 *  GET  /control/clients   관리자: {clients}
 *  POST /control/ack       보기 토큰(checkAuth 통과 뒤 — authOk 로 받음)
 */
export async function handleControlAdmin(req, res, url, hub, { adminSecret, sendJson, SEC }) {
  const p = url.pathname;
  if (p !== '/control' && p !== '/control/clients') return false;
  const gate = checkLocalAdmin(req, adminSecret);
  if (!gate.ok) {
    // 원격 경유·브라우저는 존재 자체를 드러내지 않게 404(로컬 CLI 의 인증 실패만 401)
    sendJson(res, gate.status, { error: gate.status === 404 ? 'not_found' : gate.reason }, SEC);
    return true;
  }
  if (p === '/control/clients') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method' }, SEC); return true; }
    sendJson(res, 200, { clients: hub.list() }, SEC);
    return true;
  }
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'method' }, SEC); return true; }
  let body;
  try { body = await readBody(req); } catch (e) { sendJson(res, e.code === 'E2BIG' ? 413 : 400, { error: e.code === 'E2BIG' ? 'too_large' : 'bad_json' }, SEC); return true; }
  const out = await hub.send({ cmd: body.cmd, args: body.args || {}, client: body.client ?? null, temp: !!body.temp, waitMs: body.wait });
  sendJson(res, 200, out, SEC);
  return true;
}
