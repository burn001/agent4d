// Interactive 대화 흐름: 세션 transcript → 그 세션의 **전체 사람 대화**(시간순) 항목.
// 출처(실측 Claude Code 2.1.318, 이 PC transcript):
//  · 사람이 친 프롬프트(터미널·Claude 앱 Remote Control 공통) — type:'user', origin.kind 'human', promptSource 'typed'|'queued'.
//      두 경로는 transcript 에서 **필드가 똑같다**(키 집합·값·래핑 모두) → 'human' 하나로 묶는다(터미널·원격 구분 불가).
//  · 턴 도중 끼어든 입력 — user 줄이 아니라 type:'attachment', attachment.type 'queued_command'(+ queue-operation remove absorbed_mid_turn).
//      origin.kind 로 사람(human)·다른 세션(peer)·작업 알림(task-notification)을 가른다 → mid:1
//  · 다른 세션·Interactive 가 보낸 교차 세션 메시지 — type:'user', isMeta:true, origin {kind:'peer', name, body, msg_id, from?}.
//      from-name 이 'Agent4D (<별칭>)' 이면 Interactive(src 'ix'), 그 밖은 다른 Claude 세션(src 'peer')
//  · 시스템 성격(사람 대화 아님) — 작업 끝·Monitor 알림(origin task-notification), 예약 작업(isMeta + turnOrigin 'scheduled'),
//      그 밖 isMeta 주입·system-reminder·로컬 명령 출력·압축 요약 → k:'sys'(화면은 접어 둠)
//  · 슬래시 명령(<command-name>)·! 셸 입력(<bash-input>)은 사람이 친 것 → user(cmd)
// 처음 열 때(after·before 없음)는 끝에서 거꾸로 훑어 사람 턴 FEED_TURNS 개(또는 FEED_SCAN_MAX 바이트)까지, before 로 더 이전을, after 로 이어 읽기.
import fs from 'node:fs';
import { redact } from './redact.mjs';
import { stripNotice } from './interact-peer.mjs';
import { CARD_TOOLS, cardOf, cardResult } from './ask-card.mjs';

export const FEED_TURNS = 50;               // 처음·'더 보기' 한 번에 채우는 사람 턴(user·peer 항목) 수
export const FEED_SCAN_MAX = 8 * 1024 * 1024; // 한 번에 거꾸로 훑는 상한
export const FEED_CHUNK = 256 * 1024;
export const FEED_STEP = 512 * 1024;        // 이어 읽기 한 번 상한
export const FEED_ITEMS_MAX = 1200;         // 한 응답 항목 상한(넘으면 앞쪽을 버리고 before 를 그 자리로)
export const ITEM_MAX = 6000;
export const SYS_MAX = 240;
export const FEED_TAIL = FEED_SCAN_MAX; // (옛 이름)

const cap = (s, n = ITEM_MAX) => { s = redact(String(s ?? '')); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
};
const stripReminders = (s) => String(s || '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
const stripTags = (s) => String(s || '').replace(/<\/?[a-zA-Z][\w-]{0,40}(?:\s[^>]{0,400})?>/g, ' ');
// 새 표시(ko·en) + 옛 표시 'Agent4D (<별칭>)' 계속 인식
const IX_NAME_RES = [/^사용자 \(Agent4D 화면 · (.{1,60})\)$/, /^User \(via Agent4D · (.{1,60})\)$/, /^Agent4D \((.{1,60})\)$/];
export const XMSG_BODY_RE = /<cross-session-message\b[^>]*>\n?([\s\S]*?)\n?<\/cross-session-message>/;
const LOCAL_RE = /^<(local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr|user-memory-input)\b/;
const INTERRUPT_RE = /^\s*\[Request interrupted by user/;
// 대화와 무관한 줄 — JSON 을 풀지 않고 건너뜀(api-request-shape 한 줄이 100KB 를 넘는다)
const SKIP_RE = /^\{"type":"(?:api-request(?:-blob|-shape)?|file-history-snapshot|mode|permission-mode|session-owner|atis-latch|bridge-session|last-prompt|ai-title|custom-title|agent-name|tools-used|summary|queue-operation|progress)"/;

/** 교차 세션 보낸 이 이름 → 출처 { src:'ix', alias } | { src:'peer', who } */
export function peerSource(name) {
  const n = typeof name === 'string' ? name.slice(0, 80) : '';
  let m = null;
  for (const re of IX_NAME_RES) { m = re.exec(n); if (m) break; }
  return m ? { src: 'ix', alias: m[1] } : { src: 'peer', who: n || null };
}

/** 사람이 친 글 한 건 → user 항목(명령·! 셸·중단·로컬 출력 판정) | sys | null */
function humanItem(raw, ts, { mid = false, src = 'human' } = {}) {
  const s = String(raw ?? '');
  const cmd = /<command-name>\s*\/?([\w:.-]{1,40})\s*<\/command-name>/.exec(s);
  if (cmd) {
    const args = (/<command-args>([\s\S]*?)<\/command-args>/.exec(s) || [])[1] || '';
    return { k: 'user', ts, src, cmd: '/' + cmd[1], text: cap(('/' + cmd[1] + ' ' + args).trim()), ...(mid ? { mid: 1 } : {}) };
  }
  const bash = /^\s*<bash-input>([\s\S]*?)<\/bash-input>/.exec(s);
  if (bash) return { k: 'user', ts, src, cmd: '!', text: cap('! ' + bash[1].trim()), ...(mid ? { mid: 1 } : {}) };
  const t = stripReminders(s);
  if (!t) return s.trim() ? sysItem('system', s, ts) : null;
  if (LOCAL_RE.test(t)) return sysItem('local', t, ts);
  if (INTERRUPT_RE.test(t)) return sysItem('interrupt', t, ts);
  if (/^\s*<task-notification>/.test(t)) return sysItem('notify', t, ts);
  if (/^\s*This session is being continued from a previous conversation/.test(t)) return sysItem('compact', t, ts);
  return { k: 'user', ts, src, text: cap(t), ...(mid ? { mid: 1 } : {}) };
}

/** 시스템 성격 항목(접어 둘 것): 짧은 한 줄 */
function sysItem(sys, raw, ts) {
  const s = String(raw || '');
  const sum = /<summary>([\s\S]*?)<\/summary>/.exec(s);
  const ev = /<event>([\s\S]*?)<\/event>/.exec(s);
  const body = oneLine(stripTags(sum ? sum[1] : ev ? ev[1] : s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, (m) => (s.trim() === m.trim() ? m : ''))));
  return { k: 'sys', ts, sys, text: cap(body, SYS_MAX) };
}

function peerItem(o, content, ts, { mid = false } = {}) {
  let body = typeof o.body === 'string' ? o.body : '';
  if (!body) { const m = XMSG_BODY_RE.exec(textOf(content)); body = m ? m[1] : stripTags(textOf(content)); }
  const ps = peerSource(o.name);
  if (ps.src === 'ix') body = stripNotice(body);
  return { k: 'peer', ts, msgId: typeof o.msg_id === 'string' ? o.msg_id : null, name: typeof o.name === 'string' ? cap(o.name, 80) : null,
    ...ps, text: cap(body), ...(mid ? { mid: 1 } : {}) };
}

// 질문·계획 카드: tool_use id → 카드(결과 줄이 다음 읽기에 와도 짝을 찾게, 서버 프로세스 동안만·상한)
const CARD_IDS = new Map();
const rememberCard = (id, card) => { CARD_IDS.set(id, card); if (CARD_IDS.size > 400) CARD_IDS.delete(CARD_IDS.keys().next().value); };
function cardResults(j, ts) {
  const c = j.message?.content;
  if (!Array.isArray(c)) return [];
  const out = [];
  const tur = j.toolUseResult && typeof j.toolUseResult === 'object' ? j.toolUseResult : null;
  for (const b of c) {
    if (!b || b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
    const body = typeof b.content === 'string' ? b.content : textOf(b.content);
    let card = CARD_IDS.get(b.tool_use_id) || null;
    if (!card && tur && Array.isArray(tur.questions) && tur.answers) card = cardOf('AskUserQuestion', { questions: tur.questions });
    if (!card && /^User has approved (?:your plan|exiting plan mode)/.test(body)) card = { t: 'plan', md: '' };
    if (!card) continue;
    const res = cardResult(card, { ok: !b.is_error, body, tur });
    if (res) out.push({ k: 'ask-res', ts, id: b.tool_use_id, card, res });
  }
  return out;
}

/** 사람 턴(대화 한 칸)으로 세는 줄인가 — 거꾸로 훑을 때 멈출 자리를 정한다(부작용 없음) */
export function isTurnRecord(j) {
  if (!j || j.isSidechain) return false;
  if (j.type === 'attachment') { const a = j.attachment; return !!(a && a.type === 'queued_command' && (a.origin?.kind === 'human' || a.origin?.kind === 'peer' || (!a.origin && a.commandMode === 'prompt'))); }
  if (j.type !== 'user') return false;
  const k = j.origin?.kind;
  if (k === 'human' || k === 'peer') return true;
  if (k || j.isMeta || j.isCompactSummary) return false;
  const c = j.message?.content;
  if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return false;
  const t = stripReminders(textOf(c));
  return !!t && !LOCAL_RE.test(t) && !/^\s*<task-notification>/.test(t);
}

/** transcript JSON 한 줄 → 항목 | 항목 배열 | null */
export function feedItem(j) {
  if (!j || j.isSidechain) return null;
  const ts = j.timestamp ? Date.parse(j.timestamp) || null : null;
  if (j.type === 'queue-operation') { // 대기열 도착(교차 세션 메시지만)
    if (j.operation !== 'enqueue' || typeof j.content !== 'string') return null;
    const fn = /<cross-session-message\b[^>]*\bfrom-name="([^"]{1,80})"/.exec(j.content);
    const m = XMSG_BODY_RE.exec(j.content);
    if (!fn || !m) return null;
    const ps = peerSource(fn[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    return { k: 'enq', ts, ...ps, text: cap(ps.src === 'ix' ? stripNotice(m[1]) : m[1]) };
  }
  if (j.type === 'attachment') {
    const a = j.attachment;
    if (!a || a.type !== 'queued_command' || typeof a.prompt !== 'string') return null;
    const k = a.origin?.kind;
    if (k === 'peer') return peerItem(a.origin, a.prompt, ts, { mid: true });
    if (k === 'task-notification' || /^\s*<task-notification>/.test(a.prompt)) return sysItem('notify', a.prompt, ts);
    if (k === 'human' || (!k && a.commandMode === 'prompt')) return humanItem(a.prompt, ts, { mid: true });
    return sysItem('system', a.prompt, ts);
  }
  if (j.type === 'user') {
    const c = j.message?.content;
    if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) {
      const r = cardResults(j, ts);
      // 옛 판: 턴 도중 입력이 도구 결과와 같은 레코드의 text 블록으로 실림
      const t = textOf(c);
      const h = t.trim() ? humanItem(t, ts, { mid: true }) : null;
      const out = [...r, ...(h && h.k === 'user' ? [h] : [])];
      return out.length ? out : null;
    }
    const o = j.origin;
    if (o && o.kind === 'peer') return peerItem(o, c, ts);
    if (o && o.kind === 'task-notification') return sysItem('notify', textOf(c), ts);
    if (j.isCompactSummary) return sysItem('compact', textOf(c), ts);
    if (j.isMeta) {
      if (j.turnOrigin === 'scheduled' || j.scheduledTaskId) return sysItem('schedule', textOf(c), ts);
      const t = textOf(c);
      return t.trim() ? sysItem('system', t, ts) : null;
    }
    if (o && o.kind && o.kind !== 'human') return sysItem('system', textOf(c), ts);
    const imgs = Array.isArray(c) ? c.filter((b) => b && b.type === 'image').length : 0;
    const t = textOf(c) + (imgs ? `${textOf(c) ? '\n' : ''}[image ×${imgs}]` : '');
    if (!t.trim()) return null;
    return humanItem(t, ts, { src: !o && j.promptSource === 'sdk' ? 'sdk' : 'human' });
  }
  if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
    const content = j.message.content;
    const cards = [];
    for (const b of content) {
      if (!b || b.type !== 'tool_use' || !CARD_TOOLS.has(b.name)) continue;
      const card = cardOf(b.name, b.input);
      if (!card) continue;
      if (typeof b.id === 'string') rememberCard(b.id, card);
      cards.push({ k: 'ask', ts, id: typeof b.id === 'string' ? b.id : null, card });
    }
    const t = textOf(content);
    const tools = content.filter((b) => b && b.type === 'tool_use' && typeof b.name === 'string' && !CARD_TOOLS.has(b.name)).map((b) => b.name.slice(0, 40));
    const full = t.trim() ? redact(t) : ''; // 잘렸으면 cut:1 — 화면이 '전체 보기'(interact/full, 이 줄의 o)를 붙인다
    const out = [...(t.trim() ? [{ k: 'assistant', ts, text: cap(t), ...(full.length > ITEM_MAX ? { cut: 1 } : {}) }] : []), ...(tools.length ? [{ k: 'tool', ts, tools }] : []), ...cards];
    return out.length ? (out.length === 1 ? out[0] : out) : null;
  }
  return null;
}

/** minimal 프라이버시: 글·이름은 빼고 모양(출처·시각)만(실황 패널과 같은 규칙 — 카드는 만들지 않음) */
export function minimalItem(it) {
  if (!it) return null;
  if (it.k === 'ask' || it.k === 'ask-res') return null;
  if (it.k === 'tool') return it;
  const out = { ...it, text: '', hid: 1 };
  if (out.src === 'peer') out.who = null;
  if (out.k === 'peer' && out.src !== 'ix') out.name = null;
  return out;
}

// 교차 세션 메시지가 수신 쪽 대기열에 들어간 줄(queue-operation enqueue) — 메시지가 실제로 파이프를 지나 도착했다는 첫 흔적.
//  선택 창이 열려 있거나 턴 도중이면 여기서 기다렸다가(대기열) 창이 닫히거나 턴이 끝난 뒤 user·attachment 줄로 전달된다. msg_id 는 없고 content 에 래핑째 글이 있다
const ENQ_RE = /^\{"type":"queue-operation","operation":"enqueue"/;
const parseLine = (s) => { if (!s || (SKIP_RE.test(s) && !(ENQ_RE.test(s) && s.includes('cross-session-message')))) return null; try { return JSON.parse(s); } catch { return null; } };
function pushItems(items, j, off, privacy) {
  let it = feedItem(j);
  if (!it) return;
  for (let x of Array.isArray(it) ? it : [it]) {
    if (privacy === 'minimal') x = minimalItem(x);
    if (x) items.push({ ...x, o: off });
  }
}

/** end(줄 경계) 앞에서 거꾸로 사람 턴 turns 개까지 → { recs:[{off, j}](시간순), start } */
function scanBack(fd, end, { turns = FEED_TURNS, maxBytes = FEED_SCAN_MAX } = {}) {
  const recs = [];
  let pos = end, carry = Buffer.alloc(0), scanned = 0, n = 0, start = end;
  while (pos > 0 && n < turns && scanned < maxBytes) {
    const len = Math.min(FEED_CHUNK, pos);
    pos -= len; scanned += len;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, pos);
    const data = carry.length ? Buffer.concat([buf, carry]) : buf;
    let first = 0;
    if (pos > 0) { const nl = data.indexOf(10); if (nl < 0) { carry = data; continue; } first = nl + 1; }
    carry = data.subarray(0, first);
    // 온전한 줄들(first ～ 끝) — 끝에서부터
    let e = data.length;
    while (e > first && n < turns) {
      let b = data.lastIndexOf(10, e - 2);
      b = b < first - 1 ? first - 1 : b;
      const ls = b + 1;
      const s = data.subarray(ls, e).toString('utf8').replace(/\r?\n$/, '');
      const j = parseLine(s);
      if (j) { recs.push({ off: pos + ls, j }); if (isTurnRecord(j)) n++; }
      start = pos + ls;
      e = ls;
    }
  }
  return { recs: recs.reverse(), start };
}

/**
 * transcript → 대화 항목.
 *  · after(바이트) — 그 자리부터 앞으로 FEED_STEP 까지(끝나지 않은 마지막 줄은 다음 번)
 *  · before(바이트) — 그 자리 앞에서 거꾸로 사람 턴 turns 개 → { items, before }(0 = 처음까지 읽음)
 *  · 둘 다 없으면 끝에서 거꾸로 turns 개 + next(이어 읽을 자리)
 * @returns {{items, next, before, size, mode, missing?}}
 */
export function readFeed(file, { after = null, before = null, turns = FEED_TURNS, privacy = 'summary', limit = FEED_ITEMS_MAX } = {}) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return { items: [], next: 0, before: 0, size: 0, mode: null, missing: true }; }
  try {
    const size = fs.fstatSync(fd).size;
    const okAfter = Number.isFinite(after) && after >= 0 && after <= size;
    const okBefore = !okAfter && Number.isFinite(before) && before >= 0 && before <= size;
    const items = [];
    let mode = null;
    if (okAfter) {
      const len = Math.min(size - after, FEED_STEP);
      const buf = Buffer.alloc(len);
      if (len > 0) fs.readSync(fd, buf, 0, len, after);
      const lastNl = buf.lastIndexOf(10);
      const end = lastNl < 0 ? 0 : lastNl + 1;
      let p = 0;
      while (p < end) {
        const nl = buf.indexOf(10, p);
        const s = buf.subarray(p, nl).toString('utf8').replace(/\r$/, '');
        const j = parseLine(s);
        if (j) { if (j.type === 'user' && typeof j.permissionMode === 'string') mode = j.permissionMode; pushItems(items, j, after + p, privacy); }
        p = nl + 1;
      }
      const out = items.length > limit ? items.slice(-limit) : items;
      return { items: out, next: after + end, size, mode };
    }
    // 거꾸로: 끝(또는 before)을 줄 경계에 맞춤
    let end = okBefore ? before : size;
    if (!okBefore && size > 0) { // 끝나지 않은 마지막 줄은 빼고(다음 이어 읽기에서)
      const tail = Math.min(size, 64 * 1024), b = Buffer.alloc(tail);
      fs.readSync(fd, b, 0, tail, size - tail);
      const nl = b.lastIndexOf(10);
      end = nl < 0 ? (tail === size ? 0 : size) : size - tail + nl + 1;
    }
    const { recs, start } = scanBack(fd, end, { turns });
    for (const { off, j } of recs) { if (j.type === 'user' && typeof j.permissionMode === 'string') mode = j.permissionMode; pushItems(items, j, off, privacy); }
    let from = start, out = items;
    if (items.length > limit) { out = items.slice(-limit); from = out[0].o; }
    return { items: out, before: from, ...(okBefore ? {} : { next: end }), size, mode };
  } finally { fs.closeSync(fd); }
}
