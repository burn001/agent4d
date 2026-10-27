// Planet 2D 분리 프로세스 · 장시간 직렬 작업 연출 — 3D(planet-proc.js)와 같은 인상의 단순판, 규칙은 planet-proc-core.mjs.
//  · 분리 프로세스 = 소행성 다각형 위 갑판 · 데릭 실루엣 · 폭이 출렁이며 도는 오거 날(회전 = 처리율, 과열 = 느려지고 멈칫)
//    · 구멍의 열 빛(호박 → 주홍) · 굴뚝 연기 방울 · 상태 등.
//  · 레인마다 점선이 흐르는 2차 곡선 컨베이어 + 광석 점(로그 진행 줄 = 큰 덩이) → 띄운 행성 둘레 납작한 화물 호에 쌓인 점.
//  · 자동 진행 작업 = 계기 판(proc-meter.js 공용 캔버스를 그대로 drawImage) — 멀면 큰 숫자 알약.
//  · 들여다보기: wait = 플랫폼 둘레 점선 타원 + 도는 탐사선, peek·끝난 펄스 = 읽는 노드에서 플랫폼으로 옅은 삼각 빔 + 훑는 선,
//    progress = 플랫폼 → 읽는 노드로 돌아오는 점.
// 저사양: 프로세스가 없으면 아무것도 하지 않고(level 0), 있으면 15fps(level 1).
import { PROC, procLook, drillSpin, drillHitch, heatTip, OreFeed, oreFlight, oreEase, conveyorBend, quadAt, cargoCount, cargoSlot,
  meterModel, meterBig, laneColor, ProcWatch, watchLook, procName, isExtRig, extRigState, extRigJob, extMeterModel, extMeterBig } from '../planet-proc-core.mjs';
import { isProc, procState, procJobId, isAutoJob, jobOf, laneValue, isJobEndedState } from '../job-core.mjs';
import { hash01 } from '../planet-core.mjs';
import { MeterCanvas } from '../proc-meter.js';
import { mixColor } from './flat-core.mjs';

const TAU = Math.PI * 2;
const rgb = (h, a = 1) => `rgba(${(h.r * 255) | 0},${(h.g * 255) | 0},${(h.b * 255) | 0},${a})`;
const _a = { x: 0, y: 0, z: 0 }, _b = { x: 0, y: 0, z: 0 }, _c = { x: 0, y: 0, z: 0 }, _o = { x: 0, y: 0, z: 0 };
/** 2D 화물 호 납작함(Planet 2D 궤도 투영과 비슷하게) */
const FLAT_Y = 0.47;

export class ProcFlat {
  constructor(view) {
    this.view = view;
    this.watch = new ProcWatch();
    this._flash = new Map();
    this._seen = new Set();
    this.meters = new Map(); // 작업 id → {mc, sig, at, rect, compact}
    this._last = -1;
    this.any = false;
  }
  clear() { this.watch.clear(); this._flash.clear(); this._seen.clear(); for (const v of this.view.vis.values()) if (v._pr) { v._pr.ores.length = 0; v._pr.feed.clear(); v._pr.cargo = []; } }
  event(ev) { this.watch.event(ev); }
  node(n) { if (isProc(n)) this.watch.node(n); }
  forget(id) { this.watch.forget(id); this.meters.delete(id); }
  /** 움직임 등급: 프로세스가 보이면 1(15fps) — 펄스·광석이 있으면 1 유지 */
  level() {
    let any = false;
    for (const v of this.view.vis.values()) if (!v.gone && !v.hidden && v.node && (isProc(v.node) || isExtRig(v.node))) { any = true; break; } // 외부 작업 플랫폼도
    this.any = any;
    return any && !this.view.reduced ? 1 : 0;
  }
  supervising(nodeId) { for (const p of this.watch.pulses(this.view.clock())) if (p.open && p.from === nodeId) return p.to; return null; }

  /** 프레임마다 한 번(_drawScene 앞): 회전·열·광석 발사 */
  step(now) {
    const dt = this._last < 0 ? 0 : Math.min(0.25, now - this._last);
    this._last = now;
    if (!this.any) return;
    const view = this.view, reduced = !!view.reduced;
    for (const v of view.vis.values()) {
      const ext = !!v.node && isExtRig(v.node); // 외부 작업 = 플랫폼(레인은 그 작업의 진행 줄)
      if (!v.node || !(ext || isProc(v.node))) continue;
      const r = v._pr || (v._pr = { feed: new OreFeed(), ores: [], cargo: [], ang: hash01(v.id, 'pr') * TAU, spin: 0, heatK: 0, state: null, seed: hash01(v.id, 'pr') });
      const st = ext ? extRigState(jobOf(v.node), view.clock()) : procState(v.node) || 'running';
      if (r.state && r.state !== st && (st === 'done' || st === 'failed' || st === 'stopped')) { r.ores.length = 0; r.endAt = now; }
      r.state = st;
      const jv = ext ? null : view.vis.get(procJobId(v.node)), job = ext ? extRigJob(jobOf(v.node)) : jv ? jobOf(jv.node) : null;
      r.job = job;
      const heat = job ? Math.max(0, Math.min(1, Number(job.heat) || 0)) : 0;
      const pri = job && Array.isArray(job.lanes) ? (job.lanes.find((l) => l.key === job.primary) || job.lanes[0]) : null;
      const running = st === 'running';
      const target = drillSpin(st, heat, job ? job.rate : null, reduced) * (running && !reduced ? drillHitch(now, heat, pri && pri.last ? pri.last.v : 0, r.seed) : 1);
      r.spin += (target - r.spin) * Math.min(1, dt * (target > r.spin ? 3 : 1.4));
      r.ang = (r.ang + r.spin * dt) % TAU;
      const hk = running || st === 'stale' ? heat : 0;
      r.heatK += (hk - r.heatK) * Math.min(1, dt * (hk > r.heatK ? 1.5 : 0.4));
      if (job && !v.hidden && !v.gone) for (const o of r.feed.step(job, dt, running && !reduced)) { // 움직임 줄이기: 처리율 부스러기 없이 진행 줄 덩이만
        if (r.ores.filter((x) => x.lane === o.lane).length >= PROC.ORE_MAX) continue;
        r.ores.push({ lane: o.lane, t0: now, dur: 0, big: o.big, s: o.big ? 1 : 0.6 + 0.25 * hash01(v.id, String(now)) });
      }
    }
    // 진행 들여다보기 결과 → 계기 체크
    for (const p of this.watch.pulses(view.clock())) {
      if (p.open || !p.progress) continue;
      const k = p.from + '|' + p.to + '|' + Math.round((view.clock() - p.ageMs) / 100);
      if (this._seen.has(k)) continue;
      this._seen.add(k); if (this._seen.size > 256) this._seen.clear();
      this._flash.set(p.to, now - p.ageMs / 1000);
    }
  }

  /** 컨베이어·광석·화물 호·들여다보기(노드 아래 층) */
  drawFlows(ctx, now, s) {
    if (!this.any) return;
    const view = this.view, t = view.tokens, L = !!t.isLight;
    for (const v of view.vis.values()) {
      const r = v._pr;
      if (!r || !v._on || v.hidden || v.gone || !r.job) continue;
      const pv = view.vis.get(v.node.parentId);
      if (!pv || pv.hidden || pv.gone || !pv._sp) continue;
      const op = Math.min((v.baseOpacity ?? 1) * (v.exitF ?? 1), (pv.baseOpacity ?? 1) * (pv.exitF ?? 1) * 1.2, 1) * (v.projA ?? 1);
      if (op < 0.03) continue;
      const lanes = (r.job.lanes || []).slice(0, PROC.LANES);
      const P = v._sp, Q = pv._sp, R = v._R, pR = pv._R;
      const dx = P.x - Q.x, dy = (P.y - Q.y) / FLAT_Y, dl = Math.hypot(dx, dy) || 1;
      const baseA = Math.atan2(dy, dx);
      const running = r.state === 'running';
      const ended = isJobEndedState(r.job.state);
      lanes.forEach((l, i) => {
        const col = laneColor(i, L);
        const want = cargoCount(laneValue(l, view.clock(), { ended, aheadSec: Number(r.job.staleSec) > 0 ? Number(r.job.staleSec) : null }));
        if (r.cargo[i] == null || r.cargo[i] > want) r.cargo[i] = want;
        const inflight = r.ores.reduce((n, o) => n + (o.lane === i && o.big ? 1 : 0), 0);
        if (r.cargo[i] < want - inflight || !running) r.cargo[i] = Math.max(r.cargo[i], running ? want - inflight : want);
        const Rc = pR * (PROC.CARGO_R + 0.34 * i);
        const slot = (k, out) => { const cs = cargoSlot(k); const a = baseA + cs.a; const RR = Rc + cs.row * 0.13 * pR; out.x = Q.x + Math.cos(a) * RR; out.y = Q.y + Math.sin(a) * RR * FLAT_Y - cs.row * 0.07 * pR; return out; };
        // 화물 호 자리 + 쌓인 점
        ctx.globalAlpha = op * (L ? 0.35 : 0.28); ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(Q.x, Q.y, Rc, Rc * FLAT_Y, 0, baseA - PROC.CARGO_SPAN * 1.08, baseA + PROC.CARGO_SPAN * 1.08); ctx.stroke();
        if (pR >= 3) {
          ctx.globalAlpha = op * 0.9; ctx.fillStyle = col;
          const cr = Math.max(1, Math.min(4, pR * 0.09));
          for (let k = 0; k < r.cargo[i]; k++) { slot(k, _o); ctx.beginPath(); ctx.arc(_o.x, _o.y, cr, 0, TAU); ctx.fill(); }
        }
        // 컨베이어: 플랫폼 꼭대기 → 다음 화물 자리
        _a.x = P.x; _a.y = P.y - R * 0.7;
        slot(Math.min(PROC.CARGO_MAX - 1, r.cargo[i]), _b);
        const D = Math.hypot(_b.x - _a.x, _b.y - _a.y);
        const bend = conveyorBend(i, lanes.length);
        const nx = -(_b.y - _a.y) / (D || 1), ny = (_b.x - _a.x) / (D || 1);
        _c.x = (_a.x + _b.x) / 2 + nx * bend.side * D; _c.y = (_a.y + _b.y) / 2 + ny * bend.side * D - bend.lift * D * 0.8;
        ctx.globalAlpha = op * (L ? 0.6 : 0.5) * (running ? 1 : 0.55);
        ctx.setLineDash([5, 4]); ctx.lineDashOffset = running && !view.reduced ? -now * (10 + 30 / Math.max(0.4, 2.6 - Math.min(2.2, Math.log10(1 + (l.rate || 0)) * 0.36))) : 0;
        ctx.beginPath(); ctx.moveTo(_a.x, _a.y); ctx.quadraticCurveTo(_c.x, _c.y, _b.x, _b.y); ctx.stroke(); ctx.setLineDash([]);
        // 광석
        const worldD = D / Math.max(1, s);
        for (let k = r.ores.length - 1; k >= 0; k--) {
          const o = r.ores[k];
          if (o.lane !== i) continue;
          if (!o.dur) o.dur = oreFlight(worldD, l.rate);
          const kk = (now - o.t0) / o.dur;
          if (kk >= 1) { r.ores.splice(k, 1); if (o.big && r.cargo[i] < want) r.cargo[i]++; continue; }
          quadAt(_a, _c, _b, oreEase(kk), _o);
          const rr = Math.max(1.2, Math.min(o.big ? 5 : 3, pR * (o.big ? 0.16 : 0.09) * o.s)) * (kk < 0.1 ? kk / 0.1 : 1);
          ctx.globalAlpha = op; ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(_o.x, _o.y, rr, 0, TAU); ctx.fill();
          if (o.big) { ctx.strokeStyle = L ? '#0f172a' : '#ffffff'; ctx.globalAlpha = op * 0.5; ctx.lineWidth = 1; ctx.stroke(); }
        }
      });
    }
    // 들여다보기
    for (const p of this.watch.pulses(view.clock())) {
      const fv = view.vis.get(p.from), tv = view.vis.get(p.to);
      if (!fv || !tv || fv.hidden || tv.hidden || fv.gone || tv.gone || !fv._sp || !tv._sp || (!fv._on && !tv._on)) continue;
      const look = watchLook(p);
      const op = Math.min((fv.baseOpacity ?? 1) * (fv.exitF ?? 1), (tv.baseOpacity ?? 1) * (tv.exitF ?? 1) * 1.3, 1) * (tv.projA ?? 1);
      if (op < 0.03) continue;
      const P = tv._sp, F = fv._sp, R = tv._R;
      const wc = L ? mixColor(view.kindColor(fv.kind), '#000000', 0.25) : mixColor(view.kindColor(fv.kind), '#ffffff', 0.35);
      if (look.ring > 0) {
        const RR = R * PROC.WAIT_R;
        ctx.globalAlpha = op * 0.55 * look.ring; ctx.strokeStyle = wc; ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]); ctx.lineDashOffset = view.reduced ? 0 : -now * 8;
        ctx.beginPath(); ctx.ellipse(P.x, P.y - R * 0.4, RR, RR * FLAT_Y, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        const pa = (view.reduced ? 0.3 : now * 0.9) + hash01(p.from + p.to, 'w') * TAU;
        const qx = P.x + Math.cos(pa) * RR, qy = P.y - R * 0.4 + Math.sin(pa) * RR * FLAT_Y, qs = Math.max(2, Math.min(5, R * 0.2));
        ctx.globalAlpha = op * look.ring; ctx.fillStyle = wc;
        ctx.beginPath(); ctx.moveTo(qx, qy - qs); ctx.lineTo(qx + qs, qy); ctx.lineTo(qx, qy + qs); ctx.lineTo(qx - qs, qy); ctx.closePath(); ctx.fill();
      }
      if (look.beam > 0.01) {
        const dx = P.x - F.x, dy = P.y - F.y, dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
        const sx = F.x + ux * fv._R * 1.05, sy = F.y + uy * fv._R * 1.05;
        const top = P.y - R * 2.0, bot = P.y + R * 0.6, yy = top + (bot - top) * look.sweep;
        ctx.globalAlpha = op * look.beam * (L ? 0.16 : 0.13); ctx.fillStyle = wc;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(P.x - R * 1.1, yy); ctx.lineTo(P.x + R * 1.1, yy); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = op * look.beam * 0.85; ctx.strokeStyle = wc; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(P.x - R * 1.1, yy); ctx.lineTo(P.x + R * 1.1, yy); ctx.stroke();
      }
      if (look.packet >= 0) {
        const k = look.packet, e = k * k * (3 - 2 * k);
        const x = P.x + (F.x - P.x) * e, y = P.y + (F.y - P.y) * e - Math.sin(k * Math.PI) * R * 1.2;
        ctx.globalAlpha = op; ctx.fillStyle = laneColor(0, L);
        ctx.beginPath(); ctx.arc(x, y, Math.max(2, Math.min(4.5, R * 0.22)), 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 분리 프로세스 노드 하나(소행성 + 드릴 플랫폼). x,y = 화면 중심, R = 그린 반지름 px */
  drawRig(ctx, v, x, y, R, alpha, now, col, edge) {
    const view = this.view, t = view.tokens, L = !!t.isLight;
    const st = isExtRig(v.node) ? extRigState(jobOf(v.node), view.clock()) : procState(v.node) || 'running', look = procLook(st);
    const r = v._pr || { ang: 0, spin: 0, heatK: 0, state: st, seed: 0 };
    if (R < 2.5) { ctx.globalAlpha = alpha; ctx.fillStyle = col; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); ctx.globalAlpha = 1; return; }
    // 바위
    const rock = L ? mixColor('#8b8378', col, 0.25) : mixColor('#3b3631', col, 0.16);
    const tint = look.tint ? t[look.tint] : null;
    const rk = tint ? mixColor(rock, tint, st === 'stopped' ? 0.5 : 0.35) : rock;
    const N = 9, deckY = y - R * 0.45, ar = R * 0.82;
    ctx.globalAlpha = alpha; ctx.fillStyle = rk; ctx.strokeStyle = L ? mixColor(rk, '#000000', 0.35) : mixColor(rk, '#ffffff', 0.25); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + r.seed * 3, k = 0.82 + 0.3 * hash01(v.id, 'a' + i);
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * ar * k, Math.max(deckY, y + R * 0.12 + Math.sin(a) * ar * k));
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // 구멍 열 빛(과열)
    const ht = heatTip(r.heatK, L);
    if (r.heatK > 0.05) {
      const gr = R * (0.25 + 0.45 * ht.k);
      const g = ctx.createRadialGradient(x, deckY, 0, x, deckY, gr);
      g.addColorStop(0, rgb(ht, (L ? 0.5 : 0.7) * ht.k)); g.addColorStop(1, rgb(ht, 0));
      ctx.globalAlpha = alpha; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, deckY, gr, 0, TAU); ctx.fill();
    }
    const metal = L ? mixColor(col, '#475569', 0.6) : mixColor(col, '#cbd5e1', 0.62);
    // 갑판
    ctx.globalAlpha = alpha; ctx.fillStyle = metal; ctx.fillRect(x - R * 0.72, deckY - R * 0.1, R * 1.44, R * 0.14);
    const topY = y - R * 2.0;
    // 데릭(다리 둘 + 가로대) · 꼭대기
    ctx.strokeStyle = metal; ctx.lineWidth = Math.max(1, R * 0.07);
    ctx.beginPath(); ctx.moveTo(x - R * 0.55, deckY - R * 0.1); ctx.lineTo(x, topY); ctx.lineTo(x + R * 0.55, deckY - R * 0.1); ctx.stroke();
    if (R >= 7) {
      ctx.lineWidth = Math.max(0.8, R * 0.04);
      for (const h of [0.38, 0.7]) { const yy = deckY - R * 0.1 + (topY - deckY + R * 0.1) * h, hw = R * 0.55 * (1 - h); ctx.beginPath(); ctx.moveTo(x - hw, yy); ctx.lineTo(x + hw, yy); ctx.stroke(); }
      ctx.fillRect(x - R * 0.1, topY - R * 0.06, R * 0.2, R * 0.12);
    }
    // 오거 드릴: 축 + 폭이 출렁이는 날(회전)
    const steel = L ? '#475569' : '#e2e8f0';
    ctx.strokeStyle = steel; ctx.lineWidth = Math.max(1, R * 0.05);
    ctx.beginPath(); ctx.moveTo(x, deckY + R * 0.05); ctx.lineTo(x, topY + R * 0.15); ctx.stroke();
    if (R >= 6) {
      const NF = 7, y0 = deckY - R * 0.22, y1 = topY + R * 0.35;
      ctx.lineWidth = Math.max(1, R * 0.06);
      for (let k = 0; k < NF; k++) {
        const yy = y0 + (y1 - y0) * (k / (NF - 1)), c = Math.cos(r.ang * 2 + k * 0.9), w = R * 0.22 * c;
        ctx.globalAlpha = alpha * (0.55 + 0.45 * Math.abs(c));
        ctx.beginPath(); ctx.moveTo(x - w, yy + R * 0.06 * c); ctx.lineTo(x + w, yy - R * 0.06 * c); ctx.stroke();
      }
      ctx.globalAlpha = alpha;
    }
    // 굴뚝 + 연기 방울
    if (R >= 6) {
      const cx = x + R * 0.42, ch = R * 0.55;
      ctx.fillStyle = metal; ctx.fillRect(cx - R * 0.07, deckY - R * 0.1 - ch, R * 0.14, ch);
      if (look.smoke > 0 && !view.reduced) {
        const k0 = (st === 'running' ? 0.35 + 0.5 * r.heatK : 0.18);
        for (let i = 0; i < 4; i++) {
          const u = (now * k0 + i / 4 + r.seed) % 1;
          ctx.globalAlpha = alpha * look.smoke * (1 - u) * (L ? 0.35 : 0.3);
          ctx.fillStyle = L ? '#6b7280' : '#9ca3af';
          ctx.beginPath(); ctx.arc(cx + u * R * 0.5, deckY - R * 0.1 - ch - u * R * 1.3, R * (0.08 + 0.18 * u), 0, TAU); ctx.fill();
        }
      }
      // 상태 등
      const lc = t[look.lamp] || t.ok;
      const bl = look.blink > 0 && !view.reduced ? (st === 'stale' ? (Math.sin((now * TAU) / look.blink) > 0 ? 1 : 0.15) : 0.55 + 0.45 * Math.sin((now * TAU) / look.blink)) : 1;
      ctx.globalAlpha = alpha * bl; ctx.fillStyle = lc;
      ctx.beginPath(); ctx.arc(x - R * 0.55, deckY - R * 0.2, Math.max(1.2, R * 0.08), 0, TAU); ctx.fill();
    }
    // 열기 입자(과열일 때 구멍에서 튀는 점 몇 개 — 결정적)
    if (r.heatK > 0.3 && R >= 8 && !view.reduced) {
      for (let i = 0; i < 5; i++) {
        const u = (now * (0.9 + 0.6 * r.heatK) + i / 5 + r.seed) % 1;
        const sx = x + (hash01(v.id, 'h' + i) - 0.5) * R * 0.6 * (0.4 + u);
        ctx.globalAlpha = alpha * (1 - u) * r.heatK; ctx.fillStyle = rgb(ht, 1);
        ctx.fillRect(sx - 1, deckY - u * R * 0.9 - 1, 2, 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 자동 진행 작업 = 계기 판(가까우면 전체, 멀면 큰 숫자). x,y = 작업 노드 화면 자리 · opts.rig = 외부 작업 플랫폼(데릭 위 계기, 투사기 없음) */
  drawMeter(ctx, v, x, y, R, alpha, now, s, opts = {}) {
    const view = this.view, t = view.tokens, L = !!t.isLight;
    const job = jobOf(v.node);
    if (!job || alpha < 0.02) return;
    let e = this.meters.get(v.id);
    if (!e) { e = { mc: new MeterCanvas(), sig: '', at: -1e9, compact: null, light: null, flashAt: -1e9 }; this.meters.set(v.id, e); }
    const rig = !!opts.rig;
    const m = (rig ? extMeterModel : meterModel)(job, view.clock(), L);
    const rows = Math.max(1, m.rows.length);
    const Hw = 0.36 + 0.34 * rows; // 3D 와 같은 판 높이(세계)
    const compact = Hw * s < PROC.METER_FULL_PX * 0.8; // 2D 캔버스 글자는 선명해 조금 일찍 전체 판
    const pid = v.node.parentId;
    const fl = this._flash.get(pid); if (fl != null && fl > e.flashAt) e.flashAt = fl;
    const flash = now - e.flashAt < 2.4 ? 1 - (now - e.flashAt) / 2.4 : 0;
    const big = compact ? (rig ? extMeterBig : meterBig)(job, view.clock()) : '';
    const key = (compact ? 'c|' + big : m.sig) + '|' + L + '|' + (flash > 0 ? 'f' + Math.round(flash * 6) : '');
    if (compact !== e.compact || L !== e.light || (key !== e.sig && now - e.at > 0.08) || (!compact && MeterCanvas.rolling(m) && now - e.at > 0.083)) {
      e.compact = compact; e.light = L; e.sig = key; e.at = now;
      const pv = view.vis.get(pid);
      e.mc.draw({ model: m, light: L, flash, name: pv && isProc(pv.node) ? procName(pv.node) : (v.node.label || ''), compact, big, ok: t.ok, err: t.error });
    }
    const c = e.mc.canvas;
    const h = compact ? 22 : Hw * s, w = (h * c.width) / c.height;
    const bx = x - w / 2, by = y - R * (rig ? PROC.TOP_Y + 0.45 : 1.6) - h;
    // 투사선(전체 판일 때): 투사기(플랫폼이면 데릭 꼭대기) → 판 아래 두 모서리
    if (!compact) {
      const y0 = rig ? y - R * PROC.TOP_Y : y - R * 0.5;
      ctx.globalAlpha = alpha * 0.35; ctx.strokeStyle = t.skill; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(bx + w * 0.08, by + h); ctx.moveTo(x, y0); ctx.lineTo(bx + w * 0.92, by + h); ctx.stroke();
    }
    if (!rig) { // 투사기(작은 원판)
      ctx.globalAlpha = alpha; ctx.fillStyle = L ? '#64748b' : '#2b3442'; ctx.strokeStyle = t.skill; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x, y, Math.max(2, R), Math.max(1.5, R * 0.55), 0, 0, TAU); ctx.fill(); ctx.stroke();
    }
    ctx.globalAlpha = alpha * (m.ended ? 0.75 : 0.95);
    ctx.drawImage(c, bx, by, w, h);
    ctx.globalAlpha = 1;
    e.rect = { x: bx, y: by, w, h };
  }
  /** 계기 판 집기(캔버스 좌표) → 작업 노드 id */
  pickMeter(px, py) {
    for (const [id, e] of this.meters) { const r = e.rect; const v = this.view.vis.get(id); if (r && v && !v.hidden && !v.gone && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return id; }
    return null;
  }
  /** 프레임마다 그린 판만 사각형 유지(보이지 않은 것은 지움) */
  beginFrame() { for (const e of this.meters.values()) e.rect = null; }
}
export { isProc, isAutoJob };
