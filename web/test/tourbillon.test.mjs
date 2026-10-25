// Planet 뚜르비용 — 이스케이프먼트 박자·상태 연동·째깍(끊어 돌기)·LOD·2D 그리기 호출
import test from 'node:test';
import assert from 'node:assert/strict';
import { Escapement, TOURB, TOURB_GEO, tickEase, TICK_FRAC, tourbLod, TOURB_LOD, RATIO, pinionAngle, tickKick, KICK, GEAR_M, PINION_R, ESC_ARBOR } from '../tourbillon-core.mjs';

const run = (e, mode, sec, dt = 1 / 60) => { for (let t = 0; t < sec; t += dt) e.step(dt, mode); return e; };

test('상태 표: 도구 > 생각 > 대기 > 오류 > 완료(멈춤) — 박·케이지·진폭', () => {
  const order = ['tool', 'think', 'wait', 'error', 'off'];
  for (const k of ['beat', 'cage', 'amp']) for (let i = 1; i < order.length; i++) assert.ok(TOURB[order[i - 1]][k] > TOURB[order[i]][k] || (order[i] === 'off' && TOURB.off[k] === 0), `${k} ${order[i - 1]} > ${order[i]}`);
  assert.deepEqual(TOURB.off, { beat: 0, cage: 0, amp: 0 });
});

test('이스케이프먼트: 박마다 톱니 하나씩 째깍, 케이지 평균 속도 = 표, 일할 때 더 빠름', () => {
  const a = run(new Escapement(0.1), 'tool', 12), b = run(new Escapement(0.1), 'wait', 12);
  assert.ok(a.ticks > b.ticks * 2.5, `도구 박 ${a.ticks} > 대기 박 ${b.ticks}`);
  // 정상 상태 10초 동안 박 수 ≈ beat × 10
  const e = run(new Escapement(0.3), 'think', 5); const t0 = e.ticks, c0 = e.cage; run(e, 'think', 10);
  assert.ok(Math.abs((e.ticks - t0) - TOURB.think.beat * 10) <= 2, `박 수 ${e.ticks - t0}`);
  assert.ok(Math.abs((e.cage - c0) - TOURB.think.cage * 10) < TOURB.think.cage * 1.2, `케이지 평균 속도 ${(e.cage - c0) / 10}`);
  // 이스케이프 휠 = 박 수 × 한 톱니 각(박 사이 멈춤 구간에서 정확히)
  const tooth = (2 * Math.PI) / TOURB_GEO.ESC_TEETH;
  const k = e.ph - Math.floor(e.ph); if (k > TICK_FRAC) assert.ok(Math.abs(e.esc - e.ticks * tooth) < 1e-9, "멈춤 구간 휠 = 박 수 × 톱니");
});

test('째깍: 한 박 안에서 처음 TICK_FRAC 동안만 움직이고 나머지는 멈춤 · 앵커는 박마다 좌우 교대', () => {
  assert.equal(tickEase(0), 0); assert.equal(tickEase(TICK_FRAC), 1); assert.equal(tickEase(0.7), 1);
  assert.ok(tickEase(TICK_FRAC / 2) > 0.5 && tickEase(TICK_FRAC / 2) < 1, 'ease-out');
  const e = run(new Escapement(0), 'tool', 3);
  // 박 사이 멈춤 구간에서 케이지·휠이 그대로
  let still = 0, moved = 0, prevSide = null, flips = 0;
  for (let i = 0; i < 240; i++) {
    const c = e.cage, s = e.esc; e.step(1 / 240, 'tool');
    const f = e.ph - Math.floor(e.ph);
    if (f > TICK_FRAC + 0.02 && !e.tick) { if (e.cage === c && e.esc === s) still++; else moved++; }
    const side = Math.sign(e.pallet); if (f > TICK_FRAC && side) { if (prevSide != null && side !== prevSide) flips++; prevSide = side; }
  }
  assert.ok(still > 50 && moved === 0, `멈춤 구간 ${still}, 움직임 ${moved}`);
  assert.ok(flips >= 3, `앵커 교대 ${flips}`);
});

test('완료·중지: 진폭이 잦아들고 박·케이지가 멈춤 · 다시 일하면 재개 · 움직임 줄이기는 느리게', () => {
  const e = run(new Escapement(0.5), 'tool', 4);
  run(e, 'off', 6);
  const c = e.cage, n = e.ticks; run(e, 'off', 3);
  assert.equal(e.cage, c); assert.equal(e.ticks, n); assert.ok(Math.abs(e.bal) < 0.05, `밸런스 ${e.bal}`);
  run(e, 'tool', 3); assert.ok(e.ticks > n + 5, '재개');
  const r = new Escapement(0.5), q = new Escapement(0.5);
  for (let i = 0; i < 600; i++) { r.step(1 / 60, 'tool', { reduced: true }); q.step(1 / 60, 'tool'); }
  assert.ok(r.ticks < q.ticks * 0.4, '움직임 줄이기 = 느린 박');
  // 긴 dt(탭 복귀)에도 값이 유한
  e.step(5, 'tool'); assert.ok(Number.isFinite(e.cage) && Number.isFinite(e.bal));
});

test('LOD: 멀면 몸체만, 실루엣(테·톱니) → 기어 트레인 → 잔부품 · 위계(밸런스 < 안쪽 케이지 < 바깥 테 < 4번 휠)', () => {
  assert.equal(tourbLod(TOURB_LOD.HIDE_PX - 0.5), 0);
  assert.equal(tourbLod(TOURB_LOD.HIDE_PX + 1), 1);
  assert.equal(tourbLod(TOURB_LOD.GEAR_PX + 1), 2);
  assert.equal(tourbLod(TOURB_LOD.DETAIL_PX + 1), 3);
  assert.ok(TOURB_LOD.HIDE_PX <= 4 && TOURB_LOD.GEAR_PX <= 10, '기본 카메라 거리에서도 기어·프레임');
  assert.ok(TOURB_LOD.SUB_PX > TOURB_LOD.HIDE_PX);
  const G = TOURB_GEO;
  assert.ok(G.CORE_K < G.BAL_R && G.BAL_R < G.INNER_R && G.INNER_R < G.CAGE_R && G.CAGE_R < G.FOURTH_R, '코어 < 밸런스 < 안쪽 케이지 < 케이지 테 < 4번 휠');
  assert.ok(G.FOURTH_Z >= 48 && G.ESC_TEETH === 15 && G.FOURTH_SPOKES >= 5, '톱니·살이 실제 기어처럼');
});

test('기어 트레인: 피니언이 4번 휠 위를 구름(회전비·맞물림 위상) · 케이지 = 이스케이프 각 / 회전비 · 상태 표 케이지 속도', () => {
  assert.equal(RATIO, TOURB_GEO.FOURTH_Z / TOURB_GEO.PINION_Z);
  assert.ok(Math.abs(ESC_ARBOR - (TOURB_GEO.FOURTH_R + PINION_R)) < 1e-12 && Math.abs(PINION_R - GEAR_M * TOURB_GEO.PINION_Z / 2) < 1e-12, '같은 모듈 → 굴대 거리 = 피치 반지름 합');
  const p4 = (2 * Math.PI) / TOURB_GEO.FOURTH_Z, pp = (2 * Math.PI) / TOURB_GEO.PINION_Z, aE = 0.7;
  for (const c of [0, 0.3, 1.1]) { const d = pinionAngle(c + p4, aE) - pinionAngle(c, aE); assert.ok(Math.abs(d - pp) < 1e-9, '4번 휠 한 피치 = 피니언 한 피치'); }
  const c0 = 0.5 * p4 - aE; const k = (pinionAngle(c0, aE) - (aE + Math.PI)) / pp; assert.ok(Math.abs(k - Math.round(k)) < 1e-9, '맞물림 위상');
  const e = run(new Escapement(0.2), 'tool', 4); assert.ok(Math.abs((e.cage - e.base) * RATIO - e.esc) < 1e-9, '케이지 = 이스케이프 / 회전비');
  for (const m of ['tool', 'think', 'wait', 'error']) assert.ok(Math.abs(TOURB[m].cage - (TOURB[m].beat * 2 * Math.PI / 15) / RATIO) < 1e-3, m);
});

test('반동: 째깍 직후 짧게 되튀고 사라짐 · esc 에는 섞이지 않음', () => {
  assert.equal(tickKick(0.05), 0); assert.equal(tickKick(TICK_FRAC + KICK.LEN + 0.01), 0);
  let mx = 0; for (let f = TICK_FRAC; f < TICK_FRAC + KICK.LEN; f += 0.005) mx = Math.max(mx, Math.abs(tickKick(f)));
  assert.ok(mx > 0.02 && mx <= KICK.AMP, `반동 ${mx}`);
});

test('2D: 메인 자이로·서브 단일 케이지를 그리고 작으면 생략', async () => {
  const { drawTourb2D } = await import('../flat/planet-deco2d.js');
  const calls = { arc: 0, stroke: 0 };
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (k === 'arc' ? () => calls.arc++ : k === 'stroke' ? () => calls.stroke++ : () => {})), set: (o, k, v) => { o[k] = v; return true; } });
  const view = { tokens: { isLight: false }, reduced: false };
  const v = { id: 'm1', node: { status: 'active' }, icons: new Set([1]) };
  drawTourb2D(view, ctx, v, 100, 100, 30, 1, 1, true);
  const big = calls.arc; assert.ok(big > 12, `메인 호 ${big}`);
  calls.arc = 0; drawTourb2D(view, ctx, { ...v, id: 's1' }, 100, 100, 30, 1, 1, false); assert.ok(calls.arc > 1 && calls.arc < big, '서브는 단순');
  calls.arc = 0; drawTourb2D(view, ctx, v, 100, 100, 3, 1, 1.1, true); assert.equal(calls.arc, 0, '작으면 생략');
});
