// 배경 환경 제어: 세 표현 공통의 바닥 그리드(축 기즈모)·기상 층을 지금 장면에 붙이고, 상단 바 '배경' 카드로 고른다.
//   const env = mountEnv({ button, isLight: () => bool });
//   env.attach(view, mode);   // 표현을 만들거나 바꿀 때
//   env.frame(view, dt, now); // 장면 프레임마다(view.onFrame 안, 렌더 직전) — 실시간 일시정지 중엔 불리지 않아 그대로 얼어 있다
//   env.applyTheme(); env.noteEvent(ev);
// 바닥 그리드(ground.js, three)는 3D 장면을 붙일 때 불러온다 — 2D 화면(장면 없음)은 three.js 를 받지 않는다
import { t as _t } from '../i18n.mjs';
let groundMod = null;

const LS_GRID = 'ccviz.grid';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 저장소 없음 */ } };

function ensureCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-ccviz="env"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('./env.css', import.meta.url).href; l.dataset.ccviz = 'env';
  document.head.appendChild(l);
}

export function mountEnv({ button = null, isLight = () => false } = {}) {
  ensureCss();
  let gridOn = lsGet(LS_GRID) !== 'off';
  let cur = { view: null, mode: null, ground: null };
  const extras = []; // 기상 층 등 같은 수명의 덧붙임 — {attach(view, mode), frame(view, dt, now), applyTheme(isLight), detach}

  function detach() {
    if (cur.ground) { try { cur.ground.dispose(); } catch (e) { /* 무시 */ } }
    for (const x of extras) { try { x.detach(); } catch (e) { /* 무시 */ } }
    if (cur.view && cur.mode === 'planet' && cur.view.grid) cur.view.grid.visible = true;
    cur = { view: null, mode: null, ground: null };
  }
  function attach(view, mode) {
    detach();
    if (!view || !view.scene) return;
    if (!groundMod) {
      // 처음 한 번: 모듈을 받은 뒤 그때도 같은 장면이면 붙인다(3D 첫 화면은 index.html 이 미리 받아 둠)
      import('./ground.js').then((m) => { groundMod = m; if (!cur.view && view.scene && !view._disposed) attach(view, mode); })
        .catch((e) => console.warn('바닥 그리드 모듈 로드 실패', e));
      return;
    }
    let ground = null;
    try { ground = new groundMod.GroundGrid(view.scene, view.container, mode); ground.applyTheme(isLight()); ground.setVisible(gridOn); }
    catch (e) { console.warn('바닥 그리드 생성 실패', e); ground = null; }
    cur = { view, mode, ground };
    for (const x of extras) { try { x.attach(view, mode, ground); x.applyTheme(isLight()); } catch (e) { console.warn('배경 층 생성 실패', e); } }
  }
  function frame(view, dt, now) {
    if (view !== cur.view) return;
    // Planet: 그리드를 켜면 예전 GridHelper 를 숨기고 같은 높이에 새 그리드(끄면 예전 모습 그대로). GridHelper 는 테마마다 다시 만들어지므로 매 프레임 맞춘다
    if (cur.mode === 'planet' && view.grid) view.grid.visible = !(gridOn && cur.ground);
    if (cur.ground && gridOn) cur.ground.update(view.camera, view.focusDist);
    for (const x of extras) x.frame(view, dt, now);
  }
  function applyTheme() {
    const L = isLight();
    if (cur.ground) cur.ground.applyTheme(L);
    for (const x of extras) x.applyTheme(L);
  }
  function setGrid(on) {
    gridOn = !!on;
    lsSet(LS_GRID, gridOn ? 'on' : 'off');
    if (cur.ground) cur.ground.setVisible(gridOn);
    renderCard();
  }

  // ---------- 상단 바 '배경' 카드 ----------
  const card = document.createElement('div');
  card.className = 'env-card'; card.hidden = true;
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', _t('scene.env.aria'));
  document.body.appendChild(card);
  const rows = []; // 덧붙임이 넣는 줄 html 함수
  function renderCard() {
    card.innerHTML = `<h3>${_t('scene.env.title')}</h3>
      <label class="env-row"><span>${_t('scene.env.grid')}<small>${_t('scene.env.gridNote')}</small></span>
        <input type="checkbox" class="env-grid"${gridOn ? ' checked' : ''}></label>` + rows.map((f) => f()).join('');
    card.querySelector('.env-grid').addEventListener('change', (e) => setGrid(e.target.checked));
    for (const x of extras) if (x.bindCard) x.bindCard(card);
    if (button) button.setAttribute('aria-pressed', String(!card.hidden));
  }
  function openCard(on) {
    card.hidden = !on;
    if (on) {
      renderCard();
      const r = button ? button.getBoundingClientRect() : { left: 12, bottom: 56 };
      card.style.top = Math.round(r.bottom + 6) + 'px';
      card.style.left = Math.round(Math.max(8, Math.min(innerWidth - 268, r.left))) + 'px';
    }
    if (button) button.setAttribute('aria-pressed', String(!!on));
  }
  if (button) button.addEventListener('click', () => { button.blur(); openCard(card.hidden); });
  document.addEventListener('pointerdown', (e) => { if (!card.hidden && !card.contains(e.target) && e.target !== button && !(button && button.contains(e.target))) openCard(false); }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !card.hidden) openCard(false); });
  renderCard();

  return {
    attach, detach, frame, applyTheme, setGrid,
    /** 이벤트(라이브·재생 공통) → 기상 '자동' 규칙의 근거 */
    noteEvent(ev, opts) { for (const x of extras) if (x.noteEvent) x.noteEvent(ev, opts); },
    get gridOn() { return gridOn; },
    get ground() { return cur.ground; },
    /** 덧붙임 등록(기상). row = 카드에 넣을 html 함수 */
    addLayer(layer, row = null) { extras.push(layer); if (row) rows.push(row); if (cur.view) { layer.attach(cur.view, cur.mode, cur.ground); layer.applyTheme(isLight()); } renderCard(); },
    openCard, renderCard,
  };
}
