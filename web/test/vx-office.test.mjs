// 복셀 오피스 개편: 스탠딩 데스크·탕비실·특별 상호작용 시설 자리(회전 포함)·바닥 조명 라인·대기 동작·쉬러 가기·
// 역할 복장·홀로그램 모니터 열림·의뢰인 창구(사용자 ↔ 메인) 상태 전이 — 순수 함수
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOffice } from '../voxel/layout.js';
import { rotateOffice } from '../voxel/xf.mjs';
import {
  STAND_CATS, OFFICE_FX, IX_FACILITY, roomPoint, ixSpot, breakSpot, BREAK_N, clientScreen, clientSpot, breakDecision, BREAK,
  idleAct, IDLE_SLOT, roleOf, floorRoute, routeCum, routeAt, dashStarts, lineStyle, monitorWanted, stepOpen, openShape, popShape, MON,
  overseeSpot, SUPERVISE, superviseAct,
} from '../voxel/office-core.mjs';
import { ClientDesk, clientOp, CLIENT } from '../voxel/client-core.mjs';
import { Character } from '../voxel/character-core.mjs';

const inside = (p, b, pad = 0) => p.x >= b.minX - pad - 1e-6 && p.x <= b.maxX + pad + 1e-6 && p.z >= b.minZ - pad - 1e-6 && p.z <= b.maxZ + pad + 1e-6;
function office(k = 0, kids = 4) {
  const nodes = [{ id: 'm', kind: 'main', status: 'active', order: 0 }];
  for (let i = 0; i < kids; i++) nodes.push({ id: 'a' + i, parentId: 'm', kind: 'subagent', status: 'active', order: i + 1 });
  const lay = computeOffice(nodes, 'm');
  if (k) rotateOffice(lay, k, 0, 0);
  return { lay, room: lay.rooms[0], nodes };
}

test('시설 자리: 탕비실·특별 상호작용 시설·의뢰인 스크린이 방 안 — 돌린 방(1～3 사분)도', () => {
  for (const k of [0, 1, 2, 3]) {
    const { room } = office(k);
    for (const cat of Object.keys(IX_FACILITY)) { const p = ixSpot(room, cat); assert.ok(p && inside(p, room.bounds, 0.1), `${cat} k=${k}`); }
    for (let i = 0; i < BREAK_N; i++) { const p = breakSpot(room, i); assert.ok(inside(p, room.bounds), `break ${i} k=${k}`); assert.ok(Number.isFinite(p.face)); }
    const sc = clientScreen(room), sp = clientSpot(room);
    assert.ok(inside(sc, room.bounds, 0.4) && inside(sp, room.bounds), `client k=${k}`);
    // 팀장이 스크린을 바라봄
    const dir = { x: Math.sin(sp.face), z: Math.cos(sp.face) };
    assert.ok((sc.x - sp.x) * dir.x + (sc.z - sp.z) * dir.z > 1, `client face k=${k}`);
  }
  // 회의실은 시설 없음
  const meet = { type: 'meeting', origin: { x: 0, z: 0 }, ext: 0 };
  assert.equal(ixSpot(meet, 'github'), null); assert.equal(breakSpot(meet, 0), null);
  // 앞쪽 시설(발송대)은 방이 길어진 만큼 민다
  const big = office(0, 20).room;
  assert.ok(Math.abs(roomPoint(big, 0, 1, true).z - roomPoint(big, 0, 1).z - big.ext) < 1e-9 && big.ext > 0);
});

test('스탠딩 데스크: 읽기·검색·셸·웹·쓰기·편집은 자기 책상 홀로그램, 스킬 등은 시설로 걸어감', () => {
  for (const c of ['read', 'search', 'shell', 'web', 'write', 'edit', 'other']) assert.ok(STAND_CATS.has(c), c);
  for (const c of ['skill', 'agent', 'mcp', 'artifact', 'notify', 'monitor']) assert.ok(!STAND_CATS.has(c), c);
  const { lay, room, nodes } = office();
  const seat = lay.seat.get('a0');
  const ch = new Character('a0', nodes[1]);
  const ctx = { now: 0, dt: 0.05, ts: 1, room, seat, stationSpot: (c, cat) => (room.stations[cat] ? room.stations[cat][0] : null), releaseStation: () => {} };
  const run = (sec) => { for (let t = 0; t < sec; t += ctx.dt) { ctx.now += ctx.dt; ch.update(ctx); } };
  run(3); // 처음 자리 잡기
  ch.addTool('r', 'read', 'Read', ctx.now); run(0.3);
  assert.equal(ch.state, 'work'); assert.ok(ch.atDesk(), '읽기 = 책상에 선 채');
  ch.endTool('r', true, ctx.now); run(1.5);
  ch.addTool('s', 'skill', 'Skill', ctx.now); run(0.3);
  assert.equal(ch.state, 'walk', '스킬 = 도구 상자로 걸어감');
});

test('쉬러 가기 판단: 팀장은 사람 입력을 3분 이상 기다릴 때만·한 번 다녀오면 긴 쿨다운(§88), 팀원은 오래 생각할 때 가끔(쿨다운), 빠른 재생이면 돌아옴', () => {
  const base = { lead: true, status: 'idle', idleFor: BREAK.LEAD_AFTER + 1, hash: 0, ts: 1, now: 1000, breakUntil: 0, cooldownUntil: 0, onBreak: false };
  assert.ok(BREAK.LEAD_AFTER >= 120 && BREAK.LEAD_COOLDOWN >= 600, '팀장 탕비실은 드물게');
  assert.equal(breakDecision(base), 'go');
  assert.equal(breakDecision({ ...base, idleFor: 5 }), null, '짧은 대기는 자리에서');
  assert.equal(breakDecision({ ...base, idleFor: 60 }), null);
  assert.equal(breakDecision({ ...base, cooldownUntil: 1500 }), null, '다녀온 뒤 쿨다운');
  assert.equal(breakDecision({ ...base, onBreak: true, breakUntil: 1020 }), 'stay');
  assert.equal(breakDecision({ ...base, onBreak: true, breakUntil: 990 }), 'back', '커피 시간이 끝나면 대기 중이어도 자리로');
  assert.equal(breakDecision({ ...base, status: 'active', onBreak: true, breakUntil: 1020 }), 'back');
  assert.equal(breakDecision({ ...base, ts: 8, onBreak: true }), 'back');
  const st = { ...base, lead: false, status: 'active', idleFor: BREAK.STAFF_AFTER + 1, now: 100 };
  assert.equal(breakDecision({ ...st, status: 'idle', idleFor: BREAK.WAIT_AFTER + 1 }), 'go', '팀원은 입력 대기면 예전처럼');
  assert.equal(breakDecision({ ...st, hash: 3 }), 'go');
  assert.equal(breakDecision({ ...st, hash: 4 }), null, '셋 중 하나꼴');
  assert.equal(breakDecision({ ...st, hash: 3, cooldownUntil: 200 }), null, '쿨다운');
  assert.equal(breakDecision({ ...st, onBreak: true, breakUntil: 105 }), 'stay');
  assert.equal(breakDecision({ ...st, onBreak: true, breakUntil: 99 }), 'back');
  assert.equal(breakDecision({ ...st, status: 'done' }), null);
});

test('팀장 동선: 대기 → 탕비실 커피 → 사람 입력(작업 중)이면 자리로', () => {
  const { lay, room, nodes } = office();
  const seat = lay.seat.get('m');
  nodes[0].status = 'idle';
  const ch = new Character('m', nodes[0], { lead: true });
  const ctx = { now: 0, dt: 0.05, ts: 1, room, seat, stationSpot: () => null, releaseStation: () => {}, breakSpot: (c) => breakSpot(room, c.hash % BREAK_N) };
  const run = (sec) => { for (let t = 0; t < sec; t += ctx.dt) { ctx.now += ctx.dt; ch.update(ctx); } };
  run(1); assert.equal(ch.target.type, 'desk');
  run(30); assert.equal(ch.target.type, 'desk', '짧은 대기는 자리에서');
  run(BREAK.LEAD_AFTER - 29); assert.equal(ch.target.type, 'break', '오래 기다리면 탕비실로');
  run(12);
  const sp = breakSpot(room, ch.hash % BREAK_N);
  assert.ok(Math.hypot(ch.pos.x - sp.x, ch.pos.z - sp.z) < 1e-3, '쉬는 자리 도착');
  nodes[0].status = 'active';
  ch.addTool('t', 'shell', 'Bash', ctx.now);
  run(12);
  assert.ok(Math.hypot(ch.pos.x - seat.x, ch.pos.z - seat.z) < 1e-3 && ch.state === 'work', '자리로 돌아와 일함');
});

test('의뢰인 스크린 심부름: 보고·질문이면 팀장이 스크린 앞으로 갔다가 돌아옴', () => {
  const { lay, room, nodes } = office();
  const seat = lay.seat.get('m');
  const ch = new Character('m', nodes[0], { lead: true });
  const ctx = { now: 0, dt: 0.05, ts: 1, room, seat, stationSpot: () => null, releaseStation: () => {} };
  const run = (sec) => { for (let t = 0; t < sec; t += ctx.dt) { ctx.now += ctx.dt; ch.update(ctx); } };
  run(1);
  const sp = clientSpot(room);
  ch.errand = { spot: sp, until: ctx.now + 10, kind: 'report' };
  run(9);
  assert.equal(ch.target.type, 'errand');
  assert.ok(Math.hypot(ch.pos.x - sp.x, ch.pos.z - sp.z) < 1e-3, '스크린 앞');
  run(10);
  assert.equal(ch.errand, null);
  assert.ok(Math.hypot(ch.pos.x - seat.x, ch.pos.z - seat.z) < 1e-3, '자리로');
});

test('대기 동작 시간표·역할 복장', () => {
  const a = idleAct(12345, 3), b = idleAct(12345, 3);
  assert.deepEqual(a, b, '결정적');
  const acts = new Set();
  for (let t = 0; t < IDLE_SLOT * 40; t += IDLE_SLOT) acts.add(idleAct(777, t).act);
  for (const x of ['coffee', 'stretch', 'think', 'look']) assert.ok(acts.has(x), x);
  assert.ok(a.k >= 0 && a.k < 1);
  assert.equal(roleOf('main', 'lead', true), 'lead');
  assert.equal(roleOf('claude-p', 'lead', true), 'annex');
  assert.equal(roleOf('claude-p', 'op', false), 'operator');
  assert.equal(roleOf('claude-p', 'wait', false), 'guest');
  assert.equal(roleOf('workflow-agent', 'meet', false), 'wf');
  assert.equal(roleOf('subagent', 'grid', false), 'staff');
});

test('바닥 조명 라인: 팀장 ↔ 팀원 길(통로) · 길 위 점 · 흐르는 대시(부모 → 자식) · 상태별 밝기', () => {
  const { lay, room } = office();
  const a = lay.seat.get('m'), b = lay.seat.get('a3');
  const pts = floorRoute(a, b, room), cum = routeCum(pts), L = cum[cum.length - 1];
  assert.ok(L > 3);
  for (let i = 1; i < pts.length; i++) assert.ok(Math.abs(pts[i].x - pts[i - 1].x) < 1e-9 || Math.abs(pts[i].z - pts[i - 1].z) < 1e-9, '가로·세로만');
  const s = routeAt(pts, cum, 0), e = routeAt(pts, cum, 1);
  assert.ok(Math.hypot(s.x - a.x, s.z - a.z) < 1e-9 && Math.hypot(e.x - b.x, e.z - b.z) < 1e-9);
  const d0 = dashStarts(L, 0, 2.4), d1 = dashStarts(L, 0.1, 2.4);
  assert.ok(d0.length >= 1 && d1[0] > d0[0], '시간이 가면 자식 쪽으로');
  assert.deepEqual(dashStarts(L, 1, 0), [], '끝난 노드는 멈춤');
  assert.ok(lineStyle('active').k > lineStyle('idle').k && lineStyle('idle').k > lineStyle('done').k);
  assert.equal(lineStyle('done').v, 0);
});

test('홀로그램 모니터: 항목이 있고 책상에 서 있을 때만 펼침, 열림·접힘 시간, 모양·튀어나오는 창', () => {
  assert.equal(monitorWanted(true, true), true);
  assert.equal(monitorWanted(true, false), false);
  assert.equal(monitorWanted(false, true), false);
  assert.equal(monitorWanted(true, true, true), false);
  let k = 0;
  for (let i = 0; i < 10; i++) k = stepOpen(k, true, MON.OPEN / 10 + 1e-9);
  assert.equal(k, 1);
  for (let i = 0; i < 5; i++) k = stepOpen(k, false, MON.CLOSE / 10);
  assert.ok(k > 0.4 && k < 0.6);
  const o0 = openShape(0.2), o1 = openShape(1);
  assert.ok(o0.sy <= 0.06 && o0.sx > 0, '먼저 가는 빛줄로 옆으로');
  assert.ok(Math.abs(o1.sx - 1) < 1e-9 && Math.abs(o1.sy - 1) < 1e-9);
  assert.equal(popShape(0), null); assert.equal(popShape(1), null);
  assert.ok(popShape(0.5).up === 1 && popShape(0.9).up < popShape(0.5).up, '솟았다가 들어감');
});

test('의뢰인 창구: 요청 카드·읽기, 끼어듦 메모, 질문 → 답 카드 빛남, 보고, 거부 붉은 깜빡임, 오래 대기 화면보호기', () => {
  const d = new ClientDesk();
  assert.equal(d.screen(0, false), 'idle');
  d.apply({ op: 'request' }, 10, false);
  assert.equal(d.liveCards(10.1).length, 1); assert.equal(d.screen(10.5, false), 'on');
  assert.ok(d.readUntil > 10 + CLIENT.CARD_DUR);
  d.apply({ op: 'request' }, 20, true);
  assert.equal(d.memo, 1, '작업 중에 온 메시지 = 메모');
  d.apply({ op: 'memo', mid: true }, 21, true); assert.equal(d.memo, 2);
  d.apply({ op: 'ask', options: 4 }, 30);
  assert.equal(d.screen(30.2), 'ask'); assert.equal(d.errand(30.2).kind, 'ask'); assert.equal(d.ask.n, 4);
  d.apply({ op: 'answer', choice: 2 }, 33);
  assert.equal(d.ask.chosen, 2);
  d.step(33 + CLIENT.ASK_GLOW + 0.1); assert.equal(d.ask, null);
  d.apply({ op: 'report' }, 40);
  assert.equal(d.errand(41).kind, 'report'); assert.equal(d.memo, 0, '턴 끝 = 메모 치움');
  d.step(40 + CLIENT.REPORT + 0.1); assert.equal(d.errand(46), null);
  d.apply({ op: 'alert' }, 50); assert.equal(d.screen(50.5), 'alert');
  assert.equal(d.screen(50 + CLIENT.ALERT + CLIENT.SAVER_AFTER + 1, true), 'saver');
  assert.equal(d.screen(50 + CLIENT.ALERT + CLIENT.SAVER_AFTER + 1, false), 'idle', '팀장이 일하는 중이면 화면보호기 아님');
});

test('의뢰인 창구 입력: 서버 user 범주(§69.3) 우선, 없으면 기존 이벤트에서 추정', () => {
  const isMain = (id) => id === 'm';
  const st = {};
  assert.deepEqual(clientOp({ type: 'user', nodeId: 'm', origin: 'human' }, isMain, st), { op: 'request', lead: 'm' }, '추정: 사람 메시지');
  assert.equal(clientOp({ type: 'tool-start', nodeId: 'm', tool: 'AskUserQuestion', toolUseId: 'q' }, isMain, st).op, 'ask');
  assert.equal(clientOp({ type: 'result', nodeId: 'm' }, isMain, st).op, 'report');
  assert.equal(clientOp({ type: 'user', nodeId: 'a', origin: 'human' }, isMain, st), null, '메인만');
  const ix = (op, extra = {}, type = 'user') => clientOp({ type, nodeId: 'm', ix: { cat: 'user', op, ...extra } }, isMain, st);
  assert.equal(ix('prompt').op, 'request');
  assert.equal(st.ixSeen, true);
  assert.equal(clientOp({ type: 'user', nodeId: 'm', origin: 'human' }, isMain, st), null, '서버 범주가 오면 추정은 끔');
  assert.equal(ix('midturn').op, 'memo');
  assert.equal(ix('interrupt').op, 'alert'); assert.equal(ix('deny').op, 'alert');
  assert.equal(ix('reply', {}, 'node-update').op, 'report');
  assert.equal(ix('auto'), null, '자동 알림은 창구 연출 없음');
  assert.deepEqual(ix('ask', { opts: 3 }, 'tool-start'), { op: 'ask', lead: 'm', toolUseId: undefined, options: 3 });
  assert.deepEqual(ix('ask', { phase: 'end', pick: 1 }, 'tool-end'), { op: 'answer', lead: 'm', choice: 1 });
  assert.equal(ix('ask', { phase: 'end', ok: false, declined: 1 }, 'tool-end').op, 'alert');
});

test('시설 상수: 사무실 지역 범위 안(24×18)', () => {
  for (const [k, f] of Object.entries(OFFICE_FX)) {
    const xs = [f.x].filter(Number.isFinite), zs = [f.z, f.z0, f.z1].filter(Number.isFinite);
    for (const x of xs) assert.ok(Math.abs(x) <= 12, k);
    for (const z of zs) assert.ok(z >= -9 && z <= 9, k);
  }
});

test('팀장 탕비실 쿨다운: 커피 시간 뒤 대기 중이어도 자리로, 쿨다운 동안 다시 가지 않음(§88)', () => {
  const { lay, room, nodes } = office();
  const seat = lay.seat.get('m');
  nodes[0].status = 'idle';
  const ch = new Character('m', nodes[0], { lead: true });
  const ctx = { now: 0, dt: 0.1, ts: 1, room, seat, stationSpot: () => null, releaseStation: () => {}, breakSpot: (c) => breakSpot(room, c.hash % BREAK_N) };
  let trips = 0, was = false;
  for (let t = 0; t < BREAK.LEAD_AFTER + BREAK.LEAD_DUR + 300; t += ctx.dt) {
    ctx.now += ctx.dt; ch.update(ctx);
    const on = ch.target && ch.target.type === 'break';
    if (on && !was) trips++;
    was = on;
  }
  assert.equal(trips, 1, '한 번만');
  assert.equal(ch.target.type, 'desk');
});

test('지휘·감독: 자율 루프 팀장이 가끔 책상 옆으로 나와 팀원 쪽을 본다(§88)', () => {
  const { lay, room, nodes } = office();
  const seat = lay.seat.get('m');
  nodes[0].status = 'idle';
  const ch = new Character('m', nodes[0], { lead: true });
  const crew = [{ x: seat.x + 2, z: seat.z + 5 }];
  const ctx = { now: 0, dt: 0.05, ts: 1, room, seat, stationSpot: () => null, releaseStation: () => {}, crewOf: () => crew, overseeSpot: (c) => overseeSpot(c.room) };
  let saw = 0, desk = 0, maxK = 0;
  for (let t = 0; t < SUPERVISE.PERIOD * 2.2; t += ctx.dt) {
    ctx.now += ctx.dt; ch.update(ctx);
    if (ch.sup) { saw++; maxK = Math.max(maxK, ch.sup.k); const want = Math.atan2(crew[0].x - ch.pos.x, crew[0].z - ch.pos.z); assert.ok(Math.abs(ch.sup.yaw - want) < 1e-6); }
    if (ch.target && ch.target.type === 'desk' && ch.state === 'seated') desk++;
  }
  assert.ok(saw > 10, '감독 자세가 나옴');
  assert.ok(desk > 10, '나머지 시간은 자리');
  const sp = overseeSpot(room);
  assert.ok(sp && Math.hypot(sp.x - seat.x, sp.z - seat.z) < 3, '감독 자리는 팀장 책상 곁');
  // 팀원이 없으면 감독하지 않음
  const ch2 = new Character('m', nodes[0], { lead: true });
  const ctx2 = { ...ctx, now: 0, crewOf: () => [] };
  for (let t = 0; t < SUPERVISE.PERIOD * 2.2; t += ctx2.dt) { ctx2.now += ctx2.dt; ch2.update(ctx2); assert.equal(ch2.sup, null); }
  for (let t = 0; t < 40; t += 0.25) { const a = superviseAct(7, t); assert.ok(a.k >= 0 && a.k <= 1); }
});

test('지휘·감독 자리 = 볼 팀원 책상 앞 통로, 팀원과 마주 봄(§91.6 — 예전엔 팀원 등을 가리킴) · 돌린 방도', () => {
  for (const k of [0, 1, 2, 3]) {
    const { lay, room } = office(k);
    const s = lay.seat.get('a1');
    const crew = { x: s.x, z: s.z, lx: s.deskLX, lz: s.deskLZ };
    const sp = overseeSpot(room, crew);
    assert.ok(sp && inside(sp, room.bounds), `안 k=${k}`);
    // 팀원이 보는 쪽(자리 → 책상)에 섬: 책상보다 더 앞
    const fx = s.deskX - s.x, fz = s.deskZ - s.z, fl = Math.hypot(fx, fz);
    const ax = sp.x - s.x, az = sp.z - s.z;
    assert.ok((ax * fx + az * fz) / fl > fl + 0.6, `책상 앞 k=${k}`);
    // 팀장이 팀원을 바라봄(face)
    const dir = { x: Math.sin(sp.face), z: Math.cos(sp.face) };
    assert.ok(((s.x - sp.x) * dir.x + (s.z - sp.z) * dir.z) / Math.hypot(s.x - sp.x, s.z - sp.z) > 0.95, `마주 봄 k=${k}`);
  }
  // 캐릭터: 칸마다 그 팀원 책상 앞으로 걸어가 가리킴(yaw = 팀원 쪽), 팀원이 둘이면 칸에 따라 다른 책상
  const { lay, room, nodes } = office();
  const seat = lay.seat.get('m');
  nodes[0].status = 'idle';
  const ch = new Character('m', nodes[0], { lead: true });
  const crew = ['a0', 'a2'].map((id) => { const s = lay.seat.get(id); return { x: s.x, z: s.z, lx: s.deskLX, lz: s.deskLZ, at: true }; });
  // 자리를 비운 팀원(책상 좌표 없음)은 예전 자리(팀장 책상 곁)
  const away = overseeSpot(room, { x: 0, z: 0, lx: undefined, lz: undefined, at: false });
  assert.ok(Math.hypot(away.x - seat.x, away.z - seat.z) < 3);
  const ctx = { now: 0, dt: 0.05, ts: 1, room, seat, stationSpot: () => null, releaseStation: () => {}, crewOf: () => crew, overseeSpot: (c, e) => overseeSpot(c.room, e) };
  const spots = new Set();
  let posed = 0;
  for (let t = 0; t < SUPERVISE.PERIOD * 4.2; t += ctx.dt) {
    ctx.now += ctx.dt; ch.update(ctx);
    if (ch.sup) {
      posed++;
      spots.add(ch.target.key);
      const near = crew.some((c) => { const sp = overseeSpot(room, c); return Math.hypot(ch.pos.x - sp.x, ch.pos.z - sp.z) < 0.3; });
      assert.ok(near, '책상 앞 자리에서 가리킴');
      // 가리키는 쪽 = 앞(+z 의 반대, 팀원 자리 쪽)
      assert.ok(Math.cos(ch.sup.yaw) < -0.8, `팀원 쪽 yaw ${ch.sup.yaw}`);
    }
  }
  assert.ok(posed > 40, '감독 자세가 나옴');
  assert.ok(spots.size >= 2, '칸마다 다른 팀원 책상');
});
