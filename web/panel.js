// 사이드 패널: 실황 텍스트 스트림
import { escapeHtml } from './html-util.mjs'; // scene.js(three)를 끌어오지 않게
import { CAT_LABEL } from './icons.js';
import { KIND_LABEL } from './layout.js';
import { filterChip, FILTER_HINT } from './filter-ui.mjs';
import { insertIndexDesc, splitArrivals, atTop, keepAnchor } from './panel-order.mjs';
import { nodeSubtitle } from './node-title.mjs';
import { ixHtml, ensureIxCss } from './ix-core.mjs'; // 범주 글리프·요약
import { t, fmtTime, fmtNum } from './i18n.mjs';
ensureIxCss();

const MAX_LINES = 1000;
// 브라우저 스크롤 앵커링(overflow-anchor)이 있으면 과거 읽기 중 화면 고정을 맡긴다. 직접 보정하면 content-visibility 줄이
// 그려지며 크기가 바뀔 때(22px 추정 → 실제) 한 번 밀리고, 앵커링과 겹치면 두 번 보정된다
const NATIVE_ANCHOR = typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('overflow-anchor', 'auto');
const STATUS_TXT = Object.fromEntries(['active', 'idle', 'done', 'error', 'stopped'].map((k) => [k, t('app.panel.st.' + k)]));
// '중지됨' 사유(서버 meta.stopReason)
export const STOP_REASON_TXT = Object.fromEntries(['taskstop', 'kill-cmd', 'signal', 'time-limit', 'killed', 'orphan', 'session-end', 'parent-stopped']
  .map((k) => [k, t('app.panel.stop.' + k)]));
const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function hhmmss(ts) {
  const d = ts ? new Date(ts) : new Date();
  if (isNaN(d)) return '--:--:--';
  return fmtTime(d, { seconds: true });
}
// 줄 순서: 최신이 맨 위, 시각 역순(panel-order.mjs). 늦게 도착한 과거 기록은 시각 자리에 끼워 넣는다
export { insertIndexDesc };

function dur(ms) {
  if (ms == null || !isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return t('app.panel.dur.s', { s: (ms / 1000).toFixed(1) });
  return t('app.panel.dur.ms', { m: Math.floor(ms / 60000), s: Math.round((ms % 60000) / 1000) });
}

export class Panel {
  constructor({ getNode, onPickNode, getProject = null }) {
    this.getNode = getNode;
    this.onPickNode = onPickNode;
    this.getProject = getProject;   // projectId → {name, path} (전체 보기 줄 앞 프로젝트 칩)
    this.scopeFilter = null;        // {projectId?, rootSessionId?}
    this.showProject = false;
    this.el = document.getElementById('stream');
    this.countEl = document.getElementById('stream-count');
    this.filterEl = document.getElementById('stream-filter');
    // 해제 방법 안내: 칩 안에 작게
    if (this.filterEl && !this.filterEl.querySelector('small')) { const h = document.createElement('small'); h.textContent = FILTER_HINT; this.filterEl.appendChild(h); }
    this.latestBtn = document.getElementById('to-latest');
    this.filter = null;
    this.queue = [];
    this.lines = 0;
    this.stick = true;              // 맨 위(최신)에 붙어 있음 — 새 줄이 와도 맨 위 유지
    this.total = 0;
    this._raf = 0;

    let collapsed = false;
    // 기본 접힘(저장값 'open' 이면 펼침 — 예전에 직접 펼쳐 둔 설정은 그대로)
    try { collapsed = localStorage.getItem('ccviz.panel') !== 'open'; } catch (e) { collapsed = true; }
    if (!localStorage_ok() && window.innerWidth < 720) collapsed = true;
    this.setCollapsed(collapsed, false);
    document.getElementById('panel-toggle').addEventListener('click', () => this.setCollapsed(!this.collapsed));
    document.querySelector('#panel header h2').addEventListener('click', () => { if (this.collapsed) this.setCollapsed(false); });

    new ResizeObserver(() => {
      if (this.stick) { this._ignoreUntil = performance.now() + 300; this.el.scrollTop = 0; }
    }).observe(this.el);
    this.el.addEventListener('scroll', () => {
      if (this._ignoreUntil && performance.now() < this._ignoreUntil && this.stick) { this.el.scrollTop = 0; return; }
      const top = atTop(this.el.scrollTop);
      this.stick = top;
      this.latestBtn.classList.toggle('on', !top);
    }, { passive: true });
    this.latestBtn.addEventListener('click', () => this._toTop());
    this.el.addEventListener('click', (e) => {
      const who = e.target.closest('.who');
      if (!who) return;
      const id = who.parentElement.dataset.node;
      this.setFilter(this.filter === id ? null : id);
      if (this.filter && this.onPickNode) this.onPickNode(id);
    });
    this.filterEl.addEventListener('click', () => this.setFilter(null));
  }

  setCollapsed(c, save = true) {
    this.collapsed = c;
    document.body.classList.toggle('panel-collapsed', c);
    if (save) try { localStorage.setItem('ccviz.panel', c ? 'collapsed' : 'open'); } catch (e) {}
    if (!c && this.stick) requestAnimationFrame(() => { this.el.scrollTop = 0; });
  }

  /** 맨 위(최신)로 붙기 */
  _toTop() {
    this.stick = true;
    this.el.scrollTop = 0;
    this.latestBtn.classList.remove('on');
  }

  /** 과거를 읽는 중: 보던 화면 맨 위 줄과 그 위치(DOM 바꾸기 전에 잰다) */
  _anchor() {
    const st = this.el.scrollTop;
    for (const k of this.el.children) {
      if (!k.offsetParent) continue; // 필터로 숨긴 줄
      if (k.offsetTop + k.offsetHeight > st + this.el.offsetTop) return { el: k, top: k.offsetTop, st };
    }
    return null;
  }

  setFilter(id) {
    this.filter = id || null;
    const n = id && this.getNode(id);
    this.filterEl.classList.toggle('on', !!id);
    const chip = filterChip(id ? trunc((n && n.label) || id, 18) : '');
    this.filterEl.querySelector('b').textContent = id ? chip.text : '';
    this.filterEl.title = id ? chip.title : t('app.panel.filterOff');
    for (const ln of this.el.children) ln.classList.toggle('k-hidden', !!id && ln.dataset.node !== id);
    this._toTop();
  }

  /** 범위 필터: 노드의 projectId·rootSessionId 로 거른다. 노드 클릭 필터(setFilter)와 AND. 걸러진 줄은 건수에서 뺀다 */
  setScopeFilter(f) {
    const next = f && (f.projectId || f.rootSessionId) ? { projectId: f.projectId || null, rootSessionId: f.rootSessionId || null } : null;
    const same = JSON.stringify(next) === JSON.stringify(this.scopeFilter);
    this.scopeFilter = next;
    if (same) return;
    let shown = 0;
    for (const ln of this.el.children) { const out = !this._inScope(ln.dataset.pid, ln.dataset.rsid); ln.classList.toggle('k-scope', out); if (!out) shown++; }
    this.total = shown;
    this._count();
    this._toTop();
  }

  /** 전체 보기에서 줄 앞에 프로젝트 짧은 이름 칩 */
  setShowProject(on) { this.showProject = !!on; this.el.classList.toggle('show-proj', this.showProject); }

  _inScope(pid, rsid) {
    const f = this.scopeFilter;
    if (!f) return true;
    if (f.rootSessionId) return rsid === f.rootSessionId;
    return pid === f.projectId;
  }

  _scopeOf(ev) {
    const n = this.getNode(ev.nodeId) || ev.node || null;
    return { pid: ev.projectId || (n && n.projectId) || '', rsid: ev.rootSessionId || (n && n.rootSessionId) || '' };
  }

  reset() {
    this._maxTs = 0;
    this._lastLineT = 0;
    clearTimeout(this._to2); this._to2 = 0;
    this.queue = [];
    this.el.textContent = '';
    this.lines = 0;
    this.total = 0;
    this._toTop();
    this._count();
  }

  add(ev) {
    const html = this.format(ev);
    if (!html) return;
    const sc = this._scopeOf(ev);
    this.queue.push({ ev, html, ...sc });
    if (this.queue.length > MAX_LINES) this.queue.splice(0, this.queue.length - MAX_LINES);
    // 줄 붙이기는 초당 최대 10번으로 묶는다: 이벤트가 쏟아질 때(노드 수백 개 생성) 매 프레임 DOM 추가·스크롤 계산이
    // 렌더 시간을 먹어 300 노드에서 30fps 안팎으로 떨어졌다
    const wait = Math.max(0, 100 - (performance.now() - (this._lastFlush || 0)));
    if (!this._raf && !this._to2) {
      if (wait <= 0) this._raf = requestAnimationFrame(() => this.flush());
      else this._to2 = setTimeout(() => { this._to2 = 0; this._raf = requestAnimationFrame(() => this.flush()); }, wait);
    }
    // 탭이 숨겨져 rAF 가 멈춰도 쌓이지 않게
    if (!this._to) this._to = setTimeout(() => this.flush(), 400);
  }

  flush() {
    cancelAnimationFrame(this._raf); this._raf = 0;
    clearTimeout(this._to); this._to = 0;
    clearTimeout(this._to2); this._to2 = 0;
    this._lastFlush = performance.now();
    if (!this.queue.length) return;
    // 과거를 읽는 중이면 보던 줄을 기준으로 잡아 둔다(위에 줄이 붙어도 화면이 밀리지 않게). 앵커링 지원 브라우저는 브라우저가 한다
    const anchor = !NATIVE_ANCHOR && !this.stick && !this.collapsed ? this._anchor() : null;
    const divs = [], ts = [];
    let shown = 0;
    for (const { ev, html, pid, rsid } of this.queue) {
      const div = document.createElement('div');
      const t = Date.parse(ev.ts) || 0;
      div.dataset.t = String(t);
      div.className = 'ln k-' + ev.type;
      div.dataset.node = ev.nodeId || '';
      if (pid) div.dataset.pid = pid;
      if (rsid) div.dataset.rsid = rsid;
      if (this.filter && ev.nodeId !== this.filter) div.classList.add('k-hidden');
      if (this._inScope(pid, rsid)) shown++; else div.classList.add('k-scope');
      div.innerHTML = pid ? html.replace('<span class="msg">', `<span class="msg">${this._projChip(pid)}`) : html;
      divs.push(div); ts.push(t);
    }
    this.total += shown;
    this.lines += this.queue.length;
    this.queue = [];
    // 앞줄보다 2초 넘게 이른 기록은 시각 자리에 끼워 넣고, 나머지는 도착 역순으로 맨 위에 한 번에 붙인다
    const { top, late, lastT } = splitArrivals(ts, this._lastLineT || 0);
    const frag = document.createDocumentFragment();
    for (const i of top) frag.appendChild(divs[i]);
    this.el.insertBefore(frag, this.el.firstChild);
    this._lastLineT = lastT;
    if (late.length) {
      const kids = this.el.children;
      const times = Array.from(kids, (k) => Number(k.dataset.t) || 0);
      for (const i of late) {
        const j = insertIndexDesc(times, ts[i]);
        this.el.insertBefore(divs[i], kids[j] || null);
        times.splice(j, 0, ts[i]);
      }
    }
    // 줄 상한: 가장 오래된 줄(맨 아래)부터 지운다
    while (this.lines > MAX_LINES) { this.el.lastChild.remove(); this.lines--; }
    if (!this.collapsed) {
      if (this.stick) this.el.scrollTop = 0;
      else if (anchor && anchor.el.isConnected) {
        const fix = () => { if (!this.stick && anchor.el.isConnected) this.el.scrollTop = keepAnchor(anchor.st, anchor.top, anchor.el.offsetTop); };
        fix();
        // content-visibility 줄은 그려진 뒤 크기가 확정돼(22px 추정 → 실제) 한 번 더 밀린다 — 다음 프레임에 다시 맞춘다
        requestAnimationFrame(() => requestAnimationFrame(fix));
      }
    }
    this._count();
  }

  _projChip(pid) {
    const p = this.getProject ? this.getProject(pid) : null;
    const name = (p && p.name) || pid;
    const short = p && p.temp ? String(name).replace(/^\([^)]*\) /, '') : String(name); // 임시 프로젝트 꼬리표('(임시) '·'(temp) ', 번역) 떼기
    return `<span class="pchip" title="${escapeHtml((p && p.path) || name)}">${escapeHtml(trunc(short, 14))}</span>`;
  }

  _count() { this.countEl.textContent = this.total ? t('app.panel.count', { n: this.total, s: fmtNum(this.total) }) : ''; }

  format(ev) {
    const node = this.getNode(ev.nodeId) || (ev.type === 'node-add' ? ev.node : null);
    let msg = '';
    switch (ev.type) {
      case 'node-add': {
        const n = ev.node || node || {};
        const st = nodeSubtitle(n); // 자동 제목 부제
        msg = `<span class="tag">${t('app.panel.tag.created')}</span>${escapeHtml(KIND_LABEL[n.kind] || n.kind || '')}${n.label ? ' · ' + escapeHtml(trunc(n.label, 80)) : ''}${st ? ' <span class="dim ntitle">— ' + escapeHtml(trunc(st, 80)) + '</span>' : ''}`;
        break;
      }
      case 'node-update': {
        const p = ev.patch || {};
        if (ev.ix && ev.ix.cat === 'user' && ev.ix.op === 'reply') { msg = `<span class="ix-reply-msg">${ixHtml(ev.ix)}</span>`; break; } // 메인 최종 답변(턴 끝)
        if (p.status) {
          const cls = p.status === 'error' ? 'err' : p.status === 'done' ? 'ok' : p.status === 'stopped' ? 'stop' : '';
          const why = p.status === 'stopped' && p.meta && STOP_REASON_TXT[p.meta.stopReason] ? ` <span class="dim">${escapeHtml(STOP_REASON_TXT[p.meta.stopReason])}</span>` : '';
          msg = `<span class="tag ${cls}">${t('app.panel.tag.status')}</span>${escapeHtml(STATUS_TXT[p.status] || p.status)}${why}`;
        } else if (p.label) msg = `<span class="tag">${t('app.panel.tag.name')}</span>${escapeHtml(trunc(p.label, 80))}`;
        else if (p.meta && p.meta.title && node && nodeSubtitle(node)) msg = `<span class="tag">${t('app.panel.tag.title')}</span><span class="ntitle">${escapeHtml(trunc(nodeSubtitle(node), 100))}</span>`; // 자동 제목 갱신
        else if (p.meta && 'skill' in p.meta && p.meta.skill) msg = `<span class="tag skill">${t('app.panel.tag.skill')}</span>${escapeHtml(t('app.panel.skillInUse', { name: p.meta.skill }))}`;
        else if (p.parentId) msg = `<span class="tag">${t('app.panel.tag.link')}</span><span class="dim">${t('app.panel.reparent')}</span>`;
        else if (ev.ctxNote && p.meta && p.meta.ctx) {
          // 컨텍스트 사용률: 50·70·90% 를 넘을 때와 급락(compact)만 한 줄
          const c = p.meta.ctx, k = ev.ctxNote;
          const tok = `<span class="dim">${Math.round(c.used / 1000)}k / ${Math.round(c.limit / 1000)}k${c.estimated ? t('app.panel.ctxEstimated') : ''}</span>`;
          msg = k.kind === 'drop'
            ? `<span class="tag ok">${t('app.panel.tag.compact')}</span>${t('app.panel.ctxDrop', { a: Math.round(k.from), b: Math.round(k.to) })} ${tok}`
            : `<span class="tag ${k.level === 'danger' ? 'err' : k.level === 'warn' ? 'stop' : ''}">${t('app.panel.tag.ctx')}</span>${Math.round(k.pct)}%${k.pct >= 75 ? t('app.panel.ctxAdvice') : ''} ${tok}`;
        }
        else return null; // lastActivityAt 같은 잡음은 숨김
        break;
      }
      case 'tool-start': {
        if (ev.cat === 'skill' || ev.skill) msg = `<span class="tag skill">${t('app.panel.tag.skill')}</span><b>${escapeHtml(ev.skill || ev.text || '')}</b>`;
        else { // 작업 요약: brief(무엇을) + detail(보조), 없으면 예전 text
          const what = ev.brief || ev.text || '', more = ev.detail && ev.detail !== what ? ev.detail : '';
          msg = `<span class="tag">${escapeHtml(CAT_LABEL[ev.cat] || ev.cat || '')}</span><b>${escapeHtml(ev.tool || '')}</b>${what ? ' ' + escapeHtml(what) : ''}${more ? ' <span class="dim">' + escapeHtml(more) + '</span>' : ''}`;
        }
        break;
      }
      case 'tool-end': {
        const ok = ev.ok !== false;
        msg = `<span class="tag ${ok ? 'ok' : 'err'}">${ok ? t('app.panel.tag.done') : t('app.panel.tag.failed')}</span>${escapeHtml(ev.tool || '')} <span class="dim">${escapeHtml(dur(ev.durationMs))}${(ev.brief || ev.text) ? ' · ' + escapeHtml(ev.brief || ev.text) : ''}</span>`;
        break;
      }
      case 'text': msg = (ev.role === 'system' ? `<span class="tag">${t('app.panel.tag.summary')}</span>` : '') + escapeHtml(ev.text || ''); break;
      case 'thinking': msg = `<span class="dim">${t('app.panel.thinking', { n: Number(ev.chars || 0), s: fmtNum(Number(ev.chars || 0)) })}</span>`; break;
      case 'user': {
        const o = ev.origin === 'human' ? t('app.panel.tag.user') : ev.origin === 'task-notification' ? t('app.panel.tag.notify') : ev.origin === 'schedule' ? t('app.panel.tag.schedule') : t('app.panel.tag.system');
        // Monitor 출력으로 시작한 턴은 그 출력 한 줄을 덧붙임(알림 요약은 'Monitor event: 이름' 뿐)
        const xt = ev.ix && ev.ix.op === 'auto' && ev.ix.src === 'monitor' && ev.ix.text ? ` <span class="dim">› ${escapeHtml(ev.ix.text)}</span>` : '';
        msg = `<span class="tag${ev.origin === 'schedule' ? ' sched' : ''}">${o}</span>${escapeHtml(ev.text || '')}${xt}`;
        break;
      }
      case 'result': msg = `<span class="tag ${ev.ok === false ? 'err' : 'ok'}">${t('app.panel.tag.result')}</span>${escapeHtml(ev.text || '')}`; break;
      case 'output': msg = `<span class="tag">${t('app.panel.tag.output')}</span>${ev.coalesced > 1 ? `<span class="dim">${t('app.panel.outLines', { n: Number(ev.lineCount || 0), s: fmtNum(Number(ev.lineCount || 0)) })}</span>` : ''}<pre>${escapeHtml(ev.text || '')}</pre>`; break;
      case 'tool-summary': { // 서버 몰림 정리 — 짝이 맞은 짧은 도구 n건을 한 줄로
        const cats = Object.entries(ev.cats || {}).sort((a, b) => b[1] - a[1]).map(([c, k]) => `${escapeHtml(CAT_LABEL[c] || c)} ${k}`).join(' · ');
        msg = `<span class="tag">${t('app.panel.tag.tools')}</span>${t('app.panel.toolSummary', { n: Number(ev.n || 0), s: fmtNum(Number(ev.n || 0)) })}${cats ? ` <span class="dim">${cats}</span>` : ''}${ev.fail ? ` <span class="tag err">${t('app.panel.tag.failed')} ${Number(ev.fail)}</span>` : ''}`;
        break;
      }
      case 'conflict': { // 같은 파일(다른 live 세션)
        const peer = this.getNode(ev.peer);
        const pn = escapeHtml(trunc((peer && peer.label) || ev.peer || '', 30));
        msg = ev.state === 'off'
          ? `<span class="tag ok">${t('app.panel.tag.conflictEnd')}</span><b>${escapeHtml(ev.file || '')}</b> <span class="dim">↔ ${pn}</span>`
          : `<span class="tag conflict">${t('app.panel.tag.sameFile')}</span><b>${escapeHtml(ev.file || '')}</b> <span class="dim">↔ ${pn} · ${ev.level === 'strong' ? t('app.panel.bothEdit') : t('app.panel.oneEdit')}${ev.path ? ' · ' + escapeHtml(ev.path) : ''}</span>`;
        break;
      }
      case 'watch': { // 분리 프로세스 들여다보기 — 시작만 한 줄(끝은 숨김)
        if (ev.phase === 'end') return null;
        const peer = this.getNode(ev.peer);
        msg = `<span class="tag">${ev.kind === 'wait' ? t('app.panel.tag.waitOn') : t('app.panel.tag.peek')}</span>→ <b>${escapeHtml(trunc((peer && peer.label) || ev.peer || '', 40))}</b>`;
        break;
      }
      case 'session-msg': { // 세션 간 메시지
        const peer = this.getNode(ev.peer);
        msg = `<span class="tag">${t('app.panel.tag.crossSession')}</span>→ <b>${escapeHtml(trunc((peer && peer.label) || ev.peer || '', 30))}</b>${ev.text ? ' ' + escapeHtml(ev.text) : ''}`;
        break;
      }
      default: msg = `<span class="tag">${escapeHtml(ev.type)}</span>`;
    }
    if (ev.ix && (ev.type === 'tool-start' || ev.type === 'tool-end' || ev.type === 'output')) msg = ixHtml(ev.ix) + msg;
    else if (ev.type === 'user' && ev.ix && ev.ix.cat === 'user' && ev.ix.op !== 'auto') { // '나 › …' 줄은 금빛으로 구분
      const h = ixHtml(ev.ix);
      msg = `<span class="ix-user-msg">${h.replace(/<span class="ixs[^"]*">[^<]*<\/span> /, `<b class="ixs ix-c-user">${escapeHtml(t('app.panel.me'))}</b> `)}${escapeHtml(ev.text || '')}</span>`;
    }
    const kind = (node && node.kind) || 'subagent';
    const label = trunc((node && node.label) || ev.nodeId || '', 40); // 첫 줄을 혼자 쓰므로 넉넉히(넘치면 CSS 말줄임)
    const sub = node ? nodeSubtitle(node) : '';
    const whoTip = ((node && node.label) || ev.nodeId || '') + (sub ? ' — ' + sub : '');
    // seq 순서로 도착하므로, 이미 보인 줄보다 이른 시각(늦게 도착한 과거 기록)은 표시해 둔다
    const tms = Date.parse(ev.ts) || 0;
    const late = this.markLate !== false && this._maxTs && tms && tms < this._maxTs - 2000; // 재생 이벤트는 정렬돼 있어 표시 안 함
    if (tms > (this._maxTs || 0)) this._maxTs = tms;
    const tAttr = late ? ` class="late" title="${escapeHtml(t('app.panel.lateTitle'))}"` : '';
    // 같은 프로젝트 live 세션이 여럿이면 이름을 그 세션 색으로
    const si = this.getSessIdx ? this.getSessIdx(node || (ev.rootSessionId ? { rootSessionId: ev.rootSessionId } : null)) : null;
    const sc = si != null ? ` class="sess s${si}"` : '';
    return `<time${tAttr}>${late ? '↶' : ''}${hhmmss(ev.ts)}</time><span class="who" title="${escapeHtml(whoTip + t('app.panel.whoTip'))}"><i${sc} style="background:var(--k-${kind})"></i><b${sc}>${escapeHtml(label)}</b></span><span class="msg">${msg}</span>`;
  }
}

function localStorage_ok() {
  try { return localStorage.getItem('ccviz.panel') != null; } catch (e) { return false; }
}
