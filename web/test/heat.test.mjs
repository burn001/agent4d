// 에이전트 과열 공용 코어: 단계 경계·heat 연속값·없는 값·노드 읽기·식힘 보간·장부
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEAT, HOT_H, CRIT_H, HEAT_STAGES, NO_HEAT, ctxPctOf, heatStageOf, heatOfPct, heatOf, nodeHeat, approachHeat, HeatBook } from '../heat-core.mjs';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} ≈ ${b}`);

test('단계: 30 데움 · 70 과열 · 90 위험, 그 아래는 평상', () => {
  assert.deepEqual([0, 29.9, 30, 50, 69.9, 70, 89.9, 90, 100].map(heatStageOf), [0, 0, 1, 1, 1, 2, 2, 3, 3]);
  assert.equal(heatStageOf(NaN), 0);
  assert.equal(heatStageOf(null), 0);
  assert.deepEqual(HEAT_STAGES.map((s) => [s.stage, s.key, s.min]), [[0, 'cool', 0], [1, 'warm', 30], [2, 'hot', 70], [3, 'crit', 90]]);
});

test('heat 축 경계 HOT_H·CRIT_H = 70%·90% 의 heat', () => {
  near(HOT_H, 4 / 7); near(CRIT_H, 6 / 7);
  near(heatOfPct(HEAT.HOT_PCT), HOT_H); near(heatOfPct(HEAT.CRIT_PCT), CRIT_H);
});

test('heat: 30% 이하 0, 100% 1, 사이는 선형 · 범위 밖은 자름', () => {
  assert.equal(heatOfPct(0), 0);
  assert.equal(heatOfPct(30), 0);
  near(heatOfPct(65), 0.5);
  near(heatOfPct(90), 6 / 7);
  assert.equal(heatOfPct(100), 1);
  assert.equal(heatOfPct(140), 1);
  assert.equal(heatOfPct(undefined), 0);
});

test('heatOf(meta.ctx): 값·단계·추정 여부, 값 없으면 NO_HEAT(같은 객체)', () => {
  assert.deepEqual(heatOf({ used: 130_000, limit: 200_000, pct: 65, estimated: true }), { heat: 0.5, stage: 1, pct: 65, estimated: true, known: true });
  assert.equal(heatOf(null), NO_HEAT);
  assert.equal(heatOf({ used: 5 }), NO_HEAT);
  assert.equal(NO_HEAT.heat, 0);
  assert.equal(ctxPctOf({ pct: 120 }), 100);
  assert.equal(ctxPctOf({ pct: 'x' }), 0);
  // 노드 모양(store.nodes 값·view.vis 의 v.node) — main·subagent·claude-p 모두 같은 길
  for (const kind of ['main', 'subagent', 'claude-p', 'workflow-agent']) assert.equal(nodeHeat({ kind, meta: { ctx: { pct: 95 } } }).stage, 3);
  assert.equal(nodeHeat({ kind: 'bash-bg', meta: {} }), NO_HEAT);
  assert.equal(nodeHeat(null), NO_HEAT);
});

test('approachHeat: 오를 땐 빠르게, 내릴 땐 COOL_S 초에 걸쳐 선형으로 식음', () => {
  // 오름: 1초면 거의 다
  assert.ok(approachHeat(0, 1, 1) > 0.9);
  assert.ok(approachHeat(0, 1, 0.1) > 0.2 && approachHeat(0, 1, 0.1) < 0.4);
  // 내림: 1 → 0 에 COOL_S(4초)
  let h = 1, t = 0;
  while (h > 0 && t < 10) { h = approachHeat(h, 0, 0.1); t += 0.1; }
  assert.ok(t >= HEAT.COOL_S - 0.15 && t <= HEAT.COOL_S + 0.15, `식는 데 ${t}초`);
  assert.ok(HEAT.COOL_S >= 3 && HEAT.COOL_S <= 5);
  // 목표 밑으로 넘어가지 않음 · 처음 값·snap 은 바로 목표
  assert.equal(approachHeat(0.5, 0.45, 10), 0.45);
  assert.equal(approachHeat(null, 0.7, 0.016), 0.7);
  assert.equal(approachHeat(0.1, 0.9, 0.016, { snap: true }), 0.9);
  assert.equal(approachHeat(0.3, 0.3, 1), 0.3);
});

test('HeatBook: 노드별 보간 · compact 급락은 식으며 · 단계는 바로 · 정리·비우기', () => {
  const hb = new HeatBook();
  const node = { kind: 'subagent', meta: { ctx: { pct: 100 } } };
  assert.equal(hb.step('a', node, 0.016), 1); // 처음 본 노드는 바로 그 값
  assert.equal(hb.stage('a'), 3);
  node.meta.ctx = { pct: 12 }; // compact
  const h1 = hb.step('a', node, 1);
  near(h1, 1 - 1 / HEAT.COOL_S);
  assert.equal(hb.stage('a'), 0, '단계(목표)는 바로 내려감 — 보간은 heat 만');
  hb.step('b', { meta: { ctx: { pct: 65 } } }, 0.016);
  assert.equal(hb.size, 2);
  hb.prune(new Set(['b']));
  assert.equal(hb.size, 1);
  assert.equal(hb.get('a'), 0);
  hb.clear();
  assert.equal(hb.step('b', { meta: { ctx: { pct: 65 } } }, 0.016), 0.5, 'clear 뒤(재생 seek) 다음 값은 바로 목표');
});

test('순수: DOM·three·시계·난수 없음(재생·보관함에서 같은 시점이면 같은 값)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../heat-core.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m);
  assert.doesNotMatch(src, /Math\.random|Date\.now|performance\.now|document\.|window\./);
});
