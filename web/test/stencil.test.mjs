// 복셀 바닥 스텐실: 이름 → 줄 나누기·줄임, 구역(책상·대기석·벽 피함), 크기 맞춤, 돌린 방 방향, 동마다 하나·이름 출처
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STENCIL, stencilLines, stencilZone, stencilPlace, linesAspect, stencilTargets, sessionProjectName, stencilStyle, buildingOffice } from '../voxel/stencil-core.mjs';
import { computeOffice, DESK_Z0, ROW_STEP, WAIT_Z } from '../voxel/layout.js';
import { computeCampus } from '../voxel/campus.mjs';
import { rotateOffice } from '../voxel/xf.mjs';
import fs from 'node:fs';

let ord = 0;
const N = (id, parentId, kind, extra = {}) => ({ id, parentId, kind, status: 'active', order: ord++, meta: {}, lastActivityAt: '2026-10-28T03:00:00Z', ...extra });
function office(nSub = 3, extra = {}) {
  ord = 0;
  const list = [N('s:m', null, 'main', { meta: { cwd: 'D:\\repos\\project_atlas' }, ...extra })];
  for (let i = 0; i < nSub; i++) list.push(N('a:' + i, 's:m', 'subagent'));
  return { list, lay: computeOffice(list, 's:m', null) };
}
const mainRoom = (lay) => lay.rooms.find((r) => r.type === 'office' && r.ownerId === lay.rootId);

test('이름 → 줄: 짧으면 한 줄, 길면 가운데 가까운 구분자에서 두 줄, 넘치면 줄임표', () => {
  assert.deepEqual(stencilLines('Works6'), ['Works6']);
  assert.deepEqual(stencilLines('  project_atlas '), ['project_atlas']);
  assert.deepEqual(stencilLines(''), []);
  assert.deepEqual(stencilLines(null), []);
  const two = stencilLines('agent4d-floor-stencil-name');
  assert.equal(two.length, 2);
  assert.ok(two[0].endsWith('-'), '구분자는 첫 줄 끝에 남김: ' + two[0]);
  assert.equal(two.join('').replace(/…/g, ''), 'agent4d-floor-stencil-name');
  assert.deepEqual(stencilLines('my long project'), ['my long', 'project']); // 공백은 버림
  const noSep = stencilLines('abcdefghijklmnopqrst'); // 구분자 없음 → 가운데
  assert.deepEqual(noSep, ['abcdefghij', 'klmnopqrst']);
  const huge = stencilLines('x'.repeat(30) + '_' + 'y'.repeat(30));
  assert.ok(huge.every((l) => [...l].length <= STENCIL.LINE_MAX), '줄마다 LINE_MAX 이하');
  assert.ok(huge[0].endsWith('…') && huge[1].endsWith('…'));
  assert.deepEqual(stencilLines('건축공간연구원 설문시스템 운영'), ['건축공간연구원', '설문시스템 운영']); // 한글도 글자 단위
});

test('구역: 마지막 책상 줄 앞 ~ 앞 벽, 포털·벨 대기 줄 사이, 방 안', () => {
  const { lay } = office(3);
  const r = mainRoom(lay);
  const z = stencilZone(r);
  const lastDesk = r.origin.z + DESK_Z0 + (r.rows - 1) * ROW_STEP;
  assert.ok(z.z0 >= lastDesk + 0.9, '책상 앞');
  assert.ok(z.z1 <= r.bounds.maxZ - 0.2, '앞 벽 안');
  assert.ok(z.x0 > r.origin.x - 6.1 && z.x1 < r.origin.x + 3.55, '포털(−7)·벨(+4) 대기 줄 사이');
  for (const d of r.desks) assert.ok(!(d.x > z.x0 - 0.7 && d.x < z.x1 + 0.7 && d.z + 0.4 > z.z0 && d.z - 0.4 < z.z1), '책상과 겹치지 않음');
  for (const k of ['agent', 'notify']) for (const sp of r.stations[k] || []) assert.ok(sp.x < z.x0 || sp.x > z.x1, k + ' 서는 자리 밖');
  // 줄이 늘면(ext) 구역도 앞으로
  const big = office(16).lay, rb = mainRoom(big);
  assert.ok(rb.rows > 3, '줄 늘어남');
  const zb = stencilZone(rb);
  assert.ok(zb.z0 > z.z0 + 3 && zb.z1 > z.z1 + 3);
  // 회의실은 없음
  assert.equal(stencilZone({ type: 'meeting', origin: { x: 0, z: 0 } }), null);
});

test('대기석(손님 벤치)이 있으면 그 앞(책상 쪽)만', () => {
  const { lay } = office(2);
  const r = mainRoom(lay);
  const z0 = stencilZone(r);
  const withWait = { ...r, stools: [{ x: -1.9, z: r.origin.z + WAIT_Z, kind: 'wait' }] };
  const z1 = stencilZone(withWait);
  assert.ok(z1.z1 < r.origin.z + WAIT_Z - 0.5 && z1.z1 < z0.z1);
});

test('크기: 구역 안에 맞춤, 긴 이름은 글자가 작아지고, 너무 작으면 그리지 않음', () => {
  const { lay } = office(3);
  const r = mainRoom(lay), z = stencilZone(r);
  const short = stencilPlace(r, stencilLines('Works6'));
  const long = stencilPlace(r, stencilLines('agent4d-voxel-office'));
  for (const p of [short, long]) {
    assert.ok(p.w <= (z.x1 - z.x0) + 1e-9 && p.h <= (z.z1 - z.z0) + 1e-9, '구역 안');
    assert.ok(p.x - p.w / 2 >= z.x0 - 1e-9 && p.x + p.w / 2 <= z.x1 + 1e-9);
    assert.ok(Math.abs(p.w / p.h - linesAspect(p.lines)) < 1e-9, '비율 유지');
  }
  assert.ok(short.charH > long.charH, '긴 이름은 글자가 작음');
  assert.ok(short.charH <= STENCIL.H_MAX + 1e-9);
  assert.equal(long.lines.length, 2);
  assert.equal(stencilPlace(r, ['x'.repeat(200)]), null, '읽을 수 없게 작으면 null');
  assert.equal(short.angle, 0);
  // 측정한 비율을 넘기면 그 비율
  const p = stencilPlace(r, ['abc'], 4);
  assert.ok(Math.abs(p.w / p.h - 4) < 1e-9);
});

test('돌린 방(§67): 구역이 방과 같이 돌고, 글은 거꾸로 서지 않음', () => {
  for (const k of [1, 2, 3]) {
    const { lay } = office(3);
    const before = stencilPlace(mainRoom(lay), ['Works6']);
    rotateOffice(lay, k, 0, 0);
    const r = mainRoom(lay);
    const p = stencilPlace(r, ['Works6']);
    assert.ok(p.x > r.bounds.minX && p.x < r.bounds.maxX && p.z > r.bounds.minZ && p.z < r.bounds.maxZ, 'k=' + k + ' 방 안');
    assert.ok(Math.abs(Math.hypot(p.x, p.z) - Math.hypot(before.x, before.z)) < 1e-6, '원점 둘레 회전');
    assert.ok(!(p.rx < 0), 'k=' + k + ' 왼쪽으로 읽지 않음');
    if (k === 2) assert.deepEqual([p.rx, p.rz], [1, 0]);
    else assert.deepEqual([p.rx, p.rz], [0, -1]); // 세로면 아래 → 위
  }
});

test('목록: 전체 보기 = 동마다 하나(이름 = 동 이름), 단일 세션 = 루트 cwd 이름', () => {
  ord = 0;
  const list = [], roots = [];
  const projects = [{ projectId: 'p1', name: 'Works6', path: 'D:\\x\\Works6', live: true, active: true }, { projectId: 'p2', name: 'project_atlas', path: 'D:\\y\\project_atlas', live: true }];
  for (const [pid, mains] of [['p1', 2], ['p2', 1]]) for (let j = 0; j < mains; j++) {
    const mid = `s:${pid}m${j}`;
    list.push(N(mid, null, 'main', { projectId: pid }));
    roots.push({ nodeId: mid, projectId: pid });
    list.push(N(`a:${pid}${j}`, mid, 'subagent', { projectId: pid }));
  }
  const lay = computeCampus(list, roots, projects, null, { nowMs: Date.parse('2026-10-28T03:05:00Z') });
  const t = stencilTargets(lay, { mode: 'all' });
  assert.deepEqual(t.map((x) => x.text).sort(), ['Works6', 'project_atlas']);
  for (const x of t) {
    const b = lay.buildings.find((y) => y.projectId === x.projectId);
    assert.equal(x.room, buildingOffice(b, lay.officeByMain));
    assert.equal(x.room.ownerId, b.offices[0].mainId, '동의 첫(현재 메인) 사무실');
  }
  // 단일 세션
  const { lay: one, list: l1 } = office(2);
  const t1 = stencilTargets(one, { mode: 'session', root: l1[0], projects: [] });
  assert.equal(t1.length, 1);
  assert.equal(t1[0].text, 'project_atlas');
  assert.equal(sessionProjectName({ meta: { cwd: 'D:\\x\\Works6\\' } }, []), 'Works6');
  assert.equal(sessionProjectName({ meta: { cwd: '/home/u/a' } }, [{ path: '/home/u/a', name: '(임시) a' }]), '(임시) a', '프로젝트 목록 이름 우선');
  assert.deepEqual(stencilTargets(one, { mode: 'session', root: { meta: {} } }), [], 'cwd 없으면(가려진 이름) 없음');
});

test('색: 테마별, 고른 프로젝트 진하게, 페이드 따라 흐려짐', () => {
  const d = stencilStyle(false), l = stencilStyle(true);
  assert.notEqual(d.color, l.color);
  assert.ok(stencilStyle(false, 1, true).alpha > d.alpha);
  assert.equal(stencilStyle(true, 0).alpha, 0);
  assert.ok(Math.abs(stencilStyle(true, 0.5).alpha - l.alpha / 2) < 1e-9);
});

test('2D 평면도는 three 없이(정적 import), 3D·2D 가 같은 순수 모듈', () => {
  const src2 = fs.readFileSync(new URL('../flat/vx2d-stencil.js', import.meta.url), 'utf8');
  const tex = fs.readFileSync(new URL('../voxel/stencil-tex.js', import.meta.url), 'utf8');
  for (const s of [src2, tex]) assert.ok(!/from ['"]three/.test(s));
  const s3 = fs.readFileSync(new URL('../voxel/vx-stencil.js', import.meta.url), 'utf8');
  for (const s of [src2, s3]) assert.ok(s.includes("stencil-core.mjs") && s.includes('stencilPlace') && s.includes('stencilTargets'));
  assert.ok(/polygonOffset: true/.test(s3) && /depthWrite: false/.test(s3), '데칼: 깊이 쓰기 없음 + polygonOffset');
});
