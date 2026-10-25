// Planet 2D 궤도계 — 투영·LOD·상태 진행·정리 연출·투사 빔 시작점·입자 상한
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projOrbit, ELEV, orbitLod2d, LOD2D_K, stepOrbits, nearestSat, burst, drawBursts } from '../flat/planet-orbits2d.js';
import { orbitLod } from '../planet-core.mjs';

test('투영: 기울기 0 궤도는 세로가 sin(ELEV) 배로 납작, 앞(아래)쪽이 깊이 +', () => {
  const o = {};
  projOrbit(1, 0, 0, 0, o); assert.ok(Math.abs(o.x - 1) < 1e-9 && Math.abs(o.y) < 1e-9);
  projOrbit(0, 1, 0, 0, o); assert.ok(Math.abs(o.y - Math.sin(ELEV)) < 1e-9 && o.d > 0);
  projOrbit(0, -1, 0, 0, o); assert.ok(o.d < 0);
  // 승교점 회전은 모양을 돌린다(원 위 점은 반지름 유지)
  projOrbit(Math.cos(0.7), Math.sin(0.7), 0, 1.1, o); assert.ok(o.x * o.x + (o.y / Math.sin(ELEV)) ** 2 - 1 < 1e-9);
});

test('2D LOD 는 같은 문턱을 본체 px × LOD2D_K 로', () => {
  for (const px of [1, 3.8, 4, 8, 9, 20, 40]) assert.equal(orbitLod2d(px), orbitLod(px * LOD2D_K));
  assert.equal(orbitLod2d(0), 0);
});

const mkView = (reduced = false) => ({ reduced, tokens: { isLight: false } });
const mkV = (status, tools = 0) => ({ id: 'node-x', kind: 'subagent', node: { status }, icons: new Map(Array.from({ length: tools }, (_, i) => [i, {}])) });

test('상태 진행: 도구 호출이면 궤도가 빨리 돌고, 동작 줄이기면 멈춤', () => {
  const v = mkV('active', 1), w = mkV('active', 1);
  stepOrbits(mkView(), v, 0); stepOrbits(mkView(true), w, 0);
  const a0 = [...v._po.th], b0 = [...w._po.th];
  for (let t = 0.1; t <= 2; t += 0.1) { stepOrbits(mkView(), v, t); stepOrbits(mkView(true), w, t); }
  assert.ok(v._po.th.some((x, i) => Math.abs(x - a0[i]) > 0.5));
  assert.deepEqual(w._po.th, b0);
});

test('완료로 바뀌면 짧은 정리 연출 후 진정', () => {
  const v = mkV('active', 0);
  stepOrbits(mkView(), v, 0);
  v.node.status = 'done';
  stepOrbits(mkView(), v, 0.5);
  stepOrbits(mkView(), v, 0.9);
  assert.ok(v._po.settle > 0);
  stepOrbits(mkView(), v, 3);
  assert.equal(v._po.settle, 0);
  // 처음부터 끝나 있던 노드는 연출 없음
  const u = mkV('done'); stepOrbits(mkView(), u, 0); stepOrbits(mkView(), u, 0.3); assert.equal(u._po.settle, 0);
});

test('투사 빔 시작점 = 카드에 가장 가까운 위성, 위성이 없으면 null', () => {
  assert.equal(nearestSat({}, 0, 0), null);
  const v = { _po: { sat: [10, 10, 100, 0, -50, 40] } };
  assert.deepEqual(nearestSat(v, 90, 5), { x: 100, y: 0 });
  assert.deepEqual(nearestSat(v, -60, 60), { x: -50, y: 40 });
});

test('도구 입자: 상한을 넘지 않고, 수명이 지나면 사라짐', () => {
  const view = { _pbNow: 0 };
  for (let i = 0; i < 400; i++) burst(view, 0, 0, 1, 0, 0.5, '#fff');
  assert.ok(view._pb.length <= 260);
  const ctx = { fillRect() {}, set globalAlpha(v) {}, set fillStyle(v) {} };
  assert.equal(drawBursts(view, ctx, 0.2), true);
  assert.equal(drawBursts(view, ctx, 1), false);
  assert.equal(view._pb.length, 0);
});
