// 세션 색인: ~/.claude/projects/*/<id>.jsonl, ~/.claude/sessions/<pid>.json, %TEMP%/claude/**/tasks 탐색
// 모든 파일은 읽기 전용. ~/.claude/sessions/*.key 는 열지 않는다.
import { isClearRecord, findClearPredecessor } from './succession.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { redact } from './redact.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** pid 생존 확인: signal 0 이 성공하거나 EPERM(남의 프로세스)이면 살아 있음 */
export function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

export function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

export function claudeTmpRoots() {
  if (process.env.CCVIZ_CLAUDE_TMP) return [process.env.CCVIZ_CLAUDE_TMP];
  const roots = new Set();
  if (process.env.CLAUDE_CODE_TMPDIR) roots.add(path.join(process.env.CLAUDE_CODE_TMPDIR, 'claude'));
  roots.add(path.join(os.tmpdir(), 'claude'));
  return [...roots];
}

function isoSafe(ts) {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const HEAD_MAX = 1024 * 1024;

async function readHead(file, max = 96 * 1024) {
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
    const buf = Buffer.allocUnsafe(max);
    const { bytesRead } = await fh.read(buf, 0, max, 0);
    return buf.toString('utf8', 0, bytesRead);
  } catch { return ''; } finally { await fh?.close().catch(() => {}); }
}

async function readTail(file, size, max = 256 * 1024) {
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
    const start = Math.max(0, size - max);
    const len = size - start;
    const buf = Buffer.allocUnsafe(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return buf.toString('utf8', 0, bytesRead);
  } catch { return ''; } finally { await fh?.close().catch(() => {}); }
}

export const FIRST_PROMPT_MAX = 2000;
/**
 * n 자 안에서 자르되 잘린 마지막 낱말(공백 없는 덩어리)은 통째로 버린다. 제목은 redact() 뒤에 자르지만, 여기서 낱말 중간을
 * 자르면 비밀 토큰 앞부분만 남아 패턴(길이·접두사)에 안 걸린 채 마스킹으로 줄어든 앞 내용과 함께 제목 창으로 들어올 수 있었다.
 */
export function cutAtWord(s, n) {
  s = String(s || '');
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  if (/\s/.test(s[n])) return cut;
  const m = /^([\s\S]*\s)\S*$/.exec(cut);
  return m ? m[1] : '';
}

/** jsonl 앞부분에서 entrypoint·cwd·첫 시각·첫 프롬프트 */
export function parseHead(text) {
  const info = { entrypoint: null, cwd: null, firstTs: null, firstPrompt: null, hasUser: false, clearAt: null };
  const lines = text.split('\n');
  let doneAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith('{"type":"api-request')) continue;
    if (doneAt >= 0 && i > doneAt + 40) break;
    let r; try { r = JSON.parse(line); } catch { continue; }
    // /clear 로 시작한 세션: 머리의 로컬 명령 clear·SessionStart:clear 훅·/clear 명령 기록. 머리 기록은 시각 순이 아니고
    // (실측: 훅 기록 08:22:19 가 로컬 명령 08:22:15 보다 앞, 첫 user 보다 뒤) 가장 이른 시각을 쓴다(첫 user 뒤 40줄까지 본다)
    if (isClearRecord(r)) {
      const t = r.timestamp || info.firstTs || null;
      if (t && (!info.clearAt || Date.parse(t) < Date.parse(info.clearAt))) info.clearAt = t;
    }
    if (doneAt >= 0) continue;
    if (!info.firstTs && r.timestamp) info.firstTs = r.timestamp;
    if (!info.entrypoint && r.entrypoint) info.entrypoint = r.entrypoint;
    if (!info.cwd && r.cwd) info.cwd = r.cwd;
    if (r.type === 'user' && !r.isMeta) {
      info.hasUser = true;
      if (info.firstPrompt == null) {
        const c = r.message?.content;
        info.firstPrompt = cutAtWord(typeof c === 'string' ? c
          : Array.isArray(c) ? (c.find((x) => x?.type === 'text')?.text || '') : '', FIRST_PROMPT_MAX);
      }
      if (info.entrypoint) doneAt = i;
    }
  }
  return info;
}

export function parseTitleFromTail(text) {
  const { custom, ai } = parseTitlesFromTail(text);
  return custom || ai;
}

/** 꼬리의 custom-title·ai-title 를 따로(각각 마지막 값) */
export function parseTitlesFromTail(text) {
  let ai = null, custom = null;
  for (const line of text.split('\n')) {
    if (line.includes('"type":"custom-title"')) { try { custom = JSON.parse(line).customTitle || custom; } catch {} }
    else if (line.includes('"type":"ai-title"')) { try { ai = JSON.parse(line).aiTitle || ai; } catch {} }
  }
  return { custom, ai };
}

/** jsonl 꼬리에서 마지막 레코드 timestamp (endedAt) */
export function parseLastTsFromTail(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.startsWith('{"type":"api-request')) continue;
    const m = /"timestamp":"([^"]+)"/.exec(line);
    if (m && Number.isFinite(Date.parse(m[1]))) return new Date(Date.parse(m[1])).toISOString();
  }
  return null;
}

/** 트리(메인 + <sid>/subagents/**.jsonl) 바이트 → 재생 이벤트 수 추정 상수 K (실측) */
export const EVENT_BYTES_K = 15000;

export class SessionIndex {
  constructor({ projectsDir, sessionsDir, project = null, fixedSession = null } = {}) {
    const home = claudeHome();
    this.projectsDir = projectsDir || path.join(home, 'projects');
    this.sessionsDir = sessionsDir || path.join(home, 'sessions');
    this.project = project;
    this.fixedSession = fixedSession;
    this.entries = new Map(); // sessionId → entry
    this.live = new Map(); // sessionId → status
    this.procs = new Map(); // 3차: sessionId → {pid, alive, status, entrypoint, cwd}
    this.claimedChildren = new Set(); // claude-p 로 매칭된 자식 sessionId
    this.childParent = new Map(); // 자식 sessionId → 그것을 띄운 세션 sessionId(라이브·재생에서 매칭된 것만)
    this.autoCurrent = null;
    this.lastRefresh = 0;
    this._refreshing = null;
    this.startedAt = Date.now();
  }

  async refresh() {
    if (this._refreshing) return this._refreshing;
    this._refreshing = this._doRefresh().finally(() => { this._refreshing = null; });
    return this._refreshing;
  }

  async _doRefresh() {
    let dirs = [];
    try { dirs = await fs.promises.readdir(this.projectsDir, { withFileTypes: true }); } catch {}
    const seen = new Set();
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const pdir = path.join(this.projectsDir, d.name);
      let files = [];
      try { files = await fs.promises.readdir(pdir); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const sid = f.slice(0, -6);
        if (!UUID_RE.test(sid)) continue;
        const file = path.join(pdir, f);
        let st; try { st = await fs.promises.stat(file); } catch { continue; }
        seen.add(sid);
        const prev = this.entries.get(sid);
        if (prev && prev.file === file) {
          prev.mtimeMs = st.mtimeMs; prev.size = st.size;
        } else {
          this.entries.set(sid, {
            sessionId: sid, projectDir: d.name, projectPath: pdir, file,
            mtimeMs: st.mtimeMs, size: st.size, birthtimeMs: st.birthtimeMs || st.ctimeMs,
            head: null, title: null, titleAt: -1,
          });
        }
      }
    }
    for (const sid of [...this.entries.keys()]) if (!seen.has(sid)) this.entries.delete(sid);
    await this._refreshLive();
    this.lastRefresh = Date.now();
  }

  async _refreshLive() {
    const live = new Map();
    const procs = new Map();
    let files = [];
    let ok = false; // 세션 폴더를 읽었는지 — 못 읽었으면 '프로세스 없음'으로 판정하지 않는다
    try { files = await fs.promises.readdir(this.sessionsDir); ok = true; } catch {}
    for (const f of files) {
      if (!f.endsWith('.json')) continue; // *.key 는 절대 읽지 않음
      try {
        const j = JSON.parse(await fs.promises.readFile(path.join(this.sessionsDir, f), 'utf8'));
        if (j && j.sessionId) {
          live.set(j.sessionId, { status: j.status ?? null, entrypoint: j.entrypoint ?? null, pid: j.pid });
          // 3차: pid 생존으로 활성 판정. updatedAt 은 상태가 바뀔 때만 갱신되므로 쓰지 않는다
          const sid = String(j.sessionId).toLowerCase();
          const alive = pidAlive(j.pid);
          const prev = procs.get(sid);
          if (!prev || (alive && !prev.alive)) {
            procs.set(sid, { sessionId: sid, pid: j.pid, alive, status: j.status ?? null, entrypoint: j.entrypoint ?? null,
              cwd: typeof j.cwd === 'string' ? j.cwd : null, startedAt: j.startedAt ?? null, kind: j.kind ?? null });
          }
        }
      } catch {}
    }
    this.live = live;
    this.procs = procs;
    this.sessionsOk = ok;
    this.procsAt = Date.now();
  }

  /** 3차: pid 가 살아 있고 transcript 가 있는 세션들 → [{sessionId, pid, status, entrypoint, cwd, entry}] */
  liveProcs() {
    const out = [];
    for (const p of (this.procs || new Map()).values()) {
      if (!p.alive) continue;
      const entry = this.findSession(p.sessionId);
      if (!entry) continue;
      out.push({ ...p, entry });
    }
    return out;
  }

  async ensureHead(e) {
    // 갓 생긴 파일은 첫 user 레코드·entrypoint 가 아직 없을 수 있다. 그때 읽은 결과를 영구 캐시하면
    // claude -p 자식이 영영 sdk-cli 로 보이지 않으므로, 불완전한 head 는 파일이 자라면 다시 읽는다.
    const complete = e.head && e.head.entrypoint && e.head.hasUser;
    if (!e.head || (!complete && e.headSize !== e.size && e.headSize < HEAD_MAX)) {
      e.head = parseHead(await readHead(e.file));
      // 표준 입력 프롬프트가 큰 claude -p(실측 53KB 짜리 queue-operation + 같은 크기 user 레코드)는 96KB 안에 첫 user 레코드가
      // 다 들어오지 않아 entrypoint 를 못 읽고 sdk-cli 로도 메인으로도 안 보였다. 모자라면 1MB 까지 다시 읽는다
      if (!(e.head.entrypoint && e.head.hasUser) && e.size > 96 * 1024) e.head = parseHead(await readHead(e.file, HEAD_MAX));
      e.headSize = e.size;
    }
    return e.head;
  }

  async ensureTitle(e) {
    if (e.titleAt === e.mtimeMs) return e.title;
    const tail = await readTail(e.file, e.size);
    const { custom, ai } = parseTitlesFromTail(tail);
    if (custom) e.customTitle = custom;
    if (ai) e.aiTitle = ai;
    if (custom || ai) e.title = e.customTitle || e.aiTitle;
    e.lastTs = parseLastTsFromTail(tail);
    e.titleAt = e.mtimeMs;
    return e.title;
  }

  /** 트리 바이트(메인 + subagents·workflows 의 jsonl). 메인 mtime 기준 캐시 */
  async treeBytes(e) {
    if (e.treeAt === e.mtimeMs && e.treeBytesV != null) return e.treeBytesV;
    let total = e.size || 0;
    const scan = async (dir, depth) => {
      let ents = [];
      try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const d of ents) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) { if (depth < 2) await scan(p, depth + 1); continue; }
        if (!d.name.endsWith('.jsonl')) continue;
        try { total += (await fs.promises.stat(p)).size; } catch {}
      }
    };
    await scan(path.join(e.projectPath, e.sessionId, 'subagents'), 0);
    e.treeBytesV = total;
    e.treeAt = e.mtimeMs;
    return total;
  }

  findSession(sessionId) {
    return this.entries.get(String(sessionId).toLowerCase()) || this.entries.get(sessionId) || null;
  }

  sorted() {
    let list = [...this.entries.values()];
    if (this.project) list = list.filter((e) => e.projectDir === this.project);
    return list.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  /** 메인 후보 여부: sdk-cli 가 아니고 claude-p 자식으로 매칭되지 않은 것 */
  async isCandidate(e) {
    const h = await this.ensureHead(e);
    if (!h.hasUser && !h.entrypoint) return false;
    if (h.entrypoint === 'sdk-cli') return false;
    if (this.claimedChildren.has(e.sessionId)) return false;
    return true;
  }

  /** 세션 트리 활동 시각: 메인 파일 mtime 과 <sid>/subagents(·workflows) 안 최신 파일 mtime 중 큰 값.
   *  메인이 워크플로·서브에이전트를 기다리는 동안에는 메인 파일이 멈춰 있으므로 하위 파일까지 본다. */
  async activityMs(e) {
    let best = e.mtimeMs;
    const base = path.join(e.projectPath, e.sessionId, 'subagents');
    const scan = async (dir, depth) => {
      let ents = [];
      try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const d of ents) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) { if (depth < 2) await scan(p, depth + 1); continue; }
        if (!d.name.endsWith('.jsonl')) continue;
        try { const st = await fs.promises.stat(p); if (st.mtimeMs > best) best = st.mtimeMs; } catch {}
      }
    };
    // 메인 파일이 6시간 넘게 멈춘 세션은 하위를 훑지 않는다(비용 절약)
    if (Date.now() - e.mtimeMs < 6 * 3600_000) await scan(base, 0);
    e.activityMs = best;
    return best;
  }

  /** follow=auto 가 고를 세션 (120초 끈끈함). 후보 상위 8개를 트리 활동 시각으로 다시 정렬한다. */
  async autoPick() {
    if (this.fixedSession) return this.fixedSession;
    if (Date.now() - this.lastRefresh > 4000) await this.refresh();
    const cands = [];
    for (const e of this.sorted()) {
      if (await this.isCandidate(e)) { cands.push(e); if (cands.length >= 8) break; }
    }
    if (!cands.length) return this.autoCurrent;
    for (const e of cands) await this.activityMs(e);
    cands.sort((a, b) => b.activityMs - a.activityMs);
    const best = cands[0];
    const cur = this.autoCurrent ? this.findSession(this.autoCurrent) : null;
    if (!cur || !(await this.isCandidate(cur))) { this.autoCurrent = best.sessionId; return this.autoCurrent; }
    // /clear: 지금 세션을 이어받은 새 세션(머리 clearAt + 앞 세션 = 지금 세션)이 후보에 있으면 120초를 기다리지 않고 바로 넘어간다
    for (const e of cands) {
      if (e.sessionId === cur.sessionId) continue;
      const p = await findClearPredecessor(this, e).catch(() => null);
      if (p && p.entry.sessionId === cur.sessionId) { this.autoCurrent = e.sessionId; return this.autoCurrent; }
    }
    const curAct = cands.includes(cur) ? cur.activityMs : await this.activityMs(cur);
    if (best.sessionId !== cur.sessionId && Date.now() - curAct > 120_000 && best.activityMs > curAct) {
      this.autoCurrent = best.sessionId;
    }
    return this.autoCurrent;
  }

  /**
   * 세션 목록. opts.project 는 좁히기만(config.project 와 다르면 빈 목록), opts.kind 'main' 은 자식 제외.
   * opts.sort: 'recent'(기본, 마지막 기록 시각 endedAt 내림차순) | 'start'(첫 기록 시각 startedAt 내림차순).
   * opts.since(epoch ms): 마지막 기록이 그 뒤인 세션만.
   *
   * 예전엔 파일 mtime 순으로 limit 개를 잘랐다. mtime 은 ai-title·custom-title 처럼 시각 없는 레코드가 붙을 때도 바뀌고
   * (실측 최대 2시간 반 차이), 웹은 그 목록을 endedAt 으로 다시 정렬하면서 줄에는 startedAt 을 보여 줘 순서가 틀어져 보였다.
   * 지금은 첫·마지막 기록의 timestamp 로만 정렬한다. 기록 시각 ≤ mtime 이므로 mtime 내림차순으로 훑다가
   * "다음 파일 mtime < 지금까지 limit 번째 정렬 키" 가 되면 더 볼 필요가 없다(정확한 조기 종료).
   */
  async list(limit = 30, { project = null, kind = 'all', sort = 'recent', since = null } = {}) {
    if (Date.now() - this.lastRefresh > 4000) await this.refresh();
    const out = [];
    if (project && this.project && project !== this.project) return out;
    const keyOf = sort === 'start' ? (x) => x._s : (x) => x._e;
    const sinceMs = Number.isFinite(Number(since)) && since != null ? Number(since) : null;
    let kth = -Infinity; // 지금까지 모은 것 중 limit 번째로 큰 정렬 키
    for (const e of this.sorted()) {
      if (project && e.projectDir !== project) continue;
      if (out.length >= limit && e.mtimeMs < kth) break;
      if (sinceMs != null && e.mtimeMs < sinceMs) break;
      const h = await this.ensureHead(e);
      if (!h.hasUser && !h.entrypoint) continue;
      const isChild = h.entrypoint === 'sdk-cli' || this.claimedChildren.has(e.sessionId);
      if (kind === 'main' && isChild) continue;
      await this.ensureTitle(e);
      const item = this.listItem(e, h, isChild, await this.treeBytes(e));
      if (sinceMs != null && item._e < sinceMs) continue;
      out.push(item);
      if (out.length >= limit) {
        out.sort((a, b) => keyOf(b) - keyOf(a));
        out.length = limit;
        kth = keyOf(out[limit - 1]);
      }
    }
    out.sort((a, b) => keyOf(b) - keyOf(a) || (a.sessionId < b.sessionId ? -1 : 1));
    for (const x of out) { delete x._s; delete x._e; }
    return out;
  }

  /** 목록 한 줄. startedAt·endedAt 은 첫·마지막 기록의 timestamp(없을 때만 파일 시각으로 대신하고 endApprox) */
  listItem(e, h, isChild, bytes) {
    const live = this.live.get(e.sessionId);
    const proc = this.procs?.get?.(String(e.sessionId).toLowerCase());
    const firstMs = h.firstTs ? Date.parse(h.firstTs) : NaN;
    const lastMs = e.lastTs ? Date.parse(e.lastTs) : NaN;
    const endMs = Number.isFinite(lastMs) ? lastMs : e.mtimeMs;
    const startMs = Number.isFinite(firstMs) ? Math.min(firstMs, endMs) : Math.min(e.birthtimeMs || e.mtimeMs, endMs);
    const startedAt = h.firstTs ? isoSafe(h.firstTs) : null;
    const endedAt = new Date(endMs).toISOString();
    return {
      sessionId: e.sessionId,
      projectDir: e.projectDir,
      cwd: h.cwd,
      title: e.title ? redact(e.title) : null, // 첫 프롬프트는 제목으로 쓰지 않음(customTitle·aiTitle 만)
      entrypoint: h.entrypoint,
      isChild,
      parentSessionId: isChild ? (this.childParent.get(e.sessionId) || null) : null,
      mtime: new Date(e.mtimeMs).toISOString(),
      sizeBytes: e.size,
      live: !!live,
      running: !!(proc && proc.alive),
      liveStatus: live ? live.status : null,
      startedAt,
      endedAt,
      ...(Number.isFinite(lastMs) ? {} : { endApprox: true }),
      durationMs: startedAt ? Math.max(0, endMs - Date.parse(startedAt)) : null,
      eventCount: null,
      eventCountEst: Math.max(1, Math.round(bytes / EVENT_BYTES_K)),
      replayCached: false,
      _s: startMs, _e: endMs,
    };
  }

  /** 프로젝트별 집계(projects[]). config.project 필터 적용, limit 과 무관 */
  async projects() {
    if (Date.now() - this.lastRefresh > 4000) await this.refresh();
    const by = new Map();
    for (const e of this.sorted()) {
      let p = by.get(e.projectDir);
      if (!p) { p = { projectDir: e.projectDir, cwd: null, sessions: 0, lastMtime: e.mtimeMs, _e: e }; by.set(e.projectDir, p); }
      p.sessions++;
      if (e.mtimeMs > p.lastMtime) { p.lastMtime = e.mtimeMs; p._e = e; }
    }
    const out = [];
    for (const p of by.values()) {
      const h = await this.ensureHead(p._e);
      out.push({ projectDir: p.projectDir, cwd: h.cwd || null, sessions: p.sessions, lastMtime: new Date(p.lastMtime).toISOString() });
    }
    return out.sort((a, b) => (a.lastMtime < b.lastMtime ? 1 : -1));
  }

  /** claude -p 휴리스틱 후보: 최근(기본: 서버 기동 1시간 전 이후) 생성된 sdk-cli 세션.
   *  untilMs 를 주면 그 뒤에 생긴 파일은 뺀다(재생: [세션 첫 ts − 1h, 세션 끝 + 1h]) */
  async recentSdkChildren(sinceMs = this.startedAt - 3600_000, untilMs = Infinity) {
    const out = [];
    for (const e of this.entries.values()) {
      if (Math.max(e.birthtimeMs || 0, e.mtimeMs) < sinceMs) continue;
      const h = await this.ensureHead(e);
      // 생성 시각: 파일 생성 시각은 복사(보관함)·복원에 흔들리므로 첫 기록 시각이 더 이르면 그것
      if (Math.min(e.birthtimeMs || e.mtimeMs, e.mtimeMs) > untilMs && !(Date.parse(h.firstTs || '') <= untilMs)) continue;
      if (h.entrypoint === 'sdk-cli' && h.firstTs) out.push(e);
    }
    return out;
  }

  liveStatus(sessionId) { return this.live.get(sessionId)?.status ?? null; }
}

/**
 * 출력 파일·폴더 경로의 임시 폴더 기준 상대 부분 `<인코딩 cwd>/<세션ID>/tasks[/<파일>]`(보관함 `_tasks/` 아래 같은 경로).
 * 마지막 `tasks` 구간 앞에 두 구간이 없으면 null
 */
export function taskRelOf(p) {
  const segs = String(p || '').split(/[\\/]+/).filter(Boolean);
  let i = -1;
  for (let k = segs.length - 1; k >= 2; k--) if (segs[k].toLowerCase() === 'tasks') { i = k; break; }
  return i < 0 ? null : segs.slice(i - 2).join('/');
}

/** tasks/<taskId>.output 위치 찾기. roots 를 주면 임시 폴더 대신 그 아래만(보관함 `_tasks`) */
export async function findTaskOutput(taskId, { knownDirs = [], encodedCwd = null, sessionId = null, roots: rootsOpt = null } = {}) {
  const name = `${taskId}.output`;
  const tryFile = async (p) => { try { await fs.promises.access(p, fs.constants.R_OK); return p; } catch { return null; } };
  for (const d of knownDirs) { const p = await tryFile(path.join(d, name)); if (p) return p; }
  const roots = rootsOpt || claudeTmpRoots();
  if (encodedCwd && sessionId) {
    for (const r of roots) { const p = await tryFile(path.join(r, encodedCwd, sessionId, 'tasks', name)); if (p) return p; }
  }
  for (const r of roots) {
    let cwds = [];
    try { cwds = await fs.promises.readdir(r); } catch { continue; }
    if (encodedCwd) cwds.sort((a, b) => (b === encodedCwd) - (a === encodedCwd));
    for (const c of cwds) {
      let sess = [];
      try { sess = await fs.promises.readdir(path.join(r, c)); } catch { continue; }
      for (const s of sess) { const p = await tryFile(path.join(r, c, s, 'tasks', name)); if (p) return p; }
    }
  }
  return null;
}
