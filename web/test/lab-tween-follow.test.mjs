// node --test "web/test/lab-tween-follow.test.mjs"   [T2-lab3d-tween-follow] 복셀 연구소 이슈 3:
// 반지름 보간(rP 9 → 10.5) 동안 시료 카드·기자재 이름표·말풍선·초점 대상이 기자재 몸체와 같은 보간 자리(_tweenPos, 같은 k)를 따른다.
// three 없이 — lab-view.js 원문에서 LabView 메서드를 잘라 가짜 기반 클래스(VoxelView 대역) 위에 그대로 올려 부른다(원문 연결 + 순수 함수 조합).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { radialLerp, RadiusTween } from '../lab/lab-marks-core.mjs';
import { computeLab, labFloorY } from '../lab/lab-layout-core.mjs';
import { LAB, thetaOf, dTheta } from '../lab/lab-const.mjs';
import { navSolid, navSpot, navPathBlocked } from '../voxel/nav-core.mjs';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(WEB, 'lab/lab-view.js'), 'utf8');
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

/** 클래스 본문에서 메서드 하나(두 칸 들여쓰기 `  name(` ~ 짝 맞는 `}`)를 잘라 낸다 */
function method(name) {
  const re = new RegExp('\\n  ' + name.replace(/[$]/g, '\\$') + '\\(');
  const m = re.exec(SRC);
  assert.ok(m, 'lab-view.js 에 메서드 없음: ' + name);
  const s = m.index + 1;
  let i = SRC.indexOf('{', SRC.indexOf(')', s)), d = 0;
  for (; i < SRC.length; i++) { const c = SRC[i]; if (c === '{') d++; else if (c === '}' && --d === 0) break; }
  return SRC.slice(s, i + 1);
}
const NAMES = ['_relayout', '_shownAt', '_startRadiusTween', '_stepRadiusTween', '_isLabRig', '_isLabJob', '_tweenPos', '_drawJob', '_labelPass', '_holoPass', '_twSwapIn', '_twSwapOut', '_posOf', '_syncVis', '_drawSpawnLinks', '_machineRing', '_slideClear', '_replanBlocked', '_onRamp'];

/** VoxelView 대역: office.js 의 해당 동작만(배치 바꾸기 588행 · 이름표 0.2초 캐시 · _posOf · _syncVis) 흉내 */
class FakeVoxelView {
  _relayout() {
    this.layout = this._next;
    this.rooms = this.layout.rooms;
    this.roomsById = new Map(this.rooms.map((r) => [r.id, r]));
    for (const m of this.machines.values()) m.pos = this.layout.machine.get(m.id) || null; // office.js:588
  }
  _drawJob(m) { this.drawn.set(m.id, { x: m.pos.x, z: m.pos.z, y: m.pos.y, owner: m.pos.owner, slot: m.pos.slot }); }
  _labelPass(now) {
    const rebuilt = !(now - (this._lblAt || 0) < 0.2 && this._lblUsed);
    this.lblLog.push(rebuilt);
    if (!rebuilt) return;
    this._lblAt = now; this._lblUsed = true;
    this.puts.clear();
    for (const m of this.machines.values()) {
      if (!m.pos || m.released) continue;
      const b = this._posOf(m.id); // 말풍선도 같은 호출 안에서(겹쳐 보간되면 안 됨)
      this.puts.set(m.id, { x: m.pos.x, z: m.pos.z, bx: b.x, bz: b.z, sameObj: m.pos === this.layout.machine.get(m.id) });
    }
  }
  /** office _holoPass → vx-holo update 의 기동기 대시보드(launcherDash(m.pos)) 흉내: batch 마다 그 순간 m.pos */
  _holoPass() {
    this.dash = new Map();
    for (const m of this.machines.values()) if (m.type === 'batch' && m.pos && !m.released) this.dash.set(m.id, { x: m.pos.x, z: m.pos.z });
  }
  /** office _drawSpawnLinks at() 흉내: 그 순간 m.pos(시퀀서·기자재 끝) */
  _drawSpawnLinks() {
    this.spawnAt = new Map();
    for (const m of this.machines.values()) if (m.pos && !m.released) this.spawnAt.set(m.id, { x: m.pos.x, z: m.pos.z });
  }
  /** office _machineRing(m, G, p = m.pos) 흉내 */
  _machineRing(m, G, p = m.pos) { (this.rings || (this.rings = [])).push({ id: m.id, x: p.x, z: p.z }); }
  _posOf(id) {
    const m = this.machines.get(id), p = this._posTmp || (this._posTmp = {});
    if (!m || !m.pos || m.released) return null;
    p.x = m.pos.x; p.y = m.type === 'job' ? m.pos.y + 0.2 : m.pos.y + 0.6; p.z = m.pos.z;
    return p;
  }
  _syncVis() {
    for (const m of this.machines.values()) {
      if (!m.pos || m.released) continue;
      let v = this.vis.get(m.id);
      if (!v) { v = { target: { x: 0, y: 0, z: 0 } }; this.vis.set(m.id, v); }
      v.target.x = m.pos.x; v.target.y = m.pos.y; v.target.z = m.pos.z;
    }
  }
}
// eslint-disable-next-line no-new-func
const LabLike = new Function('Base', 'radialLerp', 'RadiusTween', 'thetaOf', 'dTheta', 'navSolid', 'LAB_RIG_HALF', 'navSpot', 'navPathBlocked', 'labFloorY', 'LAB',
  `return class LabLike extends Base {\n${NAMES.map(method).join('\n')}\n};`)(FakeVoxelView, radialLerp, RadiusTween, thetaOf, dTheta, navSolid, LAB.RIG.SIZE / 2, navSpot, navPathBlocked, labFloorY, LAB);

const R1 = 10.5; // 새 반지름(9 → 10.5: 기자재·시료 카드·시퀀서의 미끄러질 길이 새 플랫폼·책상 상자에 닿지 않는 폭 — 더 크게 바뀌면 바로 옮김, (10))
const T0 = '2026-11-01T00:00:00Z';
const SEQ = { id: 'L', kind: 'bash-bg', parentId: 'main', status: 'active', order: 3, meta: { launcher: { script: 'r.sh' } } }; // 브리지 뒤 시퀀서(batch + rigKind)
const nodes = (seq = false) => [
  { id: 'main', kind: 'main', status: 'active', order: 0 },
  { id: 'sa', kind: 'subagent', parentId: 'main', status: 'active', order: 1 },
  { id: 'bg1', kind: 'bash-bg', parentId: 'sa', status: 'active', order: 2, meta: { command: 'npm test' } },
  ...[0, 1].map((i) => ({ id: `j:bg1:${i}`, kind: 'bash-bg', parentId: 'bg1', status: 'active', order: 10 + i, meta: { job: { v: 1, id: String(i), title: 'job ' + i, state: 'running', startedAt: new Date(Date.parse(T0) + i * 1000).toISOString(), beatAt: T0 } } })),
  ...(seq ? [SEQ] : []),
];

/** rP 9 배치로 시작한 가짜 LabView → rP R1 으로 다시 배치(보간 시작 시각 0) */
function setup({ reduced = false, seq = false } = {}) {
  const ns = nodes(seq);
  const L9 = computeLab(ns, 'main', null, { rP: 9 }), L13 = computeLab(ns, 'main', L9, { rP: R1 });
  const v = new LabLike();
  Object.assign(v, {
    scope: { mode: 'single' }, layout: L9, rooms: L9.rooms, roomsById: new Map(L9.rooms.map((r) => [r.id, r])),
    machines: new Map(), chars: new Map(), vis: new Map(), drawn: new Map(), puts: new Map(), lblLog: [],
    reduced, ts: 1, _now: 0, _rt: null, _vacant: new Map(), _clearWalks() {},
  });
  for (const [id, p] of L9.machine) v.machines.set(id, { id, type: p.type, pos: p, released: false, node: ns.find((n) => n.id === id) });
  const old = new Map([...L9.machine].map(([id, p]) => [id, { x: p.x, z: p.z }]));
  v._next = L13;
  v._relayout(0);
  return { v, L9, L13, old, lab: L13.rooms[0].lab };
}

test('(0) 배치 전제: rP 9 → 10.5 에서 기자재·시료 카드 자리가 실제로 바뀜 · 카드는 주인 기자재 앞', () => {
  const { L9, L13 } = setup();
  assert.equal(L9.rooms[0].lab.rP, 9); assert.equal(L13.rooms[0].lab.rP, R1);
  const r9 = L9.machine.get('bg1'), r13 = L13.machine.get('bg1');
  assert.equal(r13.type, 'rig');
  assert.ok(Math.hypot(r13.x - r9.x, r13.z - r9.z) > 1, '기자재가 움직임');
  for (const id of ['j:bg1:0', 'j:bg1:1']) { assert.equal(L13.machine.get(id).type, 'job'); assert.equal(L13.machine.get(id).owner, 'bg1'); }
});

test('(1) 보간 k=0.5: 시료 카드 그리는 자리 = radialLerp(옛 카드, 새 카드) · 기자재 몸체와 같이 미끄러짐(±0.15m)', () => {
  const { v, L13, old, lab } = setup();
  assert.ok(v._rt, '보간 시작');
  assert.ok(v._rt.m.has('j:bg1:0') && v._rt.m.has('bg1'), '출발점에 기자재와 카드 모두');
  v._now = 0.6; // RadiusTween 1.2초 · ease(0.5) = 0.5
  assert.ok(near(v._rt.tw.k(0.6), 0.5));
  const rig = v.machines.get('bg1'), body = v._tweenPos(rig);
  const want = radialLerp(old.get('bg1'), L13.machine.get('bg1'), lab.cx, lab.cz, 0.5, {});
  assert.ok(near(body.x, want.x) && near(body.z, want.z), '몸체 = radialLerp');
  assert.equal(body.rigKind, L13.machine.get('bg1').rigKind, '나머지 필드 복사');
  const bx = body.x, bz = body.z;
  for (const id of ['j:bg1:0', 'j:bg1:1']) {
    const m = v.machines.get(id), nw = L13.machine.get(id);
    v._drawJob(m, 0.6, 0, null);
    const d = v.drawn.get(id), w = radialLerp(old.get(id), nw, lab.cx, lab.cz, 0.5, {});
    assert.ok(near(d.x, w.x) && near(d.z, w.z), '카드 = radialLerp(옛, 새, 0.5)');
    assert.ok(near(d.y, nw.y) && d.owner === 'bg1' && d.slot === nw.slot, '높이·주인·칸 = 새 값');
    assert.ok(Math.hypot(d.x - nw.x, d.z - nw.z) > 0.5, '아직 새 자리 아님(보간 중)');
    const dShown = Math.hypot(d.x - bx, d.z - bz), dNew = Math.hypot(nw.x - L13.machine.get('bg1').x, nw.z - L13.machine.get('bg1').z);
    assert.ok(Math.abs(dShown - dNew) <= 0.15, `몸체-카드 거리 ${dShown.toFixed(3)} vs 새 배치 ${dNew.toFixed(3)}`);
    assert.equal(m.pos, nw, '그린 뒤 m.pos = 새 값(같은 객체)');
  }
});

test('(2) _labelPass: 보간 동안 매 프레임 다시 만들고 기자재·카드 x·z = 보간 자리 · 호출 뒤 m.pos 복구 · 끝난 첫 프레임 정착', () => {
  const { v, L13 } = setup();
  for (const t of [0.3, 0.35, 0.6]) { // 0.2초 안에 연달아 불러도 다시 만듦
    v._now = t;
    v._labelPass(t);
    assert.equal(v.lblLog[v.lblLog.length - 1], true, '다시 만듦 @' + t);
    for (const id of ['bg1', 'j:bg1:0', 'j:bg1:1']) {
      const m = v.machines.get(id), P = v.puts.get(id);
      const q = v._tweenPos(m);
      assert.ok(near(P.x, q.x) && near(P.z, q.z), '이름표 자리 = 보간 자리 ' + id);
      assert.ok(near(P.bx, q.x) && near(P.bz, q.z), '같은 호출 안 말풍선도 같은 자리(겹쳐 보간 없음) ' + id);
      assert.equal(P.sameObj, false, '호출 동안은 사본');
      assert.equal(m.pos, L13.machine.get(id), '호출 뒤 m.pos 복구');
    }
  }
  assert.equal(v._twSwap, false);
  // 보간 끝 → _stepRadiusTween 이 rt 를 비운 뒤 첫 프레임: 한 번 더 다시 만들어 새 자리, 그다음은 office 캐시 그대로
  v._now = 1.3; v._stepRadiusTween(1.3);
  assert.equal(v._rt, null);
  v._labelPass(1.3);
  assert.equal(v.lblLog[v.lblLog.length - 1], true, '끝난 첫 프레임 다시 만듦');
  for (const id of ['bg1', 'j:bg1:0']) { const P = v.puts.get(id), nw = L13.machine.get(id); assert.ok(near(P.x, nw.x) && near(P.z, nw.z) && P.sameObj, '새 자리 정착 ' + id); }
  v._labelPass(1.35);
  assert.equal(v.lblLog[v.lblLog.length - 1], false, '그다음은 0.2초 캐시(복셀 오피스와 같은 규칙)');
});

test('(2b) _labelPass 가 던져도 m.pos 는 복구됨(try/finally)', () => {
  const { v, L13 } = setup();
  v._now = 0.6;
  const orig = FakeVoxelView.prototype._labelPass;
  FakeVoxelView.prototype._labelPass = () => { throw new Error('boom'); };
  try { assert.throws(() => v._labelPass(0.6), /boom/); } finally { FakeVoxelView.prototype._labelPass = orig; }
  for (const id of ['bg1', 'j:bg1:0', 'j:bg1:1']) assert.equal(v.machines.get(id).pos, L13.machine.get(id));
  assert.equal(v._twSwap, false);
});

test('(3) _posOf·_syncVis: 보간 중 기자재·카드 = 보간 자리(높이는 새 값)', () => {
  const { v, L13 } = setup();
  v._now = 0.6;
  for (const id of ['bg1', 'j:bg1:0']) {
    const m = v.machines.get(id), q = v._tweenPos(m), qx = q.x, qz = q.z;
    const p = v._posOf(id), nw = L13.machine.get(id);
    assert.ok(near(p.x, qx) && near(p.z, qz), '말풍선 = 보간 자리 ' + id);
    assert.ok(near(p.y, nw.type === 'job' ? nw.y + 0.2 : nw.y + 0.6), '높이 = 새 값');
  }
  v._syncVis(0.6);
  for (const id of ['bg1', 'j:bg1:1']) { const q = v._tweenPos(v.machines.get(id)), t = v.vis.get(id).target; assert.ok(near(t.x, q.x) && near(t.z, q.z), '초점 대상 ' + id); }
  // 원본 m.pos 는 새 값(길찾기·걷기 목표)
  for (const id of ['bg1', 'j:bg1:0']) assert.equal(v.machines.get(id).pos, L13.machine.get(id));
});

test('(4) k=1 또는 rt 없음 → m.pos 그대로(같은 객체)', () => {
  const { v } = setup();
  const m = v.machines.get('j:bg1:0'), r = v.machines.get('bg1');
  v._now = 1.2;
  assert.equal(v._tweenPos(m), m.pos); assert.equal(v._tweenPos(r), r.pos);
  v._now = 0.6; v._rt = null;
  assert.equal(v._tweenPos(m), m.pos);
  v._drawJob(m, 0.6, 0, null);
  assert.ok(near(v.drawn.get(m.id).x, m.pos.x));
  const p = v._posOf('bg1');
  assert.ok(near(p.x, r.pos.x) && near(p.z, r.pos.z));
});

test('(5) 움직임 줄이기 = 보간 없음(rt null) · 같은 반지름으로 다시 배치하면 새 보간 없음', () => {
  const { v } = setup({ reduced: true });
  assert.equal(v._rt, null);
  const s = setup();
  const rt = s.v._rt;
  s.v._next = computeLab(nodes(), 'main', s.L13, { rP: R1 });
  s.v._now = 0.3; s.v._relayout(0.3);
  assert.equal(s.v._rt, rt, '반지름 그대로 = 보간 그대로 이어감');
});

test('(6) 원문 연결: _drawJob·_labelPass·_posOf·_syncVis 덮어쓰기 · fromM 에 시료 카드 · 공용 _tweenPos', () => {
  assert.match(SRC, /\n {2}_drawJob\(m, now, clockMs, B\) \{[\s\S]*?super\._drawJob\(m, now, clockMs, B\); \} finally \{ m\.pos = p; \}/);
  assert.match(SRC, /\n {2}_labelPass\(now\) \{[\s\S]*?this\._lblAt = 0;[\s\S]*?super\._labelPass\(now\); \} finally \{/);
  assert.match(SRC, /\n {2}_posOf\(id\) \{\n {4}const p = super\._posOf\(id\);/);
  assert.match(SRC, /\n {2}_syncVis\(now\) \{\n {4}super\._syncVis\(now\);/);
  assert.match(SRC, /\(this\._isLabRig\(m\) \|\| this\._isLabJob\(m\)\) && m\.pos && !m\.released\) fromM\.set\(m\.id, this\._shownAt\(m\.id, m\.pos\)\)/);
  assert.match(SRC, /return drawRig\(this\._tweenPos\(m\), st,/);
  assert.match(SRC, /if \(this\.reduced\) \{ this\._rt = null; return; \}/);
  // 공용 복셀 오피스는 그대로(덮어쓰기는 LabView 에만)
  const off = readFileSync(path.join(WEB, 'voxel/office.js'), 'utf8');
  assert.doesNotMatch(off, /_tweenPos|_twSwap/);
});

test('(7) 기동기 대시보드(_holoPass): 보간 동안 시퀀서 대시보드 = 몸체·이름표와 같은 보간 자리 · 호출 뒤 m.pos 복구 · 던져도 복구 · 보간 끝 = 새 자리', () => {
  const { v, L9, L13, lab, old } = setup({ seq: true });
  const nw = L13.machine.get('L');
  assert.equal(nw.type, 'batch'); assert.equal(nw.rigKind, 'sequencer');
  assert.ok(Math.hypot(nw.x - L9.machine.get('L').x, nw.z - L9.machine.get('L').z) > 1, '시퀀서가 브리지와 같이 움직임');
  assert.ok(v._rt.m.has('L'), '보간 대상');
  v._now = 0.6;
  v._holoPass(0.6, 0.016);
  const d = v.dash.get('L'), want = radialLerp(old.get('L'), nw, lab.cx, lab.cz, 0.5, {});
  assert.ok(near(d.x, want.x) && near(d.z, want.z), '대시보드 = 보간 자리');
  assert.ok(Math.hypot(d.x - nw.x, d.z - nw.z) > 0.5, '아직 새 자리 아님');
  const q = v._tweenPos(v.machines.get('L'));
  assert.ok(near(d.x, q.x) && near(d.z, q.z), '몸체(_tweenPos)와 같은 자리');
  v._labelPass(0.6);
  assert.ok(near(v.puts.get('L').x, d.x) && near(v.puts.get('L').z, d.z), '이름표와 같은 자리');
  assert.equal(v.machines.get('L').pos, nw, '호출 뒤 m.pos 복구');
  assert.equal(v._twSwap, false);
  const orig = FakeVoxelView.prototype._holoPass;
  FakeVoxelView.prototype._holoPass = () => { throw new Error('boom'); };
  try { assert.throws(() => v._holoPass(0.6, 0.016), /boom/); } finally { FakeVoxelView.prototype._holoPass = orig; }
  assert.equal(v.machines.get('L').pos, nw); assert.equal(v._twSwap, false);
  v._now = 1.3; v._stepRadiusTween(1.3);
  v._holoPass(1.3, 0.016);
  assert.ok(near(v.dash.get('L').x, nw.x) && near(v.dash.get('L').z, nw.z), '보간 끝 = 새 자리');
  // 원문: office.js 는 holo.update 를 _holoPass 한 곳에서만(갈고리) · LabView 가 덮어씀 · office 에 보간 코드 없음
  const off = readFileSync(path.join(WEB, 'voxel/office.js'), 'utf8');
  assert.match(off, /\n {2}_holoPass\(now, dt\) \{ this\.holo\.update\(now, dt, this\.camera, this\.container\.clientHeight \|\| 1\); \}/);
  assert.equal((off.match(/this\.holo\.update\(/g) || []).length, 1);
  assert.match(off, /this\._holoPass\(now, dt\);/);
  assert.match(SRC, /\n {2}_holoPass\(now, dt\) \{[\s\S]*?super\._holoPass\(now, dt\); \} finally \{ this\._twSwapOut\(n\); \}/);
});

test('(8) 보간 중 띄움 점선(_drawSpawnLinks)·초점 바닥 고리(_machineRing) = 몸체와 같은 보간 자리 · 호출 뒤 m.pos 복구 · 던져도 복구 · 보간 끝 = 새 자리 · 오피스 원문은 고리 갈고리만', () => {
  const { v, L9, L13, lab, old } = setup({ seq: true });
  const nw = L13.machine.get('L');
  assert.ok(v._rt.m.has('L'));
  v._now = 0.6;
  // 점선이 없으면(_spawnIds 비었음) m.pos 를 바꾸지 않고 바탕만 부름(바탕은 숨김만 — 바꿀 일 없음)
  v._spawnIds = [];
  v._drawSpawnLinks();
  assert.ok(near(v.spawnAt.get('L').x, nw.x) && near(v.spawnAt.get('L').z, nw.z), '점선 없으면 바꾸기 없음');
  assert.ok(!v._twSwap);
  v._spawnIds = [['L', 'x']];
  v._drawSpawnLinks();
  const want = radialLerp(old.get('L'), nw, lab.cx, lab.cz, 0.5, {});
  const a = v.spawnAt.get('L');
  assert.ok(near(a.x, want.x) && near(a.z, want.z), '점선 끝 = 보간 자리');
  assert.ok(Math.hypot(a.x - nw.x, a.z - nw.z) > 0.5, '아직 새 자리 아님');
  assert.equal(v.machines.get('L').pos, nw, '호출 뒤 m.pos 복구'); assert.equal(v._twSwap, false);
  const orig = FakeVoxelView.prototype._drawSpawnLinks;
  FakeVoxelView.prototype._drawSpawnLinks = () => { throw new Error('boom'); };
  try { assert.throws(() => v._drawSpawnLinks(), /boom/); } finally { FakeVoxelView.prototype._drawSpawnLinks = orig; }
  assert.equal(v.machines.get('L').pos, nw); assert.equal(v._twSwap, false);
  // 바닥 고리: 연구소 기자재(시퀀서) = _tweenPos 자리, 연구소 기자재 아닌 것 = m.pos 그대로
  v.rings = [];
  v._machineRing(v.machines.get('L'), null);
  const q = v._tweenPos(v.machines.get('L'));
  assert.ok(near(v.rings[0].x, q.x) && near(v.rings[0].z, q.z) && near(v.rings[0].x, want.x), '고리 = 몸체 자리');
  const other = { id: 'o', type: 'rack', pos: { x: 3, z: 4, type: 'rack' } };
  v._machineRing(other, null);
  assert.deepEqual(v.rings[1], { id: 'o', x: 3, z: 4 });
  v._now = 1.3; v._stepRadiusTween(1.3);
  v._drawSpawnLinks(); v.rings = []; v._machineRing(v.machines.get('L'), null);
  assert.ok(near(v.spawnAt.get('L').x, nw.x) && near(v.rings[0].x, nw.x) && near(v.rings[0].z, nw.z), '보간 끝 = 새 자리');
  // 원문: office 는 고리를 _machineRing 한 곳에서(기본값 = m.pos, 예전 식 그대로) · LabView 가 덮어씀
  const off = readFileSync(path.join(WEB, 'voxel/office.js'), 'utf8');
  assert.match(off, /if \(m\.id === this\.focusId \|\| m\.id === this\.hoverId\) this\._machineRing\(m, G\);/);
  assert.match(off, /\n {2}_machineRing\(m, G, p = m\.pos\) \{\n {4}ring\(G, p\.x, 0\.04, p\.z \+ \(m\.type === 'rack' \? 0\.6 : 0\), 0\.9, 12, this\.tokens\.text, 0\.12\);/);
  assert.doesNotMatch(off, /ring\(G, m\.pos\.x, 0\.04/, '예전 고리 식은 _machineRing 으로 옮김(두 번 그리지 않음)');
  assert.match(SRC, /\n {2}_drawSpawnLinks\(\) \{[\s\S]*?super\._drawSpawnLinks\(\); \} finally \{ this\._twSwapOut\(n\); \}/);
  assert.match(SRC, /\n {2}_machineRing\(m, G\) \{\n {4}return super\._machineRing\(m, G, this\._isLabRig\(m\) \? this\._tweenPos\(m\) : m\.pos\);/);
});

test('(9) _tweenPos 한 프레임 기억: 같은 프레임·같은 보간이면 다시 계산하지 않고 같은 사본 · 프레임·보간·배치가 바뀌면 다시 계산', () => {
  const { v, L13, old, lab } = setup();
  const m = v.machines.get('bg1'), nw = L13.machine.get('bg1');
  v._now = 0.6;
  const q1 = v._tweenPos(m);
  assert.notEqual(q1, m.pos);
  const want = radialLerp(old.get('bg1'), nw, lab.cx, lab.cz, 0.5, {});
  assert.ok(near(q1.x, want.x) && near(q1.z, want.z));
  // 같은 프레임: 사본 값을 흐트러뜨려 두면 다시 계산하지 않았음을 볼 수 있음
  q1.x = 1e9;
  assert.equal(v._tweenPos(m), q1); assert.equal(q1.x, 1e9, '같은 프레임 = 기억한 사본');
  // 다음 프레임: 다시 계산
  v._now = 0.7;
  const q2 = v._tweenPos(m);
  assert.equal(q2, q1, '사본 객체는 그대로(할당 0)');
  const w2 = radialLerp(old.get('bg1'), nw, lab.cx, lab.cz, v._rt.tw.k(0.7), {});
  assert.ok(near(q2.x, w2.x) && near(q2.z, w2.z), '새 프레임 = 다시 계산');
  // 같은 시각이라도 보간이 새로 시작되면(rt 바뀜) 다시 계산
  q2.x = 1e9;
  v._rt = { ...v._rt };
  assert.ok(near(v._tweenPos(m).x, w2.x), '새 보간 = 다시 계산');
  // 배치가 바뀌어 m.pos 객체가 바뀌면 새 사본
  q2.x = 1e9;
  m.pos = { ...nw };
  const q3 = v._tweenPos(m);
  assert.notEqual(q3, q2); assert.ok(near(q3.x, w2.x));
  assert.match(SRC, /m\._tqAt === now && m\._tqRt === rt\) return q;/);
});

test('(10) 미끄러질 길이 새 배치 가구를 지나면 보간 안 함(가구와 함께 바로): 크게 커짐 = 기자재가 플랫폼을, 앉은 사람이 자기 책상을 · 줄어듦 = 사람은 책상 뒤로 미끄러짐 · 카드는 주인을 따름', () => {
  const ns = nodes(true);
  const L9 = computeLab(ns, 'main', null, { rP: 9 }), L13 = computeLab(ns, 'main', L9, { rP: 13 });
  const v = new LabLike();
  Object.assign(v, { scope: { mode: 'single' }, layout: L9, rooms: L9.rooms, roomsById: new Map(L9.rooms.map((r) => [r.id, r])),
    machines: new Map(), chars: new Map(), vis: new Map(), drawn: new Map(), puts: new Map(), lblLog: [], reduced: false, ts: 1, _now: 0, _rt: null, _vacant: new Map(), _clearWalks() {} });
  for (const [id, p] of L9.machine) v.machines.set(id, { id, type: p.type, pos: p, released: false, node: ns.find((n) => n.id === id) });
  v._next = L13; v._relayout(0);
  const lab = L13.rooms[0].lab, room = L13.rooms[0];
  // 9 → 13: 옛 고리 반지름(9 + 2.7)은 새 플랫폼(13 + 0.25) 안 = 기자재·그 카드는 바로 옮김(보간 대상 아님)
  assert.ok(!v._rt || !v._rt.m.has('bg1'), '기자재 = 바로');
  for (const id of ['j:bg1:0', 'j:bg1:1']) assert.ok(!v._rt || !v._rt.m.has(id), '주인이 바로 옮겨지면 카드도 바로 ' + id);
  assert.equal(v._tweenPos(v.machines.get('bg1')), v.machines.get('bg1').pos);
  // _slideClear: 새 플랫폼을 지나면 false · 자기 상자(반폭 own)는 뺌 · 빈 통로면 true
  const nw = L13.machine.get('bg1'), o9 = L9.machine.get('bg1');
  assert.equal(v._slideClear(room, o9, nw, LAB.RIG.SIZE / 2, lab.cx, lab.cz), false);
  const t10 = computeLab(ns, 'main', L9, { rP: 10.5 }), n10 = t10.machine.get('bg1');
  assert.equal(v._slideClear(t10.rooms[0], o9, n10, LAB.RIG.SIZE / 2, lab.cx, lab.cz), true, '작게 커지면 미끄러짐');
  assert.equal(v._slideClear(t10.rooms[0], o9, n10, 0, lab.cx, lab.cz), false, '자기 상자를 빼지 않으면 끝이 상자 안');
  // 앉은 사람: 커지면 새 책상이 옛 자리와 새 자리 사이 = 미끄러지지 않고 순간 이동(snapNext)
  const seat9 = L9.seat.get('sa'), seat13 = L13.seat.get('sa');
  assert.ok(seat9 && seat13 && seat13.deskX != null);
  const mk = (seat) => ({ id: 'sa', placed: true, seat, pos: { x: seat.x, z: seat.z }, atDesk: () => true });
  const from = (s) => new Map([['sa', { x: s.x, z: s.z, roomId: s.roomId, sx: s.x, sz: s.z }]]);
  let ch = mk({ ...seat13, roomId: seat9.roomId }); v.chars = new Map([['sa', ch]]);
  v._startRadiusTween(0, lab, new Map(), from({ ...seat9, roomId: seat9.roomId }));
  assert.equal(ch.snapNext, true, '걷지 않음'); assert.ok(!v._rt || !v._rt.c.has('sa'), '책상을 지나는 미끄러짐 없음 = 책상과 함께 바로');
  // 조금 줄어듦(10.5 → 9): 옛 자리는 새 책상 바깥 = 책상 뒤로 미끄러짐
  const seat10 = t10.seat.get('sa');
  ch = mk({ ...seat9, roomId: seat10.roomId }); v.chars = new Map([['sa', ch]]);
  v.layout = L9; // 새 배치 = rP 9
  v._startRadiusTween(0, L9.rooms[0].lab, new Map(), from({ ...seat10, roomId: seat10.roomId }));
  assert.ok(v._rt && v._rt.c.has('sa'), '조금 줄어들면 미끄러짐');
  const P0 = radialLerp(seat10, seat9, lab.cx, lab.cz, 0, {});
  for (let i = 0; i <= 20; i++) assert.ok(!navSolid(L9.rooms[0], P0.x + (seat9.x - P0.x) * i / 20, P0.z + (seat9.z - P0.z) * i / 20), '미끄러지는 길 = 가구 밖');
  // 크게 줄어듦(13 → 9): 옛 자리(반지름 20.75)는 안쪽으로 옮겨진 브리지 콘솔 안 = 바로
  ch = mk({ ...seat9, roomId: seat13.roomId }); v.chars = new Map([['sa', ch]]);
  v._startRadiusTween(0, L9.rooms[0].lab, new Map(), from({ ...seat13, roomId: seat13.roomId }));
  assert.ok(!v._rt || !v._rt.c.has('sa'), '콘솔을 지나는 미끄러짐 없음'); assert.equal(ch.snapNext, true);
  // 원문: _startRadiusTween 이 _slideClear 로 거름
  assert.match(SRC, /if \(!this\._slideClear\(room, f, p, own, cx, cz\)\) \{ fromM\.delete\(id\); cut\.add\(id\); \}/);
  assert.match(SRC, /if \(room && !this\._slideClear\(room, f, s, 0, cx, cz\)\) continue;/);
});

test('(11) 배치가 바뀌어 상자가 선 사람 위에 놓이면 가장 가까운 빈 칸으로 비켜 섬(걸어 나오지 않음) · 책상에 앉은 사람은 그대로 · 남은 길이 막히면 다시 찾기', () => {
  const ns = nodes(true), L = computeLab(ns, 'main', null, { rP: 10.5 }), room = L.rooms[0];
  const v = new LabLike();
  Object.assign(v, { layout: L, rooms: L.rooms, chars: new Map(), machines: new Map() });
  const desk = room.navBoxes.find((b) => b.kind === 'desk'), cx = (desk.minX + desk.maxX) / 2, cz = (desk.minZ + desk.maxZ) / 2;
  assert.ok(navSolid(room, cx, cz), '전제: 책상 상자 안');
  const mk = (id, st, atDesk = false, path = null) => ({ id, placed: true, state: st, room, pos: { x: cx, z: cz }, path, pi: 1, atDesk: () => atDesk, replanned: 0, replan() { this.replanned++; this.path = null; return true; } });
  const stand = mk('w', 'work'), seated = mk('s', 'seated', true);
  const rig = room.navBoxes.find((b) => b.kind === 'rig'), rx = (rig.minX + rig.maxX) / 2, rz = (rig.minZ + rig.maxZ) / 2;
  const walker = mk('k', 'walk', false, [{ x: rx - 3, z: rz }, { x: rx + 3, z: rz }]); walker.pos = { x: rx - 3, z: rz }; // 남은 길이 기자재를 지남
  v.chars = new Map([['w', stand], ['s', seated], ['k', walker]]);
  const n = v._replanBlocked();
  assert.ok(!navSolid(room, stand.pos.x, stand.pos.z), '선 사람 = 빈 칸으로');
  assert.ok(Math.hypot(stand.pos.x - cx, stand.pos.z - cz) < 1.5, '가까운 칸(짧게 비킴)');
  assert.equal(seated.pos.x, cx); assert.equal(seated.pos.z, cz); // 책상에 앉은 사람은 손대지 않음(snapNext 로 새 자리)
  assert.ok(navPathBlocked(room, [{ x: rx - 3, z: rz }, { x: rx + 3, z: rz }]), '전제: 길이 기자재를 지남');
  assert.equal(walker.replanned, 1); assert.equal(n, 1);
  assert.match(SRC, /const q = navSpot\(ch\.room, \{ x: ch\.pos\.x, z: ch\.pos\.z \}\);/);
});
