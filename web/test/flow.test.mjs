// 흐름 연출·타임라인·완료 노드 퇴장의 순수 부분
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOW, planFlow, PacketPool, linkPoint, trailUs, catColor, CAT_ORDER, CAT_HUE, exitEligible } from '../flow-core.mjs';
import { markFor, TimelineModel, TL } from '../timeline.mjs';
import { eventToSound, SOUNDS } from '../sfx.mjs';
import { createState, applyEvent } from '../replay/state.mjs';

// 작은 트리: s:m → a:1 → a:2, s:m → b:1
const tree = new Map([
  ['s:m', { id: 's:m', parentId: null, kind: 'main', status: 'active' }],
  ['a:1', { id: 'a:1', parentId: 's:m', kind: 'subagent', status: 'active' }],
  ['a:2', { id: 'a:2', parentId: 'a:1', kind: 'subagent', status: 'active' }],
  ['b:1', { id: 'b:1', parentId: 's:m', kind: 'bash-bg', status: 'active' }],
]);
const ctxFor = (over = {}) => ({
  has: (id) => tree.has(id), parentOf: (id) => tree.get(id)?.parentId ?? null,
  activeChild: (id) => [...tree.values()].reverse().find((n) => n.parentId === id && n.status === 'active')?.id ?? null,
  now: 10, speed: 1, state: { lastUp: new Map(), lastOut: new Map() }, ...over,
});

test('planFlow: 호출(부모→자식)·결과(자식→부모)를 색·방향으로 구분, 도구 자체는 패킷 없음(홀로그램 §38)', () => {
  const c = ctxFor();
  assert.deepEqual(planFlow({ type: 'node-add', nodeId: 'a:2', node: { id: 'a:2', parentId: 'a:1', kind: 'subagent' } }, c),
    [{ kind: 'link', from: 'a:1', to: 'a:2', color: 'call', dir: 'down', size: 1 }]);
  assert.deepEqual(planFlow({ type: 'result', nodeId: 'a:2', ok: true }, c), [{ kind: 'link', from: 'a:2', to: 'a:1', color: 'ok', dir: 'up', size: 1.1 }]);
  assert.equal(planFlow({ type: 'result', nodeId: 'a:1', ok: false }, c)[0].color, 'error');
  // 결과 직후 상태 종료는 중복 패킷을 내지 않는다
  assert.deepEqual(planFlow({ type: 'node-update', nodeId: 'a:2', patch: { status: 'done' } }, c), []);
  // 결과 없이 끝난 것: 중지됨은 회색 패킷
  assert.deepEqual(planFlow({ type: 'node-update', nodeId: 'b:1', patch: { status: 'stopped' } }, c), [{ kind: 'link', from: 'b:1', to: 's:m', color: 'stopped', dir: 'up', size: 0.9 }]);
  assert.deepEqual(planFlow({ type: 'node-update', nodeId: 'a:1', patch: { status: 'idle' } }, c), []);
  // 도구: 흐름 패킷 없음(도구 가지는 홀로그램 패널로 옮김 — 중복 표현 금지)
  assert.deepEqual(planFlow({ type: 'tool-start', nodeId: 'a:1', toolUseId: 't1', tool: 'Read', cat: 'read' }, c), []);
  assert.deepEqual(planFlow({ type: 'tool-end', nodeId: 'a:1', toolUseId: 't1', ok: false }, c), []);
  // SendMessage 는 이미 있는 활성 하위에게 호출 패킷, Agent(새 에이전트)는 node-add 가 맡음
  const sm = planFlow({ type: 'tool-start', nodeId: 's:m', toolUseId: 't2', tool: 'SendMessage', cat: 'agent' }, c);
  assert.equal(sm.length, 1); assert.equal(sm[0].to, 'b:1');
  assert.equal(planFlow({ type: 'tool-start', nodeId: 's:m', toolUseId: 't3', tool: 'Agent', cat: 'agent' }, c).length, 0);
  // 모르는 노드·부모 없는 루트는 패킷 없음
  assert.deepEqual(planFlow({ type: 'result', nodeId: 's:m', ok: true }, c), []);
  assert.deepEqual(planFlow({ type: 'tool-start', nodeId: 'x:none', toolUseId: 't9', cat: 'read' }, c), []);
});

test('planFlow: 출력 패킷은 노드당 간격 제한, 빠른 재생에선 솎아냄', () => {
  const c = ctxFor();
  assert.equal(planFlow({ type: 'output', nodeId: 'b:1' }, c).length, 1);
  assert.equal(planFlow({ type: 'output', nodeId: 'b:1' }, { ...c, now: 10.2 }).length, 0);
  assert.equal(planFlow({ type: 'output', nodeId: 'b:1' }, { ...c, now: 10 + FLOW.OUTPUT_GAP + 0.01 }).length, 1);
  assert.equal(planFlow({ type: 'output', nodeId: 'b:1' }, ctxFor({ speed: 8 })).length, 0);
});

test('PacketPool: 전체·노드별 상한, 가득 차면 가장 오래된 것 재사용, 해제 후 재사용', () => {
  const p = new PacketPool(8, 3);
  for (let i = 0; i < 5; i++) p.alloc('a', i);
  assert.equal(p.size, 3, '노드별 상한 3');
  assert.equal(Math.min(...p.active.map((s) => s.t0)), 2, '가장 오래된 것부터 재사용');
  for (let i = 0; i < 20; i++) p.alloc('n' + i, 100 + i);
  assert.equal(p.size, 8, '전체 상한 8');
  assert.ok(p.recycled > 0);
  const s = p.active[0];
  p.release(s);
  assert.equal(p.size, 7);
  assert.equal(p.free.length, 1);
  p.clear();
  assert.equal(p.size, 0); assert.equal(p.byOwner.size, 0);
  // 300 노드 × 이벤트 폭주에도 슬롯 수는 고정(인스턴싱 상한)
  const big = new PacketPool(FLOW.MAX_PACKETS, FLOW.PER_NODE);
  for (let i = 0; i < 300 * 20; i++) big.alloc('n' + (i % 300), i);
  assert.equal(big.size, FLOW.MAX_PACKETS);
  assert.equal(big.slots.length, FLOW.MAX_PACKETS);
});

test('경로·잔광', () => {
  const a = { x: 0, y: 0, z: 0 }, b = { x: 10, y: 0, z: 0 }, o = {};
  linkPoint(o, a, b, 0.5, 1); assert.deepEqual([o.x, o.y, o.z], [5, 1, 0]);
  linkPoint(o, a, b, 0.5, -1); assert.equal(o.y, -1, '결과 패킷은 아래로 호');
  linkPoint(o, a, b, 1, 1); assert.ok(Math.abs(o.y) < 1e-9 && o.x === 10);
  const us = trailUs(0.5);
  assert.equal(us.length, FLOW.TRAIL);
  assert.ok(us.every((u, i) => u < 0.5 && (i === 0 || u < us[i - 1])));
  assert.equal(trailUs(0.02).length, 0);
});

test('도구 색: 모든 cat 에 색, 테마별 밝기', () => {
  for (const c of CAT_ORDER) { assert.ok(CAT_HUE[c] != null, c); assert.match(catColor(c, false), /^hsl\(/); }
  assert.notEqual(catColor('read', true), catColor('read', false));
  assert.equal(catColor('없는-cat', false), catColor('other', false));
});

test('exitEligible: 끝난(완료·중지됨) 노드 중 하위도 다 끝난 것만, 오류·루트·메인은 남김', () => {
  const nodes = new Map([
    ['s:m', { id: 's:m', parentId: null, kind: 'main', status: 'done' }],
    ['a:1', { id: 'a:1', parentId: 's:m', kind: 'subagent', status: 'done' }],
    ['a:2', { id: 'a:2', parentId: 'a:1', kind: 'subagent', status: 'active' }],
    ['a:3', { id: 'a:3', parentId: 's:m', kind: 'subagent', status: 'done' }],
    ['b:1', { id: 'b:1', parentId: 'a:3', kind: 'bash-bg', status: 'stopped' }],
    ['b:2', { id: 'b:2', parentId: 's:m', kind: 'bash-bg', status: 'error' }],
    ['w:1', { id: 'w:1', parentId: 's:m', kind: 'workflow', status: 'done' }],
    ['a:4', { id: 'a:4', parentId: 'w:1', kind: 'workflow-agent', status: 'error' }],
  ]);
  const e = exitEligible(nodes, ['s:m']);
  assert.deepEqual([...e].sort(), ['a:3', 'b:1']);
});

test('타임라인: 이벤트 → 표식(도구 종류 색·모양), 창 밖 정리, 겹치면 합침', () => {
  assert.deepEqual(markFor({ type: 'tool-start', cat: 'shell', tool: 'Bash', text: '빌드' }), { shape: 'bar', color: 'cat:shell', cat: 'shell', label: 'Bash · 빌드' });
  assert.equal(markFor({ type: 'tool-end', ok: true }), null);
  assert.equal(markFor({ type: 'tool-end', ok: false, tool: 'Bash' }).shape, 'x');
  assert.equal(markFor({ type: 'node-update', patch: { status: 'stopped' } }).color, 'stopped');
  assert.equal(markFor({ type: 'node-update', patch: { status: 'error' } }).color, 'error');
  assert.equal(markFor({ type: 'node-update', patch: { status: 'idle' } }), null);
  assert.equal(markFor({ type: 'node-add', node: { kind: 'claude-p', label: 'x' } }).color, 'k-claude-p');
  assert.equal(markFor({ type: 'user', origin: 'task-notification' }), null);
  assert.equal(markFor({ type: 'text' }), null);
  const m = new TimelineModel({ windowMs: 10_000 });
  assert.ok(m.push({ type: 'tool-start', nodeId: 'a', cat: 'read' }, null, 0));
  assert.ok(m.push({ type: 'output', nodeId: 'b' }, null, 100));
  assert.equal(m.push({ type: 'output', nodeId: 'b' }, null, 200), null, '출력은 노드당 간격 제한');
  assert.ok(m.push({ type: 'output', nodeId: 'b' }, null, 100 + TL.OUTPUT_GAP_MS));
  for (let i = 0; i < 5; i++) m.push({ type: 'tool-start', nodeId: 'a', cat: 'read' }, null, 5000 + i); // 같은 자리 5개
  const lay = m.layout(10_000, 1000);
  const bars = lay.filter((o) => o.row === 0);
  assert.equal(bars.length, 2, '겹친 5개는 하나로');
  assert.equal(bars[1].count, 5);
  assert.ok(Math.abs(bars[1].x - 500) < 1);
  m.prune(12_000);
  assert.ok(m.marks.every((x) => x.t >= 2000));
  const cap = new TimelineModel({ max: 10 });
  for (let i = 0; i < 50; i++) cap.push({ type: 'tool-start', nodeId: 'a', cat: 'read' }, null, i);
  assert.equal(cap.marks.length, 10);
});

test('중지됨: 효과음은 실패음이 아니라 작은 중지음, 재생 reducer 는 patch 그대로', () => {
  const s = eventToSound({ type: 'node-update', nodeId: 'b:1', patch: { status: 'stopped' } }, { id: 'b:1', kind: 'bash-bg' });
  assert.equal(s.name, 'stop');
  assert.equal(s.priority, 2);
  assert.ok(SOUNDS.stop && SOUNDS.stop.dur <= 0.4);
  assert.equal(eventToSound({ type: 'node-update', nodeId: 'b:1', patch: { status: 'error' } }, { kind: 'bash-bg' }).name, 'error');
  const st = createState();
  applyEvent(st, { seq: 1, ts: '2026-10-23T00:00:00Z', type: 'node-add', nodeId: 'b:1', node: { id: 'b:1', kind: 'bash-bg', status: 'active', meta: {} } });
  applyEvent(st, { seq: 2, ts: '2026-10-23T00:00:05Z', type: 'node-update', nodeId: 'b:1', patch: { status: 'stopped', endedAt: '2026-10-23T00:00:05Z', meta: { killed: true, stopReason: 'taskstop' } } });
  const n = st.nodes.get('b:1');
  assert.equal(n.status, 'stopped'); assert.equal(n.meta.stopReason, 'taskstop');
});
