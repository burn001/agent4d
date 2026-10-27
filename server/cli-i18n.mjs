// CLI·콘솔 문구 다국어(웹 UI 과 같은 원칙): 영어 기본, 로케일이 한국어면 한국어.
// 결정 순서: --lang en|ko → CCVIZ_LANG → LC_ALL → LC_MESSAGES → LANG(처음 나오는 의미 있는 값, C·POSIX 는 건너뜀)
//            → Intl 로케일(Windows 는 LANG 이 보통 비어 있어 여기서 정해짐) → en.
// bin/ccviz.mjs 는 --lang 을 받으면 CCVIZ_LANG 으로 옮겨 자식 프로세스(서버·감시·릴레이)도 같은 언어를 쓴다.
// 사전 값은 '{name}' 자리표시 문자열 또는 함수(vars => 문자열). 의존성 없음(Node 내장만).
// 주의: bin/statusline.mjs 는 <CCVIZ_HOME> 으로 복사돼 단독 실행되므로 이 모듈을 import 하지 않는다(ccviz 가 t 를 넘김).

export const CLI_LANGS = ['en', 'ko'];

/** 'ko…'→ko, 'en…'→en, 그 밖은 null */
export function normCliLang(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^ko(\b|[-_.]|$)/.test(s)) return 'ko';
  if (/^en(\b|[-_.]|$)/.test(s)) return 'en';
  return null;
}

/** argv 에서 --lang 값(없으면 null). '--lang ko' 와 '--lang=ko' 모두 */
export function langFlag(argv = process.argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '--lang') return argv[i + 1] != null && !String(argv[i + 1]).startsWith('--') ? String(argv[i + 1]) : '';
    if (a.startsWith('--lang=')) return a.slice(7);
  }
  return null;
}

/** argv 에서 --lang 과 그 값을 뺀 사본 */
export function stripLangFlag(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '--lang') { if (argv[i + 1] != null && !String(argv[i + 1]).startsWith('--')) i++; continue; }
    if (a.startsWith('--lang=')) continue;
    out.push(argv[i]);
  }
  return out;
}

let sysLocale;
function systemLocale() {
  if (sysLocale === undefined) {
    try { sysLocale = Intl.DateTimeFormat().resolvedOptions().locale || ''; } catch { sysLocale = ''; }
  }
  return sysLocale;
}

/** 언어 결정(순수 함수, 시험용으로 입력을 모두 받을 수 있음) */
export function resolveCliLang({ argv = process.argv, env = process.env, intlLocale } = {}) {
  const f = normCliLang(langFlag(argv));
  if (f) return f;
  const e = normCliLang(env.CCVIZ_LANG);
  if (e) return e;
  for (const k of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const v = String(env[k] ?? '').trim();
    if (!v || /^(c|posix)([._@]|$)/i.test(v)) continue;
    return /^ko/i.test(v) ? 'ko' : 'en';
  }
  const loc = intlLocale !== undefined ? intlLocale : systemLocale();
  return /^ko/i.test(String(loc || '')) ? 'ko' : 'en';
}

/** 지금 프로세스의 CLI 언어(매번 계산 — 환경 변수가 바뀌면 바로 따름) */
export const cliLang = () => resolveCliLang();

// ───────────────────────── 사전 ─────────────────────────
const en = {
  // 공통
  'common.error': 'Error: {msg}',
  'common.badLang': '--lang must be en or ko',

  // 링크
  'link.none': '(no fixed link — deploy the Worker first with `ccviz deploy`)',
  'link.localHead': '\nLocal link (this PC only):',
  'link.localHeadInline': '\nLocal link (this PC only):\n  {url}',
  'link.local': 'Local link:',
  'link.tunnelHint': '(enable remote access with --tunnel; see the remote access section in the README)',
  'link.tempHead': '\nTemporary tunnel link (changes on every restart, contains the token — share with care):',
  'link.fixedHead': '\nFixed link (external access, contains the token — share with care):',
  'link.newFixed': '\nNew fixed link:\n  {url}',

  // 서버·릴레이·터널
  'srv.reuse': '· Reusing server (PID {pid}, port {port})',
  'srv.killHung': '· Stopping unresponsive server (PID {pid})',
  'srv.stale': '· Running server is v{running} but v{current} is installed — restarting (PID {pid})',
  'srv.portBusy': 'Port {port} is already in use by another process. Choose another port with --port.',
  'srv.noEntry': 'Server entry point not found: {file}',
  'srv.started': '· Server started (PID {pid}, port {port}) — waiting for /healthz',
  'srv.timeout': 'The server did not respond within {sec}s (raise it with --wait <sec> or CCVIZ_START_TIMEOUT). Log: {log}',
  'relay.reuse': '· Reusing relay (PID {pid}, port {port})',
  'relay.portBusy': 'Relay port {port} is already in use by another process. Change config.relayPort.',
  'relay.noResponse': 'The relay is not responding. Log: {log}',
  'relay.started': '· Relay started (PID {pid}, port {port} → {target})',
  'tun.reuse': '· Reusing tunnel (PID {pid})',
  'tun.noExe': 'cloudflared not found: {exe}',
  'tun.started': '· cloudflared quick tunnel started (PID {pid}) — waiting for the address',
  'tun.noUrl': 'Could not get a trycloudflare address within 30s. Log: {log}',
  'tun.gotUrl': '· Tunnel address obtained — checking propagation',
  'tun.unreachable': '  (the tunnel address is not reachable from this PC yet — possibly DNS cache; continuing with registration)',
  'tun.failed': 'Tunnel failed: {msg}',

  // 등록
  'reg.badOrigin': 'Invalid tunnel address format',
  'reg.workerFail': '  Worker registration failed ({why}) — falling back to cf kv keys put',
  'reg.noKv': 'kvNamespaceId is missing from config. Run `ccviz deploy` first.',
  'reg.kvFail': 'cf kv keys put failed: {msg}',
  'reg.failed': 'Registration failed: {msg}',
  'reg.done': '· Registered ({via})',
  'reg.verifying': '· Checking the fixed address (KV propagation up to ~60s)',
  'reg.verifyTimeout': '  Fixed address check did not finish within 90s (last response: {status} {body}).',
  'reg.verifySlow': '  If KV propagation is slow the link opens in 1–2 minutes. Check again with `ccviz status`.',
  'reg.fixedOk': '· Fixed address OK',
  'reg.noWorker': 'The Worker is not deployed yet (no config.workerUrl), so no fixed link can be made. Run `ccviz deploy`, then `ccviz start` again.',

  // start
  'start.limits': '· Usage limits collector: {state} (config.limits.source = {source}) — a running server picks this up after stop + start',
  'start.on': 'on',
  'start.off': 'off',

  // watch
  'watch.reuse': '· Reusing watcher (PID {pid})',
  'watch.started': '· Watcher started (PID {pid}) — restarts and re-registers with the Worker automatically on disconnect. Log: {log}',
  'watch.other': '{ts} Another watcher (PID {pid}) is already running — exiting',
  'watch.begin': '{ts} Watch started (PID {pid}, every {sec}s)',
  'watch.released': '{ts} Watcher released in state (stop) — exiting',
  'watch.recovered': '{ts} Back to normal',
  'watch.anomaly': '{ts} Problem detected ({n} in a row): {bad}',
  'watch.tryRecover': '{ts} Recovering — re-running start (live parts are reused)',
  'watch.recoverResult': '{ts} Recovery {result}',
  'watch.recoverDone': 'complete',
  'watch.recoverPending': 'incomplete (retrying next cycle)',
  'watch.recoverFailed': '{ts} Recovery failed: {msg}',

  // autostart
  'auto.winOnly': 'autostart is Windows-only. On other OSes, add `node bin/ccviz.mjs start --watch` to a login script.',
  'auto.on': 'Start at logon: on',
  'auto.off': 'Start at logon: off',

  // stop
  'stop.done': 'Stopped ({n} processes).',
  'stop.none': 'No processes are running.',

  // status
  'st.running': 'running (PID {pid})',
  'st.runningPort': 'running (PID {pid}, port {port})',
  'st.off': 'off',
  'st.noResponse': 'no response',
  'st.notDeployed': 'not deployed (run ccviz deploy)',
  'st.server': 'Server     : {state} · 127.0.0.1:{port}/healthz → {code}',
  'st.relay': 'Relay      : {state}',
  'st.tunnel': 'Tunnel     : {state}{extra}',
  'st.worker': 'Worker     : {url}/_health → {code} {json}',
  'st.match': 'Registered : {yes}{extra}',
  'st.matchAt': ' (registered {at})',
  'st.yes': 'yes',
  'st.no': 'no',
  'st.watch': 'Watcher    : {state}',
  'st.watchOff': 'off (enable with start --watch)',
  'st.linkSession': 'Link session: {s}',
  'st.kv': 'KV ID      : {state}',
  'st.kvSet': 'set',
  'st.kvNone': 'none (run ccviz deploy)',
  'st.limits': 'Limits     : {line}',

  // 사용 한도
  'lim.just': 'just now',
  'lim.minAgo': 'as of {n} min ago',
  'lim.hourAgo': 'as of {n} h ago',
  'lim.disabled': 'off (opt-in — start --limits or config.limits.source = oauth)',
  'lim.srcOauth': 'usage API',
  'lim.srcStatusline': 'status line',
  'lim.line': '{parts} · source {src} · {age}{stale}{err}',
  'lim.stale': ' (stale)',
  'lim.lastFail': ' · last fetch failed ({kind})',
  'lim.noValueErr': 'no value · fetch failed ({kind}: {msg})',
  'lim.noValue': 'no value (no response yet or not a subscription)',
  'lim.cacheLine': '{parts} · source collector cache · {age}',
  'lim.noValueSl': 'no value · statusLine {state}',
  'lim.slLine': '{parts} · source status line file · {age}',
  'lim.reset': 'reset',
  'lim.textWin': '{name} {pct}% (resets {at}{est}{left})',
  'lim.textEst': ' est.',
  'lim.textLeft': ', {remain} left',
  'lim.textStale': 'stale',
  'lim.textErr': 'error {kind}: {msg}',
  'lim.usage': 'Usage: node bin/limits.mjs [--once] [--force] [--text] | --watch [--text]',

  // statusline
  'sl.installed': 'installed',
  'sl.notInstalled': 'not installed',
  'sl.badMode': '--mode must be limits or blank',
  'sl.deprecated': 'Not recommended: the limits collector is off by default and the recommended source is the standalone collector (config.limits.source = oauth). Wrapper values are only used when source is auto or statusline.',
  'sl.status': 'statusLine : {state}{mode}{at}{warn}',
  'sl.noWrapper': ' · warning: wrapper script missing',
  'sl.prev': 'Previous   : {cmd}',
  'sl.none': 'none',
  'sl.recorded': 'Recorded   : {parts} · {age}',
  'sl.recordedNone': 'Recorded   : none (no ratelimits.json)',
  'sl.source': 'Limits src : config.limits.source = {src}{note}',
  'sl.srcDefault': 'off (default)',
  'sl.srcNote': ' (not recommended — the standalone collector oauth is recommended)',
  'sl.usage': 'Usage: ccviz statusline install [--mode limits|blank] [--yes] | uninstall | status',
  'sl.readFail': 'Could not read settings.json: {msg}',
  'sl.badJson': 'settings.json is not valid JSON; aborting (nothing written): {msg}',
  'sl.badJsonShort': 'settings.json is not valid JSON; aborting (nothing written)',
  'sl.notObject': 'settings.json top level is not an object; aborting',
  'sl.already': 'Already installed. Run again with --yes to re-copy only the wrapper script.',
  'sl.refreshed': 'Already installed — re-copied only the wrapper script (prev unchanged).',
  'sl.planSettings': 'settings.json: {file}',
  'sl.planKey': 'Only the statusLine key changes → {cmd}',
  'sl.planPrev': 'The existing statusLine command keeps running and its output is kept (stored as prev).',
  'sl.planNoPrev': ({ blank }) => `There is no existing statusLine, so the wrapper prints ${blank ? 'an empty line' : 'a `5h n% · 7d n%` line'}.`,
  'sl.planHint': 'A custom statusLine hides the shortcut hints at the bottom of Claude Code.',
  'sl.planOverride': 'Warning: a project setting overrides statusLine — {file}',
  'sl.planYes': 'Run again with --yes to apply.',
  'sl.done': 'Installed — recording starts with the next response. The bottom shortcut hints are hidden.',
  'sl.restored': 'Restored settings.json from the pre-install copy.',
  'sl.removedFile': 'Removed the settings.json created at install.',
  'sl.restoredPrev': 'Restored statusLine to the pre-install command (other keys unchanged).',
  'sl.removedKey': 'Removed the statusLine key (other keys unchanged).',
  'sl.changed': 'statusLine was changed to another command in the meantime; leaving settings.json as is.',
  'sl.notOurs': 'Our statusLine is not in settings.json.',
  'sl.cleaned': 'Removed the wrapper script and statusline.json (backups and ratelimits.json are kept).',

  // deploy / rotate
  'dep.npm': '· npm {ci} in cloudflare/',
  'dep.npmFail': 'npm {ci} failed',
  'dep.kvListFail': 'Failed to list KV namespaces: {msg}',
  'dep.kvCreate': '· Creating KV namespace ({title})',
  'dep.kvCreateFail': 'Failed to create KV namespace: {msg}',
  'dep.kvExists': '· KV namespace exists ({title})',
  'dep.cfDeploy': '· cf deploy (Worker {name}, with secrets)',
  'dep.cfFail': 'cf deploy failed (exit {code})',
  'dep.urlUpdated': '· workerUrl updated: {url}',
  'dep.urlNotFound': '  (could not find the workers.dev address in the deploy output. If it differs, edit workerUrl in config.json yourself)',
  'dep.noUrl': 'Could not find the workers.dev address in the deploy output. Fill in workerUrl in config.json yourself (https://<name>.<subdomain>.workers.dev).',
  'dep.checking': '· Checking the deployment (the first workers.dev deploy can take a while to propagate)',
  'dep.notYet': '{url}/_health is not responding yet. Check again shortly with `ccviz status`.',
  'dep.done': 'Deployed: {url}',
  'rot.reissued': '· viewToken reissued, config saved',
  'rot.noKv': 'No kvNamespaceId, so the Worker secret was not updated. Run `ccviz deploy`.',
  'rot.done': 'Worker secret updated. Old links and cookies no longer open.',
  'rot.restart': 'If the local server is running, restart it to use the new token: ccviz stop && ccviz start',

  // update
  'upd.off': 'Update check is off (config updateCheck: false or AGENT4D_NO_UPDATE_CHECK=1).',
  'upd.fail': 'Could not check for updates right now ({err}). Try again later.',
  'upd.latest': 'Agent4D v{cur} is up to date.',
  'upd.newer': 'Agent4D v{latest} is available (you have v{cur}).\n  {url}{notes}\n  Run: agent4d update',
  'upd.notGit': 'This install ({dir}) is not a git clone, so it cannot update itself.\nDownload the latest release from {url} or re-clone: git clone https://github.com/{slug}.git',
  'upd.devClone': 'Development clone (origin {origin} is not {slug}) — skipped, nothing changed.',
  'upd.fetchFail': 'git fetch failed: {msg}',
  'upd.noRemote': 'This clone has no origin/main to update from.',
  'upd.stop.branch': 'Not updating: the clone is on branch "{branch}", not main. Switch with: git -C "{dir}" checkout main',
  'upd.stop.dirty': 'Not updating: the clone has local changes. Commit or stash them first (git -C "{dir}" status).',
  'upd.stop.diverged': 'Not updating: the clone has local commits that origin/main does not have, so a fast-forward is not possible.',
  'upd.plan': 'Update Agent4D v{cur} → v{next} ({n} new commit(s) from origin/main). Will:',
  'upd.planUpToDate': 'The code is already up to date (v{cur}). Will:',
  'upd.do.pull': '  - git pull --ff-only (with tags)',
  'upd.do.skill': '  - refresh the copied skill {dir} ({n} file(s); old files kept as *.bak)',
  'upd.do.restart': '  - restart the running server with the same options ({args})',
  'upd.do.nothing': '  - nothing to do',
  'upd.confirm': 'Continue? [y/N] ',
  'upd.needYes': 'Not a terminal, so I cannot ask. Re-run with --yes to apply.',
  'upd.cancel': 'Cancelled, nothing changed.',
  'upd.pullFail': 'git pull --ff-only failed: {msg}',
  'upd.pulled': 'Updated to v{next}.',
  'upd.skillLink': 'Skill {dir} is a link to the clone — already current.',
  'upd.skillDone': 'Refreshed the skill copy in {dir} ({n} file(s)).',
  'upd.skillFail': 'Could not refresh the skill copy in {dir}: {msg}',
  'upd.restarting': 'Restarting the server: agent4d {args}',
  'upd.restartFail': 'The server restart did not finish cleanly. Check with: agent4d status',
  'upd.done': 'Done.',
  'help': `Usage: ccviz <command> [--lang en|ko]
  start [--tunnel|--no-tunnel] [--limits|--no-limits] [--port N] [--project X] [--session ID|auto] [--wait sec] [--watch]
                                                start the server (127.0.0.1 only by default, prints a local link)
                                                --tunnel tunnel + Worker registration, fixed link (default when config remote:true or workerUrl is set)
                                                --limits turn on the usage limits collector (remembered in config, off by default)
                                                --watch also start a watcher that restarts and re-registers on disconnect
  watch [--interval sec]                        watch loop (foreground)
  stop                                          stop everything (including the watcher)
  status                                        show status
  link (url) [--session ID]                     print the fixed link
  autostart on|off|status                       start --watch at logon (Windows Task Scheduler)
  deploy                                        deploy the Worker, KV and secrets
  rotate-token                                  reissue the view token
  limits [--once] [--force] [--text] | --watch  run the token limits (5h/7d) collector alone (same JSON as the server's /limits)
  statusline install [--mode limits|blank] [--yes]
                                                (not recommended) install a statusLine wrapper that records usage limits — the default source is the standalone collector
  statusline uninstall | status                 restore the pre-install state / show install and record status
  archive add <session ID…> [--dir D] [--why reason]
                                                copy source sessions into the archive (timestamps kept, SHA-256 checked, skips existing), update the index
  archive list [--dir D] [--json]               list archived sessions (archive: --dir > CCVIZ_ARCHIVE > config archiveDir)
  ctl <command> [value] [--client id|name] [--temp] [--json] | ctl clients | ctl state | ctl help
                                                control open viewers from this PC (theme, view, scope, sound, pause…)
  job add --log F [--pid N] [--pattern RE] [--end F] [--expect 2h] | job list | find | rm | prune
                                                show a long job started outside Claude (detached process) next to its project (PID found from the log path if omitted)
  update [--check [--json] [--force]] [--yes]   check GitHub for a newer release (cached 24h) / update this git clone (fast-forward), the copied skill and the running server
  help                                          show this help
Language: --lang en|ko > CCVIZ_LANG > LC_ALL/LC_MESSAGES/LANG > system locale (default English)`,

  // archive
  'arc.noDir': 'No archive folder. Pass --dir or set config.archiveDir.',
  'arc.noIds': 'Give at least one session ID.',
  'arc.indexRead': 'Could not read index.json: {msg}',
  'arc.badSize': '{f}: size',
  'arc.badMtime': '{f}: modified time',
  'arc.badSha': '{f}: SHA-256',
  'arc.badDirTime': '{d}/: folder time',
  'arc.badCopy': '{f}: copy failed ({err})',
  'arc.badOutPath': '{rel}: output path',
  'arc.extras': '· children/outputs: {sid} children +{ca} (existing {ck}) · outputs +{oa} (existing {ok}){miss}',
  'arc.extrasMiss': ' · source missing: children {c}, outputs {o}',
  'arc.added': '· archived: {proj}/{sid} ({files} files, {mb} MB, {tools} tools, {subs} subagents)',
  'arc.skipped': '· already archived (skipped): {sid}',
  'arc.missing': '· not found in source: {sid}',
  'arc.ambiguous': '· prefix matches several sessions: {sid}',
  'arc.failed': '· verification failed: {sid} — {bad}',
  'arc.sumExtras': 'child sessions +{c} · outputs +{o}{miss}',
  'arc.sumExtrasMiss': ' · claude -p skipped (source missing) {n}',
  'arc.sum': 'added {a}{refreshed} · skipped {s}{failed}',
  'arc.sumRefreshed': ' · refreshed {n}',
  'arc.sumFailed': ' · failed {n}',
  'arc.listRow': '{when}  {hours}h  tools {tools}  subs {subs}  {sid}  {proj}  {why}',
  'arc.listCount': '{n} sessions',
  'arc.help': `ccviz archive add <session ID…> [--dir <archive>] [--why "reason"] [--from <projects folder>] [--refresh]
                                  copy sessions from the source (~/.claude/projects) into the archive with the same layout (timestamps kept, SHA-256 checked, skips existing)
                                  attached claude -p child sessions and background outputs (_tasks/) come along. --refresh: keep existing mains, add only missing children/outputs (all when no ID)
ccviz archive list [--dir <archive>] [--json]   list archived sessions (start KST · hours · tools · subagents · reason)
Archive folder: --dir > env CCVIZ_ARCHIVE > config.json archiveDir`,

  // 서버 콘솔
  'server.reqError': 'request error',
  'server.bindWarn': 'warning: binding to an address other than 127.0.0.1:',
  'server.error': 'server error:',
  'server.configCreated': 'created the config file or filled in missing tokens: {file}',
  'server.indexDone': 'session index ready ({sec}s)',
  'server.indexFail': 'session index failed:',
  'server.uncaught': 'uncaught exception:',
  'server.unhandled': 'unhandled rejection:',
  'server.startFail': 'startup failed:',
  'server.configRead': 'Could not read the config file: {file}: {msg}',
  'server.acquireFail': 'acquire failed',
  'server.dupNode': 'duplicate node id — only the first one is sent',
  'server.usageFail': 'limits usage failed',
  'server.replayMismatch': 'replay final state mismatch',
};

const ko = {
  'common.error': '오류: {msg}',
  'common.badLang': '--lang 은 en 또는 ko',

  'link.none': '(고정 링크 없음 — 먼저 `ccviz deploy` 로 Worker 를 배포하십시오)',
  'link.localHead': '\n로컬 링크(이 PC에서만):',
  'link.localHeadInline': '\n로컬 링크(이 PC에서만):\n  {url}',
  'link.local': '로컬 링크:',
  'link.tunnelHint': '(원격 접속은 --tunnel 로 켭니다. README 의 원격 접속 절 참조)',
  'link.tempHead': '\n임시 터널 링크(재기동마다 바뀜, 토큰 포함 — 공유 주의):',
  'link.fixedHead': '\n고정 링크(외부 접속, 토큰 포함 — 공유 주의):',
  'link.newFixed': '\n새 고정 링크:\n  {url}',

  'srv.reuse': '· 서버 재사용 (PID {pid}, 포트 {port})',
  'srv.killHung': '· 응답 없는 서버 종료 (PID {pid})',
  'srv.stale': '· 떠 있는 서버는 v{running}, 설치본은 v{current} — 다시 띄웁니다 (PID {pid})',
  'srv.portBusy': '포트 {port} 를 이미 다른 프로세스가 쓰고 있습니다. --port 로 다른 포트를 지정하십시오.',
  'srv.noEntry': '서버 진입점이 없습니다: {file}',
  'srv.started': '· 서버 기동 (PID {pid}, 포트 {port}) — /healthz 대기',
  'srv.timeout': '서버가 {sec}초 안에 응답하지 않았습니다(--wait 초 또는 CCVIZ_START_TIMEOUT 으로 늘릴 수 있음). 로그: {log}',
  'relay.reuse': '· 릴레이 재사용 (PID {pid}, 포트 {port})',
  'relay.portBusy': '릴레이 포트 {port} 를 이미 다른 프로세스가 쓰고 있습니다. config.relayPort 를 바꾸십시오.',
  'relay.noResponse': '릴레이가 응답하지 않습니다. 로그: {log}',
  'relay.started': '· 릴레이 기동 (PID {pid}, 포트 {port} → {target})',
  'tun.reuse': '· 터널 재사용 (PID {pid})',
  'tun.noExe': 'cloudflared 가 없습니다: {exe}',
  'tun.started': '· cloudflared quick tunnel 기동 (PID {pid}) — 주소 대기',
  'tun.noUrl': '30초 안에 trycloudflare 주소를 얻지 못했습니다. 로그: {log}',
  'tun.gotUrl': '· 터널 주소 확보 — 전파 확인 중',
  'tun.unreachable': '  (이 PC에서 터널 주소 확인이 아직 안 됩니다 — DNS 캐시일 수 있어 등록은 계속합니다)',
  'tun.failed': '터널 실패: {msg}',

  'reg.badOrigin': '잘못된 터널 주소 형식',
  'reg.workerFail': '  Worker 등록 실패({why}) — cf kv keys put 으로 대체',
  'reg.noKv': 'kvNamespaceId 가 config 에 없습니다. 먼저 `ccviz deploy` 를 실행하십시오.',
  'reg.kvFail': 'cf kv keys put 실패: {msg}',
  'reg.failed': '등록 실패: {msg}',
  'reg.done': '· 등록 완료 ({via})',
  'reg.verifying': '· 고정 주소 경유 확인 중 (KV 전파 최대 ～60초)',
  'reg.verifyTimeout': '  고정 주소 확인이 90초 안에 끝나지 않았습니다(마지막 응답: {status} {body}).',
  'reg.verifySlow': '  KV 전파가 늦는 경우 1～2분 뒤 링크가 열립니다. `ccviz status` 로 다시 확인하십시오.',
  'reg.fixedOk': '· 고정 주소 정상',
  'reg.noWorker': 'Worker 가 아직 배포되지 않아(config.workerUrl 없음) 고정 링크를 만들 수 없습니다. `ccviz deploy` 뒤 다시 `ccviz start` 하십시오.',

  'start.limits': '· 사용 한도 수집기: {state} (config.limits.source = {source}) — 이미 떠 있는 서버는 stop 후 start 해야 반영',
  'start.on': '켬',
  'start.off': '끔',

  'watch.reuse': '· 감시 재사용 (PID {pid})',
  'watch.started': '· 감시 기동 (PID {pid}) — 끊기면 자동으로 다시 띄우고 Worker 에 재등록합니다. 로그: {log}',
  'watch.other': '{ts} 다른 감시(PID {pid})가 이미 실행 중 — 종료',
  'watch.begin': '{ts} 감시 시작 (PID {pid}, {sec}초 간격)',
  'watch.released': '{ts} state 에서 감시가 해제됨(stop) — 종료',
  'watch.recovered': '{ts} 정상 복귀',
  'watch.anomaly': '{ts} 이상 감지 ({n}회 연속): {bad}',
  'watch.tryRecover': '{ts} 복구 시도 — start 재실행(살아 있는 부분은 재사용)',
  'watch.recoverResult': '{ts} 복구 {result}',
  'watch.recoverDone': '완료',
  'watch.recoverPending': '미완료(다음 주기에 재시도)',
  'watch.recoverFailed': '{ts} 복구 실패: {msg}',

  'auto.winOnly': 'autostart 는 Windows 전용입니다. 다른 OS 에서는 로그인 스크립트에 `node bin/ccviz.mjs start --watch` 를 넣으십시오.',
  'auto.on': '로그온 시 자동 시작: 켜짐',
  'auto.off': '로그온 시 자동 시작: 꺼짐',

  'stop.done': '종료했습니다 ({n}개 프로세스).',
  'stop.none': '실행 중인 프로세스가 없습니다.',

  'st.running': '실행 중 (PID {pid})',
  'st.runningPort': '실행 중 (PID {pid}, 포트 {port})',
  'st.off': '꺼짐',
  'st.noResponse': '응답 없음',
  'st.notDeployed': '미배포(ccviz deploy 필요)',
  'st.server': '서버       : {state} · 127.0.0.1:{port}/healthz → {code}',
  'st.relay': '릴레이     : {state}',
  'st.tunnel': '터널       : {state}{extra}',
  'st.worker': 'Worker     : {url}/_health → {code} {json}',
  'st.match': '등록 일치  : {yes}{extra}',
  'st.matchAt': ' (등록 {at})',
  'st.yes': '예',
  'st.no': '아니오',
  'st.watch': '감시       : {state}',
  'st.watchOff': '꺼짐 (start --watch 로 켬)',
  'st.linkSession': '링크 세션  : {s}',
  'st.kv': 'KV ID      : {state}',
  'st.kvSet': '설정됨',
  'st.kvNone': '없음(ccviz deploy 필요)',
  'st.limits': '한도       : {line}',

  'lim.just': '방금',
  'lim.minAgo': '{n}분 전 기준',
  'lim.hourAgo': '{n}시간 전 기준',
  'lim.disabled': '꺼짐(옵트인 — start --limits 또는 config.limits.source = oauth)',
  'lim.srcOauth': '사용량 조회',
  'lim.srcStatusline': '상태줄',
  'lim.line': '{parts} · 출처 {src} · {age}{stale}{err}',
  'lim.stale': '(오래됨)',
  'lim.lastFail': ' · 마지막 조회 실패({kind})',
  'lim.noValueErr': '값 없음 · 조회 실패({kind}: {msg})',
  'lim.noValue': '값 없음(아직 응답 전이거나 구독 아님)',
  'lim.cacheLine': '{parts} · 출처 수집기 캐시 · {age}',
  'lim.noValueSl': '값 없음 · statusLine {state}',
  'lim.slLine': '{parts} · 출처 상태줄 파일 · {age}',
  'lim.reset': '재설정됨',
  'lim.textWin': '{name} {pct}% (재설정 {at}{est}{left})',
  'lim.textEst': ' 추정',
  'lim.textLeft': ', {remain} 남음',
  'lim.textStale': '오래됨',
  'lim.textErr': '오류 {kind}: {msg}',
  'lim.usage': '사용법: node bin/limits.mjs [--once] [--force] [--text] | --watch [--text]',

  'sl.installed': '설치됨',
  'sl.notInstalled': '미설치',
  'sl.badMode': '--mode 는 limits 또는 blank',
  'sl.deprecated': '비권장: 한도 수집기는 기본 꺼짐이며 권장 출처는 독립 수집기(config.limits.source = oauth)입니다. 래퍼 값은 source 를 auto·statusline 으로 바꿔야 쓰입니다.',
  'sl.status': 'statusLine : {state}{mode}{at}{warn}',
  'sl.noWrapper': ' · 경고: 래퍼 실행본 없음',
  'sl.prev': '이전 명령  : {cmd}',
  'sl.none': '없음',
  'sl.recorded': '기록 값    : {parts} · {age}',
  'sl.recordedNone': '기록 값    : 없음(ratelimits.json 없음)',
  'sl.source': '한도 출처  : config.limits.source = {src}{note}',
  'sl.srcDefault': 'off(기본)',
  'sl.srcNote': ' (비권장 — 권장은 독립 수집기 oauth)',
  'sl.usage': '사용법: ccviz statusline install [--mode limits|blank] [--yes] | uninstall | status',
  'sl.readFail': 'settings.json 을 읽지 못했습니다: {msg}',
  'sl.badJson': 'settings.json 이 올바른 JSON 이 아니라 중단합니다(아무것도 쓰지 않음): {msg}',
  'sl.badJsonShort': 'settings.json 이 올바른 JSON 이 아니라 중단합니다(아무것도 쓰지 않음)',
  'sl.notObject': 'settings.json 최상위가 객체가 아니라 중단합니다',
  'sl.already': '이미 설치돼 있습니다. --yes 로 다시 실행하면 래퍼 실행본만 새로 복사합니다.',
  'sl.refreshed': '이미 설치돼 있습니다 — 래퍼 실행본만 다시 복사했습니다(prev 는 그대로).',
  'sl.planSettings': 'settings.json: {file}',
  'sl.planKey': 'statusLine 키만 바꿉니다 → {cmd}',
  'sl.planPrev': '기존 statusLine 명령은 그대로 실행되어 출력이 유지됩니다(prev 로 보관).',
  'sl.planNoPrev': ({ blank }) => `기존 statusLine 이 없어 래퍼가 ${blank ? '빈 줄' : '`5h n% · 7d n%` 한 줄'}을 출력합니다.`,
  'sl.planHint': 'custom statusLine 이 있으면 Claude Code 하단 단축키 안내가 숨겨집니다.',
  'sl.planOverride': '경고: 프로젝트 설정이 statusLine 을 덮어씁니다 — {file}',
  'sl.planYes': '바꾸려면 --yes 를 붙여 다시 실행하세요.',
  'sl.done': '설치됨 — 다음 응답부터 기록합니다. 하단 단축키 안내가 숨겨집니다.',
  'sl.restored': 'settings.json 을 설치 전 사본으로 되돌렸습니다.',
  'sl.removedFile': '설치 때 만든 settings.json 을 지웠습니다.',
  'sl.restoredPrev': 'statusLine 을 설치 전 명령으로 되돌렸습니다(다른 키는 그대로).',
  'sl.removedKey': 'statusLine 키를 지웠습니다(다른 키는 그대로).',
  'sl.changed': 'statusLine 이 그 사이 다른 명령으로 바뀌어 settings.json 은 그대로 둡니다.',
  'sl.notOurs': 'settings.json 에 우리 statusLine 이 없습니다.',
  'sl.cleaned': '래퍼 실행본·statusline.json 을 지웠습니다(백업·ratelimits.json 은 남김).',

  'dep.npm': '· cloudflare/ 에서 npm {ci}',
  'dep.npmFail': 'npm {ci} 실패',
  'dep.kvListFail': 'KV 목록 조회 실패: {msg}',
  'dep.kvCreate': '· KV 네임스페이스 생성 ({title})',
  'dep.kvCreateFail': 'KV 생성 실패: {msg}',
  'dep.kvExists': '· KV 네임스페이스 있음 ({title})',
  'dep.cfDeploy': '· cf deploy (Worker {name}, 시크릿 포함)',
  'dep.cfFail': 'cf deploy 실패 (exit {code})',
  'dep.urlUpdated': '· workerUrl 갱신: {url}',
  'dep.urlNotFound': '  (배포 출력에서 workers.dev 주소를 찾지 못했습니다. 다르면 config.json 의 workerUrl 을 직접 고치십시오)',
  'dep.noUrl': '배포 출력에서 workers.dev 주소를 찾지 못했습니다. config.json 의 workerUrl 을 직접 채우십시오(https://<이름>.<subdomain>.workers.dev).',
  'dep.checking': '· 배포 확인 중 (workers.dev 첫 배포는 전파에 시간이 걸릴 수 있음)',
  'dep.notYet': '{url}/_health 가 아직 응답하지 않습니다. 잠시 뒤 `ccviz status` 로 확인하십시오.',
  'dep.done': '배포 완료: {url}',
  'rot.reissued': '· viewToken 재발급, config 저장',
  'rot.noKv': 'kvNamespaceId 가 없어 Worker 시크릿은 갱신하지 않았습니다. `ccviz deploy` 를 실행하십시오.',
  'rot.done': 'Worker 시크릿 갱신 완료. 기존 링크·쿠키는 더 이상 열리지 않습니다.',
  'rot.restart': '로컬 서버가 실행 중이면 재시작해야 새 토큰을 씁니다: ccviz stop && ccviz start',

  // update
  'upd.off': '업데이트 확인이 꺼져 있습니다(config updateCheck: false 또는 AGENT4D_NO_UPDATE_CHECK=1).',
  'upd.fail': '지금은 업데이트를 확인하지 못했습니다({err}). 나중에 다시 시도하십시오.',
  'upd.latest': 'Agent4D v{cur} 가 최신입니다.',
  'upd.newer': 'Agent4D v{latest} 이 나왔습니다(설치본 v{cur}).\n  {url}{notes}\n  실행: agent4d update',
  'upd.notGit': '이 설치본({dir})은 git 클론이 아니라 스스로 갱신할 수 없습니다.\n{url} 에서 최신 릴리스를 받거나 다시 클론하십시오: git clone https://github.com/{slug}.git',
  'upd.devClone': '개발 클론이라 건너뜀(origin {origin} ≠ {slug}) — 바꾼 것 없음.',
  'upd.fetchFail': 'git fetch 실패: {msg}',
  'upd.noRemote': '이 클론에는 갱신할 origin/main 이 없습니다.',
  'upd.stop.branch': '갱신하지 않음: 클론이 main 이 아닌 "{branch}" 브랜치입니다. 바꾸기: git -C "{dir}" checkout main',
  'upd.stop.dirty': '갱신하지 않음: 클론에 고친 파일이 있습니다. 먼저 커밋하거나 stash 하십시오(git -C "{dir}" status).',
  'upd.stop.diverged': '갱신하지 않음: origin/main 에 없는 로컬 커밋이 있어 fast-forward 할 수 없습니다.',
  'upd.plan': 'Agent4D v{cur} → v{next} 갱신(origin/main 새 커밋 {n}개). 할 일:',
  'upd.planUpToDate': '코드는 이미 최신(v{cur})입니다. 할 일:',
  'upd.do.pull': '  - git pull --ff-only (태그 포함)',
  'upd.do.skill': '  - 복사해 둔 스킬 {dir} 갱신(파일 {n}개, 이전 파일은 *.bak 로 남김)',
  'upd.do.restart': '  - 실행 중인 서버를 같은 옵션으로 재시작({args})',
  'upd.do.nothing': '  - 할 일 없음',
  'upd.confirm': '계속할까요? [y/N] ',
  'upd.needYes': '터미널이 아니라 물어볼 수 없습니다. 적용하려면 --yes 를 붙여 다시 실행하십시오.',
  'upd.cancel': '취소, 바꾼 것 없음.',
  'upd.pullFail': 'git pull --ff-only 실패: {msg}',
  'upd.pulled': 'v{next} 로 갱신했습니다.',
  'upd.skillLink': '스킬 {dir} 는 클론을 가리키는 링크라 이미 최신입니다.',
  'upd.skillDone': '스킬 사본 {dir} 갱신(파일 {n}개).',
  'upd.skillFail': '스킬 사본 {dir} 를 갱신하지 못했습니다: {msg}',
  'upd.restarting': '서버 재시작: agent4d {args}',
  'upd.restartFail': '서버 재시작이 깔끔히 끝나지 않았습니다. 확인: agent4d status',
  'upd.done': '완료.',
  'help': `사용법: ccviz <명령> [--lang en|ko]
  start [--tunnel|--no-tunnel] [--limits|--no-limits] [--port N] [--project X] [--session ID|auto] [--wait 초] [--watch]
                                                서버 기동(기본 127.0.0.1 전용, 로컬 링크 출력)
                                                --tunnel 터널+Worker 등록·고정 링크(config remote:true 또는 workerUrl 이 있으면 기본)
                                                --limits 사용 한도 수집기 켜기(config 에 기억, 기본 꺼짐)
                                                --watch 끊김 감시·자동 재기동·재등록 프로세스 함께 기동
  watch [--interval 초]                         감시 루프(전경)
  stop                                          종료(감시 포함)
  status                                        상태
  link (url) [--session ID]                     고정 링크 출력
  autostart on|off|status                       로그온 시 start --watch (Windows 작업 스케줄러)
  deploy                                        Worker·KV·시크릿 배포
  rotate-token                                  보기 토큰 재발급
  limits [--once] [--force] [--text] | --watch  토큰 한도(5h/7d) 독립 수집기 단독 실행(서버 /limits 와 같은 JSON)
  statusline install [--mode limits|blank] [--yes]
                                                (비권장) 사용 한도 기록용 statusLine 래퍼 설치 — 기본 출처는 독립 수집기
  statusline uninstall | status                 설치 전으로 되돌림 / 설치·기록 상태
  archive add <세션ID…> [--dir D] [--why 사유]  원본 세션을 보관함에 복사(시각 보존·SHA-256 대조, 있으면 건너뜀)·index 갱신
  archive list [--dir D] [--json]               보관된 세션 목록 (보관함: --dir > CCVIZ_ARCHIVE > config archiveDir)
  ctl <명령> [값] [--client id|이름] [--temp] [--json] | ctl clients | ctl state | ctl help
                                                열린 화면을 이 PC 에서 조작(테마·표현·범위·소리·일시정지…)
  job add --log F [--pid N] [--pattern 정규식] [--end F] [--expect 2h] | job list | find | rm | prune
                                                Claude 밖에서 따로 띄운 오래 도는 작업을 프로젝트 옆에 표시(--pid 없으면 로그 경로로 찾음)
  update [--check [--json] [--force]] [--yes]   새 릴리스 확인(24시간 캐시) / 이 git 클론(fast-forward)·복사한 스킬·실행 중 서버 갱신
  help                                          이 도움말
언어: --lang en|ko > CCVIZ_LANG > LC_ALL/LC_MESSAGES/LANG > 시스템 로케일 (기본 영어)`,

  'arc.noDir': '보관함 폴더가 없습니다. --dir 을 주거나 config.archiveDir 을 설정하십시오.',
  'arc.noIds': '세션 ID 를 하나 이상 주십시오.',
  'arc.indexRead': 'index.json 을 읽지 못했습니다: {msg}',
  'arc.badSize': '{f}: 크기',
  'arc.badMtime': '{f}: 수정 시각',
  'arc.badSha': '{f}: SHA-256',
  'arc.badDirTime': '{d}/: 폴더 시각',
  'arc.badCopy': '{f}: 복사 실패({err})',
  'arc.badOutPath': '{rel}: 출력 경로',
  'arc.extras': '· 자식·출력: {sid} 자식 +{ca}(있음 {ck}) · 출력 +{oa}(있음 {ok}){miss}',
  'arc.extrasMiss': ' · 원본 없음: 자식 {c}·출력 {o}',
  'arc.added': '· 보관: {proj}/{sid} (파일 {files}개, {mb} MB, 도구 {tools}, 서브 {subs})',
  'arc.skipped': '· 이미 있음(건너뜀): {sid}',
  'arc.missing': '· 원본에 없음: {sid}',
  'arc.ambiguous': '· 여러 세션과 겹치는 앞부분: {sid}',
  'arc.failed': '· 대조 실패: {sid} — {bad}',
  'arc.sumExtras': '자식 세션 +{c} · 출력 +{o}{miss}',
  'arc.sumExtrasMiss': ' · 원본에 없어 건너뛴 claude -p {n}',
  'arc.sum': '추가 {a}{refreshed} · 건너뜀 {s}{failed}',
  'arc.sumRefreshed': ' · 보강 {n}',
  'arc.sumFailed': ' · 실패 {n}',
  'arc.listRow': '{when}  {hours}h  도구 {tools}  서브 {subs}  {sid}  {proj}  {why}',
  'arc.listCount': '세션 {n}개',
  'arc.help': `ccviz archive add <세션ID…> [--dir <보관함>] [--why "사유"] [--from <projects 폴더>] [--refresh]
                                  원본(~/.claude/projects)의 세션을 보관함에 같은 구조로 복사(시각 보존·SHA-256 대조, 있으면 건너뜀)
                                  딸린 claude -p 자식 세션·백그라운드 출력(_tasks/)도 함께. --refresh: 있는 메인은 두고 빠진 자식·출력만(ID 없으면 전체)
ccviz archive list [--dir <보관함>] [--json]   보관된 세션 목록(시작 KST · 시간 · 도구 · 서브 · 사유)
보관함 폴더: --dir > 환경변수 CCVIZ_ARCHIVE > config.json archiveDir`,

  'server.reqError': '요청 처리 오류',
  'server.bindWarn': '경고: 127.0.0.1 이외 주소로 바인드합니다:',
  'server.error': '서버 오류:',
  'server.configCreated': '설정 파일을 만들거나 빠진 토큰을 채웠습니다: {file}',
  'server.indexDone': '세션 색인 완료 ({sec}s)',
  'server.indexFail': '세션 색인 실패:',
  'server.uncaught': '처리되지 않은 예외:',
  'server.unhandled': '처리되지 않은 거부:',
  'server.startFail': '기동 실패:',
  'server.configRead': '설정 파일을 읽지 못했습니다: {file}: {msg}',
  'server.acquireFail': 'acquire 실패',
  'server.dupNode': '노드 id 중복 — 먼저 붙은 쪽만 내보냄',
  'server.usageFail': 'limits usage 실패',
  'server.replayMismatch': 'replay 최종 상태 불일치',
};

export const CLI_DICT = { en, ko };

/** 문구 찾기: t('srv.reuse', { pid, port }). 지금 언어에 없으면 en, 그래도 없으면 키 그대로 */
export function t(key, vars = {}, lang = cliLang()) {
  const v = CLI_DICT[lang]?.[key] ?? CLI_DICT.en[key];
  if (v == null) return key;
  if (typeof v === 'function') return v(vars || {});
  return String(v).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
}

/** 남은 시간: ko '3시간 8분'·'4일', en '3h 8m'·'4d' (bin/statusline.mjs fmtRemain 과 같은 규칙, ccviz status 용) */
export function remainText(sec, lang = cliLang()) {
  const K = lang === 'ko';
  if (!Number.isFinite(sec) || sec <= 0) return t('lim.reset', {}, lang);
  const m = Math.floor(sec / 60);
  if (m < 60) return K ? `${Math.max(1, m)}분` : `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return K ? `${h}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
  const d = Math.floor(h / 24);
  return K ? `${d}일${d < 2 && h % 24 ? ` ${h % 24}시간` : ''}` : `${d}d${d < 2 && h % 24 ? ` ${h % 24}h` : ''}`;
}
