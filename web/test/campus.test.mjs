// 복셀 캠퍼스 배치 순수 함수 시험. 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCampus, BLDG_GAP } from '../voxel/campus.mjs';
import { computeOffice } from '../voxel/layout.js';

let ord = 0;
const N = (id, parentId, kind, projectId, extra = {}) => ({ id, parentId, kind, projectId, status: 'active', order: ord++, meta: {}, lastActivityAt: '2026-10-23T05:00:00Z', ...extra });

function world(spec = [[6, 3], [4], [5]]) {
  ord = 0;
  const list = [];
  const roots = [];
  const projects = [];
  spec.forEach((mains, i) => {
    const pid = 'p' + i;
    projects.push({ projectId: pid, name: 'P' + i, live: true, active: i === 0 });
    mains.forEach((k, j) => {
      const mid = `s:${pid}m${j}`;
      list.push(N(mid, null, 'main', pid));
      roots.push({ nodeId: mid, projectId: pid });
      for (let c = 0; c < k; c++) {
        const kind = c === 1 ? 'bash-bg' : c === 2 ? 'monitor' : c === 3 ? 'workflow' : c === 4 ? 'claude-p' : 'subagent';
        const parent = c === 5 ? `a:${pid}m${j}c3` : mid;
        list.push(N(`a:${pid}m${j}c${c}`, parent, c === 5 ? 'workflow-agent' : kind, pid));
      }
    });
  });
  return { list, roots, projects };
}

const strip = (lay) => JSON.parse(JSON.stringify({ rooms: lay.rooms, seat: [...lay.seat], machine: [...lay.machine], corridors: lay.corridors }));
const clash = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

test('결정적', () => {
  const w = world();
  const a = computeCampus(w.list, w.roots, w.projects, null, { nowMs: 0 });
  const b = computeCampus(world().list, w.roots, w.projects, null, { nowMs: 0 });
  assert.deepEqual(strip(a), strip(b));
  assert.deepEqual(a.buildings.map((x) => [x.projectId, x.origin, x.size]), b.buildings.map((x) => [x.projectId, x.origin, x.size]));
});

test('동끼리 겹침 0, 같은 동 사무실끼리 겹침 0', () => {
  const w = world([[6, 5, 4], [4, 4], [5], [3], [7], [2]]);
  const r = computeCampus(w.list, w.roots, w.projects, null, { nowMs: 0 });
  assert.equal(r.buildings.length, 6);
  for (let i = 0; i < r.buildings.length; i++) for (let j = i + 1; j < r.buildings.length; j++) {
    assert.ok(!clash(r.buildings[i].bounds, r.buildings[j].bounds), `${r.buildings[i].projectId}·${r.buildings[j].projectId} 겹침`);
  }
  for (let i = 0; i < r.rooms.length; i++) for (let j = i + 1; j < r.rooms.length; j++) {
    assert.ok(!clash(r.rooms[i].bounds, r.rooms[j].bounds), `${r.rooms[i].id}·${r.rooms[j].id} 방 겹침`);
  }
  // 모든 방은 자기 프로젝트 동 안
  for (const room of r.rooms) {
    const b = r.buildings.find((x) => x.projectId === room.projectId);
    assert.ok(room.bounds.minX >= b.bounds.minX - 1e-6 && room.bounds.maxX <= b.bounds.maxX + 1e-6 && room.bounds.minZ >= b.bounds.minZ - 1e-6 && room.bounds.maxZ <= b.bounds.maxZ + 1e-6);
  }
});

test('메인 하나·프로젝트 하나 = computeOffice 결과(오프셋 0)', () => {
  const w = world([[6]]);
  const r = computeCampus(w.list, w.roots, w.projects, null, { nowMs: 0 });
  const base = computeOffice(world([[6]]).list, 's:p0m0', null);
  assert.deepEqual(strip(r), strip({ ...base, rooms: base.rooms.map((x) => ({ ...x, projectId: 'p0', projectName: 'P0' })) }));
  assert.deepEqual(r.buildings[0].origin, { x: 0, z: 0 });
  assert.equal(r.rootId, 's:p0m0');
});

test('자리 고정: 다른 동에 직원이 늘어도 자리·동 원점 유지', () => {
  const w = world([[4], [4], [4]]);
  const a = computeCampus(w.list, w.roots, w.projects, null, { nowMs: 0 });
  const w2 = world([[4], [4], [4]]);
  w2.list.push(N('a:extra1', 's:p1m0', 'subagent', 'p1'), N('a:extra2', 's:p1m0', 'subagent', 'p1'));
  const b = computeCampus(w2.list, w2.roots, w2.projects, a, { nowMs: 0 });
  for (const [id, s] of a.seat) {
    const s2 = b.seat.get(id);
    assert.ok(s2, id);
    assert.equal(s2.x, s.x, id); assert.equal(s2.z, s.z, id);
  }
  for (const bd of a.buildings) assert.deepEqual(b.buildings.find((x) => x.projectId === bd.projectId).origin, bd.origin);
});

test('자리 고정: 같은 동 안에서도 기존 직원 책상 유지', () => {
  const w = world([[3, 2]]);
  const a = computeCampus(w.list, w.roots, w.projects, null, { nowMs: 0 });
  const w2 = world([[3, 2]]);
  // 앞 직원 하나 퇴장(목록에서 빠짐) + 새 직원
  const gone = w2.list.findIndex((n) => n.id === 'a:p0m0c0');
  w2.list.splice(gone, 1);
  w2.list.push(N('a:new', 's:p0m0', 'subagent', 'p0'));
  const b = computeCampus(w2.list, w2.roots, w2.projects, a, { nowMs: 0 });
  for (const [id, s] of a.seat) { if (id === 'a:p0m0c0') continue; const s2 = b.seat.get(id); assert.equal(s2.x, s.x, id); assert.equal(s2.z, s.z, id); }
});

test('recent 루트 숨김 → 낮은 상자 동, 활성 동이 앞줄', () => {
  const w = world([[3], [3]]);
  w.list.find((n) => n.id === 's:p1m0').meta = { tier: 'recent', live: false };
  w.projects[1].live = false; w.projects[1].active = false;
  const r = computeCampus(w.list, w.roots, w.projects, null, { nowMs: 0 });
  const b1 = r.buildings.find((x) => x.projectId === 'p1');
  assert.equal(b1.recent, true);
  assert.equal(b1.offices.length, 0);
  assert.ok(r.hidden.has('s:p1m0'));
  assert.ok(!r.seat.has('s:p1m0'));
  const b0 = r.buildings.find((x) => x.projectId === 'p0');
  assert.deepEqual(b0.slot, { col: 0, row: 0 });
  const s = computeCampus(w.list, w.roots, w.projects, null, { nowMs: 0, showInactive: true });
  assert.ok(s.seat.has('s:p1m0'));
});

test('격자 간격: 같은 줄 이웃 동 사이 12 이상, 열 폭은 그 열 가장 넓은 동 기준', () => {
  const w = world([[6, 5], [2], [2], [2]]);
  const r = computeCampus(w.list, w.roots, w.projects, null, { nowMs: 0 });
  for (const a of r.buildings) for (const b of r.buildings) {
    if (a === b || a.slot.row !== b.slot.row) continue;
    const gap = Math.max(b.bounds.minX - a.bounds.maxX, a.bounds.minX - b.bounds.maxX);
    assert.ok(gap >= BLDG_GAP - 2 * 2 - 1e-6, `${a.projectId}·${b.projectId} 간격 ${gap}`); // 바닥판 여백(2)씩 포함
  }
  const widest = Math.max(...r.buildings.map((b) => b.size.w));
  assert.ok(r.grid.colW >= widest + BLDG_GAP - 1e-6);
  // 넓은 동 하나 때문에 모든 열이 넓어지지 않음
  const span = Math.max(...r.buildings.map((b) => b.bounds.maxX)) - Math.min(...r.buildings.map((b) => b.bounds.minX));
  assert.ok(span < 3 * (widest + BLDG_GAP), `전체 폭 ${span}`);
});

test('메인 4개 넘으면 동 안에서 다음 줄로(방 겹침 0, 동 폭 제한)', () => {
  const w = world([[6, 5, 4, 6, 3], [2]]);
  const r = computeCampus(w.list, w.roots, w.projects, null, { nowMs: 0 });
  for (let i = 0; i < r.rooms.length; i++) for (let j = i + 1; j < r.rooms.length; j++) assert.ok(!clash(r.rooms[i].bounds, r.rooms[j].bounds), `${r.rooms[i].id}·${r.rooms[j].id}`);
  const b0 = r.buildings.find((b) => b.projectId === 'p0');
  assert.equal(b0.offices.length, 5);
  assert.ok(b0.offices[3].offset.z < 0 && b0.offices[3].offset.x === 0, '넷째 사무실은 뒷줄 첫 자리');
  const one = computeCampus(world([[6]]).list, [{ nodeId: 's:p0m0', projectId: 'p0' }], w.projects.slice(0, 1), null, { nowMs: 0 });
  assert.ok(b0.size.w <= 3.2 * one.buildings[0].size.w + 3 * 4);
});

test('성능: 동 6 · 노드 80 < 10ms', () => {
  const w = world([[14], [13], [12], [12], [11], [12]]);
  assert.ok(w.list.length >= 80);
  computeCampus(w.list, w.roots, w.projects, null, { nowMs: 0 });
  // 여러 시험 파일이 동시에 돌아 CPU 를 다투면 평균이 튄다(예전 간헐 실패). 묶음 5개 중 가장 빠른 묶음의 평균으로 잰다
  let ms = Infinity;
  for (let b = 0; b < 5; b++) {
    const t0 = performance.now();
    let prev = null;
    for (let i = 0; i < 10; i++) prev = computeCampus(world([[14], [13], [12], [12], [11], [12]]).list, w.roots, w.projects, prev, { nowMs: 0 });
    ms = Math.min(ms, (performance.now() - t0) / 10);
  }
  assert.ok(ms < 10, `평균 ${ms.toFixed(2)}ms`);
});
