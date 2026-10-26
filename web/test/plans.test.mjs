// 계획 보드(웹 순수 코어): 진행·변경 비교·연출 큐·세션 메인으로 모으기·월드 크기·자리(앵커 고정)·화면 투영(끌어오지 않음)·앵커 단일화·보드 모델·크게 보기·라벨 장애물·팝업 모델·⚙ 첫 값·mock 드라이버
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_UI, planInitial, plansOf, planProgress, diffPlans, PlanFx, mainOf, gatherPlans, boardWorld, holoMonitor, boardScreen, boardCard, sheetInspectModel, PLAN_CAM, planLabelRects,
  cycleNodeOf, planInspectModel, boardAnchor, liveCycleOf, PLAN_ST_LABEL,
} from '../plan-core.mjs';
import { _setLangForTest } from '../i18n.mjs';
import { PlanMockDriver } from '../plan-mock.mjs';
import { MON } from '../voxel/office-core.mjs';
import { HOLO } from '../holo-core.mjs';

const I = (k, s, o = {}) => ({ k, t: `항목 ${k}`, s, at: 1000, ...o });
const P = (id, items, o = {}) => ({ id, src: 'todo', title: '할 일', at: 5000, by: 's:m', n: items.length, items, ...o });

test('⚙ 첫 값: URL 이 우선, 없으면 저장값, 기본 끔 · plansOf 는 빈 계획을 거름', () => {
  assert.equal(planInitial(null, null), false);
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
  assert.ok(Math.abs(w.w - hh * 1.5) < 1e-9 && Math.abs(w.h - hh * 1.5) < 1e-9, '흐름·Planet: 폭 = 모니터 폭(높이 × 1.5), 높이 = 모니터 높이 × 1.5');
  assert.deepEqual(w.holo, holoMonitor(2));
  assert.ok(Math.abs(w.w / w.holo.w - 1) < 1e-9 && Math.abs(w.h / w.holo.h - PLAN_UI.HOLO_H_K) < 1e-9);
  const vx = boardWorld(2, 'voxel');
  assert.ok(Math.abs(vx.w - MON.H * MON.ASP) < 1e-9 && Math.abs(vx.h - MON.H * 1.5) < 1e-9, '복셀: 모니터(MON) 기준');
  assert.equal(PLAN_UI.VX_MON_H, MON.H); assert.equal(PLAN_UI.VX_MON_ASP, MON.ASP);
  assert.deepEqual(PLAN_UI.BOOST.voxel, [MON.MIN_PX, MON.BOOST]); assert.deepEqual(PLAN_UI.BOOST.flow, [HOLO.MIN_PX_ACTIVE, HOLO.BOOST_MAX]);
  // 멀면 활동 모니터처럼 최소 높이까지 키움(상한까지)
  const far = boardScreen({ x: 500, y: 400 }, 10, w, 1440, 900); // 모니터 높이 18.5px < 30 → ×1.62
  assert.ok(Math.abs(far.box.w - w.w * 10 * (30 / (w.holo.h * 10))) < 1e-6);
  const own = boardWorld(2, 'planet', { w: 3, h: 2 });
  assert.equal(own.w, 3); assert.equal(own.h, 3, '표현이 낸 모니터 크기(view.holoSize)가 우선');
  assert.ok(Math.abs(w.off - (2 * 1.3 + PLAN_UI.GAP_W)) < 1e-9, '원 바깥 오른쪽');
  assert.deepEqual(boardWorld(2), w, '결정적 — 화면·카메라 입력이 없다');
  // 화면 투영: 배율 = 월드 폭 × px/월드 / 기준 폭, 왼쪽 아래 모서리 = 투영 점, 높이 = 폭 × 비율
  const sc = boardScreen({ x: 500, y: 400 }, 60, w, 1440, 900);
  assert.ok(!sc.hidden && Math.abs(sc.s - (w.w * 60) / PLAN_UI.BASE_PX) < 1e-9);
  assert.equal(sc.box.x, 500); assert.ok(Math.abs(sc.box.y + sc.box.h - 400) < 1e-9, '아래 변 = 투영 점');
  assert.ok(Math.abs(sc.box.h / sc.box.w - w.aspect) < 1e-9); assert.equal(sc.lod, false);
  assert.equal(boardScreen({ x: 500, y: 400 }, 20, w, 1440, 900).lod, true, '작으면 간략');
  // 화면 가장자리 너머: 안으로 밀어 넣지 않고 그 자리(일부만 보임) 또는 숨김
  const edge = boardScreen({ x: 1400, y: 400 }, 60, w, 1440, 900);
  assert.equal(edge.hidden, false); assert.equal(edge.box.x, 1400, '오른쪽 끝 너머로 나가도 x 그대로');
  assert.equal(boardScreen({ x: 1500, y: 400 }, 60, w, 1440, 900).hidden, true, '판 전체가 화면 밖이면 숨김(끌어오지 않음)');
  assert.equal(boardScreen({ x: -2000, y: 400 }, 60, w, 1440, 900).hidden, true);
  assert.equal(boardScreen({ behind: true }, 0, w, 1440, 900).hidden, true, '카메라 뒤');
  assert.equal(boardScreen({ x: 500, y: 400 }, 0.5, w, 1440, 900).hidden, true, '너무 멀면(키움 상한 뒤에도 HIDE_PX 미만) 숨김');
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

test('§83.9 보드 앵커 단일화: 러너 계획 → 러너(회차와 무관), 러너 없으면 메인 · 러너 계획을 맨 앞으로', () => {
  const nodes = new Map([['s:m', { id: 's:m', kind: 'main' }], ['b:R', { id: 'b:R', kind: 'bash-bg', parentId: 's:m', status: 'active', meta: { runner: 1 } }],
    ['s:c2', { id: 's:c2', kind: 'claude-p', parentId: 'b:R', status: 'active', meta: { cycle: 2 } }], ['s:c1', { id: 's:c1', kind: 'claude-p', parentId: 'b:R', status: 'done', meta: { cycle: 1 } }],
    ['a:k', { id: 'a:k', kind: 'subagent', parentId: 's:c2', status: 'active', meta: {} }], ['a:s', { id: 'a:s', kind: 'subagent', parentId: 's:m', status: 'active', meta: {} }]]);
  const R = (by) => ({ owner: 'b:R', runner: true, plan: P('p', [I('0', 'done', { cy: 2, by })], { src: 'phases', by }) });
  const T = { owner: 's:m', runner: false, plan: P('t', [I('0', 'in_progress')]) };
  // 진행 중 회차·끝난 회차·회차 안 보임 — 앵커는 늘 러너
  for (const by of ['s:c2', 's:c1', 'a:k']) assert.equal(boardAnchor([R(by)], 's:m', nodes).id, 'b:R', by);
  assert.equal(boardAnchor([R('s:c2')], 's:m', nodes, (id) => id !== 's:c2').id, 'b:R', '회차가 안 보여도 러너');
  assert.equal(boardAnchor([R('s:c2')], 's:m', nodes, () => false).id, 'b:R', '러너가 잠깐 안 보여도 러너(보드는 숨김 — 메인으로 안 옮김)');
  // 메인 할 일이 더 앞 순서여도 러너 계획이 판 맨 앞
  const an = boardAnchor([T, R('s:c2')], 's:m', nodes);
  assert.equal(an.id, 'b:R'); assert.deepEqual(an.entries.map((e) => e.owner), ['b:R', 's:m']);
  // 러너 없는 계획(할 일·서브에이전트 체크박스·워크플로) → 메인
  assert.equal(boardAnchor([T], 's:m', nodes).id, 's:m');
  assert.equal(boardAnchor([{ owner: 'a:s', runner: false, plan: P('f', [I('0', 'pending')], { src: 'file' }) }], 's:m', nodes).id, 's:m');
  assert.equal(boardAnchor([{ owner: 'a:s', runner: true, plan: P('ph', [I('0', 'pending')], { src: 'phases' }) }], 's:m', nodes).id, 's:m', '단계 설계서라도 주인이 러너 노드가 아니면 메인');
  // 러너 노드가 기록에 없음 → 메인. 끝났고 화면에서도 사라짐 → 메인(한 번), 끝났어도 보이는 동안은 러너
  assert.equal(boardAnchor([{ ...R('s:c2'), owner: 'b:X' }], 's:m', nodes).id, 's:m', '러너 노드 없음');
  const ended = new Map(nodes); ended.set('b:R', { ...nodes.get('b:R'), status: 'done' });
  assert.equal(boardAnchor([R('s:c2')], 's:m', ended).id, 'b:R', '퇴장 중(보임)');
  assert.equal(boardAnchor([R('s:c2')], 's:m', ended, () => false).id, 's:m', '끝나고 사라짐');
  assert.deepEqual(boardAnchor([], 's:m', nodes), { id: 's:m', entries: [] });
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

test('mock 드라이버: 메인 할 일·기동기 단계(진행 중 회차 번호)·워크플로 단계를 결정적으로 낸다', () => {
  const nodes = new Map([
    ['s:m', { id: 's:m', kind: 'main', status: 'active', meta: {} }],
    ['b:L', { id: 'b:L', kind: 'bash-bg', status: 'active', meta: { launcher: { script: 'r.sh' } } }],
    ['s:c5', { id: 's:c5', kind: 'claude-p', parentId: 'b:L', status: 'active', meta: { cycle: 5 } }],
    ['w:1', { id: 'w:1', kind: 'workflow', label: '빌드', status: 'active', meta: {} }],
  ]);
  const run = () => {
    const out = [];
    const d = new PlanMockDriver({ nodes: () => nodes.values(), emit: (e) => out.push(e), seed: 1 });
    d.on = true; d._seed();
    for (let i = 0; i < 12; i++) d._tick();
    d.stop();
    return out;
  };
  const a = run(), b = run();
  assert.deepEqual(a.map((e) => [e.nodeId, e.patch.meta.plans[0].items.map((x) => x.s).join(',')]), b.map((e) => [e.nodeId, e.patch.meta.plans[0].items.map((x) => x.s).join(',')]), '결정적');
  const last = (id) => a.filter((e) => e.nodeId === id).pop().patch.meta.plans[0];
  assert.equal(last('s:m').src, 'todo');
  assert.equal(last('w:1').src, 'workflow');
  const L = last('b:L');
  assert.equal(L.src, 'phases');
  assert.ok(L.items.filter((x) => x.s === 'done').every((x) => x.cy === 5 && x.by === 's:c5'), '기동기 단계는 진행 중 회차가 닫음');
});

test('§86 보드 모델 영어: 출처·상태 라벨, 이름 없는 항목·메인·제목 대체, 얼마 전', () => {
  _setLangForTest('en');
  try {
    const entries = [{ owner: 's:m', runner: false, plan: { id: 'p', src: 'tasks', at: 1, by: 's:m', n: 2, items: [{ k: '1', s: 'done', at: 1 }, { k: '2', s: 'pending', at: 1 }] } }];
    const m = boardCard(entries, { mainId: 's:m' });
    assert.equal(m.ownerLabel, 'Main'); assert.equal(m.srcLabel, 'Task list (Task)'); assert.equal(m.title, 'Task list (Task)');
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
