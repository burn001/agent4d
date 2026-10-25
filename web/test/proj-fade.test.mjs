// 단일 프로젝트 선택 페이드·해제 규칙
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjFade, PROJ_FADE, fadeEase, blankClickAction } from '../proj-fade.mjs';

test('고르면 다른 프로젝트가 DUR 초에 걸쳐 0 으로, 다 사라지면 gone', () => {
  const f = new ProjFade(0.5);
  assert.equal(f.alpha('a'), 1);
  assert.ok(f.setFocus('a', ['a', 'b', 'c']));
  assert.equal(f.alpha('a'), 1);
  assert.equal(f.alpha('b'), 1);           // 그 자리에서 시작
  assert.ok(f.out('b') && !f.gone('b') && !f.out('a'));
  assert.ok(f.busy);
  f.step(0.25);
  assert.ok(f.alpha('b') > 0 && f.alpha('b') < 1);
  f.step(0.3);
  assert.equal(f.alpha('b'), 0);
  assert.ok(f.gone('b') && f.gone('c') && !f.gone('a'));
  assert.ok(!f.busy);
  assert.equal(f.alpha(null), 1);          // 소속 없는 것은 늘 보임
  assert.equal(f.alpha('new'), 0);         // 나중에 생긴 다른 프로젝트는 바로 숨김
});

test('전체로 돌아오면 거꾸로 나타나고, 끝나면 상태를 비운다', () => {
  const f = new ProjFade(0.5);
  f.setFocus('a', ['a', 'b']); f.step(1);
  f.setFocus(null, ['a', 'b']);
  assert.equal(f.alpha('b'), 0);
  assert.ok(!f.out('b'));
  f.step(0.5);
  assert.equal(f.alpha('b'), 1);
  assert.equal(f.t.size, 0);
});

test('도중에 바꾸면 지금 값에서 이어 간다 · instant 는 바로', () => {
  const f = new ProjFade(0.5);
  f.setFocus('a', ['a', 'b']); f.step(0.2);
  const mid = f.lin('b');
  f.setFocus(null, ['a', 'b']);
  assert.equal(f.lin('b'), mid);
  f.setFocus('b', ['a', 'b']);            // a 는 나가고 b 는 들어옴
  assert.equal(f.lin('a'), 1);
  assert.ok(f.out('a') && !f.out('b'));
  const g = new ProjFade();
  g.setFocus('a', ['a', 'b'], { instant: true });
  assert.ok(g.gone('b') && !g.busy);
  assert.equal(PROJ_FADE.DUR, 0.5);
  assert.equal(fadeEase(0.5), 0.5);
});

test('빈 곳 클릭: 프로젝트 영역 바깥만 전체로, 안쪽은 팝업 닫기·필터 해제만', () => {
  assert.equal(blankClickAction({ focus: 'a', area: null }), 'all');
  assert.equal(blankClickAction({ focus: 'a', area: null, popup: true }), 'all');
  assert.equal(blankClickAction({ focus: 'a', area: 'a' }), 'clear');
  assert.equal(blankClickAction({ focus: 'a', area: 'a', popup: true }), 'close');
  assert.equal(blankClickAction({ focus: null, area: null }), 'clear');
  assert.equal(blankClickAction({ focus: null, area: null, popup: true }), 'close');
});

test('연출용 노드 판정(fxShown·fxAlpha): 페이드 중엔 쓰고 투명도를 곱함, 숨김·recent·0 은 뺌', async () => {
  const { fxShown, fxAlpha } = await import('../proj-fade.mjs');
  assert.ok(fxShown({ scopeD: 1, projA: 0.3, scopeK: 0.3 }));      // 예전 문턱(scopeK<0.5)이면 꺼졌을 값
  assert.ok(!fxShown({ scopeD: 0.35, projA: 1 }));                   // 고정 희미(recent)
  assert.ok(!fxShown({ scopeD: 1, projA: 0 }));
  assert.ok(!fxShown({ hidden: true }) && !fxShown({ gone: true }) && !fxShown(null));
  assert.ok(fxShown({}));                                            // 값 없는 표현(단일 세션)
  assert.equal(fxAlpha({ projA: 0.4 }, { projA: 0.8 }), 0.4);
  assert.equal(fxAlpha({}, null), 1);
});

test('영역 판정은 누른 순간 것(areaAtDown) — 같은 표현·같은 프로젝트일 때만', async () => {
  const { areaAtDown } = await import('../proj-fade.mjs');
  const v = {};
  assert.equal(areaAtDown({ view: v, fp: 'a', area: 'a' }, v, 'a'), 'a');
  assert.equal(areaAtDown({ view: v, fp: 'a', area: null }, v, 'a'), null);   // 누를 때 영역 밖 → 손뗄 때 안이어도 밖
  assert.equal(areaAtDown({ view: v, fp: 'a', area: 'a' }, {}, 'a'), undefined);
  assert.equal(areaAtDown({ view: v, fp: 'b', area: 'b' }, v, 'a'), undefined);
  assert.equal(areaAtDown({ view: v, fp: 'a' }, v, 'a'), undefined);
  assert.equal(areaAtDown(null, v, 'a'), undefined);
});
