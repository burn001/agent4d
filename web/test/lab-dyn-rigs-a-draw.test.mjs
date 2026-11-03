// node --test "web/test/lab-dyn-rigs-a-draw.test.mjs" 기자재 동작(과제 A) 그리기 연결: 3D drawRig 가 id 마다 RigDyn 을 진행(rigDynOf) ·
// st.ts·reduced·camD 없어도 동작 · 오래 돌던 기자재는 시동 생략 · 5초 안 보인 id 정리 · 2D drawRigs2D 전이·펄스 반환값.
// three 는 Color 만 있는 가짜(브라우저·헤드리스 렌더링 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { LAB } from '../lab/lab-const.mjs';

const THREE_STUB = `export class Color {
  constructor(v = 0, g, b) { if (typeof v === 'string') { this.r = parseInt(v.slice(1, 3), 16) / 255; this.g = parseInt(v.slice(3, 5), 16) / 255; this.b = parseInt(v.slice(5, 7), 16) / 255; } else { this.r = v; this.g = g ?? v; this.b = b ?? v; } }
  clone() { return new Color(this.r, this.g, this.b); }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  multiplyScalar(k) { this.r *= k; this.g *= k; this.b *= k; return this; }
  lerp(c, a) { this.r += (c.r - this.r) * a; this.g += (c.g - this.g) * a; this.b += (c.b - this.b) * a; return this; }
}`;
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return { url: 'data:text/javascript,' + encodeURIComponent(THREE_STUB), shortCircuit: true };
    return next(spec, ctx);
  },
});
const { drawRig, rigDynOf } = await import('../lab/lab-rigs.js');
const { drawRigs2D } = await import('../flat/lab2d-rigs.js');

const NOW = 2_000_000_000, PAL = { isLight: false };
function fakeB() {
  let n = 0;
  const mk = () => ({ box() { n++; } });
  return { B: { lit: mk(), glow: mk() }, count: () => n };
}
const pos = { x: 0, y: 0, z: 0, type: 'rig', face: 0.3, rigKind: 'reactor' };

test('3D drawRig: id 마다 RigDyn(rigDynOf) · 출력 펄스 → act · 전이 · 선택 필드 없이도 동작', () => {
  const node = { id: 'n1', kind: 'bash-bg', status: 'active', startedAt: NOW - 500, meta: {} };
  const st = { id: 'n1', t: 100, seed: 0.3, appear: 1, flash: 0 };
  drawRig(pos, st, PAL, {}, fakeB().B, node, NOW);
  const d = rigDynOf('n1');
  assert.ok(d, 'rigDynOf');
  assert.equal(d.trans, 'on', '방금 띄운 기자재 = 시동');
  for (let i = 1; i <= 120; i++) { st.t = 100 + i / 60; st.flash = i % 20 === 0 ? 1 : Math.max(0, st.flash - 0.05); drawRig(pos, st, PAL, {}, fakeB().B, node, NOW + i * 16); }
  assert.ok(d.pulses >= 5 && d.act > 0.3, `펄스 ${d.pulses} act ${d.act.toFixed(2)}`);
  assert.ok(d.ph > 0, '위상 진행');
  const done = { ...node, status: 'done', endedAt: NOW + 2000 };
  st.t += 1 / 60; drawRig(pos, st, PAL, {}, fakeB().B, done, NOW + 2100);
  assert.equal(d.trans, 'done');
  assert.equal(rigDynOf('없음'), null);
  // id 없으면 예전처럼(dyn 없음)
  const f = fakeB(); assert.ok(drawRig(pos, { t: 1, seed: 0, flash: 0 }, PAL, {}, f.B, node, NOW) > 0);
});

test('3D drawRig: 오래 돌던 기자재는 처음 보일 때 시동 생략 · 중경(camD > 60)은 입자 생략 · ts·reduced 반영', () => {
  const old = { id: 'n2', kind: 'bash-bg', status: 'active', startedAt: new Date(NOW - 3_600_000).toISOString(), meta: {} };
  drawRig(pos, { id: 'n2', t: 200, seed: 0, flash: 0 }, PAL, {}, fakeB().B, old, NOW);
  assert.equal(rigDynOf('n2').trans, null, '시동 생략');
  // 반응로 연기: 근경 > 중경
  const near = fakeB(), mid = fakeB();
  drawRig(pos, { id: 'n2', t: 200.1, seed: 0, flash: 0 }, PAL, {}, near.B, old, NOW);
  drawRig(pos, { id: 'n2', t: 200.2, seed: 0, flash: 0, camD: 90 }, PAL, {}, mid.B, old, NOW);
  assert.ok(mid.count() < near.count(), `중경 ${mid.count()} < 근경 ${near.count()}`);
  // 움직임 줄이기: 위상 고정
  const ph = rigDynOf('n2').ph;
  for (let i = 0; i < 30; i++) drawRig(pos, { id: 'n2', t: 200.3 + i / 60, seed: 0, flash: 0, reduced: true }, PAL, {}, fakeB().B, old, NOW);
  assert.equal(rigDynOf('n2').ph, ph);
  assert.equal(rigDynOf('n2').ts, 1);
  drawRig(pos, { id: 'n2', t: 201, seed: 0, flash: 0, ts: 16 }, PAL, {}, fakeB().B, old, NOW);
  assert.equal(rigDynOf('n2').ts, 16);
});

test('3D drawRig: 5초 넘게 그리지 않은 id 는 2초마다 정리', () => {
  const node = { id: 'g1', kind: 'bash-bg', status: 'active', meta: {} };
  drawRig(pos, { id: 'g1', t: 300, seed: 0, flash: 0 }, PAL, {}, fakeB().B, node, NOW);
  assert.ok(rigDynOf('g1'));
  drawRig(pos, { id: 'g2', t: 303, seed: 0, flash: 0 }, PAL, {}, fakeB().B, node, NOW);
  assert.ok(rigDynOf('g1'), '3초 = 남음');
  drawRig(pos, { id: 'g2', t: 306, seed: 0, flash: 0 }, PAL, {}, fakeB().B, node, NOW);
  assert.equal(rigDynOf('g1'), null, '6초 = 정리');
  assert.ok(rigDynOf('g2'));
});

// 2D
const CTX_FNS = ['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'arc', 'ellipse', 'rect', 'roundRect', 'fillRect', 'strokeRect', 'fillText', 'save', 'restore'];
function fakeCtx() { const calls = {}, ctx = { calls }; for (const k of CTX_FNS) ctx[k] = () => { calls[k] = (calls[k] || 0) + 1; }; return ctx; }
function fakeView(s = 12) {
  const v = { _s: s, pal: { mat: '#333' }, tokens: { text: '#eee', isLight: false }, _now: 1, reduced: false, vis: new Map(), focusId: null, hoverId: null };
  v._X = (x) => x * s + 400; v._Y = (z) => z * s + 300;
  return v;
}
const rigPos = { type: 'rig', x: 2, z: 1, theta: 30, rigKind: 'tests' };

test('2D drawRigs2D: 기계마다 _rd2 · 끝 전이 동안 true → 끝나면 false · 출력 펄스 · 중지 덮개 · 움직임 줄이기 = 정지', () => {
  const view = fakeView(), m = { id: 'q1', node: { id: 'q1', kind: 'bash-bg', status: 'active', meta: {} }, pos: rigPos, flashUntil: 0 };
  view.vis.set('q1', { drawS: 1 });
  assert.equal(drawRigs2D(fakeCtx(), view, [m], NOW), true, '진행 = 움직임');
  assert.ok(m._rd2 && m._rd2.state === 'run');
  // 출력 펄스: flashUntil 이 새로 잡히면 pulses++
  m.flashUntil = 1.3; view._now = 1.05; drawRigs2D(fakeCtx(), view, [m], NOW);
  assert.equal(m._rd2.pulses, 1);
  // 끝 → 1.4초 동안 true, 그 뒤 false
  m.node = { ...m.node, status: 'done' };
  view._now = 2; assert.equal(drawRigs2D(fakeCtx(), view, [m], NOW), true, '끝 전이 중');
  assert.equal(m._rd2.trans, 'done');
  view._now = 3; assert.equal(drawRigs2D(fakeCtx(), view, [m], NOW), true);
  view._now = 3.6; assert.equal(drawRigs2D(fakeCtx(), view, [m], NOW), false, '전이 뒤 정지');
  // 중지 전이: 덮개(fillRect)
  const s = { id: 'q2', node: { id: 'q2', kind: 'bash-bg', status: 'active', meta: {} }, pos: rigPos, flashUntil: 0 };
  view.vis.set('q2', { drawS: 1 });
  view._now = 5; drawRigs2D(fakeCtx(), view, [s], NOW);
  s.node = { ...s.node, status: 'stopped' };
  const c = fakeCtx(); view._now = 5.2; assert.equal(drawRigs2D(c, view, [s], NOW), true);
  assert.ok(c.calls.fillRect >= 1, '회색 덮개');
  // 움직임 줄이기: 끝난 기자재는 전이 없이 false
  const r = { id: 'q3', node: { id: 'q3', kind: 'bash-bg', status: 'active', meta: {} }, pos: rigPos, flashUntil: 0 };
  view.vis.set('q3', { drawS: 1 }); view.reduced = true;
  view._now = 7; drawRigs2D(fakeCtx(), view, [r], NOW);
  r.node = { ...r.node, status: 'done' };
  view._now = 7.1; assert.equal(drawRigs2D(fakeCtx(), view, [r], NOW), false, '움직임 줄이기 = 정지');
  assert.equal(r._rd2.ph, 0);
  assert.ok(LAB.RIG.SIZE > 0);
});
