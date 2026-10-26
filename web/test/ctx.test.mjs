// 컨텍스트 게이지·신호 열화 순수 규칙: 단계 매핑·세기·급락 감지·게이지 대상·국소 대상·mock 합성
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stageOf, gaugeLevel, noiseParams, noiseNeeded, isCtxDrop, ctxNote, bandOf, pickGaugeNode, rankRegions,
  purgeProgress, PURGE_MS, ctxShort, ctxTitle, fmtTokens, STAGES,
} from '../ctx-core.mjs';
import { MockCtx, MOCK_LIMIT } from '../ctx-mock.mjs';

const C = (pct, extra = {}) => ({ used: pct * 2000, limit: 200000, pct, estimated: false, basis: 'family', ...extra });

test('단계 매핑: ～30 선명 → 그레인 → 50 주사선 → 70 색수차 → 90%↑ 데이터모시', () => {
  assert.deepEqual([0, 14.9, 29.9, 30, 49.9, 50, 69.9, 70, 89.9, 90, 100].map(stageOf), [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(stageOf(null), 0);
  assert.equal(STAGES[4].key, 'mosh');
});

test('게이지 색: 한도 게이지와 같은 70/90 경계', () => {
  assert.deepEqual([69.9, 70, 89.9, 90].map(gaugeLevel), ['ok', 'warn', 'warn', 'danger']);
});

test('효과 세기: 단계별로 켜지고 세기 배율·로우패스·험', () => {
  const a = noiseParams(28), b = noiseParams(40), c = noiseParams(60), d = noiseParams(80), e = noiseParams(98);
  assert.equal(a.grain + a.scan + a.chroma + a.mosh, 0);
  assert.ok(b.grain > 0 && b.scan === 0);
  assert.ok(c.scan > 0 && c.chroma === 0);
  assert.ok(d.chroma > 0 && d.glitch > 0 && d.mosh === 0 && d.lowpassHz < 20000);
  assert.ok(e.mosh > 0 && e.hum > 0 && e.lowpassHz < 1500);
  assert.equal(noiseParams(69).lowpassHz, 20000);
  // 그레인은 천천히 시작: 기본 세기 35% 는 50% 의 1/5 미만, 30% 미만은 0
  assert.ok(noiseParams(35).grain < noiseParams(50).grain / 5);
  assert.equal(noiseParams(29.9).grain, 0);
  assert.ok(noiseParams(80, 1).chroma > noiseParams(80, 0.25).chroma);
  assert.equal(noiseParams(95, 0).grain, 0);
  assert.equal(noiseParams(95, 0).lowpassHz, 20000);
});

test('후처리 필요 여부: 꺼짐·세기 0·30% 미만이면 건너뜀(비용 0), 정화 중이면 필요', () => {
  assert.equal(noiseNeeded([10, 29.9]), false);
  assert.equal(noiseNeeded([10, 30]), true);
  assert.equal(noiseNeeded([90], { enabled: false }), false);
  assert.equal(noiseNeeded([90], { strength: 0 }), false);
  assert.equal(noiseNeeded([5], { purging: true }), true);
});

test('급락 감지: compact 같은 큰 하락만, 작은 흔들림·낮은 구간은 아님', () => {
  assert.equal(isCtxDrop(C(85), C(12)), true);
  assert.equal(isCtxDrop(C(40), C(22)), true);
  assert.equal(isCtxDrop(C(60), C(50)), false);   // 10%p
  assert.equal(isCtxDrop(C(29.9), C(2)), false);  // 이전이 30% 미만
  assert.equal(isCtxDrop(C(50), C(36)), false);   // 15%p 미만
  assert.equal(isCtxDrop(null, C(5)), false);
});

test('패널 메모: 50·70·90 을 넘을 때와 급락만', () => {
  assert.deepEqual([0, 49, 50, 70, 90].map(bandOf), [0, 0, 1, 2, 3]);
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

test('국소 대상: 30% 이상·정화 중만, 정화 먼저·높은 순, 최대 개수', () => {
  const r = rankRegions([{ id: 1, pct: 29 }, { id: 2, pct: 50 }, { id: 3, pct: 90 }, { id: 4, pct: 5, purging: 1 }, { id: 5, pct: 30 }], 3);
  assert.deepEqual(r.map((x) => x.id), [4, 3, 2]);
});

test('정화 진행도: 0→1 뒤 끝(null)', () => {
  assert.equal(purgeProgress(null, 5), null);
  assert.equal(purgeProgress(1000, 1000), 0);
  assert.ok(Math.abs(purgeProgress(1000, 1000 + PURGE_MS / 2) - 0.5) < 1e-9);
  assert.equal(purgeProgress(1000, 1000 + PURGE_MS), null);
});

test('표시 문구: 토큰 줄임·추정 표시·툴팁', () => {
  assert.equal(fmtTokens(84_321), '84k');
  assert.equal(fmtTokens(1_000_000), '1M');
  assert.equal(fmtTokens(1_250_000), '1.3M');
  assert.equal(ctxShort({ used: 84_000, limit: 200_000, pct: 42, estimated: true }), '42% · 84k/200k?');
  assert.match(ctxTitle(C(92)), /세션 정리 권장/);
  assert.doesNotMatch(ctxTitle(C(89)), /세션 정리 권장/);
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

test('영어 화면(§86): 툴팁·단계 이름·창 근거·천 단위(Intl)', async () => {
  const { _setLangForTest } = await import('../i18n.mjs');
  const { STAGES } = await import('../ctx-core.mjs');
  _setLangForTest('en');
  try {
    const t = ctxTitle({ used: 184_000, limit: 200_000, pct: 92, basis: 'default', estimated: true });
    assert.match(t, /^Context 92% used \(184,000 \/ 200,000 tokens\)\nWindow size: no evidence → default 200k \(estimated\)\nDegradation: Datamosh · hum · consider wrapping up the session\n/);
    assert.equal(STAGES[1].name, 'Film grain');
    assert.equal(ctxTitle(null), 'No context data');
  } finally { _setLangForTest('ko'); }
  assert.equal(STAGES[1].name, '필름 그레인');
});
