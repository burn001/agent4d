// 복셀 오피스 길찾기: 가구·벽을 장애물로 둔 격자 A* — 모든 길 점이 가구·벽 상자와 겹치지 않음(여러 배치·회전·live 메인 여럿·라운지)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOffice, pathBetween, stationFor } from '../voxel/layout.js';
import { computeCampus, translateOffice } from '../voxel/campus.mjs';
import { roomObstacles, loungeObstacles, loungeNav, loungePath, navSpot, navBase, NAV } from '../voxel/nav-core.mjs';
import { breakSlots, clientSpot, overseeSpot, roomPoint } from '../voxel/office-core.mjs';
import { watchLocal } from '../voxel/vx-proc-core.mjs';
import { floorRoute } from '../voxel/office-core.mjs';
import { rotateOffice, toLocal, quarter } from '../voxel/xf.mjs';
import { Character } from '../voxel/character-core.mjs';

const CLEAR = 0.15;
const INSIDE = new Set(); // 가구 안 자리(보고용) // 몸 중심이 가구·벽 상자에서 떨어져야 할 거리(격자 R 0.2 에서 부동소수 여유)
let ord = 0;
const N = (id, parentId, kind, extra = {}) => ({ id, parentId, kind, status: 'active', order: ord++, ...extra });
const PROC = (id, parentId) => N(id, parentId, 'bash-bg', { meta: { proc: { v: 1, cmd: 'nohup python x.py', prog: 'python', script: 'x.py', via: 'nohup', log: 'x.log', spawnedBy: parentId, watch: [], watchCount: 0 } } });

/** 큰 사무실: 팀원 12(보조 책상 포함)·회의실·별관·서버랙·모니터·기동기(회차 = 작업 책상)·생산 라인 */
function bigOffice(nSub = 12) {
  ord = 0;
  const L = [N('s:main', null, 'main')];
  for (let i = 0; i < nSub; i++) L.push(N('a:' + i, 's:main', 'subagent'));
  L.push(N('a:k1', 'a:0', 'subagent'), N('a:k2', 'a:0', 'subagent'), N('a:k3', 'a:1', 'subagent')); // 보조 책상
  L.push(N('w:1', 's:main', 'workflow'), N('a:w1', 'w:1', 'workflow-agent'), N('a:w2', 'w:1', 'workflow-agent'), N('a:w3', 'w:1', 'workflow-agent'));
  L.push(N('s:p1', 'a:2', 'claude-p'), N('a:p1', 's:p1', 'subagent'));
  for (let i = 0; i < 3; i++) L.push(N('b:r' + i, 's:main', 'bash-bg'));
  L.push(N('m:1', 's:main', 'monitor'), N('m:2', 's:main', 'monitor'));
  L.push(N('b:L', 's:main', 'bash-bg', { meta: { launcher: { script: 'relaunch.sh' } } }));
  L.push(N('s:c1', 'b:L', 'claude-p', { meta: { link: { by: 'launcher' } } }), N('s:c2', 'b:L', 'claude-p', { meta: { link: { by: 'launcher' } }, status: 'done' }));
  L.push(PROC('b:p1', 's:main'), PROC('b:p2', 's:main'));
  return L;
}

/** 상자 목록(돌리기 전 좌표)에 대해 점 → 가장 가까운 상자 거리(안이면 음수) */
function clearance(boxes, x, z) {
  let m = Infinity, who = null;
  for (const b of boxes) {
    const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    const d = dx > 0 || dz > 0 ? Math.hypot(dx, dz) : -Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
    if (d < m) { m = d; who = b.kind; }
  }
  return { d: m, who };
}
/** 길(세계) 전 구간을 0.04 간격으로 훑어 상자와 CLEAR 안이면 실패 문구 */
function pathHit(pts, boxes, toBase = (p) => p) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 0.04));
    for (let k = 0; k <= n; k++) {
      const q = toBase({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
      const c = clearance(boxes, q.x, q.z);
      if (c.d < CLEAR) return `${c.who} ${c.d.toFixed(3)} @ (${q.x.toFixed(2)}, ${q.z.toFixed(2)}) 구간 ${i}`;
    }
  }
  return null;
}
const axisAligned = (p) => p.every((q, i) => !i || Math.abs(q.x - p[i - 1].x) < 1e-6 || Math.abs(q.z - p[i - 1].z) < 1e-6);

/** 방 안 사람이 서는 모든 자리(자리·시설 접근점·대기 줄·탕비실·의뢰인 스크린·감독·생산 라인 들여다보기·문·포털) */
function endpoints(lay, room) {
  const out = [];
  for (const [id, s] of lay.seat) if (s.roomId === room.id) out.push({ name: 'seat ' + id, p: s });
  for (const [cat, arr] of Object.entries(room.stations || {})) arr.forEach((p, i) => out.push({ name: `st ${cat}${i}`, p }));
  for (const [cat, arr] of Object.entries(room.queues || {})) arr.forEach((p, i) => out.push({ name: `q ${cat}${i}`, p }));
  out.push({ name: 'door', p: room.door }, { name: 'door.out', p: room.door.out });
  if (room.type === 'office') {
    if (room.portal) out.push({ name: 'portal.spawn', p: room.portal.spawn });
    breakSlots(room).forEach((p, i) => out.push({ name: 'break' + i, p }));
    const cs = clientSpot(room); if (cs) out.push({ name: 'client', p: cs });
    const os = overseeSpot(room); if (os) out.push({ name: 'oversee', p: os });
    for (const [id, s] of lay.seat) if (s.roomId === room.id && s.kind === 'op') out.push({ name: 'oversee ' + id, p: overseeSpot(room, { lx: s.deskLX, lz: s.deskLZ }) });
    for (const slot of navBase(room).bays || []) { const w = watchLocal(slot); out.push({ name: 'watch' + slot, p: roomPoint(room, w.x, w.z) }); }
  }
  return out;
}

/** 방 하나: 자리끼리(앞 몇 개 × 전부) 길이 상자와 겹치지 않음 · 끝점 일치 · 가로·세로 · 결정적 */
function checkRoom(lay, room, maxFrom = 8) {
  const boxes = roomObstacles(room);
  const rot = room.xf && quarter(room.xf.k) && room.local;
  const toBase = rot ? (p) => toLocal(room.xf, p.x, p.z) : (p) => p;
  const eps = endpoints(lay, room);
  // 사람이 서는 자리는 거의 모두 가구·벽에서 떨어져 있다. 예외(가구 안 자리 — 예: 모니터 벽 대기 줄이 생산 라인 위)는 접근점에서 멈춘다
  const inside = new Set();
  for (const e of eps) {
    const q = toBase(e.p), c = clearance(boxes, q.x, q.z);
    if (c.d < CLEAR) { inside.add(e); INSIDE.add(`${e.name}(${c.who})`); }
  }
  assert.ok(inside.size <= 2, `${room.id} 가구 안 자리 ${[...inside].map((e) => e.name)}`);
  let n = 0;
  for (const A of eps.slice(0, maxFrom)) for (const B of eps) {
    if (A === B) continue;
    const p = pathBetween(A.p, B.p, room);
    n++;
    assert.ok(p.length >= 1);
    assert.ok(Math.abs(p[0].x - A.p.x) < 1e-9 && Math.abs(p[0].z - A.p.z) < 1e-9, `${A.name}→${B.name} 시작점`);
    const want = inside.has(B) ? navSpot(room, B.p) : B.p;
    assert.ok(Math.abs(p.at(-1).x - want.x) < 1e-6 && Math.abs(p.at(-1).z - want.z) < 1e-6, `${A.name}→${B.name} 끝점`);
    if (inside.has(A)) continue; // 가구 안에서 나오는 첫 걸음은 검사하지 않음(실제로는 그 자리에 서지 않는다)
    assert.ok(axisAligned(p), `${A.name}→${B.name} 가로·세로`);
    const hit = pathHit(p, boxes, toBase);
    assert.equal(hit, null, `${room.id} ${A.name}→${B.name}: ${hit}`);
  }
  return n;
}

test('roomObstacles: 그리는 가구가 모두 상자로 들어감(팀장 책상·책상·탕비실·책장·서류함·금고·도구 상자·모니터 벽·컨베이어·부스·포털·벨·화분·서버랙·기동기·생산 라인·벽)', () => {
  const lay = computeOffice(bigOffice(), 's:main', null);
  const room = lay.rooms.find((r) => r.id === 'o:s:main');
  const boxes = roomObstacles(room);
  const kinds = new Set(boxes.map((b) => b.kind));
  for (const k of ['wall', 'leadDesk', 'desk', 'pantry', 'bookshelf', 'cabinet', 'vault', 'toolbox', 'monitorWall', 'conveyor', 'booth', 'portal', 'bell', 'plant', 'rack', 'batch', 'bay']) assert.ok(kinds.has(k), k);
  const inBox = (x, z, kind) => boxes.some((b) => b.kind === kind && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
  for (const d of room.desks) assert.ok(inBox(d.x, d.z, 'desk'), `책상 ${d.x},${d.z}`);
  for (const r of room.racks) assert.ok(inBox(r.x, r.z, 'rack'));
  for (const b of room.batches) assert.ok(inBox(b.x, b.z, 'batch'));
  for (const [, m] of lay.machine) if (m.type === 'proc' && m.roomId === room.id) assert.ok(inBox(m.x, m.z, 'bay'), '생산 라인 기계');
  assert.equal(boxes.filter((b) => b.kind === 'wall').length, 5, '네 벽 + 앞 벽 문 틈 = 다섯 토막');
  const meet = lay.rooms.find((r) => r.type === 'meeting');
  const mk = new Set(roomObstacles(meet).map((b) => b.kind));
  for (const k of ['wall', 'table', 'bookshelf', 'cabinet', 'toolbox', 'plant', 'board']) assert.ok(mk.has(k), '회의실 ' + k);
});

test('큰 사무실·회의실·별관: 모든 자리 ↔ 자리 길이 가구·벽과 겹치지 않음, 끝점 정확, 가로·세로', () => {
  const lay = computeOffice(bigOffice(), 's:main', null);
  let n = 0;
  for (const room of lay.rooms) n += checkRoom(lay, room);
  assert.ok(n > 500, '길 수 ' + n);
});

test('책상 줄이 늘어난 사무실(ext)·팀원 30: 겹침 0', () => {
  const lay = computeOffice(bigOffice(30), 's:main', null);
  const room = lay.rooms.find((r) => r.id === 'o:s:main');
  assert.ok(room.ext > 0);
  checkRoom(lay, room, 6);
});

test('돌린 사무실(1·2·3 사분)·평행 이동: 겹침 0(회전 전 길을 돌린 것과 같은지는 vx-rotate)', () => {
  for (const k of [1, 2, 3]) {
    const lay = computeOffice(bigOffice(), 's:main', null);
    rotateOffice(lay, k, 3, -2);
    translateOffice(lay, 17.3, -41.1);
    for (const room of lay.rooms) checkRoom(lay, room, 3);
  }
});

test('live 메인 2～5 캠퍼스(문이 라운지 쪽으로 돈 방): 방마다 겹침 0 · 문 밖 ↔ 라운지 캐비닛 자리 길이 소파·탁자·캐비닛·다른 방과 겹치지 않음', () => {
  const T = (m) => new Date(Date.parse('2026-10-24T03:00:00Z') + m * 60000).toISOString();
  for (const nLive of [2, 3, 4, 5]) {
    ord = 0;
    const nodes = [], roots = [], liveList = [];
    const add = (n) => nodes.push({ status: 'active', order: ord++, projectId: 'P', meta: {}, lastActivityAt: T(30), ...n });
    for (let i = 0; i < nLive + 1; i++) {
      const sid = (i < nLive ? 'L' : 'P') + i, id = 's:' + sid;
      add({ id, parentId: null, kind: 'main', rootSessionId: sid, sessionId: sid, startedAt: T(i), status: i < nLive ? 'active' : 'idle' });
      roots.push({ nodeId: id, projectId: 'P' });
      if (i < nLive) liveList.push({ sessionId: sid, entrypoint: 'cli', liveStatus: 'busy', activityAt: T(40 - i) });
      for (let c = 0; c < 7; c++) add({ id: `a:${sid}-${c}`, parentId: id, kind: 'subagent', rootSessionId: sid });
      add({ id: `b:${sid}`, parentId: id, kind: 'bash-bg', rootSessionId: sid });
    }
    const c = computeCampus(nodes, roots, [{ projectId: 'P', name: 'p', live: true, active: true, liveList }], null, { nowMs: Date.parse(T(41)) });
    assert.equal(c.lounges.length, 1);
    for (const room of c.rooms) checkRoom(c, room, 3);
    const lg = c.lounges[0];
    const rooms = c.rooms.filter((r) => r.projectId === lg.projectId);
    const nav = loungeNav(lg, rooms);
    const boxes = loungeObstacles(lg, rooms.filter((r) => r.bounds.minX < lg.maxX + 6 && r.bounds.maxX > lg.minX - 6 && r.bounds.minZ < lg.maxZ + 6 && r.bounds.maxZ > lg.minZ - 6));
    for (const s of lg.spots) assert.ok(clearance(boxes, s.x, s.z).d >= CLEAR, '라운지 자리');
    for (const room of rooms.filter((r) => r.lounge && r.type === 'office')) {
      for (const s of lg.spots) {
        const go = loungePath(nav, room.door.out, s), back = loungePath(nav, s, room.door.out);
        for (const p of [go, back]) {
          assert.ok(p.length >= 2 && axisAligned(p), '라운지 길 가로·세로');
          assert.equal(pathHit(p, boxes), null, `${nLive} ${room.id} → 라운지`);
        }
        assert.deepEqual([go.at(-1).x, go.at(-1).z], [s.x, s.z]);
      }
    }
  }
});

test('결정적: 같은 입력이면 같은 길(새 배치 객체·재계산·캐시 모두), 바닥 조명 라인 = 걷는 길', () => {
  const lay1 = computeOffice(bigOffice(), 's:main', null), lay2 = computeOffice(bigOffice(), 's:main', null);
  const r1 = lay1.rooms.find((r) => r.id === 'o:s:main'), r2 = lay2.rooms.find((r) => r.id === 'o:s:main');
  for (const [id, s] of lay1.seat) {
    if (s.roomId !== r1.id || id === 's:main') continue;
    const st1 = stationFor('skill', r1, 0), st2 = stationFor('skill', r2, 0);
    const a = pathBetween(s, st1, r1), b = pathBetween(lay2.seat.get(id), st2, r2), again = pathBetween(s, st1, r1);
    assert.deepEqual(a, b, id);
    assert.deepEqual(a, again);
    assert.deepEqual(floorRoute(s, lay1.seat.get('s:main'), r1), pathBetween(s, lay1.seat.get('s:main'), r1), '바닥 라인');
  }
});

test('목적지가 가구 안이면 그 가구 앞 접근점에서 멈춤(navSpot 과 같은 점), 접근점은 가구 밖', () => {
  const lay = computeOffice(bigOffice(), 's:main', null);
  const room = lay.rooms.find((r) => r.id === 'o:s:main');
  const boxes = roomObstacles(room);
  const seat = lay.seat.get('a:3');
  for (const target of [room.racks[0], room.batches[0], { x: room.leadDesk.x, z: room.leadDesk.z }, room.desks[5]]) {
    const p = pathBetween(seat, target, room);
    const end = p.at(-1), sp = navSpot(room, target);
    assert.ok(Math.abs(end.x - sp.x) < 1e-9 && Math.abs(end.z - sp.z) < 1e-9, '길 끝 = navSpot');
    assert.ok(clearance(boxes, end.x, end.z).d >= NAV.R - 1e-6, '접근점은 가구 밖');
    assert.ok(Math.hypot(end.x - target.x, end.z - target.z) < 2.5, '가구 바로 앞');
    assert.equal(pathHit(p, boxes), null);
  }
});

test('Character: 자리 → 시설 → 탕비실 → 문(퇴장) 걷는 동안 몸 중심이 가구·벽을 지나지 않음(3D·2D 공용 상태 머신)', () => {
  const lay = computeOffice(bigOffice(), 's:main', null);
  const room = lay.rooms.find((r) => r.id === 'o:s:main');
  const boxes = roomObstacles(room);
  for (const id of ['a:0', 'a:5', 'a:k1', 's:main']) {
    const seat = lay.seat.get(id);
    const ch = new Character(id, { id, kind: 'subagent', status: 'active', openTools: [] }, { lead: id === 's:main' });
    ch.placed = true; ch.seat = seat; ch.room = room; ch.placeAt(seat, seat.face); ch.state = 'seated';
    ch.target = { key: 'desk:' + seat.x.toFixed(2) + ',' + seat.z.toFixed(2), type: 'desk', spot: seat };
    let now = 0;
    const ctx = { now, dt: 0.05, ts: 1, room, seat, stationSpot: () => null, releaseStation: () => {} };
    const walk = () => {
      for (let f = 0; f < 2000 && (ch.state === 'walk' || ch.state === 'leave') && ch.path; f++) {
        now += 0.05; ctx.now = now;
        ch._move(ctx);
        const c = clearance(boxes, ch.pos.x, ch.pos.z);
        assert.ok(c.d >= CLEAR, `${id} 걷다가 ${c.who} 곁 ${c.d.toFixed(3)} (${ch.pos.x.toFixed(2)}, ${ch.pos.z.toFixed(2)})`);
      }
    };
    for (const want of [
      { key: 'st:skill', type: 'station', spot: stationFor('skill', room, 0), cat: 'skill' },
      { key: 'break', type: 'break', spot: breakSlots(room)[2], cat: null },
      { key: 'st:agent', type: 'station', spot: stationFor('agent', room, 1), cat: 'agent' },
      { key: 'desk:back', type: 'desk', spot: seat, cat: null },
    ]) {
      ch._goTo({ ...want, toolId: null }, ctx);
      walk();
      assert.ok(ch.state === 'seated' || ch.state === 'work', `${id} ${want.key} 도착`);
      const b = want.type === 'desk' ? seat : want.spot;
      assert.ok(Math.hypot(ch.pos.x - b.x, ch.pos.z - b.z) < 1e-6, `${id} ${want.key} 자리`);
    }
    ch._startLeave(ctx);
    walk();
    assert.ok(Math.hypot(ch.pos.x - room.door.out.x, ch.pos.z - room.door.out.z) < 1e-6, '문 밖');
  }
});

test('이사 보간(shiftBy): 걷는 길·지금 자리가 방과 같이 옮겨 감', () => {
  const lay = computeOffice(bigOffice(), 's:main', null);
  const room = lay.rooms.find((r) => r.id === 'o:s:main');
  const seat = lay.seat.get('a:2');
  const ch = new Character('a:2', { id: 'a:2', kind: 'subagent', status: 'active', openTools: [] });
  ch.placed = true; ch.seat = seat; ch.room = room; ch.placeAt(seat, 0); ch.state = 'seated';
  ch.target = { key: 'desk', type: 'desk', spot: seat };
  const ctx = { now: 0, dt: 0.05, ts: 1, room, seat, stationSpot: () => null, releaseStation: () => {} };
  ch._goTo({ key: 'st', type: 'station', spot: stationFor('skill', room, 0), cat: 'skill', toolId: null }, ctx);
  const before = ch.path.map((p) => ({ ...p })), pos = { ...ch.pos };
  translateOffice(lay, 5, -3);
  ch.shiftBy(5, -3);
  ch.path.forEach((p, i) => assert.ok(Math.abs(p.x - before[i].x - 5) < 1e-9 && Math.abs(p.z - before[i].z + 3) < 1e-9));
  assert.ok(Math.abs(ch.pos.x - pos.x - 5) < 1e-9);
  // 옮긴 방에서 다시 찾은 길 = 옮긴 길(상대 좌표 캐시)
  const re = pathBetween(seat, stationFor('skill', room, 0), room);
  re.forEach((p, i) => assert.ok(Math.abs(p.x - ch.path[i].x) < 1e-6 && Math.abs(p.z - ch.path[i].z) < 1e-6));
});

test('성능: 큰 사무실 서로 다른 길 300개(캐시 없음) 평균 < 8ms, 캐시 적중은 즉시', () => {
  const lay = computeOffice(bigOffice(30), 's:main', null);
  const room = lay.rooms.find((r) => r.id === 'o:s:main');
  const eps = endpoints(lay, room).map((e) => e.p);
  const pairs = [];
  for (let i = 0; i < eps.length && pairs.length < 300; i++) for (let j = eps.length - 1; j > i && pairs.length < 300; j -= 3) pairs.push([eps[i], eps[j]]);
  let t0 = performance.now();
  for (const [a, b] of pairs) pathBetween(a, b, room);
  const cold = (performance.now() - t0) / pairs.length;
  t0 = performance.now();
  for (const [a, b] of pairs) pathBetween(a, b, room);
  const warm = (performance.now() - t0) / pairs.length;
  assert.ok(cold < 8, `cold ${cold.toFixed(2)}ms`);
  assert.ok(warm < 0.5, `warm ${warm.toFixed(3)}ms`);
});

test('가구 안 자리 목록(접근점 사용)', () => { assert.ok(INSIDE.size <= 3, [...INSIDE].join(', ')); console.log('가구 안 자리:', [...INSIDE].join(', ') || '없음'); });
