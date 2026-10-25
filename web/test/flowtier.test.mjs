// 흐름 3D 높이 계층 — 순수 배치 함수
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIER, tierGap, tierY, tierDepths, tierDim, tierSpan } from '../flowview/tier-core.mjs';
import { ART } from '../artifact-core.mjs';
import { beamY, beamPoint, beamControls } from '../flowview/flow-style.mjs';

test('바닥 = 작업 대상 층 높이, 층은 바닥 위(메인이 가장 높고 깊이마다 아래, 가장 낮은 층도 CLEAR 만큼 뜸)', () => {
  assert.equal(TIER.FLOOR, ART.FLOOR_Y);
  for (const R of [0, 10, 30, 80, 400]) {
    const g = tierGap(R);
    const ys = [0, 1, 2, 3, 4, 8, 40].map((d) => tierY(d, g));
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] <= ys[i - 1] + 1e-9, `깊이 ${i} 가 위층보다 높음`);
    assert.ok(ys[0] - ys[1] > ys[1] - ys[2], '깊을수록 간격이 줄어듦');
    assert.ok(Math.abs(ys[3] - (TIER.FLOOR + TIER.CLEAR)) < 1e-9, '깊이 3 이 가장 낮은 층');
    assert.equal(ys[6], ys[3], '더 깊어도 바닥 + CLEAR 아래로는 안 감');
    assert.ok(Math.abs(tierSpan(g) - (ys[0] - TIER.FLOOR)) < 1e-9);
  }
});

test('층 간격: 섬 반경 비례, 칩 반지름 배수로 묶음, 0.5 단위(작은 변화엔 그대로)', () => {
  const lo = TIER.NODE_MIN * TIER.CHIP_R, hi = TIER.NODE_MAX * TIER.CHIP_R;
  assert.ok(tierGap(0) >= lo - 0.25 && tierGap(1e4) <= hi + 0.25);
  assert.ok(tierGap(35) > tierGap(5) || tierGap(5) === tierGap(35));
  assert.equal(tierGap(33), tierGap(33.4));
  for (const R of [3, 17, 31, 52]) assert.equal(tierGap(R) % TIER.STEP, 0);
  assert.equal(tierGap(NaN), tierGap(0));
});

test('트리 깊이: 부모 따라, 분리 기동기는 띄운 노드 아래, 고리·모르는 부모는 끊음', () => {
  const par = { m: null, a: 'm', b: 'a', c: 'b', w: 'm', wa: 'w', bg: 'a', L: null, r: 'L', x: 'y', y: 'x', m2: null };
  const host = { L: 'm' };
  const d = tierDepths(Object.keys(par), (id) => par[id] ?? null, (id) => host[id] || null);
  assert.equal(d.get('m'), 0); assert.equal(d.get('m2'), 0, '전체 보기 다른 메인도 꼭대기');
  assert.equal(d.get('a'), 1); assert.equal(d.get('b'), 2); assert.equal(d.get('c'), 3);
  assert.equal(d.get('wa'), 2); assert.equal(d.get('bg'), 2, '백그라운드 명령도 부모 아래 한 층');
  assert.equal(d.get('L'), 1, '분리 기동기 = 띄운 메인 아래'); assert.equal(d.get('r'), 2, '러너·회차는 그 아래');
  assert.ok(d.has('x') && d.has('y'), '고리도 멈춤');
  assert.equal(tierDim(0), 0); assert.ok(tierDim(2) > tierDim(1)); assert.ok(tierDim(9) <= 0.42);
});

test('떨어지는 빔(beamY): 양 끝 일치, 같은 수평 곡선, 끝으로 갈수록 내리꽂힘 · beamPoint drop 은 3D 에서만', () => {
  const a = { x: 0, y: 10, z: 0 }, b = { x: 20, y: 0, z: 0 }, o = {};
  assert.equal(beamY(0, 10, 0, 20), 10); assert.ok(Math.abs(beamY(1, 10, 0, 20)) < 1e-9);
  assert.ok(beamY(0.1, 10, 0, 20) > 10, '부모에서 살짝 떠오름');
  const slopeEnd = beamY(1, 10, 0, 20) - beamY(0.95, 10, 0, 20), slopeMid = beamY(0.55, 10, 0, 20) - beamY(0.5, 10, 0, 20);
  assert.ok(slopeEnd < slopeMid, '끝에서 더 가파르게');
  beamPoint(o, a, b, 0.5, 0, true); const c = beamControls(a, b);
  assert.ok(Math.abs(o.y - beamY(0.5, 10, 0, c.dist)) < 1e-9);
  beamPoint(o, a, b, 0.5); assert.equal(o.y, 5, '기본(2D·예전)은 직선 보간 그대로');
});
