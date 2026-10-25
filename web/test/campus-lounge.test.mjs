// 복셀 캠퍼스: 같은 프로젝트 live 메인 여럿 → 공용 라운지 둘레 사무실·지난 메인 날개·ㅁ자 중정(층 쌓기 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCampus, LOUNGE } from '../voxel/campus.mjs';

const T = (m) => new Date(Date.parse('2026-10-24T03:00:00Z') + m * 60000).toISOString();
let ord = 0;
function world(nLive, past = 0, kids = 4) {
  ord = 0;
  const nodes = [], roots = [], liveList = [];
  const add = (n) => nodes.push({ status: 'active', order: ord++, projectId: 'P', meta: {}, lastActivityAt: T(30), ...n });
  for (let i = 0; i < nLive + past; i++) {
    const sid = (i < nLive ? 'L' : 'P') + i, id = 's:' + sid;
    add({ id, parentId: null, kind: 'main', rootSessionId: sid, sessionId: sid, startedAt: T(i), status: i < nLive ? 'active' : 'idle' });
    roots.push({ nodeId: id, projectId: 'P' });
    if (i < nLive) liveList.push({ sessionId: sid, entrypoint: 'cli', liveStatus: 'busy', activityAt: T(40 - i) });
    for (let c = 0; c < kids; c++) add({ id: `a:${sid}-${c}`, parentId: id, kind: 'subagent', rootSessionId: sid });
  }
  return { nodes, roots, projects: [{ projectId: 'P', name: 'p', live: true, active: true, liveList }] };
}
const roomsHit = (rooms) => {
  const bad = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i].bounds, b = rooms[j].bounds;
    if (a.minX < b.maxX - 1e-6 && a.maxX > b.minX + 1e-6 && a.minZ < b.maxZ - 1e-6 && a.maxZ > b.minZ + 1e-6) bad.push([rooms[i].id, rooms[j].id]);
  }
  return bad;
};
const inLounge = (L, r) => r.bounds.minX < L.maxX && r.bounds.maxX > L.minX && r.bounds.minZ < L.maxZ && r.bounds.maxZ > L.minZ;

test('live 메인 2개: 라운지 왼쪽·오른쪽에 사무실, 라운지와 방 겹침 0, 캐비닛·직원 자리', () => {
  const w = world(2);
  const c = computeCampus(w.nodes, w.roots, w.projects, null, { nowMs: Date.parse(T(41)) });
  assert.equal(c.lounges.length, 1);
  const L = c.lounges[0];
  assert.equal(L.maxX - L.minX, LOUNGE.w);
  assert.deepEqual(L.mains, ['s:L0', 's:L1']);
  const o0 = c.officeByMain.get('s:L0').rooms[0].bounds, o1 = c.officeByMain.get('s:L1').rooms[0].bounds;
  assert.ok(o0.maxX <= L.minX && o1.minX >= L.maxX, '라운지를 사이에 두고 양쪽');
  assert.deepEqual(roomsHit(c.rooms), []);
  for (const r of c.rooms) assert.ok(!inLounge(L, r), `${r.id} 라운지 침범`);
  assert.ok(L.cabinet && L.spots.length >= 2);
});

test('live 3 + 지난 메인 2: 셋째는 라운지 뒤, 지난 메인은 양쪽 날개(불 꺼짐)', () => {
  const w = world(3, 2);
  const c = computeCampus(w.nodes, w.roots, w.projects, null, { nowMs: Date.parse(T(41)) });
  const L = c.lounges[0];
  const back = c.officeByMain.get('s:L2').rooms[0].bounds;
  assert.ok(back.maxZ <= L.minZ, '라운지 뒤(-z)');
  const b = c.buildings[0];
  const wings = b.offices.filter((o) => o.role === 'wing').map((o) => o.mainId).sort();
  assert.deepEqual(wings, ['s:P3', 's:P4']);
  for (const id of wings) assert.ok(c.officeByMain.get(id).rooms.every((r) => r.past), '날개 방 = past');
  const xs = wings.map((id) => c.officeByMain.get(id).rooms[0].bounds);
  assert.ok((xs[0].maxX <= L.minX) !== (xs[1].maxX <= L.minX), '왼쪽·오른쪽 번갈아');
  assert.deepEqual(roomsHit(c.rooms), []);
});

test('live 5개: ㅁ자 중정(라운지 둘레 네 변 + 모서리), 겹침 0, 한 층(y 없음)', () => {
  const w = world(5, 0, 6);
  const c = computeCampus(w.nodes, w.roots, w.projects, null, { nowMs: Date.parse(T(41)) });
  const L = c.lounges[0];
  const cx = (L.minX + L.maxX) / 2, cz = (L.minZ + L.maxZ) / 2;
  const side = (id) => { const r = c.officeByMain.get(id).rooms[0].bounds; const x = (r.minX + r.maxX) / 2 - cx, z = (r.minZ + r.maxZ) / 2 - cz; return [Math.sign(Math.round(x)), Math.sign(Math.round(z))]; };
  assert.deepEqual(side('s:L0'), [-1, 0]);
  assert.deepEqual(side('s:L1'), [1, 0]);
  assert.deepEqual(side('s:L2')[1], -1);
  assert.deepEqual(side('s:L3')[1], 1);
  assert.deepEqual(roomsHit(c.rooms), []);
  for (const r of c.rooms) assert.ok(!inLounge(L, r));
});

test('live 메인 하나면 라운지 없음(예전 배치 그대로)', () => {
  const w = world(1, 1);
  const c = computeCampus(w.nodes, w.roots, w.projects, null, { nowMs: Date.parse(T(41)) });
  assert.equal(c.lounges.length, 0);
});
