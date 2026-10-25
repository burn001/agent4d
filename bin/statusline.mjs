#!/usr/bin/env node
// Agent4D statusLine 래퍼. Node 내장 모듈만.
//  - 실행본: 설치 때 <CCVIZ_HOME>/statusline.mjs 로 복사되고 settings.json 의 statusLine.command 가 이 파일을 가리킨다.
//  - stdin JSON 의 rate_limits.five_hour / seven_day 만 <CCVIZ_HOME>/ratelimits.json 에 원자적으로 쓴다.
//  - 설치 전 statusLine 명령(prev)이 있으면 같은 stdin 으로 실행해 그 출력을 그대로 내보낸다.
//  - 어떤 예외에도 종료 코드 0, 오류 문구 없음. 자격증명 파일은 읽지 않는다(statusline.json·ratelimits.json 만).
// 같은 파일이 `ccviz statusline install|uninstall|status` 의 settings.json 편집 함수도 내보낸다(import 할 때만 쓰임).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const STDIN_MAX = 1 << 20;
const STDIN_TIMEOUT_MS = 1500;
// 이전 statusLine 명령 시한. 초과하면 트리 종료(Windows taskkill /T 가 이 PC 에서 1～1.6초)까지 끝낸 뒤 내보내므로 래퍼 전체는 약 4.5초 안
const PREV_TIMEOUT_MS = 3000;
const DEDUPE_MS = 20_000;

// ───────────────────────── 경로 ─────────────────────────

/** CCVIZ_HOME: 환경 변수 → 이 스크립트 폴더에 statusline.json 이 있으면 그 폴더 → ~/.cc-session-viz(있으면, 하위 호환) → ~/.cc-agent-viz */
export function resolveHome(env = process.env, scriptPath = SELF) {
  if (env.CCVIZ_HOME) return env.CCVIZ_HOME;
  const dir = path.dirname(scriptPath);
  try { if (fs.existsSync(path.join(dir, 'statusline.json'))) return dir; } catch {}
  const legacy = path.join(os.homedir(), '.cc-session-viz');
  try { if (fs.statSync(legacy).isDirectory()) return legacy; } catch {}
  return path.join(os.homedir(), '.cc-agent-viz');
}
export const claudeConfigDir = (env = process.env) => env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES']);
/**
 * 중복 판정용 읽기: 없으면 {missing:true}, 백신·색인기가 방금 바뀐 파일을 잠깐 잡고 있어 생기는 일시 오류(EBUSY·EPERM·EACCES)는
 * 30ms 간격으로 3번 더 읽는다. 그래도 못 읽으면 {error} — 호출 쪽은 판정 불가로 보고 쓴다(값을 잃지 않게).
 */
export function readJsonRetry(file, { tries = 4, waitMs = 30, readFile = fs.readFileSync } = {}) {
  for (let i = 0; ; i++) {
    try { return { value: JSON.parse(readFile(file, 'utf8')) }; } catch (e) {
      if (e && e.code === 'ENOENT') return { missing: true };
      if (e && TRANSIENT.has(e.code) && i < tries - 1) { sleepSync(waitMs); continue; }
      return { error: e };
    }
  }
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {}
}

/** 같은 폴더 임시 파일 → rename. Windows EPERM/EBUSY/EACCES 면 50ms 뒤 1회 재시도 */
export function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  try { fs.renameSync(tmp, file); } catch (e) {
    if (!['EPERM', 'EBUSY', 'EACCES'].includes(e?.code)) { try { fs.unlinkSync(tmp); } catch {} throw e; }
    sleepSync(50);
    try { fs.renameSync(tmp, file); } catch (e2) { try { fs.unlinkSync(tmp); } catch {} throw e2; }
  }
}

// ───────────────────────── 래퍼 ─────────────────────────

/** stdin JSON 에서 두 창만 꺼낸다. 형식이 맞지 않는 창은 빠진다 */
export function extractRateLimits(j) {
  const rl = j && typeof j === 'object' ? j.rate_limits : null;
  if (!rl || typeof rl !== 'object') return null;
  const pick = (w) => {
    if (!w || typeof w !== 'object') return null;
    const p = Number(w.used_percentage), r = Number(w.resets_at);
    if (!Number.isFinite(p) || !Number.isFinite(r)) return null;
    return { used_percentage: p, resets_at: r };
  };
  const out = {};
  const f = pick(rl.five_hour), s = pick(rl.seven_day);
  if (f) out.five_hour = f;
  if (s) out.seven_day = s;
  return f || s ? out : null;
}

/** 같은 값이고 직전 기록과 20초 안이면 true. 시계가 조금 뒤로 간 경우(음수 나이)도 같은 창으로 본다 */
export function isDuplicate(prev, rl, nowMs) {
  if (!prev || prev.v !== 1) return false;
  const same = JSON.stringify([prev.five_hour ?? null, prev.seven_day ?? null]) === JSON.stringify([rl.five_hour ?? null, rl.seven_day ?? null]);
  const age = nowMs - Date.parse(prev.capturedAt);
  return same && Number.isFinite(age) && Math.abs(age) < DEDUPE_MS;
}

/** ratelimits.json 갱신. 값이 같고 직전 기록이 20초 이내면 쓰지 않는다. 썼으면 true */
export function recordRateLimits(home, j, nowMs = Date.now(), { readFile } = {}) {
  const rl = extractRateLimits(j);
  if (!rl) return false;
  const file = path.join(home, 'ratelimits.json');
  const r = readJsonRetry(file, readFile ? { readFile } : {});
  if (isDuplicate(r.value, rl, nowMs)) return false;
  const rec = { v: 1, source: 'statusline', capturedAt: new Date(nowMs).toISOString(),
    sessionId: typeof j.session_id === 'string' ? j.session_id : null,
    ccVersion: typeof j.version === 'string' ? j.version : null, ...rl };
  fs.mkdirSync(home, { recursive: true });
  atomicWrite(file, JSON.stringify(rec));
  return true;
}

/** 남은 시간: 1시간 미만 n분, 하루 미만 h시간 m분, 그 이상 n일(2일 미만이면 시간도) */
export function fmtRemain(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '재설정됨';
  const m = Math.floor(sec / 60);
  if (m < 60) return `${Math.max(1, m)}분`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간${m % 60 ? ` ${m % 60}분` : ''}`;
  const d = Math.floor(h / 24);
  return `${d}일${d < 2 && h % 24 ? ` ${h % 24}시간` : ''}`;
}

/** 기본 한 줄: `5h 23% (3시간 8분) · 7d 41% (4일)`. 70%↑ 노랑, 90%↑ 빨강 ANSI */
export function formatLine(rl, nowSec = Date.now() / 1000, { color = true } = {}) {
  if (!rl) return '';
  const part = (label, w) => {
    if (!w) return null;
    const pct = Math.round(w.used_percentage);
    let s = `${label} ${pct}% (${fmtRemain(w.resets_at - nowSec)})`;
    if (color && w.used_percentage >= 90) s = `\x1b[31m${s}\x1b[0m`;
    else if (color && w.used_percentage >= 70) s = `\x1b[33m${s}\x1b[0m`;
    return s;
  };
  return [part('5h', rl.five_hour), part('7d', rl.seven_day)].filter(Boolean).join(' · ');
}

export function readStdin({ max = STDIN_MAX, timeoutMs = STDIN_TIMEOUT_MS, stream = process.stdin } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    let n = 0, done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(t); try { stream.pause(); } catch {} resolve(Buffer.concat(chunks)); };
    const t = setTimeout(finish, timeoutMs);
    if (stream.isTTY) { finish(); return; }
    stream.on('data', (c) => { if (n < max) { chunks.push(c.subarray(0, max - n)); n += c.length; } if (n >= max) finish(); });
    stream.on('end', finish);
    stream.on('error', finish);
  });
}

/** 프로세스 트리 종료(동기). Windows: taskkill /T /F 를 끝날 때까지 기다림(최대 3초), POSIX: 프로세스 그룹 SIGKILL */
export function killTree(child, { posix = process.platform !== 'win32', taskkillTimeoutMs = 3000 } = {}) {
  if (!child || !child.pid) return false;
  // 셸이 이미 끝났으면 그 pid 는 다른 프로세스가 다시 쓸 수 있다(Windows 는 pid 재사용이 빠름) → 남의 트리를 죽이지 않게 건너뜀
  if (child.exitCode !== null || child.signalCode !== null) return false;
  try {
    if (posix) { process.kill(-child.pid, 'SIGKILL'); return true; }
    const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const exe = path.join(sysRoot, 'System32', 'taskkill.exe');
    const r = spawnSync(fs.existsSync(exe) ? exe : 'taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: taskkillTimeoutMs });
    if (r.status === 0) return true;
  } catch {}
  try { child.kill('SIGKILL'); } catch {}
  return false;
}

/** prev 명령을 같은 stdin 으로 실행, stdout 바이트 그대로. stderr 버림, 4초 제한 */
export function runPrev(command, input, { timeoutMs = PREV_TIMEOUT_MS, env = process.env, cwd = process.cwd() } = {}) {
  return new Promise((resolve) => {
    let child;
    const posix = process.platform !== 'win32';
    try { child = spawn(command, { shell: true, env, cwd, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, detached: posix }); } catch { resolve(Buffer.alloc(0)); return; }
    const out = [];
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(t); resolve(Buffer.concat(out)); };
    // 시한 초과: 지금까지 받은 출력으로 바로 끝내고, 셸뿐 아니라 손자 프로세스까지 트리째 종료(Windows 는 cmd.exe 만 죽이면 손자가 파이프를 쥔 채 남음)
    const t = setTimeout(() => {
      // 트리 종료를 먼저 끝낸 뒤 결과를 돌려준다. 예전처럼 taskkill 을 띄워 두고(unref) 바로 끝내면
      // 래퍼가 먼저 exit 해 taskkill 이 손자를 다 정리했는지 보장되지 않았다(Windows 는 셸만 죽이면 손자가 남음).
      try { child.stdout.destroy(); } catch {}
      try { child.stdin.destroy(); } catch {}
      killTree(child, { posix });
      try { child.unref(); } catch {}
      finish();
    }, timeoutMs);
    child.stdout.on('data', (c) => { if (!done) out.push(c); });
    child.stdout.on('error', () => {});
    child.on('error', () => finish());
    child.on('close', finish);
    child.stdin.on('error', () => {});
    try { child.stdin.end(input); } catch {}
  });
}

/** 래퍼 본체. 반환: 내보낼 stdout 버퍼 */
export async function runWrapper({ input, env = process.env, home = resolveHome(env), nowMs = Date.now() } = {}) {
  let j = null;
  try { j = JSON.parse(input.toString('utf8')); } catch { j = null; }
  try { if (j) recordRateLimits(home, j, nowMs); } catch {}
  const st = readJsonSafe(path.join(home, 'statusline.json')) || {};
  const prevCmd = st.prev && typeof st.prev.command === 'string' && st.prev.command.trim() ? st.prev.command : null;
  if (prevCmd) return runPrev(prevCmd, input, { env });
  if (st.mode === 'blank') return Buffer.alloc(0);
  const rl = j ? extractRateLimits(j) : null;
  return Buffer.from(formatLine(rl, nowMs / 1000) + '\n', 'utf8');
}

// ───────────────────────── settings.json 편집 (ccviz statusline) ─────────────────────────

/** 최상위 객체 멤버 위치 스캔. 반환 {open, close, members:[{key, start, valueStart, valueEnd}]} — JSON 이 아니면 throw */
export function scanTopLevel(text) {
  let i = 0;
  const n = text.length;
  const ws = () => { while (i < n && /[\s﻿]/.test(text[i])) i++; };
  const str = () => {
    if (text[i] !== '"') throw new Error(`문자열이 필요합니다 (${i})`);
    const s = i++;
    while (i < n && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
    if (i >= n) throw new Error('닫히지 않은 문자열');
    i++;
    return JSON.parse(text.slice(s, i));
  };
  const value = () => {
    const c = text[i];
    if (c === '"') { str(); return; }
    if (c === '{' || c === '[') {
      let depth = 0;
      while (i < n) {
        const ch = text[i];
        if (ch === '"') { str(); continue; }
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { i++; return; } }
        i++;
      }
      throw new Error('닫히지 않은 객체');
    }
    const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (!m) throw new Error(`값이 아닙니다 (${i})`);
    i += m[0].length;
  };
  ws();
  if (text[i] !== '{') throw new Error('최상위가 객체가 아닙니다');
  const open = i++;
  const members = [];
  ws();
  if (text[i] === '}') return { open, close: i, members };
  for (;;) {
    ws();
    const start = i;
    const key = str();
    ws();
    if (text[i] !== ':') throw new Error(`':' 가 필요합니다 (${i})`);
    i++;
    ws();
    const valueStart = i;
    value();
    members.push({ key, start, valueStart, valueEnd: i });
    ws();
    if (text[i] === ',') { i++; continue; }
    if (text[i] === '}') return { open, close: i, members };
    throw new Error(`',' 또는 '}' 가 필요합니다 (${i})`);
  }
}

export function detectIndent(text) {
  const m = /\n([ \t]+)"/.exec(text);
  return m ? m[1] : '  ';
}
export const detectEol = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

/** 최상위 key 하나만 바꾼다(value===undefined 면 삭제). 다른 바이트는 그대로 */
export function setTopLevelKey(text, key, value) {
  JSON.parse(text.replace(/^﻿/, '')); // 파싱 실패면 throw → 아무것도 안 씀
  const sc = scanTopLevel(text);
  const compact = !/[\r\n]/.test(text.trim()); // 한 줄(압축) 파일이면 같은 모양으로
  const indent = compact ? '' : detectIndent(text);
  const eol = compact ? '' : detectEol(text);
  const render = (v) => (compact ? JSON.stringify(v) : JSON.stringify(v, null, indent).split('\n').join(eol + indent));
  const idx = sc.members.findIndex((m) => m.key === key);
  if (value === undefined) {
    if (idx < 0) return text;
    const ms = sc.members;
    if (ms.length === 1) return text.slice(0, sc.open + 1) + text.slice(sc.close);
    if (idx > 0) return text.slice(0, ms[idx - 1].valueEnd) + text.slice(ms[idx].valueEnd);
    return text.slice(0, ms[0].start) + text.slice(ms[1].start);
  }
  if (idx >= 0) {
    const m = sc.members[idx];
    return text.slice(0, m.valueStart) + render(value) + text.slice(m.valueEnd);
  }
  const member = `${JSON.stringify(key)}:${compact ? '' : ' '}${render(value)}`;
  if (!sc.members.length) return text.slice(0, sc.open + 1) + eol + indent + member + eol + text.slice(sc.close);
  const last = sc.members[sc.members.length - 1];
  return text.slice(0, last.valueEnd) + ',' + eol + indent + member + text.slice(last.valueEnd);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const slash = (p) => String(p).replace(/\\/g, '/');
const stamp = (d = new Date()) => {
  const z = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
};

export function wrapperCommand(home) { return `node "${slash(path.join(home, 'statusline.mjs'))}"`; }

/** statusLine 이 우리 래퍼를 가리키는지 */
export function isOurs(statusLine, home) {
  const c = statusLine && typeof statusLine.command === 'string' ? slash(statusLine.command).toLowerCase() : '';
  if (!c.includes('statusline.mjs')) return false;
  return c.includes('.cc-session-viz/statusline.mjs') || c.includes('.cc-agent-viz/statusline.mjs') || c.includes(slash(path.join(home, 'statusline.mjs')).toLowerCase());
}

/** 활성 세션 cwd 의 프로젝트 설정에 statusLine 이 있으면(덮어씀) 경고 목록. 읽기만 */
export function projectOverrides(claudeDir) {
  const out = [];
  const cwds = new Set();
  try {
    for (const f of fs.readdirSync(path.join(claudeDir, 'sessions'))) {
      if (!f.endsWith('.json')) continue; // *.key 는 읽지 않음
      const j = readJsonSafe(path.join(claudeDir, 'sessions', f));
      if (j && typeof j.cwd === 'string') cwds.add(j.cwd);
    }
  } catch {}
  for (const cwd of cwds) {
    for (const name of ['settings.json', 'settings.local.json']) {
      const p = path.join(cwd, '.claude', name);
      const j = readJsonSafe(p);
      if (j && j.statusLine) out.push(p);
    }
  }
  return out;
}

/**
 * 문구 키 → 문자열. ccviz 가 server/cli-i18n.mjs 의 t 를 넘긴다(이 파일은 <CCVIZ_HOME> 으로 복사돼 단독 실행되므로 그 모듈을 import 하지 않음).
 * 넘기지 않으면 키와 값만 보인다.
 */
const keyOnly = (k, v) => (v && Object.keys(v).length ? `${k} ${JSON.stringify(v)}` : k);

/**
 * `ccviz statusline install [--mode limits|blank] [--yes]`.
 * 반환 {ok, action:'plan'|'installed'|'refreshed'|'error', messages:[…]}
 */
export function installStatusline({ home, claudeDir, mode = null, yes = false, src = SELF, now = new Date(), t = keyOnly }) {
  const msgs = [];
  const settingsPath = path.join(claudeDir, 'settings.json');
  let text;
  try { text = fs.readFileSync(settingsPath, 'utf8'); } catch (e) {
    if (e.code !== 'ENOENT') return { ok: false, action: 'error', messages: [t('sl.readFail', { msg: e.message })] };
    text = null;
  }
  let obj = {};
  if (text != null) {
    try { obj = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { return { ok: false, action: 'error', messages: [t('sl.badJson', { msg: e.message })] }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, action: 'error', messages: [t('sl.notObject')] };
  }
  const cur = obj.statusLine ?? null;
  const stFile = path.join(home, 'statusline.json');
  const wrapperDst = path.join(home, 'statusline.mjs');
  if (cur && isOurs(cur, home)) {
    if (!yes) return { ok: true, action: 'plan', messages: [t('sl.already')] };
    fs.mkdirSync(home, { recursive: true });
    fs.copyFileSync(src, wrapperDst);
    const st = readJsonSafe(stFile);
    if (st && mode && st.mode !== mode) { st.mode = mode; atomicWrite(stFile, JSON.stringify(st, null, 2)); }
    return { ok: true, action: 'refreshed', messages: [t('sl.refreshed')] };
  }
  const m = mode === 'blank' ? 'blank' : 'limits';
  const value = { type: 'command', command: wrapperCommand(home) };
  if (cur && cur.padding != null) value.padding = cur.padding;
  if (cur && cur.refreshInterval != null) value.refreshInterval = cur.refreshInterval;
  const warnings = projectOverrides(claudeDir).map((p) => t('sl.planOverride', { file: p }));
  const plan = [
    t('sl.planSettings', { file: settingsPath }),
    t('sl.planKey', { cmd: value.command }),
    cur ? t('sl.planPrev') : t('sl.planNoPrev', { blank: m === 'blank' }),
    t('sl.planHint'),
    ...warnings,
  ];
  if (!yes) return { ok: true, action: 'plan', messages: [...plan, t('sl.planYes')] };

  fs.mkdirSync(path.join(home, 'backup'), { recursive: true });
  const backupRel = `backup/settings.json.${stamp(now)}`;
  if (text != null) fs.writeFileSync(path.join(home, backupRel), text); // 바이트 그대로
  fs.copyFileSync(src, wrapperDst);
  const newText = text != null ? setTopLevelKey(text, 'statusLine', value) : JSON.stringify({ statusLine: value }, null, 2) + '\n';
  const st = { v: 1, installedAt: now.toISOString(), settingsPath, prev: cur, mode: m, backup: text != null ? backupRel : null, writtenSha: sha(newText), hadFile: text != null };
  atomicWrite(stFile, JSON.stringify(st, null, 2));
  fs.mkdirSync(claudeDir, { recursive: true });
  atomicWrite(settingsPath, newText);
  msgs.push(...warnings);
  msgs.push(t('sl.done'));
  return { ok: true, action: 'installed', messages: msgs };
}

/** `ccviz statusline uninstall` */
export function uninstallStatusline({ home, claudeDir, t = keyOnly }) {
  const stFile = path.join(home, 'statusline.json');
  const st = readJsonSafe(stFile);
  const settingsPath = st?.settingsPath || path.join(claudeDir, 'settings.json');
  let text = null;
  try { text = fs.readFileSync(settingsPath, 'utf8'); } catch {}
  let obj = null;
  if (text != null) { try { obj = JSON.parse(text.replace(/^﻿/, '')); } catch { return { ok: false, action: 'error', messages: [t('sl.badJsonShort')] }; } }
  const msgs = [];
  let action = 'none';
  if (obj && isOurs(obj.statusLine, home)) {
    const backup = st?.backup ? path.join(home, st.backup) : null;
    if (st && st.writtenSha && sha(text) === st.writtenSha && backup && fs.existsSync(backup)) {
      atomicWrite(settingsPath, fs.readFileSync(backup)); // 그 뒤 아무도 안 고쳤으면 설치 전 바이트 그대로
      msgs.push(t('sl.restored'));
    } else if (st && st.hadFile === false && st.writtenSha && sha(text) === st.writtenSha) {
      fs.unlinkSync(settingsPath);
      msgs.push(t('sl.removedFile'));
    } else {
      atomicWrite(settingsPath, setTopLevelKey(text, 'statusLine', st?.prev ?? undefined));
      msgs.push(t(st?.prev ? 'sl.restoredPrev' : 'sl.removedKey'));
    }
    action = 'restored';
  } else if (obj && obj.statusLine) {
    msgs.push(t('sl.changed'));
    action = 'skipped';
  } else msgs.push(t('sl.notOurs'));
  for (const f of ['statusline.mjs', 'statusline.json']) { try { fs.unlinkSync(path.join(home, f)); } catch {} }
  msgs.push(t('sl.cleaned'));
  return { ok: true, action, messages: msgs };
}

/** `ccviz statusline status` 용 정보(값 표시는 호출 쪽) */
export function statuslineInfo({ home, claudeDir, nowMs = Date.now() }) {
  const st = readJsonSafe(path.join(home, 'statusline.json'));
  const settings = readJsonSafe(path.join(claudeDir, 'settings.json'));
  const rl = readJsonSafe(path.join(home, 'ratelimits.json'));
  const installed = !!(settings && isOurs(settings.statusLine, home));
  return {
    installed, recorded: !!st, mode: st?.mode || null, installedAt: st?.installedAt || null,
    prevCommand: st?.prev?.command || null, wrapperExists: fs.existsSync(path.join(home, 'statusline.mjs')),
    ratelimits: rl && rl.v === 1 ? { five_hour: rl.five_hour || null, seven_day: rl.seven_day || null, capturedAt: rl.capturedAt,
      ageSec: Math.max(0, Math.round((nowMs - Date.parse(rl.capturedAt)) / 1000)) } : null,
  };
}

// ───────────────────────── 실행 ─────────────────────────

async function main() {
  let out = Buffer.alloc(0);
  try {
    const input = await readStdin();
    // CCVIZ_SL_NOW_MS: 시험 전용 시계 고정(중복 판정을 벽시계·기동 시간과 무관하게 검사). 평소에는 없음
    const fixed = Number(process.env.CCVIZ_SL_NOW_MS);
    out = await runWrapper({ input, ...(Number.isFinite(fixed) && fixed > 0 ? { nowMs: fixed } : {}) });
  } catch { out = Buffer.alloc(0); }
  // 시한 초과로 남은 자식 핸들이 있어도 기다리지 않도록 출력이 비워지면 바로 종료
  try { process.stdout.write(out, () => process.exit(0)); } catch { process.exit(0); }
  process.exitCode = 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === SELF;
if (isMain) {
  process.on('uncaughtException', () => { process.exit(0); });
  main().catch(() => { process.exitCode = 0; });
}
