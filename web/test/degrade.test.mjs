// 신호 열화 2차: 기준(절대량·창 대비)·단계·D·버스트 판정·글자 깨짐·패킷 소실·잔상 오프셋·DEG
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  absLevel, levelOf, baseOf, grownOf, recommendLevel, FALLBACK_BASE, grainAmp, stageOfCtx, stageTable, degD, degScaled, stageCross, burstWanted, burstEnv, BurstBook, BURST_MS, BURST_GAP_MS,
  textGlitchPlan, glitchStr, glitchAt, GLYPHS, packetGone, lineGap, lineFlicker, ghostOffsets, DEG, degOf, degOfLink, normBasis, hash2, seedOf,
} from '../degrade-core.mjs';
import { stageOf, isCtxDrop } from '../ctx-core.mjs';

const C = (used, limit = 1e6, base) => ({ used, limit, pct: Math.round((used / limit) * 1000) / 10, ...(base != null ? { base } : {}) });

test('절대량 기준 = 늘어난 양(used − 기준선): +50k 시작 · +100k 주사선 · +150k 뚜렷 · +300k 심함 · +500k 최대', () => {
  assert.equal(absLevel(0), 0);
  assert.equal(absLevel(50e3), 20);
  assert.equal(absLevel(100e3), 40);
  assert.equal(absLevel(150e3), 58);
  assert.equal(absLevel(300e3), 75);
  assert.equal(absLevel(500e3), 95);
  assert.equal(absLevel(2e6), 100);
  const B = 100e3; // 시작부터 100k 쓰는 세션
  assert.deepEqual([100e3, 149e3, 150e3, 199e3, 200e3, 249e3, 250e3, 399e3, 400e3, 650e3].map((u) => stageOfCtx(C(u, 1e6, B), 'abs')), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(recommendLevel('abs'), 95);
  assert.equal(recommendLevel('pct'), 75);
  assert.ok(levelOf(C(B + 500e3, 1e6, B), 'abs') >= recommendLevel('abs'));
});

test('기준선: 서버 base → 화면에서 본 최솟값 → min(지금, 60k)', () => {
  assert.equal(baseOf(C(300e3, 1e6, 110e3)), 110e3);
  assert.equal(baseOf(C(300e3), 95e3), 95e3);
  assert.equal(baseOf(C(300e3)), FALLBACK_BASE);
  assert.equal(baseOf(C(40e3)), 40e3);           // 지금이 상한보다 작으면 지금
  assert.equal(baseOf(C(30e3, 1e6, 110e3)), 30e3); // compact 로 기준선보다 작아지면 그 값
  assert.equal(grownOf(C(260e3, 1e6, 110e3)), 150e3);
  assert.equal(levelOf(C(260e3, 1e6, 110e3), 'abs'), 58);
});

test('창 대비 기준은 예전 % 그대로, 알 수 없는 값은 절대량', () => {
  // opus 1M 창 200k(첫 응답 60k) = 20% → 창 대비면 그레인 시작, 절대량(+140k)이면 주사선 끝 무렵
  assert.equal(levelOf(C(200e3, 1e6, 60e3), 'pct'), 20);
  assert.equal(stageOf(levelOf(C(200e3, 1e6, 60e3), 'abs')), 2);
  assert.equal(normBasis('x'), 'abs');
  assert.equal(normBasis('pct'), 'pct');
  assert.equal(levelOf(null), 0);
  assert.deepEqual(stageTable('abs').map((s) => s.at), ['+0', '+50k', '+100k', '+150k', '+300k']);
  assert.deepEqual(stageTable('pct').map((s) => s.at), ['0%', '20%', '40%', '58%', '75%']);
});

test('세션 세기 D: 문턱 20 에서 0, 95 에서 1, 세기 슬라이더 배율', () => {
  assert.equal(degD(19), 0);
  assert.equal(degD(95), 1);
  assert.ok(Math.abs(degD(57.5) - 0.5) < 1e-9);
  assert.equal(degScaled(57.5, 0), 0);
  assert.equal(degScaled(57.5, 1), 1);
  assert.ok(Math.abs(degScaled(57.5, 0.5) - 0.5) < 1e-9);
});

test('정화(급락) 판정도 같은 기준: 1M 창 180k→40k(기준선 30k) 는 창 대비면 아님, 절대량이면 급락', () => {
  const a = C(180e3, 1e6, 30e3), b = C(40e3, 1e6, 30e3);
  assert.equal(isCtxDrop({ pct: levelOf(a, 'pct') }, { pct: levelOf(b, 'pct') }), false);
  assert.equal(isCtxDrop({ pct: levelOf(a, 'abs') }, { pct: levelOf(b, 'abs') }), true);
});

test('단계 넘김·버스트 판정: 오를 때만, 처음 값·quiet·움직임 줄이기·꺼짐은 생략', () => {
  assert.deepEqual(stageCross(19, 21), { dir: 'up', from: 0, to: 1 });
  assert.deepEqual(stageCross(60, 30), { dir: 'down', from: 3, to: 1 });
  assert.equal(stageCross(41, 50).dir, null);
  assert.equal(stageCross(null, 80).dir, null);
  const up = stageCross(57, 59);
  assert.equal(burstWanted(up), true);
  assert.equal(burstWanted(up, { quiet: true }), false);
  assert.equal(burstWanted(up, { reduced: true }), false);
  assert.equal(burstWanted(up, { enabled: false }), false);
  assert.equal(burstWanted(up, { strength: 0 }), false);
  assert.equal(burstWanted(stageCross(60, 30)), false);
});

test('버스트 곡선·장부: 0.5초, 같은 세션은 2.5초에 한 번', () => {
  assert.equal(burstEnv(1000, 1000), 1);
  assert.equal(burstEnv(1000, 1000 + BURST_MS), 0);
  assert.ok(burstEnv(1000, 1000 + BURST_MS * 0.6) < 1 && burstEnv(1000, 1000 + BURST_MS * 0.6) > 0);
  const b = new BurstBook();
  assert.equal(b.start('s:a', 0), true);
  assert.equal(b.start('s:a', 100), false);
  assert.equal(b.start('s:b', 100), true);
  assert.equal(b.get('s:a', 10), 1);
  assert.equal(b.any(10), true);
  assert.equal(b.any(BURST_MS + 200), false);
  assert.equal(b.start('s:a', BURST_GAP_MS + 1), true);
});

test('글자 깨짐: 원문 보존·공백 유지·적어도 한 글자·결정적, D 클수록 잦고 길다', () => {
  const s = '읽기 · web/app.js';
  const g = glitchStr(s, 0.3, 42);
  assert.notEqual(g, s);
  assert.equal(Array.from(g).length, Array.from(s).length);
  assert.equal(g[2], ' ');
  assert.equal(glitchStr(s, 0.3, 42), g);
  assert.ok(Array.from(glitchStr('ab', 0.0001, 1)).some((c) => GLYPHS.includes(c)));
  const p1 = textGlitchPlan(0.2), p2 = textGlitchPlan(0.9);
  assert.ok(p2.rate > p1.rate && p2.ms > p1.ms && p2.frac > p1.frac);
  assert.equal(textGlitchPlan(0).rate, 0);
  // glitchAt: D 0 이면 원문 그대로(같은 참조), 10초 동안 깨진 시간 비율이 D 와 함께 늘어남
  assert.equal(glitchAt(s, 0, 3, 1), s);
  const frac = (D) => { let n = 0; for (let i = 0; i < 2000; i++) if (glitchAt(s, D, i * 0.01, 9) !== s) n++; return n / 2000; };
  assert.ok(frac(0.9) > frac(0.25));
  assert.ok(frac(0.25) > 0);
});

test('패킷 중간 소실·선 끊김: D 0 이면 없음, 양 끝은 늘 보임, D 클수록 많이', () => {
  let a = 0, b = 0;
  for (let s = 0; s < 400; s++) for (let u = 0.15; u < 0.85; u += 0.1) { if (packetGone(s, u, 0.2)) a++; if (packetGone(s, u, 0.9)) b++; }
  assert.ok(b > a && a > 0);
  assert.equal(packetGone(5, 0.05, 1), false);
  assert.equal(packetGone(5, 0.5, 0), false);
  assert.equal(lineGap(1, 2, 3, 0), false);
  assert.equal(lineFlicker(1, 2, 0), 1);
  assert.ok(lineFlicker(1, 2.5, 1) >= 0.25);
});

test('잔상 오프셋: D 0 이면 0, 움직임 줄이기는 고정 이중 윤곽, 잔상은 0.2초 늦은 흔들림', () => {
  const o = {};
  ghostOffsets(0, 5, 1, false, o);
  assert.deepEqual([o.ax, o.ay, o.bx, o.by], [0, 0, 0, 0]);
  ghostOffsets(0.8, 5, 1, true, o);
  assert.equal(o.ax, 0); assert.ok(o.bx > 0);
  const o2 = {}, o3 = {};
  ghostOffsets(0.8, 5, 1, true, o2); ghostOffsets(0.8, 9, 1, true, o3);
  assert.equal(o2.bx, o3.bx); // 정적
  let st = 0;
  for (let i = 0; i < 500; i++) { ghostOffsets(0.9, i * 0.11, 3, false, o); if (o.stutter) st++; }
  assert.ok(st > 20 && st < 200);
});

test('DEG: 꺼져 있으면 0, 버스트는 세션 키로 더해짐', () => {
  DEG.on = false; DEG.base.set('a', 0.4); DEG.sessOf.set('a', 's:x');
  assert.equal(degOf('a'), 0);
  DEG.on = true;
  assert.equal(degOf('a'), 0.4);
  DEG.burst.set('s:x', 1);
  assert.equal(degOf('a'), 1);
  assert.equal(degOfLink('a', 'b'), 1);
  DEG.burst.clear(); DEG.base.clear(); DEG.sessOf.clear(); DEG.on = false;
  assert.ok(hash2(1, 2) >= 0 && hash2(1, 2) < 1);
  assert.equal(seedOf('abc'), seedOf('abc'));
});

test('그레인 진폭(§76.8): 시작 ±10/255 · +150k ±20 · 최대 ±30, 문턱 아래 0', () => {
  assert.equal(grainAmp(0.1), 0);
  assert.ok(Math.abs(grainAmp(0.22) - 10.1) < 0.6);
  assert.ok(Math.abs(grainAmp(0.58) - 20) < 0.01);
  assert.ok(Math.abs(grainAmp(0.95) - 30) < 0.01);
  assert.ok(grainAmp(absLevel(150e3) / 100) >= 19.9);
});
