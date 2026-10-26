// 상단 바 표현 선택 드롭다운. 예전 #btn-view 순환 버튼 + #btn-dim 토글을 버튼 하나 + 펼침 메뉴로.
//   메뉴 = 표현 묶음(Flow · Planet · 복셀 오피스) + 화면 묶음(3D · 2D 저사양). 단일 선택 두 묶음(menuitemradio)
//   키보드: 버튼에서 Enter·Space·↓ = 열고 지금 값에 초점, 메뉴에서 ↑↓(끝에서 돌아감)·Home·End·Enter·Space = 고름, Esc·Tab = 닫음(초점 버튼으로)
//   순수 부분(menuItems·triggerText·menuKey)은 DOM 없이 web/test/viewsel.test.mjs 가 검사한다. mount 만 document 를 쓴다
import { RENDERER_LABEL, RENDERER_ORDER, DIM_LABEL, DIMS } from './renderers.js';
import { t } from './i18n.mjs';

const VIEW_HINT = { flow: t('app.vsel.hint.flow'), planet: t('app.vsel.hint.planet'), voxel: t('app.vsel.hint.voxel') };
const DIM_TEXT = { '3d': '3D', '2d': t('app.vsel.dim2d') };
const DIM_HINT = { '3d': t('app.vsel.hint.3d'), '2d': t('app.vsel.hint.2d') };

/** 메뉴 항목(순서 = 키보드 이동 순서) */
export function menuItems({ view, dim, pending = null } = {}) {
  return [
    ...RENDERER_ORDER.map((v) => ({ group: 'view', value: v, text: RENDERER_LABEL[v], hint: VIEW_HINT[v] || '', checked: v === view })),
    ...DIMS.map((d) => ({ group: 'dim', value: d, text: DIM_TEXT[d], hint: d === '2d' && pending ? `${DIM_HINT[d]} · ${t('app.vsel.pending', { name: RENDERER_LABEL[pending] })}` : DIM_HINT[d], checked: d === dim })),
  ];
}

/** 버튼 문구: 표현: Flow · 3D */
export const triggerText = (view, dim) => t('app.vsel.trigger', { view: RENDERER_LABEL[view] || view, dim: DIM_LABEL[dim] || dim });

/** 메뉴 안 키 → {i 다음 초점, act: 'move'|'pick'|'close'|null}. n = 항목 수 */
export function menuKey(key, i, n) {
  if (!n) return { i, act: key === 'Escape' || key === 'Tab' ? 'close' : null };
  switch (key) {
    case 'ArrowDown': return { i: (i + 1 + n) % n, act: 'move' };
    case 'ArrowUp': return { i: (i - 1 + n) % n, act: 'move' };
    case 'Home': return { i: 0, act: 'move' };
    case 'End': return { i: n - 1, act: 'move' };
    case 'Enter': case ' ': case 'Spacebar': return { i, act: 'pick' };
    case 'Escape': case 'Tab': return { i, act: 'close' };
    default: return { i, act: null };
  }
}

/**
 * 펼침 창의 세로 자리: 화면 안에 들게. 보통은 단추 아래 6px, 아래 자리가 모자라고 위가 더 넓으면 단추 위로,
 * 그래도 모자라면(가로 모드 휴대폰처럼 낮은 화면) 높이를 줄이고 안에서 스크롤. r = 단추 사각형, vh = 화면 높이, need = 창 전체 높이
 */
export function popVertical(r, vh, need) {
  const below = vh - r.bottom - 6 - 8, above = r.top - 6 - 8;
  const up = below < need && above > below;
  const maxHeight = Math.max(120, Math.floor(up ? above : below));
  const top = up ? Math.max(8, r.top - 6 - Math.min(need, maxHeight)) : r.bottom + 6;
  return { top, maxHeight };
}

const CSS = `
.vsel { position: relative; display: inline-flex; }
#btn-view { display: inline-flex; align-items: center; gap: 6px; }
#btn-view svg { width: 12px; height: 12px; flex: none; color: var(--muted); }
#btn-view[aria-expanded="true"] { border-color: var(--accent); }
/* z-index 61: ⚙ 설정 메뉴(§77, 60) 안의 단추로 여는 창이라 그 위에 떠야 한다. 펼침은 body 에 붙어 '#settings-menu .vsel-pop' 규칙이 닿지 않으므로
   여기서 정한다(예전 46 은 ⚙ 메뉴가 열린 채면 그 뒤에 가려졌음 — 모바일 Safari 처럼 탭으로 단추에 초점이 가지 않는 브라우저, §67.6) */
.vsel-pop { position: fixed; z-index: 61; min-width: 220px; padding: 6px; border-radius: 10px; overflow-y: auto; overscroll-behavior: contain;
  background: var(--panel-bg); border: 1px solid var(--border); box-shadow: var(--shadow);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.vsel-pop[hidden] { display: none; }
.vsel-grp { padding: 2px 0; }
.vsel-grp + .vsel-grp { border-top: 1px solid var(--border); margin-top: 4px; padding-top: 6px; }
.vsel-cap { font-size: 11px; color: var(--muted); padding: 2px 8px 4px; }
.vsel-item { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 4px 8px; border: 0; border-radius: 7px;
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.vsel-item:hover, .vsel-item:focus-visible { background: var(--hover); outline: none; }
.vsel-item:focus-visible { box-shadow: inset 0 0 0 1px var(--accent); }
.vsel-item i { width: 14px; flex: none; text-align: center; font-style: normal; color: var(--accent); }
.vsel-item b { font-weight: 600; white-space: nowrap; }
.vsel-item small { margin-left: auto; padding-left: 10px; color: var(--muted); font-size: 11px; white-space: nowrap; }
.vsel-item[aria-checked="true"] b { color: var(--accent); }
@media (max-width: 719px) { .vsel-pop { left: 8px !important; right: 8px; min-width: 0; } .vsel-item { min-height: 36px; } }
`;

/**
 * 상단 바에 붙인다. button = 기존 #btn-view(문구·속성을 바꿔 메뉴 단추로 씀).
 * @param {{button: HTMLButtonElement, get: () => {view, dim, pending}, onView: (v) => void, onDim: (d) => void}} o
 * @returns {{render(): void, close(): void, setDisabled(on: boolean): void, readonly isOpen: boolean}}
 */
export function mountViewSelector({ button, get, onView, onDim }) {
  if (!document.getElementById('vsel-css')) {
    const st = document.createElement('style'); st.id = 'vsel-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const wrap = document.createElement('div');
  wrap.className = 'vsel';
  button.parentNode.insertBefore(wrap, button);
  wrap.appendChild(button);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  const pop = document.createElement('div');
  pop.className = 'vsel-pop'; pop.hidden = true; pop.id = 'view-menu';
  pop.setAttribute('role', 'menu'); pop.setAttribute('aria-label', t('app.vsel.menu'));
  button.setAttribute('aria-controls', pop.id);
  // body 에 붙인다: 좁은 화면의 .tb-more(가로 스크롤·mask)·상단 바 흐림 필터가 고정 위치 메뉴를 자르지 않게
  document.body.appendChild(pop);
  let items = [], els = [], idx = 0;

  function render() {
    const s = get();
    button.innerHTML = '';
    const sp = document.createElement('span'); sp.textContent = triggerText(s.view, s.dim);
    button.appendChild(sp);
    button.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>');
    const dimTxt = s.dim === '2d' ? t('app.vsel.dim2d') : '3D';
    button.title = t('app.vsel.title', { view: RENDERER_LABEL[s.view], dim: s.dim === '2d' ? t('app.vsel.dim2dParen') : '3D' }) + (s.pending ? t('app.vsel.titlePending', { name: RENDERER_LABEL[s.pending] }) : '') + t('app.vsel.titleKeys');
    button.setAttribute('aria-label', t('app.vsel.aria', { view: RENDERER_LABEL[s.view], dim: dimTxt }));
    document.documentElement.setAttribute('data-dim', s.dim); // 2D 전용 CSS
    items = menuItems(s);
    pop.innerHTML = '';
    els = [];
    for (const g of ['view', 'dim']) {
      const grp = document.createElement('div');
      grp.className = 'vsel-grp'; grp.setAttribute('role', 'group');
      const cap = g === 'view' ? t('app.vsel.capView') : t('app.vsel.capDim');
      grp.setAttribute('aria-label', cap);
      grp.innerHTML = `<div class="vsel-cap" aria-hidden="true">${cap}</div>`;
      for (const it of items.filter((x) => x.group === g)) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'vsel-item'; b.tabIndex = -1;
        b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', String(it.checked));
        b.dataset.group = it.group; b.dataset.value = it.value;
        b.innerHTML = `<i aria-hidden="true">${it.checked ? '✓' : ''}</i><b></b><small></small>`;
        b.querySelector('b').textContent = it.text;
        b.querySelector('small').textContent = it.hint;
        b.addEventListener('click', () => pick(els.indexOf(b)));
        grp.appendChild(b);
        els.push(b);
      }
      pop.appendChild(grp);
    }
  }

  function place() {
    const r = button.getBoundingClientRect();
    const v = popVertical(r, innerHeight, pop.scrollHeight || 260);
    pop.style.top = v.top + 'px';
    pop.style.maxHeight = v.maxHeight + 'px';
    if (innerWidth >= 720) pop.style.left = Math.max(8, Math.min(innerWidth - 8 - Math.max(220, pop.offsetWidth || 240), r.left)) + 'px';
    else pop.style.left = '';
  }
  function focusAt(i) { idx = i; const el = els[i]; if (el) el.focus({ preventScroll: true }); }
  function open() {
    if (button.disabled) return;
    render();
    pop.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    place();
    const cur = items.findIndex((x) => x.group === 'view' && x.checked);
    focusAt(cur < 0 ? 0 : cur);
  }
  function close(refocus = false) {
    if (pop.hidden) return;
    pop.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refocus) button.focus({ preventScroll: true });
  }
  function pick(i) {
    const it = items[i];
    if (!it) return;
    close(false);
    button.blur();
    if (it.checked) return;
    if (it.group === 'view') onView(it.value); else onDim(it.value);
  }

  button.addEventListener('click', () => { if (pop.hidden) open(); else close(false); });
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); open(); focusAt(els.length - 1); }
  });
  pop.addEventListener('keydown', (e) => {
    const r = menuKey(e.key, idx, els.length);
    if (!r.act) return;
    e.stopPropagation(); // 스페이스 = 일시정지 등 전역 단축키로 새지 않게
    if (r.act !== 'close' || e.key !== 'Tab') e.preventDefault();
    if (r.act === 'move') focusAt(r.i);
    else if (r.act === 'pick') pick(r.i);
    else close(e.key !== 'Tab');
  });
  pop.addEventListener('focusin', (e) => { const i = els.indexOf(e.target); if (i >= 0) idx = i; });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !wrap.contains(e.target) && !pop.contains(e.target)) close(false); }, true);
  window.addEventListener('resize', () => close(false));

  render();
  return {
    render() { render(); if (!pop.hidden) place(); },
    close: () => close(false),
    setDisabled(on) { button.disabled = !!on; if (on) close(false); },
    get isOpen() { return !pop.hidden; },
  };
}
