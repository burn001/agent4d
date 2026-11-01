// node --test "web/test/lab-fx-vis.test.mjs"   [T1-platform-fx] M3·M4 플랫폼 연출 가시성 — 경보(굵은 빗금·붉은 판·굵은 파문·경광등 기둥)·
// 대량 변경 파도(3초·굵은 띠 3줄·×N 높이·라벨 예산 예약)·움직임 줄이기·선 상한, 2D 판(굵은 선·붉은 채움·×N 알약)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAB, LAB_PERF } from '../lab/lab-const.mjs';
import { LP, labSectorPlan, labPlatformGeometry, labAlarmSectors } from '../lab/lab-platform-core.mjs';
import { drawPlatformDynamic2D } from '../flat/lab2d-platform.js';
import { computeLab } from '../lab/lab-layout-core.mjs';
import { ArtBook, ArtFx, ArtGeo, ARTGEO } from '../artifact-core.mjs';
import { KI } from '../art-meta.mjs';

const H = LAB.PLATFORM.H, Y = H + 0.012;
const ts = (s) => new Date(Date.UTC(2026, 10, 1, 0, 0, s)).toISOString();
const T3 = Date.parse(ts(3));
const ev = (type, art, s, tu) => ({ type, ts: ts(s), nodeId: 'n1', toolUseId: tu, art });
const F = (path, i) => { const k = path.lastIndexOf('/'); return { k: 'file', id: path.toLowerCase(), p: path, d: path.slice(0, k), n: path.slice(k + 1), v: 'create', sz: 10 }; };

function scene(n = 20, folders = 2, pid = null, book = new ArtBook(), pre = 'src', rP = 12) {
  pid = pid || book.defaultProject;
  for (let i = 0; i < n; i++) book.touch(pid, F(`${pre}${i % folders}/f${i}.js`, i), 1000 + i, 'n1', `tu${pre}${i}`);
  const plan = labSectorPlan(book.layoutItems(pid).items, rP, null);
  return { book, pid, plan };
}
const env = (o = {}) => ({ nowMs: T3 + 1000, reduced: false, foot: null, hover: null, hits: [], nodePos: () => ({ x: 0, y: 3, z: 20 }), style: null, isLight: false, unitPx: () => 30, ...o });
/** 선 i 의 조건 세기 */
const lines = (g, f) => { let n = 0; for (let i = 0; i < g.nl; i++) { const o = i * 6; if (f({ c: g.LC[i], w: g.LW[i], a: g.LA[i], y0: g.L[o + 1], y1: g.L[o + 4] })) n++; } return n; };
const cyls = (g, c) => { let n = 0; for (let i = 0; i < g.ny; i++) if (g.YC[i] === c) n++; return n; };
const dots = (g, c) => { let n = 0; for (let i = 0; i < g.nd; i++) if (g.DC[i] === c) n++; return n; };
const plates = (g, c) => { let n = 0; for (let i = 0; i < g.nb; i++) if (g.BC[i] === c && Math.abs(g.B[i * 6 + 4] - 0.02) < 1e-6) n++; return n; };
const near = (a, b) => Math.abs(a - b) < 1e-4;

/** 파괴적 항목(x:'rm', xAt = ts(3)) 하나 + 경보 fx('alarm') 하나를 연출 시계 10초에 */
function alarmScene(o = {}) {
  const S = scene(20, 2);
  const fx = new ArtFx();
  const id = [...S.plan.cellOf.keys()][2], it = S.book.get(S.pid, id);
  fx.note(S.book.apply(ev('tool-end', [{ k: 'file', id, p: it.p, d: it.d, n: it.n, v: 'delete', x: 'rm', est: 1 }], 3, 'tuA'), S.pid), 'n1', 10);
  const plans = new Map([[S.pid, { plan: S.plan, cx: 0, cz: 0, rWall: 30 }]]);
  return { ...S, fx, id, plans, sk: S.plan.cellOf.get(id).sector, ...o };
}

test('(a) 경보 중: 붉은 굵은 선(LW≥3)·경보 구역 판·경광등 기둥 4·발광 점 4', () => {
  const S = alarmScene();
  assert.ok(S.fx.list.some((e) => e.kind === 'alarm'), '경보 fx');
  assert.equal(S.book.get(S.pid, S.id).x, 'rm');
  const g = labPlatformGeometry(S.book, S.plans, S.fx, 10.6, env(), new ArtGeo());
  assert.ok(lines(g, (l) => l.c === KI.alarm && l.w >= 3) > 0, '굵은 붉은 선');
  assert.ok(lines(g, (l) => l.c === KI.alarm && l.w >= 3 && near(l.y0, Y + 0.02) && l.a >= 0.55) >= 3, '빗금 w≥3·알파≥0.55');
  assert.ok(lines(g, (l) => l.c === KI.alarm && l.w >= 3 && near(l.y0, Y + 0.05)) >= 32, '파문 굵은 고리');
  assert.ok(plates(g, KI.alarm) >= 1, '경보 구역 판(box 높이 0.02)');
  assert.equal(cyls(g, KI.alarm), 4, '경광등 기둥 4');
  assert.ok(dots(g, KI.alarm) >= 4, '발광 점');
  for (let i = 0; i < g.ny; i++) if (g.YC[i] === KI.alarm) { assert.ok(near(g.Y[i * 5 + 3], LP.BEACON_R)); assert.ok(near(g.Y[i * 5 + 4], LP.BEACON_H)); }
  // 회전 빔: 길이 3.0·w 3
  let beam = 0;
  for (let i = 0; i < g.nl; i++) { const o = i * 6; if (g.LC[i] === KI.alarm && g.L[o + 1] !== g.L[o + 4]) { beam++; assert.ok(g.LW[i] >= 3); assert.ok(near(Math.hypot(g.L[o + 3] - g.L[o], g.L[o + 5] - g.L[o + 2]), LP.BEACON_BEAM)); } }
  assert.equal(beam, 8, '경광등 4 × 빔 2');
  assert.ok(g.labels.some((l) => l.cls === 'art-alarm'));
  assert.ok(labAlarmSectors(S.plan, (id) => S.book.get(S.pid, id), T3 + 1000).set.has(S.sk));
});

test('(b) 연출 끝난 뒤(5초, 10분 안): 빗금·판·경광등 기둥은 남고 파문 고리·발광 점·빔은 없음 → 10분 넘으면 모두 없음', () => {
  const S = alarmScene();
  const g = labPlatformGeometry(S.book, S.plans, S.fx, 15, env({ nowMs: T3 + 5000 }), new ArtGeo());
  assert.ok(lines(g, (l) => l.c === KI.alarm && l.w >= 3 && near(l.y0, Y + 0.02)) >= 3, '빗금 남음');
  assert.ok(plates(g, KI.alarm) >= 1, '판 남음');
  assert.equal(cyls(g, KI.alarm), 4, '기둥 남음');
  for (let i = 0; i < g.ny; i++) if (g.YC[i] === KI.alarm) { const a = g.YA[i]; assert.ok(a >= 0.35 - 1e-6 && a <= 0.6 + 1e-6, `맥동 알파 ${a}`); }
  assert.equal(lines(g, (l) => l.c === KI.alarm && near(l.y0, Y + 0.05)), 0, '파문 고리 없음');
  assert.equal(dots(g, KI.alarm), 0, '발광 점 없음');
  assert.equal(lines(g, (l) => l.c === KI.alarm && l.y0 !== l.y1), 0, '회전 빔 없음');
  // 9분 뒤 아직 남음, 10분 넘으면 없음
  const g9 = labPlatformGeometry(S.book, S.plans, S.fx, 600, env({ nowMs: T3 + 9 * 60_000 }), new ArtGeo());
  assert.equal(cyls(g9, KI.alarm), 4);
  const gl = labPlatformGeometry(S.book, S.plans, S.fx, 700, env({ nowMs: T3 + 10 * 60_000 + 1 }), new ArtGeo());
  assert.equal(cyls(gl, KI.alarm), 0); assert.equal(plates(gl, KI.alarm), 0);
  assert.equal(lines(gl, (l) => l.c === KI.alarm && l.w >= 3), 0);
  // 움직임 줄이기: 남은 기둥은 고정 알파
  const gr = labPlatformGeometry(S.book, S.plans, S.fx, 15, env({ nowMs: T3 + 5000, reduced: true }), new ArtGeo());
  const as = []; for (let i = 0; i < gr.ny; i++) if (gr.YC[i] === KI.alarm) as.push(gr.YA[i]);
  assert.equal(as.length, 4); assert.ok(as.every((a) => near(a, as[0])));
});

/** 같은 구역 6번 쓰기(연출 시계 50 + 0.3i) → 파도 */
function bulkNotes(book, pid, plan, fx, sk, n = 6, t = 50) {
  const ids = [...plan.cellOf.entries()].filter(([, c]) => c.sector === sk).map(([k]) => k).slice(0, n);
  assert.equal(ids.length, n);
  ids.forEach((id, i) => { const it = book.get(pid, id); fx.note(book.apply(ev('tool-end', [{ k: 'file', id, p: it.p, d: it.d, n: it.n, v: 'modify', sz: 1 }], 30 + i, 'tuB' + pid + i), pid), 'n1', t + i * 0.3); });
}

test('(c) 대량 변경: WAVE_S 3.0, 파도 중 KI.write 선 LW≥4·×6 라벨 Y≥H+2.2, 구역 이름이 예산을 다 써도 ×N 은 들어감', () => {
  assert.equal(LP.WAVE_S, 3.0);
  // 앞 프로젝트(pA): 구역 12 개 이름 + 점등 대상 이름표로 라벨 예산을 다 씀 → 뒤 프로젝트 파도의 ×N 은 예약분으로
  const book = new ArtBook();
  const A = scene(48, 12, 'pA', book, 'a');
  const B = scene(20, 2, null, book, 'src');
  const fx = new ArtFx();
  for (const [i, id] of [...A.plan.cellOf.keys()].slice(0, 12).entries()) { const it = book.get('pA', id); fx.note(book.apply(ev('tool-end', [{ k: 'file', id, p: it.p, d: it.d, n: it.n, v: 'modify', sz: 1 }], 20 + i, 'tuL' + i), 'pA'), 'n1', 49 + i * 0.01); }
  bulkNotes(book, B.pid, B.plan, fx, 'f:src0');
  const plans = new Map([['pA', { plan: A.plan, cx: -40, cz: 0, rWall: 30 }], [B.pid, { plan: B.plan, cx: 0, cz: 0, rWall: 30 }]]);
  const e = env();
  labPlatformGeometry(book, plans, fx, 51.8, e, new ArtGeo()); // 파도 시작(k = 0)
  const g = labPlatformGeometry(book, plans, fx, 51.8 + 1.5, e, new ArtGeo()); // k = 0.5
  assert.ok(lines(g, (l) => l.c === KI.write && l.w >= 4) >= 3 * 2, '굵은 파도 띠 3줄');
  assert.ok(lines(g, (l) => l.c === KI.write && l.w >= 3 && near(l.y0, Y + 0.03) && l.y0 === l.y1) > 0, '경계 호·방사선 w≥3');
  const xn = g.labels.find((l) => l.text === '×6');
  assert.ok(xn, '×6 라벨: ' + g.labels.map((l) => l.text).join(','));
  assert.ok(xn.y >= H + 2.2, `×N 높이 ${xn.y}`);
  assert.ok(near(xn.alpha, 1), 'k < 0.85 동안 알파 1');
  const aLabels = g.labels.filter((l) => l !== xn).length;
  assert.ok(aLabels >= Math.min(ARTGEO.LABELS, LAB_PERF.PLATFORM_LABELS) - 3 - 2, `앞 프로젝트가 나머지 예산을 다 씀(${aLabels})`);
  // 지나간 칸 윗면 빛 판(sy 0.03)
  const gs = labPlatformGeometry(book, plans, fx, 51.8 + 0.45, e, new ArtGeo()); // k = 0.15: 파도 앞이 칸 띠 안
  let sweep = 0; for (let i = 0; i < gs.nb; i++) if (gs.BC[i] === KI.write && near(gs.B[i * 6 + 4], 0.03)) sweep++;
  assert.ok(sweep >= 1, '빛 판 스침');
  // 2.9초(k≈0.97)엔 아직 있고 3초 넘으면 끝
  const g2 = labPlatformGeometry(book, plans, fx, 51.8 + 2.9, e, new ArtGeo());
  const x2 = g2.labels.find((l) => l.text === '×6'); assert.ok(x2 && x2.alpha < 1, '끝무렵 페이드');
  const g3 = labPlatformGeometry(book, plans, fx, 51.8 + 3.01, e, new ArtGeo());
  assert.ok(!g3.labels.some((l) => l.text === '×6'));
  assert.equal(lines(g3, (l) => l.c === KI.write && l.w >= 4), 0);
  // 원경(구역 판): 판 윗면 굵은 호
  const ef = env({ unitPx: () => 2 });
  const fx2 = new ArtFx(); bulkNotes(book, B.pid, B.plan, fx2, 'f:src1', 6, 80);
  const pB = new Map([[B.pid, { plan: B.plan, cx: 0, cz: 0, rWall: 30 }]]);
  labPlatformGeometry(book, pB, fx2, 81.5, ef, new ArtGeo());
  const gf = labPlatformGeometry(book, pB, fx2, 82.5, ef, new ArtGeo());
  assert.ok(lines(gf, (l) => l.c === KI.write && l.w >= 4 && l.y0 > H + 0.1) > 0, '원경 판 윗면 파도 호');
});

test('(d) 움직임 줄이기: 경보 때 회전 빔 없음(기둥·점은 있음), 파문 1겹', () => {
  const S = alarmScene();
  const gr = labPlatformGeometry(S.book, S.plans, S.fx, 10.6, env({ reduced: true }), new ArtGeo());
  assert.equal(lines(gr, (l) => l.c === KI.alarm && l.y0 !== l.y1), 0, '회전 빔 없음');
  assert.equal(cyls(gr, KI.alarm), 4);
  assert.ok(dots(gr, KI.alarm) >= 4);
  assert.equal(lines(gr, (l) => l.c === KI.alarm && near(l.y0, Y + 0.05)), 32, '파문 1겹');
});

test('(e) 상한: 블록 300 + 경보 + 파도 동시에도 선 ≤ PLATFORM_LINES·상자 ≤ BOXES·원기둥 ≤ CYLS', () => {
  const S = scene(300, 10, null, new ArtBook(), 'src', 14);
  const fx = new ArtFx();
  const plans = new Map([[S.pid, { plan: S.plan, cx: 0, cz: 0, rWall: 30 }]]);
  assert.ok(S.plan.nBlocks >= 200);
  const id = [...S.plan.cellOf.entries()].find(([, c]) => c.sector === 'f:src1')[0], it = S.book.get(S.pid, id);
  fx.note(S.book.apply(ev('tool-end', [{ k: 'file', id, p: it.p, d: it.d, n: it.n, v: 'delete', x: 'rm' }], 3, 'tuA'), S.pid), 'n1', 50);
  bulkNotes(S.book, S.pid, S.plan, fx, 'f:src0', 8);
  const e = env();
  labPlatformGeometry(S.book, plans, fx, 52.2, e, new ArtGeo());
  const g = labPlatformGeometry(S.book, plans, fx, 52.2 + 0.9, e, new ArtGeo());
  assert.ok(lines(g, (l) => l.c === KI.write && l.w >= 4) > 0, '파도 중');
  assert.equal(cyls(g, KI.alarm), 4, '경보 중');
  assert.ok(g.nl <= LAB_PERF.PLATFORM_LINES, `선 ${g.nl}`);
  assert.ok(g.nb <= ARTGEO.BOXES && g.ny <= ARTGEO.CYLS);
  assert.ok(plates(g, KI.alarm) <= LAB_PERF.PLATFORM_SECTOR_BOXES);
  assert.ok(g.labels.length <= LAB_PERF.PLATFORM_LABELS);
});

// ── 2D ──
function rec2d() { // lineWidth·globalAlpha 를 stroke/fill 때 기록하는 가짜 문맥
  const log = [], ctx = { log, lineWidth: 1, globalAlpha: 1, strokeStyle: '', fillStyle: '', font: '' };
  for (const k of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'ellipse', 'rect', 'roundRect', 'fillRect', 'strokeRect', 'save', 'restore', 'setLineDash']) ctx[k] = () => { log.push({ op: k }); };
  ctx.stroke = () => log.push({ op: 'stroke', w: ctx.lineWidth, a: ctx.globalAlpha, c: ctx.strokeStyle });
  ctx.fill = () => log.push({ op: 'fill', a: ctx.globalAlpha, c: ctx.fillStyle });
  ctx.fillText = (t) => log.push({ op: 'text', t, font: ctx.font });
  ctx.measureText = (s) => ({ width: String(s).length * 7 });
  return ctx;
}
test('2D: 경보 구역 옅은 붉은 채움 + 굵은 빗금·동심원(선 폭 ≥ max(2, 0.12·s)·알파 ≥ 0.55), 파도 띠 + ×N 굵은 글자·알약', () => {
  const S = alarmScene();
  const room = computeLab([{ id: 'm', kind: 'main', order: 0, status: 'active', label: 'main' }], 'm', null, {}).rooms[0];
  const s = 12, view = { _s: s, pal: {}, tokens: { text: '#eee', isLight: false }, reduced: false, clock: () => T3 + 1000 };
  view._X = (x) => x * s + 400; view._Y = (z) => z * s + 300;
  const W2 = Math.max(2, 0.12 * s);
  const ctx = rec2d();
  assert.equal(drawPlatformDynamic2D(ctx, view, room, S.plan, S.book, S.fx, 10.6), true);
  const red = ctx.log.filter((l) => l.c === '#ef4444');
  assert.ok(red.some((l) => l.op === 'fill' && l.a > 0.05 && l.a < 0.3), '옅은 붉은 채움');
  const rs = red.filter((l) => l.op === 'stroke');
  assert.ok(rs.length >= 4, '빗금 + 동심원');
  for (const l of rs) { assert.ok(l.w >= W2 - 1e-9, `폭 ${l.w}`); assert.ok(l.a >= 0.55 - 1e-9, `알파 ${l.a}`); }
  // 파도
  const B = scene(20, 2); const fx = new ArtFx(); bulkNotes(B.book, B.pid, B.plan, fx, 'f:src0');
  const v2 = { ...view, clock: () => T3 }, c1 = rec2d();
  drawPlatformDynamic2D(c1, v2, room, B.plan, B.book, fx, 51.8);
  const c2 = rec2d();
  assert.equal(drawPlatformDynamic2D(c2, v2, room, B.plan, B.book, fx, 53.3), true);
  const t = c2.log.find((l) => l.op === 'text' && l.t === '×6');
  assert.ok(t && /^(7|8|9)00 /.test(t.font), '×6 굵은 글자');
  assert.ok(c2.log.some((l) => l.op === 'roundRect'), '바탕 알약');
  assert.ok(c2.log.filter((l) => l.op === 'stroke' && l.w >= W2 && l.a >= 0.55 - 1e-9).length >= 3, '파도 띠');
});
