// 기동기(launcher) — 셸 명령이 분리 실행(nohup·&·disown·setsid·Start-Process·run_in_background)으로 띄운 스크립트가
// 안에서 `claude -p` 를 되풀이 부르는 경우(자율 실행 루프)의 호출 관계.
// 모든 파일은 읽기 전용. 스크립트는 명령에 적힌 경로만, 정해진 확장자·크기 안에서 읽는다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CLAUDE_P_RE, normPath, lastCdBefore, resolveCwdGuess, detectClaudeP } from './parse.mjs';

/** 기동기 아래 회차(claude -p) 사이 최대 공백. 넘으면 그 기동기는 끝난 것으로 본다 */
export const LAUNCH_GAP_MS = 6 * 3600_000;
/** 회차 시작 시각에서 기동 명령을 찾는 최대 거리 */
export const LAUNCH_LOOKBACK_MS = 7 * 24 * 3600_000;
const SCRIPT_MAX_BYTES = 512 * 1024;
const SCRIPT_MAX_FILES = 8;
const SCRIPT_MAX_DEPTH = 2;

// 분리 실행 표지(명령 위치). Bash 의 홀로 선 & 는 따로(BASH_BG_RE)
const DETACH_RE = /(?:^|[\s;&|(])(?:nohup|setsid|disown|Start-Process|saps|Start-Job)\b|(?:^|[\s;&|(])start\s+(?:"[^"]*"\s+)?\/b\b/i;
// 뒤로 보내기 & — &&·2>&1·&>·|& 는 아님
const BASH_BG_RE = /(?<![&>|<\d])&(?![&>])/;
const SCRIPT_TOKEN_RE = /[^\s'"`;&|<>()]+\.(?:sh|bash|ps1|py|mjs|cjs|js|cmd|bat)(?![\w.])/gi;
const PREFILTER_RE = /nohup|disown|setsid|Start-Process|saps|Start-Job|\/b\b|"run_in_background":true|&/i;

/** /d/x → D:/x(Windows), ~ → 홈 */
export function toFsPath(p) {
  let s = String(p || '').trim().replace(/^~(?=[\\/]|$)/, os.homedir());
  const m = /^\/([a-zA-Z])\//.exec(s);
  if (m && process.platform === 'win32') s = `${m[1].toUpperCase()}:/` + s.slice(3);
  return s;
}

/**
 * 셸 명령이 스크립트를 분리 실행하는지. 아니면 null.
 * 명령 자체에 `claude -p` 가 보이면 기동기가 아니다(그대로).
 */
export function detectLaunch(command, { bg = false, tool = 'Bash' } = {}) {
  if (typeof command !== 'string' || !command) return null;
  if (detectClaudeP(command)) return null;
  // 분리 실행 표지가 있는 명령 구간(&&·||·;·줄바꿈으로 나눔)에서 "실행되는" 스크립트만 본다. 다른 구간의 grep·cat 대상은 아님
  const tokens = [];
  let detached = false, at = -1, off = 0;
  for (const seg of splitOutsideQuotes(command)) {
    const segAt = off;
    off += seg.length;
    if (/^(?:&&|\|\||;|\n)$/.test(seg)) continue;
    const startProc = /Start-Process|saps|Start-Job|\bstart\s+(?:"[^"]*"\s+)?\/b\b/i.test(seg);
    const det = DETACH_RE.test(seg) || (tool !== 'PowerShell' && BASH_BG_RE.test(seg));
    if (!det && !bg) continue;
    for (const m of seg.matchAll(SCRIPT_TOKEN_RE)) {
      const t = m[0].replace(/^[=]+/, '');
      if (t.includes('$') || /^https?:/i.test(t) || t.startsWith('-')) continue;
      const before = seg.slice(0, m.index);
      if (!(startProc || t.startsWith('./') || INVOKE_BEFORE_RE.test(before) || /^\s*$/.test(before))) continue;
      if (!tokens.includes(t)) { tokens.push(t); if (at < 0) at = segAt + m.index; }
      if (det) detached = true;
    }
  }
  if (!tokens.length) return null;
  let cdGuess = lastCdBefore(command, at < 0 ? command.length : at);
  if (!cdGuess && at > 0) {
    // Start-Process … -ArgumentList '-c','"cd /d/x && bash y.sh"' 처럼 따옴표 안의 cd
    const re = /\bcd\s+(?:\/d\s+)?(?:"([^"]+)"|([^\s;&|)'"]+))\s*(?:&&|;)/gi;
    let m;
    while ((m = re.exec(command)) && m.index < at) cdGuess = m[1] || m[2];
  }
  return { detached, bg: !!bg, tokens, cdGuess };
}

/** 따옴표 밖의 &&·||·;·줄바꿈으로 나눈다(구분자도 원소로 남겨 길이 합이 원문과 같다) */
function splitOutsideQuotes(s) {
  const out = [];
  let q = null, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") { q = c; continue; }
    const two = s.slice(i, i + 2);
    const sep = two === '&&' || two === '||' ? two : (c === ';' || c === '\n') ? c : null;
    if (!sep) continue;
    out.push(s.slice(start, i), sep);
    i += sep.length - 1;
    start = i + 1;
  }
  out.push(s.slice(start));
  return out;
}

const _scriptCache = new Map(); // abs → {mtimeMs, size, code}

function readScript(abs) {
  let st;
  try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isFile() || st.size > SCRIPT_MAX_BYTES) return null;
  const c = _scriptCache.get(abs);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.code;
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch { return null; }
  // 주석 줄은 빼고, 한 줄 안의 따옴표 문자열은 지운다(설명·grep 패턴·echo 문구에 적힌 `claude -p`·스크립트 경로는 실행이 아님)
  const code = text.split(/\r?\n/).filter((l) => !/^\s*(?:#|\/\/|::|REM\b|<#)/i.test(l))
    .map((l) => l.replace(/"(?:[^"\\\n]|\\.)*"|'[^'\n]*'/g, '""')).join('\n');
  _scriptCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, code });
  if (_scriptCache.size > 500) _scriptCache.delete(_scriptCache.keys().next().value);
  return code;
}

// 스크립트 안에서 다른 스크립트를 "실행"하는 자리만 따라간다(경로를 언급만 하는 것은 아님)
const INVOKE_BEFORE_RE = /(?:^|[\s;&|(`])(?:bash|sh|zsh|source|\.|pwsh|powershell(?:\.exe)?|cmd(?:\.exe)?\s+\/c|call|start|node|python3?|py)(?:\s+-{1,2}[\w-]+)*\s+$|(?:^|[;&|(]\s*|\bnohup\s+|\bexec\s+|\bsetsid\s+)$/i;
function invokedTokens(code) {
  const out = [];
  for (const line of code.split('\n')) {
    for (const m of line.matchAll(SCRIPT_TOKEN_RE)) {
      const t = m[0];
      if (t.includes('$') || /^https?:/i.test(t)) continue;
      if (t.startsWith('./') || INVOKE_BEFORE_RE.test(line.slice(0, m.index))) out.push(t);
    }
  }
  return out;
}

function resolveToken(tok, bases) {
  const t = toFsPath(tok);
  if (path.isAbsolute(t) || /^[A-Za-z]:[\\/]/.test(t)) return [path.resolve(t)];
  return bases.filter(Boolean).map((b) => path.resolve(toFsPath(b), t));
}

/**
 * 명령의 스크립트 사슬(깊이 2, 파일 8개)에 `claude -p` 가 있는지 정적으로 본다.
 * → { key(정규화한 첫 스크립트 경로), script(그 파일 이름), via(claude -p 가 있는 파일 경로들), cwd } 또는 null
 */
export function analyzeLaunch(launch, cwd) {
  if (!launch) return null;
  const cwdFs = cwd ? toFsPath(cwd) : null;
  const seen = new Set();
  for (const tok of launch.tokens) {
    for (const abs of resolveToken(tok, [cwdFs])) {
      if (!readScript(abs)) continue;
      // 이 첫 스크립트에서 사슬을 따라간다
      const queue = [{ abs, depth: 0 }];
      const chain = [];
      while (queue.length && seen.size < SCRIPT_MAX_FILES) {
        const { abs: f, depth } = queue.shift();
        const nf = normPath(f);
        if (seen.has(nf)) continue;
        seen.add(nf);
        const code = readScript(f);
        if (code == null) continue;
        chain.push(f);
        if (CLAUDE_P_RE.test(code)) {
          return { key: normPath(abs), script: path.basename(abs), via: chain.map((x) => normPath(x)), cwd: cwd || null };
        }
        if (depth >= SCRIPT_MAX_DEPTH) continue;
        const dir = path.dirname(f);
        const bases = [cwdFs, dir, path.dirname(dir), path.dirname(path.dirname(dir))];
        for (const t2 of invokedTokens(code)) {
          for (const a2 of resolveToken(t2, bases)) {
            try { if (fs.statSync(a2).isFile()) { queue.push({ abs: a2, depth: depth + 1 }); break; } } catch {}
          }
        }
      }
      break; // 첫 토큰이 실제 파일이면 그것만 본다(인자로 넘긴 다른 스크립트 이름은 기동 대상이 아님)
    }
  }
  return null;
}

/** 회차 cwd 가 기동 cwd 와 같거나, 기동 스크립트를 3단계 안에 품는 폴더인지 */
export function cwdMatches(childCwd, launch) {
  const c = normPath(childCwd);
  if (!c || !launch) return false;
  if (launch.cwd && c === normPath(launch.cwd)) return true;
  if (!launch.key || !launch.key.startsWith(c + '/')) return false;
  return launch.key.slice(c.length + 1).split('/').length <= 4;
}

/** 이 PC 의 마지막 부팅 시각(ms). 그 전에 띄운 기동기는 부팅으로 죽었다 */
export function bootTimeMs() {
  if (process.env.CCVIZ_BOOT_MS) return Number(process.env.CCVIZ_BOOT_MS) || 0;
  try { return Date.now() - os.uptime() * 1000; } catch { return 0; }
}

const SHELL = new Set(['Bash', 'PowerShell']);

/**
 * 프로젝트 폴더별 기동 명령 색인(전 세션·서브에이전트 transcript, 읽기 전용·증분). 라이브 런타임·재생·전체 보기가
 * 같은 판정(assign)을 쓰도록 SessionIndex 하나에 하나(`launcherIndexOf(index)`).
 */
export class LauncherIndex {
  constructor(index, { bootMs = bootTimeMs, gapMs = LAUNCH_GAP_MS, lookbackMs = LAUNCH_LOOKBACK_MS } = {}) {
    this.index = index;
    this.bootMs = typeof bootMs === 'function' ? bootMs : () => bootMs;
    this.gapMs = gapMs;
    this.lookbackMs = lookbackMs;
    this.files = new Map(); // file → {offset, rest, launches[]}
    this.subLists = new Map(); // sessionId → {mtimeMs, files:[{file}]}
    this.assigned = new Map(); // child sid → {at, res}
  }

  /** transcript 하나의 기동 명령(증분) */
  scanFile(file) {
    let st;
    try { st = fs.statSync(file); } catch { return []; }
    let c = this.files.get(file);
    if (!c || st.size < c.offset) { c = { offset: 0, rest: '', launches: [] }; this.files.set(file, c); }
    if (st.size === c.offset) return c.launches;
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const len = st.size - c.offset;
      const buf = Buffer.allocUnsafe(len);
      const n = fs.readSync(fd, buf, 0, len, c.offset);
      c.offset += n;
      const text = c.rest + buf.toString('utf8', 0, n);
      const lines = text.split('\n');
      c.rest = lines.pop();
      for (const line of lines) {
        if (!line || line.startsWith('{"type":"api-request') || !line.includes('"tool_use"') || !PREFILTER_RE.test(line)) continue;
        let r; try { r = JSON.parse(line); } catch { continue; }
        const content = r.message?.content;
        if (r.type !== 'assistant' || !Array.isArray(content)) continue;
        for (const b of content) {
          if (!b || b.type !== 'tool_use' || !SHELL.has(b.name) || typeof b.input?.command !== 'string') continue;
          const L = detectLaunch(b.input.command, { bg: !!b.input.run_in_background, tool: b.name });
          if (!L) continue;
          const cwd = resolveCwdGuess(r.cwd || null, L.cdGuess);
          const a = this.index.launchPin?.(b.id) || analyzeLaunch(L, cwd); // 보관함 고정 판정 우선
          if (!a) continue;
          c.launches.push({ sessionId: String(r.sessionId || '').toLowerCase(), agentId: r.agentId || null, toolUseId: b.id,
            tsMs: Date.parse(r.timestamp), file, cwd: a.cwd, key: a.key, script: a.script, via: a.via, bg: L.bg, detached: L.detached });
        }
      }
    } catch { /* 읽기 실패는 다음에 */ } finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
    return c.launches;
  }

  /** 세션 하나의 하위 transcript(서브에이전트·워크플로) 목록. 메인 mtime 이 같으면 캐시 */
  _subFiles(e) {
    const c = this.subLists.get(e.sessionId);
    if (c && c.mtimeMs === e.mtimeMs) return c.files;
    const out = [];
    const walk = (dir, depth) => {
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const d of ents) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) { if (depth < 2) walk(p, depth + 1); continue; }
        if (!d.name.endsWith('.jsonl') || d.name === 'journal.jsonl') continue;
        try { const st = fs.statSync(p); out.push({ file: p, mtimeMs: st.mtimeMs, birthMs: st.birthtimeMs || st.ctimeMs }); } catch {}
      }
    };
    walk(path.join(e.projectPath, e.sessionId, 'subagents'), 0);
    this.subLists.set(e.sessionId, { mtimeMs: e.mtimeMs, files: out });
    return out;
  }

  /**
   * sdk-cli 세션 e(회차)를 띄운 기동 명령. → {sessionId, toolUseId, tsMs, key, script, confidence, evidence[]} 또는
   * {none: reason}(붙이지 않음). 규칙은.
   */
  async assign(e) {
    const idx = this.index;
    const h = await idx.ensureHead(e);
    if (h.entrypoint !== 'sdk-cli' || !h.firstTs || !h.cwd) return { none: 'not-sdk' };
    // 보관함: 보관 때 원본에서 정한 회차 판정을 그대로(보관함엔 다른 메인·형제 회차·기동 기록이 없어 다시 셈하면 답이 달라진다)
    const pin = idx.assignPin?.(e.sessionId);
    if (pin) return pin;
    const t = Date.parse(h.firstTs);
    if (!Number.isFinite(t)) return { none: 'no-ts' };
    const memo = this.assigned.get(e.sessionId);
    // 붙은 결과·오래된 회차의 결과는 고정. 최근(10분) 회차의 '없음'은 5초 뒤 다시 본다(기동 기록이 늦게 읽힐 수 있음)
    if (memo && (!memo.res.none || Date.now() - t > 600_000 || Date.now() - memo.at < 5000)) return memo.res;
    const res = await this._assign(e, h, t);
    this.assigned.set(e.sessionId, { at: Date.now(), res });
    if (this.assigned.size > 5000) this.assigned.delete(this.assigned.keys().next().value);
    return res;
  }

  /** 캐시에 있는 결과만(동기). 없으면 null */
  peek(sessionId) { return this.assigned.get(sessionId)?.res || null; }

  async _assign(e, h, t) {
    const idx = this.index;
    const gap = this.gapMs;
    const boot = this.bootMs();
    const cwdN = normPath(h.cwd);
    // 기동 명령 후보 = 같은 프로젝트 폴더 transcript(메인·서브에이전트·다른 회차)의 기동 중 cwd 가 맞고 회차 시작 전인 것.
    // 가장 늦은 기동이 이긴다(다시 띄우면 앞 것을 대신한다). 최신순으로 읽다가 두 번째 후보보다 오래된 파일에서 멈춘다
    const lo = t - this.lookbackMs;
    const files = [];
    for (const x of idx.entries.values()) {
      if (x.projectDir !== e.projectDir || x.sessionId === e.sessionId) continue;
      if (x.mtimeMs < lo) continue;
      // 첫 기록이 회차 시작보다 늦은 세션은 그 전 기동을 담을 수 없다(파일 생성 시각은 복사·복원에 흔들려 쓰지 않음)
      const ft = x.head?.firstTs ? Date.parse(x.head.firstTs) : NaN;
      if (ft > t + 2000) continue;
      files.push({ file: x.file, mtimeMs: x.mtimeMs });
      for (const s of this._subFiles(x)) if (s.mtimeMs >= lo) files.push(s);
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    let best = null, prev = null;
    for (const f of files) {
      if (prev && f.mtimeMs < prev.tsMs) break;
      for (const L of this.scanFile(f.file)) {
        if (!(L.tsMs <= t + 2000 && L.tsMs >= lo) || !cwdMatches(h.cwd, L)) continue;
        if (!best || L.tsMs > best.tsMs) { if (best) prev = best; best = L; }
        else if (L !== best && (!prev || L.tsMs > prev.tsMs)) prev = L;
      }
    }
    if (!best) return { none: 'no-launch' };
    // 같은 cwd 회차들(시작 순) — 기동 → 회차들 → 이 회차가 gap 안에서 이어져야 그 기동기가 아직 살아 있다
    const from = Math.min(best.tsMs, prev ? prev.tsMs : best.tsMs) - 2000;
    const sibs = (await idx.recentSdkChildren(from, t))
      .filter((x) => x.sessionId !== e.sessionId && x.head?.cwd && normPath(x.head.cwd) === cwdN && Date.parse(x.head.firstTs) < t)
      .map((x) => ({ s: Date.parse(x.head.firstTs), end: Math.max(Date.parse(x.head.firstTs), x.mtimeMs) }))
      .sort((a, b) => a.s - b.s);
    const openAt = (L, at) => {
      if (L.tsMs < boot && at >= boot) return false; // 부팅 전에 띄운 것은 부팅 뒤에 살아 있을 수 없다
      let prevEnd = L.tsMs;
      for (const s of sibs) {
        if (s.s < L.tsMs - 2000 || s.s >= at) continue;
        if (s.s - prevEnd > gap) return false;
        prevEnd = Math.max(prevEnd, s.end);
      }
      return at - prevEnd <= gap;
    };
    if (!openAt(best, t)) return { none: best.tsMs < boot && t >= boot ? 'reboot' : 'gap' };
    const evidence = ['script-claude-p', 'cwd', 'time', 'chain'];
    if (boot) evidence.push('boot');
    let confidence = 'high';
    if (prev && openAt(prev, best.tsMs)) {
      // 앞서 띄운 기동기(다른 스크립트면 더욱)가 다시 띄울 때 아직 살아 있었을 수 있다
      if (prev.key !== best.key && best.tsMs - prev.tsMs < 60_000) return { none: 'ambiguous' };
      confidence = 'medium';
      evidence.push(prev.key === best.key ? 'earlier-same-launcher-open' : 'earlier-other-launcher-open');
    }
    const adopter = await this._adopter(e, best, t);
    if (adopter) evidence.push('adopted');
    return { sessionId: best.sessionId, agentId: best.agentId, toolUseId: best.toolUseId, tsMs: best.tsMs, key: best.key, script: best.script,
      cwd: best.cwd, via: best.via, confidence, evidence, adopter };
  }

  /**
   * 인계: 기동한 세션이 회차 시작 전에 끝났으면(프로세스 기록이 살아 있지 않고 transcript 가 회차 시작 전에 멈춤)
   * 같은 프로젝트에서 기동 뒤·회차 시작 전에 시작한 cli 메인 중 회차 시작 시각에 살아 있던(그 뒤에도 기록한) 것, 없으면 가장 늦게
   * 시작한 것이 회차를 맡는다. 메인이 늘 최상위가 되게 하는 규칙. 맡을 메인이 없으면 null(기동한 세션 아래 그대로)
   */
  async _adopter(e, best, t) {
    const idx = this.index;
    const owner = idx.findSession(best.sessionId);
    const ownerHead = owner ? await idx.ensureHead(owner) : null;
    const alive = (sid) => !!idx.procs?.get?.(String(sid).toLowerCase())?.alive;
    const ownerIsMain = ownerHead && ownerHead.entrypoint !== 'sdk-cli';
    if (owner && ownerIsMain && (alive(owner.sessionId) || owner.mtimeMs >= t)) return null;
    let pick = null, pickSpan = false, pickStart = -Infinity;
    for (const x of idx.entries.values()) {
      if (x.projectDir !== e.projectDir || x.sessionId === best.sessionId || x.sessionId === e.sessionId || x.mtimeMs < best.tsMs) continue;
      const h = await idx.ensureHead(x);
      if (!h.firstTs || h.entrypoint === 'sdk-cli' || idx.claimedChildren?.has(x.sessionId)) continue;
      const s = Date.parse(h.firstTs);
      if (!(s > best.tsMs && s <= t + 2000) || !cwdMatches(h.cwd, best)) continue;
      const span = alive(x.sessionId) || x.mtimeMs >= t;
      if (!pick || (span && !pickSpan) || (span === pickSpan && s > pickStart)) { pick = x.sessionId; pickSpan = span; pickStart = s; }
    }
    return pick;
  }

  /**
   * 이 기동을 대신한(나중에 다시 띄운) 가장 이른 기동 시각. 같은 스크립트이거나 같은 cwd 를 겨누는 기동(사슬에 claude -p).
   * 읽어 둔 transcript(primeProject) 안에서만 찾는다. 없으면 null
   */
  supersededAt(launch) {
    let best = null;
    const cw = launch.cwd ? normPath(launch.cwd) : null;
    for (const c of this.files.values()) {
      for (const L of c.launches) {
        if (L.toolUseId === launch.toolUseId || !(L.tsMs > launch.tsMs)) continue;
        if (L.key !== launch.key && !(cw && L.cwd && normPath(L.cwd) === cw)) continue;
        if (best == null || L.tsMs < best) best = L.tsMs;
      }
    }
    return best;
  }

  /** 지금 회차 후보 쪽에서 기동 명령들을 미리 읽어 둔다(supersededAt 용) */
  primeProject(projectDir, sinceMs) {
    for (const x of this.index.entries.values()) {
      if (x.projectDir !== projectDir || x.mtimeMs < sinceMs) continue;
      this.scanFile(x.file);
      for (const s of this._subFiles(x)) if (s.mtimeMs >= sinceMs) this.scanFile(s.file);
    }
  }
}

/** SessionIndex 하나에 LauncherIndex 하나 */
export function launcherIndexOf(index) {
  if (!index.launchers) index.launchers = new LauncherIndex(index);
  return index.launchers;
}
