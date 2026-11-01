// 【모듈 규격 · 평면도(flat2d) 담당】 복셀 연구소 2D 평면도 — Lab2DView extends Voxel2DView(방식: 정적 층 캐시 + 캐릭터 원). three 0.
//
// ┌ 입력 ───────────────────────────────────────────────────────────────────────────────────────────┐
// │ Voxel2DView 와 같은 RendererView 인터페이스(addNode·updateNode·toolStart…). 배치는 3D 와 같은 순수 함수:                     │
// │   web/lab/lab-layout-core.mjs computeLab(_present, rootId, prev, {rP}) — 3D⇄2D 같은 자리(설계 3단계 시험)            │
// │ 좌표: lab-const.mjs(위에서 본 x→오른쪽, z→아래). 화면 변환은 FlatView._X(x)·_Y(z), 배율 s(px/m)                             │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// ┌ 출력 ─ export ──────────────────────────────────────────────────────────────────────────────────┐
// │ class Lab2DView (static modeId 'lab', modeLabel flat.mode.lab) — renderers.js RENDERERS_2D.lab 가 불러옴(LAB2D_READY 일 때)  │
// │ 정적 층(외벽 원·바닥·책상 호·브리지(높이 표시 그림자)·구역 판): 카메라·배치 판·테마가 같으면 drawImage 한 번                    │
// │ 동적: lab2d-platform.js(블록 점등·연출) · lab2d-rigs.js(기자재 원 아이콘 + 진행 호 + 상태색 테) · 캐릭터 원(그대로)       │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// 성능 상한(LAB_PERF.FLAT_EXTRA_MS): 갱신 1회 ≤ 복셀 2D + 1.5ms, 연출·걷기 없으면 그리지 않음(바탕 FlatView 루프: 바뀐 것 있을 때만 · 30fps 상한).
//
// 갈고리: Voxel2DView._computeLayout(present, campus) 를 덮어씀 — 단일 세션 computeLab, 전체 보기 computeLabCampus(3D 와 같은 함수·같은 자리).
//         다중 메인 구역(room.lab.primary === false): 공유 껍데기(바닥·플랫폼·기자재 고리·시설·외벽·문패)는 첫 구역 방에서 한 번,
//         책상·브리지·통신 스크린은 구역 방마다. 전체 보기 동(buildings): 연구동 바닥 원 + 비활성 = 닫힌 돔(빗금 원).
//         작업 대상 층(VoxelArt2D)은 연구소 배치에서는 쓰지 않고 가운데 플랫폼이 대신한다(전체 보기에서는 그대로).
import { Voxel2DView } from './voxel2d.js';
import { t as tr } from '../i18n.mjs';
import { CAT_FACILITY } from '../voxel/layout.js';
import { catColor } from '../flow-core.mjs';
import { LAB, platformRadius } from '../lab/lab-const.mjs';
import { computeLab } from '../lab/lab-layout-core.mjs';
import { computeLabCampus } from '../lab/lab-campus-core.mjs';
import { packView } from '../overview/pack-view.js';
import { labSectorPlan } from '../lab/lab-platform-core.mjs';
import { canvasAng, quadXZ, wallArcs, bridgeRects, facilityQuad, nearestHit, declutterIslandSigns, islandSignPri } from '../lab/lab2d-core.mjs';
import { drawPlatformStatic2D, drawPlatformDynamic2D } from './lab2d-platform.js';
import { drawRigs2D, drawRigRingStatic2D } from './lab2d-rigs.js';
import { camScale, toScreen } from './flat-core.mjs';

const FONT = '"Pretendard", "Segoe UI", "Malgun Gothic", system-ui, sans-serif';
const _q = new Array(8);
const _one = [null];
const _live = new Set(); // 살아 있는 Lab2DView — FAR_LABEL_S 를 바꾸면 다음 프레임에 이름표 다시 고르기

/**
 * 원경 이름표 판정(순수): 전체 보기(all)이고 배율 s(px/m, flat-core camScale 과 같은 값)가 기준 thr 보다 작으면 true.
 * 이 판정 하나가 원경 노드 이름표 거르기(_labelCandidates)와 원경 force 카드 비키기(cardForceAvoid)를 같이 정한다.
 */
export function labFarLabel(s, opts) {
  const all = opts && opts.all !== undefined ? opts.all : true, thr = opts && opts.thr !== undefined ? opts.thr : Lab2DView.FAR_LABEL_S;
  return labFarAt(s, all, thr);
}
/** labFarLabel 의 위치 인자판(프레임마다 부르는 _labFar 용 — 옵션 객체 할당 없음) */
export function labFarAt(s, all = true, thr = Lab2DView.FAR_LABEL_S) {
  return !!all && Number.isFinite(s) && s < thr;
}

export class Lab2DView extends Voxel2DView {
  static modeId = 'lab';
  static modeLabel = tr('flat.mode.lab');
  static family = 'voxel';

  constructor(container, labelContainer, opts = {}) {
    super(container, labelContainer, opts);
    this.labRP = platformRadius(); // 3D LabView 와 같은 값(1단계 고정)
    this._labArt = null;           // {book, fx} — 작업 대상 층 켬
    this._labPlan = labSectorPlan([], this.labRP, null); // 단일 세션(또는 첫 연구동) 계획 — 시험·공용
    this._labPlans = new Map();    // pid → 계획(전체 보기는 연구동마다)
    this._labPlanKey = '';
    this._curPid = null;
    this._labHits = [];
    this._labAnim = 0;             // 지난 그리기의 연출 단계(플랫폼·기자재)
    this.cardDeclutter = true;     // 도구 카드 겹침 풀기(flat-draw placeCards) — 연구소 2D 만 켬(복셀 오피스·Flow·Planet 2D 는 기존 슬롯)
    this.labelForceRects = true;   // 포커스·호버 이름표도 빈 자리가 없으면 섬 이름표·카드·말풍선은 피함(label-place forceRects) — 연구소 2D 만
    this.jobFaceExact = true;      // 시료 판·칩을 방위 그대로(비스듬한 연구소 방위) — voxel2d _drawJob 의 축 맞춤(Math.round) 대신. 복셀 오피스 2D 는 꺼짐
    this._canvasTextRects = [];    // 카드가 피할 캔버스 글 상자(화면 px) = 정적 글(_staticTextRects) + 프레임마다 동적('+n' 알약·전체 보기 섬 이름표)
    this._labelTextRects = [];     // 노드 라벨이 피할 캔버스 글 상자 = 정적 글 + '+n' 알약(섬 이름표 빼고 — flat-view _obstacleRects 가 섬 이름표를 따로 더함, 중복 방지)
    this.islandDeclutter = true;   // 전체 보기 섬 이름표 겹치면 우선순위 낮은 것 숨김(_placeLabels) — 연구소 2D 만(바탕은 고정 자리 그대로)
    this._isl = []; this._islPool = []; this._islEls = []; this._islOrder = []; this._islOut = []; // 섬 이름표 거르기(배열 재사용)
    this._staticTextRects = [];    // 정적 층 글 상자(문패·라운지·브리지 이름) — 정적 층을 다시 그릴 때만 새로
    this._dynRects = []; this._dynPool = [];   // 동적 장애물(배열 재사용)
    this._rigPills = []; this._pillPool = [];  // 이번 프레임 '+n' 알약(_drawRoomDyn 에서 자리만 → 카드 위에서 _drawRigMore)
    _live.add(this);
  }
  /** 원경 기준(px/m): 전체 보기에서 이보다 작으면 연구동 안 노드 이름표는 메인·포커스·호버만(섬 이름표와 겹침 방지) ·
   *  force 카드도 장애물을 비킴(cardForceAvoid). 개발자 도구에서 Lab2DView.FAR_LABEL_S = n 으로 바꾸면 다음 프레임 반영 */
  static _farS = 6;
  static get FAR_LABEL_S() { return Lab2DView._farS; }
  static set FAR_LABEL_S(v) {
    v = Number(v);
    if (!Number.isFinite(v) || v === Lab2DView._farS) return;
    Lab2DView._farS = v;
    for (const w of _live) { w.lastLabelPass = 0; if (typeof w.invalidate === 'function') w.invalidate(); }
  }
  dispose() { _live.delete(this); super.dispose(); }

  get isLab() { return !!(this.layout && this.layout.lab); }
  /** 플랫폼 반지름(3D LabView.setPlatformRadius 와 같은 뜻) */
  setPlatformRadius(r) { if (Number.isFinite(r) && Math.abs(r - this.labRP) > 1e-3) { this.labRP = r; this.layoutDirty = true; this._staticVer = (this._staticVer || 0) + 1; this.invalidate(); } }
  /** 단일 세션 플랫폼이 받는 장부 프로젝트 */
  labPid() { if (this._curPid) return this._curPid; const a = this._labArt; return a && a.book ? a.book.defaultProject : '_'; }
  /** 플랫폼 계획을 받는 방(연구동마다 첫 구역 방) → [pid, room] */
  _labRooms() {
    const all = !!(this.scope && this.scope.mode === 'all'), a = this._labArt, out = [];
    for (const r of this.rooms || []) {
      if (r.type !== 'lab' || !r.lab || r.lab.primary === false) continue;
      out.push([all ? r.projectId || '_' : a && a.book ? a.book.defaultProject : '_', r]);
      if (!all) break;
    }
    return out;
  }

  // ---------------- 배치(3D LabView 와 같은 함수) ----------------
  _computeLayout(present, campus) {
    if (campus) return computeLabCampus(present, this.scope.roots, this.scope.projects, this.layout && this.layout.campus && this.layout.lab ? this.layout : null, { showInactive: this.scope.showInactive, nowMs: Date.now(), view: packView(this.container, { flat: true }) });
    return computeLab(present, this.rootId, this.layout && this.layout.lab && !this.layout.campus ? this.layout : null, { rP: this.labRP });
  }
  _relayout() {
    super._relayout();
    for (const r of this.rooms) if (r.type === 'lab' && r.recent) this._dimRooms.add(r.id); // 끝난 프로젝트 연구동(돔 닫힘) 흐리게
    this._labSyncPlan();
    this._staticVer = (this._staticVer || 0) + 1;
    this.invalidate();
  }

  /** 플랫폼 계획: 장부 version·반지름이 바뀔 때만 다시(이미 놓인 대상은 움직이지 않음 — labSectorPlan 의 prev) */
  _labSyncPlan() {
    const a = this._labArt, rooms = this._labRooms();
    const ver = a && a.book ? a.book.version : -1;
    const key = rooms.map(([p, r]) => p + '@' + r.lab.rP).join(';') + '|' + ver + '|' + (a ? 1 : 0) + (rooms.length ? '' : '|' + this.labRP);
    if (key === this._labPlanKey) return false;
    this._labPlanKey = key;
    const next = new Map();
    for (const [pid, r] of rooms) {
      const rP = r.lab.rP, prev = this._labPlans.get(pid);
      const items = a && a.book && a.book.layoutItems ? (a.book.layoutItems(pid) || {}).items || [] : [];
      next.set(pid, labSectorPlan(items, rP, prev && prev.rP === rP ? prev : null));
    }
    this._labPlans = next;
    this._labPlan = rooms.length ? next.get(rooms[0][0]) : labSectorPlan([], this.labRP, this._labPlan && this._labPlan.rP === this.labRP ? this._labPlan : null);
    this._staticVer = (this._staticVer || 0) + 1;
    return true;
  }
  _planOf(r) { const all = !!(this.scope && this.scope.mode === 'all'), pid = all ? r.projectId || '_' : this.labPid(); return (this._labPlans && this._labPlans.get(pid)) || this._labPlan; }

  // ---------------- 작업 대상 층 = 가운데 플랫폼 ----------------
  setArtifacts({ on, book, fx, style } = {}) {
    const was = !!this._labArt;
    this._labArt = on && book && fx ? { book, fx, style } : null;
    if (was !== !!this._labArt) { this._labPlanKey = ''; this._staticVer = (this._staticVer || 0) + 1; }
    const r = super.setArtifacts({ on, book, fx, style }); // 전체 보기(오피스 캠퍼스)용 띠 — 연구동 배치에서는 그리지 않는다
    this._labSyncPlan();
    this.invalidate();
    return r || !!this._labArt;
  }
  get artOn() { return this.isLab ? !!this._labArt : !!this.vArt; }
  pickArtifact(clientX, clientY) {
    if (!this.isLab) return super.pickArtifact(clientX, clientY);
    if (!this._labArt) return null;
    const r = this.canvas.getBoundingClientRect();
    const h = nearestHit(this._labHits, clientX - r.left, clientY - r.top, Math.max(10, 0.6 * (this._s || 10)));
    return h ? { pid: h.pid, id: h.id } : null;
  }
  artPos(pid, id) {
    if (!this.isLab) return super.artPos(pid, id);
    for (const h of this._labHits) if (h.pid === pid && h.id === id) return { x: h.wx, y: 0, z: h.wz };
    return null;
  }
  fitExtra(pts, scope = {}) {
    if (!this.isLab || this.scope.mode === 'all') return super.fitExtra(pts, scope);
    const r = this.rooms[0];
    if (r && r.lab) { const R = r.lab.R.rWall; pts.push({ p: { x: r.lab.cx - R, z: r.lab.cz - R }, r: 0.5 }, { p: { x: r.lab.cx + R, z: r.lab.cz + R + 1.4 }, r: 0.5 }); }
  }

  /** camera2d 전체 맞춤에 단일 연구동 외벽 원 + 아래 라운지 이름 자리(aux = 무게 0) — 노드만 맞추면 위가 비고 아래 라운지가 잘렸다(QA 6) */
  fitShell(pts) {
    if (!this.isLab || (this.scope && this.scope.mode === 'all')) return;
    const r = this.rooms.find((x) => x.lab && x.lab.primary !== false);
    if (!r) return;
    const R = r.lab.R.rWall, cx = r.lab.cx, cz = r.lab.cz;
    for (const [dx, dz] of [[-R, 0], [R, 0], [0, -R], [0, R + 1.4]]) pts.push({ p: { x: cx + dx, y: 0, z: cz + dz }, r: 0.6, aux: true });
  }

  /** 이름표 후보: 전체 보기 원경에서는 연구동 안 노드를 메인(팀장)·포커스·호버만 — 그 밖은 바탕 순서 그대로 */
  _labelCandidates(push, actives, maxLabels, order, seen) {
    if (!this._labFar()) return super._labelCandidates(push, actives, maxLabels, order, seen);
    const lay = this.layout, f = this.focusId, h = this.hoverId;
    const inLab = (id) => { const rid = lay && lay.roomOf ? lay.roomOf.get(id) : null, r = rid && this.roomsById ? this.roomsById.get(rid) : null; return !!(r && r.type === 'lab'); };
    const isMain = (id) => { const ch = this.chars.get(id), v = this.vis.get(id); return !!((ch && ch.lead) || (v && v.node && v.node.kind === 'main')); };
    const gate = (id, force, pin) => { if (id && id !== f && id !== h && inLab(id) && !isMain(id)) return; push(id, force, pin); };
    return super._labelCandidates(gate, actives, maxLabels, order, seen);
  }
  _labFar() {
    if (!this.isLab || !this.scope || !this.cam) return false;
    return labFarAt(camScale(this.cam, this.H), this.scope.mode === 'all'); // 바탕 그리기와 같은 배율(camScale) · 위치 인자(옵션 객체 할당 없음)
  }
  /** force(포커스·호버) 카드도 장애물(섬 이름표 등)을 비킬지 — 전체 보기 원경에서만(flat-draw declutterCards 가 읽음) */
  get cardForceAvoid() { return this._labFar(); }
  /** 정적 층 글 상자 기록(가운데 x·y, 글 폭, 글자 크기) */
  _textRect(cx, cy, w, fs) { (this._staticTextRects || (this._staticTextRects = [])).push([cx - w / 2 - 2, cy - fs / 2 - 2, cx + w / 2 + 2, cy + fs / 2 + 2]); }
  /** 동적 장애물 사각형 하나(배열 재사용) */
  _dynRect(x0, y0, x1, y1) {
    const pool = this._dynPool || (this._dynPool = []), d = this._dynRects || (this._dynRects = []);
    const a = pool[d.length] || (pool[d.length] = [0, 0, 0, 0]);
    a[0] = x0; a[1] = y0; a[2] = x1; a[3] = y1;
    d.push(a);
    return a;
  }
  /** 프레임 시작: 지난 프레임 '+n' 알약·동적 장애물 비움 */
  _labFrameBegin() {
    if (this._rigPills) this._rigPills.length = 0;
    if (this._dynRects) this._dynRects.length = 0;
  }
  /** 전체 보기 섬 이름표(DOM .ov-island) 화면 사각형 — flat-view _obstacleRects 의 scope all 갈래와 같은 계산(같은 _mw·_mh 캐시) */
  _islandRects() {
    if (!this.scope || this.scope.mode !== 'all' || !this.islandEls || !this._clusterV || !this.cam) return;
    const p = this._ip || (this._ip = {});
    for (const [pid, el] of this.islandEls) {
      const e = this._clusterV.get(pid); if (!e || !el.isConnected || el._dclHide || (el.style && el.style.display === 'none')) continue; // 거르기로 숨긴 이름표·페이드로 없어진 이름표(display none)는 장애물 아님 — 폭 0 이라 프레임마다 offsetWidth(강제 레이아웃)를 다시 읽지 않게
      if (el._mk !== el._html || !el._mw) { el._mw = el.offsetWidth || 0; el._mh = el.offsetHeight || 0; el._mk = el._html; }
      if (!el._mw) continue;
      toScreen(this.cam, this.W, this.H, e.labelX ?? e.center.x, e.labelZ != null ? e.labelZ : e.center.z + e.r + 1.2, p);
      this._dynRect(p.x - el._mw / 2, p.y, p.x + el._mw / 2, p.y + el._mh);
    }
  }
  /** 섬 이름표 자리(바탕 _placeLabels) 뒤 겹침 거르기: 전체 보기에서 겹치는 이름표 중 우선순위 낮은 것을 숨김(visibility — pickLabelAt 도 건너뜀) */
  _placeLabels() {
    super._placeLabels();
    this._declutterIslands();
  }
  _declutterIslands() {
    const els = this.islandEls;
    if (!els || !els.size) return;
    const on = !!this.islandDeclutter && !!this.scope && this.scope.mode === 'all' && !!this.cam;
    const items = this._isl || (this._isl = []), pool = this._islPool || (this._islPool = []), list = this._islEls || (this._islEls = []);
    items.length = 0; list.length = 0;
    if (on) {
      const p = this._ip || (this._ip = {}), fp = this.scope.focusProject;
      for (const [pid, el] of els) {
        const e = this._clusterV.get(pid);
        if (!e || !el.isConnected || el.style.display === 'none') continue;
        if (el._mk !== el._html || !el._mw) { el._mw = el.offsetWidth || 0; el._mh = el.offsetHeight || 0; el._mk = el._html; }
        if (!el._mw) continue;
        toScreen(this.cam, this.W, this.H, e.labelX ?? e.center.x, e.labelZ != null ? e.labelZ : e.center.z + e.r + 1.2, p);
        const it = pool[items.length] || (pool[items.length] = {});
        it.x0 = p.x - el._mw / 2; it.y0 = p.y; it.x1 = p.x + el._mw / 2; it.y1 = p.y + el._mh;
        it.pri = islandSignPri(e, fp); it.was = !!el._dclHide;
        items.push(it); list.push(el);
      }
    }
    const hide = declutterIslandSigns(items, { order: this._islOrder || (this._islOrder = []), out: this._islOut || (this._islOut = []) });
    for (const el of els.values()) el._dclWant = false; // 숨길 이름표 표시(할당 없이) — 목록에 없는 것(꺼짐·display none)은 다시 보임
    for (let i = 0; i < list.length; i++) if (hide[i]) list[i]._dclWant = true;
    for (const el of els.values()) {
      const h = el._dclWant;
      if (!!el._dclHide === h) continue;
      el._dclHide = h;
      el.style.visibility = h ? 'hidden' : '';
    }
  }
  /** 카드 겹침 풀기 장애물 다시 채움(카드 그리기 전) = 정적 글 + '+n' 알약 + 섬 이름표 — 배열 재사용, 프레임마다 누적 없음 */
  _syncTextRects() {
    const d = this._dynRects || (this._dynRects = []);
    d.length = 0;
    for (const q of this._rigPills || []) this._dynRect(q.x - q.w / 2, q.y - q.h / 2, q.x + q.w / 2, q.y + q.h / 2);
    const nPill = d.length; // 앞쪽 = '+n' 알약, 뒤쪽 = 섬 이름표
    this._islandRects();
    const out = this._canvasTextRects || (this._canvasTextRects = []), lab = this._labelTextRects || (this._labelTextRects = []);
    out.length = 0; lab.length = 0;
    for (const r of this._staticTextRects || []) { out.push(r); lab.push(r); }
    for (let i = 0; i < d.length; i++) { out.push(d[i]); if (i < nPill) lab.push(d[i]); }
    return out;
  }

  // ---------------- 프레임 ----------------
  _update(now, dt) {
    const va = this.vArt;
    if (this.isLab) this.vArt = null; // 연구동 배치에서는 오피스 벽 바깥 띠 대신 플랫폼
    let level;
    try { level = super._update(now, dt); } finally { this.vArt = va; }
    if (!this.isLab) return level;
    const a = this._labArt;
    if (a) {
      a.fx.step(now);
      if (this._labSyncPlan()) level = Math.max(level, 1);
      if (a.fx.active) level = 2;
    }
    if (this._labAnim) level = Math.max(level, this._labAnim);
    return level;
  }
  _drawScene(ctx, now) {
    const va = this.vArt;
    if (this.isLab) this.vArt = null;
    this._labAnimNext = 0;
    this._labFrameBegin();
    try { super._drawScene(ctx, now); } finally { this.vArt = va; }
    if (this.isLab) this._labAnim = this.reduced ? 0 : this._labAnimNext;
    this._drawRigMore(ctx); // '+n' 알약은 도구 카드·캐릭터 위 층(자리는 _drawRoomDyn 에서 카드보다 먼저 정해 장애물로 넣음)
  }

  // ---------------- 정적 층 ----------------
  _drawStatic(ctx, s, now) {
    this._staticTextRects = []; // 정적 층은 카메라가 바뀔 때마다 다시 그리므로 글 상자도 여기서 새로(동적 글은 _syncTextRects 가 프레임마다 더함)
    if (!this.isLab || !this.rooms.some((r) => r.lab)) return super._drawStatic(ctx, s, now);
    const t = this.tokens, lay = this.layout;
    ctx.globalAlpha = 1; ctx.fillStyle = t.bg; ctx.fillRect(0, 0, this.W, this.H);
    if (lay.buildings) for (const b of lay.buildings) this._drawLabBuilding(ctx, b, s);
    // 연구동(첫 구역 방)마다 공유 껍데기 → 구역 방마다 책상·브리지 → 앞 시설·외벽·문패
    const prim = [];
    for (const r of this.rooms) {
      if (!r.lab) continue;
      const R = r.lab.R, X = this._X(r.lab.cx), Y = this._Y(r.lab.cz), rw = R.rWall * s;
      const fa = r.projectId && this.projAlpha ? this.projAlpha(r.projectId) : 1;
      r._alpha = (this._dimRooms && this._dimRooms.has(r.id) ? 0.5 : 1) * fa;
      r._on = fa > 0 && !(X + rw < -40 || X - rw > this.W + 40 || Y + rw < -60 || Y - rw > this.H + 60);
      if (r._on && r.lab.primary !== false) prim.push(r);
    }
    for (const r of prim) {
      this._labShell(ctx, r, s);
      drawPlatformStatic2D(ctx, this, r, this._planOf(r));
      drawRigRingStatic2D(ctx, this, r);
    }
    for (const r of this.rooms) {
      if (!r.lab || !r._on) continue;
      this._labDesks(ctx, r, s);
      this._labBridge(ctx, r, s);
    }
    for (const r of prim) { this._labFront(ctx, r, s); this._labWall(ctx, r, s); this._drawRoomSign(ctx, r, s); }
    ctx.globalAlpha = 1;
  }
  /** 전체 보기 연구동 바닥판 — 비활성 = 닫힌 돔(빗금 원) */
  _drawLabBuilding(ctx, b, s) {
    if (!b.lab) return this._drawBuilding(ctx, b, false, s);
    const fa = this.projAlpha(b.projectId);
    if (fa <= 0) return;
    const pal = this.pal, X = this._X(b.lab.cx), Y = this._Y(b.lab.cz), r = (b.lab.rWall + 1.4) * s;
    if (X + r < 0 || X - r > this.W || Y + r < 0 || Y - r > this.H) return;
    ctx.globalAlpha = fa; ctx.fillStyle = pal.trim; ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill();
    if (b.recent) { ctx.fillStyle = pal.floor; ctx.beginPath(); ctx.arc(X, Y, b.lab.rWall * s, 0, Math.PI * 2); ctx.fill(); }
    if (!b.dome) { ctx.globalAlpha = 1; return; }
    // 돔: 유리 원 + 갈비 8 + 빗금(닫힘)
    const rd = b.lab.rWall * s;
    ctx.save(); ctx.beginPath(); ctx.arc(X, Y, rd, 0, Math.PI * 2); ctx.clip();
    ctx.globalAlpha = 0.35 * fa; ctx.fillStyle = pal.glass || pal.pane; ctx.fillRect(X - rd, Y - rd, 2 * rd, 2 * rd);
    ctx.globalAlpha = 0.5 * fa; ctx.strokeStyle = pal.glassFrame || pal.trim; ctx.lineWidth = Math.max(0.6, 0.08 * s);
    ctx.beginPath(); for (let x = -2 * rd; x < 2 * rd; x += Math.max(6, 1.6 * s)) { ctx.moveTo(X + x, Y - rd); ctx.lineTo(X + x + 2 * rd, Y + rd); } ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 0.9 * fa; ctx.strokeStyle = pal.metal; ctx.lineWidth = Math.max(1, 0.12 * s);
    ctx.beginPath(); ctx.arc(X, Y, rd, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); for (let m = 0; m < 8; m++) { const a = (m * Math.PI) / 4 + Math.PI / 8; ctx.moveTo(X + Math.cos(a) * rd * 0.08, Y + Math.sin(a) * rd * 0.08); ctx.lineTo(X + Math.cos(a) * rd, Y + Math.sin(a) * rd); } ctx.stroke();
    ctx.globalAlpha = 1;
  }

  _quad(ctx, x, z, w, d, th, dy = 0) {
    quadXZ(x, z, w, d, th, _q);
    ctx.beginPath();
    ctx.moveTo(this._X(_q[0]), this._Y(_q[1]) + dy);
    for (let i = 2; i < 8; i += 2) ctx.lineTo(this._X(_q[i]), this._Y(_q[i + 1]) + dy);
    ctx.closePath();
  }
  _ring(ctx, X, Y, r0, r1) { ctx.beginPath(); ctx.arc(X, Y, r1, 0, Math.PI * 2); ctx.arc(X, Y, Math.max(0, r0), 0, Math.PI * 2, true); }

  /** 바닥 원·둘레길·기자재 고리 띠·바깥 순환 통로·방사 통로 */
  _labShell(ctx, r, s) {
    const pal = this.pal, L = r.lab, R = L.R, X = this._X(L.cx), Y = this._Y(L.cz);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.floor; ctx.beginPath(); ctx.arc(X, Y, R.rWall * s, 0, Math.PI * 2); ctx.fill();
    // 고리 띠(기자재) — 매트, 바깥 순환 통로 — 복도색
    ctx.fillStyle = pal.floorAlt; this._ring(ctx, X, Y, R.rRigIn * s, R.rRigOut * s); ctx.fill();
    ctx.globalAlpha = 0.55; ctx.fillStyle = pal.corridor; this._ring(ctx, X, Y, R.rRigOut * s, R.rWalkOut * s); ctx.fill();
    ctx.fillStyle = pal.corridor; this._ring(ctx, X, Y, L.rP * s, R.rInner * s); ctx.fill();
    // 방사 통로(고리를 끊는 문, 폭 GANGWAY_WIDTH)
    ctx.globalAlpha = 0.55;
    const r0 = L.rP, r1 = R.rDesk[0] - 1.0, mid = (r0 + r1) / 2;
    for (const g of L.gangways || []) {
      const a = (g * Math.PI) / 180, x = L.cx + Math.sin(a) * mid, z = L.cz + Math.cos(a) * mid;
      // 방사 띠 = 반지름 방향 길이(r1 − r0), 접선 폭 GANGWAY_WIDTH
      ctx.fillStyle = pal.corridor; this._quad(ctx, x, z, LAB.GANGWAY_WIDTH, r1 - r0, g); ctx.fill();
    }
    // 책상 열 안내 호(말굽: 브리지 ± HORSESHOE_HALF)
    ctx.globalAlpha = 0.35; ctx.strokeStyle = pal.mat; ctx.lineWidth = Math.max(0.6, 0.08 * s); ctx.setLineDash([Math.max(2, 0.4 * s), Math.max(2, 0.4 * s)]);
    for (const z of L.zones && L.zones.length ? L.zones : [{ theta: LAB.BRIDGE_THETA, half: LAB.HORSESHOE_HALF }]) { // 구역마다 말굽
      const h0 = z.theta - z.half, h1 = z.theta + z.half;
      for (const rd of R.rDesk) { ctx.beginPath(); ctx.arc(X, Y, rd * s, canvasAng(h0), canvasAng(h1), true); ctx.stroke(); }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** 책상(말굽 동심 호) — 접선 W × 반지름 D, 발광대는 중심 쪽(3D 와 같은 축) */
  _labDesks(ctx, r, s) {
    const pal = this.pal, D = LAB.DESK;
    for (const d of r.desks) {
      const th = d.theta ?? 0;
      ctx.globalAlpha = 1;
      ctx.fillStyle = pal.deskEdge; this._quad(ctx, d.x, d.z, D.W, D.D + 0.1, th); ctx.fill();
      ctx.fillStyle = pal.deskTop; this._quad(ctx, d.x, d.z, D.W - 0.15, D.D - 0.06, th); ctx.fill();
      const a = (th * Math.PI) / 180, ex = d.x - Math.sin(a) * 0.23, ez = d.z - Math.cos(a) * 0.23;
      ctx.fillStyle = pal.emitter; ctx.globalAlpha = 0.4; this._quad(ctx, ex, ez, 1.1, 0.06, th); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** 브리지: 높이 그림자 → 경사로(가로 줄) → 덱 → 난간 → 콘솔 → 이름 */
  _labBridge(ctx, r, s) {
    const pal = this.pal, B = LAB.BRIDGE, br = r.lab.bridge;
    if (!br) return;
    const rects = bridgeRects(br), deck = rects.find((q) => q.kind === 'deck');
    const lift = B.Y * 0.3 * s;
    ctx.globalAlpha = 0.45; ctx.fillStyle = pal.metalDark;
    this._quad(ctx, deck.x, deck.z, deck.w, deck.d, deck.theta, lift); ctx.fill(); // 높이 표시 그림자(화면 아래로)
    for (const q of rects) {
      if (q.kind !== 'ramp') continue;
      ctx.globalAlpha = 1; ctx.fillStyle = pal.floorAlt; this._quad(ctx, q.x, q.z, q.w, q.d, q.theta); ctx.fill();
      ctx.strokeStyle = pal.mat; ctx.lineWidth = Math.max(0.6, 0.05 * s);
      const a = (q.theta * Math.PI) / 180, ex = Math.cos(a), ez = -Math.sin(a);
      ctx.beginPath();
      for (let i = 1; i < 6; i++) { const u = (i / 6 - 0.5) * q.w, cx = q.x + ex * u, cz = q.z + ez * u; quadXZ(cx, cz, 0.001, q.d, q.theta, _q); ctx.moveTo(this._X(_q[0]), this._Y(_q[1])); ctx.lineTo(this._X(_q[6]), this._Y(_q[7])); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.fillStyle = pal.wallTop || pal.metal; this._quad(ctx, deck.x, deck.z, deck.w, deck.d, deck.theta); ctx.fill();
    ctx.strokeStyle = pal.glassFrame || pal.trim; ctx.lineWidth = Math.max(1, 0.1 * s); ctx.stroke();
    const con = rects.find((q) => q.kind === 'console');
    if (con) { ctx.fillStyle = pal.deskEdge; this._quad(ctx, con.x, con.z, con.w, con.d, con.theta); ctx.fill(); ctx.fillStyle = pal.screenOff; this._quad(ctx, con.x, con.z, con.w - 0.2, con.d - 0.3, con.theta); ctx.fill(); }
    if (s > 4) {
      ctx.fillStyle = this.tokens.muted; ctx.globalAlpha = 0.85; ctx.font = `600 ${Math.round(Math.max(9, Math.min(12, s * 0.4)))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const a = (br.theta * Math.PI) / 180, p = { x: br.c.x + Math.sin(a) * (B.D / 2 + 0.7), z: br.c.z + Math.cos(a) * (B.D / 2 + 0.7) };
      const bt = tr('lab.bridge'), bx = this._X(p.x), by = this._Y(p.z), bf = Math.round(Math.max(9, Math.min(12, s * 0.4)));
      ctx.fillText(bt, bx, by);
      this._textRect(bx, by, ctx.measureText(bt).width, bf);
    }
    ctx.globalAlpha = 1;
  }

  /** 앞쪽 시설: 라운지·시설 판·포털·벨·대기석·출입문 */
  _labFront(ctx, r, s) {
    const pal = this.pal;
    const lg = r.labLounge;
    if (lg) {
      ctx.globalAlpha = 1; ctx.fillStyle = pal.loungeRug; ctx.beginPath(); ctx.arc(this._X(lg.x), this._Y(lg.z), 2.2 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pal.counter || pal.wood; this._quad(ctx, lg.x, lg.z, 2.4, 0.7, lg.theta); ctx.fill();
      ctx.fillStyle = pal.sofa;
      for (const b of r.breakSlots || []) { ctx.beginPath(); ctx.arc(this._X(b.x), this._Y(b.z), Math.max(1.2, 0.2 * s), 0, Math.PI * 2); ctx.fill(); }
      if (s > 6) {
        const lt = tr('flat.vx.lounge'), lf = Math.round(Math.max(9, Math.min(11, s * 0.36))), lx = this._X(lg.x), ly = this._Y(lg.z) + 2.6 * s;
        ctx.fillStyle = this.tokens.muted; ctx.font = `600 ${lf}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(lt, lx, ly);
        this._textRect(lx, ly, ctx.measureText(lt).width, lf);
      }
    }
    const st = r.stations || {};
    for (const cat of Object.keys(st)) {
      if (cat === 'workflow' || cat === 'agent' || cat === 'notify') continue;
      const q = facilityQuad(st[cat]), f = CAT_FACILITY[cat];
      if (!q) continue;
      ctx.globalAlpha = 1;
      ctx.fillStyle = f === 'toolbox' ? pal.toolbox : f === 'antenna' ? pal.antenna : f === 'kiosk' ? pal.kiosk : f === 'terminal' ? pal.screenOff : f === 'screens' ? pal.metalDark : pal.metal;
      this._quad(ctx, q.x, q.z, q.w, q.d, q.theta); ctx.fill();
    }
    if (r.portal) {
      ctx.strokeStyle = pal.portal; ctx.lineWidth = Math.max(1.2, 0.18 * s);
      ctx.beginPath(); ctx.ellipse(this._X(r.portal.x), this._Y(r.portal.z), 0.7 * s, 0.7 * s, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (r.bell) { ctx.fillStyle = pal.bell; ctx.beginPath(); ctx.arc(this._X(r.bell.x), this._Y(r.bell.z), Math.max(1.5, 0.28 * s), 0, Math.PI * 2); ctx.fill(); }
    if (r.stools) for (const sp of r.stools) { ctx.fillStyle = pal.wood; this._rect(ctx, sp.x, sp.z, 0.62, 0.5); }
    ctx.globalAlpha = 1;
  }

  /** 외벽 원(출입문 틈) + 문짝 호 */
  _labWall(ctx, r, s) {
    const pal = this.pal, L = r.lab, X = this._X(L.cx), Y = this._Y(L.cz), rw = L.R.rWall * s;
    ctx.lineCap = 'butt';
    for (const w of wallArcs(L.R.rWall)) {
      ctx.globalAlpha = 0.7; ctx.strokeStyle = pal.pane; ctx.lineWidth = Math.max(1, 0.12 * s);
      ctx.beginPath(); ctx.arc(X, Y, rw, canvasAng(w.th0), canvasAng(w.th1), true); ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = pal.glassFrame; ctx.lineWidth = Math.max(0.8, 0.05 * s); ctx.stroke();
    }
    if (r.door && s > 3) {
      const g = ((LAB.WALL.DOOR_W / 2) / L.R.rWall) * (180 / Math.PI), a = canvasAng((L.doorTheta != null ? L.doorTheta : LAB.FRONT.DOOR) + g);
      const hx = X + Math.cos(a) * rw, hy = Y + Math.sin(a) * rw, leaf = LAB.WALL.DOOR_W * 0.6 * s;
      const toC = Math.atan2(Y - hy, X - hx);
      ctx.strokeStyle = pal.woodDark; ctx.lineWidth = Math.max(1, 0.1 * s);
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(toC) * leaf, hy + Math.sin(toC) * leaf); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** 문패: 외벽 위 왼쪽 — '연구소 · 팀장 이름' */
  _drawRoomSign(ctx, r, s) {
    if (!r || !r.lab) return super._drawRoomSign(ctx, r, s);
    if (s <= 2.2) return;
    const t = this.tokens, owner = this.vis.get(r.ownerId);
    const name = owner ? owner.node.label || owner.node.id : r.id;
    const fs = Math.round(Math.max(9, Math.min(12, s * 0.42)));
    const L = r.lab, rw = L.R.rWall;
    const lx = this._X(L.cx - rw * 0.72), ly = this._Y(L.cz - rw * 0.72) - Math.max(8, 0.9 * s);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${fs}px ${FONT}`; ctx.fillStyle = t.text; ctx.globalAlpha = 0.9;
    const kind = tr('scene.room.lab');
    ctx.fillText(kind, lx, ly);
    const kw = ctx.measureText(kind).width;
    ctx.font = `500 ${fs}px ${FONT}`; ctx.fillStyle = t.muted;
    const rest = ' · ' + String(name).slice(0, 24), rw2 = ctx.measureText(rest).width;
    ctx.fillText(rest, lx + kw, ly);
    this._textRect(lx + (kw + rw2) / 2, ly, kw + rw2, fs);
    ctx.globalAlpha = 1;
  }

  // ---------------- 움직이는 층 ----------------
  _drawRoomDyn(ctx, r, s, now) {
    if (!r || r.type !== 'lab') return super._drawRoomDyn(ctx, r, s, now);
    const L = this.tokens.isLight, D = LAB.DESK, B = LAB.BRIDGE;
    ctx.globalAlpha = r._alpha ?? 1;
    const col = (ch) => (ch._monCat === 'skill' ? this.tokens.skill : catColor(ch._monCat || 'other', L));
    // 브리지 콘솔 화면(팀장 작업 중 종류 색)
    const lead = this.chars.get(r.ownerId), br = r.lab.bridge;
    if (lead && lead._monK > 0.05 && br) {
      const con = bridgeRects(br).find((q) => q.kind === 'console');
      if (con) { ctx.fillStyle = col(lead); this._quad(ctx, con.x, con.z, con.w - 0.3, B.CONSOLE_D * 0.3, con.theta); ctx.fill(); }
    }
    for (const d of r.desks) {
      const ch = d.occupant && this.chars.get(d.occupant);
      if (!ch || ch.state === 'gone' || ch.state === 'leave' || !(ch._monK > 0.05)) continue;
      const th = d.theta ?? 0, a = (th * Math.PI) / 180;
      ctx.fillStyle = col(ch); this._quad(ctx, d.x - Math.sin(a) * 0.23, d.z - Math.cos(a) * 0.23, D.W * 0.55, 0.09, th); ctx.fill();
    }
    // 쓰는 중인 시설 테두리(맥동)·포털 열림·벨 흔들림
    const act = r._act;
    if (act && s > 2.5) {
      const st = r.stations || {};
      for (const cat of Object.keys(st)) {
        if (cat === 'workflow' || cat === 'agent' || cat === 'notify') continue;
        const f = CAT_FACILITY[cat], on = f && act[f];
        if (!on) continue;
        const q = facilityQuad(st[cat]);
        if (!q) continue;
        ctx.globalAlpha = (r._alpha ?? 1) * (this.reduced ? 1 : 0.65 + 0.35 * Math.sin(now * 5));
        ctx.strokeStyle = on === 'skill' ? this.tokens.skill : catColor(on, L); ctx.lineWidth = Math.max(1.2, 0.12 * s);
        this._quad(ctx, q.x, q.z, q.w, q.d, q.theta); ctx.stroke();
      }
      ctx.globalAlpha = r._alpha ?? 1;
      if (r.portal && act.portal) {
        ctx.strokeStyle = this.pal.portal; ctx.fillStyle = this.pal.portalCore; ctx.lineWidth = Math.max(1.2, 0.18 * s);
        ctx.beginPath(); ctx.arc(this._X(r.portal.x), this._Y(r.portal.z), 1.0 * s, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = (r._alpha ?? 1) * 0.6; ctx.fill(); ctx.globalAlpha = r._alpha ?? 1;
      }
      if (r.bell && act.bell) {
        ctx.fillStyle = this.pal.bell; ctx.strokeStyle = this.tokens.skill; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(this._X(r.bell.x) + (this.reduced ? 0 : Math.sin(now * 16) * 0.12 * s), this._Y(r.bell.z), Math.max(1.5, 0.28 * s), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    if (s > 3 && r.lab && r.lab.primary !== false && r.lab.rigMore && r.lab.rigMore.size) this._planRigMore(ctx, r, s);
    ctx.globalAlpha = 1;
  }

  /** 기자재 고리·보조 선반이 넘친 주인마다 주인 책상 옆 '+n' 알약 자리(첫 구역 방에서 한 번 — rigMore 는 구역 방끼리 같은 Map).
   *  여기서는 자리·크기만 _rigPills 에 담는다 — 그리기는 카드 위에서 _drawRigMore, 사각형은 _syncTextRects 가 카드 장애물로 */
  _planRigMore(ctx, r, s) {
    const fs = Math.round(Math.max(9, Math.min(11, s * 0.34)));
    const pills = this._rigPills || (this._rigPills = []), pool = this._pillPool || (this._pillPool = []);
    for (const [owner, n] of r.lab.rigMore) {
      if (!(n > 0)) continue;
      const d = this._ownerDesk(owner, r);
      if (!d) continue;
      const v = this.vis.get(owner);
      if (v && (v.hidden || !(v.scopeK ?? 1))) continue;
      const q = pool[pills.length] || (pool[pills.length] = {});
      // 글꼴 문자열·글자·폭은 n 이나 글자 크기가 바뀔 때만(프레임마다 문자열·TextMetrics 할당 0 — _drawRigMore 가 q.font·q.txt 그대로 씀)
      if (q.fs !== fs || !q.font) { q.font = `700 ${fs}px ${FONT}`; q.fs = fs; q.n = -1; }
      if (q.n !== n) { q.n = n; q.txt = '+' + n; ctx.font = q.font; q.w = ctx.measureText(q.txt).width + 8; this._font = null; }
      const w = q.w; q.h = fs + 4;
      // 알약은 _drawScene 끝(회전 바깥)에서 그리므로 돌린 방(_rotBegin)이면 책상 점을 지금 변환으로 화면 좌표로 옮김(지금 연구동은 안 돌림)
      let X = this._X(d.x), Y = this._Y(d.z);
      if (this._rotA && typeof ctx.getTransform === 'function') { const M = ctx.getTransform(), k = this.dpr || 1, x0 = X, y0 = Y; X = (M.a * x0 + M.c * y0 + M.e) / k; Y = (M.b * x0 + M.d * y0 + M.f) / k; }
      q.x = X + 0.9 * s + w / 2; q.y = Y - 0.5 * s;
      q.a = (r._alpha ?? 1) * (v ? v.projA ?? 1 : 1);
      pills.push(q);
    }
  }
  /** 이번 프레임 '+n' 알약을 그린다(_drawScene 끝 = 도구 카드·캐릭터 캔버스 층 위) */
  _drawRigMore(ctx) {
    const pills = this._rigPills;
    if (!pills || !pills.length) return;
    const t = this.tokens;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 1;
    let font = '';
    for (const q of pills) {
      const f = q.font;
      if (f !== font) { ctx.font = f; font = f; }
      const { x, y, w, h } = q;
      ctx.globalAlpha = q.a;
      ctx.fillStyle = t.isLight ? 'rgba(255,255,255,.92)' : 'rgba(20,24,34,.9)'; ctx.strokeStyle = t.warn || t.muted;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); else ctx.rect(x - w / 2, y - h / 2, w, h); ctx.fill(); ctx.stroke();
      ctx.fillStyle = t.text; ctx.fillText(q.txt, x, y + 0.5);
    }
    ctx.globalAlpha = 1;
    this._font = null; // 공용 setFont 기억 비움(ix 등이 뒤에 그림)
  }
  /** 주인 책상(세계 x·z): 캐릭터 자리 책상 → 그 주인이 팀장인 구역의 브리지 콘솔 → 책상 점유자 */
  _ownerDesk(owner, r) {
    const o = this._odq || (this._odq = { x: 0, z: 0 }); // 재사용 객체(_planRigMore 가 프레임마다 알약마다 부름 — 바로 읽고 버림)
    const ch = this.chars.get(owner);
    if (ch && ch.seat && ch.seat.deskX != null) { o.x = ch.seat.deskX; o.z = ch.seat.deskZ; return o; }
    for (const q of this.rooms || []) if (q.type === 'lab' && q.ownerId === owner && q.leadDesk && q.lab && q.lab.cx === r.lab.cx && q.lab.cz === r.lab.cz) { o.x = q.leadDesk.x; o.z = q.leadDesk.z; return o; }
    for (const q of this.rooms || []) if (q.type === 'lab' && q.lab && q.lab.cx === r.lab.cx && q.lab.cz === r.lab.cz) for (const d of q.desks || []) if (d.occupant === owner) { o.x = d.x; o.z = d.z; return o; }
    return null;
  }

  /** 바탕이 작업 대상 층을 그리던 자리(방 동적 층 다음, 기계·캐릭터 아래) — 연구소는 플랫폼 블록·연출 */
  _drawSessDyn(ctx, s, now) {
    super._drawSessDyn(ctx, s, now);
    this._syncTextRects(); // 방 동적 층('+n' 자리) 뒤 · drawCards 앞 — 카드 겹침 풀기 장애물
    if (!this.isLab) return;
    const a = this._labArt;
    if (!a) { this._labHits.length = 0; return; }
    const all = [];
    for (const [pid, r] of this._labRooms()) {
      if (!r._on) continue;
      this._curPid = pid; this._labHits = [];
      try { if (drawPlatformDynamic2D(ctx, this, r, this._planOf(r), a.book, a.fx, now)) this._labAnimNext = 2; } finally { this._curPid = null; }
      for (const h of this._labHits) all.push(h);
    }
    this._labHits = all;
  }

  _drawMachine(ctx, m, v, s, now) {
    if (m.pos && m.pos.type === 'rig') {
      _one[0] = m;
      if (drawRigs2D(ctx, this, _one, this.clock())) this._labAnimNext = Math.max(this._labAnimNext || 0, 1);
      _one[0] = null;
      return;
    }
    return super._drawMachine(ctx, m, v, s, now);
  }
}

