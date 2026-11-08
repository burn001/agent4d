// 재생 시각 보정(11.07.): 입양한 기동기의 러너가 세션 시작 전부터 돌고 있었고 제 기록이 없으면 첫 이벤트가 '끝'(다음 러너로 넘어감)뿐이다.
// 그 시각에 러너를 띄우면 인과 순서 단계가 그 아래 회차(claude -p)·서브에이전트 482개와 그 이벤트 전부를 러너 끝 시각으로 끌어와,
// 30분 동안 나뉘어 돈 서브에이전트가 재생에서 한순간에 몰려 나왔다(ACME 회차 57). 러너는 시작 시각(세션 앞이면 세션 시작)에 뜬다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Graph } from '../graph.mjs';
import { normalize } from '../replay.mjs';

const T = (m) => new Date(Date.UTC(2026, 10, 7, 9, 0, 0) + m * 60_000).toISOString();

test('러너가 세션 앞에서 시작했고 첫 이벤트가 끝이어도 회차·서브에이전트는 제 시각에 나온다', async () => {
  const g = new Graph({ rootSessionId: 'M', keepAll: true });
  g.addNode({ id: 's:M', kind: 'main', label: 'm', sessionId: 'M', startedAt: T(0) }, T(0));
  g.addNode({ id: 'b:L', kind: 'bash-bg', parentId: null, label: 'L', startedAt: T(0), meta: { launcher: { script: 'x.sh' }, detached: true, spawnedBy: 's:M' } }, T(0));
  // 러너: 하루 전 시작(세션 앞), 그 뒤 기록 없음 — node-add 는 적재 시각(아무 때)
  g.addNode({ id: 'b:L-r2', kind: 'bash-bg', parentId: 'b:L', label: 'r', startedAt: '2026-11-06T13:00:00.000Z', meta: { runner: { script: 'a.sh', instance: 2, launcher: 'b:L' } } }, T(90));
  g.addNode({ id: 's:C', kind: 'claude-p', parentId: 'b:L-r2', label: 'c', sessionId: 'C', startedAt: T(5), meta: { link: { by: 'launcher' } } }, T(5));
  for (let i = 0; i < 6; i++) {
    g.addNode({ id: 'a:' + i, kind: 'subagent', parentId: 's:C', label: 'a' + i, sessionId: 'C', startedAt: T(10 + i * 5) }, T(90));
    g.emit({ ts: T(10 + i * 5), type: 'text', nodeId: 'a:' + i, text: 'x' });
    g.updateNode('a:' + i, { status: 'done', endedAt: T(11 + i * 5) }, T(11 + i * 5));
  }
  g.updateNode('s:C', { status: 'done', endedAt: T(40) }, T(40));
  g.updateNode('b:L-r2', { status: 'done', endedAt: T(40), meta: { endReason: 'next-runner' } }, T(40)); // 러너의 유일한 제 이벤트 = 끝
  const rt = {
    sessionId: 'M', graph: g, sweepFrom: g.ring.length, _clockIso: T(60), tools: new Map(), spawnHints: new Map(), agentToolUse: null,
    outputs: new Map(), _runs: new Map(), procs: new Map(), index: { liveStatus: () => null }, children: [],
  };
  const { events } = await normalize(rt, { now: Date.parse(T(60)) });
  const addAt = (id) => events.find((e) => e.type === 'node-add' && e.nodeId === id).t;
  assert.equal(addAt('b:L-r2'), Date.parse(T(0)), '러너: 세션 시작');
  assert.equal(addAt('s:C'), Date.parse(T(5)), '회차: 제 첫 기록');
  for (let i = 0; i < 6; i++) assert.equal(addAt('a:' + i), Date.parse(T(10 + i * 5)), `서브에이전트 ${i}: 제 시각`);
});
