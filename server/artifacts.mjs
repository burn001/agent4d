// 작업 대상 층 — 서버: 도구 호출 → 대상 참조(art) 추출, 이벤트 정리, 프로젝트별 최근 7일 누적(ArtifactStore).
// 규칙의 순수 부분(장부·접기·정리)은 web/artifact-core.mjs 와 같은 것을 쓴다(서버 재구성 = 웹 장부).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact } from './redact.mjs';
import { classifyStart, classifyEnd } from './interactions.mjs';
import { fileKey, baseOf, shellWriteTargets, lexShell } from '../web/conflict-core.mjs';
import { ART, ArtBook, sanitizeArt as sanitizeCore, foldRef, foldItem, countKinds } from '../web/artifact-core.mjs';

export { ART };
const log = (...a) => console.error('[ccviz] artifacts', ...a);

// 문서·이미지 출력(산출물) 확장자
export const OUTPUT_EXT = /\.(hwpx|hwp|pdf|docx|doc|xlsx|xls|pptx|ppt|png|jpe?g|gif|webp|svg|mp3|wav|mp4|webm|zip|csv)$/i;
const SECRET_RE = /(^|\/)(\.env(\.[\w-]+)?$|secrets?(\/|$)|credentials?|[^/]*\.(pem|key|pfx|p12)$|id_rsa|id_ed25519|[^/]*token[^/]*$|\.npmrc$|\.pypirc$)/i;
const FINAL_RE = /(최종|제출|final|submit|release)/i;
const PROD_RE = /(prod|live|deploy|release|www)/i;

// ───────────── 경로 표시 ─────────────
/** 대소문자를 살린 정규화 경로(fileKey 와 같은 규칙, 드라이브 경로 소문자화만 안 함) */
export function pathCase(p, cwd = null) {
  if (!p || typeof p !== 'string') return null;
  let s = p.trim().replace(/^["']|["']$/g, '');
  if (!s) return null;
  s = s.replace(/\\/g, '/');
  const abs = /^[A-Za-z]:\//.test(s) || s.startsWith('/') || s.startsWith('~');
  if (!abs && cwd) s = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '') + '/' + s;
  const drive = /^([A-Za-z]):\//.exec(s);
  const head = drive ? drive[1].toLowerCase() + ':' : s.startsWith('/') ? '' : null;
  const rest = drive ? s.slice(3) : s.startsWith('/') ? s.slice(1) : s;
  const out = [];
  for (const seg of rest.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (out.length) out.pop(); continue; }
    out.push(seg);
  }
  return ((head != null ? head + '/' : '') + out.join('/')) || null;
}
const HOME = (() => { try { return pathCase(os.homedir()); } catch { return null; } })();
/**
 * 절대 경로 → 표시 경로: 프로젝트(root) 안이면 상대 경로, 홈 아래면 '~/…', 그 밖은 정규화 절대 경로.
 * 반환 {id(비교 열쇠, 드라이브 경로면 소문자), p(대소문자 살린 표시), d(폴더), n(파일명)}
 */
export function displayPath(abs, root = null, home = HOME) {
  const P = pathCase(abs);
  if (!P) return null;
  const low = /^[a-z]:\//i.test(P);
  const cmp = (a) => (low ? String(a || '').toLowerCase() : String(a || ''));
  const R = root ? pathCase(root) : null;
  let p = P;
  if (R && (cmp(P) === cmp(R) || cmp(P).startsWith(cmp(R) + '/'))) p = P.slice(R.length + 1) || baseOf(P);
  else if (home && cmp(P).startsWith(cmp(home) + '/')) p = '~/' + P.slice(home.length + 1);
  const id = low ? p.toLowerCase() : p;
  const i = p.lastIndexOf('/');
  return { id, p, d: i < 0 ? '' : p.slice(0, i), n: i < 0 ? p : p.slice(i + 1) };
}

const lines = (s) => (typeof s === 'string' && s ? s.split('\n').length : 0);
function fileArt(abs, cwd, root, v, extra = {}) {
  const k = fileKey(abs, cwd);
  if (!k) return null;
  const dp = displayPath(pathCase(abs, cwd), root);
  if (!dp) return null;
  const kind = OUTPUT_EXT.test(dp.n) ? 'output' : 'file';
  const o = { k: kind, id: dp.id, p: dp.p, d: dp.d, n: dp.n, v, ...extra };
  if (SECRET_RE.test(dp.p)) o.imp = 'secret';
  else if (kind === 'output' && FINAL_RE.test(dp.n) && v !== 'read') o.imp = 'final';
  return o;
}

// ───────────── 셸: 삭제 대상·산출물 인자·서비스 ─────────────
const RM_PROGS = new Set(['rm', 'rmdir', 'del', 'erase', 'rd', 'remove-item', 'ri', 'unlink', 'shred']);
/** 셸 명령 → 지우는 경로들 [{w, rec}] (rec = 재귀·강제) */
export function shellDeletes(command, shell = 'Bash') {
  if (typeof command !== 'string' || !command.trim()) return [];
  const ps = /^(powershell|ps|pwsh)$/i.test(String(shell));
  const out = [];
  let segs = [];
  try { segs = lexShell(command.length > 20000 ? command.slice(0, 20000) : command, ps); } catch { return []; }
  for (const seg of segs) {
    const words = seg.filter((t) => !t.op);
    let s = 0;
    while (s < words.length && /^(sudo|command|env|exec|nohup|time)$/.test(words[s].w)) s++;
    if (s >= words.length || words[s].dyn) continue;
    let prog = String(words[s].w).split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
    let rest = words.slice(s + 1);
    if (prog === 'git' && rest[0] && rest[0].w === 'rm') { prog = 'rm'; rest = rest.slice(1); }
    if (!RM_PROGS.has(prog)) continue;
    const flags = rest.filter((t) => /^-|^\//.test(t.w) && !t.q && !/^\/[A-Za-z0-9_.-]+\//.test(t.w)).map((t) => t.w.toLowerCase());
    const rec = flags.some((f) => /^-[a-z]*[rf]/.test(f) || f === '--recursive' || f === '--force' || f.startsWith('-rec') || f.startsWith('-fo') || f === '/s' || f === '/q');
    for (const t of rest) {
      if (t.dyn || (!t.q && /^-/.test(t.w)) || (!t.q && /^\/[sqfa]$/i.test(t.w))) continue;
      const w = t.w;
      if (!w || /[*?]/.test(w) || /^(\/dev\/|nul$)/i.test(w) || /appdata\/local\/temp|^\/tmp\//i.test(w.replace(/\\/g, '/'))) continue;
      out.push({ w, rec: rec || prog === 'rmdir' || prog === 'rd' });
      if (out.length >= 8) return out;
    }
  }
  return out;
}

/** 명령 인자 속 산출물 경로(-o/--out/--output/--outfile/-OutFile/--screenshot …) */
export function shellOutputs(command) {
  if (typeof command !== 'string') return [];
  const out = [];
  const re = /(?:^|\s)(?:-o|--out|--output|--outfile|--out-file|-OutFile|-Destination|--screenshot|--print-to-pdf)(?:=|\s+)("[^"]+"|'[^']+'|[^\s;|&]+)/gi;
  for (let m; (m = re.exec(command));) {
    const w = m[1].replace(/^["']|["']$/g, '');
    if (OUTPUT_EXT.test(w) && !/[$`*?]/.test(w)) out.push(w);
    if (out.length >= 4) break;
  }
  return out;
}

const SVC_PROGS = {
  gws: 'Google Workspace', cf: 'Cloudflare', wrangler: 'Cloudflare', aws: 'AWS', gcloud: 'Google Cloud', gsutil: 'Google Cloud', az: 'Azure',
  vercel: 'Vercel', netlify: 'Netlify', firebase: 'Firebase', stripe: 'Stripe', heroku: 'Heroku', flyctl: 'Fly.io', fly: 'Fly.io',
  docker: 'Docker', 'docker-compose': 'Docker', kubectl: 'Kubernetes', terraform: 'Terraform', supabase: 'Supabase', slack: 'Slack',
};
// node·python·bash 로 부르는 자기 도구 스크립트 → 서비스 이름. 기본은 비어 있고, config.serviceScripts
// ([{ pattern: '정규식(대소문자 무시)', name: '표시 이름' }])로 사용자가 채운다(server/index.mjs 가 setServiceScripts 로 넣음)
let SVC_SCRIPT = [];
/** 사용자 설정 서비스 스크립트 매핑을 넣는다. 잘못된 항목·정규식은 조용히 건너뛴다. 넣은 개수를 돌려준다 */
export function setServiceScripts(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list.slice(0, 64) : []) {
    if (!x || typeof x.pattern !== 'string' || typeof x.name !== 'string' || !x.pattern || !x.name.trim()) continue;
    try { out.push([new RegExp(x.pattern.slice(0, 500), 'i'), x.name.trim().slice(0, 40)]); } catch {}
  }
  SVC_SCRIPT = out;
  return out.length;
}
const SVC_W = /\b(send|create|deploy|publish|put|post|upload|delete|update|set|write|insert|remove|push|apply|patch|trash|move|submit|approve|rotate|secret)\b|\+send|--submit|--yes/i;
const LOCAL_HOST = /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)/i;

/** 셸 명령 → 외부 서비스 참조들 [{name, w}] */
export function shellServices(command) {
  if (typeof command !== 'string') return [];
  const out = [], seen = new Set();
  let segs = [];
  try { segs = lexShell(command.length > 20000 ? command.slice(0, 20000) : command, false); } catch { return []; }
  for (const seg of segs) {
    const words = seg.filter((t) => !t.op).map((t) => t.w);
    let s = 0;
    while (s < words.length && /^(sudo|npx|env|command|exec|[A-Za-z_]\w*=.*)$/.test(words[s])) s++;
    const prog = String(words[s] || '').split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd)$/, '');
    const args = words.slice(s + 1).join(' ');
    let name = SVC_PROGS[prog] || null;
    if (!name && (prog === 'node' || prog === 'python' || prog === 'python3' || prog === 'bash')) for (const [re, nm] of SVC_SCRIPT) if (re.test(args)) { name = nm; break; }
    if (!name && /^(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm|http|https)$/.test(prog)) {
      const m = /https?:\/\/([^/\s'"?:]+)/i.exec(args);
      if (m && !LOCAL_HOST.test(m[1])) {
        name = m[1].replace(/^www\./, '').split('.').slice(-2).join('.');
        const w = /(-X|--request|-Method)\s+(POST|PUT|PATCH|DELETE)/i.test(args) || /(^|\s)(-d|--data[\w-]*|-F|--form|-Body)(\s|=)/.test(args);
        if (!seen.has(name)) { seen.add(name); out.push({ name, w }); }
        continue;
      }
    }
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, w: SVC_W.test(args) });
  }
  return out;
}

// ───────────── DB 세부 ─────────────
const DROP_RE = /\bdrop\s+(table|database|collection|schema)\b|\.drop(Database)?\s*\(\s*\)|\btruncate\s+(table\s+)?\w|\bdeleteMany\s*\(\s*\{\s*\}\s*\)|\bflush(all|db)\b|\bdropDatabase\b/i;
/** 명령 글 → 컬렉션·표 이름들(≤4) */
export function dbCollections(cmd) {
  const s = String(cmd || '');
  const out = new Set();
  for (const m of s.matchAll(/\bdb\.(?!getCollection\b|getSiblingDB\b|runCommand\b|adminCommand\b|stats\b|dropDatabase\b)([A-Za-z_][\w-]{0,39})\s*\./g)) out.add(m[1]);
  for (const m of s.matchAll(/getCollection\(\s*['"]([\w.-]{1,40})['"]\s*\)/g)) out.add(m[1]);
  for (const m of s.matchAll(/\b(?:from|into|update|join|table)\s+["`]?([A-Za-z_][\w]{0,39})["`]?/gi)) if (!/^(select|set|where|values|the|a|an|exists|if)$/i.test(m[1])) out.add(m[1]);
  return [...out].slice(0, 4);
}

// ───────────── 추출 ─────────────
const repoArt = (cwd, ix) => {
  const base = cwd ? baseOf(pathCase(cwd) || '') : '';
  const name = (base || 'repo');
  return { k: 'repo', id: 'repo:' + name.toLowerCase(), n: name };
};
const GH_VERB = { push: 'push', commit: 'write', merge: 'write', rebase: 'write', tag: 'write', 'pr-create': 'write', 'pr-merge': 'write', release: 'write', pull: 'read', fetch: 'read', clone: 'read' };

/**
 * 도구 호출 시작 → 대상 참조 배열(없으면 []). ctx = {cwd(기록 cwd), root(프로젝트 루트 = 메인 cwd), ix(classifyStart 결과, 없으면 계산)}
 * 참조 모양 {k, id, v, n?, p?, d?, sz?, x?, imp?, est?, coll?} (계약)
 */
export function artStart(tool, input = {}, ctx = {}) {
  const name = String(tool || '');
  const inp = input && typeof input === 'object' ? input : {};
  const cwd = ctx.cwd || null, root = ctx.root || cwd;
  const out = [];
  const push = (r) => { if (r && out.length < 8 && !out.some((x) => x.id === r.id && x.v === r.v)) out.push(r); };
  if (name === 'Write') push(fileArt(inp.file_path, cwd, root, 'write', { sz: lines(inp.content) }));
  else if (name === 'Edit') push(fileArt(inp.file_path, cwd, root, 'modify', { sz: Math.max(lines(inp.old_string), lines(inp.new_string)) }));
  else if (name === 'MultiEdit') push(fileArt(inp.file_path, cwd, root, 'modify', { sz: (Array.isArray(inp.edits) ? inp.edits : []).reduce((a, e) => a + Math.max(lines(e && e.old_string), lines(e && e.new_string)), 0) }));
  else if (name === 'NotebookEdit') push(fileArt(inp.notebook_path, cwd, root, 'modify', { sz: lines(inp.new_source) }));
  else if (name === 'Read' || name === 'NotebookRead') push(fileArt(inp.file_path || inp.notebook_path, cwd, root, 'read'));
  else if (name === 'Artifact') {
    const act = String(inp.action || 'publish');
    if (act === 'publish' && !inp.asset) {
      const t = String(inp.title || (inp.file_path ? baseOf(pathCase(inp.file_path) || '') : '') || 'artifact').slice(0, 60);
      push({ k: 'output', id: 'artifact:' + t.toLowerCase(), n: t, d: '산출물', v: inp.url ? 'modify' : 'create' });
    }
  } else if (name === 'Bash' || name === 'PowerShell') {
    const cmd = typeof inp.command === 'string' ? inp.command : '';
    if (!cmd) return out;
    const win = /^[A-Za-z]:[\\/]/.test(String(cwd || ''));
    const fix = (p) => (win && name === 'Bash' ? p.replace(/^\/([A-Za-z])(\/|$)/, (_, d) => `${d}:/`) : p);
    const dels = shellDeletes(cmd, name);
    for (const d of dels) push(fileArt(fix(d.w), cwd, root, 'delete', { est: 1, ...(d.rec ? { x: 'rm' } : {}) }));
    const delSet = new Set(out.map((r) => r.id));
    for (const w of shellOutputs(cmd)) { const r = fileArt(fix(w), cwd, root, 'create', { est: 1 }); if (r && !delSet.has(r.id)) push(r); }
    for (const w of shellWriteTargets(cmd, name)) { const r = fileArt(fix(w), cwd, root, 'modify', { est: 1 }); if (r && !delSet.has(r.id)) push(r); }
    const ix = ctx.ix !== undefined ? ctx.ix : classifyStart(name, inp);
    if (ix) ixArts(ix, cmd, cwd).forEach(push);
    for (const s of shellServices(cmd)) push({ k: 'service', id: 'svc:' + s.name.toLowerCase(), n: s.name, v: s.w ? 'write' : 'query' });
  } else if (name.startsWith('mcp__')) {
    const ix = ctx.ix !== undefined ? ctx.ix : classifyStart(name, inp);
    if (ix && (ix.cat === 'github' || ix.cat === 'db' || ix.cat === 'remote')) ixArts(ix, typeof inp.query === 'string' ? inp.query : typeof inp.sql === 'string' ? inp.sql : '', cwd).forEach(push);
    else {
      const [, server = '', fn = ''] = name.split('__');
      const nm = server.replace(/^plugin_[\w-]+?_/, '').replace(/[_-]+/g, ' ').trim().slice(0, 40) || server;
      if (!/^(context7|rea)$/i.test(nm)) push({ k: 'service', id: 'svc:' + nm.toLowerCase(), n: nm, v: SVC_W.test(fn.replace(/_/g, ' ')) ? 'write' : 'query' });
    }
  }
  return out;
}

/** ix(github·db·remote) → 대상 참조 */
function ixArts(ix, cmd, cwd) {
  const out = [];
  if (ix.cat === 'github') {
    const v = GH_VERB[ix.op] || 'query';
    const r = { ...repoArt(cwd, ix), v };
    if (ix.op === 'push' && (ix.force || /\s(--force|-f|--force-with-lease)\b/.test(cmd))) r.x = 'force';
    out.push(r);
  } else if (ix.cat === 'db') {
    const eng = ix.engine || 'db';
    const dbn = ix.db || 'default';
    const w = ix.rw === 'w' || ix.rw === 'rw';
    const r = { k: 'db', id: `db:${eng}/${dbn}`.toLowerCase(), n: ix.db ? `${ix.db}` : eng, v: w ? 'write' : 'query' };
    const coll = dbCollections(cmd);
    if (coll.length) r.coll = coll;
    if (DROP_RE.test(cmd)) r.x = 'drop';
    if (w) r.imp = 'db';
    if (ix.weak) r.est = 1;
    out.push(r);
  } else if (ix.cat === 'remote' && ix.host) {
    const v = ix.transfer === 'up' ? 'write' : ix.transfer === 'down' ? 'read' : 'query';
    const r = { k: 'remote', id: 'remote:' + String(ix.host).toLowerCase(), n: ix.host, v };
    if (PROD_RE.test(ix.host) || (ix.transfer === 'up' && /\/(srv|var\/www|www|deploy|prod)\b/.test(cmd))) r.imp = 'prod';
    out.push(r);
  }
  if (ix.also && ix.also.includes('db') && ix.cat !== 'db') {
    const r = { k: 'db', id: 'db:db/default', n: 'db', v: /insert|update|delete|drop|create/i.test(cmd) ? 'write' : 'query', est: 1 };
    out.push(r);
  }
  return out;
}

/**
 * 도구 결과로 참조를 다듬는다(실패면 null): Write 는 만듦/덮어쓰기, Edit 는 실제 diff 줄 수, DB 는 행 수, push 는 커밋 수·저장소 이름.
 * res = {ok, tur(toolUseResult), ixEnd(classifyEnd 결과)}
 */
export function artEnd(arts, res = {}) {
  if (!Array.isArray(arts) || !arts.length || res.ok === false) return null;
  const tur = res.tur && typeof res.tur === 'object' ? res.tur : null;
  const ixe = res.ixEnd || null;
  return arts.map((r0) => {
    const r = { ...r0 };
    if ((r.k === 'file' || r.k === 'output') && tur) {
      if (r.v === 'write' && (tur.type === 'create' || tur.type === 'update')) {
        if (tur.type === 'create') r.v = 'create';
        else { r.v = 'modify'; r.x = r.x || 'overwrite'; }
      }
      if (Array.isArray(tur.structuredPatch) && (r.v === 'modify' || r.v === 'create')) {
        let n = 0;
        for (const h of tur.structuredPatch) for (const l of (h && h.lines) || []) if (l[0] === '+' || l[0] === '-') n++;
        if (n) r.sz = n;
      }
    }
    if (r.k === 'db' && ixe && Number.isFinite(ixe.rows)) r.rows = ixe.rows;
    if (r.k === 'repo' && ixe) { if (Number.isFinite(ixe.commits)) r.c = ixe.commits; if (ixe.repo) r.n = String(ixe.repo).slice(0, 60); if (ixe.force) r.x = 'force'; }
    return r;
  });
}

/** graph.emit 이 부르는 정리: redact·길이·열거형, privacy minimal 이면 접기(파일명 해시 등) */
export function sanitizeArt(arr, privacy = 'summary') {
  return sanitizeCore(arr, { redact, fold: privacy === 'minimal' });
}

// ───────────── 외부 고정 링크(요청 Host 가 로컬이 아님): 응답마다 접기 ─────────────
export function isExternalReq(req) {
  const h = String(req?.headers?.host || '').replace(/:\d+$/, '').toLowerCase();
  return !(h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1');
}
/** 이벤트 하나(art 가 있으면 접은 복사본) */
export function externalEv(ev) {
  if (ev && Array.isArray(ev.arts)) return { ...ev, arts: ev.arts.map((a) => (a && Array.isArray(a.art) ? { ...a, art: a.art.map(foldRef) } : a)) }; // tool-summary
  if (!ev || !Array.isArray(ev.art)) return ev;
  return { ...ev, art: ev.art.map(foldRef) };
}
/** 스냅샷(recent 안 이벤트들) */
export function externalSnap(snap) {
  if (!snap || !Array.isArray(snap.recent) || !snap.recent.some((e) => e && e.art)) return snap;
  return { ...snap, recent: snap.recent.map(externalEv) };
}
export function externalPayload(p) {
  if (!p || !Array.isArray(p.items)) return p;
  return { ...p, items: p.items.map(foldItem), folded: true };
}

// ───────────── 누적: 프로젝트별 최근 7일(ArtifactStore) ─────────────
const TOOL_PICK = /"type":"tool_use"/;
const B_TOOL_USE = Buffer.from('"type":"tool_use"'), B_TUID = Buffer.from('"tool_use_id":"');
const SCAN_PAR = 4; // 동시에 훑는 파일 수
const LINE_MAX = 24 << 20; // 이보다 긴 줄(거대한 붙여넣기·요청 덩어리)은 건너뜀
const RESULT_PICK = /"tool_use_id":"([^"]+)"/;
const ANY_ART_TOOL = /"name":"(Write|Edit|MultiEdit|NotebookEdit|Read|NotebookRead|Bash|PowerShell|Artifact|mcp__[^"]+)"/;

/**
 * 한 transcript 파일을 이어 읽으며 대상 기록을 모은다(바이트 오프셋 이어 읽기, 줄 경계 보관).
 * 기록 = {t, node, tu, art:[…]} (끝 = 성공한 결과까지 본 것만, 대상 장부와 같은 규칙)
 */
class FileScan {
  constructor(file, nodeId, root) {
    this.file = file; this.node = nodeId; this.root = root;
    this.off = 0; this.part = []; this.partLen = 0; this.size = -1; this.mtime = 0;
    this.pending = new Map(); // tool_use id → {t, arts, ix, cmd}
    this.recs = [];
  }
  async update() {
    let st;
    try { st = await fs.promises.stat(this.file); } catch { return false; }
    if (st.size === this.size && st.mtimeMs === this.mtime) return false;
    if (st.size < this.off) { this.off = 0; this.part = []; this.partLen = 0; this.recs = []; this.pending.clear(); }
    this.size = st.size; this.mtime = st.mtimeMs;
    if (st.size <= this.off) return false;
    const fh = await fs.promises.open(this.file, 'r');
    try {
      const CH = 4 << 20;
      let pos = this.off, k = 0;
      while (pos < st.size) {
        const b = Buffer.allocUnsafe(Math.min(CH, st.size - pos));
        const { bytesRead: n } = await fh.read(b, 0, b.length, pos);
        if (!n) break;
        pos += n;
        // 줄 나누기는 바이트에서(긴 줄을 문자열로 이어 붙이면 제곱 시간) — 관심 있는 줄만 문자열로 푼다
        let start = 0;
        for (let i = b.indexOf(10, 0); i >= 0 && i < n; i = b.indexOf(10, start)) {
          if (this.partLen) {
            if (this.partLen + (i - start) <= LINE_MAX) this._buf(Buffer.concat([...this.part, b.subarray(start, i)]));
            this.part = []; this.partLen = 0;
          } else this._buf(b.subarray(start, i));
          start = i + 1;
        }
        if (start < n) {
          if (this.partLen + (n - start) <= LINE_MAX) this.part.push(Buffer.from(b.subarray(start, n)));
          this.partLen += n - start;
        }
        if (++k % 4 === 0) await new Promise((r) => setImmediate(r)); // 큰 파일은 사이사이 양보
      }
      this.off = pos;
    } finally { await fh.close(); }
    return true;
  }
  /** 줄 하나(Buffer): 도구 호출이 든 줄·기다리는 결과 줄만 문자열로 */
  _buf(buf) {
    if (buf.length < 40) return;
    if (buf.indexOf(B_TOOL_USE) >= 0) { const s = buf.toString('utf8'); if (ANY_ART_TOOL.test(s)) this._line(s); return; }
    if (!this.pending.size) return;
    const j = buf.indexOf(B_TUID);
    if (j < 0) return;
    const e = buf.indexOf(34, j + B_TUID.length);
    if (e < 0 || !this.pending.has(buf.toString('utf8', j + B_TUID.length, e))) return;
    this._line(buf.toString('utf8'));
  }
  _line(line) {
    if (line.length < 40 || line.startsWith('{"type":"api-request')) return;
    if (TOOL_PICK.test(line) && ANY_ART_TOOL.test(line)) {
      let rec; try { rec = JSON.parse(line); } catch { return; }
      if (rec.type !== 'assistant') return;
      const t = Date.parse(rec.timestamp) || 0;
      const cwd = rec.cwd || this.root;
      for (const b of rec.message?.content || []) {
        if (!b || b.type !== 'tool_use' || !b.id) continue;
        let ix = null;
        try { ix = classifyStart(b.name, b.input || {}); } catch {}
        let arts = [];
        try { arts = artStart(b.name, b.input || {}, { cwd, root: this.root, ix }); } catch {}
        if (!arts.length) continue;
        this.pending.set(b.id, { t, arts, ix, cmd: typeof b.input?.command === 'string' ? b.input.command.slice(0, 4000) : '' });
        if (this.pending.size > 4000) this.pending.delete(this.pending.keys().next().value);
      }
      return;
    }
    if (!this.pending.size) return;
    const m = RESULT_PICK.exec(line);
    if (!m || !this.pending.has(m[1])) return;
    let rec; try { rec = JSON.parse(line); } catch { return; }
    if (rec.type !== 'user') return;
    for (const it of Array.isArray(rec.message?.content) ? rec.message.content : []) {
      if (!it || it.type !== 'tool_result') continue;
      const p = this.pending.get(it.tool_use_id);
      if (!p) continue;
      this.pending.delete(it.tool_use_id);
      const ok = !it.is_error;
      if (!ok) continue;
      const tur = rec.toolUseResult && typeof rec.toolUseResult === 'object' ? rec.toolUseResult : null;
      let ixEnd = null;
      if (p.ix && p.ix.phase === 'start' && (p.ix.cat === 'db' || p.ix.cat === 'github')) {
        const body = typeof it.content === 'string' ? it.content : Array.isArray(it.content) ? it.content.map((x) => (x && x.text) || '').join('\n') : '';
        try { ixEnd = classifyEnd(p.ix, { ok, stdout: tur?.stdout, stderr: tur?.stderr, body: tur && tur.stdout != null ? '' : body, cmd: p.cmd, tur }); } catch {}
      }
      const arts = artEnd(p.arts, { ok, tur, ixEnd });
      if (arts) this.recs.push({ t: Date.parse(rec.timestamp) || p.t, node: this.node, tu: it.tool_use_id, art: arts });
    }
  }
  prune(lo) { if (this.recs.length && this.recs[0].t < lo) this.recs = this.recs.filter((r) => r.t >= lo); }
}

/**
 * 프로젝트별 최근 7일 작업 대상. 처음 요청 때 그 프로젝트의 transcript(메인 + subagents·workflows)를 훑고(비동기, 진행 중이면 building),
 * 뒤로는 바뀐 파일만 이어 읽는다. until(재생 시점)을 주면 그 시각까지의 상태.
 * 비용: 실측 1.1GB/7일(큰 프로젝트) 첫 훑기 수 초～수십 초(백그라운드), 이후 요청은 바뀐 바이트만. 기록은 메모리(대상 기록 ~200B/건).
 */
export class ArtifactStore {
  constructor({ index, privacy = 'summary', windowMs = ART.WINDOW_MS, minRefreshMs = 4000 } = {}) {
    this.index = index;
    this.privacy = privacy;
    this.windowMs = windowMs;
    this.minRefreshMs = minRefreshMs;
    this.projects = new Map(); // pid → {files:Map<file,FileScan>, at, building:Promise|null, labels:Map}
  }
  _P(pid) { let P = this.projects.get(pid); if (!P) { P = { files: new Map(), at: 0, building: null, labels: new Map(), ready: false, bytes: 0 }; this.projects.set(pid, P); } return P; }

  async _listFiles(pid, lo) {
    const out = [];
    for (const e of this.index.entries.values()) {
      if (e.projectDir !== pid || e.mtimeMs < lo) continue;
      let head = null;
      try { head = await this.index.ensureHead(e); } catch {}
      const root = head?.cwd || null;
      out.push({ file: e.file, node: `s:${e.sessionId}`, root, sid: e.sessionId, entry: e });
      const scan = async (dir, depth) => {
        let ents = [];
        try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const d of ents) {
          const p = path.join(dir, d.name);
          if (d.isDirectory()) { if (depth < 3) await scan(p, depth + 1); continue; }
          const m = /^agent-(.+)\.jsonl$/.exec(d.name);
          if (!m) continue;
          let st; try { st = await fs.promises.stat(p); } catch { continue; }
          if (st.mtimeMs < lo) continue;
          out.push({ file: p, node: `a:${m[1]}`, root, sid: e.sessionId, meta: p.replace(/\.jsonl$/, '.meta.json') });
        }
      };
      await scan(path.join(e.projectPath, e.sessionId, 'subagents'), 0);
    }
    return out;
  }

  async _refresh(pid) {
    const P = this._P(pid);
    const lo = Date.now() - this.windowMs - 86_400_000; // 하루 여유(재생 시점 창)
    const files = await this._listFiles(pid, lo);
    const keep = new Set();
    let bytes = 0;
    const one = async (f) => {
      keep.add(f.file);
      let S = P.files.get(f.file);
      if (!S) { S = new FileScan(f.file, f.node, f.root); P.files.set(f.file, S); }
      try { await S.update(); } catch (e) { log('scan', path.basename(f.file), e?.message || e); }
      S.prune(lo);
      bytes += S.size > 0 ? S.size : 0;
      if (!P.labels.has(f.node)) {
        if (f.meta) { try { const j = JSON.parse(await fs.promises.readFile(f.meta, 'utf8')); P.labels.set(f.node, String(j.description || j.agentType || f.node).slice(0, 60)); } catch { P.labels.set(f.node, f.node); } }
        else if (f.entry) { try { await this.index.ensureTitle(f.entry); } catch {} P.labels.set(f.node, `메인 · ${String(f.entry.customTitle || f.entry.aiTitle || f.sid.slice(0, 8)).slice(0, 50)}`); }
      }
    };
    // 파일 4개씩 함께(읽기는 스레드 풀) — 실측 1.4GB·1,307파일 첫 훑기 60초 → 아래 측정값
    let qi = 0;
    await Promise.all(Array.from({ length: Math.min(SCAN_PAR, files.length) }, async () => { while (qi < files.length) await one(files[qi++]); }));
    for (const k of [...P.files.keys()]) if (!keep.has(k)) P.files.delete(k);
    P.at = Date.now();
    P.bytes = bytes;
    P.ready = true;
  }

  /** 프로젝트 기록을 최신으로(겹친 요청은 한 번만) */
  ensure(pid) {
    const P = this._P(pid);
    if (P.building) return P.building;
    if (P.ready && Date.now() - P.at < this.minRefreshMs) return Promise.resolve();
    P.building = this._refresh(pid).catch((e) => log('refresh', e?.message || e)).finally(() => { P.building = null; });
    return P.building;
  }

  /** 세션 id → 프로젝트 id */
  projectOf(sessionId) { const e = sessionId && this.index.findSession(sessionId); return e ? e.projectDir : null; }

  /**
   * /artifacts 응답: {projectId, until, building, items, nodes, counts, stats}
   * waitMs 안에 훑기가 끝나지 않으면 지금까지 모은 것으로 building:true(웹이 3초 뒤 다시 요청)
   */
  async payload({ projectId = null, sessionId = null, untilMs = null, waitMs = 2500 } = {}) {
    const pid = projectId || this.projectOf(sessionId);
    if (!pid) return { projectId: null, until: untilMs, building: false, items: [], nodes: {}, counts: {} };
    const P = this._P(pid);
    const job = this.ensure(pid);
    let building = false;
    let tm = null;
    await Promise.race([job, new Promise((r) => { tm = setTimeout(() => { building = !!P.building; r(); }, waitMs); tm.unref?.(); })]);
    clearTimeout(tm);
    if (P.building) building = true;
    const until = Number.isFinite(untilMs) && untilMs > 0 ? untilMs : Date.now();
    const lo = until - this.windowMs;
    const recs = [];
    for (const S of P.files.values()) for (const r of S.recs) if (r.t > lo && r.t <= until) recs.push(r);
    recs.sort((a, b) => a.t - b.t || (a.tu < b.tu ? -1 : 1));
    const book = new ArtBook();
    for (const r of recs) for (const ref of r.art) {
      const clean = sanitizeArt([ref], this.privacy);
      if (clean) book.touch(pid, clean[0], r.t, r.node, r.tu);
    }
    const items = book.snapshot(pid);
    const used = new Set(); for (const it of items) for (const w of it.who) used.add(w.node);
    const nodes = {}; for (const id of used) nodes[id] = redact(P.labels.get(id) || id).slice(0, 60);
    return { projectId: pid, until, building, items, nodes, counts: countKinds(items), stats: { files: P.files.size, records: recs.length, bytes: P.bytes } };
  }
}

/** 데모·mock 용 기억 장부: 그래프 이벤트(tool-end art)를 받아 프로젝트별로 모은다(디스크 없음) */
export class MemoryArtifactSource {
  constructor({ privacy = 'summary' } = {}) { this.book = new ArtBook(); this.privacy = privacy; this.sessionProject = new Map(); this.labels = new Map(); }
  attach(graph, projectId) {
    if (graph.rootSessionId) this.sessionProject.set(graph.rootSessionId, projectId);
    for (const n of graph.nodes.values()) this.labels.set(n.id, n.label);
    for (const e of graph.ring) this._ev(e, projectId);
    return graph.subscribe((e) => this._ev(e, projectId));
  }
  _ev(e, pid) {
    if (e.type === 'node-add' && e.node) this.labels.set(e.node.id, e.node.label);
    if (e.type === 'tool-end' && e.art) this.book.apply(e, pid);
  }
  /** 지난 기록 심기(데모의 '며칠 전' 대상 — 바램 확인용) */
  seed(pid, recs) { for (const r of recs) for (const ref of r.art) this.book.touch(pid, ref, r.t, r.node, r.tu); }
  async payload({ projectId = null, sessionId = null, untilMs = null } = {}) {
    const pid = projectId || this.sessionProject.get(sessionId) || [...this.sessionProject.values()][0] || null;
    if (!pid) return { projectId: null, until: untilMs, building: false, items: [], nodes: {}, counts: {} };
    const until = Number.isFinite(untilMs) && untilMs > 0 ? untilMs : Date.now();
    this.book.prune(until);
    const items = this.book.snapshot(pid).filter((it) => (it.first || 0) <= until);
    const nodes = {}; for (const it of items) for (const w of it.who) nodes[w.node] = this.labels.get(w.node) || w.node;
    return { projectId: pid, until, building: false, items, nodes, counts: countKinds(items) };
  }
}
