// 시각 무게중심: 에이전트·패널을 화면 넓이로 가중한 중심을 화면 가운데로, 다 담는 거리는 1.15배까지만 늘림
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refineFit, requiredDist, MASS_GROW } from '../camera-core.mjs';
import { refineFit2D, fitNeed } from '../flat/flat-core.mjs';

const R = { x: 1, y: 0, z: 0 }, U = { x: 0, y: 1, z: 0 }, F = { x: 0, y: 0, z: 1 };
const O = { x: 0, y: 0, z: 0 };
// 왼쪽 작은 에이전트 둘 + 오른쪽 큰 패널(4 × 2, 모서리 넷에 넓이 나눔)
const panel = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => ({ p: { x, y, z: 0 }, r: 0, aux: true, w: ((x1 - x0) * (y1 - y0)) / 4 }));
const pts = [{ p: { x: 0, y: 0, z: 0 }, r: 0.5 }, { p: { x: 1.5, y: 0, z: 0 }, r: 0.5 }, ...panel(5, 9, -1, 1)];

test('3D: mass 끄면 예전 그대로', () => {
  assert.deepEqual(refineFit(pts, O, R, U, F, 0.5, 0.5, 4, 0, false), refineFit(pts, O, R, U, F, 0.5, 0.5, 4, 0));
});
test('3D: 무거운 쪽(패널)으로 가운데가 옮겨 가고, 모두 담기며, 거리는 1.15배 안', () => {
  const a = refineFit(pts, O, R, U, F, 0.5, 0.5, 4, 0);
  const b = refineFit(pts, O, R, U, F, 0.5, 0.5, 4, 0, true);
  assert.ok(b.c.x > a.c.x + 0.1, `${b.c.x} > ${a.c.x}`);
  assert.ok(b.D <= a.D * MASS_GROW + 1e-9);
  assert.ok(requiredDist(pts, b.c, R, U, F, 0.5, 0.5) <= b.D + 1e-6);
});
test('3D: 대칭이면 그대로', () => {
  const sym = [{ p: { x: -3, y: 0, z: 0 }, r: 1 }, { p: { x: 3, y: 0, z: 0 }, r: 1 }];
  const a = refineFit(sym, O, R, U, F, 0.5, 0.5, 4, 0), b = refineFit(sym, O, R, U, F, 0.5, 0.5, 4, 0, true);
  assert.ok(Math.abs(a.c.x - b.c.x) < 1e-6);
});
test('2D: 패널 카드(e) 넓이로 같은 규칙', () => {
  const p2 = [{ p: { x: 0, y: 0, z: 0 }, r: 0.5 }, { p: { x: 1.5, y: 0, z: 0 }, r: 0.5 }, { p: { x: 2, y: 0, z: 0 }, r: 0, aux: true, panel: true, e: { l: 0, r: 0.5, t: 0.15, b: 0.15 } }];
  const a = refineFit2D(p2, { x: 0, z: 0 }, 1.6, 0.9, 0.9, 3);
  const b = refineFit2D(p2, { x: 0, z: 0 }, 1.6, 0.9, 0.9, 3, true);
  assert.ok(b.c.x > a.c.x);
  assert.ok(fitNeed(p2, b.c, 1.6, 0.9, 0.9) <= b.D + 1e-6 && b.D <= a.D * 1.15 + 1e-9);
});
