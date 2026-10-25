// 라벨 배치·맞춤 띠·전체 보기 간격 시험. 합성 값만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { placeLabels, boxDisc, boxHit, labelBox } from '../label-place.mjs';
import { safeBand, overlayInsets } from '../camera-core.mjs';
import { computeOverview } from '../overview/layout.mjs';

const full = (w = 200, h = 44) => ({ compact: false, w, h });
const small = (w = 90, h = 30) => ({ compact: true, w, h });

test('라벨 상자: 아래 붙음은 기준점 + 간격부터, 위 붙음은 기준점 − 간격까지', () => {
  assert.deepEqual(labelBox({ x: 100, y: 50, up: false, gap: 10 }, { w: 40, h: 20 }, 0), [80, 60, 120, 80]);
  assert.deepEqual(labelBox({ x: 100, y: 50, up: true, gap: 10 }, { w: 40, h: 20 }, 5), [80, 15, 120, 35]);
  assert.ok(boxDisc([0, 0, 10, 10], { x: 12, y: 5, r: 3 }));
  assert.ok(!boxDisc([0, 0, 10, 10], { x: 14, y: 14, r: 3 }));
  assert.ok(boxHit([0, 0, 10, 10], [9, 9, 20, 20]) && !boxHit([0, 0, 10, 10], [10, 0, 20, 10]));
});

test('긴 라벨이 이웃 노드 원판에 걸치면 줄임 모드, 그래도 걸치면 숨김 — 자기 노드는 장애물 아님', () => {
  // 노드 A(100,100) 라벨 아래로, 이웃 B 가 (180,130) — 보통 폭 200 이면 B 를 덮고, 줄임 폭 90 이면 비킴
  const discs = [{ id: 'A', x: 100, y: 100, r: 14 }, { id: 'B', x: 180, y: 130, r: 14 }];
  const r = placeLabels([{ id: 'A', x: 100, y: 100, up: false, gap: 18, modes: [full(), small()] }], discs);
  assert.equal(r.get('A').compact, true);
  assert.equal(r.get('A').dim, false);
  // B 가 바로 아래면 줄여도 걸침 → 숨김
  const r2 = placeLabels([{ id: 'A', x: 100, y: 100, up: false, gap: 18, modes: [full(), small()] }], [discs[0], { id: 'B', x: 100, y: 130, r: 14 }]);
  assert.equal(r2.has('A'), false);
});

test('고정 라벨(pin)은 노드에 걸쳐도 흐리게 남고(작은 쪽), force 는 그대로, 라벨끼리 겹침은 pin 도 숨김', () => {
  const discs = [{ id: 'A', x: 100, y: 100, r: 14 }, { id: 'B', x: 100, y: 130, r: 14 }];
  const c = { id: 'A', x: 100, y: 100, up: false, gap: 18, modes: [full(), small()] };
  const p = placeLabels([{ ...c, pin: true }], discs).get('A');
  assert.equal(p.dim, true); assert.equal(p.compact, true);
  const f = placeLabels([{ ...c, force: true, modes: [full()] }], discs).get('A');
  assert.equal(f.dim, false); assert.equal(f.compact, false);
  // 먼저 놓인 라벨과 겹치면 pin 이어도 숨김
  const r = placeLabels([{ id: 'X', x: 100, y: 100, up: false, gap: 18, force: true, modes: [full()] }, { ...c, id: 'A2', pin: true }], []);
  assert.equal(r.has('A2'), false);
});

test('밀기(shifts): 아래로 밀어 빈 자리를 찾는다', () => {
  const r = placeLabels([
    { id: 'A', x: 100, y: 100, up: false, gap: 0, modes: [{ w: 60, h: 14 }] },
    { id: 'B', x: 110, y: 100, up: false, gap: 0, modes: [{ w: 60, h: 14 }] },
  ], [], { shifts: [0, 14, 28] });
  assert.equal(r.get('A').dy, 0);
  assert.equal(r.get('B').dy, 14);
});

test('화면 가로 밖으로 잘리는 자리는 피해 옆으로 비킨다(bounds)', () => {
  const r = placeLabels([{ id: 'A', x: 380, y: 100, up: false, gap: 10, modes: [{ w: 120, h: 20 }] }], [], { shifts: [0, [-0.42, 0]], bounds: [0, 390] });
  assert.equal(r.get('A').dx, -50);
  assert.equal(r.get('A').dim, false);
});

test('맞춤 띠: 아래가 덮이면 띠가 줄고 가운데가 위로(yc > 0), 너무 덮이면 40% 로 묶음', () => {
  const b = safeBand(800, 0, 160);
  assert.equal(b.k, 0.8); assert.equal(b.yc, 0.2);
  assert.deepEqual(safeBand(800, 0, 0), { k: 1, yc: 0 });
  const c = safeBand(400, 0, 1000);
  assert.ok(Math.abs(c.k - 0.4) < 1e-9 && c.yc > 0);
});

test('덮개 높이: 무대 아래쪽 띠·타임라인은 아래, 가로로 무대 밖(패널 쪽)은 무시', () => {
  const st = { top: 48, bottom: 900, left: 0, right: 1080 };
  const ins = overlayInsets(st, [
    { top: 870, bottom: 900, left: 0, right: 1080 },   // 이벤트 띠
    { top: 770, bottom: 870, left: 0, right: 1080 },   // 매크로 타임라인
    { top: 100, bottom: 900, left: 1080, right: 1440 }, // 패널(무대 밖)
  ]);
  assert.deepEqual(ins, { top: 0, bottom: 130 });
  // 좁은 화면: 무대 아래 끝(45vh 위)에 걸친 띠
  assert.deepEqual(overlayInsets({ top: 48, bottom: 500, left: 0, right: 390 }, [{ top: 470, bottom: 500, left: 0, right: 390 }]), { top: 0, bottom: 30 });
});

test('전체 보기 간격(spread): 섬 안 메인 → 자식 거리가 배율만큼, 기본 1 은 예전과 같음', () => {
  const N = (id, kind, parentId) => ({ id, kind, parentId, status: 'active', projectId: 'P', label: id, meta: {}, startedAt: '2026-10-24T01:00:00Z' });
  const nodes = new Map([['m', N('m', 'main', null)], ['a', N('a', 'subagent', 'm')], ['b', N('b', 'subagent', 'm')]]);
  const roots = [{ nodeId: 'm', projectId: 'P' }];
  const d = (ov) => { const m = ov.pos.get('m'), a = ov.pos.get('a'); return Math.hypot(a.x - m.x, a.z - m.z); };
  const o1 = computeOverview(nodes, roots, [], null, { nowMs: Date.parse('2026-10-24T01:01:00Z') });
  const o13 = computeOverview(nodes, roots, [], null, { nowMs: Date.parse('2026-10-24T01:01:00Z'), spread: 1.3 });
  assert.ok(Math.abs(d(o13) / d(o1) - 1.3) < 1e-6);
  assert.ok(o13.clusters[0].r > o1.clusters[0].r);
});

test('실황 줄: 첫 줄 시간·에이전트명, 내용은 둘째 줄 에이전트명 칸부터(CSS 격자)', () => {
  const css = fs.readFileSync(new URL('../theme.css', import.meta.url), 'utf8');
  assert.match(css, /\.ln \{ display: grid; grid-template-columns: auto minmax\(0, 1fr\);/);
  assert.match(css, /\.ln \.msg \{ grid-column: 2; grid-row: 2; \}/);
  const tl = fs.readFileSync(new URL('../timeline.mjs', import.meta.url), 'utf8');
  assert.match(tl, /<div class="tt-row"><time>/);
});
