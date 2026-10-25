// 보관함 재생 출처 — 합성 fixture 만 사용. 보관함 사본은 시험 임시 폴더에 만든다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { makeReplayFixture, rmReplayFixture, ageIndex, RIDS } from './fixtures/replay-build.mjs';
import { createServer, createRealManager, parseArgs } from '../index.mjs';
import { ARCHIVE_PREFIX, isArchiveId, archiveKey, archiveId, resolveArchiveDir, metaOf } from '../archive.mjs';
import { loadConfig } from '../config.mjs';

const TOKEN = 'archive-token-' + 'c'.repeat(32);
const H = { 'x-ccviz-token': TOKEN };
let fx, arcDir, mgr, server, base, pmgr, pserver, pbase, nmgr, nserver, nbase, before0;

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
function get(url, headers = H) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const body = res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw) : raw;
        let json = null; try { json = JSON.parse(body.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, json });
      });
    }).on('error', reject);
  });
}
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const d of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, d.name), b = path.join(dst, d.name);
    if (d.isDirectory()) copyTree(a, b); else { fs.copyFileSync(a, b); const st = fs.statSync(a); fs.utimesSync(b, st.atime, st.mtime); }
  }
}
/** 보관함 폴더 전체의 (상대 경로, 크기, mtime, sha256) — 서버가 고쳐 쓰지 않았는지 대조 */
function treeHash(dir) {
  const out = [];
  const walk = (p) => {
    for (const d of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, d.name);
      if (d.isDirectory()) { out.push(`${path.relative(dir, q)}/ ${Math.round(fs.statSync(q).mtimeMs)}`); walk(q); continue; }
      const st = fs.statSync(q);
      out.push(`${path.relative(dir, q)} ${st.size} ${Math.round(st.mtimeMs)} ${crypto.createHash('sha256').update(fs.readFileSync(q)).digest('hex')}`);
    }
  };
  walk(dir);
  return out.sort().join('\n');
}

before(async () => {
  fx = makeReplayFixture();
  process.env.CCVIZ_CLAUDE_TMP = fx.tmpClaude;
  arcDir = path.join(fx.root, 'archive');
  // 원본과 같은 세션이 보관함에도 있는 경우(충돌 없음 확인) — 메인·다른 프로젝트 세션만 보관
  const mainProj = path.basename(path.dirname(fs.readdirSync(fx.projects).map((d) => path.join(fx.projects, d, `${RIDS.main}.jsonl`)).find((f) => fs.existsSync(f))));
  copyTree(path.join(fx.projects, mainProj), path.join(arcDir, mainProj));
  for (const f of fs.readdirSync(path.join(arcDir, mainProj))) if (f.startsWith(RIDS.child)) fs.rmSync(path.join(arcDir, mainProj, f), { recursive: true });
  fs.writeFileSync(path.join(arcDir, 'index.json'), JSON.stringify([{ proj: mainProj, sid: RIDS.main, cwd: 'D:\\work\\rp', lines: 20, tools: 6, kinds: 5, agents: 1, subs: 1, bg: 1, hours: 0.1, mb: 0.1,
    first: '2026-01-01T00:00:00.000Z', last: '2026-01-01T00:04:20.000Z', score: 120, why: ['서브에이전트 대량 분기'] }], null, 1));
  fs.writeFileSync(path.join(arcDir, 'INDEX.md'), '# transcript_archive\n');
  before0 = treeHash(arcDir);
  fx.mainProj = mainProj;

  mgr = createRealManager({ projectsDir: fx.projects, sessionsDir: fx.sessions, archiveDir: arcDir });
  await mgr.index.refresh(); ageIndex(mgr.index);
  await mgr.archive.refresh(); ageIndex(mgr.archive.index);
  server = createServer({ token: TOKEN, manager: mgr, webRoot: fx.root });
  base = await listen(server);
  pmgr = createRealManager({ projectsDir: fx.projects, sessionsDir: fx.sessions, project: fx.otherProjectDir, archiveDir: arcDir });
  pserver = createServer({ token: TOKEN, manager: pmgr, webRoot: fx.root, project: fx.otherProjectDir });
  pbase = await listen(pserver);
  nmgr = createRealManager({ projectsDir: fx.projects, sessionsDir: fx.sessions });
  nserver = createServer({ token: TOKEN, manager: nmgr, webRoot: fx.root });
  nbase = await listen(nserver);
});

after(() => {
  for (const s of [server, pserver, nserver]) s?.close();
  for (const m of [mgr, pmgr, nmgr]) m?.stop();
  rmReplayFixture(fx);
});

test('id 규칙: arc:<uuid>, 대소문자 무시, 원본 id 와 구분', () => {
  assert.equal(ARCHIVE_PREFIX, 'arc:');
  assert.equal(archiveId('ABC'), 'arc:abc');
  assert.ok(isArchiveId('ARC:x') && isArchiveId('arc:x') && !isArchiveId('x') && !isArchiveId(null));
  assert.equal(archiveKey('arc:AbC'), 'abc');
  assert.equal(archiveKey('plain'), 'plain');
  assert.equal(metaOf(null), null);
  assert.deepEqual(metaOf({ why: ['a'], tools: '3' }).why, ['a']);
  assert.equal(metaOf({ tools: '3' }).tools, 3);
});

test('보관함 폴더 결정: --archive > CCVIZ_ARCHIVE > config.archiveDir, 기본값 없음', () => {
  assert.equal(resolveArchiveDir({ env: {}, cfg: {} }), null);
  assert.equal(resolveArchiveDir({ env: {}, cfg: { archiveDir: 'C:/c' } }), 'C:/c');
  assert.equal(resolveArchiveDir({ env: { CCVIZ_ARCHIVE: 'C:/e' }, cfg: { archiveDir: 'C:/c' } }), 'C:/e');
  assert.equal(resolveArchiveDir({ arg: 'C:/a', env: { CCVIZ_ARCHIVE: 'C:/e' }, cfg: { archiveDir: 'C:/c' } }), 'C:/a');
  assert.equal(parseArgs(['--archive', 'D:/x']).archive, 'D:/x');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-cfg-'));
  try {
    const f = path.join(tmp, 'config.json');
    assert.equal(loadConfig(f).archiveDir, null);
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.ok(!('archiveDir' in j), '설정 파일에 기본값을 쓰지 않음');
    fs.writeFileSync(f, JSON.stringify({ ...j, archiveDir: 'D:/arc' }));
    assert.equal(loadConfig(f).archiveDir, 'D:/arc');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('/archive 요약: 프로젝트 묶음·세션 지표(why·도구·서브에이전트), 꺼져 있으면 enabled:false', async () => {
  const r = await get(`${base}/archive`);
  assert.equal(r.status, 200);
  assert.equal(r.json.enabled, true);
  assert.equal(r.json.count, 1);
  assert.equal(r.json.projects.length, 1);
  assert.equal(r.json.projects[0].projectId, fx.mainProj);
  assert.equal(r.json.projects[0].sessions, 1);
  assert.ok(r.json.projects[0].name);
  const s = r.json.sessions[0];
  assert.equal(s.sessionId, 'arc:' + RIDS.main);
  assert.deepEqual(s.archiveMeta.why, ['서브에이전트 대량 분기']);
  assert.equal(s.archiveMeta.subs, 1);
  assert.equal(s.archiveMeta.tools, 6);
  const n = await get(`${nbase}/archive`);
  assert.deepEqual(n.json, { enabled: false, count: 0, projects: [], sessions: [] });
  const u = await get(`${base}/archive`, {});
  assert.equal(u.status, 401);
});

test('/sessions?source=archive: 보관 세션만, sessionId arc:…, archive:true, 실시간 아님', async () => {
  const r = await get(`${base}/sessions?source=archive&limit=50`);
  assert.equal(r.status, 200);
  assert.equal(r.json.source, 'archive');
  assert.deepEqual(r.json.sessions.map((s) => s.sessionId), ['arc:' + RIDS.main]);
  const s = r.json.sessions[0];
  assert.equal(s.archive, true);
  assert.equal(s.originalSessionId, RIDS.main);
  assert.equal(s.live, false); assert.equal(s.running, false);
  assert.equal(s.projectDir, fx.mainProj);
  assert.ok(s.archiveMeta && s.archiveMeta.why.length === 1);
  // 일반 목록에는 보관 세션이 섞이지 않는다
  const n = await get(`${base}/sessions?limit=50`);
  assert.ok(n.json.sessions.every((x) => !String(x.sessionId).startsWith('arc:')));
  const off = await get(`${nbase}/sessions?source=archive`);
  assert.deepEqual(off.json.sessions, []);
});

test('재생: arc:<id> 와 원본 <id> 가 따로 빌드·캐시되고 응답 id 가 구분된다, 하이라이트 포함', async () => {
  const a = await get(`${base}/timeline?session=arc:${RIDS.main}`);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.sessionId, 'arc:' + RIDS.main);
  assert.equal(a.json.root, 's:' + RIDS.main);
  assert.ok(Array.isArray(a.json.highlights));
  const o = await get(`${base}/timeline?session=${RIDS.main}`);
  assert.equal(o.status, 200);
  assert.equal(o.json.sessionId, RIDS.main);
  assert.ok(Array.isArray(o.json.highlights));
  assert.equal(mgr.replays.cache.has(RIDS.main), true);
  assert.equal(mgr.archive.replays.cache.has(RIDS.main), true);
  assert.notEqual(mgr.replays.cache.get(RIDS.main), mgr.archive.replays.cache.get(RIDS.main));
  // 원본 재생은 claude -p 자식(원본 쪽에만 있음)까지, 보관함 재생은 보관된 것만
  assert.ok(o.json.nodeCount >= a.json.nodeCount);
  const pg = await get(`${base}/replay/events?session=arc:${RIDS.main}&from=1&limit=50`);
  assert.equal(pg.status, 200);
  assert.equal(pg.json.sessionId, 'arc:' + RIDS.main);
  assert.ok(pg.json.events.length > 0);
  const sn = await get(`${base}/replay/snapshot?session=ARC:${RIDS.main.toUpperCase()}&at=${Date.parse(a.json.endTs)}`);
  assert.equal(sn.status, 200);
  assert.equal(sn.json.sessionId, 'arc:' + RIDS.main);
  assert.ok(sn.json.nodes.some((x) => x.id === 's:' + RIDS.main));
  const s2 = await get(`${base}/sessions?source=archive`);
  assert.equal(s2.json.sessions[0].replayCached, true);
});

test('보관함 재생 404: 모르는 id·보관함 꺼짐·config.project 밖, 실시간 /state·/events 는 보관 세션을 받지 않음', async () => {
  assert.equal((await get(`${base}/timeline?session=arc:dddddddd-0000-4000-8000-dddddddddddd`)).status, 404);
  assert.equal((await get(`${nbase}/timeline?session=arc:${RIDS.main}`)).status, 404);
  assert.equal((await get(`${pbase}/timeline?session=arc:${RIDS.main}`)).status, 404);
  assert.equal((await get(`${pbase}/sessions?source=archive`)).json.sessions.length, 0);
  assert.equal((await get(`${base}/state?session=arc:${RIDS.main}`)).status, 404);
  assert.equal((await get(`${base}/events?session=arc:${RIDS.main}`)).status, 404);
  assert.equal((await get(`${base}/replay/events?session=arc:dddddddd-0000-4000-8000-dddddddddddd&from=1`)).status, 409);
});

test('보관함은 autoPick·전체 보기·/projects 에 나오지 않는다', async () => {
  const auto = await mgr.resolve('auto');
  assert.ok(!String(auto || '').startsWith('arc:'));
  const p = await get(`${base}/projects?inactive=1`);
  assert.ok(JSON.stringify(p.json).indexOf('arc:') < 0);
});

test('서버는 보관함 파일을 고쳐 쓰지 않는다(크기·mtime·SHA-256·폴더 시각 그대로)', () => {
  assert.equal(treeHash(arcDir), before0);
});
