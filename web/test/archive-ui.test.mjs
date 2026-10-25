// 보관함 선택·연속 재생·설명 카드 순수 규칙
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeSelection, parseSelection, selectionLabel, sameSelection, archiveGroupHtml } from '../projects.js';
import { demoSpeedAt, rateAt, nextInPlaylist, archiveCardModel, kstShort, hoursText, DEMO } from '../replay/demo-core.mjs';

const ARC = { enabled: true, count: 3, projects: [{ projectId: 'D--x-appdb', name: 'demo_api', sessions: 2 }, { projectId: 'D--Works', name: 'Projects/2026', sessions: 1 }], sessions: [] };

test('선택 문자열: archive · archive:<projectId> 왕복, 원본 project 와 다름', () => {
  for (const s of [{ scope: 'archive', projectId: null }, { scope: 'archive', projectId: 'D--x-appdb' }]) {
    assert.deepEqual(parseSelection(serializeSelection(s)), s);
  }
  assert.equal(serializeSelection({ scope: 'archive' }), 'archive');
  assert.ok(!sameSelection({ scope: 'archive', projectId: 'D--x-appdb' }, { scope: 'project', projectId: 'D--x-appdb' }));
  assert.equal(selectionLabel({ scope: 'archive', projectId: null }, [], ARC), '📦 보관함');
  assert.equal(selectionLabel({ scope: 'archive', projectId: 'D--Works' }, [], ARC), '📦 Projects/2026');
  assert.equal(selectionLabel({ scope: 'archive', projectId: 'D--zz' }, [], null), '📦 D--zz');
});

test('보관함 묶음 HTML: 머리 📦 보관함 (n) + 프로젝트별, 선택 표시, 꺼짐·빈 보관함은 없음', () => {
  const h = archiveGroupHtml(ARC, { scope: 'archive', projectId: 'D--Works' });
  assert.match(h, /보관함 \(3\)/);
  assert.equal((h.match(/data-act="arc"/g) || []).length, 3);
  assert.match(h, /class="pl-row pl-arc-row on"[^>]*data-pid="D--Works"/);
  assert.equal(archiveGroupHtml({ enabled: false, count: 0 }, null), '');
  assert.equal(archiveGroupHtml({ enabled: true, count: 0, projects: [] }, null), '');
  assert.equal(archiveGroupHtml(null, null), '');
  assert.ok(!/<script/i.test(archiveGroupHtml({ enabled: true, count: 1, projects: [{ projectId: 'p', name: '<script>x' , sessions: 1 }] }, null)));
});

const T0 = Date.parse('2026-10-01T00:00:00Z');
function tl(counts, size = 10_000, highlights = []) {
  return { startTs: new Date(T0).toISOString(), buckets: { size, counts }, highlights };
}

test('연속 재생 속도: 볼거리 근처 1×, 밀도에 따라 2·4·8·32×', () => {
  const busy = tl(new Array(30).fill(10)); // 10초에 10건 = 분당 60
  assert.equal(rateAt(busy, T0 + 100_000), 60);
  assert.equal(demoSpeedAt(busy, T0 + 100_000), 2);
  assert.equal(demoSpeedAt(tl(new Array(30).fill(2)), T0 + 100_000), 4);   // 분당 12
  assert.equal(demoSpeedAt(tl(new Array(30).fill(0.6)), T0 + 100_000), 8); // 분당 3.6
  assert.equal(demoSpeedAt(tl(new Array(30).fill(0)), T0 + 100_000), 32);
  const h = tl(new Array(30).fill(0), 10_000, [{ t: T0 + 100_000, t1: T0 + 120_000 }]);
  assert.equal(demoSpeedAt(h, T0 + 100_000 - DEMO.NEAR_BEFORE), 1);
  assert.equal(demoSpeedAt(h, T0 + 120_000 + DEMO.NEAR_AFTER), 1);
  assert.equal(demoSpeedAt(h, T0 + 120_000 + DEMO.NEAR_AFTER + 1), 32);
  assert.equal(rateAt(null, 0), 0);
});

test('재생 목록: 메인만 시작 순, 다음·끝이면 처음, 모르는 세션이면 첫 세션', () => {
  const items = [{ id: 'b', start: 2 }, { id: 'a', start: 1 }, { id: 'k', start: 1.5, child: true }, { id: 'c', start: 3 }];
  assert.equal(nextInPlaylist(items, 'a').id, 'b');
  assert.equal(nextInPlaylist(items, 'c').id, 'a');
  assert.equal(nextInPlaylist(items, null).id, 'a');
  assert.equal(nextInPlaylist([], 'a'), null);
});

test('설명 카드: why·지표·KST 범위, 지표 없으면 목록 정보로', () => {
  const m = archiveCardModel({ sessionId: 'arc:abc', title: '제목', archiveMeta: { why: ['서브에이전트 대량 분기'], tools: 219, kinds: 5, subs: 141, bg: 1, hours: 1.0,
    first: '2026-10-17T05:33:00.000Z', last: '2026-10-17T06:35:00.000Z' } });
  assert.equal(m.title, '제목');
  assert.deepEqual(m.why, ['서브에이전트 대량 분기']);
  assert.deepEqual(m.stats.map((x) => x[0]), ['도구 호출', '도구 종류', '서브에이전트', '백그라운드', '진행 시간']);
  assert.equal(m.stats[2][1], '141');
  assert.equal(m.range, '10/17 14:33 – 10/17 15:35 KST');
  const n = archiveCardModel({ sessionId: 'arc:deadbeef00', startedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T00:30:00Z' });
  assert.equal(n.title, 'deadbeef');
  assert.deepEqual(n.stats, [['진행 시간', '30분']]);
  assert.equal(archiveCardModel(null), null);
  assert.equal(kstShort('bad'), '');
  assert.equal(hoursText(12.84), '12.8시간');
});

test('설명 카드 영어(§86): 지표 이름·진행 시간', async () => {
  const { _setLangForTest } = await import('../i18n.mjs');
  _setLangForTest('en');
  try {
    const m = archiveCardModel({ sessionId: 'arc:abc', archiveMeta: { tools: 3, kinds: 2, subs: 1, bg: 0, hours: 0.5 } });
    assert.deepEqual(m.stats.map((x) => x[0]), ['Tool calls', 'Tool kinds', 'Subagents', 'Background', 'Duration']);
    assert.equal(m.stats[4][1], '30 min');
    assert.equal(hoursText(12.84), '12.8 hr');
  } finally { _setLangForTest('ko'); }
});
