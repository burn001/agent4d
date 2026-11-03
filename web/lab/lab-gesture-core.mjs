// 【모듈 규격 · 연구소 사람 몸짓 — 순수】 three·DOM 없음, node --test 대상. character.js poseBase 가 걷기 분기 바로 뒤에서 한 줄로 부른다:
//   if (ch.gesture && ch.gesture.until > t && GESTURE_POSE(P, ch, t)) return P;
// ch.gesture 는 LabView 만 세운다(복셀 오피스·흐름·Planet 은 없음 → 출력 불변). 걷는 동안은 기존 걷기 분기가 먼저 return.
//
// 몸짓은 사건 하나에 묶인다(무작위 없음):
//   현장 걷기(LabView._walk → FieldPlanner 성공): install(기자재 설치 렌치질) · watch(들여다보기 클립보드) · kill(빨간 버튼) ·
//                                                  field(새 파일 블록 내려놓기) · alarm(위험 확인 — 두 손 들기)
//   서브에이전트 생성·끝(LabView.addNode·updateNode): dispatch(팀장 가리킴 0.8초) · receive(팀장 보고 카드 받으며 끄덕임 0.6초)
// ch.gesture = {kind, t0, until, at, rig} — 객체는 사람마다 하나(ch._g)를 다시 씀(labGestureSet). k = (t − t0)/(until − t0) 를 0..1 로 자름
// (도착이 t0 보다 이르면 k 0 자세로 기다림). at 'visit' = 현장 방문 자리(target.type 'visit')에서만, 'here' = 자리(책상·시설)에서만.
// 관절 값은 기존 범위(−3..0.6) 안. 할당 0(P 필드만 씀).

export const GESTURE_KINDS = ['install', 'watch', 'kill', 'field', 'alarm', 'dispatch', 'receive'];
/** 머무는 시간(초, 배속 전 — 부르는 쪽이 ÷√배속) */
export const GESTURE_STAY = { install: 1.5, watch: 3, kill: 1.0, field: 1.2, alarm: 2.6, dispatch: 0.8, receive: 0.6 };
/** 어디서 보이는가: 'visit' 현장 방문 자리 · 'here' 자기 자리(책상·시설) */
export const GESTURE_AT = { install: 'visit', watch: 'visit', kill: 'visit', field: 'visit', alarm: 'visit', dispatch: 'here', receive: 'here' };
/** 관절 범위(시험이 읽음) */
export const GESTURE_RANGE = [-3, 0.6];
/** 걷기 속도·길 보정(lab-walk-core FieldPlanner 와 같은 값) — 도착 시각 추정 */
const WALK_SPEED = 3.5, PATH_K = 1.4;

/** 도착 시각 추정(초): now + 곧은 거리 × 1.4 ÷ (3.5 × 배속(1..6)), until 을 넘지 않음 */
export function gestureT0(now, from, spot, ts = 1, until = Infinity) {
  let w = 0;
  if (from && spot && Number.isFinite(from.x) && Number.isFinite(spot.x)) w = (Math.hypot(spot.x - from.x, spot.z - from.z) * PATH_K) / (WALK_SPEED * Math.min(6, Math.max(1, ts || 1)));
  return Math.min(now + w, until - 0.05);
}

/** ch.gesture 세우기(ch._g 재사용). until ≤ t0 이면 세우지 않음 → 세운 객체 | null */
export function labGestureSet(ch, kind, t0, until, rig = null) {
  if (!ch || !GESTURE_STAY[kind] || !(until > t0)) return null;
  const g = ch._g || (ch._g = { kind: '', t0: 0, until: 0, at: 'here', rig: null, wait: false, res: 0 });
  g.kind = kind; g.t0 = t0; g.until = until; g.at = GESTURE_AT[kind]; g.rig = rig;
  g.wait = g.at === 'visit'; g.res = until; // 현장 몸짓은 실제 도착(labGestureArrive)에서 t0 를 다시 잡음 · res = 처음 예약 끝(같은 예약 판정)
  ch.gesture = g;
  return g;
}

/**
 * 현장 몸짓 도착 보정(LabView 가 프레임마다 사람마다 부름 — 할당 0). 걷기 도착 추정(gestureT0)이 실제보다 이르면 몸짓이 걷는 동안 지나가
 * 버리므로, 처음으로 방문 자리에 서 있는 프레임에서 t0 = now 로 다시 잡고 머무는 시간(stay = GESTURE_STAY ÷ √배속)을 보장한다
 * (until 이 모자라면 늘리고 ch.visit.until 도 같이 — 'watch' 는 예약 끝까지 그대로). 반환: 'arrive' | 'drop'(방문이 끝나 버림) | null.
 */
const ARRIVE_GRACE = 6; // 초 — 걷기 추정이 모자랄 때 방문을 늘려 주는 한도
export function labGestureArrive(ch, now, ts = 1, walking = false) {
  const g = ch && ch.gesture;
  if (!g || !g.wait) return null;
  const v = ch.visit, tt = ch.target && ch.target.type;
  if (!v || !(v.until > now)) { g.wait = false; g.until = Math.min(g.until, now); return 'drop'; }
  if (walking || tt !== 'visit') { // 아직 가는 중: 길이 추정보다 길어 방문이 곧 끝나면 조금씩 늘림(처음 예약 + ARRIVE_GRACE 까지) — 다 와서 돌아서지 않게
    if (walking && tt === 'visit' && v.until - now < 0.3 && now < g.res + ARRIVE_GRACE) { v.until = now + 0.3; if (g.until < v.until) g.until = v.until; }
    return null;
  }
  g.wait = false; g.t0 = now;
  const stay = (GESTURE_STAY[g.kind] || 1) / Math.max(1, Math.sqrt(ts || 1));
  if (g.kind !== 'watch' && g.until < now + stay) { g.until = now + stay; if (v.until < g.until) v.until = g.until; }
  return 'arrive';
}

const PI = Math.PI;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * 자세 덮어쓰기. P = poseBase 의 자세 객체({legL, legR, armL, armR, rollL, rollR, lean, headP, headY, clip?, card?, …}).
 * 몸짓이 없거나 만료·자리가 맞지 않으면 false(P 그대로), 적용하면 true.
 */
export function labGesturePose(P, ch, t) {
  const g = ch && ch.gesture;
  if (!g || !(g.until > t) || !GESTURE_STAY[g.kind]) return false;
  const tt = ch.target && ch.target.type;
  if (g.at === 'visit' ? tt !== 'visit' : (tt === 'visit' || tt === 'break' || tt === 'errand')) return false;
  const k = clamp01((t - g.t0) / Math.max(1e-3, g.until - g.t0));
  P.legL = 0; P.legR = 0;
  switch (g.kind) {
    case 'install': { // 무릎 굽혀 렌치질
      const w = 0.25 * Math.sin(t * 9);
      P.lean = 0.25; P.armL = -1.3 + w; P.armR = -1.3 - w; P.rollL = 0.2; P.rollR = -0.2; P.headP = 0.35; P.headY = 0;
      P.legL = 0.18; P.legR = 0.18;
      break;
    }
    case 'watch': // 들여다보기와 같은 자세(클립보드 + 고개 들어 화면)
      P.clip = true; P.armL = -1.1; P.rollL = 0.35; P.armR = -0.95; P.rollR = -0.42; P.headP = -0.3; P.headY = 0.14 * Math.sin(t * 1.3); P.lean = 0;
      break;
    case 'kill': { // 팔 뻗음(0..0.4) → 누름(0.4..0.6) → 거둠(0.6..1)
      let a;
      if (k <= 0.4) a = -1.6 * (k / 0.4);
      else if (k <= 0.6) a = -1.6 + 0.15 * Math.sin(((k - 0.4) / 0.2) * PI);
      else a = -1.6 * (1 - (k - 0.6) / 0.4);
      P.armR = a; P.rollR = -0.1; P.armL = -0.2; P.rollL = 0; P.headP = 0.15; P.headY = 0;
      P.lean = k > 0.4 && k <= 0.6 ? 0.06 : 0.02;
      break;
    }
    case 'field': { // 두 팔 앞으로 → 아래(블록 내려놓기)
      const a = -1.4 * Math.sin(Math.min(1, k * 1.5) * PI);
      P.armL = a; P.armR = a; P.rollL = 0.15; P.rollR = -0.15; P.lean = 0.15 * Math.sin(k * PI); P.headP = 0.3; P.headY = 0;
      break;
    }
    case 'alarm': // 두 손바닥 들어 멈추라는 몸짓 + 고개 돌림
      P.armL = -2.4; P.armR = -2.4; P.rollL = -0.3; P.rollR = 0.3; P.headY = 0.5 * Math.sin(t * 2); P.headP = -0.1; P.lean = -0.04;
      break;
    case 'dispatch': // 팀장 가리킴(oversee 와 같은 오른팔)
      P.armR = -1.6 + 0.06 * Math.sin(t * 2.2); P.rollR = 0.12; P.armL = -0.3; P.rollL = -0.6; P.lean = 0.04; P.headP = -0.05; P.headY = 0;
      break;
    case 'receive': // 보고 카드 받으며 끄덕임
      P.armL = -1.15; P.armR = -1.15; P.rollL = 0.35; P.rollR = -0.35; P.card = true; P.headP = 0.25 + 0.15 * Math.sin(t * 8); P.headY = 0; P.lean = 0;
      break;
    default: return false;
  }
  return true;
}
