// node --test "web/test/lab-claude-p.test.mjs"   복셀 연구소 claude -p 수리(11.02.).
// 사용자: "Voxel Lab 에서 claude -p 에이전트가 혼자 동떨어진 곳에서 허우적댄다. 자기가 띄운 서브에이전트하고 연결도 안 되어 있고."
// 운영 서버(7788) 실제 사례: 자율 루프 프로젝트의 분리 기동기(parentId 없음 · meta.spawnedBy = 메인) → 러너 → 회차 claude -p(link.by launcher) → 서브에이전트.
//   서버 부모 관계는 맞음(서브에이전트 parentId = claude -p). 원인은 연구소 쪽 셋:
//   ① claude -p 는 서브에이전트를 전경 Agent 로 띄워 하위가 끝날 때까지 Agent 도구가 열려 있는데, 연구소 'agent' 시설 = 출입문 옆 에어록 포털
//      (플랫폼 건너편 30m 남짓)이라 그동안 내내 포털 앞에서 두 팔을 든 agent 포즈(허우적) — 헤드리스: 자기 책상에서 37.8m.
//   ② 회차(op)·그 하위 책상은 모두 시퀀서 각을 선호해 하위가 회차와 떨어진 칸에 앉음(운영 사본: k2 ↔ k8).
//   ③ 의뢰서·보고 캡슐 몸짓(가리킴·받기)은 팀장만.  + 분리 기동기 사슬이 parentId 없이 끊겨 구역이 늘 0번(다중 메인이면 다른 구역).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAB, thetaOf, dTheta } from '../lab/lab-const.mjs';
import { computeLab } from '../lab/lab-layout-core.mjs';
import { labWalksToStation, LAB_DESK_CATS } from '../lab/lab-walk-core.mjs';
import { courierFor } from '../lab/lab-ix-core.mjs';
import { LabMockDriver, LAB_MOCK } from '../lab/lab-mock.mjs';
import { Character } from '../voxel/character-core.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 운영 사본 모양: 메인 M(+직원 둘) · [메인 N] · 분리 기동기 L(spawnedBy) → 러너 R → 회차 C(claude -p) → 서브에이전트 A. 끝난 회차 둘이 먼저 자리를 차지 */
function loopLike({ second = false, spawnedBy = 's:M' } = {}) {
  let o = 0;
  const n = (x) => ({ status: 'active', order: o++, ...x });
  const a = [n({ id: 's:M', kind: 'main' })];
  if (second) a.push(n({ id: 's:N', kind: 'main' }));
  a.push(n({ id: 'a:m1', kind: 'subagent', parentId: 's:M' }), n({ id: 'a:m2', kind: 'subagent', parentId: 's:M' }));
  a.push(n({ id: 'b:L', kind: 'bash-bg', parentId: null, meta: { detached: true, background: true, spawnedBy, launcher: { script: 'relaunch.sh' } } }));
  a.push(n({ id: 'b:L-r1', kind: 'bash-bg', parentId: 'b:L', meta: { background: true, runner: { script: 'autopilot.sh', instance: 1, launcher: 'b:L' } } }));
  const link = { by: 'launcher', confidence: 'medium' };
  a.push(n({ id: 's:c5', kind: 'claude-p', parentId: 'b:L-r1', status: 'done', meta: { cycle: 5, link } }));
  a.push(n({ id: 's:c6', kind: 'claude-p', parentId: 'b:L-r1', status: 'done', meta: { cycle: 6, link } }));
  a.push(n({ id: 's:c7', kind: 'claude-p', parentId: 'b:L-r1', meta: { cycle: 7, link } }));
  a.push(n({ id: 'a:k1', kind: 'subagent', parentId: 's:c5', status: 'done' }));
  a.push(n({ id: 'a:k2', kind: 'subagent', parentId: 's:c7' }));
  return a;
}
const deskTheta = (L, s) => thetaOf(L.rooms[0].lab.cx, L.rooms[0].lab.cz, s.deskX, s.deskZ);

test('1) 배치: 회차 claude -p 는 시퀀서 쪽 책상(op), 그 서브에이전트는 회차 곁 가장 가까운 빈 책상 · seat.parent = 회차', () => {
  const nodes = loopLike(), L = computeLab(nodes, 's:M', null);
  const c = L.seat.get('s:c7'), k = L.seat.get('a:k2');
  assert.ok(c && k, '둘 다 자리');
  assert.equal(c.kind, 'op'); assert.equal(k.kind, 'op');
  assert.equal(k.parent, 's:c7', '하위의 부모 = claude -p');
  const step = (LAB.DESK.ARC_GAP / Math.hypot(c.deskX - L.rooms[0].lab.cx, c.deskZ - L.rooms[0].lab.cz)) * (180 / Math.PI);
  const d = Math.abs(dTheta(deskTheta(L, c), deskTheta(L, k)));
  assert.ok(d <= step * 2.05, `곁 칸(${d.toFixed(1)}° ≤ 2 × ${step.toFixed(1)}° — 바로 옆은 끝난 회차가 차지)`);
  // 회차 책상 곁의 빈 칸 가운데 가장 가까운 칸(같은 열에 더 가까운 빈 칸 없음)
  const used = new Set([...L.seat.values()].filter((s) => s.row === 0 && s !== k).map((s) => s.k));
  for (const s of L.rooms[0].lab.deskSlots[0]) if (!used.has(s.k)) assert.ok(Math.abs(dTheta(deskTheta(L, c), s.theta)) >= d - 1e-6, `더 가까운 빈 칸 k${s.k}`);
  // 회차가 끝난 하위(a:k1 · 회차 c5 곁)도 같은 규칙
  const c5 = L.seat.get('s:c5'), k1 = L.seat.get('a:k1');
  assert.ok(Math.abs(dTheta(deskTheta(L, c5), deskTheta(L, k1))) <= step * 2.05, '끝난 회차의 하위도 회차 곁');
  // 운영 사본 순서(끝난 회차 c5·c6 다음 지금 회차 c7, 그 하위 하나): 예전(하위도 시퀀서 각)은 c7 k2 ↔ 하위 k8(3칸 너머) — 이제 바로 옆 칸
  const L2 = computeLab(loopLike().filter((n) => n.id !== 'a:k1'), 's:M', null);
  const c2 = L2.seat.get('s:c7'), k2 = L2.seat.get('a:k2');
  assert.ok(Math.abs(dTheta(deskTheta(L2, c2), deskTheta(L2, k2))) <= step * 1.05, `운영 사본 순서: 이웃 칸(c7 k${c2.k} ↔ 하위 k${k2.k})`);
});

test('1b) 자리 고정: 새 회차 claude -p·그 하위가 와도 이미 앉은 팀원(독립 claude -p 포함) 책상을 가져가지 않음', () => {
  let o = 0;
  const n = (x) => ({ status: 'active', order: o++, ...x });
  const base = [n({ id: 's:M', kind: 'main' }), n({ id: 'a:m1', kind: 'subagent', parentId: 's:M' }), n({ id: 's:p', kind: 'claude-p', parentId: 's:M' }), n({ id: 'a:m2', kind: 'subagent', parentId: 's:M' }), n({ id: 'a:p1', kind: 'subagent', parentId: 's:p' }),
    n({ id: 'a:m3', kind: 'subagent', parentId: 's:M' }), n({ id: 'a:m4', kind: 'subagent', parentId: 's:M' }), n({ id: 'a:m5', kind: 'subagent', parentId: 's:M' }),
    n({ id: 'b:L', kind: 'bash-bg', parentId: null, meta: { spawnedBy: 's:M', launcher: { script: 'relaunch.sh' } } }), n({ id: 'b:R', kind: 'bash-bg', parentId: 'b:L', meta: { runner: { launcher: 'b:L' } } })];
  const L0 = computeLab(base, 's:M', null);
  const more = [...base, n({ id: 's:c1', kind: 'claude-p', parentId: 'b:R', meta: { link: { by: 'launcher' } } }), n({ id: 'a:c1k', kind: 'subagent', parentId: 's:c1' })];
  const L1 = computeLab(more, 's:M', L0);
  for (const id of ['a:m1', 's:p', 'a:m2', 'a:p1', 'a:m3', 'a:m4', 'a:m5']) {
    const a = L0.seat.get(id), b = L1.seat.get(id);
    assert.deepEqual([b.kind, b.zone, b.row, b.k], [a.kind, a.zone, a.row, a.k], id + ' 자리 그대로');
  }
  assert.equal(L1.seat.get('s:c1').kind, 'op'); assert.equal(L1.seat.get('a:c1k').kind, 'op');
  const keys = [...L1.seat.values()].filter((s) => s.kind !== 'lead').map((s) => s.zone + ':' + s.row + ':' + s.k);
  assert.equal(new Set(keys).size, keys.length, '책상 겹침 0');
});

test('2) 분리 기동기(parentId 없음): meta.spawnedBy 메인 구역으로 — 회차·하위가 띄운 메인 구역 책상(다중 live 메인)', () => {
  for (const by of ['s:M', 's:N']) {
    const L = computeLab(loopLike({ second: true, spawnedBy: by }), 's:M', null);
    const z = L.seat.get(by).zone, c = L.seat.get('s:c7'), k = L.seat.get('a:k2'), seq = L.machine.get('b:L');
    assert.equal(c.zone, z, `회차 구역 = ${by} 구역`); assert.equal(k.zone, z);
    assert.equal(seq.type, 'batch'); assert.equal(seq.roomId, L.seat.get(by).roomId, '시퀀서도 띄운 메인 브리지 뒤');
  }
  // 고리(spawnedBy 가 자기 자신)·없는 id 는 0번 구역(멈춤 없음)
  const self = loopLike({ second: true, spawnedBy: 'b:L' }), L2 = computeLab(self, 's:M', null);
  assert.equal(L2.seat.get('s:c7').zone, 0);
  const L3 = computeLab(loopLike({ second: true, spawnedBy: 's:없음' }), 's:M', null);
  assert.equal(L3.seat.get('s:c7').zone, 0);
});

test('3) 연구소 시설 규칙: Agent·워크플로 도구는 포털로 걸어가지 않음(나머지 시설 도구는 그대로) · 3D·2D 갈고리는 연구소 방만', () => {
  assert.deepEqual([...LAB_DESK_CATS].sort(), ['agent', 'workflow']);
  for (const c of ['agent', 'workflow']) assert.equal(labWalksToStation(c), false, c);
  for (const c of ['skill', 'mcp', 'monitor', 'notify', 'artifact', 'web', 'shell', 'other']) assert.equal(labWalksToStation(c), true, c);
  for (const f of ['lab/lab-view.js', 'flat/lab2d.js']) {
    const src = readFileSync(path.join(WEB, f), 'utf8');
    assert.match(src, /_stationSpot\(ch, cat\) \{\n\s+if \(ch && ch\.room && ch\.room\.type === 'lab' && !labWalksToStation\(cat\)\) return null;\n\s+return super\._stationSpot\(ch, cat\);/, f);
  }
  // 복셀 오피스(바탕)는 takeStation — 11.02. 부터 Agent·워크플로 도구는 소환 창 안에서만(vx-summon.test)
  for (const f of ['voxel/office.js', 'flat/voxel2d.js']) assert.match(readFileSync(path.join(WEB, f), 'utf8'), /_stationSpot\(ch, cat\) \{ return SUMMON_CATS\.has\(cat\) && !summonAtPortal\(ch, this\._now\) \? null : takeStation\(this\.spots, ch, cat\); \}/, f);
});

/** 회차 claude -p 하나를 연구소에서 60초: 앉은 뒤 전경 Agent 를 열어 둠. lab = true 면 LabView 규칙(포털 null), false 면 예전(포털 자리) */
function cycleRun(lab) {
  const L = computeLab(loopLike(), 's:M', null), room = L.rooms[0], seat = L.seat.get('s:c7');
  const node = { id: 's:c7', kind: 'claude-p', status: 'active', meta: { link: { by: 'launcher' } } }, ch = new Character('s:c7', node, { lead: false });
  const portal = room.stations.agent[0];
  const ctx = { now: 0, dt: 1 / 30, ts: 1, room, seat, stationSpot: (c, cat) => (lab && !labWalksToStation(cat) ? null : portal), releaseStation: () => {} };
  const keys = [];
  let far = 0;
  const step = () => { ctx.now += ctx.dt; ch.update(ctx); const k = ch.target && ch.target.key; if (k && keys[keys.length - 1] !== k) keys.push(k); far = Math.max(far, Math.hypot(ch.pos.x - seat.x, ch.pos.z - seat.z)); };
  for (let i = 0; i < 30; i++) step();
  ch.addTool('tu-agent', 'agent', 'Agent', ctx.now);
  for (let i = 0; i < 30 * 60; i++) step();
  return { ch, far, keys, portalD: Math.hypot(portal.x - seat.x, portal.z - seat.z) };
}

test('4) 걷기: 전경 Agent 가 60초 열려 있어도 claude -p 는 자기 책상(이동 0 · 목표 한 번) — 예전 규칙이면 포털까지 30m 남짓 가서 서 있음', () => {
  const now = cycleRun(true);
  assert.ok(now.far < 0.05, `책상에서 ${now.far.toFixed(2)}m`);
  assert.equal(now.ch.state, 'work'); assert.equal(now.ch.target.type, 'desk'); assert.equal(now.ch.target.cat, 'agent'); assert.equal(now.ch.inPlace, true);
  assert.equal(now.keys.length, 1, '목표가 바뀌지 않음(진동 없음): ' + now.keys.join(' → '));
  const old = cycleRun(false); // 재현(복셀 오피스 규칙을 연구소 방에 그대로)
  assert.ok(old.portalD > 20, `포털은 책상에서 ${old.portalD.toFixed(1)}m`);
  assert.ok(old.far > 20 && old.ch.target.type === 'station', '예전: 포털 앞에 서 있음');
});

test('5) 의뢰서·보고 캡슐: claude -p 책상 ↔ 그 서브에이전트 책상, 몸짓(가리킴·받기)도 claude -p — 서브에이전트가 띄운 하위는 예전 그대로(몸짓 없음)', () => {
  const nodes = loopLike();
  nodes.push({ id: 'a:k3', kind: 'subagent', parentId: 'a:k2', status: 'active', order: 99 });
  const L = computeLab(nodes, 's:M', null), byId = new Map(nodes.map((n) => [n.id, n]));
  const ctx = { layout: L, nodeOf: (id) => byId.get(id) || null };
  const c = L.seat.get('s:c7'), k = L.seat.get('a:k2');
  const d = courierFor({ type: 'node-add', node: byId.get('a:k2') }, ctx);
  assert.equal(d.kind, 'dispatch');
  assert.ok(Math.abs(d.from.x - c.deskX) < 1e-9 && Math.abs(d.from.z - c.deskZ) < 1e-9, 'claude -p 책상에서');
  assert.ok(Math.abs(d.to.x - k.deskX) < 1e-9 && Math.abs(d.to.z - k.deskZ) < 1e-9, '하위 책상으로');
  assert.equal(d.gesture, 'dispatch'); assert.equal(d.lead, 's:c7');
  const r = courierFor({ type: 'node-update', node: byId.get('a:k2'), patch: { status: 'done' } }, ctx);
  assert.equal(r.kind, 'report'); assert.equal(r.gesture, 'receive'); assert.equal(r.lead, 's:c7'); assert.equal(r.arrive, 's:c7');
  const g = courierFor({ type: 'node-add', node: byId.get('a:k3') }, ctx);
  assert.equal(g.kind, 'dispatch'); assert.equal(g.gesture, null); assert.equal(g.lead, null);
});

test('6) mock M11(labmock=11): 분리 기동기 → 러너 → 회차 claude -p · 독립 claude -p, 전경 Agent 는 하위가 끝난 뒤에 닫힘 · 배치 = 하위가 띄운 쪽 곁', () => {
  assert.equal(LAB_MOCK[10].id, 'claude-p');
  const nodes = new Map([['s:m', { id: 's:m', kind: 'main', status: 'active', order: 0 }]]);
  const evs = [], q = [];
  let T = 0, ord = 1;
  const d = new LabMockDriver({ nodes: () => nodes.values(), emit: (e) => {
    evs.push({ ...e, T });
    if (e.type === 'node-add') nodes.set(e.nodeId, { ...e.node, order: ord++ });
    if (e.type === 'node-update' && nodes.has(e.nodeId)) Object.assign(nodes.get(e.nodeId), e.patch);
  }, scenario: 11, first: 0 });
  d._at = (ms, fn) => q.push([T + ms, fn]);
  d.on = true; d._run();
  let snap = null;
  while (q.length && T < 30000) {
    q.sort((a, b) => a[0] - b[0]);
    const [t, fn] = q.shift();
    T = t; fn();
    if (!snap && T > 6000) snap = [...nodes.values()].map((n) => ({ ...n }));
  }
  d.stop();
  const L0 = evs.find((e) => e.type === 'node-add' && e.node.meta && e.node.meta.launcher);
  assert.ok(L0 && L0.node.parentId === null && L0.node.meta.spawnedBy === 's:m', '분리 기동기');
  const R0 = evs.find((e) => e.type === 'node-add' && e.node.meta && e.node.meta.runner);
  assert.equal(R0.node.parentId, L0.nodeId);
  const C1 = evs.find((e) => e.type === 'node-add' && e.node.kind === 'claude-p' && e.node.parentId === R0.nodeId);
  assert.equal(C1.node.meta.link.by, 'launcher');
  const P = evs.find((e) => e.type === 'node-add' && e.node.kind === 'claude-p' && e.node.parentId === 's:m');
  assert.ok(P, '메인이 띄운 독립 claude -p');
  for (const pid of [C1.nodeId, P.nodeId]) {
    const st = evs.find((e) => e.type === 'tool-start' && e.nodeId === pid && e.tool === 'Agent');
    const kid = evs.find((e) => e.type === 'node-add' && e.node.parentId === pid && e.node.kind === 'subagent');
    const kidEnd = evs.find((e) => e.type === 'node-update' && e.nodeId === kid.nodeId && e.patch.status === 'done');
    const en = evs.find((e) => e.type === 'tool-end' && e.nodeId === pid && e.toolUseId === st.toolUseId);
    assert.ok(st && kid && kidEnd && en, pid);
    assert.ok(en.T >= kidEnd.T && en.T - st.T >= 10000, `${pid}: 전경 Agent 가 하위 끝까지 열림(${en.T - st.T}ms)`);
  }
  // 6초 시점 장면을 연구소 배치로: 회차·독립 claude -p 모두 책상, 각 하위는 그 곁
  const L = computeLab(snap.filter((n) => n.status === 'active'), 's:m', null);
  for (const pid of [C1.nodeId, P.nodeId]) {
    const kid = snap.find((n) => n.parentId === pid && n.kind === 'subagent');
    const s = L.seat.get(pid), k = L.seat.get(kid.id);
    assert.ok(s && k && s.kind !== 'lead', pid + ' 책상');
    assert.equal(k.parent, pid);
    const r = Math.hypot(s.deskX - L.rooms[0].lab.cx, s.deskZ - L.rooms[0].lab.cz), step = (LAB.DESK.ARC_GAP / r) * (180 / Math.PI);
    assert.ok(Math.abs(dTheta(deskTheta(L, s), deskTheta(L, k))) <= step * 1.05, pid + ' 하위가 곁 칸');
  }
});
