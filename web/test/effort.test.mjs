// 추론 effort 시각 차등 — 공용 순수 규칙(web/effort-core.mjs)·mock 사다리 시험. 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EFFORT, EFFORT_NAMES, EFFORT_LOD, EFFORT_INK, effortLevel, effortOf, effortDrawnKind, effortGlyph, effortAttr, effortHeightK,
  effortArcs, effortTagText, effortLod, effortPhone, effortInk, EffortTween, effortInstant, effortTip, effortMeterHtml,
  effortCounts, effortName, effortRank, EFFORT_TIER, EFFORT_MAX, EFFORT_METER_H,
} from '../effort-core.mjs';
import { MockGenerator } from '../mock.js';
import { EFFORT_LADDER } from '../effort-mock.mjs';

const N = (kind, meta = {}, extra = {}) => ({ id: 'x:' + Math.random(), kind, status: 'active', meta, ...extra });

test('effortLevel: 시각 단계 4개 — low·medium·high·xhigh·max → 1·2·3·4·4(xhigh 와 max 는 한 곳에서 묶음), 그 밖 null', () => {
  assert.equal(EFFORT_MAX, 4);
  assert.deepEqual(EFFORT_NAMES.map(effortLevel), [1, 2, 3, 4, 4]);
  assert.equal(effortLevel(' XHigh '), 4);
  assert.equal(effortLevel('MAX'), 4);
  for (const v of ['ultra', '', null, undefined, 3, 'max2', 'toString', '__proto__']) assert.equal(effortLevel(v), null, String(v));
  assert.deepEqual(Object.keys(EFFORT_TIER), EFFORT_NAMES);
  assert.deepEqual(EFFORT_NAMES.map(effortRank), [1, 2, 3, 4, 5], '글 정렬용 값 순서는 다섯');
  assert.equal(effortName(4), 'xhigh·max');
  assert.equal(effortName(0), null);
  assert.equal(effortName(5), null);
});

test('xhigh 와 max 는 그림이 같고 글은 실제 값 그대로', () => {
  for (const kind of ['subagent', 'workflow-agent', 'claude-p']) {
    const x = effortGlyph(N(kind, { effort: 'xhigh' })), m = effortGlyph(N(kind, { effort: 'max' }));
    for (const k of ['level', 'filled', 'hollowN', 'top', 'closed', 'confirmed']) assert.equal(x[k], m[k], kind + ' ' + k);
    assert.ok(x.closed && x.top);
    assert.deepEqual([x.name, m.name], ['xhigh', 'max']);
    assert.deepEqual(effortAttr(N(kind, { effort: 'xhigh' })), effortAttr(N(kind, { effort: 'max' })));
    const strip = (h) => h.replace(/ title="[^"]*"| aria-label="[^"]*"/g, '');
    assert.equal(strip(effortMeterHtml(N(kind, { effort: 'xhigh' }))), strip(effortMeterHtml(N(kind, { effort: 'max' }))));
  }
  assert.equal(effortHeightK(N('subagent', { effort: 'xhigh' })), effortHeightK(N('subagent', { effort: 'max' })));
  assert.equal(effortArcs(N('subagent', { effort: 'xhigh' })), effortArcs(N('subagent', { effort: 'max' })));
  const hx = effortGlyph(N('subagent', { effortReq: 'xhigh' }));
  assert.ok(hx.top && !hx.closed, '요청 xhigh = 맨 위 단계 속 빈 칸(닫힘 없음)');
  assert.equal(effortTip(N('subagent', { effort: 'max', effortReq: 'xhigh' })), '추론 effort max — 요청 xhigh · 적용 max');
  assert.equal(effortTip(N('subagent', { effort: 'xhigh', effortReq: 'max' })), '추론 effort xhigh — 요청 max · 적용 xhigh');
  assert.equal(effortTagText(N('main', { effort: 'max' })), 'max');
  assert.equal(effortTagText(N('main', { effort: 'xhigh' })), 'xhigh');
  assert.equal(effortCounts([N('subagent', { effort: 'max' }), N('subagent', { effort: 'xhigh' }), N('subagent', { effort: 'xhigh' })]), 'xhigh 2 · max 1', '집계는 실제 값 순서');
});

test('effortOf: 적용값 > 요청값, 요청만이면 속 빈 칸, 둘 다 없으면 null, 미상 이름은 단계 없이 글만', () => {
  assert.equal(effortOf(N('subagent')), null);
  assert.equal(effortOf(null), null);
  const a = effortOf(N('subagent', { effort: 'xhigh', effortReq: 'high' }));
  assert.deepEqual([a.level, a.confirmed, a.hollow, a.req, a.applied, a.reqLevel], [4, true, false, 'high', 'xhigh', 3]);
  const r = effortOf(N('subagent', { effortReq: 'High' }));
  assert.deepEqual([r.level, r.confirmed, r.hollow, r.name, r.applied], [3, false, true, 'high', null]);
  const u = effortOf(N('subagent', { effort: 'ultra' }));
  assert.deepEqual([u.level, u.name, u.confirmed], [null, 'ultra', true]);
  assert.equal(effortOf(N('subagent', { effort: null, effortReq: 'low' })).level, 1); // 확정값을 비운 패치(null)
});

test('무늬 대상: subagent·workflow-agent·claude-p 만(메인·워크플로 루트·bash-bg·monitor 제외)', () => {
  for (const k of ['subagent', 'workflow-agent', 'claude-p']) assert.ok(effortDrawnKind(k), k);
  for (const k of ['main', 'workflow', 'bash-bg', 'monitor']) assert.ok(!effortDrawnKind(k), k);
  assert.equal(effortGlyph(N('main', { effort: 'max' })), null);
  const g = effortGlyph(N('claude-p', { effort: 'max' }));
  assert.deepEqual([g.level, g.filled, g.hollowN, g.closed], [4, 4, 0, true]);
  const h = effortGlyph(N('subagent', { effortReq: 'max' }));
  assert.deepEqual([h.filled, h.hollowN, h.closed], [0, 4, false]); // 요청 상태는 닫힘 표지 없음
  assert.equal(effortGlyph(N('subagent', { effort: 'high' })).top, false);
  assert.equal(effortGlyph(N('subagent', { effort: 'ultra' })), null);
  assert.deepEqual(effortAttr(N('subagent', { effort: 'high' })), [3, 1]);
  assert.deepEqual(effortAttr(N('subagent', { effortReq: 'high' })), [3, 0.5]);
  assert.deepEqual(effortAttr(N('subagent')), [0, 0]);
  assert.deepEqual(effortAttr(N('main', { effort: 'high' })), [0, 0]);
});

test('단계표: 높이·호가 단계에 따라 늘고, medium 과 미상은 지금 값, 표 길이 = 시각 단계 + 1', () => {
  assert.equal(EFFORT.HEIGHT_K.length, EFFORT_MAX + 1); assert.equal(EFFORT.ARCS.length, EFFORT_MAX + 1);
  assert.equal(EFFORT_METER_H.length, EFFORT_MAX);
  for (let i = 2; i <= EFFORT_MAX; i++) {
    assert.ok(EFFORT.HEIGHT_K[i] > EFFORT.HEIGHT_K[i - 1]);
    assert.ok(EFFORT.ARCS[i] > EFFORT.ARCS[i - 1]);
  }
  assert.equal(EFFORT.HEIGHT_K[2], 1); assert.equal(EFFORT.ARCS[2], 3);
  assert.equal(effortHeightK(N('subagent')), 1);
  assert.equal(effortHeightK(N('subagent', { effort: 'low' })), 0.8);
  assert.equal(effortHeightK(N('subagent', { effort: 'max' })), 1.48);
  assert.equal(effortHeightK(N('subagent', { effort: 'xhigh' })), 1.48);
  // 간격이 고르게(비 1.2～1.25) — 4단계라 한 칸이 예전보다 뚜렷
  for (let i = 3; i <= EFFORT_MAX; i++) { const r = EFFORT.HEIGHT_K[i] / EFFORT.HEIGHT_K[i - 1]; assert.ok(r > 1.19 && r < 1.26, String(r)); }
  assert.equal(effortHeightK(N('subagent', { effortReq: 'max' })), 1); // 요청 상태는 지금 높이
  assert.equal(effortHeightK(N('main', { effort: 'max' })), 1);
  assert.equal(effortArcs(N('subagent')), 3);
  assert.equal(effortArcs(N('subagent', { effort: 'xhigh' })), 6);
  assert.equal(effortArcs(N('subagent', { effort: 'high' })), 4);
  assert.equal(effortArcs(N('subagent', { effortReq: 'low' })), 2);
  assert.equal(EFFORT.BAR, undefined, '복셀 발광대 게이지는 옷차림·자리 분위기로 바뀜(vx-effort-core)');
});

test('꼬리표 글(결정 ③): 무늬 생긴 노드는 빼고, 메인은 medium 이 아닐 때만, 미상 이름은 글로 남김', () => {
  assert.equal(effortTagText(N('subagent', { effort: 'xhigh' })), null);
  assert.equal(effortTagText(N('subagent', { effortReq: 'xhigh' })), null);
  assert.equal(effortTagText(N('subagent', { effort: 'ultra' })), 'ultra');
  assert.equal(effortTagText(N('subagent')), null);
  assert.equal(effortTagText(N('main', { effort: 'medium' })), null);
  assert.equal(effortTagText(N('main', { effort: 'Medium' })), null);
  assert.equal(effortTagText(N('main', { effort: 'xhigh' })), 'xhigh');
  assert.equal(effortTagText(N('main', { effortReq: 'xhigh' })), null); // 메인은 적용값만
  assert.equal(effortTagText(N('bash-bg', { effort: 'high' })), 'high'); // 대상 밖 종류는 예전처럼 글
});

test('LOD 문턱: <10 숨김 · <18 채운 칸만 · 그 이상 전부, 휴대폰 1.3배', () => {
  assert.deepEqual([9.9, 10, 17.9, 18, 40].map((p) => effortLod(p)), [0, 1, 1, 2, 2]);
  assert.deepEqual([12.9, 13, 23.3, 23.5].map((p) => effortLod(p, { phone: true })), [0, 1, 1, 2]);
  assert.equal(effortLod(NaN), 0);
  assert.ok(effortPhone(390, 844)); assert.ok(!effortPhone(1280, 800));
  assert.equal(EFFORT_LOD.HIDE, 10);
});

test('잉크 토큰: 다크·라이트 값이 theme.css 와 같고 무채색', async () => {
  const d = effortInk(false), l = effortInk(true);
  assert.equal(d.ink.css, 'rgba(230, 233, 239, 0.62)');
  assert.equal(l.dim.css, 'rgba(21, 26, 35, 0.16)');
  assert.equal(d.glint.hex, 0xffffff);
  assert.ok(Math.abs(l.ink.rgb[0] - 21 / 255) < 1e-9);
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../theme.css', import.meta.url), 'utf8');
  const all = new Set([...css.matchAll(/--effort-[a-z-]+:\s*rgba\(([^)]+)\)/g)].map((m) => m[1].split(',').map(Number).join(',')));
  for (const [th, src] of Object.entries(EFFORT_INK)) for (const v of Object.values(src)) assert.ok(all.has(v.join(',')), `${th} ${v}`);
  for (const src of Object.values(EFFORT_INK)) for (const [r, g, b] of Object.values(src)) assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 18, '무채색');
});

test('EffortTween: 처음은 즉시, 바뀌면 0.4초 보간 후 수렴, 중간 변경은 지금 값에서, instant 즉시', () => {
  const tw = new EffortTween();
  assert.equal(tw.value('a', 1, 0), 1);
  assert.equal(tw.value('a', 1.55, 1000), 1); // 바뀐 순간
  const mid = tw.value('a', 1.55, 1200);
  assert.ok(mid > 1 && mid < 1.55, String(mid));
  assert.ok(tw.busy('a', 1200));
  assert.equal(tw.value('a', 1.55, 1400), 1.55);
  assert.ok(!tw.busy('a', 1500));
  tw.value('a', 0.8, 2000); const m2 = tw.value('a', 0.8, 2100);
  const back = tw.value('a', 1.2, 2100); // 중간에 다시 바뀜 → 지금 값에서 출발
  assert.equal(back, m2);
  assert.equal(tw.value('a', 1.2, 2600), 1.2);
  assert.equal(tw.value('a', 5, 2601, { instant: true }), 5);
  tw.prune(new Set()); assert.equal(tw.m.size, 0);
  assert.ok(effortInstant({ reduced: true })); assert.ok(effortInstant({ rate: 8 })); assert.ok(!effortInstant({ rate: 4 }));
});

test('툴팁·미터 HTML: 요청·적용 한 줄, 칸 수·속 빈 칸·닫힘, 대상 밖·미상은 빈 문자열', () => {
  assert.equal(effortTip(N('subagent', { effort: 'high', effortReq: 'high' })), '추론 effort high — 요청 high · 적용 high');
  assert.equal(effortTip(N('subagent', { effortReq: 'xhigh' })), '추론 effort xhigh — 요청 xhigh · 아직 응답 전');
  assert.equal(effortTip(N('subagent', { effort: 'high' })), '추론 effort high — 요청 없음(기본값) · 적용 high');
  assert.equal(effortTip(N('subagent')), null);
  const h = effortMeterHtml(N('subagent', { effort: 'high' }));
  assert.equal((h.match(/class="on"/g) || []).length, 3);
  assert.equal((h.match(/class="off"/g) || []).length, 1);
  assert.deepEqual([...h.matchAll(/height:(\d+)px/g)].map((m) => +m[1]), [4, 5, 6, 7]);
  assert.ok(!h.includes('hollow') && !h.includes('closed'));
  const x = effortMeterHtml(N('subagent', { effort: 'xhigh' }));
  assert.equal((x.match(/class="on"/g) || []).length, 4);
  assert.ok(x.includes('closed') && x.includes('title="추론 effort xhigh'), '툴팁은 실제 값');
  const m0 = effortMeterHtml(N('subagent', { effort: 'max' }), { title: false }); // 상세 팝업(이름 글이 옆에 따로)
  assert.ok(!m0.includes('title=') && m0.includes('aria-label="추론 effort max'), 'title 을 빼도 읽어 주는 글은 실제 값');
  assert.ok(effortMeterHtml(N('subagent', { effortReq: 'low' })).includes('eff-meter hollow'));
  assert.ok(effortMeterHtml(N('claude-p', { effort: 'max' })).includes('closed'));
  assert.equal(effortMeterHtml(N('main', { effort: 'max' })), '');
  assert.equal(effortMeterHtml(N('subagent', { effort: 'ultra' })), '');
  const legend = effortMeterHtml({ level: 3 }); // 범례 견본
  assert.equal((legend.match(/class="on"/g) || []).length, 3);
  assert.ok(!legend.includes('title='));
});

test('세션 줄 집계: 살아 있는 대상 노드만, 단계 순서', () => {
  const s = effortCounts([N('subagent', { effort: 'xhigh' }), N('subagent', { effort: 'high' }), N('claude-p', { effort: 'high' }),
    N('subagent', { effort: 'max' }, { status: 'done' }), N('main', { effort: 'low' }), N('subagent', { effortReq: 'low' })]);
  assert.equal(s, 'low 1 · high 2 · xhigh 1');
  assert.equal(effortCounts([]), '');
});

test('mock 사다리(?effort=ladder): low～max·미상·요청만·워크플로 에이전트·claude -p 가 모두 뜨고, 요청→확정·보간이 일어남', () => {
  const g = new MockGenerator({ seed: 2026, startMs: Date.parse('2026-11-06T00:00:00Z'), effort: true });
  const seen = new Map();
  while (g.t < 30_000) for (const ev of g.next().events) if (ev.type === 'node-update' && ev.patch.meta && 'effort' in ev.patch.meta) seen.set(ev.nodeId, [...(seen.get(ev.nodeId) || []), ev.patch.meta.effort]);
  const nodes = [...g.nodes.values()];
  const lv = (n) => effortGlyph(n)?.level ?? null;
  const byId = (k) => g.nodes.get('a:demo-eff-' + k);
  assert.equal(EFFORT_LADDER.length, 10);
  assert.deepEqual(['low', 'medium', 'high', 'xhigh', 'max'].map((k) => lv(byId(k))), [1, 2, 3, 4, 4]);
  assert.deepEqual([byId('xhigh').meta.effort, byId('max').meta.effort], ['xhigh', 'max'], '사다리에 xhigh·max 노드가 둘 다');
  assert.equal(effortOf(byId('unknown')), null);
  assert.ok(effortGlyph(byId('req')).hollow);
  assert.ok(effortGlyph(byId('confirm')));
  const wf = nodes.filter((n) => n.kind === 'workflow-agent' && n.id.startsWith('a:demo-eff'));
  assert.deepEqual(wf.map(lv).sort(), [3, 4, 4]);
  assert.deepEqual(wf.map((n) => n.meta.effort).sort(), ['high', 'max', 'xhigh']);
  const cp = nodes.filter((n) => n.kind === 'claude-p' && n.id.startsWith('s:demo-eff'));
  assert.deepEqual(cp.map(lv), [4, 4]);
  assert.deepEqual(cp.map((n) => n.meta.effort).sort(), ['max', 'xhigh']);
  assert.ok(seen.get('a:demo-eff-confirm').includes(null) && seen.get('a:demo-eff-confirm').includes('high'));
  assert.ok(seen.get('a:demo-eff-tween').includes('xhigh') && seen.get('a:demo-eff-tween').includes('medium'));
  assert.equal(effortTagText(g.nodes.get(g.root)), 'high'); // 메인 꼬리표 글은 남음
  // 상태가 섞인다(대기·완료·도구 중)
  const st = new Set(EFFORT_LADDER.map(([k]) => byId(k).status));
  assert.ok(st.has('idle') && st.has('done') && st.has('active'));
  // 켜지 않으면 사다리 노드 없음
  const g0 = new MockGenerator({ seed: 2026, startMs: 0 });
  while (g0.t < 5000) g0.next();
  assert.ok(![...g0.nodes.keys()].some((k) => k.includes('demo-eff')));
});

test('독립 claude -p 루트(kind main + orphanSdk)는 claude-p 로 — 무늬 있음·꼬리표 글 없음', async () => {
  const { effortGlyph, effortTagText, effortKindOf } = await import('../effort-core.mjs');
  const n = { id: 'o', kind: 'main', meta: { orphanSdk: true, effort: 'xhigh' } };
  assert.equal(effortKindOf(n), 'claude-p');
  assert.equal(effortGlyph(n).level, 4);
  assert.equal(effortTagText(n), null);
  assert.equal(effortTagText({ kind: 'main', meta: { effort: 'xhigh' } }), 'xhigh');
});

test('effortSnap: 스냅샷 경계 뒤 첫 값은 보간 없이 즉시', async () => {
  const { EffortTween, effortSnap } = await import('../effort-core.mjs');
  const tw = new EffortTween(400);
  assert.equal(tw.value('a', 1, 0), 1);
  tw.value('a', 5, 100);
  assert.ok(tw.busy('a', 200));
  effortSnap();
  assert.equal(tw.busy('a', 200), false);
  assert.equal(tw.value('a', 3, 200), 3);
  tw.value('a', 5, 300);
  assert.ok(tw.value('a', 5, 400) < 5); // 경계 뒤 변화는 다시 보간
});
