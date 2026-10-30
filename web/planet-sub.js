// Planet 3D 서브에이전트 행성 유형 8종 — 노드 id 로 고정(planet-core subType), 형태·질감·움직임으로 구분하고 색조는 노드 색 기반.
//  gas 가스 거인(굵은 띠·소용돌이 폭풍 점, 도구 = 폭풍 번개) · lava 용암(어두운 지각 사이 발광 균열 맥동, 도구 = 분출 입자)
//  ice 얼음(옅은 색·극관·결정 반짝임, 도구 = 반짝임 늘어남) · ringed 고리 행성(넓은 납작 고리 — 띠·간극·행성 그림자·광택, 도구 = 고리 가속)
//  binary 쌍성(짝 몸체가 가까이 돎, 도구 = 둘 사이 입자 다리) · swarm 위성 군단(도구 = 위성 산개) · comet 혜성(코마 + 부모 반대쪽 꼬리, 도구 = 꼬리 길어짐)
//  crystal 결정(다면체 면마다 반짝임, 도구 = 면 번쩍임 물결).
// 몸체 셰이더는 프로그램 하나(planet-subt)에 유형 uniform 분기. 상태: 생각 = 표면 흐름 빨라짐, 대기 = 느려지고 어두워짐(uDim), 완료 = 정리 연출 후 진정.
import * as THREE from 'three';
import { PHEAT, warmGlsl } from './planet-heat-core.mjs'; // 셰이더 과열 경계(HOT_H·CRIT_H, 30% 기준)

const TAU = Math.PI * 2;
export const TYPE_ID = { gas: 0, lava: 1, ice: 2, ringed: 3, binary: 4, swarm: 5, comet: 6, crystal: 7 };
let G = null;
function geo() {
  if (G) return G;
  G = {
    crystal: new THREE.IcosahedronGeometry(1, 1),
    ring: new THREE.RingGeometry(1.38, 2.2, 96, 4),
    twin: new THREE.SphereGeometry(1, 24, 16),
    tail: new THREE.CylinderGeometry(0.02, 1, 1, 24, 6, true),
    shell: new THREE.SphereGeometry(1, 28, 18),
  };
  G.ring.rotateX(-Math.PI / 2);
  G.tail.translate(0, 0.5, 0); // 밑(넓은 쪽 y=0)이 아니라 끝이 y=1: 아래에서 위로 가늘어짐 → 뒤집어 쓴다
  return G;
}

const COMMON_V = /* glsl */`#include <common>
varying vec3 vMP;`;
const BEGIN_V = /* glsl */`#include <begin_vertex>
vMP = position;`;
const COMMON_F = /* glsl */`#include <common>
varying vec3 vMP;
uniform float uT, uGlow, uSpin, uDetail, uLight, uType, uAct, uDim, uSettle, uHeat, uHeatT;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float h31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
// 세포 경계(F2-F1): 용암 균열
float cells(vec3 p) { vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z)); vec3 o = vec3(h31(i + g), h31(i + g + 17.1), h31(i + g + 31.7));
    float d = length(g + o - f); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return d2 - d1; }`;

const SUBT_F = /* glsl */`#include <emissivemap_fragment>
{
  vec3 pn = normalize(vMP);
  float lat = pn.y, lon = atan(pn.z, pn.x);
  float flow = uT * (0.1 + 0.32 * uSpin);
  float dl = lon + flow * (1.0 + 0.7 * sin(lat * 3.0));
  vec3 base = diffuseColor.rgb;
  vec3 em = emissive;
  totalEmissiveRadiance *= 0.4; // 몸체 기본 발광을 낮춰 유형 질감이 보이게(발광은 유형별 무늬가 더함)
  float lightK = mix(1.15, 0.6, uLight);
  if (uType < 0.5) {
    // 가스 거인: 굵은 띠 + 소용돌이 폭풍 점 + (도구) 번개
    float b = sin(lat * 13.0 + 0.9 * sin(dl * 2.0 + lat * 5.0) + 0.5 * sin(dl * 6.0 - lat * 9.0));
    diffuseColor.rgb *= mix(1.0, mix(0.62, 1.22, 0.5 + 0.5 * b), uDetail);
    vec2 sp = vec2(fract((dl * 0.5 + uT * 0.02) / 3.14159265 + 0.5) - 0.5, (lat + 0.32) * 1.9);
    float spot = 1.0 - smoothstep(0.04, 0.11, length(sp * vec2(2.6, 1.0)));
    float swirl = sin(atan(sp.y, sp.x) * 3.0 + length(sp) * 60.0 - uT * 2.0) * 0.5 + 0.5;
    diffuseColor.rgb = mix(diffuseColor.rgb, base * vec3(1.18, 0.9, 0.78) * (0.8 + 0.3 * swirl), spot * uDetail);
    float cell = h21(floor(vec2(dl * 4.0, lat * 7.0)) + floor(uT * 9.0));
    float flash = step(0.985 - 0.05 * uAct, cell) * uAct;
    totalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * flash * 1.6 * lightK * uDetail;
    totalEmissiveRadiance += em * uGlow * (0.3 + 0.5 * (0.5 + 0.5 * b)) * lightK;
  } else if (uType < 1.5) {
    // 용암: 어두운 지각 사이로 빛나는 균열(맥동), 도구 때 더 밝고 빠르게
    float c = cells(pn * 3.4 + vec3(0.0, uT * 0.03, 0.0));
    float crack = 1.0 - smoothstep(0.02, 0.09 + 0.04 * uAct, c);
    float n = vn(pn * 6.0 + uT * 0.05);
    diffuseColor.rgb = mix(base, base * 0.28 + 0.03, uDetail * 0.85) * (0.85 + 0.3 * n);
    float pul = 0.65 + 0.35 * sin(uT * (2.0 + 4.0 * uAct) + n * 6.0);
    vec3 hot = mix(em * 2.2 + base * 0.6, vec3(1.0, 0.86, 0.62), 0.35);
    totalEmissiveRadiance += hot * crack * pul * (0.45 + 0.4 * uGlow + 0.9 * uAct) * lightK * uDetail;
  } else if (uType < 2.5) {
    // 얼음: 옅은 색 + 극관 + 결정 반짝임
    float n = vn(pn * 5.0);
    diffuseColor.rgb = mix(base, mix(base * 0.8, vec3(0.8, 0.9, 1.0), 0.22), uDetail) * (0.82 + 0.2 * n);
    float cap = smoothstep(0.8, 0.86, abs(lat) + 0.06 * n);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.97, 1.0), cap * uDetail * 0.85);
    vec3 q = floor(pn * 38.0);
    float h = h31(q);
    float tw = pow(0.5 + 0.5 * sin(uT * (3.0 + 5.0 * uAct) + h * 40.0), 18.0);
    float glint = step(0.945 - 0.06 * uAct, h) * tw;
    totalEmissiveRadiance += vec3(0.9, 0.97, 1.0) * glint * (0.8 + 1.2 * uAct) * lightK * uDetail;
    totalEmissiveRadiance += em * uGlow * 0.35 * lightK;
  } else if (uType < 3.5) {
    // 고리 행성 몸체: 부드러운 띠
    float b = sin(lat * 8.0 + 0.4 * sin(dl * 2.0));
    diffuseColor.rgb *= mix(1.0, mix(0.8, 1.12, 0.5 + 0.5 * b), uDetail);
    totalEmissiveRadiance += em * uGlow * (0.3 + 0.4 * (0.5 + 0.5 * b)) * lightK;
  } else if (uType < 6.5) {
    // 쌍성·위성 군단·혜성 핵: 바위 얼룩 + 구덩이 테
    float n = vn(pn * 4.0 + 3.0) * 0.6 + vn(pn * 9.0) * 0.4;
    float cr = vn(pn * 5.5 + 9.0);
    float rim = smoothstep(0.55, 0.62, cr) * (1.0 - smoothstep(0.62, 0.75, cr)); // 구덩이 테(값 잡음 등고선 — 세포 잡음보다 싸다)
    float dark = uType > 5.5 ? 0.55 : uType > 4.5 ? 0.82 : 1.0;
    diffuseColor.rgb = mix(base, base * dark * (0.72 + 0.45 * n) * (0.9 + 0.2 * rim), uDetail);
    totalEmissiveRadiance += em * uGlow * (0.25 + 0.4 * n) * lightK;
  } else {
    // 결정: 면마다 반짝임(면 법선 해시), 도구 때 면 번쩍임 물결
    vec3 fn = normalize(cross(dFdx(vMP), dFdy(vMP)));
    float h = h31(floor(fn * 9.0 + 0.5));
    float wave = 0.5 + 0.5 * sin(uT * 3.0 - fn.y * 6.0);
    float sp = pow(0.5 + 0.5 * sin(uT * (0.8 + 2.5 * uAct) + h * 37.0), 14.0);
    diffuseColor.rgb = mix(base, base * (0.75 + 0.5 * h), uDetail);
    totalEmissiveRadiance += mix(em * 2.0, vec3(1.0), 0.45) * (sp * (0.35 + 0.8 * uAct) + uAct * wave * 0.25 * step(0.55, h)) * lightK * uDetail;
    totalEmissiveRadiance += em * uGlow * 0.3 * lightK;
  }
  diffuseColor.rgb *= 1.0 - 0.2 * uDim;
  totalEmissiveRadiance *= 1.0 - 0.45 * uDim;
  totalEmissiveRadiance += em * uSettle * 1.2;
  // §127.7 과열: 데움 = 테두리(대기 쪽) 주황, 과열 = 표면 균열 용암빛 맥동, 위험 = 더 붉고 넓게
  if (uHeat > 0.001) {
    float hw = ${warmGlsl('uHeat')}, hh = smoothstep(${PHEAT.HOT_H.toFixed(6)}, ${(PHEAT.HOT_H + PHEAT.RAMP).toFixed(6)}, uHeat), hcr = smoothstep(${PHEAT.CRIT_H.toFixed(6)}, ${(PHEAT.CRIT_H + PHEAT.RAMP * 0.75).toFixed(6)}, uHeat); // planet-heat-core warmOf·HOT_H·CRIT_H
    vec3 hc = mix(vec3(1.0, 0.55, 0.16), vec3(1.0, 0.2, 0.07), smoothstep(${PHEAT.RGB_LO.toFixed(6)}, ${PHEAT.RGB_HI.toFixed(6)}, uHeat));
    float fres = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * vec3(1.0, 0.68, 0.52), hc * 0.8, 0.3 + 0.3 * hh), hw * 0.55); // 몸 전체 물듦(멀리서 몸 색으로 읽힘)
    totalEmissiveRadiance += hc * hw * (0.16 + 0.22 * hh + 0.12 * hcr) * lightK;
    totalEmissiveRadiance += hc * fres * hw * (0.55 + 0.7 * hh) * lightK;
    float hn = vn(pn * 4.2 + vec3(0.0, uHeatT * 0.04, 0.0));
    float crack = (1.0 - smoothstep(0.0, 0.05 + 0.05 * hcr, abs(hn - 0.5))) * hh * max(uDetail, 0.35);
    float hp = 0.7 + 0.3 * sin(uHeatT * (2.4 + 3.0 * hcr) + hn * 12.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.35, crack * 0.5);
    totalEmissiveRadiance += hc * crack * hp * (0.9 + 0.9 * hcr) * lightK;
  }
}`;

export function injectSubType(mat, U) {
  // 같은 재질에 다시 붙이면(유형 모음 확인 등) 이미 컴파일된 프로그램이 처음 uniform 객체에 묶여 있으므로 그 객체를 고쳐 쓴다
  const old = mat.userData.plU;
  if (old) { for (const k in U) if (old[k]) old[k].value = U[k].value; else old[k] = U[k]; return old; }
  mat.userData.plU = U;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', COMMON_V).replace('#include <begin_vertex>', BEGIN_V);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', COMMON_F).replace('#include <emissivemap_fragment>', SUBT_F);
  };
  mat.customProgramCacheKey = () => 'planet-subt';
  mat.needsUpdate = true;
  return U;
}
export const mkSubU = (type) => ({ uT: { value: 0 }, uGlow: { value: 0 }, uSpin: { value: 1 }, uDetail: { value: 1 }, uLight: { value: 0 }, uType: { value: TYPE_ID[type] ?? 0 }, uAct: { value: 0 }, uDim: { value: 0 }, uSettle: { value: 0 }, uHeat: { value: 0 }, uHeatT: { value: 0 } });

// 넓은 납작 고리: 띠·간극·덩어리(돌며 보임)·행성 그림자·광택
const RING_V = /* glsl */`varying vec3 vP; varying vec3 vW; varying vec3 vN;
void main() { vP = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0)); gl_Position = projectionMatrix * viewMatrix * w; }`;
const RING_F = /* glsl */`uniform vec3 uColor, uCenter, uLightDir; uniform float uOp, uRot, uBodyR, uAct, uLight, uSeed;
varying vec3 vP; varying vec3 vW; varying vec3 vN;
void main() {
  float r = length(vP.xz);
  float t = (r - 1.38) / (2.2 - 1.38);
  float edge = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.92, 1.0, t));
  float bands = 0.55 + 0.25 * sin(r * 41.0 + uSeed) + 0.2 * sin(r * 97.0 + uSeed * 3.0);
  float gap = 1.0 - 0.85 * (1.0 - smoothstep(0.012, 0.03, abs(t - 0.62)));
  float ang = atan(vP.z, vP.x);
  float clump = 0.85 + 0.15 * sin(ang * 26.0 + uRot + r * 9.0);
  vec3 d = vW - uCenter; float along = dot(d, uLightDir); float perp = length(d - uLightDir * along);
  float shadow = along < 0.0 ? 1.0 - 0.75 * (1.0 - smoothstep(uBodyR * 0.85, uBodyR * 1.05, perp)) : 1.0;
  vec3 V = normalize(cameraPosition - vW); vec3 N = dot(vN, V) < 0.0 ? -vN : vN;
  float spec = pow(max(0.0, dot(reflect(-uLightDir, N), V)), 24.0);
  vec3 c = uColor * bands * shadow + vec3(1.0) * spec * (uLight > 0.5 ? 0.25 : 0.5) * shadow;
  c += uColor * uAct * 0.35 * clump;
  float a = uOp * edge * gap * clump * (0.55 + 0.45 * bands);
  if (a < 0.01) discard;
  gl_FragColor = vec4(c, a);
}`;

// 혜성 꼬리: 끝으로 갈수록 옅고 가운데가 밝은 원뿔(부모 반대쪽)
const TAIL_V = /* glsl */`varying vec2 vUv; varying float vF;
void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * normal); vF = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`;
const TAIL_F = /* glsl */`uniform vec3 uColor; uniform float uOp, uT, uAct; varying vec2 vUv; varying float vF;
void main() {
  float along = vUv.y; // 0 = 머리 쪽 넓은 끝? (지오메트리를 뒤집어 0 = 머리)
  float fade = pow(1.0 - along, 1.6);
  float streak = 0.7 + 0.3 * sin(vUv.x * 6.2831853 * 7.0 + along * 9.0 - uT * (1.5 + 3.0 * uAct));
  float core = pow(vF, 1.5);
  float a = uOp * fade * core * streak;
  if (a < 0.005) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const _c = new THREE.Color(), _w = new THREE.Color(), _v = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0);

/** 유형별 덧붙임을 만든다. root = 몸체 크기를 따르는 묶음(본체 반지름 1). 반환 x 는 stepSubType 이 쓴다 */
export function buildSubType(v, type, root, seed01) {
  const g = geo();
  const x = { type, root };
  if (type === 'crystal') { x.origGeo = v.mesh.geometry; v.mesh.geometry = g.crystal; v.mat.flatShading = true; v.mat.roughness = 0.25; v.mat.metalness = 0.35; v.mat.needsUpdate = true; }
  if (type === 'ice') { v.mat.roughness = 0.22; v.mat.metalness = 0.15; }
  if (type === 'ringed') {
    const U = { uColor: { value: new THREE.Color() }, uCenter: { value: new THREE.Vector3() }, uLightDir: { value: new THREE.Vector3(20, 40, 25).normalize() }, uOp: { value: 0.8 }, uRot: { value: 0 }, uBodyR: { value: 1 }, uAct: { value: 0 }, uLight: { value: 0 }, uSeed: { value: seed01 * 10 } };
    const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: RING_V, fragmentShader: RING_F, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const tilt = new THREE.Group(); tilt.rotation.set(0.42 + seed01 * 0.3, seed01 * TAU, 0.12, 'YXZ');
    const ring = new THREE.Mesh(g.ring, mat); ring.raycast = () => {};
    tilt.add(ring); root.add(tilt);
    x.ring = ring; x.ringU = U; x.ringMat = mat; x.ringRot = seed01 * 10;
  }
  if (type === 'binary') {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.08, transparent: true });
    const twin = new THREE.Mesh(g.twin, mat); twin.scale.setScalar(0.46); twin.raycast = () => {};
    root.add(twin);
    x.twin = twin; x.twinMat = mat;
  }
  if (type === 'comet') {
    const U = { uColor: { value: new THREE.Color() }, uOp: { value: 0.5 }, uT: { value: 0 }, uAct: { value: 0 } };
    const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: TAIL_V, fragmentShader: TAIL_F, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const tail = new THREE.Mesh(g.tail, mat); tail.raycast = () => {}; tail.frustumCulled = false;
    // 꼬리 = 노드 그룹 직속(몸체 회전과 무관하게 방향만), 크기는 매 프레임
    v.group.add(tail);
    x.tail = tail; x.tailU = U; x.tailMat = mat; x.tailLen = 2.4;
  }
  return x;
}

/** 매 프레임. c = {spin, glow}, act = 도구 반응(0..1), s = 본체 반지름(세계), op = 투명도, dirAway = 부모 반대쪽(세계, 단위) */
export function stepSubType(x, v, now, dt, c, act, s, op, lod, light, orbits, dirAway, sparks, reduced) {
  const k = reduced ? 0.15 : 1;
  if (x.ring) {
    x.ring.visible = lod >= 1;
    x.ringRot += dt * (0.3 + 2.2 * act) * k;
    const U = x.ringU;
    U.uRot.value = x.ringRot; U.uAct.value = act; U.uOp.value = op * (light ? 0.75 : 0.85); U.uLight.value = light ? 1 : 0;
    v.group.getWorldPosition(U.uCenter.value); U.uBodyR.value = s;
    const b = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (x.ringMat.blending !== b) { x.ringMat.blending = b; x.ringMat.needsUpdate = true; }
  }
  if (x.twin) {
    // 짝 몸체 = 첫 궤도(1.75)를 따라 — 궤도계가 계산한 각도를 그대로 쓴다
    const R = orbits && orbits.rings[0];
    x.twin.visible = lod >= 1 && !!R;
    if (R) {
      const r = R.r, th = R.th;
      const rr = (r.a * (1 - r.e * r.e)) / (1 + r.e * Math.cos(th));
      _v.set(Math.cos(th) * rr, 0, Math.sin(th) * rr).applyEuler(R.grp.rotation);
      x.twin.position.copy(_v);
      x.twin.rotation.y += dt * 0.6 * k;
    }
    x.twinMat.opacity = op; x.twinMat.depthWrite = op >= 0.99;
    // 도구 때 둘 사이 입자 다리
    if (act > 0.3 && sparks && lod >= 2 && !reduced && Math.random() < dt * 14 * act) {
      const from = x.twin.getWorldPosition(new THREE.Vector3());
      const to = v.group.getWorldPosition(new THREE.Vector3());
      const d = to.sub(from); const len = d.length(); d.multiplyScalar(1 / Math.max(1e-6, len));
      sparks.emit(from, d, len * 1.4, 0.08, 0.7, x.twinMat.color, 0.6);
    }
  }
  if (x.tail) {
    const on = lod >= 1;
    x.tail.visible = on;
    if (on) {
      const len = s * (2.2 + 1.8 * act + 0.3 * Math.sin(now * 1.3));
      x.tailLen = len;
      // 원뿔은 +y 로 가늘어짐(넓은 끝 = 머리) → +y 를 부모 반대쪽으로
      x.tail.quaternion.setFromUnitVectors(_u, dirAway);
      x.tail.scale.set(s * 0.95, len, s * 0.95);
      x.tail.position.copy(dirAway).multiplyScalar(s * 0.2);
      x.tailU.uOp.value = op * (light ? 0.35 : 0.5) * (0.6 + 0.6 * c.glow + 0.5 * act);
      x.tailU.uT.value = now % 1000; x.tailU.uAct.value = act;
      const b = light ? THREE.NormalBlending : THREE.AdditiveBlending;
      if (x.tailMat.blending !== b) { x.tailMat.blending = b; x.tailMat.needsUpdate = true; }
    }
  }
}

export function setSubTypeColors(x, base, light) {
  if (x.ringU) x.ringU.uColor.value.copy(base).lerp(_w.set(light ? 0x3a4252 : 0xe6ecf5), light ? 0.25 : 0.4);
  if (x.twinMat) { x.twinMat.color.copy(base).lerp(_w.set(light ? 0x6b7383 : 0xd2d8e2), 0.35); x.twinMat.emissive.copy(base).multiplyScalar(0.12); }
  if (x.tailU) x.tailU.uColor.value.copy(base).lerp(_w.set(light ? 0x2a3242 : 0xffffff), light ? 0.2 : 0.5);
}

export function disposeSubType(x, v) {
  if (x.origGeo && v) { v.mesh.geometry = x.origGeo; v.mat.flatShading = false; v.mat.needsUpdate = true; }
  if (x.ringMat) x.ringMat.dispose();
  if (x.twinMat) x.twinMat.dispose();
  if (x.tail) { x.tail.removeFromParent(); x.tailMat.dispose(); }
}
