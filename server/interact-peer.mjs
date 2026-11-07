// Interactive 전달: 이미 떠 있는 Claude Code 세션의 교차 세션 수신함(로컬 파이프·소켓)에 메시지 한 건을 넣는다.
// Agent4D 는 LLM 을 띄우지 않는다(claude -p 금지). Claude Code 2.1.x 의 비공개 내부 규약(peerProtocol 1)에 기대므로
// 판이 바뀌면 깨질 수 있다 — 꼴이 다르면 보내지 않고 이유를 돌려준다.
//
// 규약(2.1.318 실측):
//  · 세션 기록  ~/.claude/sessions/<pid>.json  { pid, sessionId, kind, status, name, cwd, peerProtocol:1, messagingSocketPath }
//      messagingSocketPath — Windows \\.\pipe\LOCAL\cc-msg-<32hex>, 그 밖 유닉스 소켓 경로
//  · 수신함 열쇠 ~/.claude/sessions/<pid>.<sha256(정규 주소)>.key  { peerToken:<32hex>, … } (주인만 읽기)
//      정규 주소 — 파이프는 '\\.\pipe\' + (LOCAL\)이름 을 통째로 소문자, 소켓은 path.resolve
//  · 한 연결에 두 줄: {"type":"auth","token":<peerToken>}\n  +  {msgV:1, msg_id, type:"user", message:{role:"user", content}, priority:"next", session_id}\n
//      session_id 가 수신 세션과 다르면 수신 쪽이 버린다(재사용된 pid·주소로 엉뚱한 세션에 들어가지 않게)
//      content 는 <cross-session-message from-name="…">\n본문\n</cross-session-message> 꼴(수신 쪽 표시 규약)
//  · 수신 쪽 문(crossSessionInbound): 설정 accept|hold|refuse, 없으면 권한 모드 맞춤 — 수신 세션이 권한 무시(bypass)면
//      보낸 쪽 모드가 맞지 않는 메시지는 그 세션 화면에서 사람이 승인할 때까지 보류(hold)된다. Agent4D 는 모드를 주장하지 않는다.
//  · 수락되면 transcript 에 type:'user', isMeta, origin:{kind:'peer', msg_id, name, body} 줄이 생긴다 → 전달 확인은 이 줄로
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { claudeHome, pidAlive } from './discovery.mjs';

export const PEER_PROTOCOL = 1;
export const TAG = 'cross-session-message';
export const TEXT_MAX = 4000; // 한 번에 보낼 글 상한(수신 쪽 한 줄 상한 1MB 보다 훨씬 작게)
const PIPE_RE = /^[\\/]{2}[.?][\\/]pipe[\\/](?:(LOCAL)[\\/])?([^\\/]+)$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BS = '\\';

/** 수신 주소 → 열쇠 파일 이름에 쓰는 정규 꼴(모르는 꼴이면 null) */
export function canonicalAddr(p) {
  if (typeof p !== 'string' || !p) return null;
  const m = PIPE_RE.exec(p);
  if (m) return (`${BS}${BS}.${BS}pipe${BS}` + (m[1] ? m[1] + BS : '') + m[2]).toLowerCase();
  if (/^[\\/]{2}/.test(p)) return null; // UNC·원격
  return path.isAbsolute(p) ? path.resolve(p) : null;
}
export const keyHash = (addr) => { const c = canonicalAddr(addr); return c ? crypto.createHash('sha256').update(c).digest('hex') : null; };

const sessionsDirOf = (sessionsDir) => sessionsDir || path.join(claudeHome(), 'sessions');

/** 살아 있고 수신함이 있는 세션 기록들(.key 는 읽지 않음) */
export function listPeerSessions({ sessionsDir = null, alive = pidAlive } = {}) {
  const dir = sessionsDirOf(sessionsDir);
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue;
    let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    if (!j || !UUID_RE.test(String(j.sessionId || '')) || !Number.isInteger(j.pid) || String(j.pid) !== f.slice(0, -5)) continue;
    if (typeof j.messagingSocketPath !== 'string' || !canonicalAddr(j.messagingSocketPath)) continue;
    if (!alive(j.pid)) continue;
    out.push({ pid: j.pid, sessionId: j.sessionId.toLowerCase(), kind: j.kind || null, status: j.status || null, name: typeof j.name === 'string' ? j.name : null,
      cwd: typeof j.cwd === 'string' ? j.cwd : null, peerProtocol: typeof j.peerProtocol === 'number' ? j.peerProtocol : null,
      version: typeof j.version === 'string' ? j.version : null, sock: j.messagingSocketPath, startedAt: j.startedAt ?? null,
      entrypoint: typeof j.entrypoint === 'string' ? j.entrypoint.slice(0, 24) : null,
      // 입력 대기(세션 기록 status 'waiting' + waitingFor — AskUserQuestion 창은 'input needed')
      waitingFor: j.status === 'waiting' && typeof j.waitingFor === 'string' ? j.waitingFor.slice(0, 40) : null, statusAt: Number.isFinite(j.statusUpdatedAt) ? j.statusUpdatedAt : null,
      // Remote Control(claude.ai/code) 브리지 세션 id — 있으면 질문창에 답하기·「Claude 앱에서 답하기」 링크
      bridgeSessionId: typeof j.bridgeSessionId === 'string' && /^(?:session|cse)_[A-Za-z0-9_-]{8,80}$/.test(j.bridgeSessionId) ? j.bridgeSessionId : null });
  }
  return out;
}

// ── 헤드리스(claude -p · SDK) 세션 가려내기 ──
// 세션 기록 kind 는 -p 회차도 'interactive' 로 적힌다(실측 2.1.318: 자율 루프 러너가 띄운 -p 회차). 판정 근거 두 가지:
//  ① 세션 기록 entrypoint — 사람이 띄운 CLI 는 'cli', -p·SDK 는 'sdk-cli'·'sdk-ts'·'sdk-py' 등(transcript 의 entrypoint 와 같은 값)
//  ② 프로세스 명령줄에 -p·--print(entrypoint 가 'cli' 이거나 없을 때만 확인). Windows 는 CIM 조회 한 번(pid+시작 시각으로 캐시), 리눅스 /proc, 그 밖 ps
const CMD_CACHE = new Map(); // `${pid}:${startedAt}` → { at, headless:boolean|null }
const CMD_TTL_MS = 10 * 60_000;
export const isHeadlessEntrypoint = (ep) => typeof ep === 'string' && ep !== 'cli' && /^(?:sdk|print|headless|mcp)/i.test(ep);
export function argvHeadless(cmdline) {
  if (typeof cmdline !== 'string' || !cmdline) return null;
  // 따옴표 안 글(프롬프트 본문)은 지운 뒤 낱말로: -p · --print · --print=… (묶인 짧은 옵션 -dp 등은 보지 않음)
  const toks = cmdline.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, ' ').split(/\s+/);
  return toks.some((t) => t === '-p' || t === '--print' || /^--print=/.test(t));
}
function queryCmdlines(pids, platform = process.platform) {
  return new Promise((resolve) => {
    const out = new Map();
    if (!pids.length) return resolve(out);
    if (platform === 'linux') {
      for (const pid of pids) { try { out.set(pid, fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\u0000').join(' ')); } catch {} }
      return resolve(out);
    }
    if (platform === 'win32') {
      const filter = pids.map((p) => `ProcessId=${Number(p)}`).join(' OR ');
      const ps = `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 8000, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => {
        for (const line of String(stdout || '').split(/\r?\n/)) { const m = /^(\d+)\|(.*)$/.exec(line); if (m) out.set(Number(m[1]), m[2]); }
        resolve(out);
      });
      return;
    }
    execFile('ps', ['-o', 'pid=,args=', '-p', pids.join(',')], { timeout: 4000 }, (err, stdout) => {
      for (const line of String(stdout || '').split('\n')) { const m = /^\s*(\d+)\s+(.*)$/.exec(line); if (m) out.set(Number(m[1]), m[2]); }
      resolve(out);
    });
  });
}
/**
 * 세션 기록들에 headless(true|false|null=모름)·why·unverified(— entrypoint 없음 + 명령줄 모름)를 붙인다. 명령줄 조회는 캐시(pid+시작 시각, 10분)·한 번에 묶어서.
 * @param {Array} recs listPeerSessions 결과
 */
export async function markHeadless(recs, { query = queryCmdlines, now = Date.now() } = {}) {
  const need = [];
  for (const r of recs) {
    if (isHeadlessEntrypoint(r.entrypoint)) { r.headless = true; r.headlessWhy = 'entrypoint'; continue; }
    const c = CMD_CACHE.get(`${r.pid}:${r.startedAt}`);
    if (c && now - c.at < CMD_TTL_MS) { r.headless = c.headless; r.headlessWhy = c.headless ? 'argv' : null; continue; }
    need.push(r);
  }
  if (need.length) {
    let m = new Map();
    try { m = await query(need.map((r) => r.pid)); } catch {}
    for (const r of need) {
      const h = m.has(r.pid) ? argvHeadless(m.get(r.pid)) : null;
      CMD_CACHE.set(`${r.pid}:${r.startedAt}`, { at: now, headless: h });
      if (CMD_CACHE.size > 256) CMD_CACHE.delete(CMD_CACHE.keys().next().value);
      r.headless = h; r.headlessWhy = h ? 'argv' : null;
    }
  }
  // '모름'의 안전 처리: entrypoint 도 없고 명령줄도 모르면(조회 실패) '확인 안 됨' — 막지는 않되 보내기 전에 한 번 더 확인받는다.
  // entrypoint 'cli' 이면 명령줄을 몰라도 사람이 띄운 세션으로 본다(-p 회차는 실측 'sdk-cli')
  for (const r of recs) r.unverified = r.headless == null && !r.entrypoint;
  return recs;
}

export function findPeerSession(sessionId, opts = {}) {
  const sid = String(sessionId || '').toLowerCase();
  const hits = listPeerSessions(opts).filter((r) => r.sessionId === sid);
  // 같은 세션 id 가 둘(재개 직후 등)이면 늦게 뜬 쪽
  return hits.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0] || null;
}

/** 수신함 열쇠(peerToken) — 보낼 때만 읽고 어디에도 내지 않는다. 없으면 null */
export function readPeerToken(rec, { sessionsDir = null } = {}) {
  const h = keyHash(rec?.sock);
  if (!h) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(sessionsDirOf(sessionsDir), `${rec.pid}.${h}.key`), 'utf8'));
    return typeof j?.peerToken === 'string' && /^[0-9a-f]{32}$/.test(j.peerToken) ? j.peerToken : null;
  } catch { return null; }
}

/** 보낸 이 이름(수신 쪽 from-name 속성: 따옴표·꺾쇠·줄바꿈 없이) */
// 사람이 친 글이라는 게 받는 쪽에 드러나게: ko '사용자 (Agent4D 화면 · <별칭>)' · en 'User (via Agent4D · <별칭>)'. 수신 쪽 from-name 은 80자까지 읽으므로 별칭은 40자
export const fromNameOf = (alias, lang = 'ko') => {
  const a = String(alias || 'device').replace(/["<>\r\n]/g, '').slice(0, 40);
  return lang === 'en' ? `User (via Agent4D · ${a})` : `사용자 (Agent4D 화면 · ${a})`;
};

/** 본문 맨 앞 안내 한 줄 — 받은 Claude 가 이것을 '다른 세션의 메시지'로 오해해 SendMessage 회신을 시도하지 않게 */
export const NOTICE_KO = '[Agent4D 화면에서 사용자가 직접 입력한 메시지입니다. 답은 이 세션 대화에 바로 쓰세요 - SendMessage 회신은 필요 없고 받는 통로도 없습니다.]';
export const NOTICE_EN = '[Agent4D screen: this message was typed directly by the user. Reply right here in this session conversation - no SendMessage reply is needed, and there is no channel to receive one.]';
export const withNotice = (text, lang = 'ko') => `${lang === 'en' ? NOTICE_EN : NOTICE_KO}\n\n${text}`;
/** 화면·이벤트용: 본문 맨 앞 안내 줄 떼기(감사 기록은 애초에 안내 없는 원문) */
export const stripNotice = (s) => String(s ?? '').replace(/^\[Agent4D (?:화면에서 사용자가|screen: this message was typed)[^\]\n]*\]\n*/, '');

/** 본문 감싸기 — 본문 안의 닫는 꼬리표는 무력화 */
export function wrapBody(text, fromName) {
  const body = String(text).replace(new RegExp(`</${TAG}`, 'gi'), `<\\/${TAG}`);
  return `<${TAG} from-name="${String(fromName).replace(/["<>\r\n]/g, '')}">\n${body}\n</${TAG}>`;
}

/** 연결에 쓸 두 줄(또는 열쇠가 없는 유닉스 소켓이면 한 줄) */
export function buildWire({ token, sessionId, text, fromName, msgId = crypto.randomUUID() }) {
  const msg = { msgV: 1, msg_id: msgId, type: 'user', message: { role: 'user', content: wrapBody(text, fromName) }, priority: 'next', session_id: sessionId };
  return { msgId, wire: (token ? JSON.stringify({ type: 'auth', token }) + '\n' : '') + JSON.stringify(msg) + '\n' };
}

export class PeerError extends Error {
  constructor(code, msg) { super(msg || code); this.code = code; }
}

/** 보내기 전 점검(값 없이 이유만) → null | 'no_session' | 'protocol' | 'no_key' */
export function checkTarget(rec, { sessionsDir = null, platform = process.platform } = {}) {
  if (!rec) return 'no_session';
  if (rec.peerProtocol !== PEER_PROTOCOL) return 'protocol';
  if (platform === 'win32' && !readPeerToken(rec, { sessionsDir })) return 'no_key';
  return null;
}

/**
 * 한 건 보내기. 성공하면 {msgId}. 실패는 PeerError(code: no_session|protocol|no_key|gone|busy|timeout|io)
 * @param {{sessionId:string, text:string, fromName:string, sessionsDir?:string, connect?:Function, timeoutMs?:number, platform?:string, alive?:Function}} o
 */
export async function sendToSession({ sessionId, text, fromName, sessionsDir = null, connect = net.connect, timeoutMs = 5000, platform = process.platform, alive = pidAlive }) {
  const rec = findPeerSession(sessionId, { sessionsDir, alive });
  const bad = checkTarget(rec, { sessionsDir, platform });
  if (bad) throw new PeerError(bad);
  const token = readPeerToken(rec, { sessionsDir });
  const { msgId, wire } = buildWire({ token, sessionId: rec.sessionId, text, fromName });
  await new Promise((resolve, reject) => {
    let done = false;
    const fin = (e) => { if (done) return; done = true; clearTimeout(timer); if (e) reject(e); else resolve(); };
    const sock = connect({ path: rec.sock });
    const timer = setTimeout(() => { try { sock.destroy(); } catch {} fin(new PeerError('timeout')); }, timeoutMs);
    sock.on('error', (e) => fin(new PeerError(e?.code === 'ENOENT' || e?.code === 'ECONNREFUSED' ? 'gone' : e?.code === 'EBUSY' || e?.code === 'EAGAIN' ? 'busy' : 'io', e?.code)));
    sock.on('connect', () => { sock.end(wire); });
    sock.on('close', (hadErr) => { if (!hadErr) fin(); });
  });
  return { msgId, pid: rec.pid };
}

// ── 응답 보기: 대화 흐름은 interact-feed.mjs ──
export { readFeed, feedItem, FEED_TAIL, FEED_STEP, ITEM_MAX } from './interact-feed.mjs';

/** 수신 세션 권한 모드로 '보류될 것 같음' 예측(설정 crossSessionInbound 는 모름 — 예측일 뿐) */
export const holdLikely = (mode) => mode === 'bypassPermissions';

/** 세션 id → transcript 파일(색인 → 없으면 projects 폴더 한 단계 훑기) */
export function transcriptOf(sessionId, { index = null, projectsDir = null } = {}) {
  const sid = String(sessionId || '').toLowerCase();
  if (!UUID_RE.test(sid)) return null;
  const e = index?.findSession?.(sid);
  if (e?.file) return e.file;
  const root = projectsDir || path.join(claudeHome(), 'projects');
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const f = path.join(root, d.name, `${sid}.jsonl`);
    try { if (fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}
