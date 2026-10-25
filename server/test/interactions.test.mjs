// 특별 상호작용 분류기. 명령·출력은 모두 합성(가짜 호스트·자격증명).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  classifyStart, classifyEnd, classifyCommand, outputProgress, parseTests, parseProgress, parseChecks, hostAlias, parseConnString,
  splitCommand, loopInfo, IxTracker, sanitizeIx, STREAK, FAN,
} from '../interactions.mjs';
import { Graph } from '../graph.mjs';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { buildReplay } from '../replay.mjs';

const B = (command, extra = {}) => classifyStart('Bash', { command, ...extra });
const pick = (ix, ...keys) => Object.fromEntries(keys.map((k) => [k, ix?.[k]]));

test('github: git·gh 동작 판정(로컬 읽기 명령·따옴표 안·커밋 메시지 heredoc 은 제외)', () => {
  assert.deepEqual(pick(B('git push origin main'), 'cat', 'op', 'remote', 'branch'), { cat: 'github', op: 'push', remote: 'origin', branch: 'main' });
  assert.equal(B('cd /d/x && git add -A && git commit -qm "x" && git push -q 2>&1 | tail -2').op, 'push', '여러 동작이면 push 가 대표');
  assert.equal(B('git -C ~/.claude push -q 2>&1').remote, undefined, '리다이렉션은 원격 이름이 아님');
  assert.equal(B('git pull --ff-only origin main').op, 'pull');
  assert.equal(B('git fetch -q && git log --oneline HEAD..origin/main').op, 'fetch');
  assert.deepEqual(pick(B('git clone -q https://github.com/someone/kipris_skill.git kipris'), 'op', 'repo'), { op: 'clone', repo: 'kipris_skill' });
  assert.equal(B('git rebase origin/main').op, 'rebase');
  assert.equal(B('git merge --no-ff feat').branch, 'feat');
  assert.equal(B('git tag v1.2.0').tag, 'v1.2.0');
  assert.equal(B('git tag -l'), null);
  for (const c of ['git status -sb', 'git log -5', 'git diff --stat', 'echo "git push"', 'grep -n "git push" a.md', 'git show HEAD']) assert.equal(B(c), null, c);
  const msg = B(`git commit -q -F - <<'EOF'\nnpm test 통과·ssh 수리\nEOF`);
  assert.equal(msg.op, 'commit', '커밋 메시지 본문의 npm test·ssh 는 명령이 아님');
  assert.equal(msg.also, undefined);
  assert.deepEqual(pick(B('gh pr create --title t --body b'), 'op'), { op: 'pr-create' });
  assert.deepEqual(pick(B('gh pr merge 42 --squash'), 'op', 'pr'), { op: 'pr-merge', pr: 42 });
  assert.equal(B('gh pr checks 42 --watch').op, 'pr-checks');
  assert.equal(B('gh run watch 123').op, 'run');
  assert.equal(B('gh api repos/o/r/commits/main --jq .sha').op, 'api');
  assert.equal(B('gh repo view o/r --json visibility').op, 'repo');
  assert.equal(B('gh auth token'), null, '비밀 다루는 gh 는 연출 안 함');
  assert.equal(classifyStart('mcp__github__create_pull_request', { title: 'x' }).op, 'pr-create');
  assert.equal(classifyStart('WebFetch', { url: 'https://github.com/o/r/pull/7' }).pr, 7);
});

test('github 결과: push 범위·새 브랜치·거부, pull 최신, PR 번호, CI 점등, 로컬 커밋 수 누적', () => {
  const t = new IxTracker();
  const c1 = t.onEnd(classifyEnd(B('git commit -m a'), { ok: true, stdout: '[main 1a2b3c4] a\n 2 files changed, 3 insertions(+)' }));
  assert.deepEqual(pick(c1, 'phase', 'ok', 'branch', 'files'), { phase: 'end', ok: true, branch: 'main', files: 2 });
  t.onEnd(classifyEnd(B('git commit -m b'), { ok: true, stdout: '[main 5d6e7f8] b' }));
  t.onEnd(classifyEnd(B('git commit -m c'), { ok: true, stdout: 'nothing to commit, working tree clean' }));
  const push = t.onEnd(classifyEnd(B('git push'), { ok: true, stderr: 'To github.com:me/cc-agent-viz.git\n   1a2b3c4..5d6e7f8  main -> main\n' }));
  assert.deepEqual(pick(push, 'commits', 'branch', 'repo', 'ok'), { commits: 2, branch: 'main', repo: 'cc-agent-viz', ok: true });
  const p2 = t.onEnd(classifyEnd(B('git add -A && git commit -m x && git push -u origin feat'), { ok: true, stderr: 'To github.com:me/r.git\n * [new branch]      feat -> feat\n' }));
  assert.deepEqual(pick(p2, 'commits', 'newBranch', 'branch'), { commits: 1, newBranch: 1, branch: 'feat' });
  const rej = classifyEnd(B('git push'), { ok: false, stderr: ' ! [rejected]        main -> main (fetch first)\n' });
  assert.equal(rej.ok, false);
  assert.equal(classifyEnd(B('git pull'), { ok: true, stdout: 'Already up to date.' }).upToDate, 1);
  assert.equal(classifyEnd(B('git pull'), { ok: true, stdout: 'Updating a..b\nFast-forward\n 3 files changed, 1 insertion(+)' }).files, 3);
  assert.equal(classifyEnd(B('git merge feat'), { ok: false, stdout: 'CONFLICT (content): Merge conflict in a.js\nCONFLICT (content): b.js' }).conflicts, 2);
  assert.equal(classifyEnd(B('gh pr create -t x -b y'), { ok: true, stdout: 'https://github.com/me/r/pull/57\n' }).pr, 57);
  const ci = classifyEnd(B('gh pr checks 57'), { ok: false, stdout: 'build\tpass\t1m2s\thttps://x\ntest\tfail\t40s\thttps://x\nlint\tpending\t0\thttps://x\nE2E\tpass\t3m\thttps://x' });
  assert.deepEqual(ci.ci, { pass: 2, fail: 1, pending: 1, skip: 0 });
  assert.deepEqual(parseChecks('✓ build in 1m\nX test in 30s\n* deploy'), { pass: 1, fail: 1, pending: 1, skip: 0 });
});

test('tests: 실행기 판정 + 출력 파싱(node·pytest·jest·vitest·cargo·go·dotnet·maven·mocha)', () => {
  for (const [c, r] of [['npm test', 'npm'], ['cd x && npm run test:unit 2>&1 | tail', 'npm'], ['node --test server/test', 'node'], ['C:/Python312/python.exe -m pytest -q tests', 'pytest'],
    ['npx jest --ci', 'jest'], ['pnpm vitest run', 'vitest'], ['go test ./...', 'go'], ['cargo test', 'cargo'], ['dotnet test', 'dotnet'], ['mvn -q test', 'maven'], ['./gradlew test', 'gradle'], ['uv run pytest', 'pytest']]) {
    const ix = B(c);
    assert.equal(ix?.cat, 'tests', c);
    assert.equal(ix.runner, r, c);
  }
  assert.equal(B('npm install'), null);
  assert.equal(B('cat test.log'), null);
  assert.deepEqual(parseTests('# tests 238\n# suites 12\n# pass 237\n# fail 1\n# skipped 0\n# todo 0\n# duration_ms 4521.3'), { runner: 'node', total: 238, pass: 237, fail: 1, skip: 0, suites: 12, ms: 4521 });
  assert.deepEqual(pick(parseTests('ℹ tests 9\nℹ pass 9\nℹ fail 0'), 'total', 'pass', 'fail'), { total: 9, pass: 9, fail: 0 });
  assert.deepEqual(pick(parseTests('ℹ pass 243\nℹ fail 0'), 'total', 'pass', 'fail'), { total: 243, pass: 243, fail: 0 }, 'grep 으로 tests 줄이 빠진 실측 꼴');
  assert.deepEqual(pick(parseTests('-- Docs: https://docs.pytest.org\n11304 passed, 10 skipped, 8 warnings in 358.63s (0:05:58)'), 'runner', 'pass', 'skip', 'fail'), { runner: 'pytest', pass: 11304, skip: 10, fail: 0 }, 'pytest -q 요약');
  assert.equal(parseTests('== 1 failed, 1 error in 0.1s ==').fail, 2);
  assert.equal(parseTests('\x1b[32m ✓\x1b[39m a\n      Tests  \x1b[1m\x1b[32m3 passed\x1b[39m\x1b[22m (3)').pass, 3, '색 코드 제거');
  assert.deepEqual(pick(parseTests('====== 120 passed, 2 failed, 3 skipped in 4.56s ======'), 'pass', 'fail', 'skip', 'ms'), { pass: 120, fail: 2, skip: 3, ms: 4560 });
  assert.deepEqual(pick(parseTests('Test Suites: 1 failed, 11 passed, 12 total\nTests:       1 failed, 237 passed, 238 total\nTime:        4.5 s'), 'pass', 'fail', 'total', 'suites', 'ms'), { pass: 237, fail: 1, total: 238, suites: 12, ms: 4500 });
  assert.deepEqual(pick(parseTests(' Test Files  2 passed (2)\n      Tests  1 failed | 10 passed (11)\n   Duration  1.23s'), 'runner', 'pass', 'fail', 'total'), { runner: 'vitest', pass: 10, fail: 1, total: 11 });
  assert.deepEqual(pick(parseTests('test result: ok. 12 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.01s\ntest result: FAILED. 3 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s'), 'pass', 'fail', 'skip', 'suites'), { pass: 15, fail: 1, skip: 1, suites: 2 });
  assert.deepEqual(pick(parseTests('--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.01s)\nFAIL\tex/pkg\t0.1s\nok  \tex/other\t0.02s'), 'pass', 'fail', 'suites'), { pass: 1, fail: 1, suites: 2 });
  assert.deepEqual(pick(parseTests('Passed!  - Failed:     0, Passed:    12, Skipped:     1, Total:    13, Duration: 1 s'), 'pass', 'skip', 'total'), { pass: 12, skip: 1, total: 13 });
  assert.deepEqual(pick(parseTests('[INFO] Tests run: 20, Failures: 1, Errors: 1, Skipped: 2'), 'pass', 'fail', 'skip'), { pass: 16, fail: 2, skip: 2 });
  assert.deepEqual(pick(parseTests('  12 passing (34ms)\n  1 failing'), 'pass', 'fail'), { pass: 12, fail: 1 });
  const end = classifyEnd(B('npm test'), { ok: false, stdout: '# tests 3\n# pass 2\n# fail 1' });
  assert.deepEqual(pick(end, 'phase', 'ok', 'pass', 'fail'), { phase: 'end', ok: false, pass: 2, fail: 1 });
});

test('tests 스트리밍: 백그라운드 출력 조각마다 점진 카운트 → 요약 줄이면 끝(줄 경계 보관)', () => {
  const start = B('node --test', { run_in_background: true });
  assert.equal(start.bg, 1);
  const acc = {};
  assert.equal(outputProgress(start, '✔ 하나 (1ms)\n✔ 둘', acc).pass, 1, '끝나지 않은 줄은 다음 조각으로');
  const p = outputProgress(start, ' (2ms)\n✖ 셋 (3ms)\n', acc);
  assert.deepEqual(pick(p, 'phase', 'pass', 'fail', 'partial'), { phase: 'progress', pass: 2, fail: 1, partial: 1 });
  const e = outputProgress(start, 'ℹ tests 3\nℹ pass 2\nℹ fail 1\n', acc);
  assert.deepEqual(pick(e, 'phase', 'ok', 'total', 'pass', 'fail'), { phase: 'end', ok: false, total: 3, pass: 2, fail: 1 });
  // pytest 진행률 [ 45%]
  const a2 = {};
  assert.equal(outputProgress(B('pytest'), 'tests/test_a.py ....F.                    [ 45%]\n', a2).pct, 45);
});

test('db: 셸 클라이언트·연결 문자열(값은 버림)·MCP·인라인 스크립트(약한 추정), 읽기/쓰기·행 수', () => {
  const m = B('mongosh "mongodb://user:pa55@db.example.net:27017/appdb?authSource=admin" --quiet --eval "db.cases.insertOne({a:1})"');
  assert.deepEqual(pick(m, 'cat', 'engine', 'db', 'rw'), { cat: 'db', engine: 'mongo', db: 'appdb', rw: 'w' });
  assert.ok(!JSON.stringify(m).includes('pa55') && !JSON.stringify(m).includes('example'), '자격증명·호스트 없음');
  assert.deepEqual(pick(B('psql -d survey -c "SELECT count(*) FROM resp"'), 'engine', 'db', 'rw'), { engine: 'postgres', db: 'survey', rw: 'r' });
  assert.deepEqual(pick(B('sqlite3 data/app.db ".tables"'), 'engine', 'db'), { engine: 'sqlite', db: 'app' });
  assert.equal(B('mongodump --db appdb --out bk').rw, 'r');
  assert.equal(B('mongorestore --nsInclude "appdb.*" bk').rw, 'w');
  assert.equal(B('redis-cli -n 2 SET k v').engine, 'redis');
  assert.equal(B('grep -v "mongodb://\\|mongodb+srv" a.log'), null, 'grep 패턴 안 스킴은 연결 아님');
  const w = B(`python - <<'EOF'\nfrom pymongo import MongoClient\nc = MongoClient(U)['appdb']['cases']\nprint(c.count_documents({}))\nEOF`);
  assert.deepEqual(pick(w, 'cat', 'engine', 'weak', 'rw'), { cat: 'db', engine: 'mongo', weak: 1, rw: 'r' });
  assert.equal(B(`cat > fix.py <<'EOF'\nfrom pymongo import MongoClient\nEOF`), null, '파일로 쓰는 heredoc 은 실행이 아님');
  assert.equal(B(`python - <<'EOF'\np='a.js'; s=open(p).read().replace('MongoClient', 'X')\nEOF`), null);
  const mcp = classifyStart('mcp__mongodb__find', { database: 'survey', collection: 'resp' });
  assert.deepEqual(pick(mcp, 'cat', 'op', 'rw', 'db'), { cat: 'db', op: 'mcp', rw: 'r', db: 'survey' });
  assert.equal(classifyStart('mcp__supabase__execute_sql', { query: 'DELETE FROM t' }).rw, 'w');
  assert.equal(classifyEnd(B('psql -c "select 1"'), { ok: true, stdout: ' x\n---\n 1\n(12 rows)' }).rows, 12);
  assert.equal(classifyEnd(B('mongosh --eval "db.a.updateMany({},{})"'), { ok: true, stdout: "{ acknowledged: true, matchedCount: 9, modifiedCount: 7 }" }).rows, 7);
  assert.equal(classifyEnd(B('mongosh --eval "db.a.countDocuments()"'), { ok: true, stdout: '4821\n', cmd: 'mongosh --eval "db.a.countDocuments()"' }).rows, 4821);
  assert.deepEqual(parseConnString('postgresql://u:p@h/db1'), { engine: 'postgres', db: 'db1' });
});

test('remote: ssh·터널·scp/rsync 방향·docker/kubectl exec·PowerShell 원격·adb, 별칭 가리기', () => {
  assert.deepEqual(pick(B('ssh devbox "mongosh --quiet --eval \\"db.x.find()\\""'), 'cat', 'op', 'host', 'also'), { cat: 'remote', op: 'ssh', host: 'devbox', also: ['db'] });
  assert.deepEqual(pick(B('timeout 90 ssh -o ConnectTimeout=15 nas "docker ps"'), 'op', 'host'), { op: 'ssh', host: 'nas' });
  assert.deepEqual(pick(B('ssh -N -L 27018:localhost:27017 devbox-db', { run_in_background: true }), 'op', 'host', 'bg'), { op: 'tunnel', host: 'devbox-db', bg: 1 });
  assert.equal(B('ssh admin@10.1.2.3 uptime').host.startsWith('ip-'), true, 'IP·계정은 해시');
  assert.equal(B('ssh deploy@build.example.org ls').host, 'build');
  assert.deepEqual(pick(B('scp -q dist.zip devbox:C:/Temp/'), 'op', 'transfer', 'host'), { op: 'scp', transfer: 'up', host: 'devbox' });
  assert.deepEqual(pick(B("scp -q 'devbox:C:/ProgramData/x.err' ./x.err"), 'transfer'), { transfer: 'down' });
  assert.equal(B('rsync -av ./a/ ./b/'), null, '로컬 rsync 는 원격 아님');
  assert.equal(B('rsync -az dist/ nas:/srv/www/').transfer, 'up');
  assert.equal(B('docker exec -it app-engine1 env').op, 'exec');
  assert.equal(B('kubectl exec pod/x -- ls').host, 'k8s');
  assert.equal(classifyStart('PowerShell', { command: 'Invoke-Command -ComputerName WINSRV01 -ScriptBlock { hostname }' }).op, 'psremote');
  assert.equal(classifyStart('PowerShell', { command: 'Enter-PSSession -ComputerName box1' }).host, 'box1');
  assert.equal(B('adb devices'), null);
  assert.equal(B('adb push a.apk /sdcard/').transfer, 'up');
  assert.equal(B(`ssh devbox <<'EOF'\ncd /srv/app && git pull\nEOF`).also[0], 'github', 'heredoc 으로 넘긴 원격 명령');
  const r = classifyEnd(B('rsync -az dist/ nas:/srv/'), { ok: true, stdout: 'sent 1,234,567 bytes  received 890 bytes  1.2M bytes/sec\ntotal size is 9,876,543' });
  assert.deepEqual(pick(r, 'bytes', 'size'), { bytes: 1235457, size: 9876543 });
  assert.equal(classifyEnd(B('ssh nas ls'), { ok: false, stderr: 'ssh: connect to host nas port 22: Connection refused' }).ok, false);
  assert.equal(hostAlias('root@[::1]'), 'localhost');
});

test('batch: 루프 총량 추정·xargs/parallel·진행률·연속 호출·동시 분기·워크플로', () => {
  assert.deepEqual(pick(B('for i in $(seq 1 50); do curl -s x/$i; done'), 'cat', 'op', 'n'), { cat: 'batch', op: 'loop', n: 50 });
  assert.equal(B('for f in {1..120}; do echo $f; done').n, 120);
  assert.equal(B('for f in a b; do echo $f; done'), null, '명시 목록 5개 미만은 아님');
  assert.equal(B('for f in *.png; do convert "$f" x; done').n, undefined, '총량 모름');
  assert.equal(classifyStart('PowerShell', { command: '1..40 | ForEach-Object { Get-Item $_ }' }).n, 40);
  assert.deepEqual(pick(classifyStart('PowerShell', { command: '$files | ForEach-Object -Parallel { x $_ } -ThrottleLimit 6' }), 'op', 'par'), { op: 'parallel', par: 6 });
  assert.deepEqual(pick(B('ls *.txt | xargs -P 8 -n1 gzip'), 'op', 'par'), { op: 'xargs', par: 8 });
  assert.equal(B('ls | xargs -n1 echo'), null, '병렬 아닌 xargs 는 아님');
  const lp = B('for i in $(seq 1 50); do npm test; done');
  assert.deepEqual(pick(lp, 'cat', 'loop', 'also'), { cat: 'tests', loop: 50, also: ['batch'] }, '루프 안 테스트는 tests + 반복 표시');
  assert.deepEqual(parseProgress('[12/100] done\n[13/100] done'), { i: 13, n: 100 });
  assert.deepEqual(parseProgress(' 45%|████▌     | 45/100 [00:03<00:04]'), { i: 45, n: 100 });
  assert.equal(parseProgress('2026/10/24 12:00 started'), null, '날짜는 진행이 아님');
  // 분류 안 된 백그라운드 명령: i/N(N≥5) 줄만 batch 진행
  assert.deepEqual(pick(outputProgress(null, 'processing 3/40 files\n', {}), 'cat', 'op', 'i', 'n'), { cat: 'batch', op: 'progress', i: 3, n: 40 });
  assert.equal(outputProgress(null, 'GET / 200 12ms\n', {}), null);
  // 같은 도구 연속(8초 안 12회)·동시 분기(20초 안 Agent 4개)
  const t = new IxTracker();
  let last = null;
  for (let k = 0; k < STREAK.MIN; k++) last = t.onStart('n', 'Edit', 1000 + k * 500, null);
  assert.deepEqual(pick(last, 'cat', 'op', 'i', 'tool'), { cat: 'batch', op: 'streak', i: STREAK.MIN, tool: 'Edit' });
  assert.equal(t.onStart('n', 'Read', 9000, null), null, '다른 도구면 끊김');
  let fan = null;
  for (let k = 0; k < FAN.MIN; k++) fan = t.onStart('m', 'Agent', 1000 + k * 100, null);
  assert.deepEqual(pick(fan, 'op', 'i'), { op: 'fan', i: FAN.MIN });
  assert.equal(classifyStart('Workflow', {}).op, 'workflow');
  assert.equal(t.onStart('n', 'Bash', 1, { v: 1, cat: 'github', op: 'push' }).cat, 'github', '범주 있는 호출은 그대로');
});

test('명령 쪼개기·마스킹: 리다이렉션·감싼 셸·환경 변수 앞붙이·minimal', () => {
  const { cmds } = splitCommand('FOO=1 sudo -E node --test 2>&1 > out.log | tee x');
  assert.deepEqual(cmds.map((c) => c.prog), ['node', 'tee']);
  assert.equal(B('bash -lc "cd /srv && npm test"').cat, 'tests');
  assert.equal(classifyStart('PowerShell', { command: 'powershell -NoProfile -Command "git push origin main"' }).op, 'push');
  assert.deepEqual(loopInfo('while true; do sleep 1; done'), { op: 'loop', n: null, par: null });
  const s = sanitizeIx({ v: 1, cat: 'github', op: 'push', branch: 'main', remote: 'https://user:ghp_abcdefghijklmnopqrstuvwxyz0123@x', commits: 3.4, ok: true, junk: { a: 1 }, ref: 'toolu_1' });
  assert.deepEqual(s, { v: 1, cat: 'github', op: 'push', branch: 'main', commits: 3, ok: true, ref: 'toolu_1' }, '가려진 값은 빼고 모르는 키 버림');
  assert.deepEqual(sanitizeIx({ cat: 'remote', op: 'ssh', host: 'devbox', bytes: 10 }, 'minimal'), { v: 1, cat: 'remote', op: 'ssh', bytes: 10 }, 'minimal 은 이름 없이 수만');
  assert.equal(sanitizeIx({ cat: 'nope' }), null);
  const g = new Graph({ rootSessionId: 'x', privacy: 'summary' });
  const ev = g.emit({ type: 'tool-start', nodeId: 's:x', ix: { v: 1, cat: 'db', op: 'query', engine: 'mongo', db: 'appdb', rw: 'r', phase: 'start' } });
  assert.equal(ev.ix.db, 'appdb');
});

test('라이브·재생 같은 ix: push 커밋 수·백그라운드 테스트 스트리밍·ssh·db (합성 transcript)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-ix-'));
  const prevTmp = process.env.CCVIZ_CLAUDE_TMP;
  try {
    const cwd = 'D:\\work\\ixp';
    const enc = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
    const SID = 'dddddddd-4444-4444-8444-dddddddddddd';
    const projects = path.join(root, 'projects'), sessions = path.join(root, 'sessions'), tmpClaude = path.join(root, 'tmp', 'claude');
    const proj = path.join(projects, enc(cwd));
    const tasks = path.join(tmpClaude, enc(cwd), SID, 'tasks');
    for (const d of [proj, sessions, tasks]) fs.mkdirSync(d, { recursive: true });
    process.env.CCVIZ_CLAUDE_TMP = tmpClaude;
    const P = Date.now() - 3 * 86400_000, T = (s) => new Date(P + s * 1000).toISOString();
    const base = { sessionId: SID, cwd, version: '2.1.309', entrypoint: 'cli' };
    const A = (s, id, name, input) => ({ type: 'assistant', timestamp: T(s), ...base, message: { model: 'claude-test-1', role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
    const R = (s, id, content, tur, err = false) => ({ type: 'user', timestamp: T(s), ...base, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: err }] }, toolUseResult: tur });
    const out = path.join(tasks, 'tbg01.output');
    fs.writeFileSync(out, '✔ a (1ms)\n✔ b (1ms)\n✖ c (2ms)\nℹ tests 3\nℹ pass 2\nℹ fail 1\n');
    const recs = [
      { type: 'user', timestamp: T(0), ...base, origin: { kind: 'human' }, promptSource: 'user', message: { role: 'user', content: '상호작용 시험' } },
      A(1, 'tu_c1', 'Bash', { command: 'git commit -m one' }), R(2, 'tu_c1', 'ok', { stdout: '[main 1111111] one\n 1 file changed', stderr: '' }),
      A(3, 'tu_c2', 'Bash', { command: 'git commit -m two' }), R(4, 'tu_c2', 'ok', { stdout: '[main 2222222] two', stderr: '' }),
      A(5, 'tu_p', 'Bash', { command: 'git push origin main' }), R(8, 'tu_p', 'ok', { stdout: '', stderr: 'To github.com:me/ixp.git\n   1111111..2222222  main -> main' }),
      A(10, 'tu_t', 'Bash', { command: 'node --test', run_in_background: true }),
      R(11, 'tu_t', `Command running in background with ID: tbg01. Output is being written to: ${out}`, { stdout: '', stderr: '', backgroundTaskId: 'tbg01' }),
      A(12, 'tu_s', 'Bash', { command: 'ssh devbox "mongosh --quiet --eval \\"db.a.countDocuments()\\""' }), R(14, 'tu_s', '42', { stdout: '42\n', stderr: '' }),
      A(15, 'tu_d', 'Bash', { command: 'psql -d survey -c "select * from t"' }), R(16, 'tu_d', 'x', { stdout: ' a\n---\n(3 rows)', stderr: '' }),
      { type: 'user', timestamp: T(30), ...base, origin: { kind: 'task-notification' }, message: { role: 'user', content: `<task-notification>\n<task-id>tbg01</task-id>\n<output-file>${out}</output-file>\n<status>failed</status>\n<summary>Background command "node --test" failed with exit code 1</summary>\n</task-notification>` } },
      { type: 'system', subtype: 'turn_duration', durationMs: 1000, timestamp: T(40), ...base },
    ];
    fs.writeFileSync(path.join(proj, `${SID}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const old = (P + 60_000) / 1000;
    for (const f of [path.join(proj, `${SID}.jsonl`), out]) fs.utimesSync(f, old, old);
    const index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
    await index.refresh();
    for (const e of index.entries.values()) e.birthtimeMs = e.mtimeMs;
    const rt = new RootRuntime({ sessionId: SID, index });
    await rt.start();
    rt.close();
    const live = rt.graph.ring;
    const data = await buildReplay({ sessionId: SID, index });
    const rep = data.events.map((x) => x.e || x);
    const sig = (evs) => evs.filter((e) => e.ix && e.type !== 'output').map((e) => JSON.stringify([e.type, e.toolUseId, e.ix])).sort();
    assert.deepEqual(sig(rep), sig(live), 'tool-start·tool-end ix 가 두 경로에서 같다');
    for (const evs of [live, rep]) {
      const push = evs.find((e) => e.type === 'tool-end' && e.toolUseId === 'tu_p').ix;
      assert.deepEqual(pick(push, 'cat', 'op', 'commits', 'branch', 'repo', 'ok'), { cat: 'github', op: 'push', commits: 2, branch: 'main', repo: 'ixp', ok: true });
      const t0 = evs.find((e) => e.type === 'tool-end' && e.toolUseId === 'tu_t').ix;
      assert.deepEqual(pick(t0, 'cat', 'phase', 'bg'), { cat: 'tests', phase: 'progress', bg: 1 });
      const outs = evs.filter((e) => e.type === 'output' && e.ix);
      const fin = outs.at(-1).ix;
      assert.deepEqual(pick(fin, 'cat', 'phase', 'pass', 'fail', 'total', 'ok', 'ref'), { cat: 'tests', phase: 'end', pass: 2, fail: 1, total: 3, ok: false, ref: 'tu_t' });
      const ssh = evs.find((e) => e.type === 'tool-start' && e.toolUseId === 'tu_s').ix;
      assert.deepEqual(pick(ssh, 'cat', 'host', 'also'), { cat: 'remote', host: 'devbox', also: ['db'] });
      assert.equal(evs.find((e) => e.type === 'tool-end' && e.toolUseId === 'tu_d').ix.rows, 3);
    }
    // minimal: 이름은 빠지고 수·범주만
    const dm = await buildReplay({ sessionId: SID, index, privacy: 'minimal' });
    const mp = dm.events.map((x) => x.e || x).find((e) => e.type === 'tool-end' && e.toolUseId === 'tu_p').ix;
    assert.deepEqual(pick(mp, 'cat', 'commits', 'branch', 'repo'), { cat: 'github', commits: 2, branch: undefined, repo: undefined });
  } finally {
    if (prevTmp == null) delete process.env.CCVIZ_CLAUDE_TMP; else process.env.CCVIZ_CLAUDE_TMP = prevTmp;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});

test('user(§68.9): 진짜 사용자 메시지 vs 자동 알림·주입, 끼어듦·명령·인터럽트·질문·거부', async () => {
  const { classifyUserMessage, USER_DENY_RE } = await import('../interactions.mjs');
  const C = (raw, o) => classifyUserMessage(raw, o);
  assert.deepEqual(pick(C('패널 글자 키워 줘', { origin: 'human', waitMs: 9000 }), 'op', 'text', 'waitMs'), { op: 'prompt', text: '패널 글자 키워 줘', waitMs: 9000 });
  assert.equal(C('이것도 봐 줘', { origin: 'human', turnOpen: true }).op, 'midturn');
  assert.equal(C('x', { origin: 'human', queued: true }).op, 'midturn');
  assert.deepEqual(pick(C('<command-message>done</command-message>\n<command-name>/done</command-name>', { origin: 'human' }), 'op', 'cmd'), { op: 'command', cmd: '/done' });
  assert.equal(C('[Request interrupted by user for tool use]', { origin: 'human' }).op, 'interrupt');
  assert.deepEqual(pick(C('<task-notification><task-id>b1</task-id></task-notification>', { origin: 'human' }), 'op', 'src'), { op: 'auto', src: 'notify' });
  assert.equal(C('자율 사이클이다', { origin: 'system' }).src, 'system', 'claude -p·서브에이전트 지시는 사람이 아님');
  assert.equal(C('<local-command-stdout>ok</local-command-stdout>', { origin: 'human' }).op, 'auto');
  assert.equal(C('This session is being continued from a previous conversation that ran out', { origin: 'human' }).src, 'compact');
  assert.equal(C('그림 봐 줘 [이미지]', { origin: 'human', images: 1 }).images, 2 - 1 + 1);
  assert.ok(USER_DENY_RE.test("The user doesn't want to proceed with this tool use. The tool use was rejected"));
  const ask = classifyStart('AskUserQuestion', { questions: [{ question: '배치를 어느 쪽으로?', options: [{ label: '세로' }, { label: '가로' }, { label: '격자' }] }] });
  assert.deepEqual(pick(ask, 'cat', 'op', 'opts', 'text'), { cat: 'user', op: 'ask', opts: 3, text: '배치를 어느 쪽으로?' });
  const ans = classifyEnd(ask, { ok: true, tur: { answers: { '배치를 어느 쪽으로?': '가로' } } });
  assert.deepEqual(pick(ans, 'pick', 'answer', 'ok'), { pick: 1, answer: '가로', ok: true });
  assert.equal(sanitizeIx(ask)._opts, undefined, '선택지 원문은 이벤트에 안 실림');
  assert.equal(classifyEnd(ask, { ok: true, body: 'User has answered your questions: "배치를 어느 쪽으로?"="격자".' }).pick, 2);
});
