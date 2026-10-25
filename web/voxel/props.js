// 복셀 가구·시설·기계 (개편) — 전부 공유 단위 BoxGeometry 하나를 scale 해서 쓴다.
// 그리기는 BoxBatch(InstancedMesh, 인스턴스 색) 에 상자를 밀어 넣는 방식: 정적(방 바뀔 때만 다시) / 동적(매 프레임).
// 벽 = 유리 칸막이(반투명 묶음 b.glass) + 프레임, 창 벽 = 바깥 커튼월(창밖 하늘: 다크 야경 · 라이트 낮),
//      바닥 = 한 장 + 카펫 구역(타일 상자 수 줄임), 책상 = 스탠딩 데스크(상판 0.92 · 홀로그램 발광대), 탕비실 카운터,
//      특별 상호작용 시설(발송대·문서고/금고·원격 부스·분류 컨베이어·신호등 보드)·의뢰인 화상 스크린.
import * as THREE from 'three';
import { quarter, wallHigh, windowWall } from './xf.mjs';
import { OFFICE_FX } from './office-core.mjs';
export { windowWall };

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const EMPTY_BAND = Object.freeze([]);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _mx = new THREE.Matrix4(), _mt = new THREE.Matrix4();
const PORTAL_YAW = Math.PI / 4;                 // 포털 고리는 기본 카메라 방위(45°)를 향함
// 돌린 방에서도 고리가 카메라를 보게: 지역 yaw = 45° − 회전각
const portalYaw = (b) => PORTAL_YAW - (b.lit && b.lit.xf ? quarter(b.lit.xf.k) * Math.PI / 2 : 0);
export const DESK_TOP = 0.92;                   // 스탠딩 데스크 상판 높이

/**
 * 유령 재질: 원래 묶음 재질을 복제해 반투명으로, 인스턴스 알파(iAlpha)를 곱한다(유리는 원래 불투명도 × 알파).
 * 깊이는 쓰지 않는다 — 사라지는 동은 가구·벽이 겹쳐 비치며 옅어지고, 뒤의 불투명 물체·다른 반투명 묶음을 가리지 않는다.
 */
function ghostMaterial(src) {
  const m = src.clone();
  m.transparent = true;
  m.depthWrite = false;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float iAlpha;\nvarying float vIAlpha;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vIAlpha = iAlpha;');
    sh.fragmentShader = 'varying float vIAlpha;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vIAlpha;');
  };
  m.customProgramCacheKey = () => 'ccviz-ghost';
  return m;
}

/** 상자 묶음 1개 = draw call 1개. 용량이 차면 두 배로 다시 만든다(드묾). */
export class BoxBatch {
  constructor(material, cap = 1024, parent = null) {
    this.material = material;
    this.parent = parent;
    this.owners = [];
    this.n = 0;
    this._alloc(cap);
  }
  _alloc(cap) {
    const old = this.mesh;
    const mesh = new THREE.InstancedMesh(UNIT_BOX, this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    if (old) {
      mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, Math.min(old.instanceMatrix.array.length, mesh.instanceMatrix.array.length)));
      mesh.instanceColor.array.set(old.instanceColor.array.subarray(0, Math.min(old.instanceColor.array.length, mesh.instanceColor.array.length)));
      mesh.castShadow = old.castShadow; mesh.receiveShadow = old.receiveShadow; mesh.renderOrder = old.renderOrder;
      if (old.parent) { old.parent.add(mesh); old.parent.remove(old); }
      old.dispose();
    } else if (this.parent) this.parent.add(mesh);
    this.mesh = mesh;
    this.cap = cap;
  }
  begin() { this.n = 0; this.gn = 0; this.xf = null; }
  /**
   * 프로젝트 페이드: fade(x, z) → 0..1(그 자리 동의 투명도). 0 이면 넣지 않고(숨김), 0 < a < 1 이면 진짜 투명
   * 같은 재질을 복제한 반투명 유령 묶음(인스턴스 알파, 깊이 안 씀)에 넣는다. 유령은 페이드가 움직이는 0.5초 동안만 차고
   * 평소엔 비어 있어(count 0·숨김) 그리기 호출이 늘지 않는다. 모든 방·가구·캐릭터·기계·연출이 이 한 곳을 지난다. null = 끔(비용 0).
   * bg 는 예전 배경색 섞기 방식의 흔적(받기만 함 — 테마·안개·바닥색과 맞지 않아 밝은 테마에서 회백색 띠가 보였다).
   */
  setFade(fn, bg) { this.fade = fn || null; if (bg) this.fadeBg = bg; }
  _ghostAlloc(cap) {
    const old = this.ghost;
    const geo = UNIT_BOX.clone();
    const alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAlpha', alpha);
    const mesh = new THREE.InstancedMesh(geo, old ? old.mesh.material : ghostMaterial(this.material), cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false;
    mesh.renderOrder = Math.max(1, this.mesh.renderOrder); // 불투명 뒤, 유리(2)와 같거나 앞
    mesh.raycast = () => {}; // 나가는 동은 집지 않는다
    if (old) {
      mesh.instanceMatrix.array.set(old.mesh.instanceMatrix.array);
      mesh.instanceColor.array.set(old.mesh.instanceColor.array);
      alpha.array.set(old.alpha.array);
      old.mesh.removeFromParent(); old.mesh.geometry.dispose(); old.mesh.dispose();
    }
    const parent = this.mesh.parent || this.parent;
    if (parent) parent.add(mesh);
    this.ghost = { mesh, alpha, cap };
    return this.ghost;
  }
  _ghostPush(m, c, a) {
    let g = this.ghost || this._ghostAlloc(256);
    if (this.gn >= g.cap) g = this._ghostAlloc(g.cap * 2);
    const i = this.gn++;
    g.mesh.setMatrixAt(i, m);
    g.mesh.instanceColor.setXYZ(i, c.r, c.g, c.b);
    g.alpha.array[i] = a;
  }
  /**
   * 돌린 방 그리기: xf = {k, px, pz} 이면 이후 상자를 (px, pz) 둘레로 k 사분 회전해 넣는다(null = 해제).
   * 방 그림 함수는 room.local(회전 전 좌표)로 그리고 이것이 세계로 옮긴다.
   */
  setXf(xf) {
    const k = xf ? quarter(xf.k) : 0;
    this.xf = k ? xf : null;
    if (k) {
      const M = this._xm || (this._xm = new THREE.Matrix4());
      M.makeRotationY(k * Math.PI / 2).multiply(_mt.makeTranslation(-xf.px, 0, -xf.pz));
      M.premultiply(_mt.makeTranslation(xf.px, 0, xf.pz));
    }
  }
  /** 월드 행렬 m, 색 c(THREE.Color), owner(nodeId 또는 null) */
  pushMatrix(m, c, owner = null) {
    if (this.xf) m = _mx.copy(m).premultiply(this._xm);
    if (this.fade) {
      const a = this.fade(m.elements[12], m.elements[14]);
      if (a <= 0) return;
      if (a < 1) { this._ghostPush(m, c, a); return; } // 진짜 투명(유령 묶음)
    }
    if (this.n >= this.cap) this._alloc(this.cap * 2);
    const i = this.n++;
    this.mesh.setMatrixAt(i, m);
    this.mesh.instanceColor.setXYZ(i, c.r, c.g, c.b);
    this.owners[i] = owner;
  }
  /** 축 정렬 상자(yaw 회전 ry 선택) */
  box(x, y, z, sx, sy, sz, c, ry = 0, owner = null) {
    if (ry) { _q.setFromAxisAngle(Y_AXIS, ry); } else _q.identity();
    _p.set(x, y, z); _s.set(Math.max(1e-4, sx), Math.max(1e-4, sy), Math.max(1e-4, sz));
    _m.compose(_p, _q, _s);
    this.pushMatrix(_m, c, owner);
  }
  end() {
    const mesh = this.mesh;
    mesh.count = this.n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    if (this.owners.length > this.n) this.owners.length = this.n;
    const g = this.ghost;
    if (g) {
      const gn = this.gn || 0;
      if (gn || g.mesh.count) { g.mesh.count = gn; g.mesh.instanceMatrix.needsUpdate = true; g.mesh.instanceColor.needsUpdate = true; g.alpha.needsUpdate = true; }
      g.mesh.visible = gn > 0;
    }
  }
  dispose() {
    if (this.ghost) { const g = this.ghost.mesh; g.removeFromParent(); g.geometry.dispose(); g.material.dispose(); g.dispose(); this.ghost = null; }
    if (this.mesh) { this.mesh.removeFromParent(); this.mesh.dispose(); }
    this.material.dispose();
    this.mesh = null;
  }
}

/**
 * 부모 행렬 B 아래 관절 상자: 관절(j) 에서 회전(rx,ry,rz, 'YXZ') 후 오프셋(o) 만큼 간 곳에 크기(s) 상자.
 * B 가 null 이면 월드 기준.
 */
export function partBox(batch, B, jx, jy, jz, rx, ry, rz, ox, oy, oz, sx, sy, sz, c, owner = null) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _v.set(ox, oy, oz).applyQuaternion(_q);
  _p.set(jx + _v.x, jy + _v.y, jz + _v.z);
  _s.set(Math.max(1e-4, sx), Math.max(1e-4, sy), Math.max(1e-4, sz));
  _m.compose(_p, _q, _s);
  if (B) _m.premultiply(B);
  batch.pushMatrix(_m, c, owner);
}

const dimmed = (c, k) => _c2.copy(c).multiplyScalar(k);

/** 돌린 방이면 lit·glow·glass 에 xf 를 걸고 회전 전 방(room.local)을 돌려준다. 다 그린 뒤 endXf(b) */
export function roomFrame(room, b) {
  const xf = room && room.xf && quarter(room.xf.k) && room.local ? room.xf : null;
  if (b.lit) b.lit.setXf(xf);
  if (b.glow) b.glow.setXf(xf);
  if (b.glass) b.glass.setXf(xf);
  return xf ? room.local : room;
}
export function endXf(b) { if (b.lit) b.lit.setXf(null); if (b.glow) b.glow.setXf(null); if (b.glass) b.glass.setXf(null); }

// 결정적 의사 난수(정적 그림의 스카이라인·책 등)
function rnd(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

/**
 * 바닥·벽·문·가구(움직이지 않는 것). put = {lit:BoxBatch, glow:BoxBatch, glass:BoxBatch}
 * 벽 높이는 세계 방향으로 정한다: 기본 카메라에서 먼 쪽(−x·−z 를 보는 벽)은 높게, 가까운 쪽은 낮게 — 돌린 방도 안이 보인다.
 * 칸막이는 유리(반투명) + 얇은 프레임·기둥, 창 벽(windowWall)은 바깥 커튼월 = 창밖 하늘.
 * band = 세션 색(높은 벽 윗면 띠·문 위 띠·문 밖 깔개)
 */
export function buildRoomStatic(room0, pal, b, { dim = false, band = null } = {}) {
  const xf = room0.xf;
  const room = roomFrame(room0, b);
  const L = b.lit, G = b.glow, Q = b.glass || b.lit;
  const k = dim ? pal.dimFactor : 1;
  const C = (c) => (dim ? dimmed(c, k) : c);
  const o = room.origin;
  const W = room.size.w, D0 = room.type === 'office' ? 18 : 12;
  const x0 = o.x - W / 2, x1 = o.x + W / 2, zb = o.z - D0 / 2, zf = room.bounds.maxZ;
  // 바닥: 한 장 + 카펫 구역
  L.box(o.x, -0.05, (zb + zf) / 2, W, 0.1, zf - zb, C(pal.floor));
  if (room.type === 'office') {
    L.box(o.x, 0.005, (-3.6 + o.z + zf - 1.6) / 2, 17.6, 0.02, Math.max(1, zf - 1.6 - (o.z - 3.6)), C(pal.carpet));
    if (room.leadDesk) L.box(room.leadDesk.x, 0.006, room.leadDesk.z - 0.3, 6.2, 0.02, 3.8, C(pal.carpetLead));
  } else L.box(o.x, 0.005, o.z + (room.ext || 0) / 2, W - 3, 0.02, D0 - 4 + (room.ext || 0), C(pal.carpet));
  const H = 2.2, LOW = 1.0, T = 0.12;
  const hi = { back: wallHigh(xf, 'back'), left: wallHigh(xf, 'left'), front: wallHigh(xf, 'front'), right: wallHigh(xf, 'right') };
  const ww = room.type === 'office' ? windowWall(room0) : null;
  room._skyBuild = (room._skyBuild || 0) + 1;
  const topC = band ? C(band) : C(pal.glassFrame);
  // 유리 칸막이 한 토막(가로 = x 방향 또는 세로 = z 방향)
  const pane = (ax, az, bx, bz, side) => {
    const h = hi[side] ? H : LOW;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) return;
    const cx = (ax + bx) / 2, cz = (az + bz) / 2, alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    const sx = alongX ? len : T, sz = alongX ? T : len;
    L.box(cx, 0.07, cz, sx + (alongX ? 0 : 0.02), 0.14, sz + (alongX ? 0.02 : 0), C(pal.glassFrame)); // 걸레받이
    Q.box(cx, 0.14 + (h - 0.14) / 2, cz, alongX ? len : 0.05, h - 0.14, alongX ? 0.05 : len, C(pal.pane));
    L.box(cx, h, cz, sx + 0.02, 0.06, sz + 0.02, hi[side] ? topC : C(pal.glassFrame)); // 윗 프레임(높은 벽 = 세션 색)
    const n = Math.max(1, Math.round(len / 3));
    for (let i = 1; i < n; i++) { const u = i / n; L.box(ax + (bx - ax) * u, h / 2, az + (bz - az) * u, 0.06, h, 0.06, C(pal.glassFrame)); }
    for (const [px, pz] of [[ax, az], [bx, bz]]) L.box(px, h / 2, pz, 0.08, h, 0.08, C(pal.glassFrame));
  };
  const wallX = (xa, xb, z, side) => (ww === side ? skyWall(L, G, xa, xb, z, side === 'front' ? -1 : 1, pal, C, room) : pane(xa, z, xb, z, side));
  // 뒤 벽(뒷문 있으면 가운데 틈)
  const backZ = zb - T / 2;
  if (room.backDoor) { wallX(x0, o.x - 0.9, backZ, 'back'); wallX(o.x + 0.9, x1, backZ, 'back'); L.box(o.x, -0.04, zb - 0.6, 1.8, 0.08, 1.2, C(pal.corridor)); }
  else wallX(x0, x1, backZ, 'back');
  // 왼쪽 벽(회의실은 통로 쪽 틈)
  const leftX = x0 - T / 2;
  if (room.leftDoor != null) { pane(leftX, zb, leftX, room.leftDoor - 0.9, 'left'); pane(leftX, room.leftDoor + 0.9, leftX, zf, 'left'); }
  else pane(leftX, zb, leftX, zf, 'left');
  // 앞 벽(출입문 틈)·오른쪽 벽
  const dx = room.door.x, frontZ = zf + T / 2;
  wallX(x0, dx - 0.8, frontZ, 'front'); wallX(dx + 0.8, x1, frontZ, 'front');
  pane(x1 + T / 2, zb, x1 + T / 2, zf, 'right');
  // 문틀(유리문 기둥·위 틀)
  const dh = hi.front ? H : 2.1;
  for (const s of [-1, 1]) L.box(dx + s * 0.8, dh / 2, frontZ, 0.1, dh, T + 0.04, C(pal.glassFrame));
  L.box(dx, dh, frontZ, 1.7, 0.08, T + 0.04, C(pal.glassFrame));
  L.box(dx, -0.035, zf - 0.5, 1.4, 0.07, 0.9, C(pal.mat));
  if (band) { // 문 위 색 띠 + 문 밖 깔개(세션 색) — 기본 시점에서 어느 세션 사무실인지 보이게
    L.box(dx, dh + 0.14, frontZ, 1.9, 0.16, T + 0.08, C(band));
    L.box(dx, -0.02, zf + 1.0, 1.9, 0.06, 1.3, C(band));
  }
  if (room.type === 'office') buildOfficeFurniture(room, pal, b, C, ww);
  else buildMeetingFurniture(room, pal, b, C);
  endXf(b);
}

/**
 * 창 벽 = 바깥 커튼월: 아래 벽(0.35) + 하늘(띠 셋으로 그러데이션) + 스카이라인(다크 = 불 켜진 창·별, 라이트 = 옅은 실루엣) + 창살.
 * 하늘·불빛은 빛 묶음(조명 영향 없음). inward = 방 안쪽 z 방향(+1 = 뒤 벽, −1 = 앞 벽)
 */
function skyWall(L, G, xa, xb, z, inward, pal, C, room) {
  const len = xb - xa;
  if (len < 1e-3) return;
  const cx = (xa + xb) / 2, H = 2.2;
  L.box(cx, 0.18, z, len, 0.36, 0.14, C(pal.wall));
  const zs = z + inward * 0.02;
  // 하늘 띠 셋(아래 → 위)
  const bands = [[0.36, 0.95, pal.skyLow], [0.95, 1.6, pal.skyMid], [1.6, H, pal.skyTop]];
  for (const [y0, y1, c] of bands) G.box(cx, (y0 + y1) / 2, zs, len, y1 - y0, 0.03, C(c));
  // 스카이라인(결정적): 건물 실루엣 + 불 켜진 창(다크)
  const r = rnd(Math.round(xa * 31 + z * 17 + 7));
  const night = !pal.isLight;
  const zk = z + inward * 0.04, zl = z + inward * 0.055;
  for (let x = xa + 0.1; x < xb - 0.2;) {
    const w = 0.35 + r() * 0.75, h = 0.25 + r() * (night ? 0.95 : 0.8), xc = Math.min(x + w / 2, xb - 0.1);
    const ww = Math.min(w, xb - 0.1 - x);
    if (ww > 0.1) {
      G.box(xc, 0.36 + h / 2, zk, ww, h, 0.02, C(pal.skyline));
      if (night) for (let yy = 0.48; yy < 0.36 + h - 0.08; yy += 0.18) for (let xx = x + 0.08; xx < x + ww - 0.06; xx += 0.16) if (r() < 0.22) G.box(xx, yy, zl, 0.05, 0.05, 0.01, C(pal.skylineLit));
    }
    x += w + 0.05 + r() * 0.25;
  }
  if (night) for (let i = 0; i < Math.round(len * 0.9); i++) G.box(xa + r() * len, 1.75 + r() * 0.4, zl, 0.03, 0.03, 0.01, C(pal.star));
  // 창살·위 틀
  const n = Math.max(1, Math.round(len / 2));
  for (let i = 0; i <= n; i++) L.box(xa + (len * i) / n, 0.36 + (H - 0.36) / 2, z + inward * 0.07, 0.06, H - 0.36, 0.06, C(pal.glassFrame));
  L.box(cx, 0.38, z + inward * 0.08, len, 0.05, 0.1, C(pal.glassFrame));
  L.box(cx, H + 0.03, z, len + 0.1, 0.08, 0.16, C(pal.glassFrame));
  if (room) { const o = room._skyB === room._skyBuild && room._sky ? room._sky : null; room._sky = { x0: o ? Math.min(o.x0, xa) : xa, x1: o ? Math.max(o.x1, xb) : xb, z: zs, inward }; room._skyB = room._skyBuild; }
}

/** 스탠딩 데스크: 상판·앞 모서리·T 다리 둘·발판 + 홀로그램 발광대(상판 뒤쪽, 옅게 — 켜지면 동적 빛이 덮음) */
function standDesk(L, G, x, z, pal, C, wide = 1.3, lead = false) {
  const d = lead ? 0.9 : 0.7, y = DESK_TOP;
  L.box(x, y - 0.03, z, wide, 0.06, d, C(pal.deskTop));
  L.box(x, y - 0.045, z - d / 2 + 0.02, wide, 0.03, 0.04, C(pal.deskEdge));
  for (const s of [-1, 1]) {
    const lx = x + s * (wide / 2 - 0.16);
    L.box(lx, (y - 0.06) / 2, z, 0.08, y - 0.06, 0.08, C(pal.deskLeg));
    L.box(lx, 0.02, z, 0.1, 0.04, d - 0.08, C(pal.deskLeg));
  }
  if (lead) L.box(x, y * 0.5, z + d / 2 - 0.05, wide - 0.4, 0.5, 0.04, C(pal.deskLeg)); // 앞 가림판
  G.box(x, y + 0.008, z + d / 2 - 0.12, wide * 0.55, 0.012, 0.05, C(_c.copy(pal.emitter).multiplyScalar(pal.isLight ? 0.55 : 0.32)));
  // 홀로그램 발광대 받침(작은 검은 받침)
  L.box(x, y + 0.004, z + d / 2 - 0.12, wide * 0.62, 0.01, 0.1, C(pal.deskLeg));
}

function plant(L, x, z, pal, C, tall = false) {
  L.box(x, 0.25, z, 0.5, 0.5, 0.5, C(pal.plantPot || pal.pot));
  L.box(x, 0.52, z, 0.44, 0.04, 0.44, C(pal.coffee || pal.pot)); // 흙
  L.box(x, 0.85, z, 0.66, 0.6, 0.66, C(pal.plant));
  L.box(x + 0.08, 1.25, z - 0.05, 0.46, 0.4, 0.46, C(pal.plant2 || pal.plant));
  if (tall) { L.box(x - 0.06, 1.6, z + 0.05, 0.34, 0.38, 0.34, C(pal.plant)); L.box(x, 1.9, z, 0.2, 0.24, 0.2, C(pal.plant2 || pal.plant)); }
}

function bookshelf(L, x, z0, z1, pal, C, levels = 3) {
  const len = z1 - z0, zc = (z0 + z1) / 2, H = 2.0;
  L.box(x - 0.42, H / 2, zc, 0.08, H, len, C(pal.woodDark));
  for (const zz of [z0, z1]) L.box(x - 0.15, H / 2, zz, 0.6, H, 0.08, C(pal.wood));
  for (let i = 0; i <= levels; i++) L.box(x - 0.15, 0.04 + i * (H - 0.08) / levels, zc, 0.6, 0.06, len, C(pal.wood));
  let seed = Math.abs(Math.round(x * 13 + z0 * 7));
  for (let lv = 0; lv < levels; lv++) {
    const y0 = 0.07 + lv * (H - 0.08) / levels;
    let z = z0 + 0.1;
    while (z < z1 - 0.25) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const w = 0.1 + (seed % 7) * 0.02, h = 0.38 + ((seed >> 3) % 5) * 0.04;
      if (((seed >> 6) % 9) === 0) { z += w + 0.08; continue; }
      L.box(x - 0.15, y0 + h / 2, z + w / 2, 0.42, h, w, C(pal.books[(seed >> 4) % pal.books.length]));
      z += w + 0.015;
    }
  }
}

function cabinet(L, x, zc, len, pal, C) {
  L.box(x - 0.05, 0.65, zc, 0.7, 1.3, len, C(pal.metal));
  L.box(x - 0.05, 1.32, zc, 0.74, 0.05, len + 0.04, C(pal.metalDark));
}

function toolbox(L, x, z, pal, C) {
  L.box(x, 0.3, z, 1.2, 0.6, 0.6, C(pal.woodDark));
  L.box(x, 0.78, z, 0.9, 0.36, 0.45, C(pal.toolbox));
  L.box(x, 0.98, z, 0.3, 0.05, 0.06, C(pal.metalDark)); // 손잡이
}

function buildOfficeFurniture(room, pal, b, C, wwall = 'back') {
  const L = b.lit, G = b.glow;
  const o = room.origin, zb = o.z - 9, ext = room.ext;
  const F = OFFICE_FX;
  // 팀장 책상 + 직원 책상(빈 자리도 그림) — 스탠딩 데스크
  if (room.leadDesk) {
    standDesk(L, G, room.leadDesk.x, room.leadDesk.z, pal, C, 2.0, true); // 외부 작업 구역은 팀장 책상 없음
    // 책상 위 스탠드 조명·작은 화분
    const lx = room.leadDesk.x + 0.75, lz = room.leadDesk.z - 0.15;
    L.box(lx, DESK_TOP + 0.2, lz, 0.04, 0.4, 0.04, C(pal.metalDark));
    L.box(lx - 0.08, DESK_TOP + 0.42, lz, 0.22, 0.08, 0.16, C(pal.lampShade));
    L.box(room.leadDesk.x - 0.8, DESK_TOP + 0.08, lz, 0.14, 0.16, 0.14, C(pal.plantPot));
    L.box(room.leadDesk.x - 0.8, DESK_TOP + 0.24, lz, 0.2, 0.18, 0.2, C(pal.plant));
  }
  for (const d of room.desks) standDesk(L, G, d.x, d.z, pal, C, d.aux ? 1.1 : 1.3);
  // 배치 장치 작업석(바닥 표시)·대기석(벤치)
  for (const t of room.stools || []) {
    if (t.kind === 'wait') { L.box(t.x, 0.42, t.z, 0.62, 0.08, 0.5, C(pal.wood)); L.box(t.x, 0.2, t.z, 0.08, 0.4, 0.08, C(pal.metalDark)); }
    else L.box(t.x, 0.012, t.z, 0.7, 0.02, 0.7, C(pal.mat));
  }
  // 탕비실 카운터(왼쪽 벽 뒤쪽): 카운터·상판·커피 머신·컵·벽 찬장
  const pz = o.z + F.pantry.z, plen = F.pantry.len, px = o.x + F.pantry.x;
  L.box(px, 0.46, pz, 0.7, 0.92, plen, C(pal.counter));
  L.box(px, 0.94, pz, 0.76, 0.05, plen + 0.06, C(pal.wood));
  L.box(px - 0.05, 1.22, pz - 0.55, 0.42, 0.52, 0.4, C(pal.machine));
  L.box(px + 0.12, 1.08, pz - 0.55, 0.1, 0.06, 0.18, C(pal.metalDark));
  for (const [dz, i] of [[0.2, 0], [0.45, 1], [0.7, 2]]) L.box(px + 0.05, 1.03, pz + dz, 0.11, 0.13, 0.11, C(i === 1 ? pal.bean : pal.mug));
  L.box(o.x - 11.8, 1.9, pz, 0.36, 0.5, plen, C(pal.counter));
  // 책장(장식, 줄임) · 문서고 서랍장 · 금고 · 아티팩트 보드
  bookshelf(L, o.x + F.shelf.x, o.z + F.shelf.z0, o.z + F.shelf.z1, pal, C);
  cabinet(L, o.x - 11.5, o.z + F.archive.z, 1.4, pal, C);
  vault(L, o.x + F.vault.x, o.z + F.vault.z, pal, C);
  L.box(o.x - 11.92, 1.35, o.z + 5, 0.06, 1.2, 1.9, C(pal.boardFrame));
  L.box(o.x - 11.87, 1.35, o.z + 5, 0.05, 1.08, 1.78, C(pal.board));
  const cards = [[-0.5, 1.6], [0.3, 1.55], [-0.2, 1.15], [0.55, 1.1]];
  cards.forEach(([dz, y], i) => L.box(o.x - 11.83, y, o.z + 5 + dz, 0.03, 0.26, 0.34, C(pal.books[i % pal.books.length])));
  // 품질검사 신호등 보드(왼쪽 벽에 걸림): 틀 + 등 셋 자리 + 막대 칸(동적)
  const qz = o.z + F.qc.z;
  L.box(o.x - 11.92, 1.5, qz, 0.06, 0.95, F.qc.len, C(pal.boardFrame));
  L.box(o.x - 11.88, 1.5, qz, 0.05, 0.85, F.qc.len - 0.1, C(pal.screenOff));
  for (let i = 0; i < 3; i++) L.box(o.x - 11.84, 1.72, qz - 0.6 + i * 0.3, 0.04, 0.22, 0.22, C(pal.lampOff));
  // 도구 상자(skill) 뒤 벽 x -9
  toolbox(L, o.x - 9, zb + 0.55, pal, C);
  // 의뢰인 화상 스크린(뒤 벽, 사용자 ↔ 메인): 틀(빛 화면은 동적)
  const cs = F.client;
  const csZ = wwall === 'front' ? room.bounds.maxZ - 0.28 : o.z + cs.z;
  L.box(o.x + cs.x, cs.y, csZ, cs.w + 0.16, cs.h + 0.16, 0.08, C(pal.metalDark));
  L.box(o.x + cs.x, cs.y - cs.h / 2 - 0.3, csZ + 0.12 * (wwall === 'front' ? -1 : 1), 1.1, 0.06, 0.3, C(pal.metal)); // 아래 선반(카메라)
  L.box(o.x + cs.x, cs.y + cs.h / 2 + 0.12, csZ + 0.06 * (wwall === 'front' ? -1 : 1), 0.18, 0.08, 0.08, C(pal.metal));
  // 모니터 벽 틀(monitor) 오른쪽 x 11.5, z -6～-1 — 낮은 열린 틀(화면은 monitor 노드가 있을 때만)
  L.box(o.x + 11.75, 0.18, o.z - 3.0, 0.5, 0.36, 6.2, C(pal.metalDark));
  for (const zz of [-6.15, 0.15]) L.box(o.x + 11.75, 1.0, o.z + zz, 0.1, 1.9, 0.1, C(pal.metal));
  L.box(o.x + 11.75, 1.93, o.z - 3.0, 0.1, 0.06, 6.4, C(pal.metal));
  L.box(o.x + 11.75, 1.13, o.z - 3.0, 0.06, 0.05, 6.3, C(pal.metal));
  // 우편 분류 컨베이어(batch, 오른쪽 벽): 받침·벨트·롤러·분류함 셋
  const cx = o.x + F.conveyor.x, cz0 = o.z + F.conveyor.z0, cz1 = o.z + F.conveyor.z1, cl = cz1 - cz0, cm = (cz0 + cz1) / 2;
  L.box(cx, 0.36, cm, 0.62, 0.72, cl, C(pal.metalDark));
  L.box(cx, 0.75, cm, 0.66, 0.05, cl + 0.04, C(pal.belt));
  for (const s of [-1, 1]) L.box(cx + s * 0.34, 0.82, cm, 0.04, 0.12, cl, C(pal.metal));
  for (let i = 0; i < 3; i++) L.box(cx + 0.55, 0.45, cz0 + 0.6 + i * 1.0, 0.36, 0.5, 0.8, C(pal.bin));
  // 원격 단말 부스(remote): 외부 단말 + 옆판 둘·지붕·접시 안테나
  const bx = o.x + F.booth.x, bz = o.z + F.booth.z;
  L.box(bx, 0.65, bz, 0.5, 1.3, 0.5, C(pal.kiosk));
  L.box(bx - 0.05, 1.5, bz, 0.12, 0.5, 0.56, C(pal.metalDark));
  for (const s of [-1, 1]) L.box(o.x + 11.5, 1.05, bz + s * 0.8, 0.95, 2.1, 0.06, C(pal.booth));
  L.box(o.x + 11.5, 2.12, bz, 0.95, 0.06, 1.66, C(pal.booth));
  L.box(o.x + 11.5, 2.3, bz, 0.06, 0.3, 0.06, C(pal.metal));
  L.box(o.x + 11.4, 2.5, bz, 0.08, 0.3, 0.4, C(pal.antenna), 0.4);
  // 발송대(github): 받침·H 표시·모서리 등
  const dx = o.x + F.dispatch.x, dz = o.z + F.dispatch.z + ext;
  L.box(dx, 0.05, dz, 1.5, 0.1, 1.5, C(pal.pad));
  L.box(dx - 0.25, 0.105, dz, 0.08, 0.01, 0.6, C(pal.paper)); L.box(dx + 0.25, 0.105, dz, 0.08, 0.01, 0.6, C(pal.paper)); L.box(dx, 0.105, dz, 0.5, 0.01, 0.08, C(pal.paper));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) G.box(dx + sx * 0.66, 0.11, dz + sz * 0.66, 0.08, 0.02, 0.08, C(_c.copy(pal.emitter).multiplyScalar(0.6)));
  // 포털(agent) 앞 왼쪽: 받침 + 상자 고리
  const ppx = room.portal.x, ppz = room.portal.z;
  L.box(ppx, 0.08, ppz, 2.4, 0.16, 0.9, C(pal.metalDark));
  const pY = portalYaw(b), pC = Math.cos(pY), pS = Math.sin(pY);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2, lx = Math.cos(a) * 0.95;
    L.box(ppx + lx * pC, 1.25 + Math.sin(a) * 0.95, ppz - lx * pS, 0.3, 0.3, 0.26, C(pal.portal), pY, null);
  }
  // 알림 벨(notify)
  L.box(room.bell.x, 0.03, room.bell.z, 0.5, 0.06, 0.5, C(pal.metalDark));
  L.box(room.bell.x, 0.6, room.bell.z, 0.07, 1.2, 0.07, C(pal.metal));
  L.box(room.bell.x, 1.22, room.bell.z, 0.5, 0.05, 0.07, C(pal.metal));
  // 화분(큰 것 둘 + 탕비실 옆)
  plant(L, o.x + 11.1, o.z - 8.2, pal, C, true);
  plant(L, o.x - 11.1, o.z + 8.3 + ext, pal, C, true);
  plant(L, o.x - 7.4, o.z - 8.4, pal, C);
}

/** 금고: 몸통 + 방 안쪽(+x)을 보는 둥근 문(십자로 쌓은 판) — 바퀴는 동적 */
function vault(L, x, z, pal, C) {
  L.box(x - 0.05, 0.72, z, 0.72, 1.44, 1.4, C(pal.vault));
  L.box(x + 0.32, 0.75, z, 0.04, 0.95, 0.62, C(pal.vaultDoor));
  L.box(x + 0.32, 0.75, z, 0.04, 0.62, 0.95, C(pal.vaultDoor));
  L.box(x + 0.32, 0.75, z, 0.045, 0.82, 0.82, C(pal.vaultDoor));
}

function buildMeetingFurniture(room, pal, b, C) {
  const L = b.lit;
  const o = room.origin, zb = o.z - 6;
  // 화이트보드 틀(상태색은 동적)
  L.box(room.board.x, 1.35, zb + 0.1, 3.4, 1.7, 0.08, C(pal.boardFrame));
  L.box(room.board.x, 0.5, zb + 0.22, 3.0, 0.05, 0.2, C(pal.metal));
  // 스탠딩 회의 탁자(의자 없음)
  for (const t of room.tables) {
    L.box(t.x, DESK_TOP - 0.03, t.z, 11.0, 0.06, 1.2, C(pal.deskTop));
    for (const s of [-1, 0, 1]) L.box(t.x + s * 4.8, (DESK_TOP - 0.06) / 2, t.z, 0.12, DESK_TOP - 0.06, 0.12, C(pal.deskLeg));
    pal.emitter && b.glow.box(t.x, DESK_TOP + 0.008, t.z, 9, 0.01, 0.04, C(_c.copy(pal.emitter).multiplyScalar(0.3)));
  }
  bookshelf(L, o.x - 7.5, zb + 1.2, zb + 3.2, pal, C, 3);
  cabinet(L, o.x - 7.5, o.z + 1.7, 1.4, pal, C);
  toolbox(L, o.x - 5, zb + 0.55, pal, C);
  plant(L, o.x + 7.2, zb + 0.6, pal, C, true);
}

/** 바닥 통로 띠 */
export function buildCorridor(cor, pal, b) {
  const p = cor.path;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], c = p[i];
    const w = 1.6;
    const sx = Math.abs(c.x - a.x) + w, sz = Math.abs(c.z - a.z) + w;
    b.lit.box((a.x + c.x) / 2, -0.06, (a.z + c.z) / 2, sx, 0.08, sz, pal.corridor);
  }
}

// ---------------- 동적(매 프레임) ----------------

/**
 * 시설 애니메이션. act = { shelf, files, board, toolbox, antenna, terminal, kiosk, portal, bell, screens } (0..1),
 * t = 벽시계 초, tokens = 테마 토큰(THREE.Color)
 */
export function drawFacilities(room0, act, pal, tokens, t, b, dim = false) {
  const room = roomFrame(room0, b);
  try { drawFacilities_(room, act, pal, tokens, t, b, dim); } finally { endXf(b); }
}
function drawFacilities_(room, act, pal, tokens, t, b, dim) {
  const L = b.lit, G = b.glow;
  const o = room.origin;
  if (room.type === 'office') {
    // 문서고 서랍(검색·DB 읽기 중이면 하나가 앞으로)
    const ix = room._ixAct || null;
    const open = act.files > 0 || (ix && ix.db) ? 0.35 + 0.08 * Math.sin(t * 6) : 0;
    for (let d = 0; d < 3; d++) {
      const slide = d === 1 ? open : 0;
      L.box(o.x - 11.18 + slide, 0.3 + d * 0.38, o.z + 0.75, 0.06, 0.32, 1.25, pal.metalDark);
      L.box(o.x - 11.12 + slide, 0.36 + d * 0.38, o.z + 0.75, 0.05, 0.04, 0.3, pal.antenna);
      if (slide) L.box(o.x - 11.2 + slide / 2, 0.42 + d * 0.38, o.z + 0.75, slide, 0.22, 1.1, pal.metal);
    }
    // 금고 바퀴(쓰기면 돈다)
    const vx = o.x + OFFICE_FX.vault.x + 0.36, vz = o.z + OFFICE_FX.vault.z;
    const spin = ix && ix.dbw ? t * 3.2 : 0.4;
    for (let i = 0; i < 2; i++) partBox(L, null, vx, 0.75, vz, spin + i * Math.PI / 2, 0, 0, 0, 0, 0, 0.03, 0.56, 0.06, pal.metal);
    L.box(vx + 0.01, 0.75, vz, 0.04, 0.12, 0.12, pal.metalDark);
    // 도구 상자 뚜껑 + 금빛
    const lid = act.toolbox > 0 ? -1.1 - 0.1 * Math.sin(t * 4) : 0;
    const tbz = o.z - 9 + 0.55;
    hinged(L, o.x - 9, 0.96, tbz - 0.22, lid, 0.92, 0.06, 0.47, pal.toolboxLid);
    if (act.toolbox > 0) {
      G.box(o.x - 9, 1.02, tbz, 0.7, 0.06, 0.3, tokens.skill);
      for (let i = 0; i < 5; i++) {
        const k = ((t * 0.9 + i / 5) % 1);
        G.box(o.x - 9 + Math.sin(i * 2.1 + t) * 0.3, 1.05 + k * 1.2, tbz + Math.cos(i * 1.7) * 0.15, 0.08 * (1 - k) + 0.02, 0.08 * (1 - k) + 0.02, 0.08 * (1 - k) + 0.02, tokens.skill);
      }
    }
    // 커피 머신 표시등(쉬는 사람이 있으면 김)
    const pz = o.z + OFFICE_FX.pantry.z - 0.55, ppx = o.x + OFFICE_FX.pantry.x;
    G.box(ppx + 0.17, 1.38, pz + 0.12, 0.03, 0.05, 0.05, room._brew ? tokens.ok : pal.ledIdle);
    if (room._brew) for (let i = 0; i < 3; i++) { const k = (t * 0.7 + i / 3) % 1; G.box(ppx + 0.2 + Math.sin(t * 2 + i) * 0.04, 1.1 + k * 0.5, pz + 0.12, 0.04 * (1 - k) + 0.01, 0.04 * (1 - k) + 0.01, 0.04 * (1 - k) + 0.01, pal.fogGlass); }
    // 외부 단말(부스): 안테나 깜빡, 화면
    G.box(o.x + 11.33, 1.5, o.z + 5, 0.03, 0.42, 0.48, act.kiosk > 0 || (ix && ix.remote) ? tokens['k-workflow'] : pal.screenDim);
    G.box(o.x + 11.4, 2.7, o.z + 5, 0.08, 0.08, 0.08, act.kiosk > 0 || (ix && ix.remote) ? (Math.sin(t * 9) > 0 ? tokens.skill : pal.ledOff) : pal.ledIdle);
    // 포털 소용돌이
    const pw = 0.25 + act.portal * 0.75;
    const px = room.portal.x, ppz = room.portal.z;
    const pY = portalYaw(b), pC = Math.cos(pY), pS = Math.sin(pY);
    G.box(px, 1.25, ppz, 1.3 * pw + 0.2, 1.3 * pw + 0.2, 0.05, dim ? pal.screenDim : pal.portalCore, pY);
    const nOrb = act.portal > 0 ? 8 : 4;
    for (let i = 0; i < nOrb; i++) {
      const a = t * (1 + act.portal * 3) + (i / nOrb) * Math.PI * 2;
      const r = 0.25 + 0.45 * ((i % 2) ? 1 : 0.6);
      const lx = Math.cos(a) * r;
      G.box(px + lx * pC + 0.05 * pS, 1.25 + Math.sin(a) * r, ppz - lx * pS + 0.05 * pC, 0.12, 0.12, 0.12, pal.portal, pY);
    }
    // 알림 벨(흔들림)
    const sw = act.bell > 0 ? Math.sin(t * 16) * 0.5 : 0;
    hingedZ(L, room.bell.x, 1.2, room.bell.z, sw, 0.3, 0.32, 0.3, pal.bell);
    // 아티팩트 보드: 새 카드 붙이기
    if (act.board > 0) {
      const k = (t * 0.6) % 1;
      G.box(o.x - 11.8, 1.2 + 0.2 * Math.sin(k * Math.PI), o.z + 5.45, 0.03, 0.26, 0.34, tokens['k-subagent']);
    }
  } else {
    const zb = o.z - 6;
    const lid = act.toolbox > 0 ? -1.1 : 0;
    hinged(L, o.x - 5, 0.96, zb + 0.55 - 0.22, lid, 0.92, 0.06, 0.47, pal.toolboxLid);
    if (act.toolbox > 0) G.box(o.x - 5, 1.02, zb + 0.55, 0.7, 0.06, 0.3, tokens.skill);
    const open = act.files > 0 ? 0.35 : 0;
    for (let d = 0; d < 3; d++) L.box(o.x - 7.18 + (d === 1 ? open : 0), 0.3 + d * 0.38, o.z + 1.7, 0.06, 0.32, 1.25, pal.metalDark);
  }
}

/** x축 경첩(뒤쪽 모서리 기준)으로 열리는 판: 도구 상자 뚜껑 */
function hinged(L, x, y, zHinge, ang, sx, sy, sz, c) {
  _e.set(ang, 0, 0, 'YXZ'); _q.setFromEuler(_e);
  _v.set(0, sy / 2, sz / 2).applyQuaternion(_q);
  _p.set(x + _v.x, y + _v.y, zHinge + _v.z); _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s); L.pushMatrix(_m, c, null);
}
/** z축 기준으로 매달려 흔들리는 상자: 벨 */
function hingedZ(L, x, y, z, ang, sx, sy, sz, c) {
  _e.set(0, 0, ang, 'YXZ'); _q.setFromEuler(_e);
  _v.set(0, -sy / 2 - 0.03, 0).applyQuaternion(_q);
  _p.set(x + _v.x, y + _v.y, z + _v.z); _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s); L.pushMatrix(_m, c, null);
}

/** 바닥(또는 공중) 고리: 작은 상자 n 개 */
export function ring(G, x, y, z, r, n, c, size = 0.12) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    G.box(x + Math.cos(a) * r, y, z + Math.sin(a) * r, size, size * 0.5, size, c, -a);
  }
}

/**
 * 스탠딩 데스크 발광대: state = 'off'|'dim'|'on'|'flash', k = 모니터 열림(0..1). 켜지면 상판 뒤쪽 빛줄이 밝아지고 모니터 아래로 빛이 오른다
 * (모니터 자체는 vx-holo.js)
 */
export function drawDeskEmitter(G, d, lead, state, col, pal, k = 0) {
  if (state === 'off') return;
  const wide = lead ? 2.0 : d.aux ? 1.1 : 1.3, dd = lead ? 0.9 : 0.7;
  const c = state === 'flash' ? _c.copy(col).lerp(_c2.set(0xffffff), 0.5) : state === 'dim' ? _c.copy(pal.emitter).multiplyScalar(pal.isLight ? 0.7 : 0.45) : _c.copy(col);
  G.box(d.x, DESK_TOP + 0.012, d.z + dd / 2 - 0.12, wide * 0.55, 0.016, 0.05, c);
  if (k > 0.02) { // 빛기둥(얇은 판 두 장): 발광대 → 모니터 아래 끝
    const h = 0.16 * k;
    G.box(d.x, DESK_TOP + 0.02 + h / 2, d.z + dd / 2 - 0.12, wide * 0.5 * k, h, 0.012, _c.multiplyScalar(0.55));
  }
}

/**
 * 기계: rack(bash-bg) / screen(monitor) / board(workflow 화이트보드) / batch(기동기 복합기). st = {status, flash(0..1), t, focus, hover}
 * owner 를 붙여 클릭 판정에 쓴다.
 */
export function drawMachine(m, st, pal, tokens, b, kindColor) {
  const L = b.lit, G = b.glow;
  const { x, y, z } = m;
  const t = st.t;
  const status = st.status;
  const ended = status === 'done' || status === 'stopped'; // 중지됨도 꺼진 기계로
  const err = status === 'error';
  const k = st.appear ?? 1;
  if (m.type === 'rack') {
    // 서버랙: 몸통·유리문 틀·위 종류 색 띠·LED 줄
    L.box(x, 1.0 * k, z, 0.8, 2.0 * k, 0.8, pal.metalDark, 0, st.id);
    L.box(x, 2.02 * k, z, 0.84, 0.05, 0.84, kindColor, 0, st.id);
    for (const s of [-1, 1]) L.box(x + s * 0.38, 1.0 * k, z + 0.41, 0.04, 1.9 * k, 0.03, pal.metal, 0, st.id);
    for (let i = 0; i < 6; i++) {
      const yy = (0.3 + i * 0.3) * k;
      L.box(x, yy, z + 0.4, 0.68, 0.2, 0.02, pal.metal, 0, st.id);
      let c;
      if (err) c = Math.floor(t * 2.5) % 2 ? tokens.error : pal.ledOff;
      else if (ended) c = pal.ledOff;
      else if (st.flash > 0) c = _c.copy(pal.led).lerp(_c2.set(0xffffff), st.flash * 0.7);
      else if (status === 'idle') c = pal.ledIdle;
      else c = ((Math.floor(t * 7 + i * 1.7 + st.seed) % 3) ? pal.led : pal.ledIdle);
      G.box(x - 0.22 + (i % 2) * 0.12, yy, z + 0.415, 0.08, 0.06, 0.02, c);
      G.box(x + 0.2, yy, z + 0.415, 0.14, 0.04, 0.02, ended ? pal.ledOff : (err ? tokens.error : pal.ledIdle));
    }
  } else if (m.type === 'screen') {
    const sc = ended ? pal.screenOff : err ? _c.copy(tokens.error).multiplyScalar(0.5) : _c.copy(pal.screenDim).lerp(kindColor, 0.25 + 0.5 * st.flash);
    G.box(x, y, z, 0.09, 0.56 * k, 1.4, sc, 0, st.id);
    L.box(x, y, z, 0.07, 0.6 * k, 1.44, pal.metalDark, 0, st.id); // 클릭 판정용(빛 상자 안쪽)
    if (!ended) for (let i = 0; i < 3; i++) {
      const u = ((t * 0.25 + i * 0.27 + st.seed) % 1);
      const w = 0.2 + (i % 3) * 0.15;
      const zz = z - 0.7 + w / 2 + u * (1.4 - w);
      G.box(x, y - 0.17 + i * 0.17, zz, 0.11, 0.07, w, err ? tokens.error : kindColor);
    }
  } else if (m.type === 'batch') {
    // 배치 장치(기동기): 복합기 모양 — 몸통·덮개(종류색)·앞면 진행 막대·진행 표시등·최근 회차 상태 띠·출력 받침
    // (위에 홀로그램 대시보드 = vx-holo.js)
    const run = (st.running || 0) > 0 && !ended && !err;
    L.box(x, 0.72 * k, z, 1.6, 1.44 * k, 1.0, pal.metal, 0, st.id);
    L.box(x, 1.47 * k, z, 1.66, 0.08, 1.06, kindColor, 0, st.id);
    L.box(x - 0.32, 1.54 * k, z - 0.14, 0.8, 0.06, 0.56, pal.metalDark, 0, st.id); // 원고대
    L.box(x - 0.14, 1.14, z + 0.505, 1.0, 0.28, 0.02, pal.metalDark, 0, st.id);    // 표시창 틀
    const pr = run ? (st.progress == null ? 1 : st.progress) : 0;
    if (pr > 0) G.box(x - 0.14 - 0.46 + 0.46 * pr, 1.14, z + 0.52, 0.92 * pr, 0.16, 0.02, tokens.skill);
    G.box(x + 0.57, 1.14, z + 0.52, 0.13, 0.13, 0.02, err ? tokens.error : run ? (Math.sin(t * 6 + st.seed) > 0 ? tokens.skill : pal.ledIdle) : ended ? pal.ledOff : tokens.ok);
    const band = st.band || EMPTY_BAND, nb = band.length;
    for (let i = 0; i < 5; i++) {
      const bb = i - (5 - nb) >= 0 ? band[i - (5 - nb)] : 0;
      const c = bb === 1 ? tokens.skill : bb === 2 ? tokens.ok : bb === 3 ? tokens.stopped : bb === 4 ? tokens.error : pal.ledOff;
      G.box(x - 0.56 + i * 0.28, 0.76, z + 0.515, 0.2, 0.14, 0.02, c);
    }
    L.box(x, 0.34, z + 0.57, 1.05, 0.05, 0.28, pal.metalDark, 0, st.id); // 출력 받침
    const slide = run ? ((t * 0.35 + st.seed) % 1) : 0;
    L.box(x, 0.39, z + 0.55 + slide * 0.24, 0.6, 0.02, 0.36, pal.paper);
    if (st.flash > 0) G.box(x, 1.56, z, 1.4 * st.flash, 0.04, 0.9, tokens.ok);
    // 홀로그램 대시보드 발광대(덮개 위)
    G.box(x + 0.4, 1.53 * k, z + 0.2, 0.6, 0.02, 0.06, run ? pal.emitter : _c.copy(pal.emitter).multiplyScalar(0.35));
  } else if (m.type === 'board') {
    const c = err ? tokens.error : ended ? pal.ledOff : status === 'idle' ? _c.copy(kindColor).multiplyScalar(0.6) : kindColor;
    L.box(x, 1.35, z + 0.15, 3.2, 1.5, 0.05, pal.board, 0, st.id);
    G.box(x, 2.0, z + 0.19, 3.0, 0.14, 0.03, c);
    const n = Math.max(1, Math.min(8, st.members || 1));
    for (let i = 0; i < n; i++) {
      const done = i < (st.doneMembers || 0);
      G.box(x - 1.3 + (i + 0.5) * (2.6 / n), 1.35, z + 0.19, 2.6 / n - 0.08, 0.3, 0.03, done ? tokens.ok : (ended ? pal.ledOff : _c.copy(kindColor).multiplyScalar(0.55)));
    }
    if (st.flash > 0) G.box(x, 0.85, z + 0.19, 2.8 * st.flash, 0.06, 0.03, tokens.ok);
  }
}

// ---------------- 공용 라운지(같은 프로젝트 live 메인 여럿) ----------------
/** 라운지: 깔개·소파 둘(쿠션)·낮은 탁자·큰 화분·스탠드 조명·가운데 뒤 서류 캐비닛(정적). 캐비닛 경고등·말풍선은 동적 */
export function buildLounge(lg, pal, b, { dim = false } = {}) {
  const L = b.lit, G = b.glow;
  const C = (c) => (dim ? dimmed(c, pal.dimFactor) : c);
  const cx = (lg.minX + lg.maxX) / 2, cz = (lg.minZ + lg.maxZ) / 2, w = lg.maxX - lg.minX, d = lg.maxZ - lg.minZ;
  L.box(cx, -0.04, cz, w, 0.08, d, C(pal.floor));
  L.box(cx, -0.01, cz + 1.2, w - 3.0, 0.03, d - 4.0, C(pal.loungeRug));
  // 소파(양옆, 가운데를 바라봄): 받침·등받이·팔걸이·쿠션 셋
  for (const s of [-1, 1]) {
    const x = cx + s * (w / 2 - 1.5);
    L.box(x, 0.24, cz + 1.4, 1.0, 0.48, 3.2, C(pal.sofa));
    L.box(x + s * 0.4, 0.7, cz + 1.4, 0.22, 0.56, 3.2, C(pal.sofa));
    for (const e of [-1, 1]) L.box(x, 0.5, cz + 1.4 + e * 1.55, 1.0, 0.4, 0.16, C(pal.sofa));
    for (let i = 0; i < 3; i++) L.box(x - s * 0.04, 0.53, cz + 0.45 + i * 0.95, 0.82, 0.12, 0.88, C(_c.copy(pal.sofa).lerp(pal.paper, 0.18)));
  }
  // 낮은 탁자 + 컵 둘
  L.box(cx, 0.4, cz + 2.0, 2.4, 0.07, 1.1, C(pal.wood));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.box(cx + sx * 1.05, 0.19, cz + 2.0 + sz * 0.42, 0.08, 0.38, 0.08, C(pal.woodDark));
  L.box(cx - 0.4, 0.5, cz + 2.1, 0.12, 0.13, 0.12, C(pal.mug)); L.box(cx + 0.35, 0.5, cz + 1.9, 0.12, 0.13, 0.12, C(pal.mug));
  // 큰 화분(네 모서리) · 스탠드 조명 둘
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) plant(L, cx + sx * (w / 2 - 0.55), cz + sz * (d / 2 - 0.55), pal, C, true);
  for (const s of [-1, 1]) {
    const lx = cx + s * (w / 2 - 1.5), lz = cz + d / 2 - 0.6;
    L.box(lx, 0.8, lz, 0.05, 1.6, 0.05, C(pal.metalDark));
    G.box(lx, 1.7, lz, 0.4, 0.26, 0.4, C(pal.lampShade));
  }
  // 서류 캐비닛(서랍 3단 × 3열)
  const cab = lg.cabinet;
  L.box(cab.x, 0.8, cab.z, 2.4, 1.6, 0.8, C(pal.cabinet), 0, lg.id);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const x = cab.x - 0.78 + c * 0.78, y = 0.32 + r * 0.5;
    L.box(x, y, cab.z + 0.41, 0.7, 0.42, 0.03, C(pal.cabinetDrawer));
    L.box(x, y + 0.08, cab.z + 0.44, 0.22, 0.04, 0.04, C(pal.metalDark));
  }
  L.box(cab.x, 1.63, cab.z, 2.46, 0.06, 0.86, C(pal.metalDark));
}

/** 캐비닛 경고등(같은 파일 충돌 중이면 주황 깜빡임, 강 = 빠르게) — 동적 */
export function drawCabinetWarn(lg, pal, warn, t, strong, b) {
  const G = b.glow, L = b.lit, cab = lg.cabinet;
  L.box(cab.x, 1.72, cab.z, 0.34, 0.12, 0.34, pal.metalDark);
  const on = Math.floor(t * (strong ? 4 : 2)) % 2 === 0;
  G.box(cab.x, 1.92, cab.z, 0.28, 0.28, 0.28, on ? warn : _c.copy(warn).multiplyScalar(0.35));
  if (on) ring(G, cab.x, 0.05, cab.z + 1.2, 1.6 + 0.4 * Math.sin(t * 6), 14, warn, 0.1);
}

/** 사무실 컨텍스트 사용률: 창(커튼월 하늘)이 뿌옇게, 팀장 책상 위 서류 더미 — 동적 */
export function drawCtxWear(room0, pct, pal, b) {
  if (!room0 || room0.type !== 'office' || !(pct >= 0)) return;
  const room = roomFrame(room0, b);
  try { ctxWear_(room, room0, pct, pal, b); } finally { endXf(b); }
}
function ctxWear_(room, room0, pct, pal, b) {
  const G = b.glow, L = b.lit;
  const fog = Math.max(0, Math.min(1, (pct - 35) / 55));
  const sky = room._sky || room0._sky;
  if (fog > 0 && sky) {
    const glass = _c.copy(pal.skyMid).lerp(pal.fogGlass, 0.15 + fog * 0.4); // 젖빛 유리(완전 흰색까지는 아님)
    const len = sky.x1 - sky.x0, h = 0.4 + 1.4 * fog;
    G.box((sky.x0 + sky.x1) / 2, 2.2 - h / 2, sky.z + sky.inward * 0.07, len, h, 0.02, glass);
  }
  const d = room.leadDesk;
  if (!d) return;
  const piles = Math.max(0, Math.min(5, Math.floor((pct - 35) / 12)));
  for (let i = 0; i < piles; i++) {
    const h = 0.08 + ((i * 37) % 5) * 0.04;
    const x = d.x + (i % 2 ? 0.62 : -0.62) + (i > 3 ? 0.1 : 0), z = d.z - 0.22 + Math.floor(i / 2) * 0.05;
    L.box(x, DESK_TOP + h / 2 + Math.floor(i / 2) * 0.12, z, 0.34, h, 0.26, pal.paper);
  }
}
