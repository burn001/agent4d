// Planet 뚜르비용 — 순수 규칙(three·DOM 없음, node --test 대상). 3D(planet-tourb.js)·2D(flat/planet-deco2d.js)가 같은 값을 쓴다.
// 메인 = 자이로(다축) 플라잉 뚜르비용: 고정된 4번 휠(금) 위를 바깥 케이지(스틸 브리지 프레임)가 돌고, 케이지에 달린 이스케이프 피니언이
// 4번 휠과 맞물려 구르며 같은 굴대의 이스케이프 휠을 돌린다(회전비 = 4번 휠 톱니 / 피니언 톱니). 케이지 안에서 안쪽 케이지가
// 기운 축으로 더 빠르게 반대로 돌고, 그 안에서 밸런스 휠이 진동한다.
// 이스케이프먼트: 밸런스가 반 진동할 때마다(한 박) 앵커가 째깍 넘어가며 이스케이프 휠을 톱니 하나만큼 끊어 돌리고,
// 케이지는 그 톱니 하나 / 회전비만큼 나아간다 — 그래서 피니언과 4번 휠의 맞물림이 언제나 맞는다. 서브 = 단일 케이지(같은 박으로 끊어 돎).
// 상태: 도구 호출 = 빠른 박, 생각 = 중간, 대기 = 느린 째깍, 오류 = 거의 멈춤, 완료·중지 = 멈춤(밸런스 진폭 0 으로 잦아듦).

const TAU = Math.PI * 2;

/** 형상(본체 반지름 = 1). 본체(행성 코어)는 CORE_K 로 줄여 무브먼트가 앞에 서게 한다 */
export const TOURB_GEO = {
  CORE_K: 0.46,                                       // 메인 행성 몸체를 이만큼 줄여 그림(클릭 판정·배치는 원래 크기)
  FOURTH_Z: 60, FOURTH_R: 1.28, FOURTH_Y: -0.5, FOURTH_SPOKES: 5, // 고정 4번 휠(금): 톱니·피치 반지름·높이·살
  PINION_Z: 10,                                       // 이스케이프 피니언 톱니(4번 휠과 맞물림)
  CAGE_R: 1.08, CAGE_Y: -0.3, CAGE_ARMS: 3, CAGE_TOP: 0.98, // 바깥 케이지: 아래 테 + 위로 휘어 올라 정수리 보스로 모이는 브리지 팔 3
  INNER_R: 0.86, INNER_TILT: 0.5,                     // 안쪽 케이지: 기운 축 고리 + 위를 넘는 아치(케이지 속 케이지)
  BAL_R: 0.68, BAL_ARMS: 4, BAL_SCREWS: 10,           // 밸런스 휠: 금빛 테 + 살 4 + 타이밍 나사 10
  BAL_SWING: 1.9,                                     // 밸런스 최대 진폭(rad, 약 ±110°)
  ESC_TEETH: 15, ESC_R: 0.25,                         // 이스케이프 휠(갈고리 톱니 15)
  PALLET_SWING: 0.16,                                 // 앵커 흔들림(rad)
  INNER_K: 2.4,                                       // 안쪽 케이지 회전 = 바깥 × 2.4(반대 방향) — 바깥 느리게, 안쪽 빠르게
  OUTER_R: 1.75,                                      // 무브먼트 바깥 끝(이스케이프 휠 끝) — 2D·홀로그램 여유
  SUB_R: 1.2, SUB_ARMS: 3,                            // 서브 단일 케이지
};
/** 4번 휠 / 피니언 회전비. 이스케이프 휠 각 = 케이지 각 × RATIO(케이지 좌표에서) */
export const RATIO = TOURB_GEO.FOURTH_Z / TOURB_GEO.PINION_Z;
const TOOTH = TAU / TOURB_GEO.ESC_TEETH;
const mk = (beat, amp) => ({ beat, cage: +((beat * TOOTH) / RATIO).toFixed(4), amp });
/** 상태 → 박(Hz, 한 박 = 밸런스 반 진동)·바깥 케이지 평균 회전(rad/s, = 박 × 톱니 / 회전비)·밸런스 진폭(최대 대비) */
export const TOURB = {
  tool: mk(5.0, 1.0),
  think: mk(3.0, 0.8),
  wait: mk(1.2, 0.5),
  error: mk(0.5, 0.25),
  off: { beat: 0, cage: 0, amp: 0 },
};
/** 한 박 안에서 끊어 도는 정도: 박 처음 0.2 동안 빠르게(ease-out), 나머지는 멈춤 — '째깍' */
export const TICK_FRAC = 0.2;
export function tickEase(f) {
  if (!(f > 0)) return 0;
  if (f >= TICK_FRAC) return 1;
  const k = f / TICK_FRAC;
  return 1 - (1 - k) * (1 - k) * (1 - k);
}
/** 째깍 직후 반동(이스케이프 휠·앵커가 멈춤 면에 부딪혀 살짝 되튐) — 박 위상 f, 결과 = 톱니 몫(±) */
export const KICK = { AMP: 0.09, LEN: 0.22, HZ: 2.5 };
export function tickKick(f) {
  const u = f - TICK_FRAC;
  if (!(u > 0) || u >= KICK.LEN) return 0;
  const k = u / KICK.LEN;
  return -KICK.AMP * Math.sin(k * Math.PI * KICK.HZ) * (1 - k) * (1 - k);
}
/** LOD(본체 화면 반지름 px): 0 = 몸체만, 1 = 실루엣(케이지 테·브리지 팔·4번 휠 톱니), 2 = 기어 트레인·안쪽 케이지·밸런스 테,
 *  3 = 전부(나사·보석·헤어스프링·앵커·밸런스 나사·살) */
export const TOURB_LOD = { HIDE_PX: 3, GEAR_PX: 8, DETAIL_PX: 18, SUB_PX: 7 };
export function tourbLod(px) { return !(px >= TOURB_LOD.HIDE_PX) ? 0 : px < TOURB_LOD.GEAR_PX ? 1 : px < TOURB_LOD.DETAIL_PX ? 2 : 3; }

/**
 * 이스케이프먼트 상태(노드마다 하나). step(dt, mode) → this(값 읽기).
 *  bal    밸런스 각(rad) — 진폭 × sin(박 위상 π)
 *  esc    이스케이프 휠 각(케이지 좌표) — 박마다 톱니 하나(2π/ESC_TEETH)씩 째깍
 *  kick   째깍 직후 반동(rad, 휠·앵커에 더함 — esc 에는 안 들어감)
 *  pallet 앵커 각 — 박마다 좌우로 넘어감(넘어가는 순간만 빠르게)
 *  cage   바깥 케이지 각 = 기준 + esc / RATIO(피니언이 4번 휠 위를 구른 만큼)
 *  cage2  안쪽 케이지 각 — (cage − 기준) × INNER_K(반대 방향)
 *  ticks  지금까지 박 수, tick = 이번 step 에 박이 넘어갔는지
 * 상태가 바뀌면 박·진폭은 지수 보간(초당 rate)으로 넘어가 끊김 없이 빨라지고 느려진다. 'off' 면 진폭이 잦아들고 멈춘다.
 */
export class Escapement {
  constructor(seed = 0) {
    this.ph = seed * 7.3 % 1;     // 박 위상(박 단위 누적)
    this.beat = 0; this.cageRate = 0; this.amp = 0;
    this.base = seed * TAU;        // 케이지 기준 각
    this.ticks = Math.floor(this.ph);
    this.tick = false;
    this.bal = 0; this.esc = 0; this.kick = 0; this.pallet = 0; this.cage = this.base; this.cage2 = 0;
  }
  step(dt, mode, { rate = 2.5, reduced = false } = {}) {
    const T = TOURB[mode] || TOURB.wait;
    const k = 1 - Math.exp(-rate * Math.max(0, dt));
    const kb = reduced ? 0.2 : 1;
    this.beat += (T.beat * kb - this.beat) * k;
    this.cageRate = (this.beat * TOOTH) / RATIO;
    this.amp += (T.amp - this.amp) * k;
    if (mode === 'off' && this.beat < 0.05) this.beat = 0;
    const before = Math.floor(this.ph);
    this.ph += Math.max(0, dt) * this.beat;
    const n = Math.floor(this.ph), f = this.ph - n;
    this.tick = n !== before;
    if (this.tick) this.ticks += n - before;
    const e = tickEase(f);
    this.esc = (this.ticks + e) * TOOTH;
    this.kick = this.beat > 0.05 ? tickKick(f) * TOOTH * Math.min(1, this.amp * 1.5) : 0;
    // 밸런스: 한 박 = 반 진동(위상 π). 진폭이 0 이면 제자리
    this.bal = TOURB_GEO.BAL_SWING * this.amp * Math.sin(Math.PI * this.ph);
    // 앵커: 박마다 좌우 교대, 넘어가는 순간(박 처음 TICK_FRAC)만 움직임
    const side = this.ticks % 2 === 0 ? 1 : -1;
    this.pallet = TOURB_GEO.PALLET_SWING * side * (2 * e - 1) * Math.min(1, this.amp * 2);
    this.cage = this.base + this.esc / RATIO;
    this.cage2 = -(this.cage - this.base) * TOURB_GEO.INNER_K;
    return this;
  }
}

/** 피니언 각(케이지 좌표): 4번 휠과 맞물리도록 위상까지 맞춘 값. aE = 피니언 굴대 방위(케이지 좌표), cage = 케이지 각(기준 포함) */
export function pinionAngle(cage, aE) {
  const p4 = TAU / TOURB_GEO.FOURTH_Z;
  return aE + Math.PI + RATIO * (cage + aE - 0.5 * p4);
}
/** 기어 모듈(피치 반지름 = 모듈 × 톱니 / 2)과 피니언 굴대 거리 */
export const GEAR_M = (2 * TOURB_GEO.FOURTH_R) / TOURB_GEO.FOURTH_Z;
export const PINION_R = (GEAR_M * TOURB_GEO.PINION_Z) / 2;
export const ESC_ARBOR = TOURB_GEO.FOURTH_R + PINION_R;

/** 2D 위에서 본 바퀴의 살·나사 각(돌린 각 a, 개수 n, 시작 위상 p) */
export function spokeAngles(a, n, p = 0, out = []) { out.length = 0; for (let i = 0; i < n; i++) out.push(a + p + (i * TAU) / n); return out; }

// ---------- 추론 effort — Planet 모양 규칙(3D planet-tourb.js·2D flat/planet-deco2d.js 가 같은 값을 쓴다) ----------
// 시각 단계 4개(low · medium · high · xhigh·max — xhigh 와 max 는 같은 모습, effort-core EFFORT_TIER).
// 서브에이전트 = 단일 케이지 자오선 호 수(EFFORT.ARCS: 2 · 3 · 4 · 6, 미상 = 지금 3) · 맨 위 확정 = 안쪽 케이지 고리 하나 더(반대로 째깍, 닫힘).
// 케이지가 없는 claude -p·워크플로 에이전트 = 적도 바로 밖 가는 고리 위 보석 알 수(= 단계 1～4), 맨 위 확정 = 고리가 잉크로 밝아짐(닫힘).
// 요청값만(응답 전) = 늘어날(또는 빠질) 호를 40% 투명 · 보석은 받침(베젤)만. 단계 표·LOD·잉크는 effort-core.mjs(EFFORT·effortLod·effortInk).
/** 형상(서브 케이지는 TOURB_GEO.SUB_R 기준 단위, 보석 고리는 고리 반지름 = 1) */
export const TOURB_EFF = {
  ARC_MAX: 6,          // 케이지 지오메트리에 미리 만들어 두는 호 수(쓰지 않는 호는 셰이더가 접음)
  ARC_BASE: 3,         // 미상·medium 의 호 수(지금 모습)
  HOLLOW_A: 0.4,       // 요청 상태의 늘어날 호·안쪽 케이지 투명도
  INNER_R: 1.08,       // 서브 안쪽 케이지 고리(작은 본체 1 과 바깥 테 1.2 사이 — 몸체 밖)
  INNER_TILT: 0.5,     // 안쪽 고리 기울기(rad, 메인 TOURB_GEO.INNER_TILT 와 같은 감각)
  INNER_TAG: 7,        // 정점 꼬리표: 0～5 = 호(팔·발 나사), 7 = 안쪽 고리, −1 = 그 밖(테·톱니·루비)
  GLINT_LEN: 0.14,     // 맨 위 단계 반짝임: 주기(EFFORT.GLINT_MS) 가운데 이만큼 동안 안쪽 고리를 따라 한 바퀴
  GEM_N: 4,            // 보석 자리(시각 단계 수)
  GEM_STEP: (2 * Math.PI) / 9, // 보석 간격(40° — 네 알이면 앞쪽 120°, 흐름 눈금 간격과 같음)
  GEM_D: 0.11,         // 보석 지름(고리 반지름 배)
  RING_W: 0.03,        // 보석 고리 굵기(고리 반지름 배)
  GEM_RING: { 'claude-p': 0.62, 'workflow-agent': 1.22 }, // 보석 고리 반지름(본체 반지름 배 — claude -p 는 작은 본체 둘레, 워크플로 에이전트는 팔면체 둘레)
};
/** 꾸밈 없음(미상·대상 아님·LOD 0) = 지금 모습 */
export const TOURB_EFF_NONE = Object.freeze({ arcs: TOURB_EFF.ARC_BASE, lo: TOURB_EFF.ARC_MAX, inner: 0, gems: 0, hollow: 0, ring: 0 });
/**
 * effortGlyph 결과(g, 없으면 null) + effortLod 단계(lod 0 숨김 · 1 채운 칸만 · 2 전부) + 호 수 표(EFFORT.ARCS) → Planet 목표값(보간 전).
 *  arcs  케이지 호 수(2～6) · lo 이 번호부터의 호는 HOLLOW_A 투명(확정 = ARC_MAX 라 없음)
 *  inner 안쪽 케이지 불투명도(0 · 맨 위 요청 HOLLOW_A · 맨 위 확정 1) · gems 보석 수(0～4) · hollow 보석이 받침만(요청 상태)
 *  ring  보석 고리(0 숨김 · 0.5 dim · 1 잉크 = 맨 위 닫힘)
 * LOD 1 은 채운 칸만: 요청 상태(속 빈 칸)·안쪽 케이지·보석 고리(닫힘·빈 자리)를 빼고 확정된 호·보석만.
 */
export function tourbEffort(g, lod, arcsTable) {
  if (!g || !(lod >= 1) || !(g.level >= 1)) return TOURB_EFF_NONE;
  const n = arcsTable[g.level];
  if (g.confirmed) return { arcs: n, lo: TOURB_EFF.ARC_MAX, inner: g.closed && lod >= 2 ? 1 : 0, gems: g.level, hollow: 0, ring: lod >= 2 ? (g.closed ? 1 : 0.5) : 0 };
  if (lod < 2) return TOURB_EFF_NONE;
  const base = TOURB_EFF.ARC_BASE;
  return { arcs: Math.max(n, base), lo: Math.min(n, base), inner: g.top ? TOURB_EFF.HOLLOW_A : 0, gems: g.level, hollow: 1, ring: 0.5 };
}
/** 케이지 호 i 의 방위(rad, 케이지 좌표) — 호 수 c(보간 중 소수)로 고르게(360°/c). 셰이더와 같은 식 */
export const cageArcAngle = (i, c) => (i * TAU) / Math.max(1, c);
/** 케이지 호 i 의 불투명도: 호 수 c 안에서 차오름(소수 = 반쯤) × 요청 상태 lo 이상이면 HOLLOW_A. 셰이더와 같은 식 */
export function cageArcAlpha(i, c, lo = TOURB_EFF.ARC_MAX) {
  const f = Math.min(1, Math.max(0, c - i));
  return i >= lo ? f * TOURB_EFF.HOLLOW_A : f;
}
/** 보석 j 의 방위(정면 = 0 기준 ±, rad) — 보석 수 c(보간 중 소수)를 가운데 맞춤. 셰이더와 같은 식 */
export const gemAngle = (j, c) => (j - (Math.max(1, c) - 1) / 2) * TOURB_EFF.GEM_STEP;
/** 보석 j 의 불투명도(차오름) — 요청 상태면 보석 대신 받침만(그리는 쪽이 고름) */
export const gemAlpha = (j, c) => Math.min(1, Math.max(0, c - j));
/** 맨 위 단계 반짝임 위상(0～1, 반짝이는 동안만) 또는 −1. nowMs·seed(0～1)·주기 ms */
export function effortGlint(nowMs, seed, periodMs) {
  if (!(periodMs > 0)) return -1;
  const u = (((nowMs / periodMs + seed) % 1) + 1) % 1;
  return u < TOURB_EFF.GLINT_LEN ? u / TOURB_EFF.GLINT_LEN : -1;
}
