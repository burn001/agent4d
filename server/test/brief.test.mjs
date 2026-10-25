// 작업 요약(brief·detail)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolBrief, resultBrief, textBrief, firstCommandLine, shortPath, BRIEF_LIMITS } from '../brief.mjs';
import { Graph } from '../graph.mjs';

test('toolBrief: 도구별 의미 있는 한 줄', () => {
  assert.deepEqual(toolBrief('Bash', { command: 'cd /d/x && npm test', description: '단위시험' }), { brief: 'npm test', detail: '단위시험' });
  assert.equal(toolBrief('Bash', { command: '# 주석\n\ngit status\nls' }).brief, 'git status …');
  assert.equal(toolBrief('Bash', { command: 'node s.mjs', run_in_background: true }).detail, '백그라운드');
  assert.equal(toolBrief('Read', { file_path: 'D:\\git\\proj\\web\\app.js' }).brief, 'web/app.js');
  assert.equal(toolBrief('Read', { file_path: '/a/b.md', offset: 100, limit: 50 }).detail, '100줄부터 50줄');
  assert.equal(toolBrief('Edit', { file_path: '/x/y/app.js', old_string: 'a\nb', new_string: 'a\nb\nc\nd' }).brief, 'app.js +4 −2');
  assert.equal(toolBrief('MultiEdit', { file_path: '/x/app.js', edits: [{ old_string: 'a', new_string: 'b\nc' }, { old_string: 'q', new_string: '' }] }).brief, 'app.js +2 −2');
  assert.equal(toolBrief('Write', { file_path: '/x/n.md', content: '1\n2\n3' }).brief, 'n.md 3줄');
  assert.equal(toolBrief('Grep', { pattern: 'TODO', path: 'C:\\r\\server\\x' }).brief, '"TODO" · server/x');
  assert.equal(toolBrief('Glob', { pattern: '**/*.mjs' }).brief, '**/*.mjs');
  assert.equal(toolBrief('WebFetch', { url: 'https://threejs.org/docs/index.html?q=1', prompt: '요약' }).brief, 'threejs.org/docs/index.html');
  assert.equal(toolBrief('WebSearch', { query: 'three.js CSS2D' }).brief, 'three.js CSS2D');
  assert.deepEqual(toolBrief('Agent', { description: '컨텍스트 게이지 구현', subagent_type: 'general-purpose', run_in_background: true }), { brief: '컨텍스트 게이지 구현', detail: 'general-purpose · 백그라운드' });
  assert.equal(toolBrief('Skill', { skill: 'writing-style', args: '점검' }).brief, 'writing-style 점검');
  assert.equal(toolBrief('TaskStop', { task_id: 'b12' }).brief, '■ b12');
  assert.equal(toolBrief('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', activeForm: 'b 하는 중', status: 'in_progress' }] }).brief, 'b 하는 중');
  assert.equal(toolBrief('mcp__ctx7__query', { q: '질문' }).brief, 'ctx7.query');
  assert.ok(toolBrief('Bash', { command: 'x'.repeat(500) }).brief.length <= BRIEF_LIMITS.brief);
  assert.equal(firstCommandLine('pushd "a b" ; make'), 'make');
  assert.equal(shortPath('C:\\Users\\me\\proj\\a.js'), 'proj/a.js');
});

test('resultBrief: 종료 코드·일치 수·줄 수·출력 마지막 줄', () => {
  assert.equal(resultBrief('Bash', { stdout: 'a\nok 71 tests\n', stderr: '' }, '', true), 'exit 0 · ok 71 tests');
  assert.equal(resultBrief('Bash', null, 'Exit code 2\nboom', false), 'exit 2 · boom');
  assert.equal(resultBrief('Bash', { backgroundTaskId: 'b9', stdout: '' }, '', true), '백그라운드 b9');
  assert.equal(resultBrief('Grep', { mode: 'files_with_matches', numFiles: 7 }, '', true), '7개 파일');
  assert.equal(resultBrief('Grep', { mode: 'content', numFiles: 2, numLines: 13 }, '', true), '13줄 일치');
  assert.equal(resultBrief('Read', { file: { numLines: 120, totalLines: 900 } }, '', true), '120줄 읽음 / 900');
  assert.equal(resultBrief('Edit', { structuredPatch: [{ lines: [' a', '-b', '+c', '+d'] }] }, '', true), '+2 −1');
  assert.equal(resultBrief('Write', { type: 'create', structuredPatch: [{ lines: ['+a', '+b'] }] }, '', true), '새 파일 +2 −0');
  assert.equal(resultBrief('WebFetch', { code: 200, bytes: 20480 }, '', true), 'HTTP 200 · 20KB');
  assert.equal(resultBrief('Agent', { totalToolUseCount: 12, totalDurationMs: 65000 }, '', true), '도구 12회 · 65초');
  assert.equal(resultBrief('Foo', null, '첫 줄\n마지막 줄', true), '마지막 줄');
  assert.match(resultBrief('Foo', null, 'nope', false), /^실패 · nope/);
});

test('textBrief: 최근 문장 한두 개', () => {
  assert.equal(textBrief('짧다.'), '짧다.');
  const t = '앞 설명이 길게 이어집니다. '.repeat(10) + '파서를 고쳤습니다. 이제 시험을 돌립니다.';
  assert.equal(textBrief(t), '파서를 고쳤습니다. 이제 시험을 돌립니다.');
  assert.ok(textBrief('가'.repeat(500)).length <= BRIEF_LIMITS.say);
});

test('graph.emit: brief·detail 도 마스킹·길이 상한, minimal 이면 비움', () => {
  const g = new Graph({ rootSessionId: 's', localSeq: true });
  const ev = g.emit({ type: 'tool-start', nodeId: 'x', text: 't', brief: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"', detail: 'password=hunter22 ' + 'x'.repeat(300) });
  assert.ok(!ev.brief.includes('abcdefghijklmnop'), ev.brief);
  assert.ok(!ev.detail.includes('hunter22'));
  assert.ok(ev.detail.length <= BRIEF_LIMITS.detail);
  const m = new Graph({ rootSessionId: 's', privacy: 'minimal', localSeq: true });
  const e2 = m.emit({ type: 'tool-start', nodeId: 'x', text: 'npm test', brief: 'npm test', detail: 'd' });
  assert.equal(e2.text, ''); assert.equal(e2.brief, ''); assert.equal(e2.detail, '');
  const e3 = g.emit({ type: 'thinking', nodeId: 'x', chars: 10 });
  assert.equal(e3.brief, undefined, '생각 내용은 싣지 않음');
});
