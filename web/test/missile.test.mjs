// 사용자 입력 빛줄기 — 테두리 모임·발사 곡선·꼬리·화면 밖 목표·카메라 따라가기 판단
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARGE, flightDur, missileDur, flightEase, bez, trailAt, TRAIL, borderPoint, pickBorder, flightCurve, edgeClamp, promptCamPlan, launchDelay, PROMPT_CAM, MISSILE_REDUCED, ABSORB_FROM } from '../missile-core.mjs';

test('시간: 모임 0.25～0.4초 + 발사 0.6～0.9초(화면 거리 비례) = 0.9～1.3초 · 움직임 줄이기는 짧게', () => {
  assert.ok(CHARGE.dur >= 0.25 && CHARGE.dur <= 0.4);
  assert.equal(flightDur(0), 0.6); assert.equal(flightDur(1e6), 0.9); assert.ok(flightDur(800) > flightDur(200));
  assert.ok(missileDur(0) >= 0.9 && missileDur(1e6) <= 1.3);
  assert.ok(MISSILE_REDUCED.dur < 0.6 && ABSORB_FROM > 0.7 && ABSORB_FROM < 1);
});

test('발사 진행: 처음부터 움직이고(속도 > 0) 끝으로 갈수록 가속(ease-in), 단조', () => {
  assert.equal(flightEase(0), 0); assert.equal(flightEase(1), 1);
  assert.ok(flightEase(0.05) > 0.01, '출발 속도 0 이 아님');
  assert.ok(flightEase(1) - flightEase(0.9) > flightEase(0.1) - flightEase(0), '끝이 더 빠름');
  let prev = -1; for (let k = 0; k <= 1.0001; k += 0.05) { const t = flightEase(k); assert.ok(t >= prev); prev = t; }
});

test('테두리: 둘레 매개변수 → 네 변 · 모일 점은 목표와 떨어지고 모서리 코앞은 피함 · 안쪽으로 들임', () => {
  const W = 1440, H = 900;
  assert.equal(borderPoint(W, H, 0.1).edge, 'top'); assert.equal(borderPoint(W, H, 0.4).edge, 'right');
  assert.equal(borderPoint(W, H, 0.6).edge, 'bottom'); assert.equal(borderPoint(W, H, 0.9).edge, 'left');
  let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const edges = new Set();
  for (let i = 0; i < 40; i++) {
    const g = pickBorder(W, H, 700, 420, rnd);
    edges.add(g.edge);
    assert.ok(Math.hypot(700 - g.gx, 420 - g.gy) >= Math.min(W, H) * 0.3, '목표와 떨어짐');
    const along = g.edge === 'top' || g.edge === 'bottom' ? g.x : g.y, len = g.edge === 'top' || g.edge === 'bottom' ? W : H;
    assert.ok(along >= 48 && along <= len - 48, '모서리 피함');
    assert.ok(g.gx > 0 && g.gx < W && g.gy > 0 && g.gy < H, '모임 점은 화면 안');
  }
  assert.ok(edges.size >= 3, `무작위 방향(변 ${[...edges]})`);
});

test('곡선: 처음엔 바깥으로 휘었다가 목표로 감겨 들어감 · 끝점 = 목표 · 지나치지 않음', () => {
  const g = { gx: 100, gy: 26, nx: 0, ny: 1, edge: 'top' }, T = { x: 900, y: 500 };
  for (const side of [1, -1]) {
    const C = flightCurve(g, T, side), c2 = { x: T.x + C.off2.x, y: T.y + C.off2.y };
    const end = bez({}, C.p0, C.c1, c2, T, 1); assert.ok(Math.abs(end.x - T.x) < 1e-9 && Math.abs(end.y - T.y) < 1e-9);
    const d0 = Math.atan2(C.c1.y - g.gy, C.c1.x - g.gx), dT = Math.atan2(T.y - g.gy, T.x - g.gx);
    assert.ok(Math.abs(d0 - dT) > 0.15, '바깥으로 휨');
    let prev = Infinity, up = 0;
    for (let t = 0; t <= 1.0001; t += 0.02) { const p = bez({}, C.p0, C.c1, c2, T, t); const d = Math.hypot(p.x - T.x, p.y - T.y); if (d > prev + 1) up++; prev = d; }
    assert.ok(up <= 3, `되돌아옴 ${up}`);
  }
});

test('꼬리: 머리에서 끝으로 가늘고 투명 · 흡수 때 끝이 머리 쪽으로 당겨짐 · 화면 px 폭', () => {
  const a = trailAt(0.8, 0), b = trailAt(0.8, TRAIL.N - 1);
  assert.equal(a.t, 0.8); assert.ok(b.t < a.t && b.w < 0.05 && b.a < 0.05 && a.w === 1 && a.a === 1);
  for (let i = 1; i < TRAIL.N; i++) assert.ok(trailAt(0.6, i).t <= trailAt(0.6, i - 1).t);
  assert.ok(trailAt(1, TRAIL.N - 1, TRAIL.N, TRAIL.SPAN, 0.9).t >= 0.9, '흡수 중 꼬리 끝');
  assert.ok(TRAIL.W >= 2 && TRAIL.W <= 5);
});

test('화면 밖 목표: 가운데 → 목표 방향 가장자리 · 카메라 뒤는 반대쪽', () => {
  const W = 1000, H = 600;
  assert.deepEqual(edgeClamp(W, H, 500, 300), { x: 500, y: 300, on: true });
  const r = edgeClamp(W, H, 3000, 300); assert.equal(r.on, false); assert.ok(Math.abs(r.x - (W - 14)) < 1e-9 && Math.abs(r.y - 300) < 1e-9);
  const b = edgeClamp(W, H, 600, 300, 14, true); assert.equal(b.on, false); assert.ok(b.x < W / 2, '뒤 = 반대쪽');
});

test('카메라 따라가기(Follow my prompts): 기본 이동 · 수동 조작·팝업·자동 카메라 끔·일시정지·빠른 재생이면 안 옮김 · 발사는 이동 끝 무렵', () => {
  const p = promptCamPlan({});
  assert.ok(p.move && p.dur >= 0.6 && p.dur <= 0.9 && p.hold >= 2 && p.hold <= 3);
  for (const o of [{ follow: false }, { manual: true }, { hold: true }, { enabled: false }, { paused: true }, { speed: 8 }, { has: false }, { dragging: true }]) assert.equal(promptCamPlan(o).move, false, JSON.stringify(o));
  assert.ok(promptCamPlan({ speed: 4 }).dur < p.dur, '배속이 크면 짧게');
  assert.equal(launchDelay(0), 0);
  const d = launchDelay(PROMPT_CAM.dur); assert.ok(d < PROMPT_CAM.dur && d + CHARGE.dur > PROMPT_CAM.dur, '모임이 이동 끝과 겹치고 발사는 도착 뒤');
});
