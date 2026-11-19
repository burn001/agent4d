// 복셀 오피스 도구 로봇 팀 — 로봇 자리·길·장애(순수, three·DOM 없음). 3D vx-bots.js 와 2D flat/vx2d-bots.js 가 같이 쓴다.
//   책상 출발점(pad) · 작업 자리(goal) · 서버랙/회의실 단말 함(botRack) · 창(botWindow) · 길(route: 드론 = 순항 고도, 바퀴 = 바닥 길찾기)
//   · 바퀴 로봇이 비켜 갈 장애(blockers: 같은 방 직원·다른 바퀴 로봇)
// view 는 chars(Map nodeId → Character: room·seat·pos·state)·_now·ts 만 쓴다(3D VoxelView·2D Voxel2DView 공통).
import { BOT, botKind, botSpeedK, flightPts, roverPrio, segAt } from './vx-bot-core.mjs';
import { OFFICE_FX, MEET_FX, roomPoint } from './office-core.mjs';
import { navPath, navClear, navClearNear, navReach, navSpot, roomNav, botNavClock, botNavGen, BOT_NAV } from './nav-core.mjs';
import { rotXZ, windowWall } from './xf.mjs';
import { hashStr } from './layout.js';

const PI = Math.PI;
const WALK_V = 3.5; // 직원 걸음(character-core WALK_SPEED 와 같은 값)
const NEAR_R = 4.5; // 장애 목록에 넣는 로봇 둘레(앞 LOOK 1.8 + 걸음·미리 보기 여유)
const ARRIVE_R = 0.5; // 걷는 직원이 이보다 도착점에 가까우면 서 있는 사람으로 본다
const AHEAD_PUSH = 0.55; // 기다리는 바퀴 로봇 앞 밀어내기 점(차체 앞)
/** 스탠딩 데스크 상판 높이(props.js DESK_TOP 과 같은 값 — props.js 는 three 를 불러 여기서 못 씀) */
export const BOT_DESK_TOP = 0.92;
const Y_SCOUT = { read: 1.55, search: 1.15 };

/** 로봇이 들어갈 수 있는 방(사무실·회의실 — 연구소·별관 바깥은 없음) */
export const botRoomOk = (room) => !!room && (room.type === 'office' || room.type === 'meeting');

/** 도구 시작 → 장부에 출동(조건: 로봇 종류·자리 있는 직원·방). 반환 = 로봇 | null. 직원 지시 손짓(ch.cmdUntil)도 여기서 */
export function botStart(book, view, nodeId, ev, quiet) {
  const ch = view.chars.get(nodeId);
  const kind = botKind(ev.cat);
  if (!kind || !ch || !ch.room || !botRoomOk(ch.room) || !ch.seat || ch.seat.kind === 'wait') return null;
  if (kind === 'recon' && ch.room.type !== 'office') return null; // 창 벽은 사무실만
  if (kind === 'rover' && !book.bots.has(nodeId + '|rover') && !roverCanGo(ch)) return null; // 랙에 닿을 길이 없는 책상(갇힌 출발점) = 출동 없음(홀로그램 모니터만)
  const b = book.start(nodeId, ev.toolUseId, ev.cat, view._now, { quiet, roomId: ch.room.id });
  if (b && !quiet && kind !== 'arm' && b.calls === 1) ch.cmdUntil = view._now + 0.75 / botSpeedK(view.ts); // 직원이 지시(손 뻗기)
  return b;
}

/**
 * 자리가 아직 없어 출동 못 한 열린 호출(스냅샷의 열린 도구·막 들어온 직원)을 기억했다가 자리가 생기면 출동시킨다.
 * add = botStart 가 null 이고 로봇 종류일 때 · drop = 도구 끝 · step = 매 프레임(최대 PEND_S 초 기다림)
 */
export class BotPending {
  constructor() { this.m = new Map(); } // toolUseId → {nodeId, ev, quiet, t}
  get size() { return this.m.size; }
  add(nodeId, ev, quiet, now) { if (ev && ev.toolUseId && botKind(ev.cat)) this.m.set(ev.toolUseId, { nodeId, ev, quiet, t: now }); }
  drop(tid) { if (tid != null) this.m.delete(tid); }
  dropNode(id) { for (const [k, q] of this.m) if (q.nodeId === id) this.m.delete(k); }
  clear() { this.m.clear(); }
  step(book, view, now) {
    if (!this.m.size) return;
    for (const [k, q] of this.m) {
      if (now - q.t > BotPending.PEND_S) { this.m.delete(k); continue; }
      const ch = view.chars.get(q.nodeId);
      if (!ch || !ch.room || !ch.seat) continue;
      this.m.delete(k);
      botStart(book, view, q.nodeId, q.ev, true); // 기다린 호출 = 이미 진행 중 → 바로 작업 자리(스냅샷과 같음)
    }
  }
}
BotPending.PEND_S = 8;

/** 책상 치수·방향: 가운데(x,z)·앞(fx,fz = 직원이 보는 쪽)·옆(rx,rz) — 팀장 2.0×0.9 · 보조 1.1 · 팀원 1.3×0.7 (props.js standDesk) */
export function deskOf(ch) {
  const s = ch && ch.seat;
  if (!s || s.kind === 'wait' || s.deskX == null) return null;
  const lead = s.kind === 'lead', aux = s.kind === 'aux';
  const f = s.face || 0, fx = Math.sin(f), fz = Math.cos(f);
  return { x: s.deskX, z: s.deskZ, wide: lead ? 2.0 : aux ? 1.1 : 1.3, depth: lead ? 0.9 : 0.7, fx, fz, rx: -fz, rz: fx, face: f };
}

/**
 * 셸 로봇이 갈 랙(세계): 사무실 = 서버랙(뒤 오른쪽 구석, 앞 +z) · 회의실 = 단말 함(뒤 벽 오른쪽, 앞 +z).
 * { x,z(몸통 가운데), ax,az(앞 접근점), yaw(로봇이 랙을 보는 각), front(앞 단위), depth, w(앞면 폭), h, units, y0, step, screen? }
 */
export function botRack(room) {
  if (!room) return null;
  const k = room.xf ? room.xf.k : 0;
  if (room.type === 'meeting') {
    const M = MEET_FX.term;
    const front = rotXZ(0, 1, k);
    const c = roomPoint(room, M.x, M.z), a = roomPoint(room, M.x, M.z + M.d / 2 + 0.55);
    return { x: c.x, z: c.z, ax: a.x, az: a.z, yaw: PI + k * PI / 2, front, depth: M.d, w: M.w, h: M.h, units: M.units, y0: M.y0, step: M.step, screen: { y: M.screenY, h: M.screenH, w: M.screenW }, meet: true };
  }
  if (room.type !== 'office') return null;
  const R = OFFICE_FX.rack;
  const front = rotXZ(0, 1, k);
  const c = roomPoint(room, R.x, R.z), a = roomPoint(room, R.x, R.z + R.d / 2 + 0.6);
  return { x: c.x, z: c.z, ax: a.x, az: a.z, yaw: PI + k * PI / 2, front, depth: R.d, w: R.w, h: R.h, units: 6, y0: 0.3, step: 0.26, screen: null, meet: false };
}

/** 정찰 드론 창: 창 벽 안쪽(높이 2.75)·바깥(높이 3.4) */
export function botWindow(room, ch, h) {
  const ww = windowWall(room), base = room.xf && room.local ? room.local : room;
  const lx0 = ch.seat && ch.seat.deskLX != null ? ch.seat.deskLX : 0;
  const lx = Math.max(-9.5, Math.min(9.5, lx0 + ((h % 5) - 2) * 0.35));
  const wz = ww === 'back' ? -9 : (base.bounds ? base.bounds.maxZ - base.origin.z : 9 + (room.ext || 0)), s = ww === 'back' ? -1 : 1;
  const a = roomPoint(room, lx, wz - s * 0.7), o = roomPoint(room, lx, wz + s * 2.4);
  const k = room.xf ? room.xf.k : 0;
  return { in: { x: a.x, y: BOT.CRUISE.recon, z: a.z }, out: { x: o.x, y: 3.4, z: o.z }, yaw: (s < 0 ? PI : 0) + k * PI / 2 };
}

/**
 * 직원 쪽에서 본 바퀴 로봇(밀리지 않는 몸 + 우선 표시) — crowd-core separate·botYield 에 넘김. out 배열을 다시 씀.
 * 사라지는 중(vanish)·작아지는 중(appear < 0.5)은 뺀다. now = 벽시계(겹쳐 지나가는 중 판정)
 */
export function roverObstacles(book, out = [], now = 0) {
  out.length = 0;
  let i = 0;
  for (const b of book.bots.values()) {
    if (b.kind !== 'rover' || !b.p || b.state === 'vanish' || b.state === 'gone' || (b.appear ?? 1) < 0.5) continue;
    const o = out._pool && out._pool[i] ? out._pool[i] : {};
    if (!out._pool) out._pool = [];
    out._pool[i++] = o;
    o.x = b.p.x; o.z = b.p.z; o.r = 0.42; o.roomId = b.roomId; o.fx = Math.sin(b.yaw); o.fz = Math.cos(b.yaw); o.prio = roverPrio(b) && !b.waiting && !b.endZone && !(now < b.ghostUntil); o.ahead = false; o.moving = b.state === 'out' || b.state === 'back'; o.waiting = !!b.waiting && !(now < b.ghostUntil); o.path = roverAhead(b, o.path); // 멈춰 기다리는 중·겹쳐 지나가는 중·도착 직전(— 로봇이 기다림)이면 우선 아님(서로 멈춤 없음)
    out.push(o);
    if (b.waiting && (b.state === 'out' || b.state === 'back')) { // 멈춰 기다리면 차체 앞 한 뼘(AHEAD_PUSH)도 몸 — 길에 선 직원이 밀려 비켜 섬(겹쳐 지나가기 전에)
      const e = out._pool[i] || {};
      out._pool[i++] = e;
      e.x = b.p.x + o.fx * AHEAD_PUSH; e.z = b.p.z + o.fz * AHEAD_PUSH; e.r = 0.42; e.roomId = b.roomId; e.fx = o.fx; e.fz = o.fz; e.prio = false; e.ahead = true; e.moving = true; e.waiting = false; e.path = null;
      out.push(e);
    }
  }
  return out;
}

const AHEAD_D = [0.6, 1.2, 1.8];
/** 바퀴 로봇 길 위 앞 점 [x,z,…](AHEAD_D 거리, 꺾이는 길을 따라) — 직원 비켜 주기(botYield)가 모퉁이를 돌아오는 로봇도 미리 보게. 길 위가 아니면 null */
function roverAhead(b, arr) {
  const seg = b.seg;
  if (!seg || !(b.state === 'out' || b.state === 'back') || !(seg.len > 0)) return null;
  const out = arr || [], u = b.u ?? 0, o = roverAhead._o || (roverAhead._o = {});
  out.length = 0;
  for (const d of AHEAD_D) { const v = u + d / seg.len; if (v > 1) break; segAt(seg, v, o); out.push(o.x, o.z); }
  if (out.length < 2 * AHEAD_D.length) { const e = seg.pts[seg.pts.length - 1]; out.push(e.x, e.z); }
  return out;
}

/** 바퀴 로봇 차체 반폭(가구·벽과 이만큼 떨어짐 — 옆 비킴 한도·출발점 판정) */
export const BOT_BODY = 0.36;
const SIDE_AHEAD = [0, 0.4, 0.8];

/**
 * 바퀴 로봇 출발점: 책상 끝 옆 바닥(책상 옆 0.42). 회의실 자리(회의 탁자 — 책상 끝이 탁자 안)·가구 곁이면 직원 등 뒤 바닥.
 * (예전: 회의실은 탁자 안에서 나와 탁자 반대쪽으로 빙 돌아 단말 함까지 15～17 단위 → 상한 3.2초 + 이륙, 지나는 길 직원 곁에서 멈춤 — 4～5초)
 */
export function roverPad(ch, d = deskOf(ch)) {
  if (!d) return null;
  const s = ch.seat, room = ch.room, m = ch._rvPad; // 자리·책상·방이 그대로면 지난 값(매 프레임 가구 거리 계산 없음)
  if (m && m.s === s && m.room === room && m.x === s.x && m.z === s.z && m.dx === d.x && m.dz === d.z && m.f === d.face) return m.p;
  const p = roverPad_(s, room, d);
  ch._rvPad = { s, room, x: s.x, z: s.z, dx: d.x, dz: d.z, f: d.face, p };
  return p;
}
function roverPad_(s, room, d) {
  const o = d.wide / 2 + 0.42, p = { x: d.x + d.rx * o, y: 0, z: d.z + d.rz * o };
  if (s.kind !== 'meet' && (!room || navClear(room, p.x, p.z) >= BOT_BODY - 0.02)) return p;
  if (!room) return p;
  // 등 뒤(직원이 보는 쪽 반대) → 책상 반대쪽 끝 · 등 뒤 대각(큰 사무실 빽빽한 책상 줄: 위가 다 가구 곁이라 차체가 책상에 묻혔다) → 가장 트인 곳
  const cand = [];
  for (const back of [0.8, 1.0, 0.6]) cand.push({ x: s.x - d.fx * back, y: 0, z: s.z - d.fz * back });
  if (s.kind !== 'meet') cand.push({ x: d.x - d.rx * o, y: 0, z: d.z - d.rz * o });
  for (const sd of [1, -1]) for (const back of [0.9, 1.2]) cand.push({ x: s.x - d.fx * back + d.rx * sd * 0.6, y: 0, z: s.z - d.fz * back + d.rz * sd * 0.6 });
  let best = p, bc = s.kind === 'meet' ? -Infinity : navClear(room, p.x, p.z);
  for (const q of cand) {
    const c = navClear(room, q.x, q.z);
    if (c >= BOT_BODY) return q;
    if (c > bc) { bc = c; best = q; }
  }
  if (bc < BOT_BODY - 0.04) { // 둘레가 다 가구 곁(스트레스 큰 사무실 — 백그라운드 랙 줄이 책상 줄에 붙음): 차체가 들어가는 가장 가까운 바닥
    const q = navSpot(room, best, 'tight');
    if (q && Math.hypot(q.x - best.x, q.z - best.z) < 2.5) return { x: q.x, y: 0, z: q.z };
  }
  return best;
}

/**
 * 바퀴 로봇 바닥 길: 넓은 몸 격자(가구·벽과 차체 반폭) → 좁은 통로 격자(칸 가운데 TIGHT_R — 칸 줄 사이 꺾은선도 가구와 ~0.35)
 * → 안 되면 보통 격자(예전 — 차체가 가구에 걸칠 수 있음. 랙에 닿지 못하는 방은 goal 이 닿는 자리로 바꿔 이 단계까지 오지 않음). 끝점은 늘 정확히 a·c
 */
export function roverRoute(room, a, c, discs = null) { // discs = 막힘 풀기 다시 찾기(길을 막은 사람·로봇을 피함) — 차체 폭 격자로만, 없으면 null
  const A = { x: a.x, z: a.z }, C = { x: c.x, z: c.z };
  let p = navPath(A, C, room, true, discs);
  const near = (q) => q && q.length >= 2 && Math.hypot(q[q.length - 1].x - c.x, q[q.length - 1].z - c.z) < 0.6;
  if (!near(p)) { p = navPath(A, C, room, 'tight', discs); if (!near(p)) p = null; }
  if (!p && discs) return null;
  if (!p) p = navPath(A, C, room);
  if (!p || p.length < 2) return [a, c];
  const out = p.map((q) => ({ x: q.x, y: 0, z: q.z }));
  const e = out[out.length - 1];
  if (Math.hypot(e.x - c.x, e.z - c.z) > 1e-3) out.push({ x: c.x, y: 0, z: c.z });
  return out;
}

/**
 * 랙 앞(작업 자리)에 차체가 닿지 못하면(좁은 통로 격자에서도 이어지지 않음) 닿는 가장 가까운 자리에서 멈춰 팔을 뻗는다.
 * 반환 = 바뀐 작업 자리 {x,y,z,yaw, reach:{x,z}(팔이 닿을 랙 앞 점)} 또는 g 그대로. 출발점·목표·방 격자가 그대로면 지난 값(b._reach)
 */
export function roverGoal(b, room, pad, g, tip = null, budget = null) { // tip = 팔 끝이 닿을 점(랙 앞면, 없으면 g) · budget = {n} 프레임마다 다시 볼 수(env)
  if (!pad) return g;
  const m = b._reach;
  const wn = roomNav(room, true); // 넓은 몸 격자가 그대로면(배치가 바뀌어도 가구가 같으면) 다시 보지 않음
  if (m && m.room === room && m.px === pad.x && m.pz === pad.z && m.gx === g.x && m.gz === g.z && m.wn === wn) return m.out;
  if (m && m.room === room && budget && budget.n <= 0) return m.out; // 이번 프레임 몫을 다 씀 — 지난 값(다음 프레임에 다시)
  if (budget) budget.n--;
  let out = g;
  const r = navReach(room, pad, g, REACH_MAX);
  if (r === undefined) out = null; // 랙 둘레 REACH_MAX 안에 닿는 자리도 없음(출발점이 갇힘 등) → 출동 없음(가구를 뚫고 가지 않음)
  else if (r) {
    const dx = g.x - r.x, dz = g.z - r.z, d = Math.hypot(dx, dz);
    const t = tip || g;
    out = { x: r.x, y: 0, z: r.z, yaw: d > 1e-6 ? Math.atan2(dx, dz) : g.yaw, reach: { x: t.x, z: t.z, d } };
  }
  b._reach = { room, wn, px: pad.x, pz: pad.z, gx: g.x, gz: g.z, out };
  return out;
}
const REACH_MAX = 2.4; // 팔을 뻗는 최대 거리(이보다 멀면 출동 없음)
/** 이 직원 책상에서 바퀴 로봇이 랙(또는 닿는 자리)까지 갈 수 있나 — botStart 가 출동 전에 봄(격자·연결 덩어리는 방마다 기억) */
export function roverCanGo(ch) {
  const room = ch.room, r = botRack(room), pad = roverPad(ch);
  if (!r || !pad) return false;
  return roverGoal(ch._rvProbe || (ch._rvProbe = {}), room, pad, { x: r.ax, y: 0, z: r.az, yaw: r.yaw }) != null;
}

/**
 * 배치가 바뀜 → 길 다시 찾기(BotBook.invalidate)를 미룬다. 바퀴 로봇 격자를 다시 만들면(botNavGen) 바로,
 * 아니면 배치가 잠잠해진 뒤(QUIET + 0.15 — 그 사이 격자가 먼저 다시 만들어져 두 번 찾지 않게) 또는 바뀌기 시작한 지 MAX 뒤.
 * 배치가 자라는 동안(0.3초마다 바뀜) 프레임마다 길을 다시 찾던 것(같은 격자 → 같은 길)을 없앰. st = 뷰마다 상태 객체
 */
export function botRelayout(st, book, ver, now) {
  const gen = botNavGen();
  if (st.ver !== ver) { st.ver = ver; if (st.dirtyAt == null) st.dirtyAt = now; st.lastChange = now; }
  if (st.gen !== gen) { st.gen = gen; book.invalidate(); st.dirtyAt = null; return; }
  if (st.dirtyAt != null && (now - st.lastChange >= BOT_NAV.QUIET + 0.15 || now - st.dirtyAt >= BOT_NAV.MAX)) { book.invalidate(); st.dirtyAt = null; }
}

/**
 * 장부 env(BotBook.step 에 넘김) — 같은 view 로 3D·2D 가 같은 자리·길을 쓴다.
 * env.beginFrame() 을 프레임마다 먼저 부르면 장애 목록을 그 프레임 동안 방마다 한 번만 만든다.
 */
export function makeBotEnv(view, book) {
  const cache = new Map(); // roomId → 장애 목록(이번 프레임)
  const gb = { n: 1 }; // 작업 자리(닿는 자리) 다시 보기 — 프레임마다 하나(배치가 바뀐 프레임에 모든 바퀴 로봇이 격자를 보지 않게)
  const env = {
    beginFrame(now) { cache.clear(); gb.n = 1; if (now != null) botNavClock(now); }, // now(벽시계) = 바퀴 로봇 격자 미룸 시계
    pad(b) {
      const ch = view.chars.get(b.nodeId);
      if (!ch || ch.state === 'gone' || !ch.room || ch.room.id !== b.roomId) return null;
      const d = deskOf(ch);
      if (!d) return null;
      if (b.kind === 'rover') return roverPad(ch, d);
      const o = d.wide > 1.5 ? 0.42 : d.wide / 2 - 0.2; // 팀장 책상은 화분(끝)과 스탠드 사이
      return { x: d.x + d.rx * o - d.fx * 0.08, y: BOT_DESK_TOP + 0.1, z: d.z + d.rz * o - d.fz * 0.08 };
    },
    goal(b) {
      const ch = view.chars.get(b.nodeId), room = ch && ch.room;
      if (!room || room.id !== b.roomId) return null;
      const h = hashStr(b.nodeId);
      if (b.kind === 'scout') {
        const list = room.stations && room.stations[b.cat === 'search' ? 'search' : 'read'];
        if (!list || !list.length) return null;
        const st = list[(hashStr(b.roomId || '') + (b.slot || 0)) % list.length]; // 방 기준 + 자리 번호(예전 노드 해시 + 번호 → 두 드론이 같은 칸에 겹침)
        const fx = Math.sin(st.face), fz = Math.cos(st.face);
        const off = b.cat === 'search' ? -0.15 : 0.1; // 서류함은 서랍이 열려 나오므로 한 뼘 뒤
        return { x: st.x + fx * off, y: Y_SCOUT[b.cat === 'search' ? 'search' : 'read'], z: st.z + fz * off, yaw: st.face };
      }
      if (b.kind === 'rover') {
        const r = botRack(room);
        if (!r) return null;
        const sd = -0.85 * (b.slot || 0), lx = r.front.z, lz = -r.front.x; // 둘째 로봇은 랙 앞 옆자리
        const g = { x: r.ax + lx * sd, y: 0, z: r.az + lz * sd, yaw: r.yaw };
        return roverGoal(b, room, env.pad(b), g, { x: g.x - r.front.x * 0.5, z: g.z - r.front.z * 0.5 }, gb); // 차체가 못 들어가면 닿는 자리에서 팔을 뻗음 · 닿을 데도 없으면 null(돌아감)
      }
      if (b.kind === 'recon') {
        const w = botWindow(room, ch, h + (b.slot || 0) * 3);
        return w ? { x: w.out.x, y: w.out.y, z: w.out.z, yaw: w.yaw } : null;
      }
      return null;
    },
    /** 길: 바퀴 = 바닥 길찾기 · 탐색 드론 = 순항 고도 · 정찰 드론 = 순항 고도로 창 안쪽을 지나 창밖(올 때 반대) */
    route(b, a, c, back, avoid = null) { // avoid = 피할 원 [{x,z,r}](바퀴 로봇 막힘 풀기 — 못 찾으면 null)
      const ch = view.chars.get(b.nodeId), room = ch && ch.room;
      if (b.kind === 'rover' && room) return roverRoute(room, a, c, avoid);
      if (b.kind === 'scout') return flightPts(a, c, BOT.CRUISE.scout);
      if (b.kind === 'recon' && room) {
        const w = botWindow(room, ch, hashStr(b.nodeId) + (b.slot || 0) * 3), Y = BOT.CRUISE.recon;
        if (!back) { // 책상 → 위로 → 창 안쪽 → 창밖
          const head = a.y < Y - 0.05 ? [a, { x: a.x, y: Y, z: a.z }] : [a];
          return Math.hypot(a.x - w.out.x, a.z - w.out.z) < 1.2 ? [a, c] : [...head, w.in, c];
        }
        const outside = Math.hypot(a.x - w.out.x, a.z - w.out.z) < 1.2;
        return outside ? [a, w.in, { x: c.x, y: Y, z: c.z }, c] : flightPts(a, c, Y);
      }
      return [a, c];
    },
    /** 바퀴 로봇 옆 비킴 한도: 길 위 점 (x,z) 에서 옆 방향 (sx,sz) 로 want(≥0) 만큼 비켜도 차체가 가구·벽에 닿지 않는 최대 거리 */
    sideFree(b, x, z, sx, sz, want, fx = 0, fz = 0) {
      const ch = view.chars.get(b.nodeId), room = ch && ch.room;
      if (!room || want <= 0) return want;
      const far = SIDE_AHEAD[SIDE_AHEAD.length - 1], R = BOT_BODY + want + far;
      const clr = navClearNear(room, x, z, R + 0.05); // 둘레 상자만(큰 사무실 상자 수백)
      if (clr(x, z) >= R) return want; // 둘레가 넉넉하면 한 번에(거리 함수는 1-립시츠)
      for (let m = want; m > 0.001; m -= 0.05) { // 지금 자리와 앞 0.4·0.8(다음 몇 프레임 — 앞에 나타나는 가구 모서리)
        let ok = true;
        for (const a of SIDE_AHEAD) if (clr(x + sx * m + fx * a, z + sz * m + fz * a) < BOT_BODY) { ok = false; break; }
        if (ok) return m;
      }
      return 0;
    },
    /** 바퀴 로봇이 비켜 갈 장애: 같은 방 직원(주인 빼고) + 다른 바퀴 로봇 */
    blockers(b) {
      let list = cache.get(b.roomId);
      if (!list) {
        list = [];
        const rv = []; // 이 방 바퀴 로봇 자리 — 그 둘레 NEAR_R 안의 직원만(큰 사무실 직원 수백을 다 담지 않음)
        if (book) for (const o of book.bots.values()) if (o.kind === 'rover' && o.roomId === b.roomId && o.p) rv.push(o.p.x, o.p.z);
        for (const ch of view.chars.values()) {
          if (!ch.room || ch.room.id !== b.roomId || ch.state === 'gone' || ch.offstage || ch.placed === false || ch.vanishT0 != null) continue;
          let near = !rv.length;
          for (let i = 0; i < rv.length && !near; i += 2) { const dx = ch.pos.x - rv[i], dz = ch.pos.z - rv[i + 1]; near = dx * dx + dz * dz < NEAR_R * NEAR_R; }
          if (!near) continue;
          let walking = ch.state === 'walk' || ch.state === 'leave' || ch.state === 'enter';
          if (walking && ch.path && ch.pi === ch.path.length - 1) { const e = ch.path[ch.pi]; if (Math.hypot(e.x - ch.pos.x, e.z - ch.pos.z) < ARRIVE_R) walking = false; } // 도착 코앞 = 서 있는 사람(그 자리가 로봇 곁이면 밀려 비켜 섬 — 기다리면 서로 막힘)
          const q = { x: ch.pos.x, z: ch.pos.z, r: 0.3, id: ch.id, walking, vx: 0, vz: 0 }; // 걷는 직원 = 우선 로봇에게 양보하는 쪽
          // 걷는 속도(닿기 미리 보기) — 길 다음 점 쪽. 비켜 주려고 멈춘 동안(yielding)도 걸음 속도로 본다(우선이 풀리면 곧 다시 걷기 때문)
          const nx = walking && ch.path && ch.path[ch.pi];
          q.yielding = ch.yieldUntil > view._now;
          if (nx) {
            const dx = nx.x - ch.pos.x, dz = nx.z - ch.pos.z, L = Math.hypot(dx, dz);
            if (L > 1e-6) { const v = WALK_V * Math.min(6, Math.max(1, view.ts || 1)) * (ch.walkK > 0 ? ch.walkK : 1) / L; q.vx = dx * v; q.vz = dz * v; }
          }
          list.push(q);
        }
        if (book) for (const o of book.bots.values()) {
          if (o.kind !== 'rover' || o.roomId !== b.roomId || !o.p) continue;
          list.push({ x: o.p.x, z: o.p.z, r: 0.42, key: o.key, bot: true, moving: o.state === 'out' || o.state === 'back', ref: o });
        }
        cache.set(b.roomId, list);
      }
      const out = env._tmp || (env._tmp = []);
      out.length = 0;
      for (const q of list) {
        if (q.id === b.nodeId || q.key === b.key) continue;
        if (q.ref) { q.x = q.ref.p.x; q.z = q.ref.p.z; q.moving = q.ref.state === 'out' || q.ref.state === 'back'; } // 같은 프레임에 먼저 움직인 로봇 자리
        out.push(q);
      }
      return out;
    },
  };
  return env;
}
