#!/usr/bin/env node
// Agent4D 런처 — 명령 이름 agent4d(bin/agent4d.mjs), ccviz 는 별칭
//   start [--tunnel|--no-tunnel] [--limits|--no-limits] [--port N] [--project X] [--session ID] [--wait S] [--watch]
//                                                  서버(기본 127.0.0.1 전용). --tunnel 또는 config remote(또는 workerUrl)일 때만
//                                                  cloudflared quick tunnel + Worker 등록, 고정 링크 출력
//                                                  --watch: 끊기면 다시 띄우고 재등록하는 감시 프로세스도 함께 띄움
//   watch [--interval S]                           (전경) 감시 루프. 보통 start --watch 가 뒤에서 띄운다
//   stop                                           state 의 감시·서버·릴레이·cloudflared 종료
//   status                                         프로세스·터널·Worker 상태
//   link | url [--session ID]                      고정 링크 출력
//   autostart on|off|status                        (Windows) 로그온 시 start --watch 예약 작업
//   deploy                                         Worker·KV·시크릿 배포(cf CLI, 재실행 안전)
//   rotate-token                                   viewToken 재발급 + Worker 시크릿 갱신
//   help | --help                                  도움말(사전 server/cli-i18n.mjs 'help')
// 콘솔 문구는 server/cli-i18n.mjs t() — 영어 기본, 한국어 로케일이면 한국어. --lang en|ko 는 CCVIZ_LANG 으로 옮겨 자식 프로세스도 같은 언어
//
// 비밀·상태는 ~/.cc-agent-viz/ (예전 ~/.cc-session-viz/ 가 있으면 그것, CCVIZ_HOME 으로 바꿀 수 있음). 토큰은 콘솔에만 출력하고 로그 파일에 남기지 않는다.
// 의존성 없음(Node 내장 모듈만).

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installStatusline, uninstallStatusline, statuslineInfo } from "./statusline.mjs";
import { redact } from "../server/redact.mjs";
import { wantRemote } from "../server/config.mjs";
import { ccvizHome } from "../server/home.mjs";
import { t, remainText, langFlag, stripLangFlag, normCliLang } from "../server/cli-i18n.mjs";
import { readVersion } from "../server/version.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CF_DIR = path.join(ROOT, "cloudflare");
const HOME_DIR = ccvizHome();
const CONFIG_PATH = path.join(HOME_DIR, "config.json");
const STATE_PATH = path.join(HOME_DIR, "state.json");
const LOG_DIR = path.join(HOME_DIR, "logs");
const IS_WIN = process.platform === "win32";
const SERVER_ENTRY = process.env.CCVIZ_SERVER_ENTRY || path.join(ROOT, "server", "index.mjs");
const TUNNEL_RE = /https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/;
const ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

const DEFAULTS = {
  port: 7788,
  workerName: "cc-agent-viz",
  // 공유 레포 기본값은 비워 둔다(특정 계정 subdomain 을 가리키지 않게). 첫 `ccviz deploy` 가 배포 출력에서 이 계정 주소를 채운다
  workerUrl: null,
  kvNamespaceId: null,
  cloudflaredPath: IS_WIN ? "C:/Program Files (x86)/cloudflared/cloudflared.exe" : "cloudflared",
  privacy: "summary",
  project: null,
  // 회사·학교 망은 UDP(QUIC 7844)를 막는 경우가 많아 http2 를 기본으로 (QUIC 은 실패하기 쉬움)
  tunnelProtocol: "http2",
};

// ───────────────────────── 공통 유틸 ─────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newSecret = () => crypto.randomBytes(32).toString("base64url");
const log = (...a) => console.log(...a);
const warn = (...a) => console.error(...a);

function restrictFile(file) {
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
  if (IS_WIN) {
    // 상속 권한 제거, 현재 사용자만 전체 권한
    const user = process.env.USERNAME;
    if (user) spawnSync("icacls", [file, "/inheritance:r", "/grant:r", `${user}:F`], { stdio: "ignore", windowsHide: true });
  }
}

function ensureHome() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonSecure(file, obj) {
  const tmp = file + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
  restrictFile(file); // rename 은 상속 ACL 을 가져오므로 매번 다시 제한
}

/** config.json 을 읽고, 없거나 빠진 값은 채워 저장한다(기존 값 유지). */
function loadConfig() {
  ensureHome();
  const cur = readJson(CONFIG_PATH) || {};
  const cfg = { ...DEFAULTS, ...cur };
  let changed = !fs.existsSync(CONFIG_PATH);
  if (!cfg.viewToken) (cfg.viewToken = newSecret()), (changed = true);
  if (!cfg.adminSecret) (cfg.adminSecret = newSecret()), (changed = true);
  for (const k of Object.keys(DEFAULTS)) if (!(k in cur)) changed = true;
  if (changed) {
    // 다른 프로세스(서버)가 그 사이에 만들었을 수 있으니 한 번 더 병합
    const again = readJson(CONFIG_PATH) || {};
    const merged = { ...cfg, ...again, viewToken: again.viewToken || cfg.viewToken, adminSecret: again.adminSecret || cfg.adminSecret };
    for (const k of Object.keys(DEFAULTS)) if (merged[k] === undefined) merged[k] = DEFAULTS[k];
    writeJsonSecure(CONFIG_PATH, merged);
    return merged;
  }
  restrictFile(CONFIG_PATH); // 서버가 먼저 만든 파일일 수 있으므로 권한을 다시 제한
  return cfg;
}

function saveConfig(cfg) {
  writeJsonSecure(CONFIG_PATH, cfg);
}

function loadState() {
  return readJson(STATE_PATH) || {};
}
function saveState(st) {
  writeJsonSecure(STATE_PATH, st);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** Windows: tasklist 를 한 번만 불러 PID→이름 표를 만든다(부하가 크면 tasklist 1회가 ～10초라 PID 마다 부르지 않음). 2초 캐시. */
let procCache = null;
function procTable() {
  if (procCache && Date.now() - procCache.at < 2000) return procCache.map;
  const map = new Map();
  const r = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  for (const line of (r.stdout || "").split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (m) map.set(Number(m[2]), m[1].toLowerCase());
  }
  procCache = { map, at: Date.now() };
  return map;
}
function invalidateProcs() {
  procCache = null;
}

/** PID 의 실행 파일 이름(소문자). PID 재사용으로 남의 프로세스를 죽이지 않기 위함. */
function procName(pid) {
  if (!isAlive(pid)) return null;
  if (IS_WIN) return procTable().get(Number(pid)) || null;
  const r = spawnSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" });
  return (r.stdout || "").trim().toLowerCase() || null;
}

function ownedAlive(pid, expect) {
  const n = procName(pid);
  return !!n && n.includes(expect);
}

function killTree(pid) {
  invalidateProcs();
  if (!isAlive(pid)) return;
  if (IS_WIN) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  }
}

async function httpStatus(url, { timeout = 5000, headers } = {}) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout), headers, redirect: "manual" });
    await r.body?.cancel().catch(() => {});
    return r.status;
  } catch {
    return null;
  }
}

async function httpJson(url, { timeout = 8000, method = "GET", headers = {}, body } = {}) {
  try {
    const r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeout) });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: r.status, json, text };
  } catch (e) {
    return { status: null, json: null, text: String(e?.cause?.code || e?.message || e) };
  }
}

async function waitFor(fn, { timeoutMs, intervalMs = 1000 }) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(intervalMs);
  }
}

// ───────────────────────── cf CLI 실행 ─────────────────────────
function cfCommand() {
  const local = path.join(CF_DIR, "node_modules", "cf", "bin", "cf");
  if (fs.existsSync(local)) return { cmd: process.execPath, pre: [local] };
  if (IS_WIN && process.env.APPDATA) {
    const glob = path.join(process.env.APPDATA, "npm", "node_modules", "cf", "bin", "cf");
    if (fs.existsSync(glob)) return { cmd: process.execPath, pre: [glob] };
  }
  return { cmd: "cf", pre: [] };
}

/** cf 실행. cwd 기본값은 HOME_DIR(레포의 cloudflare.config.ts 를 읽지 않도록). 비밀은 인자로 넘기지 않는다. */
function runCf(args, { cwd = HOME_DIR, env = {}, inherit = false } = {}) {
  const { cmd, pre } = cfCommand();
  const r = spawnSync(cmd, [...pre, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    windowsHide: true,
    stdio: inherit ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "", error: r.error };
}

function parseJsonLoose(s) {
  try {
    return JSON.parse(s);
  } catch {}
  const i = s.search(/[[{]/);
  if (i >= 0) {
    try {
      return JSON.parse(s.slice(i));
    } catch {}
  }
  return null;
}

// ───────────────────────── 링크 ─────────────────────────
/** session 을 주면 링크가 그 세션을 바로 연다(auto 모드가 다른 프로젝트의 live 세션에 머무는 문제 방지). */
function sessionQs(session) {
  return session && session !== "auto" ? `&session=${encodeURIComponent(session)}` : "";
}
function fixedLink(cfg, session = cfg.linkSession) {
  if (!cfg.workerUrl) return t("link.none");
  return `${cfg.workerUrl.replace(/\/+$/, "")}/?t=${encodeURIComponent(cfg.viewToken)}${sessionQs(session)}`;
}
function localLink(cfg, port, session = cfg.linkSession) {
  return `http://127.0.0.1:${port}/?t=${encodeURIComponent(cfg.viewToken)}${sessionQs(session)}`;
}

// ───────────────────────── start ─────────────────────────
function startWaitMs(opts, cfg) {
  const v = Number(opts.wait ?? process.env.CCVIZ_START_TIMEOUT ?? cfg.startTimeoutSec ?? 60);
  return (Number.isFinite(v) && v > 0 ? v : 60) * 1000;
}

async function startServer(cfg, st, port, project, waitMs = 60000) {
  if (st.serverPid && ownedAlive(st.serverPid, "node") && st.port === port) {
    const s = await httpStatus(`http://127.0.0.1:${port}/healthz`);
    if (s === 200) {
      log(t("srv.reuse", { pid: st.serverPid, port }));
      return st.serverPid;
    }
  }
  if (st.serverPid && ownedAlive(st.serverPid, "node")) {
    // 우리 서버가 살아 있지만 응답하지 않음(멈춤) → 내리고 새로 띄운다(포트 충돌 방지)
    log(t("srv.killHung", { pid: st.serverPid }));
    killTree(st.serverPid);
    await sleep(500);
  }
  if (await httpStatus(`http://127.0.0.1:${port}/healthz`, { timeout: 1500 })) {
    throw new Error(t("srv.portBusy", { port }));
  }
  if (!fs.existsSync(SERVER_ENTRY)) throw new Error(t("srv.noEntry", { file: SERVER_ENTRY }));
  const out = fs.openSync(path.join(LOG_DIR, "server.log"), "a");
  const args = [SERVER_ENTRY, "--port", String(port), "--host", "127.0.0.1", "--config", CONFIG_PATH];
  if (project) args.push("--project", project);
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: { ...process.env, CCVIZ_LAUNCHED: "1" },
  });
  child.unref();
  fs.closeSync(out);
  log(t("srv.started", { pid: child.pid, port }));
  const ok = await waitFor(async () => (await httpStatus(`http://127.0.0.1:${port}/healthz`, { timeout: 3000 })) === 200, {
    timeoutMs: waitMs,
    intervalMs: 500,
  });
  if (!ok) {
    killTree(child.pid);
    throw new Error(t("srv.timeout", { sec: Math.round(waitMs / 1000), log: path.join(LOG_DIR, "server.log") }));
  }
  return child.pid;
}

/** cloudflared 와 서버 사이 SSE gzip 릴레이(bin/relay.mjs). 이유는 relay.mjs 머리말 참조. */
async function startRelay(st, port, relayPort) {
  const probe = () => httpStatus(`http://127.0.0.1:${relayPort}/healthz`, { timeout: 1500 });
  if (st.relayPid && ownedAlive(st.relayPid, "node") && st.relayPort === relayPort && st.port === port) {
    if ((await probe()) === 200) {
      log(t("relay.reuse", { pid: st.relayPid, port: relayPort }));
      return st.relayPid;
    }
    killTree(st.relayPid);
  }
  if (await probe()) throw new Error(t("relay.portBusy", { port: relayPort }));
  const out = fs.openSync(path.join(LOG_DIR, "relay.log"), "a");
  const child = spawn(process.execPath, [path.join(__dirname, "relay.mjs"), "--listen", String(relayPort), "--target", String(port)], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(out);
  const ok = await waitFor(async () => (await probe()) === 200, { timeoutMs: 10000, intervalMs: 300 });
  if (!ok) {
    killTree(child.pid);
    throw new Error(t("relay.noResponse", { log: path.join(LOG_DIR, "relay.log") }));
  }
  log(t("relay.started", { pid: child.pid, port: relayPort, target: port }));
  return child.pid;
}

async function startTunnel(cfg, st, port) {
  if (st.cloudflaredPid && ownedAlive(st.cloudflaredPid, "cloudflared") && st.tunnelUrl && st.relayPort === port) {
    const s = await httpStatus(`${st.tunnelUrl}/healthz`, { timeout: 6000 });
    if (s === 200) {
      log(t("tun.reuse", { pid: st.cloudflaredPid }));
      return { pid: st.cloudflaredPid, url: st.tunnelUrl };
    }
    killTree(st.cloudflaredPid);
  }
  const exe = cfg.cloudflaredPath || DEFAULTS.cloudflaredPath;
  if (IS_WIN && !fs.existsSync(exe)) throw new Error(t("tun.noExe", { exe }));
  const logFile = path.join(LOG_DIR, "cloudflared.log");
  const out = fs.openSync(logFile, "w"); // 이전 실행의 주소가 섞이지 않도록 비움
  const child = spawn(exe, ["tunnel", "--no-autoupdate", "--protocol", cfg.tunnelProtocol || "http2", "--url", `http://127.0.0.1:${port}`], {
    cwd: HOME_DIR,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(out);
  log(t("tun.started", { pid: child.pid }));
  const url = await waitFor(
    () => {
      try {
        const m = TUNNEL_RE.exec(fs.readFileSync(logFile, "utf8"));
        return m ? m[0] : null;
      } catch {
        return null;
      }
    },
    { timeoutMs: 30000, intervalMs: 500 },
  );
  if (!url) {
    killTree(child.pid);
    throw new Error(t("tun.noUrl", { log: logFile }));
  }
  log(t("tun.gotUrl"));
  const reach = await waitFor(async () => (await httpStatus(`${url}/healthz`, { timeout: 5000 })) === 200, {
    timeoutMs: 30000,
    intervalMs: 2000,
  });
  if (!reach) log(t("tun.unreachable"));
  return { pid: child.pid, url };
}

async function register(cfg, origin) {
  if (!ORIGIN_RE.test(origin)) throw new Error(t("reg.badOrigin"));
  const host = os.hostname();
  const r = await httpJson(`${cfg.workerUrl}/_register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.adminSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ origin, host }),
    timeout: 15000,
  });
  if (r.status === 200 && r.json?.ok) return { via: "worker", updatedAt: r.json.updatedAt };
  warn(t("reg.workerFail", { why: r.status ?? r.text }));
  if (!cfg.kvNamespaceId) throw new Error(t("reg.noKv"));
  const updatedAt = new Date().toISOString();
  const value = JSON.stringify({ url: origin, updatedAt, host });
  const k = runCf(["kv", "keys", "put", "origin", "--namespace-id", cfg.kvNamespaceId, "--body", value]);
  if (k.code !== 0) throw new Error(t("reg.kvFail", { msg: (k.stderr || k.stdout).slice(0, 300) }));
  return { via: "kv", updatedAt };
}

async function verifyFixed(cfg, updatedAt) {
  log(t("reg.verifying"));
  let last = null;
  const ok = await waitFor(
    async () => {
      const r = await httpJson(`${cfg.workerUrl}/_health`, { timeout: 10000 });
      last = r;
      return r.json && r.json.upstream === 200 && (!updatedAt || r.json.updatedAt === updatedAt);
    },
    { timeoutMs: 90000, intervalMs: 3000 },
  );
  return { ok: !!ok, last };
}

async function cmdStart(opts) {
  const cfg = loadConfig();
  if (typeof opts.session === "string") {
    // 링크에 넣을 세션을 기억해 두어 ccviz url 도 같은 링크를 낸다("auto" 로 되돌릴 수 있음)
    cfg.linkSession = opts.session === "auto" ? null : opts.session;
    saveConfig(cfg);
  }
  if (opts.limits === true || opts["no-limits"] === true) {
    // 한도 수집기는 옵트인: --limits 로 켜면 config.limits.source = oauth 로 기억(--no-limits 는 off)
    const source = opts["no-limits"] === true ? "off" : "oauth";
    const cur = cfg.limits && typeof cfg.limits === "object" ? cfg.limits : {};
    if (cur.source !== source) {
      cfg.limits = { ...cur, source };
      saveConfig(cfg);
      log(t("start.limits", { state: t(source === "off" ? "start.off" : "start.on"), source }));
    }
  }
  const remote = wantRemote(opts, cfg);
  const st = loadState();
  const port = Number(opts.port || cfg.port || 7788);
  const project = typeof opts.project === "string" ? opts.project : cfg.project;
  const serverPid = await startServer(cfg, st, port, project, startWaitMs(opts, cfg));
  const next = { ...st, serverPid, port, mode: remote ? "remote" : "local", startedAt: st.serverPid === serverPid ? st.startedAt : new Date().toISOString() };
  saveState(next);

  if (!remote) {
    if (next.cloudflaredPid && ownedAlive(next.cloudflaredPid, "cloudflared")) killTree(next.cloudflaredPid);
    if (next.relayPid && ownedAlive(next.relayPid, "node")) killTree(next.relayPid);
    delete next.cloudflaredPid;
    delete next.relayPid;
    delete next.relayPort;
    delete next.tunnelUrl;
    delete next.registeredAt;
    saveState(next);
    if (opts.watch && !opts._inWatch) spawnWatcher(port);
    if (opts._inWatch) return true;
    log(t("link.localHead"));
    log("  " + localLink(cfg, port));
    if (!opts["no-tunnel"]) log(t("link.tunnelHint"));
    return true;
  }

  let tunnel;
  try {
    const relayPort = Number(cfg.relayPort || port + 1);
    next.relayPid = await startRelay(next, port, relayPort);
    saveState(next);
    tunnel = await startTunnel(cfg, next, relayPort);
    next.relayPort = relayPort;
  } catch (e) {
    warn(t("tun.failed", { msg: e.message }));
    log(t("link.localHeadInline", { url: localLink(cfg, port) }));
    process.exitCode = 1;
    return false;
  }
  next.cloudflaredPid = tunnel.pid;
  next.tunnelUrl = tunnel.url;
  saveState(next);

  if (!cfg.workerUrl) {
    warn(t("reg.noWorker"));
    if (opts.watch && !opts._inWatch) spawnWatcher(port);
    if (opts._inWatch) return true;
    log(t("link.tempHead"));
    log(`  ${tunnel.url}/?t=${encodeURIComponent(cfg.viewToken)}${sessionQs(cfg.linkSession)}`);
    log(t("link.local"));
    log("  " + localLink(cfg, port));
    return true;
  }

  let reg;
  try {
    reg = await register(cfg, tunnel.url);
  } catch (e) {
    warn(t("reg.failed", { msg: e.message }));
    process.exitCode = 1;
    return false;
  }
  next.registeredAt = reg.updatedAt;
  saveState(next);
  log(t("reg.done", { via: reg.via === "worker" ? "Worker /_register" : "cf kv keys put" }));

  const v = await verifyFixed(cfg, reg.updatedAt);
  if (!v.ok) {
    warn(t("reg.verifyTimeout", { status: v.last?.status ?? "-", body: JSON.stringify(v.last?.json ?? v.last?.text ?? "") }));
    warn(t("reg.verifySlow"));
  } else log(t("reg.fixedOk"));

  if (opts.watch && !opts._inWatch) spawnWatcher(port);
  if (opts._inWatch) return v.ok; // 감시 로그(watch.log)에 토큰이 든 링크를 남기지 않는다

  log(t("link.fixedHead"));
  log("  " + fixedLink(cfg));
  log(t("link.local"));
  log("  " + localLink(cfg, port));
  return v.ok;
}

// ───────────────────────── watch (끊김 감시·자동 복구) ─────────────────────────
/** 감시 프로세스를 뒤에서 띄운다. 이미 살아 있으면 재사용. */
function spawnWatcher(port) {
  const st = loadState();
  if (st.watchPid && ownedAlive(st.watchPid, "node")) {
    log(t("watch.reuse", { pid: st.watchPid }));
    return st.watchPid;
  }
  const out = fs.openSync(path.join(LOG_DIR, "watch.log"), "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "watch", "--port", String(port)], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(out);
  saveState({ ...loadState(), watchPid: child.pid });
  log(t("watch.started", { pid: child.pid, log: path.join(LOG_DIR, "watch.log") }));
  return child.pid;
}

/** 한 번 점검: 무엇이 죽었는지 목록을 돌려준다(빈 배열이면 정상). */
async function healthCheck(cfg, st) {
  const bad = [];
  const port = st.port || cfg.port;
  if ((await httpStatus(`http://127.0.0.1:${port}/healthz`, { timeout: 8000 })) !== 200) bad.push("server");
  if (st.mode === "local") return bad; // 로컬 전용 기동이면 서버만 본다
  if (st.relayPort && (await httpStatus(`http://127.0.0.1:${st.relayPort}/healthz`, { timeout: 8000 })) !== 200) bad.push("relay");
  if (!st.tunnelUrl || (await httpStatus(`${st.tunnelUrl}/healthz`, { timeout: 12000 })) !== 200) bad.push("tunnel");
  const h = cfg.workerUrl ? await httpJson(`${cfg.workerUrl}/_health`, { timeout: 15000 }) : {};
  if (h.json) {
    if (h.json.upstream !== 200) bad.push("worker-upstream");
    else if (st.registeredAt && h.json.updatedAt !== st.registeredAt) bad.push("worker-registration");
  } // Worker 자체가 응답이 없으면(이 PC 네트워크 문제일 수 있음) 그것만으로는 재기동하지 않는다
  return bad;
}

async function cmdWatch(opts) {
  const interval = Math.max(10, Number(opts.interval || 45)) * 1000;
  const stamp = () => new Date().toISOString();
  {
    const st = loadState();
    if (st.watchPid && st.watchPid !== process.pid && ownedAlive(st.watchPid, "node")) {
      log(t("watch.other", { ts: stamp(), pid: st.watchPid }));
      return;
    }
    saveState({ ...st, watchPid: process.pid });
  }
  log(t("watch.begin", { ts: stamp(), pid: process.pid, sec: interval / 1000 }));
  let fails = 0;
  let backoff = 0;
  for (;;) {
    await sleep(interval + backoff);
    const st = loadState();
    if (st.watchPid !== process.pid) {
      log(t("watch.released", { ts: stamp() }));
      return;
    }
    const cfg = loadConfig();
    let bad;
    try {
      bad = await healthCheck(cfg, st);
    } catch (e) {
      bad = ["check-error:" + (e?.message || e)];
    }
    if (!bad.length) {
      if (fails) log(t("watch.recovered", { ts: stamp() }));
      fails = 0;
      backoff = 0;
      continue;
    }
    fails++;
    log(t("watch.anomaly", { ts: stamp(), n: fails, bad: bad.join(", ") }));
    if (fails < 2) continue; // 일시적 끊김은 한 번 더 지켜본다
    log(t("watch.tryRecover", { ts: stamp() }));
    try {
      const ok = await cmdStart({ port: st.port, _inWatch: true, ...(st.mode === "local" ? { "no-tunnel": true } : { tunnel: true }) });
      process.exitCode = 0;
      log(t("watch.recoverResult", { ts: stamp(), result: t(ok ? "watch.recoverDone" : "watch.recoverPending") }));
      if (ok) (fails = 0), (backoff = 0);
      else backoff = Math.min(backoff + 60_000, 300_000);
    } catch (e) {
      log(t("watch.recoverFailed", { ts: stamp(), msg: e?.message || e }));
      backoff = Math.min(backoff + 60_000, 300_000);
    }
  }
}

// ───────────────────────── autostart (Windows 작업 스케줄러) ─────────────────────────
const TASK_NAME = "cc-agent-viz";
const LEGACY_TASK_NAME = "cc-session-viz"; // 예전 이름으로 만든 예약 작업도 끄기·상태에서 함께 본다
function cmdAutostart(opts) {
  const sub = opts._[1] || "status";
  if (!IS_WIN) {
    warn(t("auto.winOnly"));
    process.exitCode = 2;
    return;
  }
  if (sub === "on") {
    const tr = `"${process.execPath}" "${fileURLToPath(import.meta.url)}" start --watch`;
    const r = spawnSync("schtasks", ["/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/DELAY", "0001:00", "/TN", TASK_NAME, "/TR", tr], { encoding: "utf8", windowsHide: true });
    log((r.stdout || r.stderr || "").trim());
    process.exitCode = r.status || 0;
  } else if (sub === "off") {
    const r = spawnSync("schtasks", ["/Delete", "/F", "/TN", TASK_NAME], { encoding: "utf8", windowsHide: true });
    const old = spawnSync("schtasks", ["/Delete", "/F", "/TN", LEGACY_TASK_NAME], { encoding: "utf8", windowsHide: true });
    log(((old.status === 0 ? old.stdout : r.stdout || r.stderr) || "").trim());
    process.exitCode = r.status === 0 || old.status === 0 ? 0 : r.status || 0;
  } else {
    const q = (n) => spawnSync("schtasks", ["/Query", "/TN", n], { encoding: "utf8", windowsHide: true }).status === 0;
    log(t(q(TASK_NAME) || q(LEGACY_TASK_NAME) ? "auto.on" : "auto.off"));
  }
}

// ───────────────────────── stop / status / link ─────────────────────────
async function cmdStop() {
  const st = loadState();
  let n = 0;
  // 감시를 먼저 내린다(아니면 방금 끈 것을 다시 띄움)
  if (st.watchPid && st.watchPid !== process.pid && ownedAlive(st.watchPid, "node")) killTree(st.watchPid), n++;
  if (st.cloudflaredPid && ownedAlive(st.cloudflaredPid, "cloudflared")) killTree(st.cloudflaredPid), n++;
  if (st.relayPid && ownedAlive(st.relayPid, "node")) killTree(st.relayPid), n++;
  if (st.serverPid && ownedAlive(st.serverPid, "node")) killTree(st.serverPid), n++;
  saveState({ stoppedAt: new Date().toISOString() });
  log(n ? t("stop.done", { n }) : t("stop.none"));
}

async function cmdStatus() {
  const cfg = loadConfig();
  const st = loadState();
  const port = st.port || cfg.port;
  const serverUp = st.serverPid ? ownedAlive(st.serverPid, "node") : false;
  const tunUp = st.cloudflaredPid ? ownedAlive(st.cloudflaredPid, "cloudflared") : false;
  const relayUp = st.relayPid ? ownedAlive(st.relayPid, "node") : false;
  const local = await httpStatus(`http://127.0.0.1:${port}/healthz`, { timeout: 2000 });
  const sv = local === 200 ? (await httpJson(`http://127.0.0.1:${port}/healthz`, { timeout: 2000 })).json : null; // 버전
  log(`agent4d v${readVersion()}${sv && sv.version && sv.version !== readVersion() ? ` (server v${sv.version})` : ""}`);
  const tun = st.tunnelUrl ? await httpStatus(`${st.tunnelUrl}/healthz`, { timeout: 6000 }) : null;
  const h = cfg.workerUrl ? await httpJson(`${cfg.workerUrl}/_health`, { timeout: 10000 }) : { text: t("st.notDeployed") };
  const off = t("st.off");
  const noResp = t("st.noResponse");
  log(t("st.server", { state: serverUp ? t("st.running", { pid: st.serverPid }) : off, port, code: local ?? noResp }));
  log(t("st.relay", { state: relayUp ? t("st.runningPort", { pid: st.relayPid, port: st.relayPort }) : off }));
  log(t("st.tunnel", { state: tunUp ? t("st.running", { pid: st.cloudflaredPid }) : off, extra: st.tunnelUrl ? ` · ${st.tunnelUrl} → ${tun ?? noResp}` : "" }));
  log(t("st.worker", { url: cfg.workerUrl || "-", code: h.status ?? h.text, json: h.json ? JSON.stringify(h.json) : "" }));
  const match = h.json && st.registeredAt && h.json.updatedAt === st.registeredAt;
  log(t("st.match", { yes: t(match ? "st.yes" : "st.no"), extra: st.registeredAt ? t("st.matchAt", { at: st.registeredAt }) : "" }));
  log(t("st.watch", { state: st.watchPid && ownedAlive(st.watchPid, "node") ? t("st.running", { pid: st.watchPid }) : t("st.watchOff") }));
  log(t("st.linkSession", { s: cfg.linkSession || "auto" }));
  log(t("st.kv", { state: t(cfg.kvNamespaceId ? "st.kvSet" : "st.kvNone") }));
  log(t("st.limits", { line: await limitsLine(cfg, local === 200 ? port : null) }));
}

// ───────────────────────── 사용 한도 (3차) ─────────────────────────
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

function fmtWin(label, pct, resetsAtMs) {
  if (pct == null) return null;
  const left = Number.isFinite(resetsAtMs) ? (resetsAtMs - Date.now()) / 1000 : NaN;
  return `${label} ${Math.round(pct * 10) / 10}%${Number.isFinite(left) ? ` (${remainText(left)})` : ""}`;
}
const ageText = (sec) => (sec == null ? "" : sec < 60 ? t("lim.just") : sec < 3600 ? t("lim.minAgo", { n: Math.floor(sec / 60) }) : t("lim.hourAgo", { n: Math.floor(sec / 3600) }));
const errKind = (e) => `${e.kind}${e.status ? " " + e.status : ""}`;

/** 한 줄 요약: 서버가 떠 있으면 /limits(값만), 아니면 ratelimits.json */
async function limitsLine(cfg, port) {
  if (port) {
    const r = await httpJson(`http://127.0.0.1:${port}/limits`, { timeout: 4000, headers: { "X-CCVIZ-Token": cfg.viewToken } });
    const L = r.json;
    if (L && L.disabled) return t("lim.disabled");
    if (L && (L.five_hour || L.seven_day)) {
      const parts = [fmtWin("5h", L.five_hour?.pct, Date.parse(L.five_hour?.resetsAt)), fmtWin("7d", L.seven_day?.pct, Date.parse(L.seven_day?.resetsAt))].filter(Boolean);
      return t("lim.line", {
        parts: parts.join(" · "),
        src: t(L.source === "oauth" ? "lim.srcOauth" : "lim.srcStatusline"),
        age: ageText(L.ageSec),
        stale: L.stale ? t("lim.stale") : "",
        err: L.error ? t("lim.lastFail", { kind: errKind(L.error) }) : "",
      });
    }
    if (L) return L.error ? t("lim.noValueErr", { kind: errKind(L.error), msg: L.error.message || "" }) : t("lim.noValue");
  }
  // 서버가 꺼져 있으면 독립 수집기 캐시 파일(값만, HTTP 없음)
  const uc = readJson(path.join(HOME_DIR, "usage-cache.json"));
  if (uc && uc.v === 1 && uc.value && (uc.value.five_hour || uc.value.seven_day)) {
    const v = uc.value;
    const sec = Math.max(0, Math.round((Date.now() - Date.parse(v.capturedAt)) / 1000));
    const parts = [fmtWin("5h", v.five_hour?.pct, Date.parse(v.five_hour?.resetsAt)), fmtWin("7d", v.seven_day?.pct, Date.parse(v.seven_day?.resetsAt))].filter(Boolean);
    return t("lim.cacheLine", { parts: parts.join(" · "), age: ageText(sec) });
  }
  const info = statuslineInfo({ home: HOME_DIR, claudeDir: CLAUDE_DIR });
  const rl = info.ratelimits;
  if (!rl) return t("lim.noValueSl", { state: t(info.installed ? "sl.installed" : "sl.notInstalled") });
  const parts = [fmtWin("5h", rl.five_hour?.used_percentage, rl.five_hour ? rl.five_hour.resets_at * 1000 : NaN), fmtWin("7d", rl.seven_day?.used_percentage, rl.seven_day ? rl.seven_day.resets_at * 1000 : NaN)].filter(Boolean);
  return t("lim.slLine", { parts: parts.join(" · "), age: ageText(rl.ageSec) });
}

async function cmdStatusline(opts) {
  const sub = opts._[1];
  const home = HOME_DIR;
  if (sub === "install") {
    const mode = typeof opts.mode === "string" ? opts.mode : null;
    if (mode && mode !== "limits" && mode !== "blank") { warn(t("sl.badMode")); process.exitCode = 2; return; }
    warn(t("sl.deprecated"));
    const r = installStatusline({ home, claudeDir: CLAUDE_DIR, mode, yes: !!opts.yes, src: path.join(__dirname, "statusline.mjs"), t });
    for (const m of r.messages) (r.ok ? log : warn)(m);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  if (sub === "uninstall") {
    const r = uninstallStatusline({ home, claudeDir: CLAUDE_DIR, t });
    for (const m of r.messages) (r.ok ? log : warn)(m);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  if (sub === "status" || !sub) {
    const info = statuslineInfo({ home, claudeDir: CLAUDE_DIR });
    const cfgLimits = (readJson(CONFIG_PATH) || {}).limits || {};
    log(t("sl.status", {
      state: t(info.installed ? "sl.installed" : "sl.notInstalled"),
      mode: info.mode ? ` (mode ${info.mode})` : "",
      at: info.installedAt ? ` · ${info.installedAt}` : "",
      warn: info.installed && !info.wrapperExists ? t("sl.noWrapper") : "",
    }));
    log(t("sl.prev", { cmd: info.prevCommand ? redact(info.prevCommand) : t("sl.none") }));
    const rl = info.ratelimits;
    if (rl) {
      const parts = [fmtWin("5h", rl.five_hour?.used_percentage, rl.five_hour ? rl.five_hour.resets_at * 1000 : NaN), fmtWin("7d", rl.seven_day?.used_percentage, rl.seven_day ? rl.seven_day.resets_at * 1000 : NaN)].filter(Boolean);
      log(t("sl.recorded", { parts: parts.join(" · ") || t("sl.none"), age: ageText(rl.ageSec) }));
    } else log(t("sl.recordedNone"));
    log(t("sl.source", { src: cfgLimits.source || t("sl.srcDefault"), note: ["auto", "statusline"].includes(cfgLimits.source) ? t("sl.srcNote") : "" }));
    return;
  }
  warn(t("sl.usage"));
  process.exitCode = 2;
}

function cmdLink(opts = {}) {
  const cfg = loadConfig();
  log(fixedLink(cfg, typeof opts.session === "string" ? opts.session : cfg.linkSession));
}

// ───────────────────────── deploy / rotate-token ─────────────────────────
function ensureCfDeps() {
  if (fs.existsSync(path.join(CF_DIR, "node_modules", "cf")) && fs.existsSync(path.join(CF_DIR, "node_modules", "@cloudflare", "vite-plugin"))) return;
  const ci = fs.existsSync(path.join(CF_DIR, "package-lock.json")) ? "ci" : "install";
  log(t("dep.npm", { ci }));
  const r = spawnSync(IS_WIN ? "npm.cmd" : "npm", [ci, "--no-audit", "--no-fund"], { cwd: CF_DIR, stdio: "inherit", shell: IS_WIN, windowsHide: true });
  if (r.status !== 0) throw new Error(t("dep.npmFail", { ci }));
}

function ensureKv(cfg) {
  const title = cfg.workerName;
  const r = runCf(["kv", "namespaces", "list", "--per-page", "100"]);
  const list = parseJsonLoose(r.stdout);
  if (!Array.isArray(list)) throw new Error(t("dep.kvListFail", { msg: (r.stderr || r.stdout).slice(0, 300) }));
  let ns = (cfg.kvNamespaceId && list.find((n) => n.id === cfg.kvNamespaceId)) || list.find((n) => n.title === title);
  if (!ns) {
    log(t("dep.kvCreate", { title }));
    const c = runCf(["kv", "namespaces", "create", "--title", title]);
    ns = parseJsonLoose(c.stdout);
    if (!ns?.id) throw new Error(t("dep.kvCreateFail", { msg: (c.stderr || c.stdout).slice(0, 300) }));
  } else log(t("dep.kvExists", { title: ns.title }));
  if (cfg.kvNamespaceId !== ns.id) {
    cfg.kvNamespaceId = ns.id;
    saveConfig(cfg);
  }
  return ns.id;
}

function deployWorker(cfg) {
  const secretsFile = path.join(HOME_DIR, `.deploy-secrets-${process.pid}.json`);
  fs.writeFileSync(secretsFile, JSON.stringify({ VIEW_TOKEN: cfg.viewToken, ADMIN_SECRET: cfg.adminSecret }), { mode: 0o600 });
  restrictFile(secretsFile);
  try {
    log(t("dep.cfDeploy", { name: cfg.workerName }));
    const r = runCf(["deploy", "--secrets-file", secretsFile], {
      cwd: CF_DIR,
      env: { CCVIZ_KV_ID: cfg.kvNamespaceId, CCVIZ_WORKER_NAME: cfg.workerName },
    });
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    if (r.code !== 0) throw new Error(t("dep.cfFail", { code: r.code }));
    // 이 계정의 workers.dev 주소를 배포 출력에서 읽어 config 에 반영(공유 레포 기본값이 남의 subdomain 을 가리키지 않도록)
    const esc = cfg.workerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`https://${esc}\\.[a-z0-9-]+\\.workers\\.dev`, "i").exec(r.stdout + "\n" + r.stderr);
    if (m && m[0] !== cfg.workerUrl) {
      log(t("dep.urlUpdated", { url: m[0] }));
      cfg.workerUrl = m[0];
      saveConfig(cfg);
    } else if (!m) log(t("dep.urlNotFound"));
  } finally {
    try {
      fs.rmSync(secretsFile, { force: true });
    } catch {}
  }
}

async function cmdDeploy() {
  const cfg = loadConfig();
  ensureCfDeps();
  ensureKv(cfg);
  deployWorker(cfg);
  if (!cfg.workerUrl) {
    warn(t("dep.noUrl"));
    process.exitCode = 1;
    return;
  }
  log(t("dep.checking"));
  const ok = await waitFor(async () => (await httpJson(`${cfg.workerUrl}/_health`, { timeout: 8000 })).json?.ok === true, {
    timeoutMs: 90000,
    intervalMs: 3000,
  });
  if (!ok) {
    warn(t("dep.notYet", { url: cfg.workerUrl }));
    process.exitCode = 1;
    return;
  }
  log(t("dep.done", { url: cfg.workerUrl }));
}

async function cmdRotate() {
  const cfg = loadConfig();
  cfg.viewToken = newSecret();
  saveConfig(cfg);
  log(t("rot.reissued"));
  if (!cfg.kvNamespaceId) {
    warn(t("rot.noKv"));
    return;
  }
  ensureCfDeps();
  deployWorker(cfg);
  log(t("rot.done"));
  log(t("rot.restart"));
  log(t("link.newFixed", { url: fixedLink(cfg) }));
}

// ───────────────────────── main ─────────────────────────
async function main() {
  // --lang en|ko: 어느 위치든 받아 CCVIZ_LANG 으로 옮긴다(이 프로세스의 t() 와 자식 프로세스 — 서버·감시·릴레이 — 가 같은 언어)
  const raw = process.argv.slice(2);
  const lf = langFlag(raw);
  if (lf != null) {
    const l = normCliLang(lf);
    if (!l) { warn(t("common.badLang")); process.exitCode = 2; return; }
    process.env.CCVIZ_LANG = l;
  }
  const argv = stripLangFlag(raw);
  const opts = parseArgs(argv);
  const cmd = opts._[0];
  if (cmd === "version" || opts.version || opts.v || argv.includes("-v") || argv.includes("--version")) { log(`agent4d v${readVersion()}`); return; }
  switch (cmd) {
    case "start":
      return cmdStart(opts);
    case "stop":
      return cmdStop();
    case "status":
      return cmdStatus();
    case "watch":
      return cmdWatch(opts);
    case "autostart":
      return cmdAutostart(opts);
    case "link":
    case "url":
      return cmdLink(opts);
    case "deploy":
      return cmdDeploy();
    case "rotate-token":
      return cmdRotate();
    case "limits": {
      const m = await import("./limits.mjs");
      process.exitCode = await m.main(argv.slice(1));
      return;
    }
    case "statusline":
      return cmdStatusline(opts);
    case "archive": {
      // 보관함 관리(add·list). add 만 보관함에 쓴다
      const m = await import("./archive.mjs");
      process.exitCode = await m.main(argv.slice(1));
      return;
    }
    default:
      log(t("help"));
      if (cmd && cmd !== "help" && cmd !== "--help" && cmd !== "-h") process.exitCode = 2;
  }
}

main().catch((e) => {
  warn(t("common.error", { msg: e?.message || e }));
  process.exitCode = 1;
});
