// 잘린 응답 전체 보기 — 원문 찾기(실황 mdRef · Interactive 바이트 위치) · 가림 · 상한 · HTTP 문지기(보기 토큰·minimal·프로젝트)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { liveFull, feedFull, findLine, fullText, FULL } from '../md-full.mjs';
import { Graph } from '../graph.mjs';
import { createServer, createRealManager } from '../index.mjs';
import { LIMITS } from '../parse.mjs';
import { feedItem, ITEM_MAX } from '../interact-feed.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'a4d-full-'));
const SID = 'abababab-1111-4111-8111-abababababab';
const U1 = '11111111-2222-4333-8444-555555555555', U2 = '66666666-2222-4333-8444-555555555555', U3 = '77777777-2222-4333-8444-555555555555';
const SECRET = 'sk-ant-api03-' + 'Z'.repeat(40);
const long = (n) => Array.from({ length: n }, (_, i) => `줄 ${i} | 값 ${i * 3} |`).join('\n');
const asst = (uuid, blocks, extra = {}) => ({ type: 'assistant', uuid, parentUuid: U3, sessionId: SID, timestamp: '2026-11-05T03:00:00.000Z', message: { role: 'assistant', content: blocks }, ...extra });

function fixture() {
  const root = tmp(), projects = path.join(root, 'projects'), sessions = path.join(root, 'sessions');
  const proj = path.join(projects, 'D--w-full');
  fs.mkdirSync(path.join(proj, SID, 'subagents'), { recursive: true }); fs.mkdirSync(sessions, { recursive: true });
  const main = [
    { type: 'user', uuid: U3, sessionId: SID, timestamp: '2026-11-05T02:59:00.000Z', message: { role: 'user', content: 'hi' }, origin: { kind: 'human' } },
    asst(U1, [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: `# 표\n${long(400)}\n<system-reminder>숨김</system-reminder>\n열쇠 ${SECRET}` }]),
    { type: 'api-request-blob', uuid: 'x', blob: 'y'.repeat(2 * FULL.CHUNK) }, // 조각 경계 넘김
    asst(U2, [{ type: 'text', text: '짧은 답\n둘째 줄' }]),
  ];
  const mf = path.join(proj, `${SID}.jsonl`);
  fs.writeFileSync(mf, main.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const SUBU = '88888888-2222-4333-8444-555555555555';
  fs.writeFileSync(path.join(proj, SID, 'subagents', 'agent-a1.jsonl'), JSON.stringify(asst(SUBU, [{ type: 'text', text: '서브 에이전트 긴 답\n' + long(50) }], { isSidechain: true, agentId: 'a1' })) + '\n');
  return { root, projects, sessions, proj, mf, SUBU, main };
}

test('§143.6 원문 찾기: mdRef(uuid·블록) → 메인·서브에이전트 파일, system-reminder 뗌·가림·상한, 나쁜 자리는 404/400', () => {
  const fx = fixture();
  try {
    const entry = { file: fx.mf, projectPath: fx.proj, sessionId: SID };
    const r = liveFull({ entry, uuid: U1, block: 1 });
    assert.ok(r.md.startsWith('# 표\n줄 0 |'), '원문 줄바꿈 유지');
    assert.ok(r.md.length > LIMITS.md, '실황 상한(3000)보다 긴 원문');
    assert.doesNotMatch(r.md, /숨김|system-reminder/); assert.doesNotMatch(r.md, /sk-ant-api03-Z{40}/, '비밀 가림');
    assert.equal(liveFull({ entry, uuid: U1, block: 0 }).error, 'not_found', 'thinking 블록은 내주지 않음');
    assert.equal(liveFull({ entry, uuid: U2, block: 0 }).md, '짧은 답\n둘째 줄');
    assert.match(liveFull({ entry, uuid: fx.SUBU, block: 0 }).md, /^서브 에이전트 긴 답/, '서브에이전트 파일까지');
    assert.equal(liveFull({ entry, uuid: U3, block: 0 }).error, 'not_found', 'assistant 줄만');
    assert.equal(liveFull({ entry, uuid: 'not-a-uuid', block: 0 }).status, 400);
    assert.equal(liveFull({ entry, uuid: U1, block: -1 }).status, 400);
    assert.equal(liveFull({ entry: null, uuid: U1, block: 1 }).status, 404);
    // 줄 머리가 앞 조각에 있는 긴 줄
    const big = path.join(fx.root, 'big.jsonl');
    fs.writeFileSync(big, JSON.stringify({ type: 'x', pad: 'p'.repeat(FULL.CHUNK + 100), uuid: U2 }) + '\n');
    assert.equal(JSON.parse(findLine(big, `"uuid":"${U2}"`)).uuid, U2);
    // 상한
    const c = fullText('가'.repeat(FULL.MAX + 10));
    assert.equal(c.md.length, FULL.MAX); assert.equal(c.cut, 1);
    // Interactive: 줄 바이트 위치
    const off = Buffer.byteLength(JSON.stringify(fx.main[0]) + '\n');
    assert.ok(feedFull(fx.mf, off).md.startsWith('# 표'));
    assert.equal(feedFull(fx.mf, 0).error, 'not_found', 'user 줄은 아님');
    assert.equal(feedFull(fx.mf, 5).error, 'not_found', '줄 가운데');
    assert.equal(feedFull(fx.mf, 'x').status, 400);
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test('§143.6 mdRef 는 잘린 md 에만 · minimal 이면 없음', () => {
  const g = new Graph({ rootSessionId: SID });
  const evs = []; g.on?.('event', (e) => evs.push(e));
  const a = g.emit({ ts: 't', type: 'text', nodeId: 'n', role: 'assistant', text: 'x', md: 'a\n' + '가 나 '.repeat(LIMITS.md), mdRef: { s: SID, u: U1, b: 1 } });
  const b = g.emit({ ts: 't', type: 'text', nodeId: 'n', role: 'assistant', text: 'x', md: 'a\nb', mdRef: { s: SID, u: U1, b: 1 } });
  const ev = (x) => x || g.ring[g.ring.length - 1];
  const all = g.ring.filter((e) => e.type === 'text');
  assert.deepEqual(all[0].mdRef, { s: SID, u: U1, b: 1 }); assert.equal(all[0].mdCut, 1);
  assert.equal(all[1].mdRef, undefined, '잘리지 않으면 없음');
  const gm = new Graph({ rootSessionId: SID, privacy: 'minimal' });
  gm.emit({ ts: 't', type: 'text', nodeId: 'n', role: 'assistant', text: 'x', md: 'a\n' + '가 나 '.repeat(LIMITS.md), mdRef: { s: SID, u: U1, b: 1 } });
  assert.equal(gm.ring.filter((e) => e.type === 'text')[0].mdRef, undefined);
  void a; void b; void ev;
});

test('§143.6 HTTP /md/full: 보기 토큰 필수 · 원문 · 프로젝트 밖 404 · minimal 403', async () => {
  const fx = fixture();
  const TOKEN = 'full-token-' + 'f'.repeat(32);
  const get = (port, q, headers = { 'x-ccviz-token': TOKEN }) => new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/md/full?${q}`, { headers }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, j }); }); }).on('error', reject);
  });
  const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  const servers = [];
  try {
    const mk = async (opts) => { const mgr = createRealManager({ projectsDir: fx.projects, sessionsDir: fx.sessions, ...opts }); await mgr.index.refresh(); const s = createServer({ token: TOKEN, manager: mgr, project: opts.project || null }); servers.push([s, mgr]); return listen(s); };
    const p1 = await mk({});
    const q = new URLSearchParams({ s: SID, u: U1, b: '1' }).toString();
    assert.equal((await get(p1, q, {})).status, 401, '보기 토큰 없음');
    const ok = await get(p1, q);
    assert.equal(ok.status, 200); assert.ok(ok.j.md.startsWith('# 표'));
    assert.equal((await get(p1, new URLSearchParams({ s: SID, u: U1, b: '0' }).toString())).status, 404);
    assert.equal((await get(p1, 's=../../x&u=1&b=0')).status, 400);
    const p2 = await mk({ project: 'D--other' });
    assert.equal((await get(p2, q)).status, 404, 'config.project 밖');
    const p3 = await mk({ privacy: 'minimal' });
    assert.equal((await get(p3, q)).status, 403);
  } finally {
    for (const [s, m] of servers) { s.close(); try { s.closeAllConnections(); } catch {} m.stop?.(); }
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('§143.6 Interactive feed: 6000자를 넘긴 Claude 글만 cut:1', () => {
  const a = feedItem({ type: 'assistant', timestamp: 't', message: { content: [{ type: 'text', text: '가 '.repeat(ITEM_MAX) }] } });
  const b = feedItem({ type: 'assistant', timestamp: 't', message: { content: [{ type: 'text', text: '짧음' }] } });
  assert.equal(a.cut, 1); assert.ok(a.text.length <= ITEM_MAX);
  assert.equal(b.cut, undefined);
});
