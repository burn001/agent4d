// 매크로 타임라인: 프로젝트를 고르면 화면 아래(이벤트 띠 위)에 그 프로젝트의 세션들을 시간축 막대로 보여 주고,
// 막대를 누르면 그 세션 재생(막대 안 지점 = 그 시각부터, 앞 끝 = 처음부터, 실행 중 막대 뒤 끝 = 실시간으로 그 세션).
//   const mt = mountMacroTimeline({ el, api, onReplay(sid, atMs|null), onLive(sid, projectId), onPickProject(pid), getNames() });
//   mt.setContext({ mode: 'project'|'archive'|'all'|'off', projectId, label }); mt.setPlayhead(sid|null, vt); mt.refresh(); mt.reveal();
//   'archive': 보관함 세션만(sessions?source=archive, sessionId 'arc:…'), projectId 가 null 이면 보관함 전체
//   onAuto(on)·mt.setAuto(on): 머리의 '연속 재생' 단추 — 상태는 앱이 쥔다
// 가로 스크롤은 기본 스크롤(터치 관성 그대로), 휠 = 커서 기준 확대/축소, 마우스 끌기 = 이동. 색은 테마 토큰만(macro.css).
import { MT, normalizeSessions, attachChildren, packLanes, makeScale, clampPx, domainOf, zoomAround, defaultWindow, ticks,
  clickIntent, timeInBar, summarizeProjects, fmtRange, fmtHM, refEnd, fitWindow, minPxFor } from './macro-core.mjs';
import { fmtDuration, fmtCount } from '../replay/ui.mjs';
import { t } from '../i18n.mjs';

const LS_FOLD = 'ccviz.macro';
const LS_KIDS = 'ccviz.macro.kids';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 저장소 없음 */ } };

function ensureCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-ccviz="macro"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('./macro.css', import.meta.url).href; l.dataset.ccviz = 'macro';
  document.head.appendChild(l);
}

export function mountMacroTimeline({ el, api, onReplay = () => {}, onLive = () => {}, onPickProject = () => {}, getNames = () => new Map(),
  now = () => Date.now(), anchorEl = null, onAuto = null, getSessIdx = () => null } = {}) {
  ensureCss();
  let ctx = { mode: 'off', projectId: null };
  let raw = null, items = [], rows = null, lanes = 0, orphanLanes = 0;
  let pxPerMs = 0, d0 = 0, d1 = 0, laidOut = false, loadSeq = 0, loading = false, err = '';
  let collapsed = lsGet(LS_FOLD) === 'collapsed';
  let showKids = lsGet(LS_KIDS) === 'on';
  let play = null; // {sid, vt}
  let hover = null;

  el.classList.add('mt');
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', t('app.macro.aria'));
  el.innerHTML = `
    <div class="mt-head">
      <button type="button" class="mt-fold" aria-expanded="true" title="${esc(t('app.macro.fold'))}">
        <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10l4-4 4 4"/></svg>
      </button>
      <b class="mt-title"></b><span class="mt-sub" data-loading="${esc(t('app.macro.loadingAfter'))}"></span>
      <span class="mt-sp"></span>
      <div class="mt-ctl">
        <span class="mt-presets">${MT.PRESETS.map((p) => `<button type="button" data-span="${p.ms}" title="${esc(t('app.macro.recent', { span: p.label }))}">${p.label}</button>`).join('')}<button type="button" data-fit="1" title="${esc(t('app.macro.fitTitle'))}">${esc(t('app.macro.fit'))}</button></span>
        <button type="button" class="mt-z" data-z="0.5" title="${esc(t('app.macro.zoomOut'))}" aria-label="${esc(t('app.macro.zoomOut'))}">−</button><button type="button" class="mt-z" data-z="2" title="${esc(t('app.macro.zoomIn'))}" aria-label="${esc(t('app.macro.zoomIn'))}">+</button>
        <button type="button" class="mt-auto" aria-pressed="false" hidden title="${esc(t('app.macro.autoTitle'))}">${esc(t('app.macro.auto'))}</button>
        <label class="mt-kids" title="${esc(t('app.macro.kidsTitle'))}"><input type="checkbox"><span>claude -p</span></label>
      </div>
    </div>
    <div class="mt-body">
      <div class="mt-scroll" tabindex="-1">
        <div class="mt-inner">
          <div class="mt-axis"></div>
          <div class="mt-lanes"></div>
          <div class="mt-line mt-now" title="${esc(t('app.macro.now'))}" data-label="${esc(t('app.macro.now'))}"></div>
          <div class="mt-line mt-play" hidden></div>
          <div class="mt-line mt-hov" hidden></div>
        </div>
      </div>
      <div class="mt-tip" hidden></div>
      <p class="mt-empty" hidden></p>
    </div>`;
  const $ = (s) => el.querySelector(s);
  const head = $('.mt-head'), foldBtn = $('.mt-fold'), titleEl = $('.mt-title'), subEl = $('.mt-sub');
  const scroll = $('.mt-scroll'), inner = $('.mt-inner'), axis = $('.mt-axis'), lanesEl = $('.mt-lanes');
  const nowLine = $('.mt-now'), playLine = $('.mt-play'), hovLine = $('.mt-hov'), tip = $('.mt-tip'), empty = $('.mt-empty');
  const kidsChk = $('.mt-kids input');
  const autoBtn = $('.mt-auto');
  let autoOn = false;
  autoBtn.addEventListener('click', () => { autoBtn.blur(); if (onAuto) onAuto(!autoOn); });
  function setAuto(on) { autoOn = !!on; autoBtn.setAttribute('aria-pressed', String(autoOn)); autoBtn.textContent = autoOn ? '■ ' + t('app.macro.auto') : t('app.macro.auto'); }
  kidsChk.checked = showKids;

  // ---------- 배치·표시 ----------
  const W = () => Math.max(120, scroll.clientWidth || 600);
  const LANE_H = () => (innerWidth < 720 ? 15 : 17);
  const MAX_LANES_PX = () => (innerWidth < 720 ? 64 : 92);

  function setCollapsed(c, save = true) {
    collapsed = !!c;
    el.classList.toggle('mt-collapsed', collapsed);
    foldBtn.setAttribute('aria-expanded', String(!collapsed));
    if (save) lsSet(LS_FOLD, collapsed ? 'collapsed' : 'open');
    if (!collapsed) requestAnimationFrame(() => render(false));
    syncHeight();
  }
  foldBtn.addEventListener('click', () => { foldBtn.blur(); setCollapsed(!collapsed); });
  head.addEventListener('dblclick', (e) => { if (e.target === head || e.target === titleEl || e.target === subEl) setCollapsed(!collapsed); });

  function syncHeight() {
    const visible = !el.hidden;
    document.documentElement.style.setProperty('--mt-h', visible ? (el.offsetHeight || 0) + 'px' : '0px');
    document.body.classList.toggle('macro-on', visible);
  }
  // 이벤트 띠(#timeline) 바로 위에 붙인다 — 띠의 자리는 재생 막대·패널 시트·접힘에 따라 바뀌므로 그 자리를 재서 따라간다
  let followRaf = 0, followUntil = 0;
  function place() {
    const a = anchorEl;
    if (!a) return;
    const r = a.getBoundingClientRect();
    if (!r.width) return;
    el.style.left = Math.round(r.left) + 'px';
    el.style.width = Math.round(r.width) + 'px';
    el.style.bottom = Math.round(innerHeight - r.top) + 'px';
  }
  function follow(msDur = 400) {
    followUntil = Math.max(followUntil, performance.now() + msDur);
    if (followRaf) return;
    const step = () => { place(); if (performance.now() < followUntil) followRaf = requestAnimationFrame(step); else followRaf = 0; };
    followRaf = requestAnimationFrame(step);
  }
  window.addEventListener('resize', () => { follow(100); render(false); });
  new MutationObserver(() => follow(450)).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (anchorEl) new ResizeObserver(() => follow(100)).observe(anchorEl);
  new ResizeObserver(() => syncHeight()).observe(el);

  function laneCountPx(n) {
    const lh = LANE_H();
    const max = MAX_LANES_PX();
    return n * lh <= max ? lh : Math.max(6, Math.floor(max / Math.max(1, n)));
  }

  function rebuild() {
    const t = now();
    items = normalizeSessions((raw && raw.sessions) || [], t);
    if ((ctx.mode === 'project' || ctx.mode === 'archive') && ctx.projectId) items = items.filter((x) => x.projectId === ctx.projectId);
    rows = null;
    if (ctx.mode === 'all') rows = summarizeProjects(items, getNames(), innerWidth < 720 ? 5 : 8);
  }

  // 시간축 오른쪽 끝 기준: 보관함은 보관 세션의 마지막 끝, 그 밖은 지금
  const endRef = () => refEnd(items, ctx.mode, now());
  function ensureScale(resetView) {
    const w = W();
    if (resetView || !pxPerMs) {
      // 처음 구간: 보관함은 보관 세션 전부 맞춤, 그 밖은 최근 1～3일
      const win = ctx.mode === 'archive' ? fitWindow(items, now()) : defaultWindow(items, now());
      pxPerMs = clampPx(w / Math.max(60_000, win.t1 - win.t0), minPxFor(ctx.mode));
      const dom = domainOf(items, endRef(), pxPerMs, w / pxPerMs);
      d0 = dom.d0; d1 = dom.d1;
      inner.style.width = Math.ceil((d1 - d0) * pxPerMs) + 'px';
      scroll.scrollLeft = Math.max(0, (win.t1 - d0) * pxPerMs - w);
      return;
    }
    const dom = domainOf(items, endRef(), pxPerMs, w / pxPerMs);
    if (dom.d0 !== d0) { const shift = (d0 - dom.d0) * pxPerMs; d0 = dom.d0; scroll.scrollLeft += shift; }
    d1 = dom.d1;
    inner.style.width = Math.ceil((d1 - d0) * pxPerMs) + 'px';
  }

  function render(resetView = false) {
    if (el.hidden) return;
    if (!raw) { lanesEl.innerHTML = ''; axis.innerHTML = ''; return; }
    if (!items.length && !(rows && rows.length)) {
      lanesEl.innerHTML = ''; axis.innerHTML = '';
      empty.hidden = false;
      empty.textContent = err || (ctx.mode === 'all' ? t('app.macro.emptyAll') : ctx.mode === 'archive' ? t('app.macro.emptyArchive') : t('app.macro.emptyProject'));
      lanesEl.style.height = '24px';
      return;
    }
    empty.hidden = true;
    ensureScale(resetView || !laidOut);
    laidOut = true;
    const sc = makeScale(d0, pxPerMs);
    const minMs = MT.MIN_BAR_PX / pxPerMs, gapMs = MT.GAP_PX / pxPerMs;
    let html = '';
    let total = 0;
    if (ctx.mode === 'all') {
      const lh = laneCountPx(rows.length);
      rows.forEach((r, i) => {
        html += `<div class="mt-rowlab" style="top:${i * lh}px;height:${lh}px" data-pid="${esc(r.projectId)}"><span>${esc(r.name)}</span></div>`;
        for (const it of r.items) html += barHtml(it, sc, i * lh, lh - 3, { pid: r.projectId });
      });
      total = rows.length * lh;
    } else {
      const { mains, orphans } = attachChildren(items);
      lanes = packLanes(mains, { gapMs, minMs });
      orphanLanes = 0;
      const kids = showKids ? [...orphans, ...mains.flatMap((m) => m.children)] : orphans;
      const kidItems = kids.map((k) => k);
      if (showKids || orphans.length) orphanLanes = packLanes(kidItems, { gapMs, minMs });
      const n = lanes + (showKids ? orphanLanes : 0);
      const lh = laneCountPx(Math.max(1, n));
      for (const m of mains) html += barHtml(m, sc, m.lane * lh, lh - 3, {});
      if (showKids) for (const k of kidItems) html += barHtml(k, sc, (lanes + k.lane) * lh, Math.max(4, lh - 6), { kid: true });
      total = Math.max(1, n) * lh;
    }
    lanesEl.style.height = total + 'px';
    lanesEl.innerHTML = html;
    renderAxis(sc);
    placeLines(sc);
    syncHeight();
  }

  function barHtml(it, sc, top, h, { pid = null, kid = false }) {
    const x0 = sc.x(it.start), w = Math.max(MT.MIN_BAR_PX, sc.x(it.end) - x0);
    const cls = ['mt-bar'];
    if (it.running) cls.push('run'); if (it.busy) cls.push('busy'); if (kid || it.child) cls.push('kid'); if (it.approx) cls.push('approx');
    if (play && play.sid === it.id) cls.push('on');
    const si = it.running && !kid ? getSessIdx(it.id) : null; // 같은 프로젝트 live 메인 여럿이면 실행 중 막대에 세션 색
    if (si != null) cls.push('sess', 's' + si);
    let segs = '';
    if (!kid && it.children && it.children.length && !showKids) {
      for (const c of it.children) {
        const cx = Math.max(0, sc.x(c.start) - x0), cw = Math.max(2, sc.x(c.end) - sc.x(c.start));
        segs += `<i class="mt-seg" style="left:${cx.toFixed(1)}px;width:${cw.toFixed(1)}px"></i>`;
      }
    }
    const label = w > 46 && h >= 11 ? `<span class="mt-lab">${esc(it.title || it.id.slice(0, 8))}${it.children && it.children.length && !showKids ? ` <small>+${it.children.length}</small>` : ''}</span>` : '';
    return `<button type="button" class="${cls.join(' ')}" data-sid="${esc(it.id)}"${pid ? ` data-pid="${esc(pid)}"` : ''} style="left:${x0.toFixed(1)}px;width:${w.toFixed(1)}px;top:${top}px;height:${h}px" aria-label="${esc((it.title || it.id) + ' · ' + fmtRange(it.start, it.end))}">${segs}${label}</button>`;
  }

  function renderAxis(sc) {
    const t0 = sc.t(scroll.scrollLeft - 200), t1 = sc.t(scroll.scrollLeft + W() + 200);
    const { ticks: tk } = ticks(t0, t1, pxPerMs, innerWidth < 720 ? 52 : 64);
    axis.innerHTML = tk.map((k) => `<span class="mt-tk${k.day ? ' day' : ''}" style="left:${sc.x(k.t).toFixed(1)}px">${esc(k.label)}</span>`).join('');
  }
  function placeLines(sc = makeScale(d0, pxPerMs)) {
    nowLine.hidden = ctx.mode === 'archive'; // 보관함은 지난 기록 — '지금' 선 없음
    nowLine.style.left = sc.x(now()).toFixed(1) + 'px';
    const it = play && items.find((x) => x.id === play.sid);
    playLine.hidden = !it;
    if (it) playLine.style.left = sc.x(Math.max(it.start, Math.min(it.end, play.vt))).toFixed(1) + 'px';
  }

  // ---------- 상호작용 ----------
  let axisRaf = 0;
  scroll.addEventListener('scroll', () => { if (!axisRaf) axisRaf = requestAnimationFrame(() => { axisRaf = 0; renderAxis(makeScale(d0, pxPerMs)); }); tip.hidden = true; }, { passive: true });

  function zoomBy(f, cursorX = W() / 2) {
    const z = zoomAround({ pxPerMs, scrollLeft: scroll.scrollLeft, d0 }, f, cursorX, d0, minPxFor(ctx.mode));
    pxPerMs = z.pxPerMs;
    const dom = domainOf(items, endRef(), pxPerMs, W() / pxPerMs);
    d0 = dom.d0; d1 = dom.d1;
    inner.style.width = Math.ceil((d1 - d0) * pxPerMs) + 'px';
    scroll.scrollLeft = Math.max(0, (z.anchorT - d0) * pxPerMs - cursorX);
    render(false);
  }
  function showSpan(span) {
    const w = W();
    pxPerMs = clampPx(w / span, minPxFor(ctx.mode));
    const e = endRef();
    const dom = domainOf(items, e, pxPerMs, w / pxPerMs);
    d0 = dom.d0; d1 = dom.d1;
    inner.style.width = Math.ceil((d1 - d0) * pxPerMs) + 'px';
    scroll.scrollLeft = Math.max(0, (e + span * MT.PAD_RATIO - d0) * pxPerMs - w);
    render(false);
  }
  function fitAll() {
    const all = items.filter((x) => !x.child);
    if (!all.length) return;
    const e = endRef();
    const a = Math.min(...all.map((x) => x.start)), b = Math.max(...all.map((x) => x.end), e);
    const w = W();
    pxPerMs = clampPx(w / ((b - a) * 1.04 || 3_600_000), minPxFor(ctx.mode));
    const dom = domainOf(items, e, pxPerMs, w / pxPerMs);
    d0 = dom.d0; d1 = dom.d1;
    inner.style.width = Math.ceil((d1 - d0) * pxPerMs) + 'px';
    scroll.scrollLeft = Math.max(0, (b + (b - a) * 0.02 - d0) * pxPerMs - w);
    render(false);
  }
  head.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-span], button[data-fit], button[data-z]');
    if (!b) return;
    b.blur();
    if (b.dataset.span) showSpan(Number(b.dataset.span));
    else if (b.dataset.fit) fitAll();
    else zoomBy(Number(b.dataset.z));
  });
  kidsChk.addEventListener('change', () => { showKids = kidsChk.checked; lsSet(LS_KIDS, showKids ? 'on' : 'off'); render(false); });

  scroll.addEventListener('wheel', (e) => {
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey) {
      e.preventDefault();
      const r = scroll.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)), e.clientX - r.left);
    }
  }, { passive: false });

  // 마우스 끌기 = 이동(터치는 기본 스크롤)
  let drag = null, suppressClick = false;
  scroll.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, sl: scroll.scrollLeft, moved: false, id: e.pointerId };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 5) { drag.moved = true; try { scroll.setPointerCapture(drag.id); } catch (er) { /* 무시 */ } el.classList.add('mt-dragging'); }
    if (drag.moved) scroll.scrollLeft = drag.sl - dx;
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    suppressClick = drag.moved;
    drag = null; el.classList.remove('mt-dragging');
    setTimeout(() => { suppressClick = false; }, 0);
  });

  function itemOf(sid) { return items.find((x) => x.id === sid) || null; }
  lanesEl.addEventListener('click', (e) => {
    if (suppressClick) return;
    const lab = e.target.closest('.mt-rowlab');
    if (lab && ctx.mode === 'all') { onPickProject(lab.dataset.pid); return; }
    const b = e.target.closest('.mt-bar');
    if (!b) return;
    if (ctx.mode === 'all') { onPickProject(b.dataset.pid); return; }
    const it = itemOf(b.dataset.sid);
    if (!it) return;
    const r = b.getBoundingClientRect();
    const keyboard = e.detail === 0; // Enter·Space
    const xin = keyboard ? 0 : e.clientX - r.left;
    const intent = keyboard ? 'start' : clickIntent(it, xin, r.width);
    tip.hidden = true;
    if (intent === 'live') onLive(it.id, it.projectId);
    else onReplay(it.id, intent === 'at' ? timeInBar(it, xin, r.width) : null, it);
  });
  lanesEl.addEventListener('pointermove', (e) => {
    if (drag && drag.moved) return;
    const b = e.target.closest('.mt-bar');
    const lr = scroll.getBoundingClientRect();
    const x = e.clientX - lr.left;
    hovLine.hidden = false;
    hovLine.style.left = (scroll.scrollLeft + x).toFixed(1) + 'px';
    if (!b) { tip.hidden = true; hover = null; return; }
    const it = itemOf(b.dataset.sid);
    if (!it) return;
    hover = it.id;
    const r = b.getBoundingClientRect();
    const xin = e.clientX - r.left;
    let hint;
    if (ctx.mode === 'all') hint = t('app.macro.hint.project');
    else {
      const intent = clickIntent(it, xin, r.width);
      hint = intent === 'live' ? t('app.macro.hint.live') : intent === 'start' ? t('app.macro.hint.start') : t('app.macro.hint.at', { time: fmtHM(timeInBar(it, xin, r.width)) });
    }
    const kids = it.children && it.children.length ? ` · claude -p ${it.children.length}` : '';
    const ev = it.events != null ? ` · ${fmtCount(it.events, !it.exact)}` : '';
    tip.innerHTML = `<b>${esc(it.title || it.id.slice(0, 8))}</b>${it.running ? ` <em>${esc(it.busy ? t('app.macro.running') : t('app.macro.open'))}</em>` : ''}${it.child ? ' <em>claude -p</em>' : ''}`
      + `<span>${esc(fmtRange(it.start, it.end))}${it.running ? esc(t('app.macro.nowParen')) : ''} · ${esc(fmtDuration(it.end - it.start) || t('app.macro.zeroSec'))}${esc(ev)}${esc(kids)}${it.approx ? esc(t('app.macro.approxEnd')) : ''}</span><i>${esc(hint)}</i>`;
    tip.hidden = false;
    const tw = tip.offsetWidth || 200, bw = el.clientWidth;
    tip.style.left = Math.max(4, Math.min(bw - tw - 4, x - tw / 2)) + 'px';
  });
  lanesEl.addEventListener('pointerleave', () => { tip.hidden = true; hovLine.hidden = true; hover = null; });

  // ---------- 데이터 ----------
  async function load() {
    if (ctx.mode === 'off') return;
    const seq = ++loadSeq;
    loading = true; el.classList.add('mt-loading');
    const proj = ctx.projectId ? { project: ctx.projectId } : {};
    const q = ctx.mode === 'all' ? { sort: 'start', kind: 'main', limit: 200, since: String(now() - 14 * 86_400_000) }
      : ctx.mode === 'archive' ? { source: 'archive', sort: 'start', limit: 500, ...proj }
      : { sort: 'start', kind: 'main', limit: 300, ...proj };
    try {
      let r = await api.getJson('sessions', q);
      // 프로젝트: 메인을 먼저 받고(claude -p 자식이 수백 개라 한 번에 받으면 메인 범위가 짧아짐), 그 범위의 자식을 따로 받아 합친다
      if (ctx.mode === 'project' && r.status === 200 && r.body && Array.isArray(r.body.sessions) && r.body.sessions.length) {
        const first = Math.min(...r.body.sessions.map((x) => Date.parse(x.startedAt || x.endedAt) || Infinity));
        const r2 = await api.getJson('sessions', { sort: 'start', limit: 500, since: String(Number.isFinite(first) ? first : 0), ...proj });
        if (r2.status === 200 && r2.body && Array.isArray(r2.body.sessions)) {
          const seen = new Set(r.body.sessions.map((x) => x.sessionId));
          r = { ...r, body: { ...r.body, sessions: [...r.body.sessions, ...r2.body.sessions.filter((x) => !seen.has(x.sessionId))] } };
        }
      }
      if (seq !== loadSeq) return;
      if (r.status !== 200 || !r.body) { err = r.status === 401 ? t('app.macro.errAuth') : t('app.macro.errLoad'); raw = raw || { sessions: [] }; }
      else { err = ''; raw = r.body; }
    } catch (e) { if (seq !== loadSeq) return; err = t('app.macro.errLoad'); raw = raw || { sessions: [] }; }
    finally { if (seq === loadSeq) { loading = false; el.classList.remove('mt-loading'); } }
    rebuild();
    updateHead();
    render(false);
  }
  function updateHead() {
    const names = getNames();
    if (ctx.mode === 'all') {
      titleEl.textContent = t('app.macro.allTitle');
      subEl.textContent = rows ? t('app.macro.allSub', { n: rows.length }) : '';
    } else if (ctx.mode === 'archive') {
      titleEl.textContent = '📦 ' + (ctx.label || (ctx.projectId ? ctx.projectId.split('-').slice(-2).join('-') : t('app.proj.archive')));
      const mains = items.filter((x) => !x.child);
      subEl.textContent = raw ? t('app.macro.archiveSub', { n: mains.length }) : t('app.macro.loading');
    } else {
      titleEl.textContent = (ctx.projectId && names.get(ctx.projectId)) || ctx.label || (ctx.projectId ? ctx.projectId.split('-').slice(-2).join('-') : t('app.macro.session'));
      const mains = items.filter((x) => !x.child), run = mains.filter((x) => x.running).length, kids = items.length - mains.length;
      subEl.textContent = raw ? `${t('app.psel.metaSessions', { n: mains.length })}${run ? ' · ' + t('app.macro.runningN', { n: run }) : ''}${kids ? ` · claude -p ${kids}` : ''}${t('app.macro.clickReplay')}` : t('app.macro.loading');
    }
  }

  let timer = 0;
  function setContext(next) {
    const n = { mode: next && next.mode || 'off', projectId: (next && next.projectId) || null, label: next && next.label || null };
    const changed = n.mode !== ctx.mode || n.projectId !== ctx.projectId;
    ctx = n;
    el.hidden = ctx.mode === 'off';
    el.dataset.mode = ctx.mode;
    autoBtn.hidden = !onAuto || !(ctx.mode === 'project' || ctx.mode === 'archive');
    if (el.hidden) { syncHeight(); clearInterval(timer); timer = 0; return; }
    follow(50);
    if (changed) { raw = null; items = []; rows = null; laidOut = false; pxPerMs = 0; lanesEl.innerHTML = ''; axis.innerHTML = ''; updateHead(); load(); }
    else updateHead();
    if (!timer) timer = setInterval(() => { if (!document.hidden && !el.hidden) load(); }, 30_000);
    syncHeight();
  }

  /** 재생 위치: 재생 중인 세션이 이 타임라인에 있으면 세로선 + 그 막대 강조. 처음 보이면 화면 안으로 */
  let lastPlaySid = null;
  function setPlayhead(sid, vt) {
    play = sid ? { sid, vt } : null;
    const sc = makeScale(d0, pxPerMs);
    for (const b of lanesEl.querySelectorAll('.mt-bar.on')) if (b.dataset.sid !== sid) b.classList.remove('on');
    if (sid) { const b = lanesEl.querySelector(`.mt-bar[data-sid="${CSS.escape(sid)}"]`); if (b) b.classList.add('on'); }
    if (!pxPerMs) return;
    placeLines(sc);
    const pit = sid && items.find((x) => x.id === sid);
    if (pit && sid !== lastPlaySid) {
      const x = sc.x(Math.max(pit.start, Math.min(pit.end, vt))), w = W();
      if (x < scroll.scrollLeft + 20 || x > scroll.scrollLeft + w - 20) scroll.scrollLeft = Math.max(0, x - w * 0.3);
    }
    lastPlaySid = sid;
  }
  /** '재생' 버튼: 접혀 있으면 펼치고 잠깐 강조 */
  function reveal() {
    if (el.hidden) return false;
    if (collapsed) setCollapsed(false);
    el.classList.remove('mt-flash'); void el.offsetWidth; el.classList.add('mt-flash');
    setTimeout(() => el.classList.remove('mt-flash'), 1600);
    return true;
  }
  // 지금 선·실행 중 막대 늘이기: 30초 load 와 별개로 10초마다 다시 그림
  setInterval(() => { if (!el.hidden && raw && !document.hidden) { rebuild(); render(false); } }, 10_000);

  setCollapsed(collapsed, false);
  el.hidden = true;
  syncHeight();

  return {
    setContext, setPlayhead, reveal, refresh: load, setAuto,
    get auto() { return autoOn; },
    setCollapsed: (c) => setCollapsed(c),
    get context() { return { ...ctx }; },
    get items() { return items; },
    get state() { return { pxPerMs, d0, d1, lanes, orphanLanes, collapsed, showKids, loading, scrollLeft: scroll.scrollLeft, width: W() }; }, // 시험용
    showSpan, fitAll, zoomBy,
  };
}
