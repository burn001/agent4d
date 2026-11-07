// 시스템 메모리(PC RAM) 게이지 — 상단 바, 한도 게이지(#limits) 바로 뒤의 작은 알약 `RAM 62%` + 아래 얇은 막대.
//   const mg = mountMem();
//   mg.set({ used, total, pct })   // SSE `mem` 마다(mock 은 고정 값)
//   mg.setReplaying(bool)          // 재생·보관함 재생 중에는 숨김(실시간 값이라 지난 장면과 섞지 않음)
//   mg.setStale(bool)              // 스트림이 끊기면 흐리게(마지막 값)
// 마우스를 올리면 '사용 / 전체 GB', 누르면 작은 카드. 값만 받는다(프로세스·커널 값 없음). ⚙ 표시 줄에서 켬/끔(sysmem-pref.mjs).
import { memView } from './sysmem-core.mjs';
import { memGaugeOn, onMemGauge } from './sysmem-pref.mjs';
import { t as tr } from './i18n.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ensureCss() {
  if (document.querySelector('link[data-ccviz="sysmem"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./sysmem.css', import.meta.url).href;
  l.dataset.ccviz = 'sysmem';
  document.head.appendChild(l);
}

export function mountMem() {
  ensureCss();
  const top = document.getElementById('topbar');
  const el = document.createElement('div');
  el.id = 'mem-gauge'; el.className = 'memg'; el.hidden = true;
  el.innerHTML = `<button type="button" class="memg-pill" aria-haspopup="true" aria-expanded="false" aria-label="${esc(tr('sound.mem.more'))}">`
    + `<span class="memg-name">${esc(tr('sound.mem.pill'))}</span><b class="memg-pct">—</b><span class="memg-bar" aria-hidden="true"><i></i></span></button>`
    + '<div class="memg-card" role="dialog" hidden></div>';
  const lim = document.getElementById('limits');
  if (lim && lim.parentNode) lim.after(el); else if (top) top.appendChild(el);
  const pill = el.querySelector('.memg-pill'), pct = el.querySelector('.memg-pct'), bar = el.querySelector('.memg-bar i'), card = el.querySelector('.memg-card');
  card.setAttribute('aria-label', tr('sound.mem.title'));
  let data = null, replaying = false, stale = false, last = '';

  const close = () => { card.hidden = true; pill.setAttribute('aria-expanded', 'false'); };
  pill.addEventListener('click', (e) => { e.stopPropagation(); card.hidden = !card.hidden; pill.setAttribute('aria-expanded', String(!card.hidden)); render(true); });
  document.addEventListener('pointerdown', (e) => { if (!card.hidden && !el.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !card.hidden) close(); });

  function render(force = false) {
    const v = memView(data, { on: memGaugeOn(), replaying, stale });
    if (!v.visible) { el.hidden = true; close(); last = ''; return; }
    const key = [v.level, v.pctText, v.usedText, v.totalText, v.stale, card.hidden].join('|');
    if (!force && key === last) return;
    last = key;
    el.hidden = false;
    pill.className = 'memg-pill lv-' + v.level + (v.stale ? ' stale' : '');
    pct.textContent = v.pctText;
    bar.style.width = v.pct.toFixed(1) + '%';
    pill.title = v.title;
    if (!card.hidden) {
      card.innerHTML = `<h4>${esc(tr('sound.mem.title'))}</h4>`
        + `<div class="memg-ch lv-${v.level}"><span>${esc(tr('sound.mem.used', { used: v.usedText, total: v.totalText, pct: v.pctText }))}</span></div>`
        + `<span class="memg-cbar lv-${v.level}" aria-hidden="true"><i style="width:${v.pct.toFixed(1)}%"></i></span>`
        + `<p class="memg-cm">${esc(tr('sound.mem.avail', { avail: v.availText }))}${v.stale ? ' · ' + esc(tr('sound.mem.stale')) : ''}</p>`
        + `<p class="memg-src">${esc(tr('sound.mem.src'))}</p>`;
    }
  }
  onMemGauge(() => render(true));

  return {
    set(v) { data = v || null; render(); },
    setReplaying(on) { replaying = !!on; render(true); },
    setStale(on) { if (stale === !!on) return; stale = !!on; render(true); },
    get value() { return data; },
    el,
  };
}
