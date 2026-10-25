// 러너(재기동기 → 러너 → 회차) 웹 배치 — 접기·장치 계수·평면 배치(위성 아님)·복셀 작업석. 합성 노드만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchFold, deviceInfo, nodeTags, isRunner } from '../batch-core.mjs';
import { computeLayout } from '../layout.js';
import { computeOffice } from '../voxel/layout.js';

let ord = 0;
const T = (min) => new Date(Date.parse('2026-10-23T14:00:00Z') + min * 60000).toISOString();
const N = (id, parentId, kind, extra = {}) => ({ id, parentId, kind, status: 'active', order: ord++, _order: ord, startedAt: T(ord), lastActivityAt: T(ord), meta: {}, ...extra });
const mapOf = (list) => new Map(list.map((n) => [n.id, n]));
const cyc = (k, parent, status) => N('s:c' + k, parent, 'claude-p', { status, sessionId: 'c' + k, meta: { cycle: k, link: { by: 'launcher', confidence: 'high' } } });

/** 메인 · 독립 재기동기 → 러너 #1(끝, 회차 1·2 끝) · 러너 #2(진행, 회차 3 끝·4 진행 + 하위) */
function chain() {
  ord = 0;
  return [
    N('s:main', null, 'main', { sessionId: 'main' }),
    N('b:L', null, 'bash-bg', { meta: { detached: true, spawnedBy: 's:main', launcher: { script: 'relaunch.sh', via: ['relaunch.sh', 'autopilot.sh'] } } }),
    N('b:L-r1', 'b:L', 'bash-bg', { status: 'done', label: '러너 · autopilot.sh', meta: { runner: { script: 'autopilot.sh', instance: 1, launcher: 'b:L' }, endReason: 'next-runner' } }),
    cyc(1, 'b:L-r1', 'done'), cyc(2, 'b:L-r1', 'done'),
    N('b:L-r2', 'b:L', 'bash-bg', { label: '러너 · autopilot.sh', meta: { runner: { script: 'autopilot.sh', instance: 2, launcher: 'b:L' } } }),
    cyc(3, 'b:L-r2', 'done'), cyc(4, 'b:L-r2', 'active'),
    N('a:c4sub', 's:c4', 'subagent'),
  ];
}

test('접기: 러너 아래 회차도 장치 회차, 끝난 러너는 펼친 회차가 없으면 장치 안, 진행 러너는 펼침', () => {
  const byId = mapOf(chain());
  const f = batchFold(byId);
  const dev = f.devices.get('b:L');
  assert.deepEqual(dev.cycles, ['s:c1', 's:c2', 's:c3', 's:c4']);
  assert.equal(dev.currentId, 's:c4');
  assert.deepEqual([...f.docked.keys()], ['s:c3', 's:c2'], '끝난 회차 최근 2개는 장치 옆');
  assert.ok(f.hidden.has('s:c1'));
  assert.ok(f.hidden.has('b:L-r1'), '끝난 러너(회차 모두 장치 안·옆)는 숨김');
  assert.ok(!f.hidden.has('b:L-r2'), '진행 러너는 보임');
  assert.equal(f.zoneOf.get('b:L-r2'), 'b:L');
  assert.equal(f.zoneOf.get('a:c4sub'), 'b:L');
  const info = deviceInfo(byId.get('b:L'), byId);
  assert.equal(info.total, 4);
  assert.equal(info.running, 1);
  assert.equal(info.done, 3);
  assert.ok(isRunner(byId.get('b:L-r2')));
  assert.deepEqual(nodeTags(byId.get('b:L-r2'), byId), ['기동 #2']);
  assert.deepEqual(nodeTags(byId.get('s:c4'), byId), ['회차 #4'], '러너 아래여도 회차 꼬리표');
});

test('평면 배치: 러너는 위성이 아니라 재기동기 바깥 자식, 회차는 그 너머(겹침 없음)', () => {
  const byId = mapOf(chain());
  const f = batchFold(byId);
  const nodes = new Map([...byId].filter(([id]) => !f.hidden.has(id) && !f.docked.has(id)));
  const { pos, parentOf } = computeLayout(nodes, 's:main');
  const d = (a, b) => Math.hypot(pos.get(a).x - pos.get(b).x, pos.get(a).z - pos.get(b).z);
  assert.equal(parentOf.get('b:L-r2'), 'b:L');
  assert.equal(parentOf.get('s:c4'), 'b:L-r2');
  assert.ok(pos.get('b:L-r2').y > pos.get('b:L').y - 4 + 1e-6, '위성 자리(부모 아래 y−4)가 아님');
  assert.ok(d('s:c4', 'b:L') > d('b:L-r2', 'b:L'), '회차는 러너 너머');
  for (const [a, b] of [['b:L-r2', 'b:L'], ['s:c4', 'b:L-r2'], ['s:c4', 's:main'], ['b:L-r2', 's:main']]) assert.ok(d(a, b) > 2.5, `${a}~${b} 겹침 없음 ${d(a, b)}`);
});

test('복셀: 러너 아래 회차도 자율 루프 팀원 책상(op, §88), 러너는 서버랙 기계', () => {
  const lay = computeOffice(chain().filter((n) => !['s:c1', 's:c2', 'b:L-r1'].includes(n.id)), 's:main', null);
  assert.equal(lay.seat.get('s:c4').kind, 'op');
  assert.equal(lay.seat.get('a:c4sub').kind, 'op');
  assert.equal(lay.machine.get('b:L').type, 'batch');
  assert.equal(lay.machine.get('b:L-r2').type, 'rack');
});
