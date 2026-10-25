// 사용자 입력 빛줄기 — 비행 시간·곡선·꼬리·2D 제어점
import test from 'node:test';
import assert from 'node:assert/strict';
import { missileDur, flightEase, bez, trailAt, TRAIL, missile2D, MISSILE_REDUCED, ABSORB_FROM } from '../missile-core.mjs';

test('비행 시간 0.9～1.3초(거리 비례) · 움직임 줄이기는 짧게', () => {
  assert.equal(missileDur(0), 0.9); assert.equal(missileDur(1e6), 1.3);
  assert.ok(missileDur(40) > missileDur(10));
  assert.ok(MISSILE_REDUCED.dur < 0.6 && ABSORB_FROM > 0.7 && ABSORB_FROM < 1);
});
test('곡선: 시작·끝 고정, 진행은 단조, 꼬리는 머리 뒤로 가늘고 투명', () => {
  const p0 = { x: 0, y: 0, z: 0 }, c1 = { x: 5, y: -2, z: 3 }, c2 = { x: 9, y: 6, z: 8 }, p1 = { x: 10, y: 4, z: 10 }, o = {};
  assert.deepEqual(bez(o, p0, c1, c2, p1, 0), { x: 0, y: 0, z: 0 });
  assert.deepEqual(bez({}, p0, c1, c2, p1, 1), { x: 10, y: 4, z: 10 });
  let prev = -1; for (let k = 0; k <= 1.0001; k += 0.05) { const t = flightEase(k); assert.ok(t >= prev); prev = t; }
  assert.equal(flightEase(0), 0); assert.equal(flightEase(1), 1);
  const a = trailAt(0.8, 0), b = trailAt(0.8, TRAIL.N - 1);
  assert.equal(a.t, 0.8); assert.ok(b.t < a.t && b.w < 0.05 && b.a < 0.05 && a.w === 1 && a.a === 1);
  for (let i = 1; i < TRAIL.N; i++) assert.ok(trailAt(0.6, i).t <= trailAt(0.6, i - 1).t);
});
test('2D 제어점: 화면 하단 가운데에서 출발, 옆으로 흘렀다가 목표로', () => {
  const C = missile2D(1440, 900, 300, 200, 1);
  assert.equal(C.p0.x, 720); assert.ok(C.p0.y > 900);
  assert.ok(C.c1.x > C.p0.x, '처음엔 옆(side +1)으로 흘림');
  assert.deepEqual(C.p1, { x: 300, y: 200 });
  const L = missile2D(1440, 900, 300, 200, -1); assert.ok(L.c1.x < L.p0.x, '반대쪽');
});
