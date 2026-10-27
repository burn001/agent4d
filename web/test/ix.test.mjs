// 특별 상호작용 연출 순수 부분
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ixSummary, ixHtml, ixMark, IxModel, IXFX, ixGeometry, IxGeo, IXGEO, testScore, ixColor, IX_CATS, IX_FLOOR, IX_LINE_PX, IX_MIN_PX, IX_SCALE_MAX, ixScale, IX_PLANET, ixSeedEvent, ixDimUnderLabels, IX_UNDER_LABEL, segHitsBox, ixRectHits, ixLabelSizeGuess } from '../ix-core.mjs';
import { JOBW, jobLabelNear } from '../job-core.mjs';
import { ixSound, eventToSound, SOUNDS } from '../sfx.mjs';
import { markFor } from '../timeline.mjs';
import { MockGenerator } from '../mock.js';

const E = (type, ix, extra = {}) => ({ type, nodeId: 'a', toolUseId: 't1', ix: { v: 1, ...ix }, ...extra });

test('요약 한 줄: push 커밋 수·pull·PR·CI·테스트 점수·db·remote·batch', () => {
  assert.equal(ixSummary({ cat: 'github', op: 'push', phase: 'end', ok: true, commits: 3, remote: 'origin', branch: 'main' }), 'push 3 commits → origin/main');
  assert.equal(ixSummary({ cat: 'github', op: 'push', phase: 'end', ok: true, commits: 1, branch: 'feat', newBranch: 1 }), 'push 1 commit → feat (새 브랜치)');
  assert.equal(ixSummary({ cat: 'github', op: 'push', phase: 'end', ok: false, rejected: 1 }), 'push 거부됨');
  assert.equal(ixSummary({ cat: 'github', op: 'pull', phase: 'end', ok: true, upToDate: 1 }), 'pull · 이미 최신');
  assert.equal(ixSummary({ cat: 'github', op: 'pr-create', phase: 'end', pr: 58 }), 'PR #58 생성');
  assert.equal(ixSummary({ cat: 'github', op: 'pr-checks', phase: 'end', pr: 58, ci: { pass: 3, fail: 1, pending: 0 } }), 'CI #58 ✓3 ✗1');
  assert.equal(ixSummary({ cat: 'tests', runner: 'pytest', phase: 'end', pass: 120, fail: 2, skip: 0, ms: 4560 }), 'pytest ✓120 ✗2 · 4.6s');
  assert.equal(ixSummary({ cat: 'tests', runner: 'npm', phase: 'start' }), 'npm 실행');
  assert.equal(testScore({ pass: 238, fail: 1 }), '✓238 ✗1');
  assert.equal(ixSummary({ cat: 'db', engine: 'mongo', db: 'appdb', rw: 'r', rows: 4821, phase: 'end' }), 'mongo appdb 읽기 · 4,821행');
  assert.equal(ixSummary({ cat: 'remote', op: 'scp', host: 'devbox', transfer: 'up', bytes: 12_400_000, phase: 'end', ok: true }), 'scp ↑ devbox · 12MB');
  assert.equal(ixSummary({ cat: 'batch', op: 'loop', n: 40, i: 12 }), '반복 12/40');
  assert.equal(ixSummary({ cat: 'batch', op: 'streak', tool: 'Edit', i: 14 }), 'Edit 연속 ×14');
  assert.match(ixHtml({ cat: 'tests', runner: 'node', phase: 'end', ok: false, pass: 2, fail: 1 }), /ix-c-tests ix-fail/);
  assert.equal(ixHtml({ cat: 'nope' }), '');
  for (const c of IX_CATS) { assert.match(ixColor(c, false), /^hsl/); assert.match(ixColor(c, true), /38%\)$/); }
});

test('타임라인·효과음: 시작 = 범주 글리프, 끝 = 결과색, 진행 출력은 표식·소리 없음', () => {
  const st = markFor(E('tool-start', { cat: 'github', op: 'push', phase: 'start' }));
  assert.deepEqual([st.shape, st.color], ['glyph', 'ix:github']);
  const en = markFor(E('tool-end', { cat: 'tests', runner: 'node', phase: 'end', ok: false, pass: 2, fail: 1 }));
  assert.deepEqual([en.shape, en.color, en.row], ['glyph', 'error', 1]);
  assert.equal(markFor(E('output', { cat: 'tests', phase: 'progress', pass: 3 })), null);
  assert.equal(ixMark(E('tool-end', { cat: 'tests', phase: 'progress' })), null);
  assert.deepEqual(ixSound(E('tool-end', { cat: 'github', op: 'push', phase: 'end', ok: true, commits: 2 })), ['ix-push', 1]);
  assert.deepEqual(ixSound(E('tool-end', { cat: 'github', op: 'pr-checks', phase: 'end', ok: false, ci: { pass: 2, fail: 1, pending: 0 } })), ['ix-fail2', 1]);
  assert.deepEqual(ixSound(E('tool-end', { cat: 'tests', phase: 'end', ok: true, pass: 10, fail: 0 })), ['ix-pass', 1]);
  assert.deepEqual(ixSound(E('tool-start', { cat: 'remote', op: 'ssh', phase: 'start' })), ['ix-connect', 2]);
  assert.equal(eventToSound(E('output', { cat: 'tests', phase: 'progress' }), null), null, '진행 출력은 소리 없음');
  assert.equal(eventToSound(E('tool-start', { cat: 'github', op: 'push', phase: 'start' }, { cat: 'shell' }), null).name, 'shell', '의미 없는 순간은 기본 소리');
  for (const n of ['ix-push', 'ix-pull', 'ix-pr', 'ix-merge', 'ix-fail2', 'ix-pass', 'ix-connect', 'ix-db', 'ix-fan', 'ix-batch', 'ix-stamp']) assert.ok(SOUNDS[n] && SOUNDS[n].dur <= 0.4, n);
});

test('IxModel: 시작·끝·잔광, 짧은 반복은 조용히, 백그라운드 노드 연결·출력 진행, 상한', () => {
  const m = new IxModel();
  m.event(E('tool-start', { cat: 'github', op: 'push', phase: 'start' }), 0, 1, () => 'r');
  m.event(E('tool-end', { cat: 'github', op: 'push', phase: 'end', ok: true, commits: 2 }), 1);
  const f = m.fx.get('t1');
  assert.deepEqual([f.tEnd, f.ok, f.ix.commits, f.root], [1, true, 2, 'r']);
  assert.ok(m.portal.has('r'));
  m.step(1 + IXFX.LINGER.github - 0.1); assert.equal(m.size, 1);
  m.step(1 + IXFX.LINGER.github + 0.1); assert.equal(m.size, 0, '잔광 뒤 정리');
  // 짧은 for 루프(총량 모름)는 문턱 전에 끝나면 안 보임
  m.event(E('tool-start', { cat: 'batch', op: 'loop', phase: 'start' }, { toolUseId: 'L' }), 10);
  m.event(E('tool-end', { cat: 'batch', op: 'loop', phase: 'end', ok: true }, { toolUseId: 'L' }), 10.5);
  assert.equal(m.fx.has('L'), false);
  m.event(E('tool-start', { cat: 'batch', op: 'loop', n: 50, phase: 'start' }, { toolUseId: 'L2' }), 20);
  assert.equal(m.fx.get('L2').showAt, 20, '총량이 크면 곧바로');
  // 백그라운드 테스트: node-add(meta.toolUseId) 로 노드 연결, 출력 ix(ref) 로 진행, 노드 끝 = 효과 끝
  m.event(E('tool-start', { cat: 'tests', op: 'run', bg: 1, phase: 'start' }, { toolUseId: 'B' }), 30);
  m.event({ type: 'node-add', nodeId: 'b:x', node: { id: 'b:x', meta: { toolUseId: 'B' } } }, 30.2);
  assert.equal(m.fx.get('B').bgNode, 'b:x');
  m.event({ type: 'output', nodeId: 'b:x', ix: { v: 1, cat: 'tests', op: 'run', phase: 'progress', pass: 5, fail: 0, ref: 'B' } }, 31);
  assert.equal(m.fx.get('B').ix.pass, 5);
  m.event({ type: 'node-update', nodeId: 'b:x', patch: { status: 'error' } }, 33);
  assert.deepEqual([m.fx.get('B').tEnd, m.fx.get('B').ok], [33, false]);
  // 연속·분기: 같은 열쇠로 이어지고, 새 호출이 없으면 끝
  for (let i = 4; i <= 6; i++) m.event({ type: 'tool-start', nodeId: 'z', toolUseId: 'f' + i, ix: { v: 1, cat: 'batch', op: 'fan', i, phase: 'progress' } }, 40 + i * 0.1);
  assert.equal(m.fx.get('fan:z').ix.i, 6);
  m.step(40.6 + IXFX.IDLE_S + 0.1);
  assert.ok(m.fx.get('fan:z').tEnd != null);
  // 상한: 노드당 3, 전체 48
  const big = new IxModel();
  for (let i = 0; i < 300; i++) big.event({ type: 'tool-start', nodeId: 'n' + (i % 40), toolUseId: 'u' + i, ix: { v: 1, cat: 'db', op: 'query', phase: 'start' } }, i * 0.01);
  assert.ok(big.size <= IXFX.MAX);
  const per = {}; for (const f2 of big.fx.values()) per[f2.nodeId] = (per[f2.nodeId] || 0) + 1;
  assert.ok(Object.values(per).every((n) => n <= IXFX.PER_NODE));
});

test('ixGeometry: 범주·표현별 도형, 상한을 넘지 않음(부하 300 효과)', () => {
  const env = (theme) => ({ theme, pos: (id) => ({ x: (id.length % 7) * 3, y: 0, z: 0 }), rad: () => 1, root: () => 'r', reduced: false });
  const scen = [
    ['github', { op: 'push', commits: 5, ok: true }], ['github', { op: 'pull', files: 4, ok: true }], ['github', { op: 'pr-create', pr: 3, ok: true }], ['github', { op: 'pr-merge', pr: 3, ok: true }],
    ['github', { op: 'pr-checks', ci: { pass: 3, fail: 1, pending: 1, skip: 0 }, ok: false }], ['github', { op: 'commit', ok: true }],
    ['db', { op: 'query', rw: 'w', rows: 9, ok: true }], ['remote', { op: 'scp', host: 'h', transfer: 'up', ok: true }], ['batch', { op: 'loop', n: 40, i: 12 }], ['batch', { op: 'fan', i: 5 }],
    ['tests', { op: 'run', pass: 230, fail: 2, skip: 6, total: 238, ok: false }],
  ];
  for (const theme of ['flow', 'planet']) {
    for (const [cat, ix] of scen) {
      const m = new IxModel();
      m.event({ type: 'tool-start', nodeId: 'node', toolUseId: 'q', ix: { v: 1, cat, ...ix, phase: 'start' } }, 0, 1, () => 'r');
      const g0 = ixGeometry(m, 0.5, env(theme));
      assert.ok(g0.nl + g0.nq > 0, `${theme} ${cat}/${ix.op} 진행 중 도형`);
      m.event({ type: 'tool-end', nodeId: 'node', toolUseId: 'q', ix: { v: 1, cat, ...ix, phase: 'end' } }, 1, 1, () => 'r');
      const g1 = ixGeometry(m, 1.6, env(theme));
      assert.ok(g1.nl + g1.nq > 0, `${theme} ${cat}/${ix.op} 끝 연출`);
    }
    const t = new IxModel();
    t.event({ type: 'tool-end', nodeId: 'node', toolUseId: 'q', ix: { v: 1, cat: 'tests', pass: 238, fail: 1, phase: 'end', ok: false } }, 0, 1);
    assert.ok(ixGeometry(t, 0.5, env(theme)).labels.some((l) => l.text === '✓238 ✗1'), '스코어 배지');
  }
  // 부하: 300 효과(상한 48 로 잘림) × 모든 범주 → 버퍼 상한 안
  const m = new IxModel();
  for (let i = 0; i < 300; i++) { const [cat, ix] = scen[i % scen.length]; m.event({ type: 'tool-start', nodeId: 'n' + i, toolUseId: 'u' + i, ix: { v: 1, cat, ...ix, phase: 'start' } }, 0, 1, () => 'r' + (i % 5)); }
  const geo = new IxGeo();
  const g = ixGeometry(m, 2, env('flow'), geo);
  assert.ok(g.nl <= IXGEO.LINES && g.nq <= IXGEO.QUADS && g.labels.length <= IXGEO.LABELS);
  assert.equal(ixGeometry(new IxModel(), 0, env('flow'), geo).nl, 0, '버퍼 재사용·비우기');
});

test('mock: ix 시나리오는 켤 때만, 기존 시나리오 순서는 그대로', () => {
  const run = (ix) => { const g = new MockGenerator({ seed: 2026, startMs: 0, ix }); const out = []; for (let i = 0; i < 4000; i++) out.push(...g.next().events); return out; };
  const a = run(false), b = run(true);
  assert.ok(!a.some((e) => e.ix));
  const cats = new Set(b.filter((e) => e.ix).map((e) => e.ix.cat));
  for (const c of IX_CATS) assert.ok(cats.has(c), c);
  const strip = (evs) => evs.filter((e) => !e.ix && !/^toolu_demo/.test('x')).filter((e) => e.type === 'node-add').map((e) => e.nodeId);
  assert.deepEqual(strip(b).slice(0, 8), strip(a).slice(0, 8), '노드 생성 순서 같음');
});

test('user(§68.9): 요약·콘솔·빔/리본·질문 신호등·자동 알림 회색 점·효과음', () => {
  assert.equal(ixSummary({ cat: 'user', op: 'prompt', text: '글자 키워 줘', waitMs: 125000 }), '나 › 글자 키워 줘 · 2분 만에');
  assert.equal(ixSummary({ cat: 'user', op: 'ask', phase: 'end', pick: 1, answer: '가로' }), '답 › 2번 · 가로');
  assert.equal(ixSummary({ cat: 'user', op: 'reply', phase: 'end', turnMs: 5200, text: '키웠습니다.' }), '메인 › 답변 · 5.2s · 키웠습니다.');
  assert.equal(ixHtml({ cat: 'user', op: 'auto', src: 'notify' }), '', '자동 알림은 패널 머리 없음');
  const m = new IxModel();
  const env = { theme: 'flow', pos: () => ({ x: 0, y: 0, z: 0 }), rad: () => 1, root: () => 'M', reduced: false };
  m.event({ type: 'user', nodeId: 'M', ix: { v: 1, cat: 'user', op: 'prompt', text: '글자 키워 줘', phase: 'end' } }, 0, 1, () => 'M');
  assert.ok(m.console.has('M'));
  const g = ixGeometry(m, 0.5, env);
  assert.ok(g.labels.some((l) => l.cls === 'ix-ribbon' && l.text === '글자 키워 줘'), '첫 몇 단어 리본');
  m.event({ type: 'tool-start', nodeId: 'M', toolUseId: 'q', ix: { v: 1, cat: 'user', op: 'ask', opts: 3, phase: 'start' } }, 1, 1, () => 'M');
  assert.equal(m.console.get('M').asking, 1);
  assert.ok(ixGeometry(m, 1.5, env).labels.some((l) => l.text === '?'));
  m.event({ type: 'tool-end', nodeId: 'M', toolUseId: 'q', ix: { v: 1, cat: 'user', op: 'ask', opts: 3, pick: 2, phase: 'end', ok: true } }, 2, 1, () => 'M');
  assert.ok(ixGeometry(m, 2.2, env).labels.some((l) => l.text === '3'));
  m.event({ type: 'node-update', nodeId: 'M', patch: { status: 'idle' }, ix: { v: 1, cat: 'user', op: 'reply', phase: 'end' } }, 3, 1, () => 'M');
  assert.equal(m.console.get('M').replyAt, 3);
  // 다른 범주 효과를 밀어내지 않음
  m.event({ type: 'tool-start', nodeId: 'M', toolUseId: 'p', ix: { v: 1, cat: 'github', op: 'push', phase: 'start' } }, 3, 1, () => 'M');
  for (let i = 0; i < 8; i++) m.event({ type: 'user', nodeId: 'M', ix: { v: 1, cat: 'user', op: 'auto', phase: 'end' } }, 3 + i * 0.01, 1, () => 'M');
  assert.ok(m.fx.has('p'));
  assert.ok([...m.fx.values()].filter((f) => f.cat === 'user').length <= IXFX.USER_PER_NODE);
  assert.deepEqual(ixSound({ type: 'user', ix: { cat: 'user', op: 'prompt' } }), ['ix-chime', 1]);
  assert.deepEqual(ixSound({ type: 'tool-start', ix: { cat: 'user', op: 'ask' } }), ['ix-ping', 2]);
  assert.equal(eventToSound({ type: 'user', origin: 'task-notification', nodeId: 'M', ix: { cat: 'user', op: 'auto' } }, null), null);
  for (const n of ['ix-chime', 'ix-ping']) assert.ok(SOUNDS[n].dur <= 0.4);
});

test('영어(§86): 요약 한 줄에 한글 없음 · 복수형', async () => {
  const { _setLangForTest } = await import('../i18n.mjs');
  _setLangForTest('en');
  try {
    assert.equal(ixSummary({ cat: 'github', op: 'push', phase: 'start', remote: 'origin', branch: 'main', commitsHere: 2 }), 'push → origin/main (2 commits)');
    assert.equal(ixSummary({ cat: 'github', op: 'pr-create', pr: 12, phase: 'end' }), 'PR #12 opened');
    assert.equal(ixSummary({ cat: 'db', engine: 'mongo', rw: 'w', rows: 1200, phase: 'end' }), 'mongo write · 1,200 rows');
    assert.equal(ixSummary({ cat: 'user', op: 'deny', tool: 'Bash' }), 'Me › Denied · Bash');
    assert.equal(ixSummary({ cat: 'user', op: 'ask', phase: 'start', text: 'Which?', opts: 1 }), 'Question › Which? (1 option)');
    assert.equal(ixSummary({ cat: 'batch', op: 'fan', i: 5 }), 'Fan-out ×5');
    const cases = [
      { cat: 'github', op: 'pull', phase: 'end', upToDate: true, conflicts: 1 }, { cat: 'github', op: 'commit', empty: true },
      { cat: 'github', op: 'run', phase: 'start' }, { cat: 'tests', runner: 'pytest' }, { cat: 'remote', host: '', ok: false, phase: 'end' },
      { cat: 'user', op: 'prompt', text: 'x', images: 2, waitMs: 120000 }, { cat: 'user', op: 'ask', phase: 'end', declined: true },
      { cat: 'user', op: 'reply', turnMs: 5200 }, { cat: 'batch', op: 'streak', i: 3 }, { cat: 'batch', op: 'loop', i: 1, n: 4 },
    ];
    for (const ix of cases) assert.doesNotMatch(ixSummary(ix), /[가-힣]/, JSON.stringify(ix));
  } finally { _setLangForTest('ko'); }
});

test('§84 ixGeometry 는 env.fade(프로젝트 페이드)를 곱하고 0 이면 안 그림', () => {
  const env = (fade) => ({ theme: 'flow', pos: () => ({ x: 0, y: 0, z: 0 }), rad: () => 1, root: () => 'r', reduced: false, fade });
  const m = new IxModel();
  m.event({ type: 'tool-start', nodeId: 'node', toolUseId: 'q', ix: { v: 1, cat: 'db', op: 'query', rw: 'w', rows: 9, ok: true, phase: 'start' } }, 0, 1, () => 'r');
  const sum = (g) => { let s = 0; for (let i = 0; i < g.nl; i++) s += g.LA[i]; for (let i = 0; i < g.nq; i++) s += g.QA[i]; return s; };
  const full = ixGeometry(m, 0.5, env(null)), fs = sum(full);
  const half = ixGeometry(m, 0.5, env(() => 0.5), new IxGeo());
  assert.ok(fs > 0 && sum(half) < fs * 0.75);
  assert.equal(half.ka, 1);
  const none = ixGeometry(m, 0.5, env(() => 0), new IxGeo());
  assert.equal(none.nl + none.nq + none.labels.length, 0);
});

// ── 흐름 연출 묶음 1(P0 수리): F1 굵은 선 폭 · F2 스테이션 화면 하한 · F3 바닥 자리 · F4 포털 평소 숨김 · F5 잔광 하한 · F6 움직임 줄이기 배선 ──
const floorEnv = (o = {}) => ({ theme: 'flow', pos: () => ({ x: 0, y: 9, z: 0 }), rad: () => 1.7, root: () => 'n', reduced: false, floorY: -2.2, vip: () => false, ppu: () => 0, ...o });
const one = (cat, ix, tEnd = null) => { const m = new IxModel(); m.event({ type: 'tool-start', nodeId: 'n', toolUseId: 'q', ix: { v: 1, cat, ...ix, phase: 'start' } }, 0, 1, () => 'n'); if (tEnd != null) m.event({ type: 'tool-end', nodeId: 'n', toolUseId: 'q', ix: { v: 1, cat, ...ix, phase: 'end', ok: true } }, tEnd, 1, () => 'n'); return m; };
const quadsOf = (g) => { const a = []; for (let i = 0; i < g.nq; i++) a.push({ x: g.Q[i * 4], y: g.Q[i * 4 + 1], z: g.Q[i * 4 + 2], s: g.Q[i * 4 + 3] }); return a; };

test('F3 바닥 스테이션: tests·batch·remote·db 가 노드 높이(홀로그램 슬롯)가 아니라 바닥에, 발밑 무대 밖 정해진 방위 · floorY 없으면(2D) 예전 자리', () => {
  const foot = 1.7 * IX_FLOOR.FOOT_K;
  const tq = quadsOf(ixGeometry(one('tests', { op: 'run', pass: 50, fail: 2, total: 52 }), 0.5, floorEnv()));
  assert.ok(tq.length >= 52 && tq.every((q) => q.y < -2.2 + 1 && Math.hypot(q.x, q.z) > foot), '점수판은 바닥·무대 밖');
  assert.ok(tq.every((q) => q.x < 0 && q.z < 0.5), '왼쪽 뒤(−x, −z 쪽)');
  const bq = quadsOf(ixGeometry(one('batch', { op: 'loop', n: 40, i: 10 }), 2, floorEnv()));
  assert.ok(bq.length === 40 && bq.every((q) => q.y < -2.2 + 1 && q.z > 0 && Math.hypot(q.x, q.z) > foot), '진행 띠는 앞쪽 호');
  const rg = ixGeometry(one('remote', { op: 'ssh', host: 'h' }), 1, floorEnv());
  assert.ok(rg.nl > 0);
  for (let i = 0; i < rg.nl; i++) assert.ok(rg.L[i * 6 + 1] < -2.2 + 3 && rg.L[i * 6 + 4] < -2.2 + 3, '터널은 바닥 높이');
  const dg = ixGeometry(one('db', { op: 'query', rw: 'r', rows: 4821 }, 0.5), 1.5, floorEnv());
  let low = 0; for (let i = 0; i < dg.nl; i++) if (dg.L[i * 6 + 1] < 3 && dg.L[i * 6 + 4] < 3 && dg.L[i * 6] > 0) low++;
  assert.ok(low / dg.nl > 0.9, '실린더는 오른쪽(+x) 바닥 — 노드로 가는 방울 줄만 위로');
  // 2D(floorY 없음)는 예전 자리: 테스트 타일이 노드 높이
  const old = quadsOf(ixGeometry(one('tests', { op: 'run', pass: 5, total: 5 }), 0.5, floorEnv({ floorY: null })));
  assert.ok(old.length && old.every((q) => q.y === 9));
});

test('F2 스테이션 화면 하한: clamp(IX_MIN_PX / (폭 × ppu), 1, 3) · vip 만 · 점이 아니라 판 전체(간격·크기)를 키움', () => {
  assert.equal(ixScale(0, 5), 1, 'vip 아님(ppu 0)');
  assert.equal(ixScale(IX_MIN_PX / 5, 5), 1, '경계 = 1');
  assert.equal(ixScale(IX_MIN_PX / 10, 5), 2);
  assert.equal(ixScale(0.5, 5), IX_SCALE_MAX, '상한');
  assert.equal(ixScale(100, 5), 1, '충분히 크면 그대로');
  const span = (q) => Math.max(...q.map((p) => p.x)) - Math.min(...q.map((p) => p.x));
  const m = one('tests', { op: 'run', pass: 60, fail: 4, total: 64 });
  const a = quadsOf(ixGeometry(m, 0.5, floorEnv()));
  const b = quadsOf(ixGeometry(m, 0.5, floorEnv({ vip: () => true, ppu: () => 1 }), new IxGeo()));
  assert.ok(Math.abs(span(b) / span(a) - IX_SCALE_MAX) < 0.01 && Math.abs(b[0].s / a[0].s - IX_SCALE_MAX) < 1e-6, '간격·크기 같이 3배');
});

test('F1 굵은 선 폭: 기본 2px · vip 3px(LW) · F4 흐름 포털은 활동·CI 실패 잔광 때만', () => {
  const m = one('db', { op: 'query', rw: 'w' });
  const g0 = ixGeometry(m, 0.5, floorEnv());
  assert.ok(g0.nl > 0 && [...g0.LW.slice(0, g0.nl)].every((w) => w === IX_LINE_PX.BASE));
  const g1 = ixGeometry(m, 0.5, floorEnv({ vip: () => true }), new IxGeo());
  assert.ok([...g1.LW.slice(0, g1.nl)].every((w) => w === IX_LINE_PX.VIP));
  const p = new IxModel();
  p.event({ type: 'tool-start', nodeId: 'n', toolUseId: 'g', ix: { v: 1, cat: 'github', op: 'push', phase: 'start' } }, 0, 1, () => 'n');
  assert.ok(ixGeometry(p, 0.5, floorEnv()).nl > 0, '활동 중 포털');
  p.event({ type: 'tool-end', nodeId: 'n', toolUseId: 'g', ix: { v: 1, cat: 'github', op: 'push', phase: 'end', ok: true } }, 1, 1, () => 'n');
  p.step(10);
  assert.ok(p.portal.has('n') && p.fx.size === 0);
  assert.equal(ixGeometry(p, 10, floorEnv(), new IxGeo()).nl, 0, '평소 포털 없음(예전 알파 0.07)');
  p.portal.get('n').ciFailAt = 10;
  assert.ok(ixGeometry(p, 10.5, floorEnv(), new IxGeo()).nl > 0, 'CI 실패 잔광');
});

test('F5 잔광 하한 3초(÷√배속) · remote 터널은 잔광 동안 천천히 닫힘 · F6 3D 움직임 줄이기 배선', () => {
  for (const [c, s] of Object.entries(IXFX.LINGER)) assert.ok(s >= IXFX.LINGER_MIN, c);
  const m = one('remote', { op: 'ssh', host: 'h' }, 1);
  assert.ok(ixGeometry(m, 1 + 2.0, floorEnv()).nl > 0, '끝나고 2초 뒤에도 보임(예전 0.9초에 닫힘)');
  m.step(1 + IXFX.LINGER.remote + 0.05); assert.equal(m.size, 0);
  // 배선은 three 를 node 에서 못 불러 글자 대조(실행이 닿지 않는 곳)
  const src = readFileSync(new URL('../ix-fx.js', import.meta.url), 'utf8');
  assert.match(src, /update\(now\) \{\n\s+this\._env\.reduced = !!this\.view\.reduced;/, 'update 첫 줄에서 view.reduced 를 읽음');
});

// ── 묶음 1 의 Planet 보정: 갑판 스테이션(행성 아래 · 카메라 쪽 반원 · 궤도계 밖) · 기본 크기 K × 화면 하한 · 움직임 줄이기 ──
const deckEnv = (o = {}) => ({ theme: 'planet', pos: () => ({ x: 0, y: 0, z: 0 }), rad: () => 1.5, root: () => 'n', reduced: false, deck: true, ext: () => 4, vip: () => false, ppu: () => 0, ...o });

test('Planet 갑판: db·tests·batch 가 행성 아래(본체 밑)·궤도계 밖·카메라 쪽(+z) 반원에, 셸 패널 쪽(+x 노드 높이)이 아님 · deck 없으면(2D) 예전 자리', () => {
  const R = 1.5, foot = R * Math.max(IX_PLANET.FOOT_K, IX_PLANET.EXT_K * 4), deckY = -R * IX_PLANET.DROP_K;
  const tq = quadsOf(ixGeometry(one('tests', { op: 'run', pass: 50, fail: 2, total: 52 }), 0.5, deckEnv()));
  assert.ok(tq.length >= 52 && tq.every((q) => q.y < deckY + 1 && q.y < -R && Math.hypot(q.x, q.z) > foot), '점수판은 갑판(본체 밑)·궤도계 밖');
  assert.ok(tq.every((q) => q.x < 0 && q.z > 0), '왼쪽 앞(−x, +z)');
  const bq = quadsOf(ixGeometry(one('batch', { op: 'loop', n: 40, i: 10 }), 2, deckEnv()));
  assert.ok(bq.length === 40 && bq.every((q) => q.y < -R && q.z > 0), '진행 띠는 앞쪽 호');
  const dg = ixGeometry(one('db', { op: 'query', rw: 'r', rows: 4821 }, 0.5), 1.5, deckEnv());
  let low = 0; for (let i = 0; i < dg.nl; i++) if (dg.L[i * 6 + 1] < 0 && dg.L[i * 6 + 4] < 0 && dg.L[i * 6] > 0 && dg.L[i * 6 + 2] > 0) low++;
  assert.ok(low / dg.nl > 0.85, '실린더는 오른쪽 앞 갑판 — 노드로 가는 방울 줄만 위로');
  // 흐름 값은 그대로(갑판 표는 Planet 만): 같은 tests 를 floorY 로 그리면 흐름 방위(왼쪽 뒤)
  const fq = quadsOf(ixGeometry(one('tests', { op: 'run', pass: 5, total: 5 }), 0.5, floorEnv()));
  assert.ok(fq.every((q) => q.x < 0 && q.z < 0.5), '흐름은 왼쪽 뒤 그대로');
  // 2D Planet(deck 없음)은 예전 자리: 본체 둘레 점 구름(노드 높이 ±반지름)
  const old = quadsOf(ixGeometry(one('tests', { op: 'run', pass: 5, total: 5 }), 0.5, deckEnv({ deck: false })));
  assert.ok(old.length && old.every((q) => Math.abs(q.y) <= R));
});

test('Planet 화면 하한 경계: 기본 크기 K, vip 는 K × clamp(48 / (폭 × K × ppu), 1, 3) — 흐름 배율은 그대로', () => {
  const span = (q) => Math.max(...q.map((p) => p.x)) - Math.min(...q.map((p) => p.x));
  const m = one('tests', { op: 'run', pass: 60, fail: 4, total: 64 });
  const flow1 = quadsOf(ixGeometry(m, 0.5, floorEnv()));
  const base = quadsOf(ixGeometry(m, 0.5, deckEnv(), new IxGeo()));
  assert.ok(Math.abs(base[0].s / flow1[0].s - IX_PLANET.K) < 1e-6, '기본 = 흐름 × K');
  const W = 8 * (IX_FLOOR.TEST.CS + IX_FLOOR.TEST.GAP) * IX_PLANET.K; // 8열 판 폭 × K
  const at = (ppu) => quadsOf(ixGeometry(m, 0.5, deckEnv({ vip: () => true, ppu: () => ppu }), new IxGeo()));
  assert.ok(Math.abs(at(IX_MIN_PX / W)[0].s / base[0].s - 1) < 1e-6, '경계(폭 × ppu = 48px) = 1');
  assert.ok(Math.abs(at(IX_MIN_PX / W / 2)[0].s / base[0].s - 2) < 1e-6, '절반 크기면 2배');
  const big = at(0.2);
  assert.ok(Math.abs(big[0].s / base[0].s - IX_SCALE_MAX) < 1e-6 && Math.abs(span(big) / span(base) - IX_SCALE_MAX) < 0.01, '상한 3배 · 간격도 같이');
  assert.ok(Math.abs(quadsOf(ixGeometry(m, 0.5, floorEnv({ vip: () => true, ppu: () => 0.2 }), new IxGeo()))[0].s / flow1[0].s - IX_SCALE_MAX) < 1e-6, '흐름 상한 그대로');
});

test('Planet 움직임 줄이기: 통신 위성이 멈춤 · PlanetView 가 view.reduced 를 정함(예전 Planet 은 늘 false)', () => {
  const p = new IxModel();
  p.event({ type: 'tool-start', nodeId: 'n', toolUseId: 'g', ix: { v: 1, cat: 'github', op: 'api', phase: 'start' } }, 0, 1, () => 'n');
  const sat = (now, reduced) => { const g = ixGeometry(p, now, deckEnv({ reduced }), new IxGeo()); return quadsOf(g)[0]; };
  assert.deepEqual(sat(1, true), sat(3, true), '멈춘 위성');
  assert.notDeepEqual(sat(1, false), sat(3, false), '평소엔 돎');
  const src = readFileSync(new URL('../planet-view.js', import.meta.url), 'utf8'); // three 를 node 에서 못 불러 글자 대조
  assert.match(src, /this\.reduced = !!\(typeof matchMedia === 'function' && matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\);\n\s+this\.deco = new PlanetDeco/);
});

// ───────────── 결함 수리 — 진행 띠가 라벨을 덮음 · 화면을 연 직후 띠 없음 · 끝난 외부 작업 라벨 ─────────────
test('§110 스냅샷 씨앗: 외부 작업이 진행을 들고 오면 바로 i/N(진행 줄) 또는 pct(예상 비율) 띠 · 끝났거나 다른 작업이면 없음', () => {
  const N = (job) => ({ id: 'j:s:x:x:a', meta: { job: { v: 1, id: 'x:a', state: 'running', src: 'ext', beatAt: '2026-10-27T07:00:00Z', ...job } } });
  const a = ixSeedEvent(N({ progress: { n: 916, total: 1800 } }));
  assert.equal(a.type, 'output'); assert.equal(a.nodeId, 'j:s:x:x:a');
  assert.deepEqual(a.ix, { v: 1, cat: 'batch', op: 'progress', bg: 1, i: 916, n: 1800, phase: 'progress' });
  assert.deepEqual(ixSeedEvent(N({ progress: { ratio: 0.956 }, ext: { expectSec: 600 } })).ix.pct, 95);
  assert.equal(ixSeedEvent(N({ progress: { ratio: 0.5 } })), null); // 예상 소요 없는 ratio 는 서버도 띠를 안 냄
  assert.equal(ixSeedEvent(N({ progress: null })), null);
  assert.equal(ixSeedEvent(N({ state: 'done', progress: { n: 1, total: 2 } })), null);
  assert.equal(ixSeedEvent({ id: 'j:b:x', meta: { job: { state: 'running', src: 'protocol', progress: { n: 1, total: 2 } } } }), null);
  assert.equal(ixSeedEvent(null), null);
  // 씨앗 하나로 모델에 효과가 서고, 뒤에 오는 같은 노드 진행 이벤트는 같은 효과를 고친다(겹치지 않음)
  const m = new IxModel();
  m.event(a, 0);
  m.event({ type: 'output', nodeId: a.nodeId, ix: { ...a.ix, i: 920 } }, 1);
  assert.equal(m.fx.size, 1);
  assert.equal([...m.fx.values()][0].ix.i, 920);
  // 배선: 3D·2D 모두 노드가 들어올 때 씨앗을 ix 에 넣는다
  for (const f of ['../scene.js', '../flat/flat-view.js']) assert.match(readFileSync(new URL(f, import.meta.url), 'utf8'), /const se = ixSeedEvent\(node\); if \(se\) this\.ix\.event\(se\);/, f);
});

test('§110 라벨 아래 스테이션 칸은 옅게: 스테이션 범위(바닥·갑판)의 점·선만, 상자 안만, 배율 K · 배선', () => {
  const g = new IxGeo();
  g.line(0, 0, 0, 2, 0, 0, 'batch', 1);   // 0: 스테이션 안(가운데 1,0 → 상자 안)
  g.line(10, 0, 0, 12, 0, 0, 'batch', 1); // 1: 스테이션, 상자 밖
  g.quad(1, 0, 0, 0.5, 'batch', 1);       // 0: 스테이션 안
  g.quad(30, 0, 0, 0.5, 'batch', 1);      // 1: 스테이션 밖
  g.st.push(0, 2, 0, 2);
  g.line(1, 0, 0, 1, 0, 0, 'github', 1);  // 2: 스테이션 범위 밖(포털 등) — 상자 안이어도 그대로
  const toS = (x, y, z, o) => { o.x = x * 10; o.y = y * 10; return z < 5; };
  const n = ixDimUnderLabels(g, toS, [[0, -5, 20, 5]]);
  assert.equal(n, 2);
  assert.ok(Math.abs(g.LA[0] - IX_UNDER_LABEL.K) < 1e-6 && g.LA[1] === 1 && g.LA[2] === 1);
  assert.ok(Math.abs(g.QA[0] - IX_UNDER_LABEL.K) < 1e-6 && g.QA[1] === 1);
  assert.ok(IX_UNDER_LABEL.K > 0 && IX_UNDER_LABEL.K < 0.3);
  assert.equal(ixDimUnderLabels(g, toS, []), 0);
  // ixGeometry 가 바닥·갑판 스테이션 범위를 적는다(Planet 갑판 batch)
  const m = new IxModel();
  m.event({ type: 'output', nodeId: 'j', ix: { v: 1, cat: 'batch', op: 'progress', bg: 1, i: 30, n: 60, phase: 'progress' } }, 0);
  const geo = ixGeometry(m, 5, { pos: () => ({ x: 0, y: 0, z: 0 }), rad: () => 0.3, root: () => 'j', deck: true, theme: 'planet', ext: () => 2 });
  assert.equal(geo.st.length, 4);
  assert.ok(geo.st[3] > geo.st[2]);
  assert.match(readFileSync(new URL('../ix-fx.js', import.meta.url), 'utf8'), /this\._dimUnderLabels\(g\);/);
});

test('§69.10.1 바닥 스테이션이 라벨을 덮지 않게: 점은 화면 반지름 · 선은 선분 · 스테이션 글자도 옅게 · 흐름 tests 판 글자 범위 · 2D 배선', () => {
  // 선분–상자: 두 끝이 밖이어도 가로지르면 걸림, 비껴가면 아님
  assert.equal(segHitsBox(-10, 0, 30, 0, 0, -5, 20, 5), true);
  assert.equal(segHitsBox(-10, 10, 30, 10, 0, -5, 20, 5), false);
  assert.equal(segHitsBox(5, 0, 5, 0, 0, -5, 20, 5), true); // 길이 0(점) 안
  assert.equal(segHitsBox(-10, -20, 30, 20, 0, -5, 20, 5), true); // 대각선
  assert.equal(ixRectHits(30, 0, 9, 9, [[0, -5, 20, 5]], 0), false);
  assert.equal(ixRectHits(30, 0, 11, 9, [[0, -5, 20, 5]], 0), true);
  const g = new IxGeo();
  g.quad(3, 0, 0, 2, 'tests', 1);   // 0: 가운데 x=30 은 상자(0～20) 밖이지만 화면 반지름 1·k10 = 10px 이라 걸침 → 옅게
  g.quad(4, 0, 0, 0.4, 'tests', 1); // 1: 가운데 40, 반지름 2px → 그대로
  g.line(-1, 0, 0, 3, 0, 0, 'tests', 1); // 0: 두 끝(−10, 30)이 밖이어도 상자를 지나감 → 옅게
  g.line(-1, 2, 0, 3, 2, 0, 'tests', 1); // 1: y=20 — 지나가지 않음
  g.st.push(0, 2, 0, 2);
  g.label(3, 0, 0, '✓61 ✗2', 'err', 1, 'ix-badge'); // 0: 스테이션 글자, 가운데 30 · 폭 40 → 걸침
  g.label(9, 0, 0, '✓1', 'ok', 1, 'ix-badge');      // 1: 가운데 90 → 그대로
  g.stl.push(0, 2);
  const toS = (x, y, z, o) => { o.x = x * 10; o.y = y * 10; o.k = 10; return true; };
  const n = ixDimUnderLabels(g, toS, [[0, -5, 20, 5]], undefined, 0, (i, d) => [d.text.length > 3 ? 40 : 10, 16]);
  assert.equal(n, 3);
  assert.ok(Math.abs(g.QA[0] - IX_UNDER_LABEL.K) < 1e-6 && g.QA[1] === 1);
  assert.ok(Math.abs(g.LA[0] - IX_UNDER_LABEL.K) < 1e-6 && g.LA[1] === 1);
  assert.ok(Math.abs(g.labels[0].alpha - IX_UNDER_LABEL.LAB) < 1e-6 && g.labels[1].alpha === 1);
  // k 가 없으면(예전 호출) 가운데만 — 0 번 점은 그대로
  const h = new IxGeo(); h.quad(3, 0, 0, 2, 'tests', 1); h.st.push(0, 0, 0, 1);
  assert.equal(ixDimUnderLabels(h, (x, y, z, o) => { o.x = x * 10; o.y = y * 10; return true; }, [[0, -5, 20, 5]], undefined, 0), 0);
  // 글자 크기 추정(첫 프레임): 배지가 눈금보다 크고 글자 수에 비례
  const [bw, bh] = ixLabelSizeGuess('✓61 ✗2', 'ix-label ix-badge'), [tw, th] = ixLabelSizeGuess('✓61 ✗2', 'ix-tick');
  assert.ok(bw > tw && bh > th && ixLabelSizeGuess('✓161 ✗12')[0] > tw);
  // 흐름 3D 바닥 tests 판: 점수 배지가 스테이션 글자 범위(geo.stl)에 들어간다 · 스테이션 아닌 효과 글자는 아님
  const m = new IxModel();
  m.event({ type: 'tool-start', nodeId: 'a', toolUseId: 't1', ix: { v: 1, cat: 'tests', op: 'run', phase: 'start' } }, 0);
  m.event({ type: 'tool-end', nodeId: 'a', toolUseId: 't1', ix: { v: 1, cat: 'tests', op: 'run', total: 10, pass: 9, fail: 1, ok: false, phase: 'end' } }, 1);
  const geo = ixGeometry(m, 1.5, { pos: () => ({ x: 0, y: 1, z: 0 }), rad: () => 0.8, root: () => 'a', floorY: -2.2, theme: 'flow' });
  assert.equal(geo.stl.length, 2);
  assert.ok(geo.labels.slice(geo.stl[0], geo.stl[1]).some((d) => d.cls === 'ix-badge'));
  // 배선: 3D 는 점 반지름용 k 와 잰 글자 크기를, 2D 는 효과 글자를 라벨 상자와 대조
  const fx = readFileSync(new URL('../ix-fx.js', import.meta.url), 'utf8');
  assert.match(fx, /o\.k = d > 1e-3 \? H \/ \(d \* tf\) : 0/);
  assert.match(fx, /ixLabelSizeGuess\(d\.text, d\.cls\)/);
  assert.match(readFileSync(new URL('../flat/ix2d.js', import.meta.url), 'utf8'), /ixRectHits\(a\.x, a\.y - 9, w \/ 2, 8, labs\)\) d\.alpha \*= IX_UNDER_LABEL\.LAB/);
});

test('§110 가까운 작업 노드는 끝났어도 라벨 후보(끝난 외부 작업 라벨이 근접 화면에서 사라지던 것) · 경계 · 배선', () => {
  const J = { id: 'j', meta: { job: { state: 'done' } } };
  assert.equal(jobLabelNear(J, JOBW.LABEL_PX), true);
  assert.equal(jobLabelNear(J, JOBW.LABEL_PX - 0.01), false);
  assert.equal(jobLabelNear({ id: 'b', meta: {} }, 100), false);
  assert.match(readFileSync(new URL('../scene.js', import.meta.url), 'utf8'), /isJob\(v\.node\) && jobLabelNear\(v\.node,/);
  assert.match(readFileSync(new URL('../flat/flat-view.js', import.meta.url), 'utf8'), /jobLabelNear\(v\.node, v\._R \|\| 0\)/);
});
