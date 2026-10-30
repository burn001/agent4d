// 복셀 과열 — 지친 직원(순수, DOM·three 없음, node --test 대상 web/test/vx-heat.test.mjs).
//   공용 코어(heat-core.mjs)의 노드별 heat(0..1)·단계를 직원 몸짓·입자 배치로 옮긴다. 그리기는 3D vx-heat.js·character.js, 2D flat/vx2d-heat.js.
//   · 단계(보간된 heat 기준 — compact 로 떨어지면 몇 초에 걸쳐 단계가 내려온다): 1 데움 = 큰 이마 땀·옅은 호박 열기·얼굴 살짝 붉음·가끔 어깨 주무르기·목 돌리기·걸음 조금 느림,
//     30% 부터 머리 위 옅은 김 한 덩이(50%(WISP_H)↑ 둘) · 멀리서 읽히는 큰 신호: 발밑 바닥 열기 원·몸(옷) 색 물듦·모니터 테두리 단계색(2026-10-30)
//     2 과열 = 구부정(상체·고개 숙임)·다크서클·눈 반쯤 감김·흩날리는 땀·머리 위 옅은 김·붉은 열기·타이핑 중 멈칫·관자놀이 짚기
//     3 위험 = 머리에서 연기·얼굴 붉음·몸 둘레 붉은 글로우 맥동·휘청·책상에 엎드리기 직전·가끔 김 분출·불티
//   · 식을 때(보간 heat 가 목표보다 RELIEF_DROP 넘게 높고 과열 이상이었으면) 한 번: 기지개 → 한숨(입김 한 줄기)
//   · 퇴장 중·끝난 직원은 꺼짐(퇴근 걸음은 그대로) · 움직임 줄이기면 몸짓·움직이는 입자 없이 자세·정지 표시만
//   · 몸짓은 시간 칸(SLOT)마다 (seed, 칸) 해시로 정해 결정적 — 같은 시각이면 같은 몸짓
import { HeatBook, nodeHeat, HEAT, HOT_H, CRIT_H, WISP_H } from '../heat-core.mjs'; // 단계 경계 HOT_H(≈0.571 = 70%)·CRIT_H(≈0.857 = 90%), 데움 안 김 문턱 WISP_H(≈0.286 = 50%)

export const TIRED = Object.freeze({
  WALK_K: Object.freeze([1, 0.92, 0.84, 0.74]),      // 걷는 속도 배율(단계별)
  SLUMP: Object.freeze([0, 0.03, 0.11, 0.19]),       // 상체 앞으로 숙임(lean, rad)
  HEAD_DROP: Object.freeze([0, 0.03, 0.12, 0.2]),    // 고개 숙임(headP, rad)
  SLOT: Object.freeze([0, 8, 6.5, 5]),               // 몸짓 칸 길이(초)
  ACT_P: Object.freeze([0, 0.35, 0.5, 0.62]),        // 칸마다 몸짓이 나올 확률
  ACT_DUR: Object.freeze([0, 2.2, 2.4, 2.8]),        // 몸짓 길이(초, 칸 앞부분)
  BURST_P: 0.3,          // 위험 단계 칸마다 김 분출 확률
  BURST_S: 0.9,          // 분출 길이(초)
  RELIEF_S: 3.4,         // 식을 때 기지개 + 한숨 길이(초)
  RELIEF_MIN: HOT_H,     // 이만큼(과열, 70%) 이상이던 직원만
  RELIEF_DROP: 0.25,     // 보간 heat − 목표 heat 가 이만큼 벌어지면(compact 급락) 시작
  SMOKE_N: Object.freeze([0, 0, 3, 5]),   // 머리 위 김·연기 덩이(캐릭터당 상한) — 데움은 30% 1덩이·50%↑ WISP_N(2026-10-30 과열 2 → 3, 멀리서도 굵게)
  SWEAT_N: Object.freeze([0, 0, 2, 3]),   // 흩날리는 땀방울
  EMBER_N: Object.freeze([0, 0, 0, 2]),   // 불티
  WISP_N: 2,             // 데움 머리 위 옅은 김(30% 하나 · 50%(WISP_H)↑ 둘, 2026-10-30 멀리서 보이게 30% 부터)
  BURST_N: 4,            // 분출 김 덩이
  PART_CAP: 14,          // 캐릭터당 입자 상한(김·연기·땀·불티·분출·입김 합)
});

/** 단계별 몸짓 후보(자리에서 일할 때 / 쉴 때) */
const ACTS = Object.freeze({
  1: Object.freeze({ work: ['rub', 'neck'], idle: ['rub', 'neck'] }),
  2: Object.freeze({ work: ['temple', 'pause', 'wipe', 'neck'], idle: ['rub', 'neck', 'wipe', 'temple'] }),
  3: Object.freeze({ work: ['temple', 'pause', 'wipe', 'sway'], idle: ['slump', 'wipe', 'temple', 'sway'] }),
});

const frac = (x) => x - Math.floor(x);
const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);
const mix = (a, b, w) => a + (b - a) * w;
/** 정수 둘 → 0..1(결정적) */
function hash01(a, b) {
  let h = (Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** seed → 0..1(입자 위상 엇갈림) */
export const seedFrac = (seed) => hash01(seed | 0, 7);

/** 보간 heat(+목표 단계) → 보이는 단계. 30% 막 넘은 직원(heat 0)도 목표가 1 이면 데움 */
export function shownStage(h, targetStage = 0) {
  if (h >= CRIT_H) return 3;
  if (h >= HOT_H) return 2;
  return h > 0.001 || targetStage >= 1 ? 1 : 0;
}

/** 지침 표시를 끌 직원: 퇴장 중·사라짐·끝남(팀장 포함) */
export function tiredOff(ch) {
  if (!ch || !ch.node) return true;
  if (ch.state === 'leave' || ch.state === 'gone' || ch.vanishT0 != null || ch.forceLeave || ch.endAt != null) return true;
  const s = ch.node.status;
  return s === 'done' || s === 'error' || s === 'stopped';
}

/** 직원 상태 → 몸짓 자리: 'walk' | 'work'(책상에서 도구 조작) | 'idle'(책상·대기) | 'other'(탕비실·심부름·지휘 등 — 자세만) */
export function tiredMode(ch) {
  const st = ch.state;
  if (st === 'walk' || st === 'leave' || st === 'enter' || st === 'blink') return 'walk';
  const tt = ch.target && ch.target.type;
  if (tt === 'desk' || !tt) return st === 'work' && ch.workCat ? 'work' : 'idle';
  return 'other';
}

/**
 * 결정적 몸짓: (단계, seed, 시각 t, 자리) → { act, k(0..1 진행), slot, burst(김 분출 중이면 0..1 진행, 아니면 -1) }.
 * out 을 넘기면 그것을 채워 돌려준다(프레임마다 새 객체 없음).
 */
export function tiredAct(stage, seed, t, mode, out = {}) {
  out.act = 'none'; out.k = 0; out.slot = -1; out.burst = -1;
  if (!(stage >= 1) || mode === 'walk' || mode === 'other') return out;
  const L = TIRED.SLOT[stage], s = seed | 0;
  const u = t / L + seedFrac(s) * 3;
  const slot = Math.floor(u), into = (u - slot) * L;
  out.slot = slot;
  if (stage >= 3) {
    const bs = (into - L * 0.45);
    if (hash01(s ^ 0x5bd1, slot) < TIRED.BURST_P && bs >= 0 && bs < TIRED.BURST_S) out.burst = bs / TIRED.BURST_S;
  }
  const r = hash01(s, slot * 4 + stage);
  if (r >= TIRED.ACT_P[stage]) return out;
  const d = TIRED.ACT_DUR[stage];
  if (into >= d) return out;
  const list = ACTS[stage][mode === 'work' ? 'work' : 'idle'];
  out.act = list[Math.floor(hash01(s + 1, slot) * list.length) % list.length];
  out.k = into / d;
  return out;
}

/**
 * 자세 P(character.js pose 의 { legL, legR, armL, armR, rollL, rollR, lean, headP, headY, ... })에 지침을 덧입힌다.
 * h = { on, stage, heat, act, k } (TiredBook 이 ch._heat 에 채움), mode = tiredMode(ch), t = 시각(초), phase = ch.phase.
 */
export function applyTired(P, h, mode, t = 0, phase = 0) {
  if (!h || !h.on || !(h.stage >= 1)) return P;
  const s = h.stage;
  if (h.act === 'relief') return applyRelief(P, h.k);
  const slumpK = mode === 'walk' ? 0.6 : mode === 'other' ? 0.5 : 1;
  P.lean += TIRED.SLUMP[s] * slumpK;
  P.headP += TIRED.HEAD_DROP[s] * slumpK;
  if (mode === 'walk' || mode === 'other') return P;
  const k = clamp01(h.k), w = Math.sin(k * Math.PI);
  switch (h.act) {
    case 'rub': // 어깨 주무르기: 왼손을 오른 어깨에, 고개는 반대로 기울임
      P.armL = mix(P.armL, -2.2, w); P.rollL = mix(P.rollL, 1.25, w) + 0.08 * Math.sin(t * 9) * w;
      P.headY = mix(P.headY, -0.3, w); P.headP += 0.1 * w; break;
    case 'neck': { // 목 돌리기: 고개가 한 바퀴 반, 오른손은 뒷목
      const a = k * Math.PI * 3;
      P.headP += 0.26 * w * Math.sin(a); P.headY += 0.34 * w * Math.cos(a);
      P.armR = mix(P.armR, -2.7, w); P.rollR = mix(P.rollR, 0.45, w); break;
    }
    case 'temple': // 관자놀이 짚기: 오른손을 머리 옆에, 고개 숙임
      P.armR = mix(P.armR, -2.6, w); P.rollR = mix(P.rollR, 0.62, w); P.headP += 0.18 * w; P.headY += 0.12 * w; break;
    case 'pause': // 멈칫: 두 손이 허공에 멈추고 멍하니 고개를 듦
      P.armL = mix(P.armL, -1.1, w); P.armR = mix(P.armR, -1.1, w); P.rollL = mix(P.rollL, 0.2, w); P.rollR = mix(P.rollR, -0.2, w);
      P.headP -= 0.1 * w; P.headY = mix(P.headY, 0, w); break;
    case 'wipe': // 이마 땀 닦기: 오른손등이 이마를 가로질러
      P.armR = mix(P.armR, -2.75, w); P.rollR = mix(P.rollR, mix(0.9, -0.2, k), w); P.headP -= 0.1 * w; break;
    case 'sway': // 휘청: 몸이 앞뒤로 흔들리고 고개가 돈다
      P.lean += 0.1 * w * Math.sin(k * Math.PI * 3 + phase); P.headY += 0.2 * w * Math.sin(k * Math.PI * 2); P.legR -= 0.12 * w; break;
    case 'slump': // 책상에 엎드리기 직전: 상체·고개를 깊이 숙이고 팔을 책상에
      P.lean += 0.32 * w; P.headP += 0.35 * w;
      P.armL = mix(P.armL, -1.35, w); P.armR = mix(P.armR, -1.35, w); P.rollL = mix(P.rollL, 0.4, w); P.rollR = mix(P.rollR, -0.4, w); break;
  }
  return P;
}

/** 식을 때 한 번: 앞 55% 기지개(두 팔 위로·몸 뒤로) → 뒤 45% 한숨(어깨·고개 툭) */
export function applyRelief(P, k) {
  k = clamp01(k);
  if (k < 0.55) {
    const ws = Math.sin((k / 0.55) * Math.PI);
    P.armL = mix(P.armL, -2.95, ws); P.armR = mix(P.armR, -2.95, ws); P.rollL = mix(P.rollL, -0.25, ws); P.rollR = mix(P.rollR, 0.25, ws);
    P.lean = mix(P.lean, -0.12, ws); P.headP = mix(P.headP, -0.3, ws);
  } else {
    const wg = Math.sin(((k - 0.55) / 0.45) * Math.PI);
    P.headP += 0.15 * wg; P.lean += 0.05 * wg; P.armL = mix(P.armL, -0.04, wg); P.armR = mix(P.armR, -0.04, wg);
  }
  return P;
}

/**
 * 입자 배치(캐릭터 지역 좌표, 머리 꼭대기 기준 — x 오른쪽, y 위, z 앞). 상태 없이 시각만으로 정해(공용 버퍼에 그때그때 넣음).
 * out = [{type, x, y, z, s, a, r}] 미리 만든 칸(길이 ≥ TIRED.PART_CAP) — 채운 개수를 돌려준다.
 * type: 'steam'(옅은 김, 과열) · 'smoke'(연기, 위험) · 'burst'(김 분출) · 'sweat'(땀방울) · 'ember'(불티) · 'breath'(한숨 입김)
 */
export function heatParticles(h, seed, t, reduced, out) {
  let n = 0;
  if (!h || !h.on || !out) return 0;
  const s = h.stage, sf = seedFrac(seed | 0), cap = Math.min(out.length, TIRED.PART_CAP);
  const put = (type, x, y, z, sz, a, r = 0) => { if (n >= cap) return; const o = out[n++]; o.type = type; o.x = x; o.y = y; o.z = z; o.s = sz; o.a = a; o.r = r; };
  if (h.act === 'relief') { // 한숨 입김: 입 앞으로 흩어지는 흰 덩이 한 줄기(기지개 뒤)
    if (!reduced && h.k > 0.55) for (let i = 0; i < 3; i++) {
      const u = clamp01((h.k - 0.55) / 0.45 - i * 0.12);
      if (u <= 0 || u >= 1) continue;
      put('breath', 0.05 * Math.sin(i * 2.1), -0.32 + 0.25 * u, 0.32 + 0.6 * u, 0.1 + 0.18 * u, 0.42 * (1 - u), i + u);
    }
    if (s < 2) return n;
  }
  if (s < 1) return n;
  if (s === 1) { // 데움: 30% 부터 머리 위 옅은 김 한 덩이(작게·지속), 50%(WISP_H)↑ 둘 — 과열 김으로 이어짐(2026-10-30 멀리서도 보이게 30% 부터)
    const wn = h.heat >= WISP_H ? TIRED.WISP_N : 1, amp = 0.12 + 0.07 * clamp01(h.heat / HOT_H); // 30% 0.12 → 70% 0.19(과열 김 ≈0.19 로 이어짐)
    const big = 1 + 0.15 * clamp01(h.heat / HOT_H);
    for (let i = 0; i < wn; i++) {
      const u = reduced ? (i + 1) / (wn + 1) * 0.6 : frac(t / 3 + i / wn + sf);
      const a = reduced ? amp * 0.8 : amp * (u < 0.2 ? u / 0.2 : 1 - (u - 0.2) / 0.8);
      const wob = reduced ? 0.5 : Math.sin(i * 2.4 + t * 0.8);
      put('steam', 0.1 * wob * (0.5 + u), 0.05 + u * 0.85, -0.05, (0.14 + 0.28 * u) * big, a, u * 1.5 + i);
    }
    return n;
  }
  // 김·연기: 머리에서 위로 올라가며 커지고 옅어짐(위험이면 더 많이·더 높이·짙게)
  // 2026-10-30 멀리서 읽히게: 과열 = 굵은 김(1.25배·더 높이), 위험 = 짙은 연기 기둥(1.5배·두 배 높이)
  const sn = TIRED.SMOKE_N[s], per = s >= 3 ? 1.9 : 2.6, rise = s >= 3 ? 2.0 : 1.25, big = s >= 3 ? 1.5 : 1.25;
  const amp = s >= 3 ? 0.36 + 0.06 * h.heat : 0.15 + 0.12 * h.heat; // 김 알파 ≤ 0.42 유지
  for (let i = 0; i < sn; i++) {
    const u = reduced ? (i + 1) / (sn + 1) * 0.7 : frac(t / per + i / sn + sf);
    const a = reduced ? amp * 0.8 : amp * (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85);
    const wob = reduced ? 0.6 : Math.sin(i * 2.4 + t * 0.9);
    const dz = reduced ? 0.5 : Math.cos(i * 1.7 + t * 0.7);
    put(s >= 3 ? 'smoke' : 'steam', 0.12 * wob * (0.5 + u), 0.05 + u * rise, 0.1 * dz * (0.5 + u) - 0.05, (0.14 + 0.32 * u) * big, a, u * 1.5 + i);
  }
  if (reduced) return n;
  // 흩날리는 땀방울: 머리 옆에서 튀어 포물선으로 떨어짐
  for (let i = 0; i < TIRED.SWEAT_N[s]; i++) {
    const per2 = 1.1, ph = t / per2 + i * 0.37 + sf, u = frac(ph);
    if (u > 0.85) continue;
    const ang = sf * 6.283 + i * 2.1 + Math.floor(ph) * 1.3, rr = 0.25 + 0.5 * u;
    put('sweat', Math.cos(ang) * rr, -0.15 + 0.5 * u - 1.4 * u * u, Math.sin(ang) * rr * 0.6, 0.055, 1);
  }
  // 불티: 위험 단계에서 위로 튀며 깜빡
  for (let i = 0; i < TIRED.EMBER_N[s]; i++) {
    const u = frac(t / 1.4 + i * 0.5 + sf);
    if (u > 0.9) continue;
    put('ember', 0.25 * Math.sin(i * 3 + u * 6), 0.1 + 1.1 * u, 0.15 * Math.cos(i * 2 + u * 5), 0.045 * (1 - 0.5 * u), 1 - u);
  }
  // 김 분출: 위험 단계 칸마다 가끔 — 머리 위로 빠르게 치솟음
  if (h.burst >= 0) for (let i = 0; i < TIRED.BURST_N; i++) {
    const kb = clamp01(h.burst - i * 0.08);
    if (kb <= 0) continue;
    const ang = i * 1.57 + sf * 6.283;
    put('burst', Math.cos(ang) * 0.18 * kb, 0.1 + 2.2 * kb, Math.sin(ang) * 0.18 * kb, 0.1 + 0.25 * kb, 0.45 * (1 - kb), kb * 2 + i);
  }
  return n;
}

/** 몸 둘레 열기 글로우 세기(0..1) — 데움 옅은 호박 · 과열 주황 · 위험 붉은 맥동(움직임 줄이기면 맥동 없이) */
export function glowLevel(h, t, reduced, phase = 0) {
  if (!h || !h.on || h.stage < 1) return 0;
  if (h.stage === 1) return 0.1 + 0.2 * clamp01(h.heat / HOT_H); // 데움: 옅은 호박 열기(30% 0.1 → 70% 0.3, 과열 0.35 로 이어짐, 맥동 없음)
  if (h.stage === 2) return 0.35 + 0.35 * clamp01((h.heat - HOT_H) / (CRIT_H - HOT_H));
  const base = 0.75 + 0.25 * clamp01((h.heat - CRIT_H) / (1 - CRIT_H));
  return reduced ? base : base * (0.72 + 0.28 * (0.5 + 0.5 * Math.sin(t * 4.2 + phase)));
}

/** 얼굴 붉어짐(피부 → 빨강 섞는 비율) */
export const flushOf = (h) => (!h || !h.on ? 0 : h.stage >= 3 ? 0.3 + 0.1 * clamp01((h.heat - CRIT_H) / (1 - CRIT_H)) : h.stage === 2 ? 0.12 : 0.04 + 0.06 * clamp01(h.heat / HOT_H)); // 데움 0.04 → 0.1

/* ---- 멀리서 읽히는 큰 신호(2026-10-30 사용자 피드백 "Voxel 에서는 과열 상태가 잘 안 보인다") ----
 * 전체 보기 기본 카메라에서 직원은 몇 px 이라 땀·눈 같은 몸 디테일이 안 보인다 → 바닥 열기 원·몸 색 물듦·머리 위 김 기둥·모니터 테두리처럼
 * 화면에서 넓게 차지하는 신호로 단계를 읽힌다. 30% → 70% 사이는 점점 진해지고, 70%·90% 경계에서 한 단 더 올라간다(HOT_H·CRIT_H). */

/** 단계색 섞기 비율 0 = 호박(데움) → 1 = 빨강(위험): 30% 0 · 70% 0.45(주황) · 90% 0.85 · 100% 1 */
export function heatHueOf(h) {
  if (!h || !h.on) return 0;
  const x = clamp01(h.heat);
  if (x < HOT_H) return 0.45 * (x / HOT_H);
  if (x < CRIT_H) return 0.45 + 0.4 * ((x - HOT_H) / (CRIT_H - HOT_H));
  return 0.85 + 0.15 * clamp01((x - CRIT_H) / (1 - CRIT_H));
}

/** 몸(옷) 색 물듦 비율 — 데움 0.22 → 0.36 · 과열 0.42 → 0.5 · 위험 0.55 → 0.62 */
export function bodyTintOf(h) {
  if (!h || !h.on || h.stage < 1) return 0;
  const x = clamp01(h.heat);
  if (h.stage === 1) return 0.22 + 0.14 * clamp01(x / HOT_H);
  if (h.stage === 2) return 0.42 + 0.08 * clamp01((x - HOT_H) / (CRIT_H - HOT_H));
  return 0.55 + 0.07 * clamp01((x - CRIT_H) / (1 - CRIT_H));
}

/** 바닥 열기 원 맥동 주기(초)·깊이 — 단계가 오를수록 빠르고 깊게 */
const FLOOR_PER = [0, 2.8, 1.8, 1.05], FLOOR_AMP = [0, 0.14, 0.22, 0.32];
/**
 * 발밑 바닥 열기 원: { r(캐릭터 단위 반지름), a(원판 세기 0..1), ring(테 세기 0..1), rings(테 겹 수 1|2), w(테 굵기 배율) }. 30% 부터 보이고 70%·90% 에서 한 단씩 진해진다.
 * 움직임 줄이기면 맥동 없이 고정. out 을 넘기면 채워 돌려준다.
 */
export function floorHeatOf(h, t, reduced, phase = 0, out = {}) {
  out.r = 0; out.a = 0; out.ring = 0; out.rings = 0; out.w = 0;
  if (!h || !h.on || h.stage < 1) return out;
  const x = clamp01(h.heat), s = h.stage;
  out.r = 1.05 + 0.6 * x;
  out.a = s === 1 ? 0.38 + 0.27 * clamp01(x / HOT_H) : s === 2 ? 0.72 + 0.13 * clamp01((x - HOT_H) / (CRIT_H - HOT_H)) : 0.9 + 0.1 * clamp01((x - CRIT_H) / (1 - CRIT_H));
  out.ring = s === 1 ? 0.45 + 0.25 * clamp01(x / HOT_H) : s === 2 ? 0.8 : 1;
  out.rings = s >= 3 ? 2 : 1;                    // 위험은 테 두 겹(과열과 한눈에 구분)
  out.w = s === 1 ? 0.7 + 0.3 * clamp01(x / HOT_H) : s === 2 ? 1.25 : 1.5; // 테 굵기 배율
  if (!reduced) {
    const w = 0.5 + 0.5 * Math.sin((t / FLOOR_PER[s]) * Math.PI * 2 + phase);
    out.a *= 1 - FLOOR_AMP[s] * w; out.ring *= 1 - FLOOR_AMP[s] * 0.7 * w;
  }
  return out;
}

/** 카메라 거리 → 신호 키움 배율(가까이 1 · 멀수록 커져 최대 FAR_MAX) — 바닥 원·김 덩이 크기에 곱한다 */
export const FAR_NEAR = 45, FAR_MAX = 1.9;
export function farBoost(dist) {
  const d = Number(dist);
  if (!(d > FAR_NEAR)) return 1;
  return Math.min(FAR_MAX, 1 + (d - FAR_NEAR) / FAR_NEAR * 0.85);
}

/**
 * 직원별 지침 장부(3D·2D 각 하나). 프레임마다 step(chars, now, dt, {reduced}) → ch._heat = { on, heat, stage, pct, act, k, burst } 와
 * ch.walkK(걸음 배율)를 채운다. 돌려주는 값(재사용 객체): { anim(몸짓이 움직이는 지침 직원 수), fx(입자·맥동·기지개·식는 중 — 2D 가 낮은 fps 로 다시 그릴 직원 수),
 *   hot(지침 직원 수), changed(그릴 값이 바뀜 — 움직임 줄이기 2D 는 이것으로만 다시 그림) }.
 */
export class TiredBook {
  constructor() { this.hb = new HeatBook(); this.m = new Map(); this._r = { anim: 0, fx: 0, hot: 0, changed: false }; this._a = {}; }
  clear() { this.hb.clear(); this.m.clear(); }
  step(chars, now, dt, { reduced = false, snap = false } = {}) {
    const R = this._r; R.anim = 0; R.fx = 0; R.hot = 0; R.changed = false;
    const seen = this._seen || (this._seen = new Set()); seen.clear();
    for (const ch of chars) {
      const h = ch._heat || (ch._heat = { on: false, heat: 0, stage: 0, pct: 0, act: 'none', k: 0, burst: -1 });
      if (tiredOff(ch)) {
        if (h.on) R.changed = true;
        h.on = false; h.heat = 0; h.stage = 0; h.act = 'none'; h.burst = -1; ch.walkK = 1;
        continue;
      }
      seen.add(ch.id);
      const target = nodeHeat(ch.node);
      const shown = this.hb.step(ch.id, ch.node, dt, { snap });
      let e = this.m.get(ch.id);
      if (!e) { e = { reliefT0: null, lock: false, sig: '' }; this.m.set(ch.id, e); }
      // 식을 때 한 번: 기지개 + 한숨(compact 급락). 다 식기 전엔 다시 안 함
      if (e.lock && shown < TIRED.RELIEF_MIN * 0.5) e.lock = false;
      if (!reduced && !snap && e.reliefT0 == null && !e.lock && shown >= TIRED.RELIEF_MIN && target.heat <= shown - TIRED.RELIEF_DROP) { e.reliefT0 = now; e.lock = true; }
      if (e.reliefT0 != null && (now - e.reliefT0 >= TIRED.RELIEF_S || now < e.reliefT0)) e.reliefT0 = null;
      const stage = shownStage(shown, target.stage);
      h.on = stage >= 1; h.heat = shown; h.stage = stage; h.pct = target.pct;
      const mode = tiredMode(ch);
      if (e.reliefT0 != null && mode !== 'walk') { h.act = 'relief'; h.k = (now - e.reliefT0) / TIRED.RELIEF_S; h.burst = -1; }
      else if (reduced) { h.act = 'none'; h.k = 0; h.burst = -1; }
      else { const a = tiredAct(stage, ch.hash || 0, now, mode, this._a); h.act = a.act; h.k = a.k; h.burst = a.burst; }
      ch.walkK = TIRED.WALK_K[stage] || 1;
      if (h.on) { R.hot++; if (!reduced || h.act === 'relief') R.anim++; if (h.act === 'relief' || !reduced) R.fx++; } // 30%↑ 김·바닥 열기 맥동이 움직임(2026-10-30)
      // 바뀜 판정(움직임 줄이기 2D 는 이것으로만 다시 그림): 단계·heat 0.02 단위
      const sig = stage + ':' + Math.round(shown * 50);
      if (sig !== e.sig) { e.sig = sig; R.changed = true; }
      if (shown > target.heat + 0.001) { R.anim = Math.max(R.anim, 1); R.fx = Math.max(R.fx, 1); } // 식는 중
    }
    if (this.m.size > seen.size) for (const id of this.m.keys()) if (!seen.has(id)) { this.m.delete(id); this.hb.m.delete(id); }
    return R;
  }
}

export { HEAT };
