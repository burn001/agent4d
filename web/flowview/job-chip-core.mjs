// 흐름(Flow) 3D 의 작업(Job) 칩 — 순수 규칙(three·DOM 없음, web/test/jobs-flow.test.mjs)
// 작업 노드(kind bash-bg + meta.job)는 백그라운드 명령 칩처럼 그리지 않고 주인에 붙은 작은 작업 칩으로 그린다.
//  · 크기: 백그라운드 명령 칩 × JOB_CHIP.SCALE, 기둥 두께 JOB_CHIP.THICK(얇은 판)
//  · 색: job-core jobCode(job, 렌더러 시계) 표시 상태 — 진행 호박 · 대기 파랑 흐림 · 줄 섬 회색 흐림 · 끝 초록 · 실패 빨강 · 정체 주황
//  · 진행 비율(jobProgress)이 있으면 둘레 호, 대기는 모래시계 + until 쪽으로 차오르는 눈금 고리, 정체는 끊긴 맥박, 끝·실패는 차분하게(맥동 없음)
// 셰이더에는 인스턴스 속성 iC 한 칸으로 넘긴다: (FLAG 2, 표시 상태 번호, 진행 0..1 | -1, 대기 차오름 0..1 | -1).
// 정수(FLAG·상태 번호)는 셰이더에서 반올림해 푼다(— varying 보간값 정확 비교 금지).
import { jobCode, jobProgress, JOB_CODE } from '../job-core.mjs';
import { paletteOf } from './flow-style.mjs';

export const JOB_CHIP = {
  SCALE: 0.68,       // 작업 칩 반지름 = 백그라운드 명령 칩 반지름 × 이만큼(작게 — 작업은 주인의 하위 정보)
  THICK: 0.42,       // 기둥 두께(칩 반지름 배수) — 백그라운드 명령 0.85 보다 얇은 판
  FLAG: 2,           // iC.x: 0 보통 칩 · 1 배치 장치 · 2 작업 칩
  REFRESH_MS: 250,   // 표시 상태(정체 판정)를 다시 계산하는 간격(렌더러 시계 기준) — 그 사이 프레임은 보관한 값만 씀
  WAIT_SPAN_MS: 15 * 60000, // 대기 시작 시각을 모를 때 until 앞으로 잡는 기본 구간
  // 표시 상태별 칩 불투명도 배율: 줄 섬·대기는 흐리게, 끝·실패는 차분하게
  ALPHA: [0.6, 1, 0.9, 0.75, 0.85, 1],
  // 표시 상태별 바깥 빛무리 세기(진행·정체만 또렷)
  GLOW: [0.15, 0.9, 0.65, 0.3, 0.45, 1],
};

// 표시 상태 번호 → 흐름 팔레트 열쇠(flow-style FLOW_PALETTE): 진행 = tool(호박 — 배치 장치 회차 진행 막대와 같은 색)
const COLOR_KEY = ['jobQueued', 'tool', 'jobWait', 'done', 'error', 'jobStale'];

/** 표시 상태 번호 → 칩 색(hex). 모르는 번호는 진행 */
export function jobChipColor(code, isLight = false) {
  const P = paletteOf(isLight);
  return P[COLOR_KEY[code]] || P.tool;
}

const tsOf = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : NaN; };
const ended = (code) => code === JOB_CODE.done || code === JOB_CODE.failed;

/**
 * 칩 모델 갱신(보관 객체 memo 를 고쳐 씀 — 프레임마다 객체를 만들지 않게).
 *  memo = { at, job, code, prog, untilKey, untilMs, fromMs }
 *  · code: jobCode(job, nowMs) — 정체가 이긴다(렌더러 시계)
 *  · prog: 진행 비율(끝나지 않았을 때만, 끝·실패는 차분하게 숨김) | -1
 *  · 대기: until 이 바뀌면 그때부터 차오름을 잰다(fromMs = 그 대기 줄의 박동 시각, 없으면 지금). 같은 until 이면 그대로
 * REFRESH_MS 안이고 meta.job 이 같은 객체면 아무것도 하지 않는다. 시계가 뒤로 가면(재생 되감기) 다시 계산.
 * @returns memo
 */
export function jobChipModel(memo, job, nowMs) {
  const fresh = memo.job !== job || !(nowMs >= memo.at) || nowMs - memo.at >= JOB_CHIP.REFRESH_MS;
  if (!fresh) return memo;
  memo.at = nowMs; memo.job = job;
  memo.code = job ? jobCode(job, nowMs) : JOB_CODE.running;
  const p = job && !ended(memo.code) ? jobProgress(job) : null;
  memo.prog = p == null ? -1 : p;
  const waiting = !!job && job.state === 'waiting';
  const uk = waiting && job.until ? String(job.until) : '';
  if (uk !== memo.untilKey || (uk && nowMs < memo.fromMs)) { // until 이 바뀜 · 시계가 대기 시작 앞으로 되감김
    memo.untilKey = uk;
    memo.untilMs = uk ? tsOf(uk) : NaN;
    const beat = job ? tsOf(job.beatAt) : NaN;
    memo.fromMs = Number.isFinite(beat) ? Math.min(beat, nowMs) : nowMs;
  }
  return memo;
}
export const newJobChipMemo = () => ({ at: -Infinity, job: undefined, code: JOB_CODE.running, prog: -1, untilKey: '', untilMs: NaN, fromMs: NaN });

/**
 * 대기 차오름 0..1(until 이 가까울수록 1), 대기가 아니거나 until 이 없으면 -1.
 * 시작 시각을 모르거나 until 보다 늦으면 until − WAIT_SPAN_MS 부터.
 */
export function jobWaitFill(memo, nowMs) {
  if (memo.code !== JOB_CODE.waiting || !Number.isFinite(memo.untilMs) || !Number.isFinite(nowMs)) return -1;
  let from = memo.fromMs;
  if (!Number.isFinite(from) || from >= memo.untilMs) from = memo.untilMs - JOB_CHIP.WAIT_SPAN_MS;
  const f = (nowMs - from) / (memo.untilMs - from);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** 셰이더 iC 네 칸: [FLAG, 표시 상태 번호, 진행 | -1, 대기 차오름 | -1] — out 배열 o 자리에 씀 */
export function jobChipAttr(out, o, memo, nowMs) {
  out[o] = JOB_CHIP.FLAG; out[o + 1] = memo.code; out[o + 2] = memo.prog; out[o + 3] = jobWaitFill(memo, nowMs);
  return out;
}

/** 셰이더 쪽 FLAG 풀기와 같은 규칙(보간 오차 ±0.4 까지 같은 값): 0 보통 · 1 배치 장치 · 2 작업 */
export const chipFlagOf = (x) => Math.floor(x + 0.5);

/**
 * 주인 → 작업 연결선(빔) 모양: 작업은 주인의 하위 정보라 은은하게.
 *  alphaK 기본 빔 불투명도 배율 · widthK 굵기 배율 · dash 흐르는 대시({speed, amp} | null) — 진행만 느리게 흐르고, 정체는 멈춤(끊김)
 */
export function jobBeamStyle(code) {
  if (code === JOB_CODE.running) return { alphaK: 0.45, widthK: 0.5, dash: { speed: 2.2, amp: 0.8 } };
  if (code === JOB_CODE.stale) return { alphaK: 0.5, widthK: 0.5, dash: null };
  if (code === JOB_CODE.waiting) return { alphaK: 0.45, widthK: 0.45, dash: { speed: 0.6, amp: 0.5 } };
  return { alphaK: 0.35, widthK: 0.4, dash: null }; // 줄 섬·끝·실패
}

/** 칩 숨쉬기 쓸지: 진행 중인 작업만(정체·대기·끝은 가만히) */
export const jobBreathes = (code) => code === JOB_CODE.running;
