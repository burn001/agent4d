// 포그라운드 명령이 기동기를 nohup·& 로 떼어 띄우고 남은 대기(until grep …)가 시간 한도로 백그라운드로 넘어가면,
// 같은 호출로 기동기 노드가 둘(b:<toolUseId> + b:<taskId>) 생겼다(11.07. ACME relaunch.sh). 기동기는 하나, 넘어간 대기는 보통 bg.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { buildReplay } from '../replay.mjs';

const M = 'e4e4e4e4-4444-4444-8444-444444444444';
const enc = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
let root, index;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-fgto-'));
  const projects = path.join(root, 'projects');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  const repo = path.join(root, 'repo');
  for (const d of [path.join(repo, '.loop'), path.join(repo, 'scripts')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(repo, '.loop', 'relaunch.sh'), '#!/usr/bin/env bash\nnohup bash scripts/loop.sh >> runner.out 2>&1 < /dev/null &\n');
  fs.writeFileSync(path.join(repo, 'scripts', 'loop.sh'), '#!/usr/bin/env bash\nwhile :; do printf x | claude -p --output-format json > o.json; done\n');
  const outDir = path.join(root, 'tasks');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'bwait1.output'), 'waiting\n');
  const now = Date.now();
  const T = (sec) => new Date(now - 3000_000 + sec * 1000).toISOString();
  const base = { sessionId: M, cwd: repo, version: '2.1.319', entrypoint: 'cli' };
  const cmd = 'rm -f .loop/STOP && nohup bash .loop/relaunch.sh > .loop/relaunch.out 2>&1 < /dev/null & \ncd REPO && until grep -q "러너 기동" .loop/relaunch.out; do sleep 5; done'.replace('REPO', repo.split(path.sep).join('/'));
  const pdir = path.join(projects, enc(repo));
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(path.join(pdir, `${M}.jsonl`), [
    { type: 'user', timestamp: T(1), ...base, message: { role: 'user', content: '루프 다시 켜' } },
    { type: 'assistant', timestamp: T(5), ...base, message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'toolu_rl', name: 'Bash', input: { description: 'relaunch loop', command: cmd, timeout: 180000 } }] } },
    { type: 'user', timestamp: T(186), ...base, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_rl', content: `Command did not complete within its 180s timeout and was moved to the background (ID: bwait1). Output is being written to: ${path.join(outDir, 'bwait1.output')}` }] }, toolUseResult: { stdout: '', stderr: '', backgroundTaskId: 'bwait1', timedOutAfterMs: 180000 } },
    { type: 'assistant', timestamp: T(200), ...base, message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '대기' }] } },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  index = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'sessions') });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

const check = (nodes, how) => {
  const L = [...nodes.values()].filter((n) => n.meta?.launcher);
  assert.deepEqual(L.map((n) => n.id), ['b:toolu_rl'], `${how}: 기동기는 하나`);
  const w = nodes.get('b:bwait1');
  assert.ok(w, `${how}: 넘어간 대기는 bg 노드`);
  assert.ok(!w.meta.launcher && !w.meta.detached, `${how}: 기동기·분리 표지 없음`);
};

test('라이브·재생: 떼어 띄운 기동기는 하나, 시간 한도로 넘어간 대기는 보통 bg', async () => {
  const rt = new RootRuntime({ sessionId: M, index, jobRules: null });
  await rt.start();
  try { check(rt.graph.nodes, '라이브'); } finally { rt.close(); }
  const data = await buildReplay({ sessionId: M, index, jobRules: null });
  check(data.finalState.nodes, '재생');
});
