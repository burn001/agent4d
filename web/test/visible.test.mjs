// 전체 보기 표시 고르기 — 모델·페이드·배치(빈자리 없이 다시 모음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVis, serializeVis, toggleProject, toggleSession, showAll, showOnly, markVisibility, fadeKeys, projVisible, sessVisible, emptyVis } from '../overview/visible.mjs';
import { ProjFade } from '../proj-fade.mjs';
import { computeOverview } from '../overview/layout.mjs';
import { computeCampus } from '../voxel/campus.mjs';

test('모델: 저장·복원, 깨진 값은 빈 모델, 새 프로젝트는 기본 보임', () => {
  const v = toggleSession(toggleProject(emptyVis(), 'b', ['a', 'b', 'c']), 's:x1');
  const r = parseVis(serializeVis(v));
  assert.deepEqual([...r.hp], ['b']);
  assert.deepEqual([...r.hs], ['x1']);
  assert.equal(projVisible(r, 'new-project'), true);
  assert.equal(sessVisible(r, 'x1'), false);
  assert.equal(parseVis('{bad').hp.size, 0);
  assert.equal(parseVis(null).hs.size, 0);
});

test('모델: 마지막 보이는 프로젝트는 끌 수 없음 · 없음 = 하나만 · 모두', () => {
  let v = toggleProject(emptyVis(), 'a', ['a', 'b']);
  const v2 = toggleProject(v, 'b', ['a', 'b']);
  assert.equal(v2, v);
  v = showOnly(emptyVis(), ['a', 'b', 'c'], 'b');
  assert.deepEqual([...v.hp].sort(), ['a', 'c']);
  v = showOnly(emptyVis(), ['a', 'b', 'c'], null);
  assert.deepEqual([...v.hp].sort(), ['b', 'c']);
  assert.equal(showAll().hp.size, 0);
  assert.deepEqual([...fadeKeys(toggleSession(v, 'q'))].sort(), ['b', 'c', 's:q']);
});

test('markVisibility: 숨긴 프로젝트·세션 루트에 userHidden, 빈 모델은 원본 그대로', () => {
  const roots = [{ sessionId: 'a1', projectId: 'A' }, { sessionId: 'b1', projectId: 'B' }, { sessionId: 'b2', projectId: 'B' }];
  const projects = [{ projectId: 'A' }, { projectId: 'B' }];
  assert.equal(markVisibility(roots, projects, emptyVis()).roots, roots);
  const v = toggleSession(toggleProject(emptyVis(), 'A', ['A', 'B']), 'b2');
  const m = markVisibility(roots, projects, v);
  assert.deepEqual(m.roots.map((r) => !!r.userHidden), [true, false, true]);
  assert.deepEqual(m.projects.map((p) => !!p.userHidden), [true, false]);
  assert.equal(roots[0].userHidden, undefined);
});

test('ProjFade.setHidden: 숨긴 키는 0.5초 페이드 → gone, 다시 보이면 이어서 페이드 인 · 세션 키는 초점과 무관', () => {
  const pf = new ProjFade(0.5);
  pf.setHidden(['B', 's:b2']);
  assert.ok(pf.busy);
  pf.step(0.25);
  assert.ok(pf.alpha('B') > 0 && pf.alpha('B') < 1);
  assert.ok(pf.out('B') && !pf.gone('B'));
  pf.step(0.3);
  assert.ok(pf.gone('B') && pf.gone('s:b2'));
  assert.equal(pf.alpha2('A', 's:b2'), 0);
  assert.equal(pf.alpha2('A', 's:a1'), 1);
  pf.setFocus('A', ['A', 'B']);
  assert.equal(pf.target('s:a1'), 1);
  pf.setFocus(null, ['A', 'B']);
  pf.setHidden([]);
  pf.step(0.25);
  assert.ok(pf.alpha('B') > 0 && pf.alpha('B') < 1);
  pf.step(0.5);
  assert.equal(pf.alpha('B'), 1);
  assert.equal(pf.busy, false);
  const p2 = new ProjFade(0.5);
  p2.setHidden(['X'], { instant: true });
  assert.ok(p2.gone('X'));
});

const mk = (pid, sid, extra = 0) => {
  const now = new Date().toISOString();
  const out = [{ id: 's:' + sid, kind: 'main', parentId: null, projectId: pid, sessionId: sid, rootSessionId: sid, status: 'active', startedAt: now, lastActivityAt: now }];
  for (let i = 0; i < extra; i++) out.push({ id: `a:${sid}:${i}`, kind: 'agent', parentId: 's:' + sid, projectId: pid, rootSessionId: sid, status: 'active', startedAt: now, lastActivityAt: now });
  return out;
};
const scene = () => {
  const nodes = [...mk('A', 'a1', 3), ...mk('B', 'b1', 6), ...mk('B', 'b2', 2), ...mk('C', 'c1', 3)];
  const roots = [{ sessionId: 'a1', projectId: 'A', live: true }, { sessionId: 'b1', projectId: 'B', live: true }, { sessionId: 'b2', projectId: 'B', live: true }, { sessionId: 'c1', projectId: 'C', live: true }];
  const projects = ['A', 'B', 'C'].map((p) => ({ projectId: p, name: p, live: true, active: true, liveSessions: 1 }));
  return { nodes, roots, projects };
};
const view = { aspect: 1.6, baseAspect: 1.6, elevMin: 90, elevMax: 90 };

test('computeOverview: 숨긴 프로젝트는 섬 없음·노드 hidden, 바뀌면 다시 줄 배치(남은 섬끼리 모음)', () => {
  const { nodes, roots, projects } = scene();
  const o0 = computeOverview(nodes, roots, projects, null, { view });
  assert.deepEqual(o0.clusters.map((c) => c.projectId).sort(), ['A', 'B', 'C']);
  const m = markVisibility(roots, projects, toggleProject(emptyVis(), 'B', ['A', 'B', 'C']));
  const o1 = computeOverview(nodes, m.roots, m.projects, o0, { view });
  assert.deepEqual(o1.clusters.map((c) => c.projectId).sort(), ['A', 'C']);
  assert.equal(o1.repackWhy, 'visible');
  assert.ok(o1.hidden.has('s:b1') && o1.hidden.has('a:b1:0') && o1.hidden.has('s:b2'));
  assert.ok(!o1.hidden.has('s:a1'));
  // 빈자리 없음: 남은 두 섬 경계 사이 거리가 작다(가운데 섬 자리를 비워 두지 않음)
  const [a, c] = ['A', 'C'].map((p) => o1.clusters.find((x) => x.projectId === p));
  const gapX = Math.abs(a.center.x - c.center.x) - a.box.hw - c.box.hw, gapZ = Math.abs(a.center.z - c.center.z) - a.box.hd - c.box.hd;
  assert.ok(Math.max(gapX, gapZ) < 12, `gap ${gapX.toFixed(1)}/${gapZ.toFixed(1)}`);
  const o2 = computeOverview(nodes, m.roots, m.projects, o1, { view });
  assert.notEqual(o2.repackWhy, 'visible');
});

test('computeOverview: 세션만 숨기면 그 세션 트리만 hidden, 모든 세션을 숨긴 프로젝트는 섬 없음', () => {
  const { nodes, roots, projects } = scene();
  const o0 = computeOverview(nodes, roots, projects, null, { view });
  let v = toggleSession(emptyVis(), 'b2');
  let m = markVisibility(roots, projects, v);
  const o1 = computeOverview(nodes, m.roots, m.projects, o0, { view });
  assert.ok(o1.hidden.has('s:b2') && o1.hidden.has('a:b2:1'));
  assert.ok(!o1.hidden.has('s:b1'));
  assert.ok(o1.clusters.some((c) => c.projectId === 'B'));
  v = toggleSession(v, 'b1');
  m = markVisibility(roots, projects, v);
  const o2 = computeOverview(nodes, m.roots, m.projects, o1, { view });
  assert.ok(!o2.clusters.some((c) => c.projectId === 'B'));
});

test('computeCampus: 숨긴 프로젝트는 동 없음, 바뀌면 슬롯을 새로', () => {
  const { nodes, roots, projects } = scene();
  const c0 = computeCampus(nodes, roots, projects, null, { view });
  assert.deepEqual(c0.buildings.map((b) => b.projectId).sort(), ['A', 'B', 'C']);
  const m = markVisibility(roots, projects, toggleProject(emptyVis(), 'B', ['A', 'B', 'C']));
  const c1 = computeCampus(nodes, m.roots, m.projects, c0, { view });
  assert.deepEqual(c1.buildings.map((b) => b.projectId).sort(), ['A', 'C']);
  assert.ok(c1.hidden.has('s:b1'));
  const keys = new Set(c1.buildings.map((b) => b.slot.col + ',' + b.slot.row));
  assert.equal(keys.size, 2);
});
