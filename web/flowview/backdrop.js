// 흐름(Flow) 표현의 배경
// agent-flow 의 배경: 깊은 남색 허공 · 천천히 떠도는 깊이 입자(시차) · 활동 중인 에이전트를 따라가는 은은한 조명.
// 바닥 격자는 세 표현 공통 모듈(web/env/ground.js)이 그린다(예전 육각 격자 대체).
// 조명은 평면 셰이더 1장, 입자는 Points 1개(프레임마다 정점 수정 없음 — 셰이더가 시간으로 흘린다).
import * as THREE from 'three';
import { paletteOf, stateColor, nodeVisualState } from './flow-style.mjs';
import { TIER } from './tier-core.mjs';

const SPOT_Y = TIER.FLOOR - 0.2; // 활동 조명은 바닥에(예전 노드 평면 바로 아래 −1)

const SPOT_FS = `
uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
void main() { float d = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(uColor, uAlpha * pow(max(0.0, 1.0 - d), 2.2)); }`;
const SPOT_VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DUST_VS = `
uniform float uTime; uniform float uSize; attribute vec4 aInfo; varying float vA;
void main() {
  vec3 p = position;
  p.x = mod(p.x + uTime * aInfo.z * 2.0 + 300.0, 600.0) - 300.0;
  p.z = mod(p.z - uTime * aInfo.z + 300.0, 600.0) - 300.0;
  vA = aInfo.y;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * aInfo.x;
  gl_Position = projectionMatrix * mv;
}`;
const DUST_FS = `uniform vec3 uColor; uniform float uAlpha; varying float vA;
void main() { vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; gl_FragColor = vec4(uColor, (1.0 - d * 2.0) * vA * uAlpha); }`;

export class Backdrop {
  constructor(scene, view) {
    this.view = view;
    this.spotU = { uColor: { value: new THREE.Color() }, uAlpha: { value: 0.08 } };
    this.spot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: this.spotU, vertexShader: SPOT_VS, fragmentShader: SPOT_FS, transparent: true, depthWrite: false }));
    this.spot.rotation.x = -Math.PI / 2; this.spot.position.y = SPOT_Y; this.spot.renderOrder = -1;
    // 깊이 입자: 바닥 아래 넓은 상자
    const N = 700, pos = new Float32Array(N * 3), info = new Float32Array(N * 4);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rnd() * 600 - 300; pos[i * 3 + 1] = TIER.FLOOR - 4 - rnd() * 90; pos[i * 3 + 2] = rnd() * 600 - 300;
      const depth = rnd();
      info[i * 4] = 0.6 + depth * 1.4; info[i * 4 + 1] = 0.08 + rnd() * 0.3 * (0.5 + depth * 0.5); info[i * 4 + 2] = 0.3 + rnd() * 0.8; info[i * 4 + 3] = depth;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dg.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
    this.dustU = { uTime: { value: 0 }, uSize: { value: 2.2 * Math.min(2, window.devicePixelRatio || 1) }, uColor: { value: new THREE.Color() }, uAlpha: { value: 1 } };
    this.dust = new THREE.Points(dg, new THREE.ShaderMaterial({ uniforms: this.dustU, vertexShader: DUST_VS, fragmentShader: DUST_FS, transparent: true, depthWrite: false }));
    this.dust.frustumCulled = false; this.dust.renderOrder = -3;
    scene.add(this.spot, this.dust);
    this._c = new THREE.Color();
    this._spotPos = new THREE.Vector3();
    this._spotOn = 0;
  }
  applyTheme(isLight) {
    const P = paletteOf(isLight);
    this.isLight = !!isLight;
    this.dustU.uColor.value.set(P.holo);
    this.dustU.uAlpha.value = isLight ? 0.55 : 1;
    const blend = isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (const m of [this.dust.material, this.spot.material]) if (m.blending !== blend) { m.blending = blend; m.needsUpdate = true; }
  }
  /** 조명 대상: 자동 카메라가 비추는 노드 → 포커스 → 가장 최근 활동한 작업 중 노드 */
  _spotTarget() {
    const v = this.view;
    const pick = (id) => { const x = id && v.vis.get(id); return x && !x.hidden && !x.gone ? x : null; };
    let t = pick(v.camShotId) || pick(v.focusId);
    if (!t) {
      let best = null, bt = '';
      for (const x of v.vis.values()) { if (x.hidden || x.gone || x.node.status !== 'active') continue; const la = x.node.lastActivityAt || ''; if (!best || la > bt) { best = x; bt = la; } }
      t = best;
    }
    return t;
  }
  update(now, dt, camTarget, camDist) {
    this.dustU.uTime.value = now % 1000;
    const t = this._spotTarget();
    const want = t ? 1 : 0;
    this._spotOn += (want - this._spotOn) * Math.min(1, dt * 2);
    if (t) {
      this._spotPos.lerp(t.group.position, Math.min(1, dt * 3));
      const st = nodeVisualState(t.node.status, t.icons ? t.icons.size : 0);
      this._c.set(stateColor(st, this.isLight));
      this.spotU.uColor.value.lerp(this._c, Math.min(1, dt * 2));
    }
    this.spot.position.set(this._spotPos.x, SPOT_Y, this._spotPos.z);
    const R = Math.max(30, camDist * 0.45);
    this.spot.scale.set(R, R, 1);
    this.spotU.uAlpha.value = this._spotOn * (this.isLight ? 0.1 : 0.13);
    this.spot.visible = this._spotOn > 0.01;
  }
  dispose() {
    for (const m of [this.spot, this.dust]) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); }
  }
}
