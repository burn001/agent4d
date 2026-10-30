// 컨텍스트 사용률 게이지. 신호 열화는 2026-10-30 폐지 — 에이전트별 과열 표현은 각 표현이 heat-core.mjs로 그린다.
//   const cx = mountCtx({ store, getState: () => ({ focusId, streamAll, sel }) });
//   cx.noteCtx(ev, prevNode)  — node-update 에 meta.ctx 가 있을 때(병합 전) 부른다. 30·70·90% 첫 넘김·급락이면 ev.ctxNote 를 붙임(패널 줄)
//   cx.hover(nodeId|null, pointerEvent) — 노드 툴팁
// 상단 바·카드 DOM 은 이 모듈이 직접 만든다(index.html 무변경).
import { ctxNote, ctxShort, ctxTitle, pctText, gaugeLevel, pickGaugeNode, fmtTokens, baseOf, grownOf, heatName } from './ctx-core.mjs';
import { HEAT_STAGES, heatStageOf } from './heat-core.mjs';
import { nodeSubtitle } from './node-title.mjs';
import { t as tr } from './i18n.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SESSION_KINDS = new Set(['main', 'claude-p']);
const NL = String.fromCharCode(10);

function ensureCss() {
  if (document.querySelector('link[data-ccviz="ctx"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./ctx.css', import.meta.url).href;
  l.dataset.ccviz = 'ctx';
  document.head.appendChild(l);
}

export function mountCtx({ store, getState }) {
  ensureCss();
  // 기준선(첫 응답, 카드·툴팁 표시용): 서버 c.base 우선, 없으면 이 화면에서 본 최솟값(seen), 그것도 없으면 min(지금, 60k)
  const seen = new Map();

  // ── 상단 바: 게이지 알약(한도 게이지 앞). 누르면 카드(대상·토큰·창 근거·과열 단계표) ──
  const top = document.getElementById('topbar');
  const gauge = document.createElement('div');
  gauge.id = 'ctx-gauge'; gauge.className = 'ctxg';
  const T = (k) => esc(tr(k));
  gauge.innerHTML = `<button type="button" class="ctxg-pill" aria-haspopup="true" aria-expanded="false"><span class="ctxg-name">${T('sound.ctx.pill')}</span><b class="ctxg-pct">—</b><span class="ctxg-who"></span><span class="ctxg-bar"><i></i></span></button>`
    + `<div class="ctxg-card" hidden><h4>${T('sound.ctx.card')} <small class="ctxg-cwho"></small></h4><p class="ctxg-cdet"></p>`
    + '<ol class="ctxg-stages"></ol>'
    + '<p class="ctxg-note"></p></div>';
  const limEl = document.getElementById('limits');
  if (limEl && limEl.parentNode) limEl.parentNode.insertBefore(gauge, limEl); else top.appendChild(gauge);
  const pill = gauge.querySelector('.ctxg-pill');
  const card = gauge.querySelector('.ctxg-card');
  pill.addEventListener('click', (e) => { e.stopPropagation(); card.hidden = !card.hidden; pill.setAttribute('aria-expanded', String(!card.hidden)); if (!card.hidden) updateGauge(); });
  document.addEventListener('pointerdown', (e) => { if (!card.hidden && !gauge.contains(e.target)) { card.hidden = true; pill.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !card.hidden) { card.hidden = true; pill.setAttribute('aria-expanded', 'false'); } });
  // 과열 단계표(창 대비 %) — 에이전트마다 자기 값으로 표현이 달라진다
  const stagesEl = gauge.querySelector('.ctxg-stages');
  const noteEl = gauge.querySelector('.ctxg-note');

  const tip = document.createElement('div'); tip.id = 'ctx-tip'; tip.hidden = true; document.body.appendChild(tip);
  let gaugeId = null;

  function nodeCtx(id) { const n = id && store.nodes.get(id); return n && n.meta && n.meta.ctx ? n.meta.ctx : null; }

  /** 카드·툴팁 한 줄: 시작(기준선) · 늘어난 양 */
  function baseLine(c, id) {
    const sv = id != null ? seen.get(id) : null;
    const known = c.base != null || sv != null;
    return tr(known ? 'sound.ctx.baseLine' : 'sound.ctx.baseLine.est', { base: fmtTokens(baseOf(c, sv)), grown: fmtTokens(grownOf(c, sv)) });
  }

  function updateGauge() {
    const st = getState();
    const pick = pickGaugeNode({ nodes: store.nodes, focusId: st.focusId, root: store.root, streamAll: st.streamAll, sel: st.sel, roots: store.roots || [] });
    gaugeId = pick ? pick.id : null;
    const n = gaugeId ? store.nodes.get(gaugeId) : null;
    const c = n && n.meta && n.meta.ctx;
    if (!c) {
      pill.className = 'ctxg-pill lv-none';
      pill.querySelector('.ctxg-pct').textContent = '—';
      pill.querySelector('.ctxg-who').textContent = '';
      pill.querySelector('.ctxg-bar i').style.width = '0';
      pill.title = tr('sound.ctx.pill.none');
      if (!card.hidden) { gauge.querySelector('.ctxg-cwho').textContent = ''; gauge.querySelector('.ctxg-cdet').textContent = tr('sound.ctx.card.none'); }
    } else {
      const lv = gaugeLevel(c.pct);
      pill.className = 'ctxg-pill lv-' + lv + (c.estimated ? ' est' : '');
      const pctEl = pill.querySelector('.ctxg-pct');
      const txt = pctText(c.pct) + (c.estimated ? '?' : '');
      if (pctEl.textContent !== txt) pctEl.textContent = txt;
      const who = pick.why === 'max' ? tr('sound.ctx.who.max') : SESSION_KINDS.has(n.kind) && !n.parentId ? tr('sound.ctx.who.main') : (n.label || '').slice(0, 10);
      const whoEl = pill.querySelector('.ctxg-who');
      if (whoEl.textContent !== who) whoEl.textContent = who;
      pill.querySelector('.ctxg-bar i').style.width = Math.min(100, c.pct) + '%';
      const title = ctxTitle(c, (pick.why === 'max' ? tr('sound.ctx.highest') : '') + (n.label || n.id)) + NL + tr('sound.ctx.pill.more');
      if (pill.title !== title) pill.title = title;
      if (!card.hidden) { gauge.querySelector('.ctxg-cwho').textContent = (n.label || n.id).slice(0, 40); gauge.querySelector('.ctxg-cdet').textContent = ctxTitle(c).split(NL).slice(0, 3).join(NL) + NL + baseLine(c, gaugeId); }
    }
    if (!card.hidden) {
      // 단계표·설명은 언어가 바뀔 수 있어 카드를 열 때마다 다시 쓴다
      const cur = c ? heatStageOf(c.pct) : -1;
      const html = HEAT_STAGES.map((x) => `<li${x.stage === cur ? ' class="cur"' : ''}><b>${x.min ? esc(x.min + '%') : '&lt;' + HEAT_STAGES[1].min + '%'}</b> ${esc(heatName(x.stage))}</li>`).join('');
      if (stagesEl.innerHTML !== html) stagesEl.innerHTML = html;
      const note = tr('sound.ctx.note');
      if (noteEl.textContent !== note) noteEl.textContent = note;
    }
  }
  setInterval(updateGauge, 250);

  /** node-update(meta.ctx) 병합 전에 부른다 — 패널 줄 메모(ev.ctxNote)와 기준선 장부 */
  function noteCtx(ev, prevNode) {
    const next = ev.patch && ev.patch.meta && ev.patch.meta.ctx;
    if (!next) return null;
    const prev = prevNode && prevNode.meta ? prevNode.meta.ctx : null;
    const note = ctxNote(prev, next);
    const nid = (prevNode && prevNode.id) || ev.nodeId;
    // 기준선 장부: 처음 값이면 그 값, 아니면 지금까지의 기준선과 새 값 중 작은 것(compact 뒤 더 작아지면 낮춤)
    seen.set(nid, prev ? Math.min(baseOf(prev, seen.get(nid)), Number(next.used) || 0) : Number(next.used) || 0);
    if (note) ev.ctxNote = note;
    return note;
  }

  function hover(id, e) {
    const c = nodeCtx(id);
    if (!c || !e) { tip.hidden = true; return; }
    const n = store.nodes.get(id);
    const sub = n ? nodeSubtitle(n) : ''; // 노드 이름 + 자동 제목 부제
    const who = n ? `<span class="ctx-tip-who">${esc(n.label || id)}${sub ? `<i>${esc(sub)}</i>` : ''}</span>` : '';
    tip.innerHTML = `${who}<b class="lv-${gaugeLevel(c.pct)}">${esc(tr('sound.ctx.tip', { v: ctxShort(c) }))}</b><small>${esc(heatName(heatStageOf(c.pct)))}${c.estimated ? esc(tr('sound.ctx.tip.est')) : ''}</small>`;
    tip.title = ctxTitle(c, n && n.label) + NL + baseLine(c, id);
    tip.style.transform = `translate(${Math.round(e.clientX + 14)}px, ${Math.round(e.clientY + 16)}px)`;
    tip.hidden = false;
  }

  const api = {
    noteCtx, hover,
    get gaugeId() { return gaugeId; },
  };
  window.__ccvizCtx = api;
  return api;
}
