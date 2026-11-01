// node --test "web/test/lab-layout.test.mjs"   복셀 연구소 캐릭터·책상·지휘석(characters 담당): 다중 live 메인 구역(브리지 나눔)·
// 출입문·라운지 틈 · 하위의 하위 책상 · 구역 상한 넘는 메인 · 경로 기하(경사로·장애물·끝점) · FieldPlanner(간격·인원·배속·대기) ·
// 충돌 방문 자리 · walkKindFor · 성능
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAB, LAB_PERF, dTheta, thetaOf, worldToBridge } from '../lab/lab-const.mjs';
import { computeLab, labFloorY, labZones, zoneGaps, labDoorTheta, labLoungeTheta, deskRow, zoneOfTheta, ZONE_MAX } from '../lab/lab-layout-core.mjs';
import { FieldPlanner, WALK_RULES, walkKindFor, rimSpotFor, rigFrontSpot, conflictSpots } from '../lab/lab-walk-core.mjs';
import { navPath } from '../voxel/nav-core.mjs';

/** 메인 nMain 개(m0 = 루트), 메인마다 서브 nSub, bg 는 메인마다 nBg */
function multi(nMain, nSub = 4, nBg = 1) {
  const a = [];
  let o = 0;
  for (let m = 0; m < nMain; m++) a.push({ id: 'm' + m, kind: 'main', order: o++, status: 'active' });
  for (let m = 0; m < nMain; m++) {
    for (let i = 0; i < nSub; i++) a.push({ id: `s${m}_${i}`, kind: 'subagent', parentId: 'm' + m, order: o++, status: 'active' });
    for (let i = 0; i < nBg; i++) a.push({ id: `b${m}_${i}`, kind: 'bash-bg', parentId: 'm' + m, order: o++, status: 'active' });
  }
  return a;
}
/** 길 위 점이 장애물 상자 안으로 들어가지 않는지(0.1 간격 표본) */
function clearOf(path, boxes, pad = 0.05) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1));
    for (let k = 0; k <= n; k++) {
      const x = a.x + (b.x - a.x) * (k / n), z = a.z + (b.z - a.z) * (k / n);
      for (const q of boxes) if (x > q.minX + pad && x < q.maxX - pad && z > q.minZ + pad && z < q.maxZ - pad) return { x, z, kind: q.kind };
    }
  }
  return null;
}
const endsAt = (p, b) => p && Math.hypot(p[p.length - 1].x - b.x, p[p.length - 1].z - b.z) < 1e-6;
/** 점이 어떤 브리지(덱 + 경사로 + 난간 여유) 발자국 안인지 */
function inBridge(lab, x, z, pad = 0.3) {
  const B = LAB.BRIDGE;
  for (const f of lab.bridges) {
    const p = worldToBridge(f, x, z);
    if (p.u > -B.D / 2 - pad && p.u < B.D / 2 + pad && Math.abs(p.v) < B.W / 2 + pad) return true;
    if (p.u > -B.D / 2 - pad && p.u < -B.D / 2 + B.RAMP_W + pad && Math.abs(p.v) < B.W / 2 + B.RAMP_L + pad) return true;
  }
  return false;
}

test('구역: 1 = 단일 그대로, 2 마주 봄 · 3 삼각 · 4 사분, 말굽 반폭 = min(120, (360/n − 20)/2), 상한 6', () => {
  assert.deepEqual(labZones(1).map((z) => [z.theta, z.half]), [[LAB.BRIDGE_THETA, LAB.HORSESHOE_HALF]]);
  const z2 = labZones(2); assert.equal(Math.abs(dTheta(z2[0].theta, z2[1].theta)), 180); assert.equal(z2[0].half, 80);
  const z3 = labZones(3); for (let i = 0; i < 3; i++) assert.ok(Math.abs(Math.abs(dTheta(z3[i].theta, z3[(i + 1) % 3].theta)) - 120) < 1e-9);
  const z4 = labZones(4); assert.deepEqual(z4.map((z) => z.theta), [225, 315, 45, 135]); assert.equal(z4[0].half, 35);
  assert.equal(labZones(9).length, ZONE_MAX);
  assert.equal(labDoorTheta(labZones(1)), LAB.FRONT.DOOR); assert.equal(labLoungeTheta(labZones(1)), LAB.FRONT.LOUNGE);
  for (let n = 2; n <= ZONE_MAX; n++) {
    const zs = labZones(n), gaps = zoneGaps(zs), d = labDoorTheta(zs), l = labLoungeTheta(zs);
    assert.ok(gaps.some((g) => Math.abs(dTheta(g, d)) < 1e-9), `n=${n} 출입문 = 틈`);
    assert.ok(gaps.some((g) => Math.abs(dTheta(g, l)) < 1e-9) && Math.abs(dTheta(d, l)) > 1, `n=${n} 라운지 = 다른 틈`);
    for (const z of zs) for (const s of deskRow(0, 0, 9, 0, z.theta, z.half)) assert.ok(Math.abs(dTheta(z.theta, s.theta)) <= z.half + 1e-9);
  }
});

for (const n of [2, 3, 4, 5]) {
  test(`다중 메인 ${n}: 구역 방 ${n} · 자기 브리지 · 자기 구역 책상 · 겹침 0 · 시설·라운지가 브리지 밖 · 외벽 안`, () => {
    const L = computeLab(multi(n, 6, 2), 'm0', null);
    assert.equal(L.rooms.length, n);
    const lab0 = L.rooms[0].lab;
    assert.equal(lab0.bridges.length, n);
    assert.ok(L.rooms.every((r, i) => r.lab.zone === i && r.lab.primary === (i === 0) && r.navBoxes === L.rooms[0].navBoxes && r.stations === L.rooms[0].stations));
    for (let m = 0; m < n; m++) {
      const s = L.seat.get('m' + m), room = L.rooms.find((r) => r.id === s.roomId);
      assert.equal(s.kind, 'lead'); assert.equal(room.ownerId, 'm' + m);
      assert.equal(labFloorY(room.lab, s.x, s.z), LAB.BRIDGE.Y, '팀장은 자기 브리지 덱');
      assert.ok(Math.abs(dTheta(room.lab.bridge.theta, thetaOf(0, 0, s.x, s.z))) < 1, '브리지 방위');
      for (let i = 0; i < 6; i++) { const q = L.seat.get(`s${m}_${i}`); assert.equal(q.zone, s.zone, '팀원은 메인 구역'); assert.ok(Math.abs(dTheta(room.lab.bridge.theta, thetaOf(0, 0, q.deskX, q.deskZ))) <= room.lab.zones[s.zone].half + 1e-6); }
    }
    const desks = L.rooms.flatMap((r) => r.desks);
    for (let i = 0; i < desks.length; i++) for (let j = i + 1; j < desks.length; j++) assert.ok(Math.hypot(desks[i].x - desks[j].x, desks[i].z - desks[j].z) > LAB.DESK.W * 0.95);
    for (const d of desks) assert.ok(!inBridge(lab0, d.x, d.z, 0.6), '책상이 브리지·경사로 밖');
    const R = lab0.R;
    const spots = [...Object.values(L.rooms[0].stations).flat(), ...L.rooms[0].breakSlots, L.rooms[0].door];
    for (const sp of spots) { assert.ok(!inBridge(lab0, sp.x, sp.z, 0.2), `시설 자리가 브리지 밖 ${sp.x.toFixed(1)},${sp.z.toFixed(1)}`); assert.ok(Math.hypot(sp.x, sp.z) < R.rWall); }
    for (const s of L.seat.values()) assert.ok(Math.hypot(s.x, s.z) < R.rWall - 0.5);
    for (const m of L.machine.values()) if (m.type === 'batch') assert.ok(!inBridge(lab0, m.x, m.z, 0.1) && Math.hypot(m.x, m.z) < R.rWall - 1, '시퀀서가 브리지·외벽 밖');
  });

  test(`경로 기하(메인 ${n}): 팀장 → 출입문(경사로) · 팀장 → 통신 스크린(덱 위) · 직원 → 시설·라운지·가장자리·기자재 앞, 장애물 통과 없음`, () => {
    const L = computeLab(multi(n, 5, 2), 'm0', null);
    for (let m = 0; m < n; m++) {
      const lead = L.seat.get('m' + m), room = L.rooms.find((r) => r.id === lead.roomId);
      const p = navPath(lead, room.door, room);
      assert.ok(endsAt(p, room.door), `m${m} 출입문까지`);
      assert.equal(clearOf(p, room.navBoxes), null);
      const ys = p.flatMap((q, i) => (i ? [labFloorY(room.lab, (q.x + p[i - 1].x) / 2, (q.z + p[i - 1].z) / 2)] : []).concat(labFloorY(room.lab, q.x, q.z))); // 꼭짓점 + 조각 가운데(경사로는 축 한 조각 — 11.01.)
      assert.ok(ys.some((y) => y > 0.05 && y < LAB.BRIDGE.Y - 0.05), '경사로 중간 높이');
      const c = navPath(lead, room.client.spot, room);
      assert.ok(endsAt(c, room.client.spot), '통신 스크린 앞');
      assert.ok(c.every((q) => labFloorY(room.lab, q.x, q.z) === LAB.BRIDGE.Y), '덱에서 내려가지 않음');
      const s = L.seat.get(`s${m}_0`);
      const targets = [room.stations.skill[0], room.stations.mcp[1], room.stations.agent[2], room.stations.monitor[0], room.stations.notify[0], room.breakSlots[0], room.breakSlots[5], room.door, rimSpotFor(room, (room.lab.bridge.theta + 180) % 360)];
      const rig = L.machine.get(`b${m}_0`);
      if (rig && rig.type === 'rig') for (let i = 0; i < 4; i++) targets.push(rigFrontSpot(room, rig, i));
      for (const b of targets) {
        const q = navPath(s, b, room);
        assert.ok(endsAt(q, b), `m${m} 목적지에 정확히(막힌 칸 아님) ${b.x.toFixed(2)},${b.z.toFixed(2)}`);
        assert.equal(clearOf(q, room.navBoxes), null);
        assert.ok(q.every((pt) => labFloorY(room.lab, pt.x, pt.z) < 0.01), '바닥 사람은 브리지에 오르지 않음');
      }
    }
  });
}

test('경로: 기자재 고리가 꽉 차도 가장자리 36칸 모두 출입문에서 방사 통로로 닿음', () => {
  const ns = [{ id: 'm', kind: 'main', order: 0 }];
  for (let i = 0; i < 40; i++) ns.push({ id: 'b' + i, kind: 'bash-bg', parentId: 'm', order: 1 + i });
  const L = computeLab(ns, 'm', null), r = L.rooms[0];
  assert.equal([...L.machine.values()].filter((m) => m.type === 'rig' && !m.shelf).length, r.lab.rigSlots.length, '고리 가득');
  for (const s of r.lab.rimSlots) {
    const p = navPath(r.door, s, r);
    assert.ok(endsAt(p, s), `가장자리 ${s.i}`); assert.equal(clearOf(p, r.navBoxes), null);
    const minR = Math.min(...p.map((q) => Math.hypot(q.x, q.z)));
    assert.ok(minR > r.lab.rP, '플랫폼 단에 오르지 않음');
  }
});

test('구역 자리 고정: 메인이 늘어도 기존 메인 구역 순서 유지 · 같은 입력이면 같은 자리 · 줄면 열 수 유지', () => {
  const a = computeLab(multi(2, 3, 0), 'm0', null);
  const ns3 = multi(2, 3, 0).concat([{ id: 'm9', kind: 'main', order: -5, status: 'active' }]); // 순서상 앞이어도 새 메인은 뒤 구역
  const b = computeLab(ns3, 'm0', a);
  assert.equal(b.rooms.length, 3);
  assert.deepEqual(b.rooms.map((r) => r.ownerId), ['m0', 'm1', 'm9']);
  const c = computeLab(ns3, 'm0', b);
  for (const [id, s] of b.seat) { const q = c.seat.get(id); assert.ok(q && Math.hypot(s.x - q.x, s.z - q.z) < 1e-9, id); }
  assert.equal(zoneOfTheta(b.rooms[0].lab, b.rooms[2].lab.bridge.theta + 3), 2);
});

test('하위의 하위: 부모 책상 각에 가장 가까운 빈 책상 · 구역이 차면 이웃 구역', () => {
  const ns = [{ id: 'm', kind: 'main', order: 0 }];
  for (let i = 0; i < 8; i++) ns.push({ id: 's' + i, kind: 'subagent', parentId: 'm', order: 1 + i });
  ns.push({ id: 'g', kind: 'subagent', parentId: 's7', order: 50 });
  const L = computeLab(ns, 'm', null), p = L.seat.get('s7'), g = L.seat.get('g');
  const tp = thetaOf(0, 0, p.deskX, p.deskZ), tg = thetaOf(0, 0, g.deskX, g.deskZ);
  for (const d of L.rooms[0].desks) if (d.occupant !== 'g' && d.occupant !== 's7') assert.ok(Math.abs(dTheta(tp, d.theta)) >= Math.abs(dTheta(tp, tg)) - 1e-9 || d.row < g.row, '가장 가까운 빈칸');
  assert.equal(g.parent, 's7');
  // 6구역: 구역당 1열 책상이 적어 넘치면 이웃 구역
  const M = multi(6, 0, 0);
  for (let i = 0; i < 40; i++) M.push({ id: 'x' + i, kind: 'subagent', parentId: 'm0', order: 100 + i });
  const L2 = computeLab(M, 'm0', null);
  for (let i = 0; i < 40; i++) assert.ok(L2.seat.get('x' + i), '모두 자리');
  assert.ok([...L2.seat.values()].some((s) => s.kind === 'grid' && s.zone !== 0), '이웃 구역으로 넘침');
});

test('구역 상한을 넘는 메인: 기존 브리지 덱 위 자리(팀장), 덱 높이', () => {
  const L = computeLab(multi(8, 0, 0), 'm0', null);
  assert.equal(L.rooms.length, ZONE_MAX);
  for (const id of ['m6', 'm7']) {
    const s = L.seat.get(id), room = L.rooms.find((r) => r.id === s.roomId);
    assert.equal(s.kind, 'lead'); assert.ok(s.extra);
    assert.equal(labFloorY(room.lab, s.x, s.z), LAB.BRIDGE.Y);
    const p = navPath(s, room.door, room); assert.ok(endsAt(p, room.door)); assert.equal(clearOf(p, room.navBoxes), null);
  }
});

test('walkKindFor: 위험 > 끄기 > 들여다보기 > 설치 > 현장 투입', () => {
  assert.equal(walkKindFor({ act: 'build' }), 'field');
  assert.equal(walkKindFor({ act: 'build', danger: true }), 'alarm');
  assert.equal(walkKindFor({ tool: 'KillShell' }), 'kill');
  assert.equal(walkKindFor({ tool: 'TaskStop' }), 'kill');
  assert.equal(walkKindFor({ tool: 'BashOutput' }), 'watch');
  assert.equal(walkKindFor({ cat: 'monitor' }), 'watch');
  assert.equal(walkKindFor({ spawnBg: true }), 'install');
  assert.equal(walkKindFor({ act: 'edit' }), null); assert.equal(walkKindFor(null), null);
});

test('FieldPlanner: 한 사람 20초 간격 · 가장자리 동시 3명 · 배속 8 이상 걷지 않음 · 칸이 겹치지 않음 · 머무름', () => {
  const L = computeLab(multi(1, 6, 1), 'm0', null), room = L.rooms[0];
  const fp = new FieldPlanner();
  const t = { room, theta: 90 };
  assert.equal(fp.want('field', 's0_0', t, 0, 8), null, '배속 8');
  const a = fp.want('field', 's0_0', t, 0, 1);
  assert.ok(a && a.spot && Math.abs(dTheta(90, thetaOf(0, 0, a.spot.x, a.spot.z))) <= 10 + 1e-6);
  assert.ok(Math.abs(a.until - WALK_RULES.field.stay) < 1e-9);
  const b = fp.want('field', 's0_1', t, 0.1, 1), c = fp.want('field', 's0_2', t, 0.2, 1);
  assert.ok(b && c);
  const keys = new Set([a, b, c].map((r) => r.spot.x.toFixed(3) + ',' + r.spot.z.toFixed(3)));
  assert.equal(keys.size, 3, '서로 다른 칸');
  assert.equal(fp.want('field', 's0_3', t, 0.3, 1), null, '넷째는 걷지 않음');
  assert.equal(fp.busyRim(0.3), 3);
  // 만료 뒤 다시 가능, 같은 사람은 20초 안 안 됨
  assert.ok(fp.want('field', 's0_3', t, 5, 1));
  assert.equal(fp.want('field', 's0_0', t, 10, 1), null, '간격 안');
  assert.ok(fp.want('field', 's0_0', t, 20.5, 1), '간격 뒤');
  // busy(다른 장부 인원)도 센다
  const fp2 = new FieldPlanner();
  assert.equal(fp2.want('alarm', 'x', t, 0, 1, 3), null);
  const al = fp2.want('alarm', 'x', { room, x: 0, z: -5 }, 0, 4);
  assert.ok(Math.abs(al.until - WALK_RULES.alarm.stay / 2) < 1e-9, '배속 4 → ÷2');
  assert.ok(Math.abs(dTheta(180, thetaOf(0, 0, al.spot.x, al.spot.z))) <= 10 + 1e-6, '블록 자리 → 방위');
  // 걷는 시간 추정
  const s = L.seat.get('s0_4'), w = new FieldPlanner().want('field', 'y', { room, theta: 90, from: s }, 0, 1);
  assert.ok(w.until > WALK_RULES.field.stay + 1, '걷는 시간 더함');
  fp.clear(); assert.equal(fp.busyRim(100), 0);
});

test('FieldPlanner: 기자재 앞 2 + 대기 2, 다섯째 null · 대기 칸은 한 걸음 바깥 · watch 는 작업 끝까지(상한 60초) · release', () => {
  const L = computeLab(multi(1, 6, 1), 'm0', null), room = L.rooms[0], rig = L.machine.get('b0_0');
  assert.equal(rig.type, 'rig');
  const fp = new FieldPlanner(), t = { room, rig };
  const got = ['a', 'b', 'c', 'd'].map((id) => fp.want('install', id, t, 0, 1));
  assert.ok(got.every(Boolean));
  assert.deepEqual(got.map((g) => g.queue), [false, false, true, true]);
  const rr = (g) => Math.hypot(g.spot.x, g.spot.z);
  assert.ok(rr(got[2]) > rr(got[0]) + 0.5, '대기는 바깥');
  for (const g of got) assert.ok(rr(g) > Math.hypot(rig.x, rig.z) + LAB.RIG.SIZE / 2 + 0.2 && rr(g) < L.rooms[0].lab.R.rWalkOut, '기자재 바깥 앞 · 순환 통로 안');
  assert.equal(fp.want('kill', 'e', t, 0, 1), null);
  fp.release('a');
  assert.equal(fp.want('kill', 'e', t, 0, 1).queue, false, '빈 앞 칸');
  const w = new FieldPlanner().want('watch', 'z', { room, rig, until: 30 }, 0, 1);
  assert.equal(w.until, 30);
  const w2 = new FieldPlanner().want('watch', 'z', { room, rig, until: 500 }, 0, 1);
  assert.equal(w2.until, WALK_RULES.watch.waitMax);
  assert.equal(new FieldPlanner().want('watch', 'z', { room, rig }, 0, 1).until, WALK_RULES.watch.peek);
  assert.equal(new FieldPlanner().want('install', 'z', { room }, 0, 1), null, '기자재 없음');
});

test('충돌 방문 자리: 블록 방위 가장자리 양옆 두 칸, 서로 마주 봄, 출입문·책상에서 닿음', () => {
  const L = computeLab(multi(2, 3, 0), 'm0', null);
  for (const room of L.rooms) {
    const [a, b] = conflictSpots(room, 130);
    assert.ok(a && b && a.visit && b.visit);
    assert.ok(Math.abs(Math.sin(a.face - Math.atan2(b.x - a.x, b.z - a.z))) < 1e-9 && Math.cos(a.face - Math.atan2(b.x - a.x, b.z - a.z)) > 0, '마주 봄');
    const s = L.seat.get(room.ownerId);
    for (const sp of [a, b]) { const p = navPath(s, sp, room); assert.ok(endsAt(p, sp)); assert.equal(clearOf(p, room.navBoxes), null); }
  }
});

test('바닥 높이: 구역 브리지마다 1.6, 그 밖 0', () => {
  const L = computeLab(multi(3, 0, 0), 'm0', null), lab = L.rooms[1].lab;
  for (const f of lab.bridges) assert.equal(labFloorY(lab, f.c.x, f.c.z), LAB.BRIDGE.Y);
  assert.equal(labFloorY(lab, 0, 0), 0);
  assert.equal(labFloorY(null, 0, 0), 0);
});

test('성능: 메인 4 + 60 노드 computeLab < 5ms(5회 중 최소)', () => {
  const ns = multi(4, 11, 3);
  assert.ok(ns.length >= 60);
  let best = Infinity, prev = null;
  for (let k = 0; k < 5; k++) { const t0 = performance.now(); prev = computeLab(ns, 'm0', prev); best = Math.min(best, performance.now() - t0); }
  assert.ok(best < LAB_PERF.LAYOUT_MS_60, `${best.toFixed(2)}ms`);
  assert.ok(prev.rooms[0].navBoxes.length <= 2000 * 2, `장애물 ${prev.rooms[0].navBoxes.length}`);
});
