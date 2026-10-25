// 복셀 오피스 배치 순수 함수 시험. 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOffice, stationFor, pathBetween, pathLength, CAT_FACILITY } from '../voxel/layout.js';

let ord = 0;
const N = (id, parentId, kind, extra = {}) => ({ id, parentId, kind, status: 'active', order: ord++, ...extra });

function tree() {
  ord = 0;
  const L = [
    N('s:main', null, 'main'),
    N('a:1', 's:main', 'subagent'), N('a:2', 's:main', 'subagent'), N('a:3', 'a:1', 'subagent'),
    N('w:run1', 's:main', 'workflow'), N('a:w1', 'w:run1', 'workflow-agent'), N('a:w2', 'w:run1', 'workflow-agent'),
    N('s:child1', 'a:w2', 'claude-p'), N('a:c1', 's:child1', 'subagent'),
    N('s:child2', 'a:c1', 'claude-p'), N('a:c2', 's:child2', 'subagent'),
    N('b:bg1', 's:main', 'bash-bg'), N('m:mon1', 's:main', 'monitor'), N('b:bg2', 'a:c1', 'bash-bg'),
  ];
  return L;
}

function bigTree(n = 60) {
  ord = 0;
  const L = [N('s:main', null, 'main')];
  let leads = ['s:main'];
  for (let i = 1; i < n; i++) {
    const r = (i * 7919) % 100;
    const parent = L[(i * 31) % L.length];
    const pid = parent.kind === 'bash-bg' || parent.kind === 'monitor' || parent.kind === 'workflow' ? 's:main' : parent.id;
    if (r < 55) L.push(N('a:' + i, pid, 'subagent'));
    else if (r < 65) L.push(N('b:' + i, pid, 'bash-bg'));
    else if (r < 72) L.push(N('m:' + i, pid, 'monitor'));
    else if (r < 80) { L.push(N('s:p' + i, pid, 'claude-p')); leads.push('s:p' + i); }
    else if (r < 85) L.push(N('w:' + i, 's:main', 'workflow'));
    else {
      const wf = L.filter((x) => x.kind === 'workflow');
      if (wf.length) L.push(N('a:wf' + i, wf[i % wf.length].id, 'workflow-agent'));
      else L.push(N('a:' + i, pid, 'subagent'));
    }
  }
  return L;
}

const strip = (lay) => JSON.stringify({
  rooms: lay.rooms.map((r) => ({ id: r.id, o: r.origin, s: r.size, desks: r.desks.map((d) => [d.x, d.z, d.occupant]) })),
  seat: [...lay.seat.entries()].sort(), machine: [...lay.machine.entries()].sort(), corridors: lay.corridors,
});

test('결정성: 같은 입력(순서 달라도) → 같은 결과', () => {
  const a = computeOffice(tree(), 's:main', null);
  const t = tree();
  const b = computeOffice(t.slice().reverse(), 's:main', null);
  const c = computeOffice(new Map(t.map((n) => [n.id, n])), 's:main', null);
  assert.equal(strip(a), strip(b));
  assert.equal(strip(a), strip(c));
});

test('방 구성: main 사무실·claude-p 별관 2·회의실 1, 노드마다 자리/기계', () => {
  const lay = computeOffice(tree(), 's:main', null);
  const ids = lay.rooms.map((r) => r.id).sort();
  assert.deepEqual(ids, ['m:w:run1', 'o:s:child1', 'o:s:child2', 'o:s:main']);
  for (const n of tree()) {
    if (n.kind === 'bash-bg' || n.kind === 'monitor' || n.kind === 'workflow') assert.ok(lay.machine.has(n.id), n.id);
    else assert.ok(lay.seat.has(n.id), n.id);
  }
  assert.equal(lay.seat.get('s:main').kind, 'lead');
  assert.equal(lay.seat.get('s:child1').kind, 'lead');
  assert.equal(lay.seat.get('a:1').kind, 'grid');
  assert.equal(lay.seat.get('a:3').kind, 'aux');              // 하위의 하위 → 부모 책상 옆
  assert.equal(lay.seat.get('a:w1').kind, 'meet');
  assert.equal(lay.seat.get('a:w1').roomId, 'm:w:run1');
  assert.equal(lay.seat.get('a:c1').roomId, 'o:s:child1');
  assert.equal(lay.machine.get('b:bg2').roomId, 'o:s:child1');  // 서브에이전트의 bg 는 그 세션 방
  assert.equal(lay.machine.get('b:bg1').type, 'rack');
  assert.equal(lay.machine.get('m:mon1').type, 'screen');
  assert.equal(lay.machine.get('w:run1').type, 'board');
  assert.ok(lay.corridors.length >= 3);
});

test('claude-p 깊이가 늘수록 별관 z 감소(더 안쪽)', () => {
  const lay = computeOffice(tree(), 's:main', null);
  const z = (id) => lay.rooms.find((r) => r.id === id).origin.z;
  assert.equal(z('o:s:main'), 0);
  assert.equal(z('o:s:child1'), -30);
  assert.ok(z('o:s:child2') < z('o:s:child1'));
});

test('살아 있는 노드끼리 책상 겹침 0, 방끼리 겹침 0 (60 노드)', () => {
  const lay = computeOffice(bigTree(60), 's:main', null);
  const byRoom = new Map();
  for (const [id, s] of lay.seat) {
    if (!byRoom.has(s.roomId)) byRoom.set(s.roomId, []);
    byRoom.get(s.roomId).push([id, s]);
  }
  for (const arr of byRoom.values()) {
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i][1], b = arr[j][1];
      const clash = Math.abs(a.deskX - b.deskX) < 1.4 && Math.abs(a.deskZ - b.deskZ) < 0.8 && a.kind !== 'meet' && b.kind !== 'meet';
      const sameMeet = a.kind === 'meet' && b.kind === 'meet' && a.slot === b.slot;
      assert.ok(!clash && !sameMeet, `${arr[i][0]} vs ${arr[j][0]}`);
    }
  }
  const mk = new Set();
  for (const m of lay.machine.values()) { const k = `${m.roomId}|${m.type}|${m.slot}`; assert.ok(!mk.has(k), k); mk.add(k); }
  const R = lay.rooms;
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const a = R[i].bounds, b = R[j].bounds;
    const overlap = a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
    assert.ok(!overlap, `${R[i].id} overlaps ${R[j].id}`);
  }
  // 모든 자리는 자기 방 안
  for (const s of lay.seat.values()) {
    const b = lay.rooms.find((r) => r.id === s.roomId).bounds;
    assert.ok(s.x > b.minX && s.x < b.maxX && s.z > b.minZ && s.z < b.maxZ, JSON.stringify(s));
  }
});

test('자리 고정: prev 를 넘기면 기존 노드 자리 유지, 퇴장 노드 자리는 반납', () => {
  const t = tree();
  const a = computeOffice(t, 's:main', null);
  // a:2 퇴장(목록에서 빠짐) + 새 노드 2 개
  const t2 = t.filter((n) => n.id !== 'a:2').concat([N('a:new1', 's:main', 'subagent'), N('a:new2', 's:main', 'subagent')]);
  const b = computeOffice(t2, 's:main', a);
  for (const id of ['a:1', 'a:3', 'a:w1', 'a:w2', 'a:c1', 's:main']) {
    assert.equal(b.seat.get(id).x, a.seat.get(id).x, id);
    assert.equal(b.seat.get(id).z, a.seat.get(id).z, id);
  }
  for (const id of ['b:bg1', 'm:mon1']) assert.equal(b.machine.get(id).slot, a.machine.get(id).slot);
  // 반납된 a:2 자리를 새 노드가 이어받음
  const freed = a.seat.get('a:2');
  assert.ok([b.seat.get('a:new1'), b.seat.get('a:new2')].some((s) => s.x === freed.x && s.z === freed.z));
  // prev 없이 같은 입력이면 앞선 노드는 그대로지만 순서상 자리가 달라질 수 있다 — prev 가 있으면 a:1 은 절대 안 움직인다
  const c = computeOffice([...t2].reverse(), 's:main', b);
  assert.equal(strip(b), strip(c));
});

test('책상 줄이 넘치면 방이 앞쪽으로 늘고 별관 줄이 같이 밀린다', () => {
  ord = 0;
  const L = [N('s:main', null, 'main')];
  for (let i = 0; i < 20; i++) L.push(N('a:' + i, 's:main', 'subagent'));
  L.push(N('s:p', 's:main', 'claude-p'));
  const lay = computeOffice(L, 's:main', null);
  const main = lay.rooms.find((r) => r.id === 'o:s:main');
  assert.ok(main.rows >= 5 && main.size.d > 18);
  assert.equal(main.bounds.minZ, -9); // 뒤 벽은 그대로
  const ann = lay.rooms.find((r) => r.id === 'o:s:p');
  assert.ok(ann.bounds.maxZ <= main.bounds.minZ - 11.9);
});

test('stationFor: 접근점 → 대기 자리 → null', () => {
  const lay = computeOffice(tree(), 's:main', null);
  const room = lay.rooms.find((r) => r.id === 'o:s:main');
  for (const cat of Object.keys(CAT_FACILITY)) assert.ok(stationFor(cat, room, 0), cat);
  const n = room.stations.read.length;
  assert.ok(n >= 2 && n <= 4);
  assert.ok(stationFor('read', room, n));          // 대기 자리
  assert.equal(stationFor('read', room, n + 3), null);
  assert.equal(stationFor('write', room, 0), null);  // 자기 책상
  const meet = lay.rooms.find((r) => r.type === 'meeting');
  assert.ok(stationFor('read', meet, 0));
  assert.equal(stationFor('web', meet, 0), null);    // 회의실엔 없음 → 제자리
});

test('pathBetween: 가로·세로 꺾은선, 끝점 일치, 책상은 옆으로 나와 앞 통로', () => {
  const lay = computeOffice(tree(), 's:main', null);
  const room = lay.rooms.find((r) => r.id === 'o:s:main');
  const seat = lay.seat.get('a:1');
  const st = stationFor('shell', room, 0);
  const p = pathBetween({ ...seat }, st, room);
  assert.deepEqual([p[0].x, p[0].z], [seat.x, seat.z]);
  assert.deepEqual([p.at(-1).x, p.at(-1).z], [st.x, st.z]);
  for (let i = 1; i < p.length; i++) assert.ok(Math.abs(p[i].x - p[i - 1].x) < 1e-9 || Math.abs(p[i].z - p[i - 1].z) < 1e-9, 'axis aligned');
  assert.ok(Math.abs(p[1].x - seat.x) > 1); // 옆으로 먼저
  assert.ok(p.some((q) => Math.abs(q.z - (seat.deskZ + 1.7)) < 1e-9)); // 책상 앞 통로
  const back = pathBetween(st, { ...seat }, room);
  assert.equal(pathLength(back).toFixed(6), pathLength(p).toFixed(6));
  const door = pathBetween(room.door, { ...seat }, room);
  assert.deepEqual([door.at(-1).x, door.at(-1).z], [seat.x, seat.z]);
});

test('성능: 60 노드 computeOffice < 5ms', () => {
  const L = bigTree(60);
  let prev = null;
  for (let i = 0; i < 20; i++) prev = computeOffice(L, 's:main', prev); // 예열
  // 여러 시험 파일이 동시에 돌아 CPU 를 다투면 평균이 튄다(예전 간헐 실패). 묶음 5개 중 가장 빠른 묶음의 평균으로 잰다
  const K = 50;
  let ms = Infinity;
  for (let b = 0; b < 5; b++) {
    const t0 = performance.now();
    for (let i = 0; i < K; i++) prev = computeOffice(L, 's:main', prev);
    ms = Math.min(ms, (performance.now() - t0) / K);
  }
  assert.ok(ms < 5, `${ms.toFixed(3)}ms`);
});

test('빈 입력·루트 없음·순환 부모도 죽지 않음', () => {
  assert.equal(computeOffice([], null, null).rooms.length, 0);
  ord = 0;
  const L = [N('a:x', 'a:y', 'subagent'), N('a:y', 'a:x', 'subagent'), N('b:z', 'a:x', 'bash-bg')];
  const lay = computeOffice(L, null, null);
  assert.equal(lay.rooms.length, 1);
  assert.equal(lay.seat.size + lay.machine.size, 3);
});
