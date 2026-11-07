// 【모듈 규격 · 캐릭터·책상·지휘석(characters) 담당】 연구동 껍데기 그리기(three) — 바닥·외벽 원호 유리·순환 통로·책상 호·브리지·경사로·
// 라운지·출입문·에어록 포털·외부 단말·공구 카트·모니터 벽·벨. 플랫폼 단(lab-platform.js)·기자재(lab-rigs.js)는 각 담당 파일.
//
// ┌ 입력 ───────────────────────────────────────────────────────────────────────────────────────────┐
// │ room: computeLab 결과의 방(type 'lab', room.lab = {cx,cz,rP,rows,R,bridge,…}, desks, leadDesk, door, portal, bell,        │
// │       stations, breakSlots, client, labLounge) · pal: 복셀 팔레트(palette.js, THREE.Color 표) · tok: 테마 토큰(readTokens)     │
// │ b(정적) = {lit, glow, glass}: BoxBatch — 방이 바뀔 때·카메라 사분면·테마가 바뀔 때만 다시(VoxelView._rebuildStatic)       │
// │ B(동적) = {lit, glow}: 매 프레임 다시 채움 · o = {dim, band(세션 색|null), cam:{x,z}(카메라 사분면 부호), art(작업 대상 층 켬)} │
// │ 좌표: lab-const.mjs(극좌표·브리지 지역 좌표 u,v). BoxBatch.box(x,y,z, sx,sy,sz, color, ry) — ry = θ(라디안)이면           │
// │       sx 가 접선, sz 가 반지름 방향.                                                                                     │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// ┌ 출력 ─ export ──────────────────────────────────────────────────────────────────────────────────┐
// │ buildLabShell(room, pal, b, o)                 정적 상자(그리기 호출 늘지 않음 — 기존 묶음에 넣기만)                         │
// │ drawLabFacilities(room, act, pal, tok, t, B, dim)  시설 애니메이션(포털 빛·벨·커피 김…) — act = room._act(시설 활동도)        │
// │ drawLabDeskEmitters(room, B, pal, info)        책상 발광대. info(nodeId) → {state:'off'|'dim'|'on'|'flash', color, k} | null   │
// │                                                + p(책상 소품 = deskProps 결과|null)·ghost — 예산(LAB_PROP_BOXES) 넘으면 생략   │
// │ drawLabRigCables(room, layout, B, pal, info)   주인 책상 앞 → 기자재 바닥 케이블. info = {t, ownerOf(id), colorOf(owner), │
// │                                                stateOf(id) → rigState, rigAt?(id, m) → 그리는 자리}. 진행만 대시. ≤ 120 상자      │
// │                                                pulseOf?(id, out) → 펄스 수(out[i] = {u 0..1 기자재 → 책상, k 0 출력·1 끝·2 실패·3 설치(책상 → 기자재)}) · light? │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// 성능 상한: 정적 상자 ≤ 2,500(외벽 원호 포함), 동적(시설·발광대) ≤ 200 상자/프레임, 케이블 ≤ CABLE_BOXES(120) 상자/프레임.
// 다중 구역(room.lab.primary === false 인 방): 자기 구역 책상·브리지·콘솔·통신 스크린·벨만 그린다(바닥·외벽·시설은 첫 구역 방).
// 1단계 상태: 단순 상자 모양. 2단계: 실험 가운 덧옷·세미나 탁자·라운지 소품, 3단계: 원호 벽 16 조각 히스테리시스.
import * as THREE from 'three';
import { LAB, polar, DEG, bridgeToWorld } from './lab-const.mjs';
import { DESK_TOP, drawDeskProps } from '../voxel/props.js';
import { labFwd, labPropsOk } from '../voxel/vx-effort-core.mjs'; // 책상 소품(자리 분위기)
import { cableSegsInto } from './lab-marks-core.mjs';
import { RIG_HEX, RIG_KIND_HEX } from './lab-rig-core.mjs';

const _c = new THREE.Color(), _c2 = new THREE.Color();
const dimC = (c, dim, k = 0.55) => (dim ? _c2.copy(c).multiplyScalar(k) : c);

/** 원판(가로 띠) 바닥 */
function disc(L, cx, cz, r, y, h, color, strip = 0.8) {
  for (let z = -r; z < r - 1e-6; z += strip) {
    const zm = Math.min(Math.abs(z), Math.abs(z + strip)), w = Math.sqrt(Math.max(0, r * r - zm * zm));
    L.box(cx, y, cz + z + strip / 2, 2 * w, h, strip, color);
  }
}
/** 고리 띠(접선 조각) */
function ring(L, cx, cz, r, width, y, h, color, seg = 1.2, skip = null) {
  const n = Math.max(12, Math.ceil((2 * Math.PI * r) / seg));
  for (let i = 0; i < n; i++) {
    const th = (i + 0.5) * (360 / n);
    if (skip && skip(th)) continue;
    const p = polar(cx, cz, r, th);
    L.box(p.x, y, p.z, (2 * Math.PI * r) / n + 0.02, h, width, color, th * DEG);
  }
}

export function buildLabShell(room, pal, b, o = {}) {
  const lab = room.lab, { cx, cz, R } = lab, L = b.lit, dim = !!o.dim;
  const primary = lab.primary !== false; // 다중 구역: 바닥·외벽·시설은 첫 구역 방에서만(같은 연구동을 한 번만 그림)
  const doorTh = lab.doorTheta != null ? lab.doorTheta : LAB.FRONT.DOOR;
  if (primary) {
    // 바닥 · 순환 통로 · 안쪽 둘레길
    disc(L, cx, cz, R.rWall, -0.05, 0.1, dimC(pal.floor, dim));
    ring(L, cx, cz, (R.rRigOut + R.rWalkOut) / 2, R.rWalkOut - R.rRigOut, 0.004, 0.01, dimC(pal.floorAlt, dim));
    ring(L, cx, cz, (lab.rP + R.rInner) / 2, R.rInner - lab.rP, 0.004, 0.01, dimC(pal.mat, dim));
    // 외벽 원호 유리(카메라 반대쪽 반원 높게) · 출입문 틈
    const cam = o.cam || { x: 1, z: 1 }, gap = ((LAB.WALL.DOOR_W / 2) / R.rWall) / DEG;
    const doorSkip = (th) => Math.abs(((th - doorTh + 540) % 360) - 180) < gap;
    const n = Math.ceil((2 * Math.PI * R.rWall) / 1.6);
    for (let i = 0; i < n; i++) {
      const th = (i + 0.5) * (360 / n);
      if (doorSkip(th)) continue;
      const a = th * DEG, far = Math.sin(a) * cam.x + Math.cos(a) * cam.z < 0;
      const h = far ? LAB.WALL.H_HIGH : LAB.WALL.H_LOW, p = polar(cx, cz, R.rWall, th), w = (2 * Math.PI * R.rWall) / n + 0.02;
      b.glass.box(p.x, h / 2, p.z, w, h, 0.08, pal.pane, a);
      L.box(p.x, h + 0.03, p.z, w, 0.06, 0.14, dimC(pal.glassFrame, dim), a);
    }
    for (const s of [-1, 1]) { const p = polar(cx, cz, R.rWall, doorTh + s * gap); L.box(p.x, 1.2, p.z, 0.16, 2.4, 0.16, dimC(pal.glassFrame, dim)); }
  }
  // 책상 호(스탠딩 데스크, 중심을 봄)
  for (const d of room.desks) {
    const a = d.theta * DEG;
    L.box(d.x, DESK_TOP - 0.03, d.z, LAB.DESK.W, 0.06, LAB.DESK.D, dimC(pal.deskTop, dim), a);
    for (const s of [-0.85, 0.85]) L.box(d.x + Math.cos(a) * s, (DESK_TOP - 0.06) / 2, d.z - Math.sin(a) * s, 0.08, DESK_TOP - 0.06, 0.5, dimC(pal.deskLeg, dim), a);
  }
  // 브리지(덱 + 앞 유리 난간 + 경사로 계단 판 + 콘솔)
  const B = LAB.BRIDGE, f = lab.bridge, ay = f.theta * DEG, hw = B.W / 2, hd = B.D / 2;
  L.box(f.c.x, B.Y / 2, f.c.z, B.W, B.Y, B.D, dimC(pal.wall, dim), ay);
  L.box(f.c.x, B.Y + 0.005, f.c.z, B.W - 0.3, 0.01, B.D - 0.3, dimC(pal.carpetLead, dim), ay);
  const W = (u, v) => bridgeToWorld(f, u, v, {});
  for (const u of [-hd, hd]) { const p = W(u, 0); b.glass.box(p.x, B.Y + B.RAIL_H / 2, p.z, B.W, B.RAIL_H, 0.06, pal.pane, ay); }
  for (const s of [-1, 1]) {
    const pe = W(B.RAMP_W / 2, s * hw); // 덱 끝 난간(u = −D/2 + RAMP_W ～ D/2 — 경사로 폭만 열림)
    b.glass.box(pe.x, B.Y + B.RAIL_H / 2, pe.z, 0.06, B.RAIL_H, B.D - B.RAMP_W, pal.pane, ay);
    const steps = 6;
    for (let k = 0; k < steps; k++) {
      const v = s * (hw + (k + 0.5) * (B.RAMP_L / steps)), y = B.Y * (1 - (k + 0.5) / steps), p = W(-hd + B.RAMP_W / 2, v);
      L.box(p.x, y / 2, p.z, B.RAMP_L / steps + 0.02, Math.max(0.04, y), B.RAMP_W, dimC(pal.trim, dim), ay);
    }
  }
  const ld = room.leadDesk;
  if (ld) L.box(ld.x, B.Y + DESK_TOP - 0.03, ld.z, B.CONSOLE_W, 0.06, B.CONSOLE_D, dimC(pal.deskTop, dim), ay);
  // 통신 스크린(의뢰인 창구)
  if (room.client) { const s = room.client.screen; L.box(s.x, s.y, s.z, 2.0, 1.2, 0.08, dimC(pal.screenOff, dim), ay); }
  // 공유 시설(첫 구역 방만): 라운지 카운터 · 포털 틀 · 외부 단말 · 공구 카트 · 모니터 벽
  if (primary) {
    if (room.labLounge) { const lg = room.labLounge, p = polar(cx, cz, lg.r + 0.4, lg.theta); L.box(p.x, 0.5, p.z, 2.2, 1.0, 0.7, dimC(pal.counter, dim), lg.theta * DEG); }
    if (room.portal) { const pt = room.portal, a = (pt.theta != null ? pt.theta : LAB.FRONT.PORTAL) * DEG; L.box(pt.x, 1.3, pt.z, 2.4, 2.6, 0.3, dimC(pal.portal, dim, 0.4), a); }
    for (const [cat, col, h] of [['mcp', pal.kiosk, 1.4], ['skill', pal.toolbox, 0.9], ['monitor', pal.screenDim, 1.8]]) {
      const st = room.stations[cat];
      if (!st || !st.length) continue;
      const s0 = st[Math.floor(st.length / 2)], a = s0.face;
      L.box(s0.x + Math.sin(a) * 1.0, h / 2, s0.z + Math.cos(a) * 1.0, 1.2, h, 0.6, dimC(col, dim), a);
    }
  }
  // 구역 색 띠(다중 세션): 브리지 앞 난간 아래 바닥 띠
  if (o.band && lab.zones && lab.zones.length > 1) { const p = bridgeToWorld(lab.bridge, -LAB.BRIDGE.D / 2 - 0.25, 0, {}); L.box(p.x, 0.012, p.z, LAB.BRIDGE.W, 0.012, 0.3, o.band, lab.bridge.theta * DEG); }
  if (room.bell) L.box(room.bell.x, B.Y + 0.5, room.bell.z, 0.3, 1.0, 0.3, dimC(pal.bell, dim));
}

/** 시설 애니메이션(1단계: 포털 쓰는 동안 빛) */
export function drawLabFacilities(room, act, pal, tok, t, B, dim) {
  if (!room || !room.portal || dim || (room.lab && room.lab.primary === false)) return; // 공유 시설은 첫 구역 방에서 한 번
  if (act && act.portal) { const pt = room.portal; B.glow.box(pt.x, 1.3, pt.z, 1.8, 2.0, 0.08, _c.copy(pal.portalCore).multiplyScalar(0.7 + 0.3 * Math.sin(t * 6)), (pt.theta != null ? pt.theta : LAB.FRONT.PORTAL) * DEG); }
}

/** 책상 발광대(책상 앞 끝 = 플랫폼 쪽 빛줄) + 책상 소품(자리 분위기, 오피스와 같은 deskProps) */
export function drawLabDeskEmitters(room, B, pal, info) {
  const G = B.glow;
  let used = 0; // 소품 동적 상자(방마다 예산 — 넘으면 그 뒤 책상은 소품 생략, 옷은 그대로)
  const one = (x, z, y0, theta, wide, s) => {
    if (!s || s.state === 'off') return;
    const a = theta * DEG, c = s.state === 'flash' ? _c.copy(s.color).lerp(_c2.set(0xffffff), 0.5) : s.state === 'dim' ? _c.copy(pal.emitter).multiplyScalar(pal.isLight ? 0.7 : 0.45) : _c.copy(s.color);
    const off = LAB.DESK.D / 2 - 0.12, px = x - Math.sin(a) * off, pz = z - Math.cos(a) * off;
    G.box(px, y0 + DESK_TOP + 0.012, pz, wide * 0.55, 0.016, 0.05, c, a);
    if (s.p && s.p.boxes && labPropsOk(used, s.p.boxes)) { const f = labFwd(a); used += drawDeskProps(B.lit, G, s.p, x, z, f.x, f.z, y0 + DESK_TOP, pal, a, s.ghost || 0); }
  };
  const ld = room.leadDesk;
  if (ld) one(ld.x, ld.z, ld.floorY || 0, room.lab.bridge.theta, LAB.BRIDGE.CONSOLE_W, info(room.ownerId));
  for (const d of room.desks) if (d.occupant) one(d.x, d.z, 0, d.theta, LAB.DESK.W, info(d.occupant));
}


/**
 * 【리드】 전체 보기 연구동 바닥판·유리 돔(비활성 = 닫힘). bd = computeLabCampus 동 {lab:{cx,cz,rWall}, dome, recent}.
 * 연구동 방이 없는 동(루트 없는 live/recent 프로젝트)은 바닥 원판도 여기서. 정적 상자 ≈ 800(유리 고리 6 × 32 + 위도 틀 고리 7 + 갈비 8 × 20).
 */
export function buildLabDome(bd, pal, b, o = {}) {
  const lb = bd && bd.lab;
  if (!lb) return;
  const { cx, cz } = lb, rW = lb.rWall, dim = !!o.dim, L = b.lit;
  if (bd.recent) disc(L, cx, cz, rW, 0.03, 0.06, dimC(pal.floor || pal.trim, dim));
  ring(L, cx, cz, rW + 0.9, 1.4, -0.08, 0.2, dimC(pal.trim, dim), 2.0); // 바깥 보도 고리
  if (!bd.dome) return;
  const rings = 6, seg = 32, Hk = 0.55; // 납작한 돔(높이 = 반지름 × 0.55)
  const G = b.glass || L, glassC = dimC(pal.glass || pal.screenOff || pal.metal, dim);
  // 계단식 유리 고리: 고리마다 반지름 폭(dr)만큼 깊이를 줘 위에서 봐도 면이 보이게(예전 얇은 세로 판은 위에서 검은 원판 + 가는 선으로만 보였다, QA 10.31.)
  const PH = (k) => (k / rings) * (Math.PI / 2) * 0.92;
  for (let k = 0; k < rings; k++) {
    const p0 = PH(k), p1 = PH(k + 1), r0 = rW * Math.cos(p0), r1 = rW * Math.cos(p1), y0 = rW * Hk * Math.sin(p0), y1 = rW * Hk * Math.sin(p1);
    const rr = (r0 + r1) / 2, dr = Math.max(0.12, r0 - r1), hy = Math.max(0.12, y1 - y0);
    const n = Math.max(8, Math.round(seg * Math.cos((p0 + p1) / 2)));
    for (let i = 0; i < n; i++) {
      const th = (i + 0.5) * (360 / n), p = polar(cx, cz, rr, th);
      G.box(p.x, (y0 + y1) / 2, p.z, (2 * Math.PI * rr) / n + 0.05, hy, dr, glassC, th * DEG);
    }
  }
  disc(G, cx, cz, rW * Math.cos(PH(rings)), rW * Hk * Math.sin(PH(rings)), 0.1, glassC); // 꼭대기 유리 덮개
  // 유리는 투명도 0.2 공용 재질이라 어두운 바닥 위에서 거의 안 보임 → 돔 모양은 밝은 틀(위도 고리 + 이어진 갈비)로 읽히게(QA 11.01. 재확인: 위에서 평평한 원판 + 기둥 몇 개로만 보였다)
  const frame = new THREE.Color().copy(dimC(pal.glassFrame || pal.metal, dim)).lerp(dimC(pal.pane || pal.glass || pal.metal, dim), 0.45);
  for (let k = 0; k <= rings; k++) { // 위도 고리(바닥 테 포함)
    const ph = PH(k), r = rW * Math.cos(ph) + 0.06, y = rW * Hk * Math.sin(ph);
    if (r > 1) ring(L, cx, cz, r, 0.24, y + 0.06, 0.24, frame, 2.2);
  }
  const S = 20, top = PH(rings);
  for (let m = 0; m < 8; m++) { // 갈비: 잘게 쌓은 계단으로 곡선을 따라 이어짐
    const th = m * 45 + 22.5;
    for (let k = 0; k < S; k++) {
      const p0 = (k / S) * top, p1 = ((k + 1) / S) * top;
      const r0 = rW * Math.cos(p0), r1 = rW * Math.cos(p1), y0 = rW * Hk * Math.sin(p0), y1 = rW * Hk * Math.sin(p1);
      const p = polar(cx, cz, (r0 + r1) / 2 + 0.08, th);
      L.box(p.x, (y0 + y1) / 2, p.z, 0.26, Math.max(0.26, y1 - y0 + 0.08), Math.max(0.26, r0 - r1 + 0.08), frame, th * DEG);
    }
  }
  L.box(cx, rW * Hk + 0.1, cz, 2.2, 0.25, 2.2, frame); // 꼭대기 환기 뚜껑
}

/** 케이블 동적 상자 상한(LAB_PERF 동적 묶음 안) · 기자재가 이보다 많으면 케이블 생략 */
export const CABLE_BOXES = 120;
export const CABLE_RIGS_MAX = 30;
const _cc = new THREE.Color();
// 프레임마다 할당 0: 기자재 목록·조각·끝점은 모듈 버퍼를 다시 씀
const _rigM = [], _rigId = [], _segs = [], _from = { x: 0, z: 0 };
const _pul = [], _kc = new Map();
/** 기자재 종류·상태 색(THREE.Color 캐시 — 테마별 hex 문자열 열쇠) */
const hexC = (h) => { let c = _kc.get(h); if (!c) { c = new THREE.Color(h); _kc.set(h, c); } return c; };
/**
 * 【T3】 주인 책상 앞 → 기자재 바닥 케이블(바닥 0.03 높이 얇은 상자 조각). room = 연구동 첫 구역 방(primary),
 * layout = computeLab/Campus 결과(이 연구동 원 안의 기자재·자리만 씀). 색 = info.colorOf(주인), 상태 = info.stateOf(기자재 id):
 * 'run' = 조각 밝기 위상 + 흐르는 대시 하나 · 'done'/'fail' = 옅게 · 그 밖 = 중간. 반환 = 쓴 상자 수.
 * info.rigAt(id, m) (선택) → 기자재가 지금 그려지는 자리 {x, z}(반지름 보간 중이면 보간 자리 — 케이블 끝이 몸체와 벌어지지 않게).
 */
export function drawLabRigCables(room, layout, B, pal, info) {
  const lab = room && room.lab;
  if (!lab || lab.primary === false || !layout || !(layout.machine instanceof Map) || !info) return 0;
  const { cx, cz } = lab, rIn = lab.R ? lab.R.rWall : 30;
  let nr = 0;
  for (const id of layout.machine.keys()) {
    const m = layout.machine.get(id);
    if (m.type !== 'rig' || Math.hypot(m.x - cx, m.z - cz) >= rIn) continue;
    if (nr >= CABLE_RIGS_MAX) { nr = 0; break; }
    _rigId[nr] = id; _rigM[nr] = m; nr++;
  }
  if (!nr) return 0;
  const L = B.lit, G = B.glow, t = info.t || 0;
  let used = 0;
  for (let ri = 0; ri < nr; ri++) {
    const id = _rigId[ri], m = _rigM[ri];
    const o = info.ownerOf(id), s = o && layout.seat.get(o);
    if (!s || !Number.isFinite(s.deskX)) continue;
    const th = Math.atan2(s.deskX - cx, s.deskZ - cz), rd = Math.hypot(s.deskX - cx, s.deskZ - cz);
    const r0 = s.kind === 'lead' && lab.R ? lab.R.rBridgeIn - 0.3 : rd - LAB.DESK.D / 2 - 0.15; // 팀장 = 브리지 앞 바닥
    _from.x = cx + Math.sin(th) * r0; _from.z = cz + Math.cos(th) * r0;
    const to = (info.rigAt && info.rigAt(id, m)) || m;
    const ns = cableSegsInto(_from, to, cx, cz, _segs);
    const st = info.stateOf(id), run = st === 'run', ended = st === 'done' || st === 'fail';
    const need = ns + (run ? 1 : 0);
    if (used + need > CABLE_BOXES) break;
    const base = info.colorOf(o);
    if (!base) continue;
    let total = 0;
    for (let k = 0; k < ns; k++) { const g = _segs[k]; total += Math.hypot(g.bx - g.ax, g.bz - g.az); }
    for (let k = 0; k < ns; k++) {
      const g = _segs[k], dx = g.bx - g.ax, dz = g.bz - g.az, len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const kk = ended ? 0.3 : run ? 0.65 + 0.35 * Math.sin(t * 5 - k * 1.3) : 0.55;
      L.box((g.ax + g.bx) / 2, 0.03, (g.az + g.bz) / 2, 0.07, 0.02, len + 0.06, _cc.copy(base).multiplyScalar(kk), Math.atan2(dx, dz));
      used++;
    }
    if (run && total > 0.3) { // 흐르는 대시: 책상 → 기자재 쪽으로
      let d = ((t * 1.6 + (m.slot || 0) * 0.37) % 1) * total;
      for (let k = 0; k < ns; k++) {
        const g = _segs[k], dx = g.bx - g.ax, dz = g.bz - g.az, len = Math.hypot(dx, dz);
        if (d > len) { d -= len; continue; }
        const u = len > 0 ? d / len : 0;
        G.box(g.ax + dx * u, 0.045, g.az + dz * u, 0.1, 0.03, 0.35, _cc.copy(base).lerp(_c2.set(0xffffff), 0.35), Math.atan2(dx, dz));
        used++;
        break;
      }
    }
    // C 데이터 펄스(출력 = m.flashUntil 상승 · 끝 초록 · 실패 빨강 · 설치는 책상 → 기자재): 케이블마다 ≤ 2, 상한을 넘으면 생략
    const np = info.pulseOf && total > 0.3 ? info.pulseOf(id, _pul) : 0;
    for (let pi = 0; pi < np && used < CABLE_BOXES; pi++) {
      const P = _pul[pi], H = info.light ? RIG_HEX.light : RIG_HEX.dark;
      const pc = P.k === 1 ? hexC(H.done) : P.k === 2 ? hexC(H.fail) : _cc.copy(base).lerp(hexC((info.light ? RIG_KIND_HEX.light : RIG_KIND_HEX.dark)[m.rigKind] || H.kind), 0.5).lerp(_c2.set(0xffffff), 0.25);
      let d = (P.k === 3 ? P.u : 1 - P.u) * total; // 기자재 → 책상(설치만 반대)
      for (let k = 0; k < ns; k++) {
        const g = _segs[k], dx = g.bx - g.ax, dz = g.bz - g.az, len = Math.hypot(dx, dz);
        if (d > len) { d -= len; continue; }
        const u = len > 0 ? d / len : 0;
        G.box(g.ax + dx * u, 0.05, g.az + dz * u, 0.12, 0.03, 0.4, pc, Math.atan2(dx, dz));
        used++;
        break;
      }
    }
  }
  _rigM.fill(null, 0, nr); // 배치 객체를 붙잡지 않게
  return used;
}
