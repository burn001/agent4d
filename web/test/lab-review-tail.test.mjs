// node --test "web/test/lab-review-tail.test.mjs" 연구소 리뷰 남은 지적 수리(3D 대시보드 보간은 lab-tween-follow (7)):
//   (1) 전체 보기 섬 이름표 겹침 거르기(연구소 2D 만 — islandDeclutter) · 숨긴 이름표는 집기·장애물에서 빠짐
//   (2) 모래시계 테두리도 jobFaceExact 면 카드와 같이 돌림 · 지역 축 사각형 경로는 모듈 함수(프레임마다 할당 0)
//   (3) seqCardSpot 마지막 수단도 검사 — 다 막히면 null(그대로)
//   (4) '+n' 알약 글꼴 문자열 캐시 · _labFar 위치 인자(옵션 객체 할당 없음)
//   (5) 섬 이름표가 노드 라벨 장애물에 두 번 들어가지 않음(_labelTextRects)
//   (6) '+n' 알약 글자·폭 캐시(n·크기가 바뀔 때만 measureText) · (7) 작업 칩 사각형 모듈 함수 jobRect
//   (8) 프레임마다: 주인 책상 자리 재사용 객체 · display none 섬 이름표는 폭을 다시 재지 않음 · placeCards 는 장애물을 복사하지 않음
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAB, bridgeToWorld, worldToBridge } from '../lab/lab-const.mjs';
import { computeLab, seqCardSpot } from '../lab/lab-layout-core.mjs';
import { rigSlots } from '../lab/lab-rig-core.mjs';
import { declutterIslandSigns, islandSignPri } from '../lab/lab2d-core.mjs';
import { Lab2DView, labFarLabel, labFarAt } from '../flat/lab2d.js';
import { DARK } from '../voxel/palette-hex.mjs';
import { pickLabelAt } from '../overview/pick-core.mjs';
import { JOBCARD } from '../voxel/vx-job-core.mjs';
import { placeCards } from '../flat/flat-core.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(path.join(WEB, f), 'utf8');
const over = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const same = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

function protoView(lay, s = 12) {
  const v = Object.create(Lab2DView.prototype);
  Object.assign(v, { layout: lay, rooms: lay.rooms, roomsById: new Map(lay.rooms.map((r) => [r.id, r])), pal: DARK,
    tokens: { bg: '#111', text: '#eee', muted: '#999', ok: '#3d3', error: '#e33', warn: '#fa0', skill: '#c6f', isLight: false },
    W: 1280, H: 800, _s: s, _now: 2, reduced: false, vis: new Map(), chars: new Map(), machines: new Map(), focusId: null, hoverId: null,
    _labHits: [], _labArt: null, clock: () => 5000, scope: { mode: 'session' }, cam: { x: 0, z: 0, D: 400 / s } });
  v._X = (x) => x * s + 640; v._Y = (z) => z * s + 400;
  return v;
}
const CTX_FNS = ['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'arc', 'ellipse', 'rect', 'roundRect', 'fillRect', 'strokeRect', 'save', 'restore', 'translate', 'rotate', 'setTransform', 'setLineDash', 'drawImage', 'clip'];
function fakeCtx() {
  const ops = [], ctx = { ops };
  for (const k of CTX_FNS) ctx[k] = (...a) => { ops.push([k, ...a]); };
  ctx.fillText = (t) => { ops.push(['fillText', String(t)]); };
  ctx.measureText = (s) => ({ width: String(s).length * 6 });
  return ctx;
}
function rigLay() {
  const n0 = rigSlots(0, 0, LAB.PLATFORM.R_DEFAULT).length;
  const ns = [{ id: 'm', kind: 'main', order: 0, status: 'active', label: 'main' }];
  for (let i = 0; i < n0 + LAB.RIG.SHELF_MAX + 5; i++) ns.push({ id: 'b' + i, kind: 'bash-bg', parentId: 'm', order: 1 + i, status: 'active' });
  const lay = computeLab(ns, 'm', null, {});
  lay.lab = true;
  for (const r of lay.rooms) { r._alpha = 1; r._on = true; }
  return lay;
}
/** 섬 이름표 DOM 대역(style 기록) */
const islEl = (pid, w = 140, h = 22) => ({ isConnected: true, _html: '<b>' + pid + '</b>', offsetWidth: w, offsetHeight: h, style: { display: '', visibility: '' }, dataset: { pid } });

test('(1a) declutterIslandSigns: 우선순위 높은 것부터 · 겹치면 낮은 쪽 숨김 · 안 겹치면 그대로 · 직전 숨김은 여유를 더 둬야 다시 보임 · 결정적', () => {
  const A = { x0: 0, y0: 0, x1: 100, y1: 20, pri: 5, was: false };
  const B = { x0: 50, y0: 10, x1: 150, y1: 30, pri: 9, was: false };
  const C = { x0: 300, y0: 0, x1: 400, y1: 20, pri: 1, was: false };
  assert.deepEqual([...declutterIslandSigns([A, B, C])], [true, false, false], 'A 가 B(높음)와 겹쳐 숨김, C 는 떨어져 그대로');
  // 사슬: B 숨기면 그 뒤 것은 B 와만 겹쳐도 보임(숨긴 것과는 안 따짐)
  const D = { x0: 140, y0: 10, x1: 240, y1: 30, pri: 0, was: false };
  assert.deepEqual([...declutterIslandSigns([{ ...B, pri: 1 }, { ...A, pri: 9 }, D])], [true, false, false]);
  // 3px 떨어짐: 보이던 것은 그대로(pad 2) · 숨겼던 것은 여유(pad 2 + back 4) 안이라 계속 숨김
  const E = { x0: 103, y0: 0, x1: 200, y1: 20, pri: 0, was: false };
  assert.deepEqual([...declutterIslandSigns([{ ...A, pri: 9 }, E])], [false, false]);
  assert.deepEqual([...declutterIslandSigns([{ ...A, pri: 9 }, { ...E, was: true }])], [false, true]);
  assert.deepEqual([...declutterIslandSigns([{ ...A, pri: 9 }, { ...E, x0: 110, was: true }])], [false, false], '충분히 멀어지면 다시 보임');
  // 같은 우선순위 = 입력 순서
  assert.deepEqual([...declutterIslandSigns([{ ...A, pri: 1 }, { ...B, pri: 1 }])], [false, true]);
  assert.deepEqual([...declutterIslandSigns([])], []);
  // 우선순위: 고른 프로젝트 > live·busy > active > 비활성 아님 > 반지름
  const pf = islandSignPri({ projectId: 'f', inactive: true, r: 1 }, 'f'), pl = islandSignPri({ projectId: 'a', live: true, r: 900 }, 'f');
  const pa = islandSignPri({ projectId: 'b', active: true, r: 999 }, 'f'), pi = islandSignPri({ projectId: 'c', inactive: true, r: 999 }, 'f');
  assert.ok(pf > pl && pl > pa && pa > pi);
  assert.ok(islandSignPri({ projectId: 'x', r: 20 }, null) > islandSignPri({ projectId: 'y', r: 10 }, null));
});

test('(1b) Lab2DView 전체 보기: 겹친 섬 이름표 중 낮은 것 visibility hidden · 장애물·집기에서 빠짐 · 떨어지면 다시 보임 · 단일 범위·꺼짐이면 전부 보임', () => {
  const lay = rigLay();
  const v = protoView(lay, 2); // 'fit all' 아래 원경
  v.scope = { mode: 'all', focusProject: null };
  v.islandDeclutter = true;
  const e1 = islEl('p1'), e2 = islEl('p2'), e3 = islEl('p3');
  v.islandEls = new Map([['p1', e1], ['p2', e2], ['p3', e3]]);
  v._clusterV = new Map([
    ['p1', { projectId: 'p1', center: { x: 0, z: 0 }, r: 10, labelX: 0, labelZ: 5, live: true }],
    ['p2', { projectId: 'p2', center: { x: 10, z: 0 }, r: 10, labelX: 10, labelZ: 5 }],     // 20px 옆 = p1 과 겹침
    ['p3', { projectId: 'p3', center: { x: 200, z: 0 }, r: 10, labelX: 200, labelZ: 5 }],   // 멀리
  ]);
  v._declutterIslands();
  assert.equal(e1.style.visibility, ''); assert.equal(e2.style.visibility, 'hidden'); assert.equal(e3.style.visibility, '');
  assert.equal(e2._dclHide, true);
  // 숨긴 이름표는 카드 장애물(_islandRects)·노드 라벨 장애물(flat-view _obstacleRects 갈래)에서 빠짐
  v._labFrameBegin(); v._syncTextRects();
  const r2 = [640 + 10 * 2 - 70, 400 + 5 * 2, 640 + 10 * 2 + 70, 400 + 5 * 2 + 22];
  assert.ok(!v._canvasTextRects.some((r) => same(r, r2)), '숨긴 p2 는 카드 장애물 아님');
  assert.equal(v._canvasTextRects.filter((r) => r[2] - r[0] === 140).length, 2, 'p1·p3 만');
  assert.match(src('flat/flat-view.js'), /if \(!e \|\| !el\.isConnected \|\| el\._dclHide\) continue;/);
  // 집기: visibility hidden 은 건너뜀(pickLabelAt)
  const fakeDoc = { querySelectorAll: () => [
    { style: { display: '', visibility: 'hidden' }, dataset: { pid: 'p2' }, getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 20, width: 100 }) },
    { style: { display: '', visibility: '' }, dataset: { pid: 'p1' }, getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 20, width: 100 }) },
  ] };
  assert.equal(pickLabelAt(50, 10, fakeDoc), 'p1', '숨긴 이름표가 앞에 있어도 보이는 것을 집음');
  // 고른 프로젝트는 늘 먼저
  v.scope.focusProject = 'p2';
  v._declutterIslands();
  assert.equal(e2.style.visibility, ''); assert.equal(e1.style.visibility, 'hidden');
  // 가까이 → 안 겹침 → 다 보임
  v.scope.focusProject = null; v.cam.D = 400 / 30; // 30px/m: p2 가 300px 옆
  v._declutterIslands();
  assert.ok([e1, e2, e3].every((e) => e.style.visibility === '' && !e._dclHide));
  // 단일 범위·꺼짐이면 숨긴 것 없음
  v.cam.D = 400 / 2; v._declutterIslands(); assert.equal(e2.style.visibility, 'hidden');
  v.scope = { mode: 'session' }; v._declutterIslands();
  assert.ok([e1, e2, e3].every((e) => e.style.visibility === ''));
  v.scope = { mode: 'all' }; v.islandDeclutter = false; v._declutterIslands();
  assert.ok([e1, e2, e3].every((e) => e.style.visibility === ''));
  // display none(프로젝트 숨김)은 거르기에 안 들어감(다른 이름표를 가리지 않음)
  v.islandDeclutter = true; e1.style.display = 'none'; v._declutterIslands();
  assert.equal(e2.style.visibility, '');
  // 배선: 연구소 2D 만 켬 · 바탕 _placeLabels 뒤
  const lb = src('flat/lab2d.js');
  assert.match(lb, /this\.islandDeclutter = true;/);
  assert.match(lb, /_placeLabels\(\) \{\n {4}super\._placeLabels\(\);\n {4}this\._declutterIslands\(\);/);
  assert.doesNotMatch(src('flat/flat-view.js'), /islandDeclutter|_declutterIslands/);
  assert.doesNotMatch(src('flat/voxel2d.js'), /islandDeclutter/);
  assert.match(src('overview/pick-core.mjs'), /el\.style\.visibility === 'hidden'/);
});

test('(2) 모래시계 테두리: jobFaceExact 면 돌린 경로(strokeRect 없음, 채움과 같은 축) · 끄면 축 맞춤 strokeRect 그대로 · 경로 함수는 모듈 수준', () => {
  const v = protoView(rigLay(), 12);
  v.kindColor = () => '#fa0';
  const job = { id: 'j', type: 'job', node: { id: 'j', kind: 'bash-bg', status: 'active', meta: { job: { v: 1, id: '0', state: 'waiting', beatAt: new Date(4000).toISOString(), until: new Date(9000).toISOString() } } },
    pos: { x: 0, z: 0, face: 225 * Math.PI / 180, slot: 0, d2: 0.2 } };
  const vv = { _sp: {}, drawS: 1 };
  v.jobFaceExact = true; const a = fakeCtx(); v._drawJob(a, job, vv, 12, 1, false);
  assert.ok(!a.ops.some((o) => o[0] === 'strokeRect'), '돌린 모래시계 테두리');
  const iS = a.ops.findIndex((o) => o[0] === 'stroke');
  assert.ok(iS > 0, '테두리 = 경로 stroke');
  // 테두리 경로 꼭짓점: 지역 축(오른쪽 r, 앞쪽 f)으로 0.13 × 0.13 m 정사각 — 225° 면 변이 화면 축에 비스듬
  let j = iS; while (j > 0 && a.ops[j][0] !== 'beginPath') j--;
  const pts = a.ops.slice(j, iS).filter((o) => o[0] === 'moveTo' || o[0] === 'lineTo').map((o) => [o[1], o[2]]);
  assert.equal(pts.length, 4);
  const ex = pts[1][0] - pts[0][0], ey = pts[1][1] - pts[0][1];
  assert.ok(Math.abs(Math.hypot(ex, ey) - 0.13 * 12) < 1e-6, '변 길이 0.13m');
  assert.ok(Math.abs(ex) > 0.1 && Math.abs(ey) > 0.1, '비스듬(축 나란하지 않음)');
  v.jobFaceExact = false; const b = fakeCtx(); v._drawJob(b, job, vv, 12, 1, false);
  const sr = b.ops.find((o) => o[0] === 'strokeRect');
  assert.ok(sr, '축 맞춤(복셀 오피스 2D) = 기존 strokeRect');
  assert.ok(Math.abs(sr[3] - 2 * 0.065 * 12) < 1e-9);
  const vx = src('flat/voxel2d.js');
  assert.match(vx, /\nfunction jobQuadPath\(ctx, cx, cy, du, dw, rx, rz, fx, fz, s\) \{/);
  assert.doesNotMatch(vx, /const quad = \(/, '_drawJob 안 클로저 없음');
  assert.doesNotMatch(vx, /rd = ex \?/);
});

test('(3) seqCardSpot: 마지막 수단(iv)도 검사 — 다 막히면 null(그대로) · 반환한 판 자리는 외벽 안', () => {
  const ns = [{ id: 'main', kind: 'main', status: 'active', order: 0 },
    { id: 'L', kind: 'bash-bg', parentId: 'main', status: 'active', order: 1, meta: { launcher: { script: 'r.sh' } } }];
  const lay = computeLab(ns, 'main', null, {});
  const m = lay.machine.get('L'), room = lay.rooms.find((r) => r.id === m.roomId), lab = room.lab, f = lab.bridge;
  assert.equal(m.type, 'batch'); assert.ok(m.rigKind);
  // 외벽이 아주 작으면 (i)～(iv) 모두 외벽 밖 → 예전에는 검사 없이 (iv) 자리를 돌려줬다 → 이제 null
  assert.equal(seqCardSpot(m, f, [], 0.5, lab.cx, lab.cz), null);
  // 보통 외벽: 결과가 있으면 판 자리(있을 때)가 외벽 − 0.35 안 · 결정적
  const rW = lab.R.rWall, q = seqCardSpot(m, f, [], rW, lab.cx, lab.cz);
  assert.deepEqual(q, seqCardSpot(m, f, [], rW, lab.cx, lab.cz));
  if (q && q.x != null) assert.ok(Math.hypot(q.x - lab.cx, q.z - lab.cz) < rW - 0.35);
  // 원문: (iv) 가 후보 목록 안(ok 검사) · 다 막히면 null
  const s = src('lab/lab-layout-core.mjs');
  assert.match(s, /\[ur, v0, ur - \(rampBack \+ cr\) - last\], {11}\/\/ \(iv\)/);
  assert.match(s, /if \(pick == null\) return null;/);
  assert.doesNotMatch(s, /pick != null \? cands\[pick\] :/);
  // 몸체 축 확인용(자기 몸체 상자 안 점은 bridge 좌표 변환이 왕복)
  const o = worldToBridge(f, m.x, m.z, {}), w = bridgeToWorld(f, o.u, o.v, {});
  assert.ok(Math.abs(w.x - m.x) < 1e-9 && Math.abs(w.z - m.z) < 1e-9);
});

test("(4) '+n' 알약 글꼴 문자열은 자리 잡을 때 한 번(크기가 같으면 같은 문자열) · _labFar 는 위치 인자 labFarAt · labFarLabel 옵션판 그대로", () => {
  const lay = rigLay(), r = lay.rooms[0];
  const v = protoView(lay, 12);
  v._labFrameBegin(); v._planRigMore(fakeCtx(), r, 12);
  const q = v._rigPills[0], f0 = q.font;
  assert.ok(/^700 \d+px /.test(f0));
  v._labFrameBegin(); v._planRigMore(fakeCtx(), r, 12);
  assert.equal(v._rigPills[0], q, '알약 객체 재사용'); assert.equal(q.font, f0, '같은 크기 = 같은 문자열(새로 안 만듦)');
  v._labFrameBegin(); v._planRigMore(fakeCtx(), r, 30);
  assert.notEqual(q.font, f0, '크기가 바뀌면 새 문자열');
  const c = fakeCtx(); let fonts = []; Object.defineProperty(c, 'font', { set: (x) => fonts.push(x), get: () => fonts[fonts.length - 1] });
  v._drawRigMore(c);
  assert.deepEqual(fonts, [q.font], '_drawRigMore 는 캐시 문자열을 그대로');
  assert.doesNotMatch(src('flat/lab2d.js'), /const f = `700 \$\{q\.fs\}px/);
  // 판정
  assert.equal(labFarAt(5.9, true, 6), true); assert.equal(labFarAt(5.9, false, 6), false); assert.equal(labFarAt(6, true, 6), false); assert.equal(labFarAt(NaN), false);
  assert.equal(labFarAt(5.9), labFarLabel(5.9)); assert.equal(labFarLabel(5.9, { all: false }), false); assert.equal(labFarLabel(7, { thr: 8 }), true);
});

test('(5) 섬 이름표가 노드 라벨 장애물에 한 번만: _labelTextRects = 정적 글 + 알약(섬 빼고) · _canvasTextRects(카드) = 섬 포함 · flat-view 는 _labelTextRects 우선', () => {
  const lay = rigLay();
  const v = protoView(lay, 4);
  v.scope = { mode: 'all' };
  v.islandEls = new Map([['p1', islEl('p1')]]);
  v._clusterV = new Map([['p1', { projectId: 'p1', center: { x: 0, z: 0 }, r: 10, labelX: 0, labelZ: 5 }]]);
  v._staticTextRects = [[1, 2, 3, 4]];
  v._labFrameBegin(); v._planRigMore(fakeCtx(), lay.rooms[0], 12); v._syncTextRects();
  const isl = [640 - 70, 400 + 20, 640 + 70, 400 + 20 + 22];
  assert.ok(v._canvasTextRects.some((r) => same(r, isl)), '카드 장애물엔 섬');
  assert.ok(!v._labelTextRects.some((r) => same(r, isl)), '라벨용엔 섬 없음');
  assert.equal(v._labelTextRects.length, 2, '정적 1 + 알약 1');
  assert.equal(v._canvasTextRects.length, 3);
  // flat-view _obstacleRects 를 이 뷰로 부르면 섬 사각형이 정확히 한 번
  v._cardRects = []; v.sess = null; v._cabRects = null; v.bubbles = null;
  const rects = v._obstacleRects(v.W, v.H);
  assert.equal(rects.filter((r) => same(r, isl)).length, 1, '섬 이름표 중복 없음');
  // 프레임 반복해도 배열 길이 그대로(누적 없음)
  for (let i = 0; i < 3; i++) { v._labFrameBegin(); v._planRigMore(fakeCtx(), lay.rooms[0], 12); v._syncTextRects(); }
  assert.equal(v._labelTextRects.length, 2); assert.equal(v._canvasTextRects.length, 3);
  assert.match(src('flat/flat-view.js'), /const ct = this\._labelTextRects \|\| this\._canvasTextRects;/);
});

test("(6) '+n' 알약: 글자·폭은 n 이나 글자 크기가 바뀔 때만 measureText(프레임마다 문자열·TextMetrics 0) · ctx.font 도 그때만 · 폭 = 글자 폭 + 8", () => {
  const lay = rigLay(), r = lay.rooms[0];
  const v = protoView(lay, 12);
  const c = fakeCtx(); let meas = 0, fonts = 0;
  const m0 = c.measureText; c.measureText = (s) => { meas++; return m0(s); };
  Object.defineProperty(c, 'font', { set: () => { fonts++; }, get: () => '' });
  v._labFrameBegin(); v._planRigMore(c, r, 12);
  const pills = v._rigPills.length, q = v._rigPills[0], n0 = [...r.lab.rigMore.values()].find((n) => n > 0);
  assert.ok(pills > 0);
  assert.equal(meas, pills, '첫 프레임 = 알약마다 한 번'); assert.equal(fonts, pills);
  assert.equal(q.txt, '+' + n0); assert.equal(q.w, q.txt.length * 6 + 8); assert.equal(q.h, q.fs + 4);
  for (let i = 0; i < 4; i++) { v._labFrameBegin(); v._planRigMore(c, r, 12); }
  assert.equal(meas, pills, '같은 n·크기 = 다시 재지 않음'); assert.equal(fonts, pills, 'ctx.font 도 안 바꿈');
  assert.equal(v._rigPills[0], q); assert.equal(q.txt, '+' + n0);
  // n 이 바뀌면 그 알약만 다시 잼
  const owner = [...r.lab.rigMore.keys()].find((k) => r.lab.rigMore.get(k) > 0);
  r.lab.rigMore.set(owner, 123);
  v._labFrameBegin(); v._planRigMore(c, r, 12);
  assert.equal(meas, pills + 1); assert.equal(v._rigPills[0].txt, '+123'); assert.equal(v._rigPills[0].w, 4 * 6 + 8);
  // 글자 크기가 바뀌면 다시 잼
  v._labFrameBegin(); v._planRigMore(c, r, 30);
  assert.equal(meas, 2 * pills + 1);
  // 원문: 반복문 앞 템플릿 글꼴 문자열 없음 · 글자 문자열은 q.n 이 바뀔 때만
  const s = src('flat/lab2d.js');
  assert.doesNotMatch(s, /\n {4}ctx\.font = `700 \$\{fs\}px \$\{FONT\}`;\n {4}for \(const \[owner, n\] of r\.lab\.rigMore\)/);
  assert.match(s, /if \(q\.n !== n\) \{ q\.n = n; q\.txt = '\+' \+ n; ctx\.font = q\.font; q\.w = ctx\.measureText\(q\.txt\)\.width \+ 8;/);
});

test('(7) 작업 칩 사각형은 모듈 함수 jobRect(칩마다 클로저 0) · 축 맞춤 출력 그대로(판 뒤판·카드 중심 같음, 크기 = du·dw × s)', () => {
  const vx = src('flat/voxel2d.js');
  assert.match(vx, /\nfunction jobRect\(ctx, c, rx, rz, fx, fz, s, ex, u, w, du, dw, col\) \{/);
  assert.doesNotMatch(vx, /const rect = \(/);
  const a = vx.indexOf('\n  _drawJob(ctx, m, v, s, now, foc) {'), b = vx.indexOf('\n  _drawChar(', a);
  assert.ok(a > 0 && b > a);
  assert.doesNotMatch(vx.slice(a, b), /=>/, '_drawJob 안 화살표 함수 없음');
  const v = protoView(rigLay(), 12);
  v.kindColor = () => '#fa0';
  const job = { id: 'j', type: 'job', node: { id: 'j', kind: 'bash-bg', status: 'active', meta: { job: { v: 1, id: '0', state: 'running', startedAt: new Date(1000).toISOString(), beatAt: new Date(4900).toISOString() } } },
    pos: { x: 0, z: 0, face: 0, slot: 0, d2: 0.2 } };
  v.jobFaceExact = false;
  const c = fakeCtx(); v._drawJob(c, job, { _sp: {}, drawS: 1 }, 12, 1, false);
  const fr = c.ops.filter((o) => o[0] === 'fillRect');
  assert.ok(fr.length >= 4);
  const [, x0, y0, w0, h0] = fr[0], [, x1, y1, w1, h1] = fr[1];
  assert.ok(Math.abs(w0 - JOBCARD.BOARD_W * 12) < 1e-9 && Math.abs(h0 - (JOBCARD.CHIP + 0.005) * 12) < 1e-9, '판 뒤판 크기');
  assert.ok(Math.abs(w1 - JOBCARD.W * 12) < 1e-9, '카드 폭');
  assert.ok(Math.abs(x0 + w0 / 2 - (x1 + w1 / 2)) < 1e-9 && Math.abs(y0 + h0 / 2 - (y1 + h1 / 2)) < 1e-9, '같은 중심');
  v.jobFaceExact = true;
  const e = fakeCtx(); v._drawJob(e, job, { _sp: {}, drawS: 1 }, 12, 1, false);
  assert.ok(!e.ops.some((o) => o[0] === 'fillRect'), 'jobFaceExact = 돌린 경로 채움');
  assert.equal(e.ops.filter((o) => o[0] === 'fill').length, fr.length + c.ops.filter((o) => o[0] === 'fill').length, '같은 개수의 사각형(+ 표시등 원)');
});

test('(8) 프레임 할당·강제 레이아웃: _ownerDesk 재사용 객체 · display none 섬 이름표는 장애물 아님·offsetWidth 안 읽음 · placeCards 장애물 사본 없음(결과 같음)', () => {
  const lay = rigLay(), r = lay.rooms[0];
  const v = protoView(lay, 12);
  // '+n' 주인 책상: 같은 객체를 다시 씀(알약 자리는 그대로)
  const owner = [...r.lab.rigMore.keys()].find((k) => r.lab.rigMore.get(k) > 0);
  const d1 = v._ownerDesk(owner, r), x1 = d1 && d1.x, z1 = d1 && d1.z;
  assert.ok(d1, '주인 책상 있음');
  const d2 = v._ownerDesk(owner, r);
  assert.equal(d2, d1, '같은 객체'); assert.equal(d2.x, x1); assert.equal(d2.z, z1);
  assert.equal(v._ownerDesk('없는 주인', r), null);
  v._labFrameBegin(); v._planRigMore(fakeCtx(), r, 12);
  assert.ok(v._rigPills.length > 0 && v._rigPills.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)));
  // 섬 이름표: display none 이면 폭을 읽지 않고 장애물에서 빠짐
  v.scope = { mode: 'all' };
  let reads = 0;
  const hid = { isConnected: true, _html: '<b>h</b>', style: { display: 'none', visibility: '' }, dataset: { pid: 'h' }, get offsetWidth() { reads++; return 0; }, offsetHeight: 0 };
  const shown = islEl('s');
  v.islandEls = new Map([['h', hid], ['s', shown]]);
  v._clusterV = new Map([['h', { center: { x: 0, z: 0 }, r: 5 }], ['s', { center: { x: 30, z: 0 }, r: 5 }]]);
  for (let i = 0; i < 5; i++) { v._labFrameBegin(); v._syncTextRects(); }
  assert.equal(reads, 0, 'display none 이름표는 offsetWidth(강제 레이아웃)를 읽지 않음');
  assert.equal(v._canvasTextRects.filter((q) => q[2] - q[0] === 140).length, 1, '보이는 섬 이름표만 장애물');
  // placeCards: 장애물 배열·사각형을 바꾸지 않고, 결과는 사본을 쓰던 때와 같음(앞 네 값만 읽음)
  const obs = [[100, 100, 200, 140], [0, 0, 10, 10, 'extra']];
  const snap = JSON.stringify(obs);
  const cards = [{ anchor: { x: 150, y: 160, R: 6 }, w: 80, h: 30, dir: 'search', slot: 0, labelPush: 0, score: 1, force: false }];
  const out = placeCards(cards, obs, { miniK: 0.55 });
  assert.equal(JSON.stringify(obs), snap, '장애물 그대로');
  const ref = placeCards(cards, obs.map((q) => q.slice(0, 4)), { miniK: 0.55 });
  assert.deepEqual(out, ref);
  assert.doesNotMatch(src('flat/flat-core.mjs'), /obstacles\.map\(\(r\) => r\.slice\(0, 4\)\)/);
});
