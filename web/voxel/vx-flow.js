// 복셀 오피스 업무 흐름 — Flow 흐름 연출을 사무실 바닥으로:
//  · 바닥 조명 라인: 팀장 ↔ 팀원(부모 ↔ 자식) 자리 사이 걷는 길과 같은 꺾은선. 가늘고 은은한 기본 + 늘 흐르는 대시(부모 → 자식,
//    작업 중 빠르고 밝게·대기 느리게·끝남 멈춤 — agent-flow 기법). 다른 방(별관)끼리는 공중 빔(호) 위 대시만.
//  · 빛 패킷: 같은 계획(planFlow — 호출 ↓·결과 ↑·출력)을 라인 위로 보낸다. 머리 + 잔광, 지나는 구간 바닥이 잠깐 밝아짐.
// 그리기는 VoxelView 동적 빛 묶음(BoxBatch)에 상자를 넣는다(그리기 호출 추가 0).
import * as THREE from 'three';
import { FLOW, PacketPool, planFlow, easeInOut, linkPoint } from '../flow-core.mjs';
import { floorRoute, routeCum, routeAt, dashStarts, lineStyle } from './office-core.mjs';
import { DEG, degOf, degOfLink, lineGap, lineFlicker, packetGone, seedOf } from '../degrade-core.mjs';

const ROUTE_CAP = 240, MAX_PACKETS = 160, DASH_LEN = 0.55, Y_LINE = 0.022, Y_PKT = 0.16;
const PKT_SPEED = 9; // 바닥 패킷 속도(단위/초)

export class VxFlow {
  constructor(view) {
    this.view = view;
    this.pool = new PacketPool(MAX_PACKETS, 6);
    this.state = { lastUp: new Map(), lastOut: new Map() };
    this.routes = new Map(); // 'p|c' → {pid, cid, pts, cum, L, air}
    this._ver = -1;
    this._c = new THREE.Color(); this._c2 = new THREE.Color(); this._lc = new THREE.Color();
    this._pt = { x: 0, z: 0, dx: 0, dz: 1 }; this._pa = { x: 0, y: 0, z: 0 }; this._pb = { x: 0, y: 0, z: 0 }; this._po = { x: 0, y: 0, z: 0 };
    this.stats = { routes: 0, packets: 0, dashes: 0 };
  }

  clear() { this.pool.clear(); this.state.lastUp.clear(); this.state.lastOut.clear(); }

  /** app.onEvent → view.flowEvent(라이브·재생·mock 같은 길, quiet 제외) */
  event(ev, { speed = 1 } = {}) {
    const v = this.view;
    const now = performance.now() / 1000;
    const plans = planFlow(ev, {
      has: (id) => v.vis.has(id) || v.chars.has(id) || v.machines.has(id),
      parentOf: (id) => { const n = v.nodes.get(id); return n ? n.parentId : null; },
      activeChild: (id) => { const kids = v.children(id); for (let i = kids.length - 1; i >= 0; i--) { const n = v.nodes.get(kids[i]); if (n && n.status === 'active') return kids[i]; } return null; },
      now, speed, state: this.state,
    });
    for (const pl of plans) {
      if (pl.kind !== 'link') continue;
      const s = this.pool.alloc(pl.from, now);
      s.from = pl.from; s.to = pl.to; s.color = pl.color; s.size = pl.size || 1; s.speed = Math.min(2, Math.max(1, Math.sqrt(speed)));
      s.dur = 0; // 길을 찾으면 정함(새 직원은 자리 배정 뒤)
    }
  }

  /** 자리(seat) 또는 기계 위치 */
  _anchor(id) {
    const v = this.view, ch = v.chars.get(id);
    if (ch) return ch.seat && ch.room && ch.placed && ch.state !== 'gone' && !ch.offstage ? { seat: ch.seat, room: ch.room } : null;
    const m = v.machines.get(id);
    if (m && m.type === 'job') return null; // 작업 카드는 주인 기계에 붙어 있어 바닥 라인을 긋지 않는다
    if (m && m.pos && !m.released) return { seat: { x: m.pos.x, z: m.pos.z }, room: v.roomsById.get(m.pos.roomId) || null };
    return null;
  }

  /** 배치가 바뀌면 길 다시(자리 기준이라 프레임마다 아님) */
  _rebuild() {
    const v = this.view;
    this.routes.clear();
    for (const [id, n] of v.nodes) {
      if (this.routes.size >= ROUTE_CAP) break;
      const p = n.parentId;
      if (!p || !v.nodes.has(p)) continue;
      const a = this._anchor(p), b = this._anchor(id);
      if (!a || !b) continue;
      const same = a.room && b.room && a.room.id === b.room.id;
      let pts;
      if (same) pts = floorRoute(a.seat, b.seat, a.room);
      else pts = [{ x: a.seat.x, z: a.seat.z }, { x: b.seat.x, z: b.seat.z }];
      const cum = routeCum(pts);
      const L = cum[cum.length - 1];
      if (!(L > 0.5)) continue;
      this.routes.set(p + '|' + id, { pid: p, cid: id, pts, cum, L, air: !same });
    }
    this.stats.routes = this.routes.size;
  }

  /** 라인 색: 세션 색(여러 세션) 또는 흐름 호출 색 */
  _lineColor(id) {
    const v = this.view, n = v.nodes.get(id);
    return (n && v.sess && v.sess.sessColor(n)) || v.tokens['flow-call'] || v.tokens.k_main || v.tokens.text;
  }

  /** 매 프레임: G = 동적 빛 묶음 */
  draw(G, now) {
    const v = this.view, tok = v.tokens, pal = v.pal;
    if (this._ver !== v._layoutVer) { this._ver = v._layoutVer; this._rebuild(); }
    const floor = pal.carpet, reduced = !!v.reduced;
    let nd = 0;
    const pt = this._pt;
    for (const r of this.routes.values()) {
      if (v._isDim(r.cid)) continue;
      const n = v.nodes.get(r.cid);
      if (!n) continue;
      const ch = v.chars.get(r.cid);
      if (ch && (ch.state === 'gone' || ch.state === 'leave')) continue;
      const st = lineStyle(n.status), lc = this._lineColor(r.cid), lk = tok.isLight ? 1.6 : 1;
      // 신호 열화: 그 세션 바닥 조명 라인은 꺾은선 토막이 수시로 꺼지고 밝기가 튄다
      const dg = DEG.on ? degOf(r.cid) : 0, sd = dg > 0 ? (r.seed ?? (r.seed = seedOf(r.cid))) : 0, tt = DEG.reduced ? 0 : DEG.t;
      if (!r.air) {
        const c = this._c.copy(floor).lerp(lc, Math.min(1, st.k * lk * (dg > 0 ? lineFlicker(sd, tt, dg) * (1 + dg) : 1)));
        for (let i = 1; i < r.pts.length; i++) {
          if (dg > 0 && lineGap(sd, i, tt, dg)) continue;
          const a = r.pts[i - 1], b = r.pts[i];
          const sx = Math.abs(b.x - a.x) + 0.05, sz = Math.abs(b.z - a.z) + 0.05;
          G.box((a.x + b.x) / 2, Y_LINE, (a.z + b.z) / 2, sx, 0.012, sz, c);
        }
      }
      if (reduced || !st.v || v._farAll) continue;
      const dc = this._c2.copy(floor).lerp(lc, Math.min(1, st.dash * lk));
      for (const s0 of dashStarts(r.L, now, st.v)) {
        const u = Math.min(r.L, s0 + DASH_LEN / 2) / r.L;
        if (r.air) {
          const A = r.pts[0], B = r.pts[r.pts.length - 1];
          linkPoint(this._po, { x: A.x, y: 1.4, z: A.z }, { x: B.x, y: 1.4, z: B.z }, u, 2.6);
          G.box(this._po.x, this._po.y, this._po.z, 0.09, 0.09, 0.09, dc);
        } else {
          routeAt(r.pts, r.cum, u, pt);
          G.box(pt.x, Y_LINE + 0.004, pt.z, Math.abs(pt.dx) * DASH_LEN + 0.07, 0.014, Math.abs(pt.dz) * DASH_LEN + 0.07, dc);
        }
        nd++;
      }
    }
    // 패킷
    let np = 0;
    const dead = [];
    for (const s of this.pool.active) {
      let r = this.routes.get(s.from + '|' + s.to), rev = false;
      if (!r) { r = this.routes.get(s.to + '|' + s.from); rev = true; }
      if (!r) { if (now - s.t0 > 1.6) dead.push(s); continue; } // 새 직원 자리 배정을 잠깐 기다림
      if (!s.dur) { s.dur = Math.max(0.7, Math.min(2.4, r.L / PKT_SPEED)) / s.speed; s.t0 = now; }
      const u = (now - s.t0) / s.dur;
      if (u >= 1) { dead.push(s); continue; }
      if (v._isDim(r.cid)) continue;
      if (DEG.on && !DEG.reduced && packetGone((s.t0 * 1000) | 0, u, degOfLink(s.from, s.to))) continue; // 패킷 중간 소실
      const e = easeInOut(Math.max(0, u));
      const col = s.color === 'call' ? (tok['flow-call'] || tok.text) : s.color === 'ok' ? tok.ok : s.color === 'error' ? tok.error : s.color === 'stopped' ? tok.stopped : tok['k-bash-bg'];
      const at = (w, out) => {
        const uu = rev ? 1 - w : w;
        if (r.air) { const A = r.pts[0], B = r.pts[r.pts.length - 1]; linkPoint(out, { x: A.x, y: 1.4, z: A.z }, { x: B.x, y: 1.4, z: B.z }, uu, 2.6); out.y += 0.1; }
        else { routeAt(r.pts, r.cum, uu, pt); out.x = pt.x; out.z = pt.z; out.y = Y_PKT + 0.05 * Math.sin(w * Math.PI); }
        return out;
      };
      const h = at(e, this._pa), sz = 0.2 * s.size * (u > 0.88 ? 0.4 + 0.6 * (1 - u) / 0.12 : 1);
      G.box(h.x, h.y, h.z, sz, sz, sz, col);
      for (let i = 1; i <= 5; i++) {
        const w = e - i * 0.035 * (8 / Math.max(4, r.L));
        if (w < 0) break;
        const q = at(w, this._pb), f = i / 6;
        const ts = sz * (1 - f * 0.7);
        G.box(q.x, q.y, q.z, ts, ts, ts, this._c.copy(col).lerp(tok.bg, f * 0.7));
      }
      if (!r.air) { // 지나는 바닥 구간이 잠깐 밝게
        routeAt(r.pts, r.cum, rev ? 1 - e : e, pt);
        G.box(pt.x, Y_LINE + 0.006, pt.z, Math.abs(pt.dx) * 1.2 + 0.09, 0.012, Math.abs(pt.dz) * 1.2 + 0.09, this._c.copy(this._lineColor(r.cid)).lerp(col, 0.5));
      }
      np++;
    }
    for (const s of dead) this.pool.release(s);
    this.stats.packets = np; this.stats.dashes = nd;
  }
}
