// 선택형 질문(AskUserQuestion)·계획 승인(ExitPlanMode) 카드 HTML(순수, DOM 없음).
// 실황 패널(tool-start/end 의 card·cardRes)과 Interactive feed(k:'ask'·'ask-res')가 같이 쓴다. 서버가 만든 모양(server/ask-card.mjs)을 받아
// 모든 글자를 이스케이프하고(질문 문장은 인라인 Markdown, 미리보기는 코드 블록, 계획은 블록 Markdown — 렌더러 그대로) 고정 태그만 낸다.
import { escapeHtml as esc } from './html-util.mjs';
import { renderMarkdown, renderMarkdownInline } from './markdown.mjs';
import { t as tr } from './i18n.mjs';

/** '(추천)'·'(권장)'·'(Recommended)' 로 끝나는 라벨 */
export const isRec = (label) => /\((?:추천|권장|Recommended)\)\s*$/i.test(String(label || ''));
const ST_ICON = { pending: '⏳', planPending: '⏳', answered: '✓', other: '✓', approved: '✓', approvedEdited: '✓', instead: '↪', none: '—', more: '↻', declined: '✕', rejected: '✕' };

/** 상태 열쇠: 결과가 없으면 대기 */
export function cardState(card, res) {
  if (!card) return null;
  if (card.t === 'plan') return !res ? 'planPending' : res.st === 'approved' ? (res.edited ? 'approvedEdited' : 'approved') : 'rejected';
  return res ? (ST_ICON[res.st] ? res.st : 'answered') : 'pending';
}

/** 상태 표지 HTML */
export function badgeHtml(card, res, t = tr) {
  const st = cardState(card, res);
  return `<span class="ask-badge s-${esc(st)}">${ST_ICON[st] || ''} ${esc(t('ix.card.st.' + st))}</span>`;
}

/** 미리보기: 내용 속 backtick 보다 긴 펜스로 감싸 코드 블록(렌더러가 이스케이프) */
function previewHtml(p) {
  const s = String(p || '');
  const run = Math.max(0, ...[...s.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(Math.max(3, run + 1));
  return `<div class="md ask-prev">${renderMarkdown(`${f}\n${s}\n${f}`)}</div>`;
}

/**
 * 카드 HTML.
 * @param {object} card {t:'ask', qs} | {t:'plan', md, cut?}
 * @param {object|null} res 결과(없으면 대기)
 * @param {{id?:string, live?:boolean, pick?:Map<number, Set<number>>, canSend?:boolean, t?:Function}} o
 *   pick = Interactive 에서 고른 선택지(질문 번호 → 선택지 번호 집합), canSend = 대기 중이고 보낼 수 있음(선택지를 단추로)
 */
export function renderCard(card, res = null, o = {}) {
  if (!card || (card.t !== 'ask' && card.t !== 'plan')) return '';
  const t = o.t || tr;
  const st = cardState(card, res);
  const idAttr = o.id ? ` data-tu="${esc(o.id)}"` : '';
  const pending = st === 'pending' || st === 'planPending';
  // 대기 중이면 머리 바로 아래 눈에 띄게: 이 창은 그 세션 화면(터미널·Claude 앱 원격 세션)에서만 답할 수 있음 — 결과가 오면 실황은 ask-hint 를 지운다(panel.js)
  // Remote Control 로 붙은 세션(o.rc)이면 여기서 질문창에 바로 답할 수 있다 — 안내 문구가 달라진다
  const only = pending ? `<p class="ask-hint ask-only">${esc(t(o.rc && o.canSend && card.t === 'ask' ? 'ix.card.rcOnly' : 'ix.card.terminal'))}</p>` : '';
  if (card.t === 'plan') {
    const fb = res && res.fb ? `<div class="ask-ans"><b>${esc(t('ix.card.fb'))}</b> ${esc(res.fb)}</div>` : '';
    return `<div class="ask-card plan-card s-${st}"${idAttr}><div class="ask-head"><b class="ask-kind">${esc(t('ix.card.plan'))}</b>${badgeHtml(card, res, t)}</div>${only}`
      + (card.md ? `<div class="md plan-md">${renderMarkdown(card.md)}${card.cut ? `<p class="md-cut">${esc(t('ix.card.cut'))}</p>` : ''}</div>` : '')
      + fb + '</div>';
  }
  const ans = new Map((res && Array.isArray(res.a) ? res.a : []).map((a) => [a.q, a]));
  const btn = !!(o.canSend && pending);
  const qs = (card.qs || []).map((q, qi) => {
    const a = ans.get(qi);
    const mine = o.pick && o.pick.get(qi);
    const opts = (q.o || []).map((op, oj) => {
      const picked = a ? (a.pick || []).includes(oj) : !!(mine && mine.has(oj));
      const mark = q.multi ? (picked ? '☑' : '☐') : (picked ? '●' : '○');
      const cls = `ask-o${isRec(op.l) ? ' rec' : ''}${picked ? ' picked' : ''}`;
      const act = btn ? ` role="button" tabindex="0" aria-pressed="${picked}" data-q="${qi}" data-o="${oj}"` : '';
      return `<li class="${cls}"${act}><span class="ask-mark">${mark}</span><span class="ask-ol"><b>${esc(op.l)}</b>${isRec(op.l) ? `<em class="ask-rec">${esc(t('ix.card.rec'))}</em>` : ''}`
        + `${op.d ? `<small>${esc(op.d)}</small>` : ''}</span>${op.p ? previewHtml(op.p) : ''}</li>`;
    }).join('');
    const other = a && a.other ? `<div class="ask-ans"><b>${esc(t('ix.card.other'))}</b> ${esc(a.other)}</div>` : '';
    // '기타(직접 입력)' 칸 — 값은 HTML 에 넣지 않는다(화면이 다시 그린 뒤 채움: 입력 중 포커스·글이 날아가지 않게)
    const otherIn = btn ? `<label class="ask-otherw"><span>${esc(t('ix.card.otherIn'))}</span><input type="text" class="ask-other" data-q="${qi}" maxlength="2000" placeholder="${esc(t('ix.card.otherPh'))}"></label>` : '';
    const notes = a && a.notes ? `<div class="ask-ans"><b>${esc(t('ix.card.notes'))}</b> ${esc(a.notes)}</div>` : '';
    const inst = a && a.instead ? `<div class="ask-ans dim">${esc(t('ix.card.st.instead'))}</div>` : '';
    return `<div class="ask-q">${q.h || q.multi ? `<div class="ask-qh">${q.h ? `<span class="ask-h">${esc(q.h)}</span>` : ''}${q.multi ? `<span class="ask-multi">${esc(t('ix.card.multi'))}</span>` : ''}</div>` : ''}`
      + `<p class="ask-qt">${renderMarkdownInline(q.q || '')}</p><ol class="ask-opts">${opts}</ol>${otherIn}${other}${notes}${inst}</div>`;
  }).join('');
  const any = !!(o.pick && [...o.pick.values()].some((s) => s && s.size)) || !!o.typed;
  // 보냄 상태(누른 즉시): sending → sent(대기열) | failed(이유). 단추는 카드 바닥에 붙어(sticky) 스크롤해도 보임
  // rc(Remote Control 세션): 단추 = '질문창에 답하기'(sending → answered | failed) · 모든 질문에 답해야 누를 수 있음(o.complete)
  const sn = o.sent;
  const rc = !!o.rc;
  const sentLine = sn && btn
    ? `<p class="ask-sentst st-${esc(sn.state)}" role="status">${esc(sn.state === 'sending' ? t('ix.st.sending') : sn.state === 'failed' ? t('ix.st.failed', { why: t('ix.why.' + (sn.why || 'other')) }) : sn.state === 'answered' ? t('ix.st.answeredBox') : t('ix.st.sentAsk'))}</p>`
    : '';
  const busy = !!(sn && (sn.state === 'sending' || sn.state === 'answered'));
  const main = rc
    ? `<button type="button" class="ask-answer"${(o.complete ?? any) && !busy ? '' : ' disabled'}>${esc(t('ix.card.answer'))}</button>`
    : `<button type="button" class="ask-send"${any && !busy ? '' : ' disabled'}>${esc(t('ix.card.send'))}</button>`;
  // 「Claude 앱에서 답하기」 — 이 세션 Remote Control 링크(어느 경우든 통하는 공식 경로). 질문창 답이 실패해도 여기로
  const app = o.link && pending && /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+$/.test(o.link)
    ? `<a class="ask-app" href="${esc(o.link)}" target="_blank" rel="noopener noreferrer">${esc(t('ix.card.app'))}</a>` : '';
  const foot = btn
    ? `<div class="ask-ix"><p class="ask-hint">${esc(t(rc ? 'ix.card.rcNote' : 'ix.card.ixNote'))}</p>${sentLine}<div class="ask-btns">${main}${app}</div></div>`
    : app && card.t === 'ask' ? `<div class="ask-ix"><div class="ask-btns">${app}</div></div>` : '';
  return `<div class="ask-card s-${st}"${idAttr}><div class="ask-head"><b class="ask-kind">${esc(t('ix.card.ask'))}</b>${badgeHtml(card, res, t)}</div>${only}${qs}${foot}</div>`;
}

/** Interactive 에서 고른 선택지 → 일반 메시지 글(질문마다 한 줄: 머리표(없으면 질문 앞부분): 라벨, 라벨) */
export function answerText(card, pick, t = tr, others = null) {
  if (!card || card.t !== 'ask' || (!pick && !others)) return '';
  const lines = [];
  (card.qs || []).forEach((q, qi) => {
    const s = pick && pick.get(qi);
    const labels = (s ? [...s] : []).sort((a, b) => a - b).map((j) => q.o[j] && q.o[j].l).filter(Boolean);
    const typed = others && typeof others.get(qi) === 'string' ? others.get(qi).trim() : ''; // 기타(직접 입력)
    if (typed) labels.push(typed);
    if (!labels.length) return;
    const head = q.h || (q.q.length > 60 ? q.q.slice(0, 59) + '…' : q.q);
    lines.push(t('ix.card.msg', { q: head, a: labels.join(', ') }));
  });
  return lines.join('\n');
}

/** 선택지 누름 → 새 선택 상태(단일 선택은 하나만, 복수 선택은 토글) */
export function togglePick(card, pick, qi, oj) {
  const q = card && card.qs && card.qs[qi];
  if (!q || !q.o || !q.o[oj]) return pick;
  const next = new Map(pick || []);
  const cur = new Set(next.get(qi) || []);
  if (q.multi) { if (cur.has(oj)) cur.delete(oj); else cur.add(oj); }
  else if (cur.has(oj)) cur.clear(); else { cur.clear(); cur.add(oj); }
  next.set(qi, cur);
  return next;
}

/**
 * 질문창에 답하기 요청 본문의 picks — [{q, o:[…], other?}] (질문마다). 모든 질문에 고른 것이나 직접 입력이 있으면 complete
 * (서버가 브리지 요청의 원래 질문 문구·라벨로 answers 를 만든다 — 화면 카드 글은 잘렸을 수 있음)
 */
export function answerPicks(card, pick, others = null) {
  if (!card || card.t !== 'ask') return { picks: [], complete: false };
  const picks = []; let complete = (card.qs || []).length > 0;
  (card.qs || []).forEach((q, qi) => {
    const s = pick && pick.get(qi);
    const o = s ? [...s].filter((j) => q.o && q.o[j]).sort((a, b) => a - b) : [];
    const other = others && typeof others.get(qi) === 'string' ? others.get(qi).trim().slice(0, 2000) : '';
    if (!o.length && !other) { complete = false; return; }
    picks.push({ q: qi, o: q.multi ? o : o.slice(0, 1), ...(other ? { other } : {}) });
  });
  return { picks, complete };
}
