// 같은 파일 충돌·세션 간 메시지 — 순수 규칙. three·DOM·node 내장 없음(서버 허브·웹 가짜 데이터·시험 공용).
//
// 세션(= live 메인 + 그 서브트리) 별로 최근 CONFLICT_WINDOW_MS(10분) 동안 파일 도구(Read·Edit·Write·MultiEdit·NotebookEdit·NotebookRead)가
// 건드린 경로(정규화 열쇠)를 모아, 서로 다른 세션 사이에 겹치는 파일을 충돌로 본다.
//   쓰기-쓰기 = strong(강), 읽기-쓰기 = weak(약), 읽기-읽기 = 충돌 아님.
//   셸 명령에서 추정한 쓰기(est)가 끼면 한 단계 낮춤: 쓰기-추정쓰기·추정쓰기-추정쓰기 = weak(est), 읽기-추정쓰기 = 없음.
//   한 쌍에 여러 조합이 되면 가장 센 것(strong > weak > weak est).
// 시각은 이벤트 ts(기록 시각)만 쓴다 → 실시간·재생이 같은 답. 창을 벗어나 겹침이 사라지면 'off'(화면은 CONFLICT_FADE_MS 30초 동안 흐려짐).

import { t as tr } from './i18n.mjs';

export const CONFLICT_WINDOW_MS = 10 * 60_000;
export const CONFLICT_FADE_MS = 30_000;
export const FILE_TOOL_MODE = { Read: 'r', NotebookRead: 'r', Edit: 'w', MultiEdit: 'w', Write: 'w', NotebookEdit: 'w' };

/** 경로 정규화 열쇠: 상대 경로는 cwd 기준, 구분자 '/', '.'·'..' 해소, 드라이브 문자 경로(Windows)는 소문자 */
export function fileKey(p, cwd = null) {
  if (!p || typeof p !== 'string') return null;
  let s = p.trim().replace(/^["']|["']$/g, '');
  if (!s) return null;
  s = s.replace(/\\/g, '/');
  const abs = /^[A-Za-z]:\//.test(s) || s.startsWith('/') || s.startsWith('~');
  if (!abs && cwd) s = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '') + '/' + s;
  const drive = /^([A-Za-z]):\//.exec(s);
  const head = drive ? drive[1].toLowerCase() + ':' : s.startsWith('/') ? '' : null;
  const rest = drive ? s.slice(3) : s.startsWith('/') ? s.slice(1) : s;
  const out = [];
  for (const seg of rest.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (out.length) out.pop(); continue; }
    out.push(seg);
  }
  let k = (head != null ? head + '/' : '') + out.join('/');
  if (drive) k = k.toLowerCase(); // Windows 파일 시스템은 대소문자 구분 없음
  return k || null;
}

/** 경로 → 짧은 이름(마지막 조각) */
export const baseOf = (k) => { const s = String(k || '').split('/').filter(Boolean); return s[s.length - 1] || ''; };
/** 경로 → 뒤 n 조각(툴팁) */
export const tailOf = (k, n = 3) => String(k || '').split('/').filter(Boolean).slice(-n).join('/');

/** tool_use(이름·입력) → 파일 참조 {k, n, w} | null. w = 1 이면 쓰기 */
export function fileRef(tool, input, cwd = null) {
  const mode = FILE_TOOL_MODE[tool];
  if (!mode || !input || typeof input !== 'object') return null;
  const p = input.file_path || input.notebook_path || input.path;
  const k = fileKey(p, cwd);
  if (!k) return null;
  return { k, n: baseOf(k), w: mode === 'w' ? 1 : 0 };
}

// ───────────── 셸 명령의 쓰기 대상 추정(약한 추정 est) ─────────────
// Bash·PowerShell 도구의 command 문자열에서 '고칠 것 같은' 파일 경로만 뽑는다. 명령을 실행하지 않고 글자만 본다.
// 잡는 것: sed -i·perl -i, tee, > / >> 리다이렉트, cp/mv 대상(mv 는 원본도), git checkout -- / git restore,
//   PowerShell Set-Content·Add-Content·Out-File·Tee-Object·Copy-Item·Move-Item·[IO.File]::Write…/Append…
// 버리는 것: 변수·명령 치환이 든 경로, 와일드카드, /dev/null·NUL·fd 복제(&1), 임시 경로, heredoc 본문(python - <<EOF 안의 쓰기 등).

export const SHELL_TARGET_MAX = 8;
export const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

const TEMP_RE = [/^\/(tmp|var\/tmp|private\/tmp)(\/|$)/i, /^\/dev\//i, /^\/proc\//i, /appdata\/local\/temp(\/|$)/i, /^[a-z]:\/windows\/temp(\/|$)/i];
const NULL_RE = /^(nul|con|prn|aux|nul:|\$null)$/i;

/** 쓰기 대상 후보로 쓸 수 있는 낱말인가 */
function okTarget(t) {
  if (!t || t.op || t.dyn) return false;
  const w = t.w;
  if (!w || w === '-' || w === '.' || w === '..' || w.startsWith('&') || w.startsWith('-')) return false;
  if (/[*?]/.test(w) || /%[A-Za-z_]\w*%/.test(w) || /:\/\//.test(w)) return false;
  if (/^[A-Za-z]:[^\\/]/.test(w)) return false; // 셸 이스케이프로 깨진 Windows 경로(D:foo)
  if (NULL_RE.test(w)) return false;
  const s = w.replace(/\\/g, '/');
  return !TEMP_RE.some((re) => re.test(s));
}
const isAbsPath = (w) => /^([A-Za-z]:[\\/]|[\\/]|~)/.test(w);
const joinW = (dir, w) => ({ w: String(dir.w).replace(/[\\/]+$/, '') + '/' + w, dyn: !!dir.dyn });
const baseW = (w) => String(w).replace(/[\\/]+$/, '').split(/[\\/]/).pop();

/** $… · `…` 치환을 건너뛴 위치 */
function skipSubst(s, i) {
  const n = s.length;
  if (s[i] === '`') { let j = i + 1; while (j < n && s[j] !== '`') j += s[j] === '\\' ? 2 : 1; return j + 1; }
  const c = s[i + 1];
  if (c === '(' || c === '{') {
    const open = c, close = c === '(' ? ')' : '}';
    let d = 0, j = i + 1;
    for (; j < n; j++) {
      const ch = s[j];
      if (ch === "'") { const e = s.indexOf("'", j + 1); j = e < 0 ? n : e; continue; }
      if (ch === '\\') { j++; continue; }
      if (ch === open) d++;
      else if (ch === close && --d === 0) return j + 1;
    }
    return n;
  }
  let j = i + 1;
  if (j < n && /[A-Za-z0-9_]/.test(s[j])) { while (j < n && /[A-Za-z0-9_:]/.test(s[j])) j++; return j; } // PowerShell $env:X 포함
  return j < n && /[@*#?$!\-_]/.test(s[j]) ? j + 1 : j;
}

/** 균형 괄호 끝 */
function skipParen(s, i) {
  let d = 0;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (ch === "'" || ch === '"') { const e = s.indexOf(ch, j + 1); j = e < 0 ? s.length : e; continue; }
    if (ch === '(') d++;
    else if (ch === ')' && --d === 0) return j + 1;
  }
  return s.length;
}

/** 명령 문자열 → 단순 명령(토큰 배열)들. 토큰 = {w, dyn, q} | {op}. ps = PowerShell 문법 */
export function lexShell(src, ps = false) {
  const segs = [];
  let seg = [], cur = null, wantDelim = false;
  const docs = [];
  const n = src.length;
  let i = 0;
  const W = () => (cur ||= { w: '', dyn: false, q: false });
  const flush = () => {
    if (!cur) return;
    if (wantDelim) { docs.push(cur.w); wantDelim = false; }
    seg.push(cur); cur = null;
  };
  const endSeg = () => { flush(); if (seg.length) segs.push(seg); seg = []; };
  const skipDocs = () => { // heredoc 본문 건너뜀
    for (const d of docs) {
      while (i < n) {
        let e = src.indexOf('\n', i); if (e < 0) e = n;
        const line = src.slice(i, e); i = e + 1;
        if (line.trim() === d) break;
      }
    }
    docs.length = 0;
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { endSeg(); i++; if (docs.length) skipDocs(); continue; }
    if (c === ' ' || c === '\t' || c === '\r') { flush(); i++; continue; }
    if (c === '#' && !cur) { while (i < n && src[i] !== '\n') i++; continue; }
    if (ps) {
      if (c === '<' && src[i + 1] === '#') { const e = src.indexOf('#>', i + 2); i = e < 0 ? n : e + 2; continue; }
      if (c === '@' && !cur && (src[i + 1] === "'" || src[i + 1] === '"') && /^[ \t]*\r?\n/.test(src.slice(i + 2, i + 40))) {
        const endTok = '\n' + src[i + 1] + '@';
        const e = src.indexOf(endTok, i + 2);
        W().dyn = true; cur.q = true; i = e < 0 ? n : e + 3; continue; // here-string 본문은 값일 뿐
      }
      if (c === '`') { if (src[i + 1] === '\n') { i += 2; continue; } W().w += src[i + 1] ?? ''; i += 2; continue; }
      if (c === "'") {
        W(); cur.q = true; i++;
        while (i < n) { if (src[i] === "'") { if (src[i + 1] === "'") { cur.w += "'"; i += 2; continue; } break; } cur.w += src[i++]; }
        i++; continue;
      }
      if (c === '"') {
        W(); cur.q = true; i++;
        while (i < n && src[i] !== '"') { if (src[i] === '`') { cur.w += src[i + 1] ?? ''; i += 2; continue; } if (src[i] === '$') cur.dyn = true; cur.w += src[i++]; }
        i++; continue;
      }
      if (c === '$') { W().dyn = true; i = src[i + 1] === '(' ? skipParen(src, i + 1) : skipSubst(src, i); continue; }
      if (c === '(') { W().dyn = true; i = skipParen(src, i); continue; }
      if (c === ';' || c === '{' || c === '}' || c === ')') { endSeg(); i++; continue; }
      if (c === '|') { endSeg(); i += src[i + 1] === '|' ? 2 : 1; continue; }
      if (c === '&' && src[i + 1] === '&') { endSeg(); i += 2; continue; }
      if (c === '>') {
        if (cur && !cur.q && /^(\d|\*)$/.test(cur.w)) cur = null; else flush();
        const app = src[i + 1] === '>';
        i += app ? 2 : 1;
        if (src[i] === '&' && /\d/.test(src[i + 1] || '')) { i += 2; continue; } // 2>&1
        seg.push({ op: app ? '>>' : '>' });
        continue;
      }
      W().w += c; i++;
      continue;
    }
    // ── Bash ──
    if (c === '\\') { if (src[i + 1] === '\n') { i += 2; continue; } W().w += src[i + 1] ?? ''; i += 2; continue; }
    if (c === "'") { const e = src.indexOf("'", i + 1); const end = e < 0 ? n : e; W().w += src.slice(i + 1, end); cur.q = true; i = end + 1; continue; }
    if (c === '"') {
      W(); cur.q = true; i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < n && '$`"\\\n'.includes(src[i + 1])) { cur.w += src[i + 1]; i += 2; continue; }
        if (src[i] === '$' || src[i] === '`') { cur.dyn = true; const j = skipSubst(src, i); cur.w += src.slice(i, j); i = j; continue; }
        cur.w += src[i++];
      }
      i++; continue;
    }
    if (c === '$' || c === '`') { W().dyn = true; i = skipSubst(src, i); continue; }
    if (c === ';' || c === '(' || c === ')') { endSeg(); i += c === ';' && src[i + 1] === ';' ? 2 : 1; continue; }
    if (c === '|') { endSeg(); i += src[i + 1] === '|' || src[i + 1] === '&' ? 2 : 1; continue; }
    if (c === '&') {
      if (src[i + 1] === '>') { flush(); const app = src[i + 2] === '>'; seg.push({ op: app ? '&>>' : '&>' }); i += app ? 3 : 2; continue; }
      endSeg(); i += src[i + 1] === '&' ? 2 : 1; continue;
    }
    if (c === '>' || c === '<') {
      if (src[i + 1] === '(') { flush(); W().dyn = true; i = skipParen(src, i + 1); continue; } // 프로세스 치환
      if (cur && !cur.q && /^\d+$/.test(cur.w)) cur = null; else flush();
      let op;
      if (c === '>') op = src.startsWith('>>', i) ? '>>' : src.startsWith('>&', i) ? '>&' : src.startsWith('>|', i) ? '>|' : '>';
      else op = src.startsWith('<<<', i) ? '<<<' : src.startsWith('<<-', i) ? '<<-' : src.startsWith('<<', i) ? '<<' : src.startsWith('<&', i) ? '<&' : src.startsWith('<>', i) ? '<>' : '<';
      i += op.length;
      seg.push({ op });
      if (op === '<<' || op === '<<-') wantDelim = true;
      continue;
    }
    W().w += c; i++;
  }
  endSeg();
  return segs;
}

const BASH_SKIP = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', '{', '}', 'time', 'nohup', 'command', 'builtin', 'exec', 'sudo', 'doas', 'env', 'nice', 'stdbuf']);
const BASH_WRAP_OPTS = new Set(['sudo', 'doas', 'env', 'nice', 'stdbuf']);

/** 한 단순 명령 → 쓰기 대상 낱말들. ctx.cd = 앞서 cd 한 곳(낱말) | null, ctx.lost = cd 위치를 모름 */
function segTargets(seg, ps, ctx) {
  const out = [];
  const args = [];
  for (let k = 0; k < seg.length; k++) {
    const t = seg[k];
    if (!t.op) { args.push(t); continue; }
    const nx = seg[k + 1] && !seg[k + 1].op ? seg[k + 1] : null;
    if (!nx) continue;
    k++;
    if (t.op === '>' || t.op === '>>' || t.op === '>|' || t.op === '&>' || t.op === '&>>' || (t.op === '>&' && !/^(\d+|-)$/.test(nx.w))) out.push(nx);
  }
  // 앞의 대입(FOO=1)·예약어·감싸는 명령 건너뜀
  let s = 0;
  while (s < args.length) {
    const w = args[s].w;
    if (!ps && !args[s].q && /^[A-Za-z_]\w*=/.test(w)) { s++; continue; }
    if (!ps && BASH_SKIP.has(w)) { s++; if (BASH_WRAP_OPTS.has(w)) while (s < args.length && /^-/.test(args[s].w)) s++; continue; }
    if (ps && (w === '&' || w === '.')) { s++; continue; }
    break;
  }
  const a = args.slice(s);
  if (!a.length || a[0].dyn) return out;
  const name = baseW(a[0].w).toLowerCase().replace(/\.exe$/, '');
  const rest = a.slice(1);
  const pos = () => rest.filter((x) => !/^-/.test(x.w) || x.q);

  if (ps) {
    const P = psParams(rest);
    const get = (...names) => { for (const [k, v] of P.named) if (v !== true && k.length >= 2 && names.some((nm) => nm.startsWith(k))) return v; return null; };
    const split = (t) => (t && !t.dyn ? t.w.split(',').map((w) => ({ w: w.trim(), dyn: false })).filter((x) => x.w) : t ? [t] : []);
    if (['set-content', 'sc', 'add-content', 'ac', 'out-file', 'tee-object', 'tee'].includes(name)) {
      out.push(...split(get('path', 'pspath', 'literalpath', 'lp', 'filepath') || P.pos[0]));
    } else if (['copy-item', 'cp', 'copy', 'cpi', 'move-item', 'mv', 'move', 'mi'].includes(name)) {
      const srcs = split(get('path', 'pspath', 'literalpath', 'lp') || P.pos[0]);
      const dst = get('destination') || P.pos[1];
      if (dst) out.push(...(/[\\/]$/.test(dst.w) ? srcs.map((x) => joinW(dst, baseW(x.w))) : [dst]));
      if (name.startsWith('m')) out.push(...srcs);
    } else if (['cd', 'set-location', 'sl', 'chdir', 'pushd', 'push-location'].includes(name)) {
      setCd(ctx, get('path', 'literalpath') || P.pos[0]);
    } else if (name === 'git') out.push(...gitTargets(rest));
    return out;
  }

  switch (name) {
    case 'cd': case 'pushd': setCd(ctx, pos()[0]); break;
    case 'sed': case 'gsed': {
      let inplace = false, script = false, end = false;
      const p = [];
      for (let j = 0; j < rest.length; j++) {
        const w = rest[j].w;
        if (end || !w.startsWith('-') || w === '-' || rest[j].q) { p.push(rest[j]); continue; }
        if (w === '--') { end = true; continue; }
        if (w.startsWith('--')) {
          if (/^--in-place(=|$)/.test(w)) inplace = true;
          else if (w === '--expression' || w === '--file') { script = true; j++; }
          else if (/^--(expression|file)=/.test(w)) script = true;
          else if (w === '--line-length') j++;
          continue;
        }
        for (let x = 1; x < w.length; x++) {
          const ch = w[x];
          if (ch === 'i') { inplace = true; if (x === w.length - 1 && rest[j + 1] && rest[j + 1].q && rest[j + 1].w === '') j++; break; } // BSD sed -i ''
          if (ch === 'e' || ch === 'f') { script = true; if (x === w.length - 1) j++; break; }
          if (ch === 'l') { if (x === w.length - 1) j++; break; }
        }
      }
      if (inplace) out.push(...(script ? p : p.slice(1)));
      break;
    }
    case 'perl': {
      let inplace = false, script = false, end = false;
      const p = [];
      for (let j = 0; j < rest.length; j++) {
        const w = rest[j].w;
        if (end || !w.startsWith('-') || w === '-' || rest[j].q) { p.push(rest[j]); continue; }
        if (w === '--') { end = true; continue; }
        for (let x = 1; x < w.length; x++) {
          const ch = w[x];
          if (ch === 'i') { inplace = true; break; } // 나머지는 백업 확장자
          if (ch === 'e' || ch === 'E') { script = true; if (x === w.length - 1) j++; break; }
          if (/[MmIlxCd0]/.test(ch)) break;
        }
      }
      if (inplace) out.push(...(script ? p : p.slice(1)));
      break;
    }
    case 'tee': out.push(...pos()); break;
    case 'cp': case 'mv': {
      let tdir = null, end = false;
      const p = [];
      for (let j = 0; j < rest.length; j++) {
        const w = rest[j].w;
        if (end || !w.startsWith('-') || rest[j].q) { p.push(rest[j]); continue; }
        if (w === '--') end = true;
        else if (w === '-t' || w === '--target-directory') tdir = rest[++j] || null;
        else if (w.startsWith('--target-directory=')) tdir = { w: w.slice(19), dyn: rest[j].dyn };
        else if (w === '-S' || w === '--suffix') j++;
      }
      let srcs = p, targets = [];
      if (tdir) targets = srcs.map((x) => joinW(tdir, baseW(x.w)));
      else if (p.length >= 2) {
        const dst = p[p.length - 1];
        srcs = p.slice(0, -1);
        targets = srcs.length > 1 || /[\\/]$/.test(dst.w) || dst.w === '.' || dst.w === '..' ? srcs.map((x) => joinW(dst, baseW(x.w))) : [dst];
      } else srcs = [];
      out.push(...targets);
      if (name === 'mv') out.push(...srcs);
      break;
    }
    case 'git': out.push(...gitTargets(rest)); break;
    default: break;
  }
  return out;
}

function setCd(ctx, t) {
  if (!t || t.dyn || !t.w || t.w === '-') { ctx.lost = true; return; }
  if (isAbsPath(t.w)) { ctx.cd = t; ctx.lost = false; }
  else if (ctx.cd) ctx.cd = joinW(ctx.cd, t.w);
  else ctx.cd = t;
}

/** git [-C dir] checkout … -- 경로… | git restore [옵션] 경로… */
function gitTargets(rest) {
  let j = 0, gdir = null;
  while (j < rest.length && /^-/.test(rest[j].w)) {
    const w = rest[j].w;
    if (w === '-C') { gdir = rest[j + 1] || null; j += 2; continue; }
    if (w === '-c' || w === '--git-dir' || w === '--work-tree' || w === '--namespace') { j += 2; continue; }
    j++;
  }
  const sub = rest[j] && rest[j].w;
  const r = rest.slice(j + 1);
  let files = [];
  if (sub === 'checkout') { const dd = r.findIndex((x) => x.w === '--' && !x.q); if (dd >= 0) files = r.slice(dd + 1); }
  else if (sub === 'restore') {
    let end = false;
    for (let k = 0; k < r.length; k++) {
      const w = r[k].w;
      if (!end && w === '--') { end = true; continue; }
      if (!end && w.startsWith('-') && !r[k].q) { if (w === '-s' || w === '--source') k++; continue; }
      files.push(r[k]);
    }
  }
  if (gdir) files = files.map((f) => (isAbsPath(f.w) ? f : { w: String(gdir.w).replace(/[\\/]+$/, '') + '/' + f.w, dyn: f.dyn || gdir.dyn }));
  return files;
}

const PS_SWITCH = ['force', 'append', 'nonewline', 'noclobber', 'passthru', 'whatif', 'confirm', 'asbytestream', 'recurse', 'container', 'debug', 'verbose'];
/** PowerShell 인자 → {named: Map(이름 앞부분 소문자 → 낱말 | true), pos: [낱말]} */
function psParams(rest) {
  const named = new Map(), pos = [];
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j];
    if ((!t.q && /^-[A-Za-z]/.test(t.w)) || /^-[A-Za-z][\w-]*:/.test(t.w)) { // -Path:"x" 는 따옴표가 뒤에
      const m = /^-([A-Za-z][\w-]*)(?::(.*))?$/s.exec(t.w);
      if (!m) { pos.push(t); continue; }
      const nm = m[1].toLowerCase();
      if (m[2] !== undefined) named.set(nm, m[2] ? { w: m[2], dyn: t.dyn } : rest[++j] || true);
      else if (PS_SWITCH.some((sw) => sw.startsWith(nm))) named.set(nm, true);
      else { named.set(nm, rest[j + 1] || true); j++; }
    } else pos.push(t);
  }
  return { named, pos };
}

/**
 * 셸 명령 → 쓰기 대상으로 보이는 경로 문자열들(앞서 cd 한 곳이 있으면 붙임, 중복 없음, 최대 max개).
 * shell = 도구 이름 'Bash' | 'PowerShell'
 */
export function shellWriteTargets(command, shell = 'Bash', max = SHELL_TARGET_MAX) {
  if (typeof command !== 'string' || !command.trim()) return [];
  const ps = /^(powershell|ps|pwsh)$/i.test(String(shell));
  const src = command.length > 20000 ? command.slice(0, 20000) : command;
  const out = [];
  const seen = new Set();
  const ctx = { cd: null, lost: false };
  const add = (t) => {
    if (out.length >= max || !okTarget(t)) return;
    let w = t.w;
    if (!isAbsPath(w)) { if (ctx.lost) return; if (ctx.cd) { if (ctx.cd.dyn) return; w = String(ctx.cd.w).replace(/[\\/]+$/, '') + '/' + w; } }
    if (!okTarget({ w })) return;
    if (!seen.has(w)) { seen.add(w); out.push(w); }
  };
  if (ps) { // [IO.File]::WriteAllText('경로', …) 류
    const re = /\[(?:System\.)?IO\.File\]::(?:WriteAll(?:Text|Lines|Bytes)|AppendAll(?:Text|Lines))\(\s*(['"])([^'"]+)\1/gi;
    for (let m; (m = re.exec(src));) add({ w: m[2], dyn: m[1] === '"' && /[$`]/.test(m[2]) });
  }
  for (const seg of lexShell(src, ps)) {
    for (const t of segTargets(seg, ps, ctx)) add(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Bash·PowerShell tool_use → 추정 쓰기 참조들 [{k, n, w:1, est:1}] (cwd 기준 fileKey, Windows cwd 의 Bash 면 /d/… → d:/…) */
export function shellFileRefs(tool, input, cwd = null, max = SHELL_TARGET_MAX) {
  if (!SHELL_TOOLS.has(tool) || !input || typeof input.command !== 'string') return [];
  const win = /^[A-Za-z]:[\\/]/.test(String(cwd || ''));
  const refs = [], seen = new Set();
  for (let p of shellWriteTargets(input.command, tool, max)) {
    if (win && tool === 'Bash') p = p.replace(/^\/([A-Za-z])(\/|$)/, (_, d) => `${d}:/`);
    const k = fileKey(p, cwd);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    refs.push({ k, n: baseOf(k), w: 1, est: 1 });
  }
  return refs;
}

/** 도구 → 파일 참조 목록: 파일 도구면 [fileRef], 셸이면 추정 쓰기들, 아니면 [] */
export function toolFileRefs(tool, input, cwd = null) {
  const r = fileRef(tool, input, cwd);
  return r ? [r] : shellFileRefs(tool, input, cwd);
}

/** SendMessage 입력 → 대상 문자열(에이전트 id·이름·세션 id). 없으면 null */
export function msgTo(tool, input) {
  if (tool !== 'SendMessage' || !input || typeof input !== 'object') return null;
  const t = input.to ?? input.recipient ?? input.agent_id ?? input.target;
  return typeof t === 'string' && t.trim() ? t.trim().slice(0, 80) : null;
}

/** 대상 문자열 → 노드 id 후보(앞이 우선): a:<id>, s:<id>, 그대로, 그리고 이름 일치 */
export function msgTargetNode(to, byId) {
  if (!to) return null;
  for (const id of [`a:${to}`, `s:${to}`, to]) if (byId.has(id)) return id;
  const low = to.toLowerCase();
  for (const n of byId.values()) {
    const m = n.meta || {};
    if ((m.name && String(m.name).toLowerCase() === low) || (m.agentName && String(m.agentName).toLowerCase() === low)) return n.id;
    if (n.sessionId && n.sessionId.startsWith(to) && to.length >= 8 && n.kind === 'main') return n.id;
  }
  return null;
}

/**
 * 두 그룹 접촉({r, w, we}: 창 안 시각 또는 -Infinity/없음) → {level, est} | null. w = 확정 쓰기, we = 셸 추정 쓰기.
 * 쓰기-쓰기 strong · 쓰기-읽기 weak · 쓰기-추정쓰기 / 추정-추정 weak est · 읽기-추정쓰기·읽기-읽기 없음(센 조합 우선)
 */
export function pairLevel(A, B) {
  const has = (v) => v != null && v > -Infinity;
  const w1 = has(A.w), w2 = has(B.w), e1 = has(A.we), e2 = has(B.we), r1 = has(A.r), r2 = has(B.r);
  if (w1 && w2) return { level: 'strong', est: false };
  if ((w1 && r2) || (w2 && r1)) return { level: 'weak', est: false };
  if ((w1 && e2) || (w2 && e1) || (e1 && e2)) return { level: 'weak', est: true };
  return null;
}

const pairId = (a, b, k) => (a < b ? `${a}|${b}|${k}` : `${b}|${a}|${k}`);

/**
 * 세션 간 같은 파일 추적기. group = 세션(live 메인 노드 id 등 아무 문자열).
 *  touch(group, ref, tsMs, nodeId) → 이 접촉으로 바뀐 충돌({on:[…]})
 *  evaluate(nowMs) → {on:[새로 생기거나 강약이 바뀐 충돌], off:[사라진 충돌]}
 *  list() → 지금 충돌들
 * 충돌 = {id, a, b, k, n, level:'strong'|'weak', est, nodeA, nodeB, wA, wB, since, last}
 *   ref.est = 1 이면 추정 쓰기(셸 명령) — e.we 에 따로 둔다. wA·wB = 그 쪽이 (추정 포함) 썼으면 1, est = 추정 쓰기 때문에 생긴 충돌
 */
export class ConflictTracker {
  constructor({ windowMs = CONFLICT_WINDOW_MS } = {}) {
    this.windowMs = windowMs;
    this.files = new Map();   // k → Map(group → {r, w, node, n})
    this.active = new Map();  // id → conflict
    this.now = 0;             // 본 가장 늦은 시각(재생 시계)
  }

  touch(group, ref, tsMs, nodeId = null) {
    if (!group || !ref || !ref.k || !Number.isFinite(tsMs)) return { on: [], off: [] };
    let m = this.files.get(ref.k);
    if (!m) { m = new Map(); this.files.set(ref.k, m); }
    let e = m.get(group);
    if (!e) { e = { r: -Infinity, w: -Infinity, we: -Infinity, node: null, n: ref.n }; m.set(group, e); }
    if (ref.w && ref.est) e.we = Math.max(e.we, tsMs);
    else if (ref.w) e.w = Math.max(e.w, tsMs); else e.r = Math.max(e.r, tsMs);
    e.node = nodeId || e.node;
    if (ref.n) e.n = ref.n;
    if (tsMs > this.now) this.now = tsMs;
    return this._evalKey(ref.k, Math.max(this.now, tsMs));
  }

  /** 그룹이 사라짐(세션이 live 에서 빠짐): 그 그룹 접촉을 지우고 충돌을 끈다 */
  dropGroup(group, nowMs = this.now) {
    const off = [];
    for (const [k, m] of this.files) if (m.delete(group)) { const r = this._evalKey(k, nowMs); off.push(...r.off); if (!m.size) this.files.delete(k); }
    return { on: [], off };
  }

  _evalKey(k, nowMs) {
    const on = [], off = [];
    const m = this.files.get(k);
    const lo = nowMs - this.windowMs;
    const live = [];
    if (m) for (const [g, e] of m) {
      const r = e.r >= lo ? e.r : -Infinity, w = e.w >= lo ? e.w : -Infinity, we = e.we >= lo ? e.we : -Infinity;
      if (r === -Infinity && w === -Infinity && we === -Infinity) { m.delete(g); continue; }
      live.push({ g, r, w, we, e });
    }
    if (m && !m.size) this.files.delete(k);
    const want = new Map();
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const A = live[i], B = live[j];
      const lv = pairLevel(A, B);
      if (!lv) continue;
      const [x, y] = A.g < B.g ? [A, B] : [B, A];
      const id = pairId(A.g, B.g, k);
      const wrote = (z) => (z.w > -Infinity || z.we > -Infinity ? 1 : 0);
      want.set(id, { id, a: x.g, b: y.g, k, n: x.e.n || y.e.n || baseOf(k), level: lv.level, est: lv.est, nodeA: x.e.node, nodeB: y.e.node,
        wA: wrote(x), wB: wrote(y), last: Math.max(x.r, x.w, x.we, y.r, y.w, y.we) });
    }
    for (const [id, c] of want) {
      const old = this.active.get(id);
      if (!old) { c.since = c.last; this.active.set(id, c); on.push(c); }
      else {
        const changed = old.level !== c.level || old.est !== c.est || old.nodeA !== c.nodeA || old.nodeB !== c.nodeB;
        c.since = old.since;
        this.active.set(id, c);
        if (changed) on.push(c);
      }
    }
    for (const [id, c] of [...this.active]) if (c.k === k && !want.has(id)) { this.active.delete(id); off.push(c); }
    return { on, off };
  }

  /** 시간이 흘러 창을 벗어난 접촉 정리 */
  evaluate(nowMs = this.now) {
    if (nowMs > this.now) this.now = nowMs;
    const on = [], off = [];
    for (const k of [...this.files.keys()]) { const r = this._evalKey(k, nowMs); on.push(...r.on); off.push(...r.off); }
    return { on, off };
  }

  list() { return [...this.active.values()]; }
  clear() { this.files.clear(); this.active.clear(); this.now = 0; }
}

/** 충돌 → 이벤트('conflict'). mainOf(group) → 메인 노드 id */
export function conflictEvent(c, state, tsIso, mainOf = (g) => g) {
  return { ts: tsIso, type: 'conflict', nodeId: mainOf(c.a), peer: mainOf(c.b), state, id: c.id.length > 160 ? c.id.slice(0, 160) : c.id,
    file: c.n, path: tailOf(c.k, 3), level: c.level, ...(c.est ? { est: true } : {}), nodeA: c.nodeA || null, nodeB: c.nodeB || null, wA: c.wA, wB: c.wB };
}

/**
 * 웹 쪽 충돌 상태(화면 공용): conflict 이벤트를 받아 지금 보일 것과 흐려지는 것(off 뒤 30초)을 든다.
 *  apply(ev, wallMs) · items(wallMs) → [{id, a, b, file, path, level, nodeA, nodeB, k(0～1 불투명), fading}]
 */
export class ConflictBook {
  constructor({ fadeMs = CONFLICT_FADE_MS } = {}) { this.fadeMs = fadeMs; this.m = new Map(); }
  apply(ev, wallMs = Date.now()) {
    if (!ev || ev.type !== 'conflict' || !ev.id) return;
    if (ev.state === 'off') { const c = this.m.get(ev.id); if (c && !c.offAt) c.offAt = wallMs; return; }
    const c = this.m.get(ev.id) || { id: ev.id, at: wallMs };
    Object.assign(c, { a: ev.nodeId, b: ev.peer, file: ev.file || '', path: ev.path || '', level: ev.level === 'strong' ? 'strong' : 'weak', est: !!ev.est, nodeA: ev.nodeA || null, nodeB: ev.nodeB || null, offAt: null });
    this.m.set(ev.id, c);
  }
  /** 스냅샷의 conflicts(지금 켜진 것) 로 다시 채움 */
  reset(list = [], wallMs = Date.now()) { this.m.clear(); for (const ev of list) this.apply({ ...ev, type: 'conflict', state: 'on' }, wallMs); }
  items(wallMs = Date.now()) {
    const out = [];
    for (const [id, c] of this.m) {
      let k = 1;
      if (c.offAt) { k = 1 - (wallMs - c.offAt) / this.fadeMs; if (k <= 0) { this.m.delete(id); continue; } }
      out.push({ ...c, k, fading: !!c.offAt });
    }
    return out;
  }
  get size() { return this.m.size; }
}

/**
 * 화면용 묶음: 같은 두 메인 사이 충돌을 곡선 하나로. level = 하나라도 강이면 강, files = 강 먼저·이름순,
 * k = 가장 진한 것, fading = 모두 흐려지는 중일 때만. 추정(est) 충돌의 파일 이름엔 ' (추정)'(칩·캐비닛 말풍선 글 그대로),
 * est = 묶음의 충돌이 모두 추정일 때만 true.
 * @returns [{id, a, b, level, est, files:[이름…], paths:[…], k, fading, nodeA, nodeB}]
 */
export function conflictPairs(items) {
  const m = new Map();
  for (const it of items || []) {
    if (!it || !it.a || !it.b || it.a === it.b) continue;
    const [a, b] = it.a < it.b ? [it.a, it.b] : [it.b, it.a];
    const id = a + '|' + b;
    let p = m.get(id);
    if (!p) { p = { id, a, b, level: 'weak', est: true, list: [], k: 0, fading: true, nodeA: null, nodeB: null }; m.set(id, p); }
    if (it.level === 'strong') p.level = 'strong';
    if (!it.est) p.est = false;
    p.list.push(it);
    p.k = Math.max(p.k, it.k ?? 1);
    if (!it.fading) p.fading = false;
    if (!p.nodeA && it.nodeA) { p.nodeA = it.a === a ? it.nodeA : it.nodeB; p.nodeB = it.a === a ? it.nodeB : it.nodeA; }
  }
  const out = [];
  for (const p of m.values()) {
    p.list.sort((x, y) => ((y.level === 'strong') - (x.level === 'strong')) || ((x.est ? 1 : 0) - (y.est ? 1 : 0)) || ((x.fading ? 1 : 0) - (y.fading ? 1 : 0)) || String(x.file).localeCompare(String(y.file)));
    p.files = [...new Set(p.list.map((x) => (x.file || '?') + (x.est ? estMark() : '')))];
    p.paths = [...new Set(p.list.map((x) => x.path || x.file || '?'))];
    delete p.list;
    out.push(p);
  }
  return out.sort((x, y) => (x.id < y.id ? -1 : 1));
}

/** 추정 충돌 파일 이름 꼬리 ' (추정)'(지금 언어) */
export const estMark = () => tr('sound.conflict.est');
export const EST_MARK = estMark(); // 불러올 때 언어
/** 묶음 칩 글: 첫 파일 + '외 n' */
export const pairChipText = (p) => (p.files.length > 1 ? tr('sound.conflict.more', { file: p.files[0], n: p.files.length - 1 }) : p.files[0] || '?');

/** 세션 간 메시지 이벤트('session-msg') */
export function sessionMsgEvent({ ts, fromMain, toMain, fromNode, toNode, text }) {
  return { ts, type: 'session-msg', nodeId: fromMain, peer: toMain, fromNode: fromNode || fromMain, toNode: toNode || toMain, text: String(text || '').slice(0, 120) };
}
