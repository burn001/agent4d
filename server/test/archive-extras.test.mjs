// 보관함에 claude -p 자식 세션·백그라운드 출력 포함 — 합성 fixture 만. 원본·보관함은 시험 임시 폴더
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeReplayFixture, rmReplayFixture, RIDS } from './fixtures/replay-build.mjs';
import { SessionIndex, taskRelOf } from '../discovery.mjs';
import { buildReplay } from '../replay.mjs';
import { ArchiveSource, ARCHIVE_TASKS } from '../archive.mjs';
import { archiveAdd, collectExtras, renderIndexMd } from '../../bin/archive.mjs';

let fx, prevTmp;
before(() => { fx = makeReplayFixture(); prevTmp = process.env.CCVIZ_CLAUDE_TMP; process.env.CCVIZ_CLAUDE_TMP = fx.tmpClaude; });
after(() => { if (prevTmp == null) delete process.env.CCVIZ_CLAUDE_TMP; else process.env.CCVIZ_CLAUDE_TMP = prevTmp; rmReplayFixture(fx); });

/** 폴더 전체 (상대 경로 → 크기·mtime·sha256 / 폴더 mtime) */
function tree(dir) {
  const out = new Map();
  const walk = (p) => {
    for (const d of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, d.name), st = fs.statSync(q), rel = path.relative(dir, q);
      if (d.isDirectory()) { out.set(rel + '/', String(Math.round(st.mtimeMs))); walk(q); }
      else out.set(rel, `${st.size} ${Math.round(st.mtimeMs)} ${crypto.createHash('sha256').update(fs.readFileSync(q)).digest('hex')}`);
    }
  };
  walk(dir);
  return out;
}
const summary = (d) => ({
  nodes: [...d.finalState.nodes.keys()].sort(),
  outputs: d.events.filter((e) => e.type === 'output').length,
  panels: d.events.filter((e) => e.panel).length,
});
async function origReplay() {
  const idx = new SessionIndex({ projectsDir: fx.projects, sessionsDir: fx.sessions });
  return buildReplay({ sessionId: RIDS.main, index: idx });
}
async function arcReplay(dir) {
  const a = new ArchiveSource({ dir });
  return { a, d: await a.replay('arc:' + RIDS.main) };
}

test('taskRelOf: 임시 폴더 기준 <인코딩 cwd>/<세션>/tasks[/파일]', () => {
  assert.equal(taskRelOf('C:\\Users\\x\\AppData\\Local\\Temp\\claude\\D--w\\aaaa\\tasks\\b1.output'), 'D--w/aaaa/tasks/b1.output');
  assert.equal(taskRelOf('/tmp/claude/D--w/aaaa/tasks'), 'D--w/aaaa/tasks');
  assert.equal(taskRelOf('/x/b1.output'), null);
});

test('collectExtras: 원본 재생 구성으로 claude -p 자식(다른 프로젝트 폴더)·출력 파일을 찾는다', async () => {
  const ex = await collectExtras({ from: fx.projects, sid: RIDS.main });
  assert.deepEqual(ex.children, [{ proj: path.basename(fx.childProj), sid: RIDS.child }]);
  const rels = ex.outputs.map((o) => o.rel);
  assert.ok(rels.includes(`${fx.projectDir}/${RIDS.main}/tasks/rbg001.output`), rels.join(','));
  assert.ok(rels.includes(`${fx.projectDir}/${RIDS.main}/tasks/rmon01.output`));
  assert.equal(ex.missing.children, 0);
});

test('add(자식·출력 포함) → 보관함 재생 = 원본 재생, 목록에는 메인만, 원본 안 바뀜', async () => {
  const dir = path.join(fx.root, 'arc-full');
  const srcBefore = tree(fx.projects);
  const r = await archiveAdd({ ids: [RIDS.main], dir, from: fx.projects, why: '시험' });
  assert.equal(r[0].status, 'added');
  assert.deepEqual([r[0].extras.children.added, r[0].extras.outputs.added], [1, 2]);
  assert.deepEqual(tree(fx.projects), srcBefore, '원본 그대로');
  // 자식은 원래 프로젝트 폴더 구조 그대로, 출력은 _tasks/<원래 상대 경로>, 시각·내용 같음
  const cf = path.join(dir, path.basename(fx.childProj), `${RIDS.child}.jsonl`);
  assert.equal(fs.statSync(cf).mtimeMs, fs.statSync(path.join(fx.childProj, `${RIDS.child}.jsonl`)).mtimeMs);
  const of = path.join(dir, ARCHIVE_TASKS, fx.projectDir, RIDS.main, 'tasks', 'rbg001.output');
  assert.equal(fs.readFileSync(of, 'utf8'), fs.readFileSync(fx.bgOut, 'utf8'));
  assert.equal(Math.round(fs.statSync(of).mtimeMs), Math.round(fs.statSync(fx.bgOut).mtimeMs));
  assert.equal(Math.round(fs.statSync(path.dirname(of)).mtimeMs), Math.round(fs.statSync(path.dirname(fx.bgOut)).mtimeMs), '새 폴더 시각도 원본대로');
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.equal(idx[0].childCount, 1);
  assert.equal(idx[0].outputCount, 2);
  assert.deepEqual(idx[0].children, [{ proj: path.basename(fx.childProj), sid: RIDS.child }]);
  assert.match(fs.readFileSync(path.join(dir, 'INDEX.md'), 'utf8'), /\| 자식 \| 출력 \|[\s\S]*\| 1 \| 2 \|/);
  // 재생: 원본과 같은 노드·출력
  const o = summary(await origReplay());
  const { a, d } = await arcReplay(dir);
  assert.deepEqual(summary(d), o);
  assert.ok(o.nodes.includes(`s:${RIDS.child}`));
  // 목록·요약에는 메인만(자식은 메인 트리 안)
  const s = await a.summary();
  assert.equal(s.count, 1);
  assert.deepEqual(s.projects.map((p) => p.projectId), [fx.projectDir]);
  assert.deepEqual((await a.list(10)).map((x) => x.originalSessionId), [RIDS.main]);
});

test('보관함 출력은 보관함 안에서만: 원래 임시 폴더 파일을 읽지 않는다(원본이 지워져도·다른 PC 도 같음)', async () => {
  const dir = path.join(fx.root, 'arc-main-only');
  await archiveAdd({ ids: [RIDS.main], dir, from: fx.projects, extras: false });
  const { d } = await arcReplay(dir);
  const o = summary(await origReplay());
  const s = summary(d);
  assert.ok(s.outputs < o.outputs, '메인만 보관한 상태에서는 원래 임시 폴더 출력을 끌어오지 않음');
  assert.ok(!s.nodes.includes(`s:${RIDS.child}`), '자식 없음');
});

test('add --refresh: 있는 메인은 두고 빠진 자식·출력만 더함, 기존 파일 불변, 다시 하면 그대로, 원본에서 지워진 자식은 건너뛰고 보고', async () => {
  const dir = path.join(fx.root, 'arc-refresh');
  await archiveAdd({ ids: [RIDS.main], dir, from: fx.projects, extras: false });
  const before0 = tree(dir);
  const mainBefore = fs.statSync(path.join(dir, fx.projectDir));
  const r = await archiveAdd({ ids: [], dir, from: fx.projects, refresh: true });
  assert.equal(r.length, 1);
  assert.equal(r[0].status, 'refreshed');
  assert.deepEqual([r[0].extras.children.added, r[0].extras.outputs.added], [1, 2]);
  const after1 = tree(dir);
  for (const [k, v] of before0) {
    if (k === 'index.json' || k === 'INDEX.md') continue;
    assert.equal(after1.get(k), v, `기존 항목 그대로: ${k}`);
  }
  assert.equal(fs.statSync(path.join(dir, fx.projectDir)).mtimeMs, mainBefore.mtimeMs, '원래 있던 폴더 시각 되돌림');
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.equal(idx[0].why[0], '수동 추가', '기존 키 값 그대로');
  assert.equal(idx[0].childCount, 1);
  const { d } = await arcReplay(dir);
  assert.deepEqual(summary(d), summary(await origReplay()), '보강 뒤 재생 = 원본');
  // 다시: 더할 것 없음, 파일 그대로
  const r2 = await archiveAdd({ ids: [], dir, from: fx.projects, refresh: true });
  assert.equal(r2[0].status, 'skipped');
  assert.deepEqual(tree(dir), after1);
  // 원본에서 자식이 지워진 경우: 새 보관함에 메인만 두고 보강하면 자식은 건너뛰고 missing 으로 보고
  const dir2 = path.join(fx.root, 'arc-gone');
  await archiveAdd({ ids: [RIDS.main], dir: dir2, from: fx.projects, extras: false });
  const cf = path.join(fx.childProj, `${RIDS.child}.jsonl`);
  const keep = fs.readFileSync(cf);
  const st = fs.statSync(cf);
  fs.rmSync(cf);
  try {
    const r3 = await archiveAdd({ ids: [], dir: dir2, from: fx.projects, refresh: true });
    assert.equal(r3[0].extras.children.added, 0);
    assert.equal(r3[0].missingExtras.children, 1, '매칭 못 한 claude -p 호출 = 원본 없음');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir2, 'index.json'), 'utf8'))[0].missing.children, 1);
  } finally { fs.writeFileSync(cf, keep); fs.utimesSync(cf, st.atime, st.mtime); }
});

test('INDEX.md: 예전 11열 표도 알아보고 13열로 다시 쓴다', () => {
  const prev = '# t\n\n> 선별 0개 세션\n\n| 시작 | 끝 | 시간(h) | 도구 | 종류 | 서브 | 백그라운드 | MB | 사유 | cwd | 폴더/세션 |\n|---|---|---|---|---|---|---|---|---|---|---|\n\n꼬리\n';
  const md = renderIndexMd(prev, [{ first: '2026-10-01T00:00:00Z', last: '2026-10-01T01:00:00Z', hours: 1, tools: 1, kinds: 1, subs: 0, bg: 0, mb: 0, why: [], cwd: 'x', proj: 'P', sid: 'S', childCount: 3, outputCount: 4 }]);
  assert.ok(md.startsWith('# t\n\n> 선별 1개 세션'));
  assert.ok(md.includes('| 폴더/세션 | 자식 | 출력 |'));
  assert.ok(md.includes('| `P/S` | 3 | 4 |'));
  assert.ok(md.endsWith('꼬리\n'));
  assert.equal((md.match(/\| 시작 \|/g) || []).length, 1);
});
