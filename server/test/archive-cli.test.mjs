// ccviz archive add·list — 임시 폴더의 합성 원본·보관함만 쓴다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { archiveAdd, metricsOf, renderIndexMd, indexRow, kst, findSessions, archiveDirOf } from '../../bin/archive.mjs';

const CCVIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'ccviz.mjs');
const S1 = '11111111-aaaa-4aaa-8aaa-111111111111';
const S2 = '22222222-bbbb-4bbb-8bbb-222222222222';
const S3 = '22222222-cccc-4ccc-8ccc-333333333333';

function makeSrc(root) {
  const proj = path.join(root, 'projects', 'D--work-x');
  fs.mkdirSync(path.join(proj, S1, 'subagents', 'workflows', 'wf1'), { recursive: true });
  fs.mkdirSync(path.join(proj, S1, 'tool-results'), { recursive: true });
  const T = (s) => new Date(Date.parse('2026-10-01T00:00:00Z') + s * 1000).toISOString();
  const A = (s, blocks) => ({ type: 'assistant', timestamp: T(s), cwd: 'D:\\work\\x', message: { content: blocks } });
  const recs = [
    { type: 'user', timestamp: T(5), cwd: 'D:\\work\\x', message: { content: '시작' } },
    { type: 'user', timestamp: T(0), cwd: 'D:\\work\\x', message: { content: '시각이 앞선 기록(최소값이 first)' } },
    A(10, [{ type: 'tool_use', name: 'Bash', input: { command: 'x', run_in_background: true } }, { type: 'tool_use', name: 'Read', input: {} }]),
    A(20, [{ type: 'tool_use', name: 'Agent', input: {} }, { type: 'tool_use', name: 'Task', input: {} }]),
    A(7200, [{ type: 'text', text: '끝' }]),
    { type: 'ai-title', aiTitle: '제목' },
  ];
  fs.writeFileSync(path.join(proj, `${S1}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(proj, S1, 'subagents', 'agent-a1.jsonl'), '{}\n');
  fs.writeFileSync(path.join(proj, S1, 'subagents', 'agent-a1.meta.json'), '{}');
  fs.writeFileSync(path.join(proj, S1, 'subagents', 'agent-a2.jsonl'), '{}\n');
  fs.writeFileSync(path.join(proj, S1, 'subagents', 'workflows', 'wf1', 'agent-w.jsonl'), '{}\n'); // 하위 폴더는 subs 에 안 셈
  fs.writeFileSync(path.join(proj, S1, 'tool-results', 'r.txt'), 'x'.repeat(5000));
  fs.writeFileSync(path.join(proj, `${S2}.jsonl`), JSON.stringify({ type: 'user', timestamp: T(0), message: { content: 'a' } }) + '\n');
  fs.writeFileSync(path.join(proj, `${S3}.jsonl`), JSON.stringify({ type: 'user', timestamp: T(0), message: { content: 'b' } }) + '\n');
  // 원본 시각을 옛날로(파일·폴더) — 보관 뒤 그대로인지 본다
  const old = Date.parse('2026-10-02T03:04:05Z') / 1000;
  const touch = (p, k = 0) => { for (const d of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, d.name); if (d.isDirectory()) touch(q, k + 1); fs.utimesSync(q, old + k, old + k + 100); } };
  touch(path.join(root, 'projects'));
  return path.join(root, 'projects');
}
const walk = (dir) => {
  const out = [];
  const rec = (p) => { for (const d of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, d.name); const st = fs.statSync(q); out.push([path.relative(dir, q), d.isDirectory() ? 'D' : st.size, Math.round(st.mtimeMs), d.isDirectory() ? '' : crypto.createHash('sha256').update(fs.readFileSync(q)).digest('hex')].join(' ')); if (d.isDirectory()) rec(q); } };
  rec(dir);
  return out.sort();
};

test('지표 정의: tools·kinds·agents(Agent/Task)·subs(subagents/*.jsonl)·bg·hours(최소～최대 ts)·mb·score', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-arc-'));
  try {
    const src = makeSrc(root);
    const m = metricsOf(path.join(src, 'D--work-x'), S1);
    assert.equal(m.tools, 4); assert.equal(m.kinds, 4); assert.equal(m.agents, 2); assert.equal(m.bg, 1); assert.equal(m.subs, 2);
    assert.equal(m.lines, 6);
    assert.equal(m.first, '2026-10-01T00:00:00.000Z'); assert.equal(m.last, '2026-10-01T02:00:00.000Z');
    assert.equal(m.hours, 2);
    assert.equal(m.score, 4 + 5 * 2 + 3 * 1 + 20 * 4);
    assert.equal(m.cwd, 'D:\\work\\x');
    assert.equal(m.mb, 0); // 수 KB
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('add: 같은 구조로 복사·파일과 폴더 시각 원본대로·대조, index.json·INDEX.md 갱신, 다시 하면 건너뜀, 원본은 그대로', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-arc-'));
  try {
    const src = makeSrc(root);
    const dir = path.join(root, 'arc');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'INDEX.md'), '# transcript_archive\r\n\r\n> 선별 0개 세션\r\n\r\n| 시작 | 끝 | 시간(h) | 도구 | 종류 | 서브 | 백그라운드 | MB | 사유 | cwd | 폴더/세션 |\r\n|---|---|---|---|---|---|---|---|---|---|---|\r\n\r\n뒤에 붙은 글\r\n');
    const srcBefore = walk(src);
    const r = await archiveAdd({ ids: [S1, 'zzzzzzzz', '22222222'], dir, from: src, why: '시험 사유' });
    assert.deepEqual(r.map((x) => [x.sid, x.status]).sort(), [[S1, 'added'], ['22222222', 'ambiguous'], ['zzzzzzzz', 'missing']].sort());
    assert.deepEqual(walk(src), srcBefore, '원본 손대지 않음');
    // 복사본: 같은 상대 경로·크기·mtime·SHA-256 (폴더 시각 포함)
    const a = walk(path.join(src, 'D--work-x')).filter((l) => l.startsWith(S1));
    const b = walk(path.join(dir, 'D--work-x'));
    assert.deepEqual(b, a);
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    assert.equal(idx.length, 1);
    assert.deepEqual(Object.keys(idx[0]), ['proj', 'sid', 'cwd', 'lines', 'tools', 'kinds', 'agents', 'subs', 'bg', 'hours', 'mb', 'first', 'last', 'score', 'why', 'childCount', 'outputCount', 'children', 'outputs']);
    assert.equal(idx[0].childCount, 0);
    assert.deepEqual(idx[0].why, ['시험 사유']);
    const md = fs.readFileSync(path.join(dir, 'INDEX.md'), 'utf8');
    assert.ok(md.includes('선별 1개 세션'));
    assert.ok(md.includes(`\`D--work-x/${S1}\``));
    assert.ok(md.includes('뒤에 붙은 글'));
    assert.ok(!/[^\r]\n/.test(md), 'CRLF 유지');
    // 다시: 건너뜀, 파일 그대로
    const arcBefore = walk(dir);
    const r2 = await archiveAdd({ ids: [S1], dir, from: src });
    assert.deepEqual(r2.map((x) => x.status), ['skipped']);
    assert.deepEqual(walk(dir), arcBefore);
    // 전체 id 로 하나 더(사유 없음 → '수동 추가'), 앞부분 8자 이상 + 유일하면 됨
    const r3 = await archiveAdd({ ids: ['22222222-bbbb'], dir, from: src });
    assert.deepEqual(r3.map((x) => x.status), ['added']);
    const idx2 = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    assert.equal(idx2.length, 2);
    assert.deepEqual(idx2[1].why, ['수동 추가']);
    assert.equal(idx2[0].sid, S1, '기존 항목 순서·내용 그대로');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('INDEX.md 행 모양·KST·없을 때 새로 만듦, 보관함 폴더 결정', () => {
  assert.equal(kst('2026-09-26T15:22:28.077Z'), '2026-09-27 00:22');
  const row = indexRow({ first: '2026-09-26T15:22:28.077Z', last: '2026-09-27T01:25:33.772Z', hours: 10.1, tools: 218, kinds: 11, subs: 1, bg: 5, mb: 4.3,
    why: ['프로젝트 대표(상위 점수)'], cwd: 'D:\\dev_repos\\demo_api', proj: 'P', sid: 'S' });
  assert.equal(row, '| 2026-09-27 00:22 | 2026-09-27 10:25 | 10.1 | 218 | 11 | 1 | 5 | 4.3 | 프로젝트 대표(상위 점수) | `D:\\dev_repos\\demo_api` | `P/S` | - | - |');
  const md = renderIndexMd(null, []);
  assert.ok(md.startsWith('# transcript_archive'));
  assert.equal(archiveDirOf({ dir: 'X' }, {}), 'X');
  assert.equal(archiveDirOf({}, { CCVIZ_ARCHIVE: 'E', CCVIZ_HOME: path.join(os.tmpdir(), 'none-ccviz') }), 'E');
  assert.equal(findSessions(path.join(os.tmpdir(), 'none-ccviz-x'), ['a']).missing.length, 1);
});

test('ccviz archive list·add (CLI)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-arc-'));
  try {
    const src = makeSrc(root);
    const dir = path.join(root, 'arc');
    const env = { ...process.env, CCVIZ_HOME: path.join(root, 'home'), CCVIZ_ARCHIVE: '', CLAUDE_CONFIG_DIR: root, CCVIZ_LANG: 'ko' }; // 문구 검사는 한국어로 고정
    const run = (...a) => spawnSync(process.execPath, [CCVIZ, 'archive', ...a], { env, encoding: 'utf8', timeout: 20_000 });
    const add = run('add', S1, '--dir', dir, '--why', 'CLI');
    assert.equal(add.status, 0, add.stderr);
    assert.match(add.stdout, /추가 1/);
    const again = run('add', S1, '--dir', dir);
    assert.match(again.stdout, /건너뜀 1/);
    const list = run('list', '--dir', dir);
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /세션 1개/);
    assert.match(list.stdout, /CLI/);
    const miss = run('add', 'ffffffff-0000-4000-8000-ffffffffffff', '--dir', dir);
    assert.equal(miss.status, 1);
    const nodir = run('list');
    assert.equal(nodir.status, 1);
    assert.ok(src);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
