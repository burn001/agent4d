// 계획 승인(ExitPlanMode)·도구 권한 확인 창 카드 HTML(순수, DOM 없음) — Interactive 패널.
// 서버 /interact/pending 이 준 모양(server/rc-perm.mjs permView)을 받아 모든 글자를 이스케이프하고 고정 태그만 낸다.
//  view = { kind:'plan', toolUseId, tool, md, cut? } | { kind:'perm', toolUseId, tool, danger:[코드], cmd?, desc?, path?, preview?, size?, old?, all?, edits?, url?, json?, minimal? }
//  st   = 보낸 상태 { state:'sending'|'answered'|'failed', decision?, why? } | null
// '항상 허용'(규칙 저장)은 일부러 없다.
import { escapeHtml as esc } from './html-util.mjs';
import { renderMarkdown } from './markdown.mjs';
import { t as tr } from './i18n.mjs';

export const LINK_RE = /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+$/;
export const ARM_MS = 8000; // 위험 명령 허용 두 번째 누름을 기다리는 시간

const code = (s) => {
  const v = String(s || '');
  const run = Math.max(0, ...[...v.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(Math.max(3, run + 1));
  return `<div class="md perm-code">${renderMarkdown(`${f}\n${v}\n${f}`)}</div>`;
};

/** 위험 코드 → 경고 줄(없으면 '') */
export function dangerHtml(view, t = tr) {
  const d = Array.isArray(view && view.danger) ? view.danger : [];
  if (!d.length) return '';
  const list = d.map((c) => t('ix.perm.d.' + c)).join(', ');
  return `<p class="perm-danger" role="alert">⚠ ${esc(t('ix.perm.danger', { list }))}</p>`;
}

/** 입력 요약(명령·경로·미리보기) */
function bodyHtml(v, t) {
  if (v.minimal) return `<p class="perm-dim">${esc(t('ix.perm.hidden'))}</p>`;
  let h = '';
  if (v.cmd != null) h += code(v.cmd) + (v.desc ? `<p class="perm-desc">${esc(v.desc)}</p>` : '');
  if (v.path) h += `<p class="perm-path"><code>${esc(v.path)}</code>${v.size != null ? ` <small>${esc(t('ix.perm.size', { n: v.size }))}</small>` : ''}${v.edits != null ? ` <small>${esc(t('ix.perm.edits', { n: v.edits }))}</small>` : ''}</p>`;
  if (v.old != null) h += `<p class="perm-lbl">${esc(t('ix.perm.old'))}${v.all ? ' (all)' : ''}</p>${code(v.old)}<p class="perm-lbl">${esc(t('ix.perm.new'))}</p>`;
  if (v.preview != null) h += code(v.preview);
  if (v.url) h += `<p class="perm-path"><code>${esc(v.url)}</code></p>`;
  if (v.json) h += code(v.json);
  return h;
}

/** 보낸 상태 줄 */
function stLine(v, st, t) {
  if (!st) return '';
  if (st.state === 'sending') return `<p class="ask-sentst st-sending" role="status">${esc(t('ix.st.sending'))}</p>`;
  if (st.state === 'failed') return `<p class="ask-sentst st-failed" role="status">${esc(t('ix.st.failed', { why: t('ix.why.' + (st.why || 'other')) }))}</p>`;
  if (st.state === 'answered') {
    const k = v.kind === 'plan' ? (st.decision === 'allow' ? 'approved' : 'rejected') : (st.decision === 'allow' ? 'allowed' : 'denied');
    return `<p class="ask-sentst st-answered${st.decision === 'allow' ? '' : ' st-denied'}" role="status">${esc(t('ix.perm.st.' + k))}</p>`;
  }
  return '';
}

/**
 * 카드 HTML.
 * @param {object} view 서버 permView
 * @param {{st?:object, canSend?:boolean, armed?:boolean, link?:string, t?:Function, fallbackMd?:string}} o
 *   canSend = 승인된 기기·대기 중 · armed = 위험 명령 허용 첫 누름 뒤(두 번째를 기다림) · fallbackMd = transcript 카드 계획(브리지 본문이 비었을 때)
 */
export function renderPermCard(view, o = {}) {
  if (!view || (view.kind !== 'plan' && view.kind !== 'perm') || !view.toolUseId) return '';
  const t = o.t || tr;
  const st = o.st || null;
  const busy = !!(st && (st.state === 'sending' || st.state === 'answered'));
  const can = !!o.canSend && !busy;
  const link = o.link && LINK_RE.test(o.link) && !(st && st.state === 'answered') ? `<a class="ask-app" href="${esc(o.link)}" target="_blank" rel="noopener noreferrer">${esc(t('ix.card.app'))}</a>` : '';
  const id = ` data-pu="${esc(view.toolUseId)}" data-kind="${view.kind}"`;
  const dis = can ? '' : ' disabled';
  // 답이 들어갔으면(여기서) 머리 표지·안내를 결과로 — 대기 안내·앱 링크는 뺀다
  const ans = st && st.state === 'answered' ? (st.decision === 'allow' ? 'ok' : 'no') : null;
  const stKey = ans ? 'ix.perm.st.' + (view.kind === 'plan' ? (ans === 'ok' ? 'approved' : 'rejected') : (ans === 'ok' ? 'allowed' : 'denied')) : null;
  const badge = (pendKey, pendCls) => ans
    ? `<span class="ask-badge ${ans === 'ok' ? 's-answered' : 's-declined'}">${esc(t(stKey))}</span>`
    : `<span class="ask-badge ${pendCls}">⏳ ${esc(t(pendKey))}</span>`;
  const hint = (k) => (ans ? '' : `<p class="ask-hint ask-only">${esc(t(k))}</p>`);
  const cardCls = (pendCls) => (ans ? (ans === 'ok' ? 's-answered' : 's-declined') : pendCls);
  if (view.kind === 'plan') {
    const md = view.md || o.fallbackMd || '';
    const body = view.minimal ? `<p class="perm-dim">${esc(t('ix.perm.hidden'))}</p>`
      : md ? `<div class="md plan-md">${renderMarkdown(md)}${view.cut ? `<p class="md-cut">${esc(t('ix.card.cut'))}</p>` : ''}</div>` : '';
    const form = o.canSend && !busy
      ? `<label class="ask-otherw"><span>${esc(t('ix.perm.feedback'))}</span><textarea class="perm-msg" rows="2" maxlength="2000" placeholder="${esc(t('ix.perm.feedbackPh'))}"></textarea></label>` : '';
    const btns = o.canSend
      ? `<div class="ask-btns"><button type="button" class="perm-allow ask-answer"${dis}>${esc(t('ix.perm.approve'))}</button><button type="button" class="perm-deny"${dis}>${esc(t('ix.perm.reject'))}</button>${link}</div>`
      : link ? `<div class="ask-btns">${link}</div>` : '';
    return `<div class="ask-card plan-card perm-card ${cardCls('s-planPending')}"${id}><div class="ask-head"><b class="ask-kind">${esc(t('ix.card.plan'))}</b>${badge('ix.card.st.planPending', 's-planPending')}</div>`
      + `${hint('ix.perm.planOnly')}${body}`
      + `<div class="ask-ix">${form}<p class="ask-hint">${esc(t('ix.perm.planNote'))}</p>${stLine(view, st, t)}${btns}</div></div>`;
  }
  const danger = Array.isArray(view.danger) && view.danger.length > 0;
  const armed = !!o.armed && danger && can;
  const form = o.canSend && !busy
    ? `<label class="ask-otherw"><span>${esc(t('ix.perm.reason'))}</span><input type="text" class="perm-msg" maxlength="2000" placeholder="${esc(t('ix.perm.reasonPh'))}"></label>` : '';
  const btns = o.canSend
    ? `<div class="ask-btns"><button type="button" class="perm-allow ask-answer${danger ? ' perm-risky' : ''}${armed ? ' armed' : ''}"${dis}>${esc(t(armed ? 'ix.perm.allowConfirm' : 'ix.perm.allow'))}</button><button type="button" class="perm-deny"${dis}>${esc(t('ix.perm.deny'))}</button>${link}</div>`
    : link ? `<div class="ask-btns">${link}</div>` : '';
  return `<div class="ask-card perm-card ${cardCls('s-pending')}${danger && !ans ? ' perm-hot' : ''}"${id}><div class="ask-head"><b class="ask-kind">${esc(t('ix.perm.title'))}</b><code class="perm-tool">${esc(view.tool || '')}</code>${badge('ix.card.st.pending', 's-pending')}</div>`
    + `${hint('ix.perm.only')}${ans ? '' : dangerHtml(view, t)}${bodyHtml(view, t)}`
    + `<div class="ask-ix">${form}<p class="ask-hint">${esc(t('ix.perm.note'))}</p>${stLine(view, st, t)}${btns}</div></div>`;
}

/** 열렸다는 것만 알고 읽지 못했을 때(브리지 읽기 실패) — 앱 링크로 안내 */
export function permOpenHtml(link, t = tr) {
  const a = link && LINK_RE.test(link) ? `<div class="ask-btns"><a class="ask-app" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(t('ix.card.app'))}</a></div>` : '';
  return `<div class="ask-card perm-card s-pending"><p class="ask-hint ask-only">${esc(t('ix.perm.open'))}</p>${a}</div>`;
}

/**
 * 허용 누름 → 다음 동작: 'send'(보냄) | 'arm'(위험 — 첫 누름, 확인 기다림). armedAt = 첫 누름 시각(없으면 null)
 */
export function allowStep(view, armedAt, now = Date.now()) {
  const danger = view && view.kind === 'perm' && Array.isArray(view.danger) && view.danger.length > 0;
  if (!danger) return 'send';
  return armedAt != null && now - armedAt <= ARM_MS ? 'send' : 'arm';
}
