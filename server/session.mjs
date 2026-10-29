// 세션 루트 하나(메인 + 그 아래 전부)의 수집 런타임
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Graph } from './graph.mjs';
import { toolBrief, resultBrief, textBrief } from './brief.mjs';
import { redact } from './redact.mjs';
import { inputPanel, resultPanel, tailPanel, sayPanel, progressPanel, sanitizePanel, LineTail, splitLines, stripAnsi, collapseCR, PANEL_LIMITS } from './panel.mjs';
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
import { PlanTracker, planStart, planFromRaw } from './plans.mjs'; // 계획 보드
import { loopAxesPlan } from './loop-axes.mjs'; // 자율 루프 판 — 축 큐 어댑터
import { classifyStart, classifyEnd, outputProgress, IxTracker, classifyUserMessage, USER_DENY_RE, ixSnip } from './interactions.mjs'; // 특별 상호작용
import { JobBook, loadJobRules, jobNodeId, jobNodeStatus, jobLabel, isJobEnded, setMatchesProject } from './jobs.mjs'; // 작업 오브젝트
import { ccvizHome } from './home.mjs';
import { sharedExtJobs, extJobView, extJobIx, EXT } from './extjobs.mjs'; // 외부 작업 등록부
import { parseProgressLine } from './progress.mjs';
import { detectProcLaunch, commandPathRefs, isWaitCommand, scanEnd, quietEndSec, killTargets, pidHintOf, normFile, PROC, pushGap, exitMarkerOf, bufferWhy, redirectLogs } from './procs.mjs'; // 분리 프로세스 · 장시간 실행

const SHELL = new Set(['Bash', 'PowerShell']);
const SESSION_KINDS = new Set(['main', 'claude-p']);
/** 서브에이전트 진행 → 부모 Agent 패널 갱신 간격(같은 패널은 이 안에서 합침) */
export const PANEL_MERGE_MS = 250;
const IDLE_MS = 60_000;
const EPOCH = '1970-01-01T00:00:00.000Z';
const OFFLINE_OUTPUT_MAX = 1 << 20; // offline: 출력 파일 꼬리 1MB
// 포그라운드 셸 출력 매칭: 새 파일 보류(백그라운드 결과가 먼저 올 틈) · 짝 없으면 포기 · tool_use 기록이 파일보다 늦게 찍히는 여유
const FG_HOLD = 1200, FG_GIVEUP = 8000, FG_SLACK = 2000;
export const TOOLS_MAX = 5000; // 라이브 tools Map 상한(넘으면 TOOLS_KEEP 까지 오래된 끝난 항목 삭제)
export const TOOLS_KEEP = 4000;
/** 기동기 아래 끝난 회차를 노드로 남기는 수(나머지는 meta.batch 집계로만) */
export const BATCH_KEEP_ENDED = 2;
/** 장시간 실행 표시: lastOut 만 바뀐 meta.run 갱신은 이 간격에 한 번 이하 */
export const RUN_EMIT_MS = 5000;
/**
 * 띄운 세션이 끝난 bg 작업 닫기 문턱. GRACE_MS = 세션 끝(또는 마지막 출력) 뒤 이만큼 조용하면 닫는다(라이브 — 끝 표지가
 * 늦게 붙는 경합 대비) · PROC_GONE_MS = 프로세스 기록이 이만큼 계속 없어야 '죽음'(clear 의 pid 파일 sessionId 교체 경합 대비)
 * · ENTRYPOINTS = 프로세스 기록(~/.claude/sessions/<pid>.json)을 쓰는 것이 확인된 진입점(그 밖은 기록 부재를 증거로 쓰지 않음)
 */
export const SESSION_END = { GRACE_MS: 30_000, PROC_GONE_MS: 10_000, ENTRYPOINTS: new Set(['cli', 'sdk-cli']) };
/** 포그라운드 셸이 열려 있는 동안 대기 금지의 상한 = 호출 timeout(없으면 Bash 최대 10분) + 여유 1분(결과 없이 버려진 호출 대비) */
const FG_DEFAULT_TIMEOUT_MS = 600_000, FG_HOLD_SLACK_MS = 60_000;
export function fgHoldMs(tu) {
  const t = Number(tu?.input?.timeout);
  return (Number.isFinite(t) && t > 0 ? Math.min(t, 24 * 3600_000) : FG_DEFAULT_TIMEOUT_MS) + FG_HOLD_SLACK_MS;
}
const BG_LOG_BACKLOG = 256 * 1024;

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
    // 프로세스 끝: 마지막 기록 시각 · '/clear' 대기열 뒤(그 cost-state 는 프로세스 끝이 아님) · 끝 판정 · 기록 부재 첫 관측
    this.lastTs = null;
    this.clearPending = false;
    this.clearEnded = false;
    this.exit = null; // {iso, why:'exit'|'proc'}
    this.procGoneAt = null;
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
  constructor({ sessionId, index, privacy = 'summary', maxDepth = 8, offline = false, jobRules = undefined, extJobs = undefined }) {
    this.sessionId = sessionId;
    // 외부 작업 등록부: undefined = 프로세스 공용(<상태 폴더>/jobs), null = 끔, 객체 = 시험용 ExtJobRegistry. 라이브만
    this._ext = offline ? null : extJobs === undefined ? sharedExtJobs() : extJobs;
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
    // 포그라운드 셸 실시간 출력(라이브 전용): 열린 호출 id · 연결(호출 id → 기록) · 파일 → 연결 · 보류 중인 새 파일 · 무시할 파일
    this._fg = { open: new Set(), byTu: new Map(), byFile: new Map(), seen: new Map(), ignore: new Set(), dueAt: 0 };
    this.children = []; // claude -p 대기 목록
    this.launchNodes = new Map(); // 기동기: 기동 tool_use id(인계는 adopt:<id>) → {nodeId, tsMs, key, script, cwd, watcher, owner, projectDir, cycles}
    this.launcherByNode = new Map(); // 기동기 노드 id → 위 레코드
    this.runnerByNode = new Map(); // 러너 노드 id → {nodeId, k, sig, L, cycles:Set<sid>}
    // 분리 프로세스: 노드 id → 기록 · 로그 파일·출력 폴더(정규화) → 노드 id 들 · 띄운 호출 id → 노드 id 들
    this.procs = new Map();
    this.procByPath = new Map();
    this.procByTu = new Map();
    this._watchTu = new Map(); // 백그라운드 셸·Monitor 들여다보기: 호출 id → {peers, kind, via} (결과에서 노드가 정해지면 묶음)
    this._watchFg = new Map(); // 포그라운드 들여다보기: 호출 id → [프로세스 노드 id]
    this.watchStream = new Map(); // 프로세스 로그를 비추는 백그라운드 셸·Monitor 노드 id → 프로세스 노드 id
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
    for (const p of (this._pendingLogs || []).splice(0)) { const n = this.graph.get(p.id); if (n && !isEnded(n.status)) this._startBgLogs(p.id, p.files, p.w, Date.parse(n.startedAt), false); }
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
      await this._fgScan(all);
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
    for (const r of this._fg.byTu.values()) { r.closed = true; if (r.timer) clearTimeout(r.timer); }
    this._fg.byTu.clear(); this._fg.byFile.clear(); this._fg.seen.clear(); this._fg.open.clear();
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
        if (!backlog && (!n.endedAt || ts > n.endedAt)) {
          const rs = this._runs?.get(id);
          if (rs && rs.kind === 'bg' && rs.ended != null) { rs.ended = null; g.updateNode(id, { status: 'active', endedAt: null, meta: { run: this._runPub(rs) } }, ts); } // 되살아남
          else g.updateNode(id, { status: 'active', endedAt: null }, ts);
        }
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
    const rm = this._runEndMeta(id, patch.endedAt); // meta.run.ended·rc
    if (rm) patch.meta = { ...(patch.meta || {}), ...rm };
    this.graph.updateNode(id, patch, ts);
    if (n.kind === 'bash-bg') this._closeBgLogs(id);
    this._closeOpenTools(n, ts);
    if (n.kind === 'workflow' && this._planT) this._planT.workflowEnd(id, ok, ts); // 끝난 워크플로 단계
    if (this._jobs && !n.meta?.job) this._autoJobEnd(id, ok ? 'done' : 'failed', ts); // 자동 진행 작업도 끝
  }

  /**
   * 일부러 끈 작업 → '중지됨'. reason: taskstop(TaskStop/KillShell) · kill-cmd(끄는 셸 명령 직후 failed 알림)
   * · signal(종료 코드 130/137/143) · time-limit(백그라운드 시간 한도) · killed(알림 killed·출력 끝 [killed]) · orphan(세션 종료로 정리)
   * · session-end(띄운 세션이 끝났는데 끝 표지·알림이 없음 — 종료 코드 미상)
   */
  stop(id, ts, reason) {
    const n = this.graph.get(id);
    if (!n) return;
    const keep = n.endedAt && n.status === 'stopped' && n.meta?.stopReason !== 'session-end'; // 끊김 추정 뒤의 진짜 끝은 제 시각
    const patch = { status: 'stopped', endedAt: keep ? n.endedAt : ts, meta: { killed: true, stopReason: reason } };
    if (n.meta?.skill) patch.meta.skill = null;
    const rm = this._runEndMeta(id, patch.endedAt);
    if (rm) Object.assign(patch.meta, rm);
    this.graph.updateNode(id, patch, ts);
    if (n.kind === 'bash-bg') this._closeBgLogs(id);
    this._closeOpenTools(n, ts);
    this._failed.delete(id);
    if (this._jobs && !n.meta?.job) this._autoJobEnd(id, 'done', ts);
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
    const closed = n.openTools.splice(0);
    for (const t of closed) {
      this.graph.emit({ ts, type: 'tool-end', nodeId: n.id, toolUseId: t.toolUseId, tool: t.tool, cat: t.cat, ok: true, durationMs: Math.max(0, Date.parse(ts) - Date.parse(t.startedAt)) || 0, text: '' });
    }
    if (closed.length && this._runs) { for (const t of closed) { const r = this._runs.get(t.toolUseId); if (r && r.kind === 'fg') { this._runs.delete(t.toolUseId); this._fgAutoEnd(t.toolUseId, n.id, ts, true); } } this._runFgSync(n.id, ts); }
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
    // 세션(메인·claude -p) 프로세스 끝 추적: 이 watcher 의 마지막 기록 시각(서브에이전트 기록 포함), 대화가 이어지면(재개) 끝 판정 해제
    if (rec.timestamp && isoOr(rec.timestamp, null)) w.lastTs = maxIso(w.lastTs, ts);
    if (ownerId === w.nodeId && (rec.type === 'user' || rec.type === 'assistant')) { w.clearPending = false; w.clearEnded = false; w.exit = null; w.procGoneAt = null; }
    this._recCwd = rec.cwd || null; // 기동 명령의 cwd(서브에이전트 기록 포함)
    if (ownerId === w.nodeId && rec.cwd && w.cwd !== rec.cwd) {
      w.cwd = rec.cwd;
      g.updateNode(ownerId, { meta: { cwd: rec.cwd } }, ts);
    }
    // /clear 뒤 세션은 기록의 sessionId 와 임시 폴더 세션 ID 가 다르다 — 레코드 최상위 session_id(실측: 임시 폴더 tasks/ 의 세션 ID)
    if (typeof rec.session_id === 'string' && rec.session_id !== w.sessionId) this._noteTmpSession(w, rec.session_id);
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
      case 'queue-operation':
        // 알림이 대기열 기록(enqueue)에만 남는 경우가 있다(전달 전 세션이 끝남 등 — 실측). user·attachment 로 다시 오면 seenNotif 가 거른다
        if (rec.operation === 'enqueue' && isTaskNotification(rec.content)) return this.onNotification(rec.content, node, w, ts, backlog);
        if (ownerId === w.nodeId && rec.operation === 'enqueue' && String(rec.content || '').trim() === '/clear') w.clearPending = true;
        return;
      case 'cost-state':
        // Claude Code 가 프로세스를 끝낼 때(헤드리스 claude -p 끝·/exit) 세션 transcript 에 남기는 마지막 기록. '/clear' 뒤의 것은 프로세스가 산다
        if (ownerId === w.nodeId) this._sessionExit(w, 'exit');
        return;
      default:
        return; // attachment, api-request* 등 무시
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
          task_id: input.task_id || input.shell_id, persistent: input.persistent, timeout_ms: input.timeout_ms, timeout: input.timeout },
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
        // 분리 프로세스: 기동기가 아닌 프로그램·스크립트를 포그라운드 셸이 떼어 띄움
        else if (id && !input.run_in_background) this._procLaunch(id, node, w, ts, input, name);
        // run_in_background 명령이 출력을 로그 파일로 돌리면(> log·| tee log) 그 파일을 bg 노드의 둘째 출력 줄기로(라이브만)
        else if (id && input.run_in_background && !this.offline && !this.index.taskRoots) {
          let logs = [];
          try { logs = redirectLogs(input.command, { tool: name, cwd: this._recCwd || w.cwd || node.meta.cwd || null }); } catch (e) { log('bglog', e?.message || e); }
          if (logs.length) this.tools.get(id).bgLogs = logs;
        }
      }
      // 포그라운드 셸이 열려 있는 동안 그 노드의 meta.run(kind fg)
      if (id && !input.run_in_background) this._runFgStart(id, node, ts, input.command, name);
      // 포그라운드 셸: 실행 중 tasks/<무작위 id>.output 을 이 호출에 잇기 위해 열린 목록에 둔다(라이브만, 보관함 제외)
      if (!input.run_in_background && id && !this.offline && !this.index.taskRoots) this._fg.open.add(id);
      // 포그라운드에서 프로세스를 끄는 명령(taskkill·Stop-Process·kill …) → 곧 올 failed 알림을 '중지됨'으로
      if (!input.run_in_background && isKillCommand(input.command)) { this._noteKill(Date.parse(ts)); this._procKill(input.command, ts); }
    }
    // 들여다보기: 셸·Monitor 명령이 분리 프로세스의 로그(또는 산출 폴더)를 읽거나 기다림
    if (id && (SHELL.has(name) || name === 'Monitor') && typeof input.command === 'string' && this.procs.size) this._watchStart(id, node, w, ts, name, input);
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
    const fgRun = this._runFgEnd(tuid, owner.id, ts); // (포그라운드에서 넘어간 백그라운드 작업은 ensureBg 가 이어받음)
    if (fgRun && tu) tu._fgRun = fgRun;
    this._fgAutoEnd(tuid, owner.id, ts, ok);
    if (this._fg.open.delete(tuid) || this._fg.byTu.has(tuid)) this._fgDrop(tuid, { flush: false }); // 결과 패널이 꼬리를 대신하므로 남은 조각은 버림
    if (!ok) owner.counts.errors++;
    const durationMs = tu ? Math.max(0, Date.parse(ts) - tu.tsMs) || 0 : 0;
    const bodyText = textOfContent(item.content);
    const tur = rec.toolUseResult && typeof rec.toolUseResult === 'object' ? rec.toolUseResult : (ok ? inferToolUseResult(name, bodyText) : null);
    if (tur && typeof tur.outputFile === 'string' && /\.output$/i.test(tur.outputFile)) w.tasksDirs.add(path.dirname(tur.outputFile)); // 비동기 Agent 등의 출력 폴더
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
    if (tu && tu.plan) { this._plans().end(tu.plan, { ok, tur, nodeId: owner.id, ts }); tu.plan = null; }

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
    } else if (SHELL.has(name)) {
      if (tur && tur.backgroundTaskId) this.ensureBg(tur.backgroundTaskId, owner, w, tu, ts, bodyText, tur);
      if (tur && tur.backgroundTaskId) this._watchBind(tuid, `b:${tur.backgroundTaskId}`, ts);
      if (this.procByTu.has(tuid)) this._procLaunchResult(tuid, tu, tur, bodyText); // PID 힌트
      if (this._watchFg.has(tuid)) this._watchEnd(tuid, tur, bodyText, ts); // 들여다본 결과
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
      this._watchBind(tuid, `m:${tur.taskId}`, ts);
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
    // 시작 = 원래 tool_use 시각(포그라운드로 돌다 넘어간 작업은 결과 기록이 한참 뒤)
    const since = tu?.ts && tu.ts < ts ? tu.ts : ts;
    const run = !lr ? this._runBgStart(id, Date.parse(since), cmd, tu?._fgRun || null, null, tu?.name || 'Bash') : null;
    if (!g.has(id)) {
      const det = !!(lr && lr.detached); // run_in_background 안에서도 nohup·& 로 떼어 냈으면 최상위
      g.addNode({ id, parentId: det ? null : owner.id, kind: 'bash-bg', label: lr ? `기동기 · ${lr.script}` : (tu?.input?.description || cmd.slice(0, 60) || taskId),
        sessionId: w.sessionId, startedAt: since, lastActivityAt: ts,
        meta: { toolUseId: tu?.id ?? null, command: cmd.slice(0, 200), background: true, ...(det ? { detached: true, spawnedBy: owner.id } : {}),
          taskId, timedOutAfterMs: tur?.timedOutAfterMs ?? null,
          ...(run ? { run: this._runPub(run) } : {}),
          ...(lr ? { launcher: { script: lr.script, via: lr.via }, title: tu?.input?.description ? String(tu.input.description).slice(0, 120) : null } : {}) } }, ts);
    } else if (run && !g.get(id).meta.run) {
      g.updateNode(id, { meta: { run: this._runPub(run) } }, ts);
    }
    // bg 로그 파일 꼬리(라이브만): 첫 적재 중이면 적재 뒤 끝나지 않은 것만
    if (run && tu?.bgLogs?.length && !this.offline && !this.index.taskRoots) {
      if (g.loading) (this._pendingLogs || (this._pendingLogs = [])).push({ id, files: tu.bgLogs, w });
      else this._startBgLogs(id, tu.bgLogs, w, Date.parse(since), true);
    }
    this.taskMap.set(taskId, id);
    if (w) (this._bgW || (this._bgW = new Map())).set(id, w); // 띄운 세션(프로세스 끝 판정 단위)
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
    g.emit({ ts, type: 'user', nodeId: node.id, origin: 'task-notification', text: oneLine(summary), ...(node.kind === 'main' ? { ix: this._notifyIx(n) } : {}) }); // 자동 알림 · 출처 노드(Monitor 출력·작업 결과)
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

  /**
   * 메인에 들어온 작업 알림의 ix. 출처 노드를 알면 from(노드 id)을 싣는다 — Monitor 출력 이벤트 = src 'monitor'(text = 출력 한 줄),
   * 끝 알림(status) = src 'notify' + st ok·err·stop(text = 요약 한 줄). 출처를 모르거나 Monitor 만료·상태 없는 알림은 예전 회색 점(src 'notify'만)
   */
  _notifyIx(n) {
    const ix = { v: 1, cat: 'user', op: 'auto', src: 'notify', phase: 'end' };
    const g = this.graph, tid = n.taskId;
    const target = tid ? (this.taskMap.get(tid) || [`a:${tid}`, `b:${tid}`, `m:${tid}`, `w:${tid}`].find((x) => g.has(x))) : null;
    const tn = target ? g.get(target) : null;
    if (!tn) return ix;
    const ev = String(n.event || '');
    if (tn.kind === 'monitor' && ev && !n.status && !/^\[(Monitor expired|killed)/.test(ev)) {
      ix.src = 'monitor'; ix.from = target;
      const t = ixSnip(ev); if (t) ix.text = t;
    } else if (n.status) {
      ix.from = target;
      ix.st = n.status === 'completed' ? 'ok' : n.status === 'failed' ? 'err' : 'stop';
      const t = ixSnip(n.summary || ''); if (t) ix.text = t;
    }
    return ix;
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
      const rs = this._runs?.get(target);
      const rc = exitCodeOf(n.summary);
      if (rs && rc != null && rs.rc == null && this._bgOpenOrCut(t)) rs.rc = rc; // meta.rc
      // 출력 끝 표지로 이미 같은 상태로 끝냈으면 알림은 겹친 것
      const want = st === 'completed' ? 'done' : st === 'failed' ? 'error' : stopReason ? 'stopped' : null;
      const dup = this._exitBy?.has(target) && isEnded(t.status) && (want === t.status || (want === 'error' && t.status === 'stopped'));
      if (dup) { /* 그대로 */ } else if (st === 'completed') this.finish(target, true, ts);
      else if (st === 'failed') { if (t.status !== 'stopped' || t.meta?.stopReason === 'session-end') this._finishFailed(target, n, ts); }
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
    } else if (rec.subtype === 'scheduled_task_fire') {
      // 예약 작업(정시 보고 등)이 연 메인 턴. 뒤따르는 프롬프트 user 기록은 isMeta 라 버려진다 — 이 기록이 그 턴의 시작 표지
      if (node.kind === 'main' && !rec.isSidechain) {
        const raw = typeof rec.prompt === 'string' && rec.prompt ? rec.prompt : typeof rec.content === 'string' ? rec.content : '';
        const text = userTextSummary(raw);
        if (text) {
          const sn = ixSnip(raw);
          g.emit({ ts, type: 'user', nodeId: node.id, origin: 'schedule', text, ix: { v: 1, cat: 'user', op: 'auto', src: 'schedule', phase: 'end', ...(sn ? { text: sn } : {}) } });
        }
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

  // ───────────── 포그라운드 셸 실시간 출력 ─────────────
  // Claude Code 는 포그라운드 Bash·PowerShell 도 실행 중에 <임시>/<인코딩 cwd>/<세션ID>/tasks/<무작위 id>.output 에 출력을 쓰고
  // 끝나면 지운다. 그 id 는 transcript 에 남지 않아 로는 못 찾으므로, 세션 tasks 폴더에 생긴 '모르는 id' 새 파일을
  // 같은 세션(메인 + 서브에이전트 — 서브에이전트 출력도 부모 세션 폴더에 생김) 안의 아직 결과가 없는 포그라운드 셸 호출에 잇는다.

  /** 임시 폴더 세션 ID(기록 sessionId 와 다를 때, /clear 뒤) → 그 tasks 폴더를 이 세션이 아는 폴더로 */
  _noteTmpSession(w, sid) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)) return;
    const S = w.tmpSessions || (w.tmpSessions = new Set());
    if (S.has(sid) || S.size >= 8) return;
    S.add(sid);
    const encs = new Set([w.cwd ? encodeCwd(w.cwd) : null, path.basename(w.projectPath)].filter(Boolean));
    for (const r of (this.index.taskRoots || claudeTmpRoots())) for (const e of encs) w.tasksDirs.add(path.join(r, e, sid, 'tasks'));
  }

  /**
   * 이 세션의 tasks 폴더 후보: 기록에서 알게 된 폴더 전부(백그라운드 작업·Agent·Monitor 의 출력 파일 폴더, 임시 폴더 세션 ID
   * /clear 뒤엔 세션 ID 가 기록과 다름) + 임시 루트/<인코딩 cwd>/<세션ID>/tasks(없어도 넣어 둠 — 생기면 잡힘)
   */
  _fgDirs(w) {
    const out = new Set();
    for (const d of w.tasksDirs) out.add(path.normalize(d));
    const encs = new Set([w.cwd ? encodeCwd(w.cwd) : null, path.basename(w.projectPath)].filter(Boolean)); // 프로젝트 폴더 이름도 같은 인코딩
    for (const r of claudeTmpRoots()) for (const e of encs) out.add(path.normalize(path.join(r, e, w.sessionId, 'tasks')));
    return [...out];
  }

  /** 이미 다른 경로(백그라운드 bash·Monitor·워크플로)로 아는 task id */
  _fgKnown(id) {
    return this.taskMap.has(id) || this.outputs.has(`b:${id}`) || this.outputs.has(`m:${id}`) || this.graph.has(`w:${id}`);
  }

  /**
   * 매칭: 같은 watcher 의 열린(결과 없음·아직 파일 없음) 포그라운드 셸 호출 중
   * tool_use 가 파일 생성보다 먼저(기록 지연 여유 FG_SLACK)이고 생성 시각과 가장 가까운 것
   */
  _fgPick(w, birthMs) {
    let best = null, bd = Infinity;
    for (const id of this._fg.open) {
      if (this._fg.byTu.has(id)) continue;
      const t = this.tools.get(id);
      if (!t || t.watcher !== w || t.ended) continue;
      if (!(t.tsMs <= birthMs + FG_SLACK)) continue;
      const d = Math.abs(birthMs - t.tsMs);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /** 500ms 폴링 끝에 1초 간격으로: 닫힌 호출 내림 → tasks 폴더 훑기 → 새 파일 보류·매칭 → 사라진 파일 끊기 */
  async _fgScan(all = false) {
    const F = this._fg;
    if (this.offline || this.index.taskRoots || this.closed) return; // 재생·보관함 무관(실시간 전용)
    if (!F.open.size && !F.byTu.size && !F.seen.size) return;
    const now = Date.now();
    if (!all && now < F.dueAt) return;
    F.dueAt = now + 1000;
    // 턴 끝(turn_duration)으로 닫혔거나 노드가 사라진 호출은 내린다
    for (const id of [...F.open]) {
      const t = this.tools.get(id);
      const o = t && this.graph.get(t.owner);
      if (!t || t.ended || !o || !(o.openTools || []).some((x) => x.toolUseId === id)) { F.open.delete(id); this._fgDrop(id, { flush: true }); }
    }
    const ws = new Set();
    for (const id of F.open) { const t = this.tools.get(id); if (t?.watcher) ws.add(t.watcher); }
    for (const r of F.byTu.values()) ws.add(r.w);
    for (const s of F.seen.values()) ws.add(s.w);
    const listed = new Set(); // 이번에 훑은 폴더에 있던 파일(사라짐 판정용)
    const scanned = new Set();
    for (const w of ws) {
      for (const dir of this._fgDirs(w)) {
        if (scanned.has(dir)) continue;
        let names;
        try { names = await fs.promises.readdir(dir); } catch { continue; } // 아직 없거나 지우는 중 — 조용히
        scanned.add(dir);
        for (const name of names) {
          if (!name.endsWith('.output')) continue;
          const file = path.join(dir, name);
          listed.add(file);
          if (F.byFile.has(file) || F.ignore.has(file)) continue;
          const tid = name.slice(0, -'.output'.length);
          if (this._fgKnown(tid)) { F.seen.delete(file); continue; }
          let s = F.seen.get(file);
          if (!s) {
            let birthMs = now;
            try { const st = await fs.promises.stat(file); if (st.birthtimeMs > 0) birthMs = st.birthtimeMs; } catch { continue; } // 지워지는 중
            s = { w, firstMs: now, birthMs };
            F.seen.set(file, s);
          }
          // 잠깐 보류: run_in_background 결과(backgroundTaskId)가 곧 와서 아는 id 가 될 수 있다
          if (now - s.firstMs < FG_HOLD) continue;
          const tu = this._fgPick(s.w, s.birthMs);
          if (tu) { F.seen.delete(file); this._fgLink(tu, file, s.w); }
          else if (now - s.firstMs > FG_GIVEUP) { F.seen.delete(file); F.ignore.add(file); } // 끝내 짝이 없으면 무시
        }
      }
    }
    // 연결된 파일이 사라졌거나 나중에 다른 경로로 알게 된 id 면 끊는다(폴더째 사라져도 끊음)
    const gone = (file) => !listed.has(file) && (scanned.has(path.dirname(file)) || !fs.existsSync(path.dirname(file)));
    for (const r of [...F.byTu.values()]) {
      if (gone(r.file) || this._fgKnown(path.basename(r.file).slice(0, -'.output'.length))) this._fgDrop(r.tuid, { flush: true });
    }
    for (const file of [...F.seen.keys()]) if (gone(file)) F.seen.delete(file);
    for (const file of [...F.ignore]) if (gone(file)) F.ignore.delete(file);
    while (F.ignore.size > 2000) F.ignore.delete(F.ignore.values().next().value);
  }

  /** 연결: 파일을 text tail 로 붙이고(읽기는 pollAll 이 함께 돎) 조각을 그 호출의 꼬리 패널로 */
  _fgLink(tu, file, w) {
    const F = this._fg;
    const r = { tuid: tu.id, owner: tu.owner, file, w, lt: new LineTail(PANEL_LIMITS.lines), buf: '', timer: null, lastEmit: 0, closed: false, tail: null, shared: false };
    F.byTu.set(tu.id, r);
    F.byFile.set(file, r);
    if (this.tails.has(file)) { r.tail = this.tails.get(file); r.shared = true; return; } // 이미 다른 경로가 보는 파일이면 손대지 않음(드묾)
    r.tail = new FileTail(file, { mode: 'text', onText: (s) => this._fgText(r, s) });
    this.addTail(file, r.tail);
    log('fg link', tu.id, file);
  }

  /** 끊기: tail 닫고 표에서 뺌. flush=false(결과 도착)면 남은 조각은 버림 */
  _fgDrop(tuid, { flush = true } = {}) {
    const F = this._fg;
    const r = F.byTu.get(tuid);
    if (!r) return;
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    if (flush) this._fgFlush(r);
    r.closed = true;
    F.byTu.delete(tuid);
    F.byFile.delete(r.file);
    if (!r.shared) { r.tail.close(); if (this.tails.get(r.file) === r.tail) this.tails.delete(r.file); }
    F.ignore.add(r.file); // 지워지기 전 잠깐 남아 있어도 다시 잇지 않음
    log('fg drop', tuid);
  }

  _fgText(r, s) {
    if (r.closed || !s) return;
    r.buf += s;
    if (r.buf.length > 4000) r.buf = r.buf.slice(-4000);
    r.lt.push(s);
    if (!r.timer) {
      const wait = Math.max(0, 250 - (Date.now() - r.lastEmit));
      r.timer = setTimeout(() => { r.timer = null; this._fgFlush(r); }, wait);
    }
  }

  /** 백그라운드 출력과 같은 output 이벤트(꼬리 패널, ref = 그 셸 호출). nodeId = 호출한 노드(메인·서브에이전트) */
  _fgFlush(r) {
    if (r.closed || !r.buf) return;
    const raw = r.buf; // \r 살림 — 진행 인식은 원문, 이벤트 글은 접은 글
    const text = collapseCR(raw);
    r.buf = '';
    r.lastEmit = Date.now();
    const g = this.graph;
    const owner = g.get(r.owner);
    if (!owner) return;
    const ts = this.nowIso();
    this.touch(r.owner, ts, false);
    if (!text.trim()) return;
    let panel = null;
    if (g.privacy !== 'minimal') {
      const tu = this.tools.get(r.tuid);
      const title = tu?.panel?.title || (tu?.input?.command ? '$ ' + String(tu.input.command).split(/\r?\n/)[0] : '');
      const secret = !!tu?.panel?.secret;
      const view = r.lt.view();
      panel = tailPanel(title, view, { nodeId: r.owner, toolUseId: r.tuid }, { secret, mode: 'shell' });
      const hidden = r.lt.total + (r.lt.partial.trim() ? 1 : 0) - view.length;
      if (!secret && hidden > 0) panel.more = hidden;
      // 새로 붙는 화면(스냅샷 openTools)도 지금 꼬리를 보게
      const ot = (owner.openTools || []).find((x) => x.toolUseId === r.tuid);
      if (ot) { const sp = sanitizePanel(panel, g.privacy); if (sp) ot.panel = sp; }
    }
    this._runOut(r.tuid, Date.parse(ts), ts, false); // meta.run.lastOut
    const ix = this._fgIx(r.tuid, text); // 진행 ix(bg 출력과 같은 규칙, ref = 그 호출)
    g.emit({ ts, type: 'output', nodeId: r.owner, toolUseId: r.tuid, fg: true, text, ...(panel ? { panel } : {}), ...(ix ? { ix } : {}) });
    this._fgJobFeed(r.tuid, r.owner, raw, ts); // 자동 진행 인식·규약 줄
  }

  /** 포그라운드 셸 출력 → 진행 ix(outputIx 와 같은 누적, 열쇠 = 호출 id) */
  _fgIx(tuid, chunk) {
    const tu = this.tools.get(tuid);
    const m = this._ixAcc || (this._ixAcc = new Map());
    const k = 'fg:' + tuid;
    let acc = m.get(k);
    if (!acc) { acc = {}; m.set(k, acc); if (m.size > 2000) m.delete(m.keys().next().value); }
    if (acc.ended) return null;
    const ix = outputProgress(tu && tu.ix && tu.ix.phase === 'start' ? tu.ix : null, chunk, acc);
    if (!ix) return null;
    if (ix.phase === 'end') acc.ended = true;
    return { ...ix, ref: tuid };
  }

  /**
   * 포그라운드 셸 출력 → 작업 장부(JobBook.feed auto). 열쇠 = 'fg:<호출 id>' → 작업 노드 j:fg:<호출 id>:progress(규약 줄이면 그 id),
   * 부모 = 호출한 노드(메인·서브에이전트). 호출이 끝나면 _fgAutoEnd 가 자동 작업을 끝낸다. 라이브 전용(출력이 라이브 전용).
   */
  _fgJobFeed(tuid, ownerId, raw, ts) {
    const owner = this.graph.get(ownerId);
    if (!owner || owner.meta?.job || !raw) return;
    const key = 'fg:' + tuid;
    (this._fgJobOwner || (this._fgJobOwner = new Map())).set(key, ownerId);
    const rs = this._runs?.get(tuid);
    const ups = this._jobBook().feed(key, key, raw, ts, { owner, auto: true, autoTitle: '진행', staleSec: rs ? Math.round(this._runStaleMs(rs) / 1000) : null });
    for (const u of ups) this._jobEmit(owner, key, u, ts);
  }

  /** 포그라운드 셸 호출이 끝나면 그 자동 진행 작업도 끝(실패한 호출이면 failed) */
  _fgAutoEnd(tuid, ownerId, ts, ok) {
    const key = 'fg:' + tuid;
    const oid = this._fgJobOwner?.get(key);
    if (!oid || !this._jobs) return;
    this._fgJobOwner.delete(key);
    const owner = this.graph.get(oid) || this.graph.get(ownerId);
    const u = this._jobs.endAuto(key, ok ? 'done' : 'failed', ts, null);
    if (u && owner) this._jobEmit(owner, key, u, ts);
  }

  onOutput(o, s, backlog) {
    if (!s) return;
    if (this.offline) {
      // 재생: 원문 조각만 보관(꼬리 1MB). 시각 배분은 replay.mjs normalize 4단계
      o.chunks = o.chunks || [];
      o.chunks.push(s);
      o.chunkBytes = (o.chunkBytes || 0) + s.length;
      while (o.chunkBytes > OFFLINE_OUTPUT_MAX && o.chunks.length > 1) o.chunkBytes -= o.chunks.shift().length;
      o.tailStr = ((o.tailStr || '') + s).slice(-200);
      if (/\[killed\]\s*$/.test(s)) {
        const n = this.graph.get(o.nodeId);
        if (this._bgOpenOrCut(n)) this.stop(o.nodeId, this._fileEndIso(o, n), 'killed');
      } else {
        const rc = this._bgExitable(o) ? exitMarkerOf(o.tailStr) : null; // 끝 표지 [exited with code N]
        const n = rc != null ? this.graph.get(o.nodeId) : null;
        if (this._bgOpenOrCut(n)) this._bgExit(o.nodeId, rc, this._fileEndIso(o, n));
      }
      return;
    }
    o.hasData = true;
    o.buf += s;
    if (o.buf.length > 4000) o.buf = o.buf.slice(-4000);
    if (!o.log && /\[killed\]\s*$/.test(o.buf)) {
      const n = this.graph.get(o.nodeId);
      if (this._bgOpenOrCut(n)) { // 세션 종료로 끊긴 뒤 붙은 표지도 따른다
        this._flushOutput(o, backlog);
        // 첫 적재·밀린 기록이면 지금이 아니라 출력 파일이 마지막으로 바뀐 시각
        this.stop(o.nodeId, backlog || this.graph.loading ? this._fileEndIso(o, n) : this.nowIso(), 'killed');
        return;
      }
    }
    const rc = this._bgExitable(o) ? exitMarkerOf(o.buf) : null; // 끝 표지 [exited with code N]
    if (rc != null) {
      const n = this.graph.get(o.nodeId);
      if (this._bgOpenOrCut(n)) {
        this._flushOutput(o, backlog);
        this._bgExit(o.nodeId, rc, backlog || this.graph.loading ? this._fileEndIso(o, n) : this.nowIso());
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
    // `\r` 는 살려 둔다: LineTail(패널)·JobBook.feed(진행 인식)가 덮어쓰기를 풀고, 이벤트 글·ix 는 접은 글
    const raw = o.buf;
    const text = collapseCR(raw);
    o.buf = '';
    o.lastEmit = Date.now();
    const ts = backlog && o.tail?.mtimeMs ? new Date(o.tail.mtimeMs).toISOString() : this.nowIso();
    this.touch(o.nodeId, ts, backlog);
    if (!text.trim()) return;
    const rs = this._runs?.get(o.nodeId);
    if (rs && !rs.proc) this._runOut(o.nodeId, Date.parse(ts), ts, !!(backlog || this.graph.loading));
    const panel = this._outputPanel(o.nodeId, raw, o.log ? o.key : o.nodeId);
    const ix = this.outputIx(o.nodeId, text);
    this.graph.emit({ ts, type: 'output', nodeId: o.nodeId, text, ...(panel ? { panel } : {}), ...(ix ? { ix } : {}) });
    this.jobFeed(o.log ? o.key : o.nodeId, raw, ts, { ownerId: o.nodeId, backlog: !!(backlog || this.graph.loading) });
  }

  // ───────────── 장시간 실행 표시 (meta.run) ─────────────

  /** 끝 표지를 볼 출력 줄기: 일반 bash-bg 의 .output(기동기·러너·분리 프로세스·Monitor·로그 꼬리 아님) */
  _bgExitable(o) {
    if (o.log || o.proc) return false;
    const n = this.graph.get(o.nodeId);
    return !!(n && n.kind === 'bash-bg' && !n.meta?.launcher && !n.meta?.runner && !n.meta?.proc && !n.meta?.job);
  }

  /** `[exited with code N]` → 0 done · 130/137/143 stopped(signal) · 끄는 명령 직후면 stopped(kill-cmd) · 그 밖 error. meta.rc */
  _bgExit(id, rc, ts) {
    const s = this._runs?.get(id);
    if (s) s.rc = rc;
    (this._exitBy || (this._exitBy = new Set())).add(id);
    if (rc === 0) this.finish(id, true, ts, { meta: { rc } });
    else this._finishFailed(id, { summary: `exit code ${rc}` }, ts);
  }

  // ───────────── 띄운 세션이 끝난 bg 작업 — '세션 종료로 끊김'(stopped · session-end, 종료 코드 미상) ─────────────

  /** 끝 표지·알림이 아직 바꿀 수 있는 상태: 안 끝남, 또는 세션 종료로 끊김(추정이라 뒤에 온 진짜 끝이 이긴다) */
  _bgOpenOrCut(n) {
    return !!n && (!isEnded(n.status) || (n.status === 'stopped' && n.meta?.stopReason === 'session-end'));
  }

  /** 세션 프로세스와 같이 끝나는 bg 노드: 일반 bash-bg(기동기·러너·분리 프로세스·작업 노드는 제 규칙이 있음) */
  _bgCuttable(n) {
    return !!(n && n.kind === 'bash-bg' && !n.meta?.launcher && !n.meta?.runner && !n.meta?.proc && !n.meta?.job);
  }

  /** 세션 프로세스 끝(why 'exit' = cost-state 기록, 'proc' = 프로세스 기록 부재). '/clear' 뒤의 cost-state 는 끝이 아님 */
  _sessionExit(w, why) {
    if (why === 'exit' && w.clearPending) { w.clearEnded = true; return; }
    if (w.exit) return;
    w.exit = { iso: w.lastTs || this.nowIso(), why };
    const P = this._cutPending || (this._cutPending = new Map());
    for (const [id, bw] of this._bgW || []) {
      if (bw !== w) continue;
      const n = this.graph.get(id);
      if (this._bgCuttable(n) && !isEnded(n.status) && !P.has(id)) P.set(id, w.exit.iso);
    }
    log('session exit', w.sessionId, why, w.exit.iso, P.size);
  }

  /**
   * 크래시·강제 종료·재부팅(cost-state 없음): 그 세션의 프로세스 기록이 없거나 pid 가 죽었음. 기록을 쓰는 진입점(cli·sdk-cli)이고
   * 세션 폴더를 읽었을 때만. 라이브는 기록 부재가 PROC_GONE_MS 이어지고 transcript 가 GRACE_MS 조용해야 한다. 재생은 지금 상태로 본다.
   */
  _procGone(w, now, off) {
    const ix = this.index;
    if (!ix || !(ix.procs instanceof Map) || !ix.sessionsOk) return false;
    const ep = ix.findSession?.(w.sessionId)?.head?.entrypoint;
    if (!SESSION_END.ENTRYPOINTS.has(ep)) return false;
    const p = ix.procs.get(String(w.sessionId).toLowerCase());
    if (p && p.alive) { w.procGoneAt = null; return false; }
    if (off) return true;
    if (w.procGoneAt == null) w.procGoneAt = now;
    if (now - w.procGoneAt < SESSION_END.PROC_GONE_MS) return false;
    let mt = w.tail?.mtimeMs || 0;
    try { mt = Math.max(mt, fs.statSync(w.file).mtimeMs); } catch {}
    return now - mt >= SESSION_END.GRACE_MS;
  }

  /** sweep 마지막(라이브·재생 같음): 끝난 세션의 열린 bg 작업을 끊김으로 닫는다. 끝 = max(세션 마지막 기록, 출력 파일 수정 시각) */
  _sweepSessionEnd(now, off) {
    if (!this._bgW) return;
    for (const w of this.watchers.values()) {
      if (w.exit || w.clearEnded || w.clearPending || (w.kind !== 'main' && w.kind !== 'claude-p')) continue;
      let open = false;
      for (const [id, bw] of this._bgW) { if (bw === w) { const n = this.graph.get(id); if (this._bgCuttable(n) && !isEnded(n.status)) { open = true; break; } } }
      if (open && this._procGone(w, now, off)) this._sessionExit(w, 'proc');
    }
    // 첫 적재는 세션 transcript(cost-state)를 서브에이전트 기록보다 먼저 읽으므로, 끝 뒤에 생긴 노드라도 끝 전에 띄운 것이면 담는다
    for (const [id, bw] of this._bgW) {
      if (!bw.exit || this._cutPending?.has(id)) continue;
      const n = this.graph.get(id);
      if (this._bgCuttable(n) && !isEnded(n.status) && n.startedAt && n.startedAt <= bw.exit.iso) (this._cutPending || (this._cutPending = new Map())).set(id, bw.exit.iso);
    }
    if (!this._cutPending) return;
    for (const [id, exitIso] of [...this._cutPending]) {
      const n = this.graph.get(id);
      if (!n) { this._cutPending.delete(id); continue; }
      if (isEnded(n.status)) { if (n.meta?.stopReason !== 'session-end') this._cutPending.delete(id); continue; } // 진짜 끝이 왔으면 내려놓음
      const o = this.outputs.get(id);
      const lastMs = Math.max(Date.parse(exitIso) || 0, o?.tail?.mtimeMs || 0, Date.parse(n.lastActivityAt) || 0);
      if (!off && now - lastMs < SESSION_END.GRACE_MS) continue; // 끝 표지가 늦게 붙거나 아직 쓰는 중
      if (o && o.buf) this._flushOutput(o, true);
      const end = maxIso(exitIso, o ? this._fileEndIso(o, n) : maxIso(n.startedAt, n.lastActivityAt));
      this.stop(id, end, 'session-end');
    }
  }

  _runStaleMs(s) { return s.proc ? Math.max(PROC.STALE_MIN_SEC, s.proc.staleSec || PROC.STALE_DEFAULT_SEC) * 1000 : s.staleMs; }

  /** 공개 모양. asOf(ms) 앞이면 끝 표시(ended·rc)를 뺀다(재생 4단계가 그 시각의 값을 낼 때) */
  _runPub(s, asOf = Infinity) {
    const p = { kind: s.kind, ...(s.kind === 'fg' ? { tool: s.tool } : {}), since: s.since, lastOut: s.lastOut ?? null, staleAfter: this._runStaleMs(s), buffered: !!(s.buffered && s.lastOut == null) };
    if (p.buffered) p.bufferWhy = s.buffered;
    if (s.kind === 'bg' && s.ended != null && s.ended <= asOf) { if (s.rc != null) p.rc = s.rc; p.ended = s.ended; }
    return p;
  }

  _runFgStart(tuid, node, ts, command, tool = 'Bash') {
    const R = this._runs || (this._runs = new Map());
    if (R.has(tuid)) return;
    const since = Date.parse(ts);
    R.set(tuid, { kind: 'fg', key: tuid, tool: tuid, owner: node.id, since, lastOut: null, gaps: [], staleMs: PROC.STALE_DEFAULT_SEC * 1000,
      buffered: bufferWhy(command, { tool }), lastEmit: since, dirty: false, ended: null });
    this._runFgSync(node.id, ts);
  }

  _runFgEnd(tuid, ownerId, ts) {
    const s = this._runs?.get(tuid);
    if (!s || s.kind !== 'fg') return null;
    this._runs.delete(tuid);
    this._runFgSync(ownerId, ts);
    return s;
  }

  /** 주인 노드의 meta.run = 열린 포그라운드 셸 중 가장 오래된 것(없으면 null). 바뀔 때만 node-update */
  _runFgSync(ownerId, ts) {
    const g = this.graph;
    const n = g.get(ownerId);
    if (!n || !this._runs) return;
    let s = null;
    for (const t of n.openTools || []) { const x = this._runs.get(t.toolUseId); if (x && x.kind === 'fg' && (!s || x.since < s.since)) s = x; }
    const pub = s ? this._runPub(s) : null;
    const cur = n.meta?.run ?? null;
    if (cur === null && pub === null) return;
    if (cur && pub && JSON.stringify(cur) === JSON.stringify(pub)) return;
    if (cur && cur.kind === 'bg') return; // bg 노드는 제 것을 둔다
    g.updateNode(ownerId, { meta: { run: pub } }, ts);
    if (s) { s.lastEmit = Date.parse(ts) || s.lastEmit; s.dirty = false; }
  }

  /** bg 노드 실행 기록(멱등). fromFg = 포그라운드로 돌던 기록(lastOut·간격을 이어받음) */
  _runBgStart(id, sinceMs, command, fromFg = null, proc = null, tool = 'Bash') {
    const R = this._runs || (this._runs = new Map());
    let s = R.get(id);
    if (s) return s;
    const since = Number.isFinite(sinceMs) ? sinceMs : this.nowMs();
    s = { kind: 'bg', key: id, node: id, since, lastOut: fromFg?.lastOut ?? null, gaps: fromFg ? [...fromFg.gaps] : [],
      staleMs: fromFg?.staleMs ?? PROC.STALE_DEFAULT_SEC * 1000, buffered: bufferWhy(command, { tool }), lastEmit: since, dirty: false, ended: null, rc: null, proc };
    R.set(id, s);
    return s;
  }

  /** 출력이 왔다(ms = 그 시각). 간격 → 적응 정체 문턱, lastOut. 첫 출력·문턱 변화는 곧바로, lastOut 만이면 RUN_EMIT_MS 에 한 번 */
  _runOut(key, ms, ts, backlog = false) {
    const s = this._runs?.get(key);
    if (!s || s.ended != null || !Number.isFinite(ms)) return;
    const prevStale = this._runStaleMs(s);
    const first = s.lastOut == null;
    if (!s.proc) s.staleMs = pushGap(s.gaps, s.lastOut ?? s.since, ms, backlog) * 1000;
    if (first || ms > s.lastOut) s.lastOut = ms;
    const big = first || Math.abs(this._runStaleMs(s) - prevStale) > prevStale * 0.2;
    if (big || ms - s.lastEmit >= RUN_EMIT_MS) this._runEmit(s, ts);
    else s.dirty = true;
  }

  _runEmit(s, ts, asOf = Infinity) {
    s.dirty = false;
    s.lastEmit = Date.parse(ts) || s.lastEmit;
    if (s.kind === 'fg') { this._runFgSync(s.owner, ts); return; }
    if (this.graph.has(s.node)) this.graph.updateNode(s.node, { meta: { run: this._runPub(s, asOf) } }, ts);
  }

  /** 끝(finish·stop)에 실을 meta 조각: run(ended·rc) · rc */
  _runEndMeta(id, endIso) {
    const s = this._runs?.get(id);
    if (!s || s.kind !== 'bg') return null;
    if (s.proc && s.proc.rc != null && s.rc == null) s.rc = s.proc.rc;
    s.ended = Date.parse(endIso) || this.nowMs();
    s.dirty = false;
    return { run: this._runPub(s), ...(s.rc != null ? { rc: s.rc } : {}) };
  }

  /** 라이브 sweep: 솎아 둔 lastOut 을 낸다 · 끝난 bg 로그 꼬리 닫기 */
  _runSweep(now) {
    if (this._runs) for (const s of this._runs.values()) if (s.dirty && now - s.lastEmit >= RUN_EMIT_MS) this._runEmit(s, new Date(now).toISOString());
    for (const [k, o] of [...this.outputs]) {
      if (!o.log || !o.closeAt || now < o.closeAt) continue;
      if (o.timer) { clearTimeout(o.timer); o.timer = null; }
      this._flushOutput(o, false);
      o.tail.close();
      if (this.tails.get(o.file) === o.tail) this.tails.delete(o.file);
      this.outputs.delete(k);
    }
  }

  /** 재생 4단계: 배분한 출력 조각 시각 t → lastOut(같은 솎기). 끝난 노드는 그 시각의 값(ended 없음) */
  replayRunOut(nodeId, t) {
    const s = this._runs?.get(nodeId);
    if (!s || s.kind !== 'bg') return;
    const prevStale = this._runStaleMs(s);
    const first = s.lastOut == null;
    if (!s.proc) s.staleMs = pushGap(s.gaps, s.lastOut ?? s.since, t, false) * 1000;
    if (first || t > s.lastOut) s.lastOut = t;
    const big = first || Math.abs(this._runStaleMs(s) - prevStale) > prevStale * 0.2;
    if (big || t - s.lastEmit >= RUN_EMIT_MS) this._runEmit(s, new Date(t).toISOString(), t - 1);
    else s.dirty = true;
  }

  /** 재생 4단계 끝: 남은 값을 내고, 끝난 노드면 끝 시각에 마지막 lastOut + ended·rc 로 다시 */
  replayRunEnd(nodeId) {
    const s = this._runs?.get(nodeId);
    if (!s || s.kind !== 'bg') return;
    if (s.ended != null) { s.dirty = false; this._runEmit(s, new Date(s.ended).toISOString()); }
    else if (s.dirty && s.lastOut != null) this._runEmit(s, new Date(s.lastOut).toISOString());
  }

  /** 노드에 열린 포그라운드 셸이 있으면 그 상한 시각(ms) 중 가장 늦은 것, 없으면 0 — 이때까지 대기로 떨어뜨리지 않는다 */
  _fgHold(n) {
    let h = 0;
    for (const t of n.openTools || []) {
      const tu = this.tools.get(t.toolUseId);
      if (!tu || !SHELL.has(tu.name) || tu.bg || tu.ended) continue;
      h = Math.max(h, tu.tsMs + fgHoldMs(tu));
    }
    return h;
  }

  /** bg 로그 파일 꼬리(라이브만). fresh = 막 띄운 것(없는 파일은 생기면 처음부터, 띄우기 전 옛 내용은 건너뜀) */
  _startBgLogs(id, files, w, sinceMs, fresh) {
    files.forEach((f, k) => {
      const key = `${id}#log${k + 1}`;
      if (this.outputs.has(key) || this.tails.has(f)) return;
      const o = { nodeId: id, key, taskId: null, watcher: w, file: f, tail: null, buf: '', timer: null, hasData: false, lastEmit: 0, tries: 99, log: true, proc: true };
      o.tail = new FileTail(f, { mode: 'text', maxInitialText: BG_LOG_BACKLOG, onText: (s, info) => this.onOutput(o, s, info.backlog) });
      if (fresh) {
        let st = null;
        try { st = fs.statSync(f); } catch {}
        if (!st) o.tail.polls = 1;
        else if (st.mtimeMs < sinceMs - 1000) { o.tail.offset = st.size; o.tail.polls = 1; }
      }
      this.outputs.set(key, o);
      this.addTail(f, o.tail);
      log('bg log', id, f);
    });
  }

  /** bg 노드가 끝나면 로그 꼬리는 잠시(마지막 줄 읽을 틈) 뒤 닫는다 */
  _closeBgLogs(id) {
    for (const o of this.outputs.values()) if (o.log && o.nodeId === id && !o.closeAt) { o.closeAt = Date.now() + 6000; if (o.tail) o.tail._dueAt = 0; }
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
  _outputPanel(nodeId, chunk, tailKey = nodeId) {
    if (this.graph.privacy === 'minimal') return null;
    const m = this._outTail || (this._outTail = new Map());
    let lt = m.get(tailKey);
    if (!lt) { lt = new LineTail(PANEL_LIMITS.lines); m.set(tailKey, lt); }
    lt.push(chunk);
    const view = lt.view();
    const r = this._outputRef(nodeId);
    const p = tailPanel(r.title, view, r.ref, { secret: r.secret, mode: r.mode });
    const hidden = lt.total + (lt.partial.trim() ? 1 : 0) - view.length;
    if (!r.secret && hidden > 0) p.more = hidden;
    return p;
  }

  /** 재생(offline): 출력 전체 줄 중 앞 end 줄까지의 꼬리 패널(replay.mjs 4단계가 부름 — 라이브와 같은 규칙) */
  replayOutputPanel(nodeId, lines, end, lastSeg = null) {
    if (this.graph.privacy === 'minimal') return null;
    const r = this._outputRef(nodeId);
    const view = lines.slice(Math.max(0, end - PANEL_LIMITS.lines), end).map((l) => stripAnsi(l));
    if (lastSeg != null && view.length) view[view.length - 1] = stripAnsi(lastSeg); // 아직 덮어쓰는 중인 줄은 그때의 조각
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
        t.input = { description: i.description, task_id: i.task_id, persistent: i.persistent, timeout_ms: i.timeout_ms, timeout: i.timeout, command: typeof i.command === "string" ? i.command.slice(0, 200) : undefined };
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
      if (n.meta?.proc && this._sweepProc(n, now, off)) continue; // 분리 프로세스(적응 정체 문턱·끝 판정)
      if (n.meta?.job) continue; // 작업 노드 상태는 작업 상태가 정한다(활동 공백으로 대기 전환하지 않음)
      // 일반 bash-bg: 60초 대신 출력 간격 적응 정체 문턱(분리 프로세스와 같은 식). 재생은 5단계가 같은 문턱으로 합성
      const rs = n.kind === 'bash-bg' ? this._runs?.get(n.id) : null;
      if (rs && rs.kind === 'bg') {
        if (!off && n.status === 'active' && rs.ended == null && now - (rs.lastOut ?? rs.since) > this._runStaleMs(rs)) g.updateNode(n.id, { status: 'idle' }, nowIso);
        continue;
      }
      if (n.status !== 'active') continue;
      const last = Date.parse(n.lastActivityAt) || 0;
      // 열린 포그라운드 셸이 있으면(상한 = timeout + 1분) 대기로 떨어뜨리지 않는다
      const hold = this._fgHold(n);
      if (hold > now) continue;
      const idleAt = Math.max(last + IDLE_MS, hold);
      // offline: 대기 전환 시각은 마지막 활동 + 60초(가상 시계), 열린 셸이 있었으면 그 상한
      const idleIso = off ? new Date(idleAt).toISOString() : nowIso;
      if (SESSION_KINDS.has(n.kind)) {
        const live = off ? null : this.index.liveStatus(n.sessionId);
        if (live === 'busy') continue;
        if (now > idleAt || (live && live !== 'busy' && now - last > 5000)) g.updateNode(n.id, { status: 'idle' }, idleIso);
      } else if (n.kind === 'workflow') {
        const anyActive = [...g.nodes.values()].some((c) => c.parentId === n.id && c.status === 'active');
        if (!anyActive && now > idleAt) g.updateNode(n.id, { status: 'idle' }, idleIso);
      } else if (now > idleAt) {
        g.updateNode(n.id, { status: 'idle' }, idleIso);
      }
    } };
    pass([...g.nodes.values()], false);
    pass(launchers, true);
    pass(runners, true);
    this._sweepSessionEnd(now, off); // 띄운 세션이 끝난 bg 작업
    this._sweepWatches(); // 끝난 백그라운드 셸·Monitor 의 들여다보기 닫기
    if (!off) { this._jobFiles(); this._extJobsSweep(now); this._flushAutoJobs(nowIso); this._runSweep(now); this._loopAxesSweep(now); }
  }

  // ───────────── 분리 프로세스 · 들여다보기 ─────────────

  /**
   * 포그라운드 셸이 claude -p·기동기가 아닌 프로그램을 떼어 띄웠으면(nohup·& 등) 띄운 노드 아래 kind 'bash-bg' 노드 `b:<호출 id>`
   * (한 명령에 둘 이상이면 `b:<호출 id>~2` …)와 meta.proc. 로그(리다이렉트 대상)가 있으면 그 파일을 기존 출력 스트림으로 꼬리 읽기.
   */
  _procLaunch(tuid, node, w, ts, input, tool) {
    const cwd = this._recCwd || w.cwd || node.meta.cwd || null;
    let list;
    try { list = detectProcLaunch(input.command, { tool, cwd }); } catch (e) { log('proc', e?.message || e); return; }
    if (!list.length) return;
    const g = this.graph;
    const rootCwd = g.get(`s:${this.sessionId}`)?.meta?.cwd || null;
    const avoid = new Set([cwd, rootCwd].filter(Boolean).map(normFile)); // 이 폴더 파일을 읽는 것은 들여다보기로 보지 않음
    const ids = [];
    list.forEach((p, k) => {
      const id = k ? `b:${tuid}~${k + 1}` : `b:${tuid}`;
      if (g.has(id)) return;
      ids.push(id);
      if (this.offline && !this.spawnHints.has(id)) this.spawnHints.set(id, ts);
      const minimal = g.privacy === 'minimal';
      const rec = {
        id, tuid, owner: node.id, prog: p.prog, script: p.script, log: p.log, startMs: Date.parse(ts), lastGrowMs: Date.parse(ts), gaps: [],
        staleSec: PROC.STALE_DEFAULT_SEC, end: { trace: false, failAt: null, exc: null, end: null, lastLine: null }, killAt: null, pidHint: null,
        watch: new Map(), watchCount: 0, lastWatchAt: null, endReason: null, rc: null, logTailed: false,
        pub: { cmd: minimal ? '' : p.cmd, via: p.via, log: p.log ? (minimal ? path.basename(p.log) : redact(p.log.replace(/\\/g, '/'))) : null },
      };
      const keys = new Set(p.logs.map(normFile));
      for (const d of [...p.logs.map((f) => path.dirname(f)), ...p.outDirs]) { const nd = normFile(d); if (!avoid.has(nd)) keys.add(nd); }
      rec.keys = [...keys];
      for (const k2 of rec.keys) { if (!this.procByPath.has(k2)) this.procByPath.set(k2, new Set()); this.procByPath.get(k2).add(id); }
      this.procs.set(id, rec);
      const run = this._runBgStart(id, rec.startMs, input.command, null, rec, tool);
      g.addNode({ id, parentId: node.id, kind: 'bash-bg', label: `분리 실행 · ${p.script || p.prog}`, sessionId: w.sessionId, startedAt: ts, lastActivityAt: ts,
        meta: { toolUseId: tuid, command: minimal ? null : p.cmd, background: true, detached: true, spawnedBy: node.id,
          title: input.description ? String(input.description).slice(0, 120) : null, proc: this._procMeta(rec), run: this._runPub(run) } }, ts);
      // 출력 꼬리: 로그 파일을 기존 출력 스트림으로(홀로그램 꼬리·작업·재생 4단계 배분). 보관함은 기록 밖 파일을 읽지 않는다
      if (p.log && !this.index.taskRoots) {
        const o = this.startOutput(id, null, w, p.log);
        o.proc = true;
        rec.logTailed = true;
        if (!this.offline && !g.loading && o.tail) {
          // 라이브로 막 띄운 것: 아직 없는 파일은 생기면 처음부터(백로그 아님), 띄우기 전부터 있던 옛 내용(>> 덧붙임)은 건너뜀
          let st = null;
          try { st = fs.statSync(p.log); } catch {}
          if (!st) o.tail.polls = 1;
          else if (st.mtimeMs < Date.parse(ts) - 1000) { o.tail.offset = st.size; o.tail.polls = 1; }
        }
      }
    });
    if (ids.length) this.procByTu.set(tuid, ids);
  }

  /** meta.proc(공개 모양) */
  _procMeta(rec) {
    return {
      v: 1, cmd: rec.pub.cmd, prog: rec.prog, script: rec.script, via: rec.pub.via, log: rec.pub.log, pidHint: rec.pidHint,
      spawnedBy: rec.owner,
      watch: [...rec.watch.values()].map((x) => ({ nodeId: x.nodeId, kind: x.kind, via: x.via, since: x.since, toolUseId: x.toolUseId })),
      watchCount: rec.watchCount, lastWatchAt: rec.lastWatchAt, endReason: rec.endReason, rc: rec.rc,
    };
  }

  _procUpdate(rec, ts) {
    if (this.graph.has(rec.id)) this.graph.updateNode(rec.id, { meta: { proc: this._procMeta(rec) } }, ts);
  }

  /** 띄운 명령의 결과: `echo $!`·`-PassThru` 가 찍은 PID 힌트(Git Bash 의 $! 는 MSYS PID 라 Windows pidAlive 로 못 봄 — 끄는 명령 대조에만) */
  _procLaunchResult(tuid, tu, tur, bodyText) {
    const cmd = tu?.input?.command || '';
    const hint = pidHintOf(cmd, tur?.stdout ?? stripTags(bodyText), tu?.name);
    if (!hint) return;
    for (const id of this.procByTu.get(tuid) || []) {
      const rec = this.procs.get(id);
      if (rec && !rec.pidHint) { rec.pidHint = hint; this._procUpdate(rec, tu?.ts || this.nowIso()); }
    }
  }

  /** 줄 간격(초) 하나 → 적응 정체 문턱. 바뀌면(20% 넘게) meta.procStaleSec — meta.proc 과 따로 둬 재생 적재 순서에 덮이지 않게 */
  _procGap(rec, tms, ts, backlog) {
    if (!Number.isFinite(tms) || tms <= rec.lastGrowMs) return;
    // 첫 적재·밀린 줄은 시각이 파일 수정 시각 하나라 간격이 아니다
    const ss = pushGap(rec.gaps, rec.lastGrowMs, tms, backlog); // 공용(장시간 실행 표시와 같은 식)
    rec.lastGrowMs = tms;
    if (Math.abs(ss - rec.staleSec) > rec.staleSec * 0.2) { rec.staleSec = ss; if (this.graph.has(rec.id)) this.graph.updateNode(rec.id, { meta: { procStaleSec: ss } }, ts); }
    if (!this.offline) this._runOut(rec.id, tms, ts, backlog); // meta.run(라이브. 재생은 5단계 문턱·4단계 시각이 따로)
  }

  /** 로그 꼬리 조각(jobFeed 가 부름, 정체 문턱은 jobFeed 가 먼저 _procGap): 끝 표지(EXIT n·rc=n·Killed·Traceback) */
  _procFeed(rec, text, ts) {
    const n = this.graph.get(rec.id);
    if (!n) return;
    scanEnd(rec.end, collapseCR(String(text)), ts);
    const e = rec.end.end;
    rec.end.end = null;
    if (e && !isEnded(n.status)) this._procEnd(rec, e.state, ts, e.reason, e.rc);
  }

  /** 프로세스 끝: done·failed(error)·stopped. 자동 작업도 같은 rc 로 끝 */
  _procEnd(rec, state, ts, reason, rc = null) {
    const n = this.graph.get(rec.id);
    if (!n || isEnded(n.status)) return;
    rec.endReason = reason; rec.rc = rc ?? null; rec.end.failAt = null;
    this._autoJobEnd(rec.id, state === 'failed' ? 'failed' : 'done', ts, rc ?? null);
    if (state === 'stopped') this.stop(rec.id, ts, reason === 'kill-cmd' ? 'kill-cmd' : 'signal');
    else this.finish(rec.id, state === 'done', ts);
    this._procUpdate(rec, ts);
    for (const x of [...rec.watch.values()]) if (x.via !== 'shell') this._watchClose(rec, x.toolUseId, ts, false);
  }

  /** 끄는 명령(taskkill·pkill·Stop-Process·kill …)이 프로그램·스크립트 이름·PID 힌트로 이 프로세스를 겨누면 표시(판정은 sweep) */
  _procKill(cmd, ts) {
    for (const rec of this.procs.values()) {
      const n = this.graph.get(rec.id);
      if (!n || isEnded(n.status) || Date.parse(ts) < rec.startMs) continue;
      if (killTargets(cmd, rec)) rec.killAt = Date.parse(ts);
    }
  }

  /**
   * 상태(sweep): 끄는 명령 뒤 무성장 → stopped · Traceback 뒤 조용 → failed · 장시간 무성장 → done(quiet) · 띄운 노드가 끝나고 조용 →
   * done(spawner-ended) · 적응 문턱 넘게 조용 → idle(정체). 재생(offline)은 로그 줄을 아직 배분하기 전이라 파일 전체에서 끝 표지를 미리 보고,
   * 끝 시각은 파일 수정 시각(수리 2 와 같은 방식), 조용함은 벽시계 기준(라이브 지금과 같은 답).
   */
  _sweepProc(n, now, off) {
    const rec = this.procs.get(n.id);
    if (!rec) return false;
    if (isEnded(n.status)) return true;
    const g = this.graph;
    const iso = (ms) => new Date(Math.max(rec.startMs, ms)).toISOString();
    let grow = rec.lastGrowMs;
    if (off) {
      const o = this.outputs.get(n.id);
      let mt = NaN;
      try { if (rec.log && o?.chunks?.length) mt = fs.statSync(rec.log).mtimeMs; } catch {}
      // 마지막 성장 = 파일 수정 시각(rec 에는 넣지 않는다 — 4단계 배분이 줄 간격을 다시 센다)
      if (Number.isFinite(mt)) grow = Math.max(grow, mt);
      if (o?.chunks?.length) {
        const st = scanEnd({ trace: false, failAt: null, exc: null, end: null, lastLine: null }, collapseCR(o.chunks.join('')), iso(grow));
        if (st.end) { this._procEnd(rec, st.end.state, iso(grow), st.end.reason, st.end.rc); return true; }
        if (st.failAt && rec.killAt == null) { this._procEnd(rec, 'failed', iso(grow), 'traceback'); return true; }
      }
    }
    if (rec.killAt != null && (off || (grow <= rec.killAt + 2000 && now - rec.killAt > PROC.KILL_GRACE_MS))) {
      this._procEnd(rec, 'stopped', iso(rec.killAt), 'kill-cmd'); return true;
    }
    if (rec.killAt != null && grow > rec.killAt + 2000) rec.killAt = null; // 끈 뒤에도 자랐다 — 다른 것을 껐다
    if (rec.end.failAt && (off || now - grow > PROC.FAIL_QUIET_MS)) { this._procEnd(rec, 'failed', rec.end.failAt, 'traceback'); return true; }
    const clock = off ? Math.max(now, Date.now()) : now;
    const quiet = (clock - grow) / 1000;
    const sp = g.get(rec.owner);
    const spEnded = !sp || isEnded(sp.status);
    if (quiet > quietEndSec(rec.staleSec)) { this._procEnd(rec, 'done', iso(grow), 'quiet'); return true; }
    if (spEnded && quiet > Math.max(PROC.SPAWNER_QUIET_SEC, rec.staleSec)) {
      this._procEnd(rec, 'done', iso(Math.max(grow, Date.parse(sp?.endedAt) || 0)), 'spawner-ended'); return true;
    }
    // 정체(대기). 재생은 4단계 배분 뒤 5단계가 같은 문턱으로 합성하므로 여기서는 라이브만
    if (!off && n.status === 'active' && quiet > rec.staleSec) g.updateNode(n.id, { status: 'idle' }, new Date(now).toISOString());
    return true;
  }

  /** 들여다보기 시작: 명령이 가리키는 경로가 프로세스 로그·그 폴더·출력 폴더(두 단계 위까지)면 */
  _watchStart(tuid, node, w, ts, name, input) {
    const cwd = this._recCwd || w.cwd || node.meta.cwd || null;
    let refs;
    try { refs = commandPathRefs(input.command, { tool: name === 'PowerShell' ? 'PowerShell' : 'Bash', cwd }); } catch { return; }
    const peers = new Set();
    for (const r of refs) {
      let cur = r;
      for (let up = 0; up < 3 && cur; up++) {
        for (const id of this.procByPath.get(cur) || []) {
          const rec = this.procs.get(id);
          if (rec && rec.tuid !== tuid) peers.add(id);
        }
        const nx = cur.replace(/\/[^/]*$/, '');
        cur = nx !== cur && nx.includes('/') ? nx : null;
      }
    }
    if (!peers.size) return;
    const bg = name === 'Monitor' || !!input.run_in_background;
    const kind = bg || isWaitCommand(input.command) ? 'wait' : 'peek';
    if (bg) { this._watchTu.set(tuid, { peers: [...peers], kind, via: name === 'Monitor' ? 'monitor' : 'bg' }); return; }
    for (const id of peers) this._watchOpen(this.procs.get(id), node.id, tuid, kind, 'shell', ts);
    this._watchFg.set(tuid, [...peers]);
  }

  /** 백그라운드 셸·Monitor 결과로 노드가 정해지면 그 노드가 읽는 쪽 */
  _watchBind(tuid, nodeId, ts) {
    const wt = this._watchTu.get(tuid);
    if (!wt || !this.graph.has(nodeId)) return;
    this._watchTu.delete(tuid);
    for (const id of wt.peers) this._watchOpen(this.procs.get(id), nodeId, tuid, wt.kind, wt.via, ts);
    if (wt.peers.length) this.watchStream.set(nodeId, wt.peers[0]);
  }

  _watchOpen(rec, readerId, tuid, kind, via, ts) {
    if (!rec) return;
    const key = `${tuid}|${readerId}`;
    if (rec.watch.has(key)) return;
    rec.watch.set(key, { nodeId: readerId, kind, via, since: ts, toolUseId: tuid });
    rec.watchCount++;
    rec.lastWatchAt = ts;
    this.graph.emit({ ts, type: 'watch', nodeId: readerId, peer: rec.id, kind, via, phase: 'start', toolUseId: tuid });
    this._procUpdate(rec, ts);
  }

  _watchClose(rec, tuid, ts, progress) {
    let closed = false;
    for (const [key, x] of [...rec.watch]) {
      if (x.toolUseId !== tuid) continue;
      rec.watch.delete(key);
      closed = true;
      this.graph.emit({ ts, type: 'watch', nodeId: x.nodeId, peer: rec.id, kind: x.kind, via: x.via, phase: 'end', toolUseId: tuid, progress: !!progress });
    }
    if (closed) this._procUpdate(rec, ts);
  }

  /** 포그라운드 들여다보기 끝: 결과(stdout)의 진행 줄·끝 표지를 그 프로세스에 반영 */
  _watchEnd(tuid, tur, bodyText, ts) {
    const ids = this._watchFg.get(tuid) || [];
    this._watchFg.delete(tuid);
    const text = tur && tur.stdout != null ? `${tur.stdout}\n${tur.stderr || ''}` : stripTags(bodyText || '');
    for (const id of ids) {
      const rec = this.procs.get(id);
      if (!rec) continue;
      this._procObserve(id, text, ts);
      // progress = 결과에 진행 줄이 보였는가(레인에 넣었는지와 무관 — 로그 꼬리가 있으면 거기서 이미 반영)
      const shown = String(text).split('\n').some((l) => parseProgressLine(collapseCR(l)));
      this._watchClose(rec, tuid, ts, shown);
    }
  }

  /** 재생 4단계: 분리 프로세스 로그 배분의 시각 닻 [{line, t}] (들여다본 결과에 보인 줄과 그 시각). 없으면 null */
  procAnchors(id) { return this.procs.get(id)?.anchors || null; }

  /** 끝난 백그라운드 셸·Monitor 의 들여다보기 닫기(그 노드가 끝난 시각) */
  _sweepWatches() {
    for (const rec of this.procs.values()) {
      for (const x of [...rec.watch.values()]) {
        if (x.via === 'shell') continue;
        const r = this.graph.get(x.nodeId);
        if (!r || isEnded(r.status)) this._watchClose(rec, x.toolUseId, r?.endedAt || this.nowIso(), false);
      }
    }
  }

  /**
   * 들여다본 결과(또는 로그를 비추는 백그라운드 셸·Monitor 출력) → 그 프로세스. 끝 표지는 늘 반영. 진행 줄은 로그 꼬리가 없을 때만
   * 레인에 넣는다(꼬리가 있으면 같은 줄이 이미 들어와 있고, 결과는 지난 줄을 다시 보여 주므로 순서가 섞인다). 레인이 움직였으면 true.
   */
  _procObserve(id, text, ts) {
    const rec = this.procs.get(id);
    const n = this.graph.get(id);
    if (!rec || !n || !text) return false;
    let moved = false;
    // 로그 꼬리가 진행의 근거: 파일이 있으면(한 번 보이면 계속) 결과 줄은 레인에 넣지 않는다
    if (rec.logTailed && !rec.logSeen) { try { rec.logSeen = fs.existsSync(rec.log); } catch {} }
    const tailed = rec.logTailed && rec.logSeen;
    if (tailed && this.offline) {
      // 재생: 들여다본 결과 줄 = 그 시각까지 로그에 있던 줄 → 4단계 로그 배분의 시각 닻(replay.mjs procAnchors)
      const A = rec.anchors || (rec.anchors = []);
      const tms = Date.parse(ts);
      for (const raw of String(text).split('\n')) { const l = collapseCR(raw).trim(); if (l.length >= 6 && A.length < 4000) A.push({ line: l, t: tms }); }
    }
    if (!tailed && !isEnded(n.status)) {
      const key = this._jobOwnerKey(id);
      const book = this._jobBook();
      const sig = () => JSON.stringify(book.autoJob(key)?.lanes?.map((l) => [l.key, l.n]) || null);
      const before = sig();
      const u = book.observe(id, key, text, ts, { autoTitle: '진행', staleSec: rec.staleSec });
      if (u) this._jobEmit(n, key, u, ts);
      moved = sig() !== before;
      if (moved) { this._procGap(rec, Date.parse(ts), ts, false); this.touch(id, ts, false); }
    }
    const st = scanEnd({ trace: false, failAt: null, exc: null, end: null, lastLine: null }, collapseCR(String(text)), ts);
    if (st.end && !isEnded(n.status)) this._procEnd(rec, st.end.state, ts, st.end.reason, st.end.rc);
    return moved;
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
  jobFeed(streamId, text, ts, { ownerId = null, file = false, final = false, backlog = false } = {}) {
    if (!text) return;
    const oid = ownerId || streamId;
    const owner = this.graph.get(oid);
    if (!owner || owner.meta?.job) return;
    const key = this._jobOwnerKey(oid);
    // 자동 진행 인식: 백그라운드 셸·분리 프로세스 출력(기동기·러너·Monitor·설정 파일 꼬리는 아님). 프로세스 로그를 비추는
    // 백그라운드 셸·Monitor 의 출력은 그 프로세스 쪽으로 넘긴다
    const peer = file ? null : this.watchStream.get(streamId) || null;
    const rec = owner.meta?.proc ? this.procs.get(oid) : null;
    const auto = !file && !peer && (!!rec || (owner.kind === 'bash-bg' && !owner.meta?.launcher && !owner.meta?.runner));
    if (rec) this._procGap(rec, Date.parse(ts), ts, backlog); // 정체 문턱을 먼저(자동 작업 staleSec 에 실림)
    // 라이브에서 주인이 이미 끝났으면(첫 적재에서 끝을 먼저 읽음) 자동 작업도 끝난 채로. 재생 4단계는 배분 뒤 jobFeedEnd 가 끝낸다
    const endAs = !this.offline && isEnded(owner.status) ? { state: owner.status === 'error' ? 'failed' : 'done', ts: owner.endedAt || ts, rc: rec ? rec.rc : null } : null;
    const ups = this._jobBook().feed(streamId, key, text, ts, { owner, file, final, auto, autoTitle: '진행', staleSec: rec ? rec.staleSec : null, endAs });
    for (const u of ups) this._jobEmit(owner, key, u, ts);
    if (rec) this._procFeed(rec, text, ts);
    if (peer) this._procObserve(peer, text, ts);
  }

  /** 스트림 주인 노드가 끝나면 그 자동 진행 작업도 끝(솎아 낸 마지막 레인 값 포함) */
  _autoJobEnd(id, state, ts, rc = null) {
    const owner = this.graph.get(id);
    if (!owner || !this._jobs) return;
    const key = this._jobOwnerKey(id);
    const u = this._jobs.endAuto(key, state, ts, rc);
    if (u) this._jobEmit(owner, key, u, ts);
  }

  /** 재생 4단계 끝: 출력 배분을 마친 스트림의 자동 작업을 노드 상태에 맞춰 마무리(끝났으면 끝, 아니면 솎아 낸 값) */
  jobFeedEnd(streamId, ts) {
    const n = this.graph.get(streamId);
    if (!n || !this._jobs) return;
    const key = this._jobOwnerKey(streamId);
    if (isEnded(n.status)) { this._autoJobEnd(streamId, n.status === 'error' ? 'failed' : 'done', n.endedAt || ts, n.meta?.proc?.rc ?? null); return; }
    const u = this._jobs.flushAuto(key, ts);
    if (u) this._jobEmit(n, key, u, ts);
  }

  /** 라이브: 솎아 내느라 못 낸 자동 작업 레인 값을 sweep 마다 낸다 */
  _flushAutoJobs(nowIso) {
    if (!this._jobs) return;
    for (const key of this._jobs.jobs.keys()) {
      const u = this._jobs.flushAuto(key, nowIso);
      const owner = u && (this.graph.get(key) || this.graph.get(this._fgJobOwner?.get(key)));
      if (owner) this._jobEmit(owner, key, u, nowIso);
    }
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
   * 외부 작업 등록부 — Claude 세션 밖에서 따로 띄운 작업(서술 파일 `<상태 폴더>/jobs/*.json`)을 이 세션 메인 아래 작업 노드
   * `j:s:<sid>:x:<id>`(모양, src 'ext')로 낸다. 진행이 있으면 그 노드의 `output` 이벤트에 바닥 진행 띠 ix(batch i/N 또는 pct)를
   * 싣는다(웹 ix-core 가 그대로 그림). 라이브만(기록 밖 파일). 붙일 세션은 등록부가 정한다(서술 sessionId → 프로젝트의 살아 있는 메인).
   */
  /**
   * 자율 루프 판 — 축 큐: 이 런타임에 기동기·러너 노드가 있고 메인 cwd 가 자율 루프 레이아웃(`.autopilot/relaunch.sh` 의 AXIS_QUEUE)이면
   * 축 목록·지금 축·축별 단계 진행을 메인 meta.plans 맨 앞에 싣는다(10초마다, 파일 mtime 캐시). 레이아웃이 없으면 아무것도 안 함. 라이브만
   */
  _loopAxesSweep(now) {
    if (this._loopAt && now - this._loopAt < 10_000) return;
    this._loopAt = now;
    const mid = `s:${this.sessionId}`, main = this.graph.get(mid);
    if (!main || main.kind !== 'main') return;
    const tr = this._plans();
    // 판 주인 = 재기동기(기동기 노드 — 축을 고르는 주체). 끝나지 않은 것 > 최근 시작. /clear 승계로 이어받은 기동기(b:adopt-…)도 이 런타임의 노드
    let L = null;
    for (const n of this.graph.nodes.values()) {
      if (!n.meta || !n.meta.launcher) continue;
      const live = !['done', 'error', 'stopped'].includes(n.status);
      const sc = (live ? 1e15 : 0) + (Date.parse(n.startedAt || '') || 0);
      if (!L || sc > L.sc) L = { id: n.id, sc };
    }
    const raw = L && main.meta && main.meta.cwd ? loopAxesPlan(main.meta.cwd) : null;
    const plan = raw ? planFromRaw(raw, { privacy: this.privacy, at: now, key: main.meta.cwd + '|axes' }) : null;
    tr.setExternal('axes', L ? L.id : mid, plan, now);
  }

  _extJobsSweep(now) {
    const reg = this._ext;
    if (!reg || this.closed || this.offline) return;
    const g = this.graph;
    const owner = g.get(`s:${this.sessionId}`);
    if (!owner) return;
    try { reg.refresh(); } catch (e) { log('ext jobs', e?.message || e); return; }
    const mine = reg.jobsFor(this.sessionId, this.index);
    const S = this._extSent || (this._extSent = new Map()); // 노드 id → { sig, beatAt, at, ixSig, ixAt, ixEnded }
    const nowIso = new Date(now).toISOString();
    const key = owner.id;
    const seen = new Set();
    for (const st of mine) {
      const job = extJobView(st, now, { privacy: this.privacy });
      const id = jobNodeId(key, job.id);
      seen.add(id);
      const prev = S.get(id);
      const { beatAt, ...rest } = job;
      const sig = JSON.stringify(rest);
      // 박동만 바뀐 갱신은 60초에 한 번(진행 줄 없는 작업의 생존 박동도 분 단위)
      if (!prev || prev.sig !== sig || (beatAt !== prev.beatAt && now - (prev.at || 0) >= EXT.BEAT_QUIET_MS)) {
        this._jobEmit(owner, key, { jobId: job.id, job, isNew: !prev, beatOnly: false }, nowIso);
        S.set(id, { ...(prev || {}), sig, beatAt, at: now });
      }
      // 바닥 진행 띠: 값이 바뀌거나 1분마다(웹 효과 수명 유지), 끝은 한 번
      const ix = extJobIx(st, now);
      const rec = S.get(id);
      if (ix && !rec.ixEnded) {
        const ixSig = JSON.stringify(ix);
        if (ixSig !== rec.ixSig || now - (rec.ixAt || 0) >= 60_000) {
          g.emit({ ts: nowIso, type: 'output', nodeId: id, text: job.line || job.phase || '', ix });
          rec.ixSig = ixSig; rec.ixAt = now;
          if (ix.phase === 'end') rec.ixEnded = true;
        }
      }
    }
    // 이 세션에서 떠난 작업(서술 파일이 지워졌거나 다른 세션으로 옮김): 끝나지 않은 노드는 끝으로 닫는다
    for (const id of [...S.keys()]) {
      if (seen.has(id)) continue;
      const n = g.get(id);
      if (n && n.meta?.job && !isEnded(n.status)) {
        const job = { ...n.meta.job, state: 'done', endedAt: nowIso, phase: '등록 해제 — 서술 파일을 지웠거나 다른 세션으로 옮김' };
        this._jobEmit(owner, key, { jobId: job.id, job, isNew: false, beatOnly: false }, nowIso);
      }
      S.delete(id);
    }
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

