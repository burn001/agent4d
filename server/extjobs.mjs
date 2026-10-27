// 외부 작업 등록부 — Claude 세션 밖에서 따로 띄운 오래 도는 작업(Start-Process 로 분리한 측정 팔·배치 python 등)을
// 서술 파일로 받아 로그 꼬리·PID 생존·끝 표지 파일·오류 줄로 진행과 끝을 판정하고, 붙일 세션 메인 아래 작업 노드로 낸다
//. 작업 하나 = 서술 파일 하나: `<상태 폴더>/jobs/<id>.json`.
//
// 읽기만 한다: 로그·끝 표지·~/.claude 는 읽기 전용. 서술 파일은 정리를 켠 등록부(상시 서버·CLI prune)만 끝난 지 오래된 것을 지운다.
// 이 파일은 그래프를 모른다(순수 판정 + 파일 읽기). 노드·이벤트는 session.mjs `_extJobsSweep` 이 낸다.
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { ccvizHome } from './home.mjs';
import { pidAlive as pidAliveDefault } from './discovery.mjs';
import { encodeCwd, truncate } from './parse.mjs';
import { redact } from './redact.mjs';
import { resolveClock } from './jobs.mjs';

export const EXT = {
  DIR: 'jobs',               // <상태 폴더>/jobs/*.json
  REFRESH_MS: 4000,          // 등록부 다시 읽기 간격(여러 세션 런타임이 함께 써도 한 번)
  TAIL_KB: 64,               // 처음 붙을 때 로그 끝 이만큼만(잘린 첫 줄 버림)
  ERR_TAIL_KB: 256,          // 오류 로그(stderr)는 조금 더
  READ_MAX: 1 << 20,         // 한 번에 읽는 상한(넘게 자랐으면 끝 쪽만)
  PARTIAL_MAX: 8000,         // 줄 끝을 기다리는 조각 상한
  KEEP_SEC: 12 * 3600,       // 끝난 뒤 서술 파일을 남겨 두는 시간(정리 켠 등록부가 지움, 서술 파일 keepSec 이 이김)
  MAX_AGE_SEC: 14 * 86400,   // 끝 판정 없이 이만큼 지났고
  GIVEUP_QUIET_SEC: 3 * 86400, //   로그도 이만큼 조용하면 끝(실패 'gave-up') — PID 재사용으로 영영 살아 보이는 것 막기
  STALE_SEC: 900,            // 작업 정체 문턱 기본(서술 파일 staleSec 이 이김) — 웹 jobStale 이 판정
  BEAT_QUIET_MS: 60_000,     // 진행 줄 없는(로그가 빈) 작업은 생존 확인을 박동으로, 이 간격으로 끊어 낸다
  HIST: 12,                  // 처리율 표본 수
  ID_MAX: 64, NAME_MAX: 80, PHASE_MAX: 120, LINE_MAX: 160,
  END_SLACK_MS: 5000,        // 끝 표지 파일 mtime 이 작업 시작보다 이만큼 넘게 이르면 지난 실행의 것(무시)
};

/** 진행 정규식이 없을 때의 일반 규칙: `12/40` · `2,538/125,712` (한 줄에 여럿이면 n ≤ total 인 첫 것) */
export const DEFAULT_PATTERN = '(\\d[\\d,]*)\\s*/\\s*(\\d[\\d,]*)';
/** 오류 줄 기본: 파이썬 Traceback · `XxxError:`·`Exception` 줄 · FATAL/panic · Killed · Segmentation fault */
export const ERROR_PATTERN = '^(?:Traceback \\(most recent call last\\):|\\s*(?:[A-Za-z_][\\w.]*)?(?:Error|Exception)(?::\\s|:?\\s*$)|(?:FATAL|Fatal error|panic):|\\s*Killed\\s*$|Segmentation fault)';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** 등록부 폴더 */
export const extJobsDir = (home = ccvizHome()) => path.join(home, EXT.DIR);

/** 작업 id → 파일 이름 조각: 글자·숫자·`._-` 만, 64자 */
export function safeExtId(s) {
  const v = String(s ?? '').normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, EXT.ID_MAX);
  return v || null;
}

const clean = (v, n) => {
  if (v == null || v === '') return null;
  const s = String(v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return s ? truncate(redact(s), n) : null;
};
const num = (s) => { if (s == null || s === '') return NaN; const v = Number(String(s).replace(/[,_\s]/g, '')); return Number.isFinite(v) ? v : NaN; };
const isoOf = (v) => { if (v == null || v === '') return null; const t = typeof v === 'number' ? v : Date.parse(String(v)); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** 기간: 수(초) · '90' · '90s' · '15m' · '2h' · '1d' · '1h30m' · '2시간 30분' → 초(없거나 잘못이면 null) */
export function parseDuration(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const s = String(v).trim().toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(s)) { const x = +s; return x > 0 ? x : null; }
  const U = { s: 1, sec: 1, '초': 1, m: 60, min: 60, '분': 60, h: 3600, hr: 3600, '시간': 3600, d: 86400, '일': 86400 };
  let total = 0, any = false;
  const re = /(\d+(?:\.\d+)?)\s*(sec|min|hr|시간|초|분|일|[smhd])/g;
  let m;
  let rest = s;
  while ((m = re.exec(s))) { total += +m[1] * U[m[2]]; any = true; rest = rest.replace(m[0], ''); }
  if (!any || rest.replace(/[\s,]/g, '')) return null;
  return total > 0 ? total : null;
}

/** 경로: 절대면 그대로, 상대면 base 기준(없으면 null) */
function absPath(p, base) {
  if (typeof p !== 'string' || !p.trim()) return null;
  const s = p.trim();
  if (path.isAbsolute(s)) return path.normalize(s);
  return base ? path.resolve(base, s) : null;
}

/**
 * 서술 파일 원본 → 정규화한 서술. 필수: log, 그리고 pid·endFile 중 하나.
 * @returns {{ ok:boolean, desc:object|null, errors:string[] }}
 */
export function normDescriptor(raw, { id: fileId = null } = {}) {
  const errors = [];
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!o) return { ok: false, desc: null, errors: ['서술 파일은 JSON 객체여야 한다'] };
  const cwd = typeof o.cwd === 'string' && o.cwd.trim() ? path.normalize(o.cwd.trim()) : null;
  const log = absPath(o.log ?? o.logPath, cwd);
  if (!log) errors.push('log(로그 파일 절대 경로)가 필요하다');
  const pidN = Number(o.pid);
  const pid = Number.isInteger(pidN) && pidN > 0 ? pidN : null;
  if (o.pid != null && o.pid !== '' && !pid) errors.push('pid 는 양의 정수');
  const endFile = absPath(o.endFile ?? o.end ?? o.marker, cwd);
  if (!pid && !endFile) errors.push('pid 와 endFile 중 하나는 있어야 끝을 판정한다');
  const errLog = absPath(o.errLog ?? o.stderr, cwd);
  let pattern = null;
  if (o.pattern != null && o.pattern !== '') {
    pattern = String(o.pattern);
    try { new RegExp(pattern); } catch (e) { errors.push(`pattern 정규식 오류: ${e.message}`); }
  }
  let errorPattern = ERROR_PATTERN;
  if (o.errorPattern === '' || o.errorPattern === false) errorPattern = null;
  else if (o.errorPattern != null) {
    errorPattern = String(o.errorPattern);
    try { new RegExp(errorPattern); } catch (e) { errors.push(`errorPattern 정규식 오류: ${e.message}`); }
  }
  const totalN = num(o.total);
  const sid = typeof o.sessionId === 'string' && UUID_RE.test(o.sessionId.trim()) ? o.sessionId.trim().toLowerCase() : null;
  if (o.sessionId != null && o.sessionId !== '' && !sid) errors.push('sessionId 는 세션 UUID');
  const id = safeExtId(o.id ?? fileId) || (log ? safeExtId(path.basename(log).replace(/\.[^.]+$/, '')) : null);
  if (!id) errors.push('id 를 정하지 못했다');
  const name = clean(o.name ?? o.title, EXT.NAME_MAX) || (log ? `${path.basename(path.dirname(log))}/${path.basename(log)}` : id);
  const desc = {
    v: 1, id, name, pid, log, errLog, endFile, pattern, errorPattern,
    total: Number.isFinite(totalN) && totalN > 0 ? totalN : null,
    expectSec: parseDuration(o.expectSec ?? o.expect),
    staleSec: parseDuration(o.staleSec),
    keepSec: parseDuration(o.keepSec ?? o.keep),
    cwd, sessionId: sid,
    startedAt: isoOf(o.startedAt), createdAt: isoOf(o.createdAt),
  };
  return { ok: errors.length === 0, desc: errors.length ? null : desc, errors };
}

/** 진행 정규식 컴파일(서술 pattern → 없으면 일반 규칙). 기본 규칙은 한 줄에서 여러 번 찾는다 */
export function compileProgress(desc) {
  const src = desc && desc.pattern ? desc.pattern : DEFAULT_PATTERN;
  return { re: new RegExp(src, 'g'), generic: !(desc && desc.pattern), total: desc ? desc.total : null };
}

/**
 * 한 줄에서 진행 n/total. 묶음 이름 n·total 이 있으면 그것, 없으면 1·2번 묶음. total 묶음이 없으면 서술 total.
 * n > total 이거나 total ≤ 0 이면 그 맞춤은 버리고 다음 것(날짜 `2026/10` 같은 오탐).
 * @returns {{n:number,total:number}|null}
 */
export function matchProgress(line, prog) {
  if (!line || !prog) return null;
  const re = prog.re;
  re.lastIndex = 0;
  let m, guard = 0;
  while ((m = re.exec(line)) && guard++ < 16) {
    if (m[0] === '') { re.lastIndex++; continue; }
    const g = m.groups || {};
    const n = num(g.n ?? m[1]);
    const t = num(g.total ?? m[2] ?? prog.total);
    if (Number.isFinite(n) && Number.isFinite(t) && t > 0 && n >= 0 && n <= t) return { n, total: t };
  }
  return null;
}

/** 줄 머리의 시각(`2026-10-27 12:08:51` · `12:08:51` · `[12:08:51]`) → ms, 없으면 NaN */
export function lineClockMs(line, refMs) {
  const m = /^\s*\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?|\d{1,2}:\d{2}:\d{2})\b/.exec(line || '');
  if (!m) return NaN;
  const iso = resolveClock(m[1], refMs, 'past');
  return iso ? Date.parse(iso) : NaN;
}

/**
 * 끝 판정(순수). 끝 표지 파일이 이긴다 → done. PID 가 사라졌으면 오류 줄이 있거나 끝 표지를 약속했는데 없으면 failed,
 * 아니면 done(종료 코드 미상). PID 없이 등록한 작업은 오류 줄이 곧 끝(failed). 오래 조용하면 포기(failed).
 * @returns {{state:'done'|'failed', reason:'end-file'|'pid-gone'|'error'|'no-end-file'|'gave-up'}|null}
 */
export function judgeEnd({ hasPid = false, alive = null, hasEndFile = false, endSeen = false, errLine = null, ageSec = 0, quietSec = 0 } = {}) {
  if (endSeen) return { state: 'done', reason: 'end-file' };
  if (hasPid && alive === false) {
    if (errLine) return { state: 'failed', reason: 'error' };
    if (hasEndFile) return { state: 'failed', reason: 'no-end-file' };
    return { state: 'done', reason: 'pid-gone' };
  }
  if (!hasPid && errLine) return { state: 'failed', reason: 'error' };
  if (ageSec > EXT.MAX_AGE_SEC && quietSec > EXT.GIVEUP_QUIET_SEC) return { state: 'failed', reason: 'gave-up' };
  return null;
}

// ───────────── 로그 읽기(증분, 읽기 전용) ─────────────

/** 파일 하나의 증분 줄 읽기. 처음엔 끝 tailBytes 만, 줄어들면(회전·덮어쓰기) 처음부터. UTF-8(BOM 무시)·UTF-16LE(BOM) */
export class LogReader {
  constructor(file, tailBytes = EXT.TAIL_KB * 1024) {
    this.file = file; this.tailBytes = tailBytes;
    this.offset = null; this.dec = null; this.enc = null; this.partial = '';
    this.size = 0; this.mtimeMs = 0; this.exists = false; this.grewAt = 0; this.everText = false;
  }
  _detect(fd, size) {
    if (this.enc) return;
    const b = Buffer.alloc(3);
    const n = size > 0 ? fs.readSync(fd, b, 0, Math.min(3, size), 0) : 0;
    if (n >= 2 && b[0] === 0xff && b[1] === 0xfe) { this.enc = 'utf16le'; this.bom = 2; }
    else if (n >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) { this.enc = 'utf8'; this.bom = 3; }
    else if (n > 0) { this.enc = 'utf8'; this.bom = 0; }
  }
  /** 새로 생긴 줄들(끝난 줄만, `\r` 덮어쓰기는 마지막 조각). final 이면 남은 조각까지 */
  read({ final = false } = {}) {
    let st;
    try { st = fs.statSync(this.file); } catch { this.exists = false; return []; }
    this.exists = true;
    if (st.mtimeMs !== this.mtimeMs && st.size !== this.size) this.grewAt = st.mtimeMs;
    this.mtimeMs = st.mtimeMs;
    if (this.offset != null && st.size < this.offset) { this.offset = 0; this.dec = null; this.enc = null; this.partial = ''; }
    let fd;
    try { fd = fs.openSync(this.file, 'r'); } catch { return []; }
    const out = [];
    try {
      this._detect(fd, st.size);
      if (!this.enc) { this.offset = this.offset ?? 0; this.size = st.size; return []; }
      let start = this.offset, cut = false;
      if (start == null) { start = Math.max(this.bom, st.size - this.tailBytes); cut = start > this.bom; }
      if (st.size - start > EXT.READ_MAX) { start = st.size - EXT.READ_MAX; cut = true; this.partial = ''; this.dec = null; }
      if (start < this.bom) start = this.bom;
      if (this.enc === 'utf16le' && (start - this.bom) % 2) start++;
      const len = st.size - start;
      if (!this.dec) this.dec = new StringDecoder(this.enc);
      let text = '';
      if (len > 0) {
        const buf = Buffer.alloc(len);
        const n = fs.readSync(fd, buf, 0, len, start);
        text = this.dec.write(buf.subarray(0, n));
        this.offset = start + n;
      } else this.offset = start;
      this.size = st.size;
      text = this.partial + text;
      const lines = text.split('\n');
      this.partial = final ? '' : lines.pop();
      if (this.partial.length > EXT.PARTIAL_MAX) this.partial = this.partial.slice(-EXT.PARTIAL_MAX);
      if (cut && lines.length) lines.shift(); // 잘린 첫 줄
      for (const raw of lines) {
        const segs = raw.replace(/\r$/, '').split('\r');
        const line = segs[segs.length - 1].replace(ANSI_RE, '').trimEnd();
        if (line.trim()) { out.push(line); this.everText = true; }
      }
    } finally { try { fs.closeSync(fd); } catch {} }
    return out;
  }
}

// ───────────── 표시 글자 ─────────────

const fmtN = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '?');
export function fmtDurKo(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const m = Math.floor(ms / 60000);
  if (m < 1) return `${Math.max(0, Math.round(ms / 1000))}초`;
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return r ? `${h}시간 ${r}분` : `${h}시간`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}일 ${h % 24}시간` : `${d}일`;
}
const fmtRate = (r) => (r >= 10 ? Math.round(r).toLocaleString('en-US') : r >= 1 ? r.toFixed(1) : (r * 60).toFixed(1));
const END_TEXT = { 'end-file': '끝 표지 확인', 'pid-gone': '프로세스 끝(종료 코드 미상)', error: '오류 줄', 'no-end-file': '끝 표지 없이 프로세스 끝', 'gave-up': '오래 응답 없음' };

// ───────────── 등록부 ─────────────

/**
 * 서술 파일 폴더를 읽어 작업마다 상태를 굴린다. refresh 는 동기(작은 파일 몇 개)·간격 제한. 세션 런타임이 sweep 마다 부른다.
 * @param {{dir?:string, now?:()=>number, pidAlive?:(pid:number)=>boolean, prune?:boolean}} opts
 *  prune: 끝난 지 keepSec 넘은 서술 파일을 지운다(상시 서버·CLI prune 만 켠다 — 시험·재생은 끔)
 */
export class ExtJobRegistry {
  constructor({ dir = extJobsDir(), now = () => Date.now(), pidAlive = pidAliveDefault, prune = false } = {}) {
    this.dir = dir; this.now = now; this.pidAlive = pidAlive; this.prune = prune;
    this.jobs = new Map();   // id → 상태
    this.errors = new Map(); // 파일 이름 → 오류 글
    this._files = new Map(); // 파일 경로 → { mtimeMs, size, desc, errors }
    this._at = -Infinity;
    this._bind = new WeakMap(); // 색인 → Map(id → sid)
    this.version = 0;
  }

  /** 서술 파일 하나 읽기(mtime·크기 캐시) */
  _readDesc(file) {
    let st;
    try { st = fs.statSync(file); } catch { this._files.delete(file); return null; }
    const c = this._files.get(file);
    if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c;
    let r;
    try {
      const txt = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
      r = normDescriptor(JSON.parse(txt), { id: path.basename(file, '.json') });
    } catch (e) { r = { ok: false, desc: null, errors: [e.message] }; }
    const ent = { mtimeMs: st.mtimeMs, size: st.size, birthMs: st.birthtimeMs || st.ctimeMs, desc: r.desc, errors: r.errors };
    this._files.set(file, ent);
    return ent;
  }

  /** 폴더를 다시 읽고 작업마다 로그·생존·끝을 갱신. 간격 안이면 아무것도 안 함(force 로 무시). 바뀌었으면 true */
  refresh({ force = false } = {}) {
    const now = this.now();
    if (!force && now - this._at < EXT.REFRESH_MS) return false;
    this._at = now;
    let names = [];
    try { names = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')); } catch { names = []; }
    const seen = new Set();
    this.errors.clear();
    for (const f of names) {
      const file = path.join(this.dir, f);
      const ent = this._readDesc(file);
      if (!ent) continue;
      if (!ent.desc) { this.errors.set(f, ent.errors.join(' · ')); continue; }
      const d = ent.desc;
      if (seen.has(d.id)) { this.errors.set(f, `id 중복: ${d.id}`); continue; }
      seen.add(d.id);
      let st = this.jobs.get(d.id);
      const sig = JSON.stringify([d.pid, d.log, d.errLog, d.endFile, d.pattern, d.total, d.errorPattern, d.startedAt]);
      if (!st || st.sig !== sig) st = this._newState(d, sig, ent, file);
      else { st.desc = d; st.file = file; }
      this.jobs.set(d.id, st);
      this._update(st, now);
    }
    for (const id of [...this.jobs.keys()]) if (!seen.has(id)) this.jobs.delete(id);
    if (this.prune) this._prune(now);
    this.version++;
    return true;
  }

  _newState(d, sig, ent, file) {
    const created = Date.parse(d.createdAt || '') || ent.birthMs || this.now();
    return {
      id: d.id, desc: d, sig, file,
      startMs: Date.parse(d.startedAt || '') || created,
      log: new LogReader(d.log, EXT.TAIL_KB * 1024),
      err: d.errLog && d.errLog !== d.log ? new LogReader(d.errLog, EXT.ERR_TAIL_KB * 1024) : null,
      prog: compileProgress(d),
      errRe: d.errorPattern ? new RegExp(d.errorPattern) : null,
      progress: null, hist: [], lastLine: null, errLine: null, alive: null, end: null, endedAt: null, endSeen: false,
    };
  }

  _line(st, line, src) {
    if (st.errRe && st.errRe.test(line)) st.errLine = line;
    if (src !== 'log') return;
    st.lastLine = line;
    const p = matchProgress(line, st.prog);
    if (!p) return;
    const ref = st.log.mtimeMs || this.now();
    let t = lineClockMs(line, ref);
    if (!Number.isFinite(t) || t > ref + 60_000) t = ref;
    if (st.progress && p.n < st.progress.n) st.hist = []; // 줄어들면 새 회차
    st.progress = p;
    const h = st.hist;
    if (!h.length || h[h.length - 1][1] !== p.n) { h.push([t, p.n]); if (h.length > EXT.HIST) h.shift(); }
  }

  _update(st, now) {
    const d = st.desc;
    if (st.end) return; // 끝난 작업은 더 읽지 않는다(되살림 없음 — 같은 id 로 다시 등록하면 서술이 바뀌어 새 상태)
    for (const l of st.log.read()) this._line(st, l, 'log');
    if (st.err) for (const l of st.err.read()) this._line(st, l, 'err');
    st.alive = d.pid ? !!this.pidAlive(d.pid) : null;
    if (d.endFile) {
      try { const m = fs.statSync(d.endFile).mtimeMs; st.endSeen = m >= st.startMs - EXT.END_SLACK_MS; st.endMtime = m; } catch { st.endSeen = false; }
    }
    if (st.alive === false || st.endSeen) { // 끝 직전 마지막 조각까지
      for (const l of st.log.read({ final: true })) this._line(st, l, 'log');
      if (st.err) for (const l of st.err.read({ final: true })) this._line(st, l, 'err');
    }
    const lastWrite = Math.max(st.log.mtimeMs || 0, st.err?.mtimeMs || 0);
    const end = judgeEnd({
      hasPid: !!d.pid, alive: st.alive, hasEndFile: !!d.endFile, endSeen: st.endSeen, errLine: st.errLine,
      ageSec: (now - st.startMs) / 1000, quietSec: (now - (lastWrite || st.startMs)) / 1000,
    });
    if (end) {
      st.end = end;
      // 끝난 시각 = 파일이 마지막으로 바뀐 때(로그·오류 로그·끝 표지) — 서버를 다시 띄워도 같은 값
      const t = Math.max(lastWrite, st.endSeen ? st.endMtime || 0 : 0);
      st.endedAt = t > st.startMs ? Math.min(t, now) : now;
    }
  }

  _prune(now) {
    for (const st of this.jobs.values()) {
      if (!st.end) continue;
      const keep = (st.desc.keepSec ?? EXT.KEEP_SEC) * 1000;
      if (now - st.endedAt <= keep) continue;
      try { fs.unlinkSync(st.file); } catch {}
      this._files.delete(st.file);
      this.jobs.delete(st.id);
    }
  }

  /**
   * 작업을 붙일 세션 id. 서술 sessionId(색인에 있으면) → 프로젝트(cwd, 없으면 로그 경로의 조상 폴더 중 가장 깊은 프로젝트)의
   * 메인 세션 중 살아 있는 것 → 가장 최근 것. 한 번 붙으면 그 세션이 살아 있거나 살아 있는 다른 후보가 없는 동안 유지한다.
   */
  targetOf(st, index) {
    if (!index) return null;
    const d = st.desc;
    let map = this._bind.get(index);
    if (!map) { map = new Map(); this._bind.set(index, map); }
    if (d.sessionId && index.findSession?.(d.sessionId)) { map.set(st.id, d.sessionId); return d.sessionId; }
    const encs = [];
    if (d.cwd) encs.push(encodeCwd(d.cwd).toLowerCase());
    else {
      let p = path.dirname(d.log);
      for (let i = 0; i < 24; i++) { encs.push(encodeCwd(p).toLowerCase()); const up = path.dirname(p); if (up === p) break; p = up; }
    }
    const entries = [...(index.entries?.values?.() || [])];
    let cands = [];
    for (const enc of encs) {
      cands = entries.filter((e) => String(e.projectDir || '').toLowerCase() === enc && isMainCandidate(e, index));
      if (cands.length) break;
    }
    if (!cands.length) { map.delete(st.id); return null; }
    const live = (e) => !!index.procs?.get?.(e.sessionId)?.alive;
    const known = (e) => !!(e.head && e.head.entrypoint); // 머리를 읽어 메인으로 확인된 것을 머리 안 읽은 것보다 앞에
    cands.sort((a, b) => (live(b) - live(a)) || (known(b) - known(a)) || (b.mtimeMs - a.mtimeMs));
    const cur = map.get(st.id);
    const curE = cur ? cands.find((e) => e.sessionId === cur) : null;
    if (curE && (live(curE) || !live(cands[0]))) return cur;
    map.set(st.id, cands[0].sessionId);
    return cands[0].sessionId;
  }

  /** 이 세션에 붙는 작업 상태들 */
  jobsFor(sessionId, index) {
    const out = [];
    for (const st of this.jobs.values()) if (this.targetOf(st, index) === sessionId) out.push(st);
    return out;
  }
}

/** 작업을 붙일 만한 메인 세션: claude -p 자식(sdk-cli·매칭된 자식)은 아님 */
function isMainCandidate(e, index) {
  if (index.claimedChildren?.has?.(e.sessionId)) return false;
  if (e.head && e.head.entrypoint === 'sdk-cli') return false;
  const p = index.procs?.get?.(e.sessionId);
  if (p && p.entrypoint === 'sdk-cli') return false;
  return true;
}

/** 처리율(초당)·끝날 시각(ms): 표본 처음과 끝 */
export function rateOf(hist, total) {
  if (!hist || hist.length < 2) return { rate: null, etaMs: null };
  const [t0, n0] = hist[0], [t1, n1] = hist[hist.length - 1];
  const dt = (t1 - t0) / 1000;
  if (!(dt > 0) || !(n1 > n0)) return { rate: null, etaMs: null };
  const rate = (n1 - n0) / dt;
  return { rate, etaMs: total > n1 ? t1 + ((total - n1) / rate) * 1000 : null };
}

/**
 * 작업 상태 → 노드 meta.job 모양(src 'ext' · ext 필드). now = 지금(ms).
 * 진행: 진행 줄이 있으면 {n,total}, 없고 예상 소요가 있으면 경과 비율 {ratio}(끝나기 전 0.99 상한).
 */
export function extJobView(st, now, { privacy = 'summary' } = {}) {
  const d = st.desc;
  const minimal = privacy === 'minimal';
  const ended = st.end;
  const endMs = ended ? st.endedAt : null;
  const elapsed = Math.max(0, (endMs ?? now) - st.startMs);
  let progress = null;
  if (st.progress) progress = { n: st.progress.n, total: st.progress.total };
  else if (d.expectSec) progress = { ratio: ended && ended.state === 'done' ? 1 : Math.min(0.99, elapsed / (d.expectSec * 1000)) };
  const { rate, etaMs } = ended ? { rate: null, etaMs: null } : rateOf(st.hist, st.progress?.total);
  let phase;
  if (st.progress) {
    const pct = Math.floor((st.progress.n / st.progress.total) * 100);
    phase = `${fmtN(st.progress.n)}/${fmtN(st.progress.total)} (${pct}%)`;
    if (rate) phase += ` · ${fmtRate(rate)}/${rate >= 1 ? 's' : 'min'}`;
    if (etaMs) phase += ` · 남은 ~${fmtDurKo(etaMs - now)}`;
    phase += ` · 경과 ${fmtDurKo(elapsed)}`;
  } else {
    phase = `경과 ${fmtDurKo(elapsed)}`;
    if (d.expectSec) phase += ` / 예상 ${fmtDurKo(d.expectSec * 1000)}`;
    if (!st.log.everText) phase += ' · 진행 줄 없음';
  }
  if (ended) phase = `${END_TEXT[ended.reason] || ended.reason} · ${phase}`;
  else if (st.errLine) phase += ' · ⚠ 오류 줄';
  // 박동: 로그에 글이 있으면 로그(오류 로그)가 마지막으로 자란 때, 로그가 비었으면 살아 있는 동안 생존 확인(분 단위로 끊음)
  const wrote = Math.max(st.log.everText ? st.log.mtimeMs || 0 : 0, st.err?.everText ? st.err.mtimeMs || 0 : 0);
  let beat = wrote;
  if (!st.log.everText && st.alive) beat = Math.max(beat, Math.floor(now / EXT.BEAT_QUIET_MS) * EXT.BEAT_QUIET_MS);
  beat = Math.max(beat, st.startMs);
  if (ended) beat = Math.max(beat, endMs);
  const line = ended && ended.reason === 'error' && st.errLine ? st.errLine : st.lastLine || st.errLine;
  const show = (p) => (p ? (minimal ? path.basename(p) : redact(p.replace(/\\/g, '/'))) : null);
  return {
    v: 1, id: 'x:' + d.id, title: clean(d.name, EXT.NAME_MAX), state: ended ? ended.state : 'running',
    phase: minimal ? null : clean(phase, EXT.PHASE_MAX), progress,
    host: d.pid ? `PID ${d.pid}` : null, until: null, rc: null,
    beatAt: new Date(beat).toISOString(), staleSec: d.staleSec || EXT.STALE_SEC, stale: false,
    line: minimal ? null : clean(line, EXT.LINE_MAX), src: 'ext',
    startedAt: new Date(st.startMs).toISOString(), endedAt: ended ? new Date(endMs).toISOString() : null,
    rate: rate ?? null, eta: etaMs ? new Date(Math.round(etaMs)).toISOString() : null,
    ext: { pid: d.pid, alive: st.alive, reason: ended ? ended.reason : null, expectSec: d.expectSec, log: show(d.log), endFile: show(d.endFile), err: !!st.errLine },
  };
}

/**
 * 바닥 진행 띠(웹 ix-core batch)가 받는 꼴: { v:1, cat:'batch', op:'progress', phase, i, n } 또는 { pct }.
 * 진행도 예상 소요도 없으면 null(띠 없음 — 작업 노드만). bg:1 = 웹 효과 수명을 백그라운드 기준(30분)으로.
 */
export function extJobIx(st, now) {
  const d = st.desc;
  const ended = st.end;
  let core = null;
  if (st.progress) core = { i: st.progress.n, n: st.progress.total };
  else if (d.expectSec) {
    const elapsed = Math.max(0, (ended ? st.endedAt : now) - st.startMs);
    core = { pct: ended && ended.state === 'done' ? 100 : Math.min(99, Math.floor((elapsed / (d.expectSec * 1000)) * 100)) };
  }
  if (!core) return null;
  return { v: 1, cat: 'batch', op: 'progress', bg: 1, ...core, phase: ended ? 'end' : 'progress', ...(ended ? { ok: ended.state === 'done' } : {}) };
}

// ───────────── 프로세스 공용(상시 서버 = 정리 켬) ─────────────

let _shared = null;
let _sharedOpts = {};
/** 상시 서버가 시작할 때 한 번: 정리 켜기 등. 이미 만든 공용 등록부에도 반영 */
export function configureExtJobs(opts = {}) {
  _sharedOpts = { ..._sharedOpts, ...opts };
  if (_shared) Object.assign(_shared, opts);
}
/** 프로세스 하나에 공용 등록부 하나(여러 세션 런타임이 같이 씀 — 로그를 한 번만 읽는다) */
export function sharedExtJobs() {
  if (!_shared) _shared = new ExtJobRegistry(_sharedOpts);
  return _shared;
}
