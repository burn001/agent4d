// 복셀 오피스 2D(저사양) = 위에서 본 사무실 평면도.
// 배치는 3D 복셀과 같은 순수 함수(voxel/layout.js computeOffice · voxel/campus.mjs computeCampus), 캐릭터 상태 머신도 같은
// voxel/character-core.mjs(자리 ⇄ 시설 걷기·퇴장 때 문으로 걸어 나감·재개 때 문으로 들어옴)를 쓰고, 그림만 평면으로:
//   방(바닥·벽·출입문 틈·별관 통로·회의실 옆문) · 팀장 책상(메인 = 상급자 자리)·직원 책상(화면 줄: 작업 중 밝게)·의자 · 회의실 탁자·화이트보드 ·
//   시설(책장·서류함·게시판·도구함·안테나·터미널·외부 단말·모니터 벽·포털·알림 벨, 쓰는 중이면 종류 색 테두리) ·
//   서버랙(백그라운드 명령)·모니터 화면(Monitor)·복합기(배치 장치: 진행 표시창·표시등·상태 띠 5칸) · 작업석·대기석 의자 ·
//   '외부 작업' 방·'지난 사무실' 흐림 · 전체 보기 동 바닥판·간판 · 퇴장 뒤 자리 회색 이름(반납 전까지) · 방 문패.
// 캐릭터 = 종류 색 원 + 바라보는 쪽 점 + 팀장 금색 테두리·claude -p 네모 표식, 이름표는 DOM(.node-label, 바탕 라벨 규칙).
// 말풍선·도구 카드는 책상 옆(공용 flat-draw.js). 카메라는 Director2D 그대로(평면도 위 팬·줌, 맞춤에 방 모서리 포함).
import { VoxelArt2D } from './art-layer2d.js'; // 작업 대상 층(켤 때만 만든다)
import { FlatView, displayKind } from './flat-view.js';
import { paletteOf } from '../flowview/flow-style.mjs';
import { computeOffice, stationFor, CAT_FACILITY } from '../voxel/layout.js';
import { computeCampus } from '../voxel/campus.mjs';
import { packView, packStale } from '../overview/pack-view.js';
import { Character, crewSpots } from '../voxel/character-core.mjs';
import { DARK, LIGHT, SKIN } from '../voxel/palette-hex.mjs';
import { BATCH, batchFold, isLauncher, isCycle, rearmStandby } from '../batch-core.mjs';
import { isJob, jobOf, jobLabelKey } from '../job-core.mjs'; // 작업 노드
import { JOBCARD, jobCardModel, jobFlatPos, jobLabelAlways, jobColorHex, mixHex } from '../voxel/vx-job-core.mjs';
import { catColor } from '../flow-core.mjs';
import { pickRectAt, projectAreaPad } from '../overview/pick-core.mjs';
import { toScreen, toWorld, camScale } from './flat-core.mjs';
import { wallSegments, yawVec, facilityRect, FACILITY_LABEL, roomKindName, charRadius, isMoving } from './plan-core.mjs';
import { drawCards, drawRings, drawDeviceFace, BubbleLayer, fitChars } from './flat-draw.js';
import { spawnLinks } from '../spawn-link.mjs';
import { VxSessCore, PLANE_DUR, ease } from '../voxel/vx-sess-core.mjs';
import { quarter, windowWall } from '../voxel/xf.mjs';
import { Vx2DExtra } from './vx2d-extra.js';
import { roleOf, overseeSpot } from '../voxel/office-core.mjs';
import { DEG, degOf, glitchAt, seedOf } from '../degrade-core.mjs';
import { t as tr } from '../i18n.mjs';

const MACHINE_KIND = { 'bash-bg': 'rack', monitor: 'screen', workflow: 'board' };
const KNOWN = new Set(['main', 'subagent', 'workflow', 'workflow-agent', 'claude-p', 'bash-bg', 'monitor']);
const VERB_CATS = new Set(['shell', 'read', 'write', 'edit', 'search', 'agent', 'workflow', 'skill', 'web', 'monitor', 'mcp', 'artifact', 'notify', 'other']);
const catVerb = (c) => tr('flat.verb.' + (VERB_CATS.has(c) ? c : 'other'));
const HOLD_SEC = 30;        // 퇴장 뒤 자리 반납까지(벽시계, 재생 속도로 나눔) — 3D 와 같음
const RECENT_MS = 30000;    // 스냅샷으로 들어온 done 이 이 안이면 퇴장 동작만 보여 줌
const TOP_ACTIVE = 6;
const FACILITIES = ['shelf', 'files', 'board', 'toolbox', 'antenna', 'terminal', 'kiosk', 'portal', 'bell', 'screens'];
const isEnded = (n) => n && (n.status === 'done' || n.status === 'error' || n.status === 'stopped');
const FONT = '"Pretendard", "Segoe UI", "Malgun Gothic", system-ui, sans-serif';

export class Voxel2DView extends FlatView {
  static modeId = 'voxel';
  static modeLabel = tr('flat.mode.voxel');

  constructor(container, labelContainer, opts = {}) {
    super(container, labelContainer, opts);
    this.labelContainer.classList.remove('flow-mode');
    this.labelContainer.classList.add('vx2d-mode');
    this.compactPx = 40;           // 캐릭터가 작게 보이면 이름표는 이름·상태만
    this._labelFontPx = 11;
    this.chars = new Map();        // id → Character
    this.machines = new Map();     // id → {type: rack|screen|board|batch, …}
    this._removing = new Set();
    this.layout = null;
    this.rooms = [];
    this.roomsById = new Map();
    this.stationUse = new Map();
    this._now = performance.now() / 1000;
    this.bubbles = new BubbleLayer(this, 6);
    this._topActive = new Set();
    this._ctx = {
      now: 0, dt: 0, ts: 1, room: null, seat: null,
      stationSpot: (ch, cat) => this._stationSpot(ch, cat),
      releaseStation: (ch) => this._releaseStation(ch),
      breakSpot: (ch) => this.vx.breakSpot(ch), // 탕비실
      crewOf: (ch) => crewSpots(this.chars.values(), ch, this._crewBuf || (this._crewBuf = [])), // 팀장 지휘·감독
      overseeSpot: (ch, crew) => overseeSpot(ch.room, crew), // 볼 팀원 책상 앞 통로
      onError: (ch) => { if (this.bubbles.push(ch.id, 'error', tr('flat.vx.error'))) this.invalidate(); },
    };
    this.vsess = new VxSessCore(this); // 라운지·이사·충돌·메시지(3D 복셀과 같은 규칙)
    this._layoutVer = 0;
    this.vx = new Vx2DExtra(this); // 바닥 조명 라인·패킷·홀로그램 모니터·특별 상호작용·의뢰인 창구
    this.applyTheme();
  }

  // ---------------- 여러 live 세션 ----------------
  setSessions({ book } = {}) { this.vsess.setBook(book || null); this.invalidate(); }
  /** 흐름 연출: 바탕(말 한 줄) + 바닥 패킷·특별 상호작용·의뢰인 창구 */
  flowEvent(ev, opts = {}) { super.flowEvent(ev, opts); this.vx.event(ev, opts); }
  sessionMsg(ev) { const ok = this.vsess.message(ev, this._now); if (ok) this.invalidate(); return ok; }
  setScope(scope = {}) {
    super.setScope(scope);
    this.vsess.setProjects(this.scope.projects, this.scope.mode);
    this._staticVer = (this._staticVer || 0) + 1;
  }

  get ts() { return Math.max(0.1, Number(this.timeScale) || 1); }
  _hold() { return HOLD_SEC / Math.max(1, this.ts); }

  applyTheme() {
    super.applyTheme();
    this.P = paletteOf(this.tokens.isLight);
    this.pal = this.tokens.isLight ? LIGHT : DARK;
    this._staticVer = (this._staticVer || 0) + 1;
  }

  /** 그린 반지름(세계): 캐릭터 0.5(팀장 0.66), 화면·랙 0.5, 복합기 1.0, 회의실 화이트보드 1.2 */
  _nodeR(node, kind) {
    const k = KNOWN.has(node.kind) ? node.kind : 'subagent';
    if (isLauncher(node)) return 1.0;
    if (isJob(node)) return 0.2; // 작업 칩
    if (MACHINE_KIND[k]) return k === 'workflow' ? 1.2 : 0.5;
    return charRadius(k === 'main' || k === 'claude-p');
  }
  /** 배치 장치(복합기) 이름표는 위 — 팀장 책상 바로 옆이라 아래면 팀장 이름표와 겹친다(3D 도 장치 위·뒤) */
  labelUp(v) { return !!v.device; }
  /** 계획 보드 앵커의 제자리: 캐릭터는 걸어 다녀도 자기 책상 자리(seat), 장치(기동기 등)는 그 자리 */
  planHome(id) { const v = this.vis.get(id); if (!v) return null; const ch = this.chars.get(id); return ch && ch.seat ? { x: ch.seat.x, z: ch.seat.z } : { x: v.target.x, z: v.target.z }; }
  /** 이름표는 캐릭터 바로 아래 */
  _labelGap(v, s, k) { return Math.min(60, v.r * k * s * 1.1 + 3); }

  // ---------------- 노드 ----------------
  addNode(node, spawn = true) {
    if (!node || !node.id) return;
    const old = this.vis.get(node.id);
    if (old && !old.removing) { this.updateNode(node.id, node); return; }
    if (old) this._dropNode(node.id); // 나가던 직원이 다시 들어옴: 새로
    const now = this._now = performance.now() / 1000;
    const kind = KNOWN.has(node.kind) ? node.kind : 'subagent';
    const recent = isEnded(node) && node.endedAt && this.clock() - Date.parse(node.endedAt) < RECENT_MS;
    const nm = this._nodeMap();
    if (MACHINE_KIND[kind]) {
      // 기동기는 배치 장치(복합기), 재무장 Monitor 는 앞 화면을 이어받아 새로 켜지는 연출 없이
      const rearm = node.meta && node.meta.rearmOf && this.machines.has(node.meta.rearmOf);
      const job = isJob(node); // 작업 = 주인 기계 옆 현황판 칩(끝나도 자리를 지킨다 — 접기는 batchFold, 나감은 주인과 함께)
      const m = { id: node.id, node, type: job ? 'job' : isLauncher(node) ? 'batch' : MACHINE_KIND[kind], flashUntil: 0, endWall: null, heldUntil: 0, released: false, appearT0: spawn && !rearm ? now : null, pos: null };
      if (isEnded(node) && !job) { m.endWall = now; m.heldUntil = now + (recent ? this._hold() : 0); if (!recent && !spawn) m.released = true; }
      this.machines.set(node.id, m);
    } else {
      const lead = kind === 'main' || (kind === 'claude-p' && !isCycle(node, nm)) || node.id === this.rootId || (!node.parentId && !this.rootId);
      const ch = new Character(node.id, node, { lead });
      ch.kind = kind;
      ch.spawnMode = spawn ? 'enter' : 'place';
      if (!lead && isEnded(node) && !spawn) {
        if (recent) ch.startAtDoor = true;
        else { ch.state = 'gone'; ch.released = true; ch.goneAt = now; }
      }
      for (const t of node.openTools || []) ch.addTool(t.toolUseId, t.cat, t.tool, now - 1);
      if ((node.openTools || []).length) ch.snapNext = !spawn;
      this.chars.set(node.id, ch);
    }
    this._adding = true; // 바탕 addNode 가 열린 도구를 toolStart 로 다시 넣는다 — 캐릭터 쪽은 위에서 넣었다
    try { super.addNode(node, spawn); } finally { this._adding = false; }
    this._batchDirty(node.parentId);
  }
  _batchDirty(id) { const v = id && this.vis.get(id); if (v && v.device) { this._syncDevice(v); this._labelText(v); } }

  updateNode(id, patch = {}, opts = {}) {
    const v = this.vis.get(id);
    if (!v || v.removing) return;
    const n = v.node, now = this._now;
    super.updateNode(id, patch, opts);
    const ch = this.chars.get(id), m = this.machines.get(id);
    if ('status' in patch) {
      const ended = isEnded(n);
      if (ch && !ended && ch.state === 'gone') {
        // 재개: 출입문에서 다시 들어옴
        const c2 = new Character(id, n, { lead: ch.lead });
        c2.kind = ch.kind; c2.spawnMode = 'enter';
        this.chars.set(id, c2);
        this.layoutDirty = true;
      }
      if (m && m.type === 'job') { m.flashUntil = now + 0.35; this.layoutDirty = true; } // 끝난 작업 접기(최근 3개)가 바뀔 수 있다
      else if (m) {
        if (ended && m.endWall == null) {
          m.endWall = now; m.heldUntil = now + this._hold();
          // 만료된 Monitor 는 재무장을 기다리며 화면을 꺼 둔 채 자리를 지킨다
          if (rearmStandby(n, this._nodeMap().get(n.parentId), 0)) { m.heldUntil = now + BATCH.REARM_WAIT_S / Math.max(1, this.ts); m.standby = true; }
        }
        if (!ended) { if (m.released) this.layoutDirty = true; m.endWall = null; m.released = false; }
        m.flashUntil = now + 0.35;
      }
      if (n.kind === 'claude-p' || n.kind === 'monitor') this.layoutDirty = true;
    }
    if ('parentId' in patch) this.layoutDirty = true;
  }

  /** node-remove: 직원은 자리에서 일어나 문으로 걸어 나간 뒤, 기계는 잠깐 깜빡인 뒤 지운다. 16배속 이상·조용함·흐린 노드는 바로 */
  removeNode(id, opts = {}) {
    const v = this.vis.get(id); if (!v) return;
    if (this._removing.has(id)) { if (opts.animate === false) this._dropNode(id); return; }
    const ch = this.chars.get(id), m = this.machines.get(id), now = this._now;
    const animate = opts.animate !== false && !opts.quiet && this.ts < 16 && (v.scopeK ?? 1) >= 0.5;
    if (animate && ch && ch.placed && ch.seat && ch.state !== 'gone' && !ch.offstage) { ch.forceLeave = true; v.removing = true; this._removing.add(id); this.holo.foldNode(id); this.invalidate(); return; }
    if (animate && m && m.pos && !m.released) { m.removing = true; m.flashUntil = now + 0.35; m.endWall = m.endWall ?? now; m.heldUntil = now + 0.6; v.removing = true; this._removing.add(id); this.holo.foldNode(id); this.invalidate(); return; }
    this._dropNode(id);
  }
  _dropNode(id) {
    const ch = this.chars.get(id);
    if (ch) this._releaseStation(ch);
    this._removing.delete(id);
    this.chars.delete(id); this.machines.delete(id);
    super._dropNode(id);
    this._settleUntil = this.animT + 0.7;
  }
  _dropped(id) { this.bubbles.drop(id); }
  reset() {
    this.chars.clear(); this.machines.clear(); this._removing.clear(); this.stationUse.clear();
    this.layout = null; this.rooms = []; this.roomsById.clear();
    if (this.bubbles) this.bubbles.clear();
    if (this.vx) this.vx.clear();
    super.reset();
  }
  // 퇴장은 캐릭터 걷기(바탕의 흐려짐 퇴장 안 씀)
  _startExit() {}
  _unexit() {}
  setShowDone(on) { this.showDone = !!on; this.invalidate(); } // 복셀은 '완료 표시'와 무관(3D 와 같음): 끝난 직원은 문으로 나간다
  get exitSettling() {
    if (this._removing.size || this.animT < this._settleUntil) return true;
    for (const ch of this.chars.values()) if (ch.state === 'leave') return true;
    return false;
  }

  // ---------------- 도구·말 ----------------
  toolStart(nodeId, ev, quiet = false) {
    const ch = this._adding ? null : this.chars.get(nodeId);
    if (ch) {
      if (ch.state === 'gone') return;
      ch.addTool(ev.toolUseId || 'anon' + Math.random(), ev.cat || 'other', ev.tool, this._now);
      if (quiet) ch.snapNext = true;
    } else if (!this._adding) { const m = this.machines.get(nodeId); if (m) m.flashUntil = this._now + 0.3; }
    super.toolStart(nodeId, ev, quiet);
  }
  toolEnd(nodeId, ev) {
    const ch = this.chars.get(nodeId);
    if (ch) { const found = ch.endTool(ev.toolUseId, ev.ok, this._now); if (!found && ev.ok === false) ch.errFlashUntil = this._now + 0.6; }
    else { const m = this.machines.get(nodeId); if (m) m.flashUntil = this._now + 0.3; }
    super.toolEnd(nodeId, ev);
  }
  /** 말풍선(책상 옆). tool 이면 cat 동사를 앞에(예: "읽기 · SKILL.md") — 3D 복셀과 같은 문구 */
  say(nodeId, text, { type = 'text', cat = null, ok = null } = {}) {
    if (text == null || text === '') return;
    const ch = this.chars.get(nodeId), m = this.machines.get(nodeId);
    if ((!ch || ch.state === 'gone') && !m) return;
    let prefix = '';
    if (type === 'tool') {
      let c = cat;
      if (!c && ch && ch.tools.length) c = ch.tools[ch.tools.length - 1].cat;
      prefix = catVerb(c) + ' · ';
    }
    const role = type === 'result' && ok === false ? 'error' : type;
    if (this.bubbles.push(nodeId, role, prefix + text)) this.invalidate();
  }
  _actHtml(v) {
    if (this.bubbles && this.bubbles.shown.has(v.id) && !v.icons.size) return '';
    return super._actHtml(v);
  }

  // ---------------- 시설 자리 예약(3D office.js 와 같음) ----------------
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

  // ---------------- 배치(3D office.js _relayout 과 같은 규칙, 결과는 평면도) ----------------
  _present() {
    const nodes = this._nodeMap();
    const fold = batchFold(nodes);
    const wfMember = new Set();
    for (const ch of this.chars.values()) {
      if (ch.released) continue;
      const p = ch.node.parentId;
      if (p && this.machines.has(p)) wfMember.add(p);
    }
    const out = [];
    for (const [id, v] of this.vis) {
      const n = v.node;
      const ch = this.chars.get(id);
      if (ch && ch.released) continue;
      const m = this.machines.get(id);
      if (m && m.released && !(m.type === 'board' && wfMember.has(id))) continue;
      if (fold.rearmPrev.has(id)) continue;
      if (m && m.type === 'job' && fold.hidden.has(id)) continue; // 끝난 작업은 주인마다 최근 몇 개만(jobFold)
      // 재무장 앞 Monitor 아래 작업은 대표(마지막 Monitor) 판에 — 서버가 parentId 를 옮기기 전에도 사라지지 않게
      const pid = m && m.type === 'job' && fold.rearmPrev.has(n.parentId) ? fold.rearmPrev.get(n.parentId) : n.parentId;
      out.push({ id, parentId: pid, kind: n.kind, status: n.status, order: n._order, startedAt: n.startedAt, projectId: n.projectId, rootSessionId: n.rootSessionId, meta: n.meta, sessionId: n.sessionId, lastActivityAt: n.lastActivityAt });
    }
    return out;
  }
  _relayout() {
    this._layoutVer++;
    const now = this._now;
    this.lastLayout = now;
    this.layoutDirty = false;
    const campus = this.scope.mode === 'all';
    const lay = campus
      ? computeCampus(this._present(), this.scope.roots, this.scope.projects, this.layout && this.layout.campus ? this.layout : null, { showInactive: this.scope.showInactive, nowMs: Date.now(), view: packView(this.container, { flat: true }) })
      : computeOffice(this._present(), this.rootId, this.layout && !this.layout.campus ? this.layout : null);
    const oldRooms = this.roomsById;
    const movingRooms = this.vsess.afterLayout(lay, now); // 이사 보간
    this.layout = lay;
    this.rooms = lay.rooms;
    this.roomsById = new Map(lay.rooms.map((r) => [r.id, r]));
    this.layoutRoot = lay.rootId;
    for (const r of lay.rooms) r._act = Object.fromEntries(FACILITIES.map((f) => [f, 0]));
    const moved = new Set();
    for (const r of lay.rooms) { const o = oldRooms.get(r.id); if (o && !movingRooms.has(r.id) && (o.origin.x !== r.origin.x || o.origin.z !== r.origin.z || o.ext !== r.ext)) moved.add(r.id); }
    for (const id of moved) this.stationUse.delete(id);
    for (const ch of this.chars.values()) {
      const seat = lay.seat.get(ch.id);
      ch.offstage = campus && !seat;
      if (!seat) continue;
      const room = this.roomsById.get(seat.roomId);
      if (ch.room && (moved.has(room.id) || ch.room.id !== room.id)) {
        if (ch.station) ch.station = null;
        ch.target = null; ch.snapNext = true;
        if (ch.room.id !== room.id) this.stationUse.forEach((m) => m.forEach((arr) => { const i = arr.indexOf(ch.id); if (i >= 0) arr[i] = null; }));
      } else if (ch.seat && (Math.abs(ch.seat.x - seat.x) > 1e-6 || Math.abs(ch.seat.z - seat.z) > 1e-6)) ch.target = null;
      ch.seat = seat; ch.room = room;
      const lead = seat.kind === 'lead';
      if (lead !== ch.lead) { ch.lead = lead; const v = this.vis.get(ch.id); if (v) v.r = charRadius(lead); } // 회차·손님은 직원(퇴장도 직원처럼)
      if (!ch.placed) ch.spawnFrom = ch.spawnMode === 'enter' && !ch.startAtDoor ? this._spawnPoint(ch, room) : null;
    }
    for (const m of this.machines.values()) m.pos = lay.machine.get(m.id) || null;
    // 띄움 점선: 기동기(복합기) ↔ 띄운 사람 — 자리가 있는 것끼리
    const nm = new Map(); for (const [id, v] of this.vis) if (!v.gone) nm.set(id, v.node);
    const placedHere = (id) => nm.has(id) && ((this.chars.has(id) && !!lay.seat.get(id)) || (this.machines.has(id) && !!this.machines.get(id).pos));
    this.spawnLinks = spawnLinks(nm, placedHere, new Map([...this.vis].map(([id, v]) => [id, v.node]))).map(([a, b]) => [this.vis.get(a), this.vis.get(b)]).filter(([a, b]) => a && b);
    // 부모·자식(카메라 '노드 맞춤'): 팀장 = 그 방 사람·기계 전부, 화이트보드 = 회의실 사람, 그 밖 = 실제 자식
    const parentOf = new Map(), kids = new Map();
    for (const [id, v] of this.vis) parentOf.set(id, v.node.parentId || null);
    for (const [id] of this.vis) {
      const ch = this.chars.get(id), roomId = lay.roomOf.get(id);
      let arr = null;
      if (ch && ch.lead && roomId) { arr = []; for (const [oid] of this.vis) if (oid !== id && lay.roomOf.get(oid) === roomId) arr.push(oid); }
      else if (this.machines.has(id) && this.machines.get(id).type === 'board') { arr = []; const mr = 'm:' + id; for (const [oid] of this.vis) if (oid !== id && lay.roomOf.get(oid) === mr) arr.push(oid); }
      if (arr) kids.set(id, arr);
    }
    for (const [id, p] of parentOf) {
      if (!p || !this.vis.has(p)) continue;
      const pc = this.chars.get(p);
      if ((pc && pc.lead) || (this.machines.get(p) && this.machines.get(p).type === 'board')) continue;
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(id);
    }
    this.parentOf = parentOf;
    this.childrenOf = kids;
    this.links = [];
    // 방 흐림: 끝난 claude -p 별관·지난(recent) 사무실, 전체 보기에서 다른 프로젝트
    this._dimRooms = new Set();
    for (const r of this.rooms) {
      if (r.type !== 'office') continue;
      const ov = this.vis.get(r.ownerId);
      if (ov && ov.node.kind === 'claude-p' && isEnded(ov.node)) this._dimRooms.add(r.id);
      if (r.recent) this._dimRooms.add(r.id);
      if (r.past) this._dimRooms.add(r.id); // 날개(지난 메인) = 불 꺼짐
    }
    if (campus) {
      const cl = (lay.buildings || []).map((b) => ({
        projectId: b.projectId, name: b.name, center: b.center, r: Math.hypot(b.size.w, b.size.d) / 2,
        active: b.active, live: b.live, busy: b.busy, inactive: b.recent, temp: b.temp, sessions: b.sessions, liveSessions: b.liveSessions,
        mains: b.offices.map((o) => ({ nodeId: o.mainId })), labelZ: b.bounds.maxZ + 1.6, bounds: b.bounds,
      }));
      this._setClusters(cl);
    } else { this._clusters = []; this._clusterV.clear(); this._syncIslandEls(); }
    this._syncActors(now);
    this._applyScope();
    this._staticVer = (this._staticVer || 0) + 1;
    this.invalidate();
  }
  _applyScope() {
    const lay = this.layout;
    const fp = this.scope.mode === 'all' ? this.scope.focusProject : null;
    for (const v of this.vis.values()) {
      const pid = lay && lay.projectOf ? lay.projectOf.get(v.id) || null : null;
      // 다른 프로젝트는 흐리게 두지 않고 페이드 아웃 → 숨김(scopeK = 프로젝트 투명도)
      const k = this.scope.mode === 'all' ? this.pf.alpha(pid) : 1;
      v.projectId = pid;
      v.scopeD = 1; v.projA = k;
      v.projOut = !!((fp || this.pf.hide.size) && this.pf.out(pid)); // 표시 고르기 숨김도
      v.projGone = !!((fp || this.pf.hide.size) && this.pf.gone(pid));
      if (k !== (v.scopeK ?? 1)) { v.scopeK = k; this._styleVis(v); }
      if (v.labelEl && v.exiting == null) { const o = k < 1 ? (Math.round(k * 20) / 20).toFixed(2) : ''; if (v.labelEl.style.opacity !== o) v.labelEl.style.opacity = o; }
    }
    this._syncActors(this._now);
    this._syncIslandEls();
    this._staticVer = (this._staticVer || 0) + 1;
  }
  /** 캐릭터·기계 상태 → 바탕 vis(숨김·자리). nodeTarget = 캐릭터 지금 자리 */
  _syncActors(now) {
    let moving = false;
    for (const ch of this.chars.values()) {
      const v = this.vis.get(ch.id); if (!v) continue;
      v.ovHidden = !!ch.offstage || !ch.seat || !ch.placed;
      const gone = ch.state === 'gone';
      if (gone !== !!v.gone) v.gone = gone;
      this._syncHidden(v);
      v.pos.x = v.target.x = ch.pos.x; v.pos.z = v.target.z = ch.pos.z;
      v.drawS = ch.placed ? ch.scale(now) : 0;
      if (ch.placed && !gone && isMoving(ch)) moving = true;
    }
    for (const m of this.machines.values()) {
      const v = this.vis.get(m.id); if (!v) continue;
      v.ovHidden = !m.pos;
      const gone = !!m.released;
      if (gone !== !!v.gone) v.gone = gone;
      this._syncHidden(v);
      if (m.pos && m.type === 'job') { const q = jobFlatPos(m.pos, this._jfp || (this._jfp = {})); v.pos.x = v.target.x = q.x; v.pos.z = v.target.z = q.z; } // 판 앞쪽 칩 줄
      else if (m.pos) { v.pos.x = v.target.x = m.pos.x; v.pos.z = v.target.z = m.pos.z; }
      v.drawS = m.appearT0 != null ? Math.min(1, Math.max(0.02, (now - m.appearT0) / 0.5)) : 1;
      if (m.appearT0 != null && v.drawS < 1) moving = true;
    }
    return moving;
  }
  clusterTarget(projectId) { const e = this._clusterV.get(projectId); return e ? { center: e.center, r: e.r } : null; }
  /** opts.pid = 그 동만 + 둘레 여유(프로젝트 영역), 아니면 나가는(숨는) 동은 빼고 */
  pickCluster(clientX, clientY, opts = {}) {
    const lay = this.layout;
    if (this.scope.mode !== 'all' || !lay || !lay.buildings) return null;
    const r = this.canvas.getBoundingClientRect();
    const w = toWorld(this.cam, r.width || 1, r.height || 1, clientX - r.left, clientY - r.top);
    if (opts.pid) {
      const b = lay.buildings.find((x) => x.projectId === opts.pid);
      return b ? pickRectAt([b], w.x, w.z, projectAreaPad((b.bounds.maxX - b.bounds.minX) / 2, (b.bounds.maxZ - b.bounds.minZ) / 2)) : null;
    }
    return pickRectAt(lay.buildings.filter((b) => !this.pf.out(b.projectId)), w.x, w.z, 1.5);
  }
  /** 세계 (x, z) 의 투명도(통로처럼 프로젝트가 없는 것): 그 자리 동의 값, 없으면 나가는 동들의 값 */
  _fadeAt(x, z) {
    const bs = this.layout && this.layout.buildings;
    if (!bs || this.scope.mode !== 'all') return 1;
    let out = 1;
    for (const b of bs) {
      const g = b.bounds, a = this.pf.alpha(b.projectId);
      if (g && x >= g.minX - 1 && x <= g.maxX + 1 && z >= g.minZ - 1 && z <= g.maxZ + 1) return a;
      if (b.projectId !== this.pf.focus && a < out) out = a;
    }
    return out;
  }
  // ---- 작업 대상 층(사무실 벽 바깥 띠). 끄면 객체가 없고 그리기·맞춤에 아무것도 더하지 않는다 ----
  setArtifacts({ on, book, fx, style } = {}) {
    if (on && !this.vArt && book && fx) this.vArt = new VoxelArt2D(this, { book, fx, style });
    else if (!on && this.vArt) { this.vArt.dispose(); this.vArt = null; }
    this.invalidate();
    return !!this.vArt;
  }
  get artOn() { return !!this.vArt; }
  pickArtifact(clientX, clientY) { if (!this.vArt) return null; const r = this.canvas.getBoundingClientRect(); return this.vArt.pick(clientX - r.left, clientY - r.top); }
  artPos(pid, id) { return this.vArt ? this.vArt.posOf(pid, id) : null; }
  /** 의뢰인 스크린(사용자 콘솔) 집기 · 자리 — 바탕 FlatIx 는 복셀에서 꺼져 있어 vx2d-extra 가 맡음 */
  pickConsole(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const id = this.vx.consoleAt(clientX - r.left, clientY - r.top);
    const v = id ? this.vis.get(id) : null;
    return v && !v.hidden && !this._scopeOff(v) && !v.projOut ? id : null;
  }
  consolePos(id) { return this.vx.consolePos(id); }
  setArtFoot(pid, nodeId) { if (this.vArt) { this.vArt.st.setFoot(pid, nodeId); this.invalidate(); } }
  setArtSelected(t) { if (this.vArt) { this.vArt.st.sel = t || null; this.invalidate(); } }

  /** 카메라 맞춤에 방 모서리(문패 자리 포함)도 — 캐릭터만 맞추면 방이 잘린다 */
  fitExtra(pts, scope = {}) {
    if (this.vArt) this.vArt.fitPoints(pts, scope);
    const all = this.scope.mode === 'all';
    const fp = all ? scope.focusProject : null, fsid = all ? scope.focusSession : null;
    for (const r of this.rooms) {
      if (fp && r.projectId !== fp) continue;
      if (fsid) { const ov = this.vis.get(r.ownerId); if (!ov || ov.node.rootSessionId !== fsid) continue; }
      const b = r.bounds;
      pts.push({ p: { x: b.minX, z: b.minZ }, r: 0.5 }, { p: { x: b.maxX, z: b.maxZ + 1.4 }, r: 0.5 });
    }
  }

  // ---------------- 프레임 ----------------
  _exitPass(now) {
    // 퇴장한 캐릭터·끝난 기계의 자리 반납(3D 와 같은 30초/배속), 제거된 노드는 다 나간 뒤 지움
    const t = this._now;
    for (const ch of this.chars.values()) {
      if (ch.state === 'gone' && !ch.released) {
        if (ch.heldUntil == null) ch.heldUntil = t + this._hold();
        if (t >= ch.heldUntil) { ch.released = true; this.layoutDirty = true; }
      }
    }
    for (const m of this.machines.values()) if (!m.released && m.endWall != null && t >= m.heldUntil) { m.released = true; this.layoutDirty = true; }
    if (this._removing.size) for (const id of [...this._removing]) {
      const ch = this.chars.get(id), m = this.machines.get(id);
      if ((ch && ch.state === 'gone') || (m && m.released) || (!ch && !m)) this._dropNode(id);
    }
    // 재무장 대기 라벨
    for (const m of this.machines.values()) { const v = this.vis.get(m.id); if (v && !!m.standby !== !!v.standby) { v.standby = !!m.standby; this._labelText(v); } }
    // 시계로만 바뀌는 작업 정체 표시(재생 = 가상 시계) — 0.25초마다 라벨 열쇠 비교
    if (t - (this._jobAt || 0) >= 0.25) {
      this._jobAt = t;
      const cm = this.clock();
      for (const m of this.machines.values()) {
        if (m.type !== 'job') continue;
        const v = this.vis.get(m.id);
        if (v && v._jobKey != null && jobLabelKey(jobOf(v.node), cm) !== v._jobKey) this._labelText(v);
      }
    }
  }

  _update(now, dt) {
    this._now = now;
    this._exitPass(now);
    const fading = this.pf.step(dt); // 프로젝트 페이드(정적 층도 매 프레임 다시)
    if (fading) this._applyScope();
    if (this.scope.mode === 'all' && this.layout && this.layout.campus && now - (this._packChk || 0) > 0.5) { this._packChk = now; if (packStale(this.layout, packView(this.container, { flat: true }))) this.layoutDirty = true; }
    if (this.layoutDirty && now - this.lastLayout > 0.15) this._relayout();
    let level = 0;
    // 이사 보간·충돌 방문
    if (this.vsess.stepMoves(now)) { this._staticVer = (this._staticVer || 0) + 1; this._layoutVer++; level = 2; }
    this.vx.step(now, dt); // 팀장 심부름·모니터 열림
    this.vsess.stepConflicts(now);
    if (this.vsess.pairs.length && !this.reduced) level = Math.max(level, 1);
    if (this.vsess.livePlanes(now).length) level = 2;
    // 캐릭터 상태 머신(3D 와 같음)
    const ctx = this._ctx;
    ctx.now = now; ctx.dt = dt; ctx.ts = this.ts;
    for (const ch of this.chars.values()) {
      if (ch.state === 'gone' || !ch.seat || !ch.room) continue;
      ctx.room = ch.room; ctx.seat = ch.seat;
      if (ch.startAtDoor && !ch.placed) { ch.placed = true; ch.placeAt(ch.room.door, Math.PI + (ch.room.xf ? quarter(ch.room.xf.k) * Math.PI / 2 : 0)); ch.state = 'seated'; ch.target = { key: 'door', type: 'door', spot: ch.room.door }; }
      if (ch.spawnMode === 'enter' && !ch.placed && !ch.spawnFrom) ch.appearT0 = now;
      const st0 = ch.state;
      ch.update(ctx);
      if (ch.state !== st0) { const v = this.vis.get(ch.id); if (v) this.lastLabelPass = 0; }
      if (!this.reduced && (ch.state === 'work' || ch.sup)) level = Math.max(level, 1); // 지휘·감독 손짓도
    }
    if (this._syncActors(now)) level = 2;
    if (!this.reduced) level = Math.max(level, this.vx.animating(now));
    // 시설 활동도(쓰는 중인 시설은 종류 색 테두리)
    for (const r of this.rooms) { const a = r._act; for (const f of FACILITIES) a[f] = 0; if (r._portalUntil && r._portalUntil > now) a.portal = 1; }
    for (const ch of this.chars.values()) {
      if (ch.state !== 'work' || !ch.room || !ch.target || ch.target.type !== 'station') continue;
      const f = CAT_FACILITY[ch.workCat];
      if (f && ch.room._act) ch.room._act[f] = ch.workCat;
    }
    for (const m of this.machines.values()) {
      if (m.flashUntil > now) level = 2;
      if (m.type === 'batch' && !this.reduced && m.node.status === 'active') level = Math.max(level, 1);
      if (m.type === 'job' && !this.reduced && m.pos && (m.node.status === 'active' || (m.node.meta && m.node.meta.job && m.node.meta.job.stale))) level = Math.max(level, 1); // 숨쉬는 표시등·정체 맥박
    }
    if (now - this.lastLabelPass > 0.25) this._labelPass(now);
    if (this.effects.length) {
      this.effects = this.effects.filter((e) => now - e.t0 < e.dur);
      if (this.effects.length) level = 2;
    }
    const changed = this.holo.book.step(now, (id) => { const v = this.vis.get(id); return !!v && v.node.status === 'active'; });
    if (changed.size) level = Math.max(level, 2);
    if (this._holoAnimating(now)) level = 2;
    level = Math.max(level, this.bubbles.level(now));
    if (this.degradeFx && this.degradeFx.active) level = Math.max(level, this.degradeFx.level); // 신호 열화
    if (this.vArt) level = Math.max(level, this.vArt.level(now)); // 작업 대상 층
    if (fading || this.pf.busy) level = 2;
    if (level === 0 && this._wasLevel > 0) this.invalidate(); // 걷기·깜빡임이 막 끝난 갱신도 한 번 그린다(마지막 자리)
    this._wasLevel = level;
    return level;
  }

  _labelPass(now) {
    super._labelPass(now);
    const act = [];
    for (const v of this.vis.values()) if (v.node.status === 'active' && !v.hidden && this.chars.has(v.id)) act.push(v);
    act.sort((a, b) => (b.node.lastActivityAt || '').localeCompare(a.node.lastActivityAt || ''));
    this._topActive = new Set(act.slice(0, TOP_ACTIVE).map((v) => v.id));
  }
  /** 자리가 없어도 흐리게 남길 이름표: 팀장·배치 장치 */
  _labelPins() {
    const out = super._labelPins();
    for (const ch of this.chars.values()) if (ch.lead) out.add(ch.id);
    return out;
  }
  /** 캐릭터 원판(v.r = 그린 반지름 0.5·팀장 0.66) */
  _discK(v) { return v.device ? 1.6 : isJob(v.node) ? 0 : 1.05; } // 작업 칩은 작아 이름표가 비킬 원판에서 뺀다(칩 줄 위로 이름표가 놓여도 됨)
  /** 이름표 우선: 포커스·호버 > 팀장(메인 = 상급자) > 배치 장치 > 진행 회차·독립 claude -p > 작업 중 직원 > 나머지(적으면 전부). 기계(랙·화면)는 포커스·호버 때만 */
  _labelCandidates(push, actives, maxLabels, order, seen) {
    push(this.focusId, true); push(this.hoverId, true);
    const nm = this._nodeMap();
    for (const ch of this.chars.values()) if (ch.lead) push(ch.id, false);
    for (const v of this.vis.values()) if (v.device) push(v.id, false);
    const cm = this.clock();
    for (const m of this.machines.values()) if (m.type === 'job' && m.pos && jobLabelAlways(m.node, cm)) push(m.id, false, 'soft'); // 진행·대기·정체 작업(붐비면 리더선 달고 먼 자리)
    for (const ch of this.chars.values()) {
      const n = ch.node;
      if ((n.meta && n.meta.orphanSdk) || (ch.kind === 'claude-p' && !isEnded(n) && isCycle(n, nm))) push(ch.id, false);
    }
    for (const v of actives.slice(0, maxLabels)) if (this.chars.has(v.id)) push(v.id, false);
    if (this.chars.size <= 12) for (const id of this.chars.keys()) push(id, false);
  }

  // ---------------- 그리기 ----------------
  _drawScene(ctx, now) {
    const W = this.W, H = this.H, t = this.tokens, pal = this.pal;
    this._font = null;
    const s = this._s = camScale(this.cam, H);
    const cam = this.cam, cx = W / 2 - cam.x * s, cz = H / 2 - cam.z * s;
    this._X = (x) => x * s + cx;
    this._Y = (z) => z * s + cz;
    const lay = this.layout;
    if (!lay) { ctx.fillStyle = t.bg; ctx.fillRect(0, 0, W, H); return; }
    // 바닥·벽·가구·문패(정적)는 카메라·배치·테마가 그대로면 따로 둔 캔버스를 한 번에 붙인다 — 자동 카메라가 멈춰 있는 동안 방 그리기 0
    const key = cam.x + ',' + cam.z + ',' + cam.D + ',' + W + ',' + H + ',' + this.dpr + ',' + this._staticVer + ',' + (t.isLight ? 1 : 0);
    if (key !== this._stKey || !this._st) {
      this._stKey = key;
      const c = this._st || (this._st = document.createElement('canvas'));
      if (c.width !== this.canvas.width || c.height !== this.canvas.height) { c.width = this.canvas.width; c.height = this.canvas.height; }
      const sc = this._stCtx || (this._stCtx = c.getContext('2d', { alpha: false }));
      sc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this._drawStatic(sc, s, now);
      this.stats.staticDraws = (this.stats.staticDraws || 0) + 1;
    }
    ctx.drawImage(this._st, 0, 0, W, H);
    // 움직이는 부분: 책상 화면·쓰는 중인 시설·포털·벨(돌린 방은 회전 전 좌표로)
    for (const r of this.rooms) if (r._on) { const rl = this._rotBegin(ctx, r); if (rl !== r) { rl._alpha = r._alpha; rl._act = r._act; } this._drawRoomDyn(ctx, rl, s, now); this._rotEnd(ctx, r); }
    this._drawSessDyn(ctx, s, now); // 캐비닛 경고등·창·서류 더미
    if (this.vArt) this.vArt.draw(ctx, now); // 작업 대상 층(벽 바깥 가구 — 캐릭터 아래)
    this.vx.drawFlow(ctx, now, s);      // 바닥 조명 라인·흐르는 대시·빛 패킷
    this.vx.drawMonitors(ctx, now, s);  // 스탠딩 데스크 홀로그램 모니터
    // 기계(랙·화면·복합기·화이트보드 표시)
    for (const m of this.machines.values()) {
      const v = this.vis.get(m.id);
      if (!v || !m.pos || m.released || v.projGone) continue; // 사라진 프로젝트
      this._drawMachine(ctx, m, v, s, now);
    }
    // 퇴장 뒤 자리 회색 이름(반납 전까지)
    if (s > 9) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const f = `500 ${Math.round(Math.max(9, Math.min(11, s * 0.32)))}px ${FONT}`; ctx.font = f;
      for (const ch of this.chars.values()) {
        if (ch.state !== 'gone' || ch.released || !ch.seat || ch.offstage) continue;
        const v = this.vis.get(ch.id); if (!v || !(v.scopeK ?? 1)) continue;
        ctx.globalAlpha = 0.55 * (v.projA ?? 1); ctx.fillStyle = t.muted; // 프로젝트 페이드
        ctx.fillText(fitChars(ch.node.label || ch.id, 16), this._X(ch.seat.deskX), this._Y(ch.seat.deskZ));
      }
    }
    // 캐릭터
    for (const v of this.vis.values()) {
      if (v.gone || v.hidden) { v._on = false; continue; }
      const p = toScreen(this.cam, W, H, v.pos.x, v.pos.z, v._sp || (v._sp = {}));
      const R = v.r * (v.drawS || 1) * s;
      v._R = R;
      v._on = p.x > -R - 300 && p.x < W + R + 300 && p.y > -R - 300 && p.y < H + R + 300;
      // 말풍선·카드 기준점 = 책상(앉는 자리), 기계는 제자리
      const ch = this.chars.get(v.id);
      const ap = v._ap || (v._ap = {});
      if (ch && ch.seat) {
        const desk = ch.seat.kind === 'grid' || ch.seat.kind === 'aux' || ch.seat.kind === 'lead';
        ap.x = this._X(desk ? ch.seat.deskX : ch.seat.x); ap.y = this._Y(desk ? ch.seat.deskZ : ch.seat.z); ap.R = (desk ? (ch.seat.kind === 'lead' ? 1.1 : 0.7) : 0.5) * s;
      } else { ap.x = p.x; ap.y = p.y; ap.R = R; }
      if (ch && v._on) this._drawChar(ctx, ch, v, s, now);
    }
    drawRings(this, ctx, now, s);
    this.vx.drawIx(ctx, now, s);        // 특별 상호작용 은유
    this.vx.drawClient(ctx, now, s);    // 의뢰인 창구
    this._drawPlanes(ctx, s, now); // 종이비행기
    const anchor = (v) => v._ap || v._sp;
    this._drawSpawnLinks(ctx, anchor); // 띄움 점선
    this._font = null; // 위에서 ctx.font 를 직접 바꿨으므로 공용 setFont 기억을 비움
    drawCards(this, ctx, now, s, anchor, true);
    this.bubbles.place(now, anchor);
    ctx.globalAlpha = 1;
  }

  /** 정적 층: 배경·동 바닥판·통로·방(바닥·가구·벽·문·문패) — _staticVer(배치·범위·테마)·카메라가 바뀔 때만 */
  _drawStatic(ctx, s, now) {
    const W = this.W, H = this.H, t = this.tokens, pal = this.pal, lay = this.layout;
    ctx.globalAlpha = 1;
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);
    const fp = this.scope.mode === 'all' ? this.scope.focusProject : null;
    if (lay.buildings) for (const b of lay.buildings) this._drawBuilding(ctx, b, false, s); // 다른 프로젝트는 투명도(projAlpha)로
    ctx.lineCap = 'butt';
    for (const c of lay.corridors) {
      if (c.path.length < 2) continue;
      const ca = this._fadeAt(c.path[0].x, c.path[0].z);
      if (ca <= 0) continue;
      ctx.globalAlpha = ca; ctx.strokeStyle = pal.corridor; ctx.lineWidth = Math.max(2, 1.8 * s);
      ctx.beginPath(); ctx.moveTo(this._X(c.path[0].x), this._Y(c.path[0].z));
      for (let i = 1; i < c.path.length; i++) ctx.lineTo(this._X(c.path[i].x), this._Y(c.path[i].z));
      ctx.stroke();
      ctx.strokeStyle = pal.mat; ctx.lineWidth = Math.max(0.6, 0.12 * s); ctx.setLineDash([Math.max(2, 0.5 * s), Math.max(2, 0.5 * s)]); ctx.stroke(); ctx.setLineDash([]);
    }
    if (lay.lounges) for (const g of lay.lounges) this._drawLounge(ctx, g, false, s);
    for (const r of this.rooms) {
      const b = r.bounds;
      const x0 = this._X(b.minX), y0 = this._Y(b.minZ), x1 = this._X(b.maxX), y1 = this._Y(b.maxZ);
      const dim = this._dimRooms && this._dimRooms.has(r.id);
      const fa = r.projectId ? this.projAlpha(r.projectId) : this._fadeAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2); // 프로젝트 페이드
      r._alpha = (dim ? 0.5 : 1) * fa;
      if (fa <= 0) { r._on = false; continue; }
      if (x1 < -40 || x0 > W + 40 || y1 < -60 || y0 > H + 60) { r._on = false; continue; }
      r._on = true;
      const rl = this._rotBegin(ctx, r);
      if (rl !== r) { rl._alpha = r._alpha; const lb = rl.bounds; this._drawRoom(ctx, rl, this._X(lb.minX), this._Y(lb.minZ), this._X(lb.maxX), this._Y(lb.maxZ), s, now, true); }
      else this._drawRoom(ctx, r, x0, y0, x1, y1, s, now, true);
      this._rotEnd(ctx, r);
      this._drawRoomSign(ctx, r, s);
    }
    ctx.globalAlpha = 1;
  }

  _rect(ctx, x, z, w, d) { const s = this._s; ctx.fillRect(this._X(x - w / 2), this._Y(z - d / 2), w * s, d * s); }

  /** 돌린 방: 캔버스를 회전 중심 둘레로 돌리고 회전 전 방(room.local)을 돌려준다(그리고 나서 _rotEnd) */
  _rotBegin(ctx, r) {
    const xf = r && r.xf, k = xf ? quarter(xf.k) : 0;
    if (!k || !r.local) { this._rotA = 0; return r; }
    const X = this._X(xf.px), Y = this._Y(xf.pz);
    ctx.save(); ctx.translate(X, Y); ctx.rotate(-k * Math.PI / 2); ctx.translate(-X, -Y);
    this._rotA = k * Math.PI / 2;
    return r.local;
  }
  _rotEnd(ctx, r) { if (this._rotA) { ctx.restore(); this._rotA = 0; } }
  /** 글자는 돌린 방 안에서도 똑바로 */
  _text(ctx, txt, x, y) {
    if (!this._rotA) { ctx.fillText(txt, x, y); return; }
    ctx.save(); ctx.translate(x, y); ctx.rotate(this._rotA); ctx.fillText(txt, 0, 0); ctx.restore();
  }

  _drawBuilding(ctx, b, dim, s) {
    const pal = this.pal, g = b.bounds;
    const x0 = this._X(g.minX), y0 = this._Y(g.minZ), w = (g.maxX - g.minX) * s, h = (g.maxZ - g.minZ) * s;
    if (x0 > this.W || y0 > this.H || x0 + w < 0 || y0 + h < 0) return;
    const fa = this.projAlpha(b.projectId);
    if (fa <= 0) return;
    ctx.globalAlpha = (dim ? 0.35 : 1) * fa;
    ctx.fillStyle = pal.trim; ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = pal.corridor; ctx.fillRect(x0 + 0.2 * s, y0 + 0.2 * s, w - 0.4 * s, h - 0.4 * s);
    if (b.recent) { // 지붕 덮은 낮은 상자(창 불 꺼짐)
      const iw = w - 4.8 * s, ih = h - 4.8 * s;
      ctx.fillStyle = pal.wallTop; ctx.fillRect(x0 + 2.4 * s, y0 + 2.4 * s, iw, ih);
      ctx.strokeStyle = pal.wall; ctx.lineWidth = Math.max(1, 0.12 * s);
      ctx.beginPath();
      for (let x = 0; x < iw + ih; x += Math.max(6, 1.6 * s)) { ctx.moveTo(x0 + 2.4 * s + Math.min(x, iw), y0 + 2.4 * s + Math.max(0, x - iw)); ctx.lineTo(x0 + 2.4 * s + Math.max(0, x - ih), y0 + 2.4 * s + Math.min(x, ih)); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _drawRoom(ctx, r, x0, y0, x1, y1, s, now, noSign = false) {
    const pal = this.pal, t = this.tokens, L = t.isLight;
    const A = r._alpha;
    ctx.globalAlpha = A;
    ctx.fillStyle = r.type === 'meeting' ? pal.floorAlt : pal.floor;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // 바닥 깔개(사무실 가운데)
    if (r.type === 'office' && s > 4) { ctx.fillStyle = pal.floorAlt; ctx.fillRect(this._X(r.origin.x - 8), this._Y(r.origin.z - 3.2), 16 * s, (r.size.d - 9) * s); }
    // 세션 색 카펫(팀장 책상 둘레)
    const sc = r.type === 'office' && r.leadDesk ? this.vsess.sessColor(this.vis.get(r.ownerId) && this.vis.get(r.ownerId).node) : null;
    if (sc) { ctx.globalAlpha = A * (r.past ? 0.15 : 0.3); ctx.fillStyle = sc; this._rect(ctx, r.leadDesk.x, r.leadDesk.z - 0.3, 5.2, 3.4); ctx.globalAlpha = A; }
    // 시설(벽 쪽)
    if (s > 2.5) this._drawFacilities(ctx, r, s, now);
    // 회의실 탁자·화이트보드
    if (r.type === 'meeting') {
      ctx.fillStyle = pal.wood;
      for (const tb of r.tables) this._rect(ctx, tb.x, tb.z, 11, 1.5);
      if (r.board) { ctx.fillStyle = pal.boardFrame; this._rect(ctx, r.board.x, r.board.z, 3.4, 0.35); ctx.fillStyle = pal.board; this._rect(ctx, r.board.x, r.board.z, 3.1, 0.2); }
    }
    // 탕비실·특별 상호작용 시설·발송대(사무실)
    if (r.type === 'office' && s > 2.5) this.vx.drawRoomStatic(ctx, r, s);
    // 팀장 책상(스탠딩 데스크, 넓게) — 의자 없음, 상판 뒤 홀로그램 발광대
    if (r.leadDesk) {
      const d = r.leadDesk;
      ctx.fillStyle = pal.deskEdge; this._rect(ctx, d.x, d.z, 2.1, 1.0);
      ctx.fillStyle = pal.deskTop; this._rect(ctx, d.x, d.z, 1.95, 0.85);
      ctx.fillStyle = pal.emitter; ctx.globalAlpha = A * 0.45; this._rect(ctx, d.x, d.z + 0.33, 1.1, 0.07); ctx.globalAlpha = A;
    }
    // 직원 스탠딩 데스크
    for (const d of r.desks) {
      ctx.fillStyle = pal.deskEdge; this._rect(ctx, d.x, d.z, d.aux ? 1.2 : 1.4, 0.8);
      ctx.fillStyle = d.aux ? pal.deskEdge : pal.deskTop; this._rect(ctx, d.x, d.z, d.aux ? 1.05 : 1.25, 0.66);
      ctx.fillStyle = pal.emitter; ctx.globalAlpha = A * 0.4; this._rect(ctx, d.x, d.z + 0.23, 0.7, 0.06); ctx.globalAlpha = A;
    }
    // 작업석(바닥 표시)·대기석(벤치)
    if (r.stools) for (const st of r.stools) { ctx.fillStyle = st.kind === 'wait' ? pal.wood : pal.mat; this._rect(ctx, st.x, st.z, st.kind === 'wait' ? 0.62 : 0.7, st.kind === 'wait' ? 0.5 : 0.7); }
    // 벽: 유리 칸막이(옅은 선 + 프레임 점) · 창 벽 = 창밖 하늘 띠(다크 = 밤, 라이트 = 낮)
    ctx.globalAlpha = A;
    const ww = r.type === 'office' ? windowWall(r) : null;
    const b0 = r.bounds;
    if (ww) {
      const z = ww === 'front' ? b0.maxZ : b0.minZ;
      const g = ctx.createLinearGradient(0, this._Y(z) - 0.25 * s, 0, this._Y(z) + 0.25 * s);
      g.addColorStop(0, pal.skyTop); g.addColorStop(0.5, pal.skyMid); g.addColorStop(1, pal.skyLow);
      ctx.fillStyle = g; ctx.fillRect(this._X(b0.minX), this._Y(z) - 0.22 * s, (b0.maxX - b0.minX) * s, 0.44 * s);
    }
    ctx.strokeStyle = pal.pane; ctx.globalAlpha = A * 0.7; ctx.lineWidth = Math.max(1, 0.12 * s); ctx.lineCap = 'square';
    ctx.beginPath();
    for (const [ax, az, bx, bz] of wallSegments(r)) { ctx.moveTo(this._X(ax), this._Y(az)); ctx.lineTo(this._X(bx), this._Y(bz)); }
    ctx.stroke();
    ctx.strokeStyle = pal.glassFrame; ctx.globalAlpha = A; ctx.lineWidth = Math.max(0.8, 0.05 * s);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // 출입문: 문짝 호(위에서 본 여닫이)
    if (r.door && s > 3) {
      const dx = this._X(r.door.x - 0.8), dy = this._Y(r.bounds.maxZ);
      ctx.strokeStyle = pal.woodDark; ctx.lineWidth = Math.max(1, 0.1 * s);
      ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx, dy - 1.5 * s); ctx.arc(dx, dy, 1.5 * s, -Math.PI / 2, 0); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (!noSign) this._drawRoomSign(ctx, r, s);
  }

  /** 방 문패(세계 좌표, 돌린 방도 글자는 똑바로). 라운지 둘레 사무실은 문 앞 가운데 */
  _drawRoomSign(ctx, r, s) {
    const t = this.tokens;
    const A = r._alpha ?? 1;
    const sc = r.type === 'office' && r.leadDesk ? this.vsess.sessColor(this.vis.get(r.ownerId) && this.vis.get(r.ownerId).node) : null;
    if (s > 2.2) {
      const owner = this.vis.get(r.ownerId);
      const isMain = this.layout.roots ? this.layout.roots.has(r.ownerId) : r.ownerId === this.layoutRoot;
      const kindName = roomKindName(r, isMain);
      const name = r.external ? (r.projectName || tr('flat.vx.external')) : owner ? owner.node.label || owner.node.id : r.id;
      const fs = Math.round(Math.max(9, Math.min(12, s * 0.42)));
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = `700 ${fs}px ${FONT}`;
      ctx.fillStyle = t.text; ctx.globalAlpha = A * 0.9;
      let lx = this._X(r.bounds.minX + 0.3), ly = this._Y(r.bounds.maxZ) + Math.max(8, 0.9 * s);
      if (r.lounge && r.door && r.door.out) { // 문 앞(라운지 쪽) 가운데 정렬
        const ox = r.door.out.x - r.door.x, oz = r.door.out.z - r.door.z, n = Math.hypot(ox, oz) || 1;
        const kw0 = ctx.measureText(kindName).width;
        ctx.font = `500 ${fs}px ${FONT}`;
        const tw = kw0 + ctx.measureText(' · ' + fitChars(name, 24)).width + (sc && !r.past ? 30 : 0);
        ctx.font = `700 ${fs}px ${FONT}`;
        if (Math.abs(ox) > Math.abs(oz)) { // 옆벽 문: 방 위 모서리, 문 쪽 끝에 맞춤(라운지 안으로 넘치지 않게)
          lx = ox > 0 ? this._X(r.bounds.maxX) - tw : this._X(r.bounds.minX); ly = this._Y(r.bounds.minZ) - Math.max(8, 0.9 * s);
        } else { lx = this._X(r.door.x + (ox / n) * 3.0) - tw / 2; ly = this._Y(r.door.z + (oz / n) * 3.0); }
        // 문 앞 세션 색 띠(3D 의 문 밖 깔개와 같음)
        if (sc && !r.past) { ctx.fillStyle = sc; ctx.globalAlpha = A * 0.85; ctx.fillRect(this._X(r.door.out.x) - 0.95 * s, this._Y(r.door.out.z) - 0.95 * s, 1.9 * s, 1.9 * s); ctx.globalAlpha = A * 0.9; ctx.fillStyle = t.text; }
      }
      ctx.fillText(kindName, lx, ly);
      const kw = ctx.measureText(kindName).width;
      ctx.font = `500 ${fs}px ${FONT}`; ctx.fillStyle = t.muted;
      const dg = owner && DEG.on && !DEG.reduced ? degOf(r.ownerId) : 0; // 그 세션 문패 글 깨짐
      ctx.fillText(' · ' + (dg > 0 ? glitchAt(fitChars(name, 24), dg, DEG.t, seedOf(r.id)) : fitChars(name, 24)), lx + kw, ly);
      // 문패 = 세션 색 점 + git 브랜치/worktree
      if (sc && !r.past && owner) {
        const nw = ctx.measureText(' · ' + fitChars(name, 24)).width, bx = lx + kw + nw + 8;
        ctx.fillStyle = sc; ctx.beginPath(); ctx.arc(bx, ly, Math.max(3, fs * 0.32), 0, Math.PI * 2); ctx.fill();
        const br = owner.node.meta && (owner.node.meta.worktree || owner.node.meta.git);
        if (br) { ctx.font = `700 ${fs}px ${FONT}`; ctx.fillText(fitChars(br, 18), bx + 7, ly); }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------------- 라운지·충돌·메시지·컨텍스트(평면도) ----------------
  _drawLounge(ctx, g, dim, s) {
    const pal = this.pal;
    const x0 = this._X(g.minX), y0 = this._Y(g.minZ), w = (g.maxX - g.minX) * s, h = (g.maxZ - g.minZ) * s;
    if (x0 > this.W || y0 > this.H || x0 + w < 0 || y0 + h < 0) return;
    const fa = g.projectId ? this.projAlpha(g.projectId) : 1;
    if (fa <= 0) return;
    ctx.globalAlpha = (dim ? 0.35 : 1) * fa;
    ctx.fillStyle = pal.loungeRug; ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = pal.mat; ctx.fillRect(x0 + 0.6 * s, y0 + 0.6 * s, w - 1.2 * s, h - 1.2 * s);
    const cx = (g.minX + g.maxX) / 2, cz = (g.minZ + g.maxZ) / 2, hw = (g.maxX - g.minX) / 2;
    ctx.fillStyle = pal.sofa;
    for (const sd of [-1, 1]) this._rect(ctx, cx + sd * (hw - 1.3), cz + 1.4, 0.95, 3.0);
    ctx.fillStyle = pal.wood; this._rect(ctx, cx, cz + 2.4, 2.2, 1.0);
    ctx.fillStyle = pal.cabinet; this._rect(ctx, g.cabinet.x, g.cabinet.z, 2.4, 0.8);
    ctx.fillStyle = pal.cabinetDrawer; for (let c = 0; c < 3; c++) this._rect(ctx, g.cabinet.x - 0.78 + c * 0.78, g.cabinet.z + 0.3, 0.7, 0.14);
    if (s > 6) { ctx.fillStyle = this.tokens.muted; ctx.font = `600 ${Math.round(Math.max(9, Math.min(11, s * 0.36)))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tr('flat.vx.lounge'), this._X(cx), this._Y(g.maxZ) - Math.max(6, 0.5 * s)); }
    ctx.globalAlpha = 1;
  }
  _drawSessDyn(ctx, s, now) {
    const lay = this.layout, pal = this.pal, t = this.tokens;
    this._cabRects = [];
    // 컨텍스트: 뒤 벽 창 흐림·서류 더미
    for (const r of this.rooms) {
      if (!r._on || r.type !== 'office' || r.past) continue;
      const v = this.vis.get(r.ownerId), c = v && v.node.meta && v.node.meta.ctx;
      if (!c || !isFinite(c.pct)) continue;
      const fog = Math.max(0, Math.min(1, (c.pct - 35) / 55));
      const fw = windowWall(r) === 'front';
      const rl = this._rotBegin(ctx, r);
      ctx.globalAlpha = (r._alpha ?? 1) * (0.55 + 0.45 * fog);
      ctx.fillStyle = fog > 0.5 ? pal.fogGlass : pal.window;
      if (fw) this._rect(ctx, rl.origin.x + 0.9, rl.bounds.maxZ - 0.2, 5.6, 0.3);
      else this._rect(ctx, rl.origin.x + 5, rl.origin.z - 8.8, 7.2, 0.3);
      const piles = Math.max(0, Math.min(5, Math.floor((c.pct - 35) / 12)));
      if (rl.leadDesk && piles) { ctx.fillStyle = pal.paper; for (let i = 0; i < piles; i++) this._rect(ctx, rl.leadDesk.x + (i % 2 ? 0.5 : -0.5), rl.leadDesk.z - 0.2 + Math.floor(i / 2) * 0.18, 0.34, 0.26); }
      this._rotEnd(ctx, r);
    }
    // 캐비닛 경고등 + 파일명
    if (lay && lay.lounges) for (const g of lay.lounges) {
      const ps = this.vsess.pairsOf(g);
      if (!ps.length) continue;
      const strong = ps.some((p) => p.level === 'strong' && !p.fading);
      const on = this.reduced || Math.floor(now * (strong ? 4 : 2)) % 2 === 0;
      const k = Math.max(...ps.map((p) => p.k));
      ctx.globalAlpha = k * (on ? 1 : 0.35);
      ctx.fillStyle = t.conflict || '#ff9a3c';
      this._rect(ctx, g.cabinet.x, g.cabinet.z, 0.6, 0.6);
      if (on) { ctx.strokeStyle = t.conflict || '#ff9a3c'; ctx.lineWidth = strong ? 2 : 1; ctx.beginPath(); ctx.arc(this._X(g.cabinet.x), this._Y(g.cabinet.z), (1.4 + 0.3 * Math.sin(now * 6)) * s, 0, Math.PI * 2); ctx.stroke(); }
      const txt = '⚠ ' + this.vsess.cabText(ps);
      ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(txt).width + 14, x = this._X(g.cabinet.x), y = this._Y(g.cabinet.z) - Math.max(16, 1.6 * s);
      ctx.globalAlpha = k;
      ctx.fillStyle = t.isLight ? 'rgba(255,255,255,.92)' : 'rgba(20,24,34,.9)'; ctx.strokeStyle = t.conflict || '#ff9a3c'; ctx.lineWidth = strong ? 2 : 1;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - tw / 2, y - 9, tw, 18, 9) : ctx.rect(x - tw / 2, y - 9, tw, 18); ctx.fill(); ctx.stroke();
      ctx.fillStyle = t.text; ctx.fillText(txt, x, y + 0.5);
      (this._cabRects || (this._cabRects = [])).push([x - tw / 2, y - 9, x + tw / 2, y + 9]);
    }
    ctx.globalAlpha = 1;
  }
  _drawPlanes(ctx, s, now) {
    const pal = this.pal;
    for (const p of this.vsess.livePlanes(now)) {
      const a = this.vis.get(p.from), b = this.vis.get(p.to);
      if (!a || !b || a.hidden || b.hidden) continue;
      const u = ease(Math.min(1, (now - p.t0) / PLANE_DUR));
      const x = a.pos.x + (b.pos.x - a.pos.x) * u, z = a.pos.z + (b.pos.z - a.pos.z) * u - Math.sin(u * Math.PI) * 2.5;
      const ang = Math.atan2(b.pos.z - a.pos.z, b.pos.x - a.pos.x), X = this._X(x), Y = this._Y(z), R = Math.max(5, 0.5 * s);
      ctx.fillStyle = pal.plane; ctx.strokeStyle = p.color; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(X + Math.cos(ang) * R, Y + Math.sin(ang) * R);
      ctx.lineTo(X + Math.cos(ang + 2.5) * R, Y + Math.sin(ang + 2.5) * R);
      ctx.lineTo(X - Math.cos(ang) * R * 0.3, Y - Math.sin(ang) * R * 0.3);
      ctx.lineTo(X + Math.cos(ang - 2.5) * R, Y + Math.sin(ang - 2.5) * R);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }

  _drawFacilities(ctx, r, s, now) {
    const pal = this.pal, L = this.tokens.isLight;
    const st = r.stations;
    if (!st) return;
    const showText = s >= 16;
    if (showText) { ctx.font = `500 ${Math.round(Math.min(10, s * 0.3))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; }
    for (const cat of Object.keys(st)) {
      if (cat === 'workflow' || cat === 'agent' || cat === 'notify') continue; // 포털·벨은 따로
      const f = CAT_FACILITY[cat];
      const rc = facilityRect(st[cat]);
      if (!rc || !f) continue;
      ctx.fillStyle = f === 'shelf' ? pal.woodDark : f === 'files' ? pal.metalDark : f === 'board' ? pal.board : f === 'toolbox' ? pal.toolbox : f === 'antenna' ? pal.antenna
        : f === 'terminal' ? pal.screenOff : f === 'kiosk' ? pal.kiosk : f === 'screens' ? pal.metalDark : pal.metal;
      this._rect(ctx, rc.x, rc.z, rc.w, rc.d);
      if (f === 'shelf' && s > 6) { // 책 줄
        const n = Math.max(2, Math.round(Math.max(rc.w, rc.d) / 0.35));
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = pal.books[i % pal.books.length];
          const u = (i + 0.5) / n - 0.5;
          if (rc.d > rc.w) this._rect(ctx, rc.x, rc.z + u * rc.d, rc.w * 0.7, rc.d / n * 0.7); else this._rect(ctx, rc.x + u * rc.w, rc.z, rc.w / n * 0.7, rc.d * 0.7);
        }
      }
      if (showText) { ctx.fillStyle = this.tokens.muted; ctx.globalAlpha = r._alpha * 0.85; this._text(ctx, FACILITY_LABEL[f] || '', this._X(rc.x), this._Y(rc.z) + (rc.d > rc.w ? 0 : (rc.z > r.origin.z ? 1 : -1) * Math.max(8, rc.d * s))); ctx.globalAlpha = r._alpha; }
    }
    // 포털(에이전트 부르기 — 새 직원이 여기서 나온다)
    if (r.portal) {
      const px = this._X(r.portal.x), py = this._Y(r.portal.z);
      ctx.strokeStyle = pal.portal; ctx.lineWidth = Math.max(1.2, 0.18 * s);
      ctx.beginPath(); ctx.ellipse(px, py, 0.7 * s, 0.3 * s, 0, 0, Math.PI * 2); ctx.stroke();
      if (showText) { ctx.fillStyle = this.tokens.muted; this._text(ctx, FACILITY_LABEL.portal, px, py + Math.max(9, 0.7 * s)); }
    }
    if (r.bell) {
      ctx.fillStyle = pal.bell;
      ctx.beginPath(); ctx.arc(this._X(r.bell.x), this._Y(r.bell.z), Math.max(1.5, 0.28 * s), 0, Math.PI * 2); ctx.fill();
    }
  }

  /** 움직이는 층(방마다): 팀장·직원 책상 화면(작업 중 종류 색), 쓰는 중인 시설 테두리(맥동), 포털 열림, 벨 흔들림 */
  _drawRoomDyn(ctx, r, s, now) {
    const pal = this.pal, L = this.tokens.isLight;
    ctx.globalAlpha = r._alpha;
    if (r.leadDesk) {
      const d = r.leadDesk;
      const lead = this.chars.get(r.ownerId);
      if (lead && lead._monK > 0.05) { ctx.fillStyle = lead._monCat === 'skill' ? this.tokens.skill : catColor(lead._monCat || 'other', L); this._rect(ctx, d.x, d.z + 0.33, 1.1, 0.09); }
    }
    for (const d of r.desks) {
      const ch = d.occupant && this.chars.get(d.occupant);
      if (ch && ch.state !== 'gone' && ch.state !== 'leave' && ch._monK > 0.05) { ctx.fillStyle = ch._monCat === 'skill' ? this.tokens.skill : catColor(ch._monCat || 'other', L); this._rect(ctx, d.x, d.z + 0.23, 0.7, 0.08); }
    }
    const act = r._act;
    if (act && s > 2.5) {
      const st = r.stations;
      if (st) for (const cat of Object.keys(st)) {
        if (cat === 'workflow' || cat === 'agent' || cat === 'notify') continue;
        const f = CAT_FACILITY[cat], on = f && act[f];
        if (!on) continue;
        const rc = facilityRect(st[cat]);
        if (!rc) continue;
        const pulse = this.reduced ? 1 : 0.65 + 0.35 * Math.sin(now * 5);
        ctx.globalAlpha = r._alpha * pulse; ctx.strokeStyle = on === 'skill' ? this.tokens.skill : catColor(on, L); ctx.lineWidth = Math.max(1.2, 0.12 * s);
        ctx.strokeRect(this._X(rc.x - rc.w / 2), this._Y(rc.z - rc.d / 2), rc.w * s, rc.d * s);
        ctx.globalAlpha = r._alpha;
      }
      if (r.portal && act.portal) {
        ctx.strokeStyle = pal.portal; ctx.fillStyle = pal.portalCore; ctx.lineWidth = Math.max(1.2, 0.18 * s);
        ctx.beginPath(); ctx.ellipse(this._X(r.portal.x), this._Y(r.portal.z), 1.0 * s, 0.3 * s, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = r._alpha * 0.6; ctx.fill(); ctx.globalAlpha = r._alpha;
      }
      if (r.bell && act.bell) {
        ctx.fillStyle = pal.bell; ctx.strokeStyle = this.tokens.skill; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(this._X(r.bell.x) + (this.reduced ? 0 : Math.sin(now * 16) * 0.12 * s), this._Y(r.bell.z), Math.max(1.5, 0.28 * s), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawMachine(ctx, m, v, s, now) {
    const pal = this.pal, t = this.tokens;
    const A = (m.pos && this.roomsById.get(m.pos.roomId) && this.roomsById.get(m.pos.roomId)._alpha) ?? 1;
    const sk = v.scopeK ?? 1;
    const k = v.drawS || 1;
    const flash = Math.max(0, Math.min(1, (m.flashUntil - now) / 0.35));
    const st = m.node.status;
    const x = this._X(m.pos.x), y = this._Y(m.pos.z);
    v._sp = v._sp || {}; v._sp.x = x; v._sp.y = y;
    ctx.globalAlpha = A * Math.min(1, sk * 1.3) * (m.removing ? 0.4 + 0.6 * flash : 1);
    const foc = m.id === this.focusId || m.id === this.hoverId;
    if (m.type === 'job') { this._drawJob(ctx, m, v, s, now, foc); ctx.globalAlpha = 1; return; }
    const led = st === 'active' ? (this.reduced || Math.sin(now * 6 + m.id.length) > 0 ? pal.led : pal.ledIdle) : st === 'error' ? t.error : isEnded(m.node) ? pal.ledOff : pal.ledIdle;
    if (m.type === 'rack') {
      const w = 0.75 * s * k, h = 1.0 * s * k;
      ctx.fillStyle = pal.metalDark; ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.strokeStyle = flash > 0.2 ? t.text : pal.metal; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
      ctx.fillStyle = led; ctx.fillRect(x - w * 0.3, y - h * 0.3, w * 0.6, Math.max(1, h * 0.1));
      ctx.fillStyle = this.kindColor('bash-bg'); ctx.fillRect(x - w * 0.3, y + h * 0.15, w * 0.6, Math.max(1, h * 0.08));
    } else if (m.type === 'screen') {
      const mr = this.roomsById && this.roomsById.get(m.pos.roomId), odd = !!(mr && mr.xf && quarter(mr.xf.k) % 2);
      const w = (odd ? 1.2 : 0.25) * s * k, h = (odd ? 0.25 : 1.2) * s * k; // 돌린 방의 모니터 벽은 가로로
      const on = st === 'active' || st === 'idle';
      ctx.fillStyle = m.standby ? pal.screenOff : on ? (st === 'active' ? this.kindColor('monitor') : pal.screenDim) : pal.screenOff;
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      if (flash > 0.2) { ctx.strokeStyle = t.text; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2, y - h / 2, w, h); }
    } else if (m.type === 'batch') {
      // 복합기(배치 장치): 몸통 + 종류 색 덮개 테두리 + 표시창 진행·표시등·상태 띠 5칸 + 출력 받침
      const w = 1.9 * s * k, h = 1.25 * s * k, R = 1.0 * s * k;
      ctx.fillStyle = pal.metal; ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.strokeStyle = this.kindColor('bash-bg'); ctx.lineWidth = Math.max(1, 0.1 * s); ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = pal.screenOff; ctx.fillRect(x - w * 0.44, y - h * 0.42, w * 0.88, h * 0.84);
      if (!v.devInfo) this._syncDevice(v);
      drawDeviceFace(this, ctx, v, x, y, w, h, R, ctx.globalAlpha, now);
      ctx.globalAlpha = A * Math.min(1, sk * 1.3);
      ctx.fillStyle = pal.paper; ctx.fillRect(x - w * 0.25, y + h / 2, w * 0.5, Math.max(1.5, 0.25 * s)); // 출력 받침의 종이
    } else if (m.type === 'board') {
      // 워크플로 화이트보드: 회의실 보드 위에 진행 점(구성원 수·끝난 수)
      let a = 0, d = 0;
      for (const ch of this.chars.values()) if (ch.node.parentId === m.id) { a++; if (isEnded(ch.node)) d++; }
      const n = Math.min(12, a);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = i < d ? t.ok : this.kindColor('workflow');
        ctx.beginPath(); ctx.arc(x - 1.3 * s + (i + 0.5) * (2.6 * s / Math.max(1, n)), y, Math.max(1, 0.09 * s), 0, Math.PI * 2); ctx.fill();
      }
    }
    if (foc) { ctx.globalAlpha = 0.9; ctx.strokeStyle = t.text; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, (m.type === 'batch' ? 1.4 : 0.8) * s, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }

  /**
   * 작업 칩(위에서 본 현황판 카드): 판 뒤판 한 칸 + 흰 카드 + 왼쪽 상태 띠 + 진행 막대 + 오른쪽 표시등(정체 = 끊긴 맥박)·대기 모래시계.
   * 칩 줄은 판 앞쪽(face)으로 늘어서고, 카드 긴 쪽은 판을 보는 사람의 오른쪽(3D 와 같은 축)
   */
  _drawJob(ctx, m, v, s, now, foc) {
    const pal = this.pal, t = this.tokens;
    const md = jobCardModel(m.node, this.clock(), now, this.reduced);
    if (!md) return;
    const k = v.drawS || 1, f = m.pos.face || 0;
    const fx = Math.round(Math.sin(f)), fz = Math.round(Math.cos(f)), rx = Math.round(Math.cos(f)), rz = Math.round(-Math.sin(f));
    const c = v._sp; // 칩 중심(화면) — _syncActors 가 v.pos 를 칩 자리로 둔다
    const p = jobFlatPos(m.pos, this._jfp2 || (this._jfp2 = {}));
    c.x = this._X(p.x); c.y = this._Y(p.z);
    // 지역 (u = 오른쪽, w = 판 앞쪽) 사각형 → 화면 사각형
    const rect = (u, w, du, dw, col) => {
      const cx = c.x + (rx * u + fx * w) * s, cy = c.y + (rz * u + fz * w) * s;
      const W = (Math.abs(rx) * du + Math.abs(fx) * dw) * s, H = (Math.abs(rz) * du + Math.abs(fz) * dw) * s;
      ctx.fillStyle = col; ctx.fillRect(cx - W / 2, cy - H / 2, W, H);
    };
    const D = (JOBCARD.CHIP - 0.05) * k, CW = JOBCARD.W * k;
    const sc = jobColorHex(md.key, t, pal);
    const a0 = ctx.globalAlpha;
    rect(0, 0, JOBCARD.BOARD_W, JOBCARD.CHIP + 0.005, pal.boardFrame);
    if (m.pos.hi) rect(0, JOBCARD.CHIP / 2, JOBCARD.BOARD_W + 0.04, 0.05, this.kindColor('bash-bg'));
    let card = pal.board;
    if (md.dim) card = mixHex(card, pal.boardFrame, 0.35); else if (md.ended) card = mixHex(card, pal.boardFrame, 0.18);
    if (md.key === 'stale' && md.lamp > 0.5) card = mixHex(card, sc, 0.3);
    rect(0, 0, CW, D, card);
    if (s < 6) { rect(-CW / 2 + 0.05, 0, 0.1, D, sc); return; } // 멀면 띠만
    rect(-CW / 2 + 0.035, 0, 0.05, D - 0.02, sc);
    if (md.progress != null) {
      const tw = 0.4, u0 = -CW / 2 + 0.08, pr = Math.max(0, Math.min(1, md.progress));
      rect(u0 + tw / 2, 0, tw, 0.06, pal.metalDark);
      if (pr > 0.005) rect(u0 + (tw * pr) / 2, 0, tw * pr, 0.045, sc);
    } else {
      rect(-CW / 2 + 0.2, -0.03, 0.22, 0.025, pal.boardFrame); // 글 줄 흉내
      rect(-CW / 2 + 0.17, 0.03, 0.16, 0.02, pal.boardFrame);
    }
    const ru = CW / 2 - 0.07;
    if (md.wait != null) {
      // 모래시계(위에서 본 네모): 테두리 + 아래쪽(판 앞쪽)부터 차오름
      const cx = c.x + rx * ru * s, cy = c.y + rz * ru * s, R = 0.065 * s;
      ctx.strokeStyle = pal.metalDark; ctx.lineWidth = Math.max(1, 0.015 * s); ctx.strokeRect(cx - R, cy - R, 2 * R, 2 * R);
      const fw = 0.13 * md.wait;
      if (fw > 0.004) rect(ru, 0.065 - fw / 2, 0.12, fw, sc);
    } else {
      const cx = c.x + rx * ru * s, cy = c.y + rz * ru * s;
      ctx.globalAlpha = a0 * (md.lamp > 0.05 ? 0.35 + 0.65 * md.lamp : 1);
      ctx.fillStyle = md.lamp > 0.05 ? sc : pal.ledOff;
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.2, 0.05 * s), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = a0;
    }
    if (foc) { ctx.globalAlpha = 0.9; ctx.strokeStyle = t.text; ctx.lineWidth = 1.2; const W = (Math.abs(rx) * 0.84 + Math.abs(fx) * 0.3) * s, H = (Math.abs(rz) * 0.84 + Math.abs(fz) * 0.3) * s; ctx.strokeRect(c.x - W / 2, c.y - H / 2, W, H); }
  }

  _drawChar(ctx, ch, v, s, now) {
    const t = this.tokens, pal = this.pal, L = t.isLight;
    const R = v._R;
    if (R < 0.6) return;
    const { x, y } = v._sp;
    const sk = v.scopeK ?? 1;
    const n = ch.node;
    const room = ch.room && this._dimRooms && this._dimRooms.has(ch.room.id);
    const alpha = Math.min(1, sk * 1.3) * (room ? 0.6 : 1);
    const doneLead = ch.lead && isEnded(n);
    // 복장: 팀장 정장(넥타이 = 메인 색) · 별관 팀장 보라 정장 · 운영자 형광 조끼 · 손님 외투 · 팀원 종류 색 셔츠
    const role = roleOf(ch.kind, ch.seat ? ch.seat.kind : null, ch.lead);
    const body = doneLead ? t.stopped : role === 'lead' ? pal.suit : role === 'annex' ? pal.suitP : role === 'operator' ? pal.vest : role === 'guest' ? pal.coat : this.kindColor(ch.kind);
    ctx.globalAlpha = alpha;
    if (R < 2) { ctx.fillStyle = body; ctx.fillRect(x - 1, y - 1, 2, 2); ctx.globalAlpha = 1; return; }
    // 작업 중: 옅은 고리(맥동), 걷는 중: 그림자
    if (ch.state === 'work' && !doneLead) {
      const pulse = this.reduced ? 0.6 : 0.45 + 0.35 * Math.sin(now * 5 + ch.phase);
      ctx.globalAlpha = alpha * pulse * 0.5;
      ctx.fillStyle = ch.workCat === 'skill' ? t.skill : catColor(ch.workCat || 'other', L);
      ctx.beginPath(); ctx.arc(x, y, R * 1.55, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = alpha;
    }
    // 몸(위에서 본 어깨 원) + 머리(피부색 작은 원, 바라보는 쪽으로)
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(1, R * 0.14);
    ctx.strokeStyle = ch.lead && !doneLead ? t.skill : L ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.35)';
    ctx.stroke();
    const dv = yawVec(ch.yaw || 0);
    const walkBob = (ch.state === 'walk' || ch.state === 'leave' || ch.state === 'enter') && !this.reduced ? Math.sin(ch.phase * 2) * 0.08 : 0;
    ctx.fillStyle = SKIN[ch.hash % 4];
    ctx.beginPath(); ctx.arc(x + dv.x * R * (0.42 + walkBob), y + dv.z * R * (0.42 + walkBob), R * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = pal.hair[(ch.hash >>> 3) % 4];
    ctx.beginPath(); ctx.arc(x + dv.x * R * 0.3, y + dv.z * R * 0.3, R * 0.3, 0, Math.PI * 2); ctx.fill();
    // 지휘·감독: 팀원 쪽으로 뻗은 오른팔(소매 선 + 손)
    if (ch.sup && ch.target && ch.target.type === 'oversee' && R > 3) {
      const w = Math.min(1, Math.sin(Math.min(1, ch.sup.k) * Math.PI) * 1.8);
      const sx = x - dv.z * R * 0.55, sy = y + dv.x * R * 0.55, ex = sx + dv.x * R * 1.5 * w, ey = sy + dv.z * R * 1.5 * w;
      ctx.strokeStyle = body; ctx.lineWidth = Math.max(1.2, R * 0.32); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.fillStyle = SKIN[ch.hash % 4]; ctx.beginPath(); ctx.arc(ex, ey, R * 0.2, 0, Math.PI * 2); ctx.fill();
    }
    // 사원증(세션 색 또는 종류 색) · 넥타이 · 커피(탕비실·대기)
    if (R > 4) {
      const sc = this.vsess.sessColor(n) || (role === 'lead' ? this.kindColor('main') : this.kindColor(ch.kind));
      ctx.fillStyle = sc; ctx.fillRect(x - dv.z * R * 0.1 - R * 0.13, y + dv.x * R * 0.1 - R * 0.13, R * 0.26, R * 0.26);
      const brk = ch.target && ch.target.type === 'break';
      if (brk || (ch.state === 'seated' && ch.readUntil > now)) { ctx.fillStyle = brk ? pal.mug : pal.paper; ctx.beginPath(); ctx.arc(x + dv.x * R * 0.9 - dv.z * R * 0.6, y + dv.z * R * 0.9 + dv.x * R * 0.6, R * 0.22, 0, Math.PI * 2); ctx.fill(); }
      if (ch.errand && ch.target && ch.target.type === 'errand' && ch.errand.kind === 'ask') { ctx.fillStyle = t.skill; ctx.font = `700 ${Math.round(R * 1.1)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', x, y - R * 1.5); }
    }
    // 표식: 팀장 금색 배지, claude -p 네모(왕관), 워크플로 에이전트 목걸이 점
    if (R > 4) {
      if (ch.kind === 'claude-p') { ctx.fillStyle = mixHat(body); ctx.fillRect(x - R * 0.28, y - R * 0.28, R * 0.56, R * 0.56); }
      else if (ch.lead) { ctx.fillStyle = t.skill; ctx.beginPath(); ctx.arc(x - dv.z * R * 0.55, y + dv.x * R * 0.55, R * 0.2, 0, Math.PI * 2); ctx.fill(); }
      else if (ch.kind === 'workflow-agent') { ctx.fillStyle = this.kindColor('workflow'); ctx.beginPath(); ctx.arc(x, y, R * 0.18, 0, Math.PI * 2); ctx.fill(); }
    }
    // 오류: 빨간 고리(처음 깜빡)
    const errOn = n.status === 'error' || ch.errUntil > now || ch.errFlashUntil > now;
    if (errOn) {
      ctx.strokeStyle = t.error; ctx.lineWidth = Math.max(1.2, R * 0.16);
      if (!(ch.errFlashUntil > now && Math.floor(now / 0.15) % 2)) { ctx.beginPath(); ctx.arc(x, y, R * 1.3, 0, Math.PI * 2); ctx.stroke(); }
    }
    // 시설 없이 제자리 작업: 머리 위 작은 상자(종류 색)
    if (ch.state === 'work' && ch.inPlace && R > 3) { ctx.fillStyle = catColor(ch.workCat || 'other', L); ctx.fillRect(x + R * 0.6, y - R * 1.2, R * 0.5, R * 0.5); }
    if (v.id === this.focusId || v.id === this.hoverId) { ctx.globalAlpha = 0.9; ctx.strokeStyle = t.text; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(x, y, R * 1.45 + 2, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }

  dispose() { this.bubbles.dispose(); super.dispose(); }
}

/** claude -p 왕관 색(몸 색을 25% 어둡게) — 문자열 연산을 줄이려 몸 색별로 기억 */
const HAT = new Map();
function mixHat(c) {
  let h = HAT.get(c);
  if (!h) {
    const m = /^#([0-9a-f]{6})/i.exec(c);
    h = m ? '#' + [0, 2, 4].map((i) => Math.round(parseInt(m[1].slice(i, i + 2), 16) * 0.75).toString(16).padStart(2, '0')).join('') : c;
    HAT.set(c, h);
  }
  return h;
}
export { displayKind };
