// 입력 대기 배지: 사용자 답을 기다리는 세션이 있으면 패널 머리(실황/Interactive 전환 옆)에 '입력 대기 n' 배지.
// 누르면 대기 세션 목록(하나뿐이면 바로) → 그 세션으로 Interactive 전환·선택·질문 카드로 스크롤·잠깐 강조.
// 3D·2D 화면에는 그 세션 메인 노드 위에 작은 '?' 표식(세 표현 공통 — 무대 위 HTML 층, 누르면 같은 이동).
// 신호: 화면 store(메인 노드 openTools 의 AskUserQuestion·ExitPlanMode, 전체 보기 루트 meta.liveWait) + 승인 기기면 Interactive 세션 목록의 세션 기록 대기.
// 소리·알림(푸시)은 없다. 재생 중에는 끈다. 앱 본체와는 window.__ccviz(store·view·replaying·panel)만 읽는다.
import { t } from './i18n.mjs';
import { escapeHtml } from './html-util.mjs';
import { isShown } from './camera-core.mjs';
import { toScreen, camScale } from './flat/flat-core.mjs';
import { nodeWaits, mergeWaits, newWaits, waitKey, waitPrio, ageText, waitHead, waitName, WAIT_POLL_MS } from './wait-core.mjs';

const SESS_FRESH_MS = 60_000; // 이보다 오래된 Interactive 세션 목록은 믿지 않음(화면 신호만)
const STATUS_EVERY_MS = 60_000; // 실황을 보는 동안 기기 상태 다시 확인 간격
const BLINK_MS = 3200;

function ensureCss() {
  if (document.querySelector('link[data-wait-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'wait.css'; l.dataset.waitCss = '1';
  document.head.appendChild(l);
}

/** 노드 위 표식 자리(무대 기준 px) | null — plan-ui.js boardProject 와 같은 투영(3D 카메라·2D toScreen) */
function markPos(view, id, stageRect) {
  const v = view.vis && view.vis.get && view.vis.get(id);
  if (v && !isShown(v)) return null;
  const home = view.planHome ? view.planHome(id) : view.nodePos ? view.nodePos(id) : null;
  if (!home) return null;
  const r = (view.nodeRadius && view.nodeRadius(id)) || 1;
  const dom = view.renderer && view.renderer.domElement;
  const rect = dom ? dom.getBoundingClientRect() : stageRect;
  if (view.flat) {
    if (!view.cam) return null;
    const q = toScreen(view.cam, view.W, view.H, home.x, home.z, {});
    return { x: rect.left - stageRect.left + q.x, y: rect.top - stageRect.top + q.y - r * camScale(view.cam, view.H) - 12 };
  }
  const cam = view.camera;
  if (!cam || !home.clone) return null;
  const w = home.clone(); w.y += r * 1.6;
  const p = w.project(cam);
  if (p.z > 1 || p.z < -1) return null;
  return { x: rect.left - stageRect.left + ((p.x + 1) / 2) * rect.width, y: rect.top - stageRect.top + ((1 - p.y) / 2) * rect.height };
}

export function mountWaits(ix) {
  if (!ix || !ix.panel) return null;
  ensureCss();
  const head = ix.panel.querySelector('header');
  const badge = document.createElement('button');
  badge.type = 'button'; badge.className = 'wait-badge'; badge.hidden = true;
  badge.setAttribute('aria-haspopup', 'listbox'); badge.setAttribute('aria-expanded', 'false');
  badge.innerHTML = '<span class="wb-q" aria-hidden="true">?</span><span class="wb-t"></span><span class="wb-n"></span>';
  (ix.seg || head.querySelector('h2')).after(badge);
  const menu = document.createElement('div');
  menu.className = 'wait-menu'; menu.setAttribute('role', 'listbox'); menu.hidden = true;
  document.body.appendChild(menu);
  const layer = document.createElement('div');
  layer.id = 'wait-marks';
  const marks = new Map(); // sid → el

  let list = [], keys = new Set(), blinkT = 0, raf = 0, statusAt = 0, pollT = 0;

  const sessionsNow = () => {
    const ok = ix.enabled === true && ix.device && ix.device.status === 'allowed' && ix._sessAt && Date.now() - ix._sessAt < SESS_FRESH_MS;
    return ok ? ix.sessions : null;
  };

  function compute() {
    const c = window.__ccviz;
    const nodes = c && c.store && c.store.nodes ? c.store.nodes.values() : [];
    const replaying = !!(c && c.replaying);
    list = replaying ? [] : mergeWaits(nodeWaits(nodes, { replaying }), sessionsNow());
    const nw = newWaits(list, keys);
    const fresh = nw.fresh && list.length > 0;
    keys = nw.keys;
    renderBadge(fresh);
    if (!menu.hidden) renderMenu();
    if (list.length && !raf) raf = requestAnimationFrame(frame);
  }

  function renderBadge(fresh) {
    const n = list.length;
    badge.hidden = !n;
    if (!n) { closeMenu(); return; }
    badge.querySelector('.wb-t').textContent = t('ix.wait.badge', { n: '' }).trim();
    badge.querySelector('.wb-n').textContent = String(n);
    badge.classList.toggle('strong', list.some((w) => waitPrio(w) === 0));
    badge.title = t('ix.wait.title');
    badge.setAttribute('aria-label', t('ix.wait.badge', { n }));
    if (fresh) { // 새 대기: 잠깐 깜빡임(소리·푸시 없음)
      badge.classList.remove('blink'); void badge.offsetWidth; badge.classList.add('blink');
      clearTimeout(blinkT); blinkT = setTimeout(() => badge.classList.remove('blink'), BLINK_MS);
    }
  }

  function renderMenu() {
    const now = Date.now();
    menu.setAttribute('aria-label', t('ix.wait.list'));
    menu.innerHTML = list.map((w, i) => {
      const age = ageText(w.since, now, t);
      return `<button type="button" role="option" class="wait-item k-${escapeHtml(w.k)}" data-i="${i}">`
        + `<span class="wi-top"><b>${escapeHtml(waitName(w))}</b>${w.project ? `<span class="wi-proj">${escapeHtml(w.project)}</span>` : ''}${age ? `<span class="wi-age">${escapeHtml(age)}</span>` : ''}</span>`
        + `<span class="wi-q">${escapeHtml(waitHead(w, t))}</span></button>`;
    }).join('');
    placeMenu();
  }

  function placeMenu() {
    const r = badge.getBoundingClientRect();
    const W = Math.min(340, innerWidth - 16);
    menu.style.width = W + 'px';
    const left = Math.max(8, Math.min(r.right - W, innerWidth - W - 8));
    menu.style.left = left + 'px';
    const h = menu.offsetHeight;
    const below = r.bottom + 4;
    menu.style.top = (below + h <= innerHeight - 8 || r.top - h - 4 < 8 ? Math.max(8, Math.min(below, innerHeight - h - 8)) : r.top - h - 4) + 'px';
  }

  function openMenu() { menu.hidden = false; badge.setAttribute('aria-expanded', 'true'); renderMenu(); menu.querySelector('button')?.focus({ preventScroll: true }); }
  function closeMenu() { if (menu.hidden) return; menu.hidden = true; badge.setAttribute('aria-expanded', 'false'); }

  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    compute();
    if (list.length === 1) { go(list[0]); return; }
    if (menu.hidden) openMenu(); else closeMenu();
  });
  menu.addEventListener('click', (e) => { const b = e.target.closest('.wait-item'); if (b) { const w = list[Number(b.dataset.i)]; if (w) go(w); } });
  menu.addEventListener('keydown', (e) => {
    e.stopPropagation(); // 화면 단축키로 새지 않게
    if (e.key === 'Escape') { closeMenu(); badge.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const bs = [...menu.querySelectorAll('.wait-item')], i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]?.focus();
    }
  });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !badge.contains(e.target)) closeMenu(); }, true);
  addEventListener('resize', () => { if (!menu.hidden) placeMenu(); });

  /** 그 세션의 질문으로: Interactive(승인 기기·보낼 수 있는 세션) → 세션 고름·카드로 스크롤·강조. 못 쓰면 실황에서 그 노드로 거르고 카드로 */
  function go(w) {
    closeMenu();
    const canIx = ix.supported && ix.enabled === true && ix.device && ix.device.status === 'allowed'
      && (ix.sessions || []).some((s) => s.sessionId === w.sid && !s.headless);
    if (document.body.classList.contains('panel-collapsed')) document.getElementById('panel-toggle')?.click();
    if (canIx) {
      ix.flash = { sid: w.sid, tu: w.tu || null, until: Date.now() + 10_000, done: false };
      ix.setMode('ix');
      ix.manual = true;
      if (ix.sid !== w.sid) ix._pick(w.sid); else { ix._applyFlash(); ix._tick(true); }
      return;
    }
    ix.setMode('live');
    const c = window.__ccviz;
    if (c && c.panel && c.store && c.store.nodes.has(w.nodeId)) c.panel.setFilter(w.nodeId);
    const stream = document.getElementById('stream');
    setTimeout(() => {
      if (!stream) return;
      const cards = [...stream.querySelectorAll('.ask-card')];
      const el = (w.tu && cards.find((x) => x.dataset.tu === w.tu)) || cards.reverse().find((x) => x.classList.contains('s-pending') || x.classList.contains('s-planPending'));
      if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('wait-flash'); setTimeout(() => el.classList.remove('wait-flash'), 2800); }
    }, 120);
  }

  // ── 3D·2D 표식 ──
  function frame() {
    raf = 0;
    const c = window.__ccviz, view = c && c.view;
    const stage = document.getElementById('stage');
    if (!stage || !view || document.hidden) { for (const el of marks.values()) el.hidden = true; if (list.length) raf = requestAnimationFrame(frame); return; }
    if (layer.parentNode !== stage) stage.appendChild(layer);
    const sr = stage.getBoundingClientRect();
    const live = new Set();
    for (const w of list) {
      if (!view.has || !view.has(w.nodeId)) continue;
      live.add(w.sid);
      let el = marks.get(w.sid);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button'; el.className = 'wait-mark'; el.textContent = '?';
        el.addEventListener('click', (e) => { e.stopPropagation(); const x = list.find((y) => y.sid === el.dataset.sid); if (x) go(x); });
        el.addEventListener('pointerdown', (e) => e.stopPropagation()); // 무대 끌기·고르기로 새지 않게
        layer.appendChild(el); marks.set(w.sid, el);
      }
      el.dataset.sid = w.sid;
      el.classList.toggle('weak', waitPrio(w) > 0);
      const label = t('ix.wait.mark', { name: waitName(w) }) + ' — ' + waitHead(w, t);
      if (el.title !== label) { el.title = label; el.setAttribute('aria-label', label); }
      let p = null;
      try { p = markPos(view, w.nodeId, sr); } catch {}
      const ok = p && p.x > -20 && p.y > -20 && p.x < sr.width + 20 && p.y < sr.height + 20;
      el.hidden = !ok;
      if (ok) el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    }
    for (const [sid, el] of marks) if (!live.has(sid)) { el.remove(); marks.delete(sid); }
    if (list.length) raf = requestAnimationFrame(frame);
  }

  // ── 실황을 보는 동안에도 세션 기록 대기를 보려고 Interactive 세션 목록을 가끔(승인 기기만, 등록은 하지 않음) ──
  async function poll() {
    clearTimeout(pollT);
    try {
      if (!document.hidden && ix.mode !== 'ix' && ix.supported && !ix._busy) {
        ix._busy = true;
        try {
          if (Date.now() - statusAt > STATUS_EVERY_MS || ix.enabled == null) { statusAt = Date.now(); await ix._status({ register: false }); }
          if (ix.enabled === true && ix.device && ix.device.status === 'allowed') await ix._loadSessions();
        } finally { ix._busy = false; }
      }
    } catch {}
    compute();
    pollT = setTimeout(poll, WAIT_POLL_MS);
  }

  setInterval(compute, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  setTimeout(poll, 1500);
  compute();
  return { compute, go, get list() { return list; }, badge, menu };
}
