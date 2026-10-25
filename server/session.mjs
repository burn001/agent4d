// 세션 루트 하나(메인 + 그 아래 전부)의 수집 런타임
import fs from 'node:fs';
import path from 'node:path';
import { Graph } from './graph.mjs';
import { toolBrief, resultBrief, textBrief } from './brief.mjs';
import { redact } from './redact.mjs';
import { inputPanel, resultPanel, tailPanel, sayPanel, progressPanel, sanitizePanel, LineTail, splitLines, stripAnsi, PANEL_LIMITS } from './panel.mjs';
import { FileTail } from './tail.mjs';
import { findTaskOutput, claudeTmpRoots } from './discovery.mjs';
import { CtxTracker } from './ctx.mjs';
import { baseName, guessPathFromId, isTempPath } from './projects.mjs';
import {
  toolCategory, summarizeToolInput, summarizeToolResult, textOfContent, isTaskNotification,
  parseTaskNotification, detectClaudeP, extractSessionIds, extractOutputPath, encodeCwd, normPath,
  resolveCwdGuess, userTextSummary, isoOr, oneLine, stripTags, inferToolUseResult, promptMatches, scratchOwnerOf,
  isEndedStatus as isEnded, isKillCommand, SIGNAL_EXIT, exitCodeOf, STOP_WINDOW_MS, STOP_LEAD_MS, stopReasonOfNotification,
} from './parse.mjs';
import { detectLaunch, analyzeLaunch, launcherIndexOf } from './launcher.mjs';
import { inheritPlan, agentMetaFromChain, agentFileIn } from './succession.mjs'; // /clear 승계
import { toolFileRefs, msgTo } from '../web/conflict-core.mjs';
import { createHash } from 'node:crypto';
import { artStart, artEnd } from './artifacts.mjs'; // 작업 대상 층
import { PlanTracker, planStart } from './plans.mjs'; // 계획 보드
import { classifyStart, classifyEnd, outputProgress, IxTracker, classifyUserMessage, USER_DENY_RE, ixSnip } from './interactions.mjs'; // 특별 상호작용
import { JobBook, loadJobRules, jobNodeId, jobNodeStatus, jobLabel, isJobEnded, setMatchesProject } from './jobs.mjs'; // 작업 오브젝트
import { ccvizHome } from './home.mjs';

const SHELL = new Set(['Bash', 'PowerShell']);
const SESSION_KINDS = new Set(['main', 'claude-p']);
/** 서브에이전트 진행 → 부모 Agent 패널 갱신 간격(같은 패널은 이 안에서 합침) */
export const PANEL_MERGE_MS = 250;
const IDLE_MS = 60_000;
const EPOCH = '1970-01-01T00:00:00.000Z';
const OFFLINE_OUTPUT_MAX = 1 << 20; // offline: 출력 파일 꼬리 1MB
export const TOOLS_MAX = 5000; // 라이브 tools Map 상한(넘으면 TOOLS_KEEP 까지 오래된 끝난 항목 삭제)
export const TOOLS_KEEP = 4000;
/** 기동기 아래 끝난 회차를 노드로 남기는 수(나머지는 meta.batch 집계로만) */
export const BATCH_KEEP_ENDED = 2;

/**
 * 메인 세션 노드의 역할 표기 "메인 · <프로젝트 이름>". 이름은 /projects 와 같은 baseName 규칙(뒤 구간, 짧은 구간 보정,
 * 임시 폴더는 '(임시) ')을 쓰되 프로젝트 간 겹침 보정은 하지 않는다(세션 하나만 보고 정해야 라이브·재생이 같다).
 */
/** cwd 가 git worktree 안이면 그 이름(…/.claude/worktrees/<이름>, …/worktrees/<이름>), 아니면 null */
export function worktreeOf(cwd) {
  const m = cwd && /[\\/](?:\.claude[\\/])?worktrees[\\/]([^\\/]+)/i.exec(String(cwd));
  return m ? redact(m[1]).slice(0, 60) : null;
}

export function mainRoleLabel(cwd, projectDir) {
  const p = cwd ? String(cwd).replace(/[\\/]+$/, '') : null;
  const name = p ? baseName(p) : projectDir ? baseName(guessPathFromId(projectDir)) : '';
  if (!name) return '메인';
  return `메인 · ${isTempPath(p, projectDir || '') ? '(임시) ' : ''}${name}`;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * claude -p 세션의 프로젝트 { path, temp }. cwd 가 어떤 세션의 임시 폴더(<tmp>/claude/<enc>/<sid>/…)면 그 부모 세션의
 * 프로젝트(색인에 head 가 있으면 그 cwd, 없으면 <enc> 역추정)를 따른다. cwd 가 없으면 폴더 id(임시 폴더 인코딩이면 그 안의 <enc>).
 * lookup(sid) → 그 세션의 { cwd, projectDir } 또는 null.
 */
export function claudePProject(cwd, projectDir, lookup = null, depth = 0) {
  const p = cwd ? String(cwd).replace(/[\\/]+$/, '') : null;
  if (p) {
    const psid = scratchOwnerOf(p, claudeTmpRoots());
    if (psid) {
      const par = depth < 4 && lookup ? lookup(psid) : null;
      if (par && (par.cwd || par.projectDir)) return claudePProject(par.cwd, par.projectDir, lookup, depth + 1);
      const segs = p.split(/[\\/]+/);
      const i = segs.findIndex((s) => s.toLowerCase() === psid);
      if (i > 0) return { path: guessPathFromId(segs[i - 1]), temp: false };
    }
    return { path: p, temp: isTempPath(p, projectDir || '') };
  }
  if (projectDir) {
    // 임시 scratchpad 폴더 id: C--Users-…-Temp-claude-<enc>-<sid>-scratchpad…
    const m = new RegExp(`-claude-(.+?)-${UUID_RE.source}(?:-|$)`, 'i').exec(projectDir);
    if (m && isTempPath(null, projectDir)) return { path: guessPathFromId(m[1]), temp: false };
    return { path: guessPathFromId(projectDir), temp: isTempPath(null, projectDir) };
  }
  return null;
}

const projName = (pr) => (pr?.path ? `${pr.temp ? '(임시) ' : ''}${baseName(pr.path)}` : '');
const projKey = (pr) => (pr?.path ? normPath(pr.path) : '');

/**
 * claude -p 노드 label. 독립 루트(parentProject 없음): `claude -p · <프로젝트>`.
 * 자식: 형제 구분을 위해 항상 sid8 로 끝나고, 부모 세션과 프로젝트가 같으면 `claude -p · <sid8>`, 다르면 `claude -p · <프로젝트> · <sid8>`.
 */
export function claudePLabel(sessionId, project, parentProject = undefined) {
  const sid8 = String(sessionId || '').slice(0, 8);
  const name = projName(project);
  if (parentProject === undefined) return name ? `claude -p · ${name}` : `claude -p · ${sid8}`;
  if (!name || projKey(project) === projKey(parentProject)) return `claude -p · ${sid8}`;
  return `claude -p · ${name} · ${sid8}`;
}

/** meta.title(부제): aiTitle 또는 첫 프롬프트 요약. 마스킹 후 자른다 */
export const sessionTitleMeta = (s) => {
  const v = redact(oneLine(String(s || '')));
  return v.length > 120 ? v.slice(0, 119) + '…' : v;
};

/**
 * 러너: 기동기 스크립트 사슬(via, 첫 스크립트 → … → claude -p 가 든 파일)에서 claude -p 를 부르는 파일이 첫 스크립트와
 * 다르면 그 파일이 러너(재기동기 → 러너 → 회차). 같은 파일이면 null(기동기가 곧 러너 — 노드를 따로 두지 않음)
 */
export function runnerScriptOf(via, script) {
  if (!Array.isArray(via) || via.length < 2) return null;
  const last = String(via[via.length - 1] || '').split(/[\\/]/).pop();
  return last && last !== script ? last : null;
}

/** 러너 한 번 기동(인스턴스) 표지 = 회차 첫 프롬프트의 첫 비어 있지 않은 줄(러너가 기동 때 정한 프롬프트 머리, 기록에 남음), 숫자는 # 로 */
export function runnerSigOf(prompt) {
  const line = String(prompt || '').split(/\r?\n/).map((x) => x.trim()).find(Boolean) || '';
  // 회차 번호 같은 숫자만 바뀌는 머리는 같은 러너로 본다
  return line.replace(/\s+/g, ' ').replace(/\d+/g, '#').slice(0, 300);
}

const maxIso = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));
const log = (...a) => { if (process.env.CCVIZ_DEBUG) console.error('[ccviz]', ...a); };

/** 세션(메인 또는 claude -p 자식) 하나의 파일 탐색 상태 */
class SessionWatcher {
  constructor(rt, { sessionId, file, nodeId, kind }) {
    this.rt = rt;
    this.sessionId = sessionId;
    this.file = file;
    this.nodeId = nodeId;
    this.kind = kind;
    this.projectPath = path.dirname(file);
    this.subagentsDir = path.join(this.projectPath, sessionId, 'subagents');
    this.cwd = null;
    this.tasksDirs = new Set();
    this.metaMtimes = new Map();
    this.tail = null;
  }

  async scan() {
    const rt = this.rt;
    let ents = [];
    try { ents = await fs.promises.readdir(this.subagentsDir, { withFileTypes: true }); } catch { return; }
    await this._scanAgentDir(this.subagentsDir, ents.filter((e) => e.isFile()).map((e) => e.name), null);
    if (ents.some((e) => e.isDirectory() && e.name === 'workflows')) {
      const wdir = path.join(this.subagentsDir, 'workflows');
      let runs = [];
      try { runs = await fs.promises.readdir(wdir, { withFileTypes: true }); } catch {}
      for (const r of runs) {
        if (!r.isDirectory()) continue;
        await this.scanRun(path.join(wdir, r.name), r.name);
      }
    }
  }

  /** 워크플로 실행 폴더 하나(저널 + 에이전트 기록) */
  async scanRun(rdir, runId) {
    const rt = this.rt;
    rt.ensureWorkflow(this, runId, {});
    const journal = path.join(rdir, 'journal.jsonl');
    if (!rt.tails.has(journal)) {
      rt.addTail(journal, new FileTail(journal, {
        onLine: (rec, info) => rt.onJournal(this, runId, rec, info),
      }));
    }
    let files = [];
    try { files = await fs.promises.readdir(rdir); } catch {}
    await this._scanAgentDir(rdir, files, runId);
  }

  async _scanAgentDir(dir, files, runId) {
    const rt = this.rt;
    for (const f of files) {
      const m = /^agent-([A-Za-z0-9_-]+)\.meta\.json$/.exec(f);
      if (!m) continue;
      const p = path.join(dir, f);
      let st; try { st = await fs.promises.stat(p); } catch { continue; }
      if (this.metaMtimes.get(p) === st.mtimeMs) continue;
      this.metaMtimes.set(p, st.mtimeMs);
      let meta = null;
      try { meta = JSON.parse(await fs.promises.readFile(p, 'utf8')); } catch { this.metaMtimes.delete(p); continue; }
      rt.onAgentMeta(this, m[1], meta, runId);
    }
    for (const f of files) {
      const m = /^agent-([A-Za-z0-9_-]+)\.jsonl$/.exec(f);
      if (!m) continue;
      rt.tailAgent(this, m[1], path.join(dir, f), runId);
    }
  }
}

/**
 * 회차 목록(시작 순)의 asOf 시점 집계. asOf=Infinity 면 지금 상태 그대로, 아니면 그때까지 시작한 회차만 보고
 * 그 뒤에 끝난 회차는 '진행'으로 센다(재생 시간축 집계).
 */
export function batchOf(items, asOf = Infinity) {
  const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
  const seen = items.filter((it) => asOf === Infinity || it.startMs <= asOf);
  let running = 0, done = 0, stopped = 0, failed = 0, durSum = 0, durN = 0, current = null, last = 0;
  const view = seen.map((it) => {
    const ended = isEnded(it.status) && (asOf === Infinity || (Number.isFinite(it.endMs) && it.endMs <= asOf));
    const status = ended ? it.status : (asOf === Infinity ? it.status : 'active');
    const endMs = ended ? (it.endMs ?? null) : null;
    if (status === 'done') done++;
    else if (status === 'stopped') stopped++;
    else if (status === 'error') failed++;
    else { running++; current = it.sessionId; }
    if (endMs && ended) { durSum += endMs - it.startMs; durN++; }
    if (it.startMs > last) last = it.startMs;
    return { sessionId: it.sessionId, nodeId: it.nodeId, status, startedAt: iso(it.startMs), endedAt: iso(endMs ?? NaN) };
  });
  return {
    total: seen.length, running, done, stopped, failed, collapsed: seen.filter((x) => !x.nodeId).length,
    currentCycleId: current, lastCycleAt: iso(last || NaN), avgDurationMs: durN ? Math.round(durSum / durN) : null,
    recent: view.slice(-5),
  };
}

export class RootRuntime {
  /**
   * @param {{sessionId:string, index:any, privacy?:string, maxDepth?:number, offline?:boolean}} opts
   *  offline: 재생 재구성용. 타이머 없음, 시계 = 지금까지 처리한 레코드의 최대 시각,
   *  그래프는 keepAll·지역 seq, 출력 파일은 원문 조각만 보관(시각 배분은 replay.mjs 후처리).
   */
  constructor({ sessionId, index, privacy = 'summary', maxDepth = 8, offline = false, jobRules = undefined }) {
    this.sessionId = sessionId;
    this.privacy = privacy;
    // 작업 규칙: undefined = 사용자·프로젝트 jobs.json 을 읽음, null = 대체 규칙 없음(규약 줄만), 객체 = compileJobRules 결과
    this._jobRulesOpt = jobRules;
    this.index = index;
    this.maxDepth = maxDepth;
    this.offline = !!offline;
    this._clockIso = null; // offline 시계
    this.graph = this.offline
      ? new Graph({ rootSessionId: sessionId, privacy, keepAll: true, localSeq: true, now: () => this.nowIso() })
      : new Graph({ rootSessionId: sessionId, privacy });
    this.spawnHints = new Map(); // offline: nodeId → 생성 계기 tool_use 시각(ISO)
    this.deferred = []; // offline: 탐색 루프가 끝난 뒤 처리할 종료 판정
    this.childWindow = null; // offline: [sinceMs, untilMs] claude -p 후보 창
    this.tools = new Map(); // toolUseId → {owner, name, cat, ts, tsMs, input, watcher}
    this.waitParent = new Map(); // toolUseId → Set(nodeId) 부모를 기다리는 노드
    this.agentToolUse = new Map(); // agentId → Agent tool_use id
    this.taskMap = new Map(); // taskId → nodeId (workflow/bash-bg/monitor)
    this.pendingNotif = new Map(); // id → [{n, ts}]
    this.pendingFinish = new Map(); // nodeId → {ok, text, ts}
    this.seenNotif = new Map(); // 알림 중복 제거 key → ts
    this.killCmds = [];         // 끄는 셸 명령 시각(ms) — '중지됨' 판정
    this._failed = new Map();   // failed 로 끝난 백그라운드 작업 nodeId → {ev, endMs, startMs} (늦게 본 끄는 명령으로 고치기)
    this.outputs = new Map(); // nodeId → output 상태
    this.children = []; // claude -p 대기 목록
    this.launchNodes = new Map(); // 기동기: 기동 tool_use id(인계는 adopt:<id>) → {nodeId, tsMs, key, script, cwd, watcher, owner, projectDir, cycles}
    this.launcherByNode = new Map(); // 기동기 노드 id → 위 레코드
    this.runnerByNode = new Map(); // 러너 노드 id → {nodeId, k, sig, L, cycles:Set<sid>}
    // claude -p 프로젝트 해석용: sid → { cwd, projectDir } (색인에 head 가 읽혀 있는 것만)
    this.lookupSession = (sid) => { const x = this.index.findSession?.(sid); return x ? { cwd: x.head?.cwd ?? null, projectDir: x.projectDir ?? null } : null; };
    this.watchers = new Map(); // sessionId → SessionWatcher
    this.tails = new Map(); // file → FileTail
    this.childTails = new Map(); // nodeId(claude-p) → FileTail
    this.timers = [];
    this.refs = 0;
    this.lastUsed = Date.now();
    this.closed = false;
    this._polling = false;
    this._scanning = false;
    this.ready = null;
  }

  // ───────────── 기동·루프 ─────────────

  start() {
    if (!this.ready) this.ready = this._load();
    return this.ready;
  }

  async _load() {
    await this._loadCore();
    for (const fn of this.deferred.splice(0)) { try { fn(); } catch (e) { log('deferred', e); } }
    for (const o of this.outputs.values()) this._flushOutput(o);
    this.graph.finishLoad();
    this.sweep();
    this.timers.push(setInterval(() => this.pollAll(), 500));
    this.timers.push(setInterval(() => this.scanAll(), 2000));
    this.timers.push(setInterval(() => this.sweep(), 5000));
    return this;
  }

  /** offline 적재: 탐색 루프만 돌고 끝낸다(타이머 없음). 끝나면 파일 tail 은 닫는다. */
  async loadOffline() {
    if (!this.offline) throw new Error('loadOffline requires offline:true');
    if (!this.ready) {
      this.ready = (async () => {
        await this._loadCore();
        for (const fn of this.deferred.splice(0)) { try { fn(); } catch (e) { log('deferred', e); } }
        this.graph.finishLoad();
        this.sweepFrom = this.graph.ring.length; // 이후 이벤트는 합성(대기·만료)
        this.sweep();
        this.closed = true;
        for (const t of this.tails.values()) t.close();
        return this;
      })();
    }
    return this.ready;
  }

  async _loadCore() {
    let e = this.index.findSession(this.sessionId);
    if (!e) { await this.index.refresh(); e = this.index.findSession(this.sessionId); }
    if (!e) throw Object.assign(new Error('session not found'), { code: 'ENOSESSION' });
    const head = await this.index.ensureHead(e);
    await this.index.ensureTitle(e).catch(() => {});
    const startTs = head.firstTs || new Date(e.birthtimeMs || e.mtimeMs).toISOString();
    if (this.offline) {
      this._clockIso = startTs;
      const s0 = Date.parse(startTs) || e.mtimeMs;
      this.childWindow = [s0 - 3600_000, Math.max(e.mtimeMs, s0) + 3600_000];
    }
    const isSdk = (head.entrypoint || this.index.procs?.get?.(this.sessionId)?.entrypoint) === 'sdk-cli';
    // 메인 라벨: customTitle > 역할 표기(독립 sdk-cli 는 "claude -p · <프로젝트>", 그 밖은 "메인 · <프로젝트>").
    // aiTitle·첫 프롬프트는 meta.title
    if (isSdk && head.cwd) { const ps = scratchOwnerOf(head.cwd, claudeTmpRoots()); const pe = ps && this.index.findSession(ps); if (pe) await this.index.ensureHead(pe).catch(() => {}); }
    const label = e.customTitle ? e.customTitle
      : isSdk ? claudePLabel(this.sessionId, claudePProject(head.cwd, e.projectDir, this.lookupSession))
      : mainRoleLabel(head.cwd, e.projectDir);
    // 첫 프롬프트는 부제·제목으로 내보내지 않는다(사용자: "not cool") — aiTitle(Claude Code 가 붙인 제목)만
    const subtitle = e.aiTitle || null;
    this.graph.addNode({
      id: `s:${this.sessionId}`, parentId: null, kind: 'main',
      label,
      startedAt: startTs, lastActivityAt: startTs, sessionId: this.sessionId, depth: 0,
      meta: { cwd: head.cwd, title: subtitle ? sessionTitleMeta(subtitle) : null, ...(e.customTitle ? { customTitle: true } : {}) },
    }, startTs);
    this.addWatcher({ sessionId: this.sessionId, file: e.file, nodeId: `s:${this.sessionId}`, kind: 'main' });
    if (!isSdk) { try { await this._inheritFromClear(e, head); } catch (err) { log('inherit', err?.message || err); } }

    for (let round = 0; round < 30; round++) {
      const before = this.tails.size + this.watchers.size;
      for (const w of [...this.watchers.values()]) await w.scan();
      for (const t of this.tails.values()) await t.drain();
      await this.matchLauncherChildren();
      await this.matchChildren();
      await this.matchScratchChildren();
      await this.findOutputs();
      for (const t of this.tails.values()) await t.drain();
      if (round > 0 && this.tails.size + this.watchers.size === before) break;
    }
  }

  /**
   * /clear 승계. 이 세션이 /clear 로 시작했으면(head.clearAt) 앞 세션 사슬의 기록에서 /clear 시각에 끝나지 않은 백그라운드 작업
   * (서브에이전트·워크플로·백그라운드 Bash·Monitor, 그리고 열린 서브에이전트 안의 것)을 이 메인 아래로 만든다. 노드 id 는 옛 트리와
   * 같고 meta.inheritedFrom = 띄운 세션. 끝 알림은 이 세션 기록으로 오므로 기존 규칙(taskMap·알림·출력·서브에이전트 기록)이 그대로 끝낸다.
   * 기동기·claude -p 를 띄운 Bash 는 옛 트리에 둔다(회차 매칭·인계 와 허브 가 맡음).
   */
  async _inheritFromClear(e, head) {
    if (!head || !head.clearAt) return;
    const plan = await inheritPlan(this.index, e);
    if (!plan.chain.length) return;
    const g = this.graph;
    const mainId = `s:${this.sessionId}`;
    const w = this.watchers.get(this.sessionId);
    const clearMs = plan.chain[0].clearMs;
    const clearIso = new Date(clearMs).toISOString();
    this.clearedFrom = plan.chain[0].sessionId;
    this.inheritedFrom = new Set(plan.chain.map((c) => c.sessionId));
    this.inheritedIds = this.inheritedIds || new Set();
    this.inheritChain = plan.chain;
    this._inheritRuns = [];
    g.updateNode(mainId, { meta: { clearedFrom: this.clearedFrom } }, clearIso);
    // 옛 세션 임시 폴더의 tasks(백그라운드 출력은 /clear 뒤에도 처음 세션 폴더에 쌓인다 — 실측)
    const enc = head.cwd ? encodeCwd(head.cwd) : null;
    if (enc && w) for (const r of (this.index.taskRoots || claudeTmpRoots())) for (const c of plan.chain) w.tasksDirs.add(path.join(r, enc, c.sessionId, 'tasks'));
    const hint = (id) => { if (this.offline && !this.spawnHints.has(id)) this.spawnHints.set(id, clearIso); }; // 재생: 새 메인 시작에 함께 뜬다
    for (const it of plan.items) {
      const owner = it.owner === 'main' ? mainId : it.owner;
      const on = g.get(owner);
      if (!on || !w) continue;
      const ts = it.ts || clearIso;
      const tu = { id: it.toolUseId, ts, tsMs: Date.parse(ts), input: { command: it.command || undefined, description: it.description || undefined } };
      let id = null;
      if (it.kind === 'agent') {
        id = `a:${it.id}`;
        hint(id);
        if (!g.has(id)) {
          const meta = await agentMetaFromChain(plan.chain, it.id);
          g.addNode({ id, parentId: owner, kind: 'subagent', label: meta?.description || it.description || it.id, sessionId: this.sessionId,
            startedAt: ts, lastActivityAt: clearIso, model: meta?.model ?? null,
            meta: { agentType: meta?.agentType ?? it.agentType ?? null, toolUseId: it.toolUseId ?? null, background: true, fork: meta?.isFork || undefined, inheritedFrom: it.from } }, ts);
          this.agentToolUse.set(it.id, it.toolUseId);
          this.applyPending(id, ts);
        }
        // 옛 세션 폴더의 기록은 /clear 뒤 줄만(이 판 Claude Code 는 새 세션 폴더로 옮겨 이어 쓰지만, 옛 폴더에 이어 쓰는 판도 받는다)
        for (const c of plan.chain) {
          const f = agentFileIn(c.projectPath, c.sessionId, it.id);
          if (this.tails.has(f) || !fs.existsSync(f)) continue;
          this.addTail(f, new FileTail(f, { onLine: (rec, info) => { const t = Date.parse(rec?.timestamp); if (Number.isFinite(t) && t > clearMs) this.handleRecord(rec, id, w, info); } }));
          break;
        }
      } else if (it.kind === 'bash') {
        if (it.claudeP) continue;
        const L = it.command ? detectLaunch(it.command, { bg: true, tool: it.tool || 'Bash' }) : null;
        if (L && ((it.toolUseId && this.index.launchPin?.(it.toolUseId)) || analyzeLaunch(L, resolveCwdGuess(head.cwd, L.cdGuess)))) continue;
        id = `b:${it.id}`;
        hint(id);
        this.ensureBg(it.id, on, w, tu, ts, it.bodyText || '', { timedOutAfterMs: it.timedOutAfterMs ?? null });
      } else if (it.kind === 'monitor') {
        id = `m:${it.id}`;
        hint(id);
        this.ensureMonitor(it.id, on, w, tu, ts, { timeoutMs: it.timeoutMs ?? null, persistent: !!it.persistent });
      } else if (it.kind === 'workflow') {
        id = `w:${it.id}`;
        hint(id);
        this.ensureWorkflow(w, it.id, { parent: owner, label: it.name || undefined, taskId: it.taskId || undefined, ts });
        this._inheritRuns.push(it.id);
      }
      if (id && g.has(id)) {
        if (g.get(id).meta.inheritedFrom !== it.from) g.updateNode(id, { meta: { inheritedFrom: it.from } }, ts);
        this.inheritedIds.add(id);
      }
    }
    await this._scanInheritedRuns();
  }

  /** 이어받은 워크플로 실행 폴더가 새 세션 폴더에 없으면 옛 세션 폴더의 것(저널·에이전트 기록)을 본다 */
  async _scanInheritedRuns() {
    if (!this._inheritRuns?.length || !this.inheritChain) return;
    const w = this.watchers.get(this.sessionId);
    if (!w) return;
    for (const runId of this._inheritRuns) {
      if (fs.existsSync(path.join(w.subagentsDir, 'workflows', runId))) continue; // 새 폴더 것은 w.scan 이 본다
      for (const c of this.inheritChain) {
        const rdir = path.join(c.projectPath, c.sessionId, 'subagents', 'workflows', runId);
        if (!fs.existsSync(rdir)) continue;
        await w.scanRun(rdir, runId);
        break;
      }
    }
  }

  addWatcher(opts) {
    const w = new SessionWatcher(this, opts);
    this.watchers.set(opts.sessionId, w);
    w.tail = new FileTail(opts.file, { onLine: (rec, info) => this.handleRecord(rec, opts.nodeId, w, info) });
    w.tail._session = true; // 세션 transcript 는 늘 500ms 로 본다(사람 입력·새 응답 지연 방지)
    this.addTail(opts.file, w.tail);
    return w;
  }

  addTail(file, tail) {
    if (this.tails.has(file)) return this.tails.get(file);
    tail.onBadLine = (err) => log('bad line', file, err?.message);
    this.tails.set(file, tail);
    return tail;
  }

  /**
   * 500ms 마다 불리지만 파일마다 간격을 달리한다(루트 여럿을 붙들 때 stat 폭주로 CPU 6～12% 쓰던 문제).
   * 세션 transcript(메인·claude -p)와 최근 60초 안에 자란 파일은 500ms, 10분 안은 1.5초, 그보다 조용하면 5초.
   * all=true 는 시험·즉시 반영용(모두 지금 읽음).
   */
  async pollAll({ all = false } = {}) {
    if (this._polling || this.closed) return;
    this._polling = true;
    const now = Date.now();
    try {
      for (const t of this.tails.values()) {
        if (!all && t._dueAt && now < t._dueAt) continue;
        const n = await t.poll();
        if (n > 0) t._grewAt = now;
        else if (t._grewAt == null) t._grewAt = Math.min(now, t.mtimeMs || now); // 처음엔 파일 수정 시각 기준
        const quiet = now - t._grewAt;
        t._dueAt = now + (t._session || quiet < 60_000 ? 0 : quiet < 600_000 ? 1500 : 5000);
      }
    } catch (e) { log('poll', e); } finally { this._polling = false; }
  }

  async scanAll() {
    if (this._scanning || this.closed) return;
    this._scanning = true;
    try {
      // 하위 폴더(subagents·workflows) 탐색: 그 세션 transcript 가 최근 60초 안에 자랐으면 2초마다, 조용하면 10초마다
      const now = Date.now();
      for (const w of [...this.watchers.values()]) {
        const grew = w.tail?._grewAt ?? w.tail?.mtimeMs ?? 0;
        if (w._scanDue && now < w._scanDue) continue;
        w._scanDue = now + (now - grew < 60_000 ? 0 : 10_000);
        await w.scan();
      }
      await this._scanInheritedRuns();
      if (this.children.some((c) => !c.matched && !c.dead)) {
        if (Date.now() - this.index.lastRefresh > 1900) await this.index.refresh();
        await this.matchChildren();
      }
      // 임시 폴더 cwd 로 부모가 분명한 claude -p(명령에 안 보이는 실행 포함): 5초에 한 번
      if (Date.now() - (this._lastScratch || 0) > 5000) {
        this._lastScratch = Date.now();
        if (Date.now() - this.index.lastRefresh > 1900) await this.index.refresh();
        await this.matchScratchChildren();
        await this.matchLauncherChildren();
      }
      await this.findOutputs();
    } catch (e) { log('scan', e); } finally { this._scanning = false; }
  }

  close() {
    this.closed = true;
    for (const t of this.timers) clearInterval(t);
    for (const t of this.tails.values()) t.close();
    for (const o of this.outputs.values()) if (o.timer) clearTimeout(o.timer);
  }

  // ───────────── 시계 (live = 지금, offline = 처리한 레코드의 최대 시각) ─────────────

  nowIso() {
    if (!this.offline) return new Date().toISOString();
    return this._clockIso || EPOCH;
  }

  nowMs() {
    if (!this.offline) return Date.now();
    return Date.parse(this._clockIso || EPOCH);
  }

  _advance(ts) {
    if (ts && (!this._clockIso || ts > this._clockIso)) this._clockIso = ts;
  }

  /** offline 진행률: 읽은 바이트 합 */
  progress() {
    let bytesRead = 0;
    for (const t of this.tails.values()) bytesRead += t.offset || 0;
    return { bytesRead, files: this.tails.size };
  }

  // ───────────── 노드 헬퍼 ─────────────

  touch(id, ts, backlog) {
    const g = this.graph;
    const n = g.get(id);
    if (!n) return;
    n.lastActivityAt = maxIso(n.lastActivityAt, ts);
    if (n.status !== 'active') {
      if (isEnded(n.status)) {
        if (!backlog && (!n.endedAt || ts > n.endedAt)) g.updateNode(id, { status: 'active', endedAt: null }, ts);
      } else {
        g.updateNode(id, { status: 'active' }, ts);
      }
    }
    if (n.parentId) {
      const p = g.get(n.parentId);
      if (p && p.kind === 'workflow') {
        p.lastActivityAt = maxIso(p.lastActivityAt, ts);
        if (p.status === 'idle') g.updateNode(p.id, { status: 'active' }, ts);
      }
    }
  }

  finish(id, ok, ts, extra = {}) {
    const n = this.graph.get(id);
    if (!n) return;
    const status = ok ? 'done' : 'error';
    const patch = { status, endedAt: n.endedAt && n.status === status ? n.endedAt : ts, ...extra };
    if (extra.meta) patch.meta = extra.meta;
    // 끝난 노드는 스킬 위성을 남기지 않는다
    if (n.meta?.skill) patch.meta = { ...(patch.meta || {}), skill: null };
    this.graph.updateNode(id, patch, ts);
    this._closeOpenTools(n, ts);
    if (n.kind === 'workflow' && this._planT) this._planT.workflowEnd(id, ok, ts); // 끝난 워크플로 단계
  }

  /**
   * 일부러 끈 작업 → '중지됨'. reason: taskstop(TaskStop/KillShell) · kill-cmd(끄는 셸 명령 직후 failed 알림)
   * · signal(종료 코드 130/137/143) · time-limit(백그라운드 시간 한도) · killed(알림 killed·출력 끝 [killed]) · orphan(세션 종료로 정리)
   */
  stop(id, ts, reason) {
    const n = this.graph.get(id);
    if (!n) return;
    const patch = { status: 'stopped', endedAt: n.endedAt && n.status === 'stopped' ? n.endedAt : ts, meta: { killed: true, stopReason: reason } };
    if (n.meta?.skill) patch.meta.skill = null;
    this.graph.updateNode(id, patch, ts);
    this._closeOpenTools(n, ts);
    this._failed.delete(id);
    if (n.kind === 'bash-bg') {
      // 백그라운드로 돌던 claude -p 도 같이 중지됨
      for (const c of this.children) if (c.bgTaskId === id.slice(2)) { c.stopped = true; c.isError = false; if (!c.endTsMs) c.endTsMs = Date.parse(ts); }
    }
  }

  /** 끄는 셸 명령 기록. 이미 failed 로 끝난 백그라운드 작업이 이 명령 범위 안이면 중지됨으로 고친다(파일 읽는 순서가 뒤바뀐 경우) */
  _noteKill(tMs) {
    if (!Number.isFinite(tMs)) return;
    this.killCmds.push(tMs);
    if (this.killCmds.length > 64) this.killCmds.splice(0, this.killCmds.length - 64);
    for (const [id, rec] of [...this._failed]) {
      if (rec.endMs >= tMs - STOP_LEAD_MS && rec.endMs <= tMs + STOP_WINDOW_MS && rec.startMs <= tMs) this._failToStop(id, rec, 'kill-cmd');
    }
  }

  /** failed 알림이 '일부러 끈 것'인지: 신호 종료 코드 또는 끄는 명령 직후 */
  _stopReasonForFail(n, ts, node) {
    const code = exitCodeOf(n.summary);
    if (code != null && SIGNAL_EXIT.has(code)) return 'signal';
    const t = Date.parse(ts);
    const start = Date.parse(node.startedAt) || 0;
    if (this.killCmds.some((k) => k >= start && k >= t - STOP_WINDOW_MS && k <= t + STOP_LEAD_MS)) return 'kill-cmd';
    return null;
  }

  /** 백그라운드 작업 failed 처리: 일부러 끈 것이면 중지됨, 아니면 오류 + 나중 판정용 기록 */
  _finishFailed(target, n, ts) {
    const g = this.graph;
    const node = g.get(target);
    if (!node) return;
    const reason = this._stopReasonForFail(n, ts, node);
    if (reason) { this.stop(target, ts, reason); return; }
    this.finish(target, false, ts);
    // 방금 낸 error 이벤트(읽는 중이면 아직 아무에게도 안 보냈으므로 나중에 고쳐 쓸 수 있다)
    let ev = null;
    for (let i = g.ring.length - 1; i >= 0 && i >= g.ring.length - 12; i--) {
      const e = g.ring[i];
      if (e.type === 'node-update' && e.nodeId === target && e.patch?.status === 'error') { ev = e; break; }
    }
    this._failed.set(target, { ev, endMs: Date.parse(ts), startMs: Date.parse(node.startedAt) || 0 });
    if (this._failed.size > 200) this._failed.delete(this._failed.keys().next().value);
  }

  _failToStop(id, rec, reason) {
    const g = this.graph;
    const n = g.get(id);
    this._failed.delete(id);
    if (!n || n.status !== 'error') return;
    if (g.loading && rec.ev && rec.ev.patch) {
      // 첫 적재·재생 재구성 중: 이미 낸 error 이벤트를 중지됨으로 고쳐 쓴다(오류음·빨간 섬광이 재생에 남지 않게)
      rec.ev.patch.status = 'stopped';
      rec.ev.patch.meta = { ...(rec.ev.patch.meta || {}), killed: true, stopReason: reason };
      n.status = 'stopped';
      n.meta.killed = true;
      n.meta.stopReason = reason;
      for (const c of this.children) if (c.bgTaskId === id.slice(2)) { c.stopped = true; c.isError = false; }
      return;
    }
    this.stop(id, n.endedAt || this.nowIso(), reason);
  }

  _closeOpenTools(n, ts) {
    for (const t of n.openTools.splice(0)) {
      this.graph.emit({ ts, type: 'tool-end', nodeId: n.id, toolUseId: t.toolUseId, tool: t.tool, cat: t.cat, ok: true, durationMs: Math.max(0, Date.parse(ts) - Date.parse(t.startedAt)) || 0, text: '' });
    }
  }

  resultEvent(id, ok, text, ts) {
    if (!this.graph.has(id) || !text) return;
    const n = this.graph.get(id);
    const parentPanel = this._agentProgress(n, ts, { result: splitLines(stripTags(text)).filter((l) => l.trim() && !/^agentId:/.test(l)).slice(0, 4), ok });
    this.graph.emit({ ts, type: 'result', nodeId: id, ok: !!ok, text: oneLine(stripTags(text)), ...(parentPanel ? { parentPanel } : {}) });
  }

  /**
   * 서브에이전트 진행을 부모 Agent 도구 패널(ref)로. 같은 ref 는 PANEL_MERGE_MS(이벤트 시각 기준) 안이면 상태만 쌓고 null,
   * 지나면 지금까지 쌓은 상태로 패널을 돌려준다. 결과(result)는 백그라운드(비동기) 에이전트일 때만, 늘 돌려준다.
   */
  _agentProgress(node, ts, { action = null, text = false, result = null, ok = true } = {}) {
    if (!node || node.kind !== 'subagent' || this.graph.privacy === 'minimal') return null;
    // 메타(toolUseId)가 기록보다 늦게 읽힐 수 있어 Agent 결과의 agentId 색인도 본다
    const tuid = node.meta?.toolUseId || this.agentToolUse?.get(node.id.slice(2)) || null;
    const ptu = tuid ? this.tools.get(tuid) : null;
    // 서브에이전트 파일이 부모의 Agent tool_use 보다 먼저 읽히면 ptu 가 아직 없다 — 그때는 노드 부모·라벨로 두고 나중에 채운다
    if (!tuid || (ptu && ptu.name !== 'Agent' && ptu.name !== 'Task')) return null;
    const m = this._agentPanels || (this._agentPanels = new Map());
    let st = m.get(tuid);
    if (!st) {
      st = { title: '', prompt: '', tools: 0, texts: 0, recent: [], lastMs: -Infinity, ref: { nodeId: null, toolUseId: tuid } };
      m.set(tuid, st);
      if (m.size > 2000) m.delete(m.keys().next().value);
    }
    st.ref.nodeId = ptu ? ptu.owner : node.parentId;
    st.title = (ptu && ptu.agentTitle) || st.title || node.label || '';
    if (ptu && ptu.agentPrompt) st.prompt = ptu.agentPrompt;
    if (!st.ref.nodeId) return null;
    if (action) { st.tools++; st.recent.push(action); if (st.recent.length > 4) st.recent.shift(); }
    if (text) st.texts++;
    const tms = Date.parse(ts) || this.nowMs();
    if (result) {
      if (!ptu || !ptu.asyncAgent) return null; // 동기 에이전트는 Agent 도구의 tool-end 패널이 결과를 싣는다
      // 결과 패널은 프롬프트 + 결과 줄만(진행 수치는 파일 읽는 순서에 따라 달라질 수 있어 싣지 않음)
      return progressPanel({ ...st, result: result.length ? result : [ok ? '완료' : '실패'] }, st.ref);
    }
    if (tms >= st.lastMs && tms - st.lastMs < PANEL_MERGE_MS) return null; // 늦게 읽힌 앞 시각 기록(파일 순서)은 합치지 않음
    st.lastMs = tms;
    return progressPanel(st, st.ref);
  }

  /** 부모 후보 결정 */
  parentFor(toolUseId, fallback) {
    const t = toolUseId ? this.tools.get(toolUseId) : null;
    return t ? t.owner : fallback;
  }

  waitForParent(toolUseId, nodeId) {
    if (!toolUseId) return;
    if (!this.waitParent.has(toolUseId)) this.waitParent.set(toolUseId, new Set());
    this.waitParent.get(toolUseId).add(nodeId);
  }

  applyPending(id, ts) {
    const pf = this.pendingFinish.get(id);
    if (pf) { this.pendingFinish.delete(id); this.finish(id, pf.ok, pf.ts, pf.extra); if (pf.text) this.resultEvent(id, pf.ok, pf.text, pf.ts); }
    const key = id.slice(2);
    const pn = this.pendingNotif.get(key);
    if (pn) { this.pendingNotif.delete(key); for (const x of pn) this.applyNotification(x.n, id, x.ts, x.owner); }
  }

  // ───────────── 에이전트·워크플로 ─────────────

  onAgentMeta(w, agentId, meta, runId) {
    const id = `a:${agentId}`;
    const g = this.graph;
    const now = this.nowIso();
    if (runId) {
      const wid = this.ensureWorkflow(w, runId, {});
      if (!g.has(id)) {
        g.addNode({ id, parentId: wid, kind: 'workflow-agent', label: meta.description || agentId, sessionId: w.sessionId, lastActivityAt: g.loading ? EPOCH : undefined,
          meta: { agentType: meta.agentType || 'workflow-subagent', phase: meta.workflowPhase ?? null, background: false } }, now);
        this.applyPending(id, now);
      } else {
        g.updateNode(id, { meta: { phase: meta.workflowPhase ?? g.get(id).meta.phase } }, now);
      }
      if (meta.workflowPhase != null) this._plans().workflowPhase(wid, meta.workflowPhase, g.get(id)?.startedAt || now);
    } else {
      let parent = this.parentFor(meta.toolUseId, null);
      if (!parent && meta.parentAgentId && g.has(`a:${meta.parentAgentId}`)) parent = `a:${meta.parentAgentId}`;
      if (!g.has(id)) {
        g.addNode({ id, parentId: parent || w.nodeId, kind: 'subagent', label: meta.description || agentId, sessionId: w.sessionId, lastActivityAt: g.loading ? EPOCH : undefined,
          model: meta.model ?? null,
          meta: { agentType: meta.agentType ?? null, toolUseId: meta.toolUseId ?? null, background: meta.requestShape === 'background',
            fork: meta.isFork || undefined } }, now);
        this.applyPending(id, now);
      } else {
        const n = g.get(id);
        const patch = { meta: { agentType: meta.agentType ?? n.meta.agentType, toolUseId: meta.toolUseId ?? n.meta.toolUseId, background: meta.requestShape === 'background' } };
        if (meta.description) patch.label = meta.description;
        if (parent && parent !== n.parentId && parent !== id && !g.isAncestor(id, parent)) patch.parentId = parent;
        g.updateNode(id, patch, now);
      }
      if (!parent && meta.toolUseId) this.waitForParent(meta.toolUseId, id);
    }
    if (meta.finished === true) {
      const loading = this.offline || g.loading;
      const fin = () => {
        const n = g.get(id);
        if (n && !isEnded(n.status)) this.finish(id, true, maxIso(n.lastActivityAt, loading ? n.startedAt : now));
      };
      // 첫 적재(라이브·offline 모두): 메타는 기록보다 먼저 읽히므로 마지막 활동 시각을 안 뒤에 판정.
      // 예전 라이브는 바로 판정해 끝난 서브에이전트의 endedAt 이 모두 '서버가 붙은 시각'이 됐다
      if (loading) this.deferred.push(fin); else fin();
    }
  }

  tailAgent(w, agentId, file, runId) {
    if (this.tails.has(file)) return;
    const id = `a:${agentId}`;
    if (!this.graph.has(id)) {
      const now = this.nowIso();
      const parent = runId ? this.ensureWorkflow(w, runId, {}) : w.nodeId;
      this.graph.addNode({ id, parentId: parent, kind: runId ? 'workflow-agent' : 'subagent', label: agentId, sessionId: w.sessionId, lastActivityAt: this.graph.loading ? EPOCH : undefined, meta: {} }, now);
      this.applyPending(id, now);
    }
    this.addTail(file, new FileTail(file, { onLine: (rec, info) => this.handleRecord(rec, id, w, info) }));
  }

  ensureWorkflow(w, runId, { parent, label, taskId, ts } = {}) {
    const id = `w:${runId}`;
    const g = this.graph;
    const now = ts || this.nowIso();
    if (this.offline && ts && !this.spawnHints.has(id)) this.spawnHints.set(id, ts);
    if (!g.has(id)) {
      g.addNode({ id, parentId: parent || w.nodeId, kind: 'workflow', label: label || runId, sessionId: w.sessionId,
        startedAt: now, lastActivityAt: !ts && g.loading ? EPOCH : now, meta: { taskId: taskId ?? null, runId } }, now);
      this.applyPending(id, now);
    } else if (parent || label || taskId) {
      const n = g.get(id);
      const patch = {};
      if (parent && n.parentId !== parent) patch.parentId = parent;
      if (label) patch.label = label;
      if (taskId) patch.meta = { taskId };
      g.updateNode(id, patch, now);
    }
    if (taskId) {
      this.taskMap.set(taskId, id);
      const pn = this.pendingNotif.get(taskId);
      if (pn) { this.pendingNotif.delete(taskId); for (const x of pn) this.applyNotification(x.n, id, x.ts, x.owner); }
    }
    return id;
  }

  onJournal(w, runId, rec, { backlog }) {
    const wid = this.ensureWorkflow(w, runId, {});
    const g = this.graph;
    const jts = rec.timestamp || rec.ts || null;
    const ts = isoOr(jts, this.nowIso());
    if (rec.type === 'started' && rec.agentId) {
      const id = `a:${rec.agentId}`;
      if (!g.has(id)) {
        g.addNode({ id, parentId: wid, kind: 'workflow-agent', label: rec.label || rec.agentId, sessionId: w.sessionId, lastActivityAt: jts || !g.loading ? undefined : EPOCH,
          meta: { agentType: 'workflow-subagent', phase: rec.phase ?? null } }, ts);
        this.applyPending(id, ts);
      } else {
        g.updateNode(id, { label: rec.label, meta: { phase: rec.phase ?? null } }, ts);
      }
      if (rec.phase != null) this._plans().workflowPhase(wid, rec.phase, ts);
      this.touch(wid, ts, backlog);
    } else if (rec.type === 'result' && rec.agentId) {
      const id = `a:${rec.agentId}`;
      const r = rec.result;
      let text;
      if (typeof r === 'string') text = r;
      else if (r && typeof r === 'object' && typeof r.summary === 'string') text = r.summary;
      else { try { text = JSON.stringify(r); } catch { text = String(r); } }
      const ok = !(r && typeof r === 'object' && (r.error || r.ok === false));
      const fin = () => {
        const n = g.get(id);
        const endTs = n ? (jts ? maxIso(n.lastActivityAt, ts) : n.lastActivityAt) : ts;
        if (n) { this.finish(id, ok, endTs); this.resultEvent(id, ok, text, endTs); }
        else this.pendingFinish.set(id, { ok, text, ts: endTs });
      };
      // offline: journal 은 에이전트 기록보다 먼저 읽히고 시각도 없으므로 마지막 활동 시각을 안 뒤에 판정
      if (this.offline && !jts) this.deferred.push(fin); else fin();
    }
  }

  // ───────────── 레코드 처리 ─────────────

  handleRecord(rec, ownerId, w, info = {}) {
    if (!rec || typeof rec !== 'object') return;
    const backlog = !!info.backlog;
    const g = this.graph;
    const node = g.get(ownerId);
    if (!node) return;
    if (this.offline && rec.timestamp) this._advance(isoOr(rec.timestamp, null));
    const ts = isoOr(rec.timestamp, this.nowIso());
    this._recCwd = rec.cwd || null; // 기동 명령의 cwd(서브에이전트 기록 포함)
    if (ownerId === w.nodeId && rec.cwd && w.cwd !== rec.cwd) {
      w.cwd = rec.cwd;
      g.updateNode(ownerId, { meta: { cwd: rec.cwd } }, ts);
    }
    // 세션 문패용 git 브랜치·worktree(기록의 gitBranch·cwd). 'HEAD'(git 아님·분리)는 없음으로
    if (ownerId === w.nodeId && (node.kind === 'main' || node.kind === 'claude-p') && (rec.gitBranch !== undefined || rec.cwd)) {
      const git = typeof rec.gitBranch === 'string' && rec.gitBranch && rec.gitBranch !== 'HEAD' ? redact(rec.gitBranch).slice(0, 60) : (rec.gitBranch !== undefined ? null : node.meta.git ?? null);
      const wt = worktreeOf(rec.cwd || node.meta.cwd);
      if ((node.meta.git ?? null) !== git || (node.meta.worktree ?? null) !== wt) {
        if (backlog || g.loading) { node.meta.git = git; node.meta.worktree = wt; } else g.updateNode(ownerId, { meta: { git, worktree: wt } }, ts);
      }
    }
    if (rec.timestamp && (rec.type === 'assistant' || rec.type === 'user') && ts < node.startedAt) {
      if (backlog || g.loading) node.startedAt = ts; else g.updateNode(ownerId, { startedAt: ts }, ts);
    }
    switch (rec.type) {
      case 'assistant': return this.onAssistant(rec, node, w, ts, backlog);
      case 'user': return this.onUser(rec, node, w, ts, backlog);
      case 'system': return this.onSystem(rec, node, w, ts, backlog);
      case 'ai-title':
        // 세션 노드(메인·claude -p·독립 sdk-cli 루트) label 은 역할 표기라 그대로 두고 meta.title 만 갱신
        if (SESSION_KINDS.has(node.kind) && rec.aiTitle) g.updateNode(ownerId, { meta: { title: sessionTitleMeta(rec.aiTitle) } }, ts);
        return;
      case 'custom-title':
        if (SESSION_KINDS.has(node.kind) && rec.customTitle) g.updateNode(ownerId, { label: rec.customTitle, meta: { customTitle: true } }, ts);
        return;
      case 'attachment': {
        // 턴 도중 도착한 알림·사용자 입력(queued_command). 서브에이전트 transcript 는 알림을 이 형태로만 남긴다(실측)
        const at = rec.attachment;
        if (at && at.type === 'queued_command' && typeof at.prompt === 'string') {
          this.touch(ownerId, ts, backlog);
          if (isTaskNotification(at.prompt)) return this.onNotification(at.prompt, node, w, ts, backlog);
          const text = userTextSummary(at.prompt);
          const origin = node.kind === 'main' && !rec.isSidechain ? 'human' : 'system';
          const ixu = text ? this._userIx(ownerId, at.prompt, origin, ts, { queued: true }) : null; // mid-turn
          if (text) g.emit({ ts, type: 'user', nodeId: ownerId, origin, text, ...(ixu ? { ix: ixu } : {}) });
        }
        return;
      }
      case 'agent-name':
        if (rec.agentName && !SESSION_KINDS.has(node.kind)) g.updateNode(ownerId, { label: rec.agentName }, ts);
        return;
      default:
        return; // queue-operation, attachment, api-request* 등 무시
    }
  }

  onAssistant(rec, node, w, ts, backlog) {
    const g = this.graph;
    const msg = rec.message || {};
    this.touch(node.id, ts, backlog);
    const model = msg.model || rec.requestedModel;
    if (model && !String(model).startsWith('<') && node.model !== model) g.updateNode(node.id, { model }, ts);
    // 컨텍스트 사용률: 마지막 응답 usage 의 입력+캐시 생성+캐시 읽기. 바뀔 때만 meta.ctx 갱신(재생에도 그대로 남음)
    const ctx = !(rec.isSidechain && SESSION_KINDS.has(node.kind)) && (this._ctx ||= new CtxTracker()).update(node.id, { ...msg, model: msg.model || rec.requestedModel });
    if (ctx) g.updateNode(node.id, { meta: { ctx } }, ts);
    if ('attributionSkill' in rec) {
      let sk = rec.attributionSkill || null;
      // 워크플로 에이전트는 처음부터 끝까지 워크플로를 띄운 스킬 이름이 붙어 와서 금색 스킬 위성이 늘 떠 있었다.
      // 첫 기록의 값(물려받은 것)은 무시하고, 그와 다른 스킬을 실제로 쓸 때만 표시한다
      if (node.kind === 'workflow-agent') {
        const base = this._wfBaseSkill || (this._wfBaseSkill = new Map());
        if (!base.has(node.id)) base.set(node.id, sk);
        if (sk === base.get(node.id)) sk = null;
      }
      if ((node.meta.skill ?? null) !== sk) g.updateNode(node.id, { meta: { skill: sk } }, ts);
    }
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text') {
        const text = oneLine(stripTags(b.text));
        if (!text) continue;
        node.counts.texts++;
        // 말 패널: 노드의 최근 말 줄(원문 줄바꿈 유지)
        let panel = null;
        if (g.privacy !== 'minimal') {
          const say = this._say || (this._say = new Map());
          const buf = say.get(node.id) || [];
          for (const l of splitLines(stripTags(b.text))) if (l.trim()) buf.push(l.length > 300 ? l.slice(0, 300) : l);
          if (buf.length > PANEL_LIMITS.say) buf.splice(0, buf.length - PANEL_LIMITS.say);
          say.set(node.id, buf);
          panel = sayPanel(buf);
        }
        const parentPanel = this._agentProgress(node, ts, { text: true });
        (this._lastSay || (this._lastSay = new Map())).set(node.id, text); // 턴 끝 답변 앞부분
        g.emit({ ts, type: 'text', nodeId: node.id, role: 'assistant', text, brief: textBrief(text), ...(panel ? { panel } : {}), ...(parentPanel ? { parentPanel } : {}) });
      } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        g.emit({ ts, type: 'thinking', nodeId: node.id, chars: (b.thinking || '').length });
      } else if (b.type === 'tool_use') {
        this.onToolUse(b, node, w, ts, backlog);
      }
    }
  }

  onToolUse(b, node, w, ts, backlog) {
    const g = this.graph;
    const name = b.name || 'unknown';
    const input = b.input && typeof b.input === 'object' ? b.input : {};
    const cat = toolCategory(name);
    const skill = name === 'Skill' ? (input.skill || null) : null;
    const text = summarizeToolInput(name, input);
    const { brief, detail } = toolBrief(name, input); // 작업 요약(필드 추가)
    const id = b.id;
    if (id && this.tools.has(id)) return; // 중복
    const panel = g.privacy === 'minimal' ? null : inputPanel(name, input); // 패널 내용(입력 단계)
    const ix0 = classifyStart(name, input);
    const ix = this._ix().onStart(node.id, name, Date.parse(ts), ix0); // 특별 상호작용(범주·세부)
    // 작업 대상: 파일·산출물·저장소·DB·원격·서비스 참조(프로젝트 루트 = 메인 cwd 기준 상대 경로)
    let art = null;
    try { const a = artStart(name, input, { cwd: this._recCwd || node.meta.cwd || w.cwd || null, root: this.graph.get(this.graph.rootId)?.meta?.cwd || null, ix: ix0 }); if (a.length) art = a; } catch (e) { log('art', e?.message || e); }
    // 계획 출처(TodoWrite·Task·ExitPlanMode·체크박스/단계 md·Workflow phases) — 끝(성공)에서 장부에 반영
    let plan = null;
    try { plan = planStart(name, input, { cwd: this._recCwd || node.meta.cwd || w.cwd || null }); } catch (e) { log('plan', e?.message || e); }
    if (id) {
      this.tools.set(id, { id, owner: node.id, name, cat, ts, tsMs: Date.parse(ts), watcher: w, bg: !!input.run_in_background,
        input: { description: input.description, command: typeof input.command === 'string' ? input.command.slice(0, 2000) : undefined,
          task_id: input.task_id || input.shell_id, persistent: input.persistent, timeout_ms: input.timeout_ms },
        panel, // 결과 패널을 만들 때까지만 원문 줄 보관(끝나면 제목·비밀 표시만 남김)
        ...(ix ? { ix } : {}),
        ...(art ? { art } : {}),
        ...(plan ? { plan } : {}),
        ...(name === 'Agent' || name === 'Task' ? { agentTitle: String(input.description || input.subagent_type || '').slice(0, 200),
          agentPrompt: (splitLines(input.prompt).find((l) => l.trim()) || '').slice(0, 300) } : {}) });
      const waiting = this.waitParent.get(id);
      if (waiting) {
        this.waitParent.delete(id);
        for (const cid of waiting) {
          const c = g.get(cid);
          if (c && c.parentId !== node.id && cid !== node.id && !g.isAncestor(cid, node.id)) g.updateNode(cid, { parentId: node.id }, ts);
        }
      }
    }
    node.counts.tools++;
    // 스냅샷 openTools 에도 이벤트와 같은 마스킹·minimal 규칙
    const safe = (x) => (g.privacy === 'minimal' ? '' : redact(x));
    const sp = panel ? sanitizePanel(panel, g.privacy) : null;
    node.openTools.push({ toolUseId: id, tool: name, cat, skill, startedAt: ts, text: safe(text), brief: safe(brief), ...(sp ? { panel: sp } : {}) });
    if (node.openTools.length > 50) node.openTools.splice(0, node.openTools.length - 50);
    const parentPanel = this._agentProgress(node, ts, { action: `${name.startsWith('mcp__') ? 'MCP' : name} ${brief}`.trim() });
    // 같은 파일 충돌·세션 간 메시지: 파일 도구는 정규화 경로(마스킹, minimal 이면 해시만), SendMessage 는 대상
    // Bash·PowerShell 은 명령에서 추정한 쓰기 대상(est:1) — file = 첫째, 둘 이상이면 files = 전부(최대 8)
    const frefs = toolFileRefs(name, input, this._recCwd || node.meta.cwd || w.cwd || null);
    const mask = (r) => ({ ...(g.privacy === 'minimal' ? { k: createHash('sha1').update(r.k).digest('hex').slice(0, 16), n: '' } : { k: redact(r.k), n: redact(r.n) }), w: r.w, ...(r.est ? { est: 1 } : {}) });
    const files = frefs.map(mask);
    const file = files[0] || null;
    const to = msgTo(name, input);
    g.emit({ ts, type: 'tool-start', nodeId: node.id, toolUseId: id, tool: name, cat, skill, text, brief, detail, ...(file ? { file } : {}), ...(files.length > 1 ? { files } : {}), ...(to ? { to: redact(to) } : {}), ...(panel ? { panel } : {}), ...(parentPanel ? { parentPanel } : {}), ...(ix ? { ix } : {}), ...(art ? { art } : {}) });
    if (skill && node.meta.skill !== skill) g.updateNode(node.id, { meta: { skill } }, ts);

    if (SHELL.has(name) && typeof input.command === 'string') {
      const d = detectClaudeP(input.command);
      if (d) {
        this.children.push({
          toolUseId: id, owner: node.id, watcher: w, tsMs: Date.parse(ts), endTsMs: null, isError: false,
          sessionIdHint: d.sessionIdHint, promptHint: d.promptHint, promptHints: d.promptHints || (d.promptHint ? [d.promptHint] : []),
          cwdGuess: resolveCwdGuess(w.cwd || node.meta.cwd, d.cdGuess), stdoutIds: [], matched: null, dead: false,
        });
      } else {
        // 기동기: 분리 실행한 스크립트 사슬 안에 claude -p 가 있으면 기동기 노드(회차들의 부모)
        const L = detectLaunch(input.command, { bg: !!input.run_in_background, tool: name });
        // 보관함: 보관 때 정한 사슬 판정(스크립트가 없는 PC·바뀐 스크립트에서도 같은 답)이 있으면 그것
        const a = L && ((id && this.index.launchPin?.(id)) || analyzeLaunch(L, resolveCwdGuess(this._recCwd || w.cwd || node.meta.cwd, L.cdGuess)));
        if (a && id) this._addLauncher(id, node, w, ts, input, a, L);
      }
      // 포그라운드에서 프로세스를 끄는 명령(taskkill·Stop-Process·kill …) → 곧 올 failed 알림을 '중지됨'으로
      if (!input.run_in_background && isKillCommand(input.command)) this._noteKill(Date.parse(ts));
    }
    if (name === 'TaskStop' || name === 'KillShell') {
      const tid = input.task_id || input.shell_id;
      const target = tid && (this.taskMap.get(tid) || [`m:${tid}`, `b:${tid}`, `a:${tid}`].find((x) => g.has(x)));
      if (target) {
        const t = g.get(target);
        if (t && !isEnded(t.status)) this.stop(target, ts, 'taskstop');
        else if (t && t.status === 'error' && this._failed.has(target)) this._failToStop(target, this._failed.get(target), 'taskstop');
      }
    }
  }

  onUser(rec, node, w, ts, backlog) {
    if (rec.isMeta) return;
    const g = this.graph;
    const content = rec.message?.content;
    this.touch(node.id, ts, backlog);
    if (typeof content === 'string') {
      if (isTaskNotification(content) || rec.origin?.kind === 'task-notification') {
        return this.onNotification(content, node, w, ts, backlog);
      }
      const text = userTextSummary(content);
      const origin = this.originOf(rec, node);
      const ixu = text ? this._userIx(node.id, content, origin, ts) : null; // 사용자 ↔ 메인
      if (text) g.emit({ ts, type: 'user', nodeId: node.id, origin, text, ...(ixu ? { ix: ixu } : {}) });
      return;
    }
    if (!Array.isArray(content)) return;
    let humanText = '', images = 0;
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'tool_result') this.onToolResult(item, rec, node, w, ts, backlog);
      else if (item.type === 'text') humanText += (humanText ? '\n' : '') + (item.text || '');
      else if (item.type === 'image') { humanText += ' [이미지]'; images++; }
    }
    if (humanText.trim()) {
      if (isTaskNotification(humanText)) return this.onNotification(humanText, node, w, ts, backlog);
      const text = userTextSummary(humanText);
      const origin = this.originOf(rec, node);
      const withResult = content.some((it) => it && it.type === 'tool_result'); // 도구 결과와 같은 레코드에 실린 글 = 턴 도중 끼어든 입력
      const ixu = text ? this._userIx(node.id, humanText.replace(/ \[이미지\]/g, ''), origin, ts, { images, busy: withResult }) : null;
      if (text) g.emit({ ts, type: 'user', nodeId: node.id, origin, text, ...(ixu ? { ix: ixu } : {}) });
    }
  }

  originOf(rec, node) {
    const k = rec.origin?.kind;
    if (k === 'human') return 'human';
    if (k === 'task-notification') return 'task-notification';
    if (k) return 'system';
    if (node.kind === 'main' && !rec.isSidechain && rec.promptSource !== 'system' && rec.promptSource !== 'sdk') return 'human';
    return 'system';
  }

  onToolResult(item, rec, node, w, ts, backlog) {
    const g = this.graph;
    const tuid = item.tool_use_id;
    const tu = this.tools.get(tuid);
    const name = tu?.name || 'unknown';
    const ok = !item.is_error;
    const owner = tu ? g.get(tu.owner) || node : node;
    const idx = owner.openTools.findIndex((t) => t.toolUseId === tuid);
    if (idx >= 0) owner.openTools.splice(idx, 1);
    else if (tu?.ended) return; // 중복 tool_result
    if (tu) { tu.ended = true; tu.endMs = Date.parse(ts); }
    if (!ok) owner.counts.errors++;
    const durationMs = tu ? Math.max(0, Date.parse(ts) - tu.tsMs) || 0 : 0;
    const bodyText = textOfContent(item.content);
    const tur = rec.toolUseResult && typeof rec.toolUseResult === 'object' ? rec.toolUseResult : (ok ? inferToolUseResult(name, bodyText) : null);
    let panel = null;
    if (g.privacy !== 'minimal') {
      panel = resultPanel(name, null, tur, stripTags(bodyText), item.content, ok, tu?.panel || null);
      if (tu) tu.panel = { mode: panel.mode, title: panel.title, secret: !!(tu.panel && tu.panel.secret), lines: [], marks: '' }; // 출력 꼬리 제목용으로 작게
      if (tu && (name === 'Agent' || name === 'Task') && tur && tur.isAsync) tu.asyncAgent = true;
    }
    // 끝 ix: 시작 때 범주가 정해진 호출만(연속·분기 batch 는 시작 이벤트로 끝)
    const ixEnd0 = tu && tu.ix && tu.ix.phase === 'start'
      ? this._ix().onEnd(classifyEnd(tu.ix, { ok, stdout: tur?.stdout, stderr: tur?.stderr, body: tur && tur.stdout != null ? '' : stripTags(bodyText), bg: !!(tur && (tur.backgroundTaskId || (tu.name === 'Monitor' && tur.taskId))), cmd: tu.input?.command, tur }))
      : null;
    // 사용자가 도구 호출을 거절(권한 거부)하면 그 범주보다 거부가 우선
    const denied = !ok && owner.kind === 'main' && USER_DENY_RE.test(String(bodyText || '').slice(0, 400)) && !(tu && tu.ix && tu.ix.op === 'ask');
    const ixEnd = denied ? { v: 1, cat: 'user', op: 'deny', tool: name, phase: 'end', ok: false } : ixEnd0;
    const artE = tu && tu.art ? artEnd(tu.art, { ok, tur, ixEnd: ixEnd0 }) : null; // 결과로 다듬은 대상(실패면 없음)
    g.emit({ ts, type: 'tool-end', nodeId: owner.id, toolUseId: tuid, tool: name, cat: toolCategory(name), ok, durationMs, text: summarizeToolResult(item.content),
      brief: resultBrief(name, tur, stripTags(bodyText), ok), ...(panel ? { panel } : {}), ...(ixEnd ? { ix: ixEnd } : {}), ...(artE ? { art: artE } : {}) });
    if (tu && tu.plan && tu.plan.src !== 'workflow') { this._plans().end(tu.plan, { ok, tur, nodeId: owner.id, ts }); tu.plan = null; }

    if ((name === 'Agent' || name === 'Task') && tur && tur.agentId) {
      const aid = `a:${tur.agentId}`;
      this.agentToolUse.set(tur.agentId, tuid);
      if (!g.has(aid)) {
        g.addNode({ id: aid, parentId: owner.id, kind: 'subagent', label: tur.description || tu?.input?.description || tur.agentId,
          sessionId: w.sessionId, model: tur.resolvedModel ?? null, startedAt: tu?.ts || ts, lastActivityAt: ts,
          meta: { toolUseId: tuid, background: !!tur.isAsync } }, tu?.ts || ts);
        this.applyPending(aid, ts);
      } else {
        const a = g.get(aid);
        if (a.parentId !== owner.id && aid !== owner.id && !g.isAncestor(aid, owner.id)) g.updateNode(aid, { parentId: owner.id }, ts);
      }
      if (tur.status && tur.status !== 'async_launched') {
        this.finish(aid, ok && tur.status !== 'failed' && tur.status !== 'error', ts);
        this.resultEvent(aid, ok, bodyText, ts);
      }
    } else if (name === 'Workflow' && tur && tur.runId) {
      const wid = this.ensureWorkflow(w, tur.runId, { parent: owner.id, label: tur.workflowName, taskId: tur.taskId, ts: tu?.ts || ts });
      if (tu && tu.plan && tu.plan.src === 'workflow') { this._plans().workflowDefine(wid, tu.plan.phases, tu.ts || ts); tu.plan = null; } // meta.phases
    } else if (SHELL.has(name)) {
      if (tur && tur.backgroundTaskId) this.ensureBg(tur.backgroundTaskId, owner, w, tu, ts, bodyText, tur);
      const child = this.children.find((c) => c.toolUseId === tuid);
      if (child) {
        child.endTsMs = Date.parse(ts);
        child.isError = !ok;
        const ids = extractSessionIds(`${tur?.stdout || ''}\n${bodyText}`);
        for (const sid of ids) if (!child.stdoutIds.includes(sid)) child.stdoutIds.push(sid);
        if (tur && tur.backgroundTaskId) { child.endTsMs = null; child.bgTaskId = tur.backgroundTaskId; }
      }
    } else if (name === 'Monitor' && tur && tur.taskId) {
      this.ensureMonitor(tur.taskId, owner, w, tu, ts, tur);
    }
  }

  /**
   * 기동기 노드. run_in_background 면 결과의 backgroundTaskId 로 만든 bash-bg 노드(b:<taskId>)를 기동기로 쓰고,
   * 포그라운드 명령이 nohup·&·Start-Process 로 분리해 띄운 것이면 그 자리에서 bash-bg 노드 b:<toolUseId> 를 만든다.
   */
  _addLauncher(toolUseId, node, w, ts, input, a, L) {
    const e = this.index.findSession?.(w.sessionId);
    // 분리 실행(nohup·setsid·disown·홀로 선 &·Start-Process)이면 띄운 셸이 바로 끝나 부모 PID 가 끊긴다 →
    // 띄운 자리(owner)와 무관하게 최상위 독립 노드(parentId null, meta.spawnedBy = 띄운 노드)
    const detached = !!(L && L.detached);
    const rec = { nodeId: null, tsMs: Date.parse(ts), key: a.key, script: a.script, cwd: a.cwd, watcher: w, owner: node.id,
      projectDir: e?.projectDir ?? null, toolUseId, via: a.via.map((x) => x.split('/').pop()), detached };
    this.launchNodes.set(toolUseId, rec);
    if (input.run_in_background) return; // ensureBg 가 노드를 정한다
    const id = `b:${toolUseId}`;
    rec.nodeId = id;
    this.launcherByNode.set(id, rec);
    if (this.offline && !this.spawnHints.has(id)) this.spawnHints.set(id, ts);
    if (!this.graph.has(id)) {
      this.graph.addNode({ id, parentId: detached ? null : node.id, kind: 'bash-bg', label: `기동기 · ${a.script}`, sessionId: w.sessionId,
        startedAt: ts, lastActivityAt: ts,
        meta: { toolUseId, command: String(input.command).slice(0, 200), background: true, detached: true,
          ...(detached ? { spawnedBy: node.id } : {}),
          launcher: { script: a.script, via: rec.via }, title: input.description ? String(input.description).slice(0, 120) : null } }, ts);
    }
  }

  ensureBg(taskId, owner, w, tu, ts, bodyText, tur) {
    const id = `b:${taskId}`;
    const g = this.graph;
    const cmd = tu?.input?.command || '';
    if (this.offline && !this.spawnHints.has(id)) this.spawnHints.set(id, tu?.ts || ts);
    const lr = tu?.id ? this.launchNodes.get(tu.id) : null; // run_in_background 기동기
    if (lr && !lr.nodeId) { lr.nodeId = id; this.launcherByNode.set(id, lr); }
    if (!g.has(id)) {
      const det = !!(lr && lr.detached); // run_in_background 안에서도 nohup·& 로 떼어 냈으면 최상위
      g.addNode({ id, parentId: det ? null : owner.id, kind: 'bash-bg', label: lr ? `기동기 · ${lr.script}` : (tu?.input?.description || cmd.slice(0, 60) || taskId),
        sessionId: w.sessionId, startedAt: ts, lastActivityAt: ts,
        meta: { toolUseId: tu?.id ?? null, command: cmd.slice(0, 200), background: true, ...(det ? { detached: true, spawnedBy: owner.id } : {}),
          taskId, timedOutAfterMs: tur?.timedOutAfterMs ?? null,
          ...(lr ? { launcher: { script: lr.script, via: lr.via }, title: tu?.input?.description ? String(tu.input.description).slice(0, 120) : null } : {}) } }, ts);
    }
    this.taskMap.set(taskId, id);
    const out = extractOutputPath(bodyText);
    if (out) w.tasksDirs.add(path.dirname(out));
    this.startOutput(id, taskId, w, out);
    this.applyPending(id, ts);
  }

  ensureMonitor(taskId, owner, w, tu, ts, tur) {
    const id = `m:${taskId}`;
    const g = this.graph;
    if (this.offline && !this.spawnHints.has(id)) this.spawnHints.set(id, tu?.ts || ts);
    if (!g.has(id)) {
      const command = tu?.input?.command ? String(tu.input.command).slice(0, 200) : null;
      const label = tu?.input?.description || taskId;
      // 재무장: 같은 주인·같은 설명의 앞 Monitor 가 끝났거나(만료·중지) 시한이 거의 다 된 뒤 10분 안에 다시 건 것
      let rearm = null;
      const tms = Date.parse(ts);
      for (const n of g.nodes.values()) {
        if (n.kind !== 'monitor' || n.parentId !== owner.id || n.id === id) continue;
        if (n.label !== label) continue; // meta.command 는 마스킹·자르기를 거쳐 원문과 다를 수 있어 설명으로 비교
        const st = Date.parse(n.startedAt);
        const end = isEnded(n.status) ? Date.parse(n.endedAt) : st + (n.meta.timeoutMs || 0);
        if (!(st < tms) || !Number.isFinite(end) || tms < end - 120_000 || tms - end > 600_000) continue;
        if (!rearm || st > Date.parse(rearm.startedAt)) rearm = n;
      }
      g.addNode({ id, parentId: owner.id, kind: 'monitor', label, sessionId: w.sessionId,
        startedAt: ts, lastActivityAt: ts,
        meta: { taskId, timeoutMs: tur?.timeoutMs ?? null, persistent: !!tur?.persistent, command, background: true,
          ...(rearm ? { rearmOf: rearm.id, rearmCount: (rearm.meta.rearmCount || 0) + 1 } : {}) } }, ts);
    }
    this.taskMap.set(taskId, id);
    this.startOutput(id, taskId, w, null);
    this.applyPending(id, ts);
  }

  // ───────────── 알림 ─────────────

  onNotification(content, node, w, ts, backlog) {
    const n = parseTaskNotification(content);
    const g = this.graph;
    // 같은 알림이 attachment(queued_command)와 user 레코드로 두 번 올 수 있다
    const key = `${node.id}|${n.taskId}|${n.status}|${n.event}|${n.summary}`;
    const tms = Date.parse(ts) || this.nowMs();
    const prev = this.seenNotif.get(key);
    if (prev != null && Math.abs(tms - prev) < 600_000) return;
    this.seenNotif.set(key, tms);
    if (this.seenNotif.size > 5000) this.seenNotif.delete(this.seenNotif.keys().next().value);
    const summary = n.summary || (n.event ? `이벤트: ${n.event}` : '') || userTextSummary(content);
    g.emit({ ts, type: 'user', nodeId: node.id, origin: 'task-notification', text: oneLine(summary), ...(node.kind === 'main' ? { ix: { v: 1, cat: 'user', op: 'auto', src: 'notify', phase: 'end' } } : {}) }); // 자동 알림 = 회색 점
    if (!n.taskId) return;
    if (n.outputFile) w.tasksDirs.add(path.dirname(n.outputFile));
    // 세션 종료 정리 알림(status stopped)은 task-id 여러 개(끝의 __orphan_summary__ 는 요약용 가짜 id)
    const ids = n.taskIds && n.taskIds.length > 1 ? n.taskIds.filter((x) => x && !x.startsWith('__')) : [n.taskId];
    for (const tid of ids) {
      const ni = tid === n.taskId ? n : { ...n, taskId: tid };
      const target = this.taskMap.get(tid) || [`a:${tid}`, `b:${tid}`, `m:${tid}`, `w:${tid}`].find((x) => g.has(x));
      if (!target) {
        if (!this.pendingNotif.has(tid)) this.pendingNotif.set(tid, []);
        this.pendingNotif.get(tid).push({ n: ni, ts, owner: node.id });
        continue;
      }
      this.applyNotification(ni, target, ts, node.id);
    }
  }

  applyNotification(n, target, ts, ownerId) {
    const g = this.graph;
    const t = g.get(target);
    if (!t) return;
    const st = n.status;
    const stopReason = stopReasonOfNotification(n); // killed → time-limit/killed, stopped → orphan
    if (t.kind === 'monitor') {
      const ev = n.event || '';
      const o = this.outputs.get(target);
      if (/^\[Monitor expired/.test(ev)) { this.finish(target, true, ts, { meta: { expired: true } }); return; }
      if (st === 'failed') { if (!isEnded(t.status)) this._finishFailed(target, n, ts); return; }
      if (stopReason || /^\[killed\]/.test(ev)) { if (t.status !== 'stopped') this.stop(target, ts, stopReason || 'killed'); return; }
      if (ev && !(o && o.hasData)) {
        this.touch(target, ts, false);
        const panel = this._outputPanel(target, ev + '\n');
        const ix = this.outputIx(target, ev + '\n');
        g.emit({ ts, type: 'output', nodeId: target, text: ev, ...(panel ? { panel } : {}), ...(ix ? { ix } : {}) });
        this.jobFeed(target, ev + '\n', ts);
      }
      return;
    }
    if (t.kind === 'bash-bg') {
      if (n.outputFile) this.startOutput(target, target.slice(2), null, n.outputFile);
      if (st === 'completed') this.finish(target, true, ts);
      else if (st === 'failed') { if (t.status !== 'stopped') this._finishFailed(target, n, ts); }
      else if (stopReason) this.stop(target, ts, stopReason);
      if (st) {
        // claude -p 가 백그라운드로 돌았던 경우 종료 시각 반영
        for (const c of this.children) if (c.bgTaskId === target.slice(2)) { c.endTsMs = Date.parse(ts); c.isError = st === 'failed' && !c.stopped; }
      }
      return;
    }
    if (stopReason) {
      this.stop(target, ts, stopReason);
      if (n.result) this.resultEvent(target, true, n.result, ts);
    } else if (st === 'completed' || st === 'failed') {
      const ok = st !== 'failed';
      this.finish(target, ok, ts);
      if (n.result) this.resultEvent(target, ok, n.result, ts);
    } else if (n.result) {
      this.resultEvent(target, true, n.result, ts);
    }
  }

  onSystem(rec, node, w, ts) {
    const g = this.graph;
    if (rec.subtype === 'turn_duration') {
      if (SESSION_KINDS.has(node.kind)) {
        this._closeOpenTools(node, ts);
        const rx = node.kind === 'main' ? this._replyIx(node.id, ts, rec.durationMs) : null; // 메인 → 사용자 답변
        if (node.status === 'active') g.updateNode(node.id, { status: 'idle' }, ts, rx ? { ix: rx } : null);
        else if (rx) g.emit({ ts, type: 'node-update', nodeId: node.id, patch: {}, ix: rx });
        if (node.meta?.skill) g.updateNode(node.id, { meta: { skill: null } }, ts);
      }
    } else if (rec.subtype === 'away_summary') {
      const text = oneLine(typeof rec.content === 'string' ? rec.content : textOfContent(rec.content));
      if (text) g.emit({ ts, type: 'text', nodeId: node.id, role: 'system', text });
    }
  }

  // ───────────── 백그라운드 출력 ─────────────

  startOutput(nodeId, taskId, w, file) {
    let o = this.outputs.get(nodeId);
    if (!o) {
      o = { nodeId, taskId, watcher: w, file: null, tail: null, buf: '', timer: null, hasData: false, lastEmit: 0, tries: 0 };
      this.outputs.set(nodeId, o);
    }
    if (w && !o.watcher) o.watcher = w;
    // 보관함: 기록에 적힌 원래 임시 폴더 경로 대신 보관함 `_tasks/` 아래 같은 상대 경로(없으면 찾기로 넘김)
    if (file && this.index.mapTaskFile) file = this.index.mapTaskFile(file);
    if (file && !o.tail) {
      o.file = file;
      o.tail = new FileTail(file, { mode: 'text', onText: (s, info) => this.onOutput(o, s, info.backlog),
        ...(this.offline ? { maxInitialText: OFFLINE_OUTPUT_MAX } : {}) });
      this.addTail(file, o.tail);
    }
    return o;
  }

  async findOutputs() {
    const now = Date.now();
    for (const o of this.outputs.values()) {
      if (o.tail || o.tries > 30) continue;
      // 라이브: 못 찾은 출력 파일을 2초마다 임시 폴더 전체에서 다시 찾던 것이 루트 여럿일 때 CPU 의 대부분이었다.
      // 시도 간격을 2초→4초→…최대 5분으로 늘리고, 끝난 지 10분 넘은 작업(임시 폴더가 지워졌을 가능성)은 3번 만에 그만둔다.
      if (!this.offline) {
        if (o.nextTryAt && now < o.nextTryAt) continue;
        const n = this.graph.get(o.nodeId);
        const ended = n && (n.status === 'done' || n.status === 'error') && now - (Date.parse(n.endedAt) || 0) > 600_000;
        if (ended && o.tries >= 3) { o.tries = 31; continue; }
        o.nextTryAt = now + Math.min(300_000, 2000 * 2 ** o.tries);
      }
      o.tries++;
      const w = o.watcher;
      const file = await findTaskOutput(o.taskId, {
        knownDirs: (w ? [...w.tasksDirs] : []).map((d) => (this.index.mapTaskDir ? this.index.mapTaskDir(d) : d)).filter(Boolean),
        encodedCwd: w?.cwd ? encodeCwd(w.cwd) : null,
        sessionId: w?.sessionId,
        roots: this.index.taskRoots || null,
      });
      if (file) {
        if (w) w.tasksDirs.add(path.dirname(file));
        this.startOutput(o.nodeId, o.taskId, w, file);
        await o.tail.drain();
      }
    }
  }

  onOutput(o, s, backlog) {
    if (!s) return;
    if (this.offline) {
      // 재생: 원문 조각만 보관(꼬리 1MB). 시각 배분은 replay.mjs normalize 4단계
      o.chunks = o.chunks || [];
      o.chunks.push(s);
      o.chunkBytes = (o.chunkBytes || 0) + s.length;
      while (o.chunkBytes > OFFLINE_OUTPUT_MAX && o.chunks.length > 1) o.chunkBytes -= o.chunks.shift().length;
      if (/\[killed\]\s*$/.test(s)) {
        const n = this.graph.get(o.nodeId);
        if (n && !isEnded(n.status)) this.stop(o.nodeId, this._fileEndIso(o, n), 'killed');
      }
      return;
    }
    o.hasData = true;
    o.buf += s;
    if (o.buf.length > 4000) o.buf = o.buf.slice(-4000);
    if (/\[killed\]\s*$/.test(o.buf)) {
      const n = this.graph.get(o.nodeId);
      if (n && !isEnded(n.status)) {
        this._flushOutput(o, backlog);
        // 첫 적재·밀린 기록이면 지금이 아니라 출력 파일이 마지막으로 바뀐 시각
        this.stop(o.nodeId, backlog || this.graph.loading ? this._fileEndIso(o, n) : this.nowIso(), 'killed');
        return;
      }
    }
    if (backlog || this.graph.loading) { this._flushOutput(o, true); return; }
    if (!o.timer) {
      const wait = Math.max(0, 250 - (Date.now() - o.lastEmit));
      o.timer = setTimeout(() => { o.timer = null; this._flushOutput(o, false); }, wait);
    }
  }

  /** 출력 파일 끝 시각(파일 mtime, 없으면 마지막 활동) — 시작보다 앞서지 않게 */
  _fileEndIso(o, n) {
    const m = o.tail?.mtimeMs;
    const f = m ? new Date(m).toISOString() : null;
    return maxIso(n.startedAt, f || n.lastActivityAt);
  }

  _flushOutput(o, backlog) {
    if (!o.buf) return;
    const text = o.buf.replace(/\r/g, '');
    o.buf = '';
    o.lastEmit = Date.now();
    const ts = backlog && o.tail?.mtimeMs ? new Date(o.tail.mtimeMs).toISOString() : this.nowIso();
    this.touch(o.nodeId, ts, backlog);
    if (!text.trim()) return;
    const panel = this._outputPanel(o.nodeId, text);
    const ix = this.outputIx(o.nodeId, text);
    this.graph.emit({ ts, type: 'output', nodeId: o.nodeId, text, ...(panel ? { panel } : {}), ...(ix ? { ix } : {}) });
    this.jobFeed(o.nodeId, text, ts);
  }

  /** 사용자 메시지 분류(메인만). 턴 열림·마지막 답변 시각으로 mid-turn·대기 시간을 판단 */
  _userIx(nodeId, raw, origin, ts, { queued = false, images = 0, busy = false } = {}) {
    const n = this.graph.get(nodeId);
    if (!n || n.kind !== 'main') return null;
    const T = this._turn || (this._turn = new Map());
    const t = T.get(nodeId) || {};
    const tms = Date.parse(ts);
    const key = String(raw || '').slice(0, 200);
    if (!queued && origin === 'human' && t.queuedKey === key && tms - (t.queuedAt || 0) < 600_000) { t.queuedKey = null; return null; } // 대기열로 먼저 본 같은 입력
    // 턴 도중 = 대기열(queued_command)·도구 결과와 같은 레코드·메인 도구가 열려 있음(turn_duration 이 없는 턴도 있어 '턴 열림'만으로는 판정하지 않음)
    const ix = classifyUserMessage(raw, { origin, turnOpen: busy || (n.openTools || []).length > 0, queued, images, waitMs: origin === 'human' && t.replyAt && !t.open ? tms - t.replyAt : null });
    if (ix.op === 'prompt' || ix.op === 'midturn' || ix.op === 'command') t.open = true;
    if (ix.op === 'interrupt') t.open = false;
    if (queued) { t.queuedKey = key; t.queuedAt = tms; }
    T.set(nodeId, t);
    return ix;
  }
  /** 턴 끝(turn_duration) → 메인 최종 답변 ix */
  _replyIx(nodeId, ts, durationMs) {
    const T = this._turn || (this._turn = new Map());
    const t = T.get(nodeId) || {};
    t.open = false; t.replyAt = Date.parse(ts);
    T.set(nodeId, t);
    const say = this._lastSay && this._lastSay.get(nodeId);
    return { v: 1, cat: 'user', op: 'reply', phase: 'end', ...(say ? { text: ixSnip(say) } : {}), ...(Number.isFinite(durationMs) ? { turnMs: durationMs } : {}) };
  }

  /** 상호작용 상태(연속·분기·로컬 커밋 수) — 라이브·재생 같은 순서로 쌓임 */
  _ix() { return this._ixT || (this._ixT = new IxTracker()); }
  _plans() { return this._planT || (this._planT = new PlanTracker({ graph: this.graph })); } // 계획 장부
  /** 백그라운드 출력 조각 → 진행 ix(띄운 호출의 범주 기준, 없으면 i/N 진행 줄만). 라이브 _flushOutput·Monitor 알림·재생 4단계가 부름 */
  outputIx(nodeId, chunk) {
    const n = this.graph.get(nodeId);
    const tuid = n?.meta?.toolUseId;
    const tu = tuid ? this.tools.get(tuid) : null;
    const m = this._ixAcc || (this._ixAcc = new Map());
    let acc = m.get(nodeId);
    if (!acc) { acc = {}; m.set(nodeId, acc); if (m.size > 2000) m.delete(m.keys().next().value); }
    if (acc.ended) return null;
    const start = tu && tu.ix && tu.ix.phase === 'start' ? tu.ix : null;
    const ix = outputProgress(start, chunk, acc);
    if (!ix) return null;
    if (ix.phase === 'end') acc.ended = true;
    return { ...ix, ...(tuid ? { ref: tuid } : {}) };
  }

  /** 백그라운드 작업을 띄운 도구 호출(ref)·제목·비밀 여부 */
  _outputRef(nodeId) {
    const n = this.graph.get(nodeId);
    const tuid = n?.meta?.toolUseId;
    const tu = tuid ? this.tools.get(tuid) : null;
    const mode = n?.kind === 'monitor' ? 'monitor' : 'shell';
    return {
      ref: tu ? { nodeId: tu.owner, toolUseId: tuid } : { nodeId, toolUseId: null },
      title: tu?.panel?.title || (n?.meta?.command ? '$ ' + String(n.meta.command).split(/\r?\n/)[0] : n?.label || ''),
      secret: !!tu?.panel?.secret, mode,
    };
  }

  /** 출력 조각을 노드별 줄 꼬리에 더하고 꼬리 패널을 만든다(라이브·Monitor 알림). minimal 이면 null */
  _outputPanel(nodeId, chunk) {
    if (this.graph.privacy === 'minimal') return null;
    const m = this._outTail || (this._outTail = new Map());
    let lt = m.get(nodeId);
    if (!lt) { lt = new LineTail(PANEL_LIMITS.lines); m.set(nodeId, lt); }
    lt.push(chunk);
    const view = lt.view();
    const r = this._outputRef(nodeId);
    const p = tailPanel(r.title, view, r.ref, { secret: r.secret, mode: r.mode });
    const hidden = lt.total + (lt.partial.trim() ? 1 : 0) - view.length;
    if (!r.secret && hidden > 0) p.more = hidden;
    return p;
  }

  /** 재생(offline): 출력 전체 줄 중 앞 end 줄까지의 꼬리 패널(replay.mjs 4단계가 부름 — 라이브와 같은 규칙) */
  replayOutputPanel(nodeId, lines, end) {
    if (this.graph.privacy === 'minimal') return null;
    const r = this._outputRef(nodeId);
    const view = lines.slice(Math.max(0, end - PANEL_LIMITS.lines), end).map((l) => stripAnsi(l));
    while (view.length && !view[0].trim()) view.shift();
    const p = tailPanel(r.title, view, r.ref, { secret: r.secret, mode: r.mode });
    if (!r.secret && end > view.length) p.more = end - view.length;
    return p;
  }

  // ───────────── claude -p 자식 매칭 ─────────────

  async matchChildren() {
    const pending = this.children.filter((c) => !c.matched && !c.dead);
    if (!pending.length) return;
    const now = this.nowMs();
    let recent = null;
    for (const c of pending) {
      const ids = [c.sessionIdHint, ...c.stdoutIds].filter(Boolean);
      let found = null, link = null;
      for (const sid of ids) {
        if (sid === this.sessionId || this.watchers.has(sid)) continue;
        const e = this.index.findSession(sid);
        if (e) { found = e; link = { by: sid === c.sessionIdHint ? 'session-id' : 'stdout', confidence: 'high' }; break; }
      }
      if (!found) {
        recent = recent || await (this.offline && this.childWindow
          ? this.index.recentSdkChildren(this.childWindow[0], this.childWindow[1])
          : this.index.recentSdkChildren());
        const lo = c.tsMs - 2000;
        const hi = (c.endTsMs ?? now) + 2000;
        let best = null, bestScore = -1, bestDist = Infinity;
        const li = launcherIndexOf(this.index);
        for (const e of recent) {
          if (this.watchers.has(e.sessionId) || this._claimedElsewhere(e.sessionId)) continue;
          const la = li.peek(e.sessionId);
          if (la && !la.none) continue; // 기동기 회차로 판정된 것은 휴리스틱으로 가져가지 않는다
          const h = e.head;
          const t = Date.parse(h.firstTs);
          if (!(t >= lo && t <= hi)) continue;
          let score = 0;
          if (c.cwdGuess && h.cwd && normPath(c.cwdGuess) === normPath(h.cwd)) score += 2;
          // 프롬프트: 따옴표 인자·heredoc·echo 파이프 후보 중 하나(공백 접기·대소문자 무시, 앞 40자)
          if (promptMatches(c.promptHints || (c.promptHint ? [c.promptHint] : []), h.firstPrompt)) score += 2;
          // 자식 cwd 가 이 세션의 임시 폴더 안(<tmp>/claude/<enc>/<sid>/scratchpad…)이면 부모가 분명하다
          if (scratchOwnerOf(h.cwd, claudeTmpRoots()) === c.watcher?.sessionId) score += 2;
          const dist = Math.abs(t - c.tsMs);
          if (score > bestScore || (score === bestScore && dist < bestDist)) { best = e; bestScore = score; bestDist = dist; }
        }
        // 시간 창만 맞고 cwd·프롬프트가 하나도 맞지 않는 후보(score 0)는 남의 claude -p 일 수 있어 붙이지 않는다
        found = bestScore >= 2 ? best : null;
        if (found) link = { by: 'heuristic', confidence: bestScore >= 4 ? 'medium' : 'low' };
      }
      if (found) { await this.index.ensureHead(found); await this.index.ensureTitle(found).catch(() => {}); this.attachChild(c, found, link); }
      else if (c.endTsMs && now - c.endTsMs > 120_000 && !this.graph.loading) c.dead = true;
      else if (c.endTsMs && this.graph.loading && !ids.length) c.dead = true; // 과거 기록: 휴리스틱 1회만
    }
  }

  /**
   * 명령에 `claude -p` 가 보이지 않는 실행(스크립트가 띄움·변수로 감춤)도 부모가 분명하면 붙인다:
   * 자식 sdk-cli 세션의 cwd 가 이 런타임이 보는 세션(메인·claude -p 자식)의 임시 폴더(<tmp>/claude/<enc>/<sid>/…) 안.
   * 주인 노드 = 그 세션에서 자식의 첫 기록 시각에 돌고 있던 Bash/PowerShell 의 호출자(없으면 그 세션 노드).
   */
  async matchScratchChildren() {
    const sids = new Set([this.sessionId, ...this.watchers.keys()]);
    const recent = await (this.offline && this.childWindow
      ? this.index.recentSdkChildren(this.childWindow[0], this.childWindow[1])
      : this.index.recentSdkChildren());
    for (const e of recent) {
      const sid = e.sessionId;
      if (sids.has(sid) || this._claimedElsewhere(sid)) continue;
      const h = e.head || {};
      const psid = scratchOwnerOf(h.cwd, claudeTmpRoots());
      if (!psid || !sids.has(psid)) continue;
      const w = this.watchers.get(psid);
      if (!w) continue;
      const t = Date.parse(h.firstTs);
      if (!Number.isFinite(t)) continue;
      // 그 시각에 돌던 셸 호출(가장 늦게 시작한 것). 백그라운드 실행은 결과가 바로 와서 끝 시각 대신 시작 뒤 6시간까지 본다
      let tool = null;
      for (const tu of this.tools.values()) {
        if (!SHELL.has(tu.name) || tu.watcher?.sessionId !== psid) continue;
        const end = tu.ended && !tu.bg ? (tu.endMs ?? tu.tsMs) : tu.tsMs + 6 * 3600_000;
        if (tu.tsMs - 2000 <= t && t <= end + 2000 && (!tool || tu.tsMs > tool.tsMs)) tool = tu;
      }
      // 같은 호출을 이미 claude -p 로 감지했으면(매칭만 실패) 그 기록을 쓴다
      let c = tool ? this.children.find((x) => x.toolUseId === tool.id && !x.matched) : null;
      if (!c) {
        c = { toolUseId: tool?.id ?? null, owner: tool?.owner || w.nodeId, watcher: w, tsMs: tool?.tsMs ?? t,
          endTsMs: tool && tool.ended && !tool.bg ? (tool.endMs ?? null) : null, isError: false,
          sessionIdHint: null, promptHint: null, promptHints: [], cwdGuess: null, stdoutIds: [], matched: null, dead: false, implicit: true };
        this.children.push(c);
      }
      c.dead = false;
      await this.index.ensureTitle(e).catch(() => {});
      this.attachChild(c, e, { by: 'scratchpad', confidence: 'high' });
    }
  }

  /**
   * 기동기 회차: 판정은 프로젝트 공통 LauncherIndex.assign(전체 보기·다른 런타임과 같은 답).
   * - 답의 기동 명령이 이 런타임의 것이고 인계(adopter)가 없으면 그 기동기 노드 아래.
   * - 인계 메인이 이 런타임의 루트면 루트 아래 '이어받은 기동기' 노드(b:adopt-<기동 tool_use id>)를 두고 그 아래.
   * - 끝난 회차는 최근 BATCH_KEEP_ENDED 개만 노드로, 나머지는 기동기 meta.batch 집계로만.
   */
  async matchLauncherChildren() {
    const li = launcherIndexOf(this.index);
    const rootE = this.index.findSession(this.sessionId);
    const rootHead = rootE ? rootE.head : null;
    const canAdopt = rootE && rootHead && rootHead.entrypoint !== 'sdk-cli' && rootHead.firstTs;
    if (!this.launchNodes.size && !canAdopt) return;
    let since = canAdopt ? Date.parse(rootHead.firstTs) : Infinity;
    for (const L of this.launchNodes.values()) if (L.tsMs < since) since = L.tsMs;
    const dirs = new Set([...this.launchNodes.values()].map((L) => L.projectDir).filter(Boolean));
    if (canAdopt) dirs.add(rootE.projectDir);
    const until = this.offline && this.childWindow ? this.childWindow[1] : Infinity;
    const cands = (await this.index.recentSdkChildren(since - 2000, until))
      .filter((e) => dirs.has(e.projectDir) && !this.watchers.has(e.sessionId) && !this._claimedElsewhere(e.sessionId) && !this._inCycles(e.sessionId)
        && e.head?.firstTs && Date.parse(e.head.firstTs) >= since - 2000)
      .sort((a, b) => Date.parse(a.head.firstTs) - Date.parse(b.head.firstTs));
    const plan = new Map(); // L → [{e, a}]
    for (const e of cands) {
      const a = await li.assign(e);
      if (!a || a.none) continue;
      let L = null;
      if (a.adopter) {
        if (a.adopter === this.sessionId && canAdopt) L = this._adoptLauncher(a);
      } else {
        L = this.launchNodes.get(a.toolUseId) || null;
      }
      if (!L || !L.nodeId || !this.graph.has(L.nodeId)) continue;
      if (!plan.has(L)) plan.set(L, []);
      plan.get(L).push({ e, a });
    }
    const wall = this.offline ? Date.now() : this.nowMs();
    for (const [L, list] of plan) {
      L.cycles = L.cycles || new Map();
      // 지금 끝나 있는 회차: 프로세스 기록이 죽음, 또는 기록이 없고 다음 회차가 있거나 10분 넘게 조용
      const endedNow = list.map(({ e }, i) => {
        const proc = this.index.procs?.get?.(String(e.sessionId).toLowerCase());
        return proc ? !proc.alive : (i < list.length - 1 || wall - e.mtimeMs > 600_000);
      });
      const endedIdx = endedNow.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
      const collapse = new Set(endedIdx.slice(0, Math.max(0, endedIdx.length - BATCH_KEEP_ENDED)));
      for (let i = 0; i < list.length; i++) {
        const { e, a } = list[i];
        await this.index.ensureTitle(e).catch(() => {});
        const link = { by: 'launcher', confidence: a.confidence, evidence: a.evidence, ...(a.adopter ? { adoptedFrom: a.sessionId } : {}) };
        const startMs = Date.parse(e.head.firstTs);
        const R = this._runnerFor(L, e, startMs); // 러너가 있으면 회차는 러너 아래
        if (collapse.has(i)) {
          // 노드 없이 집계만: 독립 루트로도 안 뜨게 붙은 것으로 표시
          this.index.claimedChildren.add(e.sessionId);
          this.index.childParent?.set(e.sessionId, L.watcher.sessionId);
          const endMs = Date.parse(e.lastTs) || e.mtimeMs;
          L.cycles.set(e.sessionId, { sessionId: e.sessionId, nodeId: null, startMs, endMs: Math.max(startMs, endMs), status: 'done' });
          continue;
        }
        const c = { toolUseId: a.toolUseId, owner: R ? R.nodeId : L.nodeId, watcher: L.watcher, tsMs: startMs, endTsMs: null, isError: false,
          sessionIdHint: null, promptHint: null, promptHints: [], cwdGuess: null, stdoutIds: [], matched: null, dead: false, launcher: L.nodeId };
        this.children.push(c);
        L.cycles.set(e.sessionId, { sessionId: e.sessionId, nodeId: `s:${e.sessionId}`, startMs, endMs: null, status: 'active' });
        this.attachChild(c, e, link, L.cycles.size);
      }
      // 라이브: 회차가 붙은 즉시 장치 집계를 갱신(다음 sweep 까지 5초 늦지 않게). 재생은 sweep 이 시간축으로 깐다
      if (!this.offline) { const ln = this.graph.get(L.nodeId); if (ln && !isEnded(ln.status)) this._batchMeta(ln, L); }
    }
    // 기동기 끝(다시 띄움) 판정용: 기동 이후 프로젝트 transcript 의 기동 명령을 증분으로 읽어 둔다
    for (const d of dirs) li.primeProject(d, since - 2000);
  }

  /**
   * 러너 노드: 기동기(재기동기) → 러너 → 회차. 러너 스크립트는 기동기 사슬(runnerScriptOf), 러너 한 번 기동(인스턴스)은
   * 회차 첫 프롬프트 첫 줄(runnerSigOf)이 바뀔 때마다 새로(재기동기가 축마다 러너를 다시 띄움). 회차 시작 순으로 불려야 한다.
   * 기록(transcript·스크립트)만 보므로 라이브·재생·보관함·다른 PC 가 같은 답. 프로세스 PID 는 쓰지 않는다. 러너가 없으면 null
   */
  _runnerFor(L, e, startMs) {
    const script = runnerScriptOf(L.via, L.script);
    if (!script || !L.nodeId) return null;
    L.runners = L.runners || [];
    const sig = runnerSigOf(e.head?.firstPrompt);
    let R = L.runners[L.runners.length - 1];
    if (R && R.cycles.has(e.sessionId)) return R;
    if (!R || R.sig !== sig) {
      const k = L.runners.length + 1;
      const id = `${L.nodeId}-r${k}`;
      R = { nodeId: id, k, sig, L, cycles: new Set(), script };
      L.runners.push(R);
      this.runnerByNode.set(id, R);
      const ts = new Date(startMs).toISOString();
      if (this.offline && !this.spawnHints.has(id)) this.spawnHints.set(id, ts);
      if (!this.graph.has(id)) {
        this.graph.addNode({ id, parentId: L.nodeId, kind: 'bash-bg', label: `러너 · ${script}`, sessionId: L.watcher.sessionId,
          startedAt: ts, lastActivityAt: ts,
          meta: { background: true, runner: { script, instance: k, launcher: L.nodeId, evidence: ['script-chain', 'prompt-head'] },
            title: null } }, ts); // 첫 프롬프트 머리는 부제로 쓰지 않음
      }
    }
    R.cycles.add(e.sessionId);
    return R;
  }

  /** 인계: 끝난 세션이 띄운 기동기를 이 루트(메인) 아래 '이어받은 기동기' 노드로 */
  _adoptLauncher(a) {
    const key = `adopt:${a.toolUseId}`;
    let L = this.launchNodes.get(key);
    if (L) return L;
    const w = this.watchers.get(this.sessionId);
    const root = this.graph.get(`s:${this.sessionId}`);
    if (!w || !root) return null;
    const id = `b:adopt-${a.toolUseId}`;
    const via = (a.via || []).map((x) => String(x).split('/').pop());
    L = { nodeId: id, tsMs: a.tsMs, key: a.key, script: a.script, cwd: a.cwd || null, watcher: w, owner: root.id,
      projectDir: this.index.findSession(this.sessionId)?.projectDir ?? null, toolUseId: a.toolUseId, via, adopted: true };
    this.launchNodes.set(key, L);
    this.launcherByNode.set(id, L);
    const ts = new Date(a.tsMs).toISOString();
    if (this.offline && !this.spawnHints.has(id)) this.spawnHints.set(id, ts);
    if (!this.graph.has(id)) {
      // 이어받은 기동기는 띄운 세션보다 오래 산 것 = 부모가 끊긴 것 — 최상위, 이어받은 메인을 spawnedBy 로
      this.graph.addNode({ id, parentId: null, kind: 'bash-bg', label: `기동기 · ${a.script}`, sessionId: this.sessionId,
        startedAt: ts, lastActivityAt: ts,
        meta: { toolUseId: a.toolUseId, background: true, detached: true, spawnedBy: root.id, launcher: { script: a.script, via },
          adopted: { fromSession: a.sessionId, launchedAt: ts } } }, ts);
    }
    return L;
  }

  /**
   * 다른 루트의 런타임이 이미 붙인 자식인지. claimedChildren·childParent 는 SessionIndex(서버 프로세스 하나) 공용이라,
   * 같은 루트를 다시 적재(재생 재빌드·라이브 런타임 재생성)할 때 앞 런타임이 붙인 자식까지 건너뛰면 회차·claude -p 가 빠진다.
   * 띄운 세션(childParent)이 이 런타임이 보는 세션이면 이 트리의 자식이므로 다시 붙인다(적재 멱등).
   */
  /** 이 런타임의 기동기 묶음에 이미 든 회차(노드든 집계든)인지 */
  _inCycles(sid) {
    for (const L of this.launchNodes.values()) if (L.cycles?.has(sid)) return true;
    return false;
  }

  _claimedElsewhere(sid) {
    if (!this.index.claimedChildren.has(sid)) return false;
    const p = this.index.childParent?.get(sid);
    return !(p && (p === this.sessionId || this.watchers.has(p)));
  }

  attachChild(c, e, link = null, cycleNo = null) {
    const g = this.graph;
    const sid = e.sessionId;
    c.matched = sid;
    this.index.claimedChildren.add(sid);
    if (c.watcher?.sessionId && this.index.childParent) this.index.childParent.set(sid, c.watcher.sessionId);
    const id = `s:${sid}`;
    const h = e.head || {};
    const parent = g.get(c.owner);
    const depth = (parent?.depth ?? 0) + 1;
    const startTs = h.firstTs || new Date(c.tsMs).toISOString();
    if (!g.has(id)) {
      // customTitle > "claude -p · <sid8>"(부모와 같은 프로젝트) / "claude -p · <프로젝트> · <sid8>". aiTitle·첫 프롬프트는 meta.title
      const ps = c.watcher?.sessionId && this.lookupSession(c.watcher.sessionId);
      const label = e.customTitle || claudePLabel(sid, claudePProject(h.cwd, e.projectDir, this.lookupSession),
        ps ? claudePProject(ps.cwd, ps.projectDir, this.lookupSession) : null);
      const subtitle = e.aiTitle || null; // 첫 프롬프트는 부제로 쓰지 않음
      // 기동기 회차는 그 기동기 아래 몇 번째인지(meta.cycle)
      const cycle = c.launcher ? cycleNo : null;
      g.addNode({ id, parentId: c.owner, kind: 'claude-p', label,
        sessionId: sid, startedAt: startTs, lastActivityAt: startTs,
        meta: { toolUseId: c.toolUseId, cwd: h.cwd ?? null, command: c.launcher ? null : this.tools.get(c.toolUseId)?.input?.command?.slice(0, 4000) ?? null,
          title: subtitle ? sessionTitleMeta(subtitle) : null, ...(e.customTitle ? { customTitle: true } : {}),
          ...(link ? { link } : {}), ...(cycle ? { cycle } : {}) } }, startTs);
    }
    if (depth <= this.maxDepth && !this.watchers.has(sid)) {
      const w = this.addWatcher({ sessionId: sid, file: e.file, nodeId: id, kind: 'claude-p' });
      this.childTails.set(id, w.tail);
    }
  }

  // ───────────── 상태 정리 ─────────────

  /**
   * 기동기 meta.batch: 회차 묶음 집계(노드로 남은 회차 + 집계로만 남긴 회차). 바뀔 때만 node-update.
   * 재생(offline)은 한 번에 적재하므로 회차 시작·끝 시각마다 그 시점의 집계를 시각순 node-update 로 깔아 둔다
   * (마지막 회차 시작 때 한 번만 나오면 그 전 재생 구간의 장치 계수가 비어 있었다). 마지막 값은 라이브와 같은 지금 집계.
   */
  _batchMeta(n, L) {
    if (!L.cycles || !L.cycles.size) return;
    const g = this.graph;
    const items = [...L.cycles.values()].sort((a, b) => a.startMs - b.startMs);
    for (const it of items) {
      if (!it.nodeId) continue;
      const k = g.get(it.nodeId);
      if (k) { it.status = k.status; it.endMs = isEnded(k.status) ? (Date.parse(k.endedAt) || null) : null; }
    }
    const ends = items.filter((it) => isEnded(it.status) && Number.isFinite(it.endMs)).map((it) => it.endMs);
    if (this.offline && !L._batchTimeline) {
      L._batchTimeline = true;
      const pts = [...new Set([...items.map((it) => it.startMs), ...ends].filter(Number.isFinite))].sort((a, b) => a - b);
      for (const t of pts) this._emitBatch(n, L, batchOf(items, t), new Date(t).toISOString());
    }
    const lastPt = Math.max(...items.map((it) => it.startMs).filter(Number.isFinite), ...ends);
    this._emitBatch(n, L, batchOf(items, Infinity), maxIso(n.startedAt, Number.isFinite(lastPt) ? new Date(lastPt).toISOString() : null));
  }

  _emitBatch(n, L, batch, ts) {
    const key = JSON.stringify(batch);
    if (L._batchKey === key) return;
    L._batchKey = key;
    this.graph.updateNode(n.id, { meta: { batch } }, ts);
  }

  /**
   * 기동기 노드 상태. 끝: 같은 cwd 를 겨누는 기동을 나중에 다시 함(superseded)·부팅 전에 띄움(reboot)·마지막 회차 뒤
   * LAUNCH_GAP_MS 넘게 조용(gap). 끝나지 않았으면 회차가 돌 때 active, 아니면 일반 규칙(60초 뒤 idle). 끝냈으면 true.
   */
  _sweepLauncher(n, now, off) {
    const g = this.graph;
    const L = this.launcherByNode.get(n.id);
    if (!L) return false;
    this._batchMeta(n, L);
    // 회차 노드(러너가 있으면 러너 아래라 직속 자식이 아니다 — 묶음 기록으로 찾는다)
    const kids = [];
    for (const c of (L.cycles || new Map()).values()) { const k = c.nodeId ? g.get(c.nodeId) : null; if (k) kids.push(k); }
    for (const k of g.nodes.values()) if (k.parentId === n.id && k.kind === 'claude-p' && !kids.includes(k)) kids.push(k);
    let lastAct = n.startedAt;
    for (const k of kids) lastAct = maxIso(lastAct, k.lastActivityAt);
    const wall = off ? Math.max(now, Date.now()) : now;
    const sup = launcherIndexOf(this.index).supersededAt(L);
    let reason = null;
    if (sup != null && sup <= wall) reason = 'superseded';
    else if (L.tsMs < launcherIndexOf(this.index).bootMs()) reason = 'reboot';
    else if (wall - Date.parse(lastAct) > launcherIndexOf(this.index).gapMs) reason = 'gap';
    if (reason) {
      // 끝 시각 = 마지막 회차 활동(회차가 없으면 기동 시각). 실제 프로세스가 언제 죽었는지는 기록에 없다
      this.finish(n.id, true, maxIso(n.startedAt, lastAct), { meta: { endReason: reason } });
      return true;
    }
    if (kids.some((k) => !isEnded(k.status) && k.status === 'active')) {
      n.lastActivityAt = maxIso(n.lastActivityAt, lastAct);
      if (n.status !== 'active') g.updateNode(n.id, { status: 'active' }, lastAct);
      return true;
    }
    if (n.status === 'active' && Date.parse(n.lastActivityAt) < Date.parse(lastAct)) n.lastActivityAt = lastAct;
    return false;
  }

  /**
   * 러너 상태: 같은 기동기의 다음 러너가 떴으면(next-runner) 또는 기동기가 끝났으면(launcher-ended) done, endedAt = 그 러너
   * 마지막 회차 활동. 아니면 회차가 돌 때 active, 그 밖은 일반 규칙(60초 뒤 idle). 처리했으면 true
   */
  _sweepRunner(n, now, off) {
    const R = this.runnerByNode.get(n.id);
    if (!R) return false;
    const g = this.graph;
    const L = R.L;
    let lastAct = n.startedAt, anyActive = false;
    for (const sid of R.cycles) {
      const c = L.cycles?.get(sid);
      if (!c) continue;
      const k = c.nodeId ? g.get(c.nodeId) : null;
      if (k) { lastAct = maxIso(lastAct, k.lastActivityAt); if (k.status === 'active') anyActive = true; }
      else if (Number.isFinite(c.endMs)) lastAct = maxIso(lastAct, new Date(c.endMs).toISOString());
    }
    const ln = g.get(L.nodeId);
    const reason = L.runners.length > R.k ? 'next-runner' : (ln && isEnded(ln.status)) ? 'launcher-ended' : null;
    if (reason) { this.finish(n.id, true, lastAct, { meta: { endReason: reason } }); return true; }
    if (anyActive) {
      n.lastActivityAt = maxIso(n.lastActivityAt, lastAct);
      if (n.status !== 'active') g.updateNode(n.id, { status: 'active' }, lastAct);
      return true;
    }
    if (n.status === 'active' && Date.parse(n.lastActivityAt) < Date.parse(lastAct)) n.lastActivityAt = lastAct;
    return false;
  }

  /**
   * 기동기 회차(claude -p) 끝: 프로세스 기록(~/.claude/sessions)이 죽음 · 같은 기동기의 다음 회차가 시작함 ·
   * 프로세스 기록이 없고 파일이 10분 넘게 조용하며 열린 도구가 없음. 끝 시각은 마지막 기록. 끝냈으면 true.
   */
  _sweepCycle(n, c, now, off) {
    const g = this.graph;
    const proc = this.index.procs?.get?.(String(n.sessionId).toLowerCase());
    const start = Date.parse(n.startedAt);
    // 같은 기동기의 다음 회차(러너가 바뀌어도 같은 기동기면 다음 회차)
    const L = this.launcherByNode.get(c.launcher);
    const next = L && L.cycles
      ? [...L.cycles.values()].some((x) => x.sessionId !== n.sessionId && x.startMs > start)
      : [...g.nodes.values()].some((k) => k.parentId === n.parentId && k.kind === 'claude-p' && k.id !== n.id && Date.parse(k.startedAt) > start);
    const e = this.index.findSession?.(n.sessionId);
    const tail = this.childTails.get(n.id);
    const mtime = Math.max(tail?.mtimeMs || 0, e?.mtimeMs || 0);
    const wall = off ? Math.max(now, Date.now()) : now;
    let end = false;
    if (proc) end = !proc.alive;
    else end = next || (wall - mtime > 600_000 && !n.openTools.length);
    if (proc && proc.alive && next) end = false; // 프로세스가 살아 있으면 다음 회차가 떠도 끝내지 않는다(겹침)
    if (!end) return false;
    this.finish(n.id, true, maxIso(n.startedAt, n.lastActivityAt));
    return true;
  }


  sweep() {
    const g = this.graph;
    const now = this.nowMs();
    const off = this.offline;
    // 끝난 지 10분 지난 도구 호출은 입력(command 최대 2000자)을 비워 장시간 세션의 메모리 증가를 막는다.
    // owner·name 은 parentFor·중복 판정에 필요하므로 남긴다. 아직 매칭 안 된 claude -p 의 도구는 유지.
    if (!off && now - (this._lastSlim || 0) > 60_000) {
      this._lastSlim = now;
      const pendingTools = new Set(this.children.filter((c) => !c.matched && !c.dead).map((c) => c.toolUseId));
      for (const t of this.tools.values()) {
        if (t.slim || !t.ended || now - (t.tsMs || 0) < 600_000 || pendingTools.has(t.id)) continue;
        const i = t.input || {};
        t.input = { description: i.description, task_id: i.task_id, persistent: i.persistent, timeout_ms: i.timeout_ms, command: typeof i.command === "string" ? i.command.slice(0, 200) : undefined };
        t.slim = true;
      }
      // 항목 수 상한: 며칠씩 도는 세션은 끝난 도구가 수만 개 쌓인다. 넘으면 오래된(삽입 순) 끝난·줄인 항목부터 지운다
      if (this.tools.size > TOOLS_MAX) {
        for (const [id, t] of this.tools) {
          if (this.tools.size <= TOOLS_KEEP) break;
          if (t.slim && t.ended && !pendingTools.has(id)) this.tools.delete(id);
        }
      }
    }
    const nowIso = new Date(now).toISOString();
    // 기동기 노드는 회차들의 상태가 정해진 뒤(두 번째 차례)에 본다 — meta.batch 집계가 한 박자 늦지 않게
    const launchers = [], runners = [];
    const pass = (list, late) => { for (const n of list) {
      if (n.kind === 'monitor' && !isEnded(n.status) && n.meta.timeoutMs && !n.meta.persistent) {
        // offline(재생)도 만료 판정은 벽시계로 해야 끝까지 재생한 상태가 라이브와 같다(만료 시각은 시작+timeout)
        if (Date.parse(n.startedAt) + n.meta.timeoutMs + 5000 < (off ? Math.max(now, Date.now()) : now)) { this.finish(n.id, true, new Date(Date.parse(n.startedAt) + n.meta.timeoutMs).toISOString(), { meta: { expired: true } }); continue; }
      }
      if (n.kind === 'bash-bg' && n.meta?.launcher) {
        if (!late) { launchers.push(n); continue; }
        const L = this.launcherByNode.get(n.id);
        if (isEnded(n.status)) { if (L) this._batchMeta(n, L); continue; }
        if (this._sweepLauncher(n, now, off)) continue;
      }
      if (n.kind === 'bash-bg' && n.meta?.runner) {
        // 러너는 회차·기동기 상태가 정해진 뒤(세 번째 차례)
        if (!late) { runners.push(n); continue; }
        if (isEnded(n.status)) continue;
        if (this._sweepRunner(n, now, off)) continue;
      }
      if (n.kind === 'claude-p' && !isEnded(n.status)) {
        const c = this.children.find((x) => x.matched === n.sessionId);
        if (c && c.launcher) { if (this._sweepCycle(n, c, now, off)) continue; }
        else {
        const tail = this.childTails.get(n.id);
        if (c && c.endTsMs && (off || (now - c.endTsMs > 10_000 && tail && now - tail.mtimeMs > 10_000))) {
          const endIso = maxIso(n.lastActivityAt, new Date(c.endTsMs).toISOString());
          if (c.stopped) this.stop(n.id, endIso, 'parent-stopped');
          else this.finish(n.id, !c.isError, endIso);
          continue;
        }
        }
      }
      if (n.meta?.job) continue; // 작업 노드 상태는 작업 상태가 정한다(활동 공백으로 대기 전환하지 않음)
      if (n.status !== 'active') continue;
      const last = Date.parse(n.lastActivityAt) || 0;
      // offline: 대기 전환 시각은 마지막 활동 + 60초(가상 시계)
      const idleIso = off ? new Date(last + IDLE_MS).toISOString() : nowIso;
      if (SESSION_KINDS.has(n.kind)) {
        const live = off ? null : this.index.liveStatus(n.sessionId);
        if (live === 'busy') continue;
        if (now - last > IDLE_MS || (live && live !== 'busy' && now - last > 5000)) g.updateNode(n.id, { status: 'idle' }, idleIso);
      } else if (n.kind === 'workflow') {
        const anyActive = [...g.nodes.values()].some((c) => c.parentId === n.id && c.status === 'active');
        if (!anyActive && now - last > IDLE_MS) g.updateNode(n.id, { status: 'idle' }, idleIso);
      } else if (now - last > IDLE_MS) {
        g.updateNode(n.id, { status: 'idle' }, idleIso);
      }
    } };
    pass([...g.nodes.values()], false);
    pass(launchers, true);
    pass(runners, true);
    if (!off) this._jobFiles();
  }

  // ───────────── 작업(Job) 오브젝트 ─────────────

  /** 루트 cwd·프로젝트 폴더(작업 규칙의 project 조건) */
  _jobCtx() {
    const root = this.graph.get(`s:${this.sessionId}`);
    const sess = this.index.findSession?.(this.sessionId);
    return { cwd: root?.meta?.cwd || sess?.head?.cwd || null, projectDir: sess?.projectDir || null };
  }

  /** 작업 장부(처음 부를 때 만듦). 라이브는 5초마다 규칙 파일을 다시 확인(mtime 캐시) */
  _jobBook() {
    if (!this._jobs) {
      const ctx = this._jobCtx();
      this._jobs = new JobBook({ rules: this._jobRulesNow(ctx), privacy: this.privacy, ctx });
      this._jobRulesAt = Date.now();
    } else if (!this.offline && this._jobRulesOpt === undefined && Date.now() - (this._jobRulesAt || 0) > 5000) {
      this._jobRulesAt = Date.now();
      this._jobs.ctx = this._jobCtx();
      this._jobs.setRules(this._jobRulesNow(this._jobs.ctx));
    }
    return this._jobs;
  }
  _jobRulesNow(ctx) {
    if (this._jobRulesOpt !== undefined) return this._jobRulesOpt;
    try { return loadJobRules({ stateDir: ccvizHome(), cwd: ctx.cwd }); } catch (e) { log('job rules', e); return null; }
  }

  /** 작업이 붙는 주인 열쇠: 재무장 Monitor 사슬(meta.rearmOf)의 머리 — 다시 건 Monitor 도 같은 작업 노드를 잇는다 */
  _jobOwnerKey(id) {
    let cur = id, g = 0;
    while (g++ < 64) {
      const p = this.graph.get(cur)?.meta?.rearmOf;
      if (!p || !this.graph.has(p)) break;
      cur = p;
    }
    return cur;
  }

  /**
   * 출력 조각 → 작업 노드(라이브 _flushOutput · Monitor 알림 · 재생 4단계 · 설정 파일 꼬리가 부름).
   * streamId = 출력을 낸 노드(파일이면 'file:<경로>'), ownerId = 작업을 붙일 노드(기본 streamId).
   */
  jobFeed(streamId, text, ts, { ownerId = null, file = false, final = false } = {}) {
    if (!text) return;
    const oid = ownerId || streamId;
    const owner = this.graph.get(oid);
    if (!owner || owner.meta?.job) return;
    const key = this._jobOwnerKey(oid);
    const ups = this._jobBook().feed(streamId, key, text, ts, { owner, file, final });
    for (const u of ups) this._jobEmit(owner, key, u, ts);
  }

  _jobEmit(owner, key, u, ts) {
    const g = this.graph;
    const id = jobNodeId(key, u.jobId);
    const job = u.job;
    const status = jobNodeStatus(job.state);
    const title = job.phase || null; // 부제 = 지금 단계
    if (!g.has(id)) {
      if (this.offline && !this.spawnHints.has(id)) this.spawnHints.set(id, ts);
      // 새 노드는 active 로 낸 뒤 실제 상태로 고친다(재생 1단계가 node-add 를 active 로 다시 쓰므로 라이브·재생이 같은 이벤트)
      g.addNode({ id, parentId: owner.id, kind: 'bash-bg', label: jobLabel(job), sessionId: owner.sessionId,
        startedAt: ts, lastActivityAt: ts, status: 'active',
        meta: { job, title, background: true, jobOwner: key } }, ts);
      if (status !== 'active') g.updateNode(id, { status, endedAt: isJobEnded(job.state) ? (job.endedAt || ts) : null }, ts);
      return;
    }
    const n = g.get(id);
    const patch = { status, label: jobLabel(job), lastActivityAt: maxIso(n.lastActivityAt, ts), meta: { job, title } };
    patch.endedAt = isJobEnded(job.state) ? (n.endedAt && isEnded(n.status) ? n.endedAt : (job.endedAt || ts)) : null;
    if (n.parentId !== owner.id) patch.parentId = owner.id; // 재무장 Monitor: 새 Monitor 아래로 옮김(같은 노드)
    g.updateNode(id, patch, ts);
  }

  /**
   * 설정 묶음 files(예: 러너 출력 파일)의 꼬리 — 라이브만(기록 밖 파일이라 재생·보관함에는 없다). 읽기 전용.
   * 주인 = 끝나지 않은 마지막 러너(없으면 기동기) · 'launcher' · 'main'. 경로는 루트 cwd 기준.
   */
  _jobFiles() {
    if (this.closed) return;
    const book = this._jobBook();
    const R = book.rules;
    if (!R || !R.sets.some((s) => s.files.length)) return;
    const ctx = book.ctx;
    const nodes = [...this.graph.nodes.values()];
    const latest = (pred) => nodes.filter((n) => pred(n) && !isEnded(n.status)).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0] || null;
    const F = this._jobFileTails || (this._jobFileTails = new Map());
    for (const set of R.sets) {
      if (!set.files.length || !setMatchesProject(set, ctx)) continue;
      for (const f of set.files) {
        let owner;
        if (f.owner === 'runner') owner = latest((n) => n.meta?.runner) || latest((n) => n.meta?.launcher);
        else if (f.owner === 'launcher') owner = latest((n) => n.meta?.launcher);
        else owner = this.graph.get(`s:${this.sessionId}`);
        let ent = F.get(f.path);
        if (!owner) { if (ent) ent.ownerId = null; continue; }
        if (!ent) {
          const abs = path.isAbsolute(f.path) ? f.path : (ctx.cwd ? path.resolve(ctx.cwd, f.path) : null);
          if (!abs) continue;
          const max = f.backlogKB * 1024;
          let cut = false;
          try { cut = fs.statSync(abs).size > max; } catch {}
          ent = { abs, ownerId: owner.id, first: true };
          ent.tail = new FileTail(abs, { mode: 'text', maxInitialText: max, onText: (s, info) => {
            if (!ent.ownerId) return;
            if (ent.first) { ent.first = false; if (cut) { const i = s.indexOf('\n'); s = i >= 0 ? s.slice(i + 1) : ''; } } // 잘린 첫 줄 버림
            const ts = info.backlog && ent.tail.mtimeMs ? new Date(ent.tail.mtimeMs).toISOString() : this.nowIso();
            this.jobFeed('file:' + f.path, s, ts, { ownerId: ent.ownerId, file: true });
          } });
          F.set(f.path, ent);
          this.addTail(abs, ent.tail);
        }
        ent.ownerId = owner.id;
      }
    }
  }
}

