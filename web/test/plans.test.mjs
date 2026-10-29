// 계획 보드(웹 순수 코어): 진행·변경 비교·연출 큐·세션 메인으로 모으기·월드 크기·자리(앵커 고정)·화면 투영(끌어오지 않음)·앵커 단일화·보드 모델·크게 보기·라벨 장애물·팝업 모델·⚙ 첫 값·mock 드라이버
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_UI, planInitial, plansOf, planProgress, diffPlans, PlanFx, mainOf, gatherPlans, boardWorld, holoMonitor, boardScreen, boardCard, sheetInspectModel, PLAN_CAM, planLabelRects,
  cycleNodeOf, planInspectModel, boardAnchor, liveCycleOf, PLAN_ST_LABEL,
} from '../plan-core.mjs';
import { _setLangForTest } from '../i18n.mjs';
import { MON } from '../voxel/office-core.mjs';
import { HOLO } from '../holo-core.mjs';

const I = (k, s, o = {}) => ({ k, t: `항목 ${k}`, s, at: 1000, ...o });
const P = (id, items, o = {}) => ({ id, src: 'todo', title: '할 일', at: 5000, by: 's:m', n: items.length, items, ...o });

test('⚙ 첫 값(§122 자율 루프 판): URL 이 우선, 없으면 저장값, 기본 켬 · plansOf 는 빈 계획을 거름', () => {
  assert.equal(planInitial(null, null), true, '기본 켬');
  assert.equal(planInitial(null, '0'), false);
  assert.equal(planInitial(null, '1'), true);
  assert.equal(planInitial('0', '1'), false);
  assert.equal(planInitial('1', '0'), true);
  assert.deepEqual(plansOf({ meta: { plans: [P('a', []), P('b', [I('x', 'done')])] } }).map((p) => p.id), ['b']);
  assert.deepEqual(plansOf({ meta: {} }), []);
});

test('진행: 완료 + 진행 절반, 지금 항목 = 진행 첫째 → 없으면 보류 아닌 대기 첫째', () => {
  const p = P('a', [I('1', 'done'), I('2', 'pending', { hold: 1 }), I('3', 'pending'), I('4', 'in_progress')]);
  const pr = planProgress(p);
  assert.deepEqual([pr.done, pr.prog, pr.pend, pr.total, pr.cur], [1, 1, 2, 4, 3]);
  assert.equal(pr.frac, 1.5 / 4);
  assert.equal(planProgress(P('b', [I('1', 'done'), I('2', 'pending', { hold: 1 }), I('3', 'pending')])).cur, 2);
  assert.equal(planProgress(P('c', [I('1', 'done')])).cur, -1);
});

test('변경 비교: 추가·상태·삭제(계획째 생김·없어짐 포함), 글만 바뀐 건 아님', () => {
  const a = [P('p1', [I('1', 'pending'), I('2', 'pending'), I('3', 'done')])];
  const b = [P('p1', [I('1', 'done'), { ...I('2', 'pending'), t: '글만 바꿈' }, I('4', 'pending')]), P('p2', [I('z', 'pending')])];
  const ch = diffPlans(a, b).map((c) => [c.pid, c.k, c.kind, c.from || null, c.to || null]);
  assert.deepEqual(ch, [['p1', '1', 'state', 'pending', 'done'], ['p1', '4', 'add', null, 'pending'], ['p1', '3', 'del', 'done', null], ['p2', 'z', 'add', null, 'pending']]);
  assert.deepEqual(diffPlans(b, null).map((c) => c.kind), ['del', 'del', 'del', 'del']);
  assert.deepEqual(diffPlans(null, null), []);
});

test('연출 큐: 칸 연출은 FX_MS 뒤 사라지고 지운 항목 잔상은 DEL_MS, 보드는 HOT_MS 동안 밝게', () => {
  const fx = new PlanFx();
  fx.note('n', [{ pid: 'p', k: '1', kind: 'state', from: 'pending', to: 'done' }, { pid: 'p', k: '2', kind: 'add', to: 'pending' }, { pid: 'p', k: '3', kind: 'del', from: 'pending', t: '옛 항목' }], 0);
  assert.equal(fx.cell('n', 'p', '1', 100).kind, 'done');
  assert.equal(fx.cell('n', 'p', '2', 100).kind, 'add');
  assert.equal(fx.delsOf('n', 'p', 100).length, 1);
  assert.ok(fx.busy(100));
  assert.ok(fx.isHot('n', PLAN_UI.HOT_MS - 1));
  assert.equal(fx.isHot('n', PLAN_UI.HOT_MS + 1), false);
  assert.equal(fx.cell('n', 'p', '1', PLAN_UI.FX_MS + 1), null);
  assert.equal(fx.delsOf('n', 'p', PLAN_UI.DEL_MS + 1).length, 0);
  assert.equal(fx.busy(PLAN_UI.FX_MS + 2), false);
  fx.note('n', [{ pid: 'p', k: '1', kind: 'state', from: 'done', to: 'in_progress' }], 5000);
  assert.equal(fx.cell('n', 'p', '1', 5001).kind, 'start');
});

test('§83 보드 주인 = 세션 메인: 부모 사슬 → 부모 없는 기동기는 sessionId 로, 메인 하나면 그 메인 · 모으기 순서', () => {
  const nodes = new Map([
    ['s:m', { id: 's:m', kind: 'main', sessionId: 'm', meta: { plans: [P('pm', [I('1', 'done')], { at: 9 })] } }],
    ['s:o', { id: 's:o', kind: 'main', sessionId: 'o', meta: {} }],
    ['a:1', { id: 'a:1', kind: 'subagent', parentId: 's:m', meta: { plans: [P('pa', [I('1', 'in_progress')], { at: 1 })] } }],
    ['b:L', { id: 'b:L', kind: 'bash-bg', parentId: null, sessionId: 'm', meta: { launcher: {} } }],
    ['b:R', { id: 'b:R', kind: 'bash-bg', parentId: 'b:L', meta: { runner: {}, plans: [P('pr', [I('1', 'pending')], { src: 'phases', at: 5 })] } }],
    ['x:z', { id: 'x:z', kind: 'bash-bg', parentId: null, meta: { plans: [P('pz', [I('1', 'pending')])] } }],
  ]);
  assert.equal(mainOf('a:1', nodes), 's:m');
  assert.equal(mainOf('b:R', nodes), 's:m', '부모 없는 기동기 → sessionId 같은 메인');
  assert.equal(mainOf('x:z', nodes), null, '메인이 둘인데 단서 없음');
  assert.equal(mainOf('x:z', new Map([['s:m', nodes.get('s:m')], ['x:z', nodes.get('x:z')]])), 's:m', '메인 하나면 그 메인');
  const g = gatherPlans(nodes);
  assert.deepEqual([...g.keys()], ['s:m']);
  assert.deepEqual(g.get('s:m').map((e) => e.plan.id), ['pa', 'pm', 'pr'], '진행 중(+메인·러너) > 최근');
  assert.equal(g.get('s:m').find((e) => e.plan.id === 'pr').runner, true);
});

test('§83.9 보드 크기 = 홀로그램 모니터 폭 × 높이 1.5배, 앵커 기준 고정 오프셋(카메라 무관) · 화면 투영은 끌어오지 않음 · 간략·숨김', () => {
  const w = boardWorld(2);
  const hh = 1.25 + 0.3 * 2;
  const K = PLAN_UI.SIZE_K;
  assert.equal(K, 2, '§106 크기 2배');
  assert.ok(Math.abs(w.w - hh * 1.5 * K) < 1e-9 && Math.abs(w.h - hh * 1.5 * K) < 1e-9, '흐름·Planet: 폭 = 모니터 폭(높이 × 1.5) × 2, 높이 = 모니터 높이 × 1.5 × 2');
  assert.deepEqual(w.holo, holoMonitor(2));
  assert.ok(Math.abs(w.w / w.holo.w - K) < 1e-9 && Math.abs(w.h / w.holo.h - PLAN_UI.HOLO_H_K * K) < 1e-9);
  const vx = boardWorld(2, 'voxel');
  assert.ok(Math.abs(vx.w - MON.H * MON.ASP * K) < 1e-9 && Math.abs(vx.h - MON.H * 1.5 * K) < 1e-9, '복셀: 모니터(MON) 기준');
  assert.equal(PLAN_UI.VX_MON_H, MON.H); assert.equal(PLAN_UI.VX_MON_ASP, MON.ASP);
  assert.deepEqual(PLAN_UI.BOOST.voxel, [MON.MIN_PX, MON.BOOST]); assert.deepEqual(PLAN_UI.BOOST.flow, [HOLO.MIN_PX_ACTIVE, HOLO.BOOST_MAX]);
  // 멀면 활동 모니터처럼 최소 높이까지 키움(상한까지)
  const far = boardScreen({ x: 500, y: 400 }, 10, w, 1440, 900); // 모니터 높이 18.5px < 30 → ×1.62
  assert.ok(Math.abs(far.box.w - w.w * 10 * (30 / (w.holo.h * 10))) < 1e-6);
  const own = boardWorld(2, 'planet', { w: 3, h: 2 });
  assert.equal(own.w, 3 * K); assert.equal(own.h, 3 * K, '표현이 낸 모니터 크기(view.holoSize)가 우선');
  assert.ok(Math.abs(w.off - (2 * 1.3 + PLAN_UI.GAP_W)) < 1e-9, '원 바깥 오른쪽');
  assert.deepEqual(boardWorld(2), w, '결정적 — 화면·카메라 입력이 없다');
  // 화면 투영: 배율 = 월드 폭 × px/월드 / 기준 폭, 왼쪽 아래 모서리 = 투영 점, 높이 = 폭 × 비율
  const sc = boardScreen({ x: 500, y: 400 }, 60, w, 1440, 900);
  assert.ok(!sc.hidden && Math.abs(sc.s - (w.w * 60) / PLAN_UI.BASE_PX) < 1e-9);
  assert.equal(sc.box.x, 500); assert.ok(Math.abs(sc.box.y + sc.box.h - 400) < 1e-9, '아래 변 = 투영 점');
  assert.ok(Math.abs(sc.box.h / sc.box.w - w.aspect) < 1e-9); assert.equal(sc.lod, false);
  assert.equal(boardScreen({ x: 500, y: 400 }, 10, w, 1440, 900).lod, true, '작으면 간략');
  assert.equal(boardScreen({ x: 500, y: 400 }, 20, w, 1440, 900).lod, false, '§106 2배라 같은 거리에서 간략이 덜 됨');
  // 화면 가장자리 너머: 안으로 밀어 넣지 않고 그 자리(일부만 보임) 또는 숨김
  const edge = boardScreen({ x: 1400, y: 400 }, 60, w, 1440, 900);
  assert.equal(edge.hidden, false); assert.equal(edge.box.x, 1400, '오른쪽 끝 너머로 나가도 x 그대로');
  assert.equal(boardScreen({ x: 1500, y: 400 }, 60, w, 1440, 900).hidden, true, '판 전체가 화면 밖이면 숨김(끌어오지 않음)');
  assert.equal(boardScreen({ x: -2000, y: 400 }, 60, w, 1440, 900).hidden, true);
  assert.equal(boardScreen({ behind: true }, 0, w, 1440, 900).hidden, true, '카메라 뒤');
  assert.equal(boardScreen({ x: 500, y: 400 }, 0.2, w, 1440, 900).hidden, true, '너무 멀면(키움 상한 뒤에도 HIDE_PX 미만) 숨김');
  assert.equal(boardScreen({ x: 500, y: 400 }, 1000, w, 1440, 900).s, PLAN_UI.S_MAX, '아주 가까우면 크기만 상한(자리 그대로)');
  assert.equal(boardScreen({ x: 500, y: 400 }, 1000, w, 1440, 900).box.x, 500);
});

test('§83 보드 모델: 가장 앞 계획 — 완료/전체·칸(상태·외부 대기·회차)·지금 줄(진행 중 ≤2, 없으면 다음 대기)·다른 계획 수·연출', () => {
  const items = Array.from({ length: 30 }, (_, i) => I(String(i), i < 3 ? 'done' : i < 6 ? 'in_progress' : 'pending', i < 3 ? { cy: 7 + i, by: 's:c' + i } : i === 29 ? { hold: 1 } : {}));
  const entries = [{ owner: 'b:R', runner: true, plan: P('p1', items, { src: 'phases', title: '설계서.md' }) }, { owner: 's:m', runner: false, plan: P('p2', [I('x', 'pending')]) }];
  const fx = new PlanFx(); fx.note('b:R', [{ pid: 'p1', k: '1', kind: 'state', from: 'pending', to: 'done' }], 0);
  const m = boardCard(entries, { nowMs: 10, fx, mainId: 's:m', labelOf: () => '러너 · autopilot.sh' });
  assert.equal(m.cells.length, PLAN_UI.MAX_CELLS); assert.equal(m.extra, 30 - PLAN_UI.MAX_CELLS);
  assert.deepEqual(m.cells.slice(0, 4).map((c) => c.cy), [7, 8, 9, null]);
  assert.equal(m.cells[1].fx, 'done'); assert.equal(m.cells[3].cur, true);
  assert.deepEqual(m.lines.map((l) => [l.i, l.st, l.mark]), [[3, 'in_progress', '▶'], [4, 'in_progress', '▶'], [5, 'in_progress', '▶']], '지금 단계 + 다음 NEXT_N 개');
  assert.deepEqual(m.lines.map((l) => !!l.up), [false, true, true]);
  assert.equal(m.count, '3/30'); assert.equal(m.more, 1); assert.equal(m.hold, 1); assert.equal(m.glyph, '▤'); assert.equal(m.ownerLabel, '러너 · autopilot.sh');
  assert.ok(m.hot);
  const n = boardCard([{ owner: 's:m', runner: false, plan: P('d', [I('1', 'done'), I('2', 'pending', { hold: 1 }), I('3', 'pending')]) }], { mainId: 's:m' });
  assert.deepEqual(n.lines.map((l) => [l.i, l.next]), [[2, true]], '진행 중이 없으면 보류 아닌 다음 대기');
  assert.equal(n.ownerLabel, '메인'); assert.equal(n.cells[1].st, 'hold');
  assert.equal(boardCard([{ owner: 's:m', plan: P('d', [I('1', 'done')]) }]).allDone, true);
  assert.equal(boardCard([]), null);
});

test('§83 크게 보기 모델: 모인 계획 전부, 항목마다 상태 기호(✓▶○⏸)·회차·처리 노드 · 라벨 장애물 · 회차 노드 찾기', () => {
  const entries = [{ owner: 'b:R', runner: true, plan: P('p', [I('0', 'done', { cy: 3, by: 's:c3', at: 1 }), I('1', 'in_progress', { by: 'a:x', at: 1 }), I('2', 'pending', { hold: 1 }), I('3', 'pending')], { src: 'phases', title: 'x-design.md', n: 4 }) }];
  const [m] = sheetInspectModel(entries, { nowMs: 120_000, labelOf: (id) => ({ 'b:R': '러너', 's:c3': '회차 3', 'a:x': '서브' }[id]), mainId: 's:m' });
  assert.equal(m.ownerLabel, '러너'); assert.equal(m.count, '1/4'); assert.equal(m.hold, 1);
  assert.deepEqual(m.items.map((x) => [x.glyph, x.st, x.cy]), [['✓', 'done', 3], ['▶', 'in_progress', null], ['⏸', 'hold', null], ['○', 'pending', null]]);
  PLAN_CAM.rects = [[1, 2, 3, 4]];
  assert.deepEqual(planLabelRects([[0, 0, 1, 1]]), [[0, 0, 1, 1], [1, 2, 3, 4]], '라벨 장애물에 보드 상자를 더함');
  PLAN_CAM.rects = [];
  const nodes = new Map([['s:c', { id: 's:c', kind: 'claude-p', parentId: 'b:R', meta: { cycle: 4 } }], ['a:k', { id: 'a:k', kind: 'subagent', parentId: 's:c', meta: {} }], ['a:z', { id: 'a:z', kind: 'subagent', parentId: 's:m', meta: {} }]]);
  assert.equal(cycleNodeOf('a:k', nodes), 's:c', '회차 하위 → 그 회차');
  assert.equal(cycleNodeOf('s:c', nodes), 's:c');
  assert.equal(cycleNodeOf('a:z', nodes), null, '회차 밖');
});

test('§122 판 자리 = 재기동기(축 큐 주인·러너의 기동기 조상) · 축 큐 > 진행 중 러너 계획 > 그 밖 · 재기동기 없으면 메인', () => {
  const nodes = new Map([['s:m', { id: 's:m', kind: 'main' }], ['b:L', { id: 'b:L', kind: 'bash-bg', parentId: null, status: 'active', meta: { launcher: { script: 'relaunch.sh' } } }],
    ['b:R', { id: 'b:R', kind: 'bash-bg', parentId: 'b:L', status: 'active', meta: { runner: 1 } }],
    ['s:c2', { id: 's:c2', kind: 'claude-p', parentId: 'b:R', status: 'active', meta: { cycle: 2 } }], ['s:c1', { id: 's:c1', kind: 'claude-p', parentId: 'b:R', status: 'done', meta: { cycle: 1 } }],
    ['a:k', { id: 'a:k', kind: 'subagent', parentId: 's:c2', status: 'active', meta: {} }]]);
  const R = (by) => ({ owner: 'b:R', runner: true, plan: P('p', [I('0', 'done', { cy: 2, by })], { src: 'phases', by }) });
  const X = { owner: 'b:L', runner: true, plan: P('x', [I('0', 'in_progress')], { src: 'axes' }) };
  for (const by of ['s:c2', 's:c1', 'a:k']) assert.equal(boardAnchor([R(by)], 's:m', nodes).id, 'b:L', '러너 계획 → 그 러너의 재기동기 ' + by);
  const an = boardAnchor([R('s:c2'), X], 's:m', nodes);
  assert.equal(an.id, 'b:L'); assert.deepEqual(an.entries.map((e) => e.plan.src), ['axes', 'phases'], '축 큐가 맨 앞');
  const lone = new Map([['s:m', { id: 's:m', kind: 'main' }], ['b:R', { id: 'b:R', kind: 'bash-bg', parentId: 's:m', status: 'active', meta: { runner: 1 } }]]);
  assert.equal(boardAnchor([R('s:c2')], 's:m', lone).id, 's:m', '재기동기를 못 찾으면 메인(예비)');
  assert.deepEqual(boardAnchor([], 's:m', nodes), { id: 's:m', entries: [] });
  const T = { owner: 's:m', runner: false, plan: P('t', [I('0', 'in_progress')]) };
  // 진행 중 회차는 보드 안 표시로만
  assert.equal(liveCycleOf(R('a:k').plan, nodes), 2, '회차 하위가 붙들어도 그 회차 번호');
  assert.equal(liveCycleOf(R('s:c1').plan, nodes), null, '끝난 회차');
  const m = boardCard([R('s:c2')], { mainId: 's:m', liveCy: 2 });
  assert.equal(m.liveCy, 2);
  assert.equal(boardCard([T], { mainId: 's:m', liveCy: 2 }).liveCy, null, '러너 계획 아니면 회차 표시 없음');
});

test('팝업 모델: 계획마다 제목·출처·완료/전체·항목(표·회차·누가·얼마 전)', () => {
  const node = { meta: { plans: [P('p', [I('0', 'done', { cy: 3, by: 's:c3', at: 1 }), I('1', 'in_progress', { by: 'a:x', at: 1 }), I('2', 'pending', { hold: 1 })], { src: 'phases', title: 'x-design.md', n: 5 })] } };
  const [m] = planInspectModel(node, { nowMs: 120_000, labelOf: (id) => ({ 's:c3': '회차 3', 'a:x': '서브' }[id]) });
  assert.equal(m.title, 'x-design.md'); assert.equal(m.src, '단계 설계서'); assert.equal(m.count, '1/3'); assert.equal(m.more, 2);
  assert.deepEqual(m.items.map((x) => [x.mark, x.cy, x.byLabel, x.ago, x.hold, x.cur]), [['✓', 3, '회차 3', '2분 전', false, false], ['◐', null, '서브', '2분 전', false, true], ['○', null, '', '', true, false]]);
  assert.deepEqual(planInspectModel({ meta: {} }), []);
});

test('§86 보드 모델 영어: 출처·상태 라벨, 이름 없는 항목·메인·제목 대체, 얼마 전', () => {
  _setLangForTest('en');
  try {
    const entries = [{ owner: 's:m', runner: false, plan: { id: 'p', src: 'phases', at: 1, by: 's:m', n: 2, items: [{ k: '1', s: 'done', at: 1 }, { k: '2', s: 'pending', at: 1 }] } }];
    const m = boardCard(entries, { mainId: 's:m' });
    assert.equal(m.ownerLabel, 'Main'); assert.equal(m.srcLabel, 'Phase design doc'); assert.equal(m.title, 'Phase design doc');
    assert.equal(m.lines[0].t, 'Item 2');
    const [p] = planInspectModel({ meta: { plans: [entries[0].plan] } }, { nowMs: 3 * 3_600_000 });
    assert.equal(p.updated, '3h ago'); assert.equal(p.items[0].ago, '3h ago');
    assert.equal(PLAN_ST_LABEL.in_progress, 'In progress');
  } finally { _setLangForTest('ko'); }
  assert.equal(PLAN_ST_LABEL.in_progress, '진행');
});

test('v0.4.1 계획 보드 앞뒤: 보드보다 가까운 노드만 판에 구멍(판 좌표·배율 전), 덧층은 무대 안·UI 아래', async () => {
  const { boardHoles, holesMask, PLAN_UI: U } = await import('../plan-core.mjs');
  const fs0 = (await import('node:fs')).readFileSync(new URL('../plan.css', import.meta.url), 'utf8');
  const box = { x: 100, y: 200, w: 200, h: 300 }, s = 2;
  const occ = [
    { id: 'front', x: 150, y: 260, r: 20, d: 5 },    // 앞·겹침 → 구멍
    { id: 'back', x: 160, y: 300, r: 20, d: 30 },    // 뒤 → 없음
    { id: 'near', x: 200, y: 300, r: 10, d: 9.6 },   // 보드 깊이 10 과 여유(0.6) 안 → 없음
    { id: 'off', x: 20, y: 20, r: 10, d: 1 },        // 판 밖 → 없음
    { id: 'edge', x: 95, y: 300, r: 10, d: 2 },      // 판 가장자리에 걸침 → 구멍(가까운 것 먼저)
  ];
  const h = boardHoles(box, s, occ, 10);
  assert.deepEqual(h, [{ x: -2.5, y: 50, r: 5 }, { x: 25, y: 30, r: 10 }]);
  assert.equal(boardHoles(box, s, occ, 1).length, 0); // 보드가 맨 앞이면 구멍 없음
  assert.equal(boardHoles(box, s, Array.from({ length: 40 }, (_, i) => ({ x: 150, y: 300, r: 5, d: i })), 100).length, U.OCC_MAX);
  assert.equal(holesMask([]), '');
  assert.equal(holesMask([{ x: 10, y: 20, r: 5 }, { x: 1, y: 2, r: 1 }]), 'radial-gradient(circle 5px at 10px 20px, transparent 3.5px, #000 5px), radial-gradient(circle 1px at 1px 2px, transparent 0px, #000 1px)');
  assert.match(fs0, /mask-composite: intersect/);
  // 덧층 CSS: z-index 0(무대 #stage 의 쌓임 맥락 안 — 상단 바 20·패널 18·팝업 30+ 아래)
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../plan.css', import.meta.url), 'utf8');
  assert.match(css, /#plan-boards \{[^}]*z-index: 0;/);
  assert.match(css, /#plan-links \{[^}]*z-index: 0;/);
  const ui = fs.readFileSync(new URL('../plan-ui.js', import.meta.url), 'utf8');
  assert.ok(!/document\.body\.append\(svg, layer\);\n\s*layer\.addEventListener/.test(ui) && /getElementById\('stage'\)/.test(ui));
});

test('§74.9 계획: /clear 승계 기동기(부모 없음, spawnedBy = 새 메인)의 러너 계획은 새 메인 보드로 — 옛 recent 메인이 아님', async () => {
  const { mainOf: mo, gatherPlans: gp } = await import('../plan-core.mjs');
  const OLD = 'old00000', NEW = 'new00000';
  const plan = { id: 'p1', src: 'phases', title: 't', items: [{ k: 'a', t: '단계 0', s: 'in_progress' }], at: 1 };
  const nodes = new Map([
    ['s:' + NEW, { id: 's:' + NEW, kind: 'main', sessionId: NEW, rootSessionId: NEW, meta: {} }],
    ['s:' + OLD, { id: 's:' + OLD, kind: 'main', sessionId: OLD, rootSessionId: OLD, meta: {} }],
    ['b:L', { id: 'b:L', parentId: null, kind: 'bash-bg', sessionId: OLD, rootSessionId: OLD, meta: { launcher: { script: 'relaunch.sh' }, spawnedBy: 's:' + NEW } }],
    ['b:L-r1', { id: 'b:L-r1', parentId: 'b:L', kind: 'bash-bg', sessionId: OLD, rootSessionId: OLD, meta: { runner: { script: 'autopilot.sh' }, plans: [plan] } }],
  ]);
  assert.equal(mo('b:L-r1', nodes), 's:' + NEW);
  assert.deepEqual([...gp(nodes).keys()], ['s:' + NEW]);
  nodes.get('b:L').meta.spawnedBy = 's:' + OLD; // 넘기지 않은 기동기는 띄운 옛 메인
  assert.equal(mo('b:L-r1', nodes), 's:' + OLD);
  delete nodes.get('b:L').meta.spawnedBy; // spawnedBy 가 없으면 예전처럼 rootSessionId
  assert.equal(mo('b:L-r1', nodes), 's:' + OLD);
});

test('§115 흐름·Planet 3D 판 깊이: 구멍 사각형 재질 약속 · 화면 상자 → 시야 공간 자리·크기', async () => {
  const { PLAN_PUNCH: P, punchQuad: pq } = await import('../plan-core.mjs');
  assert.equal(P.depthTest, true, '판보다 가까운 노드·선이 구멍을 덮는다(늘 위에 그리지 않음)');
  assert.equal(P.depthWrite, true, '판 뒤에 늦게 그려지는 것은 깊이 시험에서 진다');
  assert.equal(P.transparent, false, '불투명 단계(투명 물체보다 먼저 — 가까운 투명 물체를 지우지 않음)');
  assert.equal(P.fog, false);
  assert.ok(P.renderOrder >= 1000, '불투명 단계의 맨 끝(뒤 불투명 물체가 먼저 그려져 구멍에 지워짐) — 깊이 시험이 있어 늘 위가 아님');
  const rect = { left: 0, top: 48, width: 1000, height: 800 };
  // 화면 가운데 100×80 상자, 깊이 20, 시야각 50° → 시야 공간 원점 축 위, 크기 = px × (2·z·tan25°/800)
  const q = pq(20, { x: 450, y: 48 + 360, w: 100, h: 80 }, rect, 50);
  const wpp = (2 * 20 * Math.tan((25 * Math.PI) / 180)) / 800;
  assert.ok(Math.abs(q.x) < 1e-9 && Math.abs(q.y) < 1e-9 && q.z === -20);
  assert.ok(Math.abs(q.w - 100 * wpp) < 1e-9 && Math.abs(q.h - 80 * wpp) < 1e-9);
  // 오른쪽 위 구석 상자 → x +, y +
  const r = pq(10, { x: 900, y: 48, w: 100, h: 100 }, rect, 50);
  assert.ok(r.x > 0 && r.y > 0);
  assert.equal(pq(-1, { x: 0, y: 0, w: 10, h: 10 }, rect, 50), null, '카메라 뒤');
  assert.equal(pq(5, { x: 0, y: 0, w: 0, h: 10 }, rect, 50), null);
});

test('§115 판 DOM 은 3D 구멍 모드에서 캔버스 아래(.under, z -1)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../plan.css', import.meta.url), 'utf8');
  assert.match(css, /#plan-boards\.under\s*\{\s*z-index:\s*-1/);
  const ui = readFileSync(new URL('../plan-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /typeof view\.setPlanPunch === 'function'/);
  assert.match(ui, /hitBoard:/);
  const sc = readFileSync(new URL('../scene.js', import.meta.url), 'utf8');
  assert.match(sc, /alpha: true/);
  assert.match(sc, /blendSrc: THREE\.ZeroFactor, blendDst: THREE\.OneMinusSrcAlphaFactor/);
  assert.match(sc, /_cutLabels\(\); \/\/ §115\.3/, '렌더 뒤 판 뒤 라벨 잘라내기');
  const nz = readFileSync(new URL('../noise.js', import.meta.url), 'utf8');
  assert.match(nz, /gl_FragColor = vec4\(col \* aOut, aOut\)/, '신호 열화 후처리도 구멍 알파를 지킴');
});

test('§115.2 판 평면 네 모서리: 카메라와 나란한 한 깊이 · 상자 모서리와 정확히 겹침 · 그림자 여백', async () => {
  const { punchCorners: pc, PLAN_SHADOW } = await import('../plan-core.mjs');
  const rect = { left: 0, top: 48, width: 1000, height: 800 }, box = { x: 100, y: 148, w: 200, h: 120 };
  const c = pc(15, box, rect, 50);
  assert.equal(c.length, 4);
  for (const p of c) assert.equal(p.z, -15, '네 점 같은 시야 깊이(평면이 화면과 나란함 — 픽셀마다 같은 깊이)');
  // 다시 화면으로 투영하면 상자 모서리
  const th = Math.tan((25 * Math.PI) / 180), asp = 1000 / 800;
  const back = (p) => ({ x: ((p.x / (15 * th * asp)) + 1) / 2 * 1000, y: 48 + (1 - p.y / (15 * th)) / 2 * 800 });
  const tl = back(c[0]), br = back(c[2]);
  assert.ok(Math.abs(tl.x - 100) < 1e-6 && Math.abs(tl.y - 148) < 1e-6 && Math.abs(br.x - 300) < 1e-6 && Math.abs(br.y - 268) < 1e-6);
  const s = pc(15, box, rect, 50, PLAN_SHADOW.PAD);
  assert.ok(back(s[0]).x < 100 - PLAN_SHADOW.PAD + 1e-6 && back(s[2]).y > 268 + PLAN_SHADOW.PAD - 1e-6, '그림자 판은 상자 밖으로 여백');
  assert.equal(pc(0.01, box, rect, 50), null);
});

test('§115.3 판 뒤 DOM 라벨 잘라내기: 겹친 부분만 · 판 앞 라벨은 그대로 · 다 덮이면 숨김', async () => {
  const { labelBoardCut: cut, labelCutPath: path } = await import('../plan-core.mjs');
  const B = [{ x0: 100, y0: 100, x1: 300, y1: 250, zv: 20 }];
  const el = { left: 250, top: 120, width: 120, height: 30 };
  assert.deepEqual(cut(el, 30, B), { x0: 0, y0: 0, x1: 50, y1: 30 }, '판 뒤 라벨: 판과 겹친 왼쪽 50px');
  assert.equal(cut(el, 15, B), null, '판 앞 라벨은 그대로');
  assert.equal(cut({ left: 400, top: 120, width: 50, height: 20 }, 30, B), null, '겹치지 않음');
  assert.match(path({ x0: 0, y0: 0, x1: 50, y1: 30 }, 120, 30), /^polygon\(evenodd, 0 0, 100% 0/);
  assert.equal(path({ x0: 0, y0: 0, x1: 120, y1: 30 }, 120, 30), 'inset(50%)');
  // 두 판이면 가장 앞(가까운) 판 기준
  const two = cut({ left: 120, top: 120, width: 40, height: 20 }, 50, [...B, { x0: 130, y0: 110, x1: 200, y1: 200, zv: 10 }]);
  assert.equal(two.x0, 10);
});

test('§119 판 표시(v2): 큰 큐는 지금 항목 둘레 칸 창(앞서 끝난 수) · 지금 줄 단계 진행 · 메모 · 크게 보기 부가 정보', async () => {
  const { boardCard: bc, sheetInspectModel: sm, PLAN_UI: U } = await import('../plan-core.mjs');
  const items = Array.from({ length: 156 }, (_, i) => (i < 155
    ? { k: 'k' + i, t: '축 ' + i, st: 'done', s: 'done' }
    : { k: 'k' + i, t: '걷기 행 읽기 켜기', st: 'current', s: 'in_progress', doc: 'docs/plans/x.md', steps: { done: 3, total: 5, cur: '단계 3 — 켜기 규칙' } }));
  const plan = { v: 2, id: 'pq', src: 'axes', title: '자율 루프 축', at: 1, n: 156, items };
  const m = bc([{ owner: 's:m', runner: false, plan }], { mainId: 's:m' });
  assert.equal(m.cells.length, U.MAX_CELLS);
  assert.equal(m.before, 156 - U.MAX_CELLS, '앞서 끝난 칸 수');
  assert.ok(m.cells[m.cells.length - 1].cur, '지금 축 칸이 창 안');
  assert.equal(m.extra, 0);
  assert.deepEqual(m.lines[0].steps, { done: 3, total: 5, cur: '단계 3 — 켜기 규칙' });
  assert.equal(m.done, 155); assert.equal(m.total, 156);
  assert.equal(m.glyph, '⇶');
  // 표 꼴(행 = 항목): 메모·대기 다음 줄
  const t2 = { v: 2, id: 'pa', src: 'axes', title: 'ACTIVE', at: 1, n: 3, items: [
    { k: 'a', t: '강의 준비', st: 'current', s: 'in_progress', meta: ['11-10', '대외활동'], group: '대외활동' },
    { k: 'b', t: '3차평가 의견', st: 'blocked', s: 'pending', hold: 1, note: '검토대기', emph: 1 },
    { k: 'c', t: '이행노력 작성', st: 'pending', s: 'pending' }] };
  const m2 = bc([{ owner: 's:m', runner: false, plan: t2 }], { mainId: 's:m' });
  assert.equal(m2.before, 0);
  assert.deepEqual(m2.lines.map((l) => [l.t, l.st, l.note || null]), [['강의 준비', 'in_progress', null], ['3차평가 의견', 'hold', '검토대기'], ['이행노력 작성', 'pending', null]]);
  const s = sm([{ owner: 's:m', runner: false, plan: t2 }], { mainId: 's:m' })[0];
  assert.deepEqual(s.items.map((x) => [x.st, x.note, x.emph, x.meta.length]), [['in_progress', '', false, 2], ['hold', '검토대기', true, 0], ['pending', '', false, 0]]);
  const sq = sm([{ owner: 's:m', runner: false, plan }], { mainId: 's:m' })[0];
  assert.equal(sq.items[155].doc, 'docs/plans/x.md'); assert.equal(sq.items[155].steps.total, 5);
  // 건너뜀
  const sk = sm([{ owner: 's:m', runner: false, plan: { ...t2, items: [{ k: 'z', t: '취소한 일', st: 'skipped', s: 'done' }] } }], { mainId: 's:m' })[0];
  assert.equal(sk.items[0].st, 'skipped'); assert.equal(sk.items[0].glyph, '⤼');
});

test('§119 크게 보기: 항목이 많으면 지금 항목 앞 끝난 것은 접기 · 목록 스크롤 CSS', async () => {
  const { readFileSync } = await import('node:fs');
  const ui = readFileSync(new URL('../plan-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /const SHEET_FOLD = 30/);
  assert.match(ui, /<details><summary>/);
  const css = readFileSync(new URL('../plan.css', import.meta.url), 'utf8');
  assert.match(css, /\.ins-plan-big \.ipb-list \{ max-height: min\(60vh, 560px\); overflow: auto; \}/);
});

test('§115.5 모바일 글자 키움(text-size-adjust)을 판이 받지 않음 — 판은 배율로 글자와 함께 줄고 는다', async () => {
  const { readFileSync: rf } = await import('node:fs');
  const css = rf(new URL('../plan.css', import.meta.url), 'utf8');
  const pb = /\n\.pb \{([^}]*)\}/.exec(css.replace(/\r/g, ''));
  assert.ok(pb, '.pb 규칙');
  assert.match(pb[1], /-webkit-text-size-adjust: none;/);
  assert.match(pb[1], /(^|[^-])text-size-adjust: none;/);
  assert.match(pb[1], /overflow|transform-origin: 0 0/); // 고정 상자 + scale 배율 방식 그대로
  assert.ok(!/\.ins-plan-big \{[^}]*text-size-adjust/.test(css), '크게 보기 카드는 브라우저 키움을 그대로 받음');
});
