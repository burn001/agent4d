// 메인 에이전트 1인칭 시점(POV) — 복셀 3D 카메라를 팀장 눈에 두고 고개를 지금 일하는 노드 쪽으로 돌린다.
// CameraDirector.update 가 POV 동안 이 객체에 카메라를 넘긴다(OrbitControls 끔). 규칙·상수는 pov-core.mjs(순수).
//  · 몸·이름표·말풍선은 POV 동안 숨김(view.povId) — 모니터는 그대로(책상에 서면 정면에 보임)
//  · 걸을 때는 가는 방향, 서 있으면 자동 주시(GazePicker: 최소 머묾·히스테리시스, 등 뒤는 고개 한계까지만)
//  · 마우스 끌기 = 둘러보기(자동 주시 멈춤, 놓고 몇 초 뒤 복귀), 휠 = 화각
import { POV, povEye, camFromHead, aimAngles, angLerp, turnStep, damp, angDiff, GazePicker, LookOffset, gazeGoal, gazeScore, lookDir } from './pov-core.mjs';

const MON_BASE_Y = 1.02; // 모니터 아래 끝 = 상판(props DESK_TOP 0.92) + LIFT 0.1
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const WALKING = new Set(['walk', 'leave', 'enter', 'blink']);
const prefersReduced = () => { try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export class PovCam {
  constructor() {
    this.active = false;
    this.id = null;          // 1인칭 메인 노드 id
    this.gazeId = null;      // 지금 고른 주시 대상 id(자기 = 모니터, null = 앞)
    this.gazeShown = null;   // 칩에 보이는 대상(걷는 동안은 null — 가는 쪽을 봄)
    this.gaze = new GazePicker();
    this.look = new LookOffset();
    this.view = null;
    this._p = null; this._t = null; this._q = null; // three 객체는 처음 켤 때 카메라에서 복제(이 모듈은 three 를 직접 가져오지 않음 — 2D 화면에서도 앱이 불러옴)
    this._yaw = 0; this._pitch = POV.PITCH_REST;
    this._fov = POV.FOV;
    this._inited = false;
    this._saved = null;      // 들어오기 전 카메라 {fov, near, far, pos, tgt}
    this._blend = null;      // 들어올 때·대상 바꿀 때 {t0, dur, pos, quat, fov}
    this._back = null;       // 나간 뒤 {t0, dur, fromFov, toFov, near, far, pos?, tgt?, fromPos, fromQuat}
    this._pt = { x: 0, y: 0, z: 0 };
    this._down = null;
    this._onDown = (e) => this._pd(e);
    this._onMove = (e) => this._pm(e);
    this._onUp = (e) => this._pu(e);
    this._onWheel = (e) => this._wh(e);
    this.reduced = prefersReduced();
  }

  /** 이 표현에서 쓸 수 있나(복셀 3D) */
  static canUse(view) { const C = view && view.constructor; return !!(view && !view.flat && view.chars && C && (C.family || C.modeId) === 'voxel'); } // 복셀 오피스·복셀 연구소

  /**
   * 켜기·대상 바꾸기. director = CameraDirector(controls 를 끔). 대상 캐릭터가 없으면 false
   */
  start(view, director, id) {
    if (!PovCam.canUse(view) || !id || !view.chars.get(id)) return false;
    const cam = view.camera, now = performance.now() / 1000;
    if (!this._p) { this._p = cam.position.clone(); this._t = cam.position.clone(); this._q = cam.quaternion.clone(); }
    if (!this.active || this.view !== view) {
      const back = this._back;
      this._saved = back ? { fov: back.toFov, near: back.near, far: back.far, pos: back.pos || null, tgt: back.tgt || null } : { fov: cam.fov, near: cam.near, far: cam.far, pos: cam.position.clone(), tgt: director.controls.target.clone() };
      this._back = null;
      this._fov = POV.FOV;
      this._bind(view);
    }
    if (this.view && this.view.povId && this.view !== view) this.view.povId = null;
    this.view = view;
    this._blend = { t0: now, dur: this.active ? POV.ENTER * 0.8 : POV.ENTER, pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
    if (this.id !== id) { this.gaze.reset(); this.gazeId = null; this._inited = false; }
    this.look.reset();
    this.active = true;
    this.id = id;
    view.povId = id;
    director.controls.enabled = false;
    cam.near = POV.NEAR; cam.far = POV.FAR; cam.updateProjectionMatrix();
    return true;
  }

  /**
   * 끄기. restore = 들어오기 전 카메라 자리로 날아감(자동 카메라가 꺼져 있을 때 — 켜져 있으면 director 가 자기 규칙으로 날아감)
   */
  stop(director, { restore = false } = {}) {
    if (!this.active) return;
    const view = this.view, cam = view.camera, now = performance.now() / 1000;
    this.active = false;
    view.povId = null;
    this._unbind();
    const sv = this._saved || { fov: 30, near: 0.5, far: 2500 };
    // OrbitControls 를 지금 시선 앞 점으로 다시 묶고 켠다(손 조작·자동 비행의 출발점)
    const fwd = this._t.set(0, 0, -1).applyQuaternion(cam.quaternion);
    director.controls.target.copy(cam.position).addScaledVector(fwd, 8);
    director.controls.enabled = true;
    this._back = { t0: now, dur: POV.EXIT, fromFov: cam.fov, toFov: sv.fov, near: sv.near, far: sv.far,
      pos: restore && sv.pos ? sv.pos.clone() : null, tgt: restore && sv.tgt ? sv.tgt.clone() : null, fromPos: cam.position.clone(), fromTgt: director.controls.target.clone() };
    this.id = null; this.gazeId = null; this.gazeShown = null; this.gaze.reset(); this.look.reset(); this._blend = null;
  }

  /** 꺼진 뒤 화각·near 되돌리기(+자동 카메라가 꺼져 있으면 들어오기 전 자리로) — director.update 가 매 프레임 */
  after(dt, now, director) {
    const b = this._back;
    if (!b) return;
    const cam = director.camera;
    const k = Math.min(1, (now - b.t0) / b.dur), e = ease(k);
    cam.fov = b.fromFov + (b.toFov - b.fromFov) * e;
    if (b.pos && b.tgt) {
      cam.position.lerpVectors(b.fromPos, b.pos, e);
      director.controls.target.lerpVectors(b.fromTgt, b.tgt, e);
      cam.lookAt(director.controls.target);
    }
    if (k >= 1) { cam.near = b.near; cam.far = b.far; this._back = null; }
    cam.updateProjectionMatrix();
  }

  /**
   * 한 프레임. director = CameraDirector(_score 로 활성 점수). 반환: 'ok' | 'lost'(대상 캐릭터가 사라짐 — 부르는 쪽이 다른 메인·나가기)
   */
  update(dt, now, director) {
    const view = this.view, cam = view.camera;
    const ch = view.chars.get(this.id);
    if (!ch || ch.state === 'gone' || !ch.placed) return 'lost';
    const fy0 = view._floorY ? view._floorY(ch) : 0; // 연구소 브리지 덱·경사로(— 오피스는 0)
    const eye = povEye({ pos: ch.pos, yaw: ch.yaw, headY: ch.headY() + fy0 }, POV);
    const bodyYaw = ch.yaw || 0;
    // 1) 주시 대상(서 있을 때만 — 걸을 때는 가는 쪽을 봄, 멀미 방지. 걷는 동안은 고르기도 쉼)
    const walking = WALKING.has(ch.state);
    let point = null;
    this.look.step(dt, now);
    if (!walking && !this.look.paused(now)) this.gazeId = this.gaze.step(this._cands(view, director, ch, eye, bodyYaw, now), now);
    this.gazeShown = walking ? null : this.gazeId; // 칩에 보이는 대상
    if (!walking && this.gazeId) point = this._pointOf(view, this.gazeId, ch);
    if (!walking && !point && ch._monK > 0.3) point = this._pointOf(view, this.id, ch); // 대상 없음 → 자기 모니터(열려 있으면)
    const atMon = !walking && ch._monK > 0.3; // 책상에서 모니터가 열려 있으면 고개를 조금만(모니터가 정면에 남게)
    const goal = gazeGoal(bodyYaw, eye, point, this.look.dragging || this.look.yaw || this.look.pitch ? this.look : null, POV, atMon ? POV.DESK_LIMIT : POV.HEAD_LIMIT);
    // 2) 감쇠 — 고개 축 자리는 빠르게(걷기 따라감), 고개는 천천히
    if (!this._inited || ch.state === 'blink') { this._p.set(eye.x, eye.y, eye.z); if (!this._inited) { this._yaw = goal.yaw; this._pitch = goal.pitch; } this._inited = true; }
    else this._p.lerp(this._t.set(eye.x, eye.y, eye.z), damp(POV.POS_RATE, dt));
    if (this.look.dragging) { // 손으로 끌 때는 바로 따라감
      this._yaw = angLerp(this._yaw, goal.yaw, damp(14, dt)); this._pitch += (goal.pitch - this._pitch) * damp(14, dt); this._yv = 0; this._pv = 0;
    } else { // 각속도 상한·가속 완화(멀미 방지) — 움직임 줄이기면 더 느리게
      const rk = this.reduced ? 0.6 : 1;
      const y = turnStep(this._yaw, goal.yaw, this._yv, dt, { rate: POV.YAW_RATE, max: POV.YAW_MAX * rk });
      const p = turnStep(this._pitch, goal.pitch, this._pv, dt, { rate: POV.PITCH_RATE, max: POV.PITCH_MAX_V * rk, angular: false });
      this._yaw = y.v; this._yv = y.vel; this._pitch = p.v; this._pv = p.vel;
    }
    // 3) 카메라 = 고개 축에서 시선 반대쪽으로 EYE_BACK(고개를 돌리면 축 둘레로 돎)
    const d = lookDir(this._yaw, this._pitch);
    const cp = camFromHead(this._p, this._yaw, POV.EYE_BACK);
    const pos = this._c || (this._c = this._p.clone());
    pos.set(cp.x, cp.y, cp.z);
    const tgt = this._t.set(pos.x + d.x, pos.y + d.y, pos.z + d.z);
    const bl = this._blend;
    if (bl) {
      const k = Math.min(1, (now - bl.t0) / bl.dur), e = ease(k);
      cam.position.lerpVectors(bl.pos, pos, e);
      cam.up.set(0, 1, 0);
      cam.lookAt(tgt);
      this._q.copy(cam.quaternion);
      cam.quaternion.slerpQuaternions(bl.quat, this._q, e);
      cam.fov = bl.fov + (this._fov - bl.fov) * e;
      if (k >= 1) this._blend = null;
    } else {
      cam.position.copy(pos);
      cam.lookAt(tgt);
      cam.fov += (this._fov - cam.fov) * damp(6, dt);
    }
    cam.updateProjectionMatrix();
    director.controls.target.copy(cam.position).addScaledVector(this._t.set(d.x, d.y, d.z), 6); // 안개 거리(focusDist)·나갈 때 출발점
    view.focusDist = 6;
    return 'ok';
  }

  /** 주시 후보: 지금 일하는(workScore > 0) 보이는 노드 — 가까운 것, 등 뒤는 낮게, 자기 모니터는 SELF_K */
  _cands(view, director, ch, eye, bodyYaw, now) {
    const out = this._cl || (this._cl = []);
    out.length = 0;
    for (const [id, v] of view.vis) {
      if (!v || !v.node) continue;
      if (view._isDim && view._isDim(id)) continue;
      const s0 = director._score(id, now);
      if (!(s0 > 0)) continue;
      if (id === this.id) {
        if (ch._monK > 0.3 && ch.atDesk && ch.atDesk()) out.push({ id, s: gazeScore(s0, { self: true }) });
        continue;
      }
      const p = this._pointOf(view, id, ch);
      if (!p) continue;
      const a = aimAngles(eye, p);
      const s = gazeScore(s0, { rel: angDiff(bodyYaw, a.yaw), dist: Math.hypot(p.x - eye.x, p.z - eye.z) });
      if (s > 0) out.push({ id, s });
    }
    return out;
  }

  /** 볼 점: 자기 = 모니터 가운데, 직원 = 가슴·얼굴 사이, 기계 = 그 자리 */
  _pointOf(view, id, self) {
    const P = this._pt;
    if (id === this.id) {
      const mf = self._monFit;
      if (!mf || !(self._monK > 0.05)) return null;
      P.x = mf.x; P.z = mf.z; P.y = (MON_BASE_Y + (mf.top || MON_BASE_Y + 1)) / 2;
      return P;
    }
    const c = view.chars.get(id);
    if (c && c.placed && c.state !== 'gone') { P.x = c.pos.x; P.y = c.headY() - 0.3 + (view._floorY ? view._floorY(c) : 0); P.z = c.pos.z; return P; }
    const v = view.vis.get(id);
    if (!v || !v.target) return null;
    P.x = v.target.x; P.y = v.target.y; P.z = v.target.z;
    return P;
  }

  // ---------- 둘러보기(끌기)·화각(휠) ----------
  _bind(view) {
    this._unbind();
    const dom = this._dom = view.renderer.domElement;
    dom.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
    dom.addEventListener('wheel', this._onWheel, { passive: false });
  }
  _unbind() {
    const dom = this._dom;
    if (dom) { dom.removeEventListener('pointerdown', this._onDown); dom.removeEventListener('wheel', this._onWheel); }
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
    this._dom = null; this._down = null;
  }
  _pd(e) { if (!this.active || (e.button != null && e.button !== 0 && e.button !== 2)) return; this._down = { x: e.clientX, y: e.clientY, moved: false }; }
  _pm(e) {
    const d = this._down;
    if (!this.active || !d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return; // 클릭(노드 고르기·빈 곳 나가기)은 그대로
    if (!d.moved) { d.moved = true; this.look.start(); }
    this.look.move(dx, dy);
    d.x = e.clientX; d.y = e.clientY;
  }
  _pu() { if (this._down && this._down.moved) this.look.end(performance.now() / 1000); this._down = null; }
  _wh(e) {
    if (!this.active) return;
    e.preventDefault();
    this._fov = Math.max(POV.FOV_MIN, Math.min(POV.FOV_MAX, this._fov * (e.deltaY > 0 ? 1.06 : 1 / 1.06)));
  }
}
