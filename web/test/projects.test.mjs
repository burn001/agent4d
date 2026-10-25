// 프로젝트 목록 순수 함수 시험
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relTime, groupProjects, tierOf, dotOf, countsText, sessionsOf, serializeSelection, parseSelection, selectionLabel, sameSelection, findSessionProject, sessionHint } from '../projects.js';

const NOW = Date.parse('2026-10-23T09:00:00Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const P = (id, extra = {}) => ({ projectId: id, name: id.toUpperCase(), path: 'D:\\' + id, temp: false, live: false, liveSessions: 0, activeSessions: 0, busySessions: 0, sessions: 5, lastActivityAt: ago(600), liveList: [], recentList: [], ...extra });

const sample = () => [
  P('old', { lastActivityAt: ago(60 * 30) }),
  P('alpha', { live: true, liveSessions: 2, activeSessions: 1, busySessions: 1, lastActivityAt: ago(3),
    liveList: [{ sessionId: 's1', title: '세션 하나', liveStatus: 'busy', activityAt: ago(3) }, { sessionId: 's2', title: '세션 둘', liveStatus: 'idle', activityAt: ago(40) }],
    recentList: [{ sessionId: 's2', title: '세션 둘', activityAt: ago(40) }, { sessionId: 's0', title: '지난 것', activityAt: ago(300) }] }),
  P('beta', { live: true, liveSessions: 1, activeSessions: 0, lastActivityAt: ago(20), liveList: [{ sessionId: 'b1', title: 'B', liveStatus: 'idle', activityAt: ago(20) }] }),
  P('gamma', { lastActivityAt: ago(50), recentList: [{ sessionId: 'g1', title: 'G', activityAt: ago(50) }] }),
  P('tmp', { temp: true, name: '(임시) scratchpad', live: true, liveSessions: 1, lastActivityAt: ago(1) }),
];

test('상대 시각', () => {
  assert.equal(relTime(ago(0.2), NOW), '방금');
  assert.equal(relTime(ago(3), NOW), '3분 전');
  assert.equal(relTime(ago(150), NOW), '2시간 전');
  assert.equal(relTime(ago(60 * 50), NOW), '2일 전');
  assert.equal(relTime(null, NOW), '');
});

test('정렬·묶음: live(최근순) → recent, temp 따로, 비활성은 목록에서 뺌(§26.2)', () => {
  const g = groupProjects(sample(), NOW);
  assert.deepEqual(g.live.map((p) => p.projectId), ['alpha', 'beta']);
  assert.deepEqual(g.recent.map((p) => p.projectId), ['gamma']);
  assert.equal(g.inactive, undefined);
  assert.equal(g.hidden, 1);
  assert.deepEqual(g.temp.map((p) => p.projectId), ['tmp']);
  assert.equal(g.totals.projects, 4);
  // 임시 폴더 프로젝트는 비활성이어도 (임시) 묶음에 그대로
  const g2 = groupProjects([P('t-old', { temp: true, lastActivityAt: ago(60 * 30) })], NOW);
  assert.deepEqual(g2.temp.map((p) => p.projectId), ['t-old']);
  assert.equal(g2.hidden, 0);
  assert.equal(g.totals.activeSessions, 1);
  assert.equal(tierOf(P('x', { lastActivityAt: ago(119) }), NOW), 'recent');
  assert.equal(tierOf(P('x', { lastActivityAt: ago(121) }), NOW), 'inactive');
});

test('활성 점·건수 문구', () => {
  const [old, alpha, beta] = sample();
  assert.equal(dotOf(alpha), 'busy');
  assert.equal(dotOf(beta), 'idle');
  assert.equal(dotOf(old), 'off');
  assert.equal(countsText(alpha), '세션 2 · 활성 1');
  assert.equal(countsText(old), '지난 세션 5');
});

test('세션 목록: live 먼저, recent 중복 제외', () => {
  const alpha = sample()[1];
  assert.deepEqual(sessionsOf(alpha).map((s) => [s.sessionId, s.live]), [['s1', true], ['s2', true], ['s0', false]]);
});

test('선택 직렬화·복원', () => {
  const ps = sample();
  for (const s of [{ scope: 'all' }, { scope: 'project', projectId: 'alpha' }, { scope: 'session', projectId: 'alpha', sessionId: 's1' }]) {
    const str = serializeSelection(s);
    const back = parseSelection(str, ps);
    assert.ok(sameSelection(s, back), str);
    if (s.scope === 'session') assert.equal(back.projectId, 'alpha');
  }
  assert.equal(serializeSelection(null), 'all');
  assert.equal(serializeSelection({ scope: 'project' }), 'all');
  assert.deepEqual(parseSelection('nonsense'), { scope: 'all' });
  assert.deepEqual(parseSelection(''), { scope: 'all' });
  assert.equal(parseSelection('session:zzz', ps).projectId, null);
  assert.equal(parseSelection('project:a:b').projectId, 'a:b');
  assert.equal(findSessionProject(ps, 'g1'), 'gamma');
});

test('선택 문구', () => {
  const ps = sample();
  assert.equal(selectionLabel({ scope: 'all' }, ps), '전체');
  assert.equal(selectionLabel({ scope: 'project', projectId: 'beta' }, ps), 'BETA');
  assert.equal(selectionLabel({ scope: 'session', projectId: 'alpha', sessionId: 's1' }, ps), 'ALPHA › 세션 하나');
  assert.equal(selectionLabel({ scope: 'session', projectId: 'alpha', sessionId: 'abcdef1234' }, ps), 'ALPHA › abcdef12');
});

test('재생 고르기: 프로젝트 필터·사람이 읽는 이름(§30.5)', async () => {
  const { groupSessions } = await import('../replay/ui.mjs');
  const resp = { sessions: [
    { sessionId: 'a1', projectDir: 'D--A', cwd: 'D:/x/A', title: 'a1', mtime: ago(5) },
    { sessionId: 'a2', projectDir: 'D--A', cwd: 'D:/x/A', title: 'a2', mtime: ago(9) },
    { sessionId: 'b1', projectDir: 'D--B', cwd: 'D:/y/B', title: 'b1', mtime: ago(1) },
  ] };
  assert.deepEqual(groupSessions(resp).map((g) => [g.projectDir, g.label]), [['D--B', 'y / B'], ['D--A', 'x / A']], '옵션 없으면 기존 동작');
  const names = new Map([['D--A', 'Projects-2026']]);
  const g = groupSessions(resp, { project: 'D--A', names });
  assert.equal(g.length, 1);
  assert.equal(g[0].label, 'Projects-2026');
  assert.deepEqual(g[0].items.map((s) => s.sessionId), ['a1', 'a2']);
  assert.equal(groupSessions(resp, { project: 'all', names }).length, 2);
});

test('세션 링크 — 최근 목록 밖 지난 세션은 루트 cwd·제목으로 이름표 (§42.1)', () => {
  const ps = sample();
  const root = { id: 's:abcdef1234', meta: { cwd: 'd:/alpha/', title: '지난 작업' } };
  const h = sessionHint(root, ps);
  assert.deepEqual(h, { projectId: 'alpha', projectName: 'ALPHA', title: '지난 작업' });
  // 고친 전: 프로젝트 없이 id 8자리만
  assert.equal(selectionLabel({ scope: 'session', sessionId: 'abcdef1234' }, ps), 'abcdef12');
  assert.equal(selectionLabel({ scope: 'session', sessionId: 'abcdef1234', ...h }, ps), 'ALPHA › 지난 작업');
  // 30일 밖(목록에 없는) 프로젝트: cwd 끝 폴더 이름
  const h2 = sessionHint({ meta: { cwd: 'C:\\work\\zeta\\' } }, ps);
  assert.deepEqual(h2, { projectId: null, projectName: 'zeta', title: null });
  assert.equal(selectionLabel({ scope: 'session', sessionId: 'abcdef1234', ...h2 }, ps), 'zeta › abcdef12');
  assert.deepEqual(sessionHint(null, ps), { projectId: null, projectName: null, title: null });
  // 직렬화는 id 만
  assert.equal(serializeSelection({ scope: 'session', sessionId: 'abcdef1234', ...h }), 'session:abcdef1234');
});
