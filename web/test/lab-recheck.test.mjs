// node --test "web/test/lab-recheck.test.mjs"   복셀 연구소 화면 재확인 수리(11.01.): 원형 방 길은 계단 꺾은선 대신 직선으로 당김(pull) ·
// 당긴 길도 가구·벽 상자를 지나지 않음 · 오피스 방 길은 그대로 가로·세로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLab } from '../lab/lab-layout-core.mjs';
import { navPath, navPathBlocked } from '../voxel/nav-core.mjs';

function nodes(nSub = 10, nBg = 6) {
  const a = [{ id: 'm0', kind: 'main', order: 0, status: 'active' }];
  let o = 1;
  for (let i = 0; i < nSub; i++) a.push({ id: 's' + i, kind: 'subagent', parentId: 'm0', order: o++, status: 'active' });
  for (let i = 0; i < nBg; i++) a.push({ id: 'b' + i, kind: 'bash-bg', parentId: 'm0', order: o++, status: 'active' });
  return a;
}

test('연구소 길: 대각선 구간이 있고(계단 아님) 상자를 지나지 않음', () => {
  const L = computeLab(nodes(), 'm0', null), room = L.rooms[0];
  let diag = 0, n = 0;
  const ids = [...L.seat.keys()].filter((k) => k !== 'm0');
  for (const a of ids) for (const b of [room.door, ...ids.slice(0, 4).map((k) => L.seat.get(k))]) {
    const p = navPath(L.seat.get(a), b, room);
    if (!p) continue;
    n++;
    for (let i = 1; i < p.length; i++) if (Math.abs(p[i].x - p[i - 1].x) > 0.3 && Math.abs(p[i].z - p[i - 1].z) > 0.3) diag++;
    assert.equal(navPathBlocked(room, p.slice(1, -1)), false, `${a} → 상자 통과`);
  }
  assert.ok(n > 20);
  assert.ok(diag > n / 2, `대각선 구간 ${diag} / 길 ${n}`);
});
