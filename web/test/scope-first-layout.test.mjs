// 전체 보기 첫 배치(11.07.): 스냅샷에 끝난 노드가 수백 개(ACME 세션 서브에이전트 600여 개)면, setScope 가 퇴장 판정 전에
// 배치해 섬이 그 크기로 수백 단위 떨어져 놓였고, 새 노드가 그 자리에서 시작해 새로고침 직후 무리가 멀리 퍼졌다가 모였다.
// 모드가 바뀌는 setScope 는 layoutNow(퇴장 판정 → 배치)로 배치해야 한다 — 흐름·Planet(scene.js)·2D(flat-view.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const body = (file, name) => {
  const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const i = src.indexOf('\n  ' + name + '(');
  assert.ok(i >= 0, `${file} ${name}`);
  const j = src.indexOf('\n  }\n', i);
  return src.slice(i, j);
};

for (const f of ['scene.js', 'flat/flat-view.js']) {
  test(`${f} setScope: 모드가 바뀌면 퇴장 판정 먼저(layoutNow), _relayout 직접 호출 없음`, () => {
    const b = body(f, 'setScope');
    assert.match(b, /prevMode !== mode\) this\.layoutNow\(\)/);
    assert.doesNotMatch(b, /this\._relayout\(\)/);
  });
  test(`${f} layoutNow: _exitPass 가 _relayout 보다 앞`, () => {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    const m = src.match(/layoutNow\(\) \{([^\n]*)\}/);
    assert.ok(m, 'layoutNow');
    assert.ok(m[1].indexOf('_exitPass') >= 0 && m[1].indexOf('_exitPass') < m[1].indexOf('_relayout'));
  });
}
