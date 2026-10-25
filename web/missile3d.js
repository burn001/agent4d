// 사용자 입력 빛줄기 3D — 흐름·Planet(scene.js)·복셀(office.js)이 같은 층을 쓴다. 규칙은 missile-core.mjs.
// 카메라 앞 화면 하단 가운데(시청자 자리)에서 쏜 빛 머리가 유도 곡선을 따라 날아가 목표 노드에 흡수된다.
// 모양: 빛나는 머리(작은 구 + 화면을 향한 부드러운 후광) + 끝으로 갈수록 가늘고 투명한 꼬리 띠(카메라를 향한 리본). 날개·불꽃·연기 없음.
// 다크 = 가산(흰 쪽 메인 색), 라이트 = 보통 섞기·진한 메인 색(라이트 원칙). 움직임 줄이기 = 목표 바로 앞에서 짧은 직선.
import * as THREE from 'three';
import { missileDur, MISSILE_REDUCED, ABSORB_FROM, TRAIL, flightEase, bez, trailAt } from './missile-core.mjs';

const RIB_V = /* glsl */`attribute float aA; varying float vA; varying float vS;
attribute float aS;
void main() { vA = aA; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RIB_F = /* glsl */`uniform vec3 uColor; uniform float uOp; varying float vA; varying float vS;
void main() { float edge = 1.0 - pow(abs(vS), 2.0); gl_FragColor = vec4(uColor, vA * edge * uOp); }`;
const HALO_V = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const HALO_F = /* glsl */`uniform vec3 uColor; uniform float uOp; varying vec2 vUv;
void main() { float d = length(vUv - 0.5) * 2.0; float a = exp(-d * d * 4.5) * (1.0 - smoothstep(0.85, 1.0, d)); gl_FragColor = vec4(uColor, a * uOp); }`;

const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _n = new THREE.Vector3(), _vd = new THREE.Vector3(), _q = new THREE.Vector3();

class Missile {
  constructor(layer, camera, targetFn, o) {
    this.layer = layer; this.target = targetFn; this.o = o;
    const N = TRAIL.N;
    this.pos = new Float32Array(N * 2 * 3); this.al = new Float32Array(N * 2); const sideA = new Float32Array(N * 2);
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    for (let i = 0; i < N; i++) { sideA[i * 2] = -1; sideA[i * 2 + 1] = 1; }
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aS', new THREE.BufferAttribute(sideA, 1));
    g.setIndex(idx);
    const blend = o.light ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.rMat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: o.color.clone() }, uOp: { value: 1 } }, vertexShader: RIB_V, fragmentShader: RIB_F, transparent: true, depthWrite: false, depthTest: false, blending: blend, side: THREE.DoubleSide });
    this.hMat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: o.color.clone() }, uOp: { value: 1 } }, vertexShader: HALO_V, fragmentShader: HALO_F, transparent: true, depthWrite: false, depthTest: false, blending: blend });
    this.cMat = new THREE.MeshBasicMaterial({ color: o.core, transparent: true, depthWrite: false, depthTest: false, blending: blend });
    this.rib = new THREE.Mesh(g, this.rMat); this.rib.frustumCulled = false; this.rib.renderOrder = 20;
    this.halo = new THREE.Mesh(layer.quad, this.hMat); this.halo.renderOrder = 21;
    this.core = new THREE.Mesh(layer.ball, this.cMat); this.core.renderOrder = 22;
    this.group = new THREE.Group(); this.group.add(this.rib, this.halo, this.core);
    layer.group.add(this.group);
    // 출발점: 카메라 공간 (0, 화면 아래 82%, 앞 d0) — 쏜 순간 고정
    camera.updateMatrixWorld();
    const d0 = Math.max(camera.near * 6, 2.2), hh = Math.tan((camera.fov * Math.PI) / 360) * d0;
    this.p0 = new THREE.Vector3(0, -hh * 0.82, -d0).applyMatrix4(camera.matrixWorld);
    const tp = targetFn(_v) ? _v.clone() : this.p0.clone();
    const L = this.p0.distanceTo(tp);
    this.L = L;
    // 첫 제어점: 카메라 기준 옆·아래로 흘림 + 앞으로(쏜 방향)
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), fwd = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate();
    const side = o.side || 1;
    this.c1 = this.p0.clone().addScaledVector(fwd, L * 0.28).addScaledVector(right, side * L * 0.22).addScaledVector(up, -L * 0.1);
    this.up = up.clone(); this.right = right.clone(); this.side = side;
    this.dur = o.reduced ? MISSILE_REDUCED.dur : missileDur(L);
    this.t0 = o.now;
    this.c2 = new THREE.Vector3(); this.p1 = tp.clone();
    this.arrived = false;
  }
  /** 매 프레임: 목표를 따라 둘째 제어점·끝점 갱신 → 꼬리·머리. 끝나면 false */
  step(now, camera) {
    const k = (now - this.t0) / this.dur;
    if (this.target(_v)) this.p1.copy(_v);
    const L = this.L;
    const o = this.o;
    if (o.reduced) {
      // 짧은 직선: 목표에서 카메라 쪽 L·frac 앞 → 목표
      const a = _q.copy(camera.position).sub(this.p1).normalize().multiplyScalar(Math.min(L, 40) * MISSILE_REDUCED.frac).add(this.p1);
      this.p0r = a; this.c1r = a; this.c2.copy(this.p1);
    } else {
      // 둘째 제어점: 목표 위쪽·출발 반대 옆에서 휘어 들어감
      this.c2.copy(this.p1).addScaledVector(this.up, L * 0.2).addScaledVector(this.right, -this.side * L * 0.08);
    }
    const P0 = o.reduced ? this.p0r : this.p0, C1 = o.reduced ? this.c1r : this.c1;
    const t = flightEase(Math.min(1, k));
    // 카메라를 향한 리본
    camera.getWorldPosition(_vd);
    const N = TRAIL.N, w0 = o.width * (o.reduced ? 0.6 : 1);
    const fade = k > 1 ? Math.max(0, 1 - (k - 1) / 0.25) : 1;     // 도착 뒤 꼬리가 0.25초에 사라짐
    for (let i = 0; i < N; i++) {
      const s = trailAt(t, i);
      bez(_v, P0, C1, this.c2, this.p1, s.t);
      bez(_t, P0, C1, this.c2, this.p1, Math.min(1, s.t + 0.01));
      _t.sub(_v); if (_t.lengthSq() < 1e-10) _t.set(1, 0, 0);
      _n.copy(_v).sub(_vd).cross(_t).normalize();
      // 시점에서 멀수록 같은 화면 폭이 되도록 거리 비례(카메라 바로 앞 출발점이 화면을 덮지 않게 하한)
      const dz = Math.max(0.6, _v.distanceTo(_vd));
      const w = w0 * s.w * dz * 0.0075;
      const j = i * 6;
      this.pos[j] = _v.x - _n.x * w; this.pos[j + 1] = _v.y - _n.y * w; this.pos[j + 2] = _v.z - _n.z * w;
      this.pos[j + 3] = _v.x + _n.x * w; this.pos[j + 4] = _v.y + _n.y * w; this.pos[j + 5] = _v.z + _n.z * w;
      const a = s.a * fade * (i === 0 ? 1 : Math.min(1, (t - s.t) / 0.02 + 0.2));
      this.al[i * 2] = this.al[i * 2 + 1] = a;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aA.needsUpdate = true;
    this.geo.computeBoundingSphere();
    // 머리: 끝 구간에서 작아지며 흡수
    bez(_v, P0, C1, this.c2, this.p1, t);
    const ab = k < ABSORB_FROM ? 1 : Math.max(0, 1 - (k - ABSORB_FROM) / (1 - ABSORB_FROM));
    const dz = Math.max(0.6, _v.distanceTo(_vd));
    const hs = o.width * dz * 0.026 * (0.4 + 0.6 * ab) * (k > 1 ? 0 : 1);
    this.halo.position.copy(_v); this.halo.quaternion.copy(camera.quaternion); this.halo.scale.setScalar(Math.max(1e-4, hs * 2.4));
    this.core.position.copy(_v); this.core.scale.setScalar(Math.max(1e-4, hs * 0.32));
    this.hMat.uniforms.uOp.value = o.op * (0.75 + 0.25 * ab);
    this.cMat.opacity = o.op;
    this.rMat.uniforms.uOp.value = o.op * 0.9;
    if (!this.arrived && k >= 1) { this.arrived = true; if (o.onArrive) o.onArrive(); }
    return k < 1.25;
  }
  dispose() { this.group.removeFromParent(); this.geo.dispose(); this.rMat.dispose(); this.hMat.dispose(); this.cMat.dispose(); }
}

export class MissileLayer {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.renderOrder = 20;
    scene.add(this.group);
    this.quad = new THREE.PlaneGeometry(1, 1);
    this.ball = new THREE.SphereGeometry(1, 12, 8);
    this.list = [];
    this._side = 1;
  }
  /** camera, targetFn(out) → bool(목표 세계 위치), o = {color: THREE.Color, light, reduced, onArrive, now} */
  launch(camera, targetFn, o) {
    if (this.list.length >= 6) { this.list.shift().dispose(); }
    this._side = -this._side; // 연달아 쏘면 좌우 번갈아
    const L = !!o.light;
    const color = o.color.clone();
    const core = L ? color.clone().multiplyScalar(0.85) : color.clone().lerp(new THREE.Color(1, 1, 1), 0.7);
    if (!L) color.lerp(new THREE.Color(1, 1, 1), 0.35);
    this.list.push(new Missile(this, camera, targetFn, { ...o, color, core, side: this._side, width: o.width || 1, op: L ? 0.8 : 0.95 }));
  }
  get active() { return this.list.length > 0; }
  update(now, camera) {
    if (!this.list.length) return;
    const keep = [];
    for (const m of this.list) { if (m.step(now, camera)) keep.push(m); else m.dispose(); }
    this.list = keep;
  }
  dispose() { for (const m of this.list) m.dispose(); this.list = []; this.group.removeFromParent(); this.quad.dispose(); this.ball.dispose(); }
}
