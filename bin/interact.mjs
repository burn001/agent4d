// agent4d interact — Interactive 패널 켬/끔·기기 승인. Node 내장 모듈만.
//   agent4d interact [list] [--json]        켬/끔 상태 · 상태 파일 위치 · 기기 목록(별칭·지문·상태·마지막 접속)
//   agent4d interact on | off               기능 전체 켬/끔(기본 꺼짐)
//   agent4d interact allow <별칭|id>        승인 대기 기기를 승인(별칭은 한·영 어느 쪽이든, id 는 앞 4자 이상)
//   agent4d interact revoke <별칭|id>       승인 취소(그 기기는 다시 보낼 수 없음)
//   agent4d interact remove <별칭|id>       기록에서 지움(그 기기가 다시 열면 새 별칭으로 승인 대기)
//   agent4d interact audit [--n 20]         감사 기록 끝 n 줄
// 서버가 떠 있으면 로컬 관리 경로(POST /interact/admin, adminSecret)로, 꺼져 있으면 상태 파일을 직접 고친다(같은 함수 adminOp).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { ccvizHome } from '../server/home.mjs';
import { cliLang } from '../server/cli-i18n.mjs';
import { InteractStore } from '../server/interact-store.mjs';
import { adminOp } from '../server/interact.mjs';
import { pickPort } from './ctl.mjs';

const M = {
  en: {
    usage: 'Usage: agent4d interact [list] [--json] | on | off | notice on|off | allow <alias|id> | revoke <alias|id> | remove <alias|id> | audit [--n N]',
    state: 'Interactive panel: {on}',
    noticeLine: 'Notice line before each message (tells the receiving Claude a person typed it): {v}',
    noticeOn: 'ON (default)', noticeOff: 'OFF',
    noticeUsage: 'Usage: agent4d interact notice on|off',
    on: 'ON — approved devices can send messages to running sessions', off: 'OFF (default)',
    files: 'State files: {dir}  (clients.json · settings.json · audit.jsonl)',
    none: 'No devices yet. Open the Interactive tab in the viewer once (feature must be on) — it registers as "pending".',
    head: '{n} device(s):',
    row: '  {mark} {alias}  [{short}]  {status}  · registered {created} · last seen {seen}{remote}',
    st: { pending: 'pending approval', allowed: 'allowed', revoked: 'revoked' },
    remote: ' · remote',
    done: { allow: 'Allowed: {alias} [{short}]', revoke: 'Revoked: {alias} [{short}]', remove: 'Removed: {alias} [{short}]', on: 'Interactive panel turned ON.', off: 'Interactive panel turned OFF.' },
    notFound: 'No device matches "{q}". Run `agent4d interact list`.',
    ambiguous: 'More than one device matches "{q}":',
    needWho: 'Which device? Give its alias or id (see `agent4d interact list`).',
    offline: '(server not running — changed the state files directly; it takes effect on next start)',
    refused: 'The server refused the request ({why}).',
    failed: 'Failed: {why}',
    auditNone: 'No audit records yet.',
    hintOn: 'Next: open the viewer → panel header → Interactive, then `agent4d interact allow <alias>` here.',
  },
  ko: {
    usage: '사용법: agent4d interact [list] [--json] | on | off | notice on|off | allow <별칭|id> | revoke <별칭|id> | remove <별칭|id> | audit [--n N]',
    state: 'Interactive 패널: {on}',
    noticeLine: '메시지 앞 안내 줄(받는 Claude 에게 사람이 직접 쓴 글임을 알림): {v}',
    noticeOn: '켬(기본)', noticeOff: '끔',
    noticeUsage: '사용법: agent4d interact notice on|off',
    on: '켬 — 승인된 기기가 떠 있는 세션에 메시지를 보낼 수 있음', off: '꺼짐(기본)',
    files: '상태 파일: {dir}  (clients.json · settings.json · audit.jsonl)',
    none: '등록된 기기가 없습니다. 기능을 켠 뒤 화면에서 Interactive 탭을 한 번 열면 "승인 대기"로 등록됩니다.',
    head: '기기 {n}대:',
    row: '  {mark} {alias}  [{short}]  {status}  · 등록 {created} · 마지막 접속 {seen}{remote}',
    st: { pending: '승인 대기', allowed: '승인됨', revoked: '취소됨' },
    remote: ' · 원격',
    done: { allow: '승인했습니다: {alias} [{short}]', revoke: '승인을 취소했습니다: {alias} [{short}]', remove: '기록에서 지웠습니다: {alias} [{short}]', on: 'Interactive 패널을 켰습니다.', off: 'Interactive 패널을 껐습니다.' },
    notFound: '"{q}" 에 맞는 기기가 없습니다. `agent4d interact list` 를 보세요.',
    ambiguous: '"{q}" 에 맞는 기기가 여럿입니다:',
    needWho: '어느 기기인가요? 별칭이나 id 를 주세요(`agent4d interact list`).',
    offline: '(서버가 꺼져 있어 상태 파일을 직접 고쳤습니다 — 다음 기동부터 적용)',
    refused: '서버가 요청을 거부했습니다({why}).',
    failed: '실패: {why}',
    auditNone: '감사 기록이 아직 없습니다.',
    hintOn: '다음: 화면 → 패널 머리 → Interactive 를 연 뒤, 여기서 `agent4d interact allow <별칭>`.',
  },
};
const lang = () => (cliLang() === 'ko' ? 'ko' : 'en');
const L = () => M[lang()];
const fill = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? String(v[k]) : ''));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const when = (ms) => (ms ? new Date(ms).toLocaleString(lang() === 'ko' ? 'ko-KR' : 'en-US', { hour12: false }) : '-');
const aliasText = (c) => (c?.alias ? (lang() === 'ko' ? `${c.alias.ko} (${c.alias.en})` : c.alias.en) : '?');

function request(port, body, secret, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/interact/admin', timeout: timeoutMs,
      headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json', 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {} resolve({ status: res.statusCode, json }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 0 }));
    req.end(data);
  });
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--n' || a === '--port') out[a.slice(2)] = argv[++i];
    else if (a.startsWith('--n=') || a.startsWith('--port=')) { const [k, v] = a.slice(2).split('='); out[k] = v; }
    else out._.push(a);
  }
  return out;
}

/** @returns {Promise<number>} 종료 코드 */
export async function main(argv, { log = console.log, warn = console.error, home = ccvizHome(), offlineOnly = false } = {}) {
  const opts = parseArgs(argv);
  const sub = (opts._[0] || 'list').toLowerCase();
  const who = opts._.slice(1).join(' ').trim() || null;
  const OPS = ['list', 'status', 'on', 'off', 'notice', 'allow', 'revoke', 'remove', 'audit'];
  if (sub === 'help' || !OPS.includes(sub)) { log(L().usage); return sub === 'help' ? 0 : 2; }
  if (sub === 'notice' && !['on', 'off'].includes(String(who || '').toLowerCase())) { warn(L().noticeUsage); return 2; }
  if (['allow', 'revoke', 'remove'].includes(sub) && !who) { warn(L().needWho); return 2; }
  const body = { op: sub, who, n: opts.n };

  let out = null, offline = false;
  const cfg = readJson(path.join(home, 'config.json'));
  if (!offlineOnly && cfg?.adminSecret) {
    const port = pickPort(opts, cfg, readJson(path.join(home, 'state.json')));
    const r = await request(port, body, cfg.adminSecret);
    if (r.status === 200 && r.json) out = r.json;
    else if (r.status && r.status !== 404) { warn(fill(L().refused, { why: r.json?.error || r.status })); return 1; }
    // 404 = 이 기능을 모르는 옛 서버, 0 = 꺼져 있음 → 파일 직접
  }
  if (!out) { out = adminOp(new InteractStore({ home }), body); offline = true; }

  if (opts.json) { log(JSON.stringify(out, null, 2)); return out.ok ? 0 : 1; }
  if (!out.ok) {
    if (out.error === 'not_found') warn(fill(L().notFound, { q: who }));
    else if (out.error === 'ambiguous') { warn(fill(L().ambiguous, { q: who })); for (const c of out.matches || []) warn(`  ${aliasText(c)}  [${c.short}]  ${L().st[c.status] || c.status}`); }
    else warn(fill(L().failed, { why: out.detail || out.error }));
    return 1;
  }
  if (sub === 'audit') {
    const rows = out.audit || [];
    if (!rows.length) log(L().auditNone);
    for (const a of rows) log(`  ${a.ts}  ${a.ev}${a.alias ? '  ' + a.alias : ''}${a.target || a.project ? `  → ${[a.project, a.target].filter(Boolean).join('/')}` : ''}${a.result ? '  ' + a.result + (a.why ? `(${a.why})` : '') : a.why ? `  (${a.why})` : ''}${a.preview ? `  "${a.preview}"` : ''}`);
    log(fill(L().files, { dir: path.dirname(out.files?.audit || '') }));
    return 0;
  }
  if (L().done[sub]) log(fill(L().done[sub], { alias: aliasText(out.client), short: out.client?.short || '' }));
  log(fill(L().state, { on: out.enabled ? L().on : L().off }));
  if (out.notice != null) log(fill(L().noticeLine, { v: out.notice ? L().noticeOn : L().noticeOff }));
  log(fill(L().files, { dir: path.dirname(out.files?.clients || '') }));
  const list = out.clients || [];
  if (!list.length) log(L().none);
  else {
    log(fill(L().head, { n: list.length }));
    for (const c of list) log(fill(L().row, { mark: c.status === 'allowed' ? '✓' : c.status === 'pending' ? '…' : '✗', alias: aliasText(c), short: c.short,
      status: L().st[c.status] || c.status, created: when(c.createdAt), seen: when(c.lastSeen), remote: c.remote ? L().remote : '' }));
  }
  if (sub === 'on') log(L().hintOn);
  if (offline && sub !== 'list' && sub !== 'status') log(L().offline);
  return 0;
}
