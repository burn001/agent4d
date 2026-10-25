// Planet 행성 연출 규칙(순수, three·DOM 없음).
// 메인 = 기계 행성(패널 이음선·궤도 링·기어 띠·해치·안테나·이음선 사이 코어 광), 서브에이전트 = 대기층·구름 띠·작은 위성.
// 3D(planet-deco.js)와 2D(flat/planet-deco2d.js)가 같은 값을 쓴다.

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
    // 배치 장치: 납작한 회전목마 궤도 + 같은 간격 운반체 셋
    ring({ a: 1.45, e: 0, inc: 0.1, node: 0, style: 'solid', speed: 0.6, dir: 1, ph: H('p') * 6.283, lod: 1, trail: 0.1, alpha: 0.35,
      sats: [0, 2.094, 4.189].map((off) => ({ size: 0.07, off, tint: 0.9, kind: 'carrier' })) });
  }
  let extent = 1;
  for (const r of R) extent = Math.max(extent, r.a * (1 + r.e) + Math.max(0, ...r.sats.map((s) => s.size)));
  if (belt) extent = Math.max(extent, belt.r1);
  if (type === 'ringed') extent = Math.max(extent, 2.2);
  if (type === 'comet') extent = Math.max(extent, 2.6);
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
