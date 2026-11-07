// 점검만 부르는 호출은 기동 사슬이 아니다: 서브에이전트가 축 고르기 라이브러리를 백그라운드로 '미리 보기'(run_in_background,
// `source scripts/lib/pick.sh … ; pick_axis`)로 돌리면, 라이브러리 안의 `bash scripts/loop.sh --check`(읽기 전용 점검)를 따라가
// loop.sh 의 claude -p 를 보고 기동기로 잡았다(실측 자율 루프 저장소 3c8e89e4 `기동기 · autopilot-pick-axis.sh`). 합성 레포·transcript.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { detectLaunch, analyzeLaunch, LauncherIndex } from '../launcher.mjs';
import { collectExtras } from '../../bin/archive.mjs';

const M = 'e3e3e3e3-3333-4333-8333-333333333333';
const C1 = 'f3f3f3f3-0000-4000-8000-000000000003';
const enc = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
let root, projects, index, repo;
const write = (dir, sid, recs) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${sid}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); };
const PREVIEW = 'cd REPO && source scripts/lib/pick.sh && eval "$(grep -m1 \'^AXIS_QUEUE=(\' .loop/relaunch.sh)" && timeout 400 bash -c \'source scripts/lib/pick.sh; pick_axis\'; echo rc=$?';

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-check-'));
  projects = path.join(root, 'projects');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  repo = path.join(root, 'repo');
  for (const d of [path.join(repo, '.loop'), path.join(repo, 'scripts', 'lib')]) fs.mkdirSync(d, { recursive: true });
  // 축 고르기 라이브러리: 축마다 러너를 점검 모드로 한 번(읽기 전용) — 실물 autopilot-pick-axis.sh 의 모양
  fs.writeFileSync(path.join(repo, 'scripts', 'lib', 'pick.sh'), [
    '#!/usr/bin/env bash', 'pick_axis() {', '  for a in "$@"; do', '    AXIS="$a" timeout 180 bash scripts/loop.sh --check 2>/dev/null && echo "$a"', '  done', '}', '',
  ].join('\n'));
  // 재기동기: 라이브러리를 source 하고(점검), 진짜 러너는 nohup 으로 — 이것은 그대로 기동기
  fs.writeFileSync(path.join(repo, '.loop', 'relaunch.sh'), [
    '#!/usr/bin/env bash', 'AXIS_QUEUE=(a b)', 'source scripts/lib/pick.sh', 'AXIS=$(pick_axis "${AXIS_QUEUE[@]}")',
    'nohup bash scripts/loop.sh >> runner.out 2>&1 < /dev/null &', '',
  ].join('\n'));
  fs.writeFileSync(path.join(repo, 'scripts', 'loop.sh'), '#!/usr/bin/env bash\n[ "$1" = --check ] && exit 0\nwhile :; do printf x | claude -p --output-format json > o.json; done\n');
  fs.writeFileSync(path.join(repo, 'scripts', 'resume.sh'), '#!/usr/bin/env bash\nnohup bash .loop/relaunch.sh > relaunch.out 2>&1 < /dev/null &\n');

  const now = Date.now();
  const T = (sec) => new Date(now - 3000_000 + sec * 1000).toISOString();
  const base = (sid, ep = 'cli') => ({ sessionId: sid, cwd: repo, version: '2.1.309', entrypoint: ep });
  const A = (sec, block) => ({ type: 'assistant', timestamp: T(sec), ...base(M), message: { role: 'assistant', model: 'm', content: [block] } });
  const R = (sec, id, text, tur) => ({ type: 'user', timestamp: T(sec), ...base(M), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, toolUseResult: tur || { stdout: text, stderr: '' } });
  const outDir = path.join(root, 'tasks');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'bpv01.output'), 'a\nrc=0\n');
  const pdir = path.join(projects, enc(repo));
  write(pdir, M, [
    { type: 'user', timestamp: T(1), ...base(M), message: { role: 'user', content: '축 미리 보고 루프 재개' } },
    A(5, { type: 'tool_use', id: 'toolu_preview', name: 'Bash', input: { description: 'Preview which axis relauncher would pick', command: PREVIEW.replace('REPO', repo.replace(/\\/g, '/')), run_in_background: true } }),
    R(6, 'toolu_preview', `Command running in background with ID: bpv01. Output is being written to: ${path.join(outDir, 'bpv01.output')}`, { stdout: '', stderr: '', backgroundTaskId: 'bpv01' }),
    A(10, { type: 'tool_use', id: 'toolu_resume', name: 'Bash', input: { description: '루프 재개', command: 'bash scripts/resume.sh; echo "rc=$?"' } }),
    R(12, 'toolu_resume', 'rc=0'),
    A(300, { type: 'text', text: '대기' }),
  ]);
  write(pdir, C1, [
    { type: 'user', timestamp: T(60), ...base(C1, 'sdk-cli'), promptSource: 'sdk', message: { role: 'user', content: '자율 사이클이다.\n첫 회차' } },
    { type: 'assistant', timestamp: T(200), ...base(C1, 'sdk-cli'), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '사이클 끝' }] } },
  ]);
  const touch = (sid, sec) => fs.utimesSync(path.join(pdir, `${sid}.jsonl`), new Date(Date.parse(T(sec))), new Date(Date.parse(T(sec))));
  touch(C1, 200); touch(M, 300);
  index = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'sessions') });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('판정: 점검 인자(--check 등)로 부른 스크립트는 따라가지 않음 · 진짜 사슬은 그대로', () => {
  const cmd = PREVIEW.replace('REPO', repo.replace(/\\/g, '/'));
  const L = detectLaunch(cmd, { bg: true, fg: true });
  assert.deepEqual(L.tokens, ['scripts/lib/pick.sh'], '백그라운드 구간의 source 는 후보');
  assert.equal(analyzeLaunch(L, repo), null, 'pick.sh → loop.sh --check 는 점검만 — claude -p 가 돌지 않음');
  const a = analyzeLaunch(detectLaunch('bash scripts/resume.sh; echo "rc=$?"', { fg: true }), repo);
  assert.ok(a, '재개 스크립트 → (nohup) relaunch.sh → (nohup) loop.sh');
  assert.equal(a.innerDetach, true);
  assert.deepEqual(a.via.map((x) => x.split('/').pop()), ['resume.sh', 'relaunch.sh', 'pick.sh', 'loop.sh']);
  const b = analyzeLaunch(detectLaunch('nohup bash .loop/relaunch.sh > relaunch.out 2>&1 < /dev/null & disown'), repo);
  assert.equal(b?.script, 'relaunch.sh', '분리 기동 재기동기는 그대로');
  // 명령 구간에서 직접 점검 인자로 부른 러너도 기동 후보가 아님(백그라운드 · 분리 표지 모두)
  assert.equal(detectLaunch('bash scripts/loop.sh --check', { bg: true }), null);
  assert.equal(detectLaunch('nohup bash scripts/loop.sh --dry-run > x.out 2>&1 &'), null);
  assert.deepEqual(detectLaunch('nohup bash scripts/loop.sh --axis a > x.out 2>&1 &')?.tokens, ['scripts/loop.sh'], '다른 인자는 그대로');
});

for (const offline of [false, true]) {
  test(`${offline ? '재생' : '라이브'}: 미리 보기 백그라운드 명령은 기동기 아님 · 재개 스크립트 기동기 아래 회차`, async () => {
    await index.refresh();
    index.claimedChildren.clear();
    index.launchers = new LauncherIndex(index, { bootMs: 0 });
    const rt = new RootRuntime({ sessionId: M, index, offline });
    try {
      if (offline) await rt.loadOffline();
      else {
        await rt.start();
        for (let i = 0; i < 20 && !rt.graph.get(`s:${C1}`); i++) { await rt.scanAll(); await new Promise((r) => setTimeout(r, 50)); }
        rt.sweep();
      }
      const g = rt.graph;
      const pv = g.get('b:bpv01');
      assert.ok(pv, '미리 보기 백그라운드 명령 노드');
      assert.ok(!pv.meta.launcher, '기동기 아님');
      assert.ok(!/^기동기/.test(pv.label), pv.label);
      const ln = g.get('b:toolu_resume');
      assert.equal(ln?.label, '기동기 · resume.sh');
      assert.equal(g.get(`s:${C1}`)?.meta?.link?.by, 'launcher');
      assert.equal(g.get(`s:${C1}`).meta.link.toolUseId ?? 'toolu_resume', 'toolu_resume');
    } finally { rt.close?.(); }
  });
}

test('보관함 고정 판정(pins.launches): 미리 보기는 없고 재개 스크립트 기동만 고정', async () => {
  index.claimedChildren.clear();
  index.launchers = new LauncherIndex(index, { bootMs: 0 });
  const ex = await collectExtras({ from: projects, sid: M, index });
  assert.ok(!ex.pins.launches.toolu_preview, '미리 보기 판정은 고정하지 않음');
  assert.equal(ex.pins.launches.toolu_resume?.script, 'resume.sh');
  assert.equal(ex.pins.launches.toolu_resume?.innerDetach, true);
});
