// 흐름 표현 분리 프로세스 장치 — 순수 규칙(proc-rig-core)과 공용 인스펙터 레인 표(inspector-core). 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _setLangForTest } from '../i18n.mjs';
import {
  RIG, heatRgb, rigModel, rigJob, rotorTarget, spinStep, drumCells, fmtCount, fmtCompact, laneTicks, tickPhase, RateTrail, RigWatch, watchFx,
  supervisedProcs, superviseText, supervisorSets, RigTicks, endTone, rigLod, alarmBlink, rigTipHtml, shortDur, tapeStep,
} from '../flowview/proc-rig-core.mjs';
import { laneValue, jobLaneValues, jobHeat, heatLevel } from '../job-core.mjs';
import { laneTableModel, procCardModel } from '../inspector-core.mjs';

_setLangForTest('ko');
const T0 = Date.parse('2026-10-26T09:00:00Z');
const iso = (s) => new Date(T0 + s * 1000).toISOString();
const PROC = (extra = {}, proc = {}) => ({ id: 'b:p', parentId: 'a:sub', kind: 'bash-bg', status: 'active', label: '분리 실행 · probe_branches.py', startedAt: iso(0),
  meta: { proc: { v: 1, cmd: 'nohup python -u probe_branches.py', prog: 'python', script: 'probe_branches.py', via: 'nohup', log: 'D:/x/run1/run.log', pidHint: null, spawnedBy: 'a:sub',
    watch: [], watchCount: 3, lastWatchAt: iso(-120), endReason: null, rc: null, ...proc }, procStaleSec: 480 }, ...extra });
const LANES = [
  { key: 'iter_pairs', n: 46000, total: null, unit: '바퀴', rate: 8, last: { k: '최장', v: 4.32, u: 's' }, pass: 2, at: iso(0), elapsed: 5546, heat: 1 },
  { key: '_walk_pairs', n: 42000, total: null, unit: '바퀴', rate: 7.5, last: { k: '최장', v: 4.32, u: 's' }, pass: 1, at: iso(-30), elapsed: 5587, heat: 0.29 },
  { key: 'extra', n: 5, total: 10, unit: 'cases', rate: 0.5, last: null, pass: 1, at: iso(0), elapsed: null, heat: 0 },
];
const JOBN = (job = {}) => ({ id: 'j:b:p:progress', parentId: 'b:p', kind: 'bash-bg', status: 'active', label: '진행',
  meta: { job: { v: 1, id: 'progress', title: '진행', state: 'running', phase: 'iter_pairs', progress: null, beatAt: iso(0), staleSec: 480, line: '[iter_pairs] 46,000 바퀴 · 5546s · 최장 4.32s',
    src: 'auto', startedAt: iso(-6000), endedAt: null, lanes: LANES.slice(0, 2), primary: 'iter_pairs', rate: 8, eta: null, heat: 1, ...job } } });

test('장치 모델: 레인 보간은 job-core 공용 값 그대로 · 두 줄 + 나머지 수 · 상태 번호 · 과열 단계', () => {
  const now = T0 + 10_000;
  const m = rigModel(PROC(), JOBN(), now);
  assert.equal(m.state, 'running'); assert.equal(m.code, 0); assert.equal(m.ended, false);
  assert.equal(m.lanes.length, 2);
  assert.equal(m.lanes[0].value, laneValue(LANES[0], now, { aheadSec: 480 })); // 세 표현이 같은 숫자
  assert.deepEqual(m.lanes.map((l) => l.value), jobLaneValues(JOBN().meta.job, now).map((l) => l.value));
  assert.equal(m.primary.key, 'iter_pairs');
  assert.equal(m.heat, jobHeat(JOBN().meta.job)); assert.equal(m.level, heatLevel(1)); assert.equal(m.level, 'hot');
  assert.equal(m.rateText, '8/초');
  assert.deepEqual(m.last, { k: '최장', v: 4.32, u: 's' });
  const m3 = rigModel(PROC(), JOBN({ lanes: LANES }), now);
  assert.equal(m3.lanes.length, RIG.LANES_SHOWN); assert.equal(m3.more, 1);
  // 작업이 아직 없음(진행 줄 인정 전): 숫자 없음
  const m0 = rigModel(PROC(), null, now);
  assert.equal(m0.lanes.length, 0); assert.equal(m0.primary, null); assert.equal(m0.heat, 0);
  assert.equal(rigModel(PROC({ status: 'idle' }), null, now).code, 1);
  assert.equal(rigModel(PROC({ status: 'done' }), null, now).code, 2);
  assert.equal(rigModel(PROC({ status: 'error' }), null, now).state, 'failed');
  assert.equal(rigModel({ id: 'x' }, null, now), null);
  assert.equal(rigJob(PROC(), new Map([['j:b:p:progress', JOBN()]])).id, 'j:b:p:progress');
  assert.equal(rigJob(PROC(), () => null), null);
});

test('과열 색: 차분 청록 → 호박 → 주홍(오류 빨강과 다른 주황 쪽), 라이트는 진한 잉크', () => {
  const c0 = heatRgb(0), c5 = heatRgb(0.5), c1 = heatRgb(1);
  assert.ok(c0[1] > c0[0], '차분 = 청록(초록 > 빨강)');
  assert.ok(c5[0] > 0.95 && c5[1] > 0.5, '중간 = 호박');
  assert.ok(c1[0] > 0.95 && c1[1] > 0.3 && c1[1] < 0.5 && c1[2] < 0.25, '뜨거움 = 주홍(초록 채널이 남은 주황빨강)');
  for (const h of [0, 0.3, 0.7, 1]) { const d = heatRgb(h), l = heatRgb(h, true); assert.ok(l[0] + l[1] + l[2] < d[0] + d[1] + d[2], '라이트는 더 진함'); }
  assert.deepEqual(heatRgb(-1), heatRgb(0)); assert.deepEqual(heatRgb(5), heatRgb(1));
  const out = [0, 0, 0]; assert.equal(heatRgb(0.2, false, out), out);
});

test('로터: 돌아가는 중 > 정체 > 끝(0), 과열이면 힘겹게 조금 느림, 움직임 줄이기면 정지 · 끝나면 서서히 멈춰 섬', () => {
  assert.ok(rotorTarget('running', 0) > rotorTarget('running', 1));
  assert.ok(rotorTarget('running', 1) > rotorTarget('stale', 0));
  assert.equal(rotorTarget('done', 0), 0); assert.equal(rotorTarget('failed'), 0);
  assert.equal(rotorTarget('running', 0, true), 0);
  const st = {};
  spinStep(st, RIG.SPIN_RUN, 0.016);
  assert.equal(st.w, RIG.SPIN_RUN); // 처음 보는 장치는 바로 목표 속도
  const w0 = st.w;
  spinStep(st, 0, 0.25);
  assert.ok(st.w < w0 && st.w > 0, '한 번에 서지 않음');
  for (let i = 0; i < 80; i++) spinStep(st, 0, 0.1);
  assert.equal(st.w, 0, '결국 멈춤');
  assert.ok(st.a >= 0 && st.a < Math.PI * 2);
});

test('숫자 드럼: 천 단위 쉼표 · 일의 자리는 소수부만큼 넘어감 · 위 자리는 아래가 모두 9 일 때만 같이', () => {
  const c = drumCells(46012.25);
  assert.equal(c.map((x) => x.ch).join(''), '46,012');
  assert.equal(c[c.length - 1].roll, 0.25); assert.equal(c[c.length - 1].next, '3');
  assert.equal(c[c.length - 2].roll, 0, '아래가 9 가 아니면 그대로');
  assert.equal(c[2].roll, 0, '쉼표 칸');
  const d = drumCells(1999.5);
  assert.deepEqual(d.map((x) => x.roll), [0.5, 0, 0.5, 0.5, 0.5]); // 1,999 → 2,000: 9 셋과 1 이 같이 넘어감(아래가 모두 9), 쉼표는 0
  assert.equal(d[0].next, '2');
  const reuse = []; assert.equal(drumCells(7, reuse), reuse); assert.equal(reuse.length, 1);
  assert.equal(drumCells(-3)[0].ch, '0');
  assert.equal(fmtCount(48000.9), '48,000'); assert.equal(fmtCount(-1), '0');
  assert.equal(fmtCompact(9876), '9,876'); assert.equal(fmtCompact(48000), '48.0k'); assert.equal(fmtCompact(250000), '250k'); assert.equal(fmtCompact(1250000), '1.25M');
});

test('진행 줄 눈금 패킷: 처음 보는 레인은 세지 않고, 값·회차가 바뀐 레인 수 · 튀어 오름 → 흐름선 따라 띄운 노드로', () => {
  const memo = new Map();
  assert.equal(laneTicks(memo, { lanes: LANES.slice(0, 2) }), 0, '스냅샷: 패킷 없음');
  assert.equal(laneTicks(memo, { lanes: LANES.slice(0, 2) }), 0, '같은 값');
  assert.equal(laneTicks(memo, { lanes: [{ ...LANES[0], n: 48000 }, LANES[1]] }), 1);
  assert.equal(laneTicks(memo, { lanes: [{ ...LANES[0], n: 48000 }, { ...LANES[1], n: 2000, pass: 2 }] }), 1, '새 회차');
  assert.equal(laneTicks(memo, null), 0);
  const a = tickPhase(0), b = tickPhase(RIG.TICK_MS * RIG.TICK_POP * 0.99), c = tickPhase(RIG.TICK_MS * 0.6), d = tickPhase(RIG.TICK_MS * 0.999);
  assert.equal(a.u, 1); assert.equal(a.pop, 0); assert.ok(b.pop > 0.9 && b.u === 1);
  assert.ok(c.u < 1 && c.u > 0); assert.ok(d.u < 0.01 && d.alpha < 0.05);
  assert.equal(tickPhase(RIG.TICK_MS), null); assert.equal(tickPhase(-1), null);
  // RigTicks: flowEvent 의 자동 작업 node-update → 주인 프로세스
  const nodes = new Map([['b:p', PROC()], ['j:b:p:progress', JOBN()]]);
  const rt = new RigTicks();
  const ev = (lanes) => ({ type: 'node-update', nodeId: 'j:b:p:progress', patch: { meta: { job: { ...JOBN().meta.job, lanes } } } });
  assert.equal(rt.fromEvent(ev(LANES.slice(0, 2)), (id) => nodes.get(id)), null);
  assert.deepEqual(rt.fromEvent(ev([{ ...LANES[0], n: 50000 }, LANES[1]]), (id) => nodes.get(id)), { procId: 'b:p', n: 1 });
  assert.equal(rt.fromEvent({ type: 'node-update', nodeId: 'b:p', patch: { status: 'active' } }, (id) => nodes.get(id)), null);
  const proto = new Map([['b:p', PROC()], ['j:b:p:x', { ...JOBN(), id: 'j:b:p:x', meta: { job: { ...JOBN().meta.job, src: 'protocol' } } }]]);
  assert.equal(rt.fromEvent({ ...ev([{ ...LANES[0], n: 1 }]), nodeId: 'j:b:p:x' }, (id) => proto.get(id)), null, '규약 작업은 아님');
});

test('처리율 꼬리: 같은 갱신은 한 번 · 상한 · 로그 눈금(100배 느려짐이 한 화면)', () => {
  const t = new RateTrail(4);
  assert.equal(t.push('a', 10000), true); assert.equal(t.push('a', 10000), false); assert.equal(t.push('b', 0), false);
  t.push('c', 1000); t.push('d', 100); t.push('e', 10);
  assert.equal(t.v.length, 4);
  const h = t.heights();
  assert.equal(h[0], 1); assert.ok(Math.abs(h[1] - 0.5) < 1e-9); assert.equal(h[2], 0); assert.equal(h[3], 0);
  t.clear(); assert.deepEqual(t.heights(), []);
});

test('감독: 열린 wait = 고리·실 + 처음 한 번 스캔, peek 짧은 스캔, 끝 + 진행 줄 = 체크·되돌아오는 패킷 · 거르기(끝난 프로세스·장부에 없는 열린 것)', () => {
  const o = watchFx({ open: true, kind: 'wait', ageMs: 100, strength: 1 });
  assert.ok(o.sweep && o.sweep.head > 0 && o.sweep.head < 1); assert.ok(o.ring > 0 && o.thread > 0);
  const late = watchFx({ open: true, kind: 'wait', ageMs: 5000 });
  assert.equal(late.sweep, null); assert.equal(late.ring, 1);
  const pk = watchFx({ open: true, kind: 'peek', ageMs: 100 });
  assert.ok(pk.sweep); assert.equal(pk.ring, 0); assert.equal(pk.thread, 0);
  const end = watchFx({ open: false, kind: 'peek', ageMs: 300, strength: 0.8, progress: true });
  assert.equal(end.check, 0.8); assert.ok(end.back > 0 && end.back < 1);
  assert.equal(watchFx({ open: false, kind: 'peek', ageMs: 300, strength: 0.8, progress: false }).check, 0);
  assert.equal(watchFx(null).sweep, null);
  // RigWatch
  const now = T0 + 5000;
  const w = new RigWatch();
  const nodes = new Map([['a:sub', { id: 'a:sub' }], ['b:p', PROC({}, { watch: [{ nodeId: 'a:sub', kind: 'wait', via: 'shell', since: iso(1), toolUseId: 't1' }] })]]);
  const nodeOf = (id) => nodes.get(id) || null;
  w.seed(nodes.get('b:p'));
  assert.equal(w.pulses(now, nodeOf).length, 1, '스냅샷 씨앗 = 열린 wait');
  w.event({ type: 'watch', ts: iso(2), nodeId: 'a:sub', peer: 'b:p', kind: 'peek', via: 'shell', phase: 'start', toolUseId: 't2' });
  assert.equal(w.pulses(now, nodeOf).length, 2);
  nodes.set('b:p', PROC({}, { watch: [] })); // 조용한 이벤트로 닫힘(장부에 없음) → 열린 것은 거름
  assert.equal(w.pulses(now, nodeOf).length, 0);
  w.event({ type: 'watch', ts: iso(4), nodeId: 'a:sub', peer: 'b:p', kind: 'peek', via: 'shell', phase: 'end', toolUseId: 't2', progress: true });
  const ps = w.pulses(now, nodeOf);
  assert.equal(ps.length, 1); assert.equal(ps[0].open, false); assert.equal(ps[0].progress, true);
  nodes.set('b:p', PROC({ status: 'done' }, { watch: [{ nodeId: 'a:sub', kind: 'wait', since: iso(1), toolUseId: 't1' }] }));
  assert.ok(w.pulses(now, nodeOf).every((p) => !p.open), '끝난 프로세스로 가는 열린 것 없음');
  assert.equal(w.pulses(now, (id) => (id === 'a:sub' ? null : nodeOf(id))).length, 0, '보이지 않는 노드');
  w.reset(); assert.equal(w.pulses(now, nodeOf).length, 0);
  w.event({ type: 'output', nodeId: 'b:p' }); assert.equal(w.tr.open.size, 0);
});

test('감독 한 줄: "감독 · 스크립트 · 레인 값 단위" · 여럿이면 +N · 끝난 것 빼고 · 감독 집합', () => {
  const now = T0 + 10_000;
  const nodes = new Map([['a:sub', { id: 'a:sub' }], ['b:p', PROC()], ['j:b:p:progress', JOBN()]]);
  const txt = superviseText('a:sub', nodes, now);
  assert.equal(txt, `감독 · probe_branches.py · ${fmtCount(laneValue(LANES[0], now, { aheadSec: 480 }))} 바퀴`);
  assert.equal(superviseText('a:other', nodes, now), '');
  nodes.delete('j:b:p:progress');
  assert.equal(superviseText('a:sub', nodes, now), '감독 · probe_branches.py', '레인 전이면 숫자 없이');
  nodes.set('b:q', PROC({ id: 'b:q', startedAt: iso(50) }, { script: 'smoke.py' }));
  assert.ok(superviseText('a:sub', nodes, now).startsWith('감독 · smoke.py') && superviseText('a:sub', nodes, now).endsWith('+1'));
  nodes.set('b:q', PROC({ id: 'b:q', status: 'error' }, { script: 'smoke.py' }));
  assert.equal(supervisedProcs('a:sub', nodes).length, 1);
  // 다른 노드가 들여다봄(감독 관계)
  nodes.set('m:mon', { id: 'm:mon' });
  nodes.set('b:p', PROC({}, { watch: [{ nodeId: 'm:mon', kind: 'wait', since: iso(0), toolUseId: 't' }] }));
  assert.equal(supervisedProcs('m:mon', nodes).length, 1);
  const { sup, wat } = supervisorSets(nodes.values());
  assert.ok(sup.has('a:sub') && sup.has('m:mon')); assert.ok(wat.has('m:mon') && !wat.has('a:sub'));
  _setLangForTest('en');
  assert.ok(superviseText('m:mon', nodes, now).startsWith('Supervising · probe_branches.py'));
  _setLangForTest('ko');
});

test('그 밖: 끝 파동 색 · LOD · 경고 점 깜빡임 · 남은 시간 · 테이프 단위 · 마우스 올림 카드', () => {
  assert.equal(endTone('done'), 'ok'); assert.equal(endTone('failed'), 'error'); assert.equal(endTone('stopped'), 'stopped'); assert.equal(endTone('running'), null);
  assert.equal(rigLod(RIG.LOD_SIL_PX - 1), 0); assert.equal(rigLod(RIG.LOD_SIL_PX), 1); assert.equal(rigLod(RIG.LOD_FULL_PX), 2);
  assert.equal(alarmBlink(0.37, true), 1);
  const bl = new Set(); for (let t = 0; t < 2; t += 0.05) bl.add(alarmBlink(t)); assert.ok(bl.size === 2, '켜짐·꺼짐 두 단계');
  assert.equal(shortDur(30_000), '30초'); assert.equal(shortDur(12 * 60_000), '12분');
  assert.equal(tapeStep(8), 1); assert.equal(tapeStep(8000), 1000); assert.equal(tapeStep(null), 1);
  const m = rigModel(PROC(), JOBN(), T0);
  const html = rigTipHtml(m, PROC({ label: '<b>' }, { script: 'x<y>.py' }));
  assert.ok(html.includes('x&lt;y&gt;.py') && html.includes('iter_pairs') && html.includes('46,000 바퀴') && html.includes('과열 1.00 · 크게 느려짐') && html.includes('들여다봄 3'));
  assert.equal(rigTipHtml(null, null), '');
});

test('공용 카드(§70): 레인 표·프로세스 구역 — 표현 무관 모델', () => {
  const now = T0 + 10_000;
  const lm = laneTableModel(JOBN({ lanes: LANES, eta: iso(610) }).meta.job, now);
  assert.equal(lm.rows.length, 3);
  assert.equal(lm.rows[0].value, fmtCount(laneValue(LANES[0], now, { aheadSec: 480 })));
  assert.equal(lm.rows[0].pass, '2회차'); assert.equal(lm.rows[1].pass, '');
  assert.equal(lm.rows[0].rate, '8/초'); assert.equal(lm.rows[0].last, '4.32s'); assert.equal(lm.rows[0].level, 'hot'); assert.equal(lm.rows[1].level, 'cool');
  assert.ok(lm.rows[2].value.endsWith('/10') && lm.rows[2].ratio > 0.5 && lm.rows[2].ratio <= 1);
  assert.equal(lm.level, 'hot'); assert.equal(lm.rate, '8/초'); assert.equal(lm.etaText, '10분 남음');
  assert.equal(laneTableModel({ lanes: [] }, now), null);
  assert.equal(laneTableModel(JOBN({ state: 'done', eta: iso(600) }).meta.job, now).etaText, '', '끝난 작업은 남은 시간 없음');
  const nodes = new Map([['b:p', PROC()], ['j:b:p:progress', JOBN()]]);
  const pm = procCardModel(nodes.get('b:p'), nodes, now);
  const row = (k) => pm.rows.find((r) => r.key === k);
  assert.equal(row('state').value, '돌아가는 중');
  assert.equal(row('prog').value, 'python · probe_branches.py'); assert.ok(row('prog').title.includes('nohup'));
  assert.equal(row('via').value, 'nohup');
  assert.equal(row('log').value, 'D:/x/run1/run.log', '로그 경로는 서버가 마스킹한 그대로');
  assert.ok(row('watch').value.startsWith('3번 · 마지막 '));
  assert.equal(row('end'), undefined);
  assert.equal(pm.lanes.rows.length, 2); assert.ok(pm.line.startsWith('[iter_pairs]')); assert.equal(pm.jobId, 'j:b:p:progress');
  const ended = procCardModel(PROC({ status: 'error' }, { endReason: 'traceback', rc: 1 }), new Map(), now);
  assert.equal(ended.rows.find((r) => r.key === 'end').value, '예외(Traceback) · rc 1');
  assert.equal(ended.lanes, null); assert.equal(ended.line, '');
  assert.equal(procCardModel({ id: 'x', meta: {} }, nodes, now), null);
});
