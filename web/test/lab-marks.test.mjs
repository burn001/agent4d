// node --test "web/test/lab-marks.test.mjs"   복셀 연구소 남은 일(T3, 3D): 반지름 각 유지 보간(radialLerp·RadiusTween) ·
// 시료 카드(computeLab → machine type 'job', vx-job-core jobAnchor 'rig') · 표지(labMarks: 머리 위 ×N 칩 · rigMore '+n') ·
// 주인 책상 → 기자재 케이블 조각(cableSegs) · lab-view.js 원문 연결
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { radialLerp, RadiusTween, cableSegs, labMarks, LAB_MARKS } from '../lab/lab-marks-core.mjs';
import { computeLab } from '../lab/lab-layout-core.mjs';
import { jobAnchor, JOBCARD } from '../voxel/vx-job-core.mjs';
import { polar, thetaOf, dTheta } from '../lab/lab-const.mjs';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const rad = (p, cx = 0, cz = 0) => Math.hypot(p.x - cx, p.z - cz);

test('(a) radialLerp: 각은 to 의 각 그대로 · 반지름만 보간 · k 단조', () => {
  const cx = 2, cz = -3, from = polar(cx, cz, 10, 40), to = polar(cx, cz, 13, 40);
  const p0 = radialLerp(from, to, cx, cz, 0), p1 = radialLerp(from, to, cx, cz, 1), ph = radialLerp(from, to, cx, cz, 0.5);
  assert.ok(near(p0.x, from.x) && near(p0.z, from.z), 'k=0 = from(같은 각)');
  assert.ok(near(p1.x, to.x) && near(p1.z, to.z), 'k=1 = to');
  assert.ok(near(rad(ph, cx, cz), 11.5), 'k=0.5 = 가운데 반지름');
  for (const p of [p0, ph, p1]) assert.ok(near(thetaOf(cx, cz, p.x, p.z), 40, 1e-6), '각 보존');
  // from 각이 달라도 각은 to 의 각, 반지름은 from 반지름에서 출발
  const f2 = polar(cx, cz, 10, 70), q0 = radialLerp(f2, to, cx, cz, 0);
  assert.ok(near(thetaOf(cx, cz, q0.x, q0.z), 40, 1e-6) && near(rad(q0, cx, cz), 10));
  let last = -Infinity;
  for (let i = 0; i <= 10; i++) { const r = rad(radialLerp(from, to, cx, cz, i / 10), cx, cz); assert.ok(r >= last - 1e-9); last = r; }
  // 줄어드는 쪽도 단조
  last = Infinity;
  for (let i = 0; i <= 10; i++) { const r = rad(radialLerp(to, from, cx, cz, i / 10), cx, cz); assert.ok(r <= last + 1e-9); last = r; }
});

test('(a) RadiusTween: 1.2초 · 배속 4 → 0.6초 · 움직임 줄이기 = 즉시 · ease 0→1 단조', () => {
  const a = new RadiusTween(10, 1);
  assert.ok(near(a.dur, LAB_MARKS.TWEEN_S)); assert.equal(a.k(10), 0); assert.equal(a.k(11.2), 1); assert.ok(a.done(11.2)); assert.ok(!a.done(11));
  assert.ok(near(a.k(10.6), 0.5));
  const b = new RadiusTween(0, 4);
  assert.ok(near(b.dur, 0.6)); assert.ok(b.done(0.6)); assert.ok(!b.done(0.59));
  const c = new RadiusTween(0, 1, true);
  assert.equal(c.dur, 0); assert.equal(c.k(0), 1); assert.ok(c.done(0));
  let last = -1;
  for (let i = 0; i <= 24; i++) { const k = a.k(10 + i * 0.05); assert.ok(k >= last); last = k; }
});

// ── 시료 카드 ──
const T0 = '2026-11-01T00:00:00Z';
function jobNodes(n, owner = 'bg1', t0 = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: `j:${owner}:${i}`, kind: 'bash-bg', parentId: owner, status: 'active', order: 10 + i,
    meta: { job: { v: 1, id: String(i), title: 'job ' + i, state: 'running', startedAt: new Date(Date.parse(T0) + (t0 + i) * 1000).toISOString(), beatAt: T0 } },
  }));
}
const base = () => [
  { id: 'main', kind: 'main', status: 'active', order: 0 },
  { id: 'sa', kind: 'subagent', parentId: 'main', status: 'active', order: 1 },
  { id: 'bg1', kind: 'bash-bg', parentId: 'sa', status: 'active', order: 2, meta: { command: 'npm test' } },
];

test('(b) computeLab: meta.job 노드 = 주인 기자재 앞(중심 쪽) 시료 카드 · 결정적 · prev 로 칸 유지 · 주인마다 8장', () => {
  const nodes = [...base(), ...jobNodes(3)];
  const L = computeLab(nodes, 'main');
  const rig = L.machine.get('bg1');
  assert.equal(rig.type, 'rig');
  const jobs = [...L.machine.entries()].filter(([, m]) => m.type === 'job');
  assert.equal(jobs.length, 3);
  const lab = L.rooms[0].lab;
  for (const [id, m] of jobs) {
    assert.equal(m.owner, 'bg1'); assert.equal(m.ownerType, 'rig'); assert.equal(m.roomId, rig.roomId);
    assert.equal(L.roomOf.get(id), rig.roomId);
    const d = Math.hypot(m.x - rig.x, m.z - rig.z);
    assert.ok(d > 0.8 && d < 1.3, '기자재에서 1m 안팎: ' + d);
    assert.ok(rad(m, lab.cx, lab.cz) < rad(rig, lab.cx, lab.cz), '중심 쪽');
    assert.ok(Math.abs(dTheta(thetaOf(lab.cx, lab.cz, m.x, m.z), rig.theta)) < 1, '같은 방위');
    assert.ok(near(m.y, 0.95 + m.slot * JOBCARD.PITCH));
  }
  assert.deepEqual(jobs.map(([, m]) => m.slot).sort(), [0, 1, 2]);
  // 길찾기 장애물에는 넣지 않음
  assert.ok(!L.rooms[0].navBoxes.some((b) => b.kind === 'job'));
  // 결정적
  const L2 = computeLab(nodes, 'main');
  assert.deepEqual([...L2.machine.entries()].filter(([, m]) => m.type === 'job'), jobs);
  // prev 로 칸 유지: 더 일찍 시작한 작업이 새로 들어와도 기존 카드는 그 칸
  const early = { ...jobNodes(1, 'bg1', -100)[0], id: 'j:bg1:early' };
  const L3 = computeLab([...nodes, early], 'main', L);
  for (const [id, m] of jobs) assert.equal(L3.machine.get(id).slot, m.slot);
  assert.equal(L3.machine.get('j:bg1:early').slot, 3);
  const L3b = computeLab([...nodes, early], 'main');
  assert.equal(L3b.machine.get('j:bg1:early').slot, 0, 'prev 없으면 시작 순');
  // 9개면 8개만 자리
  const L4 = computeLab([...base(), ...jobNodes(9)], 'main');
  assert.equal([...L4.machine.values()].filter((m) => m.type === 'job').length, JOBCARD.MAX);
  // 자리 고정: 작업이 생겨도 기자재·책상 자리는 그대로
  const L0 = computeLab(base(), 'main');
  assert.deepEqual(L0.machine.get('bg1'), rig);
  assert.deepEqual(L0.seat.get('sa'), L.seat.get('sa'));
});

test('(b) 주인이 팀장·직원이면 덱 위 콘솔 옆 · 책상 앞', () => {
  const nodes = [...base(), ...jobNodes(2, 'main'), ...jobNodes(1, 'sa')];
  const L = computeLab(nodes, 'main'), lab = L.rooms[0].lab;
  const lead = L.machine.get('j:main:0'), s = L.seat.get('sa'), st = L.machine.get('j:sa:0');
  assert.ok(lead && lead.type === 'job' && lead.y > 1.6, '덱 높이 위');
  assert.ok(Math.hypot(lead.x - L.rooms[0].leadDesk.x, lead.z - L.rooms[0].leadDesk.z) < 2.5);
  assert.ok(st && st.type === 'job' && st.y < 1.5);
  assert.ok(rad(st, lab.cx, lab.cz) < Math.hypot(s.deskX - lab.cx, s.deskZ - lab.cz), '책상 앞(중심 쪽)');
});

test('(c) jobAnchor rig: 기자재 앞(face 쪽) 1.05m · 보조 선반 0.7m · 바닥에 선 판', () => {
  const a = jobAnchor({ type: 'rig', x: 3, z: 4, face: 0 });
  assert.ok(near(a.x, 3) && near(a.z, 5.05)); assert.equal(a.y0, 0.95); assert.equal(a.face, 0); assert.equal(a.pole, 0);
  const f = Math.PI / 2, b = jobAnchor({ type: 'rig', x: 0, z: 0, face: f, shelf: true, scale: 0.6 });
  assert.ok(near(b.x, 0.7) && near(b.z, 0, 1e-9)); assert.equal(b.face, f);
});

test('(d) labMarks: rigMore → +n · 칩 ×N · until 지나면 사라짐 · 원경 빈 배열 · 합 ≤ 6', () => {
  const lay = { lab: true, rooms: [{ lab: { cx: 0, cz: 0, rP: 9, rigMore: new Map([['m0', 3]]) } }], seat: new Map([['m0', { x: 0, z: 18, deskX: 0, deskZ: 17.5, floorY: 0 }], ['p1', { x: 5, z: 17, deskX: 5, deskZ: 16, floorY: 0 }]]) };
  const m1 = labMarks(lay, new Map(), 0);
  assert.equal(m1.length, 1); assert.equal(m1[0].text, '+3'); assert.equal(m1[0].cls, 'lab-chip more');
  const chips = new Map([['p1', { n: 7, until: 10 }]]);
  const m2 = labMarks(lay, chips, 5);
  const bulk = m2.find((m) => m.cls === 'lab-chip bulk');
  assert.equal(bulk.text, '×7'); assert.ok(near(bulk.y, LAB_MARKS.CHIP_Y)); assert.equal(bulk.x, 5);
  assert.equal(m2.length, 2);
  assert.equal(labMarks(lay, chips, 10).filter((m) => m.cls === 'lab-chip bulk').length, 0, 'until 지나면 사라짐');
  assert.deepEqual(labMarks(lay, chips, 5, { farAll: true }), []);
  // 지금 자리(posOf)·덱 높이
  const m3 = labMarks(lay, chips, 5, { posOf: (id) => (id === 'p1' ? { x: 1, z: 2, floorY: 1.6 } : null) });
  const b3 = m3.find((m) => m.cls === 'lab-chip bulk');
  assert.ok(near(b3.y, 1.6 + 2.1) && b3.x === 1 && b3.z === 2);
  // 같은 Map 을 여러 구역 방이 공유해도 한 번 · 주인 자리 없으면 보조 선반 앞
  const lay2 = { lab: true, rooms: [lay.rooms[0], { lab: lay.rooms[0].lab }], seat: new Map() };
  const m4 = labMarks(lay2, null, 0);
  assert.equal(m4.length, 1); assert.ok(Number.isFinite(m4[0].x) && Number.isFinite(m4[0].z));
  // 합 ≤ 6
  const many = new Map(Array.from({ length: 9 }, (_, i) => ['x' + i, { n: i + 2, until: 99 }]));
  const seat = new Map(Array.from({ length: 9 }, (_, i) => ['x' + i, { x: i, z: 0, deskX: i, deskZ: 0 }]));
  assert.equal(labMarks({ rooms: lay.rooms, seat }, many, 0).length, LAB_MARKS.MAX);
});

test('(d) 실제 배치: 기자재가 고리·보조 선반을 넘치면 주인 +n', () => {
  const nodes = [{ id: 'main', kind: 'main', status: 'active', order: 0 }];
  for (let i = 0; i < 60; i++) nodes.push({ id: 'b' + i, kind: 'bash-bg', parentId: 'main', status: 'active', order: 1 + i, meta: { command: 'sleep 1' } });
  const L = computeLab(nodes, 'main');
  const more = L.rooms[0].lab.rigMore.get('main');
  assert.ok(more > 0);
  const m = labMarks(L, null, 0);
  assert.equal(m.length, 1); assert.equal(m[0].text, '+' + more); assert.ok(m[0].y > 1.6, '팀장 = 덱 위');
});

test('(e) cableSegs: 조각 ≤ 6 · 끝점 일치 · 이어짐 · 가까우면 직선 1조각', () => {
  const cx = 1, cz = 2, from = polar(cx, cz, 16.5, 200), to = polar(cx, cz, 11.7, 300);
  const s = cableSegs(from, to, cx, cz);
  assert.ok(s.length >= 2 && s.length <= LAB_MARKS.CABLE_SEGS, String(s.length));
  assert.ok(near(s[0].ax, from.x) && near(s[0].az, from.z));
  assert.ok(near(s[s.length - 1].bx, to.x) && near(s[s.length - 1].bz, to.z));
  for (let i = 1; i < s.length; i++) assert.ok(near(s[i].ax, s[i - 1].bx) && near(s[i].az, s[i - 1].bz));
  // 첫 조각 = 방사(각 그대로), 나머지는 to 반지름 호 위
  assert.ok(near(thetaOf(cx, cz, s[0].bx, s[0].bz), 200, 1e-6));
  for (const g of s.slice(1)) assert.ok(near(Math.hypot(g.bx - cx, g.bz - cz), 11.7, 1e-6));
  const one = cableSegs(polar(cx, cz, 16, 100), polar(cx, cz, 11.7, 102), cx, cz);
  assert.equal(one.length, 1);
  // 반대 방향(짧은 쪽 호)
  const w = cableSegs(polar(0, 0, 15, 350), polar(0, 0, 12, 20), 0, 0);
  for (const g of w.slice(1)) { const th = thetaOf(0, 0, g.bx, g.bz); assert.ok(th > 340 || th < 30, String(th)); }
});

test('(f) 원문 연결: lab-view.js 가 _extraLabels·drawLabRigCables·반지름 보간을 쓰고 computeLab 이 placeJobs 를 부름', () => {
  const v = readFileSync(path.join(WEB, 'lab/lab-view.js'), 'utf8');
  assert.match(v, /_extraLabels\(put, ctx/);
  assert.match(v, /drawLabRigCables\(r, this\.layout, B, this\.pal/);
  assert.match(v, /new RadiusTween\(/);
  assert.match(v, /radialLerp\(f, m\.pos/);
  assert.match(v, /labMarks\(this\.layout, this\._bulkChip/);
  assert.match(v, /'lab-chip|lab-chip/);
  const c = readFileSync(path.join(WEB, 'lab/lab-layout-core.mjs'), 'utf8');
  assert.match(c, /placeJobs\(jobs, \{ seat: out\.seat, machine: own/);
  assert.doesNotMatch(c, /if \(isJob\(n\)\) continue;/);
  const p = readFileSync(path.join(WEB, 'lab/lab-props.js'), 'utf8');
  assert.match(p, /export function drawLabRigCables\(room, layout, B, pal, info\)/);
});
