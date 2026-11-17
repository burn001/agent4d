// Interactive 최근 메시지로 가기 단추: 스크롤 상태 판정(맨 아래인가) · 새 메시지 수 · 배지 글자 · 사전 키
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atBottom, lastMsgTs, unseenCount, badgeText, BOTTOM_PX } from '../interact-core.mjs';
import ix from '../i18n/ix.mjs';

test('맨 아래 판정: 40px 안이면 맨 아래, 내용이 칸보다 짧으면 늘 맨 아래', () => {
  assert.equal(BOTTOM_PX, 40);
  assert.equal(atBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 }), true);
  assert.equal(atBottom({ scrollTop: 561, scrollHeight: 1000, clientHeight: 400 }), true);
  assert.equal(atBottom({ scrollTop: 560, scrollHeight: 1000, clientHeight: 400 }), false);
  assert.equal(atBottom({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 }), false);
  assert.equal(atBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 }), true);
  assert.equal(atBottom({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 }), true); // 숨은 칸
  assert.equal(atBottom(null), true);
  assert.equal(atBottom({ scrollTop: 500, scrollHeight: 1000, clientHeight: 400 }, 120), true);
});

test('새 메시지 수: 기준 시각 뒤 메시지만, 도구 줄·알림 묶음은 세지 않음, 앞에 붙인 이전 대화도 세지 않음', () => {
  const rows = [
    { k: 'user', ts: 100 }, { k: 'tool', ts: 110 }, { k: 'assistant', ts: 120 },
    { k: 'sys', ts: 130 }, { k: 'mine', at: 140 }, { k: 'ask', ts: 150 }, { k: 'peer', ts: 160 }, { k: 'assistant' },
  ];
  assert.equal(lastMsgTs(rows), 160);
  assert.equal(lastMsgTs([]), 0);
  assert.equal(lastMsgTs([{ k: 'tool', ts: 999 }]), 0);
  assert.equal(unseenCount(rows, 120), 3); // mine·ask·peer
  assert.equal(unseenCount(rows, 160), 0);
  const older = [{ k: 'user', ts: 10 }, { k: 'assistant', ts: 20 }];
  assert.equal(unseenCount([...older, ...rows], 160), 0); // 더 보기로 앞에 붙은 줄
  assert.equal(unseenCount(rows, 0), 5); // 시각 없는 줄은 세지 않음
});

test('배지 글자: 0 은 빈 글, 99 넘으면 99+', () => {
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(3), '3');
  assert.equal(badgeText(99), '99');
  assert.equal(badgeText(100), '99+');
});

test('사전: 단추 이름(한·영)과 개수 자리', () => {
  for (const L of ['en', 'ko']) {
    for (const k of ['ix.latest', 'ix.latest.n', 'ix.latest.short']) assert.ok(ix[L][k], `${L} ${k}`);
    assert.ok(ix[L]['ix.latest.n'].includes('{n}'));
  }
});
