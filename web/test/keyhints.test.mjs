// Alt 를 누르고 있는 동안 단축키 안내 풍선 — 목록이 실제 바인딩과 같은지, Alt 판정, 범례와 한 출처, 숨김 조건, 첫 재생 한 번 안내
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEY_HINTS, hintsFor, altOpens, keyText, legendLine, wantAltTip, ALT_TIP_KEY } from '../keyhints-core.mjs';
import dict from '../i18n/app.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('hintsFor: 재생 중 = 재생 키 + 카메라, 실시간 = Space 정지 + 카메라', () => {
  const r = hintsFor({ replaying: true }).map(keyText), l = hintsFor({ replaying: false }).map(keyText);
  assert.deepEqual(r.slice(0, 5), ['Space', ', .', '< >', 'N B', '[ ]']);
  assert.equal(l[0], 'Space');
  assert.ok(!l.includes(', .'), '실시간엔 재생 키 없음');
  for (const x of [r, l]) assert.ok(x.includes('W A S D / ← ↑ ↓ →') && x.includes('Esc'));
});

test('안내 키 = 실제 바인딩(replay/ui.mjs onKey·camera.js·camera2d.js _key·실시간 Space)', () => {
  const ui = src('../replay/ui.mjs'), c3 = src('../camera.js'), c2 = src('../flat/camera2d.js'), app = src('../app.js');
  const onKey = ui.slice(ui.indexOf('function onKey'), ui.indexOf("window.addEventListener('keydown', onKey"));
  for (const k of [',', '.', '<', '>', '[', ']']) assert.ok(onKey.includes(`k === '${k}'`), `재생 키 ${k}`);
  assert.ok(/k === 'n'/.test(onKey) && /k === 'b'/.test(onKey), '볼거리 n·b');
  assert.ok(/e\.code === 'Space'/.test(onKey));
  for (const c of [c3, c2]) for (const k of ['w:', 'a:', 's:', 'd:', 'q:', 'e:', "'+':", "'-':", 'arrowleft']) assert.ok(c.includes(k), `카메라 키 ${k}`);
  assert.match(app, /spaceForPause\(\{ replaying/, '실시간 Space 정지');
  // 키·풍선 자리는 목록 전부에 label 이 있고 en·ko 사전에 있다
  for (const h of [...KEY_HINTS.replay, ...KEY_HINTS.live, ...KEY_HINTS.camera]) for (const lg of ['en', 'ko']) assert.ok(dict[lg][h.label], `${lg} ${h.label}`);
  for (const k of ['app.keys.title', 'app.keys.release', 'app.keys.tipOnce', 'app.leg.replayKeys', 'app.leg.liveKeys', 'app.leg.altKeys']) for (const lg of ['en', 'ko']) assert.ok(dict[lg][k], `${lg} ${k}`);
});

test('altOpens: Alt 단독만(AltGr = Ctrl+Alt·Shift+Alt·입력칸·조합 중 아님)', () => {
  const E = (o) => ({ key: 'Alt', ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, ...o });
  assert.equal(altOpens(E()), true);
  assert.equal(altOpens(E({ ctrlKey: true })), false);
  assert.equal(altOpens(E({ shiftKey: true })), false);
  assert.equal(altOpens(E({ isComposing: true })), false);
  assert.equal(altOpens(E({ key: 'a' })), false);
  for (const tag of ['INPUT', 'textarea', 'SELECT']) assert.equal(altOpens(E(), { tag }), false, tag);
  assert.equal(altOpens(E(), { editable: true }), false);
  assert.equal(altOpens(E(), { tag: 'CANVAS' }), true);
});

test('범례 키 줄 = 같은 목록(legendLine), < > 는 이스케이프', () => {
  const html = legendLine(KEY_HINTS.replay, (k) => dict.ko[k]);
  assert.match(html, /<b>&lt; &gt;<\/b> 60초 뒤로\/앞으로/);
  assert.match(html, /<b>Space<\/b> 재생\/정지 · <b>, \.<\/b> 10초/);
  const app = src('../app.js');
  assert.match(app, /legendLine\(KEY_HINTS\.replay, tr\)/);
  assert.match(app, /legendLine\(KEY_HINTS\.live, tr\)/);
  assert.match(app, /legendLine\(KEY_HINTS\.camera\.slice\(0, 2\), tr\)/);
  assert.ok(!/app\.leg\.ctl7|app\.leg\.ctl2/.test(app), '옛 손글씨 키 줄은 없앰(두 출처 방지)');
});

test('숨김·막기 배선: 다른 키·keyup·blur·visibilitychange·pointerdown 에서 숨김, Alt keydown/keyup preventDefault, 터치 기기 없음', () => {
  const js = src('../keyhints.js'), css = src('../keyhints.css');
  assert.match(js, /altOpens\(e, \{ editable, tag[\s\S]{0,80}e\.preventDefault\(\)/);
  assert.match(js, /hide\(\); \/\/ Alt\+Tab/);
  assert.match(js, /addEventListener\('keyup'[\s\S]{0,80}e\.preventDefault\(\); hide\(\)/);
  assert.match(js, /addEventListener\('blur', hide\)/);
  assert.match(js, /addEventListener\('visibilitychange', hide\)/);
  assert.match(js, /addEventListener\('pointerdown', hide, true\)/);
  assert.match(js, /setTimeout\(show, SHOW_DELAY\)/, 'Alt+Tab 처럼 바로 떠나면 깜박이지 않게 잠깐 기다림');
  assert.match(css, /@media \(hover: none\) and \(pointer: coarse\) \{ #key-hints, \.kh-once \{ display: none; \} \}/);
  assert.match(src('../index.html'), /href="keyhints\.css"/);
});

test('첫 재생 한 번 안내: 저장값 없고 키보드·마우스 기기일 때만, 저장은 try/catch', () => {
  assert.equal(wantAltTip(false, true), true);
  assert.equal(wantAltTip(true, true), false);
  assert.equal(wantAltTip(false, false), false, '터치 전용');
  assert.equal(ALT_TIP_KEY, 'ccviz.altTipSeen');
  const js = src('../keyhints.js'), app = src('../app.js');
  assert.match(js, /try \{ seen = localStorage\.getItem\(ALT_TIP_KEY\) === '1'; \} catch/);
  assert.match(js, /try \{ localStorage\.setItem\(ALT_TIP_KEY, '1'\); \} catch/);
  assert.match(app, /ui\.setVisible\(true\);\n  keyHints\.tipOnce\(\);/);
  assert.match(app, /play: \(\) => document\.querySelector\('\.rp-bar \.rp-play'\)/);
  assert.match(app, /pause: \(\) => \(!pauseBadge\.hidden \? pauseBadge : pauseBtn\)/);
});
