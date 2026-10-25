// 작업 대상 층 — 흐름 3D 그리기. 순수 부분(장부·배치·연출·도형)은 ../artifact-core.mjs.
// 섬 아래 바닥층(y = ART.FLOOR_Y): 회로 기판 블록 = 파일(폴더 구역), 저장 원기둥 = DB(쓰기 수위·컬렉션 띠), 포트 = 원격,
// 포털 = 저장소, 출력 단자 = 산출물, 안테나 = 서비스. 에이전트(노드 평면 y=0) → 대상 빔·패킷, 읽기 가는 선.
// 그리기 호출 4번(상자·원기둥 InstancedMesh 2 + 선 LineSegments 1 + 점 InstancedMesh 1) + CSS2D 라벨 풀 14. 끄면 이 객체가 없다(비용 0).
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ART, ARTGEO, ART_KEYS, artKeyColor, artGeometry, artFitPoints, artPickXZ, ArtState, ensureArtCss } from '../artifact-core.mjs';
import { NamePlates3D } from '../art-name3d.js'; // 바닥 글씨(표현 공용)

const EDGE_OFF = 0.09; // 굵은 간선(누적 많음)은 평행선을 더 그린다

export class ArtLayer3D {
  constructor(scene, view, { book, fx, style = null }) {
    ensureArtCss();
    this.scene = scene;
    this.view = view;
    this.st = new ArtState({ book, fx, style });
    this.group = new THREE.Group();
    this.group.renderOrder = 0;
    scene.add(this.group);
    // 상자(블록·구역 판)
    this.bMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92, depthWrite: false });
    this.boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.bMat, ARTGEO.BOXES);
    this.boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.boxes.setColorAt(0, new THREE.Color(0));
    this.boxes.count = 0; this.boxes.frustumCulled = false;
    // 원기둥(DB)
    this.yMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
    this.cyls = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 20, 1, false), this.yMat, ARTGEO.CYLS);
    this.cyls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cyls.setColorAt(0, new THREE.Color(0));
    this.cyls.count = 0; this.cyls.frustumCulled = false;
    // 선
    const LCAP = ARTGEO.LINES + 1200; // 굵은 간선 평행선 여유
    this.LCAP = LCAP;
    this.lPos = new Float32Array(LCAP * 6); this.lCol = new Float32Array(LCAP * 6);
    const lg = this.lGeo = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.lPos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lCol, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setDrawRange(0, 0);
    this.lMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthWrite: false });
    this.lines = new THREE.LineSegments(lg, this.lMat);
    this.lines.frustumCulled = false; this.lines.renderOrder = 2;
    // 점(패킷·잔해·안테나 불빛)
    this.dMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false });
    this.dots = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), this.dMat, ARTGEO.DOTS);
    this.dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dots.setColorAt(0, new THREE.Color(0));
    this.dots.count = 0; this.dots.frustumCulled = false; this.dots.renderOrder = 3;
    this.group.add(this.boxes, this.cyls, this.lines, this.dots);
    // 라벨
    this.labels = [];
    for (let i = 0; i < ARTGEO.LABELS; i++) {
      const el = document.createElement('div');
      el.className = 'art-lab';
      const o = new CSS2DObject(el);
      o.center.set(0.5, 1); o.visible = false;
      this.group.add(o);
      this.labels.push({ o, el, text: '', cls: '', key: '' });
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._c = new THREE.Color();
    this.applyTheme(view.tokens);
    this._last = performance.now() / 1000;
    this._env = {
      anchor: (pid) => this.st.anchor(pid),
      nodePos: (id) => {
        const v = this.view.vis.get(id);
        if (!v || v.gone || v.hidden || v.exiting != null || !v.group.visible || (v.scopeD ?? 1) < 0.5) return null; // 페이드 중엔 그대로(장면·빔은 프로젝트 투명도 ka 로)
        return v.group.position;
      },
      nowMs: Date.now(), reduced: false, foot: null, hover: null, y: ART.FLOOR_Y,
    };
    this.stats = { boxes: 0, cyls: 0, lines: 0, dots: 0, labels: 0, items: 0, ms: 0 };
  }

  applyTheme(t) {
    if (!t) return;
    this.isLight = !!t.isLight;
    this.colors = ART_KEYS.map((k) => new THREE.Color(artKeyColor(k, this.isLight)));
    // 저휘도: 다크는 가산(옅은 선·아주 옅은 채움), 라이트는 일반 혼합(밝은 바탕에 진한 가는 선, 채움 없음)
    const bl = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (const m of [this.lMat, this.dMat, this.bMat, this.yMat]) { m.blending = bl; m.needsUpdate = true; }
    for (const L of this.labels) L.key = '';
    if (this.names) this.names.applyTheme(this.isLight);
  }
  _mix(out, ci, a, solid = false) {
    const c = this.colors[ci] || this.colors[0];
    if (this.isLight || solid) out.copy((this.view.tokens && this.view.tokens.bg) || new THREE.Color(this.isLight ? 0xffffff : 0)).lerp(c, Math.min(1, a));
    else out.copy(c).multiplyScalar(Math.min(1, a));
    return out;
  }

  /** 지금 보이는 프로젝트: 전체 보기 = 활성 섬들, 단일 세션 = 장부 기본 프로젝트 */
  _pids() {
    const v = this.view;
    if (v.scope && v.scope.mode === 'all') return v.clusters().filter((c) => !c.inactive).map((c) => c.projectId).filter((p) => this.st.book.projects.has(p)).sort();
    return [this.st.book.defaultProject];
  }
  /** 섬 중심 목표: 전체 보기 = 섬 상자 가운데, 단일 세션 = 보이는 노드 경계 가운데 */
  _anchorTarget(pid) {
    const v = this.view;
    if (v.scope && v.scope.mode === 'all') { const c = v.clusterTarget(pid); return c ? { x: c.center.x, z: c.center.z, hw: c.box ? c.box.hw : c.r, hd: c.box ? c.box.hd : c.r } : null; }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const n of v.vis.values()) { if (n.gone || n.hidden) continue; const p = n.target; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    // 단일 세션: 노드 경계 + 여백(최소 반폭 18) 안에
    return Number.isFinite(x0) ? { x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: Math.max(18, (x1 - x0) / 2 + 6), hd: Math.max(18, (z1 - z0) / 2 + 6) } : { x: 0, z: 0, hw: 18, hd: 18 };
  }

  update(now) {
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, now - this._last)); this._last = now;
    const st = this.st;
    const pids = this._pids();
    st.frame(pids, (p) => this._anchorTarget(p), now, dt);
    const env = this._env, v = this.view;
    env.nowMs = v.clock ? v.clock() : Date.now();
    env.reduced = !!v.reduced;
    env.style = st.style; env.isLight = this.isLight;
    env.pidAlpha = v.projAlpha ? (pid) => v.projAlpha(pid) : null;
    // 초점: 발자국 > 호버 > 선택(포커스) 노드 — 관계없는 대상은 더 어둡게
    env.foot = st.focusFor(v.hoverId || v.focusId || null, (id) => (v.scope && v.scope.mode === 'all' ? (v.vis.get(id) && v.vis.get(id).projectId) || null : st.book.defaultProject));
    env.hover = st.sel;
    // 한 칸 화면 px(멀면 폴더 묶음 외곽선만)
    const cam = v.camera, H = v.container.clientHeight || 1, f = H / (2 * Math.tan((cam.fov * Math.PI) / 360));
    env.cellPx = (pid) => { const a = st.anchor(pid); if (!a) return 20; const d = Math.hypot(cam.position.x - a.x, cam.position.y - ART.FLOOR_Y, cam.position.z - a.z) || 1; return (ART.CELL * (a.k || 1) * f) / d; };
    // 에이전트 노드 아래 바닥은 비움(층 분리 — 노드 모양은 건드리지 않음)
    const av = this._avoid || (this._avoid = []); av.length = 0;
    for (const n of v.vis.values()) { if (n.gone || n.hidden || (n.scopeK ?? 1) < 0.5) continue; av.push({ x: n.group.position.x, z: n.group.position.z, r: (n.r || 1) * 1.5 }); }
    env.avoid = av;
    if (!this.names) { this.names = new NamePlates3D(this.group, v); this.names.applyTheme(this.isLight); }
    this.names.update(pids, (p) => this._anchorTarget(p), f, now, dt, { reduced: env.reduced });
    const g = artGeometry(st.book, st.lay, st.fx, now, env, st.geo);
    // 상자
    const q = this._q, s = this._s, p = this._p, m = this._m, c = this._c;
    const B = this.boxes;
    for (let i = 0; i < g.nb; i++) {
      const o = i * 6;
      p.set(g.B[o], g.B[o + 1], g.B[o + 2]); s.set(Math.max(0.01, g.B[o + 3]), Math.max(0.01, g.B[o + 4]), Math.max(0.01, g.B[o + 5]));
      m.compose(p, q, s); B.setMatrixAt(i, m); B.setColorAt(i, this._mix(c, g.BC[i], g.BA[i]));
    }
    B.count = g.nb; B.instanceMatrix.needsUpdate = true; if (B.instanceColor) B.instanceColor.needsUpdate = true;
    // 원기둥
    const Y = this.cyls;
    for (let i = 0; i < g.ny; i++) {
      const o = i * 5;
      p.set(g.Y[o], g.Y[o + 1], g.Y[o + 2]); s.set(g.Y[o + 3], Math.max(0.01, g.Y[o + 4]), g.Y[o + 3]);
      m.compose(p, q, s); Y.setMatrixAt(i, m); Y.setColorAt(i, this._mix(c, g.YC[i], g.YA[i]));
    }
    Y.count = g.ny; Y.instanceMatrix.needsUpdate = true; if (Y.instanceColor) Y.instanceColor.needsUpdate = true;
    // 선(굵기 2·3 은 평행선 더)
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
    this.lGeo.attributes.position.needsUpdate = true; this.lGeo.attributes.color.needsUpdate = true;
    this.lGeo.setDrawRange(0, nl * 2);
    // 점
    const D = this.dots;
    for (let i = 0; i < g.nd; i++) {
      const o = i * 4;
      p.set(g.D[o], g.D[o + 1], g.D[o + 2]); s.setScalar(g.D[o + 3]);
      m.compose(p, q, s); D.setMatrixAt(i, m); D.setColorAt(i, this._mix(c, g.DC[i], g.DA[i]));
    }
    D.count = g.nd; D.instanceMatrix.needsUpdate = true; if (D.instanceColor) D.instanceColor.needsUpdate = true;
    // 라벨
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
    let items = 0; for (const L of st.lay.values()) items += L.pos.size;
    Object.assign(this.stats, { boxes: g.nb, cyls: g.ny, lines: nl, dots: g.nd, labels: g.labels.length, items, ms: +(performance.now() - t0).toFixed(2) });
  }

  /** 클릭 판정: 상자·원기둥 인스턴스 → {pid, id} */
  pick(raycaster) {
    // 선 위주라 채움이 없을 수 있다 → 바닥 평면과 만나는 점에서 가장 가까운 대상(섬 로컬 격자)
    const hit = raycaster.ray.intersectPlane(this._plane || (this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ART.FLOOR_Y)), this._hp || (this._hp = new THREE.Vector3()));
    return hit ? artPickXZ(this.st.lay, (pid) => this.st.anchor(pid), hit.x, hit.z) : null;
  }
  /** 카메라 맞춤 점(섬 바닥층 네 모서리) */
  fitPoints(pts, scope = {}) {
    const fp = scope && scope.mode === 'all' ? scope.focusProject || null : null;
    return artFitPoints(this.st.lay, (pid) => this.st.anchor(pid), pts, { pid: fp });
  }
  /** 대상 세계 좌표(THREE.Vector3) — 상세 팝업 자리 */
  posOf(pid, id) { const w = this.st.worldOf(pid, id); return w ? new THREE.Vector3(w.x, w.y, w.z) : null; }

  dispose() {
    this.scene.remove(this.group);
    this.boxes.geometry.dispose(); this.cyls.geometry.dispose(); this.dots.geometry.dispose(); this.lGeo.dispose();
    for (const mm of [this.bMat, this.yMat, this.lMat, this.dMat]) mm.dispose();
    this.boxes.dispose?.(); this.cyls.dispose?.(); this.dots.dispose?.();
    for (const L of this.labels) L.el.remove();
    this.labels = [];
    if (this.names) { this.names.dispose(); this.names = null; }
  }
}
