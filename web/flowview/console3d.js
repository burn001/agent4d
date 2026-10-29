// 흐름(Flow) 3D 사용자 콘솔(나 · 사용자) — '홀로그램 콘솔 데스크'(예전 기운 모니터를 바꿈)
// 반달 책상(윗면 안쪽 금빛 호 · 바깥 상태색 호) · 자판 판 · 투사기 막대 · 받침 기둥 · 바닥 발판 + 투사기에서 떠 있는 화면으로 오르는 빛 부채,
// 떠 있는 홀로그램 화면에 글이 바로 뜬다(마지막 입력 첫 몇 단어 · 상태·시간 · 상태 표시 — 캔버스 텍스처, 12fps 이하·보이고 클 때만).
// 보낼 때: 자판이 번쩍 → 글자 빛이 자판에서 화면으로 오르고(여기) → 화면에서 메인으로 금빛 빔(ix-core drawUser, 예전 그대로).
// 질문이 오면 화면 옆에 금빛 '?' 카드가 선다. 어휘 그대로 바닥 그림자 원반 · 바닥 → 발판 점선 기둥줄.
// 자리·방위·상태는 ix-core ixGeometry 의 geo.cons(입체 모드 env.solid — 화면 가운데·기저 r/v/n·방위·상태·투명도)를 그대로 따른다.
// 그리기: 책상 몸 인스턴싱 1 + 빛 부채 인스턴싱 1 + 그림자 1 + 화면 글 판(가까운 것 몇 개, 글 없으면 옅은 화면만).
import * as THREE from 'three';
import { CON3D, ixKeyColor } from '../ix-core.mjs';
import { consoleLook, CON_LOD_PX } from './console-core.mjs';
import { DESK, sendPhase } from './shape-core.mjs';
import { userBook } from '../user-core.mjs';
import { t as tr } from '../i18n.mjs';

const MAX = 48;
const SCREEN_MAX = 16; // 글 판(텍스처) 상한 — 화면에서 큰 것부터
// 단말 부분 번호(aM.x): 0 몸 · 2 자판 판 · 3 책상 윗면 · 4 그림자 원반 · 5 점선 기둥줄 · 6 투사기 막대 · 7 빛 부채
export const DESK3D = {
  TOP_Y: -1.5, THICK: 0.14, ZC: 2.4, R0: 1.13, R1: 2.13, ANG: 0.91, // 책상 윗면 높이(화면 가운데 기준) · 두께 · 호 중심 z · 안/바깥 반지름 · 반각
  PED_Y: -2.6, PED_Z: 0.8, FOOT_R: 0.6,                              // 발판 윗면 · 받침 z
  KEY: { z: 1.0, w: 1.04, d: 0.36 }, EMIT: { z: 0.47, w: 0.93 },
};
const D = DESK3D;

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
  if (aM.x > 4.5 && aM.x < 5.5) {   // 바닥 → 발판 밑면 점선 기둥줄(세로축 빌보드)
    vec3 base = C + R * vec3(0.0, ${(D.PED_Y - 0.08).toFixed(3)}, ${D.PED_Z.toFixed(3)});
    float hg = max(0.0, base.y - uFloor);
    vec3 b = vec3(base.x, uFloor + position.y * hg, base.z);
    vec3 tc = cameraPosition - b;
    vec3 r = normalize(vec3(tc.z, 0.0, -tc.x) + vec3(1e-4, 0.0, 0.0));
    w = b + r * position.x * uStemW;
    vUv = vec2(position.x, position.y * hg); vH = hg;
  } else if (aM.x > 3.5 && aM.x < 4.5) { // 그림자 원반(바닥): 높을수록 넓고 옅게
    vec3 base = C + R * vec3(0.0, ${D.PED_Y.toFixed(3)}, ${(D.PED_Z + 0.6).toFixed(3)});
    float hg = max(0.0, base.y - uFloor);
    float rr = 2.0 * (1.0 + hg * 0.035);
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
uniform float uTime; uniform float uLight; uniform vec3 uBody; uniform vec3 uFog; uniform float uFogMax;
varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vPart; varying vec3 vCol; varying vec3 vLed; varying vec4 vP; varying vec4 vQ; varying float vFog; varying float vH;
// vCol 사용자 금빛(오류면 빨강) · vLed 상태색 / vP: 투명도 · 발광 0..1 · 자판 번쩍 0..1 · 호버/선택 / vQ: LOD · 씨앗 · 빛 부채 세기 · 질문 대기
void main() {
  bool light = uLight > 0.5;
  float fade = vP.x, glow = vP.y, keyK = vP.z, foc = vP.w;
  if (fade < 0.004) discard;
  if (vPart > 6.5) {          // 빛 부채: 투사기(아래)에서 화면(위)으로 옅어지는 사다리꼴 빛, 양옆 가장자리 흐림
    float side = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
    float a = mix(0.9, 0.12, vUv.y) * side * vQ.z;
    gl_FragColor = linearToOutputTexel(vec4(mix(vLed, uFog, vFog * uFogMax), a * fade * (light ? 0.8 : 1.0)));
    return;
  }
  if (vPart > 4.5) {          // 점선 기둥줄: 아래로 흐르는 점선
    float lineA = smoothstep(1.0, 0.15, abs(vUv.x));
    float dash = step(0.5, fract(vUv.y * 0.7 + uTime * 0.35 * step(0.001, vQ.z)));
    float al = lineA * dash * (light ? 0.34 : 0.26) * (0.4 + 0.6 * smoothstep(0.0, 2.0, vUv.y));
    gl_FragColor = linearToOutputTexel(vec4(mix(vLed, uFog, vFog * uFogMax), al * fade));
    return;
  }
  if (vPart > 3.5) {          // 그림자 원반: 부드러운 어두운 가운데 + 상태색 옅은 테
    float dd = length(vUv);
    if (dd > 1.0) discard;
    float hk = 1.0 / (1.0 + vH * 0.05);
    float core = 1.0 - smoothstep(0.0, 1.0, dd); core *= core;
    float rim = smoothstep(0.08, 0.0, abs(dd - 0.82));
    vec3 col = light ? mix(vec3(0.22, 0.27, 0.36), vLed, rim * 0.75) : mix(vec3(0.0), vLed, rim);
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
  vec3 sink = light ? vLed * 0.85 : mix(vLed, vec3(1.0), 0.1);
  vec3 col; float al = 1.0;
  if (vPart < 0.5) {          // 몸: 어두운(라이트는 밝은) 판 + 방향광 음영 + 가장자리 금빛 테(호버면 진하게)
    col = uBody * shade;
    col = mix(col, ink, fres * (light ? 0.25 : 0.4) * (0.4 + 0.6 * glow + foc * 0.6));
  } else if (vPart < 2.5) {   // 자판 판: 옅은 금빛 판 + 키 격자, 보낼 때 번쩍
    vec2 g = vec2(vUv.x * 12.0, vUv.y * 4.0);
    vec2 f = abs(fract(g) - 0.5);
    float key = smoothstep(0.42, 0.36, max(f.x, f.y)) * step(vUv.y, 0.75);
    float bar = step(0.78, vUv.y) * step(0.3, vUv.x) * step(vUv.x, 0.7);
    float k = 0.18 + 0.25 * glow + keyK * 0.8;
    col = mix(uBody * shade, ink, (key + bar) * k + 0.06);
  } else if (vPart < 3.5) {   // 책상 윗면: 몸색 + 안쪽 금빛 호 · 바깥 상태색 호
    col = uBody * (light ? 0.95 : 0.75 + 0.25 * ndl);
    float inner = smoothstep(0.06, 0.0, vUv.y) * (0.55 + 0.4 * glow + foc * 0.4);
    float outer = smoothstep(0.94, 1.0, vUv.y) * (0.35 + 0.6 * glow + foc * 0.3);
    col = mix(col, ink, inner);
    col = mix(col, sink, outer);
  } else {                    // 투사기 막대: 금빛 발광(빛 부채 세기만큼)
    col = mix(uBody, ink, 0.45 + 0.55 * vQ.z);
  }
  col = mix(col, uFog, vFog * uFogMax);
  gl_FragColor = linearToOutputTexel(vec4(col, al * fade * (1.0 - vFog * uFogMax * 0.3)));
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
function box(B, c, h, part, det) {
  const F = [
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
    [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]], [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]], [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
  ];
  for (const [n, cs] of F) { const p = cs.map((s) => [c[0] + s[0] * h[0], c[1] + s[1] * h[1], c[2] + s[2] * h[2]]); B.quad(p[0], p[1], p[2], p[3], n, part, det); }
}
/** 육각 기둥(가운데 (x, z), y0..y1, 반지름 r0 아래 · r1 위), 윗면 포함 */
function hexCol(B, x, z, y0, y1, r0, r1, part, det, top = true) {
  const H = (r, y) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + (Math.PI / 3) * i; return [x + Math.cos(a) * r, y, z + Math.sin(a) * r]; });
  const lo = H(r0, y0), hi = H(r1, y1);
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6, am = Math.PI / 6 + (Math.PI / 3) * (i + 0.5);
    B.quad(lo[i], lo[j], hi[j], hi[i], [Math.cos(am), 0, Math.sin(am)], part, det);
  }
  if (top) { const c = B.v([x, y1, z], [0, 1, 0], part, det); const ring = hi.map((p) => B.v(p, [0, 1, 0], part, det)); for (let i = 0; i < 6; i++) B.idx.push(c, ring[(i + 1) % 6], ring[i]); }
}
function consoleGeometry() {
  const B = builder();
  const y1 = D.TOP_Y, y0 = D.TOP_Y - D.THICK, A = D.ANG, SEG = 20;
  const pt = (a, r, y) => [Math.sin(a) * r, y, D.ZC - Math.cos(a) * r];
  // 반달 책상: 윗면(부분 3, uv = 호 · 반지름) · 밑면 · 안쪽/바깥 옆 · 양 끝
  for (let i = 0; i < SEG; i++) {
    const a0 = -A + (2 * A * i) / SEG, a1 = -A + (2 * A * (i + 1)) / SEG, u0 = i / SEG, u1 = (i + 1) / SEG;
    B.quad(pt(a0, D.R1, y1), pt(a1, D.R1, y1), pt(a1, D.R0, y1), pt(a0, D.R0, y1), [0, 1, 0], 3, 0, [[u0, 1], [u1, 1], [u1, 0], [u0, 0]]);
    B.quad(pt(a0, D.R0, y0), pt(a1, D.R0, y0), pt(a1, D.R1, y0), pt(a0, D.R1, y0), [0, -1, 0], 0, 0);
    const no = [-Math.sin((a0 + a1) / 2), 0, Math.cos((a0 + a1) / 2)]; // 바깥(뒤, 화면 쪽) 옆 법선
    B.quad(pt(a1, D.R1, y0), pt(a0, D.R1, y0), pt(a0, D.R1, y1), pt(a1, D.R1, y1), [-no[0], 0, -no[2]], 0, 0);
    B.quad(pt(a0, D.R0, y0), pt(a1, D.R0, y0), pt(a1, D.R0, y1), pt(a0, D.R0, y1), no, 0, 0);
  }
  for (const s of [-1, 1]) { const a = s * A; B.quad(pt(a, D.R0, y0), pt(a, D.R1, y0), pt(a, D.R1, y1), pt(a, D.R0, y1), [s * Math.cos(a), 0, s * Math.sin(a)], 0, 0); }
  // 자판 판(윗면 바로 위) · 투사기 막대(뒤쪽 가장자리)
  const K = D.KEY, ky = y1 + 0.012;
  B.quad([-K.w / 2, ky, K.z + K.d / 2], [K.w / 2, ky, K.z + K.d / 2], [K.w / 2, ky, K.z - K.d / 2], [-K.w / 2, ky, K.z - K.d / 2], [0, 1, 0], 2, 1);
  box(B, [0, y1 + 0.035, D.EMIT.z], [D.EMIT.w / 2, 0.035, 0.05], 6, 0);
  // 받침 기둥 · 발판
  hexCol(B, 0, D.PED_Z, D.PED_Y, y0, 0.24, 0.13, 0, 0, false);
  hexCol(B, 0, D.PED_Z, D.PED_Y - 0.08, D.PED_Y, D.FOOT_R * 1.06, D.FOOT_R, 0, 0, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.P, 3));
  g.setAttribute('aNrm', new THREE.Float32BufferAttribute(B.N, 3));
  g.setAttribute('aM', new THREE.Float32BufferAttribute(B.M, 4));
  g.setIndex(B.idx);
  return g;
}
/** 빛 부채: 투사기 막대 윗변 → 떠 있는 화면 아랫변(기운 화면 — CON3D.TILT) */
function fanGeometry() {
  const t = CON3D.TILT, by = -CON3D.H * Math.cos(t), bz = CON3D.H * Math.sin(t), ey = D.TOP_Y + 0.07, ez = D.EMIT.z, ew = D.EMIT.w / 2;
  const P = [-ew, ey, ez, ew, ey, ez, CON3D.W, by, bz, -CON3D.W, by, bz];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aNrm', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('aM', new THREE.Float32BufferAttribute([7, 0, 0, 0, 7, 0, 1, 0, 7, 0, 1, 1, 7, 0, 0, 1], 4));
  g.setIndex([0, 1, 2, 0, 2, 3]);
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

// ───── 떠 있는 화면 글(캔버스) ─────
const ST_COL = { idle: '#7b88a8', working: '#66ccff', answered: '#66ffaa', asking: '#fcd34d', alert: '#ff5566' };
const ST_COL_L = { idle: '#5b6680', working: '#1f7fc4', answered: '#0f9e6a', asking: '#a16207', alert: '#d4313f' };
const FONT = '"IBM Plex Sans KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif';
const MONO = '"JetBrains Mono",D2Coding,Consolas,ui-monospace,monospace';
const rgba = (hex, a) => { const c = parseInt(hex.slice(1), 16); return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`; };
function fitText(x, s, maxW) { if (x.measureText(s).width <= maxW) return s; while (s.length > 1 && x.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s + '…'; }
function wrap2(x, s, maxW) {
  const out = []; let cur = '';
  for (const ch of s) { if (cur && x.measureText(cur + ch).width > maxW) { out.push(cur); cur = ch === ' ' ? '' : ch; if (out.length === 2) break; } else cur += ch; }
  if (out.length < 2 && cur) out.push(cur);
  if (out.length === 2 && x.measureText(s).width > maxW * 2) out[1] = fitText(x, out[1] + '……', maxW);
  return out;
}
/** 화면 한 장 그리기(홀로그램: 옅은 바탕 + 주사선 + 모서리 금빛 괄호 + 글). text = false 면 글 없이 바탕만(멀 때) */
export function drawDeskScreen(x, w, h, info, t, o = {}) {
  const st = (info && info.state) || 'idle', L = !!o.light, C = (L ? ST_COL_L : ST_COL)[st] || ST_COL.idle;
  const gold = L ? '#a16207' : '#fcd34d';
  x.clearRect(0, 0, w, h);
  x.fillStyle = L ? 'rgba(20,40,90,.07)' : 'rgba(40,80,150,.13)'; x.fillRect(0, 0, w, h);
  const pul = st === 'asking' && !o.reduced ? 0.6 + 0.4 * Math.sin(t * 5) : 1;
  const tint = ({ idle: 0.02, working: 0.09, answered: 0.12, asking: 0.2, alert: 0.16 }[st] || 0.04) * pul;
  x.fillStyle = rgba(C, tint); x.fillRect(0, 0, w, h);
  x.fillStyle = L ? 'rgba(0,0,0,.025)' : 'rgba(255,255,255,.03)'; for (let y = 0; y < h; y += 4) x.fillRect(0, y, w, 1);
  if (st !== 'idle' && !o.reduced) { const sy = ((t * (st === 'working' ? 0.45 : 0.25)) % 1) * h; const g = x.createLinearGradient(0, sy - 18, 0, sy + 18); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, rgba(C, 0.14)); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, sy - 18, w, 36); }
  x.strokeStyle = rgba(gold, 0.6); x.lineWidth = Math.max(2, w / 200); const k = w * 0.06;
  for (const [cx, cy, sx, sy] of [[3, 3, 1, 1], [w - 3, 3, -1, 1], [w - 3, h - 3, -1, -1], [3, h - 3, 1, -1]]) { x.beginPath(); x.moveTo(cx + sx * k, cy); x.lineTo(cx, cy); x.lineTo(cx, cy + sy * k); x.stroke(); }
  if (o.text === false) return;
  const u = Math.min(h / 7, w / 11.5), pad = u * 0.8, maxW = w - pad * 2;
  let y = pad + u * 0.5;
  x.textAlign = 'left'; x.textBaseline = 'middle';
  x.font = `600 ${u * 0.6}px ${MONO}`; x.fillStyle = rgba(gold, 0.82); x.fillText(tr('cards.user.title'), pad, y);
  x.beginPath(); x.arc(w - pad, y, u * 0.22, 0, Math.PI * 2); x.fillStyle = C; x.globalAlpha = st === 'asking' && !o.reduced ? 0.4 + 0.6 * (Math.sin(t * 8) > 0 ? 1 : 0) : 1; x.fill(); x.globalAlpha = 1;
  y += u * 1.3;
  x.font = `700 ${u * 0.92}px ${FONT}`; x.fillStyle = st === 'idle' ? (L ? '#6b7690' : '#56627f') : (L ? '#7a4a00' : '#fde68a');
  const lines = info && info.text ? wrap2(x, info.text, maxW) : ['—'];
  for (const l of lines) { x.fillText(l, pad, y); y += u * 1.15; }
  if (lines.length < 2) y += u * 1.15 * 0.5;
  x.font = `500 ${u * 0.74}px ${FONT}`; x.fillStyle = C; x.fillText(fitText(x, (info && info.status) || '', maxW), pad, y);
  // 아래 상태 표시: 작업 중 = 흐르는 점, 질문 = 선택지 칸, 답함 = 숨 쉬는 줄, 대기 = 깜빡이는 커서
  const by = h - pad - u * 0.2;
  if (st === 'working') {
    x.fillStyle = rgba(C, 0.25); x.fillRect(pad, by - 2, maxW, 4);
    const p = o.reduced ? 0.5 : (t * 0.5) % 1; x.fillStyle = C; x.beginPath(); x.arc(pad + maxW * p, by, u * 0.2, 0, Math.PI * 2); x.fill();
    x.fillStyle = rgba(C, 0.7); x.fillRect(pad, by - 2, maxW * p, 4);
  } else if (st === 'asking') {
    const n = Math.max(2, Math.min(4, (info && info.opts) || 3)), pw = Math.min(maxW / (n + 0.4), u * 2.2), gap = (maxW - pw * n) / Math.max(1, n - 1);
    for (let i = 0; i < n; i++) { const on = o.reduced || Math.sin(t * 4 - i * 0.9) > 0; const X = pad + i * (pw + gap); x.fillStyle = rgba(gold, on ? 0.32 : 0.12); x.fillRect(X, by - u * 0.42, pw, u * 0.84); x.strokeStyle = rgba(gold, 0.8); x.lineWidth = 2; x.strokeRect(X, by - u * 0.42, pw, u * 0.84); x.fillStyle = L ? '#7a4a00' : '#fde68a'; x.font = `700 ${u * 0.6}px ${MONO}`; x.textAlign = 'center'; x.fillText(String(i + 1), X + pw / 2, by + 1); x.textAlign = 'left'; }
  } else if (st === 'answered') {
    x.fillStyle = rgba(C, 0.35 + 0.35 * (o.reduced ? 1 : 0.5 + 0.5 * Math.sin(t * 3))); x.fillRect(pad, by - 2, maxW * 0.6, 4);
  } else {
    x.fillStyle = rgba(C, o.reduced || Math.sin(t * 3) > 0 ? 0.8 : 0.1); x.fillRect(pad, by - u * 0.35, u * 0.4, u * 0.7);
  }
}

export class FlowConsoles {
  constructor(scene, view) {
    this.view = view; this.scene = scene;
    const geo = consoleGeometry(), fgeo = fanGeometry(), sgeo = shadowGeometry();
    const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(MAX * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aCol = mk(3); this.aLed = mk(3); this.aP = mk(4); this.aQ = mk(4);
    for (const g of [geo, fgeo, sgeo]) { g.setAttribute('iCol', this.aCol); g.setAttribute('iLed', this.aLed); g.setAttribute('iP', this.aP); g.setAttribute('iQ', this.aQ); }
    this.uniforms = { uTime: { value: 0 }, uLight: { value: 0 }, uBody: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uFogMax: { value: 0.5 },
      uFogNear: { value: 80 }, uFogFar: { value: 300 }, uFloor: { value: 0 }, uStemW: { value: 0.08 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: true, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1.6; // 칩 깊이(0.9)·색(1) 다음 — 앞의 칩에 가려지고 뒤의 칩은 가림, 빔·글줄(2·3)은 그 뒤
    this.fmat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.fan = new THREE.InstancedMesh(fgeo, this.fmat, MAX);
    this.fan.instanceMatrix = this.mesh.instanceMatrix;
    this.fan.count = 0; this.fan.frustumCulled = false; this.fan.renderOrder = 1.65;
    this.smat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.shadow = new THREE.InstancedMesh(sgeo, this.smat, MAX);
    this.shadow.instanceMatrix = this.mesh.instanceMatrix;
    this.shadow.count = 0; this.shadow.frustumCulled = false; this.shadow.renderOrder = 0.5;
    scene.add(this.shadow, this.mesh, this.fan);
    // 떠 있는 화면 글 판 풀(콘솔마다 하나, 큰 것부터 SCREEN_MAX)
    this.screens = [];
    this.sgeo = new THREE.PlaneGeometry(CON3D.W * 2, CON3D.H * 2);
    this.qgeo = new THREE.PlaneGeometry(0.62, 0.62);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._e = new THREE.Euler(); this._c = new THREE.Color();
    this._keyCol = new Map();
    this.isLight = false;
    this.count = 0;
    this._cand = [];
  }
  applyTheme(isLight) {
    this.isLight = !!isLight;
    this.uniforms.uLight.value = this.isLight ? 1 : 0;
    this.uniforms.uBody.value.set(this.isLight ? '#d3dae5' : '#1d2740');
    this.fmat.blending = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending; this.fmat.needsUpdate = true;
    for (const s of this.screens) { s.mat.blending = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending; s.mat.needsUpdate = true; s.key = ''; s.qmat.needsUpdate = true; this._drawQ(s); }
    this._keyCol.clear();
  }
  _col(key) {
    let c = this._keyCol.get(key);
    if (!c) { c = new THREE.Color(ixKeyColor(key, this.isLight)); this._keyCol.set(key, c); }
    return c;
  }
  _drawQ(s) {
    const x = s.qx, L = this.isLight; x.clearRect(0, 0, 128, 128);
    x.fillStyle = L ? 'rgba(255,248,225,.92)' : 'rgba(40,30,0,.72)'; x.beginPath(); x.arc(64, 64, 56, 0, Math.PI * 2); x.fill();
    x.strokeStyle = L ? '#a16207' : '#fcd34d'; x.lineWidth = 6; x.stroke();
    x.font = `700 74px ${FONT}`; x.fillStyle = L ? '#a16207' : '#fcd34d'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('?', 64, 68);
    s.qtex.needsUpdate = true;
  }
  _screen(i) {
    let s = this.screens[i];
    if (s) return s;
    const c = document.createElement('canvas'); c.width = DESK.TEX_W; c.height = DESK.TEX_H;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const bl = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: bl });
    const grp = new THREE.Group();
    const scr = new THREE.Mesh(this.sgeo, mat); scr.raycast = () => {}; scr.renderOrder = 2.5; scr.rotation.x = -CON3D.TILT;
    const qc = document.createElement('canvas'); qc.width = qc.height = 128;
    const qtex = new THREE.CanvasTexture(qc); qtex.colorSpace = THREE.SRGBColorSpace;
    const qmat = new THREE.MeshBasicMaterial({ map: qtex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const q = new THREE.Mesh(this.qgeo, qmat); q.raycast = () => {}; q.renderOrder = 2.6; q.visible = false;
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24), 3));
    const gm = new THREE.PointsMaterial({ size: 0.16, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfcd34d });
    const glyph = new THREE.Points(gg, gm); glyph.raycast = () => {}; glyph.visible = false; glyph.renderOrder = 2.6; glyph.frustumCulled = false;
    grp.add(scr, q, glyph); grp.visible = false;
    this.scene.add(grp);
    s = this.screens[i] = { c, x: c.getContext('2d'), tex, mat, grp, scr, q, qmat, qtex, qx: qc.getContext('2d'), glyph, key: '', at: -1 };
    this._drawQ(s);
    return s;
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
    const nowMs = view.clock ? view.clock() : Date.now();
    const cand = this._cand; cand.length = 0;
    let n = 0;
    for (const con of cons || []) {
      if (!con.r || n >= MAX) continue;
      const look = consoleLook(con, now, reduced);
      this._p.set(con.x, con.y, con.z).addScaledVector(this._v || (this._v = new THREE.Vector3()).set(con.n[0], con.n[1], con.n[2]), -CON3D.FACE_OUT); // 화면 가운데 S
      this._q.setFromEuler(this._e.set(0, con.yaw || 0, 0));
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      const kc = this._col(con.key || 'user'), lc = this._col(look.led === 'dim' ? 'dim' : look.led);
      // 보낸 직후(사람 입력 시각 = 장부 promptAt): 자판 번쩍 → 글자 빛이 화면으로
      const e = userBook.get(con.root);
      const ph = e && e.promptAt != null ? sendPhase((nowMs - e.promptAt) / 1000) : -1;
      const keyK = ph >= 0 && !reduced ? (ph < 0.35 ? 0.5 + 0.5 * (Math.sin(now * 40) > 0 ? 1 : 0) : 0) : 0;
      const fanK = (con.state === 'idle' ? 0.06 : con.asking ? 0.26 + (reduced ? 0 : 0.1 * Math.sin(now * 5)) : 0.17) + (ph > 0.2 && ph < 0.6 ? 0.2 : 0);
      C[n * 3] = kc.r; C[n * 3 + 1] = kc.g; C[n * 3 + 2] = kc.b;
      const fanC = con.asking || ph >= 0 ? kc : lc;
      L[n * 3] = fanC.r; L[n * 3 + 1] = fanC.g; L[n * 3 + 2] = fanC.b;
      const foc = view.hoverId === con.root || view.focusId === con.root ? 1 : 0;
      A[n * 4] = con.fade ?? 1; A[n * 4 + 1] = look.glow; A[n * 4 + 2] = keyK; A[n * 4 + 3] = foc;
      Q[n * 4] = (con.px ?? 999) < CON_LOD_PX ? 1 : 0; Q[n * 4 + 1] = (n * 0.37) % 1; Q[n * 4 + 2] = fanK * (this.isLight ? 1.4 : 1); Q[n * 4 + 3] = con.asking ? 1 : 0;
      if ((con.px ?? 0) >= DESK.BADGE_PX) cand.push({ con, ph, fade: con.fade ?? 1 });
      n++;
    }
    this.mesh.count = n; this.shadow.count = n; this.fan.count = n; this.count = n;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.aCol.needsUpdate = true; this.aLed.needsUpdate = true; this.aP.needsUpdate = true; this.aQ.needsUpdate = true;
    }
    // 떠 있는 화면: 큰 것부터 SCREEN_MAX — 글은 TEXT_PX 이상일 때만(작으면 옅은 화면만), 다시 그리기 ≤ 12fps
    cand.sort((a, b) => (b.con.px || 0) - (a.con.px || 0));
    const m = Math.min(SCREEN_MAX, cand.length);
    for (let i = 0; i < m; i++) {
      const { con, ph, fade } = cand[i], s = this._screen(i);
      const info = view.ix && view.ix.consoleInfo ? view.ix.consoleInfo(con.root) : null;
      const opts = e2((con.px || 0) >= DESK.TEXT_PX);
      const key = con.root + '|' + (info ? info.state + info.text + info.status : '') + '|' + opts.text + '|' + this.isLight;
      const moving = !reduced && info && info.state !== 'idle';
      if (key !== s.key || (moving && now - s.at >= 1 / DESK.FPS)) {
        s.key = key; s.at = now;
        drawDeskScreen(s.x, DESK.TEX_W, DESK.TEX_H, info ? { ...info, opts: e3(con.root) } : null, now, { light: this.isLight, reduced, text: opts.text });
        s.tex.needsUpdate = true;
      }
      s.grp.position.set(con.x - con.n[0] * CON3D.FACE_OUT, con.y - con.n[1] * CON3D.FACE_OUT, con.z - con.n[2] * CON3D.FACE_OUT);
      s.grp.rotation.set(0, con.yaw || 0, 0);
      s.mat.opacity = Math.min(1, fade * (info && info.state === 'idle' ? 0.6 : 1) * (this.isLight ? 1 : 1));
      // 질문 카드(화면 오른쪽 위 바깥)
      s.q.visible = !!con.asking;
      if (s.q.visible) { s.q.position.set(CON3D.W + 0.55, CON3D.H * 0.75 + (reduced ? 0 : 0.06 * Math.sin(now * 3)), 0.05); s.qmat.opacity = fade; }
      // 보낸 직후 글자 빛: 자판 → 화면 아랫변
      const gl = s.glyph;
      gl.visible = ph >= 0 && ph < 0.75 && !reduced;
      if (gl.visible) {
        const arr = gl.geometry.getAttribute('position').array, by = -CON3D.H * Math.cos(CON3D.TILT) + 0.1, bz = CON3D.H * Math.sin(CON3D.TILT);
        for (let k = 0; k < 8; k++) {
          const u = Math.min(1, Math.max(0, (ph / 0.75 - k * 0.04) / 0.7));
          arr[k * 3] = -0.4 + k * 0.11 + Math.sin(k + now) * 0.05; arr[k * 3 + 1] = D.TOP_Y + 0.05 + (by - D.TOP_Y) * u; arr[k * 3 + 2] = D.KEY.z + (bz - D.KEY.z) * u;
        }
        gl.geometry.getAttribute('position').needsUpdate = true;
        gl.material.opacity = fade * Math.sin(Math.min(1, ph / 0.75) * Math.PI);
        gl.material.blending = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
        gl.material.color.set(this.isLight ? '#a16207' : '#fcd34d');
      }
      s.grp.visible = fade > 0.02;
    }
    for (let i = m; i < this.screens.length; i++) this.screens[i].grp.visible = false;
  }
  dispose() {
    this.mesh.removeFromParent(); this.shadow.removeFromParent(); this.fan.removeFromParent();
    this.mesh.geometry.dispose(); this.shadow.geometry.dispose(); this.fan.geometry.dispose(); this.mat.dispose(); this.smat.dispose(); this.fmat.dispose();
    for (const s of this.screens) { s.grp.removeFromParent(); s.mat.dispose(); s.tex.dispose(); s.qmat.dispose(); s.qtex.dispose(); s.glyph.geometry.dispose(); s.glyph.material.dispose(); }
    this.screens = []; this.sgeo.dispose(); this.qgeo.dispose();
  }
}
const e2 = (text) => ({ text });
const e3 = (root) => { const e = userBook.get(root); return e && e.ask ? e.ask.opts : 0; };
