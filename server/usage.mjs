// 5차: 토큰 한도(5시간·7일) 독립 수집기
// ~/.claude/.credentials.json 의 OAuth 액세스 토큰으로 GET /api/oauth/usage 를 직접 부른다.
// - 주기: 평소 180초, 5h 또는 7d 사용률이 80% 이상이면 60초. 응답은 60초 캐시(메모리 + 파일, 프로세스 사이 중복 호출 방지)
// - 파일 캐시의 마지막 성공 값은 나이와 무관하게 시드로 읽는다(재시작 뒤에도 stale 로 보여 줌)
// - 429 → Retry-After, 없으면 2분·4분·8분…최대 30분 물러서기. 물러서기·마지막 시도 시각은 파일로 프로세스 사이 공유
// - 7d 리셋 시각이 없으면 다음 토요일 13:00 KST 로 추정(estimated: true)
// - 401/토큰 만료 → 자격증명 파일을 다시 읽어 1회 재시도, 그래도 실패면 마지막 값 유지 + stale
// - 빈 응답·HTML·JSON 아님 등은 권한 문제로 단정하지 않고 원인 그대로 기록(lastError.kind)
// 토큰은 호출 직전에 파일에서 읽어 지역 변수로만 쓰고 버린다. 상태·캐시 파일·로그·오류 문구에 절대 넣지 않는다.
// 토큰 갱신(refresh_token 사용)은 하지 않는다(갱신은 Claude Code 몫). 외부 플러그인 캐시·코드에 의존하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ccvizHome } from './home.mjs';
import { t } from './cli-i18n.mjs';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const USAGE_BETA = 'oauth-2025-04-20';
export const USAGE_DEFAULTS = { pollSec: 180, fastPollSec: 60, highPct: 80, cacheSec: 60, timeoutSec: 10 };
const MAX_BACKOFF_MS = 30 * 60_000;   // 429 물러서기 상한
const BASE_BACKOFF_MS = 2 * 60_000;   // Retry-After 없을 때 첫 물러서기(2분→4분→8분…→30분)

/** Retry-After(초 또는 HTTP 날짜) → ms. 못 읽으면 null */
export function parseRetryAfter(v, nowMs = Date.now()) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 0 ? n * 1000 : null;
  const d = Date.parse(String(v));
  return Number.isFinite(d) && d > nowMs ? d - nowMs : null;
}

/** 429 물러서기 시간: Retry-After 가 있으면 그것, 없으면 2분·4분·8분…(step 1부터), 둘 다 30분 상한 */
export function backoffMs(step, retryAfterMs = null) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return Math.min(MAX_BACKOFF_MS, retryAfterMs);
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, (Number(step) || 1) - 1));
}
const KST_OFFSET_MS = 9 * 3600_000;

const homeDir = () => ccvizHome();
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

/** 다음 토요일 13:00 KST(= 토 04:00 UTC). 지금이 토요일 13:00 전이면 오늘 */
export function nextSaturday13Kst(nowMs = Date.now()) {
  const k = new Date(nowMs + KST_OFFSET_MS); // KST 벽시계를 UTC 필드로
  const days = (6 - k.getUTCDay() + 7) % 7;
  let t = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + days, 13, 0, 0) - KST_OFFSET_MS;
  if (t <= nowMs) t += 7 * 86400_000;
  return t;
}

/** 오류 문구에서 토큰처럼 보이는 조각을 지우고 짧게 자른다 */
export function scrub(s, max = 160) {
  return String(s ?? '')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***')
    .replace(/[A-Za-z0-9_-]{40,}/g, '***')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * 응답 본문 → { five_hour, seven_day } 원값 또는 { error }.
 * 빈 본문·HTML·JSON 아님·창 없음을 서로 다른 kind 로 구분한다(권한 문제로 단정하지 않음).
 */
export function parseUsageBody(text, nowMs = Date.now()) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return { error: { kind: 'empty', message: '빈 응답 본문' } };
  if (t[0] === '<') return { error: { kind: 'html', message: scrub(t.replace(/<[^>]+>/g, ' ')) || 'HTML 응답' } };
  let j;
  try { j = JSON.parse(t); } catch { return { error: { kind: 'json', message: 'JSON 아님: ' + scrub(t, 80) } }; }
  if (!j || typeof j !== 'object') return { error: { kind: 'shape', message: 'JSON 객체 아님' } };
  const pick = (w, isSeven) => {
    if (!w || typeof w !== 'object' || w.utilization == null) return null;
    const p = Number(w.utilization);
    if (!Number.isFinite(p)) return null;
    const r = w.resets_at;
    const rMs = typeof r === 'string' ? Date.parse(r) : typeof r === 'number' ? (r < 1e11 ? r * 1000 : r) : NaN;
    if (Number.isFinite(rMs)) return { pct: p, resetsAt: new Date(rMs).toISOString(), estimated: false };
    if (isSeven) return { pct: p, resetsAt: new Date(nextSaturday13Kst(nowMs)).toISOString(), estimated: true };
    return { pct: p, resetsAt: null, estimated: false };
  };
  const out = { five_hour: pick(j.five_hour, false), seven_day: pick(j.seven_day, true) };
  if (!out.five_hour && !out.seven_day) {
    const msg = j.error ? scrub(typeof j.error === 'string' ? j.error : j.error.message || JSON.stringify(j.error)) : '응답에 five_hour·seven_day 없음';
    return { error: { kind: 'shape', message: msg } };
  }
  return out;
}

/** 자격증명 파일에서 토큰·플랜·만료를 읽는다. 반환값은 호출자 지역 변수로만 쓴다 */
export function readCredentials(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return { error: { kind: 'no-credentials', message: e.code === 'ENOENT' ? '자격증명 파일 없음' : `자격증명 파일 읽기 실패(${e.code || 'error'})` } }; }
  let o;
  try { o = JSON.parse(raw)?.claudeAiOauth; } catch { return { error: { kind: 'no-credentials', message: '자격증명 파일 JSON 파싱 실패' } }; }
  if (!o || typeof o.accessToken !== 'string' || !o.accessToken) return { error: { kind: 'no-credentials', message: 'claudeAiOauth.accessToken 없음' } };
  let exp = Number(o.expiresAt);
  if (Number.isFinite(exp) && exp > 0 && exp < 1e11) exp *= 1000;
  const sub = typeof o.subscriptionType === 'string' ? o.subscriptionType.toLowerCase() : null;
  return { token: o.accessToken, expiresAt: Number.isFinite(exp) && exp > 0 ? exp : null, plan: sub === 'max' || sub === 'pro' ? sub : null };
}

/**
 * 독립 수집기. start() 하면 스스로 주기를 정해 부른다. 서버·CLI(bin/limits.mjs) 양쪽에서 쓴다.
 * value = { capturedAt, five_hour:{pct,resetsAt,estimated}|null, seven_day:…|null } (마지막 성공 값)
 */
export class UsagePoller {
  constructor({ home = homeDir(), claudeDir = claudeHome(), fetchImpl = globalThis.fetch, now = () => Date.now(),
    logger = (m) => console.error('[ccviz] ' + m), version = '0.1.0', pollSec = USAGE_DEFAULTS.pollSec,
    fastPollSec = USAGE_DEFAULTS.fastPollSec, highPct = USAGE_DEFAULTS.highPct, cacheSec = USAGE_DEFAULTS.cacheSec,
    timeoutSec = USAGE_DEFAULTS.timeoutSec, cacheFile, useFileCache = true } = {}) {
    this.credFile = path.join(claudeDir, '.credentials.json');
    this.cacheFile = cacheFile || path.join(home, 'usage-cache.json');
    this.useFileCache = !!useFileCache;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.logger = logger;
    this.version = version;
    this.pollMs = Math.max(60, Number(pollSec) || USAGE_DEFAULTS.pollSec) * 1000;
    this.fastMs = Math.max(30, Number(fastPollSec) || USAGE_DEFAULTS.fastPollSec) * 1000;
    this.highPct = Number(highPct) > 0 ? Number(highPct) : USAGE_DEFAULTS.highPct;
    this.cacheMs = Math.max(0, Number(cacheSec ?? USAGE_DEFAULTS.cacheSec)) * 1000;
    this.timeoutMs = Math.max(1, Number(timeoutSec) || USAGE_DEFAULTS.timeoutSec) * 1000;
    this.value = null;        // 마지막 성공 값
    this.plan = null;
    this.lastAttemptAt = 0;   // 실제 HTTP 시도 시각(캐시 적중은 제외)
    this.lastError = null;    // { kind, status?, message, at }
    this.failed = false;      // 마지막 시도가 실패했나 → stale
    this.backoffUntil = 0;    // 429 물러서기 끝 시각(Retry-After 또는 지수)
    this.backoffStep = 0;     // 연속 429 횟수(성공하면 0)
    this.calls = 0;           // HTTP 요청 수(재시도 포함)
    this.inflight = null;
    this.timer = null;
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) { try { fn(this.snapshot()); } catch {} } }

  /** 바깥에 내보내는 상태(토큰 없음) */
  snapshot() {
    return { value: this.value, plan: this.plan, stale: this.failed, lastError: this.lastError,
      lastAttemptAt: this.lastAttemptAt ? new Date(this.lastAttemptAt).toISOString() : null };
  }

  /** 다음 호출까지 간격: 어느 창이든 highPct 이상이면 fast, 아니면 평소. 429 물러서기가 더 길면 그것 */
  nextDelayMs(nowMs = this.now()) {
    const v = this.value;
    const high = !!v && [v.five_hour, v.seven_day].some((w) => w && w.pct >= this.highPct);
    const base = high ? this.fastMs : this.pollMs;
    return Math.max(base, this.backoffUntil - nowMs);
  }

  start() {
    if (this.timer) return this;
    const loop = async () => {
      try { await this.refresh(); } catch {}
      if (!this.timer) return;
      this.timer = setTimeout(loop, this.nextDelayMs());
      this.timer.unref?.();
    };
    this.timer = setTimeout(loop, 0);
    this.timer.unref?.();
    return this;
  }

  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  /** 캐시 파일 전체(마지막 성공 값 + 프로세스 사이 공유 상태). 없거나 깨졌으면 null */
  _readFile() {
    if (!this.useFileCache) return null;
    try {
      const j = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      return j && j.v === 1 ? j : null;
    } catch { return null; }
  }

  /** 마지막 성공 값과 나이. 나이와 무관하게 돌려준다(재시작 시드) */
  _readCache(nowMs) {
    const j = this._readFile();
    if (!j?.value?.capturedAt) return null;
    const age = nowMs - Date.parse(j.value.capturedAt);
    return Number.isFinite(age) && age >= 0 ? { value: j.value, plan: j.plan ?? null, age, file: j } : null;
  }

  /**
   * 캐시 파일 쓰기(원자적). 값은 마지막 성공 값만 — 메모리에 값이 없거나 파일 값이 더 새로우면 파일 값을 지킨다.
   * 공유 상태: lastAttemptAt(마지막 HTTP 시도), backoffUntil·backoffStep(429 물러서기), lastError(정리된 원인, 토큰 없음)
   */
  _writeCache() {
    if (!this.useFileCache) return;
    try {
      const prev = this._readFile();
      let value = this.value, plan = this.plan;
      const pv = prev?.value;
      if (pv?.capturedAt && (!value || Date.parse(pv.capturedAt) > Date.parse(value.capturedAt))) { value = pv; plan = plan ?? prev.plan ?? null; }
      const out = { v: 1, value: value || null, plan: plan ?? null,
        lastAttemptAt: this.lastAttemptAt ? new Date(this.lastAttemptAt).toISOString() : (prev?.lastAttemptAt ?? null),
        backoffUntil: this.backoffUntil ? new Date(this.backoffUntil).toISOString() : null,
        backoffStep: this.backoffStep || 0,
        lastError: this.failed ? this.lastError : null };
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      const tmp = `${this.cacheFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, this.cacheFile);
    } catch { /* 캐시 실패는 무시 */ }
  }

  /**
   * 값 갱신. force 가 아니면 다음 순서로 HTTP 를 아낀다.
   *  1) 메모리 값이 cacheSec 안 → 그 값
   *  2) 파일 값이 메모리보다 새로우면(또는 메모리가 비었으면) 나이와 무관하게 받아 둔다(재시작 시드). cacheSec 안이면 그 값
   *  3) 429 물러서기 중(메모리 또는 파일, 다른 프로세스가 맞은 것 포함) → 부르지 않음, 마지막 값 + stale
   *  4) 다른 프로세스가 cacheSec 안에 이미 시도했으면 → 부르지 않음
   * 반환: snapshot()
   */
  async refresh({ force = false } = {}) {
    if (this.inflight) return this.inflight;
    const nowMs = this.now();
    if (!force) {
      if (this.value && !this.failed && nowMs - Date.parse(this.value.capturedAt) < this.cacheMs) return this.snapshot();
      const c = this._readCache(nowMs);
      const f = c?.file || this._readFile();
      let changed = false;
      if (c && (!this.value || Date.parse(c.value.capturedAt) > Date.parse(this.value.capturedAt))) {
        changed = JSON.stringify(c.value) !== JSON.stringify(this.value);
        this.value = c.value; this.plan = c.plan ?? this.plan;
      }
      if (c && c.age < this.cacheMs && this.value === c.value) {
        this.failed = false; this.lastError = null;
        if (changed) this._emit();
        return this.snapshot();
      }
      const fileBackoff = f?.backoffUntil ? Date.parse(f.backoffUntil) : 0;
      if (Number.isFinite(fileBackoff) && fileBackoff > this.backoffUntil) {
        this.backoffUntil = fileBackoff;
        this.backoffStep = Math.max(this.backoffStep, Number(f.backoffStep) || 0);
      }
      const fileAttempt = f?.lastAttemptAt ? Date.parse(f.lastAttemptAt) : 0;
      const othersRecent = Number.isFinite(fileAttempt) && fileAttempt > this.lastAttemptAt && nowMs - fileAttempt < this.cacheMs;
      if (nowMs < this.backoffUntil || othersRecent) {
        // 지금은 부르지 않는다. 다른 프로세스의 실패 원인이 있으면 이어받아 stale 로 표시
        if (f?.lastError && !this.lastError) { this.failed = true; this.lastError = f.lastError; changed = true; }
        else if (nowMs < this.backoffUntil && !this.failed) { this.failed = true; changed = true; }
        if (changed) this._emit();
        return this.snapshot();
      }
      if (changed) this._emit();
    }
    this.inflight = this._fetch(nowMs).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async _call(token) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), this.timeoutMs);
    this.calls++;
    const t0 = Date.now();
    try {
      const res = await this.fetchImpl(USAGE_URL, {
        method: 'GET', signal: ac.signal,
        headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': USAGE_BETA, 'User-Agent': `agent4d/${this.version}`, Accept: 'application/json' },
      });
      let text = '';
      try { text = await res.text(); } catch (e) { text = ''; }
      const ra = typeof res.headers?.get === 'function' ? res.headers.get('retry-after') : null;
      const ctype = typeof res.headers?.get === 'function' ? res.headers.get('content-type') : null;
      return { status: res.status, text, retryAfter: ra, ctype, ms: Date.now() - t0 };
    } catch (e) {
      return { status: 0, text: '', err: e?.name === 'AbortError' ? 'timeout' : 'network', errMsg: scrub(e?.cause?.code || e?.message || e), ms: Date.now() - t0 };
    } finally { clearTimeout(to); }
  }

  _fail(error, nowMs) {
    this.failed = true;
    this.lastError = { ...error, at: new Date(nowMs).toISOString() };
    this.logger(`${t('server.usageFail')} kind=${error.kind}${error.status ? ` status=${error.status}` : ''} ${error.message || ''}`.trim());
    if (this.lastAttemptAt === nowMs) this._writeCache(); // 실제로 HTTP 를 시도했을 때만 공유 상태 기록(값은 지킴)
    this._emit();
    return this.snapshot();
  }

  async _fetch(nowMs) {
    let cred = readCredentials(this.credFile);
    if (cred.error) return this._fail(cred.error, nowMs);
    this.plan = cred.plan ?? this.plan;
    let retried = false;
    // 이미 만료됐으면 Claude Code 가 갱신했을 수 있으니 파일을 다시 읽는다(재시도 1회로 친다)
    if (cred.expiresAt && nowMs >= cred.expiresAt) {
      retried = true;
      cred = readCredentials(this.credFile);
      if (cred.error) return this._fail(cred.error, nowMs);
    }
    this.lastAttemptAt = nowMs;
    this._writeCache(); // 시도 시각을 먼저 알려 다른 프로세스가 겹쳐 부르지 않게
    let r = await this._call(cred.token);
    if (r.status === 401 && !retried) {
      retried = true;
      cred = readCredentials(this.credFile);
      if (cred.error) return this._fail(cred.error, nowMs);
      r = await this._call(cred.token);
    }
    const expiredNote = cred.expiresAt && nowMs >= cred.expiresAt ? ' (자격증명 expiresAt 지남 — Claude Code 갱신 대기)' : '';
    cred = null; // 토큰을 더 붙잡지 않는다
    this.logger(`limits usage status=${r.status || r.err} ms=${r.ms}${retried ? ' retried=1' : ''}`);
    if (r.status === 0) return this._fail({ kind: r.err, message: r.errMsg || r.err }, nowMs);
    if (r.status === 429) {
      // Retry-After 를 따르고, 없으면 2분부터 두 배씩(최대 30분). 성공하면 원래 주기로
      this.backoffStep += 1;
      this.backoffUntil = nowMs + backoffMs(this.backoffStep, parseRetryAfter(r.retryAfter, nowMs));
    }
    if (r.status !== 200) {
      // 본문 그대로(정리만) 기록. 401 도 "권한 없음"으로 단정하지 않고 상태·본문을 남긴다
      const parsed = r.text ? parseUsageBody(r.text, nowMs) : null;
      const body = !r.text ? '빈 본문' : r.text.trim()[0] === '<' ? 'HTML: ' + scrub(r.text.replace(/<[^>]+>/g, ' '), 120) : scrub(r.text, 160);
      return this._fail({ kind: 'http', status: r.status, message: body + expiredNote, ...(parsed?.error ? { bodyKind: parsed.error.kind } : {}) }, nowMs);
    }
    const v = parseUsageBody(r.text, nowMs);
    if (v.error) return this._fail({ ...v.error, status: 200, ...(r.ctype ? { contentType: scrub(r.ctype, 60) } : {}) }, nowMs);
    this.value = { capturedAt: new Date(this.now()).toISOString(), five_hour: v.five_hour, seven_day: v.seven_day };
    this.failed = false;
    this.lastError = null;
    this.backoffUntil = 0;
    this.backoffStep = 0;
    this._writeCache();
    this._emit();
    return this.snapshot();
  }
}
