import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  toolCategory, summarizeToolInput, detectClaudeP, parseTaskNotification, extractSessionIds,
  encodeCwd, normPath, extractOutputPath, truncate,
} from '../parse.mjs';
import { redact } from '../redact.mjs';
import { FileTail } from '../tail.mjs';
import { Graph } from '../graph.mjs';
import { checkAuth, parseCookies } from '../auth.mjs';

test('toolCategory: 14종 카테고리', () => {
  const cases = {
    Bash: 'shell', PowerShell: 'shell', Read: 'read', Write: 'write', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
    Grep: 'search', Glob: 'search', ToolSearch: 'search', Agent: 'agent', SendMessage: 'agent', Workflow: 'workflow',
    Skill: 'skill', WebFetch: 'web', WebSearch: 'web', Monitor: 'monitor', TaskStop: 'monitor', CronCreate: 'monitor',
    mcp__x__y: 'mcp', Artifact: 'artifact', ArtifactData: 'artifact', PushNotification: 'notify', SendUserFile: 'notify',
    StructuredOutput: 'other', '': 'other',
  };
  for (const [k, v] of Object.entries(cases)) assert.equal(toolCategory(k), v, k);
});

test('summarizeToolInput 규칙', () => {
  assert.equal(summarizeToolInput('Bash', { command: 'ls -la', description: '목록' }), '목록');
  assert.equal(summarizeToolInput('Bash', { command: 'x'.repeat(300) }).length, 120);
  assert.equal(summarizeToolInput('Read', { file_path: 'D:\\a\\b\\c.txt' }), 'c.txt');
  assert.equal(summarizeToolInput('Grep', { pattern: 'foo.*' }), 'foo.*');
  assert.equal(summarizeToolInput('WebFetch', { url: 'https://example.com/x?y' }), 'example.com');
  assert.equal(summarizeToolInput('mcp__server__do_it', {}), 'server.do_it');
  assert.equal(summarizeToolInput('Skill', { skill: 'pdf' }), 'pdf');
  assert.ok(summarizeToolInput('Unknown', { a: 1 }).startsWith('{"a":1}'));
});

test('detectClaudeP: 감지·힌트', () => {
  const sid = '0a1b2c3d-1111-4222-8333-444455556666';
  const d = detectClaudeP(`cd /c/x && claude -p "say hi" --session-id ${sid} --output-format json`);
  assert.ok(d);
  assert.equal(d.sessionIdHint, sid);
  assert.equal(d.promptHint, 'say hi');
  assert.equal(d.cdGuess, '/c/x');
  assert.ok(detectClaudeP('claude.exe --print "hi"'));
  assert.ok(detectClaudeP('timeout 60 claude -p hi'));
  assert.ok(detectClaudeP('echo x | claude --model opus -p "q"'));
  assert.equal(detectClaudeP('claude --help'), null);
  assert.equal(detectClaudeP('npm run claude-p'), null);
  assert.equal(detectClaudeP('myclaude -p x'), null);
});

test('parseTaskNotification: 엔티티 디코드', () => {
  const n = parseTaskNotification('<task-notification>\n<task-id>b1</task-id>\n<output-file>C:\\t\\b1.output</output-file>\n<status>completed</status>\n<summary>A &quot;B&quot; &lt;c&gt; &amp; d</summary>\n</task-notification>');
  assert.equal(n.taskId, 'b1');
  assert.equal(n.status, 'completed');
  assert.equal(n.summary, 'A "B" <c> & d');
  assert.equal(n.outputFile, 'C:\\t\\b1.output');
  assert.equal(n.event, null);
});

test('기타 파서', () => {
  assert.deepEqual(extractSessionIds('{"session_id":"0A1B2C3D-1111-4222-8333-444455556666"}'), ['0a1b2c3d-1111-4222-8333-444455556666']);
  assert.equal(encodeCwd('D:\\work\\Projects\\2026'), 'D--work-Projects-2026');
  assert.equal(encodeCwd('D:\\DEV_REPOS\\demo_api'), 'D--DEV-REPOS-demo-api');
  assert.equal(normPath('/c/Users/X/'), 'c:/users/x');
  assert.equal(normPath('C:\\Users\\X'), 'c:/users/x');
  assert.equal(extractOutputPath('... Output is being written to: C:\\a\\tasks\\b1.output. You will'), 'C:\\a\\tasks\\b1.output');
  assert.equal(truncate('abcdef', 4), 'abc…');
});

test('redact: 비밀 패턴', () => {
  const s = redact('key sk-ant-api03-abcdefghijklmno, Bearer abcdefghijklmnopqrstu, password=hunter2, "token": "zzz", ghp_abcdefghijklmnopqrstuvwxyz12, AKIAABCDEFGHIJKLMNOP'); // gitleaks:allow (시험용 가짜 값)
  assert.ok(!s.includes('abcdefghijklmno,'), s);
  assert.ok(!s.includes('hunter2'), s);
  assert.ok(!s.includes('zzz'), s);
  assert.ok(!s.includes('ghp_abcdefghijklmnop'), s);
  assert.ok(!s.includes('AKIAABCDEFGHIJKLMNOP'), s); // gitleaks:allow
  assert.ok(s.includes('password=***'), s);
  const long = 'Xy9' + 'aB3'.repeat(15);
  assert.equal(redact(`t ${long} t`), 't *** t');
  assert.equal(redact('a'.repeat(10) + 'f0'.repeat(25)), '***');
  // 경로·uuid 는 유지
  const p = 'C--Users-dev-AppData-Local-Temp-claude-D--work-Projects-2026';
  assert.equal(redact(p), p);
  assert.equal(redact('6e1d8a42-c7f3-4b95-8a20-d4c6b1e9f507'), '6e1d8a42-c7f3-4b95-8a20-d4c6b1e9f507');
  assert.equal(redact('https://x.dev/?t=abc&y=1'), 'https://x.dev/?t=***&y=1');
});

test('redact: 검증에서 새던 형식(URI 자격증명·한글 키워드·따옴표 값·Slack·Google·JWT·주민번호)', () => {
  const eq = (a, b) => assert.equal(redact(a), b);
  eq('mongodb://app_rw:MyP4ss@host:27017/db', 'mongodb://app_rw:***@host:27017/db');
  eq('비밀번호: Abc!2345', '비밀번호: ***');
  eq('앱 비밀번호는 abcd efgh ijkl mnop', '앱 비밀번호는 ***');
  eq('비밀번호를 변경했습니다', '비밀번호를 변경했습니다');
  eq('"password":"P@ss w0rd!"', '"password":"***"');
  eq('xoxb-1234567890-abcdefghij', 'xox*-***');
  eq('AIzaSyA1234567890abcdefghijklmnopqrstuv', 'AIza***'); // gitleaks:allow
  eq('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', 'eyJ***'); // gitleaks:allow
  eq('900101-1234567', '******-*******');
  eq('010-1234-5678', '010-****-****');
  eq('alice.dev@gmail.com', '***@gmail.com');
  eq('https://cc-agent-viz.example.workers.dev/_health', 'https://cc-agent-viz.example.workers.dev/_health');
});

test('FileTail: 부분 줄·api-request 건너뛰기·truncate', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-tail-'));
  const f = path.join(dir, 'a.jsonl');
  fs.writeFileSync(f, '{"type":"a","n":1}\n{"type":"api-request-blob","x":"' + 'z'.repeat(3 << 20) + '"}\n{"type":"b"');
  const got = [];
  const t = new FileTail(f, { onLine: (o, info) => got.push([o.type, info.backlog]) });
  await t.drain();
  assert.deepEqual(got, [['a', true]]);
  fs.appendFileSync(f, ',"n":2}\n한글{깨진줄\n{"type":"c","s":"한글"}\r\n');
  await t.poll();
  assert.deepEqual(got.map((x) => x[0]), ['a', 'b', 'c']);
  assert.equal(got[1][1], false);
  fs.writeFileSync(f, '{"type":"d"}\n'); // 크기 감소 → 처음부터
  await t.poll();
  assert.equal(got.at(-1)[0], 'd');
  // text 모드: UTF-8 경계
  const g = path.join(dir, 'b.output');
  const buf = Buffer.from('가나다');
  fs.writeFileSync(g, buf.subarray(0, 4));
  let txt = '';
  const t2 = new FileTail(g, { mode: 'text', onText: (s) => { txt += s; } });
  await t2.poll();
  fs.appendFileSync(g, buf.subarray(4));
  await t2.poll();
  assert.equal(txt, '가나다');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Graph: seq 단조·since·redepth·privacy', () => {
  const g = new Graph({ rootSessionId: 'r' });
  g.addNode({ id: 's:r', kind: 'main', label: 'm' });
  g.addNode({ id: 'a:1', parentId: 's:r', kind: 'subagent', label: 'x' });
  g.addNode({ id: 'a:2', parentId: 's:r', kind: 'subagent', label: 'y' });
  g.finishLoad();
  const seen = [];
  g.subscribe((e) => seen.push(e));
  const e1 = g.emit({ type: 'text', nodeId: 'a:1', role: 'assistant', text: 'x'.repeat(1000) });
  assert.equal(e1.text.length, 400);
  g.updateNode('a:2', { parentId: 'a:1' });
  assert.equal(g.get('a:2').depth, 2);
  assert.ok(seen.every((e, i) => i === 0 || e.seq > seen[i - 1].seq));
  assert.deepEqual(g.eventsSince(e1.seq).map((e) => e.seq), seen.slice(1).map((e) => e.seq));
  assert.equal(g.eventsSince(g.lastSeq + 5), null);
  const m = new Graph({ rootSessionId: 'r', privacy: 'minimal' });
  m.addNode({ id: 's:r', kind: 'main' });
  assert.equal(m.emit({ type: 'tool-start', nodeId: 's:r', tool: 'Bash', text: 'rm -rf' }).text, '');
});

test('auth: 쿼리→쿠키·302, 쿠키, 헤더, 실패', () => {
  const tok = 'T'.repeat(43);
  const mk = (u, headers = {}) => [{ method: 'GET', headers: { host: '127.0.0.1:7788', ...headers } }, new URL(u, 'http://127.0.0.1')];
  let r = checkAuth(...mk(`/?t=${tok}&session=abc`), tok);
  assert.ok(r.ok);
  assert.equal(r.redirect, '/?session=abc');
  assert.match(r.setCookie, /HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/);
  r = checkAuth(...mk(`/?t=${tok}`, { 'x-forwarded-proto': 'https' }), tok);
  assert.match(r.setCookie, /; Secure$/);
  r = checkAuth(...mk(`/state?t=${tok}`), tok);
  assert.ok(r.ok && !r.redirect);
  assert.ok(checkAuth(...mk('/', { cookie: `a=b; ccviz_t=${tok}` }), tok).ok);
  assert.ok(checkAuth(...mk('/', { 'x-ccviz-token': tok }), tok).ok);
  assert.ok(!checkAuth(...mk('/?t=wrong'), tok).ok);
  assert.ok(!checkAuth(...mk('/'), tok).ok);
  assert.deepEqual(parseCookies('a=1; b=%20x'), { a: '1', b: ' x' });
});

test('SessionIndex.ensureHead: 갓 생긴 세션의 불완전 head 는 파일이 자라면 다시 읽는다', async () => {
  const { SessionIndex } = await import('../discovery.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-head-'));
  const pdir = path.join(dir, 'projects', 'P'); fs.mkdirSync(pdir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'sessions'));
  const sid = '11111111-2222-4333-8444-555555555555';
  const file = path.join(pdir, `${sid}.jsonl`);
  fs.writeFileSync(file, JSON.stringify({ type: 'queue-operation', timestamp: '2026-10-23T00:00:00.000Z' }) + '\n');
  const idx = new SessionIndex({ projectsDir: path.join(dir, 'projects'), sessionsDir: path.join(dir, 'sessions') });
  await idx.refresh();
  assert.equal((await idx.ensureHead(idx.findSession(sid))).entrypoint, null);
  fs.appendFileSync(file, JSON.stringify({ type: 'user', entrypoint: 'sdk-cli', cwd: 'C:/x', timestamp: '2026-10-23T00:00:01.000Z', message: { content: 'hi' } }) + '\n');
  await idx.refresh();
  assert.equal((await idx.ensureHead(idx.findSession(sid))).entrypoint, 'sdk-cli');
  fs.rmSync(dir, { recursive: true, force: true });
});
