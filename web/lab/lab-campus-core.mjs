// 【리드】 복셀 연구소 전체 보기(scope=all) 캠퍼스 배치 computeLabCampus — 순수(three·DOM 없음), node --test 대상. 3D·2D 공용.
// 설계 결정: 전체 보기 = 프로젝트마다 원형 연구동 하나를 캠퍼스 격자에(복셀 캠퍼스 와 같은 슬롯 규칙: 이전 슬롯 유지, 새 동은
// 활성 먼저 앞줄 가운데부터). 같은 프로젝트의 live 메인 여럿은 그 연구동 플랫폼 하나를 함께 쓰고 브리지를 둘레에 나눈다
// (computeLab 다중 메인 구역 — 현재 메인 = 0 구역). 숨긴(표시 고르기) 프로젝트·세션과 끝난 루트(showInactive 끔)는 빠진다.
// 비활성 프로젝트(live 없음) 연구동은 building.dome = true(유리 돔이 닫힘 — LabView._buildBuilding 이 그림).
// 출력 = computeCampus 와 같은 모양(rooms·seat·machine·corridors·roomOf·rootId·bounds·buildings·roots·mainOrder·grid·hidden·projectOf·
// campus:true·lounges:[]·visSig) + labByProject(Map pid → computeLab 결과, prev 로 다시 씀). officeByMain 은 두지 않는다
// (사무실 이사 보간·스텐실은 오피스 전용).
import { computeLab } from './lab-layout-core.mjs';
import { LAB, labRadii, polar, dTheta } from './lab-const.mjs';
import { isDetachedRoot } from '../layout.js';
import { assignRoots, normProject, isRecentRoot, currentMain } from '../overview/layout.mjs';
import { orphanPlan } from '../batch-core.mjs';
import { liveMainSids } from '../multi-core.mjs';
import { chooseGridCols, needRepack } from '../overview/fill-pack.mjs';
import { userHiddenProjects, userHiddenRoots, visSig } from '../overview/visible.mjs';

/** 연구동 사이 간격 · 동 바닥판이 외벽보다 넓은 만큼 */
export const LAB_CAMPUS = { GAP: 10, PAD: 2, SIGN_OUT: 1.2, SIGN_DOOR: 45, SIGN_LOUNGE: 30 };

/**
 * 연구동 간판(프로젝트 이름) 자리(순수, 세계 좌표) — 외벽 원 바로 아래(θ 0 = +z, 화면 아래쪽)를 먼저,
 * 출입문(±SIGN_DOOR°)·라운지(±SIGN_LOUNGE°) 방위와 겹치면 앞쪽 반원에서 5°씩 좌우로 비켜 고르고, 앞쪽에 자리가 없으면 θ 180(뒤).
 * 반지름 = rWall + SIGN_OUT(외벽 밖, 동 바닥판 PAD 안이라 이웃 동 bounds 와 겹치지 않음). 3D 간판·2D(T5) 공용: building.labelX/labelZ.
 */
export function labSignSpot(cx, cz, rWall, doorTheta = LAB.FRONT.DOOR, loungeTheta = LAB.FRONT.LOUNGE) {
  const ok = (th) => Math.abs(dTheta(th, doorTheta)) >= LAB_CAMPUS.SIGN_DOOR && (loungeTheta == null || Math.abs(dTheta(th, loungeTheta)) >= LAB_CAMPUS.SIGN_LOUNGE);
  let theta = 180;
  for (let d = 0; d <= 90; d += 5) {
    if (ok((360 - d) % 360)) { theta = (360 - d) % 360; break; }
    if (d && ok(d)) { theta = d; break; }
  }
  const p = polar(cx, cz, rWall + LAB_CAMPUS.SIGN_OUT, theta);
  return { x: p.x, z: p.z, theta };
}

const tsOf = (v) => { const t = typeof v === 'number' ? v : Date.parse(v || ''); return Number.isFinite(t) ? t : 0; };
function slotSeq(cols) {
  const out = [], order = [0];
  for (let k = 1; order.length < cols; k++) { order.push(k); if (order.length < cols) order.push(-k); }
  for (let row = 0; row < 64; row++) for (const c of order) out.push({ col: c, row });
  return out;
}

/**
 * @param nodes    Map 또는 배열(VoxelView._present 결과)
 * @param roots    [{nodeId, projectId}]
 * @param projects 프로젝트 항목(liveList·visible…)
 * @param prev     이전 결과(자리 고정)
 * @param opts     { showInactive, nowMs, view(packView — 열 수 맞춤), rPOf(pid) → 플랫폼 반지름, ixCatOf(id), reserved(Set) }
 */
export function computeLabCampus(nodes, roots, projects, prev, opts = {}) {
  const showInactive = !!opts.showInactive;
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  let map = nodes instanceof Map ? nodes : new Map([...(nodes || [])].filter((n) => n && n.id).map((n) => [n.id, n]));
  // 독립 기동기는 띄운 세션 메인 쪽으로(computeCampus 와 같은 규칙)
  if ([...map.values()].some(isDetachedRoot)) {
    const m2 = new Map(map);
    for (const n of map.values()) {
      if (!isDetachedRoot(n)) continue;
      const sp = n.meta && n.meta.spawnedBy, spn = sp && map.get(sp);
      const handed = spn && spn.id !== n.id && spn.rootSessionId && spn.rootSessionId !== n.rootSessionId ? (map.has('s:' + spn.rootSessionId) ? 's:' + spn.rootSessionId : sp) : null;
      const host = handed || (n.rootSessionId && map.has('s:' + n.rootSessionId) && 's:' + n.rootSessionId) || (map.has(sp) && sp) || null;
      if (host && host !== n.id) m2.set(n.id, { ...n, parentId: host });
    }
    map = m2;
  }
  for (const n of map.values()) if (n._order == null && Number.isFinite(n.order)) n._order = n.order;
  const { roots: R, subtrees, byId } = assignRoots(map, roots);
  const projById = new Map();
  for (const p of projects || []) { const q = normProject(p, nowMs); if (q) projById.set(q.projectId, q); }
  const rawProj = (pid) => (projects || []).find((p) => p && p.projectId === pid) || null;

  const uhP = userHiddenProjects(projects), uhR = userHiddenRoots(roots);
  const sig = visSig(uhP, uhR);
  const userHid = (r) => uhP.has(r.projectId) || uhR.has(r.nodeId);
  const hidden = new Set(), projectOf = new Map();
  const plan = orphanPlan(R, byId);

  // 1. 프로젝트별 노드 모음(보이는 루트의 서브트리 합) — 독립 claude -p 루트는 그 프로젝트 연구동 손님(대기석)
  const byProj = new Map();
  const ensure = (pid) => { if (!byProj.has(pid)) byProj.set(pid, { list: [], mains: [], act: 0, busy: false, active: false, recentOnly: true, orphans: [] }); return byProj.get(pid); };
  for (const r of R) {
    const rootNode = byId.get(r.nodeId), sub = subtrees.get(r.nodeId);
    for (const id of sub.keys()) projectOf.set(id, r.projectId);
    const recent = isRecentRoot(rootNode);
    if (userHid(r) || (recent && !showInactive)) { for (const id of sub.keys()) hidden.add(id); continue; }
    const P = ensure(r.projectId);
    const orphan = plan.has(r.nodeId);
    for (const n of sub.values()) P.list.push(orphan && n.id === r.nodeId ? { ...n, guest: true, parentId: null } : n);
    let act = 0;
    for (const n of sub.values()) act = Math.max(act, tsOf(n.lastActivityAt));
    P.act = Math.max(P.act, act);
    if (!recent) P.recentOnly = false;
    if (rootNode && rootNode.status === 'active') P.active = true;
    if (rootNode && rootNode.meta && rootNode.meta.liveStatus === 'busy') P.busy = true;
    if (orphan) P.orphans.push(r.nodeId);
    else P.mains.push({ nodeId: r.nodeId, act, recent });
  }

  // 2. 동 목록: 연구동이 있는 프로젝트 + 루트 없는 live/recent 프로젝트(닫힌 돔만)
  const pids = new Set(byProj.keys());
  for (const q of projById.values()) if (!q.temp && (q.live || q.recent)) pids.add(q.projectId);
  for (const pid of [...pids]) {
    const rs = R.filter((r) => r.projectId === pid);
    if (uhP.has(pid) || (!byProj.has(pid) && rs.length && rs.every((r) => uhR.has(r.nodeId)))) pids.delete(pid);
  }
  const prevLab = (prev && prev.labByProject) || new Map();
  const buildings = [];
  for (const pid of pids) {
    const q = projById.get(pid) || { projectId: pid, name: pid, live: false, active: false, busy: false, temp: false, recent: false, sessions: 0 };
    const P = byProj.get(pid);
    const rP = (opts.rPOf && opts.rPOf(pid)) || LAB.PLATFORM.R_DEFAULT;
    let rootId = null, liveMains = [];
    if (P && P.mains.length) {
      const cur = currentMain(P.mains, rawProj(pid), byId);
      rootId = cur ? cur.nodeId : P.mains[0].nodeId;
      liveMains = liveMainSids(rawProj(pid)).map((s) => 's:' + s);
    }
    // live 가 아닌 메인(끝난 세션)은 구역(브리지)을 받지 않고 출입문 안 대기석(손님)으로 — 플랫폼 공유는 live 메인끼리
    let list = P ? P.list : [];
    if (P && liveMains.length) {
      const liveSet = new Set([rootId, ...liveMains]);
      list = list.map((n) => (n.kind === 'main' && !liveSet.has(n.id) && P.mains.some((m) => m.nodeId === n.id) ? { ...n, guest: true } : n)); // 지난 메인 = 손님 대기석
    }
    const size = labRadii(rP, 1).rWall; // 1차 크기(열 수가 늘면 2차에서 다시)
    buildings.push({
      projectId: pid, name: q.name, temp: q.temp,
      live: q.live || !!(P && !P.recentOnly),
      active: q.active || !!(P && P.active),
      busy: q.busy || !!(P && P.busy),
      recent: !P,
      sessions: q.sessions || (P ? P.mains.length : 0),
      liveSessions: q.liveSessions || liveMains.length,
      offices: [], lounge: null,
      _list: list, _root: rootId, _rP: rP, _r: size, _act: P ? P.act : 0,
    });
  }
  // 1차 크기(실제 열 수 반영): 중심 (0,0) 에서 한 번 계산
  for (const b of buildings) {
    if (!b._list.length) continue;
    const lay0 = computeLab(b._list, b._root, prevLab.get(b.projectId) || null, { rP: b._rP, ixCatOf: opts.ixCatOf });
    if (lay0.rooms[0]) b._r = lay0.rooms[0].lab.R.rWall;
  }
  for (const b of buildings) { const h = b._r + LAB_CAMPUS.PAD; b.local = { minX: -h, maxX: h, minZ: -h, maxZ: h }; }

  // 3. 격자 슬롯(이전 슬롯 유지 · 새 동은 활성 먼저 앞줄 가운데부터) — 칸 크기 = 가장 큰 연구동 + 간격(원이라 고른 격자)
  const view = opts.view && opts.view.aspect > 0 ? opts.view : null;
  const repack = !!(prev && ((view && needRepack(prev.packAspect, view.aspect)) || (prev.visSig || '') !== sig));
  const prevSlot = new Map((repack ? [] : (prev && prev.buildings) || []).map((b) => [b.projectId, b.slot]));
  const prevIdx = new Map(((prev && prev.buildings) || []).map((b, i) => [b.projectId, i]));
  const used = new Set(), key = (s) => s.col + ',' + s.row;
  const kept = buildings.filter((b) => prevSlot.has(b.projectId)).sort((a, b) => prevIdx.get(a.projectId) - prevIdx.get(b.projectId));
  const fresh = buildings.filter((b) => !prevSlot.has(b.projectId));
  const rank = (b) => (b.recent ? 3 : b.active ? 0 : b.live ? 1 : 2);
  fresh.sort((a, b) => (rank(a) - rank(b)) || ((a.temp ? 1 : 0) - (b.temp ? 1 : 0)) || (b._act - a._act) || (a.projectId < b.projectId ? -1 : 1));
  const cell = Math.max(0, ...buildings.map((b) => 2 * (b._r + LAB_CAMPUS.PAD))) + LAB_CAMPUS.GAP;
  const cols = view ? chooseGridCols(buildings.map(() => ({ w: cell - LAB_CAMPUS.GAP, d: cell - LAB_CAMPUS.GAP })), view, { gap: LAB_CAMPUS.GAP })
    : Math.max(1, Math.min(4, Math.ceil(Math.sqrt(buildings.length))));
  const seq = slotSeq(cols);
  for (const b of kept) { const s = prevSlot.get(b.projectId); if (!used.has(key(s))) { b.slot = { col: s.col, row: s.row }; used.add(key(s)); } else fresh.unshift(b); }
  for (const b of fresh) { const s = seq.find((x) => !used.has(key(x))); b.slot = { col: s.col, row: s.row }; used.add(key(s)); }
  const pg = (!repack && prev && prev.grid) || {};
  const step = Math.max(cell, pg.cell || 0); // 칸은 커지기만(자리 고정 — 큰 연구동이 빠져도 이웃이 당겨 오지 않음)
  for (const b of buildings) b.origin = { x: b.slot.col * step, z: b.slot.row ? -b.slot.row * step : 0 };

  // 4. 2차: 제자리 중심으로 computeLab → 전역 합치기
  const out = { rooms: [], seat: new Map(), machine: new Map(), corridors: [], roomOf: new Map(), rootId: null, bounds: null,
    buildings: [], roots: new Set(), mainOrder: new Map(), grid: { cell: step, colW: step, rowD: step }, hidden, projectOf, campus: true, lab: true, lounges: [], visSig: sig, labByProject: new Map() };
  if (view) { const fresh0 = repack || !(prev && prev.packAspect > 0); out.packAspect = fresh0 ? view.aspect : prev.packAspect; out.packSeq = ((prev && prev.packSeq) || 0) + (fresh0 ? 1 : 0); }
  const bb = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const firstActive = [...buildings].sort((a, b) => (rank(a) - rank(b)) || ((a.temp ? 1 : 0) - (b.temp ? 1 : 0)) || (b._act - a._act))[0];
  for (const b of buildings) {
    const cx = b.origin.x, cz = b.origin.z;
    if (b._list.length) {
      const lay = computeLab(b._list, b._root, prevLab.get(b.projectId) || null, { rP: b._rP, cx, cz, ixCatOf: opts.ixCatOf, reserved: opts.reserved });
      out.labByProject.set(b.projectId, lay);
      lay.rooms.forEach((r, i) => {
        r.projectId = b.projectId; r.projectName = b.name;
        if (!b.live) r.recent = true; // 끝난 프로젝트 연구동은 흐리게(돔 닫힘)
        out.rooms.push(r);
        out.roots.add(r.ownerId); out.mainOrder.set(r.ownerId, i);
      });
      for (const [k, v] of lay.seat) out.seat.set(k, v);
      for (const [k, v] of lay.machine) out.machine.set(k, v);
      for (const [k, v] of lay.roomOf) out.roomOf.set(k, v);
      for (const n of b._list) if (n.kind === 'main' && lay.seat.has(n.id)) out.roots.add(n.id);
      b.offices = lay.rooms.map((r) => ({ mainId: r.ownerId, offset: { x: 0, z: 0 }, lab: true })); // 카메라·고르기용 메인 목록
      b.mains = b.offices.map((o) => o.mainId);
    }
    const h = b._r + LAB_CAMPUS.PAD;
    b.bounds = { minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h };
    b.center = { x: cx, z: cz };
    b.size = { w: 2 * h, d: 2 * h };
    b.lab = { cx, cz, rWall: b._r, rP: b._rP };
    const lab0 = out.labByProject.get(b.projectId), L0 = lab0 && lab0.rooms[0] && lab0.rooms[0].lab;
    const sp = labSignSpot(cx, cz, b._r, L0 ? L0.doorTheta : LAB.FRONT.DOOR, L0 ? L0.loungeTheta : LAB.FRONT.LOUNGE);
    b.labelX = sp.x; b.labelZ = sp.z; // 간판 자리(세계) — 3D _updateSigns · 2D 가 쓴다
    b.dome = !b.live; // 비활성 = 돔 닫힘
    bb.minX = Math.min(bb.minX, b.bounds.minX); bb.maxX = Math.max(bb.maxX, b.bounds.maxX); bb.minZ = Math.min(bb.minZ, b.bounds.minZ); bb.maxZ = Math.max(bb.maxZ, b.bounds.maxZ);
    delete b._list; delete b._act; delete b._r; delete b._rP;
    const root = b._root; delete b._root;
    if (b === firstActive && root) out.rootId = root;
    out.buildings.push(b);
  }
  if (!out.rootId && R.length) out.rootId = R[0].nodeId;
  out.bounds = Number.isFinite(bb.minX) ? bb : { minX: -12, maxX: 12, minZ: -9, maxZ: 9 };
  return out;
}
