// 흐름(Flow) 3D 사용자 단말(나 · 사용자) 입체
// 예전엔 섬 위 단말이 선(틀·받침)만이라 육각 기둥 노드 사이에서 납작한 빈 틀로 보였다. 이제 부피 있는 단말:
//  육각 받침(윗면 상태색 고리) · 기둥 · 뒤로 기운 화면 패널(베젤 두께 · 뒷면 덮개) · 어두운 유리 화면(상태에 따라 발광·스캔라인) · 베젤 표시등
//  + 어휘 그대로 바닥 그림자 원반 · 바닥 → 받침 밑면 점선 기둥줄.
// 자리·방위·상태는 ix-core ixGeometry 의 geo.cons(입체 모드 env.solid — 화면 가운데·기저 r/v/n·방위·상태·투명도)를 그대로 따른다.
// 화면 안 글줄·이름표·집기·빔 출발점도 같은 값이라 서로 어긋나지 않는다. 그리기 2번(단말 1 + 그림자 1, 인스턴싱), 프레임마다 객체 생성 없음.
import * as THREE from 'three';
import { CON3D, ixKeyColor } from '../ix-core.mjs';
import { consoleLook, CON_LOD_PX } from './console-core.mjs';

const MAX = 48;
// 단말 부분 번호(aPart): 0 몸(베젤·덮개·기둥·받침 옆) · 1 화면 유리 · 2 표시등 · 3 받침 윗면 · 4 그림자 원반 · 5 점선 기둥줄
const PED_Y = -1.78;   // 받침 윗면 높이(화면 가운데 기준)
const PED_R = 0.78, PED_T = 0.16, PED_Z = -0.2;

const VS = `
attribute vec3 aNrm; attribute vec4 aM; // aM: 부분 · 세부(LOD 에서 뺌) · uv
attribute vec3 iCol; attribute vec3 iLed; attribute vec4 iP; attribute vec4 iQ;
uniform float uFloor; uniform float uStemW; uniform float uFogNear; uniform float uFogFar;
varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vPart; varying vec3 vCol; varying vec3 vLed; varying vec4 vP; varying vec4 vQ; varying float vFog; varying float vH;
void main() {
  vPart = aM.x; vUv = aM.zw; vCol = iCol; vLed = iLed; vP = iP; vQ = iQ; vH = 0.0;
  vec3 C = instanceMatrix[3].xyz;
  mat3 R = mat3(instanceMatrix);
  vec3 w;
  if (aM.x > 4.5) {            // 바닥 → 받침 밑면 점선 기둥줄(세로축 빌보드)
    vec3 base = C + R * vec3(0.0, ${(PED_Y - PED_T).toFixed(3)}, ${PED_Z.toFixed(3)});
    float hg = max(0.0, base.y - uFloor);
    vec3 b = vec3(base.x, uFloor + position.y * hg, base.z);
    vec3 tc = cameraPosition - b;
    vec3 r = normalize(vec3(tc.z, 0.0, -tc.x) + vec3(1e-4, 0.0, 0.0));
    w = b + r * position.x * uStemW;
    vUv = vec2(position.x, position.y * hg); vH = hg;
  } else if (aM.x > 3.5) {     // 그림자 원반(바닥): 높을수록 넓고 옅게
    vec3 base = C + R * vec3(0.0, ${PED_Y.toFixed(3)}, ${PED_Z.toFixed(3)});
    float hg = max(0.0, base.y - uFloor);
    float rr = 1.25 * (1.0 + hg * 0.035);
    w = vec3(base.x + position.x * rr, uFloor + 0.05, base.z + position.z * rr);
    vUv = position.xz; vH = hg;
  } else {
    w = C + R * position;
    if (iQ.x > 0.5 && aM.y > 0.5) w = C;   // LOD: 세부는 접음
  }
  vN = normalize(R * aNrm); vW = w;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FS = `
uniform float uTime; uniform float uLight; uniform vec3 uBody; uniform vec3 uGlass; uniform vec3 uFog; uniform float uFogMax;
varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vPart; varying vec3 vCol; varying vec3 vLed; varying vec4 vP; varying vec4 vQ; varying float vFog; varying float vH;
// vP: 투명도(페이드) · 발광 0..1 · 표시등 세기 0..1 · 호버/선택 / vQ: LOD · 씨앗 · 스캔라인 속도(0 = 멈춤) · 질문 대기
void main() {
  bool light = uLight > 0.5;
  float fade = vP.x, glow = vP.y, ledK = vP.z, foc = vP.w;
  if (fade < 0.004) discard;
  if (vPart > 4.5) {          // 점선 기둥줄: 아래로 흐르는 점선
    float lineA = smoothstep(1.0, 0.15, abs(vUv.x));
    float dash = step(0.5, fract(vUv.y * 0.7 + uTime * 0.35 * step(0.001, vQ.z)));
    float al = lineA * dash * (light ? 0.34 : 0.26) * (0.4 + 0.6 * smoothstep(0.0, 2.0, vUv.y));
    gl_FragColor = linearToOutputTexel(vec4(mix(vCol, uFog, vFog * uFogMax), al * fade));
    return;
  }
  if (vPart > 3.5) {          // 그림자 원반: 부드러운 어두운 가운데 + 상태색 옅은 테
    float dd = length(vUv);
    if (dd > 1.0) discard;
    float hk = 1.0 / (1.0 + vH * 0.05);
    float core = 1.0 - smoothstep(0.0, 1.0, dd); core *= core;
    float rim = smoothstep(0.08, 0.0, abs(dd - 0.82));
    vec3 col = light ? mix(vec3(0.22, 0.27, 0.36), vCol, rim * 0.75) : mix(vec3(0.0), vCol, rim);
    float al = (core * (light ? 0.3 : 0.6) + rim * (light ? 0.16 : 0.2)) * hk;
    gl_FragColor = linearToOutputTexel(vec4(mix(col, uFog, vFog * uFogMax), al * fade));
    return;
  }
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vN);
  float ndl = max(0.0, dot(N, normalize(vec3(-0.45, 0.6, 0.66))));
  float shade = light ? 0.78 + 0.22 * ndl : 0.42 + 0.58 * ndl;
  float fres = pow(1.0 - abs(dot(N, V)), 3.0);
  vec3 ink = light ? vCol * 0.85 : mix(vCol, vec3(1.0), 0.12);
  vec3 col; float al = 1.0;
  if (vPart < 0.5) {          // 몸: 어두운(라이트는 밝은) 판 + 방향광 음영 + 모서리선·가장자리 상태색 테(호버면 진하게)
    col = uBody * shade;
    float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float edge = smoothstep(0.035, 0.0, e);
    col = mix(col, ink, max(edge * (light ? 0.45 : 0.4), fres * (light ? 0.3 : 0.5)) * (0.4 + 0.6 * glow + foc * 0.6));
  } else if (vPart < 1.5) {   // 화면 유리: 상태 발광 + 가장자리 어둡게 + 위에서 아래로 지나는 스캔라인 + 안쪽 테
    vec2 q = vUv * 2.0 - 1.0;
    float vig = 1.0 - 0.35 * dot(q * vec2(0.8, 1.0), q * vec2(0.8, 1.0));
    col = mix(uGlass, vCol, 0.004 + 0.12 * glow * sqrt(glow)) * vig; // 대기 화면은 거의 검은 유리, 질문·답함일수록 금빛
    col += vec3(0.006, 0.009, 0.016) * (light ? 3.0 : 1.0) * smoothstep(0.2, 1.0, vUv.y) * (1.0 - vUv.x * 0.6); // 유리 위쪽이 살짝 밝게
    float sy = 1.0 - fract(uTime * vQ.z * 0.35 + vQ.y);
    float scan = smoothstep(0.05, 0.0, abs(vUv.y - sy)) * step(0.001, vQ.z) * 0.06 * (0.3 + glow);
    col = mix(col, vCol, scan);
    float edge = max(smoothstep(0.035, 0.0, min(vUv.x, 1.0 - vUv.x)), smoothstep(0.05, 0.0, min(vUv.y, 1.0 - vUv.y)));
    col = mix(col, ink, edge * (0.25 + 0.5 * glow + foc * 0.3));
    col += vec3(1.0) * smoothstep(0.55, 0.0, abs(vUv.x + vUv.y * 0.6 - 0.35)) * smoothstep(0.45, 1.0, vUv.y) * (light ? 0.02 : 0.012); // 유리 반사(비스듬한 옅은 띠)
    al = light ? 0.97 : 0.95;
  } else if (vPart < 2.5) {   // 표시등
    vec3 off = uBody * 0.8;
    col = mix(off, light ? vLed * 0.9 : mix(vLed, vec3(1.0), 0.25), ledK);
  } else {                    // 받침 윗면: 몸색 + 상태색 고리(발광에 따라)
    col = uBody * (light ? 0.95 : 0.75 + 0.25 * ndl);
    float d = length(vUv);
    float ring = smoothstep(0.07, 0.0, abs(d - 0.8)) * (0.3 + 0.6 * glow + foc * 0.4);
    col = mix(col, ink, ring);
  }
  col = mix(col, uFog, vFog * uFogMax);
  gl_FragColor = linearToOutputTexel(vec4(col, al * fade * (1.0 - vFog * uFogMax * 0.3))); // 색은 THREE.Color(선형) — 화면 색공간으로(ix 선·이름표 색과 같은 색조)
}`;

// ───── 모양 틀(단말 지역 좌표: 화면 가운데 원점, x 오른쪽, y 위, z 앞(카메라 쪽)) ─────
function builder() {
  const P = [], N = [], M = [], idx = [];
  const v = (p, n, part, det, u = 0, w = 0) => { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); M.push(part, det, u, w); return P.length / 3 - 1; };
  const quad = (a, b, c, d, n, part, det, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) => {
    const i = v(a, n, part, det, ...uv[0]); v(b, n, part, det, ...uv[1]); v(c, n, part, det, ...uv[2]); v(d, n, part, det, ...uv[3]);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  return { P, N, M, idx, v, quad };
}
const rotX = (p, t) => [p[0], p[1] * Math.cos(t) - p[2] * Math.sin(t), p[1] * Math.sin(t) + p[2] * Math.cos(t)];
/** 상자(가운데 c, 반크기 h), 지역 회전 x 축 t(화면 기울기) — 6면, 앞면(+z)은 skipFront 면 뺌 */
function box(B, c, h, t, part, det, skipFront = false) {
  const R = (p) => { const q = rotX(p, t); return [q[0] + c[0], q[1] + c[1], q[2] + c[2]]; };
  const F = [
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
    [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
    [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
  ];
  for (let k = 0; k < F.length; k++) {
    if (skipFront && k === 0) continue;
    const [n, cs] = F[k];
    const pts = cs.map((s) => R([s[0] * h[0], s[1] * h[1], s[2] * h[2]]));
    B.quad(pts[0], pts[1], pts[2], pts[3], rotX(n, t), part, det);
  }
}
/** 받침: 육각 기둥(윗면은 부분 3 — uv = 반지름 정규화 좌표) */
function pedestal(B, y, r, th, z) {
  const H = [];
  for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (Math.PI / 3) * i; H.push([Math.cos(a) * r, Math.sin(a) * r]); }
  for (let i = 0; i < 6; i++) {
    const a = H[i], b = H[(i + 1) % 6], am = Math.PI / 6 + (Math.PI / 3) * (i + 0.5), n = [Math.cos(am), 0, Math.sin(am)];
    B.quad([a[0], y - th, a[1] + z], [b[0], y - th, b[1] + z], [b[0], y, b[1] + z], [a[0], y, a[1] + z], n, 0, 0);
  }
  const c = B.v([0, y, z], [0, 1, 0], 3, 0, 0, 0);
  const ring = H.map((h) => B.v([h[0], y, h[1] + z], [0, 1, 0], 3, 0, h[0] / r, h[1] / r));
  for (let i = 0; i < 6; i++) B.idx.push(c, ring[(i + 1) % 6], ring[i]);
}
function consoleGeometry() {
  const B = builder();
  const W = CON3D.W, H = CON3D.H, bz = CON3D.BEZEL, t = -CON3D.TILT, D = 0.2; // 음수 = 위가 뒤로(화면 법선이 앞·약간 위, ix-core conBasis 와 같음)
  // 베젤 몸(앞면은 화면이 덮음 — 앞 테두리만 보이게 앞면 대신 테 4장)
  box(B, rotX([0, 0, -D / 2], t), [W + bz, H + bz, D / 2], t, 0, 0, true);
  const fz = 0.0, T = (p) => rotX(p, t), fn = rotX([0, 0, 1], t);
  const rim = (x0, y0, x1, y1) => B.quad(T([x0, y0, fz]), T([x1, y0, fz]), T([x1, y1, fz]), T([x0, y1, fz]), fn, 0, 0);
  rim(-W - bz, -H - bz, W + bz, -H); rim(-W - bz, H, W + bz, H + bz); rim(-W - bz, -H, -W, H); rim(W, -H, W + bz, H);
  // 화면 유리(앞면 살짝 안쪽)
  B.quad(T([-W, -H, fz - 0.012]), T([W, -H, fz - 0.012]), T([W, H, fz - 0.012]), T([-W, H, fz - 0.012]), fn, 1, 0);
  // 뒷면 덮개(가운데가 불룩한 등판 두 단) — 세부
  box(B, rotX([0, -0.04, -D - 0.1], t), [W * 0.68, H * 0.7, 0.1], t, 0, 1);
  box(B, rotX([0, -0.08, -D - 0.24], t), [W * 0.36, H * 0.42, 0.06], t, 0, 1);
  // 표시등(베젤 아래 오른쪽) — 세부
  box(B, rotX([W - 0.12, -H - bz * 0.5, 0.025], t), [0.09, 0.035, 0.03], t, 2, 1);
  // 목: 등판 아래 → 받침
  const nb = rotX([0, -0.2, -D - 0.1], t);
  box(B, [0, (nb[1] + PED_Y) / 2, PED_Z], [0.11, (nb[1] - PED_Y) / 2, 0.11], 0, 0, 0);
  // 받침(육각 판)
  pedestal(B, PED_Y, PED_R, PED_T, PED_Z);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.P, 3));
  g.setAttribute('aNrm', new THREE.Float32BufferAttribute(B.N, 3));
  g.setAttribute('aM', new THREE.Float32BufferAttribute(B.M, 4));
  g.setIndex(B.idx);
  return g;
}
function shadowGeometry() {
  const P = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, -1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0];
  const M = [4, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aNrm', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('aM', new THREE.Float32BufferAttribute(M, 4));
  g.setIndex([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7]);
  return g;
}

export class FlowConsoles {
  constructor(scene, view) {
    this.view = view;
    const geo = consoleGeometry(), sgeo = shadowGeometry();
    const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(MAX * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aCol = mk(3); this.aLed = mk(3); this.aP = mk(4); this.aQ = mk(4);
    for (const g of [geo, sgeo]) { g.setAttribute('iCol', this.aCol); g.setAttribute('iLed', this.aLed); g.setAttribute('iP', this.aP); g.setAttribute('iQ', this.aQ); }
    this.uniforms = { uTime: { value: 0 }, uLight: { value: 0 }, uBody: { value: new THREE.Color() }, uGlass: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uFogMax: { value: 0.5 },
      uFogNear: { value: 80 }, uFogFar: { value: 300 }, uFloor: { value: 0 }, uStemW: { value: 0.08 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: true, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1.6; // 칩 색(1)·칩 깊이(1.5) 다음 — 앞의 칩에 가려지고 뒤의 칩은 가림, 빔·글줄(2·3)은 그 뒤
    this.smat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.shadow = new THREE.InstancedMesh(sgeo, this.smat, MAX);
    this.shadow.instanceMatrix = this.mesh.instanceMatrix;
    this.shadow.count = 0; this.shadow.frustumCulled = false; this.shadow.renderOrder = 0.5;
    scene.add(this.shadow, this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._e = new THREE.Euler(); this._c = new THREE.Color();
    this._keyCol = new Map();
    this.isLight = false;
    this.count = 0;
  }
  applyTheme(isLight) {
    this.isLight = !!isLight;
    this.uniforms.uLight.value = this.isLight ? 1 : 0;
    this.uniforms.uBody.value.set(this.isLight ? '#d3dae5' : '#1d2740');
    this.uniforms.uGlass.value.set(this.isLight ? '#2a3243' : '#060a14'); // 라이트도 어두운 화면 유리 — 글줄(배경 쪽으로 섞인 금빛)이 밝게 읽힘
    this._keyCol.clear();
  }
  _col(key) {
    let c = this._keyCol.get(key);
    if (!c) { c = new THREE.Color(ixKeyColor(key, this.isLight)); this._keyCol.set(key, c); }
    return c;
  }
  /** cons = ix 의 geo.cons(입체 항목만 그림) */
  update(now, cons) {
    const view = this.view, U = this.uniforms;
    U.uTime.value = now % 1000;
    const fog = view.scene.fog, cp = view.camera.position, camDist = view.focusDist || cp.length();
    U.uFog.value.copy(fog ? fog.color : view.tokens.bg);
    U.uFogNear.value = camDist * 0.8; U.uFogFar.value = camDist * 2.6;
    U.uStemW.value = Math.max(0.05, camDist / 900);
    U.uFloor.value = view.tierFloor ?? 0;
    const C = this.aCol.array, L = this.aLed.array, A = this.aP.array, Q = this.aQ.array;
    const reduced = !!view.reduced;
    let n = 0;
    for (const con of cons || []) {
      if (!con.r || n >= MAX) continue;
      const look = consoleLook(con, now, reduced);
      this._p.set(con.x, con.y, con.z);
      this._q.setFromEuler(this._e.set(0, con.yaw || 0, 0));
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      const kc = this._col(con.key || 'user'), lc = this._col(look.led);
      C[n * 3] = kc.r; C[n * 3 + 1] = kc.g; C[n * 3 + 2] = kc.b;
      L[n * 3] = lc.r; L[n * 3 + 1] = lc.g; L[n * 3 + 2] = lc.b;
      const foc = view.hoverId === con.root || view.focusId === con.root ? 1 : 0;
      A[n * 4] = con.fade ?? 1; A[n * 4 + 1] = look.glow; A[n * 4 + 2] = look.ledK; A[n * 4 + 3] = foc;
      Q[n * 4] = (con.px ?? 999) < CON_LOD_PX ? 1 : 0; Q[n * 4 + 1] = (n * 0.37) % 1; Q[n * 4 + 2] = look.scan; Q[n * 4 + 3] = con.asking ? 1 : 0;
      n++;
    }
    this.mesh.count = n; this.shadow.count = n; this.count = n;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.aCol.needsUpdate = true; this.aLed.needsUpdate = true; this.aP.needsUpdate = true; this.aQ.needsUpdate = true;
    }
  }
  dispose() { this.mesh.removeFromParent(); this.shadow.removeFromParent(); this.mesh.geometry.dispose(); this.shadow.geometry.dispose(); this.mat.dispose(); this.smat.dispose(); }
}
