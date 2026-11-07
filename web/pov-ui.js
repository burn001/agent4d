// 메인 1인칭 시점(POV) 화면 조작: 무대 왼쪽 위 눈 버튼(복셀 3D) · POV 칩(지금 보는 대상 · ▾ 메인 바꾸기 · ✕ 나가기) ·
// ⚙ 카메라 줄 'POV(메인 시점)' · 노드 카드 '이 에이전트 시점으로'(inspector 가 h.onPov) · ?cam=pov · Esc·빈 곳 클릭으로 나가기 · ctl camera pov.
// 카메라 동작은 pov.js(PovCam), 규칙은 pov-core.mjs. 2D·흐름·Planet 에서는 눈 버튼을 숨기고 ⚙ 줄은 비활성(누르면 한 줄 안내).
import { PovCam } from './pov.js';
import { pickPovMain, resolvePovTarget, povChipText } from './pov-core.mjs';
import { t } from './i18n.mjs';

const EYE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const CSS = `
#pov-bar { position: fixed; top: calc(var(--topbar-h, 48px) + 10px); left: calc(var(--inset-l, 0px) + 12px); z-index: 16; display: flex; align-items: center; gap: 6px; pointer-events: none; }
#pov-bar[hidden] { display: none; }
#pov-bar > * { pointer-events: auto; }
#btn-pov-eye { width: 34px; height: 34px; border-radius: 999px; display: grid; place-items: center; padding: 0; cursor: pointer;
  background: var(--chip-bg); border: 1px solid var(--border); color: var(--muted); box-shadow: var(--shadow); }
#btn-pov-eye:hover { color: var(--text); border-color: var(--skill); }
#btn-pov-eye[aria-pressed="true"] { color: var(--bg, #0b1020); background: var(--skill); border-color: var(--skill); box-shadow: 0 0 0 3px color-mix(in srgb, var(--skill) 30%, transparent), var(--shadow); }
#pov-chip { display: flex; align-items: center; gap: 2px; height: 30px; padding: 0 4px 0 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
  background: var(--chip-bg); border: 1px solid var(--skill); color: var(--text); box-shadow: var(--shadow); max-width: min(64vw, 460px); }
#pov-chip[hidden] { display: none; }
#pov-chip .pv-t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 4px; }
#pov-chip .pv-t b { color: var(--skill); font-weight: 700; }
#pov-chip button { border: 0; background: transparent; color: var(--muted); font: inherit; cursor: pointer; width: 24px; height: 24px; border-radius: 999px; padding: 0; line-height: 1; }
#pov-chip button:hover { color: var(--text); background: color-mix(in srgb, var(--text) 12%, transparent); }
#pov-chip button[hidden] { display: none; }
#pov-menu { position: fixed; z-index: 62; min-width: 200px; max-width: 360px; max-height: 50vh; overflow: auto; padding: 4px; border-radius: 10px;
  background: var(--panel-bg, var(--chip-bg)); border: 1px solid var(--border); box-shadow: var(--shadow); backdrop-filter: blur(8px); }
#pov-menu[hidden] { display: none; }
#pov-menu button { display: block; width: 100%; text-align: left; border: 0; background: transparent; color: var(--text); font-size: 12.5px; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
#pov-menu button:hover, #pov-menu button[aria-current="true"] { background: color-mix(in srgb, var(--skill) 18%, transparent); }
#pov-menu small { color: var(--muted); margin-left: 6px; }
#pov-hint { position: fixed; left: var(--stage-cx, 50%); bottom: calc(var(--tl-h, 0px) + 18px); transform: translateX(-50%); z-index: 16; pointer-events: none;
  padding: 4px 12px; border-radius: 999px; font-size: 12px; color: var(--muted); background: var(--chip-bg); border: 1px solid var(--border); transition: opacity .6s ease; }
#pov-hint.off { opacity: 0; }
body.pov-on #cam-chip { display: none !important; }
body.pov-able #cam-chip { left: 54px; }
#btn-pov[aria-disabled="true"] { opacity: .55; }
@media (max-width: 719px) { #pov-chip { max-width: calc(100vw - 80px); } }
`;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {{getView:()=>any, getDirector:()=>any, nodes:Map, projectName:(pid:string)=>string|null, getFocusId:()=>string|null,
 *          flash:(html:string, ms?:number)=>void, toVoxel3d:()=>Promise<boolean>}} o
 */
export function mountPov(o) {
  if (!$('pov-css')) { const st = document.createElement('style'); st.id = 'pov-css'; st.textContent = CSS; document.head.appendChild(st); }
  const pov = new PovCam();
  let wantFrom = null; // 들어오기 전 표현 기억은 하지 않음(나가면 지금 표현의 자동 카메라로)

  // ── 무대 왼쪽 위: 눈 버튼 + POV 칩 ──
  const bar = document.createElement('div');
  bar.id = 'pov-bar'; bar.hidden = true;
  const eye = document.createElement('button');
  eye.id = 'btn-pov-eye'; eye.type = 'button'; eye.innerHTML = EYE;
  eye.setAttribute('aria-pressed', 'false');
  const chip = document.createElement('div');
  chip.id = 'pov-chip'; chip.hidden = true; chip.setAttribute('role', 'status');
  chip.innerHTML = `<span class="pv-t"></span><button type="button" class="pv-pick" aria-haspopup="menu">▾</button><button type="button" class="pv-x">✕</button>`;
  const chipT = chip.querySelector('.pv-t'), pickB = chip.querySelector('.pv-pick'), xB = chip.querySelector('.pv-x');
  bar.append(eye, chip);
  document.body.appendChild(bar);
  const menu = document.createElement('div');
  menu.id = 'pov-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);
  const hint = document.createElement('div');
  hint.id = 'pov-hint'; hint.className = 'off';
  document.body.appendChild(hint);
  let hintT = 0;

  // ── ⚙ 카메라 줄 버튼(settings-menu 가 #btn-pov 를 옮겨 감) ──
  const mbtn = document.createElement('button');
  mbtn.id = 'btn-pov'; mbtn.type = 'button'; mbtn.className = 'tb';
  mbtn.setAttribute('aria-pressed', 'false');
  const btnCam = $('btn-camera');
  if (btnCam && btnCam.parentNode) btnCam.parentNode.appendChild(mbtn); else document.body.appendChild(mbtn);

  const usable = () => PovCam.canUse(o.getView());
  /** 지금 화면의 메인 후보 [{id, label, sessionId, project, s, root}] */
  function mains() {
    const v = o.getView(), d = o.getDirector();
    if (!PovCam.canUse(v)) return [];
    const out = [];
    const now = performance.now() / 1000;
    for (const [id, ch] of v.chars) {
      const n = ch.node;
      if (!n || n.kind !== 'main' || n.parentId) continue;
      if (ch.state === 'gone' || !ch.placed || ch.offstage) continue;
      if (v._isDim && v._isDim(id)) continue;
      out.push({ id, label: n.label || id, sessionId: n.sessionId || id.replace(/^s:/, ''), project: n.projectId ? o.projectName(n.projectId) || n.projectId : null, root: n.rootSessionId || null, s: d && d._score ? d._score(id, now) : 0 });
    }
    out.sort((a, b) => (a.id < b.id ? -1 : 1));
    return out;
  }
  const nameOf = (id) => { const n = o.nodes.get(id); return (n && (n.label || n.id)) || id || ''; };

  function render() {
    const able = usable();
    const on = pov.active;
    document.body.classList.toggle('pov-on', on);
    document.body.classList.toggle('pov-able', able);
    bar.hidden = !able && !on;
    eye.setAttribute('aria-pressed', String(on));
    eye.title = t(on ? 'app.pov.eyeOnTitle' : 'app.pov.eyeTitle');
    eye.setAttribute('aria-label', t('app.pov.eye'));
    chip.hidden = !on;
    mbtn.textContent = t('app.pov.menu');
    mbtn.title = t(able ? 'app.pov.menuTitle' : 'app.pov.menu2d');
    mbtn.setAttribute('aria-pressed', String(on));
    mbtn.setAttribute('aria-disabled', String(!able));
    pickB.title = t('app.pov.pick'); pickB.setAttribute('aria-label', t('app.pov.pick'));
    xB.title = t('app.pov.exit'); xB.setAttribute('aria-label', t('app.pov.exit'));
    if (on) chipText();
  }
  let lastChip = '';
  function chipText() {
    if (!pov.active) return;
    const g = pov.gazeShown;
    const gName = !g ? '' : g === pov.id ? t('app.pov.monitor') : nameOf(g);
    const txt = povChipText(nameOf(pov.id), gName, 20);
    const multi = mains().length > 1;
    const key = txt + '|' + multi;
    if (key === lastChip) return;
    lastChip = key;
    const i = txt.indexOf(' → ');
    chipT.innerHTML = i < 0 ? esc(txt) : `${esc(txt.slice(0, i))} → <b>${esc(txt.slice(i + 3))}</b>`;
    chipT.title = txt;
    pickB.hidden = !multi;
  }
  setInterval(() => { if (pov.active) chipText(); }, 250);

  function showHint() {
    hint.textContent = t('app.pov.hint');
    hint.classList.remove('off');
    clearTimeout(hintT);
    hintT = setTimeout(() => hint.classList.add('off'), 4200);
  }

  /**
   * 켜기. id = 메인 노드 id(null 이면 기본: 포커스 노드의 루트 메인 → 가장 활발한 메인)
   * @returns {{ok:boolean, error?:string, id?:string}}
   */
  function enter(id = null, { quiet = false } = {}) {
    const v = o.getView(), d = o.getDirector();
    if (!PovCam.canUse(v)) { if (!quiet) o.flash(`<b>${esc(t('app.pov.only3d'))}</b>`, 3500); return { ok: false, error: 'not_voxel' }; }
    const ms = mains();
    if (!ms.length) { if (!quiet) o.flash(`<b>${esc(t('app.pov.noMain'))}</b>`, 3000); return { ok: false, error: 'no_main' }; }
    if (!id || !ms.some((m) => m.id === id)) {
      const fid = o.getFocusId ? o.getFocusId() : null;
      const fn = fid ? o.nodes.get(fid) : null;
      id = pickPovMain(ms, fn ? fn.rootSessionId || (fn.kind === 'main' ? fn.sessionId : null) : null, id);
    }
    const was = pov.active;
    if (!pov.start(v, d, id)) return { ok: false, error: 'not_found' };
    d.pov = pov;
    d.onPovLost = lost;
    closeMenu();
    lastChip = '';
    render();
    if (!was) showHint();
    return { ok: true, id };
  }
  /** 나가기 — 자동 카메라가 켜져 있으면 그 규칙으로 날아가고, 꺼져 있으면 들어오기 전 자리로 */
  function exit() {
    const d = o.getDirector();
    if (!pov.active) return false;
    pov.stop(d, { restore: !d.enabled });
    if (d.enabled) { d.dragging = false; d.resumeAuto(); }
    closeMenu();
    hint.classList.add('off');
    render();
    return true;
  }
  /** 대상 캐릭터가 사라짐 → 다른 메인(같은 화면)으로, 없으면 나가기 */
  function lost() {
    const prev = pov.id;
    const v = o.getView();
    if (PovCam.canUse(v)) {
      const ms = mains().filter((m) => m.id !== prev);
      if (ms.length) { enter(pickPovMain(ms, null), { quiet: true }); return; }
    }
    exit();
    if (prev) o.flash(`<b>${esc(t('app.pov.lost', { name: nameOf(prev) }))}</b>`, 3500);
  }
  function toggle() { if (pov.active) exit(); else enter(null); }

  // ── 메뉴(▾ 메인 바꾸기) ──
  function openMenu() {
    const ms = mains();
    menu.innerHTML = ms.map((m) => `<button type="button" role="menuitem" data-id="${esc(m.id)}" aria-current="${m.id === pov.id}">${esc(m.label)}${m.project ? `<small>${esc(m.project)}</small>` : ''}</button>`).join('');
    const r = chip.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(window.innerWidth - 220, r.left)) + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
    menu.hidden = false;
    pickB.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() { menu.hidden = true; pickB.setAttribute('aria-expanded', 'false'); }
  menu.addEventListener('click', (e) => { const b = e.target.closest('button[data-id]'); if (b) enter(b.dataset.id); });
  pickB.addEventListener('click', (e) => { e.stopPropagation(); if (menu.hidden) openMenu(); else closeMenu(); });
  xB.addEventListener('click', () => exit());
  eye.addEventListener('click', () => { eye.blur(); toggle(); });
  mbtn.addEventListener('click', () => { if (!usable() && !pov.active) { o.flash(`<b>${esc(t('app.pov.only3d'))}</b>`, 3500); return; } toggle(); });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !chip.contains(e.target)) closeMenu(); }, true);
  // Esc: 팝업(상세 카드·메뉴)이 열려 있으면 그것부터 — 캡처 단계로 inspector 의 Esc 보다 먼저 본다
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !pov.active) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag) || e.isComposing) return;
    if (!menu.hidden) { closeMenu(); e.stopPropagation(); return; }
    if (o.popupOpen && o.popupOpen()) return;
    if (document.querySelector('#settings-menu:not([hidden])')) return;
    exit();
  }, true);

  render();
  return {
    pov, enter, exit, toggle, mains, render,
    get active() { return pov.active; },
    get targetId() { return pov.id; },
    /** 표현이 바뀐 뒤(app.switchView 끝) — 복셀 3D 가 아니면 나가기, 버튼 보이기 갱신 */
    viewChanged() { if (pov.active && (!usable() || pov.view !== o.getView())) exit(); render(); },
    /** ctl camera pov [대상] — 이름 해석(모호하면 후보) */
    resolve(q) { return resolvePovTarget(mains(), q); },
  };
}
