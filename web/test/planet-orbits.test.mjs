// Planet 본체 축소 · 궤도계 · 서브에이전트 유형 규칙(～)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BODY_K, bodyK, hash01, SUB_TYPES, subType, ORBIT, orbitLod, ORBIT_LOD, orbitSpec, orbitPoint, keplerRate, ringPattern, settleK, SETTLE_S } from '../planet-core.mjs';

test('본체 축소 배율은 0.6～0.8, 장치는 device 값', () => {
  for (const k of Object.keys(BODY_K)) assert.ok(BODY_K[k] >= 0.6 && BODY_K[k] <= 0.8, k);
  assert.equal(bodyK('bash-bg', true), BODY_K.device);
  assert.equal(bodyK('unknown'), BODY_K.subagent);
});

test('hash01·subType 은 결정적이고 유형이 고루 나온다', () => {
  assert.equal(hash01('a', 's'), hash01('a', 's'));
  assert.notEqual(hash01('a', 's'), hash01('a', 't'));
  for (let i = 0; i < 50; i++) { const h = hash01('id' + i); assert.ok(h >= 0 && h < 1); }
  assert.equal(subType('agent-x'), subType('agent-x'));
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(subType('sub-' + i));
  assert.equal(seen.size, SUB_TYPES.length);
});

test('궤도 활동 세기: 도구 > 생각 > 대기 > 완료', () => {
  for (const key of ['speed', 'bright']) assert.ok(ORBIT.tool[key] > ORBIT.think[key] && ORBIT.think[key] > ORBIT.wait[key] && ORBIT.wait[key] > ORBIT.off[key]);
  assert.ok(ORBIT.tool.emit > 0 && ORBIT.think.emit === 0);
});

test('궤도 LOD 단계', () => {
  assert.equal(orbitLod(NaN), 0);
  assert.equal(orbitLod(ORBIT_LOD.ONE_PX - 0.1), 0);
  assert.equal(orbitLod(ORBIT_LOD.ONE_PX), 1);
  assert.equal(orbitLod(ORBIT_LOD.MOST_PX), 2);
  assert.equal(orbitLod(ORBIT_LOD.ALL_PX), 3);
});

test('궤도계 구성: 메인이 가장 풍성, 종류마다 1개 이상, 같은 종류도 시드로 다름', () => {
  const m = orbitSpec('main', 'm1');
  assert.ok(m.rings.length >= 3 && m.belt && m.belt.n > 100);
  for (const k of ['subagent', 'claude-p', 'workflow-agent', 'workflow', 'bash-bg', 'monitor', 'device']) {
    const s = orbitSpec(k, k + '1');
    assert.ok(s.rings.length >= 1, k);
    assert.ok(s.rings.length <= m.rings.length + 2, k);
    assert.ok(s.extent > 1 && s.extent <= m.extent, k);
    for (const r of s.rings) { assert.ok(r.e >= 0 && r.e < 0.9); assert.ok(['solid', 'dash', 'dots', 'arcs'].includes(r.style)); assert.ok(r.rings === undefined); }
  }
  const a = orbitSpec('claude-p', 'p1').rings[0], b = orbitSpec('claude-p', 'p2').rings[0];
  assert.ok(a.inc !== b.inc || a.node !== b.node);
  assert.deepEqual(orbitSpec('subagent', 'z9'), orbitSpec('subagent', 'z9'));
  for (const t of SUB_TYPES) { const s = orbitSpec('subagent', 'q', { type: t }); assert.equal(s.type, t); assert.ok(s.rings.length >= 1); }
});

test('궤도 위 점·케플러 속도·무늬·정리 연출', () => {
  const p = orbitPoint(2, 0.5, 0); assert.ok(Math.abs(p.r - 1) < 1e-9); // 근점 a(1-e)
  const q = orbitPoint(2, 0.5, Math.PI); assert.ok(Math.abs(q.r - 3) < 1e-9); // 원점 a(1+e)
  assert.ok(keplerRate(0.5, 0) > keplerRate(0.5, Math.PI));
  assert.equal(keplerRate(0, 1), 1);
  let on = 0; for (let i = 0; i < 480; i++) on += ringPattern('dash', i / 480); assert.ok(on > 200 && on < 320);
  assert.equal(ringPattern('solid', 0.3), 1);
  assert.equal(settleK(-1), 0); assert.equal(settleK(SETTLE_S), 0); assert.ok(settleK(SETTLE_S * 0.3) > 0.3);
});
