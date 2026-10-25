// 같은 프로젝트 여러 live 세션: 같은 파일 충돌·세션 간 메시지(허브)·세션 색·live 메인 순서 (합성 데이터만)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Graph } from '../graph.mjs';
import { OverviewHub } from '../overview.mjs';
import { worktreeOf } from '../session.mjs';
import { fileKey, fileRef, msgTo, ConflictTracker, ConflictBook, conflictEvent, CONFLICT_WINDOW_MS } from '../../web/conflict-core.mjs';
import { sessionColorMap, liveMainSids, assignToAnchors, podAngles, SESS_N, SESS_PALETTE } from '../../web/multi-core.mjs';

test('fileKey: 상대 경로·구분자·..·드라이브 대소문자 정규화', () => {
  assert.equal(fileKey('src\\app.js', 'D:\\Repo'), 'd:/repo/src/app.js');
  assert.equal(fileKey('D:/Repo/web/../src/./App.js'), 'd:/repo/src/app.js');
  assert.equal(fileKey('/home/u/x//y.js'), '/home/u/x/y.js');
  assert.equal(fileKey(''), null);
  assert.deepEqual(fileRef('Edit', { file_path: 'D:\\r\\a.js' }), { k: 'd:/r/a.js', n: 'a.js', w: 1 });
  assert.deepEqual(fileRef('Read', { file_path: 'b.md' }, 'D:\\r'), { k: 'd:/r/b.md', n: 'b.md', w: 0 });
  assert.equal(fileRef('Bash', { command: 'cat a' }), null);
  assert.equal(msgTo('SendMessage', { to: 'a0790d05a2ae8b117', message: 'x' }), 'a0790d05a2ae8b117');
  assert.equal(msgTo('Read', { to: 'x' }), null);
  assert.equal(worktreeOf('D:\\r\\.claude\\worktrees\\fix-ui\\web'), 'fix-ui');
  assert.equal(worktreeOf('D:\\r\\web'), null);
});

test('ConflictTracker: 쓰기-쓰기 강, 읽기-쓰기 약, 읽기-읽기 없음, 10분 창 뒤 off', () => {
  const t = new ConflictTracker();
  const W = (k) => ({ k, n: k.split('/').pop(), w: 1 }), R = (k) => ({ k, n: k.split('/').pop(), w: 0 });
  const t0 = Date.parse('2026-10-24T00:00:00Z');
  assert.equal(t.touch('A', R('d:/r/x.js'), t0).on.length, 0);
  assert.equal(t.touch('B', R('d:/r/x.js'), t0 + 1000).on.length, 0); // 읽기-읽기
  let r = t.touch('B', W('d:/r/x.js'), t0 + 2000, 'a:b1');
  assert.equal(r.on.length, 1);
  assert.equal(r.on[0].level, 'weak');
  assert.equal(r.on[0].nodeB, 'a:b1');
  r = t.touch('A', W('d:/r/x.js'), t0 + 3000, 'a:a1');
  assert.equal(r.on.length, 1);
  assert.equal(r.on[0].level, 'strong'); // 같은 충돌의 강약이 바뀜
  assert.equal(t.list().length, 1);
  // 같은 그룹 안에서만 건드린 파일은 충돌 아님
  assert.equal(t.touch('A', W('d:/r/only-a.js'), t0 + 3000).on.length, 0);
  // 10분 창 뒤: off
  r = t.evaluate(t0 + 3000 + CONFLICT_WINDOW_MS + 1);
  assert.equal(r.off.length, 1);
  assert.equal(t.list().length, 0);
  // dropGroup
  t.touch('A', W('d:/r/y.js'), t0 + 1e9); t.touch('C', W('d:/r/y.js'), t0 + 1e9 + 5);
  assert.equal(t.list().length, 1);
  assert.equal(t.dropGroup('C').off.length, 1);
});

test('ConflictBook: off 뒤 30초 페이드, 스냅샷으로 다시 채움', () => {
  const b = new ConflictBook();
  const c = { id: 'A|B|k', a: 'A', b: 'B', k: 'd:/r/x.js', n: 'x.js', level: 'strong', nodeA: null, nodeB: null, wA: 1, wB: 1 };
  b.apply(conflictEvent(c, 'on', 't', (g) => 's:' + g), 1000);
  assert.equal(b.items(1000)[0].a, 's:A');
  b.apply(conflictEvent(c, 'off', 't'), 2000);
  const it = b.items(17000)[0];
  assert.ok(it.fading && it.k > 0.4 && it.k < 0.6);
  assert.equal(b.items(33000).length, 0);
  b.reset([conflictEvent(c, 'on', 't')], 0);
  assert.equal(b.size, 1);
});

test('세션 색: live 메인마다 다른 칸, 같은 입력 같은 결과, 팔레트 다크·라이트', () => {
  const proj = (sids) => ({ projectId: 'p', liveList: sids.map((s, i) => ({ sessionId: s, entrypoint: 'cli', liveStatus: i === 1 ? 'busy' : 'idle', activityAt: new Date(1e12 + i * 1000).toISOString() })) });
  const sids = ['s1', 's2', 's3', 's4', 's5'];
  const m = sessionColorMap([proj(sids), { projectId: 'q', liveList: [{ sessionId: 'x9', entrypoint: 'sdk-cli' }] }]);
  assert.equal(m.size, 5); // sdk-cli 제외
  assert.equal(new Set(m.values()).size, 5);
  assert.deepEqual([...sessionColorMap([proj(sids)])], [...m]);
  assert.equal(SESS_PALETTE.dark.length, SESS_N); assert.equal(SESS_PALETTE.light.length, SESS_N);
  // 순서: busy 먼저 → 최근 활동
  assert.deepEqual(liveMainSids(proj(['a', 'b', 'c'])), ['b', 'c', 'a']);
  assert.equal(sessionColorMap([proj(['only'])]).size, 0, 'live 메인 하나뿐인 프로젝트는 색 없음');
  assert.equal(sessionColorMap([proj(['only'])], { min: 1 }).size, 1);
});

test('지난 메인·독립 기동기 → live 메인 배정, 배치 모양', () => {
  const anchors = [{ nodeId: 's:L1', startMs: 1000 }, { nodeId: 's:L2', startMs: 5000 }];
  const m = assignToAnchors([
    { nodeId: 's:P1', endMs: 4800 },               // L2 앞(/clear 앞 세션)
    { nodeId: 's:P0', endMs: 900 },                // L1 앞
    { nodeId: 'b:run', spawner: 's:L1' },          // 기동기 → 띄운 메인
    { nodeId: 'b:old', spawner: 's:P1' },          // 지난 메인이 띄움 → 그 메인이 붙은 곳
    { nodeId: 's:P9', endMs: 9000 },               // 뒤에 시작한 live 가 없음 → 가까운 쪽
  ], anchors);
  assert.equal(m.get('s:P1'), 's:L2');
  assert.equal(m.get('s:P0'), 's:L1');
  assert.equal(m.get('b:run'), 's:L1');
  assert.equal(m.get('b:old'), 's:L2');
  assert.equal(m.get('s:P9'), 's:L2');
  assert.equal(podAngles(1).mode, 'center');
  assert.equal(podAngles(2).mode, 'facing');
  assert.equal(podAngles(3).dirs.length, 3);
  assert.equal(podAngles(5).mode, 'pie');
});

/** 허브용 가짜 공급자: 루트마다 Graph 하나 */
function fakeSource(spec) {
  const rts = new Map();
  for (const r of spec) {
    const g = new Graph({ rootSessionId: r.sid, localSeq: true });
    g.addNode({ id: `s:${r.sid}`, parentId: null, kind: 'main', label: 'm', sessionId: r.sid, meta: {} });
    g.addNode({ id: `a:${r.sid}-sub`, parentId: `s:${r.sid}`, kind: 'subagent', label: 'sub', sessionId: r.sid, meta: {} });
    g.finishLoad();
    rts.set(r.sid, { graph: g });
  }
  return {
    rts,
    async desired() { return { roots: spec.map((r) => ({ sessionId: r.sid, projectId: 'p', live: r.live !== false, liveStatus: 'busy', tier: r.live !== false ? 'live' : 'recent', orphanSdk: false })) }; },
    async acquire(sid) { return rts.get(sid); },
    release() {},
    async projects() { return []; },
  };
}

test('허브: 다른 live 메인끼리 같은 파일 → conflict 이벤트·스냅샷, SendMessage → session-msg', async () => {
  const src = fakeSource([{ sid: 'A' }, { sid: 'B' }, { sid: 'C', live: false }]);
  const hub = new OverviewHub({ source: src, intervalMs: 60_000, projectsMinMs: 0 });
  const got = [];
  hub.subscribe({ inactive: true, onEvent: (e) => got.push(e), onProjects() {} });
  await hub.wake();
  const ts = new Date().toISOString();
  const emit = (sid, nodeId, tool, extra) => src.rts.get(sid).graph.emit({ ts, type: 'tool-start', nodeId, toolUseId: 't' + Math.random(), tool, cat: 'edit', text: '', ...extra });
  emit('A', 's:A', 'Edit', { file: { k: 'd:/r/x.js', n: 'x.js', w: 1 } });
  emit('B', 'a:B-sub', 'Read', { file: { k: 'd:/r/x.js', n: 'x.js', w: 0 } });
  emit('C', 's:C', 'Edit', { file: { k: 'd:/r/x.js', n: 'x.js', w: 1 } }); // live 아님 → 충돌 그룹 아님
  const cf = got.filter((e) => e.type === 'conflict');
  assert.equal(cf.length, 1);
  assert.equal(cf[0].state, 'on');
  assert.equal(cf[0].level, 'weak');
  assert.deepEqual([cf[0].nodeId, cf[0].peer].sort(), ['s:A', 's:B']);
  assert.equal(cf[0].file, 'x.js');
  assert.ok(Number.isFinite(cf[0].seq));
  emit('B', 'a:B-sub', 'Edit', { file: { k: 'd:/r/x.js', n: 'x.js', w: 1 } });
  assert.equal(got.filter((e) => e.type === 'conflict').pop().level, 'strong');
  assert.equal(hub.snapshot({ inactive: true }).conflicts.length, 1);
  emit('A', 's:A', 'SendMessage', { cat: 'agent', to: 'B-sub' });
  const sm = got.find((e) => e.type === 'session-msg');
  assert.ok(sm && sm.nodeId === 's:A' && sm.peer === 's:B' && sm.toNode === 'a:B-sub');
  emit('A', 's:A', 'SendMessage', { cat: 'agent', to: 'A-sub' }); // 같은 세션 안 → 없음
  assert.equal(got.filter((e) => e.type === 'session-msg').length, 1);
  hub.stop();
});

test('허브(§66.12): 셸 추정 쓰기 files[] 모두 접촉, 확정 쓰기와 만나면 weak + est', async () => {
  const src = fakeSource([{ sid: 'A' }, { sid: 'B' }]);
  const hub = new OverviewHub({ source: src, intervalMs: 60_000, projectsMinMs: 0 });
  const got = [];
  hub.subscribe({ inactive: true, onEvent: (e) => got.push(e), onProjects() {} });
  await hub.wake();
  const ts = new Date().toISOString();
  const emit = (sid, nodeId, tool, extra) => src.rts.get(sid).graph.emit({ ts, type: 'tool-start', nodeId, toolUseId: 't' + Math.random(), tool, cat: 'shell', text: '', ...extra });
  const x = { k: 'd:/r/x.js', n: 'x.js', w: 1, est: 1 }, y = { k: 'd:/r/y.js', n: 'y.js', w: 1, est: 1 };
  emit('A', 's:A', 'Bash', { file: x, files: [x, y] });
  emit('B', 'a:B-sub', 'Read', { cat: 'read', file: { k: 'd:/r/x.js', n: 'x.js', w: 0 } }); // 읽기-추정쓰기 = 없음
  assert.equal(got.filter((e) => e.type === 'conflict').length, 0);
  emit('B', 'a:B-sub', 'Edit', { cat: 'edit', file: { k: 'd:/r/y.js', n: 'y.js', w: 1 } }); // files 둘째와 만남
  const cf = got.filter((e) => e.type === 'conflict');
  assert.equal(cf.length, 1);
  assert.equal(cf[0].file, 'y.js');
  assert.equal(cf[0].level, 'weak');
  assert.equal(cf[0].est, true);
  assert.equal(hub.snapshot({ inactive: true }).conflicts[0].est, true);
  hub.stop();
});
