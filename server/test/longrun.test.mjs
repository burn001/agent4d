// 장시간 실행 표시(서버): meta.run · 열린 셸이면 대기 금지 · bg 적응 정체 · 끝 표지 [exited with code N] · queue-operation 알림 ·
// `\r` 살리기(tqdm → 자동 진행) · bg 로그 파일 꼬리 · 포그라운드 셸 출력의 자동 진행(계수기) · 재생 재현
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime, fgHoldMs } from '../session.mjs';
import { buildReplay } from '../replay.mjs';
import { collapseCR, LineTail } from '../panel.mjs';
import { exitMarkerOf, pythonBuffered, bufferWhy, stripHeredocs, redirectLogs, pushGap } from '../procs.mjs';
import { encodeCwd } from '../parse.mjs';

const M = 'eeeeeeee-7777-4777-8777-777777777777';
const cwd = 'D:\\work\\longrun';
const base = { sessionId: M, cwd, version: '2.1.309', entrypoint: 'cli' };
const line = (r) => JSON.stringify(r) + '\n';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let root, index, dir, outDir, t0;
const T = (s) => new Date(t0 + s * 1000).toISOString();
const A = (s, block, extra = {}) => ({ type: 'assistant', timestamp: T(s), ...base, ...extra, message: { role: 'assistant', model: 'm', content: [block] } });
const R = (s, id, text, tur, extra = {}) => ({ type: 'user', timestamp: T(s), ...base, ...extra, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, toolUseResult: tur });
const BG = (s, id, cmd, taskId, resultAt = s + 1) => [
  A(s, { type: 'tool_use', id, name: 'Bash', input: { command: cmd, description: taskId, run_in_background: true } }),
  R(resultAt, id, `Command running in background with ID: ${taskId}. Output is being written to: ${path.join(outDir, taskId + '.output')}`, { stdout: '', stderr: '', backgroundTaskId: taskId }),
];
const NOTE = (taskId, status, summary) => `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`;
const TQDM = (n) => { let s = ''; for (let i = 0; i <= n; i++) s += `\r${String(Math.round((i * 100) / n)).padStart(3)}%|${'█'.repeat(Math.round(i / 10))}| ${i}/${n} [00:${String(i % 60).padStart(2, '0')}<00:10,  9.9it/s]`; return s + '\n'; };

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-longrun-'));
  const projects = path.join(root, 'projects');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  dir = path.join(projects, encodeCwd(cwd));
  outDir = path.join(root, 'tasks');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  t0 = Date.now() - 3600_000; // 1시간 전 시작
  const recs = [
    { type: 'user', timestamp: T(0), ...base, message: { role: 'user', content: '오래 걸리는 작업들' } },
    // b_ok: 알림 없이 출력 끝 [exited with code 0] → done
    ...BG(10, 'tu_ok', 'python make.py', 'b_ok'),
    // b_fail: [exited with code 1] → error, rc 1 (그 뒤 같은 상태 알림은 겹친 것)
    ...BG(20, 'tu_fail', 'node build.mjs', 'b_fail'),
    // b_sig: 143 → stopped(signal)
    ...BG(30, 'tu_sig', 'node serve.mjs', 'b_sig'),
    // b_q: 알림이 queue-operation 에만 있음 → done
    ...BG(40, 'tu_q', 'sleep 30', 'b_q'),
    { type: 'queue-operation', operation: 'enqueue', timestamp: T(75), sessionId: M, content: NOTE('b_q', 'completed', 'Background command "b_q" completed (exit code 0)') },
    // b_dup: queue-operation + user 레코드 둘 다 — 알림 한 번만
    ...BG(50, 'tu_dup', 'sleep 40', 'b_dup'),
    { type: 'queue-operation', operation: 'enqueue', timestamp: T(95), sessionId: M, content: NOTE('b_dup', 'completed', 'Background command "b_dup" completed (exit code 0)') },
    { type: 'user', timestamp: T(96), ...base, origin: { kind: 'task-notification' }, message: { role: 'user', content: NOTE('b_dup', 'completed', 'Background command "b_dup" completed (exit code 0)') } },
    // b_tqdm: tqdm \r 갱신 100번, 200초 뒤 끝
    ...BG(100, 'tu_tqdm', 'python -u train.py', 'b_tqdm'),
    // b_late: 포그라운드로 300초 돌다 백그라운드로 넘어감(결과 기록이 300초 뒤) → 시작 = tool_use 시각
    ...BG(400, 'tu_late', 'python long.py', 'b_late', 700),
    { type: 'user', timestamp: T(1000), ...base, origin: { kind: 'task-notification' }, message: { role: 'user', content: NOTE('b_tqdm', 'completed', 'Background command "b_tqdm" completed (exit code 0)') } },
    // 메인 포그라운드 python(-u 없음): 70초 전 시작, 결과 없음
    A(3530, { type: 'tool_use', id: 'tu_fg', name: 'Bash', input: { command: 'venv/Scripts/python.exe -W ignore run.py 2>&1 | tail -3', timeout: 600000 } }),
  ];
  fs.writeFileSync(path.join(dir, `${M}.jsonl`), recs.map(line).join(''));
  fs.writeFileSync(path.join(outDir, 'b_ok.output'), 'made\n[exited with code 0]\n');
  fs.writeFileSync(path.join(outDir, 'b_fail.output'), 'Error: boom\r\n\n[exited with code 1]\n');
  fs.writeFileSync(path.join(outDir, 'b_sig.output'), 'listening\n[exited with code 143]\n');
  fs.writeFileSync(path.join(outDir, 'b_tqdm.output'), 'start\n' + TQDM(100) + 'done\n');
  fs.writeFileSync(path.join(outDir, 'b_late.output'), 'still going\n');
  const setM = (f, s) => { const d = new Date(t0 + s * 1000); fs.utimesSync(path.join(outDir, f), d, d); };
  setM('b_ok.output', 15); setM('b_fail.output', 25); setM('b_sig.output', 35); setM('b_tqdm.output', 990); setM('b_late.output', 3000);
  const mf = path.join(dir, `${M}.jsonl`); const d = new Date(t0 + 3530_000); fs.utimesSync(mf, d, d);
  index = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'sessions') });
  await index.refresh();
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('순수 함수: collapseCR · 끝 표지 · python 버퍼링 · 리다이렉트 로그 · 공용 간격 문턱', () => {
  assert.equal(collapseCR(' 10%\r 20%\r 30%\nnext'), ' 30%\nnext');
  assert.equal(collapseCR('a\r\nb'), 'a\nb');
  const lt = new LineTail(4);
  lt.push('\r 10%'); lt.push('\r 20%'); lt.push('\r 30%\n');
  assert.deepEqual(lt.view(), [' 30%'], 'LineTail 은 덮어쓰기(마지막 조각)');
  assert.equal(exitMarkerOf('x\n[exited with code 0]\n'), 0);
  assert.equal(exitMarkerOf('[exited with code 137]'), 137);
  assert.equal(exitMarkerOf('[exited with code 1] and more'), null);
  assert.equal(pythonBuffered('venv/Scripts/python.exe -W ignore x.py'), true);
  assert.equal(pythonBuffered('py -3 x.py'), true);
  assert.equal(pythonBuffered('python -u x.py'), false);
  assert.equal(pythonBuffered('PYTHONUNBUFFERED=1 python3 x.py'), false);
  assert.equal(pythonBuffered('node x.mjs'), false);
  assert.deepEqual(redirectLogs('cd /d/x && python train.py > run.log 2>&1', { cwd: 'D:/w' }), [path.resolve('D:/x/run.log')]);
  assert.deepEqual(redirectLogs('python a.py 2>&1 | tee out/log.txt', { cwd: 'D:/w' }), [path.resolve('D:/w/out/log.txt')]);
  assert.deepEqual(redirectLogs('for f in a b; do python m.py $f >> all.log 2>&1; done', { cwd: 'D:/w' }), [path.resolve('D:/w/all.log')]);
  assert.deepEqual(redirectLogs('python m.py >/dev/null; echo hi > note.txt', { cwd: 'D:/w' }), []);
  assert.deepEqual(redirectLogs('python a.py | Tee-Object -FilePath C:/t/y.log', { tool: 'PowerShell', cwd: 'D:/w' }), [path.resolve('C:/t/y.log')]);
  const g = [];
  assert.equal(pushGap(g, 0, 10_000), 120, '최소 120초');
  assert.equal(pushGap(g, 10_000, 20_000, true), 120, 'backlog 은 간격 아님');
  assert.equal(g.length, 1);
  assert.equal(fgHoldMs({ input: { timeout: 600000 } }), 660_000);
});

test('버퍼링 이유 bufferWhy: 끝까지 붙드는 마지막 파이프 · 출력 버림·대입 · python · heredoc·따옴표 안은 무시 · PowerShell', () => {
  const B = (c) => bufferWhy(c), P = (c) => bufferWhy(c, { tool: 'PowerShell' });
  // pipe: tail(-f·+N 제외)·sort·wc·tac·column·uniq -c
  assert.equal(B('python x.py 2>&1 | tail -5'), 'pipe', 'python 이라도 마지막 파이프가 먼저(-u 로는 안 풀림)');
  assert.equal(B('cd /d/x && npm test 2>&1 | tail -30'), 'pipe');
  assert.equal(B('node a.mjs | tee run.log | tail -n 3; echo done'), 'pipe', '마무리 echo 는 건너뜀');
  assert.equal(B('cat log | sort | uniq -c'), 'pipe');
  assert.equal(B('grep -r x . | wc -l'), 'pipe');
  assert.equal(B('for f in a b; do node x.mjs $f; done | sort'), 'pipe');
  assert.equal(B('npm test | tail -f'), null);
  assert.equal(B('make | tail -n +2'), null, 'tail +N 은 흘려 보냄');
  assert.equal(B('node a.mjs | head -20'), null, 'head 는 받는 대로 바로 내보냄');
  assert.equal(B('python x.py | head -20'), 'python', 'head 앞 python 은 python 규칙');
  assert.equal(B('node a.mjs | uniq'), null);
  // devnull: 버림·대입
  assert.equal(B('python a.py > /dev/null 2>&1'), 'devnull');
  assert.equal(B('node a.mjs &> /dev/null'), 'devnull');
  assert.equal(B('npm run build | sort > /dev/null'), 'devnull');
  assert.equal(B('X=$(node a.mjs); echo $X'), 'devnull');
  assert.equal(B('OUT=`make`'), 'devnull');
  assert.equal(B('python prep.py > /dev/null && python -u train.py'), null, '기준 = 마지막 명령');
  assert.equal(B('node a.mjs > run.log 2>&1'), null, '파일로 보냄은 버림 아님');
  assert.equal(B('python x.py'), 'python');
  assert.equal(B('python -u x.py'), null);
  // 따옴표·heredoc 안의 | > 는 명령 아님
  assert.equal(B('echo "a | tail" && node x.mjs'), null);
  assert.equal(B("node -e 'x | sort' > out.txt"), null);
  assert.equal(B('cat <<EOF > f.txt\nfoo | tail -3\nbar > /dev/null\nEOF\nnode x.mjs'), null);
  assert.equal(B("cat <<-'END' | node r.mjs\n\ta | wc -l\n\tEND"), null);
  assert.equal(stripHeredocs('a <<EOF\nx|y\nEOF\nb'), 'a <<EOF\nb');
  // PowerShell
  assert.equal(P('python x.py | Select-Object -Last 5'), 'pipe');
  assert.equal(P('node x.mjs | select -l 3'), 'pipe');
  assert.equal(P('Get-ChildItem -Recurse | Sort-Object Length'), 'pipe');
  assert.equal(P('Get-Content big.log | Measure-Object -Line'), 'pipe');
  assert.equal(P('node x.mjs | Select-Object -First 5'), null);
  assert.equal(P('npm test | Out-Null'), 'devnull');
  assert.equal(P('node x.mjs > $null'), 'devnull');
  assert.equal(P('$null = node a.mjs'), 'devnull');
  assert.equal(P('$r = node x.mjs; $r'), 'devnull');
  assert.equal(P('$env:PYTHONUNBUFFERED = "1"; python x.py'), null);
  assert.equal(P("@'\na | sort\n'@ | Set-Content f.txt; node x.mjs"), null, 'here-string 본문 무시');
  // 공개 모양: buffered 일 때만 bufferWhy, 첫 출력이 오면 둘 다 빠짐
  const rt = new RootRuntime({ sessionId: M, index, jobRules: null });
  const s = { kind: 'fg', tool: 't', since: 1, lastOut: null, staleMs: 300_000, buffered: 'pipe' };
  assert.deepEqual([rt._runPub(s).buffered, rt._runPub(s).bufferWhy], [true, 'pipe']);
  s.lastOut = 2;
  assert.equal(rt._runPub(s).buffered, false);
  assert.equal('bufferWhy' in rt._runPub(s), false);
});

test('라이브: 끝 표지 0/1/143 · queue-operation 알림 · 중복 없음 · 열린 셸 + 70초 무이벤트 → active, meta.run', async () => {
  const rt = new RootRuntime({ sessionId: M, index, jobRules: null });
  await rt.start();
  try {
    const g = rt.graph;
    const ok = g.get('b:b_ok'), fail = g.get('b:b_fail'), sig = g.get('b:b_sig');
    assert.equal(ok.status, 'done');
    assert.equal(ok.meta.rc, 0);
    assert.equal(ok.meta.run.kind, 'bg');
    assert.equal(ok.meta.run.ended, Date.parse(ok.endedAt));
    assert.equal(ok.endedAt, T(15), '끝 = 출력 파일 수정 시각');
    assert.equal(fail.status, 'error');
    assert.equal(fail.meta.rc, 1);
    assert.equal(fail.meta.run.rc, 1);
    assert.equal(sig.status, 'stopped');
    assert.equal(sig.meta.stopReason, 'signal');
    assert.equal(g.get('b:b_q').status, 'done', 'queue-operation 에만 있는 알림');
    assert.equal(g.get('b:b_dup').status, 'done');
    const notes = rt.graph.ring.filter((e) => e.type === 'user' && e.origin === 'task-notification' && /b_dup/.test(e.text));
    assert.equal(notes.length, 1, 'queue-operation + user 레코드 = 알림 한 번');
    // 포그라운드로 돌다 넘어간 bg: 시작 = tool_use 시각
    const late = g.get('b:b_late');
    assert.equal(late.startedAt, T(400));
    assert.equal(late.meta.run.since, Date.parse(T(400)));
    assert.equal(late.meta.run.buffered, false, '출력이 있음');
    // 열린 포그라운드 셸(70초 전, 결과 없음) → 대기로 떨어뜨리지 않음
    rt.sweep();
    const main = g.get(`s:${M}`);
    assert.equal(main.status, 'active');
    const run = main.meta.run;
    assert.equal(run.kind, 'fg');
    assert.equal(run.tool, 'tu_fg');
    assert.equal(run.since, Date.parse(T(3530)));
    assert.equal(run.lastOut, null);
    assert.equal(run.buffered, true, 'python -u 없음');
    assert.equal(run.bufferWhy, 'pipe', 'python … | tail -3 — 마지막 파이프가 먼저');
    assert.ok(run.staleAfter >= 120_000);
    // 일반 bg 적응 정체: b_late 는 마지막 출력(파일 수정 시각, 약 10분 전) 뒤 문턱(기본 300초)을 넘었으니 idle
    assert.equal(late.status, 'idle');
    // 셸 결과가 오면 meta.run = null
    fs.appendFileSync(path.join(dir, `${M}.jsonl`), line(R(3601, 'tu_fg', 'done', { stdout: 'done', stderr: '' })));
    await rt.pollAll({ all: true });
    assert.equal(g.get(`s:${M}`).meta.run, null);
  } finally { rt.close(); }
});

test('라이브: tqdm `\\r` 출력 → 자동 진행 작업(계수기) · bg 로그 파일 꼬리 · 포그라운드 셸 출력도 자동 진행', async () => {
  // 새 세션: 라이브로 막 띄운 bg(로그로 돌림) + 포그라운드 python
  const S = 'eeeeeeee-7777-4777-8777-888888888888';
  const b2 = { ...base, sessionId: S };
  const now = Date.now();
  const TT = (ago) => new Date(now - ago).toISOString();
  const logFile = path.join(root, 'work', 'train.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const f = path.join(dir, `${S}.jsonl`);
  fs.writeFileSync(f, line({ type: 'user', timestamp: TT(5000), ...b2, message: { role: 'user', content: '학습' } }));
  index = new SessionIndex({ projectsDir: path.join(root, 'projects'), sessionsDir: path.join(root, 'sessions') });
  await index.refresh();
  const rt = new RootRuntime({ sessionId: S, index, jobRules: null });
  await rt.start();
  try {
    const g = rt.graph;
    fs.appendFileSync(f, [
      { type: 'assistant', timestamp: TT(2000), ...b2, message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'tu_bglog', name: 'Bash', input: { command: `python -u train.py > "${logFile.replace(/\\/g, '/')}" 2>&1`, run_in_background: true } }] } },
      { type: 'user', timestamp: TT(1900), ...b2, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_bglog', content: `Command running in background with ID: blog1. Output is being written to: ${path.join(outDir, 'blog1.output')}` }] }, toolUseResult: { stdout: '', stderr: '', backgroundTaskId: 'blog1' } },
      { type: 'assistant', timestamp: TT(1000), ...b2, message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'tu_fgp', name: 'Bash', input: { command: 'python eval.py' } }] } },
    ].map(line).join(''));
    fs.writeFileSync(path.join(outDir, 'blog1.output'), '');
    await rt.pollAll({ all: true });
    assert.ok(g.has('b:blog1'));
    assert.ok([...rt.outputs.values()].some((o) => o.log && o.nodeId === 'b:blog1'), '로그 파일 꼬리 줄기');
    // 로그에 tqdm 갱신을 조금씩 — 같은 bg 노드 아래 자동 진행 작업
    const jid = 'j:b:blog1:progress';
    for (let i = 0; i <= 10; i++) {
      fs.appendFileSync(logFile, `\r${i * 10}%|${'#'.repeat(i)}| ${i * 10}/100 [00:0${i % 10}<00:10]`);
      await rt.pollAll({ all: true });
      await sleep(i === 10 ? 2300 : 260); // 250ms 묶음 · 레인 값 갱신 2초 솎기
    }
    fs.appendFileSync(logFile, '\n');
    await rt.pollAll({ all: true }); await sleep(300);
    rt.sweep();
    assert.ok(g.has(jid), '자동 진행 작업 노드');
    const ups = g.ring.filter((e) => e.nodeId === jid && (e.type === 'node-add' || e.type === 'node-update'));
    assert.ok(ups.length >= 2, `진행 갱신 ${ups.length}`);
    assert.equal(g.get(jid).meta.job.src, 'auto');
    assert.ok(g.get(jid).meta.job.progress?.n >= 90, JSON.stringify(g.get(jid).meta.job.progress));
    const bgOut = g.ring.filter((e) => e.type === 'output' && e.nodeId === 'b:blog1');
    assert.ok(bgOut.length >= 2);
    assert.ok(!bgOut.some((e) => e.text.includes('\r')), '이벤트 글은 접은 글');
    assert.ok(bgOut.at(-1).panel.lines.length <= 2, '패널은 덮어쓴 한 줄: ' + JSON.stringify(bgOut.at(-1).panel.lines));
    assert.ok(g.get('b:blog1').meta.run.lastOut > 0);
    // 포그라운드 셸 출력(연결)도 같은 자동 진행 — 작업 노드는 호출한 노드 아래 j:fg:<호출 id>:progress
    const fgFile = path.join(outDir, 'fgrandom.output');
    fs.writeFileSync(fgFile, '');
    rt._fgLink(rt.tools.get('tu_fgp'), fgFile, rt.watchers.get(S));
    for (let i = 1; i <= 6; i++) {
      fs.appendFileSync(fgFile, `[eval] ${i * 10}/60 cases\n`);
      await rt.pollAll({ all: true });
      await sleep(i === 6 ? 2300 : 300);
    }
    rt.sweep();
    const fj = 'j:fg:tu_fgp:progress';
    assert.ok(g.has(fj), '포그라운드 자동 진행 작업');
    assert.equal(g.get(fj).parentId, `s:${S}`);
    assert.ok(g.ring.filter((e) => e.nodeId === fj).length >= 2);
    assert.ok(g.ring.some((e) => e.type === 'output' && e.toolUseId === 'tu_fgp' && e.ix), '진행 ix');
    assert.equal(g.get(`s:${S}`).meta.run.tool, 'tu_fgp');
    assert.equal(g.get(`s:${S}`).meta.run.buffered, false, '첫 출력이 오면 false');
    // 호출이 끝나면 작업도 끝
    fs.appendFileSync(f, line({ type: 'user', timestamp: new Date().toISOString(), ...b2, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_fgp', content: 'ok' }] }, toolUseResult: { stdout: 'ok', stderr: '' } }));
    await rt.pollAll({ all: true });
    assert.equal(g.get(fj).meta.job.state, 'done');
    assert.equal(g.get(`s:${S}`).meta.run, null);
  } finally { rt.close(); }
});

test('재생: meta.run 재현(포그라운드 시작·끝, bg since·lastOut·ended·rc) · tqdm 진행 갱신 · 열린 셸 동안 대기 없음', async () => {
  const data = await buildReplay({ sessionId: M, index, jobRules: null });
  const ev = data.events;
  const runOf = (id) => ev.filter((e) => e.nodeId === id && ((e.type === 'node-update' && e.patch?.meta && 'run' in e.patch.meta) || e.type === 'node-add'));
  // 포그라운드: tool-start 시각에 meta.run(kind fg), 끝 상태에도 남음(결과 없음)
  const main = `s:${M}`;
  const fgSet = ev.find((e) => e.nodeId === main && e.type === 'node-update' && e.patch?.meta?.run?.kind === 'fg');
  assert.ok(fgSet);
  assert.equal(fgSet.ts, T(3530));
  assert.equal(fgSet.patch.meta.run.tool, 'tu_fg');
  assert.equal(fgSet.patch.meta.run.buffered, true);
  assert.equal(fgSet.patch.meta.run.bufferWhy, 'pipe');
  // 열린 셸(timeout 600초) — tool_use 뒤 60초에는 대기 아님
  const fgEnd = ev.find((e) => e.type === 'tool-end' && e.toolUseId === 'tu_fg')?.t ?? Infinity; // 앞 시험이 결과를 덧붙였을 수 있음
  const idle = ev.filter((e) => e.nodeId === main && e.type === 'node-update' && e.patch?.status === 'idle' && e.t > Date.parse(T(3530)) && e.t <= fgEnd);
  assert.ok(idle.every((e) => e.t >= Date.parse(T(3530)) + 660_000), '열린 동안(상한 전) 대기 없음');
  // bg: node-add meta.run.since = tool_use 시각, 끝에 ended·rc
  const fin = data.finalState.nodes.get('b:b_fail');
  assert.equal(fin.status, 'error');
  assert.equal(fin.meta.run.rc, 1);
  assert.equal(fin.meta.run.ended, Date.parse(fin.endedAt));
  assert.equal(data.finalState.nodes.get('b:b_ok').status, 'done');
  assert.equal(data.finalState.nodes.get('b:b_q').status, 'done');
  const late = data.finalState.nodes.get('b:b_late');
  assert.equal(late.meta.run.since, Date.parse(T(400)));
  const tq = data.finalState.nodes.get('b:b_tqdm');
  assert.equal(tq.status, 'done');
  assert.ok(tq.meta.run.lastOut > tq.meta.run.since && tq.meta.run.lastOut <= tq.meta.run.ended);
  assert.ok(runOf('b:b_tqdm').length >= 3, 'lastOut 갱신이 시간 순으로');
  // tqdm \r → 자동 진행 작업(재생 4단계 조각마다)
  const jid = 'j:b:b_tqdm:progress';
  assert.ok(data.finalState.nodes.has(jid), '자동 진행 작업');
  const jups = ev.filter((e) => e.nodeId === jid);
  assert.ok(jups.length >= 2, `진행 갱신 ${jups.length}`);
  const outs = ev.filter((e) => e.type === 'output' && e.nodeId === 'b:b_tqdm');
  assert.ok(outs.length >= 3);
  assert.ok(outs.every((e) => (e.panel?.lines || []).every((l) => l.length < 120)), '패널 줄은 덮어쓴 조각(이어 붙지 않음)');
  assert.equal(data.stats.finalMismatch, 0);
});
