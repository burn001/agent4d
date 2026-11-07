// 자율 루프 분리 측정 — 대기 기록 어댑터(내장, 읽기 전용). 축 큐 어댑터(loop-axes.mjs) 옆의 한 가지 레이아웃 전용:
//   `<루프 뿌리>/.autopilot/WAIT-<축>`(key=value 줄: pid = Windows PID · sig · recheck · kind · since · restart=<스크립트> <로그>)
//   → 있으면 그 축이 분리 측정 사슬을 기다리는 중. restart 둘째 토큰 = 사슬 로그(줄 꼴 `[MM-DD HH:MM:SS KST] <갈래> …`),
//   로그 폴더의 `.lane_<갈래>.done` = 끝난 갈래. 사슬은 Claude 세션이 아니라 transcript·tasks 출력이 없다.
// 폴더는 한 단계만 나열한다(재귀 없음). 로그는 끝부분만 읽는다. 루프 뿌리 밖 경로는 읽지 않는다. 일반화하지 말 것(폐기 방침).
import fs from 'node:fs';
import path from 'node:path';
import { redact } from './redact.mjs';

export const LOOP_WAIT = {
  DIR: '.autopilot',
  QUEUE: path.join('.autopilot', 'relaunch.sh'), // 레이아웃 표지(와 같은 파일)
  PREFIX: 'WAIT-',
  MAX_WAITS: 8,
  REC_MAX: 16 * 1024,
  TAIL_BYTES: 24 * 1024,
  LANE_MAX: 2000,
  POLL_MS: 15_000,
  LANES_MS: 60_000, // 갈래 표식 폴더 다시 세기(로그가 안 자라도)
  STALE_SEC: 3600,
  LINE_MAX: 160,
  PHASE_MAX: 160,
};

/** key=value 줄 → 객체(알려진 키만, 값은 줄 끝까지) */
export function parseWaitRecord(text) {
  const out = {};
  for (const l of String(text || '').split(/\r?\n/)) {
    const m = /^([a-z][a-z0-9_]{0,20})=(.*)$/.exec(l.trim());
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function inside(root, p) {
  if (!p) return null;
  const abs = path.resolve(root, p), rel = path.relative(root, abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? abs : null;
}

/** `YYYY-MM-DD HH:MM(:SS)` 이 PC 지역 시각 → ms | null */
export function localMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || '').trim());
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  return Number.isFinite(t) ? t : null;
}

/** 로그 줄 머리 `[MM-DD HH:MM:SS KST]` → ms(KST = UTC+9, 해는 now 기준 — 하루 넘게 미래면 지난해) | null */
export function kstLineMs(line, nowMs) {
  const m = /^\[(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) KST\]/.exec(line);
  if (!m) return null;
  const y = new Date(nowMs + 9 * 3600_000).getUTCFullYear();
  let t = Date.UTC(y, +m[1] - 1, +m[2], +m[3] - 9, +m[4], +m[5]);
  if (t > nowMs + 86_400_000) t = Date.UTC(y - 1, +m[1] - 1, +m[2], +m[3] - 9, +m[4], +m[5]);
  return t;
}

const SKIP_RE = /끝난 갈래 — 건너뛴다\s*$/;
/**
 * 로그 끝부분 → { lane, text, rc, atMs, last }: 마지막 `[시각] <갈래> …` 줄(건너뛴 갈래 줄은 뺌)의 갈래·나머지·rc.
 * `회차 관문 — 예상 N초` → gate:{sec}. 줄이 없으면 null
 */
export function parseChainTail(text, nowMs) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  let last = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    const t = kstLineMs(l, nowMs);
    if (t == null) continue;
    const body = l.replace(/^\[[^\]]*\]\s*/, '');
    if (!last) last = { line: body, atMs: t };
    if (SKIP_RE.test(body)) continue;
    const m = /^(\S+)\s+(.*)$/.exec(body);
    if (!m) continue;
    const rc = /\brc=(-?\d+)\b/.exec(m[2]);
    const gate = /회차 관문 — 예상 (\d+)초/.exec(m[2]);
    return { lane: m[1], text: m[2], rc: rc ? +rc[1] : null, gate: gate ? { sec: +gate[1] } : null, atMs: t, last };
  }
  return last ? { lane: null, text: null, rc: null, gate: null, atMs: last.atMs, last } : null;
}

const cache = new Map(); // 로그 절대 경로 → {mtimeMs, size, text}
function tailText(abs) {
  let st;
  try { st = fs.statSync(abs); } catch { cache.delete(abs); return null; }
  if (!st.isFile()) return null;
  const c = cache.get(abs);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c;
  let text = '', fd;
  try {
    fd = fs.openSync(abs, 'r');
    const len = Math.min(st.size, LOOP_WAIT.TAIL_BYTES);
    const buf = Buffer.allocUnsafe(len);
    const n = fs.readSync(fd, buf, 0, len, st.size - len);
    text = buf.toString('utf8', 0, n);
    if (len < st.size) { const i = text.indexOf('\n'); text = i >= 0 ? text.slice(i + 1) : ''; } // 잘린 첫 줄 버림
  } catch { return null; } finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
  const v = { mtimeMs: st.mtimeMs, size: st.size, text };
  cache.set(abs, v);
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  return v;
}

const laneCache = new Map(); // 폴더 → {at, logMtime, n}
function lanesDone(dir, logMtime, nowMs) {
  const c = laneCache.get(dir);
  if (c && c.logMtime === logMtime && nowMs - c.at < LOOP_WAIT.LANES_MS) return c;
  let n = 0;
  try {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) { // 한 단계만
      if (!d.isFile() || !/^\.lane_.+\.done$/.test(d.name)) continue;
      if (++n > LOOP_WAIT.LANE_MAX) break;
    }
  } catch { n = 0; }
  const v = { at: nowMs, logMtime, n };
  laneCache.set(dir, v);
  if (laneCache.size > 64) laneCache.delete(laneCache.keys().next().value);
  return v;
}

const clean = (v, n) => {
  if (v == null || v === '') return null;
  const s = String(v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const r = redact(s);
  return r.length > n ? r.slice(0, n - 1) + '…' : r;
};

/**
 * 루프 뿌리 → 대기 기록 목록(레이아웃이 아니면 []). 각 항목:
 *  { axis, pid, sig, kind, since(ms|null), recheck(ms|null), script, log(뿌리 기준 상대), alive(bool|null),
 *    lanesDone, tail(parseChainTail | null), logMtimeMs }
 */
export function loopWaits(root, { nowMs = Date.now(), pidAlive = null } = {}) {
  if (!root) return [];
  root = path.resolve(root);
  try { if (!fs.statSync(path.join(root, LOOP_WAIT.QUEUE)).isFile()) return []; } catch { return []; }
  let ents = [];
  try { ents = fs.readdirSync(path.join(root, LOOP_WAIT.DIR), { withFileTypes: true }); } catch { return []; } // 한 단계만
  const out = [];
  for (const d of ents) {
    if (!d.isFile() || !d.name.startsWith(LOOP_WAIT.PREFIX)) continue;
    const axis = d.name.slice(LOOP_WAIT.PREFIX.length);
    if (!/^[\w.-]{1,80}$/.test(axis)) continue;
    const f = path.join(root, LOOP_WAIT.DIR, d.name);
    let text;
    try { const st = fs.statSync(f); if (st.size > LOOP_WAIT.REC_MAX) continue; text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const r = parseWaitRecord(text);
    const pid = /^\d{1,7}$/.test(r.pid || '') ? +r.pid : null;
    const [script = null, log0 = null] = String(r.restart || '').split(/\s+/).filter(Boolean);
    const logRel = log0 || (script ? path.posix.join(path.posix.dirname(script.replace(/\\/g, '/')), 'run.log') : null);
    const logAbs = inside(root, logRel);
    const t = logAbs ? tailText(logAbs) : null;
    const lanes = logAbs ? lanesDone(path.dirname(logAbs), t ? t.mtimeMs : 0, nowMs) : { n: 0 };
    out.push({
      axis, pid, sig: r.sig || null, kind: r.kind || null, since: localMs(r.since), recheck: localMs(r.recheck),
      script: script ? script.replace(/\\/g, '/') : null, log: logAbs ? path.relative(root, logAbs).replace(/\\/g, '/') : null,
      alive: pid && pidAlive ? !!pidAlive(pid) : null, lanesDone: lanes.n,
      tail: t ? parseChainTail(t.text, nowMs) : null, logMtimeMs: t ? t.mtimeMs : null,
    });
    if (out.length >= LOOP_WAIT.MAX_WAITS) break;
  }
  return out.sort((a, b) => (a.axis < b.axis ? -1 : 1));
}

export const waitJobId = (axis) => 'meas-' + String(axis).replace(/[^\w.-]/g, '_').slice(0, 80);

/**
 * 대기 기록 하나 → 작업 노드 meta.job(모양, src 'loop-wait'). ended = {state, phase}(기록이 지워짐·PID 끝) | null
 */
export function waitJobView(w, nowMs, { privacy = 'summary', ended = null } = {}) {
  const minimal = privacy === 'minimal';
  const tl = w.tail;
  const parts = [];
  if (w.lanesDone) parts.push(`끝난 갈래 ${w.lanesDone}`);
  if (tl && tl.lane) parts.push(`${tl.lane} ${tl.text}`);
  if (ended) parts.unshift(ended.phase);
  const phase = parts.join(' · ') || (w.alive === false ? '사슬 PID 없음' : '진행 줄 없음');
  const startMs = w.since || w.logMtimeMs || nowMs;
  let beat = Math.max(w.logMtimeMs || 0, startMs);
  if (w.alive && !ended) beat = Math.max(beat, Math.floor(nowMs / 60_000) * 60_000); // 살아 있는 동안 분 단위 생존 박동
  const endMs = ended ? nowMs : null;
  return {
    v: 1, id: waitJobId(w.axis), title: `분리 측정 · ${w.axis}`, state: ended ? ended.state : 'running',
    phase: minimal ? null : clean(phase, LOOP_WAIT.PHASE_MAX), progress: null,
    host: w.pid ? `PID ${w.pid}` : null, until: w.recheck ? new Date(w.recheck).toISOString() : null,
    rc: tl && tl.rc != null && tl.rc !== 0 ? tl.rc : null,
    beatAt: new Date(ended ? endMs : beat).toISOString(), staleSec: LOOP_WAIT.STALE_SEC, stale: false,
    line: minimal ? null : clean(tl?.last?.line || null, LOOP_WAIT.LINE_MAX), src: 'loop-wait',
    startedAt: new Date(startMs).toISOString(), endedAt: ended ? new Date(endMs).toISOString() : null,
    wait: { axis: w.axis, kind: w.kind, lanesDone: w.lanesDone, lane: tl?.lane || null, gateSec: tl?.gate?.sec ?? null,
      alive: w.alive, script: minimal || !w.script ? (w.script ? path.posix.basename(w.script) : null) : w.script, log: minimal ? null : w.log },
  };
}
