// 특별 상호작용 연출 순수 부분
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ixSummary, ixHtml, ixMark, IxModel, IXFX, ixGeometry, IxGeo, IXGEO, testScore, ixColor, IX_CATS } from '../ix-core.mjs';
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
