// 【모듈 규격 · 플랫폼(platform) 담당】 원형 플랫폼 3D — 정적 단(buildPlatformStatic) + 작업 대상 층(LabPlatform3D, 구성).
//
// ┌ 입력 ───────────────────────────────────────────────────────────────────────────────────────────┐
// │ buildPlatformStatic(room, pal, b, o): room.lab = {cx, cz, rP, …}, pal 복셀 팔레트, b = 정적 {lit, glow, glass}, o = {dim, cam, art} │
// │ LabPlatform3D(scene, view, {book, fx, style}): view = LabView(rooms·layout·camera·clock·_isDim·projAlpha). 켤 때만 만든다.     │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// ┌ 출력 ─ export ──────────────────────────────────────────────────────────────────────────────────┐
// │ buildPlatformStatic(room, pal, b, o)   단 두 겹(높이 LAB.PLATFORM.H) · 저장소 코어 원기둥(r 1.6, 높이 2) · 테두리 띠            │
// │                                       — 작업 대상 층이 꺼져도 그린다(빈 플랫폼, 결정 D4)                                      │
// │ class LabPlatform3D extends ArtLayerBase3D  VoxelView.vArt 계약(art-layer3d.js): update(now) · applyTheme(t) · pickAt(x,y)     │
// │                                       · posOf(pid,id) · fitPoints(pts, scope) · dispose() · st(ArtState: setFoot·sel) · names     │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// 그리기 호출: 층 켰을 때 +4(상자·원기둥 InstancedMesh 2 + 선 1 + 점 1) + CSS2D 라벨 14 — 그 밖 새 메시 금지.
// 정적(buildPlatformStatic, 기존 묶음에 넣기만): 단 두 겹 · 테두리 장치 띠 · 발광 눈금 48 · 코어(팔각 근사 + 받침 고리 + 발광 뚜껑) ·
//   반출대 카운터(θ 30～60) · DB 탱크 받침(200～250) · 안테나 받침(290～340) · 경광등 몸통 4. 상자 ≈ 200(rP 14 기준).
// 동적(LabPlatform3D): 구역 계획(labSectorPlan, 장부 version·rP 가 바뀔 때만 · 0.25초 간격) → labPlatformGeometry → ArtGeo 업로드.
//   단일 세션이면 보이는 대상 수로 플랫폼 반지름을 정해 view.setPlatformRadius(R) 를 부름(LabRadiusGate: 커질 때 바로 · 줄 때 10분).
// env.actOrigin(e) = _actOrigin: 연출 e.tu 가 bg 기자재(view.machines, pos.type 'rig')의 node.meta.toolUseId 와 같으면 그 기자재 꼭대기
//   {x, y: RIG_HEIGHT[kind] + 0.2, z}(반지름 보간 중이면 view._tweenPos 자리), 아니면 null. tu → 기자재 Map 은 view._layoutVer·기계 수가 바뀔 때만 다시.
import { ArtLayerBase3D } from '../art-layer3d.js';
import { LAB, DEG, polar } from './lab-const.mjs';
import { labPlatformGeometry, labSectorPlan, rimSlotsFor, LabRadiusGate } from './lab-platform-core.mjs';
import { RIG_HEIGHT } from './lab-rig-core.mjs';

export function buildPlatformStatic(room, pal, b, o = {}) {
  const lab = room && room.lab;
  if (!lab) return;
  const L = b.lit, P = LAB.PLATFORM, { cx, cz, rP } = lab, dim = !!o.dim;
  const k = dim ? 0.55 : 1;
  const col = (c) => (!c ? pal.metal : k === 1 ? c : c.clone().multiplyScalar(k));
  // 단 두 겹(아래 넓게) — 가로 띠 원판
  for (const [r, y0, h, c] of [[rP, 0, P.H * 0.55, pal.trim], [rP - 0.35, P.H * 0.55, P.H * 0.45, pal.floorAlt]]) {
    const strip = 0.6;
    for (let z = -r; z < r - 1e-6; z += strip) {
      const zm = Math.min(Math.abs(z), Math.abs(z + strip)), w = Math.sqrt(Math.max(0, r * r - zm * zm));
      L.box(cx, y0 + h / 2, cz + z + strip / 2, 2 * w, h, strip, col(c));
    }
  }
  // 테두리 장치 띠(살짝 다른 바닥색) + 칸 띠 바깥 경계
  const rb = rP - P.RIM_BAND / 2, nb = Math.max(24, Math.ceil((2 * Math.PI * rb) / 1.6));
  for (let i = 0; i < nb; i++) { const th = (i + 0.5) * (360 / nb), p = polar(cx, cz, rb, th); L.box(p.x, P.H + 0.004, p.z, (2 * Math.PI * rb) / nb + 0.02, 0.012, P.RIM_BAND - 0.5, col(pal.mat), th * DEG); }
  // 테두리 발광 띠(얇은 조각)
  const n = 48;
  for (let i = 0; i < n; i++) { const th = (i + 0.5) * (360 / n), p = polar(cx, cz, rP - 0.05, th); b.glow.box(p.x, P.H + 0.01, p.z, (2 * Math.PI * rP) / n * 0.8, 0.02, 0.06, col(pal.emitter), th * DEG); }
  // 저장소 코어(팔각 기둥 근사: 두 상자 45° 엇갈림) + 받침 고리 + 발광 뚜껑
  for (const ry of [0, Math.PI / 4]) L.box(cx, P.H + P.CORE_H / 2, cz, P.CORE_R * 1.6, P.CORE_H, P.CORE_R * 1.6, col(pal.metal), ry);
  for (let i = 0; i < 16; i++) { const th = (i + 0.5) * 22.5, p = polar(cx, cz, P.CORE_R + 0.15, th); L.box(p.x, P.H + 0.06, p.z, (2 * Math.PI * (P.CORE_R + 0.15)) / 16 + 0.02, 0.12, 0.3, col(pal.metalDark), th * DEG); }
  b.glow.box(cx, P.H + P.CORE_H + 0.02, cz, P.CORE_R, 0.04, P.CORE_R, col(pal.emitter));
  // 반출대 카운터(산출물 자리 아래, 두 줄)
  for (const s of rimSlotsFor('output', rP)) {
    L.box(cx + s.x, P.H + 0.24, cz + s.z, 0.62, 0.48, 0.52, col(pal.counter || pal.metalDark), s.theta * DEG);
    L.box(cx + s.x, P.H + 0.49, cz + s.z, 0.66, 0.03, 0.56, col(pal.deskTop || pal.metal), s.theta * DEG);
  }
  // DB 탱크 받침 · 안테나 받침
  for (const s of rimSlotsFor('db', rP)) L.box(cx + s.x, P.H + 0.03, cz + s.z, 1.3, 0.06, 1.3, col(pal.metalDark), s.theta * DEG);
  for (const s of rimSlotsFor('remote', rP)) L.box(cx + s.x, P.H + 0.03, cz + s.z, 0.7, 0.06, 0.7, col(pal.metalDark), s.theta * DEG);
  // 경광등 몸통 4(불빛은 작업 대상 층이 경보 때 그림)
  for (const th of [0, 90, 180, 270]) {
    const p = polar(cx, cz, rP - 0.25, th);
    L.box(p.x, P.H + 0.15, p.z, 0.22, 0.3, 0.22, col(pal.metalDark), th * DEG);
    L.box(p.x, P.H + 0.36, p.z, 0.16, 0.12, 0.16, col(pal.lampOff || pal.metal), th * DEG);
  }
}

export class LabPlatform3D extends ArtLayerBase3D {
  constructor(scene, view, opts) {
    super(scene, view, opts, { solid: true });
    this._solidBase = () => (this.view.pal && this.view.pal.metalDark) || null;
    this.plans = new Map(); // pid → {plan(labSectorPlan), cx, cz, rWall}
    this._prev = new Map(); // pid → 지난 계획(안정 배치)
    this._pk = ''; this._pkAt = -1e9;
    this.gate = new LabRadiusGate(view.labRP ?? null);
    this.stats.sectors = 0; this.stats.blocks = 0;
    this._tuRig = new Map(); this._tuVer = -1; this._tuN = -1; this._ao = { x: 0, y: 0, z: 0 };
    this._actOriginFn = (e) => this._actOrigin(e); // 한 번 만든 함수(프레임마다 클로저 없음)
  }
  /** 기자재 → 플랫폼 운반 출발점: e.tu === bg 기자재 node.meta.toolUseId 인 기자재 꼭대기(결과 객체 재사용) | null */
  _actOrigin(e) {
    const tu = e && e.tu; if (!tu) return null;
    const v = this.view, ms = v.machines;
    if (!ms || !ms.size) return null;
    const ver = v._layoutVer || 0, C = this._tuRig;
    if (this._tuVer !== ver || this._tuN !== ms.size) {
      this._tuVer = ver; this._tuN = ms.size; C.clear();
      for (const m of ms.values()) {
        if (!m || !m.pos || m.pos.type !== 'rig') continue;
        const n = (v.nodes && v.nodes.get(m.id)) || m.node, t = n && n.meta && n.meta.toolUseId;
        if (t) C.set(t, m);
      }
    }
    const m = C.get(tu);
    if (!m || m.released || !m.pos) return null;
    const q = (v._tweenPos && v._tweenPos(m)) || m.pos, o = this._ao;
    o.x = q.x; o.z = q.z; o.y = (RIG_HEIGHT[m.pos.rigKind] || 1.2) + 0.2;
    return o;
  }
  _nodePos(id) {
    const v = this.view, ch = v.chars && v.chars.get(id);
    const p = this._np || (this._np = new Map());
    let o = p.get(id); if (!o) { o = { x: 0, y: 0, z: 0 }; p.set(id, o); }
    if (ch && ch.placed && ch.state !== 'gone' && !ch.offstage && !(v._isDim && v._isDim(id))) { o.x = ch.pos.x; o.y = 1.15 + (v._floorY ? v._floorY(ch) : 0); o.z = ch.pos.z; return o; }
    const m = v.machines && v.machines.get(id);
    if (m && m.pos && !m.released) { o.x = m.pos.x; o.y = 1.0; o.z = m.pos.z; return o; }
    return null;
  }
  _pidOfNode(id) { const v = this.view; return v.scope && v.scope.mode === 'all' ? (v.nodeCluster ? v.nodeCluster(id) : null) : this.st.book.defaultProject; }
  /** 연구동 방 → 프로젝트: 단일 세션 = 장부 기본 프로젝트, 전체 보기 = 방의 projectId */
  _labRooms() {
    const v = this.view, all = v.scope && v.scope.mode === 'all', out = [];
    for (const r of v.rooms || []) {
      if (r.type !== 'lab' || !r.lab || r.lab.primary === false) continue; // 다중 메인 구역: 플랫폼은 연구동마다 하나(첫 구역 방)
      const pid = all ? r.projectId || null : this.st.book.defaultProject;
      if (pid && (!all || this.st.book.projects.has(pid))) out.push([pid, r]);
      if (!all) break;
    }
    return out;
  }
  _prepare(now, dt, env) {
    const st = this.st, v = this.view, book = st.book;
    st.fx.step(now);
    const rooms = this._labRooms();
    const all = v.scope && v.scope.mode === 'all';
    // 플랫폼 반지름(단일 세션): 보이는 대상 수 → 히스테리시스 → LabView.setPlatformRadius(배치를 다시 함)
    if (!all && rooms.length && v.setPlatformRadius) {
      const R = this.gate.step(book.layoutItems(rooms[0][0]).items.length, env.nowMs);
      v.setPlatformRadius(R);
    }
    const geoKey = rooms.map(([p, r]) => `${p}@${r.lab.cx},${r.lab.cz},${r.lab.rP}`).join(';');
    const key = book.version + '|' + geoKey;
    if (key !== this._pk && (now - this._pkAt >= 0.25 || !this._pk.endsWith('|' + geoKey))) {
      this._pk = key; this._pkAt = now;
      this.plans.clear(); st.lay.clear();
      for (const [pid, r] of rooms) {
        const plan = labSectorPlan(book.layoutItems(pid).items, r.lab.rP, this._prev.get(pid) || null);
        this._prev.set(pid, plan);
        this.plans.set(pid, { plan, cx: r.lab.cx, cz: r.lab.cz, rWall: r.lab.R ? r.lab.R.rWall : null });
        st.lay.set(pid, plan); // ArtState.focusFor 가 lay.has(pid) 를 봄
      }
      for (const p of [...this._prev.keys()]) if (!this.plans.has(p)) this._prev.delete(p);
      if (st.foot) st.foot.set = book.touchedBy(st.foot.pid, st.foot.node);
      let nb = 0, ns = 0; for (const E of this.plans.values()) { nb += E.plan.nBlocks; ns += E.plan.sectors.length; }
      this.stats.blocks = nb; this.stats.sectors = ns;
    }
    env.actOrigin = this._actOriginFn; // bg 기자재발 연출 출발점
    env.unitPx = (pid) => { const E = this.plans.get(pid); return E ? this._pxAt(E.cx, LAB.PLATFORM.H, E.cz) : 20; };
    // 바닥 이름판(NamePlates3D)은 쓰지 않음 — 플랫폼 위는 블록이 덮음. 프로젝트 이름은 연구동 문패(리드)· 스텐실 몫
  }
  _geometry(now, env) { return labPlatformGeometry(this.st.book, this.plans, this.st.fx, now, env, this.st.geo); }
  /** 2D·시험이 같은 계획을 쓰게: pid → 계획 */
  planOf(pid) { const E = this.plans.get(pid); return E ? E.plan : null; }
  /** 맞춤: 플랫폼 원 전체는 넣지 않고 중심점 하나(설계) */
  fitPoints(pts, scope = {}) { // eslint-disable-line no-unused-vars
    const r = this.view.rooms && this.view.rooms.find((x) => x.lab);
    if (r) pts.push({ p: { x: r.lab.cx, y: LAB.PLATFORM.H, z: r.lab.cz }, r: 1 });
    return pts;
  }
}
