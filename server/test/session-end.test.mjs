// 띄운 세션이 끝난 bg 작업 — '세션 종료로 끊김'(stopped · session-end, 종료 코드 미상)
// 끝 근거: cost-state(프로세스 끝 기록, '/clear' 뒤 것은 제외) · 프로세스 기록 부재(크래시·재부팅). 살아 있는 세션의 긴 작업은 닫지 않는다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime, SESSION_END } from '../session.mjs';
import { buildReplay } from '../replay.mjs';
import { encodeCwd } from '../parse.mjs';

const cwd = 'D:\\work\\sessend';
const S = {
  exit: '5e5e0001-0000-4000-8000-000000000001', // cost-state 로 끝남
  late: '5e5e0002-0000-4000-8000-000000000002', // 끊긴 뒤 끝 표지가 붙음
  alive: '5e5e0003-0000-4000-8000-000000000003', // 프로세스가 살아 있음(긴 작업) — 반례
  clear: '5e5e0004-0000-4000-8000-000000000004', // '/clear' 로 끝남(프로세스는 산다) — 반례
  crash: '5e5e0005-0000-4000-8000-000000000005', // cost-state 없음 · 프로세스 기록 없음
  stale: '5e5e0006-0000-4000-8000-000000000006', // cost-state 없음 · 남은 pid 파일의 pid 가 죽음
  desk: '5e5e0007-0000-4000-8000-000000000007', // 프로세스 기록을 쓰는지 모르는 진입점 — 기록 부재를 증거로 쓰지 않음
  fresh: '5e5e0008-0000-4000-8000-000000000008', // 방금 끝남 — 라이브는 GRACE_MS 동안 기다린다
};
const line = (r) => JSON.stringify(r) + '\n';
let root, projects, sessions, dir, outDir, t0, index;
const saved = { ...SESSION_END };
const T = (s) => new Date(t0 + s * 1000).toISOString();
const base = (sid, ep = 'cli') => ({ sessionId: sid, cwd, version: '2.1.310', entrypoint: ep });
const U = (sid, s, text, ep) => ({ type: 'user', timestamp: T(s), ...base(sid, ep), message: { role: 'user', content: text } });
const A = (sid, s, block, ep) => ({ type: 'assistant', timestamp: T(s), ...base(sid, ep), message: { role: 'assistant', model: 'm', content: [block] } });
const BG = (sid, s, id, taskId, ep) => [
  A(sid, s, { type: 'tool_use', id, name: 'Bash', input: { command: `python -u ${taskId}.py`, description: taskId, run_in_background: true } }, ep),
  { type: 'user', timestamp: T(s + 1), ...base(sid, ep), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id,
    content: `Command running in background with ID: ${taskId}. Output is being written to: ${path.join(outDir, taskId + '.output')}` }] },
    toolUseResult: { stdout: '', stderr: '', backgroundTaskId: taskId } },
];
const END = (sid, s, ep) => [
  A(sid, s, { type: 'text', text: '에이전트를 기다립니다.' }, ep),
  { type: 'last-prompt', lastPrompt: 'x', sessionId: sid },
  { type: 'cost-state', sessionId: sid, totalCostUSD: 1, totalDuration: 1000 },
];
const out = (taskId, text, s) => {
  const f = path.join(outDir, taskId + '.output');
  fs.writeFileSync(f, text);
  const d = new Date(t0 + s * 1000); fs.utimesSync(f, d, d);
};
const writeSession = (sid, recs, s) => {
  const f = path.join(dir, `${sid}.jsonl`);
  fs.writeFileSync(f, recs.map(line).join(''));
  const d = new Date(t0 + s * 1000); fs.utimesSync(f, d, d);
};

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-sessend-'));
  projects = path.join(root, 'projects');
  sessions = path.join(root, 'sessions');
  dir = path.join(projects, encodeCwd(cwd));
  outDir = path.join(root, 'tasks');
  for (const d of [sessions, dir, outDir]) fs.mkdirSync(d, { recursive: true });
  t0 = Date.now() - 3600_000; // 1시간 전
  // exit: b_cut 은 끝 표지 없이 95% 에서 멎음(출력 20초) · b_after 는 세션 끝(60초) 뒤에도 썼음(90초) · b_ok 는 정상 끝
  writeSession(S.exit, [U(S.exit, 0, '시험'), ...BG(S.exit, 5, 'tu_cut', 'b_cut'), ...BG(S.exit, 6, 'tu_after', 'b_after'), ...BG(S.exit, 7, 'tu_ok', 'b_ok'), ...END(S.exit, 60)], 60);
  out('b_cut', '........ [ 95%]\n........', 20);
  out('b_after', 'still writing\n', 90);
  out('b_ok', 'ok\n[exited with code 0]\n', 30);
  writeSession(S.late, [U(S.late, 0, '시험'), ...BG(S.late, 5, 'tu_late', 'b_late'), ...END(S.late, 60)], 60);
  out('b_late', 'running\n', 20);
  // alive: 지금 도는 프로세스(이 시험 프로세스 pid)가 그 세션의 기록을 가짐 · transcript 는 1시간째 조용
  writeSession(S.alive, [U(S.alive, 0, '시험'), ...BG(S.alive, 5, 'tu_long', 'b_long')], 10);
  out('b_long', 'epoch 1\n', 20);
  fs.writeFileSync(path.join(sessions, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: S.alive, cwd, kind: 'interactive', entrypoint: 'cli', status: 'idle' }));
  // clear: '/clear' 대기열 → dequeue → cost-state(같은 프로세스가 새 세션으로 이어 감)
  writeSession(S.clear, [U(S.clear, 0, '시험'), ...BG(S.clear, 5, 'tu_clr', 'b_clr'),
    { type: 'queue-operation', operation: 'enqueue', timestamp: T(50), sessionId: S.clear, content: '/clear' },
    { type: 'queue-operation', operation: 'dequeue', timestamp: T(50), sessionId: S.clear },
    { type: 'cost-state', sessionId: S.clear, totalCostUSD: 1 }], 50);
  out('b_clr', 'serving\n', 20);
  // crash: 마지막 기록 40초 · 기록 없음 / stale: 죽은 pid 의 파일이 남음 / desk: 진입점 claude-desktop · 기록 없음
  writeSession(S.crash, [U(S.crash, 0, '시험'), ...BG(S.crash, 5, 'tu_cr', 'b_cr'), A(S.crash, 40, { type: 'text', text: '…' })], 40);
  out('b_cr', 'half\n', 30);
  writeSession(S.stale, [U(S.stale, 0, '시험'), ...BG(S.stale, 5, 'tu_st', 'b_st'), A(S.stale, 40, { type: 'text', text: '…' })], 40);
  out('b_st', 'half\n', 30);
  const dead = spawnSync(process.execPath, ['-e', '']).pid; // 이미 끝난 프로세스의 pid
  fs.writeFileSync(path.join(sessions, `${dead}.json`), JSON.stringify({ pid: dead, sessionId: S.stale, cwd, kind: 'interactive', entrypoint: 'cli', status: 'busy' }));
  writeSession(S.desk, [U(S.desk, 0, '시험', 'claude-desktop'), ...BG(S.desk, 5, 'tu_dk', 'b_dk', 'claude-desktop'), A(S.desk, 40, { type: 'text', text: '…' }, 'claude-desktop')], 40);
  out('b_dk', 'half\n', 30);
  index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
  await index.refresh();
});
after(() => { Object.assign(SESSION_END, saved); fs.rmSync(root, { recursive: true, force: true }); });

const live = async (sid, fn) => {
  const rt = new RootRuntime({ sessionId: sid, index, jobRules: null });
  await rt.start();
  try { rt.sweep(); await fn(rt.graph, rt); } finally { rt.close(); }
};
const cutOk = (n, endIso, msg) => {
  assert.equal(n.status, 'stopped', msg);
  assert.equal(n.meta.stopReason, 'session-end', msg);
  assert.equal(n.endedAt, endIso, msg);
  assert.equal(n.meta.run.ended, Date.parse(endIso), msg);
  assert.equal(n.meta.rc, undefined, '종료 코드 미상');
  assert.equal(n.meta.run.rc, undefined, '종료 코드 미상');
};

test('라이브: cost-state 로 끝난 세션의 열린 bg → 세션 종료로 끊김(끝 = max(세션 마지막 기록, 출력 수정 시각)) · 정상 끝은 그대로', async () => {
  await live(S.exit, (g) => {
    cutOk(g.get('b:b_cut'), T(60), '95% 에서 멎은 작업');
    cutOk(g.get('b:b_after'), T(90), '세션 끝 뒤에도 쓴 출력 — 마지막 출력 시각');
    assert.equal(g.get('b:b_ok').status, 'done');
    assert.equal(g.get('b:b_ok').meta.rc, 0);
  });
});

test('라이브: 끊긴 뒤 끝 표지가 붙으면 표지를 따른다(끊김은 추정)', async () => {
  await live(S.late, async (g, rt) => {
    cutOk(g.get('b:b_late'), T(60));
    fs.appendFileSync(path.join(outDir, 'b_late.output'), '[exited with code 0]\n');
    await rt.pollAll({ all: true });
    const n = g.get('b:b_late');
    assert.equal(n.status, 'done');
    assert.equal(n.meta.rc, 0);
    assert.ok(n.endedAt > T(60), '진짜 끝 시각');
  });
});

test('반례: 프로세스가 살아 있는 세션의 긴 작업 · /clear 로 끝난 세션 · 기록을 안 쓰는 진입점은 닫지 않는다(라이브·재생)', async () => {
  Object.assign(SESSION_END, { GRACE_MS: 0, PROC_GONE_MS: 0 }); // 조용함·지속 문턱을 없애도 프로세스 증거만으로 가린다
  try {
    for (const [sid, id] of [[S.alive, 'b:b_long'], [S.clear, 'b:b_clr'], [S.desk, 'b:b_dk']]) {
      await live(sid, (g) => {
        const n = g.get(id);
        assert.ok(n, id);
        assert.ok(!['done', 'error', 'stopped'].includes(n.status), `${id} 라이브 ${n.status}`);
      });
      const data = await buildReplay({ sessionId: sid, index, jobRules: null });
      const n = data.finalState.nodes.get(id);
      assert.ok(!['done', 'error', 'stopped'].includes(n.status), `${id} 재생 ${n.status}`);
      assert.equal(data.stats.finalMismatch, 0);
    }
  } finally { Object.assign(SESSION_END, saved); }
});

test('라이브: cost-state 없는 크래시(기록 없음·죽은 pid) → 기록 부재가 PROC_GONE_MS 이어지고 transcript 가 조용하면 끊김', async () => {
  for (const [sid, id] of [[S.crash, 'b:b_cr'], [S.stale, 'b:b_st']]) {
    await live(sid, async (g, rt) => {
      assert.ok(!['stopped'].includes(g.get(id).status), '첫 관측에서는 닫지 않음(PROC_GONE_MS)');
      const w = rt.watchers.get(sid);
      w.procGoneAt -= SESSION_END.PROC_GONE_MS; // 지속 시간이 지난 것으로
      rt.sweep();
      cutOk(g.get(id), T(40), sid);
    });
  }
});

test('라이브: 방금 끝난 세션은 GRACE_MS 동안 끝 표지를 기다린다', async () => {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const f = path.join(dir, `${S.fresh}.jsonl`);
  const recs = [U(S.fresh, 0, '시험'), ...BG(S.fresh, 5, 'tu_fr', 'b_fr'), ...END(S.fresh, 60)];
  recs[recs.length - 3].timestamp = iso(now - 2000); // 세션 끝 = 2초 전
  fs.writeFileSync(f, recs.map(line).join(''));
  fs.writeFileSync(path.join(outDir, 'b_fr.output'), 'tail\n');
  await index.refresh();
  await live(S.fresh, (g, rt) => {
    assert.ok(g.get('b:b_fr').status !== 'stopped', 'GRACE_MS 안');
    rt._cutPending.set('b:b_fr', iso(now - SESSION_END.GRACE_MS - 5000)); // 세션 끝이 문턱보다 오래된 것으로
    const o = rt.outputs.get('b:b_fr'); if (o?.tail) o.tail.mtimeMs = now - SESSION_END.GRACE_MS - 5000;
    g.get('b:b_fr').lastActivityAt = iso(now - SESSION_END.GRACE_MS - 5000);
    rt.sweep();
    assert.equal(g.get('b:b_fr').meta.stopReason, 'session-end');
  });
});

test('재생: 라이브와 같은 규칙(cost-state · 크래시) — 끊김 시각·최종 상태 일치, finalMismatch 0', async () => {
  const data = await buildReplay({ sessionId: S.exit, index, jobRules: null });
  cutOk(data.finalState.nodes.get('b:b_cut'), T(60));
  cutOk(data.finalState.nodes.get('b:b_after'), T(90));
  assert.equal(data.finalState.nodes.get('b:b_ok').status, 'done');
  const ev = data.events.find((e) => e.nodeId === 'b:b_cut' && e.type === 'node-update' && e.patch?.meta?.stopReason === 'session-end');
  assert.equal(ev.ts, T(60));
  assert.equal(data.stats.finalMismatch, 0);
  for (const [sid, id] of [[S.crash, 'b:b_cr'], [S.stale, 'b:b_st']]) {
    const d = await buildReplay({ sessionId: sid, index, jobRules: null });
    cutOk(d.finalState.nodes.get(id), T(40), sid);
    assert.equal(d.stats.finalMismatch, 0);
  }
  // 세션 폴더를 못 읽는 색인(보관함 등)은 기록 부재를 증거로 쓰지 않는다
  const ix2 = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'no-such-dir') });
  await ix2.refresh();
  const d2 = await buildReplay({ sessionId: S.crash, index: ix2, jobRules: null });
  assert.notEqual(d2.finalState.nodes.get('b:b_cr').status, 'stopped');
});
