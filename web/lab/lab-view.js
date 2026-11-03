// 복셀 연구소(Voxel Lab) 3D 렌더러 — 표현 id 'lab'(설계 대안 A: 말굽 동심 호 책상 + 뒤쪽 높은 브리지). 리드(통합) 소유.
// VoxelView(복셀 오피스)를 그대로 이어받고 갈고리만 바꾼다 — 캐릭터·상태 머신·자리 예약·홀로그램 모니터·말풍선·과열·POV 는 손대지 않음.
//   배치      _computeLayout  → 단일 세션 lab-layout-core computeLab · 전체 보기 lab-campus-core computeLabCampus(프로젝트마다 원형 연구동)
//   정적      _buildRoom      → lab-props buildLabShell(바닥·외벽·책상·브리지·라운지) + (첫 구역 방만) lab-platform buildPlatformStatic
//                               + lab-rigs buildRigRingStatic · _buildBuilding(전체 보기) → lab-props buildLabDome(비활성 = 돔 닫힘)
//   동적      _drawRoomFacilities → drawLabFacilities + 비워 둔 기자재 자리(drawRigVacant) · _drawRoomDesks → drawLabDeskEmitters
//   기자재    _drawMachineAt(type 'rig' · 연구소 기동기 'batch') → lab-rigs drawRig(st.ix·far·standby·lift 채움)
//             _machineExitReady → 승강판으로 내려가는 0.8초(rigLiftSec) 뒤 놓아줌 · 비운 자리는 VACANT_S/배속 동안 예약(computeLab reserved)
//   작업 대상 _makeArtLayer   → lab-platform LabPlatform3D(가운데 원형 플랫폼, 장부)
//   바닥 높이 _floorY         → 브리지 덱 1.6 · 경사로 보간
//   프레임    _frameHook      → 현장 걷기(FieldPlanner, ⚙ Lab 줄·ctl labwalk) · 연구소 효과음(연출·기자재 정체) · 전체 보기 반지름 게이트
//                               · 대량 변경 파도 → 일한 사람 머리 위 ×N 칩(_bulkChip)
//    반지름 각 유지 보간(_relayout → RadiusTween, _drawDynamic 이 앉은 사람 ch.pos · 기자재·시료 카드는 그리는 자리만 보간
//               _tweenPos 한 곳: _drawMachineAt 몸체 · _drawJob 카드 · _labelPass 이름표 · _holoPass 기동기 대시보드 · _drawSpawnLinks 띄움 점선 · _machineRing 바닥 고리 · _posOf 말풍선 · _syncVis 초점 대상, 같은 k)
//             · 주인 책상→기자재 케이블(_drawRoomFacilities → drawLabRigCables) · 표지 _extraLabels(put, ctx)(office _labelPass 갈고리:
//               ×N 칩 · rigMore '+n', lab-marks-core labMarks) · 시료 카드는 computeLab 이 machine type 'job' 으로 냄(VoxelView _drawJob — 보간 중만 자리 사본)
// C   상호작용 — 특별 상호작용 ix(vx-ix 연구소 분기 → _labIxDraw → lab-ix drawLabIx: 코어·DB 탱크·원격 안테나·시험 신호탑)
//             · 운반 캡슐(lab-ix-core LabCouriers·courierFor): 서브에이전트 생성 = 의뢰서(콘솔 → 새 책상) · 끝 = 보고(책상 → 콘솔) ·
//               기자재 run → done = 산출(꼭대기 → 반출대 θ45 · 탱크는 DB 탱크 방울) — _drawRoomFacilities 첫 연구동 방에서 drawCouriers
//             · 사람 몸짓 ch.gesture(lab-gesture-core — character.js poseBase 한 줄 갈고리): _walk 성공(install·watch·kill·field·alarm) ·
//               의뢰(dispatch)·보고 받기(receive) · 케이블 데이터 펄스(_cableInfo.pulseOf — 출력 = m.flashUntil 상승 · 끝·실패·설치)
//             · drawRig 부드러운 계약 st.ts·st.reduced·st.camD(lab-rigs 가 읽음)
// 각 모듈의 입력·출력·성능 상한은 그 파일 머리 주석(모듈 규격). 공용 상수는 lab-const.mjs 한 곳.
import { VoxelView } from '../voxel/office.js';
import { t as _t } from '../i18n.mjs';
import { LAB, LAB_CAMERA, platformRadius, thetaOf, dTheta } from './lab-const.mjs';
import { computeLab, labFloorY } from './lab-layout-core.mjs';
import { navSolid, navPathBlocked, navSpot } from '../voxel/nav-core.mjs';
import { computeLabCampus } from './lab-campus-core.mjs';
import { buildLabShell, drawLabFacilities, drawLabDeskEmitters, buildLabDome, drawLabRigCables } from './lab-props.js';
import { radialLerp, RadiusTween, labMarks, LAB_MARKS } from './lab-marks-core.mjs';
import { buildPlatformStatic, LabPlatform3D } from './lab-platform.js';
import { buildRigRingStatic, drawRig, drawRigVacant, clearRigDyn } from './lab-rigs.js';
import { rigIxOf, rigLiftK, rigLiftSec, rigState, rigRc, rigStaleMs, RIGW, RIG_HEIGHT, RIG_KIND_HEX } from './lab-rig-core.mjs';
import { LabCouriers, courierFor, labIxRoute, labIxShouldDraw, newPulseMem, cablePulseEdge, cablePulsePush, cablePulseRead, labPendStep, LAB_IX } from './lab-ix-core.mjs';
import { drawLabIx, drawCouriers, drawWatchBeam, hexColor } from './lab-ix.js';
import { labGestureSet, labGestureArrive, gestureT0, GESTURE_STAY } from './lab-gesture-core.mjs';
import { LabRadiusGate, newBulkMem, bulkNote } from './lab-platform-core.mjs';
import { FieldPlanner, walkKindFor, conflictSpots, labWalksToStation } from './lab-walk-core.mjs';
import { labSoundFor } from './lab-audio.mjs';
import { labWalkOn, onLabWalk } from './lab-pref.mjs';
import { packView, camElev } from '../overview/pack-view.js';

const LAB_RIG_HALF = LAB.RIG.SIZE / 2; // 기자재 길찾기 상자 반폭(lab-layout-core sq(m, SIZE / 2))
const SUBK = new Set(['subagent', 'workflow-agent']);
const walking = (ch) => ch.state === 'walk' || ch.state === 'leave' || ch.state === 'enter';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class LabView extends VoxelView {
  static modeId = 'lab';
  static modeLabel = _t('scene.mode.lab');
  static family = 'voxel';

  constructor(container, labelContainer, opts = {}) {
    super(container, labelContainer, opts);
    Object.assign(this.cameraPrefs, LAB_CAMERA);
    this.camera.fov = this.cameraPrefs.fov;
    this.camera.updateProjectionMatrix();
    this.labRP = platformRadius(); // 단일 세션: LabPlatform3D 가 보이는 대상 수로 정해 setPlatformRadius 를 부름(커질 때 바로 · 줄 때 10분)
    this.field = new FieldPlanner(); // 현장 걷기(설계)
    this.walkOn = labWalkOn();
    this._offWalk = onLabWalk((v) => { this.walkOn = v; if (!v) this._clearWalks(); });
    this._vacant = new Map();       // 고리 칸 i → {i, x, z, face, until} 퇴장 뒤 비워 둔 자리(단일 세션)
    this._campusGate = new Map();   // pid → LabRadiusGate(전체 보기 연구동별 플랫폼 반지름)
    this._campusRP = new Map();     // pid → 지금 배치에 쓴 반지름
    this._actSeen = new WeakSet(); this._fxSeen = new WeakSet(); this._bulk = newBulkMem();
    this._bulkChip = new Map();     // 사람 id → {n, until(초), key(구역)} 대량 변경 ×N 칩
    this._bulkWho = new Map();      // 구역 열쇠 → 그 구역 최근 쓰기 노드
    this._rt = null;                // 반지름 보간 {tw:RadiusTween, cx, cz, m:Map id→from, c:Map id→from}
    this._rigAt = -1;
    this.labSound = null;           // app 이 꽂음: (name) → sfx.playLab(name)
    // 밀어내기가 사람을 책상·기자재·벽 안으로 밀지 않게(QA 10.31. — 큰 원형 방은 길 띠가 좁아 0.42 밀림에도 가구에 닿음)
    this._crowdSolid = (ch, x, z) => !!(ch.room && ch.room.type === 'lab' && navSolid(ch.room, x, z));
    this._pathChkVer = -1;
    // 계단(브리지 경사로) 위를 걷는 사람(11.01.): 목표를 바꾸지 않고(character-core _decide) 길 다시 찾기도 경사로를 지난 뒤로 미룸(_replanBlocked)
    this._ctx.onRamp = (ch) => this._onRamp(ch);
    this._replanLater = false;
    // 전체 보기: 간판·방 문패 상자를 이름표가 비킴 · 원경에서 오래 도는 셸 이름표 생략 — 연구소만(VoxelView 기본은 꺼짐)
    this._labelDodgeSigns = true;
    this._farSkipRunLabels = true;
    this._labelCap = 32;            // 이름표 칸(office _labels 32 중) — 복셀 오피스는 24
    this._dashNameOnly = true;      // 시퀀서(기동기): 대시보드 판 글이 읽히는 동안 이름표에서 이름 빼기(QA 7 — 이름 두 번)
    // C 상호작용(모두 사건에 묶임 — 프레임 할당 0: 풀·버퍼·함수는 여기서 한 번)
    this._cour = new LabCouriers(LAB_IX.COURIERS); // 운반 캡슐(의뢰·보고·산출)
    this._pendDisp = [];            // 배치를 기다리는 의뢰 {id, at}(새 책상이 정해진 뒤 캡슐)
    this._repAt = new Map();        // 서브에이전트 id → 보고 캡슐 시각(updateNode·result 중복 막기, 재개하면 지움)
    this._courCtx = { layout: null, nodeOf: (id) => this.nodes.get(id) || null };
    this._pendTry = (p) => this._tryDispatch(p);
    this._lixRoute = { from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 0 }, dir: 'out', key: '', rig: null, m: 1 };
    this._lixQ = { x: 0, z: 0, rigKind: null };
    this._lixRigOf = (id) => { // 연구소 기자재 그리는 자리(반지름 보간 포함) | null
      const m = this.machines.get(id);
      if (!m || m.released || !this._isLabRig(m)) return null;
      const p = this._tweenPos(m), q = this._lixQ;
      q.x = p.x; q.z = p.z; q.rigKind = m.pos.rigKind || null;
      return q;
    };
    this._lixAt = -1; this._lixUsed = 0; this._courAt = -1;
  }
  dispose() { if (this._offWalk) this._offWalk(); super.dispose(); }
  reset() {
    super.reset(); this._clearWalks(); this._vacant.clear(); this._bulk = newBulkMem(); this._bulkChip.clear(); this._bulkWho.clear(); this._rt = null;
    if (this._cour) { this._cour.clear(); this._pendDisp.length = 0; this._repAt.clear(); }
    clearRigDyn(); // 재생 seek: 같은 id 의 옛 동작 상태로 사건 없는 시동·감속 전이가 돌지 않게
  }

  /** 플랫폼 반지름 바꾸기(LabPlatform3D 가 부름 — 0.5 단위·히스테리시스는 부르는 쪽) */
  setPlatformRadius(r) { if (Number.isFinite(r) && Math.abs(r - this.labRP) > 1e-3) { this.labRP = r; this.layoutDirty = true; this.staticSig = ''; } }

  // ---------------- 배치 ----------------
  /** 기자재 종류 판정용 ix 범주: node.meta.ix.cat → 띄운 호출의 IxModel 효과 */
  _ixCat(id) {
    const n = this.nodes.get(id);
    const c = n && n.meta && n.meta.ix && n.meta.ix.cat;
    if (c) return c;
    const fx = this.ix && this.ix.model && this.ix.model.fx;
    if (!fx || !fx.size) return null;
    const tu = n && n.meta && n.meta.toolUseId;
    if (tu && fx.has(tu)) return fx.get(tu).cat || null;
    for (const f of fx.values()) if (f.bgNode === id) return f.cat || null;
    return null;
  }
  _reserved() {
    const now = this._now || 0, s = new Set();
    for (const [i, v] of this._vacant) { if (v.until > now) s.add(i); else this._vacant.delete(i); }
    return s;
  }
  /** 전체 보기 연구동 플랫폼 반지름(장부가 있으면 보이는 대상 수 → 게이트, 없으면 기본) */
  _rPOf(pid) {
    const book = this.vArt && this.vArt.st && this.vArt.st.book;
    if (!book || !pid) return platformRadius();
    let g = this._campusGate.get(pid);
    if (!g) { g = new LabRadiusGate(null); this._campusGate.set(pid, g); }
    let n = 0; try { n = book.layoutItems(pid).items.length; } catch (e) { n = 0; }
    return g.step(n, this.clock ? this.clock() : Date.now());
  }
  _computeLayout(present, campus) {
    const ixCatOf = (id) => this._ixCat(id);
    if (campus) {
      const lay = computeLabCampus(present, this.scope.roots, this.scope.projects, this.layout && this.layout.campus && this.layout.lab ? this.layout : null, {
        showInactive: this.scope.showInactive, nowMs: Date.now(), view: packView(this.container, { prefs: this.cameraPrefs, elev: camElev(this.camera) }),
        rPOf: (pid) => { const r = this._rPOf(pid); this._campusRP.set(pid, r); return r; }, ixCatOf,
      });
      return lay;
    }
    return computeLab(present, this.rootId, this.layout && this.layout.lab && !this.layout.campus ? this.layout : null, { rP: this.labRP, ixCatOf, reserved: this._reserved() });
  }
  _relayout(now) {
    const before = this.layout;
    // 반지름이 바뀌면(단일 세션) 각 그대로 반지름만 보간 — 바뀌기 전 지금 보이는 자리를 잡아 둔다
    const single = this.scope.mode !== 'all' && before && before.lab && !before.campus && before.rooms && before.rooms[0];
    const rp0 = single ? before.rooms[0].lab.rP : null;
    const fromM = new Map(), fromC = new Map();
    if (rp0 != null) {
      // 기자재 + 시료 카드(주인 자리가 연구동 안) — 카드도 몸체와 같이 미끄러지게(이미 보간 중이면 보간 자리에서 이어서)
      for (const m of this.machines.values()) if ((this._isLabRig(m) || this._isLabJob(m)) && m.pos && !m.released) fromM.set(m.id, this._shownAt(m.id, m.pos));
      for (const ch of this.chars.values()) {
        if (!ch.placed || ch.offstage || !ch.seat || !ch.atDesk()) continue;
        fromC.set(ch.id, { x: ch.pos.x, z: ch.pos.z, roomId: ch.seat.roomId, sx: ch.seat.x, sz: ch.seat.z });
      }
    }
    super._relayout(now);
    if (before && before !== this.layout && (!!before.campus !== !!this.layout.campus)) { this._clearWalks(); this._vacant.clear(); this._rt = null; } // 범위가 바뀜 = 자리 체계가 바뀜
    const lay = this.layout, r0 = lay && !lay.campus && lay.rooms && lay.rooms[0];
    if (rp0 != null && r0 && r0.lab && Math.abs(r0.lab.rP - rp0) > 1e-3) this._startRadiusTween(now, r0.lab, fromM, fromC);
  }
  /** 연구동 안 시료 카드(machine type 'job' — 주인 기자재·책상·덱 앞 판)인가 */
  _isLabJob(m) {
    if (!m || m.type !== 'job' || !m.pos) return false;
    const r = this.roomsById && this.roomsById.get(m.pos.roomId);
    return !!(r && r.type === 'lab');
  }
  /**
   * 그리는 자리: 반지름 보간 중인 기자재·시료 카드면 보간 사본(x·z = radialLerp, 나머지 필드 = m.pos 복사 · y 는 새 값), 아니면 m.pos 그대로.
   * 사본은 기계마다 하나(m._tq) — 배치가 바뀌어 m.pos 객체가 바뀔 때만 새로 만든다(프레임마다 할당 0 · 다른 기계 필드가 섞이지 않게).
   * 원본 m.pos 는 새 값 그대로(길찾기·걷기 목표). _labelPass 가 m.pos 를 사본으로 바꿔 둔 동안(_twSwap)은 겹쳐 보간하지 않게 그대로 돌려줌.
   */
  _tweenPos(m) {
    const p = m && m.pos, rt = this._rt;
    if (!p || !rt || this._twSwap) return p;
    const f = rt.m.get(m.id), now = this._now || 0;
    if (!f || rt.tw.done(now)) return p;
    let q = m._tq;
    if (!q || m._tqSrc !== p) { q = m._tq = {}; m._tqSrc = p; m._tqAt = -1; }
    else if (m._tqAt === now && m._tqRt === rt) return q; // 같은 프레임·같은 보간이면 이미 계산한 사본(몸체·고리·대시보드·점선·이름표·말풍선·초점이 한 프레임에 여러 번 부름)
    Object.assign(q, p);
    m._tqAt = now; m._tqRt = rt;
    return radialLerp(f, m.pos, rt.cx, rt.cz, rt.tw.k(now), q);
  }
  /** 지금 그려지는 자리(보간 중이면 보간 자리) */
  _shownAt(id, pos) {
    const rt = this._rt, f = rt && rt.m.get(id);
    return f ? radialLerp(f, pos, rt.cx, rt.cz, rt.tw.k(this._now || 0), {}) : { x: pos.x, z: pos.z };
  }
  /** 반지름 보간 시작: 기자재는 그리는 자리만, 앉아 있던 사람(같은 자리 각)은 걷지 않고 미끄러짐.
   *  정적 가구(플랫폼·책상·브리지·벽)는 새 자리로 바로 옮겨지므로, 미끄러질 길(옛 반지름 → 새 자리, 같은 각 직선)이 새 배치의 가구 상자를
   *  지나는 것은 미끄러뜨리지 않고 가구와 함께 바로 옮김(_slideClear) — 커질 때 앉은 사람이 자기 책상을, 크게 바뀔 때 기자재가 플랫폼·책상을 뚫고 지나가지 않게.
   *  주인 기자재가 바로 옮겨지면 그 시료 카드도 바로(몸체 앞 1.05m 유지). */
  _startRadiusTween(now, lab, fromM, fromC) {
    if (this.reduced) { this._rt = null; return; } // 움직임 줄이기 = 즉시
    const { cx, cz } = lab, c = new Map();
    const room = this.layout && this.layout.rooms && this.layout.rooms.find((r) => r.lab && r.lab.cx === cx && r.lab.cz === cz);
    if (room) {
      const cut = new Set();
      for (const [id, f] of fromM) {
        const m = this.machines.get(id), p = m && m.pos;
        if (!p || m.type === 'job') continue;
        const own = p.type === 'batch' ? 0.8 : p.shelf ? 0.42 : LAB_RIG_HALF; // 자기 새 길찾기 상자(lab-layout-core navBoxes 와 같은 반폭)
        if (!this._slideClear(room, f, p, own, cx, cz)) { fromM.delete(id); cut.add(id); }
      }
      for (const [id, f] of fromM) {
        const m = this.machines.get(id), p = m && m.pos;
        if (!p || m.type !== 'job') continue;
        if ((p.owner != null && cut.has(p.owner)) || !this._slideClear(room, f, p, 0, cx, cz)) fromM.delete(id);
      }
    }
    for (const [id, f] of fromC) {
      const ch = this.chars.get(id), s = ch && ch.seat;
      if (!s || s.roomId !== f.roomId) continue;
      if (Math.abs(dTheta(thetaOf(cx, cz, f.sx, f.sz), thetaOf(cx, cz, s.x, s.z))) > 0.5) continue; // 자리 각이 바뀜(다른 책상) = 걸어감
      ch.snapNext = true; // 같은 자리 각 = 걷지 않음(상태 머신은 그대로: 새 자리로 순간 이동 — 미끄러지면 _stepRadiusTween 이 보간 자리로 덮어씀)
      if (room && !this._slideClear(room, f, s, 0, cx, cz)) continue; // 미끄러질 길에 (이미 옮겨진) 책상·가구 = 책상과 함께 새 자리로 바로(순간 이동만)
      c.set(id, { x: f.x, z: f.z });
    }
    this._rt = (fromM.size || c.size) ? { tw: new RadiusTween(now, this.ts || 1, false), cx, cz, m: fromM, c } : null;
  }
  /**
   * 반지름 보간 길(radialLerp k 0 → 1 = 새 자리 각의 옛 반지름 점 → 새 자리, 직선)이 새 배치 가구 상자(navSolid) 밖인가 — 0.1m 간격 표본.
   * own > 0 이면 새 자리 둘레 자기 상자(반폭 own + 0.05)는 뺀다. 배치가 바뀔 때만 부름(보간 대상마다 ≤ 수십 표본, 격자 O(1)).
   */
  _slideClear(room, f, to, own, cx, cz) {
    const a = radialLerp(f, to, cx, cz, 0, this._slA || (this._slA = { x: 0, z: 0 }));
    const dx = to.x - a.x, dz = to.z - a.z, n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1)), h = own + 0.05;
    for (let i = 0; i <= n; i++) {
      const x = a.x + dx * (i / n), z = a.z + dz * (i / n);
      if (own > 0 && Math.abs(x - to.x) <= h && Math.abs(z - to.z) <= h) continue;
      if (navSolid(room, x, z)) return false;
    }
    return true;
  }
  /** 보간 중인 사람 자리 덮어쓰기(상태 머신·밀어내기 뒤, 그리기 앞) — 걷기 시작한 사람은 놓아줌 */
  _stepRadiusTween(now) {
    const rt = this._rt;
    if (!rt) return;
    const k = rt.tw.k(now), done = rt.tw.done(now);
    for (const [id, f] of rt.c) {
      const ch = this.chars.get(id);
      if (!ch || !ch.atDesk() || !ch.seat) { rt.c.delete(id); continue; }
      const to = ch._goal || ch.seat;
      if (done) { ch.pos.x = to.x; ch.pos.z = to.z; continue; }
      radialLerp(f, to, rt.cx, rt.cz, k, ch.pos);
    }
    if (done) this._rt = null;
  }

  // ---------------- 정적 ----------------
  _buildRoom(r, b, o) {
    if (r.type !== 'lab') return super._buildRoom(r, b, o);
    buildLabShell(r, this.pal, b, o);
    if (r.lab && r.lab.primary === false) return; // 다중 메인 구역: 플랫폼·기자재 고리는 첫 구역 방에서 한 번(같은 자리)
    buildPlatformStatic(r, this.pal, b, o);
    buildRigRingStatic(r, this.pal, b, o);
  }
  _buildBuilding(bd, b, dim) {
    if (!bd || !bd.lab) return super._buildBuilding(bd, b, dim);
    buildLabDome(bd, this.pal, b, { dim });
  }
  _staticSigExtra() {
    let s = '';
    for (const r of this.rooms || []) if (r.lab && r.lab.primary !== false) s += `lab:${r.lab.cx},${r.lab.cz}:${r.lab.rP}:${r.lab.rows}:${r.lab.zones ? r.lab.zones.length : 1}:${r.lab.doorTheta}|`;
    const bs = this.layout && this.layout.buildings;
    if (bs) for (const b of bs) if (b.lab) s += (b.dome ? 'D' : 'o');
    return s;
  }

  // ---------------- 동적 ----------------
  _drawRoomFacilities(r, act, t, B, dim) {
    if (r.type !== 'lab') return super._drawRoomFacilities(r, act, t, B, dim);
    drawLabFacilities(r, act, this.pal, this.tokens, t, B, dim);
    if (r.lab && r.lab.primary !== false && !dim && !this._farAll) drawLabRigCables(r, this.layout, B, this.pal, this._cableInfo(t)); // 주인 책상 → 기자재
    if (r.lab && r.lab.primary !== false && this._courAt !== t) { this._courAt = t; this._drawLabC(r, B, t); } // C 운반 캡슐·들여다보기 빛줄(프레임에 한 번)
    if (r.lab && r.lab.primary !== false && this._vacant.size && !(this.scope && this.scope.mode === 'all')) {
      const now = this._now || 0, span = RIGW.VACANT_S / Math.max(1, this.ts || 1);
      for (const v of this._vacant.values()) if (v.until > now) drawRigVacant(v, Math.min(1, (v.until - now) / span), this.pal, B);
    }
  }
  _drawRoomDesks(r0, B, now) {
    if (r0.type !== 'lab') return super._drawRoomDesks(r0, B, now);
    drawLabDeskEmitters(r0, B, this.pal, (id) => {
      const ch = this.chars.get(id);
      if (!ch || ch.state === 'gone' || ch.state === 'leave') return null;
      return { state: this._deskState(ch, now), color: this._emitCol(ch), k: ch._monK || 0 };
    });
  }
  /** 케이블 정보(재사용 객체): 주인 · 주인 세션 색 · 기자재 상태 */
  _cableInfo(t) {
    const ci = this._ci || (this._ci = {
      t: 0, clk: 0,
      ownerOf: (id) => { const n = this.nodes.get(id); return n ? n.parentId || null : null; },
      colorOf: (o) => {
        const s = this.layout && this.layout.seat.get(o), r = s && this.roomsById && this.roomsById.get(s.roomId);
        const main = r ? this.nodes.get(r.ownerId) : null;
        return (main && this.sess && this.sess.sessColor && this.sess.sessColor(main)) || this.tokens['flow-call'] || this.tokens.text;
      },
      stateOf: (id) => { const m = this.machines.get(id); return m && !m.released ? (m._rs || rigState(m.node, ci.clk, m.pos && m.pos.rigKind)) : 'stop'; },
      // 반지름 보간 중이면 기자재 몸체가 그려지는 보간 자리(_drawMachineAt 과 같은 rt.m · rt.tw.k) — 케이블 끝이 몸체와 벌어지지 않게
      rigAt: (id, m) => { const rt = this._rt, f = rt && rt.m.get(id); return f ? radialLerp(f, m, rt.cx, rt.cz, rt.tw.k(this._now || 0), ci._q) : m; },
      _q: { x: 0, z: 0 },
      // C 데이터 펄스: 출력(app output → wave → m.flashUntil 상승, 진행 중일 때만) · 끝 초록 · 실패 빨강 · 설치(책상 → 기자재)
      pulseOf: (id, out) => {
        const m = this.machines.get(id);
        if (!m || m.released || this.reduced) return 0;
        const now = this._now || 0, mem = m._cp || (m._cp = newPulseMem());
        if (cablePulseEdge(mem, m.flashUntil, now)) { const s = ci.stateOf(id); if (s === 'run' || s === 'stale' || s === 'wait') cablePulsePush(mem, now, 0); }
        return cablePulseRead(mem, now, LAB_IX.PULSE_S / Math.sqrt(Math.max(1, this.ts || 1)), out);
      },
      light: false,
    });
    ci.t = this.reduced ? 0 : t; ci.clk = this.clock(); ci.light = !!(this.tokens && this.tokens.isLight);
    return ci;
  }
  /** 연구소 기자재(고리 rig · 브리지 뒤 시퀀서)인가 */
  _isLabRig(m) { return !!(m && m.pos && (m.pos.type === 'rig' || (m.pos.type === 'batch' && m.pos.rigKind))); }
  _drawMachineAt(m, st, B) {
    if (!this._isLabRig(m)) return super._drawMachineAt(m, st, B);
    const now = this._now || 0;
    if (m.endWall == null && m.liftT0 != null) m.liftT0 = null; // 다시 살아남(재무장·되감기)
    if (!m._ixAt || now - m._ixAt > 0.25) { m._ixAt = now; m._ix = rigIxOf(this.ix && this.ix.model, m.node); }
    st.ix = m._ix || null;
    const cp = this.camera.position, dx = cp.x - m.pos.x, dz = cp.z - m.pos.z, dy = cp.y;
    const d2 = dx * dx + dz * dz + dy * dy;
    st.far = !!this._farAll || d2 > 120 * 120;
    // 부드러운 계약(lab-rigs 가 읽음 — 없으면 기존 st.far 만): 배속 · 움직임 줄이기 · 카메라 거리(LOD 근경 ≤ 60 · 중경 ≤ 120)
    st.ts = this.ts || 1; st.reduced = !!this.reduced; st.camD = Math.sqrt(d2);
    st.watch = m._watchAt === now; // 들여다보기: 렌즈·화면 밝기 +30% — 그리는 값만(lab-rigs drawRig). 동작 펄스(rigDynStep)에 넣는 st.flash 는 그대로(가짜 출력 펄스 방지)
    st.standby = !!m.standby;
    st.lift = rigLiftK(m.liftT0, now, this.ts);
    // 반지름 보간: 그리는 자리만(원본 pos 는 새 값 — 길찾기·걷기 목표는 새 자리 · 카드·이름표·말풍선은 _drawJob·_labelPass·_posOf 가 같은 _tweenPos)
    return drawRig(this._tweenPos(m), st, this.pal, this.tokens, B, m.node, this.clock());
  }
  /** 시료 카드: 반지름 보간 중이면 주인 기자재 몸체와 같은 보간 자리에 그림(m.pos 를 잠시 사본으로 바꿨다가 되돌림) */
  _drawJob(m, now, clockMs, B) {
    const p = m.pos, q = this._tweenPos(m);
    if (q === p) return super._drawJob(m, now, clockMs, B);
    m.pos = q;
    try { return super._drawJob(m, now, clockMs, B); } finally { m.pos = p; }
  }
  /**
   * 이름표(office _labelPass — 기자재 실행·포커스 이름표 · 시료 카드 작업 이름표 · 말풍선): 보간 동안은 0.2초 문구 캐시를 건너뛰어
   * 매 프레임 다시 만들고(fixed 이름표는 캐시 동안 자리를 안 따라감), 호출 동안 보간 대상 기자재·카드의 m.pos 를 보간 사본으로 바꿨다가 되돌림.
   * 보간이 끝난 첫 프레임에 한 번 더 만들어 새 자리로 정착.
   */
  _labelPass(now) {
    const rt = this._rt;
    if (!rt || !rt.m.size || this._twSwap) {
      if (this._lblTw) { this._lblTw = false; this._lblAt = 0; }
      return super._labelPass(now);
    }
    this._lblTw = true; this._lblAt = 0;
    const n = this._twSwapIn();
    try { return super._labelPass(now); } finally { this._twSwapOut(n); }
  }
  /** 기동기 대시보드(vx-holo launcherDash(m.pos)): 보간 동안 시퀀서 몸체·이름표와 같은 보간 자리(이름표와 같은 m.pos 바꾸기) */
  _holoPass(now, dt) {
    const rt = this._rt;
    if (!rt || !rt.m.size || this._twSwap) return super._holoPass(now, dt);
    const n = this._twSwapIn();
    try { return super._holoPass(now, dt); } finally { this._twSwapOut(n); }
  }
  /** 띄움 점선(office _drawSpawnLinks at → m.pos): 보간 동안 시퀀서·기자재 끝을 몸체와 같은 보간 자리로(사람 끝은 ch.pos 가 이미 보간 자리) */
  _drawSpawnLinks() {
    const rt = this._rt, ids = this._spawnIds;
    if (!rt || !rt.m.size || this._twSwap || !(ids && ids.length)) return super._drawSpawnLinks(); // 점선이 없으면 바꾸기 없이(바탕이 숨김만)
    const n = this._twSwapIn();
    try { return super._drawSpawnLinks(); } finally { this._twSwapOut(n); }
  }
  /** 초점·가리킴 바닥 고리(office _drawDynamic → _machineRing): 연구소 기자재는 몸체(_drawMachineAt)와 같은 보간 자리 */
  _machineRing(m, G) {
    return super._machineRing(m, G, this._isLabRig(m) ? this._tweenPos(m) : m.pos);
  }
  /** 보간 대상 기자재·카드의 m.pos 를 보간 사본으로 바꿈(배열 재사용) → 바꾼 개수. 반드시 _twSwapOut(n) 으로 되돌림 */
  _twSwapIn() {
    const rt = this._rt, sm = this._twSm || (this._twSm = []), sp = this._twSp || (this._twSp = []);
    let n = 0;
    for (const id of rt.m.keys()) {
      const m = this.machines.get(id);
      if (!m || !m.pos || m.released) continue;
      const q = this._tweenPos(m);
      if (q === m.pos) continue;
      sm[n] = m; sp[n] = m.pos; n++;
      m.pos = q;
    }
    this._twSwap = true;
    return n;
  }
  _twSwapOut(n) {
    const sm = this._twSm, sp = this._twSp;
    this._twSwap = false;
    for (let i = 0; i < n; i++) { sm[i].pos = sp[i]; sm[i] = null; sp[i] = null; }
  }
  /** 말풍선 자리(office _posOf → bubbles posOf): 보간 중인 기자재·시료 카드는 보간 자리(높이는 새 값) */
  _posOf(id) {
    const p = super._posOf(id);
    const rt = this._rt;
    if (!p || this._twSwap || !rt || !rt.m.has(id)) return p;
    const ch = this.chars.get(id);
    if (ch && ch.state !== 'gone' && ch.placed) return p; // 사람은 ch.pos 가 이미 보간 자리
    const m = this.machines.get(id), q = m && !m.released ? this._tweenPos(m) : null;
    if (q && q !== m.pos) { p.x = q.x; p.z = q.z; }
    return p;
  }
  /** 초점·효과 대상(office _syncVis vis.target): 보간 중인 기자재·시료 카드는 보간 자리 */
  _syncVis(now) {
    super._syncVis(now);
    const rt = this._rt;
    if (!rt || !rt.m.size || !this.vis) return;
    for (const id of rt.m.keys()) {
      const v = this.vis.get(id), m = this.machines.get(id);
      if (!v || !v.target || !m || m.released) continue;
      const q = this._tweenPos(m);
      if (q && q !== m.pos) { v.target.x = q.x; v.target.z = q.z; }
    }
  }
  /** 끝난 기자재: 승강판으로 내려가는 시간(배속 √) 뒤 놓아줌 · 재무장 대기 Monitor 는 내려가지 않음 */
  _machineExitReady(m, now) {
    if (!this._isLabRig(m) || m.standby) return true;
    if (m.liftT0 == null) { m.liftT0 = now; this._sound('lab-lift'); return false; }
    if (now < m.liftT0 + rigLiftSec(this.ts)) return false;
    if (m.pos.type === 'rig' && m.pos.slot != null && m.pos.slot < 1000 && !(this.scope && this.scope.mode === 'all')) {
      this._vacant.set(m.pos.slot, { i: m.pos.slot, x: m.pos.x, z: m.pos.z, face: m.pos.face, until: now + RIGW.VACANT_S / Math.max(1, this.ts || 1) });
    }
    return true;
  }
  /** 기자재 초점 이름표: 종류 · 종료 코드 · 정체 분 */
  _machineLabelExtra(m, clockMs, run = false) {
    if (!this._isLabRig(m)) return '';
    const n = m.node, kind = m.pos.rigKind || 'meter';
    let s = ' · ' + _t('lab.rig.' + kind);
    const rc = rigRc(n);
    if (rc != null && rc !== 0) s += ' · ' + _t('lab.rig.rc', { n: rc });
    const st = rigState(n, clockMs, kind);
    if (st === 'stale' && !run) { const q = rigStaleMs(n, clockMs); if (q != null) s += ' · ' + _t('lab.rig.stale', { n: Math.max(1, Math.round(q / 60000)) }); }
    return esc(s);
  }
  _roomLabelOn(r) { return !(r && r.type === 'lab' && r.lab && r.lab.primary === false); } // 다중 메인 구역: 문패는 첫 구역 방 하나
  _makeArtLayer(opts) { return new LabPlatform3D(this.scene, this, opts); }
  _floorY(ch) { const r = ch && ch.room; return r && r.lab ? labFloorY(r.lab, ch.pos.x, ch.pos.z) : 0; }

  // ---------------- 프레임 갈고리 ----------------
  _sound(name) { if (name && this.labSound) { try { this.labSound(name); } catch (e) { /* 소리 없음 */ } } }
  _clearWalks() {
    this.field.clear();
    for (const ch of this.chars.values()) if (ch.visit && ch.visit.field) ch.visit = null;
  }
  /**
   * 배치가 바뀐 뒤(가구는 새 자리로 바로): (1) 새 상자가 선 사람 위에 놓였으면(기자재가 생김·책상 열·반지름이 바뀌어 책상이 옮겨 옴) 가장 가까운 빈 칸으로
   * 비켜 세움(navSpot — 상자 안을 걸어 나오지 않게, 책상에 앉은 사람은 snapNext 로 이미 새 자리) · (2) 걷던 남은 길이 새 상자를 지나면 지금 자리에서 다시 찾음.
   */
  _replanBlocked() {
    let n = 0;
    for (const ch of this.chars.values()) {
      if (!ch.placed || ch.offstage || ch.state === 'gone' || !ch.room || ch.room.type !== 'lab' || (ch.atDesk && ch.atDesk())) continue;
      if (!navSolid(ch.room, ch.pos.x, ch.pos.z)) continue;
      const q = navSpot(ch.room, { x: ch.pos.x, z: ch.pos.z });
      if (q && !navSolid(ch.room, q.x, q.z)) { ch.pos.x = q.x; ch.pos.z = q.z; }
    }
    let later = false;
    for (const ch of this.chars.values()) {
      if (!ch.path || !ch.room || ch.room.type !== 'lab' || (ch.state !== 'walk' && ch.state !== 'leave')) continue;
      if (this._onRamp(ch)) { later = true; continue; } // 경사로 위: 다 내려가거나 오른 뒤 다시 봄(목표를 비우면 되돌아 걷는다)
      const tail = ch.path.slice(Math.max(0, ch.pi || 0));
      const rest = navSolid(ch.room, ch.pos.x, ch.pos.z) ? tail : [{ x: ch.pos.x, z: ch.pos.z }, ...tail]; // 이미 상자 곁(자리)이면 출발 조각은 빼고
      if (navPathBlocked(ch.room, rest) && ch.replan(ch.room)) n++;
    }
    this._replanLater = later;
    return n;
  }
  /** 경사로(계단) 위인가 — 발밑 높이가 바닥(0)과 덱(BRIDGE.Y) 사이 */
  _onRamp(ch) {
    const r = ch && ch.room;
    if (!r || !r.lab) return false;
    const y = labFloorY(r.lab, ch.pos.x, ch.pos.z);
    return y > 0.01 && y < LAB.BRIDGE.Y - 0.01;
  }
  /** 사람 하나를 현장으로(걷기 계획이 허락하면 visit 로 — character-core 가 연구소면 방 안 길로 걷는다) */
  _walk(kind, nodeId, target, now) {
    if (!this.walkOn || !kind) return false;
    const ch = this.chars.get(nodeId);
    if (!ch || !ch.placed || ch.offstage || ch.state === 'gone' || ch.state === 'leave' || !ch.room || ch.room.type !== 'lab' || ch.lead) return false;
    if (ch.visit && ch.visit.until > now && !ch.visit.field) return false; // 충돌 방문 중
    const res = this.field.want(kind, ch.id, { ...target, room: ch.room, from: ch.pos }, now, this.ts || 1);
    if (!res) return false;
    ch.visit = { spot: res.spot, until: res.until, field: kind };
    // C 몸짓: 도착(추정) 뒤 머무는 동안 — 같은 예약을 다시 받으면(현장 투입 간격) 이어서
    const g = ch.gesture;
    if (GESTURE_STAY[kind] && !(g && g.kind === kind && g.res === res.until)) labGestureSet(ch, kind, gestureT0(now, ch.pos, res.spot, this.ts || 1, res.until), res.until, target.rigId || null);
    return true;
  }
  _frameHook(now, dt) {
    const all = this.scope && this.scope.mode === 'all';
    // 배치가 바뀌면(기자재가 생기고 빠짐·책상 열·플랫폼 반지름) 걷던 길이 새 장애물을 지나는지 보고 지금 자리에서 다시 찾는다
    if (this._pathChkVer !== this._layoutVer || this._replanLater) { this._pathChkVer = this._layoutVer; this._replanBlocked(); }
    // 전체 보기: 연구동별 반지름 게이트가 바뀌면 다시 배치(1초마다)
    if (all && this.layout && this.layout.lab && now - (this._rpChk || 0) > 1) {
      this._rpChk = now;
      for (const [pid, r] of this._campusRP) if (Math.abs(this._rPOf(pid) - r) > 1e-3) { this.layoutDirty = true; break; }
    }
    // 기자재 정체 전이 소리(진행·끝·실패는 앱 이벤트 → Sfx.onEvent 가 lab-rig-* 로 냄) — 0.25초마다
    if (now - this._rigAt > 0.25) {
      this._rigAt = now;
      const clk = this.clock();
      for (const m of this.machines.values()) {
        if (!this._isLabRig(m) || m.released) continue;
        const s = rigState(m.node, clk, m.pos.rigKind);
        if (m._rs && m._rs !== s && s === 'stale') this._sound(labSoundFor({ type: 'rig-state' }, { view: 'lab', rigState: s }));
        if (m._rs && m._rs !== s) this._rigTrans(m, m._rs, s, now); // C 산출 캡슐·케이블 끝 펄스·주인 멈칫
        m._rs = s;
      }
    }
    // 작업 대상 연출 → 연구소 소리 · 현장 걷기
    const F = this.vArt && this.vArt.st && this.vArt.st.fx;
    if (!F) return;
    const nowSec = performance.now() / 1000;
    const acts = F.acts && F.acts.list;
    if (acts) for (const e of acts) {
      if (this._actSeen.has(e)) continue;
      this._actSeen.add(e);
      if (nowSec - e.t0 > 2) continue; // 되감기·스냅샷으로 들어온 오래된 연출
      const nm = labSoundFor(null, { view: 'lab', act: e.a });
      if (nm && e.a !== 'radar') this._sound(nm);
      const kind = walkKindFor({ act: e.a });
      if (kind && e.node) this._walk(kind, e.node, this._targetOf(e.pid, e.id), now);
    }
    for (const e of F.list) {
      if (this._fxSeen.has(e)) continue;
      this._fxSeen.add(e);
      if (nowSec - e.t0 > 2) continue;
      if (e.kind === 'alarm') { this._sound('lab-alarm'); if (e.node) this._walk('alarm', e.node, this._targetOf(e.pid, e.id), now); }
      else if (e.kind === 'absorb') this._sound('lab-absorb');
      else if (e.kind === 'lit' && (e.amp || 1) >= 1 && this.vArt.planOf) {
        const P = this.vArt.planOf(e.pid), c = P && P.cellOf.get(e.id), sk = c ? c.sector : P && P.bundleOf.get(e.id);
        if (!sk) continue;
        const key = e.pid + '|' + sk;
        if (e.node) this._bulkWho.set(key, e.node);
        const n = bulkNote(this._bulk, key, e.t0, nowSec);
        if (n) { this._sound('lab-wave'); this._noteBulk(e.node || this._bulkWho.get(key), n, key, now); }
        else if (e.node) { // 같은 사람이 파도를 이어 가면 칩 숫자 갱신
          const w = this._bulk.wave.get(key), ch = this._bulkChip.get(e.node);
          if (w && ch && ch.key === key && w.n > ch.n) { ch.n = w.n; ch.until = now + LAB_MARKS.CHIP_S; }
        }
      }
    }
  }
  /** 대량 변경 파도 → 일한 사람 머리 위 ×N 칩(4초) */
  _noteBulk(nodeId, n, key, now) {
    if (!nodeId || !(n > 0)) return;
    const c = this._bulkChip.get(nodeId);
    if (c && c.until > now && c.key === key) { c.n = Math.max(c.n, n); c.until = now + LAB_MARKS.CHIP_S; return; }
    this._bulkChip.set(nodeId, { n, until: now + LAB_MARKS.CHIP_S, key });
    for (const [id, v] of this._bulkChip) if (v.until <= now) this._bulkChip.delete(id);
  }
  /**
   * 표지 갈고리(계약 A — office.js _labelPass 가 `if (this._extraLabels) this._extraLabels(put, {fid, hid, clockMs, farAll})` 로 부름).
   * put(id, html, cls, x, y, z, ref = null, fixed = true). 머리 위 ×N 칩('lab-chip bulk') · 주인별 '+n'('lab-chip more'), 원경 생략, 합 ≤ 6.
   */
  _extraLabels(put, ctx = {}) {
    if (!put || ctx.farAll || this._farAll || !this.layout || !this.layout.lab) return;
    const now = this._now || 0;
    // 할당 0: 자리 함수·옵션·결과 배열은 한 번 만들어 다시 씀(표지 글은 '×n'·'+n' 숫자뿐이라 esc 필요 없음)
    const mo = this._marksOpt || (this._marksOpt = {
      farAll: false,
      posOf: (id, out) => {
        const ch = this.chars.get(id);
        if (!ch || !ch.placed || ch.offstage || ch.state === 'gone' || this._isDim(id)) return null;
        out.x = ch.pos.x; out.z = ch.pos.z; out.floorY = this._floorY(ch);
        return out;
      },
    });
    const ks = labMarks(this.layout, this._bulkChip, now, mo, this._marks || (this._marks = []));
    for (let i = 0; i < ks.length; i++) { const k = ks[i]; put(k.id, k.text, k.cls, k.x, k.y, k.z, null, true); }
  }
  /** 같은 파일 충돌(vx-sess-core 가 부름): 충돌 경로 꼬리와 맞는 플랫폼 블록 방위 | null */
  _conflictTheta(p, room) {
    const pid = this.scope && this.scope.mode === 'all' ? room.projectId : this.vArt && this.vArt.st && this.vArt.st.book.defaultProject;
    const P = this.vArt && this.vArt.planOf && pid ? this.vArt.planOf(pid) : null;
    if (!P) return null;
    const norm = (x) => String(x || '').replace(/\\/g, '/').toLowerCase();
    for (const tail of (p.paths || []).map(norm)) {
      if (!tail || tail === '?') continue;
      for (const [id, c] of P.cellOf) { const k = norm(id); if (k === tail || k.endsWith('/' + tail)) return c.theta; }
    }
    return null;
  }
  _conflictSpots(room, theta) { return conflictSpots(room, theta); }
  /** 시설 자리(office 갈고리): 연구소는 Agent·워크플로 도구면 포털로 가지 않고 자기 책상에서(null → character-core 가 책상 inPlace, 11.02.) */
  _stationSpot(ch, cat) {
    if (ch && ch.room && ch.room.type === 'lab' && !labWalksToStation(cat)) return null;
    return super._stationSpot(ch, cat);
  }
  /** 장부 대상 → 걷기 목표(플랫폼 칸 방위 · 테두리 장치 · 없으면 null) */
  _targetOf(pid, id) {
    const P = this.vArt && this.vArt.planOf ? this.vArt.planOf(pid) : null;
    if (!P || id == null) return { theta: null };
    const c = P.cellOf.get(id) || P.rim.get(id);
    if (c && Number.isFinite(c.theta)) return { theta: c.theta };
    const sk = P.bundleOf.get(id), s = sk && P.sectors.find((x) => x.key === sk);
    return s ? { theta: (s.th0 + s.th1) / 2 } : { theta: null };
  }

  // ---------------- 도구 이벤트: 들여다보기·끄기·기자재 설치 → 기자재 앞 ----------------
  toolStart(nodeId, ev = {}, quiet = false) {
    super.toolStart(nodeId, ev, quiet);
    if (quiet || !this.walkOn) return;
    const kind = walkKindFor({ tool: ev.tool, cat: ev.cat });
    if (kind !== 'watch' && kind !== 'kill') return;
    const rig = this._rigOfTool(ev);
    if (rig) this._walk(kind, nodeId, { rig: rig.pos, rigId: rig.id, until: kind === 'watch' ? (this._now || 0) + 20 : undefined }, this._now || 0);
  }
  /** TaskOutput·KillShell 의 대상 백그라운드 노드(입력 shell_id·task_id → meta 일치) */
  _rigOfTool(ev) {
    const inp = ev.input || {}, want = String(inp.shell_id || inp.bash_id || inp.task_id || inp.id || '');
    let best = null;
    for (const m of this.machines.values()) {
      if (!this._isLabRig(m) || m.released || m.pos.type !== 'rig') continue;
      const meta = m.node.meta || {};
      if (want && (m.id.endsWith(want) || meta.shellId === want || meta.taskId === want || meta.bgId === want)) return m;
      if (!best && m.node.parentId === ev.nodeId) best = m;
    }
    return best;
  }
  /** 기자재 설치(백그라운드 띄움): 띄운 사람이 새 기자재 앞으로 · C 서브에이전트 띄움: 의뢰서 캡슐(새 책상이 정해진 뒤) */
  addNode(n, animate = true) {
    super.addNode(n, animate);
    if (!animate || !n || !n.parentId) return;
    if (SUBK.has(n.kind) && this._pendDisp && this._pendDisp.length < 32) this._pendDisp.push({ id: n.id, at: this._now || 0 });
    if (n.kind !== 'bash-bg' && n.kind !== 'monitor') return;
    this._pendInstall = this._pendInstall || [];
    this._pendInstall.push({ id: n.id, owner: n.parentId, at: this._now || 0 });
  }
  /** C 서브에이전트 끝(status done/error): 보고 캡슐 + 팀장 보고 받기(도착 때) */
  updateNode(id, patch = {}, opts = {}) {
    super.updateNode(id, patch, opts);
    if (!this._repAt || !patch || !('status' in patch) || (opts && opts.quiet)) return;
    const n = this.nodes.get(id);
    if (!n || !SUBK.has(n.kind)) return;
    if (patch.status === 'active' || patch.status === 'idle') { this._repAt.delete(id); return; } // 재개 = 다음 끝에 다시 보고
    this._report(n, { type: 'node-update', node: n, patch });
  }
  /** C 서브에이전트 result 이벤트(흐름 연출 길 — quiet 제외)도 보고(끝 상태와 한 번만) */
  flowEvent(ev, opts = {}) {
    super.flowEvent(ev, opts);
    if (!this._repAt || !ev || ev.type !== 'result' || !ev.nodeId) return;
    const n = this.nodes.get(ev.nodeId);
    if (n && SUBK.has(n.kind)) this._report(n, { type: 'result', node: n, ok: ev.ok });
  }
  _report(n, ev) {
    if (this._repAt.has(n.id)) return;
    const now = this._now || 0;
    this._courCtx.layout = this.layout;
    const c = courierFor(ev, this._courCtx);
    if (!c) return;
    if (this._repAt.size > 256) this._repAt.clear();
    this._repAt.set(n.id, now);
    this._addCourier(c, now);
  }
  /** 배치를 기다리던 의뢰: 새 책상이 정해졌으면 캡슐(true = 처리됨) */
  _tryDispatch(p) {
    const lay = this.layout, n = this.nodes.get(p.id);
    if (!n) return true;
    if (!lay || !lay.lab || !(lay.seat instanceof Map) || !lay.seat.has(p.id)) return false;
    this._courCtx.layout = lay;
    const c = courierFor({ type: 'node-add', node: n }, this._courCtx);
    if (c) this._addCourier(c, this._now || 0);
    return true;
  }
  /** 기자재 상태 전이(0.25초 표본): run → done 산출 캡슐 · 끝·실패 케이블 펄스 · 실패면 주인 멈칫(0.9초) */
  _rigTrans(m, prev, s, now) {
    if (s !== 'done' && s !== 'fail') return;
    cablePulsePush(m._cp || (m._cp = newPulseMem()), now, s === 'done' ? 1 : 2);
    if (s === 'fail') {
      const ch = m.node && this.chars.get(m.node.parentId);
      if (ch && ch.placed && ch.state !== 'gone' && !walking(ch)) ch.flinchUntil = now + 0.9;
      return;
    }
    this._courCtx.layout = this.layout;
    const c = courierFor({ type: 'rig', node: m.node, prev, state: s, kind: m.pos.rigKind, pos: m.pos }, this._courCtx);
    if (c) { const p = this._tweenPos(m); if (p && p !== m.pos) { c.from.x = p.x; c.from.z = p.z; } this._addCourier(c, now); }
  }
  /** 캡슐 판 색 = 그 방 메인의 세션 색 */
  _courSess(owner) {
    const main = owner && this.nodes.get(owner);
    return (main && this.sess && this.sess.sessColor && this.sess.sessColor(main)) || this.tokens['flow-call'] || this.tokens.text;
  }
  /** courierFor 결과 → 캡슐(색: 'sess' 세션 색 · 'ok'·'fail' 보고 테(판은 세션 색) · 'rig:<종류>' 종류색, 시간 ÷√배속) */
  _addCourier(c, now) {
    const sq = Math.sqrt(Math.max(1, this.ts || 1));
    let col, rim;
    if (c.color && c.color.startsWith('rig:')) col = rim = hexColor((this.tokens.isLight ? RIG_KIND_HEX.light : RIG_KIND_HEX.dark)[c.color.slice(4)] || '#7aa2f7');
    else { col = this._courSess(c.owner); rim = c.color === 'ok' ? this.tokens.ok : c.color === 'fail' ? this.tokens.error : col; }
    const it = this._cour.add(c.kind, c.from.x, c.from.y, c.from.z, c.to.x, c.to.y, c.to.z, now, c.dur / sq, col, c.pri);
    if (!it) return null;
    it.c2 = rim || col; it.m = c.m || 1;
    if (c.kind === 'dispatch') { it.arr = c.arrive; it.act = 'flash'; }
    else if (c.kind === 'report' && c.lead) { it.arr = c.lead; it.act = 'receive'; }
    if (c.gesture === 'dispatch' && c.lead) { // 팀장 가리킴(걷는 중이면 생략)
      const ch = this.chars.get(c.lead);
      if (ch && ch.placed && !walking(ch)) labGestureSet(ch, 'dispatch', now, now + GESTURE_STAY.dispatch / sq);
    }
    return it;
  }
  /** 캡슐 도착: 새 책상 발광대 섬광 · 팀장 보고 받기(걷는 중이면 생략) */
  _courArrive(it, now) {
    const ch = it.arr && this.chars.get(it.arr);
    if (!ch || !ch.placed || ch.state === 'gone') return;
    if (it.act === 'flash') ch.flashUntil = now + 0.45;
    else if (it.act === 'receive' && !walking(ch)) labGestureSet(ch, 'receive', now, now + GESTURE_STAY.receive / Math.sqrt(Math.max(1, this.ts || 1)));
  }
  /** C 연구소 특별 상호작용(vx-ix draw 의 연구소 분기가 부름 — room.type 'lab' 일 때만). 그리면 true */
  _labIxDraw(B, f, act, room, sp, tt, te, A, ck, now) {
    if (!labIxShouldDraw(room) || !act) return false;
    if (this._lixAt !== now) { this._lixAt = now; this._lixUsed = 0; }
    if (this._lixUsed > LAB_IX.TOTAL_MAX - LAB_IX.FX_MAX) return false; // 프레임 합 ≤ 60 상자
    const ch = this.chars.get(act.id);
    act.floorY = ch ? this._floorY(ch) : 0; // 브리지 위 팀장(덱 1.6)
    const rt = labIxRoute(f, act, room, this._lixRigOf, this._lixRoute);
    if (!rt) return false;
    const ix = this.ix, used = drawLabIx(B, f, rt, tt, te, A, ck, ix.s, !!this.reduced, ix);
    this._lixUsed += used;
    return used > 0;
  }
  /** C 운반 캡슐 + 들여다보기 빛줄(첫 연구동 방 _drawRoomFacilities — 같은 동적 묶음) */
  _drawLabC(r, B, now) {
    const C = this._cour;
    if (!C) return;
    for (let i = 0; i < C.n; i++) { const it = C.list[i]; if (!it.hit && now >= it.t0 + it.dur) { it.hit = true; this._courArrive(it, now); } }
    C.step(now);
    const cp = this.camera.position, dx = cp.x - r.lab.cx, dz = cp.z - r.lab.cz, d2 = dx * dx + dz * dz + cp.y * cp.y;
    const far = this._farAll || d2 > 150 * 150 ? true : d2 > 60 * 60 || (this.ts || 1) >= 8 ? 'mid' : false; // 배속 ≥ 8 = 잔연출(꼬리) 생략
    if (C.n) drawCouriers(B.glow, B.lit, C.list, C.n, now, this.pal, !!this.reduced, far);
    if (far === true) return;
    const light = !!this.tokens.isLight;
    for (const ch of this.chars.values()) { // 들여다보기: 기자재 화면 → 손 빛줄 + 렌즈 밝기(_drawMachineAt 이 m._watchAt 을 읽음)
      const g = ch.gesture;
      if (!g || g.kind !== 'watch' || !(g.until > now) || !g.rig || walking(ch) || !(ch.target && ch.target.type === 'visit')) continue;
      const m = this.machines.get(g.rig);
      if (!m || m.released || !m.pos) continue;
      m._watchAt = now;
      if (far !== false) continue;
      const p = this._tweenPos(m), kind = m.pos.rigKind || 'meter', fy = this._floorY(ch);
      drawWatchBeam(B.glow, p.x, (RIG_HEIGHT[kind] || 1.4) * 0.75, p.z, ch.pos.x, fy + 1.1, ch.pos.z, now, hexColor((light ? RIG_KIND_HEX.light : RIG_KIND_HEX.dark)[kind] || '#7aa2f7'), !!this.reduced);
    }
  }
  _drawDynamic(now, dt) {
    this._stepRadiusTween(now); // 앉은 사람 반지름 보간(상태 머신·밀어내기 뒤, 그리기 앞)
    if (this._pendInstall && this._pendInstall.length) { // 배치가 기자재 자리를 정한 뒤(다음 배치) 걷기 · C 케이블 설치 펄스(책상 → 기자재)
      const keep = [];
      for (const p of this._pendInstall) {
        const m = this.machines.get(p.id);
        if (m && m.pos && m.pos.type === 'rig') {
          if (!this.reduced) cablePulsePush(m._cp || (m._cp = newPulseMem()), now, 3);
          if (this.walkOn) this._walk(walkKindFor({ spawnBg: true }), p.owner, { rig: m.pos, rigId: m.id }, now);
        } else if (now - p.at < 2) keep.push(p);
      }
      this._pendInstall = keep;
    }
    if (this._pendDisp && this._pendDisp.length) labPendStep(this._pendDisp, now, this._pendTry); // C 의뢰서 캡슐(새 책상 배치 뒤)
    for (const ch of this.chars.values()) if (ch.gesture && ch.gesture.wait) labGestureArrive(ch, now, this.ts || 1, walking(ch)); // 현장 몸짓은 실제 도착부터
    return super._drawDynamic(now, dt);
  }
}
