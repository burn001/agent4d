// 복셀 오피스 겹침 막기: 시설 자리(슬롯) 예약 장부 · 탕비실 자리 · 대기 줄 · 가벼운 밀어내기 · 라운지 방문 자리 — 순수
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOffice, stationFor, CAT_FACILITY } from '../voxel/layout.js';
import { rotateOffice } from '../voxel/xf.mjs';
import { breakSlots, BREAK_N, BREAK } from '../voxel/office-core.mjs';
import { SpotBook, CROWD, stationCands, takeStation, takeBreak, releaseSpot, separate } from '../voxel/crowd-core.mjs';
import { Character } from '../voxel/character-core.mjs';
import { computeCampus } from '../voxel/campus.mjs';
import { VxSessCore } from '../voxel/vx-sess-core.mjs';
import { ConflictBook, conflictEvent } from '../conflict-core.mjs';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const inside = (p, b) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
function office(kids = 8, k = 0) {
  const nodes = [{ id: 'm', kind: 'main', status: 'active', order: 0 }];
  for (let i = 0; i < kids; i++) nodes.push({ id: 'a' + i, parentId: 'm', kind: 'subagent', status: 'active', order: i + 1 });
  const lay = computeOffice(nodes, 'm');
  if (k) rotateOffice(lay, k, 0, 0);
  return { lay, room: lay.rooms[0], nodes };
}
/** 작은 세계: 직원 캐릭터 + 3D 와 같은 ctx(SpotBook) — 프레임마다 update 후 separate */
function world(kids = 8, k = 0) {
  const { lay, room, nodes } = office(kids, k);
  const book = new SpotBook();
  const chars = nodes.map((n) => new Character(n.id, n, { lead: n.kind === 'main' }));
  const ctx = { now: 0, dt: 0.05, ts: 1, room, seat: null,
    stationSpot: (ch, cat) => takeStation(book, ch, cat), releaseStation: (ch) => releaseSpot(book, ch), breakSpot: (ch) => takeBreak(book, ch) };
  let minPair = Infinity;
  const step = () => {
    ctx.now += ctx.dt;
    for (const ch of chars) { ctx.seat = lay.seat.get(ch.id); ch.update(ctx); }
    separate(chars, ctx.dt);
  };
  const run = (sec, watch = null) => { for (let t = 0; t < sec; t += ctx.dt) { step(); if (watch) watch(); } };
  return { lay, room, nodes, chars, book, ctx, run, get minPair() { return minPair; } };
}
const minDist = (cs) => { let m = Infinity; for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) m = Math.min(m, dist(cs[i].pos, cs[j].pos)); return m; };

test('SpotBook: 도착 순서대로 앞 번호 · 같은 시설이면 같은 자리 · 반납 · 다 차면 null · 다른 시설 예약 자리 곁은 건너뜀', () => {
  const b = new SpotBook();
  const c = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }];
  assert.equal(b.take('r', 'k', 'A', c).idx, 0);
  assert.equal(b.take('r', 'k', 'B', c).idx, 1);
  assert.equal(b.take('r', 'k', 'A', c).idx, 0, '이미 잡은 자리 그대로');
  assert.equal(b.take('r', 'k', 'C', c).idx, 2);
  assert.equal(b.take('r', 'k', 'D', c), null, '다 참');
  b.release('B');
  assert.equal(b.take('r', 'k', 'D', c).idx, 1, '반납된 자리');
  assert.equal(b.holder('r', 'k', 1), 'D');
  // 다른 시설: (0.5, 0) 은 k 의 0·1번 예약과 0.8 안 → 건너뛰고 다음 후보
  const o = [{ x: 0.5, z: 0 }, { x: 5, z: 5 }];
  assert.equal(b.take('r', 'other', 'E', o).idx, 1);
  // 다른 방은 따로
  assert.equal(b.take('r2', 'k', 'F', c).idx, 0);
  b.dropRoom('r');
  assert.equal(b.count('r', 'k'), 0); assert.equal(b.get('A'), null); assert.ok(b.get('F'));
});

test('시설 후보 자리: 접근점 + 대기 줄이 모두 다른 점(접근점 둘인 시설의 셋째 대기 자리가 첫째와 겹치던 것)', () => {
  for (const k of [0, 1, 3]) {
    const { room } = office(4, k);
    for (const cat of Object.keys(CAT_FACILITY)) {
      const cs = stationCands(room, cat);
      assert.ok(cs && cs.length >= 4, cat);
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) assert.ok(dist(cs[i], cs[j]) > 0.85, `${cat} ${i}-${j} k=${k}`);
      assert.equal(stationFor(cat, room, cs.length), null);
    }
  }
});

test('탕비실 자리: 방 안 · 서로 0.85 이상 · 0번 = 커피 머신 앞(카운터를 봄) · 돌린 방도', () => {
  for (const k of [0, 1, 2, 3]) {
    const { room } = office(4, k);
    const s = breakSlots(room);
    assert.equal(s.length, BREAK_N); assert.ok(BREAK_N >= 6);
    for (const p of s) { assert.ok(inside(p, room.bounds), `k=${k}`); assert.ok(Number.isFinite(p.face)); }
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) assert.ok(dist(s[i], s[j]) >= 0.85, `${i}-${j} k=${k}`);
  }
});

test('여러 직원이 한꺼번에 커피: 자리마다 한 사람(머신 앞부터), 넘치면 자기 자리 — 서 있는 동안 서로 MIN_D 이상, 결정적', () => {
  const sim = () => {
    const w = world(8);
    for (const n of w.nodes) if (n.kind !== 'main') n.status = 'idle';
    w.run(BREAK.WAIT_AFTER + 8);
    return w;
  };
  const w = sim();
  const staff = w.chars.filter((c) => !c.lead);
  const onBreak = staff.filter((c) => c.target && c.target.type === 'break');
  assert.equal(onBreak.length, BREAK_N, '탕비실 자리 수만큼');
  const idx = onBreak.map((c) => c.station.idx).sort((a, b) => a - b);
  assert.deepEqual(idx, [...Array(BREAK_N).keys()], '자리 번호가 겹치지 않음');
  for (const c of staff) if (!onBreak.includes(c)) assert.equal(c.target.type, 'desk', '넘친 사람은 자기 자리');
  assert.ok(minDist(w.chars) >= CROWD.MIN_D - 0.02, `최소 거리 ${minDist(w.chars).toFixed(2)}`);
  // 같은 입력이면 같은 배치(재생·스크럽·3D⇄2D 가 같은 장부·같은 순서)
  const w2 = sim();
  for (let i = 0; i < w.chars.length; i++) {
    assert.ok(dist(w.chars[i].pos, w2.chars[i].pos) < 1e-9, w.chars[i].id);
    assert.equal(w.chars[i].station && w.chars[i].station.idx, w2.chars[i].station && w2.chars[i].station.idx);
  }
  // 일이 생기면 자리를 반납하고 돌아감 → 빈 자리는 기다리던 사람이
  const first = onBreak.find((c) => c.station.idx === 0);
  first.node.status = 'active'; first.addTool('t1', 'write', 'Write', w.ctx.now);
  w.run(0.2);
  assert.equal(w.book.holder(w.room.id, 'break', 0) === first.id, false, '반납');
  w.run(8);
  assert.ok(dist(first.pos, w.lay.seat.get(first.id)) < 1e-3, '자기 자리로');
});

test('같은 시설로 몰리면: 접근점 → 대기 줄 → 넘치면 제자리 작업, 끝나면 모두 반납', () => {
  const w = world(8);
  const staff = w.chars.filter((c) => !c.lead);
  staff.forEach((c, i) => c.addTool('s' + i, 'skill', 'Skill', 0));
  let worst = Infinity;
  w.run(10, () => { const st = staff.filter((c) => c.state === 'work' && c.target.type === 'station'); worst = Math.min(worst, minDist(st)); });
  const at = staff.filter((c) => c.target.type === 'station');
  assert.equal(at.length, stationCands(w.room, 'skill').length, '도구 상자 자리 수만큼');
  assert.equal(staff.filter((c) => c.target.inPlace).length, staff.length - at.length, '나머지는 제자리');
  assert.ok(worst >= CROWD.MIN_D - 0.02, `도착해 선 사람끼리 ${worst.toFixed(2)}`);
  for (const c of staff) w.chars.find((x) => x === c).endTool('s' + staff.indexOf(c), true, w.ctx.now);
  w.run(12);
  assert.equal(w.book.count(w.room.id, 'skill'), 0, '모두 반납');
  for (const c of staff) assert.ok(dist(c.pos, w.lay.seat.get(c.id)) < 1e-3, c.id + ' 자리로');
});

test('separate: 같은 점의 둘은 MIN_D 까지 벌어짐 · 책상에 선 사람은 그대로 · 기준점에서 MAX_OFF 안 · 마주 걷는 둘은 비켜 지나감', () => {
  const room = { id: 'r' };
  const mk = (id, x, z, type = 'station', state = 'work') => ({ id, hash: id.length * 7, placed: true, room, state, pos: { x, z }, seat: { x, z }, target: { type, spot: { x, z } } });
  const a = mk('a', 0, 0), b = mk('b', 0, 0), desk = mk('d', 0.2, 0, 'desk', 'seated');
  for (let i = 0; i < 60; i++) separate([a, b], 0.05);
  assert.ok(dist(a.pos, b.pos) >= CROWD.MIN_D - 1e-6);
  assert.ok(dist(a.pos, { x: 0, z: 0 }) <= CROWD.MAX_OFF + 1e-9);
  const c = mk('c', 0.25, 0);
  for (let i = 0; i < 60; i++) separate([desk, c], 0.05);
  assert.deepEqual(desk.pos, { x: 0.2, z: 0 }, '책상은 안 움직임');
  assert.ok(dist(c.pos, desk.pos) > 0.4);
  // 마주 걷기: 같은 통로 줄(z = 0)을 반대로
  const W = (id, x0, x1) => { const p = [{ x: x0, z: 0 }, { x: x1, z: 0 }]; return { id, hash: 3, placed: true, room, state: 'walk', pos: { x: x0, z: 0 }, path: p, pi: 1, target: { type: 'station', spot: p[1] } }; };
  const p = W('p', -4, 4), q = W('q', 4, -4);
  let m = Infinity;
  for (let i = 0; i < 60; i++) {
    for (const ch of [p, q]) { const t = ch.path[1], dx = t.x - ch.pos.x, dz = t.z - ch.pos.z, d = Math.hypot(dx, dz), s = Math.min(d, 3.5 * 0.05); if (d > 1e-9) { ch.pos.x += dx / d * s; ch.pos.z += dz / d * s; } }
    separate([p, q], 0.05);
    m = Math.min(m, dist(p.pos, q.pos));
  }
  assert.ok(m >= 0.5, `스쳐 지나감 ${m.toFixed(2)}`);
  assert.ok(p.pos.x > 3 && q.pos.x < -3, '길은 그대로 감');
  // 같은 쪽으로 걷는 둘(같은 자리에서 출발): 나란히 붙지 않고 앞뒤로 벌어짐
  const f1 = W('f1', -4, 4), f2 = W('f2', -4, 4);
  for (let i = 0; i < 30; i++) {
    for (const ch of [f1, f2]) { const t = ch.path[1], dx = t.x - ch.pos.x, dz = t.z - ch.pos.z, d = Math.hypot(dx, dz), s = Math.min(d, 3.5 * 0.05); if (d > 1e-9) { ch.pos.x += dx / d * s; ch.pos.z += dz / d * s; } }
    separate([f1, f2], 0.05);
  }
  assert.ok(dist(f1.pos, f2.pos) >= CROWD.MIN_D, `뒤따름 ${dist(f1.pos, f2.pos).toFixed(2)}`);
});

test('라운지 방문: 충돌 묶음이 둘이면(세션 A–B, A–C) 캐비닛 앞 자리도 넷 모두 다름', () => {
  const T = (m) => new Date(Date.parse('2026-10-24T03:00:00Z') + m * 60000).toISOString();
  const nodes = [], roots = [];
  let ord = 0;
  for (const sid of ['A', 'B', 'C']) {
    nodes.push({ id: 's:' + sid, parentId: null, kind: 'main', status: 'active', order: ord++, projectId: 'P', rootSessionId: sid, sessionId: sid, meta: {}, lastActivityAt: T(30) });
    for (const k of [1, 2]) nodes.push({ id: `a:${sid}-${k}`, parentId: 's:' + sid, kind: 'subagent', status: 'active', order: ord++, projectId: 'P', rootSessionId: sid, meta: {}, lastActivityAt: T(30) });
    roots.push({ nodeId: 's:' + sid, projectId: 'P' });
  }
  const projects = [{ projectId: 'P', name: 'p', live: true, active: true, liveList: ['A', 'B', 'C'].map((s, i) => ({ sessionId: s, entrypoint: 'cli', liveStatus: 'busy', activityAt: T(40 - i) })) }];
  const lay = computeCampus(nodes, roots, projects, null, { nowMs: Date.parse(T(41)) });
  const view = { layout: lay, scope: { mode: 'all' }, chars: new Map(), tokens: {}, ts: 1 };
  for (const id of ['a:A-1', 'a:A-2', 'a:B-1', 'a:C-1']) view.chars.set(id, { id, state: 'seated', placed: true, room: lay.rooms[0], node: { id } });
  const book = new ConflictBook(), core = new VxSessCore(view);
  core.setBook(book);
  book.apply(conflictEvent({ id: 's:A|s:B|k1', a: 's:A', b: 's:B', k: 'k1', n: 'x.js', level: 'strong', nodeA: 'a:A-1', nodeB: 'a:B-1' }, 'on', 't'), Date.now());
  book.apply(conflictEvent({ id: 's:A|s:C|k2', a: 's:A', b: 's:C', k: 'k2', n: 'y.js', level: 'strong', nodeA: 'a:A-2', nodeB: 'a:C-1' }, 'on', 't'), Date.now());
  core.stepConflicts(100);
  const spots = [...view.chars.values()].map((c) => c.visit && c.visit.spot);
  assert.ok(spots.every(Boolean), '넷 다 방문');
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(dist(spots[i], spots[j]) > 0.8, `${i}-${j}`);
});

test('끝난 채 붙잡힌 직원(완료 표시 끔): 재배치로 자리가 바뀌면 새 자리로 — 옛 책상을 받은 직원과 겹치지 않음', () => {
  const { lay, room, nodes } = office(2);
  const n = nodes[1], ch = new Character(n.id, n);
  const ctx = { now: 0, dt: 0.05, ts: 1, room, seat: lay.seat.get(n.id), held: new Set([n.id]), stationSpot: () => null, releaseStation: () => {} };
  const run = (sec) => { for (let t = 0; t < sec; t += ctx.dt) { ctx.now += ctx.dt; ch.update(ctx); } };
  run(1);
  n.status = 'done'; run(1);
  assert.equal(ch.state, 'seated', '붙잡혀 자리에 남음');
  const other = lay.seat.get(nodes[2].id);
  ctx.seat = other; ch.target = null; // 재배치(office.js·voxel2d.js 가 자리가 바뀌면 target 을 비움)
  run(10);
  assert.ok(dist(ch.pos, other) < 1e-3, '새 자리로 걸어감');
  assert.equal(ch.state, 'seated');
});

test('비켜 서기가 길을 막지 않음: 꺾이는 점이 0.15 떨어진 두 사람(실측 교착) · 옆 자리에 선 사람 곁 도착 — 60fps 에서도 둘 다 도착', () => {
  const room = { id: 'r' };
  const mk = (id, pts) => {
    const c = new Character(id, { id, status: 'active' });
    Object.assign(c, { placed: true, room, state: 'walk', path: pts, pi: 1, target: { type: 'station', spot: pts[pts.length - 1], cat: 'skill' } });
    c.pos = { x: pts[0].x, z: pts[0].z };
    return c;
  };
  const a = mk('a', [{ x: -8.7, z: -6.65 }, { x: -8.7, z: -4.5 }, { x: -9.45, z: -4.5 }, { x: -9.45, z: -6.8 }]);
  const b = mk('b', [{ x: -11, z: -4.5 }, { x: -8.55, z: -4.5 }, { x: -8.55, z: -6.8 }]);
  const stand = mk('s', [{ x: -9.45, z: -7.7 }, { x: -9.45, z: -7.7 }]); stand.state = 'work'; // 접근점(대기 자리 0.9 앞)에 선 사람
  const ctx = { now: 0, dt: 1 / 60, ts: 1 };
  for (let i = 0; i < 60 * 8; i++) { ctx.now += ctx.dt; a._move(ctx); b._move(ctx); separate([a, b, stand], ctx.dt); }
  assert.equal(a.state, 'work'); assert.equal(b.state, 'work');
  assert.ok(dist(a.pos, { x: -9.45, z: -6.8 }) < 0.05 && dist(b.pos, { x: -8.55, z: -6.8 }) < 0.05, '둘 다 자기 자리');
});
