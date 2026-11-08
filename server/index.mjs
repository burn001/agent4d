#!/usr/bin/env node
// Agent4D 수집·스트리밍 서버. Node 내장 모듈만 사용. 127.0.0.1 전용.
import { readVersion } from './version.mjs';
import { UpdateChecker, repoSlugOf } from './update.mjs';
import http from 'node:http';
import fs from 'node:fs';
import { pipeline } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, defaultConfigPath } from './config.mjs';
import { checkAuth, unauthorizedHtml, notFoundText } from './auth.mjs';
import { addSecretLiteral } from './redact.mjs';
import { SessionIndex } from './discovery.mjs';
import { RootManager } from './roots.mjs';
import { DemoManager } from './demo.mjs';
import { handleEvents, handleOverviewEvents } from './sse.mjs';
import { OverviewHub, createRealSource } from './overview.mjs';
import { buildProjects } from './projects.mjs';
import { LimitsCollector } from './limits.mjs';
import { SysMemCollector } from './sysmem.mjs'; // 시스템 메모리 게이지
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { timelineOf, pageOf, snapshotAt, PAGE_DEFAULT, PAGE_MAX } from './replay.mjs';
import { ArtifactStore, setServiceScripts, isExternalReq, externalEv, externalSnap, externalPayload } from './artifacts.mjs'; // 작업 대상 층
import { ArchiveSource, isArchiveId, archiveKey, resolveArchiveDir } from './archive.mjs';
import { t } from './cli-i18n.mjs'; // 콘솔 문구(영어 기본, 한국어 로케일이면 한국어)
import { ControlHub, handleControlAdmin, readBody } from './control.mjs'; // 화면 원격 조작
import { sseHeaders } from './sse.mjs';
import { configureExtJobs } from './extjobs.mjs'; // 외부 작업 등록부(상시 서버만 끝난 서술 파일 정리)
import { InteractHub, handleInteractAdmin } from './interact.mjs'; // Interactive 패널(기본 꺼짐, 승인 기기만)
import { sharedPeerAddrBook } from './peer-addr.mjs';
import { ShareStore, checkShare, shareLevel, expiredHtml, shareBlockedPath, shareClean, shareKeepHubEvent, shareFilterHubSnap, shareFilterProjects, shareLang, markShareHtml, shareFilePath, shareReplayOf } from './share.mjs'; // 범위 제한 공유 링크
import { liveFull } from './md-full.mjs'; // 잘린 응답 전체 보기 // 수신함 주소 장부(재생이 보낸 세션 노드를 찾게)

export const VERSION = readVersion(); // package.json 이 근거
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, '..', 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
};

export function parseArgs(argv) {
  const a = { port: null, host: '127.0.0.1', config: null, project: null, session: null, demo: false, privacy: null, webRoot: null, archive: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--port') a.port = Number(v());
    else if (k === '--host') a.host = v();
    else if (k === '--config') a.config = v();
    else if (k === '--project') a.project = v();
    else if (k === '--session') a.session = v();
    else if (k === '--demo') a.demo = true;
    else if (k === '--privacy') a.privacy = v();
    else if (k === '--web-root') a.webRoot = v();
    else if (k === '--archive') a.archive = v(); // 보관함 폴더(읽기 전용)
    else if (k.startsWith('--') && k.includes('=')) { const [kk, vv] = k.split('='); argv.splice(i + 1, 0, vv); argv[i] = kk; i--; }
  }
  return a;
}

function sendJson(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

const GZIP_MIN = 64 * 1024;
/** 64KB 이상이고 Accept-Encoding 에 gzip 이 있으면 압축해서 보낸다. SSE 에는 쓰지 않음 */
async function sendJsonZ(req, res, code, obj, headers = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  const base = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...headers };
  if (body.length >= GZIP_MIN && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    const z = await new Promise((resolve, reject) => zlib.gzip(body, { level: 5 }, (e, out) => (e ? reject(e) : resolve(out))));
    res.writeHead(code, { ...base, 'Content-Encoding': 'gzip', 'Content-Length': z.length });
    res.end(z);
    return;
  }
  res.writeHead(code, { ...base, 'Content-Length': body.length });
  res.end(body);
}

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const truthy = (v, dflt) => (v == null || v === '' ? dflt : !(v === '0' || v === 'false' || v === 'no'));

/** config.project 가 있으면 그 밖 세션은 막는다(재생·라이브 API 공통) */
async function inProject(manager, project, sid) {
  if (!project) return true;
  const pd = manager.projectOf ? await manager.projectOf(sid) : null;
  return pd === project;
}

// /replay/events 응답 버퍼 캐시와 동시 처리 상한. 빌드는 다시 만들기 전까지 바뀌지 않으므로
// (data, from, limit, gzip) 로 직렬화·압축 결과를 재사용하고, 동시에 직렬화하는 요청 수를 묶는다.
const PAGE_CONCURRENCY = 4;
const PAGE_QUEUE_MAX = 16;
let pageActive = 0;
const pageWaiters = [];
const pageBufs = new WeakMap(); // data → Map(key → {status, headers, body})
async function withPageSlot(fn) {
  if (pageActive >= PAGE_CONCURRENCY) {
    if (pageWaiters.length >= PAGE_QUEUE_MAX) return null;
    await new Promise((r) => pageWaiters.push(r));
  }
  pageActive++;
  try { return await fn(); } finally { pageActive--; const w = pageWaiters.shift(); if (w) w(); }
}
async function encodeJson(req, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  if (body.length >= GZIP_MIN && /gzip/.test(String(req.headers['accept-encoding'] || ''))) {
    const z = await new Promise((resolve, reject) => zlib.gzip(body, { level: 5 }, (e, out) => (e ? reject(e) : resolve(out))));
    return { gzip: true, body: z };
  }
  return { gzip: false, body };
}

/** 재생 라우트. 처리했으면 true */
async function handleReplay(req, res, url, manager, project, headers, sx = null) {
  const C = sx ? sx.clean : (x) => x; // 공유 링크면 데이터 잠금
  const p = url.pathname;
  if (p !== '/timeline' && p !== '/replay/events' && p !== '/replay/snapshot') return false;
  if (!manager.replay) { sendJson(res, 404, { error: 'not_found' }, headers); return true; }
  const sid = await manager.resolve(url.searchParams.get('session') || 'auto');
  if (!sid) { sendJson(res, 404, { error: 'not_found' }, headers); return true; }
  // 보관함 세션('arc:<uuid>'): 보관함 출처의 재생 캐시로. 원본과 캐시·빌드가 따로라 같은 세션이 양쪽에 있어도 섞이지 않는다
  const arc = isArchiveId(sid);
  if (arc && sx) { sendJson(res, 404, { error: 'not_found' }, headers); return true; } // 공유 링크는 보관함 재생 불가
  if (arc && !manager.archive) { sendJson(res, 404, { error: 'not_found' }, headers); return true; }
  const src = arc ? manager.archive : manager;
  // config.project 가 있으면 그 밖 세션은 404 (재생 API 가 목록 제한을 우회하지 못하게)
  if (arc ? (project && (await manager.archive.projectOf(sid)) !== project) : !(await inProject(manager, project, sid))) {
    sendJson(res, 404, { error: 'not_found' }, headers); return true;
  }
  if (p === '/timeline') {
    const wait = truthy(url.searchParams.get('wait'), true);
    const refresh = truthy(url.searchParams.get('refresh'), false);
    let r;
    try { r = await src.replay(sid, { wait, refresh }); } catch (e) {
      if (e?.code === 'ENOSESSION' || /not found/i.test(String(e?.message))) { sendJson(res, 404, { error: 'not_found' }, headers); return true; }
      if (e?.code === 'EBUSY') { sendJson(res, 503, { error: 'busy' }, { ...headers, 'Retry-After': '5' }); return true; }
      throw e;
    }
    if (r && r.building) { sendJson(res, 202, { building: true, progress: r.progress }, headers); return true; }
    const tl = timelineOf(r, url.searchParams.get('buckets') ?? 240);
    await sendJsonZ(req, res, 200, C(r.stale ? { ...tl, stale: true } : tl), headers);
    return true;
  }
  const data = src.replayPeek ? src.replayPeek(sid) : null;
  if (!data) { sendJson(res, 409, { error: 'not_built' }, headers); return true; }
  if (p === '/replay/events') {
    const q = { from: url.searchParams.get('from'), fromT: url.searchParams.get('fromT'),
      limit: clampInt(url.searchParams.get('limit'), 1, PAGE_MAX, PAGE_DEFAULT) };
    const wantGz = /gzip/.test(String(req.headers['accept-encoding'] || ''));
    const ext = isExternalReq(req); // 외부 고정 링크면 작업 대상 경로를 접은 쪽
    const key = `${q.from ?? ''}|${q.fromT ?? ''}|${q.limit}|${wantGz ? 'z' : ''}|${ext ? 'x' : ''}|${sx ? 's' + sx.key : ''}`;
    let bufs = pageBufs.get(data);
    if (!bufs) { bufs = new Map(); pageBufs.set(data, bufs); }
    let enc = bufs.get(key);
    if (!enc) {
      enc = await withPageSlot(async () => bufs.get(key) || encodeJson(req, C(ext ? extPage(pageOf(data, q)) : pageOf(data, q))));
      if (!enc) { sendJson(res, 429, { error: 'busy' }, { ...headers, 'Retry-After': '1' }); return true; }
      bufs.set(key, enc);
      while (bufs.size > 64) bufs.delete(bufs.keys().next().value);
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding',
      ...headers, ...(enc.gzip ? { 'Content-Encoding': 'gzip' } : {}), 'Content-Length': enc.body.length });
    res.end(enc.body);
    return true;
  }
  const at = url.searchParams.get('at');
  const snap = snapshotAt(data, at == null || at === '' ? NaN : Number(at));
  await sendJsonZ(req, res, 200, C(isExternalReq(req) ? externalSnap(snap) : snap), headers);
  return true;
}

/** 재생 페이지(events 배열)의 작업 대상 접기(외부 링크) */
function extPage(pg) { return pg && Array.isArray(pg.events) && pg.events.some((e) => e && e.art) ? { ...pg, events: pg.events.map(externalEv) } : pg; }

/** /artifacts?project=<pid>|session=<sid>[&until=<ms>] — 프로젝트 최근 7일 작업 대상(외부 링크·minimal 은 접힘) */
async function handleArtifacts(req, res, url, manager, project, headers) {
  if (!manager.artifacts) return sendJson(res, 200, { projectId: null, building: false, items: [], nodes: {}, counts: {}, disabled: true }, headers);
  let pid = url.searchParams.get('project') || null;
  let sid = url.searchParams.get('session') || null;
  if (sid && isArchiveId(sid)) return sendJson(res, 200, { projectId: null, building: false, items: [], nodes: {}, counts: {}, source: 'archive' }, headers);
  if (sid) { sid = await manager.resolve(sid); if (!sid || !(await inProject(manager, project, sid))) return sendJson(res, 404, { error: 'not_found' }, headers); }
  if (pid && project && pid !== project) return sendJson(res, 404, { error: 'not_found' }, headers);
  if (!pid && !sid) return sendJson(res, 400, { error: 'project_or_session' }, headers);
  const u = Number(url.searchParams.get('until'));
  const out = await manager.artifacts.payload({ projectId: pid, sessionId: sid, untilMs: Number.isFinite(u) && u > 0 ? u : null });
  return sendJsonZ(req, res, 200, isExternalReq(req) ? externalPayload(out) : out, headers);
}

// 버전 붙은 정적 주소(?v=<내용 sha256 앞 8～64자>)는 내용이 바뀌면 주소도 바뀌므로 1년·immutable 로 둔다.
//   해시는 파일(크기·mtime)별로 한 번만 계산(곡 4.6MB ≈ 10ms). 맞지 않거나 없는 v 는 예전처럼 짧은 캐시
const IMMUTABLE_CC = 'public, max-age=31536000, immutable';
const hashMemo = new Map(); // file → {size, mtimeMs, hex}
export function contentHash(file, st) {
  const m = hashMemo.get(file);
  if (m && m.size === st.size && m.mtimeMs === st.mtimeMs) return m.hex;
  let hex = null;
  try { hex = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { hex = null; }
  if (hex) hashMemo.set(file, { size: st.size, mtimeMs: st.mtimeMs, hex });
  return hex;
}
/** 요청 ?v= 가 그 파일 내용 해시(앞부분, 8자 이상)와 맞나 */
export function versionMatches(v, file, st) {
  if (typeof v !== 'string' || !/^[0-9a-f]{8,64}$/i.test(v)) return false;
  const hex = contentHash(file, st);
  return !!hex && hex.startsWith(v.toLowerCase());
}

function serveStatic(req, res, url, webRoot, headers, sx = null) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400, headers); res.end('bad path'); return; }
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel.includes('\0')) { res.writeHead(400, headers); res.end('bad path'); return; }
  const file = path.resolve(webRoot, '.' + rel.replace(/\\/g, '/'));
  if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { res.writeHead(403, headers); res.end('forbidden'); return; }
  let st;
  try { st = fs.statSync(file); } catch { st = null; }
  if (!st || !st.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
    res.end(notFoundText(req.headers['accept-language']));
    return;
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  if (sx && path.extname(file).toLowerCase() === '.html') {
    // 공유 링크: 화면에 공유 표지(data-share)를 넣어 보낸다(조건부 요청·캐시 없음)
    let html;
    try { html = markShareHtml(fs.readFileSync(file, 'utf8'), sx.share); } catch { res.writeHead(404, headers); res.end(); return; }
    if (sx.warm) sx.warm(); // 기본 리플레이: 화면이 모듈을 받는 동안 재생 빌드를 먼저 시작
    const b = Buffer.from(html);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': b.length, ...headers });
    res.end(req.method === 'HEAD' ? undefined : b);
    return;
  }
  const etag = `W/"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Last-Modified': st.mtime.toUTCString(), ETag: etag,
    'Cache-Control': url.searchParams.has('v') && versionMatches(url.searchParams.get('v'), file, st) ? IMMUTABLE_CC
      : /\.(mp3|png|jpg|woff2)$/i.test(file) ? 'public, max-age=3600' : 'no-cache', ...headers };
  // 조건부 요청: 바뀌지 않았으면 304(본문 없음). 고정 링크(Worker→터널) 경유 재방문 때 모듈·CSS 를 다시 내려받지 않는다.
  // 범위 요청(Range)에도 적용(RFC 9110 — 조건이 Range 보다 먼저): 캐시가 만료된 <audio> 는 Range + If-None-Match 로
  // 재검증하는데, 예전엔 Range 면 조건을 무시하고 206 본문(곡 전체 4.6MB)을 다시 보냈다(반복 전송의 원인)
  const inm = req.headers['if-none-match'];
  const ims = Date.parse(req.headers['if-modified-since'] || '');
  if ((inm && inm.split(',').some((x) => x.trim() === etag || x.trim() === '*')) || (!inm && Number.isFinite(ims) && Math.floor(st.mtimeMs / 1000) * 1000 <= ims)) {
    const { 'Content-Type': _ct, 'Accept-Ranges': _ar, ...h304 } = base;
    res.writeHead(304, h304);
    res.end();
    return;
  }
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = m && m[1] !== '' ? Number(m[1]) : NaN;
    let end = m && m[2] !== '' ? Number(m[2]) : NaN;
    if (m && Number.isNaN(start) && !Number.isNaN(end)) { start = Math.max(0, st.size - end); end = st.size - 1; }
    if (Number.isNaN(end) || end >= st.size) end = st.size - 1;
    if (!m || Number.isNaN(start) || start > end || start >= st.size) {
      res.writeHead(416, { ...base, 'Content-Range': `bytes */${st.size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') { res.end(); return; }
    pipeline(fs.createReadStream(file, { start, end }), res, () => {}); // 오류(EBUSY·삭제 등)는 응답만 끊는다
    return;
  }
  res.writeHead(200, { ...base, 'Content-Length': st.size });
  if (req.method === 'HEAD') { res.end(); return; }
  pipeline(fs.createReadStream(file), res, () => {});
}

const LIMITS_DISABLED = { ok: true, source: null, five_hour: null, seven_day: null, disabled: true };

/** 3차 라우트: /projects, /limits · /mem. 처리했으면 true */
async function handleV3(req, res, url, manager, limits, headers, mem = null) {
  const p = url.pathname;
  if (p === '/mem') {
    const cur = mem ? mem.current() : null;
    sendJson(res, 200, cur ? { ok: true, ...cur } : { ok: true, disabled: true }, headers);
    return true;
  }
  if (p === '/limits') {
    const cur = limits ? await limits.get() : LIMITS_DISABLED;
    sendJson(res, 200, cur, headers);
    return true;
  }
  if (p === '/projects') {
    if (!manager.projectList) { sendJson(res, 404, { error: 'not_found' }, headers); return true; }
    const out = await manager.projectList({ inactive: truthy(url.searchParams.get('inactive'), false), temp: truthy(url.searchParams.get('temp'), false) });
    await sendJsonZ(req, res, 200, out, headers);
    return true;
  }
  return false;
}

/** scope 질의: 없음·'session' → null(기존 경로), 'all' → 'all', 그 밖 → 'bad' */
function scopeOf(url) {
  const s = url.searchParams.get('scope');
  if (s == null || s === '' || s === 'session') return null;
  return s === 'all' ? 'all' : 'bad';
}

/** 공유 링크 기본 리플레이 미리 만들기: 캐시에 없을 때만 뒤에서 빌드(있으면 LRU 순서도 건드리지 않음) */
export function warmShareReplays(manager, sids) {
  if (!manager || !manager.replay) return 0;
  let n = 0;
  for (const sid of sids || []) {
    if (!sid || (manager.replays && manager.replays.has(sid))) continue;
    n++;
    Promise.resolve().then(() => manager.replay(sid, { wait: false })).catch(() => {});
  }
  return n;
}

/**
 * 공유 링크 요청 처리 — 한 프로젝트·데이터 잠금. 막힌 경로(Interactive·실황 원문·화면 조작·작업 대상·보관함)는 403,
 * 한도·메모리·보관함 요약은 '꺼짐' 응답. 나머지는 원래 처리 + shareClean.
 */
async function handleShare(req, res, url, sx, { manager, headers, webRoot }) {
  const p = url.pathname;
  const sh = sx.share, C = sx.clean, project = sh.project;
  if (shareBlockedPath(p, url)) return sendJson(res, 403, { error: 'share_blocked' }, headers);
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method' }, headers);
  if (p === '/limits') return sendJson(res, 200, LIMITS_DISABLED, headers);
  if (p === '/mem') return sendJson(res, 200, { ok: true, disabled: true }, headers);
  if (p === '/archive') return sendJson(res, 200, { enabled: false, count: 0, projects: [], sessions: [] }, headers);
  const guard = () => !!sx.store && sx.store.stillValid(sh);
  if (p === '/sessions') {
    const limit = clampInt(url.searchParams.get('limit'), 1, 500, 30);
    const kindQ = url.searchParams.get('kind');
    const sinceQ = url.searchParams.get('since');
    const sinceMs = sinceQ == null || sinceQ === '' ? null : (/^\d+$/.test(sinceQ) ? Number(sinceQ) : Date.parse(sinceQ));
    const opts = { project, kind: kindQ === 'main' ? 'main' : 'all', sort: url.searchParams.get('sort') === 'start' ? 'start' : 'recent',
      since: Number.isFinite(sinceMs) ? sinceMs : null, extended: true };
    const sessions = manager.list ? await manager.list(limit, opts) : [];
    const projects = manager.projects ? (await manager.projects()).filter((x) => x && (x.projectDir === project || x.projectId === project)) : [];
    return sendJsonZ(req, res, 200, C({ sessions, auto: null, projects }), headers);
  }
  if (p === '/projects') {
    if (!manager.projectList) return sendJson(res, 404, { error: 'not_found' }, headers);
    const out = await manager.projectList({ inactive: false, temp: false });
    return sendJsonZ(req, res, 200, C(shareFilterProjects(out, sh)), headers);
  }
  if (await handleReplay(req, res, url, manager, project, headers, sx)) return;
  if ((p === '/state' || p === '/events') && scopeOf(url)) {
    const sc = scopeOf(url);
    if (sc === 'bad' || !manager.overview) return sendJson(res, sc === 'bad' ? 400 : 404, { error: sc === 'bad' ? 'bad_scope' : 'not_found' }, headers);
    const hub = manager.overview();
    if (p === '/events') {
      await handleOverviewEvents(req, res, url, hub, { headers, limits: null, mem: null, external: true, clean: C, guard,
        keep: (e) => shareKeepHubEvent(e, sh), snapFilter: (s) => shareFilterHubSnap(s, sh), projFilter: (x) => shareFilterProjects(x, sh) });
      return;
    }
    await hub.wake();
    return sendJsonZ(req, res, 200, C(externalSnap(shareFilterHubSnap(hub.snapshot(), sh))), headers);
  }
  if (p === '/state' || p === '/events') {
    const sid = await manager.resolve(url.searchParams.get('session') || 'auto');
    if (!sid || isArchiveId(sid) || !(await inProject(manager, project, sid))) return sendJson(res, 404, { error: 'not_found' }, headers);
    if (p === '/events') {
      url.searchParams.set('session', sid); // 'auto' 가 다른 프로젝트 세션으로 넘어가지 않게 고정
      await handleEvents(req, res, url, manager, { headers, limits: null, mem: null, external: true, clean: C, guard });
      return;
    }
    let rt;
    try { rt = await manager.peek(sid); } catch { return sendJson(res, 404, { error: 'not_found' }, headers); }
    return sendJson(res, 200, C(externalSnap(rt.graph.snapshot())), headers);
  }
  return serveStatic(req, res, url, path.resolve(webRoot), headers, sx);
}

export function createServer({ token, manager, webRoot = WEB_ROOT, project = null, limits = null, mem = null, update = null, adminSecret = null, errorLingerSec = null, shares = null }) {
  const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const control = new ControlHub({ manager }); // 화면 등록·명령 전달·ack
  const srv = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); res.end(); return; }
    const p = url.pathname;
    try {
      if (p === '/healthz') {
        // update {current, latest, newer, url} — 마지막 확인이 성공했을 때만(꺼짐·실패면 키 없음)
        const u = update ? update.get() : null;
        const body = u ? { ok: true, version: VERSION, update: u } : { ok: true, version: VERSION };
        if (errorLingerSec != null) body.errorLingerSec = errorLingerSec; // 문제 있게 끝난 노드가 남는 시간(config.errorLingerSec)
        return sendJson(res, 200, body, SEC);
      }
      // 명령 보내기·화면 목록: 로컬 관리자만(루프백 + 프록시 표지 없음 + adminSecret). 보기 토큰과 무관하게 먼저 판정
      if (p === '/control' || p === '/control/clients') { await handleControlAdmin(req, res, url, control, { adminSecret, sendJson, SEC }); return; }
      // Interactive 관리(승인·취소·켬/끔): 로컬 관리자만 — /control 과 같은 문지기
      if (p === '/interact/admin') { await handleInteractAdmin(req, res, url, ixHub(), { adminSecret, sendJson, SEC }); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD' && !(req.method === 'POST' && (p === '/control/ack' || p.startsWith('/interact/')))) { res.writeHead(405, SEC); res.end(); return; }

      let auth = checkAuth(req, url, token);
      let sx = null; // 공유 링크 문맥 {share, clean, key, store}
      if (!auth.ok) {
        const sa = checkShare(req, url, shares);
        if (sa && sa.ok) {
          const ctx = { share: sa.share, lang: shareLang(req), level: shareLevel(sa.share) }; // 잠금 등급
          sx = { share: sa.share, clean: (o) => shareClean(o, ctx), key: sa.share.id + ctx.lang + ctx.level, store: shares,
            warm: () => warmShareReplays(manager, [shareReplayOf(sa.share)?.session]) };
          auth = { ok: true, via: 'share', setCookie: sa.setCookie, redirect: sa.redirect };
        } else if (sa && sa.expired) {
          const wantsHtml = p === '/' || p.endsWith('.html') || String(req.headers.accept || '').includes('text/html');
          if (wantsHtml) { res.writeHead(410, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SEC }); res.end(expiredHtml(req.headers['accept-language'])); }
          else sendJson(res, 410, { error: 'expired' }, SEC);
          return;
        }
      }
      if (!auth.ok) {
        const wantsHtml = p === '/' || p.endsWith('.html') || String(req.headers.accept || '').includes('text/html');
        if (wantsHtml && !p.startsWith('/state') && !p.startsWith('/events') && !p.startsWith('/sessions')
          && !p.startsWith('/timeline') && !p.startsWith('/replay/') && p !== '/projects' && p !== '/limits' && p !== '/mem' && p !== '/archive') {
          res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', ...SEC });
          res.end(unauthorizedHtml(req.headers['accept-language']));
        } else sendJson(res, 401, { error: 'unauthorized' }, SEC);
        return;
      }
      const headers = { ...SEC };
      if (auth.setCookie) headers['Set-Cookie'] = auth.setCookie;
      if (auth.redirect) { res.writeHead(302, { ...headers, Location: auth.redirect, 'Cache-Control': 'no-store' }); res.end(); return; }
      if (sx) return await handleShare(req, res, url, sx, { manager, headers, webRoot });
      // 화면 쪽(보기 토큰): 명령 적용 결과·상태 알림, 데이터 SSE 가 없을 때(재생 중 등)의 명령 전용 SSE
      if (p === '/control/ack') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' }, headers);
        let body;
        try { body = await readBody(req); } catch { return sendJson(res, 400, { error: 'bad_json' }, headers); }
        return sendJson(res, control.ack(body) ? 200 : 404, { ok: true }, headers);
      }
      if (p === '/control/events') {
        req.socket.setNoDelay?.(true);
        req.socket.setTimeout?.(0);
        res.writeHead(200, sseHeaders(headers));
        res.write('retry: 3000\n\n');
        const off = control.attach(req, res, url);
        const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15_000);
        req.on('close', () => { clearInterval(ping); off(); });
        return;
      }

      // Interactive(보기 토큰 + 승인 기기 서명). 기능이 꺼져 있으면 status 말고는 403
      if (p.startsWith('/interact/') && await ixHub().handle(req, res, url, { sendJson, headers })) return;

      // 잘린 실황 응답 전체 보기(보기 토큰 뒤, 누를 때만): mdRef {s,u,b} → 원문. minimal 이면 403, config.project 밖이면 404
      if (p === '/md/full') {
        if ((manager.privacy || 'summary') === 'minimal') return sendJson(res, 403, { error: 'minimal' }, headers);
        const s = String(url.searchParams.get('s') || '').toLowerCase();
        if (!/^[0-9a-f-]{36}$/.test(s)) return sendJson(res, 400, { error: 'bad_ref' }, headers);
        let entry = manager.index?.findSession?.(s) || null, arc = false;
        if (!entry && manager.archive?.index) { entry = manager.archive.index.findSession(s); arc = !!entry; }
        if (!entry || (project && entry.projectDir !== project)) return sendJson(res, 404, { error: 'not_found' }, headers);
        const r = liveFull({ entry, uuid: String(url.searchParams.get('u') || '').toLowerCase(), block: url.searchParams.get('b') });
        if (r.error) return sendJson(res, r.status || 404, { error: r.error }, headers);
        return sendJsonZ(req, res, 200, { ok: true, md: r.md, ...(r.cut ? { cut: 1 } : {}), ...(arc ? { archive: true } : {}) }, { ...headers, 'Cache-Control': 'no-store' });
      }

      if (p === '/sessions') {
        // 프로젝트를 좁히면(매크로 타임라인) 500개까지, sort=start|recent, since=epoch ms|ISO
        const projQ = url.searchParams.get('project') || null;
        const limit = clampInt(url.searchParams.get('limit'), 1, projQ ? 500 : 200, 30);
        const kindQ = url.searchParams.get('kind');
        const sinceQ = url.searchParams.get('since');
        const sinceMs = sinceQ == null || sinceQ === '' ? null : (/^\d+$/.test(sinceQ) ? Number(sinceQ) : Date.parse(sinceQ));
        const opts = { project: projQ, kind: kindQ === 'main' ? 'main' : 'all',
          sort: url.searchParams.get('sort') === 'start' ? 'start' : 'recent',
          since: Number.isFinite(sinceMs) ? sinceMs : null,
          extended: ['limit', 'kind', 'project'].some((k) => url.searchParams.has(k)) };
        // 질의 project 는 좁히기만 한다: config.project 와 다르면 빈 목록
        const blocked = project && opts.project && opts.project !== project;
        // source=archive: 보관함 세션 목록(sessionId 'arc:…', archive:true, archiveMeta). config.project 면 그 프로젝트로 좁힘
        if (url.searchParams.get('source') === 'archive') {
          if (!manager.archive || blocked) return sendJson(res, 200, { sessions: [], auto: null, projects: [], source: 'archive' }, headers);
          const sessions = await manager.archive.list(limit, { ...opts, project: opts.project || project || null });
          return sendJsonZ(req, res, 200, { sessions, auto: null, projects: [], source: 'archive' }, headers);
        }
        const sessions = blocked ? [] : await manager.list(limit, opts);
        const auto = await manager.resolve('auto');
        const projects = manager.projects ? await manager.projects() : [];
        return sendJson(res, 200, { sessions, auto: auto || null, projects }, headers);
      }
      if (p === '/archive') {
        // 보관함 요약(선택기 묶음·설명 카드). 꺼져 있으면 enabled:false
        if (!manager.archive) return sendJson(res, 200, { enabled: false, count: 0, projects: [], sessions: [] }, headers);
        return sendJsonZ(req, res, 200, await manager.archive.summary({ project }), headers);
      }
      // 보관 세션은 실시간 대상이 아니다
      if ((p === '/state' || p === '/events') && isArchiveId(url.searchParams.get('session') || '')) return sendJson(res, 404, { error: 'not_found' }, headers);
      if (await handleReplay(req, res, url, manager, project, headers)) return;
      if (p === '/artifacts') return await handleArtifacts(req, res, url, manager, project, headers);
      if (await handleV3(req, res, url, manager, limits, headers, mem)) return;
      if ((p === '/state' || p === '/events') && scopeOf(url)) {
        const sc = scopeOf(url);
        if (sc === 'bad' || !manager.overview) return sendJson(res, sc === 'bad' ? 400 : 404, { error: sc === 'bad' ? 'bad_scope' : 'not_found' }, headers);
        const hub = manager.overview();
        if (p === '/events') { await handleOverviewEvents(req, res, url, hub, { headers, limits, mem, external: isExternalReq(req) }); control.attach(req, res, url); return; }
        await hub.wake();
        const hs = hub.snapshot();
        return sendJsonZ(req, res, 200, isExternalReq(req) ? externalSnap(hs) : hs, headers);
      }
      if (p === '/state') {
        const sid = await manager.resolve(url.searchParams.get('session') || 'auto');
        if (!sid || !(await inProject(manager, project, sid))) return sendJson(res, 404, { error: 'not_found' }, headers);
        let rt;
        try { rt = await manager.peek(sid); } catch { return sendJson(res, 404, { error: 'not_found' }, headers); }
        const gs = rt.graph.snapshot();
        return sendJson(res, 200, isExternalReq(req) ? externalSnap(gs) : gs, headers);
      }
      if (p === '/events') {
        if (project) {
          const sid = await manager.resolve(url.searchParams.get('session') || 'auto');
          if (!sid || !(await inProject(manager, project, sid))) return sendJson(res, 404, { error: 'not_found' }, headers);
        }
        await handleEvents(req, res, url, manager, { headers, limits, mem, external: isExternalReq(req) });
        control.attach(req, res, url); // client= 가 있으면 이 SSE 로 명령도 받는다(SSE 가 열렸을 때만)
        return;
      }
      return serveStatic(req, res, url, path.resolve(webRoot), headers);
    } catch (e) {
      console.error('[ccviz] ' + t('server.reqError'), p, e);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
      else res.end();
    }
  });
  srv.control = control;
  // Interactive 허브: 처음 쓸 때 만든다(시험은 srv.interact 에 미리 넣어 상태 폴더·세션 폴더를 바꾼다)
  function ixHub() { return srv.interact || (srv.interact = new InteractHub({ index: manager.index || null, project, privacy: manager.privacy || 'summary' })); }
  return srv;
}

/** 실제 파일 기반 매니저(list 포함) */
export function createRealManager({ project = null, session = null, privacy = 'summary', projectsDir, sessionsDir,
  overviewMaxRoots = 12, hubOptions = {}, archiveDir = null } = {}) {
  const index = new SessionIndex({ project, fixedSession: session ? session.toLowerCase() : null, projectsDir, sessionsDir, addrBook: sessionsDir ? null : sharedPeerAddrBook() }); // (세션 폴더를 따로 준 시험·도구는 상태 폴더 장부를 쓰지 않음)
  const mgr = new RootManager({ index, privacy });
  // 보관함: 읽기 전용 두 번째 출처. 실시간 감시·autoPick·전체 보기 허브와 무관(재생·목록만)
  if (archiveDir) mgr.archive = new ArchiveSource({ dir: archiveDir, privacy });
  // 3차: 전체 보기 허브(처음 쓸 때 만든다)와 /projects 집계
  mgr.overview = () => mgr.hub || (mgr.hub = new OverviewHub({ source: createRealSource({ manager: mgr, index, maxRoots: overviewMaxRoots }), ...hubOptions }));
  mgr.projectList = (opts = {}) => buildProjects(index, { ...opts, maxRoots: overviewMaxRoots, overview: mgr.hub?.info() || null });
  mgr.list = async (limit, opts) => {
    const list = await index.list(limit, opts);
    // 재생 캐시에 있으면 정확한 이벤트 수
    for (const s of list) {
      const d = mgr.replays.cache.get(s.sessionId);
      if (d) { s.eventCount = d.events.length; s.replayCached = true; }
    }
    return list;
  };
  mgr.projects = () => index.projects();
  mgr.artifacts = new ArtifactStore({ index, privacy }); // 요청이 올 때만 훑는다(끄면 비용 0)
  return mgr;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(args.config || defaultConfigPath());
  addSecretLiteral(cfg.viewToken);
  if (cfg.adminSecret) addSecretLiteral(cfg.adminSecret);
  setServiceScripts(cfg.serviceScripts); // 작업 대상 서비스 이름(사용자 설정, 기본 없음)
  const port = args.port || cfg.port || 7788;
  const host = args.host || '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    console.error('[ccviz] ' + t('server.bindWarn'), host);
  }
  const privacy = args.privacy || cfg.privacy || 'summary';
  const project = args.project || cfg.project || null;
  let manager;
  if (args.demo) manager = new DemoManager({ privacy });
  else {
    manager = createRealManager({ project, session: args.session, privacy, overviewMaxRoots: cfg.overviewMaxRoots,
      archiveDir: resolveArchiveDir({ arg: args.archive, cfg }) });
    configureExtJobs({ prune: true }); // 끝난 지 keepSec 넘은 <상태 폴더>/jobs/*.json 정리
    // 색인 전체 스캔은 부하가 크면 수십 초 걸린다. listen 을 먼저 하고 색인은 뒤에서 채운다
    // (/sessions·/state 는 진행 중인 refresh 를 기다린다). /healthz 는 즉시 응답.
  }
  // 3차: 사용 한도 수집기. --demo 는 실제 파일·네트워크를 쓰지 않는 고정 값
  const limits = new LimitsCollector({ ...cfg.limits, demo: !!args.demo, version: VERSION }).start();
  // 시스템 메모리(이 PC RAM): os.totalmem/freemem 을 pollSec(기본 10초)마다. --demo 는 고정 값
  const mem = new SysMemCollector({ ...cfg.memory, demo: !!args.demo }).start();
  // 업데이트 확인: 기동 시 + 1시간마다 캐시를 보고 24시간 지났을 때만 네트워크, 꺼짐이면 네트워크 0. --demo 는 AGENT4D_FAKE_UPDATE 가짜 값만
  const update = new UpdateChecker({ home: path.dirname(args.config || defaultConfigPath()), current: VERSION, slug: repoSlugOf(),
    cfg: { updateCheck: cfg.updateCheck }, offline: !!args.demo }).start();
  const shares = new ShareStore({ file: shareFilePath(path.dirname(args.config || defaultConfigPath())) });
  const server = createServer({ token: cfg.viewToken, manager, webRoot: args.webRoot || WEB_ROOT, project, limits, mem, update, adminSecret: cfg.adminSecret, shares,
    errorLingerSec: cfg.errorLingerSec != null && Number.isFinite(+cfg.errorLingerSec) && +cfg.errorLingerSec >= 0 ? +cfg.errorLingerSec : null });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 0;
  server.on('error', (e) => { console.error('[ccviz] ' + t('server.error'), e.message); process.exit(1); });
  server.listen(port, host, () => {
    process.stdout.write(`CCVIZ_READY ${JSON.stringify({ port: server.address().port, pid: process.pid })}\n`);
    if (cfg.created) console.error('[ccviz] ' + t('server.configCreated', { file: cfg.file }));
  });
  const shutdown = () => { try { manager.stop?.(); } catch {} try { limits.stop(); } catch {} try { mem.stop(); } catch {} try { update.stop(); } catch {} try { sharedPeerAddrBook().close(); } catch {} server.close(); setTimeout(() => process.exit(0), 300).unref(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // 색인 스캔 → 자동 감시 시작 → 자동 선택 대상 미리 적재(첫 접속 지연 줄이기)
  if (!args.demo) {
    const t0 = Date.now();
    manager.index.refresh()
      .then(() => console.error('[ccviz] ' + t('server.indexDone', { sec: ((Date.now() - t0) / 1000).toFixed(1) })))
      .catch((e) => console.error('[ccviz] ' + t('server.indexFail'), e?.message || e))
      .finally(() => {
        manager.startAutoWatch(5000);
        manager.resolve('auto').then((sid) => sid && manager.peek(sid)).catch(() => {});
        // 공유 링크 기본 리플레이: 발표 중 첫 화면이 빌드(큰 세션 ～20초)를 기다리지 않게 미리 만들고, 밀려나면 10분 안에 다시
        const warm = () => warmShareReplays(manager, shares.replaySessions());
        setTimeout(warm, 20_000).unref();
        setInterval(warm, 600_000).unref();
      });
  }
  // 예기치 못한 예외로 서버 전체가 내려가지 않도록 로그만 남긴다(감시는 ccviz watch 가 맡음)
  process.on('uncaughtException', (e) => console.error('[ccviz] ' + t('server.uncaught'), e?.stack || e));
  process.on('unhandledRejection', (e) => console.error('[ccviz] ' + t('server.unhandled'), e?.stack || e));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error('[ccviz] ' + t('server.startFail'), e); process.exit(1); });
