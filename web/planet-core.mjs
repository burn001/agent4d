// Planet 행성 연출 규칙(순수, three·DOM 없음).
// 메인 = 기계 행성(패널 이음선·궤도 링·기어 띠·해치·안테나·이음선 사이 코어 광), 서브에이전트 = 대기층·구름 띠·작은 위성.
// 3D(planet-deco.js)와 2D(flat/planet-deco2d.js)가 같은 값을 쓴다.
import { t as tr } from './i18n.mjs'; // 항로 관문 글자

/** 활동 상태 → 기계 행성 동작 세기. spin = 링 회전(rad/s), glow = 이음선 코어 광, lights = 표면 조명 점 속도·밝기,
 *  hatch = 해치 여닫이, ant = 안테나 펼침, pulse = 코어 맥동(Hz) */
export const MECH = {
  tool:  { spin: 2.4,  glow: 1.0,  lights: 1.6,  hatch: 1.0,  ant: 1.0,  pulse: 2.2 },
  think: { spin: 0.85, glow: 0.7,  lights: 0.8,  hatch: 0.3,  ant: 0.35, pulse: 1.1 },
  wait:  { spin: 0.22, glow: 0.32, lights: 0.25, hatch: 0.0,  ant: 0.12, pulse: 0.45 },
  error: { spin: 0.1,  glow: 0.55, lights: 0.1,  hatch: 0.0,  ant: 0.0,  pulse: 3.0 },
  off:   { spin: 0.02, glow: 0.05, lights: 0.0,  hatch: 0.0,  ant: 0.0,  pulse: 0.2 },
};

/** 서브에이전트 행성: spin = 구름 흐름·위성 공전 배율, glow = 표면 발광 맥동 */
export const SUB = {
  tool:  { spin: 1.6,  glow: 0.9 },
  think: { spin: 1.0,  glow: 0.55 },
  wait:  { spin: 0.35, glow: 0.15 },
  error: { spin: 0.2,  glow: 0.3 },
  off:   { spin: 0.06, glow: 0.0 },
};

/** LOD 문턱(노드 반지름의 화면 픽셀). 아래면 덧붙인 부품을 그리지 않는다 */
export const PLANET_LOD = { HIDE_PX: 5, DETAIL_PX: 16 };

/** 노드 상태 → 동작 이름. tools = 열린 도구 수, dim = 고정 희미(recent 루트 등)면 조용히 */
export function planetMode(status, tools = 0, dim = false) {
  if (status === 'done' || status === 'stopped') return 'off';
  if (status === 'error') return 'error';
  if (dim) return 'wait';
  if (status === 'active') return tools > 0 ? 'tool' : 'think';
  return 'wait';
}

/** cur 를 target 쪽으로 지수 보간(초당 rate). cur·target 은 같은 키를 가진 객체, cur 를 고쳐 돌려준다 */
export function approach(cur, target, dt, rate = 3) {
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  for (const key in target) cur[key] = (cur[key] ?? target[key]) + (target[key] - (cur[key] ?? target[key])) * k;
  return cur;
}

/** 세계 반지름 r 이 거리 dist 에서 화면 높이 viewH, 세로 화각 fovDeg 일 때 몇 픽셀인가 */
export function pxRadius(r, dist, fovDeg, viewH) {
  if (!(dist > 1e-6)) return Infinity;
  return (r * viewH) / (2 * Math.tan((fovDeg * Math.PI) / 360) * dist);
}

/** 0 = 몸체만, 1 = 큰 부품(링·위성·대기), 2 = 잔부품(기어 이·안테나)까지 */
export function planetLod(px) {
  if (!(px >= PLANET_LOD.HIDE_PX)) return 0;
  return px < PLANET_LOD.DETAIL_PX ? 1 : 2;
}

/** 해치 i 의 열림(0..1): 열린 시간이 칸마다 엇갈리게, hatch 세기로 비율 */
export function hatchOpen(i, t, hatch) {
  if (!(hatch > 0.01)) return 0;
  const s = 0.5 + 0.5 * Math.sin(t * 1.7 + i * 2.39);
  const k = Math.min(1, Math.max(0, (s - 0.35) / 0.4));
  return k * k * (3 - 2 * k) * hatch;
}

// ----------------～ 본체 축소 · 궤도계 · 서브에이전트 유형 (3D planet-orbits.js·planet-sub.js, 2D planet-deco2d.js 가 같은 값을 쓴다) ----------------

/** 본체 반지름 배율(예전 그린 반지름 대비). 배치 간격(RADIUS)은 그대로 두고 그리는 몸체만 줄여 둘레를 궤도계로 채운다 */
export const BODY_K = { main: 0.72, subagent: 0.68, workflow: 0.7, 'workflow-agent': 0.7, 'claude-p': 0.7, 'bash-bg': 0.74, monitor: 0.74, device: 0.74 };
export function bodyK(kind, device = false) { return device ? BODY_K.device : BODY_K[kind] ?? BODY_K.subagent; }

/** 문자열 → [0,1) (FNV-1a). salt 로 같은 id 에서 독립 값을 여럿 뽑는다 */
export function hash01(str, salt = '') {
  let h = 0x811c9dc5;
  const s = String(str) + '|' + salt;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** 서브에이전트 행성 유형(노드 id 로 고정 — 세션 내내, 3D·2D 같음) */
export const SUB_TYPES = ['gas', 'lava', 'ice', 'ringed', 'binary', 'swarm', 'comet', 'crystal'];
export function subType(id) { return SUB_TYPES[Math.min(SUB_TYPES.length - 1, Math.floor(hash01(id, 'type') * SUB_TYPES.length))]; }

/** 궤도 활동 세기: speed = 공전 배율, bright = 궤도선·위성 밝기, emit = 도구 입자(초당) */
export const ORBIT = {
  tool:  { speed: 2.4,  bright: 1.0,  emit: 9 },
  think: { speed: 1.25, bright: 0.72, emit: 0 },
  wait:  { speed: 0.45, bright: 0.42, emit: 0 },
  error: { speed: 0.3,  bright: 0.5,  emit: 0 },
  off:   { speed: 0.12, bright: 0.22, emit: 0 },
};

/** 궤도 LOD(본체 화면 반지름 px): 0 = 본체만, 1 = 주 궤도 하나(위성 점), 2 = 궤도 대부분·위성, 3 = 전부(소행성대·잔광·보조 궤도) */
export const ORBIT_LOD = { ONE_PX: 5, MOST_PX: 11, ALL_PX: 26 };
export function orbitLod(px) {
  if (!(px >= ORBIT_LOD.ONE_PX)) return 0;
  return px < ORBIT_LOD.MOST_PX ? 1 : px < ORBIT_LOD.ALL_PX ? 2 : 3;
}

/**
 * 노드 하나의 궤도계(본체 반지름 = 1 단위). 결정적: 같은 (kind, id) 면 같은 결과.
 * ring = { a 긴반지름, e 이심률, inc 기울기, node 승교점 회전, style 'solid'|'dash'|'dots'|'arcs', speed rad/s, dir ±1,
 *          ph 시작 위상, lod 보이는 최소 단계, trail 잔광 길이(0..1, 궤도 둘레 비율), alpha 기본 투명도,
 *          sats: [{ size, off 위상 차, tint 0=몸체색..1=밝은색, kind 'moon'|'carrier'|'spark' }] }
 * belt = { r0, r1, n, h 두께, inc, node, speed, lod } | null, extent = 궤도계 바깥 반지름(본체 반지름 배)
 */
export function orbitSpec(kind, id, opts = {}) {
  const H = (s) => hash01(id, s);
  const sg = (s) => (H(s) < 0.5 ? -1 : 1);
  const jit = (s, k) => (H(s) - 0.5) * 2 * k;
  const R = [];
  let belt = null;
  const ring = (o) => { const r = { e: 0, inc: 0, node: 0, style: 'solid', speed: 0.6, dir: 1, ph: 0, lod: 1, trail: 0, alpha: 0.5, sats: [], ...o }; R.push(r); return r; };
  const type = opts.type || (kind === 'subagent' ? subType(id) : null);
  if (kind === 'main') {
    // 메인: 기계 링(planet-deco) 바깥으로 점 열 궤도 · 소행성대 · 끊긴 호 궤도 · 극궤도 — 가장 풍성
    ring({ a: 2.15, e: 0.06 + H('e1') * 0.06, inc: 0.52 + jit('i1', 0.12), node: H('n1') * 6.283, style: 'dots', speed: 0.95, dir: -1, ph: H('p1') * 6.283, lod: 1, trail: 0.16, alpha: 0.55,
      sats: [{ size: 0.075, off: 0, tint: 0.85, kind: 'spark' }] });
    belt = { r0: 2.55, r1: 2.95, n: 300, h: 0.07, inc: 0.18 + jit('ib', 0.08), node: H('nb') * 6.283, speed: 0.12, lod: 3 };
    ring({ a: 3.35, e: 0.16 + H('e2') * 0.08, inc: -0.24 + jit('i2', 0.1), node: H('n2') * 6.283, style: 'arcs', speed: 0.34, dir: 1, ph: H('p2') * 6.283, lod: 2, trail: 0.1, alpha: 0.42,
      sats: [{ size: 0.15, off: 0, tint: 0.35, kind: 'moon' }, { size: 0.09, off: 3.3, tint: 0.7, kind: 'moon' }] });
    ring({ a: 1.86, e: 0, inc: 1.28 + jit('i3', 0.12), node: H('n3') * 6.283, style: 'solid', speed: 1.5, dir: 1, ph: H('p3') * 6.283, lod: 3, trail: 0.22, alpha: 0.22,
      sats: [{ size: 0.05, off: 0, tint: 1, kind: 'spark' }] });
  } else if (kind === 'subagent') {
    const inc0 = 0.35 + H('i') * 0.5, nd = H('n') * 6.283, ph = H('p') * 6.283, d = sg('d');
    if (type === 'gas') {
      ring({ a: 2.05, e: 0.05, inc: inc0, node: nd, style: 'solid', speed: 0.8, dir: d, ph, lod: 1, trail: 0.18, alpha: 0.4, sats: [{ size: 0.2, off: 0, tint: 0.45, kind: 'moon' }, { size: 0.1, off: 2.6, tint: 0.75, kind: 'moon' }] });
      ring({ a: 2.6, e: 0.12, inc: inc0 + 0.5, node: nd + 1.2, style: 'dots', speed: 0.4, dir: -d, ph: ph + 2, lod: 3, alpha: 0.3, sats: [] });
    } else if (type === 'lava') {
      ring({ a: 2.2, e: 0.32 + H('e') * 0.1, inc: inc0, node: nd, style: 'dash', speed: 0.9, dir: d, ph, lod: 1, trail: 0.28, alpha: 0.42, sats: [{ size: 0.12, off: 0, tint: 0.9, kind: 'spark' }] });
    } else if (type === 'ice') {
      ring({ a: 1.95, e: 0.03, inc: inc0, node: nd, style: 'dots', speed: 0.55, dir: d, ph, lod: 1, trail: 0.12, alpha: 0.5, sats: [{ size: 0.13, off: 0, tint: 0.9, kind: 'moon' }] });
      ring({ a: 2.45, e: 0.08, inc: -inc0 * 0.6, node: nd + 2, style: 'solid', speed: 0.3, dir: d, ph: ph + 1, lod: 3, alpha: 0.2, sats: [{ size: 0.06, off: 0, tint: 1, kind: 'spark' }] });
    } else if (type === 'ringed') {
      // 넓은 납작 고리는 planet-sub.js 가 따로(본체 1.35～2.15), 바깥에 위성 하나
      ring({ a: 2.6, e: 0.1, inc: 0.32 + H('i') * 0.2, node: nd, style: 'arcs', speed: 0.5, dir: d, ph, lod: 2, trail: 0.14, alpha: 0.32, sats: [{ size: 0.14, off: 0, tint: 0.5, kind: 'moon' }] });
    } else if (type === 'binary') {
      // 짝 몸체(planet-sub.js)가 1.75 궤도 — 그 궤도선만, 바깥 점 열
      ring({ a: 1.75, e: 0, inc: 0.18 + H('i') * 0.25, node: nd, style: 'solid', speed: 0.7, dir: d, ph, lod: 1, trail: 0.2, alpha: 0.32, sats: [] });
      ring({ a: 2.5, e: 0.14, inc: inc0 + 0.6, node: nd + 1, style: 'dots', speed: 0.35, dir: -d, ph: ph + 1, lod: 3, alpha: 0.26, sats: [{ size: 0.06, off: 0, tint: 1, kind: 'spark' }] });
    } else if (type === 'swarm') {
      // 위성 군단: 기울기·속도·방향이 다른 작은 궤도 여럿
      for (let i = 0; i < 5; i++) ring({ a: 1.55 + i * 0.22, e: 0.04 + H('e' + i) * 0.1, inc: (H('i' + i) - 0.5) * 2.4, node: H('n' + i) * 6.283, style: i % 2 ? 'arcs' : 'dots', speed: 1.4 - i * 0.18, dir: sg('d' + i), ph: H('p' + i) * 6.283, lod: i < 2 ? 1 : i < 4 ? 2 : 3, trail: 0.1, alpha: 0.2, sats: [{ size: 0.07 + H('s' + i) * 0.05, off: 0, tint: 0.4 + 0.15 * i, kind: 'moon' }] });
    } else if (type === 'comet') {
      ring({ a: 2.1, e: 0.55, inc: inc0, node: nd, style: 'arcs', speed: 0.7, dir: d, ph, lod: 1, trail: 0.3, alpha: 0.3, sats: [{ size: 0.06, off: 0, tint: 1, kind: 'spark' }] });
    } else { // crystal
      ring({ a: 1.9, e: 0, inc: inc0, node: nd, style: 'dash', speed: 0.65, dir: d, ph, lod: 1, trail: 0.1, alpha: 0.4, sats: [{ size: 0.09, off: 0, tint: 1, kind: 'carrier' }, { size: 0.09, off: 3.1416, tint: 1, kind: 'carrier' }] });
      ring({ a: 2.4, e: 0, inc: -inc0, node: nd + 1.6, style: 'dash', speed: 0.4, dir: -d, ph: ph + 1, lod: 3, alpha: 0.24, sats: [] });
    }
  } else if (kind === 'claude-p') {
    ring({ a: 1.9, e: 0.36 + H('e') * 0.1, inc: 0.4 + H('i') * 0.5, node: H('n') * 6.283, style: 'dash', speed: 0.9, dir: sg('d'), ph: H('p') * 6.283, lod: 1, trail: 0.22, alpha: 0.4, sats: [{ size: 0.12, off: 0, tint: 0.8, kind: 'carrier' }] });
  } else if (kind === 'workflow-agent') {
    ring({ a: 1.8, e: 0.08, inc: 0.5 + H('i') * 0.5, node: H('n') * 6.283, style: 'arcs', speed: 1.1, dir: sg('d'), ph: H('p') * 6.283, lod: 1, trail: 0.12, alpha: 0.38, sats: [{ size: 0.1, off: 0, tint: 0.7, kind: 'moon' }, { size: 0.1, off: 3.1416, tint: 0.7, kind: 'moon' }] });
  } else if (kind === 'workflow') {
    // 자이로: 교차한 두 궤도
    const nd = H('n') * 6.283;
    ring({ a: 1.55, e: 0, inc: 0.95, node: nd, style: 'solid', speed: 0.8, dir: 1, ph: 0, lod: 1, trail: 0.15, alpha: 0.32, sats: [{ size: 0.08, off: 0, tint: 0.9, kind: 'spark' }] });
    ring({ a: 1.55, e: 0, inc: -0.95, node: nd, style: 'solid', speed: 0.8, dir: -1, ph: 1.6, lod: 2, trail: 0.15, alpha: 0.32, sats: [{ size: 0.08, off: 0, tint: 0.9, kind: 'spark' }] });
  } else if (kind === 'bash-bg') {
    ring({ a: 1.9, e: 0.1, inc: 0.3 + H('i') * 0.6, node: H('n') * 6.283, style: 'dots', speed: 1.7, dir: sg('d'), ph: H('p') * 6.283, lod: 1, trail: 0.3, alpha: 0.42, sats: [{ size: 0.12, off: 0, tint: 0.9, kind: 'spark' }] });
  } else if (kind === 'monitor') {
    // 레이더: 거의 극궤도 끊긴 호가 빠르게 쓸고 지나감
    ring({ a: 1.75, e: 0, inc: 1.35, node: H('n') * 6.283, style: 'arcs', speed: 1.9, dir: 1, ph: H('p') * 6.283, lod: 1, trail: 0.4, alpha: 0.3, sats: [{ size: 0.1, off: 0, tint: 1, kind: 'spark' }] });
  } else if (kind === 'device') {
    // 배치 장치: 납작한 회전목마 궤도 — G3 운반체 셋은 바깥 회차 고리(최근 회차 칸 + 이번 회차 진행 호, planet-deco DeckRing · 2D planet2d)가 대신한다
    ring({ a: 1.45, e: 0, inc: 0.1, node: 0, style: 'solid', speed: 0.6, dir: 1, ph: H('p') * 6.283, lod: 1, trail: 0.1, alpha: 0.35, sats: [] });
  }
  let extent = 1;
  for (const r of R) extent = Math.max(extent, r.a * (1 + r.e) + Math.max(0, ...r.sats.map((s) => s.size)));
  if (belt) extent = Math.max(extent, belt.r1);
  if (type === 'ringed') extent = Math.max(extent, 2.2);
  if (type === 'comet') extent = Math.max(extent, 2.6);
  if (kind === 'device') extent = Math.max(extent, 2.0); // G3 회차 고리(1.62～1.98)까지
  return { type, rings: R, belt, extent };
}

/** 궤도 위 점: 참 근점 이각 θ → 궤도면 (x, z) (초점 = 몸체 중심). out 을 채워 돌려준다 */
export function orbitPoint(a, e, th, out = { x: 0, z: 0, r: 0 }) {
  const r = (a * (1 - e * e)) / (1 + e * Math.cos(th));
  out.r = r; out.x = r * Math.cos(th); out.z = r * Math.sin(th);
  return out;
}
/** 케플러 둘째 법칙 근사: 근점 가까이 빠르게. dθ/dt 배율 */
export function keplerRate(e, th) {
  const q = 1 + e * Math.cos(th);
  return (q * q) / Math.pow(1 - e * e, 1.5);
}
/** 궤도선 무늬(0..1 둘레 위치 u): 보이면 1, 비면 0 — 3D 셰이더와 2D 가 같은 무늬 */
export function ringPattern(style, u, seed = 0) {
  if (style === 'dash') return ((u * 48) % 1) < 0.55 ? 1 : 0;
  if (style === 'arcs') return ((u * 5 + seed) % 1) < 0.62 ? 1 : 0;
  return 1;
}
/** 완료 정리 연출(초): 이 동안 궤도가 잠깐 밝아지며 안쪽으로 모였다 진정 */
export const SETTLE_S = 1.6;
export function settleK(t) {
  if (!(t >= 0) || t >= SETTLE_S) return 0;
  const k = t / SETTLE_S;
  return Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - k);
}

// ---------------- 작업(Job) 노드 = 주인 둘레의 작은 탐사선 (3D planet-deco.js 가 쓴다, three 없음) ----------------
// 작업 노드는 kind 'bash-bg' + meta.job. 백그라운드 명령 위성(BODY_K['bash-bg'])보다 훨씬 작은 몸체(탐사선 — 상자 몸통 + 태양전지 날개 둘),
// 몸체 둘레에 시청자를 향한 상태 고리(진행 호·대기 차오름·돌림 호·점선·끊긴 고리), 고리 위를 도는 머리 점(작은 위성),
// 주인 중심 원호 한 토막(주인 둘레를 도는 궤도 자취 — 뒤쪽으로 잔광). 색 = job-core 표시 상태(정체가 이김).

/** 작업 탐사선 몸체 배율(그리는 반지름 = RADIUS['bash-bg'] × NODE_SCALE × 이 값). 백그라운드 명령(0.74)보다 작게 */
export const JOB_BODY_K = 0.42;

/** 상태 고리 그리기 방식(셰이더 uMode 와 같은 번호) */
export const JOB_RING = { dash: 0, progress: 1, spin: 2, wait: 3, full: 4, broken: 5, stale: 6 };

/**
 * 표시 상태 번호(job-core JOB_CODE: 0 줄 섬 · 1 진행 · 2 대기 · 3 끝 · 4 실패 · 5 정체) → 모양 규칙.
 *  tok = 색 토큰(scene readTokens 이름), mix = [둘째 토큰, 섞는 비율](정체 = 호박 → 빨강 사이 주황), dim = 배경 쪽으로 흐리게(0..1),
 *  op = 몸체 투명도 배율(끝은 scene 이 이미 흐리게 한다), emis = 기본 발광, ring = 고리 방식, spin = 탐사선 자전(rad/s),
 *  orbit = 머리 점 공전(바퀴/s), tether = 주인 궤도 자취 밝기(0 = 안 그림), blink = 불규칙 깜빡임(정체)
 */
export const JOB_LOOK = [
  { st: 'queued',  tok: 'stopped',   mix: null,            dim: 0.45, op: 0.6,  emis: 0.08, ring: 'dash',   spin: 0.12, orbit: 0.04, tether: 0.25, blink: false },
  { st: 'running', tok: 'skill',     mix: null,            dim: 0,    op: 1,    emis: 0.55, ring: 'spin',   spin: 1.1,  orbit: 0.55, tether: 0.85, blink: false },
  { st: 'waiting', tok: 'flow-call', mix: null,            dim: 0.32, op: 0.78, emis: 0.2,  ring: 'wait',   spin: 0.22, orbit: 0.07, tether: 0.45, blink: false },
  { st: 'done',    tok: 'ok',        mix: null,            dim: 0.12, op: 1,    emis: 0.05, ring: 'full',   spin: 0,    orbit: 0,    tether: 0,    blink: false },
  { st: 'failed',  tok: 'error',     mix: null,            dim: 0,    op: 1,    emis: 0.35, ring: 'broken', spin: 0,    orbit: 0,    tether: 0,    blink: false },
  { st: 'stale',   tok: 'skill',     mix: ['error', 0.45], dim: 0,    op: 1,    emis: 0.35, ring: 'stale',  spin: 0.05, orbit: 0,    tether: 0.55, blink: true },
];

/** 표시 상태 번호 + 진행 비율 → 모양(고리 방식 확정). 진행 중인데 비율이 있으면 진행 호, 없으면 돌림 호 */
export function jobLook(code, progress = null) {
  const L = JOB_LOOK[code] || JOB_LOOK[1];
  const ring = L.ring === 'spin' && progress != null ? 'progress' : L.ring;
  return { ...L, ring, mode: JOB_RING[ring] };
}

const tsMs = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : NaN; };

/**
 * 대기 고리 차오름(0..1): 기다리기 시작한 때(마지막 박동, 없으면 시작 시각) → 재확인 시각(until).
 * until 이 가까울수록 1 에 가깝다. until 이 없으면 null(차오름 없이 천천히 도는 머리 점만).
 */
export function jobWaitFill(job, nowMs) {
  if (!job || !job.until) return null;
  const u = tsMs(job.until);
  if (!Number.isFinite(u) || !Number.isFinite(nowMs)) return null;
  let from = tsMs(job.beatAt);
  if (!Number.isFinite(from)) from = tsMs(job.startedAt);
  if (!Number.isFinite(from) || from >= u) return nowMs >= u ? 1 : 0;
  return Math.max(0, Math.min(1, (nowMs - from) / (u - from)));
}

/**
 * 고리 채움(0..1, 셰이더 uFill): 진행 호 = 진행 비율, 대기 = 차오름, 끝 = 1, 정체·실패 = 진행 비율(없으면 1 — 끊긴 온고리).
 * 돌림 호·점선은 0(채움을 안 씀).
 */
export function jobRingFill(job, code, nowMs, progress = null) {
  const look = jobLook(code, progress);
  switch (look.ring) {
    case 'progress': return progress ?? 0;
    case 'wait': return jobWaitFill(job, nowMs) ?? 0;
    case 'full': return 1;
    case 'stale': case 'broken': return progress ?? 1;
    default: return 0;
  }
}

/** 숫자 해시 → [0,1) (프레임마다 부르는 곳용 — 문자열 해시 hash01 보다 싸다) */
const fhash = (x) => { const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

/**
 * 정체 깜빡임(신호가 끊긴 무전기처럼): 시각 t(초)·씨앗 seed(0..1) → 밝기 배율.
 * 칸 길이가 칸마다 다르고(0.12～0.9초) 켜짐(0.7～1)·꺼짐(0.08～0.2)이 해시로 정해져 박자가 일정하지 않다. 결정적(같은 t·seed = 같은 값).
 * @returns {{ k:number, step:number }} step = 지금 칸 번호(고리 끊긴 자리 무늬를 칸마다 바꾸는 씨앗)
 */
export function jobBlink(t, seed = 0) {
  // 칸 경계: 주기 W 안에서 길이가 해시로 다른 칸을 차례로 쌓는다(주기 번호도 씨앗에 섞어 주기마다 무늬가 다르게)
  const W = 4.0;
  const cyc = Math.floor(t / W);
  let x = t - cyc * W, i = 0;
  for (; i < 31; i++) {
    const len = 0.12 + 0.78 * fhash(cyc * 31.7 + i * 3.1 + seed * 97.3);
    if (x < len) break;
    x -= len;
  }
  const step = cyc * 32 + i;
  const r = fhash(step * 1.37 + seed * 11.1);
  const k = r < 0.38 ? 0.08 + 0.12 * fhash(step + 0.5) : 0.7 + 0.3 * r;
  return { k, step };
}

/** 작업 LOD(탐사선 몸체 화면 반지름 px): 0 = 몸체만, 1 = 상태 고리, 2 = 고리·머리 점·주인 궤도 자취 */
export const JOB_LOD = { RING_PX: 1.6, DETAIL_PX: 4 };
export function jobLod(px) {
  if (!(px >= JOB_LOD.RING_PX)) return 0;
  return px < JOB_LOD.DETAIL_PX ? 1 : 2;
}

/** 상태 고리 치수(몸체 반지름 = 1): 안·바깥 반지름, 머리 점 궤도 반지름·크기. extent = 작업 겉 반지름(홀로그램·맞춤) */
export const JOB_RING_GEO = { R0: 1.5, R1: 1.9, HEAD_R: 1.7, HEAD_S: 0.3, extent: 2.0 };

/**
 * 주인 궤도 자취(주인 중심, 작업을 지나는 원의 한 토막): 주인→작업 벡터 (dx,dy,dz) → { R 반지름, span 반각(rad) }.
 * 토막의 세계 길이를 대략 일정하게(반지름이 크면 각을 줄임, 상한 0.55rad). 너무 가까우면 null.
 */
export function jobTether(dx, dy, dz, len = 2.2) {
  const R = Math.hypot(dx, dy, dz);
  if (!(R > 0.4)) return null;
  return { R, span: Math.min(0.55, len / R) };
}

/** 고리 위 둘레 위치 u(0 = 위, 시계 방향) → 고리 평면 (x, y) 단위 좌표. out 을 채워 돌려준다(셰이더 각도 규칙과 같음) */
export function ringAt(u, out = { x: 0, y: 0 }) {
  const a = u * Math.PI * 2;
  out.x = Math.sin(a); out.y = Math.cos(a);
  return out;
}

// ---------------- 장기 작업 연출 — 공통 바탕(글리프·무게) · 안 A 항로 궤도 (3D planet-deco.js · 2D flat/job2d.js 가 같은 값을 쓴다) ----------------

/** G1 상태 글리프 번호(흐름 jobTop 과 같은 순서): 표시 상태 번호 그대로 — 0 점 셋 · 1 재생 삼각 · 2 모래시계 · 3 체크 · 4 엑스 · 5 느낌표 */
export const JOB_GLYPH = { PX: 6, R: 0.62 }; // PX = 몸체 화면 반지름이 이만큼 넘으면 그림 · R = 글리프 판 반지름(몸체 반지름 배)

/**
 * G2 오래 돈 만큼 무게: 그림 배율(그리는 몸체 반지름 / RADIUS['bash-bg'] × NODE_SCALE). 경과 0 = JOB_BODY_K(0.42),
 * 경과 log₂(1 + t / T0) 로 커져 FULL_MIN(2시간) 이상이면 백그라운드 명령 위성(0.74)에서 멈춘다. 끝난 작업은 끝난 때까지의 경과.
 * 배치 반지름(v.r)은 그대로 — 메시·고리만 키운다(클릭·라벨·홀로그램 자리는 v.r).
 */
export const JOB_WEIGHT = { MIN: JOB_BODY_K, MAX: BODY_K['bash-bg'], T0_MIN: 2, FULL_MIN: 120 };
export function jobWeightK(job, nowMs) {
  const W = JOB_WEIGHT;
  const t0 = tsMs(job && job.startedAt);
  if (!Number.isFinite(t0) || !Number.isFinite(nowMs)) return W.MIN;
  const end = job && (job.state === 'done' || job.state === 'failed') ? tsMs(job.endedAt) : NaN;
  const ms = Math.max(0, (Number.isFinite(end) ? end : nowMs) - t0);
  const k = Math.log2(1 + ms / 60000 / W.T0_MIN) / Math.log2(1 + W.FULL_MIN / W.T0_MIN);
  return W.MIN + (W.MAX - W.MIN) * Math.max(0, Math.min(1, k));
}

/**
 * 안 A 항로 궤도: 작업은 주인 둘레 항로를 나는 탐사선 — 지나온 항로 = 항적(진행), 남은 항로 = 점선, 끝 = 도착 관문.
 * 탐사선은 배치 자리에 그대로 있고 항로가 진행만큼 뒤로 돈다(출발 관문 = −p·S, 도착 관문 = +(1−p)·S, 탐사선 자리 = 0).
 *  SPAN_MAX = 호 각 상한(300°) · LEN_MAX = 호 세계 길이 상한 · PER_OWNER = 주인마다 항로를 그리는 끝나지 않은 작업 수 상한
 *  REMAIN_A = 남은 항로 알파 상한 · PUSH_K = 주인 궤도계 겉(extentOf) × 이 값보다 안쪽이면 항로를 바깥으로 민다
 *  LAP_MS = 비율 모름 작업의 한 바퀴(경과 10분) · DONE_S = 끝 연출(접혀 옅어짐) 길이 · SEG = 3D 꼭짓점 수
 */
export const TRACK = { SPAN_MAX: (300 * Math.PI) / 180, LEN_MAX: 14, PER_OWNER: 4, REMAIN_A: 0.3, PUSH_K: 1.15, LAP_MS: 600000, DONE_S: 3, SEG: 128, MIN_R: 0.4 };

/** 진행 비율이 측정값이 아니라 추정(예상 소요 `expectSec` 의 경과 비율)인가 — 항적·계기를 점선으로 */
export function jobEstimated(job) {
  const p = job && job.progress;
  if (!p || (Number.isFinite(p.n) && Number(p.total) > 0)) return false;
  return Number.isFinite(p.ratio) && !!(job.ext && Number(job.ext.expectSec) > 0);
}

/**
 * 항로를 그릴 작업 고르기: 주인(parentId)마다 끝나지 않은 작업을 시작이 이른 순(오래 돈 것 먼저)으로 PER_OWNER 개.
 * items = [{ id, owner, job }] → Set(id). 끝난 작업은 세지 않는다(끝 연출은 따로).
 */
export function trackSlots(items, perOwner = TRACK.PER_OWNER) {
  const by = new Map();
  for (const it of items || []) {
    if (!it || !it.job || it.job.state === 'done' || it.job.state === 'failed') continue;
    const k = it.owner || '';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(it);
  }
  const out = new Set();
  for (const arr of by.values()) {
    arr.sort((a, b) => (tsMs(a.job.startedAt) || 0) - (tsMs(b.job.startedAt) || 0) || (a.id < b.id ? -1 : 1));
    for (const it of arr.slice(0, perOwner)) out.add(it.id);
  }
  return out;
}

/** 항로 호 각(rad): 각 ≤ SPAN_MAX · 세계 길이 ≤ LEN_MAX. 너무 가까우면 0 */
export function trackSpan(R) { return R > TRACK.MIN_R ? Math.min(TRACK.SPAN_MAX, TRACK.LEN_MAX / R) : 0; }
/** 항로 반지름: 주인–작업 거리, 주인 궤도계 겉(ownerExt, 세계) × PUSH_K 보다 작으면 바깥으로 */
export function trackRadius(dist, ownerExt = 0) { return Math.max(dist, (ownerExt || 0) * TRACK.PUSH_K); }

/** 항로 모양 번호(셰이더 uMode 와 같음) */
export const TRACK_MODE = { none: 0, progress: 1, spin: 2, est: 3, wait: 4, stale: 5, done: 6, failed: 7 };

/**
 * 항로 모델: 표시 상태 번호(code) · 진행(prog, jobProgress) · 시계(nowMs) · 반지름 R →
 *  { mode, span, p(탐사선 자리 0..1), est, etaMs(남은), elapsedMs, startMs, overMs(예상 초과), expectMs, wait(대기 차오름 0..1|null), lap(0..1) }
 * 줄 섬(0)은 'none'(항로 없음). 비율 모름은 탐사선을 가운데(p 0.5)에 두고 항로 전체를 점선으로.
 */
export function trackModel(job, code, nowMs, R, prog = null) {
  const span = trackSpan(R);
  const startMs = tsMs(job && job.startedAt);
  const ended = code === 3 || code === 4;
  const endMs = ended ? tsMs(job && job.endedAt) : NaN;
  const elapsedMs = Number.isFinite(startMs) && Number.isFinite(nowMs) ? Math.max(0, (Number.isFinite(endMs) ? endMs : nowMs) - startMs) : null;
  const est = jobEstimated(job);
  const expectMs = est ? Number(job.ext.expectSec) * 1000 : null;
  let mode = 'none', p = 0.5;
  if (code === 1) { mode = prog == null ? 'spin' : est ? 'est' : 'progress'; p = prog == null ? 0.5 : prog; }
  else if (code === 2) mode = 'wait';
  else if (code === 3) { mode = 'done'; p = 1; }
  else if (code === 4) { mode = 'failed'; p = prog == null ? 0.5 : prog; }
  else if (code === 5) { mode = 'stale'; p = prog == null ? 0.5 : prog; }
  let etaMs = null;
  if (!ended && job && job.eta) { const e = tsMs(job.eta); if (Number.isFinite(e) && Number.isFinite(nowMs)) etaMs = Math.max(0, e - nowMs); }
  const overMs = est && elapsedMs != null ? Math.max(0, elapsedMs - expectMs) : 0;
  const wait = code === 2 ? jobWaitFill(job, nowMs) : null;
  const lap = elapsedMs != null ? (elapsedMs % TRACK.LAP_MS) / TRACK.LAP_MS : 0;
  return { mode, code: TRACK_MODE[mode], span, p: Math.max(0, Math.min(1, p)), est, etaMs, elapsedMs, startMs, overMs, expectMs, wait, lap };
}

/** 관문 각(탐사선 자리 = 0 기준, rad): 출발 = −p·S, 도착 = +(1−p)·S */
export function trackGates(m) { return { a0: -m.p * m.span, a1: (1 - m.p) * m.span }; }

const pad2 = (x) => String(x).padStart(2, '0');
const hhmmOf = (ms) => { const d = new Date(ms); return Number.isFinite(d.getTime()) ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : ''; };
/** 시계 꼴 기간(분 단위): 4:32 · 0:07 · 32분 미만도 0:32 */
const hmOf = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)}:${pad2(m % 60)}`; };
/** 짧은 기간 글자(분 단위): ~13분 · ~1시간 8분 */
function durOf(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return tr('cards.t.m', { n: m });
  const h = Math.floor(m / 60), r = m % 60;
  return r ? tr('cards.t.h', { n: h }) + ' ' + tr('cards.t.m', { n: r }) : tr('cards.t.h', { n: h });
}

/**
 * 관문 글자(분 단위로만 바뀜 — 움직임 줄이기도 같음): { from 출발 관문, to 도착 관문, key 다시 그릴지 비교할 열쇠 }.
 *  진행 = 출발 `출발 12:01` · 도착 `~13분 · 16:32`(ETA 가 있을 때) / 예상 비율 = 도착 `예상 4:32 중 4:20` 또는 `예상 초과 N분`
 *  대기 = 도착 `~16:30`(until) / 비율 모름·정체 = 출발만 / 끝·실패·줄 섬 = 없음
 */
export function trackLabels(job, m, nowMs) {
  let from = '', to = '';
  const live = m.mode === 'progress' || m.mode === 'est' || m.mode === 'spin' || m.mode === 'stale' || m.mode === 'wait';
  if (live && Number.isFinite(m.startMs)) from = tr('cards.track.depart', { t: hhmmOf(m.startMs) });
  if (m.mode === 'progress' && m.etaMs != null) to = tr('cards.track.eta', { d: durOf(m.etaMs), t: hhmmOf(nowMs + m.etaMs) });
  else if (m.mode === 'est' && m.elapsedMs != null) to = m.overMs >= 60000 ? tr('cards.track.over', { d: durOf(m.overMs) }) : tr('cards.track.est', { e: hmOf(m.expectMs), a: hmOf(m.elapsedMs) });
  else if (m.mode === 'wait' && job && job.until) { const u = tsMs(job.until); if (Number.isFinite(u)) to = tr('cards.track.until', { t: hhmmOf(u) }); }
  return { from, to, key: from + '|' + to };
}

// ---------------- 서브에이전트·claude -p 시안 궤도계 (3D planet-variants.js · 2D flat/planet-variants2d.js 가 같은 값을 쓴다) ----------------
// 사용자 결정(2026-10-28): 서브에이전트 = 자기권 빼고 6종, claude -p = 떠돌이 탐사선 빼고 4종을 노드마다 랜덤 배정.
// 단위 = 본체 반지름 v.r(축소 뒤 — 배치·라벨·홀로그램·카메라가 쓰는 값 그대로). 중심 본체는 CORE 배로 작게 그리고 둘레를 시안 궤도계로 채운다.

/** 서브에이전트 시안(A 깎인 바위 띠 · B 결정 파편 왕관 · C 드론 편대 · D 궤도 정거장 · E 접이식 날개 위성 · G 흩어진 고리 조각) */
export const SUB_VARIANTS = ['belt', 'crystal', 'drones', 'station', 'solar', 'arcs'];
/** claude -p 시안(P2 주머니 항성계 · P3 도킹 캡슐 · P4 웜홀 창 · P5 회차 카세트) */
export const CP_VARIANTS = ['pocket', 'capsule', 'wormhole', 'cassette'];
/** 중심 본체 그림 배율(지금 본체 반지름 대비 — 0.26～0.45). claude -p 상자는 한 변 1.45 × 이 값 */
export const VARIANT_CORE = { belt: 0.42, crystal: 0.36, drones: 0.4, station: 0.34, solar: 0.4, arcs: 0.42, pocket: 0.26, capsule: 0.28, wormhole: 0.26, cassette: 0.3 };
/** 궤도계 바깥 반지름(본체 반지름 배) — 홀로그램 자리·항로 밀기·2D 카드 자리. 지금(서브 2.0～2.9 · claude -p 2.9)과 비슷하게 */
export const VARIANT_EXTENT = { belt: 2.45, crystal: 2.45, drones: 2.3, station: 2.2, solar: 2.55, arcs: 2.3, pocket: 2.15, capsule: 2.35, wormhole: 2.2, cassette: 2.1 };
/** 서브 시안의 작은 본체 표면 질감(유형 셰이더 planet-subt 를 재사용 — 유형 8종 중 어울리는 것만 남김) */
export const VARIANT_SKIN = { belt: 'swarm', crystal: 'crystal', drones: 'gas', station: 'ice', solar: 'lava', arcs: 'ringed' };

/** 노드 종류(displayKind) → 시안 묶음. 'sub' | 'cp' | null(시안 없음 — 메인·워크플로·워크플로 에이전트·백그라운드·모니터·배치 장치는 예전 궤도계) */
export function variantFamily(kind) { return kind === 'subagent' ? 'sub' : kind === 'claude-p' ? 'cp' : null; }
export function variantList(fam) { return fam === 'sub' ? SUB_VARIANTS : fam === 'cp' ? CP_VARIANTS : []; }

/** 묶음 안 순열(부모 id 시드 — Fisher-Yates, 결정적) */
export function variantPerm(fam, seed) {
  const L = variantList(fam).slice();
  for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(hash01(seed, 'vp' + i) * (i + 1)); const t = L[i]; L[i] = L[j]; L[j] = t; }
  return L;
}

/** 확인용 강제 시안(URL ?pvar=belt,pocket — 이번 접속만). 없으면 null */
let _force;
export function forcedVariants() {
  if (_force !== undefined) return _force;
  let q = null;
  try { q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('pvar') : null; } catch { q = null; }
  _force = q ? q.split(',').map((s) => s.trim()).filter((s) => SUB_VARIANTS.includes(s) || CP_VARIANTS.includes(s)) : null;
  if (_force && !_force.length) _force = null;
  return _force;
}

/**
 * 시안 배정(결정적): 같은 부모 아래 같은 묶음 형제를 시작 시각(startMs, 같으면 id) 순으로 세운 순번 rank 로
 * 부모 id 시드 순열의 rank 번째(묶음 길이로 돎) — 형제 묶음 길이(서브 6 · claude -p 4)까지는 겹치지 않는다.
 * 부모가 없는 노드(독립 claude -p 루트)는 id 해시로 바로. 형제 = [{ id, kind, startMs }](자기 포함해도 됨).
 * 새로고침·재생·보관함·3D⇄2D 가 같은 형제·시작 순서를 보므로 같은 노드는 같은 시안이다.
 */
export function pickVariant(id, kind, parentId, startMs, sibs = []) {
  const fam = variantFamily(kind);
  if (!fam) return null;
  const L = variantList(fam);
  const F = forcedVariants();
  const forced = F && F.filter((x) => L.includes(x));
  if (!parentId) {
    const i = Math.min(L.length - 1, Math.floor(hash01(id, 'var') * L.length));
    return forced && forced.length ? forced[i % forced.length] : L[i];
  }
  const me = Number.isFinite(startMs) ? startMs : Infinity;
  let rank = 0;
  for (const s of sibs) {
    if (!s || s.id === id || variantFamily(s.kind) !== fam) continue;
    const t = Number.isFinite(s.startMs) ? s.startMs : Infinity;
    if (t < me || (t === me && s.id < id)) rank++;
  }
  if (forced && forced.length) return forced[rank % forced.length];
  return variantPerm(fam, parentId)[rank % L.length];
}

/** 한 페이지 안에서는 처음 정한 시안을 고정(형제가 나중에 지워져도 바뀌지 않게) — 3D·2D 가 같은 표를 쓴다 */
const VAR_MEMO = new Map();
export function variantMemo(id, make) {
  let v = VAR_MEMO.get(id);
  if (v === undefined) { v = make(); if (VAR_MEMO.size > 20000) VAR_MEMO.clear(); VAR_MEMO.set(id, v); }
  return v;
}
/** 노드(뷰의 vis 항목 v: {id, kind, node}) + 형제 목록 → 시안 이름(메모). sibsOf() 는 처음 한 번만 부른다 */
export function variantOfVis(v, sibsOf) {
  if (!variantFamily(v.kind)) return null;
  return variantMemo(v.id, () => {
    const n = v.node || {};
    return pickVariant(v.id, v.kind, n.parentId || null, Date.parse(n.startedAt), n.parentId ? sibsOf() : []);
  });
}

/** 시안 상태 세기: spd = 공전 배율, bright = 밝기, act = 작업 반응(도구 입자·벌어짐), tidy = 완료 정리 자세, err = 붉은 맥동 */
export const VAR_STATE = {
  tool:  { spd: 2.4,  bright: 1.0,  act: 1,    tidy: 0, err: 0 },
  think: { spd: 1.25, bright: 0.72, act: 0.25, tidy: 0, err: 0 },
  wait:  { spd: 0.45, bright: 0.42, act: 0,    tidy: 0, err: 0 },
  error: { spd: 0.25, bright: 0.5,  act: 0,    tidy: 0, err: 1 },
  off:   { spd: 0.04, bright: 0.3,  act: 0,    tidy: 1, err: 0 },
  stop:  { spd: 0.02, bright: 0.2,  act: 0,    tidy: 0, err: 0 },
};
/** 노드 상태 → 시안 상태 이름(완료 = 정리 자세, 중지됨 = 그 자리에서 멈춤·회색) */
export function variantMode(status, tools = 0, dim = false) {
  if (status === 'stopped') return 'stop';
  return planetMode(status, tools, dim);
}
/** 시안 LOD(본체 반지름 v.r 의 화면 px): 0 = 작은 본체 + 윤곽 고리 하나, 1 = 큰 부품(개수 줄임), 2 = 부품 대부분, 3 = 전부(창 불빛·잔조각·셔틀·입자 최대) */
export const VAR_LOD = { ONE_PX: 5, MOST_PX: 11, ALL_PX: 24 };
export function variantLod(px) {
  if (!(px >= VAR_LOD.ONE_PX)) return 0;
  return px < VAR_LOD.MOST_PX ? 1 : px < VAR_LOD.ALL_PX ? 2 : 3;
}

/**
 * P5 회차 카세트 = 그 노드 자신의 도구 호출 회차(기동기 회차는 기동기 G3 고리 몫 — 겹쳐 그리지 않는다).
 * hist = 뷰의 최근 도구 장부(새것이 뒤, {res: null|'ok'|'error'}), open = 열린 도구 수, total = 지금까지 시작한 도구 수(node.counts.tools).
 * → { cur 지금 칸(0..7), cards[8] 코드: 0 빈 틀 · 1 끝(초록) · 2 실패(빨강) · 3 지금(진행 막대) }
 */
export const CASSETTE_N = 8;
export function cassetteModel(hist = [], open = 0, total = 0) {
  const N = CASSETTE_N;
  const n = Math.max(Number(total) || 0, hist.length);
  const cards = new Array(N).fill(0);
  const cur = open > 0 ? (n - 1 + N) % N : n % N; // 열린 도구가 없으면 다음 빈 칸을 가리킨다
  let k = 1;
  for (let i = hist.length - 1; i >= 0 && k < N; i--) {
    const h = hist[i];
    if (!h || h.res == null) continue; // 아직 열린 도구(지금 칸)
    cards[(cur - k + N * 8) % N] = h.res === 'error' ? 2 : 1;
    k++;
  }
  if (open > 0) cards[cur] = 3;
  return { cur, cards };
}
