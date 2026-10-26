// 전체 보기 표시 고르기(순수 — DOM·three 없이 node --test).
// 상단 프로젝트 선택기 목록의 체크박스로 전체 보기(scope=all)에 보일 프로젝트·세션을 고른다.
// 모델은 '숨긴 것'만 기억한다 → 나중에 새로 나타난 프로젝트·세션은 기본으로 보인다.
// 규칙: 보이는 프로젝트가 적어도 하나는 남는다(마지막 하나는 끌 수 없음, '없음' = 첫 프로젝트 하나만 남김).
// 적용은 두 단계: ① 숨길 것을 페이드(ProjFade hide)로 0.5초 지우고 ② 그 뒤 배치(computeOverview·computeCampus)에서 빼
//    빈자리 없이 다시 모은다(roots·projects 에 userHidden 표시 → 배치는 visSig 가 바뀌면 다시 줄 배치).

export const VIS_KEY = 'ccviz.visible';

export const emptyVis = () => ({ hp: new Set(), hs: new Set() });

/** 저장 문자열 → 모델(모르는 값·깨진 값은 빈 모델) */
export function parseVis(s) {
  const v = emptyVis();
  try {
    const o = typeof s === 'string' && s ? JSON.parse(s) : null;
    if (o && Array.isArray(o.hp)) for (const x of o.hp) if (typeof x === 'string' && x) v.hp.add(x);
    if (o && Array.isArray(o.hs)) for (const x of o.hs) if (typeof x === 'string' && x) v.hs.add(x);
  } catch { /* 빈 모델 */ }
  return v;
}
export const serializeVis = (v) => JSON.stringify({ hp: [...v.hp].sort(), hs: [...v.hs].sort() });

export const projVisible = (v, pid) => !v || !v.hp.has(pid);
export const sessVisible = (v, sid) => !v || !v.hs.has(String(sid || '').replace(/^s:/, ''));
export const isFiltered = (v) => !!v && (v.hp.size > 0 || v.hs.size > 0);

/**
 * 프로젝트 체크 토글. pids = 지금 목록의 프로젝트들. 마지막 보이는 프로젝트를 끄려 하면 그대로(같은 객체) 돌려준다.
 */
export function toggleProject(v, pid, pids = []) {
  const n = { hp: new Set(v.hp), hs: new Set(v.hs) };
  if (n.hp.has(pid)) { n.hp.delete(pid); return n; }
  const left = pids.filter((p) => p !== pid && !n.hp.has(p));
  if (!left.length) return v;
  n.hp.add(pid);
  return n;
}
/** 세션 체크 토글(세션을 숨기면 그 세션 트리 전체가 숨는다) */
export function toggleSession(v, sid) {
  const s = String(sid || '').replace(/^s:/, '');
  const n = { hp: new Set(v.hp), hs: new Set(v.hs) };
  if (n.hs.has(s)) n.hs.delete(s); else n.hs.add(s);
  return n;
}
/** 모두 보이기 */
export const showAll = () => emptyVis();
/** '없음': keep(없으면 pids[0]) 하나만 남기고 나머지 프로젝트 숨김(세션 고르기는 그대로) */
export function showOnly(v, pids = [], keep = null) {
  const k = keep && pids.includes(keep) ? keep : pids[0];
  const n = { hp: new Set(), hs: new Set(v ? v.hs : []) };
  for (const p of pids) if (p !== k) n.hp.add(p);
  return n;
}

/** 숨길 페이드 키: 프로젝트 id + 숨긴 세션의 루트 노드 id('s:<sid>') */
export function fadeKeys(v) {
  const out = new Set();
  if (!v) return out;
  for (const p of v.hp) out.add(p);
  for (const s of v.hs) out.add('s:' + s);
  return out;
}

/**
 * 배치에 넘길 roots·projects 에 userHidden 표시(원본은 건드리지 않음). v 가 비었으면 원본 그대로.
 * 루트는 그 프로젝트가 숨었거나 그 세션(루트 노드 id 's:<sid>' 또는 sessionId)이 숨었으면 숨김.
 */
export function markVisibility(roots, projects, v) {
  if (!isFiltered(v)) return { roots: roots || [], projects: projects || [] };
  const rootHidden = (r) => {
    if (!r) return false;
    if (r.projectId && v.hp.has(r.projectId)) return true;
    const sid = r.sessionId || (r.nodeId ? String(r.nodeId).replace(/^s:/, '') : '');
    return !!sid && v.hs.has(sid);
  };
  return {
    roots: (roots || []).map((r) => (rootHidden(r) ? { ...r, userHidden: true } : r)),
    projects: (projects || []).map((p) => (p && v.hp.has(p.projectId) ? { ...p, userHidden: true } : p)),
  };
}

/** 배치 쪽: 사용자가 숨긴 프로젝트 id 집합 */
export function userHiddenProjects(projects) {
  const s = new Set();
  for (const p of projects || []) if (p && p.userHidden && p.projectId) s.add(p.projectId);
  return s;
}
/** 배치 쪽: 사용자가 숨긴 루트 노드 id 집합 */
export function userHiddenRoots(roots) {
  const s = new Set();
  for (const r of roots || []) {
    if (!r || !r.userHidden) continue;
    const id = r.nodeId || (r.sessionId ? 's:' + r.sessionId : null);
    if (id) s.add(id);
  }
  return s;
}
/** 배치 쪽: 표시 고르기 서명 — 바뀌면 빈자리 없이 다시 줄 배치 */
export function visSig(hp, hr) {
  if (!hp.size && !hr.size) return '';
  return [...hp].sort().join(',') + '|' + [...hr].sort().join(',');
}
