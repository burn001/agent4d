// 작업 대상 상호작용 연출 — 동사 × 종류 연출 고르기, 합치기·상한·배속·쿨다운, 실패·중지 짝짓기, 검색 핑(실제 결과 경로만),
// 효과음 고르기, 세 표현 그리기(모든 연출이 무언가 그림·상한 안·움직임 줄이기 = 페이드만), 표현 도형 함수에 붙음(옛 패킷 대신)·계산 시간
import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtActs, ActPos, drawActs, actOf, actSound, hitPaths, matchHits, isInterrupt, actScale, ACT, ACT_NAMES, ACT_DUR } from '../art-act-core.mjs';
import { ArtBook, ArtFx, ArtState, ArtGeo, ARTGEO, ART_KEYS, artGeometry } from '../artifact-core.mjs';
import { artMockPayload } from '../art-mock.mjs';
import { planetArtGeometry } from '../art-meta.mjs';
import { VxArtPlan, voxelArtGeometry } from '../voxel/vx-art-core.mjs';

const T = Date.parse('2026-10-24T10:00:00Z');
const KI = Object.fromEntries(ART_KEYS.map((k, i) => [k, i]));
const F = (id, v, o = {}) => ({ k: 'file', id, p: id, d: id.split('/').slice(0, -1).join('/'), n: id.split('/').pop(), v, ...o });

test('actOf: 동사 × 대상 종류 → 연출(시작·끝)', () => {
  const S = (k, v) => actOf({ k, v }, 'start'), E = (k, v) => actOf({ k, v }, 'end');
  assert.equal(S('file', 'read'), 'read'); assert.equal(S('file', 'write'), 'carry'); assert.equal(S('file', 'delete'), null);
  assert.equal(E('file', 'create'), 'build'); assert.equal(E('file', 'modify'), 'edit'); assert.equal(E('file', 'delete'), 'shatter');
  assert.equal(E('output', 'create'), 'flash'); assert.equal(E('output', 'modify'), 'flash');
  assert.equal(S('db', 'query'), 'bubbles'); assert.equal(E('db', 'write'), 'pour');
  assert.equal(S('repo', 'push'), 'pack'); assert.equal(E('repo', 'push'), 'launch'); assert.equal(E('repo', 'read'), 'drop'); assert.equal(E('repo', 'write'), 'stamp');
  assert.equal(S('remote', 'query'), 'tether'); assert.equal(E('remote', 'write'), 'launch'); assert.equal(E('remote', 'read'), 'drop');
  assert.equal(S('service', 'query'), 'signal'); assert.equal(S('service', 'write'), 'signal'); assert.equal(E('service', 'write'), null);
  for (const a of ACT_NAMES) assert.ok(ACT_DUR[a] >= 0.8 && ACT_DUR[a] <= 3, `${a} 1～3초 안팎`);
  assert.equal(actSound('build'), 'act-build'); assert.equal(actSound('launch'), null, 'push 는 §68 소리가 이미 있음');
});

test('ArtActs: 장부 결과 → 시작·끝 연출, 같은 대상 합치기, 동시 상한(덜 중요한 것부터), 배속 압축·잔연출 생략', () => {
  const book = new ArtBook(), A = new ArtActs();
  book.apply({ type: 'tool-end', ts: new Date(T).toISOString(), nodeId: 'a:1', toolUseId: 'p0', art: [F('src/a.js', 'create')] }, 'p');
  A.fromRes(book.apply({ type: 'tool-start', nodeId: 'a:1', toolUseId: 't1', art: [F('src/a.js', 'modify', { sz: 1 })] }, 'p'), 'a:1', 0, 1, 't1');
  assert.deepEqual(A.list.map((e) => e.a), ['carry']);
  assert.ok(A.pending.has('t1'));
  A.fromRes(book.apply({ type: 'tool-end', ts: new Date(T + 1).toISOString(), nodeId: 'a:1', toolUseId: 't1', ok: true, art: [F('src/a.js', 'modify', { sz: 9 })] }, 'p'), 'a:1', 0.3, 1, 't1');
  assert.deepEqual(A.list.map((e) => e.a), ['carry', 'edit']);
  assert.ok(!A.pending.has('t1'), '끝나면 짝 지움');
  // 읽기는 장부에 있는 대상만
  A.fromRes(book.apply({ type: 'tool-start', nodeId: 'a:1', toolUseId: 't2', art: [F('src/none.js', 'read')] }, 'p'), 'a:1', 0.3, 1, 't2');
  assert.ok(!A.list.some((e) => e.a === 'read'));
  // 합치기: 0.7초 안 같은 대상·같은 연출
  const B = new ArtActs();
  for (let i = 0; i < 4; i++) B.add({ a: 'edit', pid: 'p', id: 'x', node: 'n' }, i * 0.1);
  assert.equal(B.list.length, 1); assert.equal(B.list[0].n, 4); assert.ok(B.list[0].dur > ACT_DUR.edit);
  // 상한: 잔연출(carry)부터 밀려나고, 중요한 실패는 끝까지 남음
  const C = new ArtActs();
  for (let i = 0; i < 30; i++) C.add({ a: i % 3 ? 'carry' : 'ping', pid: 'p', id: 'f' + i, node: 'n' }, 0);
  assert.equal(C.list.length, ACT.MAX_LIVE);
  C.add({ a: 'fail', pid: 'p', id: 'z', node: 'n' }, 0);
  assert.ok(C.list.some((e) => e.a === 'fail'));
  // 배속: 16배면 1/4 길이(하한 0.45초), 잔연출 생략, 상한 6
  const D = new ArtActs();
  assert.equal(D.add({ a: 'carry', pid: 'p', id: 'a' }, 0, 16), null);
  const e = D.add({ a: 'build', pid: 'p', id: 'b' }, 0, 16);
  assert.ok(Math.abs(e.dur - Math.max(ACT.MIN_DUR, ACT_DUR.build / 4)) < 1e-9);
  for (let i = 0; i < 20; i++) D.add({ a: 'edit', pid: 'p', id: 'e' + i }, 0, 16);
  assert.ok(D.list.length <= ACT.FAST_LIVE);
  D.step(100); assert.equal(D.active, false);
});

test('검색·웹 쿨다운, 실패 스파크·중단 회색·노드 중지 짝짓기', () => {
  const A = new ArtActs();
  assert.equal(A.search({ type: 'tool-start', nodeId: 'n', toolUseId: 'g1' }, 'p', null, 0), 1);
  assert.equal(A.search({ type: 'tool-start', nodeId: 'n2', toolUseId: 'g2' }, 'p', null, 2), 0, '같은 섬 레이더는 6초에 한 번');
  assert.equal(A.search({ type: 'tool-start', nodeId: 'n', toolUseId: 'g3' }, 'q', null, 2), 1, '다른 섬은 따로');
  assert.equal(A.web({ type: 'tool-start', nodeId: 'n', toolUseId: 'w1' }, 'p', 0), 1);
  assert.equal(A.web({ type: 'tool-start', nodeId: 'n', toolUseId: 'w2' }, 'p', 3), 0);
  const B = new ArtActs(), book = new ArtBook();
  B.fromRes(book.apply({ type: 'tool-start', nodeId: 'a:1', toolUseId: 'x1', art: [F('a.js', 'modify')] }, 'p'), 'a:1', 0, 1, 'x1');
  assert.equal(B.fail({ type: 'tool-end', toolUseId: 'x1', ok: false, text: 'String to replace not found' }, 0.5), 1);
  assert.equal(B.list.at(-1).a, 'fail');
  assert.equal(B.fail({ type: 'tool-end', toolUseId: 'x1', ok: false }, 0.6), 0, '짝은 한 번만');
  B.fromRes(book.apply({ type: 'tool-start', nodeId: 'a:1', toolUseId: 'x2', art: [F('b.js', 'modify')] }, 'p'), 'a:1', 1, 1, 'x2');
  B.fail({ type: 'tool-end', toolUseId: 'x2', ok: false, text: '[Request interrupted by user for tool use]' }, 1.2);
  assert.equal(B.list.at(-1).a, 'stop');
  assert.ok(isInterrupt({ ix: { op: 'deny' } }) && !isInterrupt({ text: 'ENOENT' }));
  B.fromRes(book.apply({ type: 'tool-start', nodeId: 'a:2', toolUseId: 'x3', art: [F('c.js', 'write')] }, 'p'), 'a:2', 2, 1, 'x3');
  assert.equal(B.nodeStopped('a:2', 2.5), 1);
  assert.equal(B.list.at(-1).a, 'stop');
  assert.equal(B.fail({ type: 'tool-end', toolUseId: 'nope', ok: false }, 3), 0, '시작에 대상이 없던 호출은 연출 없음');
});

test('검색 핑: 결과 경로(패널 h 줄)가 장부 대상과 맞는 것만', () => {
  const tails = hitPaths({ lines: ['…/web/flat/art2d.js:12: TODO', 'src\\core3.mjs', '3개 파일', 'C:/x/README.md:4-'], marks: 'hhdh' });
  assert.deepEqual(tails, ['web/flat/art2d.js', 'src/core3.mjs', 'c:/x/readme.md']);
  const items = [{ k: 'file', id: 'web/flat/art2d.js' }, { k: 'file', id: 'src/core3.mjs', p: 'src/core3.mjs' }, { k: 'file', id: 'src/other.mjs' }, { k: 'db', id: 'db:m/x' }];
  assert.deepEqual(matchHits(items, tails), ['web/flat/art2d.js', 'src/core3.mjs']);
  const A = new ArtActs();
  assert.equal(A.search({ type: 'tool-end', ok: true, nodeId: 'n', toolUseId: 'g', panel: { lines: ['…/web/flat/art2d.js:1: x'], marks: 'h' } }, 'p', items, 0), 1);
  assert.equal(A.list[0].a, 'ping');
  assert.equal(A.search({ type: 'tool-end', ok: true, nodeId: 'n', toolUseId: 'g2' }, 'p', items, 0), 0, '패널 없으면(접힘·minimal) 핑 없음');
});

test('그리기: 세 표현 × 모든 연출이 무언가 그림, 버퍼 상한 안, 움직임 줄이기는 고리 페이드만, 화면 크기 보정', () => {
  for (const th of ['flow', 'planet', 'voxel']) for (const a of ACT_NAMES) for (const k of [0.15, 0.5, 0.85]) {
    const A = new ArtActs();
    A.list.push({ a, pid: 'p', id: a === 'radar' || a === 'web' ? null : 't', node: 'n', k: a === 'tether' ? 'remote' : 'file', sz: 9, t0: 0, dur: 1, base: 1, n: 2 });
    const pos = new ActPos(); pos.begin();
    const R = pos.put('p|t', 0, -1.8, 0, -1.6, -2.2, 1.5); R.ox = 1;
    pos.areas.set('p', { x: 0, y: -2.2, z: 0, r: 8, ...(th === 'voxel' ? { sx0: -4, sz0: -3, sx1: 4, sz1: -3 } : {}) });
    const g = new ArtGeo(); g.begin();
    const ctx = { theme: th, KI, pos, nodePos: () => ({ x: -4, y: 3, z: 2 }), reduced: false };
    drawActs(g, A, k, ctx);
    if (!(a === 'tether' && k > 0.4 && k < 0.6)) assert.ok(g.nl + g.nd + g.nb > 0, `${th} ${a} ${k} 그림`);
    assert.ok(g.nl <= ARTGEO.LINES && g.nd <= ARTGEO.DOTS && g.nb <= ARTGEO.BOXES);
    const r = new ArtGeo(); r.begin();
    drawActs(r, A, k, { ...ctx, reduced: true });
    assert.equal(r.nd + r.nb, 0, `${a} 움직임 줄이기 = 점·상자 없음`);
    assert.ok(r.nl > 0 && r.nl <= 24, `${a} 고리 하나`);
  }
  const g1 = new ArtGeo(), g2 = new ArtGeo();
  const A = new ArtActs(); A.list.push({ a: 'launch', pid: 'p', id: 't', node: 'n', k: 'repo', t0: 0, dur: 1, base: 1, n: 1 });
  const pos = new ActPos(); pos.begin(); pos.put('p|t', 0, 0, 0, 0.3, 0, 1);
  const top = (g) => { let m = -1e9; for (let i = 0; i < g.nl; i++) m = Math.max(m, g.L[i * 6 + 1]); return m; };
  g1.begin(); drawActs(g1, A, 0.6, { theme: 'flow', KI, pos, nodePos: () => null, unitPx: () => 40 });
  g2.begin(); drawActs(g2, A, 0.6, { theme: 'flow', KI, pos, nodePos: () => null, unitPx: () => 4 });
  assert.ok(top(g2) > top(g1) * 2, '멀면(1단위 4px) 더 높이 쏘아 올림');
  assert.equal(actScale(40), 1); assert.equal(actScale(1), 4);
});

test('표현 도형 함수에 붙음: 흐름 = 옛 패킷 대신 연출, Planet·복셀도 그림, 연출 10개 계산 시간', () => {
  const book = new ArtBook();
  book.load('p', artMockPayload('p', T, 's:m', 120).items);
  const fx = new ArtFx(), st = new ArtState({ book, fx });
  st.frame(['p'], () => ({ x: 0, z: 0, hw: 40, hd: 40 }), 0, 0.016);
  const files = book.shownItems('p').filter((x) => x.k === 'file');
  const env = { anchor: (p) => st.anchor(p), nodePos: () => ({ x: 6, y: 4, z: 6 }), nowMs: T, cellPx: () => 20, yOf: () => -2.2, hits: [] };
  const base = artGeometry(book, st.lay, new ArtFx(), 0.3, env, new ArtGeo()).nl;
  for (let i = 0; i < 10; i++) {
    const tu = 'u' + i, ref = F(files[i].id, i % 2 ? 'modify' : 'read', { sz: 5 });
    fx.note(book.apply({ type: 'tool-start', nodeId: 's:m', toolUseId: tu, art: [ref] }, 'p'), 's:m', 0, 1, tu);
    fx.note(book.apply({ type: 'tool-end', ts: new Date(T + i).toISOString(), nodeId: 's:m', toolUseId: tu, ok: true, art: [ref] }, 'p'), 's:m', 0.05, 1, tu);
  }
  assert.ok(fx.acts.list.length >= 8 && fx.active);
  assert.ok(fx.list.some((e) => e.kind === 'packet'), '옛 연출 큐는 그대로(시험·점등 호환)');
  st.syncLayout(['p'], 1);
  const t0 = performance.now();
  let g;
  for (let i = 0; i < 20; i++) g = artGeometry(book, st.lay, fx, 0.5, env, g || new ArtGeo());
  const ms = (performance.now() - t0) / 20;
  assert.ok(g.nl > base + 40, `연출 선 더해짐 (${base} → ${g.nl})`);
  assert.ok(ms < 20, `흐름 도형 + 연출 ${ms.toFixed(2)}ms`);
  const gp = planetArtGeometry(book, st.lay, fx, 0.5, { ...env, hits: [] }, new ArtGeo());
  const gp0 = planetArtGeometry(book, st.lay, new ArtFx(), 0.5, { ...env, hits: [] }, new ArtGeo());
  assert.ok(gp.nl + gp.nd > gp0.nl + gp0.nd + 20, 'Planet 연출');
  const room = { id: 'o', type: 'office', ownerId: 's:m', projectId: 'p', origin: { x: 0, z: 0 }, size: { w: 24, d: 18 }, bounds: { minX: -12, maxX: 12, minZ: -9, maxZ: 9 }, door: { x: 7.8, z: 8.3 } };
  const plans = new Map([['p', new VxArtPlan().sync('p', book.shownItems('p'), room)]]);
  const vEnv = { nodePos: () => ({ x: 0, y: 1.15, z: 0 }), nowMs: T, unitPx: () => 20, hits: [] };
  const gv = voxelArtGeometry(book, plans, fx, 0.5, vEnv, new ArtGeo());
  const gv0 = voxelArtGeometry(book, plans, new ArtFx(), 0.5, { ...vEnv, hits: [] }, new ArtGeo());
  assert.ok(gv.nl + gv.nb + gv.nd > gv0.nl + gv0.nb + gv0.nd + 10, '복셀 연출(서류·손전등…)');
  fx.step(10); assert.equal(fx.active, false);
});

test('§84 장면도 프로젝트 페이드: pidAlpha 를 곱하고 0 이면 건너뜀, 끝나면 ka = 1', () => {
  const A = new ArtActs(); A.list.push({ a: 'launch', pid: 'p', id: 't', node: 'n', k: 'repo', t0: 0, dur: 1, base: 1, n: 1 });
  const pos = new ActPos(); pos.begin(); pos.put('p|t', 0, 0, 0, 0.3, 0, 1);
  const ctx = { theme: 'flow', KI, pos, nodePos: () => ({ x: -4, y: 3, z: 2 }) };
  const full = new ArtGeo(); full.begin(); drawActs(full, A, 0.3, ctx);
  const half = new ArtGeo(); half.begin(); drawActs(half, A, 0.3, { ...ctx, pidAlpha: () => 0.5 });
  const sum = (g) => { let s = 0; for (let i = 0; i < g.nl; i++) s += g.LA[i]; return s; };
  assert.ok(full.nl > 0 && sum(half) < sum(full) * 0.75, '반쯤 사라진 프로젝트 장면은 옅게');
  assert.equal(half.ka, 1);
  const none = new ArtGeo(); none.begin(); drawActs(none, A, 0.3, { ...ctx, pidAlpha: () => 0 });
  assert.equal(none.nl + none.nd + none.nb, 0);
});
