// 평면 배치 겹침 회귀 시험 — 자율 루프 사슬(메인 → 서브에이전트 → 기동기 → 회차 → 서브에이전트)이
// 메인 위로 접혀 들어오던 문제(실화면). 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, nodeExtent, dockedPos, DEVICE_EXTENT } from '../layout.js';
import { computeOverview } from '../overview/layout.mjs';
import { batchFold } from '../batch-core.mjs';

const T = (min) => new Date(Date.parse('2026-10-24T01:00:00Z') + min * 60000).toISOString();
let ord = 0;
const N = (id, kind, parentId, extra = {}) => ({ id, kind, parentId, status: 'active', startedAt: T(ord), _order: ord++, projectId: 'P', label: id, meta: {}, ...extra });

function loopTree() {
  ord = 0;
  const L = { launcher: { script: 'relaunch.sh', via: 'nohup' }, batch: { total: 2, running: 1, done: 1, currentCycleId: 'cur' } };
  const list = [
    N('s:main', 'main', null),
    N('m:mon', 'monitor', 's:main', { status: 'idle' }),
    N('a:sub', 'subagent', 's:main', { status: 'done' }),
    N('b:L', 'bash-bg', 'a:sub', { meta: L }),
    N('s:old', 'claude-p', 'b:L', { status: 'done', meta: { link: { by: 'launcher', confidence: 'medium' }, cycle: 1 } }),
    N('s:cur', 'claude-p', 'b:L', { meta: { link: { by: 'launcher', confidence: 'medium' }, cycle: 2 } }),
    N('a:cyc', 'subagent', 's:cur'),
    N('b:sat', 'bash-bg', 'a:cyc'),
  ];
  return new Map(list.map((n) => [n.id, n]));
}

/** scene._relayout 과 같은 순서: 접기 → 배치 → 장치에 붙은 끝난 회차 */
function place(all, layout) {
  const bf = batchFold(all);
  const nodes = new Map([...all].filter(([id]) => !bf.hidden.has(id) && !bf.docked.has(id)));
  const { pos, parentOf } = layout(nodes);
  for (const [id, d] of bf.docked) pos.set(id, dockedPos(pos.get(d.launcher), pos.get(parentOf.get(d.launcher)), d.slot));
  return { pos, bf };
}

function overlaps(all, pos, bf) {
  const ext = (n) => nodeExtent(n) * (bf.docked.has(n.id) ? 0.5 : 1);
  const P = [...pos.entries()];
  const bad = [];
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const a = all.get(P[i][0]), b = all.get(P[j][0]);
    const d = Math.hypot(P[i][1].x - P[j][1].x, P[i][1].z - P[j][1].z); // Flow·2D 는 높이를 없앤다
    if (d < ext(a) + ext(b)) bad.push(`${a.id}~${b.id} ${d.toFixed(2)}`);
  }
  return bad;
}

test('자율 루프 사슬: 평면에서 칩끼리 겹치지 않고, 기동기·회차는 메인 바깥쪽으로', () => {
  const all = loopTree();
  const { pos, bf } = place(all, (nodes) => computeLayout(nodes, 's:main'));
  assert.deepEqual(overlaps(all, pos, bf), []);
  const r = (id) => Math.hypot(pos.get(id).x, pos.get(id).z);
  assert.ok(r('b:L') > r('a:sub') && r('s:cur') > r('b:L') && r('a:cyc') > r('s:cur'), '사슬이 바깥으로 이어짐');
  assert.ok(Math.hypot(pos.get('b:L').x - pos.get('a:sub').x, pos.get('b:L').z - pos.get('a:sub').z) >= DEVICE_EXTENT + nodeExtent(all.get('a:sub')));
});

test('자율 루프 사슬: 전체 보기 배치에서도 겹치지 않음', () => {
  const all = loopTree();
  const { pos, bf } = place(all, (nodes) => computeOverview(nodes, [{ nodeId: 's:main', projectId: 'P' }], [{ projectId: 'P', name: 'P', live: true }], null, { nowMs: Date.parse(T(10)) }));
  assert.deepEqual(overlaps(all, pos, bf), []);
});

test('위성(백그라운드 명령): 부모 쪽 바로 안쪽을 비워 평면에서 조부모와 겹치지 않음', () => {
  ord = 0;
  const list = [N('s:main', 'main', null), N('a:x', 'subagent', 's:main'), N('a:y', 'subagent', 'a:x')];
  for (let i = 0; i < 7; i++) list.push(N('b:' + i, 'bash-bg', 'a:y'));
  const all = new Map(list.map((n) => [n.id, n]));
  const { pos } = computeLayout(all, 's:main');
  const bf = batchFold(all);
  assert.deepEqual(overlaps(all, pos, bf), []);
});

// 부모가 끊긴(nohup … &) 기동기: 서버가 parentId null·meta.spawnedBy 로 준다
function detachedTree() {
  const all = loopTree();
  const L = all.get('b:L');
  all.set('b:L', { ...L, parentId: null, rootSessionId: 'main', meta: { ...L.meta, detached: true, spawnedBy: 'a:sub' } });
  all.set('s:main', { ...all.get('s:main'), sessionId: 'main', rootSessionId: 'main' });
  return all;
}

test('독립 기동기(§67): 세션 배치에서 띄운 메인 첫 고리, 회차는 바깥, 관계는 끊긴 그대로, 겹침 0', async () => {
  const { isDetachedRoot } = await import('../layout.js');
  const all = detachedTree();
  assert.ok(isDetachedRoot(all.get('b:L')));
  const { pos, bf } = place(all, (nodes) => computeLayout(nodes, 's:main'));
  const lay = computeLayout(new Map([...all].filter(([id]) => !bf.hidden.has(id) && !bf.docked.has(id))), 's:main');
  assert.equal(lay.parentOf.get('b:L'), null, '기동기는 루트에 붙지 않음');
  assert.equal(lay.parentOf.get('s:cur'), 'b:L');
  assert.deepEqual(overlaps(all, pos, bf), []);
  // 기동기는 메인 첫 고리(서브에이전트와 같은 거리 수준), 회차 사슬은 메인 반대 바깥쪽
  const d = (id) => Math.hypot(lay.pos.get(id).x - lay.pos.get('s:main').x, lay.pos.get(id).z - lay.pos.get('s:main').z);
  assert.ok(d('b:L') <= d('a:sub') * 1.6 + 2, `기동기 ${d('b:L').toFixed(1)} ≈ 서브 ${d('a:sub').toFixed(1)}`);
  assert.ok(d('s:cur') > d('b:L'), '회차는 바깥');
});

const dm0 = (ov, id) => Math.hypot(ov.pos.get(id).x - ov.pos.get('s:main').x, ov.pos.get(id).z - ov.pos.get('s:main').z);
test('독립 기동기: 전체 보기에서 같은 섬 안 메인 첫 고리, 메인이 희미하면 같이 희미', () => {
  const all = detachedTree();
  const roots = [{ nodeId: 's:main', projectId: 'P' }];
  const ov = computeOverview(all, roots, [{ projectId: 'P', name: 'P', live: true }], null, { nowMs: Date.parse(T(10)) });
  assert.equal(ov.clusters.length, 1);
  assert.deepEqual(ov.clusters[0].mains.map((m) => m.nodeId), ['s:main'], '기동기는 메인 무리에 합쳐 배치(§67)');
  assert.equal(ov.parentOf.get('b:L'), null, '관계는 끊긴 그대로');
  assert.ok(dm0(ov, 'b:L') <= dm0(ov, 'a:sub') * 1.6 + 2, '메인 첫 고리 거리');
  assert.equal(ov.clusters[0].currentMain, 's:main', '메인이 섬 중심(§66: 기동기는 둘레)');
  const dm = (id) => Math.hypot(ov.pos.get(id).x - ov.pos.get('s:main').x, ov.pos.get(id).z - ov.pos.get('s:main').z);
  assert.ok(dm('s:cur') > dm('b:L'), '회차는 메인 반대쪽(바깥)');
  const { pos, bf } = place(all, (nodes) => computeOverview(nodes, roots, [{ projectId: 'P', name: 'P', live: true }], null, { nowMs: Date.parse(T(10)) }));
  assert.deepEqual(overlaps(all, pos, bf), []);
  all.set('s:main', { ...all.get('s:main'), meta: { tier: 'recent' } });
  const ov2 = computeOverview(all, roots, [{ projectId: 'P', name: 'P', live: true }], null, { nowMs: Date.parse(T(10)) });
  assert.ok(ov2.hidden.has('b:L') && ov2.hidden.has('s:cur'), '끝난 세션의 기동기 무리도 숨김(숨김 포함 꺼짐)');
});

test('독립 기동기: 복셀 캠퍼스는 띄운 세션 팀장 사무실의 복합기로(기동기 사무실 없음)', async () => {
  const { computeCampus } = await import('../voxel/campus.mjs');
  const all = detachedTree();
  const c = computeCampus(all, [{ nodeId: 's:main', projectId: 'P' }], [{ projectId: 'P', name: 'P', live: true }], null, { nowMs: Date.parse(T(10)) });
  assert.deepEqual([...c.officeByMain.keys()], ['s:main']);
});
