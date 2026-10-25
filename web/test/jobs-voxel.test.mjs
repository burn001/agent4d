// 복셀 오피스 작업(Job) 현황판 — 순수 규칙 시험(자리 배정·판 크기·색 코드·2D 칩 자리). 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOffice } from '../voxel/layout.js';
import { rotateOffice } from '../voxel/xf.mjs';
import { batchFold } from '../batch-core.mjs';
import { JOB_CODE } from '../job-core.mjs';
import { JOBCARD, jobAnchor, jobSlots, jobCardModel, jobWaitFill, staleBlink, jobFlatPos, jobLabelAlways, mixHex, jobColorHex, JOB_COLOR_KEY, jobBoardYaw, JOB_YAW_LIM } from '../voxel/vx-job-core.mjs';

const T0 = Date.parse('2026-10-25T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
let ord = 0;
const N = (id, parentId, kind, extra = {}) => ({ id, parentId, kind, status: 'active', order: ord++, ...extra });
const J = (owner, jid, job = {}, extra = {}) => {
  const j = { v: 1, id: jid, title: jid, state: 'running', phase: null, progress: null, host: null, until: null, rc: null, beatAt: iso(T0), staleSec: null, stale: false, line: null, src: 'protocol', startedAt: iso(T0 + ord * 1000), endedAt: null, ...job };
  const status = j.state === 'running' ? 'active' : j.state === 'done' ? 'done' : j.state === 'failed' ? 'error' : 'idle';
  return N(`j:${owner}:${jid}`, owner, 'bash-bg', { status, label: jid, startedAt: j.startedAt, endedAt: j.endedAt, meta: { job: j, title: j.phase, background: true, jobOwner: owner }, ...extra });
};

function office() {
  ord = 0;
  return [
    N('s:main', null, 'main'),
    N('b:bg1', 's:main', 'bash-bg'),
    N('m:mon1', 's:main', 'monitor'),
    N('b:launch', 's:main', 'bash-bg', { meta: { launcher: { script: 'x' } } }),
  ];
}

test('작업 노드는 서버랙을 새로 세우지 않고 주인 기계 판의 카드(아래부터 쌓임)', () => {
  const L = office();
  L.push(J('b:bg1', 'run-0', { progress: { n: 4, total: 40 } }), J('b:bg1', 'judge', { state: 'waiting', until: iso(T0 + 600000) }));
  const lay = computeOffice(L, 's:main');
  const room = lay.rooms[0];
  assert.equal(room.racks.length, 1, '작업은 랙 자리를 쓰지 않는다');
  const rack = lay.machine.get('b:bg1');
  const a = lay.machine.get('j:b:bg1:run-0'), b = lay.machine.get('j:b:bg1:judge');
  assert.equal(a.type, 'job'); assert.equal(b.type, 'job');
  assert.equal(a.owner, 'b:bg1'); assert.equal(a.ownerType, 'rack');
  assert.deepEqual([a.slot, b.slot], [0, 1]);
  assert.ok(a.lo && !a.hi && b.hi && !b.lo && a.rows === 2);
  assert.ok(Math.abs(a.x - rack.x) < 1e-9 && a.y > 2.05 && Math.abs(b.y - a.y - JOBCARD.PITCH) < 1e-9, '랙 위 기둥 판, 위로 PITCH 간격');
  assert.equal(a.pole, 2.05);
  assert.equal(lay.roomOf.get('j:b:bg1:run-0'), room.id);
});

test('주인 종류별 판 자리: 모니터 벽 위 벽걸이(앞면 −x) · 복합기 오른쪽 · 팀장 책상 왼쪽 · 주인 없으면 자리 없음', () => {
  const L = office();
  L.push(J('m:mon1', 'daily'), J('b:launch', 'wait-1', { state: 'waiting' }), J('s:main', 'loop'), J('b:gone', 'orphan'));
  const lay = computeOffice(L, 's:main');
  const scr = lay.machine.get('m:mon1'), mj = lay.machine.get('j:m:mon1:daily');
  assert.equal(mj.ownerType, 'screen');
  assert.ok(Math.abs(mj.face + Math.PI / 2) < 1e-9 && mj.x < scr.x && mj.y > 1.9 && Math.abs(mj.pole - (scr.y + 0.3)) < 1e-9, '화면 윗변에서 기둥');
  const bat = lay.machine.get('b:launch'), bj = lay.machine.get('j:b:launch:wait-1');
  assert.equal(bat.type, 'batch'); assert.equal(bj.ownerType, 'batch');
  assert.ok(Math.abs(bj.x - (bat.x + 1.2)) < 1e-9 && bj.pole === 0, '복합기 오른쪽 바닥 판(홀로 대시보드와 비킴)');
  const lead = lay.rooms[0].leadDesk, lj = lay.machine.get('j:s:main:loop');
  assert.equal(lj.ownerType, 'lead');
  assert.ok(lj.x < lead.x - 1.0, '팀장 책상(폭 2) 왼쪽 바깥');
  // 부모가 목록에 없으면(퇴장·접힘) 작업도 자리가 없다 — 루트 사무실 랙으로 떨어지지 않음
  assert.equal(lay.machine.get('j:b:gone:orphan'), undefined);
  assert.equal(lay.rooms[0].racks.length, 1);
  // 같은 열 아래·위 단 모니터의 판은 좌우로 비켜 선다
  assert.ok(Math.abs(jobAnchor({ type: 'screen', x: 11.75, z: -5.4, slot: 0 }).z - jobAnchor({ type: 'screen', x: 11.75, z: -5.4, slot: 4 }).z) > JOBCARD.W);
});

test('칸 순서: 이전 칸을 지키고 새 작업은 위로, 칸은 0..n−1, 상한 MAX', () => {
  ord = 0;
  const a = J('b:x', 'a', { startedAt: iso(T0 + 5000) }), b = J('b:x', 'b', { startedAt: iso(T0 + 1000) });
  assert.deepEqual(jobSlots([a, b]).map((s) => s.node.id), [b.id, a.id], '처음엔 시작 순');
  const prev = new Map([[a.id, { type: 'job', owner: 'b:x', slot: 0 }], [b.id, { type: 'job', owner: 'b:x', slot: 1 }]]);
  const c = J('b:x', 'c', { startedAt: iso(T0) });
  assert.deepEqual(jobSlots([c, b, a], prev).map((s) => s.node.id), [a.id, b.id, c.id], '이전 순서 유지 · 새 것은 위');
  assert.deepEqual(jobSlots([c, b], prev).map((s) => s.slot), [0, 1], '빠진 칸은 메운다');
  const many = Array.from({ length: JOBCARD.MAX + 3 }, (_, i) => J('b:x', 'm' + i));
  assert.equal(jobSlots(many).length, JOBCARD.MAX);
});

test('끝난 작업 접기(batchFold) 뒤 배치: 주인마다 끝난 카드 최근 3장 + 진행 카드', () => {
  const L = office();
  for (let i = 0; i < 6; i++) L.push(J('b:launch', 'w' + i, { state: 'done', rc: 0, endedAt: iso(T0 + i * 60000) }));
  L.push(J('b:launch', 'live', { state: 'waiting' }));
  const hidden = batchFold(new Map(L.map((n) => [n.id, n]))).hidden;
  const lay = computeOffice(L.filter((n) => !hidden.has(n.id)), 's:main');
  const cards = [...lay.machine.values()].filter((m) => m.type === 'job');
  assert.equal(cards.length, 4);
  assert.ok(!lay.machine.has('j:b:launch:w0') && lay.machine.has('j:b:launch:w5') && lay.machine.has('j:b:launch:live'));
});

test('카드 그림 모델: 색 코드는 렌더러 시계(가상 시계)로 — 진행·대기·줄 섬·끝·실패·정체', () => {
  ord = 0;
  const now = T0 + 60000;
  const m = (job) => jobCardModel(J('b:x', 'k', job), now, 0);
  assert.equal(m({}).key, 'running');
  assert.equal(m({ state: 'waiting' }).key, 'waiting'); assert.ok(m({ state: 'waiting' }).dim);
  assert.equal(m({ state: 'queued' }).key, 'queued');
  assert.equal(m({ state: 'done', rc: 0 }).key, 'done'); assert.ok(m({ state: 'done' }).ended);
  assert.equal(m({ state: 'failed', rc: 4 }).key, 'failed');
  assert.equal(m({ stale: true }).key, 'stale');
  // 박동 뒤 문턱(600초)을 넘긴 시계면 정체, 같은 작업이라도 이른 시계면 진행
  const n = J('b:x', 's', { beatAt: iso(T0) });
  assert.equal(jobCardModel(n, T0 + 601000, 0).code, JOB_CODE.stale);
  assert.equal(jobCardModel(n, T0 + 10000, 0).code, JOB_CODE.running);
  assert.equal(m({ progress: { n: 10, total: 40 } }).progress, 0.25);
  assert.equal(m({}).progress, null);
  assert.equal(jobCardModel({ id: 'x', kind: 'bash-bg', meta: {} }, now, 0), null);
  assert.deepEqual(JOB_COLOR_KEY.map((k, i) => [k, i]).map(([k]) => JOB_CODE[k]), [0, 1, 2, 3, 4, 5]);
});

test('대기 모래시계는 재확인 시각이 가까울수록 차고, 정체 표시등은 끊긴 맥박(짧게 두 번 · 긴 쉼)', () => {
  const job = { state: 'waiting', beatAt: iso(T0), until: iso(T0 + 600000) };
  assert.equal(jobWaitFill(job, T0), 0);
  assert.ok(Math.abs(jobWaitFill(job, T0 + 300000) - 0.5) < 1e-9);
  assert.equal(jobWaitFill(job, T0 + 900000), 1);
  assert.equal(jobWaitFill({ state: 'waiting', beatAt: iso(T0) }, T0), null, 'until 없으면 없음');
  assert.equal(jobWaitFill({ state: 'running', until: iso(T0) }, T0), null);
  const seq = Array.from({ length: 18 }, (_, i) => staleBlink(i * 0.1));
  const ons = seq.reduce((a, v, i) => a + (v && !seq[i - 1] ? 1 : 0), 0);
  assert.equal(ons, 2, '한 주기에 두 번 켜짐');
  assert.ok(seq.filter((v) => !v).length > seq.length / 2, '꺼진 쪽이 길다');
  assert.equal(staleBlink(1.0, true), 1, 'reduced = 늘 켬');
});

test('2D 칩은 판 앞쪽으로 한 줄, 방을 돌려도(캠퍼스 회전) 카드 자리와 같이 돈다', () => {
  const L = office();
  L.push(J('b:bg1', 'a'), J('b:bg1', 'b'));
  const lay = computeOffice(L, 's:main');
  const a = lay.machine.get('j:b:bg1:a'), b = lay.machine.get('j:b:bg1:b');
  const pa = jobFlatPos(a), pb = jobFlatPos(b);
  assert.ok(Math.abs(pa.x - a.x) < 1e-9 && Math.abs(pb.z - pa.z - JOBCARD.CHIP) < 1e-9, '판 앞쪽(+z)으로 늘어섬');
  assert.ok(Math.abs(pa.z - a.z) < 0.45, '랙 판의 칩은 랙 위(위에서 본 판 자리)');
  const before = [...lay.machine.entries()].filter(([, m]) => m.type === 'job').map(([id, m]) => [id, jobFlatPos(m)]);
  rotateOffice(lay, 1, 0, 0);
  for (const [id, p] of before) {
    const q = jobFlatPos(lay.machine.get(id));
    // 90° 돌림: (x, z) → (−z, x) 또는 (z, −x) — 둘 중 하나와 같아야 한다(회전 방향 규약에 무관)
    const ok = (Math.abs(q.x + p.z) < 1e-6 && Math.abs(q.z - p.x) < 1e-6) || (Math.abs(q.x - p.z) < 1e-6 && Math.abs(q.z + p.x) < 1e-6);
    assert.ok(ok, id + ' 칩이 카드와 같이 돌지 않음');
  }
});

test('이름표·2D 색: 끝나지 않은 작업만 늘 이름표, 정체 색은 호박과 빨강 사이', () => {
  ord = 0;
  assert.ok(jobLabelAlways(J('b:x', 'a'), T0));
  assert.ok(jobLabelAlways(J('b:x', 'w', { state: 'waiting' }), T0));
  assert.ok(!jobLabelAlways(J('b:x', 'd', { state: 'done' }), T0));
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHex('rgb(1,2,3)', '#ffffff', 0.5), 'rgb(1,2,3)');
  const tok = { skill: '#facc15', ok: '#34d399', error: '#ef4444' }, pal = { jobWait: '#5b8fd6', jobQueue: '#7b8494' };
  assert.equal(jobColorHex('running', tok, pal), tok.skill);
  assert.equal(jobColorHex('waiting', tok, pal), pal.jobWait);
  assert.equal(jobColorHex('done', tok, pal), tok.ok);
  assert.equal(jobColorHex('failed', tok, pal), tok.error);
  const st = jobColorHex('stale', tok, pal);
  assert.ok(st !== tok.skill && st !== tok.error && /^#[0-9a-f]{6}$/.test(st));
});

test('3D 판은 기준 방향에서 카메라 쪽으로 ±60° 안에서 돌고, 뒤쪽 카메라면 뒷면(양면 카드)을 맞춘다', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(jobBoardYaw(0, 0.3), 0.3), '앞쪽 카메라: 그대로 따라감');
  assert.ok(near(jobBoardYaw(0, 1.4), JOB_YAW_LIM), '한계에서 멈춤');
  assert.ok(near(jobBoardYaw(0, Math.PI - 0.2), -0.2), '뒤쪽 카메라: 뒷면이 보게');
  assert.ok(near(jobBoardYaw(-Math.PI / 2, Math.PI / 2), -Math.PI / 2), '정반대 뒤 = 뒷면 정면(돌 필요 없음)');
  assert.ok(near(jobBoardYaw(0.5, NaN), 0.5));
  for (let c = -Math.PI; c <= Math.PI; c += 0.1) {
    const y = jobBoardYaw(0, c);
    const off = Math.min(Math.abs(Math.atan2(Math.sin(c - y), Math.cos(c - y))), Math.abs(Math.atan2(Math.sin(c - y - Math.PI), Math.cos(c - y - Math.PI))));
    assert.ok(Math.abs(y) <= JOB_YAW_LIM + 1e-9 && off <= Math.PI / 2 - JOB_YAW_LIM + 1e-6, '어느 카메라에서도 앞·뒷면 중 하나가 30° 안');
  }
});
