// 매크로 타임라인 순수 부분: 정렬·줄 배치(겹침 회피)·자식 붙이기·시간↔화면 변환·눈금·클릭 의도
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MT, normalizeSessions, attachChildren, packLanes, makeScale, clampPx, domainOf, zoomAround, defaultWindow, ticks,
  clickIntent, timeInBar, summarizeProjects, fmtRange, localMidnight, edgeFor, refEnd, fitWindow } from '../macro/macro-core.mjs';

const H = 3_600_000, D = 86_400_000;
const NOW = Date.parse('2026-10-23T12:00:00Z');
const iso = (t) => new Date(t).toISOString();
const S = (id, a, b, extra = {}) => ({ sessionId: id, projectDir: 'P', startedAt: iso(NOW + a * H), endedAt: iso(NOW + b * H), ...extra });

test('normalizeSessions: 시작 오름차순, 실행 중은 끝 = 지금, 시각 없는 항목 제외, 끝 < 시작 보정', () => {
  const list = normalizeSessions([
    S('c', -2, -1), S('a', -10, -9), S('b', -5, -4.5, { running: true, liveStatus: 'busy' }),
    { sessionId: 'x' }, { sessionId: 'y', startedAt: iso(NOW - H), endedAt: iso(NOW - 2 * H) },
    { sessionId: 'z', endedAt: iso(NOW - 3 * H) },
  ], NOW);
  assert.deepEqual(list.map((x) => x.id), ['a', 'b', 'z', 'c', 'y']);
  const b = list.find((x) => x.id === 'b');
  assert.equal(b.end, NOW); assert.ok(b.running && b.busy);
  const y = list.find((x) => x.id === 'y'); assert.equal(y.end, y.start);
  const z = list.find((x) => x.id === 'z'); assert.equal(z.start, z.end, '시작 없으면 끝을 시작으로');
});

test('packLanes: 같은 줄 막대는 겹치지 않고(간격 포함), 줄 수는 최대 동시 실행 수', () => {
  // 무작위 120개, 시드 고정
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const raw = [];
  for (let i = 0; i < 120; i++) { const a = -rnd() * 240, d = rnd() * 6; raw.push(S('s' + i, a, a + d)); }
  const items = normalizeSessions(raw, NOW);
  const gapMs = 10 * 60_000, minMs = 20 * 60_000;
  const n = packLanes(items, { gapMs, minMs });
  const byLane = new Map();
  for (const it of items) { if (!byLane.has(it.lane)) byLane.set(it.lane, []); byLane.get(it.lane).push(it); }
  for (const arr of byLane.values()) {
    arr.sort((p, q) => p.start - q.start);
    for (let i = 1; i < arr.length; i++) {
      const prevEnd = Math.max(arr[i - 1].end, arr[i - 1].start + minMs);
      assert.ok(arr[i].start >= prevEnd + gapMs, `겹침: ${arr[i - 1].id} ${arr[i].id}`);
    }
  }
  // 하한: 어떤 시점에 동시에 걸친(최소 폭 포함) 막대 수 ≤ 줄 수
  let maxOverlap = 0;
  for (const it of items) { const t = it.start; maxOverlap = Math.max(maxOverlap, items.filter((x) => x.start <= t && Math.max(x.end, x.start + minMs) > t).length); }
  assert.ok(n >= maxOverlap && n <= items.length);
  assert.equal(packLanes([]), 0);
  // 겹치지 않는 둘은 한 줄
  const two = normalizeSessions([S('a', -5, -4), S('b', -3, -2)], NOW);
  assert.equal(packLanes(two), 1);
});

test('attachChildren: parentSessionId 우선, 없으면 시작 시각을 품은 가장 늦은 메인, 못 찾으면 orphans', () => {
  const items = normalizeSessions([
    S('m1', -10, -2), S('m2', -6, -5), S('k1', -5.5, -5.4, { isChild: true }), S('k2', -9, -8, { isChild: true, parentSessionId: 'm2' }),
    S('k3', -1, -0.5, { isChild: true }), S('k4', -3, -2.9, { entrypoint: 'sdk-cli' }),
  ], NOW);
  const { mains, orphans } = attachChildren(items);
  const m = Object.fromEntries(mains.map((x) => [x.id, x.children.map((c) => c.id).sort()]));
  assert.deepEqual(m.m2, ['k1', 'k2'], 'k1 은 m1·m2 둘 다 품지만 늦게 시작한 m2, k2 는 부모 지정');
  assert.deepEqual(m.m1, ['k4']);
  assert.deepEqual(orphans.map((x) => x.id), ['k3']);
});

test('시간↔화면 변환·확대 기준점 보존·축척 한도', () => {
  const sc = makeScale(1000, 0.5);
  assert.equal(sc.x(1000), 0); assert.equal(sc.x(3000), 1000); assert.equal(sc.t(sc.x(12345)), 12345);
  assert.equal(clampPx(1), MT.MAX_PX_PER_MS); assert.equal(clampPx(0), MT.MIN_PX_PER_MS);
  const st = { pxPerMs: 1 / 60_000, scrollLeft: 500, d0: NOW - D };
  const cursor = 300;
  const tBefore = st.d0 + (st.scrollLeft + cursor) / st.pxPerMs;
  const z = zoomAround(st, 2, cursor);
  assert.ok(Math.abs(z.pxPerMs - 2 / 60_000) < 1e-15);
  const tAfter = st.d0 + (z.scrollLeft + cursor) / z.pxPerMs;
  assert.ok(Math.abs(tAfter - tBefore) < 1, '커서 아래 시각 그대로');
  // 범위: 가장 이른 시작 포함, 지금 뒤 여백, 폭 상한
  const items = normalizeSessions([S('a', -100, -99)], NOW);
  const dom = domainOf(items, NOW, 1 / H, 10 * H);
  assert.ok(dom.d0 <= NOW - 100 * H && dom.d1 > NOW);
  const big = domainOf(normalizeSessions([S('old', -24 * 365, -24 * 364)], NOW), NOW, MT.MAX_PX_PER_MS, 1000 / MT.MAX_PX_PER_MS);
  assert.ok((big.d1 - big.d0) * MT.MAX_PX_PER_MS <= MT.MAX_INNER_PX + 1);
});

test('defaultWindow: 최근 세션이면 1～3일 구간 끝 = 지금(+여백), 오래된 것만 있으면 그 구간 맞춤', () => {
  const w1 = defaultWindow(normalizeSessions([S('a', -2, -1)], NOW), NOW);
  assert.ok(w1.t1 > NOW && w1.t1 - w1.t0 >= D && w1.t1 - w1.t0 <= 3.2 * D);
  const w2 = defaultWindow(normalizeSessions([S('a', -10 * 24, -10 * 24 + 1), S('b', -9 * 24, -9 * 24 + 2)], NOW), NOW);
  assert.ok(w2.t0 < NOW - 10 * 24 * H && w2.t1 < NOW - 8 * 24 * H, '지금까지 늘리지 않음');
  const w3 = defaultWindow([], NOW); assert.ok(w3.t1 > w3.t0);
});

test('ticks: 화면 간격 이상인 단계, 자정 정렬, 날 표식', () => {
  const t0 = NOW - 3 * D, t1 = NOW;
  const r = ticks(t0, t1, 64 / (6 * H)); // 6시간 = 64px → 6시간 단계
  assert.equal(r.step, 6 * H);
  for (const k of r.ticks) { const d = new Date(k.t); assert.equal(d.getHours() % 6, 0); assert.equal(d.getMinutes(), 0); }
  assert.ok(r.ticks.some((k) => k.day && /^\d+\/\d+ \(.\)$/.test(k.label)));
  assert.ok(r.ticks.filter((k) => !k.day).every((k) => /시$/.test(k.label)));
  for (let i = 1; i < r.ticks.length; i++) assert.ok(r.ticks[i].t > r.ticks[i - 1].t);
  const w = ticks(NOW - 60 * D, NOW, 64 / (7 * D));
  assert.equal(w.step, 7 * D);
  for (const k of w.ticks) { assert.equal(new Date(k.t).getDay(), 1, '주 단계는 월요일'); assert.equal(k.t, localMidnight(k.t)); }
});

test('clickIntent·timeInBar: 앞 끝 처음부터, 실행 중 뒤 끝 실시간, 그 밖은 그 시각', () => {
  const it = { start: 0, end: 1000, running: false }, run = { ...it, running: true };
  assert.equal(clickIntent(it, 5, 200), 'start');
  assert.equal(clickIntent(it, 100, 200), 'at');
  assert.equal(clickIntent(it, 195, 200), 'at');
  assert.equal(clickIntent(run, 195, 200), 'live');
  // 끝 영역은 막대 폭에 비례(18%, 2px～12px) — 좁은 막대도 대부분은 그 시각부터
  assert.equal(clickIntent(it, 10, 20), 'at', '좁은 막대도 앞 끝 밖은 그 시각부터');
  assert.equal(clickIntent(it, 3, 20), 'start', '좁은 막대 앞 3.6px 안은 처음부터');
  assert.equal(clickIntent(it, 3, 6), 'at'); assert.equal(clickIntent(it, 1.5, 6), 'start');
  assert.equal(edgeFor(200), MT.EDGE_PX); assert.ok(Math.abs(edgeFor(20) - 3.6) < 1e-9); assert.equal(edgeFor(4), 2);
  assert.equal(timeInBar(it, 50, 200), 250);
  assert.equal(timeInBar(it, -5, 200), 0); assert.equal(timeInBar(it, 500, 200), 1000);
});

test('summarizeProjects·fmtRange', () => {
  const items = normalizeSessions([S('a', -5, -4, { projectDir: 'A' }), S('b', -3, -2, { projectDir: 'B' }), S('c', -9, -8, { projectDir: 'C', running: true }),
    S('k', -3, -2.5, { projectDir: 'B', isChild: true })], NOW);
  const rows = summarizeProjects(items, new Map([['A', '알파']]));
  assert.deepEqual(rows.map((r) => r.projectId), ['C', 'B', 'A'], '실행 중 먼저, 그다음 최근 끝난 순');
  assert.equal(rows.find((r) => r.projectId === 'A').name, '알파');
  assert.equal(rows.find((r) => r.projectId === 'B').items.length, 1, '자식 제외');
  const a = new Date(2026, 9, 21, 14, 3).getTime(), b = new Date(2026, 9, 21, 16, 20).getTime(), c = new Date(2026, 9, 22, 1, 5).getTime();
  assert.equal(fmtRange(a, b), '10/21 (수) 14:03 – 16:20');
  assert.equal(fmtRange(a, c), '10/21 (수) 14:03 – 10/22 (목) 01:05');
});

test('보관함 시간축(§63): 오른쪽 끝 = 보관 세션 마지막 끝(지금 아님), 처음 구간 = 보관 세션 맞춤', () => {
  const items = normalizeSessions([S('a', -30 * 24, -29 * 24), S('b', -20 * 24, -19.5 * 24), S('k', -19.9 * 24, -19.8 * 24, { isChild: true })], NOW);
  const lastEnd = Math.max(...items.map((x) => x.end));
  assert.equal(refEnd(items, 'archive', NOW), lastEnd);
  assert.ok(lastEnd < NOW - 18 * D);
  assert.equal(refEnd(items, 'project', NOW), NOW, '보관함 밖은 지금');
  assert.equal(refEnd([], 'archive', NOW), NOW, '비면 지금');
  const w = fitWindow(items, NOW);
  assert.ok(w.t0 < items[0].start && w.t1 > lastEnd && w.t1 < NOW - 18 * D, '처음 구간이 보관 세션을 감싸고 지금까지 늘지 않음');
  const px = clampPx(1200 / (w.t1 - w.t0));
  const dom = domainOf(items, refEnd(items, 'archive', NOW), px, 1200 / px);
  assert.ok(dom.d1 < NOW - 18 * D, '안쪽 범위 오른쪽 끝도 마지막 끝 근처');
});

test('보관함 축척 하한(§66.10): 4주 넘는 보관함도 처음 구간·맞춤이 전체를 한 화면에, 긴 축척 눈금 2주·4주', async () => {
  const { minPxFor } = await import('../macro/macro-core.mjs');
  const items = normalizeSessions([S('a', -120 * 24, -119 * 24), S('b', -60 * 24, -59 * 24), S('c', -2 * 24, -1 * 24)], NOW);
  const w = fitWindow(items, NOW);
  const W = 900;
  const pxOld = clampPx(W / (w.t1 - w.t0));
  const pxArc = clampPx(W / (w.t1 - w.t0), minPxFor('archive'));
  assert.ok((w.t1 - w.t0) * pxOld > W * 1.5, '예전 하한이면 한 화면을 넘침');
  assert.ok((w.t1 - w.t0) * pxArc <= W + 1, '보관함 하한이면 한 화면');
  assert.equal(minPxFor('project'), MT.MIN_PX_PER_MS);
  const tk = ticks(w.t0, w.t1, pxArc);
  assert.ok(tk.step >= 14 * D, `눈금 ${tk.step / D}일`);
  const z = zoomAround({ pxPerMs: pxArc, scrollLeft: 0, d0: w.t0 }, 0.5, 100, w.t0, minPxFor('archive'));
  assert.equal(z.pxPerMs, MT.MIN_PX_PER_MS_ARCHIVE >= pxArc * 0.5 ? MT.MIN_PX_PER_MS_ARCHIVE : pxArc * 0.5);
});

