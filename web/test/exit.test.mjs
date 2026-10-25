// 퇴장 연출: 정책·모습·입자 경로·연결선 감기·홀로그램 접힘·자동 카메라 재맞춤 대기
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXIT, exitPolicy, exitPose, particlePos, particleFade, scatterDir, retractEnd, foldSlide, foldLine, easeInOut, particleLife } from '../exit-core.mjs';
import { HOLO, HoloBook, holoPhase } from '../holo-core.mjs';
import { FitHold } from '../camera-core.mjs';

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test('exitPolicy: 1～1.4초 기본, 배속이면 줄이고 16배속·조용하면 생략', () => {
  const p = exitPolicy(1);
  assert.ok(p.dur >= 1.0 && p.dur <= 1.4 && p.particles);
  assert.ok(exitPolicy(4).dur < p.dur && exitPolicy(4).particles);
  const b = exitPolicy(8);
  assert.ok(b.dur <= 0.4 && b.particles === false);
  assert.equal(exitPolicy(16), null);
  assert.equal(exitPolicy(64), null);
  assert.equal(exitPolicy(1, true), null);
  assert.ok(exitPolicy(undefined).dur === EXIT.DUR);
});

test('exitPose: 처음은 그대로, 끝은 빛 0·작게·선 다 감김, 단조롭게 부드럽게', () => {
  const a = exitPose(0), z = exitPose(1);
  assert.ok(near(a.fade, 1) && near(a.scale, 1) && near(a.link, 0) && !a.burst);
  assert.ok(near(z.fade, 0) && near(z.scale, EXIT.MIN_SCALE) && near(z.link, 1) && z.burst);
  let prev = exitPose(0);
  for (let i = 1; i <= 50; i++) {
    const p = exitPose(i / 50, {});
    assert.ok(p.fade <= prev.fade + 1e-9 && p.scale <= prev.scale + 1e-9 && p.link >= prev.link - 1e-9);
    prev = p;
  }
  assert.equal(exitPose(EXIT.BURST_AT - 0.01).burst, false);
  assert.equal(exitPose(EXIT.BURST_AT).burst, true);
  // ease-in-out: 시작·끝 기울기 작고 가운데 큼
  assert.ok(easeInOut(0.05) < 0.01 && easeInOut(0.5) === 0.5 && easeInOut(0.95) > 0.99);
});

test('입자: 노드에서 퍼졌다가 부모 위치로 빨려 들어감, 끝은 옅게', () => {
  const s = { x: 0, y: 0, z: 0 }, p = { x: 10, y: 0, z: 0 }, d = scatterDir({}, 3, 14, 0.4);
  assert.ok(near(Math.hypot(d.x, d.y, d.z), 1));
  const o = {};
  particlePos(o, 0, s, d, 2, p);
  assert.ok(near(o.x, 0) && near(o.y, 0) && near(o.z, 0));
  particlePos(o, 0.3, s, d, 2, p);
  const mid = Math.hypot(o.x - s.x, o.y - s.y, o.z - s.z);
  assert.ok(mid > 1, '퍼짐');
  particlePos(o, 1, s, d, 2, p);
  assert.ok(near(o.x, 10) && near(o.y, 0) && near(o.z, 0), '부모에 닿음');
  particlePos(o, 1, s, d, 2, null);
  assert.ok(near(o.x, 0), '부모가 없으면 제자리로 모여 사라짐');
  assert.ok(particleFade(0) === 0 && particleFade(0.2) > 0.5 && near(particleFade(1), 0));
  assert.ok(particleLife(EXIT.DUR) > particleLife(EXIT.BRIEF_DUR) && particleLife(0.01) >= 0.35);
  // 방향은 결정적
  assert.deepEqual(scatterDir({}, 5, 14, 0.2), scatterDir({}, 5, 14, 0.2));
});

test('연결선: 자식 끝부터 부모 쪽으로 감김', () => {
  const a = { x: 0, y: 0, z: 0 }, b = { x: 8, y: 2, z: -4 }, o = {};
  retractEnd(o, a, b, 0); assert.deepEqual(o, { x: 8, y: 2, z: -4 });
  retractEnd(o, a, b, 0.5); assert.deepEqual(o, { x: 4, y: 1, z: -2 });
  retractEnd(o, a, b, 1); assert.deepEqual(o, { x: 0, y: 0, z: 0 });
});

test('홀로그램 접힘: 나올 때의 역순 — 노드 쪽으로 미끄러져 들어가며 스캔라인처럼 닫힘', () => {
  assert.ok(near(foldSlide(0), 1) && foldSlide(1) < 0.2 && foldSlide(0.5) < foldSlide(0.2));
  assert.ok(foldLine(0) === 0 && foldLine(0.4) > 0.9 && foldLine(1) < 0.01);
  // holoPhase 접힘 단계는 진행률 fk 를 준다
  const ph = holoPhase(4.15, 1, 0.5, 4.0);
  assert.equal(ph.phase, 'fold');
  assert.ok(ph.fk > 0 && ph.fk < 1);
});

test('HoloBook.foldNode: 대기 항목은 버리고 보이는 패널은 지금 접기 시작, 열린 도구는 중지 회색', () => {
  const b = new HoloBook({ perNode: 1 });
  b.start('n', { toolUseId: 't1', cat: 'shell' }, 0);
  b.start('n', { toolUseId: 't2', cat: 'read' }, 0); // 노드당 1 → 대기
  assert.equal(b.queued('n'), 1);
  b.foldNode('n', 3);
  assert.equal(b.queued('n'), 0);
  const e = b.list('n')[0];
  assert.equal(e.res, 'stopped');
  assert.equal(b.phaseOf(e, 3.01).phase, 'fold', '섬광 없이 바로 접힘');
  assert.equal(b.phaseOf(e, 3 + HOLO.FOLD + 0.01).phase, 'gone');
  b.step(3 + HOLO.FOLD + 0.02);
  assert.equal(b.list('n').length, 0);
  assert.equal(b.shown, 0);
  b.foldNode('없음', 1); // 없는 노드도 죽지 않음
});

test('FitHold: 퇴장 연출 중엔 줄이거나 옮기지 않고(넘치면 예외), 끝난 첫 걸음에서 한 번만 바로 다시 맞춤', () => {
  const h = new FitHold({ grow: 1.0, shrink: 0.72, shift: 0.22, hold: 2.5, headroom: 1.1 }); // 예전 값으로 규칙만 시험(기본은 더 꽉)
  const W = (D, x = 0) => ({ c: { x, y: 0, z: 0 }, D });
  h.step(0, W(100), Infinity);
  assert.ok(near(h.D, 110));
  const n0 = h.changes;
  // 연출 중: 필요한 거리가 크게 줄어도 그대로(2.5초가 지나도)
  for (let t = 0.1; t < 5; t += 0.1) h.step(t, W(40), 40, 0, Infinity, { freeze: true });
  assert.equal(h.changes, n0);
  assert.ok(near(h.D, 110));
  // 연출 중이라도 넘치면 바로 키움
  h.step(5.1, W(130), 130, 0, Infinity, { freeze: true });
  assert.equal(h.changes, n0 + 1);
  const n1 = h.changes;
  for (let t = 5.2; t < 6; t += 0.1) h.step(t, W(40), 40, 0, Infinity, { freeze: true });
  assert.equal(h.changes, n1);
  // 끝남: 기다림(hold) 없이 한 번
  h.step(6.0, W(40), 40);
  assert.equal(h.changes, n1 + 1);
  assert.ok(near(h.D, 44));
  // 그 뒤로는 평소 규칙(작은 변화 무시)
  h.step(6.1, W(38), 38); h.step(6.2, W(38), 38);
  assert.equal(h.changes, n1 + 1);
  // 연출 중 느슨하지 않았으면 끝나도 움직이지 않음
  const g = new FitHold();
  g.step(0, W(100), Infinity);
  const m0 = g.changes;
  g.step(1, W(98), 98, 0, Infinity, { freeze: true });
  g.step(2, W(98), 98);
  assert.equal(g.changes, m0);
});

test('FitHold: 퇴장이 끊이지 않고 이어지면 maxFreeze 뒤 평소 규칙으로', () => {
  const h = new FitHold({ maxFreeze: 6 });
  const W = (D) => ({ c: { x: 0, y: 0, z: 0 }, D });
  h.step(0, W(100), Infinity);
  const n0 = h.changes;
  for (let t = 0.1; t < 6; t += 0.1) h.step(t, W(40), 40, 0, Infinity, { freeze: true });
  assert.equal(h.changes, n0);
  for (let t = 6; t < 9.5; t += 0.1) h.step(t, W(40), 40, 0, Infinity, { freeze: true });
  assert.equal(h.changes, n0 + 1, '6초 넘게 이어지면 hold(2.5초) 뒤 줄임');
});
