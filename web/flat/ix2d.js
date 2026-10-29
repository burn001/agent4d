// 특별 상호작용 연출 — 2D 캔버스 그리기. 3D 와 같은 IxModel·ixGeometry(세계 좌표 도형)를
// 위에서 본 평면으로 투영한다: 높이(y)는 화면 위쪽(−z)으로 0.55 배 기울여 포털·실린더가 '위'에 보이게.
// three.js 를 불러오지 않는다. Flow 2D·Planet 2D 만 그리고 복셀 2D 는 그리지 않는다.
import { IxModel, IxGeo, ixGeometry, IX_KEYS, ixKeyColor, ixPortalPts, ixRectHits, IX_UNDER_LABEL } from '../ix-core.mjs';
import { toScreen, camScale } from './flat-core.mjs';
import { userBook, consoleLines, wantsConsole, hitRect } from '../user-core.mjs'; // 사용자 콘솔
import { DESK, sendPhase } from '../flowview/shape-core.mjs'; // 홀로그램 콘솔 데스크(2D 판)
import { t as tr } from '../i18n.mjs';

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
    if (this.mode === 'flow') this._env.solid = true; // 흐름 2D 도 데스크(글줄 선 대신 화면 글 — 아래 _drawDesks)
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
    const desk = this.mode === 'flow';
    const show = new Set(list.filter((h) => (desk ? h.px >= DESK.BADGE_PX && h.px < DESK.TEXT_PX : h.px >= 22)).sort((p, q) => q.px - p.px).slice(0, 8).map((h) => h.root));
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (const d0 of g.clabels) {
      if (!show.has(d0.root)) continue;
      const d = desk ? { ...d0, text: '', status: tr('cards.user.me') } : d0; // 흐름: 글이 화면에 있으므로 작을 때만 '나' 배지
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
  /** 흐름 2D 홀로그램 콘솔 데스크: 반달 책상 + 사다리꼴 빛(투사기 → 화면) + 글 상자(마지막 입력 · 상태). 3D 와 같은 문구·같은 문턱 */
  _drawDesks(ctx, g, isLight, now) {
    const a = this._p, b = this._q, reduced = !!this.view.reduced;
    const gold = isLight ? '#a16207' : '#fcd34d';
    const stc = { idle: isLight ? '#5b6680' : '#7b88a8', working: isLight ? '#1f7fc4' : '#66ccff', answered: isLight ? '#0f9e6a' : '#66ffaa', asking: gold, alert: isLight ? '#d4313f' : '#ff5566' };
    ctx.save(); ctx.globalCompositeOperation = 'source-over';
    for (const c of g.cons) {
      this._xy(c.x - c.w, c.y + c.h, c.z, a); this._xy(c.x + c.w, c.y - c.h, c.z, b);
      const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      if (w < 4) continue;
      const fa = this._env.fade(c.root), cx = x0 + w / 2, info = this._env.consoleInfo(c.root), st = (info && info.state) || 'idle', col = stc[st] || stc.idle;
      const e = userBook.get(c.root), ph = e && e.promptAt != null ? sendPhase(((this.view.clock ? this.view.clock() : Date.now()) - e.promptAt) / 1000) : -1;
      // 반달 책상(화면 아래, 사용자 쪽으로 휜 띠) — 안쪽 금빛 호 · 바깥 상태색 호
      const dy = y0 + h + h * 0.75, R1 = w * 0.62, R0 = w * 0.36, A = 0.95;
      ctx.globalAlpha = 0.9 * fa;
      ctx.beginPath(); ctx.ellipse(cx, dy - R1 * 0.35, R1, R1 * 0.42, 0, Math.PI / 2 - A, Math.PI / 2 + A); ctx.ellipse(cx, dy - R1 * 0.35, R0, R0 * 0.42, 0, Math.PI / 2 + A, Math.PI / 2 - A, true); ctx.closePath();
      ctx.fillStyle = isLight ? '#d3dae5' : '#1d2740'; ctx.fill();
      ctx.lineWidth = Math.max(1, w * 0.02);
      ctx.globalAlpha = 0.8 * fa; ctx.strokeStyle = col; ctx.beginPath(); ctx.ellipse(cx, dy - R1 * 0.35, R1, R1 * 0.42, 0, Math.PI / 2 - A, Math.PI / 2 + A); ctx.stroke();
      ctx.strokeStyle = gold; ctx.beginPath(); ctx.ellipse(cx, dy - R1 * 0.35, R0, R0 * 0.42, 0, Math.PI / 2 - A, Math.PI / 2 + A); ctx.stroke();
      // 자판(보낼 때 번쩍)
      const kf = ph >= 0 && ph < 0.35 && !reduced && Math.sin(now * 40) > 0;
      ctx.globalAlpha = (kf ? 0.75 : 0.28) * fa; ctx.fillStyle = gold; ctx.fillRect(cx - w * 0.2, dy - R1 * 0.35 + R0 * 0.42 + h * 0.06, w * 0.4, Math.max(2, h * 0.12));
      // 사다리꼴 빛: 투사기(책상 뒤 가운데, 좁음) → 화면 아랫변(넓음)
      const ey = dy - R1 * 0.35 + R0 * 0.42, fanK = (st === 'idle' ? 0.08 : st === 'asking' ? 0.3 : 0.2) + (ph > 0.2 && ph < 0.6 ? 0.2 : 0);
      const gr = ctx.createLinearGradient(0, ey, 0, y0 + h);
      gr.addColorStop(0, st === 'asking' || ph >= 0 ? gold : col); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = fanK * fa * (isLight ? 0.8 : 1); ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(cx - w * 0.17, ey); ctx.lineTo(cx + w * 0.17, ey); ctx.lineTo(x0 + w, y0 + h); ctx.lineTo(x0, y0 + h); ctx.closePath(); ctx.fill();
      // 글 상자(떠 있는 화면)
      ctx.globalAlpha = 0.85 * fa; ctx.fillStyle = isLight ? 'rgba(255,250,240,.9)' : 'rgba(10,16,38,.82)'; ctx.fillRect(x0, y0, w, h);
      ctx.globalAlpha = (st === 'asking' && !reduced ? 0.6 + 0.4 * Math.sin(now * 5) : 0.8) * fa; ctx.strokeStyle = gold; ctx.lineWidth = Math.max(1, w * 0.012);
      const k = w * 0.08;
      for (const [px, py, sx, sy] of [[x0, y0, 1, 1], [x0 + w, y0, -1, 1], [x0 + w, y0 + h, -1, -1], [x0, y0 + h, 1, -1]]) { ctx.beginPath(); ctx.moveTo(px + sx * k, py); ctx.lineTo(px, py); ctx.lineTo(px, py + sy * k); ctx.stroke(); }
      if (w >= DESK.TEXT_PX) {
        const u = Math.min(h / 6.2, w / 11), pad = u * 0.7, mw = w - pad * 2;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.globalAlpha = 0.85 * fa; ctx.fillStyle = gold; ctx.font = `600 ${u * 0.62}px ui-monospace, Consolas, monospace`;
        ctx.fillText(tr('cards.user.title'), x0 + pad, y0 + pad + u * 0.3, mw);
        ctx.globalAlpha = fa; ctx.fillStyle = st === 'idle' ? stc.idle : (isLight ? '#7a4a00' : '#fde68a'); ctx.font = `700 ${u * 0.9}px system-ui, "Segoe UI", sans-serif`;
        ctx.fillText((info && info.text) || '—', x0 + pad, y0 + pad + u * 1.6, mw);
        ctx.fillStyle = col; ctx.font = `500 ${u * 0.74}px system-ui, "Segoe UI", sans-serif`;
        ctx.fillText((info && info.status) || '', x0 + pad, y0 + pad + u * 2.9, mw);
        if (st === 'working') { const p = reduced ? 0.5 : (now * 0.5) % 1; ctx.globalAlpha = 0.3 * fa; ctx.fillRect(x0 + pad, y0 + h - pad - 2, mw, 3); ctx.globalAlpha = fa; ctx.beginPath(); ctx.arc(x0 + pad + mw * p, y0 + h - pad - 0.5, Math.max(1.5, u * 0.18), 0, Math.PI * 2); ctx.fill(); }
      }
      // 질문 카드 '?'(화면 오른쪽 위 바깥)
      if (c.asking) { const r = Math.max(5, h * 0.22); ctx.globalAlpha = fa; ctx.fillStyle = isLight ? 'rgba(255,248,225,.95)' : 'rgba(40,30,0,.8)'; ctx.beginPath(); ctx.arc(x0 + w + r * 1.3, y0 + r * 0.6, r, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = gold; ctx.lineWidth = Math.max(1, r * 0.12); ctx.stroke(); ctx.fillStyle = gold; ctx.font = `700 ${r * 1.3}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('?', x0 + w + r * 1.3, y0 + r * 0.7); }
    }
    ctx.restore();
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
    if (g.cons.length && this.mode === 'flow') this._drawDesks(ctx, g, isLight, now);
    else if (g.cons.length) {
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
