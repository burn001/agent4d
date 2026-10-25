// Planet 행성 연출 규칙
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MECH, SUB, planetMode, approach, pxRadius, planetLod, PLANET_LOD, hatchOpen } from '../planet-core.mjs';

test('상태 → 동작: 도구 호출 > 생각 중 > 대기 > 완료', () => {
  assert.equal(planetMode('active', 2), 'tool');
  assert.equal(planetMode('active', 0), 'think');
  assert.equal(planetMode('idle', 0), 'wait');
  assert.equal(planetMode('done', 3), 'off');
  assert.equal(planetMode('stopped'), 'off');
  assert.equal(planetMode('error'), 'error');
  assert.equal(planetMode('active', 1, true), 'wait'); // 고정 희미(recent)는 조용히
  for (const T of [MECH, SUB]) assert.ok(T.tool.spin > T.think.spin && T.think.spin > T.wait.spin && T.wait.spin > T.off.spin);
  assert.ok(MECH.tool.hatch > MECH.think.hatch && MECH.tool.ant > MECH.wait.ant && MECH.tool.glow > MECH.wait.glow);
});

test('approach 는 목표 쪽으로 부드럽게, 처음엔 바로 목표', () => {
  const c = approach({}, { spin: 2 }, 0.1);
  assert.equal(c.spin, 2);
  approach(c, { spin: 0 }, 0.1, 3);
  assert.ok(c.spin < 2 && c.spin > 0);
  for (let i = 0; i < 200; i++) approach(c, { spin: 0 }, 0.05, 3);
  assert.ok(Math.abs(c.spin) < 1e-3);
});

test('화면 반지름과 LOD 문턱', () => {
  const px = pxRadius(1, 10, 50, 900);
  assert.ok(Math.abs(px - 900 / (2 * Math.tan((25 * Math.PI) / 180) * 10)) < 1e-9);
  assert.ok(pxRadius(1, 20, 50, 900) < px);
  assert.equal(planetLod(PLANET_LOD.HIDE_PX - 0.1), 0);
  assert.equal(planetLod(PLANET_LOD.HIDE_PX), 1);
  assert.equal(planetLod(PLANET_LOD.DETAIL_PX + 1), 2);
  assert.equal(planetLod(NaN), 0);
  assert.equal(planetLod(pxRadius(1, 0, 50, 900)), 2);
});

test('해치는 세기 0 이면 닫힘, 칸마다 엇갈려 열림', () => {
  assert.equal(hatchOpen(0, 1.2, 0), 0);
  let open = 0, diff = 0;
  for (let t = 0; t < 10; t += 0.1) { const a = hatchOpen(0, t, 1), b = hatchOpen(1, t, 1); assert.ok(a >= 0 && a <= 1); if (a > 0.5) open++; if (Math.abs(a - b) > 0.3) diff++; }
  assert.ok(open > 5 && diff > 5);
});
