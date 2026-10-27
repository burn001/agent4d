// Planet 분리 프로세스 연출 — 순수 규칙(planet-proc-core.mjs): 드릴 회전·멈칫·열 빛·광석 발사·컨베이어·화물·계기 모델·감독 줄·들여다보기 장부.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _setLangForTest } from '../i18n.mjs';
import {
  PROC, procLook, drillSpin, drillHitch, heatTip, heatSparkRate, oreInterval, oreFlight, OreFeed, conveyorBend, quadAt, oreEase,
  cargoCount, cargoSlot, procLod, bigNum, clockText, meterModel, meterBig, procName, superviseLine, ProcWatch, watchLook, laneColor, isProcMeter,
  isExtRig, planetJobBody, extRigState, extLanes, extRigJob, extMeterModel, extMeterBig,
} from '../planet-proc-core.mjs';
import { rollK } from '../proc-meter.js';

_setLangForTest('ko');
const T0 = Date.parse('2026-10-26T09:00:00Z');
const iso = (s) => new Date(T0 + s * 1000).toISOString();
const PROCN = (extra = {}) => ({ id: 'b:toolu_p', parentId: 'a:sub', kind: 'bash-bg', status: 'active', label: '분리 실행 · probe_branches.py',
  meta: { proc: { v: 1, prog: 'python', script: 'probe_branches.py', via: 'nohup', spawnedBy: 'a:sub', watch: [], watchCount: 0, endReason: null, rc: null } }, ...extra });
const LANES = () => [
  { key: 'iter_pairs', n: 46000, total: null, unit: '바퀴', rate: 8.6, last: { k: '최장', v: 4.32, u: 's' }, pass: 2, at: iso(0), heat: 1 },
  { key: '_walk_pairs', n: 42000, total: null, unit: '바퀴', rate: 7.7, last: { k: '최장', v: 4.32, u: 's' }, pass: 1, at: iso(0), heat: 0.29 },
];
const JOB = (extra = {}) => ({ v: 1, id: 'progress', state: 'running', src: 'auto', staleSec: 480, lanes: LANES(), primary: 'iter_pairs', rate: 8.6, eta: null, heat: 1, ...extra });

test('드릴: 과열이면 느리고 정체·끝은 거의/완전히 멈춤, 멈칫은 과열일 때만·결정적', () => {
  const cool = drillSpin('running', 0, 9000), hot = drillSpin('running', 1, 8);
  assert.ok(cool > hot * 4, `cool ${cool} hot ${hot}`);
  assert.ok(hot > drillSpin('stale', 1, 8));
  assert.equal(drillSpin('done', 0, 10), 0);
  assert.equal(drillSpin('failed', 0, 10), 0);
  assert.equal(drillSpin('running', 0, null), 3, '처리율 모름 = 중간');
  assert.ok(Math.abs(drillSpin('running', 0, 9000, true) - cool * 0.2) < 1e-9, '움직임 줄이기 0.2 배');
  for (let t = 0; t < 30; t += 0.37) assert.equal(drillHitch(t, 0.1, 4), 1);
  let min = 1;
  for (let t = 0; t < 30; t += 0.02) { const k = drillHitch(t, 1, 4.32, 0.3); assert.ok(k > 0 && k <= 1); min = Math.min(min, k); assert.equal(k, drillHitch(t, 1, 4.32, 0.3)); }
  assert.ok(min < 0.3, '과열이면 가끔 걸림');
  assert.equal(procLook('stopped').tint, 'stopped');
  assert.equal(procLook('nope').lamp, 'ok');
});

test('열 빛·입자: 호박 → 주홍, 세기 증가, 라이트는 진한 잉크', () => {
  const a = heatTip(0), b = heatTip(1);
  assert.ok(b.k > a.k && b.k <= 1 && a.k >= 0.1);
  assert.ok(b.g < a.g, '뜨거울수록 초록 성분이 줄어 주홍');
  assert.equal(a.level, 'cool'); assert.equal(heatTip(0.5).level, 'warm'); assert.equal(b.level, 'hot');
  const l = heatTip(1, true);
  assert.ok(l.r + l.g + l.b < b.r + b.g + b.b, '라이트 = 진한 색');
  assert.equal(heatSparkRate(0.1, 4), 0);
  assert.ok(heatSparkRate(1, 4) > heatSparkRate(0.5, 4));
  assert.equal(heatSparkRate(1, 4, true), 0);
});

test('광석: 간격·비행 시간, 발사 장부(처음 본 레인은 쏘지 않음·관측 = 큰 덩이·회차·처리율 부스러기·멈추면 부스러기 없음)', () => {
  assert.ok(oreInterval(10000) < oreInterval(8) && oreInterval(8) < oreInterval(null));
  assert.ok(oreInterval(1e9) >= 0.4 && oreInterval(0) <= 2.6);
  assert.ok(oreFlight(20, 8) > oreFlight(2, 8));
  assert.ok(oreFlight(1000, 1) <= 7 && oreFlight(0, 1e6) >= 1.2);
  const f = new OreFeed();
  const job = JOB();
  assert.deepEqual(f.step(job, 0.016), [], '처음 = 기준만');
  job.lanes[0].n += 2000;
  const out = f.step(job, 0.016);
  assert.deepEqual(out, [{ lane: 0, big: true }]);
  // 처리율 부스러기: 오래 지나면 작은 덩이(레인마다)
  let small = 0;
  for (let i = 0; i < 300; i++) for (const o of f.step(job, 0.05)) if (!o.big) small++;
  const expect = (300 * 0.05) / oreInterval(8.6) + (300 * 0.05) / oreInterval(7.7);
  assert.ok(Math.abs(small - expect) <= 3, `small ${small} ~ ${expect}`);
  let none = 0;
  for (let i = 0; i < 100; i++) none += f.step(job, 0.05, false).length;
  assert.equal(none, 0, '멈춘 프로세스 = 부스러기 없음');
  job.lanes[1].pass = 2; job.lanes[1].n = 2000;
  const np = f.step(job, 0.016, false);
  assert.ok(np.some((o) => o.lane === 1 && o.big && o.newPass), '새 회차 = 큰 덩이');
  // 레인 상한
  const many = JOB({ lanes: Array.from({ length: 6 }, (_, i) => ({ key: 'k' + i, n: 1, rate: 1, pass: 1, at: iso(0) })) });
  const g = new OreFeed(); g.step(many, 0); many.lanes.forEach((l) => { l.n = 5; });
  assert.equal(g.step(many, 0).length, PROC.LANES);
});

test('컨베이어·화물: 레인마다 다른 궤도, 곡선 끝점, 진행 단조, 화물 수 단조·상한, 자리는 호 안', () => {
  const b0 = conveyorBend(0, 2), b1 = conveyorBend(1, 2);
  assert.ok(b1.lift > b0.lift); assert.ok(b0.side < 0 && b1.side > 0); assert.equal(conveyorBend(0, 1).side, 0);
  const a = { x: 0, y: 0, z: 0 }, c = { x: 5, y: 4, z: 0 }, b = { x: 10, y: 0, z: 2 }, o = {};
  quadAt(a, c, b, 0, o); assert.deepEqual([o.x, o.y, o.z], [0, 0, 0]);
  quadAt(a, c, b, 1, o); assert.deepEqual([o.x, o.y, o.z], [10, 0, 2]);
  let prev = -1;
  for (let k = 0; k <= 1.0001; k += 0.01) { const e = oreEase(k); assert.ok(e >= prev - 1e-9 && e >= 0 && e <= 1); prev = e; }
  assert.equal(oreEase(0), 0); assert.ok(Math.abs(oreEase(1) - 1) < 1e-9);
  assert.equal(cargoCount(0), 0);
  assert.ok(cargoCount(2000) < cargoCount(68000));
  assert.equal(cargoCount(1e12), PROC.CARGO_MAX);
  for (let k = 0; k < PROC.CARGO_MAX; k++) { const s = cargoSlot(k); assert.ok(Math.abs(s.a) <= PROC.CARGO_SPAN + 0.05, `slot ${k}`); }
  assert.equal(cargoSlot(12).row, 1);
  assert.equal(procLod(1), 0); assert.equal(procLod(5), 1); assert.equal(procLod(30), 2);
  assert.notEqual(laneColor(0), laneColor(1)); assert.notEqual(laneColor(0), laneColor(0, true));
});

test('계기 모델: 보간 값·천 단위·끝자리 굴림·sig·ETA·끝·큰 숫자·감독 줄', () => {
  const job = JOB();
  const m = meterModel(job, T0 + 10_000);
  assert.equal(m.rows.length, 2);
  assert.equal(m.rows[0].text, '46,086', 'laneValue 보간(8.6/s × 10s)');
  assert.ok(m.rows[0].frac >= 0 && m.rows[0].frac < 1);
  assert.equal(m.rows[0].unit, '바퀴');
  assert.match(m.rows[0].rate, /8\.6/);
  assert.equal(m.rows[0].last, '최장 4.32s');
  assert.equal(m.level, 'hot');
  assert.equal(m.primary.key, 'iter_pairs');
  assert.notEqual(meterModel(job, T0 + 20_000).sig, m.sig, '숫자가 오르면 다시 그림');
  assert.equal(meterModel(job, T0 + 10_000).sig, m.sig);
  const tot = meterModel(JOB({ lanes: [{ key: 'smoke', n: 30, total: 50, unit: 'cases', rate: 1, pass: 1, at: iso(0), heat: 0 }], primary: 'smoke', eta: iso(20) }), T0);
  assert.equal(tot.rows[0].text, '30 / 50');
  assert.ok(Math.abs(tot.ratio - 0.6) < 1e-9);
  assert.equal(tot.eta, '20s');
  const done = meterModel(JOB({ state: 'done' }), T0 + 60_000);
  assert.ok(done.ended); assert.equal(done.rows[0].text, '46,000', '끝나면 보간 없음'); assert.equal(done.eta, '');
  assert.equal(meterBig(job, T0), '46,000');
  assert.equal(bigNum(1234567.9), '1,234,567');
  assert.equal(clockText(65_000), '1:05'); assert.equal(clockText(3_723_000), '1:02:03'); assert.equal(clockText(NaN), '');
  assert.equal(rollK(0.5), 0); assert.equal(rollK(1), 1); assert.ok(rollK(0.85) > 0 && rollK(0.85) < 1);
  assert.equal(procName(PROCN()), 'probe_branches.py');
  assert.equal(superviseLine(PROCN(), job, T0), '감독 · probe_branches.py · 46,000 바퀴');
  assert.equal(superviseLine(PROCN(), null, T0), '감독 · probe_branches.py');
  assert.ok(isProcMeter({ meta: { job: { src: 'auto' } } }, PROCN()));
  assert.ok(!isProcMeter({ meta: { job: { src: 'protocol' } } }, PROCN()));
});

test('들여다보기 장부: 이벤트 열림·닫힘 펄스, meta.proc.watch 로 맞추기(스냅샷·밀린 end), 그리기 세기', () => {
  const w = new ProcWatch();
  w.event({ type: 'watch', ts: iso(0), nodeId: 'a:sub', peer: 'b:toolu_p', kind: 'wait', via: 'shell', phase: 'start', toolUseId: 't1' });
  w.event({ type: 'output', nodeId: 'x' });
  let ps = w.pulses(T0 + 5000);
  assert.equal(ps.length, 1); assert.ok(ps[0].open);
  const lw = watchLook(ps[0]);
  assert.equal(lw.ring, 1); assert.ok(lw.beam > 0 && lw.beam < 0.5); assert.equal(lw.packet, -1);
  // 노드 스냅샷: 열린 것이 없음 → t1 닫힘(밀린 end), 새 t2 열림
  const n = PROCN(); n.meta.proc.watch = [{ nodeId: 'a:sub', kind: 'peek', via: 'shell', since: iso(6), toolUseId: 't2' }];
  w.node(n);
  ps = w.pulses(T0 + 7000);
  assert.equal(ps.length, 1); assert.equal(ps[0].kind, 'peek');
  assert.equal(watchLook(ps[0]).beam, 0.9);
  w.node(n); assert.equal(w.pulses(T0 + 7000).length, 1, '같은 목록이면 그대로');
  w.event({ type: 'watch', ts: iso(8), nodeId: 'a:sub', peer: 'b:toolu_p', kind: 'peek', via: 'shell', phase: 'end', toolUseId: 't2', progress: true });
  ps = w.pulses(T0 + 8500);
  assert.equal(ps.length, 1); assert.ok(!ps[0].open); assert.ok(ps[0].progress);
  const lp = watchLook(ps[0]);
  assert.ok(lp.packet >= 0 && lp.packet < 1); assert.ok(lp.beam > 0);
  assert.equal(w.pulses(T0 + 20_000).length, 0, '펄스는 사라짐');
  w.forget('b:toolu_p'); w.clear();
  assert.equal(w.pulses(T0).length, 0);
});

// ───────────── 안 C — 외부 작업 = 채굴 플랫폼 승격 ─────────────
const EXT = (job = {}) => ({ id: 'j:s:sid:x:arm', parentId: 's:sid', kind: 'bash-bg', status: 'active', label: '153 단계2 고친 팔',
  meta: { job: { v: 1, id: 'x:arm', state: 'running', src: 'ext', progress: { n: 119254, total: 125712 }, rate: 7.8, eta: iso(780), beatAt: iso(-2),
    startedAt: iso(-15420), endedAt: null, staleSec: 900, stale: false, ext: { pid: 55024, alive: true, expectSec: null }, ...job } } });

test('§110 플랫폼 승격 대상 판정: 외부 작업 = 플랫폼 · 자동 진행 = 계기 · 규약·규칙 작업 = 탐사선 · 작업 아님(분리 프로세스 포함) = null', () => {
  assert.equal(planetJobBody(EXT()), 'rig');
  assert.equal(isExtRig(EXT()), true);
  const J = (src) => ({ id: 'j:x', meta: { job: { v: 1, id: 'x', state: 'running', src } } });
  assert.equal(planetJobBody(J('auto')), 'meter');
  for (const src of ['protocol', 'rule', undefined, null]) assert.equal(planetJobBody(J(src)), 'probe', String(src));
  assert.equal(planetJobBody(PROCN()), null);
  assert.equal(isExtRig(PROCN()), false);
  assert.equal(planetJobBody({ id: 'a', meta: {} }), null);
  assert.equal(planetJobBody(null), null);
});

test('§110 외부 작업 플랫폼 상태·레인: 진행·대기 = running · 정체 · 끝 · 실패 / 진행 줄이면 레인 하나(처리율·관측 시각), 예상·없음이면 광석 없음', () => {
  const j = EXT().meta.job;
  assert.equal(extRigState(j, T0), 'running');
  assert.equal(extRigState({ ...j, beatAt: iso(-3600) }, T0), 'stale'); // 박동 끊김(staleSec 900) → 드릴 0.35·호박 등
  assert.equal(extRigState({ ...j, state: 'done' }, T0), 'done');
  assert.equal(extRigState({ ...j, state: 'failed' }, T0), 'failed');
  const L = extLanes(j);
  assert.equal(L.length, 1);
  assert.deepEqual([L[0].n, L[0].total, L[0].rate, L[0].at], [119254, 125712, 7.8, j.beatAt]);
  assert.equal(extLanes(j), L, '같은 작업이면 같은 배열(프레임마다 새로 안 만듦)');
  assert.deepEqual(extLanes({ ...j, progress: { ratio: 0.96 } }), []);
  assert.deepEqual(extLanes({ ...j, progress: null }), []);
  const rj = extRigJob(j);
  assert.equal(rj.lanes, L); assert.equal(rj.primary, 'n'); assert.equal(rj.heat, 0);
  assert.equal(extRigJob(j), rj);
});

test('§110 외부 작업 계기: 진행 줄 = n / N · 처리율 · 경과 · 막대 / 예상 = 점선 막대 `96% (예상)` · 예상 4:32 중 4:20 / 없음 = 경과', () => {
  const j = EXT().meta.job;
  const m = extMeterModel(j, T0);
  const r = m.rows[0];
  assert.equal(m.rows.length, 1);
  assert.match(r.text, /^119,2\d\d \/ 125,712$/);
  assert.equal(r.rate, '7.8/초');
  assert.match(r.last, /^경과 4:17:00$/);
  assert.ok(r.bar > 0.94 && r.bar < 0.96 && r.est === false && r.noHeat === true);
  assert.equal(m.eta, '13:00');
  assert.equal(m.est, false);
  const e = extMeterModel({ ...j, progress: { ratio: 0.956 }, rate: null, eta: null, ext: { expectSec: 16320 }, startedAt: iso(-15600) }, T0);
  assert.equal(e.est, true); assert.equal(e.rows[0].est, true);
  assert.equal(e.rows[0].text, '95% (예상)');
  assert.equal(e.rows[0].last, '예상 4:32 중 4:20');
  const n = extMeterModel({ ...j, progress: null, rate: null, eta: null }, T0);
  assert.equal(n.rows[0].bar, null); assert.equal(n.rows[0].text, '4:17:00');
  assert.equal(extMeterBig(j, T0).replace(/\d{3}$/, 'xxx'), '119,xxx');
  assert.equal(extMeterBig({ ...j, progress: { ratio: 0.956 }, ext: { expectSec: 16320 } }, T0), '95%');
  // 끝나면 진행 막대 그대로 · ETA 없음
  assert.equal(extMeterModel({ ...j, state: 'done', endedAt: iso(0) }, T0).eta, '');
});
