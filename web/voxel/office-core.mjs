// 복셀 오피스 개편의 순수 부분 — three·DOM 없음. 3D(office.js·vx-holo.js·vx-flow.js·vx-ix.js)와
// 2D 평면도(flat/voxel2d.js)가 같이 쓴다(node --test 대상: web/test/vx-office.test.mjs).
//   · 스탠딩 데스크에서 하는 도구(STAND_CATS) — 그 밖은 시설로 걸어감
//   · 사무실 안 새 자리(지역 좌표 → 세계): 탕비실 쉬는 자리, 특별 상호작용 시설(발송대·문서고·원격 부스·컨베이어·신호등 보드)
//   · 바닥 조명 라인(팀장 ↔ 팀원 길) · 길 위 점 · 흐르는 대시 자리
//   · 대기 동작(커피·기지개·생각·둘러보기) 시간표 · 쉬러 가기 판단 · 역할(복장) · 홀로그램 모니터 열림 목표
import { pathBetween, hashStr, LEAD_DESK } from './layout.js';
import { toWorld, xfAngle, windowWall } from './xf.mjs';

const PI = Math.PI;

/** 자기 스탠딩 데스크의 홀로그램 모니터로 하는 도구(손으로 두드리기·넘기기). 나머지는 시설로 걸어간다 */
export const STAND_CATS = new Set(['write', 'edit', 'read', 'search', 'shell', 'web', 'other']);

// 사무실 지역 좌표(회전 전, 방 원점 기준). front:true 는 앞쪽이라 방이 앞으로 길어진 만큼(ext) 민다
export const OFFICE_FX = {
  pantry: { x: -11.55, z: -6.6, len: 2.2 },          // 탕비실 카운터(왼쪽 벽 z -7.7..-5.5): 커피 머신·컵
  shelf: { x: -11.5, z0: -5.0, z1: -3.0 },            // 줄인 책장(장식)
  qc: { x: -11.9, z: -1.6, len: 2.0 },                // 품질검사 신호등 보드(왼쪽 벽에 걸림) — tests
  archive: { x: -11.5, z: 0.75 },                     // 문서고 서랍장 — db 읽기
  vault: { x: -11.5, z: 2.25 },                       // 금고 — db 쓰기
  conveyor: { x: 11.25, z0: 0.5, z1: 3.6 },           // 우편 분류 컨베이어(오른쪽 벽) — batch
  booth: { x: 11.45, z: 5 },                          // 원격 단말 부스(외부 단말 둘레) — remote
  dispatch: { x: 10.1, z: 7.3, front: true },         // 발송대(앞 오른쪽 모서리) — github(택배 드론)
  client: { x: -5.4, z: -8.72, w: 2.4, h: 1.3, y: 1.5 }, // 의뢰인 창구 = 화상회의 스크린(뒤 벽, 팀장 책상 왼쪽) — 사용자 ↔ 메인
};

/** 특별 상호작용 범주 → 시설 */
export const IX_FACILITY = { github: 'dispatch', db: 'archive', remote: 'booth', batch: 'conveyor', tests: 'qc' };
// 탕비실 쉬는 자리(카운터 앞 둘 + 한 걸음 뒤 둘, 서로 마주 봄)
const BREAK_LOCAL = [
  { x: -10.55, z: -7.15, face: -PI / 2 }, { x: -10.55, z: -6.05, face: -PI / 2 },
  { x: -9.45, z: -7.35, look: [-10.55, -6.6] }, { x: -9.45, z: -5.85, look: [-10.55, -6.6] },
];

/** 방 지역 점 → 세계(돌린 방은 회전, 앞쪽 자리는 ext 만큼). 회의실·외부 작업 방은 그대로 쓴다 */
export function roomPoint(room, lx, lz, front = false, out = {}) {
  const base = room.xf && room.local ? room.local : room;
  const x = base.origin.x + lx, z = base.origin.z + lz + (front ? room.ext || 0 : 0);
  const w = room.xf && room.local ? toWorld(room.xf, x, z) : { x, z };
  out.x = w.x; out.z = w.z;
  return out;
}

/** 특별 상호작용 시설 자리(세계). 사무실이 아니면 null */
export function ixSpot(room, cat) {
  if (!room || room.type !== 'office') return null;
  const f = OFFICE_FX[IX_FACILITY[cat]];
  if (!f) return null;
  const lx = f.x, lz = f.z != null ? f.z : (f.z0 + f.z1) / 2;
  const p = roomPoint(room, lx, lz, !!f.front);
  p.y = cat === 'tests' ? 1.55 : cat === 'github' ? 0.5 : 1.0;
  return p;
}

/** 탕비실 쉬는 자리 i(세계, face 포함). 사무실이 아니면 null */
export function breakSpot(room, i = 0) {
  if (!room || room.type !== 'office') return null;
  const b = BREAK_LOCAL[((i % BREAK_LOCAL.length) + BREAK_LOCAL.length) % BREAK_LOCAL.length];
  const p = roomPoint(room, b.x, b.z);
  let face = b.face;
  if (b.look) face = Math.atan2(b.look[0] - b.x, b.look[1] - b.z);
  p.face = face + xfAngle(room.xf && room.local ? room.xf : null);
  p.brk = true;
  return p;
}
export const BREAK_N = BREAK_LOCAL.length;

/** 의뢰인 스크린 지역 z(창 벽 = 뒤 벽이면 뒤, 돌린 방에서 앞 벽이 창이면 앞) · 방 안쪽 방향(+1 = +z) */
export function clientLocal(room) {
  const base = room.xf && room.local ? room.local : room;
  const front = windowWall(room) === 'front';
  const z = front ? base.bounds.maxZ - base.origin.z - 0.28 : OFFICE_FX.client.z;
  return { x: OFFICE_FX.client.x, z, inward: front ? -1 : 1 };
}
/** 의뢰인 스크린 가운데(세계, y 포함) · 그 앞 팀장 자리(face 포함). 사무실이 아니면 null */
export function clientScreen(room) {
  if (!room || room.type !== 'office') return null;
  const c = clientLocal(room), p = roomPoint(room, c.x, c.z);
  p.y = OFFICE_FX.client.y;
  return p;
}
export function clientSpot(room) {
  if (!room || room.type !== 'office') return null;
  const c = clientLocal(room), p = roomPoint(room, c.x, c.z + c.inward * 1.3);
  p.face = (c.inward > 0 ? PI : 0) + xfAngle(room.xf && room.local ? room.xf : null);
  p.client = true;
  return p;
}

// ---------------- 쉬러 가기(대기 동작의 걷기) ----------------
export const BREAK = {
  // 팀장(메인)은 사람 입력을 오래(3분 이상) 기다릴 때만, 한 번 다녀오면 15분 동안은 다시 가지 않는다.
  //     짧은 대기는 자리에서 기지개·화면 보기·둘러보기(idleAct). 예전: 4초 대기면 바로 가서 대기 내내 머묾.
  LEAD_AFTER: 180,    // 팀장: 사람 입력을 기다리는(idle) 채 이만큼 지나면 탕비실로
  LEAD_DUR: 40,       // 팀장 커피 시간(그 뒤 대기 중이어도 자리로)
  LEAD_COOLDOWN: 900, // 팀장이 다시 가기까지
  WAIT_AFTER: 4,      // 팀원: 입력 대기(idle) 채 이만큼 지나면(쿨다운 밖)
  STAFF_AFTER: 14,    // 팀원: 도구 없이(생각 중) 이만큼 지나면 가끔(셋 중 하나꼴) 커피 한 잔
  STAFF_DUR: 8,       // 팀원 커피 시간(그 뒤 자리로)
  COOLDOWN: 45,       // 팀원이 다시 가기까지
  MAX_TS: 8,          // 이 배속 이상이면 걷지 않음
};

/**
 * 쉬러 갈지(순수). s = {lead, status, idleFor(도구 없이 지난 초), hash, ts, now, breakUntil, cooldownUntil, onBreak}
 * 반환: 'go' | 'stay' | 'back' | null(관여 안 함)
 */
export function breakDecision(s) {
  if ((s.ts || 1) >= BREAK.MAX_TS) return s.onBreak ? 'back' : null;
  const waiting = s.status === 'idle';
  if (s.lead) {
    if (s.onBreak) return waiting && s.now < (s.breakUntil || 0) ? 'stay' : 'back';
    if (waiting && s.idleFor >= BREAK.LEAD_AFTER && s.now >= (s.cooldownUntil || 0)) return 'go';
    return null;
  }
  if (s.onBreak) {
    if (waiting) return 'stay';
    return s.now < (s.breakUntil || 0) ? 'stay' : 'back';
  }
  if (s.status !== 'active' && !waiting) return null;
  if (s.now < (s.cooldownUntil || 0)) return null;
  if (waiting && s.idleFor >= BREAK.WAIT_AFTER) return 'go';
  if (s.idleFor >= BREAK.STAFF_AFTER && (s.hash % 3) === 0) return 'go';
  return null;
}

// ---------------- 지휘·감독(팀장) ----------------
/** 팀장이 지휘하러 나와 서는 자리(세계): 팀장 책상 왼쪽 앞(기동기는 오른쪽 옆). 사무실이 아니거나 팀장 책상이 없으면 null */
export function overseeSpot(room) {
  if (!room || room.type !== 'office' || !room.leadDesk) return null;
  const p = roomPoint(room, LEAD_DESK.x - 1.75, LEAD_DESK.z + 1.05);
  p.face = xfAngle(room.xf && room.local ? room.xf : null);
  return p;
}
/** 자율 루프 팀장: 팀원(회차)이 일하는 동안 PERIOD 초마다 DUR 초 동안 몸을 돌려 팀원 쪽을 가리키며 둘러본다 */
export const SUPERVISE = { PERIOD: 15, DUR: 4.5 };
/** 팀장 감독 동작 칸(순수). seed = 해시, t = 초 → {on, k(0..1 칸 안 진행), slot(몇 번째 칸 — 볼 팀원 고르기)} */
export function superviseAct(seed, t) {
  const u = t / SUPERVISE.PERIOD + (seed % 89) / 17;
  const slot = Math.floor(u), k = (u - slot) * SUPERVISE.PERIOD / SUPERVISE.DUR;
  return { on: k < 1, k: Math.min(1, k), slot };
}

// ---------------- 대기 동작 시간표 ----------------
/** 대기 동작(자리에서). seed = 캐릭터 해시, t = 초. 9초 칸마다 하나: 생각·커피·기지개·둘러보기·가만히. k = 칸 안 진행(0..1) */
const IDLE_ACTS = ['think', 'coffee', 'look', 'stretch', 'coffee', 'rest', 'look', 'think'];
export const IDLE_SLOT = 9;
export function idleAct(seed, t) {
  const u = t / IDLE_SLOT + (seed % 97) / 13;
  const slot = Math.floor(u);
  const act = IDLE_ACTS[(hashStr(String(seed) + ':' + slot) >>> 0) % IDLE_ACTS.length];
  return { act, k: u - slot, slot };
}

// ---------------- 역할(복장) ----------------
/**
 * kind·자리 종류·팀장 여부 → 역할: 'lead'(메인 = 팀장, 정장·넥타이) · 'annex'(claude -p 별관 팀장) · 'operator'(기동기 회차 = 작업석, 형광 조끼·모자)
 * · 'guest'(대기석 손님, 외투) · 'wf'(워크플로 에이전트) · 'staff'(서브에이전트, 셔츠)
 */
export function roleOf(kind, seatKind, lead) {
  if (seatKind === 'op') return 'operator';
  if (seatKind === 'wait') return 'guest';
  if (lead) return kind === 'claude-p' ? 'annex' : 'lead';
  if (kind === 'workflow-agent') return 'wf';
  return 'staff';
}

// ---------------- 바닥 조명 라인 ----------------
/** 두 자리 사이 바닥 길(걷는 길과 같은 꺾은선). a·b 가 자리(seat)면 책상 옆으로 나와 통로를 탄다 */
export function floorRoute(a, b, room) {
  const pts = pathBetween(a, b, room);
  return pts.length >= 2 ? pts : [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
}
/** 누적 길이 [0, l1, l1+l2, …] */
export function routeCum(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return c;
}
/** 길 위 비율 u(0..1) 점 → out{x,z, dx,dz(진행 방향 단위)} */
export function routeAt(pts, cum, u, out = {}) {
  const L = cum[cum.length - 1] || 0;
  const s = Math.max(0, Math.min(1, u)) * L;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i] || a, seg = (cum[i] - cum[i - 1]) || 1;
  const k = Math.max(0, Math.min(1, (s - cum[i - 1]) / seg));
  out.x = a.x + (b.x - a.x) * k; out.z = a.z + (b.z - a.z) * k;
  const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  out.dx = (b.x - a.x) / d; out.dz = (b.z - a.z) / d;
  return out;
}
/**
 * 흐르는 대시 자리(길 위 거리, agent-flow 기법): 간격 gap 마다 하나, 시간 t·속도 v 로 부모 → 자식 방향으로 흐른다.
 * 반환 = 대시 앞 끝 거리 배열(0..L). v = 0 이면 []
 */
export function dashStarts(L, t, v, gap = 4.2) {
  if (!(v > 0) || !(L > 0)) return [];
  const off = (t * v) % gap;
  const out = [];
  for (let s = off; s < L; s += gap) out.push(s);
  return out;
}
/** 라인 밝기·흐름 속도(상태별): 작업 중 밝고 빠르게, 대기 느리게, 끝남 멈춤 */
export function lineStyle(status) {
  switch (status) {
    case 'active': return { k: 0.24, v: 2.4, dash: 0.6 };
    case 'idle': return { k: 0.16, v: 0.6, dash: 0.4 };
    case 'error': return { k: 0.3, v: 0.5, dash: 0.5 };
    default: return { k: 0.09, v: 0, dash: 0 };
  }
}

// ---------------- 홀로그램 모니터 ----------------
export const MON = { OPEN: 0.32, CLOSE: 0.42, H: 1.0, MIN_PX: 64, BOOST: 1.9, TOP: 6, ASP: 1.62, LEAD_K: 1.3, POP: 0.95, POP_MAX: 3, MINI_MAX: 3 };
/** 모니터를 펼칠지: 그 노드의 홀로그램 항목이 보이고(장부) 캐릭터가 자기 책상에 서 있을 때 */
export function monitorWanted(hasEntry, atDesk, gone = false) { return !gone && !!hasEntry && !!atDesk; }
/** 열림 정도 한 걸음(펼침 OPEN 초 · 접힘 CLOSE 초) */
export function stepOpen(cur, want, dt) {
  const r = want ? dt / MON.OPEN : -dt / MON.CLOSE;
  return Math.max(0, Math.min(1, cur + r));
}
/** 열림 0..1 → 화면 비율(가는 빛줄로 옆으로 퍼진 뒤 위아래로 열림 — Flow 패널과 같은 순서) */
export function openShape(k) {
  const e = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
  const sx = e(Math.min(1, k / 0.45));
  const sy = k < 0.45 ? 0.05 : 0.05 + 0.95 * e((k - 0.45) / 0.55);
  return { sx, sy };
}
/** 도구 호출 순간 튀어나왔다 들어가는 작은 창: 경과 u(0..1) → 위로 솟는 정도·크기 */
export function popShape(u) {
  if (u <= 0 || u >= 1) return null;
  const up = u < 0.35 ? 1 - Math.pow(1 - u / 0.35, 3) : u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
  return { up, s: Math.max(0.05, up), alpha: u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3 };
}
