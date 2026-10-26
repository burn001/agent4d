// '따라가기': 짧은 알림 턴이 끝나 쉬는 섬을 계속 비추지 않고, 수 초 안에 일하는 쪽(다른 프로젝트 러너 등)으로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workScore, busyAlt, scoreOf, QUIET, isFitActive } from '../camera-core.mjs';

const node = (status, open = 0) => ({ node: { status }, icons: new Set(Array.from({ length: open }, (_, i) => i)) });

test('고르기 점수: 쉬는 노드(열린 도구 없음·QUIET 초 넘게 조용·active 아님)는 20초 창에 이벤트가 많아도 0', () => {
  const now = 100, burst = Array.from({ length: 30 }, (_, i) => 90 + i * 0.1); // 10초 전 알림 턴(이벤트 30개)
  assert.equal(scoreOf(burst, 0, null, now), 30); // 예전 점수: 러너(열린 도구 1 = 2점)보다 높았다
  assert.equal(workScore(node('idle'), burst, null, burst[burst.length - 1], now), 0);
  assert.equal(workScore(node('idle', 1), [], null, 40, now), 2); // 계속 도는 러너(열린 도구)
  assert.equal(workScore(node('active'), burst, null, 92.9, now), 30); // 아직 일하는 메인은 그대로
  assert.equal(workScore(node('idle'), burst, null, now - QUIET + 0.5, now), 30); // 방금 이벤트(QUIET 안)
  assert.equal(workScore(undefined, [], null, null, now), 0);
});

test('넘어갈 대상: 같은 섬에 일하는 노드가 있으면 같은 섬, 섬이 통째로 쉬면 다른 섬', () => {
  const L = [{ id: 'w', pid: 'works', busy: false }, { id: 'm', pid: 'works', busy: false }, { id: 'r', pid: 'runner', busy: true }];
  assert.equal(busyAlt(L, 'w', 'works'), 'other');
  assert.equal(busyAlt(L.concat({ id: 'm2', pid: 'works', busy: true }), 'w', 'works'), 'same');
  assert.equal(busyAlt(L, null, 'works'), 'other'); // 섬 샷
  assert.equal(busyAlt(L.slice(0, 2), 'w', 'works'), null);
  assert.equal(busyAlt([{ id: 'w', pid: null, busy: true }], 'w', null), null); // 자기 자신은 빼고
  assert.equal(busyAlt(L, 'w', null), 'same'); // 단일 세션(섬 없음)
});

test('구도: 전체 — active → idle 이고 열린 도구가 없으면 바로 맞춤 대상에서 빠진다', () => {
  assert.equal(isFitActive(node('active')), true);
  assert.equal(isFitActive(node('idle'), 0), false);
  assert.equal(isFitActive(node('idle'), 1), true);
});
