// 복셀 표현 분리 프로세스 = 생산 라인 — 순수 규칙(vx-proc-core). 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAY, BELT_LEN, assignBays, bayLocal, bayLine, laneDZ, machineDepth, beltSpeed, palletDigits, palletBoxes, forkPose, FORK_DUR,
  BayFeed, bayModel, boardModel, fmtInt, etaShort, WatchPlanner, WATCHW, watchPhase, boardYaw, isProcAutoJob, boardPos,
} from '../voxel/vx-proc-core.mjs';

const T0 = Date.parse('2026-10-26T09:00:00Z');
const iso = (s) => new Date(T0 + s * 1000).toISOString();
const lane = (key, n, extra = {}) => ({ key, n, total: null, unit: '바퀴', rate: 8, last: { k: '최장', v: 4.32, u: 's' }, pass: 1, at: iso(0), heat: 0.5, ...extra });
const job = (lanes, extra = {}) => ({ v: 1, state: 'running', src: 'auto', lanes, primary: lanes[0] && lanes[0].key, heat: 0.5, staleSec: 480, ...extra });

test('라인 자리: 두 줄은 마주 보는 방향 · 레인 간격 가운데 맞춤 · 기계 깊이 상한', () => {
  assert.deepEqual(bayLocal(0), { x: BAY.MX[0], z: BAY.ZC[0], dir: 1 });
  assert.equal(bayLocal(1).dir, -1);
  assert.equal(bayLocal(9).x, BAY.MX[BAY.MAX - 1]); // 넘친 번호는 끝 줄로 묶음
  const l0 = bayLine(5, 0), l1 = bayLine(5, 1);
  assert.ok(l0.x1 > l0.x0 && l1.x1 < l1.x0);
  assert.ok(Math.abs(Math.abs(l0.x1 - l0.x0) - BELT_LEN) < 1e-9);
  assert.equal(laneDZ(0, 1), 0);
  assert.equal(laneDZ(0, 2), -laneDZ(1, 2));
  assert.equal(machineDepth(1), 0.9);
  assert.equal(machineDepth(9), machineDepth(BAY.LANES));
});

test('라인 배정: 살아 있는 것이 먼저 · 이전 줄 지킴 · 넘치면 서버랙 · 랙이 많으면 라인 끔', () => {
  const P = (id, status = 'active') => ({ id, status });
  let r = assignBays([P('a', 'done'), P('b'), P('c')], () => null);
  assert.equal(r.kind.get('b'), 'proc'); assert.equal(r.kind.get('c'), 'proc'); assert.equal(r.kind.get('a'), 'rack');
  r = assignBays([P('a'), P('b')], (id) => (id === 'b' ? { type: 'proc', slot: 0 } : null));
  assert.equal(r.slot.get('b'), 0); assert.equal(r.slot.get('a'), 1);
  r = assignBays([P('a')], () => null, BAY.RACK_MAX + 1);
  assert.equal(r.kind.get('a'), 'rack');
  assert.equal(assignBays([], () => null).kind.size, 0);
});

test('팔레트 압축: 두 자리(묶음 × 10U + 낱개 × U) · 상자 자리 수', () => {
  assert.deepEqual(palletDigits(0), { big: 0, small: 0, unit: 1 });
  assert.deepEqual(palletDigits(68000), { big: 6, small: 8, unit: 1000 });
  assert.deepEqual(palletDigits(2000), { big: 2, small: 0, unit: 100 });
  assert.deepEqual(palletDigits(7), { big: 0, small: 7, unit: 1 });
  const d = palletDigits(68000);
  const boxes = palletBoxes(d);
  assert.equal(boxes.length, d.big + d.small);
  assert.equal(boxes.filter((b) => b.big).length, 6);
  const topBig = Math.max(...boxes.filter((b) => b.big).map((b) => b.dy));
  assert.ok(boxes.filter((b) => !b.big).every((b) => b.dy > topBig)); // 낱개는 묶음 위에
});

test('컨베이어 속도·지게차 모양: 처리율 로그 눈금 · 들어옴 → 들어 올림 → 사라짐', () => {
  assert.equal(beltSpeed(null), 0.22);
  assert.ok(beltSpeed(8) < beltSpeed(10000));
  assert.ok(beltSpeed(1e12) <= 1.1);
  assert.equal(forkPose(0).alpha, 0);
  assert.equal(forkPose(0).carry, false);
  assert.ok(forkPose(FORK_DUR * 0.4).lift > 0);
  assert.equal(forkPose(FORK_DUR).alpha, 0);
  assert.equal(forkPose(FORK_DUR).carry, true);
});

test('라인 장부: 첫 관측은 팔레트에 · 값이 오르면 상자 → 다 오면 팔레트 · 새 회차와 끝은 지게차', () => {
  const f = new BayFeed();
  f.sync(job([lane('iter', 2000)]), true, 0);
  assert.equal(f.lanes.get('iter').pallet, 2000);
  assert.equal(f.cratesOf('iter', 0).length, 0);
  f.sync(job([lane('iter', 4000)]), true, 1);
  const r = f.lanes.get('iter');
  assert.ok(r.crates.length >= 1);
  const T = r.crates[r.crates.length - 1].t0 + r.crates[r.crates.length - 1].T;
  assert.ok(f.cratesOf('iter', 1 + 0.01).length >= 1);
  f.step(T + 0.01, 0.016, { run: true });
  assert.equal(r.crates.length, 0); assert.equal(r.pallet, 4000);
  // 새 회차 → 쌓인 팔레트 반출
  f.sync(job([lane('iter', 500, { pass: 2 })]), true, T + 1);
  assert.equal(f.forks.length, 1); assert.equal(f.forks[0].value, 4000);
  assert.equal(r.pass, 2);
  // 움직임 줄이기: 상자 없이 팔레트로 바로
  const g = new BayFeed();
  g.sync(job([lane('a', 10)]), true, 0, { reduced: true });
  g.sync(job([lane('a', 20)]), true, 1, { reduced: true });
  assert.equal(g.lanes.get('a').crates.length, 0); assert.equal(g.lanes.get('a').pallet, 20);
  // 끝(done): 상자가 다 오고 1.2초 뒤 지게차가 모두 실어 감(한 번)
  g.sync(job([lane('a', 20)], { state: 'done' }), false, 2);
  g.step(2.5, 0.016, { run: false });
  assert.equal(g.forks.length, 0);
  g.step(3.3, 0.016, { run: false });
  assert.equal(g.forks.length, 1); assert.equal(g.lanes.get('a').pallet, 0);
  g.step(3.4, 0.016, { run: false });
  assert.equal(g.forks.length, 1);
});

test('정체면 벨트가 2.4초마다 멈칫 · 돌면 처리율 속도', () => {
  const f = new BayFeed();
  f.sync(job([lane('a', 10)]), true, 0);
  f.step(0.1, 0.016, { stale: true, run: false });
  assert.ok(f.lanes.get('a').speed > 0);
  f.step(1.0, 0.016, { stale: true, run: false });
  assert.equal(f.lanes.get('a').speed, 0);
  f.step(1.1, 0.016, { run: true, rates: new Map([['a', 10000]]) });
  assert.equal(f.lanes.get('a').speed, beltSpeed(10000));
});

test('기계 모델·전광판: 경광등(실패 빨강·정체 호박·끝 초록·과열) · 천 단위 · ETA · 다시 그리기 열쇠', () => {
  assert.equal(bayModel('failed', null, T0).beacon, 'red');
  assert.equal(bayModel('stale', null, T0).beacon, 'amber');
  assert.equal(bayModel('done', null, T0).beacon, 'green');
  assert.equal(bayModel('stopped', null, T0).beacon, 'grey');
  assert.equal(bayModel('running', job([lane('a', 1)], { heat: 1 }), T0).beacon, 'red');
  assert.equal(bayModel('running', job([lane('a', 1)], { heat: 0.1 }), T0).beacon, 'off');
  assert.equal(bayModel('done', job([lane('a', 1)]), T0).steam, 0);
  assert.equal(fmtInt(48016.7), '48,016');
  assert.equal(etaShort(90 * 60 * 1000), '1h 30m');
  assert.equal(etaShort(0), '');
  const j = job([lane('iter', 46000), lane('walk', 42000), lane('c', 1), lane('d', 2)]);
  const b = boardModel('probe.py', j, 'running', T0);
  assert.equal(b.rows.length, BAY.LANES); assert.equal(b.extra, 1);
  assert.equal(b.rows[0].text, '46,000');
  assert.equal(b.corner, '최장 4.32s');
  assert.equal(boardModel('probe.py', j, 'running', T0).sig, b.sig);
  assert.notEqual(boardModel('probe.py', j, 'running', T0 + 2000).sig, b.sig); // 보간 값이 오르면 다시
});

test('자동 진행 작업 = 전광판 자리', () => {
  const n = { id: 'j:b:p:progress', meta: { job: { src: 'auto' } } };
  assert.equal(isProcAutoJob(n, 'b:p'), true);
  assert.equal(isProcAutoJob({ ...n, meta: { job: { src: 'rule' } } }, 'b:p'), false);
  assert.equal(isProcAutoJob(n, 'b:q'), false);
  assert.deepEqual(boardPos({ x: 1, z: 2, slot: 1 }), { x: 1, y: BAY.BOARD_Y[1], z: 2 });
});

test('들여다보기 계획: 같은 방이면 걸어감 · GAP 안의 다음 peek 는 자리에서 · wait 는 늘 걸음 · 다른 방은 자리에서', () => {
  const P = new WatchPlanner();
  const open = (kind = 'peek') => [{ from: 'a', to: 'p', kind, open: true, ageMs: 0 }];
  const closed = (progress = true) => [{ from: 'a', to: 'p', kind: 'peek', open: false, ageMs: 100, progress }];
  const walk = { canWalk: () => true };
  let pl = P.step(open(), 0, 0, walk).get('a');
  assert.equal(pl.mode, 'walk');
  P.arrive('a', 3);
  assert.equal(watchPhase(pl, 3, true), 'look');
  pl = P.step(closed(), 4, 4000, walk).get('a');
  assert.equal(pl.open, false); assert.equal(pl.progress, true);
  assert.ok(pl.until >= 4 + WATCHW.LINGER - 1e-9);
  assert.equal(watchPhase(pl, pl.until - 0.1, true), 'check');
  P.step(closed(), pl.until + 0.01, 9000, walk);
  assert.equal(P.plans.size, 0);
  // 끝난 지 GAP 안 → 자리에서
  const t1 = pl.until + 2;
  assert.equal(P.step(open(), t1, 20000, walk).get('a').mode, 'desk');
  P.step([], t1 + 0.5, 20500, walk); P.step([], t1 + 5, 25000, walk);
  // wait 는 GAP 안이어도 걸어감
  assert.equal(P.step(open('wait'), t1 + 6, 26000, walk).get('a').mode, 'walk');
  assert.equal(watchPhase(P.plans.get('a'), t1 + 9, true), 'wait');
  assert.equal(watchPhase(P.plans.get('a'), t1 + 9, false), 'walk');
  // 다른 방(false) → 자리에서, 직원 아님(null) → 계획 없음
  const Q = new WatchPlanner();
  assert.equal(Q.step(open(), 0, 0, { canWalk: () => false }).get('a').mode, 'desk');
  const R = new WatchPlanner();
  assert.equal(R.step(open(), 0, 0, { canWalk: () => null }).size, 0);
  // 8배속 이상이면 걷지 않음
  const S = new WatchPlanner();
  assert.equal(S.step(open(), 0, 0, { canWalk: () => true, ts: 8 }).get('a').mode, 'desk');
});

test('전광판 방향: 카메라 쪽으로 ±60° 안, 뒤에서 보면 뒤집은 면', () => {
  assert.deepEqual(boardYaw(0, NaN), { yaw: 0, back: false });
  assert.ok(Math.abs(boardYaw(0, 0.3).yaw - 0.3) < 1e-9);
  assert.ok(Math.abs(boardYaw(0, 1.4).yaw - Math.PI / 3) < 1e-9);
  const b = boardYaw(0, Math.PI);
  assert.equal(b.back, true);
  assert.ok(Math.abs(b.yaw - Math.PI) < 1e-9);
});
