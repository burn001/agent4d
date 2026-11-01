// 【모듈 규격 · 캐릭터·책상·지휘석 배치(characters) 담당】 연구동 배치 computeLab — 순수(three·DOM 없음), node --test 대상.
// 3D(lab-view.js)·2D(flat/lab2d.js) 가 같은 결과를 쓴다(같은 입력 → 같은 자리, 실시간·재생·3D⇄2D 동일).
//
// ┌ 입력 ───────────────────────────────────────────────────────────────────────────────────────────┐
// │ nodes: VoxelView._present() 결과 [{id, parentId, kind, status, order, startedAt, projectId, rootSessionId, meta, …}]     │
// │ rootId: 루트 노드 id(없으면 main → 부모 없는 첫 노드) · prev: 이전 결과(자리 고정) · opts: { rP }(플랫폼 반지름, 기본 9)   │
// │   opts 더: cx·cz(연구동 중심, 전체 보기 캠퍼스) · ixCatOf(id)→ix 범주(기자재 종류) · reserved(Set 고리 칸 — 퇴장 뒤 비워 둠) │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// ┌ 출력 = OfficeLayout 호환(VoxelView·Character·SpotBook·vx-holo 가 손대지 않고 돈다) ─────────────────────────────┐
// │ { lab:true, rooms:[room…](구역마다 하나), seat:Map id→seat, machine:Map id→pos, corridors:[], roomOf:Map id→roomId, rootId, bounds } │
// │ room: { id:'lab:'+구역 메인, type:'lab', ownerId, pd:0, origin:{x,z}(= 중심), size:{w,d}, ext:0, rows, bounds,          │
// │         leadDesk:{x,z,face,floorY}, desks:[{x,z,face,aux,occupant,row,k,theta}], stations:{cat:[spot]}, queues:{cat:[spot]}, │
// │         door:{x,z,out}, portal:{x,z,spawn,theta}, bell:{x,z}, racks:[], screens:[], bays:[], batches:[{x,z,nodeId}], board, │
// │         aisles:[], backDoor:false, leftDoor:null, stools:[], external:false,                                            │
// │         labLounge:{x,z,theta,r} · breakSlots:[spot] (탕비실 = 라운지) · client:{screen:{x,y,z}, spot:{x,z,face}}(브리지 통신 스크린) · │
// │         ixSpots:{github,db,remote,batch,tests → {x,y,z}} · oversee(desk{lx,lz}) → spot ·                          │
// │         navBoxes:[{minX,maxX,minZ,maxZ,kind}](세계, nav-core 가 그대로 씀, 구역 방끼리 같은 배열) · navSig · spotRoomId(공유 장부 열쇠), │
// │         lab:{ cx, cz, rP, rows, R:labRadii(…), bridge:bridgeFrame(…)(이 구역), bridges:[frame](모든 구역), zone, primary,    │
// │               zones:[{i,theta,half,ownerId}], doorTheta, loungeTheta, gangways:[θ], rimSlots:[{i,theta,x,z,face}],          │
// │               rigSlots:[{i,theta,x,z,face}], deskSlots:[[{row,k,theta,x,z}]](이 구역) } }                                │
// │ seat: { roomId, kind:'lead'|'grid'|'op'|'wait', x, z, face, deskX, deskZ, deskLX, deskLZ, lx, lz, slot, parent,          │
// │         row, k, floorY(브리지면 1.6), exit:'front', zone }                                                             │
// │ machine: { roomId, x, y, z, type:'rig'|'batch'|'board'|'job'(시료 카드 — vx-job-core 꼴), slot, face, theta?, rigKind? }  │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// 성능 상한: computeLab 60 노드 < 5ms(LAB_PERF.LAYOUT_MS_60). 길찾기 장애물(navBoxes) ≤ 2,000 상자.
// 다중 live 메인(설계, 결정 D3): 플랫폼 하나를 함께 쓰고 브리지를 원 둘레에 나눈다 — 메인 i 의 구역 각 = θ_B + i·360/n
//   (2 마주 봄·3 삼각·4 사분…, 상한 ZONE_MAX 6 — 넘는 메인은 기존 브리지 덱 옆 자리), 말굽 반폭 = min(120, (360/n − 20)/2).
//   방(room)은 구역마다 하나(id 'lab:'+메인, 같은 bounds·navBoxes·시설 공유, 자기 브리지·책상·통신 스크린). room.lab.primary = 첫 구역
//   (공유 그림 — 바닥·외벽·플랫폼·기자재 고리·시설 — 은 primary 방에서만 그린다). 출입문·라운지는 구역 사이 틈으로 옮긴다.
//   직원은 부모 사슬을 타고 올라가 만나는 메인의 구역 책상(그 구역이 차면 이웃 구역 빈 책상). 구역 각은 이전 결과의 구역 순서를 유지.
// 하위의 하위(부모가 책상에 앉은 서브에이전트)는 부모 책상 각에 가장 가까운 빈 책상. claude -p 는 직원 책상(3단계: 위성 연구실),
// 작업 노드(meta.job) = 기자재 앞 시료 카드(placeLabJobs, machine type 'job'), 워크플로 = 말굽 끝 바깥 화이트보드(2단계: 세미나 탁자).
import { LAB, polar, thetaOf, dTheta, faceIn, faceOut, labRadii, bridgeFrame, bridgeToWorld, worldToBridge, floorYAt, DEG } from './lab-const.mjs';
import { rigSlots, rigShelfSlots, assignRigSlots, rigKindOf } from './lab-rig-core.mjs';
import { isLauncher, isCycle } from '../batch-core.mjs';
import { isJob } from '../job-core.mjs';
import { placeJobs, JOBCARD } from '../voxel/vx-job-core.mjs';

const KNOWN = new Set(['main', 'subagent', 'workflow', 'workflow-agent', 'claude-p', 'bash-bg', 'monitor']);
const cmpOrder = (a, b) => {
  const oa = Number.isFinite(a.order) ? a.order : Infinity, ob = Number.isFinite(b.order) ? b.order : Infinity;
  if (oa !== ob) return oa < ob ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};
const toList = (nodesIn) => { const a = []; if (!nodesIn) return a; for (const n of nodesIn instanceof Map ? nodesIn.values() : nodesIn) if (n && n.id) a.push(n); return a; };

/** 다중 live 메인 구역 상한 · 구역 사이 틈(도) */
export const ZONE_MAX = 6;
export const ZONE_GAP = 20;

/** 구역 n 개(순수): [{i, theta(브리지 방위), half(말굽 반폭)}]. n = 1 이면 단일 세션 그대로(θ_B 225 · 반폭 120) */
export function labZones(n) {
  n = Math.max(1, Math.min(ZONE_MAX, n | 0));
  const half = n === 1 ? LAB.HORSESHOE_HALF : Math.min(LAB.HORSESHOE_HALF, (360 / n - ZONE_GAP) / 2);
  return Array.from({ length: n }, (_, i) => ({ i, theta: (LAB.BRIDGE_THETA + (i * 360) / n) % 360, half }));
}
/** 구역 사이 틈 방위(구역 i 와 i+1 사이). 단일 구역은 [] */
export function zoneGaps(zones) {
  const n = zones.length;
  return n < 2 ? [] : zones.map((z) => (z.theta + 180 / n) % 360);
}
/** 가장 가까운 틈(같은 거리면 시계 반대쪽 +). skip = 뺄 틈 */
function nearestGap(gaps, th, skip = null) {
  let best = null, bd = Infinity;
  for (const g of gaps) {
    if (skip != null && Math.abs(dTheta(g, skip)) < 1e-6) continue;
    const d = dTheta(th, g), a = Math.abs(d) - (d > 0 ? 1e-6 : 0);
    if (a < bd) { bd = a; best = g; }
  }
  return best;
}
/** 출입문 방위: 단일 = 45(카메라 쪽), 여럿 = 45 에 가장 가까운 구역 사이 틈 */
export function labDoorTheta(zones) { return zones.length < 2 ? LAB.FRONT.DOOR : nearestGap(zoneGaps(zones), LAB.FRONT.DOOR); }
/** 라운지(탕비실) 방위: 단일 = 15, 여럿 = 출입문 틈을 뺀 틈 가운데 15 에 가장 가까운 것 */
export function labLoungeTheta(zones) {
  if (zones.length < 2) return LAB.FRONT.LOUNGE;
  return nearestGap(zoneGaps(zones), LAB.FRONT.LOUNGE, labDoorTheta(zones));
}

/** 책상 자리 한 열(순수): 브리지 각 thetaB 에서 좌우 번갈아(0, +1, −1, +2, …), 말굽 반폭 half 안만 */
export function deskRow(cx, cz, rP, row, thetaB = LAB.BRIDGE_THETA, half = LAB.HORSESHOE_HALF) {
  const R = labRadii(rP, row + 1), r = R.rDesk[row], step = (LAB.DESK.ARC_GAP / r) / DEG;
  const out = [];
  const odd = row % 2 === 1; // 2열부터 반 칸 엇갈림(앞 사람 머리에 뒤 사람이 가리지 않게)
  const ds = odd ? [] : [0];
  for (let m = 1; m < 400; m++) { const a = (m - (odd ? 0.5 : 0)) * step; if (a > half) break; ds.push(a, -a); }
  for (const d of ds) {
    const th = (thetaB + d + 360) % 360, p = polar(cx, cz, r, th);
    out.push({ row, k: out.length, theta: th, x: p.x, z: p.z });
  }
  return out;
}

/** 플랫폼 가장자리 접근점(설계 — 안쪽 둘레길, 36칸, 중심을 봄) */
export function rimSlots(cx, cz, rP) {
  const n = LAB.PLATFORM.RIM_SLOTS, r = rP + LAB.INNER_WALK / 2, out = [];
  for (let i = 0; i < n; i++) { const th = (LAB.BRIDGE_THETA + (i * 360) / n) % 360, p = polar(cx, cz, r, th); out.push({ i, theta: th, x: p.x, z: p.z, face: faceIn(th) }); }
  return out;
}

/** 벽 쪽 시설 접근점 n 개 + 대기 줄 3(시설을 봄). r = 시설 반지름, inward = 시설이 벽 쪽(사람은 안쪽에 섬) */
function facility(cx, cz, r, th, n, { inward = true, gap = 0.9, back = 1.0 } = {}) {
  const sgn = inward ? -1 : 1, rs = r + sgn * back, face = inward ? faceOut(th) : faceIn(th);
  const spots = [], queue = [];
  for (let i = 0; i < n; i++) { const d = ((i - (n - 1) / 2) * gap / rs) / DEG, p = polar(cx, cz, rs, th + d); spots.push({ x: p.x, z: p.z, face }); }
  for (let k = 0; k < 3; k++) { const s = spots[k % n], a = thetaOf(cx, cz, s.x, s.z), rr = rs + sgn * (0.9 + 0.9 * Math.floor(k / n)), p = polar(cx, cz, rr, a); queue.push({ x: p.x, z: p.z, face }); }
  return { spots, queue };
}

// ───────────── 길찾기 장애물(nav-core roomObstacles 가 type 'lab' 이면 room.navBoxes 를 그대로 씀) ─────────────
const sq = (x, z, h, kind) => ({ minX: x - h, maxX: x + h, minZ: z - h, maxZ: z + h, kind });
/** 선분을 작은 정사각형 사슬로(축 정렬 상자만 받는 격자용) */
function segBoxes(out, a, b, half, kind, step = 0.25) {
  const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / step));
  for (let i = 0; i <= n; i++) { const u = i / n; out.push(sq(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u, half, kind)); }
}
/** 원판(가로 띠 상자, 원 안에 내접 — 상자 모서리가 원 밖으로 나가 둘레길 가장자리 칸을 막지 않게) */
function discBoxes(out, cx, cz, r, kind, strip = 0.25) {
  for (let z = -r; z < r - 1e-9; z += strip) {
    const zm = Math.max(Math.abs(z), Math.abs(Math.min(r, z + strip))), w = Math.sqrt(Math.max(0, r * r - zm * zm));
    if (w <= 1e-6) continue;
    out.push({ minX: cx - w, maxX: cx + w, minZ: cz + z, maxZ: cz + z + strip, kind });
  }
}
/** 브리지 난간(덱은 경사로로만 오르내림) · 콘솔 */
function bridgeBoxes(out, f) {
  const B = LAB.BRIDGE, hw = B.W / 2, hd = B.D / 2, t = B.RAIL_T, W = (u, v) => bridgeToWorld(f, u, v, {});
  segBoxes(out, W(hd, -hw), W(hd, hw), t, 'rail');                    // 뒤
  segBoxes(out, W(-hd, -hw), W(-hd, hw), t, 'rail');                  // 앞(플랫폼 쪽 낮은 유리)
  for (const s of [-1, 1]) {
    segBoxes(out, W(-hd + B.RAMP_W, s * hw), W(hd, s * hw), t, 'rail'); // 덱 끝(경사로 폭만 열림)
    segBoxes(out, W(-hd, s * hw), W(-hd, s * (hw + B.RAMP_L)), t, 'rail');                   // 경사로 안쪽 옆
    segBoxes(out, W(-hd + B.RAMP_W, s * hw), W(-hd + B.RAMP_W, s * (hw + B.RAMP_L)), t, 'rail'); // 경사로 바깥 옆
  }
  segBoxes(out, W(B.CONSOLE_U, -B.CONSOLE_W / 2), W(B.CONSOLE_U, B.CONSOLE_W / 2), B.CONSOLE_D / 2, 'console');
}
/** 경사로 축(길찾기 nav-core rampRoute): b = 바닥 쪽 끝(발치에서 RAMP_AXIS_EXT 바깥), t = 덱 쪽 끝(덱 안 RAMP_AXIS_EXT), lo·hi = 축 위 실제 경사로 구간 */
const RAMP_AXIS_EXT = 0.6;
export function rampAxis(f, s) {
  const B = LAB.BRIDGE, hw = B.W / 2, uc = -B.D / 2 + B.RAMP_W / 2, E = RAMP_AXIS_EXT;
  const b = bridgeToWorld(f, uc, s * (hw + B.RAMP_L + E), {}), t = bridgeToWorld(f, uc, s * (hw - E), {});
  const L = Math.hypot(t.x - b.x, t.z - b.z);
  return { b, t, dx: (t.x - b.x) / L, dz: (t.z - b.z) / L, lo: E, hi: E + B.RAMP_L, half: B.RAMP_W / 2, side: s };
}
/** 외벽 원(출입문 틈만) */
function wallBoxes(out, cx, cz, rW, doorTheta) {
  const n = Math.ceil((2 * Math.PI * rW) / 0.4), gap = ((LAB.WALL.DOOR_W / 2) / rW) / DEG;
  for (let i = 0; i < n; i++) {
    const th = (i * 360) / n;
    if (Math.abs(dTheta(doorTheta, th)) < gap) continue;
    const p = polar(cx, cz, rW + 0.06, th);
    out.push(sq(p.x, p.z, 0.22, 'wall'));
  }
}
/** 책상(가로 W, 깊이 D, 중심을 봄) — 접선 방향 정사각형 셋 */
function deskBoxes(out, cx, cz, d) {
  const th = d.theta * DEG, ex = Math.cos(th), ez = -Math.sin(th), h = LAB.DESK.D / 2;
  for (const s of [-0.65, 0, 0.65]) out.push(sq(d.x + ex * s, d.z + ez * s, h, 'desk'));
}

/** 브리지 덱 위 남는 메인 자리(구역 상한을 넘는 메인) — 통신 스크린(+v)을 피해 −v 쪽 */
const EXTRA_V = [-2.6, -4.0];

/**
 * @param nodesIn Map 또는 배열(_present 결과) · rootId · prev(이전 결과) · opts {rP}
 * @returns OfficeLayout 호환(파일 머리 주석)
 */
export function computeLab(nodesIn, rootId, prev = null, opts = {}) {
  const list = toList(nodesIn).slice().sort(cmpOrder);
  const byId = new Map(list.map((n) => [n.id, n]));
  const cx = Number.isFinite(opts.cx) ? opts.cx : 0, cz = Number.isFinite(opts.cz) ? opts.cz : 0, rP = opts.rP || LAB.PLATFORM.R_DEFAULT;
  const out = { lab: true, rooms: [], seat: new Map(), machine: new Map(), corridors: [], roomOf: new Map(), rootId: null, bounds: { minX: cx - 26, maxX: cx + 26, minZ: cz - 26, maxZ: cz + 26 } };
  if (!list.length) return out;
  let root = rootId && byId.has(rootId) ? rootId : null;
  if (!root) { const m = list.find((n) => n.kind === 'main'); root = m ? m.id : null; }
  if (!root) { const m = list.find((n) => !n.parentId || !byId.has(n.parentId)); root = m ? m.id : list[0].id; }
  out.rootId = root;
  const kindOf = (n) => (KNOWN.has(n.kind) ? n.kind : 'subagent');
  const prevSeat = prev && prev.seat instanceof Map ? prev.seat : new Map();
  const prevMach = prev && prev.machine instanceof Map ? prev.machine : new Map();

  // ---- 구역 머리(다중 live 메인): 이전 구역 순서 → (처음이면 루트 먼저) → 생성 순서 ----
  const prevZone = new Map();
  if (prev && prev.rooms) for (const r of prev.rooms) if (r && r.lab && Number.isFinite(r.lab.zone)) prevZone.set(r.ownerId, r.lab.zone);
  const others = list.filter((n) => n.id !== root && kindOf(n) === 'main' && !n.guest && !n.external && !isCycle(n, byId));
  // 이전 구역 번호가 있으면 그 순서를 그대로(루트 = 지금 활동 중인 메인이 바뀌어도 브리지가 서로 자리를 바꾸지 않게, QA 10.31.),
  // 처음 보는 메인만 뒤에 — 이전 결과가 없을 때는 루트가 0번
  const zk = (id) => (prevZone.has(id) ? prevZone.get(id) : Infinity);
  const ord = new Map(list.map((n, i) => [n.id, i]));
  const heads = [root, ...others.map((n) => n.id)];
  heads.sort((a, b) => {
    const za = zk(a), zb = zk(b);
    if (za !== zb) return za < zb ? -1 : 1;
    if (a === root) return -1;
    if (b === root) return 1;
    return ord.get(a) - ord.get(b);
  });
  const zoneHeads = heads.slice(0, ZONE_MAX), extraHeads = heads.slice(ZONE_MAX);
  const zones = labZones(zoneHeads.length);
  zones.forEach((z, i) => { z.ownerId = zoneHeads[i]; });
  const nZ = zones.length, headIdx = new Map(heads.map((h, i) => [h, i % nZ]));
  const zoneOf = (n) => { let cur = n, g = 0; while (cur && g++ < 64) { if (headIdx.has(cur.id)) return headIdx.get(cur.id); cur = byId.get(cur.parentId); } return 0; };

  // ---- 분류 ----
  const staff = [], ops = [], guests = [], rigs = [], batches = [], boards = [], jobList = [];
  for (const n of list) {
    if (headIdx.has(n.id)) continue;
    const k = kindOf(n);
    if (k === 'bash-bg' || k === 'monitor') {
      if (isJob(n)) { jobList.push(n); continue; }  // 기자재 앞 시료 카드(아래 placeLabJobs)
      if (k === 'bash-bg' && isLauncher(n)) batches.push(n); else rigs.push(n);
      continue;
    }
    if (k === 'workflow') { boards.push(n); continue; }
    if (n.guest) { guests.push(n); continue; }
    if (isCycle(n, byId) || (byId.get(n.parentId) && isCycle(byId.get(n.parentId), byId))) { ops.push(n); continue; }
    staff.push(n);
  }

  // ---- 책상 열 수(구역마다 필요한 열의 최대, 자리 고정: 이전 열 수보다 줄지 않음) ----
  const needZ = new Array(nZ).fill(0);
  for (const n of staff) needZ[zoneOf(n)]++;
  for (const n of ops) needZ[zoneOf(n)]++;
  const prevRows = (prev && prev.rooms && prev.rooms[0] && prev.rooms[0].rows) || 1;
  let rows = 1;
  for (const z of zones) {
    let r = 1, cap = 0;
    for (r = 1; r <= LAB.DESK.ROWS_MAX; r++) { cap += deskRow(cx, cz, rP, r - 1, z.theta, z.half).length; if (cap >= needZ[z.i]) break; }
    rows = Math.max(rows, Math.min(LAB.DESK.ROWS_MAX, r));
  }
  rows = Math.max(prevRows, rows);
  const R = labRadii(rP, rows);
  const bridges = zones.map((z) => bridgeFrame(cx, cz, R.rBridge, z.theta));
  const deskSlotsZ = zones.map((z) => Array.from({ length: rows }, (_, r) => deskRow(cx, cz, rP, r, z.theta, z.half)));
  const rW = R.rWall;
  const doorTh = labDoorTheta(zones), loungeTh = labLoungeTheta(zones), shift = doorTh - LAB.FRONT.DOOR;

  // ---- 공유 시설(구역 방끼리 같은 객체) — 출입문 쪽 시설은 출입문과 함께 돈다(shift) ----
  const B = LAB.BRIDGE, F = LAB.FRONT, FI = LAB.FRONT_IN;
  const door = polar(cx, cz, rW - 0.7, doorTh), doorOut = polar(cx, cz, rW + 0.8, doorTh);
  const portal = polar(cx, cz, rW - FI.PORTAL, F.PORTAL + shift), portalSpawn = polar(cx, cz, rW - FI.PORTAL - 0.9, F.PORTAL + shift);
  const stations = {}, queues = {};
  const put = (cat, f) => { stations[cat] = f.spots; queues[cat] = f.queue; };
  const b0 = zones[0].theta;
  put('skill', facility(cx, cz, rW - FI.TOOLBOX, F.TOOLBOX + shift, 2));     // 공구 카트(출입문 옆)
  put('mcp', facility(cx, cz, rW - FI.KIOSK, F.KIOSK + shift, 2));           // 외부 단말(출입문 옆)
  put('agent', facility(cx, cz, rW - FI.PORTAL, F.PORTAL + shift, 3));       // 에어록 포털
  stations.workflow = stations.agent; queues.workflow = queues.agent;
  put('artifact', facility(cx, cz, rP + 0.2, (LAB.RIM.BOARD[0] + LAB.RIM.BOARD[1]) / 2, 2, { inward: false })); // 산출물 반출대(플랫폼 앞)
  put('monitor', facility(cx, cz, rW - 1.2, b0 - 38, 3)); // 모니터 벽(첫 브리지 옆 외벽)
  put('notify', facility(cx, cz, R.rBridgeIn - 1.6, b0 + (nZ > 1 ? Math.min(34, 180 / nZ - 2) : 34), 2, { inward: false })); // 알림 벨 대(경사로 아래)
  put('web', facility(cx, cz, rP + 0.2, LAB.RIM.REMOTE[0] + 15, 2, { inward: false }));  // 원격 안테나 앞
  // 탕비실 = 라운지(단일 θ 15 · 여럿 = 출입문이 아닌 구역 사이 틈): 커피 카운터를 보는 6자리
  const lg = polar(cx, cz, rW - FI.LOUNGE, loungeTh);
  const labLounge = { x: lg.x, z: lg.z, theta: loungeTh, r: rW - FI.LOUNGE };
  const breakSlots = [];
  for (let i = 0; i < 6; i++) {
    const rr = rW - FI.LOUNGE - 1.0 - Math.floor(i / 2) * 0.9, th = loungeTh + (i % 2 ? 1 : -1) * ((0.5 / rr) / DEG), p = polar(cx, cz, rr, th);
    breakSlots.push({ x: p.x, z: p.z, face: faceOut(loungeTh), brk: true });
  }
  const core = { x: cx, y: LAB.PLATFORM.CORE_H, z: cz };
  const db = polar(cx, cz, rP - 0.8, (LAB.RIM.DB[0] + LAB.RIM.DB[1]) / 2), rem = polar(cx, cz, rP - 0.8, (LAB.RIM.REMOTE[0] + LAB.RIM.REMOTE[1]) / 2);
  const rimS = rimSlots(cx, cz, rP), rigS = rigSlots(cx, cz, rP);
  const navBoxes = [];
  const doorObj = { x: door.x, z: door.z, out: { x: doorOut.x, z: doorOut.z } };
  const portalObj = { x: portal.x, z: portal.z, spawn: { x: portalSpawn.x, z: portalSpawn.z }, theta: F.PORTAL + shift };

  // ---- 구역 방 ----
  const rooms = zones.map((z) => {
    const bridge = bridges[z.i], id = 'lab:' + z.ownerId;
    const cons = bridgeToWorld(bridge, B.CONSOLE_U, 0, {});
    const bellP = bridgeToWorld(bridge, -B.D / 2 + 0.6, B.W / 2 - 1.2, {});
    const scr = bridgeToWorld(bridge, B.D / 2 - 0.15, B.W / 2 - 2.0, {}), scs = bridgeToWorld(bridge, B.SEAT_U + 0.2, B.W / 2 - 2.0, {});
    const tst = bridgeToWorld(bridge, -B.D / 2 + 0.3, -B.W / 2 + 1.0, {});
    const room = {
      id, type: 'lab', ownerId: z.ownerId, pd: 0,
      origin: { x: cx, z: cz }, size: { w: 2 * rW, d: 2 * rW }, ext: 0, rows,
      bounds: { minX: cx - rW, maxX: cx + rW, minZ: cz - rW, maxZ: cz + rW },
      leadDesk: { x: cons.x, z: cons.z, face: bridge.yawIn, floorY: B.Y },
      desks: [], stations, queues,
      door: doorObj, portal: portalObj,
      bell: { x: bellP.x, z: bellP.z },
      racks: [], screens: [], bays: [], batches: [], board: null, aisles: [], backDoor: false, leftDoor: null, stools: [], external: false,
      labLounge, breakSlots,
      // 의뢰인 창구 = 그 구역 브리지 통신 스크린(덱 뒤 오른쪽)
      client: { screen: { x: scr.x, y: B.Y + 1.5, z: scr.z }, spot: { x: scs.x, z: scs.z, face: faceOut(z.theta), client: true } },
      // 특별 상호작용 은유 자리(→ 연구소). 시험 신호등만 구역 브리지
      ixSpots: { github: core, db: { x: db.x, y: 1.0, z: db.z }, remote: { x: rem.x, y: 1.0, z: rem.z }, batch: core, tests: { x: tst.x, y: B.Y + 1.55, z: tst.z } },
      navBoxes,
      lab: { cx, cz, rP, rows, R, bridge, bridges, zone: z.i, primary: z.i === 0, zones, doorTheta: doorTh, loungeTheta: loungeTh, gangways: LAB.GANGWAYS.slice(), rimSlots: rimS, rigSlots: rigS, deskSlots: deskSlotsZ[z.i] },
    };
    // 지휘·감독: 볼 팀원 책상 앞(플랫폼 쪽 1.25), 책상을 봄 — desk = {lx, lz}(방 지역 좌표). 없으면 자기 브리지 앞 난간
    room.oversee = (desk) => {
      if (!desk || !Number.isFinite(desk.lx) || !Number.isFinite(desk.lz)) { const p = bridgeToWorld(bridge, -B.D / 2 + 0.5, -1.6, {}); return { x: p.x, z: p.z, face: bridge.yawIn }; }
      const x = cx + desk.lx, zz = cz + desk.lz, th = thetaOf(cx, cz, x, zz), p = polar(cx, cz, Math.hypot(desk.lx, desk.lz) - 1.25, th);
      return { x: p.x, z: p.z, face: faceOut(th) };
    };
    return room;
  });
  for (const r of rooms) { r.spotRoomId = rooms[0].id; out.rooms.push(r); } // 시설·라운지 자리는 구역 방끼리 공유 — 자리 예약 장부(SpotBook) 열쇠
  out.bounds = { ...rooms[0].bounds };

  // ---- 팀장(구역마다 자기 브리지) ----
  for (const z of zones) {
    const room = rooms[z.i], bridge = bridges[z.i], cons = room.leadDesk, sp = bridgeToWorld(bridge, B.SEAT_U, 0, {});
    out.roomOf.set(z.ownerId, room.id);
    out.seat.set(z.ownerId, { roomId: room.id, kind: 'lead', x: sp.x, z: sp.z, face: bridge.yawIn, deskX: cons.x, deskZ: cons.z, deskLX: cons.x - cx, deskLZ: cons.z - cz, lx: sp.x - cx, lz: sp.z - cz, slot: null, parent: null, row: -1, k: -1, floorY: B.Y, exit: 'front', zone: z.i });
  }
  // 구역 상한을 넘는 메인: 기존 브리지 덱 위 콘솔 왼쪽 자리
  extraHeads.forEach((h, e) => {
    const zi = e % nZ, j = Math.floor(e / nZ);
    if (j >= EXTRA_V.length) return;
    const room = rooms[zi], sp = bridgeToWorld(bridges[zi], B.SEAT_U, EXTRA_V[j], {});
    out.roomOf.set(h, room.id);
    out.seat.set(h, { roomId: room.id, kind: 'lead', x: sp.x, z: sp.z, face: bridges[zi].yawIn, deskX: sp.x, deskZ: sp.z, deskLX: sp.x - cx, deskLZ: sp.z - cz, lx: sp.x - cx, lz: sp.z - cz, slot: j, parent: null, row: -1, k: -1, floorY: B.Y, exit: 'front', zone: zi, extra: true });
  });

  // ---- 책상 배정(자리 고정: 이전 (구역, row, k) 가 비었으면 그대로) ----
  const used = new Set(), key = (z, r, k) => z + ':' + r + ':' + k;
  const take = (n, kind, zi, s) => {
    used.add(key(zi, s.row, s.k));
    const room = rooms[zi], sp = polar(cx, cz, R.rSeat[s.row], s.theta), face = faceIn(s.theta);
    const ps = n.parentId && out.seat.get(n.parentId), parent = ps && ps.kind !== 'lead' ? n.parentId : null;
    out.seat.set(n.id, { roomId: room.id, kind, x: sp.x, z: sp.z, face, deskX: s.x, deskZ: s.z, deskLX: s.x - cx, deskLZ: s.z - cz, lx: sp.x - cx, lz: sp.z - cz, slot: null, parent, row: s.row, k: s.k, floorY: 0, exit: 'front', zone: zi });
    out.roomOf.set(n.id, room.id);
    room.desks.push({ x: s.x, z: s.z, face, aux: false, occupant: n.id, row: s.row, k: s.k, theta: s.theta });
  };
  const slotOf = (zi, r, k) => (deskSlotsZ[zi] && deskSlotsZ[zi][r] && deskSlotsZ[zi][r][k]) || null;
  const freeIn = (zi, pref) => {
    let best = null, bd = Infinity;
    for (const row of deskSlotsZ[zi]) for (const s of row) {
      if (used.has(key(zi, s.row, s.k))) continue;
      const d = pref == null ? s.row * 1000 + s.k : s.row * 1000 + Math.abs(dTheta(pref, s.theta));
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };
  /** 자기 구역 → 이웃 구역(가까운 순) 빈 책상 → [구역, 자리] | null */
  const firstFree = (zi, pref) => {
    const s0 = freeIn(zi, pref);
    if (s0) return [zi, s0];
    for (let d = 1; d <= nZ >> 1; d++) for (const z2 of [(zi + d) % nZ, (zi - d + nZ) % nZ]) { const s = freeIn(z2, null); if (s) return [z2, s]; }
    return null;
  };
  const seqThetaOf = (zi) => zones[zi].theta - ((B.W / 2 + 2.0) / R.rBridge) / DEG; // 시퀀서(기동기) 쪽 각
  const prefOf = (n, kind, zi) => {
    if (kind === 'op') return seqThetaOf(zi);
    const ps = n.parentId && out.seat.get(n.parentId); // 하위의 하위 = 부모 책상 각 가까이
    return ps && ps.kind !== 'lead' && ps.zone === zi ? thetaOf(cx, cz, ps.deskX, ps.deskZ) : null;
  };
  const place = (arr, kind) => {
    const rest = [];
    for (const n of arr) {
      const ps = prevSeat.get(n.id), pz = ps && Number.isFinite(ps.zone) ? ps.zone : 0;
      const s = ps && ps.kind === kind && rooms[pz] && ps.roomId === rooms[pz].id ? slotOf(pz, ps.row, ps.k) : null;
      if (s && !used.has(key(pz, s.row, s.k))) take(n, kind, pz, s); else rest.push(n);
    }
    for (const n of rest) { const zi = zoneOf(n), f = firstFree(zi, prefOf(n, kind, zi)); if (!f) break; take(n, kind, f[0], f[1]); }
  };
  place(ops, 'op');      // 자율 루프 회차 = 시퀀서에 가까운 1열 책상
  place(staff, 'grid');  // 팀원 = 브리지에 가까운 각부터 좌우 번갈아 · 하위의 하위 = 부모 책상 곁

  // ---- 손님 = 출입문 안 대기석(첫 구역 방) ----
  guests.forEach((n, i) => {
    if (i >= 6) return;
    const room = rooms[0], th = F.WAIT + shift + (i - 2.5) * ((0.9 / (rW - FI.WAIT)) / DEG), p = polar(cx, cz, rW - FI.WAIT, th);
    out.seat.set(n.id, { roomId: room.id, kind: 'wait', x: p.x, z: p.z, face: faceIn(th), deskX: p.x, deskZ: p.z, deskLX: p.x - cx, deskLZ: p.z - cz, lx: p.x - cx, lz: p.z - cz, slot: i, parent: null, row: -1, k: -1, floorY: 0, exit: 'front', zone: 0 });
    out.roomOf.set(n.id, room.id);
    room.stools.push({ x: p.x, z: p.z, kind: 'wait' });
  });

  // ---- 기동기·러너 = 자동 실험 시퀀서(띄운 메인 구역 브리지 −v 쪽 경사로 뒤 바닥) ----
  const bused = zones.map(() => new Set()), brest = [];
  // 자리는 slot 으로만 이어받고 좌표는 늘 다시 계산(전체 보기에서 연구동 중심이 옮겨 가도 맞게). 기자재 종류 = 시퀀서
  const putBatch = (n, zi, k) => {
    const p = bridgeToWorld(bridges[zi], 1.2, -(B.W / 2 + 1.4 + 2.0 * k), {});
    out.machine.set(n.id, { roomId: rooms[zi].id, x: p.x, y: 0, z: p.z, type: 'batch', slot: k, face: bridges[zi].yawIn, theta: thetaOf(cx, cz, p.x, p.z), rigKind: 'sequencer' });
  };
  for (const n of batches) {
    const zi = zoneOf(n), pm = prevMach.get(n.id);
    if (pm && pm.roomId === rooms[zi].id && pm.type === 'batch' && !bused[zi].has(pm.slot)) { bused[zi].add(pm.slot); putBatch(n, zi, pm.slot); } else brest.push(n);
  }
  for (const n of brest) { const zi = zoneOf(n); let k = 0; while (bused[zi].has(k)) k++; bused[zi].add(k); putBatch(n, zi, k); }
  for (const n of batches) { const m = out.machine.get(n.id), room = rooms.find((r) => r.id === m.roomId) || rooms[0]; out.roomOf.set(n.id, room.id); room.batches.push({ x: m.x, z: m.z, nodeId: n.id }); }

  // ---- 워크플로 = 말굽 끝 바깥 화이트보드(2단계 세미나 탁자). 여럿이면 구역 사이 틈 ----
  const bcount = zones.map(() => 0);
  for (const n of boards) {
    const zi = zoneOf(n), z = zones[zi], i = bcount[zi]++;
    const th = nZ === 1 ? (z.theta + z.half + 8 + i * 6) % 360 : (z.theta + z.half + ZONE_GAP / 2 + ((i % 3) - 1) * 5 + 360) % 360;
    const p = polar(cx, cz, R.rSeat[0] + 1.5 + (nZ === 1 ? 0 : Math.floor(i / 3) * 1.2), th);
    out.machine.set(n.id, { roomId: rooms[zi].id, x: p.x, y: 1.3, z: p.z, type: 'board', slot: i, face: faceIn(th) });
    out.roomOf.set(n.id, rooms[zi].id);
  }

  // ---- 기자재 고리(공유 자리, 주인 각 가까이) ----
  const ownerTheta = (n) => { const s = out.seat.get(n.parentId); return s ? thetaOf(cx, cz, s.x, s.z) : zones[zoneOf(n)].theta; };
  const prevRig = new Map();
  for (const n of rigs) { const pm = prevMach.get(n.id) || (n.meta && n.meta.rearmOf ? prevMach.get(n.meta.rearmOf) : null); if (pm && typeof pm.roomId === 'string' && pm.roomId.startsWith('lab:') && pm.type === 'rig') prevRig.set(n.id, pm.slot); }
  const reserved = opts.reserved instanceof Set ? opts.reserved : null;
  const rigIn = rigs.map((n) => ({ id: n.id, ownerTheta: ownerTheta(n) }));
  const asg = assignRigSlots(rigIn, rigS, prevRig, reserved);
  // 고리가 차면 보조 선반(0.6배, 12칸) — 그래도 넘치면 주인별 '+n'(room.lab.rigMore)
  const left = rigIn.filter((g) => !asg.has(g.id));
  const shelfS = left.length ? rigShelfSlots(cx, cz, rP) : [];
  const asgS = left.length ? assignRigSlots(left, shelfS, prevRig, reserved) : new Map();
  const ixCatOf = typeof opts.ixCatOf === 'function' ? opts.ixCatOf : null;
  const rigMore = new Map();
  for (const n of rigs) {
    const i = asg.has(n.id) ? asg.get(n.id) : asgS.get(n.id);
    const room = rooms[zoneOf(n)];
    if (i == null) { const o = n.parentId || room.ownerId; rigMore.set(o, (rigMore.get(o) || 0) + 1); continue; }
    const s = i >= 1000 ? shelfS.find((x) => x.i === i) : rigS[i], pm = prevMach.get(n.id);
    const kind = pm && pm.rigKind && pm.type === 'rig' ? pm.rigKind : rigKindOf(n, ixCatOf ? ixCatOf(n.id) : null);
    const pos = { roomId: room.id, x: s.x, y: 0, z: s.z, type: 'rig', slot: i, face: s.face, theta: s.theta, rigKind: kind };
    if (s.shelf) { pos.shelf = true; pos.scale = s.scale || 0.6; }
    out.machine.set(n.id, pos);
    out.roomOf.set(n.id, room.id);
  }
  for (const r of rooms) r.lab.rigMore = rigMore;

  // ---- 작업 노드(meta.job) = 주인 기자재 앞 시료 카드(vx-job-core placeJobs — 주인마다 8장). 길찾기 장애물 아님 ----
  if (jobList.length) placeLabJobs(jobList, out, prevMach, { cx, cz, bridges, rooms, rW });

  // ---- 길찾기 장애물(모든 구역 공유) ----
  const nb = navBoxes;
  discBoxes(nb, cx, cz, rP + 0.25, 'platform');
  for (const m of out.machine.values()) if (m.type === 'rig') nb.push(sq(m.x, m.z, m.shelf ? 0.42 : LAB.RIG.SIZE / 2, 'rig'));
  for (const m of out.machine.values()) if (m.type === 'batch') nb.push(sq(m.x, m.z, 0.8, 'batch'));
  for (const r of rooms) for (const d of r.desks) deskBoxes(nb, cx, cz, d);
  for (const f of bridges) bridgeBoxes(nb, f);
  wallBoxes(nb, cx, cz, rW, doorTh);
  const mach = [...out.machine.values()].filter((m) => m.type === 'rig' || m.type === 'batch').map((m) => m.type[0] + m.slot + (m.type === 'batch' ? '@' + m.roomId : '')).sort().join('.');
  const desksSig = rooms.map((r) => r.desks.map((d) => d.row + ':' + d.k).sort().join(',')).join('/');
  const navSig = [rP, rows, nZ, desksSig, mach].join('|');
  for (const r of rooms) r.navSig = navSig;
  // 브리지 덱·경사로 = 비싼 칸(길찾기 nav-core navSoftAt): 바닥 사람은 지름길로 덱을 넘지 않고, 팀장은 목적지가 덱이라 그대로 오른다
  const softAt = (x, z) => { for (const f of bridges) if (floorYAt(f, x, z) > 0.01) return true; return false; };
  for (const r of rooms) r.navSoftAt = softAt;
  // 경사로 축(nav-core rampRoute): 덱 ↔ 바닥 오르내림은 경사로 가운데 줄을 따라 곧게(격자 꺾은선 지그재그 없앰, 11.01.)
  const navRamps = [];
  for (const f of bridges) for (const s of [-1, 1]) navRamps.push(rampAxis(f, s));
  for (const r of rooms) r.navRamps = navRamps;
  return out;
}

/**
 * 연구소 시료 카드 자리: vx-job-core placeJobs 를 그대로 부르되 주인 자리를 연구소 모양으로
 *   기자재(rig)·시퀀서(batch + rigKind) = 기자재 앞(중심 쪽) 1.05m(보조 선반 0.7m) · 팀장 = 브리지 덱 콘솔 오른쪽(덱 높이) ·
 *   직원·대기석 = 책상 앞(중심 쪽). 주인이 자리에 없으면 카드도 없음(placeJobs 규칙).
 *   시퀀서 카드는 seqCardSpot 이 경사로·덱·시퀀서 몸체·외벽을 비켜 2D 칩 줄(d2)·필요하면 판 자리를 다시 정한다(이슈 5).
 */
function placeLabJobs(jobs, out, prevMach, { cx, cz, bridges, rooms, rW }) {
  const B = LAB.BRIDGE;
  const own = new Map();
  for (const [id, m] of out.machine) own.set(id, m.type === 'batch' && m.rigKind ? { ...m, type: 'rig' } : m);
  placeJobs(jobs, { seat: out.seat, machine: own, roomOf: out.roomOf }, prevMach);
  const seqSpot = new Map(); // 시퀀서 id → {d2} (판 그대로 · 2D 칩 줄만) | {x, z, face, d2} (판도 옮김) | null(그대로)
  for (const n of jobs) {
    const p = own.get(n.id);
    if (!p || p.type !== 'job') continue;
    const om = p.ownerType === 'rig' ? out.machine.get(p.owner) : null;
    if (om && om.type === 'batch' && om.rigKind) {
      if (!seqSpot.has(p.owner)) {
        const room = rooms.find((r) => r.id === om.roomId), f = room ? room.lab.bridge : null;
        const nb = [];
        for (const m of out.machine.values()) if (m !== om && m.type === 'batch' && m.roomId === om.roomId) nb.push(m);
        seqSpot.set(p.owner, f ? seqCardSpot(om, f, nb, rW, cx, cz) : null);
      }
      const q = seqSpot.get(p.owner);
      if (q && q.x == null) { p.d2 = q.d2; p.pole = 0; } // 3D 판은 앞 그대로(보이는 자리) · 2D 칩 줄만 시퀀서 뒤로
      else if (q) { p.x = q.x; p.z = q.z; p.face = q.face; p.d2 = q.d2; p.pole = 0; }
    }
    if (p.ownerType === 'lead' || p.ownerType === 'desk') {
      const s = out.seat.get(p.owner), f = s && s.kind === 'lead' ? bridges[s.zone] || bridges[0] : null;
      if (s && f) { // 팀장: 덱 위 콘솔 오른쪽(구역 상한을 넘는 메인은 자기 자리 앞)
        const v = s.extra ? ((s.x - f.c.x) * f.ev.x + (s.z - f.c.z) * f.ev.z) : B.CONSOLE_W / 2 + 0.7, q = bridgeToWorld(f, B.CONSOLE_U, v, {});
        p.x = q.x; p.z = q.z; p.y = B.Y + 0.95 + p.slot * JOBCARD.PITCH; p.face = f.yawIn;
      } else if (s) { // 직원 책상 앞(중심 쪽 0.8)
        const th = thetaOf(cx, cz, s.deskX, s.deskZ), q = polar(cx, cz, Math.max(0, Math.hypot(s.deskX - cx, s.deskZ - cz) - (LAB.DESK.D / 2 + 0.45)), th);
        p.x = q.x; p.z = q.z; p.y = (s.floorY || 0) + 0.95 + p.slot * JOBCARD.PITCH; p.face = faceIn(th);
      }
      p.pole = 0; p.d2 = 0.2;
    }
    out.machine.set(n.id, p);
  }
}

/** 시퀀서 몸체 반폭(접선)·반깊이(반지름 방향) — 원경 실루엣 1.76 × 1.24 · 길찾기 정사각 1.6 을 덮는 값 */
const SEQ_HW = 0.88, SEQ_HD = 0.8;

/**
 * 시퀀서 시료 카드 자리(이슈 5, 순수). 시퀀서는 브리지 −v 경사로 뒤(u 1.2)에 서고, jobAnchor 'rig' 대로 앞(중심 쪽 = −u) 1.05m 에 판을 두면
 * 2D 칩 줄(판 앞쪽으로 d2 + 칸 × CHIP)이 경사로(u −D/2 ～ −D/2 + RAMP_W) 위로 나간다. 칸 상한 MAX 장 기준(작업 수와 무관하게 자리 고정)으로
 * 판(3D 발자국 BOARD_W × 0.12, 경사로·덱 여유 0.1) · 칩(반경 0.12 + 0.05)이 경사로·덱·시퀀서 몸체(자기·이웃)·외벽(rW − 0.35)과
 * 겹치지 않는 첫 후보: 그대로 → (i) 판은 앞 그대로(3D 에서 시퀀서 몸체에 가리지 않게) · 2D 칩 줄만 몸체 뒤 끝 너머(d2 음수 —
 * 3D 판은 d2 를 안 씀) → (ii) 판도 시퀀서 뒤(+u, 판은 중심 쪽 그대로) → (iii) 바깥 옆(−v 1.0) →
 * (iv) 앞 자리에서 칩 줄만 경사로 반대쪽(+u)으로 민 자리(마지막 수단 — 이것도 ok 로 검사). 그대로가 맞거나 어느 후보도 안 맞으면 null
 * (그대로 = jobAnchor 'rig' 자리: 칩이 시퀀서 몸체 위로 그려지는 일은 없음).
 * @returns {{d2}|{x, z, face, d2}|null} — x 가 없으면 판 자리는 그대로(jobAnchor)이고 d2 만 바꿈
 * 모든 상자가 브리지 (u, v) 축에 나란하므로(판 face = 브리지 yawIn) 축 나란한 상자 겹침으로 본다.
 * @param m 시퀀서 자리(machine type 'batch') · f 그 구역 브리지 틀 · others 같은 방 다른 시퀀서들
 */
export function seqCardSpot(m, f, others, rW, cx, cz) { // export = 시험용(computeLab 안에서만 부름)
  const B = LAB.BRIDGE, C = JOBCARD, hb = C.BOARD_W / 2, hd = 0.06, cr = 0.12 + 0.05, last = (C.MAX - 1) * C.CHIP;
  const o = worldToBridge(f, m.x, m.z, {}), u0 = o.u, v0 = o.v;
  const flat = [[-B.D / 2, B.D / 2, -B.W / 2, B.W / 2]]; // [u 아래, u 위, v 아래, v 위] — 덱 · 경사로 둘
  for (const s of [-1, 1]) flat.push([-B.D / 2, -B.D / 2 + B.RAMP_W, s > 0 ? B.W / 2 : -B.W / 2 - B.RAMP_L, s > 0 ? B.W / 2 + B.RAMP_L : -B.W / 2]);
  const body = [[u0 - SEQ_HD, u0 + SEQ_HD, v0 - SEQ_HW, v0 + SEQ_HW]];
  for (const q of others) { const w = worldToBridge(f, q.x, q.z, {}); body.push([w.u - SEQ_HD, w.u + SEQ_HD, w.v - SEQ_HW, w.v + SEQ_HW]); }
  const hit = (bs, u, v, ru, rv) => bs.some((b) => u + ru > b[0] && u - ru < b[1] && v + rv > b[2] && v - rv < b[3]);
  const p = {}, inWall = (u, v, r) => { bridgeToWorld(f, u, v, p); return Math.hypot(p.x - cx, p.z - cz) + r < rW - 0.35; };
  const boardOk = (uc, vc) => {
    if (hit(flat, uc, vc, hd + 0.1, hb + 0.1) || hit(body, uc, vc, hd + 0.02, hb + 0.02)) return false;
    return inWall(uc - hd, vc - hb, 0) && inWall(uc - hd, vc + hb, 0) && inWall(uc + hd, vc - hb, 0) && inWall(uc + hd, vc + hb, 0);
  };
  const chipsOk = (uc, vc, d2) => {
    for (let s = 0; s < C.MAX; s++) { const u = uc - d2 - s * C.CHIP; if (hit(flat, u, vc, cr, cr) || hit(body, u, vc, cr, cr) || !inWall(u, vc, cr)) return false; } // 칩 = 판에서 face(−u) 쪽
    return true;
  };
  const ok = (uc, vc, d2) => boardOk(uc, vc) && chipsOk(uc, vc, d2);
  const uf = u0 - 1.05, ub = u0 + SEQ_HD + 0.8, rampBack = -B.D / 2 + B.RAMP_W, behind = u0 + SEQ_HD + cr + last; // behind = 마지막 칸 칩이 몸체 뒤 끝 너머
  const ur = Math.max(uf, rampBack + 0.1 + hd);
  if (ok(uf, v0, 0.2)) return null;                                     // 그대로(jobAnchor 'rig')
  if (boardOk(uf, v0) && chipsOk(uf, v0, uf - behind)) return { d2: uf - behind }; // (i) 판 그대로 · 칩 줄만 뒤
  const cands = [
    [ub, v0, ub - behind],                           // (ii) 판도 뒤
    [uf, v0 - 1.0, 0.2],                             // (iii) 바깥 옆
    [ur, v0, ur - (rampBack + cr) - last],           // (iv) 마지막 칸 칩이 경사로 뒤 끝 너머(검사 — 칩 위쪽 끝이 몸체 안으로 들어가면 버림)
  ];
  let pick = null;
  for (let i = 0; i < cands.length && pick == null; i++) if (ok(...cands[i])) pick = i;
  if (pick == null) return null; // 다 막힘 = 그대로(jobAnchor) — 검사 안 한 자리에 칩을 몸체 위로 그리지 않음
  const [uc, vc, d2] = cands[pick];
  const q = bridgeToWorld(f, uc, vc, {});
  return { x: q.x, z: q.z, face: f.yawIn, d2 };
}

/** 캐릭터 발밑 높이(lab = room.lab) — 구역 브리지가 여럿이면 그 가운데 높은 것 */
export function labFloorY(lab, x, z) {
  if (!lab) return 0;
  const fs = lab.bridges || (lab.bridge ? [lab.bridge] : []);
  let y = 0;
  for (const f of fs) { const v = floorYAt(f, x, z); if (v > y) y = v; }
  return y;
}
/** 방위 θ 가 속한 구역 번호(가장 가까운 브리지 방위) */
export function zoneOfTheta(lab, theta) {
  const zs = lab && lab.zones;
  if (!zs || zs.length < 2) return 0;
  let best = 0, bd = Infinity;
  for (const z of zs) { const d = Math.abs(dTheta(z.theta, theta)); if (d < bd) { bd = d; best = z.i; } }
  return best;
}
