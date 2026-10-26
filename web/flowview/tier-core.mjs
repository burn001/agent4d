// 흐름(Flow) 3D 높이 계층 — 순수 함수(three·DOM 없음). 2D(flat/flow2d.js)는 쓰지 않는다(평면 그대로).
// 메인(트리 깊이 0)이 가장 높고, 서브에이전트·워크플로 에이전트·기동기·러너·claude -p 회차·백그라운드 명령은 깊이마다 한 층씩 아래.
// 바닥(작업 대상 층 · 섬 판 · 바닥 격자)은 ART.FLOOR_Y 에 고정 — 에이전트 층은 그 위에 떠 있다(대상 층을 꺼도 같은 높이).
// 층 간격은 섬 크기(배치 반경)에 비례하되 노드 크기(칩 반지름) 배수로 아래·위를 묶는다. 깊을수록 간격이 RATIO 배로 줄고,
// 가장 낮은 층도 바닥에서 CLEAR 만큼은 떠 있다(그보다 깊은 노드는 같은 높이).

import { ART } from '../artifact-core.mjs';

export const TIER = {
  FLOOR: ART.FLOOR_Y, // 바닥 높이 = 작업 대상 층 높이(−2.2, 섬 원판 −2.5 바로 위)
  CLEAR: 3.2,       // 가장 낮은 층 ↔ 바닥 최소 틈
  RATIO: 0.7,       // 깊이마다 간격 감소(1층 g, 2층 0.7g, 3층 0.49g …)
  LEVELS: 3,        // 메인 높이 = 바닥 + CLEAR + g·(1 + r + r²) — 깊이 3 이 꼭 가장 낮은 층에 닿는다
  ISLAND_K: 0.16,   // 간격 = 섬 반경 × 0.16 …
  NODE_MIN: 2.0,    // … 단, 칩 반지름(서브에이전트 기준)의 2배 이상
  NODE_MAX: 2.6,    // … 2.6배 이하(높이 쌓임이 비스듬한 카메라에서 이웃 섬으로 투영되지 않게 — 와 같은 이유)
  CHIP_R: 2.32,     // 서브에이전트 칩 반지름(RADIUS.subagent 1.6 × 흐름 칩 배율 1.45)
  STEP: 0.5,        // 간격은 0.5 단위로 — 섬이 조금 커질 때마다 모든 층이 출렁이지 않게
};

/** 층 간격(세계 단위): 섬(단일 세션이면 배치 전체) 반경 islandR 비례, 칩 반지름 배수로 묶고 STEP 단위로 반올림 */
export function tierGap(islandR, o = TIER) {
  const lo = o.NODE_MIN * o.CHIP_R, hi = o.NODE_MAX * o.CHIP_R;
  const g = Math.max(lo, Math.min(hi, (Number(islandR) || 0) * o.ISLAND_K));
  return Math.round(g / o.STEP) * o.STEP;
}

/** 깊이 d(0 = 메인) 의 높이. 메인 = 바닥 + CLEAR + g·Σ r^i(i<LEVELS), 깊이마다 g·r^(d−1) 씩 내려가고 바닥 + CLEAR 아래로는 안 감 */
export function tierY(depth, gap, o = TIER) {
  const d = Math.max(0, depth | 0);
  let top = 0;
  for (let i = 0; i < o.LEVELS; i++) top += gap * Math.pow(o.RATIO, i);
  const low = o.FLOOR + o.CLEAR;
  let drop = 0;
  for (let i = 0; i < d; i++) drop += gap * Math.pow(o.RATIO, i);
  return Math.max(low, low + top - drop);
}

/**
 * 트리 깊이: parentOf(id) → 부모 id | null. 부모가 끊긴 노드(분리 기동기)는 hostOf(id)(띄운 노드) 아래 한 층.
 * ids 순서와 무관, 고리·깊이 64 넘음은 거기서 끊는다. 반환 Map<id, depth>
 */
export function tierDepths(ids, parentOf, hostOf = () => null) {
  const out = new Map();
  const depth = (id, guard) => {
    if (out.has(id)) return out.get(id);
    if (guard > 64) return 0;
    let p = parentOf(id);
    let d = 0;
    if (p) d = depth(p, guard + 1) + 1;
    else { const h = hostOf(id); if (h && h !== id) d = depth(h, guard + 1) + 1; }
    out.set(id, d);
    return d;
  };
  for (const id of ids) depth(id, 0);
  return out;
}

/** 아래층일수록 어둡게·옅게(셰이더 iD.y): 깊이 0 → 0, 깊이마다 0.14, 최대 0.42 */
export const tierDim = (depth) => Math.min(0.42, Math.max(0, depth) * 0.14);

/** 섬 팩 배치(packView hy)에 넘길 높이 범위: 메인 높이 − 바닥 */
export const tierSpan = (gap, o = TIER) => tierY(0, gap, o) - o.FLOOR;

// ───── 세워 둔 장치(배치 장치 · 사용자 콘솔)의 방향 — 앞면이 카메라 쪽 ─────
// 카메라를 늘 따라 도는 빌보드가 아니라 '놓인 물건': 카메라 방위가 HYST 넘게 벗어날 때만 그 방위로 부드럽게 돈다
// (쉬는 동안 궤도 ±16° 안에서는 그대로 서 있어 옆면·시차가 보이고, 손으로 크게 돌리면 다시 앞면을 보인다).
// OFFSET 만큼 비켜 서서 한쪽 옆면(두께)이 보이게 한다. yaw 0 = 앞면이 +z, 양수면 +x 쪽으로 돈다.
export const STAND = {
  HYST: 0.52,     // 이만큼(rad, ≈30°) 벗어나면 돌기 시작
  RATE: 4.2,      // 지수 속도(1/s) — 0.7초에 거의 다
  OFFSET: 0.3,    // 비켜 선 각(rad, ≈17°)
  DEV_HY: 0.82,   // 배치 장치 반높이(칩 배율 단위, 셰이더 devD 세로 0.82 와 같음)
  DEV_HX: 1.45,   // 배치 장치 반폭
};
const wrapPi = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
/** 점 (px, pz) 에서 카메라 (cx, cz) 를 보는 방위(yaw) */
export const yawToward = (px, pz, cx, cz) => Math.atan2(cx - px, cz - pz);
/**
 * 방향 한 걸음(st 를 고쳐 씀): st = {yaw, turning} | 빈 객체(처음이면 바로 목표). target = 카메라 방위 + OFFSET.
 * reduced(움직임 줄이기)면 벗어날 때 바로 맞춤. 반환 st.yaw
 */
export function standYawStep(st, target, dt, reduced = false, o = STAND) {
  if (st.yaw == null || !Number.isFinite(st.yaw)) { st.yaw = target; st.turning = false; return st.yaw; }
  const d = wrapPi(target - st.yaw);
  if (!st.turning && Math.abs(d) > o.HYST) st.turning = true;
  if (st.turning) {
    if (reduced || Math.abs(d) < 0.01) { st.yaw = target; st.turning = false; }
    else st.yaw = wrapPi(st.yaw + d * (1 - Math.exp(-Math.max(0, dt) * o.RATE)));
  }
  return st.yaw;
}
