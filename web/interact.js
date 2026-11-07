// Interactive 패널: 사이드 패널 머리에서 실황 ⇄ Interactive 를 바꾼다.
// Interactive = 고른 활성 Claude Code 세션에 메시지를 넣고(서버가 그 세션 수신함에 전달) 그 세션의 응답을 이어서 보여 준다.
// 기기 키: ECDSA P-256 — 개인키는 내보낼 수 없는 CryptoKey 로 IndexedDB 에만, 서버는 공개키만 안다. 요청마다 서명(시각·nonce).
// 기능이 꺼져 있거나(서버 설정) 기기가 승인 전이면 안내만 보이고 입력창은 잠긴다. 앱 본체와는 window.__ccviz(고른 노드)만 읽는다.
import { t } from './i18n.mjs';
import { escapeHtml } from './html-util.mjs';
import { answerText, togglePick, answerPicks } from './ask-card.mjs'; // 선택형 질문·계획 승인 카드
import { rowHtml, moreHtml } from './interact-view.mjs'; // 대화 줄 그리기
import { renderPermCard, permOpenHtml, allowStep, ARM_MS } from './perm-card.mjs'; // 계획 승인·권한 확인 창
import './md-links.js'; // 각주 왕복 링크
import './math.js'; // 수식 조판
import { mountWaits } from './wait-ui.js'; // 입력 대기 배지
import { signingString, b64u, hex, MODE_KEY, POLL_MS, CONFIRM_MS, isSlashCommand, slashKind, sessionOfNode, viewRows, noticeKey } from './interact-core.mjs';

const DB = 'agent4d-ix', STORE = 'keys', KEY = 'device';
const $ = (s, el = document) => el.querySelector(s);
const enc = (s) => new TextEncoder().encode(s);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const isKo = () => (document.documentElement.lang || '').startsWith('ko');
const aliasText = (al) => (al ? (isKo() ? al.ko : al.en) : '');
const api = (p) => new URL('./interact/' + p, location.href);

function ensureCss() {
  if (document.querySelector('link[data-ix-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'interact.css'; l.dataset.ixCss = '1';
  document.head.appendChild(l);
}

// ── 기기 키(IndexedDB) ──
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => {
      const db = rq.result;
      const tx = db.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(r && 'result' in r ? r.result : undefined); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
async function loadKey(create = true) {
  let k = await idb('readonly', (s) => s.get(KEY));
  if (k && k.priv && k.jwk) return k;
  if (!create) return null; // 실황에서 배지용 상태 확인은 새 키를 만들지 않는다
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const full = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
  const id = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc(`P-256.${jwk.x}.${jwk.y}`)))).slice(0, 20);
  k = { priv: pair.privateKey, jwk, id };
  await idb('readwrite', (s) => s.put(k, KEY));
  return k;
}

class Interact {
  constructor() {
    this.panel = $('#panel');
    this.mode = lsGet(MODE_KEY) === 'ix' ? 'ix' : 'live';
    this.supported = !!(window.isSecureContext && window.crypto?.subtle && window.indexedDB);
    this.key = null; this.skew = 0;
    this.enabled = null; this.device = null; this.error = null;
    this.sessions = []; this.sid = null; this.manual = false; this.lastFocus = undefined;
    this.items = []; this.next = null; this.full = new Map(); // o → 전체 원문
    this.local = []; this.holdLikely = false;
    this.before = null; this.openSys = new Set(); this._moreBusy = false; this.privacy = null; // 이전 대화 자리 · 펼친 알림 묶음 · minimal
    this.picks = new Map(); this.askSent = new Map(); this._can = false; this._cards = new Map(); // 카드 id → 고른 선택지 · 보낼 수 있음 · 카드
    this.others = new Map(); // 카드 id → (질문 번호 → 기타(직접 입력) 글)
    this._permReset();
    this._timer = 0; this._busy = false; this._sessAt = 0;
    ensureCss();
    this._build();
    this._fillSelect();
    this.setMode(this.mode, false);
  }

  _build() {
    const head = $('header', this.panel);
    const h2 = $('h2', head);
    const seg = document.createElement('span');
    seg.className = 'ix-seg'; seg.setAttribute('role', 'tablist'); seg.title = t('ix.tab.title');
    seg.innerHTML = `<button type="button" role="tab" data-m="live">${escapeHtml(t('ix.tab.live'))}</button><button type="button" role="tab" data-m="ix">${escapeHtml(t('ix.tab.ix'))}</button>`;
    h2.after(seg);
    seg.addEventListener('click', (e) => { const b = e.target.closest('button[data-m]'); if (b) this.setMode(b.dataset.m); });
    this.panel.classList.add('ix-ready');
    this.seg = seg;

    const pane = document.createElement('div');
    pane.id = 'ix-pane'; pane.hidden = true;
    pane.innerHTML = `
      <div class="ix-head">
        <select id="ix-session" aria-label="${escapeHtml(t('ix.session'))}" title="${escapeHtml(t('ix.session.follow'))}"></select>
        <span class="ix-me" hidden></span>
      </div>
      <div class="ix-note" hidden></div>
      <div class="ix-feed" role="log" aria-live="polite"></div>
      <div class="ix-warn" role="alert" hidden></div>
      <form class="ix-form" autocomplete="off">
        <textarea rows="2" maxlength="4000" disabled></textarea>
        <button type="submit" disabled>${escapeHtml(t('ix.send'))}</button>
      </form>`;
    $('#stream', this.panel).after(pane);
    this.pane = pane;
    this.sel = $('#ix-session', pane); this.me = $('.ix-me', pane); this.note = $('.ix-note', pane);
    this.feed = $('.ix-feed', pane); this.form = $('form', pane); this.warn = $('.ix-warn', pane); this.ta = $('textarea', pane); this.btn = $('button', this.form);
    this.sel.addEventListener('change', () => { this.manual = true; this._pick(this.sel.value || null); });
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this._send(); });
    // ·143.3 확인 단계 중 글을 고치면 확인을 풀고 다시 묻는다
    this.ta.addEventListener('input', () => {
      if (this._confirm && this._confirm.text !== this.ta.value.trim()) { this._confirm = null; this._render(); }
      else if ((slashKind(this.ta.value) === 'skill') !== !!this._skillHint) this._render(); // 스킬 명령 꼬리표
    });
    this.ta.addEventListener('keydown', (e) => {
      e.stopPropagation(); // Space(실시간 정지)·Esc 등 화면 단축키가 입력을 가로채지 않게
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); this._send(); }
    });
    // 질문 카드: 선택지 누름(단일은 하나, 복수는 토글) → '일반 메시지로 보내기'(선택 창의 답이 아님 — 카드 안내 문구)
    const pickAt = (el) => {
      const card = el.closest('.ask-card'), id = card && card.dataset.tu, c = id && this._cards.get(id);
      if (!c) return;
      if ((this.askSent.get(id) || {}).state === 'answered') return; // 질문창에 이미 답함 — 고르기를 바꾸지 않음
      this.picks.set(id, togglePick(c, this.picks.get(id), Number(el.dataset.q), Number(el.dataset.o)));
      this.askSent.delete(id); // 고르기를 바꾸면 이전 보냄 표시를 지움
      this._renderFeed();
    };
    this.feed.addEventListener('click', (e) => {
      if (e.target.closest('.ix-more')) { this._loadMore(); return; } // 이전 대화 더 보기
      const fb = e.target.closest('button.ix-full'); // 잘린 응답 전체 보기
      if (fb) { this._loadFull(Number(fb.dataset.o)); return; }
      const o = e.target.closest('.ask-o[role="button"]');
      if (o) { pickAt(o); return; }
      const pb = e.target.closest('.perm-allow, .perm-deny'); // 계획 승인·권한 창 허용/거부
      if (pb) { const pid = pb.closest('[data-pu]')?.dataset.pu; if (pid && !pb.disabled) this._perm(pid, pb.classList.contains('perm-allow') ? 'allow' : 'deny'); return; }
      const ab = e.target.closest('.ask-answer'); // 질문창에 답하기(Remote Control 세션)
      if (ab) { const aid = ab.closest('.ask-card')?.dataset.tu; if (aid && !ab.disabled) this._answer(aid); return; }
      const b = e.target.closest('.ask-send');
      const id = b && b.closest('.ask-card')?.dataset.tu;
      if (!id || b.disabled) return;
      const text = answerText(this._cards.get(id), this.picks.get(id), t, this.others.get(id));
      if (!text) return;
      // 누르는 즉시 카드에 '보내는 중' → '보냄 · 대기열' / '못 보냄 · 이유'. 고른 것은 지우지 않고 그대로 보인다(다시 고르면 표시를 지움)
      if ((this.askSent.get(id) || {}).state === 'sending') return;
      this.askSent.set(id, { state: 'sending' }); this._renderFeed();
      this._send(text).then((r) => {
        if (r === 'armed') this.askSent.delete(id); // 확인 단계면 고른 것을 남기고 표시는 지움
        else this.askSent.set(id, r && r.state ? { state: r.state, why: r.why } : { state: 'failed', why: 'other' });
        this._renderFeed();
      });
    });
    // 기타(직접 입력): 글은 상태에만 두고 다시 그리지 않는다(단추 켜짐만 바로 고침) — 다시 그릴 땐 _renderFeed 가 값·포커스를 되살림
    this.feed.addEventListener('input', (e) => {
      const pm = e.target.closest && e.target.closest('.perm-msg'); // 사유·피드백 — 상태에만 둔다(다시 그리지 않음)
      if (pm) { const pu = pm.closest('[data-pu]')?.dataset.pu; if (pu) this.permMsg.set(pu, pm.value); return; }
      const inp = e.target.closest && e.target.closest('input.ask-other');
      if (!inp) return;
      const card = inp.closest('.ask-card'), id = card && card.dataset.tu;
      if (!id) return;
      const m = new Map(this.others.get(id) || []); m.set(Number(inp.dataset.q), inp.value); this.others.set(id, m);
      if ((this.askSent.get(id) || {}).state === 'failed') this.askSent.delete(id);
      this._syncAskButtons(card, id);
    });
    this.feed.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input.ask-other, .perm-msg')) { e.stopPropagation(); return; } // 화면 단축키가 입력을 가로채지 않게
      const o = e.target.closest && e.target.closest('.ask-o[role="button"]');
      if (!o || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault(); e.stopPropagation(); pickAt(o);
    });
    // 시스템 알림 묶음 펼침 상태(다시 그려도 유지). toggle 은 거품이 일지 않아 잡기 단계에서
    this.feed.addEventListener('toggle', (e) => {
      const d = e.target; if (!d || !d.classList || !d.classList.contains('ix-sys')) return;
      if (d.open) this.openSys.add(d.dataset.g); else this.openSys.delete(d.dataset.g);
    }, true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.mode === 'ix') this._tick(true); });
  }

  setMode(m, save = true) {
    this.mode = m === 'ix' ? 'ix' : 'live';
    if (save) lsSet(MODE_KEY, this.mode);
    this.panel.classList.toggle('ix-mode', this.mode === 'ix');
    this.pane.hidden = this.mode !== 'ix';
    for (const b of this.seg.querySelectorAll('button')) { const on = b.dataset.m === this.mode; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
    if (this.mode === 'ix') {
      if (save && document.body.classList.contains('panel-collapsed')) $('#panel-toggle')?.click();
      this._tick(true);
    } else { clearTimeout(this._timer); this._timer = 0; }
  }

  // ── 서명 요청 ──
  async _post(p, body = {}, { sign = true } = {}) {
    const raw = JSON.stringify(body);
    const u = api(p);
    const headers = { 'Content-Type': 'application/json' };
    if (sign && this.key) {
      const ts = String(Date.now() + this.skew);
      const nonce = b64u(crypto.getRandomValues(new Uint8Array(18)));
      const bh = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc(raw))));
      const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.key.priv, enc(signingString('POST', u.pathname, ts, nonce, bh))));
      Object.assign(headers, { 'x-a4d-device': this.key.id, 'x-a4d-ts': ts, 'x-a4d-nonce': nonce, 'x-a4d-sig': b64u(sig) });
    }
    const r = await fetch(u, { method: 'POST', headers, body: raw, credentials: 'same-origin', cache: 'no-store' });
    let j = null; try { j = await r.json(); } catch {}
    if (j && Number.isFinite(j.serverTime)) this.skew = j.serverTime - Date.now();
    return { status: r.status, j: j || {} };
  }

  async _status({ register = true } = {}) { // register:false = 키가 없으면 만들지 않고, 등록 요청도 하지 않음(배지용)
    if (!this.supported) return;
    try {
      if (!this.key) this.key = await loadKey(register);
      if (!this.key) return;
      let { status, j } = await this._post('status');
      if (status !== 200) throw new Error(String(status));
      this.error = null;
      this.enabled = !!j.enabled;
      this.device = j.device || null;
      if (this.enabled && !this.device && register) {
        this._render();
        ({ status, j } = await this._post('register', { jwk: this.key.jwk }));
        if (status === 200) this.device = j.device || null;
        else if (j.error === 'disabled') this.enabled = false;
      }
    } catch (e) { this.error = e; }
  }

  async _loadSessions() {
    const { status, j } = await this._post('sessions');
    if (status !== 200) { this._deny(j); return; }
    this.sessions = j.sessions || [];
    this._sessAt = Date.now();
    this._follow(true);
    this._fillSelect();
  }

  _deny(j) {
    if (j.error === 'disabled') this.enabled = false;
    else if (j.device) this.device = j.device;
    else if (j.error === 'pending' || j.error === 'revoked') this.device = { ...(this.device || {}), status: j.error };
  }

  /** 고른 노드 → 세션(사람이 직접 고른 뒤에도 노드를 새로 고르면 따라감) */
  _follow(force = false) {
    const c = window.__ccviz;
    const fid = c?.panel?.filter || null;
    if (!force && fid === this.lastFocus) return;
    this.lastFocus = fid;
    const n = fid && c?.store?.nodes?.get?.(fid);
    const sid = sessionOfNode(n, c?.store?.sessionId || null);
    if (sid && this.sessions.some((s) => s.sessionId === sid) && (fid || !this.manual || !this.sid)) { if (fid) this.manual = false; this._pick(sid); }
  }

  _fillSelect() {
    const cur = this.sid;
    const opts = [`<option value="">${escapeHtml(this.sessions.length || !this._sessAt ? t('ix.session.pick') : t('ix.session.none'))}</option>`];
    const opt = (s) => {
      const label = [s.project, s.name || s.sessionId.slice(0, 8)].filter(Boolean).join(' · ') + (s.title ? ` — ${s.title}` : '') + (s.holdLikely && !s.headless ? ` ${t('ix.session.hold')}` : '') + (s.unverified && !s.headless ? ` ${t('ix.session.unverified')}` : '');
      return `<option value="${escapeHtml(s.sessionId)}"${s.sessionId === cur ? ' selected' : ''}${s.ready ? '' : ' disabled'}>${escapeHtml(label.slice(0, 90))}</option>`;
    };
    for (const s of this.sessions) if (!s.headless) opts.push(opt(s));
    // 헤드리스(-p 회차·SDK) 세션은 따로 묶고 고를 수 없게(자율 루프에 실수로 넣지 않게)
    const hl = this.sessions.filter((s) => s.headless);
    if (hl.length) opts.push(`<optgroup label="${escapeHtml(t('ix.session.headless'))}">${hl.map((s) => opt({ ...s, ready: false })).join('')}</optgroup>`);
    this.sel.innerHTML = opts.join('');
    if (cur && !this.sessions.some((s) => s.sessionId === cur)) { this.sid = null; this._resetFeed(); }
  }

  _pick(sid) {
    if (sid === this.sid) return;
    this.sid = sid;
    if (this.sel.value !== (sid || '')) this.sel.value = sid || '';
    this._resetFeed();
    this._render();
    this._tick(true);
  }
  /** 열린 계획·권한 창 상태: pend = 브리지에서 읽은 열린 창(toolUseId → view) · permSt = 보낸 상태 · permMsg = 사유/피드백 글 · permArm = 위험 허용 첫 누름 시각 · permDone = 답한 권한 카드(잠깐 보임) */
  _permReset() { this.pend = new Map(); this.permSt = new Map(); this.permMsg = new Map(); this.permArm = new Map(); this.permDone = new Map(); this.live = null; this._pendAt = 0; this._pendErr = null; }
  _resetFeed() { this._permReset(); this.full = new Map(); this.before = null; this.openSys = new Set(); this._lastHtml = ''; this.items = []; this.next = null; this.local = []; this.holdLikely = false; this.picks = new Map(); this.askSent = new Map(); this._cards = new Map(); this.others = new Map(); this.feed.innerHTML = ''; }

  async _loadFeed() {
    if (!this.sid) return;
    const sid = this.sid;
    const { status, j } = await this._post('feed', { session: sid, after: this.next });
    if (sid !== this.sid) return;
    if (status !== 200) { if (status === 403) this._deny(j); return; }
    if (this.next == null) { this.items = j.items || []; this.before = Number.isFinite(j.before) ? j.before : null; } else this.items.push(...(j.items || []));
    if (this.items.length > 3000) { this.items = this.items.slice(-2000); this.before = Number.isFinite(this.items[0]?.o) ? this.items[0].o : null; } // 오래 켜 두면 앞쪽을 버리고 '더 보기' 자리를 그리로
    if (Number.isFinite(j.next)) this.next = j.next;
    this.privacy = j.privacy || null;
    this.live = j.live || null; // perm(계획·권한 창 열림) · remote
    if (j.holdLikely != null) this.holdLikely = !!j.holdLikely;
  }

  /** 잘린 응답 전체 보기: 그 줄(o)의 원문을 서명 요청으로 받아 그 자리에(기억 40건) */
  async _loadFull(o) {
    if (!Number.isFinite(o) || !this.sid || this.full.get(o) === 'loading') return;
    const sid = this.sid;
    this.full.set(o, 'loading'); this._renderFeed();
    let v = 'fail';
    try {
      const { status, j } = await this._post('full', { session: sid, o });
      if (status === 200 && typeof j.md === 'string') v = { md: j.md, cut: !!j.cut };
    } catch {}
    if (sid !== this.sid) return;
    this.full.set(o, v);
    if (this.full.size > 40) this.full.delete(this.full.keys().next().value);
    this._renderFeed();
  }

  /** 이전 대화 더 보기: before 앞에서 사람 턴 50개 → 앞에 붙임(보던 자리 유지) */
  async _loadMore() {
    if (this._moreBusy || !this.sid || !(this.before > 0)) return;
    this._moreBusy = true; this._renderFeed();
    const sid = this.sid;
    try {
      const { status, j } = await this._post('feed', { session: sid, before: this.before });
      if (sid !== this.sid || status !== 200) return;
      const h0 = this.feed.scrollHeight, top0 = this.feed.scrollTop;
      this.items = [...(j.items || []), ...this.items];
      this.before = Number.isFinite(j.before) ? j.before : 0;
      this._moreBusy = false;
      this._renderFeed();
      this.feed.scrollTop = top0 + (this.feed.scrollHeight - h0);
    } catch {} finally { if (this._moreBusy) { this._moreBusy = false; this._renderFeed(); } }
  }

  async _tick(now = false) {
    clearTimeout(this._timer); this._timer = 0;
    if (this.mode !== 'ix') return;
    if (this._busy) { this._timer = setTimeout(() => this._tick(), 300); return; }
    this._busy = true;
    try {
      if (now || this.enabled !== true || !this.device || this.device.status !== 'allowed') await this._status();
      if (this.enabled && this.device?.status === 'allowed') {
        if (now || Date.now() - this._sessAt > 15_000) await this._loadSessions();
        else this._follow();
        if (!document.hidden && !document.body.classList.contains('panel-collapsed')) { await this._loadFeed(); await this._loadPending(); }
      }
    } catch (e) { this.error = e; }
    this._busy = false;
    this._render();
    const slow = this.enabled !== true || this.device?.status !== 'allowed';
    this._timer = setTimeout(() => this._tick(), slow ? 5000 : POLL_MS);
  }

  _render() {
    const nk = noticeKey({ supported: this.supported, enabled: this.enabled, device: this.device, error: this.error });
    const al = this.device?.alias;
    this.me.hidden = !al;
    if (al) { this.me.textContent = t('ix.me', { alias: aliasText(al) }); this.me.title = `${al.ko} · ${al.en} · ${this.device.short || ''}`; }
    const ok = !nk;
    this.sel.disabled = !ok;
    let note = '';
    if (nk === 'pending') note = `${escapeHtml(t('ix.note.pending'))}<code>agent4d interact allow ${escapeHtml(al?.en || this.device?.short || '')}</code><small>${escapeHtml(aliasText(al))} · ${escapeHtml(t('ix.note.pendingId', { id: this.device?.short || '' }))}</small>`;
    else if (nk === 'revoked') note = escapeHtml(t('ix.note.revoked', { alias: al?.en || '' }));
    else if (nk) note = escapeHtml(t('ix.note.' + nk));
    else if (this.sid && this.holdLikely) note = escapeHtml(t('ix.note.hold'));
    const target0 = this.sessions.find((s) => s.sessionId === this.sid);
    if (!nk && target0 && target0.unverified) note = (note ? note + '<br>' : '') + escapeHtml(t('ix.note.unverified'));
    this.note.hidden = !note;
    this.note.classList.toggle('warn', !!nk);
    if (note) this.note.innerHTML = note;
    const target = this.sessions.find((s) => s.sessionId === this.sid);
    const can = ok && !!target && target.ready;
    this.ta.disabled = !can; this.btn.disabled = !can; this._can = can;
    // '확인 안 됨' 세션: 첫 누름은 확인 단계(단추 문구·강조), 10초 안 두 번째 누름에 confirm:true 로 보냄
    const armed = this._armed(this.sid);
    const why = armed ? this._confirm.why : [];
    this.btn.textContent = armed ? t(why.includes('slash') ? 'ix.send.asText' : 'ix.send.confirm') : t('ix.send');
    this.btn.classList.toggle('ix-confirm', armed);
    // 입력창 바로 위 안내(슬래시 명령은 이 통로로 실행되지 않음 · -p 확인 안 됨)
    const wl = why.map((w) => t(w === 'slash' ? 'ix.warn.slash' : 'ix.note.unverified'));
    // 내장이 아닌 슬래시 입력(스킬·플러그인 명령)은 그대로 보내고 짧은 꼬리표만
    this._skillHint = !wl.length && !this.ta.disabled && slashKind(this.ta.value) === 'skill';
    if (this._skillHint) wl.push(t('ix.hint.skill'));
    this.warn.classList.toggle('info', this._skillHint);
    this.warn.hidden = !wl.length;
    const wt = wl.join('\n');
    if (this.warn.textContent !== wt) this.warn.textContent = wt;
    this.ta.placeholder = can ? t('ix.placeholder', { name: target.name || target.project || target.sessionId.slice(0, 8) }) : t('ix.placeholder.none');
    this.ta.title = `${t('ix.warn')} Shift+Enter ↵`;
    if (ok) this._renderFeed(); else this.feed.innerHTML = '';
  }

  _renderFeed() {
    const { rows, local } = viewRows(this.items, this.local, { aliasEn: this.device?.alias?.en, holdLikely: this.holdLikely });
    this.local = local;
    const stick = this.feed.scrollHeight - this.feed.scrollTop - this.feed.clientHeight < 40;
    if (!this.sid) { this.feed.innerHTML = ''; return; }
    if (!rows.length) { this.feed.innerHTML = `<p class="ix-empty">${escapeHtml(t('ix.empty'))}</p>`; return; }
    const tg = this.sessions.find((s) => s.sessionId === this.sid);
    const ctx = { t, mineAlias: aliasText(this.device?.alias), openSys: this.openSys, picks: this.picks, asked: this.askSent, canSend: this._can, cards: this._cards, full: this.full,
      others: this.others, rc: !!(tg && tg.remote), link: (tg && tg.remote) || null,
      pend: this.pend, permSt: this.permSt, shown: new Set() };
    const html = moreHtml(this.before, this._moreBusy, t) + rows.map((r) => rowHtml(r, ctx)).join('') + this._permHtml(ctx); // interact-view.mjs(순수, 시험)
    if (html !== this._lastHtml) {
      // 다시 그리기 전에 입력 중인 '기타' 칸(카드·질문·커서)을 기억했다가 되살린다
      const ae = document.activeElement;
      const foc = ae && ae.classList && ae.classList.contains('ask-other') && this.feed.contains(ae)
        ? { tu: ae.closest('.ask-card')?.dataset.tu, q: ae.dataset.q, a: ae.selectionStart, b: ae.selectionEnd } : null;
      const pfoc = ae && ae.classList && ae.classList.contains('perm-msg') && this.feed.contains(ae) ? { pu: ae.closest('[data-pu]')?.dataset.pu, a: ae.selectionStart, b: ae.selectionEnd } : null;
      this._lastHtml = html;
      this.feed.innerHTML = html;
      for (const inp of this.feed.querySelectorAll('input.ask-other')) {
        const tu = inp.closest('.ask-card')?.dataset.tu, v = tu && this.others.get(tu)?.get(Number(inp.dataset.q));
        if (typeof v === 'string') inp.value = v;
        if (foc && foc.tu === tu && foc.q === inp.dataset.q) { inp.focus(); try { inp.setSelectionRange(foc.a, foc.b); } catch {} }
      }
      for (const inp of this.feed.querySelectorAll('.perm-msg')) { // 사유·피드백 글 되살림
        const pu = inp.closest('[data-pu]')?.dataset.pu, v = pu && this.permMsg.get(pu);
        if (typeof v === 'string') inp.value = v;
        if (pfoc && pfoc.pu === pu) { inp.focus(); try { inp.setSelectionRange(pfoc.a, pfoc.b); } catch {} }
      }
      if (stick) this.feed.scrollTop = this.feed.scrollHeight;
    }
    this._applyFlash();
  }

  /** 입력 대기 배지에서 왔으면: 그 질문 카드(없으면 마지막 대기 카드, 그것도 없으면 맨 아래)로 한 번 스크롤 + 잠깐 강조 */
  _applyFlash() {
    const f = this.flash;
    if (!f || f.sid !== this.sid || Date.now() > f.until || !this.items.length) return;
    const cards = [...this.feed.querySelectorAll('.ask-card')];
    const el = (f.tu && cards.find((c) => c.dataset.tu === f.tu)) || cards.reverse().find((c) => c.classList.contains('s-pending') || c.classList.contains('s-planPending'));
    if (el) el.classList.add('wait-flash');
    if (f.done) return;
    f.done = true;
    if (el) el.scrollIntoView({ block: 'center' }); else this.feed.scrollTop = this.feed.scrollHeight;
  }

  /** 세션 기록이 '권한 창 열림'(live.perm)이고 Remote Control 이 붙어 있으면 브리지에서 열린 계획·권한 창을 읽는다(4초에 한 번까지) */
  async _loadPending() {
    const lv = this.live;
    if (!this.sid || !lv || !lv.perm || !lv.remote) {
      if (this.pend.size || this._pendErr) { this.pend = new Map(); this._pendErr = null; }
      return;
    }
    if (Date.now() - this._pendAt < (this._pendErr === 'upstream_rate' ? 60_000 : PERM_POLL_MS)) return; // 브리지 읽기에도 분당 상한(429) — 10초에 한 번, 429 뒤엔 1분
    this._pendAt = Date.now();
    const sid = this.sid;
    try {
      const { status, j } = await this._post('pending', { session: sid });
      if (sid !== this.sid) return;
      if (status === 200) { this.pend = new Map((j.items || []).filter((x) => x && x.toolUseId).map((x) => [x.toolUseId, x])); this._pendErr = null; }
      else { if (status === 403) this._deny(j); if (status !== 429) this._pendErr = j.error || 'other'; }
    } catch { this._pendErr = 'network'; }
  }

  /** 피드 끝에 붙는 권한 카드들(계획 카드는 rowHtml 이 transcript 카드 자리에 그림) */
  _permHtml(ctx) {
    let h = '';
    for (const [id, v] of this.permDone) if (!this.pend.has(id)) h += `<div class="ix-row k-ask">${renderPermCard(v, { st: this.permSt.get(id), canSend: false, t })}</div>`;
    for (const [id, v] of this.pend) {
      if (ctx.shown.has(id)) continue;
      const at = this.permArm.get(id);
      h += `<div class="ix-row k-ask">${renderPermCard(v, { st: this.permSt.get(id), canSend: this._can, armed: at != null && Date.now() - at <= ARM_MS, link: ctx.link, t })}</div>`;
    }
    if (!this.pend.size && this._pendErr && this.live && this.live.perm) h += `<div class="ix-row k-ask">${permOpenHtml(ctx.link, t)}</div>`;
    return h;
  }

  /** 허용·거부 보내기. 위험 명령 허용은 첫 누름 = 확인 대기(8초), 두 번째 누름에 confirm:true */
  async _perm(id, decision) {
    const v = this.pend.get(id); const sid = this.sid;
    if (!v || !sid) return;
    const st = (this.permSt.get(id) || {}).state;
    if (st === 'sending' || st === 'answered') return;
    if (decision === 'allow' && allowStep(v, this.permArm.get(id) ?? null) === 'arm') {
      this.permArm.set(id, Date.now()); this._renderFeed();
      setTimeout(() => { const a = this.permArm.get(id); if (a != null && Date.now() - a > ARM_MS) { this.permArm.delete(id); this._renderFeed(); } }, ARM_MS + 100);
      return;
    }
    const danger = v.kind === 'perm' && Array.isArray(v.danger) && v.danger.length > 0;
    this.permArm.delete(id);
    this.permSt.set(id, { state: 'sending', decision }); this._renderFeed();
    let r;
    try {
      const { status, j } = await this._post('perm', { session: sid, toolUseId: id, decision, kind: v.kind, message: decision === 'deny' ? (this.permMsg.get(id) || '').trim() : '', ...(decision === 'allow' && danger ? { confirm: true } : {}) });
      if (status === 200 && j.ok) r = { state: 'answered', decision };
      else { r = { state: 'failed', decision, why: WHY.has(j.error) ? j.error : 'other' }; if (status === 403) this._deny(j); }
    } catch { r = { state: 'failed', decision, why: 'other' }; }
    if (sid !== this.sid) return;
    this.permSt.set(id, r);
    if (r.state === 'answered') {
      if (v.kind === 'perm') { this.permDone.set(id, v); if (this.permDone.size > 3) this.permDone.delete(this.permDone.keys().next().value); }
      this.pend.delete(id); this._pendAt = 0;
    }
    this._renderFeed();
    this._tick();
  }

  /** '기타' 입력 뒤 단추 켜짐만 고침(다시 그리지 않음) */
  _syncAskButtons(cardEl, id) {
    const c = this._cards.get(id); if (!c) return;
    const busy = ['sending', 'answered'].includes((this.askSent.get(id) || {}).state);
    const { complete } = answerPicks(c, this.picks.get(id), this.others.get(id));
    const ab = cardEl.querySelector('.ask-answer'); if (ab) ab.disabled = !complete || busy;
    const sb = cardEl.querySelector('.ask-send'); if (sb) sb.disabled = busy || !answerText(c, this.picks.get(id), t, this.others.get(id));
  }

  /** 질문창에 답하기: 서버가 Remote Control 브리지로 control_response(allow + answers) → 터미널 창이 그 답으로 닫힘 */
  async _answer(id) {
    const c = this._cards.get(id); const sid = this.sid;
    if (!c || !sid) return;
    const st = (this.askSent.get(id) || {}).state;
    if (st === 'sending' || st === 'answered') return;
    const { picks, complete } = answerPicks(c, this.picks.get(id), this.others.get(id));
    if (!complete) return;
    this.askSent.set(id, { state: 'sending' }); this._renderFeed();
    let r;
    try {
      const { status, j } = await this._post('ask', { session: sid, toolUseId: id, picks });
      if (status === 200 && j.ok) r = { state: 'answered' };
      else { r = { state: 'failed', why: WHY.has(j.error) ? j.error : 'other' }; if (status === 403) this._deny(j); }
    } catch { r = { state: 'failed', why: 'other' }; }
    if (sid !== this.sid) return;
    this.askSent.set(id, r);
    this._renderFeed();
    this._tick();
  }

  /** 확인 단계가 살아 있나(같은 세션, 10초 안) */
  _armed(sid) { const c = this._confirm; return !!(c && c.sid === sid && Date.now() < c.until); }
  _arm(sid, text, why) {
    this._confirm = { sid, text, why, until: Date.now() + CONFIRM_MS };
    clearTimeout(this._confirmT); this._confirmT = setTimeout(() => this._render(), CONFIRM_MS + 50);
    this._render();
  }

  async _send(override = null) {
    const text = (override ?? this.ta.value).trim();
    if (!text || this.ta.disabled || !this.sid) return;
    const sid = this.sid;
    // -p 여부를 확인하지 못한 세션은 한 번 더 눌러야 보낸다(첫 누름 = 확인 단계, 글은 그대로 둠)
    const target = this.sessions.find((s) => s.sessionId === sid);
    // 줄 첫 글자가 '/'(슬래시 명령)이면 이 통로로는 실행되지 않고 글자로만 간다 — 기본은 보내지 않고 '그래도 글로 보내기'를 한 번 더
    const why = needConfirm(text, target);
    if (why.length && !this._armed(sid)) { this._arm(sid, text, why); return 'armed'; }
    const confirm = !!(target && target.unverified);
    this._confirm = null;
    const lid = b64u(crypto.getRandomValues(new Uint8Array(9)));
    this.local.push({ lid, at: Date.now(), text, state: 'sending', msgId: null });
    if (override == null) this.ta.value = '';
    this._renderFeed();
    this.feed.scrollTop = this.feed.scrollHeight;
    let patch;
    try {
      const { status, j } = await this._post('send', confirm ? { session: sid, text, confirm: true } : { session: sid, text });
      if (status === 409 && j.error === 'unverified') { // 목록이 늦었음(그 사이 '확인 안 됨'이 됨): 이 글은 빼고 확인 단계로
        this.local = this.local.filter((x) => x.lid !== lid);
        if (override == null && !this.ta.value) this.ta.value = text;
        const tg = this.sessions.find((s) => s.sessionId === sid); if (tg) tg.unverified = true;
        if (sid === this.sid) this._arm(sid, text, needConfirm(text, tg || { unverified: true }));
        return 'armed';
      }
      if (status === 200 && j.ok) { patch = { msgId: j.msgId, state: 'sent', at: Date.now() }; if (j.holdLikely != null) this.holdLikely = !!j.holdLikely; }
      else { patch = { state: 'failed', why: WHY.has(j.error) ? j.error : 'other' }; if (status === 403) this._deny(j); }
    } catch { patch = { state: 'failed', why: 'other' }; }
    if (sid !== this.sid) return patch; // 그 사이 세션을 바꿈(감사 기록·대상 세션 transcript 에는 남는다)
    const i = this.local.findIndex((x) => x.lid === lid);
    if (i >= 0) this.local[i] = { ...this.local[i], ...patch };
    this._render();
    this._tick();
    return patch;
  }
}

/** ·143.3 보내기 전 한 번 더 확인할 이유: 'slash'(줄 첫 글자) · 'unverified'(-p 확인 안 됨) */
const needConfirm = (text, target) => [...(isSlashCommand(text) ? ['slash'] : []), ...(target && target.unverified ? ['unverified'] : [])];

const WHY = new Set(['headless', 'unverified', 'gone', 'busy', 'no_key', 'protocol', 'no_session', 'timeout', 'rate', 'too_long', 'io', 'pending', 'revoked', 'disabled',
  'no_rc', 'no_auth', 'auth', 'not_pending', 'incomplete', 'bad_pick', 'stream', 'network', 'post', // 질문창 답 실패 이유
  'confirm', 'kind', 'upstream_rate']);
const PERM_POLL_MS = 10_000; // 열린 계획·권한 창 다시 읽기 간격

function boot() {
  if (!document.getElementById('panel') || !document.getElementById('stream')) return;
  window.__ccvizInteract = new Interact();
  try { window.__ccvizWaits = mountWaits(window.__ccvizInteract); } catch (e) { console.error('[wait]', e); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
