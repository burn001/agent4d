// Planet 3D 행성 연출 — PlanetView 가 노드마다 붙인다. 외부 에셋 없이 three 지오메트리 + 셰이더 주입.
//  · 메인 = 기계 행성: 몸체 셰이더(패널 이음선·패널 명암·해치 여닫이·이음선을 따라 도는 조명 점·이음선 사이 코어 광 맥동),
//    적도 기어 띠(고정된 네 번째 휠) + 다축 뚜르비용(planet-tourb.js — 예전 기운 점선 링·안테나를 대신함).
//  · 서브에이전트(구) = 위도 띠·흐르는 구름(위도마다 속도가 다른 차등 회전)·활동 때 표면 발광 맥동 + 대기 테두리 빛 + 작은 위성.
//    워크플로 에이전트·claude -p 는 모양을 그대로 두고 작은 위성만.
//  · 상태(planet-core.mjs MECH·SUB): 도구 호출 > 생각 중 > 대기 > 완료로 링 속도·발광·해치·안테나가 달라지고 부드럽게 넘어간다.
//  · LOD: 노드 반지름이 화면 5px 미만이면 덧붙인 부품을 숨기고(몸체 셰이더만), 16px 미만이면 톱니·안테나를 뺀다.
//  · 투명도는 몸체 재질(퇴장·완료· 프로젝트 페이드가 이미 곱해진 값)을 그대로 따른다.
//  ·～: 모든 Planet 노드에 궤도계(planet-orbits.js — 종류·유형·id 시드마다 다른 링·위성·소행성대·잔광, 도구 호출 입자),
//    서브에이전트는 유형 8종(planet-sub.js). 예전 '작은 위성 하나'는 궤도계가 대신한다.
import * as THREE from 'three';
import { MECH, SUB, ORBIT, planetMode, approach, pxRadius, planetLod, orbitLod, orbitSpec, hash01, subType, SETTLE_S, settleK } from './planet-core.mjs';
import { OrbitSystem, OrbitSparks } from './planet-orbits.js';
import { injectSubType, mkSubU, buildSubType, stepSubType, setSubTypeColors, disposeSubType } from './planet-sub.js';
import { Escapement, tourbLod, TOURB_LOD, TOURB_GEO } from './tourbillon-core.mjs'; // 뚜르비용
import { TourbMain, SubCages } from './planet-tourb.js';
import { isJob, jobOf, jobCode, jobProgress, isProc, jobStale } from './job-core.mjs'; // 작업 노드
import { jobLook, jobRingFill, jobBlink, jobLod, jobTether, ringAt, JOB_RING_GEO, JOB_BODY_K } from './planet-core.mjs';
import { JOB_GLYPH, jobWeightK, TRACK, trackSlots, trackRadius, trackModel, trackGates, trackLabels } from './planet-core.mjs'; // 글리프·무게·항로
import { cycleProgress } from './batch-core.mjs'; // G3 기동기 회차 고리
import { ProcFx } from './planet-proc.js'; // 분리 프로세스 = 채굴 드릴 플랫폼 · 자동 진행 = 계기 홀로그램 · 컨베이어 · 들여다보기

const TAU = Math.PI * 2;
let GEO = null;

/** 상자 여러 개를 한 지오메트리로(y 축 회전만). list = [{w,h,d,x,y,z,ry}] */
function mergeBoxes(list) {
  const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const P = box.attributes.position.array, N = box.attributes.normal.array;
  const pos = new Float32Array(P.length * list.length), nor = new Float32Array(P.length * list.length);
  let o = 0;
  for (const b of list) {
    const c = Math.cos(b.ry || 0), s = Math.sin(b.ry || 0);
    for (let i = 0; i < P.length; i += 3, o += 3) {
      const x = P[i] * b.w, y = P[i + 1] * b.h, z = P[i + 2] * b.d;
      pos[o] = x * c + z * s + b.x; pos[o + 1] = y + b.y; pos[o + 2] = -x * s + z * c + b.z;
      nor[o] = N[i] * c + N[i + 2] * s; nor[o + 1] = N[i + 1]; nor[o + 2] = -N[i] * s + N[i + 2] * c;
    }
  }
  box.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
/** 반지름 R 원 위에 n 개 토막(접선 방향) */
const ringOf = (n, R, w, h, d, skip = null) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (skip && skip(i)) continue;
    const a = (i / n) * TAU;
    out.push({ w, h, d, x: Math.cos(a) * R, y: 0, z: Math.sin(a) * R, ry: -a - Math.PI / 2 });
  }
  return out;
};

function geo() {
  if (GEO) return GEO;
  GEO = {
    body: new THREE.SphereGeometry(1, 48, 28),            // 메인 몸체(이십면체 대신 — 이음선은 셰이더)
    gearBand: new THREE.TorusGeometry(1.035, 0.04, 6, 64),                        // 적도 기어 띠
    teeth: mergeBoxes(ringOf(30, 1.075, 0.07, 0.085, 0.07)),
    moon: new THREE.SphereGeometry(1, 14, 10),
    atmo: new THREE.SphereGeometry(1, 28, 18),
  };
  GEO.gearBand.rotateX(Math.PI / 2);
  // 작업 탐사선: 상자 몸통 + 버팀대 + 태양전지 날개 둘 + 안테나 대(몸체 반지름 1 안팎 — 클릭 판정도 이 모양)
  GEO.probe = mergeBoxes([
    { w: 0.9, h: 0.72, d: 0.72, x: 0, y: 0, z: 0 },
    { w: 0.34, h: 0.07, d: 0.09, x: 0.6, y: 0, z: 0 }, { w: 0.34, h: 0.07, d: 0.09, x: -0.6, y: 0, z: 0 },
    { w: 0.56, h: 0.05, d: 0.66, x: 1.04, y: 0, z: 0 }, { w: 0.56, h: 0.05, d: 0.66, x: -1.04, y: 0, z: 0 },
    { w: 0.06, h: 0.42, d: 0.06, x: 0, y: 0.56, z: 0 }, { w: 0.2, h: 0.06, d: 0.2, x: 0, y: 0.78, z: 0 },
  ]);
  GEO.probe.computeBoundingSphere();
  GEO.jobRing = new THREE.RingGeometry(JOB_RING_GEO.R0, JOB_RING_GEO.R1, 72, 1);
  // 주인 궤도 자취: 꼭짓점마다 w ∈ [-1, 1](각도는 셰이더가 uSpan 으로) — 위치 속성은 자리만
  const TN = 49, tw = new Float32Array(TN);
  for (let i = 0; i < TN; i++) tw[i] = (i / (TN - 1)) * 2 - 1;
  GEO.tether = new THREE.BufferGeometry();
  GEO.tether.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TN * 3), 3));
  GEO.tether.setAttribute('w', new THREE.BufferAttribute(tw, 1));
  // 항로: 화면 폭 띠(꼭짓점 둘씩 — s ∈ [0, 1] 출발 관문 → 도착 관문, side ±1). 각도·두께는 셰이더가 uA0·uA1·화면 px 로
  const SN = TRACK.SEG + 1, ts = new Float32Array(SN * 2), sd = new Float32Array(SN * 2), idx = [];
  for (let i = 0; i < SN; i++) { ts[i * 2] = ts[i * 2 + 1] = i / (SN - 1); sd[i * 2] = -1; sd[i * 2 + 1] = 1; if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  GEO.track = new THREE.BufferGeometry();
  GEO.track.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SN * 2 * 3), 3));
  GEO.track.setAttribute('s', new THREE.BufferAttribute(ts, 1));
  GEO.track.setAttribute('side', new THREE.BufferAttribute(sd, 1));
  GEO.track.setIndex(idx);
  GEO.glyph = new THREE.PlaneGeometry(2, 2); // G1 상태 글리프 판(빌보드)
  GEO.gate = new THREE.TorusGeometry(1, 0.16, 6, 20); // 관문 고리(축 = z → 항로 접선으로 돌림)
  GEO.devBand = new THREE.RingGeometry(1.62, 1.98, 96, 1).rotateX(-Math.PI / 2); // G3 기동기 회차 고리(수평)
  GEO.rearm = new THREE.RingGeometry(1.95, 2.4, 96, 1).rotateX(-Math.PI / 2);   // G4 재무장 눈금(수평)
  return GEO;
}

// ---------- 작업 탐사선 셰이더 ----------
// 출력 색 공간 변환(colorspace_fragment)을 넣어 토큰 색(CSS sRGB)이 몸체 재질과 같은 밝기로 보이게.
// 상태 고리(시청자를 향함): u = 둘레 위치(0 = 위, 시계 방향 — planet-core ringAt 과 같음). uMode = planet-core JOB_RING
const JRING_V = /* glsl */`varying vec2 vP;
void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const JRING_F = /* glsl */`uniform vec3 uColor, uTrack; uniform float uOp, uFill, uHead, uMode, uBlink, uSeed;
varying vec2 vP;
float h11(float x) { return fract(sin(x * 12.9898 + 78.233) * 43758.5453); }
void main() {
  float u = fract(atan(vP.x, vP.y) / 6.2831853);
  float lit = 0.0, trk = 1.0;
  if (uMode < 0.5) { lit = 0.45 * step(fract(u * 16.0), 0.5); trk = 0.0; }                // 줄 섬: 옅은 점선 고리
  else if (uMode < 1.5) { lit = step(u, uFill); }                                           // 진행 호
  else if (uMode < 2.5) { float d = fract(uHead - u); lit = d < 0.3 ? pow(1.0 - d / 0.3, 1.6) : 0.0; } // 진행(비율 모름): 도는 호
  else if (uMode < 3.5) { lit = step(u, uFill) * 0.8; trk = step(fract(u * 24.0), 0.5); }  // 대기: until 쪽으로 차오름
  else if (uMode < 4.5) { lit = 1.0; }                                                      // 끝: 온고리
  else if (uMode < 5.5) { float g = min(abs(u - 0.5), min(u, 1.0 - u)); lit = step(0.06, g) * step(u, uFill + 0.001); trk = 0.0; } // 실패: 위·아래가 깨진 고리
  else { float on = step(0.3, h11(floor(u * 12.0) + uSeed * 7.0)); lit = step(u, uFill) * on * uBlink; trk = 0.5; } // 정체: 칸마다 끊기며 깜빡
  float a = uOp * (0.2 * trk + 0.85 * lit);
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uTrack, uColor, min(1.0, lit)), clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;
// 주인 궤도 자취: 주인 중심 원의 한 토막(basis 행렬이 반지름·방향), 작업 뒤쪽(w<0)으로 잔광, 앞쪽은 옅게, 흐르는 점선
const JTETH_V = /* glsl */`attribute float w; uniform float uSpan; varying float vW;
void main() { vW = w; float a = w * uSpan; gl_Position = projectionMatrix * modelViewMatrix * vec4(cos(a), 0.0, sin(a), 1.0); }`;
const JTETH_F = /* glsl */`uniform vec3 uColor; uniform float uOp, uShift; varying float vW;
void main() {
  float b = vW < 0.0 ? pow(1.0 + vW, 1.4) : pow(1.0 - vW, 3.0) * 0.35;
  float dash = 0.55 + 0.45 * step(0.5, fract(vW * 9.0 - uShift));
  float a = uOp * b * dash;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

// G1 상태 글리프(흐름 chips.js jobTop 과 같은 그림 — 점 셋 · 재생 · 모래시계 · 체크 · 엑스 · 느낌표) + 받침 원판(대비)
const GLYPH_V = /* glsl */`varying vec2 vP;
void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GLYPH_F = /* glsl */`uniform vec3 uColor, uInk; uniform float uOp, uCode, uWf, uPulse;
varying vec2 vP;
float seg(vec2 p, vec2 a, vec2 b, float w) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return smoothstep(w, w * 0.35, length(pa - ba * h)); }
void main() {
  vec2 p = vP * 0.44;
  float g = 0.0, c = floor(uCode + 0.5);
  if (c < 0.5) { for (int i = 0; i < 3; i++) g = max(g, smoothstep(0.085, 0.045, length(p - vec2(-0.3 + 0.3 * float(i), 0.0)))); g *= 0.8; }
  else if (c < 1.5) { float e = min(p.x + 0.17, (0.25 - p.x) * 0.58 - abs(p.y)); g = smoothstep(0.0, 0.035, e); }
  else if (c < 2.5) {
    float f = uWf > -0.5 ? uWf : 0.5;
    float ay = abs(p.y), e = min(ay * 0.85 - abs(p.x), 0.32 - ay);
    float frame = smoothstep(0.035, 0.0, abs(e)) * step(-0.035, e);
    frame = max(frame, step(abs(p.x), 0.3) * smoothstep(0.03, 0.0, abs(ay - 0.32)));
    float inside = step(0.0, e);
    float sandTop = inside * step(0.0, p.y) * step(p.y, 0.3 * (1.0 - f));
    float sandBot = inside * step(p.y, 0.0) * step(p.y, -0.31 + 0.3 * f);
    g = max(frame, max(sandTop, sandBot) * 0.8);
  }
  else if (c < 3.5) g = max(seg(p, vec2(-0.26, 0.02), vec2(-0.07, -0.17), 0.075), seg(p, vec2(-0.07, -0.17), vec2(0.27, 0.19), 0.075));
  else if (c < 4.5) g = max(seg(p, vec2(-0.2, -0.2), vec2(0.2, 0.2), 0.075), seg(p, vec2(-0.2, 0.2), vec2(0.2, -0.2), 0.075));
  else g = max(seg(p, vec2(0.0, 0.26), vec2(0.0, -0.04), 0.08), smoothstep(0.08, 0.045, length(p - vec2(0.0, -0.2)))) * uPulse;
  float disc = smoothstep(1.0, 0.82, length(vP)) * 0.62;
  float a = max(disc, g) * uOp;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(uInk, uColor, g), clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

// 안 A 항로: 주인 중심 원호(basis 행렬 = 반지름·방향), s = 출발 관문 0 → 도착 관문 1, 탐사선 자리 = uP.
// 진행 = 탐사선 쪽으로 밝아지는 항적 + 처리율 간격 반짝임 · 남은 항로 옅은 점선 / 예상 비율 = 점선 항적 / 비율 모름 = 전체 흐린 점선 + 혜성 꼬리 + 경과 바퀴 점
// 대기 = 앞쪽 12칸 눈금이 until 쪽으로 · 정체 = 식은 항적(출발 쪽부터 꺼짐) · 끝 = 닫힌 고리로 접혀 옅어짐 · 실패 = 탐사선에서 끊기고 남은 항로 끊긴 점선
const TRACK_V = /* glsl */`attribute float s; attribute float side; uniform float uA0, uA1, uP, uMode, uW, uDpr; uniform vec2 uRes; varying float vS; varying float vSide;
vec4 at(float x) { float a = mix(uA0, uA1, x); return projectionMatrix * modelViewMatrix * vec4(cos(a), 0.0, sin(a), 1.0); }
void main() {
  vS = s; vSide = side;
  vec4 c0 = at(s), c1 = at(s + 0.004);
  vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * uRes; float L = length(d); d = L > 1e-6 ? d / L : vec2(1.0, 0.0);
  float m = floor(uMode + 0.5);
  // 화면 폭(px): 항적은 탐사선 쪽으로 굵게(진행·예상·정체·실패), 남은 항로는 가늘게, 대기 눈금·끝 접힘은 보통
  float w = 1.6;
  if ((m < 1.5 || (m > 2.5 && m < 3.5) || (m > 4.5 && m < 5.5) || m > 6.5) && s <= uP) w = mix(1.6, uW, pow(s / max(uP, 1e-4), 1.4));
  else if (m > 1.5 && m < 2.5) w = 2.0;
  else if (m > 3.5 && m < 4.5 && s > uP) w = 3.2;
  if (m > 5.5 && m < 6.5) w = 2.4;
  c0.xy += vec2(-d.y, d.x) * side * (w * uDpr + 1.0) / uRes * c0.w;
  gl_Position = c0;
}`;
const TRACK_F = /* glsl */`uniform vec3 uColor, uCool; uniform float uOp, uP, uMode, uShift, uSparkN, uCold, uWait, uLap, uRemA, uMove;
varying float vS; varying float vSide;
void main() {
  float u = vS, p = max(uP, 1e-4), m = floor(uMode + 0.5);
  float a = 0.0; vec3 col = uColor;
  float dots = step(0.5, fract(u * 90.0));
  if (m < 1.5 || (m > 2.5 && m < 3.5)) {                       // 진행 · 예상 비율
    if (u <= uP) {
      float b = pow(u / p, 1.5);
      a = 0.22 + 0.78 * b;
      if (m > 2.5) a *= step(0.42, fract(u * 46.0 - uShift * uMove)); // 추정 항로 = 점선 항적
      else { float k = fract(u * uSparkN - uShift); a += uMove * pow(1.0 - k, 10.0) * 0.9 * b; }
    } else a = uRemA * dots;
  } else if (m < 2.5) {                                          // 비율 모름
    a = 0.55 * uRemA * step(0.5, fract(u * 48.0 - uShift * uMove));
    float d = uP - u;
    if (d >= 0.0 && d < 0.14) a = max(a, pow(1.0 - d / 0.14, 2.0));
    a = max(a, exp(-pow((u - uLap) / 0.012, 2.0)) * 0.8);
  } else if (m < 4.5) {                                          // 대기
    if (u <= uP) a = 0.3 * pow(u / p, 1.2);
    else { float w = (u - uP) / max(1e-4, 1.0 - uP); float tick = step(abs(fract(w * 12.0) - 0.5), 0.3); float lit = step((floor(w * 12.0) + 0.5) / 12.0, uWait); a = tick * (lit > 0.5 ? 0.85 : uRemA * 0.7); }
  } else if (m < 5.5) {                                          // 정체: 항적이 식어 출발 쪽부터 꺼짐
    if (u <= uP) { a = (0.2 + 0.6 * pow(u / p, 1.4)) * step(uCold * uP, u) * step(0.3, fract(u * 30.0)); col = mix(uColor, uCool, 0.55); }
    else a = uRemA * 0.6 * dots;
  } else if (m < 6.5) {                                          // 끝: 닫힌 고리(옅어짐은 uOp)
    a = 0.75;
  } else {                                                       // 실패
    if (u <= uP) a = 0.25 + 0.6 * pow(u / p, 1.5);
    else a = 0.55 * step(0.55, fract(u * 22.0)) * step(0.25, fract(u * 3.7 + 0.31));
  }
  a *= uOp * (1.0 - smoothstep(0.55, 1.0, abs(vSide))); // 띠 가장자리 부드럽게
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

// G3 기동기 회차 고리: 바깥 띠 = 최근 회차 칸(진행 호박 · 끝 초록 · 중지 회색 · 실패 빨강 · 빈 칸 흐림), 안쪽 가는 호 = 이번 회차 진행(경과/평균)
// G4 재무장 눈금: 12칸 중 재무장 수만큼 밝게(나머지 옅게)
const DECK_V = /* glsl */`varying vec2 vP;
void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DECK_F = /* glsl */`uniform vec3 uC0, uC1, uC2, uC3, uC4; uniform float uOp, uKind, uN, uProg, uRot, uR0, uR1, uCount, uSpinH;
uniform float uBand[5];
varying vec2 vP;
void main() {
  float r = length(vP), t = (r - uR0) / (uR1 - uR0);
  float u = fract(atan(vP.x, -vP.y) / 6.2831853 + uRot);
  float a = 0.0; vec3 col = uC0;
  if (uKind < 0.5) {                                   // 회차 고리
    if (t > 0.36) {
      float n = max(1.0, uN), k = floor(u * n), f = fract(u * n);
      float code = 0.0;
      for (int i = 0; i < 5; i++) if (float(i) == k) code = uBand[i];
      float cell = step(0.05, f) * step(f, 0.95) * step(t, 0.96);
      col = code < 0.5 ? uC0 : code < 1.5 ? uC1 : code < 2.5 ? uC2 : code < 3.5 ? uC3 : uC4;
      a = cell * (uN < 0.5 ? 0.15 : code < 0.5 ? 0.22 : 0.85);
    } else if (t < 0.24) {
      col = uC1;
      if (uProg > -0.5) a = step(u, uProg) * 0.95 + 0.14;
      else if (uSpinH > -0.5) { float d = fract(uSpinH - u); a = d < 0.18 ? 0.9 * (1.0 - d / 0.18) : 0.1; }
      else a = 0.0;
    }
  } else {                                             // 재무장 눈금(12칸)
    float k = floor(u * 12.0), f = fract(u * 12.0);
    float tick = step(abs(f - 0.5), 0.22);
    a = tick * (k < uCount ? 0.95 : 0.2);
    col = uC1;
  }
  a *= uOp;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

const _q = new THREE.Quaternion(), _jd = new THREE.Vector3(), _jt = new THREE.Vector3(), _jy = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0), _jc = new THREE.Color(), _ra = { x: 0, y: 0 };
const _tp = new THREE.Vector3(), _tq = new THREE.Vector3(), _tm = new THREE.Matrix4(), _tqq = new THREE.Quaternion(), _ts = new THREE.Vector3(), _tc = new THREE.Color();
const _ZAX = new THREE.Vector3(0, 0, 1);
const ease01 = (x) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };

/** 관문 고리(장면 공용 InstancedMesh 하나 — 작업 몇 개가 늘어도 그리기 호출 1) */
class GateField {
  constructor(world) {
    this.mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.95 });
    this.im = new THREE.InstancedMesh(geo().gate, this.mat, 128);
    this.im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.im.setColorAt(0, _tc.set(0xffffff));
    this.im.count = 0; this.im.frustumCulled = false; this.im.raycast = () => {}; this.im.renderOrder = 3;
    world.add(this.im);
    this.n = 0; this.light = null; this.bg = new THREE.Color();
  }
  begin(L, bg) { this.n = 0; if (bg) this.bg.copy(bg); if (this.light !== L) { this.light = L; this.mat.blending = L ? THREE.NormalBlending : THREE.AdditiveBlending; this.mat.needsUpdate = true; } }
  /** 관문 하나: 자리 p, 항로 접선 dir(축), 반지름 r, 색 c, 세기 a(0..1) */
  put(p, dir, r, c, a) {
    if (this.n >= this.im.instanceMatrix.count || !(a > 0.01) || !(r > 0)) return;
    _tqq.setFromUnitVectors(_ZAX, dir); _ts.setScalar(r);
    _tm.compose(p, _tqq, _ts);
    this.im.setMatrixAt(this.n, _tm);
    _tc.copy(c); if (this.light) _tc.lerp(this.bg, 1 - Math.min(1, a)); else _tc.multiplyScalar(Math.min(1, a));
    this.im.setColorAt(this.n, _tc);
    this.n++;
  }
  end() { const im = this.im; im.count = this.n; if (this.n) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; } }
  dispose() { this.im.removeFromParent(); this.im.dispose(); this.mat.dispose(); }
}

/** 관문 글자(캔버스 스프라이트, 화면 글자 높이 고정 · 글자가 바뀔 때만 다시 그림) */
class GateText {
  constructor(world) {
    this.canvas = document.createElement('canvas'); this.canvas.width = 8; this.canvas.height = 8;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.minFilter = THREE.LinearFilter; this.tex.generateMipmaps = false;
    this.mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest: false });
    this.sp = new THREE.Sprite(this.mat); this.sp.center.set(0.5, 0); this.sp.renderOrder = 5; this.sp.raycast = () => {}; this.sp.visible = false;
    world.add(this.sp);
    this.key = '';
  }
  set(text, color, L) {
    const key = text + '|' + color + '|' + L;
    if (key === this.key) return;
    this.key = key;
    const c = this.canvas, x = c.getContext('2d'), F = '600 22px ui-sans-serif, system-ui, sans-serif';
    x.font = F;
    const w = Math.ceil(x.measureText(text).width) + 20, h = 34;
    const resized = c.width !== w || c.height !== h;
    if (resized) { c.width = w; c.height = h; }
    x.clearRect(0, 0, w, h);
    x.font = F; x.textBaseline = 'middle'; x.textAlign = 'center';
    x.beginPath(); x.roundRect ? x.roundRect(1, 1, w - 2, h - 2, 8) : x.rect(1, 1, w - 2, h - 2);
    x.fillStyle = L ? 'rgba(255,255,255,0.86)' : 'rgba(6,12,22,0.72)'; x.fill();
    x.lineWidth = 2; x.strokeStyle = color; x.globalAlpha = 0.75; x.stroke(); x.globalAlpha = 1;
    x.fillStyle = color; x.fillText(text, w / 2, h / 2 + 1);
    if (resized) { this.tex.dispose(); this.tex = new THREE.CanvasTexture(c); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.minFilter = THREE.LinearFilter; this.tex.generateMipmaps = false; this.mat.map = this.tex; this.mat.needsUpdate = true; }
    else this.tex.needsUpdate = true;
  }
  /** 자리 p(세계), 화면 글자 높이 px, 시계 거리 → 크기 */
  place(p, cam, pxK, hpx, op) {
    const dist = Math.max(0.01, p.distanceTo(cam.position));
    const h = (hpx * dist) / pxK, w = (h * this.canvas.width) / this.canvas.height;
    this.sp.position.copy(p); this.sp.scale.set(w, h, 1);
    this.mat.opacity = op; this.sp.visible = op > 0.02;
  }
  hide() { this.sp.visible = false; }
  dispose() { this.sp.removeFromParent(); this.mat.dispose(); this.tex.dispose(); }
}

/**
 * 안 A — 작업 하나의 항로(주인 둘레 원호 · 관문 둘 · 관문 글자). 탐사선(JobProbe)·외부 작업 플랫폼(승격) 모두 이것을 쓴다.
 * 탐사선 자리는 그대로 두고 항로가 진행만큼 뒤로 돈다(출발 = −p·S, 도착 = +(1−p)·S).
 */
class JobTrack {
  constructor(view, v) {
    this.view = view; this.v = v;
    this.U = { uColor: { value: new THREE.Color() }, uCool: { value: new THREE.Color(0x9a8a80) }, uOp: { value: 0 }, uP: { value: 0 }, uMode: { value: 1 }, uShift: { value: 0 },
      uSparkN: { value: 6 }, uCold: { value: 0 }, uWait: { value: 0 }, uLap: { value: 0 }, uRemA: { value: TRACK.REMAIN_A }, uMove: { value: 1 }, uA0: { value: -1 }, uA1: { value: 1 },
      uW: { value: 4.5 }, uRes: view.deco ? view.deco._res : { value: new THREE.Vector2(1, 1) }, uDpr: view.deco ? view.deco._dpr : { value: 1 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: TRACK_V, fragmentShader: TRACK_F, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.line = new THREE.Mesh(geo().track, this.mat);
    this.line.matrixAutoUpdate = false; this.line.frustumCulled = false; this.line.raycast = () => {}; this.line.visible = false; this.line.renderOrder = 2;
    view.world.add(this.line);
    this.dir = hash01(v.id, 'jd') < 0.5 ? -1 : 1;
    this.txt = null; this.light = null;
    this.code = -1; this.endAt = -1; this.flashAt = -1e9; this.seenLive = false; this.labAt = -1; this.lab = null;
  }
  restyle(c, L) {
    this.U.uColor.value.copy(c);
    if (!L) this.U.uColor.value.lerp(_jc.set(0xffffff), 0.1);
    this.U.uCool.value.set(L ? 0x8a6a58 : 0xa08878);
    if (this.light !== L) { this.light = L; this.mat.blending = L ? THREE.NormalBlending : THREE.AdditiveBlending; this.mat.needsUpdate = true; this.labAt = -1; }
  }
  hide() { this.line.visible = false; if (this.txt) { this.txt[0].hide(); this.txt[1].hide(); } }
  /**
   * 매 프레임. on = 항로 자리(trackSlots)에 들었나, s = 몸체 반지름(세계), op = 투명도, ctx = { clockMs, cam, pxK, reduced, L, now, dt, gates, sparks }
   * 그렸으면 true(탐사선은 예전 궤도 자취를 끈다)
   */
  step(job, code, prog, on, s, lod, op, ctx) {
    const v = this.v, view = this.view;
    const ended = code === 3 || code === 4;
    // 끝·실패 넘어감: 처음 본 상태엔 연출 없음(스냅샷), 진행을 본 뒤 끝나면 접힘·관문 번쩍·실패 파편
    if (code !== this.code) {
      if (this.code >= 0 && this.seenLive && ended) { this.endAt = ctx.now; this.flashAt = ctx.now; if (code === 4) this._shatter(ctx); }
      if (!ended) this.seenLive = true;
      this.code = code;
    }
    const folding = ended && this.endAt >= 0 && ctx.now - this.endAt < TRACK.DONE_S;
    if ((!on && !folding) || lod < 2 || code === 0 || (ended && !folding)) { this.hide(); return false; }
    const pid = v.node.parentId, ov = pid && view.vis.get(pid);
    if (!ov || ov.hidden || ov.gone || !ov.group.visible || isProc(ov.node)) { this.hide(); return false; } // 분리 프로세스 계기는 그대로
    const o = ov.group.position;
    _jd.copy(v.group.position).sub(o);
    const dist = _jd.length();
    const ext = view.deco ? view.deco.extentOf(pid) * ov.mesh.scale.x : 0;
    const R = trackRadius(dist, ext);
    const m = trackModel(job, code, ctx.clockMs, R, prog);
    if (!(m.span > 0)) { this.hide(); return false; }
    // 접힘(끝): 호가 닫힌 고리로 벌어지며 DONE_S 동안 옅어짐
    let a0, a1, fade = 1;
    if (folding) {
      const k = (ctx.now - this.endAt) / TRACK.DONE_S, w = ease01(k / 0.35);
      const g = trackGates(m);
      a0 = g.a0 + (-Math.PI - g.a0) * w; a1 = g.a1 + (Math.PI - g.a1) * w;
      fade = 1 - ease01((k - 0.3) / 0.7);
    } else { const g = trackGates(m); a0 = g.a0; a1 = g.a1; }
    // 기저: x = 주인→작업(반지름 R), z = 접선(dir), y = 법선
    _jt.crossVectors(_UP, _jd); if (_jt.lengthSq() < 1e-8) _jt.set(1, 0, 0);
    _jt.normalize().multiplyScalar(R * this.dir);
    _jd.normalize().multiplyScalar(R);
    _jy.crossVectors(_jd, _jt).normalize().multiplyScalar(R);
    this.line.matrix.makeBasis(_jd, _jy, _jt).setPosition(o);
    this.line.matrixWorldNeedsUpdate = true;
    const U = this.U, mv = ctx.reduced ? 0 : 1;
    U.uA0.value = a0; U.uA1.value = a1; U.uP.value = folding ? 1 : m.p; U.uMode.value = folding && code === 3 ? 6 : m.code;
    U.uMove.value = mv;
    // 반짝임 간격 = 처리율(초당 많을수록 촘촘) · 대시 흐름
    const rate = Number(job.rate) || 0;
    U.uSparkN.value = 3 + Math.min(14, Math.log10(1 + rate * 60) * 3.5);
    U.uShift.value = (U.uShift.value + ctx.dt * mv * (m.mode === 'spin' ? 0.6 : 0.35)) % 1;
    U.uWait.value = m.wait ?? 0;
    U.uLap.value = m.lap;
    const st = m.mode === 'stale' ? jobStale(job, ctx.clockMs) : null;
    U.uCold.value = st && st.sinceMs != null ? Math.min(0.85, st.sinceMs / 3600000) : 0; // 정체 1시간이면 거의 다 식음
    U.uRemA.value = TRACK.REMAIN_A;
    U.uOp.value = op * fade * (ctx.L ? 0.95 : 0.9);
    this.line.visible = true;
    // 관문: 출발(옅게) · 도착(밝게, 끝나면 한 번 번쩍)
    const flash = mv && ctx.now - this.flashAt < 1.2 ? 1 - (ctx.now - this.flashAt) / 1.2 : 0;
    const gr = Math.max(0.07, Math.min(0.26, s * 0.42)); // 관문 고리 반지름(세계) — 탐사선보다 작게
    const col = U.uColor.value;
    for (const [ang, a, sc] of [[a0, 0.35, 0.85], [a1, 0.75 + flash, 1 + flash * 0.8]]) {
      this._at(ang, R, o, _tp);
      _tq.copy(_jt).normalize().multiplyScalar(Math.cos(ang)).addScaledVector(_jd, -Math.sin(ang) / R).normalize(); // 접선
      ctx.gates.put(_tp, _tq, gr * sc, col, op * fade * a);
    }
    // 관문 글자(분 단위, 가까울 때만)
    if (!folding && ctx.labels && ctx.lab) {
      if (!this.lab || ctx.clockMs - this.labAt >= 60000 || this.lab.code !== code) { this.lab = trackLabels(job, m, ctx.clockMs); this.lab.code = code; this.labAt = ctx.clockMs; }
      const css = '#' + _tc.copy(col).getHexString(THREE.SRGBColorSpace);
      const T = this.txt || (this.txt = [new GateText(view.world), new GateText(view.world)]);
      for (const [i, text, ang] of [[0, this.lab.from, a0], [1, this.lab.to, a1]]) {
        if (!text) { T[i].hide(); continue; }
        T[i].set(text, css, ctx.L);
        this._at(ang, R, o, _tp); _tp.y += gr * 1.3;
        T[i].place(_tp, ctx.cam, ctx.pxK, 15, op * (i ? 0.95 : 0.7));
      }
    } else if (this.txt) { this.txt[0].hide(); this.txt[1].hide(); }
    return true;
  }
  /** 항로 위 각 ang(탐사선 = 0)의 세계 자리 */
  _at(ang, R, o, out) { return out.copy(_jd).multiplyScalar(Math.cos(ang)).addScaledVector(_jt, Math.sin(ang)).add(o); }
  /** 실패: 탐사선 자리에서 파편 몇 개(공용 OrbitSparks 풀) */
  _shatter(ctx) {
    if (!ctx.sparks || ctx.reduced) return;
    this.v.group.getWorldPosition(_tp);
    for (let i = 0; i < 9; i++) { _tq.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize(); ctx.sparks.emit(_tp, _tq, 1.6, 0.35, 0.9, this.U.uColor.value, 1.8); }
  }
  dispose() { this.line.removeFromParent(); this.mat.dispose(); if (this.txt) for (const t of this.txt) t.dispose(); }
}

/**
 * G3 기동기 회차 고리(kind 0 — 회전목마 운반체 대신 최근 회차 칸 + 이번 회차 진행 호, 흐름 기동기 면과 같은 deviceInfo·cycleProgress)
 * · G4 재무장 눈금(kind 1 — Monitor 둘레 12칸 중 rearmCount 만큼). 노드 묶음의 d.root(몸체 크기)에 붙는 수평 고리 하나.
 */
class DeckRing {
  constructor(d, kind) {
    const G = geo();
    this.kind = kind;
    this.U = { uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() }, uC4: { value: new THREE.Color() },
      uOp: { value: 0 }, uKind: { value: kind }, uN: { value: 0 }, uProg: { value: -1 }, uRot: { value: 0 }, uR0: { value: kind ? 1.95 : 1.62 }, uR1: { value: kind ? 2.4 : 1.98 },
      uCount: { value: 0 }, uSpinH: { value: -1 }, uBand: { value: [0, 0, 0, 0, 0] } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: DECK_V, fragmentShader: DECK_F, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(kind ? G.rearm : G.devBand, this.mat);
    this.mesh.raycast = () => {}; this.mesh.renderOrder = 2;
    if (!kind) this.mesh.rotation.x = 0.1; // 장치 궤도(orbitSpec device inc 0.1)와 같은 기울기
    d.root.add(this.mesh);
    this.key = ''; this.light = null; this.spin = 0;
  }
  colors(t, base, L) {
    const key = (t.skill ? t.skill.getHexString() : '') + base.getHexString() + L;
    if (key === this.key) return;
    this.key = key;
    const U = this.U;
    U.uC0.value.copy(t.bg || _jc.set(0)).lerp(t.text || _jc.set(0xffffff), 0.3);
    U.uC1.value.copy(this.kind ? base : (t.skill || base)); if (this.kind) U.uC1.value.lerp(_jc.set(L ? 0x000000 : 0xffffff), L ? 0.2 : 0.35);
    if (t.ok) U.uC2.value.copy(t.ok); if (t.stopped) U.uC3.value.copy(t.stopped); if (t.error) U.uC4.value.copy(t.error);
    if (this.light !== L) { this.light = L; this.mat.blending = L ? THREE.NormalBlending : THREE.AdditiveBlending; this.mat.needsUpdate = true; }
  }
  /** 회차 고리: info = v.devInfo, cur = 진행 중 회차 노드(없으면 null) */
  stepDevice(view, v, dt, op, lod, reduced, nowMs) {
    const info = v.devInfo, U = this.U;
    this.mesh.visible = lod >= 1 && !!info;
    if (!this.mesh.visible) return;
    const band = info.band || [];
    U.uN.value = band.length;
    for (let i = 0; i < 5; i++) U.uBand.value[i] = band[i] | 0;
    const cur = info.running > 0 && info.currentId ? view.vis.get(info.currentId) : null;
    const pr = cur ? cycleProgress(info, cur.node, nowMs) : null;
    U.uProg.value = pr == null ? -1 : pr;
    if (info.running > 0 && pr == null) { this.spin = (this.spin + dt * (reduced ? 0 : 0.35)) % 1; U.uSpinH.value = this.spin; } else U.uSpinH.value = -1;
    U.uRot.value = (U.uRot.value + dt * (reduced ? 0 : 0.012)) % 1; // 회전목마처럼 아주 천천히
    U.uOp.value = op * (this.light ? 0.95 : 0.85);
  }
  /** 재무장 눈금: count = meta.rearmCount(12 에서 멈춤) */
  stepRearm(v, op, lod) {
    const m = v.node.meta || {};
    const n = Math.min(12, Number(m.rearmCount) || (m.rearmOf ? 1 : 0));
    this.mesh.visible = lod >= 1 && n > 0;
    this.U.uCount.value = n;
    this.U.uOp.value = op * (this.light ? 0.9 : 0.8);
  }
  dispose() { this.mesh.removeFromParent(); this.mat.dispose(); }
}

/** 작업 노드 하나의 탐사선 연출(몸체 = v.mesh 를 탐사선 모양으로, 상태 고리·머리 점·글리프는 v.group, 궤도 자취·항로는 view.world) */
class JobProbe {
  constructor(view, v) {
    const G = geo();
    this.view = view; this.v = v;
    v.mesh.geometry = G.probe;
    v.mesh.rotation.set(0.32, hash01(v.id, 'jr') * TAU, 0); // 조금 기운 채로 — 날개가 보이게
    this.root = new THREE.Group(); v.group.add(this.root);
    this.bill = new THREE.Group(); this.root.add(this.bill);
    this.U = { uColor: { value: new THREE.Color() }, uTrack: { value: new THREE.Color() }, uOp: { value: 0 }, uFill: { value: 0 }, uHead: { value: 0 }, uMode: { value: 2 }, uBlink: { value: 1 }, uSeed: { value: 0 } };
    this.ringMat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: JRING_V, fragmentShader: JRING_F, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(G.jobRing, this.ringMat); this.ring.raycast = () => {}; this.bill.add(this.ring);
    this.headMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    this.head = new THREE.Mesh(G.moon, this.headMat); this.head.scale.setScalar(JOB_RING_GEO.HEAD_S); this.head.raycast = () => {}; this.bill.add(this.head);
    // G1 상태 글리프(고리 안 · 몸체 앞, 시청자를 향함)
    this.GU = { uColor: { value: new THREE.Color() }, uInk: { value: new THREE.Color() }, uOp: { value: 0 }, uCode: { value: 1 }, uWf: { value: -1 }, uPulse: { value: 1 } };
    this.glyphMat = new THREE.ShaderMaterial({ uniforms: this.GU, vertexShader: GLYPH_V, fragmentShader: GLYPH_F, transparent: true, depthWrite: false });
    this.glyph = new THREE.Mesh(G.glyph, this.glyphMat); this.glyph.scale.setScalar(JOB_GLYPH.R); this.glyph.position.z = 1.4; this.glyph.raycast = () => {}; this.glyph.renderOrder = 4; this.bill.add(this.glyph);
    this.TU = { uColor: { value: new THREE.Color() }, uOp: { value: 0 }, uSpan: { value: 0.3 }, uShift: { value: 0 } };
    this.tetherMat = new THREE.ShaderMaterial({ uniforms: this.TU, vertexShader: JTETH_V, fragmentShader: JTETH_F, transparent: true, depthWrite: false });
    this.tether = new THREE.Line(G.tether, this.tetherMat);
    this.tether.matrixAutoUpdate = false; this.tether.frustumCulled = false; this.tether.raycast = () => {}; this.tether.visible = false;
    view.world.add(this.tether);
    this.track = new JobTrack(view, v); // 안 A 항로
    this.seed = hash01(v.id, 'jb');
    this.dir = this.track.dir;
    this.headU = hash01(v.id, 'jh');
    this.fill = -1;
    this.light = null;
    this.wk = 1;
  }
  /** 몸체 색이 정해질 때(_styleVis): 고리·머리 점·궤도 자취·글리프·항로 색과 섞기 */
  restyle(c, L) {
    const t = this.view.tokens;
    this.U.uColor.value.copy(c);
    if (!L) this.U.uColor.value.lerp(_jc.set(0xffffff), 0.12);
    this.U.uTrack.value.copy(c).lerp(t.bg, L ? 0.55 : 0.5);
    this.headMat.color.copy(c).lerp(_jc.set(L ? 0x000000 : 0xffffff), L ? 0.15 : 0.45);
    this.TU.uColor.value.copy(c);
    // 글리프: 다크 = 밝은 상태색 + 검은 받침, 라이트 = 진한 상태색 잉크 + 흰 받침
    this.GU.uColor.value.copy(c).lerp(_jc.set(L ? 0x000000 : 0xffffff), L ? 0.35 : 0.25);
    this.GU.uInk.value.set(L ? 0xffffff : 0x05080f);
    this.track.restyle(c, L);
    if (this.light !== L) {
      this.light = L;
      const b = L ? THREE.NormalBlending : THREE.AdditiveBlending;
      for (const m of [this.ringMat, this.tetherMat]) { m.blending = b; m.needsUpdate = true; }
    }
  }
  hide() { this.tether.visible = false; this.track.hide(); }
  /** 매 프레임. s = 몸체 반지름(세계), px = 몸체 화면 반지름, op = 몸체 투명도, ctx = PlanetDeco 프레임 묶음(시계·카메라·항로 자리·관문) */
  step(now, dt, s, px, op, ctx) {
    const { cam, clockMs: nowMs, reduced, L } = ctx;
    const v = this.v, job = jobOf(v.node);
    if (!job) { this.root.visible = false; this.hide(); return; }
    const prog = jobProgress(job);
    const code = jobCode(job, nowMs);
    if (code !== v._jcode) this.view._styleVis(v); // 시계로만 바뀌는 정체 → 몸체 색(이벤트 없이)
    const look = jobLook(code, prog);
    // G2 무게: 오래 돈 만큼 메시·고리를 키운다(배치 반지름 v.r 은 그대로) — 라벨은 커진 고리 밖으로
    const wk = jobWeightK(job, nowMs) / JOB_BODY_K;
    if (Math.abs(wk - this.wk) > 1e-3) { this.wk = wk; v.label.position.y = -(v.r * 1.2 + 0.4 + v.r * JOB_RING_GEO.R1 * (wk - 1)); }
    v.mesh.scale.multiplyScalar(wk);
    s *= wk; px *= wk;
    const lod = jobLod(px);
    let blink = 1, bstep = 0;
    if (look.blink) { const b = jobBlink(reduced ? 0 : now, this.seed); blink = b.k; bstep = b.step; }
    // 탐사선 자전: 정체면 꺼진 칸마다 멈칫, 끝·실패는 멈춤
    v.mesh.rotation.y += dt * look.spin * (reduced ? 0.2 : 1) * (blink > 0.5 ? 1 : 0);
    this.root.scale.setScalar(s);
    this.root.visible = lod >= 1;
    if (lod < 1) { this.hide(); return; }
    // 고리는 시청자를 향함(부모 묶음 회전을 걷어 냄)
    v.group.getWorldQuaternion(_q).invert();
    this.bill.quaternion.copy(_q).multiply(cam.quaternion);
    this.headU = (this.headU + dt * look.orbit * (reduced ? 0.15 : 1) + 1) % 1;
    const fill = jobRingFill(job, code, nowMs, prog);
    this.fill = this.fill < 0 ? fill : this.fill + (fill - this.fill) * Math.min(1, dt * 4);
    const U = this.U;
    U.uMode.value = look.mode; U.uFill.value = this.fill; U.uHead.value = this.headU;
    U.uBlink.value = blink; U.uSeed.value = bstep % 97;
    U.uOp.value = op * (L ? 0.95 : 0.85);
    // G1 글리프: 몸체가 화면에서 JOB_GLYPH.PX 넘을 때만(멀면 색 점 — 고리가 상태를 가른다)
    const gOn = px >= JOB_GLYPH.PX;
    this.glyph.visible = gOn;
    if (gOn) {
      const G = this.GU;
      G.uCode.value = code; G.uWf.value = code === 2 ? (jobRingFill(job, code, nowMs, prog) ?? -1) : -1;
      G.uPulse.value = code === 5 ? (reduced ? 1 : 0.5 + 0.5 * blink) : 1;
      G.uOp.value = op * Math.min(1, (px - JOB_GLYPH.PX) / 4 + 0.35);
    }
    // 머리 점(고리를 도는 작은 위성): 진행 호·정체는 채움 끝에 멈춤, 대기·돌림·점선은 공전, 끝·실패는 없음
    const r = look.ring;
    const headOn = lod >= 2 && r !== 'full' && r !== 'broken';
    this.head.visible = headOn;
    if (headOn) {
      ringAt(r === 'progress' || r === 'stale' ? this.fill : this.headU, _ra);
      this.head.position.set(_ra.x * JOB_RING_GEO.HEAD_R, _ra.y * JOB_RING_GEO.HEAD_R, 0.02);
      this.headMat.opacity = op * (r === 'stale' ? blink : r === 'dash' ? 0.5 : 1);
    }
    // 안 A 항로(주인마다 끝나지 않은 작업 TRACK.PER_OWNER 개) — 그렸으면 예전 궤도 자취는 끈다
    ctx.lab = px >= JOB_GLYPH.PX; // 관문 글자는 가까울 때만
    if (this.track.step(job, code, prog, ctx.slots.has(v.id), s, lod, op, ctx)) { this.tether.visible = false; return; }
    // 주인 궤도 자취(항로 자리 밖의 작업 — 지금 모습)
    const pid = v.node.parentId, ov = pid && this.view.vis.get(pid);
    if (lod < 2 || !(look.tether > 0) || !ov || ov.hidden || ov.gone || !ov.group.visible) { this.tether.visible = false; return; }
    const o = ov.group.position;
    _jd.copy(v.group.position).sub(o);
    const T = jobTether(_jd.x, _jd.y, _jd.z);
    if (!T) { this.tether.visible = false; return; }
    _jt.crossVectors(_UP, _jd);
    if (_jt.lengthSq() < 1e-8) _jt.set(1, 0, 0);
    _jt.normalize().multiplyScalar(T.R * this.dir);
    _jy.crossVectors(_jd, _jt).normalize().multiplyScalar(T.R);
    this.tether.matrix.makeBasis(_jd, _jy, _jt).setPosition(o);
    this.tether.matrixWorldNeedsUpdate = true;
    this.TU.uSpan.value = T.span;
    this.TU.uOp.value = op * look.tether * blink * (L ? 1.1 : 1);
    this.TU.uShift.value = (this.TU.uShift.value + dt * (reduced ? 0 : look.orbit * 3)) % 1;
    this.tether.visible = true;
  }
  dispose() {
    this.root.removeFromParent(); this.tether.removeFromParent(); this.track.dispose();
    this.ringMat.dispose(); this.headMat.dispose(); this.tetherMat.dispose(); this.glyphMat.dispose();
  }
}

// ---------- 셰이더 주입(MeshStandardMaterial onBeforeCompile) ----------
const COMMON_V = /* glsl */`#include <common>
varying vec3 vMP;`;
const BEGIN_V = /* glsl */`#include <begin_vertex>
vMP = position;`;
const COMMON_F = /* glsl */`#include <common>
varying vec3 vMP;
uniform float uT, uGlow, uLights, uHatch, uDetail, uLight, uPulse, uSpin;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`;

// 기계 행성: 위도 9 띠 × 띠마다 경도 칸(극으로 갈수록 적게), 칸마다 명암, 이음선은 화면 1～2px 어두운 선 + 코어 광
const MECH_F = /* glsl */`#include <emissivemap_fragment>
{
  vec3 pn = normalize(vMP);
  float lat = asin(clamp(pn.y, -1.0, 1.0));
  float lon = atan(pn.z, pn.x);
  float la = (lat / 3.14159265 + 0.5) * 9.0;
  float bandI = floor(la);
  float nLon = max(4.0, floor(22.0 * sin((bandI + 0.5) / 9.0 * 3.14159265) + 0.5));
  float lonN = lon / 6.2831853 + 0.5;
  float lo = lonN * nLon + h21(vec2(bandI, 3.0));
  vec2 cell = vec2(floor(lo), bandI);
  vec2 f = vec2(fract(lo), fract(la));
  vec2 w = max(fwidth(vec2(lo, la)), vec2(1e-4));
  vec2 dd = min(f, 1.0 - f) / w;
  float seam = (1.0 - smoothstep(0.5, 1.6, min(dd.x, dd.y))) * uDetail;
  float ph = h21(cell + 0.37);
  vec3 base = diffuseColor.rgb;
  diffuseColor.rgb *= mix(1.0, 0.8 + 0.32 * ph, uDetail);
  diffuseColor.rgb = mix(diffuseColor.rgb, base * 0.3, seam * 0.8);
  float core = uGlow * (0.62 + 0.38 * sin(uT * 6.2831853 * uPulse));
  vec3 gc = mix(emissive, vec3(1.0, 0.92, 0.78), 0.3) * mix(1.05, 0.5, uLight);
  totalEmissiveRadiance += gc * seam * core;
  // 해치: 띠 1..7 의 일부 칸 — 틀 선 + 열리면 안쪽 빛
  float isH = step(0.86, ph) * step(1.0, bandI) * step(bandI, 7.0) * uDetail;
  vec2 c = abs(f - 0.5);
  float m = max(c.x, c.y);
  float frame = isH * (1.0 - smoothstep(0.0, 1.4, abs(m - 0.34) / max(w.x, w.y)));
  diffuseColor.rgb = mix(diffuseColor.rgb, base * 0.45, frame * 0.7);
  float op = isH * uHatch * smoothstep(0.35, 0.75, 0.5 + 0.5 * sin(uT * 1.7 + ph * 40.0));
  float hole = op * (1.0 - smoothstep(0.3 * op - 0.02, 0.3 * op + 0.02, m));
  diffuseColor.rgb = mix(diffuseColor.rgb, base * 0.12, hole);
  totalEmissiveRadiance += gc * hole * (0.9 + 0.6 * core) * 1.4;
  // 표면 조명 점: 띠 경계 이음선을 따라 오가는 작은 빛(띠마다 방향·속도 다름)
  float nearY = (1.0 - smoothstep(0.0, 2.2, min(f.y, 1.0 - f.y) / w.y)) * uDetail;
  float dir = mod(bandI, 2.0) * 2.0 - 1.0;
  float u = fract(lonN * 3.0 + dir * uT * 0.05 * (0.4 + uLights) + h21(vec2(bandI, 7.0)));
  float spot = exp(-pow((u - 0.5) / 0.012, 2.0));
  totalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * spot * nearY * clamp(uLights, 0.0, 1.0) * mix(1.4, 0.7, uLight);
}`;

// 서브 행성: 위도 띠 + 차등 회전으로 흐르는 구름 + 활동 발광 맥동
const SUB_F = /* glsl */`#include <emissivemap_fragment>
{
  vec3 pn = normalize(vMP);
  float lat = pn.y;
  float lon = atan(pn.z, pn.x);
  float flow = uT * (0.12 + 0.3 * uSpin);
  float dl = lon + flow * (1.0 + 0.7 * sin(lat * 3.0));
  float b = sin(lat * 10.0 + 0.8 * sin(dl * 2.0 + lat * 4.0) + 0.45 * sin(dl * 5.0 - lat * 7.0));
  float bands = 0.5 + 0.5 * b;
  diffuseColor.rgb *= mix(1.0, mix(0.74, 1.16, bands), uDetail);
  float cl = smoothstep(0.62, 0.92, 0.5 + 0.5 * sin(dl * 3.0 + lat * 13.0 + 1.7 * sin(lat * 5.0 + uT * 0.25)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), cl * 0.24 * uDetail);
  float pul = uGlow * (0.5 + 0.5 * sin(uT * 3.2 + lat * 6.0 - dl));
  totalEmissiveRadiance += emissive * pul * (0.4 + 0.9 * bands) * mix(1.2, 0.6, uLight);
}`;

function inject(mat, kind, U) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    // 메인: 몸체를 uShrink 만큼 줄여 그림(무브먼트가 앞에 서게) — CPU 지오메트리는 그대로라 클릭 판정은 원래 크기
    const mech = kind === 'mech';
    sh.vertexShader = sh.vertexShader.replace('#include <common>', COMMON_V + (mech ? '\nuniform float uShrink;' : '')).replace('#include <begin_vertex>', BEGIN_V + (mech ? '\ntransformed *= uShrink;' : ''));
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', COMMON_F).replace('#include <emissivemap_fragment>', kind === 'mech' ? MECH_F : SUB_F);
  };
  mat.customProgramCacheKey = () => 'planet-' + kind;
  mat.needsUpdate = true;
}
const mkU = () => ({ uT: { value: 0 }, uGlow: { value: 0 }, uLights: { value: 0 }, uHatch: { value: 0 }, uDetail: { value: 1 }, uLight: { value: 0 }, uPulse: { value: 1 }, uSpin: { value: 1 }, uShrink: { value: 1 } });

// 대기 테두리 빛(프레넬)
const ATMO_V = /* glsl */`varying vec3 vN; varying vec3 vV;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const ATMO_F = /* glsl */`uniform vec3 uColor; uniform float uOpacity;
varying vec3 vN; varying vec3 vV;
void main() { float r = 1.0 - abs(dot(vN, vV)); float a = pow(r, 2.6) * uOpacity; gl_FragColor = vec4(uColor, a); }`;

const _wp = new THREE.Vector3(), _dir = new THREE.Vector3(), _p2 = new THREE.Vector3();
const _c = new THREE.Color(), _c2 = new THREE.Color(), _jc2 = new THREE.Color();

export class PlanetDeco {
  /** view = PlanetView(SceneView) */
  constructor(view) {
    this.view = view;
    this.map = new Map(); // id → deco
    this.stats = { main: 0, sub: 0, job: 0, lod: [0, 0, 0], olod: [0, 0, 0, 0], ms: 0 };
    this.sparks = new OrbitSparks(view.scene);
    this.cages = new SubCages(view.scene, 256, view.renderer); // 서브 단일 케이지(장면 전체 인스턴싱)
    this.proc = new ProcFx(view, this.sparks);
    this.gates = new GateField(view.world); // 항로 관문(장면 공용 인스턴싱)
    this._res = { value: new THREE.Vector2(1, 1) }; this._dpr = { value: 1 }; // 항로 띠 화면 폭(모든 JobTrack 이 같은 uniform 객체)
    this._slots = new Set(); this._slotAt = -1e9; // 항로 자리(주인마다 끝나지 않은 작업 TRACK.PER_OWNER 개 — 0.5초마다)
  }

  /** 노드 v 에 연출을 붙인다(메인·서브·워크플로 에이전트·claude -p, 배치 장치·백그라운드·모니터·워크플로 제외) */
  attach(v) {
    if (this.map.has(v.id)) return;
    const k = v.kind;
    let d = this.proc.attach(v); // 분리 프로세스(플랫폼)·자동 진행 작업(계기)· 외부 작업(플랫폼 승격) — 작업 탐사선보다 먼저
    if (d) { if (isJob(v.node)) d.track = new JobTrack(this.view, v); this.map.set(v.id, d); if (d.track) this.jobStyle(v); return; } // 계기·플랫폼도 항로(분리 프로세스 아래 계기는 JobTrack 이 건너뜀)
    if (isJob(v.node)) { // 작업 = 주인 둘레의 작은 탐사선(궤도계 대신 상태 고리·궤도 자취)
      d = { type: 'job', job: new JobProbe(this.view, v) };
      d.root = d.job.root;
      this.map.set(v.id, d);
      this.jobStyle(v);
      return;
    }
    if (v.device) d = { type: 'plain', root: this._root(v) };
    else if (k === 'main') d = this._mech(v);
    else if (k === 'subagent') d = this._sub(v);
    else d = { type: 'plain', root: this._root(v) };
    d.cur = {}; d.ocur = {}; d.lod = -1; d.spinA = Math.random() * TAU;
    d.mode = null; d.settleAt = -1;
    const okind = v.device ? 'device' : k;
    d.orbits = new OrbitSystem(orbitSpec(okind, v.id, d.subType ? { type: d.subType } : {}), hash01(v.id, 'seed'));
    d.oroot = new THREE.Group(); d.oroot.add(d.orbits.group); v.group.add(d.oroot);
    d.emitAcc = 0;
    if (v.device) d.deck = new DeckRing(d, 0); // G3 기동기 회차 고리
    else if (k === 'monitor') d.deck = new DeckRing(d, 1); // G4 재무장 눈금
    if (d.type === 'mech' || d.type === 'sub') { d.esc = new Escapement(hash01(v.id, 'tourb')); d.tbx = (hash01(v.id, 'tbx') - 0.5) * 0.9; d.tbz = (hash01(v.id, 'tbz') - 0.5) * 0.9; }
    this.map.set(v.id, d);
    this.applyTheme(d);
  }
  _root(v) { const r = new THREE.Group(); v.group.add(r); return r; }
  /** 궤도계 바깥 반지름(본체 반지름 배) — 홀로그램 자리 */
  extentOf(id) { const d = this.map.get(id); return d ? (d.orbits ? d.orbits.spec.extent : d.proc ? 2.6 : d.meter ? 1.6 : JOB_RING_GEO.extent) : 1; }
  /** 홀로그램 빔 출발점: i 번째 보이는 위성(없으면 false) */
  satWorld(id, i, out) { const d = this.map.get(id); if (!d || !d.orbits) return false; const n = d.orbits.satCount(); return n > 0 && d.orbits.satWorld(i % n, out); }

  _mech(v) {
    const G = geo();
    v.mesh.geometry = G.body;
    v.mat.flatShading = false;
    const U = mkU();
    inject(v.mat, 'mech', U);
    const metal = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.55, transparent: true });
    const light = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const root = new THREE.Group();          // 몸체 크기를 따르는 묶음
    // 예전 기운 점선 링·운반체·안테나·적도 기어 띠 → 자이로 뚜르비용(고정 4번 휠·케이지·기어 트레인·밸런스는 planet-tourb.js)
    const gear = new THREE.Group(); gear.visible = false;
    const teeth = gear;
    const tb = new TourbMain(root, this.view.renderer);
    v.group.add(root);
    return { type: 'mech', U, metal, light, root, gear, teeth, tb };
  }

  _sub(v) {
    const G = geo();
    const type = v._ptype || subType(v.id); // _ptype: 확인용 강제 유형(유형 모음 스크린샷)
    const U = injectSubType(v.mat, mkSubU(type));
    const root = new THREE.Group();
    const seed01 = hash01(v.id, 'seed');
    let atmo = null, atmoMat = null;
    if (type !== 'crystal' && type !== 'swarm') {
      atmoMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0.5 } },
        vertexShader: ATMO_V, fragmentShader: ATMO_F, transparent: true, depthWrite: false,
      });
      atmo = new THREE.Mesh(G.atmo, atmoMat); atmo.scale.setScalar(type === 'comet' ? 1.36 : type === 'gas' ? 1.14 : 1.1); root.add(atmo);
      atmo.raycast = () => {};
    }
    v.group.add(root);
    const x = buildSubType(v, type, root, seed01);
    return { type: 'sub', subType: type, U, root, atmo, atmoMat, x };
  }

  detach(v) {
    const d = this.map.get(v.id); if (!d) return;
    this.map.delete(v.id);
    if (d.track) d.track.dispose();
    if (d.deck) d.deck.dispose();
    if (d.proc || d.meter) { this.proc.detach(v); return; }
    d.root.removeFromParent();
    if (d.job) { d.job.dispose(); return; }
    for (const m of [d.metal, d.light, d.atmoMat]) if (m) m.dispose();
    if (d.tb) d.tb.dispose();
    if (d.x) disposeSubType(d.x, v);
    d.orbits.dispose(); d.oroot.removeFromParent();
  }

  /**
   * 작업 몸체 색(PlanetView._styleVis 가 scene 기본 색칠 뒤 부른다): 표시 상태(렌더러 시계 — 정체가 이김) → planet-core JOB_LOOK 의
   * 토큰 색·섞기·흐림·발광·투명도. 끝(초록)·실패(빨강)의 흐림·오류 고리는 scene 규칙 그대로.
   */
  jobStyle(v) {
    const d = this.map.get(v.id), job = jobOf(v.node);
    if (!d || !(d.job || d.track) || !job) return;
    const t = this.view.tokens || {}, L = !!t.isLight;
    const code = jobCode(job, this.view.clock());
    const look = jobLook(code, jobProgress(job));
    const c = _jc2.copy(t[look.tok] || t.skill || _c.set(0xfacc15));
    if (look.mix && t[look.mix[0]]) c.lerp(t[look.mix[0]], look.mix[1]);
    if (look.dim && t.bg) c.lerp(t.bg, look.dim * (L ? 0.55 : 1)); // 밝은 배경에선 덜 흐리게(흰 바닥에 묻히지 않게)
    if (!d.job) { d.track.restyle(c, L); v._jcode = code; return; } // 계기·플랫폼(몸체 색은 ProcFx.style)의 항로 색만
    v.mat.color.copy(c); v.mat.emissive.copy(c);
    v.baseEmissive = look.emis * (L ? 0.45 : 1) * (v.scopeK ?? 1);
    if (code !== 3 && code !== 4) { v.baseOpacity *= look.op; v.mat.opacity = v.baseOpacity * (v.exitF ?? 1); v.mat.depthWrite = v.baseOpacity >= 0.99; }
    v._jcode = code;
    d.job.restyle(c, L);
  }

  /** 테마: 밝은 배경에선 발광을 낮추고 대기 빛은 보통 섞기 */
  applyTheme(only) {
    const t = this.view.tokens || {};
    const L = !!t.isLight;
    for (const d of only ? [only] : this.map.values()) {
      if (d.U) d.U.uLight.value = L ? 1 : 0;
      if (d.orbits) d.orbits._colKey = null;
      if (d.atmoMat) {
        const b = L ? THREE.NormalBlending : THREE.AdditiveBlending;
        if (d.atmoMat.blending !== b) { d.atmoMat.blending = b; d.atmoMat.needsUpdate = true; }
      }
      d._colKey = null;
    }
    if (this.sparks) this.sparks.setLight(L);
    if (this.cages) this.cages.theme(L);
  }

  /** 매 프레임(SceneView._frame 끝, 렌더 직전) */
  update(now, dt) {
    const t0 = performance.now();
    const view = this.view, cam = view.camera;
    const H = view.container.clientHeight || 1, fov = cam.fov;
    const T = now % 3600;
    const st = this.stats; st.main = st.sub = st.job = 0;
    const clockMs = view.clock(); // 정체·대기 차오름은 렌더러 시계(재생 = 가상 시계) st.lod[0] = st.lod[1] = st.lod[2] = 0; st.olod.fill(0);
    const reduced = !!view.reduced;
    const L = !!(view.tokens && view.tokens.isLight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pxK = H / (2 * Math.tan((fov * Math.PI) / 360)); // 세계 1 이 거리 1 에서 몇 px
    this.cages.begin();
    const pctx = { L, reduced, clockMs, cam, pxK, W: view.container.clientWidth || 1, H };
    // 항로: 자리(주인마다 끝나지 않은 작업 TRACK.PER_OWNER 개)는 0.5초마다, 관문은 장면 공용 인스턴싱
    if (now - this._slotAt > 0.5 || now < this._slotAt) { this._slotAt = now; this._slots = this._trackSlots(); }
    this.gates.begin(L, view.tokens && view.tokens.bg);
    if (view.renderer) { view.renderer.getDrawingBufferSize(this._res.value); this._dpr.value = view.renderer.getPixelRatio(); }
    const jctx = { cam, clockMs, reduced, L, pxK, now, dt, slots: this._slots, gates: this.gates, sparks: this.sparks, labels: true };
    for (const [id, d] of this.map) {
      const v = view.vis.get(id);
      if (!v || v.hidden || v.gone || !v.group.visible) { if (d.job) d.job.hide(); if (d.meter) d.meter.hide(); if (d.proc) d.proc.hide(); if (d.track) d.track.hide(); continue; }
      const s = v.mesh.scale.x;
      v.group.getWorldPosition(_wp);
      const dist = _wp.distanceTo(cam.position);
      const px = pxRadius(s, dist, fov, H);
      if (d.job) { st.job++; d.job.step(now, dt, s, px, v.mat.opacity, jctx); continue; }
      if (d.proc) d.proc.step(now, dt, s, px, v.mat.opacity, pctx);
      else if (d.meter) d.meter.step(now, dt, s, px, v.mat.opacity, pctx);
      if (d.track) { jctx.lab = px >= JOB_GLYPH.PX; const job = jobOf(v.node); if (job) d.track.step(job, jobCode(job, clockMs), jobProgress(job), this._slots.has(id), s, px >= 3 ? 2 : 0, v.mat.opacity, jctx); else d.track.hide(); } // 외부 작업 플랫폼·계기의 항로
      if (d.proc || d.meter) continue;
      const lod = planetLod(px);
      const olod = orbitLod(px);
      st.lod[lod]++; st.olod[olod]++;
      const mode = planetMode(v.node.status, v.icons ? v.icons.size : 0, !!v.scopeRecent);
      // 완료 순간: 짧은 정리 연출(궤도가 모였다 퍼지며 고리 파동)
      if (d.mode !== mode) { if (mode === 'off' && d.mode && d.mode !== 'off') d.settleAt = now; d.mode = mode; }
      const settle = d.settleAt >= 0 && now - d.settleAt < SETTLE_S ? now - d.settleAt : -1;
      const sk = settle >= 0 ? settleK(settle) : 0;
      const op = v.mat.opacity;
      d.root.scale.setScalar(s);
      d.oroot.scale.setScalar(s);
      const oc = approach(d.ocur, ORBIT[mode], dt, 2.5);
      const act = mode === 'tool' ? 1 : 0;
      d.act = (d.act || 0) + (act - (d.act || 0)) * Math.min(1, dt * 3);
      // 위성 군단: 도구 때 산개
      d.orbits.spread = d.subType === 'swarm' ? 1 + 0.32 * d.act : 1;
      if (olod >= 1) d.orbits.setColors(v.mat.color, L);
      d.orbits.step(dt, olod, oc, op, (s * pxK) / Math.max(0.01, dist), reduced, settle, dpr, pxK, s);
      if (d.deck) { d.deck.colors(view.tokens || {}, v.mat.color, L); if (d.deck.kind) d.deck.stepRearm(v, op, olod); else d.deck.stepDevice(view, v, dt, op, olod, reduced, clockMs); } // G3·G4
      // 도구 입자: 궤도 위성에서 연결선(부모) 쪽으로
      if (oc.emit > 0.5 && olod >= 2 && !reduced && op > 0.3) {
        d.emitAcc += dt * oc.emit * (d.type === 'mech' ? 1.4 : 1);
        while (d.emitAcc >= 1) { d.emitAcc -= 1; this._emit(v, d, s); }
      } else d.emitAcc = 0;
      if (d.esc) d.esc.step(dt, mode, { reduced }); // 이스케이프먼트(박·밸런스·케이지)
      if (d.type === 'mech') {
        st.main++;
        const c = approach(d.cur, MECH[mode], dt, 2.5);
        d.tb.theme(L, v.mat.color);
        const tlod = tourbLod(px);
        d.tb.step(d.esc, tlod, op);
        d.U.uT.value = T; d.U.uGlow.value = c.glow + sk * 0.6; d.U.uLights.value = c.lights; d.U.uHatch.value = c.hatch;
        d.U.uPulse.value = reduced ? 0.2 : c.pulse; d.U.uDetail.value = lod === 0 ? 0 : Math.min(1, (px - 4) / 8);
        if (lod !== d.lod) d.lod = lod;
        // 무브먼트가 보이면 몸체를 코어로 줄인다(멀면 원래 크기 원판 — 점으로 사라지지 않게). 후광도 코어에 맞춤
        const shr = tlod >= 1 ? TOURB_GEO.CORE_K : 1;
        d.U.uShrink.value += (shr - d.U.uShrink.value) * Math.min(1, dt * 6);
        if (v.extras.glow) v.extras.glow.scale.setScalar(s * (0.5 + 1.0 * d.U.uShrink.value));
        if (lod >= 1) {
          if (d._colKey !== v.mat.color.getHexString() + L) {
            d._colKey = v.mat.color.getHexString() + L;
            d.metal.color.copy(v.mat.color).lerp(_c.set(L ? 0x8a93a3 : 0x9aa4b6), 0.55);
            d.metal.emissive.copy(v.mat.color).multiplyScalar(0.12);
            d.light.color.copy(v.mat.color).lerp(_c.set(0xffffff), 0.55);
          }
          d.metal.opacity = op; d.metal.depthWrite = op >= 0.99;
        }
      } else if (d.type === 'sub') {
        st.sub++;
        const c = approach(d.cur, SUB[mode], dt, 2.5);
        const U = d.U;
        U.uT.value = T; U.uGlow.value = c.glow; U.uSpin.value = reduced ? 0.1 : c.spin; U.uDetail.value = lod === 0 ? 0 : Math.min(1, (px - 3) / 6);
        U.uAct.value = reduced ? 0 : d.act; U.uDim.value = mode === 'wait' ? 1 : mode === 'off' ? 0.5 : 0; U.uSettle.value = sk;
        if (lod !== d.lod) { d.lod = lod; d.root.visible = lod >= 1; }
        if (d._colKey !== v.mat.color.getHexString() + L) {
          d._colKey = v.mat.color.getHexString() + L;
          if (d.atmoMat) d.atmoMat.uniforms.uColor.value.copy(v.mat.color).lerp(_c.set(0xffffff), 0.3);
          setSubTypeColors(d.x, v.mat.color, L);
        }
        if (lod >= 1 && d.atmoMat) d.atmoMat.uniforms.uOpacity.value = op * (L ? 0.3 : 0.42) * (0.55 + 0.6 * c.glow) * (d.subType === 'comet' ? 1.4 : d.subType === 'lava' ? 0.6 : 1);
        stepSubType(d.x, v, T, dt, c, d.act, s, op, lod, L, d.orbits, this._away(v, _dir), this.sparks, reduced);
        if (px >= TOURB_LOD.SUB_PX) this.cages.put(_wp, s, d.tbx, d.tbz, d.esc.cage, op, v.mat.color); // 단일 케이지
        // 용암: 도구 때 표면 분출
        if (d.subType === 'lava' && d.act > 0.3 && olod >= 2 && !reduced && Math.random() < dt * 10 * d.act) {
          _dir.set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize();
          _p2.copy(_wp).addScaledVector(_dir, s * 1.02);
          this.sparks.emit(_p2, _dir, s * 2.2, 0.25, 0.9, _c.copy(v.mat.color).lerp(_c2.set(0xffd9a0), 0.5), 2.2);
        }
      }
    }
    this.cages.end();
    this.gates.end();
    this.proc.update(now, dt, pctx);
    this.sparks.update(dt, pxK * 0.12 * dpr);
    st.ms = performance.now() - t0;
  }

  /** 항로 자리: 보이는 작업 노드(탐사선·외부 작업 플랫폼·계기) → trackSlots */
  _trackSlots() {
    const items = [];
    for (const [id, d] of this.map) {
      if (!d.job && !d.track) continue;
      const v = this.view.vis.get(id);
      if (!v || v.hidden || v.gone) continue;
      const job = jobOf(v.node);
      if (job) items.push({ id, owner: v.node.parentId, job });
    }
    return trackSlots(items);
  }

  /** 노드에서 부모 반대쪽(세계, 단위) — 혜성 꼬리. 부모가 없으면 오른쪽 */
  _away(v, out) {
    const pid = v.node.parentId;
    const pv = pid && this.view.vis.get(pid);
    if (pv) { out.copy(v.group.position).sub(pv.group.position); out.y = Math.max(out.y, 0) * 0.3; if (out.lengthSq() > 1e-6) return out.normalize(); }
    return out.set(1, 0.15, 0).normalize();
  }
  /** 도구 입자 하나: 보이는 위성(없으면 궤도 둘레 아무 점)에서 부모 쪽 연결선 방향으로 */
  _emit(v, d, s) {
    const n = d.orbits.satCount();
    if (n > 0) d.orbits.satWorld(Math.floor(Math.random() * n), _p2);
    else { v.group.getWorldPosition(_p2); _p2.x += (Math.random() - 0.5) * s * 3; _p2.z += (Math.random() - 0.5) * s * 3; }
    const pid = v.node.parentId;
    let tv = pid && this.view.vis.get(pid);
    if (!tv) { // 메인: 지금 일하는 자식 쪽, 없으면 바깥으로
      const kids = this.view.childrenOf && this.view.childrenOf.get(v.id);
      if (kids) for (const kid of kids) { const kv = this.view.vis.get(kid); if (kv && !kv.hidden && kv.node.status === 'active') { tv = kv; if (Math.random() < 0.5) break; } }
    }
    if (tv) _dir.copy(tv.group.position).sub(_p2); else _dir.copy(_p2).sub(v.group.position);
    const len = _dir.length();
    _dir.multiplyScalar(1 / Math.max(1e-6, len));
    const reach = tv ? Math.min(len * 0.45, s * 9) : s * 3;
    this.sparks.emit(_p2, _dir, reach * 1.6, 0.12, 0.85, _c.copy(v.mat.color).lerp(_c2.set(0xffffff), 0.45), 1.6);
  }

  dispose() { for (const id of [...this.map.keys()]) { const v = this.view.vis.get(id); if (v) this.detach(v); } this.map.clear(); if (this.sparks) { this.sparks.dispose(); this.sparks = null; } if (this.cages) { this.cages.dispose(); this.cages = null; } if (this.proc) { this.proc.dispose(); this.proc = null; } if (this.gates) { this.gates.dispose(); this.gates = null; } }
}
