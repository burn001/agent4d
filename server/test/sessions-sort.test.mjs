// /sessions 정렬 기준 — 첫·마지막 기록 시각(startedAt·endedAt)으로만, 파일 mtime 과 섞지 않는다 (합성 데이터만)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionIndex } from '../discovery.mjs';

const BASE = Date.parse('2026-10-20T00:00:00.000Z');
const T = (min) => new Date(BASE + min * 60_000).toISOString();
const sid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let root, projects, sessions, index;

/** 세션 파일: [시작분, 끝분], 꼬리에 시각 없는 제목 레코드, mtime 은 일부러 어긋나게 */
function writeSession(projDir, n, startMin, endMin, { mtimeMin = endMin, entrypoint = 'cli', title = null } = {}) {
  const dir = path.join(projects, projDir);
  fs.mkdirSync(dir, { recursive: true });
  const id = sid(n);
  const recs = [
    { type: 'user', timestamp: T(startMin), sessionId: id, cwd: 'D:\\p\\' + projDir, entrypoint, message: { role: 'user', content: `세션 ${n}` } },
    { type: 'assistant', timestamp: T((startMin + endMin) / 2), sessionId: id, message: { role: 'assistant', content: [{ type: 'text', text: '중간' }] } },
    { type: 'assistant', timestamp: T(endMin), sessionId: id, message: { role: 'assistant', content: [{ type: 'text', text: '끝' }] } },
  ];
  const lines = recs.map((r) => JSON.stringify(r));
  if (title) lines.push(JSON.stringify({ type: 'ai-title', aiTitle: title, sessionId: id })); // 시각 없는 꼬리 레코드(mtime 만 바꿈)
  const f = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  const m = new Date(BASE + mtimeMin * 60_000);
  fs.utimesSync(f, m, m);
  return id;
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-sort-'));
  projects = path.join(root, 'projects'); sessions = path.join(root, 'sessions');
  fs.mkdirSync(projects, { recursive: true }); fs.mkdirSync(sessions, { recursive: true });
  // 1: 일찍 시작·늦게 끝남(긴 세션), 제목이 나중에 붙어 mtime 이 훨씬 뒤
  writeSession('D--p-a', 1, 0, 300, { mtimeMin: 900, title: '긴 세션' });
  // 2: 가장 늦게 시작, 짧음
  writeSession('D--p-a', 2, 400, 420);
  // 3: 중간 시작, 끝은 1 보다 앞 — mtime 만 보면 2 보다 뒤로 보이게
  writeSession('D--p-a', 3, 100, 200, { mtimeMin: 800 });
  // 4: 자식(claude -p), 1 의 안쪽
  writeSession('D--p-a', 4, 50, 60, { entrypoint: 'sdk-cli' });
  // 5: 다른 프로젝트
  writeSession('D--p-b', 5, 10, 500);
  index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
  await index.refresh();
});
after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

const ids = (list) => list.map((s) => Number(s.sessionId.slice(-2)));

test('startedAt·endedAt 은 첫·마지막 기록 시각(시각 없는 꼬리 레코드·mtime 무시)', async () => {
  const list = await index.list(50, { project: 'D--p-a' });
  const s1 = list.find((s) => s.sessionId === sid(1));
  assert.equal(s1.startedAt, T(0));
  assert.equal(s1.endedAt, T(300), 'mtime(900분)이 아니라 마지막 기록');
  assert.equal(s1.durationMs, 300 * 60_000);
  assert.equal(s1.title, '긴 세션');
  assert.ok(!('endApprox' in s1));
  assert.ok(!('_s' in s1) && !('_e' in s1), '내부 정렬 키는 응답에 없음');
});

test('기본 정렬 = 마지막 기록 내림차순, sort=start = 첫 기록 내림차순(mtime 순서와 다름)', async () => {
  assert.deepEqual(ids(await index.list(50, { project: 'D--p-a' })), [2, 1, 3, 4]);
  assert.deepEqual(ids(await index.list(50, { project: 'D--p-a', sort: 'start' })), [2, 3, 4, 1]);
  // mtime 순(예전 방식)이었다면 1(900) → 3(800) → 2(420) → 4
});

test('limit 조기 종료도 정확: 상위 k 개가 전체 정렬의 앞 k 개와 같다', async () => {
  for (const sort of ['recent', 'start']) {
    const full = ids(await index.list(50, { sort }));
    for (let k = 1; k <= full.length; k++) assert.deepEqual(ids(await index.list(k, { sort })), full.slice(0, k), `${sort} k=${k}`);
  }
});

test('since: 마지막 기록이 그 뒤인 세션만, kind=main 은 자식 제외, 자식은 부모 sessionId', async () => {
  assert.deepEqual(ids(await index.list(50, { project: 'D--p-a', since: BASE + 250 * 60_000 })), [2, 1]);
  assert.deepEqual(ids(await index.list(50, { project: 'D--p-a', kind: 'main', sort: 'start' })), [2, 3, 1]);
  index.childParent.set(sid(4), sid(1));
  const child = (await index.list(50, { project: 'D--p-a' })).find((s) => s.sessionId === sid(4));
  assert.equal(child.isChild, true);
  assert.equal(child.parentSessionId, sid(1));
  assert.equal(child.running, false);
});
