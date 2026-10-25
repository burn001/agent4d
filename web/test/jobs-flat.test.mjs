// 작업(Job) 노드 2D — 흐름 2D 알약 · Planet 2D 작은 위성의 순수 규칙(flat-core JOB2D·jobPalette·jobPill·jobWaitFill·
// jobStalePulse·jobMarquee·jobBeatY)과 표시 상태 캐시(job2d syncJob·jobLevel)가 렌더러 시계(view.clock)를 쓰는지. 합성 노드만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _setLangForTest } from '../i18n.mjs';
import { JOB2D, JOB_TONE, JOB_ALPHA, jobAnim, jobPalette, jobPill, jobOrbitArc, jobWaitFill, jobStalePulse, jobMarquee, jobBeatY, mixColor, parseColor } from '../flat/flat-core.mjs';
import { syncJob, jobLevel, isJobVis } from '../flat/job2d.js';
import { JOB_CODE } from '../job-core.mjs';
import { RADIUS } from '../layout.js';

_setLangForTest('ko');
const T0 = Date.parse('2026-10-25T12:00:00Z');
const iso = (min) => new Date(T0 + min * 60000).toISOString();
const DARK = { bg: '#0b0f17', muted: '#8b96a8', skill: '#facc15', 'flow-call': '#60a5fa', ok: '#34d399', error: '#ef4444', isLight: false };
const LIGHT = { bg: '#f5f6fa', muted: '#5b6577', skill: '#b45309', 'flow-call': '#2563eb', ok: '#059669', error: '#dc2626', isLight: true };
const dist = (a, b) => { const A = parseColor(a), B = parseColor(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };

test('색: 표시 상태 번호 = JOB_CODE 순서 · 진행 = --skill · 끝 = --ok · 실패 = --error · 정체 = 호박과 빨강 사이 · 다크·라이트 모두 구분', () => {
  assert.equal(JOB_TONE.length, 6);
  for (const [k, i] of Object.entries(JOB_CODE)) assert.ok(JOB_TONE[i], k);
  for (const tok of [DARK, LIGHT]) {
    const c = jobPalette(tok);
    assert.equal(c.length, 6);
    assert.equal(c[JOB_CODE.running], mixColor(tok.skill, tok.skill, 0));
    assert.equal(c[JOB_CODE.done], mixColor(tok.ok, tok.ok, 0));
    assert.equal(c[JOB_CODE.failed], mixColor(tok.error, tok.error, 0));
    const st = c[JOB_CODE.stale];
    assert.ok(dist(st, tok.skill) > 25 && dist(st, tok.error) > 25, '정체는 진행·실패와 다른 색(테두리 점선·맥박이 더 가른다)');
    assert.ok(Math.abs(dist(st, tok.skill) + dist(st, tok.error) - dist(tok.skill, tok.error)) < 3, '정체는 호박 → 빨강 사이');
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) assert.ok(dist(c[i], c[j]) > 25, `${tok.isLight ? 'light' : 'dark'} ${i}≠${j}`);
    // 대기·줄 섬은 흐림(배경 쪽으로 섞임)
    assert.ok(dist(c[JOB_CODE.waiting], tok.bg) < dist(tok['flow-call'], tok.bg));
    assert.ok(dist(c[JOB_CODE.queued], tok.bg) < dist(tok.muted, tok.bg));
  }
  assert.ok(JOB_ALPHA[JOB_CODE.queued] < 1 && JOB_ALPHA[JOB_CODE.waiting] < 1 && JOB_ALPHA[JOB_CODE.done] < 1, '줄 섬·대기·끝은 흐리게');
  assert.equal(JOB_ALPHA[JOB_CODE.running], 1);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(jobAnim), [0, 1, 0, 0, 0, 1], '움직이는 것은 진행·정체뿐(끝·실패는 차분)');
});

test('크기: 작업 칩은 백그라운드 명령 칩보다 작다(흐름 알약·Planet 위성)', () => {
  assert.ok(JOB2D.R_K < 1 && JOB2D.PLANET_R_K < 1);
  const bg = 10; // 백그라운드 명령 육각 반지름 px
  const p = jobPill(bg * JOB2D.R_K);
  const hexArea = (3 * Math.sqrt(3) / 2) * bg * bg;
  const pillArea = p.w * p.h - (4 - Math.PI) * p.rad * p.rad;
  assert.ok(pillArea < hexArea * 0.5, '알약 넓이 < 육각 넓이의 절반');
  assert.ok(p.h < bg, '알약 높이 < 육각 반지름');
  assert.ok(p.w < 2 * bg, '알약 폭 < 육각 꼭짓점 사이');
  assert.ok(p.w - p.h * 1.4 > p.h, '진행 막대 자리 > 알약 높이(막대가 읽히게)');
  assert.equal(p.rad, p.h / 2, '양끝 둥근 알약');
  const o = {}; assert.equal(jobPill(4, o), o, 'out 재사용');
  assert.ok(RADIUS['bash-bg'] * JOB2D.PLANET_R_K < RADIUS['bash-bg'] * 0.6);
  // Planet 궤도 흔적: 가까우면 반각 상한, 멀면 호 길이(px) 상한
  assert.equal(jobOrbitArc(20), JOB2D.ORBIT_ARC);
  assert.ok(Math.abs(jobOrbitArc(1000) * 1000 - JOB2D.ORBIT_ARC_PX) < 1e-9);
  assert.equal(jobOrbitArc(0), 0);
});

test('대기 고리: 대기 시작 → 재확인 시각으로 차오름 · 지나면 가득 · 시각 없으면 -1', () => {
  const from = T0, until = T0 + 10 * 60000;
  assert.equal(jobWaitFill(from, from, until), 0);
  assert.equal(jobWaitFill(T0 + 5 * 60000, from, until), 0.5);
  assert.equal(jobWaitFill(until + 1e6, from, until), 1);
  assert.equal(jobWaitFill(from - 1e6, from, until), 0, '재생 되감기(시계가 앞) → 0');
  let prev = -1;
  for (let m = 0; m <= 10; m++) { const f = jobWaitFill(T0 + m * 60000, from, until); assert.ok(f >= prev); prev = f; }
  assert.equal(jobWaitFill(T0, from, NaN), -1);
  assert.ok(jobWaitFill(until - 30000, NaN, until) > 0, '시작 모름 → 1분 창');
});

test('정체 맥박: 느린 박동 · 셋에 하나는 빠짐(끊긴 맥박) · 동작 줄이기면 고정 · 심박 선도 같은 박자', () => {
  const P = JOB2D.STALE_PERIOD;
  assert.ok(P >= 2, '느린 깜빡임');
  const peak = (k) => { let m = 0; for (let i = 0; i < 100; i++) m = Math.max(m, jobStalePulse((k + i / 100) * P, 0)); return m; };
  assert.ok(peak(0) > 0.95 && peak(1) > 0.95, '박동');
  assert.ok(peak(2) <= 0.35 + 1e-9, '세 번째 박동은 빠짐');
  for (let i = 0; i < 300; i++) { const v = jobStalePulse(i * 0.037, 0.3); assert.ok(v >= 0.35 - 1e-9 && v <= 1 + 1e-9); }
  assert.equal(jobStalePulse(1.23, 0, true), jobStalePulse(9.87, 0.5, true));
  // 심박 선: 박동 주기엔 어딘가 1 근처 뾰족, 빠진 주기엔 평선
  const line = (t) => { let mx = 0, mn = 0; for (let i = 0; i <= 200; i++) { const y = jobBeatY(i / 200, t); mx = Math.max(mx, y); mn = Math.min(mn, y); } return [mx, mn]; };
  const [mx, mn] = line(0.4 * P);
  assert.ok(mx > 0.9 && mn < -0.2, '뾰족 + 아래 꺾임');
  assert.deepEqual(line(2.4 * P), [0, 0], '빠진 박동 = 평선');
});

test('진행 비율을 모를 때 왕복 토막은 막대 안 · 재사용 배열', () => {
  const o = [0, 0];
  for (let i = 0; i < 200; i++) { const m = jobMarquee(i * 0.05, 0.2, o); assert.equal(m, o); assert.ok(m[0] >= 0 && m[1] <= 1 + 1e-9 && m[1] - m[0] > 0.29); }
});

test('표시 상태 캐시: view.clock(재생 가상 시계)로 정체 판정 · CODE_S 마다만 다시 잼 · 대기 시작 기준 · jobLevel 움직임 등급', () => {
  let clockMs = T0;
  const view = { clock: () => clockMs, reduced: false, tokens: DARK, vis: new Map(), dirty: false };
  const mk = (id, job) => ({ id, node: { id, kind: 'bash-bg', meta: { job: { v: 1, id, ...job } } }, seed: 0.1 });
  const run = mk('j:b:x:run', { state: 'running', beatAt: iso(0), progress: { n: 3, total: 4 } });
  const wait = mk('j:b:x:wait', { state: 'waiting', beatAt: iso(0), until: iso(10) });
  const done = mk('j:b:x:done', { state: 'done', rc: 0, beatAt: iso(0) });
  for (const v of [run, wait, done]) view.vis.set(v.id, v);
  assert.ok(isJobVis(run) && !isJobVis({ node: { meta: {} } }));
  assert.equal(jobLevel(view, 100), 1, '진행 = 배경 움직임');
  assert.equal(run._js.code, JOB_CODE.running);
  assert.equal(run._js.p, 0.75);
  assert.equal(wait._js.code, JOB_CODE.waiting);
  assert.equal(wait._js.wait, 0);
  assert.equal(done._js.code, JOB_CODE.done);
  assert.equal(view.dirty, true, '처음 상태 → 다시 그림');
  // 가상 시계를 박동 문턱(600초) 넘게 → 진행 작업이 정체로. 실제 시각(Date.now)과 무관
  clockMs = T0 + 11 * 60000;
  view.dirty = false;
  jobLevel(view, 100.1);
  assert.equal(run._js.code, JOB_CODE.running, 'CODE_S 안에서는 다시 재지 않음');
  jobLevel(view, 100.1 + JOB2D.CODE_S);
  assert.equal(run._js.code, JOB_CODE.stale, '렌더러 시계로 정체');
  assert.equal(view.dirty, true, '상태가 바뀌면 다시 그림');
  assert.equal(wait._js.wait, 1, '재확인 시각 지남 → 가득');
  assert.equal(done._js.code, JOB_CODE.done, '끝난 작업은 정체가 아님');
  // 작업 내용이 바뀌면(새 meta.job) 곧바로 다시 잼
  run.node.meta.job = { ...run.node.meta.job, beatAt: iso(11), progress: { ratio: 0.2 } };
  syncJob(view, run, 100.2 + JOB2D.CODE_S);
  assert.equal(run._js.code, JOB_CODE.running);
  assert.equal(run._js.p, 0.2);
  // 끝·대기만 남으면 움직임 없음(대기 고리는 1초마다 dirty 만)
  view.vis.delete(run.id);
  wait.node.meta.job = { ...wait.node.meta.job, until: iso(30) }; // 새 재확인 시각 → 대기 기준 다시
  view.dirty = false; view._jobWaitAt = 0;
  assert.equal(jobLevel(view, 200), 0);
  assert.ok(wait._js.wait > 0 && wait._js.wait < 1);
  assert.equal(view.dirty, true, '대기 고리 차오름 → 1초마다 다시 그림');
  view.dirty = false;
  jobLevel(view, 200.3);
  assert.equal(view.dirty, false, '1초 안에는 다시 그리지 않음');
  // 동작 줄이기: 움직임 등급 0
  view.reduced = true;
  view.vis.set(run.id, run);
  assert.equal(jobLevel(view, 300), 0);
});
