// 퇴장 빛 입자: 물러나는 노드가 끝 무렵 작은 빛 입자로 흩어져 부모 쪽으로 빨려 들어간다.
// Points 1개 + 고정 크기 버퍼(상한 CAP). 슬롯은 고리 버퍼로 재사용 — 프레임마다 객체를 만들지 않는다. 시각은 SceneView 의 연출 시계(animT).
import * as THREE from 'three';
import { EXIT, particlePos, particleFade, scatterDir, particleLife } from './exit-core.mjs';

const CAP = 1024;

const VS = `
attribute float aAlpha; attribute float aSize; attribute vec3 aColor;
varying float vAlpha; varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha; vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
uniform float uLight;
varying float vAlpha; varying vec3 vColor;
void main() {
  if (vAlpha < 0.004) discard;
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(1.0, 0.0, d);
  float a = core * core * vAlpha;
  vec3 c = uLight > 0.5 ? vColor * 0.85 : mix(vColor, vec3(1.0), 0.35 * core);
  gl_FragColor = vec4(c, a);
}`;

export class ExitParticles {
  constructor(scene, view) {
    this.view = view;
    // 슬롯별 상태(Float32): 출발점 xyz · 방향 xyz · 마지막 부모 위치 xyz · t0 · life · R · 색 rgb · 크기
    this.st = new Float32Array(CAP * 17);
    this.pid = new Array(CAP).fill(null); // 부모 노드 id(위치를 매 프레임 읽음, 사라지면 마지막 위치)
    this.live = new Uint8Array(CAP);
    this.head = 0;
    this.alive = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(CAP * 3);
    this.alpha = new Float32Array(CAP);
    this.size = new Float32Array(CAP);
    this.col = new Float32Array(CAP * 3);
    const dyn = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', dyn(this.pos, 3));
    geo.setAttribute('aAlpha', dyn(this.alpha, 1));
    geo.setAttribute('aSize', dyn(this.size, 1));
    geo.setAttribute('aColor', dyn(this.col, 3));
    this.geo = geo;
    this.uniforms = { uScale: { value: 300 }, uLight: { value: 0 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    geo.setDrawRange(0, 0);
    scene.add(this.points);
    this._s = { x: 0, y: 0, z: 0 }; this._d = { x: 0, y: 0, z: 0 }; this._p = { x: 0, y: 0, z: 0 }; this._o = { x: 0, y: 0, z: 0 };
    this._top = 0; // 그리는 범위(가장 높은 살아 있는 슬롯 + 1)
  }

  applyTheme(t) {
    const light = !!t.isLight;
    this.uniforms.uLight.value = light ? 1 : 0;
    const b = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (this.mat.blending !== b) { this.mat.blending = b; this.mat.needsUpdate = true; }
  }

  /** 노드 v 를 입자로 흩는다. parentId 쪽으로 빨려 들어감. color = THREE.Color, dur = 퇴장 시간 */
  burst(v, parentId, color, now, dur = EXIT.DUR) {
    const n = EXIT.PARTICLES, st = this.st, life = particleLife(dur);
    const o = v.group.position;
    const R = Math.max(0.6, v.r * EXIT.SCATTER);
    const pv = parentId ? this.view.vis.get(parentId) : null;
    const pp = pv ? pv.group.position : o;
    for (let i = 0; i < n; i++) {
      const k = this.head; this.head = (this.head + 1) % CAP;
      if (!this.live[k]) this.alive++;
      this.live[k] = 1;
      scatterDir(this._d, i, n, v.seed || 0);
      const q = k * 17;
      st[q] = o.x; st[q + 1] = o.y; st[q + 2] = o.z;
      st[q + 3] = this._d.x; st[q + 4] = this._d.y; st[q + 5] = this._d.z;
      st[q + 6] = pp.x; st[q + 7] = pp.y; st[q + 8] = pp.z;
      st[q + 9] = now + (i % 4) * 0.025; // 조금씩 엇갈려 출발
      st[q + 10] = life * (0.85 + 0.3 * ((i * 7) % 5) / 4);
      st[q + 11] = R * (0.7 + 0.3 * ((i * 3) % 4) / 3);
      st[q + 12] = color.r; st[q + 13] = color.g; st[q + 14] = color.b;
      st[q + 15] = 0.26 + 0.14 * ((i * 5) % 3) / 2; // 세계 크기
      this.pid[k] = parentId || null;
      if (k + 1 > this._top) this._top = k + 1;
    }
  }

  clear() { this.live.fill(0); this.pid.fill(null); this.alive = 0; this._top = 0; this.geo.setDrawRange(0, 0); }

  update(now, viewportH, fov) {
    if (!this.alive) { if (this._top) { this._top = 0; this.geo.setDrawRange(0, 0); } return; }
    this.uniforms.uScale.value = viewportH / (2 * Math.tan((fov * Math.PI) / 360));
    const st = this.st, vis = this.view.vis;
    let top = 0;
    for (let k = 0; k < this._top; k++) {
      if (!this.live[k]) { this.alpha[k] = 0; continue; }
      const q = k * 17;
      const u = (now - st[q + 9]) / st[q + 10];
      if (u >= 1) { this.live[k] = 0; this.alive--; this.pid[k] = null; this.alpha[k] = 0; continue; }
      top = k + 1;
      if (u < 0) { this.alpha[k] = 0; continue; }
      const pv = this.pid[k] ? vis.get(this.pid[k]) : null;
      if (pv && !pv.gone) { const pp = pv.group.position; st[q + 6] = pp.x; st[q + 7] = pp.y; st[q + 8] = pp.z; }
      this._s.x = st[q]; this._s.y = st[q + 1]; this._s.z = st[q + 2];
      this._d.x = st[q + 3]; this._d.y = st[q + 4]; this._d.z = st[q + 5];
      this._p.x = st[q + 6]; this._p.y = st[q + 7]; this._p.z = st[q + 8];
      particlePos(this._o, u, this._s, this._d, st[q + 11], this._p);
      this.pos[k * 3] = this._o.x; this.pos[k * 3 + 1] = this._o.y; this.pos[k * 3 + 2] = this._o.z;
      this.alpha[k] = particleFade(u) * 0.95;
      this.size[k] = st[q + 15] * (1 - 0.6 * u);
      this.col[k * 3] = st[q + 12]; this.col[k * 3 + 1] = st[q + 13]; this.col[k * 3 + 2] = st[q + 14];
    }
    this._top = top;
    this.geo.setDrawRange(0, top);
    if (top) {
      const a = this.geo.attributes;
      a.position.needsUpdate = true; a.aAlpha.needsUpdate = true; a.aSize.needsUpdate = true; a.aColor.needsUpdate = true;
    }
  }

  dispose() { this.points.removeFromParent(); this.geo.dispose(); this.mat.dispose(); }
}
