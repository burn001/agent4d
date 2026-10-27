// 외부 작업 등록부: 서술 파일 파싱 · 진행 정규식 · 끝 판정 · 등록부(로그 꼬리·끝 표지·오류 줄·정리) · PID 찾기 · 세션 배선
// 합성 파일만 쓴다(임시 폴더). 프로세스는 만들지도 끄지도 않는다 — 생존은 주입한 pidAlive 로.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  EXT, normDescriptor, compileProgress, matchProgress, judgeEnd, parseDuration, safeExtId, lineClockMs,
  ExtJobRegistry, extJobView, extJobIx,
} from '../extjobs.mjs';
import { pidCandidates, progOf, buildDescriptor } from '../../bin/job.mjs';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-extjobs-'));
const SAMPLE_LINE = '  12:08:51 [DAILY] 판 갈래 — 쌍 2,538/125,712 완료 · 문서 4,997 · 경과 420초';

test('서술 파일: 필수(log + pid|endFile) · 상대 경로는 cwd 기준 · 기간 · 잘못된 값', () => {
  const r = normDescriptor({ pid: 55024, log: 'D:\\x\\full\\run-fixed.log', endFile: 'D:\\x\\full\\result-fixed.json', expect: '1h30m', name: '고친 팔' }, { id: 'full-run-fixed' });
  assert.equal(r.ok, true, r.errors.join());
  assert.equal(r.desc.id, 'full-run-fixed'); assert.equal(r.desc.pid, 55024); assert.equal(r.desc.expectSec, 5400); assert.equal(r.desc.name, '고친 팔');
  assert.equal(r.desc.pattern, null, '없으면 일반 규칙');
  const rel = normDescriptor({ endFile: 'out/done.json', log: 'out/run.log', cwd: os.tmpdir() });
  assert.equal(rel.ok, true); assert.equal(rel.desc.log, path.resolve(os.tmpdir(), 'out/run.log')); assert.equal(rel.desc.id, 'run', '파일 이름에서 id');
  assert.deepEqual(normDescriptor({ log: '/a/b.log' }).errors, ['pid 와 endFile 중 하나는 있어야 끝을 판정한다']);
  assert.equal(normDescriptor({ pid: 1 }).ok, false, 'log 없음');
  assert.equal(normDescriptor({ pid: 1, log: '/a.log', pattern: '(' }).ok, false, '깨진 정규식');
  assert.equal(normDescriptor({ pid: 1, log: '/a.log', sessionId: 'nope' }).ok, false);
  assert.equal(normDescriptor([1]).ok, false);
  assert.equal(parseDuration('2h'), 7200); assert.equal(parseDuration('2시간 30분'), 9000); assert.equal(parseDuration(90), 90); assert.equal(parseDuration('soon'), null);
  assert.equal(safeExtId('q153 s2/run fixed!'), 'q153-s2-run-fixed');
});

test('진행 정규식: 일반 규칙(쉼표·날짜 오탐 거름) · 사용자 정규식(이름 묶음·total 고정) · 줄 시각', () => {
  const g = compileProgress({ pattern: null });
  assert.deepEqual(matchProgress(SAMPLE_LINE, g), { n: 2538, total: 125712 });
  assert.deepEqual(matchProgress('2026/10/27 run 3/40 ok', g), { n: 3, total: 40 }, 'n > total 인 날짜 조각은 건너뜀');
  assert.equal(matchProgress('경과 420초', g), null);
  const named = compileProgress({ pattern: '쌍 (?<n>[\\d,]+)/(?<total>[\\d,]+)' });
  assert.deepEqual(matchProgress(SAMPLE_LINE, named), { n: 2538, total: 125712 });
  const oneGroup = compileProgress({ pattern: 'done=(\\d+)', total: 500 });
  assert.deepEqual(matchProgress('tick done=120', oneGroup), { n: 120, total: 500 }, 'total 은 서술 값');
  assert.equal(matchProgress('tick done=900', oneGroup), null, 'n > total');
  const ref = new Date(2026, 9, 27, 12, 30, 0).getTime();
  assert.equal(new Date(lineClockMs(SAMPLE_LINE, ref)).getMinutes(), 8);
  assert.ok(Number.isNaN(lineClockMs('no clock', ref)));
});

test('끝 판정: 끝 표지 > PID 소멸(오류 줄·약속한 끝 표지 없음 = 실패) > PID 없는 작업의 오류 줄 > 포기', () => {
  assert.deepEqual(judgeEnd({ hasPid: true, alive: true, hasEndFile: true, endSeen: true }), { state: 'done', reason: 'end-file' });
  assert.equal(judgeEnd({ hasPid: true, alive: true, errLine: 'Traceback (most recent call last):' }), null, '살아 있으면 오류 줄만으로 끝내지 않음');
  assert.deepEqual(judgeEnd({ hasPid: true, alive: false, errLine: 'ValueError: x' }), { state: 'failed', reason: 'error' });
  assert.deepEqual(judgeEnd({ hasPid: true, alive: false, hasEndFile: true }), { state: 'failed', reason: 'no-end-file' });
  assert.deepEqual(judgeEnd({ hasPid: true, alive: false }), { state: 'done', reason: 'pid-gone' });
  assert.deepEqual(judgeEnd({ hasPid: false, hasEndFile: true, errLine: 'Error: boom' }), { state: 'failed', reason: 'error' });
  assert.equal(judgeEnd({ hasPid: false, hasEndFile: true }), null);
  assert.deepEqual(judgeEnd({ hasPid: true, alive: true, ageSec: EXT.MAX_AGE_SEC + 1, quietSec: EXT.GIVEUP_QUIET_SEC + 1 }), { state: 'failed', reason: 'gave-up' });
});

test('등록부: 로그 증분 · 진행 n/N 과 ix(i/N) · 진행 줄 없는 작업은 경과/예상 비율 · 끝 표지 · 오류 로그 · 지난 실행의 끝 표지 무시 · 정리', () => {
  const dir = tmp();
  try {
    const jobs = path.join(dir, 'jobs'); fs.mkdirSync(jobs);
    const log = path.join(dir, 'run-fixed.log'), quiet = path.join(dir, 'run-head.log'), err = path.join(dir, 'run-head.err');
    const endA = path.join(dir, 'result-fixed.json'), endB = path.join(dir, 'result-head.json');
    let now = Date.now();
    const alive = new Map([[101, true], [102, true]]);
    fs.writeFileSync(endB, '{}'); // 지난 실행이 남긴 끝 표지(작업 시작보다 이르다)
    fs.utimesSync(endB, new Date(now - 3600_000), new Date(now - 3600_000));
    fs.writeFileSync(log, '  12:01:51 [DAILY] 판 갈래 시작 · 사례 42,045\r\n'); fs.writeFileSync(quiet, ''); fs.writeFileSync(err, '');
    const start = new Date(now - 600_000).toISOString();
    fs.writeFileSync(path.join(jobs, 'fixed.json'), JSON.stringify({ pid: 101, log, endFile: endA, name: '고친 팔', startedAt: start }));
    fs.writeFileSync(path.join(jobs, 'head.json'), JSON.stringify({ pid: 102, log: quiet, errLog: err, endFile: endB, expectSec: 1200, name: 'HEAD 팔', startedAt: start }));
    fs.writeFileSync(path.join(jobs, 'broken.json'), '{"pid":');
    const reg = new ExtJobRegistry({ dir: jobs, now: () => now, pidAlive: (p) => !!alive.get(p), prune: true });
    reg.refresh();
    assert.equal(reg.jobs.size, 2); assert.ok(reg.errors.has('broken.json'));
    const F = reg.jobs.get('fixed'), H = reg.jobs.get('head');
    assert.equal(F.progress, null);
    // 진행 줄 두 개(1분 간격) — 증분으로 읽고 처리율·남은 시간
    fs.appendFileSync(log, '  12:02:51 [DAILY] 판 갈래 — 쌍 84/125,712 완료\r\n' + SAMPLE_LINE + '\r\n');
    now += 5000; reg.refresh();
    assert.deepEqual(F.progress, { n: 2538, total: 125712 });
    const vF = extJobView(F, now);
    assert.equal(vF.id, 'x:fixed'); assert.equal(vF.state, 'running'); assert.equal(vF.src, 'ext'); assert.equal(vF.host, 'PID 101');
    assert.deepEqual(vF.progress, { n: 2538, total: 125712 });
    assert.ok(vF.rate > 0 && vF.eta, '처리율·끝날 시각'); assert.match(vF.phase, /^2,538\/125,712 \(2%\)/);
    assert.deepEqual(extJobIx(F, now), { v: 1, cat: 'batch', op: 'progress', bg: 1, i: 2538, n: 125712, phase: 'progress' }, '바닥 진행 띠가 받는 i/N');
    // 진행 줄 없는 작업: 지난 실행의 끝 표지는 무시, 경과/예상 비율, 생존이 박동
    const vH = extJobView(H, now);
    assert.equal(H.endSeen, false); assert.equal(vH.state, 'running');
    assert.ok(Math.abs(vH.progress.ratio - 0.504) < 0.01, '경과 605초 / 예상 1200초');
    assert.match(vH.phase, /예상 20분 · 진행 줄 없음$/);
    assert.equal(extJobIx(H, now).pct, 50);
    assert.ok(Date.parse(vH.beatAt) > now - EXT.BEAT_QUIET_MS - 1, '생존 박동');
    // 고친 팔: 끝 표지가 생기면 done(PID 가 살아 있어도)
    fs.writeFileSync(endA, '{"ok":true}');
    now += 5000; reg.refresh();
    assert.deepEqual(F.end, { state: 'done', reason: 'end-file' });
    assert.equal(extJobView(F, now).state, 'done'); assert.equal(extJobIx(F, now).phase, 'end'); assert.equal(extJobIx(F, now).ok, true);
    // HEAD 팔: stderr 에 Traceback 뒤 PID 소멸 → failed(error), 마지막 줄 = 오류 줄
    fs.appendFileSync(err, 'Traceback (most recent call last):\n  File "x.py", line 1\nKeyError: \'k\'\n');
    alive.set(102, false);
    now += 5000; reg.refresh();
    assert.deepEqual(H.end, { state: 'failed', reason: 'error' });
    const vH2 = extJobView(H, now);
    assert.equal(vH2.state, 'failed'); assert.equal(vH2.line, "KeyError: 'k'"); assert.match(vH2.phase, /^오류 줄 · /);
    assert.equal(extJobIx(H, now).ok, false);
    // 정리: 끝난 지 keepSec(기본 12시간) 넘으면 서술 파일을 지운다
    now += EXT.KEEP_SEC * 1000 + 60_000; reg.refresh();
    assert.equal(reg.jobs.size, 0);
    assert.deepEqual(fs.readdirSync(jobs).sort(), ['broken.json'], '깨진 파일은 남김(사람이 고치게)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('PID 찾기: 경로 전체 → 폴더 + 파일 이름 낱말 · venv 실행기 사슬은 맨 위 · 읽기 프로그램·인자 속 낱말 구분', () => {
  const dir = 'D:\\P\\q153\\s2\\full';
  const arm = (tag, co) => `"D:\\P\\venv\\Scripts\\python.exe" D:\\P\\q153\\s2\\arm_run.py --co ${co} --out ${dir} --targets ${dir}\\targets.json --tag ${tag}`;
  const procs = [
    { pid: 55024, ppid: 50740, cmd: arm('fixed', 'D:\\P\\q153\\s2\\co_fixed') },
    { pid: 41392, ppid: 55024, cmd: arm('fixed', 'D:\\P\\q153\\s2\\co_fixed') },
    { pid: 28788, ppid: 57544, cmd: arm('head', 'D:\\P\\q153\\s0\\branches\\co') },
    { pid: 38160, ppid: 28788, cmd: arm('head', 'D:\\P\\q153\\s0\\branches\\co') },
    { pid: 900, ppid: 1, cmd: `tail -f ${dir}\\run-fixed.log` },
    { pid: 901, ppid: 1, cmd: `powershell -c Get-Content ${dir}\\run-head.log -Wait` },
  ];
  const f = pidCandidates(procs, `${dir}\\run-fixed.log`);
  assert.equal(f.tier, 'dir'); assert.deepEqual(f.tokens, ['fixed']);
  assert.deepEqual(f.roots.map((p) => p.pid), [55024]);
  const h = pidCandidates(procs, `${dir}\\run-head.log`);
  assert.deepEqual(h.roots.map((p) => p.pid), [28788], '`--tag head` 는 읽기 프로그램 head 가 아님');
  const byPath = pidCandidates([...procs, { pid: 7, ppid: 1, cmd: `bash -c "python job.py > ${dir}\\run-x.log 2>&1"` }], `${dir}\\run-x.log`);
  assert.equal(byPath.tier, 'path'); assert.deepEqual(byPath.roots.map((p) => p.pid), [7]);
  assert.equal(pidCandidates(procs, 'D:\\elsewhere\\a.log').tier, null);
  assert.equal(progOf('"C:\\Program Files\\Git\\usr\\bin\\tail.exe" -f x'), 'tail');
  // 서술 만들기: PID·시작 시각·옆 .err 자동
  const b = buildDescriptor({ log: `${dir}\\run-head.log`, end: `${dir}\\result-head.json`, name: 'HEAD 팔' },
    { procs: procs.map((p) => ({ ...p, t: p.pid === 28788 ? '2026-10-27T02:58:39.000Z' : null })), now: Date.parse('2026-10-27T03:00:00Z'), exists: (p) => p.endsWith('run-head.err') });
  assert.equal(b.raw.pid, 28788); assert.equal(b.raw.startedAt, '2026-10-27T02:58:39.000Z'); assert.equal(b.raw.errLog, path.resolve(`${dir}\\run-head.err`));
  assert.equal(b.raw.id, 'full-run-head');
  assert.equal(normDescriptor(b.raw).ok, true);
});

test('배선: 라이브 세션 런타임이 프로젝트 메인 아래 작업 노드와 바닥 진행 띠(output ix i/N)를 낸다 · 서술을 지우면 닫는다', async () => {
  const dir = tmp();
  try {
    const SID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
    const cwd = path.join(dir, 'repo');
    const projects = path.join(dir, 'projects'), sessions = path.join(dir, 'sessions'), jobs = path.join(dir, 'jobs');
    const proj = path.join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'));
    for (const d of [proj, sessions, jobs, path.join(cwd, 'out')]) fs.mkdirSync(d, { recursive: true });
    const ts = new Date(Date.now() - 60_000).toISOString();
    fs.writeFileSync(path.join(proj, `${SID}.jsonl`), JSON.stringify({ type: 'user', timestamp: ts, sessionId: SID, cwd, entrypoint: 'cli', message: { role: 'user', content: '측정 팔을 띄워라' } }) + '\n');
    const log = path.join(cwd, 'out', 'run-fixed.log');
    fs.writeFileSync(log, '  12:00:00 쌍 10/100 완료\n  12:01:00 쌍 30/100 완료\n');
    // cwd·sessionId 없이 로그 경로만 — 로그의 조상 폴더(repo)가 프로젝트
    fs.writeFileSync(path.join(jobs, 'fixed.json'), JSON.stringify({ pid: 4242, log, name: '고친 팔' }));
    const index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
    await index.refresh();
    const reg = new ExtJobRegistry({ dir: jobs, pidAlive: () => true });
    const rt = new RootRuntime({ sessionId: SID, index, jobRules: null, extJobs: reg });
    await rt.start();
    try {
      const id = `j:s:${SID}:x:fixed`;
      const n = rt.graph.get(id);
      assert.ok(n, '작업 노드');
      assert.equal(n.parentId, `s:${SID}`); assert.equal(n.kind, 'bash-bg'); assert.equal(n.status, 'active'); assert.equal(n.label, '고친 팔');
      assert.deepEqual(n.meta.job.progress, { n: 30, total: 100 }); assert.equal(n.meta.job.src, 'ext');
      const outs = rt.graph.ring.filter((e) => e.type === 'output' && e.nodeId === id);
      assert.equal(outs.length, 1);
      assert.deepEqual({ i: outs[0].ix.i, n: outs[0].ix.n, cat: outs[0].ix.cat, phase: outs[0].ix.phase }, { i: 30, n: 100, cat: 'batch', phase: 'progress' });
      // 서술 파일을 지우면(등록 해제) 노드를 끝으로 닫는다
      fs.unlinkSync(path.join(jobs, 'fixed.json'));
      reg._at = -Infinity; rt.sweep();
      assert.equal(rt.graph.get(id).status, 'done');
    } finally { rt.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
