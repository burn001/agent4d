// Interactive 패널 서버 쪽: 승인된 기기만 화면에서 고른 활성 Claude Code 세션에 메시지를 넣고, 그 세션의 응답을 본다.
//  · 기능 전체 기본 꺼짐(<상태 폴더>/interact/settings.json enabled). 꺼져 있으면 /interact/status 말고는 403 disabled
//  · 모든 /interact/* 는 보기 토큰(checkAuth) 뒤. 그 위에 기기 서명:
//      브라우저가 만든 ECDSA P-256 키(개인키는 내보낼 수 없는 CryptoKey 로 IndexedDB 에만) — 서버는 공개키(JWK)만 안다
//      헤더 x-a4d-device(기기 id = 공개키 지문) · x-a4d-ts(ms) · x-a4d-nonce · x-a4d-sig(base64url, P1363 r‖s)
//      서명 대상 = "A4D-IX1\nPOST\n<경로>\n<ts>\n<nonce>\n<sha256(본문) hex>" — 시각 ±120초, nonce 는 10분 안 재사용 금지
//  · 승인: 처음 여는 기기는 '승인 대기'(별칭 자동). 이 PC 의 `agent4d interact allow <별칭|id>` 로만 승인(관리 경로는 로컬 관리자 전용)
//  · 감사: 등록·승인·취소·보냄·거절을 <상태 폴더>/interact/audit.jsonl 에(보낸 글은 앞 80자만, 가림 적용)
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { InteractStore, publicClient, deviceIdOf } from './interact-store.mjs';
import { listPeerSessions, findPeerSession, checkTarget, sendToSession, readFeed, transcriptOf, holdLikely, fromNameOf, withNotice, markHeadless, TEXT_MAX, PeerError } from './interact-peer.mjs';
import { checkLocalAdmin, remoteOf } from './control.mjs';
import { redact } from './redact.mjs';
import { cliLang } from './cli-i18n.mjs';
import { SIG_PREFIX, signingString } from '../web/interact-core.mjs'; // 서명 대상(화면과 같은 함수)
import { feedFull } from './md-full.mjs';
import { recordWait } from '../web/wait-core.mjs'; // 입력 대기(세션 기록 status 'waiting')
import { answerViaRc, rcLink, RcError, listPermsViaRc, answerPermViaRc } from './rc-answer.mjs'; // 질문창에 답하기 · 계획 승인·권한 확인 창(Remote Control 브리지)

export { SIG_PREFIX, signingString };
export const TS_SKEW_MS = 120_000;
export const NONCE_TTL_MS = 600_000;
export const SEND_PER_MIN = 10;
export const PENDING_PER_MIN = 30; // 열린 계획·권한 창 읽기(브리지 다시 받기) — 기기마다
export const PENDING_CACHE_MS = 8000; // 같은 세션을 여러 화면·잦은 새로 고침이 물어도 브리지는 8초에 한 번(브리지 읽기에도 분당 상한 — 실측 429)
export const UPSTREAM_BACKOFF_MS = 60_000; // 브리지가 429 를 주면 이만큼(또는 Retry-After) 브리지를 부르지 않는다
export const PERM_WAIT = 'permission prompt'; // 세션 기록 waitingFor — 계획 승인·도구 권한 창(2.1.318 실측)
const BODY_MAX = 32 * 1024;

export const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function readRaw(req, max = BODY_MAX) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(Object.assign(new Error('too large'), { code: 'E2BIG' })); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** ECDSA P-256 서명 확인(P1363) */
export function verifySig(jwk, data, sigB64u) {
  try {
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
    const sig = Buffer.from(String(sigB64u || ''), 'base64url');
    if (sig.length !== 64) return false;
    return crypto.verify('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }, sig);
  } catch { return false; }
}

const preview = (s) => redact(String(s || '')).replace(/\s+/g, ' ').trim().slice(0, 80);

export class InteractHub {
  constructor({ store = new InteractStore(), index = null, project = null, sessionsDir = null, projectsDir = null, now = Date.now, send = sendToSession, log = (m) => console.error(m), privacy = 'summary', headless = markHeadless, rcAnswer = answerViaRc, rcPerms = listPermsViaRc, rcPerm = answerPermViaRc } = {}) {
    this.rcAnswer = rcAnswer; // 시험은 바꿔 끼움
    this.rcPerms = rcPerms; this.rcPerm = rcPerm; this.permReads = new Map(); this._pendCache = new Map(); this._upUntil = 0; // (_upUntil = 브리지 429 뒤 물러나는 끝 시각)
    this.privacy = privacy; // 실황과 같은 프라이버시(minimal 이면 글·이름 없이 모양만)
    this.headless = headless; // -p·SDK 세션 판정(시험은 바꿔 끼움)
    this.store = store;
    this.index = index;
    this.project = project;
    this.sessionsDir = sessionsDir;
    this.projectsDir = projectsDir;
    this.now = now;
    this.send = send;
    this.log = log;
    this.nonces = new Map(); // nonce → 만료 시각
    this.sends = new Map(); // 기기 id → [보낸 시각…] (분당 상한)
  }

  _nonceOk(n) {
    const t = this.now();
    if (this.nonces.size > 4096) for (const [k, exp] of this.nonces) if (exp < t) this.nonces.delete(k);
    const exp = this.nonces.get(n);
    if (exp && exp >= t) return false;
    this.nonces.set(n, t + NONCE_TTL_MS);
    return true;
  }

  /**
   * 서명 확인 → {ok:true, id} | {ok:false, status, error}. jwk 를 주면(등록) 그 키로, 아니면 저장된 기기 키로
   */
  verify(req, pathname, raw, { jwk = null } = {}) {
    const h = req.headers;
    const id = String(h['x-a4d-device'] || ''), ts = Number(h['x-a4d-ts']), nonce = String(h['x-a4d-nonce'] || ''), sig = h['x-a4d-sig'];
    if (!/^[0-9a-f]{20}$/.test(id) || !Number.isFinite(ts) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || typeof sig !== 'string') return { ok: false, status: 401, error: 'no_sig' };
    const key = jwk || this.store.get(id)?.jwk;
    if (!key) return { ok: false, status: 403, error: 'unknown_device' };
    if (jwk && deviceIdOf(jwk) !== id) return { ok: false, status: 401, error: 'bad_sig' };
    if (Math.abs(this.now() - ts) > TS_SKEW_MS) return { ok: false, status: 401, error: 'stale' };
    if (!verifySig(key, signingString('POST', pathname, ts, nonce, sha256hex(raw)), sig)) return { ok: false, status: 401, error: 'bad_sig' };
    if (!this._nonceOk(nonce)) return { ok: false, status: 401, error: 'replay' };
    return { ok: true, id };
  }

  _inProject(sid) {
    if (!this.project) return true;
    const e = this.index?.findSession?.(sid);
    return !!e && e.projectDir === this.project;
  }

  /** 승인 기기에게 보여 줄 세션 목록 — 헤드리스(-p·SDK) 세션은 headless:true · ready:false(보내기 막음, 화면은 따로 묶음) */
  async sessions() {
    const out = [];
    const recs = listPeerSessions({ sessionsDir: this.sessionsDir });
    try { await this.headless(recs); } catch {}
    for (const r of recs) {
      if (!this._inProject(r.sessionId)) continue;
      const file = transcriptOf(r.sessionId, { index: this.index, projectsDir: this.projectsDir });
      const mode = file ? modeOf(file) : null;
      const e = this.index?.findSession?.(r.sessionId);
      out.push({ sessionId: r.sessionId, name: r.name, project: r.cwd ? path.basename(r.cwd) : null, kind: r.kind, status: r.status,
        title: e?.title || null, mode, holdLikely: holdLikely(mode), headless: r.headless === true, ...(recordWait(r) ? { wait: recordWait(r) } : {}), ...(r.unverified && r.headless !== true ? { unverified: true } : {}), ready: r.headless !== true && !checkTarget(r, { sessionsDir: this.sessionsDir }),
        ...(r.bridgeSessionId && r.headless !== true ? { remote: rcLink(r.bridgeSessionId) } : {}) });
    }
    return out.sort((a, b) => String(a.project || '').localeCompare(String(b.project || '')) || String(a.name || '').localeCompare(String(b.name || '')));
  }

  /** 브리지가 429 를 줬으면 물러남 시작 */
  _upNote(e) { if (e instanceof RcError && e.code === 'upstream_rate') this._upUntil = this.now() + Math.max(UPSTREAM_BACKOFF_MS, (Number(e.detail) || 0) * 1000); }
  /** 물러나는 중이면 503 upstream_rate(브리지를 부르지 않음) */
  _upBusy(res, sendJson, headers, link, before = null) {
    const left = this._upUntil - this.now();
    if (left <= 0) return false;
    if (before) before();
    sendJson(res, 503, { error: 'upstream_rate', retryIn: Math.ceil(left / 1000), ...(link ? { link } : {}) }, { ...headers, 'Retry-After': String(Math.ceil(left / 1000)) });
    return true;
  }
  _rate(id, map = this.sends, max = SEND_PER_MIN) {
    const t = this.now();
    const arr = (map.get(id) || []).filter((x) => t - x < 60_000);
    if (arr.length >= max) { map.set(id, arr); return false; }
    arr.push(t); map.set(id, arr);
    return true;
  }

  /** POST /interact/* 처리(보기 토큰 통과 뒤). 처리했으면 true */
  async handle(req, res, url, { sendJson, headers }) {
    const p = url.pathname;
    if (!p.startsWith('/interact/') || p === '/interact/admin') return false;
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method' }, headers); return true; }
    let raw;
    try { raw = await readRaw(req); } catch (e) { sendJson(res, e.code === 'E2BIG' ? 413 : 400, { error: e.code === 'E2BIG' ? 'too_large' : 'bad_body' }, headers); return true; }
    let body = {};
    try { body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { sendJson(res, 400, { error: 'bad_json' }, headers); return true; }
    const remote = remoteOf(req);
    const enabled = this.store.enabled();
    const base = { enabled, serverTime: this.now() };

    if (p === '/interact/status') {
      if (!enabled || !req.headers['x-a4d-device']) { sendJson(res, 200, { ...base, device: null }, headers); return true; }
      const v = this.verify(req, p, raw);
      if (!v.ok) { sendJson(res, 200, { ...base, device: null, why: v.error }, headers); return true; }
      this.store.touch(v.id, { remote });
      sendJson(res, 200, { ...base, device: publicClient(this.store.get(v.id)) }, headers);
      return true;
    }
    if (!enabled) { sendJson(res, 403, { ...base, error: 'disabled' }, headers); return true; }

    if (p === '/interact/register') {
      const jwk = body.jwk;
      if (!deviceIdOf(jwk)) { sendJson(res, 400, { error: 'bad_key' }, headers); return true; }
      const v = this.verify(req, p, raw, { jwk });
      if (!v.ok) { sendJson(res, v.status, { error: v.error }, headers); return true; }
      let r;
      try { r = this.store.register(jwk, { remote, ua: req.headers['user-agent'] }); } catch (e) {
        this.log(`[interact] register failed: ${e?.code || e?.message}`);
        sendJson(res, 500, { error: 'store' }, headers); return true;
      }
      if (r.created) this.store.audit({ ev: 'register', device: r.client.id, alias: r.client.alias?.en, remote });
      sendJson(res, 200, { ...base, device: publicClient(r.client) }, headers);
      return true;
    }

    const v = this.verify(req, p, raw);
    if (!v.ok) { sendJson(res, v.status, { error: v.error }, headers); return true; }
    const dev = this.store.get(v.id);
    if (!dev || dev.status !== 'allowed') {
      if (p === '/interact/send' || p === '/interact/ask' || p === '/interact/perm') this.store.audit({ ev: 'reject', device: v.id, alias: dev?.alias?.en, why: dev ? dev.status : 'unknown', remote });
      sendJson(res, 403, { error: dev ? dev.status : 'unknown_device', device: publicClient(dev) }, headers); return true;
    }
    this.store.touch(v.id, { remote });

    if (p === '/interact/sessions') { sendJson(res, 200, { ...base, sessions: await this.sessions() }, headers); return true; }

    const sid = String(body.session || '').toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(sid) || !this._inProject(sid)) { sendJson(res, 404, { error: 'no_session' }, headers); return true; }

    if (p === '/interact/feed') {
      const file = transcriptOf(sid, { index: this.index, projectsDir: this.projectsDir });
      if (!file) { sendJson(res, 404, { error: 'no_transcript' }, headers); return true; }
      const after = body.after == null ? null : Number(body.after);
      const before = body.before == null ? null : Number(body.before);
      const f = readFeed(file, { after, before, privacy: this.privacy });
      const rec = findPeerSession(sid, { sessionsDir: this.sessionsDir });
      sendJson(res, 200, { ...base, items: f.items, ...(f.next != null ? { next: f.next } : {}), ...(f.before != null ? { before: f.before } : {}), mode: f.mode, holdLikely: f.mode ? holdLikely(f.mode) : null,
        ...(this.privacy === 'minimal' ? { privacy: 'minimal' } : {}),
        live: rec ? { status: rec.status, ready: !checkTarget(rec, { sessionsDir: this.sessionsDir }), ...(rec.bridgeSessionId ? { remote: rcLink(rec.bridgeSessionId) } : {}),
          ...(rec.waitingFor === PERM_WAIT && rec.headless !== true ? { perm: true } : {}) } : null }, headers); // 계획·권한 창이 열려 있음
      return true;
    }

    // 잘린 응답 전체 보기: 그 줄(바이트 위치 o)의 Claude 글 전체 — 승인 기기·같은 프로젝트 범위·가림, minimal 이면 거절
    if (p === '/interact/full') {
      if (this.privacy === 'minimal') { sendJson(res, 403, { error: 'minimal' }, headers); return true; }
      const file = transcriptOf(sid, { index: this.index, projectsDir: this.projectsDir });
      if (!file) { sendJson(res, 404, { error: 'no_transcript' }, headers); return true; }
      const r = feedFull(file, body.o);
      if (r.error) { sendJson(res, r.status || 404, { error: r.error }, headers); return true; }
      sendJson(res, 200, { ...base, ok: true, md: r.md, ...(r.cut ? { cut: 1 } : {}) }, headers);
      return true;
    }

    if (p === '/interact/send') {
      const text = typeof body.text === 'string' ? body.text.replace(/\r\n/g, '\n').trim() : '';
      if (!text) { sendJson(res, 400, { error: 'empty' }, headers); return true; }
      if (text.length > TEXT_MAX) { sendJson(res, 413, { error: 'too_long', max: TEXT_MAX }, headers); return true; }
      if (!this._rate(v.id)) { sendJson(res, 429, { error: 'rate', perMin: SEND_PER_MIN }, { ...headers, 'Retry-After': '20' }); return true; }
      const rec = findPeerSession(sid, { sessionsDir: this.sessionsDir });
      if (rec) { try { await this.headless([rec]); } catch {} }
      if (rec && rec.headless === true) { // -p 회차·SDK 세션에는 넣지 않는다(자율 루프 방해 방지)
        this.store.audit({ ev: 'reject', device: v.id, alias: dev.alias?.en, session: sid, target: rec.name || null, why: 'headless', remote });
        sendJson(res, 409, { error: 'headless' }, headers); return true;
      }
      // -p 여부를 확인하지 못한 세션(entrypoint 없음 + 명령줄 조회 실패): 화면이 한 번 더 확인받아 confirm:true 로 다시 보낼 때만. 둘 다 감사 기록
      const unverified = !!(rec && rec.unverified);
      if (unverified && body.confirm !== true) {
        this.store.audit({ ev: 'reject', device: v.id, alias: dev.alias?.en, session: sid, target: rec.name || null, why: 'unverified', remote });
        sendJson(res, 409, { error: 'unverified' }, headers); return true;
      }
      const project = rec?.cwd ? path.basename(rec.cwd) : null;
      const audit = { ev: 'send', device: v.id, alias: dev.alias?.en, session: sid, target: rec?.name || null, project, chars: text.length, preview: preview(text), remote, ...(unverified ? { unverified: true, confirmed: true } : {}) };
      try {
        const nl = cliLang() === 'en' ? 'en' : 'ko'; // 보낸 이 표시·안내 줄 언어 = 서버 CLI 언어. 감사 기록은 원문(text)
        const r = await this.send({ sessionId: sid, text: this.store.notice() ? withNotice(text, nl) : text, fromName: fromNameOf(dev.alias?.en, nl), sessionsDir: this.sessionsDir });
        const file = transcriptOf(sid, { index: this.index, projectsDir: this.projectsDir });
        const mode = file ? modeOf(file) : null;
        this.store.audit({ ...audit, result: 'sent', msgId: r.msgId });
        sendJson(res, 200, { ...base, ok: true, msgId: r.msgId, mode, holdLikely: holdLikely(mode) }, headers);
      } catch (e) {
        const code = e instanceof PeerError ? e.code : 'io';
        this.store.audit({ ...audit, result: 'failed', why: code });
        sendJson(res, code === 'no_session' ? 404 : 502, { error: code }, headers);
      }
      return true;
    }
    // 질문창에 답하기: 그 세션이 Remote Control 로 붙어 있으면 브리지에 control_response(allow + answers) — 터미널 창이 그 답으로 닫힌다
    if (p === '/interact/ask') {
      const tu = String(body.toolUseId || '');
      const picks = Array.isArray(body.picks) ? body.picks.slice(0, 8) : null;
      if (!/^[A-Za-z0-9_-]{8,120}$/.test(tu) || !picks) { sendJson(res, 400, { error: 'bad_pick' }, headers); return true; }
      if (!this._rate(v.id)) { sendJson(res, 429, { error: 'rate', perMin: SEND_PER_MIN }, { ...headers, 'Retry-After': '20' }); return true; }
      const rec = findPeerSession(sid, { sessionsDir: this.sessionsDir });
      if (rec) { try { await this.headless([rec]); } catch {} }
      const link = rec?.bridgeSessionId ? rcLink(rec.bridgeSessionId) : null;
      const audit = { ev: 'ask-answer', device: v.id, alias: dev.alias?.en, session: sid, target: rec?.name || null, project: rec?.cwd ? path.basename(rec.cwd) : null, toolUseId: tu, remote };
      if (!rec || rec.headless === true || !rec.bridgeSessionId) {
        const why = !rec ? 'no_session' : rec.headless === true ? 'headless' : 'no_rc';
        this.store.audit({ ...audit, result: 'failed', why });
        sendJson(res, why === 'no_session' ? 404 : 409, { error: why, ...(link ? { link } : {}) }, headers); return true;
      }
      if (this._upBusy(res, sendJson, headers, link, () => this.store.audit({ ...audit, result: 'failed', why: 'upstream_rate' }))) return true;
      try {
        const r = await this.rcAnswer({ bridgeSessionId: rec.bridgeSessionId, toolUseId: tu, picks });
        this.store.audit({ ...audit, result: 'answered', preview: preview(Object.values(r.answers || {}).join(' | ')) });
        sendJson(res, 200, { ...base, ok: true, via: 'rc', link }, headers);
      } catch (e) {
        const code = e instanceof RcError ? e.code : 'io';
        this.store.audit({ ...audit, result: 'failed', why: code });
        this._upNote(e);
        sendJson(res, code === 'incomplete' || code === 'bad_pick' ? 400 : code === 'not_pending' ? 409 : code === 'upstream_rate' ? 503 : 502, { error: code, ...(link ? { link } : {}) }, headers);
      }
      return true;
    }
    // 열린 계획 승인·도구 권한 창 읽기(브리지 control_request 중 답 없는 것, AskUserQuestion 제외) — 화면 카드용 요약만
    if (p === '/interact/pending') {
      if (!this._rate(v.id, this.permReads, PENDING_PER_MIN)) { sendJson(res, 429, { error: 'rate', perMin: PENDING_PER_MIN }, { ...headers, 'Retry-After': '10' }); return true; }
      const rec = findPeerSession(sid, { sessionsDir: this.sessionsDir });
      if (rec) { try { await this.headless([rec]); } catch {} }
      const link = rec?.bridgeSessionId ? rcLink(rec.bridgeSessionId) : null;
      if (!rec || rec.headless === true || !rec.bridgeSessionId) { const why = !rec ? 'no_session' : rec.headless === true ? 'headless' : 'no_rc'; sendJson(res, why === 'no_session' ? 404 : 409, { error: why }, headers); return true; }
      const ck = rec.bridgeSessionId, hit = this._pendCache.get(ck);
      if (hit && this.now() - hit.at < PENDING_CACHE_MS) { sendJson(res, 200, { ...base, items: hit.items, link }, headers); return true; }
      if (this._upBusy(res, sendJson, headers, link)) return true;
      try {
        const items = (await this.rcPerms({ bridgeSessionId: rec.bridgeSessionId })).filter(Boolean).slice(0, 8);
        // minimal 이면 글(명령·경로·계획 본문) 없이 종류·도구·위험 코드만
        if (this.privacy === 'minimal') for (let i = 0; i < items.length; i++) { const x = items[i]; items[i] = { kind: x.kind, toolUseId: x.toolUseId, tool: x.tool, ...(x.danger ? { danger: x.danger } : {}), minimal: 1 }; }
        this._pendCache.set(ck, { at: this.now(), items });
        if (this._pendCache.size > 50) this._pendCache.delete(this._pendCache.keys().next().value);
        sendJson(res, 200, { ...base, items, link }, headers);
      } catch (e) {
        const code = e instanceof RcError ? e.code : 'io';
        this._upNote(e);
        sendJson(res, code === 'upstream_rate' ? 503 : 502, { error: code, ...(link ? { link } : {}) }, headers);
      }
      return true;
    }
    // 계획 승인·도구 권한 창에 답하기: allow(원래 input 그대로) | deny(사유). 규칙 저장(updatedPermissions)은 보내지 않음.
    // 위험 명령 허용은 confirm:true(화면 두 번 누르기)여야 함 — 서버가 브리지 요청의 원래 input 으로 다시 판정
    if (p === '/interact/perm') {
      const tu = String(body.toolUseId || '');
      const decision = body.decision === 'allow' || body.decision === 'deny' ? body.decision : null;
      const kind = body.kind === 'plan' || body.kind === 'perm' ? body.kind : null;
      const message = typeof body.message === 'string' ? body.message.slice(0, 2000) : '';
      if (!/^[A-Za-z0-9_-]{8,120}$/.test(tu) || !decision) { sendJson(res, 400, { error: 'bad_pick' }, headers); return true; }
      if (!this._rate(v.id)) { sendJson(res, 429, { error: 'rate', perMin: SEND_PER_MIN }, { ...headers, 'Retry-After': '20' }); return true; }
      const rec = findPeerSession(sid, { sessionsDir: this.sessionsDir });
      if (rec) { try { await this.headless([rec]); } catch {} }
      const link = rec?.bridgeSessionId ? rcLink(rec.bridgeSessionId) : null;
      const audit = { ev: 'perm-answer', device: v.id, alias: dev.alias?.en, session: sid, target: rec?.name || null, project: rec?.cwd ? path.basename(rec.cwd) : null, toolUseId: tu, kind, decision, remote };
      if (!rec || rec.headless === true || !rec.bridgeSessionId) {
        const why = !rec ? 'no_session' : rec.headless === true ? 'headless' : 'no_rc';
        this.store.audit({ ...audit, result: 'failed', why });
        sendJson(res, why === 'no_session' ? 404 : 409, { error: why, ...(link ? { link } : {}) }, headers); return true;
      }
      if (this._upBusy(res, sendJson, headers, link, () => this.store.audit({ ...audit, result: 'failed', why: 'upstream_rate' }))) return true;
      try {
        const r = await this.rcPerm({ bridgeSessionId: rec.bridgeSessionId, toolUseId: tu, decision, message, confirm: body.confirm === true, kind });
        this._pendCache.delete(rec.bridgeSessionId);
        this.store.audit({ ...audit, kind: r.kind || kind, result: 'answered', tool: r.tool, ...(r.danger?.length ? { danger: r.danger } : {}), preview: preview(r.what), ...(decision === 'deny' && message ? { reason: preview(message) } : {}) });
        sendJson(res, 200, { ...base, ok: true, via: 'rc', decision, link }, headers);
      } catch (e) {
        const code = e instanceof RcError ? e.code : 'io';
        this.store.audit({ ...audit, result: 'failed', why: code });
        this._upNote(e);
        sendJson(res, code === 'bad_pick' || code === 'confirm' ? 400 : code === 'not_pending' || code === 'kind' ? 409 : code === 'upstream_rate' ? 503 : 502, { error: code, ...(link ? { link } : {}) }, headers);
      }
      return true;
    }
    sendJson(res, 404, { error: 'not_found' }, headers);
    return true;
  }
}

/** 권한 모드(파일 끝 64KB 의 마지막 permissionMode) */
export function modeOf(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size, len = Math.min(size, 64 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const all = [...buf.toString('utf8').matchAll(/"permissionMode":"([A-Za-z]+)"/g)];
      return all.length ? all[all.length - 1][1] : null;
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

/** 로컬 관리자(CLI) 경로 /interact/admin — 목록·승인·취소·지움·켬·끔·감사 */
export async function handleInteractAdmin(req, res, url, hub, { adminSecret, sendJson, SEC }) {
  if (url.pathname !== '/interact/admin') return false;
  const gate = checkLocalAdmin(req, adminSecret);
  if (!gate.ok) { sendJson(res, gate.status, { error: gate.status === 404 ? 'not_found' : gate.reason }, SEC); return true; }
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'method' }, SEC); return true; }
  let body = {};
  try { const raw = await readRaw(req); body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { sendJson(res, 400, { error: 'bad_json' }, SEC); return true; }
  sendJson(res, 200, adminOp(hub.store, body), SEC);
  return true;
}

/** CLI 명령 한 건(서버 안에서도, 서버가 꺼져 있을 때 CLI 가 직접도 같은 함수) */
export function adminOp(store, { op, who = null, n = 20 } = {}) {
  const info = () => ({ enabled: store.enabled(), notice: store.notice(), files: { ...store.files }, clients: store.clients().map(publicClient) });
  try {
    if (op === 'list' || op === 'status') return { ok: true, ...info() };
    if (op === 'on' || op === 'off') {
      store.setEnabled(op === 'on');
      store.audit({ ev: op });
      return { ok: true, ...info() };
    }
    if (op === 'notice') { // 본문 앞 안내 줄 켬/끔
      const v = String(who || '').toLowerCase();
      if (v !== 'on' && v !== 'off') return { ok: false, error: 'bad_op' };
      store.setNotice(v === 'on');
      store.audit({ ev: 'notice-' + v });
      return { ok: true, ...info() };
    }
    if (op === 'audit') return { ok: true, audit: store.auditTail(Math.min(200, Math.max(1, Number(n) || 20))), files: { ...store.files } };
    if (op === 'allow' || op === 'revoke' || op === 'remove') {
      const f = store.find(who);
      if (f.ambiguous) return { ok: false, error: 'ambiguous', matches: f.ambiguous.map(publicClient) };
      if (!f.hit) return { ok: false, error: 'not_found', ...info() };
      const c = f.hit;
      if (op === 'remove') store.remove(c.id);
      else store.setStatus(c.id, op === 'allow' ? 'allowed' : 'revoked');
      store.audit({ ev: op, device: c.id, alias: c.alias?.en });
      return { ok: true, client: publicClient(op === 'remove' ? c : store.get(c.id)), ...info() };
    }
    return { ok: false, error: 'bad_op' };
  } catch (e) {
    return { ok: false, error: 'store', detail: e?.code || e?.message };
  }
}
