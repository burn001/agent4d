// claude -p 자식 매칭 보강(4차): 명령에 claude -p 가 안 보이는 실행(스크립트가 띄움)·호출 앞 중간의 cd·heredoc 프롬프트
// 이 PC 에서 짝을 못 찾아 독립 루트로 떨어지던 실제 모양을 합성 transcript 로 재현한다(실제 transcript 는 쓰지 않음).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { detectClaudeP, promptMatches, scratchOwnerOf, lastCdBefore, promptCandidates } from '../parse.mjs';

const M = 'aaaaaaaa-1111-4111-8111-111111111111';
const C_SCRIPT = 'bbbbbbbb-2222-4222-8222-222222222222'; // 스크립트가 띄운 claude -p (cwd = 메인 scratchpad)
const C_HEREDOC = 'cccccccc-3333-4333-8333-333333333333'; // `export … && cd X && claude -p "$(cat <<'EOF' …)"`
const STRAY = 'dddddddd-4444-4444-8444-444444444444'; // 같은 시각 남의 claude -p (붙으면 안 됨)
const enc = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');

let root, index, tmpClaude, scratch, otherCwd;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-match-'));
  const projects = path.join(root, 'projects');
  const sessions = path.join(root, 'sessions');
  tmpClaude = path.join(root, 'tmp', 'claude');
  fs.mkdirSync(sessions, { recursive: true });
  const cwd = 'D:\\work\\demo';
  scratch = path.join(tmpClaude, enc(cwd), M, 'scratchpad', 'w1');
  otherCwd = 'C:\\other\\place';
  fs.mkdirSync(scratch, { recursive: true });
  const now = Date.now();
  const T = (sec) => new Date(now - 600_000 + sec * 1000).toISOString();
  const write = (dir, sid, recs) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${sid}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); };
  const base = (sid, c, ep = 'cli') => ({ sessionId: sid, cwd: c, version: '2.1.309', entrypoint: ep });
  const A = (sec, block) => ({ type: 'assistant', timestamp: T(sec), ...base(M, cwd), message: { role: 'assistant', model: 'm', content: [block] } });
  const R = (sec, id, text) => ({ type: 'user', timestamp: T(sec), ...base(M, cwd), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, toolUseResult: { stdout: text, stderr: '' } });
  const heredocCmd = `export LANG=C && cd /c/other/place && claude -p "$(cat <<'EOF'\n이 문서를   세 줄로 요약해 주세요 heredoc\nEOF\n)" --output-format text`;
  write(path.join(projects, enc(cwd)), M, [
    { type: 'user', timestamp: T(1), ...base(M, cwd), message: { role: 'user', content: '작업 시작' } },
    A(10, { type: 'tool_use', id: 'toolu_script', name: 'Bash', input: { command: 'node tools/run-agents.mjs --n 1', description: '에이전트 스크립트' } }),
    R(40, 'toolu_script', 'ok'),
    A(50, { type: 'tool_use', id: 'toolu_hd', name: 'Bash', input: { command: heredocCmd } }),
    R(70, 'toolu_hd', '요약'),
  ]);
  const sdk = (sid, c, sec, prompt) => write(path.join(projects, enc(c)), sid, [
    { type: 'user', timestamp: T(sec), ...base(sid, c, 'sdk-cli'), message: { role: 'user', content: prompt } },
    { type: 'assistant', timestamp: T(sec + 2), ...base(sid, c, 'sdk-cli'), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '응답' }] } },
  ]);
  sdk(C_SCRIPT, scratch, 12, '표준 입력으로 받은 지시문');
  sdk(C_HEREDOC, otherCwd, 52, '이 문서를 세 줄로 요약해 주세요 heredoc');
  sdk(STRAY, 'E:\\someone\\else', 13, '남의 작업');
  index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
  // CCVIZ_CLAUDE_TMP 는 건드리지 않는다(server/test/index.js 가 한 프로세스에서 모든 시험을 돌림). …/tmp/claude/<enc>/<uuid> 꼴은 기본 규칙으로 잡힌다
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('파서: 호출 앞 중간의 cd·heredoc·echo 파이프·플래그 뒤 위치 인자 프롬프트, 값 받는 플래그는 제외', () => {
  const d = detectClaudeP(`export A=1 && cd /d "D:/w x" && claude -p --model sonnet --append-system-prompt "너는 x" "진짜 프롬프트입니다" --output-format json`);
  assert.equal(d.cdGuess, 'D:/w x');
  assert.deepEqual(d.promptHints, ['진짜 프롬프트입니다']);
  assert.equal(lastCdBefore('cd a && x; cd "b c" && claude -p "q"', 30), 'b c');
  assert.deepEqual(promptCandidates(`claude -p "$(cat <<'EOF'\n본문 프롬프트 여기\nEOF\n)"`), ['본문 프롬프트 여기']);
  assert.deepEqual(detectClaudeP(`echo "파이프로 넘긴 프롬프트" | claude -p --max-turns 2`).promptHints, ['파이프로 넘긴 프롬프트']);
  assert.equal(detectClaudeP('node run.mjs'), null);
  // 홀로 선 & (2>&1·백그라운드) 가 있어도 끝난다(무한 반복 회귀 방지)
  assert.deepEqual(detectClaudeP('claude -p "리다이렉트 있는 프롬프트" 2>&1 & echo done').promptHints, ['리다이렉트 있는 프롬프트']);
  assert.ok(promptMatches(['이 문서를\n  세 줄로 요약해 주세요 heredoc'], '이 문서를 세 줄로 요약해 주세요 heredoc 그리고'));
  assert.ok(!promptMatches(['짧음'], '짧음이 들어 있는 첫 프롬프트'), '8자 미만 후보는 쓰지 않음');
  assert.equal(scratchOwnerOf(path.join(tmpClaude, 'D--x', M, 'scratchpad', 'q'), [tmpClaude]), M);
  assert.equal(scratchOwnerOf(path.join(tmpClaude, 'D--x'), [tmpClaude]), null);
  assert.equal(scratchOwnerOf('D:\\work\\claude\\x\\' + M, [tmpClaude]), null, '임시 폴더 밖은 무시');
});

for (const offline of [false, true]) {
  test(`${offline ? '재생(offline)' : '라이브'}: 스크립트가 띄운 claude -p 는 scratchpad cwd 로 그 셸 호출의 자식, heredoc 프롬프트·중간 cd 도 매칭, 남의 것은 안 붙음`, async () => {
    await index.refresh();
    index.claimedChildren.clear();
    const rt = new RootRuntime({ sessionId: M, index, offline });
    try {
      if (offline) await rt.loadOffline();
      else {
        await rt.start();
        for (let i = 0; i < 40 && !(rt.graph.get(`s:${C_SCRIPT}`) && rt.graph.get(`s:${C_HEREDOC}`)); i++) { await rt.scanAll(); await rt.pollAll(); await new Promise((r) => setTimeout(r, 100)); }
      }
      const a = rt.graph.get(`s:${C_SCRIPT}`);
      assert.ok(a, '스크립트 claude -p 가 자식으로 붙음');
      assert.equal(a.kind, 'claude-p');
      assert.equal(a.parentId, `s:${M}`);
      assert.equal(a.meta.toolUseId, 'toolu_script', '그 시각에 돌던 셸 호출');
      const b = rt.graph.get(`s:${C_HEREDOC}`);
      assert.ok(b, 'heredoc·중간 cd claude -p 매칭');
      assert.equal(b.meta.toolUseId, 'toolu_hd');
      // label: 부모 scratchpad(같은 프로젝트) → sid8 만, 다른 프로젝트 → 프로젝트 이름 + sid8. 지시문은 meta.title
      assert.equal(a.label, 'claude -p · bbbbbbbb');
      assert.equal(a.meta.title, null); // 지시문(첫 프롬프트)은 부제로 쓰지 않음
      assert.equal(b.label, 'claude -p · place · cccccccc');
      assert.equal(b.meta.title, null);
      assert.equal(rt.graph.get(`s:${STRAY}`), undefined, '남의 claude -p 는 안 붙음');
      assert.ok(index.claimedChildren.has(C_SCRIPT) && !index.claimedChildren.has(STRAY));
    } finally { rt.close(); }
  });
}

test('첫 프롬프트 자르기: 낱말 중간에서 자르지 않는다(경계에 걸친 비밀 앞부분이 남지 않음)', async () => {
  const { cutAtWord, parseHead, FIRST_PROMPT_MAX } = await import('../discovery.mjs');
  assert.equal(cutAtWord('abc defghij', 6), 'abc ');
  assert.equal(cutAtWord('abc def ghi', 7), 'abc def');
  assert.equal(cutAtWord('짧은 글', 100), '짧은 글');
  const secret = 'sk-ant-api03-' + 'Q'.repeat(60);
  const prompt = 'x '.repeat((FIRST_PROMPT_MAX - 20) / 2) + secret + ' 끝';
  const head = parseHead(JSON.stringify({ type: 'user', timestamp: '2026-10-23T00:00:00Z', entrypoint: 'cli', message: { role: 'user', content: prompt } }));
  assert.ok(head.firstPrompt.length <= FIRST_PROMPT_MAX);
  assert.ok(!head.firstPrompt.includes('sk-ant'), '잘린 비밀 앞부분이 남지 않음');
});

test('장시간 세션: 끝난 도구 기록은 상한(TOOLS_MAX)을 넘으면 오래된 것부터 지운다, 매칭 대기 중인 claude -p 도구는 남긴다', async () => {
  const { TOOLS_MAX, TOOLS_KEEP } = await import('../session.mjs');
  await index.refresh();
  index.claimedChildren.clear();
  const rt = new RootRuntime({ sessionId: M, index });
  await rt.start();
  try {
    const old = Date.now() - 3600_000;
    for (let i = 0; i < TOOLS_MAX + 2000; i++) rt.tools.set(`toolu_x${i}`, { id: `toolu_x${i}`, owner: `s:${M}`, name: 'Read', tsMs: old + i, ended: true, input: { command: 'x'.repeat(50) } });
    rt.tools.set('toolu_pending', { id: 'toolu_pending', owner: `s:${M}`, name: 'Bash', tsMs: old, ended: true, input: {} });
    rt.children.push({ toolUseId: 'toolu_pending', owner: `s:${M}`, tsMs: old, matched: null, dead: false, stdoutIds: [] });
    rt._lastSlim = 0;
    rt.sweep();
    assert.ok(rt.tools.size <= TOOLS_KEEP + 10, `size ${rt.tools.size}`);
    assert.ok(rt.tools.has('toolu_pending'), '매칭 대기 도구 유지');
    assert.ok(rt.tools.has(`toolu_x${TOOLS_MAX + 1999}`), '최근 것 유지');
    assert.ok(!rt.tools.has('toolu_x0'), '가장 오래된 것 삭제');
  } finally { rt.close(); }
});

test('tail 회전: 크기가 줄지 않는 교체(더 큰 새 파일로 rename)도 알아채고 처음부터 다시 읽는다', async () => {
  const { FileTail } = await import('../tail.mjs');
  const f = path.join(root, 'rot.jsonl');
  fs.writeFileSync(f, '{"n":1}\n{"n":2}\n');
  const got = [];
  const t = new FileTail(f, { onLine: (o) => got.push(o.n) });
  await t.drain();
  assert.deepEqual(got, [1, 2]);
  const tmp = f + '.new';
  fs.writeFileSync(tmp, '{"n":10}\n{"n":11}\n{"n":12}\n'); // 더 큰 새 파일
  await new Promise((r) => setTimeout(r, 30));
  fs.rmSync(f); fs.renameSync(tmp, f);
  await t.drain();
  assert.deepEqual(got, [1, 2, 10, 11, 12]);
  fs.writeFileSync(f + '.n2', '{"n":20}\n{"n":21}\n{"n":22}\n'); // 같은 크기 교체
  await new Promise((r) => setTimeout(r, 30));
  fs.rmSync(f); fs.renameSync(f + '.n2', f);
  await t.drain();
  assert.deepEqual(got.slice(-3), [20, 21, 22]);
  // 같은 크기 교체 100번: 예전(ino 를 Number 로 비교 + NTFS 생성 시각 되살림)은 약 21% 를 놓쳤다(이 PC 500번 중 104번)
  let miss = 0;
  for (let i = 0; i < 100; i++) {
    const n = 100 + i;
    fs.writeFileSync(f + '.s', `{"n":${n}}\n`); fs.rmSync(f); fs.renameSync(f + '.s', f);
    await t.drain();
    if (got.at(-1) !== n) { miss++; got.push(n); }
  }
  assert.equal(miss, 0, `같은 크기 교체 ${miss}/100 놓침`);
});

test('워크플로 에이전트: 물려받은 attributionSkill 은 스킬 위성으로 보이지 않고, 다른 스킬을 쓸 때만 표시', async () => {
  const rt = new RootRuntime({ sessionId: M, index, offline: true });
  const g = rt.graph;
  const ts = new Date().toISOString();
  g.addNode({ id: `s:${M}`, parentId: null, kind: 'main', label: 'm', sessionId: M, meta: {} }, ts);
  g.addNode({ id: 'a:wfag1', parentId: `s:${M}`, kind: 'workflow-agent', label: 'w', sessionId: M, meta: {} }, ts);
  g.addNode({ id: 'a:sub1', parentId: `s:${M}`, kind: 'subagent', label: 's', sessionId: M, meta: {} }, ts);
  const rec = (sk) => ({ type: 'assistant', timestamp: ts, attributionSkill: sk, message: { role: 'assistant', content: [] } });
  const wf = g.get('a:wfag1'), sub = g.get('a:sub1');
  rt.onAssistant(rec('workflow-authoring'), wf, null, ts, true);
  assert.equal(wf.meta.skill ?? null, null, '물려받은 값은 표시 안 함');
  rt.onAssistant(rec('writing-style'), wf, null, ts, true);
  assert.equal(wf.meta.skill, 'writing-style', '다른 스킬은 표시');
  rt.onAssistant(rec('workflow-authoring'), wf, null, ts, true);
  assert.equal(wf.meta.skill ?? null, null);
  rt.onAssistant(rec('writing-style'), sub, null, ts, true);
  assert.equal(sub.meta.skill, 'writing-style', '일반 서브에이전트는 그대로');
  assert.ok(!('_baseSkill' in wf), '노드 객체에 내부 값 없음');
});
