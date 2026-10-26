// 기동기·배치 장치·재무장 Monitor·추정 소속 순수 규칙 시험. 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchFold, deviceInfo, deviceSummary, bandCode, bandDecode, nodeTags, rearmStandby, orphanPlan, isGuessLink, cycleProgress, BATCH } from '../batch-core.mjs';
import { computeOffice, BATCH_SPOTS, DESK_Z0 } from '../voxel/layout.js';
import { computeCampus } from '../voxel/campus.mjs';
import { computeOverview, assignRoots } from '../overview/layout.mjs';
import { MockGenerator } from '../mock.js';
import { createOverviewMock } from '../overview/mock.js';

let ord = 0;
const T = (min) => new Date(Date.parse('2026-10-23T14:00:00Z') + min * 60000).toISOString();
const N = (id, parentId, kind, extra = {}) => ({ id, parentId, kind, status: 'active', order: ord++, _order: ord, startedAt: T(ord), lastActivityAt: T(ord), meta: {}, ...extra });
const mapOf = (list) => new Map(list.map((n) => [n.id, n]));

/** 메인 → 서브에이전트 → 기동기 → 회차 6(끝 5 · 진행 1, 끝난 회차마다 하위 1) + 진행 회차 하위 1 */
function loop() {
  ord = 0;
  const list = [N('s:main', null, 'main', { sessionId: 'main' }), N('a:loop', 's:main', 'subagent', { status: 'done' })];
  list.push(N('b:L', 'a:loop', 'bash-bg', { label: '기동기 · relaunch.sh', meta: { launcher: { script: 'relaunch.sh', via: ['relaunch.sh'] },
    batch: { total: 9, running: 1, done: 7, stopped: 1, failed: 0, collapsed: 3, currentCycleId: 'c6', avgDurationMs: 12 * 60000,
      recent: [{ status: 'done' }, { status: 'stopped' }, { status: 'done' }, { status: 'done' }, { status: 'active' }].map((r, i) => ({ sessionId: 'c' + (i + 2), nodeId: 's:c' + (i + 2), ...r })) } } }));
  for (let k = 1; k <= 6; k++) {
    const live = k === 6;
    list.push(N('s:c' + k, 'b:L', 'claude-p', { status: live ? 'active' : k === 3 ? 'stopped' : 'done', sessionId: 'c' + k, meta: { cycle: k, link: { by: 'launcher', confidence: k === 6 ? 'medium' : 'high' } } }));
    list.push(N('a:c' + k + 'sub', 's:c' + k, 'subagent', { status: live ? 'active' : 'done' }));
  }
  return list;
}

test('접기: 끝난 회차는 최근 2개만 장치에 붙이고 나머지·끝난 회차 하위는 숨김, 진행 회차와 하위는 펼침', () => {
  const f = batchFold(mapOf(loop()));
  assert.deepEqual([...f.docked.keys()], ['s:c5', 's:c4']);
  assert.equal(f.docked.get('s:c5').slot, 0);
  for (const id of ['s:c1', 's:c2', 's:c3', 'a:c1sub', 'a:c4sub', 'a:c5sub']) assert.ok(f.hidden.has(id), id);
  for (const id of ['s:c6', 'a:c6sub', 'b:L', 's:c4', 's:c5']) assert.ok(!f.hidden.has(id), id);
  assert.equal(f.devices.get('b:L').currentId, 's:c6');
  assert.equal(f.zoneOf.get('a:c6sub'), 'b:L');
  assert.equal(f.zoneOf.get('s:c1'), 'b:L');
});

test('접기: 하위가 아직 일하는 끝난 회차는 접지 않는다', () => {
  const list = loop();
  list.find((n) => n.id === 'a:c2sub').status = 'active';
  const f = batchFold(mapOf(list));
  assert.ok(!f.hidden.has('s:c2') && !f.docked.has('s:c2') && !f.hidden.has('a:c2sub'));
});

test('재무장 Monitor: 마지막 하나만 그리고 앞 것들은 숨김, 횟수·자리 기준(사슬 머리)', () => {
  ord = 0;
  const list = [N('s:main', null, 'main'),
    N('m:1', 's:main', 'monitor', { status: 'done', meta: { expired: true } }),
    N('m:2', 's:main', 'monitor', { status: 'done', meta: { expired: true, rearmOf: 'm:1', rearmCount: 1 } }),
    N('m:3', 's:main', 'monitor', { meta: { rearmOf: 'm:2', rearmCount: 2 } }),
    N('m:x', 's:main', 'monitor')];
  const f = batchFold(mapOf(list));
  assert.deepEqual([...f.hidden].sort(), ['m:1', 'm:2']);
  assert.deepEqual(f.rearm.get('m:3'), { prevIds: ['m:2', 'm:1'], count: 2, anchorId: 'm:1' });
  assert.equal(f.rearmPrev.get('m:1'), 'm:3');
  assert.ok(!f.rearm.has('m:x'));
  assert.deepEqual(nodeTags(list[3]), ['재무장 ×2']);
});

test('재무장 대기: 만료 Monitor 는 주인이 살아 있으면 10분 동안 대기 표시, 주인이 끝났거나 만료가 아니면 아님', () => {
  const m = { kind: 'monitor', status: 'done', meta: { expired: true } };
  assert.equal(rearmStandby(m, { status: 'idle' }, 30), true);
  assert.equal(rearmStandby(m, { status: 'idle' }, BATCH.REARM_WAIT_S + 1), false);
  assert.equal(rearmStandby(m, { status: 'done' }, 30), false);
  assert.equal(rearmStandby({ ...m, meta: {} }, { status: 'idle' }, 30), false);
  assert.equal(rearmStandby({ ...m, status: 'stopped' }, { status: 'idle' }, 30), false);
});

test('장치 표시 값: meta.batch 우선, 띠는 recent 상태(노드가 있으면 그 상태), 5진수 왕복, 요약 문구', () => {
  const list = loop();
  const L = list.find((n) => n.id === 'b:L');
  const info = deviceInfo(L, mapOf(list));
  assert.equal(info.total, 9); assert.equal(info.running, 1); assert.equal(info.currentId, 's:c6');
  assert.deepEqual(info.band, [2, 3, 2, 2, 1]);
  assert.deepEqual(bandDecode(bandCode(info.band), info.band.length), info.band);
  assert.equal(deviceSummary(info), '회차 9 · 진행 1 · 완료 7 · 중지 1 · 평균 12분');
  // meta.batch 가 없으면 회차 노드로 센다
  const bare = { ...L, meta: { launcher: L.meta.launcher } };
  const i2 = deviceInfo(bare, mapOf(list));
  assert.equal(i2.total, 6); assert.equal(i2.running, 1); assert.equal(i2.done, 4); assert.equal(i2.stopped, 1);
  assert.equal(i2.currentId, 's:c6');
  const c6 = list.find((n) => n.id === 's:c6');
  assert.equal(cycleProgress(info, c6, Date.parse(c6.startedAt) + 6 * 60000), 0.5);
  assert.deepEqual(nodeTags({ ...L, meta: { ...L.meta, adopted: { fromSession: 'x' } } }), ['이어받음']);
  assert.deepEqual(nodeTags(c6, mapOf(list)), ['회차 #6', '연결 추정']);
  assert.ok(isGuessLink(c6) && !isGuessLink(list.find((n) => n.id === 's:c5')));
});

test('복셀: 회차와 그 하위는 메인 사무실 안(별관 없음), 기동기는 팀장 책상 옆, 회차는 팀원 책상(진행 회차가 장치 쪽 앞줄, §88)', () => {
  const list = loop().filter((n) => !['s:c1', 's:c2', 's:c3', 'a:c1sub', 'a:c2sub', 'a:c3sub'].includes(n.id));
  const lay = computeOffice(list, 's:main', null);
  assert.equal(lay.rooms.filter((r) => r.type === 'office').length, 1, '방은 메인 사무실 하나');
  const room = lay.rooms[0];
  const m = lay.machine.get('b:L');
  assert.equal(m.type, 'batch');
  assert.deepEqual({ x: m.x, z: m.z }, { x: room.origin.x + BATCH_SPOTS[0].x, z: room.origin.z + BATCH_SPOTS[0].z });
  const lead = room.leadDesk;
  assert.ok(Math.abs(m.z - lead.z) < 1 && Math.abs(m.x - lead.x) > 1.4 && Math.abs(m.x - lead.x) < 3, '기동기는 팀장 책상 바로 옆');
  const op = lay.seat.get('s:c6');
  assert.equal(op.kind, 'op');
  assert.equal(op.face, 0, '팀원 책상(앞을 봄) — 장치에 붙어 서지 않음');
  assert.ok(op.z > lead.z + 2 && Math.abs(op.deskZ - room.origin.z - DESK_Z0) < 1e-6, '진행 회차는 앞줄 팀원 책상');
  const xs = room.desks.filter((d) => Math.abs(d.z - op.deskZ) < 1e-6).map((d) => Math.abs(d.x - m.x));
  assert.equal(Math.abs(op.deskX - m.x), Math.min(...xs), '장치에 가장 가까운 책상');
  assert.ok(room.desks.some((d) => d.occupant === 's:c6'));
  for (const id of ['a:c6sub', 's:c4', 's:c5']) { assert.equal(lay.seat.get(id).roomId, room.id); assert.equal(lay.seat.get(id).kind, 'op'); }
  const ds = ['s:c6', 'a:c6sub', 's:c4', 's:c5'].map((id) => lay.seat.get(id));
  for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) assert.ok(Math.hypot(ds[i].deskX - ds[j].deskX, ds[i].deskZ - ds[j].deskZ) > 1, '책상 겹침 없음');
  assert.equal(room.stools.filter((s) => s.kind === 'op').length, 0, '작업석 바닥 표시 없음');
  // 다시 계산해도 같은 책상(이전 자리 유지)
  const again = computeOffice(list, 's:main', lay);
  assert.equal(again.seat.get('s:c6').deskX, op.deskX);
  // 재무장 Monitor 는 앞 것의 화면 자리를 잇는다
  ord = 100;
  const l2 = [N('s:main', null, 'main'), N('m:a', 's:main', 'monitor'), N('m:b', 's:main', 'monitor')];
  const p = computeOffice(l2, 's:main', null);
  const l3 = [l2[0], l2[2], N('m:c', 's:main', 'monitor', { meta: { rearmOf: 'm:a', rearmCount: 1 } })];
  const q = computeOffice(l3, 's:main', p);
  assert.equal(q.machine.get('m:c').slot, p.machine.get('m:a').slot);
});

function campusWorld() {
  ord = 0;
  const list = [
    N('s:A', null, 'main', { projectId: 'P', sessionId: 'A' }), N('a:A1', 's:A', 'subagent', { projectId: 'P', rootSessionId: 'A' }),
    N('s:O1', null, 'main', { projectId: 'P', sessionId: 'O1', meta: { orphanSdk: true, likelyMain: 'A', unlinkedReason: 'ambiguous' } }),
    N('a:O1s', 's:O1', 'subagent', { projectId: 'P', rootSessionId: 'O1' }),
    N('s:O2', null, 'main', { projectId: 'Q', sessionId: 'O2', meta: { orphanSdk: true, likelyMain: null, unlinkedReason: 'no-launch' } }),
    // 부모가 퇴장해 빠진 손자: 새 루트가 되지 않고 메인 A 소속
    N('b:lost', 'a:gone', 'bash-bg', { projectId: 'P', rootSessionId: 'A' }),
  ];
  const roots = [{ nodeId: 's:A', projectId: 'P' }, { nodeId: 's:O1', projectId: 'P' }, { nodeId: 's:O2', projectId: 'Q' }];
  const projects = [{ projectId: 'P', name: 'demo_api', live: true }, { projectId: 'Q', name: '(임시) probe', live: true, temp: true }];
  return { list, roots, projects };
}

test('추정 소속·외부 작업: orphanPlan', () => {
  const w = campusWorld();
  const plan = orphanPlan(w.roots, mapOf(w.list));
  assert.deepEqual(plan.get('s:O1'), { mode: 'guest', host: 's:A' });
  assert.deepEqual(plan.get('s:O2'), { mode: 'external', projectId: 'Q' });
});

test('복셀 캠퍼스: 메인 없는 빈 사무실을 만들지 않는다(손님 대기석 · 외부 작업 구역 · 부모 빠진 노드는 메인 소속)', () => {
  const w = campusWorld();
  const c = computeCampus(w.list, w.roots, w.projects, null, { nowMs: Date.parse(T(10)) });
  const owners = c.rooms.filter((r) => r.type === 'office').map((r) => r.ownerId).sort();
  assert.deepEqual(owners, ['ext:Q', 's:A']);
  const ext = c.rooms.find((r) => r.ownerId === 'ext:Q');
  assert.equal(ext.external, true); assert.equal(ext.leadDesk, null);
  assert.equal(c.seat.get('s:O2').kind, 'grid');
  const main = c.rooms.find((r) => r.ownerId === 's:A');
  assert.equal(c.seat.get('s:O1').kind, 'wait');
  assert.equal(c.seat.get('s:O1').roomId, main.id);
  assert.equal(c.seat.get('a:O1s').kind, 'wait');
  assert.equal(c.machine.get('b:lost').roomId, main.id);
  assert.equal(c.projectOf.get('s:O1'), 'P');
});

test('전체 보기(Flow·Planet): 추정 소속 독립 루트는 그 메인 가장자리 + 부모 연결, 부모 빠진 노드는 루트 소속', () => {
  const w = campusWorld();
  const nodes = mapOf(w.list);
  const a = assignRoots(nodes, w.roots);
  assert.deepEqual(a.roots.map((r) => r.nodeId).sort(), ['s:A', 's:O1', 's:O2']);
  assert.equal(a.rootOf.get('b:lost'), 's:A');
  const ov = computeOverview(nodes, w.roots, w.projects, null, { nowMs: Date.parse(T(10)) });
  assert.equal(ov.parentOf.get('s:O1'), 's:A');
  assert.equal(ov.guestOf.get('s:O1'), 's:A');
  const cl = ov.clusters.find((x) => x.projectId === 'P');
  assert.deepEqual(cl.mains.map((m) => m.nodeId), ['s:A'], '손님은 따로 메인 자리를 차지하지 않음');
  const pa = ov.pos.get('s:A'), po = ov.pos.get('s:O1');
  const d = Math.hypot(po.x - pa.x, po.z - pa.z);
  assert.ok(d > 4 && d <= cl.r + 1e-6, '메인 경계 바깥 가장자리, 섬 안');
});

test('mock: 기동기 예시(회차 반복·배치 집계·재무장 Monitor), 기본 생성기는 그대로', () => {
  const g = new MockGenerator({ seed: 2026, startMs: Date.parse('2026-10-23T01:00:00Z'), launcher: true });
  for (let i = 0; i < 4000; i++) if (g.next().at > 80000) break;
  const ns = [...g.nodes.values()];
  const L = ns.find((n) => n.meta.launcher);
  assert.ok(L && L.kind === 'bash-bg' && L.meta.batch.total >= 9);
  const cyc = ns.filter((n) => n.parentId === L.id);
  assert.ok(cyc.length >= 3 && cyc.every((n) => n.kind === 'claude-p' && n.meta.link.by === 'launcher'));
  assert.equal(cyc.filter((n) => n.status === 'active').length, 1);
  assert.ok(ns.some((n) => n.kind === 'monitor' && n.meta.rearmOf));
  const plain = new MockGenerator({ seed: 2026, startMs: Date.parse('2026-10-23T01:00:00Z') });
  for (let i = 0; i < 2000; i++) if (plain.next().at > 80000) break;
  assert.ok(![...plain.nodes.values()].some((n) => n.meta.launcher || n.meta.rearmOf));
});

test('overview mock: demo_api 메인의 기동기(이어받음)·회차 참조 앞붙이·추정 소속 독립 루트', () => {
  let t = Date.parse('2026-10-23T05:00:00Z');
  const m = createOverviewMock({ now: () => t });
  const s = m.snapshot();
  const byId = mapOf(s.nodes);
  const L = s.nodes.find((n) => n.meta && n.meta.launcher);
  assert.ok(L && L.meta.adopted && L.projectId === 'demo-beta');
  const cur = L.meta.batch.currentCycleId;
  assert.ok(cur && byId.has('s:' + cur), '현재 회차 sessionId 도 앞붙이');
  for (const n of s.nodes) if (n.meta && n.meta.rearmOf) assert.ok(byId.has(n.meta.rearmOf));
  const guest = s.nodes.find((n) => n.meta && n.meta.orphanSdk && n.meta.likelyMain);
  assert.ok(guest && s.roots.some((r) => r.nodeId === guest.id));
  assert.equal(orphanPlan(assignRoots(byId, s.roots).roots, byId).get(guest.id).mode, 'guest');
});

test('v0.4.1 기동기 크기 0.75배: 공용 배율·배치 반폭·장치 옆 끝난 회차 자리가 같이 줄어듦', async () => {
  const { BATCH: B } = await import('../batch-core.mjs');
  const { DEVICE_EXTENT, nodeExtent, dockedPos } = await import('../layout.js');
  assert.equal(B.DEVICE_K, 0.75);
  assert.ok(Math.abs(DEVICE_EXTENT - 2.6 * 0.75) < 1e-9);
  assert.equal(nodeExtent({ kind: 'bash-bg', meta: { launcher: {} } }), DEVICE_EXTENT);
  const d0 = dockedPos({ x: 0, y: 0, z: 0 }, { x: -10, y: 0, z: 0 }, 0);
  assert.ok(Math.abs(Math.hypot(d0.x, d0.z) - (DEVICE_EXTENT + 1.4)) < 1e-9);
  // 2D 반지름 규칙(flat-view·planet2d 와 같은 식): 백그라운드 명령 0.8 × 0.68 × 2 × 0.75
  const fs = await import('node:fs');
  for (const f of ['../scene.js', '../flat/flat-view.js', '../flat/planet2d.js']) assert.match(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), /\? 2 \* BATCH\.DEVICE_K : 1\)/, f);
  assert.match(fs.readFileSync(new URL('../flat/voxel2d.js', import.meta.url), 'utf8'), /if \(isLauncher\(node\)\) return BATCH\.DEVICE_K;/);
  assert.match(fs.readFileSync(new URL('../voxel/props.js', import.meta.url), 'utf8'), /const S = DEVICE_K;/);
});
