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
  const r = book.take(room.id, cat === 'workflow' ? 'agent' : cat, ch.id, cands);
  ch.station = r;
  return r ? r.spot : null;
}
/** 탕비실 자리 잡기: 머신 앞 → 둘레. 다 차면 null(자리에서 대기 동작) */
export function takeBreak(book, ch) {
  const room = ch.room, cands = breakSlots(room);
  if (!cands) return null;
  const r = book.take(room.id, 'break', ch.id, cands);
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
export function separate(chars, dt, opt = CROWD, speed = 1) {
  const list = [];
  for (const ch of chars) {
    if (!ch || ch.state === 'gone' || !ch.placed || ch.offstage || !ch.room) continue;
    if (ch.vanishT0 != null) continue;
    list.push(ch);
  }
  if (list.length < 2 || !(dt > 0)) return false;
  const n = list.length;
  const px = new Float64Array(n), pz = new Float64Array(n), hit = new Uint8Array(n);
  const anc = list.map((c) => anchorOf(c, {}));
  const w = list.map((c, i) => (pinned(c) || anc[i].arrive ? 0 : 1));
  // 걷는 사람의 밀림: 앞뒤 성분 → 진행 방향 오른쪽(rx·rz = (-uz, ux)) 비켜 서기. 마주 오는 둘은 서로 반대쪽으로 비켜 스쳐 지나간다
  const push = (i, mx, mz, follow) => {
    const A = anc[i];
    if (A.walk && !follow) {
      const along = mx * A.ux + mz * A.uz;
      mx -= along * A.ux; mz -= along * A.uz;
      const side = Math.abs(along), rx = -A.uz, rz = A.ux;
      const sg = mx * rx + mz * rz < -1e-6 ? -1 : 1; // 이미 옆으로 밀리는 쪽이 있으면 그쪽, 없으면 오른쪽
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
  const cap = opt.PUSH_V * Math.max(1, speed) * dt; // 빨리 감기면 걸음이 빨라진 만큼(재생 배속 1～6)
  let moved = false;
  for (let i = 0; i < n; i++) {
    if (!w[i]) continue;
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
    if (o > opt.MAX_OFF) { x = A.x + ox * opt.MAX_OFF / o; z = A.z + oz * opt.MAX_OFF / o; }
    if (Math.abs(x - ch.pos.x) > 1e-5 || Math.abs(z - ch.pos.z) > 1e-5) { ch.pos.x = x; ch.pos.z = z; moved = true; if (A.walk) ch.nudged = true; }
  }
  return moved;
}
