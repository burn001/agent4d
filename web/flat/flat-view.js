// 2D(저사양) 표현의 바탕. three.js 없이 Canvas 2D 한 장 + DOM 라벨(기존 .node-label CSS 그대로).
// 3D SceneView 와 같은 바깥 모양(app.js·camera·panel·ctx-ui 가 쓰는 메서드·필드)을 두고,
// 배치(layout.js·overview/layout.mjs)·완료 퇴장·배치 장치 접기·라벨 규칙은 3D 와 같은 순수 모듈을 쓴다.
// 그리기는 하위 클래스(_drawScene)가 맡는다 — 1단계는 Flow 2D(flow2d.js) 하나, 2단계에서 Planet·복셀 2D 가 같은 바탕을 쓴다.
// 렌더 루프: 바뀐 것이 있을 때만 그림, 상한 30fps(배경 움직임만 있으면 15fps), 쉬면 4Hz 논리 갱신만, 숨긴 탭은 멈춤, devicePixelRatio ≤ 1.5.
import { computeLayout, dockedPos, RADIUS, KIND_LABEL } from '../layout.js';
import { computeOverview, isRecentRoot } from '../overview/layout.mjs';
import { packView, packStale } from '../overview/pack-view.js';
import { exitEligible, exitWalls, endedBadly, badEndDueAt, catColor } from '../flow-core.mjs';
import { CAT_LABEL } from '../icons.js';
import { HoloBook, HOLO, actLine, sayBrief, pushHist } from '../holo-core.mjs';
import { EXIT, exitPolicy, exitPose } from '../exit-core.mjs';
import { nodeSubtitle } from '../node-title.mjs';
import { BATCH, batchFold, isLauncher, deviceInfo, deviceSummary, nodeTags, rearmStandby, clockLabelKey } from '../batch-core.mjs';
import { escapeHtml } from '../html-util.mjs';
import { pickIslandAt } from '../overview/pick-core.mjs';
import { ensureOverviewCss, islandLabelHtml } from '../overview/island-label.mjs';
import { placeLabels, LABEL_SHIFTS, LABEL_FAR_SHIFTS, textWidth, labelReserve, smoothReserve } from '../label-place.mjs';
import { planLabelRects } from '../plan-core.mjs'; // 계획 보드 = 라벨의 고정 장애물
import { spawnLinks, spawnTag } from '../spawn-link.mjs';
import { FLAT, capDpr, toScreen, toWorld, camScale, pickNearest, tickInterval } from './flat-core.mjs';
import { sessionColorMap, nodeSessIdx } from '../multi-core.mjs';
import { sessBadgeHtml, branchOf } from '../session-core.mjs';
import { FlatSessions } from './flat-sessions.js';
import { FlatIx } from './ix2d.js';
import { ixSeedEvent } from '../ix-core.mjs';
import { ProjFade, nodeFade } from '../proj-fade.mjs';
import { projectAreaPad } from '../overview/pick-core.mjs';
import { t } from '../i18n.mjs';
import { isJob, jobLabelNear } from '../job-core.mjs'; // 작업 노드 · 가까운 작업 라벨
import { RUNW, runOf, runTagTip, runStatusText, runLabelOrder } from '../run-core.mjs'; // 실행 중 셸

const TOKEN_NAMES = ['bg', 'fog', 'grid', 'link', 'text', 'muted', 'k-main', 'k-subagent', 'k-workflow',
  'k-workflow-agent', 'k-claude-p', 'k-bash-bg', 'k-monitor', 'ok', 'error', 'skill', 'stopped', 'flow-call', 'link-spawn',
  'sess-0', 'sess-1', 'sess-2', 'sess-3', 'sess-4', 'sess-5', 'sess-6', 'sess-7', 'conflict'];
const STATUS_KEYS = new Set(['active', 'idle', 'done', 'error', 'stopped']);
const statusLabel = (s) => (STATUS_KEYS.has(s) ? t('flat.status.' + s) : s || '');
const ENDED_OK = (st) => st === 'done' || st === 'stopped';
const EXIT_LINGER = 2.5;
const SAY_KEEP_MS = 45_000;
const HIST_MAX = 5;
const MAX_LABELS = 30;
const MAX_FX = 64;
export const NODE_SCALE = 0.68;

// ---- 라벨 모드(scene.js 와 같은 규칙): 보통 → 줄임 → 이름만. 실제 크기는 모드·내용별로 잰 값, 없으면 추정 ----
const labelModeKey = (v) => (v.mini ? 'm' : v.compact ? 'c' : 'f');
function labelModes(v, small, force, fontPx, boxW, focusId) {
  const modes = [];
  const meas = (k) => { const z = v._lsz && v._lsz[k]; return z && z[2] === v._labelHtml ? z : null; };
  for (const c of small ? [true] : [false, true]) {
    const extra = (v.subTitle ? 13 : 0) + (v._extraH || 0) + (c ? 0 : (v.labelEl.querySelector('.act') ? 14 : 0) + (v.id === focusId ? v.hist.length * 14 + 8 : 0));
    const z = meas(c ? 'c' : 'f');
    modes.push({ compact: c, w: z ? z[0] + 4 : boxW(c), h: z ? z[1] : 32 + extra });
  }
  if (force) { modes.length = 1; return modes; }
  const z = meas('m'), name = trunc(v.node.label || v.node.id, 24);
  // 세션 표식(색 점·브랜치·컨텍스트)은 이름만 모드에도 남는다 — 아직 못 잰 폭 추정에 더함
  const sb = v.labelEl.querySelector && v.labelEl.querySelector('.sess-badge');
  const sbw = sb ? 16 + textWidth((sb.textContent || '').trim(), 10) : 0;
  modes.push({ compact: true, mini: true, w: z ? z[0] + 4 : textWidth(name, fontPx - 1) + 18 + sbw, h: z ? z[1] : fontPx + 7 });
  return modes;
}
function setLead(v, r, up) {
  const on = r.lead > 0;
  if (on !== !!v._lead) { v._lead = on; v.labelEl.classList.toggle('lead', on); v.labelEl.classList.toggle('lead-up', on && up); }
  if (!on) return;
  const dx = r.dx || 0, dy = r.dy || 0;
  const ll = Math.max(0, Math.round(Math.hypot(dx, dy)) - 2), la = Math.round((Math.atan2(dx, up ? dy : -dy) * 180) / Math.PI);
  const key = ll + ',' + la;
  if (v._leadKey !== key) { v._leadKey = key; v.labelEl.style.setProperty('--ll', ll + 'px'); v.labelEl.style.setProperty('--la', la + 'deg'); }
}
const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

/** 그릴 모양 종류(scene.js displayKind 와 같은 규칙): 독립 claude -p 루트는 claude-p */
export function displayKind(node) {
  if (node && node.kind === 'main' && node.meta && node.meta.orphanSdk) return 'claude-p';
  return RADIUS[node && node.kind] ? node.kind : 'subagent';
}

/** CSS 테마 토큰 → 문자열 색(2D 는 three.Color 대신 CSS 색 그대로) */
export function readTokens2d() {
  const cs = getComputedStyle(document.documentElement);
  const t = {};
  for (const n of TOKEN_NAMES) t[n] = cs.getPropertyValue('--' + n).trim() || '#888888';
  t.isLight = document.documentElement.getAttribute('data-theme') === 'light';
  return t;
}

let cssDone = false;
function ensureCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  for (const f of ['./flat.css', '../holo.css', '../flowview/flowview.css']) {
    const href = new URL(f, import.meta.url).href;
    if (document.querySelector(`link[href="${href}"]`)) continue;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.dataset.ccviz = 'flat';
    document.head.appendChild(l);
  }
}

/** 도구 장부(HoloBook) 얇은 껍데기 — 3D HoloLayer 와 같은 이름(app.js·view 가 부름). 그리기는 하위 클래스 */
class FlatHolo {
  constructor(view) {
    this.view = view; this.book = new HoloBook();
    { const vw = view; this.book.nodeOf = (id) => { const x = vw.vis && vw.vis.get(id); return x ? x.node : (vw.nodes && vw.nodes.get ? vw.nodes.get(id) : null); }; this.book.clock = () => (typeof vw.clock === 'function' ? vw.clock() : Date.now()); } // 셸 머리줄 경과·꼬리 작은 상태
  }
  start(nodeId, ev, { quiet = false, speed = 1 } = {}) { this.view.invalidate(); return this.book.start(nodeId, ev, performance.now() / 1000, { quiet, minShow: HOLO.MIN_SHOW / Math.min(4, Math.max(1, Math.sqrt(speed || 1))) }); }
  end(nodeId, toolUseId, res, result = '') { this.view.invalidate(); return this.book.end(nodeId, toolUseId, res, performance.now() / 1000, result); }
  endAll(nodeId, res) { this.book.endAll(nodeId, res, performance.now() / 1000); }
  openCount(nodeId) { return this.book.openCount(nodeId); }
  hasOpenCat(nodeId, cat) { return this.book.list(nodeId).some((e) => e.endAt == null && e.cat === cat); }
  event(ev, { quiet = false } = {}) { const n = this.book.panelEvent(ev, performance.now() / 1000, { quiet }); if (n) this.view.invalidate(); return n; }
  foldNode(nodeId) { this.book.foldNode(nodeId, performance.now() / 1000); }
  removeNode(nodeId) { this.book.removeNode(nodeId); }
  clear() { this.book.clear(); }
  applyTheme() {}
  dispose() { this.book.clear(); }
}

export class FlatView {
  static modeId = 'flow';
  static modeLabel = t('flat.mode.flow');

  /** opts.pending = 2D 판이 아직 없는 표현 id(planet·voxel) — 이 바탕(Flow 2D)으로 그리고 '준비 중' 표시 */
  constructor(container, labelContainer, opts = {}) {
    ensureCss();
    this.flat = true;
    this.dim = '2d';
    this.container = container;
    this.labelContainer = labelContainer;
    this.clock = Date.now;
    this.timeScale = 1;
    this.cameraPrefs = {};
    this.scope = { mode: 'session', roots: [], projects: [], showInactive: false, focusProject: null };
    this._ov = null;
    this._clusters = [];
    this._clusterV = new Map();
    this.pf = new ProjFade(); // 단일 프로젝트 선택 페이드
    this.tokens = readTokens2d();
    this.vis = new Map();
    this.childrenOf = new Map();
    this.parentOf = new Map();
    this.rootId = null;
    this.layoutRoot = null;
    this.focusId = null;
    this.hoverId = null;
    this.camShotId = null;
    this.focusDist = 40;
    this.layoutDirty = false;
    this.lastLayout = 0;
    this.lastLabelPass = 0;
    this.order = 0;
    this.onFrame = null;
    this.links = [];
    this.effects = [];
    this.showDone = false;
    this.compactPx = 0;           // Flow: 라벨이 보이는 노드는 작업 한 줄을 늘 보인다
    this.layoutSpread = 1.5;      // 단일 세션 배치 간격(Flow 와 같음)
    this.overviewSpread = 1.3;    // 전체 보기 섬 안 간격(Flow 3D 와 같음)
    this.labelBelow = true;
    this._exitAt = 0;
    this.animT = performance.now() / 1000;
    this._settleUntil = 0;
    this._exitingN = 0;
    this.holo = new FlatHolo(this);
    this.sess = new FlatSessions(this); // 충돌 곡선·파일명 칩·세션 간 메시지
    this.ix = new FlatIx(this); // 특별 상호작용 연출(복셀 2D 는 그리지 않음)
    this._sessColors = new Map();
    this.islandEls = new Map();
    this.cam = { x: 0, z: 0, D: 40 };
    this.stats = { ticks: 0, draws: 0, drawMs: 0, tickMs: 0, maxDrawMs: 0, lastDrawMs: 0 };
    this.reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    const c = this.canvas = document.createElement('canvas');
    c.className = 'flat-canvas';
    c.tabIndex = 0;
    container.prepend(c);
    this.ctx = c.getContext('2d', { alpha: false, desynchronized: true }) || c.getContext('2d');
    this.renderer = { domElement: c, flat: true }; // app.js(bindCanvas)·ctx-ui 가 읽는 자리
    labelContainer.classList.add('flow-mode', 'flat-mode');
    this.pendingMode = opts.pending || null;
    if (this.pendingMode) this._pendingBadge(opts.pendingLabel || this.pendingMode);

    this.dirty = true;
    this._raf = 0; this._timer = 0; this._lastTickMs = 0; this._level = 2;
    this._last = performance.now() / 1000;
    this._tickFn = () => this._tick();
    this._onVis = () => {
      if (document.hidden) { this._stop(); return; }
      this._last = performance.now() / 1000; this.invalidate();
    };
    document.addEventListener('visibilitychange', this._onVis);
    this._resize();
    this._ro = new ResizeObserver(() => { this._resize(); this.invalidate(); });
    this._ro.observe(container);
    this.applyTheme();
    this._schedule(0);
  }

  // ---------------- 렌더 루프 ----------------
  /** 다시 그려야 함(입력·이벤트·카메라 이동). 쉬는 중이면 바로 다음 프레임에 */
  invalidate() {
    this.dirty = true;
    if (this._timer) { clearTimeout(this._timer); this._timer = 0; }
    if (!this._raf) this._schedule(0);
  }
  _stop() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    if (this._timer) { clearTimeout(this._timer); this._timer = 0; }
  }
  _schedule(ms) {
    if (this._disposed || (typeof document !== 'undefined' && document.hidden)) return;
    if (this._raf || this._timer) return;
    if (ms > 20) this._timer = setTimeout(() => { this._timer = 0; this._raf = requestAnimationFrame(this._tickFn); }, ms - 12);
    else this._raf = requestAnimationFrame(this._tickFn);
  }
  _tick() {
    this._raf = 0;
    if (this._disposed) return;
    const nowMs = performance.now();
    // 상한 30fps: 앞 갱신에서 33ms 가 안 지났으면 다음 프레임으로 미룸
    if (nowMs - this._lastTickMs < 1000 / FLAT.FPS - 3) { this._raf = requestAnimationFrame(this._tickFn); return; }
    const t0 = nowMs;
    this._lastTickMs = nowMs;
    const now = nowMs / 1000;
    const dt = Math.min(0.05, Math.max(0.0001, now - this._last));
    this._last = now;
    let level = 0;
    if (this._frozen) {
      if (this._frozenFn) this._frozenFn(dt, now); // 실시간 일시정지: 카메라만(장면 상태는 그대로)
    } else {
      this.animT += dt;
      level = this._update(now, dt);
      if (this.onFrame) this.onFrame(dt, now);
    }
    this.stats.ticks++;
    if (this.dirty || level > 0) {
      const d0 = performance.now();
      this._draw(now);
      const ms = performance.now() - d0;
      this.stats.draws++; this.stats.drawMs += ms; this.stats.lastDrawMs = ms; if (ms > this.stats.maxDrawMs) this.stats.maxDrawMs = ms;
      this.dirty = false;
    }
    this.stats.tickMs += performance.now() - t0;
    this._level = level;
    // 움직임(스프링·퇴장·패킷·카드 펼침) 30fps, 배경 움직임(숨쉬기·스피너)만 15fps, 아무것도 없으면 4Hz 논리 갱신
    this._schedule(level >= 2 ? 0 : tickInterval(level)); // 30fps 는 위 시각 검사로(0 = 다음 프레임)
  }
  /** 실시간 일시정지: 장면 갱신을 멈추고 fn(dt, now)(카메라)만. 끄면 원래대로 */
  setFrozen(on, fn = null) { this._frozen = !!on; this._frozenFn = on ? fn : null; this._last = performance.now() / 1000; this.invalidate(); }

  _resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const dpr = this.dpr = capDpr(window.devicePixelRatio || 1);
    this.W = w; this.H = h;
    const c = this.canvas;
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
    c.style.width = w + 'px'; c.style.height = h + 'px';
  }

  // ---------------- 표현 공통 인터페이스 ----------------
  setClock(fn) { this.clock = typeof fn === 'function' ? fn : Date.now; }
  setTimeScale(k) { this.timeScale = Number(k) || 1; }
  say() {}
  flowEvent(ev, opts = {}) {
    if (this.ix) this.ix.event(ev, opts);
    if (ev.type === 'text' && ev.role === 'assistant' && (ev.brief || ev.text)) {
      const v = this.vis.get(ev.nodeId);
      if (v) { v.sayLine = { text: ev.brief || sayBrief(ev.text), at: Date.now() }; this._labelText(v); }
    }
    this.invalidate();
  }
  setShowDone(on) { this.showDone = !!on; this._exitPass(this.animT, true); this.invalidate(); }
  get exitSettling() { return this._exitingN > 0 || this.animT < this._settleUntil; }
  get hiddenDoneCount() { let n = 0; for (const v of this.vis.values()) if (v.gone) n++; return n; }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._stop();
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._ro) this._ro.disconnect();
    if (this._lro) this._lro.disconnect();
    for (const v of this.vis.values()) v.labelEl.remove();
    for (const el of this.islandEls.values()) el.remove();
    this.islandEls.clear();
    if (this._badge) this._badge.remove();
    this.labelContainer.classList.remove('flow-mode', 'flat-mode');
    this.holo.dispose();
    this.vis.clear(); this.links = []; this.effects = [];
    this.canvas.remove();
  }

  applyTheme() {
    this.tokens = readTokens2d();
    for (const v of this.vis.values()) { if (v.sessIdx != null) v.sessC = this.tokens['sess-' + v.sessIdx]; v._col = null; this._styleVis(v); v._labelHtml = null; this._labelText(v); }
    this.invalidate();
  }
  kindColor(kind) { return this.tokens['k-' + kind] || this.tokens['k-subagent']; }

  // ---------------- 노드 ----------------
  reset() {
    for (const v of [...this.vis.values()]) this._disposeVis(v);
    this.vis.clear(); this._nmapDirty = true; this.childrenOf.clear(); this.parentOf.clear();
    this.effects = []; this.links = [];
    this.holo.clear();
    if (this.ix) this.ix.clear();
    this._exitingN = 0; this._settleUntil = 0;
    this.focusId = null; this.hoverId = null;
    this.order = 0;
    this.layoutDirty = true;
    this.invalidate();
  }
  setRoot(id) { this.rootId = id; this.layoutDirty = true; this.invalidate(); }

  /** 노드 그린 반지름(세계 단위): Flow 칩 크기 규칙과 같음. 하위 표현이 바꿀 수 있다 */
  _nodeR(node, kind) {
    const dev = isLauncher(node);
    const r = RADIUS[kind] * NODE_SCALE * (dev ? 2 * BATCH.DEVICE_K : 1);
    const k = dev ? 1.6 : ({ main: 0.95, 'claude-p': 1.25, workflow: 1.1 }[kind] ?? 1.45);
    return r * k;
  }

  addNode(node, spawn = true) {
    const old = this.vis.get(node.id);
    if (old && old.removing) this._dropNode(node.id);
    else if (old) { this.updateNode(node.id, node); return; }
    const kind = displayKind(node);
    node._order = this.order++;
    const now = performance.now() / 1000;
    const v = {
      id: node.id, node, kind, r: this._nodeR(node, kind),
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fresh: true, spawn,
      icons: new Map(), hist: [], sayLine: null, seed: Math.random() * 10,
      errorSince: node.status === 'error' ? now - 10 : null, labelOn: false,
      bornAt: now, size: 1, drawS: 1,
      endWall: ENDED_OK(node.status) ? -1e9 : null, exiting: null, gone: false, exitF: 1, ovHidden: false,
      device: isLauncher(node),
    };
    const rof = node.meta && node.meta.rearmOf;
    if (rof && this.vis.has(rof)) v.inheritFrom = rof;
    const el = document.createElement('div');
    el.className = 'node-label';
    el.style.position = 'absolute'; el.style.left = '0'; el.style.top = '0';
    v.labelEl = el;
    const ro = this._labelRO();
    if (ro) { el._vis = v; ro.observe(el); }
    this.vis.set(node.id, v);
    this._nmapDirty = true;
    this._styleVis(v);
    if (v.device) this._syncDevice(v);
    this._labelText(v);
    for (const t of node.openTools || []) this.toolStart(node.id, { ...t, toolUseId: t.toolUseId, ts: t.startedAt }, true);
    this._touchDevice(node.parentId);
    if (this.ix) { const se = ixSeedEvent(node); if (se) this.ix.event(se); } // 외부 작업 진행 띠를 스냅샷에서 바로
    this.layoutDirty = true;
    this.invalidate();
  }
  _touchDevice(pid) {
    const p = pid && this.vis.get(pid);
    if (!p || !p.device) return;
    this._syncDevice(p); this._labelText(p);
    this.layoutDirty = true;
  }
  updateNode(id, patch = {}, opts = {}) {
    const v = this.vis.get(id);
    if (!v || v.removing) return;
    if ('parentId' in patch || (patch.meta && 'phase' in patch.meta)) this.layoutDirty = true;
    if (patch.status === 'error' && v.errorSince == null) v.errorSince = performance.now() / 1000;
    if (patch.status && patch.status !== 'error') v.errorSince = null;
    if ('status' in patch) {
      if (patch.status === 'done' || patch.status === 'error' || patch.status === 'stopped') {
        const res = patch.status === 'error' ? 'error' : patch.status === 'stopped' ? 'stopped' : 'ok';
        this.holo.endAll(id, res);
        v.icons.clear();
      }
      if (ENDED_OK(patch.status)) { if (v.endWall == null) v.endWall = opts.quiet ? -1e9 : this.animT; }
      else { v.endWall = null; if ((v.exiting != null || v.gone) && !(patch.status === 'error' && v.badWall != null)) this._unexit(v); } // 퇴장한 오류 노드에 같은 오류 갱신이 와도 되살리지 않음
      this._exitAt = 0;
    }
    if (v.device) this._syncDevice(v);
    this._styleVis(v);
    this._labelText(v);
    if ('status' in patch || 'parentId' in patch) this._refreshAncestorLabels(v.node.parentId);
    if ('status' in patch) { this._touchDevice(v.node.parentId); if (v.kind === 'monitor') this.layoutDirty = true; }
    if (patch.meta && 'batch' in patch.meta) this.layoutDirty = true;
    this.invalidate();
  }
  _refreshAncestorLabels(pid) {
    for (let i = 0; pid && i < 32; i++) { const p = this.vis.get(pid); if (!p) break; this._labelText(p); pid = p.node.parentId; }
  }
  _activeBelow(id) {
    const kids = new Map();
    for (const x of this.vis.values()) { const pp = x.node.parentId; if (pp) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(x); } }
    const stack = [...(kids.get(id) || [])];
    for (let i = 0; stack.length && i < 5000; i++) { const x = stack.pop(); if (x.node.status === 'active') return true; stack.push(...(kids.get(x.id) || [])); }
    return false;
  }
  removeNode(id, opts = {}) {
    const v = this.vis.get(id); if (!v) return;
    if (v.removing) { if (opts.animate === false) this._dropNode(id); return; }
    const pol = opts.animate === false ? null : exitPolicy(this.timeScale, !!opts.quiet);
    if (!pol || v.hidden || v.gone || (v.scopeK ?? 1) < 0.5) { this._dropNode(id); return; }
    v.removing = true;
    this.holo.foldNode(id);
    if (v.exiting == null) this._startExit(v, pol);
    v.icons.clear();
    this.invalidate();
  }
  _dropNode(id) {
    const v = this.vis.get(id); if (!v) return;
    if (v.exiting != null) this._exitingN = Math.max(0, this._exitingN - 1);
    this._disposeVis(v); this.vis.delete(id); this._nmapDirty = true; this.holo.removeNode(id); this.layoutDirty = true;
    this._settleUntil = Math.max(this._settleUntil, this.animT + EXIT.SETTLE);
    this._dropped(id);
    this.invalidate();
  }
  _dropped() {}
  _startExit(v, pol) { v.exiting = this.animT; v.exitDur = pol.dur; this._exitingN++; }
  _endExit(v) {
    if (v.removing) { this._dropNode(v.id); return; }
    v.exiting = null; this._exitingN = Math.max(0, this._exitingN - 1);
    v.gone = true; v.exitF = 0; v._linkK = 0; this._syncHidden(v); this.layoutDirty = true;
    if (v.labelEl.style.opacity) v.labelEl.style.opacity = '';
    this._settleUntil = Math.max(this._settleUntil, this.animT + EXIT.SETTLE);
  }
  _disposeVis(v) {
    v.labelEl.remove();
    if (this._lro) { this._lro.unobserve(v.labelEl); v.labelEl._vis = null; }
  }
  _labelRO() {
    if (this._lro !== undefined) return this._lro;
    this._lro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((ents) => {
      for (const en of ents) {
        const v = en.target._vis; if (!v) continue;
        const bs = en.borderBoxSize && en.borderBoxSize[0];
        const h = bs ? bs.blockSize : en.target.offsetHeight;
        if (h > 0) v._labelH = h;
        const w = bs ? bs.inlineSize : en.target.offsetWidth;
        if (w > 0) v._labelW = w; // 라벨 배치는 실제 폭을 쓴다
        if (w > 0 && h > 0) (v._lsz || (v._lsz = {}))[labelModeKey(v)] = [w, h, v._labelHtml]; // 모드별 실제 크기
      }
    });
    return this._lro;
  }
  /** 불투명도 바탕(완료·중지 흐림 × 전체 보기 희미) — 그리기에서 씀 */
  _styleVis(v) {
    const t = this.tokens, st = v.node.status;
    const sk = v.scopeK ?? 1;
    const endOp = st === 'done' ? (t.isLight ? 0.5 : 0.35) : st === 'stopped' ? (t.isLight ? 0.6 : 0.5) : 1;
    v.baseOpacity = endOp * sk;
  }
  _syncDevice(v) { if (v.device) { v.devInfo = deviceInfo(v.node, this._nodeMap()); v._bandCode = null; } }
  /** id → node(라벨 꼬리표·장치 집계용). 노드가 더해지거나 빠질 때만 다시 만든다(노드 객체는 제자리에서 고쳐지므로) — 3D 는 부를 때마다 만듦 */
  _nodeMap() {
    if (this._nmap && !this._nmapDirty) return this._nmap;
    const m = this._nmap || (this._nmap = new Map());
    m.clear();
    for (const [id, x] of this.vis) m.set(id, x.node);
    this._nmapDirty = false;
    return m;
  }

  // ---------------- 라벨(scene.js 와 같은 문구) ----------------
  /** 시계로만 바뀌는 표시(정체· 실행 경과·정체 모습)가 바뀜: 라벨 다시, 실행 중 셸이면 모습(색 캐시)도 + 다시 그림 */
  _clockRefresh(v) { this._labelText(v); if (runOf(v.node)) { this._styleVis(v); this.invalidate(); } }
  _labelText(v) {
    const n = v.node;
    const name = trunc(n.label || n.id, 24);
    const waiting = n.status === 'idle' && (v.kind === 'main' || v.kind === 'claude-p') && this._activeBelow(v.id);
    const job = isJob(n); // 작업 노드(scene.js 와 같은 문구)
    const kindName = v.device ? t('flat.kind.device') : v.dockK ? t('flat.kind.dock') : job ? t('cards.job.kind') : (KIND_LABEL[v.kind] || v.kind);
    const sub = job ? kindName : `${kindName} · ${waiting ? t('flat.sub.waiting') : v.standby ? t('flat.sub.standby') : runStatusText(n, this.clock(), statusLabel)}`; // 실행 중 셸: 정체·작업 중
    const tools = v.icons.size > 1 ? ' · ' + t('flat.sub.tools', { n: v.icons.size }) : '';
    const st = nodeSubtitle(n);
    v.subTitle = st;
    const stHtml = st ? `<span class="ntitle" title="${escapeHtml(st)}">${escapeHtml(st)}</span>` : '';
    const tags = nodeTags(n, this._nodeMap(), this.clock());
    v._jobKey = clockLabelKey(n, this.clock()); // 시계로만 바뀌는 정체·실행 경과 표시를 _exitPass 가 다시 그림
    const spt = spawnTag(n); if (spt) tags.push(spt); // 띄움 꼬리표
    const tgHtml = tags.length ? `<span class="ntags">${tags.map((x) => { const tp = runTagTip(x, n); return `<i${tp ? ` title="${escapeHtml(tp)}"` : ''}>${escapeHtml(x)}</i>`; }).join('')}</span>` : ''; // 버퍼링? 꼬리표는 툴팁(이유별: python -u 권고·파이프·출력 버림)
    const devHtml = v.device && v.devInfo ? `<span class="ndev">${escapeHtml(deviceSummary(v.devInfo))}</span>` : '';
    v._extraH = (tgHtml ? 13 : 0) + (devHtml ? 13 : 0);
    const sb = v.sessIdx != null && v.kind === 'main' && !n.parentId ? sessBadgeHtml(v.sessIdx, n.meta && n.meta.ctx, branchOf(n)) : '';
    let html = `${escapeHtml(name)}${sb}${stHtml}<small>${escapeHtml(sub + tools)}</small>${tgHtml}${devHtml}${this._actHtml(v)}${this._catsHtml(v)}`;
    if (this.focusId === v.id && v.hist.length) html += this._histHtml(v);
    if (v._labelHtml !== html) { v.labelEl.innerHTML = html; v._labelHtml = html; }
    v.labelEl.classList.toggle('focus', this.focusId === v.id);
  }
  _catCss(cat) { return cat === 'skill' ? 'var(--skill)' : catColor(cat, this.tokens.isLight); }
  _catsHtml(v) {
    const rc = v.recentCats;
    if (!rc || rc.size < 2) return '';
    const now = Date.now();
    const list = [...rc.entries()].filter(([, t]) => now - t < 60_000).sort((a, b) => b[1] - a[1]).slice(0, 6);
    for (const [c, t] of rc) if (now - t >= 60_000) rc.delete(c);
    if (list.length < 2) return '';
    return `<span class="cats">${list.map(([c]) => `<i style="--hc:${this._catCss(c)}">${escapeHtml(CAT_LABEL[c] || c)}</i>`).join('')}</span>`;
  }
  _actHtml(v) {
    let last = null;
    for (const a of v.icons.values()) last = a;
    if (last && last.act) {
      const [tool, ...rest] = last.act.split(' · ');
      return `<span class="act" style="--hc:${this._catCss(last.cat)}"><i>${escapeHtml(tool)}</i>${rest.length ? ' · ' + escapeHtml(rest.join(' · ')) : ''}</span>`;
    }
    const sl = v.sayLine;
    if (sl && sl.text && Date.now() - sl.at < SAY_KEEP_MS && v.node.status !== 'done' && v.node.status !== 'stopped') return `<span class="act say">“${escapeHtml(sl.text)}”</span>`;
    return '';
  }
  _histHtml(v) {
    const li = v.hist.map((h) => {
      const [tool, ...rest] = h.label.split(' · ');
      const mark = h.res == null ? '…' : h.res === 'error' ? '✕' : h.res === 'stopped' ? '■' : '✓';
      return `<li class="${h.res === 'error' ? 'err' : ''}" style="--hc:${this._catCss(h.cat)}">${mark} <i>${escapeHtml(tool)}</i>${rest.length ? ' · ' + escapeHtml(rest.join(' · ')) : ''}${h.result ? ` <em>→ ${escapeHtml(h.result)}</em>` : ''}</li>`;
    }).join('');
    return `<ol class="hist">${li}</ol>`;
  }

  // ---------------- 도구 ----------------
  toolStart(nodeId, ev, quiet = false) {
    const v = this.vis.get(nodeId); if (!v || v.removing) return;
    const id = ev.toolUseId || ('anon' + Math.random());
    if (v.icons.has(id)) return;
    const cat = ev.skill ? 'skill' : ev.cat || 'other';
    const act = actLine(ev);
    v.icons.set(id, { cat, skill: ev.skill || null, act });
    (v.recentCats || (v.recentCats = new Map())).set(cat, Date.now());
    this.holo.start(nodeId, { ...ev, toolUseId: id }, { quiet, speed: this.timeScale });
    pushHist(v.hist, { id, label: act, cat, res: null, result: '' }, HIST_MAX);
    this._labelText(v);
  }
  toolEnd(nodeId, ev) {
    const v = this.vis.get(nodeId); if (!v) return;
    const id = ev.toolUseId;
    const res = ev.ok === false ? 'error' : 'ok';
    const result = ev.brief || '';
    const known = id ? this.holo.end(nodeId, id, res, result || ev.text || '') : false;
    if (id && v.icons.has(id)) v.icons.delete(id);
    else if (!known) this.wave(nodeId, ev.ok === false ? this.tokens.error : this.tokens.ok, 0.7);
    if (id && v.hist.some((h) => h.id === id)) pushHist(v.hist, { id, res, result: result || (ev.ok === false ? String(ev.text || '').slice(0, 40) : '') }, HIST_MAX);
    this._labelText(v);
  }

  // ---------------- 효과(가벼운 2D: 퍼지는 고리 하나) ----------------
  _fx(e) { if (this.effects.length >= MAX_FX) this.effects.shift(); e.t0 = performance.now() / 1000; this.effects.push(e); this.invalidate(); }
  ripple(id, color) { const v = this.vis.get(id); if (v) this._fx({ id, color: color || this.kindColor(v.kind), dur: 0.9, k0: 1.15, k1: 2.45, a: 0.7 }); }
  wave(id, color, scale = 1) { const v = this.vis.get(id); if (v) this._fx({ id, color: color || this.kindColor(v.kind), dur: 0.75, k0: scale, k1: scale * 3.4, a: 0.8 }); }
  orb() {}

  // ---------------- 배치·퇴장(scene.js 와 같은 규칙) ----------------
  layoutNow() { this._exitPass(this.animT, true, false); this._relayout(); this.invalidate(); }
  _syncHidden(v) {
    const h = !!(v.ovHidden || v.gone || v.foldHidden || v.projGone);
    if (h !== !!v.hidden) v.hidden = h;
  }
  _unexit(v) {
    if (v.removing) return;
    if (v.exiting != null) this._exitingN = Math.max(0, this._exitingN - 1);
    v.exiting = null; v.exitF = 1; v._linkK = 0;
    if (v.labelEl.style.opacity) v.labelEl.style.opacity = '';
    if (v.gone) { v.gone = false; v.bornAt = performance.now() / 1000; this._syncHidden(v); this.layoutDirty = true; }
  }
  _exitPass(now, force = false, animate = true) {
    if (!force && now - this._exitAt < 0.25) return;
    this._exitAt = now;
    if (this.showDone) {
      const cm = this.clock();
      for (const v of this.vis.values()) {
        if (v.exiting != null || v.gone) this._unexit(v);
        if (v._jobKey != null && clockLabelKey(v.node, cm) !== v._jobKey) this._clockRefresh(v); // 정체· 실행 경과(시계)
      }
      return;
    }
    const nodes = new Map();
    for (const [id, v] of this.vis) if (!v.removing) nodes.set(id, v.node);
    const roots = [this.rootId, this.layoutRoot];
    for (const r of this.scope.roots || []) roots.push(r.nodeId);
    const clockMs = this.clock();
    // 문제 있게 끝난 노드: 끝난 시각이 없으면 처음 본 시각부터 센다(표시 시계 — 재생은 가상 시계)
    const seen = this._badSeen || (this._badSeen = new Map());
    for (const [id, n] of nodes) { if (!endedBadly(n)) seen.delete(id); else if (!seen.has(id)) seen.set(id, clockMs); }
    const elig = exitEligible(nodes, roots, { nowMs: clockMs, seen });
    const linger = EXIT_LINGER / Math.min(4, Math.max(1, Math.sqrt(this.timeScale || 1)));
    const pol = animate ? exitPolicy(this.timeScale) : null;
    const own = new Map();
    for (const [id, v] of this.vis) {
      if (v.removing || !elig.has(id)) { v.badWall = null; continue; }
      if (endedBadly(v.node)) {
        // 문턱을 지난 순간을 '막 LINGER 가 지난 끝'으로 잡아 같은 퇴장 연출. 한참 지난 것(스냅샷·탐색)은 바로 숨김
        if (v.badWall == null) { const due = badEndDueAt(v.node, seen.get(id)); v.badWall = due != null && (clockMs - due) / 1000 / Math.max(1, this.timeScale || 1) > linger + EXIT.DUR + 1 ? -1e9 : now - linger; }
        own.set(id, v.badWall);
      } else { v.badWall = null; own.set(id, v.endWall); }
    }
    const walls = exitWalls(nodes, elig, own); // 하위가 늦게 끝나면 그때부터 센다
    for (const [id, v] of this.vis) {
      if (v.removing) continue;
      const ago = v.node.endedAt ? (clockMs - Date.parse(v.node.endedAt)) / 1000 : -1;
      const standby = v.kind === 'monitor' && !v.foldHidden && rearmStandby(v.node, nodes.get(v.node.parentId), ago);
      if (standby !== !!v.standby) { v.standby = standby; this._labelText(v); }
      if (v._jobKey != null && clockLabelKey(v.node, clockMs) !== v._jobKey) this._clockRefresh(v); // 정체· 실행 경과(시계)
      const endWall = elig.has(id) ? walls.get(id) : null;
      let want = elig.has(id) && endWall != null && now - endWall >= linger && !standby;
      if (v.foldHidden && elig.has(id) && endWall != null) want = true;
      if (want && v.foldHidden && !v.gone) { if (v.exiting != null) this._exitingN = Math.max(0, this._exitingN - 1); v.exiting = null; v.gone = true; v.exitF = 0; this._syncHidden(v); continue; }
      if (want) {
        if (v.gone || v.exiting != null) continue;
        if (!pol || now - endWall > linger + EXIT.DUR + 1) { v.gone = true; v.exitF = 0; this._syncHidden(v); this.layoutDirty = true; }
        else this._startExit(v, pol);
      } else if (v.exiting != null || v.gone) this._unexit(v);
    }
  }
  _relayout() {
    const nodes = new Map();
    for (const [id, v] of this.vis) if (!v.gone) nodes.set(id, v.node);
    const every = new Map();
    for (const [id, v] of this.vis) if (!v.removing) every.set(id, v.node);
    const bf = this._fold = batchFold(every);
    for (const v of this.vis.values()) {
      const fh = bf.hidden.has(v.id);
      if (fh !== !!v.foldHidden) { v.foldHidden = fh; this._syncHidden(v); }
      const dk = bf.docked.has(v.id) ? BATCH.DOCK_SCALE : 0;
      if (dk !== (v.dockK || 0)) { v.dockK = dk; this._labelText(v); }
    }
    for (const id of bf.hidden) nodes.delete(id);
    for (const id of bf.docked.keys()) nodes.delete(id);
    for (const [id, rr] of bf.rearm) {
      const a = this.vis.get(rr.anchorId), n = nodes.get(id);
      if (a && n && a !== this.vis.get(id)) nodes.set(id, { ...n, _order: a.node._order });
    }
    let pos, parentOf, root;
    const all = this.scope.mode === 'all';
    if (all) {
      const ov = this._ov = computeOverview(nodes, this.scope.roots, this.scope.projects, this._ov, { showInactive: this.scope.showInactive, nowMs: Date.now(), spread: this.overviewSpread || 1, facing: !!this.overviewFacing, round: this.constructor.modeId === 'planet', aspect: (this.W || 16) / (this.H || 10), view: packView(this.container, { labelBelow: !!this.labelBelow, labelReserve: this.labelReserve ? this.labelReserve() : null, flat: true }) }); // 섬 배치는 가용 영역 비율
      pos = ov.pos; parentOf = ov.parentOf;
      const c0 = ov.clusters.find((c) => c.active && c.mains.length) || ov.clusters.find((c) => c.mains.length);
      root = c0 ? c0.currentMain || c0.mains[0].nodeId : (ov.roots[0] ? ov.roots[0].nodeId : null);
      this._setClusters(ov.clusters);
    } else ({ pos, parentOf, root } = computeLayout(nodes, this.rootId));
    const hid = all && this._ov ? this._ov.hidden : null;
    for (const [id, d] of bf.docked) {
      const lp = pos.get(d.launcher);
      if (!lp) continue;
      pos.set(id, dockedPos(lp, pos.get(parentOf.get(d.launcher)), d.slot)); // 장치 옆, 사슬에 수직
      parentOf.set(id, d.launcher);
      if (all && this._ov) { this._ov.projectOf.set(id, this._ov.projectOf.get(d.launcher)); this._ov.rootOf.set(id, this._ov.rootOf.get(d.launcher)); }
    }
    this.parentOf = parentOf;
    this.layoutRoot = root;
    this.childrenOf = new Map();
    this.links = [];
    for (const [id, p] of parentOf) {
      if (!p) continue;
      if (!this.childrenOf.has(p)) this.childrenOf.set(p, []);
      this.childrenOf.get(p).push(id);
      const cv = this.vis.get(id), pv = this.vis.get(p);
      if (cv && pv && !(hid && (hid.has(id) || hid.has(p)))) this.links.push([cv, pv]);
    }
    // 띄움 점선: 배치에 든(보이는) 노드끼리만
    const lay = (id) => nodes.has(id) && pos.has(id) && !(hid && hid.has(id));
    this.spawnLinks = spawnLinks(nodes, lay, every).map(([a, b]) => [this.vis.get(a), this.vis.get(b)]).filter(([a, b]) => a && b);
    // 평면 배치(Flow 와 같음): 높이 0, 단일 세션은 간격 1.5배
    const k = all ? 1 : this.layoutSpread;
    for (const [id, v] of this.vis) {
      const p = pos.get(id); if (!p) continue;
      v.target.x = p.x * k; v.target.y = 0; v.target.z = p.z * k;
      if (v.fresh) {
        v.fresh = false;
        const pv = this.vis.get(parentOf.get(id));
        const iv = v.inheritFrom && this.vis.get(v.inheritFrom);
        const from = iv ? iv.pos : v.spawn && pv && !pv.fresh ? pv.pos : v.target;
        if (iv) v.bornAt -= 1;
        v.pos.x = from.x; v.pos.z = from.z;
      }
    }
    this.layoutDirty = false;
    this._applyScope();
    this.invalidate();
  }

  // ---------------- 여러 live 세션 ----------------
  setSessions({ book } = {}) { if (this.sess) this.sess.setBook(book || null); this.invalidate(); }
  sessionMsg(ev) { return this.sess ? this.sess.message(ev) : false; }

  // ---------------- 전체 보기 ----------------
  setScope(scope = {}) {
    const mode = scope.mode === 'all' ? 'all' : 'session';
    const prevMode = this.scope.mode;
    this.scope = { mode, roots: scope.roots || [], projects: scope.projects || [], showInactive: !!scope.showInactive, focusProject: mode === 'all' ? scope.focusProject || null : null, fadeHide: scope.fadeHide || null };
    this._sessColors = mode === 'all' ? sessionColorMap(this.scope.projects) : new Map();
    if (mode === 'all') ensureOverviewCss();
    if (mode === 'session') { this._clusters = []; this._clusterV.clear(); this._ov = null; this._syncIslandEls(); }
    this.pf.setFocus(this.scope.focusProject, [...this._clusterV.keys()], { instant: !this._clusterV.size || prevMode !== mode }); this.pf.setHidden(mode === 'all' ? scope.fadeHide : null, { instant: !this._clusterV.size || prevMode !== mode }); // //
    this.layoutDirty = true;
    if (prevMode !== mode) this._relayout(); else this._applyScope();
    this.lastLabelPass = 0;
    this.invalidate();
  }
  _setClusters(clusters) {
    this._clusters = clusters;
    const keep = new Set();
    for (const c of clusters) {
      keep.add(c.projectId);
      let e = this._clusterV.get(c.projectId);
      if (!e) { e = { projectId: c.projectId, center: { x: 0, y: 0, z: 0 } }; this._clusterV.set(c.projectId, e); }
      e.center.x = c.center.x; e.center.y = 0; e.center.z = c.center.z;
      e.r = c.r; e.name = c.name; e.active = !!c.active; e.live = !!c.live; e.busy = !!c.busy; e.inactive = !!c.inactive; e.temp = !!c.temp;
      e.labelZ = c.labelZ ?? (c.box ? c.center.z + c.box.hd + 1.2 : null); // 이름표 자리(z) — 섬 상자 아래, 없으면 원 아래(복셀 동은 바닥판 앞 가장자리)
      e.box = c.box || null; e.orbit = c.orbit || null; e.zones = c.zones || null; e.round = c.round || 0; e.stars = c.stars || null;
      e.c = c;
    }
    for (const k of [...this._clusterV.keys()]) if (!keep.has(k)) this._clusterV.delete(k);
    this._syncIslandEls();
  }
  /** 섬 이름표(DOM, 3D 와 같은 .ov-island 꼴 — app 의 pickLabelAt 이 그대로 집는다) */
  _syncIslandEls() {
    for (const [pid, el] of this.islandEls) if (!this._clusterV.has(pid)) { el.remove(); this.islandEls.delete(pid); }
    for (const [pid, e] of this._clusterV) {
      let el = this.islandEls.get(pid);
      if (!el) {
        el = document.createElement('div'); el.className = 'ov-island';
        el.style.position = 'absolute'; el.style.left = '0'; el.style.top = '0';
        this.labelContainer.appendChild(el); this.islandEls.set(pid, el);
      }
      el.dataset.pid = pid;
      const html = islandLabelHtml(e.c || e);
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
      el.classList.toggle('inactive', !!e.inactive);
      // 다른 프로젝트 이름표는 페이드 아웃 → display:none(pickLabelAt·라벨 장애물에서 빠짐)
      const fa = this.projAlpha(pid), op = fa < 1 ? (Math.round(fa * 20) / 20).toFixed(2) : '';
      if (el.style.opacity !== op) el.style.opacity = op;
      if (this.projGone(pid) !== (el.style.display === 'none')) el.style.display = this.projGone(pid) ? 'none' : '';
      el.classList.toggle('dim', false);
      el.classList.toggle('focus', this.scope.focusProject === pid);
    }
  }
  _applyScope() {
    const ov = this.scope.mode === 'all' ? this._ov : null;
    const fp = ov ? this.scope.focusProject : null;
    for (const v of this.vis.values()) {
      const hidden = !!(ov && ov.hidden.has(v.id));
      const pid = ov ? ov.projectOf.get(v.id) || null : null;
      const rid = ov ? ov.rootOf.get(v.id) : null;
      const rv = rid ? this.vis.get(rid) : null;
      const recent = !!(ov && rv && isRecentRoot(rv.node));
      // scopeD = 고정 희미(recent) — 문턱 판정, projA = 프로젝트 페이드, scopeK = 곱(그리기 배율)
      const d = recent ? 0.35 : 1;
      const nf = ov ? nodeFade(this.pf, pid, rid, fp) : null; // 프로젝트 고르기·세션 숨김(루트 키는 숨김만 따름)
      const pa = nf ? nf.a : 1;
      const k = d * pa;
      v.projectId = pid;
      v.scopeRecent = recent;
      v.ovHidden = hidden;
      v.scopeD = d; v.projA = pa;
      v.projOut = !!(nf && nf.out);
      v.projGone = !!(nf && nf.gone);
      if (v.labelEl && v.exiting == null) { const o = pa < 1 ? (Math.round(pa * 20) / 20).toFixed(2) : ''; if (v.labelEl.style.opacity !== o) v.labelEl.style.opacity = o; }
      const si = ov ? nodeSessIdx(v.node, this._sessColors) : null; // 세션 색
      if (si !== (v.sessIdx ?? null)) { v.sessIdx = si; v.sessC = si == null ? null : this.tokens['sess-' + si]; v._col = null; v._edgeK = null; v._labelHtml = null; this._labelText(v); }
      this._syncHidden(v);
      if (k !== (v.scopeK ?? 1)) { v.scopeK = k; this._styleVis(v); }
    }
    this._syncIslandEls();
  }
  _scopeOff(v) { return !!v && (v.hidden || v.exiting != null || (v.scopeD ?? v.scopeK ?? 1) < 0.5); }
  /** 프로젝트 투명도·숨김 — 프로젝트 단위 층(섬·작업 대상 층·계획 보드)이 쓴다 */
  projAlpha(pid) { return this.scope.mode === 'all' ? this.pf.alpha(pid) : 1; }
  projGone(pid) { return this.scope.mode === 'all' ? this.pf.gone(pid) : false; }
  clusters() { return this.scope.mode === 'all' ? [...this._clusterV.values()] : []; }
  clusterTarget(projectId) { const e = this._clusterV.get(projectId); return e ? { center: e.center, r: e.r, box: e.box || null, round: e.round || 0 } : null; } // box: 상자 맞춤, round: 원형 궤도계 반지름
  nodeCluster(id) { const v = this.vis.get(id); return v ? v.projectId || null : null; }
  /** opts.pid = 그 섬만 + 둘레 여유(프로젝트 영역). 나가는(숨는) 섬은 집지 않음 */
  pickCluster(clientX, clientY, opts = {}) {
    if (this.scope.mode !== 'all') return null;
    const r = this.canvas.getBoundingClientRect();
    const w = toWorld(this.cam, r.width || 1, r.height || 1, clientX - r.left, clientY - r.top);
    if (opts.pid) {
      const e = this._clusterV.get(opts.pid);
      return e ? pickIslandAt([e], w.x, w.z, projectAreaPad(e.box ? e.box.hw : e.r, e.box ? e.box.hd : e.r)) : null;
    }
    return pickIslandAt([...this._clusterV.values()].filter((c) => !this.pf.out(c.projectId)), w.x, w.z);
  }

  // ---------------- 질의 (카메라용) ----------------
  has(id) { return this.vis.has(id); }
  nodeTarget(id) { const v = this.vis.get(id); return v ? v.target : null; }
  nodePos(id) { const v = this.vis.get(id); return v ? v.pos : null; }
  nodeRadius(id) { const v = this.vis.get(id); return v ? v.r : 1; }
  children(id) { return this.childrenOf.get(id) || []; }
  get size() { return this.vis.size; }
  setFocus(id) {
    const prev = this.focusId; this.focusId = id;
    for (const pid of [prev, id]) { const v = pid && this.vis.get(pid); if (v) this._labelText(v); }
    this.lastLabelPass = 0;
    this.invalidate();
  }
  setHover(id) { if (this.hoverId === id) return; this.hoverId = id; this.lastLabelPass = 0; this.invalidate(); }
  /** 화면 px → 노드 id(칩 안, 작으면 9px 까지 넓힘). 숨김·희미·퇴장 중은 고르지 않음 */
  /** 도구 카드 집기 → {id, e} | null(나중에 그린 카드가 위) */
  pickPanel(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect(), x = clientX - r.left, y = clientY - r.top;
    const hs = this._cardHits || [];
    for (let i = hs.length - 1; i >= 0; i--) { const h = hs[i]; if (x >= h.x0 - 2 && x <= h.x1 + 2 && y >= h.y0 - 2 && y <= h.y1 + 2) { const v = this.vis.get(h.id); if (v && !this._scopeOff(v) && !v.projOut) return { id: h.id, e: h.e }; } }
    return null;
  }

  /** 사용자 콘솔 집기 → 뿌리(메인) id | null(흐름·Planet 2D, 복셀 2D 는 Voxel2DView 가 덮어씀) */
  pickConsole(clientX, clientY) {
    if (!this.ix || this.ix.off) return null;
    const r = this.canvas.getBoundingClientRect();
    const id = this.ix.consoleAt(clientX - r.left, clientY - r.top);
    const v = id ? this.vis.get(id) : null;
    return v && !this._scopeOff(v) && !v.projOut ? id : null;
  }
  consolePos(id) { return this.ix && !this.ix.off ? this.ix.consolePos(id) : null; }

  pick(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const px = clientX - r.left, py = clientY - r.top;
    const s = camScale(this.cam, this.H);
    const items = [];
    const p = this._pt || (this._pt = {});
    for (const v of this.vis.values()) {
      if (v.gone || this._scopeOff(v) || v.projOut) continue; // 나가는 프로젝트 노드는 고르지 않음
      toScreen(this.cam, this.W, this.H, v.pos.x, v.pos.z, p);
      items.push({ id: v.id, x: p.x, y: p.y, r: v.r * (v.drawS || 1) * s * 1.05 });
    }
    return pickNearest(items, px, py);
  }
  /** ctx-ui 권장 문구 자리: 3D project 와 같은 모양 {x, y(아래가 0, 버퍼 px), r, ndcX, ndcY} */
  projectNdc(c, r, W, H) {
    const p = toScreen(this.cam, this.W, this.H, c.x, c.z, {});
    const s = camScale(this.cam, this.H);
    const ndcX = (p.x / this.W) * 2 - 1, ndcY = 1 - (p.y / this.H) * 2;
    return { x: (ndcX * 0.5 + 0.5) * W, y: (ndcY * 0.5 + 0.5) * H, r: Math.max(r * s * this.dpr * 1.1, 70 * (window.devicePixelRatio || 1)), ndcX, ndcY };
  }

  // ---------------- 프레임 ----------------
  /** 상태 갱신. 반환: 0 정지 · 1 배경 움직임(숨쉬기·스피너 — 15fps) · 2 움직임(스프링·퇴장·효과·카드 펼침 — 30fps) */
  _update(now, dt) {
    const at = this.animT;
    this._exitPass(at);
    const fading = this.pf.step(dt); // 프로젝트 페이드
    if (fading) this._applyScope();
    if (this.scope.mode === 'all' && this._ov && now - (this._packChk || 0) > 0.5) { this._packChk = now; if (packStale(this._ov, packView(this.container, { labelBelow: !!this.labelBelow, labelReserve: this.labelReserve ? this.labelReserve() : null, flat: true }))) this.layoutDirty = true; }
    if (this.layoutDirty && now - this.lastLayout > 0.15) { this.lastLayout = now; this._relayout(); }
    if (now - this.lastLabelPass > 0.25) this._labelPass(now);
    let level = 0;
    const nowMs = this.clock();
    for (const v of this.vis.values()) {
      if (v.gone) continue;
      const p = v.pos;
      const k = 38, c = 2 * Math.sqrt(k);
      const ex = v.target.x - p.x, ez = v.target.z - p.z;
      if (Math.abs(ex) > 1e-3 || Math.abs(ez) > 1e-3 || Math.abs(v.vel.x) > 1e-3 || Math.abs(v.vel.z) > 1e-3) {
        v.vel.x += (ex * k - v.vel.x * c) * dt; v.vel.z += (ez * k - v.vel.z * c) * dt;
        p.x += v.vel.x * dt; p.z += v.vel.z * dt;
        level = 2;
      } else { p.x = v.target.x; p.z = v.target.z; v.vel.x = 0; v.vel.z = 0; }
      const st = v.node.status;
      const age = now - v.bornAt;
      const appear = Math.min(1, age / 0.6);
      if (appear < 1) level = 2;
      let target = 1;
      v.stale = false;
      if ((st === 'done' || st === 'error' || st === 'stopped') && v.node.endedAt) {
        if ((nowMs - Date.parse(v.node.endedAt)) / 1000 > 600) { target = 0.6; v.stale = true; }
      }
      if (Math.abs(target - v.size) > 0.002) { v.size += (target - v.size) * Math.min(1, dt * 2); level = 2; } else v.size = target;
      let exitS = 1;
      if (v.exiting != null) {
        const kk = (at - v.exiting) / (v.exitDur || EXIT.DUR);
        if (kk >= 1) { this._endExit(v); level = 2; continue; }
        const pose = exitPose(kk, this._pose || (this._pose = {}));
        v.exitF = pose.fade; v._linkK = pose.link; exitS = pose.scale;
        if (v.labelOn) { const o = (Math.round(v.exitF * 20) / 20).toFixed(2); if (v.labelEl.style.opacity !== o) v.labelEl.style.opacity = o; }
        level = 2;
      }
      v.drawS = v.size * exitS * (0.2 + 0.8 * easeOutBack(appear)) * (v.dockK || 1);
      if (!this.reduced && level < 1 && (st === 'active' || v.errorSince != null || (v.device && v.devInfo && v.devInfo.running > 0)) && !v.hidden && (v.scopeK ?? 1) >= 0.5) level = 1;
    }
    if (this.effects.length) {
      this.effects = this.effects.filter((e) => now - e.t0 < e.dur);
      if (this.effects.length) level = 2;
    }
    const changed = this.holo.book.step(now, (id) => { const v = this.vis.get(id); return !!v && v.node.status === 'active'; });
    if (changed.size) level = Math.max(level, 2);
    if (this._holoAnimating(now)) level = 2;
    if (this.ix && this.ix.animating(now)) level = 2; // 연출 중 30fps
    const sub = this._updateExtra ? this._updateExtra(now, dt) : 0;
    const sl = this.sess ? this.sess.level(now) : 0; // 충돌 칩 왕복·메시지 패킷
    const dg = this.degradeFx && this.degradeFx.active ? this.degradeFx.level : 0; // 신호 열화(ctx-ui 가 붙임)
    return Math.max(level, sub, sl, dg, fading || this.pf.busy ? 2 : 0); // 페이드 중 30fps
  }
  /** 펼침·섬광·접힘 중인 카드가 있나(그동안 30fps) */
  _holoAnimating(now) {
    for (const arr of this.holo.book.byNode.values()) for (const e of arr) {
      if (e.slot < 0) continue;
      const ph = this.holo.book.phaseOf(e, now);
      if (ph && (ph.phase === 'open' || ph.phase === 'flash' || ph.phase === 'fold')) return true;
      if (e.swapAt != null && now - e.swapAt < HOLO.SWAP) return true;
    }
    return false;
  }

  _draw(now) {
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._drawScene(ctx, now);
    if (this.ix) this.ix.draw(ctx, now); // 노드·라벨 위
    if (this.degradeFx && this.degradeFx.active) this.degradeFx.draw(this, ctx, now); // 신호 열화(장면 위 덧그림)
    this._placeLabels();
  }
  _drawScene() {}

  /** 노드 라벨 고르기(0.25초마다, scene.js _labelPass 와 같은 우선순위·겹침 해소) */
  _labelPass(now) {
    this.lastLabelPass = now;
    const W = this.W, H = this.H;
    const maxLabels = W < 720 ? 8 : MAX_LABELS;
    const actives = [];
    for (const v of this.vis.values()) if (v.node.status === 'active' && v.id !== this.layoutRoot) actives.push(v);
    actives.sort((a, b) => (b.node.lastActivityAt || '').localeCompare(a.node.lastActivityAt || ''));
    const order = [];
    const seen = new Set();
    const keep = (x) => x && !x.gone && (!this._scopeOff(x) || (x.exiting != null && x.labelOn && !x.hidden && (x.scopeD ?? x.scopeK ?? 1) >= 0.5));
    const pins = this._labelPins();
    const push = (id, force, pin = false) => { if (id && !seen.has(id) && keep(this.vis.get(id))) { seen.add(id); order.push([this.vis.get(id), force, pin || pins.has(id)]); } };
    this._labelCandidates(push, actives, maxLabels, order, seen);
    // 라벨끼리·라벨과 다른 노드 원판이 겹치지 않게(3D scene.js 와 같은 배치 함수)
    const s = camScale(this.cam, H);
    const p = {};
    const discs = [];
    for (const v of this.vis.values()) {
      if (v.gone || v.hidden || v.exiting != null) continue;
      toScreen(this.cam, W, H, v.target.x, v.target.z, p);
      if (p.x < -200 || p.x > W + 200 || p.y < -200 || p.y > H + 200) continue;
      discs.push({ id: v.id, x: p.x, y: p.y, r: v.r * s * this._discK(v) });
    }
    const cands = [];
    const sizeC = new Map();
    const fontPx = this._labelFontPx || 12;
    for (const [v, force, pin] of order) {
      toScreen(this.cam, W, H, v.target.x, v.target.z, p);
      if (p.x < -200 || p.x > W + 200 || p.y < -200 || p.y > H + 200) continue; // 화면 밖
      const small = !force && v.r * 2 * s < this.compactPx;
      sizeC.set(v.id, small);
      const modes = labelModes(v, small, force, fontPx, (c) => this._labelBoxW(v, c), this.focusId);
      cands.push({ id: v.id, x: p.x, y: p.y, up: this.labelUp(v), gap: this._labelGap(v, s, 1), force, pin, modes });
    }
    // 피할 사각형: 도구 카드·말풍선·섬 이름표
    const rects = planLabelRects(this._obstacleRects(W, H)); // + 계획 보드(라벨이 비킴)
    const placed = placeLabels(cands, discs, { shifts: LABEL_SHIFTS, farShifts: LABEL_FAR_SHIFTS, bounds: [0, W], vbounds: [0, H], rects });
    this._labRes = smoothReserve(this._labRes, labelReserve(placed, cands, discs)); // 맞춤에 라벨 자리 포함
    const want = new Set(placed.keys());
    const candOf = new Map(cands.map((c) => [c.id, c]));
    for (const [id, r] of placed) {
      const v = this.vis.get(id);
      if ((v._dy || 0) !== r.dy || (v._dx || 0) !== r.dx) { v._dy = r.dy; v._dx = r.dx; v._tf = null; } // 밀기(노드에서 멀어지는 쪽·옆), _placeLabels 가 더함
      const compact = r.compact || sizeC.get(id);
      if (compact !== !!v.compact) { v.compact = compact; v.labelEl.classList.toggle('compact', compact); }
      if (r.mini !== !!v.mini) { v.mini = r.mini; v.labelEl.classList.toggle('mini', r.mini); }
      if (r.dim !== !!v.crowded) { v.crowded = r.dim; v.labelEl.classList.toggle('crowded', r.dim); }
      setLead(v, r, this.labelUp(v));
      const c = candOf.get(id);
      v._lrel = c ? [r.box[0] - c.x, r.box[1] - c.y, r.box[2] - c.x, r.box[3] - c.y] : null; // 말풍선이 비킬 때 쓰는 라벨 상자(노드 기준)
    }
    let changed = false;
    for (const v of this.vis.values()) {
      const on = want.has(v.id);
      if (!on) v._lrel = null;
      if (on !== v.labelOn) { v.labelOn = on; changed = true; v._tf = null; if (on) this.labelContainer.appendChild(v.labelEl); else v.labelEl.remove(); }
      if (on && !this._lro) v._labelH = v.labelEl.offsetHeight || v._labelH || 34;
    }
    if (changed) this.invalidate();
  }
  /** 라벨 후보 순서(앞일수록 우선, force = 겹쳐도 보임). 하위 표현이 바꿀 수 있다(복셀 2D: 팀장·장치 먼저) */
  _labelCandidates(push, actives, maxLabels, order, seen) {
    push(this.focusId, true); push(this.hoverId, true); push(this.layoutRoot, false);
    if (this.scope.mode === 'all') for (const c of this._clusters) for (const m of c.mains) push(m.nodeId, false);
    for (const v of this.vis.values()) if (v.device) push(v.id, false);
    for (const v of actives) if (this.holo.hasOpenCat(v.id, 'skill')) push(v.id, false, 'soft');
    const runIds = runLabelOrder(this.vis.values(), this.clock()); // 오래 도는 셸(정체 포함): 오래 돈 몇 개는 최근 활동보다 먼저, 나머지도 후보
    for (const id of runIds.slice(0, RUNW.LABEL_FIRST)) push(id, false, 'soft');
    for (const v of actives.slice(0, maxLabels)) push(v.id, false, 'soft'); // 작업 중 노드: 줄임 → 이름만 → 먼 자리(리더선), 그래도 없으면 숨김
    for (const id of runIds) push(id, false, 'soft');
    for (const v of this.vis.values()) if (v.exiting != null && v.labelOn) push(v.id, false);
    for (const v of this.vis.values()) if (!v.hidden && !v.gone && v._on && jobLabelNear(v.node, v._R || 0)) push(v.id, false); // 가까운 작업(끝났어도) 라벨 후보
    if (this.vis.size <= 12) for (const id of this.vis.keys()) push(id, false);
    else {
      const nowMs = this.clock();
      const rest = [];
      for (const v of this.vis.values()) {
        if (seen.has(v.id) || (v.kind === 'bash-bg' && !isJob(v.node)) || v.kind === 'monitor') continue; // 작업 노드는 라벨 후보
        const st = v.node.status;
        const recent = v.node.endedAt && nowMs - Date.parse(v.node.endedAt) < 600_000;
        if (st === 'idle' || st === 'error' || recent) rest.push(v);
      }
      rest.sort((x, y) => (y.node.lastActivityAt || '').localeCompare(x.node.lastActivityAt || ''));
      for (const v of rest) { if (order.length >= maxLabels) break; push(v.id, false); }
    }
  }
  /** 자리가 없으면 숨기지 않고 흐리게 남길 라벨: 루트·배치 장치·섬마다 메인 */
  _labelPins() {
    const out = new Set([this.layoutRoot]);
    for (const v of this.vis.values()) if (v.device) out.add(v.id);
    if (this.scope.mode === 'all') for (const c of this._clusters) for (const m of c.mains) out.add(m.nodeId);
    return out;
  }
  /** 노드 원판 반지름 배율(배치 반지름 × 화면 배율 기준) — 라벨이 피할 자리 */
  _discK(v) { return v.device ? 1.6 : 1.15; }
  /** 라벨이 노드 위에 붙나(Planet: labelBelow=false, 백그라운드 명령·모니터는 아래 — scene.js 와 같음) */
  labelUp(v) { return !this.labelBelow && v.kind !== 'bash-bg' && v.kind !== 'monitor'; }
  /** 노드 중심 → 라벨 가장자리 거리(px). k = 그린 크기 배율 */
  _labelGap(v, s, k) { return Math.min(90, v.r * k * s * 1.25 + 4); }
  _labelBoxW(v, compact) {
    const n = v.node;
    const nameW = Math.max(86, textWidth(String(n.label || n.id).slice(0, 24), this._labelFontPx || 12));
    const actEl = compact ? null : v.labelEl.querySelector('.act');
    const actW = actEl ? Math.min(260, textWidth(actEl.textContent, 10.5) + 18) : 0;
    const stW = v.subTitle ? Math.min(compact ? 160 : 220, textWidth(v.subTitle, 9.5) + 8) : 0;
    return Math.max(nameW, actW, stW) + 14;
  }
  /** 띄움 점선: 기동기 ↔ 띄운 노드, 테마 토큰 link-spawn, 흐름 패킷 없음. anchorOf(v) → {x, y} 가 있으면 그 자리(복셀 평면도) */
  _drawSpawnLinks(ctx, anchorOf = null) {
    const L = this.spawnLinks;
    if (!L || !L.length) return;
    const a = {}, b = {};
    ctx.save();
    ctx.strokeStyle = this.tokens['link-spawn'];
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 5]);
    for (const [lv, sv] of L) {
      if (lv.gone || sv.gone || lv.hidden || sv.hidden) continue;
      const fade = Math.min(lv.scopeK ?? 1, sv.scopeK ?? 1) * Math.min(lv.exitF ?? 1, sv.exitF ?? 1);
      if (fade < 0.05) continue;
      const A = anchorOf ? anchorOf(sv) : null, B = anchorOf ? anchorOf(lv) : null;
      if (anchorOf && (!A || !B)) continue;
      if (A) { a.x = A.x; a.y = A.y; } else toScreen(this.cam, this.W, this.H, sv.pos.x, sv.pos.z, a);
      if (B) { b.x = B.x; b.y = B.y; } else toScreen(this.cam, this.W, this.H, lv.pos.x, lv.pos.z, b);
      ctx.globalAlpha = (this.spawnAlpha ?? 0.7) * fade; // Flow 는 일반 연결선보다 옅게
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  }
  /** 라벨이 피할 화면 사각형: 도구 카드(그릴 때 기록) + 말풍선 제자리 + 섬 이름표 */
  _obstacleRects(W, H) {
    const rects = (this._cardRects || []).slice();
    if (this.sess) this.sess.rects(rects); // 충돌 파일명 칩
    if (this._cabRects) for (const r of this._cabRects) rects.push(r); // 복셀 평면도 캐비닛 말풍선
    if (this.bubbles && this.bubbles.baseRects) this.bubbles.baseRects(rects);
    if (this.scope.mode === 'all') {
      const p = {};
      for (const [pid, el] of this.islandEls) {
        const e = this._clusterV.get(pid); if (!e || !el.isConnected) continue;
        if (el._mk !== el._html || !el._mw) { el._mw = el.offsetWidth || 0; el._mh = el.offsetHeight || 0; el._mk = el._html; }
        if (!el._mw) continue;
        toScreen(this.cam, W, H, e.center.x, e.labelZ != null ? e.labelZ : e.center.z + e.r + 1.2, p);
        rects.push([p.x - el._mw / 2, p.y, p.x + el._mw / 2, p.y + el._mh]);
      }
    }
    return rects;
  }
  /** 시험·점검용: 지금 장애물 사각형(페이지 px) */
  obstacleRects() {
    const b = this.canvas.getBoundingClientRect();
    return this._obstacleRects(this.W, this.H).map((r) => [r[0] + b.left, r[1] + b.top, r[2] + b.left, r[3] + b.top]);
  }
  /** 지금 보이는 노드 라벨 상자(px, 노드 지금 자리 기준) — 말풍선이 비킨다 */
  labelScreenBoxes(out = [], anchorOf = null) {
    const p = {};
    for (const v of this.vis.values()) {
      if (!v.labelOn || !v._lrel) continue;
      toScreen(this.cam, this.W, this.H, v.pos.x, v.pos.z, p);
      const r = v._lrel;
      out.push([p.x + r[0], p.y + r[1], p.x + r[2], p.y + r[3]]);
    }
    return out;
  }
  /** 라벨·섬 이름표를 지금 카메라 자리로(바뀐 것만 style 기록) */
  _placeLabels() {
    const W = this.W, H = this.H, s = camScale(this.cam, H);
    const p = this._lp || (this._lp = {});
    for (const v of this.vis.values()) {
      if (!v.labelOn) continue;
      toScreen(this.cam, W, H, v.pos.x, v.pos.z, p);
      const gap = Math.round(this._labelGap(v, s, v.drawS || 1) + (v._dy || 0));
      const tf = this.labelUp(v)
        ? `translate(-50%, -100%) translate(${Math.round(p.x + (v._dx || 0))}px, ${Math.round(p.y - gap)}px)`
        : `translate(-50%, 0) translate(${Math.round(p.x + (v._dx || 0))}px, ${Math.round(p.y + gap)}px)`;
      if (v._tf !== tf) { v.labelEl.style.transform = tf; v._tf = tf; }
    }
    for (const [pid, el] of this.islandEls) {
      const e = this._clusterV.get(pid); if (!e) continue;
      toScreen(this.cam, W, H, e.center.x, e.labelZ != null ? e.labelZ : e.center.z + e.r + 1.2, p);
      const tf = `translate(-50%, 0) translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      if (el._tf !== tf) { el.style.transform = tf; el._tf = tf; }
    }
  }

  /** 맞춤 띠에 더할 라벨 자리(px) */
  labelReserve() { return this._labRes || null; }

  _pendingBadge(mode) {
    const el = this._badge = document.createElement('div');
    el.className = 'flat-pending';
    el.setAttribute('role', 'status');
    el.textContent = t('flat.pending', { mode });
    this.container.appendChild(el);
  }
}
