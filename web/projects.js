// 프로젝트 목록 — 상단 바 프로젝트 선택기 팝업 안에 붙는다(예전엔 사이드 패널 맨 위)
//   const pl = mountProjectList({ el, onSelect(sel), getNodeCount(projectId), sessions: false /*: 세션 고르기는 매크로 타임라인 */ });
//   pl.setProjects(projects /* *); pl.setSelection(sel); pl.setDisabled(bool); pl.setCollapsed(bool);
//   sel = { scope:'all' } | { scope:'project', projectId } | { scope:'session', projectId, sessionId }
//       | { scope:'archive', projectId|null }   (보관함: 전체 또는 보관함 안 한 프로젝트)
//   pl.setArchive(summary /* GET /archive */) — 목록 맨 아래 '📦 보관함 (n)' 묶음
// 순수 함수(relTime·groupProjects·serializeSelection·parseSelection·selectionLabel…)는 DOM 없이 node 시험 대상.

import { t as tr } from './i18n.mjs';

export const RECENT_MS = 2 * 3600 * 1000;
const LS_KEY = 'ccviz.projlist';

const tsOf = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };
const num = (v) => (Number.isFinite(v) ? v : 0);

/** 상대 시각: 방금 · n분 전 · n시간 전 · n일 전 */
export function relTime(iso, nowMs = Date.now()) {
  const t = tsOf(iso);
  if (!t) return '';
  const s = Math.max(0, (nowMs - t) / 1000);
  if (s < 60) return tr('app.rel.now');
  if (s < 3600) return tr('app.rel.min', { n: Math.floor(s / 60) });
  if (s < 86400) return tr('app.rel.hour', { n: Math.floor(s / 3600) });
  return tr('app.rel.day', { n: Math.floor(s / 86400) });
}

export function lastActivity(p) {
  let t = tsOf(p && p.lastActivityAt);
  for (const s of (p && p.liveList) || []) t = Math.max(t, tsOf(s.activityAt));
  for (const s of (p && p.recentList) || []) t = Math.max(t, tsOf(s.activityAt));
  return t;
}

/** live | recent | inactive (live = 살아 있는 세션 있음, recent = 2시간 안 활동) */
export function tierOf(p, nowMs = Date.now()) {
  if (!p) return 'inactive';
  if (p.live || num(p.liveSessions) > 0) return 'live';
  const t = lastActivity(p);
  return t && nowMs - t < RECENT_MS ? 'recent' : 'inactive';
}

/** 활성 점: busy(맥동) · idle(채움) · off(빈 원) */
export function dotOf(p) {
  if (!p) return 'off';
  if (num(p.busySessions) > 0 || ((p.liveList || []).some((s) => s.liveStatus === 'busy'))) return 'busy';
  if (p.live || num(p.liveSessions) > 0) return 'idle';
  return 'off';
}

export function countsText(p) {
  if (!p) return '';
  if (p.live || num(p.liveSessions) > 0) return tr('app.proj.countsLive', { n: num(p.liveSessions) || (p.liveList || []).length, a: num(p.activeSessions) });
  return tr('app.proj.countsPast', { n: num(p.sessions) });
}

/** 정렬·묶음: live(활동 내림차순) → recent, temp 는 따로(접기). 비활성(임시 아닌 inactive) 프로젝트는 목록에서 뺀다
 *  hidden 에 개수만, totals.projects 도 보이는 것만 센다 */
export function groupProjects(projects, nowMs = Date.now()) {
  const g = { live: [], recent: [], temp: [], hidden: 0, totals: { projects: 0, liveSessions: 0, activeSessions: 0 } };
  for (const p of projects || []) {
    if (!p || !p.projectId) continue;
    const tier = tierOf(p, nowMs);
    if (!p.temp && tier === 'inactive') { g.hidden++; continue; }
    g.totals.projects++;
    g.totals.liveSessions += num(p.liveSessions);
    g.totals.activeSessions += num(p.activeSessions);
    if (p.temp) { g.temp.push(p); continue; }
    g[tier].push(p);
  }
  const byAct = (a, b) => (lastActivity(b) - lastActivity(a)) || (a.projectId < b.projectId ? -1 : 1);
  for (const k of ['live', 'recent']) g[k].sort(byAct);
  const tierRank = { live: 0, recent: 1, inactive: 2 };
  g.temp.sort((a, b) => (tierRank[tierOf(a, nowMs)] - tierRank[tierOf(b, nowMs)]) || byAct(a, b));
  return g;
}

/** 프로젝트의 세션 목록: live 먼저(활동 내림차순) 그다음 recentList(중복 제외) */
export function sessionsOf(p) {
  if (!p) return [];
  const live = [...(p.liveList || [])].sort((a, b) => tsOf(b.activityAt) - tsOf(a.activityAt)).map((s) => ({ ...s, live: true }));
  const seen = new Set(live.map((s) => s.sessionId));
  const rec = [...(p.recentList || [])].filter((s) => !seen.has(s.sessionId)).sort((a, b) => tsOf(b.activityAt) - tsOf(a.activityAt)).map((s) => ({ ...s, live: false }));
  return [...live, ...rec];
}

export function findSessionProject(projects, sessionId) {
  for (const p of projects || []) {
    if ((p.liveList || []).some((s) => s.sessionId === sessionId) || (p.recentList || []).some((s) => s.sessionId === sessionId)) return p.projectId;
  }
  return null;
}

/** 선택 → URL·저장 문자열: all | project:<id> | session:<sid> | archive | archive:<projectId> */
export function serializeSelection(sel) {
  if (!sel || sel.scope === 'all' || !sel.scope) return 'all';
  if (sel.scope === 'archive') return sel.projectId ? 'archive:' + sel.projectId : 'archive';
  if (sel.scope === 'project' && sel.projectId) return 'project:' + sel.projectId;
  if (sel.scope === 'session' && sel.sessionId) return 'session:' + sel.sessionId;
  return 'all';
}

/** 문자열 → 선택. 세션이면 projects 로 프로젝트를 채운다(없으면 null). 알 수 없는 값 → all */
export function parseSelection(str, projects = null) {
  const s = String(str || '').trim();
  if (!s || s === 'all') return { scope: 'all' };
  if (s === 'archive') return { scope: 'archive', projectId: null };
  const m = /^(project|session|archive):(.+)$/.exec(s);
  if (!m) return { scope: 'all' };
  if (m[1] === 'project') return { scope: 'project', projectId: m[2] };
  if (m[1] === 'archive') return { scope: 'archive', projectId: m[2] };
  return { scope: 'session', sessionId: m[2], projectId: projects ? findSessionProject(projects, m[2]) : null };
}

export function sameSelection(a, b) { return serializeSelection(a) === serializeSelection(b); }

const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** 상단 바·카메라 문구: 전체 | 이름 | 이름 › 세션 제목 */
export function selectionLabel(sel, projects, archive = null) {
  if (!sel || sel.scope === 'all') return tr('app.proj.all');
  if (sel.scope === 'archive') {
    const ap = sel.projectId && archive && (archive.projects || []).find((x) => x.projectId === sel.projectId);
    return '📦 ' + (sel.projectId ? (ap ? ap.name : sel.projectId) : tr('app.proj.archive'));
  }
  const p = (projects || []).find((x) => x.projectId === sel.projectId);
  const name = p ? p.name : (sel.projectId || '');
  if (sel.scope === 'project') return name || tr('app.proj.project');
  let title = '';
  if (p) { const s = sessionsOf(p).find((x) => x.sessionId === sel.sessionId); if (s) title = s.title || ''; }
  if (!title) title = String(sel.sessionId || '').slice(0, 8);
  return name ? `${name} › ${trunc(title, 30)}` : trunc(title, 30);
}

// ───────────────────────── 마운트 ─────────────────────────
function ensureCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-ccviz="projects"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./projects.css', import.meta.url).href;
  l.dataset.ccviz = 'projects';
  document.head.appendChild(l);
}
export { ensureCss as ensureProjectsCss };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { busy: tr('app.proj.st.busy'), idle: tr('app.proj.st.idle'), shell: tr('app.proj.st.shell') };

/** 보관함 묶음 HTML: 머리 '📦 보관함 (n)' = 보관함 전체, 그 아래 프로젝트별. 꺼져 있거나 비면 '' */
export function archiveGroupHtml(archive, sel) {
  if (!archive || !archive.enabled || !archive.count) return '';
  const on = (pid) => sel && sel.scope === 'archive' && (sel.projectId || null) === pid;
  let h = `<div class="pl-arc" role="group" aria-label="${esc(tr('app.proj.archive'))}"><button type="button" class="pl-row pl-arc-all${on(null) ? ' on' : ''}" role="option" aria-selected="${on(null)}" data-act="arc" title="${esc(tr('app.proj.archiveTitle'))}">
    <span class="pl-arc-ic" aria-hidden="true">📦</span><span class="pl-name">${esc(tr('app.proj.archiveN', { n: archive.count }))}</span><span class="pl-meta">${esc(tr('app.proj.replayOnly'))}</span></button>`;
  for (const p of archive.projects || []) {
    h += `<button type="button" class="pl-row pl-arc-row${on(p.projectId) ? ' on' : ''}" role="option" aria-selected="${on(p.projectId)}" data-act="arc" data-pid="${esc(p.projectId)}" title="${esc(p.path || p.name)}">
      <span class="pl-arc-ic" aria-hidden="true"></span><span class="pl-name">${esc(p.name || p.projectId)}</span><span class="pl-meta">${esc(tr('app.psel.metaArchive', { n: p.sessions }))}</span></button>`;
  }
  return h + '</div>';
}

export function mountProjectList({ el, onSelect = () => {}, getNodeCount = null, now = () => Date.now(), sessions = true } = {}) {
  ensureCss();
  let projects = [], sel = { scope: 'all' }, disabled = false, collapsed = false, archive = null;
  let expanded = null;            // 세션 목록을 펼친 프로젝트
  let chipOpen = false;           // 좁은 화면: 선택 칩의 세션 목록
  const openGroups = new Set();   // 사용자가 펼친 접기 묶음(temp)
  const forcedOpen = new Set();   // 선택 항목이 들어 있어 render 가 연 묶음(사용자 선택으로 기억하지 않음)
  try { collapsed = localStorage.getItem(LS_KEY) === 'collapsed'; } catch (e) { /* 저장소 없음 */ }

  el.classList.add('pl');
  el.setAttribute('aria-label', tr('app.proj.project'));
  el.innerHTML = `
    <div class="pl-head">
      <button type="button" class="pl-fold" aria-expanded="true" title="${esc(tr('app.proj.foldTitle'))}">
        <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>
        <span>${esc(tr('app.proj.project'))}</span>
      </button>
      <span class="pl-cur"></span>
    </div>
    <div class="pl-body" role="listbox" aria-label="${esc(tr('app.proj.pick'))}"></div>
    <div class="pl-chips" role="listbox" aria-label="${esc(tr('app.proj.pick'))}"></div>
    <div class="pl-chip-sessions" hidden></div>`;
  const body = el.querySelector('.pl-body'), chips = el.querySelector('.pl-chips'), chipSess = el.querySelector('.pl-chip-sessions');
  const foldBtn = el.querySelector('.pl-fold'), curEl = el.querySelector('.pl-cur');

  foldBtn.addEventListener('click', () => setCollapsed(!collapsed, true));

  function choose(next) {
    if (disabled) return;
    const changed = !sameSelection(next, sel);
    sel = next;
    render();
    if (changed) onSelect({ ...next });
  }

  el.addEventListener('click', (e) => {
    if (disabled) return;
    const t = e.target.closest('[data-act]');
    if (!t || !el.contains(t)) return;
    const act = t.dataset.act;
    if (act === 'all') { expanded = null; chipOpen = false; if (!sessions && sel.scope === 'all') { onSelect({ scope: 'all', again: true }); return; } choose({ scope: 'all' }); }
    else if (act === 'proj') {
      const pid = t.dataset.pid;
      if (!sessions) { if (sel.scope === 'project' && sel.projectId === pid) { onSelect({ ...sel, again: true }); return; } choose({ scope: 'project', projectId: pid }); return; }
      if (sel.scope !== 'all' && sel.projectId === pid && sel.scope === 'project') { expanded = expanded === pid ? null : pid; render(); return; }
      expanded = pid;
      choose({ scope: 'project', projectId: pid });
    } else if (act === 'chip') {
      const pid = t.dataset.pid;
      if (sel.scope !== 'all' && sel.projectId === pid) { chipOpen = !chipOpen; render(); return; }
      chipOpen = false;
      choose({ scope: 'project', projectId: pid });
    } else if (act === 'arc') {
      const next = { scope: 'archive', projectId: t.dataset.pid || null };
      if (sameSelection(next, sel)) { onSelect({ ...sel, again: true }); return; }
      expanded = null; chipOpen = false;
      choose(next);
    } else if (act === 'sess') {
      const pid = t.dataset.pid, sid = t.dataset.sid;
      choose({ scope: 'session', projectId: pid, sessionId: sid });
    }
  });
  el.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d || !d.dataset || !d.dataset.grp) return;
    const key = d.dataset.grp;
    // render 가 선택 때문에 연 것(innerHTML 의 open 속성도 toggle 이벤트를 낸다)은 기억하지 않는다 — 예전엔 이 때문에
    // '전체'로 돌아간 뒤에도 (임시) 묶음이 펼쳐진 채 남았다
    if (d.open) { if (!forcedOpen.has(key)) openGroups.add(key); }
    else { openGroups.delete(key); forcedOpen.delete(key); }
  }, true);

  function rowHtml(p, nowMs) {
    const on = sel.scope !== 'all' && sel.scope !== 'archive' && sel.projectId === p.projectId;
    const dot = dotOf(p);
    const act = relTime(lastActivity(p) ? new Date(lastActivity(p)).toISOString() : null, nowMs);
    const nodes = getNodeCount ? getNodeCount(p.projectId) : null;
    const tip = [p.path || p.name, p.nameGuessed ? tr('app.proj.nameGuessed') : '', nodes ? tr('app.proj.nodes', { n: nodes }) : ''].filter(Boolean).join('\n');
    let html = `<button type="button" class="pl-row${on ? ' on' : ''}${dot === 'off' ? ' dim' : ''}" role="option" aria-selected="${on}" data-act="proj" data-pid="${esc(p.projectId)}" title="${esc(tip)}">
      <i class="pl-dot ${dot}" aria-hidden="true"></i>
      <span class="pl-name">${esc(p.name || p.projectId)}</span>
      <span class="pl-meta">${esc(countsText(p))}${act ? ` · ${esc(act)}` : ''}</span>
    </button>`;
    if (sessions && expanded === p.projectId) html += sessionsHtml(p, nowMs);
    return html;
  }
  function sessionsHtml(p, nowMs) {
    const list = sessionsOf(p);
    if (!list.length) return `<div class="pl-sess"><p class="pl-empty">${esc(tr('app.proj.noSessions'))}</p></div>`;
    return '<div class="pl-sess" role="group">' + list.map((s) => {
      const on = sel.scope === 'session' && sel.sessionId === s.sessionId;
      const st = s.live ? (STATUS[s.liveStatus] || tr('app.proj.st.open')) : tr('app.proj.st.past');
      const cls = s.live ? (s.liveStatus === 'busy' ? 'busy' : 'idle') : 'off';
      const extra = s.live && s.inOverview === false ? ' · ' + tr('app.proj.outOfOverview') : s.entrypoint === 'sdk-cli' ? ' · claude -p' : '';
      return `<button type="button" class="pl-srow${on ? ' on' : ''}" role="option" aria-selected="${on}" data-act="sess" data-pid="${esc(p.projectId)}" data-sid="${esc(s.sessionId)}" title="${esc((s.title || '') + '\n' + s.sessionId)}">
        <i class="pl-dot sm ${cls}" aria-hidden="true"></i><span class="pl-st">${esc(trunc(s.title || s.sessionId.slice(0, 8), 40))}</span>
        <span class="pl-meta">${esc(st)}${esc(extra)}${s.activityAt ? ' · ' + esc(relTime(s.activityAt, nowMs)) : ''}</span></button>`;
    }).join('') + '</div>';
  }

  function render() {
    const nowMs = now();
    const g = groupProjects(projects, nowMs);
    const allOn = sel.scope === 'all';
    const scroll = body.scrollTop;
    let h = `<button type="button" class="pl-row pl-all${allOn ? ' on' : ''}" role="option" aria-selected="${allOn}" data-act="all">
      <i class="pl-dot ${g.live.some((p) => dotOf(p) === 'busy') ? 'busy' : g.live.length ? 'idle' : 'off'}" aria-hidden="true"></i>
      <span class="pl-name">${esc(tr('app.proj.all'))}</span><span class="pl-meta">${esc(tr('app.proj.allMeta', { n: g.totals.projects, a: g.totals.activeSessions }))}</span></button>`;
    for (const p of g.live) h += rowHtml(p, nowMs);
    for (const p of g.recent) h += rowHtml(p, nowMs);
    // 지금 고른 프로젝트가 2시간이 지나 비활성이 됐으면(또는 오래된 세션 링크) 그 한 줄만 남겨 무엇을 보고 있는지 보이게 —
    // 선택은 그대로 두고, 다른 것을 고르면 사라진다
    const selP = sel.scope !== 'all' && sel.scope !== 'archive' && sel.projectId
      && ![...g.live, ...g.recent, ...g.temp].some((p) => p.projectId === sel.projectId)
      ? projects.find((x) => x.projectId === sel.projectId) : null;
    if (selP) h += rowHtml(selP, nowMs);
    const fold = (key, label, arr) => {
      if (!arr.length) return '';
      const hasSel = sel.scope !== 'archive' && arr.some((p) => sel.projectId === p.projectId);
      const open = openGroups.has(key) || hasSel;
      if (hasSel && !openGroups.has(key)) forcedOpen.add(key); else forcedOpen.delete(key);
      return `<details class="pl-grp" data-grp="${key}"${open ? ' open' : ''}><summary>${esc(tr('app.proj.group', { name: label, n: arr.length }))}</summary>${arr.map((p) => rowHtml(p, nowMs)).join('')}</details>`;
    };
    h += fold('temp', tr('app.proj.temp'), g.temp);
    if (!projects.length) h += `<p class="pl-empty">${esc(tr('app.proj.waiting'))}</p>`;
    h += archiveGroupHtml(archive, sel);
    body.innerHTML = h;
    body.scrollTop = scroll;

    // 좁은 화면: 칩 줄(전체 · live · recent · 선택된 것)
    const chipList = [...g.live, ...g.recent];
    if (sel.projectId && !chipList.some((p) => p.projectId === sel.projectId)) { const p = projects.find((x) => x.projectId === sel.projectId); if (p) chipList.push(p); }
    chips.innerHTML = `<button type="button" class="pl-chip${allOn ? ' on' : ''}" data-act="all">${esc(tr('app.proj.all'))}</button>` + chipList.map((p) => {
      const on = !allOn && sel.projectId === p.projectId;
      return `<button type="button" class="pl-chip${on ? ' on' : ''}" data-act="chip" data-pid="${esc(p.projectId)}" title="${esc(p.path || p.name)}"><i class="pl-dot sm ${dotOf(p)}" aria-hidden="true"></i>${esc(trunc(p.name || p.projectId, 18))}${on ? `<span class="pl-caret">${chipOpen ? '▴' : '▾'}</span>` : ''}</button>`;
    }).join('');
    const cp = sessions && !allOn && chipOpen ? projects.find((x) => x.projectId === sel.projectId) : null;
    chipSess.hidden = !cp;
    chipSess.innerHTML = cp ? sessionsHtml(cp, nowMs) : '';

    curEl.textContent = collapsed ? selectionLabel(sel, projects, archive) : '';
    el.classList.toggle('pl-disabled', disabled);
    el.title = disabled ? tr('app.proj.disabled') : '';
    body.setAttribute('aria-disabled', String(disabled));
  }

  function setCollapsed(c, save = false) {
    collapsed = !!c;
    el.classList.toggle('pl-collapsed', collapsed);
    foldBtn.setAttribute('aria-expanded', String(!collapsed));
    if (save) try { localStorage.setItem(LS_KEY, collapsed ? 'collapsed' : 'open'); } catch (e) { /* 저장소 없음 */ }
    render();
  }

  setCollapsed(collapsed);
  // 상대 시각 갱신(30초)
  const timer = setInterval(() => { if (!document.hidden) render(); }, 30000);

  return {
    setProjects(list) { projects = Array.isArray(list) ? list : []; if (sel.scope === 'session' && !sel.projectId) { const pid = findSessionProject(projects, sel.sessionId); if (pid) sel = { ...sel, projectId: pid }; } render(); },
    setSelection(next) {
      sel = next && next.scope ? { ...next } : { scope: 'all' };
      if (sel.scope === 'session' && !sel.projectId) sel.projectId = findSessionProject(projects, sel.sessionId);
      if (sel.scope === 'session' && sel.projectId) expanded = sel.projectId;
      if (sel.scope === 'project' && expanded && expanded !== sel.projectId) expanded = sel.projectId;
      if (sel.scope === 'all') { expanded = null; chipOpen = false; } // 전체로 돌아가면 세션 목록(패널·칩)을 접어 프로젝트 줄이 보이게
      render();
    },
    setDisabled(on) { disabled = !!on; render(); },
    setArchive(a) { archive = a && a.enabled ? a : null; render(); },
    get archive() { return archive; },
    setCollapsed: (c) => setCollapsed(c, true),
    get selection() { return { ...sel }; },
    get uiState() { return { expanded, chipOpen, openGroups: [...openGroups], forcedOpen: [...forcedOpen] }; }, // 시험용
    get projects() { return projects; },
    dispose() { clearInterval(timer); el.innerHTML = ''; el.classList.remove('pl', 'pl-collapsed', 'pl-disabled'); },
  };
}
