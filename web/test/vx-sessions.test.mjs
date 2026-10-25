// 복셀 여러 live 세션의 순수 규칙(vx-sess-core): 사무실 이사 보간, 충돌 → 직원 캐비닛 방문, 종이비행기, 캐릭터 방문 경로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCampus } from '../voxel/campus.mjs';
import { VxSessCore, MOVE_DUR, PLANE_DUR } from '../voxel/vx-sess-core.mjs';
import { ConflictBook, conflictEvent } from '../conflict-core.mjs';
import { Character } from '../voxel/character-core.mjs';

const T = (m) => new Date(Date.parse('2026-10-24T03:00:00Z') + m * 60000).toISOString();
function world(liveSids, allSids) {
  const nodes = [], roots = [];
  let ord = 0;
  for (const sid of allSids) {
    nodes.push({ id: 's:' + sid, parentId: null, kind: 'main', status: 'active', order: ord++, projectId: 'P', rootSessionId: sid, sessionId: sid, meta: {}, startedAt: T(allSids.indexOf(sid)), lastActivityAt: T(30) });
    nodes.push({ id: `a:${sid}-1`, parentId: 's:' + sid, kind: 'subagent', status: 'active', order: ord++, projectId: 'P', rootSessionId: sid, meta: {}, lastActivityAt: T(30) });
    roots.push({ nodeId: 's:' + sid, projectId: 'P' });
  }
  return { nodes, roots, projects: [{ projectId: 'P', name: 'p', live: true, active: true, liveList: liveSids.map((s, i) => ({ sessionId: s, entrypoint: 'cli', liveStatus: 'busy', activityAt: T(40 - i) })) }] };
}
const fakeView = (lay) => ({ layout: lay, scope: { mode: 'all' }, chars: new Map(), tokens: { 'sess-0': '#111', 'flow-call': '#222', ok: '#333' }, ts: 1 });

test('사무실 이사: /clear 로 새 메인이 라운지 자리, 이전 메인은 날개 — 이전 화면 자리에서 출발해 MOVE_DUR 뒤 도착', () => {
  const w1 = world(['A', 'B'], ['A', 'B', 'C']);
  const lay1 = computeCampus(w1.nodes, w1.roots, w1.projects, null, { nowMs: Date.parse(T(41)) });
  const view = fakeView(lay1);
  const core = new VxSessCore(view);
  core.afterLayout(lay1, 0);
  const at1 = { ...lay1.officeByMain.get('s:B').rooms[0].origin };
  // /clear: B 가 끝나고 C 가 live → C 가 라운지 둘레, B 는 날개
  const w2 = world(['A', 'C'], ['A', 'B', 'C']);
  const lay2 = computeCampus(w2.nodes, w2.roots, w2.projects, lay1, { nowMs: Date.parse(T(42)) });
  const fin = { ...lay2.officeByMain.get('s:B').rooms[0].origin };
  view.layout = lay2;
  const moving = core.afterLayout(lay2, 10);
  assert.ok(moving.size > 0, '옮겨 간 방이 있음');
  const b0 = lay2.officeByMain.get('s:B').rooms[0].origin;
  assert.ok(Math.abs(b0.x - at1.x) < 1e-6 && Math.abs(b0.z - at1.z) < 1e-6, '처음엔 이전 자리');
  core.stepMoves(10 + MOVE_DUR / 2);
  const mid = lay2.officeByMain.get('s:B').rooms[0].origin;
  assert.ok(Math.hypot(mid.x - fin.x, mid.z - fin.z) < Math.hypot(at1.x - fin.x, at1.z - fin.z), '가는 중');
  core.stepMoves(10 + MOVE_DUR + 0.01);
  const end = lay2.officeByMain.get('s:B').rooms[0].origin;
  assert.ok(Math.abs(end.x - fin.x) < 1e-6 && Math.abs(end.z - fin.z) < 1e-6, '도착');
  assert.equal(core.moves.size, 0);
  assert.ok(lay2.officeByMain.get('s:B').rooms.every((r) => r.past), '날개 = 불 꺼짐');
});

test('충돌 → 양쪽 직원이 라운지 캐비닛 앞 자리로(새로 생기거나 바뀔 때만), 메시지 → 종이비행기', () => {
  const w = world(['A', 'B'], ['A', 'B']);
  const lay = computeCampus(w.nodes, w.roots, w.projects, null, { nowMs: Date.parse(T(41)) });
  const view = fakeView(lay);
  const mk = (id) => ({ id, state: 'seated', placed: true, offstage: false, room: lay.rooms[0], node: { id } });
  view.chars.set('a:A-1', mk('a:A-1')); view.chars.set('s:B', mk('s:B'));
  const book = new ConflictBook();
  const core = new VxSessCore(view);
  core.setBook(book);
  book.apply(conflictEvent({ id: 's:A|s:B|k', a: 's:A', b: 's:B', k: 'k', n: 'x.js', level: 'strong', nodeA: 'a:A-1', nodeB: null }, 'on', 't'), Date.now());
  core.stepConflicts(100);
  const L = lay.lounges[0];
  assert.ok(view.chars.get('a:A-1').visit && view.chars.get('s:B').visit, '파일 건드린 직원 + (노드 없으면) 팀장');
  assert.deepEqual(view.chars.get('a:A-1').visit.spot, L.spots[0]);
  view.chars.get('a:A-1').visit = null;
  core.stepConflicts(101);
  assert.equal(view.chars.get('a:A-1').visit, null, '같은 충돌이면 다시 보내지 않음');
  assert.equal(core.cabText(core.pairsOf(L)), 'x.js');
  assert.ok(core.message({ nodeId: 'a:A-1', peer: 's:B' }, 5));
  assert.equal(core.livePlanes(5 + PLANE_DUR / 2).length, 1);
  assert.equal(core.livePlanes(5 + PLANE_DUR + 0.1).length, 0);
});

test('캐릭터 방문: 방 안 → 문 → 문 밖 → 라운지 자리, 시간이 지나면 자리로 돌아감', () => {
  const room = { id: 'o:x', door: { x: 7.8, z: 9, out: { x: 7.8, z: 10.5 } }, bounds: { minX: -12, maxX: 12, minZ: -9, maxZ: 9 }, aisles: [0] };
  const seat = { x: 0, z: 0, deskX: 0, deskZ: 0.75, face: 0, kind: 'grid' };
  const ch = new Character('a:1', { id: 'a:1', kind: 'subagent', status: 'active', openTools: [] }, { lead: false });
  ch.seat = seat; ch.room = room; ch.placeAt(seat, 0); ch.placed = true; ch.state = 'seated';
  ch.target = { key: 'desk:0.00,0.00', type: 'desk', spot: seat };
  const spot = { x: 20, z: 0, face: Math.PI };
  ch.visit = { spot, until: 10 };
  const ctx = { now: 1, dt: 0.016, ts: 1, room, seat, stationSpot: () => null, releaseStation: () => {} };
  ch._decide(ctx);
  assert.equal(ch.target.type, 'visit');
  const last = ch.path[ch.path.length - 1];
  assert.deepEqual([last.x, last.z], [20, 0], '라운지 자리(방 경계로 자르지 않음)');
  assert.ok(ch.path.some((p) => p.x === room.door.out.x && p.z === room.door.out.z), '문 밖을 지남');
  ch.placeAt(spot, spot.face); ch.state = 'seated'; ch.path = null;
  ctx.now = 11;
  ch._decide(ctx);
  assert.equal(ch.visit, null);
  assert.equal(ch.target.type, 'desk');
  assert.deepEqual([ch.path[1].x, ch.path[1].z], [room.door.out.x, room.door.out.z], '문 밖으로 돌아 들어옴');
});
