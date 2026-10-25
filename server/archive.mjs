// 보관함(transcript archive) — 읽기 전용 두 번째 세션 출처.
// 폴더 구조는 ~/.claude/projects 와 같다: <인코딩된 프로젝트 폴더>/<세션ID>.jsonl + <세션ID>/subagents/… , 루트에 index.json·INDEX.md.
// 서버는 이 폴더를 절대 고쳐 쓰지 않는다(쓰기는 `ccviz archive add` 만, bin/archive.mjs).
// 실시간 감시(라이브 런타임·전체 보기 허브)·autoPick 대상이 아니다 — 재생(/timeline·/replay/*)과 목록(/sessions?source=archive, /archive)만.
import fs from 'node:fs';
import path from 'node:path';
import { SessionIndex, taskRelOf } from './discovery.mjs';
import { ReplayCache } from './replay.mjs';
import { assignNames, guessPathFromId } from './projects.mjs';
import { redact } from './redact.mjs';

/** 보관함 세션 id 규칙: 'arc:<세션 uuid>' (원본 세션 id 와 겹치지 않음, URL ?replay=arc:<uuid>) */
export const ARCHIVE_PREFIX = 'arc:';
export const isArchiveId = (s) => typeof s === 'string' && s.toLowerCase().startsWith(ARCHIVE_PREFIX);
export const archiveKey = (s) => (isArchiveId(s) ? s.slice(ARCHIVE_PREFIX.length).toLowerCase() : String(s || '').toLowerCase());
export const archiveId = (sid) => ARCHIVE_PREFIX + String(sid).toLowerCase();
/** 보관함 안 백그라운드 출력 폴더: `_tasks/<인코딩 cwd>/<세션ID>/tasks/<id>.output`(임시 폴더 claude 루트 기준 상대 경로 그대로) */
export const ARCHIVE_TASKS = '_tasks';

/** index.json 한 항목 → 내보낼 지표(경로·줄 수 같은 내부 값은 빼고) */
export function metaOf(it) {
  if (!it || typeof it !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    why: Array.isArray(it.why) ? it.why.map((x) => redact(String(x))).slice(0, 8) : [],
    tools: num(it.tools), kinds: num(it.kinds), agents: num(it.agents), subs: num(it.subs), bg: num(it.bg),
    hours: num(it.hours), mb: num(it.mb), score: num(it.score),
    first: typeof it.first === 'string' ? it.first : null, last: typeof it.last === 'string' ? it.last : null,
  };
}

export class ArchiveSource {
  constructor({ dir, privacy = 'summary', maxDepth = 8, replayCacheMax = 2 } = {}) {
    this.dir = path.resolve(dir);
    // sessionsDir 는 없는 폴더 → live·procs 가 비어 있다(보관 세션은 늘 끝난 세션)
    this.index = new SessionIndex({ projectsDir: this.dir, sessionsDir: path.join(this.dir, '.ccviz-no-live') });
    // 출력 파일은 보관함 `_tasks/` 아래에서만 찾는다(기록에 적힌 원래 임시 폴더 경로는 같은 상대 경로로 바꿔 읽음 — 다른 PC·원본 삭제 뒤에도 같은 답)
    const tasksDir = path.join(this.dir, ARCHIVE_TASKS);
    const mapRel = (p) => { const r = taskRelOf(p); return r ? path.join(tasksDir, ...r.split('/')) : null; };
    this.index.taskRoots = [tasksDir];
    this.index.mapTaskDir = mapRel;
    // 보관 때 원본에서 정한 기동기 판정(index.json pins) — 회차 판정·스크립트 사슬
    this.index.assignPin = (sid) => this.pins().cycles.get(String(sid).toLowerCase()) || null;
    this.index.launchPin = (tuid) => this.pins().launches.get(String(tuid)) || null;
    this.index.mapTaskFile = (f) => { const p = mapRel(f); try { return p && fs.statSync(p).isFile() ? p : null; } catch { return null; } };
    this.replays = new ReplayCache({ index: this.index, privacy, max: replayCacheMax, maxDepth, idPrefix: ARCHIVE_PREFIX });
    this._meta = null; this._metaAt = -1;
  }

  get enabled() { try { return fs.statSync(this.dir).isDirectory(); } catch { return false; } }

  /** index.json (mtime 캐시). 없거나 깨지면 빈 Map */
  meta() {
    const f = path.join(this.dir, 'index.json');
    let st = null;
    try { st = fs.statSync(f); } catch { this._meta = new Map(); this._kids = new Set(); this._pins = null; this._metaAt = -1; return this._meta; }
    if (this._meta && this._metaAt === st.mtimeMs) return this._meta;
    const m = new Map();
    try {
      const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const it of Array.isArray(arr) ? arr : []) if (it && it.sid) m.set(String(it.sid).toLowerCase(), it);
    } catch {}
    // 메인에 딸려 보관한 claude -p 자식(index.json children)은 목록·요약에 따로 세지 않는다(재생 때 메인 트리 안에 나옴)
    const kids = new Set();
    for (const it of m.values()) for (const c of Array.isArray(it.children) ? it.children : []) {
      const k = String(c && c.sid || '').toLowerCase();
      if (k && !m.has(k)) kids.add(k);
    }
    this._kids = kids;
    const cycles = new Map(), launches = new Map();
    for (const it of m.values()) {
      const p = it.pins || {};
      for (const [k, v] of Object.entries(p.cycles || {})) if (v && v.toolUseId) cycles.set(k.toLowerCase(), v);
      for (const [k, v] of Object.entries(p.launches || {})) if (v && v.key) launches.set(k, v);
    }
    this._pins = { cycles, launches };
    this._meta = m; this._metaAt = st.mtimeMs;
    return m;
  }

  /** 보관 때 고정한 기동기 판정 {cycles: sid → assign 결과, launches: toolUseId → 사슬 판정} */
  pins() { this.meta(); return this._pins || { cycles: new Map(), launches: new Map() }; }

  /** 메인에 딸린 자식으로 보관된 세션 id(소문자) */
  attachedChildren() { this.meta(); return this._kids || new Set(); }

  async refresh() { return this.index.refresh(); }

  /** /sessions?source=archive — 일반 목록과 같은 모양 + sessionId 'arc:…'·archive:true·archiveMeta */
  async list(limit = 200, opts = {}) {
    const meta = this.meta();
    const kids = this.attachedChildren();
    const list = await this.index.list(limit + kids.size, opts);
    return list.filter((s) => !kids.has(String(s.sessionId).toLowerCase())).slice(0, limit).map((s) => this.decorate(s, meta));
  }

  decorate(s, meta = this.meta()) {
    const sid = String(s.sessionId).toLowerCase();
    const d = this.replays.cache.get(sid);
    return {
      ...s, sessionId: archiveId(sid), originalSessionId: sid, archive: true,
      live: false, running: false, liveStatus: null, parentSessionId: s.parentSessionId ? archiveId(s.parentSessionId) : null,
      ...(d ? { eventCount: d.events.length, replayCached: true } : {}),
      archiveMeta: metaOf(meta.get(sid)),
    };
  }

  /** GET /archive — 선택기·설명 카드용 요약 */
  async summary({ project = null } = {}) {
    if (!this.enabled) return { enabled: false, count: 0, projects: [], sessions: [] };
    if (Date.now() - (this.index.lastRefresh || 0) > 4000) await this.index.refresh();
    const meta = this.meta();
    const kids = this.attachedChildren();
    const sessions = [];
    const by = new Map();
    for (const e of this.index.entries.values()) {
      if (project && e.projectDir !== project) continue;
      if (kids.has(String(e.sessionId).toLowerCase())) continue;
      const h = await this.index.ensureHead(e);
      if (!h.hasUser && !h.entrypoint) continue;
      await this.index.ensureTitle(e);
      const isChild = h.entrypoint === 'sdk-cli';
      const it = this.index.listItem(e, h, isChild, await this.index.treeBytes(e));
      delete it._s; delete it._e;
      const row = this.decorate(it, meta);
      sessions.push({ sessionId: row.sessionId, projectId: e.projectDir, title: row.title, startedAt: row.startedAt, endedAt: row.endedAt,
        durationMs: row.durationMs, isChild, archiveMeta: row.archiveMeta });
      let p = by.get(e.projectDir);
      const m = meta.get(String(e.sessionId).toLowerCase());
      if (!p) { p = { projectId: e.projectDir, path: null, sessions: 0, firstAt: null, lastActivityAt: null }; by.set(e.projectDir, p); }
      p.sessions++;
      if (!p.path) p.path = h.cwd || (m && m.cwd) || null;
      if (row.endedAt && (!p.lastActivityAt || row.endedAt > p.lastActivityAt)) p.lastActivityAt = row.endedAt;
      if (row.startedAt && (!p.firstAt || row.startedAt < p.firstAt)) p.firstAt = row.startedAt;
    }
    const items = [...by.values()].map((p) => ({ ...p, path: p.path || guessPathFromId(p.projectId), nameGuessed: !p.path, temp: false }));
    const names = assignNames(items);
    const projects = items.map((p) => ({ projectId: p.projectId, name: names.get(p.projectId) || p.projectId, path: redact(p.path),
      sessions: p.sessions, firstAt: p.firstAt, lastActivityAt: p.lastActivityAt }))
      .sort((a, b) => (b.lastActivityAt || '').localeCompare(a.lastActivityAt || ''));
    sessions.sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
    return { enabled: true, count: sessions.length, projects, sessions };
  }

  replay(sid, opts) { return this.replays.get(archiveKey(sid), opts); }
  replayPeek(sid) { return this.replays.peek(archiveKey(sid)); }
  has(sid) { return !!this.index.findSession(archiveKey(sid)); }

  async projectOf(sid) {
    let e = this.index.findSession(archiveKey(sid));
    if (!e && Date.now() - (this.index.lastRefresh || 0) > 4000) { await this.index.refresh(); e = this.index.findSession(archiveKey(sid)); }
    return e ? e.projectDir : null;
  }
}

/** 보관함 폴더 결정: CLI --archive > 환경변수 CCVIZ_ARCHIVE > config.archiveDir. 없으면 null(기능 꺼짐) */
export function resolveArchiveDir({ arg = null, env = process.env, cfg = null } = {}) {
  const v = arg || env.CCVIZ_ARCHIVE || (cfg && cfg.archiveDir) || null;
  return v ? String(v) : null;
}
