// 복셀 과열 — 지친 직원 규칙(순수): 보이는 단계·끄기·자리·결정적 몸짓·자세 덧입힘·식을 때 기지개·입자 상한·장부·걸음 배율
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIRED, shownStage, tiredOff, tiredMode, tiredAct, applyTired, applyRelief, heatParticles, glowLevel, flushOf, TiredBook,
  heatHueOf, bodyTintOf, floorHeatOf, farBoost, FAR_MAX,
} from '../voxel/vx-heat-core.mjs';
import { HOT_H, CRIT_H, heatOfPct } from '../heat-core.mjs';
import { Character } from '../voxel/character-core.mjs';

const node = (pct, status = 'active', kind = 'subagent') => ({ id: 'n', kind, status, meta: pct == null ? {} : { ctx: { used: pct * 2000, limit: 200000, pct } } });
const basePose = () => ({ legL: 0, legR: 0, armL: -0.06, armR: -0.06, rollL: 0, rollR: 0, lean: 0, headP: 0, headY: 0 });
const parts = () => Array.from({ length: TIRED.PART_CAP }, () => ({}));

test('보이는 단계: 보간 heat 기준(30% 막 넘은 직원도 데움)', () => {
  assert.equal(shownStage(0, 0), 0);
  assert.equal(shownStage(0, 1), 1);
  assert.equal(shownStage(0.2, 0), 1);
  assert.equal(shownStage(0.5), 1);
  assert.equal(shownStage(HOT_H), 2);
  assert.equal(shownStage(CRIT_H - 0.01), 2);
  assert.equal(shownStage(CRIT_H), 3);
  assert.equal(shownStage(1), 3);
});

test('끄기: 퇴장 중·사라짐·끝난 직원(팀장 포함)은 지침 없음', () => {
  const ch = new Character('a', node(95));
  assert.equal(tiredOff(ch), false);
  ch.state = 'leave'; assert.equal(tiredOff(ch), true);
  const c2 = new Character('b', node(95, 'done'), { lead: true }); assert.equal(tiredOff(c2), true);
  const c3 = new Character('c', node(95)); c3.vanishT0 = 1; assert.equal(tiredOff(c3), true);
  assert.equal(tiredOff(null), true);
});

test('자리: 걷기·책상 작업·대기·그 밖', () => {
  const ch = new Character('a', node(80));
  ch.state = 'walk'; assert.equal(tiredMode(ch), 'walk');
  ch.state = 'work'; ch.workCat = 'shell'; ch.target = { type: 'desk' }; assert.equal(tiredMode(ch), 'work');
  ch.state = 'seated'; ch.workCat = null; assert.equal(tiredMode(ch), 'idle');
  ch.target = { type: 'break' }; assert.equal(tiredMode(ch), 'other');
});

test('몸짓: 결정적·단계별 후보·평상/걷기면 없음', () => {
  const seen = new Set();
  for (let t = 0; t < 400; t += 0.5) {
    const a = tiredAct(2, 12345, t, 'work'), b = tiredAct(2, 12345, t, 'work');
    assert.deepEqual(a, b);
    if (a.act !== 'none') { seen.add(a.act); assert.ok(a.k >= 0 && a.k < 1); }
    assert.equal(a.burst, -1); // 분출은 위험 단계만
  }
  for (const x of seen) assert.ok(['temple', 'pause', 'wipe', 'neck'].includes(x), x);
  assert.ok(seen.size >= 3, [...seen].join(','));
  for (let t = 0; t < 100; t += 0.7) {
    const a = tiredAct(1, 99, t, 'idle'); if (a.act !== 'none') assert.ok(['rub', 'neck'].includes(a.act));
    assert.equal(tiredAct(0, 99, t, 'idle').act, 'none');
    assert.equal(tiredAct(3, 99, t, 'walk').act, 'none');
  }
  let burst = 0;
  for (let t = 0; t < 600; t += 0.1) if (tiredAct(3, 7, t, 'idle').burst >= 0) burst++;
  assert.ok(burst > 0, '위험 단계는 가끔 김 분출');
});

test('자세: 단계가 오를수록 구부정, 걷기는 덜, 식을 때 기지개는 뒤로 젖힘', () => {
  const lean = [1, 2, 3].map((s) => applyTired(basePose(), { on: true, stage: s, heat: 0.5, act: 'none', k: 0 }, 'idle').lean);
  assert.ok(lean[0] < lean[1] && lean[1] < lean[2]);
  const walk = applyTired(basePose(), { on: true, stage: 3, act: 'none', k: 0 }, 'walk');
  assert.ok(walk.lean > 0 && walk.lean < lean[2]);
  const off = applyTired(basePose(), { on: false, stage: 3, act: 'none' }, 'idle');
  assert.deepEqual(off, basePose());
  const temple = applyTired(basePose(), { on: true, stage: 2, act: 'temple', k: 0.5 }, 'work');
  assert.ok(temple.armR < -2.4, '관자놀이: 오른손이 머리 옆까지');
  const up = applyRelief(basePose(), 0.27);
  assert.ok(up.armL < -2.5 && up.lean < 0, '기지개');
  const sigh = applyRelief(basePose(), 0.78);
  assert.ok(sigh.headP > 0, '한숨: 고개 툭');
});

test('입자: 데움 30%↑ 옅은 김 한 덩이·50%↑ 둘 · 과열은 김 · 위험은 연기·땀·불티 · 상한 · 움직임 줄이기면 정지 김만', () => {
  const P = parts();
  assert.equal(heatParticles({ on: true, stage: 0, heat: 0, act: 'none', burst: -1 }, 1, 3, false, P), 0);
  assert.equal(heatParticles({ on: true, stage: 1, heat: heatOfPct(40), act: 'none', burst: -1 }, 1, 3, true, P), 1, '30%↑ 김 한 덩이(멀리서도 보이게)');
  assert.equal(P[0].type, 'steam');
  assert.equal(heatParticles({ on: true, stage: 1, heat: heatOfPct(55), act: 'none', burst: -1 }, 1, 3, true, P), TIRED.WISP_N, '50%↑ 둘');
  const nw = heatParticles({ on: true, stage: 1, heat: heatOfPct(55), act: 'none', burst: -1 }, 1, 3, false, P);
  assert.ok(nw >= 1 && nw <= TIRED.WISP_N && P.slice(0, nw).every((p) => p.type === 'steam' && p.a <= 0.18), '50%↑ 옅은 김');
  assert.ok(heatParticles({ on: true, stage: 1, heat: heatOfPct(55), act: 'none', burst: -1 }, 1, 3, true, P) >= 1, '움직임 줄이기도 고정 김');
  const n2 = heatParticles({ on: true, stage: 2, heat: 0.5, act: 'none', burst: -1 }, 1, 3, false, P);
  assert.ok(n2 >= 2 && P.slice(0, n2).some((p) => p.type === 'steam'));
  const n3 = heatParticles({ on: true, stage: 3, heat: 0.95, act: 'none', burst: 0.3 }, 1, 3.3, false, P);
  assert.ok(n3 <= TIRED.PART_CAP);
  const types = new Set(P.slice(0, n3).map((p) => p.type));
  assert.ok(types.has('smoke') && types.has('burst'), [...types].join(','));
  const r1 = heatParticles({ on: true, stage: 3, heat: 0.95, act: 'none', burst: -1 }, 1, 3, true, P).valueOf();
  const snap1 = P.slice(0, r1).map((p) => ({ ...p }));
  const r2 = heatParticles({ on: true, stage: 3, heat: 0.95, act: 'none', burst: -1 }, 1, 99, true, P);
  assert.equal(r1, r2); assert.deepEqual(P.slice(0, r2).map((p) => ({ ...p })), snap1, '움직임 줄이기 = 시각과 무관한 정지 표시');
  for (const p of snap1) assert.ok(p.type === 'smoke');
  assert.ok(glowLevel({ on: true, stage: 3, heat: 1 }, 0, true) > glowLevel({ on: true, stage: 2, heat: 0.5 }, 0, true));
  const gw = glowLevel({ on: true, stage: 1, heat: heatOfPct(40) }, 0, false);
  assert.ok(gw > 0.1 && gw < glowLevel({ on: true, stage: 2, heat: HOT_H }, 0, true), '데움 = 옅은 호박 열기(과열보다 약하게)');
  assert.ok(flushOf({ on: true, stage: 1, heat: 0.1 }) > 0 && flushOf({ on: true, stage: 1, heat: 0.1 }) < flushOf({ on: true, stage: 2, heat: 0.6 }));
  assert.ok(flushOf({ on: true, stage: 3, heat: 1 }) > flushOf({ on: true, stage: 2, heat: 0.5 }));
});

test('장부: 단계·걸음 배율 · compact 급락이면 기지개 한 번 + 천천히 식음 · 끝나면 꺼짐', () => {
  const b = new TiredBook();
  const ch = new Character('sub1', node(95));
  ch.state = 'seated'; ch.target = { type: 'desk' };
  let now = 0;
  const r0 = b.step([ch], now, 0.016);
  assert.equal(r0.hot, 1); assert.equal(r0.fx, 1, '위험 = 2D 도 낮은 fps 로 움직임');
  const cw = new Character('warm', node(40)); cw.state = 'seated'; cw.target = { type: 'desk' };
  const rw = new TiredBook().step([cw], 0, 0.016);
  assert.equal(rw.hot, 1); assert.equal(rw.fx, 1, '데움 30%↑ 김·바닥 열기 맥동 = 2D 도 낮은 fps');
  const cr = new Character('warmR', node(40)); cr.state = 'seated'; cr.target = { type: 'desk' };
  assert.equal(new TiredBook().step([cr], 0, 0.016, { reduced: true }).fx, 0, '움직임 줄이기면 2D 정지');
  const cs = new Character('wisp', node(55)); cs.state = 'seated'; cs.target = { type: 'desk' };
  assert.equal(new TiredBook().step([cs], 0, 0.016).fx, 1, '50%↑ 김이 오르면 2D 도 낮은 fps');
  assert.equal(ch._heat.stage, 3); assert.equal(ch.walkK, TIRED.WALK_K[3]); assert.ok(ch._heat.on);
  ch.node = node(12); // compact
  let relief = false, prev = ch._heat.heat;
  for (let i = 0; i < 40; i++) {
    now += 0.1; b.step([ch], now, 0.1);
    if (ch._heat.act === 'relief') relief = true;
    assert.ok(ch._heat.heat <= prev + 1e-9); prev = ch._heat.heat;
  }
  assert.ok(relief, '식을 때 기지개');
  for (let i = 0; i < 20; i++) { now += 0.1; b.step([ch], now, 0.1); }
  assert.equal(ch._heat.on, false); assert.equal(ch.walkK, 1);
  // 다시 오르고 끝나면 꺼짐
  ch.node = node(85); b.step([ch], now += 0.1, 0.1);
  assert.equal(ch._heat.on, true);
  ch.node = node(85, 'done'); b.step([ch], now += 0.1, 0.1);
  assert.equal(ch._heat.on, false);
  // 움직임 줄이기: 몸짓·기지개 없음
  const b2 = new TiredBook(), c2 = new Character('sub2', node(97)); c2.state = 'seated'; c2.target = { type: 'desk' };
  b2.step([c2], 0, 0.016, { reduced: true }); c2.node = node(10);
  for (let i = 0; i < 30; i++) { b2.step([c2], i * 0.1, 0.1, { reduced: true }); assert.equal(c2._heat.act, 'none'); }
  // 값 없음 = 평상
  const c3 = new Character('sub3', node(null)); b.step([c3], 0, 0.016);
  assert.equal(c3._heat.on, false);
  // 사라진 직원 정리
  b.step([], 0, 0.016); assert.equal(b.m.size, 0); assert.equal(b.hb.size, 0);
});

test('걸음 배율: 지친 직원은 같은 시간에 덜 걷는다', () => {
  const mk = (wk) => { const c = new Character('w', node(10)); c.state = 'walk'; c.path = [{ x: 0, z: 0 }, { x: 100, z: 0 }]; c.pi = 1; c.target = { type: 'desk' }; c.walkK = wk; c._move({ now: 0, dt: 0.5, ts: 1 }); return c.pos.x; };
  assert.ok(mk(TIRED.WALK_K[3]) < mk(1));
});

test('멀리서 읽히는 신호: 단계색·옷 물듦·바닥 열기 원·거리 배율 — 30→70% 점점 진하고 70·90% 경계에서 한 단', () => {
  const H = (pct) => { const heat = heatOfPct(pct); return { on: true, heat, stage: shownStage(heat, pct >= 30 ? 1 : 0) }; };
  const off = { on: false, heat: 0.9, stage: 3 };
  assert.equal(heatHueOf(off), 0); assert.equal(bodyTintOf(off), 0); assert.equal(floorHeatOf(off, 0, true).a, 0);
  // 단계색: 호박 → 주황 → 빨강(단조 증가, 0..1)
  let prevHue = -1, prevTint = -1, prevA = -1;
  for (const pct of [30, 40, 50, 60, 69, 70, 80, 89, 90, 95, 100]) {
    const h = H(pct), hue = heatHueOf(h), tn = bodyTintOf(h), f = floorHeatOf(h, 0, true);
    assert.ok(hue >= prevHue && hue >= 0 && hue <= 1, 'hue ' + pct);
    assert.ok(tn >= prevTint && tn > 0 && tn < 0.7, 'tint ' + pct);
    assert.ok(f.a >= prevA && f.a > 0 && f.a <= 1 && f.r > 0, 'floor ' + pct);
    prevHue = hue; prevTint = tn; prevA = f.a;
  }
  assert.ok(bodyTintOf(H(40)) >= 0.2, '데움에서도 옷이 눈에 띄게 물듦');
  assert.ok(floorHeatOf(H(40), 0, true).a >= 0.35, '데움에서도 바닥 원이 보임');
  // 경계에서 한 단 올라감
  assert.ok(bodyTintOf(H(70)) - bodyTintOf(H(69)) > 0.03 && bodyTintOf(H(90)) - bodyTintOf(H(89)) > 0.03);
  assert.ok(floorHeatOf(H(70), 0, true).a - floorHeatOf(H(69), 0, true).a > 0.05);
  assert.equal(floorHeatOf(H(89), 0, true).rings, 1); assert.equal(floorHeatOf(H(90), 0, true).rings, 2, '위험 = 테 두 겹');
  // 맥동: 움직임 줄이기면 시각과 무관, 아니면 시각에 따라 바뀜(세기 범위 안)
  assert.deepEqual(floorHeatOf(H(80), 1, true), floorHeatOf(H(80), 7.3, true));
  const a0 = floorHeatOf(H(80), 0, false).a, a1 = floorHeatOf(H(80), 0.45, false).a;
  assert.notEqual(a0, a1); assert.ok(a1 > 0 && a1 <= 1);
  // 거리 배율: 가까이 1, 멀수록 커지되 상한
  assert.equal(farBoost(10), 1); assert.equal(farBoost(NaN), 1);
  assert.ok(farBoost(100) > 1 && farBoost(100) <= FAR_MAX && farBoost(1e5) === FAR_MAX);
});
