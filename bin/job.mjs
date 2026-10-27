// agent4d job — Claude 세션 밖에서 따로 띄운 오래 도는 작업을 화면에 올리는 등록. Node 내장 모듈만.
//   agent4d job add --log <파일> [--pid N] [--pattern 정규식] [--total N] [--end <끝 표지 파일>] [--err <오류 로그>]
//                   [--expect 2h] [--name 이름] [--id ID] [--cwd <프로젝트 폴더>] [--session <세션 UUID>] [--keep 12h] [--stale 15m] [--json]
//       --pid 가 없으면 로그 경로로 명령줄을 뒤져 PID 를 찾는다(경로 전체 → 로그 폴더 + 파일 이름 낱말, 부모·자식 사슬은 맨 위 하나)
//       --err 가 없고 같은 폴더에 <이름>.err 가 있으면 그것. 시작 시각은 프로세스 생성 시각(못 찾으면 지금)
//   agent4d job list [--json]        등록된 작업과 지금 판정(진행·생존·끝)
//   agent4d job find --log <파일>    PID 후보만 보기(등록하지 않음)
//   agent4d job rm <id…>             서술 파일 지우기
//   agent4d job prune [--all]        끝난 지 keepSec 넘은 서술 파일 지우기(--all: 끝난 것 모두)
// 서술 파일 = <상태 폴더>/jobs/<id>.json(UTF-8, BOM 없음). 상시 서버가 4초마다 읽어 붙일 세션 메인 아래 작업 노드로 그린다.
// 프로세스를 끄거나 건드리지 않는다(생존 확인은 signal 0 — 끄지 않음).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cliLang } from '../server/cli-i18n.mjs';
import { ExtJobRegistry, extJobsDir, extJobView, normDescriptor, safeExtId, parseDuration } from '../server/extjobs.mjs';

const M = {
  en: {
    usage: 'Usage: agent4d job add --log <file> [--pid N] [--pattern RE] [--total N] [--end <file>] [--err <file>] [--expect 2h] [--name NAME] [--id ID] [--cwd DIR] [--session UUID] [--keep 12h] [--stale 15m] [--json]\n       agent4d job list [--json] | find --log <file> | rm <id…> | prune [--all]',
    noLog: '--log <file> is required.',
    noPid: 'No running process mentions {log} in its command line. Pass --pid N (or --end <file> to judge the end by a marker file only).',
    manyPid: 'More than one process matches {log}. Pass --pid N:',
    added: 'Registered {id} → {file}',
    bad: 'Invalid job: {why}',
    none: 'No jobs registered ({dir}).',
    removed: 'Removed {id}',
    notFound: 'No job {id}',
    pruned: 'Pruned {n} ended job(s).',
    cand: 'Candidates ({tier}):',
    noCand: 'No candidates.',
  },
  ko: {
    usage: '사용법: agent4d job add --log <파일> [--pid N] [--pattern 정규식] [--total N] [--end <파일>] [--err <파일>] [--expect 2h] [--name 이름] [--id ID] [--cwd 폴더] [--session UUID] [--keep 12h] [--stale 15m] [--json]\n       agent4d job list [--json] | find --log <파일> | rm <id…> | prune [--all]',
    noLog: '--log <파일> 이 필요합니다.',
    noPid: '명령줄에 {log} 를 가리키는 실행 중 프로세스가 없습니다. --pid N 을 주십시오(끝 표지 파일로만 판정하려면 --end <파일>).',
    manyPid: '{log} 에 맞는 프로세스가 둘 이상입니다. --pid N 으로 고르십시오:',
    added: '등록했습니다: {id} → {file}',
    bad: '잘못된 작업: {why}',
    none: '등록된 작업이 없습니다 ({dir}).',
    removed: '지웠습니다: {id}',
    notFound: '없는 작업: {id}',
    pruned: '끝난 작업 {n}개를 정리했습니다.',
    cand: '후보({tier}):',
    noCand: '후보 없음.',
  },
};
const tt = (k, v = {}) => String((M[cliLang()] || M.en)[k] ?? M.en[k]).replace(/\{(\w+)\}/g, (m, x) => (v[x] != null ? String(v[x]) : m));

/** --키 값 · --키=값 · --깃발. 값이 `-` 로 시작하는 정규식이면 --pattern=… 꼴로 */
export function parseJobArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] != null && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

// ───────────── PID 찾기 ─────────────

/** 실행 중 프로세스 [{pid, ppid, t(생성 ISO|null), cmd}] — Windows CIM, 그 밖 ps. 읽기만 */
export function listProcesses() {
  if (process.platform === 'win32') {
    const ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; ppid=$_.ParentProcessId; t=$(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }); cmd=$_.CommandLine } } | ConvertTo-Json -Compress";
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20, timeout: 60_000 });
    try { const j = JSON.parse(r.stdout || '[]'); return (Array.isArray(j) ? j : [j]).map((p) => ({ pid: +p.pid, ppid: +p.ppid, t: p.t || null, cmd: p.cmd || '' })); } catch { return []; }
  }
  const r = spawnSync('ps', ['-eo', 'pid=,ppid=,lstart=,args='], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return String(r.stdout || '').split('\n').map((l) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(l);
    if (!m) return null;
    const t = Date.parse(m[3]);
    return { pid: +m[1], ppid: +m[2], t: Number.isFinite(t) ? new Date(t).toISOString() : null, cmd: m[4] };
  }).filter(Boolean);
}

const GENERIC = new Set(['run', 'log', 'logs', 'out', 'output', 'err', 'stderr', 'stdout', 'nohup', 'tmp', 'job']);
// 로그를 읽기만 하는 것(꼬리 보기·검색)과 등록 도구 자신은 후보에서 뺀다 — 읽기 프로그램은 명령줄 첫 낱말(프로그램)로만 본다
// (인자 속 `--tag head` 같은 낱말을 읽기 프로그램으로 오인하지 않게)
const READER_PROGS = new Set(['tail', 'less', 'more', 'cat', 'grep', 'egrep', 'rg', 'findstr', 'head', 'type', 'wc', 'bat']);
const READER_RE = /Get-Content|Select-String|Get-CimInstance|\bagent4d\b|\bccviz\b|[\\/]bin[\\/]job\.mjs/i;
/** 명령줄 첫 낱말(따옴표 묶음 포함)의 파일 이름(확장자 뺌, 소문자) */
export function progOf(cmd) {
  const m = /^\s*(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(String(cmd || ''));
  const p = m ? m[1] ?? m[2] ?? m[3] : '';
  return path.basename(p.replace(/\\/g, '/')).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
}
const isReader = (cmd) => READER_PROGS.has(progOf(cmd)) || READER_RE.test(cmd);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 로그 경로 → PID 후보(순수). 1단계: 명령줄에 로그 전체 경로. 2단계: 로그 폴더 경로 + 파일 이름 낱말(run-fixed → fixed)이 모두 낱말로.
 * 부모·자식이 함께 맞으면(venv 실행기 → 실제 python, 셸 → 프로그램) 맨 위 하나만 roots 에 남긴다.
 * @returns {{ tier:'path'|'dir'|null, cands:object[], roots:object[], tokens:string[] }}
 */
export function pidCandidates(procs, logPath, { exclude = [] } = {}) {
  const norm = (s) => String(s || '').replace(/\\/g, '/').toLowerCase();
  const abs = path.resolve(logPath);
  const full = norm(abs), dir = norm(path.dirname(abs));
  const stem = path.basename(abs).replace(/\.[^.]+$/, '').toLowerCase();
  const tokens = stem.split(/[-_.\s]+/).filter((t) => t.length >= 2 && !GENERIC.has(t) && !/^\d+$/.test(t));
  const ex = new Set(exclude.map(Number));
  const ok = (procs || []).filter((p) => p && p.cmd && !ex.has(p.pid) && !isReader(p.cmd));
  let tier = 'path';
  let cands = ok.filter((p) => norm(p.cmd).includes(full));
  if (!cands.length) {
    tier = 'dir';
    const res = tokens.map((t) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escRe(t)}(?:$|[^\\p{L}\\p{N}])`, 'u'));
    cands = ok.filter((p) => { const s = norm(p.cmd); return s.includes(dir) && res.every((r) => r.test(s)); });
  }
  if (!cands.length) tier = null;
  const set = new Set(cands.map((p) => p.pid));
  const roots = cands.filter((p) => !set.has(p.ppid));
  return { tier, cands, roots, tokens };
}

/** 자기와 조상(이 명령을 부른 셸) PID — 후보에서 뺀다 */
function selfChain(procs) {
  const by = new Map(procs.map((p) => [p.pid, p]));
  const out = [process.pid];
  let cur = by.get(process.pid);
  for (let i = 0; cur && i < 16; i++) { out.push(cur.ppid); cur = by.get(cur.ppid); }
  return out;
}

// ───────────── 명령 ─────────────

function writeAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/** 인자 → 서술 원본(검증 전). 프로세스 목록은 PID·시작 시각 찾기에만 */
export function buildDescriptor(o, { procs = null, now = Date.now(), exists = fs.existsSync } = {}) {
  const log = path.resolve(String(o.log));
  const raw = { v: 1, log, createdAt: new Date(now).toISOString() };
  if (o.name && o.name !== true) raw.name = String(o.name);
  if (o.pattern && o.pattern !== true) raw.pattern = String(o.pattern);
  if (o.total != null && o.total !== true) raw.total = Number(String(o.total).replace(/,/g, ''));
  if (o.end && o.end !== true) raw.endFile = path.resolve(String(o.end));
  if (o.expect && o.expect !== true) raw.expectSec = parseDuration(o.expect);
  if (o.keep && o.keep !== true) raw.keepSec = parseDuration(o.keep);
  if (o.stale && o.stale !== true) raw.staleSec = parseDuration(o.stale);
  if (o.cwd && o.cwd !== true) raw.cwd = path.resolve(String(o.cwd));
  if (o.session && o.session !== true) raw.sessionId = String(o.session);
  if (o['error-pattern'] != null) raw.errorPattern = o['error-pattern'] === true ? '' : String(o['error-pattern']);
  if (o.err && o.err !== true) raw.errLog = path.resolve(String(o.err));
  else { const sib = log.replace(/\.[^.\\/]+$/, '') + '.err'; if (sib !== log && exists(sib)) raw.errLog = sib; }
  let pick = null;
  if (o.pid != null && o.pid !== true) raw.pid = Number(o.pid);
  else if (procs) {
    const r = pidCandidates(procs, log, { exclude: selfChain(procs) });
    if (r.roots.length === 1) { pick = r.roots[0]; raw.pid = pick.pid; }
    else return { raw, pick: null, cands: r };
  }
  if (raw.pid && procs) { const p = procs.find((x) => x.pid === raw.pid); if (p && p.t) raw.startedAt = p.t; }
  if (o.started && o.started !== true) raw.startedAt = String(o.started);
  if (!raw.startedAt) raw.startedAt = new Date(now).toISOString();
  raw.id = safeExtId(o.id && o.id !== true ? o.id : `${path.basename(path.dirname(log))}-${path.basename(log).replace(/\.[^.]+$/, '')}`);
  return { raw, pick, cands: null };
}

function cmdAdd(o, out, err) {
  if (!o.log || o.log === true) { err(tt('noLog')); err(tt('usage')); return 2; }
  const needProcs = o.pid == null || o.pid === true;
  const procs = needProcs || !o.started ? listProcesses() : null;
  const b = buildDescriptor(o, { procs });
  if (b.cands) {
    if (o.end && o.end !== true && !b.cands.roots.length) { /* 끝 표지로만 판정 */ }
    else if (!b.cands.roots.length) { err(tt('noPid', { log: b.raw.log })); return 1; }
    else { err(tt('manyPid', { log: b.raw.log })); for (const p of b.cands.roots) err(`  ${p.pid}  ${p.cmd.slice(0, 200)}`); return 1; }
    b.raw.startedAt = b.raw.startedAt || new Date().toISOString();
    b.raw.id = safeExtId(o.id && o.id !== true ? o.id : `${path.basename(path.dirname(b.raw.log))}-${path.basename(b.raw.log).replace(/\.[^.]+$/, '')}`);
  }
  const r = normDescriptor(b.raw, { id: b.raw.id });
  if (!r.ok) { err(tt('bad', { why: r.errors.join(' · ') })); return 2; }
  const file = path.join(extJobsDir(), `${r.desc.id}.json`);
  writeAtomic(file, b.raw);
  if (o.json) out(JSON.stringify({ id: r.desc.id, file, descriptor: b.raw }));
  else out(tt('added', { id: r.desc.id, file }) + (b.pick ? `  (PID ${b.pick.pid}${b.raw.errLog ? ' · err ' + path.basename(b.raw.errLog) : ''})` : ''));
  return 0;
}

function cmdList(o, out) {
  const reg = new ExtJobRegistry({ prune: false });
  reg.refresh({ force: true });
  const now = Date.now();
  const rows = [...reg.jobs.values()].map((st) => ({ id: st.id, file: st.file, job: extJobView(st, now) }));
  if (o.json) { out(JSON.stringify({ dir: reg.dir, jobs: rows, errors: Object.fromEntries(reg.errors) })); return 0; }
  if (!rows.length && !reg.errors.size) { out(tt('none', { dir: reg.dir })); return 0; }
  for (const r of rows) {
    const j = r.job;
    const alive = j.ext.pid ? (j.ext.alive ? 'alive' : 'gone') : '-';
    out(`${r.id}  [${j.state}${j.ext.reason ? ':' + j.ext.reason : ''}]  ${j.host || ''} ${alive}  ${j.title}`);
    if (j.phase) out(`    ${j.phase}`);
    if (j.line) out(`    › ${j.line}`);
  }
  for (const [f, e] of reg.errors) out(`! ${f}: ${e}`);
  return 0;
}

function cmdFind(o, out, err) {
  if (!o.log || o.log === true) { err(tt('noLog')); return 2; }
  const procs = listProcesses();
  const r = pidCandidates(procs, String(o.log), { exclude: selfChain(procs) });
  if (o.json) { out(JSON.stringify(r)); return 0; }
  if (!r.cands.length) { out(tt('noCand')); return 1; }
  out(tt('cand', { tier: r.tier }));
  const roots = new Set(r.roots.map((p) => p.pid));
  for (const p of r.cands) out(`  ${roots.has(p.pid) ? '*' : ' '} ${p.pid} (ppid ${p.ppid}) ${p.t || ''}  ${p.cmd.slice(0, 200)}`);
  return 0;
}

function cmdRm(o, out, err) {
  let rc = 0;
  for (const id of o._.slice(1)) {
    const file = path.join(extJobsDir(), `${safeExtId(id)}.json`);
    try { fs.unlinkSync(file); out(tt('removed', { id })); } catch { err(tt('notFound', { id })); rc = 1; }
  }
  return rc;
}

function cmdPrune(o, out) {
  const reg = new ExtJobRegistry({ prune: false });
  reg.refresh({ force: true });
  const now = Date.now();
  let n = 0;
  for (const st of reg.jobs.values()) {
    if (!st.end) continue;
    if (!o.all && now - st.endedAt <= (st.desc.keepSec ?? 12 * 3600) * 1000) continue;
    try { fs.unlinkSync(st.file); n++; } catch {}
  }
  out(tt('pruned', { n }));
  return 0;
}

export async function main(argv = process.argv.slice(2), { out = (s) => process.stdout.write(s + '\n'), err = (s) => process.stderr.write(s + '\n') } = {}) {
  const o = parseJobArgs(argv);
  switch (o._[0]) {
    case 'add': return cmdAdd(o, out, err);
    case 'list': case 'ls': return cmdList(o, out);
    case 'find': return cmdFind(o, out, err);
    case 'rm': case 'remove': return cmdRm(o, out, err);
    case 'prune': return cmdPrune(o, out);
    default: out(tt('usage')); return o._[0] && o._[0] !== 'help' ? 2 : 0;
  }
}
