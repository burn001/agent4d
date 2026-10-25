// 실황 패널: 최신이 맨 위, 시각 역순
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertIndexDesc, splitArrivals, atTop, keepAnchor, TOP_SLACK } from '../panel-order.mjs';

test('insertIndexDesc: 내림차순 자리, 같은 시각은 기존 줄 위', () => {
  const times = [50, 40, 30, 20];
  assert.equal(insertIndexDesc(times, 60), 0);
  assert.equal(insertIndexDesc(times, 10), 4);
  assert.equal(insertIndexDesc(times, 35), 2);
  assert.equal(insertIndexDesc(times, 30), 2);
  assert.equal(insertIndexDesc([], 5), 0);
});

test('splitArrivals: 도착 역순으로 맨 위, 2초 넘게 이른 기록은 끼워 넣기(시각 오름차순)', () => {
  const ts = [10000, 11000, 3000, 12000, 1000];
  const r = splitArrivals(ts, 9000);
  assert.deepEqual(r.top, [3, 1, 0]);          // 12000, 11000, 10000 (위→아래)
  assert.deepEqual(r.late, [4, 2]);            // 1000, 3000
  assert.equal(r.lastT, 12000);
  // 첫 묶음(lastT 0)·시각 없는 줄은 모두 맨 위
  assert.deepEqual(splitArrivals([0, 5, 0], 0).top, [2, 1, 0]);
});

/** panel.flush 와 같은 순서로 배열에 적용해 본다 */
function apply(display, ts, lastT) {
  const { top, late, lastT: l } = splitArrivals(ts, lastT);
  display = top.map((i) => ts[i]).concat(display);
  for (const i of late) display.splice(insertIndexDesc(display, ts[i]), 0, ts[i]);
  return { display, lastT: l };
}

test('여러 묶음 뒤에도 표시 순서가 시각 내림차순', () => {
  let s = { display: [], lastT: 0 };
  s = apply(s.display, [1000, 2000, 3000], s.lastT);
  s = apply(s.display, [9000, 4000, 10000], s.lastT);   // 4000 은 늦게 도착한 과거
  s = apply(s.display, [500, 11000], s.lastT);           // 500 은 맨 아래 쪽 자리
  assert.deepEqual(s.display, [11000, 10000, 9000, 4000, 3000, 2000, 1000, 500]);
});

test('맨 위 판정과 읽던 줄 고정 보정', () => {
  assert.equal(atTop(0), true);
  assert.equal(atTop(TOP_SLACK - 1), true);
  assert.equal(atTop(TOP_SLACK), false);
  // 기준 줄이 위에 붙은 줄 때문에 66px 내려가면 scrollTop 도 66 늘린다
  assert.equal(keepAnchor(300, 400, 466), 366);
  assert.equal(keepAnchor(10, 400, 300), 0);
});
