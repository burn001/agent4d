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

export const PLAN_SRC = ['phases', 'axes']; // 자율 루프 판: 러너 단계 설계서 · 축 큐(일반 계획판 출처는 폐기)

// ── 공통 계획 형식(v2) ──
// 계획 → 큰 항목(축·마일스톤·할 일) → 작은 항목(단계, steps). 상태 st = done|current|pending|blocked|skipped.
// 옛 꼴(s = done|in_progress|pending, hold)은 웹 호환으로 함께 싣는다(legacyOf). 출처마다 어댑터가 이 형식으로 만든다.
export const PLAN_STATE = ['done', 'current', 'pending', 'blocked', 'skipped'];
export const PLAN_V2 = { ITEMS: 400, STEPS: 24, TEXT: 120, NOTE: 80, META: 3 };
/** 옛 상태(s, hold) → v2 st */
export const toV2State = (s, hold) => (s === 'done' ? 'done' : s === 'in_progress' ? 'current' : hold ? 'blocked' : 'pending');
/** v2 st → 옛 {s, hold} */
export function legacyOf(st) {
  switch (st) {
    case 'done': case 'skipped': return { s: 'done' };
    case 'current': return { s: 'in_progress' };
    case 'blocked': return { s: 'pending', hold: 1 };
    default: return { s: 'pending' };
  }
}
/** 느슨한 상태 글 → v2 st(모르면 null): done·완료·✅ / current·진행·in_progress / pending·대기·todo / blocked·보류·review·⏸ / skipped·건너뜀 */
export function parseState(v) {
  const x = String(v ?? '').trim().toLowerCase();
  if (!x) return null;
  if (PLAN_STATE.includes(x)) return x;
  if (/^(completed?|closed|ok|✅|✔|☑|완료|닫힘|끝)$/.test(x)) return 'done';
  if (/^(in[_ -]?progress|active|running|wip|doing|▶|◐|진행|진행중|진행 중|착수)$/.test(x)) return 'current';
  if (/^(todo|open|planned|queued|next|○|☐|대기|예정)$/.test(x)) return 'pending';
  if (/^(hold|on[_ -]?hold|paused|waiting|review|⏸|보류|검토대기|검토 대기|막힘)$/.test(x)) return 'blocked';
  if (/^(skip|skipped|cancell?ed|dropped|건너뜀|취소)$/.test(x)) return 'skipped';
  return null;
}
/** 진행 요약 {done, current, pending, blocked, skipped, total, settled}(settled = done + skipped) */
export function v2Progress(items) {
  const c = { done: 0, current: 0, pending: 0, blocked: 0, skipped: 0, total: 0 };
  for (const it of items || []) { const st = PLAN_STATE.includes(it && it.st) ? it.st : 'pending'; c[st]++; c.total++; }
  c.settled = c.done + c.skipped;
  return c;
}
/**
 * 바깥 계획(파일· 선언 연결) → wire v2 계획. raw = {id?, src, title, doc?, current?(항목 id), items:[{id?, title, state, doc?, note?, meta?[], group?, emph?,
 * steps?: [{title, state}] | {done, total, current?}}]}. 글은 redact·상한, minimal 이면 글 없음(상태·수만)
 */
export function planFromRaw(raw, { privacy = 'summary', at = 0, key = '' } = {}) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
  const minimal = privacy === 'minimal';
  const txt = (v, n) => (minimal ? '' : clip(redact(String(v ?? '')), n));
  const curId = raw.current != null ? String(raw.current) : null;
  const all = raw.items.filter((x) => x && typeof x === 'object');
  const items = all.slice(0, PLAN_V2.ITEMS).map((x, i) => {
    const id = String(x.id ?? x.k ?? x.title ?? i);
    let st = parseState(x.state ?? x.st) || (x.s ? toV2State(x.s, x.hold) : 'pending');
    if (curId != null && id === curId && st !== 'done' && st !== 'skipped') st = 'current';
    const out = { k: planHash(id, 8), t: txt(x.title ?? x.t ?? id, PLAN_V2.TEXT), st, ...legacyOf(st) };
    if (!minimal) out.id = clip(id, 60);
    if (!minimal && x.doc) out.doc = clip(redact(String(x.doc)), PLAN.TITLE);
    if (!minimal && x.note) out.note = txt(x.note, PLAN_V2.NOTE);
    if (!minimal && x.group) out.group = txt(x.group, 40);
    if (!minimal && Array.isArray(x.meta)) { const m = x.meta.filter((v) => v != null && String(v).trim()).slice(0, PLAN_V2.META).map((v) => txt(v, 40)); if (m.length) out.meta = m; }
    if (x.emph) out.emph = 1;
    const sp = x.steps;
    if (Array.isArray(sp) && sp.length) {
      const list = sp.filter((y) => y && typeof y === 'object').map((y, j) => { const s2 = parseState(y.state ?? y.st) || (y.s ? toV2State(y.s, y.hold) : 'pending'); return { k: planHash(String(y.id ?? y.title ?? j), 8), t: txt(y.title ?? y.t ?? '', PLAN_V2.TEXT), st: s2 }; });
      const pr = v2Progress(list);
      const cs = list.find((y) => y.st === 'current') || list.find((y) => y.st === 'pending');
      out.steps = { done: pr.settled, total: pr.total, ...(cs && cs.t ? { cur: cs.t } : {}), items: list.slice(0, PLAN_V2.STEPS) };
    } else if (sp && typeof sp === 'object' && Number.isFinite(sp.total)) {
      out.steps = { done: Math.max(0, Math.min(sp.total, Number(sp.done) || 0)), total: Math.max(0, Math.round(sp.total)), ...(sp.current && !minimal ? { cur: txt(sp.current, PLAN_V2.TEXT) } : {}) };
    }
    return out;
  });
  const pr = v2Progress(items);
  const cur = items.findIndex((x) => x.st === 'current');
  return {
    v: 2, id: 'p' + planHash(key || raw.id || raw.title || 'plan', 8), src: raw.src || 'plan', title: txt(raw.title || '계획', PLAN.TITLE),
    ...(raw.doc && !minimal ? { doc: clip(redact(String(raw.doc)), PLAN.TITLE) } : {}), at: at || 0, n: all.length,
    progress: pr, ...(cur >= 0 ? { cur } : {}), owner: raw.owner || 'main', items,
    ...(raw.auto ? { auto: 1 } : {}), ...(Number.isFinite(raw.refine) && raw.refine > 0 ? { refine: Math.round(raw.refine) } : {}), ...(Number.isFinite(raw.cands) && raw.cands > 0 ? { cands: Math.round(raw.cands) } : {}), // 자동 추정
  };
}
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
// 단계 설계서: 제목 `### 단계 3 — 배포 …`(Phase 3: … · 단계 1a · 두 자리 번호), 표식 `**단계 3 상태**: ✅ **닫힘** …`,
// 표 줄 `| 단계 3 | 배포 | ✅ |`. 번호 = 숫자 1～3자리 + 선택 영문 한 자(1a). 1.2 같은 하위 번호는 단계가 아님.
const PH_WORD_RE = /단계|phase|step|stage/i;
const PH_HEAD_RE = /^#{2,5}\s*(?:\*\*)?(?:단계|phase|step|stage)\s*(\d{1,3}[a-z]?)(?![\w.])(?:\*\*)?\s*[—–\-:.·)]?\s*(.*)$/i;
const PH_STAT_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?(?:단계|phase|step|stage)\s*(\d{1,3}[a-z]?)\s*(?:상태|status)\s*(?:\*\*\s*[:：]?|[:：]\s*(?:\*\*)?)\s*(.*)$/i;
const PH_ROW_RE = /^\s*\|\s*(?:\*\*)?(?:단계|phase|step|stage)\s*(\d{1,3}[a-z]?)(?![\w.])(?:\*\*)?\s*[—–\-:.·]?\s*([^|]*)\|(.*)$/i;
/** 상태를 말하는 글인가(표 칸 — 없으면 '상태 모름') */
const STATUS_WORD_RE = /✅|☑|✔|⏸|🔧|◐|◑|◔|⬜|☐|닫힘|완료|착지|보류|대기|진행|착수|\b(?:done|closed|complete[d]?|hold|in[ _-]?progress|wip|pending|todo|open)\b/i;
const isBare = (t) => /^(?:단계|phase|step|stage)\s*\d{1,3}[a-z]?$/i.test(String(t || '').trim());
/** 단계 열쇠 정렬: 번호 → 꼬리 글자(단계 1 < 단계 1a < 단계 2 < 단계 10) */
export function phaseCmp(a, b) {
  const pa = /(\d+)([a-z]?)/i.exec(a) || [], pb = /(\d+)([a-z]?)/i.exec(b) || [];
  return (Number(pa[1]) || 0) - (Number(pb[1]) || 0) || String(pa[2] || '').localeCompare(String(pb[2] || ''));
}

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
  const rows = new Map(); // 표 줄의 단계 번호 → {name, st}
  let word = '';           // 문서가 쓰는 단계 낱말(단계·Phase·Step …) — 표시 글에 그대로
  let fence = false;
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) { fence = !fence; continue; }
    if (fence) continue;
    if (!title) { const m = /^#\s+(.+)$/.exec(raw); if (m) title = plainText(m[1]); }
    let m = PH_HEAD_RE.exec(raw);
    const w = () => { if (!word) { const x = PH_WORD_RE.exec(raw)[0]; word = x === '단계' ? x : x[0].toUpperCase() + x.slice(1).toLowerCase(); } };
    if (m) { w(); const n = m[1].toLowerCase(); if (!heads.has(n)) heads.set(n, plainText((m[2] || '').replace(/\*\*\s*$/, ''))); continue; }
    m = PH_STAT_RE.exec(raw);
    if (m) { w(); stats.push([m[1].toLowerCase(), m[2]]); continue; }
    m = PH_ROW_RE.exec(raw);
    if (m) {
      const cells = m[3].split('|').map((c) => c.trim());
      const name = plainText(m[2].trim() || (STATUS_WORD_RE.test(cells[0] || '') ? '' : cells[0] || ''));
      const n = m[1].toLowerCase();
      if (!rows.has(n)) { w(); rows.set(n, { name, st: cells.filter(Boolean).join(' ') }); }
      continue;
    }
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
  // 단계 설계서 = 표식 줄 ∪ 단계 제목 ∪ 표 줄. 표식이 하나라도 있으면 단계 설계서, 없으면 단계 제목·표 줄이 min(기본 2) 이상이고
  // 체크박스 계획이 아닐 때. 표식 없는 단계는 대기 + nos(상태 모름 — 부분 관찰이면 아는 상태를 덮지 않음).
  const phaseN = new Set([...stats.map(([n]) => n), ...heads.keys(), ...rows.keys()]);
  if (stats.length || (phaseN.size >= (opts.min ?? 2) && cbs.length < 2)) {
    const stOf = new Map();
    for (const [n, st] of stats) if (!stOf.has(n)) stOf.set(n, st);
    const items = [];
    for (const n of phaseN) {
      const row = rows.get(n);
      let st = stOf.get(n), nos = false;
      if (st == null && row && STATUS_WORD_RE.test(row.st)) st = row.st;
      if (st == null) { st = ''; nos = true; }
      const ps = phaseStatus(st);
      const name = heads.get(n) || (row && row.name) || '';
      items.push({ k: `단계 ${n}`, t: clip(`${word || '단계'} ${n}${name ? ' — ' + name : ''}`, PLAN.TEXT), s: ps.s, ...(ps.hold ? { hold: 1 } : {}), ...(nos ? { nos: 1 } : {}) });
    }
    items.sort((a, b) => phaseCmp(a.k, b.k));
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
    // TodoWrite·Task·ExitPlanMode·Workflow 출처는 폐기(일반 계획판 철거) — 자율 루프 판은 러너 아래 단계 설계서만
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
    this.emitT = new Map();   // 소유 노드 → 마지막으로 낸 시각
    this.ext = new Map();     // 바깥 계획 열쇠 → {owner, plan(wire v2), sig}
  }

  /** 바깥 계획(파일·선언 연결) 싣기·지우기. plan = planFromRaw 결과(null 이면 지움). 내용이 같으면 아무것도 안 냄 */
  setExternal(key, owner, plan, t = 0) {
    const old = this.ext.get(key);
    if (!plan) { if (old) { this.ext.delete(key); this._emitOwner(old.owner, t); } return; }
    const sig = JSON.stringify({ ...plan, at: 0 });
    if (old && old.sig === sig && old.owner === owner) return;
    this.ext.set(key, { owner, plan, sig });
    if (old && old.owner !== owner) this._emitOwner(old.owner, t);
    this._emitOwner(owner, t);
  }
  externalKeys() { return [...this.ext.keys()]; }

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
        case 'file': return this._file(desc, tur, nodeId, t);
        case 'shell': return this._shell(desc, tur, nodeId, t);
        default: return;
      }
    } catch { /* 계획은 곁가지 — 실패해도 본 흐름은 그대로 */ }
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
        else return this._seen(desc, f.content, nodeId, t); // 부분 Read: 본 줄의 단계·체크박스만 합침(안 본 단계는 그대로)
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
    // 자율 루프 판 전용: 단계 설계서(phases)이고 러너(자율 루프) 아래이거나 이미 아는 러너 계획일 때만. 체크박스 md 계획은 폐기
    if (parsed.kind !== 'phases' || !(runner || (p && p.src === 'phases' && p.strong))) return;
    const src = 'phases';
    return this._set(pk, { src, title: desc.base || parsed.title || '계획', doc: parsed.title || '', owner: runner || nodeId, strong: !!runner }, parsed.items, nodeId, t, { touch: true, text: true });
  }

  /** 본문을 모르는 Edit: 새 글의 체크박스·단계 표식 줄로 아는 항목의 상태만 고침(체크박스 계획이면 새 항목도 더함) */
  _partial(pk, desc, nodeId, t) {
    const p = this.plans.get(pk);
    if (!p) return;
    const seen = [];
    for (const e of desc.edits) {
      const pn = parsePlanMarkdown(e.n, { min: 1 });
      if (pn) seen.push(...pn.items.filter((it) => p.items.has(it.k) || p.src === 'file' || (p.src === 'phases' && pn.kind === 'phases')));
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
    const orphan = [];       // 파일이 여럿인데 경로 머리가 없는 줄
    for (const raw of out.split(/\r?\n/)) {
      let l = raw, f = desc.files.length === 1 ? desc.files[0] : null;
      const m = /^([^\s:]*\.(?:md|markdown)):(?=\d+[:-])/i.exec(l); // grep 여러 파일: 경로:줄:
      if (m) { f = byBase.get(m[1].replace(/\\/g, '/').split('/').pop().toLowerCase()) || null; l = l.slice(m[0].length); }
      l = l.replace(/^\s*\d+[:\-\t→]\s?/, ''); // grep -n · cat -n · Read 꼴 줄 번호
      if (!f) { if (!m) orphan.push(l); continue; }
      if (!lines.has(f.key)) lines.set(f.key, []);
      lines.get(f.key).push(l);
    }
    // 파일이 여럿인데 경로 머리 없는 줄(`git status && grep -n '단계 . 상태' 설계서.md` · `cat A.md; sed -n … B.md`):
    // 단계 표식 줄만, 받을 파일이 하나로 정해질 때 그 파일 몫으로 — 이미 아는 단계 계획 하나, 없으면 설계서 이름 하나
    const marks = orphan.filter((l) => PH_STAT_RE.test(l));
    if (marks.length && desc.files.length > 1) {
      const nm = (f) => f.key.split('/').pop();
      const known = desc.files.filter((f) => this.plans.get(`file:${f.key}`)?.src === 'phases');
      const named = desc.files.filter((f) => /design|설계|plan/i.test(nm(f)) && !/^(?:_?status|readme|claude|supervisor|backlog|todo)\./i.test(nm(f)));
      const to = known.length === 1 ? known[0] : !known.length && named.length === 1 ? named[0] : null;
      if (to) { if (!lines.has(to.key)) lines.set(to.key, []); lines.get(to.key).push(...marks); }
    }
    for (const f of desc.files) {
      const ls = lines.get(f.key);
      if (ls && ls.length) this._seen(f, ls.join('\n'), nodeId, t);
    }
  }

  /** 파일 일부를 본 관찰(셸 출력·부분 Read) → 아는 계획에 합침(러너 아래 단계 표식·제목이면 새 계획도). 안 본 단계는 지우지 않음 */
  _seen(f, text, nodeId, t) {
    const pn = parsePlanMarkdown(text, { min: 1 });
    if (!pn) return;
    const runner = this._runnerOf(nodeId);
    const pk = `file:${f.key}`;
    const p = this.plans.get(pk);
    if (!p && !(runner && pn.kind === 'phases')) return;
    if (pn.kind !== 'phases') return; // 단계 표식만(체크박스 계획 폐기)
    const items = pn.items.filter((it) => !p || p.items.has(it.k) || p.src !== 'workflow');
    const differs = !p || items.some((it) => { const o = p.items.get(it.k); return !o || (!it.nos && (o.s !== it.s || !!o.hold !== !!it.hold)); });
    if (differs && this.docs.has(f.key)) this._doc(f.key, null); // 기억한 본문과 표식이 다르면 그 본문은 낡음(그 사이 다른 곳에서 고침)
    this._set(pk, { src: p ? p.src : 'phases', title: p ? p.title : f.base, owner: runner || nodeId, strong: !!runner }, items, nodeId, t, { merge: true, touch: true, text: false });
  }

  // ── Workflow ──
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
      // 맨 '단계 N' 글에는 (옛 관찰·글을 안 바꾸는 부분 관찰이라도) 제목이 붙은 글을 채움
      if (old && it.t && (old.t === old.k || isBare(old.t)) && !isBare(it.t) && clip(it.t, PLAN.TEXT) !== old.t) { old.t = clip(it.t, PLAN.TEXT); changed = true; }
      if (old && !newer(old)) continue;
      if (old && it.nos && merge) { old.seen = Math.max(old.seen, t); continue; } // 상태를 말하지 않는 부분 관찰(제목만 본 줄) — 아는 상태 유지
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
    if (p.src === 'phases') order.sort(phaseCmp);
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
    const ext = [...this.ext.values()].filter((x) => x.owner === owner).map((x) => x.plan); // 바깥 계획(메인)이 앞
    const out = mine.map((p) => {
      const items = p.order.slice(0, PLAN.ITEMS).map((k) => {
        const it = p.items.get(k);
        // v2 상태 st 와 옛 꼴(s·hold)을 함께
        return { k: planHash(k, 8), t: txt(it.t, PLAN.TEXT), st: toV2State(it.s, it.hold), s: it.s, at: it.at, ...(it.by ? { by: it.by } : {}), ...(it.cy != null ? { cy: it.cy } : {}), ...(it.hold ? { hold: 1 } : {}) };
      });
      const cur = items.findIndex((x) => x.st === 'current');
      return {
        v: 2, id: p.id, src: p.src, title: txt(p.title, PLAN.TITLE), ...(p.doc && !minimal ? { doc: clip(redact(p.doc), PLAN.TITLE) } : {}),
        at: p.at, by: p.by, ...(p.cy != null ? { cy: p.cy } : {}), n: p.order.length, progress: v2Progress(items), ...(cur >= 0 ? { cur } : {}), items,
      };
    });
    return [...ext, ...out];
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
