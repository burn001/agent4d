// node --test "web/test/lab-2d-fix.test.mjs" T5-2d 연구소 2D 수리: 도구 카드 겹침 풀기(placeCards) · 섬 이름표 자리(labelX·labelZ) ·
// 의뢰인 창구·특별 상호작용 연구소 분기(vx2d-extra) · rigMore '+n' 알약 · 캔버스 글 상자(문패·라운지) 장애물
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeCards, cardOffset, islandLabelAt } from '../flat/flat-core.mjs';
import { LAB } from '../lab/lab-const.mjs';
import { computeLab } from '../lab/lab-layout-core.mjs';
import { rigSlots } from '../lab/lab-rig-core.mjs';
import { Lab2DView } from '../flat/lab2d.js';
import { DARK } from '../voxel/palette-hex.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(path.join(WEB, f), 'utf8');
const box = (p) => [p.x0, p.y0, p.x0 + p.w, p.y0 + p.h];
const over = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** 같은 기준점(책상)에 카드 n 장 — 방향·점수 다르게 */
function stack(n, { force = -1 } = {}) {
  const dirs = ['shell', 'search', 'read', 'edit', 'agent', 'misc', 'web'];
  const out = [];
  for (let i = 0; i < n; i++) out.push({ anchor: { x: 500, y: 400, R: 8 }, w: 84, h: 60, dir: dirs[i % 2], slot: 0, labelPush: 0, score: 100 - i, force: i === force });
  return out;
}

test('(a) placeCards: 같은 자리 기준점 카드 5장 → 보이는 카드끼리 겹침 0 · 점수 높은 카드는 원래 슬롯 · 결정적', () => {
  const cards = stack(5);
  const res = placeCards(cards, []);
  const vis = res.filter((p) => !p.hidden);
  assert.ok(vis.length >= 2, '적어도 둘은 보임');
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) assert.ok(!over(box(vis[i]), box(vis[j])), `겹침 ${i}-${j}`);
  const o0 = cardOffset(cards[0].dir, 8, 84, 60, 0, 0);
  assert.equal(res[0].dx, o0.dx); assert.equal(res[0].dy, o0.dy); assert.equal(res[0].moved, false); assert.equal(res[0].mini, false);
  // 같은 방향 두 번째(점수 낮음)는 원래 슬롯이 겹쳐 다른 방향·작게·숨김 중 하나
  assert.ok(res[2].moved || res[2].mini || res[2].hidden);
  assert.deepEqual(placeCards(stack(5), []), res, '결정적');
  // 입력 순서를 섞어도 점수 기준 결과는 같다
  const rev = placeCards(stack(5).reverse(), []).reverse();
  assert.deepEqual(rev, res);
});

test('(a) placeCards: 포커스(force) 카드는 겹쳐도 원래 슬롯에 보임', () => {
  const cards = stack(4, { force: 2 }); // 점수는 낮아도 force
  cards[2].score = 50; // 다른 카드보다 낮음 → 이미 놓인 카드와 겹침
  const res = placeCards(cards, [[0, 0, 2000, 2000]]); // 화면 전체 장애물 — 보통 카드는 모두 숨김
  assert.equal(res[2].hidden, false);
  const o = cardOffset(cards[2].dir, 8, 84, 60, 0, 0);
  assert.equal(res[2].dx, o.dx); assert.equal(res[2].dy, o.dy);
  for (const i of [0, 1, 3]) assert.equal(res[i].hidden, true);
});

test('(b) placeCards: 장애물 사각형(문패)과 겹치면 다른 슬롯 · 리더선 상한', () => {
  const c = { anchor: { x: 500, y: 400, R: 8 }, w: 84, h: 60, dir: 'search', slot: 0, labelPush: 0, score: 10 };
  const first = placeCards([c], [])[0];
  const sign = box(first); // 원래 자리에 문패
  const r = placeCards([c], [sign])[0];
  assert.equal(r.hidden, false); assert.equal(r.moved, true);
  assert.ok(!over(box(r), sign));
  assert.ok(Math.hypot(r.dx, r.dy) <= 240);
  // 리더선 상한이 아주 짧으면 다른 방향도 못 감 → 작게(원래 자리도 문패라) → 숨김
  const r2 = placeCards([c], [[0, 0, 2000, 2000]], { maxLead: 10 })[0];
  assert.equal(r2.hidden, true);
  // 작게(mini): 큰 카드는 못 들어가지만 작은 카드는 들어가는 틈
  const ob = [[0, 0, 2000, 400 - 8 - 6 - 40], [0, 400 + 8, 2000, 2000], [0, 0, 500 - 60, 2000], [500 + 60, 0, 2000, 2000]];
  const r3 = placeCards([c], ob, { miniK: 0.4 })[0];
  if (!r3.hidden) { assert.equal(r3.mini, true); for (const q of ob) assert.ok(!over(box(r3), q)); }
});

test('(c) 회귀: on=false 는 기존 cardOffset 그대로 · 겹침이 없으면 on=true 도 그대로', () => {
  const cards = stack(5).map((c, i) => ({ ...c, slot: i, labelPush: i * 3 }));
  const off = placeCards(cards, [[0, 0, 2000, 2000]], { on: false });
  cards.forEach((c, i) => {
    const o = cardOffset(c.dir, c.anchor.R, c.w, c.h, c.slot, c.labelPush);
    assert.equal(off[i].dx, o.dx); assert.equal(off[i].dy, o.dy); assert.equal(off[i].hidden, false);
  });
  const lone = [{ anchor: { x: 100, y: 100, R: 5 }, w: 70, h: 50, dir: 'read', slot: 1, labelPush: 4, score: 1 }];
  const a = placeCards(lone, [])[0], o = cardOffset('read', 5, 70, 50, 1, 4);
  assert.equal(a.dx, o.dx); assert.equal(a.dy, o.dy); assert.equal(a.moved, false);
  // 플래그: 연구소 2D 만 켬(바탕 Voxel2DView·Flow·Planet 은 없음 = false)
  assert.match(src('flat/lab2d.js'), /this\.cardDeclutter = true/);
  assert.match(src('flat/flat-draw.js'), /if \(view\.cardDeclutter\) declutterCards\(/);
  for (const f of ['flat/voxel2d.js', 'flat/flow2d.js', 'flat/planet2d.js']) {
    let s = ''; try { s = src(f); } catch { continue; }
    assert.doesNotMatch(s, /cardDeclutter\s*=\s*true/, f);
  }
});

test('(d) 섬 이름표 자리: labelX·labelZ 가 있으면 그 값, 없으면 bounds.maxZ + 1.6 · x 는 null(가운데)', () => {
  const b = { bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 20 } };
  assert.deepEqual(islandLabelAt(b), { x: null, z: 21.6 });
  assert.deepEqual(islandLabelAt({ ...b, labelZ: 33 }), { x: null, z: 33 });
  assert.deepEqual(islandLabelAt({ ...b, labelX: 4, labelZ: 0 }), { x: 4, z: 0 }); // 0 도 값
  assert.match(src('flat/voxel2d.js'), /labelZ: islandLabelAt\(b\)\.z, labelX: islandLabelAt\(b\)\.x/);
  const fv = src('flat/flat-view.js');
  assert.match(fv, /e\.labelX = c\.labelX \?\? null/);
  assert.equal((fv.match(/e\.labelX \?\? e\.center\.x/g) || []).length, 2, '장애물·자리 두 곳');
  assert.match(fv, /const ct = this\._labelTextRects \|\| this\._canvasTextRects;[^\n]*\n {4}if \(ct\) rects\.push\(\.\.\.ct\);/); // 연구소 2D 는 섬 이름표 뺀 _labelTextRects(중복 방지)
});

test('(e) 원문 연결: vx2d-extra 연구소 분기 · lab2d cardDeclutter·rigMore · 원경 이름표 갈래', () => {
  const vx = src('flat/vx2d-extra.js');
  assert.equal((vx.match(/room\.type === 'office' \|\| room\.type === 'lab'/g) || []).length, 2, 'holdPts·drawIx');
  assert.match(vx, /r\.type !== 'office' && r\.type !== 'lab'/);
  assert.match(vx, /const odd = r\.type !== 'lab' &&/);
  const lb = src('flat/lab2d.js');
  assert.match(lb, /cardDeclutter/); assert.match(lb, /rigMore/); assert.match(lb, /_canvasTextRects/);
  assert.match(lb, /_labelCandidates\(push, actives, maxLabels, order, seen\)/);
});

/** 화면 없이 Lab2DView 그리기 경로만 */
function protoView(lay, s = 12) {
  const v = Object.create(Lab2DView.prototype);
  Object.assign(v, { layout: lay, rooms: lay.rooms, roomsById: new Map(lay.rooms.map((r) => [r.id, r])), pal: DARK,
    tokens: { bg: '#111', text: '#eee', muted: '#999', ok: '#3d3', error: '#e33', warn: '#fa0', skill: '#c6f', isLight: false },
    W: 1280, H: 800, _s: s, _now: 2, reduced: false, vis: new Map(), chars: new Map(), machines: new Map(), focusId: null, hoverId: null,
    _labHits: [], _labArt: null, clock: () => 5000, scope: { mode: 'session' } });
  v._labPlan = { rP: 7, sectors: [], cellOf: new Map(), more: { n: 0 } };
  v._X = (x) => x * s + 640; v._Y = (z) => z * s + 400;
  return v;
}
const CTX_FNS = ['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'arc', 'ellipse', 'rect', 'roundRect', 'fillRect', 'strokeRect', 'fillText', 'save', 'restore', 'translate', 'rotate', 'setTransform', 'setLineDash', 'drawImage', 'clip'];
function fakeCtx() {
  const calls = {}, texts = [], ctx = { calls, texts };
  for (const k of CTX_FNS) ctx[k] = () => { calls[k] = (calls[k] || 0) + 1; };
  ctx.fillText = (t) => { calls.fillText = (calls.fillText || 0) + 1; texts.push(String(t)); };
  ctx.measureText = (s) => ({ width: String(s).length * 6 });
  ctx.createLinearGradient = ctx.createRadialGradient = () => ({ addColorStop() {} });
  return ctx;
}

test('Lab2DView: 정적 층이 문패·라운지 글 상자를 _canvasTextRects 로 기록', () => {
  const ns = [{ id: 'm', kind: 'main', order: 0, status: 'active', label: 'main' }];
  for (let i = 0; i < 6; i++) ns.push({ id: 's' + i, kind: 'subagent', parentId: 'm', order: i + 1, status: 'active' });
  const lay = computeLab(ns, 'm', null, {});
  const v = protoView(lay, 12);
  v._drawStatic(fakeCtx(), 12, 0);
  assert.ok(Array.isArray(v._staticTextRects) && v._staticTextRects.length >= 2, '문패·라운지(·브리지)');
  v._syncTextRects(); // 프레임마다(drawCards 앞) 정적 + 동적 → _canvasTextRects
  assert.ok(Array.isArray(v._canvasTextRects) && v._canvasTextRects.length >= v._staticTextRects.length);
  for (const r of v._canvasTextRects) assert.ok(r[2] > r[0] && r[3] > r[1]);
});

test("Lab2DView: rigMore '+n' 알약 — 첫 구역 방에서 주인 책상 옆 · s ≤ 3 이면 없음", () => {
  const n0 = rigSlots(0, 0, LAB.PLATFORM.R_DEFAULT).length;
  const ns = [{ id: 'm', kind: 'main', order: 0, status: 'active' }];
  for (let i = 0; i < n0 + LAB.RIG.SHELF_MAX + 5; i++) ns.push({ id: 'b' + i, kind: 'bash-bg', parentId: 'm', order: 1 + i, status: 'active' });
  const lay = computeLab(ns, 'm', null, {});
  const r = lay.rooms[0];
  assert.equal(r.lab.rigMore.get('m'), 5);
  const v = protoView(lay, 12);
  r._alpha = 1;
  // 방 동적 층에서는 자리만(카드 아래에 그리지 않음) → _drawRigMore 가 카드 위에서 그림
  const c = fakeCtx();
  v._labFrameBegin();
  v._drawRoomDyn(c, r, 12, 1);
  assert.ok(!c.texts.includes('+5'), '방 동적 층에서는 그리지 않음');
  assert.deepEqual(v._rigPills.map((q) => q.txt), ['+5']);
  v._drawRigMore(c);
  assert.ok(c.texts.includes('+5'));
  const c2 = fakeCtx();
  v._labFrameBegin();
  v._drawRoomDyn(c2, r, 3, 1);
  assert.equal(v._rigPills.length, 0);
  v._drawRigMore(c2);
  assert.ok(!c2.texts.includes('+5'));
});

test('Lab2DView: 전체 보기 원경에서는 연구동 안 노드 이름표 후보를 메인·포커스·호버만', () => {
  const ns = [{ id: 'm', kind: 'main', order: 0, status: 'active', label: 'main' }];
  for (let i = 0; i < 4; i++) ns.push({ id: 's' + i, kind: 'subagent', parentId: 'm', order: i + 1, status: 'active' });
  const lay = computeLab(ns, 'm', null, {});
  lay.lab = true;
  const v = protoView(lay, 12);
  v.layout = lay; v.focusId = 's1'; v.hoverId = null;
  for (const n of ns) v.vis.set(n.id, { id: n.id, node: n });
  v.chars.set('m', { id: 'm', lead: true, node: ns[0] });
  for (const n of ns.slice(1)) v.chars.set(n.id, { id: n.id, lead: false, node: n });
  const got = [];
  const push = (id) => { if (id && !got.includes(id)) got.push(id); };
  // 원경: 바탕 후보가 무엇을 밀든 연구동 안 일반 노드는 걸러짐
  v.scope = { mode: 'all' }; v.cam = { x: 0, z: 0, D: 400 }; // s = 1 px/m
  const base = Object.getPrototypeOf(Lab2DView.prototype);
  const orig = base._labelCandidates;
  base._labelCandidates = function (p) { p(this.focusId, true); for (const id of this.vis.keys()) p(id, false); };
  try {
    v._labelCandidates(push, [], 8, [], new Set());
    assert.deepEqual(got.sort(), ['m', 's1']);
    // 가까이(s 큼) → 전부
    got.length = 0; v.cam.D = 10;
    v._labelCandidates(push, [], 8, [], new Set());
    assert.equal(got.length, ns.length);
  } finally { base._labelCandidates = orig; }
});
