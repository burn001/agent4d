// 계획 보드 깊이(구멍 사각형·그림자 판·깊이 없는 물체 문·판 뒤 DOM 라벨 잘라내기) — 3D 표현 공용.
// 흐름·Planet(SceneView)과 복셀(VoxelView)이 같은 메서드를 쓴다. 필요한 것: this.scene·camera·renderer(alpha: true)·tokens.isLight,
// 렌더 바로 앞(onFrame)에 plan-ui 가 setPlanPunch, 렌더(라벨 렌더) 뒤에 표현이 planPunchAfterRender() 를 부른다.
import * as THREE from 'three';
import { PLAN_PUNCH, PLAN_SHADOW, punchCorners, labelBoardCut, labelCutPath } from './plan-core.mjs';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

class PlanPunch {
  /**
   * 계획 보드 깊이: 판마다 구멍 사각형(판 평면 네 모서리 — 판 기준 월드 점 깊이에서 카메라와 나란한 평면, GPU 가 픽셀마다 깊이 시험)과
   * 그 둘레 그림자 판(CSS box-shadow 대신)을 둔다. list = [{wx, wy, wz(판 기준 월드 점), box{x,y,w,h}(페이지 px), r(모서리 반지름 px), a(판 불투명도)}].
   * plan-ui 가 매 프레임(onFrame — 이번 렌더 바로 앞) 부른다. 빈 목록이면 모두 숨김.
   * 깊이 시험 없이 그리는 것(depthTest:false 스프라이트)은 판 뒤에서 판 상자와 겹치는 동안만 깊이 시험을 켜고, DOM 라벨은 렌더 뒤 _cutLabels 가 잘라낸다
   */
  setPlanPunch(list) {
    if (!this._punch) this._punch = [];
    const cam = this.camera, dom = this.renderer.domElement, rect = dom.getBoundingClientRect();
    cam.updateMatrixWorld();
    const v = _v1, light = !!(this.tokens && this.tokens.isLight);
    const boards = [];
    let n = 0;
    for (const b of list || []) {
      if (n >= PLAN_PUNCH.MAX) break;
      v.set(b.wx, b.wy, b.wz).applyMatrix4(cam.matrixWorldInverse);
      const zv = -v.z;
      const pc = punchCorners(zv, b.box, rect, cam.fov, 0, cam.near);
      if (!pc) continue;
      const sc = punchCorners(zv, b.box, rect, cam.fov, PLAN_SHADOW.PAD, cam.near);
      let P = this._punch[n];
      if (!P) { P = { hole: this._punchMesh(false), shadow: this._punchMesh(true) }; this._punch.push(P); }
      this._setQuad(P.hole, pc, cam);
      this._setQuad(P.shadow, sc, cam);
      const a = Math.max(0, Math.min(1, b.a ?? 1));
      const u = P.hole.material.uniforms;
      u.uA.value = a; u.uSize.value.set(b.box.w, b.box.h); u.uR.value = Math.max(0, b.r || 0); u.uPad.value = 0;
      const us = P.shadow.material.uniforms;
      us.uA.value = a * (light ? PLAN_SHADOW.A_LIGHT : PLAN_SHADOW.A_DARK); us.uSize.value.set(b.box.w, b.box.h); us.uR.value = Math.max(0, b.r || 0);
      us.uPad.value = PLAN_SHADOW.PAD; us.uDy.value = PLAN_SHADOW.DY; us.uBlur.value = PLAN_SHADOW.BLUR;
      P.hole.visible = true; P.shadow.visible = a > 0.02;
      boards.push({ x0: b.box.x, y0: b.box.y, x1: b.box.x + b.box.w, y1: b.box.y + b.box.h, zv });
      n++;
    }
    for (let i = n; i < this._punch.length; i++) { this._punch[i].hole.visible = false; this._punch[i].shadow.visible = false; }
    this._punchBoards = boards.length ? boards : null;
    this._depthlessGate(boards, rect);
    return n;
  }
  /** 구멍(shadow=false) 또는 그림자(shadow=true) 사각형 하나 — 네 꼭짓점은 _setQuad 가 매 프레임 채운다 */
  _punchMesh(shadow) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
    g.setIndex([0, 3, 1, 1, 3, 2]);
    // 판 상자 안 px 좌표 p(가운데 0, 아래 +) · 반폭 hs = uSize/2 · 둥근 사각형 SDF(안 음수)
    const sdf = 'float sdBox(vec2 p, vec2 hs, float r){ vec2 q = abs(p) - (hs - vec2(r)); return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }';
    const body = shadow
      ? 'if (d <= 0.0) discard; float ds = sdBox(p - vec2(0.0, uDy), uSize * 0.5, uR); float k = 1.0 - smoothstep(-uBlur * 0.5, uBlur, ds); gl_FragColor = vec4(0.0, 0.0, 0.0, uA * k); }'
      : 'if (d > 0.0) discard; gl_FragColor = vec4(0.0, 0.0, 0.0, uA); }';
    const mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 1 }, uSize: { value: new THREE.Vector2(1, 1) }, uR: { value: 0 }, uPad: { value: 0 }, uDy: { value: 0 }, uBlur: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uA; uniform vec2 uSize; uniform float uR; uniform float uPad; uniform float uDy; uniform float uBlur; varying vec2 vUv;' + sdf +
        'void main(){ vec2 full = uSize + vec2(uPad * 2.0); vec2 p = (vUv - 0.5) * full * vec2(1.0, -1.0); float d = sdBox(p, uSize * 0.5, uR);' + body,
      depthTest: PLAN_PUNCH.depthTest, depthWrite: shadow ? false : PLAN_PUNCH.depthWrite, transparent: PLAN_PUNCH.transparent, fog: PLAN_PUNCH.fog,
      // 구멍 = dst × (1 − a)(색·알파) · 그림자 = 보통 섞기(색만, 알파는 그대로 — 구멍 밖은 장면 알파 1). 둘 다 불투명 단계라 섞기를 직접 지정
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      ...(shadow ? { blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor }
        : { blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor }),
    });
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = PLAN_PUNCH.renderOrder + (shadow ? 1 : 0); m.frustumCulled = false; m.name = shadow ? 'plan-shadow' : 'plan-punch'; m.raycast = () => {};
    this.scene.add(m);
    return m;
  }
  _setQuad(m, pts, cam) {
    const at = m.geometry.attributes.position, A = at.array, v = _v2;
    for (let i = 0; i < 4; i++) { v.set(pts[i].x, pts[i].y, pts[i].z).applyMatrix4(cam.matrixWorld); A[i * 3] = v.x; A[i * 3 + 1] = v.y; A[i * 3 + 2] = v.z; }
    at.needsUpdate = true;
  }
  /** depthTest:false 로 그리는 것(Planet 관문 글자 스프라이트 등)이 판 뒤에서 판 상자 가까이 있으면 그동안만 깊이 시험(판 구멍 깊이에 픽셀마다 진다) */
  _depthlessGate(boards, rect) {
    const f = this.frameNo = (this.frameNo || 0) + 1;
    if (!this._dl || f % 30 === 1) {
      this._dl = [];
      this.scene.traverse((o) => { const m = o.material; if (m && !Array.isArray(m) && (m.depthTest === false || m.userData.boardGate) && o.name !== 'plan-punch' && o.name !== 'plan-shadow') { m.userData.boardGate = true; this._dl.push(o); } });
    }
    const cam = this.camera, v = _v2, w = _v3;
    for (const o of this._dl) {
      let hit = false;
      if (boards.length && o.visible && o.parent) {
        o.getWorldPosition(v);
        const zv = -w.copy(v).applyMatrix4(cam.matrixWorldInverse).z;
        v.project(cam);
        const x = rect.left + ((v.x + 1) / 2) * rect.width, y = rect.top + ((1 - v.y) / 2) * rect.height;
        for (const b of boards) if (zv > b.zv && x > b.x0 - 160 && x < b.x1 + 160 && y > b.y0 - 80 && y < b.y1 + 80) { hit = true; break; }
      }
      if (o.material.depthTest !== hit) o.material.depthTest = hit;
    }
  }
  /** 판 뒤 DOM 라벨(CSS2D — 이름표·말풍선·효과 리본·배지)이 판 상자와 겹치면 그 부분을 잘라낸다(판 앞 라벨은 그대로). 렌더 뒤(라벨 자리 확정 뒤) */
  _cutLabels() {
    const B = this._punchBoards, cut = this._cutEls || (this._cutEls = new Map());
    const f = this.frameNo || 0;
    if (!this._l2 || f % 30 === 1) { this._l2 = []; this.scene.traverse((o) => { if (o.isCSS2DObject) this._l2.push(o); }); }
    const seen = new Set();
    if (B) {
      const cam = this.camera, v = _v2, w = _v3, rect = this.renderer.domElement.getBoundingClientRect();
      for (const o of this._l2) {
        const el = o.element;
        if (!el || !el.isConnected || el.style.display === 'none' || !o.visible) continue;
        o.getWorldPosition(v);
        const zv = -w.copy(v).applyMatrix4(cam.matrixWorldInverse).z;
        v.project(cam);
        const x = rect.left + ((v.x + 1) / 2) * rect.width, y = rect.top + ((1 - v.y) / 2) * rect.height;
        let near = false;
        for (const b of B) if (zv > b.zv && x > b.x0 - 360 && x < b.x1 + 360 && y > b.y0 - 240 && y < b.y1 + 240) { near = true; break; }
        if (!near) continue;
        const r = el.getBoundingClientRect();
        const c = labelBoardCut({ left: r.left, top: r.top, width: r.width, height: r.height }, zv, B);
        if (!c) continue;
        const path = labelCutPath(c, r.width, r.height);
        if (cut.get(el) !== path) { el.style.clipPath = path; cut.set(el, path); }
        seen.add(el);
      }
    }
    for (const [el] of cut) if (!seen.has(el)) { el.style.clipPath = ''; cut.delete(el); }
  }
  /** 렌더·라벨 렌더 뒤: 판 뒤 DOM 라벨 잘라내기(판이 없어졌으면 잘랐던 것 되돌림) */
  planPunchAfterRender() { if (this._punchBoards || (this._cutEls && this._cutEls.size)) this._cutLabels(); }
  /** 구멍·그림자 메시 해제 */
  disposePlanPunch() {
    if (this._punch) { for (const P of this._punch) for (const m of [P.hole, P.shadow]) { this.scene.remove(m); m.material.dispose(); m.geometry.dispose(); } this._punch = null; }
    this._punchBoards = null;
  }
}

/** 표현 클래스에 구멍 메서드를 붙인다(setPlanPunch·_punchMesh·_setQuad·_depthlessGate·_cutLabels·planPunchAfterRender·disposePlanPunch) */
export function installPlanPunch(Cls) {
  for (const k of Object.getOwnPropertyNames(PlanPunch.prototype)) if (k !== 'constructor') Object.defineProperty(Cls.prototype, k, Object.getOwnPropertyDescriptor(PlanPunch.prototype, k));
  return Cls;
}
