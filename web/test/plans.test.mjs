// 계획 보드(웹 순수 코어): 진행·변경 비교·연출 큐·세션 메인으로 모으기·크기(홀로그램 2배)·배치·보드 모델·크게 보기·카메라 맞춤 점·회차 연결·팝업 모델·⚙ 첫 값·mock 드라이버
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_UI, planInitial, plansOf, planProgress, diffPlans, PlanFx, mainOf, gatherPlans, boardSize, boardCard, sheetInspectModel, placeSheet, PLAN_CAM, planFitPts,
  cycleNodeOf, cycleLinks, planInspectModel, boardAnchor, PLAN_ST_LABEL, BoardHold, holdAnchor, anchorLabelRel, nextLabelRel,
} from '../plan-core.mjs';
import { _setLangForTest } from '../i18n.mjs';
import { PlanMockDriver } from '../plan-mock.mjs';

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

test('§83 보드 크기 = 홀로그램 모니터의 약 2배(하한·상한), 배치: 메인 상자(원+이름표)는 덮지 않고 옆 먼저 · 결정적', () => {
  const s1 = boardSize(40, 2, 1440); // 축척 = 40/(1.3·2) ≈ 15.4px, 홀로 높이 ≈ (1.25+0.6)·15.4 ≈ 28.5px → 2배 폭 ≈ 85 → 하한
  assert.equal(s1.w, PLAN_UI.BOARD_MIN);
  const s2 = boardSize(200, 2, 1440); // 홀로 높이 ≈ 142 → 2배 폭 ≈ 427 → 상한
  assert.equal(s2.w, PLAN_UI.BOARD_MAX);
  const s3 = boardSize(110, 2, 1440);
  assert.ok(Math.abs(s3.w - (1.25 + 0.6) * (110 / 2.6) * 1.5 * PLAN_UI.HOLO_K) < 1, '그 사이는 정확히 2배');
  assert.equal(boardSize(200, 2, 300).w, 268, '좁은 화면이면 화면 폭 안');
  const bounds = { left: 0, top: 48, right: 1200, bottom: 860 };
  const a = { x: 600, y: 400, r: 30 };
  const core = { x: 560, y: 370, w: 80, h: 90 }; // 원 + 아래 이름표
  const p = placeSheet(a, { w: 210, h: 100 }, bounds, { core });
  assert.deepEqual(placeSheet(a, { w: 210, h: 100 }, bounds, { core }), p, '결정적');
  assert.equal(p.side, 1, '오른쪽 먼저');
  assert.ok(p.x >= core.x + core.w, '메인 상자 밖');
  // 오른쪽이 막히면 왼쪽
  const q = placeSheet(a, { w: 210, h: 100 }, bounds, { core, avoid: [{ x: 640, y: 200, w: 400, h: 400, k: 3 }] });
  assert.equal(q.side, -1);
  assert.ok(q.x + q.w <= core.x);
  // 화면 가장자리면 무대 안으로 밀어 넣음
  const e = placeSheet({ x: 1180, y: 60, r: 20 }, { w: 210, h: 100 }, bounds, {});
  assert.ok(e.x >= bounds.left && e.x + e.w <= bounds.right && e.y >= bounds.top && e.y + e.h <= bounds.bottom);
});

test('§83 보드 모델: 가장 앞 계획 — 완료/전체·칸(상태·외부 대기·회차)·지금 줄(진행 중 ≤2, 없으면 다음 대기)·다른 계획 수·연출', () => {
  const items = Array.from({ length: 30 }, (_, i) => I(String(i), i < 3 ? 'done' : i < 6 ? 'in_progress' : 'pending', i < 3 ? { cy: 7 + i, by: 's:c' + i } : i === 29 ? { hold: 1 } : {}));
  const entries = [{ owner: 'b:R', runner: true, plan: P('p1', items, { src: 'phases', title: '설계서.md' }) }, { owner: 's:m', runner: false, plan: P('p2', [I('x', 'pending')]) }];
  const fx = new PlanFx(); fx.note('b:R', [{ pid: 'p1', k: '1', kind: 'state', from: 'pending', to: 'done' }], 0);
  const m = boardCard(entries, { nowMs: 10, fx, mainId: 's:m', labelOf: () => '러너 · autopilot.sh' });
  assert.equal(m.cells.length, PLAN_UI.MAX_CELLS); assert.equal(m.extra, 30 - PLAN_UI.MAX_CELLS);
  assert.deepEqual(m.cells.slice(0, 4).map((c) => c.cy), [7, 8, 9, null]);
  assert.equal(m.cells[1].fx, 'done'); assert.equal(m.cells[3].cur, true);
  assert.deepEqual(m.lines.map((l) => [l.i, l.st, l.mark]), [[3, 'in_progress', '▶'], [4, 'in_progress', '▶']], '진행 중 두 줄');
  assert.equal(m.count, '3/30'); assert.equal(m.more, 1); assert.equal(m.hold, 1); assert.equal(m.glyph, '▤'); assert.equal(m.ownerLabel, '러너 · autopilot.sh');
  assert.ok(m.hot);
  const n = boardCard([{ owner: 's:m', runner: false, plan: P('d', [I('1', 'done'), I('2', 'pending', { hold: 1 }), I('3', 'pending')]) }], { mainId: 's:m' });
  assert.deepEqual(n.lines.map((l) => [l.i, l.next]), [[2, true]], '진행 중이 없으면 보류 아닌 다음 대기');
  assert.equal(n.ownerLabel, '메인'); assert.equal(n.cells[1].st, 'hold');
  assert.equal(boardCard([{ owner: 's:m', plan: P('d', [I('1', 'done')]) }]).allDone, true);
  assert.equal(boardCard([]), null);
});

test('§83 크게 보기 모델: 모인 계획 전부, 항목마다 상태 기호(✓▶○⏸)·회차·처리 노드 · 카메라 맞춤 점 · 회차 노드 찾기', () => {
  const entries = [{ owner: 'b:R', runner: true, plan: P('p', [I('0', 'done', { cy: 3, by: 's:c3', at: 1 }), I('1', 'in_progress', { by: 'a:x', at: 1 }), I('2', 'pending', { hold: 1 }), I('3', 'pending')], { src: 'phases', title: 'x-design.md', n: 4 }) }];
  const [m] = sheetInspectModel(entries, { nowMs: 120_000, labelOf: (id) => ({ 'b:R': '러너', 's:c3': '회차 3', 'a:x': '서브' }[id]), mainId: 's:m' });
  assert.equal(m.ownerLabel, '러너'); assert.equal(m.count, '1/4'); assert.equal(m.hold, 1);
  assert.deepEqual(m.items.map((x) => [x.glyph, x.st, x.cy]), [['✓', 'done', 3], ['▶', 'in_progress', null], ['⏸', 'hold', null], ['○', 'pending', null]]);
  PLAN_CAM.boards.clear();
  assert.equal(planFitPts('s:m', { x: 0, y: 0, z: 0 }, 2, { x: 1, z: 0 }, []).length, 0, '보드 없으면 그대로');
  PLAN_CAM.boards.set('s:m', 1);
  const [pt] = planFitPts('s:m', { x: 0, y: 0, z: 0 }, 2, { x: 1, z: 0 }, []);
  assert.ok(pt.p.x > 2.6 && pt.p.z === 0 && pt.r > 1 && pt.must, '오른쪽(화면) 옆, 반드시 담기');
  PLAN_CAM.boards.set('s:m', -1);
  assert.ok(planFitPts('s:m', { x: 0, y: 0, z: 0 }, 2, { x: 0, z: 1 }, [])[0].p.z < 0, '왼쪽');
  PLAN_CAM.boards.clear();
  const nodes = new Map([['s:c', { id: 's:c', kind: 'claude-p', parentId: 'b:R', meta: { cycle: 4 } }], ['a:k', { id: 'a:k', kind: 'subagent', parentId: 's:c', meta: {} }], ['a:z', { id: 'a:z', kind: 'subagent', parentId: 's:m', meta: {} }]]);
  assert.equal(cycleNodeOf('a:k', nodes), 's:c', '회차 하위 → 그 회차');
  assert.equal(cycleNodeOf('s:c', nodes), 's:c');
  assert.equal(cycleNodeOf('a:z', nodes), null, '회차 밖');
});

test('§83.7 보드 앵커: 러너 계획은 진행 중 회차(보일 때) > 러너 주인 > 메인, 러너 아니면 메인', () => {
  const nodes = new Map([['s:m', { id: 's:m', kind: 'main' }], ['b:R', { id: 'b:R', kind: 'bash-bg', parentId: 's:m', meta: { runner: 1 } }],
    ['s:c2', { id: 's:c2', kind: 'claude-p', parentId: 'b:R', status: 'active', meta: { cycle: 2 } }], ['s:c1', { id: 's:c1', kind: 'claude-p', parentId: 'b:R', status: 'done', meta: { cycle: 1 } }],
    ['a:k', { id: 'a:k', kind: 'subagent', parentId: 's:c2', status: 'active', meta: {} }]]);
  const E = (by, runner = true) => ({ owner: 'b:R', runner, plan: P('p', [I('0', 'done', { cy: 2, by })], { src: 'phases', by }) });
  assert.equal(boardAnchor(E('s:c2'), 's:m', nodes), 's:c2', '진행 중 회차');
  assert.equal(boardAnchor(E('a:k'), 's:m', nodes), 's:c2', '회차 하위가 붙들면 그 회차');
  assert.equal(boardAnchor(E('s:c2'), 's:m', nodes, (id) => id !== 's:c2'), 'b:R', '회차가 안 보이면 러너');
  assert.equal(boardAnchor(E('s:c1'), 's:m', nodes), 'b:R', '끝난 회차엔 붙지 않음');
  assert.equal(boardAnchor(E('s:c2'), 's:m', nodes, () => false), 's:m', '둘 다 안 보이면 메인');
  assert.equal(boardAnchor(E('s:c2', false), 's:m', nodes), 's:m', '러너 계획 아님');
  assert.equal(boardAnchor(null, 's:m', nodes), 's:m');
});

test('§83.8 보드 자리 안정: 오가는 이름표·말풍선엔 버팀(옛 방식은 좌우 왕복), 확실히 막히면 기다렸다 한 번, 앵커를 덮으면 바로', () => {
  // 라이브 복셀 재현: 앵커는 그대로, 근처 캐릭터 이름표(k 1.5)가 왼쪽 자리 ↔ 오른쪽 장애물(k 2)이 번갈아 비용을 바꿈 — 2.5초마다
  const bounds = { left: 0, top: 48, right: 1400, bottom: 860 };
  const a = { x: 700, y: 400, r: 30 }, size = { w: 210, h: 90 };
  const L = { x: 470, y: 340, w: 110, h: 34, k: 1.5 }, R = { x: 750, y: 360, w: 70, h: 36, k: 2 };
  const run = (useHold) => {
    const hold = new BoardHold(); let side = null, flips = 0, prev = null;
    for (let f = 0; f < 60 * 30; f++) {
      const now = f * 1000 / 60, phase = Math.floor(now / 2500) % 2;
      const avoid = phase ? [L] : [R];
      const p = placeSheet(a, size, bounds, { avoid, prevSide: side });
      const q = useHold ? hold.pick(p, now) : p;
      side = q.side;
      if (prev != null && q.i !== prev) flips++;
      prev = q.i;
    }
    return flips;
  };
  assert.ok(run(false) >= 6, '옛 방식(기억 없는 최선 후보)은 왕복');
  assert.equal(run(true), 0, '붙들기: 왕복 없음');
  // 지금 자리가 확실히 막히면 HOLD_WAIT_MS 이어진 뒤에 한 번 옮김
  const hold = new BoardHold();
  const big = { x: 740, y: 250, w: 300, h: 300, k: 3 };
  const p0 = placeSheet(a, size, bounds, {});
  assert.equal(hold.pick(p0, 0).side, 1);
  let moved = null;
  for (let t = 5000; t < 9000; t += 16) { const q = hold.pick(placeSheet(a, size, bounds, { avoid: [big], prevSide: 1 }), t); if (q.side !== 1 && moved == null) moved = t; }
  assert.ok(moved != null && moved - 5000 >= PLAN_UI.HOLD_WAIT_MS && moved - 5000 < PLAN_UI.HOLD_WAIT_MS + 50, `막힌 뒤 ${PLAN_UI.HOLD_WAIT_MS}ms 쯤 옮김 (${moved})`);
  // 옮긴 직후 HOLD_MIN_MS 안에는 다시 안 옮김
  const q2 = hold.pick(placeSheet(a, size, bounds, { avoid: [{ x: 300, y: 250, w: 360, h: 300, k: 3 }], prevSide: -1 }), moved + 2000);
  assert.equal(q2.side, -1);
  // 앵커 상자를 덮게 되면(화면 가장자리 밀어 넣기) 기다리지 않음
  const h2 = new BoardHold();
  h2.pick(placeSheet(a, size, bounds, {}), 0);
  const edge = { x: 1300, y: 400, r: 30 }; // 오른쪽 자리는 무대 안으로 밀려 원을 덮음
  assert.equal(h2.pick(placeSheet(edge, size, bounds, { prevSide: 1 }), 100).side, -1, '덮으면 바로 반대쪽');
});

test('§83.8 앵커 붙들기 · 자기 이름표만 core', () => {
  const st = { id: null };
  assert.equal(holdAnchor(st, 'c2', 0), 'c2');
  assert.equal(holdAnchor(st, 'R', 100), 'c2', '바뀐 후보가 잠깐이면 그대로');
  assert.equal(holdAnchor(st, 'c2', 300), 'c2');
  assert.equal(holdAnchor(st, 'R', 400), 'c2');
  assert.equal(holdAnchor(st, 'R', 400 + PLAN_UI.ANCHOR_MS - 1), 'c2');
  assert.equal(holdAnchor(st, 'R', 400 + PLAN_UI.ANCHOR_MS), 'R', '이어지면 바꿈');
  assert.equal(holdAnchor(st, 'm', 3000, (id) => id !== 'R'), 'm', '지금 앵커를 못 쓰면 바로');
  const a = { x: 500, y: 300, r: 20 };
  const own = { x: 450, y: 325, w: 100, h: 30 }, pass = { x: 420, y: 270, w: 120, h: 30 };
  assert.deepEqual(anchorLabelRel(a, [pass, own]), { x: -50, y: 25, w: 100, h: 30 }, '가로 중심이 가장 가까운 자기 이름표 하나');
  assert.equal(anchorLabelRel(a, [{ x: 900, y: 300, w: 80, h: 30 }]), null);
  // 이름표 폭: 커지면 바로, 줄면 한동안 이어진 뒤에
  const wide = { x: -80, y: 25, w: 160, h: 30 }, thin = { x: -40, y: 25, w: 80, h: 30 };
  let L = nextLabelRel(null, thin, 0);
  L = nextLabelRel(L, wide, 250); assert.deepEqual(L.rel, wide, '커지면 바로');
  L = nextLabelRel(L, thin, 500); assert.deepEqual(L.rel, wide, '줄어든 직후는 그대로');
  L = nextLabelRel(L, wide, 750); L = nextLabelRel(L, thin, 1000); assert.deepEqual(L.rel, wide);
  L = nextLabelRel(L, thin, 1000 + PLAN_UI.HOLD_WAIT_MS * 2); assert.deepEqual(L.rel, thin, '이어지면 줄임');
});

test('회차 연결: 처리 회차별 칸 묶음, 최근 회차 3개까지, 대기 칸 제외', () => {
  const items = [I('0', 'done', { cy: 1, by: 's:c1' }), I('1', 'done', { cy: 2, by: 's:c2' }), I('2', 'done', { cy: 2, by: 's:c2' }), I('3', 'done', { cy: 3, by: 's:c3' }), I('4', 'in_progress', { cy: 4, by: 's:c4' }), I('5', 'pending', { cy: 4, by: 's:c4' })];
  const L = cycleLinks(P('p', items));
  assert.deepEqual(L.map((x) => [x.by, x.cy, x.idx]), [['s:c4', 4, [4]], ['s:c3', 3, [3]], ['s:c2', 2, [1, 2]]]);
  assert.deepEqual(cycleLinks(null), []);
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
