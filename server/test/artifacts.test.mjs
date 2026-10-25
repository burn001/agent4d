// 작업 대상 층 — 서버 추출기·정리·접기·누적·재생 재구성
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { artStart, artEnd, sanitizeArt, displayPath, shellDeletes, shellServices, setServiceScripts, dbCollections, externalEv, externalPayload, ArtifactStore } from '../artifacts.mjs';
import { ArtBook, foldRef, isShown } from '../../web/artifact-core.mjs';
import { Graph } from '../graph.mjs';

const R = 'D:/dev_repos/viz';
const ctx = { cwd: R, root: R };
const one = (t, i, c = ctx) => artStart(t, i, c);

test('파일 도구: 상대 경로·폴더·동사·변경 크기, 홈 아래는 ~, 산출물 확장자', () => {
  const w = one('Write', { file_path: 'D:\\dev_repos\\viz\\web\\App.js', content: 'a\nb\nc' });
  assert.deepEqual(w, [{ k: 'file', id: 'web/app.js', p: 'web/App.js', d: 'web', n: 'App.js', v: 'write', sz: 3 }]);
  const e = one('Edit', { file_path: 'server/x.mjs', old_string: 'a', new_string: 'a\nb' });
  assert.equal(e[0].v, 'modify'); assert.equal(e[0].sz, 2); assert.equal(e[0].id, 'server/x.mjs');
  const r = one('Read', { file_path: path.join(os.homedir(), '.claude', 'x.md') });
  assert.equal(r[0].v, 'read'); assert.ok(r[0].p.startsWith('~/.claude/'), r[0].p);
  const o = one('Write', { file_path: 'out/최종보고서.hwpx', content: 'x' });
  assert.equal(o[0].k, 'output'); assert.equal(o[0].imp, 'final');
  assert.equal(one('Write', { file_path: '.env', content: 'A=1' })[0].imp, 'secret');
  assert.equal(displayPath('E:/other/a.txt', R).p, 'e:/other/a.txt');
});

test('결과로 다듬기: Write 만듦/덮어쓰기, Edit 실제 diff 줄, 실패는 null', () => {
  const w = one('Write', { file_path: 'a.js', content: 'x' });
  assert.equal(artEnd(w, { ok: true, tur: { type: 'create' } })[0].v, 'create');
  const up = artEnd(w, { ok: true, tur: { type: 'update' } })[0];
  assert.equal(up.v, 'modify'); assert.equal(up.x, 'overwrite');
  const e = one('Edit', { file_path: 'a.js', old_string: 'x', new_string: 'y' });
  assert.equal(artEnd(e, { ok: true, tur: { structuredPatch: [{ lines: [' a', '-x', '+y', '+z'] }] } })[0].sz, 3);
  assert.equal(artEnd(e, { ok: false }), null);
});

test('셸: 삭제(rm -rf·Remove-Item)·산출물 인자·리다이렉트·저장소 push(force)·DB(컬렉션·DROP)·원격·서비스', () => {
  const a = one('Bash', { command: 'rm -rf build && git add -A && git commit -m "x" && git push --force origin main' });
  assert.deepEqual(a.map((x) => [x.k, x.v, x.x || '']), [['file', 'delete', 'rm'], ['repo', 'push', 'force']]);
  assert.equal(a[1].id, 'repo:viz');
  const ps = one('PowerShell', { command: 'Remove-Item -Recurse -Force .\\dist; Set-Content -Path .env -Value x' });
  assert.equal(ps[0].v, 'delete'); assert.equal(ps[0].x, 'rm'); assert.equal(ps[0].id, 'dist');
  assert.equal(ps[1].imp, 'secret');
  const out = one('Bash', { command: 'node shot.mjs --out screenshots/a.png && echo hi > out/log.txt' });
  assert.deepEqual(out.map((x) => [x.k, x.v, x.id]), [['output', 'create', 'screenshots/a.png'], ['file', 'modify', 'out/log.txt']]);
  const db = one('Bash', { command: 'mongosh "mongodb://u:p@h/appdb" --eval "db.cases.drop()"' });
  assert.equal(db[0].id, 'db:mongo/appdb'); assert.equal(db[0].x, 'drop'); assert.deepEqual(db[0].coll, ['cases']); assert.equal(db[0].imp, 'db');
  const pg = one('Bash', { command: 'psql -d survey -c "SELECT * FROM resp"' });
  assert.equal(pg[0].v, 'query'); assert.deepEqual(pg[0].coll, ['resp']);
  const scp = one('Bash', { command: 'scp dist.zip devbox:/srv/www/' });
  assert.deepEqual([scp[0].k, scp[0].v, scp[0].imp], ['remote', 'write', 'prod']);
  assert.deepEqual(one('Bash', { command: 'gws gmail +send --to a@b.c' }).map((x) => [x.k, x.n, x.v]), [['service', 'Google Workspace', 'write']]);
  assert.deepEqual(one('Bash', { command: 'curl -s http://127.0.0.1:7788/state' }), []);
  assert.equal(one('Bash', { command: 'curl -X POST https://api.example.com/v1/x -d @a.json' })[0].v, 'write');
  assert.deepEqual(shellDeletes('rm a.txt'), [{ w: 'a.txt', rec: false }]);
  assert.deepEqual(shellServices('npx wrangler deploy').map((s) => [s.name, s.w]), [['Cloudflare', true]]);
  assert.deepEqual(dbCollections('db.users.find({}); SELECT a FROM orders JOIN items'), ['users', 'orders', 'items']);
  assert.deepEqual(one('Bash', { command: 'ls -la && git status' }), []);
});

test('MCP·Artifact: 서비스·DB, 산출물 도구', () => {
  assert.deepEqual(one('mcp__plugin_cloudflare_cloudflare__execute', { code: 'x' }).map((x) => [x.k, x.v]), [['service', 'query']]);
  const m = one('mcp__mongodb__insert_many', { database: 'appdb', collection: 'x' });
  assert.equal(m[0].k, 'db'); assert.equal(m[0].v, 'write');
  const a = one('Artifact', { action: 'publish', file_path: 'C:/x/report.html', title: 'Weekly Report' });
  assert.deepEqual([a[0].k, a[0].v, a[0].n], ['output', 'create', 'Weekly Report']);
  assert.deepEqual(one('Artifact', { action: 'read', url: 'x' }), []);
});

test('정리·접기: 열거형·마스킹, minimal·외부 링크는 폴더까지 + 파일명 해시(확장자 유지), DB·호스트 해시', () => {
  const raw = [{ k: 'file', id: 'web/app.js', p: 'web/App.js', d: 'web', n: 'App.js', v: 'modify', sz: 3.6, junk: 1 }, { k: 'bad', id: 'x', v: 'read' }, { k: 'db', id: 'db:mongo/appdb', n: 'appdb', v: 'write', coll: ['cases'] }];
  const s = sanitizeArt(raw);
  assert.equal(s.length, 2); assert.equal(s[0].sz, 4); assert.equal(s[0].junk, undefined);
  const m = sanitizeArt(raw, 'minimal');
  assert.match(m[0].id, /^web\/#[0-9a-f]{6}\.js$/); assert.equal(m[0].d, 'web'); assert.equal(m[0].p, m[0].id);
  assert.match(m[1].id, /^db:mongo\/#[0-9a-f]{4}$/); assert.equal(m[1].coll, undefined);
  assert.equal(foldRef(s[0]).id, m[0].id, '같은 입력 → 같은 접힘(열쇠 일관)');
  const masked = sanitizeArt([{ k: 'remote', id: 'remote:password=hunter2', v: 'query' }]);
  assert.equal(masked, null, '가려진 열쇠는 뺌');
  const ev = externalEv({ type: 'tool-end', art: s });
  assert.match(ev.art[0].id, /#/); assert.equal(s[0].id, 'web/app.js', '원본은 그대로');
  const p = externalPayload({ items: [{ ...s[0], cnt: { modify: 1 }, who: [], log: [] }] });
  assert.ok(p.folded); assert.match(p.items[0].id, /^web\/#/);
});

test('graph.emit 이 art 를 정리한다(minimal 이면 접힘)', () => {
  const g = new Graph({ rootSessionId: 'x', privacy: 'minimal' });
  g.finishLoad();
  const e = g.emit({ type: 'tool-start', nodeId: 's:x', art: [{ k: 'file', id: 'a/b.js', p: 'a/b.js', d: 'a', n: 'b.js', v: 'modify' }] });
  assert.match(e.art[0].id, /^a\/#/);
  const e2 = g.emit({ type: 'tool-start', nodeId: 's:x', art: [{ k: 'nope', id: 'a', v: 'read' }] });
  assert.equal(e2.art, undefined);
});

test('장부: 읽기는 있는 대상만, 중복 tool-end 무시, 상한·7일 창, 바닥층 표시 규칙', () => {
  const b = new ArtBook({ max: 3 });
  const T = Date.parse('2026-10-24T10:00:00Z');
  const ev = (tu, art, dt = 0, ok = true) => ({ type: 'tool-end', ts: new Date(T + dt).toISOString(), nodeId: 'a:1', toolUseId: tu, ok, art });
  assert.equal(b.apply(ev('t0', [{ k: 'file', id: 'x.js', v: 'read' }])), null, '없는 대상 읽기는 무시');
  const r1 = b.apply(ev('t1', [{ k: 'file', id: 'x.js', v: 'create', sz: 5 }]));
  assert.equal(r1.changes[0].kind, 'new');
  assert.equal(b.apply(ev('t1', [{ k: 'file', id: 'x.js', v: 'create', sz: 5 }])), null, '같은 toolUseId 는 한 번');
  b.apply(ev('t2', [{ k: 'file', id: 'x.js', v: 'read' }], 1000));
  const it = b.get('_', 'x.js');
  assert.equal(it.cnt.read, 1); assert.equal(it.sz, 5); assert.equal(it.who[0].c, 2);
  assert.equal(b.apply(ev('t3', [{ k: 'file', id: 'y.js', v: 'modify' }], 0, false)), null, '실패는 장부에 없음');
  b.apply(ev('t4', [{ k: 'db', id: 'db:m/a', v: 'query' }], 2000));
  b.apply(ev('t5', [{ k: 'file', id: 'z.js', v: 'delete' }], 3000));
  assert.equal(b.get('_', 'z.js').del, 1);
  b.apply(ev('t6', [{ k: 'file', id: 'w.js', v: 'modify', imp: 'secret' }], 4000));
  assert.equal(b.count('_'), 3, '상한 3');
  assert.ok(b.get('_', 'w.js'), '중요 대상은 남음');
  assert.ok(isShown(b.get('_', 'db:m/a')), 'DB 조회는 바닥층에');
  b.prune(T + 8 * 86_400_000);
  assert.equal(b.count('_'), 0, '7일 창 밖은 빠짐');
});

// 합성 transcript(메인 + 서브에이전트) → ArtifactStore: 누적·재생 시점 재구성
function writeFixture(dir) {
  const pid = 'D--fixture';
  const pdir = path.join(dir, pid);
  const sid = '11111111-2222-4333-8444-555555555555';
  fs.mkdirSync(path.join(pdir, sid, 'subagents'), { recursive: true });
  const T = Date.now() - 3600_000;
  const iso = (dt) => new Date(T + dt).toISOString();
  const cwd = 'D:\\fx\\proj';
  const L = (o) => JSON.stringify(o);
  const main = [
    L({ type: 'user', timestamp: iso(0), cwd, sessionId: sid, message: { role: 'user', content: '시작' } }),
    L({ type: 'assistant', timestamp: iso(1000), cwd, sessionId: sid, message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: 'D:\\fx\\proj\\src\\a.js', content: 'x\ny' } }] } }),
    L({ type: 'user', timestamp: iso(2000), cwd, sessionId: sid, toolUseResult: { type: 'create' }, message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] } }),
    L({ type: 'assistant', timestamp: iso(60_000), cwd, sessionId: sid, message: { content: [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'git commit -qm x && git push origin main' } }] } }),
    L({ type: 'user', timestamp: iso(61_000), cwd, sessionId: sid, message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', content: '[main 1a2b3c4] x\nTo github.com:me/proj.git\n   1a2b..5d6e  main -> main' }] } }),
    L({ type: 'assistant', timestamp: iso(120_000), cwd, sessionId: sid, message: { content: [{ type: 'tool_use', id: 'tu3', name: 'Edit', input: { file_path: 'src/a.js', old_string: 'x', new_string: 'z' } }] } }),
    L({ type: 'user', timestamp: iso(121_000), cwd, sessionId: sid, message: { content: [{ type: 'tool_result', tool_use_id: 'tu3', content: 'err', is_error: true }] } }),
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(pdir, sid + '.jsonl'), main);
  const sub = [
    L({ type: 'assistant', timestamp: iso(90_000), cwd, sessionId: sid, isSidechain: true, agentId: 'ag1', message: { content: [{ type: 'tool_use', id: 'tu9', name: 'Bash', input: { command: 'mongosh appdb --eval "db.cases.insertOne({})"' } }] } }),
    L({ type: 'user', timestamp: iso(91_000), cwd, sessionId: sid, isSidechain: true, agentId: 'ag1', message: { content: [{ type: 'tool_result', tool_use_id: 'tu9', content: "{ acknowledged: true, insertedCount: 1 }" }] } }),
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(pdir, sid, 'subagents', 'agent-ag1.jsonl'), sub);
  fs.writeFileSync(path.join(pdir, sid, 'subagents', 'agent-ag1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'DB 작업' }));
  return { pid, pdir, sid, T };
}

test('ArtifactStore: 메인·서브에이전트 transcript 훑기 → 대상·간선·실패 제외, until 재구성, 이어 읽기', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-art-'));
  try {
    const { pid, pdir, sid, T } = writeFixture(dir);
    const { SessionIndex } = await import('../discovery.mjs');
    const index = new SessionIndex({ projectsDir: dir, sessionsDir: path.join(dir, 'none') });
    await index.refresh();
    const store = new ArtifactStore({ index, minRefreshMs: 0 });
    const p = await store.payload({ sessionId: sid, waitMs: 10_000 });
    assert.equal(p.projectId, pid);
    const ids = p.items.map((x) => x.id).sort();
    assert.deepEqual(ids, ['db:mongo/appdb', 'repo:proj', 'src/a.js']);
    const a = p.items.find((x) => x.id === 'src/a.js');
    assert.equal(a.cnt.create, 1); assert.equal(a.cnt.modify, 0, '실패한 Edit 은 없음');
    const db = p.items.find((x) => x.k === 'db');
    assert.equal(db.who[0].node, 'a:ag1'); assert.equal(db.rows, 1);
    assert.equal(p.nodes['a:ag1'], 'DB 작업');
    const repo = p.items.find((x) => x.k === 'repo');
    assert.equal(repo.cnt.push, 1); assert.equal(repo.n, 'proj');
    // 재생 시점: push 전(30초)이면 파일만
    const early = await store.payload({ projectId: pid, untilMs: T + 30_000 });
    assert.deepEqual(early.items.map((x) => x.id), ['src/a.js']);
    // 이어 읽기: 새 줄 추가 → 다음 요청에 반영
    fs.appendFileSync(path.join(pdir, sid + '.jsonl'), [
      JSON.stringify({ type: 'assistant', timestamp: new Date(T + 200_000).toISOString(), cwd: 'D:\\fx\\proj', sessionId: sid, message: { content: [{ type: 'tool_use', id: 'tu4', name: 'Bash', input: { command: 'rm -rf dist' } }] } }),
      JSON.stringify({ type: 'user', timestamp: new Date(T + 201_000).toISOString(), cwd: 'D:\\fx\\proj', sessionId: sid, message: { content: [{ type: 'tool_result', tool_use_id: 'tu4', content: '' }] } }),
    ].join('\n') + '\n');
    await index.refresh();
    const p2 = await store.payload({ projectId: pid });
    const d = p2.items.find((x) => x.id === 'dist');
    assert.ok(d && d.del === 1 && d.x === 'rm');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('라이브·재생 같은 art: 합성 transcript → RootRuntime(라이브)·buildReplay(재생)·ArtBook 결과 일치', async () => {
  const { SessionIndex } = await import('../discovery.mjs');
  const { RootRuntime } = await import('../session.mjs');
  const { buildReplay } = await import('../replay.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-art2-'));
  const prevTmp = process.env.CCVIZ_CLAUDE_TMP;
  try {
    const cwd = 'D:/work/artp';
    const enc = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
    const SID = 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee';
    const projects = path.join(root, 'projects'), sessions = path.join(root, 'sessions');
    const proj = path.join(projects, enc(cwd));
    for (const d of [proj, sessions]) fs.mkdirSync(d, { recursive: true });
    process.env.CCVIZ_CLAUDE_TMP = path.join(root, 'tmp');
    const P = Date.now() - 2 * 86400_000, T = (s) => new Date(P + s * 1000).toISOString();
    const base = { sessionId: SID, cwd, version: '2.1.309', entrypoint: 'cli' };
    const A = (s, id, name, input) => ({ type: 'assistant', timestamp: T(s), ...base, message: { model: 'm', role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
    const Rr = (s, id, content, tur, err = false) => ({ type: 'user', timestamp: T(s), ...base, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: err }] }, toolUseResult: tur });
    const recs = [
      { type: 'user', timestamp: T(0), ...base, origin: { kind: 'human' }, promptSource: 'user', message: { role: 'user', content: '대상 시험' } },
      A(1, 'w1', 'Write', { file_path: 'D:/work/artp/src/a.js', content: 'a\nb' }), Rr(2, 'w1', 'ok', { type: 'create' }),
      A(3, 'e1', 'Edit', { file_path: 'src/a.js', old_string: 'a', new_string: 'c' }), Rr(4, 'e1', 'ok', { structuredPatch: [{ lines: ['-a', '+c'] }] }),
      A(5, 'd1', 'Bash', { command: 'psql -d survey -c "DELETE FROM t WHERE x=1"' }), Rr(6, 'd1', 'x', { stdout: 'DELETE 3\n(3 rows)', stderr: '' }),
      A(7, 'r1', 'Bash', { command: 'rm -rf build' }), Rr(8, 'r1', '', { stdout: '', stderr: '' }),
      A(9, 'e2', 'Edit', { file_path: 'src/b.js', old_string: 'a', new_string: 'c' }), Rr(10, 'e2', 'fail', null, true),
      { type: 'system', subtype: 'turn_duration', durationMs: 1000, timestamp: T(20), ...base },
    ];
    fs.writeFileSync(path.join(proj, `${SID}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const old = (P + 60_000) / 1000;
    fs.utimesSync(path.join(proj, `${SID}.jsonl`), old, old);
    const index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
    await index.refresh();
    for (const e of index.entries.values()) e.birthtimeMs = e.mtimeMs;
    const rt = new RootRuntime({ sessionId: SID, index });
    await rt.start();
    rt.close();
    const live = rt.graph.ring;
    const data = await buildReplay({ sessionId: SID, index });
    const rep = data.events.map((x) => x.e || x);
    const sig = (evs) => evs.filter((e) => e.art).map((e) => JSON.stringify([e.type, e.toolUseId, e.art])).sort();
    assert.deepEqual(sig(rep), sig(live), 'tool-start·tool-end art 가 두 경로에서 같다');
    const end = (id) => live.find((e) => e.type === 'tool-end' && e.toolUseId === id);
    assert.deepEqual(end('w1').art.map((r) => [r.id, r.v]), [['src/a.js', 'create']]);
    assert.equal(end('e1').art[0].sz, 2);
    assert.deepEqual(end('d1').art.map((r) => [r.k, r.v, r.rows]), [['db', 'write', 3]]);
    assert.deepEqual(end('r1').art.map((r) => [r.id, r.v, r.x]), [['build', 'delete', 'rm']]);
    assert.equal(end('e2').art, undefined, '실패한 Edit 은 끝 art 없음');
    // 웹 장부 = 서버 재구성
    const b = new ArtBook();
    for (const e of live) b.apply(e, 'p');
    const store = new ArtifactStore({ index, minRefreshMs: 0 });
    const pay = await store.payload({ sessionId: SID, untilMs: Date.now(), waitMs: 10_000 });
    const brief = (items) => items.map((x) => [x.id, x.cnt.create, x.cnt.modify, x.cnt.write, x.cnt.delete, x.sz, x.del]).sort();
    assert.deepEqual(brief(pay.items), brief(b.items('p')));
  } finally {
    if (prevTmp == null) delete process.env.CCVIZ_CLAUDE_TMP; else process.env.CCVIZ_CLAUDE_TMP = prevTmp;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});

test('데모: 작업 대상 시나리오가 실제 추출기로 생성·수정·삭제·DB 쓰기·push·파괴적 작업을 낸다', async () => {
  const { ART_DEMO } = await import('../art-demo.mjs');
  const kinds = new Set(), verbs = new Set(), xs = new Set();
  for (const [name, input, res] of ART_DEMO) {
    const a = artStart(name, input, { cwd: 'D:/demo', root: 'D:/demo' });
    const e = artEnd(a, { ok: true, tur: res.tur || null }) || [];
    for (const r of e) { kinds.add(r.k); verbs.add(r.v); if (r.x) xs.add(r.x); }
  }
  for (const k of ['file', 'output', 'repo', 'db', 'remote', 'service']) assert.ok(kinds.has(k), k);
  for (const v of ['create', 'modify', 'delete', 'write', 'push', 'read']) assert.ok(verbs.has(v), v);
  for (const x of ['rm', 'drop', 'force', 'overwrite']) assert.ok(xs.has(x), x);
});

test('서비스 스크립트 매핑: 기본 없음, config.serviceScripts 로 사용자가 넣음(잘못된 정규식은 건너뜀)', () => {
  assert.deepEqual(shellServices('node tools/acme-cli.mjs send --to x'), []);
  assert.equal(setServiceScripts([{ pattern: String.raw`acme-[\w-]*\.mjs`, name: 'Acme' }, { pattern: '(', name: 'bad' }, { name: 'no pattern' }]), 1);
  try {
    assert.deepEqual(shellServices('node tools/acme-cli.mjs send --to x').map((s) => [s.name, s.w]), [['Acme', true]]);
    assert.deepEqual(shellServices('python tools/acme-report.mjs list').map((s) => [s.name, s.w]), [['Acme', false]]);
  } finally { setServiceScripts([]); }
});
