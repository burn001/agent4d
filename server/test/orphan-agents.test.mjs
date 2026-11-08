// 회차(claude -p)를 강제로 끈 뒤 결과 기록 없이 남은 서브에이전트(실측 11.07.: ACME 루프를 taskkill 로 끈 회차의
// 서브에이전트가 열린 Bash 를 든 채 영원히 대기 → 끝난 회차·러너·이전 기동기가 퇴장하지 못해 기동기가 둘로 보였다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime, SESSION_END } from '../session.mjs';

const T = (s) => new Date(Date.UTC(2026, 10, 7, 10, 0, 0) + s * 1000).toISOString();
function fake(nodes, ring = []) {
  const map = new Map(nodes.map((n) => [n.id, { meta: {}, ...n }]));
  const stopped = [];
  const self = { graph: { nodes: map, get: (id) => map.get(id), ring }, _endedSessionOf: RootRuntime.prototype._endedSessionOf, stop(id, ts, reason) { stopped.push([id, ts, reason]); map.get(id).status = 'stopped'; } };
  return { self, stopped, run: (now, off = false) => RootRuntime.prototype._sweepOrphanAgents.call(self, now, off) };
}
const tree = (cpStatus) => [
  { id: 's:main', kind: 'main', status: 'idle', parentId: null },
  { id: 'b:L', kind: 'bash-bg', status: 'done', parentId: null, endedAt: T(300) },
  { id: 'b:L-r2', kind: 'bash-bg', status: 'done', parentId: 'b:L', endedAt: T(300) },
  { id: 's:cp', kind: 'claude-p', status: cpStatus, parentId: 'b:L-r2', startedAt: T(0), lastActivityAt: T(300), endedAt: cpStatus === 'done' ? T(300) : null },
  { id: 'a:orphan', kind: 'subagent', status: 'idle', parentId: 's:cp', startedAt: T(290), lastActivityAt: T(296) },
  { id: 'a:ok', kind: 'subagent', status: 'done', parentId: 's:cp', startedAt: T(10), lastActivityAt: T(50), endedAt: T(50) },
  { id: 'a:live', kind: 'subagent', status: 'active', parentId: 's:main', startedAt: T(10), lastActivityAt: T(299) },
];

test('끝난 회차 아래 결과 없이 남은 서브에이전트는 마지막 기록 시각에 session-end 로 닫는다', () => {
  const f = fake(tree('done'));
  f.run(Date.parse(T(300)) + SESSION_END.GRACE_MS + 1);
  assert.deepEqual(f.stopped, [['a:orphan', T(296), 'session-end']]);
});

test('라이브: 회차가 끝난 직후(GRACE_MS 안)엔 기다린다 · 재생(offline)은 바로', () => {
  const f = fake(tree('done'));
  f.run(Date.parse(T(300)) + 1000);
  assert.equal(f.stopped.length, 0);
  f.run(Date.parse(T(300)) + 1000, true);
  assert.equal(f.stopped.length, 1);
});

test('이미 나간 대기 전환이 마지막 기록보다 뒤면 끝을 그 뒤로(재생 시각순에서 되살아나지 않게)', () => {
  const f = fake(tree('done'), [{ type: 'node-update', nodeId: 'a:orphan', ts: T(960), patch: { status: 'idle' } }]);
  f.run(0, true);
  assert.deepEqual(f.stopped, [['a:orphan', T(960), 'session-end']]);
});

test('회차가 아직 살아 있거나 메인 아래면 건드리지 않는다', () => {
  const f = fake(tree('idle'));
  f.run(Date.parse(T(300)) + 3600_000);
  assert.equal(f.stopped.length, 0);
});
