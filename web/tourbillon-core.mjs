// Planet 뚜르비용 — 순수 규칙(three·DOM 없음, node --test 대상). 3D(planet-tourb.js)·2D(flat/planet-deco2d.js)가 같은 값을 쓴다.
// 메인 = 다축(케이지 속 케이지) 뚜르비용: 바깥 케이지(세로축) 안에 안쪽 케이지(기운 축)가 돌고, 그 안에서 밸런스 휠이 진동한다.
// 이스케이프먼트: 밸런스가 반 진동할 때마다(한 박) 앵커가 째깍 넘어가며 이스케이프 휠을 톱니 하나만큼 끊어 돌리고,
// 케이지도 그 박에 맞춰 조금씩 끊어 나아간다(실제 뚜르비용의 초침처럼). 서브 = 단일 케이지(같은 박으로 끊어 돎).
// 상태: 도구 호출 = 빠른 박·케이지 회전, 생각 = 중간, 대기 = 느린 째깍, 오류 = 거의 멈춤, 완료·중지 = 멈춤(밸런스 진폭 0 으로 잦아듦).

const TAU = Math.PI * 2;

/** 상태 → 박(Hz, 한 박 = 밸런스 반 진동)·바깥 케이지 평균 회전(rad/s)·밸런스 진폭(최대 대비) */
export const TOURB = {
  tool:  { beat: 5.0, cage: 0.9,  amp: 1.0 },
  think: { beat: 3.0, cage: 0.42, amp: 0.8 },
  wait:  { beat: 1.2, cage: 0.1,  amp: 0.5 },
  error: { beat: 0.5, cage: 0.03, amp: 0.25 },
  off:   { beat: 0,   cage: 0,    amp: 0 },
};
/** 형상(본체 반지름 = 1). 바깥 케이지 자오선 호 반지름·안쪽 케이지 고리·밸런스 테·이스케이프 휠·앵커 */
export const TOURB_GEO = {
  OUTER_R: 1.5, OUTER_ARMS: 3, POLE_R: 0.26,        // 바깥 케이지: 극에서 극으로 도는 자오선 호 3개 + 극 둘레 작은 판 고리
  INNER_R: 1.28, INNER_TILT: 0.62,                   // 안쪽 케이지: 바깥 케이지 안에서 기운 축으로 도는 고리(케이지 속 케이지)
  BAL_R: 1.12, BAL_SPOKES: 3, BAL_SCREWS: 8,          // 밸런스 휠: 테 + 살 3 + 타이밍 나사 8
  BAL_SWING: 1.9,                                     // 밸런스 최대 진폭(rad, 약 ±110°)
  ESC_TEETH: 15, ESC_R: 0.2,                          // 이스케이프 휠
  PALLET_SWING: 0.2,                                  // 앵커 흔들림(rad)
  INNER_K: 1.7,                                       // 안쪽 케이지 회전 = 바깥 × 1.7(반대 방향)
  SUB_R: 1.3, SUB_ARMS: 3,                            // 서브 단일 케이지
};
/** 한 박 안에서 끊어 도는 정도: 박 처음 0.2 동안 빠르게(ease-out), 나머지는 멈춤 — '째깍' */
export const TICK_FRAC = 0.2;
export function tickEase(f) {
  if (!(f > 0)) return 0;
  if (f >= TICK_FRAC) return 1;
  const k = f / TICK_FRAC;
  return 1 - (1 - k) * (1 - k) * (1 - k);
}
/** LOD(본체 화면 반지름 px): 0 = 몸체만(먼 원판), 1 = 바깥 케이지·밸런스 테, 2 = 전부(안쪽 케이지·이스케이프·앵커·보석·나사·헤어스프링) */
export const TOURB_LOD = { HIDE_PX: 6, DETAIL_PX: 18, SUB_PX: 12 };
export function tourbLod(px) { return !(px >= TOURB_LOD.HIDE_PX) ? 0 : px < TOURB_LOD.DETAIL_PX ? 1 : 2; }

/**
 * 이스케이프먼트 상태(노드마다 하나). step(dt, mode) → this(값 읽기).
 *  bal    밸런스 각(rad) — 진폭 × sin(박 위상 π)
 *  esc    이스케이프 휠 각 — 박마다 톱니 하나(2π/ESC_TEETH)씩 째깍
 *  pallet 앵커 각 — 박마다 좌우로 넘어감(넘어가는 순간만 빠르게)
 *  cage   바깥 케이지 각 — 박마다 (cage/beat) 만큼 째깍(평균 속도 = TOURB.cage)
 *  cage2  안쪽 케이지 각 — cage × INNER_K(반대 방향)
 *  ticks  지금까지 박 수, tick = 이번 step 에 박이 넘어갔는지
 * 상태가 바뀌면 박·속도·진폭은 지수 보간(초당 rate)으로 넘어가 끊김 없이 빨라지고 느려진다. 'off' 면 진폭이 잦아들고 멈춘다.
 */
export class Escapement {
  constructor(seed = 0) {
    this.ph = seed * 7.3 % 1;     // 박 위상(박 단위 누적)
    this.beat = 0; this.cageRate = 0; this.amp = 0;
    this.base = seed * TAU;        // 케이지 기준 각
    this.cageAcc = 0;              // 지난 박들까지 쌓인 케이지 각
    this.cageStep = 0;             // 이번 박에 나아갈 각
    this.ticks = Math.floor(this.ph);
    this.tick = false;
    this.bal = 0; this.esc = 0; this.pallet = 0; this.cage = this.base; this.cage2 = 0;
  }
  step(dt, mode, { rate = 2.5, reduced = false } = {}) {
    const T = TOURB[mode] || TOURB.wait;
    const k = 1 - Math.exp(-rate * Math.max(0, dt));
    const kb = reduced ? 0.2 : 1;
    this.beat += (T.beat * kb - this.beat) * k;
    this.cageRate += (T.cage * kb - this.cageRate) * k;
    this.amp += (T.amp - this.amp) * k;
    if (mode === 'off' && this.beat < 0.05) this.beat = 0;
    const before = Math.floor(this.ph);
    this.ph += Math.max(0, dt) * this.beat;
    const n = Math.floor(this.ph), f = this.ph - n;
    this.tick = n !== before;
    if (this.tick) {
      this.cageAcc += this.cageStep * Math.min(8, n - before); // 지난 박을 마저 채움(긴 dt 도 평균 속도 유지)
      this.cageStep = this.beat > 0.01 ? this.cageRate / this.beat : 0;
      this.ticks += n - before;
    }
    const e = tickEase(f);
    this.esc = ((this.ticks + e) * TAU) / TOURB_GEO.ESC_TEETH;
    // 밸런스: 한 박 = 반 진동(위상 π). 진폭이 0 이면 제자리
    this.bal = TOURB_GEO.BAL_SWING * this.amp * Math.sin(Math.PI * this.ph);
    // 앵커: 박마다 좌우 교대, 넘어가는 순간(박 처음 TICK_FRAC)만 움직임
    const side = this.ticks % 2 === 0 ? 1 : -1;
    this.pallet = TOURB_GEO.PALLET_SWING * side * (2 * e - 1) * Math.min(1, this.amp * 2);
    this.cage = this.base + this.cageAcc + this.cageStep * e;
    this.cage2 = -(this.cage - this.base) * TOURB_GEO.INNER_K;
    return this;
  }
}

/** 2D 위에서 본 바퀴의 살·나사 각(돌린 각 a, 개수 n, 시작 위상 p) */
export function spokeAngles(a, n, p = 0, out = []) { out.length = 0; for (let i = 0; i < n; i++) out.push(a + p + (i * TAU) / n); return out; }
