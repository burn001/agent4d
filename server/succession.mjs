// /clear 승계 — 같은 프로세스가 /clear 로 새 sessionId 를 시작해도 살아 있는 백그라운드 작업(서브에이전트·워크플로·
// 백그라운드 Bash·Monitor)은 그대로 돈다. 그 작업을 띄운 tool_use 는 옛 세션 transcript 에만 있으므로, 새 세션 런타임이 옛 기록을
// 읽어 '/clear 시각에 아직 끝나지 않은 작업'을 골라 새 메인 아래로 이어 붙인다(노드 id 는 그대로, meta.inheritedFrom = 옛 sid).
// 판정은 기록만 본다(라이브·재생·보관함이 같은 답). 프로세스 PID 는 쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import {
  isTaskNotification, parseTaskNotification, textOfContent, inferToolUseResult, extractOutputPath, normPath, detectClaudeP,
} from './parse.mjs';

/** 승계 사슬 최대 깊이(/clear 를 연달아 한 경우 옛옛 세션까지) */
export const INHERIT_MAX_DEPTH = 3;
/** 옛 세션 꼬리의 '/clear' 대기열 기록과 새 세션 /clear 기록 사이 허용 간격 */
export const CLEAR_MATCH_MS = 15_000;
const TAIL_BYTES = 64 * 1024;

/** transcript 기록 하나가 /clear 로 시작한 세션 표지인지(새 세션 머리) */
export function isClearRecord(r) {
  if (!r || typeof r !== 'object') return false;
  if (r.type === 'system' && r.subtype === 'local_command' && r.commandRun && r.commandRun.command === 'clear') return true;
  const at = r.attachment;
  if (r.type === 'attachment' && at && at.type === 'hook_success' && at.hookName === 'SessionStart:clear') return true;
  if (r.type === 'user' && !r.isMeta) {
    const c = r.message?.content;
    const s = typeof c === 'string' ? c : Array.isArray(c) ? (c.find((x) => x?.type === 'text')?.text || '') : '';
    if (/<command-name>\/clear<\/command-name>/.test(s)) return true;
  }
  return false;
}

/** 옛 세션 꼬리 글에서 '/clear' 를 대기열에 넣은 시각들(ms) */
export function clearEnqueueTimes(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.includes('"queue-operation"') || !line.includes('/clear')) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.type === 'queue-operation' && r.operation === 'enqueue' && String(r.content || '').trim() === '/clear') {
      const t = Date.parse(r.timestamp);
      if (Number.isFinite(t)) out.push(t);
    }
  }
  return out;
}

function lastTsOf(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /"timestamp":"([^"]+)"/.exec(lines[i]);
    if (m && Number.isFinite(Date.parse(m[1]))) return Date.parse(m[1]);
  }
  return NaN;
}

async function readTailText(file, size, max = TAIL_BYTES) {
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
    const st = size ?? (await fh.stat()).size;
    const start = Math.max(0, st - max);
    const buf = Buffer.allocUnsafe(st - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    return buf.toString('utf8', 0, bytesRead);
  } catch { return ''; } finally { await fh?.close().catch(() => {}); }
}

/**
 * /clear 앞 세션(옛 메인). 새 세션 머리에 /clear 표지(head.clearAt)가 있을 때만. 후보 = 같은 프로젝트 폴더·같은 cwd 의
 * cli 세션 중 첫 기록이 /clear 앞인 것. 꼬리에 '/clear' 대기열 기록이 /clear 시각 15초 안에 있으면 그것(가장 가까운 것),
 * 없으면 마지막 기록이 /clear 앞 15초 안인 것(약한 근거). 결과는 항목에 캐시.
 * @returns {Promise<{entry, clearMs, evidence:string}|null>}
 */
export async function findClearPredecessor(index, e) {
  if (!index || !e) return null;
  const h = await index.ensureHead(e);
  if (!h || !h.clearAt) return null;
  const clearMs = Date.parse(h.clearAt);
  if (!Number.isFinite(clearMs)) return null;
  if (e._pred && e._pred.clearMs === clearMs) return e._pred.res;
  let best = null, bestD = Infinity;
  for (const x of index.entries.values()) {
    if (x === e || x.sessionId === e.sessionId || x.projectDir !== e.projectDir) continue;
    if (!(x.mtimeMs >= clearMs - 60_000)) continue;
    const xh = await index.ensureHead(x);
    if (!xh || !xh.firstTs || xh.entrypoint === 'sdk-cli') continue;
    if (!(Date.parse(xh.firstTs) < clearMs)) continue;
    if (h.cwd && xh.cwd && normPath(h.cwd) !== normPath(xh.cwd)) continue;
    const tail = await readTailText(x.file, x.size);
    let d = Infinity, ev = null;
    for (const t of clearEnqueueTimes(tail)) {
      if (t <= clearMs + 2000 && clearMs - t <= CLEAR_MATCH_MS && Math.abs(clearMs - t) < d) { d = Math.abs(clearMs - t); ev = 'queue-clear'; }
    }
    if (!ev) {
      const lt = lastTsOf(tail);
      if (lt <= clearMs + 2000 && clearMs - lt <= CLEAR_MATCH_MS) { d = 100_000 + Math.abs(clearMs - lt); ev = 'last-record'; }
    }
    if (ev && d < bestD) { bestD = d; best = { entry: x, clearMs, evidence: ev }; }
  }
  e._pred = { clearMs, res: best };
  return best;
}

/** 같은 세션 사슬의 /clear 앞 세션들(가까운 것부터, 최대 INHERIT_MAX_DEPTH) */
export async function clearChain(index, e) {
  const out = [];
  let cur = e;
  const seen = new Set([e.sessionId]);
  for (let d = 0; d < INHERIT_MAX_DEPTH; d++) {
    const p = await findClearPredecessor(index, cur);
    if (!p || seen.has(p.entry.sessionId)) break;
    seen.add(p.entry.sessionId);
    out.push({ entry: p.entry, clearMs: p.clearMs, evidence: p.evidence }); // clearMs = 그 앞 세션이 끝난(다음 세션이 시작한) 시각
    cur = p.entry;
  }
  return out;
}

const SHELL = new Set(['Bash', 'PowerShell']);

/**
 * transcript 글(jsonl)에서 clearMs 에 아직 끝나지 않은 백그라운드 작업. carried = 앞 세션에서 넘어온 작업(이 기록의 끝 표지도 적용).
 * 끝 표지: 작업 알림(status 가 있으면 끝, Monitor 만료 이벤트), TaskStop·KillShell, 동기 Agent 결과, 시한 있는 Monitor 의 만료 시각.
 * @returns {Array<{kind:'agent'|'bash'|'monitor'|'workflow', id, owner, ts, toolUseId, description, from, ...}>} 띄운 순
 */
export function openTasksAt(text, clearMs, { carried = [], from = null, owner = 'main' } = {}) {
  const open = new Map(); // key(kind:id) → item
  for (const it of carried) open.set(`${it.kind}:${it.id}`, it);
  const tools = new Map();
  const ended = new Set();
  const endIds = (ids) => { for (const x of ids) if (x && !String(x).startsWith('__')) ended.add(String(x)); };
  const onNote = (s) => {
    const n = parseTaskNotification(s);
    const ids = n.taskIds && n.taskIds.length ? n.taskIds : n.taskId ? [n.taskId] : [];
    if (n.status || /^\[Monitor expired/.test(n.event || '')) endIds(ids);
  };
  for (const line of String(text || '').split('\n')) {
    if (!line || line.startsWith('{"type":"api-request')) continue;
    if (!(line.includes('tool_use') || line.includes('task-notification'))) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const tsMs = Date.parse(r.timestamp);
    if (Number.isFinite(tsMs) && tsMs > clearMs + 2000) break; // /clear 뒤 기록(같은 파일을 이어 쓴 경우)은 보지 않는다
    const ts = r.timestamp || null;
    if (r.type === 'attachment') {
      const at = r.attachment;
      if (at && at.type === 'queued_command' && isTaskNotification(at.prompt)) onNote(at.prompt);
      continue;
    }
    const c = r.message?.content;
    if (r.type === 'user' && typeof c === 'string') { if (isTaskNotification(c)) onNote(c); continue; }
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b || typeof b !== 'object') continue;
      if (r.type === 'assistant' && b.type === 'tool_use' && b.id) {
        const input = b.input && typeof b.input === 'object' ? b.input : {};
        tools.set(b.id, { name: b.name, input, ts });
        if (b.name === 'TaskStop' || b.name === 'KillShell') endIds([input.task_id || input.shell_id]);
      } else if (r.type === 'user' && b.type === 'text' && isTaskNotification(b.text)) {
        onNote(b.text);
      } else if (r.type === 'user' && b.type === 'tool_result') {
        const tu = tools.get(b.tool_use_id);
        if (!tu || b.is_error) continue;
        const body = textOfContent(b.content);
        const tur = r.toolUseResult && typeof r.toolUseResult === 'object' ? r.toolUseResult : inferToolUseResult(tu.name, body);
        if (!tur) continue;
        const base = { owner, ts: tu.ts || ts, toolUseId: b.tool_use_id, description: tu.input.description ? String(tu.input.description).slice(0, 200) : null, from };
        if ((tu.name === 'Agent' || tu.name === 'Task') && tur.agentId) {
          if (tur.isAsync || tur.status === 'async_launched') {
            open.set(`agent:${tur.agentId}`, { ...base, kind: 'agent', id: tur.agentId, agentType: tu.input.subagent_type || null,
              description: base.description || tur.description || null });
          } else ended.add(String(tur.agentId));
        } else if (SHELL.has(tu.name) && tur.backgroundTaskId) {
          const command = typeof tu.input.command === 'string' ? tu.input.command : '';
          open.set(`bash:${tur.backgroundTaskId}`, { ...base, kind: 'bash', id: tur.backgroundTaskId, tool: tu.name, command: command.slice(0, 2000),
            outputFile: extractOutputPath(body), bodyText: body.slice(0, 2000), timedOutAfterMs: tur.timedOutAfterMs ?? null,
            claudeP: !!detectClaudeP(command), runInBackground: !!tu.input.run_in_background });
        } else if (tu.name === 'Monitor' && tur.taskId) {
          open.set(`monitor:${tur.taskId}`, { ...base, kind: 'monitor', id: tur.taskId,
            command: typeof tu.input.command === 'string' ? tu.input.command.slice(0, 2000) : null,
            timeoutMs: tur.timeoutMs ?? tu.input.timeout_ms ?? null, persistent: !!(tur.persistent ?? tu.input.persistent) });
        } else if (tu.name === 'Workflow' && tur.runId) {
          open.set(`workflow:${tur.runId}`, { ...base, kind: 'workflow', id: tur.runId, taskId: tur.taskId || null, name: tur.workflowName || tu.input.name || null });
        }
      }
    }
  }
  const out = [];
  for (const it of open.values()) {
    if (ended.has(String(it.id)) || (it.taskId && ended.has(String(it.taskId)))) continue;
    if (it.kind === 'monitor' && !it.persistent && it.timeoutMs && Date.parse(it.ts) + it.timeoutMs <= clearMs) continue;
    out.push(it);
  }
  return out.sort((a, b) => (Date.parse(a.ts) || 0) - (Date.parse(b.ts) || 0));
}

/** 서브에이전트 기록 파일(세션 폴더 사슬 중 있는 것) */
export function agentFileIn(projectPath, sessionId, agentId) {
  return path.join(projectPath, sessionId, 'subagents', `agent-${agentId}.jsonl`);
}

/**
 * 새 세션 e 가 이어받을 작업 목록과 사슬. 메인 기록 → (열린 서브에이전트 기록 → 그 안의 열린 작업, 재귀 3단) 순.
 * 끝 표지는 각 기록 안에서만 본다(이어받은 뒤 끝나면 새 세션 기록의 알림으로 끝난다).
 * @returns {Promise<{chain:[{sessionId, clearMs, evidence}], items:[…]}>}
 */
export async function inheritPlan(index, e) {
  const chain = await clearChain(index, e);
  if (!chain.length) return { chain: [], items: [] };
  const read = async (f) => { try { return await fs.promises.readFile(f, 'utf8'); } catch { return ''; } };
  // 가장 오래된 앞 세션부터: 그 세션이 끝난 시각(= 다음 세션 /clear)에 열린 것 → 다음 세션 기록의 끝 표지 적용 → …
  let carried = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const c = chain[i];
    carried = openTasksAt(await read(c.entry.file), c.clearMs, { carried, from: c.entry.sessionId });
  }
  const nearest = chain[0];
  const finalClear = nearest.clearMs;
  // 열린 서브에이전트 안의 열린 작업(서브에이전트가 띄운 Bash·Monitor·하위 에이전트). 그 기록은 옛 세션 폴더 사슬에 나뉘어 있다
  const items = [...carried];
  const queue = items.filter((x) => x.kind === 'agent').map((x) => ({ id: x.id, depth: 1 }));
  const seen = new Set(queue.map((q) => q.id));
  while (queue.length) {
    const q = queue.shift();
    let text = '';
    for (let i = chain.length - 1; i >= 0; i--) text += (await read(agentFileIn(chain[i].entry.projectPath, chain[i].entry.sessionId, q.id))) + '\n';
    const sub = openTasksAt(text, finalClear, { from: nearest.entry.sessionId, owner: `a:${q.id}` });
    for (const s of sub) {
      items.push(s);
      if (s.kind === 'agent' && q.depth < INHERIT_MAX_DEPTH && !seen.has(s.id)) { seen.add(s.id); queue.push({ id: s.id, depth: q.depth + 1 }); }
    }
  }
  return { chain: chain.map((c) => ({ sessionId: c.entry.sessionId, projectPath: c.entry.projectPath, clearMs: c.clearMs, evidence: c.evidence })), items };
}

/** 이어받은 서브에이전트의 meta.json(옛 세션 폴더 사슬에서 가장 가까운 것) */
export async function agentMetaFromChain(chain, agentId) {
  for (const c of chain) {
    try { return JSON.parse(await fs.promises.readFile(path.join(c.projectPath, c.sessionId, 'subagents', `agent-${agentId}.meta.json`), 'utf8')); } catch {}
  }
  return null;
}
