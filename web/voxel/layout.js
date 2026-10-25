// 복셀 오피스 배치 — three 를 import 하지 않는 순수 함수(node 시험 대상).
//
// 좌표: 단위 1 ≈ 1m, 바닥 y=0. 방(Room) 원점은 기본 크기 방의 중심이다.
//   사무실 24×18: 뒤 벽 z=-9, 앞 z=+9(+ext), 왼쪽 x=-12, 오른쪽 x=+12. 책상 줄이 늘면 앞쪽(ext)으로만 커진다.
//   회의실 16×12: 뒤 z=-6, 앞 z=+6(+ext).
// face(방향): 캐릭터가 바라보는 쪽의 yaw. 0 = +z(앞·카메라 쪽), π = -z(뒤 벽), -π/2 = -x(왼쪽 벽), +π/2 = +x.

import { isLauncher, isCycle, isEndedSt, isRunner } from '../batch-core.mjs';
import { mapSeatLike, quarter } from './xf.mjs';

const PI = Math.PI;
export const OFFICE = { w: 24, d: 18 };
export const MEETING = { w: 16, d: 12 };
export const DESK_XS = [-6, -2, 2, 6];
export const DESK_Z0 = -2;
export const ROW_STEP = 3.5;
export const BASE_ROWS = 3;
export const SEAT_BACK = 0.75;          // 책상 중심 → 앉은 자리(의자) 거리
export const LEAD_DESK = { x: 0, z: -6.5 };
const AUX_OFF = [[1.5, 0], [-1.5, 0], [1.5, 1.6], [-1.5, 1.6]];
const AUX_MAX = 4;
const RACK_X0 = 3, RACK_DX = 0.9, RACK_PER_ROW = 8, RACK_Z0 = -8.4, RACK_DZ = 1.4;
const SCREEN_Z = [-5.4, -3.8, -2.2, -0.6], SCREEN_Y = [0.78, 1.48];
const MEET_SEAT_X = [-4.5, -2.7, -0.9, 0.9, 2.7, 4.5];
const MEET_TABLE_STEP = 4.2;
const ROW_GAP = 12;               // 별관 줄 사이 간격
const STEP_X = 28, STEP_X_MEET = 46;
export const DOOR_X = 7.8;        // 출입문 중심(앞 오른쪽)
export const MEET_DOOR_X = 5;

export const SEAT_KINDS = ['lead', 'grid', 'aux', 'meet', 'op', 'wait'];
// 배치 장치(기동기): 첫 자리 = 팀장 책상 바로 오른쪽 옆 장비(— 팀장이 자기 책상에서 기동기를 끼고 팀을 지휘).
// 회차·그 하위(자리 종류 'op' = 자율 루프 팀원)는 장치 앞에 붙어 서지 않고 팀원 책상에 앉는다 — 장치에 가까운 앞줄부터.
export const BATCH_SPOTS = [{ x: 2.25, z: -6.7 }, { x: -2.7, z: -7.9 }, { x: -6.6, z: -5.2 }, { x: 5.6, z: -5.2 }];
export const OP_OFF = [[0, 1.3], [-1.25, 1.7], [1.25, 1.7], [0, 2.6], [-1.25, 2.9], [1.25, 2.9]]; // (예전 작업석 자리 — 이제 쓰지 않음, 호환용)
// 추정 소속으로 들어온 독립 claude -p: 앞 벽 쪽 대기석(포털·벨 사이)
export const WAIT_XS = [-4.5, -3.2, -1.9, -0.6, 0.7, 2.0];
export const WAIT_Z = 7.9;
const KNOWN = new Set(['main', 'subagent', 'workflow', 'workflow-agent', 'claude-p', 'bash-bg', 'monitor']);

/** cat → 시설 이름(props.js 가 같은 이름으로 그림). write·edit·other 는 자기 책상. */
export const CAT_FACILITY = {
  read: 'shelf', search: 'files', artifact: 'board', skill: 'toolbox', web: 'antenna', shell: 'terminal',
  mcp: 'kiosk', monitor: 'screens', agent: 'portal', workflow: 'portal', notify: 'bell',
};
export const DESK_CATS = new Set(['write', 'edit']);

const line = (x, z, dx, dz, n) => Array.from({ length: n }, (_, i) => ({ x: x + dx * i, z: z + dz * i }));
// 사무실 시설 접근점(지역 좌표). front:true 는 앞쪽 시설이라 ext 만큼 민다. inward = 대기 줄이 늘어서는 방향.
const OFFICE_ST = {
  read: { spots: line(-10.6, -5.4, 0, 0.9, 4), face: -PI / 2, inward: [1, 0] },
  search: { spots: line(-10.5, 0.6, 0, 0.9, 3), face: -PI / 2, inward: [1, 0] },
  artifact: { spots: line(-10.6, 4.6, 0, 0.9, 2), face: -PI / 2, inward: [1, 0] },
  skill: { spots: line(-9.45, -7.8, 0.9, 0, 2), face: PI, inward: [0, 1] },
  web: { spots: line(-5.9, -7.8, 0.9, 0, 3), face: PI, inward: [0, 1] },
  shell: { spots: line(10.4, 1.1, 0, 0.9, 3), face: PI / 2, inward: [-1, 0] },
  mcp: { spots: line(10.4, 4.6, 0, 0.9, 2), face: PI / 2, inward: [-1, 0] },
  monitor: { spots: line(10.0, -4.8, 0, 1.5, 3), face: PI / 2, inward: [-1, 0] },
  agent: { spots: line(-7.9, 6.8, 0.9, 0, 3), face: 0, front: true, inward: [0, -1] },
  notify: { spots: line(3.55, 6.9, 0.9, 0, 2), face: 0, front: true, inward: [0, -1] },
};
OFFICE_ST.workflow = OFFICE_ST.agent;
// 회의실은 작은 세트만(책장·서류함·터미널·도구 상자)
const MEET_ST = {
  read: { spots: line(-6.6, -4.4, 0, 0.9, 2), face: -PI / 2, inward: [1, 0] },
  search: { spots: line(-6.6, 1.2, 0, 0.9, 2), face: -PI / 2, inward: [1, 0] },
  shell: { spots: line(6.6, -2.6, 0, 0.9, 2), face: PI / 2, inward: [-1, 0] },
  skill: { spots: line(-5.45, -4.8, 0.9, 0, 2), face: PI, inward: [0, 1] },
};

const cmpOrder = (a, b) => {
  const oa = Number.isFinite(a.order) ? a.order : Infinity, ob = Number.isFinite(b.order) ? b.order : Infinity;
  if (oa !== ob) return oa < ob ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

function toList(nodesIn) {
  const arr = [];
  if (!nodesIn) return arr;
  const it = nodesIn instanceof Map ? nodesIn.values() : nodesIn;
  for (const n of it) if (n && n.id) arr.push(n);
  return arr;
}

/** 두 책상이 겹치는지(책상 1.4×0.8 + 의자) */
const deskClash = (ax, az, bx, bz) => Math.abs(ax - bx) < 1.5 && Math.abs(az - bz) < 1.1;
function nearGrid(lx, lz) {
  const r = Math.max(0, Math.round((lz - DESK_Z0) / ROW_STEP));
  for (const rr of [r - 1, r, r + 1]) {
    if (rr < 0) continue;
    const gz = DESK_Z0 + rr * ROW_STEP;
    for (const gx of DESK_XS) if (deskClash(lx, lz, gx, gz)) return true;
  }
  return false;
}

/**
 * @param nodes  Map 또는 배열: {id, parentId, kind, order?, status?}. View 가 "자리에 있는" 노드만 넘긴다(퇴장해 반납한 노드는 빼고).
 * @param rootId 루트 노드 id(없으면 main 또는 부모 없는 첫 노드)
 * @param prev   이전 결과(OfficeLayout) — 자리 고정에 쓴다
 * @returns OfficeLayout { rooms, seat, machine, corridors, roomOf, rootId, bounds }
 */
export function computeOffice(nodesIn, rootId, prev) {
  const list = toList(nodesIn).slice().sort(cmpOrder);
  const byId = new Map(list.map((n) => [n.id, n]));
  const out = { rooms: [], seat: new Map(), machine: new Map(), corridors: [], roomOf: new Map(), rootId: null, bounds: { minX: -12, maxX: 12, minZ: -9, maxZ: 9 } };
  if (!list.length) return out;

  let root = rootId && byId.has(rootId) ? rootId : null;
  if (!root) { const m = list.find((n) => n.kind === 'main'); root = m ? m.id : null; }
  if (!root) { const m = list.find((n) => !n.parentId || !byId.has(n.parentId)); root = m ? m.id : list[0].id; }
  out.rootId = root;

  const kindOf = (n) => (KNOWN.has(n.kind) ? n.kind : 'subagent');
  const parentOf = (n) => {
    if (n.id === root) return null;
    return n.parentId && n.parentId !== n.id && byId.has(n.parentId) ? n.parentId : root;
  };
  // 팀장(자기 사무실): 루트·메인·claude -p. 단 기동기 회차·추정 소속 손님(guest)·외부 작업(external)은 메인 사무실 직원
  const isLead = (n) => n.id === root || ((kindOf(n) === 'main' || kindOf(n) === 'claude-p') && !n.guest && !n.external && !isCycle(n, byId));
  const isBatch = (n) => kindOf(n) === 'bash-bg' && isLauncher(n);
  // 구역: 회차(+하위) → 그 장치 앞 작업석, 손님(+하위) → 대기석
  const zoneOf = (n) => {
    let cur = n, guard = 0;
    while (cur && guard++ < 64) {
      if (cur.guest) return { type: 'wait', head: cur.id };
      if (isCycle(cur, byId)) {
        let p = byId.get(cur.parentId);
        if (p && isRunner(p)) p = byId.get(p.parentId); // 재기동기 → 러너 → 회차: 회차 자리는 재기동기(장치) 앞
        if (p && isLauncher(p)) return { type: 'op', launcher: p.id, head: cur.id };
      }
      const p = parentOf(cur);
      if (!p) return null;
      const pn = byId.get(p);
      if (!pn || isLead(pn)) return null;
      cur = pn;
    }
    return null;
  };
  const sessMemo = new Map();
  const sessionOf = (n) => {
    if (isLead(n)) return n.id;
    if (sessMemo.has(n.id)) return sessMemo.get(n.id);
    let cur = n, guard = 0, res = root;
    while (cur && guard++ < 64) {
      const p = parentOf(cur);
      if (!p) { res = root; break; }
      const pn = byId.get(p);
      if (isLead(pn)) { res = pn.id; break; }
      cur = pn;
    }
    sessMemo.set(n.id, res);
    return res;
  };
  // claude-p 중첩 깊이(자기 포함 조상 중 claude-p 수, 루트 제외)
  const pdMemo = new Map();
  const pdOf = (leadId) => {
    if (pdMemo.has(leadId)) return pdMemo.get(leadId);
    let d = 0, cur = byId.get(leadId), guard = 0;
    while (cur && guard++ < 64) {
      if (cur.id !== root && kindOf(cur) === 'claude-p') d++;
      const p = parentOf(cur); cur = p ? byId.get(p) : null;
    }
    pdMemo.set(leadId, d);
    return d;
  };

  // ---- 방 만들기 ----
  const prevSeat = prev && prev.seat instanceof Map ? prev.seat : new Map();
  const prevMach = prev && prev.machine instanceof Map ? prev.machine : new Map();
  const offices = new Map();   // leadId → room
  const meetings = new Map();  // workflowId → room
  const leads = list.filter(isLead);
  for (const L of leads) {
    offices.set(L.id, {
      id: 'o:' + L.id, type: 'office', ownerId: L.id, pd: pdOf(L.id), order: L.order, members: [], machines: [], meetings: [],
      seatsLocal: [], ext: 0, external: !!L.virtual,
    });
  }
  for (const n of list) {
    if (isLead(n) || kindOf(n) !== 'workflow') continue;
    const off = offices.get(sessionOf(n)) || offices.get(root);
    const r = { id: 'm:' + n.id, type: 'meeting', ownerId: n.id, office: off, order: n.order, members: [], seatsLocal: [], ext: 0 };
    meetings.set(n.id, r);
    off.meetings.push(r);
  }
  for (const n of list) {
    if (isLead(n)) continue;
    const k = kindOf(n);
    if (k === 'workflow') continue;
    if (k === 'bash-bg' || k === 'monitor') { (offices.get(sessionOf(n)) || offices.get(root)).machines.push(n); continue; }
    const p = parentOf(n);
    if (k === 'workflow-agent' && p && meetings.has(p)) { meetings.get(p).members.push(n); continue; }
    (offices.get(sessionOf(n)) || offices.get(root)).members.push(n);
  }

  // ---- 사무실 자리(지역 좌표) ----
  const localSeat = new Map(); // id → {room, kind, lx, lz, deskX, deskZ, face, slot?}
  for (const off of offices.values()) {
    const lead = { room: off, kind: 'lead', lx: LEAD_DESK.x, lz: LEAD_DESK.z - SEAT_BACK, deskX: LEAD_DESK.x, deskZ: LEAD_DESK.z, face: 0 };
    localSeat.set(off.ownerId, lead);
    off.stools = [];
    // 배치 장치 자리(이전 자리 유지)
    const bslot = new Map(), bused = new Set(), brest = [];
    for (const n of off.machines) {
      if (!isBatch(n)) continue;
      const pm = prevMach.get(n.id);
      if (pm && pm.roomId === off.id && pm.type === 'batch' && !bused.has(pm.slot)) { bused.add(pm.slot); bslot.set(n.id, pm.slot); } else brest.push(n);
    }
    for (const n of brest) { let k = 0; while (bused.has(k)) k++; bused.add(k); bslot.set(n.id, k); }
    const spotOf = (k) => BATCH_SPOTS[k] || { x: -6 + 2.2 * (k - BATCH_SPOTS.length), z: -3.9 };
    // 구역 자리: 장치 앞 작업석(진행 중 회차가 맨 앞 가운데) · 앞 벽 대기석
    const zoned = new Map(); // key → [n]
    const plain = [];
    for (const n of off.members) {
      const z = zoneOf(n);
      const key = z ? (z.type === 'op' ? 'op:' + z.launcher : 'wait') : null;
      if (key && (z.type !== 'op' || bslot.has(z.launcher))) { if (!zoned.has(key)) zoned.set(key, []); zoned.get(key).push(n); } else plain.push(n);
    }
    const opList = []; // 자율 루프 팀원(회차·하위) → 아래에서 팀원 책상
    for (const [key, arr] of zoned) {
      arr.sort((a, b) => ((isEndedSt(a.status) ? 1 : 0) - (isEndedSt(b.status) ? 1 : 0)) || ((isCycle(a, byId) ? 0 : 1) - (isCycle(b, byId) ? 0 : 1)) || cmpOrder(a, b));
      if (key !== 'wait') { opList.push(...arr.map((n) => [n, spotOf(bslot.get(key.slice(3)))])); continue; }
      const spots = WAIT_XS.map((x) => ({ x, z: WAIT_Z, face: 0, front: true }));
      arr.forEach((n, i) => {
        const sp = spots[i];
        if (!sp) { plain.push(n); return; }
        const kind = key === 'wait' ? 'wait' : 'op';
        localSeat.set(n.id, { room: off, kind, lx: sp.x, lz: sp.z, deskX: sp.x, deskZ: sp.z, face: sp.face, front: !!sp.front, slot: i });
        off.stools.push({ x: sp.x, z: sp.z, front: !!sp.front, kind });
      });
    }
    off.batchSlot = bslot; off.batchSpot = spotOf;
    const taken = []; // [{x,z}] 책상 중심
    const auxCount = new Map();
    const take = (n, kind, dx, dz, parent) => {
      const s = { room: off, kind, lx: dx, lz: dz - SEAT_BACK, deskX: dx, deskZ: dz, face: 0, parent: parent || null };
      localSeat.set(n.id, s); taken.push({ x: dx, z: dz });
      if (parent) auxCount.set(parent, (auxCount.get(parent) || 0) + 1);
      return s;
    };
    const free = (dx, dz) => !taken.some((t) => deskClash(dx, dz, t.x, t.z));
    // 자율 루프 팀원: 진행 중 회차가 먼저 장치에 가장 가까운 앞줄 책상, 그다음 하위·끝난 회차는 이전 책상(비었으면) 또는 가까운 빈 책상
    const opNearest = (n, sp) => {
      const xs = [...DESK_XS].sort((a, b) => Math.abs(a - sp.x) - Math.abs(b - sp.x) || a - b);
      for (let r = 0; r < 200; r++) {
        const dz = DESK_Z0 + r * ROW_STEP;
        for (const dx of xs) if (free(dx, dz)) { take(n, 'op', dx, dz); return; }
      }
    };
    const liveCycle = (n) => isCycle(n, byId) && !isEndedSt(n.status);
    for (const [n, sp] of opList) if (liveCycle(n)) opNearest(n, sp);
    for (const ended of [false, true]) for (const [n, sp] of opList) {
      if (liveCycle(n) || isEndedSt(n.status) !== ended) continue;
      const ps = prevSeat.get(n.id);
      if (ps && ps.roomId === off.id && ps.kind === 'op' && Number.isFinite(ps.deskLX) && free(ps.deskLX, ps.deskLZ)) take(n, 'op', ps.deskLX, ps.deskLZ);
      else opNearest(n, sp);
    }
    const rest = [];
    for (const n of plain) {
      const ps = prevSeat.get(n.id);
      if (ps && ps.roomId === off.id && (ps.kind === 'grid' || ps.kind === 'aux') && Number.isFinite(ps.deskLX) && free(ps.deskLX, ps.deskLZ)) {
        take(n, ps.kind, ps.deskLX, ps.deskLZ, ps.kind === 'aux' ? ps.parent : null);
      } else rest.push(n);
    }
    for (const n of rest) {
      let placed = false;
      const p = parentOf(n);
      const pseat = p ? localSeat.get(p) : null;
      if (pseat && pseat.room === off && (pseat.kind === 'grid' || pseat.kind === 'aux') && (auxCount.get(p) || 0) < AUX_MAX) {
        for (const [ox, oz] of AUX_OFF) {
          const dx = pseat.deskX + ox, dz = pseat.deskZ + oz;
          if (dx < -10.2 || dx > 9.2 || dz < -3.5) continue;
          if (nearGrid(dx, dz) || !free(dx, dz)) continue;
          take(n, 'aux', dx, dz, p); placed = true; break;
        }
      }
      if (placed) continue;
      for (let r = 0; r < 200 && !placed; r++) {
        const dz = DESK_Z0 + r * ROW_STEP;
        for (const dx of DESK_XS) if (free(dx, dz)) { take(n, 'grid', dx, dz); placed = true; break; }
      }
    }
    let maxDeskZ = DESK_Z0 + (BASE_ROWS - 1) * ROW_STEP;
    for (const t of taken) maxDeskZ = Math.max(maxDeskZ, t.z);
    off.rows = Math.max(BASE_ROWS, Math.ceil((maxDeskZ - DESK_Z0) / ROW_STEP - 1e-6) + 1);
    off.ext = (off.rows - BASE_ROWS) * ROW_STEP;
    off.takenDesks = taken;

    // 기계: 서버랙(bash-bg)·모니터 벽(monitor)
    const slots = { rack: new Set(), screen: new Set() };
    const mrest = [];
    for (const n of off.machines) {
      if (isBatch(n)) { localSeat.set(n.id, { room: off, kind: 'batch', slot: bslot.get(n.id) }); continue; }
      const type = kindOf(n) === 'bash-bg' ? 'rack' : 'screen';
      // 재무장 Monitor는 앞 것의 화면 자리를 그대로 잇는다
      const pm = prevMach.get(n.id) || (n.meta && n.meta.rearmOf ? prevMach.get(n.meta.rearmOf) : null);
      if (pm && pm.roomId === off.id && pm.type === type && !slots[type].has(pm.slot)) { slots[type].add(pm.slot); localSeat.set(n.id, { room: off, kind: type, slot: pm.slot }); }
      else mrest.push([n, type]);
    }
    for (const [n, type] of mrest) {
      let s = 0; while (slots[type].has(s)) s++;
      slots[type].add(s); localSeat.set(n.id, { room: off, kind: type, slot: s });
    }
  }
  // ---- 회의실 자리 ----
  for (const m of meetings.values()) {
    const used = new Set();
    const rest = [];
    for (const n of m.members) {
      const ps = prevSeat.get(n.id);
      if (ps && ps.roomId === m.id && ps.kind === 'meet' && !used.has(ps.slot)) { used.add(ps.slot); localSeat.set(n.id, meetSeat(m, ps.slot)); }
      else rest.push(n);
    }
    for (const n of rest) { let s = 0; while (used.has(s)) s++; used.add(s); localSeat.set(n.id, meetSeat(m, s)); }
    const maxSlot = used.size ? Math.max(...used) : 0;
    m.tables = Math.max(1, Math.floor(maxSlot / 12) + 1);
    m.ext = (m.tables - 1) * MEET_TABLE_STEP;
  }

  // ---- 방 배치(월드 좌표) ----
  const rows = new Map();
  for (const off of offices.values()) { if (!rows.has(off.pd)) rows.set(off.pd, []); rows.get(off.pd).push(off); }
  const pds = [...rows.keys()].sort((a, b) => a - b);
  let prevZ = 0, first = true;
  for (const pd of pds) {
    const row = rows.get(pd);
    for (const off of row) {
      const L = byId.get(off.ownerId);
      const pp = parentOf(L);
      const parentOff = pp ? offices.get(sessionOf(byId.get(pp))) : null;
      off.sortX = parentOff && parentOff.origin ? parentOff.origin.x : 0;
    }
    row.sort((a, b) => (a.sortX - b.sortX) || cmpOrder({ id: a.ownerId, order: a.order }, { id: b.ownerId, order: b.order }));
    const hasMeet = row.some((o) => o.meetings.length);
    const step = hasMeet ? STEP_X_MEET : STEP_X;
    // 회의실 쌓기(지역 z) 먼저 → 줄의 앞쪽 범위
    let front = 0;
    for (const off of row) {
      off.meetings.sort((a, b) => cmpOrder({ id: a.ownerId, order: a.order }, { id: b.ownerId, order: b.order }));
      let mz = -OFFICE.d / 2 + MEETING.d / 2; // 회의실 뒤 벽을 사무실 뒤 벽에 맞춤
      for (const m of off.meetings) { m.localZ = mz; mz += MEETING.d + m.ext + 2; }
      const meetFront = off.meetings.length ? Math.max(...off.meetings.map((m) => m.localZ + MEETING.d / 2 + m.ext)) : 0;
      front = Math.max(front, OFFICE.d / 2 + off.ext, meetFront);
    }
    const z = first ? 0 : prevZ - OFFICE.d / 2 - ROW_GAP - front;
    first = false;
    row.forEach((off, i) => {
      off.origin = { x: row.length === 1 && pd === 0 ? 0 : step * (i - (row.length - 1) / 2), z };
      for (const m of off.meetings) m.origin = { x: off.origin.x + OFFICE.w / 2 + 2 + MEETING.w / 2, z: z + m.localZ };
    });
    prevZ = z;
  }

  // ---- 결과 방 객체 ----
  const roomOut = new Map();
  const mkStations = (defs, origin, ext) => {
    const st = {}, qu = {};
    for (const [cat, d] of Object.entries(defs)) {
      const dz = d.front ? ext : 0;
      st[cat] = d.spots.map((p) => ({ x: origin.x + p.x, z: origin.z + p.z + dz, face: d.face }));
      const s0 = d.spots[0];
      qu[cat] = [0, 1, 2].map((k) => {
        const b = d.spots[k % d.spots.length] || s0;
        return { x: origin.x + b.x + d.inward[0] * 1.0, z: origin.z + b.z + dz + d.inward[1] * 1.0, face: d.face };
      });
    }
    return { stations: st, queues: qu };
  };
  for (const off of offices.values()) {
    const o = off.origin;
    const { stations, queues } = mkStations(OFFICE_ST, o, off.ext);
    const frontZ = OFFICE.d / 2 + off.ext;
    const desks = [];
    for (let r = 0; r < off.rows; r++) for (const dx of DESK_XS) desks.push({ x: o.x + dx, z: o.z + DESK_Z0 + r * ROW_STEP, face: 0, aux: false, occupant: null });
    const room = {
      id: off.id, type: 'office', ownerId: off.ownerId, pd: off.pd,
      origin: { x: o.x, z: o.z }, size: { w: OFFICE.w, d: OFFICE.d + off.ext }, ext: off.ext, rows: off.rows,
      leadDesk: off.external ? null : { x: o.x + LEAD_DESK.x, z: o.z + LEAD_DESK.z, face: 0 },
      external: off.external, batches: [],
      stools: off.stools.map((t) => ({ x: o.x + t.x, z: o.z + t.z + (t.front ? off.ext : 0), kind: t.kind })),
      desks, stations, queues,
      door: { x: o.x + DOOR_X, z: o.z + frontZ - 0.7, out: { x: o.x + DOOR_X, z: o.z + frontZ + 0.8 } },
      portal: { x: o.x - 7, z: o.z + 8.2 + off.ext, spawn: { x: o.x - 7, z: o.z + 7.3 + off.ext } },
      bell: { x: o.x + 4, z: o.z + 8.2 + off.ext },
      racks: [], screens: [], board: null,
      aisles: [o.z + LEAD_DESK.z + 2.0, ...Array.from({ length: off.rows }, (_, r) => o.z + DESK_Z0 + r * ROW_STEP + 1.7)],
      bounds: { minX: o.x - OFFICE.w / 2, maxX: o.x + OFFICE.w / 2, minZ: o.z - OFFICE.d / 2, maxZ: o.z + frontZ },
      backDoor: false, leftDoor: null,
    };
    roomOut.set(off.id, room);
  }
  for (const m of meetings.values()) {
    const o = m.origin;
    const { stations, queues } = mkStations(MEET_ST, o, m.ext);
    const frontZ = MEETING.d / 2 + m.ext;
    const tables = Array.from({ length: m.tables }, (_, t) => ({ x: o.x, z: o.z + t * MEET_TABLE_STEP }));
    const room = {
      id: m.id, type: 'meeting', ownerId: m.ownerId, officeId: m.office.id, pd: m.office.pd,
      origin: { x: o.x, z: o.z }, size: { w: MEETING.w, d: MEETING.d + m.ext }, ext: m.ext,
      leadDesk: null, desks: [], tables, stations, queues,
      door: { x: o.x + MEET_DOOR_X, z: o.z + frontZ - 0.7, out: { x: o.x + MEET_DOOR_X, z: o.z + frontZ + 0.8 } },
      portal: null, bell: null, racks: [], screens: [],
      board: { x: o.x + 1.5, z: o.z - MEETING.d / 2 + 0.35 },
      aisles: tables.flatMap((t) => [t.z - 2.3, t.z + 2.3]),
      bounds: { minX: o.x - MEETING.w / 2, maxX: o.x + MEETING.w / 2, minZ: o.z - MEETING.d / 2, maxZ: o.z + frontZ },
      backDoor: false, leftDoor: o.z + 3.5,
    };
    roomOut.set(m.id, room);
  }

  // ---- 자리 → 월드 ----
  for (const [id, s] of localSeat) {
    const room = roomOut.get(s.room.id);
    const o = room.origin;
    out.roomOf.set(id, room.id);
    if (s.kind === 'batch') {
      const sp = s.room.batchSpot(s.slot);
      const x = o.x + sp.x, z = o.z + sp.z;
      room.batches.push({ x, z, nodeId: id });
      out.machine.set(id, { roomId: room.id, x, y: 0, z, type: 'batch', slot: s.slot, face: 0 });
      continue;
    }
    if (s.kind === 'rack' || s.kind === 'screen') {
      let x, y = 0, z;
      if (s.kind === 'rack') {
        const r = Math.floor(s.slot / RACK_PER_ROW), c = s.slot % RACK_PER_ROW;
        x = o.x + RACK_X0 + c * RACK_DX; z = o.z + RACK_Z0 + r * RACK_DZ;
        room.racks.push({ x, z, nodeId: id });
      } else {
        const g = Math.floor(s.slot / 8), w = s.slot % 8;
        const tier = Math.floor(w / 4), c = w % 4;
        x = o.x + 11.75 - g * 1.0; y = SCREEN_Y[tier]; z = o.z + SCREEN_Z[c];
        room.screens.push({ x, y, z, nodeId: id });
      }
      out.machine.set(id, { roomId: room.id, x, y, z, type: s.kind, slot: s.slot, face: s.kind === 'rack' ? 0 : -PI / 2 });
      continue;
    }
    const fz = s.front ? room.ext : 0; // 앞 벽 대기석은 방이 앞으로 커진 만큼 민다
    const seat = {
      roomId: room.id, kind: s.kind, x: o.x + s.lx, z: o.z + s.lz + fz, face: s.face,
      deskX: o.x + s.deskX, deskZ: o.z + s.deskZ + fz, deskLX: s.deskX, deskLZ: s.deskZ, lx: s.lx, lz: s.lz,
      slot: s.slot ?? null, parent: s.parent || null, exit: s.kind === 'meet' ? 'back' : 'front',
    };
    out.seat.set(id, seat);
    if (s.kind === 'grid' || s.kind === 'aux' || s.kind === 'op') {
      const d = s.kind !== 'aux' ? room.desks.find((dd) => Math.abs(dd.x - seat.deskX) < 1e-6 && Math.abs(dd.z - seat.deskZ) < 1e-6) : null;
      if (d) d.occupant = id;
      else room.desks.push({ x: seat.deskX, z: seat.deskZ, face: 0, aux: true, occupant: id });
    }
  }
  // 워크플로 화이트보드
  for (const m of meetings.values()) {
    const room = roomOut.get(m.id);
    out.machine.set(m.ownerId, { roomId: m.id, x: room.board.x, y: 1.3, z: room.board.z, type: 'board', slot: 0, face: 0 });
    out.roomOf.set(m.ownerId, m.id);
  }

  // ---- 통로 ----
  for (const off of offices.values()) {
    if (off.ownerId === root) continue;
    const L = byId.get(off.ownerId);
    const pp = parentOf(L);
    const pRoomId = pp ? out.roomOf.get(pp) : null;
    const pRoom = roomOut.get(pRoomId) || roomOut.get('o:' + root);
    const aRoom = roomOut.get(off.id);
    if (!pRoom || !aRoom || pRoom === aRoom) continue;
    pRoom.backDoor = true;
    const from = { x: pRoom.origin.x, z: pRoom.bounds.minZ };
    const to = { x: aRoom.door.out.x, z: aRoom.bounds.maxZ };
    const midZ = (from.z + to.z) / 2;
    out.corridors.push({ from: pRoom.id, to: aRoom.id, path: dedupe([from, { x: from.x, z: midZ }, { x: to.x, z: midZ }, to]) });
  }
  for (const m of meetings.values()) {
    const room = roomOut.get(m.id), offR = roomOut.get(m.office.id);
    const zc = Math.max(offR.bounds.minZ + 1, Math.min(offR.bounds.maxZ - 1, room.leftDoor));
    const xr = offR.bounds.maxX, xm = room.bounds.minX;
    out.corridors.push({ from: offR.id, to: room.id, path: dedupe([{ x: xr, z: zc }, { x: xr + 1, z: zc }, { x: xr + 1, z: room.leftDoor }, { x: xm, z: room.leftDoor }]) });
  }

  // 결정적 순서: 사무실(pd, x) → 회의실
  const roomsArr = [...roomOut.values()];
  roomsArr.sort((a, b) => (a.type === b.type ? 0 : a.type === 'office' ? -1 : 1) || (a.pd - b.pd) || (a.origin.x - b.origin.x) || (a.origin.z - b.origin.z) || (a.id < b.id ? -1 : 1));
  out.rooms = roomsArr;
  const bb = out.bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const r of roomsArr) { bb.minX = Math.min(bb.minX, r.bounds.minX); bb.maxX = Math.max(bb.maxX, r.bounds.maxX); bb.minZ = Math.min(bb.minZ, r.bounds.minZ); bb.maxZ = Math.max(bb.maxZ, r.bounds.maxZ); }
  return out;
}

function meetSeat(m, slot) {
  const table = Math.floor(slot / 12), j = slot % 12;
  const side = j < 6 ? 0 : 1, col = j % 6;
  const tz = table * MEET_TABLE_STEP;
  const lz = side === 0 ? tz - 1.3 : tz + 1.3;
  return { room: m, kind: 'meet', lx: MEET_SEAT_X[col], lz, deskX: MEET_SEAT_X[col], deskZ: tz, face: side === 0 ? 0 : PI, slot };
}

/** n 번째 사람이 설 cat 시설 자리. 접근점 2～4 개 → 대기 자리 3 개 → null(제자리 작업) */
export function stationFor(cat, room, n = 0) {
  if (!room || !room.stations) return null;
  const s = room.stations[cat];
  if (!s) return null;
  if (n < s.length) return s[n];
  const q = room.queues[cat];
  if (q && n - s.length < q.length) return q[n - s.length];
  return null;
}

function dedupe(pts) {
  const r = [];
  for (const p of pts) {
    const l = r[r.length - 1];
    if (!l || Math.abs(l.x - p.x) > 1e-6 || Math.abs(l.z - p.z) > 1e-6) r.push({ x: p.x, z: p.z });
  }
  return r;
}

function exitOf(p, other) {
  if (!p || !p.kind) return [];
  if (p.kind === 'grid' || p.kind === 'aux' || p.kind === 'lead') {
    const s = other.x >= p.x ? 1 : -1;
    const side = p.x + (p.kind === 'lead' ? 1.5 : 1.1) * s;
    const front = p.deskZ + (p.kind === 'lead' ? 2.0 : 1.7);
    return [{ x: side, z: p.z }, { x: side, z: front }];
  }
  if (p.kind === 'meet') return [{ x: p.x, z: p.z - 0.9 * Math.cos(p.face || 0) }];
  return [];
}

/**
 * a → b 꺾은선(가로·세로만). a·b 는 {x,z} 이고, 자리(seat)면 kind(lead|grid|aux|meet)·deskZ·face 를 가진다.
 * 책상 자리는 옆으로 나와 책상 앞 통로(책상 z + 1.7)를 지나고, 시설끼리는 가장 가까운 통로 줄을 쓴다.
 */
export function pathBetween(a, b, room) {
  // 돌린 방: 지역(회전 전) 좌표에서 길을 찾고 세계로 되돌린다 — 책상 앞 통로·문 쪽 규칙이 그대로 맞는다
  const xf = room && room.xf;
  if (xf && quarter(xf.k) && room.local) {
    const k = quarter(xf.k);
    const pts = pathBetween(mapSeatLike(a, -k, xf.px, xf.pz), mapSeatLike(b, -k, xf.px, xf.pz), room.local);
    return pts.map((p) => { const q = mapSeatLike(p, k, xf.px, xf.pz); return { x: q.x, z: q.z }; });
  }
  const ea = exitOf(a, b), eb = exitOf(b, a);
  const pts = [a, ...ea];
  const A = pts[pts.length - 1];
  const B = eb.length ? eb[eb.length - 1] : b;
  if (ea.length) pts.push({ x: B.x, z: A.z });
  else if (eb.length) pts.push({ x: A.x, z: B.z });
  else if (Math.abs(A.x - B.x) > 1e-6 && Math.abs(A.z - B.z) > 1e-6) {
    const Z = nearestAisle(A.z, room);
    pts.push({ x: A.x, z: Z }, { x: B.x, z: Z });
  }
  for (let i = eb.length - 1; i >= 0; i--) pts.push(eb[i]);
  pts.push(b);
  const bd = room && room.bounds;
  const res = dedupe(pts);
  if (bd) for (const p of res) { p.x = Math.max(bd.minX - 1.2, Math.min(bd.maxX + 1.2, p.x)); p.z = Math.max(bd.minZ + 0.4, Math.min(bd.maxZ + 1.2, p.z)); }
  return res;
}

function nearestAisle(z, room) {
  const ai = room && room.aisles;
  if (!ai || !ai.length) return z;
  let best = ai[0];
  for (const a of ai) if (Math.abs(a - z) < Math.abs(best - z)) best = a;
  return best;
}

export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].z - pts[i - 1].z);
  return L;
}

/** 문자열 해시(결정적). 피부색·옆 오프셋 등에 쓴다 */
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  s = String(s || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
