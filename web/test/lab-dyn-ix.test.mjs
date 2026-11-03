// node --test "web/test/lab-dyn-ix.test.mjs"   [C 연구소 상호작용] 복셀 연구소 — 특별 상호작용 연구소판(vx-ix 연구소 분기 → LabView._labIxDraw) ·
// 운반 캡슐(LabCouriers·courierFor — 의뢰·보고·산출) · 사람 몸짓(labGesturePose) · 케이블 데이터 펄스(cablePulseEdge) · LOD 표 · 오피스 회귀(원문 대조).
// three 없이: lab-ix-core · lab-gesture-core · lab-const · lab-layout-core computeLab 만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAB, thetaOf } from '../lab/lab-const.mjs';
import { computeLab } from '../lab/lab-layout-core.mjs';
import {
  LAB_IX, LabCouriers, courierFor, courierLod, courierArc, labIxRoute, labIxShouldDraw, labIxCount,
  newPulseMem, cablePulseEdge, cablePulsePush, cablePulseRead, labPendStep,
} from '../lab/lab-ix-core.mjs';
import { labGesturePose, labGestureSet, gestureT0, GESTURE_KINDS, GESTURE_RANGE, GESTURE_STAY } from '../lab/lab-gesture-core.mjs';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(path.join(WEB, f), 'utf8');

const RIGS = [
  ['tests', 'npm test'], ['reactor', 'npm run build'], ['meter', 'python report.py'], ['tank', "psql -c 'VACUUM'"],
  ['oscillo', 'uvicorn app:api --port 8080'], ['antenna', 'rsync -az dist/ build-host:/srv/'], ['incubator', 'python train.py --epochs 40'],
];
function scene() {
  const nodes = [
    { id: 'm', kind: 'main', status: 'active', order: 0 },
    { id: 's1', kind: 'subagent', parentId: 'm', status: 'active', order: 1 },
    { id: 's2', kind: 'workflow-agent', parentId: 'm', status: 'active', order: 2 },
    { id: 'mon', kind: 'monitor', parentId: 'm', status: 'active', order: 3, meta: {} },
  ];
  RIGS.forEach(([k, cmd], i) => nodes.push({ id: 'b:' + k, kind: 'bash-bg', parentId: i % 2 ? 's1' : 'm', status: 'active', order: 10 + i, label: cmd, meta: { command: cmd } }));
  const lay = computeLab(nodes, 'm', null, {});
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, byId, lay, ctx: { layout: lay, nodeOf: (id) => byId.get(id) || null } };
}

test('1) LabCouriers: cap 24 · pri 큰 것부터 밀려남 · step 뒤 비움 · 워밍 뒤 풀 길이 불변', () => {
  const C = new LabCouriers(24);
  for (let i = 0; i < 30; i++) C.add('pod', 0, 0, 0, 1, 0, 1, i * 0.01, 1.0, null, i % 3);
  assert.equal(C.n, 24);
  const cnt = [0, 0, 0];
  for (let i = 0; i < C.n; i++) cnt[C.list[i].pri]++;
  assert.deepEqual(cnt, [10, 10, 4], '낮은 우선(pri 2)부터 버림');
  // 모두 pri 0 이 차 있으면 pri 2 새것은 버려짐
  const D = new LabCouriers(2);
  D.add('a', 0, 0, 0, 0, 0, 0, 0, 1, null, 0); D.add('a', 0, 0, 0, 0, 0, 0, 0, 1, null, 0);
  assert.equal(D.add('b', 0, 0, 0, 0, 0, 0, 0, 1, null, 2), null);
  assert.equal(D.n, 2);
  C.step(0.3 + 1.0 + LAB_IX.RING_S + 0.05);
  assert.equal(C.n, 0, 'dur + 0.3 뒤 비움');
  const L0 = C.list.length, objs = new Set(C.list);
  let t = 0;
  for (let k = 0; k < 10000; k++) { t += 0.05; C.add('dispatch', 0, 1, 0, 3, 1, 3, t, 0.4, null, k % 2); C.step(t); }
  assert.equal(C.list.length, L0, '풀 길이 불변');
  for (const o of C.list) assert.ok(objs.has(o), '같은 항목 객체(새로 만들지 않음)');
  assert.ok(C.n <= 24);
  C.clear(); assert.equal(C.n, 0);
});

test('2) courierFor: 의뢰(콘솔 → 새 책상) · 보고(ok 초록 / 실패 빨강) · 산출(반출대 θ30～60 · 탱크 θ200～250 · 산출 없는 종류·실패 null)', () => {
  const { byId, lay, ctx } = scene();
  const room = lay.rooms[0], s1 = lay.seat.get('s1');
  const d = courierFor({ type: 'node-add', node: byId.get('s1') }, ctx);
  assert.equal(d.kind, 'dispatch');
  assert.ok(d.from.y >= 1.6, '팀장 콘솔(브리지 덱 위)');
  assert.ok(Math.abs(d.from.x - room.leadDesk.x) < 1e-9 && Math.abs(d.from.z - room.leadDesk.z) < 1e-9);
  assert.ok(Math.abs(d.to.x - s1.deskX) < 1e-9 && Math.abs(d.to.z - s1.deskZ) < 1e-9, '그 서브에이전트 책상');
  assert.equal(d.color, 'sess'); assert.equal(d.pri, 1); assert.equal(d.dur, 1.0);
  assert.equal(d.gesture, 'dispatch'); assert.equal(d.lead, 'm'); assert.equal(d.arrive, 's1'); assert.equal(d.owner, 'm');
  assert.equal(courierFor({ type: 'node-add', node: byId.get('s2') }, ctx).kind, 'dispatch', '워크플로 에이전트도');
  assert.equal(courierFor({ type: 'node-add', node: byId.get('m') }, ctx), null, '메인은 의뢰 없음');
  assert.equal(courierFor({ type: 'node-add', node: { id: 'nope', kind: 'subagent', parentId: 'm' } }, ctx), null, '배치에 자리 없으면 null(대기 목록)');
  const ok = courierFor({ type: 'node-update', node: byId.get('s1'), patch: { status: 'done' } }, ctx);
  assert.equal(ok.kind, 'report'); assert.equal(ok.color, 'ok');
  assert.ok(Math.abs(ok.from.x - s1.deskX) < 1e-9 && ok.to.y >= 1.6, '책상 → 콘솔');
  assert.equal(ok.gesture, 'receive');
  assert.equal(courierFor({ type: 'node-update', node: byId.get('s1'), patch: { status: 'error' } }, ctx).color, 'fail');
  assert.equal(courierFor({ type: 'node-update', node: byId.get('s1'), patch: { status: 'active' } }, ctx), null);
  assert.equal(courierFor({ type: 'result', node: byId.get('s1'), ok: false }, ctx).color, 'fail');
  const { cx, cz } = room.lab;
  const rig = (k, prev = 'run', state = 'done') => courierFor({ type: 'rig', node: byId.get('b:' + k), prev, state }, ctx);
  for (const k of ['tests', 'reactor', 'meter', 'incubator']) {
    assert.equal(lay.machine.get('b:' + k).rigKind, k, k + ' 판정');
    const c = rig(k);
    assert.equal(c.kind, 'pod', k);
    const th = thetaOf(cx, cz, c.to.x, c.to.z);
    assert.ok(th >= 30 && th <= 60, k + ' θ ' + th);
    assert.ok(c.from.y >= 1.0, '기자재 꼭대기');
    assert.equal(c.color, 'rig:' + k); assert.equal(c.pri, 2); assert.equal(c.m, 1); assert.ok(c.dur >= 1.2 && c.dur <= 2.4, 'dur 1.2 + 0.04·거리 ≤ 2.4');
  }
  const tk = rig('tank');
  const th = thetaOf(cx, cz, tk.to.x, tk.to.z);
  assert.ok(th >= 200 && th <= 250, 'tank θ ' + th);
  assert.equal(tk.m, 3, '방울 3'); assert.ok(tk.dur >= 1.0 && tk.dur <= 2.4);
  assert.equal(Math.hypot(tk.to.x - cx, tk.to.z - cz).toFixed(3), (room.lab.rP - 0.8).toFixed(3));
  for (const k of ['oscillo', 'antenna']) assert.equal(rig(k), null, k);
  assert.equal(lay.machine.get('mon').rigKind, 'scope');
  assert.equal(courierFor({ type: 'rig', node: byId.get('mon'), prev: 'run', state: 'done' }, ctx), null, 'scope');
  assert.equal(rig('tests', 'run', 'fail'), null, 'run → fail = null(불꽃은 기자재)');
  assert.equal(rig('tests', null, 'done'), null, '처음 본 상태(스냅샷)면 null');
  assert.equal(rig('tests', 'done', 'done'), null);
});

test('3) labIxRoute: bg 기자재 꼭대기 출발 · db 쓰기 out / 읽기 in · github push out(코어) / clone in · remote down in · 공급선', () => {
  const { lay } = scene();
  const room = lay.rooms[0], desk = { id: 'm', x: room.leadDesk.x, y: 1.2, z: room.leadDesk.z, floorY: 1.6 };
  const rigOf = (id) => { const p = lay.machine.get(id); return p && p.type === 'rig' ? p : null; };
  const out = { from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 0 } };
  const r1 = labIxRoute({ cat: 'db', ix: { rw: 'w', rows: 300 }, bgNode: 'b:tank', nodeId: 'm' }, desk, room, rigOf, out);
  assert.equal(r1, out, '넘긴 객체 재사용');
  assert.ok(r1.from.y >= 1.0, '기자재 꼭대기(높이 ≥ 1.0)');
  const tp = lay.machine.get('b:tank');
  assert.ok(Math.abs(r1.from.x - tp.x) < 1e-9 && Math.abs(r1.from.z - tp.z) < 1e-9);
  assert.equal(r1.dir, 'out'); assert.equal(r1.rig, 'b:tank');
  assert.deepEqual([r1.to.x, r1.to.y, r1.to.z], [room.ixSpots.db.x, room.ixSpots.db.y, room.ixSpots.db.z]);
  assert.equal(labIxRoute({ cat: 'db', ix: {}, nodeId: 'm' }, desk, room, rigOf).dir, 'in');
  const rr = labIxRoute({ cat: 'db', ix: { rw: 'r' }, nodeId: 'm' }, desk, room, rigOf);
  assert.ok(Math.abs(rr.from.y - 2.8) < 1e-9, '책상(1.2) + 브리지 바닥(1.6)');
  const gp = labIxRoute({ cat: 'github', ix: { op: 'push' }, nodeId: 'm' }, desk, room, rigOf);
  assert.equal(gp.dir, 'out');
  assert.deepEqual([gp.to.x, gp.to.z], [room.ixSpots.github.x, room.ixSpots.github.z]);
  assert.equal(gp.to.x, room.lab.cx, '코어');
  assert.equal(labIxRoute({ cat: 'github', ix: { op: 'clone' }, nodeId: 'm' }, desk, room, rigOf).dir, 'in');
  assert.equal(labIxRoute({ cat: 'github', ix: { op: 'commit' }, nodeId: 'm' }, desk, room, rigOf).dir, 'out');
  assert.equal(labIxRoute({ cat: 'remote', ix: { transfer: 'down' }, nodeId: 'm' }, desk, room, rigOf).dir, 'in');
  assert.equal(labIxRoute({ cat: 'remote', ix: { transfer: 'up' }, nodeId: 'm' }, desk, room, rigOf).dir, 'out');
  const ts = labIxRoute({ cat: 'tests', ix: {}, nodeId: 'm' }, desk, room, rigOf);
  assert.deepEqual([ts.to.x, ts.to.z], [room.ixSpots.tests.x, room.ixSpots.tests.z], '포그라운드 tests = 브리지 시험 신호탑');
  const sup = labIxRoute({ cat: 'tests', ix: {}, nodeId: 'm', bgNode: 'b:tests' }, desk, room, rigOf);
  assert.equal(sup.key, 'supply', 'bg 시험 = 공급선(책상 → 기자재)');
  assert.ok(Math.abs(sup.to.x - lay.machine.get('b:tests').x) < 1e-9);
  assert.equal(labIxRoute({ cat: 'user', ix: {} }, desk, room, rigOf), null, 'ixSpots 없는 범주');
  assert.equal(labIxCount({ cat: 'db', ix: { rows: 1 } }), 2);
  assert.equal(labIxCount({ cat: 'db', ix: { rows: 1e6 } }), 5);
  assert.equal(labIxCount({ cat: 'github', ix: {} }), 1);
  assert.equal(labIxCount({ cat: 'remote', ix: {} }), 3);
});

test('4) labGesturePose: 7종 관절 범위 · kill 뻗음/거둠 · 없음·만료·자리 다르면 false 이고 P 불변', () => {
  const P0 = () => ({ legL: 0, legR: 0, armL: -0.06, armR: -0.06, rollL: 0, rollR: 0, lean: 0, headP: 0, headY: 0, mug: false, bag: false });
  const J = ['legL', 'legR', 'armL', 'armR', 'rollL', 'rollR', 'lean', 'headP', 'headY'];
  assert.equal(GESTURE_KINDS.length, 7);
  for (const kind of GESTURE_KINDS) {
    const ch = { target: { type: kind === 'dispatch' || kind === 'receive' ? 'desk' : 'visit' } };
    assert.ok(labGestureSet(ch, kind, 10, 10 + GESTURE_STAY[kind]));
    for (let t = 10; t < 10 + GESTURE_STAY[kind]; t += 0.037) {
      const P = P0();
      assert.equal(labGesturePose(P, ch, t), true, kind);
      for (const j of J) assert.ok(Number.isFinite(P[j]) && P[j] >= GESTURE_RANGE[0] && P[j] <= GESTURE_RANGE[1], `${kind} ${j}=${P[j]}`);
    }
  }
  const ch = { target: { type: 'visit' } };
  const g = labGestureSet(ch, 'kill', 0, 1);
  assert.equal(ch._g, g, 'ch._g 재사용');
  let P = P0(); labGesturePose(P, ch, 0.4); assert.ok(P.armR <= -1.5, 'k 0.4 뻗음 ' + P.armR);
  P = P0(); labGesturePose(P, ch, 0.5); assert.ok(P.armR <= -1.4, '누름');
  P = P0(); labGesturePose(P, ch, 0.95); assert.ok(P.armR >= -0.5, 'k 0.95 거둠 ' + P.armR);
  assert.equal(labGestureSet(ch, 'field', 5, 6), g, '다른 종류도 같은 객체');
  const w = { target: { type: 'visit' } }; labGestureSet(w, 'watch', 0, 3); P = P0(); labGesturePose(P, w, 1); assert.equal(P.clip, true);
  const rc = { target: { type: 'desk' } }; labGestureSet(rc, 'receive', 0, 0.6); P = P0(); labGesturePose(P, rc, 0.3); assert.equal(P.card, true);
  // 없음·만료·자리 불일치
  for (const [c, t] of [[{ target: { type: 'visit' } }, 0], [ch, 99], [{ target: { type: 'desk' }, gesture: { kind: 'kill', t0: 0, until: 9, at: 'visit' } }, 1], [{ target: { type: 'visit' }, gesture: { kind: 'dispatch', t0: 0, until: 9, at: 'here' } }, 1]]) {
    const Q = P0(), before = JSON.stringify(Q);
    assert.equal(labGesturePose(Q, c, t), false);
    assert.equal(JSON.stringify(Q), before, 'P 불변');
  }
  assert.equal(labGestureSet({}, 'kill', 5, 5), null, 'until ≤ t0');
  assert.equal(labGestureSet({}, 'dance', 0, 1), null);
  // 도착 추정: 걷는 시간 뒤, until 을 넘지 않음
  assert.ok(Math.abs(gestureT0(10, { x: 0, z: 0 }, { x: 3.5, z: 0 }, 1, 99) - 11.4) < 1e-9);
  assert.ok(gestureT0(10, { x: 0, z: 0 }, { x: 100, z: 0 }, 1, 12) < 12);
});

test('5) 오피스 회귀(원문): character.js 갈고리 한 줄(걷기 분기 뒤) · vx-ix _office 사무실 갈래 그대로 · _labIxDraw 는 연구소에서만', () => {
  const ch = src('voxel/character.js');
  const hook = "  if (ch.gesture && ch.gesture.until > t && GESTURE_POSE(P, ch, t)) return P;";
  assert.equal(ch.split(hook).length, 2, '갈고리 한 줄');
  const lines = ch.split('\n').filter((l) => l.includes('ch.gesture') || l.includes('GESTURE_POSE'));
  assert.equal(lines.length, 2, 'import 한 줄 + 갈고리 한 줄: ' + lines.join(' | '));
  assert.match(ch, /import \{ labGesturePose as GESTURE_POSE \} from '\.\.\/lab\/lab-gesture-core\.mjs';/);
  const iWalk = ch.indexOf('  if (walking) {'), iHook = ch.indexOf(hook), iBreak = ch.indexOf("  if (tt === 'break') {");
  assert.ok(iWalk > 0 && iWalk < iHook && iHook < iBreak, '걷기 분기(return P) 바로 뒤');
  assert.match(ch.slice(iWalk, iHook), /return P;\n  \}\n$/, '걷기 분기가 먼저 return');
  const ix = src('voxel/vx-ix.js');
  assert.match(ix, /    if \(room\.type === 'office'\) return room;\n/);
  assert.match(ix, /    return room\.officeId \? this\.view\.roomsById\.get\(room\.officeId\) \|\| null : null;\n/);
  assert.match(ix, /if \(room\.type === 'lab'\) return room;/);
  assert.equal(ix.split('_labIxDraw(').length, 2, '갈고리 호출 한 곳');
  assert.match(ix, /if \(room\.type === 'lab'\) \{[^\n]*\n\s+if \(v\._labIxDraw && v\._labIxDraw\(B, f, act, room, sp, tt, te, A, ck, now\)\) \{/, '연구소 분기 안에서만');
  // 사무실 은유 갈래는 그대로
  for (const s of ["case 'github': ia.github = Math.max(ia.github || 0, A); this._github(", "case 'batch': { const rl = roomFrame(room, B); this._batch(", "case 'tests': { const rl = roomFrame(room, B); this._tests("]) assert.ok(ix.includes(s), s);
  // LabView 만 갈고리를 가짐 · VoxelView(office.js) 에는 없음
  assert.ok(!src('voxel/office.js').includes('_labIxDraw'));
  const lv = src('lab/lab-view.js');
  assert.match(lv, /_labIxDraw\(B, f, act, room, sp, tt, te, A, ck, now\) \{\n\s+if \(!labIxShouldDraw\(room\)/);
  assert.match(lv, /st\.ts = this\.ts \|\| 1; st\.reduced = !!this\.reduced; st\.camD = Math\.sqrt\(d2\);/, 'drawRig 부드러운 계약');
  assert.match(lv, /labGestureSet\(ch, kind, gestureT0\(/, '_walk 성공 = 몸짓');
  // 2D 오피스 갈래 불변: 연구소 조건 안에서만 bg 기자재 출발
  const vx = src('flat/vx2d-extra.js');
  assert.match(vx, /if \(off\.type === 'lab' && f\.bgNode\) \{/);
});

test('6) vx-ix 연구소 분기 판정 labIxShouldDraw', () => {
  const { lay } = scene();
  assert.equal(labIxShouldDraw(lay.rooms[0]), true);
  assert.equal(labIxShouldDraw({ type: 'office' }), false);
  assert.equal(labIxShouldDraw({ type: 'annex', officeId: 'o' }), false);
  assert.equal(labIxShouldDraw(null), false);
});

test('7) cablePulseEdge: 상승 가장자리만 · 초당 2회 · 펄스 칸 2개', () => {
  const m = newPulseMem();
  assert.equal(cablePulseEdge(m, 0, 1), false, '켜진 적 없음');
  assert.equal(cablePulseEdge(m, 1.35, 1.0), true, '출력 → flashUntil 상승');
  assert.equal(cablePulseEdge(m, 1.35, 1.1), false, '같은 값 = 가장자리 아님');
  assert.equal(cablePulseEdge(m, 1.55, 1.2), false, '0.5초 안 두 번째 = 제한');
  assert.equal(cablePulseEdge(m, 1.9, 1.55), true, '0.5초 뒤');
  assert.equal(cablePulseEdge(m, 1.0, 2.0), false, '오래된 값(이미 꺼짐)');
  const s = newPulseMem();
  assert.equal(cablePulseEdge(s, 5, 9), false, '처음 본 지난 섬광(꺼짐)은 펄스 아님');
  // 초당 상한: 30Hz 로 매 프레임 출력이 와도 1초에 ≤ 2
  const q = newPulseMem(); let n = 0;
  for (let i = 0; i < 30; i++) { const t = 10 + i / 30; if (cablePulseEdge(q, t + 0.35, t)) n++; }
  assert.ok(n <= 2, String(n));
  const out = [];
  cablePulsePush(q, 20, 0); cablePulsePush(q, 20.3, 1); cablePulsePush(q, 20.4, 2);
  const k = cablePulseRead(q, 20.5, 0.8, out);
  assert.equal(k, 2, '칸 2개(오래된 것 덮음)');
  assert.deepEqual(out.slice(0, k).map((o) => o.k).sort(), [1, 2]);
  assert.equal(cablePulseRead(q, 30, 0.8, out), 0, '끝남');
});

test('8) LOD: courierLod 표 · 포물선 높이 · 대기 목록 압축', () => {
  assert.equal(courierLod(false, false), 'full');
  assert.equal(courierLod('mid', false), 'body', '중경 = 꼬리 없음');
  assert.equal(courierLod(true, false), 'ring', '원경 = 도착 링만');
  assert.equal(courierLod(false, true), 'ring', '움직임 줄이기 = 정지 링');
  assert.equal(courierLod('mid', true), 'ring');
  assert.equal(courierLod(true, true), 'none');
  assert.equal(courierArc(0), 1.0); assert.equal(courierArc(10), 2.0); assert.equal(courierArc(100), 3);
  const pend = [{ id: 'a', at: 0 }, { id: 'b', at: 0 }, { id: 'c', at: 1.5 }];
  const ref = pend;
  assert.equal(labPendStep(pend, 1, (p) => p.id === 'a'), 2);
  assert.equal(pend, ref, '제자리');
  assert.equal(labPendStep(pend, 2.2, () => false), 1, '2초 지난 것은 버림');
  assert.equal(pend[0].id, 'c');
});

test('성능 상한 상수: 캡슐 24 × 4 = 96 · ix 효과 12 · 합 60', () => {
  assert.equal(LAB_IX.COURIERS * LAB_IX.COURIER_BOXES, 96);
  assert.equal(LAB_IX.FX_MAX, 12); assert.equal(LAB_IX.TOTAL_MAX, 60);
  assert.ok(LAB.RIM.BOARD[0] === 30 && LAB.RIM.BOARD[1] === 60);
});

test('LabView 연결(원문 메서드 + 가짜 바탕): 서브에이전트 생성 → 배치 뒤 의뢰서 + 팀장 가리킴 · 끝 → 보고 한 번(result 와 중복 없음) · 기자재 done → 산출 · fail → 주인 멈칫', async () => {
  const { RIG_KIND_HEX } = await import('../lab/lab-rig-core.mjs');
  const SRC = src('lab/lab-view.js');
  const method = (name) => {
    const m = new RegExp('\\n  ' + name + '\\(').exec(SRC);
    assert.ok(m, name);
    const s = m.index + 1;
    let i = SRC.indexOf('{', SRC.indexOf(')', s)), d = 0;
    for (; i < SRC.length; i++) { const c = SRC[i]; if (c === '{') d++; else if (c === '}' && --d === 0) break; }
    return SRC.slice(s, i + 1);
  };
  const NAMES = ['addNode', 'updateNode', 'flowEvent', '_report', '_tryDispatch', '_rigTrans', '_courSess', '_addCourier', '_courArrive'];
  class Base { addNode() {} updateNode() {} flowEvent() {} }
  // eslint-disable-next-line no-new-func
  const Cls = new Function('Base', 'SUBK', 'walking', 'courierFor', 'labGestureSet', 'GESTURE_STAY', 'hexColor', 'RIG_KIND_HEX', 'cablePulsePush', 'newPulseMem',
    `return class L extends Base {\n${NAMES.map(method).join('\n')}\n};`)(Base, new Set(['subagent', 'workflow-agent']), (ch) => ch.state === 'walk' || ch.state === 'leave' || ch.state === 'enter',
    courierFor, labGestureSet, GESTURE_STAY, (h) => ({ hex: h }), RIG_KIND_HEX, cablePulsePush, newPulseMem);
  const { nodes, lay } = scene();
  const v = new Cls();
  Object.assign(v, {
    _cour: new LabCouriers(24), _pendDisp: [], _repAt: new Map(), nodes: new Map(nodes.map((n) => [n.id, n])), layout: lay, ts: 1, _now: 5,
    tokens: { ok: { k: 'ok' }, error: { k: 'err' }, text: { k: 't' }, isLight: false }, sess: { sessColor: () => ({ k: 'sess' }) },
    chars: new Map([['m', { placed: true, state: 'work', target: { type: 'desk' } }], ['s1', { placed: true, state: 'work', target: { type: 'desk' } }], ['s1p', { placed: true, state: 'work' }]]),
    _tweenPos: (m) => m.pos,
  });
  v._courCtx = { layout: lay, nodeOf: (id) => v.nodes.get(id) || null };
  v.addNode(v.nodes.get('s1'), true);
  assert.equal(v._pendDisp.length, 1, '배치 전 대기');
  assert.equal(v._tryDispatch(v._pendDisp[0]), true);
  assert.equal(v._cour.n, 1);
  const it = v._cour.list[0];
  assert.equal(it.kind, 'dispatch'); assert.equal(it.arr, 's1'); assert.equal(it.act, 'flash'); assert.equal(it.c.k, 'sess');
  assert.equal(v.chars.get('m').gesture.kind, 'dispatch', '팀장 가리킴');
  v._courArrive(it, 6); assert.ok(v.chars.get('s1').flashUntil > 6, '새 책상 섬광');
  v.addNode(v.nodes.get('s2'), false); assert.equal(v._pendDisp.length, 1, '조용한 추가(스냅샷)는 의뢰 없음');
  // 끝: updateNode + result → 보고 한 번
  v.nodes.get('s1').status = 'done';
  v.updateNode('s1', { status: 'done' });
  v.flowEvent({ type: 'result', nodeId: 's1', ok: true });
  assert.equal(v._cour.n, 2, '보고 한 번');
  const rp = v._cour.list[1];
  assert.equal(rp.kind, 'report'); assert.equal(rp.c2.k, 'ok'); assert.equal(rp.arr, 'm'); assert.equal(rp.act, 'receive');
  v._courArrive(rp, 7); assert.equal(v.chars.get('m').gesture.kind, 'receive', '팀장 보고 받기');
  v.chars.get('m').state = 'walk'; v.chars.get('m').gesture = null; v._courArrive(rp, 7.1); assert.equal(v.chars.get('m').gesture, null, '걷는 중이면 생략');
  v.updateNode('s1', { status: 'active' }); assert.equal(v._repAt.has('s1'), false, '재개하면 다음 끝에 다시');
  v.updateNode('s1', { status: 'error' }, { quiet: true }); assert.equal(v._cour.n, 2, 'quiet 은 연출 없음');
  // 기자재 전이
  const mk = (k) => ({ id: 'b:' + k, node: nodes.find((n) => n.id === 'b:' + k), pos: lay.machine.get('b:' + k) });
  const reactor = mk('reactor');
  v._rigTrans(reactor, 'run', 'done', 8);
  assert.equal(v._cour.n, 3); assert.equal(v._cour.list[2].kind, 'pod'); assert.equal(v._cour.list[2].c.hex, RIG_KIND_HEX.dark.reactor);
  assert.equal(reactor._cp.k.includes(1), true, '케이블 끝 펄스(초록)');
  v.chars.get('m').state = 'work';
  const tests = mk('tests'), owner = v.chars.get(tests.node.parentId);
  assert.ok(owner, '시험 기자재 주인 = 팀장');
  v._rigTrans(tests, 'run', 'fail', 9);
  assert.equal(v._cour.n, 3, '실패 = 캡슐 없음');
  assert.ok(tests._cp.k.includes(2), '빨강 펄스');
  assert.ok(owner.flinchUntil > 9, '주인 멈칫');
});

test('11) 현장 몸짓 도착 보정: 걷는 동안 기다렸다가 도착 프레임에 t0 = now, 머무는 시간 보장(visit.until 도), 방문이 끝나면 버림', async () => {
  const { labGestureSet: set, labGestureArrive: arrive, GESTURE_STAY: STAY } = await import('../lab/lab-gesture-core.mjs');
  const ch = { target: { type: 'desk' }, visit: { until: 11 } };
  set(ch, 'field', 10, 11);
  assert.equal(ch.gesture.wait, true);
  assert.equal(arrive(ch, 10.5, 1, true), null, '걷는 중');
  ch.target.type = 'visit';
  assert.equal(arrive(ch, 10.9, 1, false), 'arrive');
  assert.equal(ch.gesture.t0, 10.9); assert.ok(Math.abs(ch.gesture.until - (10.9 + STAY.field)) < 1e-9); assert.equal(ch.visit.until, ch.gesture.until);
  assert.equal(arrive(ch, 11, 1, false), null, '한 번만');
  const c2 = { target: { type: 'desk' }, visit: { until: 5 } };
  set(c2, 'install', 4, 5);
  assert.equal(arrive(c2, 6, 1, true), 'drop'); assert.ok(!(c2.gesture.until > 6));
  const c5 = { target: { type: 'visit' }, visit: { until: 5 } };
  set(c5, 'field', 4, 5);
  assert.equal(arrive(c5, 4.9, 1, true), null); assert.ok(c5.visit.until > 5, '가는 중이면 방문을 조금 늘림');
  c5.visit.until = 11.05; assert.equal(arrive(c5, 11, 1, true), null); assert.equal(c5.visit.until, 11.05, '처음 예약 + 6초 넘으면 늘리지 않음');
  const c3 = { target: { type: 'visit' }, visit: { until: 30 } };
  set(c3, 'watch', 1, 30); arrive(c3, 2, 1, false);
  assert.equal(c3.gesture.until, 30, 'watch 는 예약 끝 그대로');
  const c4 = { target: { type: 'desk' } }; set(c4, 'dispatch', 1, 2);
  assert.equal(c4.gesture.wait, false, '자리 몸짓은 기다리지 않음');
});
