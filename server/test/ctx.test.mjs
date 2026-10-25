// 컨텍스트 사용률: usage 합산·창 판정·노드 meta.ctx(라이브·재생)·데모 합성
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { Graph } from '../graph.mjs';
import { usageTokens, contextWindow, ctxValue, CtxTracker, seedDemoCtx, stepDemoCtx, CTX_1M, CTX_DEFAULT } from '../ctx.mjs';

test('usage 합산: 입력 + 캐시 생성 + 캐시 읽기(출력 제외), 없거나 0 이면 null', () => {
  assert.equal(usageTokens({ input_tokens: 3, cache_creation_input_tokens: 1200, cache_read_input_tokens: 80000, output_tokens: 999 }), 81203);
  assert.equal(usageTokens({ input_tokens: 0, output_tokens: 10 }), null);
  assert.equal(usageTokens(null), null);
  assert.equal(usageTokens({ input_tokens: '5', cache_read_input_tokens: -3 }), 5);
});

test('창 판정: [1m] 표기·200k 초과 관측·실측 1M 계열·그 밖 200k 추정', () => {
  assert.deepEqual(contextWindow('claude-sonnet-4-5[1m]'), { limit: CTX_1M, basis: 'tag', estimated: false });
  assert.deepEqual(contextWindow('claude-opus-5-5'), { limit: CTX_1M, basis: 'family', estimated: false });
  assert.equal(contextWindow('claude-opus-4-8').limit, CTX_1M);
  assert.deepEqual(contextWindow('claude-sonnet-5-5'), { limit: CTX_DEFAULT, basis: 'default', estimated: true });
  assert.deepEqual(contextWindow('claude-haiku-5-5', 250_000), { limit: CTX_1M, basis: 'observed', estimated: false });
  assert.equal(contextWindow('', 0).limit, CTX_DEFAULT);
  assert.equal(contextWindow('claude-1m-test').basis, 'tag');
  assert.equal(contextWindow('claude-haiku-5-5-20261001').basis, 'default');
  const v = ctxValue(150_000, 'claude-sonnet-5-5');
  assert.deepEqual(v, { used: 150_000, limit: 200_000, pct: 75, estimated: true, basis: 'default' });
});

test('추적기: 같은 응답 블록 반복은 무시, compact 로 떨어지면 그대로, 200k 넘긴 뒤엔 1M 유지, <synthetic> 무시', () => {
  const t = new CtxTracker();
  const m = (u, model = 'claude-sonnet-5-5') => ({ model, usage: { input_tokens: u } });
  assert.equal(t.update('a', m(100_000)).pct, 50);
  assert.equal(t.update('a', m(100_000)), null);
  assert.equal(t.update('a', { model: '<synthetic>', usage: { input_tokens: 0 } }), null);
  const big = t.update('a', m(240_000));
  assert.equal(big.limit, CTX_1M); assert.equal(big.basis, 'observed');
  assert.equal(big.base, 100_000); // 기준선 = 첫 유효 응답
  const after = t.update('a', m(30_000)); // compact 뒤
  assert.equal(after.used, 30_000); assert.equal(after.limit, CTX_1M);
  assert.equal(after.base, 30_000); // 기준선보다 작아지면 낮춤
  assert.equal(t.update('a', m(90_000)).base, 30_000); // 다시 올라도 유지
  assert.equal(t.update('b', m(30_000)).limit, CTX_DEFAULT); // 노드마다 따로
});

const M = 'cccccccc-7777-4777-8777-777777777777';
const AG = 'agentctx01';
let root, index;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-ctx-'));
  const projects = path.join(root, 'projects');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  const cwd = 'D:\\work\\ctxdemo';
  const now = Date.now();
  const T = (sec) => new Date(now - 600_000 + sec * 1000).toISOString();
  const base = { sessionId: M, cwd, version: '2.1.309', entrypoint: 'cli' };
  const A = (sec, id, used, text = '응답') => ({ type: 'assistant', timestamp: T(sec), ...base, message: { id, role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text }],
    usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: used - 1002, output_tokens: 50 } } });
  const recs = [
    { type: 'user', timestamp: T(1), ...base, message: { role: 'user', content: '시작' } },
    A(10, 'msg1', 40_000), A(10, 'msg1', 40_000, '같은 응답 둘째 블록'),
    A(20, 'msg2', 150_000),
    { type: 'system', subtype: 'compact_boundary', timestamp: T(25), ...base, content: 'Conversation compacted' },
    A(30, 'msg3', 24_000),
    { type: 'assistant', timestamp: T(31), ...base, message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 0, output_tokens: 0 } } },
  ];
  const dir = path.join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(path.join(dir, M, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, `${M}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  index = new SessionIndex({ projectsDir: projects, sessionsDir: path.join(root, 'sessions') });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

for (const offline of [false, true]) {
  test(`${offline ? '재생(offline)' : '라이브 첫 적재'}: 메인 meta.ctx 가 마지막 응답 값, 이벤트는 바뀐 때만(20%→75%→12%)`, async () => {
    await index.refresh();
    const rt = new RootRuntime({ sessionId: M, index, offline });
    try {
      if (offline) await rt.loadOffline(); else await rt.start();
      const n = rt.graph.get(`s:${M}`);
      assert.deepEqual(n.meta.ctx, { used: 24_000, limit: 200_000, pct: 12, estimated: true, basis: 'default', base: 24_000 });
      const seq = rt.graph.ring.filter((e) => e.nodeId === `s:${M}` && e.type === 'node-update' && e.patch?.meta?.ctx).map((e) => e.patch.meta.ctx.pct);
      assert.deepEqual(seq, [20, 75, 12]);
      // 기준선: 첫 응답(40k)을 유지하다 compact 뒤 값(24k)이 더 작으면 낮춤 — 라이브·재생 같은 값
      const bases = rt.graph.ring.filter((e) => e.nodeId === `s:${M}` && e.type === 'node-update' && e.patch?.meta?.ctx).map((e) => e.patch.meta.ctx.base);
      assert.deepEqual(bases, [40_000, 40_000, 24_000]);
    } finally { rt.close(); }
  });
}

test('데모: 메인마다 다른 시작 수준, 걸음마다 오르고 96% 넘으면 18% 로', () => {
  const g = new Graph({ rootSessionId: 'd' });
  const ts = new Date().toISOString();
  g.addNode({ id: 's:d', kind: 'main', label: 'm', model: 'claude-opus-5-5' }, ts);
  g.addNode({ id: 'a:x', parentId: 's:d', kind: 'subagent', label: 'a', model: 'claude-sonnet-5-5' }, ts);
  g.addNode({ id: 'b:y', parentId: 's:d', kind: 'bash-bg', label: 'b' }, ts);
  seedDemoCtx(g, 'a1-', ts);
  assert.equal(g.get('s:d').meta.ctx.pct, 80);
  assert.equal(g.get('s:d').meta.ctx.limit, CTX_1M);
  assert.ok(g.get('a:x').meta.ctx.pct > 0);
  assert.equal(g.get('b:y').meta.ctx, undefined);
  for (let i = 0; i < 6; i++) stepDemoCtx(g, 's:d', ts);
  assert.equal(g.get('s:d').meta.ctx.pct, 98);
  stepDemoCtx(g, 's:d', ts);
  assert.equal(g.get('s:d').meta.ctx.pct, 18);
});
