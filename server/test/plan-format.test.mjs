// 자율 루프 판 내부 꼴(v2 를 판 전용으로 남김) — 상태 정규화·옛 꼴 호환·축 큐 → wire
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Graph } from '../graph.mjs';
import { PlanTracker, parseState, toV2State, legacyOf, v2Progress, planFromRaw, PLAN_STATE } from '../plans.mjs';

test('§116 상태: 느슨한 글 → v2, 옛 꼴 ↔ v2', () => {
  assert.deepEqual(PLAN_STATE, ['done', 'current', 'pending', 'blocked', 'skipped']);
  for (const [v, st] of [['completed', 'done'], ['✅', 'done'], ['완료', 'done'], ['in_progress', 'current'], ['진행중', 'current'], ['todo', 'pending'], ['예정', 'pending'],
    ['review', 'blocked'], ['⏸', 'blocked'], ['검토대기', 'blocked'], ['skipped', 'skipped'], ['취소', 'skipped'], ['current', 'current']]) assert.equal(parseState(v), st, v);
  assert.equal(parseState('뭔가'), null);
  assert.equal(toV2State('in_progress'), 'current');
  assert.equal(toV2State('pending', 1), 'blocked');
  assert.deepEqual(legacyOf('blocked'), { s: 'pending', hold: 1 });
  assert.deepEqual(legacyOf('skipped'), { s: 'done' });
  const pr = v2Progress([{ st: 'done' }, { st: 'skipped' }, { st: 'current' }, { st: 'blocked' }, { st: 'pending' }]);
  assert.deepEqual(pr, { done: 1, current: 1, pending: 1, blocked: 1, skipped: 1, total: 5, settled: 2 });
});

test('§116 바깥 계획 → wire v2: 계층(항목 → 단계)·현재 항목·옛 꼴 함께·minimal', () => {
  const raw = {
    src: 'source', title: '자율 루프 축', current: 'b',
    items: [
      { id: 'a', title: '축 A', state: 'done', doc: 'docs/a.md', steps: [{ title: '단계 0', state: 'done' }, { title: '단계 1', state: '⏸' }] },
      { id: 'b', title: '축 B', state: 'pending', meta: ['10-28', '개발'], group: '개발', steps: [{ title: '단계 0', state: 'done' }, { title: '단계 1', state: 'current' }, { title: '단계 2' }] },
      { id: 'c', title: '축 C', steps: { done: 0, total: 3 } },
    ],
  };
  const p = planFromRaw(raw, { at: 5, key: 'k1' });
  assert.equal(p.v, 2); assert.equal(p.src, 'source'); assert.equal(p.n, 3); assert.equal(p.owner, 'main');
  assert.deepEqual(p.items.map((x) => x.st), ['done', 'current', 'pending'], 'current 지정은 대기 항목을 current 로');
  assert.deepEqual(p.items.map((x) => x.s), ['done', 'in_progress', 'pending'], '옛 꼴 함께');
  assert.equal(p.cur, 1);
  assert.deepEqual(p.progress, { done: 1, current: 1, pending: 1, blocked: 0, skipped: 0, total: 3, settled: 1 });
  assert.deepEqual([p.items[1].steps.done, p.items[1].steps.total, p.items[1].steps.cur], [1, 3, '단계 1']);
  assert.equal(p.items[0].steps.done, 1, '⏸ 단계는 blocked(정착 아님 — 정착은 done·skipped)');
  assert.deepEqual(p.items[2].steps, { done: 0, total: 3 });
  assert.deepEqual(p.items[1].meta, ['10-28', '개발']); assert.equal(p.items[1].group, '개발');
  const m = planFromRaw(raw, { privacy: 'minimal' });
  assert.equal(m.title, ''); assert.equal(m.items[0].t, ''); assert.equal(m.items[0].doc, undefined); assert.equal(m.items[1].st, 'current');
  assert.equal(planFromRaw({ title: 'x' }), null);
});

test('§122 PlanTracker 바깥 계획(축 큐): 주인 노드 meta.plans 맨 앞 · 같은 내용이면 내지 않음 · 지우면 빠짐', () => {
  const g = new Graph({ rootSessionId: 'S', localSeq: true });
  g.addNode({ id: 's:S', parentId: null, kind: 'main', label: 'm', sessionId: 'S', meta: {} });
  g.addNode({ id: 'b:L', parentId: null, kind: 'bash-bg', label: '기동기', sessionId: 'S', meta: { launcher: { script: 'relaunch.sh' } } });
  g.finishLoad();
  const tr = new PlanTracker({ graph: g });
  const mk = () => planFromRaw({ src: 'axes', title: 'Q', items: [{ id: 'x', title: 'X', state: 'current' }] }, { key: 'a' });
  tr.setExternal('axes', 'b:L', mk(), 1);
  assert.deepEqual(g.get('b:L').meta.plans.map((p) => p.src), ['axes']);
  const before = g.ring.length;
  tr.setExternal('axes', 'b:L', mk(), 2);
  assert.equal(g.ring.length, before, '같은 내용이면 내지 않음');
  tr.setExternal('axes', 'b:L', null, 3);
  assert.equal(g.get('b:L').meta.plans, null);
});
