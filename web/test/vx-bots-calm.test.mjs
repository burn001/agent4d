// 도구 로봇 팀 보완 4 — 배치가 자라는 동안 격자 미룸(성능) · A* 힙·연결 덩어리 빠르게 · 막힘 풀기(다시 찾기·뒤로 비켜 서기)
//   · 앞 같은 줄 뒤에서 늦춤·가장 가까워지는 때 미리 보기 · 로봇 곁 밀림 한도 · 멈춘 로봇 뒤 직원 멈춤 · 책상 코앞에서 내려앉음
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotBook, BOT, avoidPlan } from '../voxel/vx-bot-core.mjs';
import { botRelayout, roverRoute, roverPad, botRack } from '../voxel/vx-bot-place.mjs';
import { botYield, separate } from '../voxel/crowd-core.mjs';
import { roomNav, navPath, navRoute, buildNav, botNavClock, botNavGen, BOT_NAV } from '../voxel/nav-core.mjs';
import { computeOffice } from '../voxel/layout.js';

let ord = 0;
const N = (id, parentId, kind) => ({ id, parentId, kind, status: 'active', order: ord++ });
function office(n = 8) {
  ord = 0;
  const L = [N('s:main', null, 'main')];
  for (let i = 0; i < n; i++) L.push(N('a:' + i, 's:main', 'subagent'));
  return computeOffice(L, 's:main', null);
}
function run(book, e, t0, sec, each = null, dt = 1 / 60) {
  let t = t0;
  for (; t < t0 + sec - 1e-9; t += dt) { book.step(t, dt, 1, e); if (each) each(t); }
  return t;
}

test('격자 미룸: 시계를 주면 배치가 바뀌어도 QUIET 동안 지난 바퀴 로봇 격자 · 잠잠해지면(또는 MAX) 다시 만들고 세대가 바뀜 · 시계 없으면 바로', () => {
  const room = office().rooms.find((r) => r.type === 'office');
  try {
    botNavClock(100);
    const w0 = roomNav(room, true), t0 = roomNav(room, 'tight'), g0 = botNavGen();
    room.navSig = 'grow-1';
    assert.equal(roomNav(room, true), w0, '바뀐 직후 = 지난 격자');
    assert.equal(w0.stale, true, '지난 격자 표시');
    botNavClock(100 + BOT_NAV.QUIET * 0.5); room.navSig = 'grow-2'; // 계속 바뀜
    assert.equal(roomNav(room, true), w0);
    botNavClock(100 + BOT_NAV.QUIET * 0.5 + BOT_NAV.QUIET + 0.01); // 잠잠해짐
    const w1 = roomNav(room, true);
    assert.notEqual(w1, w0, '잠잠해지면 다시 만듦'); assert.ok(!w1.stale);
    assert.ok(botNavGen() > g0, '세대가 바뀜(길 다시 찾기)');
    assert.notEqual(roomNav(room, 'tight'), t0, '좁은 통로 격자도');
    // 계속 바뀌어도 MAX 가 지나면 다시 만듦
    let T = 200; botNavClock(T); roomNav(room, true);
    let built = 0, last = roomNav(room, true);
    for (let i = 1; i <= 40; i++) { T += 0.25; botNavClock(T); room.navSig = 'g' + i; const w = roomNav(room, true); if (w !== last) { built++; last = w; } }
    assert.ok(built >= 2 && built <= 5, `10초 동안 0.25초마다 바뀜 → 다시 만든 수 ${built}`);
    botNavClock(null); room.navSig = 'now';
    assert.notEqual(roomNav(room, true), last, '시계 없음 = 바로 다시 만듦(시험·예전 동작)');
  } finally { botNavClock(null); room.navSig = ''; }
});

test('길 다시 찾기 미룸(botRelayout): 배치 판이 바뀌는 동안은 미루고 잠잠해지면 한 번 · 격자를 다시 만들면 바로', () => {
  let inv = 0;
  const book = { invalidate: () => inv++ }, st = {};
  for (let i = 0; i < 20; i++) botRelayout(st, book, i, i * 0.3); // 0.3초마다 바뀜(6초)
  assert.ok(inv <= 2, `바뀌는 동안 다시 찾기 ${inv}(MAX ${BOT_NAV.MAX}초마다)`);
  const before = inv;
  botRelayout(st, book, 19, 5.7 + BOT_NAV.QUIET + 0.2);
  assert.equal(inv, before + 1, '잠잠해지면 한 번');
  botRelayout(st, book, 19, 9);
  assert.equal(inv, before + 1, '그 뒤 그대로');
  // 격자 세대가 바뀌면 바로
  const room = office().rooms.find((r) => r.type === 'office');
  botNavClock(null); roomNav(room, true); room.navSig = 'x'; roomNav(room, true); room.navSig = '';
  botRelayout(st, book, 19, 9.1);
  assert.equal(inv, before + 2, '세대가 바뀌면 바로');
});

test('A* 힙·연결 덩어리(§159.9 빠르게): 막힌 격자에서 길·이어짐 판정이 맞음(같은 시작·끝은 같은 길)', () => {
  let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 12; t++) {
    const boxes = [];
    for (let i = 0; i < 80; i++) { const x = rnd() * 20, z = rnd() * 20; boxes.push({ minX: x, maxX: x + 0.3 + rnd() * 2, minZ: z, maxZ: z + 0.3 + rnd() * 2 }); }
    const nav = buildNav(boxes, { minX: 0, maxX: 20, minZ: 0, maxZ: 20 }, 0, 0, null, 0.38); nav.reach = true;
    const plain = buildNav(boxes, { minX: 0, maxX: 20, minZ: 0, maxZ: 20 }, 0, 0, null, 0.38); // reach 없음 = A* 전체 펼침으로 이어짐 판정
    for (let k = 0; k < 10; k++) {
      const a = { x: rnd() * 20, z: rnd() * 20 }, b = { x: rnd() * 20, z: rnd() * 20 };
      const p1 = navRoute(nav, a, b), p2 = navRoute(plain, a, b);
      assert.equal(!!p1, !!p2, '연결 덩어리 판정 = A* 판정');
      if (p1) assert.deepEqual(p1, p2, '같은 길');
    }
  }
});

test('막힘 풀기 다시 찾기: 원(사람)을 피한 차체 폭 길 — 원과 HALF 이상 · 끝점이 원 안이면 null', () => {
  const lay = office(), room = lay.rooms.find((r) => r.type === 'office'), r = botRack(room);
  const id = [...lay.seat.keys()].find((k) => k.startsWith('a:'));
  const seat = lay.seat.get(id), pad = roverPad({ room, seat });
  const base = roverRoute(room, pad, { x: r.ax, z: r.az });
  assert.ok(base.length >= 2);
  // 길 한가운데 점에 선 사람
  let L = 0; for (let i = 1; i < base.length; i++) L += Math.hypot(base[i].x - base[i - 1].x, base[i].z - base[i - 1].z);
  let acc = 0, mid = null;
  for (let i = 1; i < base.length && !mid; i++) { const d = Math.hypot(base[i].x - base[i - 1].x, base[i].z - base[i - 1].z); if (acc + d >= L / 2) { const u = (L / 2 - acc) / d; mid = { x: base[i - 1].x + (base[i].x - base[i - 1].x) * u, z: base[i - 1].z + (base[i].z - base[i - 1].z) * u }; } acc += d; }
  const disc = { x: mid.x, z: mid.z, r: 0.3 };
  const p = roverRoute(room, pad, { x: r.ax, z: r.az }, [disc]);
  if (p) { // 비켜 가는 길이 있는 배치면 원과 떨어짐
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
      for (let k = 0; k <= n; k++) { const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n; assert.ok(Math.hypot(x - disc.x, z - disc.z) >= BOT.AVOID.HALF, `원과 ${Math.hypot(x - disc.x, z - disc.z).toFixed(2)}`); }
    }
  }
  assert.equal(roverRoute(room, pad, { x: r.ax, z: r.az }, [{ x: r.ax, z: r.az, r: 0.3 }]), null, '끝점이 원 안');
  assert.equal(navPath(pad, { x: r.ax, z: r.az }, room, true, []) !== undefined, true);
});

test('막힘 풀기: 길 위에 선 직원 → 다시 찾은 길로 돌아감(겹쳐 지나감 0) · 가장 가까운 ≥ 0.5', () => {
  const book = new BotBook(), person = { x: 5, z: 0, r: 0.3 };
  const e = {
    pad: () => ({ x: 0, y: 0, z: 0 }), goal: () => ({ x: 10, y: 0, z: 0, yaw: Math.PI / 2 }),
    route: (b, a, c, back, avoid) => (avoid ? [a, { x: a.x, y: 0, z: 1.6 }, { x: c.x, y: 0, z: 1.6 }, c] : [a, c]),
    blockers: () => [person],
  };
  const b = book.start('n', 't', 'shell', 0);
  let minD = Infinity;
  run(book, e, 0, 8, () => { if (b.p && b.state === 'out') minD = Math.min(minD, Math.hypot(b.p.x - person.x, b.p.z - person.z)); });
  assert.equal(book.stats.detours, 1, '다시 찾기 1번'); assert.equal(book.stats.ghosts, 0); assert.equal(book.stats.backoffs, 0);
  assert.equal(b.state, 'work');
  assert.ok(minD >= 0.5, `가장 가까운 ${minD.toFixed(2)}`);
});

test('막힘 풀기: 다시 찾은 길이 사람을 비켜 가지 않으면 버림 → 뒤로 비켜 섬(뒤에 사람이 있으면 물러나지 않음)', () => {
  for (const behind of [false, true]) {
    const book = new BotBook(), person = { x: 5, z: 0, r: 0.3 }, back = { x: -9, z: 0, r: 0.3 };
    let waitX = null, minX = Infinity;
    const e = { pad: () => ({ x: 0, y: 0, z: 0 }), goal: () => ({ x: 10, y: 0, z: 0, yaw: Math.PI / 2 }), route: (b, a, c) => [a, c], blockers: () => (behind && waitX != null ? [person, back] : [person]) };
    const b = book.start('n', 't', 'shell', 0);
    run(book, e, 0, 4.5, () => { if (b.p && b.state === 'out') { if (b.waiting && waitX == null) { waitX = b.p.x; back.x = waitX - 0.9; } if (waitX != null) minX = Math.min(minX, b.p.x); } });
    assert.equal(book.stats.detours, 0, '비켜 가지 않는 길은 버림');
    assert.equal(book.stats.backoffs, 1, '뒤로 비켜 섬');
    if (!behind) assert.ok(waitX - minX > 0.5 && waitX - minX < BOT.AVOID.BACK_D + 0.1, `물러난 거리 ${(waitX - minX).toFixed(2)}`);
    else assert.ok(minX - back.x > 0.85, `뒤 사람과 ${(minX - back.x).toFixed(2)}(물러나지 않음)`);
  }
});

test('앞 같은 줄 뒤에서 늦춤 · 빠른 로봇(긴 길)도 걷는 직원 뒤에 붙지 않음(≥ 0.75)', () => {
  for (const L of [10, 60]) { // 60 = 남은 길 ÷ MAX_TRIP → 약 19 단위/초
    const book = new BotBook(), w = { x: 3, z: 0, r: 0.3, walking: true, vx: 1.5, vz: 0 };
    const e = { pad: () => ({ x: 0, y: 0, z: 0 }), goal: () => ({ x: L, y: 0, z: 0, yaw: 0 }), route: (b, a, c) => [a, c], blockers: () => [w] };
    const b = book.start('n', 't', 'shell', 0);
    let minD = Infinity;
    run(book, e, 0, 3, (t) => { w.x += w.vx / 60; if (b.p && b.state === 'out') minD = Math.min(minD, Math.hypot(b.p.x - w.x, b.p.z - w.z)); });
    assert.ok(minD >= 0.75, `길 ${L}: 가장 가까운 ${minD.toFixed(2)}`);
    assert.equal(book.stats.ghosts, 0);
  }
  // 계획: 앞 같은 줄 서 있는 사람 → 틈에 비례한 속도, 옆 줄이면 그대로
  assert.ok(avoidPlan({ x: 0, z: 0 }, 0, 1, 0, [{ x: 0, z: 2 }], 'me', 0.45).vcap < 5);
  assert.equal(avoidPlan({ x: 0, z: 0 }, 0, 1, 0, [{ x: 1.2, z: 2 }], 'me', 0.45).vcap, Infinity);
});

test('로봇 곁 밀림 한도: 로봇을 돌아 지나가던 직원이 한도(MAX_OFF)로 한 번에 끌려오지 않음', () => {
  const room = office().rooms.find((r) => r.type === 'office');
  const w = { id: 'w', room, pos: { x: 0, z: 0.85 }, state: 'walk', placed: true, path: [{ x: -3, z: 0 }, { x: 3, z: 0 }], pi: 1, target: { type: 'station', spot: { x: 3, z: 0 } } };
  const obs = [{ x: 0.2, z: 0, r: 0.42, roomId: room.id, moving: true }];
  const z0 = w.pos.z;
  separate([w], 1 / 60, undefined, 1, null, obs);
  assert.ok(w.pos.z >= z0 - 0.08, `한 프레임에 ${(z0 - w.pos.z).toFixed(2)} 끌려옴`);
});

test('멈춘 로봇 뒤에서 걸어오는 직원은 멈춤(로봇은 제 뒤 직원을 기다리지 않음 — 서로 막힘 없음) · 로봇 앞에서 오는 직원은 그대로', () => {
  const room = { id: 'R' };
  const mk = (x, tx) => ({ id: 'w' + x, room, pos: { x, z: 0 }, state: 'walk', placed: true, path: [{ x, z: 0 }, { x: tx, z: 0 }], pi: 1 });
  const o = { x: 0, z: 0, r: 0.42, roomId: 'R', prio: false, moving: true, fx: 1, fz: 0, ahead: false };
  const behind = mk(-1.0, 5), front = mk(1.0, -5);
  botYield([behind, front], [o], 1, 1 / 60);
  assert.ok(behind.yieldUntil > 1, '뒤에서 오는 직원 멈춤');
  assert.ok(!(front.yieldUntil > 1), '앞에서 오는 직원(로봇이 기다려 줌)은 그대로');
  const front2 = mk(1.0, -5);
  botYield([front2], [{ ...o, waiting: true }], 1, 1 / 60);
  assert.ok(!(front2.yieldUntil > 1), '멈춘 로봇 앞이어도 곁에 지나갈 틈이 있으면 그대로(좁은 통로에서만 멈춤)');
  // 로봇은 0.45 보다 뒤의 직원을 기다리지 않음
  assert.equal(avoidPlan({ x: 0, z: 0 }, 1, 0, 0, [{ x: -1.0, z: 0, walking: true, vx: 3.5, vz: 0 }], 'me', 0.45, null, false, 4.6).wait, false);
});

test('책상 코앞에서 막힘: 돌아가는 길 남은 거리 LAND_NEAR 안이면 그 자리에서 내려앉음(겹쳐 지나가지 않음, 순간 이동 없음)', () => {
  const book = new BotBook(), person = { x: 0.3, z: 0.9, r: 0.3 };
  let pad = { x: 0, y: 0, z: 0 };
  const e = { pad: () => pad, goal: () => ({ x: 0, y: 0, z: 4, yaw: 0 }), route: (b, a, c) => [a, c], blockers: () => (b.state === 'back' ? [person] : []) };
  const b = book.start('n', 't', 'shell', 0);
  book.end('n', 't', true, 0.1);
  let maxJump = 0, last = null;
  run(book, e, 0, 8, () => { if (b.p && last && (b.state === 'back' || b.state === 'land')) maxJump = Math.max(maxJump, Math.hypot(b.p.x - last.x, b.p.z - last.z)); if (b.p) last = { x: b.p.x, z: b.p.z }; });
  assert.ok(!book.size, '내려앉아 사라짐');
  assert.equal(book.stats.ghosts, 0);
  assert.ok(maxJump < 0.2, `한 프레임 이동 ${maxJump.toFixed(2)}`);
});
