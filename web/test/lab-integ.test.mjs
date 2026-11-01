// node --test "web/test/lab-integ.test.mjs"   복셀 연구소 통합(리드 2단계): 전체 보기 캠퍼스(computeLabCampus — 프로젝트마다 원형 연구동·
// 같은 프로젝트 live 메인 = 플랫폼 공유·비활성 돔·표시 고르기·자리 고정) · computeLab 중심 이동(cx·cz)·보조 선반·비운 자리 예약·ix 범주 ·
// 시설 예약 장부 열쇠(spotRoomId) · 연구소 충돌 방문 · 효과음 풀(bgm VIEWS lab) · ctl labwalk · mock 시나리오 드라이버(M4 대량 변경)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAB, LAB_PERF } from '../lab/lab-const.mjs';
import { computeLab } from '../lab/lab-layout-core.mjs';
import { computeLabCampus, LAB_CAMPUS } from '../lab/lab-campus-core.mjs';
import { rigSlots } from '../lab/lab-rig-core.mjs';
import { SpotBook, takeStation } from '../voxel/crowd-core.mjs';
import { VxSessCore } from '../voxel/vx-sess-core.mjs';
import { conflictSpots } from '../lab/lab-walk-core.mjs';
import { VIEWS, parseManifest, optionList } from '../bgm-core.mjs';
import { CTL_COMMANDS as CTL } from '../control-core.mjs';
import { LabMockDriver, LAB_MOCK, LAB_MOCK_RIGS } from '../lab/lab-mock.mjs';
import { rigKindOf } from '../lab/lab-rig-core.mjs';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

function proj(pid, mains, { subs = 2, bgs = 1, status = 'active' } = {}) {
  const out = [];
  for (const m of mains) {
    out.push({ id: 's:' + m, kind: 'main', status, projectId: pid, order: out.length, sessionId: m, lastActivityAt: '2026-11-01T00:00:00Z' });
    for (let i = 0; i < subs; i++) out.push({ id: `${m}_s${i}`, kind: 'subagent', parentId: 's:' + m, status: 'active', projectId: pid, order: out.length });
    for (let i = 0; i < bgs; i++) out.push({ id: `${m}_b${i}`, kind: 'bash-bg', parentId: 's:' + m, status: 'active', projectId: pid, order: out.length, meta: { command: 'npm test' } });
  }
  return out;
}
function campusInput() {
  const nodes = [...proj('P1', ['a', 'b', 'c']), ...proj('P2', ['d']), ...proj('P3', ['e'], { status: 'idle' })];
  const roots = ['a', 'b', 'c', 'd', 'e'].map((s, i) => ({ nodeId: 's:' + s, projectId: i < 3 ? 'P1' : i === 3 ? 'P2' : 'P3' }));
  const projects = [
    { projectId: 'P1', name: 'one', live: true, liveList: [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'c' }] },
    { projectId: 'P2', name: 'two', live: true, liveList: [{ sessionId: 'd' }] },
    { projectId: 'P3', name: 'three', live: false },
    { projectId: 'P4', name: 'four', live: false, recent: true }, // 루트 없는 지난 프로젝트 = 빈 연구동(돔 닫힘)
  ];
  return { nodes, roots, projects };
}

test('전체 보기 캠퍼스: 프로젝트마다 연구동 하나 · live 메인 여럿 = 한 플랫폼에 구역(브리지) 나눔 · 비활성 = 돔 닫힘', () => {
  const { nodes, roots, projects } = campusInput();
  const L = computeLabCampus(nodes, roots, projects, null, { nowMs: Date.parse('2026-11-01T00:00:10Z') });
  assert.equal(L.campus, true); assert.equal(L.lab, true);
  assert.deepEqual(L.buildings.map((b) => b.projectId).sort(), ['P1', 'P2', 'P3', 'P4']);
  const P1 = L.buildings.find((b) => b.projectId === 'P1');
  const r1 = L.rooms.filter((r) => r.projectId === 'P1');
  assert.equal(r1.length, 3, '메인 3 = 구역 방 3');
  assert.equal(new Set(r1.map((r) => `${r.lab.cx},${r.lab.cz}`)).size, 1, '플랫폼 하나(같은 중심)');
  assert.equal(r1.filter((r) => r.lab.primary).length, 1);
  assert.equal(r1[0].lab.zones.length, 3);
  assert.ok(near(r1[0].lab.cx, P1.center.x) && near(r1[0].lab.cz, P1.center.z));
  // 비활성·빈 프로젝트는 돔 닫힘, live 는 열림
  const by = Object.fromEntries(L.buildings.map((b) => [b.projectId, b]));
  assert.equal(by.P1.dome, false); assert.equal(by.P2.dome, false); assert.equal(by.P4.dome, true); assert.equal(by.P4.recent, true);
  // 동끼리 겹치지 않음(격자 칸 ≥ 지름 + 간격)
  for (const a of L.buildings) for (const b of L.buildings) {
    if (a === b) continue;
    assert.ok(Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z) >= a.lab.rWall + b.lab.rWall + LAB_CAMPUS.GAP - 1e-6, `${a.projectId}·${b.projectId}`);
  }
  // 모든 사람은 자기 프로젝트 연구동 외벽 안
  for (const [id, s] of L.seat) {
    const r = L.rooms.find((x) => x.id === s.roomId);
    assert.ok(Math.hypot(s.x - r.lab.cx, s.z - r.lab.cz) < r.lab.R.rWall, id);
  }
  for (const m of L.machine.values()) { const r = L.rooms.find((x) => x.id === m.roomId); assert.ok(Math.hypot(m.x - r.lab.cx, m.z - r.lab.cz) < r.lab.R.rWall); }
  // projectOf · roots
  assert.equal(L.projectOf.get('a_s0'), 'P1');
  assert.ok(L.roots.has('s:a') && L.roots.has('s:d'));
});

test('전체 보기 자리 고정: 같은 입력이면 같은 자리 · 이전 결과를 넘기면 동 슬롯·사람 자리 유지 · 숨긴 프로젝트(§99)는 빠짐', () => {
  const { nodes, roots, projects } = campusInput();
  const a = computeLabCampus(nodes, roots, projects, null, {});
  const b = computeLabCampus(nodes, roots, projects, a, {});
  for (const [id, s] of a.seat) { const t = b.seat.get(id); assert.ok(t && near(s.x, t.x) && near(s.z, t.z), id); }
  for (const x of a.buildings) assert.deepEqual(b.buildings.find((y) => y.projectId === x.projectId).slot, x.slot);
  const hid = projects.map((p) => (p.projectId === 'P2' ? { ...p, userHidden: true } : p));
  const c = computeLabCampus(nodes, roots, hid, b, {});
  assert.ok(!c.buildings.some((x) => x.projectId === 'P2'), 'P2 숨김');
  assert.ok(c.hidden.has('s:d'));
});

test('computeLab 중심 이동(cx·cz): 같은 배치를 그대로 옮김 · 길찾기 장애물도 함께', () => {
  const ns = proj('P', ['a'], { subs: 7, bgs: 5 });
  const A = computeLab(ns, 's:a', null, {}), B = computeLab(ns, 's:a', null, { cx: 100, cz: -40 });
  for (const [id, s] of A.seat) { const t = B.seat.get(id); assert.ok(near(s.x + 100, t.x, 1e-6) && near(s.z - 40, t.z, 1e-6), id); }
  for (const [id, m] of A.machine) { const t = B.machine.get(id); assert.ok(near(m.x + 100, t.x, 1e-6) && near(m.z - 40, t.z, 1e-6), id); }
  const na = A.rooms[0].navBoxes.length, nb = B.rooms[0].navBoxes.length;
  assert.ok(Math.abs(na - nb) <= Math.ceil(na * 0.01), `${na} ≈ ${nb}`); // 선분 사슬 칸 수는 부동소수 반올림으로 ±1
  assert.ok(near(A.rooms[0].navBoxes[0].minX + 100, B.rooms[0].navBoxes[0].minX, 1e-6));
  assert.equal(B.rooms[0].lab.cx, 100);
});

test('기자재: 고리가 차면 보조 선반(0.6배 · i ≥ 1000 · 길찾기 상자 반폭 0.42) → 그래도 넘치면 주인별 +n · 비운 자리는 예약', () => {
  const n0 = rigSlots(0, 0, LAB.PLATFORM.R_DEFAULT).length;
  const ns = [{ id: 'm', kind: 'main', order: 0 }];
  for (let i = 0; i < n0 + 15; i++) ns.push({ id: 'b' + i, kind: 'bash-bg', parentId: 'm', order: 1 + i });
  const L = computeLab(ns, 'm', null, {});
  const rigs = [...L.machine.values()].filter((m) => m.type === 'rig');
  const shelf = rigs.filter((m) => m.shelf);
  assert.equal(rigs.length - shelf.length, n0);
  assert.equal(shelf.length, LAB.RIG.SHELF_MAX);
  for (const s of shelf) { assert.ok(s.slot >= 1000); assert.equal(s.scale, 0.6); }
  assert.equal(L.rooms[0].lab.rigMore.get('m'), 15 - LAB.RIG.SHELF_MAX);
  assert.ok(rigs.length <= LAB_PERF.RIGS_RING + LAB.RIG.SHELF_MAX);
  assert.ok(L.rooms[0].navBoxes.some((q) => q.kind === 'rig' && near(q.maxX - q.minX, 0.84, 1e-9)));
  // 비운 자리 예약: reserved 칸은 새 기자재가 쓰지 않음
  const few = [{ id: 'm', kind: 'main', order: 0 }, { id: 'x', kind: 'bash-bg', parentId: 'm', order: 1 }];
  const free = computeLab(few, 'm', null, {}).machine.get('x').slot;
  const res = computeLab(few, 'm', null, { reserved: new Set([free]) }).machine.get('x').slot;
  assert.notEqual(res, free);
});

test('기자재 종류: ix 범주(opts.ixCatOf)가 명령 글보다 먼저 · 한 번 정한 종류는 고정 · 기동기는 시퀀서(자리 slot 으로만 이어받음)', () => {
  const ns = [{ id: 'm', kind: 'main', order: 0 }, { id: 'q', kind: 'bash-bg', parentId: 'm', order: 1, meta: { command: 'python x.py' } },
    { id: 'L', kind: 'bash-bg', parentId: 'm', order: 2, meta: { launcher: { script: 'r.sh' } } }];
  const A = computeLab(ns, 'm', null, { ixCatOf: (id) => (id === 'q' ? 'db' : null) });
  assert.equal(A.machine.get('q').rigKind, 'tank');
  const B = computeLab(ns, 'm', A, {});
  assert.equal(B.machine.get('q').rigKind, 'tank', '이전 종류 유지');
  assert.equal(A.machine.get('L').type, 'batch'); assert.equal(A.machine.get('L').rigKind, 'sequencer');
  const C = computeLab(ns, 'm', A, { cx: 50 });
  assert.ok(near(C.machine.get('L').x, A.machine.get('L').x + 50, 1e-6), '기동기 자리는 중심을 따라 다시 계산');
});

test('시설 예약 장부: 구역 방끼리 spotRoomId 하나 — 두 구역 사람이 같은 시설 자리를 겹쳐 잡지 않음', () => {
  const L = computeLab([...proj('P', ['a', 'b'], { subs: 1, bgs: 0 })], 's:a', null, {});
  const [r0, r1] = L.rooms;
  assert.equal(r0.spotRoomId, r1.spotRoomId);
  const book = new SpotBook();
  const got = [];
  for (let i = 0; i < 4; i++) { const ch = { id: 'c' + i, room: i % 2 ? r1 : r0 }; const sp = takeStation(book, ch, 'skill'); if (sp) got.push(`${sp.x.toFixed(3)},${sp.z.toFixed(3)}`); }
  assert.equal(new Set(got).size, got.length, '같은 자리 둘 없음');
});

test('연구소 충돌 방문: 블록 방위 가장자리 양옆 두 칸에서 마주 봄 · 블록이 없으면 방문 없음', () => {
  const L = computeLab([...proj('P', ['a', 'b'], { subs: 1, bgs: 0 })], 's:a', null, {});
  const room = L.rooms[0];
  const ch = (id) => ({ id, state: 'seated', placed: true, offstage: false, room, visit: null });
  const A = ch('a_s0'), B = ch('b_s0');
  let theta = 130;
  const view = { layout: L, ts: 1, chars: new Map([['a_s0', A], ['b_s0', B]]), _conflictTheta: () => theta, _conflictSpots: conflictSpots };
  const S = new VxSessCore(view);
  S.book = { items: () => [{ a: 's:a', b: 's:b', file: 'x.js', path: 'src/x.js', level: 'strong', nodeA: 'a_s0', nodeB: 'b_s0' }] };
  S.stepConflicts(10);
  assert.ok(A.visit && B.visit && A.visit.lab);
  const sp = conflictSpots(room, 130);
  assert.ok(near(A.visit.spot.x, sp[0].x) && near(B.visit.spot.x, sp[1].x));
  A.visit = B.visit = null; theta = null; S.seen.clear();
  S.stepConflicts(11);
  assert.equal(A.visit, null, '블록 없음 = 방문 없음');
});

test('음악·ctl: bgm VIEWS 에 lab · 연구소 곡 없으면 곡 목록도 복셀 오피스 묶음 · ctl labwalk on|off', () => {
  assert.ok(VIEWS.includes('lab'));
  const { tracks } = parseManifest({ tracks: [{ id: 'v1', file: 'a.mp3', label: 'A', stage: [1], views: { voxel: [1] } }, { id: 'f1', file: 'b.mp3', label: 'B', stage: [1], views: { flow: [1] } }] });
  const opt = optionList(tracks, 'lab');
  const v1 = opt.find((o) => o.value === 'v1'), f1 = opt.find((o) => o.value === 'f1');
  assert.ok(v1 && !v1.other, '복셀 곡이 위 묶음'); assert.ok(f1 && f1.other);
  assert.deepEqual(CTL.labwalk.values, ['on', 'off']);
});

test('연구소 효과음·POV·캐릭터 연결(원문 확인): Sfx.view·playLab · pov 바닥 높이 · 연구소 방문은 방 안 길 · 문패는 첫 구역', () => {
  const sfx = readFileSync(path.join(WEB, 'sfx.mjs'), 'utf8');
  assert.match(sfx, /this\.view === 'lab'/); assert.match(sfx, /playLab\(name/);
  const app = readFileSync(path.join(WEB, 'app.js'), 'utf8');
  assert.match(app, /sfx\.view = next/); assert.match(app, /v\.labSound = /);
  const pov = readFileSync(path.join(WEB, 'pov.js'), 'utf8');
  assert.match(pov, /headY: ch\.headY\(\) \+ fy0/);
  const cc = readFileSync(path.join(WEB, 'voxel/character-core.mjs'), 'utf8');
  assert.match(cc, /want\.type === 'visit' && door && !inRoom/);
  const lv = readFileSync(path.join(WEB, 'lab/lab-view.js'), 'utf8');
  assert.match(lv, /r\.lab\.primary === false\) return; \/\/ 다중 메인 구역/);
  assert.match(lv, /_roomLabelOn\(r\)/);
});

test('mock 시나리오 표 10개 · M4 대량 변경 드라이버: 같은 폴더 Edit 6개 이상을 1초 간격으로(10초 안)', () => {
  assert.equal(LAB_MOCK.length, 10);
  assert.deepEqual(LAB_MOCK.map((x) => x.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const [kind, cmd] of LAB_MOCK_RIGS) assert.equal(rigKindOf({ kind: kind === 'scope' ? 'monitor' : 'bash-bg', meta: { command: cmd } }), kind, cmd);
  const evs = [], q = [];
  const nodes = [{ id: 's:m', kind: 'main', status: 'active' }];
  const d = new LabMockDriver({ nodes: () => nodes, emit: (e) => evs.push(e), scenario: 4, first: 0 });
  d._at = (ms, fn) => q.push([ms, fn]);
  d.on = true; d._run();
  const starts = q.filter(([ms]) => ms < 10000);
  assert.ok(starts.length >= 6);
  for (const [, fn] of starts) fn();
  const edits = evs.filter((e) => e.type === 'tool-start' && e.tool === 'Edit');
  assert.ok(edits.length >= 6);
  assert.equal(new Set(edits.map((e) => e.art[0].d)).size, 1, '같은 폴더');
  d.stop();
});

test('성능: 전체 보기 연구동 4개 · 노드 60 배치 < 4 × LAYOUT_MS_60', () => {
  const nodes = [], roots = [], projects = [];
  for (let p = 0; p < 4; p++) {
    const mains = [`p${p}a`, `p${p}b`];
    nodes.push(...proj('P' + p, mains, { subs: 5, bgs: 2 }));
    for (const m of mains) roots.push({ nodeId: 's:' + m, projectId: 'P' + p });
    projects.push({ projectId: 'P' + p, name: 'p' + p, live: true, liveList: mains.map((s) => ({ sessionId: s })) });
  }
  assert.ok(nodes.length >= 60);
  let best = Infinity, prev = null;
  for (let k = 0; k < 5; k++) { const t0 = performance.now(); prev = computeLabCampus(nodes, roots, projects, prev, {}); best = Math.min(best, performance.now() - t0); }
  assert.ok(best < 4 * LAB_PERF.LAYOUT_MS_60, `${best.toFixed(2)}ms`);
});
