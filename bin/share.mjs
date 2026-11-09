// 범위 제한 공유 링크 CLI — agent4d share create|list|revoke|url
//   create --alias <별칭> --project <cwd 경로|프로젝트 폴더 이름> [--days N | --hours N | --minutes N] [--name <표시 이름>] [--redact [full|details]]
//          [--expires <시각>]  만료 시각을 직접(ISO, 오프셋 없으면 KST — 예 2026-11-17T23:59), --days 등 대신
//          [--embed <출처,…>]  이 링크를 iframe 으로 넣을 수 있는 사이트(CSP frame-ancestors, 예 https://a.github.io,http://localhost:*,file:). * 단독 불가
//   list [--json] [--all]        별칭·범위·발급/만료(KST)·잠금·상태 표(만료·폐기도 기록에 남김)
//   revoke <별칭|id>              로컬 기록 폐기 표시(서버가 곧바로 거부) + Worker KV 삭제
//   url <별칭|id>                 전체 링크 다시 출력(유효한 것만)
//   set <별칭|id> --replay <세션id(앞부분 가능)>@<시각> [--until <시각>] [--speed 4] [--loop] | --replay off
//                                 기본 리플레이(링크를 열면 그 세션을 그 시각부터 자동 재생, --loop 면 끝 시각에서 처음으로).
//                                 시각은 ISO(오프셋 없으면 KST)·'HH:mm[:ss]'(--until 만, 시작 날짜 기준). 토큰·URL·만료·잠금은 바꾸지 않는다
//   set <별칭|id> --embed <출처,…>|off   iframe 허용 출처 바꾸기(Worker KV 다시 올림, 토큰·URL·만료 그대로)
//   set <별칭|id> --redact full|details 잠금 등급(full = 글 모두 뺌, details = 설명 공개·경로/명령/코드/문서 번호/커밋/이름 가림). 토큰·URL·만료는 그대로
// 원본: <상태 폴더>/shares.json(토큰·전체 URL 포함, 현재 사용자만). 사람용 목록: <상태 폴더>/shares.md(토큰은 앞 8자만).
// Worker KV: share:<sha256(토큰)> → {id, exp} — 토큰 원문은 Worker 에 가지 않는다.
// 문구: 영어 기본, 한국어 로케일이면 한국어(server/cli-i18n.mjs cliLang — --lang·CCVIZ_LANG·LANG·Intl, bin/job.mjs 와 같은 꼴).
//   --name 을 안 주면 표시 이름을 저장하지 않는다(서버가 보는 사람 언어로 'Project'/'프로젝트').
//   list --json 의 status 는 언어와 무관한 valid|expired|revoked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ccvizHome } from '../server/home.mjs';
import { cliLang } from '../server/cli-i18n.mjs';
import { FRAME_ORIGIN_RE } from '../server/share.mjs';

/** --embed 값 → 출처 배열 | [] (off) | null (잘못됨) */
function parseEmbed(v) {
  if (v == null || v === true) return null;
  const s = String(v).trim();
  if (/^(off|none|no|0)$/i.test(s)) return [];
  const list = [...new Set(s.split(/[\s,]+/).map((x) => x.trim().replace(/\/+$/, '')).filter(Boolean))];
  if (!list.length || list.length > 16 || list.some((x) => !FRAME_ORIGIN_RE.test(x))) return null;
  return list;
}
const embedText = (sh) => (Array.isArray(sh.frameAncestors) && sh.frameAncestors.length ? sh.frameAncestors.join(' ') : '-');
import { readShares, shareValid, sha256hex, newShareToken, newShareId, encodeCwd, SHARE_FILE, shareReplayOf, shareLevel, SHARE_LEVELS } from '../server/share.mjs';

const HOME = ccvizHome();
const CONFIG = path.join(HOME, 'config.json');
const FILE = path.join(HOME, SHARE_FILE);
const MD = path.join(HOME, 'shares.md');
const IS_WIN = process.platform === 'win32';
const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8, 16, 32]; // web/replay/engine.mjs SPEEDS

const M = {
  en: {
    lockDesc: 'Common: live feed, Interactive, work-target layer and archive blocked · usage limits and memory hidden · other projects not visible. '
      + 'Text removed (full): paths, commands, tool input and output, messages, titles and labels are all removed. '
      + 'Details shown (details): the project name, session titles, subagent descriptions and types, a generic action per tool call and skill names are shown, '
      + 'with paths, file names, commands, code, ADR and doc numbers, commits, branches, people\'s names and emails in them replaced by placeholders (tool input and output, messages and prompts are still removed)',
    levelFull: 'Text removed', levelDetails: 'Details shown (paths, commands, code, ADRs, commits, names hidden)',
    lockFull: 'Data lock (text removed)', lockDetails: 'Details lock (paths, commands, code, ADRs, commits, names hidden)',
    lockTail: 'live/Interactive blocked · limits hidden', blockedShort: 'live/Interactive blocked',
    valid: 'valid', expired: 'expired', revoked: 'revoked',
    rpEnd: 'end', rpLoop: '· loop',
    mdTitle: '# Agent4D shared links',
    mdNote: '> Generated: {ts} KST · source `shares.json` (full links and tokens are only in that file) · revoke with `agent4d share revoke <alias>`',
    cols: ['Alias', 'id', 'Scope (project)', 'Issued (KST)', 'Expires (KST)', 'Lock', 'Default replay', 'Status', 'Token prefix'],
    mdLock: 'Lock: {desc}.',
    mdFail: 'Could not write shares.md: {msg}',
    noWorker: 'Worker not deployed (no workerUrl)',
    needAlias: 'An alias is required: --alias <alias>  (e.g. --alias demo-2026-11-11)',
    badAlias: 'Use an alias of 64 characters or fewer, without line breaks, | or `.',
    needProject: 'A scope is required: --project <project path>',
    noProjectDir: 'Note: ~/.claude/projects/{project} does not exist (the screen stays empty until it has sessions).',
    badPeriod: 'Give a period from 1 minute to 90 days (--days, --hours or --minutes).',
    noUnlock: 'Shared links are always issued with the data lock (redact).',
    badLevel: '--redact must be one of: {levels}.',
    badLevelSet: '--redact must be one of: {levels} (e.g. --redact details).',
    dupAlias: "Alias '{alias}' already exists (expired and revoked entries included). Use another alias.",
    workerFail: 'Worker registration failed: {why} — no link was issued (check that the Worker was updated with agent4d deploy).',
    created: 'Shared link issued — alias {alias} · id {id}',
    rowScope: '  Scope    {v}', rowExpires: '  Expires  {v} KST', rowLock: '  Lock     {v}', rowLink: '  Link     {v}',
    rowRevoke: '  Revoke   agent4d share revoke {v}', rowReplay: '  Replay   {v}',
    rowLength: '  Length   {real} s real → {shown} s on screen ({speed}×){loop}', loopWord: ', loop',
    anyone: '  (Anyone with the link can view it until it expires.)',
    none: 'No shared links issued.',
    files: '\nList files: {file} (source) · {md} (readable)',
    notFound: "No shared link with alias or id '{key}'. Check with agent4d share list.",
    revoked1: 'Revoked — alias {alias} · id {id}.',
    already: 'Already revoked — alias {alias} · id {id}.',
    kvDeleted: '  Also removed from the Worker KV (the edge cache may lag up to 60 s, but the local server refuses the link first).',
    kvFail: '  Worker KV delete failed: {why} — the local server still refuses the link. Run revoke again later.',
    sameLevel: 'Lock level is already {level} — alias {alias}',
    levelChanged: 'Lock level changed — alias {alias} · {from} → {to}',
    levelKeep: '  Link, token, expiry and default replay are unchanged (reload open pages to apply).',
    nothingToSet: 'Nothing to change: --replay <session>@<time> [--until <time>] [--speed 4] [--loop] | --replay off · --redact full|details',
    replayOff: 'Default replay turned off — alias {alias} (the link is unchanged and opens the live view)',
    replayNone: 'There is no default replay — alias {alias}',
    badReplay: '--replay takes <session>@<time> (e.g. a3443dd5@2026-11-05T07:49:20+09:00).',
    badFrom: 'Could not read the start time: {v}',
    badUntil: 'Could not read the end time: {v}',
    untilOrder: 'The end time must be after the start time.',
    untilMax: 'Keep the range to 24 hours or less.',
    badSpeed: 'Speed must be one of: {speeds}.',
    loopNoUntil: 'Note: --loop without --until jumps back to the start time at the end of the session.',
    replaySet: 'Default replay set — alias {alias} · id {id}',
    replayKeep: '  Link, token, expiry and lock are unchanged (reload open pages to apply).',
    sidBad: 'Give the session id as letters, digits and hyphens (at least the first 4).',
    sidDir: 'Could not read ~/.claude/projects/{project}.',
    sidNone: "No session in this share's scope ({project}) starts with '{key}'.",
    sidMany: "{n} sessions start with '{key}' — give more characters.",
    urlNone: 'No such alias or id.',
    urlState: 'This link is {state}.',
    help: [
      'agent4d share create --alias <alias> --project <path> [--days 7|--hours N|--minutes N] [--name <display name>] [--redact full|details]',
      'agent4d share list [--json] · share revoke <alias|id> · share url <alias|id>',
      'agent4d share set <alias|id> --replay <session>@<time> [--until <time>] [--speed 4] [--loop] | --replay off',
      'agent4d share set <alias|id> --redact full|details   (lock level: text removed | details shown)',
    ],
  },
  ko: {
    lockDesc: '공통 — 실황·Interactive·작업 대상·보관함 차단 · 한도·메모리 숨김 · 다른 프로젝트 안 보임. '
      + '텍스트 제거(full) = 경로·명령·입출력·말·제목·이름표 모두 뺌. '
      + '설명 공개(details) = 프로젝트 이름·세션 제목·서브에이전트 설명과 종류·도구별 일반 동작·스킬 이름은 보이고, 그 안의 경로·파일 이름·명령·코드·ADR/문서 번호·커밋·브랜치·사람 이름·이메일은 자리표시로 가림(도구 입력·결과 원문·말·프롬프트는 여전히 뺌)',
    levelFull: '텍스트 제거', levelDetails: '설명 공개(경로·명령·코드·ADR·커밋·이름 가림)',
    lockFull: '데이터 잠금(텍스트 제거)', lockDetails: '설명 공개 잠금(경로·명령·코드·ADR·커밋·이름 가림)',
    lockTail: '실황/Interactive 차단·한도 숨김', blockedShort: '실황/Interactive 차단',
    valid: '유효', expired: '만료', revoked: '폐기',
    rpEnd: '끝', rpLoop: '· 반복',
    mdTitle: '# Agent4D 공유 링크 목록',
    mdNote: '> 자동 생성: {ts} KST · 원본 `shares.json`(전체 링크·토큰은 그 파일에만) · 폐기 `agent4d share revoke <별칭>`',
    cols: ['별칭', 'id', '범위(프로젝트)', '발급(KST)', '만료(KST)', '잠금', '기본 리플레이', '상태', '토큰 앞부분'],
    mdLock: '잠금 내용: {desc}.',
    mdFail: 'shares.md 쓰기 실패: {msg}',
    noWorker: 'Worker 미배포(workerUrl 없음)',
    needAlias: '별칭이 필요합니다: --alias <별칭>  (예: --alias 최종연심-2026-11-11)',
    badAlias: '별칭은 64자 이하, 줄바꿈·| · ` 없이 적어 주십시오.',
    needProject: '범위가 필요합니다: --project <프로젝트 경로>',
    noProjectDir: '주의: ~/.claude/projects/{project} 폴더가 없습니다(세션이 없으면 화면이 비어 있습니다).',
    badPeriod: '기간은 1분 이상 90일 이하로 주십시오(--days·--hours·--minutes).',
    noUnlock: '공유 링크는 늘 데이터 잠금(redact)으로만 발급합니다.',
    badLevel: '--redact 는 {levels} 중 하나입니다.',
    badLevelSet: '--redact 는 {levels} 중 하나입니다(예: --redact details).',
    dupAlias: "별칭 '{alias}' 이(가) 이미 있습니다(만료·폐기 기록 포함). 다른 별칭을 쓰십시오.",
    workerFail: 'Worker 등록 실패: {why} — 발급하지 않았습니다(agent4d deploy 로 Worker 를 갱신했는지 확인).',
    created: '공유 링크를 발급했습니다 — 별칭 {alias} · id {id}',
    rowScope: '  범위   {v}', rowExpires: '  만료   {v} KST', rowLock: '  잠금   {v}', rowLink: '  링크   {v}',
    rowRevoke: '  폐기   agent4d share revoke {v}', rowReplay: '  재생   {v}',
    rowLength: '  길이   실제 {real}초 → 화면 {shown}초({speed}×){loop}', loopWord: ' 반복',
    anyone: '  (링크를 가진 사람은 누구나 기한 안에 볼 수 있습니다.)',
    none: '발급한 공유 링크가 없습니다.',
    files: '\n목록 파일: {file} (원본) · {md} (사람용)',
    notFound: "'{key}' 별칭·id 의 공유 링크가 없습니다. agent4d share list 로 확인하십시오.",
    revoked1: '폐기했습니다 — 별칭 {alias} · id {id}.',
    already: '이미 폐기된 별칭 {alias} · id {id} 입니다.',
    kvDeleted: '  Worker KV 에서도 지웠습니다(엣지 캐시로 최대 60초 늦을 수 있으나 로컬 서버가 먼저 거부).',
    kvFail: '  Worker KV 삭제 실패: {why} — 로컬 서버는 거부합니다. 나중에 다시 revoke 하십시오.',
    sameLevel: '잠금 등급이 원래 {level} 입니다 — 별칭 {alias}',
    levelChanged: '잠금 등급을 바꿨습니다 — 별칭 {alias} · {from} → {to}',
    levelKeep: '  링크·토큰·만료·기본 리플레이는 그대로입니다(열린 화면은 새로고침하면 반영).',
    nothingToSet: '바꿀 설정이 없습니다: --replay <세션id>@<시각> [--until <시각>] [--speed 4] [--loop] | --replay off · --redact full|details',
    replayOff: '기본 리플레이를 껐습니다 — 별칭 {alias} (링크는 그대로, 열면 실시간 보기)',
    replayNone: '기본 리플레이가 원래 없습니다 — 별칭 {alias}',
    badReplay: '--replay 는 <세션id>@<시각> 꼴입니다(예: a3443dd5@2026-11-05T07:49:20+09:00).',
    badFrom: '시작 시각을 읽지 못했습니다: {v}',
    badUntil: '끝 시각을 읽지 못했습니다: {v}',
    untilOrder: '끝 시각은 시작보다 뒤여야 합니다.',
    untilMax: '구간은 24시간 이하로 주십시오.',
    badSpeed: '배속은 {speeds} 중 하나입니다.',
    loopNoUntil: '주의: --until 없이 --loop 면 세션 끝에서 시작 시각으로 돌아갑니다.',
    replaySet: '기본 리플레이를 정했습니다 — 별칭 {alias} · id {id}',
    replayKeep: '  링크·토큰·만료·잠금은 그대로입니다(열린 화면은 새로고침하면 반영).',
    sidBad: '세션 id 는 영숫자·하이픈(앞 4자 이상)으로 주십시오.',
    sidDir: '~/.claude/projects/{project} 폴더를 읽지 못했습니다.',
    sidNone: "이 공유 범위({project})에 '{key}' 로 시작하는 세션이 없습니다.",
    sidMany: "'{key}' 로 시작하는 세션이 {n}개입니다 — 더 길게 주십시오.",
    urlNone: '해당 별칭·id 가 없습니다.',
    urlState: '이 링크는 {state} 상태입니다.',
    help: [
      'agent4d share create --alias <별칭> --project <경로> [--days 7|--hours N|--minutes N] [--name <표시 이름>] [--redact full|details]',
      'agent4d share list [--json] · share revoke <별칭|id> · share url <별칭|id>',
      'agent4d share set <별칭|id> --replay <세션id>@<시각> [--until <시각>] [--speed 4] [--loop] | --replay off',
      'agent4d share set <별칭|id> --redact full|details   (잠금 등급: 텍스트 제거 | 설명 공개)',
    ],
  },
};
/** 문구 사전(lang 을 안 주면 지금 프로세스의 CLI 언어) */
const D = (lang) => M[lang === 'ko' || lang === 'en' ? lang : cliLang()] || M.en;
const tt = (k, v = {}, lang) => String(D(lang)[k] ?? M.en[k]).replace(/\{(\w+)\}/g, (m, x) => (v[x] != null ? String(v[x]) : m));

const log = (...a) => console.log(...a);
const warn = (...a) => console.error(...a);

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function restrict(file) {
  try { fs.chmodSync(file, 0o600); } catch {}
  if (IS_WIN && process.env.USERNAME) spawnSync('icacls', [file, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], { stdio: 'ignore', windowsHide: true });
}
function writeSecure(file, text) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
  restrict(file);
}

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) o[k] = v;
      else if (argv[i + 1] != null && !argv[i + 1].startsWith('--')) o[k] = argv[++i];
      else o[k] = true;
    } else o._.push(a);
  }
  return o;
}

/** KST 표기 YYYY-MM-DD HH:mm */
export function kst(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '-';
  const d = new Date(ms + 9 * 3600_000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
/** 상태 키(언어 무관): 'valid'|'expired'|'revoked' */
export function stateOf(sh, now = Date.now()) {
  if (sh.revokedAt) return 'revoked';
  return shareValid(sh, now) ? 'valid' : 'expired';
}
/** 상태 표기(그 언어) */
export const statusOf = (sh, now = Date.now(), lang) => tt(stateOf(sh, now), {}, lang);
export const lockText = (sh, lang) => (sh.redact === false ? '-' : `${tt(shareLevel(sh) === 'details' ? 'lockDetails' : 'lockFull', {}, lang)}·${tt('lockTail', {}, lang)}${Array.isArray(sh.frameAncestors) && sh.frameAncestors.length ? ` · iframe: ${sh.frameAncestors.join(' ')}` : ''}`);
/** --redact 값 → 'full'|'details'|null(틀림). 값 없이 --redact 만 주면 full */
export function parseLevel(v) {
  if (v === true || v == null) return 'full';
  const s = String(v).trim().toLowerCase();
  return SHARE_LEVELS.includes(s) ? s : null;
}
const levelValue = (lv) => (lv === 'details' ? 'details' : true); // shares.json 에는 예전처럼 true(full) 또는 'details'
const scopeText = (sh) => sh.cwd || sh.project;
/** 기본 리플레이 한 칸: 세션 앞 8자 @ 시작(KST)～끝 · 배속 · 반복 */
export function replayText(sh, lang) {
  const r = shareReplayOf(sh);
  if (!r) return '-';
  const from = kst(new Date(r.from).toISOString());
  const until = r.until != null ? kst(new Date(r.until).toISOString()) : null;
  const tail = until ? (until.slice(0, 10) === from.slice(0, 10) ? until.slice(11) : until) : tt('rpEnd', {}, lang);
  return `${r.session.slice(0, 8)} @ ${from}～${tail} · ${r.speed}× ${r.loop ? tt('rpLoop', {}, lang) : ''}`.trim();
}

function load() { return readShares(FILE); }
function save(list) {
  writeSecure(FILE, JSON.stringify({ shares: list }, null, 2) + '\n');
  writeMd(list);
}

/** 사람용 목록(토큰은 앞 8자만, 전체 URL 은 json 에만) */
export function mdOf(list, now = Date.now(), lang) {
  const rows = list.map((sh) => `| ${sh.alias || '-'} | ${sh.id} | ${scopeText(sh)} | ${kst(sh.createdAt)} | ${kst(sh.expiresAt)} | ${lockText(sh, lang)} | ${replayText(sh, lang)} | ${statusOf(sh, now, lang)}${sh.revokedAt ? ` (${kst(sh.revokedAt)})` : ''} | \`${String(sh.token || sh.tokenHead || '').slice(0, 8)}…\` |`);
  const cols = D(lang).cols;
  return [
    tt('mdTitle', {}, lang),
    '',
    tt('mdNote', { ts: kst(new Date(now).toISOString()) }, lang),
    '',
    `| ${cols.join(' | ')} |`,
    `|${cols.map(() => '---').join('|')}|`,
    ...rows,
    '',
    tt('mdLock', { desc: tt('lockDesc', {}, lang) }, lang),
    '',
  ].join('\n');
}
function writeMd(list) { try { writeSecure(MD, mdOf(list)); } catch (e) { warn(tt('mdFail', { msg: e.message })); } }

function findShare(list, key) {
  if (!key) return null;
  const byAlias = list.filter((s) => s.alias === key);
  const live = byAlias.find((s) => stateOf(s) === 'valid');
  return live || byAlias[byAlias.length - 1] || list.find((s) => s.id === key) || null;
}

async function workerShare(cfg, body) {
  if (!cfg.workerUrl || !cfg.adminSecret) return { ok: false, why: tt('noWorker') };
  try {
    const r = await fetch(cfg.workerUrl.replace(/\/+$/, '') + '/_share', {
      method: 'POST', headers: { Authorization: `Bearer ${cfg.adminSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => null);
    return r.status === 200 && j?.ok ? { ok: true } : { ok: false, why: `HTTP ${r.status} ${j?.error || ''}`.trim() };
  } catch (e) { return { ok: false, why: String(e?.cause?.code || e?.message || e) }; }
}

function linkOf(cfg, sh) { return `${String(cfg.workerUrl || '').replace(/\/+$/, '')}/?t=${encodeURIComponent(sh.token)}`; }

/** --project: 경로(D:\…)면 encodeCwd, 이미 폴더 이름이면 그대로 */
function resolveProject(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const looksPath = /[\\/:]/.test(s);
  const project = looksPath ? encodeCwd(path.resolve(s)) : s;
  const projectsDir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  const exists = fs.existsSync(path.join(projectsDir, project));
  return { project, cwd: looksPath ? path.resolve(s) : null, exists };
}

async function cmdCreate(o) {
  const cfg = readJson(CONFIG) || {};
  const alias = typeof o.alias === 'string' ? o.alias.trim() : '';
  if (!alias) { warn(tt('needAlias')); return 2; }
  if (alias.length > 64 || /[\r\n|`]/.test(alias)) { warn(tt('badAlias')); return 2; }
  const pr = resolveProject(o.project);
  if (!pr) { warn(tt('needProject')); return 2; }
  if (!pr.exists) warn(tt('noProjectDir', { project: pr.project }));
  let mins = o.minutes != null ? Number(o.minutes) : o.hours != null ? Number(o.hours) * 60 : (o.days != null ? Number(o.days) : 7) * 1440;
  if (o.expires != null) mins = (parseKstTime(o.expires) - Date.now()) / 60_000;
  const embed = o.embed != null ? parseEmbed(o.embed) : [];
  if (embed == null) { warn(`--embed: ${String(o.embed)} — https://host[:port], http://localhost:*, file: (comma separated, no bare *)`); return 2; }
  if (!Number.isFinite(mins) || mins < 1 || mins > 90 * 1440) { warn(tt('badPeriod')); return 2; }
  if (o.redact === 'false' || o['no-redact']) { warn(tt('noUnlock')); return 2; }
  const level = parseLevel(o.redact);
  if (!level) { warn(tt('badLevel', { levels: SHARE_LEVELS.join(', ') })); return 2; }
  const list = load();
  if (list.some((s) => s.alias === alias)) { warn(tt('dupAlias', { alias })); return 2; }
  const now = Date.now();
  const token = newShareToken();
  const sh = {
    id: newShareId(), alias, token, hash: sha256hex(token), project: pr.project, cwd: pr.cwd,
    // --name 이 없으면 null — 서버가 보는 사람 언어로 'Project'/'프로젝트'(server/share.mjs shareDisplayName)
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : null,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + mins * 60_000).toISOString(), redact: levelValue(level), kv: false,
  };
  if (embed.length) sh.frameAncestors = embed;
  const w = await workerShare(cfg, { op: 'put', hash: sh.hash, id: sh.id, exp: Date.parse(sh.expiresAt), ...(embed.length ? { fa: embed } : {}) });
  if (!w.ok) { warn(tt('workerFail', { why: w.why })); return 1; }
  sh.kv = true;
  sh.url = linkOf(cfg, sh);
  list.push(sh);
  save(list);
  log(tt('created', { alias, id: sh.id }));
  log(tt('rowScope', { v: `${scopeText(sh)} (${sh.project})` }));
  log(tt('rowExpires', { v: kst(sh.expiresAt) }));
  log(tt('rowLock', { v: lockText(sh) }));
  log(tt('rowLink', { v: sh.url }));
  log(tt('rowRevoke', { v: alias }));
  log(tt('anyone'));
  return 0;
}

const cellWidth = (s) => [...String(s)].reduce((a, c) => a + (/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7a3\uff00-\uffef]/.test(c) ? 2 : 1), 0);
function pad(s, n) { return String(s) + ' '.repeat(Math.max(0, n - cellWidth(s))); }
function cmdList(o) {
  const list = load();
  if (o.json) { log(JSON.stringify(list.map(({ token, url, hash, ...r }) => ({ ...r, tokenHead: String(token || '').slice(0, 8), status: stateOf(r) })), null, 2)); return 0; }
  if (!list.length) { log(tt('none')); return 0; }
  writeMd(list); // 상태(만료)를 사람용 목록에도 다시 반영
  const lv = { full: tt('levelFull'), details: tt('levelDetails') };
  const rows = [D().cols.slice(0, 8),
    ...list.map((s) => [s.alias || '-', s.id, scopeText(s), kst(s.createdAt), kst(s.expiresAt), s.redact === false ? '-' : `${lv[shareLevel(s)]}·${tt('blockedShort')}`, replayText(s), statusOf(s)])];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => cellWidth(r[i]))));
  for (const [i, r] of rows.entries()) {
    log(r.map((c, j) => pad(c, widths[j])).join('  ').trimEnd());
    if (i === 0) log(widths.map((w) => '-'.repeat(w)).join('  '));
  }
  log(tt('files', { file: FILE, md: MD }));
  return 0;
}

async function cmdRevoke(o) {
  const key = o._[1];
  const list = load();
  const sh = findShare(list, key);
  if (!sh) { warn(tt('notFound', { key: key || '' })); return 2; }
  const already = !!sh.revokedAt;
  if (!already) { sh.revokedAt = new Date().toISOString(); save(list); } // 로컬 서버는 2초 안에 거부·열린 SSE 는 5초 안에 끊음
  const cfg = readJson(CONFIG) || {};
  const w = await workerShare(cfg, { op: 'delete', hash: sh.hash });
  if (w.ok) { sh.kv = false; save(list); }
  log(tt(already ? 'already' : 'revoked1', { alias: sh.alias || '-', id: sh.id }));
  log(w.ok ? tt('kvDeleted') : tt('kvFail', { why: w.why }));
  return w.ok ? 0 : 1;
}

/** 시각 읽기: ISO(오프셋 없으면 KST) 또는 'HH:mm[:ss]'(base 날짜의 KST 시각) → epoch ms | NaN */
export function parseKstTime(v, baseMs = null) {
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  const hm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (hm) {
    if (!Number.isFinite(baseMs)) return NaN;
    const day = new Date(baseMs + 9 * 3600_000).toISOString().slice(0, 10);
    return Date.parse(`${day}T${hm[1].padStart(2, '0')}:${hm[2]}:${hm[3] || '00'}+09:00`);
  }
  if (/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(s)) return Date.parse(s.replace(' ', 'T') + '+09:00');
  return Date.parse(s);
}

/** 세션 id(앞부분 가능)를 그 프로젝트의 메인 transcript 이름으로 풀기 */
function resolveSession(project, key) {
  const k = String(key || '').trim().toLowerCase();
  if (!/^[0-9a-f-]{4,36}$/.test(k)) return { why: tt('sidBad') };
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects', project);
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && f.toLowerCase().startsWith(k)).map((f) => f.slice(0, -6)); } catch { return { why: tt('sidDir', { project }) }; }
  if (!names.length) return { why: tt('sidNone', { project, key }) };
  if (names.length > 1) return { why: tt('sidMany', { n: names.length, key }) };
  return { session: names[0], file: path.join(dir, names[0] + '.jsonl') };
}

async function cmdSet(o) {
  const key = o._[1];
  const list = load();
  const sh = findShare(list, key);
  if (!sh) { warn(tt('notFound', { key: key || '' })); return 2; }
  if (o.embed != null) {
    // iframe 허용 출처: shares.json(로컬 서버)·Worker KV(fa) 둘 다 — 토큰·URL·만료 그대로
    const embed = parseEmbed(o.embed);
    if (embed == null) { warn(`--embed: ${String(o.embed)} — https://host[:port], http://localhost:*, file: (comma separated, no bare *) | off`); return 2; }
    if (stateOf(sh) !== 'valid') { warn(tt('urlState', { state: statusOf(sh) })); return 1; }
    if (embed.length) sh.frameAncestors = embed; else delete sh.frameAncestors;
    const w = await workerShare(readJson(CONFIG) || {}, { op: 'put', hash: sh.hash, id: sh.id, exp: Date.parse(sh.expiresAt), ...(embed.length ? { fa: embed } : {}) });
    if (!w.ok) { warn(tt('workerFail', { why: w.why })); return 1; }
    save(list);
    log(`${sh.alias || '-'}: iframe ${embedText(sh)}`);
    if (o.redact == null && o.replay == null) return 0;
  }
  if (o.redact != null) {
    // 잠금 등급 바꾸기(토큰·URL·만료·Worker KV 그대로 — 서버가 2초 안에 새 등급으로 응답, 열린 화면은 새로고침하면 반영)
    const level = parseLevel(o.redact);
    if (!level || o.redact === true) { warn(tt('badLevelSet', { levels: SHARE_LEVELS.join(', ') })); return 2; }
    const before = shareLevel(sh);
    sh.redact = levelValue(level);
    if (o.replay == null) {
      save(list);
      log(before === level ? tt('sameLevel', { level, alias: sh.alias || '-' }) : tt('levelChanged', { alias: sh.alias || '-', from: before, to: level }));
      log(tt('rowLock', { v: lockText(sh) }));
      log(tt('levelKeep'));
      return 0;
    }
  }
  if (o.replay == null || o.replay === true) { warn(tt('nothingToSet')); return 2; }
  if (String(o.replay).toLowerCase() === 'off') {
    const had = !!sh.replay;
    delete sh.replay;
    save(list);
    log(tt(had ? 'replayOff' : 'replayNone', { alias: sh.alias || '-' }));
    return 0;
  }
  const m = /^([^@]+)@(.+)$/.exec(String(o.replay));
  if (!m) { warn(tt('badReplay')); return 2; }
  const rs = resolveSession(sh.project, m[1]);
  if (!rs.session) { warn(rs.why); return 2; }
  const from = parseKstTime(m[2]);
  if (!Number.isFinite(from)) { warn(tt('badFrom', { v: m[2] })); return 2; }
  let until = null;
  if (o.until != null && o.until !== true) {
    until = parseKstTime(o.until, from);
    if (!Number.isFinite(until)) { warn(tt('badUntil', { v: o.until })); return 2; }
    if (until <= from) { warn(tt('untilOrder')); return 2; }
    if (until - from > 24 * 3600_000) { warn(tt('untilMax')); return 2; }
  }
  const speed = o.speed != null && o.speed !== true ? Number(o.speed) : 1;
  if (!REPLAY_SPEEDS.includes(speed)) { warn(tt('badSpeed', { speeds: REPLAY_SPEEDS.join(', ') })); return 2; }
  const loop = !!o.loop && o.loop !== 'false';
  if (loop && until == null) warn(tt('loopNoUntil'));
  sh.replay = { session: rs.session, from: new Date(from).toISOString(), until: until != null ? new Date(until).toISOString() : null, speed, loop, setAt: new Date().toISOString() };
  save(list);
  log(tt('replaySet', { alias: sh.alias || '-', id: sh.id }));
  log(tt('rowReplay', { v: replayText(sh) }));
  if (until != null) log(tt('rowLength', { real: Math.round((until - from) / 1000), shown: Math.round((until - from) / 1000 / speed), speed, loop: loop ? tt('loopWord') : '' }));
  log(tt('replayKeep'));
  return 0;
}

function cmdUrl(o) {
  const sh = findShare(load(), o._[1]);
  if (!sh) { warn(tt('urlNone')); return 2; }
  if (stateOf(sh) !== 'valid') { warn(tt('urlState', { state: statusOf(sh) })); return 1; }
  log(sh.url || linkOf(readJson(CONFIG) || {}, sh));
  return 0;
}

export async function main(argv) {
  const o = parse(argv);
  switch (o._[0]) {
    case 'create': return cmdCreate(o);
    case 'list': case undefined: return cmdList(o);
    case 'revoke': return cmdRevoke(o);
    case 'url': case 'link': return cmdUrl(o);
    case 'set': return cmdSet(o);
    default:
      for (const line of D().help) log(line);
      return o._[0] === 'help' ? 0 : 2;
  }
}
