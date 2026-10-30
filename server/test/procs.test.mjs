// 분리 프로세스 · 진행 레인 · 들여다보기: 명령 판정 · 끝 표지 · 진행 줄 자동 인식 · 장부 · 라이브/재생 e2e (합성 transcript)
// 로그 줄 일부는 실제 자율 루프 사례의 run.log 모양을 그대로 옮긴 것(값만, 경로·비밀 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  detectProcLaunch, commandPathRefs, isWaitCommand, endSignal, scanEnd, adaptiveStaleSec, quietEndSec, killTargets, pidHintOf, splitTop, normFile, PROC,
} from '../procs.mjs';
import { parseProgressLine, ProgressLanes, laneKey } from '../progress.mjs';
import { JobBook, JOB } from '../jobs.mjs';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { buildReplay, lineTimer } from '../replay.mjs';

// 실제 사례의 띄운 명령(서브에이전트 포그라운드 Bash) — 경로만 바꿈
const REAL_LAUNCH = (base) => `cd ${base}/branches && rm -rf trial && mkdir -p run1 && cd co && (PYTHONUTF8=1 PYTHONPATH=. APP_ENV=development nohup ../../venv/Scripts/python.exe -u ../probe_branches.py --co . --cases ../cases.jsonl --out ../run1 --tag head > ../run1/run.log 2>&1; echo "EXIT $?" >> ../run1/run.log) > /dev/null 2>&1 &\nsleep 2; date -u +%H:%M:%S; cat ../run1/run.log`;
const WAIT_CMD = (log) => `L=${log}; for i in $(seq 1 115); do grep -q "^EXIT" $L && break; sleep 5; done; date -u +%H:%M:%S; grep "^\\[_walk_pairs\\]" $L | tail -1`;

// 실제 run.log 모양: 첫 회차(빠름) → 집계 → 둘째 회차(두 레인 번갈아, 느려짐)
const RUN_LOG = [
  ...[2, 4, 6, 8, 10, 12, 14, 16].map((k) => `[iter_pairs] ${(k * 1000).toLocaleString('en-US')} 바퀴 · ${k < 4 ? 0 : 1}s · 최장 0.14s`),
  '══ 쌍 모집단 — 137,981쌍 · 16s',
  "   [statute] 계열 3,961(125,149쌍) · 판 층 행 있음 3,863(124,893쌍)",
  '[census] rc=0 wall=106.631s cmds=5285 lagmax=105.831',
  '[iter_pairs] 2,000 바퀴 · 277s · 최장 1.58s',
  '[_walk_pairs] 2,000 바퀴 · 290s · 최장 1.58s',
  '[iter_pairs] 4,000 바퀴 · 500s · 최장 1.69s',
  '[_walk_pairs] 4,000 바퀴 · 564s · 최장 2.48s',
  '[iter_pairs] 6,000 바퀴 · 762s · 최장 2.48s',
  '[_walk_pairs] 6,000 바퀴 · 816s · 최장 2.48s',
  '[iter_pairs] 8,000 바퀴 · 1005s · 최장 2.48s',
  '[_walk_pairs] 8,000 바퀴 · 1102s · 최장 2.48s',
  '[iter_pairs] 46,000 바퀴 · 5546s · 최장 4.32s',
  '[_walk_pairs] 42,000 바퀴 · 5587s · 최장 4.32s',
];

test('명령 판정: 실제 사례(괄호 묶음·cd 상대 경로) · 거르기 · PowerShell·cmd', () => {
  const base = 'D:/w/scratch';
  const r = detectProcLaunch(REAL_LAUNCH('/d/w/scratch'), { cwd: 'D:\\w' });
  assert.equal(r.length, 1);
  assert.equal(r[0].prog, 'python');
  assert.equal(r[0].script, 'probe_branches.py');
  assert.equal(r[0].via, 'nohup');
  assert.equal(normFile(r[0].log), normFile(`${base}/branches/run1/run.log`), 'cd co 뒤 ../run1/run.log');
  assert.equal(normFile(r[0].outDirs[0]), normFile(`${base}/branches/run1`), '--out 폴더');
  // 거르기: 짧은 & · GUI 열기 · 로그 없는 패키지 실행기 · claude · 묶음 안 sleep/echo
  for (const c of ['sleep 1 &', 'start chrome http://x', 'code . &', 'explorer.exe . &', 'npm run dev &', 'claude -p "hi" &', '(sleep 3; echo hi) &', 'tail -f x.log &', 'echo hi > a.txt &']) {
    assert.deepEqual(detectProcLaunch(c, { cwd: 'D:/x' }), [], c);
  }
  // 잡는 것
  const one = (c, o = {}) => detectProcLaunch(c, { cwd: 'D:/x', ...o })[0];
  assert.equal(one('npm run dev > dev.log 2>&1 &').prog, 'npm', '로그가 있으면 패키지 실행기도');
  assert.equal(one('nohup python -m pkg.train --epochs 3 &').script, '-m pkg.train');
  assert.equal(normFile(one('python x.py 2>&1 | tee out/run.log &').log), normFile('D:/x/out/run.log'));
  assert.equal(normFile(one('venv/Scripts/python.exe job.py &> logs/j.log &').log), normFile('D:/x/logs/j.log'));
  assert.equal(one('./build.sh > b.log & disown').script, 'build.sh');
  assert.equal(one('setsid node worker.mjs >> w.log 2>&1 < /dev/null &').via, 'setsid');
  assert.equal(detectProcLaunch('node server.mjs & sleep 1; curl localhost', { cwd: 'D:/x' }).length, 1, '& 뒤 다른 명령');
  const ps = (c) => detectProcLaunch(c, { tool: 'PowerShell', cwd: 'D:/w' });
  const sp = ps("Start-Process -FilePath python -ArgumentList '-u','train.py' -RedirectStandardOutput out.log -RedirectStandardError err.log -WindowStyle Hidden")[0];
  assert.deepEqual([sp.via, sp.script, sp.logs.map(normFile)], ['Start-Process', 'train.py', [normFile('D:/w/out.log'), normFile('D:/w/err.log')]]);
  const B = '\\';
  const sb = ps(`Start-Process -FilePath "C:${B}Program Files${B}Git${B}bin${B}bash.exe" -ArgumentList '-c','"cd /d/GIT/x && bash run.sh > run.out 2>&1 < /dev/null"' -WindowStyle Hidden`)[0];
  assert.equal(sb.script, 'run.sh', 'bash -c 안쪽 명령');
  assert.equal(normFile(sb.log), normFile('D:/GIT/x/run.out'));
  assert.deepEqual(ps('Start-Process chrome http://localhost:8080'), []);
  assert.equal(ps('Start-Job -ScriptBlock { python D:/x/a.py *> D:/x/a.log }')[0].via, 'Start-Job');
  assert.equal(one('start /b python serve.py > s.log').via, 'start /b');
  // 나누기: 괄호·따옴표 안은 그대로, 2>&1·&> 는 뒤로 보내기 아님
  assert.deepEqual(splitTop('a && (b; c) > /dev/null 2>&1 & d').map((u) => u.sep), ['&&', '&', null]);
});

test('들여다보기 경로·기다림 판정 · 끝 표지 · 적응 문턱 · 끄는 명령 · PID 힌트', () => {
  const log = '/d/w/scratch/branches/run1/run.log';
  assert.deepEqual(commandPathRefs(WAIT_CMD(log), { cwd: 'D:/w' }), [normFile('D:/w/scratch/branches/run1/run.log')], 'L=경로 대입');
  assert.ok(isWaitCommand(WAIT_CMD(log)));
  assert.ok(isWaitCommand('until [ -f out/done.json ]; do sleep 5; done'));
  assert.ok(!isWaitCommand(`cat ${log} | head -40`));
  assert.deepEqual(commandPathRefs('cd /d/w && cat run1/run.log | head', {}), [normFile('D:/w/run1/run.log')], 'cd 뒤 상대 경로');
  // 끝 표지
  assert.deepEqual(endSignal('EXIT 0'), { state: 'done', rc: 0, reason: 'exit' });
  assert.deepEqual(endSignal('EXIT 2'), { state: 'failed', rc: 2, reason: 'exit-code' });
  assert.equal(endSignal('rc=0').state, 'done');
  assert.equal(endSignal('EXIT 143').state, 'stopped', '신호 종료 코드');
  assert.equal(endSignal('Killed').state, 'stopped');
  assert.equal(endSignal('[census] rc=0 wall=1.2s'), null, '줄 안의 rc= 는 끝이 아님');
  const st = { trace: false, failAt: null, exc: null, end: null };
  scanEnd(st, 'Traceback (most recent call last):\n  File "x.py", line 3\nValueError: bad\n', '2026-10-26T01:00:00Z');
  assert.equal(st.failAt, '2026-10-26T01:00:00Z');
  scanEnd(st, '[iter_pairs] 2,000 바퀴\n', '2026-10-26T01:01:00Z');
  assert.equal(st.failAt, null, 'Traceback 뒤 다시 진행하면 풀림(잡힌 예외)');
  scanEnd(st, 'KeyboardInterrupt\n', 't');
  assert.equal(st.exc, 'KeyboardInterrupt');
  // 적응 정체 문턱: 줄 간격 중앙값 × 4, [120, 3600]
  assert.equal(adaptiveStaleSec([]), PROC.STALE_DEFAULT_SEC);
  assert.equal(adaptiveStaleSec([120, 130, 125]), 500);
  assert.equal(adaptiveStaleSec([1, 1, 2]), PROC.STALE_MIN_SEC);
  assert.equal(adaptiveStaleSec([5000]), PROC.STALE_MAX_SEC);
  assert.equal(quietEndSec(500), 6000);
  assert.equal(quietEndSec(100), 3600);
  // 끄는 명령
  const rec = { prog: 'python', script: 'probe_branches.py', pidHint: { pid: 40400, kind: 'msys' } };
  assert.ok(killTargets('pkill -f probe_branches', rec));
  assert.ok(killTargets('taskkill //IM python.exe //F', rec));
  assert.ok(killTargets('kill 40400', rec));
  assert.ok(!killTargets('taskkill //PID 1234 //F', { prog: 'node', script: 'srv.mjs' }));
  assert.deepEqual(pidHintOf('nohup python x.py & echo $!', '40400\n'), { pid: 40400, kind: 'msys' }, 'Git Bash $! = MSYS PID');
  assert.deepEqual(pidHintOf('$p = Start-Process python -PassThru; $p.Id', '51234\n', 'PowerShell'), { pid: 51234, kind: 'win' });
  assert.equal(pidHintOf('nohup python x.py &', '40400\n'), null);
});

test('진행 줄 모양 · 레인 인정(단조 증가 두 번) · 회차 · 과열', () => {
  const a = parseProgressLine('[_walk_pairs] 42,000 바퀴 · 5587s · 최장 4.32s');
  assert.deepEqual(a, { type: 'A', key: '_walk_pairs', n: 42000, total: null, unit: '바퀴', elapsed: 5587, extra: { k: '최장', v: 4.32, u: 's' } });
  assert.deepEqual(parseProgressLine('Epoch 3:  45%|████▌     | 45/100 [00:12<00:15,  3.61it/s]'), { type: 'B', key: 'Epoch', n: 45, total: 100, unit: null, elapsed: 12, extra: null });
  assert.equal(parseProgressLine('  12/40 · ok 24/24').n, 24, '한 줄에 여럿이면 마지막');
  assert.equal(parseProgressLine('download: 45% done').type, 'C');
  assert.deepEqual(parseProgressLine('processed: 1,200 rows'), { type: 'D', key: 'processed', n: 1200, total: null, unit: 'rows', elapsed: null, extra: null });
  for (const l of ['[census] rc=0 wall=106.631s', '08:49:45', '2026/10/26 a/b/c', '══ 쌍 모집단 — 137,981쌍', 'see a/1/2 here']) assert.equal(parseProgressLine(l), null, l);
  assert.equal(laneKey('worker-12'), 'worker-#');

  const L = new ProgressLanes();
  const t0 = Date.parse('2026-10-26T08:40:00Z');
  assert.equal(L.feedLine('[x] 1 items', t0), false);
  assert.equal(L.feedLine('[x] 1 items', t0 + 1000), false, '같은 값 반복은 무시');
  assert.equal(L.feedLine('[x] 2 items', t0 + 2000), false);
  assert.equal(L.summary(), null, '아직 증가 한 번');
  assert.equal(L.feedLine('[x] 3 items', t0 + 3000), true, '두 번 증가 → 인정');
  assert.equal(L.summary().lanes[0].rate, 0.667, '도착 시각 기준: 3초에 2');
  const L2 = new ProgressLanes();
  L2.feedLine('[y] 5', t0); L2.feedLine('[y] 6', t0 + 1); L2.feedLine('[y] 2', t0 + 2); L2.feedLine('[y] 3', t0 + 3);
  assert.equal(L2.summary(), null, '인정 전 감소는 후보를 새로');

  // 실제 run.log 모양 → 레인 2개, iter_pairs 는 둘째 회차(pass 2)에서 크게 느려져 과열 1, _walk_pairs 는 최장만 올라 낮게
  const R = new ProgressLanes();
  RUN_LOG.forEach((l, i) => R.feedLine(l, t0 + i * 1000));
  const s = R.summary();
  assert.deepEqual(s.lanes.map((x) => x.key), ['iter_pairs', '_walk_pairs']);
  const it = s.lanes[0], wk = s.lanes[1];
  assert.equal(it.pass, 2);
  assert.equal(it.n, 46000);
  assert.ok(it.rate > 5 && it.rate < 12, `둘째 회차 처리율(줄 안 경과 초 기준) ${it.rate}`);
  assert.equal(it.heat, 1, '처음 ~8000/s → 지금 ~8/s');
  assert.ok(wk.heat > 0.2 && wk.heat < 0.4, `walk 과열 = 최장 1.58→4.32 ${wk.heat}`);
  assert.deepEqual(wk.last, { k: '최장', v: 4.32, u: 's' });
  assert.equal(s.heat, 1);
  assert.equal(s.eta, null, 'total 이 없으면 ETA 없음');
  // total 이 있으면 ETA
  const E = new ProgressLanes();
  [10, 20, 30].forEach((v, i) => E.feedLine(`[smoke] ${v}/50 cases`, t0 + i * 10_000));
  const es = E.summary();
  assert.deepEqual(es.progress, { n: 30, total: 50 });
  assert.equal(es.eta, new Date(t0 + 20_000 + 20_000).toISOString(), '1/s 로 20 남음 → 20초 뒤');
});

test('장부: 자동 작업(progress) · 규약·규칙이 있는 스트림은 끔 · 솎기 · 끝', () => {
  const b = new JobBook({});
  const ts = (s) => new Date(Date.parse('2026-10-26T08:40:00Z') + s * 1000).toISOString();
  let ups = [];
  RUN_LOG.slice(0, 4).forEach((l, i) => { ups = ups.concat(b.feed('p', 'b:p', l + '\n', ts(i), { auto: true, autoTitle: '진행', staleSec: 300 })); });
  assert.equal(ups.length, 1, '세 번째 줄에서 인정 → 새 작업 하나, 넷째 줄은 2초 솎기');
  assert.equal(ups[0].jobId, JOB.AUTO_ID);
  assert.equal(ups[0].job.src, 'auto');
  assert.equal(ups[0].job.title, '진행');
  assert.equal(ups[0].job.staleSec, 300);
  assert.ok(b.autoJob('b:p')._dirty, '솎아 낸 값은 남겨 둠');
  assert.ok(b.flushAuto('b:p', ts(10)), 'sweep 이 솎아 낸 값을 냄');
  const end = b.endAuto('b:p', 'done', ts(20), 0);
  assert.deepEqual([end.job.state, end.job.rc, end.job.endedAt], ['done', 0, ts(20)]);
  assert.equal(b.endAuto('b:p', 'done', ts(21)), null, '이미 끝남');
  // 규약 줄이 보인 스트림은 자동 인식 끔
  const b2 = new JobBook({});
  b2.feed('q', 'b:q', '::agent4d {"id":"build","state":"running"}\n', ts(0), { auto: true });
  RUN_LOG.slice(0, 5).forEach((l, i) => b2.feed('q', 'b:q', l + '\n', ts(i + 1), { auto: true }));
  assert.equal(b2.autoJob('b:q'), null);
  // auto 를 안 켜면 그대로(동작 불변)
  const b3 = new JobBook({});
  RUN_LOG.slice(0, 5).forEach((l, i) => b3.feed('r', 'b:r', l + '\n', ts(i)));
  assert.equal(b3.autoJob('b:r'), null);
});

test('재생 줄 배분 시각: 들여다본 결과의 줄을 닻으로', () => {
  const lines = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'];
  const lin = lineTimer(lines, null, 0, 600);
  assert.equal(lin(3), 300);
  const t = lineTimer(lines, [{ line: 'a3', t: 10 }, { line: 'b2', t: 500 }], 0, 600);
  assert.equal(t(3), 10, '앞 셋은 10ms 까지');
  assert.equal(t(5), 500);
  assert.ok(t(4) > 10 && t(4) < 500);
  assert.equal(t(6), 600);
});

// ───────────── 라이브·재생 e2e ─────────────

const SID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-procs-e2e-'));
  const projects = path.join(root, 'projects'), sessions = path.join(root, 'sessions'), tmpClaude = path.join(root, 'tmp', 'claude');
  const cwd = path.join(root, 'repo');
  const scratch = path.join(cwd, 'scratch');
  const enc = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
  const proj = path.join(projects, enc(cwd));
  for (const d of [sessions, proj, path.join(scratch, 'branches', 'co'), path.join(scratch, 'branches', 'run1'), path.join(tmpClaude, enc(cwd), SID, 'tasks')]) fs.mkdirSync(d, { recursive: true });
  const fwd = (p) => p.replace(/\\/g, '/');
  const runLog = path.join(scratch, 'branches', 'run1', 'run.log');
  fs.writeFileSync(runLog, RUN_LOG.join('\n') + '\nEXIT 0\n');
  const badLog = path.join(cwd, 'logs', 'bad.log');
  fs.mkdirSync(path.dirname(badLog), { recursive: true });
  fs.writeFileSync(badLog, '[smoke] 10/50 cases\n[smoke] 20/50 cases\n[smoke] 30/50 cases\nTraceback (most recent call last):\n  File "smoke.py", line 88, in <module>\nKeyError: \'law_id\'\n');
  const P = Date.now() - 2 * 86400_000;
  const T = (sec) => new Date(P + sec * 1000).toISOString();
  const base = { sessionId: SID, cwd, version: '2.1.310', entrypoint: 'cli' };
  const A = (sec, block) => ({ type: 'assistant', timestamp: T(sec), ...base, message: { model: 'claude-test-1', role: 'assistant', content: [block] } });
  const TU = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const R = (sec, id, stdout, extra = {}) => ({ type: 'user', timestamp: T(sec), ...base, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: stdout, is_error: false }] }, toolUseResult: { stdout, stderr: '', interrupted: false, ...extra } });
  const log = fwd(runLog);
  const lines = [
    A(10, TU('toolu_launch', 'Bash', { command: REAL_LAUNCH(fwd(scratch)), description: 'Launch full probe detached with log' })),
    R(12, 'toolu_launch', '08:39:50\ncat: ../run1/run.log: No such file or directory'),
    A(20, TU('toolu_peek', 'Bash', { command: `cat ${log} | head -40`, description: 'Read run log' })),
    R(21, 'toolu_peek', RUN_LOG.slice(0, 8).join('\n')),
    A(30, TU('toolu_wait1', 'Bash', { command: WAIT_CMD(log), description: 'Wait and show walk progress', timeout: 600000 })),
    R(630, 'toolu_wait1', `08:59:15\n${RUN_LOG[12]}`),
    A(640, TU('toolu_mon', 'Monitor', { description: 'walk 감시', timeout_ms: 60000, command: `tail -f ${log} | grep --line-buffered _walk_pairs` })),
    R(641, 'toolu_mon', 'Monitor started (task pmon01)', { taskId: 'pmon01', timeoutMs: 60000, persistent: false }),
    A(1200, TU('toolu_wait2', 'Bash', { command: WAIT_CMD(log), description: 'Wait and show walk progress', timeout: 600000 })),
    R(1800, 'toolu_wait2', `09:09:12\n${RUN_LOG[RUN_LOG.length - 1]}\nEXIT 0`),
    // 짧게 실패하는 것 · 끄는 것 · 걸러지는 것
    A(1810, TU('toolu_bad', 'Bash', { command: 'nohup python smoke.py > logs/bad.log 2>&1 &', description: 'smoke' })),
    R(1811, 'toolu_bad', ''),
    A(1820, TU('toolu_slow', 'Bash', { command: 'nohup python slow_job.py --forever &', description: 'slow' })),
    R(1821, 'toolu_slow', ''),
    A(1830, TU('toolu_kill', 'Bash', { command: 'pkill -f slow_job', description: '끔' })),
    R(1831, 'toolu_kill', ''),
    A(1840, TU('toolu_sleep', 'Bash', { command: 'sleep 1 & echo hi' })),
    R(1841, 'toolu_sleep', 'hi'),
    { type: 'system', subtype: 'turn_duration', durationMs: 1000, timestamp: T(1850), ...base },
  ];
  fs.writeFileSync(path.join(proj, `${SID}.jsonl`), [{ type: 'user', timestamp: T(0), ...base, origin: { kind: 'human' }, message: { role: 'user', content: '탐침 돌려' } }, ...lines].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const old = (P + 1900_000) / 1000;
  for (const f of [path.join(proj, `${SID}.jsonl`), runLog, badLog]) fs.utimesSync(f, old, old);
  return { root, projects, sessions, tmpClaude, runLog, badLog, P, T };
}

function finalNodes(events) {
  const nodes = new Map();
  for (const x of events) {
    const e = x.e || x;
    if (e.type === 'node-add') nodes.set(e.nodeId, structuredClone(e.node));
    else if (e.type === 'node-update' && nodes.has(e.nodeId)) { const n = nodes.get(e.nodeId); const { meta, ...p } = e.patch; Object.assign(n, p); if (meta) Object.assign(n.meta, meta); }
  }
  return nodes;
}

test('라이브·재생: 분리 프로세스 노드 · 로그 꼬리 → 레인 2개·과열 · 들여다보기 · EXIT/Traceback/끄는 명령 · 거르기', async () => {
  const fx = makeFixture();
  const prevTmp = process.env.CCVIZ_CLAUDE_TMP;
  process.env.CCVIZ_CLAUDE_TMP = fx.tmpClaude;
  try {
    const index = new SessionIndex({ projectsDir: fx.projects, sessionsDir: fx.sessions });
    await index.refresh();
    for (const e of index.entries.values()) e.birthtimeMs = e.mtimeMs;
    const rt = new RootRuntime({ sessionId: SID, index, jobRules: null });
    await rt.start();
    await rt.pollAll({ all: true });
    rt.sweep();
    rt.close();
    const data = await buildReplay({ sessionId: SID, index, jobRules: null });
    const rep = finalNodes(data.events);
    const evs = data.events.map((x) => x.e || x);
    for (const [name, get, ring] of [['라이브', (id) => rt.graph.get(id), rt.graph.ring], ['재생', (id) => rep.get(id), evs]]) {
      const p = get('b:toolu_launch');
      assert.ok(p, `${name}: 프로세스 노드`);
      assert.equal(p.kind, 'bash-bg');
      assert.equal(p.parentId, `s:${SID}`, '띄운 노드 아래');
      assert.equal(p.label, '분리 실행 · probe_branches.py');
      assert.equal(p.meta.proc.prog, 'python');
      assert.equal(p.meta.proc.via, 'nohup');
      assert.equal(normFile(p.meta.proc.log), normFile(fx.runLog));
      assert.equal(p.status, 'done', `${name}: EXIT 0`);
      assert.deepEqual([p.meta.proc.endReason, p.meta.proc.rc], ['exit', 0]);
      assert.ok(!p.meta.launcher, '기동기 아님');
      const j = get('j:b:toolu_launch:progress');
      assert.ok(j, `${name}: 자동 진행 작업`);
      assert.equal(j.parentId, 'b:toolu_launch');
      assert.equal(j.meta.job.src, 'auto');
      assert.equal(j.meta.job.state, 'done');
      assert.deepEqual(j.meta.job.lanes.map((l) => [l.key, l.n, l.pass]), [['iter_pairs', 46000, 2], ['_walk_pairs', 42000, 1]], `${name}: 레인 2개`);
      assert.equal(j.meta.job.heat, 1, `${name}: 과열`);
      // 들여다보기: peek 1 · wait 2(포그라운드) · Monitor 1(백그라운드), 시작·끝 짝
      const w = ring.filter((e) => e.type === 'watch');
      const starts = w.filter((e) => e.phase === 'start');
      assert.deepEqual(starts.map((e) => `${e.kind}:${e.via}`).sort(), ['peek:shell', 'wait:monitor', 'wait:shell', 'wait:shell'], `${name}: watch 시작`);
      assert.equal(w.filter((e) => e.phase === 'end').length, 4, `${name}: watch 끝(Monitor 는 만료로 닫힘)`);
      assert.ok(starts.every((e) => e.peer === 'b:toolu_launch'));
      assert.ok(w.some((e) => e.phase === 'end' && e.toolUseId === 'toolu_wait1' && e.progress === true), '결과에 진행 줄');
      assert.equal(starts.find((e) => e.via === 'monitor').nodeId, 'm:pmon01', 'Monitor 노드가 읽는 쪽');
      assert.equal(p.meta.proc.watchCount, 4);
      // 짧게 실패 · 끔 · 걸러짐
      const bad = get('b:toolu_bad');
      assert.equal(bad.status, 'error', `${name}: Traceback → 실패`);
      assert.equal(bad.meta.proc.endReason, 'traceback');
      const slow = get('b:toolu_slow');
      assert.equal(slow.status, 'stopped', `${name}: pkill → 중지됨`);
      assert.equal(slow.meta.stopReason, 'kill-cmd');
      assert.equal(get('b:toolu_sleep'), undefined, 'sleep & 는 노드 없음');
    }
    // 재생: 프로세스 node-add = 띄운 시각, 로그 배분은 들여다본 결과 시각을 닻으로(첫 회차 8줄은 peek 결과 시각까지)
    const add = evs.find((e) => e.type === 'node-add' && e.nodeId === 'b:toolu_launch');
    assert.equal(add.ts, fx.T(10));
    const outs = evs.filter((e) => e.type === 'output' && e.nodeId === 'b:toolu_launch');
    const firstPass = outs.find((e) => e.text.includes('[iter_pairs] 16,000'));
    assert.ok(Date.parse(firstPass.ts) <= Date.parse(fx.T(21)), `첫 회차 줄은 peek 결과(21초) 전 — ${firstPass.ts}`);
    const lastWalk = outs.find((e) => e.text.includes('[_walk_pairs] 42,000'));
    assert.ok(Date.parse(lastWalk.ts) <= Date.parse(fx.T(1800)) && Date.parse(lastWalk.ts) > Date.parse(fx.T(630)));
  } finally {
    if (prevTmp == null) delete process.env.CCVIZ_CLAUDE_TMP; else process.env.CCVIZ_CLAUDE_TMP = prevTmp;
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

// 10.30. 상시 서버 멈춤: PowerShell 명령의 `<`·`2<3` 에서 tokenize 가 제자리를 돌아 이벤트 루프가 막혔다.
// 무한 반복은 같은 스레드에서 잡을 수 없어 자식 프로세스로 시간 제한을 둔다.
test('tokenize: `<`·숫자+`<` 에서 멈추지 않음(무한 반복 방지)', async () => {
  const { spawnSync } = await import('node:child_process');
  const { pathToFileURL } = await import('node:url');
  const mod = pathToFileURL(path.join(import.meta.dirname, '..', 'procs.mjs')).href;
  const cmds = [
    ["if ($a -lt 3) { Write-Host '<x>' }; $h = @'\n<html>\n'@; python x.py < in.txt", 'PowerShell'],
    ['python -c "print(1)" 2<3 & echo 1<2', 'Bash'],
  ];
  const code = `import { tokenize, detectProcLaunch } from ${JSON.stringify(mod)};
const r = [tokenize('a < b', { ps: true }), tokenize('echo 2<3'), tokenize('x 2<in', { ps: true }), tokenize('cat 0<in.txt 2>&1 > out')];
for (const [c, tool] of ${JSON.stringify(cmds)}) detectProcLaunch(c, { tool });
detectProcLaunch('python x.py ' + 'a '.repeat(100000) + '> log &', { tool: 'Bash' });
console.log(JSON.stringify(r));`;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { timeout: 15000, encoding: 'utf8' });
  assert.equal(res.error?.code, undefined, '시간 안에 끝나야 함(무한 반복 없음)');
  assert.equal(res.status, 0, res.stderr);
  const [psLt, bashLt, psDigit, bashIn] = JSON.parse(res.stdout.trim());
  assert.deepEqual(psLt.map((t) => t.w ?? t.op), ['a', '<', 'b'], 'PowerShell `<` 는 낱말');
  assert.deepEqual(bashLt.map((t) => t.w ?? t.op), ['echo', '2<', '3'], 'Bash `2<` 는 입력 리다이렉트');
  assert.deepEqual(psDigit.map((t) => t.w ?? t.op), ['x', '2<in']);
  assert.deepEqual(bashIn.map((t) => t.w ?? t.op), ['cat', '0<', 'in.txt', '2>&1', '>', 'out']);
});
