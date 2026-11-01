// node --test "web/test/lab-platform.test.mjs"   복셀 연구소 플랫폼(작업 대상 층, 설계): 구역 계획 결정성·안정·각·상한·묶음·LOD·성능,
// 블록 모양, 반지름 히스테리시스, 테두리 장치 자리, 도형(상한·경보·push·대량 변경 파도·움직임 줄이기·라이트), i18n
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAB, LAB_PERF, thetaOf } from '../lab/lab-const.mjs';
import { LP, labSectorPlan, labBlockShape, labBlockHeight, labBlockSub, labPlatformGeometry, labPlatformRadius, LabRadiusGate, platformRows,
  sectorCells, rimSlotsFor, bulkNote, newBulkMem } from '../lab/lab-platform-core.mjs';
import { ArtBook, ArtFx, ArtGeo, ARTGEO } from '../artifact-core.mjs';
import { KI } from '../art-meta.mjs';
import { MESSAGES } from '../i18n.mjs';

const F = (path, i = 0, o = {}) => { const k = path.lastIndexOf('/'); return { id: path.toLowerCase(), k: 'file', p: path, d: k < 0 ? '' : path.slice(0, k), n: path.slice(k + 1), first: 1000 + i, last: 1000 + i, cnt: { create: 1 }, who: [], log: [], ...o }; };
const files = (n, folders = 5, pre = 'src') => Array.from({ length: n }, (_, i) => F(`${pre}${i % folders}/f${i}.js`, i));
const deg = (s) => s.th1 - s.th0;

test('구역 계획: 결정적(같은 입력 → 같은 결과)·칸은 칸 띠 안·서로 겹치지 않음', () => {
  const items = files(60, 6);
  const a = labSectorPlan(items, 11, null), b = labSectorPlan(items.slice().reverse(), 11, null);
  assert.deepEqual([...a.cellOf].map(([k, c]) => [k, c.x, c.z]).sort(), [...b.cellOf].map(([k, c]) => [k, c.x, c.z]).sort());
  assert.deepEqual(a.sectors.map((s) => [s.key, s.th0, s.th1]), b.sectors.map((s) => [s.key, s.th0, s.th1]));
  const pts = [...a.cellOf.values()];
  for (const c of pts) { const r = Math.hypot(c.x, c.z); assert.ok(r >= a.rIn - 1e-6 && r <= a.rOut + 1e-6, `r ${r}`); }
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) > LP.BLOCK * 1.2, '칸 겹침');
  assert.equal(a.nBlocks, 60); assert.equal(a.more.n, 0);
});

test('구역 각: 225°(브리지)부터 시계 방향, 최소 18°, 합 ≤ 360, 큰 폴더가 넓음, 첫 등장 순서', () => {
  const items = [...files(30, 1, 'big'), ...files(3, 1, 'small').map((x, i) => ({ ...x, first: 5000 + i, last: 5000 + i }))];
  const p = labSectorPlan(items, 10, null);
  assert.equal(p.sectors[0].th1, LAB.BRIDGE_THETA, '첫 구역은 브리지 쪽에서 시작');
  assert.equal(p.sectors[0].key, 'f:big0');
  for (let i = 1; i < p.sectors.length; i++) assert.ok(Math.abs(p.sectors[i].th1 - p.sectors[i - 1].th0) < 1e-6, '이어 붙음(시계 방향)');
  const sum = p.sectors.reduce((s, x) => s + deg(x), 0);
  assert.ok(sum <= 360 + 1e-6);
  for (const s of p.sectors) assert.ok(deg(s) >= LP.SECTOR_MIN - 1e-6);
  assert.ok(deg(p.sectors[0]) > deg(p.sectors[1]));
  assert.ok(sum <= 360 - LP.RESERVE + 1e-6, '새 폴더 몫 남김');
});

test('안정: 대상이 늘거나 빠져도 남은 대상 칸·구역 각 그대로, 새 폴더는 남은 각에서, 빠지면 칸만 빔', () => {
  const base = files(20, 3);
  const p1 = labSectorPlan(base, 10, null);
  const p2 = labSectorPlan([...base, F('src1/new.js', 99), F('docs/a.md', 100)], 10, p1);
  for (const [id, c] of p1.cellOf) { const c2 = p2.cellOf.get(id); assert.ok(c2 && c2.x === c.x && c2.z === c.z, id); }
  for (const s of p1.sectors) { const s2 = p2.sectors.find((x) => x.key === s.key); assert.equal(s2.th0, s.th0); assert.equal(s2.th1, s.th1); }
  const docs = p2.sectors.find((s) => s.key === 'f:docs');
  assert.ok(docs && docs.th1 <= p1.sectors[p1.sectors.length - 1].th0 + 1e-6, '새 폴더는 남은 각');
  const gone = base[4].id;
  const p3 = labSectorPlan([...base.filter((x) => x.id !== gone), F('src1/new.js', 99), F('docs/a.md', 100)], 10, p2);
  assert.ok(!p3.cellOf.has(gone));
  for (const [id, c] of p3.cellOf) { const c2 = p2.cellOf.get(id); assert.ok(c2 && c2.x === c.x, id); }
  // 반지름이 바뀌면 다시 나눔(각 재배분)
  const p4 = labSectorPlan([...base, F('src1/new.js', 99), F('docs/a.md', 100)], 13, p2);
  assert.notEqual(p4.sectors[0].th0, p2.sectors[0].th0);
  assert.equal(p4.rP, 13);
});

test('상한: 이름 구역 12 + …, 구역당 블록 36(넘으면 묶음 +n), 블록 300 넘으면 구역 판(agg)', () => {
  const many = files(480, 14);
  const p = labSectorPlan(many, 14, null);
  const named = p.sectors.filter((s) => !s.more);
  assert.ok(named.length <= LP.SECTOR_MAX);
  assert.ok(p.sectors.length <= LAB_PERF.PLATFORM_SECTOR_BOXES);
  assert.ok(p.sectors.some((s) => s.more), '… 구역');
  assert.ok(p.more.folders >= 2);
  for (const s of p.sectors) assert.ok(s.cells.filter((c) => c.key).length <= LP.PER_SECTOR);
  assert.equal(p.nBlocks + p.more.n, 480, '모든 대상이 칸이나 묶음에');
  assert.ok(p.nBlocks <= LP.BLOCKS_MAX);
  for (const s of p.sectors) if (s.over) { assert.equal(s.bundle.n, s.over); assert.ok(!s.cells[s.bundle.i].key, '묶음 자리는 비움'); }
  // 큰 플랫폼 + 폴더 많이 → 300 넘으면 agg
  const huge = labSectorPlan(files(500, 12).map((x) => x), 14, null);
  assert.equal(huge.agg, huge.nBlocks > LP.BLOCKS_MAX);
  // 새 폴더가 남은 각이 없으면 '…' 로 합침
  let q = labSectorPlan(files(24, 12), 9, null);
  q = labSectorPlan([...files(24, 12), F('zzz/a.js', 500)], 9, q);
  assert.ok(q.sectors.find((s) => s.key === '#more' || s.key === 'f:zzz'));
  assert.ok(q.sectors.filter((s) => !s.more).length <= LP.SECTOR_MAX);
});

test('성능: labSectorPlan 대상 500 < 8ms(평균)', () => {
  const items = files(500, 20);
  labSectorPlan(items, 14, null);
  const t0 = performance.now(); let prev = null;
  for (let i = 0; i < 10; i++) prev = labSectorPlan(items, 14, i % 2 ? prev : null);
  const ms = (performance.now() - t0) / 10;
  assert.ok(ms < LAB_PERF.SECTOR_PLAN_MS_500, `${ms.toFixed(2)}ms`);
});

test('칸·테두리 자리: 줄 간격 1.15, 좁은 구역도 묶음 자리 하나, 장치 방위 범위·겹침 없음', () => {
  const { rows, rIn, rOut } = platformRows(9);
  assert.ok(rows.length >= 3);
  for (let i = 1; i < rows.length; i++) assert.ok(Math.abs(rows[i] - rows[i - 1] - LP.CELL) < 1e-3);
  assert.ok(rIn > LAB.PLATFORM.CORE_R && rOut < 9);
  const narrow = sectorCells(0, 5, rows);
  assert.ok(narrow.cells.length >= 1 && narrow.bundle >= 0);
  for (const [k, [a, b]] of [['output', LAB.RIM.BOARD], ['db', LAB.RIM.DB], ['remote', LAB.RIM.REMOTE]]) {
    const s = rimSlotsFor(k, 10);
    for (const x of s) { const th = thetaOf(0, 0, x.x, x.z); assert.ok(th >= a - 1e-6 && th <= b + 1e-6, `${k} ${th}`); }
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) assert.ok(Math.hypot(s[i].x - s[j].x, s[i].z - s[j].z) > 0.6, k);
  }
  assert.equal(rimSlotsFor('repo', 10)[0].x, 0);
  assert.ok(rimSlotsFor('service', 10).every((s) => s.y > LAB.PLATFORM.H + 2));
  const p = labSectorPlan([{ id: 'db:a', k: 'db', first: 1, last: 1 }, { id: 'out/a.pdf', k: 'output', first: 2, last: 2, d: 'out', n: 'a.pdf' }, { id: 'repo:x', k: 'repo', first: 3, last: 3 },
    ...Array.from({ length: 7 }, (_, i) => ({ id: 'svc:' + i, k: 'service', first: 10 + i, last: 10 + i }))], 10, null);
  assert.equal(p.rim.get('db:a').k, 'db'); assert.equal(p.rim.get('repo:x').i, 0);
  assert.equal(p.over.service, 1, '서비스 6 상한');
});

test('블록 모양: 하위 종류마다 다르고 높이 0.15～1.2, 상자 ≤ 3', () => {
  const subs = { 'a.js': 'code', 'a.md': 'doc', 'a.json': 'data', 'a.png': 'image', 'plan.md': 'plan' };
  const sigs = new Set();
  for (const [n, sub] of Object.entries(subs)) {
    const it = F('src/' + n, 0, { cnt: { create: 1, modify: 6 }, sz: 80 });
    assert.equal(labBlockSub(it), sub);
    const sh = labBlockShape(it);
    assert.ok(sh.length >= 1 && sh.length <= 3);
    sigs.add(JSON.stringify(sh.map((b) => [b.sx, b.sy, b.sz].map((v) => +v.toFixed(2)))));
  }
  assert.equal(sigs.size, 5, '모양 5가지');
  assert.equal(labBlockSub(F('a/.env', 0, { imp: 'secret' })), 'secret');
  assert.equal(labBlockSub({ ...F('a/x.js'), del: 1 }), 'del');
  assert.equal(labBlockHeight({ cnt: {} }), LP.H_MIN);
  assert.equal(labBlockHeight({ cnt: { modify: 1e6 }, sz: 1e9 }), LP.H_MAX);
  assert.ok(labBlockHeight({ cnt: { modify: 10 } }) > labBlockHeight({ cnt: { modify: 1 } }));
});

test('플랫폼 반지름: 0.5 단위·7～14, 커질 때 바로, 줄 때 10분 히스테리시스(재생 되감기 안전)', () => {
  assert.equal(labPlatformRadius(0), 7);
  assert.equal(labPlatformRadius(1e6), 14);
  assert.equal(labPlatformRadius(36) % 0.5, 0);
  assert.equal(labPlatformRadius(100, 9, 0), labPlatformRadius(100));
  assert.equal(labPlatformRadius(0, 12, 60_000), 12);
  assert.equal(labPlatformRadius(0, 12, LP.HYST_MS), 7);
  const g = new LabRadiusGate(9);
  assert.equal(g.step(36, 0), labPlatformRadius(36));
  const big = g.r;
  assert.equal(g.step(0, 1000), big);
  assert.equal(g.step(0, 1000 + LP.HYST_MS - 1), big);
  assert.equal(g.step(0, 1000 + LP.HYST_MS + 1), 7);
  const g2 = new LabRadiusGate(12); g2.step(0, 50_000); assert.equal(g2.step(0, 10), 12, '시계가 뒤로 가면 다시 잼');
});

test('대량 변경: 같은 구역 10초 안 6번째 쓰기에 파도, 파도 중엔 다시 안 남', () => {
  const m = newBulkMem();
  let n = 0;
  for (let i = 0; i < 5; i++) n = bulkNote(m, 's', i, i);
  assert.equal(n, 0);
  assert.equal(bulkNote(m, 's', 5, 5), 6);
  assert.equal(bulkNote(m, 's', 5.5, 5.5), 0);
  const m2 = newBulkMem();
  for (let i = 0; i < 6; i++) n = bulkNote(m2, 's', i * 3, i * 3);
  assert.equal(n, 0, '10초 창 밖은 셈하지 않음');
});

// ── 도형 ──
const ts = (s) => new Date(Date.UTC(2026, 10, 1, 0, 0, s)).toISOString();
function scene(n = 40, folders = 6) {
  const book = new ArtBook(), fx = new ArtFx(), pid = book.defaultProject;
  for (let i = 0; i < n; i++) { const it = files(n, folders)[i]; book.touch(pid, { k: 'file', id: it.id, p: it.p, d: it.d, n: it.n, v: 'create', sz: 10 }, 1000 + i, 'n1', 'tu' + i); }
  book.touch(pid, { k: 'repo', id: 'repo:x', n: 'x', v: 'push', c: 2 }, 2000, 'n1', 'tuR');
  book.touch(pid, { k: 'db', id: 'db:m/a', n: 'a', v: 'write', coll: ['c'] }, 2001, 'n1', 'tuD');
  book.touch(pid, { k: 'remote', id: 'remote:s', n: 's', v: 'write', imp: 'prod' }, 2002, 'n1', 'tuM');
  book.touch(pid, { k: 'service', id: 'svc:cf', n: 'Cloudflare', v: 'write' }, 2003, 'n1', 'tuS');
  book.touch(pid, { k: 'output', id: 'out/r.pdf', p: 'out/r.pdf', d: 'out', n: 'r.pdf', v: 'create', imp: 'final' }, 2004, 'n1', 'tuO');
  const plan = labSectorPlan(book.layoutItems(pid).items, 12, null);
  const plans = new Map([[pid, { plan, cx: 0, cz: 0, rWall: 30 }]]);
  const env = (o = {}) => ({ nowMs: 3000, reduced: false, foot: null, hover: null, hits: [], nodePos: () => ({ x: 0, y: 3, z: 20 }), style: null, isLight: false, unitPx: () => 30, ...o });
  return { book, fx, pid, plan, plans, env };
}
const count = (g, ci, kind = 'L') => { let n = 0; if (kind === 'L') { for (let i = 0; i < g.nl; i++) if (g.LC[i] === ci) n++; } else if (kind === 'D') { for (let i = 0; i < g.nd; i++) if (g.DC[i] === ci) n++; } return n; };
const ev = (type, art, s, tu, extra = {}) => ({ type, ts: ts(s), nodeId: 'n1', toolUseId: tu, art, ...extra });

test('도형: 블록·테두리 장치·코어를 그리고 상한(블록 300·선 7,000·라벨 14)을 지킴, 집기 기준점', () => {
  const { book, fx, plans, env } = scene(40);
  const e = env();
  const g = labPlatformGeometry(book, plans, fx, 10, e, new ArtGeo());
  assert.ok(g.nb >= 40, `상자 ${g.nb}`);
  assert.ok(g.ny >= 2, 'DB 탱크 원기둥');
  assert.ok(g.nl > 100 && g.nl <= LAB_PERF.PLATFORM_LINES);
  assert.ok(g.labels.length <= LAB_PERF.PLATFORM_LABELS);
  assert.ok(e.hits.length >= 45);
  // 많을 때(480)·먼 거리(LOD)
  const S = scene(480, 14); const e2 = S.env();
  const g2 = labPlatformGeometry(S.book, S.plans, S.fx, 10, e2, new ArtGeo());
  assert.ok(g2.nl <= LAB_PERF.PLATFORM_LINES, `선 ${g2.nl}`);
  assert.ok(g2.nb <= ARTGEO.BOXES);
  assert.ok(S.plan.nBlocks <= LP.BLOCKS_MAX);
  const g3 = labPlatformGeometry(S.book, S.plans, S.fx, 10, S.env({ unitPx: () => 2 }), new ArtGeo());
  assert.ok(g3.nb <= LAB_PERF.PLATFORM_SECTOR_BOXES + 20, `먼 거리 상자 ${g3.nb}`);
});

test('도형: 새로 만들기 = 3D 프린트(헤드 빛줄)·고치기 = 층 교체·지우기 = 파쇄 조각·읽기 = 스캔', () => {
  const { book, fx, pid, plans, env } = scene(20, 3);
  const id = [...plans.get(pid).plan.cellOf.keys()][0];
  const it = book.get(pid, id);
  const base = labPlatformGeometry(book, plans, fx, 10, env(), new ArtGeo());
  const nNew0 = count(base, KI.new), nW0 = count(base, KI.write), nR0 = count(base, KI.read);
  fx.note(book.apply(ev('tool-end', [{ k: 'file', id, p: it.p, d: it.d, n: it.n, v: 'modify', sz: 30 }], 20, 'tuE'), pid), 'n1', 10);
  const ge = labPlatformGeometry(book, plans, fx, 10.4, env(), new ArtGeo());
  assert.ok(count(ge, KI.write) > nW0, '층 교체 선');
  fx.clear();
  const nid = 'src0/brand-new.js';
  fx.note(book.apply(ev('tool-end', [{ k: 'file', id: nid, p: nid, d: 'src0', n: 'brand-new.js', v: 'create', sz: 5 }], 21, 'tuN'), pid), 'n1', 20);
  const plan2 = labSectorPlan(book.layoutItems(pid).items, 12, plans.get(pid).plan); plans.get(pid).plan = plan2;
  const gp = labPlatformGeometry(book, plans, fx, 20.3, env(), new ArtGeo());
  assert.ok(count(gp, KI.new) > nNew0 + 4, '프린트 격자·헤드');
  fx.clear();
  fx.note(book.apply(ev('tool-end', [{ k: 'file', id, p: it.p, d: it.d, n: it.n, v: 'delete' }], 22, 'tuX'), pid), 'n1', 30);
  const gd = labPlatformGeometry(book, plans, fx, 30.3, env(), new ArtGeo());
  let shards = 0; for (let i = 0; i < gd.nb; i++) if (Math.abs(gd.B[i * 6 + 3] - 0.16) < 1e-6) shards++;
  assert.ok(shards >= 4, `파쇄 조각 ${shards}`);
  fx.clear();
  fx.note(book.apply(ev('tool-start', [{ k: 'file', id: plan2.cellOf.keys().next().value, v: 'read' }], 23, 'tuRd'), pid), 'n1', 40);
  const gr = labPlatformGeometry(book, plans, fx, 40.3, env(), new ArtGeo());
  assert.ok(count(gr, KI.read) > nR0, '스캔 고리');
});

test('도형: 위험 동작 = 붉은 파문 3겹 + 경광등 4 + 구역 빗금, 덮어쓰기 = 호박 파문 1, push = 코어 빛기둥', () => {
  const { book, fx, pid, plans, env } = scene(20, 3);
  const id = [...plans.get(pid).plan.cellOf.keys()][2], it = book.get(pid, id);
  const g0 = labPlatformGeometry(book, plans, fx, 5, env(), new ArtGeo());
  const a0 = count(g0, KI.alarm);
  fx.note(book.apply(ev('tool-end', [{ k: 'file', id, p: it.p, d: it.d, n: it.n, v: 'delete', x: 'rm', est: 1 }], 3, 'tuA'), pid), 'n1', 10);
  const g = labPlatformGeometry(book, plans, fx, 10.6, env({ nowMs: Date.parse(ts(3)) + 1000 }), new ArtGeo());
  assert.ok(count(g, KI.alarm) > a0 + 3 * 20, `붉은 선 ${count(g, KI.alarm)}`);
  assert.ok(count(g, KI.alarm, 'D') >= 4, '경광등 4');
  assert.ok(g.labels.some((l) => l.cls === 'art-alarm'));
  // 10분 뒤: 파문·경광등 없음, 빗금도 사라짐
  fx.clear();
  const gl = labPlatformGeometry(book, plans, fx, 100, env({ nowMs: Date.parse(ts(3)) + ART_MS + 1 }), new ArtGeo());
  assert.equal(count(gl, KI.alarm, 'D'), 0);
  // 덮어쓰기
  const id2 = [...plans.get(pid).plan.cellOf.keys()][3], it2 = book.get(pid, id2);
  fx.note(book.apply(ev('tool-end', [{ k: 'file', id: id2, p: it2.p, d: it2.d, n: it2.n, v: 'modify', x: 'overwrite' }], 4, 'tuW'), pid), 'n1', 200);
  const gw = labPlatformGeometry(book, plans, fx, 200.3, env(), new ArtGeo());
  assert.ok(count(gw, KI.warn) >= 10, '호박 파문');
  // push
  fx.clear();
  const gb = labPlatformGeometry(book, plans, fx, 300, env(), new ArtGeo());
  fx.note(book.apply(ev('tool-end', [{ k: 'repo', id: 'repo:x', n: 'x', v: 'push', c: 3 }], 5, 'tuP'), pid), 'n1', 300);
  const gpu = labPlatformGeometry(book, plans, fx, 300.4, env(), new ArtGeo());
  assert.ok(count(gpu, KI.repo) >= count(gb, KI.repo) + 6, '코어 빛기둥');
  assert.ok(count(gpu, KI.repo, 'D') >= 1, '빨려 드는 빛 조각');
});
const ART_MS = 10 * 60_000;

test('도형: 대량 변경(같은 구역 6개) → 바닥 파도 + ×N, 움직임 줄이기면 파도 대신 호만·경광등 회전 없음', () => {
  const { book, fx, pid, plans, env } = scene(20, 2);
  const e = env();
  labPlatformGeometry(book, plans, fx, 50, e, new ArtGeo());
  const ids = [...plans.get(pid).plan.cellOf.entries()].filter(([, c]) => c.sector === 'f:src0').map(([k]) => k).slice(0, 7);
  assert.ok(ids.length >= 6);
  ids.forEach((id, i) => { const it = book.get(pid, id); fx.note(book.apply(ev('tool-end', [{ k: 'file', id, p: it.p, d: it.d, n: it.n, v: 'modify', sz: 1 }], 30 + i, 'tuB' + i), pid), 'n1', 50 + i * 0.3); });
  const g = labPlatformGeometry(book, plans, fx, 52.2, e, new ArtGeo());
  assert.ok(g.labels.some((l) => /^×\d+$/.test(l.text)), '×N 칩');
  // 움직임 줄이기: 경보 때 회전 빔 없음(점만)
  const S = scene(10, 2); const id = [...S.plan.cellOf.keys()][0], it = S.book.get(S.pid, id);
  S.fx.note(S.book.apply(ev('tool-end', [{ k: 'file', id, p: it.p, d: it.d, n: it.n, v: 'delete', x: 'rm' }], 3, 'tuQ'), S.pid), 'n1', 10);
  const gr = labPlatformGeometry(S.book, S.plans, S.fx, 10.5, S.env({ reduced: true, nowMs: Date.parse(ts(3)) + 1000 }), new ArtGeo());
  const gn = labPlatformGeometry(S.book, S.plans, S.fx, 10.5, S.env({ reduced: false, nowMs: Date.parse(ts(3)) + 1000 }), new ArtGeo());
  assert.ok(count(gr, KI.alarm) < count(gn, KI.alarm));
});

test('도형: 라이트 테마·선택·발자국도 같은 상한, 프로젝트 페이드 0 이면 건너뜀', () => {
  const { book, fx, pid, plans, env } = scene(30, 4);
  const id = [...plans.get(pid).plan.cellOf.keys()][0];
  const g = labPlatformGeometry(book, plans, fx, 5, env({ isLight: true, hover: { pid, id }, foot: { pid, node: 'n1', set: new Set([id]) } }), new ArtGeo());
  assert.ok(g.nb > 0 && g.labels.some((l) => l.cls === 'art-item'));
  const g0 = labPlatformGeometry(book, plans, fx, 5, env({ pidAlpha: () => 0 }), new ArtGeo());
  assert.equal(g0.nb, 0);
});

test('성능: 블록 ~220 프레임 갱신(조용할 때 ≈0.6ms — 부하 여유 4배)', () => {
  const S = scene(300, 10), e = S.env(), g = new ArtGeo();
  for (let i = 0; i < 30; i++) labPlatformGeometry(S.book, S.plans, S.fx, i * 0.016, e, g);
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) labPlatformGeometry(S.book, S.plans, S.fx, 1 + i * 0.016, e, g);
  const ms = (performance.now() - t0) / 100;
  assert.ok(ms < LAB_PERF.FRAME_MS * 4, `${ms.toFixed(3)}ms`);
});

test('i18n: 플랫폼 절 키(en·ko)', () => {
  for (const k of ['lab.sector.more', 'lab.platform.core', 'lab.platform.outbay', 'lab.platform.bundle', 'lab.platform.wave']) assert.ok(MESSAGES.en[k] && MESSAGES.ko[k], k);
});

test('3D 규격: LabPlatform3D 가 ArtLayerBase3D 를 잇고 새 메시를 만들지 않음, 정적 단은 층 꺼도 그림', () => {
  const src = readFileSync(new URL('../lab/lab-platform.js', import.meta.url), 'utf8');
  assert.match(src, /class LabPlatform3D extends ArtLayerBase3D/);
  assert.ok(!/new THREE\./.test(src) && !/from 'three'/.test(src), '새 three 객체 없음(그리기 호출 +4 는 기반 클래스)');
  for (const h of ['labSectorPlan(', 'setPlatformRadius(', 'st.lay.set(', 'fitPoints(']) assert.ok(src.includes(h), h);
  const view = readFileSync(new URL('../lab/lab-view.js', import.meta.url), 'utf8');
  assert.ok(view.includes('buildPlatformStatic(r, this.pal, b, o)'));
});
