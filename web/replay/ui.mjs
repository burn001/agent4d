// 재생 UI: 하단 재생 막대 + 세션 고르기 대화상자.
//   const ui = mountReplayUI({ bar, picker, api, onPick(sessionId), onLive(), getEngine: () => eng });
//   ui.openPicker(); ui.closePicker(); ui.bind(engine); ui.unbind(); ui.setVisible(bool);
// 문구는 web/i18n/replay.mjs 사전(t). 색은 테마 토큰만 쓴다(replay.css). DOM 이 없는 곳(node 시험)에서도 import 는 된다(포맷 함수용).

import { SPEEDS, stepSpeed, clampSpeed } from './engine.mjs';
import { highlightNear, seekTargetOf } from './highlights.mjs';
import { ensureProjectsCss } from '../projects.js';
import { t, isKo, fmtDate as i18nDate, fmtTime, fmtNum } from '../i18n.mjs';
import { highlightLabel } from './highlights.mjs';

const PREF_KEY = 'ccviz.replay';
const pad = (n) => String(n).padStart(2, '0');

// ───────────────────────── 포맷(순수) ─────────────────────────
export function fmtClock(ms) {
  const d = new Date(ms);
  if (isNaN(d)) return '--:--:--';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** 경과 12:03 / 1:12:03 */
export function fmtElapsed(ms) {
  ms = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(ms / 3600), m = Math.floor((ms % 3600) / 60), s = ms % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
/** 10월 21일 (화) 14:03 · Tue, Oct 21 14:03 (Intl) */
export function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${i18nDate(d, { year: false, weekday: true })} ${fmtTime(d)}`;
}
/** 1시간 12분 · 12분 · 45초 */
export function fmtDuration(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return t('replay.dur.s', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t('replay.dur.m', { n: m });
  const h = Math.floor(m / 60), r = m % 60;
  if (h >= 24) { const d = Math.floor(h / 24), hh = h % 24; return hh ? t('replay.dur.dh', { d, h: hh }) : t('replay.dur.d', { n: d }); }
  return r ? t('replay.dur.hm', { h, m: r }) : t('replay.dur.h', { n: h });
}
/** 유휴 3분 12초 */
export function fmtSkip(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return t('replay.dur.s', { n: s });
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return t('replay.dur.hm', { h, m });
  return r ? t('replay.dur.ms', { m, s: r }) : t('replay.dur.m', { n: m });
}
/** ≈1.2만 건 · ≈3,400건 · 120건 (영어: ≈12K events · ≈3,400 events) */
export function fmtCount(n, approx = true) {
  if (n == null || !isFinite(n)) return '';
  const p = approx ? '≈' : '';
  if (n >= 10000) {
    if (!isKo()) return p + t('replay.count.man', { n: fmtNum(n, { notation: 'compact', maximumFractionDigits: 1 }) });
    const v = n / 10000; return p + t('replay.count.man', { n: v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '') });
  }
  return p + t('replay.count', { n: fmtNum(Math.round(n)) });
}
/** cwd 의 마지막 두 단계 */
export function projectLabel(cwd, projectDir) {
  const parts = String(cwd || '').split(/[\\/]+/).filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join(' / ');
  if (parts.length === 1) return parts[0];
  return projectDir || t('replay.unknownProject');
}
export function speedLabel(s) { return (s === 0.5 ? '0.5' : String(s)) + '×'; }

/** /sessions 응답 → [{projectDir, label, lastMtime, items:[…]}] (최근순).
 *  opts: {showChildren, query, project(projectDir 또는 'all'), names(Map projectDir → 사람이 읽는 이름)} */
export function groupSessions(resp, { showChildren = false, query = '', project = 'all', names = null } = {}) {
  const list = (resp && resp.sessions) || [];
  const q = query.trim().toLowerCase();
  const groups = new Map();
  // 묶음 순서는 마지막 기록(endedAt), 묶음 안 줄은 첫 기록(startedAt) — 줄에 보이는 날짜가 시작 시각이므로(정렬 버그)
  const t = (s) => Date.parse(s.endedAt || s.mtime) || 0;
  const st = (s) => Date.parse(s.startedAt || s.endedAt || s.mtime) || 0;
  for (const s of list) {
    const child = s.isChild || s.entrypoint === 'sdk-cli';
    if (child && !showChildren) continue;
    if (q && !(String(s.title || '').toLowerCase().includes(q) || String(s.sessionId).toLowerCase().startsWith(q))) continue;
    const k = s.projectDir || '?';
    if (project && project !== 'all' && k !== project) continue;
    if (!groups.has(k)) groups.set(k, { projectDir: k, label: (names && names.get(k)) || projectLabel(s.cwd, s.projectDir), lastMtime: 0, items: [] });
    const g = groups.get(k);
    g.items.push(s);
    g.lastMtime = Math.max(g.lastMtime, t(s));
  }
  const out = [...groups.values()];
  for (const g of out) g.items.sort((a, b) => st(b) - st(a) || (a.sessionId < b.sessionId ? -1 : 1));
  out.sort((a, b) => b.lastMtime - a.lastMtime);
  return out;
}

export function loadPrefs() {
  const d = { speed: 1, compressIdle: true };
  try {
    const s = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
    if (s && typeof s.speed === 'number') d.speed = clampSpeed(s.speed);
    if (s && typeof s.compressIdle === 'boolean') d.compressIdle = s.compressIdle;
  } catch (e) { /* 저장소 없음 */ }
  return d;
}
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {} }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const ICON = {
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3.2" height="11" rx="1" fill="currentColor"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="1" fill="currentColor"/></svg>',
  replay: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.5v3h3"/></svg>',
  live: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="currentColor"/><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".55"/></svg>',
  list: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 4h10M3 8h10M3 12h6"/></svg>',
  close: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

function ensureCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-ccviz="replay"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./replay.css', import.meta.url).href;
  l.dataset.ccviz = 'replay';
  document.head.appendChild(l);
}

// ───────────────────────── 마운트 ─────────────────────────
export function mountReplayUI({ bar, picker = null, api, onPick = () => {}, onLive = () => {}, getEngine = () => null, getCurrentSessionId = () => null, getProjects = null, getSelectedProject = null, onPickList = null,
  onSpeed = null, onAutoSpeed = null } = {}) {
  ensureCss();
  // 앱은 세션 고르기 창 대신 매크로 타임라인을 쓴다(picker 없음 → 막대의 '세션' 버튼은 onPickList). 개발 페이지는 예전 창 그대로
  const pickerless = !picker;
  if (pickerless) picker = document.createElement('div');
  if (getProjects) ensureProjectsCss();
  const doc = document;
  let eng = null, unsubs = [], visible = false;
  let prefs = loadPrefs();
  let sessionsCache = null, sessionsAt = 0;
  let pickerState = { showChildren: false, query: '', project: 'all' };
  let lastFocus = null;

  // ---------- 재생 막대 ----------
  bar.classList.add('rp-bar');
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', t('replay.bar.aria'));
  bar.innerHTML = `
    <div class="rp-ctl">
      <button type="button" class="rp-btn rp-play" title="${esc(t('replay.play.title'))}" aria-label="${esc(t('replay.play'))}">${ICON.play}</button>
      <label class="rp-speed" title="${esc(t('replay.speed.title'))}"><span class="sr">${esc(t('replay.speed'))}</span>
        <select>${SPEEDS.map((s) => `<option value="${s}">${speedLabel(s)}</option>`).join('')}</select>
      </label>
      <button type="button" class="rp-auto" hidden aria-pressed="true" title="${esc(t('replay.auto.title'))}">${esc(t('replay.auto'))}</button>
      <label class="rp-idle" title="${esc(t('replay.idle.title'))}" data-short="${esc(t('replay.idle.short'))}"><input type="checkbox"><span>${esc(t('replay.idle'))}</span></label>
    </div>
    <div class="rp-tl">
      <canvas tabindex="0" role="slider" aria-label="${esc(t('replay.pos.aria'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></canvas>
      <div class="rp-tip" hidden></div>
      <div class="rp-toast" aria-live="polite"></div>
    </div>
    <div class="rp-info">
      <span class="rp-time"><b>--:--:--</b><span class="rp-end"> / --:--:--</span> <small></small></span>
      <span class="rp-prog"></span>
    </div>
    <div class="rp-end-ctl">
      <button type="button" class="rp-btn rp-pick" title="${esc(t(pickerless ? 'replay.pick.titleMacro' : 'replay.pick.title'))}">${ICON.list}<span>${esc(t('replay.pick'))}</span></button>
      <button type="button" class="rp-btn rp-live" title="${esc(t('replay.live.title'))}">${ICON.live}<span>${esc(t('replay.live'))}</span></button>
    </div>`;
  const $b = (s) => bar.querySelector(s);
  const playBtn = $b('.rp-play'), speedSel = $b('.rp-speed select'), idleChk = $b('.rp-idle input');
  const canvas = $b('.rp-tl canvas'), tip = $b('.rp-tip'), toast = $b('.rp-toast');
  const timeNow = $b('.rp-time b'), timeEnd = $b('.rp-end'), timeEl = $b('.rp-time small'), progEl = $b('.rp-prog');
  const liveBtn = $b('.rp-live'), pickBtn = $b('.rp-pick');
  const tl = $b('.rp-tl');

  playBtn.addEventListener('click', () => { if (eng) { if (eng.status === 'ended') eng.play(); else eng.toggle(); } playBtn.blur(); });
  speedSel.addEventListener('change', () => { if (eng) eng.setSpeed(Number(speedSel.value)); prefs.speed = Number(speedSel.value); savePrefs(prefs); speedSel.blur(); if (onSpeed) onSpeed(Number(speedSel.value)); });
  const autoBtn = $b('.rp-auto');
  autoBtn.addEventListener('click', () => { autoBtn.blur(); if (onAutoSpeed) onAutoSpeed(); });
  /** 연속 재생 '자동' 표시: shown = 연속 재생 중, auto = 자동 속도가 걸려 있음 */
  function setAutoSpeed({ shown = false, auto = true } = {}) {
    autoBtn.hidden = !shown;
    autoBtn.setAttribute('aria-pressed', String(!!auto));
    autoBtn.textContent = t(auto ? 'replay.auto' : 'replay.manual');
    autoBtn.title = t(auto ? 'replay.auto.titleOn' : 'replay.auto.titleOff');
  }
  idleChk.addEventListener('change', () => { if (eng) eng.setCompressIdle(idleChk.checked); prefs.compressIdle = idleChk.checked; savePrefs(prefs); });
  liveBtn.addEventListener('click', () => { liveBtn.blur(); onLive(); });
  pickBtn.addEventListener('click', () => { pickBtn.blur(); if (onPickList) onPickList(); else openPicker(); });

  // ---------- 타임라인 canvas ----------
  let W = 0, H = 0, dpr = 1, staticLayer = null, staticDirty = true, drawPending = 0;
  let dragT = null, hoverX = null;
  const colors = {};
  function readColors() {
    const cs = getComputedStyle(doc.documentElement);
    for (const k of ['text', 'muted', 'error', 'ok', 'link', 'skill', 'k-main', 'k-subagent', 'warn', 'bg']) colors[k] = cs.getPropertyValue('--' + k).trim() || '#888';
    colors.accent = colors['k-main'];
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(10, Math.round(r.width)); H = Math.max(10, Math.round(r.height));
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    staticDirty = true; draw();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const mo = new MutationObserver(() => { staticDirty = true; draw(); });
  mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const range = () => (eng && eng.timeline ? [eng.startT, Math.max(eng.startT + 1, eng.endT)] : [0, 1]);
  const xOf = (t) => { const [a, b] = range(); return ((t - a) / (b - a)) * W; };
  const tOfX = (x) => { const [a, b] = range(); return a + Math.max(0, Math.min(1, x / W)) * (b - a); };

  function buildStatic() {
    readColors();
    const c = staticLayer || doc.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const top = 6, bot = H - 7, h = bot - top;
    // 트랙
    g.fillStyle = colors.text; g.globalAlpha = 0.08; roundRect(g, 0, top, W, h, 4); g.fill(); g.globalAlpha = 1;
    const tlData = eng && eng.timeline;
    if (tlData && tlData.buckets && tlData.buckets.counts) {
      const B = tlData.buckets, n = B.counts.length, [a] = range();
      // 60초+ 공백 음영
      g.fillStyle = colors.muted; g.globalAlpha = 0.3;
      for (const gp of tlData.gaps || []) { const x0 = xOf(Date.parse(gp.from)), x1 = xOf(Date.parse(gp.to)); g.fillRect(x0, top, Math.max(1, x1 - x0), h); }
      g.globalAlpha = 1;
      // 밀도 막대(√)
      let max = 1; for (const v of B.counts) if (v > max) max = v;
      g.fillStyle = colors.accent; g.globalAlpha = 0.6;
      for (let i = 0; i < n; i++) {
        const v = B.counts[i]; if (!v) continue;
        const x0 = xOf(a + i * B.size), x1 = xOf(a + (i + 1) * B.size);
        const bh = Math.max(1.5, Math.sqrt(v / max) * (h - 2));
        g.fillRect(x0, bot - bh, Math.max(1, x1 - x0 - (x1 - x0 > 3 ? 1 : 0)), bh);
      }
      g.globalAlpha = 1;
      // 에이전트 생성(위쪽 눈금)
      g.fillStyle = colors['k-subagent'];
      for (let i = 0; i < n; i++) if (B.spawns && B.spawns[i]) { const x = xOf(a + (i + 0.5) * B.size); g.beginPath(); g.moveTo(x - 3, 0); g.lineTo(x + 3, 0); g.lineTo(x, 5); g.closePath(); g.fill(); }
      // 오류(아래 빨간 눈금)
      g.fillStyle = colors.error;
      for (let i = 0; i < n; i++) if (B.errors && B.errors[i]) { const x = xOf(a + (i + 0.5) * B.size); g.fillRect(x - 1, bot + 1, 2, 5); }
    }
    // 하이라이트(볼거리): 묶음 구간 옅은 띠 + 위쪽 둥근 깃발. 누르면 그 지점(3초 앞)으로
    for (const hl of (tlData && tlData.highlights) || []) {
      const col = hlColor(hl.kind);
      const x0 = xOf(hl.t), x1 = Math.max(x0 + 2, xOf(hl.t1 || hl.t));
      g.fillStyle = col; g.globalAlpha = 0.16; g.fillRect(x0, top, x1 - x0, h); g.globalAlpha = 1;
      g.fillRect(x0 - 0.75, top, 1.5, h);
      g.beginPath(); g.arc(x0, top + 1, 4, 0, Math.PI * 2); g.fill();
      g.strokeStyle = colors.bg; g.lineWidth = 1; g.stroke();
    }
    staticLayer = c;
    staticDirty = false;
  }
  function hlColor(kind) { return kind === 'error' ? colors.error : kind === 'bg' ? colors.warn : colors['k-subagent']; }
  const hlAt = (x) => highlightNear(eng && eng.timeline && eng.timeline.highlights, x, xOf, 7);
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  function draw() {
    if (drawPending) return;
    drawPending = requestAnimationFrame(() => { drawPending = 0; drawNow(); });
  }
  function drawNow() {
    if (!W) return;
    if (staticDirty) buildStatic();
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(staticLayer, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!eng || !eng.timeline) return;
    const top = 6, bot = H - 7;
    // 적재되지 않은 뒤쪽은 흐리게
    if (eng.contig < eng.total && eng.total > 0) {
      const lastT = eng.contig > 0 ? eng.ev[eng.contig - 1].t : eng.startT;
      const x = xOf(lastT);
      g.fillStyle = colors.bg; g.globalAlpha = 0.55; g.fillRect(x, top, W - x, bot - top); g.globalAlpha = 1;
    }
    const vt = dragT != null ? dragT : eng.vt;
    const x = Math.max(0, Math.min(W, xOf(vt)));
    // 지난 구간
    g.fillStyle = colors.accent; g.globalAlpha = 0.14; g.fillRect(0, top, x, bot - top); g.globalAlpha = 1;
    // 손잡이
    g.fillStyle = colors.text; g.fillRect(x - 1, 2, 2, H - 4);
    g.beginPath(); g.arc(x, H / 2, 5.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = colors.accent; g.beginPath(); g.arc(x, H / 2, 3.2, 0, Math.PI * 2); g.fill();
    if (hoverX != null && dragT == null) { g.fillStyle = colors.muted; g.globalAlpha = 0.6; g.fillRect(hoverX, top, 1, bot - top); g.globalAlpha = 1; }
  }

  // 드래그(초당 최대 8회 seek, 놓을 때 최종 1회)
  let lastSeekAt = 0, seekTimer = 0, dragging = false;
  const evX = (e) => e.clientX - canvas.getBoundingClientRect().left;
  function seekThrottled(t, final) {
    if (!eng) return;
    clearTimeout(seekTimer);
    const now = performance.now();
    if (final || now - lastSeekAt >= 125) { lastSeekAt = now; eng.seek(t); }
    else seekTimer = setTimeout(() => { lastSeekAt = performance.now(); eng && eng.seek(dragT != null ? dragT : t); }, 125 - (now - lastSeekAt));
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!eng || !eng.timeline || e.button > 0) return;
    // 하이라이트 깃발을 누르면 끌기 대신 그 지점으로 바로
    const hl = hlAt(evX(e));
    if (hl) { eng.seek(seekTargetOf(hl, eng.startT)); if (eng.status !== 'playing') eng.play(); flash(highlightLabel(hl)); e.preventDefault(); return; }
    dragging = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    dragT = tOfX(evX(e)); seekThrottled(dragT, false); draw(); updateTime();
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const x = evX(e);
    if (dragging) { dragT = tOfX(x); seekThrottled(dragT, false); updateTime(); }
    else hoverX = x;
    showTip(x);
    draw();
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    const t = tOfX(evX(e));
    dragT = null;
    seekThrottled(t, true);
    draw();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { hoverX = null; if (!dragging) tip.hidden = true; draw(); });
  function showTip(x) {
    if (!eng || !eng.timeline) { tip.hidden = true; return; }
    const tt = tOfX(x);
    const B = eng.timeline.buckets;
    let extra = '';
    if (B && B.counts) { const i = Math.min(B.counts.length - 1, Math.max(0, Math.floor((tt - eng.startT) / B.size))); if (B.counts[i]) extra = ` · ${t('replay.tip.events', { n: B.counts[i] })}`; if (B.errors && B.errors[i]) extra += ` · ${t('replay.tip.errors', { n: B.errors[i] })}`; }
    const hl = !dragging && hlAt(x);
    canvas.style.cursor = hl ? 'pointer' : '';
    tip.textContent = hl ? t('replay.tip.hl', { label: highlightLabel(hl), time: fmtClock(hl.t) }) : `${fmtClock(tt)} ${t('replay.elapsed', { t: fmtElapsed(tt - eng.startT) })}${extra}`;
    tip.hidden = false;
    const tw = tip.offsetWidth || 120;
    tip.style.left = Math.max(0, Math.min(W - tw, x - tw / 2)) + 'px';
  }

  // ---------- 상태 표시 ----------
  let toastTimer = 0, toastAcc = 0;
  function onClock(vt, x) {
    if (x && x.skippedMs >= 1000) {
      toastAcc += x.skippedMs;
      toast.textContent = t('replay.skipped', { t: fmtSkip(toastAcc) });
      toast.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.classList.remove('on'); toastAcc = 0; }, 1800);
    }
    updateTime();
    draw();
  }
  function updateTime() {
    if (!eng || !eng.timeline) { timeNow.textContent = '--:--:--'; timeEnd.textContent = ' / --:--:--'; timeEl.textContent = ''; return; }
    const vt = dragT != null ? dragT : eng.vt;
    timeNow.textContent = fmtClock(vt);
    timeEnd.textContent = ` / ${fmtClock(eng.endT)}`;
    timeEl.textContent = t('replay.elapsed', { t: fmtElapsed(vt - eng.startT) });
    const pct = eng.endT > eng.startT ? Math.round(((vt - eng.startT) / (eng.endT - eng.startT)) * 100) : 0;
    canvas.setAttribute('aria-valuenow', String(pct));
    canvas.setAttribute('aria-valuetext', t('replay.elapsedAria', { clock: fmtClock(vt), t: fmtElapsed(vt - eng.startT) }));
  }
  let lastTl = null;
  function onState(s) {
    const playing = s.status === 'playing' || s.status === 'buffering';
    playBtn.innerHTML = s.status === 'ended' ? ICON.replay : playing ? ICON.pause : ICON.play;
    playBtn.setAttribute('aria-label', t(s.status === 'ended' ? 'replay.restart' : playing ? 'replay.pause' : 'replay.play'));
    playBtn.disabled = s.status === 'loading' || s.status === 'error';
    if (Number(speedSel.value) !== s.speed) speedSel.value = String(s.speed);
    idleChk.checked = s.compressIdle;
    let p = '';
    bar.dataset.status = s.status;
    if (s.status === 'loading') {
      const pr = s.progress;
      p = pr && pr.bytesTotal ? t('replay.st.preparingPct', { p: Math.min(99, Math.round((pr.bytesRead / pr.bytesTotal) * 100)) }) : t('replay.st.preparing');
    } else if (s.status === 'error') p = s.error || t('replay.st.error');
    else if (s.status === 'buffering') p = t('replay.st.buffering');
    else if (s.status === 'ended') p = t(s.complete ? 'replay.st.ended' : 'replay.st.endedLive');
    else if (s.total && s.contig < s.total) p = t('replay.st.loadedPct', { p: Math.floor((s.contig / s.total) * 100) });
    else if (!s.complete) p = t('replay.st.partial');
    progEl.textContent = p;
    progEl.classList.toggle('err', s.status === 'error');
    liveBtn.classList.toggle('hot', s.status === 'ended' && !s.complete);
    if (eng && eng.timeline !== lastTl) { lastTl = eng.timeline; staticDirty = true; }
    updateTime();
    draw();
  }

  // ---------- 단축키 ----------
  function onKey(e) {
    if (!picker.hidden && e.key === 'Escape') { closePicker(); e.preventDefault(); return; }
    if (!visible || !eng || !picker.hidden) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tg = e.target;
    if (tg && tg.closest && tg.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"]')) return;
    const k = e.key;
    let handled = true;
    if (k === ' ' || e.code === 'Space') { if (eng.status === 'ended') eng.play(); else eng.toggle(); }
    else if (k === ',') eng.seek(eng.vt - 10000);
    else if (k === '.') eng.seek(eng.vt + 10000);
    else if (k === '<') eng.seek(eng.vt - 60000);
    else if (k === '>') eng.seek(eng.vt + 60000);
    else if (k === 'n' || k === 'N' || k === 'b' || k === 'B') {
      // 다음(n)·이전(b) 볼거리
      const list = (eng.timeline && eng.timeline.highlights) || [];
      const fwd = k === 'n' || k === 'N';
      const cur = eng.vt;
      const hl = fwd ? list.find((x) => seekTargetOf(x, eng.startT) > cur + 1000) : [...list].reverse().find((x) => seekTargetOf(x, eng.startT) < cur - 1500);
      if (hl) { eng.seek(seekTargetOf(hl, eng.startT)); flash(highlightLabel(hl)); } else flash(t(list.length ? (fwd ? 'replay.hl.noNext' : 'replay.hl.noPrev') : 'replay.hl.none'));
    }
    else if (k === '[' || k === ']') { eng.setSpeed(stepSpeed(eng.speed, k === ']' ? 1 : -1)); prefs.speed = eng.speed; savePrefs(prefs); flash(t('replay.speedFlash', { s: speedLabel(eng.speed) })); if (onSpeed) onSpeed(eng.speed); }
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }
  window.addEventListener('keydown', onKey, true);
  function flash(text) {
    toast.textContent = text; toast.classList.add('on'); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.classList.remove('on'); toastAcc = 0; }, 1200);
  }

  // ---------- 세션 고르기 ----------
  picker.classList.add('rp-picker');
  picker.innerHTML = `
    <div class="rp-dlg" role="dialog" aria-modal="true" aria-labelledby="rp-dlg-title">
      <header>
        <h2 id="rp-dlg-title">${esc(t('replay.dlg.title'))}</h2>
        <span class="rp-sub"></span>
        <button type="button" class="rp-btn rp-x" aria-label="${esc(t('replay.close'))}" title="${esc(t('replay.close.title'))}">${ICON.close}</button>
      </header>
      <div class="rp-tools">
        <input type="search" placeholder="${esc(t('replay.search'))}" aria-label="${esc(t('replay.search'))}">
        <label><input type="checkbox" class="rp-child"> ${esc(t('replay.children'))}</label>
      </div>
      <div class="rp-proj" role="listbox" aria-label="${esc(t('replay.proj.aria'))}" hidden></div>
      <div class="rp-list" tabindex="-1"><p class="rp-empty">${esc(t('replay.loadingList'))}</p></div>
    </div>`;
  const $p = (s) => picker.querySelector(s);
  const listEl = $p('.rp-list'), searchEl = $p('input[type=search]'), childChk = $p('.rp-child'), subEl = $p('.rp-sub'), projEl = $p('.rp-proj');
  projEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-proj]');
    if (!b) return;
    pickerState.project = b.dataset.proj || 'all';
    renderList();
  });
  picker.addEventListener('pointerdown', (e) => { if (e.target === picker) closePicker(); });
  $p('.rp-x').addEventListener('click', () => closePicker());
  searchEl.addEventListener('input', () => { pickerState.query = searchEl.value; renderList(); });
  childChk.addEventListener('change', () => { pickerState.showChildren = childChk.checked; renderList(); });
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sid]');
    if (!b) return;
    const sid = b.dataset.sid;
    closePicker();
    onPick(sid);
  });
  // 대화상자 안에서 Tab 순환
  picker.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...picker.querySelectorAll('button, input, [data-sid]')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(doc.activeElement);
    if (e.shiftKey && (i <= 0)) { f[f.length - 1].focus(); e.preventDefault(); }
    else if (!e.shiftKey && i === f.length - 1) { f[0].focus(); e.preventDefault(); }
  });

  function itemHtml(s, { current = false } = {}) {
    const title = trunc(s.title || s.sessionId.slice(0, 8), 60);
    const live = s.live ? `<span class="rp-live-dot ${s.liveStatus === 'busy' ? 'busy' : ''}" title="${esc(t(s.liveStatus === 'busy' ? 'replay.live.busy' : 'replay.live.open'))}">●</span>` : '';
    const child = s.isChild || s.entrypoint === 'sdk-cli' ? '<span class="rp-tag">claude -p</span>' : '';
    const cnt = s.eventCount != null ? fmtCount(s.eventCount, false) : fmtCount(s.eventCountEst);
    const meta = [fmtDate(s.startedAt || s.mtime), fmtDuration(s.durationMs), cnt].filter(Boolean).join(' · ');
    const isCur = current ? `<span class="rp-tag cur">${esc(t('replay.tag.current'))}</span>` : '';
    const playing = eng && eng.sessionId === s.sessionId ? `<span class="rp-tag on">${esc(t('replay.tag.playing'))}</span>` : '';
    return `<button type="button" class="rp-item" data-sid="${esc(s.sessionId)}" title="${esc(s.title || '')}\n${esc(s.sessionId)}">
      <span class="rp-t">${live}${esc(title)}${child}${isCur}${playing}</span>
      <span class="rp-m">${esc(meta)}${s.replayCached ? ` · <i>${esc(t('replay.cached'))}</i>` : ''}</span></button>`;
  }
  function projNames() {
    const m = new Map();
    let list = null;
    try { list = getProjects ? getProjects() : null; } catch (e) { list = null; }
    for (const p of list || []) if (p && p.projectId && p.name) m.set(p.projectId, p.name);
    return m;
  }
  function renderProjChips(resp, names) {
    if (!getProjects) { projEl.hidden = true; return; }
    const all = groupSessions(resp, { showChildren: pickerState.showChildren, query: '', names });
    if (pickerState.project !== 'all' && !all.some((g) => g.projectDir === pickerState.project)) {
      const nm = names.get(pickerState.project);
      all.unshift({ projectDir: pickerState.project, label: nm || pickerState.project, items: [] });
    }
    let sel = null;
    try { sel = getSelectedProject ? getSelectedProject() : null; } catch (e) { sel = null; }
    // 전체 · <현재 선택 프로젝트> · 나머지(최근순)
    all.sort((a, b) => ((b.projectDir === sel) - (a.projectDir === sel)));
    const chip = (key, label, n) => `<button type="button" class="pl-chip${pickerState.project === key ? ' on' : ''}" role="option" aria-selected="${pickerState.project === key}" data-proj="${esc(key)}" title="${esc(key === 'all' ? t('replay.proj.allTitle') : key)}">${esc(trunc(label, 24))}${n != null ? ` <small>${n}</small>` : ''}</button>`;
    projEl.innerHTML = chip('all', t('replay.proj.all'), null) + all.map((g) => chip(g.projectDir, g.label, g.items.length)).join('');
    projEl.hidden = all.length < 1;
  }
  function renderList() {
    if (!sessionsCache) return;
    const resp = sessionsCache;
    const names = getProjects ? projNames() : null;
    renderProjChips(resp, names || new Map());
    const groups = groupSessions(resp, { ...pickerState, names });
    const curId = getCurrentSessionId() || resp.auto || null;
    let cur = curId && (resp.sessions || []).find((s) => s.sessionId === curId);
    if (cur && pickerState.project !== 'all' && cur.projectDir !== pickerState.project) cur = null; // 프로젝트로 거르면 그 밖 현재 세션은 숨김
    const parts = [];
    if (cur && !pickerState.query) parts.push(`<section class="rp-grp cur"><h3>${esc(t('replay.tag.current'))}</h3>${itemHtml(cur, { current: true })}</section>`);
    const showCur = !!(cur && !pickerState.query);
    for (const g of groups) {
      const items = showCur ? g.items.filter((s) => s.sessionId !== curId) : g.items; // 현재 세션은 맨 위에만
      if (!items.length) continue;
      parts.push(`<section class="rp-grp"><h3 title="${esc(g.projectDir)}">${esc(g.label)} <small>${g.items.length}</small></h3>${items.map((s) => itemHtml(s, { current: s.sessionId === curId })).join('')}</section>`);
    }
    listEl.innerHTML = parts.length ? parts.join('') : `<p class="rp-empty">${esc(t(pickerState.query ? 'replay.noResults' : 'replay.noSessions'))}</p>`;
    const n = (resp.sessions || []).length;
    const np = resp.projects && resp.projects.length ? resp.projects.length : groupSessions(resp, { showChildren: true }).length;
    subEl.textContent = t('replay.sub', { n, np });
  }
  async function loadSessions(force) {
    if (!force && sessionsCache && Date.now() - sessionsAt < 30000) { renderList(); return; }
    if (!sessionsCache) listEl.innerHTML = `<p class="rp-empty">${esc(t('replay.loadingList'))}</p>`;
    try {
      const r = await api.getJson('sessions', { limit: 200 });
      if (r.status === 401) { listEl.innerHTML = `<p class="rp-empty err">${esc(t('replay.err.auth'))}</p>`; return; }
      if (r.status !== 200 || !r.body) throw new Error(String(r.status));
      sessionsCache = r.body; sessionsAt = Date.now();
      renderList();
    } catch (e) {
      if (!sessionsCache) listEl.innerHTML = `<p class="rp-empty err">${esc(t('replay.err.list'))}</p>`;
    }
  }
  function openPicker() {
    if (pickerless) { if (onPickList) onPickList(); return; }
    lastFocus = doc.activeElement;
    picker.hidden = false;
    doc.body.classList.add('rp-modal-open');
    childChk.checked = pickerState.showChildren;
    searchEl.value = pickerState.query;
    if (getSelectedProject) { let sp = null; try { sp = getSelectedProject(); } catch (e) { sp = null; } pickerState.project = sp || 'all'; }
    loadSessions(false);
    setTimeout(() => searchEl.focus(), 0);
  }
  function closePicker() {
    if (picker.hidden) return;
    picker.hidden = true;
    doc.body.classList.remove('rp-modal-open');
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }

  // ---------- 바인딩 ----------
  function bind(engine, { applyPrefs = true } = {}) {
    unbind();
    eng = engine || getEngine();
    if (!eng) return;
    if (applyPrefs) { eng.setSpeed(prefs.speed); eng.setCompressIdle(prefs.compressIdle); }
    unsubs.push(eng.on('state', onState), eng.on('clock', onClock));
    lastTl = null; staticDirty = true;
    onState(eng.state);
  }
  function unbind() {
    for (const u of unsubs) u();
    unsubs = [];
    eng = null;
    staticDirty = true;
    progEl.textContent = '';
    draw();
  }
  function setVisible(on) {
    visible = !!on;
    bar.hidden = !visible;
    doc.body.classList.toggle('replaying', visible);
    if (visible) requestAnimationFrame(resize);
  }
  bar.hidden = true;
  picker.hidden = true;

  return {
    openPicker, closePicker, bind, unbind, setVisible, setAutoSpeed,
    refreshSessions: () => loadSessions(true),
    get prefs() { return { ...prefs }; },
    get engine() { return eng; },
    destroy() {
      unbind(); ro.disconnect(); mo.disconnect();
      window.removeEventListener('keydown', onKey, true);
      bar.innerHTML = ''; picker.innerHTML = '';
    },
  };
}
