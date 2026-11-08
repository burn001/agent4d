// 범위 제한 공유 링크 CLI — agent4d share create|list|revoke|url
//   create --alias <별칭> --project <cwd 경로|프로젝트 폴더 이름> [--days N | --hours N | --minutes N] [--name <표시 이름>] [--redact [full|details]]
//   list [--json] [--all]        별칭·범위·발급/만료(KST)·잠금·상태 표(만료·폐기도 기록에 남김)
//   revoke <별칭|id>              로컬 기록 폐기 표시(서버가 곧바로 거부) + Worker KV 삭제
//   url <별칭|id>                 전체 링크 다시 출력(유효한 것만)
//   set <별칭|id> --replay <세션id(앞부분 가능)>@<시각> [--until <시각>] [--speed 4] [--loop] | --replay off
//                                 기본 리플레이(링크를 열면 그 세션을 그 시각부터 자동 재생, --loop 면 끝 시각에서 처음으로).
//                                 시각은 ISO(오프셋 없으면 KST)·'HH:mm[:ss]'(--until 만, 시작 날짜 기준). 토큰·URL·만료·잠금은 바꾸지 않는다
//   set <별칭|id> --redact full|details 잠금 등급(full = 글 모두 뺌, details = 설명 공개·경로/명령/코드/문서 번호/커밋/이름 가림). 토큰·URL·만료는 그대로
// 원본: <상태 폴더>/shares.json(토큰·전체 URL 포함, 현재 사용자만). 사람용 목록: <상태 폴더>/shares.md(토큰은 앞 8자만).
// Worker KV: share:<sha256(토큰)> → {id, exp} — 토큰 원문은 Worker 에 가지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ccvizHome } from '../server/home.mjs';
import { readShares, shareValid, sha256hex, newShareToken, newShareId, encodeCwd, SHARE_FILE, shareReplayOf, shareLevel, SHARE_LEVELS } from '../server/share.mjs';

const HOME = ccvizHome();
const CONFIG = path.join(HOME, 'config.json');
const FILE = path.join(HOME, SHARE_FILE);
const MD = path.join(HOME, 'shares.md');
const IS_WIN = process.platform === 'win32';
const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8, 16, 32]; // web/replay/engine.mjs SPEEDS
const LOCK_DESC = '공통 — 실황·Interactive·작업 대상·보관함 차단 · 한도·메모리 숨김 · 다른 프로젝트 안 보임. '
  + '텍스트 제거(full) = 경로·명령·입출력·말·제목·이름표 모두 뺌. '
  + '설명 공개(details) = 프로젝트 이름·세션 제목·서브에이전트 설명과 종류·도구별 일반 동작·스킬 이름은 보이고, 그 안의 경로·파일 이름·명령·코드·ADR/문서 번호·커밋·브랜치·사람 이름·이메일은 자리표시로 가림(도구 입력·결과 원문·말·프롬프트는 여전히 뺌)';
const LEVEL_TEXT = { full: '텍스트 제거', details: '설명 공개(경로·명령·코드·ADR·커밋·이름 가림)' };

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
export function statusOf(sh, now = Date.now()) {
  if (sh.revokedAt) return '폐기';
  return shareValid(sh, now) ? '유효' : '만료';
}
export const lockText = (sh) => (sh.redact === false ? '-' : `${shareLevel(sh) === 'details' ? '설명 공개 잠금(경로·명령·코드·ADR·커밋·이름 가림)' : '데이터 잠금(텍스트 제거)'}·실황/Interactive 차단·한도 숨김`);
/** --redact 값 → 'full'|'details'|null(틀림). 값 없이 --redact 만 주면 full */
export function parseLevel(v) {
  if (v === true || v == null) return 'full';
  const s = String(v).trim().toLowerCase();
  return SHARE_LEVELS.includes(s) ? s : null;
}
const levelValue = (lv) => (lv === 'details' ? 'details' : true); // shares.json 에는 예전처럼 true(full) 또는 'details'
const scopeText = (sh) => sh.cwd || sh.project;
/** 기본 리플레이 한 칸: 세션 앞 8자 @ 시작(KST)～끝 · 배속 · 반복 */
export function replayText(sh) {
  const r = shareReplayOf(sh);
  if (!r) return '-';
  const from = kst(new Date(r.from).toISOString());
  const until = r.until != null ? kst(new Date(r.until).toISOString()) : null;
  const tail = until ? (until.slice(0, 10) === from.slice(0, 10) ? until.slice(11) : until) : '끝';
  return `${r.session.slice(0, 8)} @ ${from}～${tail} · ${r.speed}× ${r.loop ? '· 반복' : ''}`.trim();
}

function load() { return readShares(FILE); }
function save(list) {
  writeSecure(FILE, JSON.stringify({ shares: list }, null, 2) + '\n');
  writeMd(list);
}

/** 사람용 목록(토큰은 앞 8자만, 전체 URL 은 json 에만) */
export function mdOf(list, now = Date.now()) {
  const rows = list.map((sh) => `| ${sh.alias || '-'} | ${sh.id} | ${scopeText(sh)} | ${kst(sh.createdAt)} | ${kst(sh.expiresAt)} | ${lockText(sh)} | ${replayText(sh)} | ${statusOf(sh, now)}${sh.revokedAt ? ` (${kst(sh.revokedAt)})` : ''} | \`${String(sh.token || sh.tokenHead || '').slice(0, 8)}…\` |`);
  return [
    '# Agent4D 공유 링크 목록',
    '',
    `> 자동 생성: ${kst(new Date(now).toISOString())} KST · 원본 \`shares.json\`(전체 링크·토큰은 그 파일에만) · 폐기 \`agent4d share revoke <별칭>\``,
    '',
    '| 별칭 | id | 범위(프로젝트) | 발급(KST) | 만료(KST) | 잠금 | 기본 리플레이 | 상태 | 토큰 앞부분 |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `잠금 내용: ${LOCK_DESC}.`,
    '',
  ].join('\n');
}
function writeMd(list) { try { writeSecure(MD, mdOf(list)); } catch (e) { warn('shares.md 쓰기 실패:', e.message); } }

function findShare(list, key) {
  if (!key) return null;
  const byAlias = list.filter((s) => s.alias === key);
  const live = byAlias.find((s) => statusOf(s) === '유효');
  return live || byAlias[byAlias.length - 1] || list.find((s) => s.id === key) || null;
}

async function workerShare(cfg, body) {
  if (!cfg.workerUrl || !cfg.adminSecret) return { ok: false, why: 'Worker 미배포(workerUrl 없음)' };
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
  if (!alias) { warn('별칭이 필요합니다: --alias <별칭>  (예: --alias 최종연심-2026-11-11)'); return 2; }
  if (alias.length > 64 || /[\r\n|`]/.test(alias)) { warn('별칭은 64자 이하, 줄바꿈·| · ` 없이 적어 주십시오.'); return 2; }
  const pr = resolveProject(o.project);
  if (!pr) { warn('범위가 필요합니다: --project <프로젝트 경로>'); return 2; }
  if (!pr.exists) warn(`주의: ~/.claude/projects/${pr.project} 폴더가 없습니다(세션이 없으면 화면이 비어 있습니다).`);
  const mins = o.minutes != null ? Number(o.minutes) : o.hours != null ? Number(o.hours) * 60 : (o.days != null ? Number(o.days) : 7) * 1440;
  if (!Number.isFinite(mins) || mins < 1 || mins > 90 * 1440) { warn('기간은 1분 이상 90일 이하로 주십시오(--days·--hours·--minutes).'); return 2; }
  if (o.redact === 'false' || o['no-redact']) { warn('공유 링크는 늘 데이터 잠금(redact)으로만 발급합니다.'); return 2; }
  const level = parseLevel(o.redact);
  if (!level) { warn(`--redact 는 ${SHARE_LEVELS.join('·')} 중 하나입니다.`); return 2; }
  const list = load();
  if (list.some((s) => s.alias === alias)) { warn(`별칭 '${alias}' 이(가) 이미 있습니다(만료·폐기 기록 포함). 다른 별칭을 쓰십시오.`); return 2; }
  const now = Date.now();
  const token = newShareToken();
  const sh = {
    id: newShareId(), alias, token, hash: sha256hex(token), project: pr.project, cwd: pr.cwd,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : '프로젝트',
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + mins * 60_000).toISOString(), redact: levelValue(level), kv: false,
  };
  const w = await workerShare(cfg, { op: 'put', hash: sh.hash, id: sh.id, exp: Date.parse(sh.expiresAt) });
  if (!w.ok) { warn(`Worker 등록 실패: ${w.why} — 발급하지 않았습니다(agent4d deploy 로 Worker 를 갱신했는지 확인).`); return 1; }
  sh.kv = true;
  sh.url = linkOf(cfg, sh);
  list.push(sh);
  save(list);
  log(`공유 링크를 발급했습니다 — 별칭 ${alias} · id ${sh.id}`);
  log(`  범위   ${scopeText(sh)} (${sh.project})`);
  log(`  만료   ${kst(sh.expiresAt)} KST`);
  log(`  잠금   ${lockText(sh)}`);
  log(`  링크   ${sh.url}`);
  log(`  폐기   agent4d share revoke ${alias}`);
  log('  (링크를 가진 사람은 누구나 기한 안에 볼 수 있습니다.)');
  return 0;
}

function pad(s, n) {
  const w = [...String(s)].reduce((a, c) => a + (/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7a3\uff00-\uffef]/.test(c) ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
}
function cmdList(o) {
  const list = load();
  if (o.json) { log(JSON.stringify(list.map(({ token, url, hash, ...r }) => ({ ...r, tokenHead: String(token || '').slice(0, 8), status: statusOf(r) })), null, 2)); return 0; }
  if (!list.length) { log('발급한 공유 링크가 없습니다.'); return 0; }
  writeMd(list); // 상태(만료)를 사람용 목록에도 다시 반영
  const rows = [['별칭', 'id', '범위(프로젝트)', '발급(KST)', '만료(KST)', '잠금', '기본 리플레이', '상태'],
    ...list.map((s) => [s.alias || '-', s.id, scopeText(s), kst(s.createdAt), kst(s.expiresAt), s.redact === false ? '-' : `${LEVEL_TEXT[shareLevel(s)]}·실황/Interactive 차단`, replayText(s), statusOf(s)])];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => [...String(r[i])].reduce((a, c) => a + (/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7a3\uff00-\uffef]/.test(c) ? 2 : 1), 0))));
  for (const [i, r] of rows.entries()) {
    log(r.map((c, j) => pad(c, widths[j])).join('  ').trimEnd());
    if (i === 0) log(widths.map((w) => '-'.repeat(w)).join('  '));
  }
  log(`\n목록 파일: ${FILE} (원본) · ${MD} (사람용)`);
  return 0;
}

async function cmdRevoke(o) {
  const key = o._[1];
  const list = load();
  const sh = findShare(list, key);
  if (!sh) { warn(`'${key || ''}' 별칭·id 의 공유 링크가 없습니다. agent4d share list 로 확인하십시오.`); return 2; }
  const already = !!sh.revokedAt;
  if (!already) { sh.revokedAt = new Date().toISOString(); save(list); } // 로컬 서버는 2초 안에 거부·열린 SSE 는 5초 안에 끊음
  const cfg = readJson(CONFIG) || {};
  const w = await workerShare(cfg, { op: 'delete', hash: sh.hash });
  if (w.ok) { sh.kv = false; save(list); }
  log(`${already ? '이미 폐기된' : '폐기했습니다 —'} 별칭 ${sh.alias || '-'} · id ${sh.id}${already ? ' 입니다' : ''}.`);
  log(w.ok ? '  Worker KV 에서도 지웠습니다(엣지 캐시로 최대 60초 늦을 수 있으나 로컬 서버가 먼저 거부).' : `  Worker KV 삭제 실패: ${w.why} — 로컬 서버는 거부합니다. 나중에 다시 revoke 하십시오.`);
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
  if (!/^[0-9a-f-]{4,36}$/.test(k)) return { why: '세션 id 는 영숫자·하이픈(앞 4자 이상)으로 주십시오.' };
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects', project);
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && f.toLowerCase().startsWith(k)).map((f) => f.slice(0, -6)); } catch { return { why: `~/.claude/projects/${project} 폴더를 읽지 못했습니다.` }; }
  if (!names.length) return { why: `이 공유 범위(${project})에 '${key}' 로 시작하는 세션이 없습니다.` };
  if (names.length > 1) return { why: `'${key}' 로 시작하는 세션이 ${names.length}개입니다 — 더 길게 주십시오.` };
  return { session: names[0], file: path.join(dir, names[0] + '.jsonl') };
}

async function cmdSet(o) {
  const key = o._[1];
  const list = load();
  const sh = findShare(list, key);
  if (!sh) { warn(`'${key || ''}' 별칭·id 의 공유 링크가 없습니다. agent4d share list 로 확인하십시오.`); return 2; }
  if (o.redact != null) {
    // 잠금 등급 바꾸기(토큰·URL·만료·Worker KV 그대로 — 서버가 2초 안에 새 등급으로 응답, 열린 화면은 새로고침하면 반영)
    const level = parseLevel(o.redact);
    if (!level || o.redact === true) { warn(`--redact 는 ${SHARE_LEVELS.join('·')} 중 하나입니다(예: --redact details).`); return 2; }
    const before = shareLevel(sh);
    sh.redact = levelValue(level);
    if (o.replay == null) {
      save(list);
      log(before === level ? `잠금 등급이 원래 ${level} 입니다 — 별칭 ${sh.alias || '-'}` : `잠금 등급을 바꿨습니다 — 별칭 ${sh.alias || '-'} · ${before} → ${level}`);
      log(`  잠금   ${lockText(sh)}`);
      log('  링크·토큰·만료·기본 리플레이는 그대로입니다(열린 화면은 새로고침하면 반영).');
      return 0;
    }
  }
  if (o.replay == null || o.replay === true) { warn('바꿀 설정이 없습니다: --replay <세션id>@<시각> [--until <시각>] [--speed 4] [--loop] | --replay off · --redact full|details'); return 2; }
  if (String(o.replay).toLowerCase() === 'off') {
    const had = !!sh.replay;
    delete sh.replay;
    save(list);
    log(had ? `기본 리플레이를 껐습니다 — 별칭 ${sh.alias || '-'} (링크는 그대로, 열면 실시간 보기)` : `기본 리플레이가 원래 없습니다 — 별칭 ${sh.alias || '-'}`);
    return 0;
  }
  const m = /^([^@]+)@(.+)$/.exec(String(o.replay));
  if (!m) { warn('--replay 는 <세션id>@<시각> 꼴입니다(예: a3443dd5@2026-11-05T07:49:20+09:00).'); return 2; }
  const rs = resolveSession(sh.project, m[1]);
  if (!rs.session) { warn(rs.why); return 2; }
  const from = parseKstTime(m[2]);
  if (!Number.isFinite(from)) { warn(`시작 시각을 읽지 못했습니다: ${m[2]}`); return 2; }
  let until = null;
  if (o.until != null && o.until !== true) {
    until = parseKstTime(o.until, from);
    if (!Number.isFinite(until)) { warn(`끝 시각을 읽지 못했습니다: ${o.until}`); return 2; }
    if (until <= from) { warn('끝 시각은 시작보다 뒤여야 합니다.'); return 2; }
    if (until - from > 24 * 3600_000) { warn('구간은 24시간 이하로 주십시오.'); return 2; }
  }
  const speed = o.speed != null && o.speed !== true ? Number(o.speed) : 1;
  if (!REPLAY_SPEEDS.includes(speed)) { warn(`배속은 ${REPLAY_SPEEDS.join('·')} 중 하나입니다.`); return 2; }
  const loop = !!o.loop && o.loop !== 'false';
  if (loop && until == null) warn('주의: --until 없이 --loop 면 세션 끝에서 시작 시각으로 돌아갑니다.');
  sh.replay = { session: rs.session, from: new Date(from).toISOString(), until: until != null ? new Date(until).toISOString() : null, speed, loop, setAt: new Date().toISOString() };
  save(list);
  log(`기본 리플레이를 정했습니다 — 별칭 ${sh.alias || '-'} · id ${sh.id}`);
  log(`  재생   ${replayText(sh)}`);
  if (until != null) log(`  길이   실제 ${Math.round((until - from) / 1000)}초 → 화면 ${Math.round((until - from) / 1000 / speed)}초(${speed}×)${loop ? ' 반복' : ''}`);
  log('  링크·토큰·만료·잠금은 그대로입니다(열린 화면은 새로고침하면 반영).');
  return 0;
}

function cmdUrl(o) {
  const sh = findShare(load(), o._[1]);
  if (!sh) { warn('해당 별칭·id 가 없습니다.'); return 2; }
  if (statusOf(sh) !== '유효') { warn(`이 링크는 ${statusOf(sh)} 상태입니다.`); return 1; }
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
      log('agent4d share create --alias <별칭> --project <경로> [--days 7|--hours N|--minutes N] [--name <표시 이름>] [--redact full|details]');
      log('agent4d share list [--json] · share revoke <별칭|id> · share url <별칭|id>');
      log('agent4d share set <별칭|id> --replay <세션id>@<시각> [--until <시각>] [--speed 4] [--loop] | --replay off');
      log('agent4d share set <별칭|id> --redact full|details   (잠금 등급: 텍스트 제거 | 설명 공개)');
      return o._[0] === 'help' ? 0 : 2;
  }
}
