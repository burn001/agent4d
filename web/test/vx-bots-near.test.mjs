// 도구 로봇 팀 보완 3 — 도착점 곁 스침 막기 · 좁은 통로(차체 폭 길이 없는 큰 사무실) · 드론 층이 모자랄 때 옆 비킴·호버
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotBook, BOT, avoidPlan } from '../voxel/vx-bot-core.mjs';
import { makeBotEnv, roverObstacles, botRack, roverPad, roverRoute, roverGoal, roverCanGo, BOT_BODY } from '../voxel/vx-bot-place.mjs';
import { botYield, separate } from '../voxel/crowd-core.mjs';
import { navPath, navClear, navReach } from '../voxel/nav-core.mjs';
import { computeOffice } from '../voxel/layout.js';

let ord = 0;
const N = (id, parentId, kind) => ({ id, parentId, kind, status: 'active', order: ord++ });
function office() {
  ord = 0;
  const L = [N('s:main', null, 'main')];
  for (let i = 0; i < 8; i++) L.push(N('a:' + i, 's:main', 'subagent'));
  return computeOffice(L, 's:main', null);
}
function fakeView(lay) {
  const chars = new Map();
  for (const [id, seat] of lay.seat) {
    const room = lay.rooms.find((r) => r.id === seat.roomId);
    chars.set(id, { id, room, seat, pos: { x: seat.x, z: seat.z }, state: 'work', placed: true, offstage: false, target: { type: 'desk' } });
  }
  return { chars, _now: 0, ts: 1, _layoutVer: 0 };
}
/** 걷는 직원 흉내(Character._move 의 걸음 — yieldUntil 이면 멈춤, 꺾은선 따라) */
function walk(ch, now, dt, v = 3.5) {
  if (ch.state !== 'walk' || (ch.yieldUntil && now < ch.yieldUntil)) return;
  const q = ch.path[ch.pi], dx = q.x - ch.pos.x, dz = q.z - ch.pos.z, d = Math.hypot(dx, dz), st = v * dt;
  if (d <= st) { ch.pos.x = q.x; ch.pos.z = q.z; if (ch.pi < ch.path.length - 1) ch.pi++; else { ch.state = 'work'; ch.path = null; } }
  else { ch.pos.x += dx / d * st; ch.pos.z += dz / d * st; }
}
/** 바퀴 로봇(id 책상 → 랙) 과 직원(from → to, 로봇이 meet 에 가장 가까울 때 + off 초에 그 자리에 오게) — 가장 가까운 간격·겹쳐 지나감 수 */
function encounter(id, mk, off) {
  const lay = office();
  const dry = fakeView(lay), ch0 = dry.chars.get(id), room = ch0.room, r = botRack(room);
  const { from, to, meet } = mk(r, roverPad(ch0));
  let tMeet = 0;
  { const bk = new BotBook(), e = makeBotEnv(dry, bk); const b = bk.start(id, 't', 'shell', 0, { roomId: room.id }); let best = Infinity;
    for (let t = 0; t < 8 && b.state !== 'work'; t += 1 / 60) { dry._now = t; e.beginFrame(); bk.step(t, 1 / 60, 1, e); if (b.p) { const d = Math.hypot(b.p.x - meet.x, b.p.z - meet.z); if (d < best) { best = d; tMeet = t; } } } }
  const view = fakeView(lay), book = new BotBook(), env = makeBotEnv(view, book);
  const b = book.start(id, 't', 'shell', 0, { roomId: room.id });
  const w = { id: 'w', room, pos: { ...from }, state: 'wait', placed: true, offstage: false, path: [{ ...from }, { ...to }], pi: 1, target: { type: 'station', spot: to } };
  view.chars.set('w', w);
  const startW = tMeet - Math.hypot(meet.x - from.x, meet.z - from.z) / 3.5 + off;
  const obs = [], others = [...view.chars.values()].filter((c) => c !== w);
  let minD = Infinity;
  for (let t = 0; t < 9; t += 1 / 60) {
    view._now = t;
    if (w.state === 'wait' && t >= startW) w.state = 'walk';
    env.beginFrame();
    roverObstacles(book, obs, t);
    if (w.state !== 'wait') { separate([w, ...others], 1 / 60, undefined, 1, null, obs); botYield([w], obs, t, 1 / 60); }
    walk(w, t, 1 / 60);
    book.step(t, 1 / 60, 1, env);
    if (b.p && (b.state === 'out' || b.state === 'work' || b.state === 'back') && w.state !== 'wait') minD = Math.min(minD, Math.hypot(b.p.x - w.pos.x, b.p.z - w.pos.z));
  }
  return { minD, ghosts: book.stats.ghosts, arrived: b.state === 'work' || b.state === 'back' || b.state === 'land' || !book.size, walkerDone: w.state === 'work' };
}

test('도착점 곁: 랙 앞에 와 서는·뒤따라오는 직원·랙 바로 앞을 가로지르는 직원과 바퀴 로봇이 스치지 않음(≥ 0.55, §159.9) · 겹쳐 지나감 0 · 둘 다 도착', () => {
  const scen = {
    cross: (r) => { const c = { x: r.ax + r.front.x * 0.5, z: r.az + r.front.z * 0.5 }, lx = r.front.z, lz = -r.front.x; return { from: { x: c.x - lx * 2.5, z: c.z - lz * 2.5 }, to: { x: c.x + lx * 0.6, z: c.z + lz * 0.6 }, meet: c }; },
    arrive: (r) => { const lx = r.front.z, lz = -r.front.x, c = { x: r.ax + r.front.x * 0.5 + lx * 0.3, z: r.az + r.front.z * 0.5 + lz * 0.3 }; return { from: { x: c.x + r.front.x * 4, z: c.z + r.front.z * 4 }, to: c, meet: c }; },
    follow: (r) => { const lx = r.front.z, lz = -r.front.x, c = { x: r.ax + r.front.x * 1.0 - lx * 0.2, z: r.az + r.front.z * 1.0 - lz * 0.2 }; return { from: { x: r.ax + r.front.x * 5, z: r.az + r.front.z * 5 }, to: c, meet: c }; },
  };
  let worst = Infinity, n = 0;
  for (const id of ['a:2', 'a:3', 'a:6']) for (const [name, mk] of Object.entries(scen)) for (const off of [-0.45, -0.3, -0.15, 0, 0.15, 0.3]) {
    const r = encounter(id, mk, off);
    worst = Math.min(worst, r.minD); n++;
    assert.equal(r.ghosts, 0, `${id} ${name} ${off}: 겹쳐 지나감`);
    assert.ok(r.arrived, `${id} ${name} ${off}: 로봇 도착`);
    assert.ok(r.walkerDone, `${id} ${name} ${off}: 직원 도착`);
    // cross = 직원 길이 랙 접근점 0.5 앞을 지나는 빡빡한 배치: 로봇 곁 밀림 한도가 한 번에 끌려오지 않아 0.55 이상(예전 0.35～0.38)
    assert.ok(r.minD >= 0.55, `${id} ${name} ${off}: 가장 가까운 ${r.minD.toFixed(2)}`);
  }
  assert.ok(n >= 50 && worst < 1, `장면 ${n} · 가장 가까운 ${worst.toFixed(2)}`);
});

test('비켜 가기 계획(§159.8): 걷는 직원과 닿을 듯하면 우선이어도 멈춤 · 우선일 때 비켜 선 직원 곁은 지나감 · 도착점 곁에 서 있는 직원은 기다리지 않음(옆 비킴만)', () => {
  const p = { x: 0, z: 0 };
  // 옆에서 가로질러 들어오는 직원(지금은 통로 밖, 0.4초 뒤 정면)
  const cross = { x: 1.4, z: 1.2, walking: true, vx: -3.5, vz: 0 };
  assert.equal(avoidPlan(p, 0, 1, 0, [cross], 'me', 0.45, null, true, 4.6).wait, true, '닿기 미리 보기 — 우선이어도 멈춤');
  assert.equal(avoidPlan(p, 0, 1, 0, [{ ...cross, vx: 3.5 }], 'me', 0.45, null, true, 4.6).wait, false, '멀어지는 직원');
  // 우선 로봇: 비켜 선(yielding) 직원 곁은 옆 비킴이 되면 지나감, 정면이면 기다림
  assert.equal(avoidPlan(p, 0, 1, 0, [{ x: -0.3, z: 0.7, walking: true, yielding: true, vx: 0, vz: -3.5 }], 'me', 0.45, null, true, 4.6).wait, false);
  assert.equal(avoidPlan(p, 0, 1, 0, [{ x: 0, z: 0.7, walking: true, yielding: true, vx: 3.5, vz: 0 }], 'me', 0.45, null, true, 4.6).wait, true);
  // 도착점 곁(END)에 선 사람: 옆 비킴만(기다리지 않음) · 걷는 사람은 봄
  const end = { x: 0, z: 1.0 };
  const pl = avoidPlan(p, 0, 1, 0, [{ x: 0.1, z: 0.6 }], 'me', 0.45, end);
  assert.equal(pl.wait, false); assert.ok(Math.abs(pl.side) > 0.1, '옆 비킴');
  assert.equal(avoidPlan(p, 0, 1, 0, [{ x: 0.1, z: 0.6, walking: true }], 'me', 0.45, end).wait, true, '걷는 직원은 도착 직전에도');
  // 앞 한도(capF): 지금은 비켜 지나갈 수 있어도 그 곁에서 한도가 0 이면(꺾이는 점) 미리 멈춤
  const q = [{ x: -0.3, z: 0.7 }];
  assert.equal(avoidPlan(p, 0, 1, 0, q, 'me', 0.45).wait, false);
  assert.equal(avoidPlan(p, 0, 1, 0, q, 'me', 0.45, null, false, 0, () => 0).wait, true);
});

test('꺾이는 점·가구 한도: 옆 비킴이 한 프레임에 튀지 않음(예전 0.28 순간 이동) — 꺾이는 점 앞에서 0 으로 줄고, 한도가 갑자기 줄면 서서 되돌림', () => {
  for (const sudden of [false, true]) {
    const book = new BotBook();
    const b = book.start('n', 't', 'shell', 0, { roomId: 'R' });
    const person = { x: 3.2, z: 0.3, r: 0.3 }; // 꺾이는 점(5,0) 앞 길 곁에 선 사람 → 반대쪽으로 비킴
    let lim = false;
    const env = {
      pad: () => ({ x: 0, y: 0, z: 0 }), goal: () => ({ x: 5, y: 0, z: 5, yaw: 0 }), route: (bb, a, c) => [a, { x: 5, y: 0, z: 0 }, c],
      blockers: () => [person], sideFree: (bb, x, z, sx, sz, want) => (lim ? 0 : want),
    };
    let last = null, maxJump = 0, maxSide = 0;
    for (let t = 0; t < 8 && b.state !== 'work'; t += 1 / 60) {
      book.step(t, 1 / 60, 1, env);
      maxSide = Math.max(maxSide, Math.abs(b.side || 0));
      if (sudden && !lim && Math.abs(b.side || 0) > 0.25) lim = true; // 비킨 채 가구 곁(한도 0)
      if (b.p && last && b.state === 'out') maxJump = Math.max(maxJump, Math.hypot(b.p.x - last.x, b.p.z - last.z));
      if (b.p) last = { x: b.p.x, z: b.p.z };
    }
    assert.equal(b.state, 'work', `도착(${sudden})`);
    assert.ok(maxSide > 0.25, `비킴 ${maxSide.toFixed(2)}`);
    assert.ok(maxJump < 4.6 / 60 + 2 * 2.4 / 60 + 0.01, `한 프레임 이동 ${maxJump.toFixed(3)}(${sudden})`);
  }
});

/** 큰 사무실 흉내: 서버랙 둘레에 백그라운드 랙 줄·화면 열(스트레스 사무실 실측 배치) — 랙 앞 통로 0.88 */
function crowdedOffice(close = false) {
  const lay = office(), room = lay.rooms.find((r) => r.type === 'office'), o = room.origin;
  room.racks = []; room.screens = [];
  for (const z of [-8.4, -7.0, -5.6, -4.2]) for (const x of [6.6, 7.5, 8.4, 9.3]) room.racks.push({ x: o.x + x, z: o.z + z });
  for (const x of [8.75, 9.75, 10.75]) for (const z of [-5.4, -3.8]) room.screens.push({ x: o.x + x, y: 1, z: o.z + z });
  if (close) room.screens.push({ x: o.x + 10.25, y: 1, z: o.z + -5.4 }); // 0.88 통로도 막음
  return { lay, room };
}

test('좁은 통로: 넓은 몸 격자는 못 지나는 0.88 통로를 좁은 통로 격자(칸 가운데 TIGHT_R)로 지남 · 모든 책상 길이 가구와 차체 반폭 가까이 이상', () => {
  const { lay, room } = crowdedOffice();
  const view = fakeView(lay), r = botRack(room);
  let n = 0, wideFail = 0;
  for (const ch of view.chars.values()) {
    if (ch.room !== room || !ch.seat || ch.seat.deskX == null) continue;
    const p = roverPad(ch);
    assert.ok(navClear(room, p.x, p.z) >= BOT_BODY - 0.04, `${ch.id} 출발점이 가구 곁 ${navClear(room, p.x, p.z).toFixed(2)}`);
    const w = navPath(p, { x: r.ax, z: r.az }, room, true);
    if (!w || Math.hypot(w.at(-1).x - r.ax, w.at(-1).z - r.az) > 0.6) wideFail++;
    assert.ok(roverCanGo(ch), `${ch.id} 출동`);
    const g = roverGoal({}, room, p, { x: r.ax, y: 0, z: r.az, yaw: r.yaw });
    assert.ok(g && !g.reach, `${ch.id} 랙 앞까지 감`);
    const pts = roverRoute(room, p, g);
    let mc = Infinity;
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], c = pts[i], L = Math.hypot(c.x - a.x, c.z - a.z); for (let s = 0; s <= L; s += 0.05) mc = Math.min(mc, navClear(room, a.x + (c.x - a.x) * s / L, a.z + (c.z - a.z) * s / L)); }
    assert.ok(mc >= BOT_BODY - 0.05, `${ch.id} 길이 가구와 ${mc.toFixed(2)}`);
    n++;
  }
  assert.ok(n >= 8 && wideFail === n, `책상 ${n} · 넓은 몸 격자 실패 ${wideFail}`);
});

test('막힌 랙: 좁은 통로도 막히면 닿는 가장 가까운 자리(REACH 안)에서 멈춰 팔을 뻗음 · 그 길도 가구와 떨어짐', () => {
  const { lay, room } = crowdedOffice(true);
  const view = fakeView(lay), r = botRack(room);
  const ch = view.chars.get('a:0'), p = roverPad(ch);
  const at = navReach(room, p, { x: r.ax, z: r.az });
  assert.ok(at && Math.hypot(at.x - r.ax, at.z - r.az) <= 2.4, '닿는 자리');
  const book = new BotBook(), env = makeBotEnv(view, book);
  const b = book.start('a:0', 't', 'shell', 0, { roomId: room.id });
  let mc = Infinity;
  for (let t = 0; t < 6 && b.state !== 'work'; t += 1 / 60) { env.beginFrame(); book.step(t, 1 / 60, 1, env); if (b.p && b.state === 'out') mc = Math.min(mc, navClear(room, b.p.x, b.p.z)); }
  assert.equal(b.state, 'work');
  assert.ok(b._reach && b._reach.out.reach, '팔 뻗기');
  assert.ok(Math.hypot(b.p.x - at.x, b.p.z - at.z) < 1e-6 && mc >= BOT_BODY - 0.05, `닿는 자리에서 작업 · 가구와 ${mc.toFixed(2)}`);
});

/** 별 모양: N 드론이 한가운데를 같은 때 지나감 */
function star(N, fps = 60, mix = false) {
  const bk = new BotBook(), bs = [], pads = new Map(), goals = new Map();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, b = bk.start('N' + i, 't' + i, mix && i % 2 ? 'web' : 'read', 0, { roomId: 'R' + Math.floor(i / 2) });
    bs.push(b); pads.set(b, { x: Math.cos(a) * 6, y: 1, z: Math.sin(a) * 6 }); goals.set(b, { x: -Math.cos(a) * 6, y: 1.5, z: -Math.sin(a) * 6, yaw: 0 });
  }
  const env = { pad: (b) => pads.get(b), goal: (b) => goals.get(b), route: (b, a, c) => { const L = BOT.CRUISE[b.kind]; return [a, { x: a.x, y: L, z: a.z }, { x: c.x, y: L, z: c.z }, c]; } };
  let min3 = Infinity, jump = 0;
  const last = new Map(), h = 1 / fps;
  for (let t = 0; t < 6; t += h) {
    bk.step(t, Math.min(0.05, h), 1, env);
    const fl = bs.filter((b) => b.p && (b.state === 'out' || b.state === 'work') && b.p.y > 1.7);
    for (let i = 0; i < fl.length; i++) for (let j = i + 1; j < fl.length; j++) min3 = Math.min(min3, Math.hypot(fl[i].p.x - fl[j].p.x, fl[i].p.y - fl[j].p.y, fl[i].p.z - fl[j].p.z));
    for (const b of bs) { if (b.p && last.has(b) && b.state === 'out') { const l = last.get(b); jump = Math.max(jump, Math.abs(b.p.y - l.y)); } if (b.p) last.set(b, { ...b.p }); }
  }
  return { min3, jump, arrived: bs.filter((b) => b.state === 'work').length, hovers: bk.stats.hovers };
}

test('드론 층이 모자람(넷 이상 한가운데에서 엇갈림): 옆 비킴·호버로 가장 가까운 3D 간격 ≥ 0.4 · 모두 도착 · 높이가 튀지 않음 · 낮은 프레임에서도', () => {
  for (const n of [4, 5, 6]) {
    const r = star(n);
    assert.ok(r.min3 >= 0.4, `드론 ${n}: 가장 가까운 ${r.min3.toFixed(2)}`);
    assert.equal(r.arrived, n, `드론 ${n}: 도착`);
    assert.ok(r.jump < 0.12, `드론 ${n}: 한 프레임 높이 ${r.jump.toFixed(3)}`);
  }
  assert.ok(star(6).hovers >= 1, '호버 씀');
  const low = star(5, 20); // 프레임이 성김(dt 0.05 잘림 — 벽시계 간격으로 층·옆 비킴)
  assert.ok(low.min3 >= 0.4 && low.arrived === 5, `20fps 가장 가까운 ${low.min3.toFixed(2)}`);
});

test('드론 층(§159.8 실제 높이로 칠함): 순항 고도가 낮은 탐색 드론이 정찰 드론 높이를 지나 올라가지 않음 · 섞여 엇갈려도 ≥ 0.4', () => {
  const r = star(6, 30, true);
  assert.ok(r.min3 >= 0.4 && r.arrived === 6, `섞임 가장 가까운 ${r.min3.toFixed(2)}`);
  // 짝 하나: 탐색(2.45) ↔ 정찰(2.75) 마주 옴 → 높은 정찰이 올라감(탐색은 그대로)
  const bk = new BotBook();
  const S = bk.start('A', 'ta', 'read', 0, { roomId: 'R' }), W = bk.start('B', 'tb', 'web', 0, { roomId: 'R' });
  const env = { pad: (b) => (b === S ? { x: 0, y: 1, z: 0 } : { x: 14, y: 1, z: 0 }), goal: (b) => (b === S ? { x: 14, y: 1.5, z: 0.2, yaw: 0 } : { x: 0, y: 1.5, z: -0.2, yaw: 0 }),
    route: (b, a, c) => { const L = BOT.CRUISE[b.kind]; return [a, { x: a.x, y: L, z: a.z }, { x: c.x, y: L, z: c.z }, c]; } };
  let sMax = 0, wMax = 0;
  for (let t = 0; t < 3; t += 1 / 60) { bk.step(t, 1 / 60, 1, env); if (S.state === 'out') sMax = Math.max(sMax, S.p.y); if (W.state === 'out') wMax = Math.max(wMax, W.p.y); }
  assert.ok(sMax < BOT.CRUISE.recon - 0.1, `탐색 최고 ${sMax.toFixed(2)}`);
  assert.ok(wMax > BOT.CRUISE.recon + 0.3, `정찰 최고 ${wMax.toFixed(2)}`);
});

test('탐색 드론 작업 칸: 같은 방 두 직원의 드론은 서가 칸이 다름(예전 노드 해시 + 번호 → 같은 칸에 겹침)', () => {
  const lay = office(), view = fakeView(lay), book = new BotBook(), env = makeBotEnv(view, book);
  const ids = [...view.chars.keys()].filter((k) => view.chars.get(k).room.type === 'office').slice(0, 4);
  const bs = ids.map((id, i) => book.start(id, 't' + i, 'read', 0, { roomId: view.chars.get(id).room.id }));
  const gs = bs.map((b) => env.goal(b));
  for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) assert.ok(Math.hypot(gs[i].x - gs[j].x, gs[i].z - gs[j].z) > 0.5, `${i}·${j} 칸 간격`);
});
