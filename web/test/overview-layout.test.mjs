// 전체 보기 배치 순수 함수 시험. 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOverview, assignRoots, CLUSTER_GAP, MAIN_GAP } from '../overview/layout.mjs';
import { computeLayout, nodeExtent } from '../layout.js';

let ord = 0;
const N = (id, parentId, kind, projectId, extra = {}) => ({ id, parentId, kind, projectId, status: 'active', _order: ord++, lastActivityAt: '2026-10-23T05:00:00Z', meta: {}, ...extra });

/** 프로젝트 p 개, 프로젝트마다 메인 m 개, 메인마다 자식 k 개 */
function world(p = 3, m = [2, 1, 1], k = 6) {
  ord = 0;
  const nodes = new Map();
  const roots = [];
  const projects = [];
  for (let i = 0; i < p; i++) {
    const pid = 'proj-' + i;
    projects.push({ projectId: pid, name: 'P' + i, live: true, active: i === 0, temp: false });
    const mc = Array.isArray(m) ? (m[i] ?? 1) : m;
    for (let j = 0; j < mc; j++) {
      const mid = `s:${pid}-m${j}`;
      nodes.set(mid, N(mid, null, 'main', pid, { sessionId: `${pid}-m${j}` }));
      roots.push({ nodeId: mid, projectId: pid, sessionId: `${pid}-m${j}` });
      for (let c = 0; c < k; c++) {
        const kind = c % 5 === 3 ? 'bash-bg' : c % 7 === 4 ? 'workflow' : 'subagent';
        const id = `a:${pid}-m${j}-${c}`;
        const parent = c > 3 && c % 2 ? `a:${pid}-m${j}-${c - 2}` : mid;
        nodes.set(id, N(id, parent, kind, pid));
      }
    }
  }
  return { nodes, roots, projects };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('결정적: 같은 입력 → 같은 결과', () => {
  const w = world();
  const a = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: 0 });
  const b = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: 0 });
  assert.deepEqual(a.clusters, b.clusters);
  assert.deepEqual([...a.pos], [...b.pos]);
  assert.equal(a.pos.size, w.nodes.size, '모든 노드에 자리');
});

const boxApart = (A, B, gap = 0) => Math.abs(A.center.x - B.center.x) >= A.box.hw + B.box.hw + gap - 1e-6 || Math.abs(A.center.z - B.center.z) >= A.box.hd + B.box.hd + gap - 1e-6;

test('섬 경계 상자끼리 겹치지 않음(간격 CLUSTER_GAP, §66.6)', () => {
  const w = world(8, [3, 1, 2, 1, 1, 2, 1, 1], 10);
  const r = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: 0 });
  assert.equal(r.clusters.length, 8);
  for (let i = 0; i < r.clusters.length; i++) for (let j = i + 1; j < r.clusters.length; j++) {
    const A = r.clusters[i], B = r.clusters[j];
    assert.ok(boxApart(A, B, CLUSTER_GAP), `${A.projectId}·${B.projectId} 겹침`);
    assert.ok(Math.abs(A.r - Math.hypot(A.box.hw, A.box.hd)) < 1e-9, 'r = 상자 외접원');
  }
});

test('같은 섬 서로 다른 루트의 노드끼리 겹침 0, 서브트리는 자기 섬 상자 안', () => {
  const w = world(2, [3, 2], 12);
  const r = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: 0 });
  const ids = [...r.pos.keys()];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (r.rootOf.get(ids[i]) === r.rootOf.get(ids[j])) continue;
    const a = r.pos.get(ids[i]), b = r.pos.get(ids[j]);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= nodeExtent(w.nodes.get(ids[i])) + nodeExtent(w.nodes.get(ids[j])) - 1e-6, `${ids[i]}·${ids[j]}`);
  }
  for (const c of r.clusters) {
    for (const [id, p] of r.pos) {
      if (r.projectOf.get(id) !== c.projectId) continue;
      assert.ok(Math.abs(p.x - c.center.x) <= c.box.hw + 1e-6 && Math.abs(p.z - c.center.z) <= c.box.hd + 1e-6, `${id} 가 섬 밖`);
    }
  }
});

test('메인 하나면 지역 좌표 = computeLayout(오프셋만 다름)', () => {
  const w = world(1, [1], 9);
  const r = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: 0 });
  const base = computeLayout(w.nodes, 's:proj-0-m0');
  const c = r.clusters[0];
  for (const [id, p] of base.pos) {
    const q = r.pos.get(id);
    assert.ok(Math.abs(q.x - c.center.x - c.mains[0].origin.x - p.x) < 1e-9);
    assert.ok(Math.abs(q.z - c.center.z - c.mains[0].origin.z - p.z) < 1e-9);
    assert.equal(q.y, p.y);
  }
});

test('촘촘한 줄 배치(§63): 가로 화면이면 한 줄·세로면 여러 줄, 이웃 간격 최소', () => {
  const w = world(4, [1, 1, 1, 1], 4);
  const a = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: 0, aspect: 3 });
  assert.ok(new Set(a.clusters.map((c) => c.center.z)).size === 1, '가로 화면 → 한 줄');
  const row = a.clusters.slice().sort((p, q) => p.center.x - q.center.x);
  for (let i = 1; i < row.length; i++) assert.ok(Math.abs((row[i].center.x - row[i - 1].center.x) - (row[i].box.hw + row[i - 1].box.hw + CLUSTER_GAP)) < 1e-6);
  const t = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: 0, aspect: 0.45 });
  assert.ok(new Set(t.clusters.map((c) => c.center.z)).size > 1);
});

test('섬 자리 안정화(§66.7): 새 섬이 생겨도 기존 섬은 제자리·새 섬만 빈자리, 크기 변화가 작으면 그대로, 크면 다시 줄 배치', () => {
  const w = world(4, [1, 1, 1, 1], 4);
  const a = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: 0, aspect: 1.6 });
  w.nodes.set('s:proj-9-m0', N('s:proj-9-m0', null, 'main', 'proj-9'));
  w.roots.push({ nodeId: 's:proj-9-m0', projectId: 'proj-9' });
  w.projects.push({ projectId: 'proj-9', name: 'P9', live: true, active: true });
  const b = computeOverview(w.nodes, w.roots, w.projects, a, { nowMs: 0, aspect: 1.6 });
  for (const c of a.clusters) assert.deepEqual(b.clusters.find((x) => x.projectId === c.projectId).center, c.center, `${c.projectId} 제자리`);
  for (const c of b.clusters) for (const d of b.clusters) if (c !== d) assert.ok(boxApart(c, d, CLUSTER_GAP), `${c.projectId}·${d.projectId}`);
  // 작은 성장(자식 하나): 그대로
  const first = a.clusters[0].projectId;
  w.nodes.set('a:grow-1', N('a:grow-1', `s:${first}-m0`, 'subagent', first));
  const c1 = computeOverview(w.nodes, w.roots, w.projects, b, { nowMs: 0, aspect: 1.6 });
  for (const c of b.clusters) assert.ok(dist(c1.clusters.find((x) => x.projectId === c.projectId).center, c.center) <= 2, `${c.projectId} 거의 제자리`);
  for (const c of c1.clusters) for (const d of c1.clusters) if (c !== d) assert.ok(boxApart(c, d, CLUSTER_GAP));
  // 큰 성장: 다시 배치해도 겹침 없음
  for (let i = 0; i < 40; i++) w.nodes.set('a:grow' + i, N('a:grow' + i, `s:${first}-m0`, 'subagent', first));
  const c2 = computeOverview(w.nodes, w.roots, w.projects, c1, { nowMs: 0, aspect: 1.6 });
  for (const c of c2.clusters) for (const d of c2.clusters) if (c !== d) assert.ok(boxApart(c, d, CLUSTER_GAP));
  // 섬 하나가 사라짐: 나머지는 제자리(구멍이 지나치지 않으면)
  const w2 = world(4, [1, 1, 1, 1], 4);
  const p0 = computeOverview(w2.nodes, w2.roots, w2.projects, null, { nowMs: 0, aspect: 1.6 });
  const gone = p0.clusters[p0.clusters.length - 1].projectId;
  for (const [id, n] of [...w2.nodes]) if (n.projectId === gone) w2.nodes.delete(id);
  const p1 = computeOverview(w2.nodes, w2.roots.filter((r) => r.projectId !== gone), w2.projects.filter((p) => p.projectId !== gone), p0, { nowMs: 0, aspect: 1.6 });
  for (const c of p1.clusters) assert.deepEqual(c.center, p0.clusters.find((x) => x.projectId === c.projectId).center);
});

test('recent 루트: showInactive=false 면 숨김 + 섬만, true 면 배치', () => {
  const w = world(2, [1, 1], 3);
  const rid = 's:proj-1-m0';
  w.nodes.get(rid).meta = { tier: 'recent', live: false };
  w.projects[1].live = false; w.projects[1].active = false;
  const a = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: 0 });
  assert.ok(a.hidden.has(rid) && a.hidden.has('a:proj-1-m0-0'));
  const c1 = a.clusters.find((c) => c.projectId === 'proj-1');
  assert.equal(c1.inactive, true);
  assert.equal(c1.mains.length, 0);
  assert.equal(c1.hiddenMains, 1);
  const b = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: 0, showInactive: true });
  assert.equal(b.hidden.size, 0);
  assert.equal(b.clusters.find((c) => c.projectId === 'proj-1').mains.length, 1);
});

test('루트 없는 recent 프로젝트는 바깥 고리 작은 섬, temp 는 루트가 있을 때만', () => {
  const w = world(2, [1, 1], 3);
  const now = Date.parse('2026-10-23T06:00:00Z');
  w.projects.push({ projectId: 'proj-old', name: 'old', live: false, recentList: [{ sessionId: 'x', activityAt: '2026-10-23T05:30:00Z' }] });
  w.projects.push({ projectId: 'proj-tmp', name: '(임시) a', live: true, temp: true });
  const r = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: now });
  const old = r.clusters.find((c) => c.projectId === 'proj-old');
  assert.ok(old && old.inactive && old.r === 6);
  assert.ok(!r.clusters.find((c) => c.projectId === 'proj-tmp'), 'temp 루트 없음 → 섬 없음');
  for (const c of r.clusters) if (!c.inactive) assert.ok(Math.hypot(old.center.x, old.center.z) > Math.hypot(c.center.x, c.center.z));
});

test('roots 가 비어도 부모 없는 노드를 루트로 보충, claude -p 자식은 부모 클러스터', () => {
  ord = 0;
  const nodes = new Map([
    ['s:m1', N('s:m1', null, 'main', 'A')],
    ['a:1', N('a:1', 's:m1', 'subagent', 'A')],
    ['s:c1', N('s:c1', 'a:1', 'claude-p', 'TMP')], // 임시 폴더 cwd 여도 부모 쪽
    ['s:m2', N('s:m2', null, 'main', 'B')],
  ]);
  const ar = assignRoots(nodes, []);
  assert.deepEqual(ar.roots.map((r) => r.nodeId), ['s:m1', 's:m2']);
  assert.equal(ar.rootOf.get('s:c1'), 's:m1');
  const r = computeOverview(nodes, [], [], null, { nowMs: 0 });
  assert.equal(r.projectOf.get('s:c1'), 'A');
});

test('성능: 프로젝트 12 · 노드 600 < 15ms', () => {
  const w = world(12, 2, 24); // 12×2×(1+24) = 600
  assert.equal(w.nodes.size, 600);
  computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: 0 }); // 예열
  // 여러 시험 파일이 동시에 돌아 CPU 를 다투면 평균이 튄다(예전 간헐 실패). 묶음 5개 중 가장 빠른 묶음의 평균으로 잰다
  let ms = Infinity;
  for (let b = 0; b < 5; b++) {
    const t0 = performance.now();
    let prev = null;
    for (let i = 0; i < 10; i++) prev = computeOverview(w.nodes, w.roots, w.projects, prev, { nowMs: 0 });
    ms = Math.min(ms, (performance.now() - t0) / 10);
  }
  assert.ok(ms < 15, `평균 ${ms.toFixed(2)}ms`);
});
