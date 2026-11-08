// 범위 제한 공유 링크(share): 한 프로젝트·정해진 기간만, 내용 텍스트 없이 「움직임」만 보여 주는 외부 링크.
//
// 보기 토큰(전체 보기)과 따로 발급하고 따로 폐기한다. 판정은 Worker(KV)와 이 서버가 각각 한다(이중 거부).
//   - 저장: <상태 폴더>/shares.json  {shares:[{id, token, hash, project, cwd, name, createdAt, expiresAt, revokedAt?}]}
//     토큰 원문은 이 파일(현재 사용자만 읽기)에만, Worker KV 에는 sha256 해시만(share:<hash> → {id, exp}).
//   - 서버는 파일을 2초마다 다시 본다(mtime). 폐기·만료는 열린 SSE 도 끊는다(sse.mjs guard).
//
// 데이터 잠금(deny-by-default): 공유 요청에 나가는 JSON·SSE 는 모두 shareClean() 을 거친다.
//   남기는 것 = 노드 구조(id·부모·kind·상태·시각·깊이·수), 이벤트 종류·도구 범주(cat)·내장 도구 이름·성공 여부·시간,
//   그 밖 문자열은 허용 키 + 형식 검사(식별자·열거형·ISO 시각)를 통과한 것만. 모르는 키·모르는 객체는 버린다.
//   경로·명령·도구 입력·결과·말·프롬프트·제목·설명·홀로그램 패널·작업 대상·계획판·이름은 남지 않는다.
//   노드 이름표는 kind 별 일반 이름, 프로젝트는 별칭 id 와 공유 표시 이름(기본 'Project', 한국어 '프로젝트')으로 바꾼다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseCookies, COOKIE, prefersKo } from './auth.mjs';
import { scrubDesc, toolAction, toolEndText, safeSkill } from './share-scrub.mjs'; // 잠금 등급 details

export const SHARE_PREFIX = 'sh_';
export const SHARE_FILE = 'shares.json';
const RELOAD_MS = 2000;

export const sha256hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const newShareToken = () => SHARE_PREFIX + crypto.randomBytes(32).toString('base64url');
export const newShareId = () => crypto.randomBytes(4).toString('hex');
/** Claude Code 프로젝트 폴더 이름(encodeCwd) */
export const encodeCwd = (cwd) => String(cwd).replace(/[^A-Za-z0-9]/g, '-');
/** 프로젝트 별칭(화면·응답에 나가는 projectId) */
export const shareAlias = (sh) => `share-${sh.id}`;

/** <상태 폴더>/shares.json 읽기(없으면 빈 목록) */
export function readShares(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(j?.shares) ? j.shares.filter((s) => s && typeof s === 'object') : [];
  } catch { return []; }
}

/**
 * 잠금 등급: 'full'(기본 — 글을 모두 뺌) | 'details'(설명 공개 — 프로젝트 이름·세션 제목·서브에이전트 설명·도구별 일반 동작·스킬 이름은 보이고
 * 그 안의 경로·명령·코드·문서 번호·커밋·이름은 share-scrub 이 가림). shares.json 의 redact 값: true|'full' → full, 'details' → details, 그 밖 → full
 */
export const SHARE_LEVELS = ['full', 'details'];
export const shareLevel = (sh) => (sh && sh.redact === 'details' ? 'details' : 'full');
/** 공유 표시 이름(full 등급): --name 으로 준 이름, 없으면 보는 사람 언어의 기본 이름. 예전 CLI 가 저장한 기본값('프로젝트'·'Project')도 이름 없음으로 본다 */
const DEFAULT_SHARE_NAMES = new Set(['프로젝트', 'Project']);
export function shareDisplayName(sh, lang = 'en') {
  const n = typeof sh?.name === 'string' ? sh.name.trim() : '';
  if (n && !DEFAULT_SHARE_NAMES.has(n)) return n;
  return lang === 'ko' ? '프로젝트' : 'Project';
}
/** 공유 범위 폴더의 표시 이름(cwd 마지막 조각, 없으면 공유 표시 이름) — details 등급의 섬 이름·목록 */
export function shareProjectName(sh, lang = 'en') {
  const base = String(sh?.cwd || '').split(/[\\/]+/).filter(Boolean).pop() || '';
  const v = scrubDesc(base, { max: 40, keep: [base] });
  return v || shareDisplayName(sh, lang);
}

/** 필터가 지우지 않을 낱말(공유 범위 프로젝트 이름 — project_acme 는 snake_case 지만 보여 준다) */
const keepOf = (ctx) => ctx._keep || (ctx._keep = [String(ctx.share?.cwd || '').split(/[\\/]+/).filter(Boolean).pop() || ''].filter(Boolean));

/** 지금 쓸 수 있는 공유인가(폐기·만료·형식) */
export function shareValid(sh, now = Date.now()) {
  if (!sh || sh.revokedAt || typeof sh.hash !== 'string' || typeof sh.project !== 'string' || !sh.project) return false;
  const exp = Date.parse(sh.expiresAt);
  return Number.isFinite(exp) && exp > now;
}

/** 서버 쪽 공유 목록(파일을 2초마다 다시 본다). 시험은 list 를 직접 넣을 수 있다 */
export class ShareStore {
  constructor({ file = null, list = null } = {}) {
    this.file = file; this.fixed = list; this.list = list || []; this.at = 0; this.mtime = -1;
  }
  _load() {
    if (this.fixed || !this.file) return;
    const now = Date.now();
    if (now - this.at < RELOAD_MS) return;
    this.at = now;
    let m = -2;
    try { m = fs.statSync(this.file).mtimeMs; } catch { m = -2; }
    if (m === this.mtime) return;
    this.mtime = m;
    this.list = m === -2 ? [] : readShares(this.file);
  }
  /** 토큰 → {share} | {expired:true} | null */
  match(token) {
    if (typeof token !== 'string' || !token.startsWith(SHARE_PREFIX) || token.length > 200) return null;
    this._load();
    const h = Buffer.from(sha256hex(token), 'hex');
    for (const sh of this.list) {
      if (typeof sh.hash !== 'string' || sh.hash.length !== 64) continue;
      let eq = false;
      try { eq = crypto.timingSafeEqual(h, Buffer.from(sh.hash, 'hex')); } catch { eq = false; }
      if (!eq) continue;
      return shareValid(sh) ? { share: sh } : { expired: true, share: sh };
    }
    return null;
  }
  /** 유효한 공유의 기본 리플레이 세션들(미리 만들기) */
  replaySessions() {
    this._load();
    const out = new Set();
    for (const sh of this.list) { const r = shareValid(sh) ? shareReplayOf(sh) : null; if (r) out.add(r.session); }
    return [...out];
  }
  /** 열린 연결이 아직 유효한가(폐기·만료를 연결 중에도 본다) */
  stillValid(sh) {
    this._load();
    const cur = this.list.find((x) => x && x.id === sh.id && x.hash === sh.hash);
    return !!cur && shareValid(cur);
  }
}

/** 요청에서 공유 토큰 찾기(쿼리 t → 쿠키 → X-CCVIZ-Token). 보기 토큰 검사(checkAuth)가 실패한 뒤에만 부른다 */
export function checkShare(req, url, store) {
  if (!store) return null;
  const cands = [url.searchParams.get('t'), parseCookies(req.headers.cookie)[COOKIE], req.headers['x-ccviz-token']];
  let expired = null;
  for (const [i, tok] of cands.entries()) {
    const m = store.match(typeof tok === 'string' ? tok : null);
    if (!m) continue;
    if (m.expired) { expired = m; continue; }
    const sh = m.share;
    const out = { ok: true, share: sh };
    if (i === 0) {
      const left = Math.max(1, Math.floor((Date.parse(sh.expiresAt) - Date.now()) / 1000));
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      const secure = req.headers['x-forwarded-proto'] === 'https' || !(host === '127.0.0.1' || host === 'localhost');
      out.setCookie = `${COOKIE}=${encodeURIComponent(tok)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${left}${secure ? '; Secure' : ''}`;
      const p = url.pathname;
      if (req.method === 'GET' && (p === '/' || p.endsWith('.html'))) {
        const sp = new URLSearchParams(url.searchParams); sp.delete('t');
        const qs = sp.toString();
        out.redirect = p + (qs ? `?${qs}` : '');
      }
    }
    return out;
  }
  return expired ? { ok: false, expired: true } : null;
}

const EXPIRED_PAGE = (ko) => `<!doctype html><html lang="${ko ? 'ko' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ko ? '링크 기한 지남' : 'Link expired'}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0f17;color:#e6e9ef;display:grid;place-items:center;min-height:100vh;margin:0}
@media (prefers-color-scheme: light){body{background:#f5f6fa;color:#151a23}}main{max-width:28rem;padding:0 16px;text-align:center}</style></head>
<body><main><h1>${ko ? '링크 기한이 지났습니다' : 'This link has expired'}</h1><p>${ko ? '이 공유 링크는 더 이상 열 수 없습니다.' : 'This shared link can no longer be opened.'}</p></main></body></html>`;
export const expiredHtml = (acceptLanguage) => EXPIRED_PAGE(prefersKo(acceptLanguage));

// ───────────── 공유 요청이 쓸 수 있는 경로 ─────────────
/** 막는 경로(Worker 도 같은 목록으로 막는다): Interactive·실황 원문·화면 조작·작업 대상·보관함 */
export function shareBlockedPath(p, url) {
  const q = String(p || '').toLowerCase().replace(/\/+$/, '') || '/';
  if (q === '/control' || q.startsWith('/control/')) return true;
  if (q === '/interact' || q.startsWith('/interact/')) return true;
  if (q === '/md/full' || q === '/artifacts') return true;
  const s = url ? String(url.searchParams.get('session') || '') : '';
  if (/^arc:/i.test(s) || (url && url.searchParams.get('source') === 'archive')) return true;
  return false;
}

// ───────────── 데이터 잠금(deny-by-default) ─────────────
const ENUM_RE = /^[A-Za-z0-9_-]{1,40}$/;
const ISO_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/;
const MODEL_RE = /^claude-[a-z0-9-]{1,40}$/;
const NUMKEY_RE = /^[A-Za-z0-9_]{1,32}$/;      // 수·참거짓 값을 남길 키 모양(동적 키 — 경로 같은 것 — 는 버림)
const TOOL_RE = /^[A-Z][A-Za-z]{1,30}$/;       // 내장 도구 이름(Bash, Read, Agent …)

/** 식별자 값(모양이 다르면 해시로 바꿔 짝만 남긴다) */
const ID_KEYS = new Set(['id', 'ids', 'nodeId', 'parentId', 'sessionId', 'rootSessionId', 'toolUseId', 'root', 'from', 'peer', 'nodeA', 'nodeB',
  'fromNode', 'toNode', 'spawnedBy', 'jobOwner', 'rearmOf', 'clearedFrom', 'launcher', 'agentId', 'runId', 'taskId', 'ref', 'auto', 'handoffFrom']);
/** 열거형 값(형식 검사만 통과하면 그대로) */
const ENUM_KEYS = new Set(['kind', 'status', 'type', 'cat', 'cats', 'role', 'origin', 'tier', 'liveStatus', 'liveWait', 'entrypoint', 'scope', 'basis',
  'effort', 'effortReq', 'op', 'phase', 'state', 'stopReason', 'endReason', 'bufferWhy', 'by', 'confidence', 'evidence', 'level', 'via', 'src', 'mode']);
/** 들어가 볼 객체·배열 키(나머지 객체는 통째로 버림) */
const CONTAINER_KEYS = new Set(['nodes', 'recent', 'node', 'patch', 'meta', 'counts', 'openTools', 'projects', 'roots', 'liveList', 'recentList',
  'events', 'ctx', 'run', 'job', 'lanes', 'batch', 'link', 'ix', 'cats', 'sessions', 'conflicts', 'buckets', 'items', 'keyframe', 'state', 'proc', 'runner',
  'launcher']);
/** 글 값은 빈 문자열로(웹이 문자열을 기대하는 자리) */
const BLANK_KEYS = new Set(['text', 'brief', 'detail', 'title']);

const GENERIC = {
  ko: { main: '메인 에이전트', subagent: '서브에이전트', workflow: '워크플로', 'workflow-agent': '워크플로 에이전트', 'claude-p': '독립 회차',
    'bash-bg': '백그라운드 작업', monitor: '모니터', other: '에이전트' },
  en: { main: 'Main agent', subagent: 'Subagent', workflow: 'Workflow', 'workflow-agent': 'Workflow agent', 'claude-p': 'Headless run',
    'bash-bg': 'Background job', monitor: 'Monitor', other: 'Agent' },
};
export const genericLabel = (kind, lang = 'ko') => (GENERIC[lang] || GENERIC.ko)[kind] || (GENERIC[lang] || GENERIC.ko).other;

const hashId = (v) => 'x' + sha256hex(v).slice(0, 12);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RAND_RE = /^(?:toolu_[A-Za-z0-9]{8,60}|wf_[0-9a-f]{4,16}(?:-[0-9a-f]{2,8})?|[a-z0-9]{6,40})$/;
/** 무작위 토막처럼 보이는가(사람이 붙인 이름 — 작업 이름·파일 이름 — 이 아닌가): UUID·toolu_·숫자가 2개 이상 섞인 영숫자 */
function randomish(s) {
  if (UUID_RE.test(s)) return true;
  if (!RAND_RE.test(s)) return false;
  if (s.startsWith('toolu_') || s.startsWith('wf_')) return true;
  return (s.match(/[0-9]/g) || []).length >= 2;
}
/**
 * 식별자 정리: 노드 id 꼴 `<접두>:<토막>[-r<n>|-<n>]` 의 토막이 무작위꼴이면 그대로, 아니면(이름이 든 id) 접두는 두고 토막만 해시.
 * 같은 값은 늘 같은 해시라 부모·자식·참조 관계는 그대로 남는다
 */
export function safeId(v) {
  if (typeof v !== 'string' || !v || v.length > 200) return hashId(String(v));
  const m = /^([a-z]{1,3}):(.+)$/.exec(v);
  const pre = m ? m[1] + ':' : '';
  let rest = m ? m[2] : v;
  const sm = /(-r?\d{1,4})$/.exec(rest);
  const suf = sm && randomish(rest.slice(0, -sm[1].length)) ? sm[1] : '';
  if (suf) rest = rest.slice(0, -suf.length);
  return randomish(rest) ? pre + rest + suf : pre + hashId(rest) + suf;
}

/**
 * 공유 응답 정리. ctx = {share, lang}. 객체·배열을 새로 만들어 돌려준다(원본은 건드리지 않음)
 * @returns {any}
 */
export function shareClean(obj, ctx) {
  return cleanVal(obj, null, ctx, 0);
}

function cleanStr(k, v, ctx) {
  if (k === 'projectId' || k === 'projectDir') return v === ctx.share.project ? shareAlias(ctx.share) : undefined;
  if (ctx.level === 'details') {
    // 설명 공개: 제목·이름표는 필터를 거쳐 남기고, 도구 기록의 brief·text 는 객체 단위에서 일반 동작 문장으로 채운다
    if (k === 'title') return scrubDesc(v, { lang: ctx.lang, max: 120, keep: keepOf(ctx) });
    if (k === 'label') return scrubDesc(v, { lang: ctx.lang, max: 80, keep: keepOf(ctx) }) || undefined; // 노드는 객체 단위에서 비면 일반 이름
    if (k === 'agentType') return /^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : undefined;
    if (k === 'skill') return safeSkill(v);
  }
  if (k === 'label' || k === 'name') return undefined; // 객체 단위에서 일반 이름으로 채운다
  if (BLANK_KEYS.has(k)) return '';
  if (k === 'tool') {
    if (/^toolu_[A-Za-z0-9]{1,60}$/.test(v)) return v;
    if (v.startsWith('mcp__')) return 'mcp';
    return TOOL_RE.test(v) ? v : 'other';
  }
  if (k === 'model') return MODEL_RE.test(v) ? v : undefined;
  if (ISO_RE.test(v)) return v;
  if (ID_KEYS.has(k)) return safeId(v);
  if (ENUM_KEYS.has(k)) return ENUM_RE.test(v) ? v : undefined;
  return undefined;
}

function cleanVal(v, k, ctx, depth) {
  if (depth > 40) return undefined;
  if (v === null) return null;
  const t = typeof v;
  if (t === 'number' || t === 'boolean') return k == null || NUMKEY_RE.test(k) ? v : undefined;
  if (t === 'string') return k == null ? undefined : cleanStr(k, v, ctx);
  if (Array.isArray(v)) {
    if (k != null && !CONTAINER_KEYS.has(k) && !ID_KEYS.has(k) && !ENUM_KEYS.has(k)) return undefined;
    const out = [];
    for (const x of v) {
      const c = cleanVal(x, typeof x === 'object' && x !== null ? null : k, ctx, depth + 1);
      if (c !== undefined) out.push(c);
    }
    return out;
  }
  if (t === 'object') {
    if (k != null && !CONTAINER_KEYS.has(k)) return undefined;
    const out = {};
    for (const [kk, vv] of Object.entries(v)) {
      const c = cleanVal(vv, kk, ctx, depth + 1);
      if (c !== undefined) out[kk] = c;
    }
    const det = ctx.level === 'details';
    // 노드: 이름표를 kind 별 일반 이름으로(details 면 정리한 실제 이름표, 남는 낱말이 없을 때만 일반 이름)
    if (typeof v.kind === 'string' && typeof v.id === 'string' && 'label' in v) out.label = (det && out.label) || genericLabel(v.kind, ctx.lang);
    // 프로젝트 항목: 공유 표시 이름(details 면 범위 폴더 이름)
    if (out.projectId && ('name' in v || 'path' in v)) out.name = det ? shareProjectName(ctx.share, ctx.lang) : shareDisplayName(ctx.share, ctx.lang);
    // 도구 기록(tool-start·tool-end 이벤트, 스냅샷 openTools): 원문 대신 도구별 일반 동작 한 줄. 패널은 빼고(웹이 도구 이름 + 이 줄로 패널을 그림)
    if (det && k !== 'ix' && typeof v.tool === 'string' && (typeof v.toolUseId === 'string' || v.type === 'tool-start' || v.type === 'tool-end')) {
      if (v.type === 'tool-end') { out.brief = toolEndText(v.ok, ctx.lang); out.text = ''; }
      else { const a = toolAction(v, ctx.lang, keepOf(ctx)); out.brief = a; out.text = a; }
      if ('detail' in v) out.detail = '';
    }
    return out;
  }
  return undefined;
}

// ───────────── 범위(한 프로젝트) 거르기 — 정리 전에 원본으로 판정 ─────────────
const inProj = (x, sh) => !!x && x.projectId === sh.project;

/** 전체 보기(scope=all) 이벤트 하나를 이 공유에 보낼까 */
export function shareKeepHubEvent(e, sh) {
  return inProj(e, sh) || (!!e && !!e.node && inProj(e.node, sh));
}

/** 전체 보기 스냅샷 거르기 */
export function shareFilterHubSnap(snap, sh) {
  if (!snap || typeof snap !== 'object') return snap;
  const nodes = Array.isArray(snap.nodes) ? snap.nodes.filter((n) => inProj(n, sh)) : [];
  const ids = new Set(nodes.map((n) => n.id));
  const keepEv = (e) => inProj(e, sh) || (!!e && ids.has(e.nodeId));
  return {
    ...snap,
    nodes,
    recent: Array.isArray(snap.recent) ? snap.recent.filter(keepEv) : [],
    projects: Array.isArray(snap.projects) ? snap.projects.filter((p) => inProj(p, sh)) : [],
    roots: Array.isArray(snap.roots) ? snap.roots.filter((r) => inProj(r, sh)) : [],
    ...(Array.isArray(snap.conflicts) ? { conflicts: snap.conflicts.filter((c) => c && ids.has(c.nodeId) && (!c.peer || ids.has(c.peer))) } : {}),
  };
}

/** projects 이벤트·/projects 응답 거르기 */
export function shareFilterProjects(p, sh) {
  if (!p || typeof p !== 'object') return p;
  return {
    ...p,
    ...(Array.isArray(p.projects) ? { projects: p.projects.filter((x) => inProj(x, sh)) } : {}),
    ...(Array.isArray(p.roots) ? { roots: p.roots.filter((x) => inProj(x, sh)) } : {}),
  };
}

/** 요청 언어(일반 이름표): ko 우선이면 ko */
export const shareLang = (req) => (prefersKo(req?.headers?.['accept-language']) ? 'ko' : 'en');

const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8, 16, 32]; // web/replay/engine.mjs SPEEDS
const SID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * 기본 리플레이(share set --replay) 정리: shares.json 의 replay {session, from, until?, speed, loop}
 * → {session, from(ms), until(ms|null), speed, loop} | null. 형식이 하나라도 어긋나면 null(화면은 예전처럼 실시간 보기)
 */
export function shareReplayOf(sh) {
  const r = sh && sh.replay;
  if (!r || typeof r !== 'object' || typeof r.session !== 'string' || !SID_RE.test(r.session)) return null;
  const from = Date.parse(r.from);
  if (!Number.isFinite(from)) return null;
  const until = r.until == null ? null : Date.parse(r.until);
  if (until != null && !(Number.isFinite(until) && until > from)) return null;
  const speed = REPLAY_SPEEDS.includes(Number(r.speed)) ? Number(r.speed) : 1;
  return { session: r.session.toLowerCase(), from, until, speed, loop: r.loop === true };
}

/**
 * index.html 에 공유 표지(data-share)를 넣는다 — 화면이 실황·Interactive·한도를 숨기는 근거(데이터 잠금은 서버가 따로 한다).
 * 기본 리플레이가 있으면 data-share-replay="<세션 UUID>|<시작 ms>|<끝 ms 또는 빈칸>|<배속>|<1=반복>"(UUID·숫자만, 따옴표 없음)
 */
export function markShareHtml(html, sh) {
  const exp = Date.parse(sh.expiresAt);
  const r = shareReplayOf(sh);
  const rep = r ? ` data-share-replay="${r.session}|${r.from}|${r.until ?? ''}|${r.speed}|${r.loop ? 1 : 0}"` : '';
  return String(html).replace(/<html\b([^>]*)>/i, (m, attrs) => `<html${attrs} data-share="1" data-share-exp="${Number.isFinite(exp) ? exp : ''}"${rep}>`);
}

export function shareFilePath(home) { return path.join(home, SHARE_FILE); }
