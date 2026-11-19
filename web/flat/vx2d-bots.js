// 복셀 2D 평면도의 도구 로봇 팀 — 3D vx-bots.js 와 같은 장부(vx-bot-core)·자리·길(vx-bot-place)을 위에서 본 평면으로.
//   탐색 드론(read·search) = 날개 넷 원 + 바닥 그림자(높을수록 몸이 위로 뜸) · 바퀴 작업 로봇(shell) = 노란 차체 사각 + 바퀴
//   정찰 드론(web) = 길쭉한 몸 + 날개 · 책상 팔(write·edit) = 옆 작업판 + 두 마디 팔 · 랙/회의실 단말 함 점등
// Voxel2DView 가 하나 만든다. 캔버스 2D 만 쓴다(three 없음).
import { BotBook, BOT, botSpeedK } from '../voxel/vx-bot-core.mjs';
import { botStart, deskOf, botRack, makeBotEnv, BotPending, roverObstacles, botRelayout } from '../voxel/vx-bot-place.mjs';
import { botNavClock } from '../voxel/nav-core.mjs';
import { catColor } from '../flow-core.mjs';

const PI = Math.PI;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 이보다 작은 배율(px/단위)이면 로봇을 점으로만 */
export const FAR_S = 1.2;

export class Vx2DBots {
  constructor(view) {
    this.view = view;
    this.book = new BotBook();
    this._env = makeBotEnv(view, this.book); this.pend = new BotPending();
    this._ver = -1;
    this.drawn = 0;
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
  /** 한 걸음(_update) */
  step(now, dt) {
    const v = this.view;
    botRelayout(this._rl || (this._rl = {}), this.book, v._layoutVer, now); // 길 다시 찾기 미룸(배치가 자라는 동안)
    this.pend.step(this.book, v, now);
    this._env.beginFrame(now);
    this.book.step(now, dt, botSpeedK(v.ts), this._env);
  }
  /** 갱신 단계: 로봇이 있으면 매 프레임 */
  animating() { return this.book.size ? 2 : 0; }

  _col(cat) { const t = this.view.tokens; return cat === 'skill' ? t.skill : catColor(cat || 'other', !!t.isLight); }

  /** 화면 사각형(가운데 cx·cy px, 앞 f·옆 r 단위, 길이 along × 폭 across m) */
  _quad(ctx, cx, cy, fx, fz, along, across, s) {
    const ax = fx * along * s / 2, ay = fz * along * s / 2, bx = -fz * across * s / 2, by = fx * across * s / 2;
    ctx.beginPath(); ctx.moveTo(cx - ax - bx, cy - ay - by); ctx.lineTo(cx + ax - bx, cy + ay - by); ctx.lineTo(cx + ax + bx, cy + ay + by); ctx.lineTo(cx - ax + bx, cy - ay + by); ctx.closePath();
  }

  draw(ctx, now, s) {
    const v = this.view, t = v.tokens, pal = v.pal, L = !!t.isLight, red = !!v.reduced;
    let n = 0;
    const racks = this._racks || (this._racks = new Map());
    racks.clear();
    if (s < FAR_S) { this.drawn = 0; return; } // 아주 멀리: 카드 위에 점으로(drawTop)
    for (const b of this.book.bots.values()) {
      const ch = v.chars.get(b.nodeId);
      if (!ch || ch.offstage) continue;
      const vv = v.vis.get(b.nodeId);
      if (!vv || vv.hidden || !(vv.scopeK ?? 1)) continue;
      const A = vv.projA ?? 1; // 프로젝트 페이드
      if (A <= 0.01) continue;
      const acc = this._col(b.cat), err = now - b.errAt < 1.2, eye = err ? t.error : acc;
      if (b.kind === 'rover' && b.state === 'work' && ch.room && !racks.has(ch.room.id)) racks.set(ch.room.id, { room: ch.room, err, t0: b.workT0, A });
      ctx.globalAlpha = A;
      if (b.kind === 'arm') { this._arm(ctx, b, ch, now, s, acc, err, red, pal, t); n++; continue; }
      if (!b.p) continue;
      const k = b.appear ?? 1;
      if (k <= 0.01) continue;
      if (b.kind === 'rover') this._rover(ctx, b, now, s, k, acc, eye, red, pal, t);
      else this._drone(ctx, b, now, s, k, acc, eye, red, pal, t, L);
      if (b.state === 'land' && b.landAt != null && b.kind !== 'rover') { // 돌아와 내려앉는 순간: 책상 위 고리(결과색)
        const q = clamp01((now - b.landAt) * botSpeedK(v.ts) / BOT.LIFT);
        ctx.globalAlpha = A * (1 - q * 0.7); ctx.strokeStyle = b.ok === false ? t.error : b.ok === 'stopped' ? (t.stopped || pal.ledOff) : t.ok; ctx.lineWidth = Math.max(1, 0.06 * s);
        ctx.beginPath(); ctx.arc(v._X(b.p.x), v._Y(b.p.z), Math.max(3, (0.15 + q * 0.35) * s), 0, PI * 2); ctx.stroke();
      }
      n++;
    }
    for (const r of racks.values()) { ctx.globalAlpha = r.A; this._rackLit(ctx, r.room, now, s, r.err, r.t0, red, pal, t); }
    ctx.globalAlpha = 1;
    this.drawn = n;
  }

  /** 카드·말풍선 다음(맨 위): 아주 먼 축소면 점 표시 — 그 배율에선 건물이 수십 px 라 작업 카드에 덮이므로 위에 올린다 */
  drawTop(ctx, now, s) { if (s < FAR_S) this._far(ctx, s); }

  /**
   * 아주 먼 축소(s < FAR_S): 로봇마다 작은 네모 점 하나(종류색 — 바퀴 = 노랑 차체색, 드론 = 분류색, 책상 팔 = 생략).
   * 색별로 묶어 경로 하나·fill 한 번(그리기 호출이 로봇 수에 비례하지 않음). 드론은 높이만큼 조금 위로
   */
  _far(ctx, s) {
    const v = this.view, pal = v.pal;
    const groups = this._farG || (this._farG = new Map());
    for (const g of groups.values()) g.length = 0;
    let n = 0;
    for (const b of this.book.bots.values()) {
      if (b.kind === 'arm' || !b.p || (b.appear ?? 1) < 0.3) continue;
      const ch = v.chars.get(b.nodeId);
      if (!ch || ch.offstage) continue;
      const vv = v.vis.get(b.nodeId);
      if (!vv || vv.hidden || !(vv.scopeK ?? 1) || (vv.projA ?? 1) < 0.3) continue;
      const col = b.kind === 'rover' ? pal.forklift : this._col(b.cat);
      let g = groups.get(col);
      if (!g) { g = []; groups.set(col, g); }
      g.push(v._X(b.p.x), v._Y(b.p.z) - Math.max(0, b.p.y) * 0.16 * s);
      n++;
    }
    if (n) {
      const q = s >= FAR_S * 0.6 ? 4 : 3, h = q / 2; // 축소 배율 0.7～1.2 = 4 px(3 px 는 카드 위에서 잘 안 보임), 더 멀면 3 px
      ctx.globalAlpha = 0.95; ctx.lineWidth = 1; ctx.strokeStyle = v.tokens.isLight ? 'rgba(24,28,34,0.7)' : (v.tokens.bg || '#000'); // 테두리(카드 위에서도 읽히게 — 라이트 = 짙은 테두리, 밝은 카드에 묻히지 않게)
      for (const [col, g] of groups) {
        if (!g.length) continue;
        ctx.fillStyle = col; ctx.beginPath();
        for (let i = 0; i < g.length; i += 2) ctx.rect(Math.round(g[i] - h), Math.round(g[i + 1] - h), q, q);
        ctx.stroke(); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    this.drawn = n;
  }

  /** 탐색·정찰 드론: 바닥 그림자 + 높이만큼 위로 뜬 몸(위에서 본 원·날개 넷 / 길쭉한 몸·날개 둘) */
  _drone(ctx, b, now, s, k, acc, eye, red, pal, t, L) {
    const v = this.view;
    let x = b.p.x, z = b.p.z, yaw = b.yaw;
    const recon = b.kind === 'recon';
    if (recon && b.state === 'work' && b.workT0 != null && !red) { // 창밖 맴돌기(3D 와 같음)
      const T = (now - b.workT0) * 1.6, r = 0.8 * Math.min(1, (now - b.workT0) * 2);
      x += Math.cos(T) * r; z += Math.sin(T) * r; yaw = Math.atan2(-Math.sin(T), Math.cos(T));
    }
    const h = Math.max(0, b.p.y), X = v._X(x), Y0 = v._Y(z), Y = Y0 - h * 0.16 * s; // 높이 → 화면 위로
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const sc = k * (1 + h * 0.05);
    // 그림자
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * (L ? 0.18 : 0.32) * k; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(X, Y0, Math.max(2, 0.3 * s * k), Math.max(1.5, 0.22 * s * k), 0, 0, PI * 2); ctx.fill();
    ctx.globalAlpha = a0;
    if (recon) {
      ctx.fillStyle = pal.drone; ctx.strokeStyle = pal.rotor; ctx.lineWidth = Math.max(0.8, 0.04 * s);
      this._quad(ctx, X - fz * 0, Y, fx, fz, 0.32 * sc, 0.9 * sc, s); ctx.fill(); ctx.stroke(); // 날개
      ctx.fillStyle = pal.metal || pal.drone; this._quad(ctx, X, Y, fx, fz, 0.95 * sc, 0.3 * sc, s); ctx.fill(); ctx.stroke(); // 몸
      ctx.fillStyle = acc; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(X - fz * sd * 0.45 * sc * s, Y + fx * sd * 0.45 * sc * s, Math.max(1, 0.06 * sc * s), 0, PI * 2); ctx.fill(); }
    } else {
      const R = 0.2 * sc * s;
      ctx.strokeStyle = pal.rotor; ctx.lineWidth = Math.max(0.8, 0.035 * s); ctx.globalAlpha = a0 * 0.8;
      ctx.beginPath();
      for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { // 날개 덮개 고리(앞 기준 대각) + 팔
        const ox = (fx * dz - fz * dx) * 0.27 * sc * s, oy = (fz * dz + fx * dx) * 0.27 * sc * s, rr = Math.max(1.2, 0.11 * sc * s);
        ctx.moveTo(X, Y); ctx.lineTo(X + ox, Y + oy); ctx.moveTo(X + ox + rr, Y + oy); ctx.arc(X + ox, Y + oy, rr, 0, PI * 2);
      }
      ctx.stroke();
      ctx.globalAlpha = a0; ctx.fillStyle = pal.drone; ctx.strokeStyle = pal.rotor; ctx.lineWidth = Math.max(0.8, 0.04 * s);
      ctx.beginPath(); ctx.arc(X, Y, Math.max(2, R), 0, PI * 2); ctx.fill(); ctx.stroke();
    }
    // 눈(앞)
    ctx.fillStyle = eye; ctx.beginPath(); ctx.arc(X + fx * (recon ? 0.42 : 0.17) * sc * s, Y + fz * (recon ? 0.42 : 0.17) * sc * s, Math.max(1.2, 0.08 * sc * s), 0, PI * 2); ctx.fill();
    // 작업: 탐색 = 앞쪽 서가/서류함을 훑는 빛줄 · 정찰 = 퍼지는 신호 고리
    if (b.state === 'work' && b.workT0 != null) {
      const T = now - b.workT0;
      if (recon) {
        const q = red ? 0.5 : (T / 0.9) % 1;
        ctx.globalAlpha = ctx.globalAlpha * (1 - q); ctx.strokeStyle = acc; ctx.lineWidth = Math.max(1, 0.06 * s);
        ctx.beginPath(); ctx.arc(X, Y, (0.3 + q * 1.4) * s, 0, PI * 2); ctx.stroke(); ctx.globalAlpha = a0;
      } else {
        const sw = red ? 0 : Math.sin(T * (b.cat === 'search' ? 4.2 : 2.6)), d = b.cat === 'search' ? 0.52 : 0.6;
        const cx = b.p.x + fx * d - fz * sw * 0.7, cz = b.p.z + fz * d + fx * sw * 0.7;
        ctx.strokeStyle = acc; ctx.lineWidth = Math.max(1, 0.05 * s); ctx.globalAlpha = a0 * 0.85;
        ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(v._X(cx), v._Y(cz)); ctx.stroke();
        ctx.fillStyle = acc; ctx.fillRect(v._X(cx) - Math.max(1.5, 0.08 * s), v._Y(cz) - Math.max(1.5, 0.08 * s), Math.max(3, 0.16 * s), Math.max(3, 0.16 * s));
        ctx.globalAlpha = a0;
      }
    }
    // 돌아올 때 들고 오는 것(서류 · 빛 구슬)
    if ((b.state === 'back' || b.state === 'land') && b.ok !== false) {
      if (recon) { ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(X, Y + 0.12 * s, Math.max(1.5, 0.12 * s * k), 0, PI * 2); ctx.fill(); }
      else { ctx.fillStyle = pal.paper; const m = Math.min(3, Math.max(1, b.done)); for (let i = 0; i < m; i++) ctx.fillRect(X - 0.2 * s + i * 1.5, Y + 0.12 * s - i * 1.5, 0.4 * s * k, 0.28 * s * k); }
    }
  }

  /** 바퀴 작업 로봇: 노란 차체·바퀴 넷·머리·눈 가리개(분류색)·경광등. 작업 중 = 앞으로 뻗은 팔 + 불꽃 */
  _rover(ctx, b, now, s, k, acc, eye, red, pal, t) {
    const v = this.view, X = v._X(b.p.x), Y = v._Y(b.p.z), fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), rx = -fz, rz = fx;
    const K = k * 1.1;
    ctx.fillStyle = pal.shoe || pal.metalDark;
    for (const [a, c] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { this._quad(ctx, X + (fx * a * 0.2 + rx * c * 0.3) * K * s, Y + (fz * a * 0.2 + rz * c * 0.3) * K * s, fx, fz, 0.2 * K, 0.1 * K, s); ctx.fill(); }
    ctx.fillStyle = pal.forklift; ctx.strokeStyle = pal.metalDark; ctx.lineWidth = Math.max(0.8, 0.04 * s);
    this._quad(ctx, X, Y, fx, fz, 0.56 * K, 0.5 * K, s); ctx.fill(); ctx.stroke();
    ctx.fillStyle = pal.hazard; this._quad(ctx, X - fx * 0.06 * K * s, Y - fz * 0.06 * K * s, fx, fz, 0.3 * K, 0.42 * K, s); ctx.fill(); // 등판 띠
    ctx.fillStyle = pal.forklift; this._quad(ctx, X - fx * 0.08 * K * s, Y - fz * 0.08 * K * s, fx, fz, 0.18 * K, 0.3 * K, s); ctx.fill(); // 머리
    ctx.fillStyle = eye; this._quad(ctx, X + fx * 0.03 * K * s, Y + fz * 0.03 * K * s, fx, fz, 0.04 * K, 0.24 * K, s); ctx.fill(); // 눈 가리개
    const moving = (b.state === 'out' || b.state === 'back') && !b.waiting;
    const on = b.waiting ? (red || Math.floor(now * 10) % 2 === 0) : moving ? (red || Math.floor(now * 6) % 2 === 0) : b.state === 'work';
    ctx.fillStyle = on ? pal.hazard : pal.ledOff; ctx.beginPath(); ctx.arc(X - fx * 0.17 * K * s, Y - fz * 0.17 * K * s, Math.max(1.2, 0.06 * K * s), 0, PI * 2); ctx.fill();
    if (b.state === 'work') { // 팔 + 불꽃
      const rch = b._reach && b._reach.out && b._reach.out.reach; // 랙 앞에 못 들어감: 늘인 팔을 랙 앞까지
      const ex = rch ? v._X(rch.x) : X + (fx * 0.62 + rx * 0.12) * K * s, ey = rch ? v._Y(rch.z) : Y + (fz * 0.62 + rz * 0.12) * K * s;
      ctx.strokeStyle = pal.metal; ctx.lineWidth = Math.max(1, 0.06 * s); ctx.beginPath(); ctx.moveTo(X + (fx * 0.15 + rx * 0.12) * K * s, Y + (fz * 0.15 + rz * 0.12) * K * s); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(ex, ey, Math.max(1.2, 0.06 * s), 0, PI * 2); ctx.fill();
      if (!red && b.workT0 != null) {
        ctx.fillStyle = b.errAt > b.workT0 && now - b.errAt < 1.2 ? t.error : pal.hazard;
        for (let i = 0; i < 6; i++) { const q = (now * 2.4 + i / 6) % 1, a = i * 2.39 + Math.floor(now * 2.4 + i / 6) * 1.3, rr = q * 0.45 * s, sz = Math.max(1, (0.07 * (1 - q) + 0.02) * s); ctx.fillRect(ex + Math.cos(a) * rr - sz / 2, ey + Math.sin(a) * rr - sz / 2, sz, sz); }
      }
    }
  }

  /** 랙(사무실)·단말 함(회의실) 점등: 앞면 LED 줄 깜빡임 + 회의실 화면 글줄 + 도착 순간 둘레 빛 */
  _rackLit(ctx, room, now, s, err, t0, red, pal, t) {
    const v = this.view, r = botRack(room);
    if (!r) return;
    const sh = this._col('shell'), f = r.front, rx = f.z, rz = -f.x, d = r.depth / 2;
    const fxp = r.x + f.x * (d + 0.06), fzp = r.z + f.z * (d + 0.06);
    const T = Math.floor(now * 12), n = 5;
    for (let j = 0; j < n; j++) {
      const on = red ? j % 2 === 0 : (((j * 13 + T) * 2654435761) >>> 0) % 3 !== 0;
      ctx.fillStyle = err ? (Math.floor(now * 4) % 2 ? t.error : pal.ledOff) : on ? sh : pal.ledIdle;
      const u = (j / (n - 1) - 0.5) * (r.w - 0.2), q = Math.max(1.5, 0.1 * s);
      ctx.fillRect(v._X(fxp + rx * u) - q / 2, v._Y(fzp + rz * u) - q / 2, q, q);
    }
    if (r.screen) { // 회의실 단말 화면(앞면 띠, 글줄 흐름)
      const cx = v._X(r.x + f.x * (d - 0.12)), cy = v._Y(r.z + f.z * (d - 0.12)), w = (Math.abs(rx) * r.screen.w + Math.abs(f.x) * 0.16) * s, h = (Math.abs(rz) * r.screen.w + Math.abs(f.z) * 0.16) * s;
      ctx.fillStyle = err ? t.error : sh; const a0 = ctx.globalAlpha; ctx.globalAlpha = a0 * 0.85; ctx.fillRect(cx - w / 2, cy - h / 2, w, h); ctx.globalAlpha = a0;
    }
    if (t0 != null && now - t0 < 0.3 && !red) { // 도착 순간 둘레 빛
      const q = (now - t0) / 0.3, a0 = ctx.globalAlpha;
      ctx.globalAlpha = a0 * 0.6 * (1 - q); ctx.strokeStyle = sh; ctx.lineWidth = Math.max(1, 0.06 * s); // 짧고 옅게(3D 와 맞춤)
      const w = (Math.abs(rx) * r.w + Math.abs(f.x) * r.depth + 0.3) * s, h = (Math.abs(rz) * r.w + Math.abs(f.z) * r.depth + 0.3) * s;
      ctx.strokeRect(v._X(r.x) - w / 2, v._Y(r.z) - h / 2, w, h); ctx.globalAlpha = a0;
    }
  }

  /** 책상 팔: 책상 끝(발사대 반대쪽)에서 밀려 나온 옆 작업판·종이·두 마디 팔·펜 끝(쓰기 = 줄 · 편집 = 탭) */
  _arm(ctx, b, ch, now, s, acc, err, red, pal, t) {
    const v = this.view, d = deskOf(ch);
    if (!d || !ch.room || ch.room.id !== b.roomId || s < 3) return;
    const k = b.open, hw = d.wide / 2, sx = -d.rx, sz = -d.rz;
    const at = (u, w) => ({ x: d.x + sx * u + d.fx * w, z: d.z + sz * u + d.fz * w });
    const tw = 0.64 * k, tc = at(hw + tw / 2 - 0.02, -0.02);
    if (k > 0.02) { ctx.fillStyle = pal.deskTop; this._quad(ctx, v._X(tc.x), v._Y(tc.z), d.fx, d.fz, 0.56, tw, s); ctx.fill(); }
    const P = at(hw + 0.26 * k, 0.07), write = b.cat === 'write';
    if (k > 0.3) {
      const m = write ? Math.min(3, Math.max(1, b.calls)) : 1;
      ctx.fillStyle = pal.paper;
      for (let i = 0; i < m; i++) { this._quad(ctx, v._X(P.x) + i * 1.2, v._Y(P.z) - i * 1.2, d.fx, d.fz, 0.38 * k, 0.3 * k, s); ctx.fill(); }
    }
    // 펜 끝
    const T = b.workT0 != null ? now - b.workT0 : 0, rows = 5, lineW = 0.24;
    let u = 0, row = 0;
    if (b.state === 'work') {
      if (write) { const q = red ? 0.5 : T * 1.6; row = Math.floor(q) % rows; u = q % 1; }
      else { const q = red ? 0.3 : T * 1.3; row = Math.floor(q * 1.7) % rows; u = Math.abs((Math.sin(Math.floor(q) * 12.9898) * 43758.5453) % 1); }
    }
    const lu = (u - 0.5) * lineW, lv = 0.12 - row * 0.06;
    const tx = P.x + d.rx * lu + d.fx * lv, tz = P.z + d.rz * lu + d.fz * lv;
    if ((b.state === 'work' || b.state === 'close') && k > 0.3 && s > 6) { // 줄
      ctx.strokeStyle = acc; ctx.lineWidth = Math.max(0.8, 0.025 * s);
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        let w = write ? (r < row ? 1 : r === row ? u : 0) : 0.7 + 0.25 * Math.sin(r * 3.1);
        if (b.state === 'close' && write) w = 1;
        if (w <= 0.02) continue;
        const vv = 0.12 - r * 0.06, a = -lineW / 2, c = a + lineW * w;
        ctx.moveTo(v._X(P.x + d.rx * a + d.fx * vv), v._Y(P.z + d.rz * a + d.fz * vv)); ctx.lineTo(v._X(P.x + d.rx * c + d.fx * vv), v._Y(P.z + d.rz * c + d.fz * vv));
      }
      ctx.stroke();
    }
    // 받침 → 팔꿈치 → 펜
    const B0 = at(hw + 0.5 * k, -0.16), bx = v._X(B0.x), by = v._Y(B0.z);
    ctx.fillStyle = pal.metalDark; ctx.fillRect(bx - 0.1 * s, by - 0.1 * s, 0.2 * s, 0.2 * s);
    ctx.fillStyle = err ? t.error : acc; ctx.fillRect(bx - 0.04 * s, by - 0.04 * s, 0.08 * s, 0.08 * s);
    if (k <= 0.02) return;
    const px = bx + (v._X(tx) - bx) * k, py = by + (v._Y(tz) - by) * k;
    const mx = (bx + px) / 2 + (d.fx * 0.12 - sx * 0.08) * s * k, my = (by + py) / 2 + (d.fz * 0.12 - sz * 0.08) * s * k;
    ctx.strokeStyle = pal.drone; ctx.lineWidth = Math.max(1, 0.06 * s); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(mx, my); ctx.lineTo(px, py); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(mx, my, Math.max(1, 0.05 * s), 0, PI * 2); ctx.fill();
    ctx.fillStyle = write ? acc : pal.hazard; ctx.beginPath(); ctx.arc(px, py, Math.max(1.2, 0.045 * s), 0, PI * 2); ctx.fill();
  }
}
