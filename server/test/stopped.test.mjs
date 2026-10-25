// '중지됨' 판정: 일부러 끈 백그라운드 작업은 오류(빨강)가 아니라 stopped.
// 이 PC 실제 기록에서 본 모양(끄는 셸 명령 직후 failed 알림·TaskStop·시간 한도 killed·세션 종료 정리 stopped)을 합성 transcript 로 재현한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { buildReplay } from '../replay.mjs';
import { isKillCommand, exitCodeOf, parseTaskNotification, stopReasonOfNotification, isEndedStatus } from '../parse.mjs';

const M = 'eeeeeeee-5555-4555-8555-555555555555';
const enc = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
let root, index;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-stop-'));
  const projects = path.join(root, 'projects');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  const cwd = 'D:\\work\\stopdemo';
  const now = Date.now();
  const T = (sec) => new Date(now - 900_000 + sec * 1000).toISOString();
  const base = { sessionId: M, cwd, version: '2.1.309', entrypoint: 'cli' };
  const A = (sec, block) => ({ type: 'assistant', timestamp: T(sec), ...base, message: { role: 'assistant', model: 'm', content: [block] } });
  const R = (sec, id, text, tur) => ({ type: 'user', timestamp: T(sec), ...base, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, toolUseResult: tur });
  const BG = (sec, id, desc, taskId) => [
    A(sec, { type: 'tool_use', id, name: 'Bash', input: { command: `node serve.mjs # ${desc}`, description: desc, run_in_background: true } }),
    R(sec + 1, id, `Command running in background with ID: ${taskId}.`, { stdout: '', stderr: '', backgroundTaskId: taskId }),
  ];
  const NOTE = (sec, ids, status, summary) => ({
    type: 'user', timestamp: T(sec), ...base, origin: { kind: 'task-notification' },
    message: { role: 'user', content: `<task-notification>\n${ids.map((x) => `<task-id>${x}</task-id>`).join('\n')}\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>` },
  });
  const FG = (sec, id, command, desc) => [
    A(sec, { type: 'tool_use', id, name: 'Bash', input: { command, description: desc } }),
    R(sec + 1, id, 'ok', { stdout: 'ok', stderr: '' }),
  ];
  const recs = [
    { type: 'user', timestamp: T(1), ...base, message: { role: 'user', content: '시험 서버 띄워 보고 꺼 주세요' } },
    // b1: 끄는 명령(taskkill) 직후 failed exit 1 → 중지됨(kill-cmd)
    ...BG(10, 'tu_b1', '시험 서버 7799', 'b1'),
    ...FG(60, 'tu_k1', 'taskkill //PID 86476 //F 2>&1; sleep 1', '시험 서버 끄기'),
    NOTE(62, ['b1'], 'failed', 'Background command "시험 서버 7799" failed with exit code 1'),
    // b2: 진짜 실패(끄는 명령 없음) → 오류 유지
    ...BG(100, 'tu_b2', '빌드', 'b2'),
    NOTE(140, ['b2'], 'failed', 'Background command "빌드" failed with exit code 2'),
    // b3: TaskStop → 중지됨(taskstop). 알림은 오지 않는다(실측)
    ...BG(150, 'tu_b3', '개발 서버', 'b3'),
    A(170, { type: 'tool_use', id: 'tu_stop', name: 'TaskStop', input: { task_id: 'b3' } }),
    R(171, 'tu_stop', 'Successfully stopped task: b3', { message: 'Successfully stopped task: b3', task_id: 'b3', task_type: 'local_bash' }),
    // b4: 신호 종료(143) → 중지됨(signal)
    ...BG(200, 'tu_b4', '감시 스크립트', 'b4'),
    NOTE(260, ['b4'], 'failed', 'Background command "감시 스크립트" failed with exit code 143'),
    // b5: 시간 한도 killed → 중지됨(time-limit)
    ...BG(300, 'tu_b5', '긴 작업', 'b5'),
    NOTE(360, ['b5'], 'killed', 'Background command "긴 작업" was stopped after reaching its background time limit'),
    // b6·b7: 세션 종료 정리(여러 task-id + __orphan_summary__) → 둘 다 중지됨(orphan)
    ...BG(400, 'tu_b6', '정리 대상 1', 'b6'),
    ...BG(402, 'tu_b7', '정리 대상 2', 'b7'),
    NOTE(500, ['b6', 'b7', '__orphan_summary__:shell'], 'stopped', "2 background shell command tasks didn't finish before the previous session ended."),
    // b8: failed 알림이 기록 순서상 끄는 명령보다 먼저 읽힘(끄는 명령 시각은 알림보다 이름) → 고쳐 써서 중지됨
    ...BG(600, 'tu_b8', '정적 서버', 'b8'),
    NOTE(650, ['b8'], 'failed', 'Background command "정적 서버" failed with exit code 1'),
    ...FG(648, 'tu_k2', 'powershell -c "Get-Process node | Stop-Process -Force"', '정적 서버 끄기'),
    // b9: 끄는 명령이 있었지만 40초 뒤 failed → 오류 유지(시간 창 밖)
    ...BG(700, 'tu_b9', '다른 작업', 'b9'),
    ...FG(720, 'tu_k3', 'kill -9 $PID', '다른 것 끄기'),
    NOTE(761, ['b9'], 'failed', 'Background command "다른 작업" failed with exit code 1'),
  ];
  const dir = path.join(projects, enc(cwd));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${M}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  index = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'sessions') });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('파서: 끄는 명령·종료 코드·여러 task-id·중지 사유', () => {
  for (const c of ['taskkill //PID 1 //F', 'Get-Process x | Stop-Process -Force', 'kill -9 $pid', 'kill %1', 'pkill -f vite', 'fuser -k 8000/tcp', '$p.Kill()', 'npx kill-port 3000', 'a && kill 1234'])
    assert.ok(isKillCommand(c), c);
  for (const c of ['grep -n kill src', 'echo killed', 'git log --grep=taskkillx', 'node skill.mjs', null]) assert.ok(!isKillCommand(c), String(c));
  assert.equal(exitCodeOf('Background command "x" failed with exit code 143'), 143);
  assert.equal(exitCodeOf('Monitor "x" script failed (exit 4)'), 4);
  assert.equal(exitCodeOf('completed'), null);
  const n = parseTaskNotification('<task-notification>\n<task-id>a</task-id>\n<task-id>b</task-id>\n<status>stopped</status>\n</task-notification>');
  assert.deepEqual(n.taskIds, ['a', 'b']);
  assert.equal(n.taskId, 'a');
  assert.equal(stopReasonOfNotification(n), 'orphan');
  assert.equal(stopReasonOfNotification({ status: 'killed', summary: 'was stopped after reaching its background time limit' }), 'time-limit');
  assert.equal(stopReasonOfNotification({ status: 'killed', summary: '' }), 'killed');
  assert.equal(stopReasonOfNotification({ status: 'failed' }), null);
  assert.ok(isEndedStatus('stopped') && isEndedStatus('done') && isEndedStatus('error') && !isEndedStatus('idle'));
});

const EXPECT = {
  b1: ['stopped', 'kill-cmd'], b2: ['error', null], b3: ['stopped', 'taskstop'], b4: ['stopped', 'signal'],
  b5: ['stopped', 'time-limit'], b6: ['stopped', 'orphan'], b7: ['stopped', 'orphan'], b8: ['stopped', 'kill-cmd'], b9: ['error', null],
};

for (const offline of [false, true]) {
  test(`${offline ? '재생(offline)' : '라이브 첫 적재'}: 일부러 끈 작업은 stopped(사유 포함), 진짜 실패·시간 창 밖은 error`, async () => {
    await index.refresh();
    const rt = new RootRuntime({ sessionId: M, index, offline });
    try {
      if (offline) await rt.loadOffline(); else await rt.start();
      for (const [tid, [st, reason]] of Object.entries(EXPECT)) {
        const n = rt.graph.get(`b:${tid}`);
        assert.ok(n, `b:${tid} 노드`);
        assert.equal(n.status, st, `b:${tid} 상태`);
        if (reason) { assert.equal(n.meta.stopReason, reason, `b:${tid} 사유`); assert.equal(n.meta.killed, true); }
        assert.ok(n.endedAt, `b:${tid} endedAt`);
      }
      // 고쳐 쓴 b8 은 이벤트 열에도 error 가 남지 않는다(재생에서 빨간 섬광·오류음 없음)
      const b8 = rt.graph.ring.filter((e) => e.nodeId === 'b:b8' && e.type === 'node-update' && e.patch?.status);
      assert.deepEqual(b8.map((e) => e.patch.status), ['stopped']);
    } finally { rt.close(); }
  });
}

test('라이브: 이미 오류로 보낸 뒤 늦게 본 끄는 명령이면 stopped 갱신 이벤트를 새로 낸다', async () => {
  await index.refresh();
  const rt = new RootRuntime({ sessionId: M, index });
  try {
    await rt.start();
    const g = rt.graph;
    assert.equal(g.loading, false);
    const b2 = g.get('b:b2');
    assert.equal(b2.status, 'error');
    // b2 실패 알림 시각(140초) 직전에 끈 명령이 있었다고 알려 준다(다른 파일에서 늦게 읽힌 경우)
    const seen = [];
    const off = g.subscribe((e) => seen.push(e));
    rt._noteKill(Date.parse(b2.endedAt) - 3000);
    off();
    assert.equal(b2.status, 'stopped');
    assert.equal(b2.meta.stopReason, 'kill-cmd');
    assert.ok(seen.some((e) => e.type === 'node-update' && e.nodeId === 'b:b2' && e.patch.status === 'stopped'));
  } finally { rt.close(); }
});

test('재생 데이터: stopped 는 끝 상태로 다루고 오류 눈금에 세지 않는다', async () => {
  await index.refresh();
  const data = await buildReplay({ sessionId: M, index });
  const fin = [...data.finalState.nodes.values()];
  assert.equal(fin.filter((n) => n.status === 'stopped').length, 7);
  assert.equal(fin.filter((n) => n.status === 'error').length, 2);
  const errEv = data.events.filter((e) => e.type === 'node-update' && e.patch?.status === 'error').map((e) => e.nodeId).sort();
  assert.deepEqual(errEv, ['b:b2', 'b:b9']);
});
