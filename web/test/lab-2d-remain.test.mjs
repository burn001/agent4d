// node --test "web/test/lab-2d-remain.test.mjs" 연구소 2D 남은 수리(T1-lab2d-cards):
// '+n' 알약을 도구 카드 위 층으로 · 알약·섬 이름표를 카드 겹침 풀기 장애물로 · force 카드 원경 비키기(placeCards forceAvoid) · 원경 판정 함수(labFarLabel)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeCards, cardOffset, camScale, DECLUTTER_DIRS } from '../flat/flat-core.mjs';
import { LAB } from '../lab/lab-const.mjs';
import { computeLab } from '../lab/lab-layout-core.mjs';
import { rigSlots } from '../lab/lab-rig-core.mjs';
import { Lab2DView, labFarLabel } from '../flat/lab2d.js';
import { DARK } from '../voxel/palette-hex.mjs';
import { placeLabels } from '../label-place.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(path.join(WEB, f), 'utf8');
const box = (p) => [p.x0, p.y0, p.x0 + p.w, p.y0 + p.h];
const over = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const BASE = Object.getPrototypeOf(Lab2DView.prototype); // Voxel2DView.prototype

/** 화면 없이 Lab2DView 그리기 경로만(lab-2d-fix.test.mjs 와 같은 방식) — cam 은 _X·_Y 와 같은 배율 */
function protoView(lay, s = 12) {
  const v = Object.create(Lab2DView.prototype);
  Object.assign(v, { layout: lay, rooms: lay.rooms, roomsById: new Map(lay.rooms.map((r) => [r.id, r])), pal: DARK,
    tokens: { bg: '#111', text: '#eee', muted: '#999', ok: '#3d3', error: '#e33', warn: '#fa0', skill: '#c6f', isLight: false },
    W: 1280, H: 800, _s: s, _now: 2, reduced: false, vis: new Map(), chars: new Map(), machines: new Map(), focusId: null, hoverId: null,
    _labHits: [], _labArt: null, clock: () => 5000, scope: { mode: 'session' }, cam: { x: 0, z: 0, D: 400 / s } });
  v._labPlan = { rP: 7, sectors: [], cellOf: new Map(), more: { n: 0 } };
  v._X = (x) => x * s + 640; v._Y = (z) => z * s + 400;
  return v;
}
/** 호출 순서를 남기는 가짜 ctx: ops = [[이름, 인자0]] */
const CTX_FNS = ['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'arc', 'ellipse', 'rect', 'roundRect', 'fillRect', 'strokeRect', 'save', 'restore', 'translate', 'rotate', 'setTransform', 'setLineDash', 'drawImage', 'clip'];
function fakeCtx() {
  const ops = [], texts = [], ctx = { ops, texts };
  for (const k of CTX_FNS) ctx[k] = (a) => { ops.push([k, a]); };
  ctx.fillText = (t) => { ops.push(['fillText', String(t)]); texts.push(String(t)); };
  ctx.measureText = (s) => ({ width: String(s).length * 6 });
  ctx.createLinearGradient = ctx.createRadialGradient = () => ({ addColorStop() {} });
  return ctx;
}
/** 기자재가 고리·선반을 5개 넘친 단일 연구동 */
function rigLay() {
  const n0 = rigSlots(0, 0, LAB.PLATFORM.R_DEFAULT).length;
  const ns = [{ id: 'm', kind: 'main', order: 0, status: 'active', label: 'main' }];
  for (let i = 0; i < n0 + LAB.RIG.SHELF_MAX + 5; i++) ns.push({ id: 'b' + i, kind: 'bash-bg', parentId: 'm', order: 1 + i, status: 'active' });
  const lay = computeLab(ns, 'm', null, {});
  lay.lab = true;
  for (const r of lay.rooms) { r._alpha = 1; r._on = true; }
  return lay;
}
/** 바탕 _drawScene 흉내: 방 동적 층 → 세션 동적 층 → (카드 자리) 카드 fillRect — 그 순간 장애물을 남김 */
function withBaseStub(fn) {
  const o1 = BASE._drawScene, o2 = BASE._drawSessDyn;
  const seen = [];
  BASE._drawScene = function (ctx, now) {
    for (const r of this.rooms) if (r._on) this._drawRoomDyn(ctx, r, this._s, now);
    this._drawSessDyn(ctx, this._s, now);
    seen.push((this._canvasTextRects || []).map((q) => q.slice()));
    ctx.fillRect('CARD', 0, 10, 10); // drawCards 자리
  };
  BASE._drawSessDyn = function () {};
  try { return fn(seen); } finally { BASE._drawScene = o1; BASE._drawSessDyn = o2; }
}

test("(1) '+n' 알약은 drawCards 뒤(카드 위 층)에 그려진다 · 방 동적 층 안에서는 그리지 않음", () => {
  const lay = rigLay();
  assert.equal(lay.rooms[0].lab.rigMore.get('m'), 5);
  const v = protoView(lay, 12);
  const c = fakeCtx();
  withBaseStub(() => v._drawScene(c, 1));
  const iCard = c.ops.findIndex((o) => o[0] === 'fillRect' && o[1] === 'CARD');
  const iPill = c.ops.findIndex((o) => o[0] === 'fillText' && o[1] === '+5');
  assert.ok(iCard >= 0 && iPill >= 0, '카드·알약 둘 다');
  assert.ok(iPill > iCard, '알약이 카드 뒤에 그려짐');
  const iRR = c.ops.findIndex((o) => o[0] === 'roundRect');
  assert.ok(iRR > iCard, '알약 바탕도 카드 뒤');
  // 원문: _drawScene 에서 super 뒤에 _drawRigMore
  const lb = src('flat/lab2d.js');
  assert.match(lb, /try \{ super\._drawScene\(ctx, now\); \} finally \{ this\.vArt = va; \}[\s\S]{0,200}this\._drawRigMore\(ctx\);/);
});

test('(2) 알약 사각형이 _canvasTextRects(카드 장애물)에 들어가 placeCards 가 그 자리를 피함', () => {
  const lay = rigLay();
  const v = protoView(lay, 12);
  const c = fakeCtx();
  const seen = withBaseStub((sn) => { v._drawScene(c, 1); return sn; });
  const q = v._rigPills[0];
  assert.ok(q && q.txt === '+5');
  const pill = [q.x - q.w / 2, q.y - q.h / 2, q.x + q.w / 2, q.y + q.h / 2];
  assert.ok(seen[0].some((r) => r.every((x, i) => Math.abs(x - pill[i]) < 1e-9)), '카드 그리기 시점 장애물에 알약');
  // 카드 하나 — 원래 슬롯 가운데가 알약 가운데에 오도록 기준점을 알약 바로 위에
  const w = 84, h = 60, dir = 'search', o = cardOffset(dir, 8, w, h, 0, 0);
  const card = { anchor: { x: q.x - o.dx, y: q.y - o.dy, R: 8 }, w, h, dir, slot: 0, labelPush: 0, score: 10 };
  assert.ok(over(box(placeCards([card], [])[0]), pill), '전제: 장애물 없으면 알약과 겹침');
  const res = placeCards([card], v._canvasTextRects)[0];
  assert.equal(res.hidden, false);
  assert.ok(!over(box(res), pill), '알약과 교차 0');
});

test('(3) 정적 글 상자는 프레임을 여러 번 그려도 늘지 않음 · 동적 사각형 누적 0', () => {
  const lay = rigLay();
  const v = protoView(lay, 12);
  v._drawStatic(fakeCtx(), 12, 0);
  const nSt = v._staticTextRects.length;
  assert.ok(nSt >= 2);
  const lens = [], pools = [];
  withBaseStub(() => { for (let i = 0; i < 6; i++) { v._drawScene(fakeCtx(), i); lens.push(v._canvasTextRects.length); pools.push(v._dynPool.length); } });
  assert.equal(v._staticTextRects.length, nSt, '정적 그대로');
  assert.deepEqual(lens, Array(6).fill(nSt + 1), '정적 + 알약 1 — 프레임마다 같음');
  assert.deepEqual(pools, Array(6).fill(1), '동적 사각형 배열 재사용');
  assert.equal(v._rigPills.length, 1);
  // 정적 글 상자 배열은 정적 층을 다시 그릴 때만 새로
  v._drawStatic(fakeCtx(), 12, 0);
  assert.equal(v._staticTextRects.length, nSt);
});

test('(4) placeCards forceAvoid: force 카드도 장애물이면 다른 방향 · 다 막히면 원래 슬롯·hidden false · 없으면 기존', () => {
  const c = { anchor: { x: 500, y: 400, R: 8 }, w: 84, h: 60, dir: 'search', slot: 0, labelPush: 0, score: 1e6, force: true };
  const first = placeCards([c], [])[0];
  const ob = box(first);
  // forceAvoid 없음(기본) = 기존: 원래 슬롯 그대로
  const a = placeCards([c], [ob])[0];
  assert.equal(a.dx, first.dx); assert.equal(a.dy, first.dy); assert.equal(a.moved, false); assert.equal(a.hidden, false);
  // forceAvoid: 같은 크기로 다른 방향
  const b = placeCards([c], [ob], { forceAvoid: true })[0];
  assert.equal(b.hidden, false); assert.equal(b.moved, true); assert.equal(b.mini, false);
  assert.equal(b.w, c.w); assert.equal(b.h, c.h);
  assert.ok(!over(box(b), ob));
  assert.ok(Math.hypot(b.dx, b.dy) <= 240);
  // 모든 방향이 막힘 → 원래 슬롯, 숨기지 않음
  const all = placeCards([c], [[0, 0, 2000, 2000]], { forceAvoid: true })[0];
  assert.equal(all.hidden, false); assert.equal(all.moved, false);
  assert.equal(all.dx, first.dx); assert.equal(all.dy, first.dy);
  // 결정적
  assert.deepEqual(placeCards([c], [ob], { forceAvoid: true }), placeCards([c], [ob], { forceAvoid: true }));
  // flat-draw 는 view.cardForceAvoid 로만 넘김(declutterCards 갈래 안)
  assert.match(src('flat/flat-draw.js'), /placeCards\(inp, view\._canvasTextRects \|\| \[\], \{ miniK: HOLO\.MINI_K, forceAvoid: !!view\.cardForceAvoid, grow: CARD_GROW \}\)/);
});

test('(4b) forceAvoid: 둘레 칸이 막히면 바깥 칸(같은 크기) → 그래도 막히면 작게(miniK) · grow 는 커지는 몫까지 비킴', () => {
  const c = { anchor: { x: 500, y: 400, R: 8 }, w: 84, h: 60, dir: 'search', slot: 0, labelPush: 0, score: 1e6, force: true };
  const obs = [];
  for (const d of DECLUTTER_DIRS) { // 둘레 칸(쌓기 0)마다 바깥 끝 3px 띠 — 바깥 칸·작은 카드는 안 닿음
    const o = cardOffset(d, 8, 84, 60, 0, 0), cx = 500 + o.dx, cy = 400 + o.dy;
    const ux = Math.sign(Math.round(o.dx)), uy = Math.sign(Math.round(o.dy));
    const x0 = cx - 42, x1 = cx + 42, y0 = cy - 30, y1 = cy + 30;
    obs.push([ux > 0 ? x1 - 3 : x0, uy > 0 ? y1 - 3 : y0, ux < 0 ? x0 + 3 : x1, uy < 0 ? y0 + 3 : y1]);
  }
  const r = placeCards([c], obs, { forceAvoid: true, miniK: 0.55 })[0];
  assert.equal(r.mini, false); assert.equal(r.moved, true); assert.equal(r.hidden, false);
  assert.equal(r.w, 84); assert.ok(Math.hypot(r.dx, r.dy) <= 240);
  for (const o of obs) assert.ok(!over(box(r), o), '바깥 칸은 안 겹침');
  // 작은 카드만 들어갈 틀(원래 방향 작은 자리 + 앵커 둘레만 비움) → 작게
  const m = placeCards([{ ...c, w: 84 * 0.55, h: 60 * 0.55 }], [])[0];
  const M = [Math.min(m.x0, 492), Math.min(m.y0, 392), Math.max(m.x0 + m.w, 508), Math.max(m.y0 + m.h, 408)];
  const frame = [[0, 0, M[0] - 3, 2000], [M[2] + 3, 0, 2000, 2000], [0, 0, 2000, M[1] - 3], [0, M[3] + 3, 2000, 2000]];
  const r2 = placeCards([c], frame, { forceAvoid: true, miniK: 0.55 })[0];
  assert.equal(r2.mini, true); assert.equal(r2.hidden, false);
  assert.ok(Math.abs(r2.w - 84 * 0.55) < 1e-9);
  for (const o of frame) assert.ok(!over(box(r2), o));
  assert.equal(placeCards([c], frame)[0].mini, false, 'forceAvoid 없으면 그대로');
  // grow: 3px 떨어진 장애물 — pad 2 만으론 안 닿고, 1.1배(grow 0.1)면 닿아 비킴
  const first = placeCards([c], [])[0];
  const edge = [first.x0 + first.w + 3, first.y0, first.x0 + first.w + 10, first.y0 + first.h];
  assert.equal(placeCards([c], [edge], { forceAvoid: true })[0].moved, false);
  assert.equal(placeCards([c], [edge], { forceAvoid: true, grow: 0.1 })[0].moved, true);
  assert.deepEqual(placeCards([c], [edge], { grow: 0 }), placeCards([c], [edge]), 'grow 0 = 기존');
});

test('(5) 전체 보기 원경: 섬 이름표 사각형이 장애물에 포함 · 상위 카드·force 카드가 섬 이름표와 교차 0', () => {
  const lay = rigLay();
  const s = 4; // 원경(< FAR_LABEL_S 6)
  const v = protoView(lay, s);
  v.scope = { mode: 'all' };
  v.islandEls = new Map([['p1', { isConnected: true, _html: '<b>p1</b>', offsetWidth: 140, offsetHeight: 22 }]]);
  v._clusterV = new Map([['p1', { center: { x: 0, z: 0 }, r: 10, labelX: 0, labelZ: 5 }]]);
  assert.equal(camScale(v.cam, v.H), s);
  assert.equal(v.cardForceAvoid, true, '원경 → force 카드도 비킴');
  v._labFrameBegin();
  v._syncTextRects();
  const isl = [640 - 70, 400 + 5 * s, 640 + 70, 400 + 5 * s + 22]; // flat-view _obstacleRects 와 같은 계산
  assert.ok(v._canvasTextRects.some((r) => r.every((x, i) => Math.abs(x - isl[i]) < 1e-9)), '섬 이름표 사각형');
  // 상위(비포커스) 카드: 원래 슬롯이 섬 이름표를 덮는 기준점
  const w = 42, h = 30, dir = 'agent', o = cardOffset(dir, 3, w, h, 0, 0);
  const cx = (isl[0] + isl[2]) / 2, cy = (isl[1] + isl[3]) / 2;
  const top = { anchor: { x: cx - o.dx, y: cy - o.dy, R: 3 }, w, h, dir, slot: 0, labelPush: 0, score: 1e5 };
  assert.ok(over(box(placeCards([top], [])[0]), isl), '전제: 겹침');
  const r1 = placeCards([top], v._canvasTextRects, { forceAvoid: v.cardForceAvoid })[0];
  assert.ok(r1.hidden || !over(box(r1), isl), '상위 카드 교차 0');
  // 포커스(force) 카드도 원경에서는 비킴
  const foc = { ...top, score: 1e6, force: true };
  const r2 = placeCards([foc], v._canvasTextRects, { forceAvoid: v.cardForceAvoid })[0];
  assert.equal(r2.hidden, false);
  assert.ok(!over(box(r2), isl), 'force 카드 교차 0');
  // 가까이(s ≥ 6) → cardForceAvoid 꺼짐(force 카드는 기존대로 원래 슬롯) · 단일 범위면 섬 이름표 없음
  v.cam.D = 400 / 8;
  assert.equal(v.cardForceAvoid, false);
  v.scope = { mode: 'session' }; v.cam.D = 400 / s;
  assert.equal(v.cardForceAvoid, false);
  v._syncTextRects();
  assert.ok(!v._canvasTextRects.some((r) => r.every((x, i) => Math.abs(x - isl[i]) < 1e-9)), '단일 범위에는 섬 이름표 없음');
});

test('(6) labFarLabel: s 5.9 → true · 6 → false · 단일 범위 → false · 기준값을 바꾸면 따름 · _labFar 와 같은 판정', () => {
  assert.equal(Lab2DView.FAR_LABEL_S, 6);
  assert.equal(labFarLabel(5.9), true);
  assert.equal(labFarLabel(6), false);
  assert.equal(labFarLabel(5.9, { all: false }), false);
  assert.equal(labFarLabel(NaN), false);
  const lay = rigLay();
  const v = protoView(lay, 12);
  v.scope = { mode: 'all' };
  v.cam.D = 400 / 5.9; assert.equal(v._labFar(), true);
  v.cam.D = 400 / 6; assert.equal(v._labFar(), false);
  v.scope = { mode: 'session' }; v.cam.D = 400 / 5.9; assert.equal(v._labFar(), false, '단일 범위');
  v.scope = { mode: 'all' };
  try {
    Lab2DView.FAR_LABEL_S = 8;
    assert.equal(labFarLabel(7), true);
    v.cam.D = 400 / 7; assert.equal(v._labFar(), true); assert.equal(v.cardForceAvoid, true);
    Lab2DView.FAR_LABEL_S = 'x'; // 숫자 아님 → 무시
    assert.equal(Lab2DView.FAR_LABEL_S, 8);
    assert.equal(labFarLabel(7, { thr: 6 }), false);
  } finally { Lab2DView.FAR_LABEL_S = 6; }
  assert.equal(Lab2DView.FAR_LABEL_S, 6);
  // 원문: 배율은 camScale(바탕 그리기와 같은 식), 따로 (H/2)/D 를 계산하지 않음
  const lb = src('flat/lab2d.js');
  assert.match(lb, /labFarAt\(camScale\(this\.cam, this\.H\), this\.scope\.mode === 'all'\)/);
  assert.doesNotMatch(lb, /\(this\.H \/ 2\) \/ Math\.max/);
});

test("(8) 돌린 방(§67 _rotA)이면 '+n' 알약 자리를 그 순간 ctx 변환으로 화면 좌표로 옮김(회전 바깥에서 그리므로)", () => {
  const lay = rigLay(), r = lay.rooms[0];
  const v = protoView(lay, 12);
  const c0 = fakeCtx(); v._labFrameBegin(); v._planRigMore(c0, r, 12);
  const p0 = { ...v._rigPills[0] };
  // 화면 가운데(640,400) 둘레 90° 회전(dpr 2) 변환
  const dpr = 2, X = 640, Y = 400, M = { a: 0, b: -dpr, c: dpr, d: 0, e: dpr * (X - Y), f: dpr * (Y + X) }; // rotate(−90°) about (X, Y)
  const c1 = fakeCtx(); c1.getTransform = () => M; v.dpr = dpr; v._rotA = Math.PI / 2;
  v._labFrameBegin(); v._planRigMore(c1, r, 12);
  const q = v._rigPills[0], s = 12, w = q.w;
  const dx = p0.x - 0.9 * s - w / 2, dy = p0.y + 0.5 * s; // 책상 화면 점(회전 전)
  const ex = (M.a * dx + M.c * dy + M.e) / dpr, ey = (M.b * dx + M.d * dy + M.f) / dpr;
  assert.ok(Math.abs(q.x - (ex + 0.9 * s + w / 2)) < 1e-9 && Math.abs(q.y - (ey - 0.5 * s)) < 1e-9);
  v._rotA = 0; // 안 돌린 방은 변환을 읽지 않음
  v._labFrameBegin(); v._planRigMore(c1, r, 12);
  assert.equal(v._rigPills[0].x, p0.x); assert.equal(v._rigPills[0].y, p0.y);
});

test('(9) 시료 판·칩 방위 그대로(jobFaceExact) — 연구소 2D 만 켬, 복셀 오피스 2D 는 축 맞춤 그대로', () => {
  const v = protoView(rigLay(), 12);
  assert.equal(v.jobFaceExact, undefined, 'protoView 는 생성자를 안 거침');
  assert.match(src('flat/lab2d.js'), /this\.jobFaceExact = true;/);
  const vx = src('flat/voxel2d.js');
  assert.doesNotMatch(vx, /jobFaceExact = true/, '복셀 오피스 2D 는 켜지 않음');
  assert.match(vx, /const ex = !!this\.jobFaceExact, sf = Math\.sin\(f\), cf = Math\.cos\(f\);/);
  assert.match(vx, /const fx = ex \? sf : Math\.round\(sf\), fz = ex \? cf : Math\.round\(cf\), rx = ex \? cf : Math\.round\(cf\), rz = ex \? -sf : Math\.round\(-sf\);/);
  // 실제 그리기: 225° 판 → 돌린 사각형(경로), 끄면 축 맞춤 fillRect
  const job = { id: 'j', type: 'job', node: { id: 'j', kind: 'bash-bg', status: 'active', meta: { job: { v: 1, id: '0', state: 'running', startedAt: new Date(4000).toISOString(), beatAt: new Date(4900).toISOString() } } },
    pos: { x: 0, z: 0, face: 225 * Math.PI / 180, slot: 0, d2: 0.2 } };
  const vv = { _sp: {}, drawS: 1 };
  v.kindColor = () => '#fa0';
  v.jobFaceExact = true; const a = fakeCtx(); v._drawJob(a, job, vv, 12, 1, false);
  assert.ok(a.ops.some((o) => o[0] === 'lineTo') && !a.ops.some((o) => o[0] === 'fillRect'), '돌린 사각형');
  v.jobFaceExact = false; const b = fakeCtx(); v._drawJob(b, job, vv, 12, 1, false);
  assert.ok(b.ops.some((o) => o[0] === 'fillRect'), '축 맞춤(기존)');
});

test('(10) 포커스 이름표 forceRects(연구소 2D 만): 빈 자리가 없으면 장애물(섬 이름표)을 피한 자리 → 없으면 걸친 넓이가 가장 작은 자리 · 끄면 기존', () => {
  // 노드 아래(up false) 큰 이름표 — 바로 아래 섬 이름표, 둘레엔 다른 노드 원판이 빽빽(빈 자리 없음)
  const c = { id: 'f', x: 500, y: 400, up: false, gap: 6, force: true, modes: [{ w: 240, h: 130 }] };
  const discs = [];
  for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) discs.push({ id: 'd' + i + '_' + j, x: 500 + i * 40, y: 400 + j * 40, r: 14 });
  const isl = [400, 420, 600, 444];
  const opts = { shifts: [0, 18], farShifts: [40], bounds: [0, 1400], vbounds: [0, 800], rects: [isl] };
  const off = placeLabels([c], discs, opts).get('f');
  assert.equal(off.dy, 0); assert.ok(over(off.box, isl), '기존: 기본 자리(섬 이름표에 걸침)');
  const on = placeLabels([c], discs, { ...opts, forceRects: true }).get('f');
  assert.ok(!over(on.box, isl), '섬 이름표를 피함');
  assert.ok(on.box[1] >= 0 && on.box[3] <= 800);
  // 어디나 걸치면 걸친 넓이가 가장 작은 자리(기본 자리보다 작거나 같음)
  const wall = [[0, 0, 1400, 300], [400, 420, 600, 444], [0, 520, 1400, 800]];
  const area = (b) => wall.reduce((a, r) => a + Math.max(0, Math.min(b[2], r[2]) - Math.max(b[0], r[0])) * Math.max(0, Math.min(b[3], r[3]) - Math.max(b[1], r[1])), 0);
  const p0 = placeLabels([c], discs, { ...opts, rects: wall }).get('f'), p1 = placeLabels([c], discs, { ...opts, rects: wall, forceRects: true }).get('f');
  assert.ok(area(p1.box) <= area(p0.box));
  assert.match(src('flat/lab2d.js'), /this\.labelForceRects = true;/);
  assert.match(src('flat/flat-view.js'), /forceRects: !!this\.labelForceRects/);
});
