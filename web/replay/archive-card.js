// 보관함 설명 카드: 보관 세션을 재생하는 동안 무대 오른쪽 위 구석에 보관 사유(why)·지표·시각(KST).
//   const card = mountArchiveCard({ host: document.body });  card.show(sessionSummary|null); card.hide();
// 접기 상태는 localStorage 'ccviz.arccard' (open|collapsed), 좁은 화면(720 미만)은 처음엔 접힘.
import { archiveCardModel } from './demo-core.mjs';
import { t } from '../i18n.mjs';
import { localizeServerText } from '../i18n-server.mjs';

const LS = 'ccviz.arccard';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsGet = () => { try { return localStorage.getItem(LS); } catch (e) { return null; } };
const lsSet = (v) => { try { localStorage.setItem(LS, v); } catch (e) { /* 저장소 없음 */ } };

function ensureCss() {
  if (document.querySelector('link[data-ccviz="arccard"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('./archive-card.css', import.meta.url).href; l.dataset.ccviz = 'arccard';
  document.head.appendChild(l);
}

export function mountArchiveCard({ host = document.body } = {}) {
  ensureCss();
  const el = document.createElement('section');
  el.id = 'arc-card';
  el.className = 'arcc';
  el.setAttribute('aria-label', t('replay.arc.aria'));
  el.hidden = true;
  host.appendChild(el);
  const saved = lsGet();
  let collapsed = saved ? saved === 'collapsed' : innerWidth < 720;
  let cur = null;

  function render() {
    const m = archiveCardModel(cur);
    if (!m) { el.innerHTML = ''; return; }
    el.classList.toggle('arcc-collapsed', collapsed);
    el.innerHTML = `
      <button type="button" class="arcc-head" aria-expanded="${!collapsed}" title="${esc(t(collapsed ? 'replay.arc.expand' : 'replay.arc.collapse'))}">
        <span class="arcc-ic" aria-hidden="true">📦</span><b>${esc(t('replay.arc.head'))}</b>
        <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>
      </button>
      <div class="arcc-body">
        <p class="arcc-title">${esc(m.title)}</p>
        ${m.why.length ? `<ul class="arcc-why">${m.why.map((w) => `<li>${esc(localizeServerText(w))}</li>`).join('')}</ul>` : ''}
        ${m.stats.length ? `<dl class="arcc-stats">${m.stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        ${m.range ? `<p class="arcc-range">${esc(m.range)}</p>` : ''}
      </div>`;
    el.querySelector('.arcc-head').addEventListener('click', (e) => {
      e.currentTarget.blur();
      collapsed = !collapsed; lsSet(collapsed ? 'collapsed' : 'open'); render();
    });
  }
  return {
    show(s) { cur = s || null; el.hidden = !cur; render(); },
    hide() { cur = null; el.hidden = true; },
    get visible() { return !el.hidden; },
    get collapsed() { return collapsed; },
    el,
  };
}
