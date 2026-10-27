// Planet 3D 작업 노드 = 주인 둘레의 작은 탐사선 — 순수 규칙(planet-core.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOB_BODY_K, BODY_K, JOB_LOOK, JOB_RING, jobLook, jobWaitFill, jobRingFill, jobBlink, jobLod, JOB_LOD, jobTether, ringAt, JOB_RING_GEO } from '../planet-core.mjs';
import { JOB_CODE, jobCode } from '../job-core.mjs';
import { readFileSync } from 'node:fs';
import { _setLangForTest } from '../i18n.mjs';
import { JOB_WEIGHT, jobWeightK, TRACK, TRACK_MODE, trackSlots, trackSpan, trackRadius, trackModel, trackGates, trackLabels, jobEstimated, JOB_GLYPH } from '../planet-core.mjs';

const T0 = Date.parse('2026-10-25T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const job = (o = {}) => ({ v: 1, id: 'x', state: 'running', progress: null, until: null, beatAt: iso(T0), startedAt: iso(T0 - 60000), staleSec: null, stale: false, ...o });

test('탐사선 몸체는 백그라운드 명령 위성보다 작다', () => {
  assert.ok(JOB_BODY_K < BODY_K['bash-bg'] * 0.7);
  assert.ok(JOB_BODY_K > 0.2);
  // 고리까지 합친 겉 반지름도 백그라운드 명령 몸체 근처(위성보다 크게 보이지 않게)
  assert.ok(JOB_BODY_K * JOB_RING_GEO.extent <= BODY_K['bash-bg'] * 1.2);
  assert.ok(JOB_RING_GEO.R0 < JOB_RING_GEO.HEAD_R && JOB_RING_GEO.HEAD_R < JOB_RING_GEO.R1 && JOB_RING_GEO.R1 <= JOB_RING_GEO.extent);
});

test('표시 상태 번호마다 모양 하나 — 색 토큰·고리 방식이 공통 색 의미를 따른다', () => {
  assert.equal(JOB_LOOK.length, Object.keys(JOB_CODE).length);
  for (const [st, code] of Object.entries(JOB_CODE)) assert.equal(JOB_LOOK[code].st, st);
  const L = (st) => JOB_LOOK[JOB_CODE[st]];
  assert.equal(L('running').tok, 'skill');   // 진행 = 호박
  assert.equal(L('done').tok, 'ok');         // 끝 = 초록
  assert.equal(L('failed').tok, 'error');    // 실패 = 빨강
  assert.equal(L('waiting').tok, 'flow-call'); // 대기 = 파랑 계열
  assert.ok(L('waiting').dim > 0 && L('queued').dim > 0); // 대기·줄 섬은 흐림
  assert.equal(L('queued').tok, 'stopped');  // 줄 섬 = 회색
  assert.deepEqual([L('stale').tok, L('stale').mix[0]], ['skill', 'error']); // 정체 = 호박 → 빨강 사이 주황
  assert.ok(L('stale').blink && !L('running').blink);
  // 끝·실패는 멈춤(자전·공전 0, 궤도 자취 없음), 진행이 가장 빠름
  for (const st of ['done', 'failed']) { assert.equal(L(st).spin, 0); assert.equal(L(st).orbit, 0); assert.equal(L(st).tether, 0); }
  for (const st of ['queued', 'waiting', 'stale']) assert.ok(L('running').spin > L(st).spin && L('running').orbit > L(st).orbit, st);
  // 대기는 느리게 돈다(멈추지 않음)
  assert.ok(L('waiting').orbit > 0 && L('waiting').orbit < L('running').orbit / 4);
});

test('진행 중: 비율이 있으면 진행 호, 없으면 도는 호 · 셰이더 번호', () => {
  assert.equal(jobLook(JOB_CODE.running, 0.4).ring, 'progress');
  assert.equal(jobLook(JOB_CODE.running, null).ring, 'spin');
  assert.equal(jobLook(JOB_CODE.running, 0.4).mode, JOB_RING.progress);
  assert.equal(jobLook(JOB_CODE.waiting).mode, JOB_RING.wait);
  assert.equal(jobLook(JOB_CODE.stale, 0.5).ring, 'stale');
  assert.equal(jobLook(99).st, 'running'); // 모르는 번호 = 진행
  assert.equal(new Set(Object.values(JOB_RING)).size, Object.keys(JOB_RING).length);
});

test('대기 고리는 until 이 가까울수록 차오른다(렌더러 시계)', () => {
  const j = job({ state: 'waiting', beatAt: iso(T0), until: iso(T0 + 10 * 60000) });
  assert.equal(jobWaitFill(j, T0), 0);
  assert.ok(Math.abs(jobWaitFill(j, T0 + 5 * 60000) - 0.5) < 1e-9);
  assert.equal(jobWaitFill(j, T0 + 11 * 60000), 1);
  assert.ok(jobWaitFill(j, T0 + 8 * 60000) > jobWaitFill(j, T0 + 2 * 60000));
  assert.equal(jobWaitFill(job({ state: 'waiting' }), T0), null); // until 없음
  // 박동이 없으면 시작 시각부터
  const k = job({ state: 'waiting', beatAt: null, startedAt: iso(T0), until: iso(T0 + 100000) });
  assert.ok(Math.abs(jobWaitFill(k, T0 + 25000) - 0.25) < 1e-9);
  // 고리 채움: 대기 = 차오름, 진행 = 비율, 끝 = 1, 도는 호 = 0
  const code = jobCode(j, T0 + 5 * 60000);
  assert.equal(code, JOB_CODE.waiting);
  assert.ok(Math.abs(jobRingFill(j, code, T0 + 5 * 60000) - 0.5) < 1e-9);
  assert.equal(jobRingFill(job(), JOB_CODE.running, T0, 0.3), 0.3);
  assert.equal(jobRingFill(job(), JOB_CODE.running, T0, null), 0);
  assert.equal(jobRingFill(job({ state: 'done' }), JOB_CODE.done, T0), 1);
  assert.equal(jobRingFill(job(), JOB_CODE.stale, T0, null), 1);
  assert.equal(jobRingFill(job(), JOB_CODE.stale, T0, 0.6), 0.6);
});

test('정체는 시계로 넘어가 깜빡임 모양이 된다', () => {
  const j = job({ beatAt: iso(T0), staleSec: 60 });
  assert.equal(jobLook(jobCode(j, T0 + 30000)).ring, 'spin');
  assert.equal(jobLook(jobCode(j, T0 + 120000)).ring, 'stale');
  assert.ok(jobLook(jobCode(j, T0 + 120000)).blink);
});

test('정체 깜빡임은 결정적이고 박자가 불규칙하다', () => {
  assert.deepEqual(jobBlink(3.21, 0.4), jobBlink(3.21, 0.4));
  const dt = 1 / 120;
  const runs = [];
  let last = null, since = 0, lo = 0, hi = 0;
  for (let t = 0; t < 40; t += dt) {
    const { k } = jobBlink(t, 0.37);
    assert.ok(k >= 0.08 && k <= 1, String(k));
    const on = k > 0.5;
    on ? hi++ : lo++;
    if (last !== null && on !== last) { runs.push(since); since = 0; }
    since += dt; last = on;
  }
  assert.ok(runs.length >= 12, '바뀜 ' + runs.length); // 40초에 여러 번 켜지고 꺼진다
  assert.ok(hi > lo * 0.8 && lo > 0, '대체로 켜짐, 가끔 끊김'); // 켜진 쪽이 대부분
  const min = Math.min(...runs), max = Math.max(...runs);
  assert.ok(max > min * 2.5, `간격이 일정하지 않음 ${min.toFixed(2)}..${max.toFixed(2)}`);
  // 씨앗이 다르면 무늬가 다르다(작업마다 엇갈림)
  let diff = 0;
  for (let t = 0; t < 10; t += 0.05) if ((jobBlink(t, 0.1).k > 0.5) !== (jobBlink(t, 0.8).k > 0.5)) diff++;
  assert.ok(diff > 10);
});

test('작업 LOD 문턱과 고리 둘레 좌표', () => {
  assert.equal(jobLod(0.5), 0);
  assert.equal(jobLod(JOB_LOD.RING_PX), 1);
  assert.equal(jobLod(JOB_LOD.DETAIL_PX - 0.01), 1);
  assert.equal(jobLod(JOB_LOD.DETAIL_PX), 2);
  assert.equal(jobLod(NaN), 0);
  const p = ringAt(0); assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.y - 1) < 1e-9); // 0 = 위
  const q = ringAt(0.25); assert.ok(Math.abs(q.x - 1) < 1e-9 && Math.abs(q.y) < 1e-9); // 시계 방향(오른쪽)
  const out = { x: 0, y: 0 }; assert.equal(ringAt(0.5, out), out);
});

test('주인 궤도 자취: 반지름 = 주인–작업 거리, 세계 길이가 대략 일정하게 각을 줄임', () => {
  const a = jobTether(2.4, -1.2, 0.7);
  assert.ok(Math.abs(a.R - Math.hypot(2.4, -1.2, 0.7)) < 1e-9);
  const b = jobTether(10, 0, 0);
  assert.ok(b.span < a.span && b.span > 0);
  assert.ok(Math.abs(b.R * b.span - 2.2) < 1e-9);
  assert.ok(jobTether(1, 0, 0).span <= 0.55); // 상한
  assert.equal(jobTether(0.1, 0, 0.1), null); // 너무 가까움
});

// ───────────── 장기 작업 연출 — 무게(G2) · 항로(A) · 배선 ─────────────

test('§110 G2 무게 경계: 경과 0 = 0.42 · 2시간 이상 = 0.74(bash-bg 와 같음)에서 멈춤 · 단조 · 시작 시각 없으면 기본', () => {
  assert.equal(JOB_WEIGHT.MIN, JOB_BODY_K);
  assert.equal(JOB_WEIGHT.MAX, BODY_K['bash-bg']);
  const at = (min, o = {}) => jobWeightK(job({ startedAt: iso(T0 - min * 60000), ...o }), T0);
  assert.equal(at(0), JOB_WEIGHT.MIN);
  assert.ok(Math.abs(at(JOB_WEIGHT.FULL_MIN) - JOB_WEIGHT.MAX) < 1e-9);
  assert.equal(at(JOB_WEIGHT.FULL_MIN * 3), JOB_WEIGHT.MAX); // 2시간 넘으면 멈춤
  let prev = 0;
  for (const m of [0, 1, 5, 10, 30, 60, 119]) { const k = at(m); assert.ok(k >= prev && k <= JOB_WEIGHT.MAX, String(m)); prev = k; }
  assert.ok(at(10) > JOB_WEIGHT.MIN + 0.05 && at(10) < at(60)); // log₂ 라 초반이 빠르게 큼
  assert.equal(jobWeightK(job({ startedAt: null }), T0), JOB_WEIGHT.MIN);
  // 끝난 작업은 끝난 때까지의 경과(끝난 뒤 시간이 흘러도 그대로)
  const ended = job({ state: 'done', startedAt: iso(T0 - 600000), endedAt: iso(T0 - 300000) });
  assert.equal(jobWeightK(ended, T0), jobWeightK(ended, T0 + 3600e3));
});

test('§110 항로 상한: 주인마다 끝나지 않은 작업 4개(오래 돈 것 먼저) · 끝난 것은 세지 않음 · 주인끼리 따로', () => {
  assert.equal(TRACK.PER_OWNER, 4);
  const it = (id, owner, minAgo, state = 'running') => ({ id, owner, job: job({ state, startedAt: iso(T0 - minAgo * 60000) }) });
  const items = [it('a1', 'A', 5), it('a2', 'A', 50), it('a3', 'A', 10), it('a4', 'A', 40), it('a5', 'A', 30), it('a6', 'A', 99, 'done'), it('a7', 'A', 98, 'failed'), it('b1', 'B', 1)];
  const s = trackSlots(items);
  assert.deepEqual([...s].filter((x) => x.startsWith('a')).sort(), ['a2', 'a3', 'a4', 'a5']); // 가장 짧게 돈 a1 이 빠짐
  assert.ok(s.has('b1'));
  assert.ok(!s.has('a6') && !s.has('a7'));
  assert.equal(trackSlots([it('w', 'A', 1, 'waiting'), it('q', 'A', 2, 'queued')]).size, 2); // 대기·줄 섬도 끝나지 않은 작업
});

test('§110 예상 비율 점선 판정: 진행 줄(n/N) = 측정 · ratio + 서술 expectSec = 추정 · ratio 만 = 측정', () => {
  assert.equal(jobEstimated(job({ progress: { n: 3, total: 10 }, ext: { expectSec: 600 } })), false);
  assert.equal(jobEstimated(job({ progress: { ratio: 0.96 }, ext: { expectSec: 16320 } })), true);
  assert.equal(jobEstimated(job({ progress: { ratio: 0.5 } })), false);
  assert.equal(jobEstimated(job({ progress: { ratio: 0.5 }, ext: { expectSec: 0 } })), false);
  assert.equal(jobEstimated(job()), false);
  assert.equal(jobEstimated(null), false);
  // 항로 모양: 진행 중 + 추정 = est(셰이더 점선 항적), 측정 = progress
  const est = job({ progress: { ratio: 0.5 }, ext: { expectSec: 1200 }, startedAt: iso(T0 - 600000) });
  assert.equal(trackModel(est, JOB_CODE.running, T0, 5, 0.5).mode, 'est');
  assert.equal(trackModel(job({ progress: { n: 5, total: 10 } }), JOB_CODE.running, T0, 5, 0.5).mode, 'progress');
  assert.equal(TRACK_MODE.est, 3);
});

test('§110 항로 모양·관문: 호 각 ≤ 300° · 세계 길이 ≤ 14 · 관문 = −p·S / +(1−p)·S · 줄 섬은 항로 없음 · 궤도계 안이면 바깥으로', () => {
  assert.ok(Math.abs(trackSpan(1) - TRACK.SPAN_MAX) < 1e-12);
  assert.ok(Math.abs(TRACK.SPAN_MAX - (300 * Math.PI) / 180) < 1e-12);
  assert.ok(Math.abs(trackSpan(20) * 20 - TRACK.LEN_MAX) < 1e-9);
  assert.equal(trackSpan(0.1), 0);
  const m = trackModel(job({ progress: { n: 25, total: 100 } }), JOB_CODE.running, T0, 4, 0.25);
  const g = trackGates(m);
  assert.ok(Math.abs(g.a0 + 0.25 * m.span) < 1e-12 && Math.abs(g.a1 - 0.75 * m.span) < 1e-12);
  assert.equal(trackModel(job({ state: 'queued' }), JOB_CODE.queued, T0, 4).mode, 'none');
  assert.equal(trackModel(job(), JOB_CODE.running, T0, 4, null).mode, 'spin');
  assert.equal(trackModel(job(), JOB_CODE.running, T0, 4, null).p, 0.5);
  assert.equal(trackModel(job({ state: 'done' }), JOB_CODE.done, T0, 4, 1).p, 1);
  assert.equal(trackRadius(3, 2), 3);
  assert.ok(Math.abs(trackRadius(1.5, 2) - 2 * TRACK.PUSH_K) < 1e-12);
  assert.ok(TRACK.REMAIN_A <= 0.3); // 남은 항로 알파 상한(위험 ①)
});

test('§110 관문 글자(분 단위): ETA · 예상 4:32 중 4:20 · 예상 초과 · until · 끝나면 없음', () => {
  _setLangForTest('ko');
  const p = job({ progress: { n: 50, total: 100 }, eta: iso(T0 + 13 * 60000), startedAt: iso(T0 - 3600e3) });
  const L1 = trackLabels(p, trackModel(p, JOB_CODE.running, T0, 5, 0.5), T0);
  assert.match(L1.to, /^~13분 · \d\d:\d\d$/);
  assert.match(L1.from, /^출발 \d\d:\d\d$/);
  const e = job({ progress: { ratio: 0.95 }, ext: { expectSec: 16320 }, startedAt: iso(T0 - 15600e3) });
  assert.equal(trackLabels(e, trackModel(e, JOB_CODE.running, T0, 5, 0.95), T0).to, '예상 4:32 중 4:20');
  const o = job({ progress: { ratio: 0.99 }, ext: { expectSec: 600 }, startedAt: iso(T0 - 1500e3) });
  assert.equal(trackLabels(o, trackModel(o, JOB_CODE.running, T0, 5, 0.99), T0).to, '예상 초과 15분');
  const w = job({ state: 'waiting', until: iso(T0 + 6 * 60000) });
  assert.match(trackLabels(w, trackModel(w, JOB_CODE.waiting, T0, 5), T0).to, /^~\d\d:\d\d$/);
  const d = job({ state: 'done', endedAt: iso(T0) });
  const dl = trackLabels(d, trackModel(d, JOB_CODE.done, T0, 5, 1), T0);
  assert.deepEqual([dl.from, dl.to], ['', '']);
  _setLangForTest('en');
});

test('§110 배선(three 를 node 에서 못 불러 글자 대조): 탐사선 = 글리프·무게·항로 · 외부 작업 플랫폼·계기도 항로 · 기동기 회차 고리 · 재무장 눈금', () => {
  const deco = readFileSync(new URL('../planet-deco.js', import.meta.url), 'utf8');
  assert.match(deco, /this\.track\.step\(job, code, prog, ctx\.slots\.has\(v\.id\)/); // 탐사선 항로(자리 안만)
  assert.match(deco, /jobWeightK\(job, nowMs\) \/ JOB_BODY_K/);                     // G2 무게
  assert.match(deco, /px >= JOB_GLYPH\.PX/);                                          // G1 글리프 문턱
  assert.match(deco, /if \(isJob\(v\.node\)\) d\.track = new JobTrack/);              // C 플랫폼·계기도 항로
  assert.match(deco, /if \(v\.device\) d\.deck = new DeckRing\(d, 0\)/);              // G3
  assert.match(deco, /k === 'monitor'\) d\.deck = new DeckRing\(d, 1\)/);             // G4
  assert.match(deco, /return trackSlots\(items\)/);
  assert.ok(JOB_GLYPH.PX > 0 && JOB_GLYPH.R < JOB_RING_GEO.R0);
  const flat = readFileSync(new URL('../flat/job2d.js', import.meta.url), 'utf8');
  assert.match(flat, /trackSlots\(items\)/);                                          // 2D 도 같은 항로 자리
  assert.match(flat, /jobWeightK\(jobOf\(v\.node\), view\.clock\(\)\) \/ JOB_BODY_K/);
});
