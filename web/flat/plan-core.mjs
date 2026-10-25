// 복셀 2D(위에서 본 사무실 평면도)의 순수 부분. three·DOM 없음(node --test 대상).
//   배치는 3D 복셀과 같은 voxel/layout.js(computeOffice)·voxel/campus.mjs(computeCampus) 결과를 그대로 쓰고, 여기서는 평면도 그림 재료만 만든다.
import { t } from '../i18n.mjs'; // 다국어

export const DOOR_W = 1.6;      // 문 틈 폭(세계 단위) — 3D 출입문과 같은 폭
const PI = Math.PI;

/**
 * 방 벽 선분: 앞 벽(+z)은 출입문 자리, 뒤 벽(−z)은 별관 통로(backDoor), 회의실 왼쪽 벽은 옆문(leftDoor) 만큼 틈을 둔다.
 * 반환 [[x0, z0, x1, z1], …]
 */
export function wallSegments(room, doorW = DOOR_W) {
  const b = room.bounds, h = doorW / 2;
  const segs = [];
  const hline = (z, gaps) => {
    let x = b.minX;
    for (const g of gaps.sort((p, q) => p - q)) { if (g - h > x) segs.push([x, z, g - h, z]); x = Math.max(x, g + h); }
    if (x < b.maxX) segs.push([x, z, b.maxX, z]);
  };
  const vline = (x, gaps) => {
    let z = b.minZ;
    for (const g of gaps.sort((p, q) => p - q)) { if (g - h > z) segs.push([x, z, x, g - h]); z = Math.max(z, g + h); }
    if (z < b.maxZ) segs.push([x, z, x, b.maxZ]);
  };
  hline(b.minZ, room.backDoor ? [room.origin.x] : []);
  hline(b.maxZ, room.door ? [room.door.x] : []);
  vline(b.minX, room.leftDoor != null ? [room.leftDoor] : []);
  vline(b.maxX, []);
  return segs;
}

/** 캐릭터가 바라보는 방향(yaw: 0 = +z, atan2(dx, dz)) → 평면 단위 벡터 */
export const yawVec = (yaw) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });

/**
 * 시설 자리(stations[cat] 의 접근점들, 같은 face) → 시설 사각 {x, z, w, d}: 접근점들이 바라보는 쪽으로 0.75 앞에, 줄을 따라 길게.
 * 시설 그림이 접근점(사람이 서는 곳)을 덮지 않게 한다.
 */
export function facilityRect(spots, depth = 0.6) {
  if (!spots || !spots.length) return null;
  const f = spots[0].face || 0;
  const d = yawVec(f);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of spots) { minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z); }
  const cx = (minX + maxX) / 2 + d.x * 0.75, cz = (minZ + maxZ) / 2 + d.z * 0.75;
  const along = Math.abs(d.x) > 0.5; // 옆 벽: 줄이 z 방향
  const len = (along ? maxZ - minZ : maxX - minX) + 0.8;
  return along ? { x: cx, z: cz, w: depth, d: len } : { x: cx, z: cz, w: len, d: depth };
}

/** 시설 이름(평면도 글자) — CAT_FACILITY 이름 → 짧은 한국어 */
export const FACILITY_LABEL = Object.freeze(Object.defineProperties({}, Object.fromEntries(
  ['shelf', 'files', 'board', 'toolbox', 'antenna', 'terminal', 'kiosk', 'screens', 'portal', 'bell'].map((k) => [k, { enumerable: true, get: () => t('boards.facility.' + k) }]))));

/** 방 문패 종류(3D office.js _labelPass 와 같은 규칙) */
export function roomKindName(room, isMain) {
  return t('boards.room.' + (room.type === 'meeting' ? 'meeting' : room.external ? 'external' : room.recent ? 'recent' : isMain ? 'office' : 'annex'));
}

/** 평면도 캐릭터 반지름(세계): 팀장(세션)은 조금 크게 */
export const charRadius = (lead) => (lead ? 0.66 : 0.5);

/** 걷는 중인가(그리기 30fps 가 필요한 상태) */
export const isMoving = (ch) => ch.state === 'walk' || ch.state === 'enter' || ch.state === 'leave' || ch.state === 'blink' || ch.appearT0 != null || ch.vanishT0 != null;

export { PI };
