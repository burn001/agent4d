// 분리 프로세스 · 진행 레인 · 과열 · 들여다보기 — 웹 공통 순수 규칙(job-core)과 mock 시나리오. 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _setLangForTest } from '../i18n.mjs';
import {
  LANEW, isProc, procOf, procJobId, isAutoJob, jobLanes, procState, procStaleSec, procTags, laneValue, laneRatio, jobLaneValues,
  jobHeat, heatLevel, jobEtaMs, fmtRate, laneText, WatchTracker, watchPulses, jobInspect,
} from '../job-core.mjs';
import { nodeTags } from '../batch-core.mjs';
import { jobSrcText } from '../inspector-core.mjs';
import { MockGenerator } from '../mock.js';
import { mockHeat } from '../job-mock.mjs';

_setLangForTest('ko');
const T0 = Date.parse('2026-10-26T09:00:00Z');
const iso = (s) => new Date(T0 + s * 1000).toISOString();
const PROC = (extra = {}) => ({ id: 'b:toolu_p', parentId: 'a:sub', kind: 'bash-bg', status: 'active', label: '분리 실행 · probe_branches.py', startedAt: iso(0),
  meta: { proc: { v: 1, cmd: 'nohup python …', prog: 'python', script: 'probe_branches.py', via: 'nohup', log: 'D:/x/run1/run.log', pidHint: null, spawnedBy: 'a:sub',
    watch: [], watchCount: 3, lastWatchAt: iso(0), endReason: null, rc: null }, procStaleSec: 480 }, ...extra });
const LANES = [
  { key: 'iter_pairs', n: 46000, total: null, unit: '바퀴', rate: 8.6, last: { k: '최장', v: 4.32, u: 's' }, pass: 2, at: iso(0), elapsed: 5546, heat: 1 },
  { key: '_walk_pairs', n: 42000, total: null, unit: '바퀴', rate: 7.7, last: { k: '최장', v: 4.32, u: 's' }, pass: 1, at: iso(-30), elapsed: 5587, heat: 0.29 },
];
const JOB = (extra = {}) => ({ v: 1, id: 'progress', title: '진행', state: 'running', phase: 'iter_pairs', progress: null, host: null, until: null, rc: null, beatAt: iso(0),
  staleSec: 480, stale: false, line: '[iter_pairs] 46,000 바퀴 · 5546s · 최장 4.32s', src: 'auto', startedAt: iso(-6000), endedAt: null,
  lanes: LANES, primary: 'iter_pairs', rate: 8.6, eta: null, heat: 1, ...extra });

test('프로세스 판정·상태·꼬리표(정체·rc·들여다봄) · nodeTags 반영', () => {
  const p = PROC();
  assert.ok(isProc(p));
  assert.equal(procOf(p).script, 'probe_branches.py');
  assert.equal(procJobId(p), 'j:b:toolu_p:progress');
  assert.equal(procState(p), 'running');
  assert.equal(procState({ ...p, status: 'idle' }), 'stale');
  assert.equal(procState({ ...p, status: 'error' }), 'failed');
  assert.equal(procState({ ...p, status: 'stopped' }), 'stopped');
  assert.equal(procStaleSec(p), 480);
  assert.equal(procStaleSec({ ...p, meta: { proc: p.meta.proc } }), 300);
  assert.deepEqual(procTags({ ...p, status: 'idle' }), ['정체', '들여다봄 3']);
  assert.deepEqual(procTags({ ...p, status: 'done', meta: { ...p.meta, proc: { ...p.meta.proc, rc: 0, watchCount: 0 } } }), ['rc 0']);
  assert.deepEqual(nodeTags({ ...p, status: 'idle' }), ['정체', '들여다봄 3']);
  assert.ok(!isProc({ id: 'b:x', meta: {} }));
});

test('레인 보간 값(처리율 × 경과, 상한·total·끝) · 비율 · 과열 단계 · ETA · 글자', () => {
  const l = LANES[0];
  assert.equal(laneValue(l, T0), 46000);
  assert.equal(laneValue(l, T0 + 10_000), 46086, '10초 × 8.6/s');
  assert.equal(laneValue(l, T0 + 3600_000), 46000 + 8.6 * LANEW.AHEAD_SEC, '기본 300초까지만');
  assert.equal(laneValue(l, T0 + 3600_000, { aheadSec: 480 }), 46000 + 8.6 * 480);
  assert.equal(laneValue(l, T0 + 10_000, { ended: true }), 46000, '끝난 작업은 그대로');
  assert.equal(laneValue({ ...l, rate: null }, T0 + 10_000), 46000);
  const t = { key: 'smoke', n: 30, total: 50, rate: 1, at: iso(0) };
  assert.equal(laneValue(t, T0 + 60_000), 50, 'total 을 넘지 않음');
  assert.equal(laneRatio(t, T0), 0.6);
  assert.equal(laneRatio(l, T0), null);
  const vals = jobLaneValues(JOB(), T0 + 10_000);
  assert.deepEqual(vals.map((v) => [v.key, Math.round(v.value), v.heat, v.pass]), [['iter_pairs', 46086, 1, 2], ['_walk_pairs', 42308, 0.29, 1]]);
  assert.deepEqual(jobLaneValues(JOB({ state: 'done' }), T0 + 10_000).map((v) => v.value), [46000, 42000]);
  assert.equal(jobHeat(JOB()), 1);
  assert.equal(jobHeat({}), 0);
  assert.deepEqual([0, 0.2, 0.33, 0.5, 0.66, 1].map(heatLevel), ['cool', 'cool', 'warm', 'warm', 'hot', 'hot']);
  assert.equal(jobEtaMs(JOB({ eta: iso(120) }), T0), 120_000);
  assert.equal(jobEtaMs(JOB({ eta: iso(-5) }), T0), 0);
  assert.equal(jobEtaMs(JOB(), T0), null);
  assert.equal(fmtRate(8.6), '8.6/초');
  assert.equal(fmtRate(0.05), '3/분');
  assert.equal(fmtRate(null), '');
  assert.equal(laneText(l, T0), 'iter_pairs 46,000 바퀴 · 8.6/초');
  assert.equal(laneText(t, T0), 'smoke 30/50 · 1/초');
  assert.deepEqual(jobLanes(null), []);
  const n = { id: 'j:b:toolu_p:progress', parentId: 'b:toolu_p', kind: 'bash-bg', status: 'active', meta: { job: JOB() } };
  assert.ok(isAutoJob(n));
  const ins = jobInspect(n, T0 + 10_000);
  assert.equal(ins.lanes.length, 2);
  assert.equal(ins.heat, 1);
  assert.equal(jobSrcText('auto'), '진행 줄 자동 인식');
});

test('들여다보기 펄스: 열림(계속) · 끝 펄스 사라짐 · 진행 표시 · 스냅샷 seed · 되감기 · 순수 함수 꼴', () => {
  const ev = (s, phase, extra = {}) => ({ type: 'watch', ts: iso(s), nodeId: 'a:sub', peer: 'b:toolu_p', kind: 'wait', via: 'shell', phase, toolUseId: 'toolu_w1', ...extra });
  const w = new WatchTracker();
  w.push({ type: 'output', nodeId: 'x' });
  w.push(ev(0, 'start'));
  let p = w.pulses(T0 + 5000);
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].open, p[0].strength, p[0].kind, p[0].ageMs], [true, 1, 'wait', 5000]);
  w.push(ev(600, 'end', { progress: true }));
  p = w.pulses(T0 + 600_000 + 1200);
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].open, p[0].progress], [false, true]);
  assert.ok(Math.abs(p[0].strength - 0.5) < 1e-9, '펄스 절반쯤 사라짐');
  assert.equal(w.pulses(T0 + 600_000 + LANEW.PULSE_MS + 1).length, 0, '다 사라짐');
  assert.equal(w.pulses(T0 + 100_000).filter((x) => !x.open).length, 0, '되감기: 아직 안 끝난 펄스는 없음');
  // 스냅샷: meta.proc.watch 의 열린 것
  const s = new WatchTracker();
  s.seed([PROC({ meta: { ...PROC().meta, proc: { ...PROC().meta.proc, watch: [{ nodeId: 'm:mon1', kind: 'wait', via: 'monitor', since: iso(0), toolUseId: 'toolu_m' }] } } })]);
  assert.deepEqual(s.pulses(T0 + 1000).map((x) => [x.from, x.to, x.via, x.open]), [['m:mon1', 'b:toolu_p', 'monitor', true]]);
  s.clear();
  assert.equal(s.pulses(T0).length, 0);
  assert.deepEqual(watchPulses([ev(0, 'start'), ev(1, 'end')], T0 + 2000).map((x) => x.open), [false]);
});

test('mock: 서브에이전트가 띄운 2레인 작업(점점 느려짐·10초마다 들여다봄·EXIT 0) + 짧게 실패하는 것', () => {
  assert.equal(mockHeat(8000, 8, 0.14, 4.32), 1);
  assert.equal(mockHeat(8, 8, 1.58, 1.58), 0);
  const gen = new MockGenerator({ seed: 2026, startMs: T0, procs: true });
  const evs = [];
  let heatMid = null;
  while (gen.q.length) {
    const at = Math.min(...gen.q.map((x) => x.at));
    if (at > 92_000) break;
    evs.push(...gen.next().events);
    const j = [...gen.nodes.values()].find((n) => n.meta?.job?.src === 'auto' && n.parentId?.startsWith('b:') && n.meta.job.lanes.length === 2);
    if (j && heatMid == null && gen.t > 30_000) heatMid = j.meta.job.heat;
  }
  const procs = [...gen.nodes.values()].filter(isProc);
  assert.equal(procs.length, 2);
  const [main, smoke] = procs;
  assert.equal(main.parentId, 'a:demo-probe', '띄운 서브에이전트 아래');
  assert.equal(main.status, 'done');
  assert.equal(procOf(main).rc, 0);
  assert.equal(smoke.status, 'error');
  assert.equal(procOf(smoke).rc, 1);
  const job = gen.nodes.get(procJobId(main));
  assert.deepEqual(jobLanes(job.meta.job).map((l) => l.key), ['iter_pairs', '_walk_pairs'], '레인 2개');
  assert.equal(job.meta.job.state, 'done');
  assert.ok(heatMid != null && job.meta.job.heat > heatMid - 1e-9 && job.meta.job.heat >= 0.9, `점점 과열 ${heatMid} → ${job.meta.job.heat}`);
  assert.equal(gen.nodes.get(procJobId(smoke)).meta.job.state, 'failed');
  const watches = evs.filter((e) => e.type === 'watch');
  const starts = watches.filter((e) => e.phase === 'start'), ends = watches.filter((e) => e.phase === 'end');
  assert.ok(starts.filter((e) => e.kind === 'wait').length >= 5, '10초마다 기다림');
  assert.equal(starts.length, ends.length, '시작·끝 짝');
  assert.ok(watches.every((e) => e.nodeId === 'a:demo-probe' && procs.some((p) => p.id === e.peer)));
  // 기본 mock(jobs·launcher 만)은 그대로
  const g2 = new MockGenerator({ seed: 2026, startMs: T0 });
  for (let i = 0; i < 200 && g2.q.length; i++) g2.next();
  assert.equal([...g2.nodes.values()].filter(isProc).length, 0);
});
