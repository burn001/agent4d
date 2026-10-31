// /clear 승계 — 진행 중 회차의 메인 기록이 /clear 앞에 조용해진 경우. 실측(2026-10-31, 실제 프로젝트): 옛 메인의 서브에이전트가
// 띄운 재기동기 → 러너 → 진행 중 회차 claude -p(프로세스 살아 있음·busy)의 메인 transcript 는 서브에이전트를 기다리느라 /clear 21분 앞에
// 멈췄고(기록은 서브에이전트 파일에만), 의 '회차가 /clear 뒤까지 기록' 판정(회차 메인 기록 lastTs·mtime)이 거짓 →
// 새 메인이 기동기를 이어받지 않아 기동기·러너·회차가 옛 메인(지난 메인 → 숨김) 아래에 남았다. 합성 기록으로 재현한다.
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

const P = 'f3f3f3f3-3333-4333-8333-333333333333'; // /clear 앞 메인 — 서브에이전트가 재기동기를 띄움
const S = 'f4f4f4f4-4444-4444-8444-444444444444'; // /clear 뒤 새 메인(같은 프로세스)
const C1 = 'c7c7c7c7-0000-4000-8000-000000000001'; // 끝난 회차
const C2 = 'c8c8c8c8-0000-4000-8000-000000000002'; // /clear 를 넘어 진행 중 — 메인 기록은 /clear 앞에 멈춤, 서브에이전트만 기록
const AG = 'a9d9d9d9d9d9d9d9'; // 재기동기를 띄운 옛 메인의 서브에이전트
const LTU = 'toolu_sub_relaunch';
const enc = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
let root, index, pdir, sessions;
const write = (file, recs) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); };

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-clearq-'));
  const projects = path.join(root, 'projects');
  sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const repo = path.join(root, 'repo');
  for (const d of [path.join(repo, '.loop'), path.join(repo, 'scripts')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(repo, '.loop', 'relaunch.sh'), '#!/usr/bin/env bash\nnohup bash scripts/loop.sh >> runner.out 2>&1 < /dev/null &\n');
  fs.writeFileSync(path.join(repo, 'scripts', 'loop.sh'), '#!/usr/bin/env bash\nfor i in $(seq 1 99); do\n  claude -p --output-format json < prompt.md > o.json\ndone\n');
  const now = Date.now();
  const T = (sec) => new Date(now - 1000_000 + sec * 1000).toISOString();
  const base = (sid, ep = 'cli') => ({ sessionId: sid, cwd: repo, version: '2.1.320', entrypoint: ep });
  const A = (sid, sec, block, extra = {}) => ({ type: 'assistant', timestamp: T(sec), ...base(sid), ...extra, message: { role: 'assistant', model: 'm', content: [block] } });
  const R = (sid, sec, id, text, tur, extra = {}) => ({ type: 'user', timestamp: T(sec), ...base(sid), ...extra, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, ...(tur ? { toolUseResult: tur } : {}) });
  const U = (sid, sec, text) => ({ type: 'user', timestamp: T(sec), ...base(sid), message: { role: 'user', content: text } });
  pdir = path.join(projects, enc(repo));
  const msys = '/' + repo[0].toLowerCase() + repo.slice(2).replace(/\\/g, '/');
  // 옛 메인 P: 동기 서브에이전트가 재기동기를 분리 실행으로 띄우고 끝난다. 그 뒤 Monitor, 그리고 /clear
  write(path.join(pdir, `${P}.jsonl`), [
    U(P, 1, '루프를 다시 띄워라'),
    A(P, 5, { type: 'tool_use', id: 'toolu_ag', name: 'Agent', input: { description: '재기동기 예약', subagent_type: 'general-purpose', prompt: '띄워라' } }),
    R(P, 60, 'toolu_ag', '띄웠습니다', { status: 'completed', agentId: AG, content: [{ type: 'text', text: '띄웠습니다' }] }),
    A(P, 300, { type: 'tool_use', id: 'toolu_mon', name: 'Monitor', input: { description: '세션 모니터 — 루프·회차', command: 'bash watch.sh' } }),
    R(P, 300.2, 'toolu_mon', 'Monitor started (task monq, persistent)', { taskId: 'monq', persistent: true }),
    A(P, 590, { type: 'text', text: '지켜봅니다' }),
    { type: 'queue-operation', operation: 'enqueue', timestamp: T(599.97), sessionId: P, content: '/clear' },
    { type: 'queue-operation', operation: 'dequeue', timestamp: T(599.98), sessionId: P },
  ]);
  const side = { isSidechain: true, agentId: AG };
  write(path.join(pdir, P, 'subagents', `agent-${AG}.jsonl`), [
    { type: 'user', timestamp: T(6), ...base(P), ...side, message: { role: 'user', content: '띄워라' } },
    A(P, 10, { type: 'tool_use', id: LTU, name: 'Bash', input: { description: '재기동기 분리 실행', command: `cd ${msys} && nohup bash .loop/relaunch.sh > .loop/relaunch.out 2>&1 < /dev/null & disown; echo ok` } }, side),
    R(P, 10.5, LTU, 'ok', { stdout: 'ok', stderr: '' }, side),
    A(P, 55, { type: 'text', text: '띄웠습니다' }, side),
  ]);
  fs.writeFileSync(path.join(pdir, P, 'subagents', `agent-${AG}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: '재기동기 예약', toolUseId: 'toolu_ag' }));
  const sdk = (sid, sec, prompt, endSec) => write(path.join(pdir, `${sid}.jsonl`), [
    { type: 'user', timestamp: T(sec), ...base(sid, 'sdk-cli'), promptSource: 'sdk', message: { role: 'user', content: prompt } },
    { type: 'assistant', timestamp: T(endSec), ...base(sid, 'sdk-cli'), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '회차 일' }] } },
  ]);
  sdk(C1, 100, '자율 회차다.\n첫째', 200);
  sdk(C2, 250, '자율 회차다.\n둘째', 320); // 메인 기록은 T320 에 멈춤(/clear T600 앞) — 서브에이전트를 기다림
  write(path.join(pdir, C2, 'subagents', 'agent-acyc2.jsonl'), [
    { type: 'user', timestamp: T(321), ...base(C2, 'sdk-cli'), isSidechain: true, agentId: 'acyc2', message: { role: 'user', content: '측정하라' } },
    { type: 'assistant', timestamp: T(700), ...base(C2, 'sdk-cli'), isSidechain: true, agentId: 'acyc2', message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '측정 중' }] } },
  ]);
  const touch = (f, sec) => fs.utimesSync(f, new Date(Date.parse(T(sec))), new Date(Date.parse(T(sec))));
  touch(path.join(pdir, `${C1}.jsonl`), 200);
  touch(path.join(pdir, `${C2}.jsonl`), 320);
  touch(path.join(pdir, `${P}.jsonl`), 600);
  // 회차 C2 프로세스는 살아 있다(이 시험 프로세스 pid — 읽기만, 끄지 않음)
  fs.writeFileSync(path.join(sessions, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: C2, cwd: repo, kind: 'interactive', entrypoint: 'sdk-cli', status: 'busy' }));
  write(path.join(pdir, `${S}.jsonl`), [
    { type: 'attachment', timestamp: T(603), ...base(S), attachment: { type: 'hook_success', hookName: 'SessionStart:clear', hookEvent: 'SessionStart', content: '' } },
    { type: 'user', timestamp: T(600), ...base(S), message: { role: 'user', content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>' } },
    { type: 'system', subtype: 'local_command', timestamp: T(600.1), ...base(S), content: '<local-command-stdout></local-command-stdout>' },
    U(S, 620, 'start'),
    A(S, 625, { type: 'text', text: '이어서 봅니다' }),
  ]);
  index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
  index.launchers = new LauncherIndex(index, { bootMs: 0 });
  index.taskRoots = [path.join(root, 'tmp', 'claude')];
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

const settle = async (rt, n = 4) => { for (let i = 0; i < n; i++) { rt._lastScratch = 0; if (rt._inheritPending) rt._inheritPending.nextAt = 0; await rt.scanAll(); } rt.sweep(); };

test('§129 회차 메인 기록이 /clear 앞에 조용해도(서브에이전트만 기록·프로세스 살아 있음) 새 메인이 서브에이전트가 띄운 기동기를 이어받음', async () => {
  await index.refresh();
  const rp = new RootRuntime({ sessionId: P, index });
  const rs = new RootRuntime({ sessionId: S, index });
  const rts = new Map([[P, rp], [S, rs]]);
  const src = {
    async desired() { return { roots: [{ sid: S, live: true }, { sid: P, live: false }].map((r) => ({ sessionId: r.sid, projectId: 'p', live: r.live, liveStatus: null, tier: r.live ? 'live' : 'recent', orphanSdk: false })) }; },
    async acquire(sid) { return rts.get(sid); }, release() {}, async projects() { return []; },
  };
  const hub = new OverviewHub({ source: src, intervalMs: 60_000, projectsMinMs: 0, graceMs: 600_000 });
  hub.subscribe({ inactive: true, onEvent() {}, onProjects() {} });
  try {
    await rp.start(); await settle(rp);
    const old = rp.graph.get(`b:${LTU}`);
    assert.ok(old, '옛 메인 트리: 서브에이전트가 띄운 기동기');
    assert.equal(old.meta.spawnedBy, `a:${AG}`);
    assert.ok(rp.graph.get(`s:${C2}`), '옛 메인 트리: 진행 중 회차');
    await rs.start(); await settle(rs);
    const g = rs.graph;
    assert.equal(g.get(`s:${S}`).meta.clearedFrom, P);
    assert.equal(g.get('m:monq')?.parentId, `s:${S}`, 'Monitor 승계');
    const L = g.get(`b:adopt-${LTU}`);
    assert.ok(L, '새 메인이 기동기를 이어받음(회차 메인 기록이 /clear 앞에 멈췄어도)');
    assert.equal(L.meta.spawnedBy, `s:${S}`);
    assert.equal(L.meta.inheritedFrom, P);
    assert.equal(g.get(`s:${C2}`)?.parentId, `b:adopt-${LTU}-r1`, '진행 중 회차는 러너 아래');
    await hub.wake(); await hub.tick();
    for (const id of [`b:adopt-${LTU}`, `b:adopt-${LTU}-r1`, `s:${C2}`]) assert.equal(hub.owner.get(id), S, `새 메인 소유: ${id}`);
    const vis = new Set(hub.snapshot().nodes.map((n) => n.id));
    for (const id of [`s:${S}`, `b:adopt-${LTU}`, `s:${C2}`, 'm:monq']) assert.ok(vis.has(id), `보임: ${id}`);
  } finally { hub.stop(); rp.close(); rs.close(); }
});

test('§129 재생: 같은 기록·지금 살아 있는 회차 프로세스면 새 메인 아래 같은 승계', async () => {
  await index.refresh();
  index.claimedChildren.clear();
  index.launchers = new LauncherIndex(index, { bootMs: 0 });
  const data = await buildReplay({ sessionId: S, index });
  const fin = data.finalState.nodes;
  assert.equal(fin.get(`b:adopt-${LTU}`)?.meta.spawnedBy, `s:${S}`);
  assert.equal(fin.get(`s:${C2}`)?.parentId, `b:adopt-${LTU}-r1`);
});

test('§129 반례: 회차 프로세스가 끝났고 기록도 /clear 앞에 멈췄으면 이어받지 않음(옛 메인에 둠)', async () => {
  fs.rmSync(path.join(sessions, `${process.pid}.json`));
  const sub = path.join(pdir, C2, 'subagents', 'agent-acyc2.jsonl');
  const lines = fs.readFileSync(sub, 'utf8').trim().split('\n');
  fs.writeFileSync(sub, lines[0] + '\n'); // 서브에이전트도 /clear 앞에서 멈춤
  const t = fs.statSync(path.join(pdir, `${C2}.jsonl`)).mtime;
  fs.utimesSync(sub, t, t);
  await index.refresh();
  index.claimedChildren.clear();
  index.launchers = new LauncherIndex(index, { bootMs: 0 });
  const data = await buildReplay({ sessionId: S, index });
  assert.equal(data.finalState.nodes.get(`b:adopt-${LTU}`), undefined);
});
