// Interactive 대화 줄 그리기 — 순수(DOM 없음). interact.js 가 innerHTML 로 넣는다.
// 규칙: 모든 글자는 escapeHtml. Claude 응답만 Markdown(렌더러 — 허용 태그만), 사람·다른 세션 글은 원문 그대로(줄바꿈은 CSS pre-wrap).
import { escapeHtml } from './html-util.mjs';
import { renderMarkdown } from './markdown.mjs';
import { renderCard, answerPicks } from './ask-card.mjs';
import { renderPermCard } from './perm-card.mjs';

export const SYS_KINDS = new Set(['notify', 'schedule', 'system', 'local', 'interrupt', 'compact']);
const ST = new Set(['sending', 'sent', 'sentAsk', 'queued', 'queuedAsk', 'waiting', 'held', 'delivered', 'replied', 'unconfirmed', 'failed']); // sentAsk·queued·queuedAsk
const K = new Set(['user', 'peer', 'mine', 'assistant']);

/** '이전 대화 더 보기' 단추(before > 0 일 때만) */
export const moreHtml = (before, busy, t) => (before > 0 ? `<button type="button" class="ix-more"${busy ? ' disabled' : ''}>${escapeHtml(t(busy ? 'ix.more.loading' : 'ix.more'))}</button>` : '');

/** 줄의 보낸 이·출처 꼬리표(글자) */
export function whoOf(r, t, mineAlias = '') {
  const human = r.k === 'user' || (r.k === 'peer' && r.src === 'ix');
  const who = r.k === 'mine' ? t('ix.who.me') : human ? t('ix.who.user') : r.k === 'assistant' ? t('ix.who.claude') : t('ix.who.peer');
  const src = r.k === 'mine' ? t('ix.src.ix', { alias: mineAlias || '?' }) : r.k === 'user' ? t(r.src === 'sdk' ? 'ix.src.sdk' : 'ix.src.human')
    : r.k === 'peer' ? (r.src === 'ix' ? t('ix.src.ix', { alias: r.alias || '?' }) : t('ix.src.peer', { name: r.who || r.name || '?' })) : '';
  return { human, who, src };
}

/**
 * 줄 하나 → HTML. ctx = { t, mineAlias, openSys:Set, picks:Map, canSend:boolean, cards:Map(카드 기억, 채움) }
 */
export function rowHtml(r, ctx) {
  const { t } = ctx;
  if (r.k === 'sys') { // 시스템 알림(작업 끝·Monitor·예약·주입) — 기본 접힘 '⚙ 시스템 알림 n건'
    const li = r.items.map((x) => `<li><span class="ix-src">${escapeHtml(t('ix.sys.' + (SYS_KINDS.has(x.sys) ? x.sys : 'system')))}</span>${x.hid ? '' : escapeHtml(x.text || '')}</li>`).join('');
    return `<details class="ix-sys" data-g="${escapeHtml(r.key)}"${ctx.openSys && ctx.openSys.has(r.key) ? ' open' : ''}><summary>${escapeHtml(t('ix.sys', { n: r.items.length }))}</summary><ul>${li}</ul></details>`;
  }
  if (r.k === 'ask') { // 대기 중이고 보낼 수 있으면 선택지가 단추(고른 것을 일반 메시지로), 답이 오면 결과 표시
    if (r.id && ctx.cards) ctx.cards.set(r.id, r.card);
    // 열린 계획 승인 창(브리지에서 읽음)이면 승인·거부 단추가 있는 카드로 — 결과가 transcript 에 오면 평소 카드
    const pv = r.id && !r.res && r.card && r.card.t === 'plan' && ctx.pend ? ctx.pend.get(r.id) : null;
    if (pv && pv.kind === 'plan') {
      if (ctx.shown) ctx.shown.add(r.id);
      return `<div class="ix-row k-ask">${renderPermCard(pv, { st: ctx.permSt ? ctx.permSt.get(r.id) : null, canSend: !!ctx.canSend, link: ctx.link || null, t: ctx.t, fallbackMd: r.card.md })}</div>`;
    }
    // rc = 그 세션이 Remote Control 로 붙어 있음(질문창에 바로 답하기) · link = 「Claude 앱에서 답하기」 · complete = 모든 질문에 답이 있음
    const pick = r.id && ctx.picks ? ctx.picks.get(r.id) : null;
    const others = r.id && ctx.others ? ctx.others.get(r.id) : null;
    const rc = !!ctx.rc && r.card && r.card.t === 'ask';
    return `<div class="ix-row k-ask">${renderCard(r.card, r.res, { id: r.id, pick, canSend: !!ctx.canSend && !r.res && !!r.id, sent: r.id && ctx.asked ? ctx.asked.get(r.id) : null, t: ctx.t,
      rc, link: ctx.link || null, complete: rc ? answerPicks(r.card, pick, others).complete : undefined, typed: !!(others && [...others.values()].some((x) => x && x.trim())) })}</div>`;
  }
  if (r.k === 'tool') return `<div class="ix-row k-tool">${escapeHtml(t('ix.tools', { list: r.tools.slice(0, 6).join(', ') + (r.tools.length > 6 ? '…' : '') }))}</div>`;
  if (!K.has(r.k)) return '';
  const { human, who, src } = whoOf(r, t, ctx.mineAlias);
  const chips = (src ? `<span class="ix-src">${escapeHtml(src)}</span>` : '') + (r.mid ? `<span class="ix-src ix-mid">${escapeHtml(t('ix.mid'))}</span>` : '');
  const state = ST.has(r.state) ? r.state : 'sent';
  const st = r.k === 'mine' ? `<em class="ix-st s-${state}">${escapeHtml(state === 'failed' ? t('ix.st.failed', { why: t('ix.why.' + (r.why || 'other')) }) : t('ix.st.' + state))}</em>` : '';
  // Claude 응답만 Markdown. 사람·다른 세션 글은 원문 그대로(이스케이프·줄바꿈 유지), minimal 이면 본문 없이
  const body = r.hid ? `<p class="ix-hid">${escapeHtml(t('ix.hid'))}</p>` : r.k === 'assistant' ? assistantBody(r, ctx, t) : `<p class="ix-raw">${escapeHtml(r.text || '')}</p>`;
  return `<div class="ix-row k-${r.k}${human ? ' k-human' : ''}${r.k === 'peer' ? ' s-' + (r.src === 'ix' ? 'ix' : 'peer') : ''}"><b>${escapeHtml(who)}</b>${chips}${st}${body}</div>`;
}

/**
 * Claude 응답 본문: 잘린 응답(서버 cut:1)이면 끝에 '전체 보기'(이 줄의 바이트 위치 o 로 /interact/full). 받아 온 원문이 있으면(ctx.full: o → {md, cut} | 'loading' | 'fail') 그것을 그림.
 * 범위 id 는 같은 o(다시 그려도 같은 HTML)
 */
export function assistantBody(r, ctx = {}, t = (k) => k) {
  const scope = Number.isFinite(r.o) ? 'ix' + r.o : null;
  const f = r.cut && Number.isFinite(r.o) && ctx.full ? ctx.full.get(r.o) : null;
  if (f && typeof f === 'object' && typeof f.md === 'string') return `<div class="md md-full-on">${renderMarkdown(f.md, { scope })}${f.cut ? `<p class="md-cut">${escapeHtml(t('ix.full.cut'))}</p>` : ''}</div>`;
  const btn = r.cut && Number.isFinite(r.o)
    ? `<p class="md-cut"><button type="button" class="ix-full" data-o="${r.o}"${f === 'loading' ? ' disabled' : ''}>${escapeHtml(t(f === 'loading' ? 'ix.full.loading' : f === 'fail' ? 'ix.full.fail' : 'ix.full'))}</button></p>` : '';
  return `<div class="md">${renderMarkdown(r.text || '', { scope })}${btn}</div>`;
}
