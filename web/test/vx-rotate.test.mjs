// 복셀 사무실 회전: 라운지 둘레 live 사무실이 라운지 쪽으로 문을 향함(90° 단위), 회전 뒤 좌표 겹침 없음·길 찾기·지역 사본
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCampus, translateOffice } from '../voxel/campus.mjs';
import { computeOffice, pathBetween } from '../voxel/layout.js';
import { rotXZ, rotateOffice, toWorld, toLocal, wallHigh, windowWall, quarter } from '../voxel/xf.mjs';

const T = (m) => new Date(Date.parse('2026-10-24T03:00:00Z') + m * 60000).toISOString();
let ord = 0;
function world(nLive, past = 0, kids = 6) {
  ord = 0;
  const nodes = [], roots = [], liveList = [];
  const add = (n) => nodes.push({ status: 'active', order: ord++, projectId: 'P', meta: {}, lastActivityAt: T(30), ...n });
  for (let i = 0; i < nLive + past; i++) {
    const sid = (i < nLive ? 'L' : 'P') + i, id = 's:' + sid;
    add({ id, parentId: null, kind: 'main', rootSessionId: sid, sessionId: sid, startedAt: T(i), status: i < nLive ? 'active' : 'idle' });
    roots.push({ nodeId: id, projectId: 'P' });
    if (i < nLive) liveList.push({ sessionId: sid, entrypoint: 'cli', liveStatus: 'busy', activityAt: T(40 - i) });
    for (let c = 0; c < kids; c++) add({ id: `a:${sid}-${c}`, parentId: id, kind: 'subagent', rootSessionId: sid });
    add({ id: `b:${sid}`, parentId: id, kind: 'bash-bg', rootSessionId: sid });
    add({ id: `m:${sid}`, parentId: id, kind: 'monitor', rootSessionId: sid });
  }
  return { nodes, roots, projects: [{ projectId: 'P', name: 'p', live: true, active: true, liveList }] };
}
const camp = (n, past = 0) => { const w = world(n, past); return computeCampus(w.nodes, w.roots, w.projects, null, { nowMs: Date.parse(T(41)) }); };
const inside = (p, b, pad = 0) => p.x >= b.minX - pad - 1e-6 && p.x <= b.maxX + pad + 1e-6 && p.z >= b.minZ - pad - 1e-6 && p.z <= b.maxZ + pad + 1e-6;

test('rotXZ: 사분 회전 정수 정확, yaw 규칙(지역 +z → k=1 이면 +x)', () => {
  assert.deepEqual(rotXZ(0, 1, 1), { x: 1, z: 0 });
  assert.deepEqual(rotXZ(0, 1, 2), { x: 0, z: -1 });
  assert.deepEqual(rotXZ(0, 1, 3), { x: -1, z: 0 });
  assert.deepEqual(rotXZ(3, 4, 4), { x: 3, z: 4 });
  const xf = { k: 1, px: 5, pz: -2 };
  const w = toWorld(xf, 7, 1), l = toLocal(xf, w.x, w.z);
  assert.ok(Math.abs(l.x - 7) < 1e-9 && Math.abs(l.z - 1) < 1e-9);
  // 돌리지 않은 방: 뒤·왼쪽 높음, 앞·오른쪽 낮음(예전 그대로)
  assert.deepEqual(['back', 'left', 'front', 'right'].map((s) => wallHigh(null, s)), [true, true, false, false]);
  for (let k = 0; k < 4; k++) assert.equal(['back', 'front'].filter((s) => wallHigh({ k }, s)).length, 1, '마주 보는 벽 중 하나만 높음');
  assert.equal(windowWall({ xf: { k: 2 } }), 'front');
});

for (const n of [2, 3, 4, 5]) {
  test(`live ${n}개: 사무실 문이 라운지 쪽, 자리·책상·시설·기계가 방 안, 책상 겹침 0`, () => {
    const c = camp(n, 1);
    const L = c.lounges[0];
    const lc = { x: (L.minX + L.maxX) / 2, z: (L.minZ + L.maxZ) / 2 };
    for (let i = 0; i < n; i++) {
      const lay = c.officeByMain.get('s:L' + i);
      const room = lay.rooms[0];
      assert.ok(room.lounge && room.xf, '라운지 사무실 표시');
      const d = room.door, ox = d.out.x - d.x, oz = d.out.z - d.z;
      const rc = { x: (room.bounds.minX + room.bounds.maxX) / 2, z: (room.bounds.minZ + room.bounds.maxZ) / 2 };
      const tx = lc.x - rc.x, tz = lc.z - rc.z;
      if (i < 4) assert.ok(ox * tx + oz * tz > 0, `L${i} 문(${ox},${oz})이 라운지(${tx.toFixed(1)},${tz.toFixed(1)}) 쪽`);
      if (n === 2) assert.equal(quarter(room.xf.k), i === 0 ? 1 : 3, '둘이면 마주 보기(180°)');
      // 자리·기계는 그 방 안
      const byRoom = new Map(lay.rooms.map((r) => [r.id, r]));
      const desks = [];
      for (const [id, s] of lay.seat) {
        const r = byRoom.get(s.roomId);
        assert.ok(inside(s, r.bounds, 0.01), `${id} 자리 방 밖`);
        if (s.kind === 'grid' || s.kind === 'aux' || s.kind === 'lead') { assert.ok(inside({ x: s.deskX, z: s.deskZ }, r.bounds)); desks.push(s); }
        // 책상을 바라봄: 자리 → 책상 방향 = face
        if (s.kind === 'grid' || s.kind === 'lead') {
          const fx = Math.sin(s.face), fz = Math.cos(s.face), dx = s.deskX - s.x, dz = s.deskZ - s.z;
          assert.ok(fx * dx + fz * dz > 0.5, `${id} 책상 쪽을 봄`);
        }
      }
      for (let a = 0; a < desks.length; a++) for (let b = a + 1; b < desks.length; b++) {
        const A = desks[a], B = desks[b];
        const clash = Math.abs(A.deskX - B.deskX) < 1.3 && Math.abs(A.deskZ - B.deskZ) < 1.3 && Math.hypot(A.deskX - B.deskX, A.deskZ - B.deskZ) < 1.3;
        assert.ok(!clash, `책상 겹침 ${a},${b}`);
      }
      for (const [, m] of lay.machine) assert.ok(inside(m, byRoom.get(m.roomId).bounds, 0.01), '기계 방 안');
      for (const r of lay.rooms) {
        for (const key of Object.keys(r.stations)) for (const sp of r.stations[key]) assert.ok(inside(sp, r.bounds, 0.01), `${key} 시설 방 안`);
        if (r.portal) assert.ok(inside(r.portal, r.bounds, 0.01));
        // 지역 사본 → xf → 세계 가 같은 점
        if (r.local) {
          const w = toWorld(r.xf, r.local.door.x, r.local.door.z);
          assert.ok(Math.abs(w.x - r.door.x) < 1e-6 && Math.abs(w.z - r.door.z) < 1e-6, '지역 사본 일치');
        }
      }
    }
    // 방끼리·라운지 겹침 0
    const rooms = c.rooms;
    for (let i = 0; i < rooms.length; i++) {
      const a = rooms[i].bounds;
      assert.ok(!(a.minX < L.maxX && a.maxX > L.minX && a.minZ < L.maxZ && a.maxZ > L.minZ), '라운지 침범');
      for (let j = i + 1; j < rooms.length; j++) {
        const b = rooms[j].bounds;
        assert.ok(!(a.minX < b.maxX - 1e-6 && a.maxX > b.minX + 1e-6 && a.minZ < b.maxZ - 1e-6 && a.maxZ > b.minZ + 1e-6), `${rooms[i].id}·${rooms[j].id} 겹침`);
      }
    }
    // 날개(지난 메인)는 돌리지 않음
    const wing = c.officeByMain.get('s:P' + n);
    assert.ok(wing.rooms.every((r) => !r.xf || !quarter(r.xf.k)), '날개는 지금 방향');
  });
}

test('돌린 방 길 찾기: 회전 전 방에서 찾은 길을 돌린 것과 같음, 가로·세로만, 방 경계 안', () => {
  const w = world(1, 0, 8);
  const base = computeOffice(w.nodes, 's:L0', null);
  const rot = computeOffice(w.nodes, 's:L0', null);
  rotateOffice(rot, 1, 0, 0);
  translateOffice(rot, 40, -12);
  const room = rot.rooms[0], room0 = base.rooms[0];
  const ids = [...rot.seat.keys()];
  for (const a of ids) for (const b of ids.slice(0, 4)) {
    if (a === b) continue;
    const p = pathBetween(rot.seat.get(a), rot.seat.get(b), room);
    const p0 = pathBetween(base.seat.get(a), base.seat.get(b), room0);
    assert.equal(p.length, p0.length);
    p.forEach((q, i) => {
      const e = rotXZ(p0[i].x, p0[i].z, 1); // 회전 중심 0,0 → 그다음 평행 이동
      assert.ok(Math.abs(q.x - (e.x + 40)) < 1e-6 && Math.abs(q.z - (e.z - 12)) < 1e-6, `${a}→${b} ${i}`);
      if (i) assert.ok(Math.abs(q.x - p[i - 1].x) < 1e-6 || Math.abs(q.z - p[i - 1].z) < 1e-6, '가로·세로');
      assert.ok(inside(q, room.bounds, 1.21));
    });
  }
  // 문 → 문 밖은 방 바깥 +x(돌린 앞)
  assert.ok(room.door.out.x > room.door.x && Math.abs(room.door.out.z - room.door.z) < 1e-6);
  assert.equal(rot.seat.get('s:L0').face, Math.PI / 2);
});

test('충돌 방문 길: 방 안 → 문 → 문 밖 → 라운지 자리(돌린 방에서도 문을 지남)', async () => {
  const { Character } = await import('../voxel/character-core.mjs');
  const c = camp(2);
  const lay = c.officeByMain.get('s:L1');
  const room = lay.rooms[0], seat = lay.seat.get('a:L1-0');
  const ch = new Character('a:L1-0', { id: 'a:L1-0', kind: 'subagent', status: 'active', openTools: [] }, { lead: false });
  ch.placed = true; ch.seat = seat; ch.room = room; ch.placeAt(seat, seat.face); ch.state = 'seated';
  ch.target = { key: 'desk', type: 'desk', spot: seat };
  const spot = c.lounges[0].spots[1];
  ch.visit = { spot, until: 1e9 };
  ch._decide({ now: 1, dt: 0.016, ts: 1, seat, room, stationSpot: () => null, releaseStation: () => {} });
  const P = ch.path;
  assert.ok(P && P.length >= 3);
  const di = P.findIndex((q) => Math.abs(q.x - room.door.out.x) < 1e-6 && Math.abs(q.z - room.door.out.z) < 1e-6);
  assert.ok(di > 0, '문 밖을 지남');
  for (const q of P.slice(0, di)) assert.ok(inside(q, room.bounds, 1.21), '문 앞까지는 방 안');
  assert.deepEqual(P[P.length - 1], spot);
});
