// 작업 대상 층 — 2D 캔버스 그리기. 3D 와 같은 ArtState·artGeometry(세계 좌표 도형)를
// 위에서 본 평면으로 투영한다: 높이(y)는 화면 위쪽(−z)으로 0.55 배 기울여(ix2d 와 같은 TILT) 블록이 솟아 보이게.
// 바닥층(y = ART.FLOOR_Y < 0)은 섬보다 조금 아래(화면 아래쪽)로 내려 '아래 층'으로 읽힌다. three.js 를 불러오지 않는다. 끄면 이 객체가 없다.
import { ART, ART_KEYS, artKeyColor, artGeometry, artFitPoints, artPickXZ, ArtState } from '../artifact-core.mjs';
import { toScreen, toWorld, camScale } from './flat-core.mjs';
import { projectNameOf, nameFont, dimIslandLabel, undimAll } from '../art-name.js';
import { artNameLines, artNamePlate, artNameReadable } from '../artifact-core.mjs';

const TILT = 0.55;
const AB = 10; // 선 알파 단계

export class FlatArt {
  constructor(view, { book, fx, style = null }) {
    this.view = view;
    this.st = new ArtState({ book, fx, style });
    this._a = {}; this._b = {};
    this._last = performance.now() / 1000;
    this.hits = []; // 지난 그리기의 집기 상자 [{x0,y0,x1,y1,ref}]
    this._moving = false;
    this._env = {
      anchor: (pid) => this.st.anchor(pid),
      nodePos: (id) => {
        const v = view.vis.get(id);
        if (!v || v.gone || v.hidden || v.exiting != null || (v.scopeD ?? 1) < 0.5) return null; // 페이드 중엔 그대로(장면·빔은 프로젝트 투명도 ka 로)
        return { x: v.pos.x, y: 0, z: v.pos.z };
      },
      nowMs: Date.now(), reduced: false, foot: null, hover: null, y: ART.FLOOR_Y,
    };
    this.stats = { boxes: 0, cyls: 0, lines: 0, dots: 0, labels: 0, items: 0, ms: 0 };
  }
  _xy(x, y, z, out) { const v = this.view; return toScreen(v.cam, v.W, v.H, x, z - y * TILT, out); }
  _pids() {
    const v = this.view;
    if (v.scope && v.scope.mode === 'all') return v.clusters().filter((c) => !c.inactive).map((c) => c.projectId).filter((p) => this.st.book.projects.has(p)).sort();
    return [this.st.book.defaultProject];
  }
  _anchorTarget(pid) {
    const v = this.view;
    if (v.scope && v.scope.mode === 'all') { const c = v.clusterTarget(pid); return c ? { x: c.center.x, z: c.center.z, hw: c.box ? c.box.hw : c.r, hd: c.box ? c.box.hd : c.r } : null; }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const n of v.vis.values()) { if (n.gone || n.hidden) continue; const p = n.target; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    // 단일 세션: 노드 경계 + 여백(최소 반폭 18) 안에
    return Number.isFinite(x0) ? { x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: Math.max(18, (x1 - x0) / 2 + 6), hd: Math.max(18, (z1 - z0) / 2 + 6) } : { x: 0, z: 0, hw: 18, hd: 18 };
  }
  /** 갱신 단계(flat-view _update): 연출 중·섬 중심 이동 중이면 2(30fps), 아니면 0(정지 — 바뀔 때만 다시 그림) */
  level(now) {
    const st = this.st;
    const dt = Math.min(0.1, Math.max(0, now - this._last)); this._last = now;
    const v0 = st.book.version;
    const moved = st.frame(this._pids(), (p) => this._anchorTarget(p), now, dt);
    const relaid = this._ver !== v0; this._ver = v0;
    return st.fx.active || moved ? 2 : relaid ? 1 : 0;
  }

  draw(ctx, now) {
    const t0 = performance.now();
    const st = this.st, v = this.view, env = this._env;
    env.nowMs = v.clock ? v.clock() : Date.now();
    env.reduced = !!v.reduced;
    env.style = st.style; env.isLight = !!(v.tokens && v.tokens.isLight);
    env.pidAlpha = v.projAlpha ? (pid) => v.projAlpha(pid) : null;
    env.foot = st.focusFor(v.hoverId || v.focusId || null, (id) => (v.scope && v.scope.mode === 'all' ? (v.vis.get(id) && v.vis.get(id).projectId) || null : st.book.defaultProject));
    env.hover = st.sel;
    const sc = camScale(v.cam, v.H);
    env.cellPx = (pid) => { const a = st.anchor(pid); return ART.CELL * (a ? a.k || 1 : 1) * sc; };
    const av = this._avoid || (this._avoid = []); av.length = 0;
    for (const n of v.vis.values()) { if (n.gone || n.hidden || (n.scopeK ?? 1) < 0.5) continue; av.push({ x: n.pos.x, z: n.pos.z + ART.FLOOR_Y * TILT, r: (n.r || 1) * 1.5 }); }
    env.avoid = av;
    this._names(ctx, now);
    const g = artGeometry(st.book, st.lay, st.fx, now, env, st.geo);
    const isLight = !!(v.tokens && v.tokens.isLight);
    const cols = ART_KEYS.map((k) => artKeyColor(k, isLight));
    const s = camScale(v.cam, v.H);
    const a = this._a, b = this._b;
    this.hits.length = 0;
    ctx.save();
    ctx.globalCompositeOperation = isLight ? 'multiply' : 'lighter'; // 라이트 = 곱하기 잉크(바탕이 무엇이든 그만큼 어둡게), 다크 = 가산
    // 상자: 윗면 + 앞면(높이만큼 아래로) — 큰 판(구역)부터 그려지도록 도형 순서 그대로
    for (let i = 0; i < g.nb; i++) {
      const o = i * 6;
      const x = g.B[o], y = g.B[o + 1], z = g.B[o + 2], sx = g.B[o + 3], sy = g.B[o + 4], sz = g.B[o + 5];
      const yt = y + sy / 2, yb = y - sy / 2;
      this._xy(x - sx / 2, yt, z - sz / 2, a); this._xy(x + sx / 2, yt, z + sz / 2, b);
      const w = b.x - a.x, h = b.y - a.y;
      if (b.x < -20 || a.x > v.W + 20 || b.y < -20 || a.y > v.H + 40) continue;
      const fh = (yt - yb) * TILT * s;
      ctx.globalAlpha = g.BA[i] * (isLight ? 0.85 : 0.75);
      ctx.fillStyle = cols[g.BC[i]];
      ctx.fillRect(a.x, a.y, w, h);
      if (fh > 0.8) { ctx.globalAlpha = g.BA[i] * 0.45; ctx.fillRect(a.x, b.y, w, fh); }
      const ref = g.BI[i];
      if (ref) this.hits.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y + fh, ref });
    }
    // 원기둥(DB): 몸통 + 윗면 원
    for (let i = 0; i < g.ny; i++) {
      const o = i * 5;
      const x = g.Y[o], y = g.Y[o + 1], z = g.Y[o + 2], r = g.Y[o + 3], hh = g.Y[o + 4];
      this._xy(x, y + hh / 2, z, a); this._xy(x, y - hh / 2, z, b);
      const R = Math.max(1.5, r * s);
      ctx.globalAlpha = g.YA[i] * 0.55; ctx.fillStyle = cols[g.YC[i]];
      ctx.fillRect(a.x - R, a.y, R * 2, b.y - a.y);
      ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = g.YA[i] * 0.85; ctx.beginPath(); ctx.arc(a.x, a.y, R, 0, Math.PI * 2); ctx.fill();
      const ref = g.YI[i];
      if (ref) this.hits.push({ x0: a.x - R, y0: a.y - R, x1: a.x + R, y1: b.y + R, ref });
    }
    // 선: (색, 굵기, 알파 단계)별 Path2D
    const paths = new Map();
    for (let i = 0; i < g.nl; i++) {
      const o = i * 6;
      this._xy(g.L[o], g.L[o + 1], g.L[o + 2], a); this._xy(g.L[o + 3], g.L[o + 4], g.L[o + 5], b);
      if ((a.x < 0 && b.x < 0) || (a.y < 0 && b.y < 0) || (a.x > v.W && b.x > v.W) || (a.y > v.H && b.y > v.H)) continue;
      const k = (g.LC[i] * 4 + g.LW[i]) * 16 + Math.max(1, Math.round(g.LA[i] * AB));
      let p = paths.get(k);
      if (!p) { p = new Path2D(); paths.set(k, p); }
      p.moveTo(a.x, a.y); p.lineTo(b.x, b.y);
    }
    ctx.lineCap = 'round';
    const lw = 1; // 모서리 선 1px
    for (const [k, p] of paths) {
      const ab = k % 16, rest = (k / 16) | 0, w = rest % 4, ci = (rest / 4) | 0;
      ctx.globalAlpha = ab / AB; ctx.strokeStyle = cols[ci]; ctx.lineWidth = lw * (w === 3 ? 2.6 : w === 2 ? 1.8 : 1);
      ctx.stroke(p);
    }
    // 점
    for (let i = 0; i < g.nd; i++) {
      const o = i * 4;
      this._xy(g.D[o], g.D[o + 1], g.D[o + 2], a);
      const r = Math.max(1.2, g.D[o + 3] * s * 0.5);
      if (a.x < -r || a.y < -r || a.x > v.W + r || a.y > v.H + r) continue;
      ctx.globalAlpha = g.DA[i]; ctx.fillStyle = cols[g.DC[i]];
      ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // 라벨(알약)
    ctx.font = '600 10px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const d of g.labels) {
      this._xy(d.x, d.y, d.z, a);
      if (a.x < -60 || a.x > v.W + 60 || a.y < 0 || a.y > v.H + 20) continue;
      const tw = ctx.measureText(d.text).width;
      const pill = d.cls !== 'art-zone';
      ctx.globalAlpha = Math.min(1, d.alpha);
      if (pill) {
        ctx.fillStyle = d.cls === 'art-alarm' ? (isLight ? 'rgba(254,226,226,.95)' : 'rgba(60,6,6,.8)') : isLight ? 'rgba(255,255,255,.9)' : 'rgba(5,5,16,.75)';
        ctx.fillRect(a.x - tw / 2 - 5, a.y - 14, tw + 10, 14);
      }
      ctx.fillStyle = d.cls === 'art-alarm' ? (isLight ? '#991b1b' : '#fecaca') : artKeyColor(d.key, isLight);
      ctx.fillText(d.text, a.x, a.y - 2);
    }
    ctx.restore();
    let items = 0; for (const L of st.lay.values()) items += L.pos.size;
    Object.assign(this.stats, { boxes: g.nb, cyls: g.ny, lines: g.nl, dots: g.nd, labels: g.labels.length, items, ms: +(performance.now() - t0).toFixed(2) });
  }

  /** 바닥 글씨(2D): 섬 바닥에 큰 옅은 글자(윤곽 + 아주 옅은 채움, 대상보다 먼저 그림) */
  _names(ctx, now) {
    const v = this.view, s = camScale(v.cam, v.H);
    const isLight = !!(v.tokens && v.tokens.isLight);
    const root = v.labelContainer || document;
    const dimNow = !this._dimAt || now - this._dimAt > 0.25;
    if (dimNow) this._dimAt = now;
    const seen = this._named || (this._named = new Set());
    const keep = new Set();
    const a = this._a;
    for (const pid of this._pids()) {
      const t = this._anchorTarget(pid);
      const lines = t ? artNameLines(projectNameOf(v, pid)) : [];
      if (!lines.length) continue;
      keep.add(pid);
      ctx.save();
      ctx.font = nameFont(100);
      const wpx = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 40;
      const aspect = (110 * lines.length + 30) / wpx;
      const pl = artNamePlate(t, aspect);
      if (!pl) { ctx.restore(); continue; }
      const fpx = (100 * (pl.w * s)) / wpx;
      this._xy(t.x, ART.FLOOR_Y + ART.NAME_Y, t.z, a);
      ctx.font = nameFont(fpx);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const col = isLight ? '71,85,105' : '124,136,156';
      lines.forEach((l, i) => {
        const y = a.y + (i - (lines.length - 1) / 2) * fpx * 1.1;
        ctx.fillStyle = `rgba(${col},${isLight ? 0.08 : 0.09})`; ctx.fillText(l, a.x, y);
        ctx.strokeStyle = `rgba(${col},${isLight ? 0.32 : 0.38})`; ctx.lineWidth = Math.max(1, fpx * 0.03); ctx.strokeText(l, a.x, y);
      });
      ctx.restore();
      if (dimNow && v.scope && v.scope.mode === 'all') dimIslandLabel(root, pid, artNameReadable(fpx * 1.1));
    }
    for (const pid of seen) if (!keep.has(pid)) dimIslandLabel(root, pid, false);
    this._named = keep;
  }
  dispose() { undimAll(this.view.labelContainer || document); }

  /** 화면 px(캔버스 기준) → {pid, id}: 지난 그리기의 상자 중 점이 든 가장 작은 것 */
  pick(px, py) {
    // 선 위주라 채움이 없을 수 있다 → 화면 점 → 바닥 높이 세계 좌표 → 가장 가까운 대상
    const v = this.view, w = toWorld(v.cam, v.W, v.H, px, py, {});
    return artPickXZ(this.st.lay, (pid) => this.st.anchor(pid), w.x, w.z + ART.FLOOR_Y * TILT);
  }
  fitPoints(pts, scope = {}) {
    const fp = scope && scope.mode === 'all' ? scope.focusProject || null : null;
    // 2D 는 높이를 화면 위로 기울이므로 맞춤 점의 z 를 같은 만큼 옮긴다(바닥층이 섬 아래로 내려 보임)
    const tmp = artFitPoints(this.st.lay, (pid) => this.st.anchor(pid), [], { pid: fp });
    for (const q of tmp) pts.push({ p: { x: q.p.x, y: 0, z: q.p.z - ART.FLOOR_Y * TILT }, r: q.r });
    return pts;
  }
  /** 대상 화면 자리용 세계 {x, z}(기울임 반영) */
  posOf(pid, id) { const w = this.st.worldOf(pid, id); return w ? { x: w.x, y: 0, z: w.z - w.y * TILT } : null; }
}
