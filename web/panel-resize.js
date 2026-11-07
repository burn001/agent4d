// 사이드 패널 크기 조절 손잡이. 배치는 CSS 가 정한다: 넓은 화면·가로 화면 = 오른쪽(왼쪽 변 손잡이, 너비),
// 휴대폰 세로 = 아래(위쪽 변 손잡이, 높이). 크기는 방향별 localStorage(ccviz.panelW / ccviz.panelH) — 실황·Interactive 가 한 패널이라 같은 크기.
import {
  DOCK_QUERY, W_KEY, H_KEY, clampSide, clampDock, sideLimits, dockLimits, parseSaved, isDoubleTap, dragSize, keySize, keyboardInset, keyboardFallback, KB_POLL,
} from './panel-size.mjs';
import { invalidateInsets } from './screen-insets.js';
import { panelSide, onPanelSide } from './panel-side.mjs';
import { t } from './i18n.mjs';

const root = document.documentElement;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, String(v)); } catch (e) {} };

function boot() {
  const panel = document.getElementById('panel');
  if (!panel) return;
  const mq = window.matchMedia ? matchMedia(DOCK_QUERY) : { matches: false };
  const dock = () => !!mq.matches;
  const topH = () => parseFloat(getComputedStyle(root).getPropertyValue('--topbar-h')) || document.getElementById('topbar')?.offsetHeight || 48;
  const collapsed = () => document.body.classList.contains('panel-collapsed');
  const left = () => !dock() && panelSide() === 'left'; // 왼쪽 배치(휴대폰 세로의 아래 배치에서는 무시)

  const h = document.createElement('div');
  h.id = 'panel-resizer';
  h.setAttribute('role', 'separator');
  h.tabIndex = 0;
  h.innerHTML = '<i aria-hidden="true"></i>';
  panel.appendChild(h);

  // 목표 크기: 패널 너비·높이는 .25초 전환 중일 수 있어 측정값 대신 우리가 쓴 변수를 먼저 본다(없으면 측정)
  const cur = () => {
    const v = parseFloat(root.style.getPropertyValue(dock() ? '--panel-h-open' : '--panel-w-open'));
    if (Number.isFinite(v) && v > 0) return Math.round(v);
    const r = panel.getBoundingClientRect(); return Math.round(dock() ? r.height : r.width);
  };
  const aria = () => {
    const d = dock();
    const lim = d ? dockLimits(innerHeight, topH()) : sideLimits(innerWidth);
    h.setAttribute('aria-orientation', d ? 'horizontal' : 'vertical');
    h.dataset.side = d ? 'bottom' : left() ? 'left' : 'right';
    h.setAttribute('aria-valuemin', String(lim.min));
    h.setAttribute('aria-valuemax', String(lim.max));
    h.setAttribute('aria-valuenow', String(cur()));
    const label = t('app.panel.resize');
    h.title = label; h.setAttribute('aria-label', label);
  };
  const setVars = (w, hh) => {
    if (w != null) root.style.setProperty('--panel-w-open', clampSide(w, innerWidth) + 'px'); else root.style.removeProperty('--panel-w-open');
    if (hh != null) root.style.setProperty('--panel-h-open', clampDock(hh, innerHeight, topH()) + 'px'); else root.style.removeProperty('--panel-h-open');
    invalidateInsets();
  };
  /** 저장값(방향별)을 지금 화면 한도에 맞춰 적용 */
  const apply = () => { setVars(parseSaved(lsGet(W_KEY)), parseSaved(lsGet(H_KEY))); aria(); };
  const live = (n) => { // 드래그·키 중 값(저장 전)
    if (dock()) root.style.setProperty('--panel-h-open', n + 'px'); else root.style.setProperty('--panel-w-open', n + 'px');
    invalidateInsets();
  };
  const save = (n) => { lsSet(dock() ? H_KEY : W_KEY, n); };
  const reset = () => { lsSet(dock() ? H_KEY : W_KEY, null); apply(); };

  // ── 끌기(마우스·터치·펜 공통 포인터 이벤트) ──
  let drag = null, lastTap = null, raf = 0, want = null;
  const flush = () => { raf = 0; if (want != null) { live(want); aria(); } };
  h.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const now = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    if (isDoubleTap(lastTap, now)) { lastTap = null; e.preventDefault(); reset(); return; }
    lastTap = now;
    drag = { id: e.pointerId, moved: false };
    try { h.setPointerCapture(e.pointerId); } catch (err) {}
    document.body.classList.add('panel-resizing');
    e.preventDefault();
  });
  h.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const n = dragSize(dock(), { x: e.clientX, y: e.clientY }, innerWidth, innerHeight, topH(), left());
    if (lastTap && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) > 4) { drag.moved = true; lastTap = null; }
    if (!drag.moved) return;
    want = n;
    if (!raf) raf = requestAnimationFrame(flush);
  });
  const end = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const moved = drag.moved;
    drag = null;
    document.body.classList.remove('panel-resizing');
    try { h.releasePointerCapture(e.pointerId); } catch (err) {}
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (moved && want != null) { live(want); save(want); }
    want = null; aria();
  };
  h.addEventListener('pointerup', end);
  h.addEventListener('pointercancel', end);
  h.addEventListener('lostpointercapture', (e) => { if (drag && e.pointerId === drag.id) end(e); });

  // ── 키보드: 화살표(큰 걸음 Shift), Home = 기본 크기. 화면 단축키(카메라 이동 등)로 새지 않게 막는다 ──
  h.addEventListener('keydown', (e) => {
    if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); reset(); return; }
    const n = keySize(dock(), e.key, e.shiftKey, cur(), innerWidth, innerHeight, topH(), left());
    if (n == null) return;
    e.preventDefault(); e.stopPropagation();
    live(n); save(n); aria();
  });

  // ── 방향·크기 바뀜: CSS 가 배치를 바로 바꾸고, 여기서 저장값을 새 화면 한도에 맞춘다 ──
  const relayout = () => { apply(); syncKb(); };
  if (mq.addEventListener) mq.addEventListener('change', relayout); else if (mq.addListener) mq.addListener(relayout);
  window.addEventListener('resize', relayout);
  onPanelSide(() => { invalidateInsets(); aria(); });
  window.addEventListener('orientationchange', () => setTimeout(relayout, 120));
  new MutationObserver(aria).observe(document.body, { attributes: true, attributeFilter: ['class'] }); // 접힘/펼침

  // ── 가상 키보드(아래 배치): 패널을 키보드 위로 올리고 높이를 보이는 영역 안으로 제한 ──
  const vv = window.visualViewport;
  // visualViewport 가 없으면: 방향별로 본 가장 큰 창 높이와 비교(입력칸 초점 있을 때만)
  const baseH = { p: 0, l: 0 };
  const editing = () => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(button|checkbox|radio|range|submit|reset|file|color)$/i.test(a.type || '')) || a.isContentEditable); };
  function syncKb() {
    const ori = innerWidth > innerHeight ? 'l' : 'p';
    if (!editing() || innerHeight > baseH[ori]) baseH[ori] = Math.max(baseH[ori], innerHeight);
    const k = !dock() ? 0 : vv ? keyboardInset(innerHeight, vv.height, vv.offsetTop) : keyboardFallback(baseH[ori], innerHeight, editing());
    if (k) { root.style.setProperty('--kb-inset', (vv ? k : 0) + 'px'); root.style.setProperty('--vv-h', Math.round(vv ? vv.height : innerHeight) + 'px'); }
    else { root.style.removeProperty('--kb-inset'); root.style.removeProperty('--vv-h'); }
    document.body.classList.toggle('kb-open', !!k); // 키보드가 떠 있는 동안 아래 띠(타임라인·매크로·재생 막대·통계 칩)를 숨김
    invalidateInsets();
  }
  if (vv) { vv.addEventListener('resize', syncKb); vv.addEventListener('scroll', syncKb); }
  // visualViewport resize 가 늦거나 오지 않는 브라우저 대비: 초점이 들어오고 나갈 때 잠깐(1.5초) 다시 잰다 + 창 스크롤(iOS 가 키보드 때 문서를 올림)
  let pollT = 0, pollN = 0;
  const burst = () => { pollN = KB_POLL.N; if (pollT) return; pollT = setInterval(() => { syncKb(); if (--pollN <= 0) { clearInterval(pollT); pollT = 0; } }, KB_POLL.MS); };
  document.addEventListener('focusin', burst); document.addEventListener('focusout', burst);
  window.addEventListener('scroll', () => { if (editing()) syncKb(); }, { passive: true });
  window.addEventListener('orientationchange', () => { baseH.p = 0; baseH.l = 0; });

  apply(); syncKb();
  // 헤드리스 확인·제어용
  window.__ccvizPanelSize = { get: () => ({ dock: dock(), size: cur(), collapsed: collapsed() }), set: (n) => { live(dock() ? clampDock(n, innerHeight, topH()) : clampSide(n, innerWidth)); aria(); }, reset, apply };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
