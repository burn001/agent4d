// 기동기(자율 실행 루프): 메인(서브에이전트)이 nohup·Start-Process 로 띄운 스크립트가 claude -p 를 되풀이 부르는 경우.
// 실제 transcript·스크립트는 쓰지 않고 합성 레포·transcript 로 재현한다(자율 러너의 relaunch.sh → autopilot.sh 모양).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { detectLaunch, analyzeLaunch, LauncherIndex, cwdMatches } from '../launcher.mjs';
import { createRealSource } from '../overview.mjs';
import { buildReplay } from '../replay.mjs';

const M = 'a1a1a1a1-1111-4111-8111-111111111111'; // 기동한 메인(서브에이전트 안에서 기동)
const M2 = 'a2a2a2a2-2222-4222-8222-222222222222'; // 재부팅 뒤 인계한 메인(같은 기동기를 다시 띄움)
const C1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const C2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const C3 = 'c3c3c3c3-0000-4000-8000-000000000003'; // M2 가 다시 띄운 뒤의 회차
const STRAY = 'dddddddd-0000-4000-8000-000000000004'; // 다른 cwd 의 sdk-cli(붙으면 안 됨)
const M3 = 'a3a3a3a3-3333-4333-8333-333333333333'; // 서로 다른 기동기 둘을 거의 같이 띄움
const C4 = 'c4c4c4c4-0000-4000-8000-000000000005';
const enc = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');

let root, index, repo, repo2, T, now;
const write = (dir, sid, recs) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${sid}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); };

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-launch-'));
  const projects = path.join(root, 'projects');
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  repo = path.join(root, 'repo');
  repo2 = path.join(root, 'repo2');
  for (const d of [path.join(repo, '.loop'), path.join(repo, 'scripts'), path.join(repo2, 'bin')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(repo, '.loop', 'relaunch.sh'), [
    '#!/usr/bin/env bash', '# 재기동기 — 러너가 끝나면 다시 띄운다. 설명 속 claude -p 는 실행이 아니다',
    'runner_alive() { ps | grep -F "bash scripts/other.sh" | grep -q .; }',
    'nohup bash scripts/loop.sh >> "$OUT/runner.out" 2>&1 < /dev/null &', '',
  ].join('\n'));
  fs.writeFileSync(path.join(repo, 'scripts', 'loop.sh'), [
    '#!/usr/bin/env bash', 'cd "$REPO_DIR" || exit 1', 'for i in $(seq 1 9999); do',
    `  printf '%s' "$(cat prompt.md)" | timeout "$T" claude -p --output-format json > "$o" 2>"$e"`, 'done', '',
  ].join('\n'));
  fs.writeFileSync(path.join(repo, 'scripts', 'other.sh'), '#!/usr/bin/env bash\nclaude -p --output-format text < p.md\n');
  fs.writeFileSync(path.join(repo, 'scripts', 'server.py'), '# loop 보기 서버\nLOOP = "scripts/loop.sh"\nprint("echo claude -p")\n');
  fs.writeFileSync(path.join(repo, 'scripts', 'noloop.sh'), '#!/usr/bin/env bash\necho "claude -p 는 여기 없다"\nsleep 10\n');
  fs.writeFileSync(path.join(repo2, 'bin', 'a.sh'), '#!/usr/bin/env bash\nclaude -p < a.md\n');
  fs.writeFileSync(path.join(repo2, 'bin', 'b.sh'), '#!/usr/bin/env bash\nclaude -p < b.md\n');

  now = Date.now();
  T = (sec) => new Date(now - 3000_000 + sec * 1000).toISOString();
  const base = (sid, c, ep = 'cli') => ({ sessionId: sid, cwd: c, version: '2.1.309', entrypoint: ep });
  const A = (sid, c, sec, block, extra = {}) => ({ type: 'assistant', timestamp: T(sec), ...base(sid, c), ...extra, message: { role: 'assistant', model: 'm', content: [block] } });
  const R = (sid, c, sec, id, text, tur = { stdout: text, stderr: '' }, extra = {}) => ({ type: 'user', timestamp: T(sec), ...base(sid, c), ...extra,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, toolUseResult: tur });
  const U = (sid, c, sec, text) => ({ type: 'user', timestamp: T(sec), ...base(sid, c), message: { role: 'user', content: text } });
  const pdir = path.join(projects, enc(repo));
  const msys = '/' + repo[0].toLowerCase() + repo.slice(2).replace(/\\/g, '/'); // D:\x → /d/x (Git Bash 꼴)
  write(pdir, M, [
    U(M, repo, 1, '재부팅 뒤 기동이다'),
    A(M, repo, 5, { type: 'tool_use', id: 'toolu_ag', name: 'Agent', input: { description: '루프 재기동', prompt: 'x', run_in_background: true } }),
    R(M, repo, 5.1, 'toolu_ag', 'launched', { isAsync: true, status: 'async_launched', agentId: 'ag1', description: '루프 재기동' }),
    A(M, repo, 20, { type: 'tool_use', id: 'toolu_srv', name: 'Bash', input: { command: 'nohup python scripts/server.py > s.out 2>&1 &' } }),
    R(M, repo, 20.5, 'toolu_srv', ''),
    A(M, repo, 21, { type: 'tool_use', id: 'toolu_no', name: 'Bash', input: { command: 'nohup bash scripts/noloop.sh &' } }),
    R(M, repo, 21.5, 'toolu_no', ''),
    A(M, repo, 30, { type: 'tool_use', id: 'toolu_m1', name: 'Monitor', input: { description: '루프 감시', command: 'bash mon.sh' } }),
    R(M, repo, 30.2, 'toolu_m1', 'ok', { taskId: 'mon1', timeoutMs: 60_000, persistent: false }),
    A(M, repo, 95, { type: 'tool_use', id: 'toolu_m2', name: 'Monitor', input: { description: '루프 감시', command: 'bash mon.sh' } }),
    R(M, repo, 95.2, 'toolu_m2', 'ok', { taskId: 'mon2', timeoutMs: 60_000, persistent: false }),
    A(M, repo, 300, { type: 'text', text: '대기' }),
  ]);
  // 서브에이전트가 Git Bash 꼴 경로로 cd 한 뒤 nohup … & disown 으로 재기동기를 띄운다(foreground 명령)
  const sub = path.join(pdir, M, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-ag1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: '루프 재기동', toolUseId: 'toolu_ag', spawnDepth: 1, requestShape: 'background', finished: true }));
  const sa = { isSidechain: true, agentId: 'ag1' };
  fs.writeFileSync(path.join(sub, 'agent-ag1.jsonl'), [
    { type: 'user', timestamp: T(6), ...base(M, repo), ...sa, message: { role: 'user', content: '루프를 재기동하라' } },
    A(M, repo, 10, { type: 'tool_use', id: 'toolu_launch', name: 'Bash', input: { description: '재기동기 분리 실행',
      command: `cd ${msys} && ls .loop/STOP 2>&1 | head -1; nohup bash .loop/relaunch.sh > .loop/relaunch.out 2>&1 < /dev/null & disown; echo launched $!` } }, sa),
    R(M, repo, 10.4, 'toolu_launch', 'launched 123', undefined, sa),
    A(M, repo, 50, { type: 'text', text: '기동 확인' }, sa),
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  // 재부팅 뒤 인계한 메인: PowerShell Start-Process 로 같은 재기동기
  write(pdir, M2, [
    U(M2, repo, 1990, '재부팅 뒤 기동이다'),
    A(M2, repo, 2000, { type: 'tool_use', id: 'toolu_launch2', name: 'PowerShell', input: {
      command: `Start-Process -FilePath "C:\\Program Files\\Git\\bin\\bash.exe" -ArgumentList '-c','"cd ${msys} && bash .loop/relaunch.sh > .loop/relaunch.out 2>&1 < /dev/null"' -WindowStyle Hidden; "ok"` } }),
    R(M2, repo, 2001, 'toolu_launch2', 'ok'),
    A(M2, repo, 2300, { type: 'text', text: '대기' }),
  ]);
  const sdk = (sid, c, sec, prompt, endSec) => write(path.join(projects, enc(c)), sid, [
    { type: 'user', timestamp: T(sec), ...base(sid, c, 'sdk-cli'), promptSource: 'sdk', message: { role: 'user', content: prompt } },
    { type: 'assistant', timestamp: T(endSec), ...base(sid, c, 'sdk-cli'), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '사이클 끝' }] } },
  ]);
  // 러너(loop.sh)가 정한 프롬프트 머리(첫 줄)는 같고 아래만 다르다(러너 한 번 기동 = 같은 머리)
  sdk(C1, repo, 60, '자율 사이클이다.\n첫 회차', 200);
  sdk(C2, repo, 400, '자율 사이클이다.\n둘째 회차', 900);
  sdk(C3, repo, 2100, '자율 사이클이다.\n인계 뒤 회차', 2200);
  sdk(STRAY, path.join(root, 'elsewhere'), 65, '남의 작업', 70);
  // 파일 mtime 을 기록 끝 시각으로(회차 사슬 공백 판정이 mtime 을 쓴다)
  const touch = (c, sid, sec) => fs.utimesSync(path.join(projects, enc(c), `${sid}.jsonl`), new Date(Date.parse(T(sec))), new Date(Date.parse(T(sec))));
  touch(repo, C1, 200); touch(repo, C2, 900); touch(repo, C3, 2200); touch(repo, M, 300); touch(repo, M2, 2300);
  for (const f of fs.readdirSync(sub)) fs.utimesSync(path.join(sub, f), new Date(Date.parse(T(50))), new Date(Date.parse(T(50))));

  // 다른 레포: 서로 다른 기동기 둘을 30초 사이로 → 그 뒤 회차는 어느 쪽인지 모름
  const p2 = path.join(projects, enc(repo2));
  write(p2, M3, [
    U(M3, repo2, 1, '둘 다 띄운다'),
    A(M3, repo2, 10, { type: 'tool_use', id: 'toolu_a', name: 'Bash', input: { command: 'nohup bash bin/a.sh &' } }),
    R(M3, repo2, 10.2, 'toolu_a', ''),
    A(M3, repo2, 40, { type: 'tool_use', id: 'toolu_b', name: 'Bash', input: { command: 'setsid bash bin/b.sh > /dev/null 2>&1 &' } }),
    R(M3, repo2, 40.2, 'toolu_b', ''),
  ]);
  sdk(C4, repo2, 100, '어느 기동기인가', 150);

  index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
  index.launchers = new LauncherIndex(index, { bootMs: 0 });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('파서: 분리 실행 구간의 실행 스크립트만, 따옴표 안 Start-Process 인자·cd, 사슬은 실행 자리만 따라간다', () => {
  const L = detectLaunch('cd /x && cat a.sh | head; nohup bash .loop/relaunch.sh > o 2>&1 < /dev/null & disown');
  assert.deepEqual(L.tokens, ['.loop/relaunch.sh'], 'cat 대상(a.sh)은 아님');
  assert.equal(L.cdGuess, '/x');
  assert.equal(detectLaunch('bash scripts/loop.sh 2>&1 | tail -3'), null, '분리 실행 아님(2>&1 은 &가 아님)');
  assert.equal(detectLaunch('nohup claude -p "x" &'), null, '명령에 claude -p 가 보이면 §4.3');
  const ps = detectLaunch(`Start-Process -FilePath bash.exe -ArgumentList '-c','"cd /d/w && bash .loop/relaunch.sh"' -WindowStyle Hidden; "ok"`, { tool: 'PowerShell' });
  assert.deepEqual(ps.tokens, ['.loop/relaunch.sh']);
  assert.equal(ps.cdGuess, '/d/w');
  assert.ok(detectLaunch('bash run.sh', { bg: true }), 'run_in_background 도 기동 후보');
  const a = analyzeLaunch(detectLaunch('nohup bash .loop/relaunch.sh &'), repo);
  assert.ok(a, 'relaunch.sh → scripts/loop.sh 의 claude -p');
  assert.equal(a.script, 'relaunch.sh');
  assert.deepEqual(a.via.map((x) => x.split('/').pop()), ['relaunch.sh', 'loop.sh'], 'grep 따옴표 안 other.sh 는 따라가지 않음');
  assert.equal(analyzeLaunch(detectLaunch('nohup python scripts/server.py &'), repo), null, '경로·claude -p 를 문자열로만 언급');
  assert.equal(analyzeLaunch(detectLaunch('nohup bash scripts/noloop.sh &'), repo), null, '따옴표 안 claude -p 는 실행 아님');
  assert.ok(cwdMatches(repo, { cwd: '/elsewhere', key: a.key }), '회차 cwd 가 스크립트를 품는 폴더');
  assert.ok(!cwdMatches(path.join(root, 'elsewhere'), { cwd: repo, key: a.key }));
});

test('판정(assign): 가장 늦은 기동이 이긴다, 부팅·공백·다른 기동기 겹침은 붙이지 않는다', async () => {
  await index.refresh();
  const li = new LauncherIndex(index, { bootMs: 0 });
  const e = (sid) => index.findSession(sid);
  const a1 = await li.assign(e(C1));
  assert.equal(a1.toolUseId, 'toolu_launch');
  assert.equal(a1.sessionId, M);
  assert.equal(a1.agentId, 'ag1');
  assert.equal(a1.confidence, 'high');
  assert.equal((await li.assign(e(C2))).toolUseId, 'toolu_launch');
  const a3 = await li.assign(e(C3));
  assert.equal(a3.toolUseId, 'toolu_launch2', '재부팅 뒤 인계한 메인이 다시 띄운 것');
  assert.equal(a3.confidence, 'medium', '부팅 시각을 모르면 앞 기동기가 살아 있었을 수 있다');
  assert.equal((await li.assign(e(STRAY))).none, 'no-launch');
  assert.equal((await li.assign(e(C4))).none, 'ambiguous', '다른 기동기 둘을 1분 안에 띄움');
  // 부팅 시각을 알면: M2 기동 전 부팅 → 인계는 확실(high), 부팅 전 기동의 부팅 뒤 회차는 붙이지 않음
  const lb = new LauncherIndex(index, { bootMs: Date.parse(T(1500)) });
  assert.equal((await lb.assign(e(C3))).confidence, 'high');
  const lb2 = new LauncherIndex(index, { bootMs: Date.parse(T(300)) });
  assert.equal((await lb2.assign(e(C2))).none, 'reboot');
  // 공백: 회차 사이가 gap 보다 길면 그 기동기는 끝난 것
  const lg = new LauncherIndex(index, { bootMs: 0, gapMs: 100_000 });
  assert.equal((await lg.assign(e(C2))).none, 'gap');
});

for (const offline of [false, true]) {
  test(`${offline ? '재생(offline)' : '라이브'}: 메인 → 서브에이전트 → 기동기 노드 → claude -p 회차들, 인계 뒤 회차는 다른 메인`, async () => {
    await index.refresh();
    index.claimedChildren.clear();
    index.launchers = new LauncherIndex(index, { bootMs: 0 });
    const rt = new RootRuntime({ sessionId: M, index, offline });
    try {
      if (offline) await rt.loadOffline();
      else {
        await rt.start();
        for (let i = 0; i < 20 && !rt.graph.get(`s:${C2}`); i++) { await rt.scanAll(); await new Promise((r) => setTimeout(r, 50)); }
        rt.sweep();
      }
      const g = rt.graph;
      const ln = g.get('b:toolu_launch');
      assert.ok(ln, '기동기 노드');
      assert.equal(ln.kind, 'bash-bg');
      // nohup … & 로 떼어 낸 기동기는 부모 PID 가 끊긴다 → 최상위 독립 노드, 띄운 서브에이전트는 meta.spawnedBy
      assert.equal(ln.parentId, null, '분리 실행 기동기는 최상위');
      assert.equal(ln.meta.spawnedBy, 'a:ag1', '띄운 자리는 서브에이전트');
      assert.equal(ln.depth, 0);
      assert.equal(ln.label, '기동기 · relaunch.sh');
      assert.equal(ln.meta.detached, true);
      assert.deepEqual(ln.meta.launcher.via, ['relaunch.sh', 'loop.sh']);
      assert.equal(ln.meta.title, '재기동기 분리 실행');
      const c1 = g.get(`s:${C1}`), c2 = g.get(`s:${C2}`);
      assert.ok(c1 && c2, '회차 둘');
      assert.equal(c1.kind, 'claude-p');
      // 재기동기(relaunch.sh) → 러너(loop.sh, 사슬에서 claude -p 를 부르는 파일) → 회차
      const rn = g.get('b:toolu_launch-r1');
      assert.ok(rn, '러너 노드');
      assert.equal(rn.parentId, 'b:toolu_launch');
      assert.equal(rn.kind, 'bash-bg');
      assert.equal(rn.label, '러너 · loop.sh');
      assert.deepEqual(rn.meta.runner, { script: 'loop.sh', instance: 1, launcher: 'b:toolu_launch', evidence: ['script-chain', 'prompt-head'] });
      assert.equal(rn.meta.launcher, undefined, '러너는 배치 장치가 아니다');
      assert.equal(rn.startedAt, T(60), '러너 시작 = 첫 회차 시작');
      assert.equal(g.get('b:toolu_launch-r2'), undefined, '같은 머리 회차는 한 러너');
      assert.equal(c1.parentId, 'b:toolu_launch-r1');
      assert.equal(c2.parentId, 'b:toolu_launch-r1');
      assert.equal(c1.label, 'claude -p · c1c1c1c1', '§44.2 같은 프로젝트 → sid8');
      assert.equal(c1.meta.cycle, 1);
      assert.equal(c2.meta.cycle, 2);
      assert.deepEqual({ by: c1.meta.link.by, confidence: c1.meta.link.confidence }, { by: 'launcher', confidence: 'high' });
      assert.equal(c1.status, 'done', '다음 회차가 시작했고 프로세스 기록 없음');
      assert.equal(c1.endedAt, T(200));
      assert.equal(g.get(`s:${C3}`), undefined, '인계 뒤 회차는 M2 의 것');
      assert.equal(g.get(`s:${STRAY}`), undefined);
      assert.equal(g.get('b:toolu_srv'), undefined, 'claude -p 사슬 없는 nohup 은 기동기 아님');
      assert.equal(g.get('b:toolu_no'), undefined);
      assert.equal(ln.status, 'done', '같은 기동기를 나중에 다시 띄움');
      assert.equal(ln.meta.endReason, 'superseded');
      assert.equal(ln.endedAt, T(900), '끝 = 마지막 회차 활동');
      assert.equal(rn.status, 'done', '기동기가 끝나면 러너도');
      assert.equal(rn.meta.endReason, 'launcher-ended');
      assert.equal(rn.endedAt, T(900));
      assert.equal(index.childParent.get(C1), M);
      // 백그라운드 점검: 재무장 Monitor, 끝난 서브에이전트의 endedAt(라이브 첫 적재도 기록 시각)
      const m2 = g.get('m:mon2');
      assert.equal(m2.meta.rearmOf, 'm:mon1');
      assert.equal(m2.meta.rearmCount, 1);
      assert.equal(g.get('m:mon1').meta.rearmOf, undefined);
      const ag = g.get('a:ag1');
      assert.equal(ag.status, 'done');
      assert.equal(ag.endedAt, T(50), '서버가 붙은 시각이 아니라 마지막 기록');
    } finally { rt.close(); }

    const rt2 = new RootRuntime({ sessionId: M2, index, offline });
    try {
      if (offline) await rt2.loadOffline();
      else { await rt2.start(); for (let i = 0; i < 20 && !rt2.graph.get(`s:${C3}`); i++) { await rt2.scanAll(); await new Promise((r) => setTimeout(r, 50)); } }
      const c3 = rt2.graph.get(`s:${C3}`);
      assert.ok(c3, '인계한 메인 아래');
      assert.equal(c3.parentId, 'b:toolu_launch2-r1');
      assert.equal(rt2.graph.get('b:toolu_launch2-r1').parentId, 'b:toolu_launch2');
      assert.equal(rt2.graph.get('b:toolu_launch2').label, '기동기 · relaunch.sh');
      assert.equal(c3.meta.link.confidence, 'medium');
      assert.equal(rt2.graph.get(`s:${C1}`), undefined);
    } finally { rt2.close(); }
  });
}

test('재생 재빌드·라이브 재적재 멱등: 같은 서버(SessionIndex)에서 다시 만들어도 회차가 그대로, 회차는 제 첫 기록 시각에·meta.batch 는 회차 시작·끝마다', async () => {
  await index.refresh();
  index.claimedChildren.clear();
  index.launchers = new LauncherIndex(index, { bootMs: 0 });
  const sum = (events) => {
    const adds = events.filter((e) => e.type === 'node-add');
    return { n: events.length, nodes: adds.map((e) => e.nodeId).sort(), cycles: adds.filter((e) => e.node.kind === 'claude-p').map((e) => [e.nodeId, e.ts]) };
  };
  const builds = [];
  // claimedChildren 을 비우지 않는다(서버 프로세스 하나에서 refresh=1 로 다시 만드는 경우)
  for (let i = 0; i < 2; i++) builds.push(await buildReplay({ sessionId: M, index }));
  const s0 = sum(builds[0].events);
  assert.deepEqual(s0.cycles, [[`s:${C1}`, T(60)], [`s:${C2}`, T(400)]], '회차 node-add = 회차 첫 기록(기동 시각 10초가 아님)');
  for (const b of builds.slice(1)) assert.deepEqual(sum(b.events), s0, '재빌드도 같은 이벤트·노드');
  for (const b of builds) assert.equal(b.stats.finalMismatch, 0);
  const ev = builds[0].events;
  // 회차는 도는 동안만 진행: C1 은 60～200, 그 전엔 노드가 없고 끝나면 done
  const st = (id) => ev.filter((e) => e.nodeId === id && e.type === 'node-update' && e.patch?.status).map((e) => [e.ts, e.patch.status]);
  assert.deepEqual(st(`s:${C1}`).at(-1), [T(200), 'done']);
  assert.ok(!st(`s:${C2}`).some(([t]) => t < T(400)), 'C2 는 시작 전에 상태가 없다');
  const batches = ev.filter((e) => e.nodeId === 'b:toolu_launch' && e.patch?.meta?.batch)
    .map((e) => [e.ts, e.patch.meta.batch.total, e.patch.meta.batch.running, e.patch.meta.batch.done, e.patch.meta.batch.currentCycleId]);
  assert.deepEqual(batches, [
    [T(60), 1, 1, 0, C1], [T(200), 1, 0, 1, null], [T(400), 2, 1, 1, C2], [T(900), 2, 0, 2, null],
  ], 'meta.batch 는 회차 시작·끝마다 그 시점 집계');
  // 라이브 런타임을 같은 index 로 다시 만들어도(허브가 루트를 내렸다 다시 붙듦) 회차가 붙는다
  for (let i = 0; i < 2; i++) {
    const rt = new RootRuntime({ sessionId: M, index });
    try {
      await rt.start();
      for (let k = 0; k < 20 && !rt.graph.get(`s:${C2}`); k++) { await rt.scanAll(); await new Promise((r) => setTimeout(r, 50)); }
      assert.ok(rt.graph.get(`s:${C1}`) && rt.graph.get(`s:${C2}`), `라이브 적재 #${i + 1} 회차 둘`);
      assert.equal(rt.graph.get(`s:${C2}`).startedAt, T(400));
      assert.equal(rt.graph.get(`s:${C2}`).parentId, 'b:toolu_launch-r1');
    } finally { rt.close(); }
  }
  assert.deepEqual(sum((await buildReplay({ sessionId: M, index })).events), s0, '라이브 뒤 재생도 같음');
  // 다른 루트(인계 메인 M2)가 가져간 회차 C3 는 여전히 M 쪽에 붙지 않는다
  assert.notEqual(index.childParent.get(C3), M);
});

test('전체 보기: 살아 있는 회차의 기동 세션(끝난 메인)을 루트로 붙든다', async () => {
  await index.refresh();
  index.claimedChildren.clear();
  index.launchers = new LauncherIndex(index, { bootMs: 0 });
  const sessions = index.sessionsDir;
  fs.writeFileSync(path.join(sessions, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: C2, cwd: repo, status: 'busy', entrypoint: 'sdk-cli' }));
  try {
    await index.refresh();
    const src = createRealSource({ manager: {}, index });
    const want = await src.desired();
    const parent = want.roots.find((r) => r.sessionId === M);
    assert.ok(parent, '기동한 메인이 루트 후보');
    assert.equal(parent.launcherOf, C2);
    assert.equal(parent.orphanSdk, false);
    assert.ok(want.roots.some((r) => r.sessionId === C2 && r.orphanSdk), '아직 안 붙었으면 회차도 후보(허브가 30초 기다림)');
    index.claimedChildren.add(C2);
    const want2 = await src.desired();
    assert.ok(want2.roots.some((r) => r.sessionId === M), '붙은 뒤에도 회차가 살아 있는 동안 부모 루트 유지');
    assert.ok(!want2.roots.some((r) => r.sessionId === C2));
    // 붙이지 못한 회차(다른 기동기 겹침): 트리는 그대로 독립 루트, 같은 프로젝트의 살아 있는 메인을 추정 소속으로
    fs.writeFileSync(path.join(sessions, `${process.pid}1.json`), JSON.stringify({ pid: process.pid, sessionId: C4, cwd: repo2, status: 'busy', entrypoint: 'sdk-cli' }));
    fs.writeFileSync(path.join(sessions, `${process.pid}2.json`), JSON.stringify({ pid: process.pid, sessionId: M3, cwd: repo2, status: 'idle', entrypoint: 'cli' }));
    await index.refresh();
    const want3 = await src.desired();
    const o = want3.roots.find((r) => r.sessionId === C4);
    assert.ok(o && o.orphanSdk);
    assert.equal(o.unlinkedReason, 'ambiguous');
    assert.equal(o.likelyMain, M3);
  } finally {
    for (const f of ['', '1', '2']) fs.rmSync(path.join(sessions, `${process.pid}${f}.json`), { force: true });
    await index.refresh();
  }
});

test('인계·묶음: 기동한 메인이 끝나면 그 뒤 시작한 메인이 기동기를 이어받고, 끝난 회차는 최근 2개만 노드·나머지는 meta.batch', async () => {
  const repo3 = path.join(root, 'repo3');
  fs.mkdirSync(path.join(repo3, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(repo3, 'bin', 'loop.sh'), '#!/usr/bin/env bash\nwhile :; do claude -p < p.md; done\n');
  const projects = index.projectsDir;
  const pdir = path.join(projects, enc(repo3));
  const M5 = 'a5a5a5a5-5555-4555-8555-555555555555', M6 = 'a6a6a6a6-6666-4666-8666-666666666666';
  const base = (sid, ep = 'cli') => ({ sessionId: sid, cwd: repo3, version: '2.1.309', entrypoint: ep });
  write(pdir, M5, [
    { type: 'user', timestamp: T(1), ...base(M5), message: { role: 'user', content: '루프 기동' } },
    { type: 'assistant', timestamp: T(10), ...base(M5), message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'toolu_l5', name: 'Bash', input: { command: 'nohup bash bin/loop.sh > /dev/null 2>&1 &' } }] } },
    { type: 'user', timestamp: T(11), ...base(M5), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_l5', content: '' }] }, toolUseResult: { stdout: '' } },
  ]);
  write(pdir, M6, [
    { type: 'user', timestamp: T(150), ...base(M6), message: { role: 'user', content: '재부팅 뒤 인계' } },
    { type: 'assistant', timestamp: T(2500), ...base(M6), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '감독 중' }] } },
  ]);
  const D = [200, 400, 600, 800, 1000].map((sec, i) => {
    const sid = `d${i}d${i}d${i}d${i}-0000-4000-8000-00000000000${i}`;
    write(pdir, sid, [
      { type: 'user', timestamp: T(sec), ...base(sid, 'sdk-cli'), message: { role: 'user', content: `회차 ${i}` } },
      { type: 'assistant', timestamp: T(sec + 100), ...base(sid, 'sdk-cli'), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '끝' }] } },
    ]);
    fs.utimesSync(path.join(pdir, `${sid}.jsonl`), new Date(Date.parse(T(sec + 100))), new Date(Date.parse(T(sec + 100))));
    return sid;
  });
  fs.utimesSync(path.join(pdir, `${M5}.jsonl`), new Date(Date.parse(T(100))), new Date(Date.parse(T(100))));
  fs.utimesSync(path.join(pdir, `${M6}.jsonl`), new Date(Date.parse(T(2500))), new Date(Date.parse(T(2500))));
  await index.refresh();
  index.claimedChildren.clear();
  index.launchers = new LauncherIndex(index, { bootMs: 0 });
  const a = await index.launchers.assign(index.findSession(D[0]));
  assert.equal(a.sessionId, M5);
  assert.equal(a.adopter, M6, '기동한 메인이 회차 전에 멈춤 → 그 뒤 시작해 회차 시각에 살아 있던 메인');
  for (const offline of [false, true]) {
    index.claimedChildren.clear();
    const rt0 = new RootRuntime({ sessionId: M5, index, offline });
    try {
      if (offline) await rt0.loadOffline(); else await rt0.start();
      assert.ok(rt0.graph.get('b:toolu_l5'), '기동한 메인에도 기동기 노드는 있음');
      assert.equal(D.filter((d) => rt0.graph.get(`s:${d}`)).length, 0, '회차는 이어받은 메인 쪽');
    } finally { rt0.close(); }
    index.claimedChildren.clear();
    const rt = new RootRuntime({ sessionId: M6, index, offline });
    try {
      if (offline) await rt.loadOffline(); else { await rt.start(); rt.sweep(); }
      const g = rt.graph;
      const ln = g.get('b:adopt-toolu_l5');
      assert.ok(ln, '이어받은 기동기 노드');
      assert.equal(ln.parentId, null, '이어받은 기동기도 최상위(띄운 세션보다 오래 삶, §61.2)');
      assert.equal(ln.meta.spawnedBy, `s:${M6}`);
      assert.equal(ln.meta.adopted.fromSession, M5);
      assert.equal(ln.label, '기동기 · loop.sh');
      const nodes = D.filter((d) => g.get(`s:${d}`));
      assert.deepEqual(nodes, D.slice(3), '끝난 회차는 최근 2개만 노드');
      assert.ok(D.every((d) => index.claimedChildren.has(d)), '집계로만 둔 회차도 독립 루트로 안 뜸');
      assert.equal(index.childParent.get(D[0]), M6);
      const b = ln.meta.batch;
      assert.equal(b.total, 5);
      assert.equal(b.collapsed, 3);
      assert.equal(b.done, 5);
      assert.equal(b.running, 0);
      assert.equal(b.avgDurationMs, 100_000);
      assert.equal(b.lastCycleAt, T(1000));
      assert.equal(b.recent.length, 5);
      assert.equal(b.recent[0].nodeId, null);
      assert.equal(b.recent[4].nodeId, `s:${D[4]}`);
      assert.equal(g.get(`s:${D[4]}`).meta.cycle, 5);
      assert.equal(g.get(`s:${D[4]}`).meta.link.adoptedFrom, M5);
    } finally { rt.close(); }
  }
});
