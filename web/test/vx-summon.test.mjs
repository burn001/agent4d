// node --test "web/test/vx-summon.test.mjs"   복셀 오피스 소환 창(11.02.).
// 사용자 지적: "(자율 실행 루프 프로젝트의) claude -p 에이전트가 사무실 앞 왼쪽 소환 포털 앞에 계속 서 있다."
// claude -p·메인·서브에이전트는 전경 Agent·Workflow 도구를 하위가 끝날 때까지 연 채 기다린다(수 분～수십 분). 예전 복셀 오피스는
// 그 도구가 열린 내내 포털 앞에서 두 팔을 뻗고 서 있었다 → 이제 소환 순간(도구 시작 → 새 하위가 포털에서 나오는 1.4초 창)에만 포털, 그 뒤 책상.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeOffice } from '../voxel/layout.js';
import { SUMMON, SUMMON_CATS, summonAtPortal, noteSummon } from '../voxel/office-core.mjs';
import { SpotBook, takeStation, releaseSpot } from '../voxel/crowd-core.mjs';
import { Character } from '../voxel/character-core.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 메인 m(+직원 둘) · 메인이 띄운 독립 claude -p p(별관 팀장) · 그 서브에이전트 하나 */
function scene() {
  const nodes = [
    { id: 'm', kind: 'main', status: 'active', order: 0 },
    { id: 'a1', kind: 'subagent', parentId: 'm', status: 'active', order: 1 },
    { id: 'a2', kind: 'subagent', parentId: 'm', status: 'active', order: 2 },
    { id: 'p', kind: 'claude-p', parentId: 'm', status: 'active', order: 3 },
    { id: 'pk', kind: 'subagent', parentId: 'p', status: 'active', order: 4 },
  ];
  return { nodes, lay: computeOffice(nodes, 'm') };
}

/**
 * id 한 사람을 sec 초 동안 돌린다(office.js _frame 의 상태 머신 부분과 같은 갈고리). 1초 뒤 Agent(또는 workflow) 도구를 열고,
 * spawnAfter 초 뒤 하위가 나타남(noteSummon — office _spawnPoint 와 같음). 반환: 포털 체류 초·마지막 위치의 책상 거리·목표 열
 */
function run(id, { sec = 120, cat = 'agent', spawnAfter = 0.5, old = false, extraSpawns = [], lead } = {}) {
  const { nodes, lay } = scene();
  const seat = lay.seat.get(id), room = lay.rooms.find((r) => r.id === seat.roomId);
  assert.ok(room && room.portal && room.stations[cat === 'workflow' ? 'workflow' : 'agent'], id + ' 방에 포털');
  const node = nodes.find((n) => n.id === id);
  const ch = new Character(id, node, { lead: lead != null ? lead : seat.kind === 'lead' });
  const book = new SpotBook();
  const ctx = { now: 0, dt: 1 / 30, ts: 1, room, seat,
    stationSpot: (c, k) => (SUMMON_CATS.has(k) && !summonAtPortal(c, ctx.now) ? null : takeStation(book, c, k)),
    releaseStation: (c) => releaseSpot(book, c) };
  const portal = room.portal;
  let tOpen = null, atPortal = 0, firstPortalT = null, lastPortalT = null, maxPortalD = Infinity;
  const keys = [];
  const spawns = [spawnAfter, ...extraSpawns].filter((x) => x != null).sort((a, b) => a - b);
  const steps = Math.round(sec / ctx.dt);
  for (let i = 0; i < steps; i++) {
    ctx.now += ctx.dt;
    if (tOpen == null && ctx.now >= 1) { tOpen = ctx.now; ch.addTool('tu', cat, cat === 'agent' ? 'Agent' : 'Workflow', ctx.now, old); }
    while (tOpen != null && spawns.length && ctx.now >= tOpen + spawns[0]) { spawns.shift(); noteSummon(ch, ctx.now); }
    ch.update(ctx);
    const k = ch.target && ch.target.key;
    if (k && keys[keys.length - 1] !== k) keys.push(k);
    const dP = Math.hypot(ch.pos.x - portal.x, ch.pos.z - portal.z);
    maxPortalD = Math.min(maxPortalD, dP);
    if (ch.state === 'work' && ch.target && ch.target.type === 'station' && SUMMON_CATS.has(ch.target.cat)) {
      atPortal += ctx.dt;
      if (firstPortalT == null) firstPortalT = ctx.now - tOpen;
      lastPortalT = ctx.now - tOpen;
    }
  }
  return { ch, seat, atPortal, firstPortalT, lastPortalT, nearPortal: maxPortalD, deskD: Math.hypot(ch.pos.x - seat.x, ch.pos.z - seat.z), keys, portalDesk: Math.hypot(portal.x - seat.x, portal.z - seat.z) };
}

test('1) 소환 창(순수): 도구 시작 → 포털 · 하위 등장 뒤 HOLD/STAY · WAIT·MAX 상한 · 스냅샷(old) 도구는 책상', () => {
  const ch = (tools, x = {}) => ({ tools, summonAt: null, target: null, state: 'seated', arrivedAt: 0, ...x });
  const ag = (t0, extra = {}) => ({ id: 't', cat: 'agent', t0, end: null, ...extra });
  assert.equal(summonAtPortal(ch([]), 10), false, '도구 없음');
  assert.equal(summonAtPortal(ch([{ id: 'r', cat: 'read', t0: 10, end: null }]), 10.1), false, '다른 도구');
  assert.equal(summonAtPortal(ch([ag(10)]), 10.1), true, '막 연 Agent → 포털로');
  assert.equal(summonAtPortal(ch([{ ...ag(10), cat: 'workflow' }]), 10.1), true, '워크플로도');
  assert.equal(summonAtPortal(ch([ag(10)]), 10 + SUMMON.WAIT - 0.01), true, '하위 아직 → WAIT 동안 기다림');
  assert.equal(summonAtPortal(ch([ag(10)]), 10 + SUMMON.WAIT + 0.01), false, 'WAIT 넘으면 책상');
  assert.equal(summonAtPortal(ch([ag(10)], { target: { type: 'station', cat: 'agent' }, state: 'walk' }), 10 + SUMMON.WAIT + 1), true, '먼 포털로 걷는 중이면 WAIT 넘어도 끝까지(돌아서지 않음)');
  assert.equal(summonAtPortal(ch([ag(10)], { target: { type: 'station', cat: 'agent' }, state: 'work', arrivedAt: 16 }), 16 + SUMMON.STAY - 0.01), true, '닿으면 STAY 만큼 팔 뻗기');
  assert.equal(summonAtPortal(ch([ag(10)], { target: { type: 'station', cat: 'agent' }, state: 'work', arrivedAt: 16 }), 16 + SUMMON.STAY + 0.01), false);
  assert.equal(summonAtPortal(ch([ag(10, { old: true })]), 10.1), false, '스냅샷·따라잡기 도구(old) — 시작 순간이 아님');
  assert.equal(summonAtPortal(ch([ag(10, { end: 10.5 })]), 10.6), false, '끝난 도구');
  // 하위 등장 뒤
  const walk = { target: { type: 'station', cat: 'agent' }, state: 'walk' };
  assert.equal(summonAtPortal(ch([ag(10)], { summonAt: 10.3, ...walk }), 13), true, '걷는 중에 하위가 나와도 포털까지 들렀다');
  const at = { target: { type: 'station', cat: 'agent' }, state: 'work', arrivedAt: 11 };
  assert.equal(summonAtPortal(ch([ag(10)], { summonAt: 11.5, ...at }), 11.5 + SUMMON.HOLD - 0.01), true, '나온 뒤 HOLD 동안 포털');
  assert.equal(summonAtPortal(ch([ag(10)], { summonAt: 11.5, ...at }), 11.5 + SUMMON.HOLD + 0.01), false, 'HOLD 뒤 책상');
  const late = { target: { type: 'station', cat: 'agent' }, state: 'work', arrivedAt: 13 };
  assert.equal(summonAtPortal(ch([ag(10)], { summonAt: 10.3, ...late }), 13 + SUMMON.STAY - 0.01), true, '먼저 나왔으면 도착 뒤 STAY 만');
  assert.equal(summonAtPortal(ch([ag(10)], { summonAt: 10.3, ...late }), 13 + SUMMON.STAY + 0.01), false);
  assert.equal(summonAtPortal(ch([ag(10)], { summonAt: 10.3, ...walk }), 10 + SUMMON.MAX + 0.01), false, 'MAX 상한(걷는 중이어도)');
  // 책상에 돌아온 뒤 WAIT 넘어 나온 하위(워크플로가 나중에 띄움)는 다시 부르지 않음
  assert.equal(summonAtPortal(ch([ag(10)], { summonAt: 10 + SUMMON.WAIT + 0.5, target: { type: 'desk' }, state: 'work' }), 10 + SUMMON.WAIT + 0.6), false);
  // 같은 프레임 등장(책상에서 막 연 순간 하위도 나옴) → 잠깐 들름
  assert.equal(summonAtPortal(ch([ag(10)], { summonAt: 10, target: { type: 'desk' } }), 10.05), true);
  // 새 Agent 를 또 열면 새 소환(가장 최근 t0 기준)
  assert.equal(summonAtPortal(ch([ag(10), { id: 'u', cat: 'agent', t0: 60, end: null }], { summonAt: 10.3 }), 60.1), true);
  // noteSummon: Agent·워크플로 도구가 열려 있을 때만 적음
  const p = ch([ag(10)]); noteSummon(p, 10.4); assert.equal(p.summonAt, 10.4);
  const q = ch([{ id: 'r', cat: 'read', t0: 10, end: null }]); noteSummon(q, 10.4); assert.equal(q.summonAt, null);
  noteSummon(null, 1); noteSummon(undefined, 1); // 부모 없음 — 멈춤 없음
  assert.ok(SUMMON.HOLD === 1.4 && SUMMON.MAX <= 10 && SUMMON.WAIT < SUMMON.MAX);
});

test('2) Agent 도구 120초 열림: 메인·서브에이전트·claude -p 모두 소환 직후 책상으로 — 포털 체류 상한·끝에 책상', () => {
  for (const id of ['m', 'a1', 'p', 'pk']) {
    const r = run(id);
    assert.ok(r.portalDesk > 3, `${id}: 포털은 책상에서 ${r.portalDesk.toFixed(1)}m`);
    assert.ok(r.nearPortal < 2.5, `${id}: 소환 순간에는 포털에 감(가장 가까이 ${r.nearPortal.toFixed(2)}m)`);
    assert.ok(r.atPortal > 0 && r.atPortal <= Math.max(SUMMON.HOLD, SUMMON.STAY) + 0.1, `${id}: 포털에 선 시간 ${r.atPortal.toFixed(2)}초 ≤ ${Math.max(SUMMON.HOLD, SUMMON.STAY)}`);
    assert.ok(r.lastPortalT <= SUMMON.MAX, `${id}: 포털 체류는 도구 시작 뒤 ${r.lastPortalT.toFixed(1)}초 안에 끝`);
    assert.ok(r.deskD < 0.05, `${id}: 끝에 책상(${r.deskD.toFixed(2)}m)`);
    assert.equal(r.ch.state, 'work'); assert.equal(r.ch.target.type, 'desk'); assert.equal(r.ch.target.cat, 'agent'); assert.equal(r.ch.inPlace, true);
    // 책상 → 포털 → 책상 한 번(진동 없음)
    assert.equal(r.keys.filter((k) => k.startsWith('st:')).length, 1, `${id}: ${r.keys.join(' → ')}`);
  }
});

test('3) 하위가 늦게(포털에서 기다리는 중) 나오면 나온 뒤 HOLD 지키고 책상 · 끝내 안 나오면 WAIT 뒤 책상', () => {
  const r = run('a1', { spawnAfter: 3.5 });
  assert.ok(r.lastPortalT >= 3.5 + SUMMON.HOLD - 0.1 && r.lastPortalT <= 3.5 + SUMMON.HOLD + 0.1, `나온 뒤 HOLD(${r.lastPortalT.toFixed(2)})`);
  assert.ok(r.deskD < 0.05);
  for (const id of ['a1', 'm']) { // 하위 없음(다른 방에서 나옴 등): 가까운 포털은 WAIT 까지, 먼 포털(팀장 17m)은 닿은 뒤 STAY 만 — 모두 MAX 안
    const n = run(id, { spawnAfter: null });
    assert.ok(n.lastPortalT != null && n.lastPortalT <= SUMMON.MAX, `${id} 하위 없음: ${n.lastPortalT && n.lastPortalT.toFixed(2)}초`);
    assert.ok(n.lastPortalT <= SUMMON.WAIT + 0.05 || n.atPortal <= SUMMON.STAY + 0.05, id);
    assert.ok(n.deskD < 0.05);
  }
});

test('4) 워크플로가 나중에 하위를 계속 띄워도(30초마다) 다시 포털로 불려 가지 않음 · 워크플로 도구도 같은 규칙', () => {
  const r = run('m', { cat: 'workflow', extraSpawns: [30, 60, 90] });
  assert.equal(r.keys.filter((k) => k.startsWith('st:')).length, 1, r.keys.join(' → '));
  assert.ok(r.atPortal <= Math.max(SUMMON.HOLD, SUMMON.STAY) + 0.1 && r.deskD < 0.05);
});

test('5) 스냅샷·seek 로 이미 열려 있던 Agent(old) — 처음부터 책상, 포털에 가지 않음', () => {
  const r = run('p', { old: true });
  assert.equal(r.atPortal, 0); assert.equal(r.keys.length, 1, r.keys.join(' → ')); assert.ok(r.deskD < 0.05);
});

test('6) 예전 규칙 재현: 소환 창 없이 takeStation 이면 120초 내내 포털(회귀 확인용)', () => {
  const { nodes, lay } = scene();
  const seat = lay.seat.get('p'), room = lay.rooms.find((r) => r.id === seat.roomId);
  const ch = new Character('p', nodes[3], { lead: true }), book = new SpotBook();
  const ctx = { now: 0, dt: 1 / 30, ts: 1, room, seat, stationSpot: (c, k) => takeStation(book, c, k), releaseStation: (c) => releaseSpot(book, c) };
  let at = 0;
  for (let i = 0; i < 30 * 120; i++) { ctx.now += ctx.dt; if (i === 30) ch.addTool('tu', 'agent', 'Agent', ctx.now); ch.update(ctx); if (ch.state === 'work' && ch.target.type === 'station') at += ctx.dt; }
  assert.ok(at > 100, `예전: 포털 ${at.toFixed(0)}초`);
});

test('7) 갈고리: 3D office·2D voxel2d _spawnPoint 가 noteSummon · 스냅샷/quiet 도구는 old · 연구소(LabView·Lab2DView)는 그대로 책상 먼저', () => {
  for (const f of ['voxel/office.js', 'flat/voxel2d.js']) {
    const src = readFileSync(path.join(WEB, f), 'utf8');
    assert.match(src, /const p = this\.chars\.get\(n\.parentId\);\r?\n\s+noteSummon\(p, this\._now\);/, f + ' noteSummon');
    assert.match(src, /_stationSpot\(ch, cat\) \{ return SUMMON_CATS\.has\(cat\) && !summonAtPortal\(ch, this\._now\) \? null : takeStation\(this\.spots, ch, cat\); \}/, f);
    assert.match(src, /ch\.addTool\(t\.toolUseId, t\.cat, t\.tool, now - 1, true\)/, f + ' 스냅샷 old');
    assert.match(src, /ev\.tool, (?:this\._)?now, quiet\)/, f + ' quiet old');
  }
  for (const f of ['lab/lab-view.js', 'flat/lab2d.js']) {
    const src = readFileSync(path.join(WEB, f), 'utf8');
    assert.match(src, /if \(ch && ch\.room && ch\.room\.type === 'lab' && !labWalksToStation\(cat\)\) return null;\r?\n\s+return super\._stationSpot\(ch, cat\);/, f);
  }
});
