// 실시간 일시정지: 쌓기·상한·재연결 스냅샷·재개 계획·스냅샷 뒤 이벤트·Space 판정
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PauseBuffer, eventsAfter, spaceForPause, clockText } from '../live-pause.mjs';

test('정지 전엔 쌓지 않고, 정지 중엔 쌓으며 개수·기준 시각 문구', () => {
  const b = new PauseBuffer(3);
  assert.equal(b.push({ seq: 1 }), false);
  const t = new Date(2026, 9, 23, 14, 3, 22).getTime();
  b.pause(t);
  assert.equal(b.push({ seq: 2 }), true);
  assert.equal(b.label(), '일시정지 · 14:03:22 기준 · 밀린 이벤트 1');
  assert.equal(clockText(t), '14:03:22');
  assert.equal(b.shortLabel(), '정지 14:03:22 · +1');
});

test('상한을 넘으면 버리고 넘침 표시 → 재개 때 다시 받기', () => {
  const b = new PauseBuffer(2);
  b.pause(0);
  for (let i = 1; i <= 5; i++) b.push({ seq: i });
  assert.equal(b.events.length, 2);
  assert.equal(b.count, 5);
  assert.equal(b.overflow, true);
  assert.match(b.label(), /넘침/);
  assert.equal(b.plan({ live: false }).needState, true);
});

test('재연결 스냅샷이 오면 쌓은 것은 버림, 라이브 재개는 늘 스냅샷', () => {
  const b = new PauseBuffer();
  b.pause(0); b.push({ seq: 1 }); b.sawSnapshot();
  assert.equal(b.events.length, 0);
  assert.equal(b.plan({ live: false }).needState, true);
  const c = new PauseBuffer(); c.pause(0); c.push({ seq: 1 }); c.projects = { projects: [] };
  assert.deepEqual(c.plan({ live: false }), { needState: false, events: [{ seq: 1 }], projects: { projects: [] }, overflow: false });
  assert.equal(c.plan({ live: true }).needState, true);
  c.clear();
  assert.equal(c.paused, false); assert.equal(c.label(), '');
});

test('스냅샷 seq 뒤 이벤트만 따라잡기(seq 없는 합성 이벤트는 포함)', () => {
  assert.deepEqual(eventsAfter([{ seq: 4 }, { seq: 5 }, { seq: 7 }, { type: 'x' }], 5), [{ seq: 7 }, { type: 'x' }]);
});

test('Space: 재생 중·입력칸·조합키면 이 버튼이 받지 않음', () => {
  assert.equal(spaceForPause({ tag: 'CANVAS' }), true);
  assert.equal(spaceForPause({ tag: 'BUTTON' }), true);
  assert.equal(spaceForPause({ replaying: true, tag: 'CANVAS' }), false);
  assert.equal(spaceForPause({ tag: 'INPUT' }), false);
  assert.equal(spaceForPause({ tag: 'select' }), false);
  assert.equal(spaceForPause({ tag: 'DIV', editable: true }), false);
  assert.equal(spaceForPause({ tag: 'CANVAS', mods: true }), false);
});
