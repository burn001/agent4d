// 음악 패널(소리 팝업, → 플레이리스트): 소리가 켜져 있을 때만 상단 바 소리 버튼 바로 옆에 작은 ♪ 버튼이 나타나고,
// 누르면 플레이리스트 패널이 열린다.
//  · 지금 곡(재생 중 표시·무드·BPM·기준 상태) + 재생 제어(이전 · 재생/일시정지 · 다음 · 한 곡 반복)
//  · 선곡 기준 5종(작업 상태 · 셔플 · 순차 루프 · 무드 고정 · 시간대별 무드) — 무드 고정은 무드 칩, 시간대별은 시간대 4칸의 무드 고르기
//  · 플레이리스트 탭 세 개: 흐름 · Planet / 복셀(오피스 + 연구소) / 전체. 기본은 지금 보는 표현의 탭을 따라감(점 표시). 곡 행 = 제목 · 무드 태그 · 길이 · 재생 중 표시,
//    행을 누르면 그 곡을 재생(끝날 때까지 붙잡고, 끝나면 기준대로). 단계(한가～매우 활발)별 묶음 머리
//  · 음량: 음악 #vol · 효과음 켬/끔 칩 + #sfx-vol(DOM 을 그대로 옮겨 온다 — id·이벤트·저장값 그대로). 재생/일시정지 = 음악 켬/끔(Sound.setMusicOn)
//  · 오디오 동작은 Music(audio.js)의 setRule·setList·setMood·setTimeMood·setRepeat·playTrack·next·prev, 순수 모델은 bgm-list.mjs
//  · 바깥 클릭·Esc·포커스가 밖으로 나가면 닫힘, 소리를 끄면 버튼과 함께 닫힘. 720px 미만은 화면 폭 시트(목록만 스크롤)
//  · 키보드: 기준·무드 칩과 탭은 ←→(Home·End)로 옮기고 Enter·Space 로 고름, 곡 목록은 ↑↓(Home·End), Esc 닫기
//  · 3D·2D·네 표현 공용(상단 바 하나)

import { stageLabel } from './bgm-core.mjs';
import { RULES, MOODS, TIME_SLOTS, TABS, TAB_VIEWS, tabOf, ruleLabel, moodLabel, slotLabel, slotRange, playlistGroups, ruleCandidates, timeSlot, fmtDur } from './bgm-list.mjs';
import { RENDERER_LABEL } from './renderers.js';
import { t as tr } from './i18n.mjs';

const $ = (id) => document.getElementById(id);

/** 버튼 툴팁용 기준 이름(예전 호환: 한 곡 반복이면 '한 곡 반복') */
export const modeText = (music) => (!music ? '' : music.repeat ? tr('sound.pop.repeat') : ruleLabel(music.rule));

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
const ICON = svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>');
const I_PREV = svg('<path d="M6 5v14"/><path d="M18 6 9 12l9 6z" fill="currentColor"/>');
const I_NEXT = svg('<path d="M18 5v14"/><path d="m6 6 9 6-9 6z" fill="currentColor"/>');
const I_PLAY = svg('<path d="m8 5 11 7-11 7z" fill="currentColor"/>', ' width="18" height="18"');
const I_PAUSE = svg('<path d="M8 5v14M16 5v14" stroke-width="3"/>', ' width="18" height="18"');
const I_REPEAT = svg('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/><path d="M11.5 10.5 13 9.5v5" stroke-width="1.6"/>');

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

/** 칩·탭 묶음 안 ←→·Home·End 로 초점 옮기기(고르기는 Enter·Space — 옮기기만으로 곡이 바뀌지 않게). items() = 지금 버튼들 */
function arrowNav(box, items) {
  box.addEventListener('keydown', (e) => {
    const list = items().filter((b) => !b.disabled && b.offsetParent !== null);
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowLeft') j = (i - 1 + list.length) % list.length;
    else if (e.key === 'ArrowRight') j = (i + 1) % list.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = list.length - 1;
    if (j == null) return;
    e.preventDefault();
    list[j].focus();
  });
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

  // ── 패널 ──
  const pop = el('div');
  pop.id = 'sound-pop'; pop.hidden = true;
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', tr('sound.pop.aria'));

  const head = el('div', 'sp-head');
  const hState = el('span', 'sp-state');
  head.append(el('b', null, tr('sound.pop.head')), hState);

  // 지금 곡 + 재생 제어
  const now = el('div', 'sp-now');
  const nowInfo = el('div', 'sp-now-i');
  nowInfo.setAttribute('aria-live', 'polite');
  const nowT = el('div', 'sp-now-t');
  const nowS = el('div', 'sp-now-s');
  nowInfo.append(nowT, nowS);
  const ctl = el('div', 'sp-ctl');
  ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', tr('sound.pop.ctl'));
  const tbtn = (cls, html, label) => { const b = el('button', 'sp-tbtn ' + cls); b.type = 'button'; b.innerHTML = html; b.title = label; b.setAttribute('aria-label', label); return b; };
  const bPrev = tbtn('sp-prev', I_PREV, tr('sound.pop.prev'));
  const bPlay = tbtn('sp-play', I_PLAY, tr('sound.pop.play'));
  const bNext = tbtn('sp-next', I_NEXT, tr('sound.pop.next'));
  const bRep = tbtn('sp-rep', I_REPEAT, tr('sound.pop.repeat'));
  bRep.setAttribute('aria-pressed', 'false');
  ctl.append(bPrev, bPlay, bNext, bRep);
  now.append(nowInfo, ctl);
  bPrev.addEventListener('click', () => { music.prev(); render(); });
  bNext.addEventListener('click', () => { music.next(); render(); });
  bPlay.addEventListener('click', () => { sound.setMusicOn(!sound.musicOn); render(); });
  bRep.addEventListener('click', () => { music.setRepeat(!music.repeat); render(); });

  // 선곡 기준
  const ruleSec = el('div', 'sp-sec');
  const ruleK = el('div', 'sp-k', tr('sound.pop.sec.rule'));
  const ruleBox = el('div', 'sp-seg');
  ruleBox.setAttribute('role', 'group'); ruleBox.setAttribute('aria-label', tr('sound.pop.sec.rule'));
  const ruleBtns = RULES.map((r) => {
    const b = el('button', 'sp-chip', ruleLabel(r));
    b.type = 'button'; b.dataset.rule = r; b.title = tr(`sound.rule.${r}.title`);
    b.addEventListener('click', () => { if (music.repeat) music.setRepeat(false); music.setRule(r); render(); });
    ruleBox.appendChild(b);
    return b;
  });
  arrowNav(ruleBox, () => ruleBtns);
  // 기준별 덧붙임: 무드 칩 · 시간대 표 · 한 줄 설명
  const ruleExtra = el('div', 'sp-extra');
  const moodBox = el('div', 'sp-moods');
  moodBox.setAttribute('role', 'group'); moodBox.setAttribute('aria-label', tr('sound.pop.sec.mood'));
  const moodBtns = MOODS.map((m) => {
    const b = el('button', 'sp-chip sp-mood');
    b.type = 'button'; b.dataset.mood = m; b.title = tr(`sound.mood.${m}.title`);
    b.append(el('i', 'sp-md'), el('span', null, moodLabel(m)));
    b.addEventListener('click', () => { music.setMood(m); render(); });
    moodBox.appendChild(b);
    return b;
  });
  arrowNav(moodBox, () => moodBtns);
  const timeBox = el('div', 'sp-times');
  timeBox.setAttribute('role', 'group'); timeBox.setAttribute('aria-label', tr('sound.pop.sec.time'));
  const timeSel = {};
  for (const s of TIME_SLOTS) {
    const row = el('label', 'sp-slot');
    row.dataset.slot = s.id;
    const name = el('span', 'sp-slot-n');
    name.append(el('b', null, slotLabel(s.id)), el('span', 'sp-slot-r', slotRange(s.id)));
    const sel = el('select', 'sp-slot-sel');
    sel.setAttribute('aria-label', tr('sound.pop.slot.aria', { slot: slotLabel(s.id), range: slotRange(s.id) }));
    for (const m of MOODS) { const o = el('option', null, moodLabel(m)); o.value = m; sel.appendChild(o); }
    sel.addEventListener('change', () => { music.setTimeMood(s.id, sel.value); render(); });
    row.append(name, sel);
    timeBox.appendChild(row);
    timeSel[s.id] = { row, sel };
  }
  const ruleNote = el('p', 'sp-note');
  ruleExtra.append(moodBox, timeBox, ruleNote);
  ruleSec.append(ruleK, ruleBox, ruleExtra);

  // 플레이리스트: 탭 + 목록
  const listSec = el('div', 'sp-listsec');
  const tabs = el('div', 'sp-tabs');
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', tr('sound.pop.sec.list'));
  const tabBtns = TABS.map((l) => {
    const b = el('button', 'sp-tab');
    b.type = 'button'; b.dataset.list = l; b.id = 'sp-tab-' + l;
    b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', 'sp-list');
    b.append(el('span', 'sp-tab-n'), el('span', 'sp-tab-c'));
    b.addEventListener('click', () => { music.setList(l); render(); });
    tabs.appendChild(b);
    return b;
  });
  arrowNav(tabs, () => tabBtns);
  const listBox = el('div', 'sp-list');
  listBox.id = 'sp-list';
  listBox.setAttribute('role', 'tabpanel');
  listBox.tabIndex = -1;
  listBox.addEventListener('keydown', (e) => {
    const rows = [...listBox.querySelectorAll('.sp-trk')];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowDown') j = Math.min(rows.length - 1, i + 1);
    else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = rows.length - 1;
    if (j == null) return;
    e.preventDefault();
    rows[j].focus();
    rows[j].scrollIntoView({ block: 'nearest' });
  });
  listSec.append(tabs, listBox);

  // 음량: 기존 슬라이더 DOM 을 옮겨 온다
  const volBox = el('div', 'sp-vols');
  const partChips = {};
  const range = (input, part) => {
    if (!input) return null;
    const l = el('div', 'sp-range');
    l.dataset.part = part;
    let lead;
    if (part === 'sfx') {
      // 효과음 켬/끔 칩(음악 켬/끔은 위 재생/일시정지)
      lead = el('button', 'sp-chip sp-part');
      lead.type = 'button'; lead.dataset.part = part;
      lead.append(el('i', 'sp-dot'), el('span', null, tr('sound.pop.vol.sfx')));
      lead.addEventListener('click', () => { sound.setSfxOn(!sound.sfxOn); render(); });
      partChips[part] = lead;
    } else lead = el('span', 'sp-vk', tr('sound.pop.vol.music'));
    input.setAttribute('aria-label', tr(`sound.pop.vol.${part}.aria`));
    l.append(lead, input);
    return l;
  };
  for (const n of [range($('vol'), 'music'), range($('sfx-vol'), 'sfx')]) if (n) volBox.appendChild(n);
  const selEl = $('bgm-track');
  if (selEl) { selEl.hidden = true; selEl.tabIndex = -1; volBox.appendChild(selEl); } // 상태 확인용으로만 남김(조작은 위)

  const hint = el('p', 'sp-hint', tr('sound.pop.hint'));
  pop.append(head, now, ruleSec, listSec, volBox, hint);
  document.body.appendChild(pop);

  // .tb-more 에 조작이 하나도 안 남으면 숨김(과 같은 규칙)
  const more = document.querySelector('#topbar .tb-more');
  if (more && !more.querySelector('button, input, select')) more.hidden = true;

  // ── 목록 그리기(곡·탭·표현이 바뀔 때만 다시 만듦) ──
  let listKey = '';
  const rowsById = new Map();
  /** 탭 이름: 흐름 · Planet / 복셀 / 전체 */
  const tabName = (l) => (l === 'flow' ? TAB_VIEWS.flow.map((x) => RENDERER_LABEL[x] || x).join(' · ') : tr('sound.list.' + l));
  function buildList() {
    const rows = music.playlist();
    const tab = music.tab();
    const key = tab + '|' + rows.map((r) => r.id).join(',');
    if (key === listKey) return;
    listKey = key;
    listBox.textContent = '';
    rowsById.clear();
    const showViews = tab !== 'flow'; // 전체·복셀 탭은 행에 표현 이름(복셀은 오피스/연구소 구분)
    let n = 0;
    for (const g of playlistGroups(rows)) {
      const gh = el('div', 'sp-gh');
      gh.dataset.stage = g.stage == null ? '' : String(g.stage);
      gh.append(el('span', 'sp-gh-n', g.stage == null ? tr('sound.group.other') : stageLabel(g.stage)), el('span', 'sp-gh-c', String(g.rows.length)), el('span', 'sp-gh-now', tr('sound.pop.nowLevel')));
      listBox.appendChild(gh);
      for (const r of g.rows) {
        n++;
        const t = r.t;
        const b = el('button', 'sp-trk');
        b.type = 'button'; b.dataset.id = r.id;
        const ix = el('span', 'sp-ix');
        ix.append(el('span', 'sp-n', String(n)), el('span', 'sp-eq', null));
        ix.lastChild.append(el('i'), el('i'), el('i'));
        const body = el('span', 'sp-body');
        const tags = el('span', 'sp-tags');
        for (const m of r.moods) { const s = el('span', 'sp-tag'); s.dataset.mood = m; s.append(el('i', 'sp-md'), document.createTextNode(moodLabel(m))); tags.appendChild(s); }
        const vw = showViews ? r.views.filter((v) => tab === 'all' || TAB_VIEWS[tab].includes(v)) : [];
        if (vw.length) tags.appendChild(el('span', 'sp-vw', [...new Set(vw.map((v) => RENDERER_LABEL[v] || v))].join(' · ')));
        body.append(el('span', 'sp-tt', t.title || t.label), tags);
        const du = el('span', 'sp-du', fmtDur(t.duration));
        b.append(ix, body, du);
        b.title = [t.title, t.mood, t.bpm ? `${t.bpm} BPM` : '', t.key || ''].filter(Boolean).join(' · ');
        b.addEventListener('click', () => {
          music.playTrack(r.id);
          if (!sound.musicOn) sound.setMusicOn(true); // 음악을 멈춰 둔 채 행을 누르면 그 곡으로 재생
          render();
        });
        listBox.appendChild(b);
        rowsById.set(r.id, b);
      }
    }
    if (!rows.length) listBox.appendChild(el('p', 'sp-empty', music.available ? tr('sound.pop.empty') : tr('sound.noFiles')));
  }

  // ── 그리기 ──
  const STATE_TEXT = Object.fromEntries(['on', 'loading', 'waiting', 'held'].map((k) => [k, tr(`sound.pop.state.${k}`, { hint: tr('sound.waitHint') })]));
  function render() {
    const st = sound.status();
    const show = !!sound.on;
    if (btn.hidden === show) btn.hidden = !show;
    if (!show && !pop.hidden) setOpen(false, { focus: false });
    const t = music.track();
    const avail = !!music.available;
    const noMusic = !avail && !!music._probed;
    const noSfx = !sound.sfx || !sound.sfx._AudioCtx;
    const playing = sound.musicOn && !noMusic;
    const offs = [!sound.musicOn && !noMusic ? tr('sound.pop.off.music') : '', !sound.sfxOn && !noSfx ? tr('sound.pop.off.sfx') : ''].filter(Boolean);
    const name = !avail ? (music._probed ? tr('sound.noFiles') : tr('sound.pop.probing')) : t ? t.title || t.label : '—';
    const what = !sound.musicOn && !noMusic ? offs.join(' · ') : [avail && t ? `${t.title || t.label} · ${modeText(music)}` : name, ...offs].join(' · ');
    btn.title = tr('sound.pop.btn.title', { what });
    btn.setAttribute('aria-label', btn.title);
    if (pop.hidden) return; // 닫혀 있으면 버튼 툴팁만
    hState.textContent = [STATE_TEXT[st] || '', ...offs].filter(Boolean).join(' · ');
    if (partChips.sfx) {
      const c = partChips.sfx;
      c.disabled = noSfx;
      c.setAttribute('aria-pressed', String(sound.sfxOn && !noSfx));
      c.title = noSfx ? tr('sound.pop.part.sfx.none') : tr('sound.pop.part.sfx.title');
      c.parentNode.classList.toggle('off', !sound.sfxOn || noSfx);
    }
    pop.classList.toggle('sp-music-off', !playing && avail);
    pop.classList.toggle('sp-playing', playing && avail && st === 'on');

    // 지금 곡
    nowT.textContent = name;
    const lv = music.autoLevel != null ? stageLabel(music.autoLevel) : null;
    const am = music.activeMood();
    const ruleState = music.repeat ? tr('sound.pop.repeat')
      : music.rule === 'activity' ? (lv ? tr('sound.pop.activity', { level: lv }) : ruleLabel('activity'))
        : music.rule === 'time' ? tr('sound.pop.timeNow', { slot: slotLabel(timeSlot(music._date())), mood: moodLabel(am) })
          : music.rule === 'mood' ? tr('sound.pop.moodNow', { mood: moodLabel(am) }) : ruleLabel(music.rule);
    if (!playing && avail) nowS.textContent = tr('sound.pop.paused');
    else nowS.textContent = avail && t ? [ruleState, t.bpm ? `${t.bpm} BPM` : ''].filter(Boolean).join(' · ') : '';
    now.title = avail && t && t.mood ? t.mood : '';
    bPlay.innerHTML = playing ? I_PAUSE : I_PLAY;
    const pl = playing ? tr('sound.pop.pause') : tr('sound.pop.play');
    bPlay.title = pl; bPlay.setAttribute('aria-label', pl);
    bPlay.setAttribute('aria-pressed', String(playing));
    for (const b of [bPrev, bPlay, bNext, bRep]) b.disabled = !avail;
    bRep.setAttribute('aria-pressed', String(!!music.repeat));
    bRep.title = music.repeat ? tr('sound.pop.repeat.on') : tr('sound.pop.repeat.title');

    // 기준
    for (const b of ruleBtns) { b.setAttribute('aria-pressed', String(!music.repeat && b.dataset.rule === music.rule)); b.disabled = !avail; }
    ruleSec.dataset.rule = music.rule;
    moodBox.hidden = music.rule !== 'mood';
    timeBox.hidden = music.rule !== 'time';
    for (const b of moodBtns) b.setAttribute('aria-pressed', String(b.dataset.mood === music.mood));
    const slotNow = timeSlot(music._date());
    for (const [id, x] of Object.entries(timeSel)) {
      if (x.sel.value !== music.timeMoods[id]) x.sel.value = music.timeMoods[id];
      x.row.classList.toggle('now', id === slotNow);
    }
    // 무드 기준인데 이 목록에 그 무드 곡이 없으면 전체에서 고른다는 것을 알림
    const noMoodHere = am && !music.repeat && !music.playlist().some((r) => r.moods.includes(am));
    ruleNote.textContent = music.repeat ? tr('sound.pop.note.repeat') : noMoodHere ? tr('sound.pop.note.fallback', { mood: moodLabel(am) }) : tr(`sound.rule.${music.rule}.note`);

    // 탭
    const tabNow = music.tab(), here = tabOf(music.view);
    for (const b of tabBtns) {
      const l = b.dataset.list, on = l === tabNow;
      b.firstChild.textContent = tabName(l);
      b.lastChild.textContent = String(music.playlist(l).length);
      b.classList.toggle('here', l === here); // 지금 보는 표현의 탭(점)
      b.title = l === here ? tr('sound.pop.tab.here') : '';
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      b.disabled = !avail;
    }
    listBox.setAttribute('aria-labelledby', 'sp-tab-' + tabNow);

    // 목록: 지금 곡 · 기준 후보(작업 상태 = 지금 단계, 무드·시간대 = 그 무드) 강조
    buildList();
    const cand = avail && !music.repeat && music.rule !== 'shuffle' && music.rule !== 'loop'
      ? new Set(ruleCandidates({ rule: music.rule, tracks: music.tracks, list: music.list, view: music.view, level: music.autoLevel, mood: music.mood, timeMoods: music.timeMoods, date: music._date() }))
      : null;
    // 후보가 이 목록에 하나도 없으면(무드가 다른 목록에서 옴) 옅게 하지 않음 — 목록 전체가 꺼진 것처럼 보이지 않게
    listBox.classList.toggle('sp-filtered', !!cand && [...rowsById.keys()].some((id) => cand.has(id)));
    for (const [id, b] of rowsById) {
      const cur = id === music.cur;
      b.classList.toggle('cur', cur);
      b.classList.toggle('cand', !!cand && cand.has(id));
      b.classList.toggle('pin', id === music.pinned);
      if (cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      b.disabled = !avail;
    }
    for (const gh of listBox.querySelectorAll('.sp-gh')) gh.classList.toggle('now', music.rule === 'activity' && !music.repeat && gh.dataset.stage === String(music.autoLevel));
  }

  // ── 열고 닫기 ──
  const focusables = () => [...pop.querySelectorAll('button, input, select')].filter((x) => !x.hidden && !x.disabled && x.offsetParent !== null);
  function place() {
    const r = btn.getBoundingClientRect();
    const top = Math.round(r.bottom + 8);
    pop.style.top = top + 'px';
    pop.style.maxHeight = Math.max(240, innerHeight - top - 10) + 'px';
    if (innerWidth < 720) { pop.style.left = ''; pop.style.right = ''; return; } // CSS 시트(left·right 8px)
    const w = pop.offsetWidth || 380;
    const left = Math.max(8, Math.min(innerWidth - w - 8, Math.round(r.right - w)));
    pop.style.left = left + 'px'; pop.style.right = 'auto';
  }
  function showCur() {
    const b = rowsById.get(music.cur);
    if (!b) return;
    const lt = listBox.getBoundingClientRect(), bt = b.getBoundingClientRect();
    if (bt.top < lt.top + 24 || bt.bottom > lt.bottom) listBox.scrollTop += bt.top - lt.top - lt.height / 3;
  }
  function setOpen(on, { focus = true } = {}) {
    if (on === !pop.hidden) return;
    pop.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    btn.classList.toggle('on', on);
    if (on) {
      if (window.__ccvizSettings && window.__ccvizSettings.isOpen) window.__ccvizSettings.close();
      render(); place(); showCur();
      if (focus) { const f = (!bPlay.disabled && bPlay) || focusables()[0]; if (f) f.focus(); }
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
  // 탭을 바꾸면 지금 곡 행이 보이게
  for (const b of tabBtns) b.addEventListener('click', () => requestAnimationFrame(showCur));

  // ── 상태가 바뀌면 바로: Music 선택기 그리기·Sound 버튼 그리기 뒤에 덧붙임 ──
  const origSel = music._renderSelect.bind(music);
  music._renderSelect = function () { origSel(); render(); };
  const origRender = sound.render.bind(sound);
  sound.render = function () { origRender(); render(); };
  render();

  return { open: () => setOpen(true), close: () => setOpen(false), get isOpen() { return !pop.hidden; }, render, pop, button: btn };
}
