// three.js 장면: 노드·연결선·도구 아이콘·효과
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PromptFx } from './prompt-fx.js'; // 사용자 입력 빛줄기(화면 공간 오버레이)
import { computeLayout, dockedPos, RADIUS, KIND_LABEL } from './layout.js';
import { computeOverview, isRecentRoot } from './overview/layout.mjs';
import { packView, packStale, camElev } from './overview/pack-view.js';
import { Islands } from './overview/islands.js';
import { projectAreaPad } from './overview/pick-core.mjs';
import { FlowLayer } from './flow.js';
import { DEG, degOf, lineGap, lineFlicker, lineJitter, packetGone } from './degrade-core.mjs';
import { exitEligible, catColor } from './flow-core.mjs';
import { HoloLayer } from './holo.js';
import { CAT_LABEL } from './icons.js';
import { actLine, sayBrief, pushHist, panelPx } from './holo-core.mjs';
import { placeLabels, LABEL_SHIFTS, LABEL_FAR_SHIFTS, textWidth, labelReserve, smoothReserve } from './label-place.mjs';
import { planLabelRects } from './plan-core.mjs'; // 계획 보드 = 라벨의 고정 장애물
import { spawnLinks, dashSpans, spawnTag } from './spawn-link.mjs';

const SPAWN_CAP = 24, SPAWN_DASH = dashSpans(12, 0.5);
import { EXIT, exitPolicy, exitPose, retractEnd } from './exit-core.mjs';
import { ExitParticles } from './exit-fx.js';
import { nodeSubtitle } from './node-title.mjs';
import { escapeHtml } from './html-util.mjs';
import { t as _t } from './i18n.mjs';
import { isJob, jobOf, jobLabelKey } from './job-core.mjs'; // 작업 노드
import { BATCH, batchFold, isLauncher, isGuessLink, deviceInfo, deviceSummary, nodeTags, rearmStandby } from './batch-core.mjs';
import { sessionColorMap, nodeSessIdx } from './multi-core.mjs';
import { sessBadgeHtml, branchOf } from './session-core.mjs';
import { SessionFx } from './session-fx.js';
import { IxLayer } from './ix-fx.js';
import { ProjFade } from './proj-fade.mjs';

const TOKEN_NAMES = ['bg', 'fog', 'grid', 'link', 'text', 'k-main', 'k-subagent', 'k-workflow',
  'k-workflow-agent', 'k-claude-p', 'k-bash-bg', 'k-monitor', 'ok', 'error', 'skill', 'stopped', 'flow-call', 'link-spawn',
  'sess-0', 'sess-1', 'sess-2', 'sess-3', 'sess-4', 'sess-5', 'sess-6', 'sess-7', 'conflict']; // 세션 색·충돌
const STATUS_LABEL = Object.fromEntries(['active', 'idle', 'done', 'error', 'stopped'].map((s) => [s, _t('scene.status.' + s)]));
const ENDED_OK = (st) => st === 'done' || st === 'stopped'; // 끝났지만 오류는 아님(반투명·퇴장 대상)
// 완료 노드 퇴장: 끝난 뒤 잠깐 머물다(LINGER) 빛이 약해지며 작아지고 입자로 흩어져 부모 쪽으로(EXIT.DUR). '완료 표시'를 켜면 다시 보인다
const EXIT_LINGER = 2.5;
/** 그릴 모양 종류: 독립 claude -p 루트는 claude-p */
export function displayKind(node) {
  if (node && node.kind === 'main' && node.meta && node.meta.orphanSdk) return 'claude-p';
  return RADIUS[node && node.kind] ? node.kind : 'subagent';
}
// 도형 모드 노드 크기 배율: 배치 간격(RADIUS 기반)은 그대로 두고 그리는 크기만 줄여 홀로그램 패널 자리를 낸다
export const NODE_SCALE = 0.68;
const SAY_KEEP_MS = 45_000; // 말 한 줄을 노드 라벨에 남겨 두는 시간(도구가 없을 때)
const HIST_MAX = 5;
const MAX_FX = 400;
const MAX_LABELS = 30;

export function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const t = {};
  for (const n of TOKEN_NAMES) {
    const v = cs.getPropertyValue('--' + n).trim();
    t[n] = new THREE.Color(v || '#888888');
  }
  t.isLight = document.documentElement.getAttribute('data-theme') === 'light';
  return t;
}

const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ---- 라벨 모드: 보통 → 줄임(compact) → 이름만(mini). 실제 크기는 모드·내용별로 잰 값, 없으면 추정 ----
export const labelModeKey = (v) => (v.mini ? 'm' : v.compact ? 'c' : 'f');
export function labelModes(v, small, force, fontPx, boxW, focusId) {
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
/** 먼 자리로 밀린 라벨의 리더선(노드 쪽으로 기울인 가는 선, CSS ::before) */
export function setLead(v, r, up) {
  const on = r.lead > 0;
  if (on !== !!v._lead) { v._lead = on; v.labelEl.classList.toggle('lead', on); v.labelEl.classList.toggle('lead-up', on && up); }
  if (!on) return;
  const dx = r.dx || 0, dy = r.dy || 0;
  const ll = Math.max(0, Math.round(Math.hypot(dx, dy)) - 2), la = Math.round((Math.atan2(dx, up ? dy : -dy) * 180) / Math.PI);
  const key = ll + ',' + la;
  if (v._leadKey !== key) { v._leadKey = key; v.labelEl.style.setProperty('--ll', ll + 'px'); v.labelEl.style.setProperty('--la', la + 'deg'); }
}
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

let NODE_GEO = null;
function nodeGeo() {
  if (NODE_GEO) return NODE_GEO;
  NODE_GEO = {
    main: new THREE.IcosahedronGeometry(1, 0),
    subagent: new THREE.SphereGeometry(1, 22, 14),
    workflow: new THREE.TorusGeometry(1, 0.2, 14, 56),
    'workflow-agent': new THREE.OctahedronGeometry(1),
    'claude-p': new THREE.BoxGeometry(1.45, 1.45, 1.45),
    'bash-bg': new THREE.CylinderGeometry(1, 1, 0.55, 24),
    monitor: new THREE.ConeGeometry(0.85, 1.7, 18),
    glow: new THREE.SphereGeometry(1, 24, 16),
    edges: new THREE.EdgesGeometry(new THREE.BoxGeometry(1.8, 1.8, 1.8)),
    errRing: new THREE.TorusGeometry(1, 0.06, 8, 48),
    ring: new THREE.RingGeometry(0.92, 1, 48),
    orb: new THREE.SphereGeometry(0.28, 10, 8),
    beam: new THREE.CylinderGeometry(0.18, 0.18, 1, 10, 1, true),
    sat: new THREE.IcosahedronGeometry(0.32, 0),
    device: new THREE.BoxGeometry(2.1, 1.25, 1.1),   // 배치 장치(기동기) — 낮고 넓은 상자
    bandCell: new THREE.BoxGeometry(0.3, 0.22, 0.08),
  };
  NODE_GEO.ring.rotateX(-Math.PI / 2);
  NODE_GEO.beam.translate(0, 0.5, 0); // 아래 끝이 원점
  return NODE_GEO;
}

export class SceneView {
  static modeId = 'planet';     // 표현 이름 'Planet'(예전 '단순 도형')
  static modeLabel = 'Planet';

  constructor(container, labelContainer) {
    this.container = container;
    this.clock = Date.now;        // 시각 비교용 시계(재생 중엔 가상 시계)
    this.timeScale = 1;
    this.cameraPrefs = { fov: 50, elevMin: 20, elevMax: 55, distMin: 8, distMax: 160, overviewScale: 1.0, overviewDistMax: 600 };
    // 전체 보기. mode 'session' 이면 1·2차와 같은 단일 루트 배치
    this.scope = { mode: 'session', roots: [], projects: [], showInactive: false, focusProject: null };
    this._ov = null;
    this._clusters = [];
    this._clusterV = new Map();
    this.islands = null;
    this.pf = new ProjFade(); // 단일 프로젝트 선택 페이드
    this.tokens = readTokens();
    this.vis = new Map();         // id → NodeVis
    this.meshes = [];             // 클릭 판정용
    this.childrenOf = new Map();  // id → [id]
    this.parentOf = new Map();
    this.rootId = null;
    this.focusId = null;
    this.hoverId = null;
    this.effects = [];
    this.layoutDirty = false;
    this.lastLayout = 0;
    this.lastLabelPass = 0;
    this.order = 0;
    this.onFrame = null;
    this.links = [];
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._tmpC = new THREE.Color();
    this._tmpC2 = new THREE.Color();

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.prepend(r.domElement);
    r.domElement.tabIndex = 0;
    this.labelRenderer = new CSS2DRenderer({ element: labelContainer });

    const sc = this.scene = new THREE.Scene();
    sc.fog = new THREE.Fog(0x000000, 60, 400);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
    this.camera.position.set(0, 26, 48);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 1.1);
    this.dir = new THREE.DirectionalLight(0xffffff, 1.6);
    this.dir.position.set(20, 40, 25);
    this.point = new THREE.PointLight(0xffffff, 60, 80, 1.6);
    sc.add(this.hemi, this.dir, this.point);

    this.world = new THREE.Group(); sc.add(this.world);
    this.fxGroup = new THREE.Group(); sc.add(this.fxGroup);

    // 연결선 (vertex color)
    this.linkCap = 0;
    this.linkGeo = new THREE.BufferGeometry();
    this.linkMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
    this.linkLines = new THREE.LineSegments(this.linkGeo, this.linkMat);
    this.linkLines.frustumCulled = false;
    sc.add(this.linkLines);
    // 흐르는 점
    this.dotGeo = new THREE.BufferGeometry();
    this.dotMat = new THREE.PointsMaterial({ size: 0.42, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    this.dots = new THREE.Points(this.dotGeo, this.dotMat);
    this.dots.frustumCulled = false;
    sc.add(this.dots);
    this._ensureLinkCap(256);
    // 추정 연결(link.confidence medium·low, 추정 소속)은 점선 — 연결선마다 4토막, 고정 버퍼(64 연결)
    this.dashCap = 64;
    this.dashPos = new Float32Array(this.dashCap * 8 * 3);
    this.dashCol = new Float32Array(this.dashCap * 8 * 3);
    this.dashGeo = new THREE.BufferGeometry();
    this.dashGeo.setAttribute('position', new THREE.BufferAttribute(this.dashPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.dashGeo.setAttribute('color', new THREE.BufferAttribute(this.dashCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.dashLines = new THREE.LineSegments(this.dashGeo, this.linkMat);
    this.dashLines.frustumCulled = false;
    this.dashGeo.setDrawRange(0, 0);
    sc.add(this.dashLines);
    // '띄움' 점선: 부모가 끊긴 기동기 ↔ 띄운 노드. 흐름 패킷 없음, 옅게(세 표현 공통 — 흐름 표현도 이 선을 그대로 씀)
    this.spawnLinks = [];
    this.spawnPos = new Float32Array(SPAWN_CAP * SPAWN_DASH.length * 2 * 3);
    this.spawnCol = new Float32Array(SPAWN_CAP * SPAWN_DASH.length * 2 * 3);
    this.spawnGeo = new THREE.BufferGeometry();
    this.spawnGeo.setAttribute('position', new THREE.BufferAttribute(this.spawnPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.spawnGeo.setAttribute('color', new THREE.BufferAttribute(this.spawnCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.spawnMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false });
    this.spawnLines = new THREE.LineSegments(this.spawnGeo, this.spawnMat);
    this.spawnLines.frustumCulled = false;
    this.spawnLines.renderOrder = 1;
    this.spawnGeo.setDrawRange(0, 0);
    sc.add(this.spawnLines);
    // 흐름 연출: 연결선 왕복 패킷·도구 가지·잔광(인스턴싱)
    this.flow = new FlowLayer(sc, this);
    // 여러 live 세션: 같은 파일 충돌 곡선·파일명 칩·세션 간 메시지
    this.sessFx = new SessionFx(sc, this);
    this._sessColors = new Map();
    // 홀로그램 모니터: 도구 사용을 노드 주위 패널로(예전 궤도 아이콘·도구 가지를 대신)
    this.holo = new HoloLayer(sc, this);
    this.ix = new IxLayer(sc, this); // 특별 상호작용 연출(github·db·remote·batch·tests)
    this.showDone = false;
    this.compactPx = 14; // 노드 지름이 화면에서 이보다 작으면 라벨을 이름·상태만
    this._exitAt = 0;
    // 퇴장 연출 시계: 프레임마다 dt 만큼만 흐른다 — 실시간 일시정지(프레임 갱신 건너뜀) 동안 연출이 얼고, 풀면 그 자리부터 이어짐
    this.animT = performance.now() / 1000;
    this.exitFx = new ExitParticles(sc, this);
    this._settleUntil = 0;   // 퇴장이 끝난 뒤 남은 노드가 자리 잡을 때까지(자동 카메라 재맞춤 대기)
    this._exitingN = 0;

    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();

    this.applyTheme();
    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);
    this._last = performance.now() / 1000;
    r.setAnimationLoop(() => this._frame());
  }

  // ---------------- 여러 live 세션 ----------------
  /** app 이 든 충돌 장부(ConflictBook)를 이어 준다 */
  setSessions({ book } = {}) { if (this.sessFx) this.sessFx.setBook(book || null); }
  /** 세션 간 메시지(session-msg) 패킷 */
  sessionMsg(ev) { return this.sessFx ? this.sessFx.message(ev) : false; }

  // ---------------- 표현 모드 공통 인터페이스 ----------------
  setClock(fn) { this.clock = typeof fn === 'function' ? fn : Date.now; }
  setTimeScale(k) { this.timeScale = Number(k) || 1; } // 도형 모드는 속도와 무관하게 그린다(퇴장 대기만 줄임)
  say() {} // 말풍선 없음(복셀 전용)

  /** 흐름 연출 이벤트: app.onEvent 가 라이브·재생 공통으로 부른다(quiet 이벤트는 안 부름) */
  flowEvent(ev, opts = {}) {
    if (this.flow) this.flow.event(ev, opts);
    if (this.ix) this.ix.event(ev, opts);
    // 말(assistant text) 최근 한 줄 → 노드 라벨(도구가 없을 때). thinking 은 내용이 없다
    if (ev.type === 'text' && ev.role === 'assistant' && (ev.brief || ev.text)) {
      const v = this.vis.get(ev.nodeId);
      if (v) { v.sayLine = { text: ev.brief || sayBrief(ev.text), at: Date.now() }; this._labelText(v); }
    }
  }

  /** '완료 표시' 토글: false(기본)면 끝난(완료·중지됨) 노드가 흐려지며 퇴장, true 면 다시 보인다 */
  setShowDone(on) {
    this.showDone = !!on;
    this._exitPass(this.animT, true);
  }
  /** 퇴장 연출 중(입자·자리 잡기 포함)인가 — 자동 카메라는 이 동안 줄이거나 옮기지 않고 끝난 뒤 한 번만 다시 맞춘다 */
  get exitSettling() { return this._exitingN > 0 || (this.exitFx && this.exitFx.alive > 0) || this.animT < this._settleUntil; }
  /** 퇴장해 숨긴 노드 수(상태 칩용) */
  get hiddenDoneCount() { let n = 0; for (const v of this.vis.values()) if (v.gone) n++; return n; }

  /** 루프 중지·DOM 제거·GPU 자원 해제. 같은 container 에 다른 view 를 바로 만들어도 된다 */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this.promptFx) { this.promptFx.dispose(); this.promptFx = null; }
    this.renderer.setAnimationLoop(null);
    if (this._ro) this._ro.disconnect();
    if (this._lro) this._lro.disconnect();
    if (this.islands) { this.islands.dispose(); this.islands = null; }
    if (this.flow) { this.flow.dispose(); this.flow = null; }
    if (this.holo) { this.holo.dispose(); this.holo = null; }
    if (this.ix) { this.ix.dispose(); this.ix = null; }
    if (this.exitFx) { this.exitFx.dispose(); this.exitFx = null; }
    if (this.sessFx) { this.sessFx.dispose(); this.sessFx = null; }
    const geos = new Set(), mats = new Set();
    this.scene.traverse((o) => {
      if (o.isCSS2DObject && o.element) o.element.remove();
      if (o.geometry) geos.add(o.geometry);
      const m = o.material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) mats.add(x);
    });
    for (const v of this.vis.values()) {
      v.labelEl.remove();
      if (v.sat) { v.sat.label.element.remove(); mats.add(v.sat.mat); }
      mats.add(v.mat);
      for (const k of Object.keys(v.extras)) mats.add(v.extras[k].material);
    }
    if (NODE_GEO) for (const g of Object.values(NODE_GEO)) geos.add(g);
    for (const g of geos) g.dispose(); // 공유 지오메트리는 다시 쓰이면 three 가 새로 올린다
    for (const m of mats) m.dispose();
    for (const arr of Object.values(this._fxPool || {})) for (const m of arr) m.dispose(); // 효과 재질 풀
    this._fxPool = {};
    this.scene.clear();
    this.vis.clear(); this.meshes = []; this.effects = []; this.links = [];
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  // ---------------- 테마 ----------------
  applyTheme() {
    const t = this.tokens = readTokens();
    this.scene.background = t.bg.clone();
    this.scene.fog.color.copy(t.fog);
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); this.grid.material.dispose(); }
    this.grid = new THREE.GridHelper(600, 120, t.grid, t.grid);
    this.grid.position.y = -12;
    this.grid.material.transparent = true;
    this.grid.material.opacity = t.isLight ? 0.9 : 0.75;
    this.scene.add(this.grid);
    this.hemi.intensity = t.isLight ? 1.6 : 1.0;
    this.hemi.groundColor.set(t.isLight ? 0xc8cfdc : 0x1a2233);
    this.dir.intensity = t.isLight ? 1.7 : 1.5;
    this.point.intensity = t.isLight ? 20 : 60;
    this.dotMat.blending = t.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.dotMat.needsUpdate = true;
    for (const v of this.vis.values()) { if (v.sessIdx != null) v.sessC = t['sess-' + v.sessIdx]; this._styleVis(v); if (v.sat) v.sat.mat.color.copy(t.skill); v._labelHtml = null; this._labelText(v); }
    if (this.islands) this.islands.applyTheme(t);
    if (this.flow) this.flow.applyTheme(t);
    if (this.holo) this.holo.applyTheme(t);
    if (this.exitFx) this.exitFx.applyTheme(t);
    if (this.ix) this.ix.applyTheme(t);
  }

  kindColor(kind) { return this.tokens['k-' + kind] || this.tokens['k-subagent']; }

  // ---------------- 노드 ----------------
  reset() {
    for (const v of [...this.vis.values()]) this._disposeVis(v);
    this.vis.clear(); this.meshes = []; this.childrenOf.clear(); this.parentOf.clear();
    for (const e of this.effects) this._disposeFx(e);
    this.effects = [];
    this.links = [];
    if (this.flow) this.flow.clear();
    if (this.holo) this.holo.clear();
    if (this.exitFx) this.exitFx.clear();
    if (this.ix) this.ix.clear();
    this._exitingN = 0; this._settleUntil = 0;
    this.focusId = null; this.hoverId = null;
    this.order = 0;
    this.layoutDirty = true;
  }

  setRoot(id) { this.rootId = id; this.layoutDirty = true; }

  addNode(node, spawn = true) {
    const old = this.vis.get(node.id);
    if (old && old.removing) this._dropNode(node.id); // 물러나던 노드가 다시 들어옴: 연출을 끝내고 새로
    else if (old) { this.updateNode(node.id, node); return; }
    // 어떤 메인에도 매칭되지 않은 독립 claude -p 루트(kind main + meta.orphanSdk)는 claude -p 모양·색으로 그린다
    const kind = displayKind(node);
    const r = RADIUS[kind] * NODE_SCALE * (isLauncher(node) ? 2 : 1); // 배치 장치는 백그라운드 명령보다 크게
    const G = nodeGeo();
    node._order = this.order++;
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.42, metalness: 0.08, flatShading: kind !== 'subagent', transparent: true,
    });
    const device = isLauncher(node);
    const mesh = new THREE.Mesh(device ? G.device : G[kind], mat);
    mesh.scale.setScalar(r);
    if (kind === 'workflow') mesh.rotation.x = Math.PI / 2.3;
    mesh.userData.nodeId = node.id;
    group.add(mesh);
    const v = {
      id: node.id, node, kind, r, group, mesh, mat, extras: {},
      vel: new THREE.Vector3(), target: new THREE.Vector3(), fresh: true, spawn,
      // icons: 열린 도구(toolUseId → {cat, skill, act}) — 그림은 HoloLayer, 여기선 라벨용 장부. hist: 최근 작업(포커스 라벨)
      icons: new Map(), hist: [], sayLine: null, seed: Math.random() * 10,
      errorSince: node.status === 'error' ? performance.now() / 1000 - 10 : null, labelOn: false, sat: null,
      bornAt: performance.now() / 1000, size: 1,
      // 퇴장: endWall = 끝난 시각(performance 초). 처음부터 끝나 있던 노드(스냅샷)는 아주 옛날로 → 곧바로 숨김
      endWall: ENDED_OK(node.status) ? -1e9 : null, exiting: null, gone: false, exitF: 1, ovHidden: false,
    };
    if (kind === 'main') {
      const gm = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.14, side: THREE.BackSide, depthWrite: false });
      const glow = new THREE.Mesh(G.glow, gm); glow.scale.setScalar(r * 1.5); group.add(glow);
      v.extras.glow = glow;
    }
    if (kind === 'claude-p') {
      const em = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 });
      const edges = new THREE.LineSegments(G.edges, em); edges.scale.setScalar(r); group.add(edges);
      v.extras.edges = edges;
    }
    if (device) this._makeDevice(v);
    // 재무장 Monitor: 앞 것의 자리·모습을 그대로 이어받아 새로 생기는 연출 없이
    const rof = node.meta && node.meta.rearmOf;
    if (rof && this.vis.has(rof)) v.inheritFrom = rof;
    const erm = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 });
    const err = new THREE.Mesh(G.errRing, erm); err.scale.setScalar(r * 1.38); err.rotation.x = Math.PI / 2; err.visible = false;
    group.add(err); v.extras.err = err;


    const el = document.createElement('div');
    el.className = 'node-label';
    v.labelEl = el;
    // 라벨 높이는 ResizeObserver 로 받아 둔다(홀로그램 패널이 라벨을 피하는 데 씀) — 라벨 패스에서 offsetHeight 를 읽으면 강제 레이아웃
    const ro = this._labelRO();
    if (ro) { el._vis = v; ro.observe(el); }
    v.label = new CSS2DObject(el);
    if (kind === 'bash-bg' || kind === 'monitor') { v.label.center.set(0.5, 0); v.label.position.set(0, -r * 1.2 - 0.4, 0); }
    else { v.label.center.set(0.5, 1); v.label.position.set(0, r * 1.2 + 0.5, 0); }

    this.world.add(group);
    this.meshes.push(mesh);
    this.vis.set(node.id, v);
    this._styleVis(v);
    this._labelText(v);
    for (const t of node.openTools || []) this.toolStart(node.id, { ...t, toolUseId: t.toolUseId, ts: t.startedAt }, true);
    this._syncSkill(v);
    this._touchDevice(node.parentId);
    this.layoutDirty = true;
  }

  /** 회차가 생기거나 상태가 바뀌면 부모 장치의 띠·집계 줄을 다시 */
  _touchDevice(pid) {
    const p = pid && this.vis.get(pid);
    if (!p || !p.device) return;
    this._syncDevice(p); this._labelText(p);
    this.layoutDirty = true; // 접기 계획이 바뀜
  }

  /** opts.quiet: 스크럽·밀린 이벤트 — 끝난 노드는 연출 없이 바로 숨김 */
  updateNode(id, patch = {}, opts = {}) {
    const v = this.vis.get(id);
    if (!v || v.removing) return;
    if ('parentId' in patch || (patch.meta && 'phase' in patch.meta)) this.layoutDirty = true;
    if (patch.status === 'error' && v.errorSince == null) v.errorSince = performance.now() / 1000;
    if (patch.status && patch.status !== 'error') v.errorSince = null;
    if ('status' in patch) {
      // 끝난 노드의 남은 아이콘은 정리
      if (patch.status === 'done' || patch.status === 'error' || patch.status === 'stopped') {
        const res = patch.status === 'error' ? 'error' : patch.status === 'stopped' ? 'stopped' : 'ok';
        if (this.holo) this.holo.endAll(id, res);
        v.icons.clear();
      }
      if (ENDED_OK(patch.status)) { if (v.endWall == null) v.endWall = opts.quiet ? -1e9 : this.animT; }
      else { v.endWall = null; if (v.exiting != null || v.gone) this._unexit(v); }
      this._exitAt = 0; // 다음 프레임에 퇴장 판정
    }
    this._styleVis(v);
    this._labelText(v);
    this._syncSkill(v);
    // 상태가 바뀌면 조상(메인·claude -p) 라벨도 다시: '대기'인데 하위가 일하는 중이면 '대기 · 하위 작업 중'
    if ('status' in patch || 'parentId' in patch) this._refreshAncestorLabels(v.node.parentId);
    if ('status' in patch) { this._touchDevice(v.node.parentId); if (v.kind === 'monitor') this.layoutDirty = true; }
    if (patch.meta && 'batch' in patch.meta) this.layoutDirty = true;
  }

  _refreshAncestorLabels(pid) {
    for (let i = 0; pid && i < 32; i++) { const p = this.vis.get(pid); if (!p) break; this._labelText(p); pid = p.node.parentId; }
  }

  /** 하위(자식의 자식까지)에 작업 중 노드가 있는가 */
  _activeBelow(id) {
    const kids = new Map();
    for (const x of this.vis.values()) { const pp = x.node.parentId; if (pp) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(x); } }
    const stack = [...(kids.get(id) || [])];
    for (let i = 0; stack.length && i < 5000; i++) { const x = stack.pop(); if (x.node.status === 'active') return true; stack.push(...(kids.get(x.id) || [])); }
    return false;
  }

  /**
   * 노드 제거(node-remove). opts.animate(기본 true)이고 보이는 노드면 툭 사라지지 않고 퇴장 연출 뒤에 지운다
   * 그동안 홀로그램 패널은 노드 쪽으로 접혀 들어가고, 클릭·카메라 대상에서는 바로 빠진다. 배속이 높거나 조용한 이벤트면 바로 지움
   */
  removeNode(id, opts = {}) {
    const v = this.vis.get(id); if (!v) return;
    if (v.removing) { if (opts.animate === false) this._dropNode(id); return; }
    const pol = opts.animate === false ? null : exitPolicy(this.timeScale, !!opts.quiet);
    if (!pol || v.hidden || v.gone || (v.scopeK ?? 1) < 0.5 || !v.group.visible) { this._dropNode(id); return; }
    v.removing = true;
    if (this.holo) this.holo.foldNode(id);
    if (v.exiting == null) this._startExit(v, pol);
    v.icons.clear();
  }

  _dropNode(id) {
    const v = this.vis.get(id); if (!v) return;
    if (v.exiting != null) this._exitingN = Math.max(0, this._exitingN - 1);
    this._disposeVis(v); this.vis.delete(id); if (this.holo) this.holo.removeNode(id); this.meshes = this.meshes.filter((m) => m !== v.mesh); this.layoutDirty = true;
    this._settleUntil = Math.max(this._settleUntil, this.animT + EXIT.SETTLE);
  }

  /** 퇴장 연출 시작: 연출 시계 기준, 정책(시간·입자) 고정 */
  _startExit(v, pol) {
    v.exiting = this.animT; v.exitDur = pol.dur; v.exitParticles = !!pol.particles; v._burst = false;
    this._exitingN++;
  }
  /** 퇴장 연출 끝: 숨기고 자리를 내준다(물러나던 노드는 지움) */
  _endExit(v) {
    if (v.removing) { this._dropNode(v.id); return; }
    v.exiting = null; this._exitingN = Math.max(0, this._exitingN - 1);
    v.gone = true; v.exitF = 0; v._linkK = 0; this._syncHidden(v); this.layoutDirty = true;
    if (v.labelEl.style.opacity) v.labelEl.style.opacity = '';
    this._settleUntil = Math.max(this._settleUntil, this.animT + EXIT.SETTLE);
  }

  _disposeVis(v) {
    this.world.remove(v.group);
    v.mat.dispose();
    for (const k of Object.keys(v.extras)) v.extras[k].material.dispose();
    if (v.sat) { v.sat.mat.dispose(); v.sat.label.element.remove(); }
    v.label.removeFromParent(); v.labelEl.remove();
    if (this._lro) { this._lro.unobserve(v.labelEl); v.labelEl._vis = null; }
  }

  /** 라벨 높이 관찰자(브라우저에 없으면 null → 라벨 패스에서 offsetHeight 로 물러남) */
  _labelRO() {
    if (this._lro !== undefined) return this._lro;
    this._lro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((ents) => {
      for (const en of ents) {
        const v = en.target._vis; if (!v) continue;
        const bs = en.borderBoxSize && en.borderBoxSize[0];
        const h = bs ? bs.blockSize : en.target.offsetHeight;
        if (h > 0) v._labelH = h; // 떼어 낸(보이지 않는) 라벨은 0 — 마지막 값 유지
        const w = bs ? bs.inlineSize : en.target.offsetWidth;
        if (w > 0) v._labelW = w; // 라벨 배치는 실제 폭을 쓴다
        if (w > 0 && h > 0) (v._lsz || (v._lsz = {}))[labelModeKey(v)] = [w, h, v._labelHtml]; // 모드별 실제 크기
      }
    });
    return this._lro;
  }

  _styleVis(v) {
    const t = this.tokens; const st = v.node.status;
    const base = this.kindColor(v.kind);
    const c = this._tmpC.copy(base);
    if (st === 'done') {
      const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
      c.lerp(new THREE.Color(l, l, l), 0.55);
      c.lerp(t.bg, 0.15);
    } else if (st === 'stopped') {
      // 중지됨: 종류 색을 거의 지운 회색(오류 빨강과 구분, 완료보다 조금 진하게)
      c.lerp(t.stopped, 0.8);
    }
    // 세션 색: 같은 프로젝트 live 메인이 여럿이면 메인 도형을 그 세션 색으로
    if (v.sessC && v.kind === 'main' && !v.node.parentId && !ENDED_OK(st)) c.lerp(v.sessC, 0.8);
    v.mat.color.copy(c);
    v.mat.emissive.copy(c);
    const sk = v.scopeK ?? 1; // 전체 보기 희미 처리(다른 프로젝트 0.15, recent 루트 0.35). 단일 세션은 1
    const endOp = st === 'done' ? (t.isLight ? 0.5 : 0.35) : st === 'stopped' ? (t.isLight ? 0.6 : 0.5) : 1; // 밝은 배경에선 0.35 가 거의 안 보임
    v.baseOpacity = endOp * sk;
    v.mat.opacity = v.baseOpacity * (v.exitF ?? 1);
    v.mat.depthWrite = !ENDED_OK(st) && sk >= 1;
    v.nearFaded = false;
    v.baseEmissive = st === 'active' ? 0.55 : st === 'idle' ? 0.16 : st === 'done' ? 0.04 : st === 'stopped' ? 0.06 : 0.3;
    if (t.isLight) v.baseEmissive *= 0.45;
    if (sk < 1) v.baseEmissive *= sk;
    if (v.extras.glow) {
      v.extras.glow.material.color.copy(v.sessC && v.kind === 'main' ? v.sessC : base);
      const blend = t.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
      // 혼합 방식이 실제로 바뀔 때만 다시 컴파일 요청(예전: 상태 갱신마다 needsUpdate → 300 노드에서 프레임마다 프로그램 매개변수 재계산)
      if (v.extras.glow.material.blending !== blend) { v.extras.glow.material.blending = blend; v.extras.glow.material.needsUpdate = true; }
      v.extras.glow.material.opacity = t.isLight ? 0.08 : 0.14;
    }
    if (v.extras.edges) { v.extras.edges.material.color.copy(st === 'stopped' ? c : base); v.extras.edges.material.opacity = ENDED_OK(st) ? 0.14 : 0.9; }
    v.extras.err.material.color.copy(t.error);
    v.extras.err.visible = st === 'error';
    if (v.device) this._syncDevice(v);
  }

  // ---------------- 배치 장치(기동기) ----------------
  /** Planet: 낮고 넓은 상자 앞면에 최근 회차 상태 띠(5칸) + 진행 표시등. 메시의 자식이라 크기·퇴장을 같이 따른다 */
  _makeDevice(v) {
    const G = nodeGeo();
    v.device = true;
    for (let i = 0; i < BATCH.BAND_N; i++) {
      const m = new THREE.Mesh(G.bandCell, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 }));
      m.position.set(-0.76 + i * 0.38, -0.22, 0.56);
      v.mesh.add(m); v.extras['band' + i] = m;
    }
    const led = new THREE.Mesh(G.orb, new THREE.MeshBasicMaterial({ transparent: true, opacity: 1 }));
    led.scale.setScalar(0.55); led.position.set(0.82, 0.3, 0.56);
    v.mesh.add(led); v.extras.led = led;
    const slit = new THREE.Mesh(G.bandCell, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 }));
    slit.scale.set(4.2, 0.55, 1); slit.position.set(-0.18, 0.3, 0.56);
    v.mesh.add(slit); v.extras.slit = slit;
  }
  /** 상태 띠 색: 진행 = 도구색(호박), 완료 = ok, 중지 = 회색, 오류 = 빨강, 빈 칸 = 배경에 가까운 회색 */
  _syncDevice(v) {
    if (!v.device) return;
    const t = this.tokens;
    const info = v.devInfo = deviceInfo(v.node, this._nodeMap());
    v._bandCode = null;
    const band = info.band;
    const off = BATCH.BAND_N - band.length;
    for (let i = 0; i < BATCH.BAND_N; i++) {
      const m = v.extras['band' + i]; if (!m) continue;
      const b = i < off ? 0 : band[i - off];
      const c = b === 1 ? t.skill : b === 2 ? t.ok : b === 3 ? t.stopped : b === 4 ? t.error : null;
      if (c) m.material.color.copy(c); else m.material.color.copy(t.bg).lerp(t.text, 0.25);
      m.material.opacity = b ? 0.95 : 0.5;
    }
    v.extras.slit.material.color.copy(t.bg).lerp(t.text, t.isLight ? 0.18 : 0.08);
  }
  _nodeMap() {
    const m = this._nmap || (this._nmap = new Map());
    m.clear();
    for (const [id, x] of this.vis) m.set(id, x.node);
    return m;
  }

  _labelText(v) {
    const n = v.node;
    const name = trunc(n.label || n.id, 24);
    // 메인이 워크플로·에이전트를 기다리는 동안은 turn 이 끝나 '대기'로 오지만 하위는 일하는 중 → 그렇다고 알려 준다
    const waiting = n.status === 'idle' && (v.kind === 'main' || v.kind === 'claude-p') && this._activeBelow(v.id);
    const job = isJob(n); // 작업 노드
    const kindName = v.device ? _t('scene.kind.device') : v.dockK ? _t('scene.kind.dock') : job ? _t('cards.job.kind') : (KIND_LABEL[v.kind] || v.kind);
    // 작업: 상태는 꼬리표(진행·대기·정체·rc)가 말하므로 둘째 줄은 종류만
    const sub = job ? kindName : `${kindName} · ${waiting ? _t('scene.waitingSub') : v.standby ? _t('scene.standby') : (STATUS_LABEL[n.status] || n.status || '')}`;
    const tools = v.icons.size > 1 ? ' · ' + _t('scene.tools', { n: v.icons.size }) : '';
    // 세션·claude -p 노드는 라벨이 역할 표기("메인 · 프로젝트")라 자동 제목(meta.title)을 이름 아래 흐린 한 줄로
    const st = nodeSubtitle(n);
    v.subTitle = st;
    const stHtml = st ? `<span class="ntitle" title="${escapeHtml(st)}">${escapeHtml(st)}</span>` : '';
    // 꼬리표: 이어받음·회차 #k·연결 추정·재무장 ×N·추정 소속/외부 작업, 장치는 회차 집계 한 줄
    const tags = nodeTags(n, this._nodeMap(), this.clock());
    if (job) v._jobKey = jobLabelKey(jobOf(n), this.clock()); // 시계로만 바뀌는 정체 표시를 _exitPass 가 다시 그림
    const spt = spawnTag(n); if (spt) tags.push(spt); // 띄움 꼬리표
    const tgHtml = tags.length ? `<span class="ntags">${tags.map((x) => `<i>${escapeHtml(x)}</i>`).join('')}</span>` : '';
    const devHtml = v.device && v.devInfo ? `<span class="ndev">${escapeHtml(deviceSummary(v.devInfo))}</span>` : '';
    v._extraH = (tgHtml ? 13 : 0) + (devHtml ? 13 : 0);
    const sb = v.sessIdx != null && v.kind === 'main' && !n.parentId ? sessBadgeHtml(v.sessIdx, n.meta && n.meta.ctx, branchOf(n)) : ''; // 세션 색·브랜치·컨텍스트
    let html = `${escapeHtml(name)}${sb}${stHtml}<small>${escapeHtml(sub + tools)}</small>${tgHtml}${devHtml}${this._actHtml(v)}${this._catsHtml(v)}`;
    if (this.focusId === v.id && v.hist.length) html += this._histHtml(v);
    if (v._labelHtml !== html) { v.labelEl.innerHTML = html; v._labelHtml = html; }
    v.labelEl.classList.toggle('focus', this.focusId === v.id);
  }

  _syncSkill(v) {
    const sk = v.node.meta && v.node.meta.skill;
    if (sk && !v.sat) {
      const mat = new THREE.MeshStandardMaterial({ color: this.tokens.skill, emissive: this.tokens.skill, emissiveIntensity: 0.8, flatShading: true, roughness: 0.3 });
      const obj = new THREE.Mesh(nodeGeo().sat, mat);
      const el = document.createElement('div'); el.className = 'icon-label';
      const label = new CSS2DObject(el); label.center.set(0.5, 1); label.position.set(0, 0.45, 0);
      obj.add(label);
      v.group.add(obj);
      v.sat = { obj, mat, label, name: null };
    }
    if (!sk && v.sat) {
      v.group.remove(v.sat.obj); v.sat.mat.dispose(); v.sat.label.element.remove(); v.sat = null;
    }
    if (v.sat && v.sat.name !== sk) { v.sat.name = sk; v.sat.label.element.textContent = _t('scene.skill', { name: trunc(sk, 22) }); }
  }

  // ---------------- 지금 하는 일 · 이력 ----------------
  _catCss(cat) { return cat === 'skill' ? 'var(--skill)' : catColor(cat, this.tokens.isLight); }
  /** 최근 1분 동안 쓴 도구 종류 꼬리표(2종 이상일 때): 셸만 쓰는 것처럼 보이지 않게 */
  _catsHtml(v) {
    const rc = v.recentCats;
    if (!rc || rc.size < 2) return '';
    const now = Date.now();
    const list = [...rc.entries()].filter(([, t]) => now - t < 60_000).sort((a, b) => b[1] - a[1]).slice(0, 6);
    for (const [c, t] of rc) if (now - t >= 60_000) rc.delete(c);
    if (list.length < 2) return '';
    return `<span class="cats">${list.map(([c]) => `<i style="--hc:${this._catCss(c)}">${escapeHtml(CAT_LABEL[c] || c)}</i>`).join('')}</span>`;
  }
  /** 노드 라벨 셋째 줄: 열린 도구 중 가장 최근 것(`Bash · npm test`), 없으면 최근 말 한 줄 */
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
  /** 포커스 노드: 최근 작업 3～5개(결과 포함) */
  _histHtml(v) {
    const li = v.hist.map((h) => {
      const [tool, ...rest] = h.label.split(' · ');
      const mark = h.res == null ? '…' : h.res === 'error' ? '✕' : h.res === 'stopped' ? '■' : '✓';
      return `<li class="${h.res === 'error' ? 'err' : ''}" style="--hc:${this._catCss(h.cat)}">${mark} <i>${escapeHtml(tool)}</i>${rest.length ? ' · ' + escapeHtml(rest.join(' · ')) : ''}${h.result ? ` <em>→ ${escapeHtml(h.result)}</em>` : ''}</li>`;
    }).join('');
    return `<ol class="hist">${li}</ol>`;
  }
  _holoChanged(id) { const v = this.vis.get(id); if (v) this._labelText(v); }

  // ---------------- 도구 → 홀로그램 패널 ----------------
  toolStart(nodeId, ev, quiet = false) {
    const v = this.vis.get(nodeId); if (!v || v.removing) return;
    const id = ev.toolUseId || ('anon' + Math.random());
    if (v.icons.has(id)) return;
    const cat = ev.skill ? 'skill' : ev.cat || 'other';
    const act = actLine(ev);
    v.icons.set(id, { cat, skill: ev.skill || null, act });
    (v.recentCats || (v.recentCats = new Map())).set(cat, Date.now()); // 최근 1분 도구 종류(라벨 아래 꼬리표)
    if (this.holo) this.holo.start(nodeId, { ...ev, toolUseId: id }, { quiet, speed: this.timeScale });
    pushHist(v.hist, { id, label: act, cat, res: null, result: '' }, HIST_MAX);
    this._labelText(v);
  }

  toolEnd(nodeId, ev) {
    const v = this.vis.get(nodeId); if (!v) return;
    const id = ev.toolUseId;
    const res = ev.ok === false ? 'error' : 'ok';
    const result = ev.brief || '';
    const known = id && this.holo ? this.holo.end(nodeId, id, res, result || ev.text || '') : false;
    if (id && v.icons.has(id)) v.icons.delete(id);
    else if (!known) this.wave(nodeId, ev.ok === false ? this.tokens.error : this.tokens.ok, 0.7); // 시작을 못 본 도구: 노드에 작은 섬광만
    if (id && v.hist.some((h) => h.id === id)) pushHist(v.hist, { id, res, result: result || (ev.ok === false ? String(ev.text || '').slice(0, 40) : '') }, HIST_MAX);
    this._labelText(v);
  }

  // ---------------- 효과 ----------------
  _fx(obj, dur, update) {
    if (this.effects.length >= MAX_FX) { obj.material && obj.material.dispose(); return; }
    this.fxGroup.add(obj);
    this.effects.push({ obj, t0: performance.now() / 1000, dur, update });
  }
  _disposeFx(e) {
    this.fxGroup.remove(e.obj);
    const m = e.obj.material;
    if (m && m.userData.poolKey) { (this._fxPool[m.userData.poolKey] ||= []).length < 64 ? this._fxPool[m.userData.poolKey].push(m) : m.dispose(); }
    else if (m) m.dispose();
  }

  /**
   * 효과용 재질을 꺼내 쓴다(같은 설정끼리 재사용). 효과마다 새 재질을 만들면 three 가 첫 렌더 때마다 프로그램 매개변수를
   * 다시 계산해, 이벤트가 몰리는 300 노드 장면에서 프레임 시간의 큰 몫이었다. 색·불투명도만 바꿔 다시 쓴다
   */
  _fxMat(color, opacity, { side = THREE.FrontSide, additive = false } = {}) {
    this._fxPool = this._fxPool || {};
    const key = `${side}|${additive ? 'add' : 'norm'}`;
    const pool = this._fxPool[key] || (this._fxPool[key] = []);
    const m = pool.pop() || new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    m.userData.poolKey = key;
    m.color.set(color);
    m.opacity = opacity;
    return m;
  }

  ripple(id, color) {
    const v = this.vis.get(id); if (!v) return;
    const mat = this._fxMat(color || this.kindColor(v.kind), 0.7, { side: THREE.DoubleSide });
    const m = new THREE.Mesh(nodeGeo().ring, mat);
    this._fx(m, 0.9, (k) => {
      m.position.copy(v.group.position);
      m.scale.setScalar(v.r * (1.15 + k * 1.3));
      mat.opacity = 0.7 * (1 - k);
    });
  }

  wave(id, color, scale = 1, at = null) {
    const v = this.vis.get(id); if (!v) return;
    const mat = this._fxMat(color || this.kindColor(v.kind), 0.8, { side: THREE.DoubleSide });
    const m = new THREE.Mesh(nodeGeo().ring, mat);
    const p0 = at ? at.clone() : null;
    this._fx(m, 0.75, (k) => {
      m.position.copy(p0 || v.group.position);
      m.scale.setScalar((p0 ? 0.3 : v.r) * scale * (1 + k * 2.4));
      mat.opacity = 0.8 * (1 - k) * (1 - k);
    });
  }

  /** 사용자 입력: 화면 테두리에 모인 에너지가 메인으로 휘어 날아가 흡수 → 고리·점등. o.delay = 카메라가 옮겨 가는 동안 기다림.
   *  반환 {start, launch, arrive}(초, 효과음 박자) | null */
  beam(id, o = {}) {
    const v = this.vis.get(id); if (!v) return null;
    const L = !!this.tokens.isLight;
    if (!this.promptFx) this.promptFx = new PromptFx(this.container);
    const col = new THREE.Color(this.kindColor('main'));
    const pv = new THREE.Vector3();
    return this.promptFx.launch({
      targetFn: () => {
        const w = this.vis.get(id); if (!w || w.gone) return null;
        pv.copy(w.group.position).project(this.camera);
        const W = this.container.clientWidth || 1, H = this.container.clientHeight || 1;
        return { x: (pv.x * 0.5 + 0.5) * W, y: (-pv.y * 0.5 + 0.5) * H, behind: pv.z > 1 };
      },
      color: '#' + col.getHexString(), light: L, delay: o.delay || 0,
      reduced: !!this.reduced || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches),
      onArrive: () => { if (!this.vis.get(id)) return; this.ripple(id, L ? col : new THREE.Color(1, 1, 1)); this.wave(id, col, 0.7); },
    });
  }

  /** from(노드 id 또는 Vector3) → to(노드 id 또는 Vector3) 로 빛 구 */
  orb(from, to, color, dur = 0.8) {
    const fromV = typeof from === 'string' ? this.vis.get(from) : null;
    const toV = typeof to === 'string' ? this.vis.get(to) : null;
    if ((typeof from === 'string' && !fromV) || (typeof to === 'string' && !toV)) return;
    const p0 = fromV ? null : from.clone();
    const p1 = toV ? null : to.clone();
    const mat = this._fxMat(color || (fromV ? this.kindColor(fromV.kind) : this.tokens.text), 0.95, { additive: !this.tokens.isLight });
    const m = new THREE.Mesh(nodeGeo().orb, mat);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    this._fx(m, dur, (k) => {
      a.copy(p0 || fromV.group.position); b.copy(p1 || toV.group.position);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      m.position.lerpVectors(a, b, e);
      m.position.y += Math.sin(k * Math.PI) * 1.2;
      m.scale.setScalar(1 - k * 0.4);
      mat.opacity = k > 0.85 ? (1 - k) / 0.15 : 0.95;
    });
  }

  // ---------------- 배치 ----------------
  layoutNow() { this._exitPass(this.animT, true, false); this._relayout(); }

  // ---------------- 완료 노드 퇴장 ----------------
  _syncHidden(v) {
    const h = !!(v.ovHidden || v.gone || v.foldHidden || v.projGone);
    if (h !== !!v.hidden) { v.hidden = h; v.group.visible = !h; }
  }

  _unexit(v) {
    if (v.removing) return;
    if (v.exiting != null) this._exitingN = Math.max(0, this._exitingN - 1);
    v.exiting = null; v.exitF = 1; v._linkK = 0;
    if (v.labelEl.style.opacity) v.labelEl.style.opacity = '';
    if (v.gone) { v.gone = false; v.bornAt = performance.now() / 1000; this._syncHidden(v); this.layoutDirty = true; }
    v.mat.opacity = v.baseOpacity;
  }

  /**
   * 퇴장 판정: 끝난(완료·중지됨) 노드 중 하위도 전부 끝난 것을 LINGER 뒤 흐리게 퇴장. 오류·루트·메인은 남긴다.
   * force: 토글 직후(바로 반영), animate=false: 지금 막 받은 스냅샷처럼 애니메이션 없이 숨김
   */
  _exitPass(now, force = false, animate = true) {
    if (!force && now - this._exitAt < 0.25) return;
    this._exitAt = now;
    if (this.showDone) {
      const cm = this.clock();
      for (const v of this.vis.values()) {
        if (v.exiting != null || v.gone) this._unexit(v);
        if (v._jobKey != null && jobLabelKey(jobOf(v.node), cm) !== v._jobKey) this._labelText(v); // 정체 표시(시계)
      }
      return;
    }
    const nodes = new Map();
    for (const [id, v] of this.vis) if (!v.removing) nodes.set(id, v.node);
    const roots = [this.rootId, this.layoutRoot];
    for (const r of this.scope.roots || []) roots.push(r.nodeId);
    const elig = exitEligible(nodes, roots);
    const linger = EXIT_LINGER / Math.min(4, Math.max(1, Math.sqrt(this.timeScale || 1)));
    const pol = animate ? exitPolicy(this.timeScale) : null;
    const clockMs = this.clock();
    for (const [id, v] of this.vis) {
      if (v.removing) continue;
      // 만료된 Monitor 는 재무장을 기다리는 동안 대기 표시로 남김 — 30분마다 사라졌다 생기는 깜빡임 방지
      const ago = v.node.endedAt ? (clockMs - Date.parse(v.node.endedAt)) / 1000 : -1;
      const standby = v.kind === 'monitor' && !v.foldHidden && rearmStandby(v.node, nodes.get(v.node.parentId), ago);
      if (standby !== !!v.standby) { v.standby = standby; this._labelText(v); }
      if (v._jobKey != null && jobLabelKey(jobOf(v.node), clockMs) !== v._jobKey) this._labelText(v); // 정체 표시(시계)
      let want = elig.has(id) && v.endWall != null && now - v.endWall >= linger && !standby;
      if (v.foldHidden && elig.has(id) && v.endWall != null) want = true; // 장치 안으로 접힌 노드는 연출 없이
      if (want && v.foldHidden && !v.gone) { if (v.exiting != null) this._exitingN = Math.max(0, this._exitingN - 1); v.exiting = null; v.gone = true; v.exitF = 0; this._syncHidden(v); continue; }
      if (want) {
        if (v.gone || v.exiting != null) continue;
        if (!pol || now - v.endWall > linger + EXIT.DUR + 1) { v.gone = true; v.exitF = 0; this._syncHidden(v); this.layoutDirty = true; }
        else this._startExit(v, pol);
      } else if (v.exiting != null || v.gone) this._unexit(v);
    }
  }

  _relayout() {
    const nodes = new Map();
    for (const [id, v] of this.vis) if (!v.gone) nodes.set(id, v.node); // 퇴장한 노드는 자리를 내준다
    // 배치 장치 접기: 끝난 회차는 장치 안(최근 2개만 장치에 작게), 재무장 Monitor 는 마지막 하나가 앞 것의 자리를 잇는다
    // 접기 판정은 퇴장한 노드까지 포함해서(퇴장한 앞 Monitor 가 빠지면 뒤 것과의 사슬이 끊겨 숨김·대기가 번갈아 깜빡인다)
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
      const ov = this._ov = computeOverview(nodes, this.scope.roots, this.scope.projects, this._ov, { showInactive: this.scope.showInactive, nowMs: Date.now(), spread: this.overviewSpread || 1, facing: !!this.overviewFacing, round: this.constructor.modeId === 'planet', aspect: this._packAspect(), view: this._packView() }); // 섬 배치는 가용 영역 비율·고도
      pos = ov.pos; parentOf = ov.parentOf;
      const c0 = ov.clusters.find((c) => c.active && c.mains.length) || ov.clusters.find((c) => c.mains.length);
      root = c0 ? c0.currentMain || c0.mains[0].nodeId : (ov.roots[0] ? ov.roots[0].nodeId : null);
      this._setClusters(ov.clusters);
    } else ({ pos, parentOf, root } = computeLayout(nodes, this.rootId));
    const hid = all && this._ov ? this._ov.hidden : null;
    // 장치에 붙은 끝난 회차: 장치 옆(사슬에 수직)에 작게 나란히(최근이 장치 가까이)
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
    this._ensureLinkCap(this.links.length);
    // 띄움 점선: 배치에 든(보이는) 노드끼리만
    const lay = (id) => nodes.has(id) && pos.has(id) && !(hid && hid.has(id));
    this.spawnLinks = spawnLinks(nodes, lay, every).map(([a, b]) => [this.vis.get(a), this.vis.get(b)]).filter(([a, b]) => a && b);
    for (const [id, v] of this.vis) {
      const p = pos.get(id); if (!p) continue;
      v.target.set(p.x, p.y, p.z);
      if (v.fresh) {
        v.fresh = false;
        const pv = this.vis.get(parentOf.get(id));
        const iv = v.inheritFrom && this.vis.get(v.inheritFrom);
        if (iv) { v.group.position.copy(iv.group.position); v.bornAt -= 1; } // 재무장: 앞 Monitor 자리에서 그대로 이어짐
        else if (v.spawn && pv && !pv.fresh) v.group.position.copy(pv.group.position);
        else v.group.position.copy(v.target);
      }
    }
    this.layoutDirty = false;
    this._applyScope();
  }

  // ---------------- 전체 보기 ----------------
  /** scope = { mode:'all'|'session', roots:[{nodeId, projectId}], projects:[…], showInactive, focusProject } */
  setScope(scope = {}) {
    const mode = scope.mode === 'all' ? 'all' : 'session';
    const prevMode = this.scope.mode;
    this.scope = { mode, roots: scope.roots || [], projects: scope.projects || [], showInactive: !!scope.showInactive, focusProject: mode === 'all' ? scope.focusProject || null : null };
    this._sessColors = mode === 'all' ? sessionColorMap(this.scope.projects) : new Map();
    if (mode === 'all' && !this.islands) this.islands = new Islands(this.scene, this.tokens);
    if (mode === 'session' && this.islands) { this.islands.dispose(); this.islands = null; this._clusters = []; this._clusterV.clear(); this._ov = null; }
    // 다른 프로젝트는 페이드 아웃 → 숨김(처음 열 때·표현 전환 직후는 바로)
    this.pf.setFocus(this.scope.focusProject, [...this._clusterV.keys()], { instant: !this._clusterV.size || prevMode !== mode });
    if (this.islands) { this.islands.pf = this.pf; this.islands.setFocus(this.scope.focusProject); }
    this.layoutDirty = true;
    if (prevMode !== mode) this._relayout(); else this._applyScope();
    this.lastLabelPass = 0;
  }

  _setClusters(clusters) {
    this._clusters = clusters;
    if (this.islands) this.islands.sync(clusters);
    const keep = new Set();
    for (const c of clusters) {
      keep.add(c.projectId);
      let e = this._clusterV.get(c.projectId);
      if (!e) { e = { projectId: c.projectId, center: new THREE.Vector3() }; this._clusterV.set(c.projectId, e); }
      e.center.set(c.center.x, 0, c.center.z);
      e.r = c.r; e.name = c.name; e.active = !!c.active; e.live = !!c.live; e.busy = !!c.busy; e.inactive = !!c.inactive; e.temp = !!c.temp;
      e.box = c.box || null; e.round = c.round || 0; e.stars = c.stars || null; // Planet 원형 궤도계
    }
    for (const k of [...this._clusterV.keys()]) if (!keep.has(k)) this._clusterV.delete(k);
  }

  /** 노드별 희미·숨김 반영. 단일 세션이면 모든 노드 scopeK=1(변화 0) */
  _applyScope() {
    const ov = this.scope.mode === 'all' ? this._ov : null;
    const fp = ov ? this.scope.focusProject : null;
    for (const v of this.vis.values()) {
      const hidden = !!(ov && ov.hidden.has(v.id));
      const pid = ov ? ov.projectOf.get(v.id) || null : null;
      const rid = ov ? ov.rootOf.get(v.id) : null;
      const rv = rid ? this.vis.get(rid) : null;
      const recent = !!(ov && rv && isRecentRoot(rv.node));
      // scopeD = 고정 희미(recent 0.35) — 문턱(<0.5) 판정용, projA = 프로젝트 페이드, scopeK = 둘의 곱(그리기 배율)
      const d = recent ? 0.35 : 1;
      const pa = ov ? this.pf.alpha(pid) : 1;
      const k = d * pa;
      v.projectId = pid;
      v.scopeRecent = recent;
      v.ovHidden = hidden;
      v.scopeD = d; v.projA = pa;
      v.projOut = !!(fp && this.pf.out(pid));
      v.projGone = !!(fp && this.pf.gone(pid));
      const si = ov ? nodeSessIdx(v.node, this._sessColors) : null; // 세션 색
      if (si !== (v.sessIdx ?? null)) { v.sessIdx = si; v.sessC = si == null ? null : this.tokens['sess-' + si]; this._styleVis(v); v._labelHtml = null; this._labelText(v); }
      this._syncHidden(v);
      if (k !== (v.scopeK ?? 1)) { v.scopeK = k; this._styleVis(v); if (v.sat) this._satFade(v, d, pa); }
      if (v.labelEl && v.exiting == null) { const o = pa < 1 ? (Math.round(pa * 20) / 20).toFixed(2) : ''; if (v.labelEl.style.opacity !== o) v.labelEl.style.opacity = o; }
    }
  }

  /** 숨김·퇴장·고정 희미(recent). 페이드 중인 노드는 라벨·패널을 흐리게 남긴다(다 사라지면 hidden) */
  _scopeOff(v) { return !!v && (v.hidden || v.exiting != null || (v.scopeD ?? v.scopeK ?? 1) < 0.5); }
  /** 스킬 위성: 고정 희미(recent)면 숨기고, 프로젝트 페이드는 문턱 대신 투명도로 */
  _satFade(v, d, pa) {
    const s = v.sat, tr = pa < 1;
    s.obj.visible = d >= 0.5 && pa > 0;
    if (s.mat.transparent !== tr) { s.mat.transparent = tr; s.mat.needsUpdate = true; }
    s.mat.opacity = pa;
    const o = tr ? (Math.round(pa * 20) / 20).toFixed(2) : '';
    if (s.label.element.style.opacity !== o) s.label.element.style.opacity = o;
  }
  /** 프로젝트 페이드 한 프레임(움직일 때만) */
  _stepProjFade(dt) { if (this.pf.step(dt)) { this._applyScope(); if (this.islands) this.islands.restyle(); } }
  /** 프로젝트 투명도(0..1) — 계획 보드·작업 대상 층 등 프로젝트 단위 층이 곱한다 */
  projAlpha(pid) { return this.scope.mode === 'all' ? this.pf.alpha(pid) : 1; }
  projGone(pid) { return this.scope.mode === 'all' ? this.pf.gone(pid) : false; }

  /** 카메라 순환·전체 조망용: [{projectId, name, center:Vector3, r, active, live, busy, inactive}] */
  clusters() { return this.scope.mode === 'all' ? [...this._clusterV.values()] : []; }
  clusterTarget(projectId) { const e = this._clusterV.get(projectId); return e ? { center: e.center, r: e.r, box: e.box || null, round: e.round || 0 } : null; } // box: 상자 맞춤, round: 원형 궤도계 반지름
  nodeCluster(id) { const v = this.vis.get(id); return v ? v.projectId || null : null; }
  /** 화면 좌표 → 섬 projectId(노드가 아닌 빈 섬을 눌렀을 때). 전체 보기 아니면 null.
   *  opts.pid = 그 섬만 + 둘레 여유(프로젝트 영역 판정) */
  pickCluster(clientX, clientY, opts = {}) {
    if (!this.islands) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const e = opts.pid ? this._clusterV.get(opts.pid) : null;
    const pad = e ? projectAreaPad(e.box ? e.box.hw : e.r, e.box ? e.box.hd : e.r) : 0;
    return this.islands.pick(this.raycaster, opts.pid ? { pid: opts.pid, pad } : {});
  }

  _ensureLinkCap(n) {
    if (n <= this.linkCap) return;
    let cap = Math.max(256, this.linkCap);
    while (cap < n) cap *= 2;
    this.linkCap = cap;
    this.linkPos = new Float32Array(cap * 6);
    this.linkCol = new Float32Array(cap * 6);
    this.linkGeo.setAttribute('position', new THREE.BufferAttribute(this.linkPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.linkGeo.setAttribute('color', new THREE.BufferAttribute(this.linkCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.dotPos = new Float32Array(cap * 3 * 3);
    this.dotCol = new Float32Array(cap * 3 * 3);
    this.dotGeo.setAttribute('position', new THREE.BufferAttribute(this.dotPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.dotGeo.setAttribute('color', new THREE.BufferAttribute(this.dotCol, 3).setUsage(THREE.DynamicDrawUsage));
  }

  // ---------------- 질의 (카메라용) ----------------
  has(id) { return this.vis.has(id); }
  nodeTarget(id) { const v = this.vis.get(id); return v ? v.target : null; }
  nodePos(id) { const v = this.vis.get(id); return v ? v.group.position : null; }
  nodeRadius(id) { const v = this.vis.get(id); return v ? v.r : 1; }
  /** 전체 맞춤이 담는 노드 겉 반지름(Planet: 궤도계 바깥 holoR) */
  fitNodeR(id) { const v = this.vis.get(id); return v ? (this.holoR ? this.holoR(v) : v.r * (v.size || 1)) : 1; }
  /** 노드별 라벨(세계 기준점 = 라벨 자리 + px 상자, 라벨 패스가 잰 _lrel) — Map id → [{p, b}] */
  fitLabels(out) {
    out.clear();
    for (const v of this.vis.values()) {
      if (!v.labelOn || !v._lrel || !v.label) continue;
      const g = v.group.position, l = v.label.position, r = v._lrel;
      out.set(v.id, [{ p: { x: g.x + l.x, y: g.y + l.y, z: g.z + l.z }, b: { x0: r[0], y0: r[1], x1: r[2], y1: r[3] } }]);
    }
    return out;
  }
  /** 노드별 펼친 홀로그램 패널 모서리(세계) — Map id → [{x,y,z}] */
  fitPanels(out) { return this.holo ? this.holo.panelCorners(out) : (out.clear(), out); }
  children(id) { return this.childrenOf.get(id) || []; }
  get size() { return this.vis.size; }

  setFocus(id) {
    const prev = this.focusId; this.focusId = id;
    for (const pid of [prev, id]) { const v = pid && this.vis.get(pid); if (v) this._labelText(v); }
    this.lastLabelPass = 0;
  }
  setHover(id) {
    if (this.hoverId === id) return;
    const prev = this.hoverId; this.hoverId = id;
    this.lastLabelPass = 0;
  }

  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.meshes, false);
    for (const h of hits) { const id = h.object.userData.nodeId; const v = this.vis.get(id); if (!this._scopeOff(v) && !v.projOut) return id; } // 숨김·희미·나가는 프로젝트 노드는 고르지 않음
    return null;
  }

  /** 홀로그램 도구 패널 집기 → {id, e}(e = 도구 호출 항목: id=toolUseId·label{tool,target}·cat) | null */
  pickPanel(clientX, clientY) {
    if (!this.holo || !this.holo.panelAt) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const hit = this.holo.panelAt(this.camera, r.width, r.height, clientX - r.left, clientY - r.top);
    if (!hit) return null;
    const v = this.vis.get(hit.id);
    return v && !this._scopeOff(v) && !v.projOut ? hit : null;
  }

  _resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------- 프레임 ----------------
  _labelPass(now) {
    this.lastLabelPass = now;
    const W = this.container.clientWidth, H = this.container.clientHeight;
    const maxLabels = W < 720 ? 8 : MAX_LABELS;
    // 우선순위: 포커스 > 호버 > 루트 > 최근 활동한 작업 중 노드 > (노드가 적으면) 나머지
    const actives = [];
    for (const v of this.vis.values()) if (v.node.status === 'active' && v.id !== this.layoutRoot) actives.push(v);
    actives.sort((a, b) => (b.node.lastActivityAt || '').localeCompare(a.node.lastActivityAt || ''));
    const order = [];
    const seen = new Set();
    // 퇴장 중인 노드는 이미 붙어 있던 라벨만 흐려지며 남김(툭 사라지지 않게)
    const keep = (x) => x && (!this._scopeOff(x) || (x.exiting != null && x.labelOn && !x.hidden && (x.scopeD ?? x.scopeK ?? 1) >= 0.5));
    const push = (id, force, pin = false) => { if (id && !seen.has(id) && keep(this.vis.get(id))) { seen.add(id); order.push([this.vis.get(id), force, pin]); } };
    push(this.focusId, true); push(this.hoverId, true); push(this.layoutRoot, false, true);
    if (this.scope.mode === 'all') for (const c of this._clusters) for (const m of c.mains) push(m.nodeId, false, true); // 섬마다 메인 이름(장치보다 먼저)
    for (const v of this.vis.values()) if (v.device) push(v.id, false, true); // 배치 장치는 회차 집계를 늘 보인다
    // 고정: 루트·섬 메인·배치 장치는 단단히(자리가 없으면 흐리게), 작업 중 노드는 'soft'(줄임 → 이름만 → 먼 자리·리더선, 그래도 없으면 숨김 — 겹친 채 남지 않음)
    for (const v of actives) if (v.sat || (this.holo && this.holo.hasOpenCat(v.id, 'skill'))) push(v.id, false, 'soft'); // 스킬 사용 중 우선
    for (const v of actives.slice(0, maxLabels)) push(v.id, false, 'soft');
    for (const v of this.vis.values()) if (v.exiting != null && v.labelOn) push(v.id, false);
    if (this.vis.size <= 12) for (const id of this.vis.keys()) push(id, false);
    else {
      // 다음 순위: 대기 중이거나 최근 10분 안에 끝난 에이전트류(위성 제외). 겹침 해소가 넘치는 것은 걸러 낸다.
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
    // 화면 좌표로 투영해 라벨끼리·라벨과 다른 노드가 겹치지 않게 고른다(보통 → 줄임 → 숨김, 고정 라벨은 흐리게)
    const f = H / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    const p = this._tmpV;
    const discs = [];
    for (const v of this.vis.values()) {
      if (v.gone || v.hidden || v.exiting != null || !v.group.visible) continue;
      p.copy(v.group.position).project(this.camera);
      if (p.z < -1 || p.z > 1) continue;
      const d = Math.max(0.01, v.group.position.distanceTo(this.camera.position));
      discs.push({ id: v.id, x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H, r: (v.mesh.scale.x * f / d) * this._discK(v) });
    }
    const cands = [];
    const sizeC = new Map();
    const fontPx = this._labelFontPx || 12;
    for (const [v, force, pin] of order) {
      p.copy(v.label.position).add(v.group.position).project(this.camera);
      if (p.z < -1 || p.z > 1) continue;
      const x = (p.x * 0.5 + 0.5) * W, y = (-p.y * 0.5 + 0.5) * H;
      const dist = v.group.position.distanceTo(this.camera.position);
      // 멀리 있는(화면에서 작은) 노드는 이름·상태만(작업 줄·이력 생략) — 전체 보기에서 겹침을 줄인다
      const npx = panelPx(v.r * 2, dist, this.camera.fov, H);
      const small = !force && npx < this.compactPx; // 흐름 표현은 0(작업 줄 늘 표시)
      sizeC.set(v.id, small);
      const modes = labelModes(v, small, force, fontPx, (c) => this._labelBoxW(v, c), this.focusId);
      const px = (v.mesh.scale.x * f) / Math.max(0.01, dist);
      cands.push({ id: v.id, x, y, up: v.label.center.y !== 0, gap: this._labelGapPx(v, px), force, pin, modes });
    }
    // 피할 사각형: 홀로그램 도구 패널·말풍선·섬 이름표
    const rects = planLabelRects(this._obstacleRects(W, H)); // + 계획 보드(라벨이 비킴)
    const placed = placeLabels(cands, discs, { shifts: LABEL_SHIFTS, farShifts: LABEL_FAR_SHIFTS, bounds: [0, W], vbounds: [0, H], rects });
    this._labRes = smoothReserve(this._labRes, labelReserve(placed, cands, discs)); // 맞춤에 라벨 자리 포함
    const candOf = new Map(cands.map((c) => [c.id, c]));
    const want = new Set(placed.keys());
    for (const [id, r] of placed) {
      const v = this.vis.get(id);
      // 밀기: 노드에서 멀어지는 쪽으로(CSS translate — CSS2DRenderer 의 transform 과 따로 합성됨)
      const ty = r.dy ? (v.label.center.y !== 0 ? -r.dy : r.dy) : 0, tx = r.dx || 0;
      const tr = tx || ty ? `${tx}px ${ty}px` : '';
      if ((v._tr || '') !== tr) { v._tr = tr; v.labelEl.style.translate = tr; }
      const compact = r.compact || sizeC.get(id);
      if (compact !== !!v.compact) { v.compact = compact; v.labelEl.classList.toggle('compact', compact); }
      if (r.mini !== !!v.mini) { v.mini = r.mini; v.labelEl.classList.toggle('mini', r.mini); }
      if (r.dim !== !!v.crowded) { v.crowded = r.dim; v.labelEl.classList.toggle('crowded', r.dim); }
      setLead(v, r, v.label.center.y !== 0);
      const c = candOf.get(id);
      v._lrel = c ? [r.box[0] - c.x, r.box[1] - c.y, r.box[2] - c.x, r.box[3] - c.y] : null; // 라벨 상자(노드 화면 자리 기준) — 말풍선이 비킴
    }
    for (const v of this.vis.values()) {
      if (!want.has(v.id)) v._lrel = null;
      if (v.sat) v.sat.label.visible = want.has(v.id);
      const on = want.has(v.id);
      if (on !== v.labelOn) { v.labelOn = on; if (on) v.group.add(v.label); else v.group.remove(v.label); }
      if (on && !this._lro) v._labelH = v.labelEl.offsetHeight || v._labelH || 34; // ResizeObserver 없을 때만(강제 레이아웃)
    }
  }

  /** 라벨이 피할 화면 사각형: 홀로그램 패널 + 섬 이름표 + 하위 표현 것(말풍선) */
  _obstacleRects(W, H) {
    const rects = [];
    if (this.holo) this.holo.panelRects(this.camera, W, H, rects);
    if (this.islands && this.scope.mode === 'all') this.islands.tagRects(this.camera, W, H, rects);
    if (this.sessFx && this.sessFx.count) this.sessFx.chipRects(this.camera, W, H, rects); // 충돌 파일명 칩
    if (this._extraRects) this._extraRects(rects, W, H);
    return rects;
  }
  /** 시험·점검용: 지금 장애물 사각형(페이지 px) */
  obstacleRects() {
    const W = this.container.clientWidth, H = this.container.clientHeight, b = this.container.getBoundingClientRect();
    return this._obstacleRects(W, H).map((r) => [r[0] + b.left, r[1] + b.top, r[2] + b.left, r[3] + b.top]);
  }
  /** 지금 보이는 노드 라벨 상자(px) — 라벨 패스 때 노드 기준으로 잰 상자를 지금 노드 화면 자리에(말풍선이 비킬 때) */
  labelScreenBoxes(W, H, out = []) {
    const p = this._tmpV;
    for (const v of this.vis.values()) {
      if (!v.labelOn || !v._lrel) continue;
      p.copy(v.label.position).add(v.group.position).project(this.camera);
      if (p.z < -1 || p.z > 1) continue;
      const x = (p.x * 0.5 + 0.5) * W, y = (-p.y * 0.5 + 0.5) * H, r = v._lrel;
      out.push([x + r[0], y + r[1], x + r[2], y + r[3]]);
    }
    return out;
  }

  /** 섬 줄 배치용 화면 비율: 위에서 비스듬히 보면 세계 z(앞뒤)가 화면에서 sin(고도)만큼 줄어 보이므로 그만큼 가로로 더 길게 */
  /** 섬 배치용 가용 영역(덮개·라벨 자리를 뺀 비율)·고도 범위 */
  _packView() { return packView(this.container, { labelBelow: !!this.labelBelow, labelReserve: this.labelReserve ? this.labelReserve() : null, prefs: this.cameraPrefs, elev: camElev(this.camera), hy: this.packHy }); } // packHy: 표현 갈고리(흐름 3D 높이 계층, 없으면 예전 1.5)

  _packAspect() {
    const a = (this.container.clientWidth || 16) / (this.container.clientHeight || 10);
    const p = this.cameraPrefs || {}, el = (((p.elevMin ?? 20) + (p.elevMax ?? 55)) / 2) * Math.PI / 180;
    return a * Math.min(1.3, Math.max(1, 1 / Math.max(0.3, Math.sin(el))));
  }

  /** 맞춤 띠에 더할 라벨 자리(px): 맨 위 노드 위·맨 아래 노드 아래로 나간 라벨 높이 */
  labelReserve() { return this._labRes || null; }

  /** 라벨 기준점 → 라벨 가장자리 거리(px). Planet 은 라벨 자리(세계 좌표)가 이미 도형 위라 0, 흐름 표현은 칩 반지름만큼 */
  _labelGapPx() { return 0; }
  /** 노드 원판 반지름 배율(도형 반지름 1 = mesh.scale) — 라벨이 피할 화면 원판 */
  _discK(v) { return v.device ? 1.3 : 1.05; }

  /** 라벨 겹침 상자 폭(px). Planet 은 예전 규칙 그대로, Flow 는 작업 줄 글자 수로 다시 정의 */
  _labelBoxW(v, compact) {
    const n = v.node;
    const nameW = Math.max(86, textWidth(trunc(n.label || n.id, 24), 12));
    return (compact ? Math.max(nameW, v.subTitle ? Math.min(160, textWidth(v.subTitle, 10)) : 0) : Math.max(250, nameW)) + 14;
  }

  /** 카메라와 시선 대상 사이에 끼어 화면을 가리는 노드를 거리 비례로 투명하게(가림 방지).
   *  focusDist 는 camera.js 가 매 프레임 넣어 준다(카메라→시선 대상 거리). */
  _nearFade() {
    const fd = this.focusDist;
    if (!fd) return;
    const near = fd * 0.55;
    const cp = this.camera.position;
    for (const v of this.vis.values()) {
      if (v.gone) continue;
      const d = v.group.position.distanceTo(cp) - v.r * v.size;
      const base = (v.baseOpacity ?? 1) * (v.exitF ?? 1);
      const ended = ENDED_OK(v.node.status);
      if (d < near) {
        const f = Math.max(0.1, d / near);
        v.mat.opacity = base * f;
        v.mat.depthWrite = false;
        if (v.extras.edges) v.extras.edges.material.opacity = (ended ? 0.14 : 0.9) * f;
        v.nearFaded = true;
      } else if (v.nearFaded) {
        v.nearFaded = false;
        v.mat.opacity = base;
        v.mat.depthWrite = !ended;
        if (v.extras.edges) v.extras.edges.material.opacity = ended ? 0.14 : 0.9;
      }
    }
  }

  _frame() {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0.0001, now - this._last));
    this._last = now;
    this.animT += dt; // 퇴장 연출 시계(정지 중엔 이 함수가 불리지 않아 멈춤)
    const at = this.animT;
    this._exitPass(at);
    this._stepProjFade(dt);
    if (this.scope.mode === 'all' && this._ov && now - (this._packChk || 0) > 0.5) { this._packChk = now; if (packStale(this._ov, this._packView())) this.layoutDirty = true; } // 가용 비율이 크게 바뀌면 다시 배치
    if (this.layoutDirty && now - this.lastLayout > 0.15) { this.lastLayout = now; this._relayout(); }
    if (now - this.lastLabelPass > 0.25) this._labelPass(now);
    const t = this.tokens;
    const nowMs = this.clock();

    for (const v of this.vis.values()) {
      if (v.gone) continue; // 퇴장한 노드는 그리지도 움직이지도 않는다
      // 스프링 보간 (임계 감쇠)
      const p = v.group.position;
      const k = 38, c = 2 * Math.sqrt(k);
      v.vel.x += ((v.target.x - p.x) * k - v.vel.x * c) * dt;
      v.vel.y += ((v.target.y - p.y) * k - v.vel.y * c) * dt;
      v.vel.z += ((v.target.z - p.z) * k - v.vel.z * c) * dt;
      p.x += v.vel.x * dt; p.y += v.vel.y * dt; p.z += v.vel.z * dt;

      const st = v.node.status;
      // 크기: 등장 0.6초 + 맥동 + 오래된 done 축소
      const appear = Math.min(1, (now - v.bornAt) / 0.6);
      let target = 1;
      v.stale = false;
      if ((st === 'done' || st === 'error' || st === 'stopped') && v.node.endedAt) {
        const age = (nowMs - Date.parse(v.node.endedAt)) / 1000;
        if (age > 600) { target = 0.6; v.stale = true; }
      }
      v.size += (target - v.size) * Math.min(1, dt * 2);
      // 퇴장 중: 빛이 약해지며 작아지고(ease-in-out), 연결선은 자식 끝부터 감기고, 끝 무렵 입자로 흩어져 부모 쪽으로
      let exitS = 1;
      if (v.exiting != null) {
        const k = (at - v.exiting) / (v.exitDur || EXIT.DUR);
        if (k >= 1) { this._endExit(v); continue; }
        const pose = exitPose(k, this._pose || (this._pose = {}));
        v.exitF = pose.fade; v._linkK = pose.link;
        exitS = pose.scale;
        if (!v.nearFaded) v.mat.opacity = v.baseOpacity * v.exitF;
        if (pose.burst && !v._burst) {
          v._burst = true;
          if (v.exitParticles && this.exitFx) this.exitFx.burst(v, this.parentOf.get(v.id) || v.node.parentId, this.kindColor(v.kind), at, v.exitDur);
        }
        if (v.labelOn) { const o = (Math.round(v.exitF * 20) / 20).toFixed(2); if (v.labelEl.style.opacity !== o) v.labelEl.style.opacity = o; }
      }
      let pulse = 0;
      if (st === 'active' && !v.scopeRecent) pulse = 0.5 - 0.5 * Math.cos((2 * Math.PI * (now + v.seed)) / 1.2);
      const s = v.r * v.size * exitS * (0.2 + 0.8 * easeOutBack(appear)) * (1 + 0.08 * pulse) * (v.dockK || 1);
      v.mesh.scale.setScalar(s);
      v.mat.emissiveIntensity = v.baseEmissive * (st === 'active' ? 0.75 + 0.5 * pulse : 1) * (v.exiting != null ? v.exitF : 1);
      if (v.kind === 'main') v.mesh.rotation.y += dt * (st === 'active' ? 0.35 : 0.08);
      else if (v.kind === 'workflow') v.mesh.rotation.z += dt * (st === 'active' ? 0.6 : 0.1);
      else if (v.kind !== 'bash-bg' && v.kind !== 'monitor') v.mesh.rotation.y += dt * (st === 'active' ? 0.5 : 0.1);
      if (v.extras.glow) {
        v.extras.glow.scale.setScalar(v.r * 1.5 * (1 + 0.06 * pulse) * exitS);
      }
      if (v.device) {
        // 진행 표시등: 회차가 돌면 호박색 깜빡임, 쉬면 옅은 초록, 끝난 장치는 꺼짐
        const run = v.devInfo && v.devInfo.running > 0 && !ENDED_OK(st);
        const led = v.extras.led.material;
        led.color.copy(run ? t.skill : ENDED_OK(st) ? t.stopped : t.ok);
        led.opacity = run ? 0.45 + 0.55 * (Math.sin(now * 6 + v.seed) > 0 ? 1 : 0.2) : 0.55;
      }
      if (v.extras.edges) { v.extras.edges.scale.setScalar(s / v.r * v.r); v.extras.edges.rotation.copy(v.mesh.rotation); }
      if (v.errorSince != null) {
        const e = now - v.errorSince;
        v.extras.err.visible = e > 1.8 ? true : Math.floor(e / 0.3) % 2 === 0;
        v.extras.err.scale.setScalar(v.r * v.size * 1.38);
        // 10분 지난 오류(끝난 백그라운드 명령 등)는 고리를 옅게 해 현재 활동을 가리지 않게
        v.extras.err.material.opacity = v.stale ? 0.3 : 0.95;
      }

      if (v.sat) {
        const a = now * 1.3 + v.seed;
        const R = v.r + 2.0;
        v.sat.obj.position.set(Math.cos(a) * R, v.r * 0.6, Math.sin(a) * R);
        v.sat.obj.rotation.y += dt * 2;
      }
    }

    this._updateLinks(now, t);
    if (this.flow) this.flow.update(now);
    if (this.exitFx) this.exitFx.update(at, this.container.clientHeight || 1, this.camera.fov);

    // 효과
    if (this.effects.length) {
      const keep = [];
      for (const e of this.effects) {
        const k = (now - e.t0) / e.dur;
        if (k >= 1) { this._disposeFx(e); continue; }
        e.update(Math.max(0, k));
        keep.push(e);
      }
      this.effects = keep;
    }

    if (this.onFrame) this.onFrame(dt, now);
    this._nearFade();
    if (this.holo) { this.camera.updateMatrixWorld(); this.holo.update(now, this.camera, this.container.clientHeight || 1); }
    if (this.islands) this.islands.update(now);
    // 안개를 카메라 거리에 맞춤(전체 보기는 원점이 아니라 보는 대상까지 거리)
    const camDist = this.scope.mode === 'all' ? (this.focusDist || this.camera.position.length()) : this.camera.position.length();
    this.scene.fog.near = Math.max(30, camDist * 0.9);
    this.scene.fog.far = Math.max(140, camDist * 3.2);
    this.point.position.copy(this.camera.position);
    if (this.sessFx) this.sessFx.update(now); // 충돌 곡선·칩
    if (this.ix) this.ix.update(now);
    if (this._preRender) this._preRender(now, dt); // 하위 표현(흐름)의 추가 그리기 갱신
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  _updateLinks(now, t) {
    const L = this.links;
    const lp = this.linkPos, lc = this.linkCol, dp = this.dotPos, dc = this.dotCol;
    let nd = 0;
    const link = t.link, bg = t.bg;
    const dim = this._tmpC.copy(link).lerp(bg, 0.6);
    const DP = this.dashPos, DC = this.dashCol;
    let nDash = 0;
    for (let i = 0; i < L.length; i++) {
      const [cv, pv] = L[i];
      const a = pv.group.position;
      // 퇴장 중: 자식 끝에서부터 부모 쪽으로 감겨 들어감
      const b = cv._linkK > 0 ? retractEnd(this._tmpV2, a, cv.group.position, cv._linkK) : cv.group.position;
      const o = i * 6;
      const dashed = isGuessLink(cv.node) && nDash < this.dashCap && !cv.projGone;
      // 신호 열화: 그 세션 연결선은 네 토막으로 끊겨(토막마다 수시로 빠짐) 위아래로 떨리고 밝기가 튄다
      const dg = DEG.on ? degOf(cv.id) : 0;
      const broken = dg > 0 && !dashed && nDash < this.dashCap;
      if (dashed || broken || cv.projGone || pv.projGone) { lp[o] = a.x; lp[o + 1] = a.y; lp[o + 2] = a.z; lp[o + 3] = a.x; lp[o + 4] = a.y; lp[o + 5] = a.z; }
      else { lp[o] = a.x; lp[o + 1] = a.y; lp[o + 2] = a.z; lp[o + 3] = b.x; lp[o + 4] = b.y; lp[o + 5] = b.z; }
      const st = cv.node.status;
      let col = ENDED_OK(st) || (st === 'error' && cv.stale) ? dim : (st === 'error' ? t.error : cv.sessC ? this._tmpC2.copy(cv.sessC).lerp(link, 0.35) : link); // 그 메인 서브트리는 세션 색
      if (cv.scopeK != null && cv.scopeK < 1) col = this._tmpC2.copy(col).lerp(bg, 1 - cv.scopeK * 0.8);
      if (cv.exitF < 1) col = this._tmpC2.copy(col).lerp(bg, cv.exiting != null ? 0.65 * (1 - cv.exitF) : 1 - cv.exitF); // 퇴장 중이면 선도 감기며 흐려짐
      if (broken) col = this._tmpC2.copy(col).lerp(bg, 1 - lineFlicker((cv.seed * 1e6) | 0, DEG.reduced ? 0 : DEG.t, dg));
      lc[o] = col.r; lc[o + 1] = col.g; lc[o + 2] = col.b; lc[o + 3] = col.r; lc[o + 4] = col.g; lc[o + 5] = col.b;
      if (broken) {
        const sd = (cv.seed * 1e6) | 0, tt = DEG.reduced ? 0 : DEG.t;
        for (let d = 0; d < 4; d++) {
          const q = (nDash * 8 + d * 2) * 3;
          const gap = lineGap(sd, d, tt, dg);
          const u0 = d * 0.25 + 0.01, u1 = gap ? u0 : d * 0.25 + 0.24 - 0.06 * dg;
          const j0 = lineJitter(sd, d * 2, tt, dg) * 0.5, j1 = lineJitter(sd, d * 2 + 1, tt, dg) * 0.5;
          DP[q] = a.x + (b.x - a.x) * u0; DP[q + 1] = a.y + (b.y - a.y) * u0 + j0; DP[q + 2] = a.z + (b.z - a.z) * u0;
          DP[q + 3] = a.x + (b.x - a.x) * u1; DP[q + 4] = a.y + (b.y - a.y) * u1 + j1; DP[q + 5] = a.z + (b.z - a.z) * u1;
          DC[q] = DC[q + 3] = col.r; DC[q + 1] = DC[q + 4] = col.g; DC[q + 2] = DC[q + 5] = col.b;
        }
        nDash++;
      } else if (dashed) {
        for (let d = 0; d < 4; d++) {
          const u0 = d * 0.25 + 0.02, u1 = d * 0.25 + 0.15, q = (nDash * 8 + d * 2) * 3;
          DP[q] = a.x + (b.x - a.x) * u0; DP[q + 1] = a.y + (b.y - a.y) * u0; DP[q + 2] = a.z + (b.z - a.z) * u0;
          DP[q + 3] = a.x + (b.x - a.x) * u1; DP[q + 4] = a.y + (b.y - a.y) * u1; DP[q + 5] = a.z + (b.z - a.z) * u1;
          DC[q] = DC[q + 3] = col.r; DC[q + 1] = DC[q + 4] = col.g; DC[q + 2] = DC[q + 5] = col.b;
        }
        nDash++;
      }
      if (st === 'active' && (cv.scopeK ?? 1) >= 0.5 && cv.exiting == null) {
        const kc = this.kindColor(cv.kind);
        for (let j = 0; j < 3; j++) {
          const u = ((now * 0.55 + j / 3 + cv.seed) % 1);
          if (dg > 0 && !DEG.reduced && packetGone(((cv.seed * 1e6) | 0) + j * 7 + Math.floor(now * 0.55 + j / 3 + cv.seed), u, dg)) continue; // 흐르는 점 소실
          const q = nd * 3;
          dp[q] = a.x + (b.x - a.x) * u; dp[q + 1] = a.y + (b.y - a.y) * u; dp[q + 2] = a.z + (b.z - a.z) * u;
          dc[q] = kc.r; dc[q + 1] = kc.g; dc[q + 2] = kc.b;
          nd++;
        }
      }
    }
    this.linkGeo.setDrawRange(0, L.length * 2);
    this.linkGeo.attributes.position.needsUpdate = true;
    this.linkGeo.attributes.color.needsUpdate = true;
    this.dashGeo.setDrawRange(0, nDash * 8);
    if (nDash) { this.dashGeo.attributes.position.needsUpdate = true; this.dashGeo.attributes.color.needsUpdate = true; }
    this.dotGeo.setDrawRange(0, nd);
    this.dotGeo.attributes.position.needsUpdate = true;
    this.dotGeo.attributes.color.needsUpdate = true;
    this._updateSpawnLinks(t);
  }

  /** 띄움 점선: 기동기 ↔ 띄운 노드, 테마 토큰 link-spawn 을 배경 쪽으로 섞어 옅게. 숨김·퇴장·희미 범위면 같이 흐림 */
  _updateSpawnLinks(t) {
    const P = this.spawnPos, C = this.spawnCol, bg = t.bg, base = t['link-spawn'];
    const c = this._tmpSpawnC || (this._tmpSpawnC = new THREE.Color());
    let k = 0;
    for (const [lv, sv] of this.spawnLinks || []) {
      if (k >= SPAWN_CAP) break;
      if (lv.gone || sv.gone || lv.hidden || sv.hidden) continue;
      const fade = Math.min(lv.scopeK ?? 1, sv.scopeK ?? 1) * Math.min(lv.exitF ?? 1, sv.exitF ?? 1);
      if (fade < 0.05) continue;
      c.copy(base).lerp(bg, 1 - 0.85 * fade);
      const a = sv.group.position, b = lv.group.position;
      for (let d = 0; d < SPAWN_DASH.length; d++) {
        const [u0, u1] = SPAWN_DASH[d], q = (k * SPAWN_DASH.length + d) * 6;
        P[q] = a.x + (b.x - a.x) * u0; P[q + 1] = a.y + (b.y - a.y) * u0; P[q + 2] = a.z + (b.z - a.z) * u0;
        P[q + 3] = a.x + (b.x - a.x) * u1; P[q + 4] = a.y + (b.y - a.y) * u1; P[q + 5] = a.z + (b.z - a.z) * u1;
        C[q] = C[q + 3] = c.r; C[q + 1] = C[q + 4] = c.g; C[q + 2] = C[q + 5] = c.b;
      }
      k++;
    }
    this.spawnGeo.setDrawRange(0, k * SPAWN_DASH.length * 2);
    if (k) { this.spawnGeo.attributes.position.needsUpdate = true; this.spawnGeo.attributes.color.needsUpdate = true; }
    this.spawnLines.visible = k > 0;
  }
}

export { escapeHtml }; // 순수 모듈(html-util.mjs)로 옮김 — 같은 함수
