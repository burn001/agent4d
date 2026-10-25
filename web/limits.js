// 사용 한도 게이지 — 5시간·7일 창 사용률과 재설정까지 남은 시간.
//   const lg = mountLimits({ el /* #limits */, now = () => Date.now() });
//   lg.set(limits /* *); lg.setReplaying(bool); lg.dispose;
// formatLimit·formatAge·formatRemain·formatResetAt 은 DOM 없는 순수 함수(node 시험 대상).
// 값만 받는다 — 자격증명·토큰은 이 모듈에 절대 들어오지 않는다(서버가 퍼센트·리셋 시각만 보냄).

import { t as tr, locale } from './i18n.mjs';

const pad = (n) => String(n).padStart(2, '0');
export const WARN_PCT = 70;
export const DANGER_PCT = 90;
export const STALE_SEC = 600;
const srcLabel = (k) => (k === 'statusline' || k === 'oauth' ? tr(`sound.lim.src.${k}`) : '');
const winLabel = (k) => tr(`sound.lim.win.${k}`);
const WIN_SHORT = { five_hour: '5h', seven_day: '7d' };

const msOf = (iso) => { const t = typeof iso === 'number' ? iso : Date.parse(iso || ''); return Number.isFinite(t) ? t : null; };

/** 남은 시간: 1시간 미만 `n분`, 24시간 미만 `h:mm`, 그 이상 `n일 n시간` */
export function formatRemain(sec) {
  if (sec == null || !isFinite(sec)) return '';
  sec = Math.max(0, sec);
  if (sec < 3600) return tr('sound.lim.min', { n: Math.max(1, Math.ceil(sec / 60)) });
  if (sec < 86400) { const m = Math.floor(sec / 60); return `${Math.floor(m / 60)}:${pad(m % 60)}`; }
  const h = Math.floor(sec / 3600), d = Math.floor(h / 24), r = h % 24;
  return r ? tr('sound.lim.dayHour', { d, h: r }) : tr('sound.lim.day', { d });
}

/** 리셋 시각 `10월 23일 (목) 19:00` · 영어 `Fri, Oct 23, 19:00` (보는 사람 지역 시각, Intl) */
const resetFmt = new Map();
export function formatResetAt(iso) {
  const t = msOf(iso);
  if (t == null) return '';
  const L = locale();
  let f = resetFmt.get(L);
  if (!f) {
    f = new Intl.DateTimeFormat(L, { month: L.startsWith('ko') ? 'long' : 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    resetFmt.set(L, f);
  }
  return f.format(new Date(t));
}

/** 확인 시각 나이 → '방금' | 'n분 전 기준' | 'n시간 전 기준' | 'n일 전 기준' */
export function formatAge(capturedAt, nowMs = Date.now()) {
  const t = msOf(capturedAt);
  if (t == null) return '';
  const s = Math.max(0, (nowMs - t) / 1000);
  if (s < 60) return tr('sound.lim.age.now');
  if (s < 3600) return tr('sound.lim.age.min', { n: Math.floor(s / 60) });
  if (s < 86400) return tr('sound.lim.age.hour', { n: Math.floor(s / 3600) });
  return tr('sound.lim.age.day', { n: Math.floor(s / 86400) });
}
/** 나이 문구를 툴팁용으로: '방금' 이면 '방금 확인' */
const ageNote = (age) => (age === tr('sound.lim.age.now') ? tr('sound.lim.justChecked') : age);

export function pctText(p) {
  if (p == null || !isFinite(p)) return '—';
  const r = Math.round(p * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)) + '%';
}

export function levelOf(p) {
  if (p == null || !isFinite(p)) return 'none';
  return p >= DANGER_PCT ? 'danger' : p >= WARN_PCT ? 'warn' : 'ok';
}

/**
 * 창 하나 표시값(순수).
 * @param win {pct, resetsAt, source?, capturedAt?, expired?} | null
 * @returns {{ pctText, level:'ok'|'warn'|'danger'|'expired'|'none', resetText, title, pct }}
 */
export function formatLimit(win, nowMs = Date.now(), { name = '' } = {}) {
  if (!win || win.pct == null || !isFinite(win.pct)) return { pctText: '—', level: 'none', resetText: '', title: (name ? tr('sound.lim.headNone', { name }) : '') + tr('sound.lim.noValue'), pct: 0 };
  const reset = msOf(win.resetsAt);
  const expired = !!win.expired || (reset != null && reset <= nowMs);
  const src = srcLabel(win.source);
  const age = win.capturedAt ? formatAge(win.capturedAt, nowMs) : '';
  const head = name ? tr('sound.lim.head', { name }) : '';
  if (expired) {
    return { pctText: tr('sound.lim.reset'), level: 'expired', resetText: tr('sound.lim.waitNew'), pct: 0,
      title: [head + tr('sound.lim.resetWait'), reset != null ? tr('sound.lim.resetAt', { at: formatResetAt(reset) }) : '', src && tr('sound.lim.src', { src })].filter(Boolean).join('\n') };
  }
  const pct = Math.max(0, Math.min(100, win.pct));
  const remain = reset != null ? formatRemain((reset - nowMs) / 1000) : '';
  return {
    pctText: pctText(pct), level: levelOf(pct), pct,
    resetText: remain ? tr('sound.lim.remain', { remain }) : '',
    title: [head + tr('sound.lim.used', { pct: pctText(pct) }), reset != null ? tr('sound.lim.resetAtRemain', { at: formatResetAt(reset), remain }) : '', src && tr('sound.lim.src', { src }), age && ageNote(age)].filter(Boolean).join('\n'),
  };
}

/** Limits → 화면 모델(순수). 나이·stale 은 now 기준으로 다시 계산한다 */
export function limitsView(limits, nowMs = Date.now()) {
  const L = limits || {};
  const wins = ['five_hour', 'seven_day'].map((k) => ({ key: k, win: L[k] || null }));
  const any = wins.some((w) => w.win && w.win.pct != null);
  if (!L || L.disabled || !any) return { visible: false, stale: false, age: '', items: [] };
  const cap = msOf(L.capturedAt);
  const ageSec = cap != null ? (nowMs - cap) / 1000 : (L.ageSec ?? null);
  const staleSec = L.staleSec || STALE_SEC;
  const stale = !!L.stale || (ageSec != null && ageSec > staleSec);
  return {
    visible: true, stale,
    age: L.capturedAt ? formatAge(L.capturedAt, nowMs) : '',
    source: srcLabel(L.source),
    items: wins.map((w) => ({ key: w.key, name: winLabel(w.key), short: WIN_SHORT[w.key], ...formatLimit(w.win, nowMs, { name: winLabel(w.key) }), resetAt: w.win ? formatResetAt(w.win.resetsAt) : '', winSource: w.win ? srcLabel(w.win.source) : '' })),
  };
}

// ───────────────────────── 마운트 ─────────────────────────
function ensureCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-ccviz="limits"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./limits.css', import.meta.url).href;
  l.dataset.ccviz = 'limits';
  document.head.appendChild(l);
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountLimits({ el, now = () => Date.now() } = {}) {
  ensureCss();
  let data = null, replaying = false, open = false, timer = 0, lastHtml = '';
  el.classList.add('lim');
  el.hidden = true;
  el.innerHTML = `
    <div class="lim-pills"></div>
    <button type="button" class="lim-mini" aria-expanded="false" aria-label="${esc(tr('sound.lim.more'))}"></button>
    <div class="lim-card" role="dialog" aria-label="${esc(tr('sound.lim.title'))}" hidden></div>`;
  const pills = el.querySelector('.lim-pills'), mini = el.querySelector('.lim-mini'), card = el.querySelector('.lim-card');

  function setOpen(on) {
    open = !!on;
    card.hidden = !open;
    mini.setAttribute('aria-expanded', String(open));
    el.classList.toggle('open', open);
    if (open) render(true);
  }
  mini.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  const onDoc = (e) => { if (open && !el.contains(e.target)) setOpen(false); };
  const onKey = (e) => { if (open && e.key === 'Escape') setOpen(false); };
  document.addEventListener('pointerdown', onDoc, true);
  document.addEventListener('keydown', onKey);

  function render(force = false) {
    const v = limitsView(data, now());
    if (!v.visible) { if (!el.hidden) el.hidden = true; lastHtml = ''; return; }
    const note = replaying ? '\n' + tr('sound.lim.live') : '';
    const ageTag = v.stale && v.age ? `<span class="lim-age">${esc(v.age)}</span>` : ''; // 바깥 ageNote() 함수를 가리지 않게
    const pillsHtml = v.items.map((it) => `
      <span class="lim-pill lv-${it.level}${v.stale ? ' stale' : ''}" title="${esc(it.title + note)}">
        <span class="lim-bar" aria-hidden="true"><i style="width:${it.level === 'expired' || it.level === 'none' ? 0 : it.pct}%"></i></span>
        <span class="lim-name">${esc(it.name)}</span>
        <b class="lim-pct">${esc(it.pctText)}</b>${it.resetText ? `<span class="lim-reset">· ${esc(it.resetText)}</span>` : ''}
      </span>`).join('') + ageTag;
    const miniHtml = v.items.map((it) => `
      <span class="lim-row lv-${it.level}${v.stale ? ' stale' : ''}"><span class="lim-k">${esc(it.short)}</span><span class="lim-bar" aria-hidden="true"><i style="width:${it.level === 'expired' || it.level === 'none' ? 0 : it.pct}%"></i></span><b>${esc(it.level === 'expired' ? '↺' : it.pctText)}</b></span>`).join('');
    const cardHtml = `<h4>${esc(tr('sound.lim.title'))}${replaying ? ` <small>${esc(tr('sound.lim.live'))}</small>` : ''}</h4>` + v.items.map((it) => `
      <div class="lim-crow lv-${it.level}">
        <div class="lim-ch"><span>${esc(it.name)}</span><b>${esc(it.pctText)}</b></div>
        <span class="lim-bar" aria-hidden="true"><i style="width:${it.level === 'expired' || it.level === 'none' ? 0 : it.pct}%"></i></span>
        <div class="lim-cm">${esc(it.level === 'expired' ? tr('sound.lim.resetWait') : it.resetAt ? `${tr('sound.lim.resetAt', { at: it.resetAt })} · ${it.resetText}` : tr('sound.lim.noValue'))}</div>
      </div>`).join('') + `<p class="lim-src">${esc(v.source ? tr('sound.lim.src', { src: v.source }) : '')}${v.age ? ' · ' + esc(ageNote(v.age)) : ''}</p>`;
    const html = pillsHtml + '|' + miniHtml + '|' + (open ? cardHtml : '');
    if (!force && html === lastHtml) return;
    lastHtml = html;
    pills.innerHTML = pillsHtml;
    mini.innerHTML = miniHtml;
    mini.title = v.items.map((it) => it.title).join('\n\n') + note;
    el.classList.toggle('stale', v.stale);
    if (open) card.innerHTML = cardHtml;
    el.hidden = false;
  }
  timer = setInterval(() => render(), 1000);

  return {
    set(limits) { data = limits || null; render(true); },
    setReplaying(on) { replaying = !!on; render(true); },
    get value() { return data; },
    dispose() {
      clearInterval(timer);
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey);
      el.innerHTML = ''; el.classList.remove('lim', 'open', 'stale'); el.hidden = true;
    },
  };
}
