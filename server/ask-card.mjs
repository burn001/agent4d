// 선택형 질문·계획 승인 카드 — 순수 함수(파일·네트워크 없음). 라이브 이벤트(tool-start `card` · tool-end `cardRes`)와
// Interactive feed(`k: 'ask'` · `k: 'ask-res'`)가 같은 모양을 쓴다. 모든 글자는 redact + 길이 상한(웹은 이스케이프해서 그린다).
//  card = { t: 'ask', qs: [{ h, q, multi?, o: [{ l, d?, p? }] }] } | { t: 'plan', md, cut? }
//  res  = ask:  { st: 'answered'|'other'|'instead'|'none'|'more'|'declined', a: [{ q, pick: [옵션 번호], other?, notes?, instead? }] }
//         plan: { st: 'approved'|'rejected', edited?, fb? }
// 근거(Claude Code 2.1.318 설치본 코드·이 PC transcript): AskUserQuestion 결과 본문은 "Your questions have been answered: …"(모두 선택지)
// · "The user answered: …"(직접 입력 섞임) · "The user did not answer the questions." · "… again with follow-up questions …"(더 묻기),
// toolUseResult = { questions, answers: { 질문: 라벨 | "라벨, 라벨" | [라벨…] }, annotations?: { 질문: { notes?, preview? } } }.
// 거절은 is_error + "The user doesn't want to proceed with this tool use…". ExitPlanMode 승인은 "User has approved your plan…"
// (편집했으면 "## Approved Plan (edited by user)"), 거절은 is_error + "… To tell you how to proceed, the user said:\n<의견>".
import { redact } from './redact.mjs';

export const CARD_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
export const CARD_LIMITS = { qs: 4, opts: 8, h: 40, q: 600, l: 120, d: 400, p: 1500, other: 600, notes: 600, plan: 6000, fb: 1000 };
const L = CARD_LIMITS;
const DENY_RE = /The user doesn't want to proceed with this tool use|tool use was rejected|User rejected|user denied/i;

const cut = (s, n) => { s = redact(String(s ?? '')).replace(/\r\n?/g, '\n'); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const one = (s, n) => cut(String(s ?? '').replace(/\s+/g, ' ').trim(), n);

/** tool_use 입력 → 카드(없으면 null). minimal 이면 부르지 않는다 */
export function cardOf(name, input) {
  const x = input && typeof input === 'object' ? input : {};
  if (name === 'AskUserQuestion') {
    const qs = (Array.isArray(x.questions) ? x.questions : []).slice(0, L.qs).map((q) => {
      const o = (Array.isArray(q?.options) ? q.options : []).slice(0, L.opts).map((op) => {
        const lab = typeof op === 'string' ? op : op?.label;
        const r = { l: one(lab, L.l) };
        if (op && typeof op.description === 'string' && op.description.trim()) r.d = one(op.description, L.d);
        if (op && typeof op.preview === 'string' && op.preview.trim()) r.p = cut(op.preview, L.p);
        return r;
      }).filter((op) => op.l);
      const c = { h: one(q?.header, L.h), q: cut(String(q?.question ?? '').trim(), L.q), o };
      if (q?.multiSelect === true) c.multi = 1;
      return c;
    }).filter((q) => q.q || q.o.length);
    return qs.length ? { t: 'ask', qs } : null;
  }
  if (name === 'ExitPlanMode') {
    const md = typeof x.plan === 'string' ? redact(x.plan).replace(/\r\n?/g, '\n').trim() : '';
    if (!md) return { t: 'plan', md: '' };
    return md.length > L.plan ? { t: 'plan', md: md.slice(0, L.plan), cut: 1 } : { t: 'plan', md };
  }
  return null;
}

/** 본문 `"질문"="답", "질문"="답"` → {질문: 답} (toolUseResult 가 없는 옛 기록용) */
export function parseAnswerText(body) {
  const out = {};
  const re = /"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g;
  let m, n = 0;
  while ((m = re.exec(String(body || ''))) && n++ < 16) out[m[1]] = m[2];
  return out;
}

/** 답 하나(문자열·배열) → {pick, other}. 복수 선택 "라벨, 라벨" 은 모두 선택지 라벨일 때만 나눈다 */
function matchAnswer(val, opts, multi) {
  const labels = opts.map((o) => String(o.l || '').trim());
  const idx = (s) => labels.indexOf(String(s).trim());
  const parts = Array.isArray(val) ? val.map(String) : [String(val ?? '')];
  const pick = [], rest = [];
  for (const p of parts) {
    if (!p.trim() || p === '(no option selected)') continue;
    const i = idx(p);
    if (i >= 0) { if (!pick.includes(i)) pick.push(i); continue; }
    const sp = multi || parts.length === 1 ? p.split(', ') : [p];
    if (sp.length > 1 && sp.every((s) => idx(s) >= 0)) { for (const s of sp) { const k = idx(s); if (!pick.includes(k)) pick.push(k); } continue; }
    // 일부만 라벨인 "라벨, 직접 입력" — 맞는 것은 고름, 나머지는 직접 입력
    const hit = sp.filter((s) => idx(s) >= 0), miss = sp.filter((s) => idx(s) < 0);
    if (sp.length > 1 && hit.length) { for (const s of hit) { const k = idx(s); if (!pick.includes(k)) pick.push(k); } rest.push(miss.join(', ')); continue; }
    rest.push(p);
  }
  return { pick, other: rest.join(', ') };
}

/**
 * tool_result → 결과(카드가 없으면 null).
 * @param {object} card cardOf 결과 @param {{ok:boolean, body:string, tur?:object}} r
 */
export function cardResult(card, { ok = true, body = '', tur = null } = {}) {
  if (!card) return null;
  const text = String(body || '');
  if (card.t === 'plan') {
    if (!ok || DENY_RE.test(text.slice(0, 300))) {
      const m = /To tell you how to proceed, the user said:\s*([\s\S]*)$/.exec(text);
      const fb = m ? cut(m[1].trim(), L.fb) : '';
      return { st: 'rejected', ...(fb ? { fb } : {}) };
    }
    return { st: 'approved', ...(/Approved Plan \(edited by user\)/.test(text) ? { edited: 1 } : {}) };
  }
  if (card.t !== 'ask') return null;
  if (!ok && DENY_RE.test(text.slice(0, 300))) return { st: 'declined', a: [] };
  const answers = tur && typeof tur.answers === 'object' && tur.answers ? tur.answers : parseAnswerText(text);
  const ann = tur && typeof tur.annotations === 'object' && tur.annotations ? tur.annotations : {};
  const a = [];
  let anyOther = false, anyInstead = false;
  card.qs.forEach((q, qi) => {
    // 답 열쇠는 질문 원문(카드의 q 는 잘렸을 수 있어 앞부분으로도 찾음)
    const key = Object.keys(answers).find((k) => k === q.q || (q.q.endsWith('…') && k.startsWith(q.q.slice(0, -1))) || redact(k) === q.q);
    const val = key != null ? answers[key] : undefined;
    const nk = Object.keys(ann).find((k) => k === key || k === q.q);
    const notes = nk != null && ann[nk] && typeof ann[nk].notes === 'string' ? one(ann[nk].notes, L.notes) : '';
    if (val === undefined && !notes) return;
    const { pick, other } = val === undefined ? { pick: [], other: '' } : matchAnswer(val, q.o, !!q.multi);
    // 선택 창이 열린 동안 사람이 (원격 제어 등으로) 메시지를 보내 닫힌 경우의 자리 글 — 직접 입력이 아니라 '답 대신 메시지'
    if (/^\[User did not answer this question/.test(other)) { anyInstead = true; a.push({ q: qi, pick, instead: 1, ...(notes ? { notes } : {}) }); return; }
    if (other) anyOther = true;
    a.push({ q: qi, pick, ...(other ? { other: one(other, L.other) } : {}), ...(notes ? { notes } : {}) });
  });
  let st = a.length ? (anyOther ? 'other' : anyInstead && a.every((x) => x.instead) ? 'instead' : 'answered') : 'none';
  if (/again (?:now )?with (?:follow-up|further) questions/i.test(text)) st = 'more';
  else if (!a.length && !ok) st = 'declined';
  return { st, a };
}

/** 카드·결과 정리(이벤트로 내보내기 직전, graph.emit) — 모양이 아니면 null, minimal 이면 null */
export function sanitizeCard(c, privacy) {
  if (!c || typeof c !== 'object' || privacy === 'minimal') return null;
  if (c.t === 'plan') return { t: 'plan', md: typeof c.md === 'string' ? c.md.slice(0, L.plan) : '', ...(c.cut ? { cut: 1 } : {}) };
  if (c.t !== 'ask' || !Array.isArray(c.qs)) return null;
  return c;
}
export function sanitizeCardRes(r, privacy) {
  if (!r || typeof r !== 'object' || privacy === 'minimal') return null;
  return r;
}
