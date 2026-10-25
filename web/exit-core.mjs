// 노드·도구 퇴장 연출의 순수 부분(three·DOM 없음)
//   노드(에이전트·세션·claude -p·백그라운드 작업)가 물러날 때: 빛이 약해지며 작아지고(ease-in-out), 끝 무렵 작은 빛 입자로
//   흩어져 부모 쪽으로 빨려 들어간다. 연결선·빔은 자식 끝에서부터 부모 쪽으로 감겨 들어간다.
//   배속·조용한 이벤트(스크럽·밀린 이벤트)에서는 줄이거나 생략(exitPolicy). node --test 로 시험(web/test/exit.test.mjs).

export const EXIT = {
  DUR: 1.3,            // 기본 퇴장 시간(초) — 1.0～1.4 안
  FAST_DUR: 0.8,       // 4～8배속
  BRIEF_DUR: 0.35,     // 8～16배속: 짧게, 입자 없음
  SKIP_SPEED: 16,      // 이 배속 이상이면 연출 없이 바로 사라짐
  FAST_SPEED: 4,
  BRIEF_SPEED: 8,
  FADE_END: 0.85,      // 이 비율까지 빛·불투명도가 0 으로
  MIN_SCALE: 0.18,     // 끝 무렵 크기(그 뒤 입자로 흩어짐)
  LINK_START: 0.08,    // 연결선 감기 시작(비율)
  BURST_AT: 0.55,      // 입자로 흩어지는 시점(비율)
  PARTICLES: 14,       // 노드 하나당 입자 수
  PART_LIFE: 0.8,      // 입자 수명(초, 퇴장 시간에 비례해 줄어듦)
  SCATTER: 1.5,        // 흩어지는 반지름(노드 반지름 배수)
  SETTLE: 0.7,         // 퇴장이 끝난 뒤 남은 노드가 자리를 잡는 시간(자동 카메라 재맞춤 대기)
};

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 부드러운 시작·끝(cubic ease-in-out) */
export const easeInOut = (u) => { u = clamp01(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
export const easeOut = (u) => { u = clamp01(u); return 1 - Math.pow(1 - u, 3); };
export const easeIn = (u) => { u = clamp01(u); return u * u * u; };

/**
 * 배속·조용함에 따른 연출 정책. null = 연출 없이 바로 사라짐.
 * quiet(스크럽·밀린 이벤트 따라잡기)·16배속 이상 → null, 8배속 이상 → 짧게·입자 없음, 4배속 이상 → 조금 짧게
 */
export function exitPolicy(speed = 1, quiet = false) {
  const s = Number(speed) || 1;
  if (quiet || s >= EXIT.SKIP_SPEED) return null;
  if (s >= EXIT.BRIEF_SPEED) return { dur: EXIT.BRIEF_DUR, particles: false };
  if (s >= EXIT.FAST_SPEED) return { dur: EXIT.FAST_DUR, particles: true };
  return { dur: EXIT.DUR, particles: true };
}

/**
 * 퇴장 진행 k(0..1) → 모습. fade: 빛·불투명도 배율(1→0), scale: 크기 배율, link: 연결선이 감긴 비율(0 = 그대로, 1 = 부모까지 다 감김),
 * burst: 입자로 흩어질 때가 되었는가
 */
export function exitPose(k, out = {}) {
  k = clamp01(k);
  out.fade = 1 - easeInOut(k / EXIT.FADE_END);
  out.scale = 1 - (1 - EXIT.MIN_SCALE) * easeInOut(k);
  out.link = easeInOut((k - EXIT.LINK_START) / (1 - EXIT.LINK_START));
  out.burst = k >= EXIT.BURST_AT;
  return out;
}

/** 입자 수명: 퇴장 시간에 비례(기본 1.3초 → 0.8초) */
export const particleLife = (dur = EXIT.DUR) => Math.max(0.35, EXIT.PART_LIFE * (dur / EXIT.DUR));

/**
 * 입자 위치(순수, out 에 씀). u = 수명 비율 0..1, s = 출발점(노드 중심), d = 흩어지는 방향(단위), R = 흩어지는 반지름,
 * p = 부모 위치(없으면 s 로 모여 사라짐). 앞 35% 는 바깥으로 퍼지고(ease-out) 나머지는 부모 쪽으로 빨려 들어간다(ease-in)
 */
export function particlePos(out, u, s, d, R, p) {
  u = clamp01(u);
  const spread = easeOut(u / 0.35) * R;
  const sx = s.x + d.x * spread, sy = s.y + d.y * spread, sz = s.z + d.z * spread;
  const pull = easeIn((u - 0.2) / 0.8);
  const t = p || s;
  out.x = sx + (t.x - sx) * pull; out.y = sy + (t.y - sy) * pull; out.z = sz + (t.z - sz) * pull;
  return out;
}
/** 입자 밝기·크기: 퍼질 때 밝고, 부모에 닿을수록 작고 옅게 */
export const particleFade = (u) => { u = clamp01(u); return Math.min(1, u / 0.12) * (1 - easeIn(u)); };

/** 흩어지는 방향(결정적, i번째 입자): 구면 위 피보나치 점 + 씨앗 회전, 위아래는 납작하게 */
export function scatterDir(out, i, n, seed = 0) {
  const g = Math.PI * (3 - Math.sqrt(5));
  const y = n > 1 ? 1 - (2 * (i + 0.5)) / n : 0;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = g * i + seed * 6.283;
  out.x = Math.cos(a) * r; out.y = y * 0.55; out.z = Math.sin(a) * r;
  const l = Math.hypot(out.x, out.y, out.z) || 1;
  out.x /= l; out.y /= l; out.z /= l;
  return out;
}

/** 연결선 끝점: 부모 a → 자식 b 를 link(0..1) 만큼 감은 끝(out) */
export function retractEnd(out, a, b, link) {
  const k = 1 - clamp01(link);
  out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.z = a.z + (b.z - a.z) * k;
  return out;
}

/** 홀로그램 패널 접힘(fk 0..1) 동안 노드 쪽으로 미끄러져 들어가는 거리 비율(1 = 제자리, 작을수록 노드에 가까움) */
export const foldSlide = (fk) => 1 - 0.85 * easeInOut(fk);
/** 접힘 중 스캔라인처럼 닫히는 밝은 줄 세기(0..1): 줄로 눌린 뒤 밝아졌다 점으로 사라짐 */
export const foldLine = (fk) => { fk = clamp01(fk); return Math.min(1, fk / 0.3) * (1 - easeIn((fk - 0.6) / 0.4)); };
