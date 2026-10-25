// 셸 추정 충돌 화면 쪽: ConflictBook·conflictPairs 의 est, 칩 글 '(추정)'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conflictPairs, pairChipText, ConflictBook, conflictEvent, ConflictTracker, shellFileRefs, EST_MARK } from '../conflict-core.mjs';

test('conflictPairs: 추정 충돌 파일 이름에 (추정), 묶음 est 는 모두 추정일 때만, 확정이 앞', () => {
  const ps = conflictPairs([
    { id: '1', a: 's:A', b: 's:B', file: 'app.js', level: 'weak', est: true, k: 1, fading: false },
    { id: '2', a: 's:A', b: 's:C', file: 'cfg.json', level: 'weak', est: true, k: 1, fading: false },
    { id: '3', a: 's:C', b: 's:A', file: 'lib.js', level: 'weak', k: 1, fading: false },
  ]);
  const ab = ps.find((p) => p.id === 's:A|s:B');
  assert.equal(ab.est, true);
  assert.deepEqual(ab.files, ['app.js (추정)']);
  assert.equal(pairChipText(ab), 'app.js (추정)');
  const ac = ps.find((p) => p.id === 's:A|s:C');
  assert.equal(ac.est, false);
  assert.deepEqual(ac.files, ['lib.js', 'cfg.json' + EST_MARK]);
  assert.equal(pairChipText(ac), 'lib.js 외 1');
});

test('ConflictBook: est 이벤트를 들고, 같은 id 가 확정으로 바뀌면 est 해제', () => {
  const b = new ConflictBook();
  const c = { id: 'A|B|k', a: 'A', b: 'B', k: 'd:/r/x.js', n: 'x.js', level: 'weak', est: true, nodeA: null, nodeB: null, wA: 1, wB: 1 };
  b.apply(conflictEvent(c, 'on', 't'), 0);
  assert.equal(b.items(0)[0].est, true);
  b.apply(conflictEvent({ ...c, level: 'strong', est: false }, 'on', 't'), 1);
  assert.equal(b.items(1)[0].est, false);
  assert.equal(b.items(1)[0].level, 'strong');
});

test('끝에서 끝: Bash sed -i 와 Edit 이 같은 파일 → 추적기 weak est → 칩 글 (추정)', () => {
  const t = new ConflictTracker();
  const t0 = 1_000_000;
  const [sh] = shellFileRefs('Bash', { command: "sed -i 's/a/b/' web/app.js" }, 'D:\\repo');
  t.touch('A', sh, t0, 'a:1');
  const r = t.touch('B', { k: 'd:/repo/web/app.js', n: 'app.js', w: 1 }, t0 + 10, 'a:2');
  const b = new ConflictBook();
  for (const c of r.on) b.apply(conflictEvent(c, 'on', 't', (g) => 's:' + g), 0);
  const [p] = conflictPairs(b.items(0));
  assert.equal(p.level, 'weak');
  assert.equal(p.est, true);
  assert.equal(pairChipText(p), 'app.js (추정)');
});

test('영어 화면(§86): 칩 글 "외 n" → "+n", 추정 꼬리', async () => {
  const { _setLangForTest } = await import('../i18n.mjs');
  const { estMark } = await import('../conflict-core.mjs');
  _setLangForTest('en');
  try {
    assert.equal(pairChipText({ files: ['lib.js', 'cfg.json'] }), 'lib.js +1');
    assert.equal(estMark(), ' (est.)');
  } finally { _setLangForTest('ko'); }
});
