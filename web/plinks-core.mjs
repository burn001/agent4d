// Planet 관계선 두 표현 — 레이저 통신 링크 ⇄ 궤도 공명 고리. three·DOM 없는 순수 모듈(3D·2D·⚙·ctl 이 같이 씀).
//  · 설정(plinksPref): 'rotate'(기본, 번갈아) | 'laser' | 'orbit'. 저장 'ccviz.plinks', URL ?plinks= 는 이번 접속만(저장 안 함).
//  · 전환 시계(PlinksClock): 벽시계 기준 PERIOD 초마다 '차례' 가 바뀐다(모든 화면·3D·2D 가 같은 차례). 패킷이 날고 있으면
//    (busy) 끝날 때까지 미루고(최대 MAX_DEFER 초), 바꿀 때 FADE 초 크로스페이드. 움직임 줄이기면 페이드 없이 즉시.
//    시계는 화면 시계(벽시계)라 재생 배속과 무관하다 — 재생·보관함도 같은 규칙.
//  · 상태 박자(linkLook): 노드 상태 섞임(S: act·wait·done·err·stop) → 빔 펄스·호 밝기 흐름 값. 3D 셰이더와 2D 대시가 같은 값을 쓴다.

export const PLINKS = {
  PERIOD: 90,      // 번갈아: 차례 길이(초)
  FADE: 1.75,      // 크로스페이드(초)
  MAX_DEFER: 30,   // 패킷이 끊이지 않아도 이만큼 미룬 뒤엔 바꾼다(초)
  KEY: 'ccviz.plinks',
  MODES: ['rotate', 'laser', 'orbit'],
  ARC_SPAN: Math.PI / 2,   // 궤도 고리: 자식 쪽 호 각도(약 90°)
  CP_SPAN: Math.PI * 0.62, // claude -p 자기 초점 호
  SPAWN_SPAN: 1.4,         // 띄움(기동기 곁) 짧은 호
  STATE_K: 3,              // 상태 섞임 따라가기 속도(1/초)
};

const ALIAS = { rotate: 'rotate', auto: 'rotate', both: 'rotate', alt: 'rotate', alternate: 'rotate', cycle: 'rotate', laser: 'laser', beam: 'laser', beams: 'laser', orbit: 'orbit', ring: 'orbit', rings: 'orbit', reso: 'orbit', arc: 'orbit', arcs: 'orbit' };
/** 'rotate'|'laser'|'orbit'|null */
export function normPlinks(v) { if (v == null) return null; const k = String(v).trim().toLowerCase(); return Object.prototype.hasOwnProperty.call(ALIAS, k) ? ALIAS[k] : null; }

/** 처음 값: URL(이번 접속만) → 저장값 → rotate. search = location.search 문자열, store = localStorage 꼴(getItem) */
export function initialPlinks(search, store) {
  try { const u = normPlinks(new URLSearchParams(search || '').get('plinks')); if (u) return { pref: u, fromUrl: true }; } catch { /* 무시 */ }
  let s = null;
  try { s = store ? normPlinks(store.getItem(PLINKS.KEY)) : null; } catch { /* 저장소 막힘 */ }
  return { pref: s || 'rotate', fromUrl: false };
}

// ---- 설정(모듈 단일 값 + 구독) ----
const subs = new Set();
const _ls = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };
let pref = initialPlinks(typeof location !== 'undefined' ? location.search : '', _ls()).pref;
export const plinksPref = () => pref;
/** persist false = 이번 접속만(ctl --temp 등). 잘못된 값이면 false */
export function setPlinksPref(v, { persist = true } = {}) {
  const n = normPlinks(v);
  if (!n) return false;
  if (persist) { try { const s = _ls(); if (s) s.setItem(PLINKS.KEY, n); } catch { /* 저장 못 해도 이번 접속은 바뀜 */ } }
  if (n !== pref) { pref = n; for (const f of subs) { try { f(pref); } catch { /* 구독자 오류 무시 */ } } }
  return true;
}
export function onPlinks(f) { subs.add(f); return () => subs.delete(f); }

// ---- 전환 시계 ----
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** 벽시계(초) → 번갈아 차례 'laser'|'orbit' */
export function turnOf(wallSec, period = PLINKS.PERIOD) { return Math.floor(wallSec / period) % 2 ? 'orbit' : 'laser'; }

export class PlinksClock {
  constructor(o = {}) {
    this.period = o.period || PLINKS.PERIOD;
    this.fade = o.fade ?? PLINKS.FADE;
    this.maxDefer = o.maxDefer ?? PLINKS.MAX_DEFER;
    this.cur = null;      // 자리 잡은 모드
    this.from = null;     // 페이드 중이면 앞 모드
    this.t0 = 0;          // 페이드 시작(초)
    this.dueAt = null;    // 바뀔 차례가 된 시각(미룸 시작)
    this.deferred = 0;    // 미룬 횟수(시험·디버그)
  }
  /**
   * now: 벽시계 초. o.pref('rotate'|'laser'|'orbit'), o.busy(패킷 비행 중), o.reduced(움직임 줄이기)
   * → { mode: 지금 주된 모드, w: 궤도 고리 무게 0..1(레이저 = 1-w), fading }
   */
  step(now, o = {}) {
    const p = o.pref || 'rotate';
    const want = p === 'rotate' ? turnOf(now, this.period) : p;
    if (this.cur == null) { this.cur = want; this.from = null; }
    const fadeS = o.reduced ? 0 : this.fade;
    if (this.from != null && now - this.t0 >= fadeS) this.from = null;
    if (want !== this.cur) {
      if (p !== 'rotate') this._go(want, now); // 사용자가 고른 것은 바로(페이드만)
      else {
        if (this.dueAt == null) this.dueAt = now;
        if (!o.busy || now - this.dueAt >= this.maxDefer) this._go(want, now);
        else this.deferred++;
      }
    } else this.dueAt = null;
    if (this.from != null && now - this.t0 >= fadeS) this.from = null;
    const k = this.from == null ? 1 : smooth((now - this.t0) / Math.max(1e-6, fadeS));
    const wTo = this.cur === 'orbit' ? 1 : 0;
    const w = this.from == null ? wTo : wTo * k + (1 - wTo) * (1 - k);
    return { mode: this.cur, w, fading: this.from != null };
  }
  _go(want, now) {
    // 페이드 도중 다시 바뀌면 지금 섞인 자리에서 이어받지 않고 새로 시작(드문 경우 — 사용자가 연달아 고를 때)
    this.from = this.cur; this.cur = want; this.t0 = now; this.dueAt = null;
  }
}
/** 화면 전체가 같은 시계를 쓴다(3D·2D 전환·재생에도 같은 차례) */
export const plinksClock = new PlinksClock();
/** 뷰가 프레임마다 부른다. busy = 그 뷰의 패킷 비행 중 */
export function plinksMix(busy, reduced) {
  return plinksClock.step(Date.now() / 1000, { pref, busy: !!busy, reduced: !!reduced });
}

// ---- 상태 섞임 · 박자 ----
export const PL_STATE = {
  act: { act: 1, wait: 0, done: 0, err: 0, stop: 0 },
  wait: { act: 0, wait: 1, done: 0, err: 0, stop: 0 },
  done: { act: 0, wait: 0, done: 1, err: 0, stop: 0 },
  err: { act: 0, wait: 0, done: 0, err: 1, stop: 0 },
  stop: { act: 0, wait: 0, done: 0, err: 0, stop: 1 },
};
/** 노드 상태 → 섞임 키. 오래된 오류는 완료처럼 가라앉힌다 */
export function stateKey(status, staleErr = false) {
  return status === 'active' ? 'act' : status === 'error' ? (staleErr ? 'done' : 'err') : status === 'done' ? 'done' : status === 'stopped' ? 'stop' : 'wait';
}
/** S(섞임 객체)를 목표 쪽으로 dt 만큼. 처음이면 바로 목표 */
export function stepState(S, key, dt) {
  const T = PL_STATE[key] || PL_STATE.wait;
  if (!S) return { ...T, T: 0 };
  const k = 1 - Math.exp(-PLINKS.STATE_K * Math.max(0, dt));
  for (const n of ['act', 'wait', 'done', 'err', 'stop']) S[n] += (T[n] - S[n]) * k;
  return S;
}
const lerp = (a, b, k) => a + (b - a) * k;

/**
 * 레이저 빔 박자(경로 u 0..1 = 부모 → 자식). len = 빔 길이(세계), t = 초, seed 0..1, reduced
 * → { a 바탕 세기, p 펄스 세기, rep 경로당 펄스 수, ph 위상(경로 단위, 증가 = 자식 쪽으로), sharp, dash(0 = 실선), on, guide 완료 안내선 세기, flick }
 * 작업 중 = 촘촘·빠름 · 대기 = 2초마다 핑 하나 · 완료 = 빔 꺼짐 + 옅은 점선 안내선 · 오류 = 끊기는 깜빡임 · 중지 = 회색 고정
 */
export function laserLook(S, len, t, seed = 0, reduced = false) {
  const L = Math.max(0.5, len);
  const rep = lerp(lerp(1, L * 0.45, S.act), Math.max(1, L * 0.25), S.err);
  const speed = reduced ? 0 : lerp(0.5, 1.6, S.act); // 경로/초(대기 = 2초에 한 번 지나감)
  const flick = reduced ? 1 : S.err > 0.3 ? (Math.sin(t * 23 + seed * 9) > -0.2 ? 1 : 0.12) : 1;
  const on = 1 - S.done * 0.92;
  return {
    a: ((0.26 + 0.3 * (S.act + S.wait * 0.6 + S.err * 0.8)) * on * flick + 0.36 * S.stop),
    p: reduced ? 0 : 0.95 * (1 - S.stop) * on * flick,
    rep, ph: t * speed + seed, sharp: S.act > 0.5 ? 10 : 24,
    dash: 0, on: 1, guide: 0.3 * S.done, flick,
  };
}
/**
 * 궤도 공명 호 밝기(경로 u 0..1 = 꼬리 → 자식). 작업 중 = 밝기 흐름이 빠름 · 대기 = 느림 · 완료 = 점선으로 가라앉음 · 오류 = 붉게 뜀 · 중지 = 회색 고정
 * → { a 바탕, p 흐름 세기, rep, ph, sharp, dash, on, tail 꼬리 그라데이션 0..1 }
 */
export function orbitLook(S, t, seed = 0, reduced = false) {
  const jump = reduced ? 1 : 1 + 0.6 * S.err * Math.max(0, Math.sin(t * 7 + seed * 5));
  return {
    a: (0.24 + 0.34 * (S.act + S.wait * 0.55 + S.err * 0.7)) * (1 - 0.55 * S.done) * (1 - 0.35 * S.stop) * jump + 0.05 * S.stop,
    p: reduced ? 0 : (0.55 * S.act + 0.3 * S.wait + 0.35 * S.err) * (1 - S.done) * (1 - S.stop),
    rep: lerp(2, 3, S.act), ph: reduced ? 0 : t * lerp(0.12, 0.9, S.act) + seed, sharp: 3,
    dash: S.done > 0.5 ? 26 : 0, on: 0.5, tail: 1 - 0.5 * S.stop,
  };
}

/** 두 원(중심 a·b 같은 평면 xz, 반지름 r)의 교점 중 하나 — 충돌 섬광 자리. 안 만나면 가운데 */
export function circleMeet(ax, az, bx, bz, r, out = { x: 0, z: 0 }) {
  const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz) || 1e-6;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const h2 = r * r - (d / 2) * (d / 2);
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  out.x = mx - (dz / d) * h; out.z = mz + (dx / d) * h;
  return out;
}

/** 빔 양 끝을 궤도계 바깥으로: 중심 거리 d, 두 겉 반지름 → 실제 뗄 거리(합이 d 의 80 % 를 넘으면 비율로 줄임) */
export function endGaps(d, ra, rb) {
  const s = ra + rb, cap = d * 0.8;
  if (s <= cap || s <= 0) return [ra, rb];
  const k = cap / s; return [ra * k, rb * k];
}
