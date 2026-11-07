// Interactive 전체 대화 흐름 — 출처 판정(실측 꼴 합성: Claude Code 2.1.318), 시스템 알림 분리, 거꾸로 읽기·더 보기·이어 읽기,
// minimal 프라이버시, 헤드리스(-p) 세션 판정, 교차 세션 메시지 → 사용자 입력 이벤트(3D 사용자 콘솔, 라이브 = 재생)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readFeed, feedItem, isTurnRecord, peerSource, minimalItem, FEED_TURNS } from '../interact-feed.mjs';
import { isHeadlessEntrypoint, argvHeadless, markHeadless } from '../interact-peer.mjs';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime, peerNodeOf, _resetPeerAddr } from '../session.mjs';
import { buildReplay } from '../replay.mjs';
import { PeerAddrBook, addrKey } from '../peer-addr.mjs';
import { sanitizeIx } from '../interactions.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'a4d-feed-'));
const T = (s) => new Date(Date.UTC(2026, 10, 5, 3, 0, s)).toISOString();
const base = { sessionId: 'feedfeed-1111-4222-8333-944455556666', cwd: 'D:\\w', version: '2.1.318', entrypoint: 'cli', userType: 'external' };
const PIPE = '\\\\.\\pipe\\LOCAL\\cc-msg-' + 'e'.repeat(32);
// 실측 꼴(값만 바꿈)
const R = {
  typed: (s, text) => ({ type: 'user', ...base, timestamp: T(s), permissionMode: 'bypassPermissions', origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human', message: { role: 'user', content: text } }),
  queued: (s, text) => ({ type: 'user', ...base, timestamp: T(s), permissionMode: 'bypassPermissions', origin: { kind: 'human' }, promptSource: 'queued', queueSkipSlashCommands: true, turnOrigin: 'human', message: { role: 'user', content: text } }),
  midHuman: (s, text) => ({ type: 'attachment', ...base, timestamp: T(s), attachment: { type: 'queued_command', prompt: text, commandMode: 'prompt', origin: { kind: 'human' }, humanTurn: true } }),
  peerIx: (s, alias, body, id) => ({ type: 'user', ...base, timestamp: T(s), isMeta: true, origin: { kind: 'peer', from: 'uds:' + PIPE, msg_id: id, name: `Agent4D (${alias})`, body }, promptSource: 'system', turnOrigin: 'peer', message: { role: 'user', content: `Another Claude session sent a message:\n<cross-session-message from-name="Agent4D (${alias})">\n${body}\n</cross-session-message>` } }),
  peerSess: (s, name, body, id) => ({ type: 'user', ...base, timestamp: T(s), isMeta: true, origin: { kind: 'peer', from: 'uds:' + PIPE, msg_id: id, name, hopChain: ['c1a7ee3a169ed338fc120911'], fromMode: 'bypassPermissions', body }, promptSource: 'system', turnOrigin: 'peer', message: { role: 'user', content: `Another Claude session sent a message:\n<cross-session-message from="uds:${PIPE}" from-name="${name}">\n${body}\n</cross-session-message>` } }),
  midPeer: (s, alias, body, id) => ({ type: 'attachment', ...base, timestamp: T(s), attachment: { type: 'queued_command', prompt: `<cross-session-message from-name="Agent4D (${alias})">\n${body}\n</cross-session-message>`, commandMode: 'prompt', isMeta: true, origin: { kind: 'peer', msg_id: id, name: `Agent4D (${alias})`, body } } }),
  note: (s) => ({ type: 'user', ...base, timestamp: T(s), origin: { kind: 'task-notification', producer: 'session-task' }, promptSource: 'system', turnOrigin: 'task_notification', message: { role: 'user', content: '<task-notification>\n<task-id>bg1</task-id>\n<status>completed</status>\n<summary>Background command "build" completed (exit code 0)</summary>\n</task-notification>' } }),
  midNote: (s) => ({ type: 'attachment', ...base, timestamp: T(s), attachment: { type: 'queued_command', prompt: '<task-notification>\n<summary>Monitor event: "watch"</summary>\n<event>line 1</event>\n</task-notification>', commandMode: 'task-notification', origin: { kind: 'task-notification', producer: 'session-task' } } }),
  sched: (s) => ({ type: 'user', ...base, timestamp: T(s), isMeta: true, promptSource: 'system', turnOrigin: 'scheduled', scheduledTaskId: 't1', message: { role: 'user', content: '정시 보고 — 상태를 보고한다' } }),
  reminder: (s) => ({ type: 'user', ...base, timestamp: T(s), isMeta: true, message: { role: 'user', content: '<system-reminder>hook said hi</system-reminder>' } }),
  say: (s, text) => ({ type: 'assistant', ...base, timestamp: T(s), message: { role: 'assistant', content: [{ type: 'text', text }] } }),
  tool: (s) => ({ type: 'assistant', ...base, timestamp: T(s), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu' + s, name: 'Bash', input: {} }] } }),
  result: (s) => ({ type: 'user', ...base, timestamp: T(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu' + (s - 1), content: 'ok' }] } }),
  turnEnd: (s) => ({ type: 'system', ...base, timestamp: T(s), subtype: 'turn_duration', durationMs: 1000 }),
  noise: () => ({ type: 'api-request-shape', sessionId: base.sessionId, shape: 'x'.repeat(4000) }),
};
const write = (dir, recs, name = 't.jsonl') => { const f = path.join(dir, name); fs.writeFileSync(f, recs.map((r) => JSON.stringify(r)).join('\n') + '\n'); return f; };

test('§142 출처 판정: 터미널·휴대폰(같은 꼴)·끼어듦·Interactive·다른 세션·명령·! 셸·SDK, 시스템 성격은 sys, 사이드체인 제외', () => {
  const k = (j) => { const x = feedItem(j); return Array.isArray(x) ? x.map((y) => [y.k, y.src || y.sys || null, y.mid || 0]) : x ? [x.k, x.src || x.sys || null, x.mid || 0] : null; };
  assert.deepEqual(k(R.typed(1, '터미널')), ['user', 'human', 0]);
  assert.deepEqual(k(R.queued(2, '(휴대폰 입력)hi')), ['user', 'human', 0], 'Remote Control 입력도 같은 꼴 — 구분하지 않음');
  assert.deepEqual(k(R.midHuman(3, '안나오게 해줘.')), ['user', 'human', 1]);
  assert.deepEqual(k(R.peerIx(4, 'big-star-parrot', '패널에서', 'm1')), ['peer', 'ix', 0]);
  assert.deepEqual(k(R.peerSess(5, 'proj-loop-b8', '다른 세션 보고', 'm2')), ['peer', 'peer', 0]);
  assert.deepEqual(k(R.midPeer(6, 'big-star-parrot', '끼어든 패널 글', 'm3')), ['peer', 'ix', 1]);
  assert.deepEqual(k(R.note(7)), ['sys', 'notify', 0]);
  assert.deepEqual(k(R.midNote(8)), ['sys', 'notify', 0]);
  assert.deepEqual(k(R.sched(9)), ['sys', 'schedule', 0]);
  assert.deepEqual(k(R.reminder(10)), ['sys', 'system', 0]);
  assert.deepEqual(k({ ...R.typed(11, '<command-name>/clear</command-name>\n<command-args></command-args>') }), ['user', 'human', 0]);
  assert.equal(feedItem(R.typed(11, '<command-name>/done</command-name><command-args>end</command-args>')).text, '/done end');
  assert.equal(feedItem(R.typed(12, '<bash-input>git status</bash-input>')).text, '! git status');
  assert.deepEqual(k(R.typed(13, '<local-command-stdout>ok</local-command-stdout>')), ['sys', 'local', 0]);
  assert.deepEqual(k(R.typed(14, '[Request interrupted by user]')), ['sys', 'interrupt', 0]);
  assert.deepEqual(k({ type: 'user', ...base, timestamp: T(15), promptSource: 'sdk', message: { role: 'user', content: '회차 프롬프트' } }), ['user', 'sdk', 0]);
  assert.equal(feedItem({ ...R.typed(16, 'x'), isSidechain: true }), null);
  // 원문 그대로(줄바꿈 유지)·system-reminder 는 떼어 냄·알림 요약
  assert.equal(feedItem(R.typed(17, '첫 줄\n  둘째 줄 **굵게**\n<system-reminder>hidden</system-reminder>')).text, '첫 줄\n  둘째 줄 **굵게**');
  assert.equal(feedItem(R.note(18)).text, 'Background command "build" completed (exit code 0)');
  assert.equal(feedItem(R.peerIx(19, 'a-b-c', 'x', 'm')).alias, 'a-b-c');
  assert.equal(feedItem(R.peerSess(20, '2026-62', 'x', 'm')).who, '2026-62');
  assert.deepEqual(peerSource('Agent4D (blue-sky-cat)'), { src: 'ix', alias: 'blue-sky-cat' });
  assert.deepEqual(peerSource('Agent4D'), { src: 'peer', who: 'Agent4D' });
  // 비밀 가림
  assert.ok(!feedItem(R.typed(21, 'key sk-ant-api03-' + 'Q'.repeat(40))).text.includes('Q'.repeat(40)));
  // 사람 턴으로 세는 줄
  assert.deepEqual([R.typed(1, 'a'), R.midHuman(2, 'b'), R.peerSess(3, 'n', 'c', 'x'), R.note(4), R.sched(5), R.reminder(6), R.result(7), R.say(8, 'y')].map(isTurnRecord), [true, true, true, false, false, false, false, false]);
});

test('§142 처음 열기: 끝에서 거꾸로 사람 턴 50개(큰 잡음 줄은 풀지 않고 건너뜀) → 더 보기(before)로 이전 · 이어 읽기(after), 빠짐·겹침 없음', () => {
  const dir = tmp();
  const recs = [];
  for (let i = 0; i < 120; i++) {
    const s = i * 6;
    recs.push(i % 3 === 0 ? R.queued(s, `질문 ${i}`) : i % 3 === 1 ? R.midHuman(s, `끼어듦 ${i}`) : R.peerIx(s, 'blue-sky-cat', `패널 ${i}`, 'm' + i));
    recs.push(R.noise(), R.tool(s + 1), R.result(s + 2), R.say(s + 3, `답 ${i}`), R.note(s + 4), R.turnEnd(s + 5));
  }
  const f = write(dir, recs);
  fs.appendFileSync(f, '{"type":"user","message":{"content":"끝나지 않'); // 쓰는 중인 마지막 줄
  const all = readFeed(f, { turns: 10_000 }).items;
  const turnsOf = (items) => items.filter((x) => x.k === 'user' || x.k === 'peer').map((x) => x.text);
  assert.equal(turnsOf(all).length, 120);
  const a = readFeed(f);
  assert.equal(turnsOf(a.items).length, FEED_TURNS);
  assert.equal(turnsOf(a.items)[0], '끼어듦 70'); assert.equal(turnsOf(a.items).at(-1), '패널 119');
  assert.ok(a.before > 0 && a.next > a.before);
  const b = readFeed(f, { before: a.before });
  assert.equal(b.next, undefined);
  assert.equal(turnsOf(b.items).length, 50); assert.equal(turnsOf(b.items).at(-1), '질문 69');
  const c = readFeed(f, { before: b.before });
  assert.equal(turnsOf(c.items).length, 20); assert.equal(c.before, 0, '처음까지');
  assert.deepEqual([...c.items, ...b.items, ...a.items].map((x) => x.k + x.text), all.map((x) => x.k + x.text), '이어 붙이면 앞으로 읽은 것과 같음');
  // 이어 읽기: 끝나지 않은 줄이 끝나면 그때
  assert.equal(readFeed(f, { after: a.next }).items.length, 0);
  fs.appendFileSync(f, '고"}}\n' + JSON.stringify(R.typed(999, '새 입력')) + '\n');
  const d = readFeed(f, { after: a.next });
  assert.deepEqual(d.items.map((x) => x.text), ['끝나지 않고', '새 입력']);
  assert.ok(Number.isFinite(d.items[0].o));
});

test('§142.4 minimal 프라이버시: 글·다른 세션 이름 없이 모양만, 카드 없음(실황과 같은 규칙)', () => {
  const dir = tmp();
  const f = write(dir, [R.queued(1, '비밀스러운 글'), R.peerIx(2, 'blue-sky-cat', '패널 글', 'm1'), R.peerSess(3, 'project-x', '보고', 'm2'), R.note(4), R.say(5, '답'), R.tool(6),
    { type: 'assistant', ...base, timestamp: T(7), message: { content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [{ question: '고를까요?', header: 'h', multiSelect: false, options: [{ label: 'a' }, { label: 'b' }] }] } }] } }]);
  const m = readFeed(f, { privacy: 'minimal' }).items;
  assert.ok(m.every((x) => !x.text), '글 없음');
  assert.ok(m.filter((x) => x.k !== 'tool').every((x) => x.hid === 1));
  assert.ok(!m.some((x) => x.k === 'ask'), '카드 없음');
  assert.equal(m.find((x) => x.src === 'peer').name, null); assert.equal(m.find((x) => x.src === 'peer').who, null);
  assert.equal(m.find((x) => x.src === 'ix').alias, 'blue-sky-cat', 'Agent4D 기기 별칭은 남김');
  assert.equal(minimalItem({ k: 'tool', tools: ['Bash'] }).tools[0], 'Bash');
});

test('§142.5 헤드리스(-p·SDK) 판정: 세션 기록 entrypoint · 명령줄 -p/--print(따옴표 안 글 무시) · 캐시', async () => {
  assert.equal(isHeadlessEntrypoint('sdk-cli'), true); assert.equal(isHeadlessEntrypoint('sdk-ts'), true);
  assert.equal(isHeadlessEntrypoint('cli'), false); assert.equal(isHeadlessEntrypoint(null), false);
  assert.equal(argvHeadless('"C:\\Users\\x\\claude.exe" -p --permission-mode bypassPermissions --effort xhigh'), true);
  assert.equal(argvHeadless('claude --print "hi"'), true);
  assert.equal(argvHeadless('claude --resume abc "please use -p here"'), false);
  assert.equal(argvHeadless('claude'), false); assert.equal(argvHeadless(''), null);
  let calls = 0;
  const query = async (pids) => { calls++; return new Map(pids.filter((p) => p !== 4).map((p) => [p, p === 2 ? 'claude.exe -p x' : 'claude.exe'])); }; // pid 4 = 조회 실패(모름)
  const recs = () => [{ pid: 1, startedAt: 10, entrypoint: 'cli' }, { pid: 2, startedAt: 20, entrypoint: 'cli' }, { pid: 3, startedAt: 30, entrypoint: 'sdk-cli' }, { pid: 4, startedAt: 40, entrypoint: null }];
  const r1 = await markHeadless(recs(), { query, now: 1000 });
  assert.deepEqual(r1.map((r) => [r.headless, r.headlessWhy]), [[false, null], [true, 'argv'], [true, 'entrypoint'], [null, null]]);
  assert.equal(calls, 1, '한 번에 묶어서');
  assert.deepEqual(r1.map((r) => r.unverified), [false, false, false, true], '§143.3 entrypoint 없음 + 명령줄 모름만 확인 안 됨');
  await markHeadless(recs(), { query, now: 2000 });
  assert.equal(calls, 1, '캐시(pid + 시작 시각)');
  await markHeadless(recs(), { query, now: 1000 + 11 * 60_000 });
  assert.equal(calls, 2, '10분 지나면 다시');
});

test('§142.6 교차 세션 메시지 → 사용자 입력 이벤트(Interactive = human · 다른 세션 = peer, ix src·who, 같은 msg_id 한 번) — 라이브 = 재생', async () => {
  const root = tmp();
  const cwd = 'D:\\work\\peerfx';
  const enc = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
  const SID = 'cdcdcdcd-5555-4555-8555-cdcdcdcdcdcd';
  const projects = path.join(root, 'projects'), sessions = path.join(root, 'sessions');
  const proj = path.join(projects, enc(cwd));
  for (const d of [proj, sessions]) fs.mkdirSync(d, { recursive: true });
  const P = Date.now() - 3 * 86400_000, TT = (s) => new Date(P + s * 1000).toISOString();
  const b = { sessionId: SID, cwd, version: '2.1.318', entrypoint: 'cli' };
  const at = (s, r) => ({ ...r, ...b, timestamp: TT(s) });
  const recs = [
    at(0, R.typed(0, '터미널에서')), at(1, R.say(1, '네')), at(2, R.turnEnd(2)),
    at(10, R.peerIx(10, 'big-star-parrot', '패널에서 보냄', 'mx1')), at(11, R.say(11, '받았습니다')), at(12, R.turnEnd(12)),
    at(20, R.tool(20)), at(21, R.midPeer(21, 'big-star-parrot', '작업 중 패널 글', 'mx2')), at(22, R.result(22)), at(23, R.say(23, '끝')), at(24, R.turnEnd(24)),
    at(30, R.peerSess(30, 'proj-loop-b8', '<b>다른 세션</b> 보고', 'mx3')), at(31, R.peerSess(31, 'proj-loop-b8', '<b>다른 세션</b> 보고', 'mx3')), at(32, R.turnEnd(32)),
    at(40, R.queued(40, '(휴대폰 입력)hi')), at(41, R.turnEnd(41)),
  ];
  const file = path.join(proj, `${SID}.jsonl`);
  fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const old = (P + 60_000) / 1000; fs.utimesSync(file, old, old);
  try {
    const index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
    await index.refresh();
    for (const e of index.entries.values()) e.birthtimeMs = e.mtimeMs;
    const rt = new RootRuntime({ sessionId: SID, index });
    await rt.start(); rt.close();
    const data = await buildReplay({ sessionId: SID, index });
    for (const [name, evs] of [['live', rt.graph.ring], ['replay', data.events.map((x) => x.e || x)]]) {
      const us = evs.filter((e) => e.type === 'user' && e.nodeId === `s:${SID}`);
      assert.deepEqual(us.map((e) => [e.origin, e.ix?.op, e.ix?.src || null, e.ix?.who || null]), [
        ['human', 'prompt', null, null],
        ['human', 'prompt', 'ix', 'big-star-parrot'],
        ['human', 'midturn', 'ix', 'big-star-parrot'],
        ['peer', 'prompt', 'peer', 'proj-loop-b8'],
        ['human', 'prompt', null, null],
      ], name);
      assert.match(us[3].text, /다른 세션/, name);
    }
  } finally { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} }
  // 보낸 세션 노드: 수신함 주소(uds:<파이프>) → 세션 기록의 messagingSocketPath(대소문자 무시)
  _resetPeerAddr();
  assert.equal(peerNodeOf('uds:' + PIPE.toUpperCase(), { list: () => [{ sock: PIPE, sessionId: 'abcd' }], now: 1 }), 's:abcd');
  assert.equal(peerNodeOf('tcp:1.2.3.4', { list: () => [], now: 2 }), null);
  _resetPeerAddr();
  // ix 정리: who 는 가림·48자, minimal 이면 뺌
  assert.equal(sanitizeIx({ cat: 'user', op: 'prompt', src: 'peer', who: 'project-x', from: 's:abcd' }).who, 'project-x');
  assert.equal(sanitizeIx({ cat: 'user', op: 'prompt', src: 'peer', who: 'project-x' }, 'minimal').who, undefined);
});

test('§143.2 재생에서도 보낸 세션 노드: 수신함 주소 장부(라이브가 본 주소 ↔ 세션) — 저장·합침·상한, offline 은 장부로만, 라이브 = 재생', async () => {
  const S = (d) => `${d.repeat(8)}-1111-4111-8111-${d.repeat(12)}`;
  const A = (c) => '\\\\.\\pipe\\LOCAL\\cc-msg-' + c.repeat(32);
  const dir = tmp(), file = path.join(dir, 'peer-addr.json');
  let now = 1000;
  const b1 = new PeerAddrBook({ file, max: 3, now: () => now });
  assert.equal(b1.observe([[A('A'), S('1')]]), true);
  assert.equal(b1.observe([[A('a'), S('1')]]), false, '같은 짝(파이프 이름 대소문자 무시)');
  assert.equal(b1.get('uds:' + A('a')), S('1')); assert.equal(addrKey('uds:' + A('B')), addrKey(A('b')));
  assert.equal(b1.observe([['tcp:1.2.3.4', S('2')], [A('c'), 'not-a-session']]), false, '주소·세션 꼴이 아니면 버림');
  b1.flush();
  assert.ok(!fs.readFileSync(file, 'utf8').includes('peerToken'));
  const b2 = new PeerAddrBook({ file, max: 3, now: () => now });
  assert.equal(b2.get(A('a')), S('1'), '파일에서 읽음(다른 프로세스·재시작 뒤)');
  now = 2000; b2.observe([[A('b'), S('2')], [A('c'), S('3')]]); b2.flush();
  now = 3000; b1.observe([[A('d'), S('4')]]); b1.flush(); // 다른 쪽이 그 사이 쓴 것과 합치고, 상한 3 = 오래된 것부터 버림
  const b3 = new PeerAddrBook({ file, max: 3 });
  assert.deepEqual([A('a'), A('b'), A('c'), A('d')].map((x) => b3.get(x)), [null, S('2'), S('3'), S('4')]);
  // offline = 장부로만(세션 기록 목록을 읽지 않음)
  _resetPeerAddr();
  assert.equal(peerNodeOf('uds:' + A('c'), { offline: true, book: b3, list: () => { throw new Error('재생은 세션 기록을 읽지 않음'); } }), `s:${S('3')}`);
  assert.equal(peerNodeOf('uds:' + A('c'), { offline: true, book: null }), null);
  // 라이브: 세션 기록에 없으면(이미 끝난 세션) 장부로, 본 세션 기록은 장부에 적음
  const b4 = new PeerAddrBook({ file: null });
  assert.equal(peerNodeOf('uds:' + A('e'), { list: () => [{ sock: A('e'), sessionId: S('5') }], now: 1, book: b4 }), `s:${S('5')}`);
  assert.equal(b4.get(A('e')), S('5'));
  _resetPeerAddr();
  assert.equal(peerNodeOf('uds:' + A('e'), { list: () => [], now: 2, book: b4 }), `s:${S('5')}`, '끝난 세션도 장부로');
  _resetPeerAddr();

  // 재생: 다른 세션이 보낸 메시지의 from(보낸 세션 노드)이 라이브와 같다 — 색인 장부에 PIPE ↔ 보낸 세션
  const root = tmp(), cwd = 'D:\\work\\peerfrom', SIDR = 'efefefef-5555-4555-8555-efefefefefef', SENDER = S('9');
  const projects = path.join(root, 'projects'), sessions = path.join(root, 'sessions');
  const proj = path.join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'));
  for (const d of [proj, sessions]) fs.mkdirSync(d, { recursive: true });
  const P = Date.now() - 2 * 86400_000, TT = (x) => new Date(P + x * 1000).toISOString();
  const bb = { sessionId: SIDR, cwd, version: '2.1.318', entrypoint: 'cli' };
  const recs = [R.typed(0, '시작'), R.say(1, '네'), R.turnEnd(2), R.peerSess(10, 'proj-loop-b8', '보고', 'mf1'), R.say(11, '받음'), R.turnEnd(12)].map((r, i) => ({ ...r, ...bb, timestamp: TT(i * 5) }));
  const tf = path.join(proj, `${SIDR}.jsonl`);
  fs.writeFileSync(tf, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const old = (P + 60_000) / 1000; fs.utimesSync(tf, old, old);
  try {
    const book = new PeerAddrBook({ file: null });
    book.observe([[PIPE, SENDER]]);
    const index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions, addrBook: book });
    await index.refresh();
    for (const e of index.entries.values()) e.birthtimeMs = e.mtimeMs;
    const rt = new RootRuntime({ sessionId: SIDR, index });
    await rt.start(); rt.close();
    const data = await buildReplay({ sessionId: SIDR, index });
    for (const [name, evs] of [['live', rt.graph.ring], ['replay', data.events.map((x) => x.e || x)]]) {
      const pe = evs.find((e) => e.type === 'user' && e.origin === 'peer');
      assert.equal(pe?.ix?.from, `s:${SENDER}`, name);
      assert.equal(pe.ix.who, 'proj-loop-b8', name);
    }
  } finally { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} _resetPeerAddr(); }
  // 세션 색인이 세션 기록을 훑을 때 주소 ↔ 세션을 장부에 적는다(.key 는 읽지 않음)
  const sd = tmp(), book2 = new PeerAddrBook({ file: null });
  fs.writeFileSync(path.join(sd, '123.json'), JSON.stringify({ pid: 123, sessionId: S('7'), messagingSocketPath: A('f') }));
  fs.writeFileSync(path.join(sd, '123.' + 'f'.repeat(64) + '.key'), '{not json');
  const ix2 = new SessionIndex({ projectsDir: tmp(), sessionsDir: sd, addrBook: book2 });
  await ix2.refresh();
  assert.equal(book2.get(A('F')), S('7'));
});
