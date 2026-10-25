// 계획 보드 — transcript 의 계획 출처를 한 모델로 정규화한다.
// 출처: TodoWrite · Task 계열(TaskCreate·TaskUpdate) · ExitPlanMode 계획 본문 · 체크박스 계획 파일(md 의 - [ ]/- [x]) ·
//       단계 설계서(자율 러너 설계서의 `**단계 N 상태**` 표식 줄) · Workflow 스크립트 meta.phases.
// 결과는 소유 노드의 meta.plans(node-update) 로 낸다 — 라이브 SSE·재생(/replay)·보관함 재생이 같은 그래프 이벤트를 쓴다.
// 순수 파서 + PlanTracker(런타임 하나에 하나, 그래프에 node-update 를 냄). 읽기 전용(디스크의 계획 파일을 읽지 않음 — 기록만).
import path from 'node:path';
import { redact } from './redact.mjs';

export const PLAN = {
  ITEMS: 40,        // 계획 하나의 항목 상한(넘치면 앞에서부터, n 에 전체 수)
  TEXT: 120,        // 항목 글 상한
  TITLE: 80,        // 계획 제목 상한
  PER_NODE: 3,      // 노드 하나가 가진 계획 상한(최근 갱신순)
  DOC_MAX: 512 * 1024, // 문서 본문 기억 상한(Edit 을 온전한 본문에 적용하려고)
  DOCS: 24,         // 기억하는 문서 수(LRU)
};

export const PLAN_SRC = ['todo', 'tasks', 'exitplan', 'file', 'phases', 'workflow'];
const STATUS = new Set(['pending', 'in_progress', 'done']);

/** FNV-1a 32비트 → 16진 n자(web/artifact-core.mjs artHash 와 같은 값) */
export function planHash(s, n = 6) {
  let h = 0x811c9dc5;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0').slice(0, n);
}

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
/** 항목 글 → 비교용 열쇠(마크다운 강조·링크·코드표·끝 공백 정리, 소문자) */
export function itemKey(t) {
  return String(t ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_~]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
/** 마크다운 꾸밈을 걷어 표시 글로 */
function plainText(t) {
  return String(t ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/~~([^~]+)~~/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();
}

/** TodoWrite·Task 상태 → 모델 상태 */
export function normStatus(s) {
  const v = String(s ?? '').toLowerCase();
  if (v === 'completed' || v === 'done' || v === 'complete') return 'done';
  if (v === 'in_progress' || v === 'in-progress' || v === 'active' || v === 'running') return 'in_progress';
  return 'pending';
}

// ── 마크다운 계획 파서 ──
const CB_RE = /^\s{0,12}(?:[-*+]|\d{1,3}[.)])\s+\[([ xX~\-/>✓✔])\]\s+(.+?)\s*$/;
// 단계 설계서: 제목 `### 단계 3 — 배포 …`(또는 Phase 3: …), 표식 `**단계 3 상태**: ✅ **닫힘** …`
const PH_HEAD_RE = /^#{2,5}\s*(?:단계|Phase|PHASE|Step|STEP)\s*(\d{1,3})\s*(?:[—–\-:.·]\s*(.*))?$/;
const PH_STAT_RE = /^\s*\*\*(?:단계|Phase|PHASE|Step|STEP)\s*(\d{1,3})\s*(?:상태|status|Status)\*\*\s*[:：]?\s*(.*)$/;

/** 단계 표식 줄의 상태 글 → {s, hold} (✅ 닫힘 = done, ⏸ = 보류(아직 안 끝남, hold), 진행 표지 = in_progress, 나머지 pending) */
export function phaseStatus(txt) {
  const t = String(txt ?? '');
  if (/✅|☑|✔|\b(?:done|closed|complete[d]?)\b|닫힘|완료|착지(?!\s*전)(?!하지)/.test(t) && !/미착지|미완/.test(t)) return { s: 'done' };
  if (/⏸|보류|외부 대기|on hold/i.test(t)) return { s: 'pending', hold: 1 };
  if (/🔧|◐|진행\s*중|진행 ?중|착수|in[ _-]?progress|WIP/i.test(t)) return { s: 'in_progress' };
  return { s: 'pending' };
}

function cbStatus(c) {
  if (c === 'x' || c === 'X' || c === '✓' || c === '✔') return 'done';
  if (c === '~' || c === '-' || c === '/' || c === '>') return 'in_progress';
  return 'pending';
}

/**
 * 마크다운 본문 → 계획 {kind:'phases'|'checkbox', title, items:[{k, t, s, hold?}]} 또는 null.
 * 단계 표식 줄이 하나라도 있으면 단계 설계서(표식 줄만 항목 — 러너가 미착지 단계를 세는 규칙과 같음), 아니면 체크박스 2개 이상.
 * opts.min: 체크박스 최소 수(기본 2, 바뀐 줄만 볼 때 1).
 * opts.loose: ExitPlanMode 계획 본문 — 체크박스·단계가 없으면 맨 바깥 번호 목록, 그것도 없으면 ##/### 제목을 항목으로(모두 pending).
 */
export function parsePlanMarkdown(text, opts = {}) {
  if (typeof text !== 'string' || !text) return null;
  const lines = text.split(/\r?\n/);
  let title = '';
  const heads = new Map(); const stats = []; const cbs = []; const nums = []; const h2 = [];
  let fence = false;
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) { fence = !fence; continue; }
    if (fence) continue;
    if (!title) { const m = /^#\s+(.+)$/.exec(raw); if (m) title = plainText(m[1]); }
    let m = PH_HEAD_RE.exec(raw);
    if (m) { if (!heads.has(m[1])) heads.set(m[1], plainText(m[2] || '')); continue; }
    m = PH_STAT_RE.exec(raw);
    if (m) { stats.push([m[1], m[2]]); continue; }
    m = CB_RE.exec(raw);
    if (m) { cbs.push([m[1], m[2]]); continue; }
    if (opts.loose) {
      m = /^(\d{1,3})[.)]\s+(.+)$/.exec(raw); // 맨 바깥 번호 목록(들여쓰기 없음)
      if (m) { nums.push(m[2]); continue; }
      m = /^#{2,3}\s+(.+)$/.exec(raw);
      if (m) h2.push(m[1]);
    }
  }
  const done = (kind, items) => (items.length ? { kind, title: clip(title, PLAN.TITLE), items: dedupe(items) } : null);
  if (stats.length) {
    const seen = new Set(), items = [];
    for (const [n, st] of stats) {
      if (seen.has(n)) continue; seen.add(n);
      const ps = phaseStatus(st);
      const name = heads.get(n);
      items.push({ k: `단계 ${n}`, t: clip(`단계 ${n}${name ? ' — ' + name : ''}`, PLAN.TEXT), s: ps.s, ...(ps.hold ? { hold: 1 } : {}) });
    }
    return done('phases', items);
  }
  if (cbs.length >= (opts.min ?? (opts.loose ? 1 : 2))) return done('checkbox', cbs.map(([c, t]) => ({ k: itemKey(t), t: clip(plainText(t), PLAN.TEXT), s: cbStatus(c) })));
  if (opts.loose) {
    const src = nums.length >= 2 ? nums : h2.filter((h) => !/^(?:개요|요약|배경|context|summary|overview|목표|goal|risks?|위험|검증|verification|testing)(?:\s|$|[:(])/i.test(h.trim()));
    if (src.length) return done('checkbox', src.map((t) => ({ k: itemKey(t), t: clip(plainText(t), PLAN.TEXT), s: 'pending' })));
  }
  return null;
}

/** 같은 열쇠가 여러 번이면 #2·#3 을 붙여 가른다 */
function dedupe(items) {
  const c = new Map();
  for (const it of items) {
    const n = (c.get(it.k) || 0) + 1; c.set(it.k, n);
    if (n > 1) it.k = `${it.k}#${n}`;
  }
  return items;
}

/** Workflow 스크립트 → meta.phases 제목들(없으면 []) */
export function workflowPhases(script) {
  if (typeof script !== 'string') return [];
  const i = script.search(/\bphases\s*:\s*\[/);
  if (i < 0) return [];
  // 대괄호 짝 맞추기(문자열 안 괄호는 대충 무시 — 제목만 뽑으면 됨)
  let depth = 0, j = script.indexOf('[', i), end = -1;
  for (let k = j; k < script.length && k < j + 20000; k++) {
    const ch = script[k];
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { end = k; break; } }
  }
  const body = script.slice(j, end > 0 ? end : j + 20000);
  const out = [];
  const re = /\btitle\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  let m;
  while ((m = re.exec(body)) && out.length < PLAN.ITEMS) out.push(m[2].replace(/\\(.)/g, '$1'));
  return out;
}

/** 계획 파일 제목: 파일 이름, 흔한 이름(_STATUS.md·README.md …)이면 윗 폴더/이름 */
export function planTitleOf(fp) {
  const parts = String(fp || '').replace(/\\/g, '/').split('/').filter(Boolean);
  const base = parts.pop() || '';
  if (/^(?:_?status|readme|todo|plans?|claude|notes?|tasks?|checklist|backlog)\.(?:md|markdown|mdx)$/i.test(base) && parts.length) return parts.pop() + '/' + base;
  return base;
}

const isMd = (p) => /\.(md|markdown|mdx)$/i.test(String(p || ''));

/**
 * 도구 호출 시작 → 계획 서술자(끝에서 PlanTracker.end 가 씀) 또는 null.
 * 큰 본문은 여기서 파싱하거나 상한까지만 잡는다(도구 호출 기억에 원문 전체를 두지 않음).
 */
export function planStart(name, input, { cwd } = {}) {
  if (!input || typeof input !== 'object') return null;
  const fileKey = (fp) => {
    const s = String(fp || '');
    if (!s) return null;
    const abs = /^([A-Za-z]:[\\/]|[\\/])/.test(s) || !cwd ? s : path.join(cwd, s);
    return { key: abs.replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').toLowerCase(), base: planTitleOf(abs) };
  };
  switch (name) {
    case 'TodoWrite': {
      const t = Array.isArray(input.todos) ? input.todos : null;
      if (!t) return null;
      return { src: 'todo', items: t.slice(0, 200).map((x) => ({ t: String((x && (x.content || x.subject || x.activeForm)) || ''), s: normStatus(x && x.status) })).filter((x) => x.t) };
    }
    case 'TaskCreate':
      return { src: 'tasks', op: 'create', t: String(input.subject || input.title || input.description || '').slice(0, 400), s: normStatus(input.status) };
    case 'TaskUpdate': {
      const id = input.taskId ?? input.task_id ?? input.id;
      if (id == null) return null;
      return { src: 'tasks', op: 'update', id: String(id), s: input.status ? String(input.status) : null, t: input.subject ? String(input.subject).slice(0, 400) : null };
    }
    case 'ExitPlanMode': {
      const p = parsePlanMarkdown(typeof input.plan === 'string' ? input.plan.slice(0, PLAN.DOC_MAX) : '', { loose: true });
      return p ? { src: 'exitplan', parsed: p } : null;
    }
    case 'Workflow': {
      const ph = workflowPhases(input.script);
      return ph.length ? { src: 'workflow', phases: ph } : null;
    }
    case 'Write': {
      if (!isMd(input.file_path)) return null;
      const f = fileKey(input.file_path); if (!f) return null;
      const text = typeof input.content === 'string' ? input.content : '';
      return { src: 'file', op: 'write', ...f, text: text.length > PLAN.DOC_MAX ? null : text };
    }
    case 'Edit': {
      if (!isMd(input.file_path)) return null;
      const f = fileKey(input.file_path); if (!f) return null;
      const o = String(input.old_string ?? ''), nw = String(input.new_string ?? '');
      if (o.length + nw.length > PLAN.DOC_MAX) return { src: 'file', op: 'edit', ...f, edits: null };
      return { src: 'file', op: 'edit', ...f, edits: [{ o, n: nw, all: !!input.replace_all }] };
    }
    case 'MultiEdit': {
      if (!isMd(input.file_path)) return null;
      const f = fileKey(input.file_path); if (!f) return null;
      const ed = Array.isArray(input.edits) ? input.edits : [];
      return { src: 'file', op: 'edit', ...f, edits: ed.slice(0, 50).map((e) => ({ o: String(e?.old_string ?? ''), n: String(e?.new_string ?? ''), all: !!e?.replace_all })) };
    }
    case 'Bash': case 'PowerShell': {
      // 셸로 계획 md 를 본 결과(grep -n '단계 . 상태' …·sed -n·cat) — 표식·체크박스 줄로 상태를 고침, 쓰는 명령이면 기억한 본문을 버림
      const cmd = typeof input.command === 'string' ? input.command.slice(0, 20000) : '';
      const toks = [...new Set((cmd.match(/[^\s'"`;|&<>()=]+\.(?:md|markdown)\b/gi) || []))].slice(0, 6);
      if (!toks.length) return null;
      const files = toks.map(fileKey).filter(Boolean);
      const writes = /\bsed\s+-i|\btee\b|\bpython|\bperl\b|\bnode\s|Set-Content|Out-File|Add-Content|>>?\s*\S*\.(?:md|markdown)\b|\bmv\s|\bcp\s|\bgit\s+(?:checkout|restore|pull|merge|rebase|stash|reset)\b/.test(cmd);
      return { src: 'shell', files, writes };
    }
    case 'Read': {
      if (!isMd(input.file_path)) return null;
      const f = fileKey(input.file_path); if (!f) return null;
      return { src: 'file', op: 'read', ...f };
    }
    default: return null;
  }
}

function applyEdits(text, edits) {
  let t = text;
  for (const e of edits) {
    if (!e.o) return null;
    if (!t.includes(e.o)) return null;
    t = e.all ? t.split(e.o).join(e.n) : t.replace(e.o, () => e.n);
  }
  return t;
}

/**
 * 런타임(RootRuntime) 하나의 계획 장부. 계획을 열쇠로 기억하고, 바뀌면 소유 노드의 meta.plans 를 node-update 로 낸다.
 * 기록은 파일마다 차례로 읽혀(메인 → 서브에이전트 → 회차) 시각순이 아니다 → 항목마다 '마지막으로 본 시각'(seen)으로
 * 나중 시각의 관찰이 이긴다(늦게 읽힌 옛 관찰이 새 상태를 덮지 않음). 최종 상태는 읽는 순서와 무관(라이브·재생·보관함 같은 답).
 */
export class PlanTracker {
  constructor({ graph }) {
    this.g = graph;
    this.plans = new Map();   // planKey → {key, id, src, title, doc, owner, ownerT, strong, at, by, cy, byT, items: Map<k,{k,t,s,at,by,cy,hold,seen}>, order:[k], gone: Map<k, seen>}
    this.docs = new Map();    // 파일 열쇠 → {text, ctx}(LRU)
    this.taskOf = new Map();  // task id → planKey
    this.wf = new Map();      // workflow 노드 id → {phases:[], seen: Map<lower title, ts>, ended: null|'ok'|'fail'}
    this.taskSeq = 0;
    this.emitT = new Map();   // 소유 노드 → 마지막으로 낸 시각
  }

  // ── 노드 관계 ──
  _anc(id, pred) {
    let cur = this.g.get(id);
    for (let i = 0; cur && i < 64; i++) {
      if (pred(cur)) return cur;
      cur = cur.parentId ? this.g.get(cur.parentId) : null;
    }
    return null;
  }
  /** 회차(claude -p, meta.cycle) — 자기 또는 조상 */
  cycleOf(id) {
    const c = this._anc(id, (n) => n.kind === 'claude-p' && Number.isFinite(n.meta?.cycle));
    return c ? { id: c.id, cy: c.meta.cycle } : null;
  }
  /** 파일·단계 계획의 소유자: 러너 아래면 러너, 러너 없는 기동기 아래면 기동기, 아니면 null */
  _runnerOf(id) {
    const r = this._anc(id, (n) => !!(n.meta && (n.meta.runner || n.meta.launcher)));
    return r ? r.id : null;
  }

  /** 본문 기억. ctx = 기억한 회차(또는 'root') — 다른 회차가 그 사이 파일을 고쳤을 수 있어(접힌 회차는 기록을 안 읽음) 같은 맥락에서만 Edit 을 본문에 적용 */
  _doc(key, text, ctx, t = 0) {
    if (text == null || text.length > PLAN.DOC_MAX) { this.docs.delete(key); return; }
    this.docs.delete(key); this.docs.set(key, { text, ctx, t });
    while (this.docs.size > PLAN.DOCS) this.docs.delete(this.docs.keys().next().value);
  }

  /** 도구 호출 끝(성공만) */
  end(desc, { ok, tur, nodeId, ts }) {
    if (!desc || !ok || !nodeId) return;
    const t = Date.parse(ts) || 0;
    try {
      switch (desc.src) {
        case 'todo': return this._set(`todo:${nodeId}`, { src: 'todo', title: '할 일', owner: nodeId }, desc.items.map((x) => ({ k: itemKey(x.t), t: x.t, s: x.s })), nodeId, t);
        case 'tasks': return this._task(desc, tur, nodeId, t);
        case 'exitplan': return this._set(`exitplan:${nodeId}`, { src: 'exitplan', title: desc.parsed.title || '계획', owner: nodeId }, desc.parsed.items, nodeId, t);
        case 'file': return this._file(desc, tur, nodeId, t);
        case 'shell': return this._shell(desc, tur, nodeId, t);
        default: return;
      }
    } catch { /* 계획은 곁가지 — 실패해도 본 흐름은 그대로 */ }
  }

  _task(desc, tur, nodeId, t) {
    if (desc.op === 'create') {
      const tid = String(tur?.task?.id ?? tur?.taskId ?? tur?.id ?? (/#(\d+)/.exec(String(tur?.message || tur?.content || '')) || [])[1] ?? `n${++this.taskSeq}`);
      const pk = `tasks:${nodeId}`;
      this.taskOf.set(tid, pk);
      return this._set(pk, { src: 'tasks', title: '작업 목록', owner: nodeId }, [{ k: `#${tid}`, t: desc.t || `작업 ${tid}`, s: desc.s || 'pending' }], nodeId, t, { merge: true, text: true });
    }
    const pk = this.taskOf.get(desc.id) || `tasks:${nodeId}`;
    this.taskOf.set(desc.id, pk);
    const p = this.plans.get(pk);
    const old = p && p.items.get(`#${desc.id}`);
    const it = desc.s === 'deleted' ? { k: `#${desc.id}`, del: 1 } : { k: `#${desc.id}`, t: desc.t || (old ? old.t : `작업 ${desc.id}`), s: desc.s ? normStatus(desc.s) : old ? old.s : 'pending' };
    return this._set(pk, { src: 'tasks', title: '작업 목록', owner: p ? p.owner : nodeId }, [it], nodeId, t, { merge: true, text: !!desc.t });
  }

  _file(desc, tur, nodeId, t) {
    const pk = `file:${desc.key}`;
    let text = null;
    const cyc = this.cycleOf(nodeId);
    const ctx = cyc ? cyc.id : 'root';
    if (desc.op === 'write') text = desc.text;
    else if (desc.op === 'read') {
      const f = tur && tur.file;
      if (f && typeof f.content === 'string') {
        const full = !(Number(f.startLine) > 1) && !(Number(f.totalLines) > Number(f.numLines));
        if (full) text = f.content;
      }
    } else if (desc.op === 'edit') {
      const mem = this.docs.get(desc.key);
      const base = (typeof tur?.originalFile === 'string' && tur.originalFile) ? tur.originalFile : mem && mem.ctx === ctx && mem.t <= t ? mem.text : null;
      if (base != null && desc.edits) text = applyEdits(base, desc.edits);
      if (text == null && desc.edits) { this._doc(desc.key, null); return this._partial(pk, desc, nodeId, t); } // 본문을 모르면 바뀐 줄만 반영
    }
    if (text == null) { if (desc.op !== 'read') this._doc(desc.key, null); return; }
    this._doc(desc.key, text, ctx, t);
    const parsed = parsePlanMarkdown(text);
    const runner = this._runnerOf(nodeId);
    const p = this.plans.get(pk);
    if (!parsed) { if (p && t >= p.at) this._drop(pk, t); return; }
    // Read 는 이미 아는 계획을 고칠 때만 — 단, 러너(자율 루프) 아래 단계 설계서는 읽기만으로도 그 러너의 계획
    if (desc.op === 'read' && !p && !(runner && parsed.kind === 'phases')) return;
    const src = parsed.kind === 'phases' ? 'phases' : 'file';
    return this._set(pk, { src, title: desc.base || parsed.title || '계획', doc: parsed.title || '', owner: runner || nodeId, strong: !!runner }, parsed.items, nodeId, t, { touch: true, text: true });
  }

  /** 본문을 모르는 Edit: 새 글의 체크박스·단계 표식 줄로 아는 항목의 상태만 고침(체크박스 계획이면 새 항목도 더함) */
  _partial(pk, desc, nodeId, t) {
    const p = this.plans.get(pk);
    if (!p) return;
    const seen = [];
    for (const e of desc.edits) {
      const pn = parsePlanMarkdown(e.n, { min: 1 });
      if (pn) seen.push(...pn.items.filter((it) => p.items.has(it.k) || p.src === 'file'));
    }
    const runner = this._runnerOf(nodeId);
    this._set(pk, { src: p.src, title: p.title, owner: runner || p.owner, strong: !!runner }, seen, nodeId, t, { merge: true, touch: true, text: false });
  }

  /** 셸 출력의 표식·체크박스 줄 → 이미 아는 계획의 상태 고침(러너 아래 단계 표식이면 새 계획도) */
  _shell(desc, tur, nodeId, t) {
    if (desc.writes) for (const f of desc.files) this._doc(f.key, null);
    const out = tur && typeof tur.stdout === 'string' ? tur.stdout.slice(0, 256 * 1024) : '';
    if (!out) return;
    const byBase = new Map(desc.files.map((f) => [f.base.toLowerCase(), f]));
    const lines = new Map(); // 파일 열쇠 → 줄들
    for (const raw of out.split(/\r?\n/)) {
      let l = raw, f = desc.files.length === 1 ? desc.files[0] : null;
      const m = /^([^\s:]*\.(?:md|markdown)):(?=\d+[:-])/i.exec(l); // grep 여러 파일: 경로:줄:
      if (m) { f = byBase.get(m[1].replace(/\\/g, '/').split('/').pop().toLowerCase()) || null; l = l.slice(m[0].length); }
      l = l.replace(/^\s*\d+[:\-\t→]\s?/, ''); // grep -n · cat -n · Read 꼴 줄 번호
      if (!f) continue;
      if (!lines.has(f.key)) lines.set(f.key, []);
      lines.get(f.key).push(l);
    }
    const runner = this._runnerOf(nodeId);
    for (const f of desc.files) {
      const ls = lines.get(f.key);
      if (!ls || !ls.length) continue;
      const pn = parsePlanMarkdown(ls.join('\n'), { min: 1 });
      if (!pn) continue;
      const pk = `file:${f.key}`;
      const p = this.plans.get(pk);
      if (!p && !(runner && pn.kind === 'phases')) continue;
      const items = pn.items.filter((it) => !p || p.items.has(it.k) || p.src !== 'workflow');
      const differs = !p || items.some((it) => { const o = p.items.get(it.k); return !o || o.s !== it.s || !!o.hold !== !!it.hold; });
      if (differs && this.docs.has(f.key)) this._doc(f.key, null); // 기억한 본문과 표식이 다르면 그 본문은 낡음(그 사이 다른 곳에서 고침)
      this._set(pk, { src: p ? p.src : 'phases', title: p ? p.title : f.base, owner: runner || nodeId, strong: !!runner }, items, nodeId, t, { merge: true, touch: true, text: false });
    }
  }

  // ── Workflow ──
  /** Workflow 도구 끝: 노드 w:<runId> 가 생긴 뒤 단계 목록을 정함 */
  workflowDefine(wid, phases, ts) {
    if (!wid || !phases || !phases.length) return;
    const w = this.wf.get(wid) || { phases: [], seen: new Map(), ended: null, t0: 0 };
    w.phases = phases.slice(0, PLAN.ITEMS);
    w.t0 = Date.parse(ts) || 0;
    this.wf.set(wid, w);
    this._wfEmit(wid, w.t0);
  }
  /** 워크플로 에이전트가 단계 phase 로 시작함(meta.workflowPhase·journal started) */
  workflowPhase(wid, phase, ts) {
    if (!wid || phase == null || phase === '') return;
    const w = this.wf.get(wid) || { phases: [], seen: new Map(), ended: null, t0: 0 };
    this.wf.set(wid, w);
    const k = String(phase).trim().toLowerCase();
    const t = Date.parse(ts) || 0;
    if (w.seen.has(k) && w.seen.get(k) <= t) return;
    w.seen.set(k, t);
    if (w.phases.length) this._wfEmit(wid, t);
  }
  workflowEnd(wid, ok, ts) {
    const w = this.wf.get(wid);
    if (!w || w.ended) return;
    w.ended = ok ? 'ok' : 'fail';
    if (w.phases.length) this._wfEmit(wid, Date.parse(ts) || 0);
  }
  _wfEmit(wid, t) {
    const w = this.wf.get(wid);
    const low = w.phases.map((p) => p.trim().toLowerCase());
    let cur = -1;
    for (const k of w.seen.keys()) { const i = low.indexOf(k); if (i > cur) cur = i; }
    const items = w.phases.map((p, i) => ({
      k: low[i] + (low.indexOf(low[i]) !== i ? `#${i}` : ''), t: p,
      s: w.ended === 'ok' || i < cur ? 'done' : i === cur ? (w.ended ? 'pending' : 'in_progress') : 'pending',
    }));
    const n = this.g.get(wid);
    // 단계 상태는 본 단계 집합에서 다시 계산한 값(순서 무관) — seen 비교 없이 늘 이 값으로
    this._set(`wf:${wid}`, { src: 'workflow', title: (n && n.label) || '워크플로', owner: wid }, items, wid, Math.max(t, w.t0), { force: true });
  }

  // ── 장부 ──
  /**
   * 계획 갱신. items = 관찰한 항목 {k, t, s, hold?, del?}.
   *  merge: 관찰한 항목만 고침(나머지 그대로) — 아니면 목록 전체(없는 항목은 지움).
   *  text: 관찰한 글로 항목 글을 바꿈(아니면 있던 글 유지 — grep 줄 '단계 3' 이 제목 '단계 3 — 배포' 를 덮지 않게).
   *  touch: 내용이 같아도 '지금 이 계획을 만진 노드·회차'를 갱신.  force: 시각 비교 없이(워크플로 단계 재계산).
   *  owner/strong: 소유자 후보(strong = 러너). 러너가 이기고(나중 러너가 이전 러너를 대신), 아니면 가장 이른 관찰자가 주인.
   */
  _set(pk, { src, title, owner, doc, strong = false }, items, nodeId, t, { merge = false, text = true, touch = false, force = false } = {}) {
    let p = this.plans.get(pk);
    const c = this.cycleOf(nodeId);
    const by = c ? c.id : nodeId, cy = c ? c.cy : undefined;
    const fresh = !p;
    if (!p) {
      p = { key: pk, id: 'p' + planHash(pk, 8), src, title, doc: doc || '', owner, ownerT: t, strong, at: t, by, cy, byT: t, items: new Map(), order: [], gone: new Map() };
      this.plans.set(pk, p);
    }
    let changed = fresh;
    const oldOwner = p.owner;
    if (!fresh && owner && owner !== p.owner) {
      // 러너가 이기고(나중 러너가 앞 러너를 대신), 러너가 아니면 트리에서 더 위(메인 쪽) 노드, 같은 깊이면 먼저 본 노드
      const dep = (id) => { const n = this.g.get(id); return n && Number.isFinite(n.depth) ? n.depth : 99; };
      const take = strong ? (!p.strong || t >= p.ownerT) : (!p.strong && (dep(owner) < dep(p.owner) || (dep(owner) === dep(p.owner) && t < p.ownerT)));
      if (take) { p.owner = owner; p.ownerT = t; p.strong = strong; changed = true; }
    } else if (!fresh && strong && !p.strong) { p.strong = true; p.ownerT = t; }
    if (title && title !== p.title && (fresh || t >= p.at || force)) { p.title = title; changed = true; }
    if (doc && doc !== p.doc) { p.doc = doc; changed = true; }
    if (src && src !== p.src && (t >= p.at || force)) { p.src = src; changed = true; }
    const newer = (old) => force || !old || t >= old.seen;
    const obs = items.filter((x) => x && x.k != null);
    const seenKeys = new Set();
    for (const it of obs) {
      seenKeys.add(it.k);
      const old = p.items.get(it.k);
      if (it.del) { if (old && newer(old)) { p.items.delete(it.k); p.gone.set(it.k, t); changed = true; } continue; }
      if (!old && p.gone.has(it.k) && p.gone.get(it.k) > t && !force) continue; // 나중에 지워진 항목의 옛 관찰
      if (old && !newer(old)) { if (text && it.t && old.t === old.k && clip(it.t, PLAN.TEXT) !== old.t) { old.t = clip(it.t, PLAN.TEXT); changed = true; } continue; } // 옛 관찰이라도 맨 '단계 N' 글에는 제목을 채움
      const s = STATUS.has(it.s) ? it.s : 'pending';
      const tt = text || !old ? clip(it.t, PLAN.TEXT) : old.t;
      if (old && old.s === s && old.t === tt && !!old.hold === !!it.hold) { old.seen = Math.max(old.seen, t); continue; }
      changed = true;
      const keep = old && old.s === s; // 글만 바뀜 → 처리 기록(언제·누가·몇 회차)은 그대로
      const rec = { k: it.k, t: tt, s, at: keep ? old.at : t, seen: t };
      const rby = keep ? old.by : s === 'pending' && !old ? null : by; // 처리한 노드·회차는 진행·완료로 바뀔 때(그냥 본 대기 항목엔 없음)
      if (rby) rec.by = rby;
      const rcy = keep ? old.cy : rby ? cy : undefined;
      if (rcy != null) rec.cy = rcy;
      if (it.hold) rec.hold = 1;
      p.items.set(it.k, rec);
      p.gone.delete(it.k);
    }
    if (!merge) {
      for (const [k, old] of [...p.items]) if (!seenKeys.has(k) && newer(old)) { p.items.delete(k); p.gone.set(k, t); changed = true; }
    }
    // 순서: 전체 관찰이면 그 순서(+ 더 나중 관찰로 남은 항목은 뒤), 단계는 번호순, 아니면 있던 순서 + 새 항목 뒤
    let order;
    if (!merge) order = [...obs.map((x) => x.k).filter((k) => p.items.has(k)), ...p.order.filter((k) => p.items.has(k) && !seenKeys.has(k))];
    else order = [...p.order.filter((k) => p.items.has(k)), ...obs.map((x) => x.k).filter((k) => p.items.has(k) && !p.order.includes(k))];
    order = [...new Set(order)];
    if (p.src === 'phases') order.sort((a, b) => (Number((/\d+/.exec(a) || [])[0]) || 0) - (Number((/\d+/.exec(b) || [])[0]) || 0));
    if (order.length !== p.order.length || order.some((k, i) => k !== p.order[i])) changed = true;
    p.order = order;
    if (touch && t >= p.byT && (p.by !== by || p.cy !== cy)) changed = true;
    if (!changed) return;
    if (t >= p.byT) { p.by = by; p.cy = cy; p.byT = t; }
    p.at = Math.max(p.at, t);
    if (oldOwner && oldOwner !== p.owner) this._emitOwner(oldOwner, t);
    this._emitOwner(p.owner, t);
  }

  /** 같은 계획을 다른 노드·회차가 만짐(내용은 그대로) — 지금 누가 이 계획을 붙들고 있나 */
  _touch(pk, nodeId, t) { this._set(pk, { src: this.plans.get(pk)?.src }, [], nodeId, t, { merge: true, touch: true, text: false }); }

  _drop(pk, t) {
    const p = this.plans.get(pk);
    if (!p) return;
    this.plans.delete(pk);
    this._emitOwner(p.owner, t);
  }

  /** 노드의 계획들(최근 갱신순 ≤3)을 정리된 꼴로(마스킹·상한, minimal 이면 글 없음) */
  plansOf(owner) {
    const mine = [...this.plans.values()].filter((p) => p.owner === owner && p.order.length).sort((a, b) => b.at - a.at).slice(0, PLAN.PER_NODE);
    const minimal = this.g.privacy === 'minimal';
    const txt = (s, n) => (minimal ? '' : clip(redact(s), n));
    return mine.map((p) => ({
      id: p.id, src: p.src, title: txt(p.title, PLAN.TITLE), ...(p.doc && !minimal ? { doc: clip(redact(p.doc), PLAN.TITLE) } : {}),
      at: p.at, by: p.by, ...(p.cy != null ? { cy: p.cy } : {}), n: p.order.length,
      items: p.order.slice(0, PLAN.ITEMS).map((k) => {
        const it = p.items.get(k);
        return { k: planHash(k, 8), t: txt(it.t, PLAN.TEXT), s: it.s, at: it.at, ...(it.by ? { by: it.by } : {}), ...(it.cy != null ? { cy: it.cy } : {}), ...(it.hold ? { hold: 1 } : {}) };
      }),
    }));
  }

  _emitOwner(owner, t) {
    if (!owner || !this.g.has(owner)) return;
    const plans = this.plansOf(owner);
    if (!plans.length && !this.g.get(owner).meta.plans) return;
    // 노드마다 낸 시각이 줄지 않게: 기록은 파일 차례로 읽혀 시각순이 아니고 재생은 시각순으로 정렬하므로, 마지막에 계산한 상태가 마지막에 오도록
    const at = Math.max(t || 0, this.emitT.get(owner) || 0);
    this.emitT.set(owner, at);
    this.g.updateNode(owner, { meta: { plans: plans.length ? plans : null } }, at ? new Date(at).toISOString() : undefined);
  }
}
