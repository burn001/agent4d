#!/usr/bin/env node
// ccviz archive — 보관함(transcript archive) 관리
//   ccviz archive add <세션ID…> [--dir <보관함>] [--why "사유"] [--from <projects 폴더>] [--refresh]
//   ccviz archive list [--dir <보관함>] [--json]
// add 만 보관함에 쓴다: ~/.claude/projects 의 세션(메인 jsonl + 같은 이름 폴더 전체)을 같은 구조로 복사하고
// 파일·폴더 시각을 원본대로 맞춘 뒤 크기·mtime·SHA-256 을 대조한다. 기존 파일은 고쳐 쓰지 않는다(이미 있으면 건너뜀).
// index.json 은 항목을 덧붙이고, INDEX.md 는 표 앞 머리글을 그대로 두고 표만 index.json 으로 다시 쓴다.
// 메인에 딸린 claude -p 자식 세션(다른 프로젝트 폴더 포함)과 재생에 쓰는 백그라운드 출력(tasks/*.output)도 함께
// 원본 재생 구성(RootRuntime offline)을 그대로 돌려 찾는다. --refresh 는 이미 있는 메인은 건너뛰고 빠진 자식·출력만 더한다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ccvizHome } from '../server/home.mjs';
import { t } from '../server/cli-i18n.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function claudeProjectsDir(env = process.env) {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

function stateDir(env = process.env) { return ccvizHome(env); }
/** 보관함 폴더: --dir > CCVIZ_ARCHIVE > config.archiveDir */
export function archiveDirOf(opts = {}, env = process.env) {
  if (opts.dir && opts.dir !== true) return String(opts.dir);
  if (env.CCVIZ_ARCHIVE) return env.CCVIZ_ARCHIVE;
  try { const c = JSON.parse(fs.readFileSync(path.join(stateDir(env), 'config.json'), 'utf8')); if (c.archiveDir) return c.archiveDir; } catch {}
  return null;
}

/** 원본에서 세션 찾기: 전체 id 또는 8자 이상 앞부분(하나로 정해질 때만) → [{sid, proj, file}] */
export function findSessions(projectsDir, wanted) {
  const all = [];
  let dirs = [];
  try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }); } catch { return { found: [], missing: [...wanted], ambiguous: [] }; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let files = [];
    try { files = fs.readdirSync(path.join(projectsDir, d.name)); } catch { continue; }
    for (const f of files) if (f.endsWith('.jsonl') && UUID_RE.test(f.slice(0, -6))) all.push({ sid: f.slice(0, -6).toLowerCase(), proj: d.name, file: path.join(projectsDir, d.name, f) });
  }
  const found = [], missing = [], ambiguous = [];
  for (const w of wanted) {
    const k = String(w).toLowerCase().replace(/^arc:/, '');
    const hit = UUID_RE.test(k) ? all.filter((x) => x.sid === k) : k.length >= 8 ? all.filter((x) => x.sid.startsWith(k)) : [];
    if (!hit.length) missing.push(w);
    else if (new Set(hit.map((x) => x.sid)).size > 1) ambiguous.push(w);
    else if (!found.some((x) => x.sid === hit[0].sid)) found.push(hit[0]);
  }
  return { found, missing, ambiguous };
}

/** 세션이 차지하는 파일(메인 jsonl + <sid>/ 아래 전부)과 폴더 — 상대 경로(프로젝트 폴더 기준) */
export function sessionTree(projDir, sid) {
  const files = [`${sid}.jsonl`], dirs = [];
  const walk = (rel) => {
    let ents = [];
    try { ents = fs.readdirSync(path.join(projDir, rel), { withFileTypes: true }); } catch { return; }
    dirs.push(rel);
    for (const d of ents) {
      const r = path.join(rel, d.name);
      if (d.isDirectory()) walk(r);
      else if (d.isFile()) files.push(r);
    }
  };
  if (fs.existsSync(path.join(projDir, sid))) walk(sid);
  return { files, dirs };
}

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** 지표(기존 index.json 과 같은 정의) */
export function metricsOf(projDir, sid) {
  const main = path.join(projDir, `${sid}.jsonl`);
  const text = fs.readFileSync(main, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  let tools = 0, agents = 0, bg = 0, first = null, last = null, cwd = null;
  const kinds = new Set();
  for (const l of lines) {
    let r; try { r = JSON.parse(l); } catch { continue; }
    if (!cwd && r.cwd) cwd = r.cwd;
    if (r.timestamp) {
      const t = Date.parse(r.timestamp);
      if (Number.isFinite(t)) { if (first == null || t < first) first = t; if (last == null || t > last) last = t; }
    }
    if (r.type === 'assistant' && Array.isArray(r.message?.content)) {
      for (const c of r.message.content) {
        if (c?.type !== 'tool_use') continue;
        tools++; kinds.add(c.name);
        if (c.name === 'Agent' || c.name === 'Task') agents++;
        if (c.input && c.input.run_in_background) bg++;
      }
    }
  }
  let subs = 0;
  try { subs = fs.readdirSync(path.join(projDir, sid, 'subagents')).filter((f) => f.endsWith('.jsonl')).length; } catch {}
  let bytes = 0;
  for (const f of sessionTree(projDir, sid).files) { try { bytes += fs.statSync(path.join(projDir, f)).size; } catch {} }
  const hours = first != null ? Math.round(((last - first) / 3600e3) * 10) / 10 : 0;
  return {
    cwd, lines: lines.length, tools, kinds: kinds.size, agents, subs, bg, hours, mb: Math.round(bytes / 1e5) / 10,
    first: first != null ? new Date(first).toISOString() : null, last: last != null ? new Date(last).toISOString() : null,
    score: tools + 5 * subs + 3 * bg + 20 * kinds.size,
  };
}

/** 한 세션 복사 + 시각 보존 + 대조. 이미 있으면 {skipped:true} */
export function copySession({ src, dst, proj, sid }) {
  const sp = path.join(src, proj), dp = path.join(dst, proj);
  if (fs.existsSync(path.join(dp, `${sid}.jsonl`))) return { skipped: true };
  const { files, dirs } = sessionTree(sp, sid);
  fs.mkdirSync(dp, { recursive: true });
  for (const d of dirs) fs.mkdirSync(path.join(dp, d), { recursive: true });
  const bad = [];
  for (const f of files) {
    const a = path.join(sp, f), b = path.join(dp, f);
    fs.copyFileSync(a, b, fs.constants.COPYFILE_EXCL);
    const st = fs.statSync(a);
    fs.utimesSync(b, st.atime, st.mtime);
  }
  // 폴더 시각은 안쪽 내용을 다 쓴 뒤, 깊은 것부터(안쪽 쓰기가 바깥 폴더 시각을 바꾸므로)
  for (const d of [...dirs].sort((x, y) => y.split(path.sep).length - x.split(path.sep).length)) {
    const st = fs.statSync(path.join(sp, d));
    fs.utimesSync(path.join(dp, d), st.atime, st.mtime);
  }
  for (const f of files) {
    const a = fs.statSync(path.join(sp, f)), b = fs.statSync(path.join(dp, f));
    if (a.size !== b.size) bad.push(t('arc.badSize', { f }));
    else if (Math.abs(a.mtimeMs - b.mtimeMs) > 2) bad.push(t('arc.badMtime', { f }));
    else if (sha256(path.join(sp, f)) !== sha256(path.join(dp, f))) bad.push(t('arc.badSha', { f }));
  }
  for (const d of dirs) {
    const a = fs.statSync(path.join(sp, d)), b = fs.statSync(path.join(dp, d));
    if (Math.abs(a.mtimeMs - b.mtimeMs) > 2) bad.push(t('arc.badDirTime', { d }));
  }
  return { skipped: false, files: files.length, dirs: dirs.length, bad };
}

// ───────────── 자식 세션·백그라운드 출력 ─────────────
/** 보관함 안 출력 폴더 이름(server/archive.mjs ARCHIVE_TASKS 와 같은 값) */
export const TASKS_DIR = '_tasks';

/**
 * 메인 세션 sid 에 딸린 claude -p 자식 세션과 백그라운드 출력 파일. 원본 재생 구성(RootRuntime offline — 서버 재생과 같은 매칭
 * 규칙: 세션 id 힌트·stdout·임시 폴더·기동기 회차·휴리스틱, index.childParent)을 돌려 찾는다.
 * → { children:[{proj, sid}], outputs:[{src, rel}], missing:{children, outputs} }
 *   missing.children = 매칭 못 한 claude -p 호출(원본이 지워졌을 수 있음), missing.outputs = 기록에는 있는데 파일을 못 찾은 출력
 */
export async function collectExtras({ from, sid, index = null }) {
  const { SessionIndex, taskRelOf } = await import('../server/discovery.mjs');
  const { RootRuntime } = await import('../server/session.mjs');
  const idx = index || new SessionIndex({ projectsDir: from });
  if (!idx.lastRefresh) await idx.refresh();
  const rt = new RootRuntime({ sessionId: sid, index: idx, offline: true });
  await rt.loadOffline();
  const me = String(sid).toLowerCase();
  const tree = new Set([me]);
  for (const k of rt.watchers.keys()) tree.add(String(k).toLowerCase());
  // 노드 없이 집계로만 둔 회차·손자 claude -p 도: 띄운 세션이 이 트리 안이면 자식
  for (let grew = true; grew;) {
    grew = false;
    for (const [c, p] of idx.childParent) {
      const cl = String(c).toLowerCase();
      if (!tree.has(cl) && tree.has(String(p).toLowerCase())) { tree.add(cl); grew = true; }
    }
  }
  const children = [];
  for (const s of tree) {
    if (s === me) continue;
    const e = idx.findSession(s);
    if (e) children.push({ proj: e.projectDir, sid: String(e.sessionId).toLowerCase() });
  }
  children.sort((a, b) => (a.proj + a.sid).localeCompare(b.proj + b.sid));
  const outputs = [], seen = new Set();
  let missOut = 0;
  for (const o of rt.outputs.values()) {
    // 기록에 적힌 경로를 그대로 연 출력(startOutput)은 파일이 이미 지워졌을 수 있다 — 있는 것만
    if (o.proc) continue; // 분리 프로세스 로그는 기록 밖 파일(임시 폴더 tasks 아님) — 보관하지 않는다
    const rel = o.file && fs.existsSync(o.file) ? taskRelOf(o.file) : null;
    if (!rel) { missOut++; continue; }
    if (seen.has(rel)) continue;
    seen.add(rel);
    outputs.push({ src: o.file, rel });
  }
  outputs.sort((a, b) => a.rel.localeCompare(b.rel));
  const missChildren = rt.children.filter((c) => !c.matched && !c.launcher).length;
  // 기동기 판정 고정(pins): 보관함에는 다른 메인·형제 회차·기동 기록이 없어 다시 셈하면 답이 달라진다 → 원본에서 정한 답을 같이 보관
  const { launcherIndexOf } = await import('../server/launcher.mjs');
  const li = launcherIndexOf(idx);
  const pins = { cycles: {}, launches: {} };
  for (const c of children) {
    const a = li.peek(c.sid) || li.peek(idx.findSession(c.sid)?.sessionId);
    if (a && !a.none && a.toolUseId) pins.cycles[c.sid] = a;
  }
  const want = new Set([...rt.launchNodes.values()].map((L) => L.toolUseId).filter(Boolean));
  for (const a of Object.values(pins.cycles)) want.add(a.toolUseId);
  for (const f of li.files.values()) for (const L of f.launches) {
    if (want.has(L.toolUseId)) pins.launches[L.toolUseId] = { key: L.key, script: L.script, cwd: L.cwd, via: L.via };
  }
  return { children, outputs, missing: { children: missChildren, outputs: missOut }, pins };
}

/**
 * 상대 경로 파일들을 srcRoot → dstRoot 로 추가만 한다. 이미 있는 파일은 건드리지 않음(kept). 새로 만든 폴더는 원본 폴더 시각,
 * 원래 있던 폴더는 새 항목 때문에 바뀐 시각을 되돌린다. 새 파일은 크기·mtime(±2ms)·SHA-256, 새 폴더는 mtime 대조.
 */
export function copyAdd({ srcRoot, dstRoot, files }) {
  const rels = [...new Set(files.map((f) => path.normalize(f)))];
  const want = rels.filter((f) => !fs.existsSync(path.join(dstRoot, f)));
  const kept = rels.length - want.length;
  const anc = new Set();
  for (const f of want) for (let d = path.dirname(f); d && d !== '.' && d !== path.sep; d = path.dirname(d)) anc.add(d);
  const before = new Map(); // 원래 있던 폴더(대상 루트 포함) → 시각
  for (const d of ['.', ...anc]) {
    try { const st = fs.statSync(path.join(dstRoot, d)); if (st.isDirectory()) before.set(d, st); } catch {}
  }
  const depth = (d) => d.split(path.sep).length;
  const created = [...anc].filter((d) => !before.has(d)).sort((a, b) => depth(a) - depth(b));
  const bad = [], done = [];
  try {
    for (const d of created) fs.mkdirSync(path.join(dstRoot, d), { recursive: true });
    for (const f of want) {
      const a = path.join(srcRoot, f), b = path.join(dstRoot, f);
      try {
        const st = fs.statSync(a);
        fs.copyFileSync(a, b, fs.constants.COPYFILE_EXCL);
        fs.utimesSync(b, st.atime, st.mtime);
        done.push(f);
      } catch (e) { bad.push(t('arc.badCopy', { f, err: e.code || e.message })); }
    }
  } finally {
    // 폴더 시각: 새 폴더는 깊은 것부터 원본대로, 원래 있던 폴더는 손대기 전 시각으로(복사가 중간에 실패해도)
    for (const d of [...created].reverse()) {
      try { const st = fs.statSync(path.join(srcRoot, d)); fs.utimesSync(path.join(dstRoot, d), st.atime, st.mtime); } catch {}
    }
    for (const [d, st] of [...before].sort((x, y) => (y[0] === '.' ? 0 : depth(y[0])) - (x[0] === '.' ? 0 : depth(x[0])))) {
      try { fs.utimesSync(path.join(dstRoot, d), st.atime, st.mtime); } catch {}
    }
  }
  for (const f of done) {
    const a = fs.statSync(path.join(srcRoot, f)), b = fs.statSync(path.join(dstRoot, f));
    if (a.size !== b.size) bad.push(t('arc.badSize', { f }));
    else if (Math.abs(a.mtimeMs - b.mtimeMs) > 2) bad.push(t('arc.badMtime', { f }));
    else if (sha256(path.join(srcRoot, f)) !== sha256(path.join(dstRoot, f))) bad.push(t('arc.badSha', { f }));
  }
  for (const d of created) {
    let a = null;
    try { a = fs.statSync(path.join(srcRoot, d)); } catch { continue; }
    const b = fs.statSync(path.join(dstRoot, d));
    if (Math.abs(a.mtimeMs - b.mtimeMs) > 2) bad.push(t('arc.badDirTime', { d }));
  }
  return { added: done.length, kept, dirs: created.length, bad };
}

/** 자식 세션·출력을 보관함에 더한다 → {children:{added, kept}, outputs:{added, kept}, files, bad[]} */
export function copyExtras({ from, dir, extras }) {
  const out = { children: { added: 0, kept: 0 }, outputs: { added: 0, kept: 0 }, files: 0, bad: [] };
  for (const c of extras.children) {
    if (fs.existsSync(path.join(dir, c.proj, `${c.sid}.jsonl`))) { out.children.kept++; continue; }
    const { files } = sessionTree(path.join(from, c.proj), c.sid);
    const r = copyAdd({ srcRoot: from, dstRoot: dir, files: files.map((f) => path.join(c.proj, f)) });
    out.children.added++; out.files += r.added; out.bad.push(...r.bad);
  }
  for (const o of extras.outputs) {
    const relFs = o.rel.split('/').join(path.sep);
    const src = path.normalize(o.src);
    if (!src.toLowerCase().endsWith(path.sep + relFs.toLowerCase())) { out.bad.push(t('arc.badOutPath', { rel: o.rel })); continue; }
    const srcRoot = src.slice(0, src.length - relFs.length);
    const r = copyAdd({ srcRoot, dstRoot: path.join(dir, TASKS_DIR), files: [relFs] });
    if (r.added) out.outputs.added++; else out.outputs.kept++;
    out.files += r.added; out.bad.push(...r.bad.map((b) => `${TASKS_DIR}/${b}`));
  }
  return out;
}

/** index.json 항목에 자식·출력 목록·개수. 기존 목록과 합친다(기존 키 값은 그대로) */
export function withExtras(item, extras) {
  const kids = new Map((item.children || []).map((c) => [c.sid, c]));
  for (const c of extras.children) kids.set(c.sid, { proj: c.proj, sid: c.sid });
  const outs = new Set(item.outputs || []);
  for (const o of extras.outputs) outs.add(o.rel);
  const next = { ...item, childCount: kids.size, outputCount: outs.size, children: [...kids.values()], outputs: [...outs].sort() };
  if (extras.pins && (Object.keys(extras.pins.cycles).length || Object.keys(extras.pins.launches).length)) {
    const old = item.pins || {};
    next.pins = { cycles: { ...(old.cycles || {}), ...extras.pins.cycles }, launches: { ...(old.launches || {}), ...extras.pins.launches } };
  }
  if (extras.missing && (extras.missing.children || extras.missing.outputs)) next.missing = { ...extras.missing };
  else delete next.missing;
  return next;
}

// ───────────── index.json · INDEX.md ─────────────
const pad = (n) => String(n).padStart(2, '0');
export function kst(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 9 * 3600e3);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
const TABLE_HEAD_V1 = '| 시작 | 끝 | 시간(h) | 도구 | 종류 | 서브 | 백그라운드 | MB | 사유 | cwd | 폴더/세션 |';
// 자식(claude -p 세션)·출력(백그라운드 출력 파일) 열 추가
const TABLE_HEAD = '| 시작 | 끝 | 시간(h) | 도구 | 종류 | 서브 | 백그라운드 | MB | 사유 | cwd | 폴더/세션 | 자식 | 출력 |';
export function indexRow(it) {
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return `| ${kst(it.first)} | ${kst(it.last)} | ${Number(it.hours).toFixed(1)} | ${it.tools} | ${it.kinds} | ${it.subs} | ${it.bg} | ${Number(it.mb).toFixed(1)} | ${cell((it.why || []).join(', '))} | \`${cell(it.cwd)}\` | \`${it.proj}/${it.sid}\` | ${it.childCount ?? '-'} | ${it.outputCount ?? '-'} |`;
}
/** INDEX.md: 표 앞 머리글은 그대로(세션 수만 고침), 표는 index.json 시작 시각 순으로 다시 */
export function renderIndexMd(prev, items) {
  // 원래 줄 끝(CRLF)을 지킨다
  if (prev && prev.includes('\r\n')) return renderIndexMd(prev.replace(/\r\n/g, '\n'), items).replace(/\n/g, '\r\n');
  const rows = [...items].sort((a, b) => String(a.first).localeCompare(String(b.first))).map(indexRow);
  const table = [TABLE_HEAD, '|' + '---|'.repeat(13), ...rows].join('\n');
  const head = prev && (prev.includes(TABLE_HEAD) ? TABLE_HEAD : prev.includes(TABLE_HEAD_V1) ? TABLE_HEAD_V1 : null);
  if (!head) {
    return `# transcript_archive\n\n> 원본 \`~/.claude/projects\` · 선별 ${items.length}개 세션 · 시각은 KST\n\n${table}\n`;
  }
  const i = prev.indexOf(head);
  const headText = prev.slice(0, i).replace(/선별 \d+개 세션/, `선별 ${items.length}개 세션`);
  // 표 뒤에 다른 글이 있으면 보존
  const restLines = prev.slice(i).split('\n');
  let k = 0;
  while (k < restLines.length && restLines[k].startsWith('|')) k++;
  const tail = restLines.slice(k).join('\n');
  return headText + table + (tail.trim() ? '\n' + tail : '\n');
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function readIndex(dir) {
  try { const a = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); return Array.isArray(a) ? a : []; } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new Error(t('arc.indexRead', { msg: e.message }));
  }
}

/**
 * add: 결과 [{sid, status:'added'|'refreshed'|'skipped'|'missing'|'ambiguous'|'failed', extras?, …}]
 * refresh: 이미 있는 메인은 건너뛰고 빠진 자식·출력만 더한다(ids 가 비면 index.json 전체). extras:false 면 예전처럼 메인만.
 */
export async function archiveAdd({ ids, dir, from = claudeProjectsDir(), why = null, log = () => {}, refresh = false, extras = true }) {
  if (!dir) throw new Error(t('arc.noDir'));
  fs.mkdirSync(dir, { recursive: true });
  let index = readIndex(dir);
  if (!ids.length && refresh) ids = index.map((x) => x.sid);
  if (!ids.length) throw new Error(t('arc.noIds'));
  const known = new Set(index.map((x) => String(x.sid).toLowerCase()));
  const { found, missing, ambiguous } = findSessions(from, ids);
  const out = [...missing.map((w) => ({ sid: w, status: 'missing' })), ...ambiguous.map((w) => ({ sid: w, status: 'ambiguous' }))];
  const added = [];
  let changed = false;
  let sidx = null; // 원본 색인 하나를 여러 세션이 같이 쓴다(서버 프로세스 하나와 같은 조건 — 자식 매칭 멱등)
  const extrasOf = async (s) => {
    if (!sidx) { const { SessionIndex } = await import('../server/discovery.mjs'); sidx = new SessionIndex({ projectsDir: from }); await sidx.refresh(); }
    const ex = await collectExtras({ from, sid: s.sid, index: sidx });
    const r = copyExtras({ from, dir, extras: ex });
    return { ex, r };
  };
  const report = (s, ex, r) => log(t('arc.extras', { sid: s.sid.slice(0, 8), ca: r.children.added, ck: r.children.kept, oa: r.outputs.added, ok: r.outputs.kept,
    miss: ex.missing.children || ex.missing.outputs ? t('arc.extrasMiss', { c: ex.missing.children, o: ex.missing.outputs }) : '' }));
  for (const s of found) {
    const have = known.has(s.sid) || fs.existsSync(path.join(dir, s.proj, `${s.sid}.jsonl`));
    if (have) {
      if (!refresh || !extras) { out.push({ sid: s.sid, status: 'skipped' }); continue; }
      const { ex, r } = await extrasOf(s);
      report(s, ex, r);
      if (r.bad.length) { out.push({ sid: s.sid, status: 'failed', bad: r.bad }); continue; }
      const i = index.findIndex((x) => String(x.sid).toLowerCase() === s.sid);
      if (i >= 0) {
        const next = withExtras(index[i], ex);
        if (JSON.stringify(next) !== JSON.stringify(index[i])) { index[i] = next; changed = true; }
      }
      const any = r.children.added + r.outputs.added;
      out.push({ sid: s.sid, status: any ? 'refreshed' : 'skipped', extras: r, missingExtras: ex.missing });
      continue;
    }
    const r = copySession({ src: from, dst: dir, proj: s.proj, sid: s.sid });
    if (r.skipped) { out.push({ sid: s.sid, status: 'skipped' }); continue; }
    if (r.bad.length) { out.push({ sid: s.sid, status: 'failed', bad: r.bad }); continue; }
    const m = metricsOf(path.join(dir, s.proj), s.sid);
    let item = { proj: s.proj, sid: s.sid, cwd: m.cwd, lines: m.lines, tools: m.tools, kinds: m.kinds, agents: m.agents, subs: m.subs, bg: m.bg,
      hours: m.hours, mb: m.mb, first: m.first, last: m.last, score: m.score, why: [why && why !== true ? String(why) : '수동 추가'] };
    let er = null;
    if (extras) {
      const { ex, r: rr } = await extrasOf(s);
      report(s, ex, rr);
      if (rr.bad.length) { out.push({ sid: s.sid, status: 'failed', bad: rr.bad }); continue; }
      item = withExtras(item, ex);
      er = rr;
    }
    added.push(item);
    out.push({ sid: s.sid, status: 'added', files: r.files, item, ...(er ? { extras: er } : {}) });
    log(t('arc.added', { proj: s.proj, sid: s.sid, files: r.files, mb: m.mb, tools: m.tools, subs: m.subs }));
  }
  if (added.length || changed) {
    const next = [...index, ...added];
    // 기존 파일의 모양(들여쓰기 1·줄 끝·끝 줄바꿈)을 따른다
    let raw = null;
    try { raw = fs.readFileSync(path.join(dir, 'index.json'), 'utf8'); } catch {}
    let txt = JSON.stringify(next, null, 1) + (raw == null || /\n$/.test(raw) ? '\n' : '');
    if (raw && raw.includes('\r\n')) txt = txt.replace(/\n/g, '\r\n');
    writeAtomic(path.join(dir, 'index.json'), txt);
    let prev = null;
    try { prev = fs.readFileSync(path.join(dir, 'INDEX.md'), 'utf8'); } catch {}
    writeAtomic(path.join(dir, 'INDEX.md'), renderIndexMd(prev, next));
  }
  return out;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

// 도움말은 server/cli-i18n.mjs 'arc.help'(영어·한국어)

export async function main(argv) {
  const opts = parseArgs(argv);
  const sub = opts._[0];
  const dir = archiveDirOf(opts);
  if (sub === 'add') {
    let res;
    // --refresh 는 값 없는 깃발(뒤의 세션 ID 를 값으로 먹지 않게)
    if (typeof opts.refresh === 'string') { opts._.push(opts.refresh); opts.refresh = true; }
    try {
      res = await archiveAdd({ ids: opts._.slice(1), dir, from: opts.from && opts.from !== true ? opts.from : claudeProjectsDir(), why: opts.why,
        refresh: !!opts.refresh, log: (s) => console.log(s) });
    }
    catch (e) { console.error(t('common.error', { msg: e.message })); return 1; }
    const c = (k) => res.filter((x) => x.status === k);
    for (const x of c('skipped')) console.log(t('arc.skipped', { sid: x.sid }));
    for (const x of c('missing')) console.error(t('arc.missing', { sid: x.sid }));
    for (const x of c('ambiguous')) console.error(t('arc.ambiguous', { sid: x.sid }));
    for (const x of c('failed')) console.error(t('arc.failed', { sid: x.sid, bad: x.bad.slice(0, 5).join(', ') }));
    const ex = res.filter((x) => x.extras);
    const sum = (k, j) => ex.reduce((a, x) => a + x.extras[k][j], 0);
    const miss = res.reduce((a, x) => a + ((x.missingExtras && x.missingExtras.children) || (x.item && x.item.missing && x.item.missing.children) || 0), 0);
    if (ex.length) console.log(t('arc.sumExtras', { c: sum('children', 'added'), o: sum('outputs', 'added'), miss: miss ? t('arc.sumExtrasMiss', { n: miss }) : '' }));
    const nFail = c('missing').length + c('ambiguous').length + c('failed').length;
    console.log(t('arc.sum', { a: c('added').length, refreshed: opts.refresh ? t('arc.sumRefreshed', { n: c('refreshed').length }) : '', s: c('skipped').length, failed: nFail ? t('arc.sumFailed', { n: nFail }) : '' }));
    return c('missing').length + c('ambiguous').length + c('failed').length ? 1 : 0;
  }
  if (sub === 'list') {
    if (!dir) { console.error(t('common.error', { msg: t('arc.noDir') })); return 1; }
    let idx;
    try { idx = readIndex(dir); } catch (e) { console.error(t('common.error', { msg: e.message })); return 1; }
    idx = [...idx].sort((a, b) => String(a.first).localeCompare(String(b.first)));
    if (opts.json) { console.log(JSON.stringify(idx, null, 1)); return 0; }
    for (const it of idx) console.log(t('arc.listRow', { when: kst(it.first), hours: String(Number(it.hours).toFixed(1)).padStart(5), tools: String(it.tools).padStart(4), subs: String(it.subs).padStart(3), sid: it.sid.slice(0, 8), proj: it.proj, why: (it.why || []).join(', ') }));
    console.log(t('arc.listCount', { n: idx.length }));
    return 0;
  }
  console.log(t('arc.help'));
  return sub && sub !== 'help' ? 2 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
