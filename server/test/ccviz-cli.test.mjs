// ccviz CLI: 공유 레포 기본 workerUrl 은 비어 있다(특정 계정 subdomain 을 가리키지 않음). 임시 CCVIZ_HOME 만 쓴다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultConfig } from '../config.mjs';

const CCVIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'ccviz.mjs');
const run = (home, ...a) => spawnSync(process.execPath, [CCVIZ, ...a], { env: { ...process.env, CCVIZ_HOME: home }, encoding: 'utf8', timeout: 20_000 });

test('새 설정: workerUrl 기본값 없음 → url 은 고정 링크 대신 deploy 안내, 기존 config 의 workerUrl 은 그대로', () => {
  assert.equal(defaultConfig().workerUrl, null);
  const src = fs.readFileSync(CCVIZ, 'utf8') + fs.readFileSync(path.resolve(path.dirname(CCVIZ), '..', 'server', 'config.mjs'), 'utf8');
  assert.ok(!/[a-z0-9-]+-account\.workers\.dev/.test(src), '코드에 계정 subdomain 이 없음');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-cli-'));
  try {
    const r = run(home, 'url');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ccviz deploy/);
    const cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
    assert.equal(cfg.workerUrl, null);
    cfg.workerUrl = 'https://cc-agent-viz.example-sub.workers.dev';
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(cfg));
    const r2 = run(home, 'url');
    assert.ok(r2.stdout.startsWith('https://cc-agent-viz.example-sub.workers.dev/?t='));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('start 기본은 로컬 전용: --no-tunnel > --tunnel > config.remote > workerUrl 있음', async () => {
  const { wantRemote } = await import('../config.mjs');
  assert.equal(wantRemote({}, {}), false, '아무 설정 없으면 로컬');
  assert.equal(wantRemote({ tunnel: true }, {}), true);
  assert.equal(wantRemote({ 'no-tunnel': true, tunnel: true }, { remote: true }), false);
  assert.equal(wantRemote({}, { remote: true }), true);
  assert.equal(wantRemote({}, { remote: false, workerUrl: 'https://w.example' }), false);
  assert.equal(wantRemote({}, { workerUrl: 'https://w.example' }), true, '배포를 마친 PC 는 원격 유지');
  assert.equal(defaultConfig().remote, undefined, '새 설정에 remote 를 넣지 않음');
});

// ───────────── CLI 다국어(server/cli-i18n.mjs): 영어 기본, 한국어 로케일이면 한국어 ─────────────
test('cliLang 결정 순서: --lang > CCVIZ_LANG > LC_ALL > LC_MESSAGES > LANG(C·POSIX 건너뜀) > Intl 로케일 > en', async () => {
  const { resolveCliLang, langFlag, stripLangFlag, normCliLang } = await import('../cli-i18n.mjs');
  const R = (argv, env, intlLocale) => resolveCliLang({ argv: ['node', 'x', ...argv], env, intlLocale });
  assert.equal(R([], {}, 'en-US'), 'en', '아무것도 없으면 영어');
  assert.equal(R([], {}, 'ko-KR'), 'ko', 'Windows 한국어(LANG 없음) → Intl 로 한국어');
  assert.equal(R([], {}, ''), 'en');
  assert.equal(R([], { LANG: 'ko_KR.UTF-8' }, 'en-US'), 'ko');
  assert.equal(R([], { LANG: 'en_US.UTF-8' }, 'ko-KR'), 'en', '명시한 LANG 이 Intl 보다 앞');
  assert.equal(R([], { LANG: 'C.UTF-8' }, 'ko-KR'), 'ko', 'C 로케일은 건너뜀');
  assert.equal(R([], { LANG: 'POSIX' }, 'en-US'), 'en');
  assert.equal(R([], { LC_MESSAGES: 'ko_KR', LANG: 'en_US' }, 'en-US'), 'ko');
  assert.equal(R([], { LC_ALL: 'en_US', LC_MESSAGES: 'ko_KR' }, 'ko-KR'), 'en');
  assert.equal(R([], { CCVIZ_LANG: 'en', LC_ALL: 'ko_KR' }, 'ko-KR'), 'en', 'CCVIZ_LANG 이 로케일보다 앞');
  assert.equal(R([], { CCVIZ_LANG: 'ko' }, 'en-US'), 'ko');
  assert.equal(R([], { CCVIZ_LANG: 'fr' }, 'ko-KR'), 'ko', '모르는 CCVIZ_LANG 은 무시');
  assert.equal(R(['--lang', 'en'], { CCVIZ_LANG: 'ko' }, 'ko-KR'), 'en', '--lang 이 맨 앞');
  assert.equal(R(['status', '--lang=ko'], { CCVIZ_LANG: 'en' }, 'en-US'), 'ko');
  assert.equal(langFlag(['a', '--lang']), '');
  assert.equal(langFlag(['a']), null);
  assert.deepEqual(stripLangFlag(['start', '--lang', 'ko', '--port', '1']), ['start', '--port', '1']);
  assert.deepEqual(stripLangFlag(['--lang=en', 'url']), ['url']);
  assert.equal(normCliLang('KO-kr'), 'ko');
  assert.equal(normCliLang('english'), null);
});

test('CLI 사전: en·ko 키가 같고 자리표시({name})도 같음, t() 대체·대체 언어', async () => {
  const { CLI_DICT, t, remainText } = await import('../cli-i18n.mjs');
  const ek = Object.keys(CLI_DICT.en).sort(), kk = Object.keys(CLI_DICT.ko).sort();
  assert.deepEqual(kk, ek);
  const ph = (v) => (typeof v === 'string' ? [...new Set(v.match(/\{\w+\}/g) || [])].sort() : 'fn');
  for (const k of ek) {
    assert.equal(typeof CLI_DICT.ko[k], typeof CLI_DICT.en[k], k);
    assert.deepEqual(ph(CLI_DICT.ko[k]), ph(CLI_DICT.en[k]), `자리표시 ${k}`);
  }
  assert.equal(t('srv.reuse', { pid: 1, port: 2 }, 'en'), '· Reusing server (PID 1, port 2)');
  assert.equal(t('srv.reuse', { pid: 1, port: 2 }, 'ko'), '· 서버 재사용 (PID 1, 포트 2)');
  assert.equal(t('no.such.key', {}, 'ko'), 'no.such.key');
  assert.equal(remainText(3 * 3600 + 8 * 60, 'en'), '3h 8m');
  assert.equal(remainText(3 * 3600 + 8 * 60, 'ko'), '3시간 8분');
  assert.equal(remainText(26 * 3600, 'en'), '1d 2h');
  assert.equal(remainText(0, 'ko'), '재설정됨');
});

test('CLI 언어: help 는 CCVIZ_LANG 을 따르고 --lang 이 앞섬, url 출력은 언어와 무관하게 주소로 시작, 잘못된 --lang 은 2', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-cli-'));
  const runL = (lang, ...a) => spawnSync(process.execPath, [CCVIZ, ...a], { env: { ...process.env, CCVIZ_HOME: home, CCVIZ_LANG: lang }, encoding: 'utf8', timeout: 20_000 });
  try {
    const en = runL('en', 'help');
    assert.equal(en.status, 0);
    assert.match(en.stdout, /^Usage: ccviz <command>/);
    const ko = runL('ko', '--help');
    assert.equal(ko.status, 0);
    assert.match(ko.stdout, /^사용법: ccviz <명령>/);
    assert.match(runL('ko', 'help', '--lang', 'en').stdout, /^Usage:/, '--lang 이 CCVIZ_LANG 보다 앞');
    assert.match(runL('en', '--lang=ko', 'help').stdout, /^사용법:/);
    const bad = runL('en', 'help', '--lang', 'fr');
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /--lang/);
    assert.equal(runL('en', 'nope').status, 2, '모르는 명령은 도움말 + 2');
    assert.match(runL('en', 'url').stdout, /\(no fixed link — .*ccviz deploy/);
    assert.match(runL('ko', 'url').stdout, /고정 링크 없음 — .*ccviz deploy/);
    const cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
    cfg.workerUrl = 'https://cc-agent-viz.example-sub.workers.dev';
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(cfg));
    for (const l of ['en', 'ko']) assert.ok(runL(l, 'url', '--lang', l).stdout.startsWith('https://cc-agent-viz.example-sub.workers.dev/?t='), l);
    // statusline status 문구도 언어를 따름(CLAUDE_CONFIG_DIR 는 빈 임시 폴더)
    const sl = spawnSync(process.execPath, [CCVIZ, 'statusline', 'status', '--lang', 'en'], { env: { ...process.env, CCVIZ_HOME: home, CLAUDE_CONFIG_DIR: home }, encoding: 'utf8', timeout: 20_000 });
    assert.match(sl.stdout, /^statusLine : not installed/);
    // archive 도움말도
    assert.match(runL('en', 'archive').stdout, /list archived sessions/);
    assert.match(runL('ko', 'archive').stdout, /보관된 세션 목록/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
