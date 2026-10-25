// 전체 보기 배치 — 순수 함수, three 를 import 하지 않는다(node 시험 대상).
//
// 프로젝트마다 클러스터(섬) 하나. 섬 안 배치: live 메인(없으면 현재 메인 하나)마다 '무리'(그 메인 + 붙은 지난 메인·
// 독립 기동기·외부 작업)를 만들고, live 메인이 하나면 그 메인이 섬 중심·나머지는 둘레에 고르게, 여럿이면 Flow(facing)는
// 마주 보기(2～3)·파이 구역(4+), Planet 은 나란히. 각 루트 서브트리는 1·2차 computeLayout(부채꼴 옵션)으로 지역 좌표를 얻는다.
// 섬 크기는 대칭 경계 상자(box), 섬끼리는 상자로 줄 배치하고 이전 자리를 되도록 유지한다.
import { computeLayout, RADIUS, isDetachedRoot, nodeExtent } from '../layout.js';
import { orphanPlan, isOrphanRoot } from '../batch-core.mjs';
import { liveMainSids, assignToAnchors, podAngles } from '../multi-core.mjs';
import { chooseArrangement, needRepack, scaleOf, KEEP_GAIN } from './fill-pack.mjs';

export const MAIN_GAP = 6;        // 같은 섬 안 메인 경계 사이
export const CLUSTER_GAP = 3;     // 섬끼리(8 → 3, 촘촘히)
export const CLUSTER_TAG = 3;     // 줄 사이 섬 이름표 자리
export const CLUSTER_PAD = 4;     // 메인 경계 → 섬 가장자리
export const CLUSTER_MIN_R = 6;
export const RECENT_MS = 2 * 3600 * 1000;
// 섬 최소 크기: 보이는 가장 큰 섬 반지름 × ISLAND_MIN_K 보다 작은 섬은 섬 안 배치를 그만큼 넓힌다(최대 ISLAND_MAX_BOOST 배)
//  — 큰 섬에 맞춘 전체 보기 카메라에서 작은 섬의 노드·라벨이 한데 뭉쳐 읽히지 않던 것
export const ISLAND_MIN_K = 0.5;
export const ISLAND_MAX_BOOST = 2.2;
// 원형 섬(정사각 상자)은 줄 배치가 가용 비율에 더 민감해(라벨 자리 → 비율 → 배치 되먹임) 다시 배치 문턱을 넓힘(의 25% → 40%)
export const ROUND_REPACK_TOL = 0.4;
// 원형 섬 반지름 데드밴드(2026-10-25): 보이는 노드 기준 반지름이 이전(키우기 전 값)과 이 비율·ROUND_DEAD_MIN 안이면 이전 값 —
// 서브에이전트가 생기고 끝날 때마다 원판·고리·바닥 글씨가 조금씩 흔들리지 않게(여유 CLUSTER_PAD 가 그 안의 차이를 덮는다)
export const ROUND_DEADBAND = 0.08;
export const ROUND_DEAD_MIN = 2;

const num = (v) => (Number.isFinite(v) ? v : 0);
const tsOf = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };

/** 루트 노드가 "희미한(recent) 루트" 인지 — 서버 meta.tier / meta.live */
export function isRecentRoot(n) {
  const m = (n && n.meta) || {};
  return m.tier === 'recent' || m.live === false;
}

/** 독립 기동기를 띄운 메인 노드: 같은 rootSessionId 의 s:<id>, 없으면 spawnedBy 가 속한 루트 */
export function spawnerMain(n, byId, rootOf) {
  if (!n) return null;
  const m = n.rootSessionId && byId.get('s:' + n.rootSessionId);
  if (m && m !== n) return m;
  const sp = n.meta && n.meta.spawnedBy;
  if (!sp) return null;
  const r = rootOf && rootOf.get(sp);
  return byId.get(r || sp) || null;
}

/**
 * 노드 → 루트 배정. roots 가 비었거나 빠진 루트는 "부모 없는 노드" 로 보충한다.
 * @returns {{ roots:[{nodeId, projectId}], rootOf: Map<id, rootNodeId>, subtrees: Map<rootNodeId, Map<id,node>> }}
 */
export function assignRoots(nodes, rootsIn) {
  const byId = nodes instanceof Map ? nodes : new Map((nodes || []).map((n) => [n.id, n]));
  const roots = [];
  const seen = new Set();
  for (const r of rootsIn || []) {
    const id = r && (r.nodeId || (r.sessionId ? 's:' + r.sessionId : null));
    if (!id || seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    roots.push({ nodeId: id, projectId: r.projectId || n.projectId || 'unknown' });
  }
  // 목록에 없는 루트(부모가 없거나 모르는 부모) 보충 — 결정적 순서(_order → id).
  // 단 부모만 빠졌고(퇴장해 자리를 내준 서브에이전트 등) rootSessionId 가 목록의 루트를 가리키면 그 루트 소속으로 둔다 —
  // 예전엔 이런 노드가 새 루트가 되어 메인 없는 빈 사무실·섬이 생겼다
  const listedSid = new Set();
  for (const r of roots) { const n = byId.get(r.nodeId); if (n && n.sessionId) listedSid.add(n.sessionId); listedSid.add(r.nodeId.replace(/^s:/, '')); }
  const orphans = [];
  for (const n of byId.values()) {
    if (seen.has(n.id)) continue;
    if (n.parentId && n.parentId !== n.id && !byId.has(n.parentId) && n.rootSessionId && listedSid.has(n.rootSessionId)) continue;
    if (!n.parentId || !byId.has(n.parentId) || n.parentId === n.id) orphans.push(n);
  }
  orphans.sort((a, b) => (num(a._order) - num(b._order)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const n of orphans) { seen.add(n.id); roots.push({ nodeId: n.id, projectId: n.projectId || 'unknown' }); }

  const rootSet = new Set(roots.map((r) => r.nodeId));
  const sid2root = new Map();
  for (const r of roots) { const n = byId.get(r.nodeId); if (n && n.sessionId) sid2root.set(n.sessionId, r.nodeId); sid2root.set(r.nodeId.replace(/^s:/, ''), r.nodeId); }
  const rootOf = new Map();
  const walk = (n) => {
    if (rootOf.has(n.id)) return rootOf.get(n.id);
    const chain = [];
    let cur = n, res = null, guard = 0;
    while (cur && guard++ < 256) {
      if (rootSet.has(cur.id)) { res = cur.id; break; }
      if (rootOf.has(cur.id)) { res = rootOf.get(cur.id); break; }
      chain.push(cur.id);
      cur = cur.parentId && cur.parentId !== cur.id ? byId.get(cur.parentId) : null;
    }
    if (!res && n.rootSessionId && sid2root.has(n.rootSessionId)) res = sid2root.get(n.rootSessionId);
    if (!res) {
      // 같은 프로젝트의 첫 루트, 그것도 없으면 첫 루트
      const r = roots.find((x) => x.projectId === n.projectId) || roots[0];
      res = r ? r.nodeId : null;
    }
    for (const id of chain) rootOf.set(id, res);
    if (rootSet.has(n.id)) rootOf.set(n.id, n.id);
    return res;
  };
  for (const n of byId.values()) walk(n);
  const subtrees = new Map(roots.map((r) => [r.nodeId, new Map()]));
  for (const n of byId.values()) {
    const r = rootOf.get(n.id);
    if (r && subtrees.has(r)) subtrees.get(r).set(n.id, n);
  }
  return { roots, rootOf, subtrees, byId };
}

/** projects 항목 정규화: 모양({projectId,name,live,active,temp}) 과 모양을 둘 다 받는다 */
export function normProject(p, nowMs = Date.now()) {
  if (!p || !p.projectId) return null;
  const recentAct = Math.max(tsOf(p.lastActivityAt), ...((p.recentList || []).map((s) => tsOf(s.activityAt))));
  return {
    projectId: p.projectId,
    name: p.name || p.projectId,
    live: !!(p.live || p.liveSessions > 0),
    active: !!(p.active || p.activeSessions > 0 || p.busySessions > 0),
    busy: !!(p.busy || p.busySessions > 0),
    temp: !!p.temp,
    recent: !!(p.recent || (!p.live && recentAct && nowMs - recentAct < RECENT_MS)),
    sessions: num(p.sessions),
    liveSessions: num(p.liveSessions),
    lastActivityAt: p.lastActivityAt || null,
  };
}

/**
 * 섬의 현재 메인: 그 프로젝트의 live CLI 세션(projects[].liveList — /clear 하면 같은 pid 의 sessionId 가 새 세션으로 바뀜)이
 * 가리키는 루트 메인. 여럿이면 busy 먼저 → 최근 활동. live 가 없으면(재생·지난 기록) 가장 최근 활동 메인.
 * claude -p(sdk-cli)·독립 기동기·외부 작업(독립 claude -p 루트)은 후보 아님. mains = 지역 배치 항목({nodeId, act, detached, external})
 */
export function currentMain(mains, rawProject, byId = null) {
  const cand = mains.filter((m) => !m.detached && !m.external && !(byId && byId.get(m.nodeId) && byId.get(m.nodeId).kind !== 'main'));
  if (!cand.length) return null;
  const live = ((rawProject && rawProject.liveList) || []).filter((s) => s && s.sessionId && s.entrypoint !== 'sdk-cli');
  const ts = (s) => { const t = Date.parse(s.activityAt || ''); return Number.isFinite(t) ? t : 0; };
  live.sort((a, b) => ((b.liveStatus === 'busy') - (a.liveStatus === 'busy')) || (ts(b) - ts(a)));
  for (const s of live) { const m = cand.find((x) => x.nodeId === 's:' + s.sessionId); if (m) return m; }
  return cand.slice().sort((a, b) => (b.act - a.act) || (a.nodeId < b.nodeId ? -1 : 1))[0];
}

/**
 * 섬들을 줄로 나눈다(순서 유지): 줄 수 k 마다 폭을 고르게 나눠 보고, 화면 비율 aspect 에 맞춘 크기 max(W/aspect, H) 가 가장 작은 k.
 * 섬 크기는 경계 상자(c.box = {hw, hd}) — 없으면 원(r)으로 본다.
 * @returns [[cluster…]…]
 */
export function packRows(list, aspect = 1.6) {
  const n = list.length;
  if (!n) return [];
  const hwOf = (c) => (c.box ? c.box.hw : c.r), hdOf = (c) => (c.box ? c.box.hd : c.r);
  const width = (row) => row.reduce((s, c, i) => s + 2 * hwOf(c) + (i ? CLUSTER_GAP : 0), 0);
  let best = null;
  for (let k = 1; k <= n; k++) {
    const total = width(list), target = total / k;
    const rows = [];
    let cur = [];
    for (let i = 0; i < n; i++) {
      const c = list[i], left = n - i, rowsLeft = k - rows.length;
      if (cur.length && (width([...cur, c]) > target * 1.08 || left < rowsLeft) && rows.length < k - 1) { rows.push(cur); cur = []; }
      cur.push(c);
    }
    if (cur.length) rows.push(cur);
    const W = Math.max(...rows.map(width));
    const H = rows.reduce((s, row, i) => s + 2 * Math.max(...row.map(hdOf)) + (i ? CLUSTER_GAP + CLUSTER_TAG : 0), 0);
    const score = Math.max(W / aspect, H);
    if (!best || score < best.score - 1e-9) best = { score, rows };
  }
  return best.rows;
}

// ───────────── 섬 안 배치 ─────────────

export const POD_GAP = 3;          // 같은 무리 안 루트 경계 사이
export const PODS_GAP = 2.5;       // 서로 다른 live 메인 무리의 노드 경계 사이(마주 보기·파이)
const DIRS16 = Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8);

function rotLocal(local, a) {
  if (!a) return local;
  const c = Math.cos(a), s = Math.sin(a);
  const out = new Map();
  for (const [id, p] of local) out.set(id, { x: p.x * c - p.z * s, y: p.y, z: p.x * s + p.z * c });
  return out;
}

/** 지역 배치의 경계 원(원점 중심)·무게 중심 원 */
function circleOf(local, sub) {
  let r = 0, cx = 0, cz = 0, n = 0;
  for (const [id, p] of local) { r = Math.max(r, Math.hypot(p.x, p.z) + nodeExtent(sub.get(id))); cx += p.x; cz += p.z; n++; }
  cx = n ? cx / n : 0; cz = n ? cz / n : 0;
  let rb = 0;
  for (const [id, p] of local) rb = Math.max(rb, Math.hypot(p.x - cx, p.z - cz) + nodeExtent(sub.get(id)));
  return { r: Math.max(r + 1, RADIUS.main + 1), body: { x: cx, z: cz, r: rb + 1 } };
}

/** 방향 u 로 원점에서 d 만큼 간 점의 원(반지름 rr)이 circles 와 겹치지 않는 가장 작은 d(≥ d0) */
function freeDist(ux, uz, rr, circles, d0, gap) {
  const bad = [];
  for (const c of circles) {
    const R = rr + c.r + gap, b = ux * c.x + uz * c.z, disc = b * b - (c.x * c.x + c.z * c.z) + R * R;
    if (disc > 0) { const s = Math.sqrt(disc); bad.push([b - s, b + s]); }
  }
  bad.sort((p, q) => p[0] - q[0]);
  let d = d0;
  for (let guard = 0; guard < 4; guard++) {
    let moved = false;
    for (const [lo, hi] of bad) if (d > lo - 1e-9 && d < hi) { d = hi; moved = true; }
    if (!moved) break;
  }
  return d;
}

/**
 * 무리 하나: 기준 메인(원점) + 붙은 루트들. dirs = 놓아 볼 방향들, prefer = 선호 방향(부채꼴이면 그쪽 가까이).
 * 붙은 루트는 크기 큰 것부터, 무리 경계 상자(화면 비율 aspect 기준)가 가장 덜 커지는 방향 — 한쪽에 몰리지 않고 둘레에 고르게.
 * @returns [{m, x, z, rot}]
 */
function buildPod(anchor, members, { dirs, prefer = null, aspect = 1.4 }) {
  const out = [{ m: anchor, x: 0, z: 0, rot: 0 }];
  const circles = [{ x: anchor.body ? anchor.body.x : 0, z: anchor.body ? anchor.body.z : 0, r: anchor.body ? anchor.body.r : anchor.r }];
  if (!anchor.body || prefer == null) circles[0] = { x: 0, z: 0, r: anchor.r };
  const bb = { x0: circles[0].x - circles[0].r, x1: circles[0].x + circles[0].r, z0: circles[0].z - circles[0].r, z1: circles[0].z + circles[0].r };
  const list = members.slice().sort((a, b) => (b.r - a.r) || (a.order - b.order));
  for (const m of list) {
    // 붙는 루트는 무게 중심 원(body)으로 본다 — 기동기 무리(회차 사슬이 한쪽 +x 로 뻗음)를 원점 원으로 보면 메인 쪽 절반이 비어 멀리 떨어졌다
    const mb = m.body && !m.guests ? m.body : { x: 0, z: 0, r: m.r };
    const turn = !!(m.detached || m.external); // 기동기 회차 부채꼴(+x)이 바깥을 보게 돌림
    let best = null;
    for (const a of dirs) {
      const ux = Math.cos(a), uz = Math.sin(a);
      const d = freeDist(ux, uz, mb.r, circles, circles[0].r * 0.5 + mb.r, POD_GAP);
      const x = ux * d, z = uz * d; // 무게 중심 자리
      const W = Math.max(bb.x1, x + mb.r) - Math.min(bb.x0, x - mb.r), H = Math.max(bb.z1, z + mb.r) - Math.min(bb.z0, z - mb.r);
      let score = Math.max(W / aspect, H) + d * 0.01;
      if (prefer != null) { const da = Math.abs(Math.atan2(Math.sin(a - prefer), Math.cos(a - prefer))); score = d + da * 6; }
      if (!best || score < best.score - 1e-9) best = { score, x, z, a };
    }
    const rot = turn ? best.a : 0;
    const c = Math.cos(rot), sn = Math.sin(rot);
    const bx = mb.x * c - mb.z * sn, bz = mb.x * sn + mb.z * c; // 돌린 뒤 원점 → 무게 중심
    out.push({ m, x: best.x - bx, z: best.z - bz, rot });
    circles.push({ x: best.x, z: best.z, r: mb.r });
    bb.x0 = Math.min(bb.x0, best.x - mb.r); bb.x1 = Math.max(bb.x1, best.x + mb.r); bb.z0 = Math.min(bb.z0, best.z - mb.r); bb.z1 = Math.max(bb.z1, best.z + mb.r);
  }
  return out;
}

/** 무리 노드 목록(무리 지역 좌표): [{x, z, e}] */
function podPoints(pod) {
  const pts = [];
  for (const it of pod) {
    const loc = rotLocal(it.m.local, it.rot);
    for (const [id, p] of loc) pts.push({ x: it.x + p.x, z: it.z + p.z, e: nodeExtent(it.m.sub.get(id)) });
    for (const g of it.m.guests || []) for (const [id, p] of g.local) pts.push({ x: it.x + g.offset.x + p.x, z: it.z + g.offset.z + p.z, e: nodeExtent(g.sub.get(id)) });
  }
  return pts;
}

/** 서로 다른 무리 노드끼리 겹치는가(격자 해시) */
function podsOverlap(placed, gap) {
  const cell = 8, grid = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  for (let pi = 0; pi < placed.length; pi++) {
    for (const p of placed[pi]) {
      const i = Math.floor(p.x / cell), j = Math.floor(p.z / cell);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const arr = grid.get(key(i + di, j + dj));
        if (!arr) continue;
        for (const q of arr) if (q.pi !== pi && Math.hypot(p.x - q.x, p.z - q.z) < p.e + q.e + gap) return true;
      }
    }
    for (const p of placed[pi]) {
      const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push({ ...p, pi });
    }
  }
  return false;
}

/**
 * @param nodes    Map<id, node> (node.parentId, kind, _order, projectId?, rootSessionId?, meta?, status, lastActivityAt)
 * @param roots    [{nodeId, projectId}] (서버 roots, sessionId 만 있어도 됨)
 * @param projects [{projectId, name, live, active, temp, liveList?, …}]
 * @param prev     이전 결과(섬 자리 안정화)
 * @param opts     { showInactive=false, nowMs=Date.now, spread=1(메인별 지역 배치 간격 배율),
 *                   islandMin=ISLAND_MIN_K(가장 큰 섬 대비 최소 크기 비율, 0 이면 끔), aspect=1.6(화면 가로/세로 — 섬 줄 배치),
 *                   facing=false(Flow: 같은 섬 live 메인 2～3개는 마주 보기, 4개 이상은 파이 구역),
 *                   view=null(가용 영역 {aspect, elevMin, elevMax, elevDef, yaw0?, hy?} — 주면 섬 배치를 줄·열·크기 순 후보 중
 *                   맞춤 배율 최대로 고르고, 가용 비율이 REPACK_TOL 넘게 바뀔 때만 다시 배치. aspect 는 이때 섬 안 배치에만) }
 * @returns {{ clusters, pos:Map, parentOf:Map, rootOf:Map, hidden:Set, projectOf:Map, mainOrder:Map }}
 */
export function computeOverview(nodes, roots, projects, prev, opts = {}) {
  const showInactive = !!opts.showInactive;
  const spread = Number.isFinite(opts.spread) && opts.spread > 0 ? opts.spread : 1;
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const roundOpt = !!opts.round; // Planet: 섬 = 원형 궤도계(여러 live 메인은 마주 보기·파이 = 쌍성·다중성)
  const facing = !!opts.facing || roundOpt;
  const view = opts.view && opts.view.aspect > 0 ? opts.view : null;
  const aspect = Number.isFinite(opts.aspect) && opts.aspect > 0 ? opts.aspect
    : view ? view.aspect / Math.max(0.3, Math.sin(((view.elevDef ?? view.elevMin ?? 90) * Math.PI) / 180)) : 1.6;
  const { roots: R, rootOf, subtrees, byId } = assignRoots(nodes, roots);
  const rawById = new Map((projects || []).filter((p) => p && p.projectId).map((p) => [p.projectId, p]));
  const projById = new Map();
  for (const p of projects || []) { const q = normProject(p, nowMs); if (q) projById.set(q.projectId, q); }

  const pos = new Map();
  const parentOf = new Map();
  const hidden = new Set();
  const projectOf = new Map();

  // 1. 루트(멤버) 목록 — 지역 배치는 섬 안 모양을 정한 뒤(부채꼴이 필요하면 그걸로)
  const mains = new Map(); // projectId → [member]
  R.forEach((r, order) => {
    const rootNode = byId.get(r.nodeId);
    const sub = subtrees.get(r.nodeId);
    // 독립 기동기 루트는 띄운 세션(메인)의 희미함을 따른다(끝난 세션의 기동기만 홀로 남지 않게)
    const recent = isRecentRoot(rootNode) || (isDetachedRoot(rootNode) && isRecentRoot(spawnerMain(rootNode, byId, rootOf)));
    const pid = r.projectId;
    for (const id of sub.keys()) projectOf.set(id, pid);
    if (recent && !showInactive) { for (const id of sub.keys()) hidden.add(id); }
    let act = 0;
    for (const n of sub.values()) act = Math.max(act, tsOf(n.lastActivityAt));
    const start = tsOf(rootNode && rootNode.startedAt) || act;
    const m = { nodeId: r.nodeId, sub, order, act, start, recent, hidden: recent && !showInactive,
      external: isOrphanRoot(rootNode), detached: isDetachedRoot(rootNode), local: null, parentOf: null, r: 0 };
    if (!mains.has(pid)) mains.set(pid, []);
    mains.get(pid).push(m);
  });
  const layOf = (m, sector = null) => {
    const lay = computeLayout(m.sub, m.nodeId, sector ? { sector } : {});
    if (spread !== 1) for (const p of lay.pos.values()) { p.x *= spread; p.z *= spread; } // 섬 안 간격(흐름 표현 1.3)
    m.local = lay.pos; m.parentOf = lay.parentOf;
    const c = circleOf(m.local, m.sub);
    m.r = c.r; m.body = c.body;
  };

  // 1-1. 독립 기동기 루트는 배치상 띄운 노드의 자식처럼: 띄운 노드(meta.spawnedBy)가 든 멤버의 서브트리에 합쳐
  //      computeLayout 이 그 노드 첫 고리(바깥 자식)에 두고 회차 사슬은 바깥으로 뻗게. 관계(parentOf null·띄움 점선)는 그대로
  const mergedInto = new Map(); // 기동기 루트 → 합친 멤버
  for (const [pid, arr] of mains) {
    for (const d of arr.slice()) {
      if (!d.detached) continue;
      const n = byId.get(d.nodeId), sp = n && n.meta && n.meta.spawnedBy;
      const sm = spawnerMain(n, byId, rootOf);
      const host = arr.find((m) => m !== d && !m.detached && ((sp && m.sub.has(sp)) || (sm && m.nodeId === sm.id)));
      if (!host || host.hidden !== d.hidden) continue;
      host.sub = new Map([...host.sub, ...d.sub]);
      host.act = Math.max(host.act, d.act);
      arr.splice(arr.indexOf(d), 1);
      mergedInto.set(d.nodeId, host.nodeId);
    }
  }

  // 1-2. 독립 claude -p 루트: 추정 소속(likelyMain) 메인이 보이면 그 메인 가장자리 대기석(점선 연결)
  const plan = orphanPlan(R, byId);
  const allMembers = () => [...mains.values()].flat();
  const guestOf = new Map();
  const guestPlans = [];
  for (const [oid, pl] of plan) {
    if (pl.mode !== 'guest') continue;
    const host = allMembers().find((m) => m.nodeId === pl.host);
    const g = allMembers().find((m) => m.nodeId === oid);
    if (!host || !g || host.hidden || g.hidden) continue;
    for (const [pid, arr] of mains) { const i = arr.indexOf(g); if (i >= 0) arr.splice(i, 1); if (!arr.length) mains.delete(pid); }
    guestPlans.push([host, g]);
    guestOf.set(oid, pl.host);
  }

  // 2. 섬 목록: 루트가 있는 프로젝트 + live/recent 프로젝트(temp 는 루트가 있을 때만)
  const prevOrder = (prev && prev.mainOrder) || new Map();
  const clusters = [];
  const prevRound0 = new Map(((prev && prev.clusters) || []).filter((c) => c && c.round0 > 0).map((c) => [c.projectId, c.round0])); // 원형 섬 데드밴드
  const pids = new Set(mains.keys());
  for (const q of projById.values()) if (!q.temp && (q.live || q.recent)) pids.add(q.projectId);
  for (const pid of pids) {
    const q = projById.get(pid) || { projectId: pid, name: pid, live: false, active: false, busy: false, temp: false, recent: false, sessions: 0 };
    const list = (mains.get(pid) || []).slice();
    // 메인 순서(목록·mainOrder 용): 이전 순서 유지, 새 메인은 활동 시각 내림차순
    list.sort((a, b) => {
      if (a.external !== b.external) return a.external ? 1 : -1;
      if (!!a.detached !== !!b.detached) return a.detached ? 1 : -1;
      const pa = prevOrder.has(a.nodeId) ? prevOrder.get(a.nodeId) : Infinity;
      const pb = prevOrder.has(b.nodeId) ? prevOrder.get(b.nodeId) : Infinity;
      if (pa !== pb) return pa < pb ? -1 : 1;
      return (b.act - a.act) || (a.nodeId < b.nodeId ? -1 : 1);
    });
    const shown = list.filter((m) => !m.hidden);
    const isMainM = (m) => !m.detached && !m.external && !(byId.get(m.nodeId) && byId.get(m.nodeId).kind !== 'main');
    // live 메인: 프로젝트 liveList 의 CLI 세션 중 이 섬에 보이는 메인, busy → 최근 활동 순. 없으면 현재 메인 하나
    const liveIds = liveMainSids(rawById.get(pid)).map((s) => 's:' + s);
    let anchors = liveIds.map((id) => shown.find((m) => m.nodeId === id && isMainM(m))).filter(Boolean);
    const cur0 = currentMain(shown, rawById.get(pid), byId);
    if (!anchors.length && cur0) anchors = [cur0];
    if (!anchors.length && shown.length) anchors = [shown[0]]; // 메인 없는 섬(기동기·외부 작업만): 첫 루트 기준
    const others = shown.filter((m) => !anchors.includes(m));
    // 붙일 곳: 독립 기동기 → 띄운 메인, 외부 작업 → 추정 소속, 지난 메인 → /clear 앞 세션 추정
    const spawnerOf = (m) => { const n = byId.get(m.nodeId); const s = m.detached ? spawnerMain(n, byId, rootOf) : null; return s ? s.id : null; };
    const likelyOf = (m) => { const n = byId.get(m.nodeId); const lm = n && n.meta && n.meta.likelyMain; return lm ? 's:' + String(lm).replace(/^s:/, '') : null; };
    const assign = assignToAnchors(others.map((m) => ({ nodeId: m.nodeId, endMs: m.act, spawner: spawnerOf(m), likely: likelyOf(m) })),
      anchors.map((a) => ({ nodeId: a.nodeId, startMs: a.start })));
    const shape = facing && anchors.length >= 2 ? podAngles(anchors.length) : { mode: anchors.length >= 2 ? 'row' : 'center', dirs: [0], span: 2 * Math.PI };
    // 지역 배치(부채꼴은 마주 보기·파이의 live 메인만)
    anchors.forEach((a, i) => layOf(a, shape.mode === 'facing' || shape.mode === 'pie' ? { dir: shape.dirs[i], span: shape.span } : null));
    for (const m of others) layOf(m);
    for (const m of list) if (!m.local) layOf(m);
    for (const [host, g] of guestPlans) {
      if (!list.includes(host)) continue;
      if (!g.local) layOf(g);
      const k = (host.guests || (host.guests = [])).length;
      const a = Math.PI / 2 + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.55;
      const d = host.r + g.r * 0.4;
      g.offset = { x: Math.cos(a) * d, z: Math.sin(a) * d };
      host.guests.push(g);
    }
    for (const m of list) if (m.guests) for (const g of m.guests) { m.r = Math.max(m.r, Math.hypot(g.offset.x, g.offset.z) + g.r); m.body = null; }

    // 무리 만들기
    const pods = anchors.map((a, i) => {
      const mem = others.filter((m) => assign.get(m.nodeId) === a.nodeId);
      if (shape.mode === 'facing' || shape.mode === 'pie') {
        const dirs = [-3, -2, -1, 0, 1, 2, 3].map((j) => shape.dirs[i] + (j * shape.span) / 7);
        return buildPod(a, mem, { dirs, prefer: shape.dirs[i], aspect });
      }
      return buildPod(a, mem, { dirs: DIRS16, aspect: anchors.length >= 2 ? aspect * 0.6 : aspect });
    });
    // 무리 자리: 가운데(하나) / 줄(Planet 여럿, 첫 메인 가운데 → 오른쪽·왼쪽 번갈아) / 마주 보기·파이(중심에서 d, 겹치지 않을 때까지 넓힘)
    const podAt = [];
    let orbit = null, zones = null;
    if (shape.mode === 'facing' || shape.mode === 'pie') {
      const pts = pods.map(podPoints);
      const n = anchors.length;
      // 시작 거리: 메인끼리 라벨·충돌 칩이 들어갈 만큼(2 = 메인 사이 약 20, 3 = 삼각 한 변 약 22, 파이 = 이웃 메인 사이 약 16)
      let d = shape.mode === 'pie' ? 16 / (2 * Math.sin(Math.PI / n)) : n === 2 ? 10 * spread : 9.5 * spread;
      for (let guard = 0; guard < 160; guard++) {
        const placed = pts.map((arr, i) => { const ox = Math.cos(shape.dirs[i]) * d, oz = Math.sin(shape.dirs[i]) * d; return arr.map((p) => ({ x: p.x + ox, z: p.z + oz, e: p.e })); });
        if (!podsOverlap(placed, PODS_GAP)) break;
        d += 1.5;
      }
      anchors.forEach((a, i) => podAt.push({ x: Math.cos(shape.dirs[i]) * d, z: Math.sin(shape.dirs[i]) * d }));
      if (shape.mode === 'facing') orbit = { r: d };
      else zones = { n, dirs: shape.dirs.map((t) => t + Math.PI / n), r0: d * 0.35 };
    } else if (shape.mode === 'row') {
      const ext = pods.map((pod) => { let x0 = 0, x1 = 0; for (const p of podPoints(pod)) { x0 = Math.min(x0, p.x - p.e); x1 = Math.max(x1, p.x + p.e); } return { x0, x1 }; });
      const seq = [0]; for (let k = 1; k < pods.length; k++) seq.push(k);
      const xs = new Array(pods.length).fill(0);
      let right = ext[0].x1, left = ext[0].x0;
      for (let k = 1; k < pods.length; k++) {
        if (k % 2) { xs[k] = right + MAIN_GAP - ext[k].x0; right = xs[k] + ext[k].x1; }
        else { xs[k] = left - MAIN_GAP - ext[k].x1; left = xs[k] + ext[k].x0; }
      }
      xs.forEach((x) => podAt.push({ x, z: 0 }));
    } else if (pods.length) podAt.push({ x: 0, z: 0 });

    // 섬 지역 좌표: 실제 경계 상자의 가운데가 섬 중심(원점). 가운데 메인은 무리가 둘레에 고르게 놓여 거의 중심에 온다
    const place = new Map(); // nodeId(멤버) → {x, z, rot}
    pods.forEach((pod, i) => { for (const it of pod) place.set(it.m.nodeId, { x: podAt[i].x + it.x, z: podAt[i].z + it.z, rot: it.rot }); });
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const grow = (x, z, e) => { x0 = Math.min(x0, x - e); x1 = Math.max(x1, x + e); z0 = Math.min(z0, z - e); z1 = Math.max(z1, z + e); };
    for (const m of shown) {
      const pl = place.get(m.nodeId);
      if (!pl) continue;
      const loc = rotLocal(m.local, pl.rot);
      for (const [id, p] of loc) grow(pl.x + p.x, pl.z + p.z, nodeExtent(m.sub.get(id)));
      for (const g of m.guests || []) for (const [id, p] of g.local) grow(pl.x + g.offset.x + p.x, pl.z + g.offset.z + p.z, nodeExtent(g.sub.get(id)));
    }
    let hw = 0, hd = 0;
    if (Number.isFinite(x0)) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      hw = (x1 - x0) / 2; hd = (z1 - z0) / 2;
      for (const pl of place.values()) { pl.x -= cx; pl.z -= cz; }
      if (orbit) { orbit.cx = -cx; orbit.cz = -cz; }
      if (zones) { zones.cx = -cx; zones.cz = -cz; }
    }
    const inactive = !shown.length;
    let box = inactive ? { hw: CLUSTER_MIN_R, hd: CLUSTER_MIN_R } : { hw: Math.max(CLUSTER_MIN_R, hw + CLUSTER_PAD), hd: Math.max(CLUSTER_MIN_R, hd + CLUSTER_PAD) };
    // Planet 원형 궤도계: 항성(live 메인 하나면 그 메인, 여럿이면 공전 중심) 을 섬 중심으로 옮기고
    // 섬 = 그 점 중심 원(반지름 = 가장 먼 노드 경계 + 여유), 상자는 그 원의 외접 정사각형(배치·카메라 맞춤은 상자 그대로)
    let round = 0, round0 = 0, stars = null;
    if (roundOpt && !inactive && place.size) {
      let sx = 0, sz = 0;
      if (pods.length === 1) { const pl = place.get(anchors[0].nodeId); if (pl) { sx = pl.x; sz = pl.z; } }
      else if (orbit || zones) { sx = (orbit || zones).cx || 0; sz = (orbit || zones).cz || 0; }
      for (const pl of place.values()) { pl.x -= sx; pl.z -= sz; }
      if (orbit) { orbit.cx = (orbit.cx || 0) - sx; orbit.cz = (orbit.cz || 0) - sz; }
      if (zones) { zones.cx = (zones.cx || 0) - sx; zones.cz = (zones.cz || 0) - sz; }
      let far = 0;
      stars = [];
      pods.forEach((pod) => {
        const a = pod[0].m, pa = place.get(a.nodeId);
        if (!pa) return;
        const ds = [];
        for (const it of pod) {
          const pl = place.get(it.m.nodeId);
          if (!pl) continue;
          const pts = [];
          for (const [id, p] of rotLocal(it.m.local, pl.rot)) pts.push({ x: pl.x + p.x, z: pl.z + p.z, e: nodeExtent(it.m.sub.get(id)), id });
          for (const g of it.m.guests || []) for (const [id, p] of g.local) pts.push({ x: pl.x + g.offset.x + p.x, z: pl.z + g.offset.z + p.z, e: nodeExtent(g.sub.get(id)), id });
          for (const q of pts) {
            if (hidden.has(q.id)) continue; // 숨긴 노드(끝난 루트·그 하위)는 반지름·고리에 넣지 않음 — 보이는 노드 기준
            far = Math.max(far, Math.hypot(q.x, q.z) + q.e);
            if (q.id !== a.nodeId) ds.push(Math.hypot(q.x - pa.x, q.z - pa.z));
          }
        }
        stars.push({ x: pa.x, z: pa.z, nodeId: a.nodeId, rings: tierRings(ds, 3 * spread) });
      });
      round = Math.max(CLUSTER_MIN_R, far + CLUSTER_PAD);
      const pr = prevRound0.get(pid);
      if (pr > 0 && Math.abs(round - pr) <= Math.max(ROUND_DEAD_MIN, pr * ROUND_DEADBAND) && far <= pr) round = pr; // 데드밴드(노드가 가장자리를 넘지 않을 때만)
      round0 = round;
      box = { hw: round, hd: round };
    }
    else if (roundOpt) { round = box.hw; stars = []; } // 빈(inactive) 섬도 원
    const mOut = shown.filter((m) => place.has(m.nodeId)).map((m) => { const pl = place.get(m.nodeId); return { nodeId: m.nodeId, origin: { x: pl.x, y: 0, z: pl.z }, r: m.r, rot: pl.rot }; });
    const activeRoot = shown.some((m) => { const n = byId.get(m.nodeId); return n && n.status === 'active'; });
    const busyRoot = shown.some((m) => { const n = byId.get(m.nodeId); return n && n.meta && n.meta.liveStatus === 'busy'; });
    clusters.push({
      projectId: pid, name: q.name, temp: q.temp, currentMain: cur0 ? (anchors[0] && isMainM(anchors[0]) ? anchors[0].nodeId : cur0.nodeId) : null,
      liveMains: anchors.filter((a) => liveIds.includes(a.nodeId)).map((a) => a.nodeId),
      layoutMode: shape.mode, orbit, zones,
      live: q.live || shown.some((m) => !m.recent),
      active: q.active || activeRoot,
      busy: q.busy || busyRoot,
      inactive,
      sessions: q.sessions || list.length,
      liveSessions: q.liveSessions || shown.filter((m) => !m.recent).length,
      hiddenMains: list.length - shown.length,
      box, r: inactive ? CLUSTER_MIN_R : round || Math.hypot(box.hw, box.hd), round, round0, stars,
      mains: mOut, anchorOf: Object.fromEntries([...assign].map(([k, v]) => [k, v])),
      _list: list, _shown: shown, _place: place, _act: Math.max(0, ...list.map((m) => m.act)),
      center: null,
    });
  }

  // 2-2. 작은 섬 키우기: 섬 안 자리·지역 배치·대기석을 같은 배율로 넓힌다(노드 크기는 그대로, 간격만). 기준 = 상자 긴 변
  const minK = Number.isFinite(opts.islandMin) ? opts.islandMin : ISLAND_MIN_K;
  const size = (c) => Math.max(c.box.hw, c.box.hd);
  let maxS = 0;
  for (const c of clusters) if (!c.inactive) maxS = Math.max(maxS, size(c));
  if (minK > 0 && maxS > 0) for (const c of clusters) {
    if (c.inactive || !c._shown.length) continue;
    const k = Math.min(ISLAND_MAX_BOOST, (maxS * minK) / size(c));
    if (!(k > 1.001)) continue;
    c.scale = k;
    c.box = { hw: c.box.hw * k, hd: c.box.hd * k };
    c.r = c.round ? (c.round *= k) : Math.hypot(c.box.hw, c.box.hd);
    if (c.stars) c.stars = c.stars.map((st) => ({ ...st, x: st.x * k, z: st.z * k, rings: st.rings.map((r) => r * k) }));
    if (c.orbit) c.orbit = { r: c.orbit.r * k, cx: (c.orbit.cx || 0) * k, cz: (c.orbit.cz || 0) * k };
    if (c.zones) c.zones = { ...c.zones, r0: c.zones.r0 * k, cx: (c.zones.cx || 0) * k, cz: (c.zones.cz || 0) * k };
    for (const mo of c.mains) { mo.origin.x *= k; mo.origin.z *= k; mo.r *= k; }
    for (const pl of c._place.values()) { pl.x *= k; pl.z *= k; }
    for (const m of c._list) {
      for (const p of m.local.values()) { p.x *= k; p.z *= k; }
      for (const g of m.guests || []) { g.offset.x *= k; g.offset.z *= k; for (const p of g.local.values()) { p.x *= k; p.z *= k; } }
    }
  }

  // 3. 섬 자리: 이전 자리를 되도록 유지 — 크기가 크게 바뀌거나 겹치면 그때만 다시 줄 배치(packRows)
  // '' = 자리 유지, 'held' = 더 촘촘한 배치가 있지만 기다리는 중, 그 밖 = 다시 배치한 까닭(aspect·fresh·clash·state·gain·waste)
  const repackWhy = placeClusters(clusters, prev, aspect, view, roundOpt ? ROUND_REPACK_TOL : undefined, nowMs);
  const repacked = !!repackWhy && repackWhy !== 'held';
  const gainSince = repackWhy === 'held' ? (prev && Number.isFinite(prev.gainSince) ? prev.gainSince : nowMs) : null;
  const packAt = repacked || !(prev && Number.isFinite(prev.packAt)) ? nowMs : prev.packAt;
  // 배치를 고른 가용 비율·배치 차례: 자리 유지 중엔 이전 값을 물려받아, 비율이 조금씩 쌓여 바뀌어도 결국 다시 배치
  const packAspect = view ? (repacked || !(prev && prev.packAspect > 0) ? view.aspect : prev.packAspect) : null;
  const packBase = view && view.baseAspect > 0 ? (repacked || !(prev && prev.packBase > 0) ? view.baseAspect : prev.packBase) : null;
  const packSeq = ((prev && prev.packSeq) || 0) + (repacked ? 1 : 0);

  // 4. 전역 좌표
  const mainOrder = new Map();
  for (const c of clusters) {
    c._list.forEach((m, i) => mainOrder.set(m.nodeId, i));
    for (const m of c._list) {
      const pl = c._place.get(m.nodeId) || { x: 0, z: 0, rot: 0 };
      const loc = rotLocal(m.local, pl.rot);
      for (const [id, p] of loc) pos.set(id, { x: c.center.x + pl.x + p.x, y: p.y, z: c.center.z + pl.z + p.z });
      for (const [id, p] of m.parentOf) parentOf.set(id, p);
      for (const g of m.guests || []) {
        const gx = c.center.x + pl.x + g.offset.x, gz = c.center.z + pl.z + g.offset.z;
        for (const [id, p] of g.local) { pos.set(id, { x: gx + p.x, y: p.y, z: gz + p.z }); projectOf.set(id, c.projectId); }
        for (const [id, p] of g.parentOf) parentOf.set(id, p);
        parentOf.set(g.nodeId, m.nodeId); // 추정 소속: 메인 → 독립 루트 점선(isGuessLink)
        mainOrder.set(g.nodeId, 1000 + mainOrder.size);
      }
    }
    delete c._list; delete c._shown; delete c._act; delete c._place;
  }
  for (const [d] of mergedInto) if (!mainOrder.has(d)) mainOrder.set(d, 1000 + mainOrder.size);
  for (const [d] of mergedInto) parentOf.set(d, null); // 관계는 끊긴 그대로(띄움 점선)
  return { clusters, pos, parentOf, rootOf, hidden, projectOf, mainOrder, roots: R, guestOf, mergedInto, packAspect, packSeq, repackWhy, gainSince, packAt, packBase };
}

/**
 * 궤도 고리 반지름: 항성(메인)에서 노드까지 거리들을 gap 안쪽끼리 묶은 단계(가까운 것부터, 최대 max 개).
 * 묶음 = 그 거리들의 가운데 값. 배치(computeLayout 의 고리 R1·R2…)가 만든 실제 거리라 노드가 고리 위에 놓여 보인다.
 */
export function tierRings(dists, gap = 3, max = 5) {
  const d = dists.filter((x) => Number.isFinite(x) && x > 0.5).sort((a, b) => a - b);
  const out = [];
  let grp = [];
  const flush = () => { if (grp.length) out.push(grp[Math.floor(grp.length / 2)]); grp = []; };
  for (const x of d) { if (grp.length && x - grp[grp.length - 1] > gap) flush(); grp.push(x); }
  flush();
  if (out.length <= max) return out;
  // 너무 많으면 고르게 max 개(첫·끝 포함)
  return Array.from({ length: max }, (_, i) => out[Math.round((i * (out.length - 1)) / (max - 1))]);
}

/** 상자 두 개가 (간격 gap 포함) 겹치는가 */
const boxHit = (a, b, gap) => Math.abs(a.center.x - b.center.x) < a.box.hw + b.box.hw + gap - 1e-9 && Math.abs(a.center.z - b.center.z) < a.box.hd + b.box.hd + gap - 1e-9;
const unionScore = (list, aspect) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const c of list) { x0 = Math.min(x0, c.center.x - c.box.hw); x1 = Math.max(x1, c.center.x + c.box.hw); z0 = Math.min(z0, c.center.z - c.box.hd); z1 = Math.max(z1, c.center.z + c.box.hd); }
  return list.length ? Math.max((x1 - x0) / aspect, z1 - z0) : 0;
};
export const RESIZE_TOL = 0.25;  // (2026-10-25 부터 자리 유지 판정에 안 씀 — 크기 변화는 비키기·REPACK_HOLD_MS 로) 바깥 호환용
export const WASTE_TOL = 1.45;   // 자리 유지 배치가 새 줄 배치보다 이만큼 넓으면 다시 줄 배치
// 2026-10-25 다시 배치 진동 막기: 다중 세션에서 섬이 늘고 줄 때마다(서브에이전트 생김·끝나 숨김) 약 10～30초마다
// 섬 전체가 자리를 바꾸던 것. 크기 변화는 자리 유지 + 비키기로 받고, '더 촘촘한 배치가 있다'(gain·waste)는
// REPACK_HOLD_MS 동안 이어지고 마지막 다시 배치 뒤 REPACK_MIN_MS 가 지났을 때만. 비율·새 섬·겹침·활성 상태 변화는 바로.
export const REPACK_HOLD_MS = 8000;
export const REPACK_MIN_MS = 60000;

/** 줄 배치: 순서 = 이전 순서 → 새 섬(활성 먼저), 비활성 섬은 아래 따로 줄. 활성 묶음 가운데가 원점.
 *  view가 있으면 활성 섬은 줄·열·크기 순 후보 중 맞춤 배율 최대(chooseArrangement) */
function packFresh(clusters, prev, aspect, view = null) {
  const prevIdx = new Map(((prev && prev.clusters) || []).map((c, i) => [c.projectId, i]));
  const kept = clusters.filter((c) => prevIdx.has(c.projectId)).sort((a, b) => prevIdx.get(a.projectId) - prevIdx.get(b.projectId));
  const fresh = clusters.filter((c) => !prevIdx.has(c.projectId));
  const rank = (c) => (c.active ? 0 : c.live ? 1 : 2);
  fresh.sort((a, b) => (rank(a) - rank(b)) || ((a.temp ? 1 : 0) - (b.temp ? 1 : 0)) || (b._act - a._act) || (a.projectId < b.projectId ? -1 : 1));
  const order = [...kept, ...fresh];
  const live = order.filter((c) => !c.inactive), dead = order.filter((c) => c.inactive);
  if (view && live.length) {
    const best = chooseArrangement(live, view, { gap: CLUSTER_GAP, tag: CLUSTER_TAG });
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const c of live) {
      const p = best.centers.get(c);
      c.center = { x: p.x, z: p.z };
      x0 = Math.min(x0, p.x - c.box.hw); x1 = Math.max(x1, p.x + c.box.hw); z0 = Math.min(z0, p.z - c.box.hd); z1 = Math.max(z1, p.z + c.box.hd);
    }
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    for (const c of live) { c.center.x -= mx; c.center.z -= mz; }
    let z = (z1 - z0) / 2 + CLUSTER_GAP + CLUSTER_TAG;
    for (const row of packRows(dead, aspect)) {
      const hmax = Math.max(...row.map((c) => c.box.hd));
      z += hmax;
      let x = 0;
      row.forEach((c, i) => { if (i) x += row[i - 1].box.hw + c.box.hw + CLUSTER_GAP; c.center = { x, z }; });
      const mid = (row[0].center.x - row[0].box.hw + row[row.length - 1].center.x + row[row.length - 1].box.hw) / 2;
      for (const c of row) c.center.x -= mid;
      z += hmax + CLUSTER_GAP + CLUSTER_TAG;
    }
    return;
  }
  const rowsA = packRows(live, aspect), rowsB = packRows(dead, aspect);
  let z = 0, first = true;
  for (const rows of [rowsA, rowsB]) for (const row of rows) {
    const hmax = Math.max(...row.map((c) => c.box.hd));
    if (!first) z += hmax;
    first = false;
    let x = 0;
    row.forEach((c, i) => { if (i) x += row[i - 1].box.hw + c.box.hw + CLUSTER_GAP; c.center = { x, z }; });
    const mid = (row[0].center.x - row[0].box.hw + row[row.length - 1].center.x + row[row.length - 1].box.hw) / 2;
    for (const c of row) c.center.x -= mid;
    z += hmax + CLUSTER_GAP + CLUSTER_TAG;
  }
  const base = rowsA.length ? rowsA.flat() : rowsB.flat();
  if (base.length) {
    let z0 = Infinity, z1 = -Infinity;
    for (const c of base) { z0 = Math.min(z0, c.center.z - c.box.hd); z1 = Math.max(z1, c.center.z + c.box.hd); }
    const zc = (z0 + z1) / 2;
    for (const c of order) c.center.z -= zc;
  }
}

/**
 * 섬 자리 정하기. 이전 결과가 있고 남은 섬들의 활성 상태가 같으면 그 자리 그대로(커져 닿으면 비킴, 겹침이 안 풀리면 다시),
 * 새 섬만 기존 섬 옆 빈자리(전체 상자가 가장 덜 커지는 곳). 사라진 섬 자리는 비워 둔다. 그렇게 해서
 * 새로 줄 배치한 것보다 WASTE_TOL 배 넘게 넓어지면 다시 줄 배치.
 */
function placeClusters(clusters, prev, aspect, view = null, repackTol = undefined, nowMs = 0) {
  // 촘촘한 배치를 위한 다시 배치(gain·waste·라벨 몫 비율)는 이어진 시간·최소 간격을 지켰을 때만(진동 막기)
  const since = prev && Number.isFinite(prev.gainSince) ? prev.gainSince : nowMs;
  const lastAt = prev && Number.isFinite(prev.packAt) ? prev.packAt : -Infinity;
  const mayGain = nowMs - since >= REPACK_HOLD_MS && nowMs - lastAt >= REPACK_MIN_MS;
  // 가용 비율이 크게 바뀌면(가로↔세로·패널 접기/펴기) 자리 유지보다 다시 배치가 먼저. 단 화면·패널은 그대로이고
  // 라벨이 노드 밖으로 나간 몫(labelReserve)만 바뀐 것이면 — 배치 → 카메라 → 라벨 → 비율 되먹임 — gain 처럼 기다림
  let heldAspect = false;
  if (view && prev && needRepack(prev.packAspect, view.aspect, repackTol)) {
    const labelOnly = view.baseAspect > 0 && prev.packBase > 0 && !needRepack(prev.packBase, view.baseAspect, repackTol);
    if (!labelOnly || mayGain) { packFresh(clusters, prev, aspect, view); return 'aspect'; }
    heldAspect = true;
  }
  const prevC = new Map(((prev && prev.clusters) || []).filter((c) => c && c.center && c.box).map((c) => [c.projectId, c]));
  const kept = clusters.filter((c) => prevC.has(c.projectId));
  // 크기는 자리 유지를 막지 않는다(커지면 아래 비키기, 줄어 생긴 빈자리는 gain·waste 가 오래 이어질 때만) — 활성 상태가 바뀐 섬만
  const ok = kept.length > 0 && kept.every((c) => !!c.inactive === !!prevC.get(c.projectId).inactive);
  if (ok) {
    for (const c of kept) c.center = { x: prevC.get(c.projectId).center.x, z: prevC.get(c.projectId).center.z };
    // 조금 커져 이웃에 닿으면 뒤 순서(나중에 생긴) 섬만 가장 덜 겹친 축으로 살짝 비킨다 — 그래도 안 풀리면 다시 줄 배치
    const prevIdx = new Map(((prev && prev.clusters) || []).map((c, i) => [c.projectId, i]));
    kept.sort((a, b) => prevIdx.get(a.projectId) - prevIdx.get(b.projectId));
    let clash = false;
    for (let pass = 0; pass < 12; pass++) {
      clash = false;
      for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) {
        const A = kept[i], B = kept[j];
        if (!boxHit(A, B, CLUSTER_GAP)) continue;
        clash = true;
        const px = A.box.hw + B.box.hw + CLUSTER_GAP - Math.abs(A.center.x - B.center.x), pz = A.box.hd + B.box.hd + CLUSTER_GAP - Math.abs(A.center.z - B.center.z);
        if (px <= pz) B.center.x += (B.center.x >= A.center.x ? 1 : -1) * (px + 1e-6);
        else B.center.z += (B.center.z >= A.center.z ? 1 : -1) * (pz + 1e-6);
      }
      if (!clash) break;
    }
    if (!clash) {
      const placed = kept.slice();
      const rank = (c) => (c.inactive ? 2 : c.active ? 0 : 1);
      const fresh = clusters.filter((c) => !prevC.has(c.projectId)).sort((a, b) => (rank(a) - rank(b)) || (b._act - a._act) || (a.projectId < b.projectId ? -1 : 1));
      for (const c of fresh) {
        let best = null;
        for (const o of placed) {
          const G = CLUSTER_GAP, T = CLUSTER_GAP + CLUSTER_TAG;
          const cands = [
            { x: o.center.x + o.box.hw + c.box.hw + G, z: o.center.z }, { x: o.center.x - o.box.hw - c.box.hw - G, z: o.center.z },
            { x: o.center.x, z: o.center.z + o.box.hd + c.box.hd + T }, { x: o.center.x, z: o.center.z - o.box.hd - c.box.hd - T },
            { x: o.center.x + o.box.hw + c.box.hw + G, z: o.center.z - o.box.hd + c.box.hd }, { x: o.center.x - o.box.hw - c.box.hw - G, z: o.center.z - o.box.hd + c.box.hd },
            { x: o.center.x - o.box.hw + c.box.hw, z: o.center.z + o.box.hd + c.box.hd + T }, { x: o.center.x + o.box.hw - c.box.hw, z: o.center.z + o.box.hd + c.box.hd + T },
          ];
          for (const p of cands) {
            c.center = p;
            if (placed.some((x) => boxHit(x, c, CLUSTER_GAP))) continue;
            const s = unionScore([...placed, c], aspect) + 1e-4 * Math.hypot(p.x, p.z);
            if (!best || s < best.s - 1e-9) best = { s, p: { x: p.x, z: p.z } };
          }
        }
        c.center = best ? best.p : { x: 0, z: 0 };
        placed.push(c);
      }
      // 자리 유지가 너무 헐거우면(섬이 빠져 큰 구멍 등) 다시 줄 배치
      const keepScore = unionScore(clusters.filter((c) => !c.inactive).length ? clusters.filter((c) => !c.inactive) : clusters, aspect);
      const saved = clusters.map((c) => c.center);
      if (view) {
        // 자리 유지가 다시 배치보다 화면을 덜 채우면(배율 KEEP_GAIN 넘게 손해 — 섬이 늘고 줄며 생긴 빈자리) 다시 배치
        const L = clusters.filter((c) => !c.inactive).length ? clusters.filter((c) => !c.inactive) : clusters;
        const keepS = scaleOf(L, view, CLUSTER_TAG);
        packFresh(clusters, prev, aspect, view);
        if (scaleOf(L, view, CLUSTER_TAG) <= keepS * KEEP_GAIN) { clusters.forEach((c, i) => { c.center = saved[i]; }); return heldAspect ? 'held' : ''; }
        if (!mayGain) { clusters.forEach((c, i) => { c.center = saved[i]; }); return 'held'; }
        return 'gain';
      }
      packFresh(clusters, prev, aspect, view);
      const freshScore = unionScore(clusters.filter((c) => !c.inactive).length ? clusters.filter((c) => !c.inactive) : clusters, aspect);
      if (keepScore <= freshScore * WASTE_TOL) { clusters.forEach((c, i) => { c.center = saved[i]; }); return heldAspect ? 'held' : ''; }
      if (!mayGain) { clusters.forEach((c, i) => { c.center = saved[i]; }); return 'held'; }
      return 'waste';
    }
  }
  packFresh(clusters, prev, aspect, view);
  return !kept.length ? 'fresh' : ok ? 'clash' : 'state';
}
