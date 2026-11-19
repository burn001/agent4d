// 복셀 오피스 겹침 막기 — 순수(three·DOM 없음). 3D(office.js)와 2D 평면도(flat/voxel2d.js)가 같이 쓴다
// (node --test 대상: web/test/vx-crowd.test.mjs).
//   · SpotBook: 시설 자리(슬롯) 예약 장부 — 방마다 누가 어느 시설의 몇 번째 자리에 서 있는지. 도착(요청) 순서대로 앞 번호부터,
//     다른 시설 예약 자리와 SLOT_GAP 안이면 건너뛴다(탕비실 둘레 ↔ 도구 상자 대기 줄처럼 시설끼리 붙은 곳). 다 차면 null
//     → 부르는 쪽이 대체 행동(제자리 작업·자리에서 기지개). 떠나면 release
//   · separate: 가벼운 밀어내기 — 같은 방(또는 같은 라운지 방문)의 두 캐릭터가 MIN_D 보다 가까우면 서로 반씩 민다(책상에 선 사람은
//     움직이지 않음). 밀린 거리는 기준점(걷는 중 = 지금 길 위 가장 가까운 점, 서 있으면 목표 자리)에서 MAX_OFF 안으로 묶어
//     벽·가구를 뚫지 않게 하고, 겹침이 풀리면 서 있던 사람은 기준점으로 천천히 돌아온다. 걷는 사람은 앞뒤로 밀지 않고 진행 방향
//     오른쪽으로 비켜 선다(마주 오는 둘은 서로 반대쪽 → 관통 대신 스쳐 지나감, 뒤따르는 둘은 나란히)

import { breakSlots } from './office-core.mjs';
import { navClear } from './nav-core.mjs';

const BOT_OFF = 0.9, BOT_CLR = 0.25; // 바퀴 로봇 곁 밀림 한도 · 가구와 떨어질 거리

export const CROWD = {
  SLOT_GAP: 0.8,   // 다른 시설 예약 자리와 이보다 가까운 후보는 건너뜀
  MIN_D: 0.72,     // 두 캐릭터 중심 최소 거리(몸통 폭 ≈ 0.6)
  WALK_D: 1.15,    // 둘 중 하나라도 걷는 중이면 이 거리부터 비켜 서기 시작(마주 오면 한 프레임에 지나쳐 버리므로 미리)
  PUSH_V: 4.5,     // 초당 최대 밀림(세계 단위) — 걸음(3.5)보다 커야 뒤따르는 사람이 앞사람을 뚫지 않는다
  BACK_V: 1.2,     // 겹침이 풀린 뒤 기준점으로 돌아오는 비율(초당)
  MAX_OFF: 0.42,   // 기준점에서 이보다 멀리 밀지 않음(통로·시설 앞을 벗어나지 않게)
  ARRIVE_R: 1.0,   // 마지막 조각에서 목적지까지 이 안이면 '도착 중' — 밀리지 않음(자리는 SpotBook 이 이미 갈라 놓음)
  CORNER: 0.45,    // 밀려난 사람은 꺾이는 점에 이만큼 가까워지면 다음 조각으로(밀림 ↔ 길 되돌아오기 맞버팀 방지, Character._move)
};

export class SpotBook {
  constructor() { this.rooms = new Map(); this.byId = new Map(); }
  /**
   * id 가 room 의 key 시설 자리 하나를 잡는다. cands = 후보 자리 배열(앞이 먼저 — 접근점 → 대기 줄). 이미 같은 시설을 잡고 있으면 그 자리.
   * 반환 = {roomId, key, id, idx, spot} | null(다 참)
   */
  take(roomId, key, id, cands, gap = CROWD.SLOT_GAP) {
    const cur = this.byId.get(id);
    if (cur && cur.roomId === roomId && cur.key === key) return cur;
    this.release(id);
    if (!cands || !cands.length) return null;
    let m = this.rooms.get(roomId);
    if (!m) { m = new Map(); this.rooms.set(roomId, m); }
    const g2 = gap * gap;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (!c) continue;
      let ok = true;
      for (const r of m.values()) {
        if (r.key === key) { if (r.idx === i) { ok = false; break; } continue; } // 같은 시설 안 자리 간격은 설계값
        const dx = r.spot.x - c.x, dz = r.spot.z - c.z;
        if (dx * dx + dz * dz < g2) { ok = false; break; }
      }
      if (!ok) continue;
      const r = { roomId, key, id, idx: i, spot: c };
      m.set(id, r); this.byId.set(id, r);
      return r;
    }
    return null;
  }
  release(id) {
    const r = this.byId.get(id);
    if (!r) return;
    this.byId.delete(id);
    const m = this.rooms.get(r.roomId);
    if (m) { m.delete(id); if (!m.size) this.rooms.delete(r.roomId); }
  }
  /** 방이 옮겨졌으면 그 방 예약을 모두 비움 */
  dropRoom(roomId) {
    const m = this.rooms.get(roomId);
    if (!m) return;
    for (const id of m.keys()) this.byId.delete(id);
    this.rooms.delete(roomId);
  }
  clear() { this.rooms.clear(); this.byId.clear(); }
  get(id) { return this.byId.get(id) || null; }
  /** room·key 의 idx 번째 자리를 잡은 id(없으면 null) */
  holder(roomId, key, idx) {
    const m = this.rooms.get(roomId);
    if (m) for (const r of m.values()) if (r.key === key && r.idx === idx) return r.id;
    return null;
  }
  count(roomId, key) {
    const m = this.rooms.get(roomId);
    let n = 0;
    if (m) for (const r of m.values()) if (r.key === key) n++;
    return n;
  }
}

/** 방의 cat 시설 후보 자리(접근점 → 대기 줄). 방 객체에 기억 */
export function stationCands(room, cat) {
  if (!room || !room.stations || !room.stations[cat]) return null;
  const memo = room._stCands || (room._stCands = {});
  return memo[cat] || (memo[cat] = [...room.stations[cat], ...((room.queues && room.queues[cat]) || [])]);
}

/** 시설 자리 잡기(3D·2D 공용): cat 시설의 빈 자리(접근점 → 대기 줄). 다 차면 null(제자리 작업). ch.station = 예약 */
export function takeStation(book, ch, cat) {
  const room = ch.room, cands = stationCands(room, cat);
  if (!cands) return null;
  const r = book.take(room.spotRoomId || room.id, cat === 'workflow' ? 'agent' : cat, ch.id, cands); // 연구소 구역 방끼리 시설 공유(spotRoomId)
  ch.station = r;
  return r ? r.spot : null;
}
/** 탕비실 자리 잡기: 머신 앞 → 둘레. 다 차면 null(자리에서 대기 동작) */
export function takeBreak(book, ch) {
  const room = ch.room, cands = breakSlots(room);
  if (!cands) return null;
  const r = book.take(room.spotRoomId || room.id, 'break', ch.id, cands);
  ch.station = r;
  return r ? r.spot : null;
}
export function releaseSpot(book, ch) { book.release(ch.id); ch.station = null; }

const isWalk = (ch) => ch.state === 'walk' || ch.state === 'leave' || ch.state === 'enter';
/** 책상(자기 자리)에 선 사람·깜빡 이동 중은 밀리지 않음 */
function pinned(ch) {
  if (ch.state === 'blink') return true;
  if ((ch.state === 'seated' || ch.state === 'work') && (!ch.target || ch.target.type === 'desk' || ch.target.type === 'door')) return true;
  return false;
}
/** 기준점: 걷는 중이면 지금 길 조각 위 가장 가까운 점(+ 진행 방향 ux·uz), 서 있으면 목표 자리 */
function anchorOf(ch, out) {
  out.walk = false; out.ux = 0; out.uz = 0; out.arrive = false;
  if (isWalk(ch) && ch.path && ch.pi > 0 && ch.pi < ch.path.length) {
    // 목적지 코앞(ARRIVE_R 안, 마지막 조각)이면 밀지 않는다 — 옆 자리(0.9 간격)에 선 사람에게 밀려 영영 못 닿는 일을 막음
    const end = ch.path[ch.path.length - 1];
    if (ch.state === 'walk' && ch.pi === ch.path.length - 1 && Math.hypot(end.x - ch.pos.x, end.z - ch.pos.z) < CROWD.ARRIVE_R) out.arrive = true;
    const a = ch.path[ch.pi - 1], b = ch.path[ch.pi];
    const vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz;
    const k = L2 > 1e-9 ? Math.max(0, Math.min(1, ((ch.pos.x - a.x) * vx + (ch.pos.z - a.z) * vz) / L2)) : 0;
    out.x = a.x + vx * k; out.z = a.z + vz * k; out.walk = true;
    if (L2 > 1e-9) { const L = Math.sqrt(L2); out.ux = vx / L; out.uz = vz / L; }
    return out;
  }
  const s = ch.target && (ch.target.type === 'desk' ? ch.seat : ch.target.spot);
  if (s && Number.isFinite(s.x)) { out.x = s.x; out.z = s.z; return out; }
  out.x = ch.pos.x; out.z = ch.pos.z;
  return out;
}
/** 짝 고르기: 같은 방이거나 둘 다 라운지 방문 중(방 밖) */
const together = (a, b) => (a.room && b.room && a.room === b.room) || (a.target && b.target && a.target.type === 'visit' && b.target.type === 'visit');

/**
 * 가벼운 밀어내기 한 걸음(순수). chars = 캐릭터 반복 가능 객체, dt = 초, speed = 걸음 배속(재생 1～6). 반환 = 누군가 움직였나.
 * 짝마다 겹친 만큼을 무게(밀리는 쪽 1, 책상 0)로 나눠 미루고 한꺼번에 적용(순서 무관). 같은 점이면 id 순서로 방향을 정한다(결정적).
 * 걷는 사람은 밀림의 앞뒤 성분을 진행 방향 오른쪽 비켜 서기로 바꾼다(앞뒤로 밀면 길을 되돌아가거나 관통). 같은 쪽으로 걷는 둘은 앞뒤로 벌어짐
 */
/** solid(ch, x, z) → true 면 그 자리로는 밀지 않음(가구·벽 안 — 복셀 연구소처럼 큰 방은 nav-core navSolid, 없으면 예전대로) */
export function separate(chars, dt, opt = CROWD, speed = 1, solid = null, obs = null) {
  const list = [];
  for (const ch of chars) {
    if (!ch || ch.state === 'gone' || !ch.placed || ch.offstage || !ch.room) continue;
    if (ch.vanishT0 != null) continue;
    list.push(ch);
  }
  const nObs = obs ? obs.length : 0;
  if ((list.length < 2 && !nObs) || !(dt > 0)) return false;
  const n = list.length;
  const px = new Float64Array(n), pz = new Float64Array(n), hit = new Uint8Array(n);
  const anc = list.map((c) => anchorOf(c, {}));
  const pin = list.map((c) => pinned(c));
  const w = list.map((c, i) => (pin[i] || anc[i].arrive ? 0 : 1));
  const wo = nObs ? new Uint8Array(n) : null; // 바퀴 로봇에 밀린 사람(도착 중이어도 — 로봇 곁에 닿은 채 도착하지 않게)
  // 걷는 사람의 밀림: 앞뒤 성분 → 진행 방향 오른쪽(rx·rz = (-uz, ux)) 비켜 서기. 마주 오는 둘은 서로 반대쪽으로 비켜 스쳐 지나간다
  const push = (i, mx, mz, follow, toPath = false) => {
    const A = anc[i];
    if (A.walk && !follow) {
      const along = mx * A.ux + mz * A.uz;
      mx -= along * A.ux; mz -= along * A.uz;
      const side = Math.abs(along), rx = -A.uz, rz = A.ux;
      const lat = mx * rx + mz * rz;
      let sg = lat < -1e-6 ? -1 : 1; // 이미 옆으로 밀리는 쪽이 있으면 그쪽, 없으면 오른쪽
      if (toPath && Math.abs(lat) < side * 0.5) { // 바퀴 로봇이 거의 정면: 길에서 이미 밀려난 쪽이 아니라 길 쪽으로 돌아 지나감(밀림 한도에 걸려 로봇을 뚫지 않게)
        const c = list[i], off = (c.pos.x - A.x) * rx + (c.pos.z - A.z) * rz;
        if (Math.abs(off) > 0.05) sg = off > 0 ? -1 : 1;
      }
      mx += rx * side * sg; mz += rz * side * sg;
    }
    px[i] += mx; pz[i] += mz;
  };
  for (let i = 0; i < n; i++) {
    const a = list[i];
    for (let j = i + 1; j < n; j++) {
      const b = list[j];
      if (w[i] + w[j] === 0 || !together(a, b)) continue;
      const md = (anc[i].walk && !anc[i].arrive) || (anc[j].walk && !anc[j].arrive) ? opt.WALK_D : opt.MIN_D;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz, near = md + 0.1;
      if (d2 >= near * near) continue;
      hit[i] = hit[j] = 1; // 막 벌어진 짝은 기준점으로 되돌리지 않음(되돌리면 다시 겹쳐 떨림)
      if (d2 >= md * md) continue;
      const d = Math.sqrt(d2);
      let ux, uz;
      if (d < 1e-4) { // 같은 점: 두 해시·id 순서로 정한 방향(결정적)
        const h = (((a.hash || 0) ^ (b.hash || 0)) >>> 0) % 360, s = a.id < b.id ? 1 : -1;
        ux = Math.cos(h * Math.PI / 180) * s; uz = Math.sin(h * Math.PI / 180) * s;
      } else { ux = dx / d; uz = dz / d; }
      const over = md - d, ws = w[i] + w[j];
      // 같은 쪽으로 걷는 둘(뒤따름)은 앞뒤로 벌어져 줄을 서고, 그 밖(마주 옴·서 있는 사람 곁)은 걷는 쪽이 비켜 선다
      const follow = anc[i].walk && anc[j].walk && anc[i].ux * anc[j].ux + anc[i].uz * anc[j].uz > 0.5;
      if (follow) { // 뒤에 오는 사람만 겹친 만큼 물러남(앞사람은 그대로) — 프레임이 성겨도 한 걸음보다 크게 벌어짐
        const jAhead = anc[i].ux * ux + anc[i].uz * uz >= 0;
        if (jAhead) push(i, -ux * over, -uz * over, true); else push(j, ux * over, uz * over, true);
        continue;
      }
      push(i, -ux * over * w[i] / ws, -uz * over * w[i] / ws, false);
      push(j, ux * over * w[j] / ws, uz * over * w[j] / ws, false);
    }
  }
  // 바퀴 로봇(obs = [{x,z,r,roomId}]) = 밀리지 않는 몸: 곁의 직원만 민다(걷는 사람은 위와 같이 옆으로 비켜 섬)
  if (nObs) for (let i = 0; i < n; i++) {
    if (pin[i]) continue;
    const arr = !w[i]; // 도착 코앞: 움직이는 로봇에만 밀림(멈춰 일하는 로봇 곁이 목적지면 그 자리에 섬 — 밀면 영영 못 닿음)
    const a = list[i], rid = a.room.id;
    for (let k = 0; k < nObs; k++) {
      const o = obs[k];
      if (o.roomId !== rid || (o.ahead && anc[i].walk) || (arr && !o.moving)) continue; // 기다리는 로봇 앞 점(ahead)은 서 있는 사람만 민다(걷는 사람은 옆을 지나감)
      const md = (anc[i].walk && !anc[i].arrive ? opt.WALK_D - 0.72 : 0) + 0.3 + (o.r ?? 0.42) + 0.04;
      const dx = a.pos.x - o.x, dz = a.pos.z - o.z, d2 = dx * dx + dz * dz, near = md + 0.1;
      if (d2 < (md + 0.4) * (md + 0.4)) wo[i] |= 2; // 로봇 곁(밀림 한도를 줄여 로봇 쪽으로 끌려 들어가지 않게)
      if (d2 >= near * near) continue;
      hit[i] = 1;
      if (d2 >= md * md) continue;
      const d = Math.sqrt(d2);
      const ux = d < 1e-4 ? 1 : dx / d, uz = d < 1e-4 ? 0 : dz / d;
      push(i, ux * (md - d), uz * (md - d), false, true);
      wo[i] |= 1;
    }
  }
  const cap = opt.PUSH_V * Math.max(1, speed) * dt; // 빨리 감기면 걸음이 빨라진 만큼(재생 배속 1～6)
  let moved = false;
  for (let i = 0; i < n; i++) {
    if (!w[i] && !(wo && (wo[i] & 1))) continue;
    const ch = list[i], A = anc[i];
    let mx = px[i], mz = pz[i];
    const m = Math.hypot(mx, mz);
    if (m > cap) { mx *= cap / m; mz *= cap / m; }
    let x = ch.pos.x + mx, z = ch.pos.z + mz;
    if (!hit[i]) { // 겹침이 풀렸으면 기준점(서 있던 자리 · 길 한가운데)으로 천천히
      const k = Math.min(1, opt.BACK_V * dt * (A.walk ? 1.5 : 4));
      x += (A.x - x) * k; z += (A.z - z) * k;
    }
    const ox = x - A.x, oz = z - A.z, o = Math.hypot(ox, oz);
    // 바퀴 로봇에 밀린 걷는 사람은 BOT_OFF 까지(로봇을 돌아 지나가게 — MAX_OFF 에 걸려 차체를 뚫었다), 가구·벽 곁(BOT_CLR 안)으로는 MAX_OFF 까지만
    let mo = wo && (wo[i] & 1) && A.walk && o > opt.MAX_OFF && navClear(ch.room, x, z) >= BOT_CLR ? BOT_OFF : opt.MAX_OFF;
    // 로봇에 밀려 MAX_OFF 밖에 있던 사람은 한도로 한 번에 끌려오지 않음(예전: 가구 곁·길 꺾임에서 0.9 → 0.42 순간 이동 → 기다리는 로봇 쪽으로 들어가 0.35 까지 붙음).
    //   로봇 곁이면 지금 벗어난 만큼 유지, 아니면 밀림 속도(cap)로 천천히 돌아옴
    if (o > mo && wo && A.walk) { const po = Math.hypot(ch.pos.x - A.x, ch.pos.z - A.z); if (po > mo) mo = Math.min(BOT_OFF, wo[i] & 2 ? po : Math.max(mo, po - cap)); }
    if (o > mo) { x = A.x + ox * mo / o; z = A.z + oz * mo / o; }
    if (solid && solid(ch, x, z) && !solid(ch, ch.pos.x, ch.pos.z)) continue; // 밀려서 가구·벽 안으로 들어가지 않게
    if (Math.abs(x - ch.pos.x) > 1e-5 || Math.abs(z - ch.pos.z) > 1e-5) { ch.pos.x = x; ch.pos.z = z; moved = true; if (A.walk) ch.nudged = true; }
  }
  return moved;
}

/**
 * 걷는 직원이 바퀴 로봇에게 길을 비켜 줌(잠깐 멈춤) — 순수. 3D(office.js)·2D(voxel2d.js) 공용.
 *   obs = [{x,z,r,roomId,prio,fx,fz}] 바퀴 로봇(prio = 열린 호출을 들고 출동 중 — vx-bot-core roverPrio, fx·fz = 진행 방향)
 *   걷는 직원의 진행 방향 앞 LOOK 안·옆 간격 HALF 안에 우선 로봇(지금 자리 또는 곧 갈 자리)이 있으면 ch.yieldUntil 까지 멈춘다(한 번 멈추면 적어도 MIN).
 *   이미 NEAR 안으로 붙었으면 멈추지 않는다(멈추면 로봇 길을 막음 — 걸어서 빠져나감). 로봇이 멈춰 기다리는 중이면 우선 아님(roverObstacles).
 *   o.path = [x0,z0, x1,z1, …] 로봇 길 위 앞 점(— 꺾이는 길을 따라 미리 봄, 없으면 fx·fz 곧은 앞)
 *   우선순위(교착 없음): 우선 로봇은 옆 비킴이 되면 멈춘 직원 곁을 지나가고, 모자라면 멈춘다 — 멈춘 로봇은 우선이 아니라 직원이 먼저 지나간다.
 *   직원은 우선 아닌 로봇을 기다리지 않는다(로봇이 기다림).
 *   막힘 상한: 멈춘 시간이 MAX 를 넘으면 FREE 동안 양보하지 않고 걷는다(밀어내기 separate 가 옆으로 비켜 세움). 시간은 배속(1～6)으로 나눔.
 *   반환 = 지금 멈춘 직원 수
 */
export const YIELD = { LOOK: 1.4, HALF: 0.8, MIN: 0.3, MAX: 1.5, FREE: 1.5, DECAY: 0.5, NEAR: 0.75, BEHIND_D: 1.25, PASS: 0.8, HOLD_MAX: 6 }; // BEHIND_D 멈춘 로봇 앞뒤에서 멈출 거리 · PASS 로봇 곁 지나갈 자리 · HOLD_MAX 멈춘 로봇 때문에 기다리는 상한(초)
const PREDICT = [0, 0.6, 1.2]; // 로봇 진행 방향(fx·fz) 앞 거리(o.path 가 없을 때)
export function botYield(chars, obs, now, dt, speed = 1, opt = YIELD) {
  const k = Math.min(6, Math.max(1, speed));
  let n = 0;
  for (const ch of chars) {
    if (!ch || !ch.room) continue;
    const walking = isWalk(ch) && ch.path && ch.pi > 0 && ch.pi < ch.path.length && ch.vanishT0 == null;
    if (!walking) { if (ch.yieldT) ch.yieldT = 0; if (ch.yieldUntil) ch.yieldUntil = 0; continue; }
    let block = false, hold = false; // hold = 멈춘 로봇 때문(막힘 상한 MAX 를 세지 않음 — 로봇이 먼저 풀어 줌)
    if (obs && obs.length && !(now < (ch.yieldFree || 0))) {
      const q = ch.path[ch.pi], vx = q.x - ch.pos.x, vz = q.z - ch.pos.z, L = Math.hypot(vx, vz);
      if (L > 1e-6) {
        const ux = vx / L, uz = vz / L, rid = ch.room.id;
        for (const o of obs) {
          if (o.roomId !== rid) continue;
          if (!o.prio) { // 우선 아닌(멈춰 기다리는) 로봇이라도 내가 그 뒤·옆 뒤에서 차체로 걸어 들어가면 멈춤 — 로봇은 제 뒤 직원을 기다리지 않으므로 서로 막힘 없음(좁은 통로에서 0.16 까지 붙음)
            if (o.ahead || !o.moving) continue;
            const dx = o.x - ch.pos.x, dz = o.z - ch.pos.z, f = dx * ux + dz * uz, lat = dx * -uz + dz * ux, back = -(dx * (o.fx || 0) + dz * (o.fz || 0));
            if (!(f > 0 && f < opt.BEHIND_D && Math.abs(lat) < opt.HALF)) continue;
            if (back < -0.45) { block = true; hold = true; break; }
            // 멈춰 기다리는 로봇 앞으로 마주 걸어옴: 옆으로 돌아 지나갈 틈(로봇 곁 PASS 자리가 가구와 0.3)이 양쪽 다 없으면 멈춤(좁은 통로 — 지나가면 차체에 0.3 까지 붙음).
            //   로봇은 막힘 풀기(다시 찾기 → 뒤로 비켜 섬)로 먼저 풀어 줌
            if (o.waiting && back > 0.3) {
              const nx = -uz, nz = ux, P = opt.PASS;
              if (navClear(ch.room, o.x + nx * P, o.z + nz * P) < 0.3 && navClear(ch.room, o.x - nx * P, o.z - nz * P) < 0.3) { block = true; hold = true; break; }
            }
            continue;
          }
          if (Math.hypot(o.x - ch.pos.x, o.z - ch.pos.z) < opt.NEAR) continue; // 이미 붙어 있으면 멈추지 않고 빠져나감(멈추면 로봇 길을 막음)
          const np = o.path ? o.path.length / 2 : 0; // 로봇 길 위 앞 점(꺾이는 길 — 모퉁이를 돌아 들어오는 로봇도 미리 봄)
          for (let a = 0; a < (np ? np + 1 : PREDICT.length); a++) { // 지금 자리 + 로봇이 곧 갈 자리(옆에서 가로질러 오는 로봇도 길에 들어서기 전에 멈춤)
            const px = np ? (a ? o.path[a * 2 - 2] : o.x) : o.x + (o.fx || 0) * PREDICT[a], pz = np ? (a ? o.path[a * 2 - 1] : o.z) : o.z + (o.fz || 0) * PREDICT[a];
            const dx = px - ch.pos.x, dz = pz - ch.pos.z, f = dx * ux + dz * uz;
            if (f <= 0 || f > opt.LOOK) continue;
            if (Math.abs(dx * -uz + dz * ux) < opt.HALF) { block = true; break; }
          }
          if (block) break;
        }
      }
    }
    if (block) {
      const was = now < (ch.yieldUntil || 0);
      ch.yieldUntil = Math.max(ch.yieldUntil || 0, now + (was ? Math.max(dt * 1.5, 0.05) : opt.MIN / k));
      if (!hold) ch.yieldT = (ch.yieldT || 0) + dt * k;
      else if ((ch.holdT = (ch.holdT || 0) + dt * k) > opt.HOLD_MAX) { ch.yieldT = opt.MAX + 1e-3; ch.holdT = 0; } // 멈춘 로봇 때문이면 HOLD_MAX 까지(로봇 쪽 풀기가 끝내 안 되면 상한으로)
      if (ch.yieldT > opt.MAX) { ch.yieldFree = now + opt.FREE / k; ch.yieldUntil = 0; ch.yieldT = 0; ch.yieldOver = (ch.yieldOver || 0) + 1; }
    } else { if (ch.yieldT) ch.yieldT = Math.max(0, ch.yieldT - dt * k * opt.DECAY); if (ch.holdT) ch.holdT = 0; }
    if (now < (ch.yieldUntil || 0)) n++;
  }
  return n;
}
