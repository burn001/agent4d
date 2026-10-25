// 홀로그램 모니터(도형 모드). 도구를 쓰면 노드 주위 종류별 방향에 반투명 화면이 펼쳐지고,
// 안에는 서버가 보낸 실제 출력 몇 줄(panel,: 명령·출력·diff·검색 결과·에이전트 진행·말)을 그린다(holo-text.js).
// 끝나면 결과색(초록·빨강·회색)으로 번쩍이고 위아래로 접혀 사라진다.
// 그리기: InstancedMesh 1개(모든 패널의 틀 — 실루엣·머리 띠·글리프·테두리·스캔라인, 셰이더) + 글리프 아틀라스 1장(처음 한 번)
//        + 글 평면 풀(PANEL.TEXT_MAX개, 내용이 바뀔 때만 캔버스를 다시 그림) + 에이전트 포털 빛줄 LineSegments 1개 + 라벨(CSS2D).
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { HOLO, PANEL, HoloBook, holoDir, holoOffset, panelPx, holoLod } from './holo-core.mjs';
import { HoloText } from './holo-text.js';
import { catColor } from './flow-core.mjs';
import { foldSlide, foldLine } from './exit-core.mjs';

const VS = `
attribute vec3 iColor; attribute vec3 iFlash; attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;
varying vec2 vUv; varying vec3 vColor; varying vec3 vFlash; varying vec4 vA; varying vec4 vB; varying vec4 vC;
void main() {
  vUv = uv; vColor = iColor; vFlash = iFlash; vA = iA; vB = iB; vC = iC;
  // 화면을 늘 카메라 쪽으로(빌보드): 중심만 행렬에서, 크기는 열 길이에서
  vec4 c = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
  c.xy += position.xy * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  gl_Position = projectionMatrix * c;
}`;

const FS = `
uniform float uTime; uniform float uLight; uniform sampler2D uAtlas;
varying vec2 vUv; varying vec3 vColor; varying vec3 vFlash; varying vec4 vA; varying vec4 vB; varying vec4 vC;
float ASP;   // 패널 폭/높이(종류별, iC.y)
float hs;
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdRBox(vec2 p, vec2 b, float r) { return sdBox(p, b - r) - r; }
float sdHex(vec2 p, float r) { p = abs(p); return max(p.x * 0.8660254 + p.y * 0.5, p.y) - r; }
float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) {   // iq 삼각형 SDF
  vec2 e0 = b - a, e1 = c - b, e2 = a - c, v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
// 종류별 실루엣(§38.10·§52): P = 높이 기준 좌표(x ±ASP/2, y ±0.5), 음수가 안
float shapeSD(vec2 P, float sh) {
  float hx = ASP * 0.5;
  if (sh < 0.5) return sdRBox(P, vec2(hx, 0.5), 0.05);                                            // 터미널 창
  if (sh < 1.5) { float b = sdRBox(P, vec2(hx, 0.5), 0.02); float cut = (P.x + P.y - (hx + 0.5 - 0.2)) * 0.7071; return max(b, cut); } // 귀퉁이 접힌 문서
  if (sh < 2.5) { float b = sdRBox(P - vec2(0.0, -0.055), vec2(hx, 0.445), 0.03); float tab = sdRBox(P - vec2(-hx + 0.2, 0.44), vec2(0.2, 0.065), 0.025); return min(b, tab); } // 파일 탭 코드 창
  if (sh < 3.5) { float b = sdRBox(P - vec2(0.07, 0.0), vec2(hx - 0.07, 0.5), 0.04); float lens = length(P - vec2(-hx + 0.15, 0.35)) - 0.15; return min(b, lens); } // 왼쪽 위 렌즈 + 목록
  if (sh < 4.5) return length(P) - 0.5;                                                              // (예전) 원판
  if (sh < 5.5) return sdHex(P.yx, 0.46);                                                            // (예전) 육각
  if (sh < 6.5) { float b = sdRBox(P - vec2(0.0, -0.11), vec2(hx, 0.39), 0.05); float h = max(abs(length(P - vec2(0.0, 0.28)) - 0.17) - 0.045, 0.28 - P.y); return min(b, h); } // 손잡이 상자
  if (sh < 7.5) { float b = sdRBox(P - vec2(0.0, -0.25), vec2(0.5, 0.25), 0.03); float c = max(length(P - vec2(0.0, -0.02)) - 0.5, -P.y - 0.02); return min(b, c); } // (예전) 반원 계기
  if (sh < 8.5) { float b = sdRBox(P, vec2(hx, 0.5), 0.07); float notch = 0.07 - length(P - vec2(0.0, 0.5)); return max(b, notch); }   // 홈 파인 카드
  if (sh < 9.5) { float b = sdRBox(P - vec2(-0.07, 0.0), vec2(hx - 0.07, 0.5), 0.1); float globe = length(P - vec2(hx - 0.15, 0.35)) - 0.15; return min(b, globe); } // 오른쪽 위 지구 배지 창
  if (sh < 10.5) { float b = sdBox(P, vec2(hx, 0.5)); float cut = (abs(P.x) + abs(P.y) * 0.6 - (hx + 0.1)) * 0.857; return max(b, cut); }   // 양옆이 뾰족한 육각 창
  if (sh < 11.5) { float b = sdRBox(P - vec2(0.0, -0.1), vec2(hx, 0.4), 0.05); float dome = max(length(P - vec2(0.0, 0.1)) - 0.4, 0.1 - P.y); return min(b, dome); } // 반원 계기 머리 창
  { float b = sdRBox(P - vec2(0.0, 0.07), vec2(hx, 0.43), 0.12); float tail = sdTri(P, vec2(-0.13, -0.33), vec2(0.09, -0.33), vec2(-0.05, -0.5)); return min(b, tail); } // 말풍선(아래 꼬리 → 노드)
}
// 실루엣별 머리 띠 아래 끝(holo-core shapeLayout.hd 와 같은 값)
float headY(float sh) { return sh > 1.5 && sh < 2.5 ? 0.76 : sh > 5.5 && sh < 6.5 ? 0.66 : 0.8; }
// 실루엣별 글리프 자리: xy = 왼쪽 아래(uv), z = 크기(높이 단위) — shapeLayout.glyph 와 같은 값
vec3 glyphAt(float sh) {
  if (sh > 0.5 && sh < 1.5) return vec3(0.03, 0.825, 0.15);
  if (sh > 1.5 && sh < 2.5) return vec3(0.02, 0.77, 0.12);
  if (sh > 2.5 && sh < 3.5) return vec3(0.065 / ASP, 0.765, 0.17);
  if (sh > 5.5 && sh < 6.5) return vec3(0.02, 0.665, 0.11);
  if (sh > 7.5 && sh < 8.5) return vec3(0.03, 0.815, 0.11);
  if (sh > 8.5 && sh < 9.5) return vec3(1.0 - 0.235 / ASP, 0.765, 0.17);
  if (sh > 9.5 && sh < 10.5) return vec3(0.15 / ASP, 0.825, 0.15);
  if (sh > 10.5 && sh < 11.5) return vec3(0.5 - 0.08 / ASP, 0.82, 0.16);
  if (sh > 11.5) return vec3(0.04, 0.825, 0.15);
  return vec3(0.02, 0.825, 0.15);
}
float h1(float n) { return fract(sin(n * 12.9898 + hs * 78.233) * 43758.5453); }
float box(vec2 p, vec2 a, vec2 b) { vec2 s = step(a, p) * step(p, b); return s.x * s.y; }
float glyph(vec2 p, float idx) {
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) return 0.0;
  float c = mod(idx, 8.0), r = floor(idx / 8.0);
  return texture2D(uAtlas, vec2((c + p.x) / 8.0, 1.0 - (r + 1.0 - p.y) / 2.0)).a;
}
void main() {
  hs = vA.y;
  float flash = vA.z, alpha = vA.w, lod = vB.x, gi = vB.y;
  if (alpha < 0.003) discard;
  ASP = vC.y;
  float shp = vC.x;
  bool hasText = vC.w > 0.5;   // 이 패널에 실제 글이 겹쳐 그려짐(holo-text.js)
  float sd = shapeSD((vUv - 0.5) * vec2(ASP, 1.0), shp);
  if (sd > 0.004) discard;
  float edgeA = smoothstep(0.004, -0.006, sd);
  bool roundish = shp > 3.5 && shp < 5.5 || (shp > 6.5 && shp < 7.5); // 예전 원판·육각·반원: 머리 띠 없음
  float T = uTime + hs * 17.0;
  vec2 uv = vUv;
  // 가끔 가로로 어긋나는 신호 튐(글이 있으면 약하게 — 읽기 방해 안 되게)
  float glt = step(0.975, h1(floor(T * 7.0)));
  uv.x += glt * (h1(floor(uv.y * 18.0) + floor(T * 40.0)) - 0.5) * (hasText ? 0.01 : 0.05);
  float ex = min(uv.x, 1.0 - uv.x) * ASP, ey = min(uv.y, 1.0 - uv.y), e = -sd;   // e = 실루엣 가장자리까지 거리
  bool light = uLight > 0.5;
  vec3 C = vColor;
  vec3 ink = light ? C * 0.78 : mix(C, vec3(1.0), 0.45);
  vec3 col = light ? mix(C, vec3(1.0), 0.86) : mix(C, vec3(0.02, 0.035, 0.08), 0.74);   // 유리: 밝은 배경엔 옅은 색 유리, 어두운 배경엔 어두운 유리
  float al = light ? (hasText ? 0.82 : 0.72) : (hasText ? 0.74 : 0.52);   // 글이 있으면 유리를 조금 더 진하게(가독성)
  float hd = roundish ? 0.92 : headY(shp);
  vec3 gp = glyphAt(shp);
  if (!roundish && uv.y > hd) {  // 머리 띠: 글리프 · 창 단추 셋(제목 글은 holo-text 가 그림)
    col = mix(col, C, light ? 0.16 : 0.22); al += 0.1;
    float g = glyph(vec2((uv.x - gp.x) / (gp.z / ASP), (uv.y - gp.y) / gp.z), gi);
    float dots = 0.0;
    bool hasDots = shp < 0.5 || (shp > 1.5 && shp < 3.5) || (shp > 5.5 && shp < 6.5) || (shp > 7.5 && shp < 8.5);
    if (hasDots) for (int i = 0; i < 3; i++) dots = max(dots, smoothstep(0.024, 0.012, length((uv - vec2(0.935 - float(i) * 0.05, hd + (shp > 1.5 && shp < 2.5 ? 0.065 : shp > 5.5 && shp < 6.5 ? 0.06 : shp > 7.5 && shp < 8.5 ? 0.065 : 0.1))) * vec2(ASP, 1.0))));
    float k = max(g, dots * 0.8);
    col = mix(col, ink, k); al = max(al, k * 0.95);
  }
  float dv = roundish ? 0.0 : smoothstep(0.008, 0.0, abs(uv.y - hd)) * box(uv, vec2(0.02, 0.0), vec2(0.98, 1.0));
  col = mix(col, ink, dv * 0.7); al = max(al, dv * 0.7);
  vec2 p = vec2((uv.x - 0.04) / 0.92, (uv.y - 0.05) / (hd - 0.09));   // 내용 칸 0..1
  if (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) {
    // 내용은 실제 글(holo-text.js)이 맡는다 — 가짜 줄·무늬는 그리지 않음(§52).
    // 멀리(LOD 1)는 큰 글리프 하나, 가까이인데 글 칸을 못 받은 패널은 옅은 글리프 물 무늬만
    vec2 q = vec2((p.x - 0.5) * ASP * 0.92 / (hd - 0.09), p.y - 0.5);   // 정사각 비율, 가운데 원점
    float k = 0.0;
    if (lod < 1.5) k = glyph(vec2(q.x / 0.86 + 0.5, q.y / 0.86 + 0.5), gi);
    else if (!hasText) k = glyph(vec2(q.x / 0.7 + 0.5, q.y / 0.7 + 0.5), gi) * 0.16;
    col = mix(col, ink, clamp(k, 0.0, 1.0) * 0.95); al = max(al, clamp(k, 0.0, 1.0) * 0.92);
  }
  // 다음 도구가 이어받음(§38.9): 밝은 띠가 위→아래로 갈리며 내용이 바뀐다
  float swp = vC.z;
  // 접힘(§46): 줄로 눌린 패널이 스캔라인처럼 밝게 닫힌다
  float fold = vB.z;
  if (fold > 0.0) { col = mix(col, light ? ink : mix(ink, vec3(1.0), 0.45), fold * 0.8); al = max(al, fold * 0.92); }
  if (swp > 0.0) { float bar = smoothstep(0.06, 0.0, abs(vUv.y - swp)); col = mix(col, ink, bar * 0.9); al = max(al, bar * 0.9); col *= 1.0 - 0.25 * step(swp, vUv.y) * swp; }
  // 스캔라인 · 위에서 아래로 지나가는 밝은 띠
  // 라이트: 옅은 유리 위 진한 줄무늬가 글을 가려 약하게(다크는 그대로)
  col *= light ? 0.965 + 0.035 * sin(vUv.y * 230.0) : 0.86 + 0.14 * sin(vUv.y * 230.0);
  float sw = smoothstep(0.06, 0.0, abs(fract(vUv.y * 0.7 - T * 0.32) - 0.5));
  col = mix(col, ink, sw * (hasText ? 0.08 : 0.18)); al += sw * 0.05;
  // 가장자리 발광 · 모서리 꺾쇠
  vec3 rimC = mix(ink, light ? vFlash * 0.85 : mix(vFlash, vec3(1.0), 0.2), flash);
  float rim = smoothstep(0.028, 0.008, e);
  float corner = (1.0 - smoothstep(0.1, 0.13, ex)) * (1.0 - smoothstep(0.1, 0.13, ey)) * smoothstep(0.05, 0.03, e);
  float halo = smoothstep(0.07, 0.0, e) * (light ? 0.25 : 0.4);
  col = mix(col, rimC, max(rim, corner)); al = max(al, max(rim, corner) * 0.95) + halo * 0.15;
  col += (light ? vec3(0.0) : C * halo * 0.4);
  // 결과 섬광: 화면 전체가 결과색으로(글이 있으면 덜 — 글이 묻히지 않게)
  col = mix(col, light ? vFlash : mix(vFlash, vec3(1.0), 0.25), flash * (hasText ? 0.35 : 0.6)); al = mix(al, max(al, 0.86), flash);
  float fl = (0.93 + 0.07 * sin(T * 31.0) * sin(T * 4.3)) * (1.0 - glt * 0.2);
  gl_FragColor = vec4(col, clamp(al, 0.0, 1.0) * alpha * fl * edgeA);
}`;

// ---- 글리프 아틀라스: 8×2 칸(칸 128px), 흰 선 — 셰이더가 종류 색으로 물들인다. 처음 한 번만 그린다 ----
function buildAtlas() {
  const S = 128, cv = document.createElement('canvas');
  cv.width = S * 8; cv.height = S * 2;
  const x = cv.getContext('2d');
  x.strokeStyle = x.fillStyle = '#fff'; x.lineWidth = 9; x.lineCap = x.lineJoin = 'round';
  const at = (i, fn) => { x.save(); x.translate((i % 8) * S, Math.floor(i / 8) * S); x.beginPath(); fn(); x.restore(); };
  at(0, () => { x.moveTo(22, 34); x.lineTo(56, 64); x.lineTo(22, 94); x.moveTo(64, 96); x.lineTo(104, 96); x.stroke(); });                         // >_
  at(1, () => { x.moveTo(30, 14); x.lineTo(78, 14); x.lineTo(100, 36); x.lineTo(100, 114); x.lineTo(30, 114); x.closePath(); x.moveTo(78, 14); x.lineTo(78, 36); x.lineTo(100, 36);
    x.moveTo(44, 58); x.lineTo(86, 58); x.moveTo(44, 76); x.lineTo(86, 76); x.moveTo(44, 94); x.lineTo(72, 94); x.stroke(); });                       // 문서
  at(2, () => { x.moveTo(22, 106); x.lineTo(30, 80); x.lineTo(88, 22); x.lineTo(106, 40); x.lineTo(48, 98); x.closePath(); x.moveTo(76, 34); x.lineTo(94, 52); x.stroke(); }); // 펜
  at(3, () => { x.arc(54, 54, 30, 0, Math.PI * 2); x.moveTo(76, 76); x.lineTo(108, 108); x.stroke(); });                                         // 돋보기
  at(4, () => { x.arc(64, 64, 44, 0, Math.PI * 2); x.moveTo(20, 64); x.lineTo(108, 64); x.moveTo(64, 20); x.ellipse(64, 64, 18, 44, 0, -Math.PI / 2, Math.PI * 1.5); x.stroke(); }); // 지구
  at(5, () => { for (let k = 0; k < 3; k++) { x.moveTo(64 + 46 - k * 15, 64); x.ellipse(64, 64, 46 - k * 15, (46 - k * 15) * 0.8, k * 0.6, 0, Math.PI * 1.6); } x.stroke(); x.beginPath(); x.arc(64, 64, 6, 0, Math.PI * 2); x.fill(); }); // 포털
  at(6, () => { for (let i = 0; i <= 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3, px = 64 + 44 * Math.cos(a), py = 64 + 44 * Math.sin(a); if (i) x.lineTo(px, py); else x.moveTo(px, py); } x.moveTo(64, 40); x.lineTo(84, 76); x.lineTo(44, 76); x.closePath(); x.stroke(); }); // 육각
  at(7, () => { x.rect(16, 48, 96, 58); x.moveTo(46, 48); x.lineTo(46, 30); x.lineTo(82, 30); x.lineTo(82, 48); x.moveTo(16, 70); x.lineTo(112, 70); x.stroke(); x.fillRect(56, 62, 16, 18); }); // 도구상자
  at(8, () => { x.arc(64, 84, 46, Math.PI, 0); x.moveTo(64, 84); x.lineTo(92, 50); x.moveTo(24, 84); x.lineTo(104, 84); x.stroke(); });           // 계기
  at(9, () => { x.rect(38, 44, 52, 40); x.moveTo(50, 44); x.lineTo(50, 18); x.moveTo(78, 44); x.lineTo(78, 18); x.moveTo(64, 84); x.lineTo(64, 112); x.stroke(); }); // 플러그
  at(10, () => { x.rect(26, 18, 76, 92); x.moveTo(40, 40); x.lineTo(88, 40); x.moveTo(40, 60); x.lineTo(88, 60); x.moveTo(40, 80); x.lineTo(70, 80); x.stroke(); }); // 카드
  at(11, () => { x.moveTo(30, 90); x.quadraticCurveTo(40, 80, 40, 56); x.quadraticCurveTo(40, 24, 64, 24); x.quadraticCurveTo(88, 24, 88, 56); x.quadraticCurveTo(88, 80, 98, 90); x.closePath(); x.moveTo(56, 104); x.lineTo(72, 104); x.stroke(); }); // 종
  at(12, () => { for (const cx of [34, 64, 94]) { x.moveTo(cx + 10, 64); x.arc(cx, 64, 10, 0, Math.PI * 2); } x.fill(); });                           // 점 셋
  at(13, () => { x.moveTo(30, 22); x.lineTo(98, 22); x.quadraticCurveTo(112, 22, 112, 36); x.lineTo(112, 76); x.quadraticCurveTo(112, 90, 98, 90); x.lineTo(56, 90);
    x.lineTo(34, 110); x.lineTo(38, 90); x.lineTo(30, 90); x.quadraticCurveTo(16, 90, 16, 76); x.lineTo(16, 36); x.quadraticCurveTo(16, 22, 30, 22); x.stroke();
    x.beginPath(); for (const cx of [42, 64, 86]) { x.moveTo(cx + 6, 56); x.arc(cx, 56, 6, 0, Math.PI * 2); } x.fill(); });                           // 말풍선
  const tx = new THREE.CanvasTexture(cv);
  tx.minFilter = THREE.LinearMipmapLinearFilter; tx.magFilter = THREE.LinearFilter; tx.generateMipmaps = true;
  return tx;
}

let cssDone = false;
function ensureCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./holo.css', import.meta.url).href;
  document.head.appendChild(l);
}

const TETHER_CAP = 256;

export class HoloLayer {
  /**
   * @param scene THREE.Scene
   * @param view  SceneView (vis·tokens·children·focusId·hoverId 를 읽기만)
   */
  constructor(scene, view) {
    ensureCss();
    this.view = view;
    this.scene = scene;
    this.book = new HoloBook();
    this.enabled = true;
    const cap = this.cap = HOLO.MAX;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aFlash = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage); // shape, asp, swap, -
    geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iFlash', this.aFlash);
    geo.setAttribute('iA', this.aA);
    geo.setAttribute('iB', this.aB);
    geo.setAttribute('iC', this.aC);
    this.atlas = buildAtlas();
    this.uniforms = { uTime: { value: 0 }, uLight: { value: 0 }, uAtlas: { value: this.atlas } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    // 에이전트 포털 → 작업 중 하위 노드로 가는 빛줄(두 점, 끝으로 갈수록 옅게)
    this.tPos = new Float32Array(TETHER_CAP * 6);
    this.tCol = new Float32Array(TETHER_CAP * 6);
    this.tGeo = new THREE.BufferGeometry();
    this.tGeo.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tGeo.setAttribute('color', new THREE.BufferAttribute(this.tCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false });
    this.tether = new THREE.LineSegments(this.tGeo, this.tMat);
    this.tether.frustumCulled = false;
    this.tether.renderOrder = 4;
    scene.add(this.mesh, this.tether);
    // 패널 안 실제 글
    this.text = new HoloText(scene);
    this._tc = []; // 글 후보(객체 재사용)
    // 라벨 풀
    this.labels = [];
    for (let i = 0; i < HOLO.MAX_LABELS; i++) {
      const el = document.createElement('div');
      el.className = 'holo-label';
      const b = document.createElement('b'), s = document.createElement('span'), r = document.createElement('em');
      el.append(b, s, r);
      const o = new CSS2DObject(el);
      o.center.set(0.5, 0.5);
      o.visible = false;
      scene.add(o);
      this.labels.push({ o, el, b, s, r, key: null, cls: '' });
    }
    this.overflow = new Map(); // nodeId → CSS2DObject(+N)
    this._kidCache = new Map();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._c = new THREE.Color();
    this._catCache = new Map();
    this._seenOv = new Set();
    this._cand = [];
    this._top = new Set(); this._topAt = -1; this._topList = [];
    this.stats = { drawn: 0, lod: [0, 0, 0], labels: 0, text: 0 };
    this.applyTheme(view.tokens);
  }

  applyTheme(t) {
    this.tokens = t;
    this.uniforms.uLight.value = t.isLight ? 1 : 0;
    if (this.text) this.text.setLight(!!t.isLight);
    this._inkCache = new Map();
    this.tMat.blending = t.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.tMat.needsUpdate = true;
    this._catCache.clear();
  }

  _catCol(cat) {
    if (cat === 'skill') return this.tokens.skill;
    if (cat === 'say') return this.tokens.text; // 말 패널은 글자색(무채색 유리)
    let c = this._catCache.get(cat);
    if (!c) { c = new THREE.Color(catColor(cat, this.tokens.isLight)); this._catCache.set(cat, c); }
    return c;
  }
  /** 글 머리줄·명령 줄 색(CSS): 셰이더 ink 와 같은 식 — 다크는 종류 색을 흰색 쪽으로, 라이트는 어둡게 */
  _ink(cat) {
    let s = this._inkCache.get(cat);
    if (!s) {
      const c = this._c.copy(this._catCol(cat));
      if (this.tokens.isLight) c.multiplyScalar(0.62); else c.lerp(new THREE.Color(1, 1, 1), 0.5);
      s = '#' + c.getHexString(); this._inkCache.set(cat, s);
    }
    return s;
  }
  _resCol(res) { const t = this.tokens; return res === 'error' ? t.error : res === 'stopped' ? t.stopped : t.ok; }

  // ---- 장부 조작(SceneView 가 부른다) ----
  start(nodeId, ev, { quiet = false, speed = 1 } = {}) {
    const now = performance.now() / 1000;
    return this.book.start(nodeId, ev, now, { quiet, minShow: HOLO.MIN_SHOW / Math.min(4, Math.max(1, Math.sqrt(speed || 1))) });
  }
  end(nodeId, toolUseId, res, result = '') { return this.book.end(nodeId, toolUseId, res, performance.now() / 1000, result); }
  endAll(nodeId, res) { this.book.endAll(nodeId, res, performance.now() / 1000); }
  openCount(nodeId) { return this.book.openCount(nodeId); }
  /** 노드에 열린(끝나지 않은) 도구 cat 목록 — 라벨 우선순위용 */
  hasOpenCat(nodeId, cat) { return this.book.list(nodeId).some((e) => e.endAt == null && e.cat === cat); }
  /** 이벤트의 패널 내용(panel·parentPanel)을 장부에 반영 — app.onEvent 가 라이브·재생·mock 공통으로 부른다(quiet 포함) */
  event(ev, { quiet = false } = {}) { return this.book.panelEvent(ev, performance.now() / 1000, { quiet }); }
  /** 노드가 물러남: 패널을 지금 노드 쪽으로 접어 넣는다(지우는 것은 removeNode) */
  foldNode(nodeId) { this.book.foldNode(nodeId, performance.now() / 1000); }
  removeNode(nodeId) {
    this.book.removeNode(nodeId);
    const o = this.overflow.get(nodeId);
    if (o) { o.removeFromParent(); o.element.remove(); this.overflow.delete(nodeId); }
    this._kidCache.delete(nodeId);
  }
  clear() {
    this.book.clear();
    for (const o of this.overflow.values()) { o.removeFromParent(); o.element.remove(); }
    this.overflow.clear();
    this._kidCache.clear();
    this.mesh.count = 0;
    for (const L of this.labels) { L.o.visible = false; L.key = null; }
    if (this.text) this.text.clear();
  }

  /** 에이전트 포털이 가리킬 하위(가장 최근 작업 중 자식, 0.5초마다 갱신) */
  _kidFor(nodeId, now) {
    let c = this._kidCache.get(nodeId);
    if (c && now - c.t < 0.5) return c.id ? this.view.vis.get(c.id) : null;
    const kids = this.view.children(nodeId);
    let id = null;
    for (let i = kids.length - 1; i >= 0; i--) { const cv = this.view.vis.get(kids[i]); if (cv && !cv.hidden && cv.node.status === 'active') { id = cv.id; break; } }
    this._kidCache.set(nodeId, c = { t: now, id });
    return id ? this.view.vis.get(id) : null;
  }

  /** 최근 활동 상위 노드(TOP_ACTIVE개, 0.25초마다): 거리 무관 최소 크기·라벨 */
  _topActive(now) {
    if (now - this._topAt < 0.25) return this._top;
    this._topAt = now;
    const L = this._topList; L.length = 0;
    for (const [nid, arr] of this.book.byNode) {
      let t = -Infinity; // 스냅샷(quiet) 항목은 t0 가 음수일 수 있다
      for (const e of arr) { if (e.slot < 0) continue; t = Math.max(t, e.t0, e.endAt ?? -Infinity, e.swapAt ?? -Infinity); }
      if (t > -Infinity) L.push([t, nid]);
    }
    L.sort((a, b) => b[0] - a[0]);
    this._top.clear();
    for (let i = 0; i < Math.min(HOLO.TOP_ACTIVE, L.length); i++) this._top.add(L[i][1]);
    return this._top;
  }

  /** 매 프레임: 장부 정리 → 보이는 패널을 인스턴스 버퍼에 채움 → 라벨·+N·포털 빛줄 */
  update(now, camera, viewportH) {
    const view = this.view, book = this.book;
    const changed = book.step(now, (id) => { const v = view.vis.get(id); return !!v && v.node.status === 'active'; });
    if (!this.enabled) { // 시험·비교용 끄기: 장부는 계속 돌고 그리기만 멈춤
      this.mesh.count = 0; this.tether.visible = false; this._labelPass([]); this.text.update(this._tc, 0, now);
      for (const ov of this.overflow.values()) { ov.removeFromParent(); ov.element.remove(); }
      this.overflow.clear(); return;
    }
    if (changed.size && view._holoChanged) for (const id of changed) view._holoChanged(id);
    this.uniforms.uTime.value = now % 1000;
    const me = camera.matrixWorld.elements;
    const right = this._r.set(me[0], me[1], me[2]).normalize();
    const up = this._u.set(me[4], me[5], me[6]).normalize();
    const cp = camera.position;
    const fov = camera.fov;
    const col = this.aColor.array, fla = this.aFlash.array, A = this.aA.array, B = this.aB.array, Cc = this.aC.array;
    const px2w = (d) => (2 * d * Math.tan((fov * Math.PI) / 360)) / Math.max(1, viewportH); // 화면 px → 세계 거리
    const cand = this._cand; cand.length = 0;
    const lodN = this.stats.lod; lodN[0] = lodN[1] = lodN[2] = 0;
    let n = 0, nt = 0, ntc = 0, nr = 0;
    const tc = this._tc;
    const rw = this._rw || (this._rw = []); // 라벨 배치가 피할 패널 자리(세계 중심·크기)
    const seenOv = this._seenOv; seenOv.clear();
    const top = this._topActive(now);
    const shot = view.camShotId || null; // 자동 카메라가 지금 비추는 노드
    for (const [nid, arr] of book.byNode) {
      const v = view.vis.get(nid);
      if (!v || v.hidden || v.gone || (v.scopeD ?? v.scopeK ?? 1) < 0.5) continue; // 페이드 중엔 흐리게 남김(fade 가 scopeK 를 곱함)
      const focused = nid === view.focusId || nid === view.hoverId;
      const isShot = nid === shot;
      const isTop = top.has(nid);
      // 세계 크기(에서 키움) · 포커스 1.3배 · 카메라 대상 1.5배
      let H = (1.25 + 0.3 * v.r) * (isShot ? 1.5 : focused ? 1.3 : 1);
      const o = v.group.position;
      let px = panelPx(H, o.distanceTo(cp), fov, viewportH);
      // 상위 활동·포커스·카메라 대상은 멀어도 최소 화면 크기(글리프+짧은 라벨이 읽히게)
      const vip = focused || isShot || isTop;
      if (vip && px < HOLO.MIN_PX_ACTIVE && px > 0) { const k = Math.min(HOLO.BOOST_MAX, HOLO.MIN_PX_ACTIVE / px); H *= k; px = k < HOLO.BOOST_MAX ? HOLO.MIN_PX_ACTIVE : px * k; } // 정확히 문턱 값으로(부동소수 오차로 LOD 1⇄2 가 프레임마다 깜빡이던 것 수리)
      const W = H * HOLO.ASPECT;
      const lod = holoLod(px, focused || isShot);
      lodN[lod]++;
      if (!lod) continue;
      const rr = view.holoR ? view.holoR(v) : v.r * v.size; // Planet: 궤도계 바깥 반지름
      const R = rr + W * 0.56 + 0.25; // +N 표시 자리
      const pw = px2w(o.distanceTo(cp));
      v._holoPx = px; // 말풍선 자리 계산용(패널 높이 px)
      const fade = (v.exitF ?? 1) * Math.min(1, (v.scopeK ?? 1) * 1.4);
      for (const e of arr) {
        if (e.slot < 0 || n >= this.cap) continue;
        const ph = book.phaseOf(e, now);
        if (ph.phase === 'gone') continue;
        // 종류별 방향: shell 오른쪽 · read 왼쪽 위 · edit/write 왼쪽 · search 위 · web 오른쪽 위 · agent 아래 · skill 왼쪽 아래 · 그 밖 오른쪽 아래
        const d = holoDir(e.dir);
        const He = e.shape === 1 ? H * 1.12 : H, We = He * (e.asp || HOLO.ASPECT);
        // 그 방향에 노드 라벨이 있으면 더 띄움: Flow 는 라벨이 아래, Planet 은 위
        // 라벨 높이는 SceneView 라벨 패스가 재 둔 값(포커스면 이력까지 커짐)
        const labH = v.labelOn ? (v._labelH || 34) : 0;
        const labelPush = (view.labelBelow ? d.y < -0.5 : d.y > 0.5) ? (labH + (view.labelBelow ? 14 : 6)) * pw : 0;
        const dist = holoOffset(d, rr, We, He, e.slot, labelPush);
        // 펼칠 때 노드에서 그 방향으로 미끄러져 나온다(이어받기는 제자리)
        const tOpen = now - e.t0;
        // 접힐 때는 그 역순: 자기 방향 자리에서 노드 쪽으로 미끄러져 들어가며 닫힘
        const slide = ph.phase === 'fold' ? foldSlide(ph.fk) : e.swapAt == null && tOpen < HOLO.OPEN * 1.3 ? 1 - Math.pow(1 - Math.min(1, tOpen / (HOLO.OPEN * 1.3)), 3) : 1;
        const L = rr + (dist - rr) * slide;
        const bob = 0.06 * Math.sin(now * 1.3 + e.seed * 6.28);
        const ox = d.x * L, oy = d.y * L + bob;
        const p = this._p.set(o.x + right.x * ox + up.x * oy, o.y + right.y * ox + up.y * oy, o.z + right.z * ox + up.z * oy);
        this._s.set(We * ph.sx, He * ph.sy, 1);
        this._m.compose(p, this._q, this._s);
        this.mesh.setMatrixAt(n, this._m);
        const c = this._catCol(e.cat), f = this._resCol(e.res);
        col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b;
        fla[n * 3] = f.r; fla[n * 3 + 1] = f.g; fla[n * 3 + 2] = f.b;
        A[n * 4] = e.mode; A[n * 4 + 1] = e.seed; A[n * 4 + 2] = ph.flash; A[n * 4 + 3] = ph.alpha * fade;
        const swp = e.swapAt != null ? (now - e.swapAt) / HOLO.SWAP : 1;
        B[n * 4] = lod; B[n * 4 + 1] = e.glyph; B[n * 4 + 2] = ph.phase === 'fold' ? foldLine(ph.fk) : 0; B[n * 4 + 3] = now - e.t0;
        Cc[n * 4] = e.shape ?? 0; Cc[n * 4 + 1] = e.asp || HOLO.ASPECT; Cc[n * 4 + 2] = swp < 1 ? 1 - swp : 0; Cc[n * 4 + 3] = 0;
        // 패널 안 실제 글: 무늬 단계이고 머리줄이 읽힐 크기면 후보(점수 높은 TEXT_MAX 개가 글 칸을 받음)
        const epx = px * (He / H);
        // 글을 이미 받은 패널은 문턱을 낮춰 둠(최소 크기로 키운 상위 노드 패널이 정확히 문턱에 걸려 프레임마다 들락날락하지 않게)
        const minPx = e._txf === this.text.frame ? PANEL.TITLE_PX * 0.85 : PANEL.TITLE_PX - 0.5;
        if (lod === 2 && epx >= minPx && ph.phase !== 'fold' && ph.sy > 0.5) {
          const c0 = tc[ntc] || (tc[ntc] = { e: null, x: 0, y: 0, z: 0, W: 0, H: 0, px: 0, alpha: 0, swap: 0, score: 0, ink: '', slot: null, inst: 0 });
          c0.e = e; c0.x = p.x; c0.y = p.y; c0.z = p.z; c0.W = We * ph.sx; c0.H = He * ph.sy; c0.px = epx; c0.inst = n;
          const sy = Math.min(1, (ph.sy - 0.5) / 0.4);
          c0.alpha = ph.alpha * fade * sy * sy; c0.swap = swp < 1 ? 1 - swp : 0;
          c0.score = (focused ? 1e6 : 0) + (isShot ? 5e5 : 0) + (isTop ? 1e5 : 0) + epx + (e.endAt == null ? 50 : 0) + (e.panel ? 25 : 0);
          c0.ink = this._ink(e.cat);
          ntc++;
        }
        n++;
        if (ph.sy > 0.3 && ph.alpha * fade > 0.15) {
          const q = rw[nr] || (rw[nr] = { x: 0, y: 0, z: 0, w: 0, h: 0, id: null });
          q.x = p.x; q.y = p.y; q.z = p.z; q.w = We * ph.sx; q.h = He * ph.sy; q.id = nid;
          // 작은 패널의 짧은 라벨(패널 바로 아래, 아래 cand 와 같은 조건)도 장애물에 넣는다
          q.mini = ph.phase !== 'fold' && ph.sy > 0.6 && vip && px < HOLO.LABEL_PX && view.holoMiniLabels !== false;
          nr++;
        }
        // 흐름 표현은 노드 라벨에 작업 줄이 늘 있으므로 작은(mini) 패널 라벨은 생략(view.holoMiniLabels=false)
        if (ph.phase !== 'fold' && ph.sy > 0.6 && (vip || (lod === 2 && px >= HOLO.LABEL_PX)) && (px >= HOLO.LABEL_PX || view.holoMiniLabels !== false)) {
          // 큰 패널: 글을 패널 안(내용 칸 아래쪽)에. 작은 패널(먼 전체 보기의 상위 노드): 패널 바로 아래에 짧게
          const inside = px >= HOLO.LABEL_PX;
          const dy = inside ? He * ph.sy * (e.shape === 4 || e.shape === 5 ? 0.05 : 0.2) : He * ph.sy * 0.5 + 0.02 * He;
          const score = (focused ? 1e6 : 0) + (isShot ? 5e5 : 0) + (isTop ? 1e5 : 0) + px + (e.endAt == null ? 50 : 0);
          cand.push({ e, x: p.x - up.x * dy, y: p.y - up.y * dy, z: p.z - up.z * dy, wpx: px * (e.asp || HOLO.ASPECT) * ph.sx * 0.9, score, phase: ph.phase, fade, inside });
        }
        // 흐름 표현: 노드 → 도구 패널을 잇는 도구 빔(agent-flow 의 tool edge)
        // 도구 빔: Flow 는 늘, Planet 은 펼치거나 이어받는 순간(0.8초)만 — 노드에서 그 방향으로 뻗는 느낌
        const fresh = now - (e.swapAt ?? e.t0) < 0.8;
        // Planet: 궤도 위성이 패널을 투사 — 궤도 둘레 한 점 → 패널의 노드 쪽 모서리 두 끝(투사 원뿔), 열려 있는 동안
        if (view.holoBeam && ph.phase !== 'fold' && nt + 2 <= TETHER_CAP && view.holoFrom && view.holoFrom(v, e.slot, this._bo || (this._bo = new THREE.Vector3()), p)) {
          const bo = this._bo, bg = this.tokens.bg;
          const hw = (We * ph.sx) / 2, hh = (He * ph.sy) / 2;
          const horiz = Math.abs(d.y) > Math.abs(d.x) * 0.8;
          const sx = horiz ? 0 : -Math.sign(d.x || 1), sy = horiz ? -Math.sign(d.y || 1) : 0;
          const kb = (e.endAt == null ? 0.34 : 0.16) * fade * ph.alpha * Math.min(1, ph.sy * 1.5);
          for (let j = 0; j < 2; j++) {
            const t = j ? 1 : -1;
            const ex = horiz ? t * hw : sx * hw, ey = horiz ? sy * hh : t * hh;
            const q = nt * 6;
            this.tPos[q] = bo.x; this.tPos[q + 1] = bo.y; this.tPos[q + 2] = bo.z;
            this.tPos[q + 3] = p.x + right.x * ex + up.x * ey; this.tPos[q + 4] = p.y + right.y * ex + up.y * ey; this.tPos[q + 5] = p.z + right.z * ex + up.z * ey;
            const kk = kb;
            const c0 = this._c.copy(c).lerp(bg, 1 - kk);
            this.tCol[q] = c0.r; this.tCol[q + 1] = c0.g; this.tCol[q + 2] = c0.b;
            c0.copy(c).lerp(bg, 1 - kk * 0.35);
            this.tCol[q + 3] = c0.r; this.tCol[q + 4] = c0.g; this.tCol[q + 5] = c0.b;
            nt++;
          }
        } else if ((view.holoToolTethers || fresh) && ph.phase !== 'fold' && nt < TETHER_CAP) {
          const q = nt * 6, bg = this.tokens.bg;
          this.tPos[q] = o.x; this.tPos[q + 1] = o.y; this.tPos[q + 2] = o.z; this.tPos[q + 3] = p.x; this.tPos[q + 4] = p.y; this.tPos[q + 5] = p.z;
          const k = (e.endAt == null ? 0.75 : 0.35) * fade * ph.alpha * (view.holoToolTethers ? 1 : Math.max(0, 1 - (now - (e.swapAt ?? e.t0)) / 0.8));
          const c0 = this._c.copy(c).lerp(bg, 1 - k * 0.6);
          this.tCol[q] = c0.r; this.tCol[q + 1] = c0.g; this.tCol[q + 2] = c0.b;
          c0.copy(c).lerp(bg, 1 - k);
          this.tCol[q + 3] = c0.r; this.tCol[q + 4] = c0.g; this.tCol[q + 5] = c0.b;
          nt++;
        }
        // 에이전트 포털: 작업 중 하위 노드로 빛줄(흐름의 호출 패킷은 생성 순간 한 번, 이건 도구가 열려 있는 동안)
        if (e.cat === 'agent' && lod === 2 && ph.phase === 'hold' && nt < TETHER_CAP) {
          const kv = this._kidFor(nid, now);
          if (kv) {
            const q = nt * 6, b = kv.group.position;
            const pulse = 0.6 + 0.4 * Math.sin(now * 5 + e.seed * 6);
            this.tPos[q] = p.x; this.tPos[q + 1] = p.y; this.tPos[q + 2] = p.z; this.tPos[q + 3] = b.x; this.tPos[q + 4] = b.y; this.tPos[q + 5] = b.z;
            const bg = this.tokens.bg;
            const c0 = this._c.copy(c).lerp(bg, 1 - pulse * fade);
            this.tCol[q] = c0.r; this.tCol[q + 1] = c0.g; this.tCol[q + 2] = c0.b;
            c0.copy(c).lerp(bg, 0.85);
            this.tCol[q + 3] = c0.r; this.tCol[q + 4] = c0.g; this.tCol[q + 5] = c0.b;
            nt++;
          }
        }
      }
      // 자리를 못 받은 도구: +N
      const qn = book.queued(nid);
      if (qn > 0) {
        seenOv.add(nid);
        let ov = this.overflow.get(nid);
        if (!ov) {
          const el = document.createElement('div'); el.className = 'overflow-label holo-more';
          ov = new CSS2DObject(el); ov.center.set(0.5, 0.5); this.scene.add(ov); this.overflow.set(nid, ov);
        }
        const txt = '+' + qn;
        if (ov.element.textContent !== txt) ov.element.textContent = txt;
        const ox = R * 0.95, oy = -R * 0.85;
        ov.position.set(o.x + right.x * ox + up.x * oy, o.y + right.y * ox + up.y * oy, o.z + right.z * ox + up.z * oy);
      }
    }
    for (const [nid, ov] of this.overflow) if (!seenOv.has(nid)) { ov.removeFromParent(); ov.element.remove(); this.overflow.delete(nid); }
    this.mesh.count = n;
    this._nr = nr;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.aColor.needsUpdate = true; this.aFlash.needsUpdate = true; this.aA.needsUpdate = true; this.aB.needsUpdate = true; this.aC.needsUpdate = true;
    }
    // 글 칸 배정·그리기(내용이 바뀐 칸만 캔버스 다시 그림). 글을 받은 패널은 셰이더가 물 무늬를 빼고, 안쪽 CSS 라벨은 생략
    const tf = this.text.update(tc, ntc, now);
    let tcN = 0;
    for (let i = 0; i < ntc; i++) { const c0 = tc[i]; if (c0.e._txf === tf) { Cc[c0.inst * 4 + 3] = 1; tcN++; } }
    for (let i = cand.length - 1; i >= 0; i--) if (cand[i].e._txf === tf) cand.splice(i, 1);
    this.stats.text = tcN;
    this.tGeo.setDrawRange(0, nt * 2);
    if (nt) { this.tGeo.attributes.position.needsUpdate = true; this.tGeo.attributes.color.needsUpdate = true; }
    this.tether.visible = nt > 0;
    this._labelPass(cand);
    this.stats.drawn = n;
  }

  /** 지금 펼친 패널의 화면 사각형 [x0, y0, x1, y1](px) — 노드 라벨이 피한다. 빌보드라 중심 깊이의 축척으로 충분 */
  panelRects(camera, W, H, out = []) {
    if (!this.enabled) return out;
    const f = H / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const v = this._pv || (this._pv = new THREE.Vector3());
    for (let i = 0; i < (this._nr || 0); i++) {
      const q = this._rw[i];
      v.set(q.x, q.y, q.z);
      const d = Math.max(0.01, v.distanceTo(camera.position));
      v.project(camera);
      if (v.z < -1 || v.z > 1) continue;
      const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H, hw = (q.w * f) / d / 2, hh = (q.h * f) / d / 2;
      if (q.mini) { out.push([x - Math.max(hw, 78), y - hh, x + Math.max(hw, 78), y + hh + 20]); continue; } // 패널 + 아래 짧은 라벨(최대 150px)
      if (hw < 3 || hh < 3) continue; // 점처럼 작은 패널은 장애물로 보지 않음
      out.push([x - hw, y - hh, x + hw, y + hh]);
    }
    return out;
  }

  _labelPass(cand) {
    if (cand.length > HOLO.MAX_LABELS) cand.sort((a, b) => b.score - a.score);
    const m = Math.min(cand.length, HOLO.MAX_LABELS);
    for (let i = 0; i < this.labels.length; i++) {
      const L = this.labels[i];
      if (i >= m) { if (L.o.visible) L.o.visible = false; continue; }
      const c = cand[i], e = c.e;
      // 도구명 · 대상 · (끝났으면) 결과 한 줄(exit 0 · …, 7개 파일, +12 −3). 같은 패널이 이어받으면 내용만 바뀜
      const ended = c.phase === 'flash' || c.phase === 'linger';
      const key = e.id + (ended ? '#r' : '#t');
      if (L.key !== key) {
        L.key = key;
        L.b.textContent = e.label.tool;
        L.s.textContent = e.label.target;
        L.r.textContent = ended && e.result ? '→ ' + e.result : '';
        L.el.style.setProperty('--hc', e.cat === 'skill' ? 'var(--skill)' : catColor(e.cat, this.tokens.isLight));
      }
      const mini = !c.inside;
      if (L.mini !== mini) { L.el.classList.toggle('mini', mini); L.o.center.set(0.5, mini ? 0 : 0.5); L.mini = mini; }
      const w = mini ? 150 : Math.max(70, Math.min(260, c.wpx | 0));
      if (L.w !== w) { L.el.style.maxWidth = w + 'px'; L.w = w; }
      const cls = ended ? (e.res === 'error' ? 'err' : e.res === 'stopped' ? 'stop' : 'ok') + (c.phase === 'flash' ? ' hot' : '') : '';
      if (L.cls !== cls) { L.el.classList.remove('ok', 'err', 'stop', 'hot'); if (cls) L.el.classList.add(...cls.split(' ')); L.cls = cls; }
      const op = c.fade < 1 ? String(Math.round(c.fade * 100) / 100) : '';
      if (L.op !== op) { L.el.style.opacity = op; L.op = op; }
      L.o.position.set(c.x, c.y, c.z);
      if (!L.o.visible) L.o.visible = true;
    }
    this.stats.labels = m;
  }

  dispose() {
    this.clear();
    this.mesh.removeFromParent(); this.tether.removeFromParent();
    this.mesh.geometry.dispose(); this.tGeo.dispose();
    this.mat.dispose(); this.tMat.dispose(); this.atlas.dispose();
    if (this.text) { this.text.dispose(); this.text = null; }
    for (const L of this.labels) { L.o.removeFromParent(); L.el.remove(); }
    this.labels = [];
  }
}
