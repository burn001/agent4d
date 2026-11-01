// node --test "web/test/lab-review-fix.test.mjs"   복셀 연구소 4건 통합(3e2763f) 뒤 리뷰 6건 수리 확인
// (1) 반지름 보간 중 케이블 끝 = 기자재 보간 자리 · (2) 경보 판 쐐기 조각이 쐐기 밖으로 넘치지 않음 · (3) 2D 경보·장부 캐시가 연구동(계획·pid)마다
// (4) labMarks·cableSegs 버퍼 재사용 · (5) 책상 없는 주인 여럿 '+n' 흩기 · (6) 간판 비킴은 LabView 만(복셀 오피스 전체 보기 회귀 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { radialLerp, cableSegs, cableSegsInto, labMarks, LAB_MARKS } from '../lab/lab-marks-core.mjs';
import { alarmPlateTiles, ALARM_TILE_MAX } from '../lab/lab-platform-core.mjs';
import { alarm2D } from '../flat/lab2d-platform.js';
import { polar, thetaOf, dTheta } from '../lab/lab-const.mjs';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(path.join(WEB, p), 'utf8');
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test('(1) 반지름 보간 중 케이블 끝 = 기자재가 그려지는 보간 자리(rigAt)', () => {
  const cx = 0, cz = 0, from = polar(cx, cz, 9, 120), to = polar(cx, cz, 11, 120), desk = polar(cx, cz, 16, 60);
  const shown = radialLerp(from, to, cx, cz, 0.4, {});
  const segs = [];
  const n = cableSegsInto(desk, shown, cx, cz, segs);
  assert.ok(near(segs[n - 1].bx, shown.x) && near(segs[n - 1].bz, shown.z), '케이블 끝 = 보간 자리');
  assert.ok(Math.hypot(segs[n - 1].bx - to.x, segs[n - 1].bz - to.z) > 0.5, '최종 자리와는 다름(보간 중)');
  const p = src('lab/lab-props.js'), v = src('lab/lab-view.js');
  assert.match(p, /const to = \(info\.rigAt && info\.rigAt\(id, m\)\) \|\| m;/, 'drawLabRigCables 가 info.rigAt 을 씀');
  assert.match(v, /rigAt: \(id, m\) => \{ const rt = this\._rt, f = rt && rt\.m\.get\(id\); return f \? radialLerp\(f, m, rt\.cx, rt\.cz, rt\.tw\.k\(/, 'LabView 가 보간 자리를 넘김');
});

test('(2) 경보 판 조각: 대각선 구역 포함 모든 꼭짓점이 쐐기 안 · 개수 상한', () => {
  const out = [];
  for (const [rIn, rOut] of [[2.4, 6], [2.5, 8], [2.5, 10.5], [3, 14]]) {
    for (let th0 = 0; th0 < 360; th0 += 5) for (const span of [18, 25, 45, 90, 150, -30]) {
      const n = alarmPlateTiles(rIn, rOut, th0, th0 + span, out);
      assert.ok(n >= 3 && n <= ALARM_TILE_MAX, String(n));
      const lo = Math.min(th0, th0 + span), hi = Math.max(th0, th0 + span), mid = (lo + hi) / 2;
      for (let i = 0; i < n; i++) {
        const T = out[i], h = T.s / 2;
        for (const [dx, dz] of [[h, h], [h, -h], [-h, h], [-h, -h]]) {
          const x = T.x + dx, z = T.z + dz, r = Math.hypot(x, z);
          assert.ok(r <= rOut + 1e-9 && r >= rIn - 1e-9, `반지름 ${r} ∉ [${rIn}, ${rOut}]`);
          assert.ok(Math.abs(dTheta(mid, thetaOf(0, 0, x, z))) <= (hi - lo) / 2 + 1e-9, '이웃 구역 침범');
        }
      }
    }
  }
  // 45° 구역: 예전 정사각형 하나(한 변 0.9 × min(호, 띠))는 바깥 테를 넘었다 — 회귀 기준
  const rIn = 2.5, rOut = 8, rm = (rIn + rOut) / 2, side = Math.min(90 * (Math.PI / 180) * rm, rOut - rIn) * 0.9, c = polar(0, 0, rm, 45);
  assert.ok(Math.hypot(c.x + side / 2, c.z + side / 2) > rOut, '예전 판은 넘침(시험 전제)');
  assert.ok(src('lab/lab-platform-core.mjs').includes('alarmPlateTiles(P.rIn, P.rOut, s.th0, s.th1, _tiles)'), '3D 가 조각 판을 씀');
});

test('(3) 2D 경보 캐시: 연구동(계획)마다 한 칸 — 번갈아 불러도 다시 훑지 않음', () => {
  const view = {};
  const mk = (k) => ({ sectors: [{ key: k, cells: [{ key: k + '/a' }, { key: k + '/b' }] }], rim: new Map() });
  const P1 = mk('s1'), P2 = mk('s2');
  let gets = 0;
  const items = { get: (id) => { gets++; return id === 's1/a' ? { x: 'delete', xAt: 1000 } : null; } };
  const r1 = alarm2D(view, P1, items, 1, 2000), r2 = alarm2D(view, P2, items, 1, 2000);
  assert.ok(r1.set.has('s1') && !r2.set.size);
  const g0 = gets;
  for (let i = 0; i < 20; i++) { assert.equal(alarm2D(view, P1, items, 1, 2000 + i), r1); assert.equal(alarm2D(view, P2, items, 1, 2000 + i), r2); }
  assert.equal(gets, g0, '캐시 적중(전체 스캔 반복 없음)');
  alarm2D(view, P1, items, 2, 2000); // 장부 version 이 바뀌면 다시
  assert.ok(gets > g0);
  assert.match(src('flat/lab2d-platform.js'), /let P = _itemsCache\.get\(book\);[\s\S]*?P\.get\(pid\)/, '장부 항목 캐시도 pid 별');
});

test('(4) 버퍼 재사용: labMarks(out) · cableSegs(out) 가 같은 객체를 다시 씀', () => {
  const lay = { lab: true, rooms: [{ lab: { cx: 0, cz: 0, rP: 9, rigMore: new Map([['m0', 3]]) } }], seat: new Map([['m0', { x: 0, z: 18, deskX: 0, deskZ: 17.5 }], ['p1', { x: 5, z: 17, deskX: 5, deskZ: 16 }]]) };
  const chips = new Map([['p1', { n: 7, until: 10 }]]), out = [];
  const a = labMarks(lay, chips, 5, {}, out), o0 = a[0], o1 = a[1];
  assert.equal(a, out); assert.equal(a.length, 2);
  const b = labMarks(lay, chips, 6, {}, out);
  assert.equal(b, out); assert.equal(b[0], o0); assert.equal(b[1], o1);
  assert.equal(b[0].text, '×7'); assert.equal(b[1].text, '+3');
  assert.equal(labMarks(lay, chips, 11, {}, out).length, 1, '칩이 끝나면 길이 줄임');
  // posOf(id, out) 가 넘긴 객체를 채워 돌려줘도 됨
  const m = labMarks(lay, chips, 5, { posOf: (id, o) => (id === 'p1' ? ((o.x = 1), (o.z = 2), (o.floorY = 1.6), o) : null) }, []);
  assert.ok(near(m[0].x, 1) && near(m[0].y, 1.6 + LAB_MARKS.CHIP_Y));
  const segs = [], f = polar(0, 0, 16, 200), t = polar(0, 0, 11.7, 300);
  const s1 = cableSegs(f, t, 0, 0, segs), g0 = s1[0];
  const s2 = cableSegs(f, t, 0, 0, segs);
  assert.equal(s2, segs); assert.equal(s2[0], g0);
  const src4 = src('lab/lab-props.js');
  assert.doesNotMatch(src4, /segs\.forEach|rigs\.push\(\[id, m\]\)/, 'drawLabRigCables 매 프레임 배열·쌍·클로저 없음');
});

test('(5) 책상 없는 주인 여럿의 \'+n\' 은 서로 다른 자리', () => {
  const more = new Map([['a', 2], ['b', 3], ['c', 1], ['d', 4]]);
  const lay = { lab: true, rooms: [{ lab: { cx: 0, cz: 0, rP: 9, rigMore: more } }], seat: new Map() };
  const m = labMarks(lay, null, 0);
  assert.equal(m.length, 4);
  assert.deepEqual(m.map((k) => k.text), ['+2', '+3', '+1', '+4'], '주인 순서');
  for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) assert.ok(Math.hypot(m[i].x - m[j].x, m[i].z - m[j].z) > 0.8, `${i}·${j} 겹침`);
  // 결정적(같은 입력 = 같은 자리)
  const m2 = labMarks(lay, null, 0);
  for (let i = 0; i < m.length; i++) assert.ok(near(m[i].x, m2[i].x) && near(m[i].z, m2[i].z));
});

test('(6) 간판·문패 비킴 · 원경 셸 이름표 생략 · 이름표 32칸은 LabView 만(복셀 오피스 전체 보기는 b4d9a62 이전 그대로)', () => {
  const off = src('voxel/office.js'), v = src('lab/lab-view.js');
  assert.match(off, /_signScreenRects = function \(W, H\) \{\n  if \(!this\._labelDodgeSigns \|\| this\.scope\.mode !== 'all'/, '간판 상자는 플래그가 있을 때만');
  assert.match(off, /!\(this\._farAll && this\._farSkipRunLabels\) && runVis\(/, '원경 셸 이름표 생략은 플래그가 있을 때만');
  assert.match(off, /const cap = Math\.min\(labels\.length, this\._labelCap \|\| 24\);/, '복셀 오피스 이름표 24칸');
  assert.doesNotMatch(off, /this\._labelDodgeSigns = true|this\._farSkipRunLabels = true|this\._labelCap = /, 'VoxelView 는 켜지 않음');
  assert.match(v, /this\._labelDodgeSigns = true;/); assert.match(v, /this\._farSkipRunLabels = true;/); assert.match(v, /this\._labelCap = 32;/);
});
