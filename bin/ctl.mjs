// agent4d ctl — 열려 있는 화면을 말(명령)로 조작. Node 내장 모듈만.
//   agent4d ctl <명령> [값…] [--client <id|이름>] [--temp] [--wait 초] [--json] [--port N]
//   agent4d ctl clients [--json]      접속 중 화면 목록(id·이름·로컬/원격·범위·표현·테마·마지막 응답)
//   agent4d ctl state [--json]        화면마다 지금 상태 자세히
//   agent4d ctl help                  명령 목록
// 보내기는 로컬 서버(127.0.0.1)의 POST /control 에 config.adminSecret 을 Bearer 로 — 서버가 루프백·프록시 표지 없음까지 확인한다.
// 화면이 적용 뒤 ack 를 돌려주면 성공한 화면 수·실패 사유를 출력. 화면이 없으면 그렇게 알린다.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { ccvizHome } from '../server/home.mjs';
import { cliLang } from '../server/cli-i18n.mjs';
import { parseCtl, CTL_COMMANDS } from '../web/control-core.mjs';

const M = {
  en: {
    noConfig: 'No Agent4D config found ({file}). Run `agent4d start` first.',
    noSecret: 'config has no adminSecret — run `agent4d start` once to create it.',
    down: 'The local server is not responding on port {port}. Start it with `agent4d start` (or pass --port).',
    usage: 'Usage: agent4d ctl <command> [value…] [--client <id|name>] [--temp] [--wait S] [--json] [--port N]\n       agent4d ctl clients | state | help',
    commands: 'Commands:',
    noClients: 'No viewer is open. Open the link from `agent4d url` in a browser first.',
    noMatch: 'No open viewer matches --client "{q}". Open viewers:',
    applied: 'Applied: {ok}/{n} viewer(s) · {cmd}',
    okLine: '  ✓ {name} ({id})',
    failLine: '  ✗ {name} ({id}) — {why}',
    gesture: '  ♪ Sound is on, but the browser needs one click on the page before it can play ({names}).',
    ambiguous: 'More than one match for "{q}". Which one?',
    notFound: 'Nothing matches "{q}".{more}',
    someAre: ' Known:',
    badValue: 'Invalid value. Usage: agent4d ctl {usage}',
    unknown: 'Unknown command "{cmd}". Run `agent4d ctl help`.',
    unauthorized: 'The server rejected the admin secret (config and running server differ?). Restart with `agent4d start`.',
    refused: 'The server refused the request ({why}). Commands can only be sent from this PC.',
    clientsHead: '{n} viewer(s) open:',
    clientsNone: 'No viewer is open.',
    local: 'local', remote: 'remote',
    seen: '{s}s ago',
    why: { timeout: 'no answer (timeout)', disconnected: 'disconnected', remote_off: 'remote control is turned off on that screen (⚙)', not_applied: 'not applied', unsupported: 'not supported by that viewer (old version? reload it)', exception: 'error', no_scope: 'project/session scope not available on that screen', not_found: 'not found', not_ready: 'not available in this view', bad_value: 'invalid value', replaying: 'not while replaying' },
  },
  ko: {
    noConfig: 'Agent4D 설정이 없습니다({file}). 먼저 `agent4d start` 를 실행해 주세요.',
    noSecret: 'config 에 adminSecret 이 없습니다 — `agent4d start` 를 한 번 실행하면 만들어집니다.',
    down: '로컬 서버가 {port} 포트에서 응답하지 않습니다. `agent4d start` 로 켜거나 --port 를 지정해 주세요.',
    usage: '사용법: agent4d ctl <명령> [값…] [--client <id|이름>] [--temp] [--wait 초] [--json] [--port N]\n        agent4d ctl clients | state | help',
    commands: '명령:',
    noClients: '열려 있는 화면이 없습니다. `agent4d url` 의 링크를 브라우저에서 먼저 열어 주세요.',
    noMatch: '--client "{q}" 에 맞는 화면이 없습니다. 열려 있는 화면:',
    applied: '적용: 화면 {ok}/{n} · {cmd}',
    okLine: '  ✓ {name} ({id})',
    failLine: '  ✗ {name} ({id}) — {why}',
    gesture: '  ♪ 소리는 켰지만 브라우저 정책상 화면을 한 번 눌러야 소리가 납니다({names}).',
    ambiguous: '"{q}" 에 맞는 것이 여럿입니다. 어느 것인가요?',
    notFound: '"{q}" 에 맞는 것이 없습니다.{more}',
    someAre: ' 있는 것:',
    badValue: '값이 올바르지 않습니다. 사용법: agent4d ctl {usage}',
    unknown: '모르는 명령 "{cmd}" 입니다. `agent4d ctl help` 를 보세요.',
    unauthorized: '서버가 관리자 비밀을 거부했습니다(설정과 떠 있는 서버가 다름?). `agent4d start` 로 다시 켜 주세요.',
    refused: '서버가 요청을 거부했습니다({why}). 명령은 이 PC 에서만 보낼 수 있습니다.',
    clientsHead: '열린 화면 {n}개:',
    clientsNone: '열려 있는 화면이 없습니다.',
    local: '로컬', remote: '원격',
    seen: '{s}초 전',
    why: { timeout: '응답 없음(시간 초과)', disconnected: '연결 끊김', remote_off: '그 화면에서 원격 조작 받기를 껐습니다(⚙)', not_applied: '적용 안 됨', unsupported: '그 화면이 모르는 명령(옛 버전? 새로고침)', exception: '오류', no_scope: '그 화면은 프로젝트·세션 범위를 쓸 수 없음', not_found: '찾을 수 없음', not_ready: '지금 표현에서는 쓸 수 없음', bad_value: '값이 올바르지 않음', replaying: '재생 중에는 안 됨' },
  },
};
const L = () => M[cliLang()] || M.en;
const fill = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? String(v[k]) : ''));
const say = (k, v) => fill(L()[k], v);
const whyText = (r) => (L().why[r.error] || r.error || '') + (r.detail ? ` (${r.detail})` : '');

function parseArgs(argv) {
  const out = { _: [] };
  const FLAGS = new Set(['json', 'temp', 'help']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) out[k] = v;
      else if (!FLAGS.has(k) && argv[i + 1] != null && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** 포트: --port > state.json(떠 있는 서버) > config.port > 7788 */
export function pickPort(opts, cfg, st) {
  if (opts.port != null && opts.port !== true && Number(opts.port) > 0) return Number(opts.port);
  if (st && Number(st.port) > 0 && st.serverPid) return Number(st.port);
  return Number(cfg?.port) || 7788;
}

function request(port, method, p, secret, body, timeoutMs) {
  return new Promise((resolve) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: '127.0.0.1', port, method, path: p, timeout: timeoutMs,
      headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {} resolve({ status: res.statusCode, json }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

function stateBrief(s) {
  if (!s) return '';
  const parts = [s.scopeLabel || s.scope, s.view && `${s.view}${s.dim ? ' ' + s.dim : ''}`, s.theme && `theme ${s.theme}`, s.sound && `sound ${s.sound}${s.sound === 'on' && (s.music === 'off' || s.sfx === 'off') ? ` (${[s.music === 'off' && 'music off', s.sfx === 'off' && 'sfx off'].filter(Boolean).join(', ')})` : ''}`,
    s.paused ? 'paused' : null, s.replaying ? 'replay' : null, s.accept === false ? 'remote-off' : null].filter(Boolean);
  return parts.join(' · ');
}

function printHelp(log) {
  log(say('usage'));
  log('');
  log(say('commands'));
  for (const spec of Object.values(CTL_COMMANDS)) log('  ' + spec.usage);
}

/** @returns {Promise<number>} 종료 코드 */
export async function main(argv, { log = console.log, warn = console.error, home = ccvizHome() } = {}) {
  const opts = parseArgs(argv);
  const words = opts._;
  const sub = (words[0] || '').toLowerCase();
  if (!sub || sub === 'help' || opts.help) { printHelp(log); return sub || opts.help ? 0 : 2; }
  const cfgFile = path.join(home, 'config.json');
  const cfg = readJson(cfgFile);
  if (!cfg) { warn(say('noConfig', { file: cfgFile })); return 1; }
  if (!cfg.adminSecret) { warn(say('noSecret')); return 1; }
  const st = readJson(path.join(home, 'state.json'));
  const port = pickPort(opts, cfg, st);
  const waitS = Math.max(0.5, Math.min(20, Number(opts.wait) || 8));

  const fail = (r) => {
    if (r.status === 0) { warn(say('down', { port })); return 1; }
    if (r.status === 401) { warn(say('unauthorized')); return 1; }
    warn(say('refused', { why: r.json?.error || r.status }));
    return 1;
  };

  if (sub === 'clients' || sub === 'state') {
    const r = await request(port, 'GET', '/control/clients', cfg.adminSecret, null, 5000);
    if (r.status !== 200) return fail(r);
    const list = r.json?.clients || [];
    if (opts.json) { log(JSON.stringify(r.json, null, 2)); return 0; }
    if (!list.length) { log(say('clientsNone')); return 0; }
    log(say('clientsHead', { n: list.length }));
    for (const c of list) {
      const where = c.remote ? L().remote : L().local;
      log(`  ${c.id}  ${c.name || '-'}  [${where}]  ${say('seen', { s: c.lastSeenSec })}`);
      if (sub === 'clients') { const b = stateBrief(c.state); if (b) log(`      ${b}`); }
      else for (const [k, v] of Object.entries(c.state || {})) log(`      ${k}: ${v}`);
    }
    return 0;
  }

  const p = parseCtl(words, { at: opts.at, speed: opts.speed, sec: opts.sec });
  if (!p.ok) {
    if (p.error === 'unknown_command') warn(say('unknown', { cmd: words[0] }));
    else warn(say('badValue', { usage: CTL_COMMANDS[p.cmd]?.usage || (CTL_COMMANDS[String(words[0]).toLowerCase()]?.usage) || p.hint || '' }));
    return 2;
  }
  const body = { cmd: p.cmd, args: p.args, client: typeof opts.client === 'string' ? opts.client : null, temp: !!opts.temp, wait: Math.round(waitS * 1000) };
  const r = await request(port, 'POST', '/control', cfg.adminSecret, body, waitS * 1000 + 8000);
  if (r.status !== 200 || !r.json) return fail(r);
  const out = r.json;
  if (opts.json) { log(JSON.stringify(out, null, 2)); return out.ok ? 0 : 1; }
  if (out.error === 'no_clients') { warn(say('noClients')); return 1; }
  if (out.error === 'no_match') {
    warn(say('noMatch', { q: body.client }));
    for (const c of out.clients || []) warn(`  ${c.id}  ${c.name || '-'}`);
    return 1;
  }
  if (out.error === 'ambiguous' || out.error === 'not_found') {
    const q = p.args.target?.q || p.args.session || '';
    if (out.error === 'ambiguous') warn(say('ambiguous', { q }));
    else warn(say('notFound', { q, more: out.candidates?.length ? L().someAre : '' }));
    for (const c of out.candidates || []) warn(c.projectId && c.name ? `  - ${c.name}  (${c.projectId})${c.live ? ' ●' : ''}` : `  - ${c.sessionId}${c.title ? '  ' + c.title : ''}`);
    return 1;
  }
  if (out.error && !out.results?.length) { warn(say('badValue', { usage: CTL_COMMANDS[p.cmd]?.usage || '' })); return 1; }
  log(say('applied', { ok: out.applied || 0, n: out.sent || 0, cmd: p.cmd }));
  for (const x of out.results || []) log(x.ok ? say('okLine', { name: x.name || '-', id: x.client }) : say('failLine', { name: x.name || '-', id: x.client, why: whyText(x) }));
  const g = (out.results || []).filter((x) => x.ok && x.pendingGesture);
  if (g.length) log(say('gesture', { names: g.map((x) => x.name || x.client).join(', ') }));
  return out.ok ? 0 : 1;
}
