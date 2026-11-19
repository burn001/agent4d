// 복셀 오피스 도구 로봇 팀 — 배차·묶음·상태 전이(순수 장부 vx-bot-core.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotBook, BOT, botKind, botSpeedK, makeSeg, segAt, turn } from '../voxel/vx-bot-core.mjs';
import { OFFICE_FX } from '../voxel/office-core.mjs';
import { roomObstacles } from '../voxel/nav-core.mjs';
import { computeOffice } from '../voxel/layout.js';

// 책상(0,0,0) → 목표(10, 1.4, 0) 일직선 환경
const env = (goal = { x: 10, y: 1.4, z: 0, yaw: 0 }, pad = { x: 0, y: 1, z: 0 }) => ({
  pad: () => pad, goal: () => goal, route: (b, a, c) => [a, c],
});
function run(book, e, t0, sec, k = 1, dt = 1 / 60) {
  let t = t0;
  for (; t < t0 + sec - 1e-9; t += dt) book.step(t, dt, k, e);
  return t;
}

test('도구 종류 → 로봇: read·search 탐색 드론 · shell 바퀴 · web 정찰 · write·edit 팔 · 그 밖 없음', () => {
  assert.equal(botKind('read'), 'scout'); assert.equal(botKind('search'), 'scout');
  assert.equal(botKind('shell'), 'rover'); assert.equal(botKind('web'), 'recon');
  assert.equal(botKind('write'), 'arm'); assert.equal(botKind('edit'), 'arm');
  for (const c of ['agent', 'workflow', 'skill', 'mcp', 'monitor', 'artifact', 'notify', 'other', undefined]) assert.equal(botKind(c), null, String(c));
  assert.equal(botSpeedK(1), 1); assert.equal(botSpeedK(0.5), 1); assert.equal(botSpeedK(16), 4); assert.equal(botSpeedK(32), BOT.K_MAX);
});

test('출동 → 도착 → 작업 → 끝 + 묶음 창 → 복귀 → 착륙 → 사라짐', () => {
  const book = new BotBook(), e = env();
  const b = book.start('n1', 't1', 'read', 0);
  assert.equal(b.state, 'launch');
  let t = run(book, e, 0, 0.4);
  assert.equal(b.state, 'out');
  t = run(book, e, t, 2.0);
  assert.equal(b.state, 'work'); assert.ok(Math.abs(b.p.x - 10) < 1e-6 && Math.abs(b.p.y - 1.4) < 1e-6);
  book.end('n1', 't1', true, t);
  t = run(book, e, t, BOT.HOLD * 0.5);
  assert.equal(b.state, 'work', '묶음 창 안에서는 기다림');
  t = run(book, e, t, BOT.HOLD);
  assert.equal(b.state, 'back');
  t = run(book, e, t, 3.5);
  assert.ok(!book.bots.has('n1|scout'), '착륙 뒤 사라짐');
  assert.equal(book.byTool.size, 0);
});

test('묶음: 출동 중 같은 종류 호출은 같은 로봇이 이어받음 · 돌아오던 로봇은 다시 돌아섬', () => {
  const book = new BotBook(), e = env();
  const b = book.start('n1', 'a', 'read', 0);
  let t = run(book, e, 0, 0.6);
  // 수백 ms 간격 연속 호출
  for (let i = 0; i < 6; i++) { book.start('n1', 'r' + i, i % 2 ? 'search' : 'read', t); t = run(book, e, t, 0.05); book.end('n1', 'r' + i, true, t); t = run(book, e, t, 0.25); }
  assert.equal(book.size, 1, '로봇 하나'); assert.equal(book.stats.started, 1); assert.equal(book.stats.joined, 6);
  assert.equal(b.calls, 7);
  book.end('n1', 'a', true, t);
  t = run(book, e, t, 5);
  // 다시 출동 → 돌아오는 중에 새 호출
  const c = book.start('n2', 'x', 'shell', t);
  t = run(book, e, t, 0.4 + 2.0);
  book.end('n2', 'x', true, t);
  t = run(book, e, t, BOT.HOLD + BOT.MIN_WORK + 0.2);
  assert.equal(c.state, 'back');
  book.start('n2', 'y', 'shell', t);
  assert.equal(c.state, 'out', '돌아오던 로봇이 다시 목표로');
  assert.equal(book.size, 1);
});

test('짧은 호출: 가는 길 초반에 끝나면 중간에 돌아섬 · 늦게 끝나면 도착해 최소 작업 뒤 복귀', () => {
  // 먼 목표(길이 30 → 상한 MAX_TRIP 초)
  const book = new BotBook(), far = env({ x: 30, y: 1, z: 0, yaw: 0 });
  const b = book.start('n', 't', 'read', 0);
  book.end('n', 't', true, 0.1); // 0.1초 호출
  run(book, far, 0, 0.32 + 0.7);
  assert.equal(b.state, 'back', '중간에 돌아섬'); assert.equal(book.stats.turned, 1);
  assert.ok(b.p.x > 0 && b.p.x < 30 * BOT.TURN_BACK);
  // 가까운 목표: 짧은 호출이어도 도착해 MIN_WORK 동안 작업
  const book2 = new BotBook(), near = env({ x: 4, y: 1.4, z: 0, yaw: 0 });
  const c = book2.start('n', 't', 'read', 0);
  book2.end('n', 't', true, 0.1);
  let t = 0, sawWork = false;
  for (; t < 4; t += 1 / 60) { book2.step(t, 1 / 60, 1, near); if (c.state === 'work') sawWork = true; }
  assert.ok(sawWork, '도착해 작업'); assert.equal(book2.stats.turned, 0);
});

test('목표 바꿈: 작업 중 read → search 면 새 목표로 옮겨 감', () => {
  const book = new BotBook();
  let goal = { x: 5, y: 1.4, z: 0, yaw: 0 };
  const e = { pad: () => ({ x: 0, y: 1, z: 0 }), goal: (b) => (b.cat === 'search' ? { x: 5, y: 1.0, z: 4, yaw: 0 } : goal), route: (b, a, c) => [a, c] };
  const b = book.start('n', 'r', 'read', 0);
  let t = run(book, e, 0, 2.2);
  assert.equal(b.state, 'work');
  book.start('n', 's', 'search', t);
  t = run(book, e, t, 1 / 60 * 2);
  assert.equal(b.state, 'out');
  t = run(book, e, t, 2);
  assert.equal(b.state, 'work'); assert.ok(Math.abs(b.p.z - 4) < 1e-6);
});

test('상한: 방마다 종류별 · 전체 · 넘으면 출동 없음', () => {
  const book = new BotBook();
  for (let i = 0; i < BOT.CAP_ROOM.rover + 2; i++) book.start('n' + i, 't' + i, 'shell', 0, { roomId: 'R' });
  assert.equal(book.size, BOT.CAP_ROOM.rover); assert.equal(book.stats.refused, 2);
  assert.ok(book.start('m', 'u', 'shell', 0, { roomId: 'R2' }), '다른 방은 따로');
  const big = new BotBook();
  for (let i = 0; i < BOT.CAP + 5; i++) big.start('n' + i, 't' + i, 'write', 0, { roomId: 'R' + i });
  assert.equal(big.size, BOT.CAP);
  // 끝난 도구 이름(장부에 없는 id)은 무시
  assert.equal(big.end('n0', 'nope', true, 0), null);
});

test('책상 팔: 펼침 → 작업 → 접힘, 접히는 중 새 호출이면 다시 펼침 · 일시정지(걸음 없음)면 그대로', () => {
  const book = new BotBook(), e = env();
  const a = book.start('n', 'w', 'write', 0);
  assert.equal(a.state, 'open');
  let t = run(book, e, 0, BOT.ARM_OPEN + 0.05);
  assert.equal(a.state, 'work'); assert.equal(a.open, 1);
  const frozen = JSON.stringify({ s: a.state, o: a.open });
  assert.equal(JSON.stringify({ s: a.state, o: a.open }), frozen);
  book.end('n', 'w', true, t);
  t = run(book, e, t, BOT.HOLD + 0.05);
  assert.equal(a.state, 'close');
  t = run(book, e, t, 0.1);
  assert.ok(a.open < 1 && a.open > 0);
  book.start('n', 'e', 'edit', t);
  assert.equal(a.state, 'open'); assert.equal(a.cat, 'edit');
  book.end('n', 'e', false, t + 0.1);
  assert.equal(a.ok, false); assert.equal(a.errAt, t + 0.1);
});

test('배속: k 배로 빨리 움직이고 묶음 창도 짧아짐 · 조용한 시작(스냅샷)은 바로 작업 자리', () => {
  const book = new BotBook(), e = env();
  const b = book.start('n', 't', 'read', 0);
  run(book, e, 0, (0.32 + 1.6) / 4 + 0.05, 4);
  assert.equal(b.state, 'work');
  const q = new BotBook();
  const s = q.start('n', 't', 'web', 0, { quiet: true });
  q.step(0, 1 / 60, 1, e);
  assert.equal(s.state, 'work'); assert.ok(Math.abs(s.p.x - 10) < 1e-6);
});

test('노드가 사라짐: 열린 호출을 버리고 복귀 · 책상이 없어지면 작아지며 사라짐 · endAll', () => {
  const book = new BotBook();
  let pad = { x: 0, y: 1, z: 0 };
  const e = { pad: () => pad, goal: () => ({ x: 6, y: 1.4, z: 0, yaw: 0 }), route: (b, a, c) => [a, c] };
  const b = book.start('n', 't', 'read', 0);
  let t = run(book, e, 0, 2);
  book.dropNode('n', t);
  assert.equal(book.byTool.size, 0);
  t = run(book, e, t, BOT.MIN_WORK + 0.1);
  assert.equal(b.state, 'back');
  pad = null;
  t = run(book, e, t, 0.05);
  assert.equal(b.state, 'vanish');
  t = run(book, e, t, BOT.VANISH + 0.1);
  assert.equal(book.size, 0);
  const c = new BotBook();
  c.start('m', 'a', 'shell', 0); c.start('m', 'b', 'shell', 0);
  c.endAll('m', 1);
  assert.equal(c.byTool.size, 0); assert.equal([...c.bots.values()][0].jobs.size, 0);
});

test('구간: 길이·시간 하한/상한·호 높이 · 각도 돌리기', () => {
  const s = makeSeg([{ x: 0, y: 1, z: 0 }, { x: 3, y: 1, z: 4 }], 'scout', 0);
  assert.equal(s.len, 5); assert.ok(s.dur >= BOT.MIN_TRIP && s.dur <= BOT.MAX_TRIP);
  const m = segAt(s, 0.5);
  assert.ok(Math.abs(m.x - 1.5) < 1e-9 && Math.abs(m.y - (1 + BOT.ARC.scout)) < 1e-9);
  const r = makeSeg([{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }], 'rover', 0);
  assert.equal(r.arc, 0); assert.deepEqual([segAt(r, 0.75).x, segAt(r, 0.75).z], [2, 1]);
  assert.ok(makeSeg([{ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }], 'rover', 0).dur === BOT.MAX_TRIP);
  assert.ok(Math.abs(turn(3, -3, 10) + 3) < 1e-9);
  assert.ok(Math.abs(turn(0, 1, 0.25) - 0.25) < 1e-9);
});

test('서버랙: 사무실 뒤 오른쪽 구석 길찾기 장애물(예전 큰 화분 자리) — 책상·랙 줄과 겹치지 않음', () => {
  const nodes = [{ id: 'm', kind: 'main', status: 'active', order: 0 }];
  for (let i = 0; i < 3; i++) nodes.push({ id: 'a' + i, parentId: 'm', kind: 'subagent', status: 'active', order: i + 1 });
  const lay = computeOffice(nodes, 'm');
  const room = lay.rooms.find((r) => r.type === 'office');
  const obs = roomObstacles(room);
  const rack = obs.filter((o) => o.kind === 'serverRack');
  assert.equal(rack.length, 1);
  const R = OFFICE_FX.rack, o = room.origin;
  assert.ok(Math.abs((rack[0].minX + rack[0].maxX) / 2 - (o.x + R.x)) < 1e-9);
  assert.ok(rack[0].maxX < o.x + 12 && rack[0].minZ > o.z - 9, '방 안');
  for (const b of obs) if (b.kind === 'desk' || b.kind === 'leadDesk' || b.kind === 'monitorWall') {
    const hit = !(b.maxX <= rack[0].minX || b.minX >= rack[0].maxX || b.maxZ <= rack[0].minZ || b.minZ >= rack[0].maxZ);
    assert.ok(!hit, b.kind);
  }
});

test('작업 자리 번호: 같은 방·같은 종류 로봇은 서로 다른 번호, 빈 번호를 다시 씀', () => {
  const book = new BotBook(), e = env();
  const a = book.start('n1', 't1', 'shell', 0, { roomId: 'R' });
  const b = book.start('n2', 't2', 'shell', 0, { roomId: 'R' });
  const c = book.start('n3', 't3', 'read', 0, { roomId: 'R' });
  assert.deepEqual([a.slot, b.slot, c.slot], [0, 1, 0]);
  book.end('n1', 't1', true, 0);
  run(book, e, 0, 12);
  assert.ok(!book.bots.has('n1|rover'));
  book.end('n2', 't2', true, 12); book.start('n4', 't4', 'shell', 12, { roomId: 'R' });
  assert.equal(book.bots.get('n4|rover').slot, 0, '비운 0번을 다시 씀');
});
