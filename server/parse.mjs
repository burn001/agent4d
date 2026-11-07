// 레코드 → 정규화 이벤트에 쓰는 순수 함수 모음
import path from 'node:path';
import os from 'node:os';

export const LIMITS = { tool: 160, text: 400, output: 600, md: 3000 }; // md: 응답 원문 Markdown(— 줄바꿈이 있는 응답만 싣는다)

/** 도구 이름 → 아이콘 카테고리 */
export function toolCategory(name) {
  if (!name) return 'other';
  if (name.startsWith('mcp__')) return 'mcp';
  switch (name) {
    case 'Bash': case 'PowerShell': return 'shell';
    case 'Read': case 'NotebookRead': return 'read';
    case 'Write': return 'write';
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return 'edit';
    case 'Grep': case 'Glob': case 'ToolSearch': return 'search';
    case 'Agent': case 'Task': case 'SendMessage': case 'TaskOutput': return 'agent';
    case 'Workflow': return 'workflow';
    case 'Skill': return 'skill';
    case 'WebFetch': case 'WebSearch': return 'web';
    case 'Monitor': case 'TaskStop': case 'CronCreate': case 'CronDelete': case 'CronList': return 'monitor';
    case 'Artifact': case 'ArtifactComments': case 'ArtifactData': return 'artifact';
    case 'PushNotification': case 'SendUserFile': return 'notify';
    default: return 'other';
  }
}

export function truncate(s, n) {
  if (s == null) return '';
  s = String(s);
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + '…';
}

/** 출력은 최근 내용이 중요하므로 뒤쪽을 남긴다 */
export function truncateTail(s, n) {
  if (s == null) return '';
  s = String(s);
  if (s.length <= n) return s;
  return '…' + s.slice(s.length - (n - 1));
}

export function oneLine(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

export function stripTags(s) {
  return String(s ?? '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<\/?(command-name|command-message|command-args|local-command-stdout|local-command-caveat)>/g, ' ');
}

function baseName(p) {
  if (!p || typeof p !== 'string') return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function hostOf(u) {
  try { return new URL(u).host; } catch { return String(u || '').slice(0, 60); }
}

/** tool-start 요약 */
export function summarizeToolInput(name, input) {
  input = input && typeof input === 'object' ? input : {};
  let s;
  if (name && name.startsWith('mcp__')) {
    const [, server, ...rest] = name.split('__');
    s = `${server}.${rest.join('__')}`;
  } else {
    switch (name) {
      case 'Bash': case 'PowerShell':
        s = input.description || String(input.command || '').slice(0, 120); break;
      case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit': case 'NotebookRead':
        s = baseName(input.file_path || input.notebook_path || input.path); break;
      case 'Grep': case 'Glob':
        s = input.pattern; break;
      case 'ToolSearch':
        s = input.query; break;
      case 'Agent': case 'Task':
        s = input.description || input.subagent_type; break;
      case 'Skill':
        s = input.skill; break;
      case 'WebFetch':
        s = hostOf(input.url); break;
      case 'WebSearch':
        s = input.query; break;
      case 'Monitor':
        s = input.description || String(input.command || '').slice(0, 120); break;
      case 'Workflow':
        s = input.name || input.workflowName || input.description || input.script_path; break;
      case 'TaskStop':
        s = input.task_id || input.shell_id; break;
      case 'SendMessage':
        s = input.to ? `→ ${input.to}` : undefined; break;
      default:
        break;
    }
    if (s == null || s === '') {
      try { s = JSON.stringify(input).slice(0, 80); } catch { s = ''; }
    }
  }
  return truncate(oneLine(s), LIMITS.tool);
}

/** tool_result.content → 평문 */
export function textOfContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => {
      if (!c) return '';
      if (typeof c === 'string') return c;
      if (c.type === 'text') return c.text || '';
      if (c.type === 'image') return '[이미지]';
      if (c.type === 'tool_reference') return `[${c.tool_name || 'tool'}]`;
      return '';
    }).join('\n');
  }
  if (typeof content === 'object' && content.text) return content.text;
  return '';
}

export function summarizeToolResult(content) {
  return truncate(oneLine(stripTags(textOfContent(content))), LIMITS.tool);
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

export function isTaskNotification(s) {
  return typeof s === 'string' && s.trimStart().startsWith('<task-notification>');
}

/** <task-notification> 본문 분해 */
export function parseTaskNotification(s) {
  const get = (tag) => {
    const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(s);
    return m ? decodeEntities(m[1].trim()) : null;
  };
  // 세션 종료로 정리된 작업 알림(<status>stopped</status>)은 task-id 를 여러 개 싣는다(마지막은 __orphan_summary__:…)
  const taskIds = [];
  for (const m of s.matchAll(/<task-id>([\s\S]*?)<\/task-id>/g)) taskIds.push(decodeEntities(m[1].trim()));
  return {
    taskId: get('task-id'),
    taskIds,
    toolUseId: get('tool-use-id'),
    outputFile: get('output-file'),
    status: get('status'),
    summary: get('summary'),
    event: get('event'),
    result: get('result'),
  };
}

// ───────────── '중지됨' 판정 ─────────────
/** 끝난 상태: 완료·오류·중지됨 */
export const isEndedStatus = (st) => st === 'done' || st === 'error' || st === 'stopped';

/**
 * 프로세스를 끄는 명령(포그라운드 셸). 실측: 에이전트가 시험 서버를 끌 때 `taskkill //PID n //F`,
 * PowerShell `Stop-Process -Id …`, `kill -9 $pid`, `pkill`, `fuser -k` 를 쓰고, 몇 초 안에 그 백그라운드 작업의
 * 알림이 `<status>failed</status>` "failed with exit code 1/127/143/255" 로 온다(TaskStop 과 달리 알림 status 가 failed)
 */
export const KILL_CMD_RE = /(?:^|[\s;&|(`'"])(?:taskkill(?:\.exe)?\b|Stop-Process\b|spps\s|pkill\b|killall\b|fuser\s+(?:-\w+\s+)*-k\b|kill-port\b|kill\s+(?:-\w+\s+)*[%$\d])|\.Kill\(\)/i;
// heredoc 본문에 적힌 `taskkill …`(문서·스크립트를 쓰는 python/cat heredoc)은 끄는 명령이 아니다
export function isKillCommand(cmd) { return typeof cmd === 'string' && KILL_CMD_RE.test(blankHeredocs(cmd)); }

// ───────────── heredoc 본문 지우기 ─────────────
const HD_SHELL_RE = /^(?:bash|sh|zsh|dash|ksh|ash)(?:\.exe)?$/i;
const HD_PREFIX = new Set(['sudo', 'nohup', 'exec', 'command', 'builtin', 'env', 'time', 'nice', 'setsid', 'stdbuf', 'then', 'do', 'else', '{', '!', '(']);
/** 단순 명령 낱말들이 표준 입력을 셸 명령으로 읽는 셸(`bash`·`sh -s`·`sudo bash -x`)인지. `bash -c …`·`bash x.sh` 는 아님(본문은 자료) */
function hdFeedsShell(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/^['"]|['"]$/g, ''));
  let i = 0;
  while (i < words.length) {
    const w = words[i], b = w.replace(/^.*[\\/]/, '').toLowerCase();
    if (/^[A-Za-z_]\w*=/.test(w)) { i++; continue; }
    if (b === 'timeout') { i++; while (i < words.length && /^(?:-|\d)/.test(words[i])) i++; continue; }
    if (HD_PREFIX.has(b)) { i++; while (i < words.length && /^-/.test(words[i])) i++; continue; }
    break;
  }
  if (i >= words.length || !HD_SHELL_RE.test(words[i].replace(/^.*[\\/]/, ''))) return false;
  const args = words.slice(i + 1);
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--') return k === args.length - 1;
    if (/^[-+]o$/.test(a)) { k++; continue; }
    if (/^--/.test(a)) continue;
    if (/^-[A-Za-z]+$/.test(a)) { if (a.includes('c')) return false; if (a.includes('s')) return true; continue; }
    return false; // 스크립트 파일 인자 — 표준 입력은 그 스크립트의 자료
  }
  return true;
}
/** heredoc 연산자 뒤 같은 줄에서 본문이 파이프로 셸에 들어가는지(`cat <<EOF | bash`) */
function hdPipesToShell(rest) {
  const r = String(rest || '').split(/;|&&|\|\||(?<![>&|])&(?![&>])/)[0];
  const stages = r.split('|').slice(1);
  return stages.some((st) => hdFeedsShell(st.replace(/[)`].*$/, '')));
}

/**
 * Bash heredoc 본문(`<<WORD`·`<<-WORD`·`<<'WORD'`·`<<"WORD"`, 끝 표지 줄까지)과 PowerShell here-string(`@' … '@`·`@" … "@`) 본문을
 * **같은 길이의 공백**으로 바꾼다(줄바꿈은 남김 — 위치가 원문과 같아 at·cdGuess 계산이 그대로). 본문에 적힌 `node …/x.mjs`·`nohup …&`·
 * `claude -p`·`taskkill` 은 셸 명령이 아니다. `<<<` here-string 은 heredoc 이 아님. 따옴표·`$( )`(따옴표 안 `"$(cat <<'EOF' … EOF)"` 포함)·
 * 주석·산술 `(( ))` 을 따라가며 따옴표 밖 연산자만 본다. 한 줄에 여러 heredoc 이면 본문이 차례로 이어진다.
 * 예외: 본문이 **셸 인터프리터의 표준 입력**(`bash <<EOF`·`sh -s <<EOF`·`cat <<EOF | bash`)이면 본문이 곧 명령이라 남기고 끝 표지 줄만 지운다.
 * `ssh host <<EOF`(원격)·`python - <<EOF`·`node <<JS`·`cat > f <<EOF` 는 지운다. 끝 표지를 못 찾은(덜 닫힌) heredoc 은 손대지 않는다.
 * @param {{tool?:'Bash'|'PowerShell'}} opts tool 을 모르면 둘 다
 */
export function blankHeredocs(command, { tool } = {}) {
  let s = typeof command === 'string' ? command : String(command ?? '');
  if (tool !== 'PowerShell' && s.includes('<<')) s = blankBashHeredocs(s);
  if (tool !== 'Bash' && s.includes('@')) {
    s = s.replace(/@(['"])[ \t]*\r?\n[\s\S]*?\r?\n\1@/g, (m) => m.slice(0, 2) + m.slice(2, -2).replace(/[^\r\n]/g, ' ') + m.slice(-2));
  }
  if (/-(?:e|c|p|-eval|-print)\s/.test(s)) s = blankInlineCode(s, tool === 'PowerShell');
  return s;
}

// 인라인 코드 인자: `node -e "…"`·`node -p '…'`·`python -c "…"`·`perl -e`·`ruby -e`·`deno eval` 의 따옴표 인자는 그 언어의 코드(셸 명령 아님)
const INLINE_CODE_RE = /(?:^|[\s;&|(`])(?:node|nodejs|python[\d.]*w?|py|perl|ruby|php|deno\s+eval|bun\s+-e)(?:\.exe)?(?:\s+--?[\w=.:/-]+)*?\s+(?:-e|-c|-p|-r|--eval|--print)?\s*(?=['"])/gi;
function blankInlineCode(s, ps) {
  let out = null;
  INLINE_CODE_RE.lastIndex = 0;
  let m;
  while ((m = INLINE_CODE_RE.exec(s))) {
    const head = m[0];
    // deno eval 말고는 코드 플래그(-e·-c·-p·-r·--eval·--print)가 있어야 한다(`python "x y.py"` 는 파일 인자)
    if (!/(?:\s-[ecpr]|--eval|--print)\s*$/i.test(head) && !/deno\s+eval/i.test(head)) continue;
    const q0 = m.index + head.length;
    const q = s[q0];
    let j = q0 + 1;
    while (j < s.length && s[j] !== q) {
      if (q === '"' && ((!ps && s[j] === '\\') || (ps && s[j] === '`'))) j++;
      j++;
    }
    if (j >= s.length) break; // 덜 닫힌 따옴표 — 손대지 않음
    if (!out) out = s.split('');
    for (let k = q0 + 1; k < j; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    INLINE_CODE_RE.lastIndex = j + 1;
  }
  return out ? out.join('') : s;
}

function blankBashHeredocs(s) {
  const n = s.length;
  let out = null; // 바꿀 때만 배열로
  const blank = (a, b) => { if (!out) out = s.split(''); for (let k = a; k < b; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '; };
  const stack = []; // "'" · '"' · '$(' · '(' · '((' · '`'
  let pend = [];
  let stageStart = 0;
  for (let i = 0; i < n; i++) {
    const c = s[i];
    const top = stack[stack.length - 1];
    if (top === "'") { if (c === "'") stack.pop(); continue; }
    if (top === '((') { if (c === ')' && s[i + 1] === ')') { stack.pop(); i++; } continue; }
    if (top === '"') {
      if (c === '\\') { i++; continue; }
      if (c === '"') { stack.pop(); continue; }
      if (c === '`') { stack.push('`'); continue; }
      if (c === '$' && s[i + 1] === '(') { if (s[i + 2] === '(') { stack.push('(('); i += 2; } else { stack.push('$('); i++; stageStart = i + 1; } }
      continue;
    }
    // 따옴표 밖(최상위·$( )·( )·` `)
    if (c === '\\') { i++; continue; }
    if (c === "'" || c === '"') { stack.push(c); continue; }
    if (c === '`') { if (top === '`') stack.pop(); else { stack.push('`'); stageStart = i + 1; } continue; }
    if (c === '$' && s[i + 1] === '(') { if (s[i + 2] === '(') { stack.push('(('); i += 2; } else { stack.push('$('); i++; stageStart = i + 1; } continue; }
    if (c === '(') { if (s[i + 1] === '(') { stack.push('(('); i++; } else { stack.push('('); stageStart = i + 1; } continue; }
    if (c === ')') { if (top === '$(' || top === '(') stack.pop(); stageStart = i + 1; continue; }
    if (c === '#' && (i === 0 || /[\s;&|()]/.test(s[i - 1]))) { const e = s.indexOf('\n', i); i = (e < 0 ? n : e) - 1; continue; }
    if (c === ';' || c === '|' || c === '&') { stageStart = i + 1; continue; }
    if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<' && s[i - 1] !== '<') {
      let j = i + 2;
      const tabs = s[j] === '-';
      if (tabs) j++;
      while (s[j] === ' ' || s[j] === '\t') j++;
      let word = null;
      const q = s[j];
      if (q === "'" || q === '"') { const e = s.indexOf(q, j + 1); if (e > j && !s.slice(j + 1, e).includes('\n')) { word = s.slice(j + 1, e); j = e + 1; } }
      else { const m = /^\\?([^\s;&|<>()'"`]+)/.exec(s.slice(j, j + 200)); if (m) { word = m[1]; j += m[0].length; } }
      if (!word) continue;
      const eol = s.indexOf('\n', j);
      const feed = hdFeedsShell(s.slice(stageStart, i)) || hdPipesToShell(s.slice(j, eol < 0 ? n : eol));
      pend.push({ word, tabs, feed });
      i = j - 1;
      continue;
    }
    if (c === '\n') {
      stageStart = i + 1;
      if (!pend.length) continue;
      // 본문들이 차례로: 줄마다 끝 표지인지
      let k = i + 1, ok = true;
      const ranges = [];
      for (const d of pend) {
        const from = k;
        let found = false;
        while (k <= n) {
          let e = s.indexOf('\n', k);
          if (e < 0) e = n;
          const raw = s.slice(k, e).replace(/\r$/, '');
          const lead = d.tabs ? (/^\t*/.exec(raw)[0].length) : 0;
          const line = raw.slice(lead);
          if (line.trimEnd() === d.word) { ranges.push({ from, termAt: k, end: e, feed: d.feed }); k = e + 1; found = true; break; }
          // `$(cat <<'EOF' … EOF)` 처럼 끝 표지 바로 뒤 `)` — 표지 낱말만 지우고 `)` 는 다시 읽는다
          if (stack.includes('$(') && line.startsWith(d.word + ')')) { ranges.push({ from, termAt: k, end: k + lead + d.word.length, feed: d.feed, cont: true }); k = k + lead + d.word.length; found = true; break; }
          if (e >= n) break;
          k = e + 1;
        }
        if (!found) { ok = false; break; }
      }
      pend = [];
      if (!ok) continue; // 덜 닫힌 heredoc — 손대지 않고 그대로 읽어 간다(예전과 같음)
      for (const r of ranges) blank(r.feed ? r.termAt : r.from, r.end);
      const last = ranges[ranges.length - 1];
      i = (last.cont ? last.end : Math.min(n, last.end)) - 1;
      if (!last.cont) stageStart = last.end + 1;
      continue;
    }
  }
  return out ? out.join('') : s;
}
/** 신호로 끝난 종료 코드(128+SIGINT·SIGKILL·SIGTERM) */
export const SIGNAL_EXIT = new Set([130, 137, 143]);
/** 알림 요약의 종료 코드: "failed with exit code 1" / "script failed (exit 4)" */
export function exitCodeOf(summary) {
  const m = /exit code (\d+)|\(exit (\d+)\)/i.exec(summary || '');
  return m ? Number(m[1] ?? m[2]) : null;
}
/** 끄는 명령과 failed 알림 사이 허용 간격(명령 뒤 30초 안 알림, 알림 뒤 2초 안 명령까지) */
export const STOP_WINDOW_MS = 30_000;
export const STOP_LEAD_MS = 2_000;
/** killed·stopped 알림의 중지 사유 */
export function stopReasonOfNotification(n) {
  if (!n) return null;
  if (n.status === 'killed') return /time limit|timed? ?out/i.test(n.summary || '') ? 'time-limit' : 'killed';
  if (n.status === 'stopped') return 'orphan';
  return null;
}

// claude -p 감지
export const CLAUDE_P_RE = /(?:^|[\s;&|(`"'])claude(?:\.exe|\.cmd|\.ps1)?\s+(?:[^\n|;&]*?\s)?(?:-p|--print)(?=\s|=|$)/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// 값을 받는 claude 플래그: 바로 뒤 따옴표 문자열은 프롬프트가 아니다
const VALUE_FLAG_RE = /^--?(?:model|fallback-model|output-format|input-format|max-turns|max-budget-usd|allowed-?tools|disallowed-?tools|tools|append-system-prompt|system-prompt|permission-mode|permission-prompt-tool|mcp-config|settings|setting-sources|add-dir|plugin-dir|session-id|resume|r|agents?|betas|json-schema|effort)$/i;

/** 셸 따옴표 안 이스케이프를 대충 푼다(비교용) */
function unquote(q, body) {
  if (q === "'") return body;
  return body.replace(/\\(["\\$`])/g, '$1');
}

/**
 * claude 호출 뒤 프롬프트 후보들(보강). 순서: heredoc 본문 → echo/printf 로 흘려 넣은 문자열 → 호출 뒤 따옴표 인자
 * (값 받는 플래그의 값·$(로 시작하는 치환은 뺌). 각 200자.
 */
export function promptCandidates(command, at = 0) {
  const out = [];
  const push = (s) => { s = String(s || '').trim(); if (s.length >= 4 && !out.includes(s.slice(0, 200))) out.push(s.slice(0, 200)); };
  // heredoc: claude -p "$(cat <<'EOF' … EOF)" · cat <<EOF | claude -p · claude -p <<EOF
  const hd = /<<-?\s*(['"]?)([A-Za-z_][\w]*)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|\)|$)/g;
  let m;
  while ((m = hd.exec(command))) push(m[3]);
  // echo "…" | claude -p · printf '…' | claude -p
  const ep = /(?:^|[\s;&|(])(?:echo|printf)\s+(?:-[a-zA-Z]+\s+)*(["'])([\s\S]*?)\1\s*\|\s*claude/g;
  while ((m = ep.exec(command))) push(unquote(m[1], m[2]));
  // 호출 뒤 같은 명령 구간(따옴표 밖 | ; && 줄바꿈 전까지)의 따옴표 인자
  const seg = command.slice(at);
  let i = 0, prevTok = '';
  while (i < seg.length) {
    const c = seg[i];
    if (c === '"' || c === "'") {
      let j = i + 1, body = '';
      while (j < seg.length && seg[j] !== c) { if (c === '"' && seg[j] === '\\' && j + 1 < seg.length) { body += seg[j] + seg[j + 1]; j += 2; continue; } body += seg[j++]; }
      // 값 받는 플래그 뒤 · `--effort='x'` 처럼 `--플래그=` 에 붙은 따옴표는 값
      if (!VALUE_FLAG_RE.test(prevTok) && !(prevTok.startsWith('-') && prevTok.endsWith('=')) && !/^\$\(/.test(body)) push(unquote(c, body));
      prevTok = '';
      i = j + 1;
      continue;
    }
    if (c === '|' || c === ';' || c === '\n' || (c === '&' && seg[i + 1] === '&')) break;
    if (/\s/.test(c)) { i++; continue; }
    let j = i;
    while (j < seg.length && !/[\s"'|;&]/.test(seg[j])) j++;
    if (j === i) { i++; prevTok = ''; continue; } // 홀로 선 & (2>&1, 뒤로 보내기) — 한 글자 넘김(예전 무한 반복)
    const tok = seg.slice(i, j);
    prevTok = tok.includes('=') && tok.startsWith('-') && !tok.endsWith('=') ? '' : tok; // --model=x 꼴은 값이 붙어 있음(`--x=` 뒤 따옴표는 위에서 값으로)
    i = j;
  }
  return out;
}

/**
 * claude 호출의 `--effort X`·`--effort=X`·`--effort 'X'` 값(요청 effort). 호출 위치(at)부터 같은 명령 구간
 * (따옴표 밖 | ; && 줄바꿈 전까지)의 따옴표 밖 낱말만 본다 — 프롬프트 글 속 `--effort` 는 무시. 없으면 null(24자).
 */
export function effortFlagOf(command, at = 0) {
  if (typeof command !== 'string') return null;
  const seg = command.slice(at);
  const val = (v) => { v = String(v || '').trim(); return /^[A-Za-z][\w-]{0,23}$/.test(v) ? v : null; };
  let i = 0, want = false;
  while (i < seg.length) {
    const c = seg[i];
    if (c === '"' || c === "'") {
      let j = i + 1, body = '';
      while (j < seg.length && seg[j] !== c) { if (c === '"' && seg[j] === '\\' && j + 1 < seg.length) { body += seg[j + 1]; j += 2; continue; } body += seg[j++]; }
      if (want) return val(body);
      i = j + 1;
      continue;
    }
    if (c === '|' || c === ';' || c === '\n' || (c === '&' && seg[i + 1] === '&')) break;
    if (/\s/.test(c)) { i++; continue; }
    let j = i;
    while (j < seg.length && !/[\s|;&]/.test(seg[j])) {
      if (seg[j] === '"' || seg[j] === "'") { // --effort="max" · --effort='high' (붙은 따옴표)
        const q = seg[j]; const k = seg.indexOf(q, j + 1); j = k < 0 ? seg.length : k + 1; continue;
      }
      j++;
    }
    if (j === i) { i++; want = false; continue; }
    const tok = seg.slice(i, j);
    if (want) return val(tok);
    const m = /^--effort=(.*)$/i.exec(tok);
    if (m) return val(m[1].replace(/^(["'])(.*)\1$/, '$2'));
    want = /^--effort$/i.test(tok);
    i = j;
  }
  return null;
}

/** 호출 앞 마지막 cd(같은 줄 앞부분 어디든: `export X=1 && cd D:/a && claude -p …`, cmd 의 `cd /d`) */
export function lastCdBefore(command, at) {
  const re = /(?:^|&&|;|\|\||\n|\()\s*(?:cd|Set-Location|pushd|sl)(?:\s+\/d)?\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/gi;
  let m, last = null;
  while ((m = re.exec(command)) && m.index < at) last = m[1] || m[2] || m[3];
  return last;
}

export function detectClaudeP(command) {
  if (typeof command !== 'string') return null;
  // heredoc 본문에 적힌 `claude -p`(문서를 쓰는 python heredoc 등)는 호출이 아니다 — 같은 길이로 지운 명령에서 찾는다(위치 같음).
  // 프롬프트 후보는 원문에서(`claude -p <<'EOF' … EOF` 의 본문이 곧 프롬프트)
  const cmd = blankHeredocs(command);
  const m = CLAUDE_P_RE.exec(cmd);
  if (!m) return null;
  const at = m.index;
  const hint = new RegExp(`--(?:session-id|resume)[\\s=]+["']?(${UUID})`, 'i').exec(cmd)
    || new RegExp(`\\s-r\\s+["']?(${UUID})`, 'i').exec(cmd);
  const prompts = promptCandidates(command, at);
  return {
    sessionIdHint: hint ? hint[1].toLowerCase() : null,
    promptHint: prompts[0] || null,
    promptHints: prompts,
    cdGuess: lastCdBefore(cmd, at),
    effortReq: effortFlagOf(cmd, at), // 요청 effort
  };
}

/** 프롬프트 비교용: 공백 접기·소문자 */
export const normPrompt = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** 후보 프롬프트 중 하나의 앞 40자(정규화)가 첫 프롬프트에 들어 있으면 true. 8자 미만 후보는 무시 */
export function promptMatches(hints, firstPrompt) {
  if (!firstPrompt || !hints || !hints.length) return false;
  const fp = normPrompt(firstPrompt);
  for (const h of hints) {
    const k = normPrompt(h).slice(0, 40);
    if (k.length >= 8 && fp.includes(k)) return true;
  }
  return false;
}

/**
 * cwd 가 어떤 세션의 임시 폴더(<tmp>/claude/<인코딩 cwd>/<sessionId>/… — scratchpad·tasks) 안이면 그 sessionId.
 * 부모 세션의 에이전트가 자기 scratchpad 에서 claude -p 를 돌린 경우(명령에 claude -p 가 안 보이는 스크립트 실행 포함) 부모가 분명하다.
 */
export function scratchOwnerOf(cwd, tmpRoots = null) {
  const n = normPath(cwd);
  if (!n) return null;
  const roots = (tmpRoots || [process.env.CLAUDE_CODE_TMPDIR ? path.join(process.env.CLAUDE_CODE_TMPDIR, 'claude') : null, path.join(os.tmpdir(), 'claude')])
    .filter(Boolean).map(normPath);
  const re = new RegExp(`^/[^/]+/(${UUID})(?:/|$)`, 'i');
  for (const r of roots) {
    if (!n.startsWith(r + '/')) continue;
    const mm = re.exec(n.slice(r.length));
    if (mm) return mm[1].toLowerCase();
  }
  // 다른 임시 폴더 설정: …/temp|tmp/claude/<enc>/<uuid>/
  const g = new RegExp(`/(?:temp|tmp)/claude/[^/]+/(${UUID})(?:/|$)`, 'i').exec(n);
  return g ? g[1].toLowerCase() : null;
}

/** stdout(json/stream-json) 의 session_id 들 */
export function extractSessionIds(text) {
  const out = new Set();
  if (!text) return [];
  const re = new RegExp(`"session_id"\\s*:\\s*"(${UUID})"`, 'gi');
  let m;
  while ((m = re.exec(text))) out.add(m[1].toLowerCase());
  return [...out];
}

export function encodeCwd(cwd) {
  return String(cwd || '').replace(/[^A-Za-z0-9]/g, '-');
}

/** 경로 비교용 정규화: /c/Users → c:/users, 역슬래시 → 슬래시, 소문자 */
export function normPath(p) {
  if (!p) return '';
  let s = String(p).trim().replace(/\\/g, '/');
  const m = /^\/([a-zA-Z])\//.exec(s);
  if (m) s = `${m[1]}:/` + s.slice(3);
  s = s.replace(/\/+$/, '');
  return s.toLowerCase();
}

export function resolveCwdGuess(ownerCwd, cdGuess) {
  if (!cdGuess) return ownerCwd || null;
  let g = cdGuess.replace(/^~(?=[\\/]|$)/, process.env.USERPROFILE || process.env.HOME || '~');
  const n = normPath(g);
  if (/^[a-z]:\//.test(n) || n.startsWith('/')) return g;
  return ownerCwd ? path.join(ownerCwd, g) : g;
}

const OUTPUT_RE = /Output is being written to: (.+?\.output)/;
export function extractOutputPath(text) {
  const m = OUTPUT_RE.exec(text || '');
  return m ? m[1].trim() : null;
}

export function userTextSummary(content) {
  return truncate(oneLine(stripTags(typeof content === 'string' ? content : textOfContent(content))), LIMITS.text);
}

export function isoOr(ts, fallback) {
  if (typeof ts === 'string' && ts) return ts;
  if (typeof ts === 'number') return new Date(ts).toISOString();
  return fallback || new Date().toISOString();
}

/**
 * toolUseResult 가 없는 transcript(일부 서브에이전트·워크플로 에이전트 파일)에서
 * tool_result 본문으로 같은 정보를 추정한다.
 */
export function inferToolUseResult(name, text) {
  if (!text) return null;
  text = String(text).trimStart().slice(0, 2000);
  if (name === 'Bash' || name === 'PowerShell') {
    const m = /^Command running in background with ID: ([A-Za-z0-9_-]+)/.exec(text)
      || /^Command did not complete within [^\n]*?moved to the background \(ID: ([A-Za-z0-9_-]+)\)/.exec(text);
    if (m) {
      const to = /within its (\d+)s timeout/.exec(text);
      return { backgroundTaskId: m[1], ...(to ? { timedOutAfterMs: Number(to[1]) * 1000 } : {}) };
    }
    return null;
  }
  if (name === 'Monitor') {
    const m = /^Monitor started \(task ([A-Za-z0-9_-]+)(?:, expires in (\d+)m)?/.exec(text);
    if (m) return { taskId: m[1], timeoutMs: m[2] ? Number(m[2]) * 60_000 : null, persistent: !m[2] };
    return null;
  }
  if (name === 'Agent' || name === 'Task') {
    const isAsync = /^Async agent launched/.test(text);
    const m = /^agentId: ([A-Za-z0-9_-]+)/m.exec(text);
    if (!m || (!isAsync && m.index > 400)) return null;
    return { agentId: m[1], isAsync, status: isAsync ? 'async_launched' : 'completed' };
  }
  if (name === 'Workflow') {
    if (!/^Workflow launched/.test(text)) return null;
    const run = /^Run ID: ([A-Za-z0-9_-]+)/m.exec(text);
    if (!run) return null;
    const task = /Task ID: ([A-Za-z0-9_-]+)/.exec(text);
    return { runId: run[1], taskId: task ? task[1] : null, status: 'async_launched' };
  }
  return null;
}
