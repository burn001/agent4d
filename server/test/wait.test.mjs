// 입력 대기 배지 — 서버 쪽: 세션 기록 waitingFor(실측 2.1.318 'input needed' 등) → 목록·전체 보기 루트, 스냅샷 openTools 의 질문 머리표,
// Interactive feed 의 대기열 도착 줄(queue-operation enqueue — 교차 세션 메시지가 파이프를 지나 도착한 첫 흔적)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listPeerSessions } from '../interact-peer.mjs';
import { waitingForOf, SessionIndex } from '../discovery.mjs';
import { readFeed } from '../interact-feed.mjs';
import { RootRuntime } from '../session.mjs';
import { recordWait, askHead } from '../../web/wait-core.mjs';

test('세션 기록: status waiting + waitingFor → 목록 waitingFor·statusAt, recordWait 는 input needed=ask · sandbox 등=other · dialog open·헤드리스는 아님', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a4d-wait-'));
  try {
    const sid = 'abababab-1111-4222-8333-944455556666';
    const rec = { pid: process.pid, sessionId: sid, kind: 'interactive', entrypoint: 'cli', status: 'waiting', waitingFor: 'input needed', statusUpdatedAt: 1793856733688, name: 'w-1', cwd: dir, peerProtocol: 1, messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-' + 'a'.repeat(32) };
    fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify(rec));
    const [r] = listPeerSessions({ sessionsDir: dir });
    assert.equal(r.waitingFor, 'input needed');
    assert.equal(r.statusAt, 1793856733688);
    assert.deepEqual(recordWait(r), { k: 'ask', why: 'input needed', since: 1793856733688 });
    assert.equal(recordWait({ ...r, headless: true }), null);
    assert.equal(recordWait({ ...r, waitingFor: 'dialog open' }), null); // 채택 안 함(사람이 터미널에서 연 창 등)
    assert.equal(recordWait({ ...r, waitingFor: 'sandbox request' }).k, 'other');
    fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({ ...rec, status: 'busy' }));
    assert.equal(listPeerSessions({ sessionsDir: dir })[0].waitingFor, null); // waiting 이 아니면 사유를 버림
    assert.equal(waitingForOf({ status: 'waiting', waitingFor: 'x'.repeat(99) }).length, 40);
    assert.equal(waitingForOf({ status: 'idle', waitingFor: 'input needed' }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('feed: 대기열 도착 줄(교차 세션 메시지 enqueue)은 enq 항목(출처·별칭·본문), 다른 enqueue·remove 는 무시', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a4d-wait-'));
  try {
    const T = (s) => new Date(Date.UTC(2026, 10, 5, 5, 30, s)).toISOString();
    const base = { sessionId: 'cdcdcdcd-1111-4222-8333-944455556666', cwd: 'D:\\w', version: '2.1.318', entrypoint: 'cli' };
    const Q = { question: '비교 조건을 맞출까요?', header: '비교 조건', multiSelect: false, options: [{ label: '「군」 (Recommended)' }, { label: '「조합」' }] };
    const body = '[Answer to the question] 비교 조건: 「군」 (Recommended)';
    const recs = [
      { type: 'user', ...base, timestamp: T(0), origin: { kind: 'human' }, promptSource: 'queued', message: { role: 'user', content: '정해 줘' } },
      { type: 'assistant', ...base, timestamp: T(1), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_q', name: 'AskUserQuestion', input: { questions: [Q] } }] } },
      // 실측 꼴: 키는 type·operation·timestamp·sessionId·content 뿐(msg_id 없음)
      { type: 'queue-operation', operation: 'enqueue', timestamp: T(5), sessionId: base.sessionId, content: `<cross-session-message from-name="Agent4D (big-star-parrot)">\n${body}\n</cross-session-message>` },
      { type: 'queue-operation', operation: 'enqueue', timestamp: T(6), sessionId: base.sessionId, content: '<task-notification>x</task-notification>' },
      { type: 'user', ...base, timestamp: T(9), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_q', content: 'Your questions have been answered: …' }] }, toolUseResult: { questions: [Q], answers: { [Q.question]: '「조합」' } } },
      { type: 'queue-operation', operation: 'remove', timestamp: T(10), sessionId: base.sessionId, reason: 'absorbed_mid_turn' },
      { type: 'attachment', ...base, timestamp: T(5), attachment: { type: 'queued_command', prompt: `<cross-session-message from-name="Agent4D (big-star-parrot)">\n${body}\n</cross-session-message>`, commandMode: 'prompt', origin: { kind: 'peer', msg_id: 'm-1', name: 'Agent4D (big-star-parrot)', body } } },
    ];
    const f = path.join(dir, 't.jsonl');
    fs.writeFileSync(f, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const { items } = readFeed(f);
    assert.deepEqual(items.map((x) => x.k), ['user', 'ask', 'enq', 'ask-res', 'peer']);
    const e = items[2];
    assert.deepEqual([e.src, e.alias, e.text], ['ix', 'big-star-parrot', body]);
    assert.equal(items[4].msgId, 'm-1');
    const { items: mi } = readFeed(f, { privacy: 'minimal' });
    assert.equal(mi.find((x) => x.k === 'enq').text, ''); // minimal 은 글 없이
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('스냅샷 openTools: 답 없는 AskUserQuestion·ExitPlanMode 에 가벼운 머리표 ask(질문 글은 140자, 계획은 종류만)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-wait-'));
  const prevTmp = process.env.CCVIZ_CLAUDE_TMP;
  try {
    const cwd = 'D:\\work\\waitbadge';
    const enc = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
    const SID = 'f0f0f0f0-7777-4777-8777-f0f0f0f0f0f0';
    const projects = path.join(root, 'projects'), sessions = path.join(root, 'sessions'), tmpClaude = path.join(root, 'tmp', 'claude');
    const proj = path.join(projects, enc(cwd));
    for (const d of [proj, sessions, tmpClaude]) fs.mkdirSync(d, { recursive: true });
    process.env.CCVIZ_CLAUDE_TMP = tmpClaude;
    const P = Date.now() - 60_000, T = (s) => new Date(P + s * 1000).toISOString();
    const base = { sessionId: SID, cwd, version: '2.1.318', entrypoint: 'cli' };
    const Q = { question: 'q'.repeat(300), header: '방식', multiSelect: false, options: [{ label: 'A (추천)' }, { label: 'B' }] };
    const recs = [
      { type: 'user', timestamp: T(0), ...base, origin: { kind: 'human' }, promptSource: 'typed', message: { role: 'user', content: '정해 줘' } },
      { type: 'assistant', timestamp: T(1), ...base, message: { model: 'm', role: 'assistant', content: [{ type: 'tool_use', id: 'tu_q', name: 'AskUserQuestion', input: { questions: [Q, Q] } }] } },
    ];
    fs.writeFileSync(path.join(proj, `${SID}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
    await index.refresh();
    const rt = new RootRuntime({ sessionId: SID, index });
    await rt.start();
    rt.close();
    const n = rt.graph.get(`s:${SID}`);
    const ot = n.openTools.find((x) => x.toolUseId === 'tu_q');
    assert.ok(ot, 'openTools 에 남음');
    assert.equal(ot.ask.t, 'ask');
    assert.equal(ot.ask.h, '방식');
    assert.equal(ot.ask.n, 2);
    assert.ok(ot.ask.q.length <= 140);
    assert.deepEqual(askHead({ t: 'plan', md: '## 긴 계획' }), { t: 'plan' });
    assert.equal(askHead(null), null);
  } finally {
    if (prevTmp == null) delete process.env.CCVIZ_CLAUDE_TMP; else process.env.CCVIZ_CLAUDE_TMP = prevTmp;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});
