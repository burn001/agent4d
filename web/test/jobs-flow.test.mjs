// 흐름(Flow) 3D 작업 칩 — 순수 규칙(job-chip-core) 시험. 합성 작업만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _setLangForTest } from '../i18n.mjs';
import { JOB_CODE, jobCode } from '../job-core.mjs';
import { JOB_CHIP, jobChipColor, jobChipModel, newJobChipMemo, jobWaitFill, jobChipAttr, chipFlagOf, jobBeamStyle, jobBreathes } from '../flowview/job-chip-core.mjs';
import { paletteOf } from '../flowview/flow-style.mjs';

_setLangForTest('ko');
const T0 = Date.parse('2026-10-25T12:00:00Z');
const iso = (min) => new Date(T0 + min * 60000).toISOString();

test('작업 칩 색: 표시 상태 번호마다 다르고, 진행 = 호박(배치 장치 진행 막대와 같은 tool) · 끝 = done · 실패 = error · 다크/라이트 따로', () => {
  for (const light of [false, true]) {
    const P = paletteOf(light);
    assert.equal(jobChipColor(JOB_CODE.running, light), P.tool);
    assert.equal(jobChipColor(JOB_CODE.done, light), P.done);
    assert.equal(jobChipColor(JOB_CODE.failed, light), P.error);
    const all = Object.values(JOB_CODE).map((c) => jobChipColor(c, light));
    assert.equal(new Set(all).size, all.length, '여섯 상태 색이 모두 다름');
    for (const c of all) assert.match(c, /^#[0-9a-f]{6}$/i);
    assert.equal(jobChipColor(99, light), P.tool, '모르는 번호는 진행');
  }
  assert.notEqual(jobChipColor(JOB_CODE.stale, true), jobChipColor(JOB_CODE.stale, false));
});

test('크기·두께·흐림: 백그라운드 명령 칩보다 작고 얇다 · 줄 섬/대기/끝은 흐리고 진행·정체는 또렷 · 숨쉬기는 진행만', () => {
  assert.ok(JOB_CHIP.SCALE > 0.3 && JOB_CHIP.SCALE < 1);
  assert.ok(JOB_CHIP.THICK < 0.85, '백그라운드 명령(0.85)보다 얇음');
  const A = JOB_CHIP.ALPHA;
  assert.equal(A.length, 6); assert.equal(JOB_CHIP.GLOW.length, 6);
  assert.equal(A[JOB_CODE.running], 1); assert.equal(A[JOB_CODE.stale], 1);
  for (const c of [JOB_CODE.queued, JOB_CODE.waiting, JOB_CODE.done, JOB_CODE.failed]) assert.ok(A[c] < 1, String(c));
  assert.ok(JOB_CHIP.GLOW[JOB_CODE.done] < JOB_CHIP.GLOW[JOB_CODE.running]);
  assert.equal(jobBreathes(JOB_CODE.running), true);
  for (const c of [JOB_CODE.stale, JOB_CODE.waiting, JOB_CODE.done, JOB_CODE.failed, JOB_CODE.queued]) assert.equal(jobBreathes(c), false);
});

test('칩 모델: 표시 상태는 렌더러 시계(정체가 이김) · 진행은 끝나지 않았을 때만 · 보관 간격 안엔 다시 계산 안 함 · 되감기면 다시', () => {
  const job = { state: 'running', beatAt: iso(0), progress: { n: 10, total: 40 } };
  const m = newJobChipMemo();
  jobChipModel(m, job, T0 + 1000);
  assert.equal(m.code, JOB_CODE.running); assert.equal(m.prog, 0.25);
  // 같은 객체 · 간격 안: 그대로(정체 문턱을 넘긴 시각이어도 아직 갱신 안 함)
  const late = T0 + 11 * 60000;
  jobChipModel(m, job, T0 + 1000 + JOB_CHIP.REFRESH_MS - 1);
  assert.equal(m.code, JOB_CODE.running);
  jobChipModel(m, job, late);
  assert.equal(m.code, JOB_CODE.stale, '박동 600초 넘게 끊김 → 정체');
  assert.equal(m.code, jobCode(job, late));
  assert.equal(m.prog, 0.25, '정체여도 진행 호는 남김');
  // 되감기(재생 가상 시계): 다시 진행
  jobChipModel(m, job, T0 + 2000);
  assert.equal(m.code, JOB_CODE.running);
  // meta.job 이 새 객체면 간격 안이어도 바로
  jobChipModel(m, { ...job, state: 'done', rc: 0 }, T0 + 2001);
  assert.equal(m.code, JOB_CODE.done); assert.equal(m.prog, -1, '끝은 차분하게 — 진행 호 없음');
  jobChipModel(m, { state: 'failed', rc: 4, progress: { n: 40, total: 40 } }, T0 + 2002);
  assert.equal(m.code, JOB_CODE.failed); assert.equal(m.prog, -1);
  jobChipModel(m, { state: 'running', beatAt: iso(0), progress: { ratio: 0.5 }, stale: true }, T0 + 2003);
  assert.equal(m.code, JOB_CODE.stale, '명시 정체'); assert.equal(m.prog, 0.5);
  jobChipModel(m, { state: 'queued', beatAt: iso(0) }, T0 + 2004);
  assert.equal(m.code, JOB_CODE.queued); assert.equal(m.prog, -1);
});

test('대기 차오름: until 이 바뀐 때(그 대기 줄 박동)부터 until 까지 0 → 1 · until 없으면 -1 · 같은 until 이면 시작 그대로 · 대기 아니면 -1', () => {
  const m = newJobChipMemo();
  const w = { state: 'waiting', beatAt: iso(0), until: iso(20) };
  jobChipModel(m, w, T0);
  assert.equal(m.fromMs, T0);
  assert.equal(jobWaitFill(m, T0), 0);
  assert.equal(jobWaitFill(m, T0 + 10 * 60000), 0.5);
  assert.equal(jobWaitFill(m, T0 + 30 * 60000), 1, '넘어서면 가득');
  // 박동만 바뀐 새 객체(같은 until): 시작은 그대로 — 차오름이 줄지 않는다
  jobChipModel(m, { ...w, beatAt: iso(8) }, T0 + 8 * 60000);
  assert.equal(m.fromMs, T0);
  assert.equal(jobWaitFill(m, T0 + 10 * 60000), 0.5);
  // until 이 바뀜: 그 줄 박동부터 다시
  jobChipModel(m, { ...w, beatAt: iso(10), until: iso(30) }, T0 + 10 * 60000);
  assert.equal(m.fromMs, T0 + 10 * 60000);
  assert.equal(jobWaitFill(m, T0 + 20 * 60000), 0.5);
  // until 없는 대기 · 진행 중
  const m2 = newJobChipMemo();
  jobChipModel(m2, { state: 'waiting', beatAt: iso(0) }, T0);
  assert.equal(m2.code, JOB_CODE.waiting); assert.equal(jobWaitFill(m2, T0), -1);
  jobChipModel(m2, { state: 'running', beatAt: iso(0) }, T0 + 1);
  assert.equal(jobWaitFill(m2, T0 + 1), -1);
  // 시작 시각을 모르면(박동 없음 → 지금) · 대기 시작이 until 뒤면 until − WAIT_SPAN_MS 부터
  const m3 = newJobChipMemo();
  jobChipModel(m3, { state: 'waiting', until: iso(5) }, T0 + 10 * 60000);
  const f = jobWaitFill(m3, T0 + 10 * 60000);
  assert.equal(f, 1);
  m3.fromMs = NaN;
  assert.ok(Math.abs(jobWaitFill(m3, T0 + 5 * 60000 - JOB_CHIP.WAIT_SPAN_MS / 2) - 0.5) < 1e-9);
  // 정체한 대기는 대기 고리 없음(정체 표시가 이김)
  const m4 = newJobChipMemo();
  jobChipModel(m4, { state: 'waiting', beatAt: iso(0), until: iso(5), stale: true }, T0);
  assert.equal(m4.code, JOB_CODE.stale); assert.equal(jobWaitFill(m4, T0), -1);
});

test('셰이더 속성 iC: (FLAG 2, 상태 번호, 진행, 대기) · FLAG 는 보간 오차가 있어도 반올림으로 같은 값(§80.3)', () => {
  const m = newJobChipMemo();
  jobChipModel(m, { state: 'waiting', beatAt: iso(0), until: iso(20), progress: { n: 3, total: 4 } }, T0);
  const out = new Float32Array(8);
  jobChipAttr(out, 4, m, T0 + 5 * 60000);
  assert.deepEqual([...out.slice(0, 4)], [0, 0, 0, 0], '자기 자리만 씀');
  assert.equal(out[4], JOB_CHIP.FLAG); assert.equal(out[5], JOB_CODE.waiting); assert.equal(out[6], 0.75); assert.equal(out[7], 0.25);
  for (const e of [-0.0001, 0.0001, -0.3, 0.3]) {
    assert.equal(chipFlagOf(JOB_CHIP.FLAG + e), 2);
    assert.equal(chipFlagOf(1 + e), 1, '배치 장치');
    assert.equal(chipFlagOf(0 + e), 0, '보통 칩');
    assert.equal(chipFlagOf(JOB_CODE.stale + e), 5);
  }
});

test('주인 → 작업 빔: 은은하게(옅고 가늘게) · 진행만 흐름 · 정체·끝·실패는 멈춤', () => {
  for (const c of Object.values(JOB_CODE)) {
    const s = jobBeamStyle(c);
    assert.ok(s.alphaK > 0 && s.alphaK < 1, String(c));
    assert.ok(s.widthK > 0 && s.widthK < 1, String(c));
  }
  assert.ok(jobBeamStyle(JOB_CODE.running).dash && jobBeamStyle(JOB_CODE.running).dash.speed > 0);
  for (const c of [JOB_CODE.stale, JOB_CODE.done, JOB_CODE.failed, JOB_CODE.queued]) assert.equal(jobBeamStyle(c).dash, null, String(c));
  assert.ok(jobBeamStyle(JOB_CODE.done).alphaK < jobBeamStyle(JOB_CODE.running).alphaK);
});
