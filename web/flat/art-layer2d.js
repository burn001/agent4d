// 작업 대상 층 — Planet·복셀 2D 그리기. 흐름 2D(flat/art2d.js)와 같은 방식: 3D 와 같은 도형(ArtGeo, 세계 좌표)을
// 위에서 본 평면으로 투영하고 높이(y)는 화면 위쪽(−z)으로 기울인다(Planet 0.55 = 흐름과 같음, 복셀 0.3 = 평면도에 가깝게).
// 같은 실루엣의 평면 기호: 상자 = 윗면 + 앞면, 선·점·라벨 그대로. three.js 를 불러오지 않는다. 끄면 이 객체가 없다.
import { ART, ART_KEYS, artKeyColor, artFitPoints, ArtState, artNameLines, artNamePlate, artNameReadable } from '../artifact-core.mjs';
import { planetArtGeometry, pickHits } from '../art-meta.mjs';
import { VxArtPlan, voxelArtGeometry, vxFitPoints, vxRoomsFor } from '../voxel/vx-art-core.mjs';
import { projectNameOf, nameFont, dimIslandLabel, undimAll } from '../art-name.js';
import { arcNamePlate } from '../art-arc.mjs'; // 원형 섬 가장자리 원호 글씨
import { toScreen, camScale } from './flat-core.mjs';

const AB = 10;

class ArtLayerBase2D {
  constructor(view, { book, fx, style = null }, { tilt = 0.55, solid = false } = {}) {
    this.view = view; this.tilt = tilt; this.solid = solid;
    this.st = new ArtState({ book, fx, style });
    this._a = {}; this._b = {};
    this._last = performance.now() / 1000;
    this.hits = [];
    this._env = { nowMs: Date.now(), reduced: false, foot: null, hover: null, hits: this.hits, nodePos: (id) => this._nodePos(id) };
    this.stats = { boxes: 0, cyls: 0, lines: 0, dots: 0, labels: 0, items: 0, ms: 0 };
  }
  _xy(x, y, z, out) { const v = this.view; return toScreen(v.cam, v.W, v.H, x, z - y * this.tilt, out); }
  _focus() { return this.st.focusFor(this.view.hoverId || this.view.focusId || null, (id) => this._pidOfNode(id)); }
  _pidOfNode(id) { const v = this.view; return v.scope && v.scope.mode === 'all' ? (v.vis.get(id) && v.vis.get(id).projectId) || null : this.st.book.defaultProject; }
  _nodePos(id) {
    const v = this.view.vis.get(id);
    if (!v || v.gone || v.hidden || v.exiting != null || (v.scopeD ?? 1) < 0.5) return null; // 페이드 중엔 그대로(장면·빔은 프로젝트 투명도 ka 로)
    const o = v._artP || (v._artP = { x: 0, y: 0, z: 0 });
    o.x = v.pos.x; o.y = this.nodeY || 0; o.z = v.pos.z;
    return o;
  }
  /** 갱신 단계(FlatView _update): 연출 중·이동 중이면 2(30fps), 장부가 바뀌었으면 1, 아니면 0 */
  level(now) {
    const dt = Math.min(0.1, Math.max(0, now - this._last)); this._last = now;
    const v0 = this.st.book.version;
    const moved = this._step(now, dt);
    const relaid = this._ver !== v0; this._ver = v0;
    return this.st.fx.active || moved ? 2 : relaid ? 1 : 0;
  }
  draw(ctx, now) {
    const t0 = performance.now();
    const st = this.st, v = this.view, env = this._env;
    env.nowMs = v.clock ? v.clock() : Date.now();
    env.reduced = !!v.reduced;
    env.style = st.style; env.isLight = !!(v.tokens && v.tokens.isLight);
    env.pidAlpha = v.projAlpha ? (pid) => v.projAlpha(pid) : null;
    env.foot = this._focus();
    env.hover = st.sel;
    const s = camScale(v.cam, v.H);
    this._env2d(env, s);
    this._names(ctx, now, s);
    const g = this._geometry(now, env);
    const isLight = env.isLight;
    const cols = this._cols && this._colsL === isLight ? this._cols : (this._colsL = isLight, this._cols = ART_KEYS.map((k) => artKeyColor(k, isLight)));
    const a = this._a, b = this._b, T = this.tilt;
    ctx.save();
    // 상자: 윗면 + 앞면(높이만큼). 복셀(solid)은 가구처럼 불투명한 어두운 면, 그 밖은 흐름과 같은 옅은 채움
    const base = this.solid ? (isLight ? '#7d8899' : '#232a35') : null;
    for (let i = 0; i < g.nb; i++) {
      const o = i * 6;
      const x = g.B[o], y = g.B[o + 1], z = g.B[o + 2], sx = g.B[o + 3], sy = g.B[o + 4], sz = g.B[o + 5];
      const yt = y + sy / 2, yb = y - sy / 2;
      this._xy(x - sx / 2, yt, z - sz / 2, a); this._xy(x + sx / 2, yt, z + sz / 2, b);
      const w = b.x - a.x, h = b.y - a.y;
      if (b.x < -20 || a.x > v.W + 20 || b.y < -20 || a.y > v.H + 40) continue;
      const fh = (yt - yb) * T * s;
      if (this.solid) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1; ctx.fillStyle = base; ctx.fillRect(a.x, a.y, w, h + fh);
        ctx.globalAlpha = Math.min(0.6, g.BA[i] * 0.5); ctx.fillStyle = cols[g.BC[i]]; ctx.fillRect(a.x, a.y, w, h);
      } else {
        ctx.globalCompositeOperation = isLight ? 'multiply' : 'lighter';
        ctx.globalAlpha = g.BA[i] * (isLight ? 0.85 : 0.75); ctx.fillStyle = cols[g.BC[i]];
        ctx.fillRect(a.x, a.y, w, h);
        if (fh > 0.8) { ctx.globalAlpha = g.BA[i] * 0.45; ctx.fillRect(a.x, b.y, w, fh); }
      }
    }
    ctx.globalCompositeOperation = isLight ? 'multiply' : 'lighter';
    for (let i = 0; i < g.ny; i++) {
      const o = i * 5;
      const x = g.Y[o], y = g.Y[o + 1], z = g.Y[o + 2], r = g.Y[o + 3], hh = g.Y[o + 4];
      this._xy(x, y + hh / 2, z, a);
      const R = Math.max(1.5, r * s);
      ctx.globalAlpha = g.YA[i] * 0.6; ctx.fillStyle = cols[g.YC[i]];
      ctx.beginPath(); ctx.ellipse(a.x, a.y, R, R * (1 - T * 0.6), 0, 0, Math.PI * 2); ctx.fill();
    }
    const paths = this._paths || (this._paths = new Map());
    for (const p of paths.values()) p.n = 0;
    let nl = 0;
    for (let i = 0; i < g.nl; i++) {
      const o = i * 6;
      this._xy(g.L[o], g.L[o + 1], g.L[o + 2], a); this._xy(g.L[o + 3], g.L[o + 4], g.L[o + 5], b);
      if ((a.x < 0 && b.x < 0) || (a.y < 0 && b.y < 0) || (a.x > v.W && b.x > v.W) || (a.y > v.H && b.y > v.H)) continue;
      const k = (g.LC[i] * 4 + g.LW[i]) * 16 + Math.max(1, Math.round(g.LA[i] * AB));
      let p = paths.get(k);
      if (!p || p.n === 0) { p = { path: new Path2D(), n: 0 }; paths.set(k, p); }
      p.path.moveTo(a.x, a.y); p.path.lineTo(b.x, b.y); p.n++; nl++;
    }
    ctx.lineCap = 'round';
    for (const [k, p] of paths) {
      if (!p.n) continue;
      const ab = k % 16, rest = (k / 16) | 0, w = rest % 4, ci = (rest / 4) | 0;
      ctx.globalAlpha = ab / AB; ctx.strokeStyle = cols[ci]; ctx.lineWidth = w === 3 ? 2.6 : w === 2 ? 1.8 : 1;
      ctx.stroke(p.path);
    }
    for (let i = 0; i < g.nd; i++) {
      const o = i * 4;
      this._xy(g.D[o], g.D[o + 1], g.D[o + 2], a);
      const r = Math.max(1.2, g.D[o + 3] * s * 0.5);
      if (a.x < -r || a.y < -r || a.x > v.W + r || a.y > v.H + r) continue;
      ctx.globalAlpha = g.DA[i]; ctx.fillStyle = cols[g.DC[i]];
      ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '600 10px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const d of g.labels) {
      this._xy(d.x, d.y, d.z, a);
      if (a.x < -60 || a.x > v.W + 60 || a.y < 0 || a.y > v.H + 20) continue;
      const tw = ctx.measureText(d.text).width;
      ctx.globalAlpha = Math.min(1, d.alpha);
      if (d.cls !== 'art-zone') {
        ctx.fillStyle = d.cls === 'art-alarm' ? (isLight ? 'rgba(254,226,226,.95)' : 'rgba(60,6,6,.8)') : isLight ? 'rgba(255,255,255,.9)' : 'rgba(5,5,16,.75)';
        ctx.fillRect(a.x - tw / 2 - 5, a.y - 14, tw + 10, 14);
      }
      ctx.fillStyle = d.cls === 'art-alarm' ? (isLight ? '#991b1b' : '#fecaca') : artKeyColor(d.key, isLight);
      ctx.fillText(d.text, a.x, a.y - 2);
    }
    ctx.restore();
    Object.assign(this.stats, { boxes: g.nb, cyls: g.ny, lines: nl, dots: g.nd, labels: g.labels.length, items: this.hits.length, ms: +(performance.now() - t0).toFixed(2) });
  }
  /** 바닥 글씨(2D): 그 프로젝트 바닥(섬·사무실)에 큰 옅은 글자 — 대상보다 먼저 */
  _names(ctx, now, s) {
    const v = this.view, isLight = !!(v.tokens && v.tokens.isLight), root = v.labelContainer || document;
    const dimNow = !this._dimAt || now - this._dimAt > 0.25;
    if (dimNow) this._dimAt = now;
    const keep = new Set(), a = this._a;
    for (const pid of this._namePids()) {
      const t = this._nameTarget(pid);
      const lines = t ? artNameLines(projectNameOf(v, pid)) : [];
      if (!lines.length) continue;
      keep.add(pid);
      if (t.round > 0) { this._arcName(ctx, t, lines, s, isLight, pid, root, dimNow); continue; }
      ctx.save();
      ctx.font = nameFont(100);
      const wpx = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 40;
      const pl = artNamePlate(t, (110 * lines.length + 30) / wpx);
      if (!pl) { ctx.restore(); continue; }
      const fpx = (100 * (pl.w * s)) / wpx;
      this._xy(t.x, t.y || 0, t.z, a);
      ctx.font = nameFont(fpx);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const col = isLight ? '71,85,105' : '124,136,156';
      lines.forEach((l, i) => {
        const y = a.y + (i - (lines.length - 1) / 2) * fpx * 1.1;
        ctx.fillStyle = `rgba(${col},${isLight ? 0.07 : 0.08})`; ctx.fillText(l, a.x, y);
        ctx.strokeStyle = `rgba(${col},${isLight ? 0.32 : 0.3})`; ctx.lineWidth = Math.max(1, fpx * 0.03); ctx.strokeText(l, a.x, y);
      });
      ctx.restore();
      if (dimNow && v.scope && v.scope.mode === 'all') dimIslandLabel(root, pid, artNameReadable(fpx * 1.1));
    }
    for (const pid of this._named || []) if (!keep.has(pid)) dimIslandLabel(root, pid, false);
    this._named = keep;
  }
  /** 원형 궤도계 섬: 먼 쪽(화면 위) 가장자리 안쪽 원호를 따라 글자마다 돌려 그림(여러 줄은 바깥 → 안쪽) */
  _arcName(ctx, t, lines, s, isLight, pid, root, dimNow) {
    const a = this._a;
    ctx.save();
    ctx.font = nameFont(100);
    const wpx = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 40;
    const pl = arcNamePlate(t.round, (110 * lines.length + 30) / wpx, lines.length);
    if (!pl) { ctx.restore(); return; }
    this._xy(t.x, t.y || 0, t.z, a);
    const lh = (pl.H / lines.length) * s, fpx = lh / 1.1;
    if (fpx < 3) { ctx.restore(); return; }
    ctx.font = nameFont(fpx);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const col = isLight ? '71,85,105' : '124,136,156';
    lines.forEach((l, i) => {
      const r = (pl.rc + pl.H / 2) * s - lh * (i + 0.5);
      const ws = [...l].map((ch) => ctx.measureText(ch).width), tot = ws.reduce((x, y) => x + y, 0);
      let psi = -Math.PI / 2 - tot / r / 2;
      [...l].forEach((ch, k) => {
        const half = ws[k] / r / 2; psi += half;
        ctx.save(); ctx.translate(a.x + Math.cos(psi) * r, a.y + Math.sin(psi) * r); ctx.rotate(psi + Math.PI / 2);
        ctx.fillStyle = `rgba(${col},${isLight ? 0.07 : 0.08})`; ctx.fillText(ch, 0, 0);
        ctx.strokeStyle = `rgba(${col},${isLight ? 0.32 : 0.3})`; ctx.lineWidth = Math.max(1, fpx * 0.03); ctx.strokeText(ch, 0, 0);
        ctx.restore();
        psi += half;
      });
    });
    ctx.restore();
    if (dimNow && this.view.scope && this.view.scope.mode === 'all') dimIslandLabel(root, pid, artNameReadable(fpx * 1.1));
  }
  /** 화면 px(캔버스 기준) → {pid, id}: 지난 그리기의 집기 기준점 중 가장 가까운 것 */
  pick(px, py) {
    const v = this.view, s = camScale(v.cam, v.H), a = {};
    return pickHits(this.hits, px, py, (x, y, z, r) => { this._xy(x, y, z, a); return { x: a.x, y: a.y, r: r * s }; });
  }
  posOf(pid, id) { for (const h of this.hits) if (h.pid === pid && h.id === id) return { x: h.x, y: 0, z: h.z - h.y * this.tilt }; return null; }
  dispose() { undimAll(this.view.labelContainer || document); }
}

// ───────────── Planet 2D ─────────────
export class PlanetArt2D extends ArtLayerBase2D {
  constructor(view, opts) {
    super(view, opts, { tilt: 0.55 });
    this._env.anchor = (pid) => this.st.anchor(pid);
    this._env.yOf = () => ART.FLOOR_Y;
    this._avoid = [];
  }
  _pids() {
    const v = this.view;
    if (v.scope && v.scope.mode === 'all') return v.clusters().filter((c) => !c.inactive).map((c) => c.projectId).filter((p) => this.st.book.projects.has(p)).sort();
    return [this.st.book.defaultProject];
  }
  _target(pid) {
    const v = this.view;
    if (v.scope && v.scope.mode === 'all') { const c = v.clusterTarget(pid); return c ? { x: c.center.x, z: c.center.z, hw: c.box ? c.box.hw : c.r, hd: c.box ? c.box.hd : c.r, round: c.round || 0 } : null; } // round: 바닥 글씨 = 가장자리 원호
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const n of v.vis.values()) { if (n.gone || n.hidden) continue; const p = n.target; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    return Number.isFinite(x0) ? { x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: Math.max(18, (x1 - x0) / 2 + 6), hd: Math.max(18, (z1 - z0) / 2 + 6) } : { x: 0, z: 0, hw: 18, hd: 18 };
  }
  _step(now, dt) { return this.st.frame(this._pids(), (p) => this._target(p), now, dt); }
  _env2d(env, s) {
    const st = this.st;
    env.cellPx = (pid) => { const a = st.anchor(pid); return ART.CELL * (a ? a.k || 1 : 1) * s; };
    const av = this._avoid; av.length = 0;
    for (const n of this.view.vis.values()) { if (n.gone || n.hidden || (n.scopeK ?? 1) < 0.5) continue; av.push({ x: n.pos.x, z: n.pos.z + ART.FLOOR_Y * this.tilt, r: (n.r || 1) * 1.5 }); }
    env.avoid = av;
  }
  _namePids() { return this._pids(); }
  _nameTarget(pid) { const t = this._target(pid); return t ? { ...t, y: ART.FLOOR_Y + ART.NAME_Y } : null; }
  _geometry(now, env) { return planetArtGeometry(this.st.book, this.st.lay, this.st.fx, now, env, this.st.geo); }
  fitPoints(pts, scope = {}) {
    const fp = scope && scope.mode === 'all' ? scope.focusProject || null : null;
    for (const q of artFitPoints(this.st.lay, (pid) => this.st.anchor(pid), [], { pid: fp })) pts.push({ p: { x: q.p.x, y: 0, z: q.p.z - ART.FLOOR_Y * this.tilt }, r: q.r });
    return pts;
  }
}

// ───────────── 복셀 2D ─────────────
export class VoxelArt2D extends ArtLayerBase2D {
  constructor(view, opts) {
    super(view, opts, { tilt: 0.3, solid: true });
    this.nodeY = 1.15;
    this.plan = new VxArtPlan();
    this.plans = new Map();
    this._pk = '';
  }
  _pidOfNode(id) { const v = this.view; return v.scope && v.scope.mode === 'all' ? (v.vis.get(id) && v.vis.get(id).projectId) || null : this.st.book.defaultProject; }
  _step(now) {
    const st = this.st, v = this.view;
    st.fx.step(now);
    const rooms = vxRoomsFor(v, st.book);
    const key = st.book.version + '|' + (v._layoutVer || 0) + '|' + [...rooms].map(([p, r]) => `${p}@${r.id}:${r.origin.x},${r.origin.z},${r.size.d},${r.xf ? r.xf.k : 0}`).join(';');
    if (key === this._pk) return false;
    this._pk = key;
    this.plans.clear(); st.lay.clear();
    for (const [pid, room] of rooms) { const P = this.plan.sync(pid, st.book.shownItems(pid), room); this.plans.set(pid, P); st.lay.set(pid, P); }
    if (st.foot) st.foot.set = st.book.touchedBy(st.foot.pid, st.foot.node);
    return false;
  }
  _env2d(env, s) { env.unitPx = () => s; }
  _namePids() { return [...this.plans.keys()]; }
  _nameTarget(pid) { const P = this.plans.get(pid); if (!P) return null; const b = P.room.bounds; return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, hw: (b.maxX - b.minX) / 2, hd: (b.maxZ - b.minZ) / 2, y: 0 }; }
  _geometry(now, env) { return voxelArtGeometry(this.st.book, this.plans, this.st.fx, now, env, this.st.geo); }
  fitPoints(pts, scope = {}) {
    const fp = scope && scope.mode === 'all' ? scope.focusProject || null : null;
    for (const [pid, P] of this.plans) if (!fp || pid === fp) for (const q of vxFitPoints(P, [])) pts.push({ p: { x: q.p.x, y: 0, z: q.p.z - q.p.y * this.tilt }, r: q.r });
    return pts;
  }
}
