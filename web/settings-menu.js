// UI 정리: 상단 바는 꼭 필요한 것만 두고 나머지 조작은 ⚙ 설정 메뉴 하나로 옮긴다.
//  · 상단 바: 로고 · 연결 점(글자 없이, title 로 설명) · 프로젝트 선택 · 재생 · [빈칸] · 컨텍스트 알약 · 한도 게이지(작은 묶음) · 소리 · ⚙
//  · ⚙ 메뉴: 표현(흐름·Planet·복셀 / 3D·2D) · 카메라(자동 카메라·구도) · 표시(완료 표시·배경·범례·테마) · 소리(안내 — 조작은 소리 팝업) · 실시간 일시정지 · 언어
// 기존 버튼 DOM 을 그대로 옮긴다(id·이벤트·저장값·URL 파라미터 그대로 — 기능 삭제 없음). 메뉴는 키보드로 열고(Enter/Space)
// Esc 로 닫으며(⚙ 로 포커스 복귀), 열면 첫 조작으로 포커스, 밖을 누르거나 포커스가 밖으로 나가면 닫힌다. 좁은 화면은 화면 폭 시트.
// 화면 아래 타임라인(매크로·이벤트 띠)은 평소 숨기고(자리는 그대로 — 카메라 맞춤이 튀지 않게) 재생 중·마우스를 올렸을 때·포커스가 들어왔을 때만 보인다.

import { t, lang, langPref, setLangPref } from './i18n.mjs';

const $ = (id) => document.getElementById(id);

function ensureCss() {
  if (document.querySelector('link[data-ccviz="ui-tidy"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./ui-tidy.css', import.meta.url).href;
  l.dataset.ccviz = 'ui-tidy';
  document.head.appendChild(l);
}

/** 설정 메뉴 줄 하나(제목 + 조작들) */
function row(label, nodes) {
  const r = document.createElement('div');
  r.className = 'sm-row';
  const h = document.createElement('span');
  h.className = 'sm-k';
  h.textContent = label;
  const c = document.createElement('div');
  c.className = 'sm-v';
  for (const n of nodes) if (n) c.appendChild(n);
  r.append(h, c);
  return c.childNodes.length ? r : null;
}

/** 언어 고르기: 자동 · English · 한국어 — 언어 이름은 그 언어 자신의 표기, 고르면 저장 후 새로고침(상태는 URL·저장값으로 이어짐) */
function langButtons() {
  const pref = langPref();
  const wrap = document.createElement('div');
  wrap.className = 'sm-lang'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', t('core.settings.row.lang'));
  wrap.title = t('core.lang.title');
  for (const p of ['auto', 'en', 'ko']) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tb'; b.dataset.lang = p;
    b.textContent = p === 'auto' ? t('core.lang.auto') : t('core.lang.' + p);
    if (p !== 'auto') b.lang = p;
    if (p === 'auto') b.title = t('core.lang.autoIs', { name: t('core.lang.' + lang()) });
    b.setAttribute('aria-pressed', String(p === pref));
    b.addEventListener('click', () => {
      for (const x of wrap.children) x.setAttribute('aria-pressed', String(x === b));
      setLangPref(p);
    });
    wrap.appendChild(b);
  }
  return [wrap];
}

export function mountSettings() {
  ensureCss();
  const top = $('topbar');
  if (!top || $('btn-settings')) return null;
  document.body.classList.add('ui-tidy');

  // ── 상단 바 오른쪽: 소리 · ⚙ ──
  const btn = document.createElement('button');
  btn.id = 'btn-settings'; btn.type = 'button'; btn.className = 'tb';
  btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'settings-menu');
  btn.setAttribute('aria-label', t('core.settings')); btn.title = t('core.settings.title');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  const sound = $('btn-sound');
  top.appendChild(sound || document.createTextNode(''));
  top.appendChild(btn);

  // ── 메뉴 ──
  const menu = document.createElement('div');
  menu.id = 'settings-menu'; menu.hidden = true;
  menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', t('core.settings'));
  const view = $('btn-view');
  const viewNode = view && view.parentNode && view.parentNode.classList && view.parentNode.classList.contains('vsel') ? view.parentNode : view;
  // 소리(음량·곡·재생 방식)는 소리 설정 팝업(소리 버튼 옆 ♪, 소리를 켜면 나타남)으로 옮겼다 — 여기는 안내 한 줄
  const soundNote = document.createElement('span');
  soundNote.className = 'sm-note';
  soundNote.textContent = t('core.settings.soundNote');
  const rows = [
    row(t('core.settings.row.view'), [viewNode]),
    row(t('core.settings.row.camera'), [$('btn-camera'), $('btn-cam-mode')]),
    row(t('core.settings.row.display'), [$('btn-done'), $('btn-env'), $('btn-legend')]),
    row(t('core.settings.row.theme'), [$('btn-theme')]),
    row(t('core.settings.row.sound'), [soundNote]),
    row(t('core.settings.row.live'), [$('btn-pause')]),
    row(t('core.settings.row.lang'), langButtons()),
  ].filter(Boolean);
  const hint = document.createElement('p');
  hint.className = 'sm-hint';
  hint.textContent = t('core.settings.hint');
  // 버전: 메뉴 맨 아래 작게(서버 /healthz 의 version — package.json)
  const ver = document.createElement('p');
  ver.className = 'sm-ver';
  ver.hidden = true;
  fetch('./healthz', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.version) { ver.textContent = 'v' + j.version; ver.hidden = false; } }).catch(() => {});
  menu.append(...rows, hint, ver);
  document.body.appendChild(menu);
  const more = top.querySelector('.tb-more');
  if (more && !more.querySelector('button, input, select')) more.hidden = true;

  const focusables = () => [...menu.querySelectorAll('button, input, select, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hidden && !x.disabled && x.offsetParent !== null);
  function place() {
    const r = btn.getBoundingClientRect();
    menu.style.top = Math.round(r.bottom + 8) + 'px';
    menu.style.right = Math.max(8, Math.round(innerWidth - r.right)) + 'px';
  }
  function setOpen(on, { focus = true } = {}) {
    if (on === !menu.hidden) return;
    menu.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    btn.classList.toggle('on', on);
    if (on) { place(); if (focus) { const f = focusables()[0]; if (f) f.focus(); } }
    else if (focus && menu.contains(document.activeElement)) btn.focus();
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
  document.addEventListener('pointerdown', (e) => {
    if (menu.hidden || menu.contains(e.target) || btn.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.vsel-pop')) return; // 표현 고르기 펼침(메뉴 안에서 연 것)
    setOpen(false, { focus: false });
  });
  document.addEventListener('keydown', (e) => {
    if (menu.hidden || e.key !== 'Escape') return;
    // 표현 고르기 펼침이 열려 있으면 그것부터 닫히게 둔다(그 모듈이 Esc 를 받음)
    const vb = $('btn-view');
    if (vb && vb.getAttribute('aria-expanded') === 'true') return;
    e.preventDefault(); setOpen(false);
  }, true); // 캡처: 표현 고르기가 Esc 로 먼저 닫혀 상태가 바뀌기 전에 본다
  menu.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (to && !menu.contains(to) && to !== btn && !(to.closest && to.closest('.vsel'))) setOpen(false, { focus: false });
  });
  addEventListener('resize', () => { if (!menu.hidden) place(); });

  // ── 화면 아래 타임라인: 평소 숨김, 재생 중·마우스·포커스일 때만 ──
  const zone = document.createElement('button');
  zone.id = 'tl-zone'; zone.type = 'button';
  zone.setAttribute('aria-label', t('core.tl.expand')); zone.title = t('core.tl.title');
  document.body.appendChild(zone);
  let hideT = 0;
  const show = () => { clearTimeout(hideT); document.body.classList.add('tl-show'); };
  const hideSoon = () => { clearTimeout(hideT); hideT = setTimeout(() => { if (!document.querySelector('#timeline:hover, #macro-tl:hover, #macro-tl:focus-within, #timeline:focus-within, #tl-zone:hover')) document.body.classList.remove('tl-show'); }, 700); };
  for (const el of [zone, $('timeline'), $('macro-tl')]) {
    if (!el) continue;
    el.addEventListener('pointerenter', show);
    el.addEventListener('pointerleave', hideSoon);
    el.addEventListener('focusin', show);
    el.addEventListener('focusout', hideSoon);
  }
  zone.addEventListener('click', () => { if (document.body.classList.contains('tl-show')) document.body.classList.remove('tl-show'); else show(); });

  return { open: () => setOpen(true), close: () => setOpen(false), get isOpen() { return !menu.hidden; }, menu, button: btn };
}
