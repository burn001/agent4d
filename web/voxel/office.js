// 복셀 오피스 렌더러 — SceneView 와 같은 RendererView 인터페이스.
// 방·가구는 정적 InstancedMesh(방이 바뀔 때만 다시), 캐릭터·기계·시설 애니메이션·효과는 동적 InstancedMesh 에
// 매 프레임 다시 채운다 → 전체 draw call 은 한 자릿수(캐릭터 수와 무관).
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { computeOffice, stationFor, CAT_FACILITY, hashStr } from './layout.js';
import { readTokens, palette } from './palette.js';
import { BoxBatch, UNIT_BOX, buildRoomStatic, buildCorridor, drawFacilities, drawDeskEmitter, drawMachine, ring, roomFrame, endXf, DESK_TOP } from './props.js';
import { xfAngle, toLocal } from './xf.mjs';
import { Character, drawCharacter, drawCharacterFar } from './character.js';
import { crewSpots } from './character-core.mjs';
import { breakSpot, BREAK_N, roleOf, overseeSpot } from './office-core.mjs';
import { VxHolo } from './vx-holo.js';
import { VxFlow } from './vx-flow.js';
import { VxIx } from './vx-ix.js';
import { VxClient } from './vx-client.js';
import { Bubbles, esc, trunc } from './bubbles.js';
import { KIND_LABEL } from '../layout.js';
import { t as _t } from '../i18n.mjs';
import { computeCampus } from './campus.mjs';
import { packView, packStale, camElev } from '../overview/pack-view.js';
import { VxSessions } from './vx-sessions.js';
import { VoxelArt3D } from '../art-layer3d.js'; // 작업 대상 층(켤 때만 만든다)
import { sessBadgeHtml, branchOf } from '../session-core.mjs';
import { spawnLinks, dashSpans, spawnTag } from '../spawn-link.mjs';

const SPAWN_CAP = 16, SPAWN_DASH = dashSpans(12, 0.5);
import { nodeSubtitle } from '../node-title.mjs';
import { ensureOverviewCss, islandLabelHtml } from '../overview/islands.js';
import { pickRectAt, projectAreaPad } from '../overview/pick-core.mjs';
import { ProjFade } from '../proj-fade.mjs';
import { BATCH, batchFold, deviceInfo, deviceSummary, nodeTags, isLauncher, isCycle, rearmStandby, cycleProgress } from '../batch-core.mjs';
import { isJob, jobOf } from '../job-core.mjs'; // 작업 노드
import { jobCardModel, jobLabelAlways, jobBoardYaw, JOBCARD } from './vx-job-core.mjs';
import { drawJobCard } from './vx-jobs.js';
import { VxProcs } from './vx-procs.js'; // 분리 프로세스 = 생산 라인 · 들여다보기 심부름

const MACHINE_KIND = { 'bash-bg': 'rack', monitor: 'screen', workflow: 'board' };
const KNOWN = new Set(['main', 'subagent', 'workflow', 'workflow-agent', 'claude-p', 'bash-bg', 'monitor']);
const STATUS_LABEL = Object.fromEntries(['active', 'idle', 'done', 'error', 'stopped'].map((s) => [s, _t('scene.status.' + s)]));
export const CAT_VERB = Object.fromEntries(['shell', 'read', 'write', 'edit', 'search', 'agent', 'workflow',
  'skill', 'web', 'monitor', 'mcp', 'artifact', 'notify', 'other'].map((c) => [c, _t('scene.verb.' + c)]));
const HOLD_SEC = 30;        // 퇴장 뒤 자리 반납까지(벽시계, 재생 속도로 나눔)
const RECENT_MS = 30000;    // 스냅샷으로 들어온 done 이 이 안이면 퇴장 동작만 보여 줌(가상 시계)
const MAX_FX = 200;
const FACILITIES = ['shelf', 'files', 'board', 'toolbox', 'antenna', 'terminal', 'kiosk', 'portal', 'bell', 'screens'];

function ensureCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-vx-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./voxel.css', import.meta.url).href;
  l.dataset.vxCss = '1';
  document.head.appendChild(l);
}

const isEnded = (n) => n && (n.status === 'done' || n.status === 'error' || n.status === 'stopped');

export class VoxelView {
  static modeId = 'voxel';
  static modeLabel = _t('scene.mode.voxel');

  constructor(container, labelContainer, opts = {}) {
    ensureCss();
    this.container = container;
    this.labelContainer = labelContainer;
    this.opts = opts;
    this.clock = Date.now;
    this.ts = 1;
    this.tokens = readTokens();
    this.pal = palette(this.tokens.isLight);
    this.nodes = new Map();          // 받은 노드 전부(store 객체 그대로)
    this.orderOf = new Map();
    this.order = 0;
    this.chars = new Map();          // id → Character (팀장·직원·워크플로 에이전트)
    this.machines = new Map();
    this._removing = new Set();      // 퇴장 연출 뒤 지울 노드(node-remove)
    this._settleUntil = 0;       // id → {node, type, flashUntil, endWall, heldUntil, released, seed, appearT0}
    this.vis = new Map();            // camera facade: id → {node, target, r, icons:{size}}
    this.rootId = null;
    this.layoutRoot = null;
    this.layout = null;
    this.rooms = [];
    this.roomsById = new Map();
    this.layoutDirty = true;
    this.lastLayout = -1;
    this.focusId = null;
    this.hoverId = null;
    this.focusDist = 0;
    this.onFrame = null;
    this.effects = [];
    this.stationUse = new Map();
    this.staticSig = '';
    this._kids = new Map();
    this._kidsDirty = true;
    this.cameraPrefs = { fov: 30, elevMin: 30, elevMax: 52, distMin: 10, distMax: 220, overviewScale: 1.0, nodeScale: 1.0, minR: 8, /* 노드가 main 하나일 때 너무 붙어 사람 입력 빛기둥이 화면을 가리던 것(5.5 → 8) */ azCenter: 45, azRange: 28, overviewDistMax: 1400 };
    // 전체 보기: 프로젝트 = 건물 동. mode 'session' 이면 1·2차와 같은 단일 사무실 배치
    this.scope = { mode: 'session', roots: [], projects: [], showInactive: false, focusProject: null };
    this._signs = [];
    this._clusterV = new Map();
    this.pf = new ProjFade(); // 단일 프로젝트 선택 페이드
    this._fadeFn = (x, z) => this._fadeAt(x, z);
    this._dimLooks = new Map();
    this.sess = new VxSessions(this); // 라운지·이사·충돌·메시지·컨텍스트 흔적

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    container.prepend(r.domElement);
    r.domElement.tabIndex = 0;
    this.labelRenderer = new CSS2DRenderer({ element: labelContainer });

    const sc = this.scene = new THREE.Scene();
    sc.fog = new THREE.Fog(0x000000, 80, 400);
    const cp = this.cameraPrefs;
    this.camera = new THREE.PerspectiveCamera(cp.fov, 1, 0.5, 2500);
    {
      const d = 90, el = (40 * Math.PI) / 180, az = (cp.azCenter * Math.PI) / 180;
      this.camera.position.set(Math.cos(el) * Math.sin(az) * d, Math.sin(el) * d, Math.cos(el) * Math.cos(az) * d);
      this.camera.lookAt(0, 0, 0);
    }
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.6);
    this.dir = new THREE.DirectionalLight(0xffffff, 1.8);
    this.dir.position.set(26, 48, 34);
    sc.add(this.hemi, this.dir, this.dir.target);

    const lit = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
    const glow = () => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.sLit = new BoxBatch(lit(), 4096, sc);
    this.sGlow = new BoxBatch(glow(), 1024, sc);
    // 유리 칸막이: 반투명 묶음(깊이 쓰기 없음, 불투명 뒤에 그림)
    this.sGlass = new BoxBatch(new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false }), 512, sc);
    this.sGlass.mesh.renderOrder = 2;
    this.dLit = new BoxBatch(lit(), 2048, sc);
    this.dGlow = new BoxBatch(glow(), 2048, sc);
    this._statB = { lit: this.sLit, glow: this.sGlow, glass: this.sGlass };
    this._dynB = { lit: this.dLit, glow: this.dGlow };

    const shadows = opts.shadows ?? (typeof location !== 'undefined' && /[?&]shadows=1\b/.test(location.search));
    if (shadows) {
      r.shadowMap.enabled = true;
      this.dir.castShadow = true;
      this.dir.shadow.mapSize.set(1024, 1024);
      for (const b of [this.sLit, this.dLit]) { b.mesh.castShadow = true; b.mesh.receiveShadow = true; }
    }

    this.bubbles = new Bubbles(sc);
    // 개편: 홀로그램 모니터·업무 흐름(바닥 조명 라인·패킷)·특별 상호작용 은유·의뢰인 창구
    this._layoutVer = 0;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.holo = new VxHolo(this);
    this.flow = new VxFlow(this);
    this.ix = new VxIx(this);
    this.client = new VxClient(this);
    this.procs = new VxProcs(this);
    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._tmpV = new THREE.Vector3();
    this._c = new THREE.Color();
    this._ctx = { now: 0, dt: 0, ts: 1, room: null, seat: null,
      stationSpot: (ch, cat) => this._stationSpot(ch, cat),
      releaseStation: (ch) => this._releaseStation(ch),
      breakSpot: (ch) => (ch.room && ch.room.type === 'office' ? breakSpot(ch.room, this._breakIdx(ch)) : null),
      crewOf: (ch) => crewSpots(this.chars.values(), ch, this._crewBuf || (this._crewBuf = [])), // 팀장 지휘·감독
      overseeSpot: (ch, crew) => overseeSpot(ch.room, crew), // 볼 팀원 책상 앞 통로
      onError: (ch) => this.bubbles.say(ch.id, _t('scene.vx.errorBubble'), { type: 'error', dur: 2, now: this._now }) };
    this._fx = { t: 0, now: 0, skill: null, error: null, ok: null, text: null, focus: false, hover: false, metaSkill: false, doneLead: false, idle: false, catColor: null, monK: 0, mugC: null, coffeeC: null, bagC: null, shoeC: null, cardC: null };
    this._labels = Array.from({ length: 24 }, () => ({ id: null, text: '', html: null, cls: '', x: 0, y: 0, z: 0 }));
    this._roomLabels = Array.from({ length: 16 }, () => ({ id: null, text: '', html: null, cls: '', x: 0, z: 0 }));
    this._posTmp = { x: 0, y: 0, z: 0 };
    this._bubCtx = { now: 0, narrow: false, focusId: null, hoverId: null, fadeAt: (x, z) => (this._fadeOn ? this._fadeAt(x, z) : 1), posOf: (id) => this._posOf(id), labels: null, rooms: null, chars: this.chars, camera: this.camera, width: 1, height: 1 };

    this.applyTheme();
    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);
    this._last = performance.now() / 1000;
    this._now = this._last;
    r.setAnimationLoop(() => this._frame());
  }

  // ---------------- 공통 인터페이스 ----------------
  setClock(fn) { this.clock = typeof fn === 'function' ? fn : Date.now; }
  setTimeScale(k) { this.ts = Math.max(0.1, Number(k) || 1); }

  applyTheme() {
    const t = this.tokens = readTokens();
    this.pal = palette(t.isLight);
    this.scene.background = t.bg.clone();
    this.scene.fog.color.copy(t.fog);
    // 조명: 라이트 = 낮(밝은 흰 빛), 다크 = 밤(푸른 달빛 + 낮은 실내등 — 홀로그램·바닥 라인·야경이 돋보이게)
    this.hemi.intensity = t.isLight ? 2.1 : 1.75;
    this.hemi.color.set(t.isLight ? 0xffffff : 0xc4d2ff);
    this.hemi.groundColor.set(t.isLight ? 0xb8c2d3 : 0x161e30);
    this.dir.intensity = t.isLight ? 1.6 : 1.45;
    this.dir.color.set(t.isLight ? 0xfff6e8 : 0xb9c8ff);
    if (this.sGlass) this.sGlass.material.opacity = t.isLight ? 0.26 : 0.16;
    if (this.holo) this.holo.applyTheme(t);
    if (this.ix) this.ix.applyTheme();
    if (this.vArt) this.vArt.applyTheme(t);
    for (const ch of this.chars.values()) ch.look = null;
    this._dimLooks.clear();
    this.staticSig = '';
  }

  kindColor(kind) { return this.tokens['k-' + kind] || this.tokens['k-subagent']; }

  reset() {
    this.nodes.clear(); this.orderOf.clear(); this.order = 0;
    this.chars.clear(); this.machines.clear(); this.vis.clear(); this._removing.clear();
    this.layout = null; this.rooms = []; this.roomsById.clear();
    this.effects = [];
    this.stationUse.clear();
    this.bubbles.clear();
    this.holo.clear(); this.flow.clear(); this.ix.clear(); this.client.clear(); this.procs.clear();
    this._lblUsed = null;
    this.focusId = null; this.hoverId = null;
    this.layoutDirty = true;
    this._kidsDirty = true;
    this.staticSig = '';
  }

  setRoot(id) { this.rootId = id; this.layoutDirty = true; }

  addNode(node, spawn = true) {
    if (!node || !node.id) return;
    if (this._removing.has(node.id)) this._dropNode(node.id); // 나가던 직원이 다시 들어옴: 새로
    else if (this.nodes.has(node.id)) { this.updateNode(node.id, node); return; }
    const now = this._now;
    this.nodes.set(node.id, node);
    this.orderOf.set(node.id, this.order++);
    const kind = KNOWN.has(node.kind) ? node.kind : 'subagent';
    const recent = isEnded(node) && node.endedAt && this.clock() - Date.parse(node.endedAt) < RECENT_MS;
    if (MACHINE_KIND[kind]) {
      // 기동기는 배치 장치(복합기), 재무장 Monitor 는 앞 화면을 이어받아 새로 켜지는 연출 없이
      const rearm = node.meta && node.meta.rearmOf && this.machines.has(node.meta.rearmOf);
      const job = isJob(node); // 작업 = 주인 기계 옆 현황판 카드(끝나도 자리를 지킨다 — 접기는 batchFold, 나감은 주인과 함께)
      const m = { id: node.id, node, type: job ? 'job' : isLauncher(node) ? 'batch' : MACHINE_KIND[kind], flashUntil: 0, endWall: null, heldUntil: 0, released: false, seed: (hashStr(node.id) % 100) / 37, appearT0: spawn && !rearm ? now : null, info: null };
      if (isEnded(node) && !job) { m.endWall = now; m.heldUntil = now + (recent ? this._hold() : 0); if (!recent && !spawn) m.released = true; }
      this.machines.set(node.id, m);
      this.procs.seedNode(node); // 열린 들여다보기(스냅샷)
    } else {
      // 기동기 회차는 자기 사무실 없이 메인 사무실 직원(배치 장치 앞)
      const lead = kind === 'main' || (kind === 'claude-p' && !isCycle(node, this.nodes)) || node.id === this.rootId || (!node.parentId && !this.rootId);
      const ch = new Character(node.id, node, { lead });
      ch.kind = kind;
      ch.spawnMode = spawn ? 'enter' : 'place';
      if (!lead && isEnded(node) && !spawn) {
        if (recent) ch.startAtDoor = true;
        else { ch.state = 'gone'; ch.released = true; ch.goneAt = now; }
      }
      for (const t of node.openTools || []) { ch.addTool(t.toolUseId, t.cat, t.tool, now - 1); this.holo.start(node.id, t, { quiet: true }); }
      if ((node.openTools || []).length) ch.snapNext = !spawn;
      this.chars.set(node.id, ch);
    }
    this._batchDirty(node.parentId);
    this.layoutDirty = true;
    this._kidsDirty = true;
  }

  /** 배치 장치 집계 다시(장치 자신이나 그 회차가 바뀜) */
  _batchDirty(id) { const m = id && this.machines.get(id); if (m && m.type === 'batch') { m.info = null; this._lblAt = 0; } }

  updateNode(id, patch = {}) {
    const n = this.nodes.get(id);
    if (!n) return;
    const now = this._now;
    if ('parentId' in patch) this.layoutDirty = true;
    const ch = this.chars.get(id);
    const m = this.machines.get(id);
    if ('status' in patch) {
      const ended = isEnded(n);
      if (ch) {
        if (!ended && ch.state === 'gone') {
          // 재개: 출입문에서 다시 들어옴
          const c2 = new Character(id, n, { lead: ch.lead });
          c2.kind = ch.kind; c2.spawnMode = 'enter';
          this.chars.set(id, c2);
          this.layoutDirty = true;
        }
        if (ch.lead && n.kind === 'claude-p') this.staticSig = '';
      }
      if (m && m.type === 'job') { m.flashUntil = now + 0.35; this.layoutDirty = true; } // 끝난 작업 접기(최근 3개)가 바뀔 수 있다
      else if (m) {
        if (ended && m.endWall == null) {
          m.endWall = now; m.heldUntil = now + this._hold();
          // 만료된 Monitor 는 재무장을 기다리며 화면을 꺼 둔 채 자리를 지킨다(깜빡임 방지)
          if (rearmStandby(n, this.nodes.get(n.parentId), 0)) { m.heldUntil = now + BATCH.REARM_WAIT_S / Math.max(1, this.ts); m.standby = true; }
        }
        if (!ended) { if (m.released) this.layoutDirty = true; m.endWall = null; m.released = false; }
        m.flashUntil = now + 0.35;
      }
      if (isEnded(n)) this.holo.endAll(id, n.status === 'error' ? 'error' : n.status === 'stopped' ? 'stopped' : 'ok');
      this._kidsDirty = true;
      this._batchDirty(id); this._batchDirty(n.parentId);
      if (n.kind === 'claude-p' || n.kind === 'monitor') this.layoutDirty = true;
    }
    if (patch.meta && 'batch' in patch.meta) this._batchDirty(id);
  }

  /**
   * 노드 제거(node-remove). opts.animate(기본 true)면 툭 사라지지 않고: 직원은 자리에서 일어나 문으로 걸어 나간 뒤(기존 퇴장 경로),
   * 기계는 잠깐 깜빡인 뒤 지운다. 16배속 이상·조용한 이벤트·보이지 않는 노드는 바로 지움
   */
  removeNode(id, opts = {}) {
    if (this._removing.has(id)) { if (opts.animate === false) this._dropNode(id); return; }
    const ch = this.chars.get(id), m = this.machines.get(id), now = this._now;
    const animate = opts.animate !== false && !opts.quiet && this.ts < 16 && !this._isDim(id);
    if (animate && ch && ch.placed && ch.seat && ch.state !== 'gone' && !ch.offstage) { ch.forceLeave = true; this._removing.add(id); this.holo.foldNode(id); return; }
    if (animate && m && m.pos && !m.released) { m.removing = true; m.flashUntil = now + 0.35; m.endWall = m.endWall ?? now; m.heldUntil = now + 0.6; this._removing.add(id); return; }
    this._dropNode(id);
  }
  _dropNode(id) {
    const ch = this.chars.get(id);
    if (ch) this._releaseStation(ch);
    this._removing.delete(id);
    this.nodes.delete(id); this.chars.delete(id); this.machines.delete(id); this.vis.delete(id);
    this.holo.removeNode(id); this.ix.dropNode(id); this.client.desks.delete(id); this.procs.dropNode(id);
    this.layoutDirty = true; this._kidsDirty = true;
    this._settleUntil = (this._now || 0) + 0.7;
  }
  /** 퇴장 연출 중(나가는 직원·지울 노드)인가 — 자동 카메라는 끝난 뒤 한 번만 다시 맞춘다 */
  get exitSettling() {
    if (this._removing.size || (this._now || 0) < this._settleUntil) return true;
    for (const ch of this.chars.values()) if (ch.state === 'leave') return true;
    return false;
  }

  toolStart(nodeId, ev = {}, quiet = false) {
    const now = this._now;
    const ch = this.chars.get(nodeId);
    if (!ch) { const m = this.machines.get(nodeId); if (m) m.flashUntil = now + 0.3; return; }
    if (ch.state === 'gone') return;
    const tid = ev.toolUseId || 'anon' + Math.random();
    ch.addTool(tid, ev.cat || 'other', ev.tool, now);
    this.holo.start(nodeId, { ...ev, toolUseId: tid }, { quiet, speed: this.ts });
    if (quiet) ch.snapNext = true;
  }

  toolEnd(nodeId, ev = {}) {
    const now = this._now;
    const ch = this.chars.get(nodeId);
    if (!ch) { const m = this.machines.get(nodeId); if (m) m.flashUntil = now + 0.3; return; }
    const found = ch.endTool(ev.toolUseId, ev.ok, now);
    if (!found && ev.ok === false) ch.errFlashUntil = now + 0.6;
    if (ev.toolUseId) this.holo.end(nodeId, ev.toolUseId, ev.ok === false ? 'error' : ev.stopped ? 'stopped' : 'ok', ev.result || ev.text || '');
  }

  /** 흐름 연출(app.onEvent, 라이브·재생·mock 같은 길 — quiet 제외): 바닥 패킷·특별 상호작용·의뢰인 창구 */
  flowEvent(ev, opts = {}) {
    this.flow.event(ev, opts);
    this.ix.event(ev, opts);
    this.client.event(ev);
    this.procs.event(ev); // 들여다보기(watch)
  }
  /** 탕비실 자리 번호(같은 방 안에서 겹치지 않게 해시 + 이미 쉬는 사람 수) */
  _breakIdx(ch) {
    let k = 0;
    for (const o of this.chars.values()) if (o !== ch && o.room === ch.room && o.target && o.target.type === 'break') k++;
    return (ch.hash + k) % BREAK_N;
  }
  /** 측정용(확인 스크립트): 홀로그램·흐름·상호작용 수 */
  vxStats() { return { holo: { ...this.holo.stats }, flow: { ...this.flow.stats }, ix: { ...this.ix.stats, on: this.ix.on }, procs: { ...this.procs.stats }, dyn: this.dLit.n + this.dGlow.n, stat: this.sLit.n + this.sGlow.n + this.sGlass.n }; }

  /** 말풍선. type = tool|text|user|result. tool 이면 cat 동사를 앞에 붙인다(예: "읽기 · SKILL.md") */
  say(nodeId, text, { type = 'text', cat = null, ok = null } = {}) {
    if (text == null || text === '') return;
    const ch = this.chars.get(nodeId), m = this.machines.get(nodeId);
    if ((!ch || ch.state === 'gone') && !m) return;
    let prefix = '';
    if (type === 'tool') {
      if (ch && ch._monK > 0.5) return; // 홀로그램 모니터가 도구 이름·출력을 보여 준다
      let c = cat;
      if (!c && ch && ch.tools.length) c = ch.tools[ch.tools.length - 1].cat;
      prefix = (CAT_VERB[c] || CAT_VERB.other) + ' · ';
    } else if (type === 'user') prefix = _t('scene.role.user') + ' · ';
    else if (type === 'result') prefix = (ok === false ? _t('scene.role.error') : _t('scene.vx.done')) + ' · ';
    const dur = 2.5 / Math.sqrt(Math.min(Math.max(this.ts, 1), 4));
    this.bubbles.say(nodeId, prefix + text, { type: type === 'result' && ok === false ? 'error' : type, dur, now: this._now });
  }

  // ---- 효과 ----
  _pushFx(e) { if (this.effects.length >= MAX_FX) this.effects.shift(); e.t0 = this._now; this.effects.push(e); }
  ripple(id, color) {
    const ch = this.chars.get(id);
    if (ch) ch.flashUntil = this._now + 0.45;
    const m = this.machines.get(id);
    if (m) m.flashUntil = this._now + 0.35;
    if (color) this._pushFx({ type: 'ring', id, dur: 0.7, color: toColor(color), r0: 0.5, r1: 1.0 });
  }
  wave(id, color, scale = 1) {
    const m = this.machines.get(id);
    if (m) { m.flashUntil = this._now + 0.35; return; }
    if (!this.chars.has(id)) return;
    this._pushFx({ type: 'ring', id, dur: 0.75, color: toColor(color || this.kindColor(this.nodes.get(id)?.kind)), r0: 0.4, r1: 1.2 * scale });
  }
  // 여러 live 세션
  setSessions({ book } = {}) { this.sess.setBook(book || null); }
  sessionMsg(ev) { return this.sess.message(ev, this._now); }

  orb(from, to, color, dur = 0.8) {
    const ok = (x) => (typeof x === 'string' ? this.vis.has(x) : x && x.isVector3);
    if (!ok(from) || !ok(to)) return;
    this._pushFx({ type: 'orb', from: typeof from === 'string' ? from : from.clone(), to: typeof to === 'string' ? to : to.clone(), dur: Math.max(0.3, dur), color: toColor(color || this.tokens.ok) });
  }

  // ---- 카메라 질의 ----
  layoutNow() { this._relayout(this._now); this._syncVis(this._now); }
  has(id) { return this.vis.has(id); }
  nodeTarget(id) { const v = this.vis.get(id); return v ? v.target : null; }
  nodePos(id) { return this.nodeTarget(id); }
  /** 계획 보드 앵커의 제자리: 캐릭터는 걸어 다녀도 자기 책상 자리(seat), 장치(기동기 등)는 그 자리 */
  planHome(id) { const v = this.vis.get(id); if (!v) return null; const ch = this.chars.get(id); return ch && ch.seat ? v.target.clone().set(ch.seat.x, 1, ch.seat.z) : v.target.clone(); }
  nodeRadius(id) { const v = this.vis.get(id); return v ? v.r : 1; }
  /** 전체 맞춤이 담는 노드 겉 반지름 */
  fitNodeR(id) { return this.nodeRadius(id); }
  /** 노드별 이름표(세계 기준점 + px 상자) — Map id → [{p, b}] */
  fitLabels(out) { out.clear(); return this.bubbles ? this.bubbles.fitLabels(out) : out; }
  /** 노드별 펼친 책상 모니터 모서리(세계) — Map id → [{x,y,z}]. 방(벽·바닥)은 담지 않는다 */
  fitPanels(out) {
    out.clear();
    const now = performance.now() / 1000; // vx-holo update 와 같은 시계
    for (const ch of this.chars.values()) {
      const m = ch._monFit;
      if (!m || !(ch._monK > 0.05) || ch.state === 'gone' || ch.offstage || now - m.t > 0.5) continue;
      const a = [];
      for (const s of [-1, 1]) { const x = m.x + m.px * m.hw * s, z = m.z + m.pz * m.hw * s; a.push({ x, y: DESK_TOP, z }, { x, y: m.top, z }); }
      out.set(ch.id, a);
    }
    return out;
  }
  get size() { return this.vis.size; }
  children(id) {
    if (this._kidsDirty) this._computeKids();
    return this._kids.get(id) || EMPTY;
  }

  setFocus(id) { this.focusId = id || null; }
  setHover(id) { this.hoverId = id || null; }

  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const mesh = this.dLit.mesh;
    mesh.boundingSphere = null; // 매 프레임 바뀌므로 판정 때만 다시 계산
    mesh.boundingBox = null;
    const hits = this.raycaster.intersectObject(mesh, false);
    for (const h of hits) {
      const id = this.dLit.owners[h.instanceId];
      if (id && this.vis.has(id) && !this._isDim(id) && !this._isOut(id)) return id; // 나가는 프로젝트는 고르지 않음
    }
    return null;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.renderer.setAnimationLoop(null);
    if (this._ro) this._ro.disconnect();
    this.bubbles.dispose();
    if (this.sess) this.sess.dispose();
    this.holo.dispose(); this.ix.dispose(); this.client.dispose(); this.procs.dispose();
    if (this.vArt) { this.vArt.dispose(); this.vArt = null; }
    for (const sg of this._signs) { sg.o.removeFromParent(); sg.el.remove(); }
    this._signs = [];
    for (const b of [this.sLit, this.sGlow, this.sGlass, this.dLit, this.dGlow]) b.dispose();
    UNIT_BOX.dispose(); // 공유 지오메트리: 다시 쓰면 three 가 새로 올린다
    this.dir.dispose(); this.hemi.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.chars.clear(); this.machines.clear(); this.vis.clear(); this.nodes.clear();
  }

  // ---------------- 내부 ----------------
  _hold() { return HOLD_SEC / Math.max(1, this.ts); }

  _present() {
    const out = [];
    // 재무장 Monitor: 뒤 것이 있는 앞 Monitor 는 자리에서 빼고 뒤 것이 그 화면을 잇는다
    const fold = batchFold(this.nodes);
    const wfMember = new Set();
    for (const ch of this.chars.values()) {
      if (ch.released) continue;
      const p = ch.node.parentId;
      if (p && this.machines.has(p)) wfMember.add(p);
    }
    for (const [id, n] of this.nodes) {
      const ch = this.chars.get(id);
      if (ch && ch.released) continue;
      const m = this.machines.get(id);
      if (m && m.released && !(m.type === 'board' && wfMember.has(id))) continue;
      if (fold.rearmPrev.has(id)) continue;
      if (m && m.type === 'job' && fold.hidden.has(id)) continue; // 끝난 작업은 주인마다 최근 몇 개만(jobFold)
      // 재무장 앞 Monitor 아래 작업은 대표(마지막 Monitor) 판에 — 서버가 parentId 를 옮기기 전에도 사라지지 않게
      const pid = m && m.type === 'job' && fold.rearmPrev.has(n.parentId) ? fold.rearmPrev.get(n.parentId) : n.parentId;
      out.push({ id, parentId: pid, kind: n.kind, status: n.status, order: this.orderOf.get(id), startedAt: n.startedAt, projectId: n.projectId, rootSessionId: n.rootSessionId, meta: n.meta, sessionId: n.sessionId, lastActivityAt: n.lastActivityAt });
    }
    return out;
  }

  _relayout(now) {
    this._layoutVer++;
    this.lastLayout = now;
    this.layoutDirty = false;
    const campus = this.scope.mode === 'all';
    const lay = campus
      ? computeCampus(this._present(), this.scope.roots, this.scope.projects, this.layout && this.layout.campus ? this.layout : null, { showInactive: this.scope.showInactive, nowMs: Date.now(), view: packView(this.container, { prefs: this.cameraPrefs, elev: camElev(this.camera) }) }) // 가용 비율로 동 열 수
      : computeOffice(this._present(), this.rootId, this.layout);
    const oldRooms = this.roomsById;
    const movingRooms = this.sess.afterLayout(lay, now); // 이사 보간: 옮겨 간 사무실은 이전 자리에서 출발
    this.layout = lay;
    this.rooms = lay.rooms;
    this.roomsById = new Map(lay.rooms.map((r) => [r.id, r]));
    this.layoutRoot = lay.rootId;
    for (const r of lay.rooms) r._act = Object.fromEntries(FACILITIES.map((f) => [f, 0]));
    // 방이 옮겨졌으면 시설 예약을 비움
    const moved = new Set();
    for (const r of lay.rooms) { const o = oldRooms.get(r.id); if (o && !movingRooms.has(r.id) && (o.origin.x !== r.origin.x || o.origin.z !== r.origin.z || o.ext !== r.ext)) moved.add(r.id); }
    if (moved.size) for (const id of moved) this.stationUse.delete(id);
    for (const ch of this.chars.values()) {
      const seat = lay.seat.get(ch.id);
      ch.offstage = campus && !seat; // 전체 보기에서 숨긴(recent) 루트 쪽 캐릭터
      if (!seat) continue;
      const room = this.roomsById.get(seat.roomId);
      if (ch.room && (moved.has(room.id) || ch.room.id !== room.id)) {
        if (ch.station) ch.station = null;
        ch.target = null; ch.snapNext = true;
        if (ch.room.id !== room.id) this.stationUse.forEach((m) => m.forEach((arr) => { const i = arr.indexOf(ch.id); if (i >= 0) arr[i] = null; }));
      } else if (ch.seat && (Math.abs(ch.seat.x - seat.x) > 1e-6 || Math.abs(ch.seat.z - seat.z) > 1e-6)) ch.target = null;
      ch.seat = seat; ch.room = room;
      const lead = seat.kind === 'lead';
      if (lead !== ch.lead) { ch.lead = lead; ch.look = null; this._dimLooks.delete(ch.id); } // 회차·손님은 직원(퇴장도 직원처럼)
      if (!ch.placed) {
        if (ch.spawnMode === 'enter') ch.spawnFrom = this._spawnPoint(ch, room);
        else ch.spawnFrom = null;
        if (ch.startAtDoor) { ch.spawnFrom = null; }
      }
    }
    for (const m of this.machines.values()) { m.pos = lay.machine.get(m.id) || null; if (m.type === 'batch') m.info = null; }
    // 띄움 점선: 기동기(복합기) ↔ 띄운 사람 — 자리가 있는 것끼리
    const here = (id) => (this.chars.has(id) && !!lay.seat.get(id)) || (this.machines.has(id) && !!this.machines.get(id).pos);
    this._spawnIds = spawnLinks(this.nodes, here);
    if (this.dir.castShadow) {
      const b = lay.bounds, s = this.dir.shadow.camera;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, R = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 6;
      this.dir.target.position.set(cx, 0, cz); this.dir.position.set(cx + 26, 48, cz + 34);
      s.left = -R; s.right = R; s.top = R; s.bottom = -R; s.near = 1; s.far = 160; s.updateProjectionMatrix();
    }
    this._kidsDirty = true;
    this._syncClusters();
  }

  // ---------------- 전체 보기 ----------------
  setScope(scope = {}) {
    const mode = scope.mode === 'all' ? 'all' : 'session';
    const prevMode = this.scope.mode;
    this.scope = { mode, roots: scope.roots || [], projects: scope.projects || [], showInactive: !!scope.showInactive, focusProject: mode === 'all' ? scope.focusProject || null : null, fadeHide: scope.fadeHide || null };
    this.sess.setProjects(this.scope.projects, mode); // 세션 색
    if (mode === 'all') ensureOverviewCss();
    if (mode === 'session' && prevMode === 'all') { for (const sg of this._signs) { sg.o.visible = false; } this._clusterV.clear(); }
    this.pf.setFocus(this.scope.focusProject, [...this._clusterV.keys()], { instant: !this._clusterV.size || prevMode !== mode }); this.pf.setHidden(mode === 'all' ? scope.fadeHide : null, { instant: !this._clusterV.size || prevMode !== mode }); // //
    this.layoutDirty = true;
    this.staticSig = '';
    this._lblAt = 0;
    if (prevMode !== mode) { this._relayout(this._now); this._syncVis(this._now); }
  }

  /** 그 노드의 프로젝트가 다 사라졌나(그리기·이름표·모니터·연출이 건너뜀). 페이드 중에는 묶음 페이드(BoxBatch.setFade)가 흐리게 그린다 */
  _isDim(id) {
    if (this.scope.mode !== 'all' || !this.layout || !this.layout.projectOf) return false;
    return this.pf.gone(this.layout.projectOf.get(id) || null);
  }
  /** 나가는 중이거나 숨은 프로젝트(클릭·카메라 후보에서 바로 뺌) */
  _isOut(id) {
    if (this.scope.mode !== 'all' || !this.layout || !this.layout.projectOf) return false;
    return this.pf.out(this.layout.projectOf.get(id) || null);
  }
  projAlpha(pid) { return this.scope.mode === 'all' ? this.pf.alpha(pid) : 1; }
  projGone(pid) { return this.scope.mode === 'all' ? this.pf.gone(pid) : false; }
  /** 묶음 밖 연출(띄움 점선·모니터·DOM 칩)이 곱할 그 자리 투명도 — 페이드가 꺼져 있으면 1 */
  _fxA(x, z) { return this._fadeOn ? this._fadeAt(x, z) : 1; }
  /** 세계 (x, z) 의 투명도: 그 자리 동의 프로젝트 값, 어느 동에도 없으면 나가는 동들의 값 */
  _fadeAt(x, z) {
    const bs = this.layout && this.layout.buildings;
    if (!bs) return 1;
    let out = 1;
    for (const b of bs) {
      const g = b.bounds, a = this.pf.alpha(b.projectId);
      if (g && x >= g.minX - 1 && x <= g.maxX + 1 && z >= g.minZ - 1 && z <= g.maxZ + 1) return a;
      if (b.projectId !== this.pf.focus && a < out) out = a;
    }
    return out;
  }
  /** 묶음 페이드 켜기·끄기(전체 보기에서 고른 프로젝트가 있거나 페이드 중일 때만) */
  _syncFade() {
    const on = this.scope.mode === 'all' && !!(this.pf.focus || this.pf.t.size);
    const fn = on ? this._fadeFn : null, bg = this.scene.background && this.scene.background.isColor ? this.scene.background : this.tokens.bg;
    for (const b of [this.sLit, this.sGlow, this.sGlass, this.dLit, this.dGlow]) if (b) b.setFade(fn, bg);
    this._fadeOn = on;
  }

  _syncClusters() {
    const lay = this.layout;
    const keep = new Set();
    if (this.scope.mode === 'all' && lay && lay.buildings) {
      for (const b of lay.buildings) {
        keep.add(b.projectId);
        let e = this._clusterV.get(b.projectId);
        if (!e) { e = { projectId: b.projectId, center: new THREE.Vector3() }; this._clusterV.set(b.projectId, e); }
        e.center.set(b.center.x, 0.8, b.center.z);
        e.r = Math.hypot(b.size.w, b.size.d) / 2;
        e.box = { hw: b.size.w / 2, hd: b.size.d / 2 }; // 동 바닥 상자(카메라 상자 맞춤)
        e.name = b.name; e.active = !!b.active; e.live = !!b.live; e.busy = !!b.busy; e.inactive = !!b.recent; e.temp = !!b.temp;
      }
    }
    for (const k of [...this._clusterV.keys()]) if (!keep.has(k)) this._clusterV.delete(k);
  }

  // ---- 작업 대상 층(사무실 벽 바깥 띠: 서가·금고실·우편함·택배 창구·안테나·결재함). 끄면 객체가 없다 ----
  setArtifacts({ on, book, fx, style } = {}) {
    if (on && !this.vArt && book && fx) {
      this.vArt = new VoxelArt3D(this.scene, this, { book, fx, style });
      import('../art-name3d.js').then((m) => { if (this.vArt && !this.vArt.names && m.NamePlates3D) { this.vArt.names = new m.NamePlates3D(this.vArt.group, this); this.vArt.names.applyTheme(this.vArt.isLight); } }).catch(() => {});
    } else if (!on && this.vArt) { this.vArt.dispose(); this.vArt = null; }
    return !!this.vArt;
  }
  get artOn() { return !!this.vArt; }
  pickArtifact(clientX, clientY) { return this.vArt ? this.vArt.pickAt(clientX, clientY) : null; }
  /** 의뢰인 스크린(사용자 콘솔) 집기 → 주인 메인 id | null · 스크린 가운데(세계) */
  pickConsole(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const id = this.client.consoleAt(clientX - r.left, clientY - r.top, r);
    return id && this.nodes.has(id) && !this._isDim(id) ? id : null;
  }
  consolePos(id) { return this.client.consolePos(id); }
  artPos(pid, id) { return this.vArt ? this.vArt.posOf(pid, id) : null; }
  setArtFoot(pid, nodeId) { if (this.vArt) this.vArt.st.setFoot(pid, nodeId); }
  setArtSelected(t) { if (this.vArt) this.vArt.st.sel = t || null; }

  /** 카메라 맞춤에 방 모서리(바닥·벽 높이)를 더한다 — 2D fitExtra 와 같은 범위 규칙 */
  fitExtra3d(pts, scope = {}) {
    if (this.vArt) this.vArt.fitPoints(pts, scope); // 벽 바깥 가구 띠
    const all = this.scope.mode === 'all';
    const fp = all ? scope.focusProject : null, fsid = all ? scope.focusSession : null;
    for (const r of this.rooms || []) {
      if (!r.bounds || (fp && r.projectId !== fp)) continue;
      if (fsid) { const ov = this.vis.get(r.ownerId); if (!ov || ov.node.rootSessionId !== fsid) continue; }
      const b = r.bounds;
      for (const [x, z] of [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]]) pts.push({ p: { x, y: 0, z }, r: 0.5 }, { p: { x, y: 2.4, z }, r: 0.5 });
    }
  }

  /** [{projectId, name, center:Vector3, r, active, live, busy, inactive}] — 전체 보기가 아니면 [] */
  clusters() { return this.scope.mode === 'all' ? [...this._clusterV.values()] : []; }
  clusterTarget(projectId) { const e = this._clusterV.get(projectId); return e ? { center: e.center, r: e.r, box: e.box || null } : null; } // box: 상자 맞춤
  nodeCluster(id) { return this.layout && this.layout.projectOf ? this.layout.projectOf.get(id) || null : null; }
  /** 화면 좌표 → 건물 projectId(바닥 평면 교차). 캐릭터 pick 이 null 일 때 app 이 부른다 */
  pickCluster(clientX, clientY, opts = {}) {
    const lay = this.layout;
    if (this.scope.mode !== 'all' || !lay || !lay.buildings) return null;
    // opts.pid = 그 동만 + 둘레 여유(프로젝트 영역), 아니면 나가는(숨는) 동은 빼고
    const one = opts.pid ? lay.buildings.find((b) => b.projectId === opts.pid) : null;
    const bs = opts.pid ? (one ? [one] : []) : lay.buildings.filter((b) => !this.pf.out(b.projectId));
    const pad = one ? projectAreaPad((one.bounds.maxX - one.bounds.minX) / 2, (one.bounds.maxZ - one.bounds.minZ) / 2) : 1.5;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    // 바닥(y=0)과 벽 윗면 높이 두 평면으로 본다 — 벽 위를 눌러도 바닥 교차점은 건물 뒤로 빠지므로. 가장자리엔 1.5 여유
    const ray = this.raycaster.ray;
    for (const h of [0, 2.6]) {
      const pl = (this._gplanes || (this._gplanes = new Map())).get(h) || new THREE.Plane(new THREE.Vector3(0, 1, 0), -h);
      this._gplanes.set(h, pl);
      const hit = ray.intersectPlane(pl, this._tmpV);
      const pid = hit ? pickRectAt(bs, hit.x, hit.z, pad) : null;
      if (pid) return pid;
    }
    return null;
  }

  _dimLook(ch) {
    const base = this._look(ch);
    let d = this._dimLooks.get(ch.id);
    if (d && d.src === base) return d.look;
    const bg = this.tokens.bg, k = this.tokens.isLight ? 0.72 : 0.68;
    const f = (c) => (c && c.isColor ? c.clone().lerp(bg, k) : c);
    const look = { ...base };
    for (const key of ['shirt', 'jacket', 'skin', 'hair', 'pants', 'hat', 'mark', 'tie', 'vest', 'stripe', 'cap', 'badge', 'sessVest', 'shirtFront']) look[key] = f(base[key]);
    this._dimLooks.set(ch.id, { src: base, look });
    return look;
  }

  _spawnPoint(ch, room) {
    const n = ch.node;
    if (ch.lead) return n.kind === 'main' || ch.id === this.layoutRoot ? null : room.door.out;
    if (room.type === 'meeting') return room.door.out;
    const p = this.chars.get(n.parentId);
    if (p && p.room === room && room.portal) {
      const atPortal = p.state === 'work' && (p.workCat === 'agent' || p.workCat === 'workflow');
      const opening = p.tools.some((t) => t.end == null && (t.cat === 'agent' || t.cat === 'workflow'));
      if (atPortal || opening) { room._portalUntil = this._now + 1.4; return room.portal.spawn; }
    }
    return room.door.out;
  }

  _stationSpot(ch, cat) {
    const room = ch.room;
    if (!room || !room.stations || !room.stations[cat]) return null;
    const key = cat === 'workflow' ? 'agent' : cat;
    if (ch.station && ch.station.roomId === room.id && ch.station.key === key) return ch.station.spot;
    this._releaseStation(ch);
    let m = this.stationUse.get(room.id);
    if (!m) { m = new Map(); this.stationUse.set(room.id, m); }
    let arr = m.get(key);
    if (!arr) { arr = []; m.set(key, arr); }
    let i = arr.indexOf(null);
    if (i < 0) i = arr.length;
    const spot = stationFor(cat, room, i);
    if (!spot) return null;
    arr[i] = ch.id;
    ch.station = { roomId: room.id, key, idx: i, spot };
    return spot;
  }

  _releaseStation(ch) {
    const s = ch.station;
    if (!s) return;
    ch.station = null;
    const m = this.stationUse.get(s.roomId);
    const arr = m && m.get(s.key);
    if (!arr) return;
    if (arr[s.idx] === ch.id) arr[s.idx] = null;
    while (arr.length && arr[arr.length - 1] == null) arr.pop();
  }

  _computeKids() {
    this._kidsDirty = false;
    const kids = this._kids;
    kids.clear();
    const lay = this.layout;
    if (!lay) return;
    for (const [id] of this.vis) {
      const n = this.nodes.get(id);
      if (!n) continue;
      const ch = this.chars.get(id);
      // 팀장: 그 방 직원·기계 전부
      const roomId = lay.roomOf.get(id);
      const room = roomId && this.roomsById.get(roomId);
      if (ch && ch.lead && room) {
        const arr = [];
        for (const [oid] of this.vis) if (oid !== id && lay.roomOf.get(oid) === roomId) arr.push(oid);
        kids.set(id, arr);
      } else if (this.machines.has(id) && this.machines.get(id).type === 'board') {
        const mr = 'm:' + id;
        const arr = [];
        for (const [oid] of this.vis) if (lay.roomOf.get(oid) === mr && oid !== id) arr.push(oid);
        kids.set(id, arr);
      } else {
        const arr = [];
        for (const [oid, v] of this.vis) if (v.node.parentId === id) arr.push(oid);
        if (arr.length) kids.set(id, arr);
      }
    }
  }

  _syncVis(now) {
    let changed = false;
    for (const ch of this.chars.values()) {
      const show = ch.state !== 'gone' && ch.placed && ch.seat && !ch.offstage;
      let v = this.vis.get(ch.id);
      if (!show) { if (v) { this.vis.delete(ch.id); changed = true; } continue; }
      if (!v) { v = { node: ch.node, target: new THREE.Vector3(), r: 2.0, icons: { size: 0 } }; this.vis.set(ch.id, v); changed = true; }
      v.node = ch.node;
      v.target.set(ch.pos.x, 1, ch.pos.z);
      v.icons.size = (ch.node.openTools || []).length;
    }
    for (const m of this.machines.values()) {
      const show = !m.released && m.pos;
      let v = this.vis.get(m.id);
      if (!show) { if (v) { this.vis.delete(m.id); changed = true; } continue; }
      if (!v) { v = { node: m.node, target: new THREE.Vector3(), r: m.type === 'board' ? 2.4 : m.type === 'batch' ? 1.6 * BATCH.DEVICE_K : m.type === 'job' ? 0.5 : 1.2, icons: { size: 0 } }; this.vis.set(m.id, v); changed = true; }
      v.node = m.node;
      v.target.set(m.pos.x, m.type === 'rack' ? 1 : m.pos.y, m.pos.z);
      v.icons.size = (m.node.openTools || []).length;
    }
    if (changed) this._kidsDirty = true;
  }

  _posOf(id) {
    const ch = this.chars.get(id);
    const p = this._posTmp;
    if ((ch && ch.offstage) || this._isDim(id) || (this._farAll && id !== this.focusId)) return null; // 멀리서 본 전체 보기는 포커스 말풍선만
    if (ch && ch.state !== 'gone' && ch.placed) { p.x = ch.pos.x; p.y = Math.max(ch.headY() + 0.75, this.holo.monTop(ch) + 0.35); p.z = ch.pos.z; return p; }
    const m = this.machines.get(id);
    if (m && m.pos && !m.released) { p.x = m.pos.x; p.y = (m.type === 'rack' ? 2.1 : m.type === 'job' ? m.pos.y + 0.2 : m.pos.y + 0.6); p.z = m.pos.z; return p; }
    return null;
  }

  /**
   * 복장: 역할(office-core roleOf) — 팀장 정장·넥타이(메인 색), 별관 팀장 보라 정장·모자, 팀원 종류 색 셔츠, 기동기 운영자 형광 조끼·모자,
   * 손님 외투, 워크플로 에이전트 목걸이. 사원증 = 세션 색(여러 세션일 때, 팀원은 조끼 앞판도) 아니면 종류 색
   */
  _look(ch) {
    const role = roleOf(ch.kind, ch.seat ? ch.seat.kind : null, ch.lead);
    const sc = this.sess.sessColor(ch.node);
    const sk = sc ? sc.getHexString() : '';
    if (ch.look && ch.look.role === role && ch.look.sk === sk) return ch.look;
    const t = this.tokens, pal = this.pal;
    const kc = this.kindColor(ch.kind).clone();
    const white = new THREE.Color(1, 1, 1);
    const look = { role, sk, skin: pal.skin[ch.hash % 4], hair: pal.hair[(ch.hash >>> 3) % 4], pants: pal.pants, markKind: 'card', mark: null, badge: sc ? sc.clone() : kc.clone(), shirt: kc.clone().lerp(white, 0.12), jacket: null, tie: null, vest: null, stripe: null, cap: null, hat: null, sessVest: null, shirtFront: pal.shirt };
    switch (role) {
      case 'lead': look.jacket = pal.suit.clone(); look.shirt = pal.shirt.clone(); look.tie = this.kindColor('main').clone(); look.pants = pal.suit.clone().multiplyScalar(0.8); look.markKind = 'badge'; break;
      case 'annex': look.jacket = pal.suitP.clone(); look.shirt = pal.shirt.clone(); look.tie = this.kindColor('claude-p').clone(); look.markKind = 'crown'; look.hat = kc.clone().lerp(new THREE.Color(0, 0, 0), 0.25); break;
      case 'operator': look.shirt = pal.coat.clone(); look.vest = pal.vest.clone(); look.stripe = pal.vestStripe.clone(); look.cap = pal.cap.clone(); break;
      case 'guest': look.jacket = pal.coat.clone(); look.shirt = kc.clone(); break;
      case 'wf': look.markKind = 'necklace'; look.mark = this.kindColor('workflow'); if (sc) look.sessVest = sc.clone(); break;
      default: if (sc) look.sessVest = sc.clone();
    }
    void t;
    ch.look = look;
    this._dimLooks.delete(ch.id);
    return look;
  }

  _resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._narrow = w < 720;
  }

  _rebuildStatic() {
    const lay = this.layout;
    const dimRooms = new Set();
    for (const r of this.rooms) {
      if (r.type !== 'office') continue;
      const n = this.nodes.get(r.ownerId);
      if (n && n.kind === 'claude-p' && isEnded(n)) dimRooms.add(r.id);
      if (r.recent) dimRooms.add(r.id); // 끝난(recent) 루트 사무실은 흐리게
      if (r.past) dimRooms.add(r.id);   // 날개(지난 메인) 사무실 = 불 꺼짐
    }
    // 다른 프로젝트는 흐리게(dim) 두지 않고 묶음 페이드(_fadeAt)로 사라진다 — 페이드가 움직이는 동안은 정적 묶음도 매 프레임 다시 그림
    const fp = this.scope.mode === 'all' ? this.scope.focusProject : null;
    const bsig = lay && lay.buildings ? lay.buildings.map((b) => `${b.projectId}@${b.bounds.minX},${b.bounds.minZ},${b.bounds.maxX},${b.bounds.maxZ},${b.recent ? 1 : 0}`).join(';') : '';
    const sig = (this.tokens.isLight ? 'L' : 'D') + '|' + (this._fadeOn ? 'f' + this.pf.ver + ':' + fp : '') + '|' + bsig + '|' + this.rooms.map((r) => `${r.id}@${r.origin.x},${r.origin.z},${r.xf ? r.xf.k : 0},${r.size.d},${r.backDoor ? 1 : 0},${r.leftDoor},${r.desks.length},${r.desks.filter((d) => d.aux).map((d) => d.x + ':' + d.z).join(';')},${dimRooms.has(r.id) ? 1 : 0}`).join('|') + '|' + (lay ? lay.corridors.length : 0) + '|' + this.sess.staticSig();
    if (sig === this.staticSig) return;
    this.staticSig = sig;
    const b = this._statB;
    b.lit.begin(); b.glow.begin();
    if (lay && lay.buildings) for (const bd of lay.buildings) this._buildBuilding(bd, b, false);
    if (lay) {
      for (const c of lay.corridors) buildCorridor(c, this.pal, b);
      for (const r of this.rooms) buildRoomStatic(r, this.pal, b, { dim: dimRooms.has(r.id), band: this.sess.bandColor(r) });
      this.sess.buildStatic(b, fp); // 라운지·세션 색 카펫
    }
    b.lit.end(); b.glow.end();
    this._dimRooms = dimRooms;
  }

  /** 동 바닥판(한 단 높은 보도) · recent 동은 지붕 덮은 낮은 상자(창 불 꺼짐) */
  _buildBuilding(bd, b, dim) {
    const L = b.lit, pal = this.pal;
    const k = dim ? pal.dimFactor : 1;
    const C = (c) => (dim ? this._c.copy(c).multiplyScalar(k) : c);
    const g = bd.bounds, cx = (g.minX + g.maxX) / 2, cz = (g.minZ + g.maxZ) / 2, w = g.maxX - g.minX, d = g.maxZ - g.minZ;
    L.box(cx, -0.2, cz, w, 0.24, d, C(pal.trim));
    L.box(cx, -0.09, cz, w - 0.4, 0.04, d - 0.4, C(pal.corridor));
    if (!bd.recent) return;
    const iw = w - 2 * 2.4, id = d - 2 * 2.4;
    L.box(cx, 1.3, cz, iw, 2.6, id, C(pal.wall));
    L.box(cx, 2.72, cz, iw + 0.8, 0.24, id + 0.8, C(pal.wallTop));
    const n = Math.max(2, Math.floor(iw / 3.2));
    for (let i = 0; i < n; i++) {
      const x = cx - iw / 2 + (iw / n) * (i + 0.5);
      L.box(x, 1.45, cz + id / 2 + 0.03, 1.5, 0.9, 0.06, C(pal.screenOff));
    }
    L.box(cx + iw / 2 - 2.2, 1.0, cz + id / 2 + 0.03, 1.4, 2.0, 0.08, C(pal.woodDark));
  }

  _frame() {
    if (this._disposed) return;
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0.0001, now - this._last));
    this._last = now; this._now = now;
    if (this.scope.mode === 'all' && this.layout && this.layout.campus && now - (this._packChk || 0) > 0.5) { this._packChk = now; if (packStale(this.layout, packView(this.container, { prefs: this.cameraPrefs }))) this.layoutDirty = true; }
    if (this.layoutDirty && now - this.lastLayout > 0.15) this._relayout(now);
    if (this.sess.stepMoves(now)) this._layoutVer++; // 이사 보간(정적 서명이 바뀌면 다시 그림) — 바닥 라인도 다시
    this.client.step(now); // 의뢰인 창구: 팀장 심부름·카드 읽기
    this.procs.step(now, dt); // 들여다보기 → 직원 심부름 · 생산 라인 장부(상자·팔레트·지게차)
    this.pf.step(dt); this._syncFade(); // 프로젝트 페이드
    this._rebuildStatic();
    this.sess.stepConflicts(now); // 충돌 → 직원 캐비닛 방문

    // 퇴장한 캐릭터·끝난 기계의 자리 반납
    for (const ch of this.chars.values()) {
      if (ch.state === 'gone' && !ch.released) {
        if (ch.heldUntil == null) ch.heldUntil = now + this._hold();
        if (now >= ch.heldUntil) { ch.released = true; this.layoutDirty = true; }
      }
    }
    for (const m of this.machines.values()) {
      if (!m.released && m.endWall != null && now >= m.heldUntil) { m.released = true; this.layoutDirty = true; }
    }

    // 캐릭터 상태 머신
    const ctx = this._ctx;
    ctx.now = now; ctx.dt = dt; ctx.ts = this.ts;
    for (const ch of this.chars.values()) {
      if (ch.state === 'gone' || !ch.seat || !ch.room) continue;
      ctx.room = ch.room; ctx.seat = ch.seat;
      if (ch.startAtDoor && !ch.placed) { ch.placed = true; ch.placeAt(ch.room.door, Math.PI + xfAngle(ch.room.xf)); ch.state = 'seated'; ch.target = { key: 'door', type: 'door', spot: ch.room.door }; }
      if (ch.spawnMode === 'enter' && !ch.placed && !ch.spawnFrom) ch.appearT0 = now;
      ch.update(ctx);
    }
    // 제거된 노드: 다 나간 직원·꺼진 기계는 이제 지운다
    if (this._removing.size) for (const id of [...this._removing]) {
      const ch = this.chars.get(id), m = this.machines.get(id);
      if ((ch && ch.state === 'gone') || (m && m.released) || (!ch && !m)) this._dropNode(id);
    }
    this._syncVis(now);

    // 시설 활동도
    for (const r of this.rooms) { const a = r._act; for (const f of FACILITIES) a[f] = 0; if (r._portalUntil && r._portalUntil > now) a.portal = 1; }
    for (const ch of this.chars.values()) {
      if (ch.state !== 'work' || !ch.room || !ch.target || ch.target.type !== 'station') continue;
      const f = CAT_FACILITY[ch.workCat];
      if (f && ch.room._act) ch.room._act[f] = 1;
    }

    this._drawDynamic(now, dt);
    this.holo.update(now, dt, this.camera, this.container.clientHeight || 1);
    this._drawSpawnLinks();
    if (this.vArt) this.vArt.update(now); // 작업 대상 층(켤 때만)

    // 말풍선·이름표
    this._labelPass(now);

    if (this.onFrame) this.onFrame(dt, now);
    const camDist = this.camera.position.distanceTo(this._tmpV.set(0, 0, 0));
    const fd = this.focusDist || camDist;
    this.scene.fog.near = Math.max(60, fd * 1.3);
    this.scene.fog.far = Math.max(220, fd * 3.6);
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  /** 띄움 점선: 테마 토큰 link-spawn 을 배경 쪽으로 섞어 옅게, 흐름 패킷 없음 */
  _drawSpawnLinks() {
    const ids = this._spawnIds || [];
    if (!this._spawn) {
      if (!ids.length) return;
      const n = SPAWN_CAP * SPAWN_DASH.length * 2 * 3;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n), 3).setUsage(THREE.DynamicDrawUsage)); // 줄마다 페이드
      const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false });
      const o = new THREE.LineSegments(geo, mat); o.frustumCulled = false; o.renderOrder = 3;
      this.scene.add(o); this._spawn = o;
    }
    const o = this._spawn, P = o.geometry.attributes.position.array, C = o.geometry.attributes.color.array;
    const bg = this.scene.background && this.scene.background.isColor ? this.scene.background : this.tokens.bg;
    const base = this._spC || (this._spC = new THREE.Color()), lc = this._spL || (this._spL = new THREE.Color());
    base.copy(this.tokens['link-spawn']).lerp(this.tokens.bg, 0.2);
    const at = (id, out) => {
      const ch = this.chars.get(id);
      if (ch) { if (!ch.pos || ch.state === 'gone' || ch.offstage || this._isDim(id)) return false; out[0] = ch.pos.x; out[1] = 0.9; out[2] = ch.pos.z; return true; }
      const m = this.machines.get(id);
      if (m && m.pos && !m.released && !this._isDim(id)) { out[0] = m.pos.x; out[1] = 1.2; out[2] = m.pos.z; return true; }
      return false;
    };
    const a = this._spA || (this._spA = [0, 0, 0]), b = this._spB || (this._spB = [0, 0, 0]);
    let k = 0;
    for (const [lid, sid] of ids) {
      if (k >= SPAWN_CAP) break;
      if (!at(sid, a) || !at(lid, b)) continue;
      const fa = Math.min(this._fxA(a[0], a[2]), this._fxA(b[0], b[2])); // 프로젝트 페이드(배경 쪽으로 섞음)
      if (fa <= 0) continue;
      lc.copy(base); if (fa < 1) lc.lerp(bg, 1 - fa);
      for (let d = 0; d < SPAWN_DASH.length; d++) {
        const [u0, u1] = SPAWN_DASH[d], q = (k * SPAWN_DASH.length + d) * 6;
        for (let j = 0; j < 3; j++) { P[q + j] = a[j] + (b[j] - a[j]) * u0; P[q + 3 + j] = a[j] + (b[j] - a[j]) * u1; }
        C[q] = C[q + 3] = lc.r; C[q + 1] = C[q + 4] = lc.g; C[q + 2] = C[q + 5] = lc.b;
      }
      k++;
    }
    o.geometry.setDrawRange(0, k * SPAWN_DASH.length * 2);
    if (k) { o.geometry.attributes.position.needsUpdate = true; o.geometry.attributes.color.needsUpdate = true; }
    o.visible = k > 0;
  }

  _drawDynamic(now, dt) {
    const B = this._dynB, L = B.lit, G = B.glow;
    const t = now, tok = this.tokens, pal = this.pal;
    L.begin(); G.begin();
    for (const r of this.rooms) drawFacilities(r, r._act, pal, tok, t, B, this._dimRooms && this._dimRooms.has(r.id));
    // 스탠딩 데스크 홀로그램 발광대(돌린 방은 회전 전 좌표로 그려 xf 로 옮김) — 모니터 자체는 vx-holo.js
    for (const r0 of this.rooms) {
      const r = roomFrame(r0, B);
      if (r.leadDesk) {
        const lead = this.chars.get(r.ownerId);
        const n = this.nodes.get(r.ownerId);
        const st = !lead || (n && isEnded(n) && n.kind === 'claude-p') ? 'off' : this._deskState(lead, now);
        drawDeskEmitter(G, r.leadDesk, true, st, this._emitCol(lead), pal, lead ? lead._monK || 0 : 0);
      }
      for (const d of r.desks) {
        if (!d.occupant) continue;
        const ch = this.chars.get(d.occupant);
        if (!ch || ch.state === 'gone' || ch.state === 'leave') continue;
        drawDeskEmitter(G, d, false, this._deskState(ch, now), this._emitCol(ch), pal, ch._monK || 0);
      }
      endXf(B);
    }
    // 업무 흐름: 바닥 조명 라인·흐르는 대시·빛 패킷
    this.flow.draw(G, now);
    // 탕비실 커피 머신 김(쉬는 사람이 있으면)
    for (const r of this.rooms) r._brew = false;
    for (const ch of this.chars.values()) if (ch.room && ch.target && ch.target.type === 'break' && ch.state !== 'walk') ch.room._brew = true;
    // 기계
    const clockMs = this.clock();
    for (const m of this.machines.values()) {
      if (m.released || !m.pos) continue;
      if (m.type === 'job') { this._drawJob(m, now, clockMs, B); continue; } // 현황판 카드
      if (m.pos.type === 'proc') continue; // 생산 라인은 아래 procs.drawAll
      const st = this._mst || (this._mst = { status: '', flash: 0, t: 0, seed: 0, id: null, appear: 1, members: 0, doneMembers: 0 });
      st.status = m.node.status; st.t = t; st.seed = m.seed; st.id = m.id;
      st.flash = Math.max(0, Math.min(1, (m.flashUntil - now) / 0.35));
      st.appear = m.appearT0 != null ? Math.min(1, Math.max(0.02, (now - m.appearT0) / 0.5)) : 1;
      if (m.type === 'batch') {
        if (!m.info) m.info = deviceInfo(m.node, this.nodes);
        const cur = m.info.currentId ? this.nodes.get(m.info.currentId) : null;
        st.band = m.info.band; st.running = m.info.running;
        st.progress = cur ? cycleProgress(m.info, cur, this.clock()) : null;
      }
      if (m.type === 'board') {
        let a = 0, d = 0;
        for (const ch of this.chars.values()) if (ch.node.parentId === m.id) { a++; if (isEnded(ch.node)) d++; }
        st.members = a; st.doneMembers = d;
      }
      const mr = this.roomsById && this.roomsById.get(m.pos.roomId);
      if (mr && mr.xf && mr.xf.k && mr.local) { // 돌린 방의 기계: 회전 전 자리에 그려 xf 로 옮김(앞면이 방 안쪽을 봄)
        roomFrame(mr, B);
        const lp = toLocal(mr.xf, m.pos.x, m.pos.z), q = this._mlp || (this._mlp = {});
        Object.assign(q, m.pos); q.x = lp.x; q.z = lp.z;
        drawMachine(q, st, pal, tok, B, this.kindColor(m.node.kind));
        endXf(B);
      } else drawMachine(m.pos, st, pal, tok, B, this.kindColor(m.node.kind));
      if (m.id === this.focusId || m.id === this.hoverId) ring(G, m.pos.x, 0.04, m.pos.z + (m.type === 'rack' ? 0.6 : 0), 0.9, 12, tok.text, 0.12);
    }
    // 캐릭터
    const fx = this._fx;
    fx.t = t; fx.now = now; fx.skill = tok.skill; fx.error = tok.error; fx.ok = tok.ok; fx.text = tok.text;
    fx.mugC = pal.mug; fx.coffeeC = pal.coffee; fx.bagC = pal.bag; fx.shoeC = pal.shoe; fx.cardC = pal.paper;
    const scoped = this.scope.mode === 'all';
    const far = !!this._farAll, cp = this.camera.position;
    for (const ch of this.chars.values()) {
      if (ch.state === 'gone' || !ch.placed || ch.offstage) continue;
      const n = ch.node;
      // 먼 캐릭터는 두 상자(LOD) — 전체 보기에서 멀리 볼 때
      const lod = far || (scoped && Math.hypot(ch.pos.x - cp.x, cp.y, ch.pos.z - cp.z) > 150);
      if (scoped && this._isDim(ch.id)) continue; // 다 사라진 프로젝트(페이드 중에는 묶음 페이드가 흐리게)
      if (false) {
        fx.focus = false; fx.hover = false; fx.metaSkill = false; fx.doneLead = ch.lead && isEnded(n); fx.idle = true; fx.catColor = tok.skill; fx.monK = 0;
        if (lod) drawCharacterFar(ch, this._dimLook(ch), fx, L); else drawCharacter(ch, this._dimLook(ch), fx, L, G);
        continue;
      }
      fx.monK = ch._monK || 0;
      if (lod && ch.id !== this.focusId) { drawCharacterFar(ch, this._look(ch), fx, L); continue; }
      fx.focus = ch.id === this.focusId; fx.hover = ch.id === this.hoverId;
      fx.metaSkill = !!(n.meta && n.meta.skill) && ch.state !== 'leave';
      fx.doneLead = ch.lead && isEnded(n);
      fx.idle = n.status === 'idle';
      fx.catColor = ch.workCat === 'skill' ? tok.skill : this.kindColor('main');
      drawCharacter(ch, this._look(ch), fx, L, G);
    }
    this.procs.drawAll(B, now);    // 분리 프로세스 생산 라인·전광판·들여다보기 빛줄
    this.sess.drawDynamic(B, now); // 캐비닛 경고등·창·서류 더미·종이비행기
    this.ix.draw(B, now);          // 특별 상호작용 은유(발송대·문서고·부스·컨베이어·신호등)
    this.client.draw(B, now);      // 의뢰인 창구
    this.client._overlay();        // 스크린 이름표·집기 사각형
    // 효과
    if (this.effects.length) {
      let w = 0;
      for (let i = 0; i < this.effects.length; i++) {
        const e = this.effects[i];
        const k = (now - e.t0) / e.dur;
        if (k >= 1) continue;
        this.effects[w++] = e;
        this._drawFx(e, Math.max(0, k), G);
      }
      this.effects.length = w;
    }
    L.end(); G.end();
  }

  /** 작업 카드 한 장(주인 기계 옆 현황판) — 색·정체는 렌더러 시계(재생 = 가상 시계) */
  _drawJob(m, now, clockMs, B) {
    if (m.pos.procBoard) return; // 자동 진행 작업 = 생산 라인 전광판(vx-procs.js)
    if (this.scope.mode === 'all' && this._isDim(m.id)) return;
    const st = this._jst || (this._jst = { id: null, model: null, flash: 0, appear: 1, focus: false, ownerColor: null, seed: 0 });
    st.id = m.id; st.seed = hashStr(m.id) % 97;
    st.model = jobCardModel(m.node, clockMs, now, this.reduced);
    st.flash = Math.max(0, Math.min(1, (m.flashUntil - now) / 0.35));
    st.appear = m.appearT0 != null ? Math.min(1, Math.max(0.02, (now - m.appearT0) / 0.5)) : 1;
    st.focus = m.id === this.focusId || m.id === this.hoverId;
    const on = this.nodes.get(m.pos.owner);
    st.ownerColor = on ? this.kindColor(isLauncher(on) ? 'bash-bg' : KNOWN.has(on.kind) ? on.kind : 'subagent') : null;
    // 판은 카메라 쪽으로 조금 돈다(양면 카드 — 뒤에서 봐도 앞면처럼)
    const cp = this.camera.position;
    st.yaw = jobBoardYaw(m.pos.face || 0, Math.atan2(cp.x - m.pos.x, cp.z - m.pos.z));
    const mr = this.roomsById && this.roomsById.get(m.pos.roomId);
    if (mr && mr.xf && mr.xf.k && mr.local) { // 돌린 방: 회전 전 자리에 그려 xf 로 옮김
      roomFrame(mr, B);
      const lp = toLocal(mr.xf, m.pos.x, m.pos.z), q = this._jlp || (this._jlp = {});
      Object.assign(q, m.pos); q.x = lp.x; q.z = lp.z; q.face = (m.pos.face || 0) - xfAngle(mr.xf);
      st.yaw -= xfAngle(mr.xf);
      drawJobCard(q, st, this.pal, this.tokens, B);
      endXf(B);
    } else drawJobCard(m.pos, st, this.pal, this.tokens, B);
  }

  /**
   * 작업 이름표: 끝나지 않은 작업은 늘, 끝난 것은 포커스·호버 때만. 한 줄(상태 점 · 이름 · 꼬리표), 단계는 포커스·호버 때 둘째 줄.
   * 자리 = 판 맨 아래 바로 밑(같은 판의 이름표는 라벨 배치가 아래로 차례로 민다)
   */
  _jobLabel(m, put, fid, hid, clockMs) {
    if (m.released || !m.pos || this._isDim(m.id) || (this._farAll && m.id !== fid && m.id !== hid)) return;
    const n0 = m.node, isF = m.id === fid || m.id === hid;
    if (!isF && (m.pos.procBoard || !jobLabelAlways(n0, clockMs))) return; // 전광판은 판 자체가 이름표
    const job = jobOf(n0);
    const md = jobCardModel(n0, clockMs, 0);
    const key = md ? md.key : 'running';
    const tags = nodeTags(n0, this.nodes, clockMs);
    const tg = tags.length ? `<span class="ntags">${tags.map((x) => `<i>${esc(x)}</i>`).join('')}</span>` : '';
    const ph = isF && job && job.phase ? `<span class="ntitle">${esc(trunc(job.phase, 40))}</span>` : '';
    const y = m.pos.y - m.pos.slot * JOBCARD.PITCH - JOBCARD.PITCH / 2 - 0.04; // 판 맨 아래 바로 밑
    put(m.id, `<span class="jrow"><b class="jdot"></b>${esc(trunc(n0.label || n0.id, 22))}${tg}</span>${ph}`, `machine job j-${key}` + (isF ? ' focus' : ''), m.pos.x, y, m.pos.z, null, true);
  }

  /** 생산 라인 이름표: 라인 앞 바닥(이름 · 꼬리표 정체·rc·들여다봄 N), 포커스·호버면 종류·상태 */
  _procLabel(m, put, fid, hid) {
    if (this._isDim(m.id) || (this._farAll && m.id !== fid && m.id !== hid)) return;
    const n0 = m.node, isF = m.id === fid || m.id === hid;
    const tags = nodeTags(n0, this.nodes, this.clock());
    const tg = tags.length ? `<span class="ntags">${tags.map((x) => `<i>${esc(x)}</i>`).join('')}</span>` : '';
    const sub = isF ? `<small>${esc((KIND_LABEL[n0.kind] || n0.kind) + ' · ' + (STATUS_LABEL[n0.status] || ''))}</small>` : '';
    const room = this.roomsById && this.roomsById.get(m.pos.roomId);
    const a = xfAngle(room && room.xf && room.local ? room.xf : null);
    put(m.id, esc(trunc(n0.label || n0.id, 26)) + tg + sub, 'machine proc' + (isF ? ' focus' : ''), m.pos.x + Math.sin(a) * 0.95, 0.02, m.pos.z + Math.cos(a) * 0.95, null, true);
  }

  _deskState(ch, now) {
    if (!ch) return 'off';
    if (ch.flashUntil > now) return 'flash';
    return (ch._monK || 0) > 0.05 || (ch.atDesk() && ch.state === 'work') ? 'on' : 'dim';
  }
  /** 발광대 색 = 지금 도구 종류 색(없으면 종류 색) */
  _emitCol(ch) {
    if (!ch) return this.kindColor('main');
    return ch._monCat ? this.holo._cat(ch._monCat) : this.kindColor(ch.kind);
  }

  _fxPos(ref, out) {
    if (ref && ref.isVector3) { out.copy(ref); return true; }
    const v = this.vis.get(ref);
    if (!v) return false;
    out.copy(v.target);
    return true;
  }

  _drawFx(e, k, G) {
    const p = this._tmpV;
    if (e.type === 'ring') {
      if (!this._fxPos(e.id, p)) return;
      ring(G, p.x, 0.05, p.z, e.r0 + k * e.r1, 12, e.color, 0.14 * (1 - k) + 0.03);
    } else if (e.type === 'beam') {
      if (!this._fxPos(e.id, p)) return;
      const H = 5; // 9 → 5: 가까운 카메라에서도 화면을 덮지 않게(폭도 0.35 → 0.22)
      const head = Math.min(1, k / 0.35);
      const len = H * head;
      const top = p.y + 0.8 + H;
      const w = 0.22 * (1 + (1 - k) * 0.5) * (k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65);
      G.box(p.x, top - len / 2, p.z, w, Math.max(0.01, len), w, e.color);
      if (k > 0.3) ring(G, p.x, 0.05, p.z, 0.4 + (k - 0.3) * 1.6, 12, e.color, 0.12);
    } else if (e.type === 'orb') {
      const a = this._orbA || (this._orbA = new THREE.Vector3()), b = this._orbB || (this._orbB = new THREE.Vector3()); // _fxA 는 페이드 메서드(이름 겹침 수리)
      if (!this._fxPos(e.from, a) || !this._fxPos(e.to, b)) return;
      const u = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const s = 0.26 * (1 - k * 0.4);
      G.box(a.x + (b.x - a.x) * u, a.y + 0.6 + (b.y - a.y) * u + Math.sin(k * Math.PI) * 2.2, a.z + (b.z - a.z) * u, s, s, s, e.color, k * 6);
    }
  }

  _labelPass(now) {
    const fid = this.focusId, hid = this.hoverId;
    // 문구(HTML)는 0.2초마다·포커스/호버가 바뀔 때만 다시 만들고, 위치는 매 프레임 따라간다
    if (now - (this._lblAt || 0) < 0.2 && this._lblF === fid && this._lblH === hid && this._lblUsed) {
      for (const L of this._lblUsed) { const r = L.ref; if (r && r.pos && !L.fixed) { L.x = r.pos.x; L.z = r.pos.z + (r.type ? 0.6 : 0.55); } }
      const bc = this._bubCtx;
      bc.now = now; bc.narrow = this._narrow || !!this._farAll; bc.focusId = fid; bc.hoverId = hid;
      bc.width = this.container.clientWidth || 1; bc.height = this.container.clientHeight || 1;
      this.bubbles.update(bc);
      return;
    }
    this._lblAt = now; this._lblF = fid; this._lblH = hid;
    const labels = this._labels;
    let n = 0;
    const lay = this.layout;
    const put = (id, html, cls, x, y, z, ref = null, fixed = false) => {
      if (n >= labels.length) return;
      const L = labels[n++];
      L.id = id; L.html = html; L.text = ''; L.cls = cls; L.x = x; L.y = y; L.z = z; L.ref = ref; L.fixed = fixed;
    };
    // 팀장 > 포커스 > 호버
    for (const ch of this.chars.values()) {
      if (ch.state === 'gone' || !ch.placed || ch.offstage || this._isDim(ch.id)) continue;
      const isF = ch.id === fid, isH = ch.id === hid;
      const n0 = ch.node;
      // 팀장 말고도 이름표: 진행 중 회차(장치 앞 작업자)·독립 claude -p(대기석·외부 작업) — 꼬리표와 함께
      const named = ch.lead || (n0.meta && n0.meta.orphanSdk) || (ch.kind === 'claude-p' && !isEnded(n0) && isCycle(n0, this.nodes));
      if ((!named || this._farAll) && !isF && !isH) continue;
      const name = esc(trunc(n0.label || n0.id, 16));
      const sub = isF || isH ? `<small>${esc((KIND_LABEL[ch.kind] || ch.kind) + ' · ' + (STATUS_LABEL[n0.status] || n0.status || ''))}</small>` : '';
      const stt = nodeSubtitle(n0); // 자동 제목 부제: 세션(팀장)·claude -p 이름표 아래 흐린 한 줄
      const stH = stt ? `<span class="ntitle">${esc(trunc(stt, 40))}</span>` : '';
      const tags = ch.lead && !(n0.meta && n0.meta.orphanSdk) ? EMPTY : nodeTags(n0, this.nodes, this.clock());
      const tgH = tags.length ? `<span class="ntags">${tags.map((x) => `<i>${esc(x)}</i>`).join('')}</span>` : '';
      put(ch.id, name + stH + tgH + sub, (named ? 'lead' : '') + (isF ? ' focus' : ''), ch.pos.x, 0.02, ch.pos.z + 0.55, ch);
    }
    const clockMs = this.clock();
    // 작업 이름표: 판마다 아래 칸부터(같은 기준점이라 라벨 배치가 이 순서로 아래로 민다)
    const jl = this._jlList || (this._jlList = []);
    jl.length = 0;
    for (const m of this.machines.values()) if (m.type === 'job' && m.pos && !m.released) jl.push(m);
    jl.sort((a, b) => (a.pos.owner < b.pos.owner ? -1 : a.pos.owner > b.pos.owner ? 1 : a.pos.slot - b.pos.slot));
    for (const m of jl) this._jobLabel(m, put, fid, hid, clockMs);
    for (const m of this.machines.values()) {
      const batch = m.type === 'batch';
      if (m.type === 'job') continue;
      if (m.pos && m.pos.type === 'proc' && !m.released) { this._procLabel(m, put, fid, hid); continue; } // 생산 라인 이름표(늘)
      if (m.released || !m.pos || (m.id !== fid && m.id !== hid && !batch)) continue;
      if (batch && (this._isDim(m.id) || (this._farAll && m.id !== fid && m.id !== hid))) continue;
      const n0 = m.node;
      if (batch) {
        // 배치 장치는 늘: 이름 · 꼬리표(이어받음) · 회차 집계
        if (!m.info) m.info = deviceInfo(n0, this.nodes);
        const tags = nodeTags(n0, this.nodes, this.clock());
        const spt = spawnTag(n0); if (spt) tags.push(spt); // 띄움 꼬리표
        const tg = tags.length ? `<span class="ntags">${tags.map((x) => `<i>${esc(x)}</i>`).join('')}</span>` : '';
        put(m.id, esc(trunc(n0.label || n0.id, 20)) + tg + `<small class="ndev">${esc(deviceSummary(m.info))}</small>`, 'machine batch' + (m.id === fid || m.id === hid ? ' focus' : ''), m.pos.x - 0.6 * BATCH.DEVICE_K, 1.9 * BATCH.DEVICE_K, m.pos.z - 0.6 * BATCH.DEVICE_K, null, true); // 장치 위·뒤(팀장 이름표와 겹치지 않게)
        continue;
      }
      put(m.id, esc(trunc(n0.label || n0.id, 16)) + `<small>${esc((KIND_LABEL[n0.kind] || n0.kind) + ' · ' + (STATUS_LABEL[n0.status] || '') + (m.standby ? ' · ' + _t('scene.standby') : ''))}</small>`, 'machine focus', m.pos.x, 0.02, m.pos.z + 0.6, null, true);
    }
    // 퇴장 뒤 자리 이름표(회색, 반납 전까지)
    if (lay && !this._farAll) for (const ch of this.chars.values()) {
      if (ch.state !== 'gone' || ch.released || !ch.seat || ch.offstage || this._isDim(ch.id)) continue;
      put(ch.id + '#g', esc(trunc(ch.node.label || ch.id, 16)), 'gone', ch.seat.deskX, 0.8, ch.seat.deskZ, null, true);
    }
    for (let i = n; i < labels.length; i++) labels[i].id = null;
    const used = this._lblUsed = labels.slice(0, n); // 길이 ≤ 24
    // 방 문패(전체 보기에서 멀리서 볼 때는 동 간판만)
    const rl = this._roomLabels;
    let k = 0;
    const farAll = this.scope.mode === 'all' && (this.focusDist || 0) > 240;
    this._farAll = farAll;
    for (const r of (farAll ? EMPTY : this.rooms)) {
      if (k >= rl.length) break;
      const owner = this.nodes.get(r.ownerId);
      const name = esc(trunc(owner ? owner.label || owner.id : r.id, 22));
      const isMain = lay && lay.roots ? lay.roots.has(r.ownerId) : r.ownerId === this.layoutRoot;
      const roomKey = r.type === 'meeting' ? 'meeting' : r.external ? 'external' : r.recent ? 'past' : isMain ? 'office' : 'annex';
      const L = rl[k++];
      // 같은 프로젝트 live 메인 여럿: 문패 = 세션 색 + git 브랜치/worktree + 그 세션 컨텍스트
      const si = r.type === 'office' && isMain && !r.past ? this.sess.sessIdx(owner) : null;
      const sb = si != null ? sessBadgeHtml(si, owner.meta && owner.meta.ctx, branchOf(owner)) : '';
      const kn = _t('scene.room.' + (r.past && roomKey === 'office' ? 'past' : roomKey));
      L.id = r.id; L.html = r.external ? `<b>${kn}</b> · ${esc(trunc(r.projectName || _t('scene.room.standalone'), 22))}` : `<b>${kn}</b> · ${name}${sb}`; L.cls = (this._dimRooms && this._dimRooms.has(r.id) ? 'dim' : '') + (si != null ? ` sess s${si}` : '');
      if (r.lounge && r.door && r.door.out) { // 라운지 둘레 사무실: 문패 = 문 위(문 밖 쪽으로 조금)
        const ox = r.door.out.x - r.door.x, oz = r.door.out.z - r.door.z, n = Math.hypot(ox, oz) || 1;
        L.x = r.door.x + (ox / n) * 0.9; L.z = r.door.z + (oz / n) * 0.9; L.y = 2.7;
      } else { L.x = r.bounds.minX + 0.3; L.z = r.bounds.maxZ + 1.1; L.y = null; }
    }
    const bc = this._bubCtx;
    bc.now = now; bc.narrow = this._narrow || farAll; bc.focusId = fid; bc.hoverId = hid;
    this._updateSigns();
    this.sess.updateCabLabels(); // 캐비닛 말풍선(파일명)
    bc.labels = used; bc.rooms = this._lblRooms = rl.slice(0, k);
    bc.width = this.container.clientWidth || 1; bc.height = this.container.clientHeight || 1;
    this.bubbles.update(bc);
  }
}

VoxelView.prototype._updateSigns = function () {
  const lay = this.layout;
  const list = this.scope.mode === 'all' && lay && lay.buildings ? lay.buildings : [];
  const fp = this.scope.focusProject;
  while (this._signs.length < Math.min(list.length, 24)) {
    const el = document.createElement('div');
    el.className = 'ov-bldg';
    const o = new CSS2DObject(el);
    o.center.set(0.5, 0);
    this.scene.add(o);
    this._signs.push({ o, el, html: '', cls: '' });
  }
  for (let i = 0; i < this._signs.length; i++) {
    const sg = this._signs[i], b = list[i];
    if (!b) { if (sg.o.visible) sg.o.visible = false; continue; }
    const html = islandLabelHtml({ ...b, inactive: b.recent, mains: b.offices });
    if (html !== sg.html) { sg.el.innerHTML = html; sg.html = html; }
    const cls = 'ov-bldg' + (b.recent ? ' inactive' : '') + (fp === b.projectId ? ' focus' : '');
    if (cls !== sg.cls) { sg.el.className = cls; sg.cls = cls; }
    if (sg.el.dataset.pid !== b.projectId) sg.el.dataset.pid = b.projectId;
    sg.o.position.set((b.bounds.minX + b.bounds.maxX) / 2, 0.1, b.bounds.maxZ + 1.6);
    // 다른 프로젝트 간판은 페이드 아웃 → 숨김(pickLabelAt 에서도 빠짐)
    const fa = this.pf.alpha(b.projectId), op = fa < 1 ? (Math.round(fa * 20) / 20).toFixed(2) : '';
    if (sg.el.style.opacity !== op) sg.el.style.opacity = op;
    const show = !this.pf.gone(b.projectId);
    if (sg.o.visible !== show) sg.o.visible = show;
  }
};

const EMPTY = Object.freeze([]);

function toColor(c) {
  if (!c) return new THREE.Color(1, 1, 1);
  if (c.isColor) return c.clone();
  return new THREE.Color(c);
}
