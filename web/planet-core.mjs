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
