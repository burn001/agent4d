// node --test "web/test/lab-dyn-platform.test.mjs"   [B] Artifact Layer(플랫폼) 동적 표현 — 동사 색(blockTint)·읽기/쓰기 구별(스캔 막·윗판 교체)·
// 프린트 갠트리·파도 블록 튐·구역 활동 열(sectorHeat)·코어 고리·맥동 위상·기자재발 운반(env.actOrigin)·상한·2D 반영
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAB, LAB_PERF } from '../lab/lab-const.mjs';
import { LP, labSectorPlan, labPlatformGeometry, blockTint, sectorHeat, sectorHeatA, newBulkMem } from '../lab/lab-platform-core.mjs';
import { drawPlatformDynamic2D } from '../flat/lab2d-platform.js';
import { computeLab } from '../lab/lab-layout-core.mjs';
import { ArtBook, ArtFx, ArtGeo, ART_KEYS, artKeyColor } from '../artifact-core.mjs';
import { KI } from '../art-meta.mjs';

const H = LAB.PLATFORM.H, CR = LAB.PLATFORM.CORE_R;
const ts = (s) => new Date(Date.UTC(2026, 10, 1, 0, 0, s)).toISOString();
const T0 = Date.parse(ts(0));
const ev = (type, art, s, tu) => ({ type, ts: ts(s), nodeId: 'n1', toolUseId: tu, art });
const F = (path) => { const k = path.lastIndexOf('/'); return { k: 'file', id: path.toLowerCase(), p: path, d: path.slice(0, k), n: path.slice(k + 1), v: 'create', sz: 10 }; };

function scene(n = 20, folders = 2, rP = 12) {
  const book = new ArtBook(), pid = book.defaultProject;
  for (let i = 0; i < n; i++) book.touch(pid, F(`src${i % folders}/f${i}.js`), T0 - 3600_000 + i, 'n1', `tu${i}`);
  const plan = labSectorPlan(book.layoutItems(pid).items, rP, null);
  const plans = new Map([[pid, { plan, cx: 0, cz: 0, rWall: 30 }]]);
  return { book, pid, plan, plans, fx: new ArtFx() };
}
const env = (o = {}) => ({ nowMs: T0 + 60_000, reduced: false, foot: null, hover: null, hits: [], nodePos: () => ({ x: 0, y: 3, z: 20 }), style: null, isLight: false, unitPx: () => 30, ...o });
const boxes = (g, f) => { const out = []; for (let i = 0; i < g.nb; i++) { const o = i * 6, b = { x: g.B[o], y: g.B[o + 1], z: g.B[o + 2], sx: g.B[o + 3], sy: g.B[o + 4], sz: g.B[o + 5], c: g.BC[i], a: g.BA[i], ref: g.BI[i] }; if (f(b)) out.push(b); } return out; };
const lines = (g, f) => { let n = 0; for (let i = 0; i < g.nl; i++) { const o = i * 6; if (f({ x0: g.L[o], y0: g.L[o + 1], z0: g.L[o + 2], x1: g.L[o + 3], y1: g.L[o + 4], z1: g.L[o + 5], c: g.LC[i], w: g.LW[i] })) n++; } return n; };
const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;
const bodyOf = (g, id) => boxes(g, (b) => b.ref && b.ref.id === id);
const apply = (S, art, s, tu, nowSec, node = 'n1') => S.fx.note(S.book.apply({ ...ev('tool-end', art, s, tu), nodeId: node }, S.pid), node, nowSec);
const actOf = (S, a, id) => S.fx.acts.list.find((e) => e.a === a && (id == null || e.id === id));

test('(1) blockTint: create 5초 전 → new a=1 · modify 90초 전 → write 0<a<1 · 3분 전 → null · 읽기만 → null', () => {
  const now = 1_000_000;
  const it = (v, dt, extra = {}) => ({ id: 'x', cnt: { [v]: 1 }, last: now - dt, log: [{ t: now - dt, v }], ...extra });
  let r = blockTint(it('create', 5000), now); assert.equal(r.key, 'new'); assert.equal(r.a, 1);
  r = blockTint(it('modify', 90_000), now); assert.equal(r.key, 'write'); assert.ok(r.a > 0 && r.a < 1, `a ${r.a}`);
  r = blockTint(it('modify', 180_000), now); assert.ok(r.key === null || r.a === 0);
  r = blockTint({ id: 'x', cnt: { read: 3 }, last: now - 1000, log: [{ t: now - 1000, v: 'read' }] }, now); assert.equal(r.key, null);
  r = blockTint(it('delete', 1000, { del: 1 }), now); assert.equal(r.key, 'del');
  // 쓰기 뒤 읽기가 it.last 를 밀어도 색은 쓰기 시각 기준
  r = blockTint({ id: 'x', cnt: { create: 1, read: 1 }, last: now - 1000, log: [{ t: now - 200_000, v: 'create' }, { t: now - 1000, v: 'read' }] }, now);
  assert.equal(r.key, null, '읽기는 색을 되살리지 않음');
  // log 없으면 cnt 로 추정
  r = blockTint({ id: 'x', cnt: { create: 1, modify: 2 }, last: now - 1000 }, now); assert.equal(r.key, 'write');
  const out = { key: null, a: 0, d: 0 }; assert.equal(blockTint(it('create', 0), now, out), out, 'out 재사용');
});

test('(2) 읽기 연출: k 0.5 에서 블록 몸 높이 합 불변(±1e-6) · 파란 세로 스캔 막 ≥ 1', () => {
  const S = scene();
  const id = [...S.plan.cellOf.keys()][3], it = S.book.get(S.pid, id);
  const e = env();
  const g0 = labPlatformGeometry(S.book, S.plans, S.fx, 5, e, new ArtGeo());
  const h0 = bodyOf(g0, id).reduce((s, b) => s + b.sy, 0), y0 = bodyOf(g0, id).reduce((s, b) => s + b.y, 0);
  S.fx.note(S.book.apply(ev('tool-start', [{ k: 'file', id, p: it.p, d: it.d, n: it.n, v: 'read' }], 30, 'tuR'), S.pid), 'n1', 10);
  const R = actOf(S, 'read', id); assert.ok(R, 'read 연출');
  const g = labPlatformGeometry(S.book, S.plans, S.fx, R.t0 + R.dur * 0.5, e, new ArtGeo());
  const body = bodyOf(g, id);
  assert.ok(Math.abs(body.reduce((s, b) => s + b.sy, 0) - h0) < 1e-6, '높이 합 불변');
  assert.ok(Math.abs(body.reduce((s, b) => s + b.y, 0) - y0) < 1e-6, '자리 불변');
  const c = S.plan.cellOf.get(id);
  const film = boxes(g, (b) => b.c === KI.read && near(b.sy, 0.5) && (near(b.sx, 0.03) || near(b.sz, 0.03)) && Math.hypot(b.x - c.x, b.z - c.z) < 0.6);
  assert.ok(film.length >= 1, '스캔 막');
  // 읽기 귀환: 블록 → 사람 파란 캡슐
  const g2 = labPlatformGeometry(S.book, S.plans, S.fx, R.t0 + R.dur * 0.6, e, new ArtGeo());
  assert.ok(boxes(g2, (b) => b.c === KI.read && near(b.sx, 0.14)).length >= 1, '파란 캡슐');
});

test('(3) 고치기: k 0.2 에 윗판이 접선으로 ≥ 0.15m 밀려 나감, k 0.95 에 원위치 · 그 뒤 호박 테', () => {
  const S = scene();
  const id = [...S.plan.cellOf.keys()][5], it = S.book.get(S.pid, id), c = S.plan.cellOf.get(id);
  apply(S, [{ k: 'file', id, p: it.p, d: it.d, n: it.n, v: 'modify', sz: 20 }], 30, 'tuE', 10);
  const E = actOf(S, 'edit', id); assert.ok(E);
  const plateD = (g) => boxes(g, (b) => near(b.sy, LP.TINT_TH) && Math.hypot(b.x - c.x, b.z - c.z) < 1.2).map((b) => Math.hypot(b.x - c.x, b.z - c.z));
  const e = env({ nowMs: Date.parse(ts(30)) + 1000 });
  const d1 = plateD(labPlatformGeometry(S.book, S.plans, S.fx, E.t0 + E.dur * 0.2, e, new ArtGeo()));
  assert.ok(d1.length >= 1 && Math.max(...d1) >= 0.15, `밀려 나감 ${d1}`);
  const d2 = plateD(labPlatformGeometry(S.book, S.plans, S.fx, E.t0 + E.dur * 0.95, e, new ArtGeo()));
  assert.ok(d2.length >= 1 && Math.max(...d2) < 1e-3, `원위치 ${d2}`);
  // 끝난 뒤 0.5초: 호박 테(rect 4선, 윗면 바로 위)
  S.fx.step(E.t0 + E.dur + 0.5);
  const g3 = labPlatformGeometry(S.book, S.plans, S.fx, E.t0 + E.dur + 0.5, e, new ArtGeo());
  assert.ok(lines(g3, (l) => l.c === KI.write && Math.abs(l.x0 - c.x) < 0.6 && Math.abs(l.z0 - c.z) < 0.6) >= 4, '호박 테');
  // 동사 색 윗판: 고친 뒤 호박
  assert.ok(boxes(g3, (b) => b.c === KI.write && near(b.sy, LP.TINT_TH) && near(b.x, c.x) && near(b.z, c.z)).length === 1, '호박 윗판');
});

test('(4) 새로 만들기: k 0.5 에 갠트리 레일 ≥ 2 + 헤드 1, k ≥ 1 이면 0, 원경이면 헤드 없음', () => {
  const S = scene(10, 2);
  const nid = 'src0/brand-new.js';
  apply(S, [{ ...F('src0/brand-new.js'), id: nid }], 30, 'tuN', 20);
  S.plans.get(S.pid).plan = labSectorPlan(S.book.layoutItems(S.pid).items, 12, S.plan);
  const B = actOf(S, 'build', nid); assert.ok(B, 'build 연출');
  const e = env({ nowMs: Date.parse(ts(30)) + 1000 });
  const head = (g) => boxes(g, (b) => b.c === KI.new && near(b.sx, 0.2) && near(b.sy, 0.08)).length;
  const rails = (g) => lines(g, (l) => l.c === KI.new && l.w === 2);
  const g = labPlatformGeometry(S.book, S.plans, S.fx, B.t0 + B.dur * 0.5, e, new ArtGeo());
  assert.ok(rails(g) >= 2, `레일 ${rails(g)}`); assert.equal(head(g), 1);
  const ge = labPlatformGeometry(S.book, S.plans, S.fx, B.t0 + B.dur * 1.01 + 2, e, new ArtGeo());
  assert.equal(rails(ge), 0); assert.equal(head(ge), 0);
  const gf = labPlatformGeometry(S.book, S.plans, S.fx, B.t0 + B.dur * 0.5, env({ unitPx: () => 2 }), new ArtGeo());
  assert.equal(head(gf), 0, '원경 헤드 없음');
  // 중경(detail 미만): 헤드만
  const gm = labPlatformGeometry(S.book, S.plans, S.fx, B.t0 + B.dur * 0.5, env({ unitPx: () => 6 }), new ArtGeo());
  assert.equal(head(gm), 1); assert.equal(rails(gm), 0);
  // 새로 만든 블록 윗판 = 초록
  const c = S.plans.get(S.pid).plan.cellOf.get(nid);
  assert.equal(boxes(ge, (b) => b.c === KI.new && near(b.sy, LP.TINT_TH) && near(b.x, c.x) && near(b.z, c.z)).length, 1, '초록 윗판');
});

test('(5) 파도 튐: 파도 진행 중(k ≈ 0.3) 파두 근처 블록 y +0.05 넘게, 2칸 넘게 떨어진 블록 0, 움직임 줄이기면 모두 0', () => {
  const S = scene(216, 6, 12); // 구역 6 × 36 — 좁은 부채꼴이라 칸이 바깥 줄까지 참
  const sk = S.plan.sectors[0].key;
  const base = labPlatformGeometry(S.book, S.plans, S.fx, 100, env(), new ArtGeo());
  const yOf = (g) => { const m = new Map(); for (const b of boxes(g, (b) => b.ref && b.ref.id)) m.set(b.ref.id, Math.min(m.get(b.ref.id) ?? 1e9, b.y)); return m; };
  const Y0 = yOf(base);
  const P = S.plan, rf = P.rows[1], K = (rf - P.rIn) / (P.rP - P.rIn); // 파두가 둘째 줄에 걸린 순간
  const mk = (o = {}) => { const e = env(o); e._bulk = newBulkMem(); e._bulk.wave.set(S.pid + '|' + sk, { t0: 100 - LP.WAVE_S * K, n: 6 }); return e; };
  const g = labPlatformGeometry(S.book, S.plans, S.fx, 100, mk(), new ArtGeo());
  const Y1 = yOf(g);
  let nearUp = 0, farZero = 0;
  for (const [id, c] of P.cellOf) {
    if (c.sector !== sk) continue;
    const dy = Y1.get(id) - Y0.get(id), d = Math.abs(c.r - rf);
    if (d < LP.CELL * 0.4) { assert.ok(dy > 0.05, `파두 근처 ${dy}`); nearUp++; }
    if (d > LP.CELL * 2) { assert.ok(Math.abs(dy) < 1e-6, `먼 블록 ${dy}`); farZero++; }
  }
  assert.ok(nearUp >= 1 && farZero >= 1, `${nearUp}/${farZero}`);
  assert.ok(boxes(g, (b) => b.c === KI.write && near(b.sy, 0.016)).length >= 1, '파두 바닥 호박 판');
  const gr = labPlatformGeometry(S.book, S.plans, S.fx, 100, mk({ reduced: true }), new ArtGeo());
  const Yr = yOf(gr);
  for (const [id] of P.cellOf) assert.ok(Math.abs(Yr.get(id) - Y0.get(id)) < 1e-6, '움직임 줄이기 0');
});

test('(6) sectorHeat: 60초 안 6번 → a(6) > a(1) > 0, 마지막 뒤 200초 → 0, Map ≤ 64', () => {
  const m = new Map();
  const a1 = sectorHeat(m, 'A', 10, 10);
  for (let i = 1; i < 6; i++) sectorHeat(m, 'B', 10 + i * 5, 10 + i * 5);
  const a6 = sectorHeat(m, 'B', 40, 40);
  assert.ok(a1 > 0 && a6 > a1, `${a1} ${a6}`);
  assert.ok(a6 <= LP.HEAT_A + 1e-9);
  assert.equal(sectorHeatA(m, 'B', 40 + 30), a6, '60초 안은 그대로');
  const mid = sectorHeatA(m, 'B', 40 + 120); assert.ok(mid > 0 && mid < a6, '60～180초 줄어듦');
  assert.equal(sectorHeatA(m, 'B', 40 + 200), 0);
  assert.equal(sectorHeatA(m, 'none', 40), 0);
  for (let i = 0; i < 200; i++) sectorHeat(m, 'k' + i, 50 + i, 50 + i);
  assert.ok(m.size <= 64, `크기 ${m.size}`);
  // 도형: 쓰기 많은 구역 바닥 호박 빛 호(가산 선, 폭 2 — 판 대신)
  const S = scene(20, 2), id = [...S.plan.cellOf.keys()][0], it = S.book.get(S.pid, id);
  for (let i = 0; i < 4; i++) apply(S, [{ k: 'file', id, p: it.p, d: it.d, n: it.n, v: 'modify', sz: 1 }], 30 + i, 'tuH' + i, 10 + i);
  const e = env();
  labPlatformGeometry(S.book, S.plans, S.fx, 14, e, new ArtGeo());
  const g = labPlatformGeometry(S.book, S.plans, S.fx, 40, e, new ArtGeo());
  assert.ok(lines(g, (l) => l.c === KI.write && l.w === 2 && near(l.y0, H + 0.024)) >= LP.HEAT_ARCS, '활동 열 바닥 빛 호');
  assert.equal(boxes(g, (b) => b.c === KI.write && near(b.sy, 0.016)).length, 0, '불투명 바닥 판 없음');
  const gf = labPlatformGeometry(S.book, S.plans, S.fx, 40, { ...e, unitPx: () => 2, hits: [] }, new ArtGeo());
  assert.ok(lines(gf, (l) => l.c === KI.write && l.w === 2 && l.y0 > H + 0.1) >= 1, '원경 판 윗면 테');
});

test('(7) 운반 출발점: env.actOrigin {5,2,5} → carry 캡슐 첫 상자가 그 점 0.3m 안, null 이면 nodePos', () => {
  const S = scene();
  const id = [...S.plan.cellOf.keys()][2], it = S.book.get(S.pid, id);
  S.fx.note(S.book.apply(ev('tool-start', [{ k: 'file', id, p: it.p, d: it.d, n: it.n, v: 'modify' }], 30, 'tuBG'), S.pid), 'n1', 10, 1, 'tuBG'); // 앱(art-ui)처럼 tu 를 넘김
  const C = actOf(S, 'carry', id); assert.ok(C, 'carry 연출');
  const O = { x: 5, y: 2, z: 5 }, seen = [];
  const caps = (g) => boxes(g, (b) => b.c === KI.write && near(b.sx, LP.CAP_S));
  const g = labPlatformGeometry(S.book, S.plans, S.fx, C.t0 + C.dur * 0.01, env({ actOrigin: (e) => { seen.push(e.tu); return O; } }), new ArtGeo());
  const c1 = caps(g); assert.ok(c1.length >= 1, '캡슐');
  assert.ok(Math.hypot(c1[0].x - 5, c1[0].y - 2, c1[0].z - 5) < 0.3, `첫 상자 ${c1[0].x},${c1[0].y},${c1[0].z}`);
  assert.ok(seen.includes('tuBG'), 'e.tu 로 물음');
  const NP = { x: -4, y: 1.5, z: 9 };
  const g2 = labPlatformGeometry(S.book, S.plans, S.fx, C.t0 + C.dur * 0.01, env({ actOrigin: () => null, nodePos: () => NP }), new ArtGeo());
  const c2 = caps(g2); assert.ok(c2.length >= 1 && Math.hypot(c2[0].x - NP.x, c2[0].y - NP.y, c2[0].z - NP.z) < 0.3, 'nodePos 에서');
  // 도착 무렵: 블록 쪽
  const c = S.plan.cellOf.get(id);
  const g3 = labPlatformGeometry(S.book, S.plans, S.fx, C.t0 + C.dur * 0.7, env({ actOrigin: () => O }), new ArtGeo());
  const c3 = caps(g3); assert.ok(c3.length >= 1 && Math.hypot(c3[0].x - c.x, c3[0].z - c.z) < Math.hypot(5 - c.x, 5 - c.z), '블록으로 다가감');
  // 원경: 꼬리 없이 몸 하나
  const gf = labPlatformGeometry(S.book, S.plans, S.fx, C.t0 + C.dur * 0.3, env({ actOrigin: () => O, unitPx: () => 2 }), new ArtGeo());
  assert.equal(boxes(gf, (b) => b.c === KI.write && b.sx <= LP.CAP_S + 1e-6 && b.sx > 0.05 && Math.abs(b.sx - b.sy) < 1e-6).length, 1);
});

test('(8) 상한: 대상 500·연출 160 장면 — 블록 ≤ 300, 선 ≤ 7,000, 라벨 ≤ 14', () => {
  const S = scene(500, 20, 14);
  const ids = [...S.plan.cellOf.keys()];
  const A = ['build', 'edit', 'read', 'carry', 'shatter'];
  for (let i = 0; i < 160; i++) S.fx.acts.list.push({ a: A[i % 5], pid: S.pid, id: ids[i % ids.length], node: 'n1', k: 'file', sz: 5, tu: 't' + i, v: null, t0: 9.5, dur: 1.5, base: 1.5, n: 1 + (i % 3) });
  S.fx.acts.version++;
  const e = env({ actOrigin: (x) => (x.tu.endsWith('0') ? { x: 3, y: 2, z: 3 } : null) });
  const g = labPlatformGeometry(S.book, S.plans, S.fx, 10.2, e, new ArtGeo());
  assert.ok(S.plan.nBlocks <= LP.BLOCKS_MAX);
  assert.ok(new Set(boxes(g, (b) => b.ref && b.ref.id && !b.ref.id.startsWith('#')).map((b) => b.ref.id)).size <= LP.BLOCKS_MAX, '블록');
  assert.ok(g.nl <= LAB_PERF.PLATFORM_LINES, `선 ${g.nl}`);
  assert.ok(g.labels.length <= LAB_PERF.PLATFORM_LABELS);
  assert.ok(boxes(g, (b) => near(b.sx, LP.CAP_S) || near(b.sx, 0.14)).length <= LP.CAP_MAX * 4, '캡슐 상한');
});

test('(9) 코어: 10초 안 쓰기 5번 → 퍼지는 고리, 쓰기 없으면 0 · 위상 단조 증가, 한 프레임 증분 ≤ 1.2·0.25', () => {
  const ringLines = (g) => lines(g, (l) => l.c === KI.write && near(l.y0, H + 0.012 + 0.06) && Math.hypot(l.x0, l.z0) >= CR - 1e-3 && Math.hypot(l.x0, l.z0) <= CR + LP.CORE_RING_DR + 0.01);
  const S0 = scene(10, 2);
  assert.equal(ringLines(labPlatformGeometry(S0.book, S0.plans, S0.fx, 5, env(), new ArtGeo())), 0, '쓰기 없으면 0');
  const S = scene(10, 2), ids = [...S.plan.cellOf.keys()];
  for (let i = 0; i < 5; i++) { const it = S.book.get(S.pid, ids[i]); apply(S, [{ k: 'file', id: ids[i], p: it.p, d: it.d, n: it.n, v: 'modify', sz: 1 }], 30 + i, 'tuC' + i, 10 + i * 1.5); }
  const e = env();
  let prev = -1, maxInc = 0;
  for (let f = 0; f <= 60; f++) {
    const now = 10 + f * 0.1;
    const g = labPlatformGeometry(S.book, S.plans, S.fx, now, e, new ArtGeo());
    if (f === 3) assert.ok(ringLines(g) > 0, '퍼지는 고리');
    const ph = e._corePh.get(S.pid).ph;
    if (prev >= 0) { assert.ok(ph >= prev - 1e-12, '단조'); maxInc = Math.max(maxInc, ph - prev); }
    prev = ph;
  }
  assert.ok(prev > 0, '돌았음');
  labPlatformGeometry(S.book, S.plans, S.fx, 30, e, new ArtGeo()); // 큰 dt(14초)
  assert.ok(e._corePh.get(S.pid).ph - prev <= LP.CORE_WMAX * LP.CORE_DT + 1e-9, 'dt 상한');
  assert.ok(maxInc <= LP.CORE_WMAX * LP.CORE_DT + 1e-9);
  // 10초 넘게 쉬면 멈춤
  const p1 = e._corePh.get(S.pid).ph; labPlatformGeometry(S.book, S.plans, S.fx, 30.2, e, new ArtGeo());
  assert.equal(e._corePh.get(S.pid).ph, p1, '쉬면 멈춤');
});

function rec2d() {
  const log = [], ctx = { log, lineWidth: 1, globalAlpha: 1, strokeStyle: '', fillStyle: '', font: '' };
  for (const k of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'ellipse', 'rect', 'roundRect', 'fillRect', 'strokeRect', 'save', 'restore', 'setLineDash', 'fillText']) ctx[k] = () => { log.push({ op: k }); };
  ctx.stroke = () => log.push({ op: 'stroke', w: ctx.lineWidth, a: ctx.globalAlpha, c: ctx.strokeStyle });
  ctx.fill = () => log.push({ op: 'fill', a: ctx.globalAlpha, c: ctx.fillStyle });
  ctx.measureText = (s) => ({ width: String(s).length * 7 });
  return ctx;
}
test('(10) 2D: write 블록 채움이 write 색, read 연출 중 테가 read 색 2px 이상, 코어 고리', () => {
  const S = scene(20, 2);
  const room = computeLab([{ id: 'm', kind: 'main', order: 0, status: 'active', label: 'main' }], 'm', null, {}).rooms[0];
  const s = 12, view = { _s: s, pal: {}, tokens: { text: '#eee', isLight: false }, reduced: false, clock: () => Date.parse(ts(31)) };
  view._X = (x) => x * s + 400; view._Y = (z) => z * s + 300;
  const ids = [...S.plan.cellOf.keys()], it = S.book.get(S.pid, ids[0]);
  apply(S, [{ k: 'file', id: ids[0], p: it.p, d: it.d, n: it.n, v: 'modify', sz: 1 }], 30, 'tuW', 10);
  const W = artKeyColor('write', false), R = artKeyColor('read', false);
  const c1 = rec2d();
  assert.equal(drawPlatformDynamic2D(c1, view, room, S.plan, S.book, S.fx, 10.2), true);
  assert.ok(c1.log.some((l) => l.op === 'fill' && l.c === W && l.a > 0.5), 'write 채움');
  assert.ok(c1.log.some((l) => l.op === 'stroke' && l.c === W), '코어 고리');
  const it2 = S.book.get(S.pid, ids[1]);
  S.fx.note(S.book.apply(ev('tool-start', [{ k: 'file', id: ids[1], p: it2.p, d: it2.d, n: it2.n, v: 'read' }], 31, 'tuRd'), S.pid), 'n1', 20);
  const c2 = rec2d();
  drawPlatformDynamic2D(c2, view, room, S.plan, S.book, S.fx, 20.3);
  assert.ok(c2.log.some((l) => l.op === 'stroke' && l.c === R && l.w >= 2), 'read 테');
  assert.equal(ART_KEYS[KI.write], 'write');
  // 움직임 줄이기: 코어 고리 없음
  const c3 = rec2d();
  drawPlatformDynamic2D(c3, { ...view, reduced: true }, room, S.plan, S.book, S.fx, 20.3);
  assert.ok(!c3.log.some((l) => l.op === 'stroke' && l.c === W && l.w === Math.max(1.5, 0.08 * s)), '정지');
});

test('(11) LabPlatform3D._actOrigin: e.tu === 기자재 node.meta.toolUseId → 꼭대기(보간 자리), Map 은 _layoutVer 가 바뀔 때만, 결과 객체 재사용', async () => {
  const { readFileSync } = await import('node:fs');
  const { RIG_HEIGHT } = await import('../lab/lab-rig-core.mjs');
  const src = readFileSync(new URL('../lab/lab-platform.js', import.meta.url), 'utf8');
  assert.ok(src.includes('env.actOrigin = this._actOriginFn'), '_prepare 가 한 번 만든 함수를 넘김');
  const m = /\r?\n {2}_actOrigin\(e\) \{\r?\n([\s\S]*?)\r?\n {2}\}\r?\n/.exec(src); assert.ok(m, '_actOrigin 본문');
  const fn = new Function('RIG_HEIGHT', `return function (e) {\n${m[1]}\n}`)(RIG_HEIGHT); // three 없이 본문만 시험
  const rig = { id: 'b1', pos: { type: 'rig', rigKind: 'reactor', x: 4, z: -3 }, released: false, node: { meta: { toolUseId: 'tuBash' } } };
  const desk = { id: 'n1', pos: { type: 'desk', x: 0, z: 0 }, node: { meta: { toolUseId: 'tuBash' } } };
  let tweenCalls = 0;
  const view = { machines: new Map([['n1', desk], ['b1', rig]]), nodes: new Map(), _layoutVer: 1, _tweenPos: (q) => { tweenCalls++; return { x: q.pos.x + 0.5, z: q.pos.z }; } };
  const self = { view, _tuRig: new Map(), _tuVer: -1, _tuN: -1, _ao: { x: 0, y: 0, z: 0 } };
  const o = fn.call(self, { tu: 'tuBash' });
  assert.ok(o && near(o.x, 4.5) && near(o.z, -3) && near(o.y, RIG_HEIGHT.reactor + 0.2), JSON.stringify(o));
  assert.equal(fn.call(self, { tu: 'other' }), null);
  assert.equal(fn.call(self, { tu: null }), null);
  assert.equal(fn.call(self, { tu: 'tuBash' }), o, '결과 객체 재사용');
  rig.node = { meta: { toolUseId: 'tuNew' } }; // 같은 배치 판 — 다시 만들지 않음
  assert.ok(fn.call(self, { tu: 'tuBash' }));
  view._layoutVer = 2; // 배치가 바뀜 → 다시 만듦
  assert.equal(fn.call(self, { tu: 'tuBash' }), null);
  assert.ok(fn.call(self, { tu: 'tuNew' }));
  rig.released = true; assert.equal(fn.call(self, { tu: 'tuNew' }), null, '떠난 기자재');
  assert.ok(tweenCalls >= 3);
});
