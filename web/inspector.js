// 객체 클릭 상세 팝업(인스펙터) — DOM 부분. 규칙·문구·배치는 inspector-core.mjs(순수).
// 객체 옆 카드(좁은 화면은 하단 시트)가 페이드 + 살짝 떠오르며 나타나고, 이벤트가 오면 내용을 갈아 끼운다(재생이면 재생 시점 기준).
// 빈 곳 클릭·Esc·닫기·객체 퇴장·45초 입력 없음 → 페이드아웃 후 onClose(카메라는 app 이 자동으로 돌림). '따라가기'면 입력 없음으로 닫지 않는다.
// 위치는 rAF(열려 있을 때만) — 투영 점 하나와 transform 만 바꾸므로 장면 fps 에 거의 영향 없음. 내용은 250ms 스로틀.
import {
  INSPECT, kindInfo, statusInfo, elapsedMs, fmtElapsed, fmtMs, fmtAgo, parentIdOf, childrenOf, childStats, childLine, nowDoing,
  InspectBook, ixLoose, deviceModel, barHeights, islandModel, limitsLine, sheetMode, placeCard, autoCloseReason, targetKey, easeToward,
  jobCardModel, ownerJobsModel,
} from './inspector-core.mjs';
import { isJob } from './job-core.mjs';
import { isLauncher, isRunner } from './batch-core.mjs';
import { ctxShort, gaugeLevel } from './ctx-core.mjs';
import { branchOf } from './session-core.mjs';
import { toScreen, camScale } from './flat/flat-core.mjs';
import { escapeHtml as esc } from './html-util.mjs';
import { artInspectModel, ART } from './artifact-core.mjs'; // 작업 대상 팝업
import { t as tr } from './i18n.mjs';

let ixSum = null; // 특별 상호작용 요약(ix-core 가 있으면 그 문구, 없으면 느슨한 요약)
let ixGlyph = { github: '⎇', db: '⛁', remote: '⇄', batch: '▦', tests: '✔' };
import('./ix-core.mjs').then((m) => { ixSum = m.ixSummary || null; if (m.IX_GLYPH) ixGlyph = m.IX_GLYPH; }).catch(() => { /* 계약 전: 느슨한 요약 */ });

const KIND_VAR = { main: 'main', subagent: 'subagent', workflow: 'workflow', 'workflow-agent': 'workflow-agent', 'claude-p': 'claude-p', 'bash-bg': 'bash-bg', monitor: 'monitor' };
const ST_MARK = (t) => (t.ok == null ? `<i class="ins-tm run" aria-label="${esc(tr('cards.ins.running'))}">…</i>` : t.ok ? `<i class="ins-tm ok" aria-label="${esc(tr('cards.ins.ok'))}">✓</i>` : `<i class="ins-tm err" aria-label="${esc(tr('cards.ins.fail'))}">✗</i>`);

let cssDone = false;
function ensureCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const href = new URL('./inspector.css', import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
}

/** 화면 좌표의 객체 원 {x, y, r}(px, 뷰포트 기준). 못 구하면 null */
export function anchorOf(view, t) {
  if (!view || !t) return null;
  let pos = null, wr = 1;
  if (t.type === 'cluster') { const c = view.clusterTarget && view.clusterTarget(t.pid); if (!c) return null; pos = c.center; wr = c.r || 6; }
  else if (t.type === 'artifact') { pos = view.artPos ? view.artPos(t.pid, t.id) : null; wr = 1.4; } // 바닥층 대상
  else { if (!view.has || !view.has(t.id)) return null; pos = view.nodePos ? view.nodePos(t.id) : null; wr = view.nodeRadius ? view.nodeRadius(t.id) : 1; }
  if (!pos) return null;
  const dom = view.renderer && view.renderer.domElement;
  const rect = dom ? dom.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  if (view.flat) {
    const p = toScreen(view.cam, view.W, view.H, pos.x, pos.z, {});
    return { x: rect.left + p.x, y: rect.top + p.y, r: Math.min(240, wr * 1.3 * camScale(view.cam, view.H)) }; // 칩·고리 바깥까지
  }
  const cam = view.camera;
  if (!cam || !pos.clone) return null;
  const v = pos.clone().project(cam);
  if (v.z > 1 || v.z < -1) return { x: -1e4, y: -1e4, r: 0 }; // 카메라 뒤
  const d = cam.position.distanceTo(pos) || 1;
  const rpx = (wr * 1.3 / (d * Math.tan(((cam.fov || 50) * Math.PI) / 360))) * (rect.height / 2);
  return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, r: Math.min(240, rpx) };
}

/** 무대 안쪽(패널·상단 바·하단 띠 제외) */
function stageBounds() {
  const W = innerWidth, H = innerHeight;
  let top = 0, right = W, bottom = H;
  const tb = document.getElementById('topbar');
  if (tb) top = tb.getBoundingClientRect().bottom;
  const pn = document.getElementById('panel');
  if (pn && !sheetMode(W)) { const r = pn.getBoundingClientRect(); if (r.width > 0 && r.left > W * 0.4) right = r.left; }
  for (const id of ['timeline', 'macro-tl', 'replay-bar']) {
    const o = document.getElementById(id);
    if (!o || o.hidden) continue;
    const r = o.getBoundingClientRect();
    if (r.height > 0 && r.top > H * 0.5) bottom = Math.min(bottom, r.top);
  }
  return { left: 0, top, right, bottom };
}

/**
 * @param {object} h 훅
 *  getView() · nodes(Map) · clock() → epoch ms(재생이면 가상 시계) · isReplaying() · canScope() · canReplay()
 *  getProject(pid) · getLimits() · sessIdx(node) → 정수|null
 *  onFocus(target, {follow}) — 카메라 다가가기·포커스 · onClose(reason) — 자동 카메라 복귀
 *  onScopeSession(node) · onScopeProject(pid) · onReplay(node) · onFollow(on)
 */
export function mountInspector(h) {
  ensureCss();
  const book = new InspectBook();
  const el = document.createElement('section');
  el.id = 'inspector';
  el.className = 'ins';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('aria-labelledby', 'ins-title');
  el.tabIndex = -1;
  el.hidden = true;
  el.innerHTML = `
    <div class="ins-grip" aria-hidden="true"></div>
    <header class="ins-head">
      <span class="ins-icon" aria-hidden="true"></span>
      <div class="ins-names"><h3 id="ins-title"></h3><p class="ins-kind"></p></div>
      <button type="button" class="ins-x" aria-label="${esc(tr('cards.ins.closeEsc'))}" title="${esc(tr('cards.ins.closeEsc'))}">×</button>
    </header>
    <div class="ins-state"><span class="ins-pill"></span><span class="ins-el"></span><span class="ins-sess"></span></div>
    <div class="ins-body"></div>
    <footer class="ins-foot"></footer>`;
  document.body.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const body = $('.ins-body'), foot = $('.ins-foot');

  let target = null, follow = false, lastInput = performance.now(), bodyHtml = '', footKey = '';
  let raf = 0, lastT = 0, lastContent = 0, dirty = true, pos = null, leaving = 0, bounds = null, boundsAt = 0;
  let sheet = false, settleT = 0, lastReason = null;
  let footNode = null; // 발자국 강조 중인 노드

  const noteInput = () => { lastInput = performance.now(); };
  for (const ev of ['pointerdown', 'wheel', 'keydown', 'touchstart']) window.addEventListener(ev, noteInput, { passive: true, capture: true });
  let pmT = 0;
  window.addEventListener('pointermove', () => { const t = performance.now(); if (t - pmT > 500) { pmT = t; lastInput = t; } }, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !target) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
    close('esc');
  }, true);

  $('.ins-x').addEventListener('click', () => close('button'));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act], [data-goto]');
    if (!b || !el.contains(b)) return;
    if (b.dataset.goto) { if (h.nodes.has(b.dataset.goto)) open({ type: 'node', id: b.dataset.goto }); return; }
    if (b.dataset.art) { const [pid, ...rest] = b.dataset.art.split('|'); open({ type: 'artifact', pid, id: rest.join('|') }); return; }
    const n = target && target.type === 'node' ? h.nodes.get(target.id) : null;
    switch (b.dataset.act) {
      case 'scope': if (n) { close('scope', { silent: true }); h.onScopeSession(n); } break;
      case 'project': if (target && target.type === 'cluster') { const pid = target.pid; close('scope', { silent: true }); h.onScopeProject(pid); } break;
      case 'replay': if (n) { const nn = n; close('replay', { silent: true }); h.onReplay(nn); } break;
      case 'follow': setFollow(!follow); break;
      case 'foot': if (n && h.onFoot) { footNode = footNode === n.id ? null : n.id; h.onFoot(n, !!footNode); renderFoot(true); } break;
      case 'close': close('button'); break;
    }
  });
  // 하단 시트: 아래로 끌어 닫기
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (!sheet || !e.target.closest('.ins-grip, .ins-head')) return;
    if (e.target.closest('button')) return;
    drag = { y: e.clientY, dy: 0, id: e.pointerId };
    try { el.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ }
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dy = Math.max(0, e.clientY - drag.y);
    el.style.setProperty('--ins-drag', drag.dy + 'px');
  });
  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const dy = drag.dy; drag = null;
    el.classList.remove('dragging');
    el.style.removeProperty('--ins-drag');
    if (dy > 70) close('swipe');
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  function setFollow(on) {
    follow = !!on;
    renderFoot(true);
    if (h.onFollow) h.onFollow(follow);
  }

  function open(t, o = {}) {
    if (!t || (t.type === 'node' && !h.nodes.has(t.id))) return;
    const same = targetKey(t) === targetKey(target) && !leaving;
    if (same && t.type === 'node' && (t.tool || null) !== (target.tool || null)) { target = t; dirty = true; bodyHtml = ''; } // 같은 노드의 다른 도구 패널
    lastInput = performance.now();
    if (!same) {
      const swap = !!target && !leaving && !el.hidden;
      target = t;
      dirty = true; bodyHtml = ''; footKey = '';
      if (swap) { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); } // 내용 교차 전환(위치는 보간)
    }
    clearTimeout(leaving); leaving = 0;
    if (el.hidden) {
      el.hidden = false;
      pos = null;
      el.classList.remove('show', 'leave', 'settled');
      void el.offsetWidth;
      el.classList.add('show');
      clearTimeout(settleT); settleT = setTimeout(() => { if (target) el.classList.add('settled'); }, 280); // 등장 뒤엔 rAF 보간만
    } else el.classList.remove('leave');
    render(true);
    if (t.tool) requestAnimationFrame(() => { const li = el.querySelector('.ins-tl li.hl'); if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' }); }); // 패널에서 열면 그 도구 호출 줄로
    h.onFocus(t, { follow, same });
    if (o.focus !== false) { try { el.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
    if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(loop); }
  }

  function close(reason = 'blank', { silent = false } = {}) {
    if (!target || leaving) return false;
    const was = target;
    lastReason = reason;
    target = null;
    follow = false;
    footNode = null;
    el.classList.remove('show', 'swap', 'settled');
    el.classList.add('leave');
    if (el.contains(document.activeElement)) { try { document.activeElement.blur(); } catch (e) { /* 무시 */ } }
    leaving = setTimeout(() => { leaving = 0; if (!target) { el.hidden = true; el.classList.remove('leave'); } }, 220);
    h.onClose(reason, was, { silent });
    return true;
  }

  function loop(t) {
    raf = 0;
    if (!target) return;
    const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
    const view = h.getView();
    if (t - boundsAt > 500) { bounds = stageBounds(); boundsAt = t; }
    sheet = sheetMode(innerWidth);
    el.classList.toggle('sheet', sheet);
    if (!sheet) {
      const a = (target.type === 'plan' && h.planAnchor && h.planAnchor(target.id)) || anchorOf(view, target); // 계획 보드 카드는 보드 자리 곁
      if (a) {
        const want = placeCard(a, { w: el.offsetWidth || 320, h: el.offsetHeight || 240 }, bounds);
        if (!pos) pos = { x: want.x, y: want.y };
        else { pos.x = easeToward(pos.x, want.x, dt); pos.y = easeToward(pos.y, want.y, dt); }
        el.style.setProperty('--ins-x', Math.round(pos.x) + 'px');
        el.style.setProperty('--ins-y', Math.round(pos.y) + 'px');
        el.dataset.side = want.side;
      }
    }
    if (t - lastContent > (dirty ? 250 : 1000)) { lastContent = t; render(false); }
    if (target) raf = requestAnimationFrame(loop);
  }

  // ---------- 내용 ----------
  function present() {
    if (!target) return false;
    const view = h.getView();
    if (target.type === 'cluster') return !!(view && view.clusterTarget && view.clusterTarget(target.pid));
    if (target.type === 'artifact') return !!(h.getArt && h.getArt() && view && view.artPos && view.artPos(target.pid, target.id));
    if (!h.nodes.has(target.id) || !view || !view.has(target.id)) return false;
    const v = view.vis && view.vis.get(target.id);
    return !(v && (v.hidden || v.gone || (v.exiting != null && v.exiting !== false)));
  }

  function render(force) {
    if (!target) return;
    const why = autoCloseReason({ now: performance.now(), lastInput, follow, present: present() });
    if (why) { close(why); return; }
    const nowMs = h.clock();
    el.classList.toggle('ins-wide', target.type === 'plan'); // 계획 보드 크게 보기
    if (target.type === 'cluster') renderCluster(nowMs); else if (target.type === 'artifact') renderArtifact(nowMs); else if (target.type === 'plan') renderPlan(nowMs); else renderNode(nowMs);
    dirty = false;
    renderFoot(force);
  }

  function setHead(icon, kindKey, title, kindLine, color = null) {
    const ic = $('.ins-icon');
    ic.textContent = icon;
    ic.style.setProperty('--kc', color || (kindKey ? `var(--k-${kindKey})` : 'var(--accent)'));
    const tt = $('#ins-title'); if (tt.textContent !== title) tt.textContent = title;
    const kl = $('.ins-kind'); if (kl.textContent !== kindLine) kl.textContent = kindLine;
  }
  function setBody(html) {
    if (html === bodyHtml) return;
    const act = document.activeElement;
    const keep = act && body.contains(act) ? act.dataset.goto || null : null;
    bodyHtml = html;
    body.innerHTML = html;
    if (keep) { const b = body.querySelector(`[data-goto="${CSS.escape(keep)}"]`); if (b) b.focus({ preventScroll: true }); }
  }

  /** 작업 노드: 머리 = 제목 + 표시 상태 배지(정체면 경고색), 행 = 상태·단계·진행(막대)·호스트·박동(상대)·재확인·rc·출처, 마지막 줄 */
  function renderJob(n, nowMs) {
    const m = jobCardModel(n, nowMs);
    if (!m) return;
    const ki = kindInfo(n);
    setHead(ki.icon, null, m.title, `${ki.name} — ${ki.desc}`, `var(--jd-${m.display})`);
    const pill = $('.ins-pill');
    pill.className = `ins-pill jd jd-${m.display}${m.warn ? ' warn' : ''}`; pill.textContent = m.badge;
    const a = Date.parse(m.startedAt || ''), z = m.endedAt ? Date.parse(m.endedAt) : nowMs;
    $('.ins-el').textContent = Number.isFinite(a) ? tr(m.endedAt ? 'cards.ins.took' : 'cards.ins.elapsed', { t: fmtElapsed(Math.max(0, z - a)) }) : '';
    const si = h.sessIdx ? h.sessIdx(n) : null;
    const sess = $('.ins-sess');
    sess.className = 'ins-sess' + (Number.isInteger(si) ? ' s' + si : '');
    sess.innerHTML = Number.isInteger(si) ? `<i aria-hidden="true"></i>${esc(tr('cards.ins.sessColor'))}` : '';
    const parts = [];
    const rows = m.rows.map((r) => {
      let v = `<span${r.title ? ` title="${esc(r.title)}"` : ''}>${esc(r.value)}</span>`;
      if (r.key === 'state') v = `<span class="ins-jstate jd-${esc(m.display)}"><i aria-hidden="true"></i>${esc(r.value)}</span>`;
      if (r.key === 'progress' && r.ratio != null) {
        const pct = Math.round(r.ratio * 1000) / 10;
        v = `<span class="ins-jprog jd-${esc(m.display)}"><span class="ins-jbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(r.label)}"><i style="width:${pct}%"></i></span><span>${esc(r.value)}</span></span>`;
      }
      return `<dt>${esc(r.label)}</dt><dd class="k-${esc(r.key)}">${v}</dd>`;
    }).join('');
    parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.job.h.job'))}</h4><dl class="ins-jrows">${rows}</dl></section>`);
    if (m.line) parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.job.h.line'))}</h4><p class="ins-mono ins-jline" title="${esc(m.line)}">${esc(m.line)}</p></section>`);
    const pid = parentIdOf(n);
    const pn = pid ? h.nodes.get(pid) : null;
    if (pn) parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.rel'))}</h4><p>${esc(tr('cards.ins.parent'))} <button type="button" class="ins-link" data-goto="${esc(pn.id)}">${esc(kindInfo(pn).icon)} ${esc(pn.label || pn.id)}</button></p></section>`);
    setBody(parts.join(''));
  }

  /** 주인 노드 아래 작업 목록(작업마다 한 줄: 상태 점 · 제목 · 단계 · 진행) + 접혀 숨은 끝난 작업 수 */
  function jobsHtml(n, nowMs) {
    const jm = ownerJobsModel(h.nodes, n.id, nowMs);
    if (!jm) return '';
    const view = h.getView();
    const li = jm.items.map((it) => {
      const inner = `<i class="ins-jdot" aria-hidden="true"></i><b class="ins-jt">${esc(it.title)}</b>${it.phase ? `<span class="ins-jp">${esc(it.phase)}</span>` : ''}${it.progress ? `<small class="ins-jn">${esc(it.progress)}</small>` : ''}`;
      const can = view && view.has && view.has(it.id);
      const stT = it.display === 'stale' ? tr('cards.job.stale', { t: '' }).trim() : tr('cards.job.' + it.display);
      return `<li class="jd-${esc(it.display)}">${can ? `<button type="button" class="ins-link ins-job" data-goto="${esc(it.id)}" title="${esc(stT)}">${inner}</button>` : `<span class="ins-job" title="${esc(stT)}">${inner}</span>`}</li>`;
    }).join('');
    const more = jm.hidden ? `<li class="ins-dim ins-jmore">${esc(tr('cards.job.hidden', { n: jm.hidden }))}</li>` : '';
    return `<section class="ins-sec"><h4>${esc(tr('cards.job.h.jobs'))} <small>${jm.total}</small></h4><ul class="ins-jobs">${li}${more}</ul></section>`;
  }

  function renderNode(nowMs) {
    const n = h.nodes.get(target.id);
    if (!n) return;
    if (isJob(n)) { renderJob(n, nowMs); return; }
    const ki = kindInfo(n);
    const kids = childrenOf(h.nodes, n.id);
    const cs = childStats(kids);
    const st = statusInfo(n, cs);
    setHead(ki.icon, KIND_VAR[n.kind] || null, n.label || n.id, `${ki.name} — ${ki.desc}`);
    const pill = $('.ins-pill');
    pill.className = 'ins-pill st-' + st.key; pill.textContent = st.label;
    const em = elapsedMs(n, nowMs);
    $('.ins-el').textContent = em != null ? tr(n.endedAt ? 'cards.ins.took' : 'cards.ins.elapsed', { t: fmtElapsed(em) }) : '';
    const si = h.sessIdx ? h.sessIdx(n) : null, br = n.kind === 'main' ? branchOf(n) : null;
    const sess = $('.ins-sess');
    sess.className = 'ins-sess' + (Number.isInteger(si) ? ' s' + si : '');
    sess.innerHTML = (Number.isInteger(si) ? `<i aria-hidden="true"></i>${esc(tr('cards.ins.sessColor'))} ` : '') + (br ? `<span class="ins-br" title="${esc(tr('cards.ins.branch'))}">⎇ ${esc(String(br).slice(0, 28))}</span>` : '');

    const parts = [];
    // 지금 하는 일
    const nd = nowDoing(n, book);
    if (nd && (nd.text || nd.tool) && n.status !== 'done') {
      parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.now'))}</h4><p class="ins-now">${nd.tool ? `<b class="ins-tool">${esc(nd.tool)}</b> ` : ''}${esc(nd.text || '')}${nd.more > 0 ? ` <small>${esc(tr('cards.ins.moreTools', { n: nd.more }))}</small>` : ''}</p></section>`);
    }
    // 컨텍스트(메인·claude -p)
    const ctx = n.meta && n.meta.ctx;
    if (ctx && Number.isFinite(ctx.pct)) {
      const lv = gaugeLevel(ctx.pct);
      parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.ctx'))}</h4><div class="ins-gauge lv-${lv}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(ctx.pct)}" aria-label="${esc(tr('cards.ins.ctxUse'))}"><i style="width:${Math.min(100, Math.max(0, ctx.pct)).toFixed(1)}%"></i></div><p class="ins-dim">${esc(tr('cards.ins.tokens', { n: ctxShort(ctx) }))}${ctx.estimated ? ' ' + esc(tr('cards.ins.ctxEst')) : ''}</p></section>`);
    }
    // 계획 항목(계획 보드가 켜졌을 때)
    const ph = h.planHtml ? h.planHtml(n, nowMs) : '';
    if (ph) parts.push(ph);
    // 기동기·러너
    if (isLauncher(n) || isRunner(n)) {
      const dm = deviceModel(isRunner(n) && n.meta.runner.launcher && h.nodes.get(n.meta.runner.launcher) ? h.nodes.get(n.meta.runner.launcher) : n, h.nodes, nowMs);
      const hs = barHeights(dm.bars);
      const bars = dm.bars.length ? `<div class="ins-bars" aria-label="${esc(tr('cards.ins.bars', { n: dm.bars.length }))}">${dm.bars.map((b, i) => `<span class="st-${esc(b.status)}" style="height:${Math.round(hs[i] * 100)}%" title="${esc(statusInfo({ status: b.status }).label)}${b.ms ? ' · ' + esc(fmtMs(b.ms)) : ''}"${b.nodeId && h.nodes.has(b.nodeId) ? ` data-goto="${esc(b.nodeId)}" role="button" tabindex="0"` : ''}></span>`).join('')}</div>` : '';
      parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.cycles'))}</h4><p>${esc(dm.summary)}</p>${dm.current ? `<p class="ins-dim">${esc(tr('cards.ins.current'))} <button type="button" class="ins-link" data-goto="${esc(dm.current.id)}">${esc(dm.current.label)}</button>${dm.current.ms != null ? ' · ' + esc(fmtElapsed(dm.current.ms)) : ''}</p>` : ''}${dm.lastEnd ? `<p class="ins-dim">${esc(tr('cards.ins.lastEnd', { x: dm.lastEnd.label }))}</p>` : ''}${bars}</section>`);
    }
    // 백그라운드 명령·Monitor: 명령
    if ((n.kind === 'bash-bg' || n.kind === 'monitor') && !isLauncher(n) && !isRunner(n)) {
      const cmd = (n.meta && (n.meta.command || n.meta.title)) || '';
      if (cmd) parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.cmd'))}</h4><p class="ins-mono">${esc(String(cmd).slice(0, 200))}</p></section>`);
    }
    // 이 노드의 출력이 보고하는 작업(주인 노드)
    const jh = jobsHtml(n, nowMs);
    if (jh) parts.push(jh);
    // 특별 상호작용(메타가 있을 때만)
    const ixs = book.ix(n.id);
    if (ixs.length) {
      parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.ix'))}</h4><ul class="ins-ix">${ixs.map((x) => {
        const s = (ixSum && ixSum(x)) || ixLoose(x);
        const fail = x.phase === 'end' && x.ok === false;
        return `<li class="ix-${esc(x.cat)}${fail ? ' fail' : ''}"><i aria-hidden="true">${esc(ixGlyph[x.cat] || '•')}</i>${esc(s)}</li>`;
      }).join('')}</ul></section>`);
    }
    // 최근 도구
    const tools = book.tools(n.id).slice().reverse();
    if (tools.length) {
      parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.tools'))} <small>${tools.length}</small></h4><ol class="ins-tl">${tools.map((t) =>
        `<li class="${t.ok === false ? 'err' : ''}${target && target.tool && t.id === target.tool ? ' hl' : ''}" data-tu="${esc(t.id || '')}">${ST_MARK(t)}<b>${esc(t.tool)}</b><span class="ins-tt" title="${esc(t.text)}">${esc(t.text)}</span><small>${esc(fmtMs(t.ms))}</small></li>`).join('')}</ol></section>`);
    } else if (n.status !== 'done') parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.tools'))}</h4><p class="ins-dim">${esc(tr('cards.ins.noTools'))}</p></section>`);
    // 실제 출력(서버가 마스킹한 몇 줄)
    const tail = book.tail(n.id);
    if (tail.lines.length) parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.out'))}${tail.title ? ` <small>${esc(tail.title.slice(0, 60))}</small>` : ''}</h4><pre class="ins-pre">${tail.lines.map((l) => esc(String(l).slice(0, 140))).join('\n')}</pre></section>`);
    // 관계
    const pid = parentIdOf(n);
    const pn = pid ? h.nodes.get(pid) : null;
    const rel = [];
    if (pn) rel.push(`<p>${esc(tr('cards.ins.parent'))} <button type="button" class="ins-link" data-goto="${esc(pn.id)}">${esc(kindInfo(pn).icon)} ${esc(pn.label || pn.id)}</button></p>`);
    const rk = jh ? kids.filter((k) => !isJob(k)) : kids; // 작업은 위 '작업' 구역에 따로(접힌 수 포함)
    if (rk.length) {
      rel.push(`<p class="ins-dim">${esc(childLine(jh ? childStats(rk) : cs))}</p><ul class="ins-kids">${rk.slice(0, INSPECT.KIDS).map((k) =>
        `<li><button type="button" class="ins-link st-${esc(k.status || 'idle')}" data-goto="${esc(k.id)}"><i aria-hidden="true"></i>${esc(kindInfo(k).icon)} ${esc(k.label || k.id)}</button></li>`).join('')}${rk.length > INSPECT.KIDS ? `<li class="ins-dim">${esc(tr('cards.ins.more', { n: rk.length - INSPECT.KIDS }))}</li>` : ''}</ul>`);
    }
    if (rel.length) parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.rel'))}</h4>${rel.join('')}</section>`);
    setBody(parts.join(''));
  }

  function renderCluster(nowMs) {
    const p = h.getProject(target.pid);
    const im = islandModel(p, target.pid, h.nodes, nowMs);
    setHead('⬡', null, im.name, tr('cards.ins.island'));
    const pill = $('.ins-pill');
    pill.className = 'ins-pill st-' + (im.active ? 'active' : 'idle'); pill.textContent = tr(im.active ? 'cards.st.active' : 'cards.st.idle');
    $('.ins-el').textContent = im.lastAgo ? tr('cards.ins.lastAct', { t: im.lastAgo }) : '';
    $('.ins-sess').className = 'ins-sess'; $('.ins-sess').textContent = '';
    const parts = [];
    if (im.path) parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.path'))}</h4><p class="ins-mono">${esc(im.path)}</p></section>`);
    const lim = limitsLine(h.getLimits ? h.getLimits() : null);
    parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.status'))}</h4><p>${esc(tr('cards.ins.live', { n: im.liveSessions }))}${im.busySessions != null ? ` · ${esc(tr('cards.ins.busy', { n: im.busySessions }))}` : ''}${im.sessions != null ? ` · ${esc(tr('cards.ins.all', { n: im.sessions }))}` : ''}</p><p>${esc(tr('cards.ins.nodes', { n: im.nodes, a: im.active }))}</p>${lim ? `<p class="ins-dim">${esc(lim)}</p>` : ''}</section>`);
    if (im.mains.length) parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.mains'))}</h4><ul class="ins-kids">${im.mains.slice(0, INSPECT.KIDS).map((id) => { const m = h.nodes.get(id); return `<li><button type="button" class="ins-link st-${esc(m.status || 'idle')}" data-goto="${esc(id)}"><i aria-hidden="true"></i>◆ ${esc(m.label || id)}</button></li>`; }).join('')}</ul></section>`);
    setBody(parts.join(''));
  }

  /** 계획 보드 크게 보기: 그 메인에 모인 계획 전부(항목 전체·상태·회차·출처 노드) — 내용은 plan-ui 가 만든다 */
  function renderPlan(nowMs) {
    const m = h.planSheet ? h.planSheet(target.id, nowMs) : null;
    if (!m) { close('gone'); return; }
    setHead('▤', 'main', m.title, m.kindLine);
    const pill = $('.ins-pill'); pill.className = 'ins-pill st-active'; pill.textContent = m.pill;
    $('.ins-el').textContent = '';
    $('.ins-sess').className = 'ins-sess'; $('.ins-sess').textContent = '';
    setBody(m.html);
  }

  /** 작업 대상: 누가 언제 무엇을(최근 기록)·변경 크기·관계 노드 */
  function renderArtifact(nowMs) {
    const A = h.getArt && h.getArt();
    const it = A ? A.book.get(target.pid, target.id) : null;
    if (!it) { setBody(`<p class="ins-dim">${esc(tr('cards.ins.noRecord'))}</p>`); return; }
    const labelOf = (id) => { const nn = h.nodes.get(id); return nn ? nn.label || id : A.book.nodeLabels.get(id) || id; };
    const m = artInspectModel(it, nowMs, labelOf);
    setHead(m.glyph, null, m.title, `${m.kind}${m.est ? ' — ' + tr('cards.ins.estCmd') : ''}`);
    const pill = $('.ins-pill');
    const hot = it.x && it.x !== 'overwrite' && nowMs - (it.xAt || 0) < ART.ALARM_MS; // artifact-core state 와 같은 판정(문구 비교 대신)
    pill.className = 'ins-pill st-' + (it.del ? 'stopped' : hot ? 'error' : 'idle'); pill.textContent = m.state;
    $('.ins-el').textContent = tr('cards.ins.lastFirst', { last: m.last, first: m.first });
    $('.ins-sess').className = 'ins-sess'; $('.ins-sess').textContent = '';
    const parts = [];
    if (m.path) parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.path'))}</h4><p class="ins-mono">${esc(m.path)}</p></section>`);
    const badges = [m.imp ? `<span class="imp" aria-label="${esc(tr('cards.ins.imp'))}">★ ${esc(m.imp)}</span>` : '', m.x ? `<span class="x">⚠ ${esc(m.x)}</span>` : ''].filter(Boolean).join('');
    parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.summary'))}</h4><p>${esc(m.verbs || '—')}</p>${m.lines.map((l) => `<p class="ins-dim">${esc(l)}</p>`).join('')}${badges ? `<div class="ins-art-badges">${badges}</div>` : ''}</section>`);
    if (m.log.length) parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.log'))} <small>${esc(tr('cards.ins.recentN', { n: m.log.length }))}</small></h4><ul class="ins-art-log">${m.log.map((l) => `<li class="${l.x ? 'x' : ''}"><small>${esc(l.when)}</small><span>${l.node && h.nodes.has(l.node) ? `<button type="button" class="ins-link" data-goto="${esc(l.node)}">${esc(l.who)}</button>` : esc(l.who)} · <b>${esc(l.verb)}</b></span><small>${esc(l.detail)}</small></li>`).join('')}</ul></section>`);
    if (m.who.length) parts.push(`<section class="ins-sec"><h4>${esc(tr('cards.ins.h.rel'))} <small>${esc(tr('cards.ins.touched', { n: m.who.length }))}</small></h4><ul class="ins-kids">${m.who.map((w) => `<li>${h.nodes.has(w.node) ? `<button type="button" class="ins-link" data-goto="${esc(w.node)}"><i aria-hidden="true"></i>${esc(w.name)}</button>` : `<span class="ins-dim">${esc(w.name)}</span>`} <small class="ins-dim">${esc(w.verb)} · ${esc(tr('cards.ins.times', { n: w.c }))} · ${esc(w.when)}</small></li>`).join('')}</ul></section>`);
    setBody(parts.join(''));
  }

  function renderFoot(force) {
    const isNode = target && target.type === 'node';
    const n = isNode ? h.nodes.get(target.id) : null;
    const canScope = h.canScope();
    const rep = h.isReplaying();
    const artOn = !!(h.getArt && h.getArt());
    const key = [target ? targetKey(target) : '', follow, canScope, rep, h.canReplay(), artOn, footNode].join('|');
    if (!force && key === footKey) return;
    footKey = key;
    const b = [];
    if (isNode && n && canScope) b.push(`<button type="button" class="ins-btn" data-act="scope" title="${esc(tr('cards.ins.scope.t'))}">${esc(tr('cards.ins.scope'))}</button>`);
    if (isNode && n && artOn) b.push(`<button type="button" class="ins-btn" data-act="foot" aria-pressed="${footNode === n.id}" title="${esc(tr('cards.ins.foot.t'))}">${esc(tr(footNode === n.id ? 'cards.ins.foot.off' : 'cards.ins.foot.on'))}</button>`);
    if (!isNode && target && target.type === 'cluster' && canScope) b.push(`<button type="button" class="ins-btn" data-act="project" title="${esc(tr('cards.ins.project.t'))}">${esc(tr('cards.ins.project'))}</button>`);
    if (isNode && n && h.canReplay()) b.push(`<button type="button" class="ins-btn" data-act="replay" title="${esc(tr(rep ? 'cards.ins.replay.t.at' : 'cards.ins.replay.t.open'))}">${esc(tr(rep ? 'cards.ins.replay.at' : 'cards.ins.replay.open'))}</button>`);
    if (target && target.type !== 'artifact' && target.type !== 'plan') b.push(`<button type="button" class="ins-btn" data-act="follow" aria-pressed="${follow}" title="${esc(tr('cards.ins.follow.t'))}">${esc(tr(follow ? 'cards.ins.following' : 'cards.ins.follow'))}</button>`);
    b.push(`<button type="button" class="ins-btn ghost" data-act="close">${esc(tr('cards.ins.close'))}</button>`);
    foot.innerHTML = b.join('');
  }

  return {
    open, close,
    get isOpen() { return !!target; },
    get target() { return target ? { ...target } : null; },
    get follow() { return follow; },
    get lastReason() { return lastReason; }, // 마지막 닫힘 사유(blank·esc·button·swipe·gone·idle·scope·replay)
    setFollow,
    book,
    /** 모든 이벤트(라이브·재생 같은 경로) */
    event(ev) {
      const id = book.event(ev);
      if (!target) return;
      if (ev.type === 'node-remove' || ev.type === 'node-add' || ev.type === 'node-update') { dirty = true; return; }
      if (target.type === 'artifact') { if (ev.art) dirty = true; return; }
      if (id && (target.type === 'cluster' || id === target.id || (h.nodes.get(id) && parentIdOf(h.nodes.get(id)) === target.id))) dirty = true;
    },
    /** 스냅샷(재연결·재생 시크): 장부를 비우고 recent 로 다시 채움 */
    reset(recent = []) { book.reset(); for (const ev of recent || []) book.event(ev); dirty = true; },
    refresh() { dirty = true; },
    el,
  };
}
