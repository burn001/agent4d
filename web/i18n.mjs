// 다국어: UI 문구는 영어 기본, 브라우저 로케일이 한국어면 한국어. ⚙ 메뉴에서 자동·English·한국어를 고르면 저장.
// 결정 순서: URL ?lang=en|ko(이번 접속만, 저장 안 함) → localStorage 'ccviz.lang'(auto|en|ko) → auto 면 navigator.languages 중
// 'ko' 로 시작하는 것이 있으면 ko, 없으면 en. 브라우저가 아닌 곳(node 시험)은 process.env.CCVIZ_LANG || 'ko'(기존 시험이 한국어 문구를 기대).
// 사전은 영역별 파일 web/i18n/<영역>.mjs 가 { en: {...}, ko: {...} } 로 내보내고 여기서 모두 합친다(키 앞머리 = 영역 이름, 겹치면 안 됨).
// 값은 문자열('{n}개' 꼴 자리표시) 또는 함수(vars => 문자열, 영어 복수형 등). 언어를 바꾸면 새로고침(상태는 URL·저장값으로 이어짐) —
// 그래서 모듈을 불러올 때 계산하는 상수 표에서 t() 를 불러도 된다.
import core from './i18n/core.mjs';
import app from './i18n/app.mjs';
import sound from './i18n/sound.mjs';
import cards from './i18n/cards.mjs';
import boards from './i18n/boards.mjs';
import flat from './i18n/flat.mjs';
import scene from './i18n/scene.mjs';
import replay from './i18n/replay.mjs';
import server from './i18n/server.mjs';

export const LANGS = ['en', 'ko'];
export const LANG_PREFS = ['auto', 'en', 'ko'];
export const LANG_KEY = 'ccviz.lang';
export const DICT_PARTS = { core, app, sound, cards, boards, flat, scene, replay, server };

/** 사전 합치기: { en: {...}, ko: {...} } (겹친 키는 dupes 에) */
export function mergeDicts(parts) {
  const out = { en: {}, ko: {} };
  const dupes = [];
  for (const p of Object.values(parts)) {
    for (const L of LANGS) {
      for (const [k, v] of Object.entries((p && p[L]) || {})) {
        if (L === 'en' && k in out.en) dupes.push(k);
        out[L][k] = v;
      }
    }
  }
  return { dict: out, dupes };
}
const { dict: DICT } = mergeDicts(DICT_PARTS);
export const MESSAGES = DICT;

/** 'en'|'ko'|null */
export function normLang(x) {
  const s = String(x == null ? '' : x).trim().toLowerCase();
  if (s === 'en' || s.startsWith('en-')) return 'en';
  if (s === 'ko' || s.startsWith('ko-') || s === 'kr') return 'ko';
  return null;
}
/** 'auto'|'en'|'ko' (모르는 값은 auto) */
export function normPref(x) {
  const s = String(x == null ? '' : x).trim().toLowerCase();
  return s === 'en' || s === 'ko' ? s : 'auto';
}

/** 언어 결정(순수): url(?lang=) → stored(저장값) → languages(navigator.languages) */
export function resolveLang({ url = null, stored = null, languages = [] } = {}) {
  const u = normLang(url);
  if (u) return u;
  const p = normPref(stored);
  if (p !== 'auto') return p;
  const list = Array.isArray(languages) ? languages : [languages];
  return list.some((l) => /^ko(\b|[-_])/i.test(String(l || ''))) ? 'ko' : 'en';
}

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

function detect() {
  if (!IS_BROWSER) {
    const env = typeof process !== 'undefined' && process.env ? process.env.CCVIZ_LANG : null;
    return normLang(env) || 'ko';
  }
  let url = null;
  try { url = new URLSearchParams(location.search).get('lang'); } catch (e) { /* 없음 */ }
  const nav = typeof navigator !== 'undefined' ? (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) : [];
  return resolveLang({ url, stored: lsGet(LANG_KEY), languages: nav });
}

let LANG = detect();
if (IS_BROWSER) { try { document.documentElement.lang = LANG; } catch (e) { /* 무시 */ } }

export const lang = () => LANG;
export const isKo = () => LANG === 'ko';
/** Intl 로케일 */
export const locale = () => (LANG === 'ko' ? 'ko-KR' : 'en-US');
/** 저장된 선택(auto|en|ko) */
export const langPref = () => normPref(lsGet(LANG_KEY));

/** 시험·내부용: 메모리 안 언어만 바꾼다(저장·새로고침 없음) */
export function _setLangForTest(l) { LANG = normLang(l) || LANG; }

const warned = new Set();
function fill(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
}
/** 문구: 지금 언어 → 다른 언어(빠진 키) → 키 그대로 */
export function t(key, vars) {
  let v = DICT[LANG][key];
  if (v == null) {
    v = DICT[LANG === 'en' ? 'ko' : 'en'][key];
    if (!warned.has(key)) { warned.add(key); try { console.warn('[i18n] 빠진 키', LANG, key); } catch (e) { /* 무시 */ } }
    if (v == null) return key;
  }
  return typeof v === 'function' ? String(v(vars || {})) : fill(String(v), vars);
}
/** 키가 있나 */
export const has = (key) => key in DICT[LANG] || key in DICT.en;

/** 선택 저장 후 새로고침(?lang= 은 지워서 저장값이 이기게). 같은 언어로 끝나면 저장만 */
export function setLangPref(pref) {
  const p = normPref(pref);
  lsSet(LANG_KEY, p);
  if (!IS_BROWSER) return;
  let u = null;
  try { u = new URL(location.href); } catch (e) { /* 무시 */ }
  const hadUrl = u && u.searchParams.has('lang');
  if (hadUrl) u.searchParams.delete('lang');
  const next = resolveLang({ stored: p, languages: navigator.languages || [navigator.language] });
  if (next === LANG && !hadUrl) return;
  if (hadUrl) location.replace(u.href); else location.reload();
}

/** DOM 에 붙은 data-i18n(글자)·data-i18n-title·data-i18n-aria-label·data-i18n-placeholder 를 지금 언어로 */
export function applyDom(root = IS_BROWSER ? document : null) {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.getAttribute('data-i18n'));
  for (const [attr, prop] of [['data-i18n-title', 'title'], ['data-i18n-aria-label', 'aria-label'], ['data-i18n-placeholder', 'placeholder'], ['data-i18n-content', 'content']]) {
    for (const el of root.querySelectorAll(`[${attr}]`)) el.setAttribute(prop, t(el.getAttribute(attr)));
  }
}

// ── 날짜·시각·숫자(Intl) ──
const fmtCache = new Map();
function dtf(opts) {
  const k = LANG + JSON.stringify(opts);
  let f = fmtCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat(locale(), opts); fmtCache.set(k, f); }
  return f;
}
const toDate = (x) => (x instanceof Date ? x : new Date(typeof x === 'string' && !/^\d+$/.test(x) ? x : Number(x)));
/** 시각 HH:MM(24시간) */
export const fmtTime = (x, { seconds = false } = {}) => dtf({ hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23' }).format(toDate(x));
/** 날짜(월·일, 해가 다르면 연도) */
export function fmtDate(x, { year = 'auto', weekday = false } = {}) {
  const d = toDate(x);
  const y = year === 'auto' ? d.getFullYear() !== new Date().getFullYear() : !!year;
  return dtf({ ...(y ? { year: 'numeric' } : {}), month: 'short', day: 'numeric', ...(weekday ? { weekday: 'short' } : {}) }).format(d);
}
/** 날짜 + 시각 */
export const fmtDateTime = (x, o = {}) => `${fmtDate(x, o)} ${fmtTime(x, o)}`;
/** 숫자(천 단위 쉼표) */
export const fmtNum = (n, opts) => new Intl.NumberFormat(locale(), opts).format(n);
