// node --test "web/test/lab-labels3d.test.mjs"   [T4] 3D 전체 보기(캠퍼스) 이름표 겹침:
// 연구동 간판 자리(building.labelX/labelZ — 외벽 원 밖·출입문/라운지 방위 피함·이웃 동과 안 겹침) · 간판/문패 상자를 이름표가 비킴
// (bubbles labelObstacleRects → placeLabelsBoard) · office.js 원문 연결(_extraLabels 갈고리·labelZ·signRects).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAB, dTheta, thetaOf } from '../lab/lab-const.mjs';
import { computeLabCampus, labSignSpot, LAB_CAMPUS } from '../lab/lab-campus-core.mjs';
import { placeLabels, placeLabelsBoard } from '../label-place.mjs';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(path.join(WEB, f), 'utf8');

function proj(pid, mains, { subs = 2, bgs = 1, status = 'active' } = {}) {
  const out = [];
  for (const m of mains) {
    out.push({ id: 's:' + m, kind: 'main', status, projectId: pid, order: out.length, sessionId: m, lastActivityAt: '2026-11-01T00:00:00Z' });
    for (let i = 0; i < subs; i++) out.push({ id: `${m}_s${i}`, kind: 'subagent', parentId: 's:' + m, status: 'active', projectId: pid, order: out.length });
    for (let i = 0; i < bgs; i++) out.push({ id: `${m}_b${i}`, kind: 'bash-bg', parentId: 's:' + m, status: 'active', projectId: pid, order: out.length, meta: { command: 'npm test' } });
  }
  return out;
}
// 구역 수 1·2·3·4 연구동 + 루트 없는 지난 프로젝트(빈 돔)
function campus() {
  const spec = [['P1', ['a']], ['P2', ['b', 'c']], ['P3', ['d', 'e', 'f']], ['P4', ['g', 'h', 'i', 'j']]];
  const nodes = [], roots = [], projects = [];
  for (const [pid, ms] of spec) {
    nodes.push(...proj(pid, ms));
    for (const m of ms) roots.push({ nodeId: 's:' + m, projectId: pid });
    projects.push({ projectId: pid, name: pid.toLowerCase(), live: true, liveList: ms.map((s) => ({ sessionId: s })) });
  }
  projects.push({ projectId: 'P5', name: 'five', live: false, recent: true });
  return computeLabCampus(nodes, roots, projects, null, { nowMs: Date.parse('2026-11-01T00:00:10Z') });
}

test('(a) 연구동 간판 자리: 모든 동에 labelX/labelZ · 외벽 원 밖 · 출입문 방위 ±40° 밖 · 이웃 동 bounds 와 안 겹침', () => {
  const L = campus();
  assert.equal(L.buildings.length, 5);
  for (const b of L.buildings) {
    assert.ok(Number.isFinite(b.labelX) && Number.isFinite(b.labelZ), `${b.projectId} labelX/labelZ`);
    const { cx, cz, rWall } = b.lab;
    assert.ok(Math.hypot(b.labelX - cx, b.labelZ - cz) >= rWall, `${b.projectId} 외벽 원 밖`);
    const room = L.rooms.find((r) => r.projectId === b.projectId);
    const door = room ? room.lab.doorTheta : LAB.FRONT.DOOR, lounge = room ? room.lab.loungeTheta : LAB.FRONT.LOUNGE;
    const th = thetaOf(cx, cz, b.labelX, b.labelZ);
    assert.ok(Math.abs(dTheta(th, door)) > 40, `${b.projectId} 출입문(${door}°) ±40° 밖: ${th.toFixed(1)}°`);
    assert.ok(Math.abs(dTheta(th, lounge)) >= LAB_CAMPUS.SIGN_LOUNGE - 1e-6, `${b.projectId} 라운지(${lounge}°) 피함: ${th.toFixed(1)}°`);
    for (const o of L.buildings) {
      if (o === b) continue;
      const B = o.bounds, inside = b.labelX >= B.minX && b.labelX <= B.maxX && b.labelZ >= B.minZ && b.labelZ <= B.maxZ;
      assert.ok(!inside, `${b.projectId} 간판이 ${o.projectId} 동 bounds 안`);
    }
  }
  // 단일 구역(출입문 45·라운지 15): 외벽 바로 아래(앞쪽 반원)
  const one = L.buildings.find((b) => b.projectId === 'P1');
  assert.ok(one.labelZ > one.lab.cz + one.lab.rWall * 0.8, '단일 구역 간판 = 원 아래쪽');
});

test('(a) labSignSpot: 출입문·라운지가 정면 근처면 앞쪽 반원에서 비킴', () => {
  const s0 = labSignSpot(0, 0, 30, 45, 15);
  assert.ok(Math.abs(Math.hypot(s0.x, s0.z) - (30 + LAB_CAMPUS.SIGN_OUT)) < 1e-9);
  assert.ok(Math.abs(dTheta(s0.theta, 45)) >= 45 && Math.abs(dTheta(s0.theta, 15)) >= 30);
  const s1 = labSignSpot(0, 0, 30, 0, 90);
  assert.ok(Math.abs(dTheta(s1.theta, 0)) >= 45 && Math.abs(dTheta(s1.theta, 90)) >= 30, `θ=${s1.theta}`);
  // 기본(출입문·라운지 없음 = 정면)
  assert.equal(labSignSpot(0, 0, 30, 180, null).theta, 0);
});

// bubbles.js 는 three 를 불러 node 에서 import 할 수 없으므로 순수 도우미 원문을 떼어 시험한다
function loadObstacleFn() {
  const s = src('voxel/bubbles.js');
  const m = s.match(/export function labelObstacleRects\([^)]*\) \{[\s\S]*?\n\}\n/);
  assert.ok(m, 'bubbles.js 에 labelObstacleRects export');
  return new Function(m[0].replace(/^export /, '') + '\nreturn labelObstacleRects;')();
}

test('(b) 간판·문패 사각형과 겹치는 이름표는 placeLabelsBoard 에서 비키거나 숨음(간판은 고정)', () => {
  const labelObstacleRects = loadObstacleFn();
  // 말풍선 평면 배열 + 간판 + 문패 + 그 밖 → 사각형 목록(잘못된 상자는 버림)
  const rs = labelObstacleRects([1, 2, 3, 4, 5, 6, 7, 8], [[10, 10, 50, 30]], [[60, 0, 90, 20], [5, 5, 5, 9]], [[0, 0, 1, 1]]);
  assert.deepEqual(rs, [[1, 2, 3, 4], [5, 6, 7, 8], [10, 10, 50, 30], [60, 0, 90, 20], [0, 0, 1, 1]]);
  assert.deepEqual(labelObstacleRects(null, null, null), []);

  const VX_SHIFTS = [0, 14, 28], VX_FAR = [42, [0.6, 14], [-0.6, 14], 56, [0.6, 42], [-0.6, 42], 70];
  const opts = { shifts: VX_SHIFTS, farShifts: VX_FAR, bounds: [0, 1000], rects: [] };
  const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  // 이름표(사람 발밑) 바로 아래에 간판이 걸침
  const cands = [{ id: 'p', x: 500, y: 300, up: false, gap: 0, pin: true, modes: [{ w: 104, h: 18 }] }];
  const sign = [440, 298, 560, 322];
  const base = placeLabels(cands, [], opts);
  assert.ok(hit(base.get('p').box, sign), '대조: 장애물 없으면 간판과 겹침');
  const board = labelObstacleRects(null, [sign], [], []);
  const { placed } = placeLabelsBoard(cands, [], opts, board);
  const p = placed.get('p');
  assert.ok(!p || !hit(p.box, sign), '간판을 비키거나 숨음');
  assert.ok(p && (p.dy || p.dx), '밀린 자리로');
  // 사방이 막히면 숨김(겹친 채 남지 않음)
  const wall = labelObstacleRects(null, [[0, 200, 1000, 500]], [[0, 0, 1000, 200]]);
  const all = placeLabelsBoard(cands, [], opts, wall).placed;
  assert.ok(!all.get('p') || !wall.some((r) => hit(all.get('p').box, r)));
});

test('(c) 원문 연결: office.js 갈고리·간판 자리·간판 상자 · bubbles.js signRects', () => {
  const off = src('voxel/office.js'), bub = src('voxel/bubbles.js');
  assert.ok(off.includes('if (this._extraLabels) this._extraLabels(put, { fid, hid, clockMs, farAll: !!this._farAll });'), '_extraLabels 갈고리');
  // 갈고리는 퇴장 자리 이름표 뒤 · 남은 칸 비우기 바로 위
  const iHook = off.indexOf('this._extraLabels(put'), iGone = off.indexOf("ch.id + '#g'"), iClear = off.indexOf('for (let i = n; i < labels.length; i++) labels[i].id = null;');
  assert.ok(iGone < iHook && iHook < iClear);
  assert.ok(/this\._labels = Array\.from\(\{ length: 32 \}/.test(off), '이름표 풀 32');
  assert.ok(/const LABEL_MAX = 32;/.test(bub), 'bubbles 이름표 풀 32');
  assert.ok(off.includes('b.labelZ') && off.includes('b.labelX'), '_updateSigns 가 labelX/labelZ 사용');
  assert.ok(off.includes('bc.signRects = this._signScreenRects('), 'signRects 넘김');
  assert.ok(!/VoxelView\.prototype\._extraLabels|\n  _extraLabels\(/.test(off), 'VoxelView 기본에는 _extraLabels 없음');
  assert.ok(bub.includes('ctx.signRects'), 'bubbles 가 signRects 사용');
  assert.ok(/!\(this\._farAll && this\._farSkipRunLabels\) && runVis\(m\.node, clockMs\)/.test(off), '원경이면 기자재 실행 이름표 생략(LabView 플래그 — 복셀 오피스는 그대로)');
});
