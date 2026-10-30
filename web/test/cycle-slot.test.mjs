// 기동기 루프 움찔거림: 회차 사이 자리 붙잡기(CycleSlots) · 기동기 자리가 형제 퇴장에 흔들리지 않음. 합성 값만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, nodeExtent } from '../layout.js';
import { refineFit2D, boxCenterXZ, fitNeed } from '../flat/flat-core.mjs';
import { FitHold, FIT, CycleSlots, isCycleNode } from '../camera-core.mjs';

const N = (id, kind, parentId, meta = {}, o = 0) => [id, { id, kind, parentId, meta, _order: o }];
const loop = () => new Map([
  N('m', 'main', null, {}, 0), N('sa', 'subagent', 'm', {}, 1),
  N('L', 'bash-bg', null, { launcher: { script: 'relaunch.sh' }, detached: true, spawnedBy: 'm' }, 2),
  N('r', 'bash-bg', 'L', { runner: { script: 'autopilot.sh', instance: 1 } }, 3),
  N('c1', 'claude-p', 'r', { cycle: 1 }, 4), N('c2', 'claude-p', 'r', { cycle: 2 }, 5),
]);

test('§126 CycleSlots: 활성 기동기에 진행 회차가 없으면 마지막 회차 자리를 남기고, 기동기가 쉬면 버림', () => {
  const nodes = loop();
  const nodeOf = (id) => nodes.get(id) || null;
  const P = { c1: { x: -18, z: 16 }, c2: { x: -18.5, z: 16.4 } };
  const ptOf = (id) => (P[id] ? { p: P[id], r: 2 } : null);
  const s = new CycleSlots();
  assert.equal(isCycleNode(nodes.get('c1')), true);
  assert.deepEqual(s.step([['L', true], ['r', true], ['c1', true]], nodeOf, ptOf), [], '회차가 돌면 더할 것 없음');
  const gap = s.step([['L', true], ['r', true], ['c1', false]], nodeOf, ptOf);
  assert.equal(gap.length, 1); assert.deepEqual(gap[0].p, { x: -18, y: 0, z: 16 }, '회차 사이 = 마지막 회차 자리');
  assert.deepEqual(s.step([['L', true], ['r', true], ['c1', false], ['c2', true]], nodeOf, ptOf), [], '다음 회차가 뜨면 그 노드가 대신');
  assert.equal(s.step([['L', true], ['c2', false]], nodeOf, ptOf).length, 1);
  assert.deepEqual(s.step([['L', false], ['c2', false]], nodeOf, ptOf), [], '기동기가 쉬면 버림');
  assert.deepEqual(s.step([['L', true], ['c2', false]], nodeOf, ptOf), [], '버린 뒤 다시 활성이어도 회차가 돌기 전엔 없음');
});

test('§126 회차 사이 간격 동안 구도가 들어갔다 나오지 않음(FitHold, 2D 맞춤)', () => {
  const nodes = loop(); nodes.delete('c2');
  const { pos } = computeLayout(nodes, 'm');
  const A = 16 / 9, mh = 1 - FIT.M, mv = (1 - FIT.M) * 0.85;
  const pt = (id) => ({ p: pos.get(id), r: nodeExtent(nodes.get(id)) * FIT.NODE_K + FIT.NODE_PAD });
  const run = (withSlots, gap) => {
    const h = new FitHold(), s = new CycleSlots(), commits = [];
    for (let t = 0; t < 40; t += 0.05) {
      const inGap = t >= 5 && t < 5 + gap;
      const list = [['m', false], ['sa', false], ['L', true], ['r', true], ['c1', !inGap]];
      const pts = list.filter((x) => x[1]).map((x) => pt(x[0]));
      if (withSlots) for (const q of s.step(list, (id) => nodes.get(id), (id) => pt(id))) pts.push(q);
      const w = refineFit2D(pts, boxCenterXZ(pts), A, mh, mv, 3, true);
      const before = h.changes;
      h.step(t, w, h.c ? fitNeed(pts, h.c, A, mh, mv) : Infinity, 1, 1e9);
      if (h.changes !== before) commits.push(+t.toFixed(2));
    }
    return commits;
  };
  for (const gap of [3, 8, 20]) {
    const old = run(false, gap);
    assert.equal(old.length, 3, `대조(수리 전): 처음 + 회차 끝 2초 뒤 다가감 + 다음 회차에 물러남 (간격 ${gap}초: ${old})`);
    assert.deepEqual(run(true, gap), [0], `회차 사이에도 그대로(간격 ${gap}초)`);
  }
});

test('§126 기동기 자리: 기동기보다 먼저 생긴 형제가 퇴장해도 기동기·러너·회차 자리는 그대로', () => {
  const a = loop(); const b = loop(); b.delete('sa');
  const pa = computeLayout(a, 'm').pos, pb = computeLayout(b, 'm').pos;
  for (const id of ['L', 'r', 'c1']) {
    const p = pa.get(id), q = pb.get(id);
    assert.ok(Math.hypot(p.x - q.x, p.z - q.z) < 1e-9, `${id} 자리 그대로`);
  }
});
