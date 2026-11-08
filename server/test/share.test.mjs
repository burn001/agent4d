// 범위 제한 공유 링크: 데이터 잠금·범위 거르기·토큰 판정 (합성 데이터만)
import test from 'node:test';
import assert from 'node:assert/strict';
import { shareClean, safeId, ShareStore, checkShare, shareKeepHubEvent, shareFilterHubSnap, shareFilterProjects, shareBlockedPath,
  sha256hex, newShareToken, encodeCwd, markShareHtml, shareReplayOf } from '../share.mjs';
import { parseKstTime, replayText, mdOf } from '../../bin/share.mjs';
import { parseShareReplay } from '../../web/replay/share-replay.mjs';
import { warmShareReplays } from '../index.mjs';

const P = 'D--X-proj-a';
const mkShare = (mins = 60, extra = {}) => { const token = newShareToken(); return { id: 'ab12cd34', alias: 't', token, hash: sha256hex(token), project: P, name: '프로젝트', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + mins * 60000).toISOString(), ...extra }; };
const ctx = (sh) => ({ share: sh, lang: 'ko' });

test('shareClean: 경로·명령·말·제목·패널·작업 대상은 남지 않고 구조는 남는다', () => {
  const sh = mkShare();
  const snap = {
    scope: 'all', root: null, seq: 5,
    nodes: [{ id: 's:11111111-2222-3333-4444-555555555555', parentId: null, kind: 'main', label: '메인 · secret_proj', status: 'busy', depth: 0, projectId: P,
      startedAt: '2026-11-08T01:02:03.456Z', meta: { cwd: 'D:\\secret\\proj', command: 'python run.py --adr 0042', title: 'ADR-0042 작업', ctx: { pct: 30, basis: 'observed' },
        plans: [{ title: '비밀 계획', items: [{ id: 'chunk-layer', t: '조각 층' }] }], agentType: 'acme-sweeper', git: 'main', job: { id: 'adr-0042-run', title: '회차', state: 'done' },
        launcher: { script: 'loop.sh', via: ['relaunch.sh'] } },
      openTools: [{ toolUseId: 'toolu_01ABCDEFGHijk', tool: 'mcp__srv__x', cat: 'mcp', text: 'Read D:/secret/a.py', panel: { lines: ['x'] } }] }],
    recent: [{ seq: 1, type: 'tool-start', nodeId: 's:11111111-2222-3333-4444-555555555555', tool: 'Bash', cat: 'shell', text: 'rm -rf /d/secret', brief: '$ ls', detail: 'a.py',
      panel: { title: '$ cmd', lines: ['secret'] }, art: [{ p: 'src/a.py' }], file: { k: 'd:/x/a.py' }, projectId: P, ix: { cat: 'user', op: 'prompt', text: '박사님 지시', who: '2026-28' } }],
    projects: [{ projectId: P, name: 'secret_proj', path: 'D:\\secret\\proj', liveList: [{ sessionId: '11111111-2222-3333-4444-555555555555', title: '첫 프롬프트' }], sessions: 3 }],
    roots: [{ sessionId: '11111111-2222-3333-4444-555555555555', projectId: P, nodeId: 's:11111111-2222-3333-4444-555555555555' }],
  };
  const out = shareClean(snap, ctx(sh));
  const s = JSON.stringify(out);
  for (const bad of ['secret', 'D:', '.py', 'ADR', '0042', 'acme', '조각', '박사님', '첫 프롬프트', '2026-28', 'chunk-layer', 'loop.sh', 'srv']) assert.ok(!s.includes(bad), bad + ' 가 남음: ' + s);
  const n = out.nodes[0];
  assert.equal(n.label, '메인 에이전트');
  assert.equal(n.kind, 'main');
  assert.equal(n.id, 's:11111111-2222-3333-4444-555555555555');
  assert.equal(n.projectId, 'share-ab12cd34');
  assert.equal(n.meta.ctx.pct, 30);
  assert.equal(n.openTools[0].tool, 'mcp');
  assert.equal(n.openTools[0].text, '');
  assert.equal(out.recent[0].cat, 'shell');
  assert.equal(out.recent[0].tool, 'Bash');
  assert.equal(out.recent[0].ix.op, 'prompt');
  assert.equal(out.projects[0].name, '프로젝트');
  assert.equal(out.projects[0].liveList[0].title, '');
  assert.equal(out.recent[0].ts, undefined);
});

test('safeId: 무작위 id 는 그대로, 이름이 든 id 는 접두를 두고 해시(같은 값은 같은 해시)', () => {
  assert.equal(safeId('a:a7b682b44dc720f9a'), 'a:a7b682b44dc720f9a');
  assert.equal(safeId('b:toolu_01NprWGUYMkdkasMwqKCqTGd-r1'), 'b:toolu_01NprWGUYMkdkasMwqKCqTGd-r1');
  assert.equal(safeId('m:b81spgsmd'), 'm:b81spgsmd');
  const h = safeId('j:adr-0042-migration');
  assert.match(h, /^j:x[0-9a-f]{12}$/);
  assert.equal(h, safeId('j:adr-0042-migration'));
});

test('허브 거르기: 다른 프로젝트 노드·이벤트·프로젝트·루트는 빠진다', () => {
  const sh = mkShare();
  const snap = { nodes: [{ id: 's:a', projectId: P }, { id: 's:b', projectId: 'D--other' }], recent: [{ nodeId: 's:a', projectId: P }, { nodeId: 's:b', projectId: 'D--other' }],
    projects: [{ projectId: P }, { projectId: 'D--other' }], roots: [{ projectId: P }, { projectId: 'D--other' }], conflicts: [{ nodeId: 's:a', peer: 's:b' }] };
  const f = shareFilterHubSnap(snap, sh);
  assert.deepEqual(f.nodes.map((n) => n.id), ['s:a']);
  assert.equal(f.recent.length, 1); assert.equal(f.projects.length, 1); assert.equal(f.roots.length, 1); assert.equal(f.conflicts.length, 0);
  assert.equal(shareKeepHubEvent({ projectId: 'D--other' }, sh), false);
  assert.equal(shareKeepHubEvent({ projectId: null }, sh), false);
  assert.equal(shareKeepHubEvent({ projectId: P }, sh), true);
  assert.equal(shareFilterProjects({ projects: [{ projectId: 'D--other' }] }, sh).projects.length, 0);
});

test('토큰 판정: 유효·만료·폐기·보기 토큰 꼴은 공유로 보지 않음', () => {
  const ok = mkShare(60), old = mkShare(-1), rev = mkShare(60, { revokedAt: new Date().toISOString() });
  const store = new ShareStore({ list: [ok, old, rev] });
  const req = (h = {}) => ({ method: 'GET', headers: { host: '127.0.0.1:7788', ...h } });
  const u = (q = '') => new URL('http://127.0.0.1/state' + q);
  assert.equal(checkShare(req({ 'x-ccviz-token': ok.token }), u(), store).ok, true);
  assert.equal(checkShare(req({ 'x-ccviz-token': old.token }), u(), store).expired, true);
  assert.equal(checkShare(req({ 'x-ccviz-token': rev.token }), u(), store).expired, true);
  assert.equal(checkShare(req({ 'x-ccviz-token': 'not-a-share' }), u(), store), null);
  const q = checkShare(req(), new URL('http://127.0.0.1/?t=' + ok.token), store);
  assert.equal(q.redirect, '/');
  assert.match(q.setCookie, /Max-Age=\d+/);
  assert.equal(store.stillValid(ok), true);
  assert.equal(store.stillValid(rev), false);
});

test('막힌 경로·encodeCwd·html 표지', () => {
  for (const p of ['/interact/status', '/md/full', '/control/events', '/artifacts']) assert.equal(shareBlockedPath(p, new URL('http://x' + p)), true, p);
  assert.equal(shareBlockedPath('/timeline', new URL('http://x/timeline?session=arc:abc')), true);
  assert.equal(shareBlockedPath('/state', new URL('http://x/state?scope=all')), false);
  assert.equal(encodeCwd('D:\\WORK_REPOS\\project_acme'), 'D--WORK-REPOS-project-acme');
  assert.match(markShareHtml('<html lang="ko"><body></body></html>', mkShare()), /<html lang="ko" data-share="1" data-share-exp="\d+">/);
});

test('§151 기본 리플레이: 정리·html 표지·CLI 시각·목록 한 칸', () => {
  const SID = 'a3443dd5-9fbf-49dd-a07d-f4c2d629e9ce';
  const from = '2026-11-04T22:49:10.000Z', until = '2026-11-04T22:58:10.000Z';
  const sh = mkShare(60, { replay: { session: SID, from, until, speed: 4, loop: true } });
  const r = shareReplayOf(sh);
  assert.deepEqual(r, { session: SID, from: Date.parse(from), until: Date.parse(until), speed: 4, loop: true });
  // 형식이 어긋나면 없음(실시간 보기)
  assert.equal(shareReplayOf(mkShare()), null);
  assert.equal(shareReplayOf(mkShare(60, { replay: { session: '../x', from } })), null);
  assert.equal(shareReplayOf(mkShare(60, { replay: { session: SID, from: 'nope' } })), null);
  assert.equal(shareReplayOf(mkShare(60, { replay: { session: SID, from, until: from } })), null);
  assert.equal(shareReplayOf(mkShare(60, { replay: { session: SID, from, speed: 3 } })).speed, 1);
  // html 표지 → 웹 해석이 같은 값
  const html = markShareHtml('<html lang="ko"><body></body></html>', sh);
  const m = /data-share-replay="([^"]+)"/.exec(html);
  assert.ok(m, html);
  assert.ok(!/[<>'&]/.test(m[1]));
  assert.deepEqual(parseShareReplay(m[1]), r);
  assert.ok(!/data-share-replay/.test(markShareHtml('<html>', mkShare())));
  // 반복 없음·끝 없음
  const r2 = parseShareReplay(/data-share-replay="([^"]+)"/.exec(markShareHtml('<html>', mkShare(60, { replay: { session: SID, from, speed: 2 } })))[1]);
  assert.equal(r2.until, null); assert.equal(r2.loop, false); assert.equal(r2.speed, 2);
  // CLI 시각: 오프셋 없음 = KST, HH:mm = 시작 날짜 기준
  assert.equal(parseKstTime('2026-11-05 07:49:10'), Date.parse(from));
  assert.equal(parseKstTime('2026-11-05T07:49:10+09:00'), Date.parse(from));
  assert.equal(parseKstTime('07:58:10', Date.parse(from)), Date.parse(until));
  assert.ok(Number.isNaN(parseKstTime('07:58')));
  // 목록 한 칸: 세션 앞 8자 · KST 시각 · 배속 · 반복 (전체 id·토큰 없음)
  assert.equal(replayText(sh), 'a3443dd5 @ 2026-11-05 07:49～07:58 · 4× · 반복');
  assert.equal(replayText(mkShare()), '-');
  const md = mdOf([sh]);
  assert.match(md, /\| 기본 리플레이 \|/);
  assert.ok(md.includes('a3443dd5 @ 2026-11-05 07:49～07:58'));
  assert.ok(!md.includes(SID) && !md.includes(sh.token));
});

test('§151 기본 리플레이 미리 만들기: 유효한 공유만·캐시에 없을 때만', async () => {
  const SID = 'a3443dd5-9fbf-49dd-a07d-f4c2d629e9ce', SID2 = '11111111-2222-3333-4444-555555555555';
  const rep = (session) => ({ replay: { session, from: '2026-11-04T22:49:10.000Z', speed: 4 } });
  const store = new ShareStore({ list: [mkShare(60, rep(SID)), mkShare(-1, rep(SID2)), mkShare(60, { ...rep(SID2), revokedAt: new Date().toISOString() }), mkShare(60)] });
  assert.deepEqual(store.replaySessions(), [SID]);
  const calls = [];
  const cached = new Set();
  const mgr = { replays: { has: (s) => cached.has(s) }, replay: async (s, o) => { calls.push([s, o.wait]); return { building: true }; } };
  assert.equal(warmShareReplays(mgr, store.replaySessions()), 1);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [[SID, false]]);
  cached.add(SID);
  assert.equal(warmShareReplays(mgr, [SID, null, undefined]), 0);
  assert.equal(warmShareReplays(null, [SID]), 0);
});
