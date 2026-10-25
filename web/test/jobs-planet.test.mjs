// Planet 3D 작업 노드 = 주인 둘레의 작은 탐사선 — 순수 규칙(planet-core.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOB_BODY_K, BODY_K, JOB_LOOK, JOB_RING, jobLook, jobWaitFill, jobRingFill, jobBlink, jobLod, JOB_LOD, jobTether, ringAt, JOB_RING_GEO } from '../planet-core.mjs';
import { JOB_CODE, jobCode } from '../job-core.mjs';

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
