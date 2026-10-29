// 자율 루프 판: 단계 설계서·셸 grep → 러너 meta.plans(일반 계획판 출처는 폐기). 러너 아래 회차가 만진 단계 설계서는 러너의 계획 + 항목마다 처리한 회차.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Graph } from '../graph.mjs';
import { PlanTracker, planStart, parsePlanMarkdown, phaseStatus, planTitleOf, normStatus, PLAN } from '../plans.mjs';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { LauncherIndex } from '../launcher.mjs';
import { buildReplay } from '../replay.mjs';

const DESIGN = (st) => `# 축 설계
## §3 단계
### 단계 0 — 재측정
**단계 0 상태**: ${st[0]}
### 단계 1 — ADR · 배선
**단계 1 상태**: ${st[1]}
### 단계 2 — 배포
**단계 2 상태**: ${st[2]}
`;

function tree(privacy = 'summary') {
  const g = new Graph({ rootSessionId: 'm', privacy, keepAll: true, localSeq: true });
  const T = (s) => new Date(Date.UTC(2026, 9, 24, 0, 0, s)).toISOString();
  g.addNode({ id: 's:m', kind: 'main', label: '메인' }, T(0));
  g.addNode({ id: 'a:sub', parentId: 's:m', kind: 'subagent', label: '서브' }, T(1));
  g.addNode({ id: 'b:L', parentId: 's:m', kind: 'bash-bg', label: '기동기 · relaunch.sh', meta: { launcher: { script: 'relaunch.sh', via: ['relaunch.sh', 'autopilot.sh'] } } }, T(2));
  g.addNode({ id: 'b:L-r1', parentId: 'b:L', kind: 'bash-bg', label: '러너 · autopilot.sh', meta: { runner: { script: 'autopilot.sh', instance: 1, launcher: 'b:L' } } }, T(3));
  g.addNode({ id: 's:c2', parentId: 'b:L-r1', kind: 'claude-p', label: '회차 2', meta: { cycle: 2 } }, T(4));
  g.addNode({ id: 's:c3', parentId: 'b:L-r1', kind: 'claude-p', label: '회차 3', meta: { cycle: 3 } }, T(5));
  g.addNode({ id: 'a:c3sub', parentId: 's:c3', kind: 'subagent', label: '회차 3 서브' }, T(6));
  return { g, T, plans: (id) => g.get(id).meta.plans };
}
const run = (pt, name, input, nodeId, ts, tur = {}, ok = true, cwd = 'D:/r') => pt.end(planStart(name, input, { cwd }), { ok, tur, nodeId, ts });


test('파서: 단계 설계서·상태 매핑·제목(체크박스·느슨한 목록 파서는 단계 설계서 일부 판정에 남음)', () => {
  const d = parsePlanMarkdown(DESIGN(['✅ **닫힘**(2026-10-24)', '◑ 미착지', '⏸ 외부 대기']));
  assert.equal(d.kind, 'phases');
  assert.equal(d.title, '축 설계');
  assert.deepEqual(d.items.map((x) => [x.k, x.t, x.s, x.hold || 0]), [['단계 0', '단계 0 — 재측정', 'done', 0], ['단계 1', '단계 1 — ADR · 배선', 'pending', 0], ['단계 2', '단계 2 — 배포', 'pending', 1]]);
  assert.equal(phaseStatus('🔧 진행 중').s, 'in_progress');
  assert.equal(phaseStatus('◑ 미착지').s, 'pending');
  const c = parsePlanMarkdown('## 남은 작업\n- [x] 서버 모델\n- [ ] **웹** 보드 `plan-ui`\n  - [~] 팝업\n```\n- [ ] 코드 안은 무시\n```');
  assert.equal(c.kind, 'checkbox');
  assert.deepEqual(c.items.map((x) => [x.t, x.s]), [['서버 모델', 'done'], ['웹 보드 plan-ui', 'pending'], ['팝업', 'in_progress']]);
  assert.equal(parsePlanMarkdown('- [ ] 하나만'), null, '체크박스 하나는 계획 아님(기본 2개)');
  assert.equal(parsePlanMarkdown('그냥 글'), null);
  const lp = parsePlanMarkdown('# 계획\n## 배경\n글\n1. 서버\n2. 웹\n3. 시험', { loose: true });
  assert.deepEqual(lp.items.map((x) => x.t), ['서버', '웹', '시험']);
  const hp = parsePlanMarkdown('# 계획\n## 요약\n## 서버 바꾸기\n## 웹 바꾸기', { loose: true });
  assert.deepEqual(hp.items.map((x) => x.t), ['서버 바꾸기', '웹 바꾸기'], '요약 같은 절 제목은 빼고 나머지 ## 제목');
  assert.equal(planTitleOf('D:\\Works\\26.10.23 시각화\\_STATUS.md'), '26.10.23 시각화/_STATUS.md');
  assert.equal(planTitleOf('/r/docs/plans/2026-10-24-x-execution-design.md'), '2026-10-24-x-execution-design.md');
  assert.equal(normStatus('completed'), 'done'); assert.equal(normStatus('in_progress'), 'in_progress'); assert.equal(normStatus('?'), 'pending');
});

test('러너: 회차가 읽은 단계 설계서 = 러너의 계획, 항목마다 처리 회차, 셸 grep 으로 상태 갱신, 늦게 읽힌 옛 관찰은 새 상태를 못 덮음', () => {
  const { g, T, plans } = tree();
  const pt = new PlanTracker({ graph: g });
  const F = 'D:/r/docs/plans/2026-10-24-x-execution-design.md';
  run(pt, 'Read', { file_path: F }, 's:c2', T(100), { file: { content: DESIGN(['◑ 미착지', '◑ 미착지', '◑ 미착지']), numLines: 9, startLine: 1, totalLines: 9 } });
  let p = plans('b:L-r1')[0];
  assert.equal(p.src, 'phases'); assert.equal(p.cy, 2); assert.equal(p.by, 's:c2');
  run(pt, 'Edit', { file_path: F, old_string: '**단계 0 상태**: ◑ 미착지', new_string: '**단계 0 상태**: ✅ **닫힘**' }, 's:c2', T(110));
  // 회차 3: 기억한 본문은 회차 2 것이라 쓰지 않고, grep 으로 본 표식 + 회차 안 서브에이전트의 Edit
  run(pt, 'Bash', { command: "grep -n '단계 . 상태' docs/plans/2026-10-24-x-execution-design.md" }, 's:c3', T(200), { stdout: '4:**단계 0 상태**: ✅ **닫힘**\n6:**단계 1 상태**: ✅ **닫힘**\n8:**단계 2 상태**: ◑ 미착지' }, true, 'D:/r');
  run(pt, 'Edit', { file_path: F, old_string: '**단계 2 상태**: ◑ 미착지', new_string: '**단계 2 상태**: ✅ **닫힘**' }, 'a:c3sub', T(220));
  p = plans('b:L-r1')[0];
  assert.deepEqual(p.items.map((x) => [x.t, x.s, x.cy]), [['단계 0 — 재측정', 'done', 2], ['단계 1 — ADR · 배선', 'done', 3], ['단계 2 — 배포', 'done', 3]]);
  assert.equal(p.items[2].by, 's:c3', '회차 안 서브에이전트가 고쳐도 처리 회차는 그 회차');
  assert.equal(p.cy, 3);
  // 메인(감독)이 나중에 옛 본문 사본을 읽은 기록이 늦게 처리됨(시각은 앞) → 새 상태 유지, 주인도 러너 그대로
  run(pt, 'Read', { file_path: F }, 's:m', T(150), { file: { content: DESIGN(['✅', '◑ 미착지', '◑ 미착지']), numLines: 9, startLine: 1, totalLines: 9 } });
  p = plans('b:L-r1')[0];
  assert.deepEqual(p.items.map((x) => x.s), ['done', 'done', 'done']);
  assert.equal(plans('s:m'), undefined);
  // 낸 시각은 줄지 않음(재생 정렬 뒤에도 마지막 계산이 마지막)
  const ts = g.ring.filter((e) => e.nodeId === 'b:L-r1' && e.patch?.meta?.plans !== undefined).map((e) => Date.parse(e.ts));
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
});

test('러너 실구조(합성 레포): 재기동기 → 러너 → 회차 Read·Edit → 러너 meta.plans + 회차 번호, 라이브·재생 같음', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-planrun-'));
  try {
    const M = 'b8b8b8b8-8888-4888-8888-888888888888';
    const E = [0, 1].map((i) => `f${i}f${i}f${i}f${i}-0000-4000-8000-00000000000${i}`);
    const enc = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
    const projects = path.join(root, 'projects');
    fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
    const repo = path.join(root, 'repo');
    fs.mkdirSync(path.join(repo, '.loop'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.loop', 'relaunch.sh'), '#!/usr/bin/env bash\nnohup bash scripts/runner.sh >> r.out 2>&1 < /dev/null &\n');
    fs.writeFileSync(path.join(repo, 'scripts', 'runner.sh'), '#!/usr/bin/env bash\nfor i in 1 2; do cat p.md | claude -p --output-format json > o.json; done\n');
    const now = Date.now();
    const T = (sec) => new Date(now - 3000_000 + sec * 1000).toISOString();
    const base = (sid, ep = 'cli') => ({ sessionId: sid, cwd: repo, version: '2.1.309', entrypoint: ep });
    const pdir = path.join(projects, enc(repo));
    const write = (sid, recs) => { fs.mkdirSync(pdir, { recursive: true }); fs.writeFileSync(path.join(pdir, `${sid}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); };
    write(M, [
      { type: 'user', timestamp: T(1), ...base(M), message: { role: 'user', content: '루프를 띄운다' } },
      { type: 'assistant', timestamp: T(10), ...base(M), message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 'toolu_rl', name: 'Bash', input: { command: 'nohup bash .loop/relaunch.sh > /dev/null 2>&1 &' } }] } },
      { type: 'user', timestamp: T(11), ...base(M), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_rl', content: '' }] }, toolUseResult: { stdout: '' } },
      { type: 'assistant', timestamp: T(2900), ...base(M), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '감독 중' }] } },
    ]);
    const F = path.join(repo, 'docs', 'plans', 'axis-execution-design.md');
    const A = (sid, s, id, name, input) => ({ type: 'assistant', timestamp: T(s), ...base(sid, 'sdk-cli'), message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id, name, input }] } });
    const R = (sid, s, id, tur) => ({ type: 'user', timestamp: T(s), ...base(sid, 'sdk-cli'), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, toolUseResult: tur });
    [[100, ['◑ 미착지', '◑ 미착지', '◑ 미착지'], 0], [300, ['✅ 닫힘', '◑ 미착지', '◑ 미착지'], 1]].forEach(([sec, st, i]) => {
      const sid = E[i];
      write(sid, [
        { type: 'user', timestamp: T(sec), ...base(sid, 'sdk-cli'), promptSource: 'sdk', message: { role: 'user', content: `자율 사이클 ${i + 1}회 — 축 A\n\n본문` } },
        A(sid, sec + 5, `r${i}`, 'Read', { file_path: F }), R(sid, sec + 6, `r${i}`, { type: 'text', file: { filePath: F, content: DESIGN(st), numLines: 9, startLine: 1, totalLines: 9 } }),
        A(sid, sec + 50, `e${i}`, 'Edit', { file_path: F, old_string: `**단계 ${i} 상태**: ◑ 미착지`, new_string: `**단계 ${i} 상태**: ✅ 닫힘` }), R(sid, sec + 51, `e${i}`, { filePath: F }),
        { type: 'assistant', timestamp: T(sec + 100), ...base(sid, 'sdk-cli'), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '끝' }] } },
      ]);
      fs.utimesSync(path.join(pdir, `${sid}.jsonl`), new Date(Date.parse(T(sec + 100))), new Date(Date.parse(T(sec + 100))));
    });
    fs.utimesSync(path.join(pdir, `${M}.jsonl`), new Date(Date.parse(T(2900))), new Date(Date.parse(T(2900))));
    const index = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'sessions') });
    const results = [];
    for (const offline of [false, true]) {
      await index.refresh();
      index.claimedChildren.clear();
      index.launchers = new LauncherIndex(index, { bootMs: 0 });
      const rt = new RootRuntime({ sessionId: M, index, offline });
      try {
        if (offline) await rt.loadOffline();
        else { await rt.start(); for (let k = 0; k < 20 && !rt.graph.get(`s:${E[1]}`); k++) { await rt.scanAll(); await new Promise((r) => setTimeout(r, 50)); } rt.sweep(); }
        const runner = [...rt.graph.nodes.values()].find((n) => n.meta?.runner);
        assert.ok(runner, '러너 노드');
        const pl = runner.meta.plans;
        assert.ok(pl && pl.length === 1, '러너가 단계 설계서 계획을 가짐');
        results.push(pl[0]);
        assert.equal(rt.graph.get(`s:${E[1]}`).meta.plans, undefined, '회차 노드에는 없음(러너 쪽)');
      } finally { rt.close(); }
    }
    for (const p of results) {
      assert.equal(p.src, 'phases');
      assert.deepEqual(p.items.map((x) => [x.s, x.cy ?? null]), [['done', 1], ['done', 2], ['pending', null]]);
    }
    assert.deepEqual(results[0].items.map((x) => [x.t, x.s, x.at]), results[1].items.map((x) => [x.t, x.s, x.at]), '라이브·재생 같은 답');
  } finally { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} }
});

test('단계 설계서 형식 넓힘: Phase N·1a·두 자리·표 줄·표식 없는 단계는 대기, 옛 **단계 N 상태** 그대로', () => {
  const en = parsePlanMarkdown('# Rollout\n## Phase 1 — Measure\n**Phase 1 status**: ✅ done\n## Phase 2: Build\n## Phase 10 — Ship\n### Phase 2.1 sub\n');
  assert.equal(en.kind, 'phases');
  assert.deepEqual(en.items.map((x) => [x.k, x.t, x.s]), [['단계 1', 'Phase 1 — Measure', 'done'], ['단계 2', 'Phase 2 — Build', 'pending'], ['단계 10', 'Phase 10 — Ship', 'pending']]);
  const sub = parsePlanMarkdown('# 축\n### 단계 1a — 앞\n**단계 1a 상태**: 🔧 진행 중\n### 단계 1b — 뒤\n### 단계 2 — 끝\n');
  assert.deepEqual(sub.items.map((x) => [x.k, x.s, x.nos || 0]), [['단계 1a', 'in_progress', 0], ['단계 1b', 'pending', 1], ['단계 2', 'pending', 1]]);
  const tb = parsePlanMarkdown('# 표\n| 단계 | 내용 | 상태 |\n|---|---|---|\n| 단계 0 | 재측정 | ✅ 닫힘 |\n| **단계 1** | 배선 | ⏸ 보류 |\n| 단계 2 | 배포 | |\n');
  assert.deepEqual(tb.items.map((x) => [x.t, x.s, x.hold || 0]), [['단계 0 — 재측정', 'done', 0], ['단계 1 — 배선', 'pending', 1], ['단계 2 — 배포', 'pending', 0]]);
  assert.equal(parsePlanMarkdown('# 글\n## Phase 1 — 하나뿐'), null, '표식 없는 단계 제목 하나는 계획 아님');
  assert.equal(parsePlanMarkdown('## Phase 1\n## Phase 2\n- [ ] a\n- [ ] b').kind, 'checkbox', '체크박스 계획이 먼저');
  // 옛 형식: 표식 줄 + 표식 없는 단계 제목도 항목(대기)
  const d = parsePlanMarkdown(DESIGN(['✅', '◑ 미착지', '◑ 미착지']) + '### 단계 3 — 정리\n');
  assert.deepEqual(d.items.map((x) => [x.k, x.s]), [['단계 0', 'done'], ['단계 1', 'pending'], ['단계 2', 'pending'], ['단계 3', 'pending']]);
});

test('러너: 부분 관찰(앞부분 sed·부분 Read·여러 파일 명령의 grep)은 아는 단계를 지우지 않고 합침', () => {
  const { g, T, plans } = tree();
  const pt = new PlanTracker({ graph: g });
  const F = 'docs/plans/2026-10-26-x-execution-design.md';
  const doc = DESIGN(['◑ 미착지', '◑ 미착지', '◑ 미착지']) + '### 단계 3 — 정리\n**단계 3 상태**: ◑ 미착지\n';
  const head = doc.split('\n').slice(0, 4).join('\n'); // # 제목 · · 단계 0 제목 · 단계 0 표식
  // 회차 2: 앞부분만 sed — 단계 0 만 보임
  run(pt, 'Bash', { command: `sed -n 1,4p ${F}` }, 's:c2', T(10), { stdout: head });
  assert.deepEqual(plans('b:L-r1')[0].items.map((x) => x.t), ['단계 0 — 재측정']);
  // 회차 2: git status 와 SUPERVISOR.md 를 함께 본 명령 끝의 grep(경로 머리 없음) → 설계서 몫으로 나머지 단계
  run(pt, 'Bash', { command: `git status -sb && wc -l .work/SUPERVISOR.md && grep -n "단계 [0-9] 상태" ${F}` }, 's:c2', T(5),
    { stdout: '## main\n2313 .work/SUPERVISOR.md\n4:**단계 0 상태**: ◑ 미착지\n6:**단계 1 상태**: ◑ 미착지\n8:**단계 2 상태**: ✅ 닫힘\n11:**단계 3 상태**: ◑ 미착지' });
  let p = plans('b:L-r1')[0];
  assert.deepEqual(p.items.map((x) => [x.t, x.s]), [['단계 0 — 재측정', 'pending'], ['단계 1', 'pending'], ['단계 2', 'done'], ['단계 3', 'pending']]);
  assert.equal(p.items[0].t, '단계 0 — 재측정', 'grep 의 맨 "단계 N" 이 제목을 덮지 않음');
  // 회차 3: 부분 Read(중간) — 단계 1·2 제목이 보이고 단계 2 표식은 없음 → 단계 2 의 완료는 유지, 단계 0·3 도 유지
  run(pt, 'Read', { file_path: 'D:/r/' + F, offset: 5, limit: 3 }, 's:c3', T(30), { file: { content: '### 단계 1 — ADR · 배선\n**단계 1 상태**: ✅ 닫힘\n### 단계 2 — 배포', startLine: 5, numLines: 3, totalLines: 11 } });
  p = plans('b:L-r1')[0];
  assert.deepEqual(p.items.map((x) => [x.t, x.s]), [['단계 0 — 재측정', 'pending'], ['단계 1 — ADR · 배선', 'done'], ['단계 2 — 배포', 'done'], ['단계 3', 'pending']]);
  // 제목만 보는 grep(상태 없음)도 지우지 않고 맨 글에 제목 채움
  run(pt, 'Bash', { command: `grep -n "^#" ${F}` }, 's:c3', T(40), { stdout: '1:# 축 설계\n2:## §3 단계\n3:### 단계 0 — 재측정\n10:### 단계 3 — 정리' });
  p = plans('b:L-r1')[0];
  assert.equal(p.n, 4);
  assert.deepEqual(p.items.map((x) => [x.t, x.s]), [['단계 0 — 재측정', 'pending'], ['단계 1 — ADR · 배선', 'done'], ['단계 2 — 배포', 'done'], ['단계 3 — 정리', 'pending']]);
  // 머리 없는 줄을 받을 파일이 모호하면(설계서 이름이 둘) 버림
  run(pt, 'Bash', { command: 'grep -n "단계 . 상태" docs/plans/a-design.md && cat docs/plans/b-design.md' }, 's:c3', T(50), { stdout: '**단계 9 상태**: ✅' });
  assert.equal(plans('b:L-r1').length, 1);
});

test('§122 출처 폐기: TodoWrite·Task·ExitPlanMode·Workflow 는 계획이 아니고, 체크박스 md·러너 밖 단계 설계서도 계획을 만들지 않음', () => {
  for (const [n, i] of [['TodoWrite', { todos: [{ content: 'a', status: 'pending' }] }], ['TaskCreate', { subject: 'x' }], ['ExitPlanMode', { plan: '1. a\n2. b' }], ['Workflow', { script: "phases: [{ title: 'A' }]" }]]) assert.equal(planStart(n, i), null, n);
  const g = new Graph({ rootSessionId: 'S', localSeq: true });
  g.addNode({ id: 's:m', parentId: null, kind: 'main', label: 'm', sessionId: 'S', meta: {} });
  g.finishLoad();
  const pt = new PlanTracker({ graph: g });
  pt.end(planStart('Write', { file_path: 'D:/r/TODO.md', content: '- [ ] a\n- [ ] b\n' }), { ok: true, tur: null, nodeId: 's:m', ts: '2026-10-28T00:00:00Z' });
  pt.end(planStart('Write', { file_path: 'D:/r/docs/x-execution-design.md', content: DESIGN(['✅', '◑', '◑']) }), { ok: true, tur: null, nodeId: 's:m', ts: '2026-10-28T00:00:01Z' });
  assert.equal(g.get('s:m').meta.plans, undefined, '러너 밖에서는 계획 없음');
});
