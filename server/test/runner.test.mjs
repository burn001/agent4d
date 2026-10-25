// 러너: 재기동기(relaunch.sh) → 러너(runner.sh, 사슬에서 claude -p 를 부르는 파일) → 회차.
// 러너 한 번 기동(인스턴스)은 회차 첫 프롬프트 첫 줄(숫자는 같게 봄)이 바뀔 때마다 새로. 합성 레포·transcript 만 쓴다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime, runnerScriptOf, runnerSigOf } from '../session.mjs';
import { LauncherIndex } from '../launcher.mjs';
import { buildReplay } from '../replay.mjs';

const M = 'a7a7a7a7-7777-4777-8777-777777777777';
const E = [0, 1, 2, 3].map((i) => `e${i}e${i}e${i}e${i}-0000-4000-8000-00000000000${i}`);
const enc = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
let root, index, T;
const write = (dir, sid, recs) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${sid}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); };

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-runner-'));
  const projects = path.join(root, 'projects');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, '.loop'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.loop', 'relaunch.sh'), '#!/usr/bin/env bash\nwhile :; do\n  nohup bash scripts/runner.sh >> r.out 2>&1 < /dev/null &\n  wait\ndone\n');
  fs.writeFileSync(path.join(repo, 'scripts', 'runner.sh'), '#!/usr/bin/env bash\nfor i in 1 2; do cat p.md | claude -p --output-format json > o.json; done\n');
  const now = Date.now();
  T = (sec) => new Date(now - 3000_000 + sec * 1000).toISOString();
  const base = (sid, ep = 'cli') => ({ sessionId: sid, cwd: repo, version: '2.1.309', entrypoint: ep });
  const pdir = path.join(projects, enc(repo));
  write(pdir, M, [
    { type: 'user', timestamp: T(1), ...base(M), message: { role: 'user', content: '루프를 띄운다' } },
    { type: 'assistant', timestamp: T(10), ...base(M), message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'toolu_rl', name: 'Bash',
      input: { command: 'nohup bash .loop/relaunch.sh > /dev/null 2>&1 &' } }] } },
    { type: 'user', timestamp: T(11), ...base(M), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_rl', content: '' }] }, toolUseResult: { stdout: '' } },
    { type: 'assistant', timestamp: T(2900), ...base(M), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '감독 중' }] } },
  ]);
  // 축 A 회차 둘(머리 같고 숫자만 다름) → 축 B 회차 둘
  const heads = ['자율 사이클 1회 — 축 A: 판 층 정리', '자율 사이클 2회 — 축 A: 판 층 정리', '자율 사이클 1회 — 축 B: 사례 고르기', '자율 사이클 2회 — 축 B: 사례 고르기'];
  [100, 300, 600, 800].forEach((sec, i) => {
    write(pdir, E[i], [
      { type: 'user', timestamp: T(sec), ...base(E[i], 'sdk-cli'), promptSource: 'sdk', message: { role: 'user', content: `${heads[i]}\n\n본문 ${i}` } },
      { type: 'assistant', timestamp: T(sec + 100), ...base(E[i], 'sdk-cli'), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '끝' }] } },
    ]);
    fs.utimesSync(path.join(pdir, `${E[i]}.jsonl`), new Date(Date.parse(T(sec + 100))), new Date(Date.parse(T(sec + 100))));
  });
  fs.utimesSync(path.join(pdir, `${M}.jsonl`), new Date(Date.parse(T(2900))), new Date(Date.parse(T(2900))));
  index = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'sessions') });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('러너 판정 규칙: 사슬 마지막(claude -p) 파일이 첫 스크립트와 다를 때만, 인스턴스 표지는 첫 줄·숫자 무시', () => {
  assert.equal(runnerScriptOf(['/r/.loop/relaunch.sh', '/r/scripts/pick.sh', '/r/scripts/autopilot.sh'], 'relaunch.sh'), 'autopilot.sh');
  assert.equal(runnerScriptOf(['relaunch.sh', 'autopilot.sh'], 'relaunch.sh'), 'autopilot.sh');
  assert.equal(runnerScriptOf(['loop.sh'], 'loop.sh'), null, '기동기가 곧 러너');
  assert.equal(runnerScriptOf([], 'x.sh'), null);
  assert.equal(runnerSigOf('\n  자율 사이클이다. (142번 축)\n본문'), '자율 사이클이다. (#번 축)');
  assert.equal(runnerSigOf('사이클 3/10  시작'), runnerSigOf('사이클 4/10 시작'));
  assert.notEqual(runnerSigOf('축 A'), runnerSigOf('축 B'));
  assert.equal(runnerSigOf(null), '');
});

for (const offline of [false, true]) {
  test(`${offline ? '재생' : '라이브'}: 재기동기 → 러너 #1(축 A 회차 둘) · 러너 #2(축 B 회차 둘), 앞 러너는 다음 러너가 뜨면 끝`, async () => {
    await index.refresh();
    index.claimedChildren.clear();
    index.launchers = new LauncherIndex(index, { bootMs: 0 });
    const rt = new RootRuntime({ sessionId: M, index, offline });
    try {
      if (offline) await rt.loadOffline();
      else { await rt.start(); for (let i = 0; i < 20 && !rt.graph.get('b:toolu_rl-r2'); i++) { await rt.scanAll(); await new Promise((r) => setTimeout(r, 50)); } rt.sweep(); }
      const g = rt.graph;
      const L = g.get('b:toolu_rl');
      assert.ok(L && L.meta.launcher, '재기동기');
      assert.deepEqual(L.meta.launcher.via, ['relaunch.sh', 'runner.sh']);
      const r1 = g.get('b:toolu_rl-r1'), r2 = g.get('b:toolu_rl-r2');
      assert.ok(r1 && r2, '러너 둘');
      for (const r of [r1, r2]) { assert.equal(r.parentId, 'b:toolu_rl'); assert.equal(r.label, '러너 · runner.sh'); assert.equal(r.kind, 'bash-bg'); }
      assert.equal(r1.meta.runner.instance, 1);
      assert.equal(r2.meta.runner.instance, 2);
      assert.equal(r1.startedAt, T(100));
      assert.equal(r2.startedAt, T(600));
      assert.equal(r1.status, 'done');
      assert.equal(r1.meta.endReason, 'next-runner');
      assert.equal(r1.endedAt, T(400), '끝 = 그 러너 마지막 회차 끝(집계로만 둔 회차 포함)');
      assert.notEqual(r2.status, 'done', '마지막 러너는 기동기가 살아 있는 동안 안 끝남');
      assert.equal(r2.meta.title, null, '§77 첫 회차 프롬프트 머리는 부제로 쓰지 않음');
      // 끝난 회차는 최근 2개만 노드: 축 B 둘 → 러너 #2 아래. 축 A 둘은 집계로만
      assert.equal(g.get(`s:${E[0]}`), undefined);
      assert.equal(g.get(`s:${E[2]}`).parentId, 'b:toolu_rl-r2');
      assert.equal(g.get(`s:${E[3]}`).parentId, 'b:toolu_rl-r2');
      assert.equal(g.get(`s:${E[3]}`).meta.cycle, 4, '회차 번호는 기동기 전체 순번');
      assert.equal(L.meta.batch.total, 4);
      assert.equal(L.meta.batch.collapsed, 2);
      assert.equal(g.get(`s:${E[2]}`).status, 'done', '다음 회차(같은 기동기)가 시작함');
    } finally { rt.close(); }
  });
}

test('재생 시각: 기동 → 러너(첫 회차 시작) → 회차, 재빌드 멱등', async () => {
  await index.refresh();
  index.claimedChildren.clear();
  index.launchers = new LauncherIndex(index, { bootMs: 0 });
  const a = await buildReplay({ sessionId: M, index });
  const b = await buildReplay({ sessionId: M, index });
  const adds = (d) => d.events.filter((e) => e.type === 'node-add').map((e) => [e.nodeId, e.ts]);
  assert.deepEqual(adds(b), adds(a));
  const at = new Map(adds(a));
  assert.equal(at.get('b:toolu_rl'), T(10));
  assert.equal(at.get('b:toolu_rl-r1'), T(100));
  assert.equal(at.get('b:toolu_rl-r2'), T(600));
  assert.equal(at.get(`s:${E[2]}`), T(600));
  const ids = a.events.filter((e) => e.type === 'node-add').map((e) => e.nodeId);
  assert.ok(ids.indexOf('b:toolu_rl-r2') < ids.indexOf(`s:${E[2]}`), '러너가 회차보다 먼저');
  const r1End = a.events.find((e) => e.nodeId === 'b:toolu_rl-r1' && e.patch?.status === 'done');
  assert.equal(r1End.ts, T(400));
  assert.equal(a.stats.finalMismatch, 0);
});
