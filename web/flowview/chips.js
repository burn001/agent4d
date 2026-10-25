// 흐름(Flow) 표현의 노드: 육각 기둥(프리즘, 인스턴싱)
// agent-flow 의 노드 그림을 셰이더로: 바깥 글로우 · 옅은 바깥 육각 테두리 · 어두운 내부 · 내부를 지나는 스캔라인 · 상태색 테두리
// (완료=점선·흐림, 오류=맥동) · 가운데 종류 아이콘 · 생각 중엔 도는 입자 4개, 도구 사용 중엔 도는 호(스피너) · 컨텍스트 사용률 고리.
// 예전 빌보드 칩 대신 두께 있는 육각 기둥 — 위 그림은 윗면(바닥과 나란한 면)에 그대로, 옆면은 같은 상태색 테두리(위·아래 띠·모서리)와
// 아래로 흐르는 스캔라인, 방향광 음영. 기둥 1회 그리기(윗면+옆면, 뒤→앞 정렬) + 그림자 1회 그리기(바닥 그림자 원반 + 바닥까지 점선 기둥줄).
// 거리 안개(장면 안개 색 = 배경)·아래층일수록 어둡게(tier-core tierDim). 배치 장치는 같은 자리에서 넓은 상자 기둥.
import * as THREE from 'three';
import { nodeVisualState, stateColor, kindIcon, paletteOf, breathe, NODE_STATE } from './flow-style.mjs';
import { bandCode, cycleProgress } from '../batch-core.mjs';

const QUAD = 1.9; // 노드 반지름 대비 사각형 반폭(글로우·고리 여백)

// 정점 셰이더: 기둥(윗면 aPart 0 · 옆면 1)과 그림자(원반 2 · 기둥줄 3)를 같은 인스턴스 속성으로. 위치는 셰이더가 계산(기하 = 모양 틀)
const VS = `
attribute vec4 aShape; attribute vec4 aNorm; attribute vec2 aMeta; // 육각 모서리 xy·상자 모서리 zw / 옆면 바깥 법선(육각 xy·상자 zw) / 부분·둘레 좌표
attribute vec3 iColor; attribute vec3 iKind; attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; attribute vec4 iD;
uniform float uStemW; uniform float uFogNear; uniform float uFogFar;
varying vec2 vP; varying vec3 vColor; varying vec3 vKind; varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD;
varying float vPart; varying float vFace; varying float vShade; varying float vFog;
void main() {
  float aPart = aMeta.x, aU = aMeta.y;
  vec2 aHex = aShape.xy, aBox = aShape.zw, aNHex = aNorm.xy, aNBox = aNorm.zw;
  vColor = iColor; vKind = iKind; vA = iA; vB = iB; vC = iC; vD = iD; vPart = aPart; vFace = 1.0; vShade = 1.0;
  vec3 C = instanceMatrix[3].xyz;
  float s = length(instanceMatrix[0].xyz);
  bool dev = iC.x > 0.5;
  float H = iD.z * s;            // 기둥 두께
  float gy = iD.x;               // 바닥 높이
  vec3 w;
  if (aPart < 0.5) {             // 윗면: 예전 칩 그림을 바닥과 나란히 눕힘(그림의 위 = -z)
    vP = aHex * ${QUAD.toFixed(2)};
    w = C + vec3(vP.x * s, H * 0.5, -vP.y * s);
  } else if (aPart < 1.5) {      // 옆면: 육각(배치 장치는 넓은 상자) 모서리, 바깥 법선으로 앞뒤·음영
    vec2 q = dev ? aBox : aHex;
    vec2 nn = dev ? aNBox : aNHex;
    w = C + vec3(q.x * s, (position.z - 0.5) * H, -q.y * s);
    vec3 n = normalize(vec3(nn.x, 0.0, -nn.y));
    vFace = dot(n, normalize(cameraPosition - w));
    vShade = 0.45 + 0.55 * max(0.0, dot(n, normalize(vec3(-0.45, 0.6, 0.66))));
    vP = vec2(aU, position.z);
  } else if (aPart < 2.5) {      // 그림자 원반(바닥): 높을수록 넓고 옅게
    float hg = max(0.0, C.y - gy);
    float R = s * (dev ? 1.9 : 1.35) * (1.0 + hg * 0.035);
    vP = aHex;
    w = vec3(C.x + aHex.x * R, gy + 0.05, C.z - aHex.y * R);
    vShade = hg;
  } else {                       // 바닥 → 기둥 밑면 점선 기둥줄(세로축 빌보드)
    float hg = max(0.0, C.y - H * 0.5 - gy);
    vec3 b = vec3(C.x, gy + position.z * hg, C.z);
    vec3 tc = cameraPosition - b;
    vec3 r = normalize(vec3(tc.z, 0.0, -tc.x) + vec3(1e-4, 0.0, 0.0));
    w = b + r * aHex.x * uStemW;
    vP = vec2(aHex.x, position.z * hg);
    vShade = hg;
  }
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FS = `
uniform float uTime; uniform float uLight; uniform vec3 uInterior; uniform vec3 uHolo; uniform vec3 uWarn; uniform vec3 uErr; uniform vec3 uOk; uniform vec3 uStop;
uniform vec3 uFog; uniform float uFogMax;
varying vec2 vP; varying vec3 vColor; varying vec3 vKind; varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD;
varying float vPart; varying float vFace; varying float vShade; varying float vFog;
// 아래층일수록 어둡게(다크)·옅게(라이트) + 거리 안개(장면 안개 색 = 배경)
vec4 finish(vec3 col, float al) {
  float dim = vD.y;
  if (uLight > 0.5) col = mix(col, uFog, dim * 0.55); else col *= 1.0 - dim;
  col = mix(col, uFog, vFog * uFogMax);
  return vec4(col, clamp(al, 0.0, 1.0) * vA.z * (1.0 - vFog * uFogMax * 0.3));
}
// 꼭짓점이 위인 정육각형: 변에서 1
float hexD(vec2 p) { p = abs(p); return max(p.x, 0.5 * p.x + 0.8660254 * p.y) / 0.8660254; }
// 배치 장치(§51): 넓고 낮은 모서리 둥근 상자(가로 1.45 · 세로 0.82) — 변에서 1
float devD(vec2 p) { vec2 q = abs(p) / vec2(1.45, 0.82); vec2 r = max(q - 0.78, 0.0) / 0.22; return max(max(q.x, q.y), 0.78 + 0.22 * length(r)); }
vec3 bandC(float b) { return b < 1.5 ? uWarn : b < 2.5 ? uOk : b < 3.5 ? uStop : uErr; }
float line(float d, float at, float w) { return smoothstep(w, 0.0, abs(d - at)); }
float seg(vec2 p, vec2 a, vec2 b, float w) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return smoothstep(w, w * 0.35, length(pa - ba * h)); }
float icon(vec2 p, float k) {
  float r = 0.0;
  if (k < 0.5) {        // 별(메인): 네 갈래 빛
    float a = atan(p.y, p.x), l = length(p);
    float rays = pow(abs(cos(a * 2.0)), 8.0) * 0.55 + 0.12;
    r = smoothstep(rays + 0.03, rays - 0.03, l) * step(l, 0.62);
  } else if (k < 1.5) { r = line(abs(p.x) + abs(p.y), 0.42, 0.07); }                       // 마름모
  else if (k < 2.5) { r = line(max(abs(p.x), abs(p.y)), 0.34, 0.07); }                     // 사각
  else if (k < 3.5) { vec2 q = p + vec2(0.0, 0.08); r = line(max(abs(q.x) * 0.866 + q.y * 0.5, -q.y), 0.26, 0.07); } // 삼각
  else if (k < 4.5) { r = smoothstep(0.3, 0.24, abs(p.x) + abs(p.y)); }                    // 채운 작은 마름모
  else if (k < 5.5) { r = max(seg(p, vec2(-0.28, 0.24), vec2(0.04, 0.0), 0.08), seg(p, vec2(0.04, 0.0), vec2(-0.28, -0.24), 0.08)); r = max(r, seg(p, vec2(0.1, -0.26), vec2(0.34, -0.26), 0.08)); } // >_
  else { r = smoothstep(0.07, 0.02, abs(p.y - 0.18 * sin(p.x * 9.0 - uTime * 4.0))) * step(abs(p.x), 0.42); } // 파형
  return r;
}
void main() {
  float st = vA.x, ik = vA.y, alpha = vA.z, ctxp = vA.w;
  float seed = vB.x, foc = vB.y, glowK = vB.z;
  if (alpha < 0.004) discard;
  bool light = uLight > 0.5;
  vec2 p = vP;
  bool dev = vC.x > 0.5;
  float T = uTime + seed * 10.0;
  vec3 C = vColor;
  if (vPart > 2.5) {             // 기둥줄: 아래로 흐르는 점선, 가운데 진하게
    float lineA = smoothstep(1.0, 0.15, abs(p.x));
    float dash = step(0.5, fract(p.y * 0.7 + uTime * 0.35));
    float al = lineA * dash * (light ? 0.34 : 0.26) * (0.4 + 0.6 * smoothstep(0.0, 2.0, p.y));
    gl_FragColor = vec4(mix(C, uFog, vFog * uFogMax), al * alpha);
    return;
  }
  if (vPart > 1.5) {             // 그림자 원반: 부드러운 어두운 가운데 + 상태색 옅은 테
    float dd = length(p);
    if (dd > 1.0) discard;
    float hk = 1.0 / (1.0 + vShade * 0.05);
    float core = 1.0 - smoothstep(0.0, 1.0, dd); core *= core;
    float rim = smoothstep(0.08, 0.0, abs(dd - 0.82));
    vec3 col = light ? mix(vec3(0.22, 0.27, 0.36), C, rim * 0.75) : mix(vec3(0.0), C, rim);
    float al = (core * (light ? 0.3 : 0.6) + rim * (light ? 0.16 : 0.2)) * hk;
    gl_FragColor = vec4(mix(col, uFog, vFog * uFogMax), al * alpha);
    return;
  }
  if (vPart > 0.5) {             // 옆면: 어두운 몸 + 방향광 음영 + 위·아래 상태색 띠 + 모서리 + 아래로 흐르는 스캔라인
    if (vFace < 0.0) discard;
    float h = p.y;
    vec3 body = mix(uInterior, C, light ? 0.14 : 0.2);
    vec3 col = body * (light ? 0.8 + 0.2 * vShade : vShade) * (0.72 + 0.28 * h);
    float k = floor(p.x + 0.5);
    float corner = (dev && mod(k, 3.0) < 0.5) ? 0.0 : 1.0;   // 상자는 가짜 모서리(가운데) 빼고
    float edge = smoothstep(0.05, 0.0, abs(p.x - k)) * 0.5 * corner;
    float rim = max(smoothstep(0.18, 0.0, 1.0 - h), smoothstep(0.1, 0.0, h) * 0.4);
    if (st > 2.5 && st < 3.5) rim *= 0.5;
    if (st > 3.5 && st < 4.5) rim *= 0.75 + 0.25 * sin(T * 6.0);
    if (st > 4.5) rim *= 0.6;
    float sp = (st > 0.5 && st < 2.5) ? 1.3 : 0.45;
    float sy = 1.0 - fract(T * sp * 0.5);
    float scan = smoothstep(0.1, 0.0, abs(h - sy)) * (light ? 0.2 : 0.32);
    float lit = max(max(rim, edge), scan);
    col = mix(col, light ? C * 0.9 : mix(C, vec3(1.0), 0.1), lit);
    gl_FragColor = finish(col, light ? 0.96 : 0.94);
    return;
  }
  float d = dev ? devD(p) : hexD(p), l = length(p);
  vec3 col = vec3(0.0); float al = 0.0;
  // 바깥 글로우(상태색)
  float ga = (foc > 0.5 ? 0.42 : st > 0.5 && st < 2.5 ? 0.24 : 0.12) * glowK;
  float glow = exp(-max(d - 1.0, 0.0) * 3.2) * step(1.0, d) * ga;
  col = C; al = glow;
  // 옅은 바깥 육각
  float outer = line(d, 1.22, 0.025) * 0.28;
  col = mix(col, C, outer); al = max(al, outer);
  // 내부
  if (d < 1.0) {
    vec3 inner = mix(uInterior, C, light ? 0.06 : 0.1);
    col = inner; al = light ? 0.96 : 0.93;
    // 스캔라인: 생각·도구 중엔 빠르게
    float sp = (st > 0.5 && st < 2.5) ? 1.3 : 0.45;
    float sy = -1.0 + mod(T * sp, 2.0);
    float scan = smoothstep(0.16, 0.0, abs(p.y - sy)) * (light ? 0.16 : 0.22);
    col = mix(col, C, scan);
    if (dev) {
      // 장치 앞면: 위 = 회차 진행 막대(경과/평균), 오른쪽 위 = 진행 표시등, 아래 = 최근 회차 상태 띠(오래된 → 최근)
      float code = vC.y, nb = vC.z, prog = vC.w;
      vec2 sp = p - vec2(-0.2, 0.3);
      if (abs(sp.y) < 0.09 && abs(sp.x) < 0.9) {
        float fillx = (sp.x + 0.9) / 1.8;
        bool on = prog >= 0.0 && fillx <= prog;
        col = mix(col, on ? uWarn : C, on ? 0.85 : 0.22);
      }
      float ledOn = prog >= 0.0 || code > 0.0 ? 1.0 : 0.0;
      float led = smoothstep(0.13, 0.07, length(p - vec2(1.0, 0.3)));
      float blink = prog >= 0.0 ? (0.45 + 0.55 * step(0.0, sin(T * 6.0))) : 0.35;
      col = mix(col, prog >= 0.0 ? uWarn : uOk, led * blink * ledOn);
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float cx = -1.0 + fi * 0.5;
        vec2 bp = p - vec2(cx, -0.36);
        float cell = step(abs(bp.x), 0.19) * step(abs(bp.y), 0.13);
        float slot = fi - (5.0 - nb);           // 오른쪽 정렬: 최근이 오른쪽 끝
        float b = 0.0;
        if (slot >= 0.0) b = mod(floor(code / pow(5.0, slot) + 0.001), 5.0);
        vec3 bc = b > 0.5 ? bandC(b) : C;
        float pul = b > 0.5 && b < 1.5 ? 0.7 + 0.3 * sin(T * 4.0) : 1.0;
        col = mix(col, bc, cell * (b > 0.5 ? 0.9 * pul : 0.18));
      }
    } else {
    // 아이콘
    float ic = icon(p / 0.95, ik);
    vec3 icC = mix(vKind, C, 0.35);
    col = mix(col, light ? icC * 0.9 : mix(icC, vec3(1.0), 0.15), ic * 0.9);
    }
  }
  // 상태색 테두리: 완료 = 점선·흐림, 중지 = 회색 얇게, 오류 = 맥동
  float w = foc > 0.5 ? 0.075 : 0.055;
  float ring = line(d, 1.0, w);
  if (st > 2.5 && st < 3.5) { float a = atan(p.y, p.x); ring *= step(0.5, fract(a / 6.2831853 * 24.0)) * 0.55; }
  if (st > 3.5 && st < 4.5) ring *= 0.75 + 0.25 * sin(T * 6.0);
  if (st > 4.5) ring *= 0.6;
  col = mix(col, light ? C * 0.9 : mix(C, vec3(1.0), 0.1), ring); al = max(al, ring);
  // 생각 중: 도는 입자 4개 / 도구 사용 중: 도는 호(스피너)
  if (st > 0.5 && st < 1.5) {
    float best = 0.0;
    for (int i = 0; i < 4; i++) { float a = T * 1.5 + float(i) * 1.5707963; vec2 q = vec2(cos(a), sin(a)) * 1.36; best = max(best, smoothstep(0.075, 0.03, length(p - q))); }
    col = mix(col, C, best); al = max(al, best * 0.8);
  } else if (st > 1.5 && st < 2.5) {
    float a = atan(p.y, p.x), a0 = mod(T * 3.0, 6.2831853);
    float da = mod(a - a0 + 6.2831853, 6.2831853);
    float arc = line(l, 1.38, 0.04) * step(da, 1.6) * (0.35 + 0.65 * (da / 1.6));
    col = mix(col, C, arc); al = max(al, arc * 0.85);
  }
  // 컨텍스트 사용률 고리(위에서 시계 방향, 50% 미만 하늘·75% 미만 호박·그 이상 빨강 맥동)
  if (ctxp > 0.001) {
    float a = atan(p.x, p.y); a = a < 0.0 ? a + 6.2831853 : a;
    float track = line(l, 1.55, 0.035);
    float fill = track * step(a / 6.2831853, ctxp);
    vec3 cc = ctxp < 0.5 ? uHolo : ctxp < 0.75 ? uWarn : uErr;
    float pul = ctxp >= 0.75 ? 0.75 + 0.25 * sin(T * 6.0) : 1.0;
    col = mix(col, uHolo, track * 0.12 * (1.0 - fill)); al = max(al, track * 0.12);
    col = mix(col, cc, fill); al = max(al, fill * 0.9 * pul);
  }
  gl_FragColor = finish(col, al);
}`;

// 모양 틀(정점 속성) — 육각 모서리(꼭짓점이 위, 외접 반지름 1)와 배치 장치 상자(1.45 × 0.82: 육각 모서리 i 를 상자 둘레 점에 대응, 0·3 은 변 가운데 가짜 모서리)
const HEX = [[0, 1], [0.8660254, 0.5], [0.8660254, -0.5], [0, -1], [-0.8660254, -0.5], [-0.8660254, 0.5]];
const BOX = [[0, 0.82], [1.45, 0.82], [1.45, -0.82], [0, -0.82], [-1.45, -0.82], [-1.45, 0.82]];
const BOX_N = [[0, 1], [1, 0], [0, -1], [0, -1], [-1, 0], [0, 1]];
/** 기둥 틀: 윗면 사각(4) + 옆면 6장(각 4) */
function prismGeometry() {
  const P = [], part = [], hex = [], box = [], nh = [], nb = [], u = [], idx = [];
  const quad = (o) => idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  const put = (pp, z, h, b, n1, n2, uu) => { P.push(0, 0, z); part.push(pp); hex.push(h[0], h[1]); box.push(b[0], b[1]); nh.push(n1[0], n1[1]); nb.push(n2[0], n2[1]); u.push(uu); };
  // 옆면 먼저(같은 인스턴스 안에서 윗면이 나중에 그려져 위를 덮음)
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6, o = P.length / 3;
    const a = (Math.PI / 2) - (Math.PI / 3) * i - Math.PI / 6, n = [Math.cos(a), Math.sin(a)];
    put(1, 0, HEX[i], BOX[i], n, BOX_N[i], i); put(1, 0, HEX[j], BOX[j], n, BOX_N[i], i + 1);
    put(1, 1, HEX[j], BOX[j], n, BOX_N[i], i + 1); put(1, 1, HEX[i], BOX[i], n, BOX_N[i], i);
    quad(o);
  }
  const o = P.length / 3;
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) put(0, 1, [x, y], [x, y], [0, 1], [0, 1], 0);
  quad(o);
  return frame(P, part, hex, box, nh, nb, u, idx);
}
/** 그림자 틀: 바닥 원반 사각(4) + 기둥줄 사각(4) */
function shadowGeometry() {
  const P = [], part = [], hex = [], box = [], nh = [], nb = [], u = [], idx = [];
  const z0 = [0, 0];
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { P.push(0, 0, 0); part.push(2); hex.push(x, y); box.push(x, y); nh.push(...z0); nb.push(...z0); u.push(0); }
  for (const [x, z] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) { P.push(0, 0, z); part.push(3); hex.push(x, 0); box.push(x, 0); nh.push(...z0); nb.push(...z0); u.push(0); }
  idx.push(0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7);
  return frame(P, part, hex, box, nh, nb, u, idx);
}
function frame(P, part, hex, box, nh, nb, u, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  // 정점 속성은 셋으로 묶는다(인스턴스 행렬 4칸 + 인스턴스 속성 6 + 정점 4 = 14 ≤ WebGL 최소 한도 16)
  const n = part.length, shape = new Float32Array(n * 4), norm = new Float32Array(n * 4), meta = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    shape[i * 4] = hex[i * 2]; shape[i * 4 + 1] = hex[i * 2 + 1]; shape[i * 4 + 2] = box[i * 2]; shape[i * 4 + 3] = box[i * 2 + 1];
    norm[i * 4] = nh[i * 2]; norm[i * 4 + 1] = nh[i * 2 + 1]; norm[i * 4 + 2] = nb[i * 2]; norm[i * 4 + 3] = nb[i * 2 + 1];
    meta[i * 2] = part[i]; meta[i * 2 + 1] = u[i];
  }
  g.setAttribute('aShape', new THREE.BufferAttribute(shape, 4));
  g.setAttribute('aNorm', new THREE.BufferAttribute(norm, 4));
  g.setAttribute('aMeta', new THREE.BufferAttribute(meta, 2));
  g.setIndex(idx);
  return g;
}
// 기둥 두께(칩 반지름 배수): 메인은 조금 더 두껍게, 배치 장치는 납작한 상자
// 깊이만 쓰는 패스: 색 셰이더를 그대로 돌리고 눈에 보일 만큼 불투명한 조각만 깊이를 남긴다(빛무리·투명한 테두리 밖·희미한 퇴장 노드는 앞의 선을 가리지 않음)
const FS_DEPTH = FS.replace('void main() {', 'void mainColor() {') + `
void main() { mainColor(); if (gl_FragColor.a < 0.35) discard; }
`;
const THICK = { main: 1.0, device: 0.62, other: 0.85 };

export class NodeChips {
  constructor(scene, view, cap = 1024) {
    this.view = view;
    this.cap = cap;
    const geo = prismGeometry(), sgeo = shadowGeometry();
    const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aColor = mk(3); this.aKind = mk(3); this.aA = mk(4); this.aB = mk(4); this.aC = mk(4); this.aD = mk(4);
    for (const g of [geo, sgeo]) { g.setAttribute('iColor', this.aColor); g.setAttribute('iKind', this.aKind); g.setAttribute('iA', this.aA); g.setAttribute('iB', this.aB); g.setAttribute('iC', this.aC); g.setAttribute('iD', this.aD); }
    this.uniforms = { uTime: { value: 0 }, uLight: { value: 0 }, uInterior: { value: new THREE.Color() }, uHolo: { value: new THREE.Color() }, uWarn: { value: new THREE.Color() }, uErr: { value: new THREE.Color() }, uOk: { value: new THREE.Color() }, uStop: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() }, uFogNear: { value: 80 }, uFogFar: { value: 300 }, uFogMax: { value: 0.5 }, uStemW: { value: 0.08 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    // 깊이: 칩은 반투명(깊이 안 씀)이라 예전엔 renderOrder 2 로 빔(1)·띄움 점선 뒤에 덧그려져 카메라에서 먼 노드가 앞의 선을 가렸다.
    // 이제 칩(색, 1) → 칩 깊이만(1.5, 같은 셰이더·discard, 색 안 씀) → 빔·띄움 점선(2)·패킷(3) 순: 선은 노드 뒤면 가려지고 앞이면 노드 위에 그려진다.
    this.mesh.renderOrder = 1;
    this.dmat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS_DEPTH, transparent: true, depthWrite: true, colorWrite: false, side: THREE.DoubleSide });
    this.depth = new THREE.InstancedMesh(geo, this.dmat, cap);
    this.depth.instanceMatrix = this.mesh.instanceMatrix;
    this.depth.count = 0;
    this.depth.frustumCulled = false;
    this.depth.renderOrder = 1.5;
    // 그림자(바닥 원반 + 기둥줄): 같은 인스턴스 속성·행렬을 나눠 쓰고, 바닥층 다음·빔 전에
    this.shadow = new THREE.InstancedMesh(sgeo, this.mat, cap);
    this.shadow.instanceMatrix = this.mesh.instanceMatrix;
    this.shadow.count = 0;
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 0.5;
    scene.add(this.shadow, this.mesh, this.depth);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._c = new THREE.Color(); this._f = new THREE.Vector3();
    this._colCache = new Map();
    this._order = [];
    this.isLight = false;
  }
  applyTheme(isLight) {
    this.isLight = !!isLight;
    const P = paletteOf(this.isLight);
    this.uniforms.uLight.value = this.isLight ? 1 : 0;
    this.uniforms.uInterior.value.set(P.interior);
    this.uniforms.uHolo.value.set(P.holo); this.uniforms.uWarn.value.set(P.tool); this.uniforms.uErr.value.set(P.error);
    this.uniforms.uOk.value.set(P.done); this.uniforms.uStop.value.set(P.stopped);
    this._colCache.clear();
  }
  _col(state) {
    let c = this._colCache.get(state);
    if (!c) { c = new THREE.Color(stateColor(state, this.isLight)); this._colCache.set(state, c); }
    return c;
  }
  update(now) {
    const view = this.view;
    this.uniforms.uTime.value = now % 1000;
    const C = this.aColor.array, K = this.aKind.array, A = this.aA.array, B = this.aB.array, D = this.aC.array;
    const nowMs = view.clock ? view.clock() : Date.now();
    // 뒤 → 앞으로(카메라 시선 깊이) 정렬: 깊이 쓰기 없이 겹친 기둥이 바르게 덮이게(300개 정렬 ≈ 0.05ms)
    const cam = view.camera, cp = cam.position, fw = cam.getWorldDirection(this._f);
    const ord = this._order;
    ord.length = 0;
    for (const v of view.vis.values()) {
      if (v.gone || v.hidden) continue;
      const p = v.group.position;
      v._camZ = (p.x - cp.x) * fw.x + (p.y - cp.y) * fw.y + (p.z - cp.z) * fw.z;
      ord.push(v);
    }
    ord.sort((a, b) => b._camZ - a._camZ);
    const fog = view.scene.fog, camDist = view.focusDist || cp.length();
    this.uniforms.uFog.value.copy(fog ? fog.color : view.tokens.bg);
    this.uniforms.uFogNear.value = camDist * 0.8; this.uniforms.uFogFar.value = camDist * 2.6;
    this.uniforms.uStemW.value = Math.max(0.05, camDist / 900);
    const E = this.aD.array, floorY = view.tierFloor ?? 0;
    let n = 0;
    for (const v of ord) {
      if (n >= this.cap) break;
      const node = v.node;
      const st = nodeVisualState(node.status, v.icons ? v.icons.size : 0);
      // 크기: SceneView 가 매 프레임 계산한 메시 배율(등장·퇴장·오래된 완료 축소 포함) × 숨쉬기
      const s = v.mesh.scale.x * breathe(st, now, v.seed);
      this._s.setScalar(Math.max(0.0001, s));
      this._m.compose(v.group.position, this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      // 같은 프로젝트 live 메인이 여럿이면 메인 테두리(상태색 자리)를 그 세션 색으로 — 오류·중지·완료는 상태색 그대로
      const c = v.sessC && v.kind === 'main' && !node.parentId && (st === NODE_STATE.idle || st === NODE_STATE.thinking || st === NODE_STATE.tool) ? v.sessC : this._col(st), kc = view.kindColor(v.kind);
      C[n * 3] = c.r; C[n * 3 + 1] = c.g; C[n * 3 + 2] = c.b;
      K[n * 3] = kc.r; K[n * 3 + 1] = kc.g; K[n * 3 + 2] = kc.b;
      const sk = v.scopeK ?? 1;
      const endK = st === NODE_STATE.done ? 0.7 : st === NODE_STATE.stopped ? 0.6 : 1;
      const near = v.nearFaded ? Math.max(0.15, v.mat.opacity / Math.max(0.01, v.baseOpacity || 1)) : 1;
      const ctx = node.meta && node.meta.ctx;
      const ctxp = ctx && ctx.limit ? Math.min(1, Math.max(0, ctx.used / ctx.limit)) : 0;
      A[n * 4] = st; A[n * 4 + 1] = kindIcon(v.kind); A[n * 4 + 2] = (v.exitF ?? 1) * Math.min(1, sk * 1.3) * endK * near; A[n * 4 + 3] = ctxp;
      const foc = v.id === view.focusId || v.id === view.hoverId ? 1 : 0;
      B[n * 4] = v.seed; B[n * 4 + 1] = foc; B[n * 4 + 2] = v.stale ? 0.4 : 1; B[n * 4 + 3] = 0;
      if (v.device && v.devInfo) {
        // 배치 장치: 띠(5진수) · 칸 수 · 진행(경과/평균, 진행 중 회차가 없으면 -1)
        const info = v.devInfo;
        const cur = info.running > 0 && info.currentId ? view.vis.get(info.currentId) : null;
        const pr = cur ? cycleProgress(info, cur.node, nowMs) : null;
        D[n * 4] = 1; D[n * 4 + 1] = v._bandCode ?? (v._bandCode = bandCode(info.band)); D[n * 4 + 2] = info.band.length;
        D[n * 4 + 3] = info.running > 0 ? (pr == null ? 1 : pr) : -1;
      } else { D[n * 4] = 0; D[n * 4 + 1] = 0; D[n * 4 + 2] = 0; D[n * 4 + 3] = -1; }
      // 바닥 높이 · 아래층 어둡게 · 기둥 두께
      E[n * 4] = floorY; E[n * 4 + 1] = v.tierDim || 0; E[n * 4 + 2] = v.device ? THICK.device : v.kind === 'main' ? THICK.main : THICK.other; E[n * 4 + 3] = 0;
      n++;
    }
    this.mesh.count = n; this.shadow.count = n; this.depth.count = n;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.aColor.needsUpdate = true; this.aKind.needsUpdate = true; this.aA.needsUpdate = true; this.aB.needsUpdate = true; this.aC.needsUpdate = true; this.aD.needsUpdate = true;
    }
    this.count = n;
  }
  dispose() { this.mesh.removeFromParent(); this.shadow.removeFromParent(); this.depth.removeFromParent(); this.mesh.geometry.dispose(); this.shadow.geometry.dispose(); this.mat.dispose(); this.dmat.dispose(); }
}
