// 계획 승인(ExitPlanMode)·도구 권한 확인(can_use_tool: Bash·Write·Edit…) 창에 Agent4D 화면에서 답하기 — 순수 부분(파일·네트워크 없음).
// 브리지 이벤트에서 열린 요청 고르기 · 화면용 요약(글은 redact·길이 상한) · 위험 명령 판정 · control_response 본문 만들기.
// 근거(Claude Code 2.1.318 번들 + 2026-11-06 시험 세션 실측):
//  · 요청  control_request {subtype:'can_use_tool', tool_name, display_name, input, tool_use_id, description, permission_suggestions?, requires_user_interaction?}
//          ExitPlanMode 는 input = {plan, planFilePath}(번들이 계획 파일에서 plan 을 채움 — transcript 의 tool_use input 은 {} 일 수 있음)
//  · 응답  번들 브리지 스키마 {behavior:'allow'|'deny', updatedInput?, updatedPermissions?, message?, toolName?} (+ toolUseID)
//          toolName 이 열린 요청과 다르면 무시(번들 k4e) · allow 의 updatedInput 이 원래 input 과 다르면 "Nothing ran"(번들 z7 깊은 비교) → 원래 input 그대로 보낸다
//          deny + message → 도구 결과 "The user doesn't want to proceed … the user said:\n<message>"(실측: Write·Bash·ExitPlanMode)
//  · updatedPermissions(항상 허용 규칙 addRules·setMode acceptEdits 등)는 **보내지 않는다**(원격에서 영구·세션 권한을 바꾸지 않음)
import { redact } from './redact.mjs';
import { splitCommand } from './interactions.mjs';

export const PERM_LIMITS = { plan: 6000, cmd: 2000, desc: 200, path: 400, preview: 600, json: 600, msg: 2000 };
const L = PERM_LIMITS;
export const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
export const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
export const DENY_DEFAULT = 'Denied from Agent4D.';

const cut = (s, n) => { s = redact(String(s ?? '')).replace(/\r\n?/g, '\n'); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const one = (s, n) => cut(String(s ?? '').replace(/\s+/g, ' ').trim(), n);
const payloadOf = (e) => (e && typeof e === 'object' ? (e.payload && typeof e.payload === 'object' ? e.payload : e) : null);

/**
 * 이벤트들 → 아직 답 없는 계획·권한 요청(tool_use_id → {requestId, tool, input, toolUseId}). AskUserQuestion 은(rc-answer pendingAsks) 몫이라 뺀다.
 * initialize 응답 안의 pending_permission_requests(스냅숏)는 보지 않는다 — 맨 위 control_request·control_response·control_cancel_request 짝만
 */
export function pendingPerms(events) {
  const reqs = new Map(); const done = new Set();
  for (const e of events || []) {
    const p = payloadOf(e);
    if (!p) continue;
    if (p.type === 'control_request' && typeof p.request_id === 'string' && p.request?.subtype === 'can_use_tool' && typeof p.request.tool_name === 'string' && p.request.tool_name !== 'AskUserQuestion') reqs.set(p.request_id, p.request);
    else if (p.type === 'control_response' && typeof p.response?.request_id === 'string') done.add(p.response.request_id);
    else if (p.type === 'control_cancel_request' && typeof p.request_id === 'string') done.add(p.request_id);
  }
  const out = new Map();
  for (const [rid, rq] of reqs) {
    if (done.has(rid) || typeof rq.tool_use_id !== 'string' || !rq.tool_use_id) continue;
    out.set(rq.tool_use_id, { requestId: rid, tool: rq.tool_name, input: rq.input && typeof rq.input === 'object' ? rq.input : {}, toolUseId: rq.tool_use_id });
  }
  return out;
}

// ── 위험 명령 판정(권한 카드 경고 · 허용 두 번 누르기) ──
// 코드: delete(삭제류) · force_push · git_reset(reset --hard·checkout/restore 로 버리기) · git_clean · disk(포맷·dd) · system(종료·재부팅·레지스트리 삭제·실행 정책)
//       kill(프로세스 종료) · perm(재귀 권한 변경) · sudo · remote_exec(내려받아 바로 실행) · db_drop(DROP·TRUNCATE) · sensitive_path(자격·설정 파일 쓰기) · publish
const DEL_PROGS = new Set(['rm', 'rmdir', 'rd', 'del', 'erase', 'unlink', 'shred', 'trash', 'remove-item', 'ri', 'srm', 'wipe']);
const KILL_PROGS = new Set(['kill', 'pkill', 'killall', 'taskkill', 'stop-process', 'spps', 'tskill']);
const SYS_PROGS = new Set(['shutdown', 'reboot', 'halt', 'poweroff', 'stop-computer', 'restart-computer', 'set-executionpolicy', 'bcdedit', 'diskpart', 'format-volume', 'clear-disk', 'initialize-disk']);
const DISK_PROGS = new Set(['mkfs', 'dd', 'format', 'fdisk', 'parted', 'wipefs', 'cipher']);
const PERM_PROGS = new Set(['chmod', 'chown', 'chgrp', 'icacls', 'takeown', 'cacls', 'set-acl']);
const SENSITIVE_RE = /(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg|\.kube|\.docker)(?:[\\/]|$)|(?:^|[\\/])\.env(?:\.[\w-]+)?$|(?:^|[\\/])\.claude[\\/]settings(?:\.local)?\.json$|(?:^|[\\/])\.claude\.json$|\.credentials\.json$|(?:^|[\\/])id_(?:rsa|ed25519|ecdsa)\b|(?:^|[\\/])(?:\.bashrc|\.zshrc|\.profile|\.bash_profile|\.gitconfig|\.npmrc|\.netrc)$|Microsoft\.PowerShell_profile\.ps1$|^\/etc\/|^[A-Za-z]:[\\/]Windows[\\/]|(?:^|[\\/])\.git[\\/](?:config|hooks[\\/])/i;
const DROP_RE = /\b(?:drop\s+(?:table|database|schema|collection|index)|truncate\s+table|dropDatabase\s*\(|\.drop\s*\(\s*\))/i;
const PIPE_EXEC_RE = /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|iex|invoke-expression|python3?|node|pwsh|powershell)\b/i;

function shellDanger(cmd) {
  const s = String(cmd || '');
  const out = new Set();
  let parsed;
  try { parsed = splitCommand(s); } catch { parsed = { cmds: [], bodies: [] }; }
  for (const c of parsed.cmds || []) {
    const p = c.prog, a = c.args || [], al = a.map((x) => String(x).toLowerCase());
    if (/^sudo$|^doas$|^runas$/.test(p) || /(?:^|\s)sudo\s/.test(c.raw || '')) out.add('sudo');
    if (DEL_PROGS.has(p)) out.add('delete');
    if (KILL_PROGS.has(p)) out.add('kill');
    if (SYS_PROGS.has(p)) out.add('system');
    if (DISK_PROGS.has(p)) out.add('disk');
    if (PERM_PROGS.has(p) && al.some((x) => x === '-r' || x === '--recursive' || x === '/t' || x === '-recurse')) out.add('perm');
    if (p === 'reg' && al[0] === 'delete') out.add('system');
    if (p === 'remove-itemproperty' || p === 'clear-content' || p === 'clear-item') out.add('delete');
    if (p === 'find' && al.some((x) => x === '-delete' || x === '-exec' && /\brm\b/.test(c.raw || ''))) out.add('delete');
    if (p === 'xargs' && /\brm\b/.test(c.raw || '')) out.add('delete');
    if (p === 'git') {
      let i = 0; while (i < al.length && al[i].startsWith('-')) i += /^-(c|C)$/.test(al[i]) ? 2 : 1;
      const sub = al[i], rest = al.slice(i + 1);
      if (sub === 'push' && rest.some((x) => x === '-f' || x === '--force' || x.startsWith('--force-with-lease') || x === '--mirror' || x === '--delete' || x === '-d' || /^\+/.test(x) || /^:[^/]/.test(x))) out.add('force_push');
      if (sub === 'reset' && rest.includes('--hard')) out.add('git_reset');
      if ((sub === 'checkout' || sub === 'restore') && (rest.includes('--') || rest.includes('.') || rest.includes('--force') || rest.includes('-f')) && !rest.includes('-b')) out.add('git_reset');
      if (sub === 'clean' && rest.some((x) => /^-\w*f/.test(x) || x === '--force')) out.add('git_clean');
      if (sub === 'branch' && (a.slice(i + 1).includes('-D') || (rest.includes('--delete') && rest.includes('--force')))) out.add('delete');
      if (sub === 'rm') out.add('delete');
      if (sub === 'stash' && (rest[0] === 'drop' || rest[0] === 'clear')) out.add('delete');
      if (sub === 'filter-branch' || sub === 'filter-repo') out.add('git_reset');
    }
    if (p === 'gh' && al.includes('delete')) out.add('delete');
    if ((p === 'npm' || p === 'pnpm' || p === 'yarn' || p === 'cargo' || p === 'twine') && (al[0] === 'publish' || al[0] === 'unpublish' || al[0] === 'upload')) out.add('publish');
    if ((p === 'docker' || p === 'podman') && (al[0] === 'rm' || al[0] === 'rmi' || (al[0] === 'system' && al[1] === 'prune') || (al[0] === 'volume' && al[1] === 'rm'))) out.add('delete');
    if (p === 'kubectl' && al[0] === 'delete') out.add('delete');
    if ((p === 'mongo' || p === 'mongosh' || p === 'psql' || p === 'mysql' || p === 'sqlite3') && DROP_RE.test(c.raw || '')) out.add('db_drop');
  }
  if (DROP_RE.test(s)) out.add('db_drop');
  if (PIPE_EXEC_RE.test(s)) out.add('remote_exec');
  // 안쪽 문자열 명령(bash -c "rm -rf …"·powershell -Command "Remove-Item …")도 한 번 더 — 글자 검사로
  if (/\brm\s+-\w*[rf]|\bRemove-Item\b|\bdel\s+\/[sq]|\brmdir\b|\brd\s+\/s/i.test(s)) out.add('delete');
  if (/\bgit\s+push\b[^\n;&|]*\s(?:-f|--force(?:-with-lease)?)\b/i.test(s)) out.add('force_push');
  if (/\bgit\s+reset\s+--hard\b/i.test(s)) out.add('git_reset');
  return [...out];
}

/** 도구 이름·input → 위험 코드 목록(빈 배열이면 평범) */
export function dangerOf(tool, input) {
  const x = input && typeof input === 'object' ? input : {};
  const name = String(tool || '');
  const out = new Set();
  if (SHELL_TOOLS.has(name)) for (const d of shellDanger(x.command)) out.add(d);
  if (FILE_TOOLS.has(name)) { const fp = String(x.file_path || x.notebook_path || ''); if (SENSITIVE_RE.test(fp)) out.add('sensitive_path'); }
  // MCP·기타 도구 이름에 삭제류가 들어 있으면(mcp__x__delete_file 등)
  if (!SHELL_TOOLS.has(name) && /(?:^|[_\W])(?:delete|remove|destroy|drop|purge|wipe|erase|truncate|rm)(?:[_\W]|$)/i.test(name.replace(/([a-z])([A-Z])/g, '$1_$2'))) out.add('delete');
  return [...out];
}

/** 열린 요청 → 화면 카드 모양(값은 redact·상한). kind 'plan'|'perm' */
export function permView(hit) {
  if (!hit) return null;
  const x = hit.input || {};
  const tool = one(hit.tool, 80);
  if (hit.tool === 'ExitPlanMode') {
    const md = typeof x.plan === 'string' ? redact(x.plan).replace(/\r\n?/g, '\n').trim() : '';
    return { kind: 'plan', toolUseId: hit.toolUseId, tool, md: md.slice(0, L.plan), ...(md.length > L.plan ? { cut: 1 } : {}) };
  }
  const v = { kind: 'perm', toolUseId: hit.toolUseId, tool, danger: dangerOf(hit.tool, x) };
  if (SHELL_TOOLS.has(hit.tool)) { v.cmd = cut(String(x.command ?? ''), L.cmd); if (x.description) v.desc = one(x.description, L.desc); }
  else if (FILE_TOOLS.has(hit.tool)) {
    v.path = one(x.file_path || x.notebook_path || '', L.path);
    if (hit.tool === 'Write' && typeof x.content === 'string') { v.preview = cut(x.content, L.preview); v.size = x.content.length; }
    else if (hit.tool === 'Edit') { if (typeof x.old_string === 'string') v.old = cut(x.old_string, L.preview); if (typeof x.new_string === 'string') v.preview = cut(x.new_string, L.preview); if (x.replace_all) v.all = 1; }
    else if (hit.tool === 'MultiEdit' && Array.isArray(x.edits)) v.edits = x.edits.length;
    else if (hit.tool === 'NotebookEdit' && typeof x.new_source === 'string') v.preview = cut(x.new_source, L.preview);
  } else if (typeof x.url === 'string') v.url = one(x.url, L.path);
  else { let j = ''; try { j = JSON.stringify(x); } catch {} v.json = cut(j, L.json); }
  return v;
}

/**
 * 결정 → control_response 본문(payload). allow = 원래 input 그대로(updatedInput) · deny = message(빈 글이면 DENY_DEFAULT).
 * updatedPermissions 는 넣지 않는다.
 */
export function permResponse(hit, decision, message = '') {
  const allow = decision === 'allow';
  const msg = String(message || '').replace(/\r\n/g, '\n').trim().slice(0, L.msg);
  const inner = allow
    ? { behavior: 'allow', updatedInput: hit.input || {}, toolUseID: hit.toolUseId, toolName: hit.tool }
    : { behavior: 'deny', message: msg || DENY_DEFAULT, toolUseID: hit.toolUseId, toolName: hit.tool };
  return { type: 'control_response', response: { subtype: 'success', request_id: hit.requestId, response: inner } };
}
