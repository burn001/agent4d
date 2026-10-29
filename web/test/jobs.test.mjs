// 작업(Job) 노드 — 웹 공통 순수 규칙(job-core)·접기·배치·퇴장·mock 시험. 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _setLangForTest } from '../i18n.mjs';
import { JOBW, JOB_CODE, isJob, jobStale, jobDisplayState, jobCode, jobProgress, jobTags, jobSummary, jobLabelKey, jobFold, jobInspect } from '../job-core.mjs';
import { batchFold, nodeTags } from '../batch-core.mjs';
import { computeLayout, JOB_FIRST } from '../layout.js';
import { exitEligible, exitWalls, jobCardsGone, EXIT_ERR } from '../flow-core.mjs';
import { MockGenerator } from '../mock.js';

_setLangForTest('ko');
const T0 = Date.parse('2026-10-25T12:00:00Z');
const iso = (min) => new Date(T0 + min * 60000).toISOString();
const J = (id, parentId, job, extra = {}) => ({ id, parentId, kind: 'bash-bg', status: job.state === 'running' ? 'active' : job.state === 'done' ? 'done' : job.state === 'failed' ? 'error' : 'idle',
  label: job.title || job.id, startedAt: job.startedAt || iso(0), endedAt: job.endedAt || null, meta: { job: { v: 1, id: id.split(':').pop(), ...job }, title: job.phase || null }, ...extra });

test('정체: 명시 · 박동 문턱 · 대기(until) · 끝난 작업은 아님', () => {
  const run = { state: 'running', beatAt: iso(0) };
  assert.equal(jobStale(run, T0 + 5 * 60000).stale, false);
  assert.equal(jobStale(run, T0 + (JOBW.STALE_SEC + 1) * 1000).stale, true);
  assert.equal(jobStale({ ...run, staleSec: 3600 }, T0 + 30 * 60000).stale, false, '작업별 문턱');
  assert.equal(jobStale({ ...run, stale: true }, T0 + 1000).stale, true, '명시 정체');
  const w = { state: 'waiting', beatAt: iso(0), until: iso(60) };
  assert.equal(jobStale(w, T0 + 50 * 60000).stale, false, '재확인 전');
  assert.equal(jobStale(w, T0 + (60 + JOBW.WAIT_GRACE_SEC / 60 + 1) * 60000).stale, true, '재확인 + 여유 뒤');
  assert.equal(jobStale({ state: 'done', beatAt: iso(0), stale: true }, T0 + 1e9).stale, false);
  assert.equal(jobDisplayState({ ...run, stale: true }, T0), 'stale');
  assert.equal(jobCode(run, T0), JOB_CODE.running);
  assert.equal(jobCode({ state: 'failed' }, T0), JOB_CODE.failed);
});

test('진행 · 꼬리표 · 요약 · 라벨 열쇠 · 인스펙터 모델', () => {
  assert.equal(jobProgress({ progress: { n: 96, total: 101 } }).toFixed(3), (96 / 101).toFixed(3));
  assert.equal(jobProgress({ progress: { ratio: 2 } }), 1);
  assert.equal(jobProgress({}), null);
  const j = { state: 'running', phase: 'DAILY 2단계', progress: { n: 96, total: 101 }, host: 'db-host', beatAt: iso(0) };
  assert.deepEqual(jobTags(j, T0), ['진행', '96/101']);
  assert.equal(jobSummary(j, T0), '진행 · DAILY 2단계 · 96/101 · db-host');
  assert.deepEqual(jobTags({ state: 'running', beatAt: iso(0), stale: true }, T0 + 35 * 60000), ['정체 35분']);
  assert.deepEqual(jobTags({ state: 'failed', rc: 4, progress: { n: 3, total: 9 } }, T0), ['실패', 'rc 4']);
  const wt = jobTags({ state: 'waiting', until: iso(60), beatAt: iso(0) }, T0);
  assert.equal(wt[0], '대기'); assert.match(wt[1], /^~\d\d:\d\d$/);
  // 라벨 열쇠는 정체 분 단위로만 바뀐다
  const st = { state: 'running', beatAt: iso(0), stale: true };
  assert.equal(jobLabelKey(st, T0 + 60_000), jobLabelKey(st, T0 + 90_000));
  assert.notEqual(jobLabelKey(st, T0 + 60_000), jobLabelKey(st, T0 + 130_000));
  const node = J('j:m:x:daily', 'm:x', { ...j, title: '일일 회차', line: '[회차] 21:02 runner — 2단계', src: 'rule:round', rc: null });
  assert.equal(nodeTags(node, null, T0).join(','), '진행,96/101', 'nodeTags 가 작업 꼬리표를 낸다');
  const ins = jobInspect(node, T0);
  assert.equal(ins.title, '일일 회차');
  assert.deepEqual(ins.rows.map((r) => r[0]), ['state', 'phase', 'progress', 'host', 'beat', 'src']);
  assert.equal(ins.line, '[회차] 21:02 runner — 2단계');
  assert.equal(jobInspect({ id: 'b:1', meta: {} }, T0), null);
});

test('접기: 주인마다 끝난 작업 최근 3개만 · 끝나지 않은 작업은 늘 · batchFold 에도', () => {
  const list = [{ id: 's:m', parentId: null, kind: 'main', status: 'active', meta: {} }, { id: 'b:L', parentId: 's:m', kind: 'bash-bg', status: 'active', meta: {} }];
  for (let i = 0; i < 6; i++) list.push(J(`j:b:L:w${i}`, 'b:L', { state: i === 4 ? 'failed' : 'done', startedAt: iso(i), endedAt: iso(i + 0.5) }));
  list.push(J('j:b:L:loop', 'b:L', { state: 'running', startedAt: iso(-10), beatAt: iso(6) }));
  list.push(J('j:m:q:x', 'm:q', { state: 'done', endedAt: iso(1) }));
  const nodes = new Map(list.map((n) => [n.id, n]));
  const f = jobFold(nodes);
  assert.deepEqual([...f.hidden].sort(), ['j:b:L:w0', 'j:b:L:w1', 'j:b:L:w2']);
  assert.deepEqual(f.byOwner.get('b:L'), ['j:b:L:loop', 'j:b:L:w3', 'j:b:L:w4', 'j:b:L:w5']);
  assert.ok(batchFold(nodes).hidden.has('j:b:L:w0') && !batchFold(nodes).hidden.has('j:b:L:loop'));
  assert.ok(isJob(nodes.get('j:b:L:w3')) && !isJob(nodes.get('b:L')));
});

test('퇴장(§37.9): 끝난 작업은 주인이 살아 있어도 나가고, 문제 있는 끝(작업 rc≠0·에이전트 오류)은 문턱 전 남음 · 뒤 빠짐', () => {
  const mk = (ownerSt) => new Map([
    ['s:m', { id: 's:m', parentId: null, kind: 'main', status: 'active', meta: {} }],
    ['m:1', { id: 'm:1', parentId: 's:m', kind: 'monitor', status: ownerSt, meta: {} }],
    ['j:m:1:a', J('j:m:1:a', 'm:1', { state: 'done', rc: 0, endedAt: iso(0) })],
    ['j:m:1:f', J('j:m:1:f', 'm:1', { state: 'failed', rc: 4, endedAt: iso(0) })],
    ['j:m:1:g', J('j:m:1:g', 'm:1', { state: 'failed', rc: 1, endedAt: iso(0), failLingerSec: 60 })],
    ['a:1', { id: 'a:1', parentId: 's:m', kind: 'subagent', status: 'error', endedAt: iso(0), meta: {} }],
    ['a:2', { id: 'a:2', parentId: 's:m', kind: 'subagent', status: 'error', meta: {} }], // 끝난 시각 없음 → 처음 본 시각부터
    ['a:3', { id: 'a:3', parentId: 's:m', kind: 'subagent', status: 'done', endedAt: iso(0), meta: {} }],
    ['b:3', { id: 'b:3', parentId: 'a:3', kind: 'bash-bg', status: 'active', meta: {} }], // 하위가 일하면 남음
  ]);
  const at = (sec) => exitEligible(mk('active'), ['s:m'], { nowMs: T0 + sec * 1000, seen: new Map([['a:2', T0]]) });
  // 정상 끝: 주인(Monitor)이 살아 있어도 대상(수정 전에는 주인이 끝날 때까지 남았다 — 일일 회차 작업이 계속 보이던 원인)
  assert.ok(at(1).has('j:m:1:a'));
  assert.ok(!exitEligible(mk('active'), ['s:m']).has('j:m:1:f')); // 시계가 없으면 오류는 남는다
  // 문턱 전: 오류·실패 남음 / 문턱 뒤(기본 600초): 빠짐. 작업별 failLingerSec 가 이긴다
  const before = at(EXIT_ERR.LINGER_SEC - 1), after = at(EXIT_ERR.LINGER_SEC);
  for (const id of ['j:m:1:f', 'a:1', 'a:2']) { assert.ok(!before.has(id), id + ' 문턱 전 남음'); assert.ok(after.has(id), id + ' 문턱 뒤 빠짐'); }
  assert.ok(!at(59).has('j:m:1:g') && at(60).has('j:m:1:g'));
  assert.ok(!after.has('a:3') && !after.has('b:3') && !after.has('m:1') && !after.has('s:m'));
  // 하위가 늦게 끝나면 부모는 그때부터 센다(퇴장 시각 = 자기와 하위 중 가장 늦은 끝)
  const nodes = mk('active'); nodes.get('b:3').status = 'done';
  const elig = exitEligible(nodes, ['s:m'], { nowMs: T0 });
  const w = exitWalls(nodes, elig, new Map([['a:3', 10], ['b:3', 50]]));
  assert.equal(w.get('a:3'), 50);
  assert.equal(exitWalls(nodes, elig, new Map([['a:3', 10]])).get('a:3'), null); // 하위 끝 시각을 모르면 아직 아님
  // 복셀 작업 카드: 정상 끝 2.5초 뒤 · 실패는 문턱 뒤
  const vn = mk('active');
  assert.ok(!jobCardsGone(vn, T0 + 2000).has('j:m:1:a') && jobCardsGone(vn, T0 + 2500).has('j:m:1:a'));
  assert.ok(!jobCardsGone(vn, T0 + (EXIT_ERR.LINGER_SEC - 1) * 1000).has('j:m:1:f') && jobCardsGone(vn, T0 + EXIT_ERR.LINGER_SEC * 1000).has('j:m:1:f'));
  assert.ok(!jobCardsGone(vn, T0 + 1e9).has('a:1')); // 복셀 직원은 고유 퇴장(카드만 판정)
});

test('배치: 위성(Monitor) 아래 작업은 바깥쪽 사슬 — 다른 위성·부모와 겹치지 않음', () => {
  const nodes = new Map();
  nodes.set('s:m', { id: 's:m', parentId: null, kind: 'main', meta: {}, _order: 0 });
  for (let i = 0; i < 4; i++) nodes.set(`m:${i}`, { id: `m:${i}`, parentId: 's:m', kind: i % 2 ? 'bash-bg' : 'monitor', meta: {}, _order: i + 1 });
  for (let i = 0; i < 3; i++) nodes.set(`j:m:0:${i}`, { id: `j:m:0:${i}`, parentId: 'm:0', kind: 'bash-bg', meta: { job: { id: String(i), state: 'running' } }, _order: 10 + i });
  const { pos, parentOf } = computeLayout(nodes, 's:m');
  assert.equal(parentOf.get('j:m:0:1'), 'm:0');
  const m0 = pos.get('m:0'), root = pos.get('s:m');
  const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  for (let i = 0; i < 3; i++) {
    const p = pos.get(`j:m:0:${i}`);
    assert.ok(d(p, root) > d(m0, root), '부모(메인)보다 바깥');
    assert.ok(d(p, m0) >= JOB_FIRST - 0.01);
  }
  const ids = [...pos.keys()];
  for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) assert.ok(d(pos.get(ids[a]), pos.get(ids[b])) > 1.2, `${ids[a]}·${ids[b]} 겹침`);
});

test('mock(?mock=1): 작업 노드가 서버 모양으로 생기고 재무장 Monitor 를 따라 옮겨 가며 끝난 대기는 3개만 남는다', () => {
  const gen = new MockGenerator({ seed: 2026, startMs: T0, launcher: true, ix: false, jobs: true });
  const reparent = [], states = new Set();
  while (gen.t < 150_000) for (const ev of gen.next().events) {
    if (ev.type === 'node-update' && ev.nodeId.startsWith('j:') && ev.patch.parentId) reparent.push(ev.patch.parentId);
    const j = ev.type === 'node-add' ? ev.node.meta.job : ev.patch?.meta?.job;
    if (j) states.add(j.state + (j.stale ? '+stale' : '') + (j.until ? '+until' : ''));
  }
  const jobsN = [...gen.nodes.values()].filter(isJob);
  assert.ok(jobsN.length >= 5, `작업 ${jobsN.length}`);
  for (const n of jobsN) { assert.equal(n.kind, 'bash-bg'); assert.match(n.id, /^j:[a-z]:[^:]+:/); assert.ok(n.meta.job.state in JOB_CODE); }
  assert.ok(reparent.length >= 1 && reparent.every((p) => p.startsWith('m:demo-rearm')), '재무장 Monitor 로 옮김');
  const f = jobFold(gen.nodes);
  const vis = (f.byOwner.get('b:demo-launch') || []).filter((id) => gen.nodes.get(id).meta.job.state === 'done');
  assert.ok(vis.length <= JOBW.KEEP_ENDED);
  for (const k of ['running', 'running+stale', 'waiting+until', 'done', 'failed']) assert.ok(states.has(k), k);
});
