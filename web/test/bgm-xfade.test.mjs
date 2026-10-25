// node --test "web/test/bgm-xfade.test.mjs"   배경음악 크로스페이드: 등전력 곡선·전환 일정·마디 경계·이어받기·예약 점
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { XFADE, END_LEAD, eqPow, eqPhase, barLength, barWait, planXfade, shouldLeadEnd, Lane, takeover } from '../bgm-xfade.mjs';

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≈ ${b}`);

test('등전력 곡선: 끝점·역함수·나가는(cos)+들어오는(sin) 세기 합 1', () => {
  near(eqPow(0), 0); near(eqPow(1), 1); near(eqPow(0.5), Math.SQRT1_2);
  for (let k = 0; k <= 10; k++) {
    const p = k / 10;
    near(eqPhase(eqPow(p)), p, 1e-9);
    near(eqPow(p) ** 2 + eqPow(1 - p) ** 2, 1, 1e-9, `p=${p}`);
  }
  near(eqPow(-1), 0); near(eqPow(2), 1);
});

test('마디: 길이·다음 경계까지 대기(최대 1마디, bpm 없으면 0)', () => {
  near(barLength(96), 2.5); near(barLength(84), 240 / 84); near(barLength(120, 3), 1.5);
  assert.equal(barLength(null), null); assert.equal(barLength(0), null); assert.equal(barLength(NaN), null);
  near(barWait(0, 96), 0); near(barWait(1, 96), 1.5); near(barWait(2.48, 96), 0, 1e-9, '경계 직전(< tol)');
  near(barWait(2.51, 96), 0, 1e-9, '경계 직후'); near(barWait(103.0, 96), 2.0);
  assert.equal(barWait(10, null), 0); assert.equal(barWait(NaN, 96), 0);
  for (const bpm of [80, 84, 96, 104]) for (let pos = 0; pos < 30; pos += 0.37) {
    const w = barWait(pos, bpm);
    assert.ok(w >= 0 && w < barLength(bpm), `${bpm} ${pos} → ${w}`);
    if (w > 0) { const k = (pos + w) / barLength(bpm); near(k, Math.round(k), 1e-9, '경계에 떨어짐'); }
  }
});

test('전환 일정: 자동 4.5+4.5 겹침 3초·마디 맞춤, 수동 1.5초, 곡 끝 3초(남은 시간에 맞춤)', () => {
  const a = planXfade('auto', { pos: 1, bpm: 96 });
  assert.deepEqual({ out: a.out, in: a.in, delay: a.delay }, { out: 4.5, in: 4.5, delay: 1.5 });
  near(a.overlap, 3); near(a.wait, 1.5);
  assert.equal(planXfade('auto', { pos: 1, bpm: null }).wait, 0, 'bpm 없으면 맞춤 생략');
  const m = planXfade('manual', { pos: 1, bpm: 96 });
  assert.deepEqual({ out: m.out, in: m.in, delay: m.delay, wait: m.wait }, { out: 1.5, in: 1.5, delay: 0, wait: 0 });
  near(m.overlap, 1.5);
  const e = planXfade('ended', { remaining: 2.6 });
  near(e.out, 2.6); near(e.in, 3); assert.equal(e.wait, 0);
  near(planXfade('ended', { remaining: 9 }).out, 3); near(planXfade('ended', { remaining: 0.1 }).out, 0.5);
  assert.equal(planXfade('???').kind, 'manual');
  assert.ok(XFADE.auto.out >= 4 && XFADE.auto.out <= 5 && XFADE.auto.in >= 4 && XFADE.auto.in <= 5);
});

test('곡 끝 미리 넘기기: 반복 없는 모드에서 끝 3초 전부터', () => {
  const base = { loop: false, mode: true, duration: 300 };
  assert.equal(shouldLeadEnd({ ...base, pos: 296.8 }), false);
  assert.equal(shouldLeadEnd({ ...base, pos: 297.0 }), true);
  assert.equal(shouldLeadEnd({ ...base, pos: 299.9 }), true);
  assert.equal(shouldLeadEnd({ ...base, loop: true, pos: 299 }), false, '곡 하나 반복은 loop');
  assert.equal(shouldLeadEnd({ ...base, mode: false, pos: 299 }), false);
  assert.equal(shouldLeadEnd({ ...base, duration: NaN, pos: 299 }), false, '길이 모름');
  assert.equal(END_LEAD, 3);
});

test('차선: 지금 값에서 이어받기(연속)·남은 거리 비례 시간·되돌리기', () => {
  const l = new Lane(1, 'eq');
  assert.equal(l.to(0, 4.5, 10), 4.5);
  assert.ok(l.busy(12));
  near(l.valueAt(10), 1); near(l.valueAt(14.5), 0); near(l.valueAt(12.25), Math.SQRT1_2);
  // 도중(위상 0.5)에서 다시 1로: 값이 그대로 이어지고 남은 위상 0.5 만큼만 걸림
  const before = l.valueAt(12.25);
  const d = l.to(1, 4.5, 12.25);
  near(d, 2.25); near(l.valueAt(12.25), before, 1e-12, '이어받은 순간 값 연속');
  near(l.valueAt(14.5), 1); assert.equal(l.busy(14.6), false);
  // 이미 목표면 바로 끝
  assert.equal(l.to(1, 3, 20), 0); assert.equal(l.busy(20), false);
  // 선형(버스)
  const m = new Lane(0, 'lin'); m.to(1, 2, 0); near(m.valueAt(0.5), 0.25); near(m.valueAt(2), 1);
  m.to(0, 0.6, 1); near(m.valueAt(1), 0.5); near(m.endTime, 1.3);
});

test('차선: 시계 바꾸기(rebase)·AudioParam 예약 점(첫 점 = 지금 값, 등전력 근사 오차 작음)', () => {
  const l = new Lane(0, 'eq'); l.to(1, 4, 100);
  const v = l.valueAt(101);
  l.rebase(101, 5); near(l.valueAt(5), v, 1e-12); near(l.endTime, 8);
  const pts = l.points(5, 0.05);
  near(pts[0][0], 5); near(pts[0][1], v, 1e-12);
  near(pts.at(-1)[0], 8); near(pts.at(-1)[1], 1);
  for (let k = 1; k < pts.length; k++) assert.ok(pts[k][0] > pts[k - 1][0] && pts[k][1] >= pts[k - 1][1]);
  // 꺾은선과 실제 곡선 차이
  let maxErr = 0;
  for (let k = 1; k < pts.length; k++) {
    const [t0, v0] = pts[k - 1], [t1, v1] = pts[k];
    const tm = (t0 + t1) / 2;
    maxErr = Math.max(maxErr, Math.abs((v0 + v1) / 2 - l.valueAt(tm)));
  }
  assert.ok(maxErr < 1e-3, `꺾은선 오차 ${maxErr}`);
  assert.equal(new Lane(1).points(0).length, 1, '쉬는 차선은 값 하나');
  const m = new Lane(0, 'lin'); m.to(1, 2, 0); assert.equal(m.points(0.5).length, 2);
});

test('자동 전환 겹침 곡선 시뮬레이션: 무음 틈 없음·세기 합 최소 −3dB 근처', () => {
  const P = planXfade('auto', { pos: 0, bpm: 96 });
  const a = new Lane(1), b = new Lane(0);
  a.to(0, P.out, 0);
  let minPow = 9, minSum = 9;
  for (let t = 0; t <= P.delay + P.in + 1e-9; t += 0.01) {
    if (t >= P.delay && !b.busy(t) && b.target === 0) b.to(1, P.in, P.delay);
    const va = a.valueAt(t), vb = b.valueAt(t);
    minPow = Math.min(minPow, va * va + vb * vb);
    minSum = Math.min(minSum, Math.max(va, vb));
  }
  assert.ok(minSum >= 0.5 - 1e-9, `어느 순간에도 한 덱은 0.5 이상(겹침 한가운데 두 덱 0.5): ${minSum}`);
  assert.ok(minPow >= 0.49, `세기 합 최소 ${minPow}`);
  // 수동(동시 시작)은 세기 합이 늘 1
  const c = new Lane(1), d = new Lane(0); c.to(0, 1.5, 0); d.to(1, 1.5, 0);
  for (let t = 0; t <= 1.5; t += 0.05) near(c.valueAt(t) ** 2 + d.valueAt(t) ** 2, 1, 1e-9);
});

test('전환 도중 새 요청: 같음·바꿔 걸기·되돌아가기·세 번째 곡', () => {
  assert.equal(takeover(null, 'x'), 'start');
  const xf = { fromId: 'a', toId: 'b', started: true };
  assert.equal(takeover(xf, 'b'), 'same');
  assert.equal(takeover(xf, 'a'), 'reverse');
  assert.equal(takeover(xf, 'c'), 'queue');
  assert.equal(takeover({ ...xf, started: false }, 'c'), 'retarget');
  assert.equal(takeover({ ...xf, started: false }, 'a'), 'retarget', '시작 전이면 나가던 곡도 바꿔 걸기로(되돌림 없음)');
});

test('audio.js 연결: 두 덱·등전력 차선·마디 맞춤·끝 미리 넘기기·필터 끼움·볼륨 노드', () => {
  const src = readFileSync(new URL('../audio.js', import.meta.url), 'utf8');
  assert.match(src, /from '\.\/bgm-xfade\.mjs'/);
  assert.match(src, /planXfade\(kind/);
  assert.match(src, /shouldLeadEnd\(/);
  assert.match(src, /cancelScheduledValues\(now\)/);
  assert.match(src, /linearRampToValueAtTime/);
  assert.match(src, /setInsert\(node\)/);
  assert.match(src, /kind: 'auto'/);
  assert.match(src, /kind: 'manual'/);
  assert.match(src, /kind: 'ended'/);
});
