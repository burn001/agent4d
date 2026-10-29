// 원격 조종(Remote Control)으로 한 /clear: 새 세션 머리에 첫 user('start') → 큰 첨부(도구·스킬 목록, 실측 약 120KB) →
// SessionStart:clear 훅 순으로 적혀, 96KB 머리 읽기 안에 /clear 표지가 없었다 → 승계 사슬이 비어 옛 메인이 넘긴 기동기·러너·회차가
// 전체 보기에서 통째로 빠졌다(2026-10-28 실제 프로젝트 실측 aafbccef). 합성 기록으로 재현한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex, parseHead } from '../discovery.mjs';
import { findClearPredecessor, clearChain } from '../succession.mjs';

const P = 'dddddddd-1111-4111-8111-111111111111'; // 옛 메인
const S = 'eeeeeeee-2222-4222-8222-222222222222'; // 원격 /clear 뒤 새 메인
const cwd = 'D:\\work\\rcclear';
const enc = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
let root, index, clearIso, sFile;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-rcclear-'));
  const dir = path.join(root, 'projects', enc(cwd));
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  const now = Date.now();
  const T = (sec) => new Date(now - 600_000 + sec * 1000).toISOString();
  const base = (sid) => ({ sessionId: sid, cwd, version: '2.1.330', entrypoint: 'cli' });
  const pRecs = [
    { type: 'user', timestamp: T(1), ...base(P), message: { role: 'user', content: '루프를 지켜보자' } },
    { type: 'assistant', timestamp: T(2), ...base(P), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '네' }] } },
    { type: 'queue-operation', operation: 'enqueue', timestamp: T(300), sessionId: P, content: '/clear' },
    { type: 'queue-operation', operation: 'dequeue', timestamp: T(300), sessionId: P },
  ];
  fs.writeFileSync(path.join(dir, `${P}.jsonl`), pRecs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  clearIso = T(305);
  const big = 'x'.repeat(20 * 1024);
  const sRecs = [
    { type: 'custom-title', customTitle: 'Project', sessionId: S },
    { type: 'bridge-session', sessionId: S, bridgeSessionId: 'cse_x', lastSequenceNum: 803 },
    { type: 'user', timestamp: T(309), ...base(S), origin: { kind: 'human' }, promptSource: 'queued', message: { role: 'user', content: 'start' } },
    // 첫 user 뒤 큰 첨부 6개(약 120KB)
    ...Array.from({ length: 6 }, (_, i) => ({ type: 'attachment', timestamp: T(309), ...base(S), attachment: { type: 'skill_listing', content: big + i } })),
    { type: 'queue-operation', operation: 'enqueue', timestamp: T(308), sessionId: S, content: 'start' },
    { type: 'attachment', timestamp: clearIso, ...base(S), parentUuid: null, attachment: { type: 'hook_success', hookName: 'SessionStart:clear', content: '' } },
    { type: 'assistant', timestamp: T(312), ...base(S), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: '이어서' }] } },
  ];
  sFile = path.join(dir, `${S}.jsonl`);
  fs.writeFileSync(sFile, sRecs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  index = new SessionIndex({ projectsDir: path.join(root, 'projects'), sessionsDir: path.join(root, 'sessions') });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('§74.9 머리 96KB 밖의 SessionStart:clear 도 clearAt 으로 잡고 앞 세션을 찾는다', async () => {
  assert.ok(fs.statSync(sFile).size > 110 * 1024, '표지가 96KB 밖');
  // 앞 96KB 만으로는 표지가 없고(scanned 아님), 전체로는 있다
  const head96 = parseHead(fs.readFileSync(sFile).subarray(0, 96 * 1024).toString('utf8'));
  assert.equal(head96.clearAt, null);
  assert.equal(head96.scanned, false);
  assert.equal(parseHead(fs.readFileSync(sFile, 'utf8')).clearAt, clearIso);
  await index.refresh();
  const e = index.findSession(S);
  const h = await index.ensureHead(e);
  assert.equal(h.clearAt, clearIso);
  assert.equal(h.firstPrompt, 'start');
  const p = await findClearPredecessor(index, e);
  assert.equal(p?.entry.sessionId, P);
  assert.equal(p.evidence, 'queue-clear');
  assert.deepEqual((await clearChain(index, e)).map((c) => c.entry.sessionId), [P]);
});

test('§74.9 첫 user 뒤 40줄을 다 본 머리는 scanned — 짧은 머리는 다시 읽을 여지를 남긴다', () => {
  const u = JSON.stringify({ type: 'user', timestamp: '2026-10-28T00:00:00Z', entrypoint: 'cli', message: { role: 'user', content: 'hi' } });
  const filler = JSON.stringify({ type: 'attachment', attachment: { type: 'x' } });
  assert.equal(parseHead([u, ...Array(10).fill(filler)].join('\n')).scanned, false);
  assert.equal(parseHead([u, ...Array(45).fill(filler)].join('\n')).scanned, true);
});
