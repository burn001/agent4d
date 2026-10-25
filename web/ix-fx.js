// 특별 상호작용 연출 — 3D 그리기. 순수 부분(IxModel·ixGeometry)은 ix-core.mjs.
// SceneView(Planet)·FlowView(Flow, SceneView 상속)가 하나씩 갖는다. 복셀은 쓰지 않는다.
// 그리기 호출 2번(선 LineSegments 1개 + 작은 정이십면체 InstancedMesh 1개) + CSS2D 라벨 풀 10개. 프레임마다 객체 생성 없음,
// 효과가 없으면 갱신도 건너뛴다. 알파는 색을 배경으로 섞어 낸다(다크 = 가산 혼합, 라이트 = 일반 혼합).
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { IxModel, IxGeo, ixGeometry, IXGEO, IX_KEYS, ixKeyColor, ensureIxCss } from './ix-core.mjs';
import { userBook, consoleLines, wantsConsole, hitRect } from './user-core.mjs'; // 사용자 콘솔

export class IxLayer {
  static CON_MIN_PX = 26; // 콘솔 화면이 이만큼(px) 넘을 때만 이름표
  static CON_SHOW = 8;
  constructor(scene, view) {
    ensureIxCss();
    this.scene = scene;
    this.view = view;
    this.model = new IxModel();
    this.geo = new IxGeo();
    this.enabled = true;
    this.theme = view.constructor && view.constructor.modeId === 'flow' ? 'flow' : 'planet';
    // 선
    this.lPos = new Float32Array(IXGEO.LINES * 6);
    this.lCol = new Float32Array(IXGEO.LINES * 6);
    const lg = this.lGeo = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.lPos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lCol, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setDrawRange(0, 0);
    this.lMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthWrite: false });
    this.lines = new THREE.LineSegments(lg, this.lMat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
    scene.add(this.lines);
    // 작은 점(패킷·타일·칸)
    this.qMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false });
    this.quads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), this.qMat, IXGEO.QUADS);
    this.quads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.quads.setColorAt(0, new THREE.Color(0));
    this.quads.count = 0;
    this.quads.frustumCulled = false;
    this.quads.renderOrder = 3;
    scene.add(this.quads);
    this._cp = new THREE.Vector3();
    this._m = new THREE.Matrix4(); this._c = new THREE.Color(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    // 라벨 풀
    this.labels = [];
    for (let i = 0; i < IXGEO.LABELS; i++) {
      const el = document.createElement('div');
      el.className = 'ix-lab';
      const o = new CSS2DObject(el);
      o.center.set(0.5, 1);
      o.visible = false;
      scene.add(o);
      this.labels.push({ o, el, text: '', cls: '', key: '' });
    }
    // 사용자 콘솔 이름표 풀(마지막 입력 첫 몇 단어 · 상태 · 시간) — 화면에서 콘솔이 작으면 안 붙임, 동시에 CON_SHOW 개
    this.conLabels = [];
    for (let i = 0; i < IXGEO.CLABELS; i++) {
      const el = document.createElement('div');
      el.className = 'ix-con';
      const b = document.createElement('b'), sp = document.createElement('span');
      el.append(b, sp);
      const o = new CSS2DObject(el);
      o.center.set(0.5, 1);
      o.visible = false;
      scene.add(o);
      this.conLabels.push({ o, el, b, sp, text: '', status: '', cls: '', key: '' });
    }
    this.conHits = []; // 이번 프레임 콘솔 화면 사각형(px, 캔버스 기준) {root, x0,y0,x1,y1, cx,cy}
    this._conInfo = new Map(); this._conAt = -1;
    this.colors = [];
    this.applyTheme(view.tokens);
    this._env = {
      light: !!this.isLight,
      theme: this.theme, reduced: false,
      pos: (id) => {
        const v = this.view.vis.get(id);
        if (!v || v.gone || v.hidden || v.exiting != null || !v.group.visible || (v.scopeD ?? 1) < 0.5) return null; // 페이드 중엔 그대로(투명도는 fade)
        return v.group.position;
      },
      rad: (id) => { const v = this.view.vis.get(id); return v ? v.r * (v.size || 1) * (this.theme === 'flow' ? 0.75 : 1) : 0.8; },
      root: (id) => this.rootOf(id),
      fade: (id) => { const v = this.view.vis.get(id); return v && v.projA != null ? v.projA : 1; }, // 프로젝트 페이드
      consoleRoots: () => this.consoleRoots(),
      consoleInfo: (root) => this.consoleInfo(root),
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

  /** 콘솔을 둘 뿌리: 끝나지 않은 메인마다(사용자 이벤트를 기다리지 않음) */
  consoleRoots() {
    const out = new Set();
    for (const v of this.view.vis.values()) if (wantsConsole(v.node)) out.add(this.rootOf(v.id));
    return out;
  }
  /** 뿌리 → 콘솔 화면 문구(consoleLines). 프레임마다 한 번만 계산 */
  consoleInfo(root) {
    const t = this._frameT;
    if (this._conAt !== t) { this._conInfo.clear(); this._conAt = t; }
    let r = this._conInfo.get(root);
    if (r === undefined) { r = consoleLines(userBook.get(root), this.view.clock ? this.view.clock() : Date.now()); this._conInfo.set(root, r); }
    return r;
  }
  /** 화면 px(캔버스 기준) → 콘솔 뿌리 id | null(화면 사각형 + 이름표) */
  consoleAt(x, y, rect) {
    const h = hitRect(this.conHits, x, y, 6);
    if (h) return h.root;
    for (const L of this.conLabels) {
      if (!L.o.visible || !L.root) continue;
      const r = L.el.getBoundingClientRect();
      if (r.width && x + rect.left >= r.left && x + rect.left <= r.right && y + rect.top >= r.top && y + rect.top <= r.bottom) return L.root;
    }
    return null;
  }
  /** 콘솔 화면 가운데(세계 좌표, 상세 카드 자리) */
  consolePos(root) {
    for (const c of this.geo.cons) if (c.root === root) return this._cp.set(c.x, c.y, c.z);
    return null;
  }

  applyTheme(t) {
    if (!t) return;
    this.isLight = !!t.isLight;
    if (this._env) this._env.light = this.isLight; // 콘솔 진하기
    this.bg = (t.bg && t.bg.clone) ? t.bg.clone() : new THREE.Color(this.isLight ? 0xffffff : 0);
    for (const L of this.conLabels || []) L.key = '';
    this.colors = IX_KEYS.map((k) => new THREE.Color(ixKeyColor(k, this.isLight)));
    const bl = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.lMat.blending = bl; this.qMat.blending = bl;
    this.lMat.needsUpdate = true; this.qMat.needsUpdate = true;
    this.theme = this.view.constructor && this.view.constructor.modeId === 'flow' ? 'flow' : 'planet';
    if (this._env) this._env.theme = this.theme;
    for (const L of this.labels) L.key = ''; // 색 다시
  }

  /** app.onEvent → view.flowEvent(라이브·mock·재생 같은 길, quiet 제외) */
  event(ev, opts = {}) { this.model.event(ev, performance.now() / 1000, opts.speed || 1, this._rootOf); }
  clear() { this.model.clear(); this._hide(); }
  dropNode(id) { this.model.dropNode(id); }

  _mix(out, ci, a) {
    const c = this.colors[ci] || this.colors[0];
    if (this.isLight) out.copy((this.view.tokens && this.view.tokens.bg) || this.bg).lerp(c, a); // 흐름 표현은 applyTheme 뒤에 배경을 바꾼다
    else out.copy(c).multiplyScalar(a);
    return out;
  }
  _hide() {
    this.lGeo.setDrawRange(0, 0);
    this.quads.count = 0;
    for (const L of this.labels) if (L.o.visible) L.o.visible = false;
    for (const L of this.conLabels) if (L.o.visible) L.o.visible = false;
    this.conHits.length = 0; this.geo.cons.length = 0;
    this._shown = false;
  }

  update(now) {
    const m = this.model;
    m.step(now);
    this._frameT = now;
    if (!this.enabled || (!m.fx.size && !m.portal.size && !m.console.size && !this._anyMain())) { if (this._shown) this._hide(); this.stats.fx = 0; return; }
    const g = ixGeometry(m, now, this._env, this.geo);
    // 선
    const P = this.lPos, C = this.lCol, c = this._c;
    for (let i = 0; i < g.nl; i++) {
      const o = i * 6;
      for (let k = 0; k < 6; k++) P[o + k] = g.L[o + k];
      this._mix(c, g.LC[i], g.LA[i]);
      C[o] = C[o + 3] = c.r; C[o + 1] = C[o + 4] = c.g; C[o + 2] = C[o + 5] = c.b;
    }
    this.lGeo.attributes.position.needsUpdate = true;
    this.lGeo.attributes.color.needsUpdate = true;
    this.lGeo.setDrawRange(0, g.nl * 2);
    // 점
    const q = this.quads;
    for (let i = 0; i < g.nq; i++) {
      const o = i * 4;
      this._p.set(g.Q[o], g.Q[o + 1], g.Q[o + 2]);
      this._s.setScalar(g.Q[o + 3]);
      this._m.compose(this._p, this._q, this._s);
      q.setMatrixAt(i, this._m);
      q.setColorAt(i, this._mix(c, g.QC[i], g.QA[i]));
    }
    q.count = g.nq;
    q.instanceMatrix.needsUpdate = true;
    if (q.instanceColor) q.instanceColor.needsUpdate = true;
    // 라벨
    for (let i = 0; i < this.labels.length; i++) {
      const L = this.labels[i], d = g.labels[i];
      if (!d) { if (L.o.visible) L.o.visible = false; continue; }
      L.o.position.set(d.x, d.y, d.z);
      if (L.text !== d.text) { L.el.textContent = d.text; L.text = d.text; }
      const cls = 'ix-lab ' + d.cls;
      if (L.cls !== cls) { L.el.className = cls; L.cls = cls; }
      if (L.key !== d.key) { L.el.style.setProperty('--ix-c', ixKeyColor(d.key, this.isLight)); L.key = d.key; }
      const op = (Math.round(d.alpha * 20) / 20).toFixed(2);
      if (L.el.style.opacity !== op) L.el.style.opacity = op;
      if (!L.o.visible) L.o.visible = true;
    }
    this._consoles(g);
    this._shown = true;
    this.stats.lines = g.nl; this.stats.quads = g.nq; this.stats.labels = g.labels.length; this.stats.fx = m.fx.size;
  }

  _anyMain() { for (const v of this.view.vis.values()) if (wantsConsole(v.node)) return true; return false; }
  /** 콘솔 화면 사각형(집기) + 이름표(화면에서 충분히 클 때만, 큰 것부터 CON_SHOW 개) */
  _consoles(g) {
    const cam = this.view.camera, dom = this.view.renderer && this.view.renderer.domElement;
    const W = (dom && dom.clientWidth) || this.view.container.clientWidth || 1, H = (dom && dom.clientHeight) || this.view.container.clientHeight || 1;
    const p = this._p;
    this.conHits.length = 0;
    const sized = [];
    for (const c of g.cons) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = false;
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        p.set(c.x + dx * c.w, c.y + dy * c.h, c.z).project(cam);
        if (p.z > 1) { behind = true; break; }
        const sx = (p.x * 0.5 + 0.5) * W, sy = (-p.y * 0.5 + 0.5) * H;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      if (behind) continue;
      // 화면에서 작으면 최소 18×12px 로 집기
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = Math.max(9, (x1 - x0) / 2), hh = Math.max(6, (y1 - y0) / 2);
      const hit = { root: c.root, x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh, cx, cy };
      this.conHits.push(hit);
      sized.push({ root: c.root, px: x1 - x0 });
    }
    sized.sort((a, b) => b.px - a.px);
    const show = new Set(sized.filter((x) => x.px >= IxLayer.CON_MIN_PX).slice(0, IxLayer.CON_SHOW).map((x) => x.root));
    let k = 0;
    for (const d of g.clabels) {
      if (!show.has(d.root) || k >= this.conLabels.length) continue;
      const L = this.conLabels[k++];
      L.o.position.set(d.x, d.y, d.z);
      L.root = d.root;
      if (L.text !== d.text) { L.b.textContent = d.text; L.b.hidden = !d.text; L.text = d.text; }
      if (L.status !== d.status) { L.sp.textContent = d.status; L.status = d.status; }
      const cls = 'ix-con st-' + d.state;
      if (L.cls !== cls) { L.el.className = cls; L.cls = cls; }
      if (L.key !== d.key) { L.el.style.setProperty('--ix-c', ixKeyColor(d.key, this.isLight)); L.key = d.key; }
      const op = (Math.round(d.alpha * 20) / 20).toFixed(2);
      if (L.el.style.opacity !== op) L.el.style.opacity = op;
      if (!L.o.visible) L.o.visible = true;
    }
    for (; k < this.conLabels.length; k++) { const L = this.conLabels[k]; L.root = null; if (L.o.visible) L.o.visible = false; }
  }

  dispose() {
    this.scene.remove(this.lines, this.quads);
    this.lGeo.dispose(); this.lMat.dispose(); this.quads.geometry.dispose(); this.qMat.dispose();
    for (const L of this.labels) { this.scene.remove(L.o); L.el.remove(); }
    for (const L of this.conLabels) { this.scene.remove(L.o); L.el.remove(); }
    this.labels = []; this.conLabels = []; this.conHits = [];
    this.model.clear();
  }
}
