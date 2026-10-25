// Planet 섬 = 원형 궤도계: 배치(round·항성·고리 단계)·원형 영역 판정·가장자리 원호 글씨 순수 시험
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOverview, tierRings } from '../overview/layout.mjs';
import { pickIslandAt, islandPickTol, projectAreaPad } from '../overview/pick-core.mjs';
import { arcNamePlate, arcStrip } from '../art-arc.mjs';
import { nodeExtent } from '../layout.js';

const T0 = Date.parse('2026-10-24T03:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
let ord = 0;
const N = (id, parentId, kind, extra = {}) => ({ id, parentId, kind, projectId: 'P', status: 'active', _order: ord++, startedAt: iso(T0), lastActivityAt: iso(T0), meta: {}, ...extra });
function world(n, k = 7) {
  ord = 0;
  const nodes = new Map(), roots = [], liveList = [];
  for (let i = 0; i < n; i++) {
    const sid = `L${i}`, mid = 's:' + sid;
    nodes.set(mid, N(mid, null, 'main', { sessionId: sid, rootSessionId: sid }));
    roots.push({ nodeId: mid, projectId: 'P' });
    liveList.push({ sessionId: sid, entrypoint: 'cli', liveStatus: 'busy', activityAt: iso(T0 + 3600_000 - i * 1000) });
    for (let c = 0; c < k; c++) nodes.set(`a:${sid}-${c}`, N(`a:${sid}-${c}`, mid, c % 4 === 3 ? 'bash-bg' : 'subagent', { rootSessionId: sid }));
  }
  return { nodes, roots, projects: [{ projectId: 'P', name: 'p', live: true, active: true, liveList }] };
}
const opts = (round) => ({ nowMs: T0 + 3600_000, round, islandMin: 0 });

test('tierRings: 가까운 거리끼리 묶은 단계, 최대 개수', () => {
  assert.deepEqual(tierRings([14, 14.5, 13.8, 22, 22.4, 30]), [14, 22.4, 30]);
  assert.deepEqual(tierRings([]), []);
  assert.deepEqual(tierRings([0, NaN, 5]), [5]);
  const many = tierRings([5, 10, 15, 20, 25, 30, 35, 40], 3, 5);
  assert.equal(many.length, 5);
  assert.equal(many[0], 5); assert.equal(many[4], 40);
});

test('round: 섬 중심 = live 메인(항성), 원 안에 모든 노드, 상자 = 외접 정사각형', () => {
  const w = world(1);
  const ov = computeOverview(w.nodes, w.roots, w.projects, null, opts(true));
  const c = ov.clusters[0];
  assert.ok(c.round > 0);
  assert.equal(c.box.hw, c.round); assert.equal(c.box.hd, c.round);
  assert.equal(c.r, c.round);
  const m = ov.pos.get('s:L0');
  assert.ok(Math.hypot(m.x - c.center.x, m.z - c.center.z) < 1e-6, '메인이 섬 중심');
  for (const [id, p] of ov.pos) assert.ok(Math.hypot(p.x - c.center.x, p.z - c.center.z) + nodeExtent(w.nodes.get(id)) <= c.round + 1e-6, id);
  assert.equal(c.stars.length, 1);
  assert.ok(c.stars[0].rings.length >= 1);
  // 고리 단계 = 실제 자식 거리(첫 고리 위에 자식이 놓임)
  const d = [...ov.pos].filter(([id]) => id !== 's:L0').map(([, p]) => Math.hypot(p.x - m.x, p.z - m.z));
  assert.ok(c.stars[0].rings.every((r) => d.some((x) => Math.abs(x - r) < 3)));
});

test('round 끄면 예전 상자 그대로(흐름·복셀 무변경)', () => {
  const w = world(1);
  const a = computeOverview(w.nodes, w.roots, w.projects, null, opts(false)).clusters[0];
  assert.ok(!a.round && !a.stars);
  assert.equal(a.r, Math.hypot(a.box.hw, a.box.hd));
});

test('round 다중 live 메인: 마주 보기(쌍성) — 공전 중심이 섬 중심, 항성 둘', () => {
  const w = world(2);
  const c = computeOverview(w.nodes, w.roots, w.projects, null, opts(true)).clusters[0];
  assert.equal(c.stars.length, 2);
  assert.ok(c.orbit && Math.abs(c.orbit.cx) < 1e-6 && Math.abs(c.orbit.cz) < 1e-6);
  for (const s of c.stars) assert.ok(Math.abs(Math.hypot(s.x, s.z) - c.orbit.r) < 1e-6);
});

test('§84 원형 판정: 원 안·둘레 허용 오차·영역 여유는 그 섬, 상자 모서리(원 밖)는 아님', () => {
  const C = { projectId: 'p', center: { x: 0, z: 0 }, r: 30, round: 30, box: { hw: 30, hd: 30 } };
  assert.equal(pickIslandAt([C], 0, 0), 'p');
  assert.equal(pickIslandAt([C], 29, 0), 'p');
  assert.equal(pickIslandAt([C], 0, -(30 + islandPickTol(30) - 0.1)), 'p');
  assert.equal(pickIslandAt([C], 28, 28), null, '정사각형 모서리는 원 밖');
  const pad = projectAreaPad(30, 30);
  assert.equal(pickIslandAt([C], 25, 25), null, '원 밖(허용 오차 밖)');
  assert.equal(pickIslandAt([C], 25, 25, pad), 'p', '§84 둘레 여유 안');
  assert.equal(pickIslandAt([C], 40, 40, pad), null, '밖 빈 곳');
  // 예전 슈퍼타원(round 없음)은 같은 점을 잡음(흐름 무변경)
  assert.equal(pickIslandAt([{ ...C, round: 0 }], 26, 26), 'p');
  assert.equal(pickIslandAt([C], 26, 26), null);
});

test('원호 글씨: 눈금 안쪽 띠, 넘치면 줄임, 띠는 먼 쪽(−z)·왼쪽 → 오른쪽·바깥이 글자 위', () => {
  const pl = arcNamePlate(40, 0.25, 1);
  assert.ok(pl.rc + pl.H / 2 <= 40 * 0.94 + 1e-9);
  assert.ok(pl.span <= (110 * Math.PI) / 180 + 1e-9);
  const long = arcNamePlate(20, 0.05, 1);
  assert.ok(long.span <= (110 * Math.PI) / 180 + 1e-9);
  assert.equal(arcNamePlate(0, 0.2), null);
  const A = arcStrip(pl.rc, pl.H, pl.span, 8);
  const P = (i, j) => { const o = (i * 2 + j) * 3; return [A.pos[o], A.pos[o + 1], A.pos[o + 2]]; };
  assert.ok(P(4, 0)[2] < 0, '가운데가 먼 쪽');
  assert.ok(P(0, 0)[0] < 0 && P(8, 0)[0] > 0, 'u 0 왼쪽 → 1 오른쪽');
  assert.ok(Math.hypot(P(4, 1)[0], P(4, 1)[2]) > Math.hypot(P(4, 0)[0], P(4, 0)[2]), 'v 1 = 바깥');
  const B = arcStrip(pl.rc, pl.H, pl.span, 8, Math.PI / 3);
  assert.ok(B.pos[(4 * 2 + 1) * 3 + 1] > 0, '세우면 위로');
  assert.equal(A.index.length, 8 * 6);
});
