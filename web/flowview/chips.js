// 흐름(Flow) 표현의 노드: 육각 기둥(프리즘, 인스턴싱)
// agent-flow 의 노드 그림을 셰이더로: 바깥 글로우 · 옅은 바깥 육각 테두리 · 어두운 내부 · 내부를 지나는 스캔라인 · 상태색 테두리
// (완료=점선·흐림, 오류=맥동) · 가운데 종류 아이콘 · 생각 중엔 도는 입자 4개, 도구 사용 중엔 도는 호(스피너) · 컨텍스트 사용률 고리.
// 예전 빌보드 칩 대신 두께 있는 육각 기둥 — 위 그림은 윗면(바닥과 나란한 면)에 그대로, 옆면은 같은 상태색 테두리(위·아래 띠·모서리)와
// 아래로 흐르는 스캔라인, 방향광 음영. 기둥 1회 그리기(윗면+옆면, 뒤→앞 정렬) + 그림자 1회 그리기(바닥 그림자 원반 + 바닥까지 점선 기둥줄).
// 거리 안개(장면 안개 색 = 배경)·아래층일수록 어둡게(tier-core tierDim). 배치 장치는 같은 자리에서 넓은 상자 기둥.
import * as THREE from 'three';
import { nodeVisualStateAt, runStaleOf, stateColor, kindIcon, paletteOf, breathe, NODE_STATE } from './flow-style.mjs';
import { bandCode, cycleProgress } from '../batch-core.mjs';
import { jobOf } from '../job-core.mjs';
import { STAND, standYawStep, yawToward } from './tier-core.mjs'; // 세운 배치 장치
import { JOB_CHIP, jobChipColor, jobChipModel, newJobChipMemo, jobChipAttr, jobBreathes } from './job-chip-core.mjs'; // 작업 칩
import { RIG, heatRgb, rigCode } from './proc-rig-core.mjs'; // 분리 프로세스 장치
import { procState, procJobId, jobHeat } from '../job-core.mjs';
import { SIL, SIL_NAMES, SIL_DIM, silOf, silOutline } from './shape-core.mjs'; // 실루엣 문법
import { MAIN_RIG } from './main-rig-core.mjs'; // 메인 몸 높이
import { HEAT, HOT_H, CRIT_H } from '../heat-core.mjs'; // 과열 경계(셰이더에 숫자로 박음)
import { warmTintGlsl, warmGlowGlsl } from './heat-fx-core.mjs'; // 데움 곡선(heatLook tint·glow 와 같은 식)

const QUAD = 1.9; // 노드 반지름 대비 사각형 반폭(글로우·고리 여백)

// 정점 셰이더: 기둥(윗면 aPart 0 · 옆면 1)과 그림자(원반 2 · 기둥줄 3)를 같은 인스턴스 속성으로. 위치는 셰이더가 계산(기하 = 모양 틀)
const VS = `
attribute vec4 aShape; attribute vec4 aNorm; attribute vec4 aMeta; // 육각 모서리 xy·상자 모서리 zw / 옆면 바깥 법선(육각 xy·상자 zw, 실루엣 틀은 지역 법선 xyz) / 부분·둘레 좌표·모양(§113 실루엣 0..4)·높이
attribute vec3 iColor; attribute vec3 iKind; attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; attribute vec4 iD;
uniform float uStemW; uniform float uFogNear; uniform float uFogFar;
varying vec2 vP; varying vec3 vColor; varying vec3 vKind; varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD;
varying float vPart; varying float vFace; varying float vShade; varying float vFog; varying float vShape;
void main() {
  float aPart = aMeta.x, aU = aMeta.y; vShape = aMeta.z;
  vec2 aHex = aShape.xy, aBox = aShape.zw, aNHex = aNorm.xy, aNBox = aNorm.zw;
  vColor = iColor; vKind = iKind; vA = iA; vB = iB; vC = iC; vD = iD; vPart = aPart; vFace = 1.0; vShade = 1.0;
  vec3 C = instanceMatrix[3].xyz;
  float s = length(instanceMatrix[0].xyz);
  float fl = floor(iC.x + 0.5);  // 0 보통 · 1 배치 장치 · 2 작업 칩(§97) · 3 분리 프로세스 장치(§103.14) — 정수는 반올림해 푼다(§80.3)
  bool dev = (fl > 0.5 && fl < 1.5) || fl > 2.5; // 분리 프로세스 장치도 세운 상자(기동기와 같은 틀)
  float H = iD.z * s;            // 기둥 두께(세운 배치 장치는 앞뒤 깊이)
  float gy = iD.x;               // 바닥 높이
  // 세운 배치 장치(§51·§80.7): 앞면이 카메라 쪽(iD.w = 방위 yaw, standYawStep). 앞 = fw, 오른쪽 = rt, 위 = +y
  vec3 fw = vec3(sin(iD.w), 0.0, cos(iD.w)), rt = vec3(cos(iD.w), 0.0, -sin(iD.w));
  vec3 w;
  if (aMeta.z > 0.5 && aPart < 1.5) { // §113 실루엣 틀(깎인 육각·두 단·네모 터미널·둥근 퍽): 정점 = 지역 좌표(x·z 반지름 단위, y 두께 단위), 방위 iD.w(네모 터미널만 카메라 쪽)
    float cy = cos(iD.w), sy = sin(iD.w);
    vec3 l;
    if (aPart < 0.5) { vP = aHex * vec2(${QUAD.toFixed(2)}); l = vec3(vP.x * s, aMeta.w * H, -vP.y * s); }
    else {
      l = vec3(position.x * s, position.y * H, position.z * s);
      vec3 nl = aNorm.xyz;
      vec3 n = normalize(vec3(nl.x * cy + nl.z * sy, nl.y, -nl.x * sy + nl.z * cy));
      w = C + vec3(l.x * cy + l.z * sy, l.y, -l.x * sy + l.z * cy);
      vFace = dot(n, normalize(cameraPosition - w));
      vShade = 0.45 + 0.55 * max(0.0, dot(n, normalize(vec3(-0.45, 0.6, 0.66))));
      vP = vec2(aU, aMeta.w);
    }
    w = C + vec3(l.x * cy + l.z * sy, l.y, -l.x * sy + l.z * cy);
  } else if (aPart < 0.5) {             // 윗면: 예전 칩 그림을 바닥과 나란히 눕힘(그림의 위 = -z) — 배치 장치는 세운 앞면(그림의 위 = 위)
    vP = aHex * (dev ? vec2(1.85, 1.1) : vec2(${QUAD.toFixed(2)})); // 세운 장치는 빛무리 판을 상자 둘레만큼만(옆에서 큰 옅은 판이 보이지 않게)
    w = dev ? C + rt * (vP.x * s) + vec3(0.0, vP.y * s, 0.0) + fw * (H * 0.5) : C + vec3(vP.x * s, H * 0.5, -vP.y * s);
  } else if (aPart < 1.5) {      // 옆면: 육각(배치 장치는 세운 상자의 위·아래·양옆) 모서리, 바깥 법선으로 앞뒤·음영
    vec2 q = dev ? aBox : aHex;
    vec2 nn = dev ? aNBox : aNHex;
    vec3 n;
    if (dev) {
      w = C + rt * (q.x * s) + vec3(0.0, q.y * s, 0.0) + fw * ((position.z - 0.5) * H);
      n = normalize(rt * nn.x + vec3(0.0, nn.y, 0.0));
    } else {
      w = C + vec3(q.x * s, (position.z - 0.5) * H, -q.y * s);
      n = normalize(vec3(nn.x, 0.0, -nn.y));
    }
    vFace = dot(n, normalize(cameraPosition - w));
    vShade = 0.45 + 0.55 * max(0.0, dot(n, normalize(vec3(-0.45, 0.6, 0.66))));
    vP = vec2(aU, position.z);
  } else if (aPart < 2.5) {      // 그림자 원반(바닥): 높을수록 넓고 옅게 — 세운 장치는 앞뒤로 납작한 타원
    float hg = max(0.0, C.y - gy);
    float R = s * (dev ? 1.6 : 1.35) * (1.0 + hg * 0.035);
    vP = aHex;
    w = dev ? vec3(C.x, gy + 0.05, C.z) + rt * (aHex.x * R) - fw * (aHex.y * R * 0.5) : vec3(C.x + aHex.x * R, gy + 0.05, C.z - aHex.y * R);
    vShade = hg;
  } else {                       // 바닥 → 기둥 밑면 점선 기둥줄(세로축 빌보드)
    float hg = max(0.0, C.y - (dev ? ${STAND.DEV_HY.toFixed(2)} * s : H * 0.5) - gy);
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
uniform vec3 uFog; uniform float uFogMax; uniform float uStill;
// §127.6 과열 색(heat-fx-core heatColor 와 같은 표): 호박 → 주황 → 빨강
vec3 heatC(float h, bool light) {
  vec3 a = light ? vec3(0.86, 0.50, 0.06) : vec3(1.0, 0.72, 0.30), b = light ? vec3(0.85, 0.32, 0.04) : vec3(1.0, 0.46, 0.16), c = light ? vec3(0.78, 0.12, 0.06) : vec3(1.0, 0.20, 0.12);
  return h < ${HOT_H.toFixed(6)} ? mix(a, b, h / ${HOT_H.toFixed(6)}) : mix(b, c, clamp((h - ${HOT_H.toFixed(6)}) / ${(CRIT_H - HOT_H).toFixed(6)}, 0.0, 1.0));
}
varying vec2 vP; varying vec3 vColor; varying vec3 vKind; varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD;
varying float vPart; varying float vFace; varying float vShade; varying float vFog; varying float vShape;
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
// §113 실루엣 윗면 외곽(변에서 1): 1 깎인 육각(오른쪽 위 꼭짓점) · 2 두 단 윗단(작은 육각) · 3 네모 터미널 · 4 둥근 퍽
float shapeD(vec2 p, float k) {
  if (k < 1.5) return max(hexD(p), dot(p, vec2(0.8660254, 0.5)) / 0.85);
  if (k < 2.5) return hexD(p) / 0.66;
  if (k < 3.5) { vec2 q = abs(p) / vec2(1.12, 0.78); vec2 r = max(q - 0.86, 0.0) / 0.14; return max(max(q.x, q.y), 0.86 + 0.14 * length(r)); }
  return length(p) / 0.96;
}
vec3 bandC(float b) { return b < 1.5 ? uWarn : b < 2.5 ? uOk : b < 3.5 ? uStop : uErr; }
float line(float d, float at, float w) { return smoothstep(w, 0.0, abs(d - at)); }
float seg(vec2 p, vec2 a, vec2 b, float w) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return smoothstep(w, w * 0.35, length(pa - ba * h)); }
// §97 정체 작업의 끊긴 맥박: 2.4초마다 한 번 뛰고 세 번째는 거른다(0.4 바탕 + 맥박)
float jobBeat(float T) {
  float ph = fract(T / 2.4), k = mod(floor(T / 2.4), 3.0);
  return 0.4 + 0.6 * exp(-ph * 9.0) * step(k, 1.5);
}
// §97 작업 칩 윗면: 작은 육각 판 + 상태 글리프(줄 섬 점 셋 · 진행 재생 삼각 · 대기 모래시계 · 끝 체크 · 실패 엑스 · 정체 느낌표)
// + 진행 둘레 호 / 대기 눈금 고리. jc = 표시 상태 번호(반올림해 푼 값), prog = 진행 0..1 | -1, wf = 대기 차오름 0..1 | -1
vec4 jobTop(vec2 p, float d, float l, vec3 C, float T, bool light, float foc, float glowK, float jc, float prog, float wf) {
  bool run = jc > 0.5 && jc < 1.5, wait = jc > 1.5 && jc < 2.5, done = jc > 2.5 && jc < 3.5, fail = jc > 3.5 && jc < 4.5, stale = jc > 4.5;
  float beat = stale ? jobBeat(T) : 1.0;
  vec3 hiC = light ? C * 0.85 : mix(C, vec3(1.0), 0.12);
  float a = atan(p.x, p.y); a = a < 0.0 ? a + 6.2831853 : a; // 위에서 시계 방향 0..2π
  float af = a / 6.2831853;
  // 바깥 빛무리(진행·정체만 또렷, 정체는 맥박에 맞춰)
  float glow = exp(-max(d - 1.0, 0.0) * 3.6) * step(1.0, d) * 0.3 * glowK * (foc > 0.5 ? 1.6 : 1.0) * beat;
  vec3 col = C; float al = glow;
  if (d < 1.0) {
    col = mix(uInterior, C, light ? 0.08 : 0.14); al = light ? 0.95 : 0.92;
    if (run) { float sy = -1.0 + mod(T * 0.7, 2.0); col = mix(col, C, smoothstep(0.14, 0.0, abs(p.y - sy)) * (light ? 0.12 : 0.18)); }
    float g = 0.0;
    if (jc < 0.5) {                     // 줄 섬: 점 셋
      for (int i = 0; i < 3; i++) g = max(g, smoothstep(0.085, 0.045, length(p - vec2(-0.3 + 0.3 * float(i), 0.0))));
      g *= 0.7;
    } else if (run) {                   // 진행: 재생 삼각
      float e = min(p.x + 0.17, (0.25 - p.x) * 0.58 - abs(p.y));
      g = smoothstep(0.0, 0.035, e) * (0.85 + 0.15 * sin(T * 3.0));
    } else if (wait) {                  // 대기: 모래시계 — 위 모래가 줄고 아래가 참(until 이 가까울수록)
      float f = wf > -0.5 ? wf : fract(T * 0.06);
      float ay = abs(p.y), e = min(ay * 0.85 - abs(p.x), 0.32 - ay);
      float frame = smoothstep(0.035, 0.0, abs(e)) * step(-0.035, e);
      frame = max(frame, step(abs(p.x), 0.3) * smoothstep(0.03, 0.0, abs(ay - 0.32)));
      float inside = step(0.0, e);
      float sandTop = inside * step(0.0, p.y) * step(p.y, 0.3 * (1.0 - f));
      float sandBot = inside * step(p.y, 0.0) * step(p.y, -0.31 + 0.3 * f);
      float drip = step(abs(p.x), 0.02) * step(-0.3, p.y) * step(p.y, 0.0) * step(f, 0.98);
      g = max(frame, max(sandTop, sandBot) * 0.75); g = max(g, drip * 0.6);
    } else if (done) {                  // 끝: 체크
      g = max(seg(p, vec2(-0.26, 0.02), vec2(-0.07, -0.17), 0.075), seg(p, vec2(-0.07, -0.17), vec2(0.27, 0.19), 0.075)) * 0.85;
    } else if (fail) {                  // 실패: 엑스
      g = max(seg(p, vec2(-0.2, -0.2), vec2(0.2, 0.2), 0.075), seg(p, vec2(-0.2, 0.2), vec2(0.2, -0.2), 0.075)) * 0.9;
    } else {                            // 정체: 느낌표(맥박에 맞춰)
      g = max(seg(p, vec2(0.0, 0.26), vec2(0.0, -0.04), 0.08), smoothstep(0.08, 0.045, length(p - vec2(0.0, -0.2))));
      g *= 0.55 + 0.45 * beat;
    }
    col = mix(col, hiC, g);
  }
  // 육각 테두리: 진행 또렷 · 대기/줄 섬 흐림(줄 섬은 점선) · 끝·실패 차분(맥동 없음) · 정체는 끊긴 테 + 맥박
  float ring = line(d, 1.0, foc > 0.5 ? 0.075 : 0.06);
  if (jc < 0.5) ring *= step(0.5, fract(af * 18.0)) * 0.5;
  else if (wait) ring *= 0.85;
  else if (done) ring *= 0.55;
  else if (fail) ring *= 0.8;
  else if (stale) ring *= step(0.24, fract(af * 6.0 + 0.12)) * beat;
  col = mix(col, hiC, ring); al = max(al, ring);
  // 진행 둘레 호(위에서 시계 방향) — 비율을 모르는 진행은 느리게 도는 짧은 호
  float track = line(l, 1.3, 0.045);
  if (prog > -0.5) {
    float fill = track * step(af, prog);
    col = mix(col, C, track * 0.15 * (1.0 - fill)); al = max(al, track * (light ? 0.28 : 0.24));
    col = mix(col, hiC, fill); al = max(al, fill * 0.95 * (stale ? 0.5 + 0.5 * beat : 1.0));
  } else if (run) {
    float da = mod(a - mod(T * 1.6, 6.2831853) + 6.2831853, 6.2831853);
    float arc = track * step(da, 1.2) * (0.3 + 0.7 * da / 1.2);
    col = mix(col, C, arc); al = max(al, arc * 0.8);
  }
  // 대기 눈금 고리: 12칸, until 쪽으로 차오름(모르면 흐린 눈금만)
  if (wait) {
    float r0 = prog > -0.5 ? 1.5 : 1.3;
    float tick = smoothstep(0.08, 0.04, abs(l - r0)) * smoothstep(0.32, 0.2, abs(fract(af * 12.0) - 0.5));
    float lit = wf > -0.5 ? step((floor(af * 12.0) + 0.5) / 12.0, wf) : 0.0;
    col = mix(col, lit > 0.5 ? hiC : C, tick); al = max(al, tick * (lit > 0.5 ? 0.9 : (light ? 0.3 : 0.22)));
  }
  return vec4(col, al);
}
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
  float flag = floor(vC.x + 0.5);  // 0 보통 · 1 배치 장치 · 2 작업 칩(§97) · 3 분리 프로세스 장치(§103.14) — 반올림해 푼다(§80.3)
  bool rig = flag > 2.5, dev = (flag > 0.5 && flag < 1.5) || rig, job = flag > 1.5 && flag < 2.5;
  float jc = floor(vC.y + 0.5);
  float T = uTime + seed * 10.0;
  vec3 C = vColor;
  // §127.6 과열: 그리는 heat(vB.w)만큼 테두리·옆면 띠·글로우가 주황 → 빨강으로 물들고, 과열(HOT_H↑ = 70%)부터 맥동(움직임 줄이기면 정지)
  float hk = vB.w, hpul = 1.0;
  if (hk > 0.004) {
    if (uStill < 0.5 && hk >= ${HOT_H.toFixed(6)}) hpul = 1.0 - (hk >= ${CRIT_H.toFixed(6)} ? 0.45 : 0.3) * (0.5 - 0.5 * cos(6.2831853 * (uTime * (hk >= ${CRIT_H.toFixed(6)} ? 2.0 : 1.1) + seed)));
    C = mix(C, heatC(hk, light), ${warmTintGlsl('hk')} * (0.75 + 0.25 * hpul)); // heat-fx-core warmTint 와 같은 곡선(30% 부터 뚜렷, 40% 면 한눈에)
  }
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
    if (vShape > 0.5 && h > 1.5) { // §113 두 단 육각 이음 틈: 종류색으로 은은히(독립 세션의 '두 몸')
      float sh = h - 2.0;
      vec3 sc = mix(uInterior, vKind, light ? 0.5 : 0.35) * (0.6 + 0.4 * vShade);
      sc = mix(sc, light ? vKind * 0.8 : mix(vKind, vec3(1.0), 0.2), smoothstep(0.35, 0.0, abs(sh - 0.5)) * 0.6);
      gl_FragColor = finish(sc, light ? 0.95 : 0.9);
      return;
    }
    vec3 body = mix(uInterior, C, light ? 0.14 : 0.2);
    vec3 col = body * (light ? 0.8 + 0.2 * vShade : vShade) * (0.72 + 0.28 * h);
    float k = floor(p.x + 0.5);
    float corner = (dev && mod(k, 3.0) < 0.5) ? 0.0 : 1.0;   // 상자는 가짜 모서리(가운데) 빼고
    float edge = smoothstep(0.05, 0.0, abs(p.x - k)) * 0.5 * corner;
    float rim = max(smoothstep(0.18, 0.0, 1.0 - h), smoothstep(0.1, 0.0, h) * 0.4);
    if (job) {                   // §97 작업 칩 옆면: 진행 또렷 · 대기/줄 섬/끝 흐림 · 실패 차분(맥동 없음) · 정체 맥박
      rim *= jc < 0.5 ? 0.45 : jc < 1.5 ? 1.0 : jc < 2.5 ? 0.75 : jc < 3.5 ? 0.5 : jc < 4.5 ? 0.7 : jobBeat(T);
    } else if (rig) {            // §103.14 분리 프로세스 장치 옆면: 과열만큼 몸이 달아오름(다크 발광 · 라이트 진한 잉크), 정체는 끊긴 맥박, 끝은 차분
      float rc = floor(vC.y + 0.5), hh = vC.z;
      rim *= rc < 0.5 ? 1.0 : rc < 1.5 ? jobBeat(T) : rc < 2.5 ? 0.55 : rc < 3.5 ? 0.8 : 0.45;
      if (rc < 0.5) col = mix(col, light ? C * 0.55 : C, hh * (light ? 0.3 : 0.16) * (0.4 + 0.6 * h));
      // 옆면 환기 틈(가로 줄 셋) — 돌아가는 기계로 읽히게
      float vent = step(0.5, fract(h * 9.0)) * step(0.3, h) * step(h, 0.72) * step(0.18, abs(fract(p.x) - 0.5));
      col = mix(col, light ? C * 0.6 : C * (0.35 + 0.65 * hh), vent * (rc < 0.5 ? 0.22 + 0.3 * hh : 0.1));
    } else {
    if (st > 2.5 && st < 3.5) rim *= 0.5;
    if (st > 3.5 && st < 4.5) rim *= 0.75 + 0.25 * sin(T * 6.0);
    if (st > 4.5) rim *= 0.6;
    }
    float sp = job ? (jc > 0.5 && jc < 1.5 ? 0.7 : 0.0) : rig ? (floor(vC.y + 0.5) < 0.5 ? 1.0 : 0.0) : (st > 0.5 && st < 2.5) ? 1.3 : 0.45;
    float sy = 1.0 - fract(T * sp * 0.5);
    float scan = smoothstep(0.1, 0.0, abs(h - sy)) * (light ? 0.2 : 0.32) * step(0.001, sp);
    float lit = max(max(rim, edge), scan);
    col = mix(col, light ? C * 0.9 : mix(C, vec3(1.0), 0.1), lit);
    gl_FragColor = finish(col, light ? 0.96 : 0.94);
    return;
  }
  bool gen = vShape > 0.5;
  float d = gen ? shapeD(p, vShape) : dev ? devD(p) : hexD(p), l = length(p);
  float topK = vShape > 1.5 && vShape < 2.5 ? 0.66 : vShape > 2.5 && vShape < 3.5 ? 0.8 : 1.0;
  if (job) { vec4 jt = jobTop(p, d, l, C, T, light, foc, glowK, jc, vC.z, vC.w); gl_FragColor = finish(jt.rgb, jt.a); return; }
  vec3 col = vec3(0.0); float al = 0.0;
  // 바깥 글로우(상태색)
  float ga = max((foc > 0.5 ? 0.42 : st > 0.5 && st < 2.5 ? 0.24 : 0.12) * glowK, (hk > 0.004 ? ${warmGlowGlsl('hk')} : 0.0) * (light ? 0.3 : 0.5) * hpul); // §127.6 데움 글로우(warmGlow)
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
    if (rig) {
      // §103.14 분리 프로세스 장치 앞면: 어두운 계기 유리 + 위 가장자리 과열 띠 + 계기 줄 두 개의 흐린 바탕(숫자·그래프는 procrig.js 계기판 캔버스가 덮어 그림 —
      // 멀어서 계기판이 없을 때도 '계기가 달린 기계'로 읽히게). 과열만큼 유리가 물듦(다크 발광 · 라이트 진한 잉크)
      float rc = floor(vC.y + 0.5), hh = vC.z;
      col = mix(col, C, (light ? 0.05 : 0.05) + hh * (rc < 0.5 ? (light ? 0.08 : 0.07) : 0.0));
      float band = smoothstep(0.06, 0.0, abs(p.y - 0.68)) * step(abs(p.x), 1.3);
      col = mix(col, C, band * (rc < 0.5 ? 0.35 + 0.5 * hh : 0.25));
      for (int i = 0; i < 2; i++) {
        vec2 q = p - vec2(0.12, 0.26 - 0.4 * float(i));
        float row = step(abs(q.x), 1.05) * step(abs(q.y), 0.13);
        col = mix(col, C, row * (light ? 0.07 : 0.1));
      }
    } else if (dev) {
      // 장치 앞면: 위 = 회차 진행 막대(경과/평균), 오른쪽 위 = 진행 표시등, 아래 = 최근 회차 상태 띠(오래된 → 최근)
      // 인스턴스 속성도 varying 으로 오면 보간 오차(±1e-4 안팎, 기기·각도·크기마다 다름)가 붙는다. 정수 값은 반올림해 쓰고 경계 비교는 여유를 둔다
      // (예전엔 칸 수 nb 가 4.9999 가 되면 맨 왼쪽 칸 slot 이 -0.0001 → 빈 칸, code 가 936.9998 이면 끝자리가 바뀌어 화소마다 색이 튀었다 = '지지직')
      float code = floor(vC.y + 0.5), nb = floor(vC.z + 0.5), prog = vC.w;
      bool run = prog > -0.5;
      vec2 sp = p - vec2(-0.2, 0.3);
      if (abs(sp.y) < 0.09 && abs(sp.x) < 0.9) {
        float fillx = (sp.x + 0.9) / 1.8;
        bool on = run && fillx <= prog;
        col = mix(col, on ? uWarn : C, on ? 0.85 : 0.22);
      }
      float ledOn = run || code > 0.5 ? 1.0 : 0.0;
      float led = smoothstep(0.13, 0.07, length(p - vec2(1.0, 0.3)));
      float blink = run ? (0.45 + 0.55 * step(0.0, sin(T * 6.0))) : 0.35;
      col = mix(col, run ? uWarn : uOk, led * blink * ledOn);
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float cx = -1.0 + fi * 0.5;
        vec2 bp = p - vec2(cx, -0.36);
        float cell = step(abs(bp.x), 0.19) * step(abs(bp.y), 0.13);
        float slot = fi - (5.0 - nb);           // 오른쪽 정렬: 최근이 오른쪽 끝
        float b = 0.0;
        if (slot > -0.5) { float q = floor((code + 0.5) / floor(pow(5.0, slot) + 0.5)); b = q - 5.0 * floor((q + 0.5) / 5.0); }
        vec3 bc = b > 0.5 ? bandC(b) : C;
        float pul = b > 0.5 && b < 1.5 ? 0.7 + 0.3 * sin(T * 4.0) : 1.0;
        col = mix(col, bc, cell * (b > 0.5 ? 0.9 * pul : 0.18));
      }
    } else {
    // 아이콘
    float ic = icon(p / (0.95 * topK), ik);
    vec3 icC = mix(vKind, C, 0.35);
    col = mix(col, light ? icC * 0.9 : mix(icC, vec3(1.0), 0.15), ic * 0.9);
    if (vShape > 0.5 && vShape < 1.5) { // §113 워크플로 에이전트: 깎인 모서리 안쪽 작은 삼각 표(종류색)
      vec2 q = (p - vec2(0.5, 0.29)) / 0.17;
      float tri = smoothstep(0.08, 0.0, max(abs(q.x) * 0.866 + q.y * 0.5, -q.y) - 0.5);
      col = mix(col, light ? icC * 0.85 : mix(icC, vec3(1.0), 0.2), tri * 0.85);
    }
    }
  }
  if (vShape > 3.5) { // §113 모니터 퍽: 가운데서 퍼지는 파동 셋(감시 중엔 빠르게)
    float spd = st > 0.5 && st < 2.5 ? 0.55 : 0.18;
    for (int i = 0; i < 3; i++) {
      float u = fract(T * spd + float(i) / 3.0);
      float rr = 0.25 + u * 1.25;
      float wv = line(l, rr, 0.035) * (1.0 - u) * (light ? 0.5 : 0.42);
      col = mix(col, vKind, wv); al = max(al, wv);
    }
  }
  // 상태색 테두리: 완료 = 점선·흐림, 중지 = 회색 얇게, 오류 = 맥동
  float w = foc > 0.5 ? 0.075 : 0.055;
  float ring = line(d, 1.0, w);
  if (st > 2.5 && st < 3.5) { float a = atan(p.y, p.x); ring *= step(0.5, fract(a / 6.2831853 * 24.0)) * 0.55; }
  if (st > 3.5 && st < 4.5) ring *= 0.75 + 0.25 * sin(T * 6.0);
  if (st > 4.5) ring *= 0.6;
  col = mix(col, light ? C * 0.9 : mix(C, vec3(1.0), 0.1), ring); al = max(al, ring);
  // 생각 중: 도는 입자 4개 / 도구 사용 중: 도는 호(스피너) — 분리 프로세스 장치는 로터가 대신함
  if (rig) {}
  else if (st > 0.5 && st < 1.5) {
    float best = 0.0;
    for (int i = 0; i < 4; i++) { float a = T * 1.5 + float(i) * 1.5707963; vec2 q = vec2(cos(a), sin(a)) * 1.36; best = max(best, smoothstep(0.075, 0.03, length(p - q))); }
    col = mix(col, C, best); al = max(al, best * 0.8);
  } else if (st > 1.5 && st < 2.5) {
    float a = atan(p.y, p.x), a0 = mod(T * 3.0, 6.2831853);
    float da = mod(a - a0 + 6.2831853, 6.2831853);
    float arc = line(l, 1.38, 0.04) * step(da, 1.6) * (0.35 + 0.65 * (da / 1.6));
    col = mix(col, C, arc); al = max(al, arc * 0.85);
  }
  // 컨텍스트 사용률 고리(위에서 시계 방향, 30% 미만 하늘·70% 미만 호박·그 이상 빨강 맥동)
  if (ctxp > 0.001) {
    float a = atan(p.x, p.y); a = a < 0.0 ? a + 6.2831853 : a;
    float track = line(l, 1.55, 0.035);
    float fill = track * step(a / 6.2831853, ctxp);
    vec3 cc = ctxp < ${(HEAT.WARM_PCT / 100).toFixed(4)} ? uHolo : ctxp < ${(HEAT.HOT_PCT / 100).toFixed(4)} ? uWarn : uErr; // §127.6 과열 단계(30 데움·70 과열)와 같은 경계(shape-core ctxTone)
    float pul = ctxp >= ${(HEAT.HOT_PCT / 100).toFixed(4)} && uStill < 0.5 ? 0.75 + 0.25 * sin(T * 6.0) : 1.0;
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
  const n = part.length, shape = new Float32Array(n * 4), norm = new Float32Array(n * 4), meta = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    shape[i * 4] = hex[i * 2]; shape[i * 4 + 1] = hex[i * 2 + 1]; shape[i * 4 + 2] = box[i * 2]; shape[i * 4 + 3] = box[i * 2 + 1];
    norm[i * 4] = nh[i * 2]; norm[i * 4 + 1] = nh[i * 2 + 1]; norm[i * 4 + 2] = nb[i * 2]; norm[i * 4 + 3] = nb[i * 2 + 1];
    meta[i * 4] = part[i]; meta[i * 4 + 1] = u[i];
  }
  g.setAttribute('aShape', new THREE.BufferAttribute(shape, 4));
  g.setAttribute('aNorm', new THREE.BufferAttribute(norm, 4));
  g.setAttribute('aMeta', new THREE.BufferAttribute(meta, 4));
  g.setIndex(idx);
  return g;
}
// 실루엣 틀: 지역 좌표 정점(x·z = 반지름 단위, y = 두께 단위 −0.5..0.5) — 옆면(두 단 이음 틈·아랫단 윗면 턱) 먼저, 윗면 사각 나중.
// 정점 속성은 예전 틀과 같은 셋(aShape·aNorm·aMeta): aShape.xy = 윗면 사각 모서리, aNorm.xyz = 지역 법선, aMeta = (부분, 둘레, 모양, 높이 표)
export function silGeometry(sil) {
  const P = [], S = [], N = [], M = [], idx = [];
  const shp = SIL[sil];
  const put = (x, y, z, part, sh, n, u, h) => { P.push(x, y, z); S.push(sh[0], sh[1], 0, 0); N.push(n[0], n[1], n[2], 0); M.push(part, u, shp, h); return P.length / 3 - 1; };
  // 그림 좌표(x 오른쪽, y 위 = 지역 −z)의 외곽(반시계) → 옆면 띠(y0..y1), 둘레 좌표 uOf(i), 높이 표 h0..h1
  const ring = (pts, y0, y1, uOf, h0 = 0, h1 = 1) => {
    const m = pts.length;
    let ccw = 0; for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % m]; ccw += a[0] * b[1] - b[0] * a[1]; }
    const sg = ccw > 0 ? 1 : -1;
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[(i + 1) % m];
      const ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey) || 1;
      const nx = (ey / L) * sg, ny = (-ex / L) * sg; // 그림 좌표 바깥 법선
      const n = [nx, 0, -ny];
      const o = put(a[0], y0, -a[1], 1, [0, 0], n, uOf(i), h0);
      put(b[0], y0, -b[1], 1, [0, 0], n, uOf(i + 1), h0);
      put(b[0], y1, -b[1], 1, [0, 0], n, uOf(i + 1), h1);
      put(a[0], y1, -a[1], 1, [0, 0], n, uOf(i), h1);
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
  };
  const hexPts = (r) => HEX.map(([x, y]) => [x * r, y * r]);
  const flip = (pts) => pts.map(([x, y]) => [x, -y]); // silOutline(화면 y 아래) → 그림 좌표
  const D = SIL_DIM[sil];
  const intU = (i) => i;
  if (sil === 'tier2') {
    const yl = -0.5 + D.lower, ys = yl + D.seam;
    ring(hexPts(1), -0.5, yl, intU);
    ring(hexPts(0.5), yl, ys, intU, 2, 3); // 이음 틈(높이 표 2..3)
    ring(hexPts(D.top), ys, 0.5, intU);
    // 아랫단 윗면 턱(바깥 1 → 안 0.5 육각 고리, 위를 향함) — 상태색 테가 옅게
    const out = hexPts(1), inn = hexPts(0.5);
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      const o = put(out[i][0], yl, -out[i][1], 1, [0, 0], [0, 1, 0], 0.5, 0.92);
      put(out[j][0], yl, -out[j][1], 1, [0, 0], [0, 1, 0], 0.5, 0.92);
      put(inn[j][0], yl, -inn[j][1], 1, [0, 0], [0, 1, 0], 0.5, 0.6);
      put(inn[i][0], yl, -inn[i][1], 1, [0, 0], [0, 1, 0], 0.5, 0.6);
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
  } else if (sil === 'puck') {
    ring(flip(silOutline('puck', 1)), -0.5, 0.5, (i) => 0.3 + (i / 24) * 0.4); // 매끈한 원통: 둘레 좌표가 정수를 넘지 않아 모서리선 없음
  } else {
    ring(sil === 'hex' ? hexPts(1) : flip(silOutline(sil, 1)), -0.5, 0.5, intU);
  }
  const o = put(0, 0, 0, 0, [-1, -1], [0, 1, 0], 0, 0.5);
  put(0, 0, 0, 0, [1, -1], [0, 1, 0], 0, 0.5); put(0, 0, 0, 0, [1, 1], [0, 1, 0], 0, 0.5); put(0, 0, 0, 0, [-1, 1], [0, 1, 0], 0, 0.5);
  idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aShape', new THREE.Float32BufferAttribute(S, 4));
  g.setAttribute('aNorm', new THREE.Float32BufferAttribute(N, 4));
  g.setAttribute('aMeta', new THREE.Float32BufferAttribute(M, 4));
  g.setIndex(idx);
  return g;
}

// 깊이만 쓰는 패스: 색 셰이더를 그대로 돌리고 눈에 보일 만큼 불투명한 조각만 깊이를 남긴다(빛무리·투명한 테두리 밖·희미한 퇴장 노드는 앞의 선을 가리지 않음)
// 실루엣마다 인스턴스 묶음이 따로라(그리기 순서 = 묶음 순) 깊이 패스를 색보다 먼저(0.9) 그린다 — 색 패스는 깊이 시험으로 앞 노드에 가려져 묶음 사이 앞뒤가 맞는다
const FS_DEPTH = FS.replace('void main() {', 'void mainColor() {') + `
void main() { mainColor(); if (gl_FragColor.a < 0.35) discard; }
`;
const THICK = { device: 0.7 }; // 배치 장치(세움)는 앞뒤 깊이. 그 밖은 실루엣 두께(SIL_DIM.h), 작업 칩·분리 프로세스는 각자 값
const ATTRS = [['iColor', 3], ['iKind', 3], ['iA', 4], ['iB', 4], ['iC', 4], ['iD', 4]];

/** 실루엣 하나 = 인스턴스 묶음(색 + 깊이) 또는 그림자 묶음(그림자 원반 + 기둥줄) */
class Bucket {
  constructor(scene, geo, mat, dmat, cap, ro) {
    this.cap = cap; this.n = 0;
    const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
    this.a = {};
    for (const [k, n] of ATTRS) { this.a[k] = mk(n); geo.setAttribute(k, this.a[k]); }
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = ro;
    scene.add(this.mesh);
    if (dmat) {
      this.depth = new THREE.InstancedMesh(geo, dmat, cap);
      this.depth.instanceMatrix = this.mesh.instanceMatrix;
      this.depth.count = 0; this.depth.frustumCulled = false; this.depth.renderOrder = 0.9;
      scene.add(this.depth);
    }
  }
  /** 임시 값 t 를 다음 인스턴스로 */
  put(m, t) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.mesh.setMatrixAt(i, m);
    for (const [k, n] of ATTRS) { const A = this.a[k].array, src = t[k]; for (let j = 0; j < n; j++) A[i * n + j] = src[j]; }
  }
  flush() {
    this.mesh.count = this.n; if (this.depth) this.depth.count = this.n;
    if (this.n) { this.mesh.instanceMatrix.needsUpdate = true; for (const [k] of ATTRS) this.a[k].needsUpdate = true; }
  }
  dispose() { this.mesh.removeFromParent(); if (this.depth) this.depth.removeFromParent(); this.mesh.geometry.dispose(); }
}

export class NodeChips {
  constructor(scene, view, cap = 1024) {
    this.view = view;
    this.cap = cap;
    this.uniforms = { uTime: { value: 0 }, uLight: { value: 0 }, uInterior: { value: new THREE.Color() }, uHolo: { value: new THREE.Color() }, uWarn: { value: new THREE.Color() }, uErr: { value: new THREE.Color() }, uOk: { value: new THREE.Color() }, uStop: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() }, uFogNear: { value: 80 }, uFogFar: { value: 300 }, uFogMax: { value: 0.5 }, uStemW: { value: 0.08 }, uStill: { value: 0 } };
    // 재질 둘(색·깊이)을 모든 실루엣 묶음과 그림자가 나눠 쓴다(같은 셰이더 = 프로그램 하나)
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.dmat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS_DEPTH, transparent: true, depthWrite: true, colorWrite: false, side: THREE.DoubleSide });
    // 실루엣 묶음: hex(서브에이전트·배치 장치·작업 칩·분리 프로세스 — 예전 틀) · cham · tier2 · term · puck. 메인은 MainRigs 가 그림(그림자만 여기)
    this.buckets = {};
    for (const sil of SIL_NAMES) this.buckets[sil] = new Bucket(scene, sil === 'hex' ? prismGeometry() : silGeometry(sil), this.mat, this.dmat, sil === 'hex' ? cap : Math.max(64, cap >> 1), 1);
    this.shadow = new Bucket(scene, shadowGeometry(), this.mat, null, cap, 0.5); // 그림자(바닥 원반 + 기둥줄), 바닥층 다음·빔 전
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._c = new THREE.Color(); this._f = new THREE.Vector3();
    this._t = Object.fromEntries(ATTRS.map(([k, n]) => [k, new Float32Array(n)]));
    this._colCache = new Map();
    this._jobCol = [];
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
    this._jobCol.length = 0;
  }
  /** 작업 칩 색(표시 상태 번호별 THREE.Color, 테마마다 한 번 만듦) */
  jobColor(code) {
    let c = this._jobCol[code];
    if (!c) { c = new THREE.Color(jobChipColor(code, this.isLight)); this._jobCol[code] = c; }
    return c;
  }
  /** 분리 프로세스 장치 칩 값: 상태 번호(0 돎·1 정체·2 끝·3 실패·4 중지) · 과열(자동 진행 작업의 heat) · 색(돎 = 과열 색, 그 밖 상태색) */
  _rigAttr(v, nowMs) {
    const st = procState(v.node);
    const jv = this.view.vis.get(procJobId(v.node));
    const heat = jv ? jobHeat(jv.node.meta.job) : 0;
    const m = v._rigC || (v._rigC = { col: new THREE.Color(), rgb: [0, 0, 0], code: 0, heat: 0 });
    m.code = rigCode(st); m.heat = heat;
    const P = paletteOf(this.isLight);
    if (m.code === 0) { heatRgb(heat, this.isLight, m.rgb); m.col.setRGB(m.rgb[0], m.rgb[1], m.rgb[2]); } // 과열 표는 화면 값 그대로(셰이더가 색 변환 없이 씀)
    else m.col.set(m.code === 1 ? P.jobStale : m.code === 2 ? P.done : m.code === 3 ? P.error : P.stopped);
    void nowMs;
    return m;
  }
  _col(state) {
    let c = this._colCache.get(state);
    if (!c) { c = new THREE.Color(stateColor(state, this.isLight)); this._colCache.set(state, c); }
    return c;
  }
  /** 노드 → 실루엣 이름(silOf). 메인(독립 claude -p 루트는 표시 종류가 claude-p 라 제외)은 null — MainRigs 가 그린다 */
  silOf(v) {
    const key = (v.procRig ? 1 : 0) + (jobOf(v.node) ? 2 : 0);
    if (v._sil !== undefined && v._silK === key) return v._sil;
    v._silK = key;
    if (v.kind === 'main' && !v.device) return (v._sil = null);
    return (v._sil = silOf(v.kind, { device: !!v.device, job: !!(key & 2), proc: !!v.procRig }));
  }
  update(now) {
    const view = this.view;
    this.uniforms.uTime.value = now % 1000;
    this.uniforms.uStill.value = view.reduced ? 1 : 0;
    const dt = this._t0 != null ? Math.min(0.25, Math.max(0, now - this._t0)) : 0; this._t0 = now;
    const T = this._t, C = T.iColor, K = T.iKind, A = T.iA, B = T.iB, D = T.iC, E = T.iD;
    const nowMs = view.clock ? view.clock() : Date.now();
    // 뒤 → 앞으로(카메라 시선 깊이) 정렬: 같은 묶음 안에서 겹친 기둥의 반투명 가장자리가 바르게 덮이게(300개 정렬 ≈ 0.05ms)
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
    const floorY = view.tierFloor ?? 0;
    for (const k in this.buckets) this.buckets[k].n = 0;
    this.shadow.n = 0;
    let n = 0;
    for (const v of ord) {
      if (n >= this.cap) break;
      const node = v.node;
      const sil = this.silOf(v);
      const st = nodeVisualStateAt(node, v.icons ? v.icons.size : 0, nowMs); // 오래 도는 셸 = 도구 사용 모습
      // 작업 노드: 표시 상태(렌더러 시계 — 정체 판정)는 JOB_CHIP.REFRESH_MS 마다, 대기 차오름은 보관한 시각으로 산술만(객체 안 만듦)
      const job = jobOf(node);
      const jm = job ? jobChipModel(v._jobChip || (v._jobChip = newJobChipMemo()), job, nowMs) : null;
      // 크기: SceneView 가 매 프레임 계산한 메시 배율(등장·퇴장·오래된 완료 축소 포함) × 숨쉬기(작업은 진행 중일 때만). 메인 그림자는 숨쉬지 않음
      const s = v.mesh.scale.x * (jm && !jobBreathes(jm.code) ? 1 : sil ? breathe(st, now, v.seed) : 1);
      this._s.setScalar(Math.max(0.0001, s));
      this._m.compose(v.group.position, this._q, this._s);
      // 같은 프로젝트 live 메인이 여럿이면 메인 테두리(상태색 자리)를 그 세션 색으로 — 오류·중지·완료는 상태색 그대로
      const rg = !jm && v.procRig ? this._rigAttr(v, nowMs) : null; // 분리 프로세스 장치: 상태 번호·과열·색
      const c = rg ? rg.col : jm ? this.jobColor(jm.code) : runStaleOf(node, nowMs) ? this.jobColor(5) : v.sessC && v.kind === 'main' && !node.parentId && (st === NODE_STATE.idle || st === NODE_STATE.thinking || st === NODE_STATE.tool) ? v.sessC : this._col(st), kc = view.kindColor(v.kind);
      C[0] = c.r; C[1] = c.g; C[2] = c.b;
      K[0] = kc.r; K[1] = kc.g; K[2] = kc.b;
      const sk = v.scopeK ?? 1;
      const endK = st === NODE_STATE.done ? 0.7 : st === NODE_STATE.stopped ? 0.6 : 1;
      const near = v.nearFaded ? Math.max(0.15, v.mat.opacity / Math.max(0.01, v.baseOpacity || 1)) : 1;
      const ctx = node.meta && node.meta.ctx;
      const ctxp = ctx && ctx.limit ? Math.min(1, Math.max(0, ctx.used / ctx.limit)) : 0;
      A[0] = st; A[1] = kindIcon(v.kind); A[2] = (v.exitF ?? 1) * Math.min(1, sk * 1.3) * (jm ? JOB_CHIP.ALPHA[jm.code] ?? 1 : endK) * near; A[3] = jm ? 0 : ctxp;
      v._alphaK = A[2]; // 메인 몸·네모 터미널 앞면 글이 같은 투명도를 쓴다
      const foc = v.id === view.focusId || v.id === view.hoverId ? 1 : 0;
      B[0] = v.seed; B[1] = foc; B[2] = (v.stale ? 0.4 : 1) * (jm ? JOB_CHIP.GLOW[jm.code] ?? 1 : 1); B[3] = jm || rg ? 0 : v._heatK || 0; // 과열(HeatFx.step 이 적은 보간 heat)
      if (jm) jobChipAttr(D, 0, jm, nowMs); // 작업 칩: (2, 표시 상태, 진행 | -1, 대기 차오름 | -1)
      else if (rg) { D[0] = RIG.FLAG; D[1] = rg.code; D[2] = rg.heat; D[3] = -1; A[3] = 0; }
      else if (v.device && v.devInfo) {
        // 배치 장치: 띠(5진수) · 칸 수 · 진행(경과/평균, 진행 중 회차가 없으면 -1)
        const info = v.devInfo;
        const cur = info.running > 0 && info.currentId ? view.vis.get(info.currentId) : null;
        const pr = cur ? cycleProgress(info, cur.node, nowMs) : null;
        D[0] = 1; D[1] = v._bandCode ?? (v._bandCode = bandCode(info.band)); D[2] = info.band.length;
        D[3] = info.running > 0 ? (pr == null ? 1 : pr) : -1;
      } else { D[0] = 0; D[1] = 0; D[2] = 0; D[3] = -1; }
      // 바닥 높이 · 아래층 어둡게 · 기둥 두께(실루엣별, 메인은 그림자 기둥줄이 몸 밑에서 시작하게 MAIN_RIG.BOTTOM)
      E[0] = floorY; E[1] = v.tierDim || 0;
      E[2] = v.device ? THICK.device : rg ? RIG.THICK : jm ? JOB_CHIP.THICK : sil ? SIL_DIM[sil].h : MAIN_RIG.BOTTOM * 2;
      // 세운 배치 장치 · 네모 터미널: 앞면 방위(카메라 쪽, 크게 벗어날 때만 돎). FlowView 가 집기 상자도 같은 방위로 돌린다
      E[3] = v.device || rg || sil === 'term' ? standYawStep(v._stand || (v._stand = {}), yawToward(v.group.position.x, v.group.position.z, cp.x, cp.z) + STAND.OFFSET, dt, !!view.reduced) : 0;
      v._yaw = E[3]; v._sz = s;
      if (sil) this.buckets[sil].put(this._m, T);
      this.shadow.put(this._m, T);
      n++;
    }
    for (const k in this.buckets) this.buckets[k].flush();
    this.shadow.flush();
    this.count = n;
  }
  dispose() { for (const k in this.buckets) this.buckets[k].dispose(); this.shadow.dispose(); this.mat.dispose(); this.dmat.dispose(); }
}
