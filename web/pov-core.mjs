// 메인 에이전트 1인칭 시점(POV) — 순수 함수. three·DOM 없음(node --test 로 시험).
// 복셀 3D 에서 카메라를 팀장(main 노드 캐릭터) 눈에 두고, 고개는 지금 일하는 노드 쪽으로 자동으로 돌아간다(활성 점수 재사용).
//  · 대상 고르기(pickPovMain) · 이름으로 찾기(resolvePovTarget — ctl camera pov <이름>)
//  · 눈 자리(povEye) · 시선 각(aimAngles) · 고개 한계(clampHead) · 감쇠(damp·angLerp)
//  · 주시 대상 고르기(GazePicker — 최소 머묾·히스테리시스) · 마우스 둘러보기(LookOffset — 손 떼면 몇 초 뒤 시선으로 복귀)

const D2R = Math.PI / 180;

/**
 * 조정 상수(여기서만).
 * EYE_UP: 머리 기준(headY) 위로 · EYE_FWD: 고개 축(몸 앞으로) · EYE_BACK: 카메라를 시선 반대쪽으로 물림(고개 축 둘레로 돎 — 몸은 POV 동안 숨김,
 *   바로 눈에 두면 2배 모니터가 화면을 다 덮어 사무실이 안 보였다)
 * DESK_LIMIT: 책상에 서서 모니터가 열려 있을 때 고개 한계(모니터가 정면에 남게)
 * FOV·NEAR·FAR: POV 동안 카메라(복셀 기본 fov 30·near 0.5 는 사무실 안에서 너무 좁고 모니터가 잘림)
 * POS_RATE·YAW_RATE·PITCH_RATE: 초당 감쇠(1 − e^(−rate·dt)) — 걷기 따라가기·고개 돌리기
 * YAW_MAX·PITCH_MAX_V: 고개 각속도 상한(도/초) · TURN_ACC: 각속도 따라가기(초당) — 멀미 방지(첫 측정 최대 368°/초 → 상한)
 * HEAD_LIMIT: 몸 방향에서 고개를 돌릴 수 있는 최대 각(뒤에 있는 대상은 여기까지만)
 * PITCH_MIN·MAX: 위아래 · PITCH_REST: 대상 없을 때 앞쪽 살짝 아래
 * GAZE_RANGE: 주시 후보 수평 거리 · GAZE_DWELL: 대상 최소 머묾(초) · GAZE_HYST: 바꾸려면 점수가 이 배 넘게
 * GAZE_LOST: 대상이 쉬어도 이만큼은 더 봄 · SELF_K: 자기(모니터) 점수 배율(메인은 Agent 도구가 늘 열려 있어 낮춤)
 * BACK_K: 고개 한계 밖(등 뒤) 후보 점수 배율 · LOOK_*: 둘러보기 한계·감도·복귀
 */
export const POV = {
  EYE_UP: 0.1, EYE_FWD: 0.08, EYE_BACK: 0.6,
  FOV: 64, FOV_MIN: 34, FOV_MAX: 76, NEAR: 0.05, FAR: 600,
  POS_RATE: 5, YAW_RATE: 2.2, PITCH_RATE: 2.2, YAW_MAX: 55, PITCH_MAX_V: 30, TURN_ACC: 5,
  HEAD_LIMIT: 75 * D2R, DESK_LIMIT: 28 * D2R, PITCH_MIN: -40 * D2R, PITCH_MAX: 30 * D2R, PITCH_REST: -9 * D2R,
  GAZE_RANGE: 24, GAZE_DWELL: 5, GAZE_HYST: 1.5, GAZE_LOST: 1.2, SELF_K: 0.5, BACK_K: 0.35,
  LOOK_YAW: 110 * D2R, LOOK_PITCH: 60 * D2R, LOOK_SENS: 0.0042, LOOK_HOLD: 1.2, LOOK_RATE: 2.2, LOOK_RESUME: 3,
  ENTER: 1.2, EXIT: 1.2,
};

/** 각 차(a → b), −π..π */
export const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
/** 프레임 독립 감쇠 몫 */
export const damp = (rate, dt) => 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));
/** 각 보간(짧은 쪽으로) */
export const angLerp = (a, b, k) => a + angDiff(a, b) * k;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * 눈 자리. ch = {pos:{x,z}, yaw, headY:number} (yaw: 앞 = (sin yaw, cos yaw) — character-core 와 같음)
 * @returns {{x:number,y:number,z:number,yaw:number}}
 */
export function povEye(ch, P = POV) {
  const yaw = Number(ch.yaw) || 0;
  const hy = Number.isFinite(ch.headY) ? ch.headY : 1.55;
  return { x: ch.pos.x + Math.sin(yaw) * P.EYE_FWD, y: hy + P.EYE_UP, z: ch.pos.z + Math.cos(yaw) * P.EYE_FWD, yaw };
}

/** 카메라 자리: 고개 축(povEye)에서 시선 (yaw, pitch) 반대쪽으로 back 만큼(수평) */
export function camFromHead(head, yaw, back = POV.EYE_BACK) {
  return { x: head.x - Math.sin(yaw) * back, y: head.y, z: head.z - Math.cos(yaw) * back };
}

/** 눈 → 점 의 방위(yaw, character 규약)·고도(pitch, 위 +) */
export function aimAngles(eye, p) {
  const dx = p.x - eye.x, dz = p.z - eye.z, dy = (p.y == null ? eye.y : p.y) - eye.y;
  const h = Math.hypot(dx, dz);
  return { yaw: h > 1e-6 ? Math.atan2(dx, dz) : eye.yaw || 0, pitch: Math.atan2(dy, Math.max(h, 1e-6)), dist: Math.hypot(h, dy) };
}

/**
 * 고개 돌리기 한 걸음(각속도 상한·가속 완화): cur → goal 을 감쇠 rate 로 따라가되 각속도는 max(도/초)까지, 각속도 자체도 acc 로 부드럽게.
 * angular = true 면 각 차(−π..π)로. 반환 {v, vel}
 */
export function turnStep(cur, goal, vel, dt, { rate, max, acc = POV.TURN_ACC, angular = true } = {}) {
  if (!(dt > 0)) return { v: cur, vel: vel || 0 };
  const diff = angular ? angDiff(cur, goal) : goal - cur;
  const lim = (max * Math.PI) / 180;
  const want = clamp((diff * damp(rate, dt)) / dt, -lim, lim);
  let nv = (vel || 0) + (want - (vel || 0)) * damp(acc, dt);
  if (Math.abs(nv * dt) > Math.abs(diff)) nv = diff / dt; // 넘어가지 않게
  return { v: cur + nv * dt, vel: nv };
}

/** 고개 한계: 몸 방향 bodyYaw 에서 limit 안으로 */
export function clampHead(bodyYaw, wantYaw, limit = POV.HEAD_LIMIT) {
  const d = angDiff(bodyYaw, wantYaw);
  return bodyYaw + clamp(d, -limit, limit);
}

/** (yaw, pitch) → 시선 단위 벡터 */
export function lookDir(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c };
}

/**
 * POV 대상 메인 고르기(기본): 포커스한 노드의 루트 메인 → 가장 활발한(점수) 메인 → id 순 첫째.
 * mains = [{id, s, root}] (root = rootSessionId), focusRoot = 포커스 노드의 rootSessionId | null
 */
export function pickPovMain(mains, focusRoot = null, prefer = null) {
  const list = (mains || []).filter((m) => m && m.id);
  if (!list.length) return null;
  if (prefer && list.some((m) => m.id === prefer)) return prefer;
  if (focusRoot) { const f = list.find((m) => m.root === focusRoot || m.id === 's:' + focusRoot); if (f) return f.id; }
  let best = null;
  for (const m of list) if (!best || (m.s || 0) > (best.s || 0) || ((m.s || 0) === (best.s || 0) && m.id < best.id)) best = m;
  return best.id;
}

/**
 * 이름으로 메인 찾기(ctl camera pov <q>): 노드 id(정확·'s:' 생략) → 세션 id 앞부분(4자↑) → 라벨 부분일치 → 프로젝트 이름 부분일치.
 * mains = [{id, label, sessionId, project}]
 * @returns {{ok:true,id}|{ok:false,error:'not_found'|'ambiguous',candidates:string[]}}
 */
export function resolvePovTarget(mains, q) {
  const list = (mains || []).filter((m) => m && m.id);
  const k = String(q == null ? '' : q).trim().toLowerCase();
  const brief = (m) => `${m.label || m.id}${m.project ? ' @' + m.project : ''} (${String(m.sessionId || m.id).replace(/^s:/, '').slice(0, 8)})`;
  if (!k) return list.length ? { ok: true, id: null } : { ok: false, error: 'not_found', candidates: [] };
  const lc = (s) => String(s || '').toLowerCase();
  const tiers = [
    (m) => lc(m.id) === k || lc(m.id) === 's:' + k || lc(m.sessionId) === k,
    (m) => k.length >= 4 && (lc(m.sessionId).startsWith(k) || lc(m.id).replace(/^s:/, '').startsWith(k)),
    (m) => lc(m.label) === k,
    (m) => lc(m.label).includes(k),
    (m) => lc(m.project) === k,
    (m) => lc(m.project).includes(k),
  ];
  for (const f of tiers) {
    const hit = list.filter(f);
    if (hit.length === 1) return { ok: true, id: hit[0].id };
    if (hit.length > 1) return { ok: false, error: 'ambiguous', candidates: hit.slice(0, 6).map(brief) };
  }
  return { ok: false, error: 'not_found', candidates: list.slice(0, 6).map(brief) };
}

/**
 * 주시 대상 고르기(자동 주시): 후보 [{id, s}](s > 0 = 지금 일함, 이미 SELF_K·BACK_K 반영).
 * - 지금 대상은 GAZE_DWELL 초는 붙잡는다(시선이 왔다 갔다 하지 않게). 단 대상이 GAZE_LOST 초 넘게 쉬면(후보에서 빠지면) 그 전에도 넘어간다.
 * - 머묾이 지나면 최고 점수 후보가 지금 대상보다 GAZE_HYST 배 넘게 높을 때만 바꾼다(동률은 id 순).
 * - 후보가 없으면 null(자기 모니터·앞 시선으로) — GAZE_LOST 동안은 마지막 대상을 더 본다.
 */
export class GazePicker {
  constructor(P = POV) { this.P = P; this.reset(); }
  reset() { this.cur = null; this.since = -1e9; this.lostAt = null; this.switches = 0; }
  /** @returns {string|null} 지금 볼 대상 id */
  step(cands, now) {
    const P = this.P;
    const list = (cands || []).filter((c) => c && c.id && c.s > 0);
    let best = null;
    for (const c of list) if (!best || c.s > best.s || (c.s === best.s && c.id < best.id)) best = c;
    const cur = this.cur != null ? list.find((c) => c.id === this.cur) : null;
    if (this.cur != null && !cur) {
      if (this.lostAt == null) this.lostAt = now;
      if (now - this.lostAt < P.GAZE_LOST) return this.cur; // 잠깐 조용해도 바로 고개를 돌리지 않음
      return this._set(best ? best.id : null, now);
    }
    this.lostAt = null;
    if (this.cur == null) return best ? this._set(best.id, now) : null;
    if (now - this.since < P.GAZE_DWELL) return this.cur;
    if (best && best.id !== this.cur && best.s > cur.s * P.GAZE_HYST) return this._set(best.id, now);
    return this.cur;
  }
  _set(id, now) {
    if (id !== this.cur) { this.cur = id; this.since = now; this.switches++; }
    this.lostAt = null;
    return this.cur;
  }
}

/**
 * 마우스 둘러보기 오프셋(시선에 더함). 끄는 동안은 자동 주시를 멈추고(paused), 손을 떼면 LOOK_HOLD 초 머문 뒤 0 으로 돌아가며,
 * LOOK_RESUME 초 뒤부터 자동 주시를 다시 고른다.
 */
export class LookOffset {
  constructor(P = POV) { this.P = P; this.yaw = 0; this.pitch = 0; this.dragging = false; this.relAt = -1e9; }
  start() { this.dragging = true; }
  move(dx, dy) {
    const P = this.P;
    this.yaw = clamp(this.yaw - dx * P.LOOK_SENS, -P.LOOK_YAW, P.LOOK_YAW);
    this.pitch = clamp(this.pitch - dy * P.LOOK_SENS, -P.LOOK_PITCH, P.LOOK_PITCH);
  }
  end(now) { if (this.dragging) { this.dragging = false; this.relAt = now; } }
  /** 자동 주시를 쉬는 중인가(끄는 중 또는 놓은 뒤 LOOK_RESUME 초 안) */
  paused(now) { return this.dragging || now - this.relAt < this.P.LOOK_RESUME; }
  step(dt, now) {
    if (this.dragging || now - this.relAt < this.P.LOOK_HOLD) return;
    const k = damp(this.P.LOOK_RATE, dt);
    this.yaw -= this.yaw * k; this.pitch -= this.pitch * k;
    if (Math.abs(this.yaw) < 1e-4) this.yaw = 0;
    if (Math.abs(this.pitch) < 1e-4) this.pitch = 0;
  }
  reset() { this.yaw = 0; this.pitch = 0; this.dragging = false; this.relAt = -1e9; }
}

/**
 * 한 프레임 시선 목표(순수): 몸 yaw, 눈, 주시점(없으면 null), 둘러보기 오프셋 → {yaw, pitch}.
 * 주시점은 고개 한계로 묶고, pitch 는 PITCH_MIN..MAX. 둘러보기는 한계 밖으로도(LOOK_YAW) 돌릴 수 있다.
 */
export function gazeGoal(bodyYaw, eye, point, look = null, P = POV, limit = P.HEAD_LIMIT) {
  let yaw = bodyYaw, pitch = P.PITCH_REST;
  if (point) {
    const a = aimAngles(eye, point);
    yaw = clampHead(bodyYaw, a.yaw, limit);
    pitch = clamp(a.pitch, P.PITCH_MIN, P.PITCH_MAX);
  }
  if (look) { yaw += look.yaw; pitch = clamp(pitch + look.pitch, P.PITCH_MIN - 0.3, P.PITCH_MAX + 0.3); }
  return { yaw, pitch };
}

/** 후보 점수 보정: 자기(모니터)는 SELF_K, 고개 한계 밖(등 뒤)은 BACK_K, 너무 멀면 0 */
export function gazeScore(s, { self = false, rel = 0, dist = 0 } = {}, P = POV) {
  if (!(s > 0)) return 0;
  if (!self && dist > P.GAZE_RANGE) return 0;
  let k = self ? P.SELF_K : 1;
  if (!self && Math.abs(rel) > P.HEAD_LIMIT) k *= P.BACK_K;
  return s * k;
}

/** POV 칩 글: 'POV · 메인' 또는 'POV · 메인 → 직원 3' */
export function povChipText(mainName, gazeName, trunc = 18) {
  const t = (s) => { const x = String(s || ''); return x.length > trunc ? x.slice(0, trunc - 1) + '…' : x; };
  return 'POV · ' + t(mainName) + (gazeName ? ' → ' + t(gazeName) : '');
}
