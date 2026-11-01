// node --test "web/test/lab-stair-walk.test.mjs"   복셀 연구소 관리자(메인·팀장) 계단(브리지 경사로) 오르내림 수리(11.01.).
// 박사님: "관리자 에이전트 계단 오르는 동작이 어색 — 지그재그로 계단을 오르내린다."
// 원인: 4방향 격자 A* 꺾은선이 45° 기운 경사로(폭 1.8)를 1m 남짓 가로·세로로 꺾어 올라 걸음이 90° 씩 좌우로 꺾였다
//       (덱·경사로 칸은 직선 당김 pull 에서도 빠져 있었음). 수리: nav-core rampRoute — 경사로를 지나는 길은 경사로 축을 따라 곧게.
// 여기서 보는 것(구역 1·2·3, 팀장 자리 ↔ 바닥 여러 곳, 오르기·내려가기 둘 다):
//   (a) 길 위 높이(labFloorY)가 단조(내려가면 늘지 않고 오르면 줄지 않음)
//   (b) 경사로 위(0 < y < 덱) 표본의 축 횡방향 편차 ≤ 0.05m, 경사로 위에서 꺾이지 않음(방향 하나)
//   (c) 길이 가구·벽·난간 상자를 지나지 않음  (d) 오피스 방 길은 그대로 가로·세로(연구소 분기만 바뀜)
//   (e) 걷기(헤드리스에서 본 두 번째 원인): 팀장이 책상으로 오르는 중 새 도구(바닥 시설)가 오면 경사로 한가운데서 되돌아 내려갔다
//       (높이 오르내림). ctx.onRamp(LabView 만 줌)가 있으면 경사로를 다 지난 뒤에 새 목표로 — 경사로 위 높이 단조. 없으면(다른 표현) 예전처럼 바로 돎
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAB, worldToBridge } from '../lab/lab-const.mjs';
import { computeLab, labFloorY } from '../lab/lab-layout-core.mjs';
import { navPath, navPathBlocked } from '../voxel/nav-core.mjs';
import { Character } from '../voxel/character-core.mjs';

function nodes(nMain = 1, nSub = 8) {
  const a = [];
  let o = 0;
  for (let m = 0; m < nMain; m++) {
    a.push({ id: 'm' + m, kind: 'main', order: o++, status: 'active' });
    for (let i = 0; i < nSub; i++) a.push({ id: `s${m}_${i}`, kind: 'subagent', parentId: 'm' + m, order: o++, status: 'active' });
  }
  return a;
}

const B = LAB.BRIDGE, UC = -B.D / 2 + B.RAMP_W / 2;
/** 길을 0.05m 간격 표본으로: [{x, z, y, seg}] */
function samples(lab, p) {
  const out = [];
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n;
      out.push({ x, z, y: labFloorY(lab, x, z), seg: i });
    }
  }
  return out;
}
/** 표본이 올라선 경사로 브리지(축 횡방향 편차 = |u − UC|) */
function rampLat(lab, s) {
  let best = Infinity;
  for (const f of lab.bridges || [lab.bridge]) {
    const q = worldToBridge(f, s.x, s.z, {});
    if (Math.abs(q.v) >= B.W / 2 && Math.abs(q.v) <= B.W / 2 + B.RAMP_L && q.u >= -B.D / 2 && q.u <= -B.D / 2 + B.RAMP_W) best = Math.min(best, Math.abs(q.u - UC));
  }
  return best;
}

function check(L, room, a, b, label) {
  const p = navPath(a, b, room);
  assert.ok(p && p.length >= 2, `${label}: 길 없음`);
  assert.equal(navPathBlocked(room, p.slice(1, -1)), false, `${label}: 상자 통과`);
  const S = samples(room.lab, p), y0 = S[0].y, y1 = S[S.length - 1].y, dir = Math.sign(y1 - y0);
  let ramp = 0;
  const segs = new Set();
  for (let i = 1; i < S.length; i++) {
    const d = S[i].y - S[i - 1].y;
    if (dir <= 0) assert.ok(d <= 1e-9, `${label}: 내려가다 다시 오름 (${S[i - 1].y.toFixed(3)} → ${S[i].y.toFixed(3)})`);
    if (dir >= 0) assert.ok(d >= -1e-9, `${label}: 오르다 다시 내려감 (${S[i - 1].y.toFixed(3)} → ${S[i].y.toFixed(3)})`);
    const s = S[i];
    if (s.y > 0.02 && s.y < B.Y - 0.02) {
      ramp++;
      segs.add(s.seg);
      const lat = rampLat(room.lab, s);
      assert.ok(lat <= 0.05, `${label}: 경사로 위 좌우 흔들림 ${lat.toFixed(3)}m (y ${s.y.toFixed(2)})`);
    }
  }
  return { p, ramp, rampSegs: segs.size, climbs: Math.abs(y1 - y0) > 1 };
}

test('팀장 ↔ 바닥: 경사로는 축을 따라 곧게, 높이 단조(구역 1·2·3)', () => {
  let climbs = 0;
  for (const nZ of [1, 2, 3]) {
    const L = computeLab(nodes(nZ), 'm0', null);
    for (let m = 0; m < nZ; m++) {
      const seat = L.seat.get('m' + m);
      assert.ok(seat && seat.floorY === B.Y, `m${m} 자리는 브리지 위`);
      const room = L.rooms.find((r) => r.id === seat.roomId);
      const lab = room.lab;
      const floorSpots = [room.door, ...lab.rimSlots.filter((_, i) => i % 6 === 0), ...[...L.seat.entries()].filter(([k, s]) => s.roomId === room.id && s.floorY === 0).slice(0, 4).map(([, s]) => s)];
      for (const t of floorSpots) {
        for (const [a, b, lb] of [[seat, t, '내려감'], [t, seat, '오름']]) {
          const r = check(L, room, a, b, `구역 ${nZ} m${m} ${lb} (${t.x.toFixed(1)},${t.z.toFixed(1)})`);
          if (!r.climbs) continue;
          climbs++;
          assert.ok(r.ramp > 20, '경사로 표본');
          assert.equal(r.rampSegs, 1, `구역 ${nZ} m${m} ${lb}: 경사로 위에서 꺾임(조각 ${r.rampSegs})`);
        }
      }
    }
  }
  assert.ok(climbs >= 60, `오르내림 길 ${climbs}`);
});

test('경사로 중간에서 다시 걷기(replan): 축 위 점에서 덱·바닥 어느 쪽이든 곧게', () => {
  const L = computeLab(nodes(1), 'm0', null), room = L.rooms[0], f = room.lab.bridge;
  const seat = L.seat.get('m0'), door = room.door;
  for (const s of [-1, 1]) for (const k of [0.25, 0.5, 0.75]) {
    const mid = (({ x, z }) => ({ x, z }))(((u, v) => ({ x: f.c.x + f.eu.x * u + f.ev.x * v, z: f.c.z + f.eu.z * u + f.ev.z * v }))(UC, s * (B.W / 2 + B.RAMP_L * k)));
    for (const [b, lb] of [[seat, '덱'], [door, '문']]) {
      const r = check(L, room, mid, b, `경사로 ${s} ${k} → ${lb}`);
      assert.ok(r.rampSegs <= 1, `경사로 ${s} ${k} → ${lb}: 꺾임`);
    }
  }
});

test('오피스 방 길은 그대로 가로·세로(연구소 분기만)', () => {
  const room = { id: 'o', type: 'office', origin: { x: 0, z: 0 }, bounds: { minX: -12, maxX: 12, minZ: -9, maxZ: 9 }, door: { x: 0, z: 9 }, desks: [{ x: -3, z: 0 }, { x: 3, z: 0 }], leadDesk: { x: 0, z: -5 } };
  const p = navPath({ x: -8, z: -6 }, { x: 7, z: 6 }, room);
  assert.ok(p && p.length >= 2);
  for (let i = 1; i < p.length; i++) assert.ok(Math.abs(p[i].x - p[i - 1].x) < 1e-9 || Math.abs(p[i].z - p[i - 1].z) < 1e-9, '오피스는 가로·세로 꺾은선');
});

/** 팀장 하나를 연구소에서 걸림: 바닥 시설(문 앞)로 내려갔다 책상으로 오르는 중(경사로 가운데) 새 도구가 옴 → 경사로 위 높이 기록 */
function leadRun(withHook) {
  const L = computeLab(nodes(1), 'm0', null), room = L.rooms[0], seat = L.seat.get('m0'), lab = room.lab;
  const node = { id: 'm0', kind: 'main', status: 'active' }, ch = new Character('m0', node, { lead: true });
  const onRamp = (c) => { const y = labFloorY(lab, c.pos.x, c.pos.z); return y > 0.01 && y < B.Y - 0.01; };
  const spot = { x: room.door.x, z: room.door.z, face: 0 };
  const ctx = { now: 0, dt: 1 / 30, ts: 1, room, seat, stationSpot: () => spot, releaseStation: () => {}, ...(withHook ? { onRamp } : {}) };
  const ys = [];
  const step = () => { ctx.now += ctx.dt; ch.update(ctx); ys.push(labFloorY(lab, ch.pos.x, ch.pos.z)); };
  for (let i = 0; i < 10; i++) step();
  ch.addTool('t1', 'agent', 'Agent', ctx.now);
  for (let i = 0; i < 30 * 30 && ch.state !== 'work'; i++) step();
  assert.equal(ch.state, 'work', '바닥 시설에 닿음');
  ch.endTool('t1', true, ctx.now);
  let fired = false;
  for (let i = 0; i < 30 * 40; i++) {
    step();
    const y = ys[ys.length - 1], prev = ys[ys.length - 2];
    if (!fired && y > B.Y * 0.4 && y > prev) { ch.addTool('t2', 'agent', 'Agent', ctx.now); fired = true; } // 오르는 중 경사로 가운데서 새 도구
    if (fired && ch.state === 'work') break;
  }
  assert.ok(fired, '경사로를 올랐음');
  // 경사로 위 연속 구간마다 높이 방향이 한 번도 바뀌지 않는지
  let rev = 0, dir = 0, on = false;
  for (let i = 1; i < ys.length; i++) {
    const r = ys[i] > 0.01 && ys[i] < B.Y - 0.01;
    if (!r) { on = false; dir = 0; continue; }
    const d = Math.sign(ys[i] - ys[i - 1]);
    if (on && d && dir && d !== dir) rev++;
    if (d) dir = d;
    on = true;
  }
  return { rev, maxY: Math.max(...ys.slice(ys.findIndex((y) => y < 0.01))) };
}

test('경사로 위에서는 목표를 바꾸지 않음(오르다 되돌아 내려가지 않음) — 연구소 갈고리 ctx.onRamp', () => {
  const on = leadRun(true);
  assert.equal(on.rev, 0, `경사로 위 높이 방향 바뀜 ${on.rev}번`);
  assert.ok(on.maxY >= B.Y - 0.02, `덱까지 다 오른 뒤 내려감(최고 ${on.maxY.toFixed(3)})`);
  const off = leadRun(false); // 갈고리 없음(복셀 오피스와 같은 판단) = 예전 동작: 경사로 가운데서 돎
  assert.ok(off.rev >= 1, '갈고리 없으면 경사로 가운데서 되돌아감(시험이 원인을 재현하는지)');
});
