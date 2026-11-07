// 패널 크기 조절 순수 부분: 한도·기본값·저장값 해석·두 번 누르기·드래그·키보드·가상 키보드 가림, 그리고 CSS 배선(질의 글자 일치·변수 사용)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DOCK_QUERY, sideLimits, clampSide, sideDefault, dockLimits, clampDock, dockDefault, parseSaved, isDoubleTap, dragSize, keySize, keyboardInset,
} from '../panel-size.mjs';
import { t } from '../i18n.mjs';

const css = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('오른쪽 배치 너비: 최소 240, 최대 화면의 60%(상한 900), 기본 360(좁으면 화면 절반)', () => {
  assert.deepEqual(sideLimits(1440), { min: 240, max: 864 });
  assert.deepEqual(sideLimits(3000), { min: 240, max: 900 });
  assert.deepEqual(sideLimits(844), { min: 240, max: 506 });
  assert.equal(clampSide(100, 1440), 240);
  assert.equal(clampSide(2000, 1440), 864);
  assert.equal(clampSide(NaN, 1440), 360);
  assert.equal(sideDefault(1440), 360);
  assert.equal(sideDefault(667), 333);
  assert.ok(clampSide(sideDefault(667), 667) >= 240);
});

test('아래 배치 높이: 최소 120, 최대 화면의 75%이되 상단 바 아래 120px 은 남김, 기본 45%', () => {
  assert.deepEqual(dockLimits(844, 86), { min: 120, max: 633 });
  assert.equal(dockLimits(500, 86).max, 294); // 500-86-120
  assert.equal(clampDock(10, 844, 86), 120);
  assert.equal(clampDock(5000, 844, 86), 633);
  assert.equal(dockDefault(844), 379);
  const l = dockLimits(200, 86); // 아주 낮은 화면에서도 min<=max
  assert.ok(l.min <= l.max);
});

test('저장값 해석: 양수 정수만, 깨진 값은 null', () => {
  assert.equal(parseSaved('420'), 420);
  assert.equal(parseSaved('420.4'), 420);
  for (const bad of [null, undefined, '', 'abc', '0', '-5', '99999', 'NaN']) assert.equal(parseSaved(bad), null, String(bad));
});

test('두 번 누르기: 350ms·20px 안', () => {
  assert.equal(isDoubleTap(null, { t: 0, x: 0, y: 0 }), false);
  assert.equal(isDoubleTap({ t: 0, x: 5, y: 5 }, { t: 300, x: 8, y: 9 }), true);
  assert.equal(isDoubleTap({ t: 0, x: 5, y: 5 }, { t: 400, x: 5, y: 5 }), false);
  assert.equal(isDoubleTap({ t: 0, x: 5, y: 5 }, { t: 100, x: 60, y: 5 }), false);
});

test('드래그: 오른쪽 배치는 왼쪽 변 x, 아래 배치는 위쪽 변 y 를 따라가고 한도로 자른다', () => {
  assert.equal(dragSize(false, { x: 1000, y: 0 }, 1440, 900), 440);
  assert.equal(dragSize(false, { x: 1400, y: 0 }, 1440, 900), 240);
  assert.equal(dragSize(false, { x: 0, y: 0 }, 1440, 900), 864);
  assert.equal(dragSize(true, { x: 0, y: 500 }, 390, 844, 86), 344);
  assert.equal(dragSize(true, { x: 0, y: 840 }, 390, 844, 86), 120);
  assert.equal(dragSize(true, { x: 0, y: 0 }, 390, 844, 86), 633);
});

test('키보드: 오른쪽은 ←키움 →줄임, 아래는 ↑키움 ↓줄임, Shift 큰 걸음, 그 밖 키는 null', () => {
  assert.equal(keySize(false, 'ArrowLeft', false, 360, 1440, 900), 376);
  assert.equal(keySize(false, 'ArrowRight', true, 360, 1440, 900), 296);
  assert.equal(keySize(false, 'ArrowUp', false, 360, 1440, 900), null);
  assert.equal(keySize(true, 'ArrowUp', false, 300, 390, 844, 86), 324);
  assert.equal(keySize(true, 'ArrowDown', false, 130, 390, 844, 86), 120);
  assert.equal(keySize(true, 'a', false, 300, 390, 844, 86), null);
});

test('가상 키보드 가림: 100px 미만(주소창 접힘)은 무시, visualViewport 위치 보정', () => {
  assert.equal(keyboardInset(844, 844, 0), 0);
  assert.equal(keyboardInset(844, 790, 0), 0);
  assert.equal(keyboardInset(844, 520, 0), 324);
  assert.equal(keyboardInset(844, 520, 40), 284);
  assert.equal(keyboardInset(844, NaN, 0), 0);
});

test('CSS 배선: 아래 배치 질의가 두 곳(theme.css)에서 DOCK_QUERY 와 같은 글자, 고정 360px·45vh 가 더는 레이아웃을 쥐지 않음', () => {
  const theme = css('../theme.css');
  const q = '@media ' + DOCK_QUERY;
  assert.ok(theme.split(q).length - 1 >= 3, '변수·패널·띠 세 블록');
  assert.match(theme, /#stage \{[^}]*right: var\(--inset-r\); bottom: var\(--panel-h\)/);
  assert.match(theme, /#panel \{\n  position: fixed;[^}]*width: var\(--panel-w\)/);
  assert.ok(!/bottom: 45vh/.test(theme) && !/bottom: 45vh/.test(css('../replay/replay.css')));
  assert.match(theme, /--panel-w-open: min\(360px, 50vw\)/);
  assert.match(css('../replay/replay.css'), /right: var\(--inset-r, 0px\); bottom: var\(--panel-h, 0px\)/);
  assert.match(css('../ui-tidy.css'), /#tl-zone \{\n  position: fixed; left: var\(--inset-l, 0px\); right: var\(--inset-r, 360px\); bottom: var\(--panel-h, 0px\)/);
});

test('손잡이 문구(en·ko)와 저장 키', () => {
  assert.match(t('app.panel.resize'), /./);
  const js = css('../panel-resize.js');
  assert.match(js, /try \{ return localStorage\.getItem/);
  assert.match(js, /pointerdown/); assert.match(js, /visualViewport/);
  assert.match(css('../index.html'), /src="panel-resize\.js"/);
});

// ── 패널 위치(왼쪽/오른쪽) ──
import { parseSide, panelSide, setPanelSide, onPanelSide, SIDE_KEY } from '../panel-side.mjs';

test('패널 위치: 저장값 해석·바꾸면 구독자 통지(저장소 없어도 이번 접속은 바뀜)', () => {
  assert.equal(parseSide('left'), 'left');
  for (const v of ['right', '', null, undefined, 'LEFT', 'x']) assert.equal(parseSide(v), 'right');
  assert.equal(SIDE_KEY, 'ccviz.panelSide');
  assert.equal(panelSide(), 'right');
  const seen = [];
  const off = onPanelSide((s) => seen.push(s));
  setPanelSide('left'); setPanelSide('left'); setPanelSide('bogus');
  assert.deepEqual(seen, ['left', 'right']);
  assert.equal(panelSide(), 'right');
  off(); setPanelSide('left'); assert.deepEqual(seen, ['left', 'right']);
  setPanelSide('right');
});

test('왼쪽 배치: 드래그는 패널 오른쪽 변 x, 키는 → 키움 ← 줄임, 아래 배치에서는 영향 없음', () => {
  assert.equal(dragSize(false, { x: 558, y: 0 }, 1440, 900, 48, true), 558);
  assert.equal(dragSize(false, { x: 10, y: 0 }, 1440, 900, 48, true), 240);
  assert.equal(dragSize(false, { x: 1400, y: 0 }, 1440, 900, 48, true), 864);
  assert.equal(dragSize(true, { x: 0, y: 500 }, 390, 844, 86, true), 344); // 아래 배치는 위쪽 변
  assert.equal(keySize(false, 'ArrowRight', false, 360, 1440, 900, 48, true), 376);
  assert.equal(keySize(false, 'ArrowLeft', false, 360, 1440, 900, 48, true), 344);
  assert.equal(keySize(true, 'ArrowUp', false, 300, 390, 844, 86, true), 324);
});

test('패널 위치 CSS 배선: inset 변수·왼쪽 규칙은 아래 배치에서 무시, 겹칠 수 있는 띠·칩이 inset 을 따름', () => {
  const theme = css('../theme.css');
  const notDock = '@media not all and ' + DOCK_QUERY;
  assert.ok(theme.includes(notDock), '왼쪽 규칙은 not all + 아래 배치 질의 안');
  assert.match(theme, /body \{ --inset-r: var\(--panel-w\); --inset-l: 0px; \}/);
  assert.match(theme, /body\.panel-left \{ --inset-r: 0px; --inset-l: var\(--panel-w\); \}/);
  assert.match(theme, /#stage \{[^}]*left: var\(--inset-l\); right: var\(--inset-r\)/);
  assert.match(theme, /body\.panel-left #panel \{ right: auto; left: 0; border-left: none; border-right:/);
  assert.match(theme, /body\.panel-left #panel-resizer \{ left: auto; right: -5px; \}/);
  assert.match(theme, /#timeline \{\n  position: fixed; left: var\(--inset-l\); right: var\(--inset-r\)/);
  for (const sel of ['#cam-chip', '#stats-chip', '#legend']) assert.match(theme, new RegExp(String.raw`${sel} \{\n  position: fixed;[^\n]*left: calc\(var\(--inset-l\) \+ 12px\)`), sel);
  assert.match(css('../replay/replay.css'), /left: var\(--inset-l, 0px\); right: var\(--inset-r, 360px\)/);
  assert.match(css('../ui-tidy.css'), /left: var\(--inset-l, 0px\); right: var\(--inset-r, 360px\)/);
  assert.match(css('../replay/archive-card.css'), /right: calc\(var\(--inset-r, 360px\) \+ 12px\)/);
  assert.match(css('../pov-ui.js'), /left: calc\(var\(--inset-l, 0px\) \+ 12px\)/);
  assert.match(css('../inspector.js'), /else if \(r\.right < W \* 0\.6\) left = r\.right/);
});

test('패널 위치 메뉴·문구: ⚙ 메뉴 줄, en·ko 같은 키', async () => {
  const menu = css('../settings-menu.js');
  assert.match(menu, /row\(t\('core\.settings\.row\.panel'\), panelSideButtons\(\)\)/);
  assert.match(menu, /setPanelSide\(s\)/);
  const { default: core } = await import('../i18n/core.mjs');
  for (const k of ['core.settings.row.panel', 'core.panel.right', 'core.panel.left', 'core.panel.title']) {
    assert.ok(core.en[k] && core.ko[k], k);
  }
  assert.match(css('../panel.js'), /import '\.\/panel-side\.mjs'/);
});

// ── 패널 위치 마무리: 가장자리 요소 비킴·URL·ctl·가상 키보드 ──
import { urlSide } from '../panel-side.mjs';
import { boardScreen, boardWorld } from '../plan-core.mjs';
import { normalizeCmd, CTL_COMMANDS } from '../control-core.mjs';

test('§140.4 계획 판: 무대 사각형 밖(왼쪽 패널 밑)으로 완전히 들어가면 숨김, 걸치면 그림 — CSS 가 무대 밖을 자름', () => {
  const w = boardWorld(2);
  const SB = { l: 360, t: 48, r: 1440, b: 900 }; // 왼쪽 패널 360
  assert.equal(boardScreen({ x: 100, y: 400 }, 60, w, 1440, 900).hidden, false, '화면 기준이면 보임(예전)');
  const under = boardScreen({ x: 10, y: 400 }, 20, w, 1440, 900, SB);
  assert.ok(under.box.x + under.box.w < 360);
  assert.equal(under.hidden, true, '패널 밑에 다 들어가면 숨김');
  assert.equal(boardScreen({ x: 300, y: 400 }, 60, w, 1440, 900, SB).hidden, false, '무대에 걸치면 그림');
  const plan = css('../plan.css');
  assert.match(plan, /#plan-boards, #plan-links \{ clip-path: inset\(var\(--topbar-h, 48px\) var\(--inset-r, 0px\) var\(--panel-h, 0px\) var\(--inset-l, 0px\)\); \}/);
  const ui = css('../plan-ui.js');
  assert.equal((ui.match(/boardScreen\(pj\.p, pj\.ppw, pj\.wb, W, H, SB\)/g) || []).length, 2);
});

test('§140.4 가운데 띄우는 배지·안내는 무대 가운데(--stage-cx)', () => {
  const th = css('../theme.css');
  assert.match(th, /--stage-cx: calc\(var\(--inset-l\) \+ \(100vw - var\(--inset-l\) - var\(--inset-r\)\) \/ 2\)/);
  assert.match(th, /#notice \{\n {2}position: fixed; left: var\(--stage-cx, 50%\);/);
  assert.match(th, /#loading \{\n {2}position: fixed; left: var\(--stage-cx, 50%\);/);
  assert.match(css('../ctx.css'), /#pause-badge \{\n[^}]*left: var\(--stage-cx, 50%\)/);
  assert.match(css('../pov-ui.js'), /#pov-hint \{ position: fixed; left: var\(--stage-cx, 50%\)/);
  // 화면 가장자리에 붙는 고정 요소가 더는 left: 12px / right: 0 고정이 아님(팝업·휴대폰 카드 제외)
  for (const f of ['../theme.css', '../replay/replay.css', '../replay/archive-card.css', '../ui-tidy.css']) {
    const s = css(f);
    for (const m of s.matchAll(/position: fixed;[^}]*?\bleft: 12px/g)) assert.fail(`${f}: ${m[0].slice(0, 80)}`);
  }
});

test('§140.5 URL ?panel=left|right(이번 접속만) · ctl panel left|right', () => {
  assert.equal(urlSide('?panel=left'), 'left');
  assert.equal(urlSide('?x=1&panel=RIGHT'), 'right');
  assert.equal(urlSide('?panel=open'), null);
  assert.equal(urlSide(''), null);
  assert.equal(urlSide(null), null);
  setPanelSide('right', { save: false });
  assert.equal(panelSide(), 'right');
  setPanelSide('left', { save: false });
  assert.equal(panelSide(), 'left');
  setPanelSide('right');
  assert.deepEqual(normalizeCmd('panel', { value: 'left' }), { ok: true, cmd: 'panel', args: { value: 'left' } });
  assert.deepEqual(normalizeCmd('panel', { value: '오른쪽' }).args, { value: 'right' });
  assert.deepEqual(normalizeCmd('panel', { value: 'collapse' }).args, { value: 'close' }); // 예전 그대로
  assert.match(CTL_COMMANDS.panel.usage, /panel left\|right/);
  const app = css('../app.js');
  assert.match(app, /if \(value === 'left' \|\| value === 'right'\) \{ setPanelSide\(value\);/);
  assert.match(app, /panelSide: panelSide\(\),/);
  const side = css('../panel-side.mjs');
  assert.match(side, /let side = \(typeof location !== 'undefined' && urlSide\(location\.search\)\) \|\| parseSide/);
});

test('§140.6 가상 키보드가 떠 있으면(아래 배치) 아래 띠를 숨김 — body.kb-open', () => {
  assert.match(css('../panel-resize.js'), /document\.body\.classList\.toggle\('kb-open', !!k\)/);
  const th = css('../theme.css');
  const dock = th.slice(th.indexOf('@media (max-width: 719px) and (orientation: portrait) {\n  #panel {'));
  const block = dock.slice(0, dock.indexOf('\n}\n'));
  assert.match(block, /body\.kb-open #timeline, body\.kb-open #tl-zone, body\.kb-open \.mt, body\.kb-open #replay-bar, body\.kb-open #stats-chip, body\.kb-open #pov-hint \{ visibility: hidden !important;/);
});
