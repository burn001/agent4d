// Planet 3D 서브에이전트·claude -p 시안 궤도계 — 노드마다 작은 본체(v.mesh) + 시안 궤도계.
//  서브 6종: belt 깎인 바위 띠 · crystal 결정 파편 왕관 · drones 드론 편대 · station 궤도 정거장 · solar 접이식 날개 위성 · arcs 흩어진 고리 조각
//  claude -p 4종: pocket 주머니 항성계 · capsule 도킹 캡슐 · wormhole 웜홀 창 · cassette 회차 카세트(그 노드 자신의 도구 호출 회차)
// 성능: 부품은 시안·모양별 InstancedMesh 하나씩을 장면 전체가 나눠 쓴다(노드마다 메시·재질을 만들지 않음, 재질 공유).
//  궤도선은 인스턴스 선(InstancedBufferGeometry LineLoop) 하나, 웜홀 소용돌이 입자는 정점 셰이더가 옮기는 인스턴스 점 하나.
//  거리 LOD(variantLod): 멀면 작은 본체 + 윤곽 고리 하나만, 가까워질수록 부품 수·창 불빛·잔조각·입자 수를 늘린다.
// 상태(VAR_STATE): 작업 중 = 빨라지고 밝아짐 + 시안 발사점에서 연결선 쪽 도구 입자(OrbitSparks) · 대기 = 느리고 어두움 ·
//  완료 = 정리 자세(바위 한 줄 고리·왕관·도킹·날개 접기·고리 맞물림·행성 정렬·캡슐 도킹·세 갈래 나선·카드 쌓기) · 오류 = 붉은 맥동 · 중지됨 = 멈춘 회색.
// 색: 노드 색(종류·세션·상태) 기반, 라이트 테마의 빛 부품·궤도선은 곱하기 잉크, 투명도 = 몸체 재질(퇴장· 선택 페이드가 곱해진 값).
import * as THREE from 'three';
import { VAR_STATE, VARIANT_CORE, VARIANT_SKIN, variantLod, approach, hash01, settleK, SETTLE_S, cassetteModel, CASSETTE_N } from './planet-core.mjs';
import { seeded } from './planet-orbits.js';

const TAU = Math.PI * 2;
const V3 = THREE.Vector3, Q = THREE.Quaternion, M4 = THREE.Matrix4;
const UP = new V3(0, 1, 0), IDQ = new Q();
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
/** 케플러 근사(이심 궤도 위 참 근점 이각) */
function kepTh(M, e) { const E = M + e * Math.sin(M) + e * e * 0.5 * Math.sin(2 * M); return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)); }
function kepPos(a, e, M, out) { const th = kepTh(M, e); const r = (a * (1 - e * e)) / (1 + e * Math.cos(th)); return out.set(r * Math.cos(th), 0, r * Math.sin(th)); }

// ---------------- 공용 지오메트리(모듈에 한 번) ----------------
/** 지오메트리 여러 개를 행렬로 옮겨 한 지오메트리로(위치·법선만) */
function mergeGeos(list) {
  const parts = list.map(([g, m]) => { const n = (g.index ? g.toNonIndexed() : g.clone()); n.applyMatrix4(m); return n; });
  let len = 0; for (const p of parts) len += p.attributes.position.array.length;
  const pos = new Float32Array(len), nor = new Float32Array(len);
  let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o); nor.set(p.attributes.normal.array, o); o += p.attributes.position.array.length; p.dispose(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  return g;
}
const mat4 = (p, e, s) => new M4().compose(new V3(...(p || [0, 0, 0])), new Q().setFromEuler(new THREE.Euler(...(e || [0, 0, 0]))), new V3(...(s || [1, 1, 1])));
function rockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 0); const p = g.attributes.position; const r = seeded(seed); const map = {};
  for (let i = 0; i < p.count; i++) {
    const key = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
    if (!(key in map)) map[key] = 0.68 + 0.6 * r();
    const k = map[key]; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals(); return g;
}
let G = null;
/** 시안 치수(본체 반지름 = 1). 정거장·웜홀·카세트는 시안보다 조금 키워 궤도계 바깥을 지금과 비슷하게 */
export const VDIM = { station: 1.2, wormhole: 1.35, cassette: 1.2, pocket: 2.05 };
const ARC_L = [
  { r: 1.15, n: 3, w: 0.085, tilt: [0.25, 0, 0.1], sp: 0.55, dir: 1, l: 0.15 },
  { r: 1.62, n: 4, w: 0.05, tilt: [-0.5, 0.8, 0], sp: 0.36, dir: -1, l: 0.4 },
  { r: 2.12, n: 5, w: 0.08, tilt: [0.72, 2.1, 0.2], sp: 0.24, dir: 1, l: 0.6 },
];
function geo() {
  if (G) return G;
  G = {
    rock: rockGeo(0.137), octa: new THREE.OctahedronGeometry(1, 0), tetra: new THREE.TetrahedronGeometry(1, 0), box: new THREE.BoxGeometry(1, 1, 1),
    cyl8: new THREE.CylinderGeometry(1, 1, 1, 8), dish: new THREE.ConeGeometry(1, 1, 12, 1, true), sphere: new THREE.SphereGeometry(1, 14, 10),
    ico: new THREE.IcosahedronGeometry(1, 0), bubble: new THREE.SphereGeometry(1, 28, 18), quad: new THREE.PlaneGeometry(2, 2),
    torus: new THREE.TorusGeometry(1, 0.045, 10, 64).rotateX(Math.PI / 2), thinTorus: new THREE.TorusGeometry(1, 0.03, 6, 48).rotateX(Math.PI / 2),
  };
  // 작은 본체(코어): v.mesh 의 지오메트리를 바꿔 쓴다(크기 = VARIANT_CORE 를 지오메트리에 굽고 mesh.scale = 본체 반지름 그대로)
  G.core = {
    belt: new THREE.DodecahedronGeometry(VARIANT_CORE.belt, 0), crystal: new THREE.OctahedronGeometry(VARIANT_CORE.crystal, 0),
    drones: new THREE.SphereGeometry(VARIANT_CORE.drones, 22, 14), station: new THREE.SphereGeometry(VARIANT_CORE.station, 22, 14),
    solar: new THREE.SphereGeometry(VARIANT_CORE.solar, 22, 14), arcs: new THREE.SphereGeometry(VARIANT_CORE.arcs, 22, 14),
    pocket: new THREE.SphereGeometry(VARIANT_CORE.pocket, 20, 12),
    capsule: new THREE.BoxGeometry(1.45 * VARIANT_CORE.capsule, 1.45 * VARIANT_CORE.capsule, 1.45 * VARIANT_CORE.capsule),
    wormhole: new THREE.BoxGeometry(1.45 * VARIANT_CORE.wormhole, 1.45 * VARIANT_CORE.wormhole, 1.45 * VARIANT_CORE.wormhole),
    cassette: new THREE.BoxGeometry(1.45 * VARIANT_CORE.cassette, 1.45 * VARIANT_CORE.cassette, 1.45 * VARIANT_CORE.cassette),
  };
  G.coreEdges = {};
  for (const k of ['capsule', 'wormhole', 'cassette']) G.coreEdges[k] = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.45 * VARIANT_CORE[k] * 1.04, 1.45 * VARIANT_CORE[k] * 1.04, 1.45 * VARIANT_CORE[k] * 1.04));
  // 정거장 뼈대: 허브 깃 + 큰 고리 + 바퀴살 셋(한 지오메트리)
  const fr = [[new THREE.TorusGeometry(0.47, 0.03, 8, 40), mat4(0, [Math.PI / 2, 0, 0])], [new THREE.TorusGeometry(1.55, 0.022, 6, 120), mat4(0, [Math.PI / 2, 0, 0])]];
  for (let k = 0; k < 3; k++) { const a = (k * TAU) / 3; fr.push([new THREE.CylinderGeometry(0.012, 0.012, 1.06, 6), new M4().makeRotationY(-a).multiply(mat4([1.01, 0, 0], [0, 0, Math.PI / 2]))]); }
  G.frame = mergeGeos(fr);
  // 도킹 캡슐(회전체 몸통 + 깃 + 분사 종) · 짐벌 받침대(기운 반고리 둘 + 받침 고리)
  const prof = [[0, -0.35], [0.12, -0.335], [0.18, -0.27], [0.2, -0.15], [0.2, 0.18], [0.17, 0.28], [0.1, 0.35], [0, 0.37]].map((p) => new THREE.Vector2(p[0], p[1]));
  G.capsule = mergeGeos([
    [new THREE.LatheGeometry(prof, 18), mat4(0, [Math.PI / 2, 0, 0])],
    [new THREE.TorusGeometry(0.15, 0.025, 6, 20), mat4([0, 0, 0.36])],
    [new THREE.ConeGeometry(0.1, 0.12, 12, 1, true), mat4([0, 0, -0.4], [-Math.PI / 2, 0, 0])],
  ]);
  G.gimbal = mergeGeos([
    [new THREE.TorusGeometry(0.5, 0.025, 8, 40, Math.PI * 1.35), mat4(0, [0, 0, -0.5])],
    [new THREE.TorusGeometry(0.5, 0.025, 8, 40, Math.PI * 1.35), mat4(0, [0, Math.PI / 2, 2.2])],
    [new THREE.TorusGeometry(0.5, 0.018, 6, 40), mat4(0, [Math.PI / 2, 0, 0])],
  ]);
  G.arcs = ARC_L.map((L) => new THREE.RingGeometry(L.r - L.w, L.r + L.w, 28, 1, 0, (TAU / L.n) * 0.92).rotateX(-Math.PI / 2));
  return G;
}

// ---------------- 공용 재질 ----------------
// 표준 재질 + 인스턴스 발광·투명도(iEO = 발광 rgb · 투명도 a) — 색은 instanceColor
function stdMat(opts, key) {
  const m = new THREE.MeshStandardMaterial({ transparent: true, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 iEO; varying vec4 vEO;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvEO = iEO;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vEO;')
      .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= vEO.a;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vEO.rgb;');
  };
  m.customProgramCacheKey = () => 'pvar-std-' + key;
  return m;
}
// 빛 부품(창 불빛·표시등·진행 막대·코로나): 다크 = 더하기, 라이트 = 곱하기 잉크 — 인스턴스 색 iCol(rgb, 세기 a)
const GLOW_V = /* glsl */`attribute vec4 iCol; varying vec4 vC; varying vec2 vUv;
void main() { vC = iCol; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;
const GLOW_F = /* glsl */`uniform float uLight, uRadial; varying vec4 vC; varying vec2 vUv;
void main() {
  float a = vC.a;
  if (uRadial > 0.5) { float d = length(vUv - 0.5) * 2.0; a *= pow(max(0.0, 1.0 - d), 2.2); }
  if (a < 0.004) discard;
  if (uLight > 0.5) gl_FragColor = vec4(mix(vec3(1.0), vC.rgb, clamp(a, 0.0, 1.0)), 1.0);
  else gl_FragColor = vec4(vC.rgb, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;
// 유리 거품(프레넬 테두리)
const FRES_V = /* glsl */`attribute vec4 iCol; varying vec4 vC; varying vec3 vN; varying vec3 vV;
void main() { vC = iCol; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * mat3(instanceMatrix) * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const FRES_F = /* glsl */`uniform float uLight; varying vec4 vC; varying vec3 vN; varying vec3 vV;
void main() { float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6); float a = f * vC.a; if (a < 0.004) discard;
  if (uLight > 0.5) gl_FragColor = vec4(mix(vec3(1.0), vC.rgb, clamp(a, 0.0, 1.0)), 1.0); else gl_FragColor = vec4(vC.rgb, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;
// 인스턴스 궤도선: 단위 원(u = 둘레 0..1) → 이심률 e 의 타원, 행렬 = 노드 기준 기울기·긴반지름. 무늬 solid 0·dash 1·arcs 2·dots 3,
// 머리(위성) 뒤 잔광(iP.w = 머리 u, iK.w = 잔광 길이)
const LINE_N = 120;
const LINE_V = /* glsl */`attribute float u; attribute vec4 iM0, iM1, iM2, iM3, iP, iK; attribute float iS;
varying float vU; varying vec4 vP; varying vec4 vK; varying float vS;
void main() { float th = u * 6.2831853; float e = iP.x; float r = (1.0 - e * e) / (1.0 + e * cos(th));
  mat4 M = mat4(iM0, iM1, iM2, iM3); vU = u; vP = iP; vK = iK; vS = iS;
  gl_Position = projectionMatrix * viewMatrix * M * vec4(r * cos(th), 0.0, r * sin(th), 1.0); }`;
const LINE_F = /* glsl */`uniform float uLight; varying float vU; varying vec4 vP; varying vec4 vK; varying float vS;
void main() {
  float u = fract(vU + vS), st = vP.y;
  if (st > 0.5 && st < 1.5 && fract(u * 48.0) > 0.55) discard;
  if (st > 1.5 && st < 2.5 && fract(u * 5.0) > 0.62) discard;
  if (st > 2.5 && fract(u * 80.0) > 0.32) discard;
  float a = vP.z, g = 0.0;
  if (vP.w >= 0.0 && vK.w > 0.0) { float d = fract(vP.w - vU); g = d < vK.w ? pow(1.0 - d / vK.w, 2.0) : 0.0; }
  a = clamp(a + g * 0.85 * min(1.0, vP.z * 4.0), 0.0, 1.0);
  if (a < 0.004) discard;
  if (uLight > 0.5) gl_FragColor = vec4(mix(vec3(1.0), vK.rgb, a), 1.0); else gl_FragColor = vec4(vK.rgb, a);
  #include <colorspace_fragment>
}`;
// 웜홀 소용돌이 입자: 점마다 (반지름 시드·각 시드·속도·순번), 인스턴스 = 고리 틀 행렬 + (위상·정리·오류·밝기) + 색·투명도·보일 비율
const VORT_N = 200;
const VORT_V = /* glsl */`attribute vec4 p; attribute vec4 iM0, iM1, iM2, iM3, iV, iK; attribute float iN; uniform float uPx;
varying vec3 vC; varying float vA;
float h(float x) { return fract(sin(x * 91.17) * 43758.5453); }
void main() {
  if (p.w > iN) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vC = vec3(0.0); return; }
  float ph = iV.x, tidy = iV.y, err = iV.z, br = iV.w;
  float t = fract(p.x + ph * 0.05 * p.z * (1.0 - tidy * 0.9));
  float rr = 0.93 - 0.81 * t;
  float a = p.y + ph * 0.55 * (1.1 / (rr + 0.15));
  float arm = floor((a - rr * 2.2) / 2.0943951 + 0.5) * 2.0943951 + rr * 2.2;
  a = mix(a, arm, tidy * 0.85);
  rr += (h(p.y * 7.0 + floor(ph * 9.0)) - 0.5) * 0.08 * err;
  float z = -(0.95 - rr) * 0.62 * (1.0 - tidy * 0.85);
  mat4 M = mat4(iM0, iM1, iM2, iM3);
  vec4 mv = viewMatrix * M * vec4(cos(a) * rr, z, sin(a) * rr, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uPx / -mv.z, 1.0, 4.0);
  vec3 inner = vec3(0.77, 0.71, 0.99);
  vC = mix(mix(inner, iK.rgb, clamp(rr / 0.9, 0.0, 1.0)), vec3(1.0, 0.23, 0.23), err * 0.7);
  vA = iK.a * (0.25 + 0.75 * br) * (0.4 + 0.6 * t);
}`;
const VORT_F = /* glsl */`uniform float uLight; varying vec3 vC; varying float vA;
void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25 || vA < 0.004) discard; float a = vA * (1.0 - d * 3.0);
  if (uLight > 0.5) gl_FragColor = vec4(mix(vec3(1.0), vC * 0.6, clamp(a, 0.0, 1.0)), 1.0); else gl_FragColor = vec4(vC, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;
// 직선 토막(웜홀 출구 연결 점선): 인스턴스 = 두 끝 + 색·투명도
const SEG_V = /* glsl */`attribute float u; attribute vec3 iA, iB; attribute vec4 iK; varying float vU; varying vec4 vK; varying float vL;
void main() { vU = u; vK = iK; vL = length(iB - iA); gl_Position = projectionMatrix * viewMatrix * vec4(mix(iA, iB, u), 1.0); }`;
const SEG_F = /* glsl */`uniform float uLight; varying float vU; varying vec4 vK; varying float vL;
void main() { if (fract(vU * vL * 6.0) > 0.5) discard; float a = vK.a; if (a < 0.004) discard;
  if (uLight > 0.5) gl_FragColor = vec4(mix(vec3(1.0), vK.rgb, a), 1.0); else gl_FragColor = vec4(vK.rgb, a);
  #include <colorspace_fragment>
}`;

const _c = new THREE.Color(), _e = new THREE.Color(), _w = new THREE.Color(), _k = new THREE.Color();

/** 장면 공용 인스턴스 부품 하나(InstancedMesh). kind 'std' = 색 + 발광·투명도, 'glow' = 색·세기 */
class Part {
  constructor(scene, geometry, mat, kind, cap = 128, order = 0) {
    const g = new THREE.BufferGeometry();
    g.setIndex(geometry.index);
    for (const k in geometry.attributes) g.setAttribute(k, geometry.attributes[k]);
    g.boundingSphere = new THREE.Sphere(new V3(), 1e9);
    this.kind = kind; this.g = g; this.cap = 0;
    this.im = new THREE.InstancedMesh(g, mat, 1);
    this.im.frustumCulled = false; this.im.raycast = () => {}; this.im.renderOrder = order;
    this._alloc(cap);
    this.n = 0; this.used = 0;
    scene.add(this.im);
  }
  _alloc(cap) {
    const old = this.cap ? { m: this.im.instanceMatrix.array, a: this.attr.array, c: this.im.instanceColor && this.im.instanceColor.array } : null;
    this.cap = cap;
    this.im.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16).setUsage(THREE.DynamicDrawUsage);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.g.setAttribute(this.kind === 'std' ? 'iEO' : 'iCol', this.attr);
    if (this.kind === 'std') this.im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    if (old) { this.im.instanceMatrix.array.set(old.m); this.attr.array.set(old.a); if (old.c) this.im.instanceColor.array.set(old.c); }
  }
  begin() { this.n = 0; }
  /** std: 행렬 W, 색 c, 발광 e, 투명도 a */
  put(W, c, e, a) {
    if (this.n >= this.cap) { if (this.cap >= 65536) return; this._alloc(this.cap * 2); }
    const i = this.n++;
    W.toArray(this.im.instanceMatrix.array, i * 16);
    const A = this.attr.array, o = i * 4;
    if (this.kind === 'std') { const C = this.im.instanceColor.array, q = i * 3; C[q] = c.r; C[q + 1] = c.g; C[q + 2] = c.b; A[o] = e.r; A[o + 1] = e.g; A[o + 2] = e.b; A[o + 3] = a; }
    else { A[o] = c.r; A[o + 1] = c.g; A[o + 2] = c.b; A[o + 3] = a; }
  }
  end() {
    const im = this.im;
    im.count = this.n;
    im.visible = this.n > 0;
    if (this.n) { im.instanceMatrix.needsUpdate = true; this.attr.needsUpdate = true; if (im.instanceColor && this.kind === 'std') im.instanceColor.needsUpdate = true; }
    this.used = this.n;
  }
  dispose() { this.im.removeFromParent(); this.im.dispose(); }
}

/** 인스턴스 선·점(InstancedBufferGeometry) — 궤도선(LineLoop)·소용돌이(Points)·토막(LineSegments) */
class InstField {
  constructor(scene, base, defs, mat, Ctor, order = 1) {
    const g = new THREE.InstancedBufferGeometry();
    for (const k in base) g.setAttribute(k, base[k]);
    g.boundingSphere = new THREE.Sphere(new V3(), 1e9);
    this.g = g; this.defs = defs; this.cap = 0; this.n = 0;
    this.obj = new Ctor(g, mat);
    this.obj.frustumCulled = false; this.obj.raycast = () => {}; this.obj.renderOrder = order;
    this._alloc(64);
    scene.add(this.obj);
  }
  _alloc(cap) {
    const old = this.cap ? this.defs.map(([k]) => this.g.attributes[k].array) : null;
    this.cap = cap;
    this.defs.forEach(([k, n], j) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
      if (old) a.array.set(old[j]);
      this.g.setAttribute(k, a);
    });
    this.A = this.defs.map(([k]) => this.g.attributes[k].array);
    this.g._maxInstanceCount = cap; // three 가 처음 묶을 때 정한 상한을 늘린 크기로
  }
  begin() { this.n = 0; }
  /** 새 인스턴스 번호(가득 차면 늘림) — 값은 호출한 쪽이 this.A[j] 에 쓴다 */
  add() { if (this.n >= this.cap) { if (this.cap >= 32768) return -1; this._alloc(this.cap * 2); } return this.n++; }
  end() {
    this.g.instanceCount = this.n;
    this.obj.visible = this.n > 0;
    if (this.n) for (const [k] of this.defs) this.g.attributes[k].needsUpdate = true;
  }
  dispose() { this.obj.removeFromParent(); this.g.dispose(); this.obj.material.dispose(); }
}

const _L = new M4(), _W = new M4(), _T = new M4(), _R = new M4(), _PV = new M4(), _p = new V3(), _p2 = new V3(), _p3 = new V3(), _q = new Q(), _q2 = new Q(), _s = new V3(), _eu = new THREE.Euler();
const ONE = new V3(1, 1, 1);

/** 장면 전체 시안 부품 묶음(PlanetDeco 가 하나 가짐). 프레임마다 begin → 노드마다 step → end */
export class VariantField {
  constructor(scene) {
    const g = geo();
    this.scene = scene;
    this.mats = {
      flat: stdMat({ flatShading: true, roughness: 0.88, metalness: 0.08 }, 'flat'),
      metal: stdMat({ roughness: 0.36, metalness: 0.65 }, 'metal'),
      smooth: stdMat({ roughness: 0.5, metalness: 0.3 }, 'smooth'),
      shard: stdMat({ flatShading: true, roughness: 0.14, metalness: 0.28 }, 'shard'),
      arc: stdMat({ roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide }, 'arc'),
      glow: new THREE.ShaderMaterial({ uniforms: { uLight: { value: 0 }, uRadial: { value: 0 } }, vertexShader: GLOW_V, fragmentShader: GLOW_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      halo: new THREE.ShaderMaterial({ uniforms: { uLight: { value: 0 }, uRadial: { value: 1 } }, vertexShader: GLOW_V, fragmentShader: GLOW_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      fres: new THREE.ShaderMaterial({ uniforms: { uLight: { value: 0 } }, vertexShader: FRES_V, fragmentShader: FRES_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    };
    const M = this.mats;
    const P = (geom, mat, kind, cap, order) => new Part(scene, geom, mat, kind, cap, order);
    this.p = {
      rock: P(g.rock, M.flat, 'std', 1024), shard: P(g.octa, M.shard, 'std', 256), tetra: P(g.tetra, M.flat, 'std', 256),
      box: P(g.box, M.smooth, 'std', 256), mbox: P(g.box, M.metal, 'std', 256), cyl: P(g.cyl8, M.metal, 'std', 64), dish: P(g.dish, M.metal, 'std', 64),
      frame: P(g.frame, M.metal, 'std', 32), band: P(g.thinTorus, M.smooth, 'std', 64), torus: P(g.torus, M.metal, 'std', 64),
      capsule: P(g.capsule, M.smooth, 'std', 32), gimbal: P(g.gimbal, M.metal, 'std', 32), planet: P(g.ico, M.flat, 'std', 128),
      arc0: P(g.arcs[0], M.arc, 'std', 64), arc1: P(g.arcs[1], M.arc, 'std', 64), arc2: P(g.arcs[2], M.arc, 'std', 64),
      gbox: P(g.box, M.glow, 'glow', 256, 2), gsph: P(g.sphere, M.glow, 'glow', 128, 2), halo: P(g.quad, M.halo, 'glow', 64, 2),
      bubble: P(g.bubble, M.fres, 'glow', 32, 2),
    };
    this.arcParts = [this.p.arc0, this.p.arc1, this.p.arc2];
    // 궤도선
    const u = new Float32Array(LINE_N), pos = new Float32Array(LINE_N * 3);
    for (let i = 0; i < LINE_N; i++) u[i] = i / LINE_N;
    const lineMat = new THREE.ShaderMaterial({ uniforms: { uLight: { value: 0 } }, vertexShader: LINE_V, fragmentShader: LINE_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.lines = new InstField(scene, { position: new THREE.BufferAttribute(pos, 3), u: new THREE.BufferAttribute(u, 1) },
      [['iM0', 4], ['iM1', 4], ['iM2', 4], ['iM3', 4], ['iP', 4], ['iK', 4], ['iS', 1]], lineMat, THREE.LineLoop, 1);
    // 웜홀 소용돌이
    const rnd = seeded(0.731), pp = new Float32Array(VORT_N * 4), vpos = new Float32Array(VORT_N * 3);
    for (let i = 0; i < VORT_N; i++) { pp[i * 4] = rnd(); pp[i * 4 + 1] = rnd() * TAU; pp[i * 4 + 2] = 0.7 + rnd() * 0.6; pp[i * 4 + 3] = (i + 0.5) / VORT_N; }
    const vortMat = new THREE.ShaderMaterial({ uniforms: { uLight: { value: 0 }, uPx: { value: 30 } }, vertexShader: VORT_V, fragmentShader: VORT_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.vort = new InstField(scene, { position: new THREE.BufferAttribute(vpos, 3), p: new THREE.BufferAttribute(pp, 4) },
      [['iM0', 4], ['iM1', 4], ['iM2', 4], ['iM3', 4], ['iV', 4], ['iK', 4], ['iN', 1]], vortMat, THREE.Points, 2);
    // 토막 점선
    const su = new Float32Array([0, 1]), spos = new Float32Array(6);
    const segMat = new THREE.ShaderMaterial({ uniforms: { uLight: { value: 0 } }, vertexShader: SEG_V, fragmentShader: SEG_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.segs = new InstField(scene, { position: new THREE.BufferAttribute(spos, 3), u: new THREE.BufferAttribute(su, 1) }, [['iA', 3], ['iB', 3], ['iK', 4]], segMat, THREE.LineSegments, 1);
    this.light = null;
    this.setLight(false);
  }
  /** 라이트 테마: 빛 부품·궤도선·거품·입자는 곱하기 잉크, 다크는 더하기 */
  setLight(L) {
    if (this.light === L) return;
    this.light = L;
    const mats = [this.mats.glow, this.mats.halo, this.mats.fres, this.lines.obj.material, this.vort.obj.material, this.segs.obj.material];
    for (const m of mats) {
      m.uniforms.uLight.value = L ? 1 : 0;
      m.blending = L ? THREE.MultiplyBlending : THREE.AdditiveBlending;
      m.premultipliedAlpha = !!L;
      m.needsUpdate = true;
    }
  }
  begin(cam, pxK, dpr) {
    for (const k in this.p) this.p[k].begin();
    this.lines.begin(); this.vort.begin(); this.segs.begin();
    this.cam = cam;
    this.vort.obj.material.uniforms.uPx.value = pxK * 0.05 * dpr;
    this.calls = 0;
  }
  end() {
    for (const k in this.p) this.p[k].end();
    this.lines.end(); this.vort.end(); this.segs.end();
  }
  /** 부품 하나: 노드 기준 B(세계 = 노드 묶음 × 본체 반지름)에 지역 행렬 L */
  put(part, B, L, c, e, a) { _W.multiplyMatrices(B, L); part.put(_W, c, e, a); }
  putG(part, B, L, c, a) { _W.multiplyMatrices(B, L); part.put(_W, c, null, a); }
  /** 궤도선: 노드 기준 B · 지역 회전 q · 긴반지름 a · 이심률 e · 무늬 · 알파 · 색 · 머리 u(-1 없음) · 잔광 길이 · 무늬 밀림 */
  line(B, q, a, e, style, alpha, c, head = -1, trail = 0, shift = 0) {
    if (!(alpha > 0.004)) return;
    const i = this.lines.add(); if (i < 0) return;
    _L.compose(_p3.set(0, 0, 0), q, _s.set(a, a, a));
    _W.multiplyMatrices(B, _L);
    const A = this.lines.A, m = _W.elements;
    for (let j = 0; j < 4; j++) { A[j][i * 4] = m[j * 4]; A[j][i * 4 + 1] = m[j * 4 + 1]; A[j][i * 4 + 2] = m[j * 4 + 2]; A[j][i * 4 + 3] = m[j * 4 + 3]; }
    A[4][i * 4] = e; A[4][i * 4 + 1] = style; A[4][i * 4 + 2] = Math.min(1, alpha); A[4][i * 4 + 3] = head;
    A[5][i * 4] = c.r; A[5][i * 4 + 1] = c.g; A[5][i * 4 + 2] = c.b; A[5][i * 4 + 3] = trail;
    A[6][i] = shift;
  }
  seg(a, b, c, alpha) {
    if (!(alpha > 0.004)) return;
    const i = this.segs.add(); if (i < 0) return;
    const A = this.segs.A;
    A[0][i * 3] = a.x; A[0][i * 3 + 1] = a.y; A[0][i * 3 + 2] = a.z; A[1][i * 3] = b.x; A[1][i * 3 + 1] = b.y; A[1][i * 3 + 2] = b.z;
    A[2][i * 4] = c.r; A[2][i * 4 + 1] = c.g; A[2][i * 4 + 2] = c.b; A[2][i * 4 + 3] = Math.min(1, alpha);
  }
  vortex(W, ph, S, c, op, frac) {
    const i = this.vort.add(); if (i < 0) return;
    const A = this.vort.A, m = W.elements;
    for (let j = 0; j < 4; j++) { A[j][i * 4] = m[j * 4]; A[j][i * 4 + 1] = m[j * 4 + 1]; A[j][i * 4 + 2] = m[j * 4 + 2]; A[j][i * 4 + 3] = m[j * 4 + 3]; }
    A[4][i * 4] = ph; A[4][i * 4 + 1] = S.tidy; A[4][i * 4 + 2] = S.err; A[4][i * 4 + 3] = S.bright;
    A[5][i * 4] = c.r; A[5][i * 4 + 1] = c.g; A[5][i * 4 + 2] = c.b; A[5][i * 4 + 3] = op;
    A[6][i] = frac;
  }
  stats() { let inst = 0, calls = 0; for (const k in this.p) { const u = this.p[k].used; inst += u; if (u) calls++; } return { inst, calls: calls + (this.lines.n ? 1 : 0) + (this.vort.n ? 1 : 0) + (this.segs.n ? 1 : 0), lines: this.lines.n }; }
  dispose() {
    for (const k in this.p) this.p[k].dispose();
    this.lines.dispose(); this.vort.dispose(); this.segs.dispose();
    for (const k in this.mats) this.mats[k].dispose();
  }
}

// ---------------- 노드마다: 시안 자료(id 시드로 한 번) ----------------
const _sph = new THREE.Sphere(), _ip = new V3();
/** 클릭 판정: 작아진 본체 대신 예전 본체 크기의 구(궤도계 안쪽을 눌러도 노드가 집힘) */
function pickSphere(raycaster, out) {
  this.getWorldPosition(_sph.center);
  _sph.radius = this.matrixWorld.getMaxScaleOnAxis() * 1.05;
  if (raycaster.ray.intersectSphere(_sph, _ip)) out.push({ distance: raycaster.ray.origin.distanceTo(_ip), point: _ip.clone(), object: this });
}

/** 노드 v 를 시안 name 으로 꾸밀 준비: 본체 지오메트리를 작은 코어로, 질감, 클릭 판정, claude -p 모서리 선 */
export function makeVariant(v, name, injectSkin) {
  const g = geo();
  const d = { name, S: { ...VAR_STATE.wait }, ph: hash01(v.id, 'vph') * 20, mt: hash01(v.id, 'vmt') * 30, emL: new Float32Array(12), emN: 0, yaw: hash01(v.id, 'vyaw') * TAU, mode: null, settleAt: -1, tape: null };
  d.origGeo = v.mesh.geometry;
  v.mesh.geometry = g.core[name];
  d.origRay = v.mesh.raycast;
  v.mesh.raycast = pickSphere;
  const fam = VARIANT_SKIN[name] ? 'sub' : 'cp';
  if (fam === 'sub' && injectSkin) { d.U = injectSkin(v.mat, VARIANT_SKIN[name]); v.mat.flatShading = name === 'belt' || name === 'crystal'; v.mat.needsUpdate = true; }
  if (v.extras.edges) {
    d.origEdges = v.extras.edges.geometry;
    if (g.coreEdges[name]) v.extras.edges.geometry = g.coreEdges[name];
    else v.extras.edges.visible = false;
  }
  const r = seeded(hash01(v.id, 'vd'));
  // 시안별 고정 자료(시안 페이지 DESIGNS.* 와 같은 모양)
  if (name === 'belt') {
    d.rocks = [];
    for (let i = 0; i < 53; i++) {
      const inner = r() < 0.42, rr = inner ? lerp(1.08, 1.42, r()) : lerp(1.72, 2.32, r());
      d.rocks.push({ r: rr, a: r() * TAU, y: (r() - 0.5) * 0.24, s: 0.05 + 0.11 * r() * r() + (i >= 46 ? 0.03 : 0), sx: 0.65 + 0.6 * r(), sy: 0.6 + 0.5 * r(), sz: 0.7 + 0.6 * r(), ax: new V3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), sp: 0.4 + r() * 1.6, q0: new Q().setFromEuler(new THREE.Euler(r() * TAU, r() * TAU, r() * TAU)), ring: inner ? 1.45 : 1.85 });
    }
    // 광석(46..52)을 섞어 LOD 로 줄여도 광석이 남게: 순서 = 광석 1 · 바위 6 반복
    const ore = d.rocks.slice(46), rock = d.rocks.slice(0, 46), mix = [];
    while (ore.length || rock.length) { if (ore.length) mix.push(ore.shift()); for (let k = 0; k < 6 && rock.length; k++) mix.push(rock.shift()); }
    d.rocks = mix.map((x, i) => ({ ...x, ore: i % 7 === 0 }));
    d.tilt = new Q().setFromEuler(new THREE.Euler(0.38, d.yaw, 0.18, 'YXZ'));
  } else if (name === 'crystal') {
    d.rings = [{ n: 7, r: 1.35, q: new Q().setFromEuler(new THREE.Euler(0.32, d.yaw, 0.12, 'YXZ')), w: 0.5, dir: 1 }, { n: 5, r: 2.0, q: new Q().setFromEuler(new THREE.Euler(-0.42, 0.9 + d.yaw, 0, 'YXZ')), w: 0.32, dir: -1 }];
    d.sd = []; d.rings.forEach((R, ri) => { for (let k = 0; k < R.n; k++) d.sd.push({ R, a0: (k / R.n) * TAU + r() * 0.3, size: 0.8 + 0.45 * r(), spin: 0.4 + r(), wob: (r() - 0.5) * 0.5, ri }); });
    d.fd = []; for (let i = 0; i < 18; i++) d.fd.push({ r: lerp(1.5, 2.45, r()), a: r() * TAU, y: (r() - 0.5) * 0.5, w: 0.25 + 0.3 * r(), q0: new Q().setFromEuler(new THREE.Euler(r() * 6, r() * 6, r() * 6)), ax: new V3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), s: 0.025 + 0.03 * r() });
  } else if (name === 'drones') {
    d.orbits = [{ r: 1.55, q: new Q().setFromEuler(new THREE.Euler(0.7, d.yaw, 0.2, 'YXZ')), w: 0.9 }, { r: 2.05, q: new Q().setFromEuler(new THREE.Euler(-0.55, 1.1 + d.yaw, 0, 'YXZ')), w: 0.62 }];
    d.drones = [0, 1, 2, 3].map((i) => { const da = (i * Math.PI) / 2 + 0.4; return { o: d.orbits[i >> 1], off: (i % 2) * Math.PI, dock: new V3(Math.cos(da) * 0.6, 0, Math.sin(da) * 0.6) }; });
  } else if (name === 'station') {
    d.tilt = new Q().setFromEuler(new THREE.Euler(0.55, d.yaw, 0.3, 'YXZ'));
  } else if (name === 'solar') {
    d.sats = [{ a: 1.45, e: [0.3, 0, 0.1], w: 0.9, M0: 0 }, { a: 1.92, e: [-0.5, 1.2, 0], w: 0.62, M0: 2 }, { a: 2.35, e: [0.9, 2.3, 0.2], w: 0.45, M0: 4 }]
      .map((s) => ({ ...s, q: new Q().setFromEuler(new THREE.Euler(s.e[0], s.e[1] + d.yaw, s.e[2], 'YXZ')) }));
    d.sun = new Q().setFromUnitVectors(UP, new V3(4, 5, 3).normalize());
  } else if (name === 'arcs') {
    d.parts = [];
    ARC_L.forEach((L, li) => { for (let k = 0; k < L.n; k++) { const me = ((TAU / L.n) * 0.92) / 2, ee = (TAU / L.n) * 0.92 * 0.98; d.parts.push({ li, k, mid: new V3(Math.cos(me), 0, -Math.sin(me)), end: new V3(Math.cos(ee) * L.r, 0, -Math.sin(ee) * L.r), dy: (r() - 0.5) * 0.75, dr: (r() - 0.5) * 0.4, tl: (r() - 0.5) * 0.7, cs: 0.05 + 0.04 * r() }); } });
  } else if (name === 'pocket') {
    d.plane = new Q().setFromEuler(new THREE.Euler(0.38, d.yaw, -0.2, 'YXZ'));
    d.pl = [{ a: 0.68, s: 0.085, c: new THREE.Color(0xe0a458) }, { a: 1.08, s: 0.12, c: new THREE.Color(0x8ec5c8) }, { a: 1.52, s: 0.075, c: new THREE.Color(0xd9c9a3) }].map((p) => ({ ...p, a0: r() * TAU }));
    d.gc = [[0, 0, 0], [Math.PI / 2, 0, 0], [Math.PI / 2, Math.PI / 2, 0]].map((e) => new Q().setFromEuler(new THREE.Euler(e[0], e[1] + d.yaw, e[2])));
  } else if (name === 'capsule') {
    d.oq = new Q().setFromEuler(new THREE.Euler(0.45, 0.3 + d.yaw, 0, 'YXZ'));
  } else if (name === 'wormhole') {
    d.pq = new Q().setFromEuler(new THREE.Euler(-1.0, 0.35 + d.yaw, 0, 'YXZ'));
    d.exit = new V3(1.7, 0.95, -1.05).applyAxisAngle(UP, d.yaw);
  } else if (name === 'cassette') {
    d.rot = 0; d.prog = 0; d.curAt = 0; d.curKey = -1;
  }
  return d;
}

export function unmakeVariant(v, d) {
  if (!d) return;
  if (d.origGeo) v.mesh.geometry = d.origGeo;
  if (d.origRay) v.mesh.raycast = d.origRay; else delete v.mesh.raycast;
  if (v.extras.edges) { if (d.origEdges) v.extras.edges.geometry = d.origEdges; v.extras.edges.visible = true; }
}

const BASE = new M4();
const RED = new THREE.Color(0xff3b3b), GREEN = new THREE.Color(0x86efac), GREY = new THREE.Color(0x8a8f99), WHITE = new THREE.Color(1, 1, 1);
const PANEL = new THREE.Color(0x1a2c5a), GOLD = new THREE.Color(0xc9a24a), SILVER = new THREE.Color(0xa7b0c2), CREAM = new THREE.Color(0xe7e2d6), DARK = new THREE.Color(0x222a3a);
const cA = new THREE.Color(), cB = new THREE.Color(), cC = new THREE.Color(), eA = new THREE.Color(), eB = new THREE.Color(), eC = new THREE.Color();
const lighten = (out, c, k) => out.copy(c).lerp(WHITE, k);

/**
 * 노드 하나의 시안 한 프레임. F = VariantField, d = makeVariant 결과, v = 노드, ctx = { dt, mode, s 본체 반지름(세계), px, op, L(라이트), reduced, red, green }
 * 발사점(도구 입자)은 d.emL(지역 좌표)·d.emN 에 남긴다 — 세계 좌표는 emitterWorld().
 */
export function stepVariant(F, d, v, ctx) {
  const { dt, mode, s, op, L, reduced } = ctx;
  const S = approach(d.S, VAR_STATE[mode] || VAR_STATE.wait, dt, 2.5);
  if (d.mode !== mode) { if (mode === 'off' && d.mode && d.mode !== 'off' && d.mode !== 'stop') d.settleAt = ctx.now; d.mode = mode; }
  const settle = d.settleAt >= 0 && ctx.now - d.settleAt < SETTLE_S ? settleK(ctx.now - d.settleAt) : 0;
  const rk = reduced ? 0.15 : 1;
  d.ph += dt * S.spd * rk; d.mt += dt * rk;
  const ph = d.ph, mt = d.mt;
  const lod = variantLod(ctx.px);
  d.lod = lod;
  v.group.updateWorldMatrix(true, false);
  BASE.copy(v.group.matrixWorld).scale(_s.set(s, s, s));
  const B = BASE;
  const col = ctx.col;
  // 공용 발광 세기(시안 페이지 applyLook): 밝기 + 작업 맥동, 오류면 붉은 맥동 쪽으로
  const pulse = 0.5 + 0.5 * Math.sin(mt * 6);
  const ek = (0.2 + 0.8 * S.bright + 0.45 * S.act * (0.6 + 0.4 * Math.sin(mt * 11)) + settle * 0.8) * (L ? 0.45 : 1);
  const errK = S.err * 0.8;
  const red = ctx.red || RED, green = ctx.green || GREEN;
  const emis = (out, k) => { out.copy(col).multiplyScalar(k * ek); if (errK > 0.01) { _k.copy(red).multiplyScalar(0.25 + 0.75 * pulse); out.lerp(_k, errK); } return out; };
  const lineC = L ? cC.copy(col).lerp(_w.set(0x1b2333), 0.3) : cC.copy(col).lerp(WHITE, 0.32);
  const lineA = op * (0.35 + 0.8 * S.bright) * (1 - 0.5 * S.err * (1 - pulse)) * (L ? 1.15 : 1);
  const tE = ease(S.tidy);
  d.emN = 0;
  const em = (x, y, z) => { if (d.emN < 4) { const o = d.emN * 3; d.emL[o] = x; d.emL[o + 1] = y; d.emL[o + 2] = z; d.emN++; } };
  const errJ = (i, k) => (S.err > 0.01 ? Math.sin(mt * 13 + i * 1.7) * k * S.err : 0);
  const n = d.name;

  if (n === 'belt') {
    if (lod === 0) { F.line(B, d.tilt, 1.85, 0, 3, lineA * 0.5, lineC); return; }
    const cnt = lod === 1 ? 14 : lod === 2 ? 32 : d.rocks.length;
    cA.copy(GREY).lerp(col, 0.18).multiplyScalar(L ? 0.75 : 0.5); emis(eA, 0.04);
    lighten(cB, col, 0.2); emis(eB, 0.9);
    for (let i = 0; i < cnt; i++) {
      const R = d.rocks[i], w = 0.55 * Math.pow(1.6 / R.r, 1.5), ang = R.a + ph * w;
      const rr = lerp(R.r, R.ring, tE) + errJ(i, 0.07);
      _p.set(Math.cos(ang) * rr, R.y * (1 - tE) + errJ(i + 3, 0.05), Math.sin(ang) * rr).applyQuaternion(d.tilt);
      _q.setFromAxisAngle(R.ax, mt * R.sp * (1 - 0.92 * tE) * (0.4 + 0.35 * S.spd)).multiply(R.q0); _q2.copy(d.tilt).multiply(_q);
      const sc = lerp(R.s, 0.085, tE * 0.7);
      _s.set(sc * lerp(R.sx, 1, tE * 0.6), sc * lerp(R.sy, 1, tE * 0.6), sc * lerp(R.sz, 1, tE * 0.6));
      _L.compose(_p, _q2, _s);
      if (R.ore) { F.put(F.p.rock, B, _L, cB, eB, op); em(_p.x, _p.y, _p.z); } else F.put(F.p.rock, B, _L, cA, eA, op);
    }
  } else if (n === 'crystal') {
    if (lod === 0) { F.line(B, d.rings[0].q, 1.6, 0, 0, lineA * 0.45, lineC); return; }
    lighten(cA, col, 0.35); emis(eA, 0.4);
    for (let i = 0; i < d.sd.length; i++) {
      const D = d.sd[i], ang = D.a0 + ph * D.R.w * D.R.dir;
      const rr = D.R.r + S.act * 0.14 * (0.5 + 0.5 * Math.sin(mt * 5 + i)) - tE * (D.ri ? 0.35 : 0.2);
      _p2.set(Math.cos(ang), 0, Math.sin(ang));
      _q2.copy(D.R.q).slerp(IDQ, tE);
      _p.copy(_p2).multiplyScalar(rr); if (S.err > 0.01) _p.addScalar(Math.sin(mt * 19 + i * 3) * 0.05 * S.err);
      _p.applyQuaternion(_q2);
      _p3.copy(_p2); _p3.y += D.wob * (1 - tE); _p3.lerp(UP, tE * 0.92).normalize().applyQuaternion(_q2);
      _q.setFromUnitVectors(UP, _p3).multiply(_q2.setFromAxisAngle(UP, mt * D.spin * (1 - tE)));
      const k = D.size * (1 + 0.25 * S.act);
      _L.compose(_p, _q, _s.set(0.07 * k, 0.32 * k, 0.07 * k));
      F.put(F.p.shard, B, _L, cA, eA, op * 0.92);
      if (i % 4 === 0) em(_p.x + _p3.x * 0.32 * k, _p.y + _p3.y * 0.32 * k, _p.z + _p3.z * 0.32 * k);
    }
    if (lod >= 2) {
      cB.copy(col).multiplyScalar(0.6); emis(eB, 0.25);
      const fn = lod === 2 ? 9 : d.fd.length;
      for (let i = 0; i < fn; i++) {
        const D = d.fd[i], ang = D.a + ph * D.w, rr = lerp(D.r, 1.68, tE);
        _p.set(Math.cos(ang) * rr, D.y * (1 - tE), Math.sin(ang) * rr).applyQuaternion(d.rings[0].q);
        _q.setFromAxisAngle(D.ax, mt * 1.2 * (1 - tE)).multiply(D.q0);
        _L.compose(_p, _q, _s.setScalar(D.s)); F.put(F.p.tetra, B, _L, cB, eB, op);
      }
    }
  } else if (n === 'drones') {
    for (let k = 0; k < 2; k++) {
      const o = d.orbits[k];
      const head = (((ph * o.w) / TAU) % 1 + 1) % 1;
      F.line(B, o.q, o.r, 0, 1, lineA * (lod === 0 ? 0.5 : 0.3) * (1 - tE * 0.7), lineC, lod >= 2 ? head : -1, lod >= 2 ? 0.12 * (0.4 + 0.6 * S.bright) : 0);
    }
    if (lod === 0) return;
    // 적도 띠(작은 본체 둘레)
    _L.compose(_p.set(0, 0, 0), IDQ, _s.setScalar(0.43)); F.put(F.p.band, B, _L, col, emis(eA, 1.1), op);
    cA.set(0x9aa3b5); eA.setRGB(0, 0, 0);
    cB.copy(PANEL); emis(eB, 0.45);
    for (let i = 0; i < 4; i++) {
      const D = d.drones[i], o = D.o, M = ph * o.w + D.off;
      _p.set(Math.cos(M) * o.r, 0, Math.sin(M) * o.r).applyQuaternion(o.q);
      _p2.set(Math.cos(M + 0.08) * o.r, 0, Math.sin(M + 0.08) * o.r).applyQuaternion(o.q);
      if (S.err > 0.01) { const w = 0.09 * S.err; _p.x += Math.sin(mt * 9 + i) * w; _p.y += Math.sin(mt * 7 + i * 2) * w; }
      _p.lerp(D.dock, tE);
      _p2.lerp(_p3.copy(D.dock).multiplyScalar(3), tE);
      _R.lookAt(_p2, _p, UP); _q.setFromRotationMatrix(_R);
      _T.compose(_p, _q, _s.setScalar(1.45));
      _L.multiplyMatrices(_T, _R.compose(_p3.set(0, 0, 0), IDQ, _s.set(0.15, 0.07, 0.13))); F.put(F.p.mbox, B, _L, cA, eA, op);
      const ws = 1 - 0.55 * tE;
      for (const sd of [-1, 1]) { _L.multiplyMatrices(_T, _R.compose(_p3.set(sd * (0.08 + 0.1 * ws), 0, 0), IDQ, _s.set(0.2 * ws, 0.008, 0.085))); F.put(F.p.box, B, _L, cB, eB, op); }
      if (lod >= 2) {
        const blinkHz = lerp(0.6, 6, S.act), on = Math.sin(mt * blinkHz * TAU + i) > 0 ? 1 : 0.25;
        lighten(cC, col, 0.2).multiplyScalar(lerp(0.5 + 0.3 * Math.sin(mt * 2 + i), on, S.act)).lerp(green, tE).lerp(red, S.err * on);
        _L.multiplyMatrices(_T, _R.compose(_p3.set(0, 0.045, 0.05), IDQ, _s.setScalar(0.04))); F.putG(F.p.gbox, B, _L, cC, op);
      }
      em(_p.x, _p.y, _p.z);
    }
  } else if (n === 'station') {
    const K = 1.2;
    _q.copy(d.tilt).multiply(_q2.setFromAxisAngle(UP, ph * 0.38));
    if (lod === 0) { F.line(B, d.tilt, 1.55 * K, 0, 0, lineA * 0.55, lineC); return; }
    lighten(cA, SILVER, 0); emis(eA, 0.05);
    _L.compose(_p.set(0, 0, 0), _q, _s.setScalar(K)); F.put(F.p.frame, B, _L, cA, eA, op);
    const spin = _T.compose(_p.set(0, 0, 0), _q, _s.setScalar(K));
    if (lod >= 2) {
      lighten(cB, col, 0.55).multiplyScalar(0.75); emis(eB, 0.06);
      lighten(cC, col, 0.4);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        _q2.setFromAxisAngle(UP, -a);
        _L.multiplyMatrices(spin, _R.compose(_p.set(Math.cos(a) * 1.55, 0, Math.sin(a) * 1.55), _q2, _s.set(0.12, 0.1, 0.27))); F.put(F.p.box, B, _L, cB, eB, op);
        if (lod >= 3) {
          const kTool = 0.25 + 0.95 * Math.pow(0.5 + 0.5 * Math.cos((i / 12) * TAU - mt * 5), 4), kWait = 0.22 + 0.12 * Math.sin(mt * 1.2 + i);
          _c.copy(cC).multiplyScalar(lerp(kWait, kTool, S.act)).lerp(green, tE * 0.8);
          let wa = 1;
          if (S.err > 0.01) { if (i % 4 === 1) _c.lerp(red, S.err * (Math.sin(mt * 9) > 0 ? 1 : 0.2)); else wa = 1 - 0.75 * S.err; }
          _L.multiplyMatrices(spin, _R.compose(_p.set(Math.cos(a) * 1.616, 0, Math.sin(a) * 1.616), _q2, _s.set(0.01, 0.035, 0.21))); F.putG(F.p.gbox, B, _L, _c, op * wa);
        }
        if (i % 4 === 0) { _p.set(Math.cos(a) * 1.65, 0, Math.sin(a) * 1.65).applyMatrix4(spin); em(_p.x, _p.y, _p.z); }
      }
      if (lod >= 3) { const sh = 0.5 + 0.5 * Math.sin(mt * (0.6 + 2.4 * S.act)); _L.multiplyMatrices(spin, _R.compose(_p.set(0.56 + 0.92 * sh * (1 - tE), 0.035, 0), IDQ, _s.set(0.09, 0.04, 0.05))); F.put(F.p.box, B, _L, lighten(cA, WHITE, 0), emis(eA, 0.6), op); }
    } else for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; _p.set(Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6).applyMatrix4(spin); em(_p.x, _p.y, _p.z); }
  } else if (n === 'solar') {
    for (const sat of d.sats) F.line(B, sat.q, sat.a, 0, 3, lineA * (lod === 0 ? 0.55 : 0.3), lineC);
    if (lod === 0) return;
    const u0 = Math.min(1, Math.max(0, 0.58 + 0.42 * S.act - 0.6 * S.tidy));
    cA.copy(GOLD); emis(eA, 0.05); cB.copy(PANEL); emis(eB, 0.55); cC.set(0xb8c0cc);
    d.sats.forEach((sat, si) => {
      const M = ph * sat.w + sat.M0;
      _p.set(Math.cos(M) * sat.a, 0, Math.sin(M) * sat.a).applyQuaternion(sat.q);
      _q.copy(d.sun).multiply(_q2.setFromAxisAngle(UP, mt * 0.25 + si));
      _T.compose(_p, _q, _s.setScalar(1.7));
      _L.multiplyMatrices(_T, _R.compose(_p3.set(0, 0, 0), IDQ, _s.set(0.05, 0.14, 0.05))); F.put(F.p.cyl, B, _L, cA, eA, op);
      if (lod >= 2) { _L.multiplyMatrices(_T, _R.compose(_p3.set(0, 0.1, 0), _q2.setFromAxisAngle(_p2.set(1, 0, 0), Math.PI), _s.set(0.055, 0.035, 0.055))); F.put(F.p.dish, B, _L, cC, eA, op); }
      for (const sd of [-1, 1]) {
        let u = u0;
        if (si === 0 && sd < 0 && S.err > 0.01) u = lerp(u, 0.5 + 0.5 * Math.sin(mt * 7), S.err);
        const pv = _R.compose(_p3.set(sd * 0.05, 0, 0), _q2.setFromAxisAngle(_p2.set(0, 0, 1), sd * (1 - u) * 1.25), ONE);
        const pvC = _PV.multiplyMatrices(_T, pv);
        const pn = lod === 1 ? 2 : 3;
        for (let k = 0; k < pn; k++) {
          _L.compose(_p3.set(sd * (0.065 + (k + 0.5) * 0.12 * lerp(0.18, 1, u)), 0, 0), _q2.setFromAxisAngle(_p2.set(0, 0, 1), (k % 2 ? 1 : -1) * (1 - u) * 1.1), _s.set(0.115, 0.006, 0.09));
          F.put(F.p.box, B, _R.multiplyMatrices(pvC, _L), cB, eB, op);
        }
      }
      em(_p.x, _p.y + 0.17, _p.z);
    });
  } else if (n === 'arcs') {
    if (lod === 0) { F.line(B, _q.setFromEuler(_eu.set(0.25, d.yaw, 0.1)), 1.62, 0, 2, lineA * 0.5, lineC); return; }
    const ex = (0.8 + 0.7 * S.act + 1.3 * S.err) * (1 - tE);
    const lq = d.lq || (d.lq = [new Q(), new Q(), new Q()]);
    for (let li = 0; li < 3; li++) {
      const Ld = ARC_L[li];
      _q.setFromEuler(_eu.set(Ld.tilt[0] * (1 - tE), Ld.tilt[1] + d.yaw, Ld.tilt[2] * (1 - tE))).multiply(_q2.setFromAxisAngle(UP, ph * Ld.sp * Ld.dir));
      lq[li].copy(_q);
    }
    eC.setRGB(0, 0, 0);
    cC.copy(GREY).lerp(col, 0.3); emis(eC, 0.1);
    for (let i = 0; i < d.parts.length; i++) {
      const P = d.parts[i], Ld = ARC_L[P.li];
      if (lod === 1 && P.li === 1) continue;
      const j = errJ(i + 5, 0.05);
      // 조각 = 층 회전 × 조각 자리(k) × 벌어짐(가운데 방향으로 밀기·위아래·기울기)
      _q2.setFromAxisAngle(UP, (P.k * TAU) / Ld.n);
      _p.copy(P.mid).multiplyScalar(P.dr * ex + j); _p.y = P.dy * ex + j;
      _q.setFromAxisAngle(P.mid, P.tl * ex);
      _T.compose(_p3.set(0, 0, 0), lq[P.li], ONE).multiply(_R.compose(_p2.set(0, 0, 0), _q2, ONE)).multiply(_L.compose(_p, _q, ONE));
      lighten(cA, col, Ld.l).multiplyScalar(0.85); emis(eA, 0.14);
      F.put(F.arcParts[P.li], B, _T, cA, eA, op);
      if (lod >= 2) {
        _L.compose(P.end, _q.setFromEuler(_eu.set(mt * 0.7 + i, mt * 0.5, 0)), _s.setScalar(P.cs));
        F.put(F.p.rock, B, _W.multiplyMatrices(_T, _L), cC, eC, op);
      }
      if (i % 3 === 0) { _p.copy(P.end).applyMatrix4(_T); em(_p.x, _p.y, _p.z); }
    }
  } else if (n === 'pocket') {
    const R = VDIM.pocket;
    // 유리 거품 + 별 코로나 + 작은 행성 셋
    const fl = 1 + 0.45 * S.act * (0.6 + 0.4 * Math.sin(mt * 8)) - 0.25 * S.err * (0.5 + 0.5 * Math.sin(mt * 6));
    lighten(cA, col, 0.35); if (S.err > 0.01) cA.lerp(red, S.err * (0.5 + 0.5 * Math.sin(mt * 6)));
    if (L) cA.lerp(_w.set(0x1b2333), 0.35);
    _L.compose(_p.set(0, 0, 0), IDQ, _s.setScalar(R)); F.putG(F.p.bubble, B, _L, cA, op * (0.45 + 0.4 * S.bright) * (L ? 0.8 : 1));
    if (lod === 0) return;
    cB.copy(col).lerp(red, S.err * 0.6); if (L) cB.lerp(_w.set(0x3a2a10), 0.3);
    _q.setFromRotationMatrix(_R.extractRotation(v.group.matrixWorld)).invert().multiply(F.cam.quaternion);
    _L.compose(_p.set(0, 0, 0), _q, _s.setScalar(1.1 * fl));
    F.putG(F.p.halo, B, _L, cB, op * (0.55 + 0.45 * S.bright) * (L ? 0.7 : 1));
    d.pl.forEach((pl, i) => {
      let ang = pl.a0 + ph * 0.7 * Math.pow(1 / pl.a, 1.5);
      const tgt = Math.round(ang / TAU) * TAU + 0.6; ang = lerp(ang, tgt, tE);
      _p.set(Math.cos(ang) * pl.a, 0, Math.sin(ang) * pl.a).applyQuaternion(d.plane);
      _L.compose(_p, _q.setFromAxisAngle(UP, mt), _s.setScalar(pl.s)); F.put(F.p.planet, B, _L, pl.c, emis(eA, 0.06), op);
      if (lod >= 2) F.line(B, d.plane, pl.a, 0, 0, lineA * 0.22, lineC);
      em(_p.x, _p.y, _p.z);
    });
    if (lod >= 3) for (const q of d.gc) F.line(B, q, R, 0, 0, lineA * 0.12, lineC);
  } else if (n === 'capsule') {
    const a = 1.6, e = 0.35, M = ph * 0.7;
    F.line(B, d.oq, a, e, 1, lineA * (lod === 0 ? 0.55 : 0.3) * (1 - tE * 0.6), lineC);
    if (lod === 0) return;
    // 받침대(짐벌 — 세션 자리) + 받침 등
    cA.set(0x8c94a6); emis(eA, 0.15);
    _L.compose(_p.set(0, 0, 0), _q.setFromAxisAngle(UP, ph * 0.05 + d.yaw), ONE); F.put(F.p.gimbal, B, _L, cA, eA, op);
    if (lod >= 2) {
      const blink = Math.sin(mt * 7) > 0 ? 1 : 0.2;
      cB.copy(col).multiplyScalar(0.35).lerp(green, tE).lerp(red, S.err * blink * 0.6);
      _L.compose(_p.set(0, -0.5, 0), IDQ, _s.setScalar(0.05)); F.putG(F.p.gsph, B, _L, cB, op);
    }
    // 캡슐: 이심 궤도, 오류면 바깥으로 표류, 완료면 받침대 위로 돌아와 도킹
    kepPos(a, e, M, _p).applyQuaternion(d.oq); kepPos(a, e, M + 0.06, _p2).applyQuaternion(d.oq);
    if (S.err > 0.01) { const k = 1 + 0.3 * S.err * (0.5 + 0.5 * Math.sin(mt * 0.8)); _p.multiplyScalar(k); _p2.multiplyScalar(k); }
    _p.lerp(_p3.set(0, 0.42, 0), tE); _p2.lerp(_p3.set(0, 0.42, 3), tE);
    _R.lookAt(_p2, _p, UP); _q.setFromRotationMatrix(_R);
    if (S.err > 0.01) _q.multiply(_q2.setFromAxisAngle(_p3.set(0, 0, 1), mt * 2 * S.err));
    _T.compose(_p, _q, ONE);
    cC.copy(CREAM); emis(eC, 0.05);
    F.put(F.p.capsule, B, _T, cC, eC, op);
    if (lod >= 2) {
      const blink = Math.sin(mt * 7) > 0 ? 1 : 0.2;
      lighten(cA, col, 0.4).multiplyScalar(0.4 + 0.6 * S.bright).lerp(red, S.err * blink);
      _L.multiplyMatrices(_T, _R.compose(_p3.set(0, 0.21, 0), IDQ, _s.setScalar(0.025))); F.putG(F.p.gsph, B, _L, cA, op);
      if (lod >= 3) { lighten(cB, col, 0.4); _L.multiplyMatrices(_T, _R.compose(_p3.set(0.17, 0.1, 0.06), IDQ, _s.set(0.06, 0.035, 0.18))); F.putG(F.p.gbox, B, _L, cB, op * (0.5 + 0.5 * S.bright)); }
    }
    _p3.set(0, 0, -0.48).applyMatrix4(_T); em(_p3.x, _p3.y, _p3.z);
  } else if (n === 'wormhole') {
    const K = VDIM.wormhole;
    // 고리 틀: 고리 면 아래(지역 −y)로 꺼진 깔때기 바닥에 claude -p 상자(작은 본체)가 오도록 고리를 위로 띄움
    _p.set(0, 0.55 * K, 0).applyQuaternion(d.pq);
    _T.compose(_p, d.pq, _s.setScalar(K));
    if (lod === 0) { F.line(B, d.pq, K, 0, 0, lineA * 0.6, lineC); return; }
    lighten(cA, col, 0); emis(eA, 0.6);
    F.put(F.p.torus, B, _T, cA, eA, op);
    const frac = lod === 1 ? 0.3 : lod === 2 ? 0.65 : 1;
    _W.multiplyMatrices(B, _T);
    F.vortex(_W, ph, S, lighten(cB, col, 0.15), op * (L ? 0.9 : 1), frac);
    for (let k = 0; k < 3; k++) { _p2.set(Math.cos((k * TAU) / 3), 0, Math.sin((k * TAU) / 3)).applyMatrix4(_T); em(_p2.x, _p2.y, _p2.z); }
    if (lod >= 2) {
      // 저쪽 공간 = 점선 끝 작은 출구 고리
      _L.compose(d.exit, _q.setFromEuler(_eu.set(mt * 0.5, mt * 0.3, 0)), _s.setScalar(0.2)); F.put(F.p.torus, B, _L, cA, eA, op);
      _p2.copy(_p).applyMatrix4(B); _p3.copy(d.exit).applyMatrix4(B);
      F.seg(_p2, _p3, lineC, lineA * 0.35);
    }
  } else if (n === 'cassette') {
    const K = VDIM.cassette, NS = CASSETTE_N, R = 1.45 * K;
    F.line(B, _q.copy(IDQ), R, 0, 1, lineA * (lod === 0 ? 0.55 : 0.28), lineC, -1, 0, 0);
    if (lod === 0) return;
    // 카드 = 그 노드 자신의 도구 호출(끝 초록 · 실패 빨강 · 지금 진행 막대 · 다음 빈 틀) — 기동기 회차는 기동기 G3 고리 몫
    const cm = cassetteModel(v.hist, v.icons ? v.icons.size : 0, v.node.counts && v.node.counts.tools);
    const key = cm.cur * 10 + cm.cards[cm.cur];
    if (key !== d.curKey) { d.curKey = key; d.curAt = ctx.now; }
    const prog = cm.cards[cm.cur] === 3 ? 1 - Math.exp(-(ctx.now - d.curAt) / 8) : 0;
    const target = (cm.cur / NS) * TAU - Math.PI / 2;
    let dd = target - d.rot; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); d.rot += dd * Math.min(1, dt * 2.2 * (reduced ? 0.3 : 1));
    const flatQ = _q2.setFromEuler(_eu.set(-Math.PI / 2, 0, 0));
    for (let k = 0; k < NS; k++) {
      const a = (k / NS) * TAU - d.rot * (1 - tE), code = cm.cards[k];
      _p.set(Math.cos(a) * R, 0.05, Math.sin(a) * R).lerp(_p3.set(0, -0.74 + k * 0.034, 0), tE);
      _q.setFromAxisAngle(UP, Math.PI / 2 - a).slerp(flatQ, tE);
      let op2 = op;
      if (code === 1) { cA.set(0x1d3a33); eA.copy(green).multiplyScalar((0.12 + 0.1 * S.bright) * (L ? 0.45 : 1)); }
      else if (code === 2) { cA.set(0x3a1d1d); eA.copy(red).multiplyScalar((0.2 + 0.15 * S.bright) * (L ? 0.45 : 1)); }
      else if (code === 3) { cA.set(0x3a2f12); emis(eA, 0.25 + 0.5 * S.bright + 0.25 * S.act * pulse); }
      else { cA.copy(DARK); eA.setRGB(0, 0, 0); op2 = op * (tE > 0.5 ? 0.9 : 0.32); }
      _T.compose(_p, _q, ONE);
      _L.multiplyMatrices(_T, _R.compose(_p3.set(0, 0, 0), IDQ, _s.set(0.36, 0.5, 0.018))); F.put(F.p.box, B, _L, cA, eA, op2);
      if (lod >= 2 && (code === 1 || code === 2 || code === 3)) {
        const pr = code === 3 ? prog : 1;
        _c.copy(code === 2 ? red : code === 1 ? green : lighten(cB, col, 0.5));
        _L.multiplyMatrices(_T, _R.compose(_p3.set(-0.144 * (1 - pr), -0.18, 0.016), IDQ, _s.set(0.288 * Math.max(0.02, pr), 0.036, 0.012))); F.putG(F.p.gbox, B, _L, _c, op * (code === 3 ? 1 : 0.75));
      }
      if (k === cm.cur) em(_p.x, _p.y, _p.z);
    }
  }
}

/** 발사점 i(0..emN-1)의 세계 좌표 — stepVariant 가 남긴 지역 좌표에 그 프레임의 노드 기준(BASE)을 다시 곱한다 */
export function emitterWorld(d, v, s, i, out) {
  if (!d.emN) return false;
  const o = (i % d.emN) * 3;
  _T.copy(v.group.matrixWorld).scale(_s.set(s, s, s));
  out.set(d.emL[o], d.emL[o + 1], d.emL[o + 2]).applyMatrix4(_T);
  return true;
}
