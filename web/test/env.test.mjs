// 배경 환경 순수 부분: 공통 바닥 그리드 표현별 값
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUND_TUNE, groundTune, gridFade, gridGain } from '../env/env-core.mjs';

test('바닥 그리드: 세 표현 모두 다크·라이트 값, 아주 흐리게, 높이는 표현 바닥 아래', () => {
  for (const mode of ['flow', 'planet', 'voxel']) {
    for (const L of [false, true]) {
      const g = groundTune(mode, L);
      for (const c of ['minor', 'major', 'axisX', 'axisY']) assert.match(g[c], /^#[0-9a-f]{6}$/i, mode + c);
      assert.ok(g.alpha > 0 && g.alpha <= 0.5, '아주 흐리게: ' + mode);
      assert.ok(g.alpha * (1 + g.gain) <= 1.2, '가까이 보정해도 과하지 않게: ' + mode);
      assert.ok(g.cell > 0 && g.y < 0);
      if (L) assert.equal(g.additive, false, '라이트는 보통 혼합');
    }
  }
  assert.equal(GROUND_TUNE.planet.y, -12, 'Planet 은 예전 GridHelper 높이');
  assert.ok(GROUND_TUNE.voxel.y < -0.32, '복셀 건물 바닥판 아래면(−0.32)보다 아래 → 건물 안은 가려짐');
  assert.deepEqual(groundTune('없음', false), groundTune('flow', false));
  assert.equal(gridFade(0), 70);
  assert.ok(gridFade(400) > gridFade(100));
  assert.equal(gridGain(500), 1);
  assert.ok(gridGain(20) > gridGain(80));
  assert.ok(gridGain(0, 0.6) < gridGain(0, 1.4));
});

test('기상(§43): 모드·자동 규칙·입자 수·세기 따라가기·오류 판정', async () => {
  const { WEATHER_MODES, normWeather, autoWeather, weatherTarget, particleCounts, approach, isErrorEvent } = await import('../env/env-core.mjs');
  assert.deepEqual(WEATHER_MODES, ['auto', 'off', 'fog', 'rain', 'snow']);
  assert.equal(normWeather('RAIN'), 'rain'); assert.equal(normWeather('x'), null);
  const now = 1_000_000_000;
  assert.deepEqual(autoWeather({ nowMs: now, errorTimes: [], lastEventMs: now - 1000 }), { fog: 0.35, rain: 0, snow: 0 }, '평소: 옅은 안개만');
  const e3 = [now - 50_000, now - 20_000, now - 5_000];
  assert.ok(autoWeather({ nowMs: now, errorTimes: e3, lastEventMs: now }).rain >= 0.35, '1분에 오류 3건 → 가는 비');
  assert.equal(autoWeather({ nowMs: now, errorTimes: e3.slice(1), lastEventMs: now }).rain, 0, '2건은 비 없음');
  assert.ok(autoWeather({ nowMs: now, errorTimes: Array.from({ length: 20 }, (_, i) => now - i * 1000), lastEventMs: now }).rain <= 0.6, '과하지 않게');
  assert.equal(autoWeather({ nowMs: now + 40_000, errorTimes: e3, lastEventMs: now }).rain, 0.3, '마지막 오류 뒤 45초 유지');
  assert.equal(autoWeather({ nowMs: now + 60_000, errorTimes: e3, lastEventMs: now }).rain, 0);
  assert.equal(autoWeather({ nowMs: now, lastEventMs: now - 200_000 }).fog, 0.35, '5분 안 유휴는 그대로');
  const f10 = autoWeather({ nowMs: now, lastEventMs: now - 600_000 }).fog, f20 = autoWeather({ nowMs: now, lastEventMs: now - 1_200_000 }).fog;
  assert.ok(f10 > 0.35 && f20 <= 0.8 + 1e-9 && f20 > f10, '오래 쉬면 안개 짙게(상한 0.8)');
  assert.equal(autoWeather({ nowMs: now, errorTimes: e3 }).snow, 0, '눈은 자동으로 안 내림');
  assert.deepEqual(weatherTarget('off'), { fog: 0, rain: 0, snow: 0 });
  assert.equal(weatherTarget('rain').rain, 1); assert.equal(weatherTarget('snow').snow, 1); assert.equal(weatherTarget('fog').rain, 0);
  assert.deepEqual(weatherTarget('auto', { fog: 0.5, rain: 0.2, snow: 0 }), { fog: 0.5, rain: 0.2, snow: 0 });
  const big = particleCounts({ width: 1440 }), small = particleCounts({ width: 390 });
  for (const k of ['rain', 'snow', 'splash']) assert.ok(small[k] < big[k], '좁은 화면은 입자 축소: ' + k);
  assert.equal(approach(0, 1, 0.5, 0.5), 0.25); assert.equal(approach(0.9, 1, 1, 0.5), 1); assert.equal(approach(1, 0, 0.2, 1), 0.8); assert.equal(approach(0.3, 0.3, 0, 1), 0.3);
  assert.ok(isErrorEvent({ type: 'tool-end', ok: false })); assert.ok(isErrorEvent({ type: 'node-update', patch: { status: 'error' } }));
  assert.ok(isErrorEvent({ type: 'result', ok: false })); assert.ok(!isErrorEvent({ type: 'tool-end', ok: true })); assert.ok(!isErrorEvent(null));
});
