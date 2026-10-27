// 실행 중 셸(meta.run) — 꼬리표 글자·가상 시계·라벨 열쇠·카메라 점수·홀로 머리줄·꼬리 작은 상태·mock 시험. 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _setLangForTest } from '../i18n.mjs';
import { RUNW, runLabelOrder, runOf, runState, runVis, runVisStatus, runTags, runTagTip, runLabelKey, runCamBonus, runClock, minText, runHead, runRing, runCardModel } from '../run-core.mjs';
import { nodeTags, clockLabelKey } from '../batch-core.mjs';
import { workScore, isFitActive, isLive, isBusy, runningShell } from '../camera-core.mjs';
import { HoloBook, PANEL } from '../holo-core.mjs';
import { nodeVisualStateAt, runStaleOf, NODE_STATE } from '../flowview/flow-style.mjs';
import { MockGenerator } from '../mock.js';

_setLangForTest('ko');
const T0 = Date.parse('2026-10-27T03:00:00Z');
const S = 1000, MIN = 60_000;
const fg = (run, extra = {}) => ({ id: 'a:x', kind: 'subagent', status: 'active', label: 'x', meta: { run: { kind: 'fg', tool: 'Bash', since: T0, lastOut: null, staleAfter: 10 * MIN, buffered: false, ...run } }, ...extra });
const bg = (run, extra = {}) => ({ id: 'b:x', kind: 'bash-bg', status: 'active', label: 'python x.py', meta: { run: { kind: 'bg', since: T0, lastOut: T0, staleAfter: 2 * MIN, buffered: false, ...run } }, ...extra });

test('경과 글자: 10분 미만 m:ss, 그 위 분 단위(내림)', () => {
  assert.equal(runClock(0), '0:00');
  assert.equal(runClock(3 * MIN + 42 * S), '3:42');
  assert.equal(runClock(9 * MIN + 59 * S), '9:59');
  assert.equal(runClock(14 * MIN + 59 * S), '14분');
  assert.equal(runClock(65 * MIN), '1시간 5분');
  assert.equal(minText(45 * S), '30초');
  assert.equal(minText(2 * MIN + 30 * S), '2분');
});

test('꼬리표: 실행 · 조용함(30초↑) · 정체(staleAfter 초과) · 버퍼링? · 끝나면 rc', () => {
  const n = fg({ lastOut: T0 + 10 * S });
  assert.deepEqual(runTags(n, T0 + 20 * S), ['실행 0:20'], '마지막 출력 10초 전 — 조용함 아님');
  assert.deepEqual(runTags(n, T0 + 3 * MIN + 42 * S), ['실행 3:42', '조용함 3분']);
  const b = fg({ buffered: true });
  assert.deepEqual(runTags(b, T0 + 4 * MIN), ['실행 4:00', '조용함 4분', '출력 버퍼링?'], '출력 없음 = 시작부터 조용함');
  assert.match(runTagTip('출력 버퍼링?'), /python -u|PYTHONUNBUFFERED=1/);
  assert.equal(runTagTip('실행 4:00'), '');
  // 이유별 툴팁(bufferWhy) — 꼬리표 글자는 같음
  assert.match(runTagTip('출력 버퍼링?', fg({ buffered: true, bufferWhy: 'python' })), /python -u/);
  assert.equal(runTagTip('출력 버퍼링?', fg({ buffered: true, bufferWhy: 'pipe' })), '마지막 파이프(tail 등)가 끝날 때까지 출력을 모읍니다');
  assert.equal(runTagTip('출력 버퍼링?', fg({ buffered: true, bufferWhy: 'devnull' })), '출력을 버리고 있어 진행이 보이지 않습니다');
  assert.match(runTagTip('출력 버퍼링?', fg({ buffered: true, bufferWhy: 'weird' })), /python -u/, '모르는 값 = python');
  assert.deepEqual(runTags(fg({ buffered: true, bufferWhy: 'pipe' }), T0 + 4 * MIN), ['실행 4:00', '조용함 4분', '출력 버퍼링?']);
  const st = bg({ since: T0 - 20 * MIN, lastOut: T0 - 3 * MIN });
  assert.deepEqual(runTags(st, T0), ['실행 20분', '정체 3분'], '정체면 조용함 대신 정체(작업 정체와 같은 글자)');
  assert.deepEqual(runTags(bg({ rc: 1, ended: T0 + MIN }), T0 + 2 * MIN), ['rc 1']);
  assert.deepEqual(runTags(bg({}), T0 + 5 * S, { proc: true }), ['실행 0:05'], '분리 프로세스는 정체·rc 를 §103 꼬리표가 맡음');
  // nodeTags(세 표현 공용 경로)에 붙음
  assert.deepEqual(nodeTags(st, null, T0), ['실행 20분', '정체 3분']);
  assert.deepEqual(nodeTags({ id: 'a', kind: 'subagent', status: 'active', meta: { run: null } }, null, T0), []);
  try {
    _setLangForTest('en');
    assert.deepEqual(runTags(b, T0 + 4 * MIN), ['running 4:00', 'quiet 4m', 'output buffered?']);
    assert.deepEqual(runTags(st, T0), ['running 20m', 'stale 3m']);
    assert.match(runTagTip('output buffered?', fg({ buffered: true, bufferWhy: 'pipe' })), /last pipe/);
    assert.match(runTagTip('output buffered?', fg({ buffered: true, bufferWhy: 'devnull' })), /discarded/);
  } finally { _setLangForTest('ko'); }
});

test('가상 시계(재생): 판정은 넘겨준 시계로만 — 되감기면 경과 0, 앞으로 감으면 정체', () => {
  const n = bg({ since: T0, lastOut: T0 + MIN, staleAfter: 2 * MIN });
  assert.equal(runState(n, T0 - 30 * S).elapsedMs, 0, '시작보다 앞(되감기)');
  assert.equal(runVis(n, T0 + 2 * MIN), 'run');
  assert.equal(runVis(n, T0 + 3 * MIN + S), 'stale', '마지막 출력 + staleAfter 를 넘김');
  assert.equal(runState(n, T0 + 3 * MIN + S).stale, true);
  // 끝난 실행: 경과는 시작～끝(시계가 더 가도 그대로), 모습은 없음
  const e = bg({ rc: 0, ended: T0 + 90 * S });
  assert.equal(runState(e, T0 + 10 * MIN).elapsedMs, 90 * S);
  assert.equal(runVis(e, T0 + 10 * MIN), null);
  // 노드가 끝나면(서버가 ended 를 못 실었어도) 끝난 것으로
  assert.equal(runVis(bg({}, { status: 'done' }), T0 + S), null);
  // ISO 문자열도 받음
  assert.equal(runState(bg({ since: new Date(T0).toISOString(), lastOut: null }), T0 + 5 * S).elapsedMs, 5 * S);
  assert.equal(runOf({ meta: { run: { kind: 'zz' } } }), null, '모양이 틀리면 없음');
  // 전경 lastOut null(재생에서는 늘 null): python 버퍼링 추정일 때만 조용함, 정체는 판정 안 함
  assert.deepEqual(runTags(fg({ lastOut: null, staleAfter: MIN }), T0 + 5 * MIN), ['실행 5:00']);
  assert.equal(runVis(fg({ lastOut: null, staleAfter: MIN, buffered: true }), T0 + 5 * MIN), 'run');
});

test('모습 상태: 실행 중이면 대기가 아니라 작업 중, 정체면 대기 + 정체 색', () => {
  assert.equal(runVisStatus(bg({ lastOut: T0 }, { status: 'idle' }), T0 + 10 * S), 'active', '예전 서버가 idle 로 보내도 실행 중');
  assert.equal(runVisStatus(bg({ lastOut: T0 - 5 * MIN }), T0), 'idle', '정체');
  assert.equal(runVisStatus({ status: 'idle', meta: {} }, T0), 'idle');
  assert.equal(nodeVisualStateAt(bg({ lastOut: T0 }, { status: 'idle' }), 0, T0 + S), NODE_STATE.tool, '흐름: 도구 사용 모습');
  assert.equal(nodeVisualStateAt(bg({ lastOut: T0 - 5 * MIN }), 0, T0), NODE_STATE.idle);
  assert.equal(runStaleOf(bg({ lastOut: T0 - 5 * MIN }), T0), true);
  assert.equal(nodeVisualStateAt({ status: 'active', meta: {} }, 1, T0), NODE_STATE.tool, 'meta.run 없으면 예전 규칙');
});

test('라벨 열쇠: 10분 미만은 초마다, 그 위는 분마다만 바뀜(다시 그리기 줄임) · clockLabelKey', () => {
  const n = fg({ lastOut: T0 });
  assert.notEqual(runLabelKey(n, T0 + 5 * S), runLabelKey(n, T0 + 6 * S));
  assert.equal(runLabelKey(n, T0 + 12 * MIN + 5 * S), runLabelKey(n, T0 + 12 * MIN + 40 * S), '분 단위 표기 동안 같은 열쇠');
  assert.notEqual(runLabelKey(n, T0 + 12 * MIN + 5 * S), runLabelKey(n, T0 + 13 * MIN + 5 * S));
  assert.equal(clockLabelKey({ id: 'a', meta: {} }, T0), null, '시계로 바뀌는 것이 없으면 null');
  assert.ok(clockLabelKey(n, T0).includes('#'));
});

test('카메라 점수: 실행 중 셸은 경과 30초마다 +1(상한 6), 정체 0 · 조용한 백그라운드도 활성', () => {
  const v = (node) => ({ node, icons: new Map() });
  const n = bg({ lastOut: T0 + 9 * MIN, staleAfter: 5 * MIN }, { status: 'idle' });
  assert.equal(runCamBonus(n, T0 + 20 * S), 0);
  assert.equal(runCamBonus(n, T0 + 95 * S), 3);
  assert.equal(runCamBonus(n, T0 + 10 * MIN), RUNW.CAM_MAX);
  const now = 100; // 카메라 벽시계(초) — 이벤트 없음
  assert.equal(workScore(v(n), [], null, null, now, T0 + 95 * S), 3, '이벤트·열린 도구 없이도 가산점');
  assert.equal(workScore(v(n), [], null, null, now, T0 + 10 * MIN), 6);
  const st = bg({ lastOut: T0 }, { status: 'idle' });
  assert.equal(workScore(v(st), [], null, null, now, T0 + 10 * MIN), 0, '정체는 가산 없음(쉬는 노드)');
  assert.equal(isFitActive(v(n), 0, T0 + MIN), true);
  assert.equal(isFitActive(v(st), 0, T0 + 10 * MIN), false);
  assert.equal(isLive(v(n), null, now, T0 + MIN), true);
  assert.equal(isBusy(v(n), null, now, T0 + MIN), true);
  assert.equal(runningShell(v({ status: 'active', meta: {} }), T0), false);
  // 열린 도구 ×2 와 더해짐(전경)
  const f = { node: fg({ since: T0 - 4 * MIN }), icons: new Map([['t', {}]]) };
  assert.equal(workScore(f, [], null, null, now, T0), 2 + 6);
});

test('홀로 머리줄: 열린 셸 패널에 경과(전경 meta.run.since 우선), 글자가 바뀔 때만 판(pv)↑ · 장시간 30초↑', () => {
  const node = fg({ since: T0 - 4 * MIN, buffered: true });
  let clock = T0;
  const b = new HoloBook();
  b.nodeOf = () => node; b.clock = () => clock;
  const e = b.start('a:x', { toolUseId: 't1', tool: 'Bash', cat: 'shell', ts: new Date(T0).toISOString() }, 0);
  b.step(0);
  assert.equal(e.runHead, '4:00', '도구 시작 ts 가 아니라 meta.run.since');
  assert.equal(e.runLong, true);
  const pv = e.pv;
  clock = T0 + 300; b.step(0.3);
  assert.equal(e.pv, pv, '같은 초 = 다시 그리지 않음');
  clock = T0 + 1300; const ch = b.step(0.6);
  assert.equal(e.runHead, '4:01'); assert.equal(e.pv, pv + 1); assert.ok(ch.has('a:x'));
  // meta.run 없는 짧은 셸: 시작 ts 로, HEAD_MIN_MS 전에는 붙이지 않음
  const n2 = { id: 'a:y', status: 'active', meta: {} };
  const b2 = new HoloBook(); b2.nodeOf = () => n2; b2.clock = () => clock;
  const e2 = b2.start('a:y', { toolUseId: 't2', tool: 'Bash', cat: 'shell', ts: new Date(clock).toISOString() }, 0);
  b2.step(0); assert.equal(e2.runHead, '');
  clock += 45 * S; b2.step(1); assert.equal(e2.runHead, '0:45'); assert.equal(e2.runLong, true);
  b2.end('a:y', 't2', 'ok', 1.1); clock += 2 * S; b2.step(1.5); assert.equal(e2.runHead, '', '끝나면 머리줄 경과 없음');
  assert.ok(runHead(T0, T0 + 31 * S).long);
  assert.equal(runRing(15 * S), 0.25);
  assert.equal(runRing(20 * MIN), 1, '10분 넘으면 정적');
});

test('백그라운드 꼬리: meta.run 이 끝나지 않았으면 TAIL_LINGER 뒤 접지 않고 작은 상태, 새 출력이면 다시 크게, 끝나면 접힘', () => {
  const node = bg({ since: T0 - 6 * MIN, lastOut: T0 });
  let clock = T0;
  const b = new HoloBook();
  b.nodeOf = () => node; b.clock = () => clock;
  const out = (now) => b.panelEvent({ type: 'output', nodeId: 'b:x', panel: { mode: 'shell', part: 'tail', title: '$ python x.py', lines: ['a', 'b'], marks: 'oo' } }, now);
  out(0);
  const e = b.list('b:x')[0];
  assert.equal(e.sticky, 'tail');
  b.step(1); assert.equal(e.runHead, '6:00');
  b.step(PANEL.TAIL_LINGER + 2);
  assert.equal(e.mini, true); assert.equal(e.foldAt, null, '접히지 않음');
  out(PANEL.TAIL_LINGER + 3); b.step(PANEL.TAIL_LINGER + 3.1);
  assert.equal(e.mini, false, '새 출력 → 다시 펼침');
  node.meta.run = { ...node.meta.run, rc: 1, ended: clock };
  b.step(2 * PANEL.TAIL_LINGER + 10);
  assert.ok(e.foldAt != null, '끝나면 예전처럼 접힘');
});

test('인스펙터 줄: 경과 · 마지막 출력 · 버퍼링 추정 · 정체 · rc', () => {
  const m = runCardModel(fg({ since: T0 - 4 * MIN, buffered: true }), T0);
  assert.deepEqual(m.rows.map((r) => r.key), ['elapsed', 'lastOut', 'buffered']);
  assert.match(m.rows[0].value, /^4:00 · Bash$/);
  assert.equal(m.rows[1].value, '아직 출력 없음');
  assert.match(m.rows[2].value, /python -u/);
  assert.equal(runCardModel(fg({ since: T0 - 4 * MIN, buffered: true, bufferWhy: 'devnull' }), T0).rows[2].value, '출력을 버리고 있어 진행이 보이지 않습니다');
  assert.equal(runCardModel(fg({ since: T0 - 4 * MIN, buffered: true, bufferWhy: 'pipe' }), T0).rows[2].value, '마지막 파이프(tail 등)가 끝날 때까지 출력을 모읍니다');
  const s = runCardModel(bg({ since: T0 - 20 * MIN, lastOut: T0 - 3 * MIN }), T0);
  assert.equal(s.stale, true);
  assert.ok(s.rows.some((r) => r.key === 'stale'));
  assert.equal(s.rows.find((r) => r.key === 'lastOut').value, '3분 전');
  const d = runCardModel(bg({ rc: 1, ended: T0 + MIN }), T0 + 2 * MIN);
  assert.deepEqual(d.rows.map((r) => r.key), ['elapsed', 'lastOut', 'rc']);
  assert.equal(runCardModel({ meta: {} }, T0), null);
});

test('mock(§107): 전경 4분(버퍼링)·전경 2분(출력)·백그라운드 정체·tqdm·rc 1 이 생김', () => {
  const t0 = T0;
  const gen = new MockGenerator({ seed: 2026, startMs: t0, runs: true });
  const evs = [];
  while (gen.t < 20_000) evs.push(...gen.next().events);
  const nowMs = t0 + gen.t;
  const fg1 = gen.nodes.get('a:demo-run-fg1'), fg2 = gen.nodes.get('a:demo-run-fg2');
  assert.ok(fg1 && fg1.meta.run && fg1.meta.run.buffered);
  assert.ok(runState(fg1, nowMs).elapsedMs >= 4 * MIN);
  assert.ok(fg2 && fg2.meta.run && fg2.meta.run.lastOut > nowMs - 6000, '출력 있음');
  assert.equal(runVis(gen.nodes.get('b:demo-run-bg1'), nowMs), 'stale');
  assert.equal(runVis(gen.nodes.get('b:demo-run-tqdm'), nowMs), 'run');
  const f = gen.nodes.get('b:demo-run-fail1');
  assert.equal(f.status, 'error'); assert.equal(f.meta.run.rc, 1);
  assert.deepEqual(nodeTags(f, null, nowMs), ['rc 1']);
  // 기본 mock(runs 끔)은 그대로
  const g2 = new MockGenerator({ seed: 2026, startMs: t0 });
  while (g2.t < 20_000) g2.next();
  assert.ok(![...g2.nodes.keys()].some((id) => id.includes('demo-run')));
});

test('라벨 후보 순서: 끝나지 않은 실행 중 셸(정체 포함)을 오래 돈 순으로', () => {
  const vis = [
    { id: 'b:1', node: bg({ since: T0 - 2 * MIN }) },
    { id: 'b:2', node: bg({ since: T0 - 20 * MIN, lastOut: T0 - 10 * MIN }) },
    { id: 'b:3', node: bg({ rc: 0, ended: T0 }) },
    { id: 'a:4', node: { status: 'active', meta: {} } },
    { id: 'a:5', node: fg({ since: T0 - 5 * MIN }) },
  ];
  assert.deepEqual(runLabelOrder(vis, T0), ['b:2', 'a:5', 'b:1']);
});
