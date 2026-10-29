// 복셀 2D 평면도의 개편 연출 — 3D(vx-flow·vx-holo·vx-ix·vx-client)와 같은 순수 규칙(office-core·client-core·flow-core)을
// 위에서 본 평면으로: 바닥 조명 라인(흐르는 대시)·빛 패킷, 스탠딩 데스크 홀로그램 모니터(종류 색 판 + 가까우면 도구 이름),
// 탕비실·특별 상호작용 시설·의뢰인 스크린(정적), 특별 상호작용 은유(시설 맥박·소포 점·요약 칩), 의뢰인 창구(카드·메모·질문 선택지).
// Voxel2DView 가 하나 만든다. 캔버스 2D 만 쓴다(three 없음).
import { FLOW, PacketPool, planFlow, easeInOut, catColor } from '../flow-core.mjs';
import { OFFICE_FX, ixSpot, floorRoute, routeCum, routeAt, dashStarts, lineStyle, clientScreen, clientSpot, MON } from '../voxel/office-core.mjs';
import { ClientDesk, clientOp, CLIENT } from '../voxel/client-core.mjs';
import { userBook, consoleLines, hitRect } from '../user-core.mjs'; // 사용자 콘솔
import * as IX from '../ix-core.mjs';
import { DEG, degOf, degOfLink, packetGone, lineFlicker, brokenDash, seedOf } from '../degrade-core.mjs';
const DG_DASH = [0, 0, 0, 0]; // 끊긴 선 무늬(재사용)


const FONT = '"Pretendard", "Segoe UI", "Malgun Gothic", system-ui, sans-serif';
const MIX = new Map();
/** 색 섞기(#rrggbb 둘, k = b 쪽 비율) → rgb() 문자열(기억) */
export function mixHex(a, b, k) {
  const key = a + b + Math.round(k * 50);
  let r = MIX.get(key);
  if (r) return r;
  const p = (h) => { const m = /^#?([0-9a-f]{6})/i.exec(h || ''); const n = m ? parseInt(m[1], 16) : 0x888888; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const A = p(a), B = p(b), kk = Math.round(k * 50) / 50;
  r = `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * kk)).join(',')})`;
  if (MIX.size > 4000) MIX.clear();
  MIX.set(key, r);
  return r;
}

export class Vx2DExtra {
  constructor(view) {
    this.view = view;
    this.pool = new PacketPool(128, 6);
    this.fstate = { lastUp: new Map(), lastOut: new Map() };
    this.routes = new Map();
    this._ver = -1;
    this.desks = new Map();
    this.cst = { ixSeen: false, askId: null };
    this._pt = { x: 0, z: 0, dx: 0, dz: 1 };
    this.ixModel = new IX.IxModel(); // 복셀 2D 특별 상호작용 장부(바탕 FlatIx 는 복셀에서 꺼져 있음)
  }
  clear() { this.pool.clear(); this.desks.clear(); this.routes.clear(); this._ver = -1; this.ixModel.clear(); }
  /** 카메라 git 붙잡기가 함께 담을 발송대 자리(평면 세계 x·z) [{x,y:0,z,r}] | null */
  holdPts(id) {
    const v = this.view, ch = v.chars.get(id), m = !ch && v.machines.get(id);
    const room = ch ? ch.room : m && m.pos ? v.roomsById.get(m.pos.roomId) : null;
    const off = room && room.type === 'office' ? room : room && room.officeId ? v.roomsById.get(room.officeId) : null;
    const sp = off && ixSpot(off, 'github');
    return sp ? [{ x: sp.x, y: 0, z: sp.z, r: 1.4 }] : null;
  }
  _nodes() { return this.view._nodeMap(); }

  // ---------------- 이벤트 ----------------
  event(ev, { speed = 1 } = {}) {
    const v = this.view, nm = this._nodes(), now = v._now;
    const plans = planFlow(ev, {
      has: (id) => v.chars.has(id) || v.machines.has(id),
      parentOf: (id) => { const n = nm.get(id); return n ? n.parentId : null; },
      activeChild: (id) => { for (const ch of v.chars.values()) if (ch.node.parentId === id && ch.node.status === 'active') return ch.id; return null; },
      now, speed, state: this.fstate,
    });
    for (const pl of plans) {
      if (pl.kind !== 'link') continue;
      const s = this.pool.alloc(pl.from, now);
      s.from = pl.from; s.to = pl.to; s.color = pl.color; s.size = pl.size || 1; s.speed = Math.min(2, Math.max(1, Math.sqrt(speed))); s.dur = 0;
    }
    // 특별 상호작용(장부)
    const rootOf = (id) => { let cur = id; for (let i = 0; i < 64; i++) { const n = nm.get(cur); if (!n || !n.parentId || !nm.has(n.parentId)) return cur; cur = n.parentId; } return cur; };
    this.ixModel.event(ev, now, speed, rootOf);
    // 의뢰인 창구
    const isMain = (id) => { const n = nm.get(id); return !!n && n.kind === 'main'; };
    const o = clientOp(ev, isMain, this.cst);
    if (o && o.lead && nm.has(o.lead)) {
      if (o.op === 'ask') this.cst.askId = o.toolUseId || null;
      if (o.op === 'answer' || o.op === 'alert') this.cst.askId = null;
      let d = this.desks.get(o.lead); if (!d) { d = new ClientDesk(); this.desks.set(o.lead, d); }
      const n = nm.get(o.lead);
      if (d.apply(o, now, !!n && n.status === 'active' && (n.openTools || []).length > 0) && o.op === 'alert') {
        const room = v.layout && v.layout.roomOf ? v.layout.roomOf.get(o.lead) : null;
        for (const ch of v.chars.values()) if (ch.room && ch.room.id === room) ch.flinchUntil = now + CLIENT.FLINCH;
      }
    }
  }
  /** 매 프레임(상태): 팀장 심부름·카드 읽기·모니터 열림 */
  step(now, dt) {
    const v = this.view;
    for (const [id, d] of this.desks) {
      d.step(now);
      const ch = v.chars.get(id);
      if (!ch || !ch.room) continue;
      const er = d.errand(now);
      if (er) { const sp = clientSpot(ch.room); if (sp) ch.errand = { spot: sp, until: er.until, kind: er.kind }; }
      ch.readUntil = d.readUntil;
    }
    const book = v.holo && v.holo.book;
    for (const ch of v.chars.values()) {
      let has = false, cat = null, bt = -Infinity;
      if (book) for (const e of book.list(ch.id)) { if (e.slot < 0) continue; const ph = book.phaseOf(e, now); if (ph.phase === 'gone') continue; has = true; const t = Math.max(e.t0, e.swapAt ?? -Infinity) + (e.endAt == null ? 1e3 : 0); if (t > bt) { bt = t; cat = e.cat; ch._monTool = e.label ? e.label.tool : e.tool; } }
      const want = has && ch.atDesk() && ch.seat && ch.seat.kind !== 'meet' && ch.state !== 'gone';
      ch._monK = Math.max(0, Math.min(1, (ch._monK || 0) + (want ? dt / MON.OPEN : -dt / MON.CLOSE)));
      ch._monCat = cat;
    }
  }
  /** 움직임이 있나(2D 갱신 단계) */
  animating(now) {
    if (this.pool.size || this.ixModel.fx.size) return 2;
    for (const d of this.desks.values()) if (d.cards.length || d.ask || d.report || now - d.alertAt < CLIENT.ALERT) return 2;
    for (const ch of this.view.chars.values()) if (ch._monK > 0 && ch._monK < 1) return 2;
    return this.routes.size ? 1 : 0;
  }

  // ---------------- 정적(방 지역 좌표, 돌린 방은 캔버스가 돌아 있음) ----------------
  /** 탕비실·특별 상호작용 시설·의뢰인 스크린 틀·스탠딩 데스크 발광대 */
  drawRoomStatic(ctx, r, s) {
    const v = this.view, pal = v.pal, o = r.origin, F = OFFICE_FX;
    const R = (x, z, w, d, c) => { ctx.fillStyle = c; v._rect(ctx, x, z, w, d); };
    R(o.x + F.pantry.x, o.z + F.pantry.z, 0.75, F.pantry.len, pal.counter);
    R(o.x + F.pantry.x - 0.05, o.z + F.pantry.z - 0.55, 0.42, 0.4, pal.machine);
    R(o.x + F.archive.x - 0.05, o.z + F.archive.z, 0.7, 1.4, pal.metal);
    R(o.x + F.vault.x - 0.05, o.z + F.vault.z, 0.72, 1.4, pal.vault);
    if (s > 4) { ctx.strokeStyle = pal.vaultDoor; ctx.lineWidth = Math.max(1, 0.08 * s); ctx.beginPath(); ctx.arc(v._X(o.x + F.vault.x + 0.25), v._Y(o.z + F.vault.z), 0.35 * s, 0, Math.PI * 2); ctx.stroke(); }
    R(o.x + F.qc.x + 0.05, o.z + F.qc.z, 0.12, F.qc.len, pal.boardFrame);
    R(o.x + F.conveyor.x, (o.z * 2 + F.conveyor.z0 + F.conveyor.z1) / 2, 0.66, F.conveyor.z1 - F.conveyor.z0, pal.belt);
    R(o.x + 11.5, o.z + F.booth.z - 0.8, 0.95, 0.08, pal.booth); R(o.x + 11.5, o.z + F.booth.z + 0.8, 0.95, 0.08, pal.booth);
    R(o.x + F.dispatch.x, o.z + F.dispatch.z + (r.ext || 0), 1.5, 1.5, pal.pad);
    if (s > 6) { ctx.fillStyle = pal.paper; ctx.font = `700 ${Math.round(Math.min(14, s * 0.6))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; v._text(ctx, 'H', v._X(o.x + F.dispatch.x), v._Y(o.z + F.dispatch.z + (r.ext || 0))); }
  }

  // ---------------- 동적(세계 좌표) ----------------
  _rebuild() {
    const v = this.view, nm = this._nodes();
    this.routes.clear();
    const anchor = (id) => {
      const ch = v.chars.get(id);
      if (ch) return ch.seat && ch.room && ch.placed && ch.state !== 'gone' && !ch.offstage ? { seat: ch.seat, room: ch.room } : null;
      const m = v.machines.get(id);
      if (m && m.type === 'job') return null; // 작업 카드는 주인 기계에 붙어 있어 바닥 라인을 긋지 않는다
      if (m && m.pos && !m.released) return { seat: { x: m.pos.x, z: m.pos.z }, room: v.roomsById.get(m.pos.roomId) || null };
      return null;
    };
    for (const [id, n] of nm) {
      if (this.routes.size >= 240) break;
      const p = n.parentId;
      if (!p || !nm.has(p)) continue;
      const a = anchor(p), b = anchor(id);
      if (!a || !b) continue;
      const same = a.room && b.room && a.room.id === b.room.id;
      const pts = same ? floorRoute(a.seat, b.seat, a.room) : [{ x: a.seat.x, z: a.seat.z }, { x: b.seat.x, z: b.seat.z }];
      const cum = routeCum(pts), L = cum[cum.length - 1];
      if (L > 0.5) this.routes.set(p + '|' + id, { pid: p, cid: id, pts, cum, L, air: !same });
    }
  }
  _lineColor(id) {
    const v = this.view, vv = v.vis.get(id);
    return (vv && vv.node && v.vsess.sessColor(vv.node)) || v.tokens['flow-call'] || v.tokens['k-main'];
  }
  /** 바닥 라인·대시·패킷 */
  drawFlow(ctx, now, s) {
    const v = this.view, t = v.tokens, pal = v.pal, nm = this._nodes();
    if (this._ver !== v._layoutVer) { this._ver = v._layoutVer; this._rebuild(); }
    const X = v._X, Y = v._Y, pt = this._pt, L = !!t.isLight;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const r of this.routes.values()) {
      const vv = v.vis.get(r.cid);
      if (!vv || vv.hidden || !(vv.scopeK ?? 1)) continue;
      const fa = vv.projA ?? 1; // 프로젝트 페이드(문턱 대신 투명도)
      const n = nm.get(r.cid);
      const ch = v.chars.get(r.cid);
      if (!n || (ch && (ch.state === 'gone' || ch.state === 'leave'))) continue;
      const st = lineStyle(n.status), lc = this._lineColor(r.cid);
      ctx.beginPath();
      if (r.air) { const A = r.pts[0], B = r.pts[1], mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2 - Math.hypot(B.x - A.x, B.z - A.z) * 0.18; ctx.moveTo(X(A.x), Y(A.z)); ctx.quadraticCurveTo(X(mx), Y(mz), X(B.x), Y(B.z)); }
      else { ctx.moveTo(X(r.pts[0].x), Y(r.pts[0].z)); for (let i = 1; i < r.pts.length; i++) ctx.lineTo(X(r.pts[i].x), Y(r.pts[i].z)); }
      // 신호 열화: 그 세션 바닥 라인은 끊긴 토막으로 깜빡인다
      const dg = DEG.on ? degOf(r.cid) : 0, tt = DEG.reduced ? 0 : DEG.t, sd = dg > 0 ? (r.seed ?? (r.seed = seedOf(r.cid))) : 0;
      ctx.strokeStyle = lc; ctx.globalAlpha = Math.min(1, st.k * (L ? 1.6 : 1.1) * (dg > 0 ? (1 + dg) * lineFlicker(sd, tt, dg) : 1)) * (r.air ? 0.6 : 1) * fa;
      ctx.lineWidth = Math.max(1, 0.07 * s); ctx.setLineDash(dg > 0 ? brokenDash(sd, tt, dg, Math.max(3, s * 0.35), DG_DASH) : r.air ? [Math.max(2, 0.3 * s), Math.max(2, 0.3 * s)] : []); ctx.stroke();
      if (st.v && !v.reduced) { // 흐르는 대시(부모 → 자식)
        const gap = 4.2 * s, dl = 0.55 * s;
        ctx.setLineDash([dl, gap - dl]); ctx.lineDashOffset = -now * st.v * s;
        ctx.globalAlpha = Math.min(1, st.dash * (L ? 1.5 : 1.2)) * fa; ctx.lineWidth = Math.max(1.5, 0.12 * s); ctx.stroke();
        ctx.lineDashOffset = 0;
      }
      ctx.setLineDash([]);
    }
    // 패킷
    const dead = [];
    for (const p of this.pool.active) {
      let r = this.routes.get(p.from + '|' + p.to), rev = false;
      if (!r) { r = this.routes.get(p.to + '|' + p.from); rev = true; }
      if (!r) { if (now - p.t0 > 1.6) dead.push(p); continue; }
      if (!p.dur) { p.dur = Math.max(0.7, Math.min(2.4, r.L / 9)) / p.speed; p.t0 = now; }
      const rv = v.vis.get(r.cid), pa = rv ? rv.projA ?? 1 : 1;
      if (rv && (rv.hidden || pa <= 0)) continue;
      const u = (now - p.t0) / p.dur;
      if (u >= 1) { dead.push(p); continue; }
      if (DEG.on && !DEG.reduced && packetGone((p.t0 * 1000) | 0, u, degOfLink(p.from, p.to))) continue; // 패킷 중간 소실
      const col = p.color === 'call' ? (t['flow-call'] || t.text) : p.color === 'ok' ? t.ok : p.color === 'error' ? t.error : p.color === 'stopped' ? t.stopped : t['k-bash-bg'];
      const e = easeInOut(Math.max(0, u));
      for (let i = 5; i >= 0; i--) {
        const w = e - i * 0.03;
        if (w < 0) continue;
        const uu = rev ? 1 - w : w;
        if (r.air) { const A = r.pts[0], B = r.pts[1]; pt.x = A.x + (B.x - A.x) * uu; pt.z = A.z + (B.z - A.z) * uu - Math.sin(uu * Math.PI) * Math.hypot(B.x - A.x, B.z - A.z) * 0.09; }
        else routeAt(r.pts, r.cum, uu, pt);
        ctx.globalAlpha = (i ? 0.5 * (1 - i / 6) : 1) * pa; ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(X(pt.x), Y(pt.z), Math.max(1.5, (i ? 0.12 : 0.2) * s * (p.size || 1)), 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const p of dead) this.pool.release(p);
    ctx.globalAlpha = 1;
  }

  /** 스탠딩 데스크 홀로그램 모니터(위에서 본 종류 색 판 — 가까우면 도구 이름) */
  drawMonitors(ctx, now, s) {
    const v = this.view, t = v.tokens, X = v._X, Y = v._Y, L = !!t.isLight;
    for (const ch of v.chars.values()) {
      if (!(ch._monK > 0.02) || !ch.seat || ch.offstage) continue;
      const vv = v.vis.get(ch.id);
      if (!vv || vv.hidden || !(vv.scopeK ?? 1)) continue;
      const fa = vv.projA ?? 1; // 프로젝트 페이드(문턱 대신 투명도)
      const lead = ch.seat.kind === 'lead', k = ch._monK;
      const face = ch.seat.face || 0, fx = Math.sin(face), fz = Math.cos(face);
      const W = (lead ? 2.2 : 1.6) * Math.min(1, k / 0.45), D = 0.5 * Math.max(0.1, (k - 0.45) / 0.55);
      const cx = X(ch.seat.deskX + fx * 0.15), cy = Y(ch.seat.deskZ + fz * 0.15);
      const c = ch._monCat === 'skill' ? t.skill : catColor(ch._monCat || 'other', L);
      const w = (Math.abs(fz) > 0.5 ? W : D) * s, h = (Math.abs(fz) > 0.5 ? D : W) * s;
      ctx.globalAlpha = 0.35 * k * fa; ctx.fillStyle = c; ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.globalAlpha = 0.95 * k * fa; ctx.strokeStyle = c; ctx.lineWidth = Math.max(1, 0.06 * s); ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      if (s > 14 && k > 0.9 && ch._monTool) { ctx.fillStyle = L ? '#1b2433' : '#e6eefb'; ctx.font = `600 ${Math.round(Math.min(11, s * 0.32))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(ch._monTool).slice(0, 14), cx, cy); }
    }
    ctx.globalAlpha = 1;
  }

  /** 특별 상호작용 은유(평면): 시설 맥박 + 책상 ↔ 시설 소포 점 + 요약 칩 */
  drawIx(ctx, now, s) {
    const v = this.view, model = this.ixModel, mod = IX;
    model.step(now);
    if (!model.fx.size) return;
    const X = v._X, Y = v._Y, L = !!v.tokens.isLight;
    let chips = 0;
    for (const f of model.fx.values()) {
      if (now < (f.showAt || 0)) continue;
      const ch = v.chars.get(f.nodeId) || (f.bgNode && v.chars.get(f.bgNode));
      const m = !ch && (v.machines.get(f.nodeId) || (f.bgNode && v.machines.get(f.bgNode)));
      const room = ch ? ch.room : m && m.pos ? v.roomsById.get(m.pos.roomId) : null;
      if (f.cat === 'user') { const kind = mod.ixAutoKind(f.ix); if (kind && kind !== 'dot') this._auto2d(ctx, now, s, f, kind, ch, m); continue; }
      const off = room && room.type === 'office' ? room : room && room.officeId ? v.roomsById.get(room.officeId) : null;
      const sp = off && ixSpot(off, f.cat);
      if (!sp) continue;
      const vv = v.vis.get(f.nodeId);
      if (vv && (vv.hidden || !(vv.scopeK ?? 1))) continue;
      const col = colorOf(mod, f.ok === false ? 'err' : f.cat, L);
      const te = f.tEnd == null ? null : now - f.tEnd;
      const A = (te == null ? 1 : Math.max(0, 1 - te / 3)) * (vv ? vv.projA ?? 1 : 1); // 프로젝트 페이드
      // 맥박 고리
      ctx.globalAlpha = A * (0.5 + 0.4 * Math.sin(now * 5)); ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, 0.08 * s);
      ctx.beginPath(); ctx.arc(X(sp.x), Y(sp.z), (0.9 + 0.25 * Math.sin(now * 3)) * s, 0, Math.PI * 2); ctx.stroke();
      // 책상 ↔ 시설 소포
      const a = ch ? { x: ch.seat ? ch.seat.deskX : ch.pos.x, z: ch.seat ? ch.seat.deskZ : ch.pos.z } : m ? { x: m.pos.x, z: m.pos.z } : null;
      if (a && te == null) {
        const out = f.cat === 'github' ? f.op !== 'pull' && f.op !== 'fetch' && f.op !== 'clone' : f.cat === 'db' ? f.ix.rw === 'w' || f.ix.rw === 'rw' : f.cat === 'remote' ? f.ix.transfer !== 'down' : true;
        const u = (now * 0.7 + (f.seq || 0) * 0.13) % 1, P = out ? a : sp, Q = out ? sp : a;
        ctx.globalAlpha = A; ctx.fillStyle = col;
        ctx.fillRect(X(P.x + (Q.x - P.x) * u) - 0.14 * s, Y(P.z + (Q.z - P.z) * u) - 0.14 * s, 0.28 * s, 0.28 * s);
      }
      // 진행 막대(대량 처리·테스트)
      const ixd = f.ix || {};
      const p = ixd.n ? Math.min(1, (ixd.i || 0) / ixd.n) : (ixd.pass != null || ixd.fail != null) ? (ixd.pass || 0) / Math.max(1, (ixd.pass || 0) + (ixd.fail || 0) + (ixd.skip || 0)) : null;
      if (p != null && s > 5) { ctx.globalAlpha = A; ctx.fillStyle = L ? 'rgba(0,0,0,.15)' : 'rgba(255,255,255,.15)'; ctx.fillRect(X(sp.x) - 0.9 * s, Y(sp.z) + 1.1 * s, 1.8 * s, 0.18 * s); ctx.fillStyle = col; ctx.fillRect(X(sp.x) - 0.9 * s, Y(sp.z) + 1.1 * s, 1.8 * s * p, 0.18 * s); }
      // 요약 칩(가까울 때, 최대 6)
      if (mod && s > 8 && chips < 6) {
        const txt = (mod.IX_GLYPH[f.cat] || '') + ' ' + (mod.ixSummary(ixd) || mod.IX_LABEL[f.cat] || '');
        ctx.font = `600 10.5px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tw = Math.min(220, ctx.measureText(txt).width + 12), x = X(sp.x), y = Y(sp.z) - 1.3 * s - 10;
        ctx.globalAlpha = A; ctx.fillStyle = L ? 'rgba(255,255,255,.92)' : 'rgba(20,24,34,.9)'; ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - tw / 2, y - 8, tw, 16, 8) : ctx.rect(x - tw / 2, y - 8, tw, 16); ctx.fill(); ctx.stroke();
        ctx.fillStyle = v.tokens.text; ctx.fillText(txt.length > 34 ? txt.slice(0, 33) + '…' : txt, x, y + 0.5);
        chips++;
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 예약·Monitor·작업 알림이 연 팀장 턴(평면): 예약 = 책상 위 시계(바늘 한 바퀴) → 책상으로 점 · Monitor·작업 결과 = 출처 자리에서
   *  팀장 책상으로 사각 점(보라·초록·빨강·회색) → 책상 고리 맥박, 결과는 ✓·✕·■. 출처가 안 보이면 책상 쪽만 */
  _auto2d(ctx, now, s, f, kind, ch, m) {
    const v = this.view, X = v._X, Y = v._Y, L = !!v.tokens.isLight, M = IX.IX_AUTO, ix = f.ix;
    const vv = v.vis.get(f.nodeId);
    if (!ch || !vv || vv.hidden || !(vv.scopeK ?? 1)) return;
    const te = f.tEnd == null ? 0 : now - f.tEnd, T = now - f.t0;
    const A = Math.max(0, te < M.LINGER_S * 0.6 ? 1 : 1 - (te - M.LINGER_S * 0.6) / (M.LINGER_S * 0.4)) * (vv.projA ?? 1);
    if (A <= 0.02) return;
    const key = kind === 'schedule' ? 'sched' : kind === 'monitor' ? 'mon' : ix.st === 'err' ? 'err' : ix.st === 'stop' ? 'dim' : 'ok';
    const col = colorOf(IX, key, L);
    const a = { x: ch.seat ? ch.seat.deskX : ch.pos.x, z: ch.seat ? ch.seat.deskZ : ch.pos.z };
    const red = !!v.reduced;
    ctx.globalAlpha = A; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = Math.max(1.2, 0.08 * s);
    const pulse = (t0) => { const q = (T - t0) / 0.8; if (q > 0 && q < 1) { ctx.globalAlpha = A * (1 - q); ctx.beginPath(); ctx.arc(X(a.x), Y(a.z), Math.max(8 + q * 16, (0.6 + q * 1.2) * s), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = A; } }; // 화면 하한(멀리서도 보이게)
    const dot = (P, Q, u, k = 0.14) => { const h = Math.max(3, k * s); ctx.fillRect(X(P.x + (Q.x - P.x) * u) - h, Y(P.z + (Q.z - P.z) * u) - h, 2 * h, 2 * h); };
    let arrive = 0;
    if (kind === 'schedule') {
      const K = { x: a.x + 1.1, z: a.z - 0.9 }, R0 = Math.max(9, 0.42 * s), cx = X(K.x), cy = Y(K.z);
      ctx.beginPath(); ctx.arc(cx, cy, R0, 0, Math.PI * 2); ctx.stroke();
      const ha = -Math.PI / 2 + (red ? 0 : Math.min(1, T / 1.3) * Math.PI * 2);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ha) * R0 * 0.85, cy + Math.sin(ha) * R0 * 0.85); ctx.moveTo(cx, cy); ctx.lineTo(cx + R0 * 0.5, cy); ctx.stroke();
      const u = (T - 0.9) / M.TRAVEL_S; if (u > 0 && u < 1) dot(K, a, u);
      arrive = 0.9 + M.TRAVEL_S;
    } else {
      const sc = ix.from && v.chars.get(ix.from), sm = !sc && ix.from && v.machines.get(ix.from);
      const sv = ix.from && v.vis.get(ix.from);
      const ok = sv && !sv.hidden && (sv.scopeK ?? 1) && !(sc && (sc.offstage || sc.state === 'gone')) && !(sm && sm.released);
      const b = ok ? (sc ? { x: sc.seat ? sc.seat.deskX : sc.pos.x, z: sc.seat ? sc.seat.deskZ : sc.pos.z } : sm && sm.pos ? { x: sm.pos.x, z: sm.pos.z } : null) : null;
      if (b && (b.x !== a.x || b.z !== a.z)) { const u = T / M.TRAVEL_S; if (u < 1) dot(b, a, red ? 0.5 : u, kind === 'monitor' ? 0.12 : 0.16); arrive = M.TRAVEL_S; }
    }
    pulse(arrive);
    if (ix.text && T < 2.8) { // 첫 몇 단어 칩(흐름·Planet 리본과 같은 글)
      const txt = (kind === 'schedule' ? '⏰ ' : kind === 'monitor' ? '◎ ' : '') + (ix.text.length > 18 ? ix.text.slice(0, 17) + '…' : ix.text);
      ctx.font = `600 10.5px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(txt).width + 12, x = X(a.x), y = Y(a.z) - Math.max(26, 1.6 * s);
      ctx.fillStyle = L ? 'rgba(255,255,255,.92)' : 'rgba(20,24,34,.9)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - tw / 2, y - 8, tw, 16, 8) : ctx.rect(x - tw / 2, y - 8, tw, 16); ctx.fill(); ctx.stroke();
      ctx.fillStyle = v.tokens.text; ctx.fillText(txt, x, y + 0.5); ctx.fillStyle = col;
    }
    if (kind === 'result' && T > arrive) { ctx.font = `700 ${Math.round(Math.max(12, Math.min(16, s * 0.5)))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ix.st === 'err' ? '✕' : ix.st === 'stop' ? '■' : '✓', X(a.x), Y(a.z) - Math.max(14, 0.9 * s)); }
    ctx.globalAlpha = 1;
  }

  /** 의뢰인 스크린·카드·메모·질문 선택지 */
  drawClient(ctx, now, s) {
    const v = this.view, t = v.tokens, pal = v.pal, X = v._X, Y = v._Y;
    const user = t['flow-call'] || t['k-main'];
    const hits = this.conHits || (this.conHits = []); hits.length = 0; // 집기 사각형(px)
    const scr = this.conScr || (this.conScr = []); scr.length = 0;
    const tags = [];
    for (const r of v.rooms) {
      if (r.type !== 'office' || !r.leadDesk || r.external) continue;
      const ov = v.vis.get(r.ownerId);
      if (!ov || ov.node.kind !== 'main' || ov.hidden || !(ov.scopeK ?? 1)) continue;
      const fa = ov.projA ?? 1; // 프로젝트 페이드
      const d = this.desks.get(r.ownerId);
      const mode = d ? d.screen(now, ov.node.status === 'idle') : 'idle';
      const sc = clientScreen(r);
      if (!sc) continue;
      const odd = r.xf && r.local ? (Math.round(r.xf.k) % 2 !== 0) : false;
      const w = (odd ? 0.3 : 2.4) * s, h = (odd ? 2.4 : 0.3) * s;
      ctx.globalAlpha = fa;
      ctx.fillStyle = mode === 'alert' ? (Math.floor(now * 4) % 2 ? t.error : pal.screenOff) : mode === 'saver' ? pal.screenOff : mode === 'idle' ? mixHex(pal.screenDim, user, 0.15) : mixHex(pal.screenDim, user, 0.6);
      ctx.fillRect(X(sc.x) - w / 2, Y(sc.z) - h / 2, w, h);
      { // 집기(최소 18×12px) · 대기 중에도 글줄 · 이름표 후보
        const hw = Math.max(9, w / 2 + 3), hh = Math.max(6, h / 2 + 3);
        hits.push({ root: r.ownerId, x0: X(sc.x) - hw, y0: Y(sc.z) - hh, x1: X(sc.x) + hw, y1: Y(sc.z) + hh });
        scr.push({ root: r.ownerId, x: sc.x, z: sc.z });
        if (mode === 'idle' && s > 3) {
          ctx.fillStyle = mixHex(pal.screenDim, user, 0.55);
          if (odd) { ctx.fillRect(X(sc.x) - 0.5, Y(sc.z) - h * 0.3, 1.2, h * 0.3); ctx.fillRect(X(sc.x) - 0.5, Y(sc.z) + h * 0.05, 1.2, h * 0.18); }
          else { ctx.fillRect(X(sc.x) - w * 0.3, Y(sc.z) - 0.5, w * 0.3, 1.2); ctx.fillRect(X(sc.x) + w * 0.05, Y(sc.z) - 0.5, w * 0.18, 1.2); }
        }
        if (s > 6) tags.push({ root: r.ownerId, x: X(sc.x), y: Y(sc.z) - h / 2 - 4, a: fa, hit: hits[hits.length - 1] });
      }
      if (d && d.ask && s > 3) {
        const n = d.ask.n, sp = clientSpot(r);
        for (let i = 0; i < n; i++) {
          const u = n > 1 ? i / (n - 1) - 0.5 : 0, chosen = d.ask.chosen === i;
          const cx = (sc.x + sp.x) / 2 + (odd ? 0 : u * 2.2), cz = (sc.z + sp.z) / 2 + (odd ? u * 2.2 : 0);
          ctx.fillStyle = chosen ? t.ok : mixHex(pal.paper, user, 0.25);
          ctx.fillRect(X(cx) - 0.2 * s, Y(cz) - 0.14 * s, 0.4 * s, 0.28 * s);
        }
      }
      if (d) {
        for (const c of d.liveCards(now)) {
          const u = (now - c.t0) / CLIENT.CARD_DUR, e = easeInOut(Math.min(1, u)), ld = r.leadDesk;
          const x = sc.x + (ld.x - sc.x) * e, z = sc.z + (ld.z - sc.z) * e - Math.sin(e * Math.PI) * 1.2;
          ctx.fillStyle = c.kind === 'memo' ? mixHex(pal.paper, t.skill, 0.35) : pal.paper; ctx.strokeStyle = user; ctx.lineWidth = 1;
          ctx.fillRect(X(x) - 0.17 * s, Y(z) - 0.13 * s, 0.34 * s, 0.26 * s); ctx.strokeRect(X(x) - 0.17 * s, Y(z) - 0.13 * s, 0.34 * s, 0.26 * s);
        }
        if (d.memo && s > 3) { ctx.fillStyle = mixHex(pal.paper, t.skill, 0.45); for (let i = 0; i < d.memo; i++) ctx.fillRect(X(r.leadDesk.x - 0.75) + i * 1.5, Y(r.leadDesk.z + 0.18) - i * 1.5, 0.24 * s, 0.24 * s); }
      }
    }
    // 스크린 이름표: 마지막 입력 첫 몇 단어 · 상태 · 시간(흐름 2D 와 같은 모양, 최대 8)
    const L = !!t.isLight, nowMs = v.clock ? v.clock() : Date.now();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (const g of tags.slice(0, 8)) {
      const info = consoleLines(userBook.get(g.root), nowMs);
      ctx.font = '600 10.5px system-ui, "Segoe UI", sans-serif';
      const w1 = info.text ? ctx.measureText(info.text).width : 0;
      ctx.font = '500 9.5px system-ui, "Segoe UI", sans-serif';
      const w2 = ctx.measureText(info.status).width;
      const bw = Math.min(220, Math.max(w1, w2) + 14), lh = info.text ? 27 : 15;
      ctx.globalAlpha = g.a * 0.92;
      ctx.fillStyle = L ? 'rgba(255,255,255,.9)' : 'rgba(5,5,16,.72)';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(g.x - bw / 2, g.y - lh, bw, lh, 7) : ctx.rect(g.x - bw / 2, g.y - lh, bw, lh); ctx.fill();
      ctx.strokeStyle = user; ctx.lineWidth = 1; ctx.globalAlpha = g.a * 0.5; ctx.stroke();
      ctx.globalAlpha = g.a;
      if (info.text) { ctx.font = '600 10.5px system-ui, "Segoe UI", sans-serif'; ctx.fillStyle = user; ctx.fillText(info.text, g.x, g.y - 15, 210); }
      ctx.font = '500 9.5px system-ui, "Segoe UI", sans-serif'; ctx.fillStyle = t.muted || t.text; ctx.fillText(info.status, g.x, g.y - 4, 210);
      g.hit.y0 = Math.min(g.hit.y0, g.y - lh); g.hit.x0 = Math.min(g.hit.x0, g.x - bw / 2); g.hit.x1 = Math.max(g.hit.x1, g.x + bw / 2);
    }
    ctx.globalAlpha = 1;
  }
  /** 화면 px → 의뢰인 스크린 주인 id | null · 스크린 가운데 {x, z} */
  consoleAt(x, y) { const h = hitRect(this.conHits || [], x, y, 5); return h ? h.root : null; }
  consolePos(root) { const c = (this.conScr || []).find((q) => q.root === root); return c ? { x: c.x, z: c.z } : null; }
}

const IXC = new Map();
function colorOf(mod, key, L) {
  const k = key + (L ? 'L' : 'D');
  let c = IXC.get(k);
  if (!c) { c = mod ? mod.ixKeyColor(key, L) : '#888'; IXC.set(k, c); }
  return c;
}
