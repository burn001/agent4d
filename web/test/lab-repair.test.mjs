// node --test "web/test/lab-repair.test.mjs"   복셀 연구소 QA 수리(10.31. → 11.01.): 격자 캐시 이어 쓰기(배치마다 새 방 객체) ·
// 구역(브리지) 순서 고정(루트 = 지금 메인이 바뀌어도) · 바닥 사람은 덱 지름길 없음 · 밀어내기가 가구 안으로 밀지 않음 · navSolid
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLab } from '../lab/lab-layout-core.mjs';
import { roomNav, navPath, navSolid, navPathBlocked } from '../voxel/nav-core.mjs';
import { separate } from '../voxel/crowd-core.mjs';
import { routeSig } from '../voxel/office-core.mjs';

function multi(nMain, nSub = 4, nBg = 1) {
  const a = [];
  let o = 0;
  for (let m = 0; m < nMain; m++) a.push({ id: 'm' + m, kind: 'main', order: o++, status: 'active' });
  for (let m = 0; m < nMain; m++) {
    for (let i = 0; i < nSub; i++) a.push({ id: `s${m}_${i}`, kind: 'subagent', parentId: 'm' + m, order: o++, status: 'active' });
    for (let i = 0; i < nBg; i++) a.push({ id: `b${m}_${i}`, kind: 'bash-bg', parentId: 'm' + m, order: o++, status: 'active' });
  }
  return a;
}

test('격자 캐시: 같은 입력으로 다시 배치하면(새 방 객체) 같은 nav·길 캐시를 이어 씀 · 장애물이 바뀌면 새 격자', () => {
  const nodes = multi(1, 6, 2);
  const L1 = computeLab(nodes, 'm0', null);
  const L2 = computeLab(nodes, 'm0', L1);
  assert.ok(L1.rooms[0] !== L2.rooms[0]);
  const n1 = roomNav(L1.rooms[0]), n2 = roomNav(L2.rooms[0]);
  assert.ok(n1 === n2, '같은 장애물 → 같은 격자'); // equal 은 실패 때 큰 격자 diff 로 메모리가 터짐
  const a = L1.seat.get('s0_0'), b = L1.rooms[0].door;
  navPath(a, b, L1.rooms[0]);
  const sz = n1.cache.size;
  navPath(L2.seat.get('s0_0'), L2.rooms[0].door, L2.rooms[0]);
  assert.equal(n2.cache.size, sz, '두 번째 배치의 같은 길 = 캐시 적중');
  // 캠퍼스: 같은 자리 연구동을 다시 배치해도 이어 씀
  const L3 = computeLab(nodes, 'm0', null, { cx: 120, cz: -80 }), L3b = computeLab(nodes, 'm0', L3, { cx: 120, cz: -80 });
  assert.ok(roomNav(L3.rooms[0]) === roomNav(L3b.rooms[0]), '캠퍼스 연구동도 이어 씀');
  // 기자재가 늘면 다른 격자
  const L4 = computeLab([...nodes, { id: 'bx', kind: 'bash-bg', parentId: 'm0', order: 99, status: 'active' }], 'm0', L1);
  assert.ok(roomNav(L4.rooms[0]) !== n1);
});

test('구역 순서 고정: 루트(지금 메인)가 바뀌어도 이전 결과가 있으면 메인마다 브리지·책상 자리 그대로', () => {
  const nodes = multi(3, 3, 1);
  const L1 = computeLab(nodes, 'm0', null);
  assert.equal(L1.rooms[0].ownerId, 'm0', '처음엔 루트가 0번');
  let prev = L1;
  for (const root of ['m1', 'm2', 'm0', 'm2']) {
    const L = computeLab(nodes, root, prev);
    for (const id of ['m0', 'm1', 'm2', 's0_0', 's1_1', 's2_2']) {
      const a = L1.seat.get(id), b = L.seat.get(id);
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1e-9, `root=${root} ${id} 자리 그대로`);
      assert.equal(a.zone, b.zone);
    }
    prev = L;
  }
  // 새 메인은 뒤 구역(기존 메인 순서 유지)
  const L5 = computeLab([...nodes, { id: 'm3', kind: 'main', order: 100, status: 'active' }], 'm3', L1);
  assert.equal(L5.rooms[3].ownerId, 'm3');
  assert.deepEqual(L5.rooms.slice(0, 3).map((r) => r.ownerId), ['m0', 'm1', 'm2']);
});

test('navSolid·navPathBlocked: 책상 상자 안 = true, 통로 = false, 길찾기 결과는 상자를 지나지 않음', () => {
  const L = computeLab(multi(1, 6, 2), 'm0', null), room = L.rooms[0];
  const box = room.navBoxes.find((b) => b.kind === 'desk');
  assert.ok(navSolid(room, (box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2));
  assert.ok(!navSolid(room, room.door.x, room.door.z));
  const p = navPath(L.seat.get('s0_0'), room.door, room);
  assert.ok(!navPathBlocked(room, p.slice(1)), '길 몸통은 상자 밖');
  assert.ok(navPathBlocked(room, [{ x: box.minX - 1, z: (box.minZ + box.maxZ) / 2 }, { x: box.maxX + 1, z: (box.minZ + box.maxZ) / 2 }]), '상자를 가로지르는 선 = 막힘');
});

test('밀어내기: solid 판정이 있으면 가구 안으로 밀지 않음(없으면 예전대로)', () => {
  const room = { id: 'r', type: 'lab' };
  const mk = (id, x) => ({ id, room, placed: true, state: 'seated', pos: { x, z: 0 }, target: { type: 'station', spot: { x, z: 0 } }, seat: { x, z: 0 } });
  const a = mk('a', 0), b = mk('b', 0.3);
  const solid = (ch, x) => x < -0.05; // x < -0.05 = 가구
  for (let i = 0; i < 30; i++) separate([a, b], 1 / 30, undefined, 1, solid);
  assert.ok(a.pos.x >= -0.05 - 1e-9, `가구 안으로 밀리지 않음 ${a.pos.x}`);
  const c = mk('c', 0), d = mk('d', 0.3);
  for (let i = 0; i < 30; i++) separate([c, d], 1 / 30);
  assert.ok(c.pos.x < -0.05, '판정 없으면 예전처럼 밀림');
});

test('바닥 조명 라인 길 열쇠: 길 서명이 있는 방(연구소)만 · 끝점·서명이 같으면 같은 열쇠', () => {
  const r = { id: 'lab:m0', navSig: 'x', origin: { x: 0, z: 0 } };
  assert.equal(routeSig({ x: 1, z: 2 }, { x: 3, z: 4 }, r), routeSig({ x: 1.001, z: 2 }, { x: 3, z: 4 }, r));
  assert.notEqual(routeSig({ x: 1, z: 2 }, { x: 3, z: 4 }, r), routeSig({ x: 1, z: 2 }, { x: 3, z: 4 }, { ...r, navSig: 'y' }));
  assert.equal(routeSig({ x: 1, z: 2 }, { x: 3, z: 4 }, { id: 'office' }), null);
});
