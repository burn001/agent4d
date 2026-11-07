// 노드가 빠지는 중(퇴장·숨음·프로젝트 흐려짐·node-remove)에 노드 자리 연출(웹 신호파)이 그리기 루프를 멈추지 않는지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ArtActs, ActPos, drawActs, NODE_ONLY, ACT_NAMES } from '../art-act-core.mjs';
import { ArtBook, ArtFx, ArtGeo } from '../artifact-core.mjs';
import { KI } from '../art-meta.mjs';
import { labSectorPlan, labPlatformGeometry } from '../lab/lab-platform-core.mjs';

const THEMES = ['flow', 'planet', 'voxel', 'lab'];
const posWithArea = () => { const p = new ActPos(); p.begin(); p.areas.set('p', { x: 0, y: 0, z: 0, r: 6 }); p.put('p|t', 1, 0, 1, 0.4, 0, 1); return p; };

test('웹 신호파: 노드 자리가 없으면(구역은 있음) 네 표현·움직임 줄이기 모두 예외 없이 건너뜀', () => {
  for (const th of THEMES) for (const reduced of [false, true]) {
    const A = new ArtActs();
    assert.equal(A.web({ nodeId: 'n', toolUseId: 'w' }, 'p', 0, 1), 1);
    const g = new ArtGeo(); g.begin();
    let drawn = -1;
    assert.doesNotThrow(() => { drawn = drawActs(g, A, 0.5, { theme: th, KI, pos: posWithArea(), nodePos: () => null, reduced }); }, `${th} reduced=${reduced}`);
    assert.equal(drawn, 0, `${th} 노드 없으면 웹 신호파 안 그림`);
    // 노드가 다시 보이면 그대로 이어서 그림
    const g2 = new ArtGeo(); g2.begin();
    assert.equal(drawActs(g2, A, 0.5, { theme: th, KI, pos: posWithArea(), nodePos: () => ({ x: 2, y: 3, z: 2 }), reduced }), 1);
    assert.ok(g2.nl > 0);
  }
});

test('노드 자리 없음 × 모든 연출: 대상 연출은 하늘에서, 대상 없는 연출은 구역 또는 건너뜀 — 예외 없음', () => {
  for (const th of THEMES) for (const a of ACT_NAMES) {
    const A = new ArtActs();
    A.list.push({ a, pid: 'p', id: a === 'radar' || a === 'web' ? null : 't', node: 'gone', k: a === 'tether' ? 'remote' : 'file', sz: 3, t0: 0, dur: 1, base: 1, n: 1 });
    const g = new ArtGeo(); g.begin();
    assert.doesNotThrow(() => drawActs(g, A, 0.5, { theme: th, KI, pos: posWithArea(), nodePos: () => null }), `${th} ${a}`);
  }
  assert.ok(NODE_ONLY.has('web'));
});

test('nodeRemoved: 빠진 노드의 웹 신호파·끝 짝·쿨다운만 지우고 대상 연출·다른 노드는 둠', () => {
  const A = new ArtActs();
  A.web({ nodeId: 'a', toolUseId: 'w1' }, 'p', 0);
  A.web({ nodeId: 'b', toolUseId: 'w2' }, 'p', 0);
  A.add({ a: 'read', pid: 'p', id: 't', node: 'a', k: 'file', v: 'read' }, 0);
  A._pend('tuA', { pid: 'p', node: 'a', refs: [{ id: 't', k: 'file', v: 'read' }], t: 0 });
  A._pend('tuB', { pid: 'p', node: 'b', refs: [], t: 0 });
  const v0 = A.version;
  assert.equal(A.nodeRemoved(['a']), 1);
  assert.ok(A.version > v0);
  assert.deepEqual(A.list.map((e) => e.a + ':' + e.node).sort(), ['read:a', 'web:b']);
  assert.equal(A.pending.has('tuA'), false); assert.equal(A.pending.has('tuB'), true);
  assert.equal(A.web({ nodeId: 'a', toolUseId: 'w3' }, 'p', 0.1), 1, '쿨다운도 지움(같은 id 로 다시 와도 그림)');
  assert.equal(A.nodeRemoved(new Set(['zz'])), 0);
  assert.equal(A.nodeRemoved([]), 0);
});

test('그리기 예외 격리: 연출 하나가 던져도 나머지는 그리고 그 연출만 끝냄', () => {
  const A = new ArtActs();
  A.add({ a: 'read', pid: 'p', id: 't', node: 'n', k: 'file', v: 'read' }, 0);
  A.web({ nodeId: 'n', toolUseId: 'w' }, 'p', 0);
  const g = new ArtGeo(); g.begin();
  const ring = g.ring.bind(g); let thrown = 0;
  g.ring = (...a) => { if (!thrown++) throw new Error('boom'); return ring(...a); }; // 첫 고리에서만 던짐
  const warn = console.warn; console.warn = () => {};
  let drawn;
  try { drawn = drawActs(g, A, 0.5, { theme: 'flow', KI, pos: posWithArea(), nodePos: () => ({ x: 2, y: 3, z: 2 }) }); } finally { console.warn = warn; }
  assert.equal(drawn, 1, '하나는 그림');
  assert.equal(A.stats.faults, 1);
  A.step(0.5);
  assert.equal(A.list.length, 1, '예외 난 연출은 다음 step 에서 빠짐');
});

test('연구소 실제 경로: 웹 도구 시작 뒤 사람이 퇴장(state gone → nodePos null)해도 플랫폼 그리기가 이어짐', () => {
  const book = new ArtBook(), pid = book.defaultProject;
  for (let i = 0; i < 8; i++) { const p = `src/f${i}.js`; book.touch(pid, { k: 'file', id: p, p, d: 'src', n: `f${i}.js`, v: 'create', sz: 10 }, Date.now() - 1000 + i, 'n1', `tu${i}`); }
  const plan = labSectorPlan(book.layoutItems(pid).items, 12, null);
  const plans = new Map([[pid, { plan, cx: 0, cz: 0, rWall: 30 }]]);
  const fx = new ArtFx();
  fx.acts.web({ nodeId: 'n1', toolUseId: 'wf' }, pid, 10);
  // LabPlatform3D._nodePos 와 같은 규칙: 사람이 gone·offstage·흐려짐이면 null
  const ch = { placed: true, state: 'work', offstage: false, pos: { x: 3, z: 4 } };
  const nodePos = (id) => (id === 'n1' && ch.placed && ch.state !== 'gone' && !ch.offstage ? { x: ch.pos.x, y: 1.15, z: ch.pos.z } : null);
  const env = { nowMs: Date.now(), reduced: false, foot: null, hover: null, hits: [], nodePos, style: null, isLight: false, unitPx: () => 30 };
  assert.doesNotThrow(() => labPlatformGeometry(book, plans, fx, 10.5, env, new ArtGeo()));
  for (const st of ['gone', 'offstage']) {
    ch.state = st === 'gone' ? 'gone' : 'work'; ch.offstage = st === 'offstage';
    assert.doesNotThrow(() => labPlatformGeometry(book, plans, fx, 10.6, env, new ArtGeo()), st);
  }
  // node-remove 이벤트 → 큐에서 정리
  assert.equal(fx.acts.nodeRemoved(['n1']), 1);
  assert.equal(fx.acts.list.length, 0);
});

test('앱 배선: node-remove 처리에서 art.nodeRemoved 를 부름(onEvent 가 art.event 전에 돌아가므로)', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const i = app.indexOf("case 'node-remove':"), j = app.indexOf("case 'node-update':", i);
  assert.ok(i > 0 && j > i);
  assert.match(app.slice(i, j), /art\.nodeRemoved\(/);
  const ui = readFileSync(new URL('../art-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /nodeRemoved\(ids\)\s*\{[\s\S]*?fx\.acts\.nodeRemoved\(ids\)/);
});
