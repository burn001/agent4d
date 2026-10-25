// 상단 바 프로젝트 선택기: 버튼 하나 + 누르면 펼쳐지는 프로젝트 목록(전체 · 프로젝트들, 활성 점·세션 수).
// 예전의 상단 바 범위 드롭다운 + 사이드 패널 프로젝트 목록(세션 펼침) + 재생 고르기 창(프로젝트 칩·세션 목록)을 이것 하나로 합쳤다.
// 세션 단위 고르기는 화면 아래 매크로 타임라인(macro/macro.js)이 맡는다.
//   const ps = mountProjectSelector({ host, onSelect(sel), getNodeCount });
// 목록은 live·recent(임시 묶음·보관함)만 — 비활성 프로젝트는 싣지 않는다
//   ps.setProjects(list); ps.setArchive(summary); ps.setSelection(sel); ps.setLabel(text); ps.setDisabled(bool, title); ps.open(hint); ps.close();
import { mountProjectList, selectionLabel, dotOf, groupProjects } from './projects.js';
import { t } from './i18n.mjs';

export function mountProjectSelector({ host, onSelect = () => {}, getNodeCount = null } = {}) {
  host.classList.add('psel');
  host.innerHTML = `
    <button type="button" class="tb psel-btn" id="proj-btn" aria-haspopup="listbox" aria-expanded="false" title="${t('app.psel.title')}">
      <i class="pl-dot sm off" aria-hidden="true"></i><span class="psel-name">${t('app.proj.all')}</span><span class="psel-meta"></span>
      <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>
    </button>
    <div class="psel-pop" hidden>
      <p class="psel-hint" hidden></p>
      <div class="psel-list"></div>
    </div>`;
  const btn = host.querySelector('.psel-btn'), pop = host.querySelector('.psel-pop'), hintEl = host.querySelector('.psel-hint');
  const nameEl = host.querySelector('.psel-name'), metaEl = host.querySelector('.psel-meta'), dotEl = host.querySelector('.pl-dot');
  let projects = [], sel = { scope: 'all' }, label = null, disabled = false;

  const pl = mountProjectList({
    el: host.querySelector('.psel-list'), sessions: false, getNodeCount,
    onSelect: (s) => { close(); if (!s.again) onSelect(s); },
  });
  function renderBtn() {
    const arc = sel.scope === 'archive';
    const p = sel.scope !== 'all' && !arc ? projects.find((x) => x.projectId === sel.projectId) : null;
    const txt = label || selectionLabel(sel, projects, pl.archive);
    nameEl.textContent = txt;
    let meta = '';
    if (sel.scope === 'all') { const g = groupProjects(projects); meta = projects.length ? t('app.psel.metaProjects', { n: g.totals.projects - g.temp.length }) : ''; }
    else if (p && sel.scope === 'project') meta = p.live || p.liveSessions ? t('app.psel.metaSessions', { n: p.liveSessions }) : '';
    else if (arc && pl.archive) { const ap = sel.projectId ? (pl.archive.projects || []).find((x) => x.projectId === sel.projectId) : null; meta = t('app.psel.metaArchive', { n: ap ? ap.sessions : pl.archive.count }); }
    metaEl.textContent = meta;
    const dot = arc ? 'off' : sel.scope === 'all' ? (projects.some((x) => dotOf(x) === 'busy') ? 'busy' : projects.some((x) => dotOf(x) === 'idle') ? 'idle' : 'off') : dotOf(p);
    dotEl.className = 'pl-dot sm ' + dot;
    btn.title = disabled ? (btn.dataset.dtitle || '') : t('app.psel.btnTitle', { name: txt });
  }
  function open(hint = '') {
    if (disabled) return;
    hintEl.hidden = !hint; hintEl.textContent = hint || '';
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();
    if (innerWidth >= 720) { pop.style.left = Math.max(8, Math.min(innerWidth - 348, r.left)) + 'px'; pop.style.top = r.bottom + 6 + 'px'; }
    else { pop.style.left = ''; pop.style.top = r.bottom + 6 + 'px'; }
    const on = pop.querySelector('.pl-row.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function close() { if (pop.hidden) return; pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
  btn.addEventListener('click', () => { btn.blur(); if (pop.hidden) open(); else close(); });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !host.contains(e.target)) close(); }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { close(); e.stopPropagation(); } }, true);
  window.addEventListener('resize', () => close());

  renderBtn();
  return {
    setProjects(list) { projects = Array.isArray(list) ? list : []; pl.setProjects(projects); renderBtn(); },
    setSelection(next) { sel = next && next.scope ? { ...next } : { scope: 'all' }; pl.setSelection(sel); renderBtn(); },
    setLabel(s) { label = s || null; renderBtn(); },
    setArchive(a) { pl.setArchive(a); renderBtn(); }, // 보관함 요약(GET /archive)
    setDisabled(on, title = '') { disabled = !!on; btn.disabled = disabled; btn.dataset.dtitle = title; if (disabled) close(); renderBtn(); },
    open, close,
    get isOpen() { return !pop.hidden; },
    list: pl,
    get selection() { return { ...sel }; },
  };
}
