// 【평면도(flat2d) 담당】 복셀 연구소 2D 평면도의 순수 기하·모양 계산 — three·DOM·캔버스 없음, node --test 대상.
// flat/lab2d.js(Lab2DView)·flat/lab2d-platform.js·flat/lab2d-rigs.js 가 그리기 전에 쓴다. 좌표는 lab-const.mjs 그대로(세계 x·z, 방위 θ 도).
//
// 화면 방향: 평면도는 위에서 본 x → 오른쪽, z → 아래(FlatView._X·_Y). 방위 θ 점 = (sinθ, cosθ) 이므로 캔버스 각 φ = 90° − θ
// (canvasAng). θ 가 커지면 캔버스에서는 시계 반대(anticlockwise = true).
//
// export
//   canvasAng(θ)                          방위(도) → 캔버스 각(라디안)
//   quadXZ(x, z, w, d, θ, out)            방위 θ 자리 직사각형 네 꼭짓점(세계) — w = 접선(가로), d = 반지름 방향(깊이). 3D BoxBatch ry=θ 와 같은 축
//   wallArcs(rW)                          외벽 원호 [{th0, th1}] — 출입문 틈(DOOR_W)만 비움
//   bridgeRects(bridge)                   브리지 덱·경사로 둘·콘솔 [{x, z, w, d, theta, kind}] (bridgeFrame 기준)
//   facilityQuad(spots)                   시설 자리 줄 → 시설 직사각형 {x, z, w, d, theta}(사람이 보는 쪽 0.75 앞)
//   RIG_GLYPH · rigBlink(state, t, seed)  기자재 종류 글리프 · 표시등 밝기(3D lab-rigs.js drawRig 와 같은 규칙)
//   rigLook(node, kind, nowMs, isLight, t, seed, reduced) → {state, kind, glyph, body, trim, panel, ring, gauge, blink, anim}(모듈 재사용 객체 — 다음 호출 전까지만 유효)
//   nearestHit(hits, x, y, r)             화면 집기(지난 그리기 기준점 중 가장 가까운 것)
import { DEG, LAB } from './lab-const.mjs';
import { RIG_KINDS, RIG_HEX, rigState, rigGauge } from './lab-rig-core.mjs';

export const canvasAng = (thetaDeg) => (90 - thetaDeg) * DEG;

/** 방위 θ 자리 직사각형(세계 꼭짓점 8 수 [x0,z0,…]). 접선 단위 e = (cosθ, −sinθ), 반지름 단위 r = (sinθ, cosθ) */
export function quadXZ(x, z, w, d, thetaDeg, out = new Array(8)) {
  const a = thetaDeg * DEG, s = Math.sin(a), c = Math.cos(a);
  const ex = c * w / 2, ez = -s * w / 2, rx = s * d / 2, rz = c * d / 2;
  out[0] = x - ex - rx; out[1] = z - ez - rz;
  out[2] = x + ex - rx; out[3] = z + ez - rz;
  out[4] = x + ex + rx; out[5] = z + ez + rz;
  out[6] = x - ex + rx; out[7] = z - ez + rz;
  return out;
}

/** 외벽 원호(출입문 틈 하나). th0 < th1, 둘 다 도 */
export function wallArcs(rW) {
  const g = ((LAB.WALL.DOOR_W / 2) / rW) / DEG, d = LAB.FRONT.DOOR;
  return [{ th0: d + g, th1: d + 360 - g }];
}

/** 브리지 덱·경사로·콘솔(평면 직사각형). bridge = bridgeFrame(…) (room.lab.bridge) */
export function bridgeRects(bridge) {
  if (!bridge) return [];
  const B = LAB.BRIDGE, th = bridge.theta, out = [];
  const at = (u, v) => ({ x: bridge.c.x + bridge.eu.x * u + bridge.ev.x * v, z: bridge.c.z + bridge.eu.z * u + bridge.ev.z * v });
  const c = at(0, 0);
  out.push({ kind: 'deck', x: c.x, z: c.z, w: B.W, d: B.D, theta: th });
  for (const s of [-1, 1]) {
    const p = at(-B.D / 2 + B.RAMP_W / 2, s * (B.W / 2 + B.RAMP_L / 2));
    out.push({ kind: 'ramp', side: s, x: p.x, z: p.z, w: B.RAMP_L, d: B.RAMP_W, theta: th });
  }
  const k = at(B.CONSOLE_U, 0);
  out.push({ kind: 'console', x: k.x, z: k.z, w: B.CONSOLE_W, d: B.CONSOLE_D, theta: th });
  return out;
}

/** 시설 자리 줄 → 시설 판(자리들이 보는 쪽으로 0.75 앞, 줄 길이 + 0.8, 깊이 0.6) */
export function facilityQuad(spots, depth = 0.6) {
  if (!spots || !spots.length) return null;
  let sx = 0, sz = 0;
  for (const p of spots) { sx += p.x; sz += p.z; }
  sx /= spots.length; sz /= spots.length;
  const f = spots[0].face || 0, fx = Math.sin(f), fz = Math.cos(f);
  let len = 0;
  for (const p of spots) len = Math.max(len, Math.hypot(p.x - sx, p.z - sz) * 2);
  // 판의 '반지름 방향' = 바라보는 방향 → 방위 θ = atan2(fx, fz)
  const theta = Math.atan2(fx, fz) / DEG;
  return { x: sx + fx * 0.75, z: sz + fz * 0.75, w: len + 0.8, d: depth, theta };
}

/** 기자재 종류 글리프(평면도 원 아이콘 가운데) */
export const RIG_GLYPH = Object.freeze({ tests: '⚗', reactor: '⚛', tank: '⛁', antenna: '⌁', scope: '◎', incubator: '⧗', oscillo: '∿', dispenser: '⚙', meter: '◔', sequencer: '▦' });

/** 표시등 밝기 0..1 — 3D drawRig 와 같은 깜빡임(진행 = 숨쉬기, 실패 = 빠른 깜빡, 정체 = 두 박자, 대기 = 느린 숨) */
export function rigBlink(state, t = 0, seed = 0) {
  switch (state) {
    case 'run': return 0.6 + 0.4 * Math.sin(t * 5 + seed);
    case 'fail': return Math.sin(t * 14) > 0 ? 1 : 0.25;
    case 'stale': return (((t % 1.8) + 1.8) % 1.8) < 0.5 ? 1 : 0.35;
    case 'wait': return 0.55 + 0.25 * Math.sin(t * 1.6);
    case 'done': return 1;
    default: return 0.25;
  }
}

/** 움직이는 상태인가(이때만 다음 프레임이 필요 — 움직임 줄이기면 늘 false) */
const ANIM = new Set(['run', 'fail', 'stale', 'wait']);

const _look = { state: 'stop', kind: 'meter', glyph: '', body: '', trim: '', panel: '', ring: '', gauge: null, blink: 0, anim: false };
/**
 * 기자재 한 대의 2D 모양 값(순수). kind 는 배치가 정한 pos.rigKind(없으면 'meter').
 * gauge = rigGauge(0..1 | null — null 이면 도는 점). reduced 면 깜빡임 없이 상태색 그대로.
 * 반환은 모듈 재사용 객체(프레임 할당 0) — 다음 호출이 덮어쓰므로 그 자리에서 읽고 버린다.
 */
export function rigLook(node, kind, nowMs, isLight = false, t = 0, seed = 0, reduced = false) {
  const k = RIG_KINDS.includes(kind) ? kind : 'meter';
  const H = RIG_HEX[isLight ? 'light' : 'dark'];
  const state = rigState(node, nowMs);
  const g = rigGauge(node, k, nowMs);
  const L = _look;
  L.state = state; L.kind = k; L.glyph = RIG_GLYPH[k]; L.body = H.body; L.trim = H.trim; L.panel = H.panel; L.ring = H[state] || H.stop;
  L.gauge = Number.isFinite(g) ? Math.max(0, Math.min(1, g)) : null;
  L.blink = reduced ? (state === 'stop' ? 0.4 : 1) : rigBlink(state, t, seed);
  L.anim = !reduced && ANIM.has(state);
  return L;
}

/** 지난 그리기 집기 기준점 [{x, y, …}](화면 px) 중 (x, y) 에서 r 안 가장 가까운 것 */
export function nearestHit(hits, x, y, r = 14) {
  let best = null, bd = r * r;
  for (const h of hits || []) { const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d <= bd) { bd = d; best = h; } }
  return best;
}

/**
 * 전체 보기 섬 이름표 겹침 거르기(순수, 연구소 2D 만 — Lab2DView.islandDeclutter): 우선순위 높은 이름표부터 놓고,
 * 이미 놓인 것과 겹치는 이름표는 숨김(out[i] = true). 직전에 숨겼던 이름표는 여유를 더 둬야 다시 보임(줌 경계에서 깜빡임 방지).
 * @param {Array<{x0,y0,x1,y1,pri,was}>} items 화면 사각형(px)·우선순위(클수록 먼저)·직전 숨김 여부
 * @param {{pad?:number, back?:number, order?:number[], out?:boolean[]}} opts pad = 겹침 여유 px, back = 숨겼던 것이 다시 보일 때 더할 여유 px
 * @returns {boolean[]} 숨김 여부(items 순서)
 */
export function declutterIslandSigns(items, { pad = 2, back = 4, order = [], out = [] } = {}) {
  const n = items ? items.length : 0;
  order.length = 0; out.length = n;
  for (let i = 0; i < n; i++) { order.push(i); out[i] = false; }
  order.sort((a, b) => (items[b].pri - items[a].pri) || (a - b));
  for (let oi = 0; oi < n; oi++) {
    const i = order[oi], A = items[i], g = pad + (A.was ? back : 0);
    for (let oj = 0; oj < oi; oj++) {
      const j = order[oj];
      if (out[j]) continue;
      const B = items[j];
      if (A.x0 - g < B.x1 && A.x1 + g > B.x0 && A.y0 - g < B.y1 && A.y1 + g > B.y0) { out[i] = true; break; }
    }
  }
  return out;
}

/** 섬 이름표 우선순위(클수록 먼저 놓임): 고른 프로젝트 > 실행 중(live·busy) > 활동 > 비활성 아님 > 섬이 큼 */
export function islandSignPri(e, focusPid) {
  if (!e) return 0;
  return (e.projectId != null && e.projectId === focusPid ? 1e6 : 0) + (e.live || e.busy ? 1e5 : 0) + (e.active ? 1e4 : 0) + (e.inactive ? 0 : 1e3) + Math.min(999, Math.max(0, e.r || 0));
}
