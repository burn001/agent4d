// 특별 상호작용 연출 — 2D 캔버스 그리기. 3D 와 같은 IxModel·ixGeometry(세계 좌표 도형)를
// 위에서 본 평면으로 투영한다: 높이(y)는 화면 위쪽(−z)으로 0.55 배 기울여 포털·실린더가 '위'에 보이게.
// three.js 를 불러오지 않는다. Flow 2D·Planet 2D 만 그리고 복셀 2D 는 그리지 않는다.
import { IxModel, IxGeo, ixGeometry, IX_KEYS, ixKeyColor } from '../ix-core.mjs';
import { toScreen, camScale } from './flat-core.mjs';

const TILT = 0.55;
const ABUCKET = 10; // 선 알파를 10단계로 묶어 Path2D 몇 개로

export class FlatIx {
  constructor(view) {
    this.view = view;
    this.model = new IxModel();
    this.geo = new IxGeo();
    this.mode = view.constructor && view.constructor.modeId;
    this.theme = this.mode === 'planet' ? 'planet' : 'flow';
    this.off = this.mode === 'voxel'; // 복셀 2D 는 개편 때
    this._p = {}; this._q = {};
    this._env = {
      theme: this.theme, reduced: !!view.reduced,
      pos: (id) => {
        const v = view.vis.get(id);
        if (!v || v.gone || v.hidden || v.exiting != null || (v.scopeD ?? 1) < 0.5) return null; // 페이드 중엔 그대로(투명도는 fade)
        return v.pos;
      },
      rad: (id) => { const v = view.vis.get(id); return v ? v.r * (v.drawS || 1) * 0.75 : 0.8; },
      root: (id) => this.rootOf(id),
      fade: (id) => { const v = view.vis.get(id); return v && v.projA != null ? v.projA : 1; }, // 프로젝트 페이드
    };
    this._rootOf = (id) => this.rootOf(id);
    this.stats = { lines: 0, quads: 0, labels: 0, fx: 0 };
  }
  rootOf(id) {
    let cur = id;
    for (let i = 0; i < 64; i++) {
      const p = this.view.parentOf.get(cur) ?? this.view.vis.get(cur)?.node?.parentId;
      if (!p || !this.view.vis.has(p)) return cur;
      cur = p;
    }
    return cur;
  }
  event(ev, opts = {}) { if (!this.off) this.model.event(ev, performance.now() / 1000, opts.speed || 1, this._rootOf); }
  clear() { this.model.clear(); }
  /** 그리는 중이면 30fps 갱신(flat-view _update level 2) */
  animating(now) { if (this.off) return false; this.model.step(now); return this.model.animating(now); }

  _xy(x, y, z, out) {
    const v = this.view;
    return toScreen(v.cam, v.W, v.H, x, z - y * TILT, out);
  }

  draw(ctx, now) {
    const m = this.model;
    if (this.off || (!m.fx.size && !m.portal.size && !m.console.size)) { this.stats.fx = 0; return; }
    const isLight = !!(this.view.tokens && this.view.tokens.isLight);
    const g = ixGeometry(m, now, this._env, this.geo);
    const s = camScale(this.view.cam, this.view.H);
    const cols = IX_KEYS.map((k) => ixKeyColor(k, isLight));
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, Math.min(2.2, s * 0.05));
    if (!isLight) ctx.globalCompositeOperation = 'lighter';
    // 선: (색, 알파 단계)별 Path2D
    const paths = new Map();
    const a = this._p, b = this._q;
    for (let i = 0; i < g.nl; i++) {
      const o = i * 6;
      this._xy(g.L[o], g.L[o + 1], g.L[o + 2], a); this._xy(g.L[o + 3], g.L[o + 4], g.L[o + 5], b);
      const k = g.LC[i] * 16 + Math.max(1, Math.round(g.LA[i] * ABUCKET));
      let p = paths.get(k);
      if (!p) { p = new Path2D(); paths.set(k, p); }
      p.moveTo(a.x, a.y); p.lineTo(b.x, b.y);
    }
    for (const [k, p] of paths) { ctx.globalAlpha = (k % 16) / ABUCKET; ctx.strokeStyle = cols[(k / 16) | 0]; ctx.stroke(p); }
    // 점: 작은 원(크기 = 세계 크기 × 축척)
    for (let i = 0; i < g.nq; i++) {
      const o = i * 4;
      this._xy(g.Q[o], g.Q[o + 1], g.Q[o + 2], a);
      const r = Math.max(1.2, g.Q[o + 3] * s * 0.5);
      if (a.x < -r || a.y < -r || a.x > this.view.W + r || a.y > this.view.H + r) continue;
      ctx.globalAlpha = g.QA[i];
      ctx.fillStyle = cols[g.QC[i]];
      ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // 라벨: 작은 알약
    ctx.font = '600 10.5px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const d of g.labels) {
      this._xy(d.x, d.y, d.z, a);
      const c = ixKeyColor(d.key, isLight);
      const w = ctx.measureText(d.text).width + 12;
      ctx.globalAlpha = d.alpha * (d.cls === 'ix-badge' ? 0.9 : 0.75);
      if (d.cls === 'ix-badge' || d.cls === 'ix-ribbon') {
        ctx.fillStyle = isLight ? 'rgba(255,255,255,.9)' : 'rgba(5,5,16,.75)';
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(a.x - w / 2, a.y - 17, w, 16, 8) : ctx.rect(a.x - w / 2, a.y - 17, w, 16); ctx.fill();
        ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.globalAlpha = d.alpha;
      ctx.fillStyle = c;
      ctx.fillText(d.text, a.x, a.y - 3);
    }
    ctx.restore();
    this.stats.lines = g.nl; this.stats.quads = g.nq; this.stats.labels = g.labels.length; this.stats.fx = m.fx.size;
  }
}
