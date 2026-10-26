// 2D(저사양) 표현의 카메라. 3D CameraDirector 와 같은 바깥 모양(app.js 가 쓰는 메서드·필드)을
// three 없이 2D 팬·줌으로: 휠(커서 기준)·끌기·핀치·WASD/QE, 자동 카메라 = 살아 있는 노드 전체 맞춤(2D판, FitHold 히스테리시스),
// '따라가기'는 활동 노드를 8초마다 확대(간이), 수동 조작 10초 뒤 복귀, 빈 곳 클릭 즉시 복귀(resumeAuto), 일시정지 얼림(enabled=false).
import { isShown, isLive, pickBest, shotLost, FitHold, safeBand, ZOOM, autoFloor, nearestKids, FIT, isFitActive, pickFitIds, PanelMemo, pxToE, shotFitScope, workScore } from '../camera-core.mjs';
import { stageInsets } from '../screen-insets.js';
import { t } from '../i18n.mjs';
import { promptCamPlan } from '../camera-core.mjs'; // 입력 때 메인으로(Follow my prompts)
import { FLAT, toWorld, zoomAt, panBy, boxCenterXZ, fitNeed, refineFit2D, fitMinD, flyPose, dampTo, clampD } from './flat-core.mjs';
const HAS = (view, id) => { const v = view && view.vis && view.vis.get(id); return !!(v && !v.gone && !v.hidden); };

const SWITCH_EVERY = 8, RESUME_AFTER = 10, IDLE_OVERVIEW = 30, TRANSITION = 1.6;
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export class Director2D {
  constructor(view, getNode) {
    this.getNode = getNode;
    this.enabled = true;
    this.mode = 'auto';
    this.lastInput = -1e9;
    this.dragging = false;
    this.shot = { type: 'fit' };
    this.lastSwitch = -1e9;
    this.tour = 0;
    this.prevTarget = null;
    this.trans = null;
    this.focusFly = false;
    this.activity = new Map();
    this.added = new Map();
    this.lastEventAt = performance.now() / 1000;
    this.onStatus = null;
    this._lastStatus = '';
    this.scope = { mode: 'session', focusProject: null, focusSession: null, focusNode: null };
    this.camMode = 'fit';
    this.fit = new FitHold();
    this.shotFit = new FitHold(); // 프로젝트 섬 샷의 노드 맞춤 유지
    this.active = true;
    this._ptrs = new Map();
    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey);
    this.view = null;
    this.attach(view);
  }

  // ---------- 붙이기·입력 ----------
  attach(view) {
    if (!view || view === this.view) return;
    this._unbind();
    this.view = view;
    this.cam = view.cam;
    const el = this._el = view.canvas;
    this._h = {
      wheel: (e) => this._wheel(e),
      down: (e) => this._down(e),
      move: (e) => this._move(e),
      up: (e) => this._up(e),
    };
    el.addEventListener('wheel', this._h.wheel, { passive: false });
    el.addEventListener('pointerdown', this._h.down);
    window.addEventListener('pointermove', this._h.move);
    window.addEventListener('pointerup', this._h.up);
    window.addEventListener('pointercancel', this._h.up);
    this.dragging = false; this._ptrs.clear();
    this.trans = null; this.focusFly = false;
    this.fit.reset();
    if (this._panMemo) this._panMemo.clear(); // 카드·라벨 자리는 표현마다 다르다
    if (this._labMemo) this._labMemo.clear();
    this._startTransition();
  }
  _unbind() {
    const el = this._el, h = this._h;
    if (!el || !h) return;
    el.removeEventListener('wheel', h.wheel);
    el.removeEventListener('pointerdown', h.down);
    window.removeEventListener('pointermove', h.move);
    window.removeEventListener('pointerup', h.up);
    window.removeEventListener('pointercancel', h.up);
    this._el = null; this._h = null;
  }
  /** 3D 로 바꿀 때: 입력을 떼고 쉰다(다시 2D 로 오면 attach) */
  detach() { this._unbind(); this.active = false; this.view = null; }

  _size() { const v = this.view; return { W: v.W || 1, H: v.H || 1 }; } // view 가 ResizeObserver 로 받아 둔 크기(clientWidth 강제 레이아웃 없이)
  _manual() { this.lastInput = performance.now() / 1000; this.mode = 'manual'; this.trans = null; this.focusFly = false; if (this.view) this.view.invalidate(); }

  _wheel(e) {
    e.preventDefault();
    const { W, H } = this._size();
    const r = this._el.getBoundingClientRect();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    this._manual();
    zoomAt(this.cam, W, H, e.clientX - r.left, e.clientY - r.top, Math.exp(dy * FLAT.WHEEL_K));
  }
  _down(e) {
    if (e.button !== 0 && e.pointerType === 'mouse' && e.button !== 1 && e.button !== 2) return;
    this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    this._pinch = null;
    this._moved = false;
  }
  _move(e) {
    const p = this._ptrs.get(e.pointerId);
    if (!p || !this.view) return;
    const { W, H } = this._size();
    if (this._ptrs.size >= 2) {
      // 핀치: 두 손가락 거리 비 → 확대/축소, 중점 이동 → 이동
      const [a, b] = [...this._ptrs.values()];
      const before = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      p.x = e.clientX; p.y = e.clientY;
      const after = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      if (before.d > 4 && after.d > 4) {
        const r = this._el.getBoundingClientRect();
        this._manual(); this.dragging = true; this._moved = true;
        panBy(this.cam, H, after.mx - before.mx, after.my - before.my);
        zoomAt(this.cam, W, H, after.mx - r.left, after.my - r.top, before.d / after.d);
      }
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!this._moved && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 4) return; // 클릭(app 은 6px 안이면 클릭)과 구분
    if (!this._moved) { this._moved = true; this.dragging = true; this._manual(); }
    this.lastInput = performance.now() / 1000;
    panBy(this.cam, H, dx, dy);
    this.view.invalidate();
  }
  _up(e) {
    if (!this._ptrs.has(e.pointerId)) return;
    this._ptrs.delete(e.pointerId);
    if (!this._ptrs.size) { if (this.dragging) this._manual(); this.dragging = false; }
  }
  _key(e) {
    if (!this.active || !this.view) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const pan = { arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0], arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1] }[k];
    const zoom = { '+': 0.85, '=': 0.85, '-': 1.18, '_': 1.18, q: 1.18, e: 0.85 }[k];
    if (!pan && !zoom) return;
    e.preventDefault();
    this._manual();
    const { W, H } = this._size();
    if (pan) { const step = H * 0.06; panBy(this.cam, H, -pan[0] * step, -pan[1] * step); }
    else zoomAt(this.cam, W, H, W / 2, H / 2, zoom);
  }

  // ---------- app.js 가 부르는 것(3D 와 같은 이름) ----------
  resumeAuto() {
    if (!this.enabled || this.dragging) return;
    this.lastInput = -1e9; this.mode = 'auto'; this.lastSwitch = -1e9; this._flyNext = true;
  }
  setEnabled(on) {
    this.enabled = on;
    if (on && !this.hold) { this.mode = 'auto'; this.lastSwitch = -1e9; this._flyNext = true; }
    else this.mode = 'manual';
  }
  // 상세 팝업(3D camera.js 와 같은 이름): 객체로 다가가 머묾, release 때 자동 카메라로
  inspect(t, follow = false) {
    if (!t) return;
    this.hold = { follow: !!follow };
    this._manual();
    if (t.type === 'plan') return; // 계획 보드 크게 보기: 보드는 월드 고정 — 카메라는 그 자리에 멈추고 카드만
    this.shot = t.type === 'cluster' ? { type: 'cluster', pid: t.pid } : { type: 'node', id: t.id };
    this.shotFit.reset();
    this._startTransition(1.0);
    this.focusFly = true;
  }
  setFollow(on) { if (this.hold) this.hold.follow = !!on; }
  release() {
    if (!this.hold) return;
    this.hold = null;
    if (this.enabled) { this.dragging = false; this.resumeAuto(); }
  }
  setCamMode(m) {
    m = m === 'follow' ? 'follow' : 'fit';
    if (m === this.camMode) return;
    this.camMode = m;
    this.fit.reset();
    this.shot = m === 'fit' ? { type: 'fit' } : { type: 'overview' };
    this.lastSwitch = -1e9; this.tour = 0;
    if (this.mode === 'auto') this._startTransition();
  }
  noteEvent(ev) {
    const now = performance.now() / 1000;
    this.lastEventAt = now;
    if (!ev.nodeId) return;
    let a = this.activity.get(ev.nodeId);
    if (!a) { a = []; this.activity.set(ev.nodeId, a); }
    a.push(now);
    if (a.length > 200) a.splice(0, a.length - 200);
    if (ev.type === 'node-add') this.added.set(ev.nodeId, now);
  }
  resetActivity() { this.activity.clear(); this.added.clear(); this.prevTarget = null; this.lastSwitch = -1e9; this.shot = { type: this.camMode === 'fit' ? 'fit' : 'overview' }; this.fit.reset(); }
  setScope({ mode = 'session', focusProject = null, focusSession = null, focusNode = null } = {}) {
    const m = mode === 'all' ? 'all' : 'session';
    const fp = m === 'all' ? focusProject || null : null;
    const fs = m === 'all' ? focusSession || null : null;
    const fn = fs ? focusNode || 's:' + fs : null;
    const changed = m !== this.scope.mode || fp !== this.scope.focusProject || fs !== this.scope.focusSession || fn !== this.scope.focusNode;
    this.scope = { mode: m, focusProject: fp, focusSession: fs, focusNode: fn };
    if (!changed) return;
    this.tour = 0; this.prevTarget = null;
    this.shot = this.camMode === 'fit' ? { type: 'fit' } : (fn && this.view && this.view.has(fn) ? { type: 'node', id: fn, wide: true } : { type: 'overview' });
    this.fit.reset();
    this.lastSwitch = performance.now() / 1000;
    this._startTransition(TRANSITION);
    this.focusFly = true; // 수동 조작 중이어도 고른 곳으로 한 번
  }
  scopeNodeArrived(id) {
    if (this.scope.mode !== 'all' || this.scope.focusNode !== id || !this.view || !this.view.has(id)) return;
    this.fit.reset(); this._startTransition(TRANSITION); this.focusFly = true;
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
    this.shot = { type: 'node', id, prompt: true, maxD: this.cam ? this.cam.D : 0 };
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
  focusNode(id) {
    this._manual();
    this.shot = { type: 'node', id };
    this._startTransition(1.0);
    this.focusFly = true;
  }
  overview(immediate = false) {
    this.shot = { type: this.camMode === 'fit' ? 'fit' : 'overview' };
    this.fit.reset();
    if (immediate && this.view) { const f = this._frame(this.shot); if (f) { this.cam.x = f.x; this.cam.z = f.z; this.cam.D = f.D; this.view.invalidate(); } }
    else this._startTransition();
  }

  // ---------- 고르기·구도 ----------
  _clusterOf(id) { const v = this.view; if (v.nodeCluster) { const p = v.nodeCluster(id); if (p) return p; } const n = this.getNode(id); return n ? n.projectId || null : null; }
  _lastAt(id) { const a = this.activity.get(id); return a && a.length ? a[a.length - 1] : null; }
  _shown(id) { return isShown(this.view.vis.get(id)); }
  _inScope(id, v, sc = null) {
    const all = this.scope.mode === 'all';
    const fp = sc ? sc.pid : all ? this.scope.focusProject : null, fsid = sc ? sc.sid : all ? this.scope.focusSession : null;
    if (fsid) return !!(v.node && v.node.rootSessionId === fsid);
    if (fp) return this._clusterOf(id) === fp;
    return true;
  }
  /**
   * 맞춤 대상 점(3D camera.js 와 같은 규칙): 지금 범위의 활성 노드(없으면 보이는 노드 전부) + 그 노드가 최근 PANEL_KEEP 초에
   * 펼친 도구 카드·노드 라벨 자리. 2D 카드·라벨은 화면 크기(px)로 그려지므로 노드 화면 자리 기준 px 상자를 화면 고정 몫 e 로 담는다.
   * 섬·작업 대상 층·복셀 방 모서리는 담지 않는다. sc = {pid, sid}(조망 샷 범위) — 주면 지금 범위 대신
   */
  _fitPts(now = performance.now() / 1000, sc = null) {
    const view = this.view, list = [];
    for (const [id, v] of view.vis) {
      if (!this._shown(id) || !this._inScope(id, v, sc)) continue;
      list.push([id, isFitActive(v, v.icons ? v.icons.size || 0 : 0)]);
    }
    const ids = pickFitIds(list);
    const memo = this._panMemo || (this._panMemo = new PanelMemo());
    const lmemo = this._labMemo || (this._labMemo = new PanelMemo(FIT.LABEL_KEEP));
    // 지난 프레임 카드(px) → 노드별 {기준점 세계 오프셋, 기준점 기준 px 상자}. 카드 크기·노드와의 간격은 화면 px 로 그려지고, 기준점(복셀은 책상)은 세계 자리
    const cur = this._curPx || (this._curPx = new Map()); cur.clear();
    const { W, H } = this._size();
    for (const h of view._cardHits || []) {
      const v = h && view.vis.get(h.id);
      if (!v || h.ax == null) continue;
      const x0 = h.x0 - h.ax, y0 = h.y0 - h.ay, x1 = h.x1 - h.ax, y1 = h.y1 - h.ay;
      let c = cur.get(h.id);
      if (!c) {
        const w = toWorld(this.cam, W, H, h.ax, h.ay), o = v.pos || v.target;
        cur.set(h.id, c = { dx: w.x - o.x, dz: w.z - o.z, b: { x0, y0, x1, y1 } });
      } else { const b = c.b; b.x0 = Math.min(b.x0, x0); b.y0 = Math.min(b.y0, y0); b.x1 = Math.max(b.x1, x1); b.y1 = Math.max(b.y1, y1); }
    }
    const unit = (H || 1) / 2; // 반높이 = 1
    const anc = this._anc || (this._anc = new Map()); // 노드 → 마지막 카드 기준점 오프셋(세계)
    const pts = [];
    for (const id of ids) {
      const v = view.vis.get(id);
      const nr = view.fitNodeR ? view.fitNodeR(id) : v.r;
      const c = cur.get(id);
      if (c) { memo.put(id, now, c.b); anc.set(id, { dx: c.dx, dz: c.dz }); }
      if (v.labelOn && v._lrel) { const r = v._lrel; lmemo.put(id, now, { x0: r[0], y0: r[1], x1: r[2], y1: r[3] }); }
      pts.push({ p: v.target, r: nr * FIT.NODE_K + FIT.NODE_PAD, e: pxToE(lmemo.get(id, now), unit) });
      const b = memo.get(id, now), a = b && anc.get(id);
      if (b && a) pts.push({ p: { x: v.target.x + a.dx, y: 0, z: v.target.z + a.dz }, r: 0, e: pxToE(b, unit), panel: true, aux: true });
    }
    return pts;
  }
  _fitFrame(now, sc = null, hold = this.fit) {
    const { W, H } = this._size();
    const aspect = W / H;
    const pts = this._fitPts(now, sc);
    // 노드 하나뿐일 때 바닥: MIN_R × MIN_R_K(예전 MIN_R 그대로 — 너무 멀었다), 수동 최소 D_MIN 보다는 멀리
    const dmin = Math.max(FLAT.D_MIN, fitMinD(aspect, 1 - FIT.M, 1 - FIT.M) * FIT.MIN_R_K);
    if (!pts.length) return { x: this.cam.x, z: this.cam.z, D: this.cam.D, n: 0 }; // 보이는 노드가 없으면 그 자리(섬으로 물러나지 않음)
    // 화면 아래 이벤트 띠·매크로 타임라인·재생 막대를 뺀 띠에 담는다 — 라벨은 점마다(e)
    const band = this._band(H, true);
    const mv = (1 - FIT.M) * band.k, mh = 1 - FIT.M;
    // 평행 투영: 화면 상자(반지름·카드·라벨 포함) 가운데로, 가로·세로 중 한쪽이 여백 끝까지
    const want = refineFit2D(pts, boxCenterXZ(pts), aspect, mh, mv, 3, this.view.fitMass !== false); // + 시각 무게중심
    const here = hold.c ? fitNeed(pts, hold.c, aspect, mh, mv) : Infinity;
    hold.step(now, want, here, dmin, FLAT.D_MAX, { freeze: !!this.view.exitSettling });
    // 시선점을 아래로(내용이 띠 가운데, 덮개 위로 올라감)
    return { x: hold.c.x, z: hold.c.z + hold.D * band.yc, D: hold.D, n: pts.length };
  }
  /** 맞춤 띠(3D camera.js _band 와 같은 규칙) */
  _band(H, noLabels = false) {
    const v = this.view;
    const ins = stageInsets(v.container || this._el);
    if (noLabels) return safeBand(ins.H || H, ins.top, ins.bottom); // 전체 맞춤: 덮개만(라벨은 점마다)
    // 라벨 자리: 기본(흐름 = 아래, Planet = 위) + 실제로 맨 위·아래 노드 밖으로 나간 라벨 높이
    const lr = v.labelReserve ? v.labelReserve() : null;
    const labB = Math.max(v.labelBelow ? 46 : 0, lr ? lr.bottom : 0), labT = Math.max(v.labelBelow ? 0 : 30, lr ? lr.top : 0);
    return safeBand(ins.H || H, ins.top + labT, ins.bottom + labB);
  }
  _nodeFrame(id, wide) {
    const view = this.view, v = view.vis.get(id);
    if (!v) return null;
    const pts = [{ p: v.target, r: v.r * FLAT.FIT_PAD_K + FLAT.FIT_PAD }];
    let kids = view.children(id).filter((k) => view.vis.get(k) && this._shown(k));
    if (!wide) kids = nearestKids(kids, (k) => view.vis.get(k).target, v.target, ZOOM.NODE_KIDS); // 가까운 자식 몇 개만
    for (const kid of kids) { const k = view.vis.get(kid); pts.push({ p: k.target, r: k.r + 1.2 }); }
    const { W, H } = this._size();
    const c = boxCenterXZ(pts);
    const band = this._band(H);
    const deep = !wide; // 노드 샷은 바닥(MIN_R)·여유를 줄여 더 가깝게, 수동 최소(D_MIN)보다는 멀리
    const D = clampD(autoFloor(Math.max(fitMinD(W / H) * (deep ? ZOOM.NODE_MIN_R_K : 1), fitNeed(pts, c, W / H, FLAT.FIT_MH, FLAT.FIT_MV * band.k) * (deep ? ZOOM.NODE_MARGIN_2D : 1.1)), FLAT.D_MIN));
    return { x: c.x, z: c.z + D * band.yc, D };
  }
  _frame(shot, now = performance.now() / 1000) {
    if (shot.type === 'node' && this.view.has(shot.id)) {
      if (shot.prompt) { // 입력 받은 메인을 가운데로, 멀어지지 않게
        const f = this._nodeFrame(shot.id, false), v = this.view.vis.get(shot.id);
        if (f && v) { const D = Math.min(f.D, shot.maxD || f.D); return { x: v.target.x, z: v.target.z + D * this._band(this._size().H).yc, D }; }
      }
      return this._nodeFrame(shot.id, shot.wide) || this._fitFrame(now);
    }
    if (shot.type === 'cluster' && this.view.clusterTarget) {
      const c = this.view.clusterTarget(shot.pid);
      if (c) {
        // 그 섬의 활성 노드 + 도구 카드·라벨('구도: 전체'와 같은 맞춤 점) — 섬 상자·작업 대상 층·복셀 방 모서리는 담지 않음
        const sc = shotFitScope(shot, this.scope) || { pid: shot.pid, sid: null };
        const f = this._fitFrame(now, sc, this.shotFit);
        if (f.n) return f;
        // 보이는 노드가 없으면 섬 상자 네 꼭짓점(없으면 경계원)
        const { W, H } = this._size();
        if (!c.box) return { x: c.center.x, z: c.center.z, D: clampD(fitNeed([{ p: c.center, r: c.r }], c.center, W / H)) };
        const pts = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({ p: { x: c.center.x + sx * c.box.hw, y: 0, z: c.center.z + sz * c.box.hd }, r: 1.2 }));
        const band = this._band(H);
        const D = clampD(fitNeed(pts, c.center, W / H, FLAT.FIT_MH, FLAT.FIT_MV * band.k));
        return { x: c.center.x, z: c.center.z + D * band.yc, D };
      }
    }
    return this._fitFrame(now);
  }
  /** '따라가기'(간이): 8초마다 지금 범위의 활동 노드 중 최고 점수, 4번에 1번·한가하면 전체 */
  _pickFollow(now) {
    this.tour++;
    if (now - this.lastEventAt > IDLE_OVERVIEW || this.tour % 4 === 0) return { type: 'fit' };
    const list = [];
    for (const [id, v] of this.view.vis) {
      if (!this._shown(id) || !this._inScope(id, v) || !isLive(v, this._lastAt(id), now)) continue;
      list.push([id, workScore(v, this.activity.get(id), this.added.get(id), this._lastAt(id), now)]); // 쉬는 노드는 0
    }
    const id = pickBest(list, this.prevTarget);
    if (!id) return { type: 'fit' };
    this.prevTarget = id;
    return { type: 'node', id };
  }
  _startTransition(dur = TRANSITION) {
    if (!this.cam) return;
    this.shotAt = performance.now() / 1000;
    this.trans = { t0: performance.now() / 1000, dur, from: { x: this.cam.x, z: this.cam.z, D: this.cam.D } };
  }

  update(dt, now) {
    if (!this.view) return;
    const cam = this.cam;
    const before = cam.x + ',' + cam.z + ',' + cam.D;
    if (this.dragging) this.lastInput = now;
    this.view.focusDist = cam.D;
    if (this.mode === 'manual' && this.enabled && !this.hold && !this.dragging && now - this.lastInput >= RESUME_AFTER) {
      this.mode = 'auto'; this.lastSwitch = -1e9; this._flyNext = true;
    }
    if (this._promptStep(now)) {
      // 입력 받은 메인을 비추는 중
    } else if (this.mode === 'auto' && this.camMode === 'fit') {
      if (this.shot.type !== 'fit') { this.shot = { type: 'fit' }; this._startTransition(); }
      else if (this._flyNext) this._startTransition();
      else {
        // 섬을 다시 배치하면(가용 비율이 크게 바뀜) 0.8초에 걸쳐 새 배치로 다시 맞춤
        const v = this.view, ps = (v._ov && v._ov.packSeq) || (v.layout && v.layout.packSeq) || 0;
        if (this._poseSeq == null) this._poseSeq = ps;
        else if (ps !== this._poseSeq && !this.trans) { this._poseSeq = ps; this.fit.reset(); this._startTransition(0.8); }
      }
      this._flyNext = false;
    } else if (this.mode === 'auto') {
      const lost = this.shot.type === 'node' && shotLost(this.view, this.shot, null);
      if (now - this.lastSwitch >= SWITCH_EVERY || lost) {
        this.lastSwitch = now;
        const s = this._pickFollow(now);
        const same = s.type === this.shot.type && s.id === this.shot.id;
        this.shot = s;
        if (!same || this._flyNext) this._startTransition();
        this._flyNext = false;
      }
    }
    const flying = this.trans && (this.mode === 'auto' || this.focusFly);
    if (flying) {
      const f = this._frame(this.shot, now);
      const k = Math.min(1, (now - this.trans.t0) / this.trans.dur);
      const p = flyPose(this.trans.from, f, easeInOutCubic(k));
      cam.x = p.x; cam.z = p.z; cam.D = p.D;
      if (k >= 1) { this.trans = null; this.focusFly = false; }
    } else if (this.hold && this.hold.follow && !this.dragging) {
      const f = this._frame(this.shot, now); // 팝업 '따라가기': 중심만 따라감(확대는 손 그대로)
      dampTo(cam, { x: f.x, z: f.z, D: cam.D }, dt, 2.5);
    } else if (this.mode === 'auto') {
      const f = this._frame(this.shot, now);
      dampTo(cam, f, dt, this.shot.type === 'fit' ? 1.2 : 2);
    }
    this.view.camShotId = this.mode === 'auto' && this.enabled && this.shot && this.shot.type === 'node' ? this.shot.id : null;
    if (cam.x + ',' + cam.z + ',' + cam.D !== before) this.view.invalidate();
    this._emitStatus(now);
  }

  _emitStatus(now) {
    if (!this.onStatus) return;
    let s;
    if (!this.enabled) s = { mode: 'off', text: t('flat.cam.off') };
    else if (this.hold) s = { mode: 'manual', text: this.hold.follow ? t('flat.cam.follow') : t('flat.cam.inspect') };
    else if (this.mode === 'manual') {
      const left = Math.max(0, Math.ceil(RESUME_AFTER - (now - this.lastInput)));
      s = { mode: 'manual', text: this.dragging ? t('flat.cam.manual') : t('flat.cam.manualLeft', { n: left }) };
    } else {
      let what;
      const sc = this.scope;
      if (this.shot.type === 'node') {
        const n = this.getNode(this.shot.id);
        what = n ? (n.label || n.id) : '';
        if (what.length > 22) what = what.slice(0, 21) + '…';
        if (sc.mode === 'all') what = t('flat.cam.node', { name: what });
      } else if (sc.focusSession) what = t('flat.cam.session');
      else if (sc.focusProject) {
        const c = this.view.clusters ? this.view.clusters().find((k) => k.projectId === sc.focusProject) : null;
        what = t('flat.cam.project', { name: (c && c.name) || sc.focusProject });
        if (what.length > 30) what = what.slice(0, 29) + '…';
      } else what = sc.mode === 'all' ? t('flat.cam.allActive') : t('flat.cam.session');
      s = { mode: 'auto', text: t('flat.cam.auto', { what }) };
    }
    const key = s.mode + s.text;
    if (key !== this._lastStatus) { this._lastStatus = key; this.onStatus(s); }
  }
}

/** 화면 좌표 → 세계(x, z) — 섬 클릭 판정 등에서 */
export function screenToWorld(view, clientX, clientY) {
  const r = view.canvas.getBoundingClientRect();
  return toWorld(view.cam, r.width || 1, r.height || 1, clientX - r.left, clientY - r.top);
}
