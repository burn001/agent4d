// 분리 측정 — 대기 기록 어댑터(내장): `.autopilot/WAIT-<축>` → 사슬 로그 끝부분 · `.lane_*.done` 수 → 러너(없으면 기동기) 아래 작업 노드.
// 기록이 지워지거나 사슬 PID 가 끝나면 작업을 끝으로 닫는다. 합성 레포, PID 생존은 주입.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseWaitRecord, parseChainTail, kstLineMs, loopWaits, waitJobView } from '../loop-wait.mjs';
import { Graph } from '../graph.mjs';

const w = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const NOW = Date.UTC(2026, 10, 4, 12, 45, 0); // 11-04 21:45 KST
const LOG = [
  '[11-04 21:28:49 KST] 사슬 시작',
  '[11-04 21:30:15 KST] card_svc 끝난 갈래 — 건너뛴다',
  '[11-04 21:30:24 KST] v_svc/c5_r2 회차 관문 — 예상 1800초',
  '열림 11-04 21:30:28 — 예상 1800초가 회차와 겹치지 않는다',
  '[11-04 21:30:28 KST] v_svc/c5_r2 회차 관문 rc=0',
  '[11-04 21:31:00 KST] trial 끝난 갈래 — 건너뛴다', '',
].join('\n');
function layout(root) {
  w(root, '.autopilot/relaunch.sh', '#!/bin/bash\nAXIS_QUEUE=(ops)\n');
  w(root, '.autopilot/WAIT-ops', 'pid=4242\nsig=20261104212849\nrecheck=2026-11-04 23:30\nkind=judge\nsince=2026-11-04 21:01:48\nrestart=.autopilot/scratch/q/s9/run.sh .autopilot/scratch/q/s9/run.log\n');
  w(root, '.autopilot/scratch/q/s9/run.log', LOG);
  const t = new Date(Date.UTC(2026, 10, 4, 12, 31, 0)); // 로그가 마지막으로 자란 때 = 14분 전
  fs.utimesSync(path.join(root, '.autopilot/scratch/q/s9/run.log'), t, t);
  for (const l of ['svc', 'trial', 'card_svc']) w(root, `.autopilot/scratch/q/s9/.lane_${l}.done`, '[11-04] rc=0\n');
  w(root, '.autopilot/scratch/q/s9/sub/.lane_deep.done', 'x'); // 한 단계 아래는 세지 않음
}

test('§134 파서: key=value 기록 · KST 줄 시각 · 마지막 갈래 줄(건너뛴 갈래 줄 뺌) · rc', () => {
  const r = parseWaitRecord('pid=1\nrestart=a.sh a.log\n# 주석\nbad line\n');
  assert.deepEqual(r, { pid: '1', restart: 'a.sh a.log' });
  assert.equal(kstLineMs('[11-04 21:30:28 KST] x', NOW), Date.UTC(2026, 10, 4, 12, 30, 28));
  assert.equal(new Date(kstLineMs('[12-31 23:00:00 KST] x', NOW)).getUTCFullYear(), 2025, '하루 넘게 미래면 지난해');
  const t = parseChainTail(LOG, NOW);
  assert.deepEqual([t.lane, t.text, t.rc], ['v_svc/c5_r2', '회차 관문 rc=0', 0]);
  assert.equal(t.last.line, 'trial 끝난 갈래 — 건너뛴다', '마지막 줄은 건너뛴 갈래 줄이라도 그대로');
  assert.equal(parseChainTail('', NOW), null);
});

test('§134 loopWaits: 레이아웃 · 한 단계 나열 · 로그 끝부분 · 갈래 수 · 뿌리 밖 로그는 안 읽음', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-wait-'));
  try {
    assert.deepEqual(loopWaits(root), [], '레이아웃 없음');
    layout(root);
    const ws = loopWaits(root, { nowMs: NOW, pidAlive: (p) => p === 4242 });
    assert.equal(ws.length, 1);
    const x = ws[0];
    assert.deepEqual([x.axis, x.pid, x.kind, x.alive, x.lanesDone, x.log], ['ops', 4242, 'judge', true, 3, '.autopilot/scratch/q/s9/run.log']);
    assert.equal(x.tail.lane, 'v_svc/c5_r2');
    const j = waitJobView(x, NOW);
    assert.equal(j.title, '분리 측정 · ops');
    assert.equal(j.state, 'running');
    assert.equal(j.phase, '끝난 갈래 3 · v_svc/c5_r2 회차 관문 rc=0');
    assert.equal(j.host, 'PID 4242');
    assert.equal(j.src, 'loop-wait');
    assert.equal(j.beatAt, new Date(NOW).toISOString(), '살아 있으면 분 단위 생존 박동(로그가 조용해도 정체 아님)');
    assert.equal(waitJobView(x, NOW, { privacy: 'minimal' }).line, null);
    w(root, '.autopilot/WAIT-esc', 'pid=1\nrestart=../outside.sh ../outside.log\n');
    const esc = loopWaits(root, { nowMs: NOW }).find((y) => y.axis === 'esc');
    assert.equal(esc.log, null, '루프 뿌리 밖 로그는 읽지 않음');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('§134 sweep: 러너 아래 작업 노드 → 기록 지움 = 끝 · 사슬 PID 끝 = 끝 · 끝난 기동기만 있으면 없음 · 재생은 아무것도 안 함', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-waitw-'));
  try {
    layout(root);
    const { RootRuntime } = await import('../session.mjs');
    const P = RootRuntime.prototype;
    const g = new Graph({ rootSessionId: 'S', localSeq: true });
    g.addNode({ id: 's:S', parentId: null, kind: 'main', label: 'm', sessionId: 'S', meta: { cwd: root } });
    g.finishLoad();
    let alive = true;
    const fake = { sessionId: 'S', graph: g, privacy: 'summary', offline: false, closed: false, spawnHints: new Map(), launcherByNode: new Map(),
      _jobEmit: P._jobEmit, _jobOwnerKey: P._jobOwnerKey };
    const sweep = (t) => { fake._waitAt = 0; P._loopWaitSweep.call(fake, t, { pidAlive: () => alive }); };
    sweep(NOW);
    assert.equal([...g.nodes.values()].filter((n) => n.meta?.job).length, 0, '기동기가 없으면 없음');
    g.addNode({ id: 'b:old', parentId: null, kind: 'bash-bg', label: '기동기 · x.sh', sessionId: 'S', status: 'done', startedAt: '2026-11-04T10:00:00Z', meta: { launcher: { script: 'x.sh' } } });
    sweep(NOW + 1000);
    assert.equal([...g.nodes.values()].filter((n) => n.meta?.job).length, 0, '끝난 기동기만 있으면 없음');
    g.addNode({ id: 'b:L', parentId: null, kind: 'bash-bg', label: '기동기 · loop-resume.sh', sessionId: 'S', status: 'idle', startedAt: '2026-11-04T12:28:00Z', meta: { launcher: { script: 'loop-resume.sh' } } });
    fake.launcherByNode.set('b:L', { cwd: root });
    sweep(NOW + 2000);
    const onL = g.get('j:b:L:meas-ops');
    assert.ok(onL, '러너가 없으면 기동기 아래');
    assert.equal(onL.kind, 'bash-bg');
    assert.equal(onL.label, '분리 측정 · ops');
    assert.equal(onL.status, 'active');
    g.addNode({ id: 'b:L-r1', parentId: 'b:L', kind: 'bash-bg', label: '러너 · autopilot.sh', sessionId: 'S', status: 'idle', startedAt: '2026-11-04T12:31:00Z', meta: { runner: { script: 'autopilot.sh', instance: 1, launcher: 'b:L' } } });
    sweep(NOW + 3000);
    assert.ok(isDone(g.get('j:b:L:meas-ops')), '러너가 뜨면 기동기 아래 것은 닫고');
    const onR = g.get('j:b:L-r1:meas-ops');
    assert.ok(onR && onR.parentId === 'b:L-r1' && !isDone(onR), '러너 아래에서 잇는다');
    fs.rmSync(path.join(root, '.autopilot', 'WAIT-ops'));
    sweep(NOW + 4000);
    assert.ok(isDone(g.get('j:b:L-r1:meas-ops')), '기록이 지워지면 끝');
    assert.match(g.get('j:b:L-r1:meas-ops').meta.job.phase, /^대기 기록 지워짐/);
    layout(root);
    sweep(NOW + 5000);
    alive = false;
    sweep(NOW + 6000);
    assert.match(g.get('j:b:L-r1:meas-ops').meta.job.phase, /^사슬 PID 끝남/);
    assert.ok(isDone(g.get('j:b:L-r1:meas-ops')));
    const n0 = g.nodes.size;
    fake.offline = true; alive = true;
    sweep(NOW + 7000);
    assert.equal(g.nodes.size, n0, '재생·보관함(offline)은 아무것도 안 함');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
const isDone = (n) => !!n && ['done', 'error', 'stopped'].includes(n.status);
