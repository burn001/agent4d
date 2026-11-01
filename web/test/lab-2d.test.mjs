// node --test "web/test/lab-2d.test.mjs"   복셀 연구소 2D 평면도(평면도 담당): 순수 기하(lab2d-core) · 3D 와 같은 배치 ·
// 플랫폼·기자재 그리기(가짜 캔버스) · 정적/동적 층이 런타임 오류 없이 돎 · 2D 경로에 three 0 · 성능 상한(FLAT_EXTRA_MS)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAB, LAB_PERF, labRadii, polar, thetaOf, dTheta, bridgeFrame, floorYAt } from '../lab/lab-const.mjs';
import { computeLab } from '../lab/lab-layout-core.mjs';
import { RIG_KINDS, RIG_STATES, RIG_HEX } from '../lab/lab-rig-core.mjs';
import { canvasAng, quadXZ, wallArcs, bridgeRects, facilityQuad, RIG_GLYPH, rigBlink, rigLook, nearestHit } from '../lab/lab2d-core.mjs';
import { drawPlatformStatic2D, drawPlatformDynamic2D, posOfId } from '../flat/lab2d-platform.js';
import { labSectorPlan } from '../lab/lab-platform-core.mjs';
import { drawRigs2D, drawRigRingStatic2D } from '../flat/lab2d-rigs.js';
import { LAB2D_READY } from '../flat/lab2d-ready.mjs';
import { renderer2dFor } from '../renderers.js';
import { Lab2DView } from '../flat/lab2d.js';
import { DARK, LIGHT } from '../voxel/palette-hex.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** 호출만 세는 가짜 2D 문맥(보통 객체 — 측정이 가짜 비용에 흐려지지 않게) */
const CTX_FNS = ['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'arc', 'ellipse', 'rect', 'roundRect', 'fillRect', 'strokeRect', 'fillText',
  'save', 'restore', 'translate', 'rotate', 'setTransform', 'setLineDash', 'drawImage', 'clip'];
function fakeCtx() {
  const calls = {}, ctx = { calls };
  for (const k of CTX_FNS) ctx[k] = () => { calls[k] = (calls[k] || 0) + 1; };
  ctx.measureText = (s) => ({ width: String(s).length * 6 });
  ctx.createLinearGradient = ctx.createRadialGradient = () => ({ addColorStop() {} });
  return ctx;
}
/** 세지 않는 가짜 문맥(성능 시험 — 실제 캔버스 비용은 브라우저 QA 몫, 여기서는 우리 JS 비용만) */
function noopCtx() {
  const ctx = {}, nop = () => {};
  for (const k of CTX_FNS) ctx[k] = nop;
  ctx.measureText = (s) => ({ width: String(s).length * 6 });
  return ctx;
}
const TOK = { bg: '#111', text: '#eee', muted: '#999', ok: '#3d3', error: '#e33', warn: '#fa0', link: '#59f', skill: '#c6f', isLight: false };
function fakeView(s = 12) {
  const v = { _s: s, pal: DARK, tokens: TOK, _now: 1.5, reduced: false, vis: new Map(), focusId: null, hoverId: null };
  v._X = (x) => x * s + 400; v._Y = (z) => z * s + 300;
  return v;
}
const tree = (nSub = 6, extra = []) => {
  const a = [{ id: 'm', kind: 'main', order: 0, status: 'active', label: 'main' }];
  for (let i = 0; i < nSub; i++) a.push({ id: 's' + i, kind: 'subagent', parentId: 'm', order: i + 1, status: 'active' });
  return a.concat(extra);
};
const bg = (id, parentId, order, status = 'active') => ({ id, kind: 'bash-bg', parentId, order, status });

/** 플랫폼 계획(플랫폼 담당 stub 이 빈 계획을 주므로 규격 모양대로 직접 만든다) */
function mkPlan(n = 40, rP = LAB.PLATFORM.R_DEFAULT) {
  const sectors = [], cellOf = new Map();
  const nSec = 4, per = Math.ceil(n / nSec);
  for (let k = 0; k < nSec; k++) {
    const th0 = LAB.BRIDGE_THETA - k * 90, th1 = th0 - 90, cells = [];
    for (let i = 0; i < per && k * per + i < n; i++) {
      const r = 2.5 + (i % 5) * 1.15, th = th0 - 10 - Math.floor(i / 5) * 9, p = polar(0, 0, r, th);
      const c = { key: 'f' + (k * per + i), r, theta: th, x: p.x, z: p.z };
      cells.push(c); cellOf.set(c.key, c);
    }
    sectors.push({ key: 'z' + k, name: 'src' + k, th0, th1, cells });
  }
  return { rP, sectors, cellOf, more: { n: 0 } };
}
function mkBook(plan) {
  const items = [];
  for (const c of plan.cellOf.values()) items.push({ id: c.key, k: 'file', p: c.key, last: 1, first: 1 });
  return { version: 3, defaultProject: '_', layoutItems: () => ({ items, agg: new Map() }) };
}

// 성능 시험은 맨 앞(다른 시험이 같은 함수에 여러 모양의 가짜 문맥을 먹여 느려지기 전에 — 브라우저에선 문맥이 하나)
test(`성능: 2D 추가분(플랫폼 블록 ${LAB_PERF.PLATFORM_BLOCKS} + 연출 + 기자재 고리 + 방 동적) < ${LAB_PERF.FLAT_EXTRA_MS}ms`, () => {
  const extra = [];
  for (let i = 0; i < 30; i++) extra.push(bg('b' + i, 's' + (i % 20), 100 + i));
  const lay = computeLab(tree(20, extra), 'm', null, {});
  const v = protoView(lay, 12);
  const plan = mkPlan(LAB_PERF.PLATFORM_BLOCKS), book = mkBook(plan);
  const fx = { list: [], acts: { list: [] } };
  for (let i = 0; i < 40; i++) fx.list.push({ pid: '_', id: 'f' + i, kind: ['lit', 'rise', 'collapse', 'alarm'][i % 4], t0: 9.5, dur: 2 });
  const ms = [];
  for (const [id, pos] of lay.machine) { ms.push({ id, node: { id, kind: 'bash-bg', status: 'active' }, pos, flashUntil: 0 }); v.vis.set(id, { drawS: 1 }); }
  const r = lay.rooms[0]; r._act = { toolbox: 'skill' }; r._alpha = 1;
  const ctx = noopCtx();
  const once = () => { drawPlatformDynamic2D(ctx, v, r, plan, book, fx, 10); drawRigs2D(ctx, v, ms, 5000); v._drawRoomDyn(ctx, r, 12, 1); };
  for (let i = 0; i < 150; i++) once(); // JIT 데우기
  // 묶음 5번 중 가장 빠른 것(npm test 는 파일들을 병렬로 돌려 CPU 를 나눠 쓴다 — 우리 코드 비용만 본다)
  const N = 40;
  let ms1 = Infinity;
  for (let b = 0; b < 5; b++) { const t0 = performance.now(); for (let i = 0; i < N; i++) once(); ms1 = Math.min(ms1, (performance.now() - t0) / N); }
  if (process.env.LAB2D_PROF) for (const [nm, f] of [['plat', () => drawPlatformDynamic2D(ctx, v, r, plan, book, fx, 10)], ['rigs', () => drawRigs2D(ctx, v, ms, 5000)], ['dyn', () => v._drawRoomDyn(ctx, r, 12, 1)]]) { const a = performance.now(); for (let i = 0; i < N; i++) f(); console.log(nm, ((performance.now() - a) / N).toFixed(3)); }
  assert.ok(ms1 < LAB_PERF.FLAT_EXTRA_MS, `${ms1.toFixed(3)}ms`);
});

test('준비: LAB2D_READY 켬 → renderer2dFor(lab) = Lab2DView(준비 중 띠 없음), 계열 voxel', () => {
  assert.equal(LAB2D_READY, true);
  const r = renderer2dFor('lab');
  assert.equal(r.pending, null); assert.equal(r.base, 'lab');
  assert.equal(Lab2DView.modeId, 'lab'); assert.equal(Lab2DView.family, 'voxel');
});

test('2D 경로에 three·3D 모듈이 정적으로 없다(§53.2)', () => {
  const seen = new Set(), bare = [];
  const walk = (f) => {
    if (seen.has(f)) return; seen.add(f);
    const src = readFileSync(f, 'utf8');
    const re = /^\s*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
    let m;
    while ((m = re.exec(src))) { const s = m[1] || m[2]; if (!s.startsWith('.')) { bare.push(s + ' <- ' + path.relative(WEB, f)); continue; } walk(path.resolve(path.dirname(f), s)); }
  };
  walk(path.join(WEB, 'flat/lab2d.js'));
  assert.deepEqual(bare, []);
  const files = [...seen].map((f) => path.relative(WEB, f).replace(/\\/g, '/'));
  for (const f of ['lab/lab-view.js', 'lab/lab-platform.js', 'lab/lab-rigs.js', 'lab/lab-props.js', 'voxel/office.js', 'scene.js']) assert.ok(!files.includes(f), f);
  assert.ok(files.includes('lab/lab-layout-core.mjs'), '3D 와 같은 배치 함수');
});

test('lab2d-core: 캔버스 각·사각 꼭짓점이 lab-const 극좌표와 맞음', () => {
  for (const th of [0, 45, 90, 225, 300]) {
    const p = polar(0, 0, 10, th), a = canvasAng(th);
    assert.ok(near(Math.cos(a) * 10, p.x, 1e-9) && near(Math.sin(a) * 10, p.z, 1e-9), 'θ ' + th);
  }
  // 반지름 방향 깊이 d, 접선 폭 w: 사각 중심에서 바깥 모서리 중점은 반지름 + d/2
  const th = 120, c = polar(0, 0, 10, th), q = quadXZ(c.x, c.z, 2, 0.7, th);
  const outMid = { x: (q[4] + q[6]) / 2, z: (q[5] + q[7]) / 2 }, inMid = { x: (q[0] + q[2]) / 2, z: (q[1] + q[3]) / 2 };
  assert.ok(near(Math.hypot(outMid.x, outMid.z), 10.35, 1e-9));
  assert.ok(near(Math.hypot(inMid.x, inMid.z), 9.65, 1e-9));
  assert.ok(near(Math.hypot(q[2] - q[0], q[3] - q[1]), 2, 1e-9), '접선 길이 = w');
  // 외벽 틈 = 출입문 θ 둘레 DOOR_W
  const [w] = wallArcs(26);
  assert.ok(w.th0 < LAB.FRONT.DOOR + 5 && w.th1 > 360);
  assert.ok(near(((360 - (w.th1 - w.th0)) * Math.PI / 180) * 26, LAB.WALL.DOOR_W, 1e-9));
});

test('브리지 사각: 덱 안 = floorYAt 1.6, 경사로 = 보간, 콘솔은 덱 위 · 3D bridgeFrame 과 같은 축', () => {
  const R = labRadii(9, 1), f = bridgeFrame(0, 0, R.rBridge);
  const rs = bridgeRects(f);
  const deck = rs.find((q) => q.kind === 'deck'), con = rs.find((q) => q.kind === 'console'), ramps = rs.filter((q) => q.kind === 'ramp');
  assert.equal(ramps.length, 2);
  assert.equal(floorYAt(f, deck.x, deck.z), LAB.BRIDGE.Y);
  assert.equal(floorYAt(f, con.x, con.z), LAB.BRIDGE.Y);
  for (const r of ramps) { const y = floorYAt(f, r.x, r.z); assert.ok(y > 0 && y < LAB.BRIDGE.Y, 'ramp y ' + y); }
  // 덱 꼭짓점이 모두 덱 높이(가장자리 살짝 안쪽)
  const q = quadXZ(deck.x, deck.z, deck.w - 0.02, deck.d - 0.02, deck.theta);
  for (let i = 0; i < 8; i += 2) assert.equal(floorYAt(f, q[i], q[i + 1]), LAB.BRIDGE.Y);
});

test('시설 판: 자리들이 보는 쪽 0.75 앞, 판 방위가 바라보는 방향', () => {
  const lay = computeLab(tree(3), 'm', null, {});
  const r = lay.rooms[0];
  for (const cat of ['skill', 'mcp', 'artifact', 'monitor', 'web']) {
    const sp = r.stations[cat], q = facilityQuad(sp);
    assert.ok(q, cat);
    const f = sp[0].face;
    assert.ok(Math.abs(dTheta(q.theta, (Math.atan2(Math.sin(f), Math.cos(f)) * 180) / Math.PI)) < 1e-6, cat);
    const d = Math.hypot(q.x - sp[0].x, q.z - sp[0].z);
    assert.ok(d < 0.75 + 1.5, cat + ' 가까이');
  }
  assert.equal(facilityQuad([]), null);
});

test('기자재 모양: 10종 글리프·6상태 색(RIG_HEX 그대로)·진행 호 null·움직임 줄이기', () => {
  for (const k of RIG_KINDS) assert.ok(RIG_GLYPH[k], k);
  assert.equal(new Set(Object.values(RIG_GLYPH)).size, RIG_KINDS.length, '글리프가 서로 다름');
  const node = (status) => ({ id: 'b', kind: 'bash-bg', status, startedAt: new Date(0).toISOString() });
  const now = 5000;
  const st = { active: 'run', idle: 'wait', done: 'done', error: 'fail', stopped: 'stop' };
  for (const [s, want] of Object.entries(st)) {
    const L = rigLook(node(s), 'meter', now, false, 1, 0, false);
    assert.ok(L.state === want || (s === 'active' && L.state === 'stale'), s + ' → ' + L.state); // 오래 도는 진행은 정체일 수 있음(기자재 규칙)
    assert.equal(L.ring, RIG_HEX.dark[L.state]);
    assert.ok(RIG_STATES.includes(L.state));
    assert.ok(L.gauge === null || (L.gauge >= 0 && L.gauge <= 1), 'rigGauge = null | 0..1');
    const Ll = rigLook(node(s), 'meter', now, true, 1, 0, true);
    assert.equal(Ll.ring, RIG_HEX.light[Ll.state]);
    assert.equal(Ll.anim, false, '움직임 줄이기 = 정지');
  }
  assert.equal(rigLook(node('active'), 'nope', now).kind, 'meter', '모르는 종류는 범용 계측기');
  for (const s of RIG_STATES) { const b = rigBlink(s, 0.3, 0); assert.ok(b >= 0 && b <= 1, s); }
  assert.equal(rigBlink('done', 9), 1);
});

test('drawRigs2D: rig 만 그림 · 진행 중이면 true · 끝나면 false · 집기 자리(_sp)', () => {
  const lay = computeLab(tree(2, [bg('b1', 's0', 10), bg('b2', 'm', 11, 'done'), { id: 'mo', kind: 'monitor', parentId: 'm', order: 12, status: 'active' }]), 'm', null, {});
  const view = fakeView(14), ctx = fakeCtx();
  const ms = [];
  for (const [id, pos] of lay.machine) {
    const node = id === 'b2' ? { id, kind: 'bash-bg', status: 'done' } : { id, kind: id === 'mo' ? 'monitor' : 'bash-bg', status: 'active' };
    ms.push({ id, node, pos, flashUntil: 0 });
    view.vis.set(id, { drawS: 1 });
  }
  assert.ok(ms.filter((m) => m.pos.type === 'rig').length >= 3);
  assert.equal(drawRigs2D(ctx, view, ms, 5000), true);
  for (const m of ms) assert.ok(view.vis.get(m.id)._sp, m.id);
  assert.ok(ctx.calls.fillText >= 3, '가까우면 글리프');
  const done = ms.filter((m) => m.id === 'b2');
  assert.equal(drawRigs2D(fakeCtx(), view, done, 5000), false, '끝난 기자재는 정지');
  // 빈 칸 패드(정적)
  const c2 = fakeCtx(); drawRigRingStatic2D(c2, view, lay.rooms[0]);
  assert.equal(c2.calls.stroke, lay.rooms[0].lab.rigSlots.length);
  assert.ok(lay.rooms[0].lab.rigSlots.length <= LAB_PERF.RIGS_RING + LAB.RIG.SHELF_MAX);
});

test('플랫폼: 정적(단·코어·구역 이름 ≤ 14) · 동적 블록 집기 · 연출 있을 때만 true', () => {
  const lay = computeLab(tree(2), 'm', null, {});
  const room = lay.rooms[0], view = fakeView(16), plan = mkPlan(40), book = mkBook(plan);
  view._labArt = { book, fx: null };
  const c1 = fakeCtx();
  drawPlatformStatic2D(c1, view, room, plan);
  assert.ok(c1.calls.arc >= 4 && c1.calls.fill >= 4);
  assert.ok(c1.calls.fillText <= LAB_PERF.PLATFORM_LABELS);
  // 빈 계획: 안내 글자만
  const c0 = fakeCtx(); drawPlatformStatic2D(c0, view, room, { rP: 9, sectors: [], cellOf: new Map(), more: { n: 0 } });
  assert.equal(c0.calls.fillText, 1);
  // 동적: 연출 없음 → false, 블록 수만큼 집기 점
  const fx = { list: [], acts: { list: [] } };
  assert.equal(drawPlatformDynamic2D(fakeCtx(), view, room, plan, book, fx, 10), false);
  assert.equal(view._labHits.length, 40);
  const h = view._labHits[3];
  assert.ok(near(h.x, view._X(plan.cellOf.get(h.id).x)) && near(h.y, view._Y(plan.cellOf.get(h.id).z)));
  assert.equal(nearestHit(view._labHits, h.x + 2, h.y - 1, 10).id, h.id);
  // 연출: 점등·프린트·파쇄·경보·파도 → true, 끝난 연출 → false
  fx.list.push({ pid: '_', id: 'f1', kind: 'lit', t0: 9.5, dur: 1 }, { pid: '_', id: 'f2', kind: 'rise', t0: 9.8, dur: 1 }, { pid: '_', id: 'f3', kind: 'collapse', t0: 9.8, dur: 1 }, { pid: '_', id: 'f4', kind: 'alarm', t0: 9.8, dur: 1 });
  fx.acts.list.push({ a: 'radar', pid: '_', id: 'f5', t0: 9.9, dur: 1.8 });
  assert.equal(drawPlatformDynamic2D(fakeCtx(), view, room, plan, book, fx, 10), true);
  assert.equal(drawPlatformDynamic2D(fakeCtx(), view, room, plan, book, fx, 30), false, '끝난 연출은 그리지 않음');
  // 다른 프로젝트 연출은 무시
  const fx2 = { list: [{ pid: 'other', id: 'f1', kind: 'lit', t0: 9.5, dur: 1 }], acts: { list: [] } };
  assert.equal(drawPlatformDynamic2D(fakeCtx(), view, room, plan, book, fx2, 10), false);
  // 계획 없음 → 아무것도
  assert.equal(drawPlatformDynamic2D(fakeCtx(), view, room, null, book, fx, 10), false);
});

/** 화면 없이 Lab2DView 그리기 경로만(정적·방 동적·플랫폼 동적·기자재) 돌리는 가짜 뷰 */
function protoView(lay, s = 12, theme = DARK) {
  const v = Object.create(Lab2DView.prototype);
  Object.assign(v, { layout: lay, rooms: lay.rooms, roomsById: new Map(lay.rooms.map((r) => [r.id, r])), pal: theme, tokens: { ...TOK, isLight: theme === LIGHT },
    W: 1280, H: 800, _s: s, _now: 2, reduced: false, vis: new Map(), chars: new Map(), machines: new Map(), focusId: null, hoverId: null,
    _labHits: [], _labPlan: mkPlan(60), _labArt: null, clock: () => 5000 });
  v._X = (x) => x * s + 640; v._Y = (z) => z * s + 400;
  return v;
}

test('Lab2DView 정적·동적 층: 연구동(1～3열·다크/라이트)을 오류 없이 그림 · 방 동적 층은 lab 분기', () => {
  for (const [n, theme] of [[4, DARK], [30, LIGHT], [70, DARK]]) {
    const lay = computeLab(tree(n, [bg('b1', 'm', 900)]), 'm', null, {});
    const v = protoView(lay, 10, theme);
    const ctx = fakeCtx();
    v._drawStatic(ctx, 10, 0);
    const r = lay.rooms[0];
    assert.equal(r._on, true);
    assert.ok(ctx.calls.fill > r.desks.length * 2, '책상 상판·테두리');
    assert.ok(ctx.calls.fillText >= 2, '문패·브리지 이름');
    // 방 동적 층(책상 화면·시설 맥동)
    r._act = { toolbox: 'skill', kiosk: 'mcp', portal: 1, bell: 1 };
    const ch = { state: 'work', _monK: 1, _monCat: 'edit' };
    v.chars.set(r.desks[0].occupant, ch); v.chars.set('m', { state: 'work', _monK: 1, _monCat: 'shell' });
    const c2 = fakeCtx();
    v._drawRoomDyn(c2, r, 10, 1);
    assert.ok(c2.calls.fill >= 2 && c2.calls.stroke >= 2);
  }
});

test('3D⇄2D 같은 자리: Lab2DView 는 computeLab 을 그대로 씀(결정적 · 자리 고정 prev)', () => {
  const src = readFileSync(path.join(WEB, 'flat/lab2d.js'), 'utf8');
  assert.match(src, /computeLab\(present, this\.rootId, this\.layout && this\.layout\.lab && !this\.layout\.campus \? this\.layout : null, \{ rP: this\.labRP/); // 3D 와 같은 함수 · 같은 prev 규칙
  assert.match(src, /computeLabCampus\(present, this\.scope\.roots/); // 전체 보기도 같은 캠퍼스 함수
  const lab3d = readFileSync(path.join(WEB, 'lab/lab-view.js'), 'utf8');
  assert.match(lab3d, /computeLab\(present, this\.rootId, this\.layout && this\.layout\.lab && !this\.layout\.campus \? this\.layout : null, \{ rP: this\.labRP/);
  assert.match(lab3d, /computeLabCampus\(present, this\.scope\.roots/);
  const a = computeLab(tree(10), 'm', null, {}), b = computeLab(tree(10), 'm', null, {});
  for (const [id, s] of a.seat) { const t = b.seat.get(id); assert.ok(near(s.x, t.x) && near(s.z, t.z), id); }
  // 모든 직원 자리가 외벽 안
  const rW = a.rooms[0].lab.R.rWall;
  for (const s of a.seat.values()) assert.ok(Math.hypot(s.x, s.z) < rW, '외벽 안');
  assert.ok(thetaOf(0, 0, a.rooms[0].door.x, a.rooms[0].door.z) - LAB.FRONT.DOOR < 1e-6);
});

test('플랫폼 담당의 실제 계획(labSectorPlan)으로: 칸·테두리 장치·묶음 블록·구역 판(agg) 모두 집기 자리를 냄', () => {
  const kinds = ['file', 'output', 'repo', 'db', 'remote', 'service'];
  const mk = (n, folders = 7) => Array.from({ length: n }, (_, i) => ({ id: `src${i % folders}/d/f${i}.js`, k: kinds[i % 6], p: `src${i % folders}/d/f${i}.js`, d: `src${i % folders}/d`, first: 1, last: 2 + i, n: 1 }));
  const lay = computeLab(tree(2), 'm', null, {});
  const room = lay.rooms[0];
  for (const n of [12, 120, 700]) {
    const items = n === 700 ? mk(n).map((it) => ({ ...it, k: 'file' })) : mk(n);
    const plan = labSectorPlan(items, room.lab.rP, null);
    const book = { version: n, defaultProject: '_', layoutItems: () => ({ items, agg: new Map() }) };
    const view = fakeView(16); view._labArt = { book };
    drawPlatformStatic2D(fakeCtx(), view, room, plan);
    const fx = { list: [], acts: { list: [] } };
    for (const it of items.slice(0, 6)) fx.list.push({ pid: '_', id: it.id, kind: 'lit', t0: 0, dur: 2 });
    const drew = drawPlatformDynamic2D(fakeCtx(), view, room, plan, book, fx, 1);
    if (plan.agg) { assert.ok(view._labHits.length <= LAB_PERF.PLATFORM_BLOCKS, 'agg: 블록 대신 구역 판'); continue; }
    assert.ok(view._labHits.length > 0, 'n ' + n);
    assert.ok(view._labHits.length <= LAB_PERF.PLATFORM_BLOCKS + LAB_PERF.PLATFORM_SECTOR_BOXES + 40, 'n ' + n);
    for (const h of view._labHits) assert.ok(posOfId(plan, h.id), h.id);
    if (plan.rim instanceof Map && plan.rim.size) { const [id] = plan.rim.keys(); assert.ok(view._labHits.some((h) => h.id === id), '테두리 장치 집기'); }
    assert.equal(drew, items.slice(0, 6).some((it) => posOfId(plan, it.id)), '자리 있는 대상의 점등만 연출');
  }
});

test('구역 판(plan.agg — 블록 300 넘음): 블록 대신 구역마다 채움 + 수, 블록 집기 없음', () => {
  const lay = computeLab(tree(2), 'm', null, {});
  const plan = mkPlan(40); plan.agg = true; plan.sectors.forEach((sc, i) => { sc.n = 100 * (i + 1); });
  const view = fakeView(16), ctx = fakeCtx();
  drawPlatformDynamic2D(ctx, view, lay.rooms[0], plan, mkBook(plan), null, 1);
  assert.equal(view._labHits.length, 0);
  assert.equal(ctx.calls.fillText, plan.sectors.length);
});
