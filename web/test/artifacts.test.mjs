// 작업 대상 층 — 웹 공용 코어: 장부·배치 안정성·신선도·도형 상한·연출·토글·팝업 모델·mock
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ART, ArtBook, ArtLayout, ArtFx, ArtGeo, ArtState, ARTGEO, artGeometry, artFitPoints, artPickXZ, freshness, edgeWeight, isShown,
  districtKey, topFolder, fileSub, inIsland, fitScale, ART_KEYS, artInitial, artStoreKey, ART_VIEWS_READY, artInspectModel, artHistorySample, foldRef, sanitizeArt, artHash, spiralAt,
  districtLabel, artAlarmText, ART_KIND_LABEL,
} from '../artifact-core.mjs';
import { _setLangForTest } from '../i18n.mjs';
import { ART_MOCK, ArtMockDriver, artMockPayload } from '../art-mock.mjs';

const T = Date.parse('2026-10-24T10:00:00Z');
const file = (id, v = 'modify', o = {}) => ({ k: 'file', id, p: id, d: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '', n: id.split('/').pop(), v, ...o });
const end = (tu, art, dt = 0, node = 'a:1') => ({ type: 'tool-end', ts: new Date(T + dt).toISOString(), nodeId: node, toolUseId: tu, ok: true, art });

test('신선도·굵기·표시 규칙', () => {
  assert.equal(freshness(0), 1);
  assert.equal(freshness(5 * 60_000), 1);
  const h1 = freshness(3_600_000), d1 = freshness(86_400_000), d7 = freshness(7 * 86_400_000);
  assert.ok(h1 < 1 && d1 < h1 && d7 < d1, '오래될수록 바램');
  assert.ok(Math.abs(d7 - 0.3) < 0.01, '7일에 바닥');
  assert.deepEqual([edgeWeight(1), edgeWeight(3), edgeWeight(10)], [1, 2, 3]);
  assert.equal(isShown({ k: 'file', cnt: { read: 3 } }), false, '읽기만 한 파일은 바닥층에 없음');
  assert.equal(isShown({ k: 'db', cnt: { query: 1 } }), true);
  assert.deepEqual([topFolder('web/flat'), topFolder('~/AppData/Local/Temp/x'), topFolder('d:/git/repo/src'), topFolder('')], ['web', '~/AppData/Local', 'd:/git', '']);
  assert.equal(districtKey(file('web/flat/a.js')), 'f:web');
  assert.equal(districtKey({ k: 'db' }), '#db');
});

test('배치: 결정적(같은 장부 → 같은 자리), 새 대상이 생겨도 기존 블록은 그대로, 빠지면 칸만 빔', () => {
  const items = [];
  for (let i = 0; i < 60; i++) items.push({ ...file(`${['src', 'web', 'docs', 'test'][i % 4]}/f${i}.js`), first: T + i * 1000, cnt: { modify: 1 } });
  const A = new ArtLayout(), B = new ArtLayout();
  const la = A.sync('p', items), lb = B.sync('p', [...items].reverse());
  for (const it of items) assert.deepEqual(la.pos.get(it.id), lb.pos.get(it.id), '입력 순서와 무관(첫 접촉 순)');
  const before = new Map([...la.pos].map(([k, v]) => [k, [v.i, v.j]]));
  const more = [...items];
  for (let i = 60; i < 120; i++) more.push({ ...file(`${['src', 'lib', 'web'][i % 3]}/g${i}.js`), first: T + i * 1000, cnt: { modify: 1 } });
  const l2 = A.sync('p', more);
  for (const [id, ij] of before) assert.deepEqual([l2.pos.get(id).i, l2.pos.get(id).j], ij, '기존 블록 자리 그대로');
  const cells = new Set([...l2.pos.values()].map((p) => p.i + ',' + p.j));
  assert.equal(cells.size, l2.pos.size, '칸 겹침 없음');
  const l3 = A.sync('p', more.filter((_, i) => i % 2 === 0));
  for (const [id, p] of l3.pos) assert.deepEqual([p.i, p.j], [l2.pos.get(id).i, l2.pos.get(id).j], '빠진 대상이 있어도 남은 대상은 그대로');
  // 구역(폴더) = 기준점 둘레에 모임
  const z = l2.zones.find((q) => q.key === 'f:src');
  assert.ok(z && z.n > 10);
  assert.ok(spiralAt(0)[0] === 0 && spiralAt(1)[0] === 1 && spiralAt(8).length === 2);
});

test('섬 안 보장(§79.12): 바닥층은 늘 그 섬 슈퍼타원 안 — 많으면 폴더 묶음(LOD), 섬이 움직이면 같이, 이웃 섬과 겹침 0', () => {
  const book = new ArtBook();
  for (let i = 0; i < 480; i++) book.apply(end('t' + i, [file(`d${i % 9}/sub${i % 4}/f${i}.js`, 'create')], i * 1000), 'p');
  book.apply(end('db', [{ k: 'db', id: 'db:m/a', n: 'a', v: 'write' }]), 'p');
  for (let i = 0; i < 40; i++) book.apply(end('q' + i, [file(`x${i}.js`, 'create')], i * 1000), 'q');
  const st = new ArtState({ book, fx: new ArtFx() });
  const boxes = { p: { x: 0, z: 0, hw: 14, hd: 10 }, q: { x: 30, z: 0, hw: 12, hd: 10 } }; // 이웃 섬(상자 사이 4)
  const inside = (pid) => { const a = st.anchor(pid), L = st.lay.get(pid), t = boxes[pid]; for (const [, q] of L.pos) for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const x = q.x * a.k + dx * ART.CELL * a.k * 0.5, z = q.z * a.k + dz * ART.CELL * a.k * 0.5; if (!inIsland(x, z, t.hw, t.hd, 0.9)) return false; } return true; };
  st.frame(['p', 'q'], (pid) => boxes[pid], 0, 0.016);
  assert.ok(st.lay.get('p').agg, '대상 480개·작은 섬 → 폴더 묶음 배치');
  assert.ok(!st.lay.get('q').agg, '적으면 대상별');
  assert.ok(inside('p') && inside('q'), '모든 칸이 섬 안');
  boxes.p = { ...boxes.p, x: -50, z: 20 };
  st.frame(['p', 'q'], (pid) => boxes[pid], 0.5, 0.016);
  assert.deepEqual([st.anchor('p').x, st.anchor('p').z], [-50, 20], '섬이 움직이면 바로 같이');
  boxes.q = { ...boxes.q, hw: 6, hd: 5 };
  st.frame(['p', 'q'], (pid) => boxes[pid], 1, 0.016);
  assert.ok(inside('q'), '섬이 줄면 축척도 바로');
  const s2 = new ArtState({ book, fx: new ArtFx() });
  s2.frame(['q'], () => ({ x: 0, z: 0, hw: 500, hd: 500 }), 0, 0.016);
  assert.equal(s2.anchor('q').k, 1);
  const a = s2.anchor('q'); const [id, q] = [...s2.lay.get('q').pos][0];
  assert.deepEqual(artPickXZ(s2.lay, (pid) => s2.anchor(pid), a.x + q.x * a.k, a.z + q.z * a.k), { pid: 'q', id });
  const zp = [...st.lay.get('p').pos].find(([k]) => k.startsWith('#zone:'));
  const ap = st.anchor('p');
  const hit = artPickXZ(st.lay, (pid) => st.anchor(pid), ap.x + zp[1].x * ap.k, ap.z + zp[1].z * ap.k);
  assert.ok(!hit || !hit.id.startsWith('#zone:'), '묶음은 집지 않음');
  assert.ok(st.worldOf('p', 'd0/sub0/f0.js'), '묶인 대상도 그 구역 자리');
  assert.ok(fitScale({ x0: -10, z0: -10, x1: 10, z1: 10 }, { hw: 5, hd: 5 }) < 0.5);
});

test('연출 큐: 시작=패킷(읽기는 있는 대상만 선), 끝=솟음·맥동·무너짐·DB 수위·push 흡수·파괴적 경보, 배속이면 짧게, 상한', () => {
  const book = new ArtBook();
  const fx = new ArtFx();
  fx.note(book.apply({ type: 'tool-start', nodeId: 'a:1', art: [file('x.js', 'read')] }, 'p'), 'a:1', 0);
  assert.equal(fx.list.length, 0, '없는 대상 읽기는 연출 없음');
  fx.note(book.apply({ type: 'tool-start', nodeId: 'a:1', art: [file('x.js', 'write')] }, 'p'), 'a:1', 0);
  assert.equal(fx.list[0].kind, 'packet');
  fx.note(book.apply(end('t1', [file('x.js', 'create', { sz: 9 })]), 'p'), 'a:1', 0);
  fx.note(book.apply(end('t2', [file('x.js', 'modify', { sz: 40 })], 100), 'p'), 'a:1', 0);
  fx.note(book.apply(end('t3', [file('x.js', 'delete', { x: 'rm' })], 200), 'p'), 'a:1', 0, 16);
  fx.note(book.apply(end('t4', [{ k: 'db', id: 'db:m/a', n: 'a', v: 'write', x: 'drop' }], 300), 'p'), 'a:1', 0);
  fx.note(book.apply(end('t5', [{ k: 'repo', id: 'repo:r', n: 'r', v: 'push', c: 3 }], 400), 'p'), 'a:1', 0);
  fx.note(book.apply(end('t6', [file('y.js', 'modify', { x: 'overwrite' })], 500), 'p'), 'a:1', 0);
  const kinds = fx.list.map((e) => e.kind);
  for (const k of ['packet', 'rise', 'pulse', 'collapse', 'alarm', 'dbw', 'absorb', 'warn']) assert.ok(kinds.includes(k), k);
  const col = fx.list.find((e) => e.kind === 'collapse');
  assert.ok(col.dur < 1.3 / 2, '배속 16 → ÷4');
  fx.step(100); assert.equal(fx.active, false);
  for (let i = 0; i < 400; i++) fx.note({ pid: 'p', changes: [{ kind: 'touch', ref: file('z.js', 'modify') }] }, 'a:1', 200);
  assert.ok(fx.list.length <= 160);
});

test('도형(§79.13·§79.14): 저휘도 선 위주·점등·종류별 실루엣·빔은 점등/초점만·라이트 채움 없음·LOD·상한', () => {
  const book = new ArtBook();
  const now = T + 60_000;
  book.apply(end('a', [file('src/a.js', 'create')]), 'p');
  for (let i = 0; i < 12; i++) book.apply(end('b' + i, [file('src/a.js', 'modify')], 1000 + i), 'p');
  for (const [tu, f] of [['c1', 'docs/readme.md'], ['c2', 'data/x.json'], ['c3', 'img/a.png'], ['c4', 'docs/plan-계획.md']]) book.apply(end(tu, [file(f, 'create')]), 'p');
  book.apply(end('c', [{ k: 'db', id: 'db:m/a', n: 'a', v: 'write', coll: ['x', 'y'] }]), 'p');
  book.apply(end('d', [{ k: 'repo', id: 'repo:r', n: 'r', v: 'push' }]), 'p');
  book.apply(end('e', [{ k: 'remote', id: 'remote:h', n: 'h', v: 'query' }]), 'p');
  book.apply(end('f', [{ k: 'service', id: 'svc:g', n: 'Gmail', v: 'write' }]), 'p');
  book.apply(end('g', [file('out/최종.pdf', 'create', { k: 'output', imp: 'final' })], 0, 'a:2'), 'p');
  assert.deepEqual(['src/a.js', 'docs/readme.md', 'data/x.json', 'img/a.png', 'docs/plan-계획.md'].map((id) => fileSub(book.get('p', id))), ['code', 'doc', 'data', 'image', 'plan']);
  const fx = new ArtFx();
  const st = new ArtState({ book, fx });
  st.frame(['p'], () => ({ x: 0, z: 0, hw: 100, hd: 100 }), 0, 0);
  const env = { anchor: (pid) => st.anchor(pid), nodePos: (id) => (id === 'a:1' ? { x: 5, y: 0, z: 5 } : id === 'a:2' ? { x: -5, y: 0, z: 5 } : null), nowMs: now, cellPx: () => 20 };
  const maxA = (gg) => { let m = 0; for (let i = 0; i < gg.nl; i++) if (gg.LC[i] !== ART_KEYS.indexOf('imp')) m = Math.max(m, gg.LA[i]); return m; };
  const has = (gg, k) => [...gg.LC.slice(0, gg.nl)].includes(ART_KEYS.indexOf(k));
  const g = artGeometry(book, st.lay, fx, 0, env, new ArtGeo());
  assert.ok(maxA(g) <= 0.36, `평소 선 알파 ≤ 0.35 (${maxA(g).toFixed(2)})`);
  assert.ok(Math.max(0, ...g.BA.slice(0, g.nb)) <= 0.08, '평소 채움 ≤ 0.08');
  assert.equal(g.ny, 0, '채운 원기둥 없음(와이어)');
  assert.ok(!has(g, 'write'), '평소엔 빔 없음');
  assert.ok(!has(g, 'alarm'), '빨강은 경보 때만');
  assert.ok(g.nl > 150, '종류별 실루엣 선');
  fx.note(book.apply(end('z1', [file('src/a.js', 'modify', { sz: 3 })], 2000, 'a:1'), 'p'), 'a:1', 0);
  const g1 = artGeometry(book, st.lay, fx, 0.5, env, new ArtGeo());
  assert.ok(maxA(g1) > 0.6 && has(g1, 'write'), '손댄 대상만 점등 + 빔');
  fx.step(5);
  const g2 = artGeometry(book, st.lay, fx, 5, env, new ArtGeo());
  assert.ok(maxA(g2) <= 0.36, '4초 감쇠 뒤 다시 가라앉음');
  assert.equal(artGeometry(book, st.lay, fx, 5, { ...env, isLight: true }, new ArtGeo()).nb, 0, '라이트는 채움 없음');
  assert.equal(artGeometry(book, st.lay, fx, 5, { ...env, style: { bright: 0.35, fill: 'line' } }, new ArtGeo()).nb, 0, '선만');
  st.setFoot('p', 'a:2');
  assert.ok(has(artGeometry(book, st.lay, new ArtFx(), 0, { ...env, foot: st.foot }, new ArtGeo()), 'write'), '초점 노드 빔');
  const gfar = artGeometry(book, st.lay, new ArtFx(), 0, { ...env, cellPx: () => 2 }, new ArtGeo());
  assert.ok(gfar.nl < g.nl / 3, '멀면 구역 외곽선만');
  const big = new ArtBook();
  for (let i = 0; i < 700; i++) big.apply(end('z' + i, [file(`d${i % 30}/f${i}.js`, 'create')], i, 'a:' + (i % 40)), 'q');
  assert.equal(big.count('q'), ART.MAX_ITEMS);
  const s2 = new ArtState({ book: big, fx: new ArtFx() });
  s2.frame(['q'], () => ({ x: 0, z: 0, hw: 60, hd: 60 }), 0, 0);
  const t0 = performance.now();
  const gb = artGeometry(big, s2.lay, s2.fx, 0, { anchor: (pid) => s2.anchor(pid), nodePos: () => ({ x: 0, y: 0, z: 0 }), nowMs: T + 1000, cellPx: () => 20 }, new ArtGeo());
  const ms = performance.now() - t0;
  assert.ok(gb.nb <= ARTGEO.BOXES && gb.nl <= ARTGEO.LINES && gb.labels.length <= ARTGEO.LABELS);
  assert.ok(ms < 60, `도형 계산 ${ms.toFixed(1)}ms`);
});

test('점등 상한: 동시에 밝은 대상은 ART.LIT_MAX(8)', () => {
  const book = new ArtBook(), fx = new ArtFx();
  for (let i = 0; i < 20; i++) fx.note(book.apply(end('l' + i, [file(`a/f${i}.js`, 'create')], i), 'p'), 'a:1', 0);
  const st = new ArtState({ book, fx });
  st.frame(['p'], () => ({ x: 0, z: 0, hw: 200, hd: 200 }), 0.2, 0);
  const g = artGeometry(book, st.lay, fx, 0.2, { anchor: (pid) => st.anchor(pid), nodePos: () => null, nowMs: T, cellPx: () => 20, labels: false }, new ArtGeo());
  const lit = new Set();
  for (let i = 0; i < g.nb; i++) if (g.BA[i] > 0.2) lit.add(g.B[i * 6] + ',' + g.B[i * 6 + 2]);
  assert.equal(lit.size, ART.LIT_MAX);
});


test('토글: 기본 끔, 표현별 저장값, URL 강제, 세 표현 모두 준비(§81), 모르는 표현은 늘 끔', () => {
  assert.equal(artInitial('flow', null, null), false);
  assert.equal(artInitial('flow', null, '1'), true);
  assert.equal(artInitial('flow', '0', '1'), false);
  assert.equal(artInitial('flow', '1', '0'), true);
  assert.equal(artInitial('planet', null, null), false);
  assert.equal(artInitial('planet', '1', '0'), true);
  assert.equal(artInitial('voxel', null, '1'), true);
  assert.equal(artInitial('voxel', '0', '1'), false);
  assert.equal(artInitial('shapes', '1', '1'), false);
  assert.equal(artStoreKey('flow'), 'ccviz.artifacts.flow');
  assert.equal(artStoreKey('voxel'), 'ccviz.artifacts.voxel');
  assert.ok(['flow', 'planet', 'voxel'].every((v) => ART_VIEWS_READY.has(v)));
});

test('팝업 모델: 누가 언제 무엇을·변경 크기·중요·파괴적, 화면에 없는 노드 이름', () => {
  const book = new ArtBook();
  book.apply(end('a', [file('src/a.js', 'create', { sz: 10, imp: 'secret' })], 0, 's:main'), 'p');
  book.apply(end('b', [file('src/a.js', 'delete', { x: 'rm' })], 60_000, 'a:sub'), 'p');
  const m = artInspectModel(book.get('p', 'src/a.js'), T + 120_000, (id) => ({ 's:main': '메인', 'a:sub': '정리 에이전트' }[id]));
  assert.equal(m.state, '지워짐');
  assert.equal(m.log[0].who, '정리 에이전트'); assert.equal(m.log[0].verb, '지움'); assert.ok(m.log[0].x);
  assert.match(m.verbs, /만듦 1 · 지움 1/);
  assert.equal(m.imp, '비밀·자격증명');
  assert.match(m.lines[0], /10줄/);
  assert.equal(m.who.length, 2);
});

test('§86 팝업 모델·라벨 영어: 상태·동사·중요도·줄 수·상대 시각·구역 이름·경보 줄', () => {
  _setLangForTest('en');
  try {
    const book = new ArtBook();
    book.apply(end('a', [file('src/a.js', 'create', { sz: 1200, imp: 'secret' })], 0, 's:main'), 'p');
    book.apply(end('b', [file('src/a.js', 'delete', { x: 'rm' })], 60_000, 'a:sub'), 'p');
    const m = artInspectModel(book.get('p', 'src/a.js'), T + 120_000, (id) => id);
    assert.equal(m.state, 'Deleted'); assert.equal(m.kind, 'File');
    assert.equal(m.log[0].verb, 'Deleted'); assert.equal(m.log[0].when, '1 min ago');
    assert.match(m.verbs, /Created 1 · Deleted 1/);
    assert.equal(m.imp, 'Secrets & credentials');
    assert.equal(m.lines[0], 'About 1,200 lines changed');
    assert.equal(districtLabel('#repo'), 'Repos'); assert.equal(districtLabel('f:'), '(root)');
    assert.equal(artAlarmText({ x: 'zzz', n: 'a.js' }), '⚠ Destructive action · a.js');
    assert.equal(ART_KIND_LABEL.nope, undefined);
  } finally { _setLangForTest('ko'); }
  assert.equal(ART_KIND_LABEL.service, '외부 서비스');
});

test('접기·정리(웹): 같은 해시, 서버와 같은 함수', () => {
  assert.equal(artHash('abc'), artHash('abc'));
  assert.notEqual(artHash('abc'), artHash('abd'));
  const f = foldRef(file('secret/plan.docx', 'create'));
  assert.match(f.id, /^secret\/#[0-9a-f]{6}\.docx$/);
  assert.equal(sanitizeArt([{ k: 'file', id: 'a', v: 'nope' }]), null);
});

test('mock: 시나리오가 생성·수정·삭제·DB 쓰기·push·파괴적 작업을 모두 담고, 드라이버는 결정적', async () => {
  const kinds = new Set(), verbs = new Set(), xs = new Set();
  for (const [, , , a1] of ART_MOCK) for (const r of a1) { kinds.add(r.k); verbs.add(r.v); if (r.x) xs.add(r.x); }
  for (const k of ['file', 'output', 'repo', 'db', 'remote', 'service']) assert.ok(kinds.has(k), k);
  for (const v of ['create', 'modify', 'delete', 'write', 'push']) assert.ok(verbs.has(v), v);
  for (const x of ['rm', 'drop', 'force', 'overwrite']) assert.ok(xs.has(x), x);
  const p = artMockPayload('mock', T);
  assert.ok(p.items.length > 30 && p.items.some((x) => x.k === 'db') && p.items.some((x) => x.del));
  assert.deepEqual(artHistorySample('a', T).map((r) => r.tu), artHistorySample('a', T).map((r) => r.tu));
  const run = () => new Promise((res) => {
    const got = [];
    const d = new ArtMockDriver({ nodes: () => [{ id: 's:m', kind: 'main', status: 'active' }, { id: 'a:x', kind: 'subagent', status: 'idle' }], emit: (ev) => got.push(ev.type + ':' + ev.nodeId + ':' + ev.toolUseId), first: 1 });
    d._at = (ms, fn) => { if (d.on) setImmediate(fn); }; // 시계 없이 순서만
    d.start(); d._tick(); d._tick(); d._tick(); d.stop(); res(got);
  });
  assert.deepEqual(await run(), await run());
});

test('바닥 글씨(§79.15): 이름 줄(경로 마지막·두 줄)·판 크기(섬 폭 0.78×0.5, 슈퍼타원 안, 깊이 0.55 이하)·읽힘 문턱', async () => {
  const { artNameLines, artNamePlate, artNameReadable, inIsland: inI } = await import('../artifact-core.mjs');
  assert.deepEqual(artNameLines('md2report'), ['md2report']);
  assert.deepEqual(artNameLines('(임시) scratchpad/ccviz-probe'), ['ccviz-probe']);
  assert.deepEqual(artNameLines('Projects/2026'), ['Projects/2026'], '마지막 조각이 짧으면 끝 두 조각');
  assert.equal(artNameLines('survey-dashboard').length, 2);
  assert.deepEqual(artNameLines(''), []);
  const t = { hw: 20, hd: 10 };
  const p = artNamePlate(t, 0.2);
  assert.ok(Math.abs(p.w - 15.6) < 1e-6 && inI(p.w / 2, p.h / 2, t.hw, t.hd, 0.96));
  const q = artNamePlate(t, 1.2);
  assert.ok(q.h <= t.hd * 2 * 0.55 + 1e-6 && inI(q.w / 2, q.h / 2, t.hw, t.hd, 0.96));
  assert.equal(artNamePlate(null, 0.3), null);
  assert.ok(artNameReadable(30) && !artNameReadable(10));
});

test('바닥 글씨 방향(§79.15): 카메라 방위의 가장 가까운 90° 단위·경계 흔들림 없음·부드러운 회전(최단)·움직임 줄이기 즉시·90° 면 판 크기 축 바꿈', async () => {
  const { artNameYaw, artAngleStep, artNamePlateYaw } = await import('../artifact-core.mjs');
  const Q = Math.PI / 2;
  assert.equal(artNameYaw(0, 10), 0);
  assert.equal(artNameYaw(10, 0), Q);
  assert.ok(Math.abs(Math.abs(artNameYaw(0, -10)) - Math.PI) < 1e-9, '뒤에서 보면 180°');
  assert.equal(artNameYaw(10, 9, 0), 0, '45°+10° 안이면 그대로(흔들림 방지)');
  assert.equal(artNameYaw(10, 5, 0), Q);
  assert.equal(artAngleStep(0, Math.PI, 0.016, true), Math.PI);
  let a = 0; for (let i = 0; i < 40; i++) a = artAngleStep(a, Q, 0.016); // 0.64초
  assert.ok(Math.abs(a - Q) < 0.02, `0.6초 안팎에 거의 다(${a.toFixed(3)})`);
  const b = artAngleStep(3.0, -3.0, 0.1);
  assert.ok(b > 3.0, '최단 방향(±π 넘어)');
  const t = { hw: 30, hd: 10 };
  assert.ok(artNamePlateYaw(t, 0.25, Q).w < artNamePlateYaw(t, 0.25, 0).w, '90° 면 좁은 축에 맞춤');
});
