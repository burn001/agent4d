// 분리 프로세스(detached process) — 포그라운드 셸이 claude -p 아닌 프로그램·스크립트를 떼어 띄운 것과, 그 출력 파일(로그)을
// 다른 셸·Monitor 가 들여다보는(watch) 관계. 순수 코어: 그래프 없음, 파일은 읽지 않는다(경로 계산만).
//
// 판정(detectProcLaunch): 명령을 따옴표·괄호 밖 `&&`·`||`·`;`·줄바꿈·홀로 선 `&` 로 나누고, 분리 표지(nohup·setsid·disown·홀로 선 &·
// `( … ) &`·Start-Process/saps·Start-Job·`start /b`)가 붙은 단순 명령에서 실행 프로그램을 고른다. 노드를 세우는 것은
//  ① 인터프리터(python·node·bash…)가 스크립트·모듈(`-m`)을 돌리거나 ② 경로로 적은 실행 파일·스크립트이거나
//  ③ 그 밖의 프로그램이라도 표준 출력·오류를 파일로 보낸(로그가 있는) 것. sleep·echo·GUI 열기(start chrome·explorer·code…)는 아님.
import path from 'node:path';
import os from 'node:os';
import { redact } from './redact.mjs';
import { normPath, truncate } from './parse.mjs';

export const PROC = {
  STALE_DEFAULT_SEC: 300, // 줄 간격을 아직 모를 때 정체 문턱
  STALE_MIN_SEC: 120, STALE_MAX_SEC: 3600,
  STALE_K: 4,             // 정체 문턱 = 최근 줄 간격 중앙값 × K
  GAPS: 8,                // 정체 문턱 계산에 쓰는 최근 간격 수
  QUIET_END_K: 12,        // 장시간 무성장 → 끝(done·quiet): 정체 문턱 × K (최소 1시간, 최대 6시간)
  QUIET_END_MIN_SEC: 3600, QUIET_END_MAX_SEC: 6 * 3600,
  SPAWNER_QUIET_SEC: 600, // 띄운 노드가 끝난 뒤 이만큼(또는 정체 문턱 중 큰 것) 조용하면 끝(done·spawner-ended)
  FAIL_QUIET_MS: 20_000,  // Traceback 뒤 이만큼 조용하면 실패 확정(라이브)
  KILL_GRACE_MS: 10_000,  // 끄는 명령 뒤 이만큼 로그가 안 자라면 중지됨(라이브)
  CMD_MAX: 160, MAX_PER_CALL: 4,
};

const NULL_SINKS = new Set(['/dev/null', 'nul', '$null', 'null', '/dev/stdout', '/dev/stderr']);
const WRAPPERS = new Set(['nohup', 'setsid', 'nice', 'ionice', 'stdbuf', 'time', 'env', 'exec', 'command', 'timeout', 'caffeinate', 'sudo', 'winpty', 'unbuffer', 'chronic']);
const DENY = new Set(['sleep', 'echo', 'printf', 'true', 'false', 'wait', 'cd', 'pushd', 'popd', 'read', 'cat', 'tail', 'head', 'less', 'more', 'grep', 'ls', 'test', '[', '[[',
  'exit', 'export', 'set', 'unset', 'source', '.', 'open', 'xdg-open', 'explorer', 'code', 'notepad', 'chrome', 'msedge', 'firefox', 'start', 'invoke-item', 'ii',
  'disown', 'kill', 'taskkill', 'pkill', 'killall', 'for', 'do', 'done', 'while', 'until', 'if', 'then', 'fi', 'else', 'elif', 'case', 'esac', 'function', 'touch', 'mkdir',
  'rm', 'cp', 'mv', 'date', 'tasklist', 'ps', 'jobs', 'fg', 'bg', 'write-host', 'write-output', 'start-sleep', 'clear', 'cls', 'mspaint', 'calc', 'claude']);
const INTERP_RE = /^(?:python[\d.]*|py|pythonw|node|nodejs|deno|bun|tsx|ts-node|bash|sh|zsh|dash|pwsh|powershell|rscript|ruby|perl|php|java|julia|lua|dotnet)$/i;
const RUNNERS = new Set(['npm', 'npx', 'pnpm', 'yarn', 'uv', 'uvx', 'poetry', 'pipenv', 'conda', 'make', 'cargo', 'go', 'gradle', 'mvn']);
const SCRIPT_EXT_RE = /\.(?:py|pyw|sh|bash|zsh|ps1|psm1|js|mjs|cjs|ts|mts|rb|pl|php|r|jl|lua|jar|exe|bat|cmd)$/i;

/** /d/x → D:/x(Windows), ~ → 홈 */
export function fsPathOf(p) {
  let s = String(p || '').trim().replace(/^~(?=[\\/]|$)/, os.homedir());
  const m = /^\/([a-zA-Z])(?=\/|$)/.exec(s);
  if (m && process.platform === 'win32') s = `${m[1].toUpperCase()}:` + (s.slice(2) || '/');
  return s;
}

/** 기준 폴더에서 경로 풀기 → 절대 경로(파일 시스템 꼴) 또는 null */
export function resolvePath(base, p) {
  if (p == null || p === '') return null;
  const s = fsPathOf(String(p).replace(/^["']|["']$/g, ''));
  if (!s || /\$|[*?<>|]/.test(s) || /^[a-z][\w+.-]*:\/\//i.test(s)) return null;
  if (NULL_SINKS.has(s.toLowerCase())) return null;
  if (path.isAbsolute(s) || /^[A-Za-z]:[\\/]/.test(s)) return path.resolve(s);
  if (!base) return null;
  return path.resolve(fsPathOf(base), s);
}

/** 정규화 경로(비교용: 소문자·`/`) */
export const normFile = (p) => (p ? normPath(path.resolve(p)) : '');

/**
 * 명령 문자열 → 최상위 단위 [{text, sep}] — 따옴표·`$( )`·괄호·중괄호 안은 나누지 않는다.
 * sep: '&&' | '||' | ';' | '\n' | '&'(뒤로 보냄 — Bash 만) | null(끝)
 */
export function splitTop(s, { ps = false } = {}) {
  const out = [];
  let q = null, depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"' && !ps) { i++; continue; }
      if (c === '`' && q === '"' && ps) { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '\\' && !ps) { i++; continue; }
    if (c === '`' && ps) { i++; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '(' || c === '{') { depth++; continue; }
    if (c === ')' || c === '}') { depth = Math.max(0, depth - 1); continue; }
    if (depth) continue;
    const two = s.slice(i, i + 2);
    let sep = null;
    if (two === '&&' || two === '||') sep = two;
    else if (c === ';' || c === '\n') sep = c;
    else if (c === '&' && !ps) {
      const prev = s[i - 1], next = s[i + 1];
      if (prev === '>' || prev === '<' || prev === '|' || next === '>') continue; // >& <& |& &>
      sep = '&';
    }
    if (!sep) continue;
    out.push({ text: s.slice(start, i), sep });
    i += sep.length - 1;
    start = i + 1;
  }
  out.push({ text: s.slice(start), sep: null });
  return out.filter((x) => x.text.trim());
}

const OP_RE = /^(?:\d?>>?&\d+|&>>?|\*>>?|\d?>>?|<<?|\|&?)/;

/** 단순 명령 → 낱말·연산자 [{op}|{w, q(따옴표 있었음)}] */
export function tokenize(s, { ps = false } = {}) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const m = OP_RE.exec(s.slice(i));
    if (m && !(s[i] === '<' && ps)) { out.push({ op: m[0] }); i += m[0].length; continue; }
    let w = '', quoted = false;
    while (i < s.length && !/\s/.test(s[i])) {
      const c = s[i];
      if (c === '"' || c === "'") {
        quoted = true;
        const j = s.indexOf(c, i + 1);
        const end = j < 0 ? s.length : j;
        w += s.slice(i + 1, end);
        i = end + 1;
        continue;
      }
      if (/[|<>]/.test(c) || (c === '&' && !ps && /[>]/.test(s[i + 1] || ''))) break;
      if (/\d/.test(c) && /[<>]/.test(s[i + 1] || '') && w === '') break;
      if (c === '\\' && !ps && i + 1 < s.length && !/[A-Za-z0-9_.\-]/.test(s[i + 1])) { w += s[i + 1]; i += 2; continue; }
      w += c; i++;
    }
    if (w !== '' || quoted) out.push({ w, q: quoted });
  }
  return out;
}

const base = (p) => String(p || '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');

/** 낱말 목록에서 맨 앞 환경 변수 대입·감싸개(nohup·env·timeout …)를 걷어 낸 나머지와 걷어 낸 표지 */
function unwrap(words) {
  const marks = new Set();
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (/^[A-Za-z_]\w*=/.test(w)) { i++; continue; }
    const b = base(w).toLowerCase();
    if (WRAPPERS.has(b)) {
      marks.add(b);
      i++;
      // 감싸개 옵션·인자: -x, -n 10, timeout 의 시간, env 의 X=Y
      while (i < words.length && (/^-/.test(words[i]) || /^[A-Za-z_]\w*=/.test(words[i]) || (b === 'timeout' && /^\d+[smhd]?$/.test(words[i])))) {
        if (/^-(?:n|o|e|i|k|s|-signal|-kill-after)$/.test(words[i]) && i + 1 < words.length && !/^-/.test(words[i + 1]) && b !== 'env') i++;
        i++;
      }
      continue;
    }
    break;
  }
  return { rest: words.slice(i), marks };
}

/** 인터프리터 인자에서 실행 대상(스크립트 파일·`-m 모듈`·`-c`) */
function interpTarget(prog, args) {
  const p = prog.toLowerCase();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^python|^py$|^pythonw/.test(p)) {
      if (a === '-m' && args[i + 1]) return { script: args[i + 1], module: true };
      if (a === '-c') return { code: true };
      if (/^-[XWQ]$/.test(a)) { i++; continue; }
      if (/^-/.test(a)) continue;
      return { script: a };
    }
    if (p === 'java') {
      if (a === '-jar' && args[i + 1]) return { script: args[i + 1] };
      if (/^-(?:cp|classpath)$/.test(a)) { i++; continue; }
      if (/^-/.test(a)) continue;
      return { script: a, module: true };
    }
    if (/^(?:bash|sh|zsh|dash|pwsh|powershell)$/.test(p)) {
      if (/^-(?:c|command)$/i.test(a)) return { code: true, inner: args[i + 1] || '' };
      if (/^-file$/i.test(a) && args[i + 1]) return { script: args[i + 1] };
      if (/^-/.test(a)) continue;
      return { script: a };
    }
    if (/^(?:-e|--eval|-p|--print)$/.test(a)) return { code: true };
    if (/^-/.test(a)) { if (/^--[\w-]+$/.test(a) && /^(?:--(?:require|import|loader|inspect-port|env-file))$/.test(a)) i++; continue; }
    if (p === 'dotnet' && a === 'run') return { script: 'run', module: true };
    return { script: a };
  }
  return null;
}

/** 리다이렉트 낱말 목록에서 표준 출력·오류 파일, tee 파일, 나머지 낱말(파이프 첫 명령) */
function redirects(toks) {
  const words = [];
  let stdout = null, stderr = null, errToOut = false, tee = null, pipe = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.op) {
      const op = t.op;
      if (op === '|' || op === '|&') { pipe++; continue; }
      if (/^\d?>>?&\d+$/.test(op)) { if (/^2>>?&1$/.test(op)) errToOut = true; continue; }
      const nx = toks[i + 1];
      if (!nx || nx.op) continue;
      i++;
      if (op[0] === '<') continue;
      const target = nx.w;
      if (/^(?:&>>?|\*>>?)$/.test(op)) { stdout = stdout || target; errToOut = true; }
      else if (/^2>>?$/.test(op)) stderr = stderr || target;
      else if (/^(?:1?>>?)$/.test(op)) stdout = stdout || target;
      continue;
    }
    if (pipe === 0) words.push(t.w);
    else if (base(t.w).toLowerCase() === 'tee') {
      // tee [-a] 파일
      for (let k = i + 1; k < toks.length && !toks[k].op; k++) if (!/^-/.test(toks[k].w)) { tee = tee || toks[k].w; break; }
    }
  }
  return { words, stdout, stderr: errToOut ? (stdout || stderr) : stderr, errToOut, tee };
}

const isSink = (f) => !f || NULL_SINKS.has(String(f).toLowerCase());

/** 출력 폴더 인자(--out·-o·--output·--out-dir·--log-dir) */
function outDirArgs(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const m = /^(--(?:out|output|out-dir|outdir|output-dir|log-dir|logdir|results?-dir)|-o)(?:=(.+))?$/i.exec(words[i]);
    if (!m) continue;
    const v = m[2] ?? words[i + 1];
    if (v && !/^-/.test(v)) out.push(v);
  }
  return out;
}

/** PowerShell 매개변수 값(이름은 앞부분 일치, 대소문자 무시) */
function psParam(words, names) {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!/^-/.test(w)) continue;
    const n = w.slice(1).toLowerCase();
    if (names.some((x) => x.startsWith(n) && n.length >= 2)) return words[i + 1] ?? null;
  }
  return null;
}

/** 쉼표·공백으로 나눈 인자 목록(PowerShell ArgumentList) */
const argList = (v) => (v == null ? [] : String(v).split(/\s*,\s*|\s+/).map((x) => x.replace(/^["']|["']$/g, '')).filter(Boolean));

/**
 * 셸 명령이 떼어 띄운 프로그램들. 없으면 [].
 * @param {string} command
 * @param {{tool?:'Bash'|'PowerShell', cwd?:string|null}} opts cwd = 기록의 작업 폴더(앞쪽 cd 를 차례로 따라감)
 * @returns {Array<{prog, script, cmd, via, cwd, log, logs:string[], outDirs:string[]}>} log·logs·outDirs = 절대 경로(파일 시스템 꼴)
 */
export function detectProcLaunch(command, { tool = 'Bash', cwd = null } = {}) {
  if (typeof command !== 'string' || !command.trim()) return [];
  const ps = tool === 'PowerShell';
  const out = [];
  walk(command, { ps, cwd, inherit: null, outer: null }, out);
  return out.slice(0, PROC.MAX_PER_CALL);
}

function walk(cmd, ctx, out) {
  const units = splitTop(cmd, { ps: ctx.ps });
  let cwd = ctx.cwd;
  for (let u = 0; u < units.length; u++) {
    const { text, sep } = units[u];
    const t = text.trim();
    const next = units[u + 1]?.text.trim() || '';
    const bgAmp = sep === '&';
    const disownNext = /^disown\b/.test(next);
    // cd 는 다음 단위의 기준 폴더
    const cdm = /^(?:cd|pushd|Set-Location|sl|chdir)(?:\s+\/d)?\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/i.exec(t);
    if (cdm) { const r = resolvePath(cwd, cdm[1] || cdm[2] || cdm[3]); if (r) cwd = r; continue; }
    // ( … ) / { …; } 묶음: 안을 다시 걷는다(뒤로 보냈으면 안의 명령 모두 분리), 묶음 밖 리다이렉트는 안의 기본 로그
    const g = /^[({]([\s\S]*)[)}]([^)}]*)$/.exec(t);
    if (g && (t[0] === '(' || t[0] === '{')) {
      const red = redirects(tokenize(g[2], { ps: ctx.ps }));
      const outer = !isSink(red.stdout) ? resolvePath(cwd, red.stdout) : (!isSink(red.tee) ? resolvePath(cwd, red.tee) : null);
      walk(g[1], { ps: ctx.ps, cwd, inherit: bgAmp || disownNext ? (bgAmp ? '&' : 'disown') : ctx.inherit, outer: outer || ctx.outer }, out);
      continue;
    }
    one(t, { ...ctx, cwd, detachVia: bgAmp ? '&' : disownNext ? 'disown' : ctx.inherit }, out);
  }
}

function one(text, ctx, out) {
  const toks = tokenize(text, { ps: ctx.ps });
  const red = redirects(toks);
  let { rest, marks } = unwrap(red.words);
  if (!rest.length) return;
  let via = marks.has('nohup') ? 'nohup' : marks.has('setsid') ? 'setsid' : ctx.detachVia || null;
  let words = rest;
  let cwd = ctx.cwd;
  let stdout = red.stdout, stderr = red.stderr, tee = red.tee;
  let first = base(words[0]).toLowerCase();
  // PowerShell·cmd 의 분리 실행
  if (/^(?:start-process|saps)$/i.test(first)) {
    via = 'Start-Process';
    const args = words.slice(1);
    let file = psParam(args, ['filepath']);
    let al = psParam(args, ['argumentlist', 'args']);
    const wd = psParam(args, ['workingdirectory']);
    if (wd) cwd = resolvePath(cwd, wd) || cwd;
    const pos = args.filter((w, i) => !/^-/.test(w) && !(i > 0 && /^-/.test(args[i - 1]) && !/^-(?:nonewwindow|passthru|wait)$/i.test(args[i - 1])));
    if (!file) file = pos[0] || null;
    if (!al && pos.length > 1) al = pos.slice(1).join(' ');
    stdout = psParam(args, ['redirectstandardoutput']) || stdout;
    stderr = psParam(args, ['redirectstandarderror']) || stderr;
    if (!file) return;
    const fb = base(file).toLowerCase();
    // bash.exe -c "cd … && x > log" 꼴은 안쪽 명령을 Bash 로 다시 걷는다
    if (/^(?:bash|sh|zsh)$/.test(fb) && al) {
      const inner = /(?:^|[,\s])-c['"]?\s*[,\s]\s*(['"])([\s\S]*)\1\s*$/.exec(String(al));
      if (inner) { walk(inner[2], { ps: false, cwd, inherit: 'Start-Process', outer: null }, out); return; }
    }
    words = [file, ...argList(al)];
    first = fb;
  } else if (/^start-job$/i.test(first)) {
    via = 'Start-Job';
    const sb = /-ScriptBlock\s*\{([\s\S]*)\}/i.exec(text);
    if (sb) { walk(sb[1], { ps: true, cwd, inherit: 'Start-Job', outer: null }, out); return; }
    const f = psParam(words.slice(1), ['filepath']);
    if (!f) return;
    words = ['pwsh', '-File', f];
    first = 'pwsh';
  } else if (first === 'start' && /^\/b$/i.test(words[1] || '')) {
    via = 'start /b';
    words = words.slice(2).filter((w, i) => !(i === 0 && /^".*"$/.test(w)));
    if (!words.length) return;
    first = base(words[0]).toLowerCase();
  } else if (first === '&' || (ctx.ps && words[0] === '&')) {
    words = words.slice(1);
    if (!words.length) return;
    first = base(words[0]).toLowerCase();
  }
  if (!via) return;
  if (!first || DENY.has(first)) return;
  // 로그: 표준 출력 → 오류 → tee → 묶음 밖 리다이렉트
  const logs = [];
  for (const f of [stdout, stderr, tee]) { if (!isSink(f)) { const r = resolvePath(cwd, f); if (r && !logs.includes(r)) logs.push(r); } }
  if (!logs.length && ctx.outer) logs.push(ctx.outer);
  // 실행 대상 고르기
  let prog = base(words[0]);
  let args = words.slice(1);
  if (RUNNERS.has(first) && args.length) {
    // uv run python x.py · poetry run python x.py · conda run -n env python x.py · npx tsx x.ts
    let k = 0;
    while (k < args.length && (/^(?:run|exec|x|-n|--name|-p|--prefix)$/.test(args[k]) || (/^-/.test(args[k])) || (k > 0 && /^-(?:n|p)$/.test(args[k - 1])))) k++;
    if (k < args.length && (INTERP_RE.test(base(args[k])) || SCRIPT_EXT_RE.test(args[k]))) { prog = base(args[k]); args = args.slice(k + 1); first = prog.toLowerCase(); }
  }
  let script = null, ok = false;
  if (INTERP_RE.test(first)) {
    const tg = interpTarget(first, args);
    if (tg && tg.inner) { walk(tg.inner, { ps: /^(?:pwsh|powershell)$/.test(first), cwd, inherit: via, outer: logs[0] || ctx.outer }, out); return; }
    if (tg && tg.script) { script = tg.module ? `-m ${tg.script}` : String(tg.script).replace(/^.*[\\/]/, ''); ok = true; }
    else ok = logs.length > 0; // -c·-e 코드나 대상 없음: 로그가 있을 때만
  } else if (/[\\/]/.test(words[0]) || SCRIPT_EXT_RE.test(words[0])) {
    ok = true; script = String(words[0]).replace(/^.*[\\/]/, '');
  } else if (RUNNERS.has(first)) {
    ok = logs.length > 0; script = args.find((a) => !/^-/.test(a)) || null;
  } else {
    ok = logs.length > 0;
  }
  if (!ok) return;
  const shown = truncate(redact(text.replace(/\s+/g, ' ').trim()), PROC.CMD_MAX);
  out.push({ prog, script, cmd: shown, via, cwd: cwd || null, log: logs[0] || null, logs, outDirs: outDirArgs(words).map((d) => resolvePath(cwd, d)).filter(Boolean) });
}

// ───────────── 들여다보기(watch) ─────────────

const WAIT_RE = /\b(?:until|while)\b[\s\S]*\bdo\b|\bsleep\s+\d|\btail\s+-[a-zA-Z]*[fF]\b|\binotifywait\b|\bWait-Process\b|\bStart-Sleep\b|\bGet-Content\b[^|;]*-Wait\b|\bwatch\s+-n\b|\bfor\b[\s\S]*\bsleep\b/i;
/** 기다리는 명령인가(반복·sleep·tail -f …) */
export const isWaitCommand = (cmd) => typeof cmd === 'string' && WAIT_RE.test(cmd);

const PATHISH_RE = /[\\/]|\.(?:log|out|err|txt|json|jsonl|csv|tsv|md|html|xml|yaml|yml|done|pid|lock|status|parquet|pkl|npz|db|sqlite)$/i;

/**
 * 명령이 가리키는 파일·폴더 경로들(정규화). cd 를 차례로 따라가 상대 경로를 풀고, `L=경로` 대입 값도 넣는다.
 * @returns {string[]} normFile 꼴
 */
export function commandPathRefs(command, { tool = 'Bash', cwd = null } = {}) {
  if (typeof command !== 'string' || !command) return [];
  const ps = tool === 'PowerShell';
  const refs = new Set();
  const visit = (cmd, cw, depth) => {
    if (depth > 4) return;
    let cur = cw;
    for (const { text } of splitTop(cmd, { ps })) {
      const t = text.trim();
      const cdm = /^(?:cd|pushd|Set-Location|sl|chdir)(?:\s+\/d)?\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/i.exec(t);
      if (cdm) { const r = resolvePath(cur, cdm[1] || cdm[2] || cdm[3]); if (r) cur = r; continue; }
      const g = /^[({]([\s\S]*)[)}]([^)}]*)$/.exec(t);
      if (g) { visit(g[1], cur, depth + 1); }
      for (const tk of tokenize(t, { ps })) {
        if (tk.op) continue;
        let w = tk.w;
        const asg = /^[A-Za-z_]\w*=(.+)$/.exec(w);
        if (asg) w = asg[1];
        w = w.replace(/^[(\[{]+|[)\]};,]+$/g, '');
        if (!w || /^-/.test(w) || !PATHISH_RE.test(w) || /^\$/.test(w) || /[\^[\]*?{}|()]/.test(w)) continue; // grep 패턴·글롭은 경로 아님
        // 셸 변수가 섞인 경로는 앞부분(변수 전)만 — 폴더로 볼 수 있으면
        const plain = w.includes('$') ? w.slice(0, w.indexOf('$')).replace(/[\\/][^\\/]*$/, '') : w;
        const r = resolvePath(cur, plain);
        if (r) refs.add(normFile(r));
      }
    }
  };
  visit(command, cwd, 0);
  return [...refs];
}

// ───────────── 끝 표지 ─────────────

const EXIT_RES = [
  /^(?:EXIT|Exit|exit)(?:\s+(?:code|status))?\s*[:=]?\s*(-?\d{1,3})$/,
  /^(?:rc|RC|returncode|return code|exit_code|exitcode|exit status|종료 ?코드)\s*[:=]\s*(-?\d{1,3})$/,
  /^Process finished with exit code (-?\d{1,3})$/,
  /^\[(?:exit|rc|done)[:= ]\s*(-?\d{1,3})\]$/i,
];
const SIGNAL_RE = /^(?:Killed|Terminated|Hangup|Segmentation fault(?: \(core dumped\))?|Aborted(?: \(core dumped\))?)$/;
const TRACE_RE = /^Traceback \(most recent call last\):\s*$/;
const EXC_RE = /^([A-Za-z_][\w.]*(?:Error|Exception|Interrupt|Exit|Warning)?)(?::\s.*|\s*)$/;

/**
 * 출력 줄 하나의 끝 표지. → {state:'done'|'failed'|'stopped', rc|null, reason} | {trace:true} | {exc:'이름'} | null
 *  'EXIT 0'·'rc=0'(줄 전체) → done/failed(rc), 'Killed'·'Terminated' → stopped(signal), Traceback 머리 → {trace}, 예외 줄 → {exc}
 */
export function endSignal(line) {
  const s = String(line || '').trim();
  if (!s || s.length > 200) return null;
  for (const re of EXIT_RES) {
    const m = re.exec(s);
    if (m) { const rc = Number(m[1]); return { state: rc === 0 ? 'done' : (rc === 130 || rc === 137 || rc === 143 ? 'stopped' : 'failed'), rc, reason: rc === 0 ? 'exit' : 'exit-code' }; }
  }
  if (SIGNAL_RE.test(s)) return { state: 'stopped', rc: null, reason: 'signal' };
  if (TRACE_RE.test(s)) return { trace: true };
  const e = EXC_RE.exec(s);
  if (e && /(?:Error|Exception|Interrupt|Exit)$/.test(e[1])) return { exc: e[1] };
  return null;
}

/**
 * 출력 조각을 줄마다 보며 끝 상태를 굴린다(라이브·재생 같은 순서면 같은 답).
 * st = { trace:bool, failAt:ISO|null, exc:string|null, end:{state, rc, reason}|null, lastLine }
 * Traceback 머리 뒤 예외 줄 → failAt(확정은 조용함으로 — session 이 판정), 그 뒤 진행이 다시 오면 풀림(revive 는 session).
 */
export function scanEnd(st, text, tsIso) {
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    st.lastLine = line;
    const sig = endSignal(line);
    if (!sig) { if (st.failAt && !/^\s/.test(line)) { st.failAt = null; st.exc = null; } continue; }
    if (sig.trace) { st.trace = true; continue; }
    if (sig.exc) {
      if (st.trace || /Interrupt$/.test(sig.exc)) { st.failAt = tsIso; st.exc = sig.exc; st.trace = false; }
      continue;
    }
    st.end = sig;
  }
  return st;
}

/**
 * 적응 정체 문턱(초): 최근 줄 간격(초) 중앙값 × K, [최소, 최대] 안. 간격이 없으면 기본값.
 */
export function adaptiveStaleSec(gaps) {
  const g = (gaps || []).filter((x) => Number.isFinite(x) && x > 0).slice(-PROC.GAPS).sort((a, b) => a - b);
  if (!g.length) return PROC.STALE_DEFAULT_SEC;
  const med = g[Math.floor(g.length / 2)];
  return Math.round(Math.min(PROC.STALE_MAX_SEC, Math.max(PROC.STALE_MIN_SEC, med * PROC.STALE_K)));
}

/** 장시간 무성장 끝 문턱(초) */
export const quietEndSec = (staleSec) => Math.min(PROC.QUIET_END_MAX_SEC, Math.max(PROC.QUIET_END_MIN_SEC, (staleSec || PROC.STALE_DEFAULT_SEC) * PROC.QUIET_END_K));

/** 끄는 명령이 이 프로세스를 겨누는지: 프로그램·스크립트 이름(확장자 뺌)·PID 힌트가 명령에 보이거나 `kill %n`·`pkill -f` 꼴 */
export function killTargets(cmd, proc) {
  if (typeof cmd !== 'string' || !proc) return false;
  const c = cmd.toLowerCase();
  const names = [proc.prog, proc.script].filter(Boolean).map((x) => String(x).toLowerCase().replace(/\.(?:exe|py|js|mjs|sh|ps1)$/, '')).filter((x) => x.length >= 3);
  if (names.some((n) => c.includes(n))) return true;
  if (proc.pidHint && proc.pidHint.pid && new RegExp(`\\b${proc.pidHint.pid}\\b`).test(c)) return true;
  if (/\bkill\s+(?:-\w+\s+)*%\d*/.test(c)) return true;
  return false;
}

/** 띄운 명령 결과에서 PID 힌트: `echo $!`(Git Bash MSYS PID — Windows pidAlive 로 못 봄) · PowerShell `-PassThru`/`.Id`(Windows PID) */
export function pidHintOf(command, stdout, tool = 'Bash') {
  const m = /^\s*(\d{2,7})\s*$/m.exec(String(stdout || ''));
  if (!m) return null;
  if (tool !== 'PowerShell' && /\$!/.test(command || '')) return { pid: Number(m[1]), kind: 'msys' };
  if (tool === 'PowerShell' && /-PassThru|\.Id\b/i.test(command || '')) return { pid: Number(m[1]), kind: 'win' };
  return null;
}
