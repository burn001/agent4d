// 복셀 오피스 도구 로봇 팀 — 순수 장부·상태 전이(three·DOM 없음). 그리기·자리 계산은 vx-bots.js.
//
// 도구 종류(cat)마다 모양이 다른 로봇이 직원 책상에서 출동해 도구를 대신 수행한다(직원은 자리에서 지시):
//   read·search = 탐색 드론(scout)  : 책상 → 서가(read)·서류함(search) 앞에 떠서 스캔 빛 → 서류를 들고 책상으로
//   shell       = 바퀴 작업 로봇(rover): 책상 옆 바닥 → 서버랙 앞(길찾기 바닥 길) → 팔을 랙에 꽂고 불꽃·랙 점등 → 복귀
//   web         = 정찰 드론(recon)     : 책상 → 창 벽 위로 나가 창밖에서 맴돌며 신호 → 빛 구슬을 싣고 돌아옴
//   write·edit  = 책상 팔 로봇(arm)     : 책상 한쪽에서 펼쳐져 종이에 펜(쓰기 = 줄이 그어짐 · 편집 = 탭·부스러기), 끝나면 접힘
//   그 밖(agent·workflow·skill·mcp·monitor·artifact·notify) = 직원이 직접 시설로 걸어감 — 로봇 없음 · other = 없음
//
// 묶음 규칙(빠른 연속 호출에도 산만하지 않게):
//   · 노드 × 로봇 종류마다 로봇은 하나(열쇠 nodeId|kind). 출동 중(이륙·가는 중·작업·돌아오는 중·착륙)에 온 같은 종류 호출은
//     그 로봇이 이어받는다(jobs 에 더함). 돌아오던 로봇은 그 자리에서 다시 목표로 돌아섬. 같은 종류 안에서 목표가 바뀌면
//     (read → search) 작업 자리에서 새 목표로 옮겨 감.
//   · 마지막 호출이 끝나도 HOLD 초(÷배속 k) 동안은 그 자리에서 기다린다 — 수백 ms 간격 호출은 같은 출동으로 이어진다.
//   · 도착하면 적어도 MIN_WORK 초는 작업한 뒤 돌아온다(도착 순간 바로 돌아서는 깜빡임 없음).
//   · 짧은 호출: 가는 길 TURN_BACK 비율 전에 (끝 + HOLD) 가 지나면 그 자리에서 돌아선다(먼 시설은 중간 복귀), 그 뒤면 마저 가서 짧게 작업.
//   · 상한: 방마다 종류별 CAP_ROOM, 전체 CAP. 넘으면 출동 없음(홀로그램 모니터만 — 그대로 유용).
//   · 같은 방·같은 종류 로봇은 작업 자리 번호(slot)가 달라 겹치지 않는다(서가 칸·랙 앞 좌우·창밖 좌우).
// 시간 = 벽시계 초(view._now). 움직임·대기 시간은 배속 k = clamp(√배속, 1, K_MAX) 로 나눈다(32배에도 따라잡음). 일시정지 = 프레임이 멈춤.

export const BOT = {
  KIND: { read: 'scout', search: 'scout', shell: 'rover', web: 'recon', write: 'arm', edit: 'arm' },
  SPEED: { scout: 6.5, rover: 4.6, recon: 8 }, // 세계 단위/초(배속 1)
  LIFT: 0.32,      // 이륙·착륙(초)
  HOLD: 0.8,       // 마지막 호출 끝 뒤 기다림(초) — 묶음 창
  MIN_WORK: 0.6,   // 도착 뒤 최소 작업(초)
  TURN_BACK: 0.4,  // 가는 길 이 비율 전에 할 일이 없어지면 중간에 돌아섬
  MIN_TRIP: 0.45, MAX_TRIP: 3.2, // 한 구간 걸리는 시간 하한·상한(초, 배속 1)
  ARC: { scout: 0.9, rover: 0, recon: 0.5 }, // 비행 호 높이
  ARM_OPEN: 0.3, ARM_CLOSE: 0.4,
  CAP_ROOM: { scout: 4, rover: 2, recon: 2, arm: 16 },
  CAP: 64,
  REROUTE_N: 1,    // 프레임마다 배치 바뀜 길 다시 찾기 수(나머지는 다음 프레임 — 그동안 지난 길)
  K_MAX: 4,
  VANISH: 0.4,     // 돌아갈 책상이 없어졌을 때 작아지며 사라짐(초)
  // 비행 고도: 드론은 떠올라 순항 고도(직원 키 ~1.8·서가 2.0·홀로그램 모니터 위)로 가로질러 간 뒤 목표 위에서 내려온다
  CRUISE: { scout: 2.45, recon: 2.75 },
  CLIMB_RUN: 0.3,  // 오르내리는 동안 가로로 가는 거리(세계 단위) — 수직 꺾임 대신 가파른 비탈
  // 바퀴 로봇 비켜 가기·기다리기(직원·다른 바퀴 로봇)
  AVOID: {
    LOOK: 1.8,     // 앞쪽 이 거리 안의 장애만 본다
    BEHIND: 0.8,   // 옆·조금 뒤(지나는 중)도 비킴 유지
    STOP: 0.95,    // 앞 이 거리 안에서 옆 간격이 모자라면 멈춰 기다림
    HALF: 0.62,    // 로봇 반폭 + 사람 반지름(옆 간격 기준)
    SIDE: 0.45,    // 옆으로 비키는 최대 거리
    SIDE_V: 2.4,   // 옆 비킴 속도(단위/초, 배속 1)
    WAIT_MAX: 2.0, // 이만큼 기다려도 안 비키면 잠깐 겹쳐 지나감(초, 배속 1) — 막힘 방지
    GHOST: 1.2,    // 겹쳐 지나가는 시간(초, 배속 1)
    WAIT_MIN: 0.3, // 한 번 멈추면 적어도 이만큼(초, 배속 1)
    END: 0.95,     // 도착점 이 거리 안의 장애는 무시(책상 옆 발사대·랙 앞 — 옆자리 직원 곁에 그냥 선다)
    DECAY: 0.25,   // 안 막힌 동안 기다린 시간이 줄어드는 비율(깜빡 멈춤이 이어져도 결국 겹쳐 지나가게)
    // 도착점 곁 스침 막기
    END_ZONE: 1.6, // 남은 길이 이 안이면 '도착 직전' — 우선을 내려놓고(직원은 멈추지 않음) 걷는 직원을 기다린다
    CONTACT: 0.8,  // 차체(반폭 ~0.39) + 사람(0.3) + 여유 — 닿기 미리 보기 거리
    CATCH: [0, 0.2, 0.4], // 닿기 미리 보기 시각(초, 벽시계 — 속도에 배속이 들어 있음)
    // 막힘 풀기
    DETOUR_AT: 0.6, // 이만큼 멈추면(배속 1) 막은 사람·로봇을 피해 길 다시 찾기
    DETOUR_R: 3.5,  // 피할 원으로 넣는 둘레
    DETOUR_MAX: 8,  // 다시 찾은 길이 남은 길보다 이보다 길면 버림(기다림)
    BACK_T: 0.9,    // 뒤로 비켜 서기 최대 시간(초, 배속 1)
    BACK_D: 0.9,    // 뒤로 비켜 서는 거리
    LAND_NEAR: 0.6, // 돌아가는 길 남은 거리가 이 안에서 막히면 그 자리에서 내려앉음
    SLOW_D: 2.6,    // 앞 같은 줄 이 거리 안이면 늦춤
    GAP: 0.85,      // 늦춰 둘 앞 틈(중심 거리)
    SLOW_K: 4,      // 남은 틈 1 당 허용 속도(단위/초)
  },
  // 드론끼리 비켜 가기: 가로 R 안·높이 차 DY 안에서 겹치면 열쇠가 큰 쪽이 한 층(UP) 위로(겹친 수만큼, 최대 MAX)
  DRONE_SEP: {
    R: 1.1,        // 가로 거리(세계 단위) — 드론 폭(~0.65) + 여유
    DY: 0.5,       // 높이 차(층을 나눈 뒤에도 기준 높이로 판정 — 떨림 없음)
    UP: 0.42,      // 한 층 높이
    MAX: 0.84,     // 최대 두 층
    V: 3.2,        // 층 바꾸는 속도(단위/초, 배속 1) — 2.4 → 3.2(셋째 층까지 오르기 전에 엇갈렸다)
    AHEAD: 0.45,   // 이만큼(초, 벽시계) 앞까지 내다봄(0.3 → 0.45) — 마주 오는 드론(합 속도 ~14 단위/초)도 미리 층을 나눔
    LOW: 1.6, FULL: 2.3, // 기준 높이 LOW 아래면 층 0(이착륙·서가 스캔은 그대로), FULL 위면 다 올림 — 사이는 비례(내려앉을 때 튀지 않음)
    SEP_Y: 0.4,    // 층을 정할 때 짝과 벌릴 실제 높이 차(순항 고도가 다른 탐색 0.45·정찰 0.75 짝도 실제 높이로)
    HSIDE: 0.7,    // 높이로 못 나누면(층 모자람·이착륙 높이) 옆으로 비키는 거리
    HV: 2.4,       // 옆 비킴 속도(단위/초, 배속 1)
    HOVER: 1.2,    // 그동안 길 위 진행을 멈추는 최대 시간(초, 배속 1) — 넘으면 비킨 채 지나감
  },
};
/** 바퀴 로봇 우선: 열린 호출을 들고 출동 중(out)이면 걷는 직원이 길을 비켜 준다(돌아올 때·빈 출동은 직원 우선 — 로봇이 기다림) */
export const roverPrio = (b) => b.kind === 'rover' && b.state === 'out' && b.jobs.size > 0;

export const botKind = (cat) => BOT.KIND[cat] || null;
/** 배속 → 움직임 배율 */
export const botSpeedK = (ts) => Math.min(BOT.K_MAX, Math.max(1, Math.sqrt(Number(ts) || 1)));
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 꺾은선 길이(3D) */
function cum3(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, (pts[i].y || 0) - (pts[i - 1].y || 0), pts[i].z - pts[i - 1].z));
  return c;
}
/** 구간 seg 위 비율 u → out{x,y,z, dx,dz} (호 높이 arc 는 sin(πu)) */
export function segAt(seg, u, out = {}) {
  const pts = seg.pts, cum = seg.cum, L = seg.len;
  const s = clamp01(u) * L;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i] || a, sl = (cum[i] - cum[i - 1]) || 1;
  const k = clamp01((s - cum[i - 1]) / sl);
  out.x = a.x + (b.x - a.x) * k; out.y = (a.y || 0) + ((b.y || 0) - (a.y || 0)) * k + Math.sin(Math.PI * clamp01(u)) * (seg.arc || 0); out.z = a.z + (b.z - a.z) * k;
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  if (d > 1e-6) { out.dx = (b.x - a.x) / d; out.dz = (b.z - a.z) / d; } else { out.dx = 0; out.dz = 0; }
  return out;
}
/** 구간 만들기: pts(3D 점 2개 이상), 걸리는 시간 = 길이 / 속도(하한·상한). 호(arc)는 두 점 곧은 길에만(고도 길은 이미 위로 넘어감) */
export function makeSeg(pts, kind, t0) {
  const c = cum3(pts), len = c[c.length - 1];
  const dur = Math.min(BOT.MAX_TRIP, Math.max(BOT.MIN_TRIP, len / (BOT.SPEED[kind] || 6)));
  return { pts, cum: c, len, t0, dur, arc: pts.length === 2 && len > 1.5 ? BOT.ARC[kind] || 0 : 0, kind };
}

/**
 * 비행 길(a → c, 3D): 가파르게 순항 고도 cruise 까지 올라 가로질러 간 뒤 c 위에서 내려온다.
 * 이미 cruise 이상이면 오르기 생략 · 가로 거리가 짧으면(0.6 아래) 곧은 길. 가로 구간은 늘 cruise 높이라 가구·직원 위를 지난다.
 */
export function flightPts(a, c, cruise) {
  const dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz);
  if (d < 0.6) return [a, c];
  const ux = dx / d, uz = dz / d, run = Math.min(BOT.CLIMB_RUN, d / 4);
  const pts = [a];
  if ((a.y || 0) < cruise - 0.05) pts.push({ x: a.x + ux * run, y: cruise, z: a.z + uz * run });
  if ((c.y || 0) < cruise - 0.05) pts.push({ x: c.x - ux * run, y: cruise, z: c.z - uz * run });
  pts.push(c);
  return pts;
}

/**
 * 바퀴 로봇 비켜 가기(순수): 앞쪽 장애(직원·다른 바퀴 로봇) → { side(옆 비킴 목표), wait(멈춤) }.
 *   p = 지금 자리(옆 비킴 포함), f = 진행 방향 단위(x,z), side = 지금 옆 비킴, list = [{x,z,r?,key?,moving?}], me = 내 열쇠
 *   end = 이 길의 도착점(그 둘레 END 안에 서 있는 장애는 기다리지 않음) · prio = 우선 출동 · vr = 길 위 속도(닿기 미리 보기)
 *   capF(f) = 앞 f 에서의 옆 비킴 한도(선택)
 *   · 옆 간격(lat) < HALF+(r−0.3) 이면 비켜야 함: 목표 옆 비킴 = 간격을 채우는 쪽(가운데면 오른쪽 =), 최대 SIDE
 *   · STOP 안쪽인데 비켜도 모자라면 wait. 다른 바퀴 로봇이 움직이는 중이면 열쇠가 작은 쪽만 기다림(서로 기다리는 막힘 없음)
 */
export function avoidPlan(p, fx, fz, side, list, me, maxSide = BOT.AVOID.SIDE, end = null, prio = false, vr = 0, capF = null) {
  const A = BOT.AVOID, rx = -fz, rz = fx;
  const hi = typeof maxSide === 'number' ? maxSide : maxSide.r, lo = typeof maxSide === 'number' ? -maxSide : -maxSide.l; // 좌우 한도가 다를 수 있음(가구 곁)
  let want = 0, wait = false, best = Infinity, vcap = Infinity;
  for (const q of list) {
    if (q.key != null && q.key === me) continue;
    // 도착점 둘레(END)에 서 있는 사람은 기다리지 않음(옆자리·랙 앞에 선 직원 곁에 그냥 선다 — 옆 비킴만, 예전엔 아예 무시) · 걷는 직원은 도착 직전에도 본다
    const still = !!end && !q.walking && Math.hypot(q.x - end.x, q.z - end.z) < A.END;
    // 닿기 미리 보기: 걷는 직원(vx·vz)과 내가 그대로 가면(vr) CATCH 초 안에 차체가 닿으면 멈춤(우선이어도 — 닿기 직전만)
    if (q.walking && (q.vx || q.vz) && !wait && !(prio && q.yielding)) { // 우선일 때 비켜 서 있는 직원은 빼고(그 곁을 지나감 — 멈추면 서로 번갈아 멈춤)
      // 가장 가까워지는 때를 바로 풂(예전: 0·0.2·0.4초 세 점 — 긴 길의 빠른 로봇(남은 길 ÷ MAX_TRIP, 수십 단위/초)은 점 사이를 건너뛰어 0.45 까지 붙음).
      //   내다보는 시간은 CATCH 끝과 LOOK ÷ 속도 가운데 짧은 쪽(빠른 로봇이 먼 직원 때문에 멈추지 않게)
      const T = Math.min(A.CATCH[A.CATCH.length - 1], vr > 1e-6 ? A.LOOK / vr : Infinity);
      const r0x = q.x - p.x, r0z = q.z - p.z, wx = q.vx - fx * vr, wz = q.vz - fz * vr, w2 = wx * wx + wz * wz;
      const t = w2 > 1e-9 ? Math.max(0, Math.min(T, -(r0x * wx + r0z * wz) / w2)) : 0;
      const ex = r0x + wx * t, ez = r0z + wz * t;
      if (ex * ex + ez * ez < A.CONTACT * A.CONTACT && ex * fx + ez * fz > -0.25) wait = true;
    }
    const dx = q.x - p.x, dz = q.z - p.z;
    const f = dx * fx + dz * fz;
    const lat = dx * rx + dz * rz, clear = A.HALF + ((q.r ?? 0.3) - 0.3);
    // 앞 같은 줄(옆 간격 < clear)의 직원·로봇 뒤에서는 속도를 줄여 GAP 을 둠(앞사람 앞 방향 속도 + 남은 틈 × SLOW_K) — 빠른 로봇이 한 프레임에 STOP 안으로 뛰어들어 붙던 것
    if (f > 0 && f < A.SLOW_D && Math.abs(lat) < clear && !still) {
      const va = q.walking ? Math.max(0, (q.vx || 0) * fx + (q.vz || 0) * fz) : 0, c = va + Math.max(0, f - A.GAP) * A.SLOW_K;
      if (c < vcap) vcap = c;
    }
    if (f <= -A.BEHIND || f > A.LOOK) continue; // 옆을 지나는 중(조금 뒤)인 것도 비킴 유지 — 지나치자마자 되돌아와 스치지 않게
    if (Math.abs(lat) >= clear) continue;
    const d = lat > 0.05 ? lat - clear : lat < -0.05 ? lat + clear : clear; // 바꿀 옆 비킴(− = 왼쪽)
    const tgt = Math.max(lo, Math.min(hi, side + d));
    if (Math.abs(f) < best) { best = Math.abs(f); want = tgt; }
    // 그 장애 곁(앞 f)에서도 비킴이 남는지(capF = 앞 거리 → 옆 비킴 한도: 꺾이는 점·길 끝에서 줄어듦) — 지금만 보면 곁에 가서야 모자라 멈춰 스쳤다
    const cq = capF ? capF(f > 0 ? f : 0) : Infinity, tq = Math.max(Math.max(lo, -cq), Math.min(Math.min(hi, cq), side + d));
    const fits = Math.abs(lat - (tq - side)) >= clear - 0.02;
    // 움직이는 다른 바퀴 로봇은 열쇠가 작은 쪽만 기다림. 우선 로봇도 옆 비킴이 모자라면 멈춘 직원을 기다림(예전: 지나감 → 차체가 스침)
    // 멈추면 우선이 풀려(roverObstacles) 직원이 먼저 지나가므로 서로 기다리는 막힘은 없다
    const yieldTo = !(q.bot && q.moving && q.key > me);
    if (f > 0 && f < A.STOP && !fits && yieldTo && !still) wait = true;
    // 곁을 지나는 중(바로 옆·조금 뒤)인 걷는 직원과 옆 간격이 닿을 만큼이면 멈춤(옆 비킴이 가구에 막혀 모자란 채 스쳐 지나갔다) — 직원이 먼저 비켜 지나감
    else if (q.walking && f <= 0 && f > -0.45 && Math.abs(lat) < clear - 0.12 && yieldTo && !still) wait = true;
  }
  return { side: want, wait, near: best, vcap };
}

/**
 * 로봇 장부. env(그리는 쪽이 줌):
 *   env.pad(bot)          → 책상 출발점 {x,y,z} | null(책상이 없어짐)
 *   env.goal(bot)         → 작업 자리 {x,y,z, yaw} | null
 *   env.route(bot, a, b, back) → 점 배열(a·b 포함, 3D) — 드론 = 순항 고도 길(flightPts, 웹은 창을 지남), 바퀴 = 바닥 길
 *   env.blockers(bot)     → (선택) 바퀴 로봇이 비켜 갈 [{x,z,r?,key?,bot?,moving?}] — 같은 방 직원·다른 바퀴 로봇
 */
export class BotBook {
  constructor() {
    this.bots = new Map();   // 'nodeId|kind' → bot
    this.byTool = new Map(); // toolUseId → 열쇠
    this.stats = { bots: 0, started: 0, joined: 0, refused: 0, turned: 0, waits: 0, ghosts: 0, lifts: 0, hovers: 0, detours: 0, backoffs: 0 };
  }
  get size() { return this.bots.size; }
  _count(roomId, kind) { let n = 0; for (const b of this.bots.values()) if (b.kind === kind && b.roomId === roomId) n++; return n; }
  /** 같은 방·같은 종류 로봇끼리 겹치지 않게 작업 자리 번호(가장 작은 빈 번호) */
  _slot(roomId, kind) { const used = new Set(); for (const b of this.bots.values()) if (b.kind === kind && b.roomId === roomId) used.add(b.slot); let i = 0; while (used.has(i)) i++; return i; }

  /** 도구 시작 → 로봇(새로 출동 또는 이어받음) | null(로봇 없는 종류·상한) */
  start(nodeId, tid, cat, now, { quiet = false, roomId = null } = {}) {
    const kind = botKind(cat);
    if (!kind || !nodeId) return null;
    const key = nodeId + '|' + kind;
    let b = this.bots.get(key);
    if (!b) {
      if (this.bots.size >= BOT.CAP || this._count(roomId, kind) >= (BOT.CAP_ROOM[kind] || 1)) { this.stats.refused++; return null; }
      b = {
        key, nodeId, kind, roomId, cat, slot: this._slot(roomId, kind), jobs: new Set(), calls: 0, done: 0, errAt: -Infinity, ok: null,
        state: kind === 'arm' ? 'open' : 'launch', st: now, lastEnd: -Infinity, lastStart: now,
        p: null, yaw: 0, seg: null, open: 0, workT0: null, quiet: !!quiet, retarget: false, orphan: false, landAt: null, sortie: 0,
        side: 0, waitT: 0, waiting: false, waitUntil: -Infinity, ghostUntil: -Infinity,
      };
      if (quiet) { b.state = 'work'; b.open = 1; b.workT0 = now - BOT.MIN_WORK; b.snap = true; }
      this.bots.set(key, b);
      this.stats.started++;
    } else {
      this.stats.joined++;
      if (b.orphan) b.orphan = false;
    }
    if (tid != null) { b.jobs.add(tid); this.byTool.set(tid, key); }
    b.calls++; b.lastStart = now;
    if (cat !== b.cat) { b.cat = cat; if (b.state === 'work' || b.state === 'out') b.retarget = true; }
    if (b.state === 'back' || b.state === 'land' || b.state === 'vanish') { b.state = 'out'; b.seg = null; b.st = now; b.sortie++; } // 그 자리에서 다시 목표로(착륙 중이면 떠오르며)
    if (b.state === 'close') { b.state = 'open'; b.st = now; }
    return b;
  }
  /** 도구 끝 */
  end(nodeId, tid, ok, now) {
    const key = tid != null ? this.byTool.get(tid) : null;
    if (key == null) return null;
    this.byTool.delete(tid);
    const b = this.bots.get(key);
    if (!b) return null;
    b.jobs.delete(tid);
    b.lastEnd = now; b.done++;
    b.ok = ok === false ? false : ok === 'stopped' ? 'stopped' : true;
    if (ok === false) b.errAt = now;
    return b;
  }
  /** 노드가 끝남·사라짐: 열린 호출을 버리고 돌아감(책상이 없으면 사라짐) */
  dropNode(nodeId, now) {
    for (const b of this.bots.values()) {
      if (b.nodeId !== nodeId) continue;
      for (const t of b.jobs) this.byTool.delete(t);
      b.jobs.clear(); b.orphan = true; b.lastEnd = Math.min(b.lastEnd, now - BOT.HOLD * 2);
    }
  }
  /** 노드의 열린 호출만 닫음(노드 끝, 로봇은 평소처럼 돌아감) */
  endAll(nodeId, now) {
    for (const b of this.bots.values()) {
      if (b.nodeId !== nodeId || !b.jobs.size) continue;
      for (const t of b.jobs) this.byTool.delete(t);
      b.jobs.clear(); b.lastEnd = now;
    }
  }
  clear() { this.bots.clear(); this.byTool.clear(); }
  /** 배치가 바뀜: 다음 걸음에 길을 다시 잡는다 */
  invalidate() { for (const b of this.bots.values()) if (b.seg) b.reroute = true; }

  /** 할 일이 남았나(열린 호출 또는 묶음 창) */
  static busy(b, now, k = 1) { return b.jobs.size > 0 || now - b.lastEnd < BOT.HOLD / k; }

  /** 한 걸음: 상태 전이 + 자리(b.p)·방향(b.yaw). k = 움직임 배율 */
  step(now, dt, k, env) {
    this._rr = BOT.REROUTE_N; // 배치가 바뀐 뒤 길 다시 찾기는 프레임마다 이만큼만(큰 사무실 — 한 프레임에 모든 바퀴 로봇이 길찾기를 하면 멈춤)
    for (const b of this.bots.values()) {
      if (b.altY) { b.p.y -= b.altY; b.altY = 0; } // 지난 프레임 층 올림을 빼고(기준 높이) 한 걸음
      if (b.hX || b.hZ) { b.p.x -= b.hX; b.p.z -= b.hZ; b.hX = 0; b.hZ = 0; } // 옆 비킴(드론)도 빼고
      if (b.kind === 'arm') this._stepArm(b, now, dt, k);
      else this._stepTravel(b, now, dt, k, env);
    }
    const dtw = this._lastNow != null ? Math.min(0.25, Math.max(0, now - this._lastNow)) : dt; // 벽시계 간격(프레임이 성기면 dt 는 0.05 로 잘림)
    this._lastNow = now;
    this._sepDrones(dtw > 0 ? dtw : dt, k);
    for (const [key, b] of this.bots) if (b.state === 'gone') { this.bots.delete(key); for (const t of b.jobs) this.byTool.delete(t); }
    this.stats.bots = this.bots.size;
  }

  _stepArm(b, now, dt, k) {
    const busy = BotBook.busy(b, now, k) && !b.orphan;
    if (b.state === 'open') { b.open = Math.min(1, b.open + (dt * k) / BOT.ARM_OPEN); if (b.open >= 1) { b.state = 'work'; b.workT0 = now; } }
    else if (b.state === 'work') { if (!busy && now - (b.workT0 ?? now) >= BOT.MIN_WORK / k) { b.state = 'close'; b.st = now; } }
    else if (b.state === 'close') {
      if (busy) { b.state = 'open'; }
      else { b.open = Math.max(0, b.open - (dt * k) / BOT.ARM_CLOSE); if (b.open <= 0) b.state = 'gone'; }
    }
  }

  _go(b, to, now, env, back) {
    const from = b.p ? { x: b.p.x, y: b.p.y, z: b.p.z } : to; // 옆 비킴이 든 지금 자리에서 새 길(비킴은 0 부터)
    const pts = env.route ? env.route(b, from, to, back) : null;
    b.seg = makeSeg(pts && pts.length >= 2 ? pts : [from, to], b.kind, now);
    b.reroute = false; b.side = 0; b.waitT = 0; b.waiting = false; b.endZone = false; b.backUntil = 0;
  }

  /** 바퀴 로봇: 앞의 직원·다른 바퀴 로봇을 옆으로 비켜 가고, 모자라면 길 위 진행을 멈춰 기다린다(오래 막히면 잠깐 겹쳐 지나감) */
  _avoid(b, now, dt, k, env) {
    const A = BOT.AVOID, seg = b.seg;
    const u0 = clamp01(((now - seg.t0) * k) / seg.dur), along = u0 * seg.len, remain = seg.len - along;
    // 옆 비킴 한도: 길 양 끝과 꺾이는 점 앞뒤에서도 남은 거리의 절반 — 비킴은 진행 방향 기준이라 꺾일 때 옆 방향이 돌아가 차체가 튀었다(0.3 순간 이동)
    const cum = seg.cum;
    let ci = 1;
    while (ci < cum.length - 1 && cum[ci] <= along) ci++;
    const corner = Math.min(along - cum[ci - 1], cum[ci] - along);
    const maxSide = Math.max(0, Math.min(A.SIDE, 0.5 * Math.min(along, remain, corner)));
    const capF = b._capF || (b._capF = (f) => { // 앞 f 까지 가는 동안 가장 작은 한도(사이에 꺾이는 점이 있으면 0)
      const c = b._cap, a1 = c.along + f;
      if (a1 >= c.next) return 0;
      return Math.max(0, Math.min(A.SIDE, 0.5 * Math.min(c.along, c.len - a1, c.next - a1)));
    });
    b._cap = { along, len: seg.len, next: cum[ci] };
    const list = env.blockers(b);
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    // 도착 직전: 우선 내려놓음(roverObstacles 도 봄) — 걷는 직원을 기다린다. 곁에 나를 위해 멈춘 직원이 있으면 그 곁을 지난 뒤에(도중에 풀면 그 직원이 바로 앞으로 걸어 들어옴)
    if (!b.endZone && remain < A.END_ZONE) {
      let hold = false;
      if (list) for (const q of list) if (q.yielding && Math.hypot(q.x - b.p.x, q.z - b.p.z) < A.END_ZONE && (q.x - b.p.x) * fx + (q.z - b.p.z) * fz > -0.3) { hold = true; break; }
      if (!hold) b.endZone = true;
    }
    const prio = roverPrio(b) && !b.endZone, end = seg.pts[seg.pts.length - 1];
    const vr = (seg.len / seg.dur) * k; // 길 위 속도(단위/초, 벽시계)
    let pl = list && list.length ? avoidPlan(b.p, fx, fz, b.side, list, b.key, maxSide, end, prio, vr, capF) : null;
    if (env.sideFree && ((pl && pl.side) || Math.abs(b.side) > 1e-3)) { // 차체가 가구·벽에 닿지 않게 좌우 한도(지금 자리 + 조금 앞)를 줄여 다시 계획
      const rx = -fz, rz = fx, cx = b.p.x - rx * b.side, cz = b.p.z - rz * b.side; // 길 위 점(비킴 빼고)
      const lim = { r: env.sideFree(b, cx, cz, rx, rz, maxSide, fx, fz), l: env.sideFree(b, cx, cz, -rx, -rz, maxSide, fx, fz) };
      if (lim.r < maxSide - 1e-6 || lim.l < maxSide - 1e-6) { if (pl) pl = avoidPlan(b.p, fx, fz, b.side, list, b.key, lim, end, prio, vr, capF); b.sideLim = lim; } else b.sideLim = null;
    } else b.sideLim = null;
    // 뒤로 비켜 서는 중: 앞을 본 채 길을 거슬러 반 속도로(뒤에 사람·로봇이 있거나 BACK_D 만큼 물러나면 멈춤)
    if (b.backUntil > now) {
      const uNow = clamp01(((now - seg.t0) * k) / seg.dur);
      let stop = uNow <= b.backU;
      if (!stop && list) for (const q of list) { const dx = q.x - b.p.x, dz = q.z - b.p.z, f = dx * fx + dz * fz; if (f < 0 && f > -1.2 && Math.abs(dx * -fz + dz * fx) < A.HALF) { stop = true; break; } }
      if (stop) b.backUntil = 0;
      else { const vr0 = (seg.len / seg.dur) * k; seg.t0 += dt * (1 + Math.min(0.5 * vr0, 2.4 * k) / Math.max(vr0, 1e-6)); } // 반 속도, 최대 2.4 단위/초(긴 길의 빠른 로봇도 천천히 물러남)
      b.waiting = true; b.waitT = 0;
      return;
    }
    let wait = !!pl && pl.wait && now >= b.ghostUntil;
    if (!wait && b.waiting && now < b.waitUntil && now >= b.ghostUntil) wait = true; // 멈추면 적어도 잠깐(깜빡 멈춤·출발 반복 없음)
    if (wait) {
      b.waitT += dt * k; b.freeT = 0;
      // 막힘 풀기(예전: WAIT_MAX 뒤 바로 겹쳐 지나감 — 20초에 3～6번): ① DETOUR_AT 넘게 멈추면 길을 막은 사람·로봇을 피해 길 다시 찾기
      //   ② 그래도 WAIT_MAX 이면 뒤로 비켜 섬(BACK_D — 마주 온 직원이 지나갈 틈) ③ 비켜 선 뒤에도 막히면(길이 없음) 그때만 겹쳐 지나감
      if (b.state === 'back' && remain < A.LAND_NEAR && b.waitT > A.DETOUR_AT) { b.landNow = true; return; } // 책상 코앞에서 막힘 = 그 자리에서 내려앉음(겹쳐 지나가지 않음)
      if (b.waitT > A.DETOUR_AT && !b.detourTried && env.route && this._rr > 0) {
        this._rr--; b.detourTried = true;
        if (this._detour(b, now, u0, env, list)) return;
      }
      if (b.waitT > A.WAIT_MAX) {
        if (!b.backed) { b.backed = true; b.detourTried = false; b.backUntil = now + A.BACK_T / k; b.backU = Math.max(0, u0 - A.BACK_D / seg.len); b.waitT = 0; this.stats.backoffs++; }
        else { b.ghostUntil = now + A.GHOST / k; b.waitT = 0; wait = false; b.backed = false; b.detourTried = false; this.stats.ghosts++; }
      }
    } else {
      b.waitT = Math.max(0, b.waitT - dt * k * A.DECAY);
      b.freeT = (b.freeT || 0) + dt * k;
      if (b.freeT > 1) { b.backed = false; b.detourTried = false; } // 막힘이 풀린 지 1초 — 다음 막힘은 처음부터
    }
    if (wait && !b.waiting) { this.stats.waits++; b.waitUntil = now + A.WAIT_MIN / k; }
    b.waiting = wait;
    const tgt = pl ? pl.side : 0, st = A.SIDE_V * dt * k;
    const lo = b.sideLim ? -b.sideLim.l : -maxSide, hi = b.sideLim ? b.sideLim.r : maxSide;
    b.side += Math.max(-st, Math.min(st, tgt - b.side));
    // 한도가 갑자기 줄면(앞에 가구 모서리·꺾이는 점) 한 프레임에 되돌리지 않고(예전: 0.3 순간 이동) 그 자리에 서서 빠르게(2배) 되돌림
    const over = b.side > hi + 1e-3 ? b.side - hi : b.side < lo - 1e-3 ? b.side - lo : 0;
    if (Math.abs(over) > st * 2) { b.side -= Math.sign(over) * st * 2; if (!wait) seg.t0 += dt; b.recenter = true; }
    else { b.side = Math.max(lo, Math.min(hi, b.side)); b.recenter = false; }
    if (wait) seg.t0 += dt; // 길 위 진행 멈춤(u 고정)
    else if (!b.recenter && pl && pl.vcap < vr && now >= b.ghostUntil) seg.t0 += dt * (1 - Math.max(0, pl.vcap) / vr); // 앞 같은 줄 뒤에서 늦춤
  }
  /** 막힘 풀기 다시 찾기: 둘레 DETOUR_R 안의 직원·로봇을 원으로 막고 지금 자리 → 길 끝. 남은 길 + DETOUR_MAX 보다 길면 버림 */
  _detour(b, now, u0, env, list) {
    const A = BOT.AVOID, seg = b.seg, end = seg.pts[seg.pts.length - 1], discs = [];
    if (list) for (const q of list) if (Math.hypot(q.x - b.p.x, q.z - b.p.z) < A.DETOUR_R) discs.push({ x: q.x, z: q.z, r: q.r ?? 0.3 });
    if (!discs.length) return false;
    const pts = env.route(b, { x: b.p.x, y: b.p.y, z: b.p.z }, end, b.state === 'back', discs);
    if (!pts || pts.length < 2) return false;
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (L > seg.len * (1 - u0) + A.DETOUR_MAX) return false;
    // 새 길이 정말 비켜 가는지(앞 DETOUR_R 안 표본이 원과 HALF 이상 — 지금 이미 그보다 가까운 원은 더 가까워지지 않으면 됨)
    const sg = makeSeg(pts, b.kind, now), o = {};
    for (let d = 0.2; d < Math.min(sg.len, A.DETOUR_R); d += 0.2) {
      segAt(sg, d / sg.len, o);
      for (const c of discs) { const m = Math.min(A.HALF, Math.hypot(c.x - b.p.x, c.z - b.p.z) - 0.02); if (Math.hypot(o.x - c.x, o.z - c.z) < m) return false; }
    }
    b.seg = sg;
    b.side = 0; b.waitT = 0; b.waiting = false; b.endZone = false; b.reroute = false;
    this.stats.detours++;
    return true;
  }
  _applySide(b) {
    if (!b.side) return;
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    b.p.x += -fz * b.side; b.p.z += fx * b.side;
  }

  _stepTravel(b, now, dt, k, env) {
    const pad = env.pad(b);
    const busy = BotBook.busy(b, now, k) && !b.orphan;
    if (!b.p) {
      const g0 = b.snap ? env.goal(b) : null;
      const p0 = g0 || pad;
      if (!p0) { b.state = 'gone'; return; }
      b.p = { x: p0.x, y: p0.y, z: p0.z };
      if (g0 && g0.yaw != null) b.yaw = g0.yaw;
      b.snap = false;
    }
    if (!pad && b.state !== 'vanish' && (b.state === 'back' || b.state === 'land' || b.orphan)) { b.state = 'vanish'; b.st = now; }
    switch (b.state) {
      case 'launch': { // 책상 위로 떠오름(바퀴 로봇 = 책상 옆에 나타남)
        const u = ((now - b.st) * k) / BOT.LIFT;
        if (pad) { b.p.x = pad.x; b.p.z = pad.z; b.p.y = pad.y + (b.kind === 'rover' ? 0 : ease(clamp01(u)) * 0.45); }
        b.appear = clamp01(u);
        if (u >= 1) { const g = env.goal(b); if (!g) { b.state = 'back'; b.seg = null; break; } b.state = 'out'; this._go(b, g, now, env, false); }
        break;
      }
      case 'out': {
        const g = env.goal(b);
        if (!g) { b.state = 'back'; b.seg = null; break; }
        if (!b.seg || b.retarget || (b.reroute && this._rr-- > 0)) { b.retarget = false; this._go(b, g, now, env, false); }
        if (b.kind === 'rover' && env.blockers) this._avoid(b, now, dt, k, env);
        const u = ((now - b.seg.t0) * k) / b.seg.dur;
        if (!busy && u < BOT.TURN_BACK) { b.state = 'back'; b.seg = null; this.stats.turned++; break; }
        this._move(b, u, g);
        if (b.kind === 'rover') this._applySide(b);
        if (u >= 1) { b.state = 'work'; b.workT0 = now; b.side = 0; b.waiting = false; b.endZone = false; b.p.x = g.x; b.p.y = g.y; b.p.z = g.z; if (g.yaw != null) b.yaw = g.yaw; }
        break;
      }
      case 'work': {
        const g = env.goal(b);
        if (b.retarget && g) { b.retarget = false; b.state = 'out'; this._go(b, g, now, env, false); break; }
        if (g) { b.p.x = g.x; b.p.y = g.y; b.p.z = g.z; if (g.yaw != null) b.yaw = turn(b.yaw, g.yaw, dt * 6 * k); }
        if (!busy && now - (b.workT0 ?? now) >= BOT.MIN_WORK / k) { b.state = 'back'; b.seg = null; }
        break;
      }
      case 'back': {
        if (!pad) { b.state = 'vanish'; b.st = now; break; }
        const to = { x: pad.x, y: pad.y + (b.kind === 'rover' ? 0 : 0.45), z: pad.z };
        if (!b.seg || (b.reroute && this._rr-- > 0)) this._go(b, to, now, env, true);
        if (b.kind === 'rover' && env.blockers) this._avoid(b, now, dt, k, env);
        const u = ((now - b.seg.t0) * k) / b.seg.dur;
        this._move(b, u, null);
        if (b.kind === 'rover') this._applySide(b);
        if (u >= 1 || b.landNow) { b.state = 'land'; b.st = now; b.landAt = now; b.side = 0; b.waiting = false; b.endZone = false; b.landNow = false; }
        break;
      }
      case 'land': {
        const u = ((now - b.st) * k) / BOT.LIFT;
        if (pad) { // 바퀴 로봇은 내려앉은 자리에서 책상 옆으로 미끄러짐(코앞에서 막혀 일찍 내려앉아도 순간 이동 없음)
          if (b.kind === 'rover') { const m = Math.min(1, dt * k * 6); b.p.x += (pad.x - b.p.x) * m; b.p.z += (pad.z - b.p.z) * m; }
          else { b.p.x = pad.x; b.p.z = pad.z; }
          b.p.y = pad.y + (b.kind === 'rover' ? 0 : (1 - ease(clamp01(u))) * 0.45);
        }
        b.appear = 1 - clamp01(u);
        if (u >= 1) b.state = 'gone';
        break;
      }
      case 'vanish': {
        b.appear = 1 - clamp01(((now - b.st) * k) / BOT.VANISH);
        if (b.appear <= 0) b.state = 'gone';
        break;
      }
      default: break;
    }
    if (b.state !== 'launch' && b.state !== 'land' && b.state !== 'vanish') b.appear = 1;
  }

  /**
   * 드론끼리 비켜 가기(층 나누기): 같은 공역(가로 R 안, 기준 높이 차 DY 안)에서 겹친 짝마다 한쪽이 한 층(UP) 위로.
   * 층 = 실제 높이로 칠함: 기준 높이 낮은 순(같으면 열쇠 순)으로, 이미 정한 짝들의 높이와 SEP_Y 이상 벌어지는 가장 낮은 층
   *   (예전: 열쇠 큰 쪽이 올라감 → 순항 고도가 낮은 탐색 드론이 높은 정찰 드론 쪽으로 올라가 그 높이를 지남). 층이 모자라거나(넷 이상)
   *   이착륙 높이(층을 쓸 수 없음)에서 높이 차가 SEP_Y·0.7 보다 작으면 나중 쪽이 옆으로 비켜 서고(HSIDE, 겹친 짝에서 멀어지는 쪽) 길 위 진행을 잠깐 멈춤(호버, 최대 HOVER).
   * 층(b.alt)은 V 로 천천히 바뀌고, 기준 높이가 LOW～FULL 사이면 비례로 줄어 이착륙·작업 높이에서는 0. b.altY·b.hX·b.hZ = 이번 프레임에 더한 높이·옆 비킴
   */
  _sepDrones(dt, k) {
    const S = BOT.DRONE_SEP, list = this._dr || (this._dr = []);
    list.length = 0;
    for (const b of this.bots.values()) {
      if ((b.kind !== 'scout' && b.kind !== 'recon') || !b.p) continue;
      b._sepN = 0; b._near = null; b._engaged = false;
      // 가로 속도(기준 자리 차 ÷ dt) — 빠른 드론은 R 안에 들어온 뒤 층을 바꾸면 늦으므로 AHEAD 초 앞까지 가장 가까운 거리로 판정
      if (b._sx != null && dt > 0) { b._vx = (b.p.x - b._sx) / dt; b._vz = (b.p.z - b._sz) / dt; } else { b._vx = 0; b._vz = 0; }
      b._sx = b.p.x; b._sz = b.p.z;
      if (b.state === 'out' || b.state === 'back' || b.state === 'work') list.push(b);
      else { if (b.alt) b.alt = 0; b.hx = 0; b.hz = 0; b.hoverT = 0; }
    }
    // 높이 낮은 순(같으면 열쇠 순) — 짝 가운데 앞 쪽이 '먼저 정한' 쪽
    list.sort((a, c) => (Math.abs(a.p.y - c.p.y) > 1e-6 ? a.p.y - c.p.y : a.key < c.key ? -1 : a.key > c.key ? 1 : 0));
    for (let i = 0; i < list.length; i++) list[i]._ord = i;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const c = list[j];
        if (Math.abs(a.p.y - c.p.y) >= S.DY) continue;
        const dx = a.p.x - c.p.x, dz = a.p.z - c.p.z, vx = a._vx - c._vx, vz = a._vz - c._vz, vv = vx * vx + vz * vz;
        const tc = vv > 1e-9 ? Math.max(0, Math.min(S.AHEAD, -(dx * vx + dz * vz) / vv)) : 0; // 가장 가까워지는 때(0～AHEAD)
        const ex = dx + vx * tc, ez = dz + vz * tc;
        if (ex * ex + ez * ez >= S.R * S.R) continue;
        const aw = a.state === 'work', cw = c.state === 'work';
        if (aw && cw) continue; // 둘 다 작업 자리(서가 칸·창밖 자리는 이미 나뉨)
        if (aw || !cw) { (c._sepLo || (c._sepLo = [])).push(a); a._engaged = true; } // c(나중)가 a(먼저) 를 피함 · 작업 중인 쪽은 늘 피해지는 쪽(제자리)
        else { (a._sepLo || (a._sepLo = [])).push(c); c._engaged = true; }
      }
    }
    const NL = Math.round(S.MAX / S.UP) + 1, lift = (b) => clamp01((b.p.y - S.LOW) / (S.FULL - S.LOW));
    for (const b of list) {
      let lv = 0;
      const lo = b._sepLo;
      if ((!lo || !lo.length) && b._engaged && b._lvKeep) lv = Math.min(NL - 1, b._lvKeep); // 나를 피하는 짝이 있는 동안은 층을 내리지 않음(내려오면 그 짝의 높이를 지남)
      else if (lo && lo.length) {
        const okAt = (l) => { const y = b.p.y + l * S.UP; for (const o of lo) if (Math.abs(y - (o.p.y + o._sepN * S.UP)) < S.SEP_Y) return false; return true; }; // 이 층의 실제 높이가 먼저 정한 짝들의 (목표) 높이와 SEP_Y 이상 벌어지나
        const keep = b._lvKeep || 0; // 지금 층이 되면 그대로(짝이 바뀔 때마다 층을 바꾸면 서로 높이를 엇갈려 지나감)
        if (keep > 0 && keep < NL && okAt(keep)) lv = keep;
        else for (; lv < NL; lv++) if (okAt(lv)) break;
        if (lv >= NL) { // 층이 모자람: 가장 덜 붐비는 층(짝과 높이 차가 가장 큰 층)
          let bestLv = NL - 1, bestGap = -1;
          for (let l = 0; l < NL; l++) { let gap = Infinity; for (const o of lo) gap = Math.min(gap, Math.abs(b.p.y + l * S.UP - (o.p.y + o._sepN * S.UP))); if (gap > bestGap) { bestGap = gap; bestLv = l; } }
          lv = bestLv;
        }
      }
      b._sepN = lv; b._lvKeep = (lo && lo.length) || b._engaged ? lv : 0;
      // 실제 높이 차(올림은 LOW～FULL 비례)가 모자란 짝 → 옆 비킴 방향(짝에서 멀어지는 쪽 합)
      if (lo && lo.length) {
        const fb = lift(b), yb = b.p.y + Math.min(S.MAX, lv * S.UP) * fb, yb0 = b.p.y + (b.alt || 0) * fb;
        let rx = 0, rz = 0, n = 0;
        for (const o of lo) {
          const fo = lift(o), yo = o.p.y + Math.min(S.MAX, (o._sepN || 0) * S.UP) * fo, yo0 = o.p.y + (o.alt || 0) * fo;
          const cross = (yb - yo) * (yb0 - yo0) < 0; // 층을 바꾸는 동안 짝의 높이를 지나감(지금 높이 차와 목표 높이 차의 부호가 다름)
          if (Math.abs(yb - yo) >= S.SEP_Y * 0.7 && !(cross && Math.abs(yb0 - yo0) < S.SEP_Y * 0.7)) continue;
          let dx = b.p.x - o.p.x, dz = b.p.z - o.p.z, d = Math.hypot(dx, dz);
          if (d < 1e-3) { dx = -(b._vz || 0) || 1; dz = b._vx || 0; d = Math.hypot(dx, dz) || 1; } // 같은 자리: 진행 방향 오른쪽
          rx += dx / d; rz += dz / d; n++;
        }
        if (n) { const m = Math.hypot(rx, rz) || 1; b._near = { x: rx / m, z: rz / m }; }
        lo.length = 0;
      }
    }
    for (const b of list) {
      const want = Math.min(S.MAX, b._sepN * S.UP), st = S.V * dt * k;
      if (want > 0 && !(b.alt > 0)) this.stats.lifts++;
      b.alt = (b.alt || 0) + Math.max(-st, Math.min(st, want - (b.alt || 0)));
      if (b.alt < 1e-4) b.alt = 0;
      const f = lift(b);
      if (b.alt) { b.altY = b.alt * f; b.p.y += b.altY; }
      // 옆 비킴 + 호버: 높이로 못 나눈 짝이 있으면 그쪽에서 멀어지며 길 위 진행을 멈춤(최대 HOVER 초 — 막힘 없음)
      const nr = b._near, hs = S.HV * dt * k;
      const tx = nr ? nr.x * S.HSIDE : 0, tz = nr ? nr.z * S.HSIDE : 0;
      b.hx = (b.hx || 0) + Math.max(-hs, Math.min(hs, tx - (b.hx || 0)));
      b.hz = (b.hz || 0) + Math.max(-hs, Math.min(hs, tz - (b.hz || 0)));
      if (Math.abs(b.hx) < 1e-4 && Math.abs(b.hz) < 1e-4) { b.hx = 0; b.hz = 0; }
      if (nr && b.seg && (b.state === 'out' || b.state === 'back') && (b.hoverT || 0) < S.HOVER) {
        if (!b.hoverT) this.stats.hovers = (this.stats.hovers || 0) + 1;
        b.seg.t0 += dt; b.hoverT = (b.hoverT || 0) + dt * k;
      } else if (!nr && b.hoverT) b.hoverT = Math.max(0, b.hoverT - dt * k * 0.5);
      if (b.hx || b.hz) { b.hX = b.hx; b.hZ = b.hz; b.p.x += b.hX; b.p.z += b.hZ; }
    }
  }

  _move(b, u, g) {
    const e = b.kind === 'rover' ? clamp01(u) : ease(clamp01(u));
    const o = segAt(b.seg, e, this._o || (this._o = {}));
    b.p.x = o.x; b.p.y = o.y; b.p.z = o.z;
    if (o.dx || o.dz) b.yaw = Math.atan2(o.dx, o.dz);
    b.u = clamp01(u);
  }
}

/** 각도 a 를 b 쪽으로 최대 step 만큼 */
export function turn(a, b, step) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= step ? b : a + Math.sign(d) * step;
}
