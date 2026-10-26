// `agent4d update` — 새 릴리스 확인(--check) · git 클론 fast-forward 갱신 · 복사한 스킬 갱신 · 서버 재시작.
//   update --check [--json] [--force]   GitHub latest release 와 package.json version 비교(24시간 캐시, 실패해도 종료 코드 0)
//   update [--yes]                      클론이면 깨끗한지·ff 가능한지 확인 → git pull --ff-only → 스킬 사본 갱신 → 서버 재시작
// 개발 클론(origin 이 package.json 저장소가 아님)·포크는 아무것도 바꾸지 않는다. 판정 로직은 server/update.mjs(순수, 시험 대상).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ccvizHome } from '../server/home.mjs';
import { t } from '../server/cli-i18n.mjs';
import {
  checkForUpdate, readPackage, repoSlugOf, releasesPage, isPublicClone, skillInstallKind, changedFiles, restartArgs, pullPlan,
} from '../server/update.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = (...a) => console.log(...a);
const warn = (...a) => console.error(...a);

function parse(argv) {
  const o = {};
  for (const a of argv) {
    if (a === '--check') o.check = true;
    else if (a === '--json') o.json = true;
    else if (a === '--force') o.force = true;
    else if (a === '--yes' || a === '-y') o.yes = true;
  }
  return o;
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

function git(root, args, { buffer = false } = {}) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: buffer ? 'buffer' : 'utf8', windowsHide: true, maxBuffer: 32 << 20 });
  if (r.error) return { ok: false, out: '', err: r.error.message };
  return { ok: r.status === 0, out: buffer ? r.stdout : String(r.stdout || '').trim(), err: String(r.stderr || '').trim() };
}

/** 폴더 안 파일들 → { rel: Buffer } (*.bak 제외) */
function readDirTree(dir, base = dir, out = {}) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) readDirTree(p, base, out);
    else if (e.isFile() && !e.name.endsWith('.bak')) out[path.relative(base, p).split(path.sep).join('/')] = fs.readFileSync(p);
  }
  return out;
}

/** git ref 의 skills/agent4d → { rel: Buffer } */
function readGitTree(root, ref, sub = 'skills/agent4d') {
  const ls = git(root, ['ls-tree', '-r', '--name-only', ref, '--', sub]);
  const out = {};
  if (!ls.ok) return out;
  for (const f of ls.out.split('\n').filter(Boolean)) {
    const r = git(root, ['show', `${ref}:${f}`], { buffer: true });
    if (r.ok) out[f.slice(sub.length + 1)] = r.out;
  }
  return out;
}

function skillInfo(skillDir, sourcePath) {
  let st;
  try { st = fs.lstatSync(skillDir); } catch { return { kind: 'missing' }; }
  let realPath = null;
  try { realPath = fs.realpathSync(skillDir); } catch {}
  return { kind: skillInstallKind({ exists: true, isLink: st.isSymbolicLink(), realPath, sourcePath }), realPath };
}

/** 사본 갱신: 바뀔 파일마다 기존 것을 <파일>.bak 하나로 남기고 덮는다(폴더 째 .bak 은 스킬로 또 잡히므로 만들지 않음) */
function refreshSkillCopy(skillDir, src, files) {
  for (const rel of files) {
    const dst = path.join(skillDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (fs.existsSync(dst)) fs.copyFileSync(dst, dst + '.bak');
    fs.writeFileSync(dst, src[rel]);
  }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

async function serverRunning(st) {
  if (!st || !st.serverPid || !st.port || !isAlive(st.serverPid)) return false;
  try {
    const r = await fetch(`http://127.0.0.1:${st.port}/healthz`, { signal: AbortSignal.timeout(2000) });
    return r.status === 200;
  } catch { return false; }
}

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => rl.question(q, r));
  rl.close();
  return /^(y|yes|예|네|ㅇ)$/i.test(String(a).trim());
}

function printCheck(rec, json) {
  if (json) { log(JSON.stringify(rec)); return; }
  if (rec.disabled) return log(t('upd.off'));
  if (rec.error) return log(t('upd.fail', { err: rec.error }));
  if (rec.newer) return log(t('upd.newer', { latest: rec.latest, cur: rec.current, url: rec.url, notes: rec.notes ? `\n  ${rec.notes}` : '' }));
  log(t('upd.latest', { cur: rec.current }));
}

/**
 * deps: { root, home, skillDir, env, fetch, isTTY } — 시험·다른 설치 위치용. 종료 코드를 돌려준다.
 */
export async function main(argv = [], deps = {}) {
  const opts = parse(argv);
  const root = deps.root || ROOT;
  const home = deps.home || ccvizHome();
  const env = deps.env || process.env;
  const cfg = readJson(path.join(home, 'config.json')) || {};
  const pkg = readPackage(path.join(root, 'package.json'));
  const slug = repoSlugOf(pkg);
  const current = typeof pkg.version === 'string' ? pkg.version : '0.0.0';

  if (opts.check) {
    const rec = await checkForUpdate({ home, current, slug, cfg, env, force: !!opts.force, fetch: deps.fetch });
    printCheck(rec, opts.json);
    return 0; // 실패해도 0(조용히)
  }

  // ── 적용 ──
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (!top.ok || path.resolve(top.out).toLowerCase() !== path.resolve(root).toLowerCase()) {
    log(t('upd.notGit', { dir: root, url: releasesPage(slug || 'burn001/agent4d'), slug: slug || 'burn001/agent4d' }));
    return 0;
  }
  const origin = git(root, ['remote', 'get-url', 'origin']).out || '-';
  if (!isPublicClone(origin, slug)) { log(t('upd.devClone', { origin, slug: slug || '-' })); return 0; }

  const f = git(root, ['fetch', '--tags', '--quiet', 'origin']);
  if (!f.ok) { warn(t('upd.fetchFail', { msg: f.err || '-' })); return 1; }
  if (!git(root, ['rev-parse', '--verify', '--quiet', 'origin/main']).ok) { warn(t('upd.noRemote')); return 1; }
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).out;
  const dirty = !!git(root, ['status', '--porcelain', '--untracked-files=no']).out;
  const behind = Number(git(root, ['rev-list', '--count', 'HEAD..origin/main']).out) || 0;
  const ahead = Number(git(root, ['rev-list', '--count', 'origin/main..HEAD']).out) || 0;
  const plan = pullPlan({ branch, dirty, behind, ahead, ffPossible: ahead === 0 });
  if (!plan.ok) { warn(t(`upd.stop.${plan.reason}`, { branch, dir: root })); return 1; }

  let next = current;
  if (!plan.upToDate) {
    const j = (() => { try { return JSON.parse(git(root, ['show', 'origin/main:package.json']).out); } catch { return null; } })();
    if (j && typeof j.version === 'string') next = j.version;
  }

  // 스킬: 링크면 그대로, 사본이면 갱신 뒤 내용(origin/main 기준)과 비교
  const skillDir = deps.skillDir || path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills', 'agent4d');
  const sourcePath = path.join(root, 'skills', 'agent4d');
  const sk = skillInfo(skillDir, sourcePath);
  let skillSrc = null, skillFiles = [];
  if (sk.kind === 'copy') {
    skillSrc = plan.upToDate ? readDirTree(sourcePath) : readGitTree(root, 'origin/main');
    skillFiles = changedFiles(skillSrc, readDirTree(skillDir));
  }

  const st = readJson(path.join(home, 'state.json')) || {};
  const restart = !plan.upToDate && (await serverRunning(st));
  const rargs = restartArgs(st);

  log(plan.upToDate ? t('upd.planUpToDate', { cur: current }) : t('upd.plan', { cur: current, next, n: behind }));
  if (!plan.upToDate) log(t('upd.do.pull'));
  if (skillFiles.length) log(t('upd.do.skill', { dir: skillDir, n: skillFiles.length }));
  if (restart) log(t('upd.do.restart', { args: rargs.join(' ') }));
  if (plan.upToDate && !skillFiles.length) {
    log(t('upd.do.nothing'));
    if (sk.kind === 'link') log(t('upd.skillLink', { dir: skillDir }));
    return 0;
  }

  if (!opts.yes) {
    const tty = deps.isTTY ?? (process.stdin.isTTY && process.stdout.isTTY);
    if (!tty) { warn(t('upd.needYes')); return 1; }
    if (!(await ask(t('upd.confirm')))) { log(t('upd.cancel')); return 0; }
  }

  if (!plan.upToDate) {
    const p = git(root, ['pull', '--ff-only', '--tags', '--quiet', 'origin', 'main']);
    if (!p.ok) { warn(t('upd.pullFail', { msg: p.err || '-' })); return 1; }
    log(t('upd.pulled', { next }));
  }
  if (sk.kind === 'link') log(t('upd.skillLink', { dir: skillDir }));
  if (skillFiles.length) {
    try { refreshSkillCopy(skillDir, skillSrc, skillFiles); log(t('upd.skillDone', { dir: skillDir, n: skillFiles.length })); }
    catch (e) { warn(t('upd.skillFail', { dir: skillDir, msg: e.message })); }
  }
  if (restart) {
    log(t('upd.restarting', { args: rargs.join(' ') }));
    const cli = path.join(root, 'bin', 'agent4d.mjs');
    const s1 = spawnSync(process.execPath, [cli, 'stop'], { stdio: 'inherit', windowsHide: true, env });
    const s2 = spawnSync(process.execPath, [cli, ...rargs], { stdio: 'inherit', windowsHide: true, env });
    if (s1.status !== 0 || s2.status !== 0) { warn(t('upd.restartFail')); return 1; }
  }
  log(t('upd.done'));
  return 0;
}
