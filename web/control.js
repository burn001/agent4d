// 화면 원격 조작 — 받는 쪽. 서버를 띄운 PC 의 `agent4d ctl …` 명령을 SSE `control` 이벤트로 받아
// app.js 가 넘긴 hooks(기존 설정 함수)로 적용하고 POST /control/ack 로 결과·상태를 돌려준다.
//  · 화면 id: 브라우저 고정(localStorage ccviz.ctl.id) + 탭(sessionStorage) — 복제한 탭은 BroadcastChannel 로 겹침을 알아채고 새 탭 id
//  · 연결: 데이터 SSE(/events)에 client·cname 을 붙여 등록(query()). 데이터 SSE 가 없을 때(재생 중·끊김)만 /control/events 를 따로 연다
//  · ⚙ 메뉴: '이 화면 이름'(비우면 자동 — 브라우저 · OS · 화면 크기) · '원격 조작 받기 켬/끔'(기본 켬, 끄면 명령을 적용하지 않고 remote_off 로 답함)
//  · --temp: 적용 전 ccviz.* 저장값을 떠 두고 적용 뒤 되돌림(이번 접속만)
// 문구는 이 모듈 안 작은 표(영·한) — 공용 i18n 사전은 건드리지 않는다.
import { applyControl, autoName, cleanName, snapshotStore, restoreStore } from './control-core.mjs';
import { lang } from './i18n.mjs';

const K_ID = 'ccviz.ctl.id', K_NAME = 'ccviz.ctl.name', K_ACCEPT = 'ccviz.ctl.accept', K_TAB = 'ccviz.ctl.tab';
const KEEP = [K_ID, K_NAME, K_ACCEPT];
const STATE_EVERY_MS = 60_000;
const FALLBACK_DELAY_MS = 1500;

const TXT = {
  en: { name: 'Screen name', namePh: 'auto: {n}', nameTitle: 'Name shown in `agent4d ctl clients` (empty = automatic)', remote: 'Remote control',
    on: 'Accept', off: 'Ignore', remoteTitle: 'Accept commands sent with `agent4d ctl` from the PC running the server', id: 'id {id}' },
  ko: { name: '이 화면 이름', namePh: '자동: {n}', nameTitle: '`agent4d ctl clients` 에 보이는 이름(비우면 자동)', remote: '원격 조작',
    on: '받기', off: '안 받기', remoteTitle: '서버를 띄운 PC 에서 `agent4d ctl` 로 보낸 명령을 받아 적용', id: 'id {id}' },
};
const tx = (k, v = {}) => String((TXT[lang()] || TXT.en)[k] || TXT.en[k] || k).replace(/\{(\w+)\}/g, (_, x) => (v[x] != null ? v[x] : ''));

const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* 저장소 없음 */ } };
const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* 저장소 없음 */ } };
const rnd = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join(''); };

/**
 * @param {{hooks:object, relApi:(p:string,q?:object)=>string, getState:()=>object, live:boolean, onIdChange?:()=>void}} o
 */
export function mountControl({ hooks, relApi, getState, live, onIdChange = null }) {
  let base = lsGet(K_ID);
  if (!base || !/^[a-z0-9]{4,16}$/.test(base)) { base = rnd(6); lsSet(K_ID, base); }
  let tab = ssGet(K_TAB);
  if (!tab || !/^[a-z0-9]{2,8}$/.test(tab)) { tab = rnd(3); ssSet(K_TAB, tab); }
  let id = `${base}-${tab}`;
  let accept = lsGet(K_ACCEPT) !== 'off';
  const name = () => cleanName(lsGet(K_NAME)) || autoName(navigator.userAgent, screen.width, screen.height);

  // 복제한 탭(sessionStorage 가 따라옴) → 같은 id 가 둘: 나중에 연 쪽이 새 탭 id 로
  const nonce = rnd(6);
  let bc = null;
  try {
    bc = new BroadcastChannel('agent4d-ctl');
    if (bc.unref) bc.unref(); // (Node 시험) 채널이 프로세스를 붙잡지 않게
    bc.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'who' && d.id === id && d.nonce !== nonce) bc.postMessage({ type: 'mine', id, to: d.nonce });
      else if (d.type === 'mine' && d.to === nonce && d.id === id) {
        tab = rnd(3); ssSet(K_TAB, tab); id = `${base}-${tab}`;
        if (onIdChange) onIdChange(); else reopenFallback();
      }
    };
  } catch (e) { bc = null; }
  if (bc) bc.postMessage({ type: 'who', id, nonce });

  let primary = null, fallback = null, fbTimer = 0;
  let lateRestore = null;
  const seen = new Set(); // 같은 명령을 두 번 적용하지 않게(연결 전환 중)

  function stateNow() {
    let s = {};
    try { s = getState() || {}; } catch (e) { /* 무시 */ }
    return { ...s, accept };
  }
  function post(body) {
    if (!live) return Promise.resolve(false);
    return fetch(relApi('control/ack'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: id, name: name(), state: stateNow(), ...body }), cache: 'no-store' })
      .then((r) => r.ok, () => false);
  }
  const reportState = () => post({});

  async function onControl(e) {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (!msg || !msg.id || seen.has(msg.id)) return;
    seen.add(msg.id);
    if (seen.size > 200) seen.delete(seen.values().next().value);
    if (!accept) { post({ cmdId: msg.id, ok: false, error: 'remote_off' }); return; }
    if (lateRestore) lateRestore(); // 앞 --temp 의 늦은 되돌림은 이 명령보다 먼저 끝낸다(뒤 명령의 저장을 덮지 않게)
    const snap = msg.temp ? snapshotStore(localStorage) : null;
    const r = await applyControl(msg, hooks);
    if (snap) {
      restoreStore(localStorage, snap, 'ccviz.', KEEP);
      const t = setTimeout(() => { if (lateRestore) lateRestore(); }, 400); // 비동기로 늦게 저장하는 설정(표현 전환 등)까지
      lateRestore = () => { clearTimeout(t); lateRestore = null; restoreStore(localStorage, snap, 'ccviz.', KEEP); };
    }
    await post({ cmdId: msg.id, ok: !!r.ok, error: r.ok ? undefined : r.error, detail: r.detail || undefined, pendingGesture: r.pendingGesture || undefined });
    if (r.ok && typeof r.after === 'function') setTimeout(r.after, 50); // 새로고침·언어처럼 페이지를 떠나는 것은 답한 뒤
  }
  function onHello(e) {
    try { const d = JSON.parse(e.data); if (d && d.id === id) reportState(); } catch (err) { /* 무시 */ }
  }
  function listen(src) {
    src.addEventListener('control', onControl);
    src.addEventListener('ctl-hello', onHello);
  }
  function closeFallback() { clearTimeout(fbTimer); fbTimer = 0; if (fallback) { fallback.close(); fallback = null; } }
  function openFallback() {
    if (!live || primary || fallback) return;
    fallback = new EventSource(relApi('control/events', query()));
    listen(fallback);
  }
  function reopenFallback() { if (fallback) { closeFallback(); openFallback(); } }

  /** 데이터 SSE 에 붙일 질의 */
  function query() { return { client: id, cname: name() }; }
  /** app.connect() 가 새 데이터 SSE 를 만들 때 */
  function bind(src) { primary = src; closeFallback(); listen(src); }
  /** app.disconnect() — 잠깐 뒤에도 데이터 SSE 가 없으면(재생 중 등) 명령 전용 SSE */
  function unbind(src) {
    if (src && primary !== src) return;
    primary = null;
    clearTimeout(fbTimer);
    fbTimer = setTimeout(openFallback, FALLBACK_DELAY_MS);
  }

  // ── ⚙ 메뉴 두 줄 ──
  function mountRows() {
    const menu = document.getElementById('settings-menu');
    if (!menu || document.getElementById('ctl-name')) return;
    const mk = (label, nodes) => {
      const r = document.createElement('div'); r.className = 'sm-row';
      const k = document.createElement('span'); k.className = 'sm-k'; k.textContent = label;
      const v = document.createElement('div'); v.className = 'sm-v'; v.append(...nodes);
      r.append(k, v);
      return r;
    };
    const inp = document.createElement('input');
    inp.id = 'ctl-name'; inp.type = 'text'; inp.maxLength = 60; inp.className = 'tb ctl-name';
    inp.value = cleanName(lsGet(K_NAME)) || '';
    inp.placeholder = tx('namePh', { n: autoName(navigator.userAgent, screen.width, screen.height) });
    inp.title = tx('nameTitle') + ' · ' + tx('id', { id });
    inp.setAttribute('aria-label', tx('name'));
    inp.style.cssText = 'width:15em;max-width:100%;text-align:left;cursor:text';
    let nameT = 0;
    inp.addEventListener('input', () => { clearTimeout(nameT); nameT = setTimeout(() => { lsSet(K_NAME, cleanName(inp.value) || null); reportState(); }, 500); });
    inp.addEventListener('keydown', (e) => e.stopPropagation()); // Space(실시간 정지)·Esc 단축키가 입력을 가로채지 않게
    const btn = document.createElement('button');
    btn.id = 'btn-ctl-accept'; btn.type = 'button'; btn.className = 'tb'; btn.title = tx('remoteTitle');
    const label = () => { btn.textContent = accept ? tx('on') : tx('off'); btn.setAttribute('aria-pressed', String(accept)); };
    label();
    btn.addEventListener('click', () => { accept = !accept; lsSet(K_ACCEPT, accept ? 'on' : 'off'); label(); reportState(); });
    const hint = menu.querySelector('.sm-hint');
    menu.insertBefore(mk(tx('name'), [inp]), hint || null);
    menu.insertBefore(mk(tx('remote'), [btn]), hint || null);
  }
  mountRows();

  if (live) { const iv = setInterval(reportState, STATE_EVERY_MS); if (iv && iv.unref) iv.unref(); }

  return {
    get id() { return id; }, get accept() { return accept; }, name, query, bind, unbind, reportState,
    setAccept(on) { accept = !!on; lsSet(K_ACCEPT, accept ? 'on' : 'off'); const b = document.getElementById('btn-ctl-accept'); if (b) { b.textContent = accept ? tx('on') : tx('off'); b.setAttribute('aria-pressed', String(accept)); } },
    get fallbackOpen() { return !!fallback; },
  };
}
