// 같은 프로세스의 /clear 로 sessionId 가 바뀌었을 때 옛 세션의 살아 있는 하위(이어받은 기동기·러너·진행 중 회차 claude -p·Monitor)를
// 새 메인 아래로. 실측(2026-10-29, 실제 프로젝트): 새 transcript 는 이어받은 메타 기록(custom-title·agent-name·mode·bridge-session)만 먼저
// 적히고 SessionStart:clear 훅·/clear 명령 기록은 몇 초 뒤에 왔다 → 그 사이 붙은 런타임은 승계를 한 번도 하지 않아 새 메인에 자식이 없었다.
// 또 옛 메인 자신이 로 이어받은 기동기(b:adopt-…)는 새 메인이 같은 id 로 다시 이어받을 때 허브에서 부딪혔다. 합성 기록으로 재현한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { LauncherIndex } from '../launcher.mjs';
import { OverviewHub } from '../overview.mjs';
import { buildReplay } from '../replay.mjs';

const Q = 'f0f0f0f0-0000-4000-8000-000000000000'; // 기동기를 띄우고 끝난 메인
const P = 'f1f1f1f1-1111-4111-8111-111111111111'; // 기동기를 이어받은 메인 — 여기서 /clear
const S = 'f2f2f2f2-2222-4222-8222-222222222222'; // /clear 뒤 새 메인(같은 프로세스)
const C1 = 'c5c5c5c5-0000-4000-8000-000000000001'; // 끝난 회차
const C2 = 'c6c6c6c6-0000-4000-8000-000000000002'; // /clear 를 넘어 진행 중인 회차
const enc = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
const LTU = 'toolu_relaunch';
let root, index, repo, T, sFile, tailRecs;
const write = (file, recs) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); };

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-clearl-'));
  const projects = path.join(root, 'projects');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  repo = path.join(root, 'repo');
  for (const d of [path.join(repo, '.loop'), path.join(repo, 'scripts')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(repo, '.loop', 'relaunch.sh'), '#!/usr/bin/env bash\nnohup bash scripts/loop.sh >> runner.out 2>&1 < /dev/null &\n');
  fs.writeFileSync(path.join(repo, 'scripts', 'loop.sh'), '#!/usr/bin/env bash\nfor i in $(seq 1 99); do\n  claude -p --output-format json < prompt.md > o.json\ndone\n');
  const now = Date.now();
  T = (sec) => new Date(now - 1000_000 + sec * 1000).toISOString();
  const base = (sid, ep = 'cli') => ({ sessionId: sid, cwd: repo, version: '2.1.320', entrypoint: ep });
  const A = (sid, sec, block) => ({ type: 'assistant', timestamp: T(sec), ...base(sid), message: { role: 'assistant', model: 'm', content: [block] } });
  const R = (sid, sec, id, text, tur) => ({ type: 'user', timestamp: T(sec), ...base(sid), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, ...(tur ? { toolUseResult: tur } : {}) });
  const U = (sid, sec, text) => ({ type: 'user', timestamp: T(sec), ...base(sid), message: { role: 'user', content: text } });
  const pdir = path.join(projects, enc(repo));
  const msys = '/' + repo[0].toLowerCase() + repo.slice(2).replace(/\\/g, '/');
  write(path.join(pdir, `${Q}.jsonl`), [
    U(Q, 1, '루프를 띄운다'),
    A(Q, 10, { type: 'tool_use', id: LTU, name: 'Bash', input: { description: '재기동기 분리 실행', command: `cd ${msys} && nohup bash .loop/relaunch.sh > .loop/relaunch.out 2>&1 < /dev/null & disown; echo ok` } }),
    R(Q, 10.5, LTU, 'ok', { stdout: 'ok', stderr: '' }),
    A(Q, 50, { type: 'text', text: '띄웠다' }),
  ]);
  write(path.join(pdir, `${P}.jsonl`), [
    U(P, 100, '루프를 지켜보자'),
    A(P, 300, { type: 'tool_use', id: 'toolu_mon', name: 'Monitor', input: { description: '세션 모니터 — 루프·회차', command: 'bash watch.sh' } }),
    R(P, 300.2, 'toolu_mon', 'Monitor started (task monx, persistent)', { taskId: 'monx', persistent: true }),
    A(P, 590, { type: 'text', text: '마무리했습니다' }),
    { type: 'system', subtype: 'turn_duration', timestamp: T(591), ...base(P), durationMs: 1000 },
    { type: 'queue-operation', operation: 'enqueue', timestamp: T(599.97), sessionId: P, content: '/clear' },
    { type: 'queue-operation', operation: 'dequeue', timestamp: T(599.98), sessionId: P },
  ]);
  const sdk = (sid, sec, prompt, endSec) => write(path.join(pdir, `${sid}.jsonl`), [
    { type: 'user', timestamp: T(sec), ...base(sid, 'sdk-cli'), promptSource: 'sdk', message: { role: 'user', content: prompt } },
    { type: 'assistant', timestamp: T(endSec), ...base(sid, 'sdk-cli'), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '회차 일' }] } },
  ]);
  sdk(C1, 200, '자율 회차다.\n첫째', 400);
  sdk(C2, 450, '자율 회차다.\n둘째', 700); // /clear(T600) 뒤에도 기록 중
  const touch = (sid, sec) => fs.utimesSync(path.join(pdir, `${sid}.jsonl`), new Date(Date.parse(T(sec))), new Date(Date.parse(T(sec))));
  touch(Q, 50); touch(C1, 400);
  // 새 메인 S: 처음엔 이어받은 메타 기록만(시각·entrypoint 없음) — 실측 첫 몇 초
  sFile = path.join(pdir, `${S}.jsonl`);
  write(sFile, [
    { type: 'custom-title', customTitle: 'Project', sessionId: S },
    { type: 'agent-name', agentName: 'Project', sessionId: S },
    { type: 'mode', mode: 'normal', sessionId: S },
    { type: 'bridge-session', sessionId: S, bridgeSessionId: 'cse_x', lastSequenceNum: 1 },
  ]);
  // 몇 초 뒤 적히는 머리(실측 순서: 훅 기록이 먼저, /clear 명령 user·로컬 명령이 뒤 — 시각은 /clear 가 더 이르다)
  tailRecs = [
    { type: 'attachment', timestamp: T(603), ...base(S), attachment: { type: 'hook_success', hookName: 'SessionStart:clear', hookEvent: 'SessionStart', content: '' } },
    { type: 'user', timestamp: T(600.1), ...base(S), isMeta: true, message: { role: 'user', content: '<local-command-caveat>Caveat</local-command-caveat>' } },
    { type: 'user', timestamp: T(600), ...base(S), message: { role: 'user', content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>' } },
    { type: 'system', subtype: 'local_command', timestamp: T(600.1), ...base(S), content: '<local-command-stdout></local-command-stdout>' },
    U(S, 620, 'start'),
    A(S, 625, { type: 'text', text: '이어서 봅니다' }),
  ];
  index = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'sessions') });
  index.launchers = new LauncherIndex(index, { bootMs: 0 });
  index.taskRoots = [path.join(root, 'tmp', 'claude')];
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

const settle = async (rt, n = 4) => { for (let i = 0; i < n; i++) { rt._lastScratch = 0; if (rt._inheritPending) rt._inheritPending.nextAt = 0; await rt.scanAll(); } rt.sweep(); };
const live = (n) => n && !['done', 'error', 'stopped'].includes(n.status);

test('§74.11 늦게 적힌 /clear 머리: 런타임이 먼저 붙어도 머리가 다 쓰이면 승계 — Monitor·이어받은 기동기·러너·회차가 새 메인 아래', async () => {
  await index.refresh();
  const rp = new RootRuntime({ sessionId: P, index });
  const rs = new RootRuntime({ sessionId: S, index });
  const rts = new Map([[P, rp], [S, rs]]);
  const spec = [{ sid: S, live: true }, { sid: P, live: false }];
  const src = {
    async desired() { return { roots: spec.map((r) => ({ sessionId: r.sid, projectId: 'p', live: r.live, liveStatus: null, tier: r.live ? 'live' : 'recent', orphanSdk: false })) }; },
    async acquire(sid) { return rts.get(sid); }, release() {}, async projects() { return []; },
  };
  const hub = new OverviewHub({ source: src, intervalMs: 60_000, projectsMinMs: 0, graceMs: 600_000 });
  const got = [];
  hub.subscribe({ inactive: true, onEvent: (e) => got.push(e), onProjects() {} });
  try {
    await rp.start(); await settle(rp);
    assert.ok(rp.graph.get(`b:adopt-${LTU}`), '옛 메인 P 가 기동기를 이어받음(§48.4)');
    assert.equal(rp.graph.get(`s:${C2}`)?.parentId, `b:adopt-${LTU}-r1`);
    await rs.start(); await settle(rs);
    assert.equal(rs.graph.get(`s:${S}`).meta.clearedFrom, undefined, '머리가 덜 쓰인 순간엔 /clear 표지가 없다');
    await rp.start(); await rs.start();
    await hub.wake();
    assert.equal(hub.owner.get(`b:adopt-${LTU}`), P, '고치기 전 모양: 살아 있는 하위는 전부 옛 메인 소유');
    // 머리가 이어서 적힌다 → 다음 탐색에서 승계
    fs.appendFileSync(sFile, tailRecs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await index.refresh();
    await settle(rs);
    const g = rs.graph;
    assert.equal(g.get(`s:${S}`).meta.clearedFrom, P);
    assert.equal(g.get('m:monx')?.parentId, `s:${S}`, 'Monitor 승계');
    const L = g.get(`b:adopt-${LTU}`);
    assert.ok(L, '새 메인이 기동기를 이어받음');
    assert.equal(L.meta.spawnedBy, `s:${S}`);
    assert.equal(L.meta.inheritedFrom, P);
    assert.equal(g.get(`b:adopt-${LTU}-r1`)?.parentId, L.id, '러너');
    assert.equal(g.get(`s:${C2}`)?.parentId, `b:adopt-${LTU}-r1`, '진행 중 회차');
    assert.ok(live(g.get(`s:${C2}`)));
    for (const id of [`b:adopt-${LTU}`, `s:${C2}`, 'm:monx']) assert.ok(rs.inheritedIds.has(id), id);
    // 허브: 옛 루트 쪽 같은 노드를 걷고(node-remove handoff) 새 루트가 갖는다
    await hub.tick();
    for (const id of [`b:adopt-${LTU}`, `b:adopt-${LTU}-r1`, `s:${C2}`, 'm:monx']) assert.equal(hub.owner.get(id), S, `새 메인 소유: ${id}`);
    assert.ok(got.some((e) => e.type === 'node-remove' && e.handoff && e.rootSessionId === P && e.nodeId === `b:adopt-${LTU}`));
    const snap = hub.snapshot({ inactive: true });
    for (const id of [`b:adopt-${LTU}`, `s:${C2}`, 'm:monx']) {
      const ns = snap.nodes.filter((n) => n.id === id);
      assert.equal(ns.length, 1, `한 번만: ${id}`);
      assert.equal(ns[0].rootSessionId, S, `rootSessionId = 새 메인: ${id}`);
    }
    assert.ok(snap.nodes.every((n) => !n.parentId || snap.nodes.some((x) => x.id === n.parentId)), '부모 없는 노드 없음');
    // 옛 메인은 살아 있는 하위가 없어 '지난 메인'으로 숨는다(서버가 /clear 뒤에 붙어 leftAt 없음 → 바로)
    const vis = new Set(hub.snapshot().nodes.map((n) => n.id));
    assert.ok(!vis.has(`s:${P}`), '옛 메인 숨음');
    for (const id of [`s:${S}`, `b:adopt-${LTU}`, `s:${C2}`, 'm:monx']) assert.ok(vis.has(id), `보임: ${id}`);
  } finally { hub.stop(); rp.close(); rs.close(); }
});

test('§74.11 재생: 같은 기록이면 새 메인 아래 같은 승계(기동기·러너·회차·Monitor)', async () => {
  await index.refresh();
  index.claimedChildren.clear();
  index.launchers = new LauncherIndex(index, { bootMs: 0 });
  const data = await buildReplay({ sessionId: S, index });
  const fin = data.finalState.nodes;
  assert.equal(fin.get(`s:${S}`).meta.clearedFrom, P);
  assert.equal(fin.get('m:monx')?.parentId, `s:${S}`);
  assert.equal(fin.get(`b:adopt-${LTU}`)?.meta.spawnedBy, `s:${S}`);
  assert.equal(fin.get(`s:${C2}`)?.parentId, `b:adopt-${LTU}-r1`);
  const add = data.events.find((e) => e.type === 'node-add' && e.nodeId === `b:adopt-${LTU}`);
  assert.ok(Date.parse(add.ts) >= Date.parse(data.events[0].ts), '새 메인 시작보다 앞에 뜨지 않음');
  // 옛 메인 재생은 그대로(그 시점 기록 — 기동기는 옛 메인 아래)
  index.claimedChildren.clear();
  const old = await buildReplay({ sessionId: P, index });
  assert.ok(old.finalState.nodes.get(`b:adopt-${LTU}`), '옛 메인 재생엔 그대로');
});
