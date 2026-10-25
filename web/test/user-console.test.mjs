// 사용자 콘솔(나 · 사용자) — 장부·상태·화면 문구·카드 모델·도형·집기(순수)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserBook, userState, consoleLines, userCardModel, wantsConsole, hitRect, agoShort, USERC } from '../user-core.mjs';
import { IxModel, ixGeometry } from '../ix-core.mjs';
import { targetKey } from '../inspector-core.mjs';
import { _setLangForTest } from '../i18n.mjs';

_setLangForTest('ko');
const T0 = Date.parse('2026-10-26T09:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const U = (o) => ({ v: 1, cat: 'user', phase: 'end', ...o });
const M = 's:main';

test('장부: 프롬프트 → 작업 중 → 답변 → 내 차례, 명령·끼어듦·인터럽트·거부 기록, 시각은 이벤트 ts', () => {
  const b = new UserBook();
  assert.equal(userState(b.get(M), T0), 'idle');
  assert.equal(b.event({ type: 'user', nodeId: M, origin: 'human', ts: at(0), ix: U({ op: 'prompt', text: '패널 글자 키워 줘', images: 1 }) }), M);
  let e = b.get(M);
  assert.equal(userState(e, T0 + 2000), 'working');
  b.event({ type: 'node-update', nodeId: M, ts: at(5), patch: {}, ix: U({ op: 'reply', text: '키웠습니다', turnMs: 5000 }) });
  assert.equal(userState(e, T0 + 6000), 'answered');
  assert.equal(e.replyAt, T0 + 5000);
  b.event({ type: 'user', nodeId: M, ts: at(10), ix: U({ op: 'command', cmd: '/done', text: '마무리' }) });
  b.event({ type: 'user', nodeId: M, ts: at(11), ix: U({ op: 'midturn', text: '라이트도' }) });
  assert.equal(userState(e, T0 + 12000), 'working');
  b.event({ type: 'user', nodeId: M, ts: at(13), ix: U({ op: 'interrupt', ok: false }) });
  assert.equal(userState(e, T0 + 14000), 'alert');
  assert.equal(userState(e, T0 + 13000 + USERC.ALERT_MS + 10), 'answered', '인터럽트는 턴을 닫음');
  b.event({ type: 'tool-end', nodeId: M, ts: at(20), ix: U({ op: 'deny', tool: 'Bash' }) });
  assert.deepEqual(e.msgs.map((m) => m.op), ['prompt', 'command', 'midturn', 'interrupt', 'deny']);
  assert.equal(e.msgs[0].images, 1);
  // 범주 밖·자동 알림은 메시지가 아님
  b.event({ type: 'user', nodeId: M, origin: 'task-notification', ts: at(21), ix: U({ op: 'auto', src: 'notify' }) });
  assert.equal(e.msgs.length, 5);
  assert.equal(b.event({ type: 'tool-start', nodeId: M, ts: at(22), ix: { v: 1, cat: 'tests', op: 'run' } }), null);
  // 노드 제거 = 잊음, reset(recent) = 다시 채움
  b.event({ type: 'node-remove', nodeId: M });
  assert.equal(b.get(M), null);
  b.reset([{ type: 'user', nodeId: M, ts: at(30), ix: U({ op: 'prompt', text: 'x' }) }]);
  assert.equal(b.get(M).msgs.length, 1);
});

test('질문(AskUserQuestion): 시작 = 내 차례·질문, 끝 = 고른 답·거절, 상태 복귀', () => {
  const b = new UserBook();
  b.event({ type: 'tool-start', nodeId: M, toolUseId: 'tu1', ts: at(0), ix: { v: 1, cat: 'user', op: 'ask', q: 1, opts: 3, multi: false, text: '어느 쪽?', phase: 'start' } });
  const e = b.get(M);
  assert.equal(userState(e, T0 + 1000), 'asking');
  const L = consoleLines(e, T0 + 1000);
  assert.equal(L.state, 'asking');
  assert.ok(L.text.includes('어느 쪽?') && L.status.includes('3'), L.line);
  b.event({ type: 'tool-end', nodeId: M, toolUseId: 'tu1', ts: at(4), ix: U({ op: 'ask', pick: 1, answer: '가로', ok: true }) });
  assert.equal(e.ask, null);
  assert.equal(e.lastAsk.pick, 1);
  const c = userCardModel(e, T0 + 5000);
  assert.ok(c.lastAsk && c.lastAsk.text === '어느 쪽?' && c.lastAsk.result.includes('가로'));
  b.event({ type: 'tool-start', nodeId: M, ts: at(6), ix: { v: 1, cat: 'user', op: 'ask', opts: 2, text: '진행?', phase: 'start' } });
  b.event({ type: 'tool-end', nodeId: M, ts: at(7), ix: U({ op: 'ask', declined: true, ok: false }) });
  assert.ok(userCardModel(e, T0 + 8000).lastAsk.declined);
});

test('화면 문구: 기록 없으면 "아직 메시지 없음" · 첫 몇 단어 자르기 · minimal(글 없음)이면 상태·시간만 · 옛 서버(ix 없음)는 시각만', () => {
  assert.deepEqual(consoleLines(null, T0), { state: 'idle', text: null, status: '아직 메시지 없음', line: '아직 메시지 없음' });
  const b = new UserBook();
  b.event({ type: 'user', nodeId: M, ts: at(0), ix: U({ op: 'prompt', text: '홀로그램 패널 글자 크기를 조금 더 키워 주세요 부탁' }) });
  b.event({ type: 'node-update', nodeId: M, ts: at(10), patch: {}, ix: U({ op: 'reply' }) });
  const L = consoleLines(b.get(M), T0 + 10000 + 5 * 60000);
  assert.ok(L.text.startsWith('› ') && L.text.endsWith('…') && L.text.length <= USERC.SCREEN_CHARS + 2, L.text);
  assert.equal(L.status, '5분 전 답함');
  const mn = new UserBook(); // privacy minimal: 서버가 text 를 뺌
  mn.event({ type: 'user', nodeId: M, ts: at(0), ix: U({ op: 'prompt', chars: 30 }) });
  const L2 = consoleLines(mn.get(M), T0 + 3000);
  assert.equal(L2.text, null);
  assert.ok(L2.status.startsWith('메인 작업 중'), L2.status);
  const old = new UserBook(); // ix 없는 연결: 사람 입력 시각만, 글은 쓰지 않음
  old.event({ type: 'user', nodeId: M, origin: 'human', ts: at(0), text: '비밀일 수도 있는 글' });
  assert.equal(old.get(M).msgs[0].text, null);
  assert.equal(userState(old.get(M), T0 + 1000), 'working');
  assert.equal(agoShort(90 * 1000), '1분');
});

test('카드 모델: 최근 메시지 최신순·상한, 마지막 답변(턴 시간), 비어 있음 표시', () => {
  const b = new UserBook();
  for (let i = 0; i < 8; i++) b.event({ type: 'user', nodeId: M, ts: at(i * 10), ix: U({ op: 'prompt', text: 'm' + i }) });
  b.event({ type: 'node-update', nodeId: M, ts: at(100), patch: {}, ix: U({ op: 'reply', text: '끝', turnMs: 3100 }) });
  const c = userCardModel(b.get(M), T0 + 160000, (t) => 'HH:MM');
  assert.equal(c.msgs.length, USERC.MSGS);
  assert.equal(c.msgs[0].text, 'm7');
  assert.equal(c.msgs[0].when, 'HH:MM');
  assert.equal(c.reply.turn, 3100);
  assert.equal(c.pill.key, 'idle');
  assert.equal(c.state, 'answered');
  assert.ok(userCardModel(null, T0).empty);
});

test('도형: 사용자 이벤트 전에도 메인마다 콘솔(env.consoleRoots) · 화면 안 글줄 · 이름표 · 집기 자리, 숨은 뿌리는 없음', () => {
  const pos = new Map([['a', { x: 0, y: 0, z: 0 }], ['b', { x: 30, y: 0, z: 0 }]]);
  const env = { theme: 'flow', pos: (id) => pos.get(id) || null, rad: () => 1, root: (id) => id, consoleRoots: () => ['a', 'b', 'hidden'], consoleInfo: (r) => consoleLines(null, T0) };
  const g = ixGeometry(new IxModel(), 1, env);
  assert.deepEqual(g.cons.map((c) => c.root), ['a', 'b']);
  assert.equal(g.clabels.length, 2);
  assert.equal(g.clabels[0].status, '아직 메시지 없음');
  assert.ok(g.nl >= 2 * 8, '틀 4 + 받침 2 + 글줄 ≥ 2 씩');
  const gp = ixGeometry(new IxModel(), 1, { ...env, theme: 'planet' });
  assert.equal(gp.cons.length, 2, 'Planet 지상 관제소도 처음부터');
  assert.ok(gp.cons[0].x < 0, '관제소 화면은 행성 왼쪽 바깥');
  // 질문 중이면 이름표 상태가 질문
  const b = new UserBook();
  b.event({ type: 'tool-start', nodeId: 'a', ts: at(0), ix: { v: 1, cat: 'user', op: 'ask', opts: 2, text: 'q', phase: 'start' } });
  const g2 = ixGeometry(new IxModel(), 1, { ...env, consoleInfo: (r) => consoleLines(b.get(r), T0) });
  assert.equal(g2.clabels[0].state, 'asking');
  assert.equal(g2.cons[0].state, 'asking');
});

test('집기·대상: hitRect(나중 것이 위·여백) · wantsConsole(끝난 메인 제외) · 카드 대상 키', () => {
  const L = [{ root: 'a', x0: 0, y0: 0, x1: 10, y1: 10 }, { root: 'b', x0: 5, y0: 5, x1: 20, y1: 20 }];
  assert.equal(hitRect(L, 7, 7).root, 'b');
  assert.equal(hitRect(L, 0, 0).root, 'a');
  assert.equal(hitRect(L, 23, 23, 4).root, 'b');
  assert.equal(hitRect(L, 40, 40), null);
  assert.ok(wantsConsole({ kind: 'main', status: 'idle' }));
  assert.ok(!wantsConsole({ kind: 'main', status: 'done' }));
  assert.ok(!wantsConsole({ kind: 'subagent', status: 'active' }));
  assert.equal(targetKey({ type: 'console', id: M }), 'u:' + M);
  assert.notEqual(targetKey({ type: 'console', id: M }), targetKey({ type: 'node', id: M }));
});
