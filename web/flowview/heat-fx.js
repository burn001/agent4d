// 흐름(Flow) 3D 에이전트 과열 연출 — 장면 공용 인스턴싱 빌보드 두 묶음(빛 · 연기).
//  · 노드별 heat 는 HeatBook(heat-core.mjs)이 보간(오를 땐 빠르게, compact 로 떨어지면 몇 초에 걸쳐 식음) → v._heatK 에 적어
//    칩(chips.js 테두리·글로우 물듦)·메인 몸(main-rigs.js 코어·틀 물듦)이 같은 값을 읽는다.
//  · 빛 묶음(다크 가산 · 라이트 곱하기 잉크): 노드 둘레 열 글로우(맥동) · 위험 경고 파문 · 불티.
//  · 연기 묶음(다크 보통 혼합 밝은 회색 · 라이트 곱하기 회색 잉크): 데움 50%↑ 아지랑이·옅은 연기 한두 가닥 · 과열 연기 가닥 · 위험 짙은 연기 기둥.
//  · 입자는 상태가 없다(heat-fx-core puffAt·emberAt — 번호·시각·씨앗의 주기 함수). 노드당 상한·화면 반지름 LOD·장면 상한(HFX.TOTAL_MAX).
//  · 움직임 줄이기(view.reduced): 연기·불티·파문 없이 정지 글로우만. 끝남·중지·오류·퇴장·숨김 노드는 꺼짐.
import * as THREE from 'three';
import { HeatBook, nodeHeat, CRIT_H } from '../heat-core.mjs';
import { HFX, heatLook, heatColor, smokeColor, heatPulse, puffAt, hazeAt, emberAt, rippleAt, heatEligible } from './heat-fx-core.mjs';

const VS = `
attribute vec3 iPos; attribute vec4 iA; attribute vec3 iCol;
varying vec2 vUv; varying vec4 vA; varying vec3 vCol;
void main() {
  vUv = position.xy; vA = iA; vCol = iCol;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  mv.xy += position.xy * iA.x;
  gl_Position = projectionMatrix * mv;
}`;
// iA = (크기, 알파, 종류, 씨앗). 종류 0 열 글로우 · 1 연기 덩이 · 2 불티 · 3 경고 파문 · 4 아지랑이
const FS = `
uniform float uLight;
varying vec2 vUv; varying vec4 vA; varying vec3 vCol;
void main() {
  float r = length(vUv), k = vA.z, a = vA.y, sd = vA.w;
  if (r > 1.0 || a < 0.002) discard;
  float m;
  if (k < 0.5) { m = exp(-r * r * 4.2) * (1.0 - smoothstep(0.7, 1.0, r)); }
  else if (k < 1.5) {
    float n = 0.78 + 0.22 * sin(vUv.x * 4.3 + sd * 7.0) * sin(vUv.y * 3.7 - sd * 5.0);
    m = (1.0 - smoothstep(0.15, 1.0, r)) * n;
  }
  else if (k < 2.5) { m = smoothstep(1.0, 0.0, r); m *= m; }
  else if (k < 3.5) { m = smoothstep(0.1, 0.0, abs(r - 0.82)) ; }
  else { m = (1.0 - smoothstep(0.0, 1.0, r)) * (0.7 + 0.3 * sin(vUv.y * 9.0 + sd * 3.0)); }
  float al = clamp(m * a, 0.0, 1.0);
  if (uLight > 0.5) gl_FragColor = vec4(mix(vec3(1.0), vCol, al), 1.0);   // §92 곱하기 잉크(흰 종이 위 반투명 잉크)
  else gl_FragColor = vec4(vCol, al);
}`;

/** 빌보드 인스턴스 묶음 하나 */
class Sprites {
  constructor(scene, cap, ro) {
    this.cap = cap; this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (k) => new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k).setUsage(THREE.DynamicDrawUsage);
    this.pos = mk(3); this.a = mk(4); this.col = mk(3);
    g.setAttribute('iPos', this.pos); g.setAttribute('iA', this.a); g.setAttribute('iCol', this.col);
    g.instanceCount = 0;
    this.uniforms = { uLight: { value: 0 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: true });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = ro;
    this.geo = g;
    scene.add(this.mesh);
  }
  put(x, y, z, size, alpha, kind, seed, c) {
    if (this.n >= this.cap || alpha < 0.003) return;
    const i = this.n++, P = this.pos.array, A = this.a.array, C = this.col.array;
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    A[i * 4] = size; A[i * 4 + 1] = alpha; A[i * 4 + 2] = kind; A[i * 4 + 3] = seed;
    C[i * 3] = c[0]; C[i * 3 + 1] = c[1]; C[i * 3 + 2] = c[2];
  }
  flush() {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n) { this.pos.needsUpdate = true; this.a.needsUpdate = true; this.col.needsUpdate = true; }
  }
  setBlend(light, additive) {
    const m = this.mat;
    m.blending = light ? THREE.MultiplyBlending : additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.premultipliedAlpha = !!light;
    this.uniforms.uLight.value = light ? 1 : 0;
    m.needsUpdate = true;
  }
  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); this.mat.dispose(); }
}

export class HeatFx {
  constructor(scene, view) {
    this.view = view;
    this.book = new HeatBook();
    this.smoke = new Sprites(scene, HFX.TOTAL_MAX, 3.2); // 연기(칩·메인 몸 다음)
    this.glow = new Sprites(scene, 384, 3.1);            // 열 글로우·파문·불티
    this.light = false;
    this._look = {}; this._p = {}; this._hc = [0, 0, 0]; this._sc = [0, 0, 0]; this._ec = [1, 0.85, 0.5];
    this.applyTheme(false);
  }
  applyTheme(isLight) {
    this.light = !!isLight;
    this.glow.setBlend(this.light, true);
    this.smoke.setBlend(this.light, false);
    this._ec = this.light ? [0.75, 0.2, 0.02] : [1, 0.82, 0.45];
  }
  /** 재생 seek·보관함 열기·새로 그리기: 다음 값은 보간 없이 바로 목표 */
  clear() { this.book.clear(); }
  /** 칩·메인 몸보다 먼저: 노드마다 보간 heat 를 v._heatK 에 */
  step(dt) {
    const view = this.view, book = this.book;
    let hot = 0;
    for (const v of view.vis.values()) {
      if (!heatEligible(v)) { v._heatK = 0; if (book.m.has(v.id)) book.m.delete(v.id); continue; }
      const h = book.step(v.id, v.node, dt);
      v._heatK = h > 0.002 ? h : 0;
      if (v._heatK) hot++;
    }
    if (book.size > view.vis.size) book.prune(view.vis);
    this.hot = hot;
    return hot;
  }
  update(now) {
    const view = this.view, G = this.glow, S = this.smoke;
    G.n = 0; S.n = 0;
    if (!this.hot) { G.flush(); S.flush(); return; }
    const L = this.light, reduced = !!view.reduced, cam = view.camera, cp = cam.position;
    const H = view.container.clientHeight || 1, f = H / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const look = this._look, p = this._p, hc = this._hc, sc = this._sc, ec = this._ec;
    const tt = reduced ? 0 : now;
    for (const v of view.vis.values()) {
      const h = v._heatK;
      if (!h) continue;
      const a = Math.max(0, Math.min(1, v._alphaK ?? 1)) * Math.min(1, (v.scopeK ?? 1) * 1.3);
      if (a < 0.05) continue;
      const s = Math.max(1e-4, v._sz || v.mesh.scale.x);
      const pos = v.group.position;
      const d = Math.max(0.01, pos.distanceTo(cp));
      const px = (s * f) / d;
      heatLook(h, px, reduced, nodeHeat(v.node).estimated, look);
      if (!look.stage) continue;
      heatColor(h, L, hc);
      const pul = heatPulse(h, now, v.seed || 0, reduced);
      const R = s * (v.kind === 'main' ? 1.15 : 1);
      // 열 글로우(노드 가운데, 칩 몸이 앞을 가려 둘레로 번짐)
      G.put(pos.x, pos.y, pos.z, R * (2.4 + 0.5 * h) * (v.kind === 'main' ? 1.25 : 1), (L ? 0.36 : 0.62) * look.glow * pul * a, 0, v.seed || 0, hc); // 데움부터 몸 밖으로 번지게(메인은 몸이 커서 더 넓게)
      // 윗면(빔 들어오는 자리) — 연기·불티는 여기서 오른다
      const top = view.linkEnd ? view.linkEnd(v, false) : pos;
      const ty = top.y;
      if (look.ripple) {
        const u = rippleAt(now, v.seed || 0);
        G.put(pos.x, pos.y, pos.z, R * (1.2 + 1.4 * u), (L ? 0.55 : 0.6) * (1 - u) * (1 - u) * a, 3, 0, hc);
      }
      for (let i = 0; i < look.embers; i++) {
        emberAt(i, now, v.seed || 0, h, p);
        if (!p.on) continue;
        G.put(pos.x + p.x * R, ty + p.y * R, pos.z + p.z * R, Math.max(0.05, p.size * R * 1.6), p.alpha * a * (L ? 0.9 : 1), 2, 0, i % 2 ? hc : ec);
      }
      smokeColor(h, L, sc);
      for (let i = 0; i < look.haze; i++) {
        hazeAt(i, tt, v.seed || 0, p);
        S.put(pos.x + p.x * R, ty + p.y * R, pos.z, p.size * R, p.alpha * (L ? 0.2 : 0.14) * look.wisp * a, 4, (v.seed || 0) + i, hc);
      }
      // 연기 짙기: 데움 옅은 가닥(50%↑, wisp 로 서서히) · 과열 · 위험
      const dens = h >= CRIT_H ? (L ? 0.5 : 0.52) : look.stage >= 2 ? (L ? 0.36 : 0.38) : (L ? 0.24 : 0.26) * look.wisp;
      for (let i = 0; i < look.puffs; i++) {
        puffAt(i, look.puffs, now, v.seed || 0, h, p);
        S.put(pos.x + p.x * R, ty + p.y * R, pos.z + p.z * R, p.size * R * 0.7, p.alpha * dens * a, 1, (v.seed || 0) * 3 + i, sc);
      }
    }
    G.flush(); S.flush();
  }
  dispose() { this.glow.dispose(); this.smoke.dispose(); this.book.clear(); }
}
