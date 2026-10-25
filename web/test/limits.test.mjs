// 한도 게이지 순수 함수 시험
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLimit, formatAge, formatRemain, levelOf, limitsView, pctText } from '../limits.js';

const NOW = Date.parse('2026-10-23T09:00:00Z');
const W = (pct, inSec, extra = {}) => ({ pct, resetsAt: new Date(NOW + inSec * 1000).toISOString(), source: 'statusline', capturedAt: new Date(NOW - 30000).toISOString(), ...extra });

test('색 경계 69.9 / 70 / 89.9 / 90', () => {
  assert.equal(formatLimit(W(69.9, 3600), NOW).level, 'ok');
  assert.equal(formatLimit(W(70, 3600), NOW).level, 'warn');
  assert.equal(formatLimit(W(89.9, 3600), NOW).level, 'warn');
  assert.equal(levelOf(89.9), 'warn');
  assert.equal(formatLimit(W(90, 3600), NOW).level, 'danger');
  assert.equal(formatLimit(W(100, 3600), NOW).level, 'danger');
  assert.equal(formatLimit(W(0, 3600), NOW).level, 'ok');
});

test('퍼센트 문구', () => {
  assert.equal(pctText(7), '7%');
  assert.equal(pctText(69.94), '69.9%');
  assert.equal(pctText(23.5), '23.5%');
  assert.equal(formatLimit(W(7, 60), NOW).pctText, '7%');
});

test('만료(재설정 시각 지남·expired 표시)', () => {
  const a = formatLimit(W(80, -5), NOW);
  assert.equal(a.level, 'expired');
  assert.equal(a.pctText, '재설정됨');
  assert.equal(a.resetText, '새 값 대기');
  assert.equal(formatLimit(W(10, 3600, { expired: true }), NOW).level, 'expired');
});

test('값 없음', () => {
  assert.equal(formatLimit(null, NOW).level, 'none');
  assert.equal(formatLimit({ pct: null }, NOW).level, 'none');
  assert.equal(limitsView(null, NOW).visible, false);
  assert.equal(limitsView({ ok: true, source: null, five_hour: null, seven_day: null, disabled: true }, NOW).visible, false);
  assert.equal(limitsView({ ok: true, five_hour: null, seven_day: null }, NOW).visible, false);
});

test('남은 시간: 1시간 미만 n분 · 24시간 미만 h:mm · 그 이상 n일 n시간', () => {
  assert.equal(formatRemain(59), '1분');
  assert.equal(formatRemain(12 * 60), '12분');
  assert.equal(formatRemain(3599), '60분');
  assert.equal(formatRemain(3600), '1:00');
  assert.equal(formatRemain(3 * 3600 + 12 * 60 + 30), '3:12');
  assert.equal(formatRemain(22 * 3600), '22:00');
  assert.equal(formatRemain(86400), '1일');
  assert.equal(formatRemain(4 * 86400 + 5 * 3600 + 100), '4일 5시간');
  assert.equal(formatLimit(W(7, 3 * 3600 + 12 * 60), NOW).resetText, '3:12 남음');
});

test('나이 문구', () => {
  assert.equal(formatAge(new Date(NOW - 20000).toISOString(), NOW), '방금');
  assert.equal(formatAge(new Date(NOW - 12 * 60000).toISOString(), NOW), '12분 전 기준');
  assert.equal(formatAge(new Date(NOW - 3 * 3600000).toISOString(), NOW), '3시간 전 기준');
  assert.equal(formatAge(new Date(NOW - 2 * 86400000).toISOString(), NOW), '2일 전 기준');
  assert.equal(formatAge(null, NOW), '');
});

test('stale: 서버 표시 또는 지금 기준 10분 초과', () => {
  const base = { ok: true, source: 'statusline', five_hour: W(7, 3600), seven_day: W(19, 86400 * 2) };
  assert.equal(limitsView({ ...base, capturedAt: new Date(NOW - 60000).toISOString(), stale: false }, NOW).stale, false);
  const v = limitsView({ ...base, capturedAt: new Date(NOW - 12 * 60000).toISOString(), stale: false }, NOW);
  assert.equal(v.stale, true);
  assert.equal(v.age, '12분 전 기준');
  assert.equal(limitsView({ ...base, capturedAt: new Date(NOW - 60000).toISOString(), stale: true }, NOW).stale, true);
  assert.deepEqual(v.items.map((x) => x.key), ['five_hour', 'seven_day']);
  assert.equal(v.items[0].name, '5시간');
  assert.equal(v.source, 'Claude Code 상태줄');
});

test('툴팁에 출처·재설정 시각, 자격증명 같은 다른 필드는 무시', () => {
  const f = formatLimit(W(93, 7200, { source: 'oauth', token: 'SECRET-SHOULD-NOT-SHOW' }), NOW, { name: '7일' });
  assert.match(f.title, /사용량 조회/);
  assert.match(f.title, /재설정 \d+월 \d+일/);
  assert.ok(!f.title.includes('SECRET'));
});

test('영어 화면(§86): 남은 시간·나이·툴팁·리셋 시각(Intl)', async () => {
  const { _setLangForTest } = await import('../i18n.mjs');
  const { formatResetAt } = await import('../limits.js');
  _setLangForTest('en');
  try {
    assert.equal(formatRemain(12 * 60), '12m');
    assert.equal(formatRemain(4 * 86400 + 5 * 3600 + 100), '4d 5h');
    assert.equal(formatAge(new Date(NOW - 3 * 3600000).toISOString(), NOW), 'as of 3 hours ago');
    const f = formatLimit(W(7, 3 * 3600 + 12 * 60, { source: 'oauth' }), NOW, { name: '5-hour' });
    assert.equal(f.resetText, '3:12 left');
    assert.match(f.title, /^5-hour limit 7% used\nResets .+ \(3:12 left\)\nSource: Usage API\nChecked just now$/);
    assert.ok(!/[\uac00-\ud7a3]/.test(formatResetAt(NOW)));
    assert.equal(formatLimit(W(80, -5), NOW).pctText, 'Reset');
    assert.equal(limitsView({ five_hour: W(7, 60), seven_day: null }, NOW).items[0].name, '5-hour');
  } finally { _setLangForTest('ko'); }
});
