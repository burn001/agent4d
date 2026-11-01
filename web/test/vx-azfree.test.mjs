// 복셀: 홀로그램 모니터 뒷면 = 투명 거울상 · 카메라 방위각 풀기(360°) · 카메라 쪽 벽 낮춤 · 바닥 스텐실 뒤집기 — 순수 함수 + 소스 확인
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DESK_MON } from '../voxel/office-core.mjs';
import { azRanged, spinStep, shotYawStep } from '../camera-core.mjs';
import { wallHigh, camQuadrant, CAM_Q0 } from '../voxel/xf.mjs';
import { stencilFlip } from '../voxel/stencil-core.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('모니터 뒷면(§72.11): 양면 + 뒷면만 옅게(앞면 내용이 거울상으로 비침)', () => {
  assert.ok(DESK_MON.BACK_A > 0.3 && DESK_MON.BACK_A < 0.8, '앞면보다 옅되 읽힐 만큼');
  const holo = src('../voxel/vx-holo.js');
  assert.match(holo, /if \(!gl_FrontFacing\) a \*= uBack;/, '틀: 뒷면은 같은 무늬를 uBack 배로');
  assert.doesNotMatch(holo, /if \(!gl_FrontFacing\) \{/, '뒷면 전용 어두운 판(글 없음) 분기는 없앰');
  assert.match(holo, /side: THREE\.DoubleSide/);
  assert.match(holo, /new HoloText\(scene, \{ world: true, backAlpha: DESK_MON\.BACK_A \}\)/);
  const ht = src('../holo-text.js');
  assert.match(ht, /gl_FrontFacing \? 1\.0 : uBack/, '글: 뒷면 = 거울상(uv 그대로) × uBack');
  assert.doesNotMatch(ht, /THREE\.FrontSide/, '세계 모드도 양면');
});

test('방위각 풀기(§72.11): 복셀 azFree, 흐름·기본은 그대로', () => {
  assert.equal(azRanged({ azCenter: 45, azRange: 28 }), true);
  assert.equal(azRanged({ azCenter: 45, azRange: 28, azFree: true }), false);
  assert.equal(azRanged({ azCenter: null, azRange: null }), false);
  const off = src('../voxel/office.js');
  assert.match(off, /azFree: true, azShotStep: 70, idleOrbit: \{ spin: 2\.4, minK: 0\.35 \}/);
  // 흐름은 왕복 궤도 그대로(spin 없음)
  assert.match(src('../flowview/flow-view.js'), /idleOrbit: \{ amp: 16, period: 46 \}/);
});

test('한 방향 360° 돌기(§72.11): 쉴 때 spin, 바빠도 minK 몫, 한 바퀴 시간', () => {
  const io = { spin: 2.4, minK: 0.35 };
  const full = spinStep(io, 1, 1), busy = spinStep(io, 0, 1);
  assert.ok(Math.abs(full - (2.4 * Math.PI) / 180) < 1e-12);
  assert.ok(Math.abs(busy - full * 0.35) < 1e-12, '바쁠 때도 돈다');
  assert.ok((2 * Math.PI) / full <= 160 && (2 * Math.PI) / busy <= 460, '쉴 때 150초, 바빠도 7분 안에 한 바퀴');
  assert.equal(spinStep({ amp: 16, period: 46 }, 1, 1), 0, '흐름(왕복)은 spin 아님');
  assert.equal(spinStep(io, 1, 0), 0);
});

test('순환 샷 방위 돌림(§72.11): 몇 샷이면 앞·옆·뒤를 다 지남', () => {
  const seen = new Set();
  let a = 45;
  for (let n = 1; n <= 6; n++) { a += (shotYawStep(70, n) * 180) / Math.PI; seen.add(Math.floor((((a % 360) + 360) % 360) / 90)); }
  assert.equal(seen.size, 4, '네 사분면');
  assert.equal(shotYawStep(0, 3), 0);
});

test('카메라 쪽 벽 낮춤(§72.11): 어느 사분면에서나 먼 쪽 두 벽만 높음', () => {
  assert.deepEqual(['back', 'left', 'front', 'right'].map((s) => wallHigh(null, s)), [true, true, false, false], '기본 = 예전');
  const cases = [
    [{ x: 1, z: 1 }, [true, true, false, false]],
    [{ x: -1, z: 1 }, [true, false, false, true]],
    [{ x: -1, z: -1 }, [false, false, true, true]],
    [{ x: 1, z: -1 }, [false, true, true, false]],
  ];
  for (const [cam, want] of cases) {
    assert.deepEqual(['back', 'left', 'front', 'right'].map((s) => wallHigh(null, s, cam)), want, JSON.stringify(cam));
    for (let k = 0; k < 4; k++) {
      assert.equal(['back', 'front'].filter((s) => wallHigh({ k }, s, cam)).length, 1, '마주 보는 벽 중 하나만');
      assert.equal(['left', 'right'].filter((s) => wallHigh({ k }, s, cam)).length, 1);
    }
  }
});

test('카메라 사분면 히스테리시스(§72.11)', () => {
  let q = CAM_Q0;
  q = camQuadrant(0.03, 1, q); assert.equal(q, CAM_Q0, '경계 근처는 그대로');
  q = camQuadrant(-0.2, 1, q); assert.deepEqual(q, { x: -1, z: 1 });
  const q2 = camQuadrant(0.05, 1, q); assert.equal(q2, q, '되돌아와도 hyst 안이면 유지');
  assert.deepEqual(camQuadrant(-1, -1, q), { x: -1, z: -1 }, '뒤');
  assert.equal(camQuadrant(0, 0, q), q);
});

test('바닥 스텐실 뒤집기(§72.11): 카메라가 글 위쪽으로 돌면 180°', () => {
  const pl = { rx: 1, rz: 0 }; // +x 로 읽음 → 읽는 자리 +z
  assert.equal(stencilFlip(pl, 0.7, 0.7), false);
  assert.equal(stencilFlip(pl, -0.7, -0.7), true, '뒤에서');
  assert.equal(stencilFlip(pl, 1, 0.05, true), true, '옆(경계)은 그대로');
  assert.equal(stencilFlip(pl, 1, 0.05, false), false);
  assert.equal(stencilFlip({ rx: 0, rz: -1 }, 1, 0), false, '세로 글 = 읽는 자리 +x');
  assert.equal(stencilFlip({ rx: 0, rz: -1 }, -1, 0), true);
});
