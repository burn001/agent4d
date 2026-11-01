// node --test "web/test/lab.test.mjs"   복셀 연구소(Voxel Lab, 표현 id 'lab') 1단계: 등록·별칭·i18n · computeLab 배치 결정성·자리 고정·겹침 0·
// 외벽 안 · 브리지 경사로 경로 · 길이 장애물을 지나지 않음 · rigState 표 · 오피스 갈고리(VoxelView) · office-core 연구소 분기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAB, LAB_PERF, labRadii, polar, floorYAt, bridgeToWorld, thetaOf, dTheta } from '../lab/lab-const.mjs';
import { computeLab, labFloorY, deskRow } from '../lab/lab-layout-core.mjs';
import { rigState, rigSlots, assignRigSlots, RIG_KINDS, RIG_STATES, rigKindOf } from '../lab/lab-rig-core.mjs';
import { navPath } from '../voxel/nav-core.mjs';
import { breakSlots, breakSpot, clientScreen, clientSpot, ixSpot, overseeSpot } from '../voxel/office-core.mjs';
import { normalizeCmd } from '../control-core.mjs';
import { renderer2dFor, familyOf, RENDERER_LABEL } from '../renderers.js';
import { LAB2D_READY } from '../flat/lab2d-ready.mjs';
import { ART_VIEWS_READY, artInitial } from '../artifact-core.mjs';
import { MESSAGES } from '../i18n.mjs';
import { LAB_SFX_NAMES, LAB_BGM_FALLBACK } from '../lab/lab-audio.mjs';

const tree = (nSub = 6, extra = []) => {
  const a = [{ id: 'm', kind: 'main', order: 0, status: 'active' }];
  for (let i = 0; i < nSub; i++) a.push({ id: 's' + i, kind: 'subagent', parentId: 'm', order: i + 1, status: 'active' });
  return a.concat(extra);
};
const bg = (id, parentId, order) => ({ id, kind: 'bash-bg', parentId, order, status: 'active' });

test('등록: ctl view lab·별칭, 2D 는 복셀 오피스 2D + 준비 중, 작업 대상 층 기본 켬(연구소만), 계열 voxel', () => {
  assert.deepEqual(normalizeCmd('view', { value: 'lab' }).args, { value: 'lab' });
  assert.deepEqual(normalizeCmd('view', { value: 'laboratory' }).args, { value: 'lab' });
  assert.deepEqual(normalizeCmd('view', { value: '연구소' }).args, { value: 'lab' });
  const r = renderer2dFor('lab');
  assert.equal(r.pending, LAB2D_READY ? null : 'lab'); assert.equal(r.base, LAB2D_READY ? 'lab' : 'voxel'); // 평면도 담당이 LAB2D_READY 를 켜면 Lab2DView
  assert.equal(renderer2dFor('voxel').pending, null);
  assert.equal(familyOf('lab'), 'voxel'); assert.equal(familyOf('flow'), 'flow');
  assert.ok(ART_VIEWS_READY.has('lab'));
  assert.equal(artInitial('lab', null, null), true, '연구소: 저장값 없으면 켬(D4)');
  assert.equal(artInitial('lab', null, '0'), false);
  assert.equal(artInitial('lab', '0', '1'), false);
  assert.equal(artInitial('voxel', null, null), false, '다른 표현은 그대로 기본 끔');
  assert.equal(RENDERER_LABEL.lab, '복셀 연구소');
});

test('i18n: 연구소 키(en Voxel Lab · ko 복셀 연구소)', () => {
  for (const k of ['app.renderer.lab', 'app.vsel.hint.lab', 'scene.mode.lab', 'scene.room.lab', 'flat.mode.lab', 'flat.pendingVia', 'app.leg.lab1', 'app.leg.lab4']) {
    assert.ok(MESSAGES.en[k] && MESSAGES.ko[k], k);
  }
  assert.equal(MESSAGES.en['app.renderer.lab'], 'Voxel Lab');
  assert.equal(MESSAGES.ko['app.renderer.lab'], '복셀 연구소');
  for (const k of RIG_KINDS) assert.ok(MESSAGES.ko['lab.rig.' + k] && MESSAGES.en['lab.rig.' + k], 'lab.rig.' + k);
  for (const s of RIG_STATES) assert.ok(MESSAGES.ko['lab.state.' + s] && MESSAGES.en['lab.state.' + s], 'lab.state.' + s);
});

test('VoxelView 갈고리(0단계): 오피스 기본 구현이 있고 LabView 가 덮어씀', () => {
  const src = readFileSync(new URL('../voxel/office.js', import.meta.url), 'utf8');
  for (const h of ['static family', '_computeLayout(present, campus)', '_buildRoom(r, b, o)', '_staticSigExtra()', '_drawRoomFacilities(r, act, t, B, dim)', '_drawRoomDesks(r0, B, now)', '_drawMachineAt(m, st, B)', '_makeArtLayer(opts)', '_floorY(ch)', '_frameHook(now, dt)']) assert.ok(src.includes(h), h);
  const lab = readFileSync(new URL('../lab/lab-view.js', import.meta.url), 'utf8');
  assert.match(lab, /class LabView extends VoxelView/);
  assert.match(lab, /static modeId = 'lab'/);
  for (const h of ['_computeLayout(', '_buildRoom(', '_drawMachineAt(', '_makeArtLayer(', '_floorY(']) assert.ok(lab.includes(h), h);
});

test('computeLab: OfficeLayout 호환·결정적(같은 입력 → 같은 자리)', () => {
  const ns = tree(8, [bg('b1', 's1', 20), { id: 'mo', kind: 'monitor', parentId: 'm', order: 21, status: 'active' }]);
  const a = computeLab(ns, 'm', null), b = computeLab(ns.slice().reverse(), 'm', null);
  assert.equal(a.rooms.length, 1);
  const r = a.rooms[0];
  assert.equal(r.type, 'lab'); assert.ok(r.leadDesk && r.door && r.door.out && r.portal && r.bell && r.stations && r.queues);
  assert.equal(a.seat.get('m').kind, 'lead'); assert.equal(a.seat.get('m').floorY, LAB.BRIDGE.Y);
  const dump = (L) => JSON.stringify([...L.seat].map(([id, s]) => [id, s.kind, s.x.toFixed(4), s.z.toFixed(4)]).sort()) + JSON.stringify([...L.machine].map(([id, m]) => [id, m.type, m.slot]).sort());
  assert.equal(dump(a), dump(b));
  assert.equal(a.machine.get('b1').type, 'rig'); assert.equal(a.machine.get('mo').type, 'rig');
  assert.equal(rigKindOf({ kind: 'bash-bg' }), 'meter', '1단계 = 범용 계측기');
});

test('computeLab: 자리 고정(새 노드가 와도 기존 자리 그대로, 빠지면 칸만 빔)', () => {
  const ns = tree(5, [bg('b1', 's2', 10)]);
  const a = computeLab(ns, 'm', null);
  const b = computeLab(ns.concat([{ id: 'n1', kind: 'subagent', parentId: 'm', order: 0.5, status: 'active' }, bg('b0', 'm', 0.6)]), 'm', a);
  for (const id of ['s0', 's1', 's2', 's3', 's4']) { const p = a.seat.get(id), q = b.seat.get(id); assert.ok(Math.hypot(p.x - q.x, p.z - q.z) < 1e-9, id); }
  assert.equal(b.machine.get('b1').slot, a.machine.get('b1').slot);
  const c = computeLab(ns.filter((n) => n.id !== 's1'), 'm', b);
  for (const id of ['s0', 's2', 's3', 's4']) { const p = b.seat.get(id), q = c.seat.get(id); assert.ok(Math.hypot(p.x - q.x, p.z - q.z) < 1e-9, id); }
});

test('computeLab: 겹침 0(책상끼리·책상↔기자재·기자재↔플랫폼) · 모든 자리가 외벽 안 · 말굽 앞쪽 열림', () => {
  const extra = []; for (let i = 0; i < 20; i++) extra.push(bg('b' + i, 's' + (i % 30), 100 + i));
  const L = computeLab(tree(30, extra), 'm', null), r = L.rooms[0], { R, rP } = r.lab;
  const desks = r.desks;
  for (let i = 0; i < desks.length; i++) for (let j = i + 1; j < desks.length; j++) assert.ok(Math.hypot(desks[i].x - desks[j].x, desks[i].z - desks[j].z) > LAB.DESK.W * 0.95, `책상 ${i}·${j}`);
  const rigs = [...L.machine.values()].filter((m) => m.type === 'rig');
  assert.equal(rigs.length, 20);
  for (const m of rigs) {
    const d = Math.hypot(m.x, m.z);
    assert.ok(d - LAB.RIG.SIZE / 2 > rP, '기자재가 플랫폼 밖'); assert.ok(d + LAB.RIG.SIZE / 2 < R.rWalkOut, '기자재가 고리 안');
    for (const k of desks) assert.ok(Math.hypot(k.x - m.x, k.z - m.z) > 1.5, '기자재·책상');
  }
  for (const s of L.seat.values()) assert.ok(Math.hypot(s.x, s.z) < R.rWall - 0.5, '외벽 안');
  for (const d of desks) assert.ok(Math.abs(dTheta(LAB.BRIDGE_THETA, d.theta)) <= LAB.HORSESHOE_HALF + 1e-6, '말굽 안');
  assert.ok(Math.abs(dTheta(LAB.CAM_THETA, LAB.BRIDGE_THETA)) === 180);
  assert.ok(r.rows >= 2, '30명이면 2열');
});

/** 길 위 점이 장애물 상자 안으로 들어가지 않는지(0.1 간격 표본) */
function clearOf(path, boxes, pad = 0.05) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1));
    for (let k = 0; k <= n; k++) {
      const x = a.x + (b.x - a.x) * (k / n), z = a.z + (b.z - a.z) * (k / n);
      for (const q of boxes) if (x > q.minX + pad && x < q.maxX - pad && z > q.minZ + pad && z < q.maxZ - pad) return { x, z, kind: q.kind };
    }
  }
  return null;
}

test('길찾기: 브리지 팀장 → 출입문은 경사로로 내려옴, 직원 → 시설·탕비실, 장애물을 지나지 않음', () => {
  const L = computeLab(tree(10, [bg('b1', 's1', 30), bg('b2', 's4', 31)]), 'm', null), r = L.rooms[0];
  const lead = L.seat.get('m');
  const p = navPath(lead, r.door, r);
  assert.ok(p && p.length > 2, '길 있음');
  const ys = p.flatMap((q, i) => (i ? [labFloorY(r.lab, (q.x + p[i - 1].x) / 2, (q.z + p[i - 1].z) / 2)] : []).concat(labFloorY(r.lab, q.x, q.z))); // 꼭짓점 + 조각 가운데(경사로는 축 한 조각 — 11.01.)
  assert.equal(ys[0], LAB.BRIDGE.Y); assert.equal(ys[ys.length - 1], 0);
  assert.ok(ys.some((y) => y > 0.05 && y < LAB.BRIDGE.Y - 0.05), '경사로 중간 높이를 지남');
  assert.equal(clearOf(p, r.navBoxes), null);
  for (const [a, b] of [[L.seat.get('s3'), r.stations.skill[0]], [L.seat.get('s7'), r.breakSlots[0]], [L.seat.get('s0'), r.stations.artifact[0]], [L.seat.get('s5'), r.door]]) {
    const q = navPath(a, b, r);
    assert.ok(q, '길 있음'); assert.equal(clearOf(q, r.navBoxes), null);
    assert.ok(q.every((pt) => labFloorY(r.lab, pt.x, pt.z) < 0.01), '바닥 사람은 브리지에 오르지 않음');
  }
});

test('바닥 높이: 덱 1.6 · 경사로 보간 · 그 밖 0', () => {
  const L = computeLab(tree(1), 'm', null), lab = L.rooms[0].lab, f = lab.bridge, B = LAB.BRIDGE;
  const at = (u, v) => { const w = bridgeToWorld(f, u, v, {}); return floorYAt(f, w.x, w.z); };
  assert.equal(at(0, 0), B.Y);
  assert.ok(Math.abs(at(-B.D / 2 + B.RAMP_W / 2, B.W / 2 + B.RAMP_L / 2) - B.Y / 2) < 1e-9);
  assert.equal(at(-B.D / 2 + B.RAMP_W / 2, B.W / 2 + B.RAMP_L + 0.2), 0);
  assert.equal(floorYAt(f, 0, 0), 0);
});

test('office-core 연구소 분기: 탕비실(라운지)·의뢰인 창구(통신 스크린)·특별 상호작용 자리·지휘 자리', () => {
  const L = computeLab(tree(3), 'm', null), r = L.rooms[0];
  assert.equal(breakSlots(r).length, 6); assert.ok(breakSpot(r, 7));
  assert.ok(clientScreen(r).y > LAB.BRIDGE.Y); assert.ok(Number.isFinite(clientSpot(r).face));
  for (const c of ['github', 'db', 'remote', 'batch', 'tests']) assert.ok(ixSpot(r, c), c);
  const s = L.seat.get('s0'), sp = overseeSpot(r, { lx: s.deskLX, lz: s.deskLZ });
  assert.ok(Math.hypot(sp.x, sp.z) < Math.hypot(s.deskX, s.deskZ), '책상 앞(플랫폼 쪽)');
});

test('기자재 모델(1단계): rigState 표 · 고리 자리는 방사 통로를 비움 · 배정은 prev 유지', () => {
  const now = Date.parse('2026-10-31T00:00:00Z');
  assert.equal(rigState({ status: 'active' }, now), 'run');
  assert.equal(rigState({ status: 'idle' }, now), 'wait');
  assert.equal(rigState({ status: 'done' }, now), 'done');
  assert.equal(rigState({ status: 'error' }, now), 'fail');
  assert.equal(rigState({ status: 'stopped' }, now), 'stop');
  assert.equal(rigState(null, now), 'stop');
  const sl = rigSlots(0, 0, 9), r = labRadii(9).rRig;
  assert.ok(sl.length >= 24 && sl.length <= LAB_PERF.RIGS_RING, `칸 ${sl.length}`);
  for (const s of sl) for (const g of LAB.GANGWAYS) assert.ok(Math.abs(dTheta(g, s.theta)) * Math.PI / 180 * r > LAB.GANGWAY_WIDTH / 2, '방사 통로');
  const a = assignRigSlots([{ id: 'x', ownerTheta: 90 }, { id: 'y', ownerTheta: 90 }], sl);
  const b = assignRigSlots([{ id: 'z', ownerTheta: 90 }, { id: 'x', ownerTheta: 270 }], sl, a);
  assert.equal(b.get('x'), a.get('x'));
  assert.ok(Math.abs(dTheta(90, sl[a.get('x')].theta)) < 15, '주인 각 가까이');
});

test('책상 열: 1열은 θ_B 에서 좌우 번갈아, 2열은 반 칸 엇갈림', () => {
  const r0 = deskRow(0, 0, 9, 0), r1 = deskRow(0, 0, 9, 1);
  assert.equal(r0[0].theta, LAB.BRIDGE_THETA);
  assert.ok(dTheta(LAB.BRIDGE_THETA, r0[1].theta) > 0 && dTheta(LAB.BRIDGE_THETA, r0[2].theta) < 0);
  assert.ok(Math.abs(dTheta(LAB.BRIDGE_THETA, r1[0].theta)) > 1, '2열 엇갈림');
  assert.ok(Math.abs(thetaOf(0, 0, polar(0, 0, 5, 30).x, polar(0, 0, 5, 30).z) - 30) < 1e-9);
});

test('성능: computeLab 60 노드 < 5ms(5회 중 최소)', () => {
  const extra = []; for (let i = 0; i < 12; i++) extra.push(bg('b' + i, 's' + i, 100 + i));
  const ns = tree(47, extra);
  let best = Infinity, prev = null;
  for (let k = 0; k < 5; k++) { const t0 = performance.now(); prev = computeLab(ns, 'm', prev); best = Math.min(best, performance.now() - t0); }
  assert.ok(best < LAB_PERF.LAYOUT_MS_60, `${best.toFixed(2)}ms`);
});

test('소리 규격(1단계): 효과음 이름 목록·배경음악 대체 풀', () => {
  assert.equal(LAB_BGM_FALLBACK, 'voxel');
  assert.ok(LAB_SFX_NAMES.length >= 10 && LAB_SFX_NAMES.every((n) => n.startsWith('lab-')));
});
