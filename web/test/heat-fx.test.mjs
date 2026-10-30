// 흐름 과열 연출 순수 값: 모습 단계·연출 양(LOD·움직임 줄이기)·색 표·맥동·입자 자리(결정적)·대상 판정
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HFX, heatLookStage, heatLook, heatColor, smokeColor, heatPulse, puffAt, hazeAt, emberAt, rippleAt, heatEligible, rgbCss, hash01 } from '../flowview/heat-fx-core.mjs';
import { heatOfPct, HOT_H, CRIT_H } from '../heat-core.mjs';

test('모습 단계: heat-core 단계 경계(70%·90%)와 같은 자리', () => {
  assert.deepEqual([0, 0.001, 0.1, HOT_H - 0.01, HOT_H, CRIT_H - 0.01, CRIT_H, 1].map(heatLookStage), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.equal(heatLookStage(heatOfPct(40)), 1);
  assert.equal(heatLookStage(heatOfPct(70)), 2);
  assert.equal(heatLookStage(heatOfPct(90)), 3);
  assert.equal(heatLookStage(heatOfPct(60)), 1);
});

test('연출 양: 평상 0 · 데움 뚜렷한 글로우(50%↑ 옅은 연기 한두 가닥·아지랑이) · 과열 연기·불티 · 위험 더 많이 + 파문', () => {
  const z = heatLook(0);
  assert.deepEqual([z.stage, z.glow, z.puffs, z.embers, z.haze, z.ripple], [0, 0, 0, 0, 0, false]);
  const w4 = heatLook(heatOfPct(40));
  assert.equal(w4.stage, 1); assert.ok(w4.glow >= 0.35 && w4.tint >= 0.28, '40% 면 한눈에(예전 0.13·0.10 의 2～3배)');
  assert.equal(w4.haze + w4.puffs, 0, '50% 전엔 연기 없음'); assert.ok(heatLook(heatOfPct(30.5)).glow >= 0.2, '30% 부터 보임');
  const w = heatLook(heatOfPct(55));
  assert.equal(w.stage, 1); assert.ok(w.glow > w4.glow && w.tint > w4.tint); assert.ok(w.haze > 0 && w.wisp > 0); assert.ok(w.puffs >= 1 && w.puffs <= 2, '옅은 연기 한두 가닥'); assert.equal(w.embers, 0); assert.equal(w.ripple, false);
  assert.equal(heatLook(heatOfPct(65)).puffs, 2);
  assert.ok(heatLook(HOT_H).glow > heatLook(HOT_H - 0.01).glow - 0.02 && heatLook(HOT_H).puffs > 2, '과열로 끊김 없이 이어짐');
  const h = heatLook(0.6);
  assert.equal(h.stage, 2); assert.ok(h.puffs >= 4 && h.puffs <= 9); assert.equal(h.embers, 2); assert.equal(h.ripple, false);
  const c = heatLook(1);
  assert.equal(c.stage, 3); assert.equal(c.puffs, HFX.PUFF_MAX); assert.equal(c.embers, HFX.EMBER_MAX); assert.equal(c.ripple, true);
  assert.ok(c.glow > h.glow && h.glow > w.glow);
});

test('거리 LOD·움직임 줄이기: 입자 없이 정지 글로우만', () => {
  const far = heatLook(1, HFX.LOD_MIN_PX - 1);
  assert.equal(far.puffs + far.embers + far.haze, 0); assert.equal(far.ripple, false); assert.ok(far.glow > 0);
  const mid = heatLook(1, (HFX.LOD_MIN_PX + HFX.LOD_FULL_PX) / 2);
  assert.ok(mid.puffs > 0 && mid.puffs < HFX.PUFF_MAX);
  const red = heatLook(1, 999, true);
  assert.equal(red.puffs + red.embers + red.haze, 0); assert.equal(red.ripple, false); assert.ok(red.glow > 0);
  assert.equal(heatPulse(1, 0.37, 0.2, true), 1);
  assert.equal(heatPulse(0.2, 0.37, 0.2), 1); // 데움은 맥동 없음
  const ps = Array.from({ length: 40 }, (_, i) => heatPulse(0.9, i * 0.05, 0));
  assert.ok(Math.min(...ps) < 0.7 && Math.max(...ps) > 0.99);
  const est = heatLook(0.85, 999, false, true); // 창 추정이면 조금 약하게
  assert.ok(est.glow < heatLook(0.85).glow);
});

test('색 표: 호박 → 빨강, 라이트는 진한 잉크 · 연기는 회색', () => {
  const a = heatColor(0, false), r = heatColor(1, false);
  assert.ok(a[1] > r[1] + 0.4, '뜨거울수록 초록 성분이 빠짐(빨강)');
  const l = heatColor(0.5, true), d = heatColor(0.5, false);
  assert.ok(l[0] + l[1] + l[2] < d[0] + d[1] + d[2], '라이트는 더 진함');
  assert.match(rgbCss(heatColor(1, false)), /^rgb\(\d+,\d+,\d+\)$/);
  const s = smokeColor(0.9, true);
  assert.ok(Math.abs(s[0] - s[1]) < 0.05 && s[0] < 0.6);
  assert.ok(smokeColor(1, false)[0] < smokeColor(0.4, false)[0], '위험일수록 짙음');
});

test('입자: 같은 입력이면 같은 자리(재생·보관함), 오르며 커지고 생 끝에 사라짐', () => {
  const a = puffAt(3, 10, 12.5, 0.7, 0.9), b = puffAt(3, 10, 12.5, 0.7, 0.9);
  assert.deepEqual(a, b);
  for (let i = 0; i < 10; i++) {
    const p = puffAt(i, 10, 4.2, 1.3, 0.6);
    assert.ok(p.u >= 0 && p.u < 1 && p.y >= 0 && p.y <= HFX.RISE * 1.35 + 1e-9 && p.alpha >= 0 && p.alpha <= 1);
  }
  // 한 생 안에서 나이가 들면 위로·크게
  const life = HFX.PUFF_LIFE;
  const p0 = puffAt(0, 1, life * 0.1, 0, 0.5), p1 = puffAt(0, 1, life * 0.6, 0, 0.5);
  assert.ok(p1.y > p0.y && p1.size > p0.size);
  const z = hazeAt(0, 1, 0.3); assert.ok(z.alpha >= 0 && z.alpha <= 0.5);
  // 불티: 결정적이고, 과열보다 위험이 더 자주 튐
  const cnt = (h) => { let n = 0; for (let k = 0; k < 400; k++) if (emberAt(k % 4, k * HFX.EMBER_LIFE, 0.5, h).on) n++; return n; };
  assert.ok(cnt(0.9) > cnt(0.5));
  assert.deepEqual(emberAt(1, 3.3, 0.2, 0.9), emberAt(1, 3.3, 0.2, 0.9));
  const u = rippleAt(5, 0.1); assert.ok(u >= 0 && u < 1);
  assert.ok(hash01(1) >= 0 && hash01(1) < 1);
});

test('대상 판정: 끝남·중지·오류·퇴장·숨김은 연출 꺼짐', () => {
  const mk = (status, x = {}) => ({ node: { status }, ...x });
  assert.equal(heatEligible(mk('active')), true);
  assert.equal(heatEligible(mk('idle')), true);
  for (const st of ['done', 'stopped', 'error']) assert.equal(heatEligible(mk(st)), false);
  assert.equal(heatEligible(mk('active', { exiting: 1 })), false);
  assert.equal(heatEligible(mk('active', { gone: true })), false);
  assert.equal(heatEligible(mk('active', { hidden: true })), false);
  assert.equal(heatEligible(null), false);
});
