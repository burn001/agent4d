// 작업 요약(brief·detail). 이벤트의 기존 text 는 그대로 두고 필드를 더한다.
//   tool-start: brief(한 줄 ≤60, 노드 라벨·홀로그램 패널·타임라인에 씀) + detail(보조 ≤120)
//   tool-end:   brief(결과 한 줄 ≤80: 종료 코드·일치 n건·출력 마지막 줄 …)
//   text(assistant): brief(최근 문장 한두 개 ≤120). thinking 은 내용을 싣지 않는다(지금처럼 글자 수만).
// 마스킹·길이 상한·privacy 'minimal'(빈 문자열)은 graph.emit 이 text 와 똑같이 적용한다 — 여기서는 원문 요약만 만든다.

export const BRIEF_LIMITS = { brief: 60, detail: 120, result: 80, say: 120 };

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => { s = one(s); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; };

/** 경로를 짧게: 마지막 두 조각(web/app.js). 드라이브·홈 경로는 버린다 */
export function shortPath(p, parts = 2) {
  if (!p || typeof p !== 'string') return '';
  const seg = p.split(/[\\/]+/).filter(Boolean);
  return seg.slice(-parts).join('/');
}
const base = (p) => shortPath(p, 1);

/** 명령의 첫 의미 있는 줄(빈 줄·주석·cd 앞부분 제외) */
export function firstCommandLine(cmd) {
  const lines = String(cmd ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  let l = lines[0] || '';
  // `cd x && npm test` → `npm test` (어디서 돌렸는지보다 무엇을 돌렸는지가 중요)
  const m = /^(?:cd|Set-Location|pushd)\s+(?:\/d\s+)?(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*(.+)$/i.exec(l);
  if (m) l = m[1];
  if (lines.length > 1) l += ' …';
  return l;
}

const lineCount = (s) => (typeof s === 'string' && s.length ? s.split(/\r?\n/).length : 0);

/** tool_use 입력 → {brief, detail} */
export function toolBrief(name, input) {
  input = input && typeof input === 'object' ? input : {};
  let b = '', d = '';
  if (name && name.startsWith('mcp__')) {
    const [, server, ...rest] = name.split('__');
    b = `${server}.${rest.join('__')}`;
    const firstStr = Object.values(input).find((v) => typeof v === 'string' && v.trim());
    d = firstStr || '';
  } else {
    switch (name) {
      case 'Bash': case 'PowerShell': case 'Monitor':
        b = firstCommandLine(input.command) || input.description || '';
        d = input.description && b !== input.description ? input.description : '';
        if (input.run_in_background) d = (d ? d + ' · ' : '') + '백그라운드';
        break;
      case 'Read': case 'NotebookRead': {
        b = shortPath(input.file_path || input.notebook_path || input.path);
        if (input.offset || input.limit) d = `${input.offset ? input.offset + '줄부터' : '처음부터'}${input.limit ? ' ' + input.limit + '줄' : ''}`;
        if (input.pages) d = `${input.pages}쪽`;
        break;
      }
      case 'Edit': {
        const add = lineCount(input.new_string), del = lineCount(input.old_string);
        b = `${base(input.file_path)} +${add} −${del}${input.replace_all ? ' (전체)' : ''}`;
        d = shortPath(input.file_path, 3);
        break;
      }
      case 'MultiEdit': {
        let add = 0, del = 0;
        for (const e of Array.isArray(input.edits) ? input.edits : []) { add += lineCount(e && e.new_string); del += lineCount(e && e.old_string); }
        b = `${base(input.file_path)} +${add} −${del}`;
        d = `${(input.edits || []).length}곳 · ${shortPath(input.file_path, 3)}`;
        break;
      }
      case 'NotebookEdit':
        b = `${base(input.notebook_path)}${input.edit_mode ? ' ' + input.edit_mode : ''}`; d = shortPath(input.notebook_path, 3); break;
      case 'Write':
        b = `${base(input.file_path)} ${lineCount(input.content)}줄`; d = shortPath(input.file_path, 3); break;
      case 'Grep':
        b = `"${input.pattern ?? ''}"${input.path ? ' · ' + shortPath(input.path) : ''}`;
        d = [input.glob && `glob ${input.glob}`, input.type && `type ${input.type}`, input.output_mode].filter(Boolean).join(' · ');
        break;
      case 'Glob':
        b = `${input.pattern ?? ''}${input.path ? ' · ' + shortPath(input.path) : ''}`; break;
      case 'ToolSearch': b = input.query || ''; break;
      case 'WebFetch': {
        try { const u = new URL(input.url); b = u.host + (u.pathname && u.pathname !== '/' ? u.pathname : ''); } catch { b = String(input.url || ''); }
        d = input.prompt || '';
        break;
      }
      case 'WebSearch': b = input.query || ''; d = (input.allowed_domains || []).join(', '); break;
      case 'Agent': case 'Task':
        b = input.description || input.subagent_type || '';
        d = [input.subagent_type, input.run_in_background ? '백그라운드' : ''].filter(Boolean).join(' · ');
        break;
      case 'Skill': b = [input.skill, input.args].filter(Boolean).join(' '); d = input.args || ''; break;
      case 'Workflow': b = input.name || input.workflowName || input.description || base(input.script_path); break;
      case 'TaskStop': case 'KillShell': b = `■ ${input.task_id || input.shell_id || ''}`; break;
      case 'TaskOutput': b = input.task_id || input.agent_id || ''; break;
      case 'SendMessage': b = input.to ? `→ ${input.to}` : ''; d = input.message || input.content || ''; break;
      case 'TodoWrite': {
        const t = Array.isArray(input.todos) ? input.todos : [];
        const doing = t.find((x) => x && x.status === 'in_progress');
        b = doing ? doing.activeForm || doing.content || '' : `할 일 ${t.length}개`;
        d = `완료 ${t.filter((x) => x && x.status === 'completed').length}/${t.length}`;
        break;
      }
      case 'Artifact': b = input.action || 'publish'; d = base(input.file_path) || input.url || ''; break;
      case 'PushNotification': b = input.message || input.title || ''; break;
      case 'CronCreate': b = input.schedule || input.cron || ''; d = input.prompt || ''; break;
      default: break;
    }
    if (!one(b)) { try { b = JSON.stringify(input).slice(0, 60); } catch { b = ''; } }
  }
  return { brief: cut(b, BRIEF_LIMITS.brief), detail: cut(d, BRIEF_LIMITS.detail) };
}

/** 출력 마지막 의미 있는 줄 */
export function lastLine(s) {
  const lines = String(s ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] || '';
}

/**
 * tool_result → 결과 한 줄. tur = rec.toolUseResult(있으면), body = 결과 본문 평문, ok = !is_error
 */
export function resultBrief(name, tur, body, ok = true) {
  tur = tur && typeof tur === 'object' ? tur : null;
  let s = '';
  const exitM = /exit(?:ed with)? code[:\s]*(\d+)|\(exit (\d+)\)/i.exec(String(body || ''));
  const exit = exitM ? Number(exitM[1] ?? exitM[2]) : null;
  switch (name) {
    case 'Bash': case 'PowerShell': {
      if (tur && tur.backgroundTaskId) { s = `백그라운드 ${tur.backgroundTaskId}`; break; }
      const out = tur ? (tur.stdout || tur.stderr || '') : body;
      const last = lastLine(out);
      const code = exit != null ? exit : ok ? 0 : null;
      s = [code != null ? `exit ${code}` : '', tur && tur.interrupted ? '중단됨' : '', last].filter(Boolean).join(' · ');
      break;
    }
    case 'Grep':
      if (tur && tur.numFiles != null) s = tur.mode === 'content' ? `${tur.numLines ?? 0}줄 일치` : tur.mode === 'count' ? `${tur.numMatches ?? tur.numLines ?? 0}건` : `${tur.numFiles}개 파일`;
      break;
    case 'Glob': if (tur && tur.numFiles != null) s = `${tur.numFiles}개 파일${tur.truncated ? '+' : ''}`; break;
    case 'Read': if (tur && tur.file && tur.file.numLines != null) s = `${tur.file.numLines}줄 읽음${tur.file.totalLines ? ` / ${tur.file.totalLines}` : ''}`; break;
    case 'Edit': case 'MultiEdit': case 'Write': {
      const sp = tur && Array.isArray(tur.structuredPatch) ? tur.structuredPatch : null;
      if (sp) {
        let a = 0, r = 0;
        for (const h of sp) for (const l of (h && h.lines) || []) { if (l[0] === '+') a++; else if (l[0] === '-') r++; }
        s = `${tur.type === 'create' ? '새 파일 ' : ''}+${a} −${r}`;
      }
      break;
    }
    case 'WebFetch': if (tur && tur.code != null) s = `HTTP ${tur.code}${tur.bytes ? ` · ${Math.round(tur.bytes / 1024)}KB` : ''}`; break;
    case 'WebSearch': if (tur && Array.isArray(tur.results)) s = `결과 ${tur.results.length}묶음`; break;
    case 'Agent': case 'Task':
      if (tur && (tur.totalToolUseCount != null || tur.totalDurationMs != null)) s = `도구 ${tur.totalToolUseCount ?? 0}회 · ${Math.round((tur.totalDurationMs || 0) / 1000)}초`;
      else if (tur && tur.isAsync) s = '백그라운드 시작';
      break;
    case 'Skill': if (tur && tur.commandName) s = `${tur.commandName} 불러옴`; break;
    case 'Workflow': if (tur && tur.status) s = `${tur.status}${tur.runId ? ' · ' + tur.runId : ''}`; break;
    case 'TaskStop': s = '중지함'; break;
    default: break;
  }
  if (!s) s = lastLine(body).length < 100 ? lastLine(body) : String(body || '').split(/\r?\n/).find((l) => l.trim()) || '';
  if (!ok && exit == null && !/^오류|error/i.test(s)) s = '실패 · ' + s;
  return cut(s, BRIEF_LIMITS.result);
}

/** 말(assistant text) → 최근 문장 한두 개 */
export function textBrief(text, max = BRIEF_LIMITS.say) {
  const t = one(text);
  if (!t) return '';
  if (t.length <= max) return t;
  // 문장 끝(. ! ? 。 다/요 뒤 마침표)으로 나눠 뒤에서부터 채운다
  const parts = t.match(/[^.!?。]+[.!?。]+|[^.!?。]+$/g) || [t];
  let out = '';
  for (let i = parts.length - 1; i >= 0 && i >= parts.length - 2; i--) {
    const cand = (parts[i].trim() + (out ? ' ' + out : '')).trim();
    if (cand.length > max) break;
    out = cand;
  }
  return out || '…' + t.slice(t.length - (max - 1));
}
