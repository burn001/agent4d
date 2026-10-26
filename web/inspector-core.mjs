// 객체 클릭 상세 팝업(인스펙터) — 순수 부분. DOM·three 없음, 시험은 web/test/inspector.test.mjs.
//  ① 종류·상태·설명(kindInfo·statusInfo), ② 노드별 최근 기록 장부(InspectBook: 도구 타임라인·출력 꼬리·특별 상호작용·말),
//  ③ 자식 집계·섬 요약, ④ 화면 배치(placeCard·sheetMode), ⑤ 자동 닫힘 판정(autoCloseReason).
import { isLauncher, isRunner, isCycle, isOrphanRoot, deviceInfo, deviceSummary, fmtDur } from './batch-core.mjs';
import { t as tr, fmtTime, fmtDateTime } from './i18n.mjs';
import { isJob, jobOf, jobInspect, jobStale, jobTags, jobFold, jobDisplayState, jobProgress, jobProgressText, isJobEndedState,
  procOf, procState, procJobId, jobLaneValues, jobHeat, heatLevel, jobEtaMs, fmtRate } from './job-core.mjs';

export const INSPECT = {
  TOOLS: 8,          // 노드당 최근 도구 호출
  TAIL: 6,           // 출력 꼬리 줄
  IX: 4,             // 노드당 특별 상호작용(범주별 최신)
  MAX_NODES: 800,    // 장부가 기억하는 노드 수(넘치면 오래된 것부터)
  IDLE_MS: 45000,    // 사용자 입력 없이 이만큼 지나면 닫음('따라가기' 켜면 안 닫음)
  SHEET_W: 640,      // 이 폭 이하 = 하단 시트
  GAP: 16,           // 객체와 카드 사이
  MARGIN: 10,        // 화면 가장자리 여백
  KIDS: 8,           // 자식 목록 최대
};

const metaOf = (n) => (n && n.meta) || {};
const tsOf = (x) => { if (typeof x === 'number') return x; const t = Date.parse(x || ''); return Number.isFinite(t) ? t : 0; };

/** 종류 → {key, icon, name, desc}. 기동기·러너·회차·독립 claude -p 는 kind 보다 앞선다 */
export function kindInfo(n) {
  const k = kindInfo0(n);
  const im = metaOf(n).inheritedFrom; // /clear 승계
  return im ? { ...k, desc: `${k.desc}${k.desc ? ' · ' : ''}${tr('cards.kind.inherited', { id: String(im).slice(0, 8) })}` } : k;
}

function kindInfo0(n) {
  const m = metaOf(n);
  if (!n) return { key: 'none', icon: '?', name: tr('cards.kind.none'), desc: '' };
  if (isJob(n)) return { key: 'job', icon: '◈', name: tr('cards.job.kind'), desc: tr('cards.job.desc') }; // 작업 노드(kind bash-bg + meta.job)
  if (isLauncher(n)) return { key: 'launcher', icon: '⚙', name: tr('cards.kind.launcher'), desc: tr('cards.kind.launcher.desc', { script: m.launcher && m.launcher.script ? ' (' + m.launcher.script + ')' : '' }) };
  if (isRunner(n)) return { key: 'runner', icon: '↻', name: tr('cards.kind.runner'), desc: tr('cards.kind.runner.desc', { script: m.runner && m.runner.script ? ' (' + m.runner.script + ')' : '' }) };
  if (isCycle(n)) return { key: 'cycle', icon: '▣', name: tr('cards.kind.cycle'), desc: tr('cards.kind.cycle.desc', { n: Number.isFinite(m.cycle) ? ' (#' + m.cycle + ')' : '' }) };
  if (isOrphanRoot(n)) return { key: 'orphan', icon: '▣', name: tr('cards.kind.cp'), desc: tr('cards.kind.orphan.desc') };
  switch (n.kind) {
    case 'main': return { key: 'main', icon: '◆', name: tr('cards.kind.main'), desc: tr('cards.kind.main.desc') };
    case 'subagent': return { key: 'subagent', icon: '●', name: tr('cards.kind.subagent'), desc: tr('cards.kind.subagent.desc', { type: m.agentType ? ' · ' + m.agentType : '', bg: m.background ? ' · ' + tr('cards.kind.bg') : '' }) };
    case 'workflow': return { key: 'workflow', icon: '◎', name: tr('cards.kind.workflow'), desc: tr('cards.kind.workflow.desc') };
    case 'workflow-agent': return { key: 'workflow-agent', icon: '◇', name: tr('cards.kind.wfAgent'), desc: tr('cards.kind.wfAgent.desc', { phase: m.phase ? ' · ' + m.phase : '' }) };
    case 'claude-p': return { key: 'claude-p', icon: '▣', name: tr('cards.kind.cp'), desc: tr('cards.kind.cp.desc') };
    case 'bash-bg': return { key: 'bash-bg', icon: '▭', name: tr('cards.kind.bashBg'), desc: tr('cards.kind.bashBg.desc') };
    case 'monitor': return { key: 'monitor', icon: '◬', name: 'Monitor', desc: tr('cards.kind.monitor.desc', { rearm: m.rearmCount ? ' · ' + tr('cards.tag.rearm', { n: m.rearmCount }) : '' }) };
    default: return { key: n.kind || 'other', icon: '•', name: n.kind || tr('cards.kind.other'), desc: '' };
  }
}

const ST = { active: 1, idle: 1, done: 1, error: 1, stopped: 1 }; // 아는 상태(라벨은 cards.st.*)
/** 상태 → {key, label}. 대기인데 하위가 작업 중이면 '대기 · 하위 작업 중' */
export function statusInfo(n, kids = null) {
  const s = (n && n.status) || 'idle';
  let label = ST[s] ? tr('cards.st.' + s) : s;
  if (s === 'idle' && kids && kids.active > 0) label = tr('cards.st.idleKids');
  return { key: ST[s] ? s : 'idle', label };
}

/** 경과 ms(끝났으면 시작～끝, 아니면 시작～지금) */
export function elapsedMs(n, nowMs) {
  const a = tsOf(n && n.startedAt);
  if (!a) return null;
  const b = n.endedAt ? tsOf(n.endedAt) : nowMs;
  return Math.max(0, b - a);
}
/** '3분 12초'·'2시간 4분'·'12초' */
export function fmtElapsed(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return tr('cards.t.s', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return `${tr('cards.t.m', { n: m })} ${tr('cards.t.s', { n: s % 60 })}`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${tr('cards.t.h', { n: h })} ${tr('cards.t.m', { n: m % 60 })}`;
  return `${tr('cards.t.d', { n: Math.floor(h / 24) })} ${tr('cards.t.h', { n: h % 24 })}`;
}
/** 짧은 소요 '820ms'·'4.2초'·'3분' */
export function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return Math.round(ms) + 'ms';
  if (ms < 60000) return tr('cards.t.s', { n: (ms / 1000).toFixed(ms < 10000 ? 1 : 0) });
  return fmtDur(ms);
}
/** '방금'·'12초 전'·'5분 전' */
export function fmtAgo(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  if (ms < 5000) return tr('cards.ago.now');
  if (ms < 60000) return tr('cards.ago.s', { n: Math.floor(ms / 1000) });
  if (ms < 3600e3) return tr('cards.ago.m', { n: Math.floor(ms / 60000) });
  if (ms < 86400e3) return tr('cards.ago.h', { n: Math.floor(ms / 3600e3) });
  return tr('cards.ago.d', { n: Math.floor(ms / 86400e3) });
}

/** 부모(분리 기동기는 띄운 노드 spawnedBy) */
export function parentIdOf(n) { return (n && (n.parentId || metaOf(n).spawnedBy)) || null; }

/** 자식 목록·집계. nodes = Map id → node. 분리 기동기(spawnedBy)도 자식으로 */
export function childrenOf(nodes, id) {
  const out = [];
  if (!nodes || !id) return out;
  for (const n of nodes.values()) if (n.id !== id && (n.parentId === id || (!n.parentId && metaOf(n).spawnedBy === id))) out.push(n);
  // 작업 중 → 대기 → 오류 → 끝, 같은 상태는 늦게 시작한 것 먼저
  const rank = { active: 0, idle: 1, error: 2, stopped: 3, done: 4 };
  out.sort((a, b) => (rank[a.status] ?? 1) - (rank[b.status] ?? 1) || tsOf(b.startedAt) - tsOf(a.startedAt));
  return out;
}
export function childStats(kids) {
  const s = { total: 0, active: 0, idle: 0, done: 0, error: 0, stopped: 0, kinds: {} };
  for (const k of kids || []) {
    s.total++;
    const st = ST[k.status] ? k.status : 'idle';
    s[st]++;
    const key = kindInfo(k).name;
    s.kinds[key] = (s.kinds[key] || 0) + 1;
  }
  return s;
}
/** '서브에이전트 5개 중 작업 중 2 · 끝 2 · 오류 1' (종류가 섞이면 '하위 n개') */
export function childLine(s) {
  if (!s || !s.total) return '';
  const ks = Object.keys(s.kinds);
  const head = ks.length === 1 ? tr('cards.kids.one', { kind: ks[0], n: s.total }) : tr('cards.kids.many', { n: s.total });
  const p = [];
  for (const k of ['active', 'idle', 'done', 'stopped', 'error']) if (s[k]) p.push(tr('cards.kids.' + k, { n: s[k] }));
  return p.length ? tr('cards.kids.line', { head, parts: p.join(' · ') }) : head;
}

/** 지금 하는 일: 열린 도구(가장 최근) → brief → 마지막 말 */
export function nowDoing(n, book = null) {
  const ot = (n && n.openTools) || [];
  const m = metaOf(n);
  if (ot.length) {
    const t = ot[ot.length - 1];
    return { tool: t.tool || '', text: t.brief || t.text || '', more: ot.length - 1 };
  }
  const say = book ? book.say(n.id) : null;
  if (m.brief) return { tool: '', text: typeof m.brief === 'string' ? m.brief : (m.brief.text || ''), more: 0 };
  if (say) return { tool: '', text: say, more: 0 };
  return null;
}

/**
 * 노드별 최근 기록 장부. app.js 의 onEvent 가 모든 이벤트를 넣는다(라이브·재생 같은 경로 — 재생이면 재생 시점 기준).
 * 스냅샷(재연결·재생 시크)에는 reset 후 recent 를 다시 넣는다.
 */
export class InspectBook {
  constructor(o = {}) {
    this.toolsMax = o.tools || INSPECT.TOOLS;
    this.tailMax = o.tail || INSPECT.TAIL;
    this.maxNodes = o.maxNodes || INSPECT.MAX_NODES;
    this.m = new Map(); // id → {tools:[], tail:[], tailTitle, ix:Map, say, at}
    this.ver = 0;
  }
  reset() { this.m.clear(); this.ver++; }
  _e(id) {
    let e = this.m.get(id);
    if (e) { this.m.delete(id); this.m.set(id, e); return e; } // 최근 사용을 뒤로(LRU)
    e = { tools: [], tail: [], tailTitle: '', ix: new Map(), say: '' };
    this.m.set(id, e);
    if (this.m.size > this.maxNodes) this.m.delete(this.m.keys().next().value);
    return e;
  }
  /** @returns {string|null} 바뀐 노드 id */
  event(ev) {
    if (!ev || !ev.nodeId) return null;
    const id = ev.nodeId;
    const t = tsOf(ev.ts);
    let hit = false;
    switch (ev.type) {
      case 'tool-start': {
        const e = this._e(id);
        if (ev.toolUseId && e.tools.some((x) => x.id === ev.toolUseId)) break;
        e.tools.push({ id: ev.toolUseId || null, tool: ev.tool || '', cat: ev.cat || 'other', text: ev.text || '', t0: t, ok: null, ms: null, res: '' });
        if (e.tools.length > this.toolsMax) e.tools.splice(0, e.tools.length - this.toolsMax);
        hit = true;
        break;
      }
      case 'tool-end': {
        const e = this._e(id);
        let x = ev.toolUseId ? e.tools.find((y) => y.id === ev.toolUseId) : null;
        if (!x) { // 시작을 못 본 호출(장부가 열린 뒤 끝만 옴)
          x = { id: ev.toolUseId || null, tool: ev.tool || '', cat: ev.cat || 'other', text: '', t0: null, ok: null, ms: null, res: '' };
          e.tools.push(x);
          if (e.tools.length > this.toolsMax) e.tools.splice(0, e.tools.length - this.toolsMax);
        }
        x.ok = ev.ok !== false;
        x.ms = Number.isFinite(ev.durationMs) ? ev.durationMs : (x.t0 && t ? t - x.t0 : null);
        x.res = ev.text || '';
        if (ev.panel && Array.isArray(ev.panel.lines) && ev.panel.lines.length) this._tail(e, ev.panel);
        hit = true;
        break;
      }
      case 'output': {
        const e = this._e(id);
        if (ev.panel && Array.isArray(ev.panel.lines)) this._tail(e, ev.panel);
        else if (ev.text) {
          const ls = String(ev.text).split(/\r?\n/).filter((s) => s.trim());
          e.tail = e.tail.concat(ls).slice(-this.tailMax);
        }
        // 백그라운드 출력의 주인(ref) 노드에도 같은 꼬리
        if (ev.panel && ev.panel.ref && ev.panel.ref.nodeId && ev.panel.ref.nodeId !== id) this._tail(this._e(ev.panel.ref.nodeId), ev.panel);
        hit = true;
        break;
      }
      case 'text':
        if (ev.role === 'assistant' && ev.text) { this._e(id).say = String(ev.text).replace(/\s+/g, ' ').trim().slice(0, 200); hit = true; }
        break;
      case 'result':
        if (ev.text) { this._e(id).say = String(ev.text).replace(/\s+/g, ' ').trim().slice(0, 200); hit = true; }
        break;
    }
    // 특별 상호작용(서버 ix): 범주별 최신 하나. 모르는 모양은 그대로 들고만 있다
    if (ev.ix && typeof ev.ix === 'object' && ev.ix.cat) {
      const e = this._e(id);
      e.ix.set(ev.ix.cat, { ...ev.ix, at: t });
      if (e.ix.size > INSPECT.IX) e.ix.delete(e.ix.keys().next().value);
      hit = true;
    }
    if (hit) this.ver++;
    return hit ? id : null;
  }
  _tail(e, p) {
    e.tail = p.lines.map((s) => String(s)).slice(-this.tailMax);
    e.tailTitle = p.title || '';
  }
  tools(id) { const e = this.m.get(id); return e ? e.tools : []; }
  tail(id) { const e = this.m.get(id); return e ? { title: e.tailTitle, lines: e.tail } : { title: '', lines: [] }; }
  ix(id) { const e = this.m.get(id); return e ? [...e.ix.values()] : []; }
  say(id) { const e = this.m.get(id); return e ? e.say : ''; }
}

/** 특별 상호작용 느슨한 요약(ix-core 가 없을 때): 범주 + op + 눈에 띄는 수 */
export function ixLoose(ix) {
  if (!ix || !ix.cat) return '';
  const p = [ix.op || ''];
  if (ix.cat === 'tests' && (ix.pass != null || ix.fail != null)) p.push(`✓${ix.pass || 0}${ix.fail ? ' ✗' + ix.fail : ''}`);
  if (ix.commits) p.push(`${ix.commits} commits`);
  if (ix.host) p.push(ix.host);
  if (ix.db) p.push(ix.db);
  if (ix.n) p.push(`${ix.i ?? 0}/${ix.n}`);
  return p.filter(Boolean).join(' ') || ix.cat;
}

/** 기동기·러너 요약: deviceInfo + 마지막 끝 사유 + 미니 막대(최근 회차) */
export function deviceModel(n, nodes, nowMs) {
  const info = deviceInfo(n, nodes);
  const b = metaOf(n).batch || {};
  const recent = Array.isArray(b.recent) ? b.recent : [];
  let lastEnd = null;
  for (let i = recent.length - 1; i >= 0; i--) {
    const r = recent[i];
    const st = (r.nodeId && nodes && nodes.get(r.nodeId) ? nodes.get(r.nodeId).status : r.status);
    if (st && st !== 'active' && st !== 'idle') { lastEnd = { status: st, label: ST[st] ? tr('cards.st.' + st) : st, endedAt: r.endedAt || null }; break; }
  }
  const bars = recent.map((r) => {
    const st = (r.nodeId && nodes && nodes.get(r.nodeId) ? nodes.get(r.nodeId).status : r.status) || 'idle';
    const a = tsOf(r.startedAt), z = r.endedAt ? tsOf(r.endedAt) : nowMs;
    return { status: st, ms: a ? Math.max(0, z - a) : null, nodeId: r.nodeId || null };
  });
  const cur = info.currentId && nodes ? nodes.get(info.currentId) : null;
  return { info, summary: deviceSummary(info), lastEnd, bars, current: cur ? { id: cur.id, label: cur.label || cur.id, ms: elapsedMs(cur, nowMs) } : null };
}
/** 막대 높이 비율(가장 긴 회차 = 1, 소요 모름 = 0.25) */
export function barHeights(bars) {
  const mx = Math.max(1, ...bars.map((b) => b.ms || 0));
  return bars.map((b) => (b.ms ? Math.max(0.12, b.ms / mx) : 0.25));
}

/** 섬(프로젝트) 요약 */
export function islandModel(project, pid, nodes, nowMs) {
  let total = 0, active = 0, last = 0;
  const mains = [];
  for (const n of (nodes ? nodes.values() : [])) {
    if (n.projectId !== pid) continue;
    total++;
    if (n.status === 'active') active++;
    const t = tsOf(n.lastActivityAt);
    if (t > last) last = t;
    if (n.kind === 'main' && !n.parentId) mains.push(n);
  }
  const p = project || {};
  const lastAt = Math.max(last, tsOf(p.lastActivityAt));
  return {
    name: p.name || pid || tr('cards.project'),
    path: p.path || '',
    liveSessions: Number.isFinite(p.liveSessions) ? p.liveSessions : mains.filter((m) => m.status !== 'done').length,
    busySessions: Number.isFinite(p.busySessions) ? p.busySessions : null,
    sessions: Number.isFinite(p.sessions) ? p.sessions : null,
    nodes: total, active,
    lastAgo: lastAt ? fmtAgo(Math.max(0, nowMs - lastAt)) : '',
    mains: mains.map((m) => m.id),
  };
}
/** 한도 한 줄: '계정 한도 5시간 18% · 7일 22%' */
export function limitsLine(l) {
  if (!l || !l.ok) return '';
  const p = [];
  if (l.five_hour && Number.isFinite(l.five_hour.pct)) p.push(tr('cards.lim.5h', { p: Math.round(l.five_hour.pct) }));
  if (l.seven_day && Number.isFinite(l.seven_day.pct)) p.push(tr('cards.lim.7d', { p: Math.round(l.seven_day.pct) }));
  return p.length ? `${tr('cards.lim.line', { parts: p.join(' · ') })}${l.stale ? ` (${tr('cards.lim.stale')})` : ''}` : '';
}

// ---------- 작업(Job) 노드 ----------
/** 표시 상태 → 상태 점·막대·배지 색 이름(inspector.css 의 .jd-<값>) */
export const JOB_DISP = ['queued', 'running', 'waiting', 'done', 'failed', 'stale'];

/** 출처 글: 'protocol' → 규약 줄 · 'rule:<묶음>' → 규칙 묶음 이름 */
export function jobSrcText(src) {
  if (!src) return '';
  if (src === 'protocol') return tr('cards.job.src.protocol');
  if (src === 'auto') return tr('cards.job.src.auto'); // 진행 줄 자동 인식
  if (String(src).startsWith('rule:')) return tr('cards.job.src.rule', { name: String(src).slice(5) });
  return String(src);
}

/**
 * 작업 노드 인스펙터 내용(job-core jobInspect 를 화면 글로): 머리 배지(정체면 '정체 N분' + warn) · 행(상대 시간·재확인 남은 시간·출처 이름) · 마지막 줄.
 * 시계(nowMs)는 렌더러 시계(재생이면 가상 시계)를 그대로 받는다
 * @returns {{title, id, display, stale, warn, badge, rows:[{key,label,value,title,ratio?}], line, progress, startedAt, endedAt, ended}|null}
 */
export function jobCardModel(n, nowMs) {
  const m = jobInspect(n, nowMs);
  if (!m) return null;
  const job = jobOf(n);
  const st = jobStale(job, nowMs);
  const badge = st.stale ? jobTags(job, nowMs)[0] : tr('cards.job.' + (JOB_DISP.includes(job.state) ? job.state : 'running'));
  const rows = m.rows.map(([key, v]) => {
    const r = { key, label: tr('cards.job.r.' + key), value: String(v ?? ''), title: '' };
    if (key === 'beat') {
      const t = tsOf(v);
      if (t) { r.value = fmtAgo(Math.max(0, nowMs - t)); r.title = fmtDateTime(t, { seconds: true }); }
    } else if (key === 'until') {
      const t = tsOf(v);
      if (t) {
        const d = t - nowMs;
        r.value = `${fmtTime(t)} · ${tr(d >= 0 ? 'cards.job.in' : 'cards.job.over', { t: fmtDur(Math.max(1000, Math.abs(d))) })}`;
        r.title = fmtDateTime(t, { seconds: true });
      }
    } else if (key === 'src') { r.value = jobSrcText(v); r.title = String(v); }
    else if (key === 'progress') r.ratio = m.progress;
    return r;
  });
  return {
    title: m.title, id: m.id, display: m.display, stale: m.stale, warn: m.stale, badge, rows,
    line: m.line, progress: m.progress, startedAt: m.startedAt || null, endedAt: m.endedAt || null, ended: isJobEndedState(job.state), summary: m.summary,
  };
}

/**
 * 주인 노드(백그라운드 명령·Monitor·러너/기동기·메인) 아래 작업 목록 요약: 작업마다 한 줄(상태 점·제목·단계·진행).
 * 끝난 작업 접기는 jobFold 와 같은 규칙(최근 3개만 보이고 나머지는 hidden 수).
 * 순서: 끝나지 않은 것(시작 순) → 끝난 것(최근 끝난 것 먼저)
 * @param nodes Map id → node
 * @returns {{items:[{id,title,display,phase,progress,ratio}], hidden:number, total:number}|null} 작업이 없으면 null
 */
export function ownerJobsModel(nodes, ownerId, nowMs) {
  if (!nodes || !ownerId) return null;
  const mine = new Map();
  for (const k of nodes.values()) if (k.parentId === ownerId && isJob(k)) mine.set(k.id, k);
  if (!mine.size) return null;
  const { hidden } = jobFold(mine);
  const vis = [...mine.values()].filter((k) => !hidden.has(k.id));
  const endT = (k) => tsOf(jobOf(k).endedAt || k.endedAt);
  const live = vis.filter((k) => !isJobEndedState(jobOf(k).state)).sort((a, b) => tsOf(jobOf(a).startedAt || a.startedAt) - tsOf(jobOf(b).startedAt || b.startedAt) || (a.id < b.id ? -1 : 1));
  const ended = vis.filter((k) => isJobEndedState(jobOf(k).state)).sort((a, b) => endT(b) - endT(a) || (a.id < b.id ? -1 : 1));
  const items = live.concat(ended).map((k) => {
    const j = jobOf(k);
    return { id: k.id, title: j.title || j.id || k.label || k.id, display: jobDisplayState(j, nowMs), phase: j.phase || '', progress: jobProgressText(j), ratio: jobProgress(j) };
  });
  return { items, hidden: hidden.size, total: mine.size };
}

/** 좁은 화면이면 하단 시트 */
export const sheetMode = (W) => W <= INSPECT.SHEET_W;

/**
 * 카드 자리: 객체(화면 원 ax, ay, ar) 옆 — 오른쪽 → 왼쪽 → 아래 → 위, 그다음 범위 안으로 밀어 넣는다.
 * bounds = {left, top, right, bottom} (패널·상단 바·하단 띠를 뺀 무대 안쪽)
 * @returns {{x, y, side, off}} 카드 왼쪽 위
 */
export function placeCard(a, size, bounds, gap = INSPECT.GAP) {
  const { w, h } = size;
  const L = bounds.left + INSPECT.MARGIN, T = bounds.top + INSPECT.MARGIN, R = bounds.right - INSPECT.MARGIN, B = bounds.bottom - INSPECT.MARGIN;
  const r = Math.max(4, a.r || 0);
  const off = !(a.x >= bounds.left && a.x <= bounds.right && a.y >= bounds.top && a.y <= bounds.bottom);
  const yMid = a.y - h * 0.35;
  const cands = [
    { side: 'right', x: a.x + r + gap, y: yMid },
    { side: 'left', x: a.x - r - gap - w, y: yMid },
    { side: 'below', x: a.x - w / 2, y: a.y + r + gap },
    { side: 'above', x: a.x - w / 2, y: a.y - r - gap - h },
  ];
  const fits = (c) => c.x >= L && c.x + w <= R;
  const fitsV = (c) => c.y >= T && c.y + h <= B;
  let pick = cands.find((c) => (c.side === 'right' || c.side === 'left') && fits(c))
    || cands.find((c) => fits(c) && fitsV(c)) || cands[0];
  const clamp = (v, lo, hi) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));
  return { x: clamp(pick.x, L, R - w), y: clamp(pick.y, T, B - h), side: pick.side, off };
}

/**
 * 자동 닫힘 사유(없으면 null): 대상이 사라짐(gone) · 입력 없음(idle, 따라가기 켜면 안 닫음)
 * s = {now, lastInput, follow, present, idleMs}
 */
export function autoCloseReason(s) {
  if (!s.present) return 'gone';
  if (!s.follow && s.now - s.lastInput >= (s.idleMs || INSPECT.IDLE_MS)) return 'idle';
  return null;
}

/** 대상 키(같은 대상인지 비교) */
export const targetKey = (t) => (!t ? '' : t.type === 'cluster' ? 'c:' + t.pid : t.type === 'artifact' ? 'a:' + t.pid + '|' + t.id : t.type === 'plan' ? 'p:' + t.id : t.type === 'console' ? 'u:' + t.id : 'n:' + t.id); // 대상 · 계획 보드(메인 id) · 사용자 콘솔(메인 id)

/** 위치 보간(지수 감쇠) — 프레임 dt 초 */
export function easeToward(cur, want, dt, rate = 14) {
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  return cur + (want - cur) * k;
}

// ---------- 분리 프로세스 · 진행 레인 표(세 표현 공용 카드 — 숫자는 job-core 공용 함수 그대로) ----------
const cnt = (v) => Math.floor(Math.max(0, Number(v) || 0)).toLocaleString('en-US');
/**
 * 진행 레인 표: 레인마다 [열쇠 · 값(보간, /total, 단위) · 처리율 · 최장 · 과열] + 작업 전체 처리율·과열 단계·남은 시간.
 * 레인이 없으면 null.
 * @returns {{rows:[{key, value, unit, total, ratio, rate, last, heat, level, pass}], rate, heat, level, etaMs, etaText}|null}
 */
export function laneTableModel(job, nowMs) {
  const lanes = jobLaneValues(job, nowMs);
  if (!lanes.length) return null;
  const rows = lanes.map((l) => ({
    key: String(l.key), value: cnt(l.value) + (Number(l.total) > 0 ? '/' + cnt(l.total) : ''), unit: l.unit || '', total: l.total ?? null,
    ratio: l.ratio, rate: fmtRate(l.rate), last: l.last ? `${l.last.v}${l.last.u || ''}` : '', heat: Math.round((l.heat || 0) * 100) / 100, level: heatLevel(l.heat || 0),
    pass: l.pass > 1 ? tr('cards.lane.pass', { n: l.pass }) : '',
  }));
  const heat = jobHeat(job), etaMs = jobEtaMs(job, nowMs);
  return { rows, rate: job && job.rate > 0 ? fmtRate(job.rate) : '', heat: Math.round(heat * 100) / 100, level: heatLevel(heat), etaMs,
    etaText: etaMs != null && !isJobEndedState(job.state) ? tr('cards.lane.eta', { t: fmtDur(Math.max(1000, etaMs)) }) : '' };
}

/**
 * 분리 프로세스 노드 카드: 상태 · 프로그램(스크립트) · 떼어 띄운 방식 · 로그 경로(서버가 마스킹한 그대로) · 들여다봄 횟수(마지막 상대 시간) · 끝난 까닭·rc
 * + 그 자동 진행 작업의 레인 표·마지막 진행 줄. 프로세스가 아니면 null.
 * @param nodes Map id → node
 */
export function procCardModel(n, nodes, nowMs) {
  const p = procOf(n);
  if (!p) return null;
  const st = procState(n);
  const rows = [];
  rows.push({ key: 'state', label: tr('cards.proc.r.state'), value: tr('cards.proc.st.' + st), title: '' });
  const prog = [p.prog, p.script].filter(Boolean).join(' · ');
  if (prog) rows.push({ key: 'prog', label: tr('cards.proc.r.prog'), value: prog, title: p.cmd || '' });
  if (p.via) rows.push({ key: 'via', label: tr('cards.proc.r.via'), value: String(p.via), title: '' });
  if (p.log) rows.push({ key: 'log', label: tr('cards.proc.r.log'), value: String(p.log), title: String(p.log), mono: true });
  if (p.watchCount > 0) {
    const lw = tsOf(p.lastWatchAt);
    rows.push({ key: 'watch', label: tr('cards.proc.r.watch'), value: tr('cards.proc.watchN', { n: p.watchCount, t: lw ? fmtAgo(Math.max(0, nowMs - lw)) : '' }), title: lw ? fmtDateTime(lw, { seconds: true }) : '' });
  }
  if (p.endReason || p.rc != null) {
    const why = p.endReason ? tr('cards.proc.end.' + p.endReason) : '';
    rows.push({ key: 'end', label: tr('cards.proc.r.end'), value: [why, p.rc != null ? `rc ${p.rc}` : ''].filter(Boolean).join(' · '), title: '' });
  }
  const jn = nodes && nodes.get ? nodes.get(procJobId(n)) : null;
  const job = jn ? jobOf(jn) : null;
  return { state: st, rows, lanes: job ? laneTableModel(job, nowMs) : null, line: job && job.line ? job.line : '', jobId: jn ? jn.id : null };
}
