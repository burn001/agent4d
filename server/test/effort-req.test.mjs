// 요청 effort(meta.effortReq): 부모 Agent input.effort · meta.json effort · claude -p --effort — 적용값 meta.effort 와 따로
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { encodeCwd, effortFlagOf, detectClaudeP, promptCandidates } from '../parse.mjs';

test('effortFlagOf: --effort X · --effort=X · 따옴표 값 · 프롬프트 글 속 --effort 는 무시 · 다음 명령 구간은 안 봄', () => {
  assert.equal(effortFlagOf('claude -p --effort xhigh "do it"'), 'xhigh');
  assert.equal(effortFlagOf("claude -p --effort 'xhigh' 'do it'"), 'xhigh');
  assert.equal(effortFlagOf('claude -p --effort "max" "do it"'), 'max');
  assert.equal(effortFlagOf('claude --effort=high -p "x"'), 'high');
  assert.equal(effortFlagOf("claude --effort='low' -p x"), 'low');
  assert.equal(effortFlagOf('claude --EFFORT Medium -p x'), 'Medium'); // 서버는 문자열 그대로(단계 해석은 웹)
  assert.equal(effortFlagOf('claude -p "use --effort low please" --model opus'), null);
  assert.equal(effortFlagOf('claude -p "x" && other --effort max'), null);
  assert.equal(effortFlagOf('claude -p --effort "$(cat e.txt)" x'), null); // 낱말이 아니면 버림
  assert.equal(effortFlagOf(null), null);
});

test('claude -p 명령 파싱: --effort 값(따옴표 포함)이 프롬프트 후보로 잡히지 않는다', () => {
  for (const cmd of [
    "claude -p --effort 'xhigh' 'summarize the repo please'",
    'claude -p --effort "xhigh" "summarize the repo please"',
    "claude -p --effort='xhigh' 'summarize the repo please'",
    'claude -p --effort=xhigh "summarize the repo please"',
  ]) {
    const d = detectClaudeP(cmd);
    assert.equal(d.effortReq, 'xhigh', cmd);
    assert.deepEqual(d.promptHints, ['summarize the repo please'], cmd);
    assert.equal(d.promptHint, 'summarize the repo please', cmd);
  }
  // 다른 --x= 붙은 따옴표 값도 값(예전엔 프롬프트 후보로 들어감)
  assert.deepEqual(promptCandidates("claude -p --model='claude-opus-5-5' 'real prompt here'"), ['real prompt here']);
  assert.equal(detectClaudeP('claude -p "no effort flag here"').effortReq, null);
});

const M = 'e0e0e0e0-1460-4146-8146-000000000146';
const C = 'e0e0e0e0-1460-4146-8146-0000000c0146';
const cwd = 'D:\\work\\effortreq';
const line = (r) => JSON.stringify(r) + '\n';
let root, index;
before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-effreq-'));
  const projects = path.join(root, 'projects');
  const sessions = path.join(root, 'sessions');
  const dir = path.join(projects, encodeCwd(cwd));
  for (const d of [sessions, dir]) fs.mkdirSync(d, { recursive: true });
  const t0 = Date.now() - 1800_000;
  const T = (s) => new Date(t0 + s * 1000).toISOString();
  const base = { sessionId: M, cwd, version: '2.1.310', entrypoint: 'cli' };
  const sx = (aid) => ({ isSidechain: true, agentId: aid });
  const U = (s, text, x = {}, b = base) => ({ type: 'user', timestamp: T(s), ...b, ...x, message: { role: 'user', content: text } });
  const A = (s, block, x = {}, b = base) => ({ type: 'assistant', timestamp: T(s), ...b, ...x, message: { role: 'assistant', model: 'm', content: [block] } });
  const R = (s, id, text, tur) => ({ type: 'user', timestamp: T(s), ...base, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, toolUseResult: tur });
  const agent = (s, tuid, desc, effort) => A(s, { type: 'tool_use', id: tuid, name: 'Agent', input: { description: desc, prompt: desc, ...(effort ? { effort } : {}) } });
  const done = (s, tuid, aid) => R(s, tuid, '끝', { status: 'completed', agentId: aid, content: [{ type: 'text', text: '끝' }] });
  fs.writeFileSync(path.join(dir, `${M}.jsonl`), [
    U(0, '시험'),
    agent(5, 'tu_e1', '입력 effort', 'xhigh'), // ① Agent input.effort (meta.json 에는 없음)
    agent(5, 'tu_e2', '메타 effort'), // ② meta.json effort 만
    agent(5, 'tu_e3', '미지정'), // 요청 없음 → 적용값만
    A(6, { type: 'tool_use', id: 'tu_cp', name: 'Bash', input: { command: `claude -p --effort 'max' "자식 세션 effort 시험" --session-id ${C}`, description: 'cp' } }),
    R(9, 'tu_cp', 'ok', { stdout: 'ok', stderr: '' }),
    done(60, 'tu_e1', 'se1'), done(60, 'tu_e2', 'se2'), done(60, 'tu_e3', 'se3'),
  ].map(line).join(''));
  const sd = path.join(dir, M, 'subagents');
  fs.mkdirSync(sd, { recursive: true });
  const sub = (aid, desc, tuid, metaEff, applied) => {
    fs.writeFileSync(path.join(sd, `agent-${aid}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: desc, toolUseId: tuid, spawnDepth: 1, ...(metaEff ? { effort: metaEff } : {}) }));
    fs.writeFileSync(path.join(sd, `agent-${aid}.jsonl`), [U(6, desc, sx(aid)), A(20, { type: 'text', text: '끝' }, { ...sx(aid), effort: applied })].map(line).join(''));
  };
  sub('se1', '입력 effort', 'tu_e1', null, 'xhigh');
  sub('se2', '메타 effort', 'tu_e2', 'low', 'low');
  sub('se3', '미지정', 'tu_e3', null, 'high');
  const cb = { sessionId: C, cwd, entrypoint: 'sdk-cli' };
  fs.writeFileSync(path.join(dir, `${C}.jsonl`), [U(7, '자식 세션 effort 시험', {}, cb), A(8, { type: 'text', text: 'ok' }, { effort: 'max' }, cb)].map(line).join(''));
  const quiet = (Date.now() - 600_000) / 1000;
  fs.utimesSync(path.join(dir, `${C}.jsonl`), quiet, quiet);
  index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

for (const offline of [false, true]) {
  test(`${offline ? '재생(offline)' : '라이브 첫 적재'}: 요청값 meta.effortReq 와 적용값 meta.effort 가 따로 실린다`, async () => {
    await index.refresh();
    const rt = new RootRuntime({ sessionId: M, index, offline });
    try {
      if (offline) await rt.loadOffline(); else await rt.start();
      const n = (id) => rt.graph.get(id);
      assert.equal(n('a:se1').meta.effortReq, 'xhigh'); // Agent input.effort
      assert.equal(n('a:se1').meta.effort, 'xhigh');
      assert.equal(n('a:se2').meta.effortReq, 'low'); // meta.json effort
      assert.equal(n('a:se2').meta.effort, 'low');
      assert.equal(n('a:se3').meta.effortReq, undefined); // 미지정은 추정하지 않음
      assert.equal(n('a:se3').meta.effort, 'high');
      const cp = n(`s:${C}`);
      assert.ok(cp, 'claude -p 자식 노드');
      assert.equal(cp.kind, 'claude-p');
      assert.equal(cp.meta.effortReq, 'max'); // --effort 'max'
      assert.equal(cp.meta.effort, 'max');
      // 바뀔 때만: effortReq 이벤트는 노드마다 많아야 한 번
      for (const id of ['a:se1', 'a:se2', `s:${C}`]) {
        const k = rt.graph.ring.filter((e) => e.nodeId === id && e.type === 'node-update' && e.patch?.meta?.effortReq).length;
        assert.ok(k <= 1, `${id} effortReq 이벤트 ${k}`);
      }
    } finally { rt.close(); }
  });
}
