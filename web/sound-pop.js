// 소리 설정 팝업: 소리가 켜져 있을 때만 상단 바 소리 버튼 바로 옆에 작은 ♪ 버튼이 나타나고, 누르면 소리 기능을 모은 팝업.
//  · 새 오디오 기능은 없다 — 기존 Music(audio.js)·Sound(sound.mjs)·Sfx 를 잇기만 한다
//  · 팝업: 지금 곡(자동이면 활동 단계) · 재생 방식(자동·한 곡 반복·순환·무작위 = 기존 선택값 sel) · 곡 고르기(= 한 곡 반복) · 음악·효과음 음량
//  · 음량 슬라이더(#vol·#sfx-vol)와 곡 선택기(#bgm-track, 숨김)는 DOM 을 그대로 옮겨 온다(id·이벤트·저장값 그대로, 중복 조작 없음)
//  · 곡·방식·상태가 바뀌면 즉시 다시 그림(Music._renderSelect·Sound.render 뒤에 덧붙임)
//  · 바깥 클릭·Esc·포커스가 밖으로 나가면 닫힘, 소리를 끄면 버튼과 함께 닫힘. 좁은 화면은 화면 폭 시트(밖으로 안 나감)
//  · 3D·2D·세 표현 공용(상단 바 하나)

import { optionList, isMode, modeLabel, stageLabel } from './bgm-core.mjs';
import { t as tr } from './i18n.mjs';

const $ = (id) => document.getElementById(id);

const MODES = ['auto', 'one', 'cycle', 'shuffle'].map((v) => ({ v, text: tr(`sound.pop.mode.${v}`), title: tr(`sound.pop.mode.${v}.title`) }));
const modeOf = (sel) => (sel == null ? null : isMode(sel) ? sel : 'one');
export const modeText = (sel) => (sel == null ? '' : isMode(sel) ? (sel === 'auto' ? tr('sound.pop.mode.auto') : modeLabel(sel)) : tr('sound.pop.mode.one'));

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';

function ensureCss() {
  if (document.querySelector('link[data-ccviz="sound-pop"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./sound-pop.css', import.meta.url).href;
  l.dataset.ccviz = 'sound-pop';
  document.head.appendChild(l);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function mountSoundPop({ music, sound } = {}) {
  const sbtn = $('btn-sound');
  if (!music || !sound || !sbtn || $('btn-sound-pop')) return null;
  ensureCss();

  // ── 버튼: 소리 버튼 바로 뒤 ──
  const btn = document.createElement('button');
  btn.id = 'btn-sound-pop'; btn.type = 'button'; btn.className = 'tb';
  btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'sound-pop');
  btn.innerHTML = ICON;
  btn.hidden = true;
  sbtn.after(btn);

  // ── 팝업 ──
  const pop = el('div');
  pop.id = 'sound-pop'; pop.hidden = true;
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', tr('sound.pop.aria'));

  const head = el('div', 'sp-head');
  const hTitle = el('b', null, tr('sound.pop.head'));
  const hState = el('span', 'sp-state');
  head.append(hTitle, hState);

  const now = el('div', 'sp-now');
  now.setAttribute('aria-live', 'polite');
  const nowT = el('div', 'sp-now-t');
  const nowS = el('div', 'sp-now-s');
  now.append(nowT, nowS);

  const sec = (label, body) => { const r = el('div', 'sp-row'); r.append(el('span', 'sp-k', label), body); return r; };

  const modeBox = el('div', 'sp-seg');
  modeBox.setAttribute('role', 'group'); modeBox.setAttribute('aria-label', tr('sound.pop.sec.mode'));
  const modeBtns = MODES.map((m) => {
    const b = el('button', 'sp-chip', m.text);
    b.type = 'button'; b.title = m.title; b.dataset.mode = m.v;
    b.addEventListener('click', () => {
      if (m.v === 'one') { if (isMode(music.sel)) music.select(music.cur || music.def); }
      else if (music.sel !== m.v) music.select(m.v);
      render();
    });
    modeBox.appendChild(b);
    return b;
  });

  const trackBox = el('div', 'sp-tracks');
  trackBox.setAttribute('role', 'group'); trackBox.setAttribute('aria-label', tr('sound.pop.sec.track'));
  let trackKey = '';
  function buildTracks() {
    const opts = optionList(music.tracks).filter((o) => !isMode(o.value));
    const key = opts.map((o) => o.value).join('|');
    if (key === trackKey) return;
    trackKey = key;
    trackBox.textContent = '';
    for (const o of opts) {
      const b = el('button', 'sp-chip sp-track');
      b.type = 'button'; b.dataset.id = o.value; b.title = o.title + tr('sound.pop.track.titleSuffix');
      b.append(el('i', 'sp-dot'), el('span', null, o.text));
      b.addEventListener('click', () => { music.select(o.value); render(); });
      trackBox.appendChild(b);
    }
  }

  // 음량: 기존 슬라이더 DOM 을 옮겨 온다
  const volBox = el('div', 'sp-vols');
  const lab = (input, text) => {
    if (!input) return null;
    const l = el('label', 'sp-range');
    l.append(el('span', null, text), input);
    return l;
  };
  for (const n of [lab($('vol'), tr('sound.pop.vol.music')), lab($('sfx-vol'), tr('sound.pop.vol.sfx'))]) if (n) volBox.appendChild(n);
  const selEl = $('bgm-track');
  if (selEl) { selEl.hidden = true; selEl.tabIndex = -1; volBox.appendChild(selEl); } // 상태 확인용으로만 남김(조작은 위 칩)

  const hint = el('p', 'sp-hint', tr('sound.pop.hint'));
  pop.append(head, now, sec(tr('sound.pop.sec.mode'), modeBox), sec(tr('sound.pop.sec.track'), trackBox), sec(tr('sound.pop.sec.vol'), volBox), hint);
  document.body.appendChild(pop);

  // .tb-more 에 조작이 하나도 안 남으면 숨김(과 같은 규칙)
  const more = document.querySelector('#topbar .tb-more');
  if (more && !more.querySelector('button, input, select')) more.hidden = true;

  // ── 그리기 ──
  const STATE_TEXT = Object.fromEntries(['on', 'loading', 'waiting', 'held'].map((k) => [k, tr(`sound.pop.state.${k}`, { hint: tr('sound.waitHint') })]));
  function render() {
    const st = sound.status();
    const show = !!sound.on;
    if (btn.hidden === show) btn.hidden = !show;
    if (!show && !pop.hidden) setOpen(false, { focus: false });
    const t = music.track();
    const avail = !!music.available;
    const mode = modeOf(music.sel);
    const auto = music.sel === 'auto';
    const lv = auto && music.autoLevel != null ? stageLabel(music.autoLevel) : null;
    const name = !avail ? (music._probed ? tr('sound.noFiles') : tr('sound.pop.probing')) : t ? t.label : '—';
    btn.title = tr('sound.pop.btn.title', { what: avail && t ? `${t.label} · ${modeText(music.sel)}` : name });
    btn.setAttribute('aria-label', btn.title);
    if (pop.hidden) return; // 닫혀 있으면 버튼 툴팁만
    hState.textContent = STATE_TEXT[st] || '';
    nowT.textContent = name;
    nowS.textContent = avail && t ? [modeText(music.sel) + (lv ? ` · ${tr('sound.pop.activity', { level: lv })}` : ''), t.bpm ? `${t.bpm} BPM` : ''].filter(Boolean).join(' · ') : '';
    now.title = avail && t && t.mood ? t.mood : ''; // 곡 설명은 길어서 풍선으로만
    for (const b of modeBtns) { b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); b.disabled = !avail; }
    buildTracks();
    for (const b of trackBox.children) {
      const id = b.dataset.id;
      b.setAttribute('aria-pressed', String(music.sel === id));
      b.classList.toggle('cur', id === music.cur);
      if (id === music.cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      b.disabled = !avail;
    }
  }

  // ── 열고 닫기 ──
  const focusables = () => [...pop.querySelectorAll('button, input')].filter((x) => !x.hidden && !x.disabled && x.offsetParent !== null);
  function place() {
    const r = btn.getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 8) + 'px';
    if (innerWidth < 720) { pop.style.left = ''; pop.style.right = ''; return; } // CSS 시트(left·right 8px)
    const w = pop.offsetWidth || 330;
    const left = Math.max(8, Math.min(innerWidth - w - 8, Math.round(r.right - w)));
    pop.style.left = left + 'px'; pop.style.right = 'auto';
  }
  function setOpen(on, { focus = true } = {}) {
    if (on === !pop.hidden) return;
    pop.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    btn.classList.toggle('on', on);
    if (on) {
      if (window.__ccvizSettings && window.__ccvizSettings.isOpen) window.__ccvizSettings.close();
      render(); place();
      if (focus) { const f = pop.querySelector('.sp-chip[aria-pressed="true"]:not(:disabled)') || focusables()[0]; if (f) f.focus(); }
    } else if (focus && pop.contains(document.activeElement)) btn.focus();
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(pop.hidden); });
  document.addEventListener('pointerdown', (e) => {
    if (pop.hidden || pop.contains(e.target) || btn.contains(e.target)) return;
    setOpen(false, { focus: false });
  });
  document.addEventListener('keydown', (e) => {
    if (pop.hidden || e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation(); setOpen(false);
  }, true);
  pop.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (to && !pop.contains(to) && to !== btn) setOpen(false, { focus: false });
  });
  addEventListener('resize', () => { if (!pop.hidden) place(); });

  // ── 상태가 바뀌면 바로: Music 선택기 그리기·Sound 버튼 그리기 뒤에 덧붙임 ──
  const origSel = music._renderSelect.bind(music);
  music._renderSelect = function () { origSel(); render(); };
  const origRender = sound.render.bind(sound);
  sound.render = function () { origRender(); render(); };
  render();

  return { open: () => setOpen(true), close: () => setOpen(false), get isOpen() { return !pop.hidden; }, render, pop, button: btn };
}
