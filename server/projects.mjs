// 3차: 프로젝트 색인 — 사람이 읽는 이름 복원·활성 판정·/projects 집계
// 모든 파일은 읽기 전용. pid 는 내보내지 않는다.
import os from 'node:os';
import { redact } from './redact.mjs';

export const ACTIVE_MS = 10 * 60_000; // live 이고 활동이 10분 이내면 active
export const RECENT_MS = 2 * 3600_000; // live 가 아니고 2시간 이내면 recent
export const LIST_DAYS_MS = 30 * 86400_000; // 기본 목록: 최근 30일 안 세션이 있는 프로젝트
export const RECENT_LIST_MAX = 10;
export const NAME_MAX = 40;

const TEMP_RE = /[\\/]AppData[\\/]Local[\\/]Temp(?:[\\/]|$)/i;
const TEMP_ENC_RE = /-AppData-Local-Temp(?:-|$)/i;

/** 임시 폴더(보통 claude -p 자식 cwd) 여부 */
export function isTempPath(p, projectId = '') {
  if (p) {
    if (TEMP_RE.test(p)) return true;
    const t = os.tmpdir();
    if (t && String(p).toLowerCase().startsWith(t.toLowerCase())) return true;
    return false;
  }
  return TEMP_ENC_RE.test(projectId || '');
}

/** 역인코딩 추정(손실 있음): `X--a-b` → `X:\a\b`, `-home-u-x` → `/home/u/x` */
export function guessPathFromId(projectId) {
  const id = String(projectId || '');
  const m = /^([A-Za-z])--(.*)$/.exec(id);
  if (m) return `${m[1].toUpperCase()}:\\${m[2].split('-').filter(Boolean).join('\\')}`;
  if (id.startsWith('-')) return '/' + id.slice(1).split('-').filter(Boolean).join('/');
  return id;
}

const isShortOrNumeric = (seg) => seg.length <= 4 || /^[\d._\-]+$/.test(seg);

/** path 의 뒤에서 k 구간(+짧은 구간 보정)으로 이름 */
export function baseName(p, extra = 0) {
  const sep = String(p).includes('\\') ? '\\' : '/';
  const segs = String(p).split(/[\\/]+/).filter(Boolean);
  if (!segs.length) return String(p || '');
  let k = 1;
  if (segs.length > 1 && isShortOrNumeric(segs[segs.length - 1])) k = 2;
  k = Math.min(segs.length, k + extra);
  let name = segs.slice(segs.length - k).join(sep);
  if (name.length > NAME_MAX) name = '…' + name.slice(name.length - (NAME_MAX - 1));
  return name;
}

/**
 * 이름 부여. items: [{projectId, path, temp}] → Map(projectId → name).
 * 겹치면 겹치지 않을 때까지 앞 구간을 더 붙인다. temp 는 앞에 '(임시) '.
 */
export function assignNames(items) {
  const extra = new Map(items.map((it) => [it.projectId, 0]));
  const names = new Map();
  for (let round = 0; round < 12; round++) {
    names.clear();
    const by = new Map();
    for (const it of items) {
      const n = baseName(it.path || it.projectId, extra.get(it.projectId));
      names.set(it.projectId, n);
      const key = n.toLowerCase();
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(it.projectId);
    }
    let changed = false;
    for (const ids of by.values()) {
      if (ids.length < 2) continue;
      for (const id of ids) {
        const it = items.find((x) => x.projectId === id);
        const before = baseName(it.path || id, extra.get(id));
        const after = baseName(it.path || id, extra.get(id) + 1);
        if (after !== before) { extra.set(id, extra.get(id) + 1); changed = true; }
      }
    }
    if (!changed) break;
  }
  const out = new Map();
  for (const it of items) out.set(it.projectId, (it.temp ? '(임시) ' : '') + names.get(it.projectId));
  return out;
}

/** 트리 활동 시각(하위 폴더 stat 포함)을 짧게 기억한다: 허브 tick 과 /projects 집계가 같은 값을 다시 계산하지 않게 */
export async function cachedActivity(index, e, ttlMs = 4000) {
  const c = e._actCache;
  if (c && c.mtimeMs === e.mtimeMs && Date.now() - c.at < ttlMs) return c.v;
  const v = await index.activityMs(e);
  e._actCache = { v, at: Date.now(), mtimeMs: e.mtimeMs };
  return v;
}

const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);

/** 세션 제목(custom > ai > 첫 프롬프트 60자), redact 통과 */
async function titleOf(index, e) {
  const h = await index.ensureHead(e);
  await index.ensureTitle(e).catch(() => {});
  // 마스킹을 먼저 하고 자른다(자른 뒤 마스킹하면 경계에 걸친 비밀의 앞부분이 패턴에 안 걸려 그대로 나감)
  return (e.title ? redact(e.title) : '') || e.sessionId.slice(0, 8); // 첫 프롬프트는 제목으로 쓰지 않음
}

/** 프로젝트 경로 복원: ① 최근 세션 transcript 머리 cwd ② 활성 pid 파일 cwd ③ 역인코딩 추정 */
async function resolvePath(index, entries, procCwd, projectId) {
  for (const e of entries.slice(0, 4)) {
    const h = await index.ensureHead(e);
    if (h.cwd) return { path: h.cwd, guessed: false };
  }
  if (procCwd) return { path: procCwd, guessed: false };
  return { path: guessPathFromId(projectId), guessed: true };
}

/**
 * /projects 집계.
 * @param {import('./discovery.mjs').SessionIndex} index
 * @param {{inactive?:boolean, temp?:boolean, now?:number, maxRoots?:number,
 *          overview?:{roots:Set<string>, rootOf:(sid:string)=>string|null}|null}} opts
 */
export async function buildProjects(index, { inactive = false, temp = false, now = Date.now(), maxRoots = 12, maxWithInactive = 16, overview = null } = {}) {
  if (Date.now() - (index.lastRefresh || 0) > 4000) await index.refresh();
  const procs = index.liveProcs ? index.liveProcs() : [];
  const procBy = new Map(procs.map((p) => [p.sessionId, p]));
  // 프로젝트별 세션 묶음(최근순)
  const groups = new Map();
  for (const e of index.sorted()) {
    if (!groups.has(e.projectDir)) groups.set(e.projectDir, []);
    groups.get(e.projectDir).push(e);
  }
  // 전체 보기 루트 선정 규칙(허브가 잠들어 있어도 같은 결과): live cli 메인 활동 시각 순 상위 maxRoots
  const liveMains = [];
  for (const p of procs) {
    if (index.project && p.entry.projectDir !== index.project) continue;
    if (index.claimedChildren.has(p.sessionId)) continue;
    const h = await index.ensureHead(p.entry);
    const ep = p.entrypoint || h.entrypoint;
    p._ep = ep;
    p._act = await cachedActivity(index, p.entry);
    if (ep !== 'sdk-cli') liveMains.push(p);
  }
  liveMains.sort((a, b) => b._act - a._act);
  const ruleRoots = new Set(liveMains.slice(0, maxRoots).map((p) => p.sessionId));
  // 허브(createRealSource)와 같은 총량 상한: 메인 + 매칭 안 된 sdk-cli 합 maxWithInactive
  for (const p of procs) {
    if (ruleRoots.size >= maxWithInactive) break;
    if (p._ep === 'sdk-cli' && !index.claimedChildren.has(p.sessionId)) ruleRoots.add(p.sessionId);
  }
  const inOverviewSet = overview?.roots || ruleRoots;

  const raw = [];
  for (const [projectId, entries] of groups) {
    const liveHere = procs.filter((p) => p.entry.projectDir === projectId);
    const { path: p, guessed } = await resolvePath(index, entries, liveHere[0]?.cwd, projectId);
    raw.push({ projectId, path: p, guessed, temp: isTempPath(p, projectId), entries, liveHere });
  }
  const names = assignNames(raw.map((r) => ({ projectId: r.projectId, path: r.path, temp: r.temp })));

  const out = [];
  for (const r of raw) {
    if (index.project && r.projectId !== index.project) continue;
    // 무거운 집계 전에 거른다: 30일 넘게 조용한 비활성 프로젝트, live 없는 임시 폴더 프로젝트
    if (!r.liveHere.length && !inactive && now - (r.entries[0]?.mtimeMs || 0) > LIST_DAYS_MS) continue;
    if (!r.liveHere.length && !temp && r.temp) continue;
    const liveList = [];
    let busy = 0, active = 0, lastAct = r.entries[0]?.mtimeMs || 0;
    for (const pr of r.liveHere) {
      const act = pr._act ?? await cachedActivity(index, pr.entry);
      if (act > lastAct) lastAct = act;
      const isBusy = pr.status === 'busy';
      const isActive = isBusy || now - act <= ACTIVE_MS;
      if (isBusy) busy++;
      if (isActive) active++;
      const claimed = index.claimedChildren.has(pr.sessionId);
      const rootSid = claimed ? (overview?.rootOf?.(pr.sessionId) || null) : (inOverviewSet.has(pr.sessionId) ? pr.sessionId : null);
      liveList.push({
        sessionId: pr.sessionId, title: await titleOf(index, pr.entry), liveStatus: pr.status ?? null, tier: 'live',
        activityAt: iso(act), entrypoint: pr._ep || pr.entrypoint || null, active: isActive,
        inOverview: claimed ? !!rootSid : inOverviewSet.has(pr.sessionId),
        ...(claimed ? { isChild: true } : {}), rootSessionId: rootSid,
      });
    }
    liveList.sort((a, b) => (a.activityAt < b.activityAt ? 1 : -1));
    const recentList = [];
    let hasRecent = false;
    for (const e of r.entries) {
      if (procBy.has(e.sessionId) && procBy.get(e.sessionId).alive) continue;
      if (recentList.length >= RECENT_LIST_MAX) break;
      if (!(await index.isCandidate(e))) continue; // sdk-cli·claude -p 자식 제외
      const tier = now - e.mtimeMs <= RECENT_MS ? 'recent' : 'inactive';
      if (tier === 'recent') hasRecent = true;
      recentList.push({ sessionId: e.sessionId, title: await titleOf(index, e), activityAt: iso(e.mtimeMs), tier });
    }
    const live = liveList.length > 0;
    const tier = live ? 'live' : hasRecent ? 'recent' : 'inactive';
    const hostsRoot = liveList.some((x) => x.inOverview && !x.isChild);
    if (!inactive && tier === 'inactive' && now - lastAct > LIST_DAYS_MS) continue;
    if (!temp && r.temp && !hostsRoot) continue;
    out.push({
      projectId: r.projectId, name: redact(names.get(r.projectId)), path: redact(r.path),
      nameGuessed: r.guessed, temp: r.temp,
      live, tier, active: active > 0,
      liveSessions: liveList.length, activeSessions: active, busySessions: busy,
      sessions: r.entries.length, lastActivityAt: iso(lastAct),
      liveList, recentList,
    });
  }
  const rank = { live: 0, recent: 1, inactive: 2 };
  out.sort((a, b) => rank[a.tier] - rank[b.tier] || (a.lastActivityAt < b.lastActivityAt ? 1 : -1));
  return { generatedAt: new Date(now).toISOString(), projects: out };
}
