// 홀로그램 패널 내용(실제 출력 몇 줄)
//   tool-start.panel : 입력으로 만든 내용(명령·경로·diff·패턴·URL·프롬프트 첫 줄)
//   tool-end.panel   : 결과까지 넣은 내용(명령 + 출력 마지막 줄들, 읽은 앞 몇 줄, diff, 결과 몇 줄 …) — 패널 전체 교체
//   output.panel     : 백그라운드 bash·Monitor 출력 꼬리(ref = 그 작업을 띄운 도구 호출)
//   text.panel       : 노드의 최근 말 몇 줄(mode 'say')
//   *.parentPanel    : 서브에이전트 이벤트에 붙는, 부모의 Agent 도구 패널 진행 갱신(ref 필수, 250ms 솎음)
// 여기 빌더는 원문 줄만 만든다. ANSI·제어 문자 제거, redact + 추가 마스킹, 줄·패널 상한, minimal 은 sanitizePanel 이
// graph.emit 안에서 한 곳에서 적용한다(모든 경로 공통).
import os from 'node:os';
import { redact } from './redact.mjs';
import { shortPath, firstCommandLine } from './brief.mjs';

export const PANEL_LIMITS = { line: 100, lines: 12, bytes: 1536, title: 100, say: 8 };

// ───────────── 정리·마스킹 ─────────────

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
// 제어 문자·폭 없는 문자·줄 구분 문자(U+2028/2029)·BOM
const CTRL = new RegExp('[\x00-\x08\x0b-\x1f\x7f\u200b-\u200f\u2028\u2029\ufeff]', 'g');
/** ANSI·제어 문자 제거(탭은 공백 2칸, \r 덮어쓰기는 마지막 조각만) */
export function stripAnsi(s) {
  return String(s ?? '')
    .replace(ANSI, '')
    .split('\n').map((l) => { const p = l.split('\r'); return p.length > 1 ? (p.filter((x) => x).pop() || '') : l; }).join('\n')
    .replace(/\t/g, '  ')
    .replace(CTRL, '');
}

/** 사람이 읽을 수 없는 줄(바이너리·깨진 인코딩) */
function looksBinary(l) {
  if (!l) return false;
  const bad = [...l].filter((c) => { const k = c.charCodeAt(0); return k === 0xfffd || (k >= 0x80 && k <= 0x9f); }).length; // 대체 문자·C1 제어 문자
  return bad >= 3 && bad / l.length > 0.1;
}

// 비밀이 들어 있을 수 있는 경로: 이 경로를 읽거나·편집하거나·명령에 쓰면 내용 줄을 싣지 않는다(제목만)
const SECRET_PATH = /(?:^|[\\/\s"'=:])(?:\.?secrets?|\.ssh|\.aws|\.gnupg|\.azure|\.kube|\.docker|keyring|vault)(?:[\\/]|["'\s]|$)|(?:^|[\\/\s"'=])(?:\.env(?:\.[\w.-]+)?|\.npmrc|\.netrc|\.pypirc|\.pgpass|\.git-credentials|\.credentials\.json|credentials(?:\.\w+)?|id_(?:rsa|dsa|ecdsa|ed25519)\w*|[\w.-]*(?:token|secret|password|passwd|apikey|api[_-]key)[\w.-]*\.(?:json|txt|ya?ml|env|ini|toml|cfg|conf)|cookies?(?:\.\w+)?)(?=$|[\s"'\\/;|&)])|\.(?:pem|key|p12|pfx|jks|keystore|kdbx|ppk|asc)(?=$|[\s"';|&)])/i;
export function isSecretPath(s) { return typeof s === 'string' && SECRET_PATH.test(s); }

const HOME = (() => { try { return os.homedir(); } catch { return ''; } })();
const HOME_RES = HOME ? [HOME, HOME.replace(/\\/g, '/'), HOME.replace(/^([A-Za-z]):\\/, (m, d) => `/${d.toLowerCase()}/`).replace(/\\/g, '/')]
  .filter((x, i, a) => x && a.indexOf(x) === i)
  .map((h) => new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) : [];
const USERNAME = HOME ? HOME.split(/[\\/]/).filter(Boolean).pop() : '';

// redact 위에 더하는 규칙: 패널은 원문 여러 줄이라 더 엄격하게
// 비밀 낱말(대소문자 무시). 'auth'·'sid'·'pass' 홑낱말은 author·inside·passed 같은 평범한 이름까지 가려서 빼고, 대문자 환경 변수 규칙(ENV_KW)에서만 쓴다
const KEYWORDS = String.raw`(?:password|passwd|passphrase|pwd|secret|token|api[_-]?key|apikey|credential|session[_-]?(?:id|key|token)|sessid|csrf|xsrf|cookie|private[_-]?key|access[_-]?key|client[_-]?secret|signature|authorization|auth[_-]?(?:token|key))`;
const ENV_KW = String.raw`(?:PASS(?:WORD|WD)?|PWD|SECRET|TOKEN|API_?KEY|APIKEY|AUTH|CREDENTIALS?|SESSION|SID|COOKIE|PRIVATE_?KEY|ACCESS_?KEY|SIGNATURE)`;
const EXTRA = [
  // Authorization: Basic xxx / Bearer xxx / Token xxx — 체계 이름 뒤 값까지
  [/((?:proxy-)?authori[sz]ation["']?\s*[:=]\s*["']?)(?:(?:Basic|Bearer|Token|Digest|Negotiate|NTLM|AWS4-HMAC-SHA256)\s+)?[^\s"',;]+(?:\s+[^\s"',;]+)?/gi, '$1***'],
  // Cookie / Set-Cookie 헤더는 줄 끝(또는 따옴표)까지 통째로
  [/((?:set-)?cookie["']?\s*[:=]\s*)[^\n"']+/gi, '$1***'],
  // curl -b/--cookie, -u user:pass, -H 'X-Api-Key: v'
  [/((?:^|\s)(?:-b|--cookie)\s+)(["']?)[^\s"']+\2/gi, '$1$2***$2'],
  [/((?:^|\s)(?:-u|--user)\s+["']?[^\s:"']+:)[^\s"']+/gi, '$1***'],
  [new RegExp(String.raw`(\bx-[\w-]*${KEYWORDS}[\w-]*["']?\s*:\s*)[^\s"',;]+`, 'gi'), '$1***'],
  // --password value / --token=value / -p:value (공백으로 띄운 값 포함)
  [new RegExp(String.raw`((?:^|\s)--?[\w-]*${KEYWORDS}[\w-]*(?:\s+|=))(["']?)(?!-)[^\s"']+\2`, 'gi'), '$1$2***$2'],
  // 환경 변수 꼴 NAME=값 / $env:NAME = '값' / set NAME=값 (대문자 이름에 비밀 낱말) + 소문자 비밀 이름
  [new RegExp(String.raw`(\b[A-Z0-9_]*${ENV_KW}[A-Z0-9_]*\s*=\s*)(["']?)[^\s"']+\2`, 'g'), '$1$2***$2'],
  [new RegExp(String.raw`(\b[A-Za-z0-9_]*${KEYWORDS}[A-Za-z0-9_]*\s*=\s*)(["']?)[^\s"']+\2`, 'gi'), '$1$2***$2'],
  // JSON·YAML 키에 비밀 낱말: "sessionToken": "…" / refresh_token: …
  [new RegExp(String.raw`(["']?[\w.-]*${KEYWORDS}[\w.-]*["']?\s*:\s*)(["'])[^"'\n]{1,400}\2`, 'gi'), '$1$2***$2'],
  [new RegExp(String.raw`(^\s*[\w.-]*${KEYWORDS}[\w.-]*\s*:\s+)(?!["'{\[])\S.*$`, 'gim'), '$1***'],
  // 이메일은 도메인까지 가림(redact 가 남긴 ***@domain, 원문에서 이미 잘린 `id@snu.a…` 꼴 포함)
  [/(?:\*\*\*|\b[A-Za-z0-9._%+-]+)@[A-Za-z0-9-]+(?:\.[A-Za-z0-9.-]*|(?=…|\.\.\.))/g, '***@***'],
  // Gmail 앱 비밀번호 꼴(소문자 4×4)
  [/\b[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}\b/g, '**** **** **** ****'],
  // IPv4 주소 뒤 :포트@ 이미 처리, 사설 키 지문류(32자 이상 hex)
  [/\b[0-9a-f]{32,}\b/gi, '***'],
];
// 32자 이상 대·소문자·숫자 섞인 토막(redact 는 40자부터)
const MID_RUN = /[A-Za-z0-9_\-+/]{32,}={0,2}/g;
function midSecret(run) {
  const core = run.replace(/=+$/, '');
  if (core.includes('/') || (core.match(/-/g) || []).length >= 3) return false;
  const u = /[A-Z]/.test(core), l = /[a-z]/.test(core), d = /[0-9]/.test(core);
  return u && l && d;
}

/** 패널 원문(여러 줄) 마스킹: redact → 추가 규칙 → 홈 경로 ~ */
export function maskPanelText(s) {
  let t = redact(String(s ?? ''));
  for (const [re, rep] of EXTRA) t = t.replace(re, rep);
  t = t.replace(MID_RUN, (m) => (midSecret(m) ? '***' : m));
  for (const re of HOME_RES) t = t.replace(re, '~');
  if (USERNAME && USERNAME.length >= 3) t = t.replace(new RegExp(String.raw`([\\/])Users([\\/])${USERNAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\/]|$)`, 'gi'), '$1Users$2~');
  return t;
}

const cutLine = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
const byteLen = (s) => Buffer.byteLength(s, 'utf8');

/**
 * 패널 정리(graph.emit 이 부름). privacy 'minimal' 이면 null(필드 삭제).
 * 줄 단위로만 자른다(글자 중간을 자르는 것은 줄당 100자 상한뿐).
 */
export function sanitizePanel(p, privacy = 'summary') {
  if (!p || typeof p !== 'object' || privacy === 'minimal') return null;
  const L = PANEL_LIMITS;
  const out = { v: 1, mode: p.mode || 'generic', part: p.part || 'input' };
  if (p.ref && p.ref.nodeId) out.ref = { nodeId: p.ref.nodeId, toolUseId: p.ref.toolUseId ?? null };
  out.title = p.title ? cutLine(maskPanelText(stripAnsi(p.title)).replace(/\s+/g, ' ').trim(), L.title) : '';
  const srcLines = Array.isArray(p.lines) ? p.lines : [];
  const srcMarks = typeof p.marks === 'string' ? p.marks : '';
  // 여러 줄 비밀(PEM 등)이 걸리도록 합쳐서 마스킹한다. 줄 수가 달라지면(여러 줄이 한 줄로 가려짐) 줄마다 따로 마스킹
  const src = srcLines.map((l) => stripAnsi(String(l ?? '').replace(/\r?\n/g, ' ')));
  let maskedLines = maskPanelText(src.join('\n')).split('\n');
  if (maskedLines.length !== src.length) maskedLines = src.map((l) => maskPanelText(l));
  let lines = [], marks = '';
  maskedLines.forEach((raw, i) => {
    let txt = raw.replace(/\s+$/, '');
    if (looksBinary(txt)) txt = '[바이너리 줄 생략]';
    lines.push(cutLine(txt, L.line));
    marks += /^[$oe+\-@dh]$/.test(srcMarks[i] || '') ? srcMarks[i] : 'o';
  });
  if (!src.length) { lines = []; marks = ''; }
  let more = Number(p.more) || 0;
  if (lines.length > L.lines) {
    const keepTail = p.part === 'tail' || p.keep === 'tail';
    const drop = lines.length - L.lines;
    more += drop;
    if (keepTail) { lines = lines.slice(drop); marks = marks.slice(drop); } else { lines = lines.slice(0, L.lines); marks = marks.slice(0, L.lines); }
  }
  // 바이트 상한: 제목 + 줄들. 넘치면 줄 단위로 덜어 낸다(꼬리 패널은 앞에서, 나머지는 뒤에서)
  let total = byteLen(out.title) + lines.reduce((a, l) => a + byteLen(l) + 1, 0);
  while (total > L.bytes && lines.length) {
    const tailKeep = p.part === 'tail' || p.keep === 'tail';
    const l = tailKeep ? lines.shift() : lines.pop();
    marks = tailKeep ? marks.slice(1) : marks.slice(0, -1);
    total -= byteLen(l) + 1;
    more++;
  }
  out.lines = lines;
  out.marks = marks;
  if (more > 0) out.more = more;
  if (p.hidden) out.hidden = p.hidden;
  return out;
}

// ───────────── 빌더 ─────────────

const splitLines = (s) => {
  const a = String(s ?? '').replace(/\r\n?/g, '\n').split('\n');
  while (a.length && !a[a.length - 1].trim()) a.pop();
  return a;
};
const head = (arr, n) => arr.slice(0, n);
const tail = (arr, n) => arr.slice(Math.max(0, arr.length - n));
const firstNonEmpty = (s) => splitLines(s).find((l) => l.trim()) || '';

/** 절대 경로를 마지막 세 조각으로 */
const sp = (p) => (p ? shortPath(String(p), 3) : '');
/** 결과 줄 맨 앞의 절대 경로를 짧게(Grep·Glob 결과) */
function shortenLeadPath(l) {
  return String(l).replace(/^((?:[A-Za-z]:)?[\\/][^:*?"<>|\n]+?)(?=(:\d+[:-])|$)/, (m) => {
    const seg = m.split(/[\\/]+/).filter(Boolean);
    return seg.length > 3 ? '…/' + seg.slice(-3).join('/') : m;
  });
}

function inputPaths(input) {
  return [input.file_path, input.notebook_path, input.path, input.command, input.pattern, input.glob, input.url, input.script_path, input.args]
    .filter((x) => typeof x === 'string');
}
/** 이 호출이 비밀 경로를 건드리는가 */
export function touchesSecret(input) {
  input = input && typeof input === 'object' ? input : {};
  return inputPaths(input).some(isSecretPath) || (typeof input.command === 'string' && SECRET_CMD.test(input.command));
}
// 비밀값을 그대로 찍는 명령: 출력 줄을 싣지 않는다
const SECRET_CMD = /(?:^|[\s;&|(])(?:printenv\b|env\s*(?:$|[|;&>])|set\s*(?:$|[|;&>])|(?:Get-ChildItem|gci|ls|dir)\s+env:|Get-Item\s+env:|\$env:[A-Za-z_]*(?:KEY|TOKEN|SECRET|PASS|AUTH|CRED)|security\s+find-(?:generic|internet)-password|cmdkey\b|keyring\s+get|gh\s+auth\s+(?:token|status\s+--show-token)|git\s+credential|aws\s+(?:configure\s+(?:get|export)|sts\s+get-session-token)|gcloud\s+auth\s+print-(?:access|identity)-token|op\s+(?:read|item\s+get)|az\s+account\s+get-access-token|(?:wrangler|cf)\s+[\w\s-]*(?:secret|token)|Get-StoredCredential|ConvertFrom-SecureString|vault\s+(?:read|kv\s+get))/i;

function lineCountOf(s) { return typeof s === 'string' && s.length ? splitLines(s).length : 0; }

/** old/new 문자열 → diff 줄(바뀐 줄만, 앞뒤 공통 줄 버림) */
function diffFromStrings(oldS, newS, budget = PANEL_LIMITS.lines) {
  const a = splitLines(oldS), b = splitLines(newS);
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const del = a.slice(s, ea), add = b.slice(s, eb);
  const nd = Math.min(del.length, Math.max(Math.floor(budget / 2), budget - add.length));
  const na = Math.min(add.length, budget - nd);
  const lines = [...head(del, nd), ...head(add, na)];
  const marks = '-'.repeat(Math.min(nd, del.length)) + '+'.repeat(na);
  return { lines, marks, more: del.length - nd + add.length - na };
}

/** structuredPatch → diff 줄(@@ 머리 + 바뀐 줄 + 바뀐 줄 바로 앞 문맥 한 줄) */
function diffFromPatch(sp_, budget = PANEL_LIMITS.lines) {
  const lines = [], marks = [];
  let more = 0;
  for (const h of sp_) {
    if (!h || !Array.isArray(h.lines)) continue;
    const rows = [];
    rows.push(['@', `@@ -${h.oldStart ?? '?'},${h.oldLines ?? '?'} +${h.newStart ?? '?'},${h.newLines ?? '?'} @@`]);
    for (let i = 0; i < h.lines.length; i++) {
      const l = String(h.lines[i] ?? '');
      const c = l[0];
      if (c === '+' || c === '-') rows.push([c, l.slice(1)]);
      else if (h.lines[i + 1] && /^[+-]/.test(h.lines[i + 1]) && (i === 0 || !/^[+-]/.test(h.lines[i - 1] || ''))) rows.push(['d', l.slice(1)]);
    }
    for (const [m, t] of rows) { if (lines.length < budget) { lines.push(t); marks.push(m); } else more++; }
  }
  return { lines, marks: marks.join(''), more };
}

/** tool_use 입력 → 패널(입력 단계). 줄은 300자로 미리 자른다(보관 메모리 보호, 최종 100자는 sanitizePanel) */
export function inputPanel(name, input) {
  const p = inputPanel0(name, input);
  if (Array.isArray(p.lines)) p.lines = p.lines.map((l) => { l = String(l ?? ''); return l.length > 300 ? l.slice(0, 300) : l; });
  if (typeof p.title === 'string' && p.title.length > 300) p.title = p.title.slice(0, 300);
  if (touchesSecret(input)) p.secret = true;
  return p;
}
function inputPanel0(name, input) {
  input = input && typeof input === 'object' ? input : {};
  const secret = touchesSecret(input);
  const P = (mode, title, lines = [], marks = '', extra = {}) => ({ mode, part: 'input', title, lines, marks, ...extra, ...(secret && lines.length ? { lines: [], marks: '', hidden: 'secret' } : {}) });
  if (name && name.startsWith('mcp__')) {
    const [, server, ...rest] = name.split('__');
    return P('generic', `${server}.${rest.join('__')}`, ...kvLines(input));
  }
  switch (name) {
    case 'Bash': case 'PowerShell': case 'Monitor': {
      const sh = name === 'Monitor' ? 'monitor' : 'shell';
      const cmd = splitLines(input.command).filter((l) => l.trim() && !/^\s*#/.test(l));
      const title = '$ ' + (firstCommandLine(input.command) || '').replace(/ …$/, '');
      const rest = cmd.length > 1 ? head(cmd.slice(1), 3) : [];
      const lines = [...(input.description ? [input.description] : []), ...rest.map((l) => '  ' + l.trim())];
      const marks = (input.description ? 'd' : '') + '$'.repeat(rest.length);
      return { mode: sh, part: 'input', title, lines, marks, ...(cmd.length > 4 ? { more: cmd.length - 4 } : {}) };
    }
    case 'Read': case 'NotebookRead': {
      const r = input.offset || input.limit ? `${input.offset || 1}줄부터${input.limit ? ` ${input.limit}줄` : ''}` : input.pages ? `${input.pages}쪽` : '';
      return P('read', sp(input.file_path || input.notebook_path || input.path), r ? [r] : [], r ? 'd' : '');
    }
    case 'Edit': {
      const d = diffFromStrings(input.old_string, input.new_string);
      return P('diff', sp(input.file_path) + (input.replace_all ? ' (전체)' : ''), d.lines, d.marks, d.more ? { more: d.more } : {});
    }
    case 'MultiEdit': {
      const lines = [], marks = [];
      let more = 0;
      for (const e of Array.isArray(input.edits) ? input.edits : []) {
        const d = diffFromStrings(e && e.old_string, e && e.new_string, Math.max(0, PANEL_LIMITS.lines - lines.length));
        lines.push(...d.lines); marks.push(d.marks); more += d.more;
      }
      return P('diff', sp(input.file_path), lines, marks.join(''), more ? { more } : {});
    }
    case 'NotebookEdit': {
      const src = splitLines(input.new_source);
      return P('diff', sp(input.notebook_path) + (input.edit_mode ? ` ${input.edit_mode}` : ''), head(src, 12), '+'.repeat(Math.min(12, src.length)), src.length > 12 ? { more: src.length - 12 } : {});
    }
    case 'Write': {
      const c = splitLines(input.content);
      return P('diff', sp(input.file_path), head(c, 12), '+'.repeat(Math.min(12, c.length)), c.length > 12 ? { more: c.length - 12 } : {});
    }
    case 'Grep': {
      const opts = [input.glob && `glob ${input.glob}`, input.type && `type ${input.type}`, input.output_mode, input['-i'] && '-i'].filter(Boolean).join(' · ');
      return P('search', `"${input.pattern ?? ''}"${input.path ? ' · ' + sp(input.path) : ''}`, opts ? [opts] : [], opts ? 'd' : '');
    }
    case 'Glob': return P('search', `${input.pattern ?? ''}${input.path ? ' · ' + sp(input.path) : ''}`);
    case 'ToolSearch': return P('search', String(input.query || ''));
    case 'WebFetch': {
      let t = String(input.url || '');
      try { const u = new URL(t); t = u.host + (u.pathname && u.pathname !== '/' ? u.pathname : ''); } catch { /* 그대로 */ }
      const pr = firstNonEmpty(input.prompt);
      return P('web', t, pr ? [pr] : [], pr ? 'd' : '');
    }
    case 'WebSearch': {
      const dom = (input.allowed_domains || []).join(', ');
      return P('web', String(input.query || ''), dom ? [dom] : [], dom ? 'd' : '');
    }
    case 'Agent': case 'Task': {
      const pl = splitLines(input.prompt).filter((l) => l.trim());
      const lines = [...(input.subagent_type ? [`${input.subagent_type}${input.run_in_background ? ' · 백그라운드' : ''}`] : []), ...head(pl, 2)];
      const marks = (input.subagent_type ? 'd' : '') + 'o'.repeat(Math.min(2, pl.length));
      return { mode: 'agent', part: 'input', title: input.description || input.subagent_type || '', lines, marks };
    }
    case 'SendMessage': {
      const m = splitLines(input.message || input.content).filter((l) => l.trim());
      return { mode: 'agent', part: 'input', title: input.to ? `→ ${input.to}` : 'SendMessage', lines: head(m, 4), marks: 'o'.repeat(Math.min(4, m.length)) };
    }
    case 'Skill': return { mode: 'generic', part: 'input', title: input.skill || 'Skill', lines: input.args ? [String(input.args)] : [], marks: input.args ? 'd' : '' };
    case 'TodoWrite': {
      const t = Array.isArray(input.todos) ? input.todos : [];
      const lines = t.map((x) => `${x?.status === 'completed' ? '[x]' : x?.status === 'in_progress' ? '[>]' : '[ ]'} ${x?.status === 'in_progress' ? x.activeForm || x.content : x?.content || ''}`);
      const marks = t.map((x) => (x?.status === 'completed' ? 'd' : x?.status === 'in_progress' ? 'h' : 'o')).join('');
      return { mode: 'generic', part: 'input', title: `할 일 ${t.filter((x) => x?.status === 'completed').length}/${t.length}`, lines, marks };
    }
    default: return P('generic', name || 'tool', ...kvLines(input));
  }
}

/** 입력 객체 → `키: 값` 줄(문자열·수·참거짓만, 6개) */
function kvLines(input) {
  const lines = [];
  for (const [k, v] of Object.entries(input || {})) {
    if (lines.length >= 6) break;
    if (v == null || typeof v === 'object') continue;
    const s = firstNonEmpty(String(v));
    if (s) lines.push(`${k}: ${s}`);
  }
  return [lines, 'd'.repeat(lines.length)];
}

/** tool_result 본문에 그림·바이너리가 있는가 */
function contentKind(content, tur) {
  if (tur && (tur.type === 'image' || (tur.file && tur.file.type === 'image'))) return 'image';
  if (tur && (tur.type === 'pdf' || tur.type === 'binary')) return 'binary';
  if (Array.isArray(content) && content.some((c) => c && (c.type === 'image' || c.type === 'document'))) return 'image';
  return null;
}

/** Read 결과 본문의 `   12→내용` 접두 제거 */
const stripCatN = (l) => String(l).replace(/^\s*\d+[→\t]/, '');

/**
 * tool_result → 패널(결과 단계, 입력 제목 포함 전체 교체)
 * @param name 도구 이름  @param input 도구 입력(없으면 {})  @param tur toolUseResult  @param body 본문 평문(stripTags 뒤)
 * @param content 원래 content(그림 판정)  @param ok  @param basePanel 입력 단계에서 만들어 둔 inputPanel(있으면 input 대신)
 */
export function resultPanel(name, input, tur, body, content, ok = true, basePanel = null) {
  input = input && typeof input === 'object' ? input : {};
  tur = tur && typeof tur === 'object' ? tur : null;
  const base = basePanel || inputPanel(name, input);
  const out = { mode: base.mode, part: 'result', title: base.title, lines: [], marks: '' };
  const secret = !!base.secret || touchesSecret(input);
  const kind = contentKind(content, tur);
  const set = (lines, marks, more = 0) => { out.lines = lines; out.marks = marks; if (more > 0) out.more = more; };
  const bodyLines = splitLines(body).filter((l, i, a) => l.trim() || (i > 0 && i < a.length - 1));
  if (kind) { out.hidden = kind; set([kind === 'image' ? '[이미지 — 내용 생략]' : '[바이너리 — 내용 생략]'], 'd'); return out; }
  if (secret && !['Agent', 'Task', 'TodoWrite', 'Skill', 'TaskStop', 'KillShell'].includes(name)) {
    out.hidden = 'secret';
    set(['[비밀 경로 — 내용 생략]'], 'd');
    return out;
  }
  if (name && name.startsWith('mcp__')) {
    set(head(bodyLines, 11), (ok ? 'o' : 'e').repeat(Math.min(11, bodyLines.length)), bodyLines.length - 11);
    return out;
  }
  switch (name) {
    case 'Bash': case 'PowerShell': case 'Monitor': {
      if (tur && tur.backgroundTaskId) { set([`백그라운드 ${tur.backgroundTaskId} 시작 — 출력은 갱신으로`], 'd'); out.keep = 'tail'; return out; }
      const so = tur ? splitLines(stripAnsi(tur.stdout || '')) : splitLines(stripAnsi(body));
      const se = tur ? splitLines(stripAnsi(tur.stderr || '')) : [];
      const N = PANEL_LIMITS.lines - 1;
      const nse = Math.min(se.length, so.length ? 3 : N);
      const nso = Math.min(so.length, N - nse);
      const lines = [...tail(so, nso), ...tail(se, nse)];
      let marks = 'o'.repeat(nso) + 'e'.repeat(nse);
      if (!ok && !se.length) marks = marks.replace(/o/g, 'e');
      const exitM = /exit(?:ed with)? code[:\s]*(\d+)|\(exit (\d+)\)/i.exec(String(body || ''));
      const code = exitM ? Number(exitM[1] ?? exitM[2]) : ok ? 0 : null;
      const stat = [code != null ? `exit ${code}` : '', tur && tur.interrupted ? '중단됨' : ''].filter(Boolean).join(' · ');
      if (stat) { lines.push(stat); marks += code ? 'e' : 'd'; }
      set(lines, marks, so.length - nso + se.length - nse);
      out.keep = 'tail';
      return out;
    }
    case 'Read': case 'NotebookRead': {
      const c = tur && tur.file && typeof tur.file.content === 'string' ? splitLines(tur.file.content) : bodyLines.map(stripCatN);
      const n = Math.min(11, c.length);
      const lines = head(c, n);
      let marks = 'o'.repeat(n);
      if (tur && tur.file && tur.file.numLines != null) { lines.push(`${tur.file.startLine || 1}～${(tur.file.startLine || 1) + tur.file.numLines - 1}줄${tur.file.totalLines ? ` / ${tur.file.totalLines}` : ''}`); marks += 'd'; }
      set(lines, marks, c.length - n);
      return out;
    }
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': {
      const spc = tur && Array.isArray(tur.structuredPatch) && tur.structuredPatch.length ? diffFromPatch(tur.structuredPatch) : null;
      if (spc) { set(spc.lines, spc.marks, spc.more); return out; }
      if (!ok) { set(head(bodyLines, 4), 'e'.repeat(Math.min(4, bodyLines.length))); return out; }
      set(base.lines, base.marks, base.more || 0);
      return out;
    }
    case 'Grep': {
      let rows;
      if (tur && Array.isArray(tur.filenames) && tur.filenames.length && tur.mode !== 'content') rows = tur.filenames;
      else if (tur && typeof tur.content === 'string' && tur.content) rows = splitLines(tur.content);
      else rows = bodyLines;
      rows = rows.map(shortenLeadPath);
      const n = Math.min(11, rows.length);
      const lines = head(rows, n); let marks = 'h'.repeat(n);
      const stat = tur ? (tur.mode === 'content' ? `${tur.numLines ?? rows.length}줄 일치` : tur.mode === 'count' ? `${tur.numMatches ?? rows.length}건` : `${tur.numFiles ?? rows.length}개 파일`) : '';
      if (stat) { lines.push(stat); marks += 'd'; }
      set(lines, marks, rows.length - n);
      return out;
    }
    case 'Glob': {
      const rows = (tur && Array.isArray(tur.filenames) ? tur.filenames : bodyLines).map(shortenLeadPath);
      const n = Math.min(11, rows.length);
      const lines = head(rows, n); let marks = 'h'.repeat(n);
      lines.push(`${tur?.numFiles ?? rows.length}개 파일${tur?.truncated ? '+' : ''}`); marks += 'd';
      set(lines, marks, rows.length - n);
      return out;
    }
    case 'WebSearch': {
      const rows = [];
      for (const r of tur && Array.isArray(tur.results) ? tur.results : []) {
        if (r && Array.isArray(r.content)) for (const c of r.content) { if (c && c.title) rows.push(`• ${c.title}${c.url ? ' — ' + hostOf(c.url) : ''}`); }
      }
      const src = rows.length ? rows : bodyLines;
      const n = Math.min(12, src.length);
      set(head(src, n), (rows.length ? 'h' : 'o').repeat(n), src.length - n);
      return out;
    }
    case 'WebFetch': {
      const n = Math.min(10, bodyLines.length);
      const lines = head(bodyLines, n); let marks = 'o'.repeat(n);
      if (tur && tur.code != null) { lines.push(`HTTP ${tur.code}${tur.bytes ? ` · ${Math.round(tur.bytes / 1024)}KB` : ''}`); marks += 'd'; }
      set(lines, marks, bodyLines.length - n);
      return out;
    }
    case 'Agent': case 'Task': {
      if (tur && tur.isAsync || /^Async agent launched/.test(body || '')) { set([...base.lines, '백그라운드로 시작 — 진행은 갱신으로'], base.marks + 'd'); return out; }
      const res = splitLines(tur && Array.isArray(tur.content) ? tur.content.map((c) => (c && c.text) || '').join('\n') : body).filter((l) => l.trim() && !/^agentId:/.test(l));
      const n = Math.min(10, res.length);
      const lines = head(res, n); let marks = 'o'.repeat(n);
      if (tur && (tur.totalToolUseCount != null || tur.totalDurationMs != null)) { lines.push(`도구 ${tur.totalToolUseCount ?? 0}회 · ${Math.round((tur.totalDurationMs || 0) / 1000)}초`); marks += 'd'; }
      set(lines, marks, res.length - n);
      return out;
    }
    case 'TodoWrite': set(base.lines, base.marks); return out;
    default: {
      const n = Math.min(bodyLines.length, PANEL_LIMITS.lines - Math.min(base.lines.length, 3));
      const b = Math.min(base.lines.length, PANEL_LIMITS.lines - n);
      set([...head(base.lines, b), ...head(bodyLines, n)], base.marks.slice(0, b) + (ok ? 'o' : 'e').repeat(n), bodyLines.length - n);
      return out;
    }
  }
}

function hostOf(u) { try { return new URL(u).host; } catch { return String(u || '').slice(0, 40); } }

/** 백그라운드 출력 꼬리 패널 */
export function tailPanel(title, lines, ref, { secret = false, mode = 'shell' } = {}) {
  if (secret) return { mode, part: 'tail', title, ref, lines: ['[비밀 경로 — 출력 생략]'], marks: 'd', hidden: 'secret' };
  const t = tail(lines, PANEL_LIMITS.lines);
  return { mode, part: 'tail', title, ref, lines: t, marks: 'o'.repeat(t.length), ...(lines.length > t.length ? { more: lines.length - t.length } : {}) };
}

/** 줄 버퍼(꼬리 n줄 유지): 텍스트 조각을 이어 붙이며 완성 줄과 미완성 마지막 줄을 관리 */
export class LineTail {
  constructor(max = PANEL_LIMITS.lines) { this.max = max; this.lines = []; this.partial = ''; this.total = 0; }
  push(s) {
    const t = stripAnsi(this.partial + String(s ?? '').replace(/\r\n/g, '\n'));
    const parts = t.split('\n');
    this.partial = parts.pop();
    for (const l of parts) { this.lines.push(l); this.total++; }
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
    if (this.partial.length > 4000) this.partial = this.partial.slice(-4000);
  }
  view() {
    const a = this.partial.trim() ? [...this.lines, this.partial] : [...this.lines];
    while (a.length && !a[0].trim()) a.shift();
    return tail(a, this.max);
  }
}

/** 말 패널: 노드의 최근 말 줄들 */
export function sayPanel(lines) {
  const t = tail(lines, PANEL_LIMITS.say);
  return { mode: 'say', part: 'say', title: '', lines: t, marks: 'o'.repeat(t.length) };
}

/** 서브에이전트 진행 → 부모 Agent 패널 */
export function progressPanel(st, ref) {
  const lines = [...(st.prompt ? [st.prompt] : []), `진행 · 도구 ${st.tools}회${st.texts ? ` · 말 ${st.texts}` : ''}`, ...st.recent.map((r) => `› ${r}`)];
  const marks = (st.prompt ? 'd' : '') + 'd' + 'h'.repeat(st.recent.length);
  if (st.result) return { mode: 'agent', part: 'result', title: st.title, ref, lines: [...(st.prompt ? [st.prompt] : []), ...st.result], marks: (st.prompt ? 'd' : '') + 'o'.repeat(st.result.length) };
  return { mode: 'agent', part: 'progress', title: st.title, ref, lines, marks };
}

export const _test = { diffFromStrings, diffFromPatch, shortenLeadPath, splitLines };
export { splitLines, lineCountOf };
