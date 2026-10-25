// 작업 대상 층 — Planet·복셀 3D 그리기. 흐름 3D(flowview/artifacts.js)와 같은 그리기 구성:
// 상자·원기둥 InstancedMesh 2 + 선 LineSegments 1 + 점 InstancedMesh 1 + CSS2D 라벨 풀 14 (그리기 호출 4) — 끄면 이 객체가 없다(비용 0).
// 도형은 표현별 순수 함수(art-meta.mjs planetArtGeometry · voxel/vx-art-core.mjs voxelArtGeometry)가 ArtGeo 버퍼로 만든다.
// 집기는 화면 투영 거리(떠 있는 위성·게이트·벽 가구도 집힘).
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ART, ARTGEO, ART_KEYS, artKeyColor, artFitPoints, ArtState, ensureArtCss } from './artifact-core.mjs';
import { planetArtGeometry, pickHits, planetFloorY, PLANET_ART } from './art-meta.mjs';
import { VxArtPlan, voxelArtGeometry, vxFitPoints, vxRoomsFor } from './voxel/vx-art-core.mjs';

const EDGE_OFF = 0.09;

/**
 * 테마별 혼합. 다크 = 가산(그대로 — 어두운 바탕에서 빛나는 옅은 선). 라이트 = **곱하기 혼합 잉크**: 색을 흰색 → 잉크 색으로
 * 알파만큼 섞어 바탕에 곱한다(흰 바탕 위 반투명 잉크와 같음). 섬 원판·격자·가구 등 바탕이 무엇이든 그만큼 어두워져 사라지지 않는다.
 * 곱하기는 미리 곱한 알파가 필요하고(three), 그때 불투명도가 1 이 아니면 덮는 자리 전체가 어두워지므로 라이트에선 1, 안개는 끔
 * (안개 색 쪽으로 바랜 잉크가 바탕을 회색으로 덮지 않게 — 먼 대상은 LOD 가 줄임).
 */
export function artBlend(mats, isLight) {
  for (const m of mats) {
    if (!m) continue;
    if (m.userData.op0 == null) m.userData.op0 = m.opacity;
    m.blending = isLight ? THREE.MultiplyBlending : THREE.AdditiveBlending;
    m.premultipliedAlpha = !!isLight;
    m.opacity = isLight ? 1 : m.userData.op0;
    m.fog = !isLight;
    m.needsUpdate = true;
  }
}
const WHITE = new THREE.Color(1, 1, 1);
/** 정점·인스턴스 색: 다크 = 종류 색 × 알파(가산), 라이트 = 흰색 → 잉크 색 알파만큼(곱하기) */
export function artInk(out, c, a, isLight) {
  if (isLight) out.copy(WHITE).lerp(c, Math.min(1, a));
  else out.copy(c).multiplyScalar(Math.min(1, a));
  return out;
}

class ArtLayerBase3D {
  /** solid: 상자를 배경과 섞은 불투명 색으로(복셀 가구 — 깊이 쓰기), 아니면 흐름과 같은 저휘도 혼합 */
  constructor(scene, view, { book, fx, style = null }, { solid = false } = {}) {
    ensureArtCss();
    this.scene = scene; this.view = view; this.solid = solid;
    this.st = new ArtState({ book, fx, style });
    this.group = new THREE.Group();
    scene.add(this.group);
    // 복셀(solid): 방 가구처럼 조명을 받는 불투명 상자(색 = 가구 금속색 + 종류 색조 조금), 그 밖: 흐름과 같은 저휘도 혼합
    this.bMat = solid ? new THREE.MeshLambertMaterial({ color: 0xffffff }) : new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92, depthWrite: false });
    this.boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.bMat, ARTGEO.BOXES);
    this.yMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
    this.cyls = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 20, 1, false), this.yMat, ARTGEO.CYLS);
    this.dMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false });
    this.dots = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), this.dMat, ARTGEO.DOTS);
    for (const m of [this.boxes, this.cyls, this.dots]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, new THREE.Color(0)); m.count = 0; m.frustumCulled = false; }
    this.dots.renderOrder = 3;
    const LCAP = this.LCAP = ARTGEO.LINES + 1200;
    this.lPos = new Float32Array(LCAP * 6); this.lCol = new Float32Array(LCAP * 6);
    const lg = this.lGeo = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.lPos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lCol, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setDrawRange(0, 0);
    this.lMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthWrite: false });
    this.lines = new THREE.LineSegments(lg, this.lMat);
    this.lines.frustumCulled = false; this.lines.renderOrder = 2;
    this.group.add(this.boxes, this.cyls, this.lines, this.dots);
    this.labels = [];
    for (let i = 0; i < ARTGEO.LABELS; i++) {
      const el = document.createElement('div'); el.className = 'art-lab';
      const o = new CSS2DObject(el); o.center.set(0.5, 1); o.visible = false;
      this.group.add(o);
      this.labels.push({ o, el, text: '', cls: '', key: '' });
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._c = new THREE.Color(); this._v = new THREE.Vector3();
    this.hits = [];
    this._last = performance.now() / 1000;
    this._env = { nowMs: Date.now(), reduced: false, foot: null, hover: null, hits: this.hits, nodePos: (id) => this._nodePos(id) };
    this.stats = { boxes: 0, cyls: 0, lines: 0, dots: 0, labels: 0, items: 0, ms: 0 };
    this.names = null; // 바닥 글씨(NamePlates3D) — 있으면 붙임
    this.applyTheme(view.tokens);
  }
  applyTheme(t) {
    if (!t) return;
    this.isLight = !!t.isLight;
    this.colors = ART_KEYS.map((k) => new THREE.Color(artKeyColor(k, this.isLight)));
    artBlend([this.lMat, this.dMat, this.yMat, this.solid ? null : this.bMat], this.isLight); // 다크 가산 · 라이트 곱하기 잉크
    for (const L of this.labels) L.key = '';
    if (this.names) this.names.applyTheme(this.isLight);
  }
  _bg() { return (this.view.tokens && this.view.tokens.bg) || new THREE.Color(this.isLight ? 0xffffff : 0); }
  _mix(out, ci, a) { return artInk(out, this.colors[ci] || this.colors[0], a, this.isLight); }
  /** 불투명 가구 색: 바탕 금속색에서 종류 색으로 a×0.5 만큼(몸통 ≈ 9%, 점등한 탭은 더) */
  _solid(out, ci, a) { const base = this._solidBase ? this._solidBase() : null; out.copy(base || this._bg()); if (!this.isLight) out.multiplyScalar(0.8); out.lerp(this.colors[ci] || this.colors[0], Math.min(1, a * 0.5)); return out; }
  _focus() {
    const v = this.view, st = this.st;
    return st.focusFor(v.hoverId || v.focusId || null, (id) => this._pidOfNode(id));
  }
  _pidOfNode(id) { const v = this.view; return v.scope && v.scope.mode === 'all' ? (v.vis.get(id) && v.vis.get(id).projectId) || null : this.st.book.defaultProject; }
  _f() { const cam = this.view.camera, H = this.view.container.clientHeight || 1; return H / (2 * Math.tan((cam.fov * Math.PI) / 360)); }
  _pxAt(x, y, z) { const c = this.view.camera.position; return this._f() / (Math.hypot(c.x - x, c.y - y, c.z - z) || 1); }

  update(now) {
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, now - this._last)); this._last = now;
    const env = this._env, v = this.view, st = this.st;
    env.nowMs = v.clock ? v.clock() : Date.now();
    env.reduced = !!v.reduced;
    env.style = st.style; env.isLight = this.isLight;
    env.pidAlpha = v.projAlpha ? (pid) => v.projAlpha(pid) : null;
    this._prepare(now, dt, env);
    env.foot = this._focus();
    env.hover = st.sel;
    const g = this._geometry(now, env);
    this._upload(g);
    Object.assign(this.stats, { boxes: g.nb, cyls: g.ny, lines: this._nl, dots: g.nd, labels: g.labels.length, items: this.hits.length, ms: +(performance.now() - t0).toFixed(2) });
  }
  _upload(g) {
    const q = this._q, s = this._s, p = this._p, m = this._m, c = this._c;
    const B = this.boxes;
    for (let i = 0; i < g.nb; i++) {
      const o = i * 6;
      p.set(g.B[o], g.B[o + 1], g.B[o + 2]); s.set(Math.max(0.01, g.B[o + 3]), Math.max(0.01, g.B[o + 4]), Math.max(0.01, g.B[o + 5]));
      m.compose(p, q, s); B.setMatrixAt(i, m); B.setColorAt(i, this.solid ? this._solid(c, g.BC[i], g.BA[i]) : this._mix(c, g.BC[i], g.BA[i]));
    }
    B.count = g.nb; B.instanceMatrix.needsUpdate = true; if (B.instanceColor) B.instanceColor.needsUpdate = true;
    const Y = this.cyls;
    for (let i = 0; i < g.ny; i++) {
      const o = i * 5;
      p.set(g.Y[o], g.Y[o + 1], g.Y[o + 2]); s.set(g.Y[o + 3], Math.max(0.01, g.Y[o + 4]), g.Y[o + 3]);
      m.compose(p, q, s); Y.setMatrixAt(i, m); Y.setColorAt(i, this._mix(c, g.YC[i], g.YA[i]));
    }
    Y.count = g.ny; Y.instanceMatrix.needsUpdate = true; if (Y.instanceColor) Y.instanceColor.needsUpdate = true;
    const P = this.lPos, C = this.lCol;
    let nl = 0;
    const put = (o0, dx, dz, ci, a) => {
      if (nl >= this.LCAP) return;
      const o = nl * 6;
      P[o] = g.L[o0] + dx; P[o + 1] = g.L[o0 + 1]; P[o + 2] = g.L[o0 + 2] + dz;
      P[o + 3] = g.L[o0 + 3] + dx; P[o + 4] = g.L[o0 + 4]; P[o + 5] = g.L[o0 + 5] + dz;
      this._mix(c, ci, a);
      C[o] = C[o + 3] = c.r; C[o + 1] = C[o + 4] = c.g; C[o + 2] = C[o + 5] = c.b;
      nl++;
    };
    for (let i = 0; i < g.nl; i++) {
      const o0 = i * 6;
      put(o0, 0, 0, g.LC[i], g.LA[i]);
      const w = g.LW[i];
      if (w > 1) {
        const ddx = g.L[o0 + 3] - g.L[o0], ddz = g.L[o0 + 5] - g.L[o0 + 2], l = Math.hypot(ddx, ddz) || 1;
        const nx = (-ddz / l) * EDGE_OFF, nz = (ddx / l) * EDGE_OFF;
        put(o0, nx, nz, g.LC[i], g.LA[i] * 0.85);
        if (w > 2) put(o0, -nx, -nz, g.LC[i], g.LA[i] * 0.85);
      }
    }
    this._nl = nl;
    this.lGeo.attributes.position.needsUpdate = true; this.lGeo.attributes.color.needsUpdate = true;
    this.lGeo.setDrawRange(0, nl * 2);
    const D = this.dots;
    for (let i = 0; i < g.nd; i++) {
      const o = i * 4;
      p.set(g.D[o], g.D[o + 1], g.D[o + 2]); s.setScalar(g.D[o + 3]);
      m.compose(p, q, s); D.setMatrixAt(i, m); D.setColorAt(i, this._mix(c, g.DC[i], g.DA[i]));
    }
    D.count = g.nd; D.instanceMatrix.needsUpdate = true; if (D.instanceColor) D.instanceColor.needsUpdate = true;
    for (let i = 0; i < this.labels.length; i++) {
      const L = this.labels[i], d = g.labels[i];
      if (!d) { if (L.o.visible) L.o.visible = false; continue; }
      L.o.position.set(d.x, d.y, d.z);
      if (L.text !== d.text) { L.el.textContent = d.text; L.text = d.text; }
      const cls = 'art-lab ' + d.cls;
      if (L.cls !== cls) { L.el.className = cls; L.cls = cls; }
      if (L.key !== d.key) { L.el.style.setProperty('--art-c', artKeyColor(d.key, this.isLight)); L.key = d.key; }
      const op = (Math.round(d.alpha * 20) / 20).toFixed(2);
      if (L.el.style.opacity !== op) L.el.style.opacity = op;
      if (!L.o.visible) L.o.visible = true;
    }
  }
  /** 화면 좌표 → {pid, id}: 집기 기준점을 화면에 투영해 가장 가까운 것 */
  pickAt(clientX, clientY) {
    const r = this.view.renderer.domElement.getBoundingClientRect(), cam = this.view.camera, v = this._v, f = this._f();
    return pickHits(this.hits, clientX - r.left, clientY - r.top, (x, y, z, rr) => {
      v.set(x, y, z).project(cam);
      if (v.z > 1 || v.z < -1) return null;
      return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, r: (rr * f) / (cam.position.distanceTo(this._p.set(x, y, z)) || 1) };
    });
  }
  posOf(pid, id) { for (const h of this.hits) if (h.pid === pid && h.id === id) return new THREE.Vector3(h.x, h.y, h.z); return null; }
  dispose() {
    if (this.names) { this.names.dispose(); this.names = null; }
    this.scene.remove(this.group);
    this.boxes.geometry.dispose(); this.cyls.geometry.dispose(); this.dots.geometry.dispose(); this.lGeo.dispose();
    for (const mm of [this.bMat, this.yMat, this.lMat, this.dMat]) mm.dispose();
    this.boxes.dispose?.(); this.cyls.dispose?.(); this.dots.dispose?.();
    for (const L of this.labels) L.el.remove();
    this.labels = [];
  }
}

// ───────────── Planet 3D(SceneView) ─────────────
/** Planet 바닥 높이: 전체 보기·단일 세션 모두 에이전트 궤도면 아래 별도 평면 — planetFloorY(가장 낮은 노드 − 틈), 기본 −9.
 *  (예전: 전체 보기 섬 원판 위 −2.2·단일 세션 −6 → 아래쪽 행성·백그라운드 명령(−4)과 같은 평면에 섞였다) */
export class PlanetArt3D extends ArtLayerBase3D {
  constructor(scene, view, opts) {
    super(scene, view, opts);
    this._env.anchor = (pid) => this.st.anchor(pid);
    this._env.yOf = () => this._y();
    this._avoid = [];
    this._floor = planetFloorY(-4 - PLANET_ART.BODY_K * 0.4);
  }
  _y() { return this._floor; }
  /** 보이는 노드 중 가장 낮은 아랫면(y − BODY_K·r) → 바닥 높이(STEP 단위, 내려갈 땐 바로·올라갈 땐 2 STEP 넘게 차이 날 때만) */
  _floorStep() {
    let m = Infinity;
    for (const n of this.view.vis.values()) { if (n.gone || n.hidden || (n.scopeK ?? 1) < 0.5) continue; m = Math.min(m, n.group.position.y - PLANET_ART.BODY_K * (n.r || 1)); }
    const f = planetFloorY(m);
    if (f < this._floor || f - this._floor > 2 * PLANET_ART.STEP) this._floor = f;
  }
  _nodePos(id) {
    const v = this.view.vis.get(id);
    if (!v || v.gone || v.hidden || v.exiting != null || !v.group.visible || (v.scopeD ?? 1) < 0.5) return null; // 페이드 중엔 그대로(장면·빔은 프로젝트 투명도 ka 로)
    return v.group.position;
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
  /** 대상 배치 목표: 전체 보기는 섬 발자국의 SHRINK 배(깊은 바닥이 이웃 섬 쪽으로 투영되지 않게), 바닥 글씨는 원래 섬 크기 */
  _layTarget(pid) {
    const t = this._target(pid);
    if (!t || !(this.view.scope && this.view.scope.mode === 'all')) return t;
    return { ...t, hw: t.hw * PLANET_ART.SHRINK, hd: t.hd * PLANET_ART.SHRINK };
  }
  _prepare(now, dt, env) {
    const st = this.st, pids = this._pids();
    st.frame(pids, (p) => this._layTarget(p), now, dt);
    this._floorStep();
    const y = this._y();
    env.cellPx = (pid) => { const a = st.anchor(pid); return a ? ART.CELL * (a.k || 1) * this._pxAt(a.x, y, a.z) : 20; };
    const av = this._avoid; av.length = 0;
    const pl = this._plumbs || (this._plumbs = []); pl.length = 0; // 다림줄(노드 → 대상 바닥)
    const pa = this.view.projAlpha ? (pid) => this.view.projAlpha(pid) : null;
    for (const n of this.view.vis.values()) {
      if (n.gone || n.hidden || (n.scopeK ?? 1) < 0.5) continue;
      const gp = n.group.position;
      av.push({ x: gp.x, z: gp.z, r: (n.r || 1) * PLANET_ART.AVOID_K });
      if (n.exiting == null && n.group.visible && pl.length < 160) pl.push({ x: gp.x, y: gp.y, z: gp.z, r: n.r || 1, a: pa && n.projectId ? pa(n.projectId) : 1 });
    }
    env.avoid = av; env.plumbs = pl;
    if (this.names) this.names.update(pids, (p) => this._target(p), this._f(), now, dt, { y: y + ART.NAME_Y, reduced: env.reduced });
  }
  _geometry(now, env) { return planetArtGeometry(this.st.book, this.st.lay, this.st.fx, now, env, this.st.geo); }
  fitPoints(pts, scope = {}) {
    const fp = scope && scope.mode === 'all' ? scope.focusProject || null : null;
    return artFitPoints(this.st.lay, (pid) => this.st.anchor(pid), pts, { pid: fp, y: this._y() });
  }
}

// ───────────── 복셀 3D(VoxelView) ─────────────
export class VoxelArt3D extends ArtLayerBase3D {
  constructor(scene, view, opts) {
    super(scene, view, opts, { solid: true });
    this.plan = new VxArtPlan();
    this._solidBase = () => (this.view.pal && this.view.pal.metalDark) || null; // 복셀 팔레트(테마별) 가구 금속색
    this.plans = new Map();
    this._pk = '';
  }
  _nodePos(id) {
    const v = this.view, ch = v.chars && v.chars.get(id);
    const p = this._np || (this._np = new Map());
    let o = p.get(id); if (!o) { o = { x: 0, y: 0, z: 0 }; p.set(id, o); }
    if (ch && ch.placed && ch.state !== 'gone' && !ch.offstage && !(v._isDim && v._isDim(id))) { o.x = ch.pos.x; o.y = 1.15; o.z = ch.pos.z; return o; }
    const m = v.machines && v.machines.get(id);
    if (m && m.pos && !m.released) { o.x = m.pos.x; o.y = 1.0; o.z = m.pos.z; return o; }
    return null;
  }
  _pidOfNode(id) { const v = this.view; return v.scope && v.scope.mode === 'all' ? (v.nodeCluster ? v.nodeCluster(id) : null) : this.st.book.defaultProject; }
  _prepare(now, dt, env) {
    const st = this.st, v = this.view;
    st.fx.step(now);
    const rooms = vxRoomsFor(v, st.book);
    const key = st.book.version + '|' + (v._layoutVer || 0) + '|' + [...rooms].map(([p, r]) => `${p}@${r.id}:${r.origin.x},${r.origin.z},${r.size.d},${r.xf ? r.xf.k : 0}`).join(';');
    if (key !== this._pk) {
      this._pk = key;
      this.plans.clear(); st.lay.clear();
      for (const [pid, room] of rooms) { const P = this.plan.sync(pid, st.book.shownItems(pid), room); this.plans.set(pid, P); st.lay.set(pid, P); }
      if (st.foot) st.foot.set = st.book.touchedBy(st.foot.pid, st.foot.node);
    }
    env.unitPx = (pid) => { const P = this.plans.get(pid); if (!P) return 20; const o = P.room.origin; return this._pxAt(o.x, 1, o.z); };
    if (this.names) this.names.update([...this.plans.keys()], (p) => { const P = this.plans.get(p); if (!P) return null; const b = P.room.bounds; return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, hw: (b.maxX - b.minX) / 2, hd: (b.maxZ - b.minZ) / 2 }; }, this._f(), now, dt, { y: 0.012, reduced: env.reduced });
  }
  _geometry(now, env) { return voxelArtGeometry(this.st.book, this.plans, this.st.fx, now, env, this.st.geo); }
  fitPoints(pts, scope = {}) {
    const fp = scope && scope.mode === 'all' ? scope.focusProject || null : null;
    for (const [pid, P] of this.plans) if (!fp || pid === fp) vxFitPoints(P, pts);
    return pts;
  }
}
