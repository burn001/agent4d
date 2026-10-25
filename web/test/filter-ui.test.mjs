// 실황 노드 필터 해제
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterChip, escClears, scopeClears, FILTER_HINT } from '../filter-ui.mjs';

test('필터 칩 문구: 이름 + 해제 방법 안내', () => {
  const c = filterChip('3D 프런트엔드');
  assert.equal(c.text, '필터: 3D 프런트엔드');
  assert.ok(c.title.includes('Esc') && c.title.includes('빈 곳') && c.title.includes(FILTER_HINT));
});

test('Esc 해제: 필터가 있을 때만, 입력창 포커스·조합 키·한글 조합 중 제외', () => {
  const k = (o = {}) => ({ key: 'Escape', target: { tagName: 'CANVAS' }, ...o });
  assert.equal(escClears(k(), true), true);
  assert.equal(escClears(k(), false), false);
  assert.equal(escClears(k({ key: 'a' }), true), false);
  assert.equal(escClears(k({ target: { tagName: 'input' } }), true), false);
  assert.equal(escClears(k({ target: { tagName: 'TEXTAREA' } }), true), false);
  assert.equal(escClears(k({ target: { tagName: 'DIV', isContentEditable: true } }), true), false);
  assert.equal(escClears(k({ ctrlKey: true }), true), false);
  assert.equal(escClears(k({ isComposing: true }), true), false);
});

test('범위 선택: 프로젝트(재선택 포함)·전체는 필터 해제, 세션은 유지', () => {
  assert.equal(scopeClears({ scope: 'all' }), true);
  assert.equal(scopeClears({ scope: 'project', projectId: 'p', again: true }), true);
  assert.equal(scopeClears({ scope: 'session', sessionId: 's' }), false);
});
