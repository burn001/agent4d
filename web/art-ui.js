// 작업 대상 층 — 앱 쪽 연결: ⚙ 메뉴 켬/끔(표현마다 저장·URL 강제), 장부·연출 큐, 기본 장부 불러오기(artifacts),
// 이벤트 반영, 실황 패널 고정 줄(파괴적 작업), mock 드라이버. 끄면 아무것도 하지 않는다(이벤트도 안 봄·요청 없음·표현 객체 없음).
import { ArtBook, ArtFx, ART_VIEWS_READY, ART_STYLE_DEFAULT, artStoreKey, artInitial, artAlarmText, ensureArtCss, ART_KIND_LABEL } from './artifact-core.mjs';
import { t } from './i18n.mjs';
import { localizeArtifacts } from './i18n-server.mjs'; // 서버 문구('산출물' 등)

const RETRY_MS = 3000;
const PIN_MAX = 3, PIN_TTL = 10 * 60_000;

/**
 * @param {object} h 훅
 *  getView() · viewMode() · params(URLSearchParams) · lsGet/lsSet · relApi(path,q) · live(bool: 서버 있음)
 *  scope() → {all:boolean, sessionId, pids:string[]} · replay() → {sessionId, at}|null · clock() → ms
 *  onEvent(ev) (mock 드라이버가 앱 경로로 이벤트를 넣음) · nodes() → 노드들 · nodeLabel(id)
 */
export function mountArtifacts(h) {
  ensureArtCss();
  const book = new ArtBook();
  const fx = new ArtFx();
  let on = false;
  let mode = h.viewMode();
  const urlVal = h.params.get('artifacts');
  const loaded = new Map(); // pid(또는 '_') → {at, until, pending:[ev], timer}
  let driver = null;
  let pruneT = 0;
  // 표시 양식(⚙): 밝기 0～100(기본 35) · 선만/옅은 채움 — 표현이 같은 객체를 읽음(바꾸면 바로)
  const style = { ...ART_STYLE_DEFAULT };
  { const b = Number(h.lsGet('ccviz.artifacts.bright')); if (Number.isFinite(b) && h.lsGet('ccviz.artifacts.bright') != null) style.bright = Math.max(0, Math.min(1, b / 100)); }
  if (h.lsGet('ccviz.artifacts.fill') === 'line') style.fill = 'line';

  // ── ⚙ 메뉴 줄 ──
  const btn = document.createElement('button');
  btn.id = 'btn-artifacts'; btn.type = 'button'; btn.className = 'tb';
  btn.title = t('boards.art.btnTitle');
  const soon = document.createElement('span'); soon.className = 'art-soon'; soon.textContent = t('boards.art.soon'); soon.hidden = true;
  const bright = document.createElement('input'); bright.type = 'range'; bright.min = '0'; bright.max = '100'; bright.step = '5'; bright.id = 'art-bright';
  bright.value = String(Math.round(style.bright * 100)); bright.setAttribute('aria-label', t('boards.art.brightAria')); bright.title = t('boards.art.brightTitle');
  const fillSel = document.createElement('select'); fillSel.id = 'art-fill'; fillSel.setAttribute('aria-label', t('boards.art.fillAria'));
  fillSel.innerHTML = `<option value="line">${t('boards.art.fill.line')}</option><option value="soft">${t('boards.art.fill.soft')}</option>`; fillSel.value = style.fill;
  const brightLab = document.createElement('label'); brightLab.className = 'sm-range'; const bs = document.createElement('span'); bs.textContent = t('boards.art.bright'); brightLab.append(bs, bright);
  const restyle = () => { const v = h.getView(); if (v && v.invalidate) v.invalidate(); };
  bright.addEventListener('input', () => { style.bright = Number(bright.value) / 100; h.lsSet('ccviz.artifacts.bright', bright.value); restyle(); });
  fillSel.addEventListener('change', () => { style.fill = fillSel.value === 'line' ? 'line' : 'soft'; h.lsSet('ccviz.artifacts.fill', style.fill); restyle(); });
  function mountRow() {
    const menu = document.getElementById('settings-menu');
    if (!menu || document.getElementById('btn-artifacts')) return;
    const r = document.createElement('div'); r.className = 'sm-row';
    const k = document.createElement('span'); k.className = 'sm-k'; k.textContent = t('boards.art.row');
    const v = document.createElement('div'); v.className = 'sm-v'; v.append(btn, soon, brightLab, fillSel);
    r.append(k, v);
    const hint = menu.querySelector('.sm-hint');
    menu.insertBefore(r, hint || null);
  }
  // 범례(⚙ 범례): 종류별 기호
  function mountLegend() {
    const lg = document.getElementById('legend');
    if (!lg || lg.querySelector('.art-legend')) return;
    const d = document.createElement('div'); d.className = 'art-legend';
    // 표현마다 기호가 다르다: 줄마다 흐름·Planet·복셀 설명을 두고 지금 표현 것만 보임(d.dataset.v)
    const K = [['al-file', 'file', 'file'], ['al-db', 'db', 'db'], ['al-repo', 'repo', 'repo'], ['al-remote', 'remote', 'remote'], ['al-svc', 'service', 'svc'], ['al-out', 'output', 'out']]
      .map(([c, kind, lk]) => [c, ART_KIND_LABEL[kind], t(`boards.lg.${lk}.flow`), t(`boards.lg.${lk}.planet`), t(`boards.lg.${lk}.voxel`)]);
    if (!document.getElementById('art-legend-css')) { const sc = document.createElement('style'); sc.id = 'art-legend-css'; sc.textContent = '.art-legend span[data-v]{display:none}.art-legend[data-v="flow"] span[data-v="flow"],.art-legend[data-v="planet"] span[data-v="planet"],.art-legend[data-v="voxel"] span[data-v="voxel"]{display:inline}'; document.head.appendChild(sc); }
    d.dataset.v = mode;
    d.innerHTML = `<h3>${t('boards.lg.title')}</h3><ul>` +
      K.map(([c, n, f, p, v]) => `<li><i class="al ${c}"></i>${n} <span data-v="flow">${f}</span><span data-v="planet">${p}</span><span data-v="voxel">${v}</span></li>`).join('') +
      `<li><i class="al al-imp"></i>${t('boards.lg.imp')} <span>${t('boards.lg.impDesc')}</span></li><li><i class="al al-x"></i>${t('boards.x.generic')} <span>${t('boards.lg.xDesc')}</span></li>` +
      `<li><span>${t('boards.lg.acts')}</span></li>` +
      `<li><span>${t('boards.lg.lit')}</span></li></ul>`;
    lg.appendChild(d);
  }
  const ready = (m) => ART_VIEWS_READY.has(m) && !!(h.getView() && h.getView().setArtifacts);
  function label() {
    const ok = ready(mode);
    btn.disabled = !ok;
    soon.hidden = ok;
    btn.textContent = t(on && ok ? 'boards.art.btnOn' : 'boards.art.btnOff');
    btn.setAttribute('aria-pressed', String(on && ok));
    const lgd = document.querySelector('#legend .art-legend'); if (lgd) lgd.dataset.v = mode; // 표현별 기호
  }
  btn.addEventListener('click', () => { if (!ready(mode)) return; setOn(!on, { save: true }); });

  // ── 실황 패널 고정 줄 ──
  let pins = null;
  function pinBox() {
    if (pins) return pins;
    const panel = document.getElementById('panel'), stream = document.getElementById('stream');
    if (!panel || !stream) return null;
    pins = document.createElement('div'); pins.id = 'art-pins'; pins.setAttribute('aria-live', 'polite');
    panel.insertBefore(pins, stream);
    return pins;
  }
  function pin(text, key) {
    const box = pinBox(); if (!box) return;
    if (box.querySelector(`[data-key="${CSS.escape(key)}"]`)) return;
    const el = document.createElement('div'); el.className = 'art-pin'; el.dataset.key = key;
    const s = document.createElement('span'); s.textContent = text; s.title = text;
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', t('boards.art.pinClose'));
    x.addEventListener('click', () => el.remove());
    el.append(s, x);
    box.prepend(el);
    while (box.children.length > PIN_MAX) box.lastElementChild.remove();
    setTimeout(() => el.remove(), PIN_TTL);
  }
  const clearPins = () => { if (pins) pins.textContent = ''; };

  // ── 기본 장부 ──
  const keyOf = (pid) => pid || '_';
  async function fetchBase(key, q) {
    const st = loaded.get(key) || { pending: [] };
    loaded.set(key, st);
    st.at = Date.now(); st.inflight = true;
    clearTimeout(st.timer);
    let body = null;
    if (!h.live) {
      const { artMockPayload } = await import('./art-mock.mjs');
      const n = Number(h.params.get('artn')) || 36; // ?artn=N: mock 지난 대상 수(부하 측정)
      const main = [...h.nodes()].find((x) => x.kind === 'main' && (key === '_' || x.projectId === key)); // 지난 대상의 주인 = 그 섬 메인
      body = artMockPayload(key === '_' ? 'mock' : key, q.until || h.clock(), main ? main.id : null, Math.min(2000, n));
    } else {
      try { const r = await fetch(h.relApi('artifacts', q), { cache: 'no-store' }); if (r.ok) { body = await r.json(); localizeArtifacts(body); } } catch (e) { /* 서버 없음 */ }
    }
    if (!on || loaded.get(key) !== st) return;
    st.inflight = false;
    if (body && Array.isArray(body.items)) {
      book.load(key, body.items, { nodes: body.nodes || null });
      for (const ev of st.pending.splice(0)) book.apply(ev, key); // 불러오는 사이 온 이벤트(중복은 toolUseId 로 걸러짐)
      const v = h.getView(); if (v && v.invalidate) v.invalidate();
    }
    if (body && body.building) st.timer = setTimeout(() => { if (on && loaded.get(key) === st) fetchBase(key, q); }, RETRY_MS);
  }
  /** 지금 범위의 기본 장부를 (없는 것만) 불러온다 */
  function ensureBase(force = false) {
    if (!on) return;
    const sc = h.scope();
    const rp = h.replay();
    const until = rp ? Math.round(rp.at) : null;
    if (sc.all) {
      for (const pid of sc.pids) if (force || !loaded.has(pid)) fetchBase(pid, { project: pid, ...(until ? { until } : {}) });
    } else if (force || !loaded.has('_')) {
      const sid = rp ? rp.sessionId : sc.sessionId;
      if (sid || !h.live) fetchBase('_', { session: sid, ...(until ? { until } : {}) });
    }
  }

  function startDriver() {
    if (h.live || driver || h.params.get('artmock') === '0') return; // ?artmock=0: mock 이벤트 없이 기본 장부만(밝기 측정)
    import('./art-mock.mjs').then(({ ArtMockDriver }) => {
      if (!on || driver || h.live || h.replay()) return;
      driver = new ArtMockDriver({ nodes: () => h.nodes(), emit: (ev) => h.onEvent(ev), projectOf: (n) => (h.scope().all ? n.projectId || null : null) });
      driver.start();
    });
  }
  const stopDriver = () => { if (driver) { driver.stop(); driver = null; } };

  // ── art 없는 이벤트 → 상호작용 연출 ──
  function bare(ev, speed) {
    const A = fx.acts, now = performance.now() / 1000;
    if (ev.type === 'node-update') return ev.patch && ev.patch.status === 'stopped' ? A.nodeStopped(ev.nodeId, now, speed) > 0 : false;
    if (ev.type !== 'tool-start' && ev.type !== 'tool-end') return false;
    if (ev.type === 'tool-end' && ev.ok === false) return A.fail(ev, now, speed) > 0;
    const key = h.scope().all ? ev.projectId || null : '_';
    if (!key) return false;
    if (ev.type === 'tool-end') {
      const p = ev.toolUseId ? A.pending.get(ev.toolUseId) : null;
      if (p) { // 시작엔 대상이 있었는데 끝엔 없다: 노드를 끄며 닫힌 호출(글 없음) = 중지됨, 그 밖은 짝만 지움
        if (!ev.text && !ev.brief) return A.fail({ ...ev, brief: 'interrupted' }, now, speed) > 0;
        A.pending.delete(ev.toolUseId);
      }
      return ev.cat === 'search' && (ev.tool === 'Grep' || ev.tool === 'Glob') ? A.search(ev, key, book.items(key), now, speed) > 0 : false;
    }
    if (ev.cat === 'search' && (ev.tool === 'Grep' || ev.tool === 'Glob')) return A.search(ev, key, null, now, speed) > 0;
    if (ev.cat === 'web') return A.web(ev, key, now, speed) > 0;
    return false;
  }
  /** 연출 효과음(⚙ 효과음 켬일 때만, 배속 4 이하, 기존 도구 소리와 겹치지 않는 착지 순간 — 생성·삭제·산출물) */
  function actSounds(speed) {
    const S = fx.acts.sounds;
    if (!S.length) return;
    const names = S.splice(0);
    if (speed > 4 || (typeof document !== 'undefined' && document.hidden)) return;
    const sfx = typeof window !== 'undefined' && window.__ccviz ? window.__ccviz.sfx : null;
    if (!sfx || !sfx.enabled || sfx.held) return;
    try { sfx.play(names[names.length - 1], { priority: 3, gain: 0.55 }); } catch (e) { /* 소리 없음 */ }
  }

  function applyView() {
    const v = h.getView();
    if (v && v.setArtifacts) v.setArtifacts({ on: on && ready(mode), book, fx, style });
  }

  function setOn(next, { save = false } = {}) {
    next = !!next && ready(mode);
    if (save) h.lsSet(artStoreKey(mode), next ? '1' : '0');
    if (next === on) { label(); return; }
    on = next;
    book.reset(); fx.clear(); loaded.clear();
    if (!on) { stopDriver(); clearPins(); clearInterval(pruneT); pruneT = 0; }
    applyView();
    if (on) {
      book.defaultProject = '_';
      ensureBase(true);
      startDriver();
      pruneT = setInterval(() => { if (book.prune(h.clock())) { const v = h.getView(); if (v && v.invalidate) v.invalidate(); } }, 60_000);
    }
    label();
  }

  mountRow();
  mountLegend();
  on = false;
  label();
  // 처음: 이 표현의 저장값·URL
  const first = artInitial(mode, urlVal, h.lsGet(artStoreKey(mode)));
  if (first) setTimeout(() => setOn(true), 0);

  return {
    book, fx,
    get on() { return on; },
    setOn,
    /** 앱 onEvent 마다(라이브·재생·mock 같은 경로). quiet 이면 장부만, 연출 없음 */
    event(ev, { quiet = false, speed = 1 } = {}) {
      if (!on || !ev) return;
      // art 없는 이벤트: 검색 레이더·핑, 웹 신호파, 실패 스파크, 중지됨 회색(연출만 — 장부는 그대로)
      if (!ev.art || (ev.type === 'tool-end' && ev.ok === false)) {
        if (!quiet && bare(ev, speed)) { const v = h.getView(); if (v && v.invalidate) v.invalidate(); actSounds(speed); }
        if (!ev.art) return;
      }
      const key = h.scope().all ? ev.projectId || null : '_';
      if (!key) return;
      const st = loaded.get(key);
      if (st && st.inflight) st.pending.push(ev);
      const res = book.apply(ev, key);
      if (!res) return;
      if (!quiet) { fx.note(res, ev.nodeId, performance.now() / 1000, speed, ev.toolUseId || null); actSounds(speed); }
      const v = h.getView(); if (v && v.invalidate) v.invalidate();
      if (ev.type === 'tool-end' && !quiet) for (const ch of res.changes) if (ch.ref.x && ch.ref.x !== 'overwrite') pin(artAlarmText(ch.ref, h.nodeLabel(ev.nodeId)), `${ev.toolUseId}|${ch.ref.id}`);
    },
    /** 스냅샷(재연결·범위 바뀜·재생 시크): 장부를 비우고 그 시점 기본 장부를 다시 */
    snapshot() {
      if (!on) return;
      book.reset(); fx.clear(); loaded.clear();
      if (h.replay()) stopDriver(); else startDriver();
      ensureBase(true);
    },
    /** 보이는 프로젝트가 늘었을 수 있음(전체 보기 projects 갱신) */
    projectsChanged() { ensureBase(false); },
    /** 표현이 바뀜: 그 표현의 저장값으로 */
    viewChanged(nextMode) {
      mode = nextMode;
      const want = artInitial(mode, urlVal, h.lsGet(artStoreKey(mode)));
      if (want !== on) setOn(want); else { applyView(); label(); }
    },
  };
}
