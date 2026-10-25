// 작업(Job) 오브젝트: 규약 줄 · 대체 규칙 · 장부 · 라이브/재생 같은 노드 (합성 transcript, 실제 기록 복사 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  JOB, parseProtocolLine, compileJobRules, matchRules, JobBook, resolveClock, parseProgress, normState,
  jobNodeStatus, safeJobId, loadJobRules, setMatchesProject, setMatchesStream,
} from '../jobs.mjs';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { buildReplay } from '../replay.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const localHM = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };
const localYMDHM = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

test('규약 줄: 접두어 허용 · 필드 정규화 · 깨진 줄', () => {
  assert.equal(parseProtocolLine('그냥 줄'), null);
  const a = parseProtocolLine('::agent4d {"id":"nightly","title":"야간 빌드","state":"run","phase":"테스트","progress":"96/101","host":"ci-1","rc":null}');
  assert.deepEqual(a, { id: 'nightly', title: '야간 빌드', state: 'running', phase: '테스트', progress: { n: 96, total: 101 }, host: 'ci-1' });
  const b = parseProtocolLine('[중계] 21:00 relay — ::agent4d {"job":"x","n":3,"total":9,"until":"23:00","staleSec":120,"heartbeat":true}');
  assert.equal(b.id, 'x'); assert.deepEqual(b.progress, { n: 3, total: 9 }); assert.equal(b.until, '23:00'); assert.equal(b.staleSec, 120); assert.equal(b.heartbeat, true);
  assert.deepEqual(parseProtocolLine('::agent4d {broken'), { bad: true });
  assert.deepEqual(parseProtocolLine('::agent4d {"state":"done"}'), { bad: true }, 'id 없음');
  assert.equal(parseProtocolLine('grep "::agent4d" docs'), null, '언급만 한 줄');
  assert.equal(normState('completed'), 'done'); assert.equal(normState('error'), 'failed'); assert.equal(normState('??'), null);
  assert.equal(jobNodeStatus('running'), 'active'); assert.equal(jobNodeStatus('waiting'), 'idle'); assert.equal(jobNodeStatus('failed'), 'error');
  assert.equal(safeJobId('  a\u0001  b '), 'a b'); assert.equal(safeJobId('x'.repeat(200)).length, JOB.ID_MAX);
});

test('시각 · 진행', () => {
  const ref = new Date(2026, 9, 25, 0, 30, 0).getTime(); // 지역 10-25 00:30
  assert.equal(localHM(resolveClock('23:50:00', ref, 'past')), '23:50:00');
  assert.equal(new Date(resolveClock('23:50:00', ref, 'past')).getDate(), 24, '과거면 하루 앞');
  assert.equal(new Date(resolveClock('00:10', ref + 2 * 3600_000, 'future')).getDate(), 26, '1시간 넘게 지난 시각은 미래면 하루 뒤');
  assert.equal(localYMDHM(resolveClock('2026-10-25 23:00', ref)), '2026-10-25 23:00');
  assert.equal(resolveClock('2026-10-19T07:20:42+09:00', ref), '2026-10-18T22:20:42.000Z');
  assert.equal(resolveClock('nope', ref), null);
  assert.deepEqual(parseProgress('1,234/2,000'), { n: 1234, total: 2000 });
  assert.deepEqual(parseProgress('42%'), { ratio: 0.42 });
  assert.equal(parseProgress('0/0'), null);
});

test('대체 규칙: 컴파일 오류 · 처음 맞는 규칙 · 묶음 이름 · 템플릿', () => {
  const R = compileJobRules({ sets: [{ name: 'ci', rules: [
    { on: 'bogus', re: 'x' }, { on: 'phase', re: '(' },
    { on: 'progress', re: '^step (?<n>\\d+) of (?<total>\\d+): (?<phase>.+)$' },
    { on: 'end', re: '^done rc=(?<rc>\\d+)', job: 'build-$<rc>', title: 'build' },
  ] }] });
  assert.equal(R.errors.length, 2);
  assert.equal(R.sets[0].rules.length, 2);
  assert.deepEqual(matchRules('step 3 of 7: compile', R.sets[0]), { id: 'ci', on: 'progress', set: 'ci', phase: 'compile', progress: { n: 3, total: 7 } });
  assert.equal(matchRules('done rc=2', R.sets[0]).id, 'build-2');
  assert.equal(matchRules('other', R.sets[0]), null);
  const S = compileJobRules({ sets: [{ project: 'Proj_A', streams: { kind: 'monitor', label: '감시' }, rules: [{ on: 'beat', re: 'x' }] }] }).sets[0];
  assert.ok(setMatchesProject(S, { cwd: 'D:\\w\\proj_a' }) && !setMatchesProject(S, { cwd: 'D:\\w\\b' }));
  assert.ok(setMatchesStream(S, { kind: 'monitor', label: '회차 감시' }) && !setMatchesStream(S, { kind: 'bash-bg', label: '감시' }));
});

test('장부: 상태 굴리기 · 규약이 이긴다 · 박동 솎기 · 되살리기 · rc · minimal', () => {
  const rules = compileJobRules({ sets: [{ name: 'g', rules: [
    { on: 'start', re: '^go (?<time>\\d\\d:\\d\\d:\\d\\d)', job: 'j' },
    { on: 'phase', re: '^ph (?<phase>\\S+)', job: 'j' },
    { on: 'stale', re: '^silent since (?<beat>\\d\\d:\\d\\d:\\d\\d)', job: 'j' },
    { on: 'end', re: '^fin rc=(?<rc>\\d+)', job: 'j' },
  ] }] });
  const bk = new JobBook({ rules });
  const T = (s) => new Date(Date.UTC(2026, 9, 25, 3, 0, s)).toISOString();
  let u = bk.feed('b:1', 'b:1', 'go 12:00:00\nph build\n', T(0));
  assert.equal(u.length, 1); assert.ok(u[0].isNew); assert.equal(u[0].job.state, 'running'); assert.equal(u[0].job.phase, 'build');
  assert.equal(localHM(u[0].job.startedAt), '12:00:00', '줄의 시각');
  assert.deepEqual(bk.feed('b:1', 'b:1', 'ph build\n', T(5)), [], '박동만 바뀜 → 30초 안이면 안 냄');
  assert.equal(bk.feed('b:1', 'b:1', 'ph build\n', T(40)).length, 1, '30초 뒤엔 박동 갱신');
  u = bk.feed('b:1', 'b:1', 'silent since 11:59:00\n', T(50));
  assert.equal(u[0].job.stale, true); assert.equal(localHM(u[0].job.beatAt), '11:59:00');
  u = bk.feed('b:1', 'b:1', 'fi', T(60)); assert.equal(u.length, 0, '줄 끝 기다림');
  u = bk.feed('b:1', 'b:1', 'n rc=3\n', T(61));
  assert.equal(u[0].job.state, 'failed'); assert.equal(u[0].job.rc, 3); assert.equal(u[0].job.stale, false); assert.ok(u[0].job.endedAt);
  u = bk.feed('b:1', 'b:1', 'ph again\n', T(70));
  assert.equal(u[0].job.state, 'running'); assert.equal(u[0].job.rc, null); assert.equal(u[0].job.endedAt, null, '같은 id 는 되살아난다');
  // 규약 줄을 한 번 보면 그 스트림의 대체 규칙은 꺼진다
  u = bk.feed('b:1', 'b:1', '::agent4d {"id":"j","state":"waiting","until":"2026-10-25T05:00:00Z"}\nph ignored\n', T(80));
  assert.equal(u.length, 1); assert.equal(u[0].job.state, 'waiting'); assert.equal(u[0].job.phase, 'again'); assert.equal(u[0].job.src, 'rule:g');
  assert.equal(u[0].job.until, '2026-10-25T05:00:00.000Z');
  u = bk.feed('b:1', 'b:1', '::agent4d {"id":"j","rc":0}\n', T(90));
  assert.equal(u[0].job.state, 'done', 'rc 만 오면 끝(0 = done)');
  u = bk.feed('b:2', 'b:2', 'go 12:00:00\n', T(91)); assert.equal(u[0].job.id, 'j', '다른 스트림은 규칙 그대로');
  // 주인 상한
  const big = new JobBook({});
  for (let i = 0; i < JOB.MAX_PER_OWNER + 5; i++) big.feed('s', 'o', `::agent4d {"id":"k${i}"}\n`, T(i));
  assert.equal(big.jobsOf('o').size, JOB.MAX_PER_OWNER);
  // minimal: 단계·마지막 줄·호스트 없음
  const mb = new JobBook({ privacy: 'minimal' });
  u = mb.feed('s', 'o', '::agent4d {"id":"m","phase":"비밀 단계","host":"h1","title":"t"}\n', T(0));
  assert.equal(u[0].job.phase, null); assert.equal(u[0].job.line, null); assert.equal(u[0].job.host, null); assert.equal(u[0].job.title, 't');
  // 마스킹
  u = new JobBook({}).feed('s', 'o', '::agent4d {"id":"r","phase":"token=abcd1234secret"}\n', T(0)); // gitleaks:allow (시험용 가짜 값)
  assert.doesNotMatch(u[0].job.phase + u[0].job.line, /abcd1234secret/);
});

test('설정 읽기: 사용자 + 프로젝트(.agent4d/jobs.json), 깨진 파일은 오류만', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-jobs-'));
  try {
    const st = path.join(d, 'state'), cwd = path.join(d, 'proj');
    fs.mkdirSync(st); fs.mkdirSync(path.join(cwd, '.agent4d'), { recursive: true });
    assert.equal(loadJobRules({ stateDir: st, cwd }), null);
    fs.writeFileSync(path.join(st, 'jobs.json'), JSON.stringify({ staleSec: 99, sets: [{ name: 'u', rules: [{ on: 'beat', re: 'u' }] }] }));
    fs.writeFileSync(path.join(cwd, '.agent4d', 'jobs.json'), JSON.stringify({ sets: [{ name: 'p', rules: [{ on: 'beat', re: 'p' }] }] }));
    const R = loadJobRules({ stateDir: st, cwd });
    assert.deepEqual(R.sets.map((s) => s.name), ['p', 'u'], '프로젝트 묶음이 앞');
    fs.writeFileSync(path.join(st, 'jobs.json'), '{ nope');
    const R2 = loadJobRules({ stateDir: st, cwd });
    assert.equal(R2.sets.length, 1); assert.equal(R2.errors.length, 1);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// examples/<이름>/jobs.json + fixture.json(실물 캡처 줄)이 있으면 모두 돌린다(개발 레포 전용 예시, 공개판에는 없음)
test('예시 규칙 묶음(examples/*/jobs.json): 컴파일 오류 0 · 캡처 줄 → 기대 작업', () => {
  const ex = path.join(ROOT, 'examples');
  let dirs = [];
  try { dirs = fs.readdirSync(ex, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => path.join(ex, x.name)); } catch {}
  for (const dir of dirs) {
    const jf = path.join(dir, 'jobs.json'), ff = path.join(dir, 'fixture.json');
    if (!fs.existsSync(jf)) continue;
    const rules = compileJobRules(JSON.parse(fs.readFileSync(jf, 'utf8')));
    assert.deepEqual(rules.errors, [], dir);
    if (!fs.existsSync(ff)) continue;
    const fx = JSON.parse(fs.readFileSync(ff, 'utf8'));
    const bk = new JobBook({ rules, ctx: fx.ctx });
    for (const s of fx.streams) {
      bk.feed(s.key, s.key, s.lines.join('\n') + '\n', s.ts, { owner: s.owner, file: !!s.file });
      const got = bk.jobsOf(s.key);
      for (const e of s.expect) {
        const j = got.get(e.id);
        assert.ok(j, `${path.basename(dir)} ${s.key}: 작업 ${e.id} 없음 (있음: ${[...got.keys()]})`);
        for (const k of ['state', 'phase', 'stale', 'host', 'rc']) if (k in e) assert.equal(j[k], e[k], `${s.key} ${e.id}.${k}`);
        if (e.progress) assert.equal(`${j.progress.n}/${j.progress.total}`, e.progress);
        if (e.beatLocal) assert.equal(localHM(j.beatAt), e.beatLocal);
        if (e.untilLocal) assert.equal(localYMDHM(j.until), e.untilLocal);
      }
    }
  }
});

// ── 라이브·재생 e2e ──
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-jobs-e2e-'));
  const projects = path.join(root, 'projects'), sessions = path.join(root, 'sessions'), tmpClaude = path.join(root, 'tmp', 'claude');
  const cwd = 'D:\\work\\jobs';
  const enc = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
  const proj = path.join(projects, enc(cwd));
  const tasks = path.join(tmpClaude, enc(cwd), SID, 'tasks');
  for (const d of [sessions, proj, tasks]) fs.mkdirSync(d, { recursive: true });
  const P = Date.now() - 2 * 86400_000;
  const T = (sec) => new Date(P + sec * 1000).toISOString();
  const base = { sessionId: SID, cwd, version: '2.1.309', entrypoint: 'cli' };
  const A = (sec, block) => ({ type: 'assistant', timestamp: T(sec), ...base, message: { model: 'claude-test-1', role: 'assistant', content: [block] } });
  const TU = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const R = (sec, id, content, tur) => ({ type: 'user', timestamp: T(sec), ...base, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: false }] }, toolUseResult: tur });
  const N = (sec, tid, ev) => ({ type: 'user', timestamp: T(sec), ...base, origin: { kind: 'task-notification' }, message: { role: 'user', content: `<task-notification>\n<task-id>${tid}</task-id>\n<summary>Monitor event: &quot;회차 감시&quot;</summary>\n<event>${ev}</event>\n</task-notification>` } });
  const bgOut = path.join(tasks, 'jbg001.output');
  fs.writeFileSync(bgOut, [
    'prep',
    '::agent4d {"id":"build","title":"빌드","state":"running","phase":"compile","progress":"1/3"}',
    '  2/3 · ok 1/1',
    '::agent4d {"id":"build","phase":"link","progress":"3/3"}',
    '::agent4d {"id":"build","state":"done","rc":0}',
    '::agent4d {"id":"deploy","state":"waiting","until":"2099-01-01T00:00:00Z"}',
  ].join('\n') + '\n');
  const lines = [
    A(0, { type: 'text', text: '시작' }),
    A(10, TU('toolu_jbg', 'Bash', { command: 'node build.mjs', description: '빌드', run_in_background: true })),
    R(11, 'toolu_jbg', `Command running in background with ID: jbg001. Output is being written to: ${bgOut}`, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'jbg001' }),
    A(20, TU('toolu_jm1', 'Monitor', { description: '회차 감시', timeout_ms: 60000 })),
    R(21, 'toolu_jm1', 'Monitor started (task jmon01)', { taskId: 'jmon01', timeoutMs: 60000, persistent: false }),
    N(30, 'jmon01', '[회차·팔] 10:00:00 runner — 1단계 시작'),
    N(40, 'jmon01', '[회차·팔] 10:00:10 runner — 2단계 시작'),
    N(81, 'jmon01', '[Monitor expired after 60s]'),
    A(90, TU('toolu_jm2', 'Monitor', { description: '회차 감시', timeout_ms: 600000 })),
    R(91, 'toolu_jm2', 'Monitor started (task jmon02)', { taskId: 'jmon02', timeoutMs: 600000, persistent: false }),
    N(100, 'jmon02', '[회차·팔] 10:01:00 runner — 3단계 시작'),
    N(110, 'jmon02', '[회차] 락이 풀렸다'),
    { type: 'system', subtype: 'turn_duration', durationMs: 1000, timestamp: T(120), ...base },
  ];
  fs.writeFileSync(path.join(proj, `${SID}.jsonl`), [{ type: 'user', timestamp: T(0), ...base, origin: { kind: 'human' }, message: { role: 'user', content: '작업 시험' } }, ...lines].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const old = (P + 300_000) / 1000;
  for (const f of [path.join(proj, `${SID}.jsonl`), bgOut]) fs.utimesSync(f, old, old);
  return { root, projects, sessions, tmpClaude };
}
const SID = 'dddddddd-4444-4444-8444-dddddddddddd';
const E2E_RULES = compileJobRules({ sets: [{ name: 'round', streams: { kind: 'monitor' }, rules: [
  { on: 'end', re: '^\\[회차\\] 락이 풀렸다', job: 'daily' },
  { on: 'phase', re: '^\\[회차·팔\\] (?<time>\\d\\d:\\d\\d:\\d\\d) \\S+ — (?<phase>\\S+)', job: 'daily', title: '일일 회차' },
] }, { name: 'meas', streams: { kind: 'bash-bg' }, rules: [{ on: 'progress', re: '^\\s+(?<n>\\d+)/(?<total>\\d+) · ok', job: 'run' }] }] });

test('라이브·재생 같은 작업 노드: 규약(bg) · 대체 규칙(Monitor) · 재무장 Monitor 가 같은 노드를 잇는다', async () => {
  const fx = makeFixture();
  const prevTmp = process.env.CCVIZ_CLAUDE_TMP;
  process.env.CCVIZ_CLAUDE_TMP = fx.tmpClaude;
  try {
    const index = new SessionIndex({ projectsDir: fx.projects, sessionsDir: fx.sessions });
    await index.refresh();
    for (const e of index.entries.values()) e.birthtimeMs = e.mtimeMs;
    const rt = new RootRuntime({ sessionId: SID, index, jobRules: E2E_RULES });
    await rt.start(); rt.close();
    const liveJobs = [...rt.graph.nodes.values()].filter((n) => n.meta.job);
    const data = await buildReplay({ sessionId: SID, index, jobRules: E2E_RULES });
    const last = new Map();
    for (const x of data.events) {
      const e = x.e || x;
      if (e.type === 'node-add' && e.node.meta?.job) last.set(e.nodeId, structuredClone(e.node));
      else if (e.type === 'node-update' && last.has(e.nodeId)) { const n = last.get(e.nodeId); const { meta, ...p } = e.patch; Object.assign(n, p); if (meta) Object.assign(n.meta, meta); }
    }
    const pick = (n) => ({ id: n.id, parentId: n.parentId, status: n.status, state: n.meta.job.state, phase: n.meta.job.phase, progress: n.meta.job.progress, rc: n.meta.job.rc });
    const liveP = liveJobs.map(pick).sort((a, b) => (a.id < b.id ? -1 : 1));
    const repP = [...last.values()].map(pick).sort((a, b) => (a.id < b.id ? -1 : 1));
    assert.deepEqual(repP, liveP);
    const byId = new Map(liveP.map((j) => [j.id, j]));
    // 규약이 이긴다: bg 스트림의 '  2/3 · ok' 줄(대체 규칙 run)은 규약 줄 뒤라 무시 → run 작업 없음
    assert.deepEqual([...byId.keys()].sort(), ['j:b:jbg001:build', 'j:b:jbg001:deploy', 'j:m:jmon01:daily']);
    assert.deepEqual(byId.get('j:b:jbg001:build'), { id: 'j:b:jbg001:build', parentId: 'b:jbg001', status: 'done', state: 'done', phase: 'link', progress: { n: 3, total: 3 }, rc: 0 });
    assert.equal(byId.get('j:b:jbg001:deploy').status, 'idle');
    const daily = byId.get('j:m:jmon01:daily');
    assert.equal(daily.parentId, 'm:jmon02', '재무장 Monitor 아래로 옮김');
    assert.equal(daily.state, 'done'); assert.equal(daily.phase, '3단계');
    // 재생: 작업 node-add 는 첫 줄 시각 뒤 · 대기 합성 없음
    const adds = data.events.map((x) => x.e || x).filter((e) => e.type === 'node-add' && e.node.meta?.job);
    assert.ok(adds.every((e) => Date.parse(e.ts) >= Date.parse(data.events[0].e?.ts || data.events[0].ts)));
    // 상태 바뀜 순서가 라이브와 같다(재생 5단계의 대기 합성이 작업 노드에 끼어들지 않음)
    const seq = (evs) => evs.filter((e) => e.type === 'node-update' && e.nodeId.startsWith('j:') && e.patch.status).map((e) => `${e.nodeId}>${e.patch.status}`);
    assert.deepEqual(seq(data.events.map((x) => x.e || x)), seq(rt.graph.ring));
  } finally {
    if (prevTmp == null) delete process.env.CCVIZ_CLAUDE_TMP; else process.env.CCVIZ_CLAUDE_TMP = prevTmp;
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});
