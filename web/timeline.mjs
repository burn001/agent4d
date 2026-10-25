// 화면 아래 이벤트 타임라인: 최근 이벤트가 오른쪽에서 흘러 들어오는 띠, 도구 종류별 색.
// 라이브·재생 모두 app.onEvent → push 로 같은 흐름. 위치는 도착 시각(벽시계) 기준이라 재생 속도가 빠르면 촘촘해진다.
// 순수 부분(markFor·TimelineModel)은 node --test 로 시험한다(web/test/flow.test.mjs).
import { catColor, CAT_ORDER } from './flow-core.mjs';
import { ixMark, ixColor, IX_CATS } from './ix-core.mjs'; // 특별 상호작용 글리프
import { t, fmtTime } from './i18n.mjs';

export const TL = { WINDOW_MS: 60_000, MAX: 2400, MERGE_PX: 3, OUTPUT_GAP_MS: 1500 };

const KIND_TOKEN = (k) => `k-${k || 'subagent'}`;

/**
 * 이벤트 → 타임라인 표식(없으면 null).
 * shape: bar(도구 시작) · tri(생성) · dot(결과·완료) · x(실패·오류) · sq(중지됨) · dia(사람 입력) · tick(출력)
 * color: 'cat:<cat>' | 토큰 이름('ok','error','stopped','text','k-<kind>')
 */
export function markFor(ev, node = null) {
  if (!ev || !ev.type) return null;
  if (ev.ix) { const m = ixMark(ev); if (m) return m; if (ev.type === 'output') return null; } // 시작·끝은 글리프, 진행 출력은 표식 없음
  switch (ev.type) {
    case 'tool-start': return { shape: 'bar', color: 'cat:' + (ev.cat || 'other'), cat: ev.cat || 'other', label: `${ev.tool || ev.cat || t('app.tl.tool')}${(ev.brief || ev.text) ? ' · ' + (ev.brief || ev.text) : ''}` }; // 작업 요약 우선
    case 'tool-end': return ev.ok === false ? { shape: 'x', color: 'error', label: `${t('app.tl.failed', { tool: ev.tool || t('app.tl.tool') })}${(ev.brief || ev.text) ? ' · ' + (ev.brief || ev.text) : ''}` } : null;
    case 'node-add': { const n = ev.node || node || {}; return { shape: 'tri', color: KIND_TOKEN(n.kind), label: `${t('app.tl.created')} · ${n.label || n.id || ''}` }; }
    case 'node-update': {
      const s = ev.patch && ev.patch.status;
      if (s === 'error') return { shape: 'x', color: 'error', label: t('app.tl.error') };
      if (s === 'stopped') return { shape: 'sq', color: 'stopped', label: t('app.tl.stopped') };
      if (s === 'done') return { shape: 'dot', color: 'ok', label: t('app.tl.done'), small: true };
      return null;
    }
    case 'result': return { shape: 'dot', color: ev.ok === false ? 'error' : 'ok', label: `${t('app.tl.result')} · ${ev.text || ''}` };
    case 'user': return ev.origin === 'human' ? { shape: 'dia', color: 'text', label: `${t('app.tl.user')} · ${ev.text || ''}` } : null;
    case 'output': return { shape: 'tick', color: KIND_TOKEN((node && node.kind) || 'bash-bg'), label: t('app.tl.output'), small: true };
    default: return null;
  }
}

export class TimelineModel {
  constructor({ windowMs = TL.WINDOW_MS, max = TL.MAX } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.marks = []; // {t, ev(최소 필드), mark}
    this.lastOut = new Map();
  }
  /** 표식 하나 추가(t = 도착 시각 ms). 추가했으면 그 항목, 아니면 null */
  push(ev, node, t) {
    const m = markFor(ev, node);
    if (!m) return null;
    if (ev.type === 'output') { // 출력은 노드당 1.5초에 하나
      const last = this.lastOut.get(ev.nodeId);
      if (last != null && t - last < TL.OUTPUT_GAP_MS) return null;
      this.lastOut.set(ev.nodeId, t);
      if (this.lastOut.size > 2000) this.lastOut.clear();
    }
    const it = { t, nodeId: ev.nodeId, ts: ev.ts, type: ev.type, mark: m };
    this.marks.push(it);
    if (this.marks.length > this.max) this.marks.splice(0, this.marks.length - this.max);
    return it;
  }
  prune(now) {
    const lim = now - this.windowMs;
    let i = 0;
    while (i < this.marks.length && this.marks[i].t < lim) i++;
    if (i) this.marks.splice(0, i);
  }
  clear() { this.marks = []; this.lastOut.clear(); }
  /**
   * 화면 배치: 오른쪽 끝 = now, 왼쪽 끝 = now - windowMs. 같은 줄에서 MERGE_PX 안에 겹치면 하나로(count 증가).
   * 줄: 0 = 도구(bar), 1 = 그 밖(생성·결과·상태·사람·출력)
   */
  layout(now, width) {
    const out = [];
    const last = [null, null];
    for (const it of this.marks) {
      const x = width - ((now - it.t) / this.windowMs) * width;
      if (x < -8) continue;
      const row = it.mark.row != null ? it.mark.row : it.mark.shape === 'bar' || it.mark.shape === 'glyph' ? 0 : 1;
      const prev = last[row];
      if (prev && Math.abs(prev.x - x) < TL.MERGE_PX && prev.mark.color === it.mark.color && prev.mark.shape === it.mark.shape) { prev.count++; prev.items.push(it); continue; }
      const o = { x, row, mark: it.mark, count: 1, items: [it] };
      out.push(o);
      last[row] = o;
    }
    return out;
  }
}

/**
 * DOM 띠. el 안에 canvas 하나 + 풍선. getColor(key) → CSS 색 문자열.
 * 반환: { push(ev, node), clear(), refreshTheme(), model, dispose() }
 */
export function mountTimeline({ el, getNode = () => null, onPick = null, nowFn = () => performance.now() }) {
  const doc = el.ownerDocument;
  el.innerHTML = '<canvas aria-hidden="true"></canvas><div class="tl-tip" hidden></div><span class="tl-hint">' + t('app.tl.hint') + '</span>';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', t('app.tl.aria'));
  const cv = el.querySelector('canvas');
  const tip = el.querySelector('.tl-tip');
  const ctx = cv.getContext('2d');
  const model = new TimelineModel();
  let colors = {};
  let isLight = false;
  let raf = 0, W = 0, H = 0, dpr = 1, laid = [];
  let hover = null;

  function refreshTheme() {
    const cs = getComputedStyle(doc.documentElement);
    isLight = doc.documentElement.getAttribute('data-theme') === 'light';
    colors = {};
    for (const k of ['ok', 'error', 'stopped', 'text', 'muted', 'border', 'k-main', 'k-subagent', 'k-workflow', 'k-workflow-agent', 'k-claude-p', 'k-bash-bg', 'k-monitor', 'skill'])
      colors[k] = cs.getPropertyValue('--' + k).trim() || '#888';
    for (const c of CAT_ORDER) colors['cat:' + c] = c === 'skill' ? colors.skill : catColor(c, isLight);
    for (const c of IX_CATS) colors['ix:' + c] = ixColor(c, isLight);
    kick();
  }
  const col = (k) => colors[k] || colors.muted || '#888';

  function resize() {
    const r = el.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    kick();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  function draw() {
    raf = 0;
    const now = nowFn();
    model.prune(now);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // 10초 눈금
    ctx.strokeStyle = col('border'); ctx.lineWidth = 1;
    ctx.fillStyle = col('muted'); ctx.font = '10px system-ui, sans-serif'; ctx.textBaseline = 'top';
    for (let s = 10; s * 1000 < model.windowMs; s += 10) {
      const x = Math.round(W - (s * 1000 / model.windowMs) * W) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, H - 2); ctx.stroke();
      if (W > 360) ctx.fillText(t('app.tl.secAgo', { n: s }), x + 3, 2);
    }
    laid = model.layout(now, W);
    const mid = [H * 0.36, H * 0.74];
    for (const o of laid) {
      const m = o.mark, c = col(m.color), y = mid[o.row];
      const x = o.x;
      const age = 1 - Math.max(0, Math.min(1, x / W)); // 왼쪽일수록 옅게
      ctx.globalAlpha = 1 - age * 0.55;
      ctx.fillStyle = c; ctx.strokeStyle = c;
      const big = o === hover ? 1.5 : 1;
      switch (m.shape) {
        case 'bar': {
          // 셸은 낮게(아래쪽), 그 밖 도구 종류는 높게 — 셸이 많아도 다른 도구가 눈에 띄게
          const sh = o.mark.cat === 'shell';
          const w = Math.min(10, 3 + o.count) * big, h = (sh ? 5 : 12) * big;
          ctx.fillRect(x - w / 2, sh ? y + 6 * big - h : y - h / 2, w, h);
          break;
        }
        case 'tri': { const s = 6 * big; ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s * 0.8); ctx.lineTo(x - s, y + s * 0.8); ctx.closePath(); ctx.fill(); break; }
        case 'dot': { ctx.beginPath(); ctx.arc(x, y, (m.small ? 2.6 : 4) * big, 0, Math.PI * 2); ctx.fill(); break; }
        case 'x': { const s = 4.5 * big; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke(); ctx.lineWidth = 1; break; }
        case 'sq': { const s = 4 * big; ctx.fillRect(x - s, y - s, s * 2, s * 2); break; }
        case 'dia': { const s = 5.5 * big; ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill(); break; }
        case 'tick': { ctx.fillRect(x - 0.75, y - 3, 1.5, 6); break; }
        case 'glyph': { ctx.font = `700 ${Math.round(11 * big)}px system-ui, "Segoe UI Symbol", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(m.glyph || '◆', x, y); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '10px system-ui, sans-serif'; break; }
        default: break;
      }
    }
    ctx.globalAlpha = 1;
    if (model.marks.length) raf = requestAnimationFrame(draw);
  }
  function kick() { if (!raf && W) raf = requestAnimationFrame(draw); }

  function hitAt(clientX, clientY) {
    const r = el.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    const row = y < H * 0.55 ? 0 : 1;
    let best = null, bd = 7;
    for (const o of laid) { if (o.row !== row) continue; const d = Math.abs(o.x - x); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  el.addEventListener('pointermove', (e) => {
    const o = hitAt(e.clientX, e.clientY);
    hover = o;
    if (!o) { tip.hidden = true; el.style.cursor = ''; return; }
    const it = o.items[o.items.length - 1];
    const n = getNode(it.nodeId);
    const tm = it.ts ? new Date(it.ts) : null;
    const hh = tm && !isNaN(tm) ? fmtTime(tm, { seconds: true }) : '';
    const lab = String(it.mark.label || '').slice(0, 90);
    tip.innerHTML = `<div class="tt-row"><time>${esc(hh)}</time><b>${esc(n && n.label ? String(n.label).slice(0, 28) : it.nodeId || '')}</b><span class="tt-msg">${esc(lab)}${o.count > 1 ? ` <small>${esc(t('app.tl.more', { n: o.count - 1 }))}</small>` : ''}</span></div>`;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    tip.style.left = Math.max(4, Math.min(r.width - 260, o.x - 40)) + 'px';
    el.style.cursor = onPick ? 'pointer' : '';
    kick();
  });
  el.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; });
  el.addEventListener('click', (e) => {
    const o = hitAt(e.clientX, e.clientY);
    if (o && onPick) onPick(o.items[o.items.length - 1].nodeId);
  });
  refreshTheme();
  resize();
  return {
    model,
    push(ev, node) { if (model.push(ev, node, nowFn())) kick(); },
    clear() { model.clear(); kick(); },
    refreshTheme,
    dispose() { ro.disconnect(); cancelAnimationFrame(raf); el.innerHTML = ''; },
  };
}
