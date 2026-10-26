// 업데이트 확인·적용 — SemVer·캐시 만료·오프라인 실패·개발 클론 건너뜀·스킬 사본/링크 판정·/healthz update
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseSemver, cmpSemver, githubSlug, repoSlugOf, updateCheckDisabled, summarizeNotes, fetchLatest, cacheFresh, makeRecord,
  checkForUpdate, publicUpdate, UpdateChecker, isPublicClone, skillInstallKind, changedFiles, restartArgs, pullPlan, fakeRecord, CACHE_FILE,
} from '../update.mjs';
import { createServer } from '../index.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const res = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
});

test('SemVer 비교: v 접두사·사전 배포·자릿수', () => {
  assert.deepEqual(parseSemver('v1.2.3'), { major: 1, minor: 2, patch: 3, pre: [] });
  assert.equal(parseSemver('1.2'), null);
  assert.equal(cmpSemver('0.3.1', 'v0.3.1'), 0);
  assert.equal(cmpSemver('0.10.0', '0.9.9'), 1);
  assert.equal(cmpSemver('0.3.1', '0.4.0'), -1);
  assert.equal(cmpSemver('1.0.0-rc.1', '1.0.0'), -1);
  assert.equal(cmpSemver('1.0.0-rc.2', '1.0.0-rc.10'), -1);
  assert.equal(cmpSemver('1.0.0-alpha', '1.0.0-1'), 1);
  assert.equal(cmpSemver('x', '1.0.0'), null);
});

test('저장소 주소: package.json repository 에서, URL 형태 무관', () => {
  assert.equal(githubSlug('git+https://github.com/burn001/agent4d.git'), 'burn001/agent4d');
  assert.equal(githubSlug('git@github.com:Burn001/Agent4D.git'), 'burn001/agent4d');
  assert.equal(githubSlug('https://gitlab.com/a/b'), null);
  assert.equal(repoSlugOf({ repository: { url: 'git+https://github.com/burn001/agent4d.git' } }), 'burn001/agent4d');
  assert.equal(repoSlugOf({ repository: 'https://github.com/x/y' }), 'x/y');
  assert.equal(repoSlugOf(), 'burn001/agent4d'); // 이 레포 package.json
});

test('꺼짐: config updateCheck:false 또는 AGENT4D_NO_UPDATE_CHECK', () => {
  assert.equal(updateCheckDisabled({}, {}), false);
  assert.equal(updateCheckDisabled({ updateCheck: false }, {}), true);
  assert.equal(updateCheckDisabled({}, { AGENT4D_NO_UPDATE_CHECK: '1' }), true);
  assert.equal(updateCheckDisabled({}, { AGENT4D_NO_UPDATE_CHECK: '0' }), false);
});

test('변경 요약: 머리글 빼고 한두 줄, 길면 자름', () => {
  assert.equal(summarizeNotes('### Added\n- Foo **bar** [link](http://x)\n- Baz\n- Qux'), 'Foo bar link / Baz');
  assert.ok(summarizeNotes('- ' + 'a'.repeat(400)).length <= 160);
  assert.equal(summarizeNotes(null), '');
});

test('fetchLatest: 성공·404·rate limit·HTTP 오류·오프라인·타임아웃 모두 던지지 않음', async () => {
  let seen;
  const ok = await fetchLatest({ slug: 'a/b', fetch: async (u, o) => { seen = { u, o }; return res(200, { tag_name: 'v0.4.0', html_url: 'https://github.com/a/b/releases/tag/v0.4.0', body: '- New' }); } });
  assert.deepEqual(ok, { latest: '0.4.0', url: 'https://github.com/a/b/releases/tag/v0.4.0', notes: 'New' });
  assert.equal(seen.u, 'https://api.github.com/repos/a/b/releases/latest');
  assert.ok(seen.o.headers['User-Agent']);
  assert.equal(seen.o.headers.Authorization, undefined);
  assert.deepEqual(await fetchLatest({ slug: 'a/b', fetch: async () => res(404, {}) }), { error: 'no_release' });
  assert.deepEqual(await fetchLatest({ slug: 'a/b', fetch: async () => res(403, {}, { 'x-ratelimit-remaining': '0' }) }), { error: 'rate_limited' });
  assert.deepEqual(await fetchLatest({ slug: 'a/b', fetch: async () => res(403, {}) }), { error: 'http_403' });
  assert.deepEqual(await fetchLatest({ slug: 'a/b', fetch: async () => res(200, { tag_name: 'nightly' }) }), { error: 'bad_response' });
  assert.deepEqual(await fetchLatest({ slug: 'a/b', fetch: async () => { throw new TypeError('fetch failed'); } }), { error: 'offline' });
  const slow = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
  assert.deepEqual(await fetchLatest({ slug: 'a/b', fetch: slow, timeoutMs: 20 }), { error: 'timeout' });
  // html_url 이 github 가 아니면 Release 페이지 주소를 만든다
  const odd = await fetchLatest({ slug: 'a/b', fetch: async () => res(200, { tag_name: '1.0.0', html_url: 'https://evil.example/x' }) });
  assert.equal(odd.url, 'https://github.com/a/b/releases/tag/1.0.0');
});

test('캐시 만료: 성공 24시간·실패 1시간, 설치 버전·저장소가 바뀌면 다시', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const rec = makeRecord({ current: '0.3.1', slug: 'a/b', res: { latest: '0.4.0', url: 'u', notes: '' }, now: now - 23 * 3600e3 });
  assert.equal(rec.newer, true);
  assert.equal(cacheFresh(rec, { now, current: '0.3.1', slug: 'a/b' }), true);
  assert.equal(cacheFresh(rec, { now: now + 2 * 3600e3, current: '0.3.1', slug: 'a/b' }), false);
  assert.equal(cacheFresh(rec, { now, current: '0.4.0', slug: 'a/b' }), false);
  assert.equal(cacheFresh(rec, { now, current: '0.3.1', slug: 'c/d' }), false);
  const err = makeRecord({ current: '0.3.1', slug: 'a/b', res: { error: 'offline' }, now: now - 2 * 3600e3 });
  assert.equal(cacheFresh(err, { now, current: '0.3.1', slug: 'a/b' }), false);
  assert.equal(cacheFresh(null, { now }), false);
  assert.equal(cacheFresh({ checkedAt: 'x' }, { now }), false);
});

test('checkForUpdate: 캐시 존중·force·오프라인 조용히·꺼짐이면 네트워크 0·가짜 값', async () => {
  const home = tmp('a4d-upd-');
  let calls = 0;
  const f = async () => { calls++; return res(200, { tag_name: 'v0.9.0', html_url: 'https://github.com/a/b/releases/tag/v0.9.0', body: '' }); };
  const r1 = await checkForUpdate({ home, current: '0.3.1', slug: 'a/b', env: {}, fetch: f });
  assert.equal(r1.newer, true);
  assert.ok(fs.existsSync(path.join(home, CACHE_FILE)));
  const r2 = await checkForUpdate({ home, current: '0.3.1', slug: 'a/b', env: {}, fetch: f });
  assert.equal(r2.cached, true);
  assert.equal(calls, 1);
  await checkForUpdate({ home, current: '0.3.1', slug: 'a/b', env: {}, fetch: f, force: true });
  assert.equal(calls, 2);
  const off = await checkForUpdate({ home: tmp('a4d-upd-'), current: '0.3.1', slug: 'a/b', env: {}, fetch: async () => { throw new Error('ENOTFOUND'); } });
  assert.equal(off.error, 'offline');
  assert.equal(publicUpdate(off), null);
  const dis = await checkForUpdate({ home, current: '0.3.1', slug: 'a/b', env: { AGENT4D_NO_UPDATE_CHECK: '1' }, fetch: f, force: true });
  assert.deepEqual(dis, { disabled: true, current: '0.3.1' });
  assert.equal(calls, 2);
  const fake = await checkForUpdate({ home, current: '0.3.1', slug: 'a/b', env: { AGENT4D_FAKE_UPDATE: 'v0.5.0' }, fetch: f });
  assert.equal(fake.newer, true);
  assert.equal(fake.url, 'https://github.com/a/b/releases/tag/v0.5.0');
  assert.equal(calls, 2);
  assert.equal(fakeRecord('nope', '0.3.1', 'a/b'), null);
});

test('UpdateChecker: 꺼짐·데모(offline)는 네트워크 없음, get() 은 최소 형태', async () => {
  let calls = 0;
  const f = async () => { calls++; return res(200, { tag_name: 'v0.9.0', body: '' }); };
  const off = new UpdateChecker({ home: tmp('a4d-upd-'), current: '0.3.1', slug: 'a/b', cfg: { updateCheck: false }, env: {}, fetch: f });
  assert.equal(await off.run(), null);
  const demo = new UpdateChecker({ home: tmp('a4d-upd-'), current: '0.3.1', slug: 'a/b', env: {}, fetch: f, offline: true });
  assert.equal(await demo.run(), null);
  assert.equal(calls, 0);
  const on = new UpdateChecker({ home: tmp('a4d-upd-'), current: '0.3.1', slug: 'a/b', env: {}, fetch: f });
  await on.run();
  assert.deepEqual(on.get(), { current: '0.3.1', latest: '0.9.0', newer: true, url: 'https://github.com/a/b/releases/tag/v0.9.0' });
});

test('/healthz: update 가 있으면 싣고, 없으면 예전 모양', async () => {
  const up = { get: () => ({ current: '0.3.1', latest: '0.9.0', newer: true, url: 'https://github.com/a/b/releases/tag/v0.9.0' }) };
  for (const [update, has] of [[up, true], [null, false]]) {
    const srv = createServer({ token: 't', manager: {}, update });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const j = await (await fetch(`http://127.0.0.1:${srv.address().port}/healthz`)).json();
    srv.close();
    assert.equal(j.ok, true);
    assert.equal('update' in j, has);
    if (has) assert.equal(j.update.latest, '0.9.0');
  }
});

test('개발 클론·포크는 건너뜀: origin 이 package.json 저장소와 같을 때만 공개 클론', () => {
  assert.equal(isPublicClone('https://github.com/burn001/agent4d.git', 'burn001/agent4d'), true);
  assert.equal(isPublicClone('git@github.com:burn001/agent4d.git', 'burn001/agent4d'), true);
  assert.equal(isPublicClone('https://github.com/burn001/agent4d-work.git', 'burn001/agent4d'), false);
  assert.equal(isPublicClone('https://github.com/someone/agent4d.git', 'burn001/agent4d'), false);
  assert.equal(isPublicClone('', 'burn001/agent4d'), false);
});

test('스킬 사본/링크 판정·바뀐 파일·재시작 인자·pull 계획', () => {
  assert.equal(skillInstallKind({ exists: false }), 'missing');
  assert.equal(skillInstallKind({ exists: true, isLink: true }), 'link');
  assert.equal(skillInstallKind({ exists: true, isLink: false, realPath: '/h/agent4d/skills/agent4d', sourcePath: '/h/agent4d/skills/agent4d' }), 'link');
  assert.equal(skillInstallKind({ exists: true, isLink: false, realPath: '/h/.claude/skills/agent4d', sourcePath: '/h/agent4d/skills/agent4d' }), 'copy');
  assert.deepEqual(changedFiles({ 'SKILL.md': 'new', 'a/b.txt': 'x' }, { 'SKILL.md': 'old', extra: 'y' }), ['SKILL.md', 'a/b.txt']);
  assert.deepEqual(changedFiles({ 'SKILL.md': 'same' }, { 'SKILL.md': Buffer.from('same') }), []);
  assert.deepEqual(restartArgs({ port: 7788, mode: 'remote', watchPid: 12 }), ['start', '--port', '7788', '--tunnel', '--watch']);
  assert.deepEqual(restartArgs({ port: 7790, mode: 'local', project: 'P' }), ['start', '--port', '7790', '--no-tunnel', '--project', 'P']);
  assert.deepEqual(pullPlan({ branch: 'dev', dirty: false, behind: 1, ahead: 0, ffPossible: true }), { ok: false, reason: 'branch' });
  assert.deepEqual(pullPlan({ branch: 'main', dirty: true, behind: 1, ahead: 0, ffPossible: true }), { ok: false, reason: 'dirty' });
  assert.deepEqual(pullPlan({ branch: 'main', dirty: false, behind: 2, ahead: 1, ffPossible: false }), { ok: false, reason: 'diverged' });
  assert.deepEqual(pullPlan({ branch: 'main', dirty: false, behind: 0, ahead: 0, ffPossible: true }), { ok: true, upToDate: true });
  assert.deepEqual(pullPlan({ branch: 'main', dirty: false, behind: 3, ahead: 0, ffPossible: true }), { ok: true, upToDate: false });
});

test('agent4d update: git 클론이 아니면 안내만, 개발 클론이면 아무것도 바꾸지 않음', async (t) => {
  const { main } = await import('../../bin/update.mjs');
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  t.after(() => { console.log = orig; });
  const pkg = JSON.stringify({ version: '0.3.1', repository: { url: 'git+https://github.com/burn001/agent4d.git' } });
  const plain = tmp('a4d-plain-');
  fs.writeFileSync(path.join(plain, 'package.json'), pkg);
  assert.equal(await main([], { root: plain, home: tmp('a4d-home-'), skillDir: path.join(plain, 'nope'), env: { CCVIZ_LANG: 'en' } }), 0);
  assert.match(logs.join('\n'), /not a git clone|git 클론이 아니/);
  const git = spawnSync('git', ['--version']);
  if (git.status !== 0) return;
  const dev = tmp('a4d-dev-');
  fs.writeFileSync(path.join(dev, 'package.json'), pkg);
  const run = (...a) => spawnSync('git', ['-C', dev, ...a], { encoding: 'utf8' });
  run('init', '-q'); run('remote', 'add', 'origin', 'https://github.com/burn001/agent4d-work.git');
  logs.length = 0;
  assert.equal(await main(['--yes'], { root: dev, home: tmp('a4d-home-'), skillDir: path.join(dev, 'nope'), env: { CCVIZ_LANG: 'en' } }), 0);
  assert.match(logs.join('\n'), /agent4d-work/);
  assert.equal(run('status', '--porcelain').stdout.trim(), '?? package.json'); // 아무것도 안 바뀜
});
