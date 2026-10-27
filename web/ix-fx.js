// 특별 상호작용 연출 — 3D 그리기. 순수 부분(IxModel·ixGeometry)은 ix-core.mjs.
// SceneView(Planet)·FlowView(Flow, SceneView 상속)가 하나씩 갖는다. 복셀은 쓰지 않는다.
// 그리기 호출 2번(굵은 선 = 인스턴스 사각 선분 1개 + 작은 정이십면체 InstancedMesh 1개) + CSS2D 라벨 풀 10개. 프레임마다 객체 생성 없음,
// 효과가 없으면 갱신도 건너뛴다. 알파는 색을 배경으로 섞어 낸다(다크 = 가산 혼합, 라이트 = 일반 혼합).
// 선은 WebGL 1px 고정 선(LineBasicMaterial) 대신 화면 폭 2px(상위 활동·포커스·카메라 대상 3px, ixGeometry 가 정함)의 둥근 끝 선분 셰이더다(F1).
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { IxModel, IxGeo, ixGeometry, IXGEO, IX_KEYS, ixKeyColor, ensureIxCss, ixPortalPts, ixDimUnderLabels, ixLabelSizeGuess } from './ix-core.mjs';
import { userBook, consoleLines, wantsConsole, hitRect } from './user-core.mjs'; // 사용자 콘솔

// 굵은 선분: 인스턴스마다 두 끝(세계) + 색·화면 폭(px). 사각 네 꼭짓점(position.x = 0|1 끝, y = ±1 옆)을 화면 px 공간에서 펼치고
// 조각 셰이더가 선분까지 거리로 둥근 끝·가장자리 1px 부드럽게. 화면 공간에서 선형 보간하려고 NDC(w = 1)로 낸다.
const SEG_VS = `
attribute vec3 iA; attribute vec3 iB; attribute vec4 iC;
uniform vec2 uRes; uniform float uDpr;
varying vec3 vCol; varying vec2 vP; varying float vLen; varying float vHw;
void main() {
  vec4 ca = projectionMatrix * modelViewMatrix * vec4(iA, 1.0);
  vec4 cb = projectionMatrix * modelViewMatrix * vec4(iB, 1.0);
  if (ca.w < 1e-3 || cb.w < 1e-3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // 카메라 뒤 끝은 버림
  vec2 sa = ca.xy / ca.w * 0.5 * uRes, sb = cb.xy / cb.w * 0.5 * uRes;
  vec2 d = sb - sa; float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0); vec2 nrm = vec2(-dir.y, dir.x);
  float hw = iC.w * uDpr * 0.5; float pad = hw + 1.0;
  float e = position.x * 2.0 - 1.0;
  vec2 p = mix(sa, sb, position.x) + dir * e * pad + nrm * position.y * pad;
  float z = mix(ca.z / ca.w, cb.z / cb.w, position.x);
  gl_Position = vec4(p / (0.5 * uRes), z, 1.0);
  vCol = iC.rgb; vP = vec2(position.x * len + e * pad, position.y * pad); vLen = len; vHw = hw;
}`;
const SEG_FS = `
varying vec3 vCol; varying vec2 vP; varying float vLen; varying float vHw;
void main() {
  float dx = max(max(-vP.x, vP.x - vLen), 0.0);
  float cov = clamp(vHw + 0.5 - length(vec2(dx, vP.y)), 0.0, 1.0);
  if (cov <= 0.0) discard;
  gl_FragColor = vec4(vCol, cov);
  #include <colorspace_fragment>
}`;

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
    // 굵은 선(F1): 인스턴스 사각 선분. 상한 IXGEO.LINES 그대로, 버퍼만 채운다
    this.lA = new Float32Array(IXGEO.LINES * 3);
    this.lB = new Float32Array(IXGEO.LINES * 3);
    this.lC = new Float32Array(IXGEO.LINES * 4);
    const lg = this.lGeo = new THREE.InstancedBufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    lg.setIndex([0, 1, 2, 0, 2, 3]);
    lg.setAttribute('iA', new THREE.InstancedBufferAttribute(this.lA, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('iB', new THREE.InstancedBufferAttribute(this.lB, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('iC', new THREE.InstancedBufferAttribute(this.lC, 4).setUsage(THREE.DynamicDrawUsage));
    lg.instanceCount = 0;
    this.lU = { uRes: { value: new THREE.Vector2(1, 1) }, uDpr: { value: 1 } };
    this.lMat = new THREE.ShaderMaterial({ uniforms: this.lU, vertexShader: SEG_VS, fragmentShader: SEG_FS, transparent: true, depthWrite: false });
    this.lines = new THREE.Mesh(lg, this.lMat);
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
      theme: this.theme, reduced: false, // update 첫 줄에서 view.reduced 로 맞춘다(F6 — FlowView 는 생성 뒤에 reduced 를 정함)
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
      vip: (id) => this._vip(id),   // 굵은 선 3px · 스테이션 화면 하한 대상
      ppu: (id) => this._ppu(id),   // F2: 그 노드 자리의 세계 1단위당 화면 px(vip 아니면 0)
      edge: (id, dx, dz) => this._edge(id, dx, dz), // F3 remote: 노드에서 방향 (dx,dz) 로 섬 가장자리까지 거리(전체 보기만, 없으면 null)
      deck: this.theme === 'planet', // Planet 3D: db·tests·batch·remote 스테이션을 행성 아래 갑판에(IX_PLANET, 흐름은 floorY)
      ext: (id) => (this.view.deco && this.view.deco.extentOf ? this.view.deco.extentOf(id) : 1), // 궤도계 겉 반지름(본체 반지름 배) — 갑판 반지름
    };
    this._ppuAt = -1; this._ppuMap = new Map();
    this._rootOf = (id) => this.rootOf(id);
    this.stats = { lines: 0, quads: 0, labels: 0, fx: 0 };
  }

  /** 상위 활동(홀로그램 TOP_ACTIVE 와 같은 목록)·포커스·호버·카메라 대상 */
  _vip(id) {
    const v = this.view, top = v.holo && v.holo._top;
    return id === v.focusId || id === v.hoverId || id === v.camShotId || !!(top && top.has(id));
  }
  /** F2: vip 노드 자리의 세계 1단위당 화면 px(프레임마다 한 번), 아니면 0 */
  _ppu(id) {
    if (this._ppuAt !== this._frameT) { this._ppuMap.clear(); this._ppuAt = this._frameT; }
    let k = this._ppuMap.get(id);
    if (k !== undefined) return k;
    k = 0;
    const v = this.view.vis.get(id), cam = this.view.camera;
    if (v && cam && this._vip(id)) {
      const d = cam.position.distanceTo(v.group.position);
      const H = (this.view.renderer && this.view.renderer.domElement.clientHeight) || this.view.container.clientHeight || 1;
      if (d > 1e-3) k = H / (2 * d * Math.tan((cam.fov * Math.PI) / 360));
    }
    this._ppuMap.set(id, k);
    return k;
  }

  /** 섬(전체 보기 군집 원 center·r) 가장자리까지 거리: |o + d·t| = r 의 양의 근 */
  _edge(id, dx, dz) {
    const v = this.view.vis.get(id), CV = this.view._clusterV;
    const cl = v && v.projectId && CV ? CV.get(v.projectId) : null;
    if (!cl || !(cl.r > 0)) return null;
    const ox = v.group.position.x - cl.center.x, oz = v.group.position.z - cl.center.z;
    const b = ox * dx + oz * dz, c = ox * ox + oz * oz - cl.r * cl.r, disc = b * b - c;
    return disc < 0 ? null : -b + Math.sqrt(disc);
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

  /** 카메라 git 붙잡기가 함께 담을 그 노드 뿌리의 포털 점(세계) [{x,y,z,r}] | null */
  holdPts(id) { const root = this.rootOf(id), rp = this._env.pos(root); return rp ? ixPortalPts(this.theme, rp, Math.max(0.4, this._env.rad(root) || 0.8)) : null; }

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
    this.lGeo.instanceCount = 0;
    this.quads.count = 0;
    for (const L of this.labels) if (L.o.visible) L.o.visible = false;
    for (const L of this.conLabels) if (L.o.visible) L.o.visible = false;
    this.conHits.length = 0; this.geo.cons.length = 0;
    this._shown = false;
  }

  update(now) {
    this._env.reduced = !!this.view.reduced; // F6 움직임 줄이기 배선
    this._env.floorY = this.theme === 'flow' ? (this.view.tierFloor ?? -2.2) : null; // F3 흐름 3D: db·tests·batch·remote 스테이션을 바닥에
    const m = this.model;
    m.step(now);
    this._frameT = now;
    if (!this.enabled || (!m.fx.size && !m.portal.size && !m.console.size && !this._anyMain())) { if (this._shown) this._hide(); this.stats.fx = 0; return; }
    const g = ixGeometry(m, now, this._env, this.geo);
    this._dimUnderLabels(g); // 노드 라벨 아래 스테이션 칸은 옅게
    // 굵은 선(F1): 두 끝 + 색 + 화면 폭(px)
    const LA = this.lA, LB = this.lB, LC = this.lC, c = this._c;
    for (let i = 0; i < g.nl; i++) {
      const o = i * 6, o3 = i * 3, o4 = i * 4;
      LA[o3] = g.L[o]; LA[o3 + 1] = g.L[o + 1]; LA[o3 + 2] = g.L[o + 2];
      LB[o3] = g.L[o + 3]; LB[o3 + 1] = g.L[o + 4]; LB[o3 + 2] = g.L[o + 5];
      this._mix(c, g.LC[i], g.LA[i]);
      LC[o4] = c.r; LC[o4 + 1] = c.g; LC[o4 + 2] = c.b; LC[o4 + 3] = g.LW[i];
    }
    const at = this.lGeo.attributes;
    at.iA.needsUpdate = true; at.iB.needsUpdate = true; at.iC.needsUpdate = true;
    this.lGeo.instanceCount = g.nl;
    const rd = this.view.renderer;
    if (rd) { rd.getDrawingBufferSize(this.lU.uRes.value); this.lU.uDpr.value = rd.getPixelRatio(); }
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
      const sk = d.cls + '|' + d.text, sz = this._labSz;
      if (sz && !sz.has(sk) && L.el.offsetWidth) { if (sz.size > 256) sz.clear(); sz.set(sk, [L.el.offsetWidth, L.el.offsetHeight]); } // 다음 프레임부터 잰 크기로
    }
    this._consoles(g);
    this._shown = true;
    this.stats.lines = g.nl; this.stats.quads = g.nq; this.stats.labels = g.labels.length; this.stats.fx = m.fx.size;
  }

  /** 바닥·갑판 스테이션 점·선이 노드 라벨 상자(화면) 안이면 옅게 — 외부 작업 진행 띠가 그 작업 라벨을 덮던 것(흐름·Planet 공통) */
  _dimUnderLabels(g) {
    if (!g.st || (!g.st.length && !(g.stl && g.stl.length)) || !this.view.labelScreenBoxes || !this.view.camera) return;
    const dom = this.view.renderer && this.view.renderer.domElement;
    const W = (dom && dom.clientWidth) || this.view.container.clientWidth || 1, H = (dom && dom.clientHeight) || this.view.container.clientHeight || 1;
    const boxes = this.view.labelScreenBoxes(W, H, this._lboxes || (this._lboxes = []));
    if (!boxes.length) return;
    const cam = this.view.camera, p = this._p, cp = cam.position, tf = 2 * Math.tan((cam.fov * Math.PI) / 360);
    // 점은 화면 반지름까지(o.k = 그 깊이의 세계 1단위당 px), 스테이션 글자는 잰 크기(없으면 글자 수 추정)로 겹침을 본다
    const toS = (x, y, z, o) => { p.set(x, y, z); const d = p.distanceTo(cp); p.project(cam); if (p.z > 1 || p.z < -1) return false; o.x = (p.x * 0.5 + 0.5) * W; o.y = (-p.y * 0.5 + 0.5) * H; o.k = d > 1e-3 ? H / (d * tf) : 0; return true; };
    const sz = this._labSz || (this._labSz = new Map());
    this.stats.underLabel = ixDimUnderLabels(g, toS, boxes, undefined, undefined, (i, d) => sz.get(d.cls + '|' + d.text) || ixLabelSizeGuess(d.text, d.cls));
    boxes.length = 0;
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
        if (c.r) p.set(c.x + c.r[0] * dx * c.w + c.v[0] * dy * c.h, c.y + c.v[1] * dy * c.h, c.z + c.r[2] * dx * c.w + c.v[2] * dy * c.h).project(cam); // 입체 단말: 기운 화면 네 모서리
        else p.set(c.x + dx * c.w, c.y + dy * c.h, c.z).project(cam);
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
      c.px = x1 - x0; // 화면 폭(px) — 흐름 3D 단말 LOD(console3d.js)
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
