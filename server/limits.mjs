// 3차: 사용 한도(5시간·7일) 수집·병합 — 5차: 기본 출처는 독립 수집기(server/usage.mjs)
// source:
//   oauth       독립 수집기가 OAuth 사용량 API 를 스스로 주기적으로 부른다(180초, 80%↑ 60초, 60초 캐시)
//   auto        (비권장·예전 방식) statusLine 래퍼 파일 + 독립 수집기 중 창마다 더 새로운 값
//   statusline  (비권장) 래퍼가 쓴 <CCVIZ_HOME>/ratelimits.json 만
//   off(기본)   끔 — 비공식 엔드포인트라 옵트인(start --limits 또는 config.limits.source = oauth)
// 자격증명 원문·토큰 길이·만료 시각·요청 헤더는 Limits·로그 어디에도 넣지 않는다. 토큰 갱신(refresh)은 하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { UsagePoller, USAGE_DEFAULTS } from './usage.mjs';
import { ccvizHome } from './home.mjs';

export const OAUTH_URL = 'https://api.anthropic.com/api/oauth/usage';
export const OAUTH_BETA = 'oauth-2025-04-20';
export const DEFAULT_LIMITS = { source: 'off', staleSec: 600, ...USAGE_DEFAULTS };

export const limitsHome = () => ccvizHome();
export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * 한 창 정규화. pct 범위 밖·숫자 아님 → null. 리셋 시각 없음 → null(allowNoReset 이면 resetsAt null 로 둠).
 * estimated: 리셋 시각이 추정값(7d 응답에 없어 다음 토요일 13:00 KST 로 채움)이면 true — 그때만 키를 넣는다
 */
export function normWindow(pct, resetsAt, source, capturedAt, nowMs = Date.now(), { allowNoReset = false, estimated = false } = {}) {
  const p = typeof pct === 'string' && pct.trim() !== '' ? Number(pct) : pct;
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100) return null;
  let rMs;
  if (typeof resetsAt === 'number' && Number.isFinite(resetsAt)) rMs = resetsAt < 1e11 ? resetsAt * 1000 : resetsAt; // epoch 초 또는 ms
  else if (typeof resetsAt === 'string') rMs = Date.parse(resetsAt);
  const cMs = Date.parse(capturedAt);
  if (!Number.isFinite(cMs)) return null;
  if (!Number.isFinite(rMs)) {
    if (!allowNoReset || resetsAt != null) return null;
    return { pct: round1(p), resetsAt: null, resetsInSec: null, source, capturedAt: new Date(cMs).toISOString(), expired: false };
  }
  return {
    pct: round1(p), resetsAt: new Date(rMs).toISOString(), resetsInSec: Math.max(0, Math.round((rMs - nowMs) / 1000)),
    source, capturedAt: new Date(cMs).toISOString(), expired: rMs <= nowMs, ...(estimated ? { estimated: true } : {}),
  };
}

/** ratelimits.json(래퍼 형식 v1) → {five_hour, seven_day} 원값 */
export function parseStatuslineFile(text) {
  let j; try { j = JSON.parse(text); } catch { return null; }
  if (!j || j.v !== 1 || !j.capturedAt) return null;
  const pick = (w) => (w && typeof w === 'object' ? { pct: w.used_percentage, resetsAt: w.resets_at } : null);
  return { capturedAt: j.capturedAt, five_hour: pick(j.five_hour), seven_day: pick(j.seven_day) };
}

/** OAuth 사용량 응답 → {five_hour, seven_day} 원값. 형식이 다르면 null(조용히 statusLine 만 사용) */
export function parseOauthUsage(body) {
  let j = body;
  if (typeof body === 'string') { try { j = JSON.parse(body); } catch { return null; } }
  if (!j || typeof j !== 'object') return null;
  const pick = (w) => (w && typeof w === 'object' && w.utilization != null ? { pct: w.utilization, resetsAt: w.resets_at } : null);
  const out = { five_hour: pick(j.five_hour), seven_day: pick(j.seven_day) };
  return out.five_hour || out.seven_day ? out : null;
}

/** 창마다 capturedAt 이 더 새로운 쪽. 응답 시점 값으로 다시 계산 */
export function mergeLimits({ sl, oa, nowMs = Date.now(), staleSec = 600, plan = null }) {
  const win = (k) => {
    const a = sl && sl[k] ? normWindow(sl[k].pct, sl[k].resetsAt, 'statusline', sl.capturedAt, nowMs) : null;
    const b = oa && oa[k] ? normWindow(oa[k].pct, oa[k].resetsAt, 'oauth', oa.capturedAt, nowMs, { allowNoReset: true, estimated: !!oa[k].estimated }) : null;
    if (a && b) return Date.parse(a.capturedAt) >= Date.parse(b.capturedAt) ? a : b;
    return a || b;
  };
  const five = win('five_hour'), seven = win('seven_day');
  const wins = [five, seven].filter(Boolean);
  let capturedAt = null, source = null;
  if (wins.length) {
    const oldest = wins.reduce((x, y) => (Date.parse(x.capturedAt) <= Date.parse(y.capturedAt) ? x : y));
    capturedAt = oldest.capturedAt;
    source = wins.every((w) => w.source === wins[0].source) ? wins[0].source : oldest.source;
  }
  const ageSec = capturedAt ? Math.max(0, Math.round((nowMs - Date.parse(capturedAt)) / 1000)) : null;
  return { ok: true, source, capturedAt, ageSec, stale: ageSec != null && ageSec > staleSec, five_hour: five, seven_day: seven, plan };
}

/**
 * 한도 수집기(서버용 묶음). source 가 oauth·auto 면 독립 수집기(UsagePoller)를 돌리고,
 * auto·statusline(비권장) 이면 5초마다 ratelimits.json 을 stat 해 mtime 이 바뀌면 읽는다.
 */
export class LimitsCollector {
  constructor({ home = limitsHome(), claudeHome = claudeDir(), source = DEFAULT_LIMITS.source, staleSec = 600,
    pollSec, fastPollSec, highPct, cacheSec,
    fetchImpl = globalThis.fetch, now = () => Date.now(), logger = (m) => console.error('[ccviz] ' + m), version = '0.1.0',
    pollMs = 5000, demo = false, poller = null, useFileCache = true } = {}) {
    this.file = path.join(home, 'ratelimits.json');
    this.source = ['auto', 'statusline', 'oauth', 'off'].includes(source) ? source : DEFAULT_LIMITS.source;
    this.staleSec = Number(staleSec) > 0 ? Number(staleSec) : 600;
    this.now = now;
    this.pollMs = pollMs;
    this.demo = !!demo;
    this.sl = null; // {capturedAt, five_hour, seven_day}
    this.slMtime = null;
    this.viewers = 0;
    this.listeners = new Set();
    this.timer = null;
    this._lastJson = null;
    this.poller = null;
    if (!this.demo && (this.source === 'oauth' || this.source === 'auto')) {
      this.poller = poller || new UsagePoller({ home, claudeDir: claudeHome, fetchImpl, now, logger, version,
        pollSec, fastPollSec, highPct, cacheSec, useFileCache });
      this.poller.onChange(() => this._notify());
    }
  }

  get usesStatusline() { return this.source === 'auto' || this.source === 'statusline'; }

  start() {
    if (this.timer || this.demo || this.source === 'off') return this;
    if (this.usesStatusline) {
      this.readStatusline();
      this.timer = setInterval(() => { this.readStatusline(); this._notify(); }, this.pollMs);
      this.timer.unref?.();
    }
    this.poller?.start();
    return this;
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.poller?.stop(); }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** SSE 구독자 수(5차부터 수집 주기에는 영향 없음 — 독립 수집기는 스스로 돈다) */
  addViewer() { this.viewers++; return () => { this.viewers = Math.max(0, this.viewers - 1); }; }

  /** mtime 이 바뀌었으면 ratelimits.json 을 읽는다. 바뀌었으면 true */
  readStatusline() {
    if (!this.usesStatusline) return false;
    let st;
    try { st = fs.statSync(this.file); } catch { return false; }
    if (this.slMtime === st.mtimeMs) return false;
    this.slMtime = st.mtimeMs;
    let text;
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { return false; }
    const v = parseStatuslineFile(text);
    if (!v) return false;
    this.sl = v;
    return true;
  }

  /** 지금 Limits(의 error·estimated). source off 면 disabled */
  current() {
    const nowMs = this.now();
    if (this.source === 'off' && !this.demo) return { ok: true, source: null, five_hour: null, seven_day: null, disabled: true };
    if (this.demo) { // --demo 는 네트워크 없이 고정 값(한도 옵트인과 무관하게 보여 준다)
      const capturedAt = new Date(nowMs - 12 * 60_000).toISOString();
      const sl = { capturedAt, five_hour: { pct: 72, resetsAt: Math.floor((nowMs + 3 * 3600_000 + 12 * 60_000) / 1000) },
        seven_day: { pct: 93, resetsAt: Math.floor((nowMs + 22 * 3600_000) / 1000) } };
      return mergeLimits({ sl, nowMs, staleSec: this.staleSec, plan: 'max' });
    }
    const p = this.poller;
    const L = mergeLimits({ sl: this.usesStatusline ? this.sl : null, oa: p ? p.value : null, nowMs, staleSec: this.staleSec, plan: p ? p.plan : null });
    if (p && p.failed) {
      // 마지막 값은 그대로 두고 오래됨 표시. 원인은 error 에 그대로(권한 문제로 단정하지 않음)
      const fromOauth = [L.five_hour, L.seven_day].some((w) => w && w.source === 'oauth');
      if (fromOauth || (!L.five_hour && !L.seven_day)) L.stale = true;
    }
    if (p && p.lastError) L.error = { ...p.lastError };
    return L;
  }

  /** /limits 응답. 아직 값이 하나도 없으면 첫 조회를 최대 waitMs 기다린다(그 밖에는 수집 주기를 따름) */
  async get({ waitMs = 3000 } = {}) {
    this.readStatusline();
    const cur = this.current();
    if (this.poller && !cur.five_hour && !cur.seven_day && !this.poller.value && waitMs > 0) {
      const p = this.poller.refresh();
      await Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, waitMs).unref?.())]);
      return this.current();
    }
    return cur;
  }

  _notify() {
    const cur = this.current();
    const key = JSON.stringify({ ...cur, ageSec: undefined, five_hour: cur.five_hour && { ...cur.five_hour, resetsInSec: undefined },
      seven_day: cur.seven_day && { ...cur.seven_day, resetsInSec: undefined } });
    if (key === this._lastJson) return;
    this._lastJson = key;
    for (const fn of this.listeners) { try { fn(cur); } catch {} }
  }
}
