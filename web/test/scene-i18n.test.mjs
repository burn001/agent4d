// 다국어 — scene 영역 순수 문구: 섬 이름표·충돌 캐비닛 칩. 영어 확인 뒤 'ko' 로 되돌린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _setLangForTest } from '../i18n.mjs';
import { islandLabelHtml } from '../overview/island-label.mjs';
import { VxSessCore } from '../voxel/vx-sess-core.mjs';

const cab = (files) => VxSessCore.prototype.cabText.call(null, [{ files }]);

test('섬 이름표: 한국어 기본, 영어는 복수형', () => {
  assert.match(islandLabelHtml({ projectId: 'p', name: 'p', mains: [1, 2] }), /<span>세션 2<\/span>/);
  assert.match(islandLabelHtml({ projectId: 'p', name: 'p', inactive: true, sessions: 3 }), /세션 3 · 비활성/);
  _setLangForTest('en');
  try {
    assert.match(islandLabelHtml({ projectId: 'p', name: 'p', mains: [1] }), /<span>1 session<\/span>/);
    assert.match(islandLabelHtml({ projectId: 'p', name: 'p', mains: [1, 2] }), /<span>2 sessions<\/span>/);
    assert.match(islandLabelHtml({ projectId: 'p', name: 'p', inactive: true, sessions: 3 }), /3 sessions · inactive/);
  } finally { _setLangForTest('ko'); }
});

test('충돌 캐비닛 칩: 파일 여럿이면 "외 N" / "+N"', () => {
  assert.equal(cab(['a.js']), 'a.js');
  assert.equal(cab(['a.js', 'b.js', 'c.js']), 'a.js 외 2');
  _setLangForTest('en');
  try { assert.equal(cab(['a.js', 'b.js', 'c.js']), 'a.js +2'); } finally { _setLangForTest('ko'); }
});
