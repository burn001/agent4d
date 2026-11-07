// 선택형 질문(AskUserQuestion)·계획 승인(ExitPlanMode) 카드 — 입력 정리·결과 해석(실측 꼴: Claude Code 2.1.318 transcript), 라이브 = 재생, Interactive feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cardOf, cardResult, parseAnswerText, CARD_LIMITS } from '../ask-card.mjs';
import { feedItem } from '../interact-peer.mjs';
import { Graph } from '../graph.mjs';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { buildReplay } from '../replay.mjs';

const Q1 = { question: '배포 방식을 어떻게 할까요?', header: '배포', multiSelect: false, options: [
  { label: '새 레포 스냅샷 (추천)', description: '기록 없이 깨끗하게 시작' }, { label: '기존 레포 공개', description: '기록이 그대로 공개됨', preview: '```\nmain ─ a1b2\n```\n<script>x</script>' }] };
const Q2 = { question: '함께 넣을 기능은?', header: '기능', multiSelect: true, options: [{ label: '하이라이트 표시' }, { label: '연속 재생, 데모' }, { label: '보관함 설명' }] };

test('cardOf: 질문·머리표·복수 선택·선택지(라벨·설명·미리보기) 정리, 상한, 마스킹', () => {
  const c = cardOf('AskUserQuestion', { questions: [Q1, Q2] });
  assert.equal(c.t, 'ask');
  assert.deepEqual(c.qs[0], { h: '배포', q: '배포 방식을 어떻게 할까요?', o: [{ l: '새 레포 스냅샷 (추천)', d: '기록 없이 깨끗하게 시작' }, { l: '기존 레포 공개', d: '기록이 그대로 공개됨', p: '```\nmain ─ a1b2\n```\n<script>x</script>' }] });
  assert.equal(c.qs[1].multi, 1);
  const big = cardOf('AskUserQuestion', { questions: Array.from({ length: 9 }, () => ({ question: 'x'.repeat(5000), options: Array.from({ length: 20 }, (_, i) => ({ label: 'L' + i, description: 'token=abcd1234secretvalue' })) })) });
  assert.equal(big.qs.length, CARD_LIMITS.qs);
  assert.equal(big.qs[0].o.length, CARD_LIMITS.opts);
  assert.ok(big.qs[0].q.length <= CARD_LIMITS.q);
  assert.doesNotMatch(big.qs[0].o[0].d, /abcd1234secretvalue/);
  assert.equal(cardOf('AskUserQuestion', {}), null);
  assert.equal(cardOf('Bash', { command: 'ls' }), null);
  assert.deepEqual(cardOf('ExitPlanMode', { plan: '## 계획\n\n1. 하나\n2. 둘' }), { t: 'plan', md: '## 계획\n\n1. 하나\n2. 둘' });
  assert.equal(cardOf('ExitPlanMode', { plan: 'p'.repeat(9000) }).cut, 1);
});

test('cardResult: 선택지 답·복수 선택(문자열·배열)·직접 입력·메모·답 대신 메시지·더 묻기·거절·답 없음', () => {
  const c = cardOf('AskUserQuestion', { questions: [Q1, Q2] });
  const ok = cardResult(c, { body: 'Your questions have been answered: "…"="…". You can now continue with these answers in mind.', tur: { questions: [Q1, Q2], answers: { [Q1.question]: '새 레포 스냅샷 (추천)', [Q2.question]: ['하이라이트 표시', '연속 재생, 데모'] } } });
  assert.deepEqual(ok, { st: 'answered', a: [{ q: 0, pick: [0] }, { q: 1, pick: [0, 1] }] }); // 라벨 안의 쉼표도 배열이면 그대로
  const joined = cardResult(c, { tur: { answers: { [Q2.question]: '하이라이트 표시, 보관함 설명' } } });
  assert.deepEqual(joined.a, [{ q: 1, pick: [0, 2] }]);
  const other = cardResult(c, { body: 'The user answered: …', tur: { answers: { [Q1.question]: '둘 다 말고 나중에' }, annotations: { [Q1.question]: { notes: '다음 주에 다시' } } } });
  assert.deepEqual(other, { st: 'other', a: [{ q: 0, pick: [], other: '둘 다 말고 나중에', notes: '다음 주에 다시' }] });
  const inst = cardResult(c, { tur: { answers: { [Q1.question]: '[User did not answer this question — they sent a message instead. Treat that message as their response; do not re-ask.]' } } });
  assert.deepEqual(inst, { st: 'instead', a: [{ q: 0, pick: [], instead: 1 }] });
  // toolUseResult 없는 옛 기록: 본문 "질문"="답"
  assert.deepEqual(parseAnswerText('The user answered: "a b?"="x", "c?"="y z". Read…'), { 'a b?': 'x', 'c?': 'y z' });
  const legacy = cardResult(c, { body: `Your questions have been answered: "${Q1.question}"="기존 레포 공개". You can now continue with these answers in mind.` });
  assert.deepEqual(legacy, { st: 'answered', a: [{ q: 0, pick: [1] }] });
  assert.equal(cardResult(c, { ok: false, body: "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. …)" }).st, 'declined');
  assert.equal(cardResult(c, { body: 'The user did not answer the questions.' }).st, 'none');
  assert.equal(cardResult(c, { body: 'Ask again with follow-up questions that build on these answers (do not repeat these); do not start the task yet', tur: { answers: { [Q1.question]: '새 레포 스냅샷 (추천)' } } }).st, 'more');
});

test('cardResult: 계획 승인·고쳐서 승인·거절(의견)', () => {
  const p = cardOf('ExitPlanMode', { plan: '1. 하나' });
  assert.deepEqual(cardResult(p, { body: 'User has approved your plan. You can now start coding. Start with updating your todo list if applicable\n\n## Approved Plan:\n1. 하나' }), { st: 'approved' });
  assert.deepEqual(cardResult(p, { body: 'User has approved your plan. …\n\n## Approved Plan (edited by user):\n1. 둘' }), { st: 'approved', edited: 1 });
  assert.deepEqual(cardResult(p, { ok: false, body: "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\n단계 2 를 먼저" }), { st: 'rejected', fb: '단계 2 를 먼저' });
});

test('graph.emit: minimal 이면 card·cardRes 를 뺀다', () => {
  const g = new Graph({ rootSessionId: 'x', privacy: 'minimal' });
  const e = g.emit({ type: 'tool-start', nodeId: 'n', tool: 'AskUserQuestion', card: { t: 'ask', qs: [] }, cardRes: { st: 'answered', a: [] } });
  assert.equal('card' in e, false); assert.equal('cardRes' in e, false);
});

test('Interactive feed: 질문 tool_use → ask 항목(같은 레코드 글·다른 도구도), 결과 → ask-res(시작 줄을 못 봤어도 toolUseResult 로)', () => {
  const a = feedItem({ type: 'assistant', timestamp: '2026-11-05T01:00:00Z', message: { content: [{ type: 'text', text: '여쭙니다' }, { type: 'tool_use', id: 'tu_q1', name: 'AskUserQuestion', input: { questions: [Q1] } }, { type: 'tool_use', id: 'tu_b', name: 'Bash', input: {} }] } });
  assert.deepEqual(a.map((x) => x.k), ['assistant', 'tool', 'ask']);
  assert.equal(a[2].id, 'tu_q1');
  assert.equal(a[2].card.qs[0].o[0].l, '새 레포 스냅샷 (추천)');
  const r = feedItem({ type: 'user', timestamp: '2026-11-05T01:01:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_q1', content: 'Your questions have been answered: …' }] }, toolUseResult: { questions: [Q1], answers: { [Q1.question]: '기존 레포 공개' } } });
  assert.deepEqual(r.map((x) => [x.k, x.id, x.res.st, x.res.a[0].pick]), [['ask-res', 'tu_q1', 'answered', [1]]]);
  const cold = feedItem({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_unknown', content: '…' }] }, toolUseResult: { questions: [Q2], answers: { [Q2.question]: '보관함 설명' } } });
  assert.equal(cold[0].card.qs[0].q, Q2.question);
  assert.deepEqual(cold[0].res.a[0].pick, [2]);
  const plan = feedItem({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_p_unknown', content: 'User has approved your plan. You can now start coding.' }] } });
  assert.deepEqual([plan[0].card.t, plan[0].res.st], ['plan', 'approved']);
  // 다른 도구 결과는 예전처럼 항목 없음
  assert.equal(feedItem({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } }), null);
});

test('세션: AskUserQuestion·ExitPlanMode 시작에 card, 끝에 card + cardRes — 라이브 = 재생', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-ask-'));
  const prevTmp = process.env.CCVIZ_CLAUDE_TMP;
  try {
    const cwd = 'D:\\work\\askcard';
    const enc = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
    const SID = 'efefefef-7777-4777-8777-efefefefefef';
    const projects = path.join(root, 'projects'), sessions = path.join(root, 'sessions'), tmpClaude = path.join(root, 'tmp', 'claude');
    const proj = path.join(projects, enc(cwd));
    for (const d of [proj, sessions, tmpClaude]) fs.mkdirSync(d, { recursive: true });
    process.env.CCVIZ_CLAUDE_TMP = tmpClaude;
    const P = Date.now() - 3 * 86400_000, T = (s) => new Date(P + s * 1000).toISOString();
    const base = { sessionId: SID, cwd, version: '2.1.318', entrypoint: 'cli' };
    const A = (s, id, name, input) => ({ type: 'assistant', timestamp: T(s), ...base, message: { model: 'm', role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
    const R = (s, id, content, tur, isErr) => ({ type: 'user', timestamp: T(s), ...base, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isErr ? { is_error: true } : {}) }] }, ...(tur ? { toolUseResult: tur } : {}) });
    const recs = [
      { type: 'user', timestamp: T(0), ...base, origin: { kind: 'human' }, promptSource: 'user', message: { role: 'user', content: '정해 줘' } },
      A(1, 'tu_q', 'AskUserQuestion', { questions: [Q1, Q2] }),
      R(9, 'tu_q', 'Your questions have been answered: …', { questions: [Q1, Q2], answers: { [Q1.question]: '새 레포 스냅샷 (추천)', [Q2.question]: '하이라이트 표시, 보관함 설명' } }),
      A(10, 'tu_p', 'ExitPlanMode', { plan: '## 계획\n\n1. 하나' }),
      R(12, 'tu_p', "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\n먼저 시험", null, true),
      { type: 'system', subtype: 'turn_duration', durationMs: 1000, timestamp: T(13), ...base },
    ];
    fs.writeFileSync(path.join(proj, `${SID}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const old = (P + 60_000) / 1000;
    fs.utimesSync(path.join(proj, `${SID}.jsonl`), old, old);
    const index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
    await index.refresh();
    for (const e of index.entries.values()) e.birthtimeMs = e.mtimeMs;
    const rt = new RootRuntime({ sessionId: SID, index });
    await rt.start();
    rt.close();
    const data = await buildReplay({ sessionId: SID, index });
    for (const [name, evs] of [['live', rt.graph.ring], ['replay', data.events.map((x) => x.e || x)]]) {
      const qs = evs.find((e) => e.type === 'tool-start' && e.tool === 'AskUserQuestion');
      assert.equal(qs.card.qs.length, 2, name);
      assert.equal(qs.cardRes, undefined, name);
      const qe = evs.find((e) => e.type === 'tool-end' && e.toolUseId === 'tu_q');
      assert.deepEqual(qe.cardRes, { st: 'answered', a: [{ q: 0, pick: [0] }, { q: 1, pick: [0, 2] }] }, name);
      assert.equal(qe.card.qs[1].multi, 1, name);
      const pe = evs.find((e) => e.type === 'tool-end' && e.toolUseId === 'tu_p');
      assert.deepEqual([pe.card.t, pe.cardRes.st, pe.cardRes.fb], ['plan', 'rejected', '먼저 시험'], name);
      assert.equal(qe.ix?.op, 'ask', name + ': 기존 §68.9 ix 는 그대로');
    }
  } finally {
    if (prevTmp == null) delete process.env.CCVIZ_CLAUDE_TMP; else process.env.CCVIZ_CLAUDE_TMP = prevTmp;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});
