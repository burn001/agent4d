// node --test "web/test/i18n-app.test.mjs"   다국어 영역 'app': 순수 core 의 영어 문구(언어를 바꿔 부르는 함수들)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _setLangForTest, t } from '../i18n.mjs';
import { relTime, countsText, selectionLabel } from '../projects.js';
import { PauseBuffer } from '../live-pause.mjs';
import { fmtRange, ticks } from '../macro/macro-core.mjs';
import { filterChip } from '../filter-ui.mjs';
import { markFor } from '../timeline.mjs';

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const ago = (min) => new Date(NOW - min * 60_000).toISOString();

test('app en: 상대 시각·세션 수·선택 이름(영어 복수형)', () => {
  _setLangForTest('en');
  try {
    assert.equal(relTime(ago(0.2), NOW), 'just now');
    assert.equal(relTime(ago(3), NOW), '3 min ago');
    assert.equal(relTime(ago(60), NOW), '1 hour ago');
    assert.equal(relTime(ago(150), NOW), '2 hours ago');
    assert.equal(relTime(ago(60 * 50), NOW), '2 days ago');
    assert.equal(countsText({ live: true, liveSessions: 1, activeSessions: 0 }), '1 session · 0 active');
    assert.equal(countsText({ sessions: 4 }), '4 past sessions');
    assert.equal(selectionLabel({ scope: 'all' }, []), 'All');
    assert.equal(filterChip('x').text, 'Filter: x');
  } finally { _setLangForTest('ko'); }
  assert.equal(relTime(ago(3), NOW), '3분 전');
});

test('app en: 실시간 일시정지 문구·타임라인 표식·매크로 눈금(요일은 Intl)', () => {
  _setLangForTest('en');
  try {
    const b = new PauseBuffer();
    b.pause(new Date(2026, 0, 1, 14, 3, 22).getTime());
    b.push({});
    assert.equal(b.label(), 'Paused · since 14:03:22 · 1 event queued');
    assert.equal(b.detail(), 'since 14:03:22 · 1 event queued');
    assert.equal(b.shortLabel(), 'Paused 14:03:22 · +1');
    assert.equal(markFor({ type: 'tool-end', ok: false, tool: 'Bash' }).label, 'Bash failed');
    const a = new Date(2026, 9, 21, 14, 3).getTime(), c = new Date(2026, 9, 21, 16, 20).getTime();
    assert.equal(fmtRange(a, c), '10/21 (Wed) 14:03 – 16:20');
    const H = 3_600_000;
    const r = ticks(a - 24 * H, a, 64 / (6 * H));
    assert.ok(r.ticks.filter((k) => !k.day).every((k) => /^\d+:00$/.test(k.label)));
    assert.equal(t('app.stats', { n: 1, a: 0, k: 2 }), '1 node · 0 working · 2 tools in use');
  } finally { _setLangForTest('ko'); }
  const b = new PauseBuffer(); b.pause(new Date(2026, 0, 1, 14, 3, 22).getTime());
  assert.equal(b.label(), '일시정지 · 14:03:22 기준 · 밀린 이벤트 0');
});
