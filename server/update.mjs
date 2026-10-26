// 업데이트 확인·적용 — 순수 함수 + 얇은 입출력. 서버(healthz update)·CLI(`agent4d update`)·시험이 같이 쓴다.
//  · 확인: GitHub Releases latest 의 tag_name 과 package.json version 을 SemVer 비교. 인증 없음, User-Agent 만, 5초 타임아웃.
//    보내는 것은 그 GET 하나뿐(세션·경로·토큰 등 다른 데이터 없음). 결과는 상태 폴더 update-check.json 에 24시간 캐시.
//  · 꺼짐: config updateCheck:false 또는 AGENT4D_NO_UPDATE_CHECK=1 → 네트워크 호출 0.
//  · 실패(오프라인·API 오류·rate limit)는 조용히: { error } 만 남기고 던지지 않는다. 권한 문제로 단정하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE_FILE = 'update-check.json';
export const CACHE_MS = 24 * 3600 * 1000;
export const ERROR_CACHE_MS = 3600 * 1000; // 실패는 1시간만 기억(오프라인에서 매번 5초 기다리지 않게)
export const TIMEOUT_MS = 5000;

// ── SemVer ──
/** 'v1.2.3' · '1.2.3-rc.1' → { major, minor, patch, pre: [] } | null */
export function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

/** a<b → -1, a=b → 0, a>b → 1. 읽을 수 없으면 null. 사전 배포(-rc)는 같은 번호의 정식보다 작다 */
export function cmpSemver(a, b) {
  const x = parseSemver(a), y = parseSemver(b);
  if (!x || !y) return null;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : (x.pre.length ? -1 : 1);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return +p < +q ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

// ── 저장소 주소(package.json repository 한 곳) ──
/** git URL(https·ssh·git+https·.git 꼬리) → 'owner/repo'(소문자) | null. github.com 만 */
export function githubSlug(url) {
  const s = String(url ?? '').trim();
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(s);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

export function readPackage(file = path.join(ROOT, 'package.json')) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

/** package.json → 'owner/repo'. repository(문자열·객체) > homepage */
export function repoSlugOf(pkg = readPackage()) {
  const r = pkg && pkg.repository;
  return githubSlug(typeof r === 'string' ? r : r && r.url) || githubSlug(pkg && pkg.homepage) || null;
}

export const releasesApi = (slug) => `https://api.github.com/repos/${slug}/releases/latest`;
export const releasesPage = (slug) => `https://github.com/${slug}/releases`;

// ── 꺼짐 ──
export function updateCheckDisabled(cfg = {}, env = process.env) {
  if (cfg && cfg.updateCheck === false) return true;
  const e = String(env.AGENT4D_NO_UPDATE_CHECK ?? '').trim().toLowerCase();
  return e !== '' && e !== '0' && e !== 'false' && e !== 'no';
}

// ── 변경 요약 ──
/** Release 본문(마크다운) → 한두 줄 요약(최대 ~160자). 머리글·빈 줄·링크 표기 정리 */
export function summarizeNotes(body, maxLines = 2, maxLen = 160) {
  const lines = String(body ?? '').split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^[-=*_]{3,}$/.test(l) && !/^<!--/.test(l))
    .map((l) => l.replace(/^[-*+]\s+/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]{1,2}/g, ''))
    .slice(0, maxLines);
  let s = lines.join(' / ');
  if (s.length > maxLen) s = s.slice(0, maxLen - 1).trimEnd() + '…';
  return s;
}

// ── 확인(가짜 fetch 주입 가능) ──
/**
 * GitHub latest release 조회. 던지지 않는다.
 * → { latest, url, notes } | { error: 'offline'|'timeout'|'rate_limited'|'no_release'|'http_<code>'|'bad_response' }
 */
export async function fetchLatest({ slug, fetch: f = globalThis.fetch, timeoutMs = TIMEOUT_MS, userAgent = 'agent4d' } = {}) {
  if (!slug) return { error: 'no_repository' };
  if (typeof f !== 'function') return { error: 'offline' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await f(releasesApi(slug), {
      headers: { 'User-Agent': userAgent, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: ac.signal,
    });
    if (r.status === 404) return { error: 'no_release' };
    if (r.status === 429 || (r.status === 403 && String(r.headers?.get?.('x-ratelimit-remaining') ?? '') === '0')) return { error: 'rate_limited' };
    if (!r.ok) return { error: `http_${r.status}` };
    const j = await r.json();
    const tag = j && typeof j.tag_name === 'string' ? j.tag_name : null;
    if (!tag || !parseSemver(tag)) return { error: 'bad_response' };
    const url = typeof j.html_url === 'string' && /^https:\/\/github\.com\//.test(j.html_url) ? j.html_url : `${releasesPage(slug)}/tag/${tag}`;
    return { latest: tag.replace(/^v/, ''), url, notes: summarizeNotes(j.body) };
  } catch (e) {
    return { error: e && e.name === 'AbortError' ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

// ── 캐시 ──
/** 캐시를 그대로 써도 되는지: 같은 설치 버전·저장소, 성공은 24시간·실패는 1시간 안 */
export function cacheFresh(cache, { now = Date.now(), current, slug, maxAgeMs = CACHE_MS, errorMaxAgeMs = ERROR_CACHE_MS } = {}) {
  if (!cache || typeof cache !== 'object') return false;
  const at = Date.parse(cache.checkedAt);
  if (!Number.isFinite(at) || at > now + 60_000) return false;
  if (current && cache.current !== current) return false;
  if (slug && cache.repo && cache.repo !== slug) return false;
  return now - at < (cache.error ? errorMaxAgeMs : maxAgeMs);
}

/** 확인 결과 → 캐시·출력 레코드 */
export function makeRecord({ current, slug, res, now = Date.now() }) {
  const rec = { checkedAt: new Date(now).toISOString(), repo: slug || null, current };
  if (res.error) return { ...rec, error: res.error };
  const c = cmpSemver(res.latest, current);
  return { ...rec, latest: res.latest, newer: c === 1, url: res.url, notes: res.notes || '' };
}

export function readCache(home) {
  try { return JSON.parse(fs.readFileSync(path.join(home, CACHE_FILE), 'utf8')); } catch { return null; }
}

export function writeCache(home, rec) {
  try {
    fs.mkdirSync(home, { recursive: true });
    const file = path.join(home, CACHE_FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec, null, 2) + '\n');
    fs.renameSync(tmp, file);
  } catch {}
}

/** 가짜 결과(AGENT4D_FAKE_UPDATE=<버전>) — 데모·화면 확인용, 네트워크 없음 */
export function fakeRecord(fake, current, slug, now = Date.now()) {
  const v = String(fake).replace(/^v/, '');
  if (!parseSemver(v)) return null;
  return { checkedAt: new Date(now).toISOString(), repo: slug, current, latest: v, newer: cmpSemver(v, current) === 1,
    url: `${releasesPage(slug || 'burn001/agent4d')}/tag/v${v}`, notes: 'Demo release notes', fake: true };
}

/**
 * 캐시 존중 확인. → 레코드({ checkedAt, current, latest, newer, url, notes } | { …, error } | { disabled: true })
 * force 면 캐시를 건너뛴다. 꺼져 있으면 네트워크도 캐시 쓰기도 없다.
 */
export async function checkForUpdate({ home, current, slug, cfg = {}, env = process.env, force = false, fetch: f, now = Date.now(), timeoutMs } = {}) {
  if (updateCheckDisabled(cfg, env)) return { disabled: true, current };
  if (env.AGENT4D_FAKE_UPDATE) { const r = fakeRecord(env.AGENT4D_FAKE_UPDATE, current, slug, now); if (r) return r; }
  if (!force && home) {
    const c = readCache(home);
    if (cacheFresh(c, { now, current, slug })) return { ...c, cached: true };
  }
  const res = await fetchLatest({ slug, fetch: f, timeoutMs, userAgent: `agent4d/${current}` });
  const rec = makeRecord({ current, slug, res, now });
  if (home) writeCache(home, rec);
  return rec;
}

/** /healthz 에 싣는 최소 형태(성공한 확인만) */
export function publicUpdate(rec) {
  if (!rec || rec.error || rec.disabled || !rec.latest) return null;
  return { current: rec.current, latest: rec.latest, newer: !!rec.newer, url: rec.url };
}

/** 서버용: 기동 시 + intervalMs(기본 1시간)마다 캐시를 보고, 24시간 지났을 때만 실제로 확인. get() 은 마지막 결과(없으면 null) */
export class UpdateChecker {
  constructor({ home, current, slug, cfg = {}, env = process.env, fetch: f, intervalMs = 3600 * 1000, offline = false } = {}) {
    Object.assign(this, { home, current, slug, cfg, env, f, intervalMs, offline });
    this.last = null;
    this.timer = null;
  }
  get disabled() { return updateCheckDisabled(this.cfg, this.env); }
  async run() {
    if (this.disabled) return null;
    // offline(데모)은 가짜 값만 — 실제 네트워크 없음
    if (this.offline && !this.env.AGENT4D_FAKE_UPDATE) return null;
    try { this.last = await checkForUpdate({ home: this.home, current: this.current, slug: this.slug, cfg: this.cfg, env: this.env, fetch: this.f }); } catch {}
    return this.last;
  }
  start() {
    if (this.disabled) return this;
    this.run();
    this.timer = setInterval(() => this.run(), this.intervalMs);
    this.timer.unref?.();
    return this;
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  get() { return publicUpdate(this.last); }
}

// ── 적용 쪽 판정(순수) ──
/** 이 클론이 공개판 클론인지: origin 이 package.json 저장소와 같아야 함(개발 클론·포크는 건너뜀) */
export function isPublicClone(originUrl, slug) {
  const o = githubSlug(originUrl);
  return !!o && !!slug && o === String(slug).toLowerCase();
}

/**
 * 개인 스킬 폴더 판정. info = { exists, isLink, realPath, sourcePath }
 * → 'missing' | 'link'(정션·심볼릭, 또는 실제 경로가 클론의 skills/agent4d) | 'copy'
 */
export function skillInstallKind({ exists, isLink, realPath, sourcePath } = {}) {
  if (!exists) return 'missing';
  if (isLink) return 'link';
  if (realPath && sourcePath && path.resolve(realPath).toLowerCase() === path.resolve(sourcePath).toLowerCase()) return 'link';
  return 'copy';
}

/** 두 파일 목록 맵({ rel: Buffer|string }) 비교 — 원본 파일이 사본에 없거나 내용이 다르면 그 상대 경로 목록 */
export function changedFiles(src, dst) {
  const out = [];
  for (const [rel, buf] of Object.entries(src)) {
    const d = dst[rel];
    if (d === undefined || !Buffer.from(buf).equals(Buffer.from(d))) out.push(rel);
  }
  return out.sort();
}

/** 이전 실행 옵션(state.json) → start 인자. 터널 옵트인·감시·포트·프로젝트 유지 */
export function restartArgs(st = {}) {
  const a = ['start'];
  if (st.port) a.push('--port', String(st.port));
  a.push(st.mode === 'remote' ? '--tunnel' : '--no-tunnel');
  if (st.watchPid) a.push('--watch');
  if (typeof st.project === 'string' && st.project) a.push('--project', st.project);
  return a;
}

/**
 * git 상태 → 갱신 가능 여부. g = { branch, dirty, behind, ahead, ffPossible }
 * → { ok: true, upToDate } | { ok: false, reason: 'branch'|'dirty'|'diverged' }
 */
export function pullPlan(g) {
  if (g.branch !== 'main') return { ok: false, reason: 'branch' };
  if (g.dirty) return { ok: false, reason: 'dirty' };
  if (!g.behind) return { ok: true, upToDate: true };
  if (!g.ffPossible) return { ok: false, reason: 'diverged' };
  return { ok: true, upToDate: false };
}
