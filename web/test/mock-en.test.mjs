import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _setLangForTest } from '../i18n.mjs';
import { en, mockEn } from '../mock-en.mjs';
import { MockGenerator } from '../mock.js';

test('mock 영어: 통째·숫자 모양·구절, 한글 없는 글·식별자 키는 그대로', () => {
  assert.equal(en('테스트가 모두 통과했습니다.'), 'All tests pass.');
  assert.equal(en('42줄 읽음'), '42 lines read');
  assert.equal(en('성능 측정 보조'), 'Perf profiling helper');
  assert.equal(en('에이전트 "서버 파서 구현" 완료'), 'Agent "Server parser" finished');
  assert.equal(en('npm test'), 'npm test');
  try {
    _setLangForTest('en');
    const ev = mockEn({ type: 'node-add', nodeId: 'a:한', node: { id: 'a:한', label: '통합 검증', meta: { title: '설문 응답 집계' } } });
    assert.equal(ev.nodeId, 'a:한');
    assert.equal(ev.node.label, 'Integration check');
    assert.equal(ev.node.meta.title, 'Aggregate survey responses');
    _setLangForTest('ko');
    assert.equal(mockEn({ text: '완료' }).text, '완료');
  } finally { _setLangForTest('ko'); }
});

test('mock 영어: 25초 분량 가짜 이벤트의 화면 문구에 한글이 거의 남지 않음', () => {
  try {
    _setLangForTest('en');
    const gen = new MockGenerator({ seed: 2026, startMs: Date.now() - 60000 });
    const evs = [];
    for (let i = 0; i < 400; i++) evs.push(...gen.next().events);
    const left = new Set();
    for (const ev of evs) {
      mockEn(ev);
      for (const k of ['text', 'brief', 'detail']) if (typeof ev[k] === 'string' && /[가-힣]/.test(ev[k])) left.add(ev[k]);
      if (ev.node && /[가-힣]/.test(ev.node.label.replace(/^메인 · /, ''))) left.add(ev.node.label);
    }
    assert.ok(left.size <= 3, [...left].join(' | '));
  } finally { _setLangForTest('ko'); }
});
