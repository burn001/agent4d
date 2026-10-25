// 재생 하이라이트 — 순수 함수
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHighlights, clusterTimes, highlightNear, seekTargetOf, HL, HL_LEAD_MS } from '../replay/highlights.mjs';
import { computeTimeline, normalizeEvents } from '../replay/engine.mjs';

const T0 = Date.parse('2026-10-01T00:00:00Z');
const add = (sec, kind, id) => ({ type: 'node-add', t: T0 + sec * 1000, nodeId: id, node: { id, kind, parentId: 's:m', depth: 1 } });
const tend = (sec, ok) => ({ type: 'tool-end', t: T0 + sec * 1000, nodeId: 's:m', ok });

test('묶기: 간격 안이면 이어지고 최대 폭에서 끊긴다', () => {
  const c = clusterTimes([0, 10, 20, 200, 205].map((s) => ({ t: s * 1000 })), 60_000);
  assert.deepEqual(c.map((x) => x.n), [3, 2]);
  const long = clusterTimes(Array.from({ length: 40 }, (_, i) => ({ t: i * 50_000 })), 60_000, 15 * 60_000);
  assert.ok(long.length >= 2 && long.every((x) => x.t1 - x.t <= 15 * 60_000));
  assert.equal(long.reduce((a, x) => a + x.n, 0), 40);
});

test('서브에이전트 대량 분기·백그라운드 몰림·오류 몰림·노드 오류', () => {
  const ev = [
    { type: 'node-add', t: T0, nodeId: 's:m', node: { id: 's:m', kind: 'main' } },
    add(10, 'subagent', 'a:1'), add(20, 'subagent', 'a:2'), add(25, 'workflow-agent', 'a:3'), add(30, 'subagent', 'a:4'),
    add(500, 'subagent', 'a:5'), add(900, 'subagent', 'a:6'), // 따로 떨어진 것은 표시 안 함
    add(1000, 'bash-bg', 'b:1'), add(1060, 'monitor', 'm:1'), add(1100, 'bash-bg', 'b:2'),
    tend(2000, false), tend(2010, false), tend(2020, false), tend(2030, true),
    tend(3000, false), // 하나뿐인 도구 오류는 표시 안 함
    { type: 'node-update', t: T0 + 4000_000, nodeId: 'a:1', patch: { status: 'error' } }, // 노드 오류는 1건이어도
  ];
  const h = computeHighlights(ev);
  assert.deepEqual(h.map((x) => [x.kind, x.n, (x.t - T0) / 1000]), [['fanout', 4, 10], ['bg', 3, 1000], ['error', 3, 2000], ['error', 1, 4000]]);
  assert.equal(h[0].label, '서브에이전트 4개 분기');
  assert.equal(h[1].label, '백그라운드 작업 3개');
  assert.equal(h[2].label, '오류 3건');
  assert.equal(h[0].t1, T0 + 30_000);
});

test('상한: 종류마다 고르게 남기고 시각순', () => {
  const ev = [];
  for (let k = 0; k < 60; k++) for (let j = 0; j < 3 + (k % 4); j++) ev.push(add(k * 1000 + j, 'subagent', `a:${k}-${j}`));
  for (let k = 0; k < 5; k++) for (let j = 0; j < 3; j++) ev.push(tend(100_000 + k * 1000 + j, false));
  ev.sort((a, b) => a.t - b.t);
  const h = computeHighlights(ev);
  assert.equal(h.length, HL.MAX);
  assert.equal(h.filter((x) => x.kind === 'error').length, 5, '오류 묶음이 대량 분기에 밀려 사라지지 않음');
  for (let i = 1; i < h.length; i++) assert.ok(h[i].t >= h[i - 1].t);
});

test('가까운 표시 찾기·이동 시각(묶음 3초 앞, 시작 전으로는 안 감)', () => {
  const list = [{ t: 1000 }, { t: 5000 }];
  const xOf = (t) => t / 100;
  assert.equal(highlightNear(list, 12, xOf), list[0]);
  assert.equal(highlightNear(list, 48, xOf), list[1]);
  assert.equal(highlightNear(list, 30, xOf), null);
  assert.equal(seekTargetOf({ t: 10_000 }, 0), 10_000 - HL_LEAD_MS);
  assert.equal(seekTargetOf({ t: 1000 }, 500), 500);
});

test('computeTimeline(mock·demo 재생)도 highlights 를 낸다', () => {
  const raw = [{ type: 'node-add', ts: new Date(T0).toISOString(), nodeId: 's:m', node: { id: 's:m', kind: 'main' } },
    ...[1, 2, 3].map((s) => ({ ...add(s, 'subagent', 'a:' + s), ts: new Date(T0 + s * 1000).toISOString() }))];
  const tl = computeTimeline(normalizeEvents(raw), { sessionId: 'x' });
  assert.equal(tl.highlights.length, 1);
  assert.equal(tl.highlights[0].kind, 'fanout');
});

test('영어(§86): 볼거리 라벨·재생 길이·건수 포맷', async () => {
  const { _setLangForTest } = await import('../i18n.mjs');
  const { highlightLabel } = await import('../replay/highlights.mjs');
  const { fmtDuration, fmtSkip, fmtCount, fmtDate } = await import('../replay/ui.mjs');
  _setLangForTest('en');
  try {
    assert.equal(highlightLabel({ kind: 'fanout', n: 4, label: '서브에이전트 4개 분기' }), '4 subagents fanned out');
    assert.equal(highlightLabel({ kind: 'error', n: 1 }), '1 error');
    assert.equal(highlightLabel({ kind: 'bg', n: 3 }), '3 background jobs');
    assert.equal(fmtDuration(72 * 60_000), '1h 12m');
    assert.equal(fmtDuration(45_000), '45s');
    assert.equal(fmtSkip(192_000), '3m 12s');
    assert.equal(fmtCount(3400, false), '3,400 events');
    assert.equal(fmtCount(1, false), '1 event');
    assert.equal(fmtCount(12000), '≈12K events');
    assert.ok(!/[가-힣]/.test(fmtDate('2026-10-21T05:03:00Z')));
  } finally { _setLangForTest('ko'); }
  assert.equal(fmtDuration(72 * 60_000), '1시간 12분');
  assert.equal(fmtCount(12000), '≈1.2만 건');
  assert.equal(fmtCount(3400, false), '3,400건');
});
