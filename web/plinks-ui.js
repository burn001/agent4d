// Planet 관계선 설정·범례 — ⚙ 메뉴 `관계선: 번갈아 / 레이저 / 궤도 고리` 줄(Planet 일 때만 보임) + 범례 묶음(지금 표현 표시).
// 값은 plinks-core.mjs 의 단일 설정(저장 'ccviz.plinks', URL ?plinks= 는 이번 접속만) — ctl plinks 로 바뀌어도 따라간다.
import { t } from './i18n.mjs';
import { plinksPref, setPlinksPref, onPlinks, plinksClock } from './plinks-core.mjs';

const CSS = `
#plinks-row[hidden], .plinks-legend[hidden] { display: none !important; }
.sm-plinks { display: inline-flex; gap: 4px; flex-wrap: wrap; }
#legend .plinks-legend i.pll { display: inline-block; width: 22px; height: 10px; margin-right: 6px; vertical-align: middle; background: none !important; }
#legend .plinks-legend i.pll-laser { border-top: 2px solid var(--link); position: relative; height: 0; }
#legend .plinks-legend i.pll-laser::before, #legend .plinks-legend i.pll-laser::after { content: ""; position: absolute; top: -5px; width: 3px; height: 8px; border: 1.5px solid var(--muted); border-radius: 50%; }
#legend .plinks-legend i.pll-laser::before { left: -3px; border-left: none; } #legend .plinks-legend i.pll-laser::after { right: -3px; border-right: none; }
#legend .plinks-legend i.pll-cp { border-top: 1.5px solid var(--k-claude-p); border-bottom: 1.5px solid var(--k-claude-p); height: 3px; }
#legend .plinks-legend i.pll-orbit { border: 2px solid var(--link); border-color: var(--link) transparent transparent transparent; border-radius: 50% 50% 0 0 / 100% 100% 0 0; height: 8px; }
#legend .plinks-legend i.pll-cporb { border: 1.5px dashed var(--k-claude-p); border-color: var(--k-claude-p) transparent transparent transparent; border-radius: 50% 50% 0 0 / 100% 100% 0 0; height: 8px; }
.plinks-legend li.cur { font-weight: 600; }
`;

/** @param h { viewMode: () => 'flow'|'planet'|'voxel' } */
export function mountPlanetLinks(h) {
  if (!document.getElementById('plinks-css')) { const s = document.createElement('style'); s.id = 'plinks-css'; s.textContent = CSS; document.head.appendChild(s); }
  // ── ⚙ 메뉴 줄 ──
  const wrap = document.createElement('div');
  wrap.className = 'sm-plinks'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', t('scene.plinks.row'));
  wrap.title = t('scene.plinks.title');
  const btns = ['rotate', 'laser', 'orbit'].map((p) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tb'; b.dataset.plinks = p; b.id = 'btn-plinks-' + p;
    b.textContent = t('scene.plinks.' + p);
    b.addEventListener('click', () => setPlinksPref(p));
    wrap.appendChild(b);
    return b;
  });
  let row = null;
  function mountRow() {
    const menu = document.getElementById('settings-menu');
    if (!menu || row) return;
    row = document.createElement('div'); row.className = 'sm-row'; row.id = 'plinks-row';
    const k = document.createElement('span'); k.className = 'sm-k'; k.textContent = t('scene.plinks.row');
    const v = document.createElement('div'); v.className = 'sm-v'; v.appendChild(wrap);
    row.append(k, v);
    // `표시` 줄 바로 아래(없으면 안내 줄 앞)
    const disp = document.getElementById('btn-done'), dr = disp && disp.closest ? disp.closest('.sm-row') : null;
    if (dr && dr.parentNode === menu) menu.insertBefore(row, dr.nextSibling);
    else menu.insertBefore(row, menu.querySelector('.sm-hint') || null);
  }
  // ── 범례 ──
  let lg = null;
  function mountLegend() {
    const L = document.getElementById('legend');
    if (!L || lg) return;
    lg = document.createElement('div'); lg.className = 'plinks-legend';
    const li = (cls, key, mode) => `<li data-m="${mode}"><i class="pll ${cls}"></i>${t(key)} <span>${t(key + '.d')}</span></li>`;
    lg.innerHTML = `<h3>${t('scene.plinks.lg.h')}</h3><ul>` +
      li('pll-laser', 'scene.plinks.lg.laser', 'laser') + li('pll-cp', 'scene.plinks.lg.laserCp', 'laser') +
      li('pll-orbit', 'scene.plinks.lg.orbit', 'orbit') + li('pll-cporb', 'scene.plinks.lg.orbitCp', 'orbit') +
      `<li><span class="plinks-now"></span></li></ul>`;
    L.appendChild(lg);
  }
  const nowEl = () => lg && lg.querySelector('.plinks-now');
  function sync() {
    const p = plinksPref();
    for (const b of btns) b.setAttribute('aria-pressed', String(b.dataset.plinks === p));
    const planet = h.viewMode() === 'planet';
    if (row) row.hidden = !planet;
    if (lg) {
      lg.hidden = !planet;
      const cur = plinksClock.cur || (p === 'rotate' ? 'laser' : p);
      for (const x of lg.querySelectorAll('li[data-m]')) x.classList.toggle('cur', x.dataset.m === cur);
      const n = nowEl();
      if (n) n.textContent = t('scene.plinks.lg.now', { mode: t('scene.plinks.' + cur), how: t(p === 'rotate' ? 'scene.plinks.lg.rot' : 'scene.plinks.lg.fixed') });
    }
  }
  mountRow(); mountLegend();
  onPlinks(sync); sync();
  // 번갈아 차례는 시간이 바꾸므로 범례가 보일 때만 2초마다 다시
  setInterval(() => { const L = document.getElementById('legend'); if (L && !L.hidden && lg && !lg.hidden) sync(); }, 2000);
  return { viewChanged: () => { mountRow(); mountLegend(); sync(); }, sync };
}
