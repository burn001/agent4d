// 복셀 사무실 회전 — 순수 함수, three 를 import 하지 않는다(node 시험 대상).
//
// 사무실 묶음(computeOffice 결과)을 90° 단위로 돌린다(복셀 격자 정렬 유지). 방마다
//   room.xf    = { k, px, pz }  — k = 반시계(위에서 볼 때 +x → -z) 사분 회전 수, (px, pz) = 회전 중심(세계)
//   room.local = 돌리기 전 방(같은 평행 이동, 회전만 뺀 좌표) — 벽·가구·시설 그림과 방 안 길 찾기는 이 좌표로 하고
//                그린 결과·길만 xf 로 세계에 옮긴다.
// 회전 θ = k·π/2: x' = x cosθ + z sinθ, z' = −x sinθ + z cosθ, yaw(face)' = face + θ (yaw 0 = +z, atan2(dx, dz)).
const PI = Math.PI;

export const quarter = (k) => ((Math.round(k) % 4) + 4) % 4;
export const xfAngle = (xf) => (xf && xf.k ? quarter(xf.k) * PI / 2 : 0);

const CS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // [cos, sin] — 정확한 정수(부동소수 오차 없음)

/** 점 (x, z) 를 (px, pz) 둘레로 k 사분 회전 */
export function rotXZ(x, z, k, px = 0, pz = 0) {
  const [c, s] = CS[quarter(k)];
  const dx = x - px, dz = z - pz;
  return { x: px + dx * c + dz * s, z: pz - dx * s + dz * c };
}
/** 지역(회전 전) → 세계 */
export function toWorld(xf, x, z) { return xf && xf.k ? rotXZ(x, z, xf.k, xf.px, xf.pz) : { x, z }; }
/** 세계 → 지역(회전 전) */
export function toLocal(xf, x, z) { return xf && xf.k ? rotXZ(x, z, -xf.k, xf.px, xf.pz) : { x, z }; }

/** 회전한 경계 상자(축 정렬) */
export function rotBounds(b, k, px = 0, pz = 0) {
  const a = rotXZ(b.minX, b.minZ, k, px, pz), c = rotXZ(b.maxX, b.maxZ, k, px, pz);
  return { minX: Math.min(a.x, c.x), maxX: Math.max(a.x, c.x), minZ: Math.min(a.z, c.z), maxZ: Math.max(a.z, c.z) };
}

/** 자리처럼 x·z(+deskX·deskZ, face)를 가진 객체를 돌린 사본(나머지 필드 그대로) */
export function mapSeatLike(p, k, px, pz) {
  if (!p) return p;
  const q = { ...p };
  const a = rotXZ(p.x, p.z, k, px, pz); q.x = a.x; q.z = a.z;
  if (Number.isFinite(p.deskX) && Number.isFinite(p.deskZ)) { const d = rotXZ(p.deskX, p.deskZ, k, px, pz); q.deskX = d.x; q.deskZ = d.z; }
  if (p.face != null) q.face = p.face + quarter(k) * PI / 2;
  return q;
}

// 제자리에서 점·방향 돌리기
function rp(p, k, px, pz, face = false) {
  if (!p) return;
  const a = rotXZ(p.x, p.z, k, px, pz); p.x = a.x; p.z = a.z;
  if (face && p.face != null) p.face += quarter(k) * PI / 2;
}

/** 방 하나를 제자리에서 돌린다(room.local 이 없으면 돌리기 전 사본을 남김) */
export function rotateRoom(r, k, px = 0, pz = 0) {
  k = quarter(k);
  if (!k) return r;
  if (!r.local) { const { local, xf, _act, ...rest } = r; r.local = structuredClone(rest); }
  rp(r.origin, k, px, pz);
  r.bounds = rotBounds(r.bounds, k, px, pz);
  rp(r.leadDesk, k, px, pz, true);
  for (const d of r.desks || []) rp(d, k, px, pz, true);
  for (const t of r.tables || []) rp(t, k, px, pz);
  for (const t of r.stools || []) rp(t, k, px, pz);
  for (const t of r.batches || []) rp(t, k, px, pz);
  for (const key of Object.keys(r.stations || {})) for (const s of r.stations[key]) rp(s, k, px, pz, true);
  for (const key of Object.keys(r.queues || {})) for (const s of r.queues[key]) rp(s, k, px, pz, true);
  if (r.door) { rp(r.door, k, px, pz); rp(r.door.out, k, px, pz); }
  if (r.portal) { rp(r.portal, k, px, pz); rp(r.portal.spawn, k, px, pz); }
  rp(r.bell, k, px, pz);
  rp(r.board, k, px, pz);
  for (const m of r.racks || []) rp(m, k, px, pz);
  for (const m of r.screens || []) rp(m, k, px, pz);
  if (k % 2 && r.size) r.size = { w: r.size.d, d: r.size.w };
  const prev = r.xf ? quarter(r.xf.k) : 0;
  r.xf = { k: quarter(prev + k), px, pz };
  return r;
}

/**
 * 사무실 묶음(computeOffice 결과) 전체를 (px, pz) 둘레로 k 사분 회전 — 방·자리·기계·통로·경계 상자.
 * 자리의 지역 좌표(deskLX·lx·slot)는 그대로라 prev 로 다시 써도 된다.
 */
export function rotateOffice(lay, k, px = 0, pz = 0) {
  k = quarter(k);
  if (!k || !lay) return lay;
  for (const r of lay.rooms) rotateRoom(r, k, px, pz);
  for (const s of lay.seat.values()) {
    const a = rotXZ(s.x, s.z, k, px, pz); s.x = a.x; s.z = a.z;
    const d = rotXZ(s.deskX, s.deskZ, k, px, pz); s.deskX = d.x; s.deskZ = d.z;
    if (s.face != null) s.face += k * PI / 2;
  }
  for (const m of lay.machine.values()) { rp(m, k, px, pz); if (m.face != null) m.face += k * PI / 2; }
  for (const c of lay.corridors) for (const p of c.path) rp(p, k, px, pz);
  lay.bounds = rotBounds(lay.bounds, k, px, pz);
  lay.rot = quarter((lay.rot || 0) + k);
  return lay;
}

/** 방의 네 벽(지역: back = −z, left = −x, front = +z, right = +x)이 세계에서 바라보는 바깥 방향 */
export function wallWorldDir(xf, side) {
  const v = side === 'back' ? [0, -1] : side === 'front' ? [0, 1] : side === 'left' ? [-1, 0] : [1, 0];
  const a = rotXZ(v[0], v[1], xf ? xf.k : 0);
  return { x: Math.round(a.x), z: Math.round(a.z) };
}
/**
 * 높은 벽인가: 기본 카메라(+x·+z 쪽 위에서 비스듬히)에서 먼 쪽(바깥 방향이 −x 또는 −z)이면 높게, 가까운 쪽은 낮게(안이 보이게).
 * 회전하지 않은 방은 예전과 같다(뒤·왼쪽 높음, 앞·오른쪽 낮음).
 */
export function wallHigh(xf, side) {
  const d = wallWorldDir(xf, side);
  return d.x < 0 || d.z < 0;
}

/** 창 벽: 뒤 벽이 높으면 뒤, 아니면 앞 벽(마주 보는 두 벽 중 하나는 늘 높다) */
export const windowWall = (room) => (wallHigh(room && room.xf, 'back') ? 'back' : 'front');
