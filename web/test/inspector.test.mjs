// 객체 클릭 상세 팝업 — 순수 부분 시험
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSPECT, kindInfo, statusInfo, elapsedMs, fmtElapsed, fmtMs, childrenOf, childStats, childLine, nowDoing,
  InspectBook, ixLoose, deviceModel, barHeights, islandModel, limitsLine, sheetMode, placeCard, autoCloseReason, targetKey, easeToward, parentIdOf,
} from '../inspector-core.mjs';

const T0 = Date.parse('2026-10-24T10:00:00Z');
const iso = (ms) => new Date(T0 + ms).toISOString();
const nodes = (arr) => new Map(arr.map((n) => [n.id, n]));

test('종류: 기동기·러너·회차가 kind 보다 앞서고 kind 마다 설명이 있다', () => {
  assert.equal(kindInfo({ id: 's:a', kind: 'main' }).name, '메인 에이전트');
  assert.match(kindInfo({ id: 'a:1', kind: 'subagent', meta: { agentType: 'Explore' } }).desc, /Explore/);
  assert.equal(kindInfo({ id: 'b:x', kind: 'bash-bg', meta: { launcher: { script: 'relaunch.sh' } } }).key, 'launcher');
  assert.equal(kindInfo({ id: 'b:x-r1', kind: 'bash-bg', meta: { runner: { script: 'autopilot.sh', instance: 1 } } }).key, 'runner');
  assert.equal(kindInfo({ id: 's:c', kind: 'claude-p', meta: { link: { by: 'launcher' }, cycle: 3 } }).key, 'cycle');
  assert.match(kindInfo({ id: 's:c', kind: 'claude-p', meta: { link: { by: 'launcher' }, cycle: 3 } }).desc, /#3/);
  for (const k of ['workflow', 'workflow-agent', 'claude-p', 'bash-bg', 'monitor']) assert.ok(kindInfo({ id: 'x', kind: k }).desc, k);
});

test('상태·경과: 대기인데 하위 작업 중이면 그렇게 쓰고, 끝났으면 시작～끝', () => {
  assert.equal(statusInfo({ status: 'active' }).label, '작업 중');
  assert.equal(statusInfo({ status: 'idle' }, { active: 2 }).label, '대기 · 하위 작업 중');
  assert.equal(statusInfo({ status: 'stopped' }).label, '중지됨');
  assert.equal(elapsedMs({ startedAt: iso(0) }, T0 + 65000), 65000);
  assert.equal(elapsedMs({ startedAt: iso(0), endedAt: iso(5000) }, T0 + 99999), 5000);
  assert.equal(fmtElapsed(65000), '1분 5초');
  assert.equal(fmtElapsed(3 * 3600e3 + 4 * 60e3), '3시간 4분');
  assert.equal(fmtMs(820), '820ms');
  assert.equal(fmtMs(4200), '4.2초');
});

test('자식·집계: 분리 기동기(spawnedBy)도 자식, 작업 중 먼저', () => {
  const m = nodes([
    { id: 's:m', kind: 'main', status: 'active' },
    { id: 'a:1', kind: 'subagent', parentId: 's:m', status: 'done', startedAt: iso(0) },
    { id: 'a:2', kind: 'subagent', parentId: 's:m', status: 'active', startedAt: iso(10) },
    { id: 'a:3', kind: 'subagent', parentId: 's:m', status: 'error', startedAt: iso(20) },
    { id: 'b:L', kind: 'bash-bg', parentId: null, meta: { launcher: {}, spawnedBy: 's:m' }, status: 'active' },
  ]);
  const kids = childrenOf(m, 's:m');
  assert.deepEqual(kids.map((k) => k.id).slice(0, 2).sort(), ['a:2', 'b:L']);
  assert.equal(kids[kids.length - 1].id, 'a:1');
  const s = childStats(kids);
  assert.equal(s.total, 4); assert.equal(s.active, 2); assert.equal(s.error, 1); assert.equal(s.done, 1);
  assert.match(childLine(s), /^하위 4개 중 작업 중 2 · 끝 1 · 오류 1$/);
  assert.equal(childLine(childStats(kids.filter((k) => k.kind === 'subagent'))), '서브에이전트 3개 중 작업 중 1 · 끝 1 · 오류 1');
  assert.equal(parentIdOf(m.get('b:L')), 's:m');
});

test('장부: 도구 시작·끝(성공/실패·소요)·상한, 출력 꼬리, 특별 상호작용, 말', () => {
  const b = new InspectBook({ tools: 3 });
  for (let i = 0; i < 5; i++) b.event({ type: 'tool-start', nodeId: 'a:1', toolUseId: 't' + i, tool: 'Bash', cat: 'shell', text: 'cmd ' + i, ts: iso(i * 1000) });
  assert.equal(b.tools('a:1').length, 3);
  assert.equal(b.tools('a:1')[0].id, 't2');
  b.event({ type: 'tool-end', nodeId: 'a:1', toolUseId: 't4', ok: false, durationMs: 1500, text: 'exit 1', ts: iso(5500), panel: { title: '$ npm test', lines: ['a', 'b', 'c'] } });
  const t4 = b.tools('a:1').find((x) => x.id === 't4');
  assert.equal(t4.ok, false); assert.equal(t4.ms, 1500);
  assert.deepEqual(b.tail('a:1').lines, ['a', 'b', 'c']);
  // 시작을 못 본 끝도 기록
  b.event({ type: 'tool-end', nodeId: 'a:2', toolUseId: 'zz', tool: 'Read', ok: true, ts: iso(1) });
  assert.equal(b.tools('a:2').length, 1);
  // 백그라운드 출력: 줄 단위 꼬리 + ref 주인에게도
  b.event({ type: 'output', nodeId: 'b:9', text: 'l1\nl2\n', ts: iso(2) });
  b.event({ type: 'output', nodeId: 'b:9', ts: iso(3), panel: { title: '$ tail', lines: Array.from({ length: 12 }, (_, i) => 'x' + i), ref: { nodeId: 's:m' } } });
  assert.equal(b.tail('b:9').lines.length, INSPECT.TAIL);
  assert.equal(b.tail('s:m').lines.at(-1), 'x11');
  // ix 는 범주별 최신 하나
  b.event({ type: 'tool-start', nodeId: 'a:1', toolUseId: 'g1', tool: 'Bash', ts: iso(9), ix: { cat: 'github', op: 'push', phase: 'start' } });
  b.event({ type: 'tool-end', nodeId: 'a:1', toolUseId: 'g1', ok: true, ts: iso(10), ix: { cat: 'github', op: 'push', phase: 'end', commits: 3 } });
  assert.equal(b.ix('a:1').length, 1);
  assert.equal(ixLoose(b.ix('a:1')[0]), 'push 3 commits');
  assert.equal(ixLoose({ cat: 'tests', op: 'pytest', pass: 120, fail: 2 }), 'pytest ✓120 ✗2');
  b.event({ type: 'text', nodeId: 'a:1', role: 'assistant', text: '  안녕\n하세요 ', ts: iso(11) });
  assert.equal(b.say('a:1'), '안녕 하세요');
  const v = b.ver; b.event({ type: 'thinking', nodeId: 'a:1', ts: iso(12) }); assert.equal(b.ver, v);
  b.reset(); assert.equal(b.tools('a:1').length, 0);
});

test('장부 LRU: 노드 수 상한', () => {
  const b = new InspectBook({ maxNodes: 3 });
  for (let i = 0; i < 5; i++) b.event({ type: 'tool-start', nodeId: 'n' + i, toolUseId: 'x', tool: 'Read', ts: iso(i) });
  assert.equal(b.m.size, 3);
  assert.equal(b.tools('n0').length, 0);
  assert.equal(b.tools('n4').length, 1);
});

test('지금 하는 일: 열린 도구 → brief → 마지막 말', () => {
  const b = new InspectBook();
  assert.deepEqual(nowDoing({ id: 'a', openTools: [{ tool: 'Read', text: 'a.js' }, { tool: 'Bash', text: 'npm test' }] }, b), { tool: 'Bash', text: 'npm test', more: 1 });
  b.event({ type: 'text', nodeId: 'a', role: 'assistant', text: '정리 중', ts: iso(0) });
  assert.equal(nowDoing({ id: 'a', openTools: [] }, b).text, '정리 중');
  assert.equal(nowDoing({ id: 'z', openTools: [] }, b), null);
});

test('기동기 모델: 요약·마지막 끝 사유·막대', () => {
  const L = { id: 'b:L', kind: 'bash-bg', meta: { launcher: { script: 'relaunch.sh' }, batch: {
    total: 9, running: 1, done: 6, stopped: 1, failed: 1, avgDurationMs: 12 * 60000, currentCycleId: 'c9',
    recent: [
      { sessionId: 'c5', status: 'done', startedAt: iso(0), endedAt: iso(600000) },
      { sessionId: 'c6', status: 'stopped', startedAt: iso(700000), endedAt: iso(900000) },
      { sessionId: 'c9', nodeId: 's:c9', status: 'active', startedAt: iso(1000000), endedAt: null },
    ] } } };
  const m = nodes([L, { id: 's:c9', kind: 'claude-p', parentId: 'b:L', status: 'active', startedAt: iso(1000000), label: 'claude -p · c9', meta: { link: { by: 'launcher' } } }]);
  const dm = deviceModel(L, m, T0 + 1300000);
  assert.match(dm.summary, /회차 9/);
  assert.equal(dm.lastEnd.label, '중지됨');
  assert.equal(dm.bars.length, 3);
  assert.equal(dm.current.id, 's:c9');
  assert.equal(dm.current.ms, 300000);
  const hs = barHeights(dm.bars);
  assert.equal(Math.max(...hs), 1);
  assert.ok(hs.every((x) => x > 0 && x <= 1));
});

test('섬 모델·한도 한 줄', () => {
  const m = nodes([
    { id: 's:a', kind: 'main', projectId: 'P', status: 'active', lastActivityAt: iso(-3000) },
    { id: 'a:1', kind: 'subagent', projectId: 'P', parentId: 's:a', status: 'active' },
    { id: 's:z', kind: 'main', projectId: 'Q', status: 'idle' },
  ]);
  const im = islandModel({ name: 'Projects\\2026', path: 'D:\\W', liveSessions: 1, sessions: 40 }, 'P', m, T0);
  assert.equal(im.name, 'Projects\\2026'); assert.equal(im.nodes, 2); assert.equal(im.active, 2); assert.deepEqual(im.mains, ['s:a']);
  assert.equal(im.lastAgo, '방금');
  assert.equal(limitsLine({ ok: true, five_hour: { pct: 18.4 }, seven_day: { pct: 22 } }), '계정 한도 5시간 18% · 7일 22%');
  assert.equal(limitsLine(null), '');
});

test('배치: 오른쪽 → 왼쪽 → 위아래, 화면 밖으로 넘치지 않음', () => {
  const B = { left: 0, top: 50, right: 1080, bottom: 800 };
  const size = { w: 340, h: 300 };
  const r = placeCard({ x: 300, y: 400, r: 20 }, size, B);
  assert.equal(r.side, 'right'); assert.equal(r.x, 300 + 20 + INSPECT.GAP);
  const l = placeCard({ x: 1000, y: 400, r: 20 }, size, B);
  assert.equal(l.side, 'left'); assert.ok(l.x + size.w <= 1000 - 20);
  // 가장자리·화면 밖 객체도 카드는 범위 안
  for (const a of [{ x: 5, y: 60, r: 3 }, { x: 1075, y: 795, r: 3 }, { x: -500, y: -500, r: 0 }, { x: 540, y: 425, r: 500 }]) {
    const p = placeCard(a, size, B);
    assert.ok(p.x >= B.left + INSPECT.MARGIN - 1e-9 && p.x + size.w <= B.right - INSPECT.MARGIN + 1e-9, JSON.stringify([a, p]));
    assert.ok(p.y >= B.top + INSPECT.MARGIN - 1e-9 && p.y + size.h <= B.bottom - INSPECT.MARGIN + 1e-9, JSON.stringify([a, p]));
  }
  assert.equal(placeCard({ x: -500, y: -500 }, size, B).off, true);
  assert.equal(sheetMode(390), true); assert.equal(sheetMode(1440), false);
});

test('자동 닫힘: 퇴장 · 45초 무입력(따라가기면 안 닫음)', () => {
  assert.equal(autoCloseReason({ present: false, now: 0, lastInput: 0 }), 'gone');
  assert.equal(autoCloseReason({ present: true, now: 44000, lastInput: 0 }), null);
  assert.equal(autoCloseReason({ present: true, now: 45000, lastInput: 0 }), 'idle');
  assert.equal(autoCloseReason({ present: true, now: 99e5, lastInput: 0, follow: true }), null);
  assert.equal(targetKey({ type: 'node', id: 's:a' }), 'n:s:a');
  assert.equal(targetKey({ type: 'cluster', pid: 'P' }), 'c:P');
  assert.equal(targetKey(null), '');
  const x = easeToward(0, 100, 1 / 60);
  assert.ok(x > 0 && x < 100);
  assert.equal(easeToward(5, 100, 0), 5);
});

test('영어(§86): 상태·경과·자식 한 줄·한도·종류 이름', async () => {
  const { _setLangForTest } = await import('../i18n.mjs');
  const { fmtAgo } = await import('../inspector-core.mjs');
  const { deviceSummary, nodeTags } = await import('../batch-core.mjs');
  _setLangForTest('en');
  try {
    assert.equal(statusInfo({ status: 'stopped' }).label, 'Stopped');
    assert.equal(statusInfo({ status: 'idle' }, { active: 2 }).label, 'Idle · children working');
    assert.equal(fmtElapsed(192000), '3m 12s');
    assert.equal(fmtMs(4200), '4.2s');
    assert.equal(fmtAgo(1000), 'just now');
    assert.equal(fmtAgo(5 * 60000), '5m ago');
    assert.equal(kindInfo({ kind: 'subagent', meta: { background: true } }).name, 'Subagent');
    assert.match(kindInfo({ kind: 'subagent', meta: { background: true } }).desc, /background$/);
    const kids = [{ id: 'a', kind: 'subagent', status: 'active' }, { id: 'b', kind: 'subagent', status: 'done' }, { id: 'c', kind: 'subagent', status: 'error' }];
    assert.equal(childLine(childStats(kids)), '3 Subagents: 1 working · 1 done · 1 error');
    assert.equal(limitsLine({ ok: true, five_hour: { pct: 18 }, seven_day: { pct: 22 }, stale: true }), 'Account limits 5h 18% · 7d 22% (stale)');
    assert.equal(deviceSummary({ total: 1, running: 1, avgMs: 14 * 60000 }), '1 cycle · 1 running · avg 14m');
    assert.deepEqual(nodeTags({ kind: 'monitor', meta: { rearmCount: 2 } }), ['rearmed ×2']);
    for (const s of [statusInfo({ status: 'active' }).label, fmtElapsed(90000000)]) assert.doesNotMatch(s, /[가-힣]/);
  } finally { _setLangForTest('ko'); }
});
