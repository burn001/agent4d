// 카메라: OrbitControls + 자동 투어 + 수동 조작 10초 규칙
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STALE_DWELL, isShown, isLive, isBusy, pickBest, shotLost, shotStale, shownAncestor, fitFrame, flightPose, boxCenter, requiredDist, refineFit, FitHold, safeBand, ZOOM, autoFloor, nearestKids, FIT, isFitActive, pickFitIds, PanelMemo, boxCorners, pxToE, shotFitScope, workScore, busyAlt, ShotHold, shotKey } from './camera-core.mjs';
import { stageInsets } from './screen-insets.js';
import { bestPose, perspPose, needRepack } from './overview/fill-pack.mjs';
import { legacyPack } from './overview/pack-view.js';

import { t } from './i18n.mjs';
import { promptCamPlan } from './camera-core.mjs'; // 입력 때 메인으로(Follow my prompts)
import { GitHold, gitHoldPick, gitHoldLabel, GIT_HOLD } from './camera-core.mjs'; // git 동작 붙잡기
const HAS = (view, id) => { const v = view && view.vis && view.vis.get(id); return !!(v && !v.gone && !v.hidden); };
const SWITCH_EVERY = 8;      // 초
const RESUME_AFTER = 10;     // 초
const IDLE_OVERVIEW = 30;    // 초
const TRANSITION = 1.6;      // 초
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const ORBIT = 0.05;          // rad/s
// 쉬는 동안 느린 왕복 궤도(전체 맞춤 모드): 표현이 cameraPrefs.idleOrbit = {amp(도), period(초)} 를 주면(흐름 3D) — 없으면 예전처럼 공전 없음.
// '쉼' = 최근 CALM_WIN 초 '굵은' 이벤트(노드 추가·도구 시작·사용자 입력 — 갱신·출력 조각은 세지 않음) 비율이 CALM_LO/초 이하면 1,
// CALM_HI/초 이상이면 0(사이는 직선), 부드럽게 따라감. 움직임 줄이기면 없음. 실측(mock 단일 세션, 에이전트 여럿): 굵은 이벤트 약 3.7/초
const CALM_WIN = 6, CALM_LO = 2.0, CALM_HI = 6.0;
const CALM_EV = new Set(['node-add', 'tool-start', 'user']);
const prefersReduced = () => { try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
// 전체 맞춤 화면 여백: 반화각 탄젠트에 곱하는 비율(홀로그램 패널·말풍선·라벨이 잘리지 않게), 노드 반지름 덧댐
const FIT_MH = 0.95, FIT_MV = 0.94; // 여백 5～6%(예전 0.92·0.86)
 // 화면 채움 비율·노드 여백(예전 0.84·0.78·1.4·1.8 — 너무 멀다는 피드백으로 당김)
export const CAM_MODES = ['fit', 'follow'];
// 렌더러가 cameraPrefs 를 안 주면 쓰는 값(1차 상수와 같음). azCenter/azRange(도)는 선택: 주면 방위각을 그 범위에 묶고 공전이 왕복한다
const PREF_DEFAULTS = { fov: 50, elevMin: 20, elevMax: 55, distMin: 8, distMax: 160, overviewScale: 1.0, nodeScale: 1.35, minR: 7, azCenter: null, azRange: null };

export class CameraDirector {
  /** @param {import('./scene.js').SceneView} view */
  constructor(view, getNode) {
    this.view = view;
    this.getNode = getNode;   // id → node (status 확인용)
    this.camera = view.camera;
    this._makeControls();

    this.enabled = true;        // 자동 카메라 토글
    this.mode = 'auto';         // auto | manual
    this.lastInput = -1e9;
    this.dragging = false;
    this.shot = { type: 'overview' };
    this.lastSwitch = -1e9;
    this.tour = 0;
    this.prevTarget = null;
    this.trans = null;          // {t0, fromPos, fromTgt, dir}
    this.activity = new Map();  // id → [t...]
    this.added = new Map();     // id → t
    this.lastEventAt = performance.now() / 1000;
    this.onStatus = null;
    this._lastStatus = '';
    this._center = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._orbitDir = 1;
    // 전체 보기. mode 'session' 이면 1·2차 규칙 그대로
    this.scope = { mode: 'session', focusProject: null, focusSession: null, focusNode: null };
    this.prevCluster = null;
    this.curCluster = null;
    // 자동 카메라 방식: 'fit' = 살아 있는 노드 전체 맞춤(기본), 'follow' = 활동 노드 따라가기(예전 순환)
    this.camMode = 'fit';
    this.fit = new FitHold();
    this.shotFit = new FitHold(); // 조망 샷(전체 조망·프로젝트 섬)의 노드 맞춤 유지 — 샷이 바뀔 때마다 새로
    this.git = new GitHold(); // git 동작 붙잡기 장부
    this.gitHold = null;      // 이번 프레임에 붙잡는 것(최근 순) | null
    this._gitSig = '';

    this._onManual = () => this._manual();
    this._bindDom();
    window.addEventListener('keydown', (e) => this._key(e));
  }

  _makeControls() {
    const cam = this.camera;
    const dom = this.view.renderer.domElement;
    const c = this.controls = new OrbitControls(cam, dom);
    c.enableDamping = true; c.dampingFactor = 0.08;
    c.screenSpacePanning = true;
    c.minDistance = 3; c.maxDistance = 600;
    c.zoomToCursor = true;
    c.target.set(0, 0, 0);
    c.addEventListener('start', () => { this.dragging = true; this._manual(); });
    c.addEventListener('end', () => { this.dragging = false; this._manual(); });
    const p = this._prefs();
    if (this.scope && this.scope.mode === 'all') c.maxDistance = Math.max(600, (p.overviewDistMax || 0) * 1.25);
    if (p.fov && Math.abs(cam.fov - p.fov) > 1e-6) { cam.fov = p.fov; cam.updateProjectionMatrix(); }
  }

  // OrbitControls 가 잡지 않는 입력도 수동으로 취급
  _bindDom() {
    const dom = this._dom = this.view.renderer.domElement;
    dom.addEventListener('wheel', this._onManual, { passive: true });
    dom.addEventListener('touchstart', this._onManual, { passive: true });
    dom.addEventListener('pointerdown', this._onManual);
  }
  _unbindDom() {
    const dom = this._dom;
    if (!dom) return;
    dom.removeEventListener('wheel', this._onManual);
    dom.removeEventListener('touchstart', this._onManual);
    dom.removeEventListener('pointerdown', this._onManual);
    this._dom = null;
  }

  _prefs() {
    const vp = this.view && this.view.cameraPrefs;
    if (this._prefsSrc === vp && this._prefsVal) return this._prefsVal;
    this._prefsSrc = vp;
    return (this._prefsVal = { ...PREF_DEFAULTS, ...(vp || {}) });
  }

  /** 표현 모드 전환: 새 view 의 camera·canvas 로 컨트롤을 다시 만든다. enabled·mode·tour·activity 는 유지 */
  attach(view) {
    if (!view || view === this.view) return;
    this._unbindDom();
    if (this.controls) this.controls.dispose();
    this.view = view;
    this.camera = view.camera;
    this._prefsVal = null;
    this._makeControls();
    this._bindDom();
    this.dragging = false;
    this.trans = null;
    this.focusFly = false;
    // 대상은 그대로 두고(새 view 에도 같은 노드가 있다 — 없으면 다음 프레임에 잃음 규칙으로 다시 고름) 새 카메라에서 그리로 날아간다.
    // 예전엔 overview 로 바꾸고 비행 없이 머물기 보간만 해서, 새 카메라 기본 자리에서 8초 동안 엉뚱한 곳을 보았다
    if (this.shot.type === 'cluster' && this.scope.mode !== 'all') this.shot = { type: 'overview' };
    this.fit.reset(); // 화각·고도가 다른 새 카메라 기준으로 다시 맞춤
    if (this._panMemo) this._panMemo.clear(); // 패널·라벨 자리는 표현마다 다르다
    if (this._labMemo) this._labMemo.clear();
    this._orbitDir = 1;
    this._startTransition();
  }

  // ---------- 입력 ----------
  _manual() {
    this.lastInput = performance.now() / 1000;
    this.mode = 'manual';
    this.trans = null;
  }

  _key(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const pan = { arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0], arrowup: [0, 1], w: [0, 1], arrowdown: [0, -1], s: [0, -1] }[k];
    const zoom = { '+': 0.85, '=': 0.85, '-': 1.18, '_': 1.18, q: 1.18, e: 0.85 }[k];
    if (!pan && !zoom) return;
    e.preventDefault();
    this._manual();
    const cam = this.camera, c = this.controls;
    if (pan) {
      const dist = cam.position.distanceTo(c.target);
      const step = dist * 0.06;
      const right = this._v.setFromMatrixColumn(cam.matrix, 0).multiplyScalar(pan[0] * step);
      const up = this._v2.setFromMatrixColumn(cam.matrix, 1).multiplyScalar(pan[1] * step);
      cam.position.add(right).add(up); c.target.add(right).add(up);
    } else {
      const off = this._v.copy(cam.position).sub(c.target).multiplyScalar(zoom);
      cam.position.copy(c.target).add(off);
    }
  }

  /** 수동 조작 대기(RESUME_AFTER)를 건너뛰고 지금 자동 카메라로 돌아간다 — 빈 곳 클릭 */
  resumeAuto() {
    if (!this.enabled || this.dragging) return;
    this.lastInput = -1e9;
    this.mode = 'auto';
    this.lastSwitch = -1e9;
    this._flyNext = true; // 손으로 옮긴 자리에서 날아 돌아온다
  }

  setEnabled(on) {
    this.enabled = on;
    if (on && !this.hold) { this.mode = 'auto'; this.lastSwitch = -1e9; this._flyNext = true; }
    else this.mode = 'manual';
  }

  // ---------- 상세 팝업: 객체로 다가가 머묾 — 팝업이 닫힐 때(release)까지 10초 복귀 없음 ----------
  /** t = {type:'node', id} | {type:'cluster', pid}. follow = 객체가 움직이면 시선을 따라감 */
  inspect(t, follow = false) {
    if (!t) return;
    this.hold = { follow: !!follow };
    this._manual();
    if (t.type === 'plan') return; // 계획 보드 크게 보기: 보드는 월드 고정 — 카메라는 그 자리에 멈추고 카드만
    this.shot = t.type === 'cluster' ? { type: 'cluster', pid: t.pid } : { type: 'node', id: t.id };
    this._startTransition(1.0);
    this.focusFly = true;
  }
  setFollow(on) { if (this.hold) this.hold.follow = !!on; }
  /** 팝업 닫힘 → 부드럽게 자동 카메라로(꺼져 있으면 그 자리) */
  release() {
    if (!this.hold) return;
    this.hold = null;
    if (this.enabled) { this.dragging = false; this.resumeAuto(); }
  }

  /** 자동 카메라 방식 전환: 'fit'(살아 있는 노드 전체, 기본) | 'follow'(활동 노드 따라가기) */
  setCamMode(m) {
    m = m === 'follow' ? 'follow' : 'fit';
    if (m === this.camMode) return;
    this.camMode = m;
    this.fit.reset();
    this.shot = m === 'fit' ? { type: 'fit' } : { type: 'overview' };
    this.lastSwitch = -1e9;
    this.tour = 0;
    if (this.mode === 'auto') this._startTransition();
  }

  // ---------- 이벤트 기록 ----------
  /** opts = {quiet, batch, speed}(app.onEvent) — 스크럽·밀린 이벤트·서버 묶음·몰림 정리·8배속↑ 의 git 동작은 붙잡지 않음 */
  noteEvent(ev, opts = {}) {
    const now = performance.now() / 1000;
    this.lastEventAt = now;
    this.git.event(ev, now, this._clk(), opts);
    if (CALM_EV.has(ev.type)) {
      const tl = this._evT || (this._evT = []);
      tl.push(now);
      if (tl.length > 600) tl.splice(0, tl.length - 600);
    }
    if (!ev.nodeId) return;
    let a = this.activity.get(ev.nodeId);
    if (!a) { a = []; this.activity.set(ev.nodeId, a); }
    a.push(now);
    if (a.length > 200) a.splice(0, a.length - 200);
    if (ev.type === 'node-add') this.added.set(ev.nodeId, now);
  }

  resetActivity() { this.git.clear(); this.gitHold = null; this._gitSig = ''; this.activity.clear(); this.added.clear(); this.prevTarget = null; this.lastSwitch = -1e9; this.shot = { type: this.camMode === 'fit' ? 'fit' : 'overview' }; this.fit.reset(); this.prevCluster = null; this.curCluster = null; }

  /** 전체 보기 범위. focusProject 가 바뀌면 1.6초에 걸쳐 그 클러스터로 이동하고 순환을 그 안으로 좁힌다 */
  // focusSession(루트 세션 id)·focusNode('s:<세션>')를 주면 순환 후보를 그 세션 트리로 더 좁히고 그 메인 노드부터 비춘다
  setScope({ mode = 'session', focusProject = null, focusSession = null, focusNode = null } = {}) {
    const m = mode === 'all' ? 'all' : 'session';
    const fp = m === 'all' ? focusProject || null : null;
    const fs = m === 'all' ? focusSession || null : null;
    const fn = fs ? focusNode || 's:' + fs : null;
    const changed = m !== this.scope.mode || fp !== this.scope.focusProject || fs !== this.scope.focusSession || fn !== this.scope.focusNode;
    this.scope = { mode: m, focusProject: fp, focusSession: fs, focusNode: fn };
    if (this.controls) this.controls.maxDistance = m === 'all' ? Math.max(600, (this._prefs().overviewDistMax || 0) * 1.25) : 600;
    if (!changed) return;
    this.tour = 0;
    this.prevTarget = null;
    this.prevCluster = null;
    this.curCluster = fp;
    if (m === 'all' && fn && this.view.has(fn)) {
      this.shot = { type: 'node', id: fn, wide: true };
      this.prevTarget = fn;
      this.tour = 1;
    } else if (m === 'all' && fp) {
      this.shot = { type: 'cluster', pid: fp };
      this.tour = 1; // 다음 박자는 노드
    } else this.shot = { type: 'overview' };
    if (this.camMode === 'fit') { this.shot = { type: 'fit' }; this.fit.reset(); } // 맞춤: 새 범위의 살아 있는 노드 전체
    this.lastSwitch = performance.now() / 1000;
    this._startTransition(TRANSITION);
    this.focusFly = true; // 수동 조작 중이어도 선택한 곳으로 한 번 이동
  }

  /** 세션 범위의 메인 노드가 setScope 뒤에 도착했으면 그때 그 세션으로 이동(넓은 구도) */
  scopeNodeArrived(id) {
    if (this.scope.mode !== 'all' || this.scope.focusNode !== id || !this.view.has(id)) return;
    if (this.camMode === 'fit') { this.shot = { type: 'fit' }; this.fit.reset(); this._startTransition(TRANSITION); this.focusFly = true; return; }
    if (this.shot.type === 'node' && this.shot.id === id) return;
    this.shot = { type: 'node', id, wide: true };
    this.prevTarget = id;
    this.tour = 1;
    this.lastSwitch = performance.now() / 1000;
    this._startTransition(TRANSITION);
    this.focusFly = true;
  }

  _clusterOf(id) {
    const v = this.view;
    if (v.nodeCluster) { const p = v.nodeCluster(id); if (p) return p; }
    const n = this.getNode(id);
    return n ? n.projectId || null : null;
  }

  // ---------- 후보 ----------
  _dim(id) { const v = this.view; return v._isOut ? !!v._isOut(id) : v._isDim ? !!v._isDim(id) : false; } // 복셀: 나가는 프로젝트는 바로 후보에서 뺌
  _shownId(id) { return isShown(this.view.vis.get(id), this._dim(id)); }
  _lastAt(id) { const a = this.activity.get(id); return a && a.length ? a[a.length - 1] : null; }
  _parentOf(id) {
    const po = this.view.parentOf;
    if (po && typeof po.get === 'function' && po.has(id)) return po.get(id) || null;
    const n = this.getNode(id);
    return n ? n.parentId || null : null;
  }
  /** 렌더러 시계(라이브 = 지금, 재생 = 가상 시계) — 실행 중 셸 경과·정체 판정 */
  _clk() { const v = this.view; return v && typeof v.clock === 'function' ? v.clock() : Date.now(); }
  _busyId(id, now) { return isBusy(this.view.vis.get(id), this._lastAt(id), now, this._clk()); }
  /** 조용해진 대상(id, 섬 pid)에서 넘어갈 일하는 노드: 'same'(같은 섬) | 'other'(섬이 통째로 쉼, 다른 섬) | null */
  _busyAlt(now, id, pid) { return busyAlt(this._collect(now).map((x) => ({ id: x.id, pid: x.pid, busy: this._busyId(x.id, now) })), id, pid); }
  /** 화면에 보이고 지금 활동 중인 노드인가(숨김·퇴장·희미·끝난 노드 제외) */
  _liveId(id, now) { const v = this.view.vis.get(id); return !!v && this._shownId(id) && isLive(v, this._lastAt(id), now, this._clk()); }

  /** 지금 범위(세션 선택 = 그 트리, 프로젝트 선택 = 그 섬, 전체 = 섬이 있는 노드)에 드는가 — _collect 와 같은 규칙 */
  _inScope(id, v) {
    if (this.scope.mode !== 'all') return true;
    const fp = this.scope.focusProject, fsid = this.scope.focusSession;
    if (fsid) return !!(v && v.node && v.node.rootSessionId === fsid);
    const pid = this._clusterOf(id);
    return !!pid && (!fp || pid === fp);
  }

  /**
   * git 동작 붙잡기: 이번 프레임에 붙잡을 것을 정하고(우선순위 gitHoldPick), 바뀌면 비행 — 시작 = 그 노드로(맞춤은 그 노드·패널·라벨·포털,
   * 따라가기는 그 노드 샷), 풀림 = 원래 규칙으로 복귀 비행. 반환 = 붙잡는 중인가
   */
  _gitStep(now, prompting) {
    const all = this.git.active(now, this._clk());
    const follow = this.camMode === 'follow';
    const list = gitHoldPick(all, { enabled: this.enabled, auto: this.mode === 'auto', inspect: !!this.hold, prompt: prompting, follow }, (id) => HAS(this.view, id) && this._shownId(id) && this._inScope(id, this.view.vis.get(id)), (id) => { const n = this.getNode(id); return (n && n.rootSessionId) || this._clusterOf(id) || ''; });
    const ids = [...new Set(list.map((h) => h.id))];
    const sig = ids.length ? (follow ? 'f|' : 'a|') + ids.join(',') : '';
    const was = this._gitSig;
    this.gitHold = list.length ? list : null;
    if (sig === was) return !!list.length;
    this._gitSig = sig;
    if (list.length) {
      this.shot = follow ? { type: 'node', id: ids[0], git: true } : { type: 'fit' };
      if (follow) this.prevTarget = ids[0];
      this.fit.reset();
      this._startTransition(GIT_HOLD.FLY);
      return true;
    }
    if (this.shot.git) this.shot = { type: this.camMode === 'fit' ? 'fit' : 'overview' };
    if (was && this.mode === 'auto') { // 풀림: 원래 규칙으로 부드럽게(맞춤은 다시 맞춰 날고, 따라가기는 바로 다시 고름)
      this.fit.reset();
      this.lastSwitch = -1e9;
      this._flyNext = true;
    }
    return false;
  }

  /** 지금 범위(세션 선택·프로젝트 선택·전체)에 드는 활동 노드 [{id, s, pid}] */
  _collect(now) {
    const out = [];
    const all = this.scope.mode === 'all';
    const fp = all ? this.scope.focusProject : null, fsid = all ? this.scope.focusSession : null;
    for (const [id, v] of this.view.vis) {
      if (!this._liveId(id, now)) continue;
      if (fsid && (!v.node || v.node.rootSessionId !== fsid)) continue;
      const pid = all ? this._clusterOf(id) : null;
      if (all && !fsid && (!pid || (fp && pid !== fp))) continue;
      out.push({ id, s: this._score(id, now), pid });
    }
    return out;
  }

  /** 전체 보기 선택: [전체 조망, 클러스터, 노드, 노드] / 프로젝트 선택 시 [클러스터, 노드, 노드, 노드] */
  _pickAll(now) {
    const fp = this.scope.focusProject;
    const beat = this.tour % 4;
    this.tour++;
    const fsid = this.scope.focusSession, fnode = this.scope.focusNode;
    const idle = now - this.lastEventAt > IDLE_OVERVIEW;
    const live = this._collect(now);
    // 세션 선택: 그 세션 트리(rootSessionId) 안 노드만 순환, 박자 0·한가함·후보 없음이면 메인 노드 넓게
    if (fsid) {
      const home = fnode && this.view.has(fnode) ? { type: 'node', id: fnode, wide: true } : (fp ? { type: 'cluster', pid: fp } : { type: 'overview' });
      if (idle || beat === 0 || !live.length) return home;
      const id = pickBest(live.map((x) => [x.id, x.s]), this.prevTarget);
      return id ? { type: 'node', id } : home;
    }
    const cls = this.view.clusters ? this.view.clusters() : [];
    // 클러스터별 점수(노드 점수 합)와 후보 노드
    const score = new Map(), cand = new Map();
    for (const x of live) {
      score.set(x.pid, (score.get(x.pid) || 0) + x.s);
      if (!cand.has(x.pid)) cand.set(x.pid, []);
      cand.get(x.pid).push([x.id, x.s]);
    }
    if (fp) {
      if (idle || beat === 0 || !cand.has(fp)) return { type: 'cluster', pid: fp };
      return this._pickNodeIn(fp, cand) || { type: 'cluster', pid: fp };
    }
    const active = [...score].filter(([, s]) => s > 0).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
    if (idle || !active.length || !cls.length) return { type: 'overview' };
    if (beat === 0) return { type: 'overview' };
    // 지금 섬이 통째로 쉬면(점수 0) 박자 1 을 기다리지 않고 일하는 섬으로
    if (beat === 1 || !this.curCluster || !cand.has(this.curCluster) || !(score.get(this.curCluster) > 0)) {
      let pid = active[0][0];
      if (active.length > 1 && pid === this.prevCluster) pid = active[1][0];
      this.prevCluster = pid;
      this.curCluster = pid;
      if (beat === 1) return { type: 'cluster', pid };
    }
    return this._pickNodeIn(this.curCluster, cand) || { type: 'cluster', pid: this.curCluster };
  }

  _pickNodeIn(pid, cand) {
    const id = pickBest(cand.get(pid) || [], this.prevTarget);
    return id ? { type: 'node', id } : null;
  }

  /**
   * 대상을 잃었을 때(퇴장·node-remove·숨김·희미) 또는 끝난 대상에 머물 때 바로 다음 대상: 박자(tour)를 넘기지 않고
   * ① 같은 범위의 다른 활동 노드(같은 섬 우선) ② 보이는 조상(넓게) ③ 그 섬 ④ 범위의 집(세션 메인·선택 프로젝트·전체/루트)
   */
  _replace(now, lostShot, busyOnly = false) {
    const lostId = lostShot && lostShot.type === 'node' ? lostShot.id : null;
    let live = this._collect(now).filter((x) => x.id !== lostId);
    if (busyOnly) { // 조용해진 대상 → 같은 섬에서 지금 일하는 노드로, 그 섬이 통째로 쉬면 다른 섬의 일하는 노드로
      const pid = this.scope.mode === 'all' ? (lostId ? this._clusterOf(lostId) : lostShot && lostShot.pid) || null : null;
      const busy = live.filter((x) => this._busyId(x.id, now));
      const same = pid ? busy.filter((x) => x.pid === pid) : busy;
      live = same.length ? same : busy;
    }
    if (live.length) {
      const pid = lostId ? this._clusterOf(lostId) || this.curCluster : this.curCluster;
      const same = this.scope.mode === 'all' && pid ? live.filter((x) => x.pid === pid) : [];
      const id = pickBest((same.length ? same : live).map((x) => [x.id, x.s]), null);
      if (id) {
        if (this.scope.mode === 'all') { const np = (live.find((x) => x.id === id) || {}).pid; if (np && np !== this.curCluster) { this.prevCluster = this.curCluster; this.curCluster = np; } }
        return { type: 'node', id };
      }
    }
    if (lostId) {
      const a = shownAncestor(lostId, (id) => this._parentOf(id), (id) => this._shownId(id));
      if (a) return { type: 'node', id: a, wide: true };
    }
    if (this.scope.mode === 'all') {
      const fn = this.scope.focusNode;
      if (fn && this._shownId(fn)) return { type: 'node', id: fn, wide: true };
      const pid = this.scope.focusProject || (lostId && this._clusterOf(lostId)) || (lostShot && lostShot.pid);
      if (pid && this.view.clusterTarget && this.view.clusterTarget(pid)) return { type: 'cluster', pid };
      return { type: 'overview' };
    }
    const root = this.view.layoutRoot;
    return root && this._shownId(root) ? { type: 'node', id: root, wide: true } : { type: 'overview' };
  }

  /** 'Follow my prompts': 사람 입력이 들어오면 그 메인으로 짧게(0.75초) 날아가 흡수 뒤까지(2.5초) 비추고 원래 흐름으로.
   *  최근 수동 조작·상세 팝업·자동 카메라 끔·큰 재생 배속이면 옮기지 않음(0). 반환 = 빛줄기가 기다릴 카메라 이동 남은 시간(초) */
  promptFocus(id, { speed = 1 } = {}) {
    const now = performance.now() / 1000;
    const p = promptCamPlan({ enabled: this.enabled, manual: this.mode === 'manual', hold: !!this.hold, dragging: !!this.dragging, has: !!(this.view && HAS(this.view, id)), speed });
    if (!p.move) return 0;
    const same = this.prompt && this.prompt.id === id && now < this.prompt.until;
    this.prompt = { id, until: now + p.dur + p.hold };
    if (same) return this.trans ? Math.max(0, this.trans.t0 + this.trans.dur - now) : 0; // 연달아: 이동을 겹쳐(새로 날지 않음)
    this.shot = { type: 'node', id, prompt: true, maxDist: this.camera ? this.camera.position.distanceTo(this.controls.target) : 0 };
    this.prevTarget = id;
    this._startTransition(p.dur);
    return p.dur;
  }
  _promptStep(now) {
    const pr = this.prompt;
    if (!pr) return false;
    if (this.mode !== 'auto' || now >= pr.until || !HAS(this.view, pr.id)) {
      this.prompt = null;
      if (this.mode === 'auto') { this.lastSwitch = -1e9; this._flyNext = true; }
      return false;
    }
    return true;
  }
  /** 노드 클릭 → 그 노드로 포커스 (10초 규칙 적용) */
  focusNode(id) {
    this._manual();
    this.shot = { type: 'node', id };
    this._startTransition(1.0);
    this.focusFly = true;
  }

  overview(immediate = false) {
    this.shot = { type: this.camMode === 'fit' ? 'fit' : 'overview' };
    this.fit.reset();
    if (immediate) { const f = this._frame(this.shot); if (f) { this.controls.target.copy(f.center); this.camera.position.copy(f.center).add(this._dirFrom(f.center).multiplyScalar(f.dist)); } }
    else this._startTransition();
  }

  // ---------- 선택 ----------
  _score(id, now) { // 지금 일하는 노드만 점수(쉬는 노드는 0 — 짧은 알림 턴이 끝난 섬이 20초 창 동안 뽑히지 않게)
    return workScore(this.view.vis.get(id), this.activity.get(id), this.added.get(id), this._lastAt(id), now, this._clk());
  }

  _pick(now) {
    if (this.scope.mode === 'all') return this._pickAll(now);
    this.tour++;
    if (now - this.lastEventAt > IDLE_OVERVIEW) return { type: 'overview' };
    const root = this.view.layoutRoot;
    const rootOk = root && this._shownId(root);
    if (this.tour % 4 === 0) return (this.tour / 4) % 2 === 1 && rootOk ? { type: 'node', id: root, wide: true } : { type: 'overview' };
    const id = pickBest(this._collect(now).map((x) => [x.id, x.s]), this.prevTarget);
    if (!id) return rootOk ? { type: 'node', id: root, wide: true } : { type: 'overview' };
    return { type: 'node', id };
  }

  // ---------- 프레이밍 ----------
  /** 거리 상한 dmax 에서 화면에 담기는 경계구 반지름(_frame 거리식의 역) */
  _rMax(dmax, scale) {
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = Math.max(0.4, Math.min(1, this.camera.aspect));
    return (dmax * Math.sin(fov / 2) * aspect) / scale;
  }

  /** 그 노드의 git 효과 소품 자리(표현이 주는 대상 점: 흐름 포털·Planet 위성 궤도·복셀 발송대) [{x,y,z,r}] */
  _ixPts(id) {
    const v = this.view;
    try { return (v.ix && v.ix.holdPts && v.ix.holdPts(id)) || (v.vx && v.vx.holdPts && v.vx.holdPts(id)) || []; } catch { return []; }
  }

  /** 노드 샷의 점: 대상(늘 포함) + 활동 중인 자손(깊이 무관, 우선) + 보이는 자식(넓은 구도면 전부, 아니면 24개) */
  _nodePts(shot, now) {
    const view = this.view, id = shot.id;
    const at = (k) => (view.shotTarget && view.shotTarget(k)) || view.nodeTarget(k); // 복셀 캐릭터는 가는 자리
    const pts = [{ p: at(id), r: view.nodeRadius(id) + 1.6, must: true }];
    const seen = new Set([id]);
    let kids = view.children(id).filter((k) => this._shownId(k));
    if (!shot.wide) kids = nearestKids(kids, at, pts[0].p || { x: 0, y: 0, z: 0 }, ZOOM.NODE_KIDS); // 가까운 자식 몇 개만
    if (shot.prompt || shot.git) kids = []; // 입력 받은 메인 · git 붙잡기: 그 노드 자체를 크게(자식·하위 활동 노드 훑기 없음)
    if (shot.git) for (const q of this._ixPts(id)) pts.push({ p: { x: q.x, y: q.y, z: q.z }, r: q.r, must: true }); // + 포털(Planet 위성 궤도·복셀 발송대)
    const lim = kids.length;
    for (let i = 0; i < lim; i++) { seen.add(kids[i]); pts.push({ p: at(kids[i]), r: view.nodeRadius(kids[i]) + 1.2, must: this._liveId(kids[i], now) }); }
    // 하위의 하위에서 일하는 노드(서브에이전트의 서브에이전트·claude -p 자식 등)도 들어오게
    const stack = shot.prompt || shot.git ? [] : view.children(id).slice();
    for (let n = 0; stack.length && n < 400; n++) {
      const k = stack.pop();
      if (!seen.has(k) && this._liveId(k, now)) { seen.add(k); pts.push({ p: at(k), r: view.nodeRadius(k) + 1.2, must: true }); }
      const kk = view.children(k);
      for (let i = 0; i < kk.length; i++) stack.push(kk[i]);
    }
    return pts.filter((q) => q.p);
  }

  /** 맞춤에 쓸 카메라 방향(시선점 → 카메라): 비행 중이면 도착 방향, 아니면 지금 실제 방향(고도 제한으로 고치지 않음 — 맞춤 유지는 방향을
   *  바꾸지 않으므로, 고친 방향으로 재면 실제 화면과 어긋나 한쪽이 비거나 잘렸다) */
  _fitDir() {
    if (this.trans && this.trans.dir) return this.trans.dir;
    const d = this._v.copy(this.camera.position).sub(this.controls.target);
    return d.lengthSq() > 1e-6 ? d.normalize().clone() : this._dirFrom(this.controls.target);
  }

  /** 카메라 방향 dir(시선점 → 카메라)의 화면 기저: F 앞, R = F × 위(0,1,0) 정규화, U = R × F */
  _fitBasis(dir) {
    const F = { x: -dir.x, y: -dir.y, z: -dir.z };
    const rl = Math.hypot(F.z, F.x) || 1;
    const R = { x: -F.z / rl, y: 0, z: F.x / rl };
    const U = { x: R.y * F.z - R.z * F.y, y: R.z * F.x - R.x * F.z, z: R.x * F.y - R.y * F.x };
    return { F, R, U };
  }

  /**
   * 맞춤 대상 점: 지금 범위(전체 보기 무선택 = 보이는 노드 전체, 프로젝트 선택 = 그 섬, 세션 선택 = 그 트리)의
   * **활성** 노드(끝나지 않았고 작업 중이거나 열린 도구가 있음 — 없으면 보이는 노드 전부) + 그 노드의 펼친 도구 패널 자리(최근 PANEL_KEEP 초).
   * 섬 바닥·섬 상자·작업 대상 층·복셀 방 모서리는 담지 않는다(예전엔 담아 노드가 작게 보였다). basis = 이번 맞춤의 화면 기저.
   * sc = {pid, sid}(조망 샷 범위, shotFitScope) — 주면 지금 범위 대신 그 섬·세션
   */
  _fitPts(basis, sc = null) {
    const view = this.view, all = this.scope.mode === 'all';
    const fp = sc ? sc.pid : all ? this.scope.focusProject : null, fsid = sc ? sc.sid : all ? this.scope.focusSession : null;
    const list = [];
    for (const [id, v] of view.vis) {
      if (!this._shownId(id)) continue;
      if (fsid && (!v.node || v.node.rootSessionId !== fsid)) continue;
      if (fp && !fsid && this._clusterOf(id) !== fp) continue;
      list.push([id, isFitActive(v, v.icons ? v.icons.size || 0 : 0, this._clk())]);
    }
    const gh = !sc && this.gitHold ? [...new Set(this.gitHold.map((h) => h.id))].filter((id) => this._shownId(id)) : null; // 붙잡은 노드만
    const ids = gh && gh.length ? gh : pickFitIds(list);
    const now = this._now || performance.now() / 1000;
    const B = basis || this._fitBasis(this._fitDir());
    const pan = view.fitPanels ? view.fitPanels(this._panMap || (this._panMap = new Map())) : null;
    const memo = this._panMemo || (this._panMemo = new PanelMemo());
    const lmemo = this._labMemo || (this._labMemo = new PanelMemo(FIT.LABEL_KEEP));
    const unit = ((view.container && view.container.clientHeight) || 1) / 2 / Math.tan((this.camera.fov * Math.PI) / 360); // 반화각 탄젠트 1 = 이만큼 px
    const labs = view.fitLabels ? view.fitLabels(this._labMap || (this._labMap = new Map())) : null;
    const lanc = this._lanc || (this._lanc = new Map()); // 기억 칸 → 마지막 세계 기준점(노드 기준 오프셋)
    const pts = [];
    for (const id of ids) {
      const p = view.nodeTarget ? view.nodeTarget(id) : null;
      if (!p) continue;
      const nr = view.fitNodeR ? view.fitNodeR(id) : view.nodeRadius ? view.nodeRadius(id) : 1;
      pts.push({ p, r: nr * FIT.NODE_K + FIT.NODE_PAD });
      // 라벨·이름표·말풍선(DOM, 화면 크기 고정): 세계 기준점 + 기준점 기준 px 상자 → 화면 고정 몫 e(LABEL_KEEP 초 기억)
      const o = (view.nodePos && view.nodePos(id)) || p;
      const ls = labs && labs.get(id);
      if (ls) for (let k = 0; k < ls.length; k++) { const key = id + '|' + k; lmemo.put(key, now, ls[k].b); lanc.set(key, { x: ls[k].p.x - o.x, y: ls[k].p.y - o.y, z: ls[k].p.z - o.z }); }
      for (let k = 0; k < 4; k++) {
        const key = id + '|' + k, b = lmemo.get(key, now), a = b && lanc.get(key);
        if (!b) { lanc.delete(key); if (k) break; continue; }
        if (a) pts.push({ p: { x: p.x + a.x, y: p.y + a.y, z: p.z + a.z }, r: 0, e: pxToE(b, unit), label: true, aux: true });
      }
      const cs = pan && pan.get(id);
      if (cs && cs.length) {
        const o = (view.nodePos && view.nodePos(id)) || p; // 패널은 그려진 노드 자리 기준(target 으로 옮겨 감)
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const c of cs) {
          const dx = c.x - o.x, dy = c.y - o.y, dz = c.z - o.z;
          const x = dx * B.R.x + dy * B.R.y + dz * B.R.z, y = dx * B.U.x + dy * B.U.y + dz * B.U.z;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        memo.put(id, now, { x0, x1, y0, y1 });
      }
      const b = memo.get(id, now);
      if (b) { const w = ((b.x1 - b.x0) * (b.y1 - b.y0)) / 4; for (const q of boxCorners(p, b, B.R, B.U)) { q.aux = true; q.w = w; pts.push(q); } } // 패널 = 보조 점, 넓이를 네 모서리에 나눠 무게중심에
    }
    if (gh && gh.length) for (const id of gh) for (const q of this._ixPts(id)) pts.push({ p: { x: q.x, y: q.y, z: q.z }, r: q.r, aux: true }); // 원격 저장소 포털·발송대
    return pts;
  }

  /**
   * 전체 맞춤 구도: 대상 점(활성 노드·패널 모서리)을 지금 카메라 방향으로 투영해, 맞춤 띠(하단 덮개·라벨 자리를 뺀 화면)의
   * 가로·세로 여백 6% 안을 꽉 채우는 거리와 투영 상자 가운데로 옮긴 시선점(refineFit). 히스테리시스(FitHold)로 작은 변화엔 그대로
   */
  _fitFrame(sc = null, hold = this.fit) {
    const now = this._now || performance.now() / 1000;
    const key = sc ? (sc.pid || '') + '|' + (sc.sid || '') : 'g' + this._gitSig;
    if (this._fitCache && this._fitCache.at === now && this._fitCache.key === key) return this._fitCache.f;
    const pr = this._prefs();
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = Math.max(0.4, this.camera.aspect || 1);
    const t = Math.tan(fov / 2);
    const B = this._fitBasis(this._fitDir());
    const pts = this._fitPts(B, sc);
    // 노드가 하나뿐일 때의 바닥: minR × MIN_R_K 구가 띠 높이(짧은 쪽)를 채우는 거리, 수동 최소 거리보다는 멀리(예전 minR × nodeScale 구 — 너무 멀었다)
    const dmin = autoFloor((pr.minR * FIT.MIN_R_K) / (t * Math.min(1, aspect)), this.controls && this.controls.minDistance);
    const dmax = Math.max(pr.distMax, pr.overviewDistMax || pr.distMax);
    let f;
    if (!pts.length) { // 보이는 노드가 없으면 그 자리에 머문다(섬으로 물러나지 않음)
      const d = this.camera.position.distanceTo(this.controls.target);
      f = { center: this.controls.target.clone(), dist: d, r: d * t, n: 0 };
    } else {
      const { R, U, F } = B;
      // 화면 아래 이벤트 띠·매크로 타임라인·재생 막대와 라벨 자리를 뺀 띠에 담는다
      const band = this._band(true); // 라벨은 점마다(e) 담으므로 띠에서 라벨 자리를 따로 빼지 않음
      const tanV = t * (1 - FIT.M) * band.k, tanH = t * aspect * (1 - FIT.M);
      // 띠 가운데(덮개 위)를 맞춤 식 안에서(vOff): 시선점은 화면 가운데 그대로, 띠 위·아래 끝까지 각각 잰다 — 예전처럼 맞춘 뒤 시선점을
      // 옮기면 원근 때문에 가까운(화면 아래) 점이 더 많이 올라가 아래가 비었다
      const vOff = band.yc * t;
      const want = refineFit(pts, boxCenter(pts), R, U, F, tanH, tanV, 4, vOff, this.view.fitMass !== false && !(this.gitHold && !sc)); // 붙잡는 동안은 노드·포털 상자 가운데(무게중심은 노드 쪽으로 쏠려 포털이 가장자리로) // + 시각 무게중심 // 투영 상자 가운데로 3～4회 보정 — 가로나 세로 한쪽이 여백 끝까지
      const here = hold.c ? requiredDist(pts, hold.c, R, U, F, tanH, tanV, vOff) : Infinity;
      hold.step(now, want, here, dmin, dmax, { freeze: !!this.view.exitSettling }); // 퇴장 연출 중엔 줄이지 않고, 끝난 뒤 한 번만
      f = { center: new THREE.Vector3(hold.c.x, hold.c.y, hold.c.z), dist: hold.D, r: want.D * t, n: pts.length };
    }
    this._fitCache = { at: now, key, f };
    return f;
  }

  _frame(shot) {
    if (shot.type === 'fit') return this._fitFrame();
    const view = this.view;
    const now = this._now || performance.now() / 1000;
    const pr = this._prefs();
    let pts = [];
    const all = this.scope.mode === 'all' && view.clusters;
    let wide = false;
    // 전체 조망·프로젝트 섬 샷: '구도: 전체'와 같은 맞춤 점(활성 노드 + 도구 패널·라벨)으로 — 섬 상자·바닥판·작업 대상 층·
    // 복셀 방 모서리는 담지 않음(예전엔 섬 상자·섬 노드 + 작업 대상 층(fitExtra3d)을 담아 노드·패널이 작게 보였다)
    const sc = shotFitScope(shot, this.scope);
    if (sc && !legacyPack()) { const f = this._fitFrame(sc, this.shotFit); if (f.n) return f; }
    const bpts = all ? this._boxPts(shot) : null; // 섬 상자 꼭짓점으로 투영 맞춤(경계구 대신 — 납작한 섬이 화면을 꽉 채우게)
    if (bpts) return this._projFrame(bpts, pr);
    if (all && shot.type === 'cluster') {
      const c = view.clusterTarget && view.clusterTarget(shot.pid);
      if (c) pts.push({ p: c.center, r: c.r });
      wide = true;
    } else if (all && shot.type === 'overview' && view.clusters().length) {
      const fp = this.scope.focusProject;
      const c = fp && view.clusterTarget ? view.clusterTarget(fp) : null;
      if (c) pts.push({ p: c.center, r: c.r });
      else for (const k of view.clusters()) pts.push({ p: k.center, r: k.r });
      wide = true;
    } else if (shot.type === 'node' && view.has(shot.id)) {
      pts = this._nodePts(shot, now);
    } else {
      // 전체 보기(단일 세션): 보이는 노드 전부. 활동 노드를 앞에 두어 넘칠 때도 그것들이 남게
      const live = [], rest = [];
      for (const [id, v] of view.vis) {
        if (!this._shownId(id)) continue;
        const q = { p: v.target, r: v.r + 1, must: false };
        if (this._liveId(id, now)) { q.must = true; live.push(q); } else rest.push(q);
      }
      live.sort((a, b) => b.r - a.r);
      pts = live.concat(rest);
    }
    if (!pts.length) return { center: new THREE.Vector3(), dist: 40, r: 10 };
    const isNode = shot.type === 'node';
    const deep = isNode && !wide && !shot.wide; // 노드 샷(넓은 구도 아님)은 더 가깝게
    const scale = (isNode ? pr.nodeScale : 1.0 * pr.overviewScale) * (deep ? ZOOM.NODE_K : 1);
    const dmax = wide ? (pr.overviewDistMax || pr.distMax) : pr.distMax;
    // 섬·동(wide)은 예전 계산 그대로. 노드·단일 세션 전체는 거리 상한에 걸리면 대상·활동 노드를 지키고 먼 노드를 뺀다
    const fit = fitFrame(pts, wide ? Infinity : this._rMax(dmax, scale));
    const center = new THREE.Vector3(fit.center.x, fit.center.y, fit.center.z);
    const r = Math.max(fit.r, pr.minR * (deep ? ZOOM.NODE_MIN_R_K : 1)); // 노드 하나만 잡을 때 화면을 꽉 채우지 않도록 최소 반지름
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = Math.max(0.4, Math.min(1, this.camera.aspect)); // 세로 화면이면 더 멀리
    // 전체 보기는 경계구가 넉넉해(높이 방향이 얇음) 1.35 배를 쓰면 화면 가운데에 작게 몰리므로 1.0 배
    let dist = (r / Math.sin(fov / 2)) * scale / aspect;
    if (wide) dist *= 0.8; // 섬·동은 납작해서 경계구 기준이면 화면 가운데에 작게 몰림
    // 화면 아래 덮개: 띠 높이만큼 멀리, 시선점은 띠 가운데로
    const band = this._band(false, isNode); // 노드 샷은 라벨 자리를 기본 몫으로(잰 라벨 자리는 라벨이 뜨고 질 때마다 바뀜)
    dist /= Math.max(0.6, band.k);
    dist = autoFloor(Math.max(pr.distMin, Math.min(dmax, dist)), this.controls && this.controls.minDistance);
    let yc = band.yc;
    if (isNode) { // 노드 샷 구도 붙잡기(데드밴드·히스테리시스, 2D 와 같은 ShotHold) — 띠 옮기기·공전 전 구도를 붙잡아 상태 변동마다 움찔거리지 않게
      const h = this._shotHold || (this._shotHold = new ShotHold());
      const held = h.step(now, shotKey(shot), center, dist, dist * Math.tan(fov / 2), yc);
      center.set(held.c.x, held.c.y, held.c.z); dist = held.D; yc = held.x;
    }
    if (shot.prompt && shot.maxDist) dist = Math.min(dist, shot.maxDist); // 입력 때는 멀어지지 않는다(지금보다 가깝거나 같게)
    if (yc) {
      const dir = this._dirFrom(center);
      const rl = Math.hypot(dir.z, dir.x) || 1;
      const R = { x: dir.z / rl, y: 0, z: -dir.x / rl }; // F = −dir 기준 R = (−F.z, 0, F.x)
      const U = { x: R.y * -dir.z - R.z * -dir.y, y: R.z * -dir.x - R.x * -dir.z, z: R.x * -dir.y - R.y * -dir.x };
      const sh = -yc * Math.tan(fov / 2) * dist;
      center.set(center.x + U.x * sh, center.y + U.y * sh, center.z + U.z * sh);
    }
    return { center, dist, r };
  }

  // ---------- 화면 비율 맞춤 자세 ----------
  /** 맞춤 띠의 가로세로비(가용 영역: 덮개·라벨 자리·여백 반영) */
  _availA() {
    const band = this._band();
    return (Math.max(0.4, this.camera.aspect || 1) * FIT_MH * this._labelKx()) / (FIT_MV * Math.max(0.05, band.k));
  }
  /** 보기가 섬을 다시 배치한 차례(전체 보기 _ov.packSeq·복셀 캠퍼스 layout.packSeq) */
  _packSeq() { const v = this.view; return (v._ov && v._ov.packSeq) || (v.layout && v.layout.packSeq) || 0; }
  /** 점들이 가용 영역을 가장 크게 채우는 카메라 방향(단위벡터). 전체 보기는 방위각 0(섬 배치 축), 복셀은 방위각 범위 안에서 */
  _poseDir(pts, fitM = this.camMode === 'fit') {
    if (!pts || !pts.length || legacyPack()) return null;
    const pr = this._prefs();
    const cur = this._dirFrom(this.controls.target);
    const curAz = (Math.atan2(cur.x, cur.z) * 180) / Math.PI, curEl = (Math.asin(cur.y) * 180) / Math.PI;
    const rects = [];
    let y0 = Infinity, y1 = -Infinity;
    for (const { p, r } of pts) { rects.push({ x0: p.x - r, x1: p.x + r, z0: p.z - r, z1: p.z + r }); y0 = Math.min(y0, p.y - r); y1 = Math.max(y1, p.y + r); }
    const ranged = pr.azCenter != null && pr.azRange != null;
    const view = { aspect: this._availA(), elevMin: pr.elevMin, elevMax: pr.elevMax, elevDef: curEl, hy: Math.max(0, y1 - y0 - 2) };
    if (ranged) Object.assign(view, { yaw0: pr.azCenter, yawMin: pr.azCenter - pr.azRange, yawMax: pr.azCenter + pr.azRange });
    else view.yaw0 = this.scope.mode === 'all' ? 0 : curAz;
    // 정사영 근사(bestPose)가 아니라 실제 원근 맞춤으로 자세를 고른다(perspPose — 높은 고도에서 원근 때문에 작아지는 것까지)
    const fov = (this.camera.fov * Math.PI) / 180, t = Math.tan(fov / 2), band = this._band();
    const fm = fitM ? 1 - FIT.M : null; // 맞춤 여백(라벨은 점마다) — 노드 맞춤 점이면 조망 샷도
    const bd = fm ? this._band(true) : band;
    const pose = perspPose(pts, view, t * Math.max(0.4, this.camera.aspect || 1) * (fm || FIT_MH * this._labelKx()), t * (fm || FIT_MV) * bd.k) || bestPose(rects, view);
    const el = (pose.el * Math.PI) / 180, az = (pose.yaw * Math.PI) / 180;
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  }
  /** 맞춤 비행 시작에 자세를 싣는다(FitHold 도 새 자세 기준으로 다시) */
  _pose() {
    this._poseSeq = this._packSeq(); this._poseA = this._availA();
    const d = this._poseDir(this._fitPts());
    if (d && this.trans) { this.trans.dir = d; this.fit.reset(); }
  }
  /** 섬 샷(cluster·전체 보기 overview)의 섬 상자 꼭짓점들 — 보이는 노드가 없을 때만. 상자가 없으면 null(예전 경계구 계산) */
  _boxPts(shot) {
    const view = this.view;
    if (legacyPack() || !view.clusters || !view.clusterTarget || (shot.type !== 'cluster' && shot.type !== 'overview')) return null;
    const fp = shot.type === 'cluster' ? shot.pid : this.scope.focusProject;
    const list = fp ? [view.clusterTarget(fp)].filter(Boolean) : view.clusters().filter((k) => !k.inactive);
    if (!list.length || list.some((k) => !k.box)) return null;
    const pts = [];
    for (const k of list) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pts.push({ p: { x: k.center.x + sx * k.box.hw, y: 0, z: k.center.z + sz * k.box.hd }, r: 1.2 });
    return pts;
  }
  /** 점들을 지금 비행 방향(없으면 지금 방향)으로 투영 상자 맞춤(refineFit) + 맞춤 띠 가운데로 */
  _projFrame(pts, pr) {
    const fov = (this.camera.fov * Math.PI) / 180, t = Math.tan(fov / 2);
    const c0 = boxCenter(pts);
    const dir = this.trans && this.trans.dir ? this.trans.dir : this._dirFrom(new THREE.Vector3(c0.x, c0.y, c0.z));
    const F = { x: -dir.x, y: -dir.y, z: -dir.z };
    const rl = Math.hypot(F.z, F.x) || 1;
    const R = { x: -F.z / rl, y: 0, z: F.x / rl };
    const U = { x: R.y * F.z - R.z * F.y, y: R.z * F.x - R.x * F.z, z: R.x * F.y - R.y * F.x };
    const band = this._band();
    const tanV = t * FIT_MV * band.k, tanH = t * Math.max(0.4, this.camera.aspect || 1) * FIT_MH * this._labelKx();
    const want = refineFit(pts, c0, R, U, F, tanH, tanV, 3);
    const dist = autoFloor(Math.max(pr.distMin, Math.min(pr.overviewDistMax || pr.distMax, want.D)), this.controls && this.controls.minDistance);
    const sh = -band.yc * t * dist;
    return { center: new THREE.Vector3(want.c.x + U.x * sh, want.c.y + U.y * sh, want.c.z + U.z * sh), dist, r: dist * t };
  }

  /** 가로 맞춤 비율: 양 끝 노드 밖으로 나간 라벨 폭만큼 좁힘(0.6～1) */
  _labelKx() {
    const v = this.view, lr = v.labelReserve ? v.labelReserve() : null;
    const W = (v.container && v.container.clientWidth) || 1;
    return lr ? Math.max(0.6, 1 - (2 * Math.max(lr.left || 0, lr.right || 0)) / W) : 1;
  }

  /** 맞춤 띠: 무대를 덮는 아래 UI·라벨 자리를 뺀 세로 비율 k 와 띠 가운데 yc(NDC) */
  _band(noLabels = false, fixedLabels = false) {
    const v = this.view;
    const ins = stageInsets(v.container);
    const H = ins.H || (v.container && v.container.clientHeight) || 1;
    if (noLabels) return safeBand(H, ins.top, ins.bottom); // 전체 맞춤: 덮개만(라벨은 점마다)
    // 라벨이 칩 아래(흐름)면 맨 아래 노드 밑에 라벨 두세 줄, 위(Planet)면 맨 위 노드 위에 한두 줄
    // 라벨 자리: 기본(흐름 = 아래, Planet = 위) + 실제로 맨 위·아래 노드 밖으로 나간 라벨 높이 — fixedLabels(노드 샷)면 기본 몫만
    const lr = !fixedLabels && v.labelReserve ? v.labelReserve() : null;
    const labB = Math.max(v.labelBelow ? 46 : 0, lr ? lr.bottom : 0), labT = Math.max(v.labelBelow ? 0 : 30, lr ? lr.top : 0);
    return safeBand(H, ins.top + labT, ins.bottom + labB);
  }

  _dirFrom(center) {
    const d = this._v.copy(this.camera.position).sub(center);
    if (d.lengthSq() < 1e-6) d.set(0, 0.5, 1);
    d.normalize();
    // 고도 제한(기본 20°～55°, 렌더러 cameraPrefs)
    const pr = this._prefs();
    const el = Math.asin(Math.max(-1, Math.min(1, d.y)));
    const lo = pr.elevMin * Math.PI / 180, hi = pr.elevMax * Math.PI / 180;
    const ce = Math.max(lo, Math.min(hi, el));
    const h = Math.hypot(d.x, d.z) || 1;
    const c = Math.cos(ce);
    let hx = d.x / h, hz = d.z / h;
    if (pr.azCenter != null && pr.azRange != null) {
      const az = Math.atan2(hx, hz), ac = pr.azCenter * Math.PI / 180, ar = pr.azRange * Math.PI / 180;
      let dd = Math.atan2(Math.sin(az - ac), Math.cos(az - ac));
      dd = Math.max(-ar, Math.min(ar, dd));
      hx = Math.sin(ac + dd); hz = Math.cos(ac + dd);
    }
    return new THREE.Vector3(hx * c, Math.sin(ce), hz * c);
  }

  _startTransition(dur = TRANSITION) {
    this.shotAt = performance.now() / 1000; // 끝난 대상 머묾 기준
    if (this._shotHold) this._shotHold.reset(); // 새로 날 때는 그 순간의 구도부터 다시 붙잡음
    this.trans = {
      t0: performance.now() / 1000, dur,
      fromPos: this.camera.position.clone(), fromTgt: this.controls.target.clone(),
    };
  }

  // ---------- 프레임 ----------
  _setShot(s, now, fly) {
    const same = s.type === this.shot.type && s.id === this.shot.id && s.pid === this.shot.pid;
    if (!same) this.shotAt = now;
    this.shot = s;
    if (s.type === 'node') this.prevTarget = s.id;
    if (!same || fly || !this._inited) {
      this._startTransition();
      // 섬으로 다가갈 때도 가장 크게 차는 자세로 — 그 범위의 노드·패널 기준(노드가 없으면 섬 상자)
      const sc = shotFitScope(s, this.scope);
      const np = sc && !legacyPack() ? this._fitPts(null, sc) : null;
      const bp = np && np.length ? np : this.scope.mode === 'all' ? this._boxPts(s) : null;
      if (bp && this.trans) this.trans.dir = this._poseDir(bp, !!(np && np.length) || this.camMode === 'fit');
      this.shotFit.reset();
    }
    this._inited = true;
    this._flyNext = false;
  }

  update(dt, now) {
    const c = this.controls, cam = this.camera;
    this._now = now;
    if (this.dragging) this.lastInput = now;
    this.view.focusDist = cam.position.distanceTo(c.target);

    if (this.mode === 'manual' && this.enabled && !this.hold && !this.dragging && now - this.lastInput >= RESUME_AFTER) {
      this.mode = 'auto';
      this.lastSwitch = -1e9;
      this._flyNext = true; // 같은 대상을 다시 골라도 손으로 옮긴 자리에서 날아 돌아온다
    }

    const prompting = this._promptStep(now);
    const holding = this._gitStep(now, prompting);
    if (prompting) {
      // 입력 받은 메인을 비추는 중 — 대상 고르기를 쉰다(비행·머묾은 아래 공용 경로)
    } else if (holding) {
      // git 동작 붙잡기 — 고르기·순환을 쉰다(맞춤은 _fitPts 가 붙잡은 노드만, 따라가기는 그 노드 샷)
      this._flyNext = false;
    } else if (this.mode === 'auto' && this.camMode === 'fit') {
      // 전체 맞춤: 대상을 바꾸지 않는다. 처음·복귀·표현 전환 뒤에만 날아가고, 그 뒤는 경계가 크게 바뀔 때만 부드럽게
      if (this.shot.type !== 'fit') { this.shot = { type: 'fit' }; this._startTransition(); this._pose(); }
      else if (this._flyNext) { this._startTransition(); this._pose(); }
      else if (!this.trans && now - (this._poseChk || 0) > 0.5) {
        // 섬을 다시 배치했거나(packSeq) 가용 비율이 25% 넘게 바뀌면 자세(고도·방위)부터 다시 — 0.8초 비행. 작은 변화는 FitHold 가 거리만
        this._poseChk = now;
        if (this._packSeq() !== this._poseSeq || needRepack(this._poseA, this._availA())) { this._startTransition(0.8); this._pose(); }
      }
      this._flyNext = false;
    } else if (this.mode === 'auto') {
      // 매 프레임: 대상이 퇴장·node-remove·숨김·희미로 사라졌으면 8초를 기다리지 않고 바로 다시 고른다
      const lost = shotLost(this.view, this.shot, (id) => this._dim(id));
      let stale = false;
      if (!lost && this.shot.type === 'node' && !this.shot.wide) { // 넓은 구도(메인·세션 전체)는 활동 자손을 함께 담으므로 제외
        const v = this.view.vis.get(this.shot.id);
        if (v && !isBusy(v, this._lastAt(this.shot.id), now, this._clk()) && now - (this.shotAt || 0) >= STALE_DWELL) {
          // 전체 보기: 같은 섬에 일하는 노드가 있으면 그 섬 안에서, 섬이 통째로 쉬면 다른 섬의 일하는 노드로(— 예전엔 다른 섬은 8초 박자에 맡겨
          // 알림 턴이 끝난 섬을 계속 비췄다)
          const pid = this.scope.mode === 'all' ? this._clusterOf(this.shot.id) : null;
          stale = shotStale(v, this._lastAt(this.shot.id), this.shotAt || 0, now, !!this._busyAlt(now, this.shot.id, pid), this._clk());
        }
      } else if (!lost && this.shot.type === 'cluster' && this.scope.mode === 'all' && !this.scope.focusProject && now - (this.shotAt || 0) >= STALE_DWELL) {
        stale = this._busyAlt(now, null, this.shot.pid) === 'other'; // 섬 샷: 그 섬이 쉬고 다른 섬이 일하면 넘어감
      }
      if (now - this.lastSwitch >= SWITCH_EVERY) {
        this.lastSwitch = now;
        this._setShot(this._pick(now), now, this._flyNext);
      } else if (lost || stale) {
        this.lastSwitch = now;
        this._setShot(this._replace(now, this.shot, stale), now, false);
      }
    }

    const flying = this.trans && (this.mode === 'auto' || this.focusFly);
    if (flying) {
      const f = this._frame(this.shot);
      const k = Math.min(1, (now - this.trans.t0) / this.trans.dur);
      const e = easeInOutCubic(k);
      if (!this.trans.dir) this.trans.dir = this._dirFrom(f.center);
      // 시선점 기준 방향·거리 보간(+섬 사이 이동은 가운데서 살짝 물러남) — 대상은 매 프레임 지금 자리(f.center)
      const p = flightPose(this.trans.fromTgt, this.trans.fromPos, f.center, this.trans.dir, f.dist, e);
      c.target.set(p.tgt.x, p.tgt.y, p.tgt.z);
      cam.position.set(p.pos.x, p.pos.y, p.pos.z);
      if (k >= 1) { this.trans = null; this.focusFly = false; }
    } else if (this.hold && this.hold.follow && !this.dragging) {
      // 팝업 '따라가기': 시선점만 객체 쪽으로(손으로 돌린 방향·거리는 유지)
      const f = this._frame(this.shot);
      const d = this._v2.copy(f.center).sub(c.target).multiplyScalar(Math.min(1, dt * 2.5));
      c.target.add(d); cam.position.add(d);
    } else if (this.mode === 'auto' && this.shot.type === 'fit') {
      // 맞춤 유지: 공전 없이(방향이 바뀌면 필요한 거리도 바뀌어 줌이 출렁임) 감쇠로 중심·거리만 따라감
      const f = this._frame(this.shot);
      c.target.lerp(f.center, Math.min(1, dt * 1.2));
      const off = this._v.copy(cam.position).sub(c.target);
      const len = off.length() || 1;
      this._idleOrbit(off, dt, now);
      off.multiplyScalar(1 + ((f.dist - len) / len) * Math.min(1, dt * 1.2));
      cam.position.copy(c.target).add(off);
    } else if (this.mode === 'auto') {
      // 머무는 동안: 대상 추적 + 천천히 공전
      const f = this._frame(this.shot);
      c.target.lerp(f.center, Math.min(1, dt * 2));
      const off = this._v.copy(cam.position).sub(c.target);
      const len = off.length() || 1;
      const pr = this._prefs();
      if (pr.azCenter != null && pr.azRange != null) {
        // 방위각 범위 안에서 왕복 공전(복셀: 벽 뒤로 돌아가지 않게)
        const az = Math.atan2(off.x, off.z), ac = pr.azCenter * Math.PI / 180, ar = pr.azRange * Math.PI / 180;
        const dd = Math.atan2(Math.sin(az - ac), Math.cos(az - ac));
        if (dd > ar && this._orbitDir > 0) this._orbitDir = -1;
        else if (dd < -ar && this._orbitDir < 0) this._orbitDir = 1;
      }
      off.applyAxisAngle(THREE.Object3D.DEFAULT_UP, ORBIT * dt * this._orbitDir);
      off.multiplyScalar(1 + ((f.dist - len) / len) * Math.min(1, dt * 1.5));
      cam.position.copy(c.target).add(off);
    }
    c.update();
    // 홀로그램: 자동 순환이 지금 비추는 노드는 패널을 크게
    this.view.camShotId = this.mode === 'auto' && this.enabled && this.shot && this.shot.type === 'node' ? this.shot.id : null;
    this._emitStatus(now);
  }

  /** 쉼 정도 0..1: 최근 CALM_WIN 초 이벤트 비율로 */
  calmness(now) {
    const tl = this._evT;
    let n = 0;
    if (tl) for (let i = tl.length - 1; i >= 0 && now - tl[i] < CALM_WIN; i--) n++;
    const rate = n / CALM_WIN;
    return Math.max(0, Math.min(1, (CALM_HI - rate) / (CALM_HI - CALM_LO)));
  }
  /** 쉬는 동안 느린 왕복 궤도: off(시선점 → 카메라)를 세로축으로 돌린다. 진폭 amp°·주기 period 초의 사인 왕복(위상은 쉼 정도만큼만 흐름) */
  _idleOrbit(off, dt, now) {
    const io = this._prefs().idleOrbit;
    if (!io || !(io.amp > 0) || !(io.period > 0)) return;
    if (this._reduced == null) this._reduced = prefersReduced();
    if (this._reduced) return;
    const calm = this.calmness(now);
    this._calmK = (this._calmK || 0) + (calm - (this._calmK || 0)) * Math.min(1, dt * 0.6);
    if (this._calmK < 0.005) return;
    const ph0 = this._orbPh || 0, ph1 = ph0 + dt * ((2 * Math.PI) / io.period) * this._calmK;
    this._orbPh = ph1;
    const d = ((io.amp * Math.PI) / 180) * (Math.sin(ph1) - Math.sin(ph0));
    off.applyAxisAngle(THREE.Object3D.DEFAULT_UP, d);
  }

  _emitStatus(now) {
    if (!this.onStatus) return;
    let s;
    if (!this.enabled) s = { mode: 'off', text: t('app.cam.off') };
    else if (this.hold) s = { mode: 'manual', text: this.hold.follow ? t('app.cam.follow') : t('app.cam.inspect') };
    else if (this.mode === 'manual') {
      const left = Math.max(0, Math.ceil(RESUME_AFTER - (now - this.lastInput)));
      s = { mode: 'manual', text: this.dragging ? t('app.cam.manual') : t('app.cam.manualResume', { n: left }) };
    } else {
      let what = this.scope.mode === 'all' ? t('app.cam.overviewAll') : t('app.cam.overview');
      if (this.gitHold) what = gitHoldLabel(this.gitHold[0].op, (k) => t('app.cam.' + k)); // 'git push'
      else if (this.shot.type === 'fit') {
        const sc = this.scope;
        if (sc.focusSession) what = t('app.cam.wholeSession');
        else if (sc.focusProject) {
          const c = this.view.clusters ? this.view.clusters().find((k) => k.projectId === sc.focusProject) : null;
          what = t('app.cam.wholeProject', { name: (c && c.name) || sc.focusProject });
          if (what.length > 30) what = what.slice(0, 29) + '…';
        } else what = sc.mode === 'all' ? t('app.cam.allActive') : t('app.cam.wholeSession');
      } else if (this.shot.type === 'cluster' || (this.shot.type === 'overview' && this.scope.mode === 'all' && this.scope.focusProject)) {
        const pid = this.shot.pid || this.scope.focusProject;
        const c = this.view.clusters ? this.view.clusters().find((k) => k.projectId === pid) : null;
        what = t('app.cam.project', { name: (c && c.name) || pid || '' });
        if (what.length > 26) what = what.slice(0, 25) + '…';
      } else if (this.shot.type === 'node') {
        const n = this.getNode(this.shot.id);
        what = n ? (n.label || n.id) : '';
        if (what.length > 22) what = what.slice(0, 21) + '…';
        if (this.scope.mode === 'all') what = t('app.cam.node', { name: what });
      }
      s = { mode: 'auto', text: t('app.cam.auto', { what }) };
    }
    const key = s.mode + s.text;
    if (key !== this._lastStatus) { this._lastStatus = key; this.onStatus(s); }
  }
}
