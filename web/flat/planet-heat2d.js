// Planet 2D 에이전트 과열 연출 — 3D(planet-heat.js)와 같은 세기 규칙(planet-heat-core.mjs heatLook)을 Canvas 2D 로.
//  · 몸체 전(drawUnder): 따뜻한 글로우 원(과열 = 맥동, 위험 = 코로나 깜빡임 고리 + 가끔 플레어 엽)
//  · 멀리서도(전체 보기 기본 거리) 읽히게: 후광 반지름·연기 크기에 화면 px 하한(haloPx·smokePx), 몸 색 물듦(tint), 궤도 링·위성 단계색(tintCol)
//  · 몸체 뒤(drawOver): 주황 테두리·몸 색 물듦(데움), 가는 김(데움 30%↑), 균열 용암빛 선(과열), 극·해치에서 오르는 연기 가닥(과열), 부모 반대쪽 짙은 연기 꼬리·불티(위험)
//  · 연기·불티는 상태 없이 시각으로만 계산(puff2D) — 다시 그려도·재생해도 같은 그림, 입자 장부 없음.
//  · 다시 그리기: 바뀐 것이 있을 때만(FlatView 규칙). 연기가 움직이는 노드가 보이면 level 1(배경 움직임 15fps), heat 보간 중에도 1.
//  · 다크 = 글로우 'lighter'·연기 보통 섞기(옅은 회색), 라이트 = 'multiply' 곱하기 잉크(— 글로우 주황 잉크, 연기 회색 잉크).
//  · 움직임 줄이기(view.reduced): 연기·불티·플레어·맥동 없음, 정지 글로우·테두리·균열만.
import { HeatBook } from '../heat-core.mjs';
import { PHEAT, heatLook, heatLive, heatOnStep, heatCss, puff2D, flare2D, hh, farK, heatRingK, heatRgb } from '../planet-heat-core.mjs';
import { mixColor } from './flat-core.mjs';

const TAU = Math.PI * 2;
const _pf = {};

export class Heat2D {
  constructor(view) {
    this.view = view;
    this.book = new HeatBook();
    this.on = new Map();
    this._pruneAt = 0;
  }
  clear() { this.book.clear(); this.on.clear(); }

  /** 논리 갱신(_updateExtra 에서) — 노드마다 v._ht(그릴 heat × 켜짐)·v._hest. 돌려주는 값 = 다시 그리기 단계(0 | 1) */
  step(now, dt) {
    const view = this.view, book = this.book;
    if (now - this._pruneAt > 0.5 || now < this._pruneAt) { this._pruneAt = now; book.prune(view.vis); for (const id of this.on.keys()) if (!view.vis.has(id)) this.on.delete(id); }
    let level = 0;
    for (const v of view.vis.values()) {
      const node = v.node, ctx = node && node.meta && node.meta.ctx;
      if (!ctx && !this.on.has(v.id)) { v._ht = 0; continue; }
      const h0 = book.get(v.id), had = this.on.has(v.id);
      const h = book.step(v.id, node, dt);
      const o0 = had ? this.on.get(v.id) : 1;
      const o = heatOnStep(o0, heatLive(v), dt);
      this.on.set(v.id, o);
      const eff = h * o;
      v._ht = eff; v._hest = !!(ctx && ctx.estimated);
      if (eff < 0.002 || v.hidden || v.gone) continue;
      if (Math.abs(h - h0) > 1e-3 || o !== o0) { level = 1; view.dirty = true; } // 오르고 식는 동안
      if (!view.reduced && !view._frozen && v._on !== false) level = 1; // 연기(30%↑ 가는 김)·맥동이 움직임
    }
    return level;
  }

  /** 몸체 전: 글로우·코로나·플레어. Rb = 몸체 화면 반지름, Rs = 글로우·연기 기준 반지름(시안 작은 본체는 Rb 보다 크게, 없으면 Rb) */
  drawUnder(ctx, v, x, y, Rb, alpha, now, Rs = Rb) {
    const h = v._ht || 0;
    if (h < 0.002 || Rb < PHEAT.PX_GLOW) return;
    const view = this.view, L = !!view.tokens.isLight, red = !!view.reduced;
    const lk = heatLook(h, { reduced: red, estimated: v._hest });
    const T = red ? 0 : now;
    const ph = (v.seed || 0) * 6.1;
    const pul = 1 + lk.pulse * Math.sin(T * TAU * lk.pulseHz + ph);
    const gR = Math.max(Rb * lk.glowR, Rs * 1.25, Rb + lk.haloPx * farK(view.H)) * 1.05; // 화면 px 하한 — 행성이 작아도 단계색 원으로 읽힘
    const a = Math.min(1, lk.glow * alpha * pul * 1.1); // 멀리서 데움 후광이 읽히게 조금 짙게
    ctx.save();
    ctx.globalCompositeOperation = L ? 'multiply' : 'lighter';
    const g = ctx.createRadialGradient(x, y, Rb * 0.7, x, y, gR);
    const rim = a * (0.2 + 0.28 * lk.crit); // 바깥 테(3D GLOW_F rim 과 같은 몫)
    g.addColorStop(0, heatCss(h, a * 0.75));
    g.addColorStop(0.4, heatCss(h, a * 0.3));
    g.addColorStop(0.68, heatCss(h, a * 0.12 + rim * 0.3));
    g.addColorStop(0.8, heatCss(h, a * 0.08 + rim));
    g.addColorStop(0.92, heatCss(h, rim * 0.25));
    g.addColorStop(1, heatCss(h, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, gR, 0, TAU); ctx.fill();
    // 위험: 코로나 고리(깜빡이는 토막) + 플레어 엽
    if (lk.crit > 0.01 && Rb >= 3) {
      const n = 14, rr = Rb * 1.12;
      ctx.lineWidth = Math.max(1, Rb * 0.12); ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU + (red ? 0 : T * 0.25);
        const f = red ? 0.7 : 0.6 + 0.4 * Math.sin(a0 * 7 + T * 2.3 + ph) * Math.sin(a0 * 3 - T * 1.7);
        ctx.strokeStyle = heatCss(Math.min(1, h + 0.1), a * lk.crit * f * 0.9);
        ctx.beginPath(); ctx.arc(x, y, rr, a0, a0 + (TAU / n) * 0.62); ctx.stroke();
      }
      if (!red) {
        const fl = flare2D(now, v.seed || 0, lk.crit);
        if (fl.k > 0.01) {
          const dx = Math.cos(fl.ang), dy = Math.sin(fl.ang), len = Rb * (1.2 + 1.3 * fl.k);
          const fg = ctx.createLinearGradient(x + dx * Rb, y + dy * Rb, x + dx * (Rb + len), y + dy * (Rb + len));
          fg.addColorStop(0, heatCss(1, a * fl.k)); fg.addColorStop(1, heatCss(1, 0));
          ctx.fillStyle = fg;
          const w = Rb * 0.45, nx = -dy * w, ny = dx * w;
          ctx.beginPath();
          ctx.moveTo(x + dx * Rb * 0.95 + nx, y + dy * Rb * 0.95 + ny);
          ctx.quadraticCurveTo(x + dx * (Rb + len * 0.6) + nx * 0.6, y + dy * (Rb + len * 0.6) + ny * 0.6, x + dx * (Rb + len), y + dy * (Rb + len));
          ctx.quadraticCurveTo(x + dx * (Rb + len * 0.6) - nx * 0.6, y + dy * (Rb + len * 0.6) - ny * 0.6, x + dx * Rb * 0.95 - nx, y + dy * Rb * 0.95 - ny);
          ctx.closePath(); ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /** 몸체 뒤: 테두리·균열·연기·불티. away = 부모 반대쪽 화면 방향 {x, y}(없으면 오른쪽 위) */
  drawOver(ctx, v, x, y, Rb, alpha, now, away, Rs = Rb) {
    const h = v._ht || 0;
    if (h < 0.002 || Rb < PHEAT.PX_GLOW) return;
    const view = this.view, L = !!view.tokens.isLight, red = !!view.reduced;
    const lk = heatLook(h, { reduced: red, estimated: v._hest });
    const T = red ? 0 : now, seed = v.seed || 0, ph = seed * 6.1;
    const pul = red ? 1 : 0.72 + 0.28 * Math.sin(T * (2.6 + 3 * lk.crit) + ph);
    ctx.save();
    // 데움: 주황 테두리(대기 쪽)
    if (Rb >= 2.5) {
      ctx.globalCompositeOperation = L ? 'multiply' : 'lighter';
      ctx.lineWidth = Math.max(1, Rb * (0.1 + 0.06 * lk.hot));
      ctx.strokeStyle = heatCss(h, alpha * (0.18 + 0.62 * lk.warm) * (0.6 + 0.4 * pul) * (L ? 0.85 : 1)); // 데움 30% 부터 뚜렷(70% 꽉 찬 0.8 그대로)
      ctx.beginPath(); ctx.arc(x, y, Rb * 0.98, 0, TAU); ctx.stroke();
    }
    // 데움: 몸 전체 색 물듦(멀리서 몸 색으로 읽힘)
    if (lk.tint > 0.01 && Rb >= 1.2) {
      ctx.globalCompositeOperation = L ? 'multiply' : 'screen';
      ctx.fillStyle = heatCss(h, alpha * lk.tint * (L ? 0.42 : 0.4));
      ctx.beginPath(); ctx.arc(x, y, Rb * 0.97, 0, TAU); ctx.fill();
    }
    // 과열: 균열 용암빛(노드마다 정해진 지그재그 셋, 몸체 안)
    if (lk.hot > 0.01 && Rb >= 5) {
      ctx.lineWidth = Math.max(0.8, Rb * 0.055); ctx.lineJoin = 'round';
      ctx.strokeStyle = heatCss(Math.min(1, h + 0.15), alpha * lk.hot * (0.55 + 0.45 * pul));
      for (let c = 0; c < 3; c++) {
        let ang = hh(seed, c, 1) * TAU, rr = Rb * (0.15 + 0.25 * hh(seed, c, 2));
        ctx.beginPath(); ctx.moveTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
        for (let k = 1; k <= 4; k++) {
          ang += (hh(seed, c, k + 3) - 0.5) * 0.9; rr = Math.min(Rb * 0.86, rr + Rb * (0.12 + 0.08 * hh(seed, c, k + 9)));
          ctx.lineTo(x + Math.cos(ang) * rr + (hh(seed, c, k + 20) - 0.5) * Rb * 0.18, y + Math.sin(ang) * rr + (hh(seed, c, k + 30) - 0.5) * Rb * 0.18);
        }
        ctx.stroke();
      }
    }
    if (!red && Rb >= PHEAT.PX_FAR) {
      ctx.globalCompositeOperation = L ? 'multiply' : 'source-over';
      const near = Rs >= PHEAT.PX_FULL * 0.8, mid = Rs >= PHEAT.PX_SMOKE * 0.6;
      const Rs0 = Rs;
      Rs = Math.max(Rs, lk.smokePx * farK(view.H)); // 멀리서도 가닥으로 보이게 화면 px 하한
      const farA = Rs > Rs0 * 1.2 ? 1.6 : 1; // 하한으로 키운 먼 연기는 더 짙게(3D 와 같은 몫)
      // 데움 50%↑: 옅은 가닥 하나(가까우면 둘) · 과열: 극·해치 연기 가닥 둘(가까우면 셋) — 위로 오르며 커지고 옅어짐
      if (lk.smoke > 0) {
        const thin = lk.hot < 0.01, strands = thin ? (near ? 2 : 1) : near ? 3 : 2, n = thin ? 3 : near ? 6 : 4, life = 1.7;
        const dens = Math.min(0.9, (lk.hot * (0.34 + 0.1 * lk.crit) + 0.24 * lk.wisp * (1 - lk.hot)) * farA);
        for (let s = 0; s < strands; s++) {
          const ox = s === 0 ? 0 : (s === 1 ? -0.5 : 0.55) * Rs, oy = s === 0 ? -Rs * 0.95 : -Rs * 0.78;
          for (let i = 0; i < n; i++) {
            const p = puff2D(now, i, n, life, seed + s * 0.37, _pf), t = p.t;
            const px = x + ox + p.jit * Rs * 0.25 * t + Math.sin(t * 5 + p.k + s) * Rs * 0.12;
            const py = y + oy - t * Rs * 2.6;
            const r = Rs * (0.16 + 0.5 * t);
            const a = alpha * dens * (t < 0.15 ? t / 0.15 : 1) * Math.pow(1 - t, 1.3);
            this._puff(ctx, px, py, r, a, lk.shade, 0.2 * lk.crit * (1 - t), L);
          }
        }
      }
      // 위험: 부모 반대쪽으로 흩날리는 짙은 꼬리 + 불티
      if (lk.tail > 0) {
        let ax = away ? away.x : 0.8, ay = away ? away.y : -0.6;
        ay -= 0.45; const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
        const n = near ? 10 : 6, life = 2.4;
        for (let i = 0; i < n; i++) {
          const p = puff2D(now, i, n, life, seed + 0.71, _pf), t = p.t;
          const d = Rs * (0.9 + 3.4 * t);
          const px = x + ax * d + (-ay) * p.jit * Rs * 0.5 * t;
          const py = y + ay * d + ax * p.jit * Rs * 0.5 * t - t * t * Rs * 0.8;
          const r = Rs * (0.3 + 0.95 * t);
          const a = alpha * lk.crit * 0.5 * (t < 0.12 ? t / 0.12 : 1) * Math.pow(1 - t, 1.2);
          this._puff(ctx, px, py, r, a, Math.min(1, lk.shade + 0.15), 0.55 * (1 - t) * (1 - t), L);
        }
        ctx.globalCompositeOperation = L ? 'source-over' : 'lighter';
        const ne = near ? 5 : mid ? 3 : 0; // 불티는 가까울 때만
        for (let i = 0; i < ne; i++) {
          const p = puff2D(now, i, ne, 1.1, seed + 0.13, _pf), t = p.t;
          const ea = hh(p.k, i, seed + 5) * TAU, up = -0.6 - 0.6 * hh(p.k, i, seed + 7);
          const ex = Math.cos(ea) * 0.7, ey = Math.sin(ea) * 0.35 + up;
          const d = Rs * (1 + 2.4 * t);
          ctx.fillStyle = heatCss(0.55 + 0.3 * hh(p.k, i, 2), alpha * lk.crit * (1 - t));
          ctx.beginPath(); ctx.arc(x + ex * d, y + ey * d + t * t * Rs * 0.6, Math.max(0.8, Rs * 0.07), 0, TAU); ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /** 궤도 링·위성·시안 부품 단계색: CSS 색 col 을 노드 heat 색 쪽으로(40단계로 끊어 캐시). 뜨겁지 않으면 col 그대로 */
  tintCol(v, col) {
    const h = v._ht || 0;
    if (!(h > 0.002)) return col;
    const q = Math.round(heatRingK(h, v._hest) * 40), qh = Math.round(h * 40);
    const key = col + '|' + q + '|' + qh;
    if (v._htcK === key) return v._htc;
    const c = heatRgb(qh / 40);
    const hex = '#' + c.map((u) => Math.round(u * 255).toString(16).padStart(2, '0')).join('');
    v._htcK = key; v._htc = mixColor(col, hex, q / 40);
    return v._htc;
  }

  _puff(ctx, x, y, r, a, shade, warm, L) {
    if (a < 0.01 || r < 0.5) return;
    let c;
    if (L) { const g = Math.round(128 - 62 * shade); c = [g + Math.round(60 * warm), g - Math.round(10 * warm), g - Math.round(30 * warm)]; }
    else { const g = Math.round(168 - 76 * shade); c = [Math.round(g + (255 - g) * warm * 0.7), Math.round(g + (110 - g) * warm * 0.7), Math.round(g + (40 - g) * warm * 0.7)]; }
    const al = Math.min(1, a * (L ? 0.9 : 1));
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${al.toFixed(3)})`);
    g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
}
