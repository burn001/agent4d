// 작업(Job) 오브젝트 — 출력 스트림이 "보고하는 작업"을 노드로 세운다
// 순수 코어: 그래프·파일 없음(설정 읽기 loadJobRules 만 fs). node --test 대상(server/test/jobs.test.mjs).
//
// 두 길:
//  (가) 규약 줄 `::agent4d {json}` — 어떤 스크립트든 출력에 한 줄을 내면 그 스트림 주인 노드 아래 작업 하나.
//  (나) 대체 규칙 — 설정 파일(jobs.json)의 정규식이 규약 없는 일반 줄을 같은 작업 이벤트로 바꾼다.
//  같은 스트림에서 규약 줄을 한 번이라도 보면 그 스트림의 대체 규칙은 끈다(규약이 이긴다).
import fs from 'node:fs';
import path from 'node:path';
import { redact } from './redact.mjs';
import { truncate } from './parse.mjs';
import { ProgressLanes } from './progress.mjs'; // 진행 줄 자동 인식(레인)

export const JOB = {
  STALE_SEC: 600,        // 박동이 이만큼 끊기면 정체(설정·규약 staleSec 로 바꿈)
  KEEP_ENDED: 3,         // 주인 노드마다 남겨 둘 끝난 작업 수(웹 접기, 회차 접기와 같은 방식)
  MAX_PER_OWNER: 64,     // 주인 노드 하나에 세울 작업 노드 상한(넘는 새 id 는 버림)
  ID_MAX: 80, TITLE_MAX: 80, PHASE_MAX: 120, LINE_MAX: 160, HOST_MAX: 60,
  BEAT_EMIT_MS: 30_000,  // 박동만 바뀐 갱신은 이 간격에 한 번만 낸다
  PARTIAL_MAX: 4000,     // 줄 끝을 기다리는 미완성 조각 상한
  AUTO_ID: 'progress',   // 자동 진행 작업 id(스트림 주인마다 하나)
  LANE_EMIT_MS: 2000,    // 레인 값만 바뀐 갱신은 이 간격에 한 번만 낸다(상태가 바뀌면 바로)
};

export const JOB_STATES = ['queued', 'running', 'waiting', 'done', 'failed'];
const STATE_ALIAS = {
  queued: 'queued', queue: 'queued', pending: 'queued',
  running: 'running', run: 'running', start: 'running', started: 'running', active: 'running', progress: 'running',
  waiting: 'waiting', wait: 'waiting', sleep: 'waiting', paused: 'waiting', blocked: 'waiting',
  done: 'done', ok: 'done', success: 'done', succeeded: 'done', completed: 'done', complete: 'done', finished: 'done', end: 'done',
  failed: 'failed', fail: 'failed', error: 'failed', err: 'failed', crashed: 'failed', killed: 'failed', aborted: 'failed',
};
export const normState = (s) => (s == null ? null : STATE_ALIAS[String(s).trim().toLowerCase()] || null);
export const isJobEnded = (st) => st === 'done' || st === 'failed';

/** 작업 상태 → 노드 status(웹 공통 색·퇴장 규칙). 대기·줄 서기는 idle */
export function jobNodeStatus(st) {
  if (st === 'running') return 'active';
  if (st === 'done') return 'done';
  if (st === 'failed') return 'error';
  return 'idle';
}

/** 작업 id 를 노드 id 조각으로: 공백·제어 문자 정리, 80자 */
export function safeJobId(id) {
  const s = String(id ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, JOB.ID_MAX) : null;
}

/** 작업 노드 id: `j:<주인 사슬 머리 노드 id>:<작업 id>` */
export const jobNodeId = (ownerKey, jobId) => `j:${ownerKey}:${jobId}`;

const clean = (v, n) => {
  if (v == null || v === '') return null;
  const s = String(v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return s ? truncate(redact(s), n) : null;
};

// ───────────── 시각 ─────────────

const pad2 = (n) => String(n).padStart(2, '0');
/**
 * 줄에 적힌 시각(ISO · 'YYYY-MM-DD HH:MM[:SS]' · 'HH:MM[:SS]') → ISO. 날짜가 없으면 기준 시각(refMs)의
 * 지역 날짜로 붙이고, dir 'past' 면 기준보다 1시간 넘게 미래일 때 하루 앞, 'future' 면 1시간 넘게 과거일 때 하루 뒤.
 * 시간대 표기가 없으면 서버 지역 시간으로 읽는다(스크립트와 서버가 같은 시간대라는 가정 — 제한에 적음).
 */
export function resolveClock(str, refMs, dir = 'past') {
  if (str == null || str === '') return null;
  if (typeof str === 'number' && Number.isFinite(str)) return new Date(str > 1e12 ? str : str * 1000).toISOString();
  const s = String(str).trim();
  const ref = Number.isFinite(refMs) ? refMs : Date.now();
  let m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    if (m[7]) { const t = Date.parse(s.replace(' ', 'T')); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    const r = new Date(ref);
    const d = new Date(r.getFullYear(), r.getMonth(), r.getDate(), +m[1], +m[2], +(m[3] || 0));
    let t = d.getTime();
    if (!Number.isFinite(t) || +m[1] > 23 || +m[2] > 59) return null;
    if (dir === 'past' && t > ref + 3600_000) t -= 86400_000;
    if (dir === 'future' && t < ref - 3600_000) t += 86400_000;
    return new Date(t).toISOString();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// ───────────── 진행 n/total ─────────────

/** '96/101' · [96,101] · {n,total} · 0.42(비율) → {n,total} 또는 {ratio} */
export function parseProgress(v, n2 = null) {
  if (v == null && n2 == null) return null;
  if (n2 != null && v != null && typeof v !== 'object') { const n = +String(v).replace(/,/g, ''), t = +String(n2).replace(/,/g, ''); return Number.isFinite(n) && t > 0 ? { n, total: t } : null; }
  if (v && typeof v === 'object' && !Array.isArray(v)) { const n = +v.n, t = +v.total; return Number.isFinite(n) && t > 0 ? { n, total: t } : null; }
  if (Array.isArray(v)) { const n = +v[0], t = +v[1]; return Number.isFinite(n) && t > 0 ? { n, total: t } : null; }
  if (typeof v === 'number') return v >= 0 && v <= 1 ? { ratio: v } : null;
  if (typeof v === 'string') {
    const m = /(-?[\d,]+)\s*\/\s*([\d,]+)/.exec(v);
    if (m) { const n = +m[1].replace(/,/g, ''), t = +m[2].replace(/,/g, ''); return Number.isFinite(n) && t > 0 ? { n, total: t } : null; }
    const p = /^(\d+(?:\.\d+)?)\s*%$/.exec(v.trim());
    if (p) return { ratio: Math.max(0, Math.min(1, +p[1] / 100)) };
  }
  return null;
}

// ───────────── (가) 규약 줄 ─────────────

const PROTO_RE = /(?:^|[\s\]>|:])::agent4d\s+(\{.*?)\s*$/;

/**
 * 한 줄에서 규약 이벤트를 읽는다. 줄 앞에 중계 접두어(`[회차] ` 같은 것)가 있어도 된다.
 * → { id, title?, state?, phase?, progress?, host?, heartbeat?, until?, rc?, staleSec?, note? } 또는 null(규약 줄 아님)
 *   규약 꼴인데 JSON 이 깨졌거나 id 가 없으면 { bad: true }
 */
export function parseProtocolLine(line) {
  if (typeof line !== 'string' || !line.includes('::agent4d')) return null;
  const m = PROTO_RE.exec(line);
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[1]); } catch { return { bad: true }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { bad: true };
  const id = safeJobId(o.id ?? o.job ?? o.job_id);
  if (!id) return { bad: true };
  const ev = { id };
  if (o.title != null) ev.title = o.title;
  const st = normState(o.state ?? o.status);
  if (st) ev.state = st;
  if (o.phase != null) ev.phase = o.phase;
  const pr = parseProgress(o.progress ?? (o.n != null ? o.n : null), o.total ?? null);
  if (pr) ev.progress = pr;
  if (o.host != null) ev.host = o.host;
  if (o.heartbeat != null) ev.heartbeat = o.heartbeat; // ISO·시각 문자열·true(지금)
  if (o.until != null) ev.until = o.until;
  if (o.rc != null && Number.isFinite(+o.rc)) ev.rc = Math.trunc(+o.rc);
  const ss = o.staleSec ?? o.stale_sec ?? o.stale_after;
  if (ss != null && +ss > 0) ev.staleSec = +ss;
  if (o.stale === true) ev.stale = true;
  const note = o.note ?? o.msg ?? o.message;
  if (note != null) ev.note = note;
  return ev;
}

// ───────────── (나) 대체 규칙 ─────────────

export const RULE_ON = ['start', 'phase', 'progress', 'wait', 'beat', 'stale', 'end', 'fail'];

/** `$1`·`$<name>` 자리 채우기(없는 묶음은 빈칸) */
function fill(tpl, m) {
  if (tpl == null) return null;
  return String(tpl).replace(/\$<([A-Za-z_]\w*)>|\$(\d{1,2})/g, (_, name, num) => {
    const v = name ? m.groups?.[name] : m[+num];
    return v == null ? '' : v;
  });
}

/**
 * 설정 원본 → 정규화한 규칙 묶음. 잘못된 규칙은 errors 에 남기고 건너뛴다.
 * @returns {{ staleSec, keepEnded, sets: [{ name, project, streams, files, staleSec, rules:[{on, re, job, title, ...}] }], errors: string[] }}
 */
export function compileJobRules(raw, { source = 'config' } = {}) {
  const errors = [];
  const o = raw && typeof raw === 'object' ? raw : {};
  const staleSec = +o.staleSec > 0 ? +o.staleSec : JOB.STALE_SEC;
  const keepEnded = Number.isInteger(o.keepEnded) && o.keepEnded >= 0 ? o.keepEnded : JOB.KEEP_ENDED;
  const sets = [];
  for (const [si, s] of (Array.isArray(o.sets) ? o.sets : []).entries()) {
    if (!s || typeof s !== 'object') continue;
    const name = String(s.name || `${source}#${si + 1}`).slice(0, 60);
    const rules = [];
    for (const [ri, r] of (Array.isArray(s.rules) ? s.rules : []).entries()) {
      const where = `${name} 규칙 ${ri + 1}`;
      if (!r || !RULE_ON.includes(r.on)) { errors.push(`${where}: on 은 ${RULE_ON.join('|')} 중 하나`); continue; }
      let re;
      try { re = new RegExp(String(r.re ?? ''), String(r.flags || '').replace(/[gy]/g, '')); } catch (e) { errors.push(`${where}: 정규식 오류 ${e.message}`); continue; }
      if (!r.re) { errors.push(`${where}: re 가 비었다`); continue; }
      rules.push({ on: r.on, re, job: r.job ?? null, title: r.title ?? null, state: normState(r.state),
        phase: r.phase ?? null, progress: r.progress ?? null, host: r.host ?? null, until: r.until ?? null, rc: r.rc ?? null,
        staleSec: +r.staleSec > 0 ? +r.staleSec : null });
    }
    let streams = null;
    if (s.streams && typeof s.streams === 'object') {
      const rx = (v, k) => { if (v == null || v === '') return null; try { return new RegExp(String(v), 'i'); } catch (e) { errors.push(`${name} streams.${k}: ${e.message}`); return /$^/; } };
      const kinds = s.streams.kind == null ? null : [].concat(s.streams.kind).map(String);
      streams = { kind: kinds, label: rx(s.streams.label, 'label'), command: rx(s.streams.command, 'command') };
    }
    const files = (Array.isArray(s.files) ? s.files : []).filter((f) => f && typeof f.path === 'string' && f.path)
      .map((f) => ({ path: f.path, owner: ['runner', 'launcher', 'main'].includes(f.owner) ? f.owner : 'runner', backlogKB: +f.backlogKB > 0 ? Math.min(+f.backlogKB, 1024) : 64 }));
    sets.push({ name, project: s.project ? String(s.project) : null, streams, files, staleSec: +s.staleSec > 0 ? +s.staleSec : null, rules });
  }
  return { staleSec, keepEnded, sets, errors };
}

/** 프로젝트 조건: 루트 cwd·프로젝트 폴더 이름에 대소문자 무시 부분 일치(빈 조건은 모두) */
export function setMatchesProject(set, { cwd = null, projectDir = null } = {}) {
  if (!set.project) return true;
  const p = set.project.toLowerCase().replace(/\\/g, '/');
  return [cwd, projectDir].some((x) => x && String(x).toLowerCase().replace(/\\/g, '/').includes(p));
}

/** 스트림 조건: 주인 노드 kind·label·command. 파일 묶음(files 있음)은 출력 스트림에 쓰지 않는다 */
export function setMatchesStream(set, owner) {
  if (set.files.length) return false;
  const f = set.streams;
  if (!f) return true;
  if (!owner) return false;
  if (f.kind && !f.kind.includes(owner.kind)) return false;
  if (f.label && !f.label.test(owner.label || '')) return false;
  if (f.command && !f.command.test(owner.meta?.command || '')) return false;
  return true;
}

/** 한 줄에 묶음의 규칙을 차례로 대 보고 처음 맞는 것 하나 → 작업 이벤트 또는 null */
export function matchRules(line, set) {
  for (const r of set.rules) {
    const m = r.re.exec(line);
    if (!m) continue;
    const g = m.groups || {};
    const pick = (field) => (r[field] != null ? fill(r[field], m) : g[field]);
    const id = safeJobId(r.job != null ? fill(r.job, m) : g.id) || safeJobId(set.name);
    if (!id) continue;
    const ev = { id, on: r.on, set: set.name };
    const title = pick('title'); if (title) ev.title = title;
    if (r.state) ev.state = r.state;
    const phase = pick('phase'); if (phase) ev.phase = phase;
    const pr = r.progress != null ? parseProgress(fill(r.progress, m)) : parseProgress(g.progress ?? (g.n != null ? g.n : null), g.total ?? null);
    if (pr) ev.progress = pr;
    const host = pick('host'); if (host) ev.host = host;
    const until = pick('until'); if (until) ev.until = until;
    const rc = pick('rc'); if (rc != null && rc !== '' && Number.isFinite(+rc)) ev.rc = Math.trunc(+rc);
    if (g.time) ev.time = g.time;
    if (g.beat) ev.beat = g.beat;
    if (r.staleSec) ev.staleSec = r.staleSec;
    return ev;
  }
  return null;
}

// ───────────── 설정 읽기 ─────────────

const _cfgCache = new Map(); // file → { mtimeMs, size, val }
/** jobs.json 하나를 읽어 compile(파일 mtime 이 같으면 캐시). 없으면 null */
export function readJobRulesFile(file) {
  let st;
  try { st = fs.statSync(file); } catch { _cfgCache.delete(file); return null; }
  const c = _cfgCache.get(file);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.val;
  let val;
  try { val = compileJobRules(JSON.parse(fs.readFileSync(file, 'utf8')), { source: path.basename(path.dirname(file)) }); }
  catch (e) { val = { ...compileJobRules({}), errors: [`${file}: ${e.message}`] }; }
  _cfgCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, val });
  return val;
}

/** 사용자 설정 `<상태 폴더>/jobs.json` 과 프로젝트 설정 `<프로젝트 cwd>/.agent4d/jobs.json` 을 합친다(프로젝트 묶음이 앞) */
export function loadJobRules({ stateDir = null, cwd = null } = {}) {
  const parts = [];
  if (cwd) parts.push(readJobRulesFile(path.join(cwd, '.agent4d', 'jobs.json')));
  if (stateDir) parts.push(readJobRulesFile(path.join(stateDir, 'jobs.json')));
  const ok = parts.filter(Boolean);
  if (!ok.length) return null;
  return {
    staleSec: ok[0].staleSec, keepEnded: ok[0].keepEnded,
    sets: ok.flatMap((p) => p.sets), errors: ok.flatMap((p) => p.errors),
  };
}

// ───────────── 작업 장부 ─────────────

/**
 * 스트림(주인 노드)마다 줄을 받아 작업 상태를 굴린다. 그래프는 모른다 — 바뀐 작업 목록을 돌려주면
 * session.mjs 가 노드로 낸다. 라이브·첫 적재·재생이 같은 순서로 같은 줄을 넣으면 같은 답.
 */
export class JobBook {
  /** @param {{rules?:any, privacy?:string, ctx?:{cwd?:string, projectDir?:string}}} opts */
  constructor({ rules = null, privacy = 'summary', ctx = {} } = {}) {
    this.rules = rules;
    this.privacy = privacy;
    this.ctx = ctx;
    this.streams = new Map(); // streamKey → { partial, protocol }
    this.jobs = new Map();    // ownerKey → Map(jobId → job)
  }

  setRules(rules) { this.rules = rules; }

  _stream(key) {
    let s = this.streams.get(key);
    if (!s) { s = { partial: '', protocol: false, ruled: false, lanes: null, lastLine: null }; this.streams.set(key, s); }
    return s;
  }

  /**
   * 출력 조각을 넣는다. 줄 끝이 없으면 다음 조각까지 기다린다(final 이면 그대로 처리).
   * @param streamKey 스트림 이름(출력 노드 id 또는 file:<경로>)
   * @param ownerKey 작업이 붙는 주인 열쇠(재무장 Monitor 사슬은 머리 id)
   * @param owner 주인 노드(스트림 조건 판정용, 없어도 됨)
   * @param auto 규약·규칙이 맞지 않은 줄에서 진행 모양을 알아보고 자동 작업(JOB.AUTO_ID)에 레인을 싣는다
   * @returns 바뀐 작업 [{ jobId, job, isNew, beatOnly }]
   */
  feed(streamKey, ownerKey, text, tsIso, { owner = null, file = false, final = false, auto = false, autoTitle = null, staleSec = null, endAs = null } = {}) {
    const s = this._stream(streamKey);
    let buf = s.partial + String(text ?? '').replace(/\r\n?/g, '\n');
    const lines = buf.split('\n');
    s.partial = final ? '' : lines.pop();
    if (s.partial.length > JOB.PARTIAL_MAX) s.partial = s.partial.slice(-JOB.PARTIAL_MAX);
    if (final && lines.length && lines[lines.length - 1] === '') lines.pop();
    const sets = this._setsFor(owner, file, streamKey);
    const tsMs = Date.parse(tsIso);
    const changed = new Map();
    const autoLines = [];
    for (const raw of lines) {
      const line = raw.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').trimEnd();
      if (!line.trim()) continue;
      const p = parseProtocolLine(line);
      let ev = null;
      if (p) {
        if (p.bad) continue;
        s.protocol = true;
        ev = { ...p, on: 'protocol', src: 'protocol' };
      } else if (!s.protocol) {
        for (const set of sets) { ev = matchRules(line, set); if (ev) { ev.src = 'rule:' + set.name; ev.setStale = set.staleSec; s.ruled = true; break; } }
      }
      if (!ev) { if (auto) autoLines.push(line); continue; }
      const r = this._apply(ownerKey, ev, line, tsIso, tsMs);
      if (!r) continue;
      const prev = changed.get(r.jobId);
      changed.set(r.jobId, prev ? { ...r, isNew: prev.isNew || r.isNew, beatOnly: prev.beatOnly && r.beatOnly } : r);
    }
    if (autoLines.length) {
      const r = this.observe(streamKey, ownerKey, autoLines, tsIso, { autoTitle, staleSec, endAs });
      if (r) changed.set(r.jobId, r);
    }
    return [...changed.values()];
  }

  /**
   * 진행 줄 자동 인식: 줄들을 스트림의 레인에 넣고, 인정된 레인이 있으면 주인 아래 자동 작업(JOB.AUTO_ID)을 만들거나 고친다.
   * 규약 줄·대체 규칙이 한 번이라도 맞은 스트림은 하지 않는다(그쪽 우선, 원칙). 들여다본 결과(watch)도 이 길로 넣는다.
   * @param lines 줄 배열 또는 글 조각
   * @returns 바뀐 작업 하나({jobId, job, isNew, beatOnly}) 또는 null
   */
  observe(streamKey, ownerKey, lines, tsIso, { autoTitle = null, staleSec = null, endAs = null } = {}) {
    const s = this._stream(streamKey);
    if (s.protocol || s.ruled) return null;
    const arr = Array.isArray(lines) ? lines : String(lines ?? '').replace(/\r\n?/g, '\n').split('\n');
    const tsMs = Date.parse(tsIso);
    if (!s.lanes) s.lanes = new ProgressLanes();
    let moved = false;
    for (const raw of arr) {
      const line = String(raw).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').trimEnd();
      if (!line.trim() || line.includes('::agent4d')) continue;
      if (s.lanes.feedLine(line, tsMs)) { moved = true; s.lastLine = line; }
    }
    if (!moved) return null;
    const sum = s.lanes.summary();
    if (!sum) return null;
    const map = this.jobsOf(ownerKey);
    let job = map.get(JOB.AUTO_ID);
    const isNew = !job;
    if (isNew) {
      if (map.size >= JOB.MAX_PER_OWNER) return null;
      job = { v: 1, id: JOB.AUTO_ID, title: autoTitle ? clean(autoTitle, JOB.TITLE_MAX) : null, state: 'running', phase: null, progress: null, host: null, until: null, rc: null,
        beatAt: null, staleSec: null, stale: false, line: null, src: 'auto', startedAt: tsIso, endedAt: null,
        lanes: [], primary: null, rate: null, eta: null, heat: 0, _beatEmit: 0, _laneEmit: 0 };
      map.set(JOB.AUTO_ID, job);
    }
    if (job.src !== 'auto') return null; // 같은 id 를 규약이 이미 쓰고 있으면 건드리지 않는다
    let stateChanged = false;
    // endAs: 스트림 주인이 이미 끝났다(라이브 첫 적재에서 끝 알림·EXIT 를 로그 꼬리보다 먼저 읽은 경우) → 끝난 작업으로 싣는다
    if (endAs) { if (!isJobEnded(job.state)) { job.state = endAs.state === 'failed' ? 'failed' : 'done'; job.endedAt = endAs.ts || tsIso; if (endAs.rc != null) job.rc = endAs.rc; stateChanged = true; } }
    else if (isJobEnded(job.state)) { job.state = 'running'; job.rc = null; job.endedAt = null; stateChanged = true; } // 끝난 뒤 다시 늘면 되살림
    job.lanes = sum.lanes; job.primary = sum.primary; job.rate = sum.rate; job.eta = sum.eta; job.heat = sum.heat;
    job.progress = sum.progress;
    job.phase = this.privacy === 'minimal' ? null : clean(sum.primary, JOB.PHASE_MAX);
    if (staleSec) job.staleSec = staleSec;
    job.beatAt = tsIso;
    if (this.privacy !== 'minimal') job.line = clean(s.lastLine, JOB.LINE_MAX);
    if (!isNew && !stateChanged && Number.isFinite(tsMs) && tsMs - (job._laneEmit || 0) < JOB.LANE_EMIT_MS) { job._dirty = true; return null; }
    if (Number.isFinite(tsMs)) job._laneEmit = tsMs;
    job._dirty = false;
    return { jobId: job.id, job: publicJob(job), isNew, beatOnly: false };
  }

  /** 자동 작업(지금 값, 솎아 낸 갱신 포함). 없으면 null */
  autoJob(ownerKey) {
    const job = this.jobs.get(ownerKey)?.get(JOB.AUTO_ID);
    return job && job.src === 'auto' ? job : null;
  }

  /** 솎아 내느라 못 낸 레인 값이 있으면 그 갱신(라이브 sweep 이 부름). 없으면 null */
  flushAuto(ownerKey, tsIso) {
    const job = this.autoJob(ownerKey);
    if (!job || !job._dirty) return null;
    job._dirty = false;
    const t = Date.parse(tsIso);
    if (Number.isFinite(t)) job._laneEmit = t;
    return { jobId: job.id, job: publicJob(job), isNew: false, beatOnly: false };
  }

  /**
   * 자동 작업을 끝낸다(스트림 주인 노드가 끝났을 때). state done|failed, rc 선택. 바뀌면 갱신 하나, 아니면 null.
   * 솎아 내느라 못 낸 마지막 레인 값도 이때 함께 나간다.
   */
  endAuto(ownerKey, state, tsIso, rc = null) {
    const job = this.autoJob(ownerKey);
    if (!job || isJobEnded(job.state)) return null;
    job.state = state === 'failed' ? 'failed' : 'done';
    if (rc != null) job.rc = rc;
    job.endedAt = tsIso;
    job._dirty = false;
    return { jobId: job.id, job: publicJob(job), isNew: false, beatOnly: false };
  }

  _setsFor(owner, file, streamKey) {
    const R = this.rules;
    if (!R || !R.sets.length) return [];
    return R.sets.filter((set) => set.rules.length && setMatchesProject(set, this.ctx)
      && (file ? set.files.some((f) => streamKey === 'file:' + f.path) : setMatchesStream(set, owner)));
  }

  /** 주인 아래 작업 지도 */
  jobsOf(ownerKey) { let m = this.jobs.get(ownerKey); if (!m) { m = new Map(); this.jobs.set(ownerKey, m); } return m; }

  _apply(ownerKey, ev, line, tsIso, tsMs) {
    const map = this.jobsOf(ownerKey);
    let job = map.get(ev.id);
    const isNew = !job;
    if (isNew) {
      if (map.size >= JOB.MAX_PER_OWNER) return null;
      job = { v: 1, id: ev.id, title: null, state: 'running', phase: null, progress: null, host: null, until: null, rc: null,
        beatAt: null, staleSec: null, stale: false, line: null, src: ev.src, startedAt: tsIso, endedAt: null, _beatEmit: 0 };
      map.set(ev.id, job);
    }
    const before = JSON.stringify(publicJob(job));
    const minimal = this.privacy === 'minimal';
    const lineTime = ev.time ? resolveClock(ev.time, tsMs, 'past') : null;
    const at = lineTime || tsIso;
    if (ev.title != null) job.title = clean(ev.title, JOB.TITLE_MAX);
    if (ev.host != null) job.host = minimal ? null : clean(ev.host, JOB.HOST_MAX);
    const staleSec = ev.staleSec || ev.setStale || null;
    if (staleSec) job.staleSec = staleSec;
    const revive = () => { if (isJobEnded(job.state)) { job.rc = null; job.endedAt = null; job.startedAt = at; job.progress = null; } };
    let state = ev.state || null;
    switch (ev.on) {
      case 'start': revive(); job.startedAt = at; job.progress = null; job.rc = null; job.until = null; state = state || 'running'; break;
      case 'phase': case 'progress': revive(); state = state || 'running'; break;
      case 'wait': revive(); state = state || 'waiting'; break;
      case 'end': state = state || 'done'; break;
      case 'fail': state = state || 'failed'; break;
      case 'stale': job.stale = true; break;
      case 'beat': break;
      case 'protocol':
        if (state && !isJobEnded(state)) revive();
        if (state == null && ev.rc != null) state = ev.rc === 0 ? 'done' : 'failed';
        if (ev.stale) job.stale = true;
        break;
      default: break;
    }
    if (ev.phase != null) job.phase = minimal ? null : clean(ev.phase, JOB.PHASE_MAX);
    if (ev.progress) job.progress = ev.progress;
    if (ev.until != null) job.until = resolveClock(ev.until, tsMs, 'future');
    if (ev.rc != null) job.rc = ev.rc;
    if (state === 'done' && job.rc != null && job.rc !== 0) state = 'failed';
    if (state) {
      if (!isJobEnded(state)) job.endedAt = null;
      if (state !== 'waiting' && ev.until == null) job.until = null;
      job.state = state;
      if (isJobEnded(state) && !job.endedAt) job.endedAt = at;
    }
    // 박동: 정체 신호 줄은 마지막 박동 시각(묶음 beat)만 고친다. 그 밖에 이 작업을 가리킨 줄은 모두 박동
    if (ev.on === 'stale') {
      const b = ev.beat ? resolveClock(ev.beat, tsMs, 'past') : null;
      if (b) job.beatAt = b;
    } else {
      job.stale = ev.on === 'protocol' ? !!ev.stale : false;
      let hb = at;
      if (ev.heartbeat != null && ev.heartbeat !== true) hb = resolveClock(ev.heartbeat, tsMs, 'past') || at;
      if (!job.beatAt || Date.parse(hb) >= Date.parse(job.beatAt)) job.beatAt = hb;
    }
    if (!minimal) job.line = clean(ev.note != null ? ev.note : line, JOB.LINE_MAX);
    const after = JSON.stringify(publicJob(job));
    if (!isNew && before === after) return null;
    // 박동·마지막 줄만 바뀐 갱신은 BEAT_EMIT_MS 에 한 번(줄마다 노드 갱신이 쏟아지지 않게)
    const b0 = JSON.parse(before), a0 = JSON.parse(after);
    delete b0.beatAt; delete a0.beatAt; delete b0.line; delete a0.line;
    const beatOnly = !isNew && JSON.stringify(b0) === JSON.stringify(a0);
    if (beatOnly && Number.isFinite(tsMs) && tsMs - job._beatEmit < JOB.BEAT_EMIT_MS) return null;
    if (Number.isFinite(tsMs)) job._beatEmit = tsMs;
    return { jobId: job.id, job: publicJob(job), isNew, beatOnly };
  }
}

/** 노드 meta.job 에 싣는 모양(내부 필드 뺌) */
export function publicJob(j) {
  const { _beatEmit, _laneEmit, _dirty, ...rest } = j;
  if (rest.lanes) rest.lanes = rest.lanes.map((l) => ({ ...l, last: l.last ? { ...l.last } : null }));
  return rest;
}

/** 작업 노드 라벨: 제목 또는 id */
export const jobLabel = (job) => job.title || job.id;
