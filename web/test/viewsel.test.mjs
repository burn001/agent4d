// node --test "web/test/viewsel.test.mjs"   표현 선택 드롭다운: 항목·문구·키보드
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { menuItems, triggerText, menuKey, popVertical } from '../viewsel.mjs';

test('menuItems: 표현 3종 + 화면 3D·2D, 지금 값 표시, 2D 준비 중 알림', () => {
  const it = menuItems({ view: 'planet', dim: '2d' });
  assert.deepEqual(it.map((x) => `${x.group}:${x.value}`), ['view:flow', 'view:planet', 'view:voxel', 'dim:3d', 'dim:2d']);
  assert.deepEqual(it.filter((x) => x.checked).map((x) => x.value), ['planet', '2d']);
  assert.equal(it[2].text, '복셀 오피스');
  assert.match(menuItems({ view: 'voxel', dim: '2d', pending: 'voxel' })[4].hint, /준비 중/);
  assert.equal(triggerText('flow', '3d'), '표현: 흐름 · 3D');
  assert.equal(triggerText('voxel', '2d'), '표현: 복셀 오피스 · 2D');
});

test('menuKey: ↑↓ 돌아감·Home·End·Enter·Space 고름·Esc·Tab 닫음', () => {
  assert.deepEqual(menuKey('ArrowDown', 4, 5), { i: 0, act: 'move' });
  assert.deepEqual(menuKey('ArrowUp', 0, 5), { i: 4, act: 'move' });
  assert.deepEqual(menuKey('Home', 3, 5), { i: 0, act: 'move' });
  assert.deepEqual(menuKey('End', 0, 5), { i: 4, act: 'move' });
  assert.equal(menuKey('Enter', 2, 5).act, 'pick');
  assert.equal(menuKey(' ', 2, 5).act, 'pick');
  assert.equal(menuKey('Escape', 2, 5).act, 'close');
  assert.equal(menuKey('Tab', 2, 5).act, 'close');
  assert.equal(menuKey('a', 2, 5).act, null);
});

test('app.js: 순환 버튼·#btn-dim 토글 대신 드롭다운, 저장 키·URL 처리 그대로', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /mountViewSelector\(\{/);
  assert.doesNotMatch(app, /dimBtn.id = 'btn-dim'/);
  assert.doesNotMatch(app, /switchView\(\); \}\);/, '버튼 클릭 순환 제거');
  assert.match(app, /lsSet\('ccviz\.view2', next\)/);
  assert.match(app, /lsSet\('ccviz\.dim', d\)/);
  assert.match(app, /initialDim\(params\.get\('dim'\), lsGet\('ccviz\.dim'\)\)/);
});

// 모바일에서 표현 창이 안 보이던 문제: 펼침(.vsel-pop, body 에 붙음)이 z-index 46 이라 ⚙ 설정 메뉴(60)가 열린 채면 그 뒤에 가려졌다
// (탭해도 단추에 초점이 가지 않는 모바일 Safari 계열은 ⚙ 메뉴가 닫히지 않음). '배경' 카드도 같은 까닭
test('§67.6 ⚙ 메뉴 안 단추로 여는 창은 ⚙ 메뉴보다 위에 뜬다(z-index)', () => {
  const zOf = (src, sel) => { const m = src.match(new RegExp('(^|\\n)' + sel.replace(/[.#]/g, '\\$&') + '\\s*\\{[^}]*?z-index:\\s*(\\d+)')); assert.ok(m, sel); return Number(m[2]); };
  const tidy = readFileSync(new URL('../ui-tidy.css', import.meta.url), 'utf8');
  const vsel = readFileSync(new URL('../viewsel.mjs', import.meta.url), 'utf8');
  const env = readFileSync(new URL('../env/env.css', import.meta.url), 'utf8');
  const menuZ = zOf(tidy, '#settings-menu');
  assert.ok(zOf(vsel, '.vsel-pop') > menuZ, '표현 펼침 > ⚙ 메뉴');
  assert.ok(zOf(env, '.env-card') > menuZ, '배경 카드 > ⚙ 메뉴');
  assert.doesNotMatch(tidy, /#settings-menu \.vsel-pop\s*\{/, 'body 에 붙은 펼침에 닿지 않는 죽은 규칙 없음');
});

test('§67.6 popVertical: 아래 자리 있으면 단추 아래, 낮은 화면은 높이 줄임, 아래가 좁고 위가 넓으면 위로', () => {
  assert.deepEqual(popVertical({ top: 63, bottom: 91 }, 844, 255), { top: 97, maxHeight: 844 - 91 - 14 });
  const land = popVertical({ top: 60, bottom: 90 }, 390, 255); // 가로 모드: 아래 286 ≥ 255 → 아래 그대로
  assert.equal(land.top, 96); assert.ok(land.maxHeight >= 255);
  const low = popVertical({ top: 60, bottom: 90 }, 300, 255); // 아래 196 < 255, 위 46 → 아래에 두고 높이 196 으로 줄임
  assert.deepEqual(low, { top: 96, maxHeight: 196 });
  const up = popVertical({ top: 700, bottom: 728 }, 800, 255); // 아래 58, 위 680 → 위로
  assert.equal(up.top, 700 - 6 - 255); assert.ok(up.top + 255 <= 700);
  assert.equal(popVertical({ top: 10, bottom: 30 }, 100, 255).maxHeight, 120, '최소 높이 120');
});
