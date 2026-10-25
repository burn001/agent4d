// node --test "web/test/i18n.test.mjs"   다국어: 언어 결정 규칙·사전 키 집합·자리표시·Intl
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolveLang, normPref, normLang, mergeDicts, DICT_PARTS, MESSAGES, t, lang, _setLangForTest, fmtTime, fmtDate, locale } from '../i18n.mjs';

test('resolveLang: ?lang= → 저장값 → navigator.languages(ko* 면 ko, 아니면 en)', () => {
  assert.equal(resolveLang({ url: 'en', stored: 'ko', languages: ['ko-KR'] }), 'en');
  assert.equal(resolveLang({ url: 'ko-KR', stored: 'en' }), 'ko');
  assert.equal(resolveLang({ url: 'fr', stored: 'ko', languages: ['en-US'] }), 'ko', '모르는 URL 값은 무시');
  assert.equal(resolveLang({ stored: 'en', languages: ['ko-KR'] }), 'en');
  assert.equal(resolveLang({ stored: 'auto', languages: ['en-US', 'ko'] }), 'ko', '목록 어디든 ko 면 ko');
  assert.equal(resolveLang({ stored: 'auto', languages: ['ko_KR'] }), 'ko');
  assert.equal(resolveLang({ stored: null, languages: ['en-GB', 'ja'] }), 'en');
  assert.equal(resolveLang({ stored: 'garbage', languages: [] }), 'en', '아무 정보 없으면 영어');
  assert.equal(resolveLang({ languages: ['kok'] }), 'en', 'kok(콘칸어)는 한국어 아님');
  assert.equal(normPref('KO'), 'ko'); assert.equal(normPref('x'), 'auto');
  assert.equal(normLang('en-US'), 'en'); assert.equal(normLang(''), null);
});

test('사전: 영역 파일 모두 연결, en·ko 키 집합 일치, 영역 앞머리, 겹침 없음', () => {
  const files = readdirSync(new URL('../i18n/', import.meta.url)).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, ''));
  assert.deepEqual(files.sort(), Object.keys(DICT_PARTS).sort(), 'web/i18n/*.mjs 는 모두 i18n.mjs 에 import');
  for (const [area, p] of Object.entries(DICT_PARTS)) {
    const en = Object.keys(p.en || {}), ko = Object.keys(p.ko || {});
    assert.deepEqual(en.filter((k) => !(k in p.ko)), [], `${area}: ko 에 빠진 키`);
    assert.deepEqual(ko.filter((k) => !(k in p.en)), [], `${area}: en 에 빠진 키`);
    for (const k of en) assert.ok(k.startsWith(area + '.'), `${area}: 키 앞머리 ${k}`);
  }
  assert.deepEqual(mergeDicts(DICT_PARTS).dupes, []);
});

test('사전: 영어 값에 한글 없음(언어 이름 한국어 제외), 자리표시 이름이 두 언어에서 같음', () => {
  const HANGUL = /[\uAC00-\uD7A3\u3131-\u318E]/;
  const probe = { n: 2, name: 'x', a: 1, b: 2, s: 'x', k: 1, m: 1 };
  for (const [k, v] of Object.entries(MESSAGES.en)) {
    if (k === 'core.lang.ko') continue;
    const s = typeof v === 'function' ? String(v(probe)) : v;
    assert.doesNotMatch(s, HANGUL, `en 에 한글: ${k} = ${s}`);
    const ko = MESSAGES.ko[k];
    if (typeof v === 'string' && typeof ko === 'string') {
      const ph = (x) => [...new Set([...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',');
      assert.equal(ph(v), ph(ko), `자리표시 다름: ${k}`);
    }
  }
});

test('t: 자리표시 채움·빠진 키는 다른 언어 → 키 그대로, node 기본은 ko', () => {
  assert.equal(lang(), 'ko', 'node 시험 기본 ko(CCVIZ_LANG 없을 때)');
  assert.equal(t('core.settings'), '설정');
  _setLangForTest('en');
  try {
    assert.equal(t('core.settings'), 'Settings');
    assert.equal(t('core.lang.autoIs', { name: 'English' }), 'Auto (English)');
    assert.equal(t('no.such.key'), 'no.such.key');
    assert.equal(locale(), 'en-US');
    assert.match(fmtTime(Date.UTC(2026, 0, 2, 3, 4)), /^\d\d:\d\d$/);
    assert.match(fmtDate(new Date(2020, 4, 6)), /May 6, 2020/);
  } finally { _setLangForTest('ko'); }
  assert.match(fmtDate(new Date(2020, 4, 6)), /2020/);
});

test('index.html 첫 스크립트: html lang 을 같은 규칙으로, 저장 키 ccviz.lang', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /localStorage\.getItem\('ccviz\.lang'\)/);
  assert.match(html, /document\.documentElement\.lang = lg/);
  const sm = readFileSync(new URL('../settings-menu.js', import.meta.url), 'utf8');
  assert.match(sm, /setLangPref\(p\)/);
});
