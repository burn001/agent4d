// 사용자 콘솔(나 · 사용자) — 순수 부분. three·DOM 없음, 시험은 web/test/user-console.test.mjs.
// 서버 사용자 범주(ev.ix.cat === 'user')를 메인 노드별로 모아 둔 장부(UserBook)와,
// 그 장부로 만드는 ① 콘솔 화면 문구(평소에도 비어 보이지 않게: 마지막 입력 첫 몇 단어 + 상태·시간)
// ② 상세 카드 모델(최근 메시지·질문 대기·마지막 답변). 흐름·Planet·복셀 × 3D·2D 가 같은 장부·같은 문구를 쓴다.
// 시각은 이벤트 ts(epoch ms, 재생이면 기록 시각) — 지금은 화면 시계(재생 = 가상 시계)로 잰다.
// 글은 서버가 redact·40자로 자른 ix.text 만 쓴다. privacy:'minimal' 이면 서버가 글을 빼므로 여기서도 상태·시간만.
import { t as tr } from './i18n.mjs';

export const USERC = {
  MSGS: 5,          // 카드에 보일 최근 메시지
  SCREEN_CHARS: 22, // 콘솔 화면 첫 줄 글자 수
  ALERT_MS: 4000,   // 거부·인터럽트 표시
  MAX: 200,         // 장부가 기억하는 메인 수
};
const tsOf = (x) => { if (typeof x === 'number') return x; const t = Date.parse(x || ''); return Number.isFinite(t) ? t : 0; };
const txt = (s) => (typeof s === 'string' && s.trim() ? s.replace(/\s+/g, ' ').trim() : null);
const MSG_OPS = new Set(['prompt', 'command', 'midturn', 'interrupt', 'deny']);

/** 빈 항목 */
function blank(id) {
  return { id, msgs: [], ask: null, lastAsk: null, promptAt: null, replyAt: null, replyText: null, turnMs: null, lastUserAt: null, failAt: null, failOp: null, autoAt: null, n: 0 };
}

/** 메인 노드별 사용자 ↔ 메인 기록. app.onEvent 가 모든 이벤트를 넣고(라이브·재생·보관함 같은 길), 스냅샷이면 reset(recent) */
export class UserBook {
  constructor() { this.m = new Map(); this.ver = 0; }
  reset(recent = []) { this.m.clear(); this.ver++; for (const ev of recent || []) this.event(ev); }
  get(id) { return (id != null && this.m.get(id)) || null; }
  has(id) { return this.m.has(id); }
  _e(id) {
    let e = this.m.get(id);
    if (!e) {
      e = blank(id); this.m.set(id, e);
      if (this.m.size > USERC.MAX) this.m.delete(this.m.keys().next().value);
    }
    return e;
  }
  /** 이벤트 하나 → 바뀐 메인 id | null. fallbackNow = ts 가 없을 때 시각 */
  event(ev, fallbackNow = 0) {
    if (!ev || !ev.type) return null;
    if (ev.type === 'node-remove' && ev.nodeId) { if (this.m.delete(ev.nodeId)) { this.ver++; return ev.nodeId; } return null; }
    const ix = ev.ix;
    const at = tsOf(ev.ts) || fallbackNow || 0;
    if (!ix || ix.cat !== 'user') {
      // 서버 user 범주가 없는 연결(옛 서버): 사람 입력의 시각만(글은 쓰지 않음)
      if (ev.type === 'user' && ev.origin === 'human' && ev.nodeId && !ix) {
        const e = this._e(ev.nodeId); e.ixLess = true;
        e.msgs.push({ op: 'prompt', text: null, at }); if (e.msgs.length > USERC.MSGS * 2) e.msgs.shift();
        e.promptAt = at; e.lastUserAt = at; e.n++; this.ver++;
        return ev.nodeId;
      }
      return null;
    }
    const id = ev.nodeId;
    if (!id) return null;
    const e = this._e(id);
    const op = String(ix.op || '');
    if (MSG_OPS.has(op)) {
      const m = { op, text: txt(ix.text), at };
      if (ix.cmd) m.cmd = String(ix.cmd).slice(0, 24);
      if (ix.images) m.images = ix.images | 0;
      if (op === 'deny' && ix.tool) m.tool = String(ix.tool).slice(0, 32);
      e.msgs.push(m); if (e.msgs.length > USERC.MSGS * 2) e.msgs.shift();
      e.n++;
      if (op === 'interrupt' || op === 'deny') { e.failAt = at; e.failOp = op; if (op === 'interrupt') e.replyAt = Math.max(e.replyAt || 0, at); }
      else { e.promptAt = at; e.lastUserAt = at; }
    } else if (op === 'ask') {
      if (ev.type === 'tool-end' || ix.phase === 'end') {
        e.lastAsk = { text: (e.ask && e.ask.text) || txt(ix.text), pick: Number.isFinite(ix.pick) ? ix.pick : null, answer: txt(ix.answer), declined: !!ix.declined || ix.ok === false, opts: ix.opts | 0, at };
        e.ask = null; e.lastUserAt = at;
      } else e.ask = { text: txt(ix.text), opts: ix.opts | 0, multi: !!ix.multi, q: ix.q | 0, at };
    } else if (op === 'reply') {
      e.replyAt = at; e.replyText = txt(ix.text); e.turnMs = Number.isFinite(ix.turnMs) ? ix.turnMs : null;
    } else if (op === 'auto') { e.autoAt = at; this.ver++; return id; }
    else return null;
    this.ver++;
    return id;
  }
}

/** 상태: 'asking'(질문 대기 — 사람 차례) · 'alert'(방금 거부·중단) · 'working'(입력을 받아 작업 중) · 'answered'(답함 — 사람 차례) · 'idle'(기록 없음) */
export function userState(e, nowMs) {
  if (!e) return 'idle';
  if (e.ask) return 'asking';
  if (e.failAt != null && nowMs - e.failAt < USERC.ALERT_MS && e.failAt >= (e.promptAt || 0)) return 'alert';
  if (e.promptAt != null && (e.replyAt == null || e.promptAt > e.replyAt)) return 'working';
  if (e.replyAt != null || e.promptAt != null) return 'answered';
  return 'idle';
}

/** 길이 '12s'·'5m'·'3h'·'2d'(짧게) */
export function agoShort(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60000) return tr('cards.t.s', { n: Math.floor(ms / 1000) });
  if (ms < 3600e3) return tr('cards.t.m', { n: Math.floor(ms / 60000) });
  if (ms < 86400e3) return tr('cards.t.h', { n: Math.floor(ms / 3600e3) });
  return tr('cards.t.d', { n: Math.floor(ms / 86400e3) });
}
/** '방금'·'12초 전'·'5분 전' */
export function agoLong(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 5000) return tr('cards.ago.now');
  if (ms < 60000) return tr('cards.ago.s', { n: Math.floor(ms / 1000) });
  if (ms < 3600e3) return tr('cards.ago.m', { n: Math.floor(ms / 60000) });
  if (ms < 86400e3) return tr('cards.ago.h', { n: Math.floor(ms / 3600e3) });
  return tr('cards.ago.d', { n: Math.floor(ms / 86400e3) });
}
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** 마지막 사람 입력(프롬프트·명령·끼어듦) */
export function lastInput(e) {
  if (!e) return null;
  for (let i = e.msgs.length - 1; i >= 0; i--) { const m = e.msgs[i]; if (m.op === 'prompt' || m.op === 'command' || m.op === 'midturn') return m; }
  return null;
}
/** 메시지 한 줄 글(명령은 '/x 인자', 글이 없으면 null) */
export function msgText(m) {
  if (!m) return null;
  if (m.op === 'command') return [m.cmd || '/', m.text].filter(Boolean).join(' ');
  if (m.op === 'interrupt') return tr('cards.user.op.interrupt');
  if (m.op === 'deny') return tr('cards.user.op.deny') + (m.tool ? ` · ${m.tool}` : '');
  return m.text;
}

/**
 * 콘솔 화면 문구 {state, text, status, line}: text = 마지막 입력 첫 몇 단어(질문 중이면 질문, 글이 없으면 null),
 * status = 상태 · 시간(예 '답함 · 5분', '작업 중 · 12초', '질문 대기 · 선택지 3'), line = 툴팁·접근성용 한 줄.
 * 기록이 없으면 '아직 메시지 없음'.
 */
export function consoleLines(e, nowMs) {
  const st = userState(e, nowMs);
  const dur = (t) => (t != null ? agoShort(Math.max(0, nowMs - t)) : '');
  const ago = (t) => (t != null ? agoLong(Math.max(0, nowMs - t)) : '');
  let text = null, status;
  if (st === 'idle') status = tr('cards.user.scr.none');
  else if (st === 'asking') { text = e.ask.text; status = e.ask.opts ? tr('cards.user.scr.askN', { n: e.ask.opts }) : tr('cards.user.scr.ask'); }
  else if (st === 'alert') { status = tr(e.failOp === 'deny' ? 'cards.user.scr.deny' : 'cards.user.scr.interrupt'); text = msgText(lastInput(e)); }
  else if (st === 'working') { text = msgText(lastInput(e)); status = tr('cards.user.scr.working', { t: dur(e.promptAt) }); }
  else { text = msgText(lastInput(e)); status = e.replyAt != null ? tr('cards.user.scr.answered', { t: ago(e.replyAt) }) : tr('cards.user.scr.sent', { t: ago(e.promptAt) }); }
  if (text) text = '› ' + clip(text, USERC.SCREEN_CHARS);
  return { state: st, text, status, line: text ? `${text} · ${status}` : status };
}

/** 상태 → 알약 {key(ins-pill st-*), label} */
export function userPill(st) {
  switch (st) {
    case 'asking': return { key: 'ask', label: tr('cards.user.st.asking') };
    case 'alert': return { key: 'error', label: tr('cards.user.st.alert') };
    case 'working': return { key: 'active', label: tr('cards.user.st.working') };
    case 'answered': return { key: 'idle', label: tr('cards.user.st.answered') };
    default: return { key: 'idle', label: tr('cards.user.st.idle') };
  }
}

/**
 * 상세 카드 모델. main = 메인 노드(없어도 됨).
 * {state, pill, since, ask:{text,opts,multi,ago}|null, lastAsk:{text,result,ago}|null, msgs:[{op,glyph,text,when,ago}], reply:{ago,when,turn,text}|null, empty}
 */
export function userCardModel(e, nowMs, fmtWhen = null) {
  const st = userState(e, nowMs);
  const ago = (t) => (t != null ? agoLong(Math.max(0, nowMs - t)) : '');
  const when = (t) => (t && fmtWhen ? fmtWhen(t) : '');
  const out = { state: st, pill: userPill(st), since: '', ask: null, lastAsk: null, msgs: [], reply: null, empty: !e || (!e.msgs.length && !e.ask && !e.lastAsk && e.replyAt == null) };
  if (!e) return out;
  const lastIn = lastInput(e);
  if (st === 'working' && e.promptAt != null) out.since = tr('cards.user.since.working', { t: agoShort(Math.max(0, nowMs - e.promptAt)) });
  else if (st === 'asking') out.since = tr('cards.user.since.asking', { t: agoShort(Math.max(0, nowMs - e.ask.at)) });
  else if (e.replyAt != null) out.since = tr('cards.user.since.answered', { t: ago(e.replyAt) });
  else if (lastIn) out.since = tr('cards.user.since.sent', { t: ago(lastIn.at) });
  if (e.ask) out.ask = { text: e.ask.text, opts: e.ask.opts, multi: e.ask.multi, ago: ago(e.ask.at) };
  if (e.lastAsk) {
    const a = e.lastAsk;
    const result = a.declined ? tr('cards.user.ask.declined') : a.answer ? tr('cards.user.ask.answer', { a: a.answer }) : a.pick != null ? tr('cards.user.ask.pick', { n: a.pick + 1 }) : tr('cards.user.ask.done');
    out.lastAsk = { text: a.text, result, ago: ago(a.at), declined: a.declined };
  }
  const GL = { prompt: '›', command: '/', midturn: '+', interrupt: '■', deny: '✕' };
  out.msgs = e.msgs.slice(-USERC.MSGS).reverse().map((m) => ({ op: m.op, glyph: GL[m.op] || '›', text: msgText(m), kind: tr('cards.user.op.' + m.op), when: when(m.at), ago: ago(m.at), images: m.images || 0 }));
  if (e.replyAt != null) out.reply = { ago: ago(e.replyAt), when: when(e.replyAt), turn: e.turnMs != null ? e.turnMs : null, text: e.replyText };
  return out;
}

/** 콘솔을 둘 메인인가: 메인 노드이고 끝나지 않음(라이브·재생 모두 처음부터 — 사용자 이벤트를 기다리지 않음) */
export function wantsConsole(n) {
  return !!n && n.kind === 'main' && n.status !== 'done' && n.status !== 'stopped' && n.status !== 'error';
}

/** 화면 사각형들(px) 중 점 (x, y) 을 덮는 것(나중 것이 위) → 그 항목 | null. pad = 넓힘 */
export function hitRect(list, x, y, pad = 4) {
  for (let i = list.length - 1; i >= 0; i--) { const h = list[i]; if (x >= h.x0 - pad && x <= h.x1 + pad && y >= h.y0 - pad && y <= h.y1 + pad) return h; }
  return null;
}

/** 공용 장부(app.js 가 채우고, 세 표현 × 3D·2D 가 읽음) */
export const userBook = new UserBook();
