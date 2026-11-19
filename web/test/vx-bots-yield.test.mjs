// 도구 로봇 팀 보완 2 — 직원이 바퀴 로봇에게 길 비켜 주기(우선순위·막힘 상한) · 드론 층 나누기 · 옆 비킴 가구 한도
//   · 회의실 출발점(탁자 밖) · 넓은 몸 길 · 2D 먼 축소 점 표시
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotBook, BOT, avoidPlan, roverPrio } from '../voxel/vx-bot-core.mjs';
import { makeBotEnv, roverObstacles, roverPad, roverRoute, BOT_BODY, botRack } from '../voxel/vx-bot-place.mjs';
import { botYield, separate, YIELD } from '../voxel/crowd-core.mjs';
import { navClear, navSolid } from '../voxel/nav-core.mjs';
import { computeOffice } from '../voxel/layout.js';
import { Vx2DBots, FAR_S } from '../flat/vx2d-bots.js';

let ord = 0;
const N = (id, parentId, kind) => ({ id, parentId, kind, status: 'active', order: ord++ });
function office() {
  ord = 0;
  const L = [N('s:main', null, 'main')];
  for (let i = 0; i < 8; i++) L.push(N('a:' + i, 's:main', 'subagent'));
  L.push(N('w:1', 's:main', 'workflow'), N('a:w1', 'w:1', 'workflow-agent'), N('a:w2', 'w:1', 'workflow-agent'));
  return computeOffice(L, 's:main', null);
}
function fakeView(lay) {
  const chars = new Map();
  for (const [id, seat] of lay.seat) {
    const room = lay.rooms.find((r) => r.id === seat.roomId);
    chars.set(id, { id, room, seat, pos: { x: seat.x, z: seat.z }, state: 'work', placed: true, offstage: false });
  }
  return { chars, _now: 0, ts: 1, _layoutVer: 0 };
}
/** 걷는 직원 흉내(Character._move 의 걸음만 — yieldUntil 이면 멈춤) */
function walker(id, room, from, to) {
  return { id, room, pos: { ...from }, state: 'walk', placed: true, path: [{ ...from }, { ...to }], pi: 1, target: { type: 'station', spot: to } };
}
function walk(ch, now, dt, v = 3.5) {
  if (ch.state !== 'walk' || (ch.yieldUntil && now < ch.yieldUntil)) return;
  const q = ch.path[ch.pi], dx = q.x - ch.pos.x, dz = q.z - ch.pos.z, d = Math.hypot(dx, dz), st = v * dt;
  if (d <= st) { ch.pos.x = q.x; ch.pos.z = q.z; ch.state = 'work'; ch.path = null; } else { ch.pos.x += dx / d * st; ch.pos.z += dz / d * st; }
}

test('우선순위: 열린 호출을 들고 출동 중인 바퀴 로봇만 우선 · 우선 로봇은 비킴이 되면 멈춘 직원 곁을 지나감(모자라면 기다림)', () => {
  const b = { kind: 'rover', state: 'out', jobs: new Set(['t']) };
  assert.equal(roverPrio(b), true);
  assert.equal(roverPrio({ ...b, state: 'back' }), false);
  assert.equal(roverPrio({ ...b, jobs: new Set() }), false);
  const p = { x: 0, z: 0 };
  // 우선 로봇도 옆 비킴이 모자라면 멈춘 직원을 기다림(예전: 지나가며 스침) · 비킴이 되면 곁을 지나감
  assert.equal(avoidPlan(p, 0, 1, 0, [{ x: 0, z: 0.7, walking: true, yielding: true }], 'me', 0.45, null, true).wait, true, '우선이어도 정면(비킴 모자람) = 기다림');
  assert.equal(avoidPlan(p, 0, 1, 0, [{ x: -0.3, z: 0.7, walking: true, yielding: true }], 'me', 0.45, null, true).wait, false, '우선 = 비켜 지나감');
  assert.equal(avoidPlan(p, 0, 1, 0, [{ x: 0, z: 0.7, walking: false }], 'me', 0.45, null, true).wait, true, '서 있는 직원은 기다림');
  assert.equal(avoidPlan(p, 0, 1, 0, [{ x: 0, z: 0.7, walking: true }], 'me', 0.45, null, false).wait, true, '우선 아님 = 로봇이 기다림');
  // 좌우 한도가 다르면(가구 곁) 그 안에서만 비킴
  const pl = avoidPlan(p, 0, 1, 0, [{ x: 0, z: 0.7 }], 'me', { r: 0.1, l: 0.45 });
  assert.ok(pl.side >= -0.45 - 1e-9 && pl.side <= 0.1 + 1e-9);
});

test('직원 비켜 주기: 앞에 우선 로봇이 있으면 멈춤(적어도 MIN) · 우선 아닌 로봇·다른 방·뒤는 무시 · 오래 막히면 상한 뒤 걸음', () => {
  const room = { id: 'R' };
  const ch = walker('c', room, { x: 0, z: 0 }, { x: 0, z: 10 });
  const rv = { x: 0, z: 1.0, r: 0.42, roomId: 'R', prio: true };
  assert.equal(botYield([ch], [rv], 0, 1 / 60), 1);
  assert.ok(ch.yieldUntil >= YIELD.MIN - 1e-9, '적어도 MIN');
  const c2 = walker('d', room, { x: 0, z: 0 }, { x: 0, z: 10 });
  assert.equal(botYield([c2], [{ ...rv, prio: false }], 0, 1 / 60), 0, '우선 아님');
  assert.equal(botYield([c2], [{ ...rv, roomId: 'X' }], 0, 1 / 60), 0, '다른 방');
  assert.equal(botYield([c2], [{ ...rv, z: -1 }], 0, 1 / 60), 0, '뒤');
  assert.equal(botYield([c2], [{ ...rv, x: 1.2 }], 0, 1 / 60), 0, '옆으로 비켜 있음');
  // 로봇이 비키지 않고 계속 앞에 있으면: MAX 뒤 FREE 동안 걷는다(막힘 없음)
  let t = 0, stopped = 0;
  const c3 = walker('e', room, { x: 0, z: 0 }, { x: 0, z: 10 });
  for (; t < YIELD.MAX + YIELD.FREE - 0.1; t += 1 / 60) { const o = { ...rv, z: c3.pos.z + 1.0 }; botYield([c3], [o], t, 1 / 60); if (c3.yieldUntil > t) stopped += 1 / 60; walk(c3, t, 1 / 60); }
  assert.ok(stopped > YIELD.MAX - 0.1 && stopped < YIELD.MAX + 0.5, `멈춘 시간 ${stopped.toFixed(2)}`);
  assert.ok(c3.yieldOver >= 1 && c3.pos.z > 1, '상한 뒤 걸음');
});

test('마주 오는 직원과 바퀴 로봇(같은 통로): 우선 로봇 → 직원이 멈췄다 지나감 · 빈 출동(돌아옴) → 로봇이 기다림 · 둘 다 도착(교착 없음)', () => {
  for (const prioCase of [true, false]) {
    const room = { id: 'R' };
    const book = new BotBook();
    const b = book.start('n', 't', 'shell', 0, { roomId: 'R' });
    const ch = walker('c', room, { x: 9, z: 0.05 }, { x: 1, z: 0.05 });
    if (!prioCase) book.end('n', 't', true, 0); // 호출이 바로 끝남 → 로봇은 우선 아님(묶음 창 동안은 그대로 출동)
    const env = {
      pad: () => ({ x: 0, y: 0, z: 0 }), goal: () => ({ x: 10, y: 0, z: 0, yaw: Math.PI / 2 }), route: (bb, a, c) => [a, c],
      blockers: () => [{ x: ch.pos.x, z: ch.pos.z, r: 0.3, walking: ch.state === 'walk' }],
    };
    let t = 0, chStop = 0, minD = Infinity, arrivedR = null;
    const obs = [];
    for (; t < 10; t += 1 / 60) {
      roverObstacles(book, obs, t);
      separate([ch], 1 / 60, undefined, 1, null, obs);
      botYield([ch], obs, t, 1 / 60);
      if (ch.yieldUntil > t) chStop += 1 / 60;
      walk(ch, t, 1 / 60, 2.0);
      book.step(t, 1 / 60, 1, env);
      if (b.p && b.state === 'out') minD = Math.min(minD, Math.hypot(b.p.x - ch.pos.x, b.p.z - ch.pos.z));
      if (arrivedR == null && b.state === 'work') arrivedR = t;
      if (ch.state === 'work' && arrivedR != null) break;
    }
    assert.equal(ch.state, 'work', `직원 도착(${prioCase})`);
    assert.ok(arrivedR != null || !prioCase || b.state !== 'out', `로봇 도착(${prioCase})`);
    if (prioCase) { assert.ok(chStop > 0.2, `직원이 멈춤 ${chStop.toFixed(2)}`); }
    else assert.equal(chStop, 0, '빈 출동 로봇에게는 멈추지 않음');
    assert.ok(minD > 0.35, `가장 가까운 거리 ${minD.toFixed(2)}(${prioCase})`);
  }
});

test('드론 층 나누기: 같은 순항 고도로 엇갈리는 두 탐색 드론 → 열쇠 큰 쪽이 한 층 위 · 가장 가까운 3D 거리 확보 · 내려앉을 때 높이가 튀지 않음', () => {
  const book = new BotBook();
  const A = book.start('A', 'ta', 'read', 0, { roomId: 'R' }), B = book.start('B', 'tb', 'read', 0, { roomId: 'R' });
  const env = {
    pad: (b) => (b === A ? { x: 0, y: 1.0, z: 0 } : { x: 8, y: 1.0, z: 0.2 }),
    goal: (b) => (b === A ? { x: 8, y: 1.5, z: 1, yaw: 0 } : { x: 0, y: 1.5, z: -1, yaw: 0 }),
    route: (b, a, c) => { const L = BOT.CRUISE.scout; return [a, { x: a.x, y: L, z: a.z }, { x: c.x, y: L, z: c.z }, c]; },
  };
  let min3 = Infinity, maxJump = 0, lastY = { A: null, B: null };
  let t = 0;
  for (; t < 3; t += 1 / 60) {
    book.step(t, 1 / 60, 1, env);
    if (A.p && B.p && A.state === 'out' && B.state === 'out') min3 = Math.min(min3, Math.hypot(A.p.x - B.p.x, A.p.y - B.p.y, A.p.z - B.p.z));
    for (const [k, b] of [['A', A], ['B', B]]) { if (b.p && lastY[k] != null) maxJump = Math.max(maxJump, Math.abs(b.p.y - lastY[k])); lastY[k] = b.p ? b.p.y : null; }
  }
  book.end('A', 'ta', true, t); book.end('B', 'tb', true, t);
  for (const e = t + 6; t < e; t += 1 / 60) {
    book.step(t, 1 / 60, 1, env);
    for (const [k, b] of [['A', A], ['B', B]]) { if (b.p && lastY[k] != null && b.state !== 'gone') maxJump = Math.max(maxJump, Math.abs(b.p.y - lastY[k])); lastY[k] = b.p ? b.p.y : null; }
  }
  assert.ok(book.stats.lifts >= 1, '층 올림');
  assert.ok(min3 > 0.4, `가장 가까운 3D 거리 ${min3.toFixed(2)}`);
  assert.ok(maxJump < 0.2, `한 프레임 높이 변화 ${maxJump.toFixed(3)}`);
  assert.equal(book.size, 0, '둘 다 내려앉아 사라짐');
  assert.ok(!A.altY && !B.altY);
});

test('옆 비킴 가구 한도: 사무실 모든 책상의 바퀴 로봇이 길 위 직원을 비켜도 차체 가운데가 가구·벽과 BOT_BODY 가까이 이상', () => {
  const lay = office(), view = fakeView(lay);
  let tight = 0;
  for (const [id, ch] of [...view.chars]) {
    if (ch.room.type !== 'office' || !ch.seat || ch.seat.deskX == null) continue;
    const book = new BotBook(), env = makeBotEnv(view, book);
    const b = book.start(id, 't', 'shell', 0, { roomId: ch.room.id });
    if (!b) continue;
    // 길에서 한쪽이 가구에 가까운 구간을 골라, 그 구간 가운데 트인 쪽으로 0.15 비켜 직원을 세움 → 로봇은 가구 쪽으로 비키려 함
    env.beginFrame(); book.step(0, 1 / 60, 1, env);
    const r = botRack(ch.room), pts = env.route(b, env.pad(b), { x: r.ax, y: 0, z: r.az }, false);
    let pick = null;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], c = pts[i], L = Math.hypot(c.x - a.x, c.z - a.z);
      if (L < 3) continue;
      const m = { x: (a.x + c.x) / 2, z: (a.z + c.z) / 2 }, rx = -(c.z - a.z) / L, rz = (c.x - a.x) / L;
      const cr = navClear(ch.room, m.x + rx * 0.45, m.z + rz * 0.45), cl = navClear(ch.room, m.x - rx * 0.45, m.z - rz * 0.45);
      const tight = Math.min(cr, cl);
      if (!pick || tight < pick.tight) pick = { m, open: cr < cl ? { x: -rx, z: -rz } : { x: rx, z: rz }, tight };
    }
    if (pick && pick.tight < BOT_BODY) {
      tight++;
      view.chars.set('g', { id: 'g', room: ch.room, pos: { x: pick.m.x + pick.open.x * 0.15, z: pick.m.z + pick.open.z * 0.15 }, state: 'work', placed: true, offstage: false });
    }
    let minC = Infinity;
    for (let t = 1 / 60; t < 6; t += 1 / 60) {
      env.beginFrame(); book.step(t, 1 / 60, 1, env);
      if (b.p && b.state === 'out' && Math.abs(b.side) > 0.01) minC = Math.min(minC, navClear(ch.room, b.p.x, b.p.z));
      if (b.state === 'work') break;
    }
    view.chars.delete('g');
    if (minC < Infinity) assert.ok(minC >= BOT_BODY - 0.06, `${id}: 비킨 동안 가구와 ${minC.toFixed(2)}`);
    assert.equal(b.state, 'work', `${id} 도착`);
  }
  assert.ok(tight >= 1, `가구 곁 비킴 장면 ${tight}`); // 사무실 기본 배치: 랙 쪽 책상 줄 모서리(a:6) — 한도 없으면 가구와 0.19
});

test('회의실 바퀴 로봇: 출발점이 탁자 밖(직원 등 뒤) · 탁자를 돌아가지 않는 짧은 길 · 넓은 몸 길은 가구와 차체 반폭 이상', () => {
  const lay = office(), view = fakeView(lay);
  const meet = lay.rooms.find((r) => r.type === 'meeting');
  for (const [id, ch] of view.chars) {
    if (ch.room !== meet) continue;
    const p = roverPad(ch);
    assert.ok(!navSolid(meet, p.x, p.z) && navClear(meet, p.x, p.z) >= BOT_BODY, `${id} 출발점 빈 바닥`);
    const r = botRack(meet), pts = roverRoute(meet, p, { x: r.ax, y: 0, z: r.az });
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    const direct = Math.hypot(r.ax - p.x, r.az - p.z);
    assert.ok(L < direct * 1.5 + 1, `${id} 길 ${L.toFixed(1)} · 곧은 거리 ${direct.toFixed(1)}`);
    for (let i = 1; i < pts.length - 1; i++) assert.ok(navClear(meet, pts[i].x, pts[i].z) >= 0.36 - 1e-6, '꺾이는 점이 가구와 차체 반폭 이상');
    const book = new BotBook(), env = makeBotEnv(view, book);
    const b = book.start(id, 't', 'shell', 0, { roomId: meet.id });
    let t = 0;
    for (; t < 6 && b.state !== 'work'; t += 1 / 60) { env.beginFrame(); book.step(t, 1 / 60, 1, env); }
    assert.ok(t < BOT.LIFT + BOT.MAX_TRIP + 0.05, `${id} 도착 ${t.toFixed(2)}초`);
  }
});

test('2D 먼 축소(s < FAR_S): 로봇을 점으로 그림 — 색마다 fill 한 번(로봇 수에 비례하지 않음) · 책상 팔 생략', () => {
  const lay = office(), view = fakeView(lay);
  const calls = { fill: 0, rect: 0 };
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : typeof k === 'string' && /^[a-z]/.test(k) ? (...a) => { if (k in calls) calls[k]++; } : undefined), set: (o, k, v) => { o[k] = v; return true; } });
  Object.assign(view, {
    vis: new Map([...view.chars.keys()].map((id) => [id, { id, hidden: false, scopeK: 1, projA: 1 }])),
    tokens: { isLight: false, error: '#f00', ok: '#0f0', skill: '#ff0', stopped: '#888' },
    pal: { drone: '#ccc', rotor: '#888', metal: '#999', metalDark: '#333', forklift: '#e8a33a', hazard: '#e3b341', paper: '#fff', ledIdle: '#155', ledOff: '#111', deskTop: '#444', shoe: '#222' },
    reduced: false, _X: (x) => x * 0.8, _Y: (z) => z * 0.8,
  });
  const bots = new Vx2DBots(view);
  const ids = [...view.chars.keys()].filter((k) => view.chars.get(k).room.type === 'office');
  const cats = ['read', 'shell', 'web', 'write', 'search', 'read'];
  ids.slice(0, 6).forEach((id, i) => bots.start(id, { toolUseId: 'x' + i, cat: cats[i] }, false));
  for (let t = 0; t < 1.5; t += 1 / 30) { view._now = t; bots.step(t, 1 / 30); }
  bots.draw(ctx, 1.5, 0.8);
  assert.equal(bots.drawn, 0, '아래 층(캐릭터 위)에서는 그리지 않음');
  bots.drawTop(ctx, 1.5, 0.8);
  assert.ok(0.8 < FAR_S);
  assert.equal(bots.drawn, 5, '책상 팔 빼고 다섯');
  assert.equal(calls.rect, 5);
  assert.ok(calls.fill <= 4, `fill ${calls.fill}`);
  bots.drawTop(ctx, 1.5, 20); assert.equal(bots.drawn, 5, '가까우면 drawTop 은 아무것도 안 함(drawn 그대로)');
});

test('드론 층 나누기: 셋이 한 공역에서 겹치면 층 0·1·2 로 모두 다름(열쇠 순) · 마주 오는 빠른 드론은 가까워지기 전에 미리 층을 나눔', () => {
  const book = new BotBook();
  const ids = ['A', 'B', 'C'], bs = ids.map((id) => book.start(id, 't' + id, 'read', 0, { roomId: 'R' }));
  const env = {
    pad: (b) => ({ x: ids.indexOf(b.nodeId) * 0.1, y: 1.0, z: 0 }),
    goal: () => ({ x: 9, y: 1.5, z: 0, yaw: 0 }),
    route: (b, a, c) => { const L = BOT.CRUISE.scout; return [a, { x: a.x, y: L, z: a.z }, { x: c.x, y: L, z: c.z }, c]; },
  };
  let t = 0, seen = null;
  for (; t < 1.6; t += 1 / 60) { book.step(t, 1 / 60, 1, env); if (bs.every((b) => b.state === 'out' && b.p.y > 2.4)) seen = bs.map((b) => b._sepN); }
  assert.deepEqual(seen, [0, 1, 2]);
  // 마주 오는 둘: 가로 거리 R 안에 들어오기 전에 이미 층이 오르기 시작
  const bk = new BotBook();
  const P = bk.start('P', 'tp', 'read', 0, { roomId: 'R' }), Q = bk.start('Q', 'tq', 'read', 0, { roomId: 'R' });
  const e2 = {
    pad: (b) => (b === P ? { x: 0, y: 1, z: 0 } : { x: 14, y: 1, z: 0 }),
    goal: (b) => (b === P ? { x: 14, y: 1.5, z: 0.3, yaw: 0 } : { x: 0, y: 1.5, z: -0.3, yaw: 0 }),
    route: (b, a, c) => { const L = BOT.CRUISE.scout; return [a, { x: a.x, y: L, z: a.z }, { x: c.x, y: L, z: c.z }, c]; },
  };
  let liftAt = null, min3 = Infinity;
  for (t = 0; t < 3; t += 1 / 60) {
    bk.step(t, 1 / 60, 1, e2);
    if (P.p && Q.p && P.state === 'out' && Q.state === 'out') {
      const dh = Math.hypot(P.p.x - Q.p.x, P.p.z - Q.p.z);
      if (liftAt == null && (Q.alt || 0) > 0) liftAt = dh;
      min3 = Math.min(min3, Math.hypot(dh, P.p.y - Q.p.y));
    }
  }
  assert.ok(liftAt != null && liftAt > BOT.DRONE_SEP.R, `층을 올리기 시작한 가로 거리 ${liftAt}`);
  assert.ok(min3 > 0.35, `가장 가까운 3D 거리 ${min3.toFixed(2)}`);
});
