// 공통 바닥 그리드(3ds Max 뷰포트 '홈 그리드' 풍) + 화면 구석 XYZ 축 기즈모
// 세 표현(Flow·Planet·복셀)이 같이 쓴다. 높이·칸·밝기만 표현별(env-core GROUND_TUNE).
// 가는 선(cell) · 10칸 굵은 주기선 · 100칸 더 굵은 선 · 원점 축선(X 빨강, 깊이축 초록). 선 굵기는 화면 픽셀 기준(fwidth)이라
// 원근에서도 1px 안팎, 셀이 몇 픽셀 안 되면 그 단계가 스스로 흐려진다(줌 단계 튐 없음). 보는 지점에서 멀어질수록 지수로 사라진다.
// 시간에 따라 움직이지 않는다(일시정지 얼림과 무관). 불투명 물체(복셀 바닥·건물)에는 깊이 검사로 가려진다.
import * as THREE from 'three';
import { groundTune, gridFade, gridGain } from './env-core.mjs';

const VS = `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS = `
uniform vec3 uColor; uniform vec3 uMajor; uniform vec3 uAxisX; uniform vec3 uAxisY; uniform vec3 uFocus;
uniform float uFade; uniform float uCell; uniform float uAlpha;
varying vec3 vW;
float gridLine(vec2 p, float cell, float w) {
  vec2 c = p / cell;
  vec2 d = max(fwidth(c), vec2(1e-5));
  vec2 g = abs(fract(c - 0.5) - 0.5) / d;
  float cov = 1.0 - min(min(g.x, g.y) / w, 1.0);
  float dens = max(d.x, d.y);
  return cov * (1.0 - smoothstep(0.12, 0.33, dens));
}
void main() {
  vec2 p = vW.xz;
  float l1 = gridLine(p, uCell, 0.9);
  float l10 = gridLine(p, uCell * 10.0, 1.15);
  float l100 = gridLine(p, uCell * 100.0, 1.35);
  vec2 dp = max(fwidth(p), vec2(1e-5));
  float ax = (1.0 - min(abs(p.y) / dp.y / 1.4, 1.0));
  float ay = (1.0 - min(abs(p.x) / dp.x / 1.4, 1.0));
  float a = max(l1 * 0.6, max(l10 * 0.8, l100 * 0.9));
  vec3 col = mix(uColor, uMajor, max(l10, l100));
  if (ax > 0.0) { col = mix(col, uAxisX, ax); a = max(a, ax * 0.9); }
  if (ay > 0.0) { col = mix(col, uAxisY, ay); a = max(a, ay * 0.9); }
  float fade = exp(-length(p - uFocus.xz) / uFade);
  gl_FragColor = vec4(col, a * fade * uAlpha);
}`;

const GIZMO_AXES = [['x', 1, 0, 0], ['y', 0, 0, -1], ['z', 0, 1, 0]];

export class GroundGrid {
  constructor(scene, container, mode = 'flow') {
    this.mode = mode;
    this.u = { uColor: { value: new THREE.Color() }, uMajor: { value: new THREE.Color() }, uAxisX: { value: new THREE.Color() }, uAxisY: { value: new THREE.Color() },
      uFocus: { value: new THREE.Vector3() }, uFade: { value: 160 }, uCell: { value: 2.5 }, uAlpha: { value: 0.4 } };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false }));
    this.mesh.rotation.x = -Math.PI / 2; this.mesh.renderOrder = -2; this.mesh.frustumCulled = false;
    this.mesh.name = 'ground-grid';
    scene.add(this.mesh);
    this.gizmo = makeGizmo(container);
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._d = new THREE.Vector3();
    this.applyTheme(false);
  }
  get y() { return this.mesh.position.y; }
  applyTheme(isLight) {
    const T = groundTune(this.mode, isLight);
    this.tune = T;
    this.mesh.position.y = T.y;
    this.u.uCell.value = T.cell;
    this.u.uColor.value.set(T.minor); this.u.uMajor.value.set(T.major);
    this.u.uAxisX.value.set(T.axisX); this.u.uAxisY.value.set(T.axisY);
    this.u.uAlpha.value = T.alpha;
    const b = T.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (this.mesh.material.blending !== b) { this.mesh.material.blending = b; this.mesh.material.needsUpdate = true; }
    if (this.gizmo) this.gizmo.el.dataset.theme = isLight ? 'light' : 'dark';
  }
  setVisible(on) { this.mesh.visible = !!on; if (this.gizmo) this.gizmo.el.hidden = !on; }
  /** 카메라 시선이 바닥과 만나는 점(페이드 중심)과 그 거리 */
  focusOf(camera, fallbackDist = 60, out = new THREE.Vector3()) {
    camera.getWorldDirection(this._d);
    const y = this.mesh.position.y;
    const cy = camera.position.y;
    let t = this._d.y < -0.05 ? (y - cy) / this._d.y : fallbackDist;
    t = Math.max(1, Math.min(t, fallbackDist * 4));
    out.copy(this._d).multiplyScalar(t).add(camera.position);
    return { point: out, dist: t };
  }
  update(camera, focusDist) {
    if (!this.mesh.visible) return;
    const f = this.focusOf(camera, focusDist || camera.position.length() || 60, this.u.uFocus.value);
    const d = focusDist || f.dist;
    this.u.uFade.value = gridFade(d);
    this.u.uAlpha.value = this.tune.alpha * gridGain(d, this.tune.gain);
    this._gizmo(camera);
  }
  /** 축 기즈모: 카메라 회전만 반영(X 빨강·Y 초록(깊이)·Z 파랑(위)) — three 의 +Y 가 3ds Max 의 Z, −Z 가 Max 의 Y */
  _gizmo(cam) {
    const g = this.gizmo; if (!g || g.el.hidden) return;
    this._q.copy(cam.quaternion).invert();
    const out = [];
    for (const [k, x, y, z] of GIZMO_AXES) { this._v.set(x, y, z).applyQuaternion(this._q); out.push([k, this._v.x, -this._v.y, this._v.z]); }
    const key = out.map((o) => o[1].toFixed(2) + o[2].toFixed(2)).join();
    if (key === g.key) return;
    g.key = key;
    out.sort((a, b) => a[3] - b[3]);
    for (const [k, sx, sy, sz] of out) {
      const ln = g.lines[k], tx = g.labels[k], R = 19;
      ln.setAttribute('x2', (sx * R).toFixed(1)); ln.setAttribute('y2', (sy * R).toFixed(1));
      ln.style.opacity = (0.55 + 0.45 * Math.max(0, sz)).toFixed(2);
      tx.setAttribute('x', (sx * (R + 6)).toFixed(1)); tx.setAttribute('y', (sy * (R + 6) + 3).toFixed(1));
      g.svg.appendChild(ln); g.svg.appendChild(tx);
    }
  }
  dispose() {
    this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose();
    if (this.gizmo) { this.gizmo.el.remove(); this.gizmo = null; }
  }
}

function makeGizmo(container) {
  if (typeof document === 'undefined' || !container) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElement('div');
  el.className = 'env-gizmo';
  el.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-32 -32 64 64');
  const lines = {}, labels = {};
  for (const [k] of GIZMO_AXES) {
    const ln = document.createElementNS(NS, 'line');
    ln.setAttribute('x1', '0'); ln.setAttribute('y1', '0'); ln.setAttribute('class', 'gz-' + k);
    const tx = document.createElementNS(NS, 'text');
    tx.setAttribute('class', 'gz-' + k); tx.setAttribute('text-anchor', 'middle'); tx.textContent = k.toUpperCase();
    lines[k] = ln; labels[k] = tx;
    svg.appendChild(ln); svg.appendChild(tx);
  }
  el.appendChild(svg);
  container.appendChild(el);
  return { el, svg, lines, labels, key: '' };
}
