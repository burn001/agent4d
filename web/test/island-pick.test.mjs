// 전체 보기 섬·건물 클릭 판정과 섬 표현 강도 순수 함수 시험
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickIslandAt, pickRectAt, pickLabelAt, islandPickTol, islandStyle, PULSE_AMP } from '../overview/pick-core.mjs';

const A = { projectId: 'a', center: { x: 0, z: 0 }, r: 20 };
const B = { projectId: 'b', center: { x: 60, z: 0 }, r: 10 };

test('섬: 중앙·안쪽·링 선 위는 그 프로젝트', () => {
  assert.equal(pickIslandAt([A, B], 0, 0), 'a');
  assert.equal(pickIslandAt([A, B], 12, 0), 'a');
  assert.equal(pickIslandAt([A, B], 0, 19.9), 'a');
  assert.equal(pickIslandAt([A, B], 60, -10), 'b');
});

test('섬: 링 바깥 허용 오차 안은 잡고, 그 밖은 null', () => {
  assert.equal(islandPickTol(20), 1.6);
  assert.equal(islandPickTol(5), 1.5);
  assert.equal(pickIslandAt([A, B], 21.5, 0), 'a');
  assert.equal(pickIslandAt([A, B], 0, -21.8), null);
  assert.equal(pickIslandAt([A, B], 30, 30), null);
  assert.equal(pickIslandAt([], 0, 0), null);
});

test('섬: 허용 오차가 겹치면 반지름 대비 더 가까운 섬', () => {
  const C = { projectId: 'c', center: { x: 21, z: 0 }, r: 2 };
  assert.equal(pickIslandAt([A, C], 20.5, 0), 'c');
  assert.equal(pickIslandAt([A, C], 15, 0), 'a');
});

test('건물: bounds 안과 pad 여유, 밖은 null', () => {
  const bs = [{ projectId: 'x', bounds: { minX: 0, maxX: 24, minZ: 0, maxZ: 18 } }, { projectId: 'y', bounds: { minX: 40, maxX: 56, minZ: 0, maxZ: 12 } }];
  assert.equal(pickRectAt(bs, 12, 9), 'x');
  assert.equal(pickRectAt(bs, 25, 9), 'x');
  assert.equal(pickRectAt(bs, 26, 9), null);
  assert.equal(pickRectAt(bs, 39, 13), 'y');
  assert.equal(pickRectAt(bs, 32, 9, 0), null);
});

test('이름표: 사각형 안이면 data-pid, 숨김·밖은 null', () => {
  const mk = (pid, r, display = '') => ({ dataset: { pid }, style: { display }, getBoundingClientRect: () => r });
  const els = [mk('h', { left: 0, right: 100, top: 0, bottom: 20, width: 100 }, 'none'), mk('a', { left: 10, right: 110, top: 50, bottom: 70, width: 100 })];
  const root = { querySelectorAll: () => els };
  assert.equal(pickLabelAt(50, 60, root), 'a');
  assert.equal(pickLabelAt(50, 10, root), null);
  assert.equal(pickLabelAt(500, 60, root), null);
  assert.equal(pickLabelAt(1, 1, null), null);
});

test('섬 표현(§67): 아주 옅게(고리 0.08～0.15·원판 0.1 이하), 흐림·비활성은 더 옅고 맥동 없음', () => {
  for (const light of [false, true]) {
    const hot = islandStyle({ hot: true, light }), calm = islandStyle({ light }), off = islandStyle({ inactive: true, light }), dim = islandStyle({ hot: true, dimmed: true, light });
    assert.ok(hot.ring <= 0.15 && hot.disc <= 0.1 && hot.inner <= 0.08);
    assert.ok(hot.ring > calm.ring && calm.ring > off.ring && off.ring >= 0.08);
    assert.ok(dim.ring < hot.ring && dim.disc < hot.disc);
    assert.ok(hot.ringMix > 0 && hot.ringMix < 1);
  }
  assert.equal(islandStyle({ hot: true, inactive: true }).hot, false);
  assert.equal(PULSE_AMP, 0);
});

test('섬 외곽 슈퍼타원(§67): 점들이 상자 안·외곽선 위, 모서리 바깥은 고르지 않음', async () => {
  const { islandOutline, squircleK } = await import('../overview/pick-core.mjs');
  const box = { hw: 30, hd: 12 };
  const pts = islandOutline(box, 1, 6);
  assert.ok(pts.length >= 48);
  for (const [x, z] of pts) { assert.ok(Math.abs(x) <= 30 + 1e-9 && Math.abs(z) <= 12 + 1e-9); assert.ok(Math.abs(squircleK(box, x, z) - 1) < 1e-6); }
  assert.ok(pts.some(([x, z]) => Math.abs(x - 30) < 1e-9 && Math.abs(z) < 1e-9), '상자 변 가운데에 닿음');
  const c = [{ projectId: 'a', center: { x: 0, z: 0 }, r: 33, box }];
  assert.equal(pickIslandAt(c, 0, 0), 'a');
  assert.equal(pickIslandAt(c, 29, 0), 'a');
  assert.equal(pickIslandAt(c, 29.5, 11.8), null, '상자 모서리(슈퍼타원 밖)');
});
