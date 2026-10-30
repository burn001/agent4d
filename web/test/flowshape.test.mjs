// 흐름 노드 모양 — 메인 배정 결정성·분포, 종류 → 실루엣, 2D/3D 같은 표, 몸 안 컨텍스트·띠 글·데스크 연출 값
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fnv, mainShapeBase, assignMainShapes, mainSetSig, silOf, silOutline, SIL, SIL_NAMES, SIL_DIM, reactorFills, bandWords, toolBand, ctxFrac, ctxTone, sendPhase, DESK } from '../flowview/shape-core.mjs';
import { MAIN_RIG, mainLook, mainLinkY } from '../flowview/main-rig-core.mjs';
import { NODE_STATE } from '../flowview/flow-style.mjs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('메인 배정: id 시드로 결정적 · 입력 순서 무관 · 반반 분포', () => {
  assert.equal(fnv('abc'), fnv('abc'));
  const ids = Array.from({ length: 2000 }, (_, i) => `s:${(i * 7919).toString(36)}-main`);
  const a = ids.map(mainShapeBase), b = ids.map(mainShapeBase);
  assert.deepEqual(a, b);
  const r = a.filter((x) => x === 'reactor').length / a.length;
  assert.ok(r > 0.45 && r < 0.55, `반응로 비율 ${r}`);
  // 한 메인씩 다른 프로젝트(섞을 짝 없음) → 기본 모양 그대로, 순서를 섞어도 같음
  const mains = ids.slice(0, 50).map((id, i) => ({ id, projectId: 'p' + i, status: 'active', startedAt: 1000 + i }));
  const m1 = assignMainShapes(mains), m2 = assignMainShapes([...mains].reverse());
  for (const m of mains) { assert.equal(m1.get(m.id), mainShapeBase(m.id)); assert.equal(m2.get(m.id), m1.get(m.id)); }
  assert.equal(mainSetSig(mains), mainSetSig([...mains].reverse()));
});

test('메인 배정: 같은 섬 live 메인 여럿은 시작 순서로 번갈아 섞임 · 새 메인이 와도 앞 메인 그대로 · 끝난 메인은 기본', () => {
  // 기본 모양이 같은 두 id 를 고른다(섞기가 실제로 일하는 경우)
  const pool = Array.from({ length: 200 }, (_, i) => 'm' + i);
  const same = pool.filter((id) => mainShapeBase(id) === 'reactor').slice(0, 3);
  const A = { id: same[0], projectId: 'P', status: 'active', startedAt: '2026-10-28T01:00:00Z' };
  const B = { id: same[1], projectId: 'P', status: 'idle', startedAt: '2026-10-28T02:00:00Z' };
  const C = { id: same[2], projectId: 'P', status: 'active', startedAt: '2026-10-28T03:00:00Z' };
  const two = assignMainShapes([B, A]);
  assert.equal(two.get(A.id), 'reactor'); assert.equal(two.get(B.id), 'column');
  const three = assignMainShapes([C, A, B]);
  assert.equal(three.get(A.id), two.get(A.id)); assert.equal(three.get(B.id), two.get(B.id)); assert.equal(three.get(C.id), 'reactor');
  // 끝난 메인은 섞기에서 빠지고 기본 모양
  const done = { ...A, status: 'done' };
  const m = assignMainShapes([done, B]);
  assert.equal(m.get(done.id), mainShapeBase(done.id)); assert.equal(m.get(B.id), mainShapeBase(B.id));
  // 다른 프로젝트끼리는 섞지 않음
  const other = assignMainShapes([A, { ...B, projectId: 'Q' }]);
  assert.equal(other.get(B.id), mainShapeBase(B.id));
});

test('종류 → 실루엣: 실루엣 문법 · 기동기·작업·분리 프로세스는 예전 틀', () => {
  assert.equal(silOf('subagent'), 'hex');
  assert.equal(silOf('workflow-agent'), 'cham');
  assert.equal(silOf('workflow'), 'cham');
  assert.equal(silOf('claude-p'), 'tier2');
  assert.equal(silOf('bash-bg'), 'term');
  assert.equal(silOf('monitor'), 'puck');
  assert.equal(silOf('bash-bg', { job: true }), 'hex');
  assert.equal(silOf('bash-bg', { proc: true }), 'hex');
  assert.equal(silOf('claude-p', { device: true }), 'hex');
  assert.equal(silOf('mystery'), 'hex');
  assert.deepEqual(SIL_NAMES.map((n) => SIL[n]), [0, 1, 2, 3, 4]); // 셰이더 aMeta.z 번호
  for (const n of SIL_NAMES) assert.ok(SIL_DIM[n].h > 0 && SIL_DIM[n].h < 1.2, n);
});

test('2D/3D 같은 표: 외곽선 꼭짓점 · flow2d·chips 가 같은 모듈을 읽음 · 셰이더 외곽과 같은 치수', () => {
  assert.equal(silOutline('hex', 1).length, 6);
  assert.equal(silOutline('cham', 1).length, 7); // 오른쪽 위 꼭짓점 하나를 깎아 둘로
  assert.equal(silOutline('term', 1).length, 4);
  assert.equal(silOutline('puck', 1).length, 24);
  const c = silOutline('cham', 1);
  assert.ok(c.every(([x, y]) => x * 0.8660254 - y * 0.5 <= 0.85 + 1e-6), '깎은 면(셰이더 shapeD 0.85) 안');
  const [bx, by] = SIL_DIM.term.box;
  const chips = read('../flowview/chips.js'), flat = read('../flat/flow2d.js'), rigs = read('../flowview/main-rigs.js');
  assert.match(chips, new RegExp(`vec2\\(${bx}, ${by}\\)`), '네모 터미널 반폭이 셰이더와 같음');
  assert.match(chips, /hexD\(p\) \/ 0\.66/); assert.equal(SIL_DIM.tier2.top, 0.66);
  assert.match(flat, /from '\.\.\/flowview\/shape-core\.mjs'/); assert.match(chips, /from '\.\/shape-core\.mjs'/);
  assert.match(flat, /assignMainShapes/); assert.match(rigs, /assignMainShapes/);
});

test('메인 몸: 컨텍스트 통합(기둥 여섯·액체) · 띠 글 = 실제 도구 이력 · 상태 어휘 · 빔 끝점', () => {
  assert.deepEqual(reactorFills(0), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(reactorFills(0.5), [1, 1, 1, 0, 0, 0]);
  assert.deepEqual(reactorFills(1), [1, 1, 1, 1, 1, 1]);
  assert.equal(ctxFrac({ meta: { ctx: { used: 50, limit: 200 } } }), 0.25);
  assert.equal(ctxFrac({ meta: {} }), null);
  assert.deepEqual([0.2, 0.29, 0.3, 0.6, 0.69, 0.7, 0.9].map(ctxTone), [0, 0, 1, 1, 1, 2, 2]); // 호박 시작 = HEAT.WARM_PCT 30
  // 이력 최신순 · 중복 제거 · minimal(대상 없음)이면 도구 이름만
  const hist = [{ label: 'Read · web/a.js' }, { label: 'Edit · web/b.js' }, { label: 'Read · web/a.js' }, { label: 'Bash' }];
  assert.deepEqual(bandWords(hist), ['Bash', 'Read · web/a.js', 'Edit · web/b.js']);
  assert.deepEqual(bandWords([{ label: 'Grep' }, { label: 'Read' }]), ['Read', 'Grep']);
  assert.equal(toolBand(new Map([['t1', { act: 'Read · x' }], ['t2', { act: 'Edit · flow-view.js' }]])), 'Edit · flow-view.js');
  assert.equal(toolBand(new Map()), '');
  const think = mainLook(NODE_STATE.thinking, 0), tool = mainLook(NODE_STATE.tool, 0), done = mainLook(NODE_STATE.done, 0), err = mainLook(NODE_STATE.error, 0.3);
  assert.ok(think.think && !think.sparks); assert.ok(tool.sparks && tool.spin > think.spin);
  assert.ok(done.dashed && done.spin === 0); assert.ok(err.pulse < 1);
  assert.equal(mainLook(NODE_STATE.tool, 0, true).spin, 0); // 움직임 줄이기
  assert.equal(mainLinkY(true), -MAIN_RIG.BOTTOM); assert.equal(mainLinkY(false), MAIN_RIG.TOP);
  // 메인 칩 둘레 컨텍스트 고리는 없음(몸에 통합) — 메인은 칩 묶음에서 빠짐
  assert.match(read('../flowview/chips.js'), /if \(v\.kind === 'main' && !v\.device\) return \(v\._sil = null\)/);
});

test('홀로그램 콘솔 데스크: 보낸 직후 위상 · 글 문턱 · 흐름 3D 는 글줄 막대 대신 화면 글', () => {
  assert.equal(sendPhase(null), -1); assert.equal(sendPhase(-1), -1); assert.equal(sendPhase(DESK.SEND_S + 0.1), -1);
  assert.ok(Math.abs(sendPhase(DESK.SEND_S / 2) - 0.5) < 1e-9);
  assert.ok(DESK.BADGE_PX < DESK.TEXT_PX && DESK.FPS <= 12);
  const ix = read('../ix-core.mjs');
  assert.match(ix, /if \(!B\) \{ \/\/ §113/);
  assert.match(read('../ix-fx.js'), /IxLayer\.BADGE/);
  assert.match(read('../flat/ix2d.js'), /_drawDesks/);
});
