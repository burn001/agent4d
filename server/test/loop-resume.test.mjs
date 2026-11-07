// 포그라운드 재개 스크립트: 메인이 `bash scripts/resume.sh` 를 포그라운드로 부르고, 그 스크립트가 안에서
// `nohup bash .loop/relaunch.sh &` 로 재기동기를 떼어 띄운다(자율 루프 재부팅 재개 한 명령 모양). 합성 레포·transcript.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { detectLaunch, analyzeLaunch, LauncherIndex } from '../launcher.mjs';

const M = 'e1e1e1e1-1111-4111-8111-111111111111';
const C1 = 'f1f1f1f1-0000-4000-8000-000000000001';
const C2 = 'f2f2f2f2-0000-4000-8000-000000000002';
const enc = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
let root, index, repo, T;
const write = (dir, sid, recs) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${sid}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); };

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-resume-'));
  const projects = path.join(root, 'projects');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  repo = path.join(root, 'repo');
  for (const d of [path.join(repo, '.loop'), path.join(repo, 'scripts', 'lib')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(repo, 'scripts', 'resume.sh'), [
    '#!/usr/bin/env bash', '# 재부팅 재개 — 터널 · 대기 사슬 · 재기동기', '. "$REPO/scripts/lib/util.sh"',
    'eval "${TUNNEL_CMD:-bash scripts/tunnel.sh up}"', 'nohup bash "$script" >> "$lg" 2>&1 < /dev/null &',
    'nohup bash .loop/relaunch.sh > "$AP/relaunch.out" 2>&1 < /dev/null &', 'echo started', '',
  ].join('\n'));
  fs.writeFileSync(path.join(repo, 'scripts', 'lib', 'util.sh'), 'say() { echo "$*"; }\n');
  fs.writeFileSync(path.join(repo, '.loop', 'relaunch.sh'), '#!/usr/bin/env bash\nnohup bash scripts/loop.sh >> runner.out 2>&1 < /dev/null &\n');
  fs.writeFileSync(path.join(repo, 'scripts', 'loop.sh'), '#!/usr/bin/env bash\nwhile :; do printf x | claude -p --output-format json > o.json; done\n');
  // 포그라운드로 claude -p 를 곧바로 도는 스크립트(떼어 띄우지 않음) — 기동기 아님
  fs.writeFileSync(path.join(repo, 'scripts', 'fgloop.sh'), '#!/usr/bin/env bash\nfor i in 1 2; do claude -p < p.md; done\n');

  const now = Date.now();
  T = (sec) => new Date(now - 3000_000 + sec * 1000).toISOString();
  const base = (sid, ep = 'cli') => ({ sessionId: sid, cwd: repo, version: '2.1.309', entrypoint: ep });
  const A = (sec, block) => ({ type: 'assistant', timestamp: T(sec), ...base(M), message: { role: 'assistant', model: 'm', content: [block] } });
  const R = (sec, id, text) => ({ type: 'user', timestamp: T(sec), ...base(M), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, toolUseResult: { stdout: text, stderr: '' } });
  const pdir = path.join(projects, enc(repo));
  write(pdir, M, [
    { type: 'user', timestamp: T(1), ...base(M), message: { role: 'user', content: '재부팅 뒤 재개' } },
    A(5, { type: 'tool_use', id: 'toolu_dry', name: 'Bash', input: { command: 'bash scripts/resume.sh --dry-run' } }),
    R(6, 'toolu_dry', 'DRY_RUN'),
    A(10, { type: 'tool_use', id: 'toolu_resume', name: 'Bash', input: { description: '재부팅 뒤 루프 재개', command: 'bash scripts/resume.sh; echo "rc=$?"', timeout: 600000 } }),
    R(30, 'toolu_resume', 'started\nrc=0'),
    A(40, { type: 'tool_use', id: 'toolu_fg', name: 'Bash', input: { command: 'bash scripts/fgloop.sh 2>&1 | tail -3' } }),
    R(45, 'toolu_fg', 'ok'),
    A(300, { type: 'text', text: '대기' }),
  ]);
  const sdk = (sid, sec, prompt, endSec) => write(pdir, sid, [
    { type: 'user', timestamp: T(sec), ...base(sid, 'sdk-cli'), promptSource: 'sdk', message: { role: 'user', content: prompt } },
    { type: 'assistant', timestamp: T(endSec), ...base(sid, 'sdk-cli'), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '사이클 끝' }] } },
  ]);
  sdk(C1, 60, '자율 사이클이다.\n첫 회차', 200);
  sdk(C2, 400, '자율 사이클이다.\n둘째 회차', 900);
  const touch = (sid, sec) => fs.utimesSync(path.join(pdir, `${sid}.jsonl`), new Date(Date.parse(T(sec))), new Date(Date.parse(T(sec))));
  touch(C1, 200); touch(C2, 900); touch(M, 300);
  index = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'sessions') });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('판정: 포그라운드 스크립트는 사슬 안에서 떼어 띄운 뒤의 claude -p 만 기동기 · 시험 실행 · 포그라운드 루프는 아님', () => {
  assert.equal(detectLaunch('bash scripts/resume.sh; echo "rc=$?"'), null, 'fg 옵션 없이는 예전 그대로');
  const L = detectLaunch('bash scripts/resume.sh; echo "rc=$?"', { fg: true });
  assert.deepEqual({ tokens: L.tokens, fg: L.fg, detached: L.detached }, { tokens: ['scripts/resume.sh'], fg: true, detached: false });
  const a = analyzeLaunch(L, repo);
  assert.ok(a, 'resume.sh → (nohup) relaunch.sh → (nohup) loop.sh 의 claude -p');
  assert.equal(a.script, 'resume.sh');
  assert.equal(a.innerDetach, true);
  assert.deepEqual(a.via.map((x) => x.split('/').pop()), ['resume.sh', 'relaunch.sh', 'loop.sh'], '따옴표 안 경로·$ 경로는 따라가지 않음');
  assert.equal(detectLaunch('bash scripts/resume.sh --dry-run', { fg: true }), null, '시험 실행');
  assert.equal(analyzeLaunch(detectLaunch('bash scripts/fgloop.sh 2>&1 | tail -3', { fg: true }), repo), null, '포그라운드 루프는 기동기 아님');
  assert.equal(analyzeLaunch(detectLaunch('bash scripts/loop.sh', { fg: true }), repo), null, '러너를 포그라운드로 부른 것도 아님');
  assert.equal(detectLaunch('python tools/x.py', { fg: true }), null, '포그라운드 후보는 셸 스크립트만');
  const d = detectLaunch('bash scripts/setup.sh && nohup bash .loop/relaunch.sh &', { fg: true });
  assert.deepEqual(d.tokens, ['.loop/relaunch.sh'], '분리 표지 구간이 있으면 예전 규칙만');
  assert.equal(d.fg, undefined);
});

for (const offline of [false, true]) {
  test(`${offline ? '재생' : '라이브'}: 포그라운드 재개 스크립트 → 최상위 기동기 → 러너 → 회차`, async () => {
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
      const ln = g.get('b:toolu_resume');
      assert.ok(ln, '기동기 노드');
      assert.equal(ln.label, '기동기 · resume.sh');
      assert.equal(ln.parentId, null, '안에서 떼어 띄운 기동기는 최상위(§61.2)');
      assert.equal(ln.meta.spawnedBy, `s:${M}`);
      assert.deepEqual(ln.meta.launcher.via, ['resume.sh', 'relaunch.sh', 'loop.sh']);
      const rn = g.get('b:toolu_resume-r1');
      assert.ok(rn, '러너 노드');
      assert.equal(rn.label, '러너 · loop.sh');
      assert.equal(g.get(`s:${C1}`)?.parentId, 'b:toolu_resume-r1');
      assert.equal(g.get(`s:${C2}`)?.parentId, 'b:toolu_resume-r1');
      assert.equal(g.get(`s:${C1}`).meta.link.by, 'launcher');
      assert.ok(!g.get('b:toolu_dry')?.meta?.launcher, '시험 실행은 기동기 아님');
      assert.ok(!g.get('b:toolu_fg')?.meta?.launcher, '포그라운드 루프는 기동기 아님');
    } finally { rt.close?.(); }
  });
}
