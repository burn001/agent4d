// Planet 전체 보기 섬 = 원형 궤도계 — 섬 하나 = 원판 메시 하나(셰이더).
// 항성(메인) 자리의 옅은 빛, 항성마다 실제 노드 거리 단계(c.stars[].rings)의 동심 궤도 고리(실선·점선 번갈아, 아주 천천히 돎),
// 쌍성(마주 보기)의 공전 고리, 가장자리 링 + 관측 눈금(5°·30°), 가운데 → 가장자리로 아주 옅은 원판. 흐름·복셀 섬은 그대로(islands.js 의 예전 도형).
import * as THREE from 'three';

export const ORB_MAX_RINGS = 12;

const VS = /* glsl */`
varying vec2 vP;
void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FS = /* glsl */`
#define NR ${ORB_MAX_RINGS}
uniform vec3 uLine; uniform vec3 uFill; uniform vec3 uGlow;
uniform float uAlpha, uFillA, uLineA, uTime, uR, uTicks, uHot, uRim;
uniform vec4 uRings[NR];   // (cx, cz, r, style) 원판 좌표(반지름 1 = 섬 가장자리). style 0 = 실선, 1 = 점선, 2 = 공전 고리
uniform int uNR;
uniform vec4 uStars[4];    // (x, z, 빛 반지름, 세기)
uniform int uNS;
varying vec2 vP;
float lineAA(float d, float w, float px) { return 1.0 - smoothstep(w, w + px * 1.2, abs(d)); }
void main() {
  float r = length(vP);
  float px = max(fwidth(r), 1e-5);
  if (r > 1.0 + px * 2.0) discard;
  float a = atan(vP.y, vP.x);
  // 원판: 가운데 투명 → 가장자리로 아주 옅게(관측 화면의 렌즈 비네트)
  float fill = uFillA * (0.25 + 0.75 * smoothstep(0.35, 1.0, r)) * (1.0 - smoothstep(1.0 - px, 1.0 + px, r));
  vec3 col = uFill; float al = fill;
  // 항성 빛
  float sg = 0.0;
  for (int i = 0; i < 4; i++) { if (i >= uNS) break; vec4 s = uStars[i]; float d = length(vP - s.xy); sg += s.w * exp(-d * d / max(1e-4, s.z * s.z)); }
  col = mix(col, uGlow, clamp(sg * 2.0, 0.0, 1.0)); al += sg * 0.5;
  // 궤도 고리
  float ln = 0.0;
  for (int i = 0; i < NR; i++) {
    if (i >= uNR) break;
    vec4 q = uRings[i];
    vec2 d2 = vP - q.xy; float rr = length(d2);
    float pxr = px; // 거리장 기울기 크기는 어디서나 같음 — 반복문 안 fwidth 는 ANGLE(D3D)에서 0 이 되어 선이 사라졌다
    float on = lineAA(rr - q.z, pxr * 0.5, pxr);
    if (on < 0.002) continue;
    float k = 0.62;
    if (q.w > 1.5) { k = 0.85; }                           // 공전 고리(쌍성)
    else if (q.w > 0.5) {                                  // 점선: 세계 길이 약 1.4 의 토막, 아주 천천히 돎
      float ang = atan(d2.y, d2.x) + uTime * 0.025 * (mod(float(i), 2.0) * 2.0 - 1.0);
      float n = max(12.0, floor(q.z * uR * 6.2832 / 1.4));
      float f = fract(ang / 6.2832 * n);
      k = 0.95 * smoothstep(0.0, 0.12, f) * (1.0 - smoothstep(0.42, 0.54, f));
    }
    ln = max(ln, on * k);
  }
  // 가장자리 링 + 안쪽 눈금(5° 짧게, 30° 길게)
  float rim = lineAA(r - (1.0 - px * 1.5), px * 0.6, px);
  float t5 = 72.0 * a / 6.2832, w5 = px / max(r, 1e-3) * 72.0 / 6.2832;
  float f5 = abs(fract(t5 + 0.5) - 0.5);
  float tick = (1.0 - smoothstep(w5 * 0.6, w5 * 1.6, f5)) * step(1.0 - 0.022 * uTicks, r) * step(r, 1.0 - px * 2.5);
  float t30 = 12.0 * a / 6.2832, w30 = px / max(r, 1e-3) * 12.0 / 6.2832;
  float f30 = abs(fract(t30 + 0.5) - 0.5);
  float tick30 = (1.0 - smoothstep(w30 * 0.7, w30 * 1.8, f30)) * step(1.0 - 0.055 * uTicks, r) * step(r, 1.0 - px * 2.5);
  float edge = max(rim * uRim * (1.0 + 0.25 * uHot), max(tick * 0.55, tick30 * 0.85) * uTicks);
  float L = max(ln, edge);
  col = mix(col, uLine, clamp(L / max(1e-3, L + al), 0.0, 1.0));
  al = max(al, L * uLineA);
  gl_FragColor = vec4(col, al * uAlpha);
}`;

const GEO = (() => { let g = null; return () => { if (!g) { g = new THREE.CircleGeometry(1, 160); g.rotateX(-Math.PI / 2); } return g; }; })();

/** 원판 메시 하나(섬 지역 원점 = 항성 자리 기준 섬 중심) */
export function makeOrbitDisc() {
  const u = {
    uLine: { value: new THREE.Color() }, uFill: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uAlpha: { value: 1 }, uFillA: { value: 0.05 }, uLineA: { value: 0.3 }, uTime: { value: 0 }, uR: { value: 10 }, uTicks: { value: 1 }, uHot: { value: 0 }, uRim: { value: 0.9 },
    uRings: { value: Array.from({ length: ORB_MAX_RINGS }, () => new THREE.Vector4()) }, uNR: { value: 0 },
    uStars: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }, uNS: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  mat.extensions = { derivatives: true };
  const mesh = new THREE.Mesh(GEO(), mat);
  mesh.renderOrder = -1; // 흐름 섬 테두리(-1)처럼 기상 안개 판(-1.8)·물방울(-1.7) 뒤에 — 안개가 고리·눈금을 덮어 지우지 않게
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  return mesh;
}

/** 클러스터 c(round·stars·orbit) → 원판 uniform(크기·고리·항성). 섬 지역 좌표 → 원판 좌표(÷R) */
export function syncOrbitDisc(mesh, c, Rnow = 0) {
  const R = Math.max(1, Rnow > 0 ? Rnow : c.round || c.r || 1); // Rnow: 반지름이 바뀌는 동안 그리는 값(islands.js 보간)
  const u = mesh.material.uniforms;
  mesh.scale.setScalar(R);
  u.uR.value = R;
  let n = 0;
  const ring = (x, z, r, st) => { if (n >= ORB_MAX_RINGS || !(r > 0) || r > R * 0.985) return; u.uRings.value[n++].set(x / R, z / R, r / R, st); };
  const stars = c.stars || [];
  if (c.orbit) ring(c.orbit.cx || 0, c.orbit.cz || 0, c.orbit.r, 2);
  // 항성이 여럿이면 항성마다 고리를 고르게 나눠 받음
  const per = stars.length > 1 ? 3 : 4; // 너무 많은 고리는 어지러움 — 항성 하나 4, 여럿이면 3 씩(가까운 단계부터)
  // 고리가 없는 항성(노드 하나뿐인 섬)은 장식 궤도 둘(점선·실선)로 — 빈 원판으로 보이지 않게
  for (const s of stars) (s.rings.length ? s.rings : [R * 0.4, R * 0.66]).slice(0, per).forEach((r, i) => ring(s.x, s.z, r, s.rings.length ? i % 2 : 1 - i));
  u.uNR.value = n;
  let m = 0;
  for (const s of stars.slice(0, 4)) u.uStars.value[m++].set(s.x / R, s.z / R, Math.min(0.35, 7 / R), 0.32);
  u.uNS.value = m;
  u.uTicks.value = c.inactive ? 0 : 1;
}

/** 테마·세기: line/fill/glow = THREE.Color, a = 전체(페이드 곱) */
export function styleOrbitDisc(mesh, { line, fill, glow, a = 1, fillA = 0.05, lineA = 0.3, hot = 0, rim = 0.9 }) {
  const u = mesh.material.uniforms;
  u.uLine.value.copy(line); u.uFill.value.copy(fill); u.uGlow.value.copy(glow);
  u.uAlpha.value = a; u.uFillA.value = fillA; u.uLineA.value = lineA; u.uHot.value = hot; u.uRim.value = rim;
}
