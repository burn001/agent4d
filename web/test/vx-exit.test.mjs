// 복셀 오피스도 같은 퇴장 규칙 — '완료 표시' 끔이면 문제 있게 끝난 직원·기계는 문턱 동안 자리에 남고, 일하는 하위가 있으면 남는다.
// 판정은 흐름·평면과 같은 exitEligible(vxHeldEnded), 직원 상태 머신은 ctx.held 로 문 퇴장을 미룬다. 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeOffice } from '../voxel/layout.js';
import { Character } from '../voxel/character-core.mjs';
import { vxHeldEnded, exitEligible, EXIT_ERR } from '../flow-core.mjs';

const T0 = Date.parse('2026-10-28T12:00:00Z');
const iso = (sec) => new Date(T0 + sec * 1000).toISOString();

const tree = () => new Map([
  ['s:m', { id: 's:m', parentId: null, kind: 'main', status: 'active', meta: {} }],
  ['a:err', { id: 'a:err', parentId: 's:m', kind: 'subagent', status: 'error', endedAt: iso(0), meta: {} }],
  ['a:err2', { id: 'a:err2', parentId: 's:m', kind: 'subagent', status: 'error', meta: {} }], // 끝난 시각 없음 → 처음 본 시각부터
  ['a:ok', { id: 'a:ok', parentId: 's:m', kind: 'subagent', status: 'done', endedAt: iso(0), meta: {} }],
  ['a:par', { id: 'a:par', parentId: 's:m', kind: 'subagent', status: 'done', endedAt: iso(0), meta: {} }],
  ['b:kid', { id: 'b:kid', parentId: 'a:par', kind: 'bash-bg', status: 'active', meta: {} }], // 하위가 일함
  ['b:fail', { id: 'b:fail', parentId: 's:m', kind: 'bash-bg', status: 'error', endedAt: iso(0), meta: {} }], // 기계(백그라운드 명령)
]);

test('vxHeldEnded: 문제 있는 끝은 문턱 전 붙잡고 뒤 놓음, 정상 끝은 바로 놓음, 일하는 하위가 있으면 붙잡음 — exitEligible 과 같은 판정', () => {
  const seen = new Map();
  const at = (sec, nodes = tree()) => vxHeldEnded(nodes, ['s:m'], T0 + sec * 1000, seen);
  const h0 = at(0);
  for (const id of ['a:err', 'a:err2', 'b:fail', 'a:par']) assert.ok(h0.has(id), id + ' 붙잡음');
  assert.ok(!h0.has('a:ok'), '정상 끝은 바로 퇴장');
  assert.ok(!h0.has('s:m') && !h0.has('b:kid'), '일하는 노드는 판정 밖');
  assert.equal(seen.get('a:err2'), T0, '끝난 시각 없는 오류는 처음 본 시각을 기억');
  const before = at(EXIT_ERR.LINGER_SEC - 1), after = at(EXIT_ERR.LINGER_SEC);
  for (const id of ['a:err', 'a:err2', 'b:fail']) { assert.ok(before.has(id), id + ' 문턱 전 남음'); assert.ok(!after.has(id), id + ' 문턱 뒤 퇴장'); }
  assert.ok(after.has('a:par'), '하위가 일하는 동안은 문턱과 무관하게 남음');
  // exitEligible 과 정확히 보완: 끝난 노드 = 붙잡음 ∪ 퇴장 대상
  const nodes = tree(), nowMs = T0 + 30000, s2 = new Map([['a:err2', T0]]);
  const held = vxHeldEnded(nodes, ['s:m'], nowMs, s2), elig = exitEligible(nodes, ['s:m'], { nowMs, seen: s2 });
  for (const n of nodes.values()) if (['done', 'error', 'stopped'].includes(n.status)) assert.ok(held.has(n.id) !== elig.has(n.id), n.id);
  // 하위가 끝나면 부모도 놓임
  const n3 = tree(); n3.get('b:kid').status = 'done';
  assert.ok(!vxHeldEnded(n3, ['s:m'], T0 + 1000, new Map()).has('a:par'));
});

test('직원: ctx.held 에 있으면 오류로 끝나도 문으로 나가지 않고 자리(빨강 유지), 빠지면 바로 문으로 — 없으면 예전처럼 2초 뒤 퇴장', () => {
  const nodes = [{ id: 'm', kind: 'main', status: 'active', order: 0 }, { id: 'a0', parentId: 'm', kind: 'subagent', status: 'active', order: 1 }];
  const lay = computeOffice(nodes, 'm');
  const room = lay.rooms[0], seat = lay.seat.get('a0');
  const mk = (held) => {
    const node = { ...nodes[1] };
    const ch = new Character('a0', node);
    let errs = 0;
    const ctx = { now: 0, dt: 0.05, ts: 1, room, seat, held, stationSpot: () => null, releaseStation: () => {}, onError: () => { errs++; } };
    const run = (sec) => { for (let t = 0; t < sec; t += ctx.dt) { ctx.now += ctx.dt; ch.update(ctx); } };
    run(2);
    node.status = 'error';
    return { ch, ctx, run, errs: () => errs };
  };
  // 완료 표시 켬(또는 판정 없음): 예전처럼 나간다
  const a = mk(null); a.run(3);
  assert.ok(a.ch.state === 'leave' || a.ch.state === 'gone', '판정 없으면 2초 뒤 퇴장');
  // 끔 + 문턱 전: 남는다
  const held = new Set(['a0']);
  const b = mk(held); b.run(10);
  assert.ok(b.ch.state !== 'leave' && b.ch.state !== 'gone', '문턱 전에는 자리에 남음');
  assert.equal(b.errs(), 1, '오류 말풍선은 끝날 때 한 번');
  assert.equal(b.ch.node.status, 'error', '오류 표시(빨강)는 노드 상태로 계속');
  held.delete('a0'); b.run(0.2);
  assert.equal(b.ch.state, 'leave', '문턱이 지나면 문으로 걸어 나감');
  // 노드 제거(forceLeave)는 붙잡지 않는다
  const c = mk(new Set(['a0'])); c.ch.forceLeave = true; c.run(0.5);
  assert.ok(c.ch.state === 'leave' || c.ch.state === 'gone');
});

test('복셀 3D·2D 뷰가 같은 판정을 쓴다(소스): vxHeldEnded → ctx.held, 기계 자리 반납도 붙잡음을 따른다', () => {
  for (const f of ['../voxel/office.js', '../flat/voxel2d.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.match(src, /vxHeldEnded\(/, f);
    assert.match(src, /this\._ctx\.held = this\._held/, f);
    assert.match(src, /!this\._held\.has\(m\.id\)/, f + ' 기계');
    assert.match(src, /_badWait\(node\)/, f + ' 스냅샷 첫 배치');
  }
});
