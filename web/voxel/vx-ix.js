// 특별 상호작용(서버 분류기 ix· 은유 계약 → 복셀 구현) — 얇은 어댑터.
// 효과 장부는 Flow·Planet 과 같은 IxModel(web/ix-core.mjs)을 그대로 받고, 그림만 사무실 시설로 바꾼다:
//   github = 발송대 택배 드론(push: 책상 → 발송대로 소포가 가고 드론이 싣고 날아오름 · pull/fetch/clone: 드론이 내려와 소포를 책상으로 ·
//            commit: 발송대 선반에 소포 하나 · merge/rebase: 두 소포가 돌며 합쳐짐 · PR·CI: 발송대 옆 신호등 칸)
//   db     = 문서고·금고(읽기: 서랍이 열리고 카드가 책상으로 · 쓰기: 금고 바퀴가 돌고 카드가 금고로)
//   remote = 원격 단말 부스(안테나 빔 — 올림은 위로, 내림은 아래로 흐르는 점)
//   batch  = 우편 분류 컨베이어(벨트 위 소포 흐름, i/N 진행 막대, 병렬이면 여러 줄)
//   tests  = 품질검사 신호등 보드(실행 중 노랑 깜빡 · 통과/실패 막대 · 끝나면 초록 고정 또는 빨강 깜빡)
// 요약 글(`push 3 commits → origin/main`, `pytest ✓120 ✗2`)은 시설 위 작은 CSS2D 칩(최대 6).
// 흐름 연출 묶음 1의 복셀 판: 화면 하한 배율(상위 활동·포커스·호버, 시설은 그대로 조각만) · 가는 조각 화면 2～3px 하한 ·
// 잔광 하한(흐름과 같은 LINGER, 잔광 60% 까지 그대로) · 발송대 모서리 등은 github 활동·CI 실패 잔광 때만(props.js) ·
// 움직임 줄이기(view.reduced)면 도는 날개·흐르는 카드·깜빡임·쓸기를 멈추고 정지 도형으로.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ixSpot, OFFICE_FX, VX_IX, vxIxScale, vxIxThin, vxIxAlpha } from './office-core.mjs';
import { roomFrame, endXf } from './props.js';
import { escapeHtml } from '../html-util.mjs';
import * as IX from '../ix-core.mjs';

const LABELS = 6;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (u) => { u = clamp01(u); return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; };

export class VxIx {
  constructor(view) {
    this.view = view;
    this.mod = IX; this.model = new IX.IxModel(); // Flow·Planet 과 같은 효과 장부
    this._col = new Map();
    this._c = new THREE.Color();
    this._a = { x: 0, y: 0, z: 0 }; this._b = { x: 0, y: 0, z: 0 };
    this.labels = [];
    this.s = 1; this.ppu = 0; this.vip = false; this.red = false; // 지금 그리는 효과의 배율·ppu·상위 여부·움직임 줄이기
    this.stats = { fx: 0, drawn: 0, scale: 1 };
  }
  get on() { return !!this.model; }
  _colors() { this._col.clear(); }
  col(key) {
    let c = this._col.get(key);
    if (!c) { c = new THREE.Color(this.mod ? this.mod.ixKeyColor(key, !!this.view.tokens.isLight) : '#888'); this._col.set(key, c); }
    return c;
  }
  applyTheme() { this._col.clear(); }
  event(ev, { speed = 1 } = {}) {
    if (!this.model) return;
    const v = this.view;
    const rootOf = (id) => { let cur = id; for (let i = 0; i < 64; i++) { const n = v.nodes.get(cur); if (!n || !n.parentId || !v.nodes.has(n.parentId)) return cur; cur = n.parentId; } return cur; };
    this.model.event(ev, v._now, speed, rootOf);
  }
  dropNode(id) { if (this.model) this.model.dropNode(id); }
  /** 카메라 git 붙잡기가 함께 담을 발송대(바닥 패드 + 드론이 뜨는 높이) [{x,y,z,r}] | null */
  holdPts(id) {
    const act = this._actor({ nodeId: id, bgNode: null }), room = act && this._office(act.room), sp = room && ixSpot(room, 'github');
    return sp ? [{ x: sp.x, y: 0.5, z: sp.z, r: 1.0 }, { x: sp.x, y: 3.4, z: sp.z, r: 0.6 }] : null;
  }
  clear() { if (this.model) this.model.clear(); for (const L of this.labels) L.o.visible = false; }

  /** 효과 주인(캐릭터·기계)의 방과 책상 쪽 점 */
  _actor(f) {
    const v = this.view;
    for (const id of [f.nodeId, f.bgNode]) {
      if (!id) continue;
      const ch = v.chars.get(id);
      if (ch && ch.room && ch.placed && ch.state !== 'gone' && !ch.offstage) {
        const p = ch.seat && ch.target && ch.target.type === 'desk' ? { x: ch.seat.deskX, z: ch.seat.deskZ } : { x: ch.pos.x, z: ch.pos.z };
        return { id, room: ch.room, x: p.x, z: p.z, y: 1.2 };
      }
      const m = v.machines.get(id);
      if (m && m.pos && !m.released) return { id, room: v.roomsById.get(m.pos.roomId), x: m.pos.x, z: m.pos.z, y: 1.2 };
    }
    return null;
  }
  _office(room) {
    if (!room) return null;
    if (room.type === 'office') return room;
    return room.officeId ? this.view.roomsById.get(room.officeId) || null : null;
  }
  /** 고리 진행 u(0..1 반복): 움직임 줄이기면 고정 자리 */
  _u(u, fixed) { return this.red ? fixed : u; }

  /** 매 프레임: 방 시설 활동 표시(room._ixAct) + 은유 그리기(B.glow/B.lit) + 칩 */
  draw(B, now) {
    const v = this.view;
    for (const r of v.rooms) r._ixAct = null;
    if (!this.model) return;
    this.model.step(now);
    const G = B.glow, L = B.lit, pal = v.pal;
    this.red = !!v.reduced; // F6 움직임 줄이기
    const top = v.holo && v.holo._topActive ? v.holo._topActive(now) : null;
    const cam = v.camera, H = (v.renderer && v.renderer.domElement.clientHeight) || (v.container && v.container.clientHeight) || 1;
    const kf = cam && cam.fov ? H / (2 * Math.tan((cam.fov * Math.PI) / 360)) : 0;
    const chips = this._chips || (this._chips = []);
    chips.length = 0;
    let n = 0, smax = 1;
    // F4 발송대 모서리 등: CI 실패 잔광(뿌리 포털 장부)이면 그 뿌리 사무실 발송대를 붉게(props.js 가 room._ixAct 를 읽음)
    for (const [root, p] of this.model.portal) {
      if (p.ciFailAt == null || now - p.ciFailAt > 4 + this.mod.IXFX.CI_AFTERGLOW) continue;
      const a = root != null ? this._actor({ nodeId: root, bgNode: null }) : null, room = a && this._office(a.room);
      if (room) (room._ixAct || (room._ixAct = {})).ciFail = 1;
    }
    for (const f of this.model.fx.values()) {
      if (now < f.showAt) continue;
      const act = this._actor(f);
      if (!act || v._isDim(act.id)) continue;
      if (f.cat === 'user') { // 예약·Monitor·작업 알림이 연 팀장 턴(사용자 창구 연출은 client-core 가 맡음)
        const kind = this.mod.ixAutoKind(f.ix);
        if (kind && kind !== 'dot' && this._auto(G, f, kind, act, now, v._farAll ? null : chips)) n++;
        continue;
      }
      const room = this._office(act.room);
      const sp = room && ixSpot(room, f.cat);
      if (!sp) continue;
      const ia = room._ixAct || (room._ixAct = {});
      const ix = f.ix, te = f.tEnd == null ? null : now - f.tEnd, tt = now - f.t0;
      // F5 잔광: 흐름과 같은 LINGER(하한 LINGER_MIN, ÷√배속) — IxModel.step 도 같은 값으로 지우므로 0 이 되는 때와 지워지는 때가 같다
      const lin = Math.max(this.mod.IXFX.LINGER_MIN || 0, this.mod.IXFX.LINGER[f.cat] || 2) / (f.k || 1);
      const A = vxIxAlpha(te, lin);
      // F2 화면 하한 · F1 가는 조각: 시설 자리의 세계 1단위당 px
      const d = cam ? Math.hypot(sp.x - cam.position.x, sp.y - cam.position.y, sp.z - cam.position.z) : 0;
      this.ppu = d > 1e-3 && kf ? kf / d : 0;
      this.vip = act.id === v.focusId || act.id === v.hoverId || !!(top && top.has(act.id));
      this.s = this.vip ? vxIxScale(this.ppu, VX_IX.WIDTH[f.cat]) : 1;
      if (this.s > smax) smax = this.s;
      const ck = this.col(f.ok === false ? 'err' : f.cat);
      const desk = this._a; desk.x = act.x; desk.y = act.y; desk.z = act.z;
      const s = this.s;
      switch (f.cat) {
        case 'github': ia.github = Math.max(ia.github || 0, A); this._github(G, L, pal, f, ix, sp, desk, tt, te, A, ck, now); break;
        case 'db': {
          const w = ix.rw === 'w' || ix.rw === 'rw';
          if (w) ia.dbw = 1; else ia.db = 1;
          // 카드가 서랍·금고 ↔ 책상 사이를 오감(읽기 = 시설 → 책상, 쓰기 = 책상 → 시설) · 움직임 줄이기면 길 위 고정 자리에 멈춘 카드 줄
          const m = Math.min(5, Math.max(2, Math.round(Math.log10((ix.rows || 10) + 1) * 2)));
          for (let i = 0; i < m; i++) {
            const u = this._u((tt * 0.8 + i / m) % 1, (i + 0.5) / m);
            if (te != null && u > A) continue;
            const from = w ? desk : sp, to = w ? sp : desk;
            this._arc(G, from, to, u, 0.9, 0.2 * s, vxIxThin(0.03, this.ppu), 0.14 * s, this.col(w ? 'write' : 'read'));
          }
          break;
        }
        case 'remote': {
          ia.remote = 1;
          const up = ix.transfer !== 'down';
          const ax = sp.x, az = sp.z;
          for (let i = 0; i < 6; i++) { // 안테나 빔: 점이 흐름(움직임 줄이기면 고르게 멈춘 점)
            const u = this._u((tt * 0.9 + i / 6) % 1, (i + 0.5) / 6), y = 2.6 + (up ? u : 1 - u) * 3.2;
            const z = (0.09 * s) * A * (1 - Math.abs(u - 0.5));
            if (z > 0.01) G.box(ax - 0.1, y, az, z + 0.02, z + 0.02, z + 0.02, ck);
          }
          const bw = vxIxThin(0.03, this.ppu, this.vip); // F1 빔 기둥 화면 2～3px 하한
          G.box(ax - 0.1, 4.2, az, bw, 3.2 * A, bw, this._c.copy(ck).multiplyScalar(0.45));
          if (te == null) this._arc(G, up ? desk : { x: sp.x, y: 1.5, z: sp.z }, up ? { x: sp.x, y: 1.5, z: sp.z } : desk, this._u((tt * 0.7) % 1, 0.5), 0.8, 0.13 * s, 0.13 * s, 0.13 * s, ck);
          break;
        }
        case 'batch': { const rl = roomFrame(room, B); this._batch(G, L, pal, f, ix, rl, tt, te, A, ck, now); endXf(B); break; }
        case 'tests': { const rl = roomFrame(room, B); this._tests(G, f, ix, rl, tt, te, A, now); endXf(B); break; }
        default: break;
      }
      // 칩: 최근 것부터(멀리서 보는 전체 보기는 생략)
      if (!v._farAll && A > 0.2) chips.push({ f, x: sp.x, y: sp.y + 1.25, z: sp.z, at: f.lastAt || f.t0, A });
      n++;
    }
    this.s = 1;
    this.stats.fx = this.model.fx.size; this.stats.drawn = n; this.stats.scale = +smax.toFixed(2);
    this._labels(chips);
  }

  /**
   * 팀장(메인) 책상 위: 예약 = 떠 있는 탁상시계(바늘이 한 바퀴 돌며 울림) → 쪽지가 책상으로 · Monitor = 감시 기계·직원 자리에서
   * 보라 쪽지가 팀장 책상으로 · 작업 결과 = 출처 직원·기계에서 결과 상자(초록·빨강·회색)가 날아와 책상 위 표지로 잠깐 남음.
   * 출처가 퇴장·숨김(_actor 없음·희미)이면 책상 쪽만(고리 맥박).
   */
  _auto(G, f, kind, act, now, chips = null) {
    const v = this.view, ix = f.ix, M = this.mod.IX_AUTO;
    const te = f.tEnd == null ? 0 : now - f.tEnd, T = now - f.t0;
    const A = vxIxAlpha(te, M.LINGER_S / (f.k || 1));
    if (A <= 0.02) return false;
    const key = kind === 'schedule' ? 'sched' : kind === 'monitor' ? 'mon' : ix.st === 'err' ? 'err' : ix.st === 'stop' ? 'dim' : 'ok';
    const c = this._c.copy(this.col(key)).multiplyScalar(0.35 + 0.65 * A);
    const desk = { x: act.x, y: act.y + 0.2, z: act.z };
    if (chips && ix.text && T < 2.8) chips.push({ f, x: desk.x, y: desk.y + (kind === 'schedule' ? 2.3 : 1.4), z: desk.z, at: f.t0 + 1e6, A, glyph: kind === 'schedule' ? '⏰' : kind === 'monitor' ? '◎' : ix.st === 'err' ? '✕' : ix.st === 'stop' ? '■' : '✓', text: ix.text.length > 18 ? ix.text.slice(0, 17) + '…' : ix.text, color: this.mod.ixKeyColor(key, !!v.tokens.isLight) }); // 첫 몇 단어 칩(흐름·Planet 리본과 같은 글)
    const pulse = (t0) => { const q = (T - t0) / 0.8; if (q > 0 && q < 1 && !this.red) { const rr = 0.4 + q * 0.9; for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; G.box(desk.x + Math.cos(a) * rr, desk.y, desk.z + Math.sin(a) * rr, 0.08, 0.03, 0.08, c); } } };
    if (kind === 'schedule') {
      const K = { x: desk.x, y: desk.y + 1.5, z: desk.z };
      const ring = T < 1.3 && !this.red ? Math.sin(T * 22) * 0.06 : 0;
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; G.box(K.x + Math.cos(a) * 0.5 + ring, K.y + Math.sin(a) * 0.5, K.z, 0.12, 0.12, 0.08, c); } // 시계 얼굴(세운 원)
      const ha = Math.PI / 2 - (this.red ? 0 : Math.min(1, T / 1.3) * Math.PI * 2);
      for (let j = 1; j <= 4; j++) G.box(K.x + Math.cos(ha) * 0.1 * j + ring, K.y + Math.sin(ha) * 0.1 * j, K.z + 0.04, 0.08, 0.08, 0.06, c); // 분침
      G.box(K.x + 0.13 + ring, K.y, K.z + 0.04, 0.24, 0.08, 0.06, c); // 시침
      const u = (T - 0.9) / M.TRAVEL_S; if (u > 0 && u < 1) this._arc(G, { x: K.x, y: K.y - 0.35, z: K.z }, desk, u, 0.2, 0.2, 0.03, 0.14, c);
      pulse(0.9 + M.TRAVEL_S);
      return true;
    }
    const src = ix.from ? this._actor({ nodeId: ix.from, bgNode: null }) : null;
    const from = src && src.id !== act.id && !v._isDim(src.id) ? { x: src.x, y: src.y + 0.2, z: src.z } : null;
    const arrive = from ? M.TRAVEL_S : 0;
    if (from) { const u = T / M.TRAVEL_S; if (u < 1) this._arc(G, from, desk, this.red ? 0.5 : u, 1.1, kind === 'monitor' ? 0.2 : 0.24, kind === 'monitor' ? 0.03 : 0.2, kind === 'monitor' ? 0.14 : 0.24, c); }
    pulse(arrive);
    if (kind === 'result' && T > arrive) G.box(desk.x, desk.y + 0.9 + (this.red ? 0 : Math.sin(now * 3) * 0.04), desk.z, 0.22, 0.22, 0.22, c); // 결과 표지
    return true;
  }

  _arc(G, a, b, u, arc, sx, sy, sz, c) {
    const e = ease(u);
    G.box(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e + Math.sin(e * Math.PI) * arc, a.z + (b.z - a.z) * e, sx, sy, sz, c);
  }

  /** 택배 드론 한 대(몸통·팔·회전 날개·소포·불빛). k = 배율(바닥 y 는 그대로 — 발송대 위에 앉음) */
  _drone(G, L, pal, x, y, z, t, parcel, ck, k = 1) {
    L.box(x, y, z, 0.38 * k, 0.1 * k, 0.38 * k, pal.drone);
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      L.box(x + dx * 0.22 * k, y + 0.02 * k, z + dz * 0.22 * k, 0.05 * k, 0.04 * k, 0.05 * k, pal.rotor);
      L.box(x + dx * 0.26 * k, y + 0.07 * k, z + dz * 0.26 * k, 0.26 * k, 0.01 * k, 0.04 * k, pal.rotor, this.red ? dx : t * 40 + dx);
    }
    G.box(x, y - 0.02 * k, z + 0.2 * k, 0.06 * k, 0.04 * k, 0.02 * k, ck);
    if (parcel) L.box(x, y - 0.18 * k, z, 0.24 * k, 0.22 * k, 0.24 * k, pal.parcel);
  }

  _github(G, L, pal, f, ix, sp, desk, tt, te, A, ck, now) {
    const k = this.s, red = this.red;
    const pad = { x: sp.x, y: 0.2, z: sp.z };
    const dy = 0.25 + 0.3 * (k - 1); // 커진 드론도 발송대 위에 앉게
    const op = ix.op;
    const blink = (hz) => red || Math.floor(now * hz) % 2 === 0;
    if (op === 'push') {
      const n = Math.min(6, Math.max(1, ix.commits || ix.commitsHere || 1));
      if (te == null) { // 소포가 책상 → 발송대로, 드론은 대기(날개만 돎)
        this._arc(G, desk, pad, this._u((tt * 0.8) % 1, 0.5), 1.2, 0.2 * k, 0.18 * k, 0.2 * k, pal.parcel);
        this._drone(G, L, pal, pad.x, dy, pad.z, now, true, ck, k);
      } else if (f.ok === false) { // 거부: 소포가 되돌아오고 발송대가 붉게
        this._drone(G, L, pal, pad.x, dy, pad.z, now, true, this.col('err'), k);
        if (te < 1) this._arc(G, pad, desk, te, 1.0, 0.2 * k, 0.18 * k, 0.2 * k, this.col('err'));
        if (blink(4)) G.box(pad.x, 0.13, pad.z, 1.5, 0.02, 1.5, this.col('err'));
      } else { // 드론이 소포를 싣고 날아오름(커밋 수만큼 소포 줄)
        const y = dy + te * te * 2.2;
        this._drone(G, L, pal, pad.x + (red ? 0 : Math.sin(te * 2) * 0.2), y, pad.z, now, true, ck, k);
        for (let i = 1; i < n; i++) L.box(pad.x, y - (0.18 + i * 0.24) * k, pad.z, 0.2 * k, 0.2 * k, 0.2 * k, pal.parcel);
        if (te < 1.2 && !red) { const r = 0.4 + te * 1.4; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; G.box(pad.x + Math.cos(a) * r, 0.14, pad.z + Math.sin(a) * r, 0.1 * k, 0.02, 0.1 * k, this._c.copy(ck).multiplyScalar(1 - te / 1.2)); } }
      }
    } else if (op === 'pull' || op === 'fetch' || op === 'clone') {
      if (te == null) { const y = dy + Math.max(0, 3 - tt * 1.5); this._drone(G, L, pal, pad.x, y, pad.z, now, true, ck, k); }
      else {
        this._drone(G, L, pal, pad.x, dy + te * 1.5, pad.z, now, false, ck, k);
        const m = ix.upToDate ? 1 : Math.min(6, Math.max(2, ix.files || 3));
        for (let i = 0; i < m; i++) { const u = (te - i * 0.12) / 0.9; if (u > 0 && u < 1) this._arc(G, pad, desk, u, 1.0, 0.16 * k, 0.14 * k, 0.16 * k, pal.parcel); }
      }
    } else if (op === 'commit') {
      this._drone(G, L, pal, pad.x, dy, pad.z, now, false, ck, k);
      const q = (te == null ? 0.4 : 1) * k;
      L.box(pad.x + 0.45, 0.25, pad.z - 0.45, 0.24 * q, 0.22 * q, 0.24 * q, pal.parcel);
      if (te != null && te < 0.8) G.box(pad.x + 0.45, 0.4 + te * 0.4, pad.z - 0.45, 0.3 * k, 0.02, 0.3 * k, ck);
    } else if (op === 'merge' || op === 'rebase' || op === 'pr-merge') {
      const q = te == null ? this._u((tt % 2) / 2, 0.5) : Math.min(1, te / 1.1);
      for (const s of [0, Math.PI]) { const a = s + q * Math.PI * 3, r = 0.6 * (1 - q); L.box(pad.x + Math.cos(a) * r, 0.35 + q * 0.2, pad.z + Math.sin(a) * r, 0.2 * k, 0.2 * k, 0.2 * k, pal.parcel); }
      if (te != null && f.ok) G.box(pad.x, 0.6, pad.z, 0.3 * k, 0.3 * k, 0.3 * k, ck);
    } else {
      // PR·CI·태그 등: 발송대 옆 신호등 칸(통과 초록·실패 빨강·대기 노랑) — 움직임 줄이기면 대기 칸은 깜빡이지 않고 켜짐
      this._drone(G, L, pal, pad.x, dy, pad.z, now, false, ck, k);
      const ci = ix.ci || {};
      const cells = [[ci.pass || 0, 'ok'], [ci.pending || 0, 'warn'], [ci.fail || 0, 'err']];
      const c = Math.min(k, 1.4);
      cells.forEach(([cnt, key], i) => { const on = cnt > 0 || (te == null && key === 'warn'); G.box(pad.x - 0.9, 0.35 + i * 0.22 * c, pad.z - 0.3 + i * 0.3, 0.16 * c, 0.16 * c, 0.16 * c, on ? (key === 'warn' && !blink(3) ? this.col('dim') : this.col(key)) : this.col('dim')); });
    }
  }

  /** 컨베이어(방 지역 좌표 — roomFrame 이 돌린 방을 맞춘다): 벨트는 오른쪽 벽을 따라 z 축. 소포는 벨트 폭 안에서만 커짐 */
  _batch(G, L, pal, f, ix, rl, tt, te, A, ck, now) {
    const o = rl.origin, F = OFFICE_FX.conveyor;
    const cx = o.x + F.x, z0 = o.z + F.z0, len = F.z1 - F.z0;
    const lanes = Math.max(1, Math.min(3, ix.par || (ix.op === 'fan' ? 3 : 1)));
    const ps = Math.min(0.18 * this.s, 0.6 / lanes), lw = Math.min(0.2 * this.s, 0.62 / lanes);
    const rate = this.mod.IxModel.rate ? this.mod.IxModel.rate(f) : null;
    const v = Math.min(2.2, Math.max(0.5, rate ? rate * 0.25 : 0.9)) * (te == null ? 1 : Math.max(0, 1 - te));
    const per = 4;
    for (let l = 0; l < lanes; l++) for (let i = 0; i < per; i++) {
      const u = this.red ? (i / per + l * 0.13) % 1 : ((tt * v / len + i / per + l * 0.13) % 1); // 움직임 줄이기: 멈춘 벨트
      L.box(cx + (l - (lanes - 1) / 2) * lw, 0.86, z0 + u * len, ps, ps * 0.9, ps, i % 2 ? pal.parcel : pal.paper);
    }
    // 진행 막대(i/N) — 벨트 안쪽 옆, 끝나면 결과색. 굵기 화면 2～3px 하한(F1)
    const p = ix.n ? clamp01((ix.i || 0) / ix.n) : ix.pct != null ? clamp01(ix.pct / 100) : null;
    const pc = te != null ? this.col(f.ok === false ? 'err' : 'ok') : ck;
    const bw = Math.max(0.05 * this.s, vxIxThin(0.05, this.ppu, this.vip));
    if (p != null && p > 0) G.box(cx - 0.4, 1.0, z0 + (len * p) / 2, bw, bw, len * p, pc);
    // 연속·분기 맥박(움직임 줄이기면 없음)
    if (!this.red) for (const t0 of f.pulses || []) { const k = now - t0; if (k < 0.6) { const s = 0.25 * this.s * (1 - k / 0.6); G.box(cx, 1.2 + k, z0 + len / 2, s, s, s, ck); } }
  }

  /** 신호등 보드(방 지역 좌표, 왼쪽 벽에 걸려 +x 를 봄): 빨강·노랑·초록 + 통과/실패 막대. 커져도 보드 틀(높이 0.95 · 길이 2.0) 안에서 */
  _tests(G, f, ix, rl, tt, te, A, now) {
    const o = rl.origin, F = OFFICE_FX.qc, red = this.red;
    const fx = o.x + F.x + 0.08, z0 = o.z + F.z;
    const pass = ix.pass || 0, fail = ix.fail || 0, skip = ix.skip || 0, tot = pass + fail + skip;
    const running = te == null;
    const ls = 0.2 * Math.min(this.s, 1.4), bh = 0.16 * Math.min(this.s, 2.4); // 등은 칸 간격 0.3 안, 막대는 틀 아래 끝까지
    const blink = (hz) => red || Math.floor(now * hz) % 2 === 0;
    const lamp = (i, key, on) => G.box(fx, 1.72, z0 - 0.6 + i * 0.3, 0.05, ls, ls, on ? this.col(key) : this.col('dim'));
    lamp(0, 'err', fail > 0 && (!running || blink(4)));
    lamp(1, 'warn', running && blink(3));
    lamp(2, 'ok', !running && f.ok !== false && fail === 0);
    const W = 1.7;
    if (tot > 0) {
      const wp = W * pass / tot, wf = W * fail / tot, ws = W * skip / tot;
      let z = z0 - W / 2;
      if (wp > 0) { G.box(fx, 1.3, z + wp / 2, 0.04, bh, wp, this.col('ok')); z += wp; }
      if (wf > 0) { G.box(fx, 1.3, z + wf / 2, 0.04, bh, wf, this.col('err')); z += wf; }
      if (ws > 0) G.box(fx, 1.3, z + ws / 2, 0.04, bh, ws, this.col('skip'));
    } else if (running) {
      if (red) G.box(fx, 1.3, z0, 0.04, bh, W, this._c.copy(this.col('tests')).multiplyScalar(0.45)); // 쓸기 대신 옅은 막대 하나
      else { const u = (tt * 0.6) % 1; G.box(fx, 1.3, z0 - W / 2 + u * W, 0.04, bh, 0.25, this.col('tests')); }
    }
  }

  _labels(chips) {
    const v = this.view;
    chips.sort((a, b) => b.at - a.at);
    while (this.labels.length < Math.min(LABELS, chips.length)) {
      const el = document.createElement('div');
      el.className = 'vx-ix';
      const o = new CSS2DObject(el);
      o.center.set(0.5, 1);
      v.scene.add(o);
      this.labels.push({ o, el, html: '', cls: '' });
    }
    for (let i = 0; i < this.labels.length; i++) {
      const L = this.labels[i], c = i < LABELS ? chips[i] : null;
      if (!c) { if (L.o.visible) L.o.visible = false; continue; }
      const f = c.f;
      const html = `<i>${escapeHtml(c.glyph ?? (this.mod.IX_GLYPH[f.cat] || ''))}</i>${escapeHtml(c.text ?? (this.mod.ixSummary(f.ix) || this.mod.IX_LABEL[f.cat] || ''))}`;
      if (L.html !== html) { L.el.innerHTML = html; L.html = html; }
      const cls = 'vx-ix c-' + f.cat + (f.ok === false ? ' bad' : f.tEnd != null ? ' done' : '');
      if (L.cls !== cls) { L.el.className = cls; L.cls = cls; }
      L.el.style.opacity = (c.A * (v._fxA ? v._fxA(c.x, c.z) : 1)).toFixed(2); // 프로젝트 페이드
      L.el.style.setProperty('--ixc', c.color || this.mod.ixColor(f.cat, !!v.tokens.isLight));
      L.o.position.set(c.x, c.y, c.z);
      if (!L.o.visible) L.o.visible = true;
    }
  }

  dispose() { for (const L of this.labels) { L.o.removeFromParent(); L.el.remove(); } this.labels = []; }
}
