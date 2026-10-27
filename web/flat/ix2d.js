// 특별 상호작용 연출 — 2D 캔버스 그리기. 3D 와 같은 IxModel·ixGeometry(세계 좌표 도형)를
// 위에서 본 평면으로 투영한다: 높이(y)는 화면 위쪽(−z)으로 0.55 배 기울여 포털·실린더가 '위'에 보이게.
// three.js 를 불러오지 않는다. Flow 2D·Planet 2D 만 그리고 복셀 2D 는 그리지 않는다.
import { IxModel, IxGeo, ixGeometry, IX_KEYS, ixKeyColor, ixPortalPts, ixRectHits, IX_UNDER_LABEL } from '../ix-core.mjs';
import { toScreen, camScale } from './flat-core.mjs';
import { userBook, consoleLines, wantsConsole, hitRect } from '../user-core.mjs'; // 사용자 콘솔

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
      consoleRoots: () => { const out = new Set(); for (const v of view.vis.values()) if (wantsConsole(v.node)) out.add(this.rootOf(v.id)); return out; },
      consoleInfo: (root) => consoleLines(userBook.get(root), view.clock ? view.clock() : Date.now()),
    };
    this.conHits = []; // 그린 콘솔 화면 사각형(px) {root, x0,y0,x1,y1}
    this._cons = [];
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
  /** 카메라 git 붙잡기가 함께 담을 포털 점 — 평면 세계(x, z, 높이는 화면 위로 TILT 배 기울인 자리) [{x,y:0,z,r}] | null(복셀 2D 는 vx2d-extra) */
  holdPts(id) {
    if (this.off) return null;
    const root = this.rootOf(id), rp = this._env.pos(root);
    const pts = rp ? ixPortalPts(this.theme, { x: rp.x, y: rp.y || 0, z: rp.z }, Math.max(0.4, this._env.rad(root) || 0.8)) : null;
    return pts ? pts.map((q) => ({ x: q.x, y: 0, z: q.z - q.y * TILT, r: q.r })) : null;
  }
  event(ev, opts = {}) { if (!this.off) this.model.event(ev, performance.now() / 1000, opts.speed || 1, this._rootOf); }
  clear() { this.model.clear(); }
  /** 그리는 중이면 30fps 갱신(flat-view _update level 2) */
  animating(now) { if (this.off) return false; this.model.step(now); return this.model.animating(now); }

  _anyMain() { for (const v of this.view.vis.values()) if (wantsConsole(v.node)) return true; return false; }
  /** 콘솔 화면 사각형(집기) + 이름표 두 줄(화면에서 충분히 클 때만, 큰 것부터 8개) */
  _drawConsoles(ctx, g, isLight) {
    const a = this._p, b = this._q, list = [];
    for (const c of g.cons) {
      this._xy(c.x - c.w, c.y + c.h, c.z, a); this._xy(c.x + c.w, c.y - c.h, c.z, b);
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = Math.max(9, (x1 - x0) / 2), hh = Math.max(6, (y1 - y0) / 2);
      const h = { root: c.root, x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh, px: x1 - x0, top: y0, cx };
      this.conHits.push(h); list.push(h);
    }
    this._cons = g.cons.map((c) => ({ root: c.root, x: c.x, z: c.z - c.y * TILT }));
    const show = new Set(list.filter((h) => h.px >= 22).sort((p, q) => q.px - p.px).slice(0, 8).map((h) => h.root));
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (const d of g.clabels) {
      if (!show.has(d.root)) continue;
      const h = list.find((x) => x.root === d.root);
      const col = ixKeyColor(d.key, isLight);
      ctx.font = '600 10.5px system-ui, "Segoe UI", sans-serif';
      const w1 = d.text ? ctx.measureText(d.text).width : 0;
      ctx.font = '500 9.5px system-ui, "Segoe UI", sans-serif';
      const w2 = ctx.measureText(d.status).width;
      const w = Math.min(220, Math.max(w1, w2) + 14), lh = d.text ? 27 : 15;
      const x = h.cx, y = h.top - 4;
      ctx.globalAlpha = d.alpha * 0.92;
      ctx.fillStyle = isLight ? 'rgba(255,255,255,.9)' : 'rgba(5,5,16,.72)';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - lh, w, lh, 7) : ctx.rect(x - w / 2, y - lh, w, lh); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = d.alpha * 0.55; ctx.stroke();
      ctx.globalAlpha = d.alpha;
      if (d.text) { ctx.font = '600 10.5px system-ui, "Segoe UI", sans-serif'; ctx.fillStyle = col; ctx.fillText(d.text, x, y - 15, 210); }
      ctx.font = '500 9.5px system-ui, "Segoe UI", sans-serif';
      ctx.fillStyle = isLight ? 'rgba(60,50,20,.85)' : 'rgba(255,240,200,.78)';
      ctx.fillText(d.status, x, y - 4, 210);
      h.y0 = Math.min(h.y0, y - lh); h.x0 = Math.min(h.x0, x - w / 2); h.x1 = Math.max(h.x1, x + w / 2); // 이름표도 집기 범위
    }
    ctx.globalAlpha = 1;
  }
  /** 화면 px(캔버스 기준) → 콘솔 뿌리 id | null */
  consoleAt(x, y) { const h = hitRect(this.conHits, x, y, 5); return h ? h.root : null; }
  /** 콘솔 화면 가운데 — 2D 평면 좌표 {x, z}(toScreen 용, 높이는 위로 기울여 넣음) */
  consolePos(root) { const c = this._cons.find((q) => q.root === root); return c ? { x: c.x, z: c.z } : null; }

  _xy(x, y, z, out) {
    const v = this.view;
    return toScreen(v.cam, v.W, v.H, x, z - y * TILT, out);
  }

  draw(ctx, now) {
    const m = this.model;
    this.conHits.length = 0;
    if (this.off || (!m.fx.size && !m.portal.size && !m.console.size && !this._anyMain())) { this.stats.fx = 0; this._cons = []; return; }
    const isLight = !!(this.view.tokens && this.view.tokens.isLight);
    this._env.light = isLight; // 콘솔 진하기
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
    // 콘솔 화면 바탕(선보다 먼저 — 2D 에선 선만으로는 빈 틀처럼 보여 옅은 화면을 깐다)
    if (g.cons.length) {
      ctx.save(); ctx.globalCompositeOperation = 'source-over';
      for (const c of g.cons) {
        this._xy(c.x - c.w, c.y + c.h, c.z, a); this._xy(c.x + c.w, c.y - c.h, c.z, b);
        const fa = this._env.fade(c.root);
        ctx.globalAlpha = 0.85 * fa;
        ctx.fillStyle = isLight ? '#fffaf0' : '#14110a';
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      }
      ctx.restore();
    }
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
    // 효과 글자(점수 배지·진행 눈금)가 노드 라벨 상자에 걸치면 옅게 — 라벨 판독이 먼저
    const labs = g.labels.length && this.view.labelScreenBoxes ? this.view.labelScreenBoxes(this._labs || (this._labs = [])) : null;
    for (const d of g.labels) {
      this._xy(d.x, d.y, d.z, a);
      const c = ixKeyColor(d.key, isLight);
      const w = ctx.measureText(d.text).width + 12;
      if (labs && labs.length && ixRectHits(a.x, a.y - 9, w / 2, 8, labs)) d.alpha *= IX_UNDER_LABEL.LAB;
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
    if (labs) labs.length = 0;
    this._drawConsoles(ctx, g, isLight);
    ctx.restore();
    this.stats.lines = g.nl; this.stats.quads = g.nq; this.stats.labels = g.labels.length; this.stats.fx = m.fx.size;
  }
}
