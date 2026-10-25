// 전체 보기 섬 이름표 문구·overview.css 불러오기(순수, three 없음) — islands.js(3D)와 2D 표현이 같이 쓴다
import { t as _t } from '../i18n.mjs';
export function ensureOverviewCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-ccviz="overview"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./overview.css', import.meta.url).href;
  l.dataset.ccviz = 'overview';
  document.head.appendChild(l);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** 섬 이름표 문구(순수) */
export function islandLabelHtml(c) {
  const n = c.liveSessions || (c.mains ? c.mains.length : 0);
  const cnt = c.inactive ? _t('scene.island.justEnded', { n: c.sessions || c.hiddenMains || 0 }) : _t('scene.island.sessions', { n });
  const dot = c.busy ? 'busy' : c.live && !c.inactive ? 'idle' : 'off';
  return `<i class="ov-dot ${dot}"></i><b>${esc(trunc(c.name || c.projectId, 28))}</b><span>${esc(cnt)}</span>`;
}
