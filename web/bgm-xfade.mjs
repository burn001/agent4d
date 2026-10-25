// 배경음악 크로스페이드 순수 로직. DOM·WebAudio 없음 — audio.js 가 쓰고 web/test/bgm-xfade.test.mjs 가 검사한다.
//   덱 두 개(A/B <audio>)를 번갈아 쓴다. 덱 음량은 '위상' p ∈ [0,1] 을 선형으로 움직이고 소리 크기는 sin(p·π/2)(등전력 곡선):
//   들어오는 덱 sin, 나가는 덱 cos(= 위상이 1→0 인 sin) 이라 겹치는 동안 두 덱 세기 제곱의 합이 1 근처로 유지된다.
//   도중에 다시 바뀌면 지금 위상에서 새 목표로 이어 간다(값이 연속 — 클릭 잡음 없음). 걸리는 시간은 남은 위상에 비례.

/** 전환 종류별 시간(초). out = 나가는 곡 페이드아웃, in = 새 곡 페이드인, delay = 나가기 시작 뒤 새 곡 시작까지, bar = 마디 경계 맞춤 */
export const XFADE = Object.freeze({
  auto: Object.freeze({ out: 4.5, in: 4.5, delay: 1.5, bar: true }),   // 자동 선곡 단계 전환: 겹침 3초
  manual: Object.freeze({ out: 1.5, in: 1.5, delay: 0, bar: false }),  // 선택기로 고름
  ended: Object.freeze({ out: 3, in: 3, delay: 0, bar: false }),       // 곡 끝 3초 전에 다음 곡 미리 시작
});
export const END_LEAD = 3;       // 곡 끝 몇 초 전에 다음 곡을 시작하나
export const TAKEOVER_OUT = 1.2; // 전환 도중 또 다른 곡이 오면 아직 소리 나는 덱을 이 시간(전체 기준) 비율로 빨리 줄임
export const READY_TIMEOUT = 10; // 새 곡 버퍼링을 최대 몇 초 기다리고 전환하나(넘으면 그냥 시작)
export const SILENT = 1e-3;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 등전력 곡선: 위상 → 크기 */
export const eqPow = (p) => Math.sin(clamp01(p) * Math.PI / 2);
/** 크기 → 위상(eqPow 역함수) */
export const eqPhase = (v) => Math.asin(clamp01(v)) * 2 / Math.PI;

/** 마디 길이(초). bpm 이 없거나 이상하면 null */
export function barLength(bpm, beats = 4) {
  return Number.isFinite(bpm) && bpm >= 20 && bpm <= 400 ? (beats * 60) / bpm : null;
}

/**
 * 지금 재생 위치 pos(초)에서 다음 마디 경계까지 기다릴 시간(초, 0 ≤ 대기 < 1마디). 곡은 0초가 첫 마디 시작.
 * bpm 이 없으면 0(맞춤 생략). 경계에 거의 붙어 있으면(< tol) 0.
 */
export function barWait(pos, bpm, { beats = 4, tol = 0.06 } = {}) {
  const bar = barLength(bpm, beats);
  if (!bar || !Number.isFinite(pos) || pos < 0) return 0;
  const into = pos % bar;
  if (into < tol) return 0;
  const w = bar - into;
  return w < tol ? 0 : w;
}

/**
 * 전환 일정. kind = 'auto'|'manual'|'ended'. pos = 나가는 곡 재생 위치, bpm = 나가는 곡 BPM, duration·remaining 은 'ended' 용.
 * @returns {{kind, wait, out, in, delay, overlap}} 모두 초. wait 뒤 나가기 시작 → delay 뒤 새 곡 시작.
 */
export function planXfade(kind, { pos = 0, bpm = null, remaining = null } = {}) {
  const P = XFADE[kind] || XFADE.manual;
  let out = P.out;
  if (kind === 'ended' && Number.isFinite(remaining)) out = Math.max(0.5, Math.min(P.out, remaining));
  const wait = P.bar ? barWait(pos, bpm) : 0;
  const overlap = Math.max(0, Math.min(out, P.delay + P.in) - P.delay);
  return { kind: XFADE[kind] ? kind : 'manual', wait, out, in: P.in, delay: P.delay, overlap };
}

/** 곡 끝 미리 넘기기: 반복 없는 모드(자동·순환·무작위)이고 남은 시간이 lead 이하이면 true */
export function shouldLeadEnd({ loop = false, mode = false, pos, duration, lead = END_LEAD }) {
  if (loop || !mode) return false;
  if (!Number.isFinite(pos) || !Number.isFinite(duration) || duration <= lead + 1) return false;
  return duration - pos <= lead + 0.05;
}

/**
 * 음량 차선 하나: 위상을 선형 구간 {t0, t1, p0, p1} 로 움직이고 shape 로 크기를 낸다('eq' 등전력 | 'lin' 그대로).
 * 시계는 부르는 쪽이 정한다(AudioContext.currentTime 또는 performance.now()/1000). 바꾸면 rebase.
 */
export class Lane {
  constructor(p = 0, shape = 'eq') {
    this.shape = shape;
    this.seg = { t0: 0, t1: 0, p0: clamp01(p), p1: clamp01(p) };
  }
  phaseAt(t) {
    const s = this.seg;
    if (!(t < s.t1)) return s.p1;
    if (t <= s.t0) return s.p0;
    return s.p0 + (s.p1 - s.p0) * ((t - s.t0) / (s.t1 - s.t0));
  }
  map(p) { return this.shape === 'eq' ? eqPow(p) : clamp01(p); }
  valueAt(t) { return this.map(this.phaseAt(t)); }
  /** 목표 위상 target 으로. 전체(0↔1) 기준 fullDur 초, 남은 거리에 비례. 지금 위상에서 이어 감. 걸리는 시간 반환 */
  to(target, fullDur, now) {
    const p0 = this.phaseAt(now);
    const p1 = clamp01(target);
    const dur = Math.max(0, fullDur) * Math.abs(p1 - p0);
    this.seg = dur > 1e-4 ? { t0: now, t1: now + dur, p0, p1 } : { t0: now, t1: now, p0: p1, p1 };
    return dur;
  }
  /** 바로 그 위상으로 */
  snap(p, now = 0) { p = clamp01(p); this.seg = { t0: now, t1: now, p0: p, p1: p }; }
  busy(t) { return t < this.seg.t1 && this.seg.p0 !== this.seg.p1; }
  get target() { return this.seg.p1; }
  get endTime() { return this.seg.t1; }
  /** 시계를 바꿀 때(요소 볼륨 → WebAudio): 지금 위상·남은 시간을 새 시계로 옮김 */
  rebase(oldNow, newNow) {
    const p = this.phaseAt(oldNow);
    const rem = Math.max(0, this.seg.t1 - oldNow);
    this.seg = rem > 1e-4 && this.seg.p1 !== p ? { t0: newNow, t1: newNow + rem, p0: p, p1: this.seg.p1 } : { t0: newNow, t1: newNow, p0: this.seg.p1, p1: this.seg.p1 };
  }
  /**
   * AudioParam 예약용 점 목록 [[t, 크기], …]: 첫 점은 now 의 값(setValueAtTime), 나머지는 linearRampToValueAtTime.
   * 등전력은 step 초 간격 꺾은선으로 근사(0.05초면 최대 오차 ≈ 0.0005), 선형은 끝점 하나.
   */
  points(now, step = 0.05) {
    const s = this.seg;
    const pts = [[now, this.valueAt(now)]];
    if (!this.busy(now)) return pts;
    const a = Math.max(now, s.t0);
    if (a > now) pts.push([a, this.valueAt(a)]);
    if (this.shape !== 'eq') { pts.push([s.t1, this.map(s.p1)]); return pts; }
    const n = Math.max(1, Math.ceil((s.t1 - a) / step));
    for (let i = 1; i <= n; i++) {
      const t = i === n ? s.t1 : a + ((s.t1 - a) * i) / n;
      pts.push([t, this.valueAt(t)]);
    }
    return pts;
  }
}

/**
 * 전환 도중 새 요청이 왔을 때 무엇을 하나.
 * @param {object|null} xf 진행 중 전환 {fromId, toId, started}(started = 새 곡이 재생을 시작함)
 * @param {string} id 새로 원하는 곡
 * @returns {'start'|'same'|'retarget'|'reverse'|'queue'}
 *   start 진행 중 없음 · same 이미 그 곡으로 가는 중 · retarget 새 곡이 아직 시작 전 — 덱에 걸 곡만 바꿈 ·
 *   reverse 나가던 곡으로 되돌아감(두 덱 방향만 뒤집음) · queue 세 번째 곡 — 들어오던 곡을 지금 곡으로 두고 나가던 덱이 조용해지면 시작
 */
export function takeover(xf, id) {
  if (!xf) return 'start';
  if (xf.toId === id) return 'same';
  if (!xf.started) return 'retarget';
  if (xf.fromId === id) return 'reverse';
  return 'queue';
}
