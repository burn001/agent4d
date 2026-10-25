// 복셀 캠퍼스 배치 — 순수 함수, three 를 import 하지 않는다(node 시험 대상).
//
// 프로젝트 = 건물 동 하나. 메인(루트)마다 기존 computeOffice(서브트리) 로 사무실(별관·회의실 포함)을 만들고,
// 같은 프로젝트의 사무실들을 x 방향으로 간격 4 로 이어 한 동으로 묶는다. 동끼리는 격자(앞줄 가운데부터).
// 층(세로 쌓기)은 쓰지 않는다: 위 시점 카메라에서 아래층이 가려지기 때문.
//
// 결과는 OfficeLayout 과 같은 모양(rooms·seat·machine·corridors·roomOf·rootId·bounds)을 전역 좌표로 합친 것 +
// buildings·roots. VoxelView 는 이것을 computeOffice 결과처럼 그대로 쓴다.
import { computeOffice } from './layout.js';
import { isDetachedRoot } from '../layout.js';
import { currentMain } from '../overview/layout.mjs';
import { assignRoots, normProject, isRecentRoot } from '../overview/layout.mjs';
import { orphanPlan } from '../batch-core.mjs';
import { liveMainSids } from '../multi-core.mjs';
import { rotateOffice } from './xf.mjs';
import { chooseGridCols, needRepack } from '../overview/fill-pack.mjs';

export const OFFICE_GAP = 4;      // 같은 동 안 사무실(묶음) 사이
export const OFFICES_PER_ROW = 3; // 동 안 한 줄 사무실 수(넘치면 뒤로 다음 줄)
export const BLDG_GAP = 12;       // 동 사이(열 폭 = 가장 넓은 동 + 12)
export const BLDG_PAD = 2;        // 동 바닥판이 사무실 경계보다 넓은 만큼
export const RECENT_BOX = { w: 24, d: 18 };
// 같은 프로젝트 live 메인이 둘 이상: 동 가운데 공용 라운지(서류 캐비닛) 둘레에 live 메인 사무실, 지난 메인 사무실은 양쪽 날개
export const LOUNGE = { w: 14, d: 10 };
export const LOUNGE_GAP = 3;
// 라운지 둘레 자리 순서: 왼쪽·오른쪽(마주 봄) → 뒤 → 앞 → 네 모서리(4개 이상이면 ㅁ자 중정)
const LOUNGE_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
// 자리별 회전(사분 수): 사무실 앞(문, 지역 +z)이 라운지 쪽을 보게. 왼쪽 → +x(1), 오른쪽 → −x(3), 뒤 → +z(0), 앞 → −z(2),
//     모서리는 앞뒤 축만(뒤 모서리 0, 앞 모서리 2) — 90° 단위만 써서 복셀 격자 정렬 유지
export const LOUNGE_ROT = [1, 3, 0, 2, 0, 0, 2, 2];

const boxOf = (b, ox, oz) => ({ minX: ox + b.minX, maxX: ox + b.maxX, minZ: oz + b.minZ, maxZ: oz + b.maxZ });
const boxHit = (a, b, gap) => a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;

/**
 * 라운지 배치: live 사무실을 라운지 둘레(LOUNGE_DIRS 순)에, 그 밖 사무실은 양쪽 날개(왼쪽·오른쪽 번갈아).
 * live 사무실은 문이 라운지 쪽을 보게 돌린다(LOUNGE_ROT, o.layout 을 제자리에서 회전 — opts.rotate === false 면 안 돌림).
 * 겹치면 그 방향으로 한 칸씩 민다. 반환: [{o, offset, role, rot}], lounge(지역 좌표)
 */
export function loungePlan(liveOffs, wingOffs, opts = {}) {
  const hw = LOUNGE.w / 2, hd = LOUNGE.d / 2, G = LOUNGE_GAP;
  const lounge = { minX: -hw, maxX: hw, minZ: -hd, maxZ: hd };
  const placed = [lounge];
  const out = [];
  const settle = (b, ox, oz, dx, dz) => {
    for (let guard = 0; guard < 400 && placed.some((p) => boxHit(boxOf(b, ox, oz), p, G - 1e-6)); guard++) { ox += dx || 0; oz += dz || 0; if (!dx && !dz) oz -= 1; }
    placed.push(boxOf(b, ox, oz));
    return { x: ox, z: oz };
  };
  liveOffs.forEach((o, i) => {
    const rot = opts.rotate === false ? 0 : LOUNGE_ROT[i % LOUNGE_DIRS.length];
    if (rot) rotateOffice(o.layout, rot, 0, 0); // 라운지 쪽으로 문 — 회전 중심 = 지역 원점(첫 사무실 가운데)
    const b = o.layout.bounds, [dx, dz] = LOUNGE_DIRS[i % LOUNGE_DIRS.length];
    const ring = Math.floor(i / LOUNGE_DIRS.length);
    const ox = dx < 0 ? -hw - G - b.maxX : dx > 0 ? hw + G - b.minX : -(b.minX + b.maxX) / 2;
    const oz = dz < 0 ? -hd - G - b.maxZ : dz > 0 ? hd + G - b.minZ : -(b.minZ + b.maxZ) / 2;
    out.push({ o, offset: settle(b, ox + dx * ring * 30, oz + dz * ring * 24, dx, dz), role: 'live', rot });
  });
  let k = 0;
  for (const o of wingOffs) {
    const b = o.layout.bounds, side = k++ % 2 ? 1 : -1;
    const ext = placed.reduce((m, p) => (side < 0 ? Math.min(m, p.minX) : Math.max(m, p.maxX)), 0);
    const ox = side < 0 ? ext - G - b.maxX : ext + G - b.minX, oz = -(b.minZ + b.maxZ) / 2;
    out.push({ o, offset: settle(b, ox, oz, side, 0), role: 'wing' });
  }
  // 캐비닛은 라운지 가운데 뒤쪽, 그 앞 양옆이 직원이 서는 자리(캐비닛을 바라봄)
  const cab = { x: 0, z: -1.2 };
  return { out, lounge: { ...lounge, cabinet: cab, spots: [{ x: -1.3, z: 0.4, face: Math.PI * 0.85 }, { x: 1.3, z: 0.4, face: -Math.PI * 0.85 }, { x: -2.4, z: 1.2, face: Math.PI * 0.8 }, { x: 2.4, z: 1.2, face: -Math.PI * 0.8 }] } };
}

const tsOf = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };

function shiftPt(p, dx, dz) { if (p) { p.x += dx; p.z += dz; } }
function shiftBounds(b, dx, dz) { if (b) { b.minX += dx; b.maxX += dx; b.minZ += dz; b.maxZ += dz; } }

function shiftRoom(r, dx, dz) {
  shiftPt(r.origin, dx, dz);
  shiftBounds(r.bounds, dx, dz);
  shiftPt(r.leadDesk, dx, dz);
  for (const d of r.desks || []) shiftPt(d, dx, dz);
  for (const t of r.tables || []) shiftPt(t, dx, dz);
  for (const t of r.stools || []) shiftPt(t, dx, dz);
  for (const t of r.batches || []) shiftPt(t, dx, dz);
  for (const k of Object.keys(r.stations || {})) for (const s of r.stations[k]) shiftPt(s, dx, dz);
  for (const k of Object.keys(r.queues || {})) for (const s of r.queues[k]) shiftPt(s, dx, dz);
  if (r.door) { shiftPt(r.door, dx, dz); shiftPt(r.door.out, dx, dz); }
  if (r.portal) { shiftPt(r.portal, dx, dz); shiftPt(r.portal.spawn, dx, dz); }
  shiftPt(r.bell, dx, dz);
  shiftPt(r.board, dx, dz);
  for (const m of r.racks || []) shiftPt(m, dx, dz);
  for (const m of r.screens || []) shiftPt(m, dx, dz);
  // 회전한 방: 지역 사본·회전 중심도 같이. 돌린 방의 aisles·leftDoor 는 지역 사본에서만 쓴다
  if (r.xf) { r.xf.px += dx; r.xf.pz += dz; }
  if (r.local) { shiftRoom(r.local, dx, dz); return; }
  if (r.aisles) r.aisles = r.aisles.map((z) => z + dz);
  if (r.leftDoor != null) r.leftDoor += dz;
}

/** computeOffice 결과를 제자리에서 (dx, dz) 만큼 옮긴다. 지역 좌표(deskLX·lx·slot)는 그대로라 prev 로 다시 써도 된다 */
export function translateOffice(lay, dx, dz) {
  if (!dx && !dz) return lay;
  for (const r of lay.rooms) shiftRoom(r, dx, dz);
  for (const s of lay.seat.values()) { s.x += dx; s.z += dz; s.deskX += dx; s.deskZ += dz; }
  for (const m of lay.machine.values()) { m.x += dx; m.z += dz; }
  for (const c of lay.corridors) for (const p of c.path) shiftPt(p, dx, dz);
  shiftBounds(lay.bounds, dx, dz);
  return lay;
}

/** 슬롯 순서: 앞줄(행 0) 가운데 → 오른쪽 → 왼쪽 → … , 그다음 뒷줄 */
function slotSeq(cols) {
  const out = [];
  const order = [0];
  for (let k = 1; order.length < cols; k++) { order.push(k); if (order.length < cols) order.push(-k); }
  for (let row = 0; row < 64; row++) for (const c of order) out.push({ col: c, row });
  return out;
}

/**
 * @param nodes    Map 또는 배열 — VoxelView._present 모양({id,parentId,kind,status,order,projectId?,rootSessionId?,meta?})
 * @param roots    [{nodeId, projectId}]
 * @param projects 프로젝트 항목
 * @param prev     이전 결과(자리 고정)
 * @param opts     { showInactive=false, nowMs }
 */
export function computeCampus(nodes, roots, projects, prev, opts = {}) {
  const showInactive = !!opts.showInactive;
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  let map = nodes instanceof Map ? nodes : new Map([...(nodes || [])].filter((n) => n && n.id).map((n) => [n.id, n]));
  // 독립 기동기는 사무실에선 띄운 세션 팀장 방의 복합기로 둔다(기동기가 팀장인 빈 사무실을 만들지 않게)
  if ([...map.values()].some(isDetachedRoot)) {
    const m2 = new Map(map);
    for (const n of map.values()) {
      if (!isDetachedRoot(n)) continue;
      const host = (n.rootSessionId && map.has('s:' + n.rootSessionId) && 's:' + n.rootSessionId) || (map.has(n.meta.spawnedBy) && n.meta.spawnedBy) || null;
      if (host && host !== n.id) m2.set(n.id, { ...n, parentId: host });
    }
    map = m2;
  }
  // assignRoots 는 _order 로 정렬하므로 order 를 넘겨 준다
  for (const n of map.values()) if (n._order == null && Number.isFinite(n.order)) n._order = n.order;
  const { roots: R, subtrees, byId } = assignRoots(map, roots);
  const projById = new Map();
  for (const p of projects || []) { const q = normProject(p, nowMs); if (q) projById.set(q.projectId, q); }

  const prevOff = (prev && prev.officeByMain) || new Map();
  const prevMainOrder = (prev && prev.mainOrder) || new Map();
  const officeByMain = new Map();
  const hidden = new Set();
  const projectOf = new Map();

  // 1-0. 독립 claude -p 루트: 메인 없는 빈 사무실을 만들지 않는다. 추정 소속(likelyMain) 메인이 보이면 그 사무실 앞 벽 대기석(guest),
  //      아니면 그 프로젝트 동 한쪽 '외부 작업' 구역(팀장 책상 없는 방, 독립 루트들이 직원 책상에)으로
  const plan = orphanPlan(R, byId);
  const isHiddenRoot = (id) => { const n = byId.get(id); return isRecentRoot(n) && !showInactive; };
  const guests = new Map();   // host → [orphanRootId]
  const externals = new Map(); // projectId → [orphanRootId]
  for (const [oid, pl] of plan) {
    if (isHiddenRoot(oid)) continue;
    if (pl.mode === 'guest' && !isHiddenRoot(pl.host)) { if (!guests.has(pl.host)) guests.set(pl.host, []); guests.get(pl.host).push(oid); }
    else { const pid = R.find((x) => x.nodeId === oid).projectId; if (!externals.has(pid)) externals.set(pid, []); externals.get(pid).push(oid); }
  }
  const planned = new Set([...[...guests.values()].flat(), ...[...externals.values()].flat()]);
  const withOrphans = (list, ids, patch) => {
    for (const oid of ids) for (const n of subtrees.get(oid).values()) list.push(n.id === oid ? { ...n, ...patch } : n);
    return list;
  };

  // 1. 메인별 사무실(지역)
  const byProj = new Map();
  for (const r of R) {
    const rootNode = byId.get(r.nodeId);
    const sub = subtrees.get(r.nodeId);
    for (const id of sub.keys()) projectOf.set(id, r.projectId);
    if (planned.has(r.nodeId)) continue;
    const recent = isRecentRoot(rootNode);
    if (recent && !showInactive) { for (const id of sub.keys()) hidden.add(id); continue; }
    const g = guests.get(r.nodeId) || [];
    for (const oid of g) for (const id of subtrees.get(oid).keys()) projectOf.set(id, r.projectId);
    const lay = computeOffice(withOrphans([...sub.values()], g, { parentId: r.nodeId, guest: true }), r.nodeId, prevOff.get(r.nodeId));
    if (recent) for (const room of lay.rooms) room.recent = true; // 끝난 루트 사무실은 흐리게
    let act = 0;
    for (const n of sub.values()) act = Math.max(act, tsOf(n.lastActivityAt));
    if (!byProj.has(r.projectId)) byProj.set(r.projectId, []);
    byProj.get(r.projectId).push({ mainId: r.nodeId, layout: lay, act, recent, status: rootNode && rootNode.status, busy: !!(rootNode && rootNode.meta && rootNode.meta.liveStatus === 'busy') });
  }
  for (const [pid, ids] of externals) {
    const vid = 'ext:' + pid;
    const list = withOrphans([{ id: vid, parentId: null, kind: 'main', virtual: true, status: 'active', order: -1, meta: {} }], ids, { parentId: vid, external: true });
    const lay = computeOffice(list, vid, prevOff.get(vid));
    let act = 0, busy = false, live = false;
    for (const oid of ids) {
      const n = byId.get(oid);
      busy = busy || !!(n.meta && n.meta.liveStatus === 'busy');
      live = live || n.status === 'active';
      for (const m of subtrees.get(oid).values()) act = Math.max(act, tsOf(m.lastActivityAt));
    }
    if (!byProj.has(pid)) byProj.set(pid, []);
    byProj.get(pid).push({ mainId: vid, layout: lay, act, recent: false, external: true, status: live ? 'active' : 'idle', busy });
  }

  // 2. 동 목록: 사무실이 있는 프로젝트 + 루트가 없는 live/recent 프로젝트(지붕 덮은 낮은 상자)
  const pids = new Set(byProj.keys());
  for (const q of projById.values()) if (!q.temp && (q.live || q.recent)) pids.add(q.projectId);
  for (const r of R) if (hidden.has(r.nodeId)) pids.add(r.projectId);
  const buildings = [];
  for (const pid of pids) {
    const q = projById.get(pid) || { projectId: pid, name: pid, live: false, active: false, busy: false, temp: false, recent: false, sessions: 0 };
    const offs = (byProj.get(pid) || []).slice();
    // 현재 메인(전체 보기 섬 중심과 같은 판정)의 사무실이 동의 첫 자리(앞줄 기준 사무실)
    const curM = currentMain(offs.map((o) => ({ nodeId: o.mainId, act: o.act, external: !!o.external })), (projects || []).find((p) => p && p.projectId === pid));
    const curId = curM ? curM.nodeId : null;
    offs.sort((a, b) => {
      if (!!a.external !== !!b.external) return a.external ? 1 : -1; // 외부 작업 구역은 동 끝
      if ((a.mainId === curId) !== (b.mainId === curId)) return a.mainId === curId ? -1 : 1;
      const pa = prevMainOrder.has(a.mainId) ? prevMainOrder.get(a.mainId) : Infinity;
      const pb = prevMainOrder.has(b.mainId) ? prevMainOrder.get(b.mainId) : Infinity;
      if (pa !== pb) return pa < pb ? -1 : 1;
      return (b.act - a.act) || (a.mainId < b.mainId ? -1 : 1);
    });
    // live 메인이 둘 이상이면 라운지 배치
    const liveIds = liveMainSids((projects || []).find((p) => p && p.projectId === pid)).map((x) => 's:' + x);
    const liveOffs = liveIds.map((id) => offs.find((o) => o.mainId === id && !o.external)).filter(Boolean);
    let lounge = null;
    // 동 안: 첫 사무실 지역 좌표 그대로(오프셋 0), 다음 사무실은 앞 사무실 오른쪽 끝 + 4
    // 한 줄에 OFFICES_PER_ROW 개까지, 넘치면 그 줄의 가장 뒤(별관 포함)보다 4 뒤에 다음 줄(동이 한쪽으로 길게 늘어지지 않게)
    let cursor = null, rowZ = 0, rowMinZ = Infinity, inRow = 0;
    const offices = [];
    let bminX = Infinity, bmaxX = -Infinity, bminZ = Infinity, bmaxZ = -Infinity;
    if (liveOffs.length >= 2) {
      const plan = loungePlan(liveOffs, offs.filter((o) => !liveOffs.includes(o)));
      lounge = { ...plan.lounge, mains: liveOffs.map((o) => o.mainId) };
      bminX = lounge.minX; bmaxX = lounge.maxX; bminZ = lounge.minZ; bmaxZ = lounge.maxZ;
      for (const { o, offset, role, rot } of plan.out) {
        const b = o.layout.bounds;
        if (role === 'wing') for (const r of o.layout.rooms) r.past = true; // 날개(지난 메인·외부 작업) = 불 꺼짐
        if (role === 'live') for (const r of o.layout.rooms) { r.lounge = true; if (!r.xf) r.xf = { k: 0, px: 0, pz: 0 }; } // 문패를 문 위에
        offices.push({ mainId: o.mainId, layout: o.layout, offset, role, rot: rot || 0 });
        bminX = Math.min(bminX, offset.x + b.minX); bmaxX = Math.max(bmaxX, offset.x + b.maxX);
        bminZ = Math.min(bminZ, offset.z + b.minZ); bmaxZ = Math.max(bmaxZ, offset.z + b.maxZ);
      }
    }
    for (const o of lounge ? [] : offs) {
      const b = o.layout.bounds;
      if (inRow >= OFFICES_PER_ROW) { rowZ = rowMinZ - OFFICE_GAP - b.maxZ; cursor = null; inRow = 0; rowMinZ = Infinity; }
      const ox = cursor == null ? 0 : cursor + OFFICE_GAP - b.minX;
      cursor = ox + b.maxX;
      inRow++;
      offices.push({ mainId: o.mainId, layout: o.layout, offset: { x: ox, z: rowZ } });
      rowMinZ = Math.min(rowMinZ, rowZ + b.minZ);
      bminX = Math.min(bminX, ox + b.minX); bmaxX = Math.max(bmaxX, ox + b.maxX);
      bminZ = Math.min(bminZ, rowZ + b.minZ); bmaxZ = Math.max(bmaxZ, rowZ + b.maxZ);
    }
    const recentBox = !offices.length;
    if (recentBox) { bminX = -RECENT_BOX.w / 2; bmaxX = RECENT_BOX.w / 2; bminZ = -RECENT_BOX.d / 2; bmaxZ = RECENT_BOX.d / 2; }
    buildings.push({
      projectId: pid, name: q.name, temp: q.temp,
      live: q.live || offs.some((o) => !o.recent),
      active: q.active || offs.some((o) => o.status === 'active'),
      busy: q.busy || offs.some((o) => o.busy),
      recent: recentBox,
      sessions: q.sessions || offs.length,
      liveSessions: q.liveSessions || offs.length,
      offices, lounge,
      local: { minX: bminX - BLDG_PAD, maxX: bmaxX + BLDG_PAD, minZ: bminZ - BLDG_PAD, maxZ: bmaxZ + BLDG_PAD },
      _act: Math.max(0, ...offs.map((o) => o.act)),
    });
  }

  // 3. 동 자리(격자): 열마다 폭 = 그 열 가장 넓은 동 + 12, 행마다 깊이 = 그 행 가장 깊은 동 + 12.
  //    이전 슬롯 유지, 새 동은 활성 먼저 앞줄 가운데부터 빈 슬롯
  // opts.view(가용 영역 비율·카메라 범위)가 있으면 열 수를 맞춤 배율 최대로, 비율이 25% 넘게 바뀌면 슬롯을 새로
  const view = opts.view && opts.view.aspect > 0 ? opts.view : null;
  const repack = !!(view && prev && needRepack(prev.packAspect, view.aspect));
  const prevSlot = new Map((repack ? [] : (prev && prev.buildings) || []).map((b) => [b.projectId, b.slot]));
  const prevIdx = new Map(((prev && prev.buildings) || []).map((b, i) => [b.projectId, i]));
  const used = new Set();
  const key = (s) => s.col + ',' + s.row;
  const kept = buildings.filter((b) => prevSlot.has(b.projectId)).sort((a, b) => prevIdx.get(a.projectId) - prevIdx.get(b.projectId));
  const fresh = buildings.filter((b) => !prevSlot.has(b.projectId));
  const rank = (b) => (b.recent ? 3 : b.active ? 0 : b.live ? 1 : 2);
  fresh.sort((a, b) => (rank(a) - rank(b)) || ((a.temp ? 1 : 0) - (b.temp ? 1 : 0)) || (b._act - a._act) || (a.projectId < b.projectId ? -1 : 1));
  const cols = view ? chooseGridCols(buildings.map((b) => ({ w: b.local.maxX - b.local.minX, d: b.local.maxZ - b.local.minZ })), view, { gap: BLDG_GAP })
    : Math.max(1, Math.min(4, Math.ceil(Math.sqrt(buildings.length))));
  const seq = slotSeq(cols);
  for (const b of kept) { const s = prevSlot.get(b.projectId); if (!used.has(key(s))) { b.slot = { col: s.col, row: s.row }; used.add(key(s)); } else fresh.unshift(b); }
  for (const b of fresh) { const s = seq.find((x) => !used.has(key(x))); b.slot = { col: s.col, row: s.row }; used.add(key(s)); }
  // 슬롯 → 동 원점. (0,0) 슬롯의 동은 원점 그대로(첫 사무실 오프셋 0), 나머지는 열·행 가운데에 동 경계 상자 가운데를 맞춘다
  const W = (b) => b.local.maxX - b.local.minX, D = (b) => b.local.maxZ - b.local.minZ;
  const pg = (!repack && prev && prev.grid) || {};
  const hw = new Map(), hd = new Map();
  for (const b of buildings) {
    hw.set(b.slot.col, Math.max(hw.get(b.slot.col) || 0, W(b) / 2 + BLDG_GAP / 2, (pg.hw && pg.hw[b.slot.col]) || 0));
    hd.set(b.slot.row, Math.max(hd.get(b.slot.row) || 0, D(b) / 2 + BLDG_GAP / 2, (pg.hd && pg.hd[b.slot.row]) || 0));
  }
  const b00 = buildings.find((b) => b.slot.col === 0 && b.slot.row === 0);
  // 열 0·행 0 범위: (0,0) 동이 한쪽으로 치우쳐 있으면 그 범위까지
  const c0 = { lo: -(hw.get(0) || 0), hi: hw.get(0) || 0 }, r0 = { lo: -(hd.get(0) || 0), hi: hd.get(0) || 0 };
  if (b00) { c0.lo = Math.min(c0.lo, b00.local.minX - BLDG_GAP / 2); c0.hi = Math.max(c0.hi, b00.local.maxX + BLDG_GAP / 2); r0.lo = Math.min(r0.lo, b00.local.minZ - BLDG_GAP / 2); r0.hi = Math.max(r0.hi, b00.local.maxZ + BLDG_GAP / 2); }
  const colC = new Map([[0, (c0.lo + c0.hi) / 2]]), rowC = new Map([[0, (r0.lo + r0.hi) / 2]]);
  const cols_ = [...hw.keys()], rows_ = [...hd.keys()];
  let edge = c0.hi;
  for (let c = 1; c <= Math.max(0, ...cols_); c++) { const h = hw.get(c) || 0; colC.set(c, edge + h); edge += 2 * h; }
  edge = c0.lo;
  for (let c = -1; c >= Math.min(0, ...cols_); c--) { const h = hw.get(c) || 0; colC.set(c, edge - h); edge -= 2 * h; }
  edge = r0.lo; // 뒷줄은 -z 로
  for (let r = 1; r <= Math.max(0, ...rows_); r++) { const h = hd.get(r) || 0; rowC.set(r, edge - h); edge -= 2 * h; }
  for (const b of buildings) {
    if (b === b00) b.origin = { x: 0, z: 0 };
    else b.origin = { x: colC.get(b.slot.col) - (b.local.minX + b.local.maxX) / 2, z: rowC.get(b.slot.row) - (b.local.minZ + b.local.maxZ) / 2 };
  }
  const grid = { hw: Object.fromEntries(hw), hd: Object.fromEntries(hd), colW: Math.max(0, ...[...hw.values()].map((x) => 2 * x)), rowD: Math.max(0, ...[...hd.values()].map((x) => 2 * x)) };
  // 안전장치: 그래도 겹치면 이웃을 바깥으로 민다
  const B = (b) => ({ minX: b.origin.x + b.local.minX, maxX: b.origin.x + b.local.maxX, minZ: b.origin.z + b.local.minZ, maxZ: b.origin.z + b.local.maxZ });
  const order = [...buildings].sort((a, b) => (a.slot.row - b.slot.row) || (Math.abs(a.slot.col) - Math.abs(b.slot.col)) || (a.slot.col - b.slot.col));
  const settled = [];
  for (const b of order) {
    let guard = 0;
    while (guard++ < 200) {
      const bb = B(b);
      const hit = settled.find((o) => { const ob = B(o); return bb.minX < ob.maxX + BLDG_GAP / 2 && bb.maxX > ob.minX - BLDG_GAP / 2 && bb.minZ < ob.maxZ + BLDG_GAP / 2 && bb.maxZ > ob.minZ - BLDG_GAP / 2; });
      if (!hit) break;
      const sx = b.slot.col === 0 ? 0 : Math.sign(b.slot.col);
      if (sx) b.origin.x += sx * 4; else b.origin.z -= 4;
    }
    settled.push(b);
  }

  // 4. 전역 좌표로 합치기
  const out = { rooms: [], seat: new Map(), machine: new Map(), corridors: [], roomOf: new Map(), rootId: null, bounds: null,
    buildings: [], roots: new Set(), officeByMain, mainOrder: new Map(), grid, hidden, projectOf, campus: true, lounges: [] };
  if (view) { const fresh0 = repack || !(prev && prev.packAspect > 0); out.packAspect = fresh0 ? view.aspect : prev.packAspect; out.packSeq = ((prev && prev.packSeq) || 0) + (fresh0 ? 1 : 0); }
  const bb = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const firstActive = [...buildings].sort((a, b) => (rank(a) - rank(b)) || ((a.temp ? 1 : 0) - (b.temp ? 1 : 0)) || (b._act - a._act))[0];
  for (const b of buildings) {
    b.offices.forEach((o, i) => {
      out.mainOrder.set(o.mainId, i);
      translateOffice(o.layout, b.origin.x + o.offset.x, b.origin.z + o.offset.z);
      officeByMain.set(o.mainId, o.layout);
      out.roots.add(o.mainId);
      for (const r of o.layout.rooms) { r.projectId = b.projectId; r.projectName = b.name; out.rooms.push(r); }
      for (const [k, v] of o.layout.seat) out.seat.set(k, v);
      for (const [k, v] of o.layout.machine) out.machine.set(k, v);
      for (const [k, v] of o.layout.roomOf) out.roomOf.set(k, v);
      for (const c of o.layout.corridors) out.corridors.push(c);
    });
    if (b.lounge) {
      // 라운지 전역 좌표
      const L = b.lounge, ox = b.origin.x, oz = b.origin.z;
      b.lounge = { id: 'lounge:' + b.projectId, projectId: b.projectId, mains: L.mains, minX: L.minX + ox, maxX: L.maxX + ox, minZ: L.minZ + oz, maxZ: L.maxZ + oz,
        cabinet: { x: L.cabinet.x + ox, z: L.cabinet.z + oz }, spots: L.spots.map((s) => ({ x: s.x + ox, z: s.z + oz, face: s.face })) };
      out.lounges.push(b.lounge);
    }
    const g = B(b);
    b.bounds = g;
    b.center = { x: (g.minX + g.maxX) / 2, z: (g.minZ + g.maxZ) / 2 };
    b.size = { w: g.maxX - g.minX, d: g.maxZ - g.minZ };
    bb.minX = Math.min(bb.minX, g.minX); bb.maxX = Math.max(bb.maxX, g.maxX); bb.minZ = Math.min(bb.minZ, g.minZ); bb.maxZ = Math.max(bb.maxZ, g.maxZ);
    delete b._act;
    out.buildings.push(b);
  }
  if (firstActive && firstActive.offices.length) out.rootId = firstActive.offices[0].mainId;
  else if (R.length) out.rootId = R[0].nodeId;
  out.bounds = Number.isFinite(bb.minX) ? bb : { minX: -12, maxX: 12, minZ: -9, maxZ: 9 };
  return out;
}
