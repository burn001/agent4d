// 도구 로봇 팀 보완 — 드론 순항 고도 · 바퀴 로봇 비켜 가기·기다리기 · 회의실 단말 함 · 2D 로봇(같은 장부)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotBook, BOT, flightPts, avoidPlan, makeSeg, segAt } from '../voxel/vx-bot-core.mjs';
import { botRack, makeBotEnv, deskOf } from '../voxel/vx-bot-place.mjs';
import { MEET_FX } from '../voxel/office-core.mjs';
import { roomObstacles, navSolid } from '../voxel/nav-core.mjs';
import { computeOffice } from '../voxel/layout.js';
import { Vx2DBots } from '../flat/vx2d-bots.js';

function run(book, e, t0, sec, k = 1, dt = 1 / 60, each = null) {
  let t = t0;
  for (; t < t0 + sec - 1e-9; t += dt) { book.step(t, dt, k, e); if (each) each(t); }
  return t;
}
let ord = 0;
const N = (id, parentId, kind, extra = {}) => ({ id, parentId, kind, status: 'active', order: ord++, ...extra });
function office() {
  ord = 0;
  const L = [N('s:main', null, 'main')];
  for (let i = 0; i < 8; i++) L.push(N('a:' + i, 's:main', 'subagent'));
  L.push(N('w:1', 's:main', 'workflow'), N('a:w1', 'w:1', 'workflow-agent'), N('a:w2', 'w:1', 'workflow-agent'));
  return computeOffice(L, 's:main', null);
}
/** 배치 → 가짜 view(chars: 자리에 선 Character 비슷한 것) */
function fakeView(lay) {
  const chars = new Map();
  for (const [id, seat] of lay.seat) {
    const room = lay.rooms.find((r) => r.id === seat.roomId);
    chars.set(id, { id, room, seat, pos: { x: seat.x, z: seat.z }, state: 'work', placed: true, offstage: false });
  }
  return { chars, _now: 0, ts: 1, _layoutVer: 0 };
}

test('비행 길: 오르고 → 순항 고도로 가로질러 → 목표 위에서 내려옴 · 이미 높으면 오르기 생략 · 짧으면 곧은 길', () => {
  const a = { x: 0, y: 1.47, z: 0 }, c = { x: 8, y: 1.55, z: 3 };
  const p = flightPts(a, c, BOT.CRUISE.scout);
  assert.equal(p.length, 4);
  assert.equal(p[1].y, BOT.CRUISE.scout); assert.equal(p[2].y, BOT.CRUISE.scout);
  assert.ok(Math.hypot(p[1].x - a.x, p[1].z - a.z) <= BOT.CLIMB_RUN + 1e-9, '가파르게 오름');
  assert.equal(flightPts({ x: 0, y: 3, z: 0 }, c, 2.45).length, 3, '이미 높으면 바로 가로질러 내려감');
  assert.equal(flightPts(a, { x: 0.3, y: 1, z: 0 }, 2.45).length, 2);
  assert.equal(makeSeg(p, 'scout', 0).arc, 0, '고도 길에는 호 없음');
});

test('탐색 드론: 가는 길 가운데(양 끝 오르내림 밖)는 늘 순항 고도 — 직원(1.8)·서가(2.0) 위', () => {
  const lay = office(), view = fakeView(lay), book = new BotBook(), env = makeBotEnv(view, book);
  const id = [...view.chars.keys()].find((k) => view.chars.get(k).seat.kind === 'grid');
  const ch = view.chars.get(id);
  book.start(id, 't', 'read', 0, { roomId: ch.room.id });
  const b = book.bots.get(id + '|scout');
  let minMid = Infinity, sawOut = false;
  const g = env.goal(b);
  run(book, env, 0, 4, 1, 1 / 60, () => {
    if (b.state !== 'out' || !b.seg) return;
    sawOut = true;
    const pad = env.pad(b);
    const dPad = Math.hypot(b.p.x - pad.x, b.p.z - pad.z), dGoal = Math.hypot(b.p.x - g.x, b.p.z - g.z);
    if (dPad > BOT.CLIMB_RUN + 0.05 && dGoal > BOT.CLIMB_RUN + 0.05) minMid = Math.min(minMid, b.p.y);
  });
  assert.ok(sawOut);
  assert.ok(minMid >= BOT.CRUISE.scout - 1e-6, `가운데 최저 높이 ${minMid}`);
  assert.ok(BOT.CRUISE.scout > 2.0 + 0.3 && BOT.CRUISE.recon >= BOT.CRUISE.scout);
});

test('비켜 가기 계획: 정면이면 비켜도 모자라 기다림 · 옆으로 조금 비켜 있으면 비켜 지나감 · 뒤·멀리는 무시', () => {
  const p = { x: 0, z: 0 };
  const front = avoidPlan(p, 0, 1, 0, [{ x: 0, z: 0.7 }], 'me');
  assert.equal(front.wait, true); assert.ok(front.side > 0, '가운데면 오른쪽(+)으로');
  const off = avoidPlan(p, 0, 1, 0, [{ x: -0.3, z: 0.7 }], 'me'); // 오른쪽 = (−fz, fx) = (−1, 0) 방향 → lat +0.3
  assert.equal(off.wait, false); assert.ok(off.side < 0 && off.side >= -BOT.AVOID.SIDE, '반대쪽으로 비킴');
  assert.equal(avoidPlan(p, 0, 1, 0, [{ x: 0, z: -0.5 }], 'me').wait, false, '뒤');
  assert.equal(avoidPlan(p, 0, 1, 0, [{ x: 0, z: 3 }], 'me').wait, false, '멀리');
  // 움직이는 다른 바퀴 로봇: 열쇠가 작은 쪽만 기다림(서로 기다리는 막힘 없음)
  assert.equal(avoidPlan(p, 0, 1, 0, [{ x: 0, z: 0.7, bot: true, moving: true, key: 'b' }], 'a').wait, false);
  assert.equal(avoidPlan(p, 0, 1, 0, [{ x: 0, z: 0.7, bot: true, moving: true, key: 'a' }], 'b').wait, true);
});

/** 바퀴 로봇 하나: (0,0) → (10,0) 곧은 길, 장애 목록 고정 */
function roverEnv(list) {
  return { pad: () => ({ x: 0, y: 0, z: 0 }), goal: () => ({ x: 10, y: 0, z: 0, yaw: Math.PI / 2 }), route: (b, a, c) => [a, c], blockers: () => list };
}
test('바퀴 로봇: 길 위에 선 직원 앞에서 멈춰 기다리고, 오래 막히면 뒤로 비켜 섰다가(§159.9) 그래도 막히면 잠깐 겹쳐 지나감(막힘 없음)', () => {
  const book = new BotBook(), person = { x: 5, z: 0, r: 0.3 }, e = roverEnv([person]);
  const b = book.start('n', 't', 'shell', 0);
  let minD = Infinity, waited = 0;
  run(book, e, 0, 9, 1, 1 / 60, () => { if (b.p && (b.state === 'out')) { minD = Math.min(minD, Math.hypot(b.p.x - person.x, b.p.z - person.z)); if (b.waiting) waited += 1 / 60; } });
  assert.ok(book.stats.waits >= 1, '기다림'); assert.ok(waited > 0.5, `기다린 시간 ${waited.toFixed(2)}`);
  assert.equal(book.stats.backoffs, 1, '먼저 뒤로 비켜 섬 1번(길 다시 찾기는 이 env 가 비켜 가는 길을 못 줌)');
  assert.equal(book.stats.ghosts, 1, '막히면 겹쳐 지나감 1번');
  assert.ok(b.state === 'work' || b.state === 'back' || !book.bots.size, '결국 도착');
});
test('바퀴 로봇: 길 옆에 비켜 선 직원은 옆으로 비켜 멈추지 않고 지나감 · 옆 간격 유지', () => {
  const book = new BotBook(), person = { x: 5, z: 0.3, r: 0.3 }, e = roverEnv([person]);
  const b = book.start('n', 't', 'shell', 0);
  let minD = Infinity, maxSide = 0;
  run(book, e, 0, 4, 1, 1 / 60, () => { if (b.p && b.state === 'out') { minD = Math.min(minD, Math.hypot(b.p.x - person.x, b.p.z - person.z)); maxSide = Math.max(maxSide, Math.abs(b.side)); } });
  assert.equal(book.stats.waits, 0); assert.equal(book.stats.ghosts, 0);
  assert.ok(maxSide > 0.1, '비킴');
  assert.ok(minD >= BOT.AVOID.HALF - 0.08, `가장 가까운 거리 ${minD.toFixed(2)}`);
  assert.equal(b.state, 'work'); assert.equal(b.side, 0, '도착하면 비킴 0');
});
test('바퀴 로봇 둘이 마주 오면 서로 오른쪽으로 비켜 스침(겹치지 않고 둘 다 도착)', () => {
  const book = new BotBook();
  const A = book.start('A', 'ta', 'shell', 0, { roomId: 'R' }), B = book.start('B', 'tb', 'shell', 0, { roomId: 'R' });
  const env = {
    pad: (b) => (b === A ? { x: 0, y: 0, z: 0 } : { x: 10, y: 0, z: 0 }),
    goal: (b) => (b === A ? { x: 10, y: 0, z: 0, yaw: 0 } : { x: 0, y: 0, z: 0, yaw: 0 }),
    route: (b, a, c) => [a, c],
    blockers: (b) => { const o = b === A ? B : A; return o.p ? [{ x: o.p.x, z: o.p.z, r: 0.42, key: o.key, bot: true, moving: o.state === 'out' || o.state === 'back' }] : []; },
  };
  let minD = Infinity;
  run(book, env, 0, 6, 1, 1 / 60, () => { if (A.p && B.p && A.state === 'out' && B.state === 'out') minD = Math.min(minD, Math.hypot(A.p.x - B.p.x, A.p.z - B.p.z)); });
  assert.equal(A.state, 'work'); assert.equal(B.state, 'work');
  assert.ok(minD > 0.7, `최소 간격 ${minD.toFixed(2)}`);
});

test('회의실: 단말 함(뒤 벽) 장애물 · 바퀴 로봇 목표는 단말 함 앞 빈 바닥 · 점등 자리(units·화면)', () => {
  const lay = office();
  const meet = lay.rooms.find((r) => r.type === 'meeting');
  assert.ok(meet, '회의실');
  const obs = roomObstacles(meet).filter((o) => o.kind === 'terminal');
  assert.equal(obs.length, 1);
  const r = botRack(meet);
  assert.ok(r.meet && r.screen && r.units === MEET_FX.term.units);
  assert.ok(Math.abs((obs[0].minX + obs[0].maxX) / 2 - r.x) < 1e-9);
  assert.ok(r.az > obs[0].maxZ && !navSolid(meet, r.ax, r.az), '접근점 = 단말 함 앞 빈 바닥');
  const sh = meet.stations.shell; // 2D 시설 칸(터미널)도 같은 뒤 벽 자리
  assert.ok(sh.every((p) => Math.abs(p.z - r.az) < 0.25 && Math.abs(p.x - r.x) < 0.5), '셸 작업 자리 = 단말 함 앞');
  const off = lay.rooms.find((x) => x.type === 'office');
  const ro = botRack(off);
  assert.ok(!ro.meet && !ro.screen && ro.units === 6);
  // 회의실 직원의 바퀴 로봇이 단말 함 앞까지 길찾기
  const view = fakeView(lay), book = new BotBook(), env = makeBotEnv(view, book);
  const id = [...view.chars.keys()].find((k) => view.chars.get(k).room.type === 'meeting');
  assert.ok(id, '회의실 직원');
  const b = book.start(id, 't', 'shell', 0, { roomId: view.chars.get(id).room.id });
  run(book, env, 0, 5);
  assert.equal(b.state, 'work');
  assert.ok(Math.hypot(b.p.x - r.ax, b.p.z - r.az) < 1e-6);
});

test('2D: 같은 장부로 로봇을 그림(드론·바퀴·팔 + 랙 점등) — 위에서 본 도형', () => {
  const lay = office(), view = fakeView(lay);
  const calls = { n: 0 };
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : typeof k === 'string' && /^[a-z]/.test(k) ? (...a) => { calls.n++; } : undefined), set: (o, k, v) => { o[k] = v; return true; } });
  Object.assign(view, {
    vis: new Map([...view.chars.keys()].map((id) => [id, { id, hidden: false, scopeK: 1, projA: 1 }])),
    tokens: { isLight: false, error: '#f00', ok: '#0f0', skill: '#ff0', stopped: '#888' },
    pal: { drone: '#ccc', rotor: '#888', metal: '#999', metalDark: '#333', forklift: '#e8a33a', hazard: '#e3b341', paper: '#fff', ledIdle: '#155', ledOff: '#111', deskTop: '#444', shoe: '#222' },
    reduced: false, _X: (x) => x * 10, _Y: (z) => z * 10,
  });
  const bots = new Vx2DBots(view);
  const ids = [...view.chars.keys()].filter((k) => view.chars.get(k).room.type === 'office' && deskOf(view.chars.get(k)));
  const cats = ['read', 'shell', 'web', 'write'];
  ids.slice(0, 4).forEach((id, i) => { view._now = 0; bots.start(id, { toolUseId: 'x' + i, cat: cats[i] }, false); });
  assert.equal(bots.book.size, 4);
  let t = 0;
  for (; t < 4; t += 1 / 30) { view._now = t; bots.step(t, 1 / 30); }
  assert.equal(bots.animating(), 2);
  bots.draw(ctx, t, 20);
  assert.equal(bots.drawn, 4); assert.ok(calls.n > 40, '도형 그리기');
  const rover = bots.book.bots.get(ids[1] + '|rover');
  assert.equal(rover.state, 'work');
  bots.clear(); assert.equal(bots.book.size, 0); assert.equal(bots.animating(), 0);
});

test('바퀴 로봇: 도착점 곁(책상 옆 발사대·랙 앞)에 선 직원은 장애로 보지 않음 — 옆자리 직원 때문에 멈추지 않음', () => {
  const book = new BotBook(), person = { x: 10.6, z: 0.1, r: 0.3 }, e = roverEnv([person]);
  const b = book.start('n', 't', 'shell', 0);
  run(book, e, 0, 4);
  assert.equal(book.stats.waits, 0); assert.equal(b.state, 'work');
  assert.equal(avoidPlan({ x: 9.9, z: 0 }, 1, 0, 0, [person], 'me', 0.45, { x: 10, z: 0 }).wait, false);
  assert.equal(avoidPlan({ x: 9.9, z: 0 }, 1, 0, 0, [person], 'me', 0.45, null).wait, true);
});

test('자리가 아직 없는 직원의 열린 호출(스냅샷)은 기다렸다가 자리가 생기면 바로 작업 자리에 · 끝나면 버림', async () => {
  const { BotPending, botStart } = await import('../voxel/vx-bot-place.mjs');
  const lay = office(), view = fakeView(lay), book = new BotBook(), pend = new BotPending();
  const id = [...view.chars.keys()].find((k) => view.chars.get(k).seat.kind === 'grid');
  const ch = view.chars.get(id), seat = ch.seat;
  ch.seat = null;
  const ev = { toolUseId: 'r1', cat: 'read' };
  assert.equal(botStart(book, view, id, ev, true), null);
  pend.add(id, ev, true, 0); pend.add(id, { toolUseId: 'x', cat: 'agent' }, true, 0);
  assert.equal(pend.size, 1, '로봇 없는 종류는 기다리지 않음');
  pend.step(book, view, 0.5); assert.equal(book.size, 0);
  ch.seat = seat;
  pend.step(book, view, 1);
  assert.equal(book.size, 1); assert.equal(pend.size, 0);
  const b = book.bots.get(id + '|scout');
  assert.equal(b.state, 'work', '바로 작업 자리');
  pend.add(id, { toolUseId: 'r2', cat: 'shell' }, true, 2); pend.drop('r2'); assert.equal(pend.size, 0);
  pend.add(id, { toolUseId: 'r3', cat: 'shell' }, true, 2); pend.step(book, { chars: new Map() }, 2 + BotPending.PEND_S + 1); assert.equal(pend.size, 0, '오래 기다리면 버림');
});
