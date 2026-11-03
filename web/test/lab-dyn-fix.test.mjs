// node --test "web/test/lab-dyn-fix.test.mjs" 리뷰 수리: 2D reset 이 운반 캡슐·보고·생성 대기를 비움 · 들여다보기 렌즈 +30% 는
// 그리기만(가짜 출력 펄스 없음) · LabView.reset → clearRigDyn(되감기 뒤 사건 없는 전이 없음) · mock bg 산출 fire 는 tu 당 한 번.
// three 는 Color 만 있는 가짜(브라우저·헤드리스 렌더링 없음).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(path.join(WEB, p), 'utf8');
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
const { drawRig, rigDynOf, clearRigDyn } = await import('../lab/lab-rigs.js');
const { Lab2DView } = await import('../flat/lab2d.js');
const { LabCouriers } = await import('../lab/lab-ix-core.mjs');
const { LabMockDriver } = await import('../lab/lab-mock.mjs');

const NOW = 2_000_000_000, PAL = { isLight: false };
const fakeB = () => { const mk = () => ({ box() {} }); return { lit: mk(), glow: mk() }; };
const pos = { x: 0, y: 0, z: 0, type: 'rig', face: 0.3, rigKind: 'meter' };

test('2D Lab2DView.reset: 비행 중 캡슐 · 보고 표시 · 생성 대기를 비움(3D LabView.reset 과 같이)', () => {
  const v = Object.create(Lab2DView.prototype);
  v._cour = new LabCouriers(8); v._pendDisp = [{ id: 's1', at: 1 }]; v._repAt = new Map([['s1', 1]]); v._rigAt2 = 3; v._courAt = 3;
  v._cour.add('report', 0, 1, 0, 3, 1, 3, 1, 1.2, '#fff', 1);
  assert.equal(v._cour.n, 1);
  const base = Object.getPrototypeOf(Lab2DView.prototype), was = base.reset;
  let called = 0;
  base.reset = function () { called++; }; // 바탕(Voxel2DView·FlatView) reset 은 화면 상태라 여기서는 건너뜀
  try { v.reset(); } finally { base.reset = was; }
  assert.equal(called, 1, 'super.reset');
  assert.equal(v._pendDisp.length, 0); assert.equal(v._repAt.size, 0);
  assert.equal(v._rigAt2, -1); assert.equal(v._courAt, -1);
  assert.equal(v._cour.n, 0, '비행 중 캡슐 없음');
  assert.ok(src('flat/lab2d.js').includes('reset() {\n    super.reset();\n    if (this._cour) { this._cour.clear();'), '원문 연결');
});

test('3D 들여다보기(st.watch): 렌즈 밝기만 — rigDynStep 출력 펄스·act 오르지 않음, 실제 flash 상승은 그대로 펄스', () => {
  clearRigDyn();
  const node = { id: 'w1', kind: 'bash-bg', status: 'active', startedAt: NOW - 60_000, meta: {} };
  const st = { id: 'w1', t: 100, seed: 0.2, appear: 1, flash: 0, watch: false };
  drawRig(pos, st, PAL, {}, fakeB(), node, NOW);
  const d = rigDynOf('w1'), p0 = d.pulses, a0 = d.act;
  for (let i = 1; i <= 30; i++) { st.t = 100 + i / 60; st.watch = i % 10 < 5; drawRig(pos, st, PAL, {}, fakeB(), node, NOW + i * 16); } // 들여다보기 켬·끔 반복
  assert.equal(d.pulses, p0, '들여다보기만으로 펄스 없음');
  assert.ok(d.act <= a0 + 1e-9, 'act 오르지 않음');
  st.t += 1 / 60; st.flash = 1; drawRig(pos, st, PAL, {}, fakeB(), node, NOW + 600);
  assert.equal(d.pulses, p0 + 1, '실제 출력(flash 상승) = 펄스');
  const lv = src('lab/lab-view.js');
  assert.ok(!/st\.flash = Math\.max\(st\.flash \|\| 0, 0\.3\)/.test(lv), 'lab-view 가 st.flash 를 올리지 않음');
  assert.match(lv, /st\.watch = m\._watchAt === now;/);
});

test('clearRigDyn: 동작 상태를 비우고 LabView.reset 이 부름 → 되감기 뒤 오래 돌던 기자재는 전이 없이 현재 상태', () => {
  const node = { id: 'r1', kind: 'bash-bg', status: 'active', startedAt: NOW - 500, meta: {} };
  const st = { id: 'r1', t: 200, seed: 0.1, appear: 1, flash: 0 };
  drawRig(pos, st, PAL, {}, fakeB(), node, NOW);
  assert.ok(rigDynOf('r1'));
  clearRigDyn();
  assert.equal(rigDynOf('r1'), null);
  // 되감기: 같은 id 가 끝난 상태로 다시 옴(시작은 오래 전) → 'done' 감속 전이 없음
  const n2 = { ...node, status: 'done', endedAt: NOW - 10_000, startedAt: NOW - 60_000 };
  drawRig(pos, { ...st, t: 201 }, PAL, {}, fakeB(), n2, NOW);
  assert.equal(rigDynOf('r1').trans, null, '사건 없는 전이 없음');
  assert.match(src('lab/lab-view.js'), /clearRigDyn\(\); \/\/ 재생 seek/);
});

test('mock bg 산출: 같은 toolUseId 의 tool-start·tool-end 는 한 번씩만(ArtBook tu|id 중복 거름에 안 걸림)', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  try {
    const evs = [];
    const drv = new LabMockDriver({ nodes: () => [], emit: (e) => evs.push(e), scenario: 1 });
    drv.on = true;
    drv._bg('m', 'npm run build -- --watch', { life: 120000, art: [{ id: 'f:dist/bundle.js', k: 'file', v: 'write', n: 'bundle.js' }] });
    mock.timers.tick(30000);
    drv.on = false;
    const starts = new Map(), ends = new Map();
    for (const e of evs) {
      if (e.type === 'tool-start') starts.set(e.toolUseId, (starts.get(e.toolUseId) || 0) + 1);
      if (e.type === 'tool-end') ends.set(e.toolUseId, (ends.get(e.toolUseId) || 0) + 1);
    }
    assert.ok(starts.size >= 1, 'fire 있음');
    for (const [tu, c] of starts) assert.equal(c, 1, 'tool-start 한 번 ' + tu);
    for (const [tu, c] of ends) assert.equal(c, 1, 'tool-end 한 번 ' + tu);
  } finally { mock.timers.reset(); }
});

test('§41.8 git 붙잡기: 3D vx-ix._office 연구소 분기는 2D vx2d-extra.holdPts 와 같은 판정(연구소 코어 github 자리) — 의도된 3D⇄2D 일치', () => {
  assert.match(src('voxel/vx-ix.js'), /if \(room\.type === 'lab'\) return room;/);
  assert.match(src('flat/vx2d-extra.js'), /room\.type === 'office' \|\| room\.type === 'lab'\) \? room/);
});
