// 복셀 오피스 도구 로봇 팀 — 장부(vx-bot-core.mjs)를 사무실 자리에 놓고 그린다.
//   탐색 드론(read·search) · 바퀴 작업 로봇(shell) · 정찰 드론(web) · 책상 팔 로봇(write·edit)
// 직원은 자리에서 지시하고(오른손을 잠깐 뻗음, ch.cmdUntil), 홀로그램 모니터는 그대로 함께 둔다.
// 그리기 = VoxelView 동적 묶음(dLit·dGlow)에 상자만 넣는다(그리기 호출 추가 0). 먼 전체 보기 = 몸통 한두 상자.
import * as THREE from 'three';
import { BotBook, BOT, botSpeedK } from './vx-bot-core.mjs';
import { botStart, deskOf, botRack, makeBotEnv, BotPending, roverObstacles, botRelayout } from './vx-bot-place.mjs';
import { botNavClock } from './nav-core.mjs';
import { partBox, DESK_TOP } from './props.js';

const PI = Math.PI;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 로봇 크기 배율(직원 키 ~1.8 옆에서 기본 카메라 거리로도 읽히게) */
export const SIZE = { scout: 1.9, rover: 1.75, recon: 1.9, arm: 1.45 };
/** 랙·단말 함 도착 빛 시간(초) */
const ARRIVE_S = 0.3;

export class VxBots {
  constructor(view) {
    this.view = view;
    this.book = new BotBook();
    this._c = new THREE.Color(); this._c2 = new THREE.Color();
    this._rackAt = new Map(); // 방 id → 랙 작업 중(점등) {r, err, t0}
    this._env = makeBotEnv(view, this.book); this.pend = new BotPending(); // 자리·길·장애(2D 와 같은 순수 모듈)
    this._ver = -1;
  }
  get stats() { return { ...this.book.stats }; }
  /** 직원 쪽 장애(밀리지 않는 몸·우선 표시) — separate·botYield 에 넘김 */
  obstacles(now) { return roverObstacles(this.book, this._obs || (this._obs = []), now); }
  clear() { this.book.clear(); this.pend.clear(); }
  dropNode(id) { this.book.dropNode(id, this.view._now || 0); this.pend.dropNode(id); }
  endAll(id) { this.book.endAll(id, this.view._now || 0); this.pend.dropNode(id); }

  start(nodeId, ev, quiet) {
    if (this.view._now != null) botNavClock(this.view._now); // 출동 전 길 확인(roverCanGo)도 격자 미룸 시계로
    const b = botStart(this.book, this.view, nodeId, ev, quiet);
    if (!b) { const ch = this.view.chars.get(nodeId); if (!ch || !ch.seat || !ch.room) this.pend.add(nodeId, ev, quiet, this.view._now || 0); } // 자리가 아직 없음 → 자리가 생기면 출동
    return b;
  }
  end(nodeId, ev) {
    if (!ev.toolUseId) return;
    this.pend.drop(ev.toolUseId);
    this.book.end(nodeId, ev.toolUseId, ev.ok === false ? false : ev.stopped ? 'stopped' : true, this.view._now);
  }
  _desk(ch) { return deskOf(ch); }
  _rack(room) { return botRack(room); }

  // ---------- 매 프레임 ----------
  step(now, dt) {
    const v = this.view;
    botRelayout(this._rl || (this._rl = {}), this.book, v._layoutVer, now); // 길 다시 찾기 미룸(배치가 자라는 동안)
    this.pend.step(this.book, v, now);
    this._env.beginFrame(now);
    this.book.step(now, dt, botSpeedK(v.ts), this._env);
    // 시설 활동: 탐색 드론이 서류함 앞이면 서랍이 열림(props.js act.files)
    this._rackAt.clear();
    for (const b of this.book.bots.values()) {
      if (b.state !== 'work') continue;
      const ch = v.chars.get(b.nodeId), room = ch && ch.room;
      if (!room) continue;
      if (b.kind === 'scout' && b.cat === 'search' && room._act) room._act.files = 1;
      if (b.kind === 'rover') {
        const r = this._rack(room); // 사무실 서버랙 · 회의실 단말 함
        if (r && !this._rackAt.has(room.id)) this._rackAt.set(room.id, { r, err: now - b.errAt < 1.2, t0: b.workT0 });
      }
    }
  }

  draw(B, now) {
    const v = this.view, G = B.glow, L = B.lit, pal = v.pal, tok = v.tokens;
    const far = !!v._farAll, red = !!v.reduced;
    let n = 0;
    for (const b of this.book.bots.values()) {
      if (!b.p && b.kind !== 'arm') continue;
      if (v._isDim(b.nodeId)) continue;
      const ch = v.chars.get(b.nodeId);
      if (!ch || ch.offstage) continue;
      const acc = v.holo ? v.holo._cat(b.cat) : tok.text;
      const err = now - b.errAt < 1.2;
      const eye = err ? tok.error : acc;
      if (b.kind === 'arm') { if (!far) { this._arm(L, G, pal, tok, b, ch, now, acc, err, red); n++; } continue; }
      const s = (b.appear ?? 1);
      if (s <= 0.01) continue;
      if (far) { L.box(b.p.x, b.p.y + 0.15, b.p.z, 0.45 * s, 0.2 * s, 0.45 * s, b.kind === 'rover' ? pal.forklift : pal.drone); G.box(b.p.x, b.p.y + 0.28, b.p.z, 0.16 * s, 0.06, 0.16 * s, eye); n++; continue; }
      if (b.kind === 'scout') this._scout(L, G, pal, b, now, acc, eye, s, red);
      else if (b.kind === 'rover') this._rover(L, G, pal, tok, b, now, acc, eye, s, red);
      else this._recon(L, G, pal, b, now, acc, eye, s, red);
      // 돌아와 내려앉는 순간: 책상 위 짧은 고리(결과색)
      if (b.state === 'land' && b.landAt != null && b.kind !== 'rover') {
        const q = clamp01((now - b.landAt) * botSpeedK(v.ts) / BOT.LIFT);
        const c = this._c.copy(b.ok === false ? tok.error : b.ok === 'stopped' ? pal.ledOff : tok.ok).multiplyScalar(1 - q * 0.6);
        const rr = 0.15 + q * 0.3;
        for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; G.box(b.p.x + Math.cos(a) * rr, DESK_TOP + 0.03, b.p.z + Math.sin(a) * rr, 0.05, 0.015, 0.05, c); }
      }
      n++;
    }
    // 서버랙 점등(바퀴 로봇이 작업 중인 방)
    if (!far) for (const { r, err, t0 } of this._rackAt.values()) this._rackLeds(G, pal, tok, r, now, err, t0, red);
    this.drawn = n;
  }

  // ---------- 로봇 모양 ----------
  /** 탐색 드론: 둥근 몸통(두 단)·큰 눈(분류색 렌즈)·회전 날개 넷·아래 스캐너. 작업 중 = 서가/서류함을 훑는 빛 */
  _scout(L, G, pal, b, now, acc, eye, s, red) {
    const t = now, P = b.p, yaw = b.yaw;
    const bob = red ? 0 : Math.sin(t * 5 + b.key.length) * 0.035;
    const x = P.x, y = P.y + bob, z = P.z;
    const k = SIZE.scout * s;
    const part = (B, ox, oy, oz, sx, sy, sz, c, rx = 0) => partBox(B, null, x, y, z, rx, yaw, 0, ox * k, oy * k, oz * k, sx * k, sy * k, sz * k, c);
    part(L, 0, 0, 0, 0.34, 0.14, 0.34, pal.drone);
    part(L, 0, 0.09, 0, 0.24, 0.06, 0.24, pal.drone);
    part(L, 0, -0.09, 0, 0.2, 0.05, 0.2, pal.rotor);
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      part(L, dx * 0.19, 0.02, dz * 0.19, 0.1, 0.03, 0.03, pal.rotor, 0); // 팔
      const rx_ = x + (Math.cos(yaw) * dx * 0.25 + Math.sin(yaw) * dz * 0.25) * k, rz_ = z + (-Math.sin(yaw) * dx * 0.25 + Math.cos(yaw) * dz * 0.25) * k;
      L.box(rx_, y + 0.04 * k, rz_, 0.17 * k, 0.025 * k, 0.17 * k, pal.metalDark, yaw); // 날개 덮개
      const spin = red ? dx : t * 38 + dx * 1.3 + dz;
      partBox(L, null, rx_, y + 0.06 * k, rz_, 0, spin, 0, 0, 0, 0, 0.2 * k, 0.01 * k, 0.035 * k, pal.rotor);
    }
    part(G, 0, 0.0, 0.18, 0.13, 0.09, 0.03, eye); // 눈(앞)
    part(L, 0, 0.0, 0.195, 0.06, 0.04, 0.02, pal.rotor);
    G.box(x, y - 0.14 * k, z, 0.06 * k, 0.025, 0.06 * k, eye); // 아래 스캐너
    // 돌아올 때 서류(호출 수만큼, 최대 3장)
    if ((b.state === 'back' || b.state === 'land') && b.ok !== false) {
      const m = Math.min(3, Math.max(1, b.done));
      for (let i = 0; i < m; i++) part(L, 0, -0.16 - i * 0.025, 0, 0.26, 0.015, 0.2, pal.paper);
    }
    if (b.state === 'work' && b.workT0 != null) {
      // 스캔 빛: 렌즈 → 앞 0.75 의 세운 면(서가 앞면)을 옆으로·위아래로 훑는 빛줄
      const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const T = now - b.workT0;
      const sw = red ? 0 : Math.sin(T * (b.cat === 'search' ? 4.2 : 2.6));
      const dist = b.cat === 'search' ? 0.52 : 0.6;
      const cx = x + fx * dist, cz = z + fz * dist;
      const c = this._c.copy(acc).multiplyScalar(0.85);
      if (b.cat === 'search') { // 서랍 높이를 위아래로
        const yy = 0.75 + sw * 0.4;
        G.box(cx, yy, cz, Math.abs(rx) * 1.2 + 0.05, 0.05, Math.abs(rz) * 1.2 + 0.05, c);
        this._ray(G, x + fx * 0.2 * k, y, z + fz * 0.2 * k, cx, yy, cz, c, 5);
      } else { // 책 등을 옆으로
        const ox = rx * sw * 0.8, oz = rz * sw * 0.8;
        G.box(cx + ox, 1.15, cz + oz, 0.05, 1.6, 0.05, c);
        this._ray(G, x + fx * 0.2 * k, y, z + fz * 0.2 * k, cx + ox, 1.5, cz + oz, c, 5);
        this._ray(G, x + fx * 0.2 * k, y, z + fz * 0.2 * k, cx + ox, 0.75, cz + oz, c, 5);
      }
    }
  }
  /** 점 몇 개로 그린 가는 빛줄(a → b) */
  _ray(G, ax, ay, az, bx, by, bz, c, n) {
    for (let i = 1; i <= n; i++) { const u = i / (n + 1); G.box(ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u, 0.045, 0.045, 0.045, c); }
  }

  /** 바퀴 작업 로봇: 노란 차체·바퀴 넷·목·눈 가리개(분류색)·경광등·두 마디 팔. 작업 중 = 팔을 랙에 꽂고 불꽃 */
  _rover(L, G, pal, tok, b, now, acc, eye, s, red) {
    const t = now, P = b.p, yaw = b.yaw, k = SIZE.rover * s;
    const x = P.x, y = 0, z = P.z;
    const moving = (b.state === 'out' || b.state === 'back') && !b.waiting; // 기다리는 동안 바퀴 멈춤
    const bump = moving && !red ? Math.abs(Math.sin(t * 18)) * 0.012 : 0;
    const part = (B, ox, oy, oz, sx, sy, sz, c, rx = 0) => partBox(B, null, x, y, z, rx, yaw, 0, ox * k, (oy + bump) * k, oz * k, sx * k, sy * k, sz * k, c);
    part(L, 0, 0.2, 0, 0.42, 0.16, 0.5, pal.forklift);
    part(L, 0, 0.29, -0.05, 0.36, 0.03, 0.34, pal.hazard);
    part(L, 0, 0.12, 0, 0.44, 0.02, 0.52, pal.metalDark);
    const wr = red ? 0 : (moving ? t * 14 : 0);
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) partBox(L, null, x + (Math.cos(yaw) * dx * 0.24 + Math.sin(yaw) * dz * 0.17) * k, 0.085 * k, z + (-Math.sin(yaw) * dx * 0.24 + Math.cos(yaw) * dz * 0.17) * k, wr, yaw, 0, 0, 0, 0, 0.07 * k, 0.17 * k, 0.17 * k, pal.shoe);
    part(L, 0, 0.36, -0.1, 0.08, 0.14, 0.08, pal.metal); // 목
    part(L, 0, 0.47, -0.08, 0.26, 0.13, 0.18, pal.forklift); // 머리
    part(G, 0, 0.48, 0.015, 0.2, 0.05, 0.02, eye); // 눈 가리개
    const beacon = b.waiting ? (red || Math.floor(t * 10) % 2 === 0) : moving ? (red || Math.floor(t * 6) % 2 === 0) : b.state === 'work'; // 기다림 = 빠른 깜빡임
    part(G, 0, 0.57, -0.12, 0.06, 0.05, 0.06, beacon ? pal.hazard : pal.ledOff);
    // 팔: 작업 중엔 앞으로 뻗어 랙에 꽂음(위아래로 조금), 아니면 접음
    const work = b.state === 'work';
    const reach = work ? 1 : 0;
    const a1 = -0.35 - reach * 0.95 + (work && !red ? Math.sin(t * 7) * 0.12 : 0);
    const sx = 0.13, sy = 0.32, sz = 0.12; // 어깨(오른쪽 앞)
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const jx = x + (rx * sx + fx * sz) * k, jy = (sy + bump) * k, jz = z + (rz * sx + fz * sz) * k;
    partBox(L, null, jx, jy, jz, -a1 - PI / 2 + PI / 2, yaw, 0, 0, 0.14 * k, 0, 0.05 * k, 0.28 * k, 0.05 * k, pal.metal);
    // 팔 끝(집게) 자리
    const ang = -a1, l1 = 0.28 * k;
    let ex = jx + fx * Math.sin(ang) * l1, ey = jy + Math.cos(ang) * l1, ez = jz + fz * Math.sin(ang) * l1;
    const rch = work && b._reach && b._reach.out && b._reach.out.reach; // 랙 앞에 못 들어간 로봇: 늘이는 팔(마디 상자)을 랙 앞까지 뻗음
    if (rch) {
      const dx = rch.x - ex, dz = rch.z - ez, d = Math.hypot(dx, dz), n = Math.max(2, Math.min(10, Math.round(d / 0.22)));
      for (let i = 1; i <= n; i++) { const u = i / n; L.box(ex + dx * u, ey, ez + dz * u, 0.05 * k, 0.05 * k, 0.05 * k, pal.metal); }
      ex = rch.x; ez = rch.z;
    }
    G.box(ex, ey, ez, 0.06 * k, 0.06 * k, 0.06 * k, work ? acc : pal.rotor);
    if (work && b.workT0 != null && !red) { // 불꽃: 집게 끝에서 포물선으로 튀는 작은 빛
      const sc = b.errAt > b.workT0 && now - b.errAt < 1.2 ? tok.error : pal.hazard;
      for (let i = 0; i < 7; i++) {
        const q = (t * 2.4 + i / 7) % 1, a = i * 2.39 + Math.floor(t * 2.4 + i / 7) * 1.3;
        const vx = Math.cos(a) * 0.5, vz = Math.sin(a) * 0.5;
        G.box(ex + vx * q - fx * 0.1 * q, ey + 0.35 * q - 0.9 * q * q, ez + vz * q - fz * 0.1 * q, 0.07 * (1 - q) + 0.02, 0.07 * (1 - q) + 0.02, 0.07 * (1 - q) + 0.02, sc);
      }
    }
  }
  /** 랙·단말 함 점등: 장치 판마다 LED 넷이 셸 분류색으로 깜빡임(오류 = 빨강 깜빡), 회의실 단말 함은 화면에 글줄이 올라감, 도착 순간 앞면 둘레 빛 */
  _rackLeds(G, pal, tok, r, now, err, t0, red) {
    const f = r.front, d = (r.depth || 0.8) / 2 + (r.meet ? 0.036 : 0.018), rx = f.z, rz = -f.x; // 앞면 가로 방향(단말 함은 화면 틀이 앞으로 나와 더 앞에)
    const T = Math.floor(now * 12), sh = this.view.holo._cat('shell');
    const n = r.meet ? 3 : 4, u0 = r.meet ? -0.42 : -0.24, du = r.meet ? 0.1 : 0.1;
    const arr = t0 != null && now - t0 < ARRIVE_S && !red ? (now - t0) / ARRIVE_S : -1; // 도착: LED 가 아래에서 위로 한 번 차오름
    for (let i = 0; i < r.units; i++) {
      const yy = r.y0 + i * r.step;
      for (let j = 0; j < n; j++) {
        const on = arr >= 0 ? i <= arr * r.units : red ? (i + j) % 2 === 0 : (((i * 7 + j * 13 + T) * 2654435761) >>> 0) % 3 !== 0;
        const c = err ? (Math.floor(now * 4) % 2 ? tok.error : pal.ledOff) : on ? sh : pal.ledIdle;
        const u = u0 + j * du;
        G.box(r.x + f.x * d + rx * u, yy, r.z + f.z * d + rz * u, Math.abs(rx) * 0.06 + Math.abs(f.x) * 0.012, 0.045, Math.abs(rz) * 0.06 + Math.abs(f.z) * 0.012, c);
      }
    }
    if (r.screen) { // 단말 화면: 바탕 + 아래에서 위로 올라가는 글줄(셸 색)
      const S = r.screen, fx = r.x + f.x * (d + 0.006), fz = r.z + f.z * (d + 0.006);
      G.box(fx, S.y, fz, Math.abs(rx) * S.w + Math.abs(f.x) * 0.01, S.h, Math.abs(rz) * S.w + Math.abs(f.z) * 0.01, this._c2.copy(err ? tok.error : sh).multiplyScalar(0.28));
      const rows = 5, sc = red ? 0 : (now * 3) % 1;
      for (let i = 0; i < rows; i++) {
        const yy = S.y - S.h / 2 + 0.05 + ((i + sc) / rows) * (S.h - 0.1);
        const w = S.w * (0.35 + 0.5 * ((((i + Math.floor(now * 3)) * 2654435761) >>> 0) % 7) / 7);
        const off = -S.w / 2 + 0.05 + w / 2;
        G.box(fx + f.x * 0.006 + rx * off, yy, fz + f.z * 0.006 + rz * off, Math.abs(rx) * w + Math.abs(f.x) * 0.008, 0.022, Math.abs(rz) * w + Math.abs(f.z) * 0.008, err ? tok.error : sh);
      }
    }
    if (t0 != null && now - t0 < ARRIVE_S && !red) { // 도착 순간: 앞면 테두리만 짧고 옅게(앞면 전체를 덮던 판 → 가는 틀 넷, 서버랙·단말 함 같음)
      const q = (now - t0) / ARRIVE_S, c = this._c.copy(sh).multiplyScalar(0.55 * (1 - q) * (1 - q));
      const cx = r.x + f.x * (d + 0.004), cz = r.z + f.z * (d + 0.004), W = r.w + 0.04, H = r.h, e = 0.035, th = Math.abs(f.x) * 0.01, tz = Math.abs(f.z) * 0.01;
      G.box(cx, H - e / 2, cz, Math.abs(rx) * W + th, e, Math.abs(rz) * W + tz, c); // 위
      G.box(cx, e / 2 + 0.02, cz, Math.abs(rx) * W + th, e, Math.abs(rz) * W + tz, c); // 아래
      for (const sd of [-1, 1]) G.box(cx + rx * sd * (W / 2 - e / 2), H / 2 + 0.01, cz + rz * sd * (W / 2 - e / 2), Math.abs(rx) * e + th, H - 0.02, Math.abs(rz) * e + tz, c); // 옆
    }
  }

  /** 정찰 드론: 길쭉한 몸통·옆 날개 둘(큰 날개)·꼬리·접시 안테나. 작업 중 = 창밖에서 맴돌며 신호 고리 */
  _recon(L, G, pal, b, now, acc, eye, s, red) {
    const t = now, k = SIZE.recon * s;
    let x = b.p.x, y = b.p.y, z = b.p.z, yaw = b.yaw;
    if (b.state === 'work' && b.workT0 != null && !red) { // 창밖 맴돌기(반지름 0.8)
      const T = (now - b.workT0) * 1.6, r = 0.8 * Math.min(1, (now - b.workT0) * 2);
      x += Math.cos(T) * r; z += Math.sin(T) * r; y += Math.sin(T * 0.7) * 0.12;
      yaw = Math.atan2(-Math.sin(T), Math.cos(T));
    }
    const part = (B, ox, oy, oz, sx, sy, sz, c) => partBox(B, null, x, y, z, 0, yaw, 0, ox * k, oy * k, oz * k, sx * k, sy * k, sz * k, c);
    part(L, 0, 0, 0, 0.16, 0.12, 0.52, pal.metal);
    part(L, 0, 0.02, 0.24, 0.12, 0.09, 0.08, pal.metalDark);
    part(G, 0, 0.03, 0.29, 0.08, 0.04, 0.02, eye);
    part(L, 0, 0.05, -0.27, 0.04, 0.16, 0.1, pal.metal); // 꼬리
    for (const sd of [-1, 1]) {
      part(L, sd * 0.2, 0.02, 0.02, 0.26, 0.02, 0.14, pal.drone);
      part(G, sd * 0.33, 0.02, 0.02, 0.02, 0.025, 0.12, acc); // 날개 끝 빛
      const spin = red ? sd : t * 42 + sd;
      const cx = x + Math.cos(yaw) * sd * 0.2 * k + Math.sin(yaw) * 0.02 * k, cz = z - Math.sin(yaw) * sd * 0.2 * k + Math.cos(yaw) * 0.02 * k;
      partBox(L, null, cx, y + 0.07 * k, cz, 0, spin, 0, 0, 0, 0, 0.34 * k, 0.01 * k, 0.04 * k, pal.rotor);
    }
    part(L, 0, 0.12, 0.05, 0.02, 0.1, 0.02, pal.antenna);
    part(L, 0, 0.18, 0.05, 0.14, 0.02, 0.14, pal.antenna);
    if (b.state === 'work' && b.workT0 != null) { // 신호 고리: 0.9초마다 퍼짐
      const q = red ? 0.5 : ((now - b.workT0) / 0.9) % 1;
      const rr = 0.3 + q * 1.4, c = this._c.copy(acc).multiplyScalar(1 - q);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; G.box(x + Math.cos(a) * rr, y + 0.18 * k, z + Math.sin(a) * rr, 0.07, 0.02, 0.07, c); }
    }
    if ((b.state === 'back' || b.state === 'land') && b.ok !== false) part(G, 0, -0.12, 0, 0.12, 0.12, 0.12, acc); // 받아 온 자료(빛 구슬)
  }

  /**
   * 책상 팔 로봇: 책상 끝(발사대 반대쪽)에서 옆 작업판이 밀려 나오고 그 위에서 팔이 펼쳐짐 — 받침·두 마디 팔·펜 머리.
   * 쓰기 = 종이에 줄이 그어짐(호출 수만큼 종이가 쌓임, 최대 3), 편집 = 줄 강조·탭·부스러기. 작업판은 책상 폭 밖이라 홀로그램 모니터에 가리지 않는다.
   */
  _arm(L, G, pal, tok, b, ch, now, acc, err, red) {
    const d = this._desk(ch);
    if (!d || !ch.room || ch.room.id !== b.roomId) return;
    const t = now, k = b.open, S = SIZE.arm, hw = d.wide / 2;
    const sx_ = -d.rx, sz_ = -d.rz; // 팔 쪽 옆 방향
    const at = (u, v) => ({ x: d.x + sx_ * u + d.fx * v, z: d.z + sz_ * u + d.fz * v });
    const by = DESK_TOP;
    // 옆 작업판(밀려 나옴) + 받침 다리
    const tw = 0.64 * k, tc = at(hw + tw / 2 - 0.02, -0.02);
    if (k > 0.02) {
      L.box(tc.x, by - 0.03, tc.z, Math.abs(sx_) * tw + Math.abs(d.fx) * 0.56, 0.05, Math.abs(sz_) * tw + Math.abs(d.fz) * 0.56, pal.deskTop);
      const lg = at(hw + tw - 0.08, -0.02);
      L.box(lg.x, (by - 0.05) / 2, lg.z, 0.05, by - 0.05, 0.05, pal.deskLeg);
    }
    const B0 = at(hw + 0.5 * k, -0.16), bx = B0.x, bz = B0.z;
    const P0 = at(hw + 0.26 * k, 0.07), px = P0.x, pz = P0.z;
    const pyaw = d.face;
    const write = b.cat === 'write';
    const T = b.workT0 != null ? now - b.workT0 : 0;
    const sheets = write ? Math.min(3, Math.max(1, b.calls)) : 1;
    if (k > 0.3) {
      for (let i = 0; i < sheets; i++) partBox(L, null, px, by + 0.006 + i * 0.006, pz, 0, pyaw + (i - 1) * 0.06, 0, 0, 0, 0, 0.3 * k, 0.006, 0.38 * k, pal.paper);
    }
    // 펜 끝 목표: 쓰기 = 줄을 따라 왼→오, 줄 바꿈 · 편집 = 몇 군데 탭
    const rows = 5, lineW = 0.24;
    let u = 0, row = 0, down = 1;
    if (b.state === 'work') {
      if (write) { const q = red ? 0.5 : T * 1.6; row = Math.floor(q) % rows; u = q % 1; }
      else { const q = red ? 0.3 : T * 1.3; row = Math.floor(q * 1.7) % rows; u = (Math.sin(Math.floor(q) * 12.9898) * 43758.5453) % 1; u = Math.abs(u); down = red ? 1 : 0.5 + 0.5 * Math.cos(q * PI * 2 * 2); }
    }
    const lu = (u - 0.5) * lineW, lv = 0.12 - row * 0.06;
    // 종이 지역(옆 r, 앞 f) → 세계
    const tx = px + d.rx * lu + d.fx * lv, tz = pz + d.rz * lu + d.fz * lv, ty = by + 0.02 + (1 - down) * 0.06;
    // 써진 줄(쓰기) / 기존 줄 + 강조(편집)
    if ((b.state === 'work' || b.state === 'close') && k > 0.3) {
      const c = this._c.copy(acc).multiplyScalar(0.9);
      for (let r = 0; r < rows; r++) {
        const v = 0.12 - r * 0.06;
        let w = 0;
        if (write) w = r < row ? 1 : r === row ? u : 0; else w = 0.7 + 0.25 * Math.sin(r * 3.1);
        if (b.state === 'close' && write) w = 1;
        if (w <= 0.02) continue;
        const cu = (w / 2 - 0.5) * lineW;
        const cc = write ? c : (r === row && b.state === 'work' ? c : this._c2.copy(pal.rotor));
        (write || r === row ? G : L).box(px + d.rx * cu + d.fx * v, by + 0.014 + (sheets - 1) * 0.006, pz + d.rz * cu + d.fz * v, Math.abs(d.rx) * lineW * w + Math.abs(d.fx) * 0.012, 0.004, Math.abs(d.rz) * lineW * w + Math.abs(d.fz) * 0.012, cc);
      }
      if (!write && !red && b.state === 'work' && down > 0.9) for (let i = 0; i < 3; i++) { // 부스러기
        const q = (T * 3 + i / 3) % 1;
        G.box(tx + Math.cos(i * 2.1) * 0.06 * q, by + 0.03 + 0.08 * q * (1 - q), tz + Math.sin(i * 2.1) * 0.06 * q, 0.015, 0.015, 0.015, pal.rotor);
      }
    }
    // 받침
    L.box(bx, by + 0.02 * S, bz, 0.14 * S, 0.04 * S, 0.14 * S, pal.metalDark);
    G.box(bx, by + 0.045 * S, bz, 0.06 * S, 0.012, 0.06 * S, err ? tok.error : acc);
    if (k <= 0.02) return;
    // 접힘(k=0) → 펼침(k=1): 어깨 높이·팔 길이 보간 + IK
    const l1 = (0.3 * k + 0.03) * S, l2 = (0.27 * k + 0.03) * S;
    const sx = bx, sy = by + 0.06 * S, sz = bz;
    const hx = (tx - sx), hz = (tz - sz), yaw = Math.atan2(hx, hz);
    const hh = Math.hypot(hx, hz) * k, vv = (ty + 0.07 * S) - sy; // 펜 길이 0.07 위가 손목
    let D = Math.hypot(hh, vv);
    const maxD = l1 + l2 - 0.005; if (D > maxD) D = maxD;
    const phi = Math.atan2(hh, vv); // 수직에서 앞으로
    const al = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + D * D - l2 * l2) / (2 * l1 * D || 1))));
    const a1 = phi - al;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const ex = sx + fx * Math.sin(a1) * l1, ey = sy + Math.cos(a1) * l1, ez = sz + fz * Math.sin(a1) * l1;
    const wx = sx + fx * Math.sin(phi) * D, wy = sy + Math.cos(phi) * D, wz = sz + fz * Math.sin(phi) * D;
    const a2 = Math.atan2(Math.hypot(wx - ex, wz - ez) * Math.sign((wx - ex) * fx + (wz - ez) * fz || 1), wy - ey);
    partBox(L, null, sx, sy, sz, a1, yaw, 0, 0, l1 / 2, 0, 0.05 * S, l1, 0.05 * S, pal.drone);
    G.box(ex, ey, ez, 0.055 * S, 0.055 * S, 0.055 * S, acc); // 팔꿈치 관절 빛
    partBox(L, null, ex, ey, ez, a2, yaw, 0, 0, l2 / 2, 0, 0.04 * S, l2, 0.04 * S, pal.drone);
    // 머리 + 펜(아래로)
    L.box(wx, wy, wz, 0.07 * S, 0.05 * S, 0.07 * S, pal.metalDark, yaw);
    L.box(wx, wy - 0.04 * S, wz, 0.02 * S, 0.06 * S, 0.02 * S, pal.paper);
    G.box(wx, wy - 0.07 * S, wz, 0.02 * S, 0.02 * S, 0.02 * S, write ? acc : pal.hazard);
  }
}
