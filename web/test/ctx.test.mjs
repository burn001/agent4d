// 컨텍스트 게이지 순수 규칙: 급락 감지·패널 메모·게이지 대상·문구·기준선·mock 합성. 신호 열화는 폐지 — 과열 단계는 heat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gaugeLevel, isCtxDrop, ctxNote, bandOf, pickGaugeNode, ctxShort, ctxTitle, fmtTokens, heatName, baseOf, grownOf, FALLBACK_BASE,
} from '../ctx-core.mjs';
import { MockCtx, MOCK_LIMIT, SUB_TIERS } from '../ctx-mock.mjs';
import { heatStageOf } from '../heat-core.mjs';

const C = (pct, extra = {}) => ({ used: pct * 2000, limit: 200000, pct, estimated: false, basis: 'family', ...extra });

test('게이지 색: 한도 게이지와 같은 70/90 경계', () => {
  assert.deepEqual([69.9, 70, 89.9, 90].map(gaugeLevel), ['ok', 'warn', 'warn', 'danger']);
});


test('급락 감지: compact 같은 큰 하락만, 작은 흔들림·낮은 구간은 아님', () => {
  assert.equal(isCtxDrop(C(85), C(12)), true);
  assert.equal(isCtxDrop(C(40), C(22)), true);
  assert.equal(isCtxDrop(C(60), C(50)), false);   // 10%p
  assert.equal(isCtxDrop(C(29.9), C(2)), false);  // 이전이 30% 미만
  assert.equal(isCtxDrop(C(50), C(36)), false);   // 15%p 미만
  assert.equal(isCtxDrop(null, C(5)), false);
});

test('패널 메모: 30·70·90 을 넘을 때와 급락만', () => {
  assert.deepEqual([0, 29, 30, 50, 70, 90].map(bandOf), [0, 0, 1, 1, 2, 3]);
  assert.equal(ctxNote(C(40), C(45)), null);
  assert.deepEqual(ctxNote(C(68), C(71)), { kind: 'up', pct: 71, level: 'warn' });
  assert.equal(ctxNote(C(71), C(75)), null);
  assert.deepEqual(ctxNote(C(91), C(10)), { kind: 'drop', from: 91, to: 10 });
  assert.deepEqual(ctxNote(null, C(55)), { kind: 'up', pct: 55, level: 'ok' });
});

test('게이지 대상: 포커스 → 단일 세션 루트 → 고른 세션 → 범위 안 최고', () => {
  const nodes = new Map([
    ['s:a', { id: 's:a', kind: 'main', projectId: 'p1', meta: { ctx: C(30) } }],
    ['s:b', { id: 's:b', kind: 'main', projectId: 'p2', meta: { ctx: C(80) } }],
    ['a:x', { id: 'a:x', kind: 'subagent', parentId: 's:a', projectId: 'p1', meta: { ctx: C(95) } }],
    ['b:y', { id: 'b:y', kind: 'bash-bg', parentId: 's:a', meta: {} }],
  ]);
  const roots = [{ sessionId: 'a' }, { sessionId: 'b' }];
  assert.deepEqual(pickGaugeNode({ nodes, focusId: 'a:x', streamAll: true, roots }), { id: 'a:x', why: 'focus' });
  assert.deepEqual(pickGaugeNode({ nodes, focusId: 'b:y', root: 's:a' }), { id: 's:a', why: 'root' });
  assert.deepEqual(pickGaugeNode({ nodes, streamAll: true, sel: { scope: 'session', sessionId: 'a' }, roots }), { id: 's:a', why: 'session' });
  assert.deepEqual(pickGaugeNode({ nodes, streamAll: true, sel: { scope: 'all' }, roots }), { id: 's:b', why: 'max' });
  assert.deepEqual(pickGaugeNode({ nodes, streamAll: true, sel: { scope: 'project', projectId: 'p1' }, roots }), { id: 's:a', why: 'max' });
  assert.equal(pickGaugeNode({ nodes: new Map(), root: 's:z' }), null);
});

test('§39.9 게이지 대상: /clear 앞 세션(지난 메인)의 큰 값은 최고 후보에서 빠지고 live 루트만', () => {
  // 실측 모양(2026-10-24): 옛 3e2b 40.9%(recent) · 새 b076 11.1%(live, clearedFrom 3e2b) · 다른 프로젝트 9.1%(live)
  const nodes = new Map([
    ['s:old', { id: 's:old', kind: 'main', projectId: 'w', meta: { ctx: C(40.9) } }],
    ['s:new', { id: 's:new', kind: 'main', projectId: 'w', meta: { clearedFrom: 'old', ctx: C(11.1) } }],
    ['s:alr', { id: 's:alr', kind: 'main', projectId: 'q', meta: { ctx: C(9.1) } }],
  ]);
  const roots = [
    { sessionId: 'old', projectId: 'w', live: false, tier: 'recent' },
    { sessionId: 'alr', projectId: 'q', live: true, tier: 'live' },
    { sessionId: 'new', projectId: 'w', live: true, tier: 'live' },
  ];
  assert.deepEqual(pickGaugeNode({ nodes, streamAll: true, sel: { scope: 'project', projectId: 'w' }, roots }), { id: 's:new', why: 'max' });
  assert.deepEqual(pickGaugeNode({ nodes, streamAll: true, sel: { scope: 'all' }, roots }), { id: 's:new', why: 'max' });
  // /clear 직후 새 세션에 아직 응답(값)이 없으면 옛 값을 보이지 않고 비운다(—)
  const fresh = new Map(nodes); fresh.set('s:new', { id: 's:new', kind: 'main', projectId: 'w', meta: { clearedFrom: 'old' } });
  assert.equal(pickGaugeNode({ nodes: fresh, streamAll: true, sel: { scope: 'project', projectId: 'w' }, roots }), null);
  // 새 루트가 아직 허브에 안 붙었어도(옛 루트가 live 로 남은 짧은 틈) clearedFrom 이 없으면 옛 값 — 붙는 순간 바뀐다
  // 고른 세션이 옛 세션이면 사용자가 고른 것이므로 그대로
  assert.deepEqual(pickGaugeNode({ nodes, streamAll: true, sel: { scope: 'session', sessionId: 'old' }, roots }), { id: 's:old', why: 'session' });
  // live 루트가 하나도 없으면(모두 지난 세션) 예전처럼 그중 최고 — 단 /clear 로 이어진 앞 세션은 빼고
  const past = roots.map((r) => ({ ...r, live: false, tier: 'recent' }));
  assert.deepEqual(pickGaugeNode({ nodes, streamAll: true, sel: { scope: 'all' }, roots: past }), { id: 's:new', why: 'max' });
});

test('표시 문구: 토큰 줄임·추정 표시·툴팁', () => {
  assert.equal(fmtTokens(84_321), '84k');
  assert.equal(fmtTokens(1_000_000), '1M');
  assert.equal(fmtTokens(1_250_000), '1.3M');
  assert.equal(ctxShort({ used: 84_000, limit: 200_000, pct: 42, estimated: true }), '42% · 84k/200k?');
  assert.match(ctxTitle(C(92)), /에이전트 과열: 위험/);
  assert.match(ctxTitle(C(72)), /에이전트 과열: 과열/);
  assert.match(ctxTitle(C(10)), /에이전트 과열: 평상/);
  assert.doesNotMatch(ctxTitle(C(92)), /열화|정리 권장/);
  assert.match(ctxTitle({ ...C(20), basis: 'default', estimated: true }), /추정/);
});

test('mock 합성: 결정적, 메인은 오르다 97% 넘으면 12% 로(급락), 재생 배열은 seq 재부여', () => {
  const nodes = new Map();
  const mc = new MockCtx();
  const add = { type: 'node-add', nodeId: 's:m', ts: 't', node: { id: 's:m', kind: 'main', parentId: null } };
  nodes.set('s:m', add.node);
  const first = mc.after(add, (id) => nodes.get(id));
  assert.equal(first[0].patch.meta.ctx.pct, 6);
  let last = 6, drops = 0;
  for (let i = 0; i < 200; i++) {
    const [u] = mc.after({ type: 'text', nodeId: 's:m', ts: 't' }, (id) => nodes.get(id));
    const p = u.patch.meta.ctx.pct;
    if (isCtxDrop({ pct: last }, { pct: p })) drops++;
    last = p;
  }
  assert.ok(drops >= 1);
  assert.equal(mc.after({ type: 'output', nodeId: 's:m' }, (id) => nodes.get(id)).length, 0);
  const evs = new MockCtx().inject([{ seq: 1, ts: 'a', ...add }, { seq: 2, ts: 'b', type: 'tool-start', nodeId: 's:m' }]);
  assert.deepEqual(evs.map((e) => e.seq), [1, 2, 3, 4]);
  assert.equal(evs[3].patch.meta.ctx.used, Math.round(MOCK_LIMIT * 0.07));
  // 전체 보기: 메인마다 다른 시작 수준
  const ov = new MockCtx({ roots: true });
  const snap = ov.seed({ nodes: ['s:1', 's:2', 's:3', 's:4', 's:5', 's:6'].map((id) => ({ id, kind: 'main', meta: {} })) });
  assert.ok(new Set(snap.nodes.map((n) => n.meta.ctx.pct)).size >= 2);
});

test('영어 화면(§86): 툴팁·과열 단계 이름·창 근거·천 단위(Intl)', async () => {
  const { _setLangForTest } = await import('../i18n.mjs');
  _setLangForTest('en');
  try {
    const t = ctxTitle({ used: 184_000, limit: 200_000, pct: 92, basis: 'default', estimated: true });
    assert.match(t, /^Context 92% used \(184,000 \/ 200,000 tokens\)\nWindow size: no evidence → default 200k \(estimated\)\nAgent heat: Critical\n/);
    assert.equal(heatName(1), 'Warming');
    assert.equal(ctxTitle(null), 'No context data');
  } finally { _setLangForTest('ko'); }
  assert.equal(heatName(heatStageOf(75)), '과열');
});

test('기준선(카드·툴팁 표시): 서버 base → 본 최솟값 → min(지금, 60k)', () => {
  assert.equal(baseOf({ used: 150_000, base: 63_000 }), 63_000);
  assert.equal(baseOf({ used: 150_000 }, 70_000), 70_000);
  assert.equal(baseOf({ used: 150_000 }), FALLBACK_BASE);
  assert.equal(baseOf({ used: 20_000 }), 20_000);
  assert.equal(grownOf({ used: 150_000, base: 63_000 }), 87_000);
  assert.equal(grownOf(null), 0);
});

test('§127 mock: 하위 에이전트는 나타난 순서대로 오름·60·80·95% 갈래, ?ctx= 고정이면 메인은 그대로', () => {
  assert.deepEqual(SUB_TIERS, [null, 0.6, 0.8, 0.95]);
  const nodes = new Map();
  const mc = new MockCtx({ mainStart: 0.85, mainStep: 0 });
  const get = (id) => nodes.get(id);
  const addEv = (m, id, kind, parentId) => { const node = { id, kind, parentId }; nodes.set(id, node); return m.after({ type: 'node-add', nodeId: id, ts: 't', node }, get)[0].patch.meta.ctx.pct; };
  assert.equal(addEv(mc, 's:m', 'main', null), 85);
  const subs = ['a:1', 'a:2', 'a:3', 'a:4', 'a:5', 'a:6'].map((id) => addEv(mc, id, 'subagent', 's:m'));
  assert.ok(subs[0] < 20 && subs[4] < 20);
  assert.deepEqual([subs[1], subs[2], subs[3], subs[5]], [60, 80, 95, 60]);
  assert.deepEqual(subs.map(heatStageOf), [0, 1, 2, 3, 0, 1]);
  // 메인은 ?ctx= 고정 — 응답이 와도 갱신 없음, 60·80% 갈래도 머묾, 95% 갈래는 기어 올라 99% 넘으면 compact(식음)
  for (const id of ['s:m', 'a:2', 'a:3']) assert.equal(mc.after({ type: 'text', nodeId: id }, get).length, 0);
  let p = 95, dropped = false;
  for (let i = 0; i < 40 && !dropped; i++) { const n = mc.after({ type: 'text', nodeId: 'a:4' }, get)[0].patch.meta.ctx.pct; if (n < p) dropped = true; p = n; }
  assert.ok(dropped && p === 12);
  // 결정적: 같은 순서면 같은 값
  const mc2 = new MockCtx({ mainStart: 0.85, mainStep: 0 });
  const again = ['a:1', 'a:2', 'a:3', 'a:4'].map((id) => addEv(mc2, id, 'subagent', 's:m'));
  assert.deepEqual(again, subs.slice(0, 4));
});
