// 추론 effort — Planet 3D·2D 규칙(서브 케이지 호 수 · max 안쪽 케이지 · claude -p·워크플로 에이전트 보석 고리)과 배선
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOURB_EFF as TE, TOURB_EFF_NONE, tourbEffort, cageArcAngle, cageArcAlpha, gemAngle, gemAlpha, effortGlint, TOURB_GEO } from '../tourbillon-core.mjs';
import { EFFORT, effortGlyph } from '../effort-core.mjs';

const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const node = (kind, effort, effortReq) => ({ id: 'a:x', kind, meta: { ...(effort ? { effort } : {}), ...(effortReq ? { effortReq } : {}) } });
const look = (n, lod = 2) => tourbEffort(effortGlyph(n), lod, EFFORT.ARCS);

test('서브 케이지 호 수 = 2·3·4·6(xhigh·max 같음), 미상·대상 아님·LOD 0 = 지금 3, 맨 위 확정만 안쪽 케이지', () => {
  const names = ['low', 'medium', 'high', 'xhigh', 'max'];
  assert.deepEqual(names.map((v) => look(node('subagent', v)).arcs), [2, 3, 4, 6, 6]);
  assert.deepEqual(look(node('subagent', 'xhigh')), look(node('subagent', 'max')), 'xhigh = max');
  assert.ok(Math.max(...EFFORT.ARCS) <= TE.ARC_MAX);
  assert.equal(look(node('subagent', 'medium')).arcs, TE.ARC_BASE, 'medium = 지금 모습');
  assert.deepEqual(look(node('subagent', null)), TOURB_EFF_NONE, '미상');
  assert.deepEqual(look(node('subagent', 'ultra')), TOURB_EFF_NONE, '모르는 단계 이름');
  assert.deepEqual(look(node('main', 'max')), TOURB_EFF_NONE, '메인은 무늬 없음(결정 ①)');
  assert.deepEqual(look(node('subagent', 'max'), 0), TOURB_EFF_NONE, 'LOD 0');
  assert.equal(look(node('subagent', 'max')).inner, 1);
  assert.equal(look(node('subagent', 'xhigh')).inner, 1);
  assert.equal(look(node('subagent', 'high')).inner, 0);
  assert.equal(look(node('subagent', 'max'), 1).inner, 0, 'LOD 1 은 닫힘 생략');
  assert.equal(look(node('subagent', 'max'), 1).arcs, 6, 'LOD 1 도 확정 호는 그림');
  assert.ok(TE.INNER_R > 1 && TE.INNER_R < TOURB_GEO.SUB_R, '안쪽 고리는 작은 본체(1)와 바깥 테 사이');
});

test('요청 상태: 늘어날(빠질) 호는 40% 투명, 안쪽 케이지 40%, 보석은 받침만 · LOD 1 이면 지금 모습', () => {
  const h = look(node('subagent', null, 'high'));
  assert.equal(h.arcs, 4); assert.equal(h.lo, 3); assert.equal(h.hollow, 1);
  assert.deepEqual([0, 1, 2, 3].map((i) => cageArcAlpha(i, h.arcs, h.lo)), [1, 1, 1, TE.HOLLOW_A]);
  const hx = look(node('subagent', null, 'xhigh'));
  assert.deepEqual([hx.arcs, hx.lo, hx.inner], [6, 3, TE.HOLLOW_A], '요청 xhigh = 요청 max');
  const l = look(node('subagent', null, 'low'));
  assert.equal(l.arcs, 3, '요청 low: 빠질 셋째 호를 남겨'); assert.equal(l.lo, 2);
  assert.equal(cageArcAlpha(2, l.arcs, l.lo), TE.HOLLOW_A);
  assert.equal(look(node('subagent', null, 'max')).inner, TE.HOLLOW_A);
  assert.deepEqual(look(node('subagent', null, 'high'), 1), TOURB_EFF_NONE);
  const c = look(node('subagent', 'high', 'high'));
  assert.equal(c.lo, TE.ARC_MAX, '확정이면 투명 호 없음'); assert.equal(c.hollow, 0);
});

test('호 각 360°/c · 보간 중 소수 c 에서 새 호가 차오름', () => {
  assert.deepEqual([0, 1, 2].map((i) => +cageArcAngle(i, 3).toFixed(6)), [0, +(2 * Math.PI / 3).toFixed(6), +(4 * Math.PI / 3).toFixed(6)], 'c = 3 이면 지금 120° 배치');
  assert.ok(Math.abs(cageArcAngle(3, 4) - 1.5 * Math.PI) < 1e-9);
  assert.equal(cageArcAlpha(3, 3), 0); assert.equal(cageArcAlpha(3, 3.5), 0.5); assert.equal(cageArcAlpha(3, 4), 1);
  assert.equal(cageArcAlpha(5, 6), 1); assert.equal(cageArcAlpha(0, 2), 1);
});

test('보석 고리: claude -p·워크플로 에이전트 보석 수 = 단계(1～4), 정면 가운데 40° 간격, 맨 위 확정 = 고리 잉크', () => {
  assert.equal(TE.GEM_N, 4);
  for (const kind of ['claude-p', 'workflow-agent']) {
    assert.ok(TE.GEM_RING[kind] > 0, kind);
    assert.deepEqual(['low', 'medium', 'high', 'xhigh', 'max'].map((v) => look(node(kind, v)).gems), [1, 2, 3, 4, 4], kind);
    assert.deepEqual(look(node(kind, 'xhigh')), look(node(kind, 'max')), kind + ' xhigh = max');
    assert.equal(look(node(kind, 'max')).ring, 1); assert.equal(look(node(kind, 'xhigh')).ring, 1); assert.equal(look(node(kind, 'high')).ring, 0.5);
    assert.equal(look(node(kind, 'max'), 1).ring, 0, 'LOD 1 고리(빈 자리·닫힘) 생략');
    assert.equal(look(node(kind, null, 'high')).hollow, 1);
  }
  assert.equal(gemAngle(0, 1), 0, '한 알 = 정면');
  assert.ok(Math.abs(gemAngle(0, 4) + Math.PI / 3) < 1e-9 && Math.abs(gemAngle(3, 4) - Math.PI / 3) < 1e-9, '네 알 = 앞쪽 120°');
  assert.equal(gemAlpha(2, 2.5), 0.5); assert.equal(gemAlpha(0, 0), 0);
});

test('max 반짝임: 주기마다 GLINT_LEN 동안만 0→1, 그 밖 −1', () => {
  const P = EFFORT.GLINT_MS;
  assert.equal(effortGlint(0, 0, P), 0);
  assert.ok(Math.abs(effortGlint(P * TE.GLINT_LEN * 0.5, 0, P) - 0.5) < 1e-9);
  assert.equal(effortGlint(P * 0.5, 0, P), -1);
  assert.equal(effortGlint(P * 3, 0, P), 0, '되풀이');
  assert.equal(effortGlint(100, 0.5, 0), -1);
});

test('배선: 3D 케이지(aArc·aEff 셰이더, put 에 effort)·보석 고리 InstancedMesh, 2D 살 수·보석, 공용 effort-core 만 사용', () => {
  const tb = src('planet-tourb.js'), deco = src('planet-deco.js'), d2 = src('flat/planet-deco2d.js'), p2 = src('flat/planet2d.js');
  assert.match(tb, /merge\(subParts, true, \['aArc'\]\)/);
  assert.match(tb, /attribute float aArc; attribute vec4 aEff;/);
  assert.match(tb, /export class EffortGems/);
  assert.match(tb, /from '\.\/effort-core\.mjs'/);
  assert.equal((deco.match(/this\.cages\.put\([^;]*this\._effCage\(/g) || []).length, 2, '서브 케이지 두 곳(시안·예전 유형) 모두 effort');
  assert.match(deco, /new EffortGems\(view\.scene, 256, view\.renderer\)/);
  assert.match(deco, /d\.fam === 'cp'\) this\._effGems\(/);
  assert.match(deco, /'workflow-agent'\) this\._effGems\(/);
  assert.match(deco, /effortInstant\(\{ reduced, rate: view\.timeScale/);
  assert.match(d2, /cageArcAlpha\(i, ef\.arcs, ef\.lo\)/);
  assert.match(d2, /export function drawEffortGems2D/);
  assert.match(p2, /if \(v\.kind === 'subagent'\) drawTourb2D\(this, ctx, v, x, y, R \* \(VARIANT_CORE\[vn\]/);
  assert.match(p2, /drawEffortGems2D\(this, ctx, v, x, y, R \* TOURB_EFF\.GEM_RING/);
  for (const s of [deco, d2]) assert.match(s, /effortGlyph\(v\.node\)/, '단계 해석은 effort-core(effortGlyph) 하나로');
});
