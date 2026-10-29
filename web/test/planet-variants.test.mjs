// Planet 서브에이전트·claude -p 시안 배정·규칙(순수) + 3D·2D 배선 대조
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SUB_VARIANTS, CP_VARIANTS, VARIANT_CORE, VARIANT_EXTENT, VARIANT_SKIN, variantFamily, pickVariant, variantPerm, variantOfVis,
  VAR_STATE, variantMode, variantLod, VAR_LOD, cassetteModel, CASSETTE_N, SUB_TYPES,
} from '../planet-core.mjs';

const sibs = (ids, kind = 'subagent', t0 = 1000) => ids.map((id, i) => ({ id, kind, startMs: t0 + i * 10 }));

test('시안 목록: 서브 6종(자기권 없음) · claude -p 4종(떠돌이 탐사선 없음), 묶음 판정', () => {
  assert.deepEqual(SUB_VARIANTS, ['belt', 'crystal', 'drones', 'station', 'solar', 'arcs']);
  assert.deepEqual(CP_VARIANTS, ['pocket', 'capsule', 'wormhole', 'cassette']);
  assert.ok(!SUB_VARIANTS.includes('magneto') && !CP_VARIANTS.includes('rogue'));
  assert.equal(variantFamily('subagent'), 'sub');
  assert.equal(variantFamily('claude-p'), 'cp');
  for (const k of ['main', 'workflow', 'workflow-agent', 'bash-bg', 'monitor']) assert.equal(variantFamily(k), null);
  assert.equal(pickVariant('x', 'main', 'p', 0, []), null);
});

test('본체 축소 0.26～0.45 · 궤도계 바깥 2.0～2.6(지금과 비슷) · 서브 질감은 예전 유형 중에서', () => {
  for (const v of [...SUB_VARIANTS, ...CP_VARIANTS]) {
    assert.ok(VARIANT_CORE[v] >= 0.26 && VARIANT_CORE[v] <= 0.45, v);
    assert.ok(VARIANT_EXTENT[v] >= 2.0 && VARIANT_EXTENT[v] <= 2.6, v);
  }
  for (const v of SUB_VARIANTS) assert.ok(SUB_TYPES.includes(VARIANT_SKIN[v]), v);
});

test('배정은 결정적: 같은 노드·형제면 같은 시안(형제 목록 순서와 무관)', () => {
  const S = sibs(['a1', 'a2', 'a3', 'a4']);
  const one = S.map((s) => pickVariant(s.id, 'subagent', 'P', s.startMs, S));
  const two = S.map((s) => pickVariant(s.id, 'subagent', 'P', s.startMs, [...S].reverse()));
  assert.deepEqual(one, two);
  assert.deepEqual(variantPerm('sub', 'P'), variantPerm('sub', 'P'));
  assert.deepEqual([...variantPerm('cp', 'Q')].sort(), [...CP_VARIANTS].sort());
  // 부모 없는 독립 claude -p 루트: id 해시
  assert.equal(pickVariant('root-1', 'claude-p', null, 5), pickVariant('root-1', 'claude-p', null, 99));
  assert.ok(CP_VARIANTS.includes(pickVariant('root-1', 'claude-p', null, 5)));
});

test('형제 회피: 같은 부모 아래 서브 6·claude -p 4 까지는 겹치지 않음, 묶음끼리는 따로 셈', () => {
  for (let p = 0; p < 50; p++) {
    const S = sibs(['s0', 's1', 's2', 's3', 's4', 's5'].map((x) => x + p));
    const got = S.map((s) => pickVariant(s.id, 'subagent', 'par' + p, s.startMs, S));
    assert.equal(new Set(got).size, 6, 'sub ' + p);
    const C = sibs(['c0', 'c1', 'c2', 'c3'].map((x) => x + p), 'claude-p');
    const all = [...S, ...C];
    const gc = C.map((s) => pickVariant(s.id, 'claude-p', 'par' + p, s.startMs, all));
    assert.equal(new Set(gc).size, 4, 'cp ' + p);
  }
  // 나중에 온 형제는 앞 형제의 시안을 바꾸지 않는다(시작 순 순번)
  const S = sibs(['x', 'y']);
  const before = pickVariant('x', 'subagent', 'P', S[0].startMs, S.slice(0, 1));
  assert.equal(pickVariant('x', 'subagent', 'P', S[0].startMs, S), before);
});

test('분포: 여러 부모의 첫 자식 시안이 고루(각 시안 기대치의 ±40% 안)', () => {
  const N = 1200;
  for (const [kind, L] of [['subagent', SUB_VARIANTS], ['claude-p', CP_VARIANTS]]) {
    const cnt = Object.fromEntries(L.map((x) => [x, 0]));
    for (let i = 0; i < N; i++) cnt[pickVariant('c' + i, kind, 'parent-' + i, 0, [])]++;
    for (const x of L) assert.ok(Math.abs(cnt[x] - N / L.length) < (N / L.length) * 0.4, `${kind} ${x} ${cnt[x]}`);
  }
});

test('메모: 한 페이지 안에서 처음 정한 시안 고정 — 3D·2D 가 같은 표', () => {
  const v = { id: 'memo-node-1', kind: 'subagent', node: { parentId: 'PP', startedAt: '2026-10-28T00:00:01Z' } };
  let calls = 0;
  const a = variantOfVis(v, () => { calls++; return [{ id: 'memo-node-1', kind: 'subagent', startMs: 1 }]; });
  const b = variantOfVis(v, () => { calls++; return [{ id: 'zz', kind: 'subagent', startMs: 0 }]; });
  assert.equal(a, b); assert.equal(calls, 1);
  assert.equal(variantOfVis({ id: 'm2', kind: 'main', node: {} }, () => []), null);
});

test('상태: 작업 > 생각 > 대기 > 완료 순 속도·밝기, 완료 = 정리 자세, 중지 = 멈춤, 오류 = 붉은 맥동 · LOD 문턱', () => {
  assert.ok(VAR_STATE.tool.spd > VAR_STATE.think.spd && VAR_STATE.think.spd > VAR_STATE.wait.spd && VAR_STATE.wait.spd > VAR_STATE.off.spd);
  assert.ok(VAR_STATE.tool.bright > VAR_STATE.wait.bright);
  assert.equal(VAR_STATE.off.tidy, 1); assert.equal(VAR_STATE.error.err, 1); assert.equal(VAR_STATE.tool.act, 1);
  assert.equal(variantMode('stopped'), 'stop'); assert.equal(variantMode('done'), 'off'); assert.equal(variantMode('active', 2), 'tool');
  assert.equal(variantMode('active', 0), 'think'); assert.equal(variantMode('error'), 'error'); assert.equal(variantMode('idle'), 'wait');
  assert.equal(variantLod(0), 0); assert.equal(variantLod(VAR_LOD.ONE_PX), 1); assert.equal(variantLod(VAR_LOD.MOST_PX), 2); assert.equal(variantLod(VAR_LOD.ALL_PX + 1), 3);
});

test('회차 카세트 = 그 노드 자신의 도구 호출(끝 1 · 실패 2 · 지금 3 · 빈 틀 0)', () => {
  const m = cassetteModel([{ res: 'ok' }, { res: 'error' }, { res: null }], 1, 3);
  assert.equal(m.cur, 2); assert.deepEqual(m.cards.slice(0, 3), [1, 2, 3]); assert.equal(m.cards.length, CASSETTE_N);
  const idle = cassetteModel([{ res: 'ok' }], 0, 9);
  assert.equal(idle.cur, 1); assert.equal(idle.cards[0], 1); assert.equal(idle.cards[1], 0);
  assert.deepEqual(cassetteModel([], 0, 0).cards, new Array(CASSETTE_N).fill(0));
});

test('배선: 3D(planet-deco)·2D(planet-orbits2d)가 같은 variantOfVis·형제 시작 시각으로 고르고, 시안 부품은 장면 공용 인스턴싱', () => {
  const deco = readFileSync(new URL('../planet-deco.js', import.meta.url), 'utf8');
  const o2 = readFileSync(new URL('../flat/planet-orbits2d.js', import.meta.url), 'utf8');
  const pv = readFileSync(new URL('../planet-variants.js', import.meta.url), 'utf8');
  for (const src of [deco, o2]) {
    assert.match(src, /variantOfVis\(v, \(\) =>/);
    assert.match(src, /w\.node\.parentId === pid\) out\.push\(\{ id: w\.id, kind: w\.kind, startMs: Date\.parse\(w\.node\.startedAt\) \}\)/);
  }
  assert.match(pv, /new THREE\.InstancedMesh\(g, mat, 1\)/);
  assert.doesNotMatch(pv.split('export function stepVariant')[1], /new THREE\.(Mesh|MeshStandardMaterial|ShaderMaterial)\(/); // 프레임마다 메시·재질을 만들지 않음
  const p2 = readFileSync(new URL('../flat/planet2d.js', import.meta.url), 'utf8');
  assert.match(p2, /drawVariant2D\(this, ctx, v, vn, x, y, R, alpha, now, col, 0\)/);
});
