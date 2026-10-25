// 재생 시험용 합성 transcript 트리 (실제 transcript 를 복사하지 않는다). 모든 시각은 3일 전 기준.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const RIDS = {
  main: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  child: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', // 휴리스틱(cwd·프롬프트)으로만 찾는 옛 claude -p 자식
  other: 'cccccccc-3333-4333-8333-cccccccccccc', // 다른 프로젝트의 cli 세션
};

const enc = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');

export function makeReplayFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-replay-'));
  const projects = path.join(root, 'projects');
  const sessions = path.join(root, 'sessions');
  const tmpClaude = path.join(root, 'tmp', 'claude');
  fs.mkdirSync(sessions, { recursive: true });
  const cwd = 'D:\\work\\rp';
  const childCwd = 'C:\\scratch\\rp';
  const otherCwd = 'D:\\work\\other';
  const proj = path.join(projects, enc(cwd));
  const childProj = path.join(projects, enc(childCwd));
  const otherProj = path.join(projects, enc(otherCwd));
  for (const d of [proj, childProj, otherProj]) fs.mkdirSync(d, { recursive: true });
  const tasks = path.join(tmpClaude, enc(cwd), RIDS.main, 'tasks');
  fs.mkdirSync(tasks, { recursive: true });

  const P = Date.now() - 3 * 86400_000; // 3일 전
  const T = (sec) => new Date(P + sec * 1000).toISOString();
  const M = RIDS.main;
  const base = (sid, extra = {}) => ({ sessionId: sid, cwd, version: '2.1.309', entrypoint: 'cli', ...extra });
  const A = (sid, sec, block, extra = {}) => ({ type: 'assistant', timestamp: T(sec), ...base(sid, extra), message: { model: 'claude-test-1', role: 'assistant', content: [block] } });
  const TU = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const R = (sid, sec, id, content, tur, extra = {}) => ({ type: 'user', timestamp: T(sec), ...base(sid, extra), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: !!extra.is_error }] }, toolUseResult: tur });
  const U = (sid, sec, content, extra = {}) => ({ type: 'user', timestamp: T(sec), ...base(sid, extra), message: { role: 'user', content } });
  const write = (file, recs) => fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const SC = (agentId) => ({ isSidechain: true, agentId });

  const bgOut = path.join(tasks, 'rbg001.output');
  fs.writeFileSync(bgOut, Array.from({ length: 10 }, (_, i) => `bg line ${i + 1}`).join('\n') + '\n');
  const monOut = path.join(tasks, 'rmon01.output');
  fs.writeFileSync(monOut, 'file-only monitor line\n');

  write(path.join(proj, `${M}.jsonl`), [
    U(M, 0, '재생 시험 세션을 시작합니다', { origin: { kind: 'human' }, promptSource: 'user' }),
    { type: 'ai-title', aiTitle: '재생 시험', sessionId: M },
    A(M, 2, { type: 'text', text: '시작' }),
    A(M, 3, TU('toolu_ra1', 'Agent', { description: '조사' })),
    R(M, 4, 'toolu_ra1', 'Async agent launched', { isAsync: true, status: 'async_launched', agentId: 'ragent01', description: '조사' }),
    A(M, 10, TU('toolu_rwf', 'Workflow', { script_path: 'w.js' })),
    R(M, 11, 'toolu_rwf', 'launched', { status: 'async_launched', taskId: 'rwft1', taskType: 'local_workflow', workflowName: 'replay-flow', runId: 'wf_r-001' }),
    A(M, 30, TU('toolu_rbg', 'Bash', { command: 'node long.mjs', description: '긴 작업', run_in_background: true })),
    R(M, 31, 'toolu_rbg', `Command running in background with ID: rbg001. Output is being written to: ${bgOut}`, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'rbg001' }),
    A(M, 40, TU('toolu_rcp', 'Bash', { command: 'cd "C:\\scratch\\rp" && claude -p "옛 자식 프롬프트" | head', description: '옛 자식' })),
    R(M, 50, 'toolu_rcp', 'done', { stdout: 'done', stderr: '' }),
    A(M, 60, TU('toolu_rmon', 'Monitor', { description: '감시' })),
    R(M, 61, 'toolu_rmon', 'Monitor started (task rmon01)', { taskId: 'rmon01', timeoutMs: 1800000, persistent: false }),
    U(M, 70, '<task-notification>\n<task-id>rmon01</task-id>\n<summary>Monitor event: &quot;감시&quot;</summary>\n<event>첫 이벤트</event>\n</task-notification>', { origin: { kind: 'task-notification' } }),
    U(M, 80, '<task-notification>\n<task-id>rmon01</task-id>\n<summary>Monitor event: &quot;감시&quot;</summary>\n<event>둘째 이벤트</event>\n</task-notification>', { origin: { kind: 'task-notification' } }),
    U(M, 90, `<task-notification>\n<task-id>rbg001</task-id>\n<output-file>${bgOut}</output-file>\n<status>completed</status>\n<summary>Background command &quot;긴 작업&quot; completed (exit code 0)</summary>\n</task-notification>`, { origin: { kind: 'task-notification' } }),
    U(M, 250, '<task-notification>\n<task-id>ragent01</task-id>\n<status>completed</status>\n<summary>Agent done</summary>\n<result>조사 끝</result>\n</task-notification>', { origin: { kind: 'task-notification' } }),
    U(M, 255, '<task-notification>\n<task-id>rwft1</task-id>\n<status>completed</status>\n<summary>Workflow done</summary>\n</task-notification>', { origin: { kind: 'task-notification' } }),
    { type: 'system', subtype: 'turn_duration', durationMs: 1000, timestamp: T(260), ...base(M) },
  ]);

  // 서브에이전트: 7초 뒤 193초 공백(대기 합성 대상)
  const sub = path.join(proj, M, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-ragent01.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: '조사', toolUseId: 'toolu_ra1', spawnDepth: 1, requestShape: 'background' }));
  write(path.join(sub, 'agent-ragent01.jsonl'), [
    U(M, 5, '조사하라', SC('ragent01')),
    A(M, 6, TU('toolu_ra1_read', 'Read', { file_path: 'D:\\work\\rp\\a.txt' }), SC('ragent01')),
    R(M, 7, 'toolu_ra1_read', 'text', {}, SC('ragent01')),
    A(M, 200, { type: 'text', text: '다시 시작' }, SC('ragent01')),
  ]);

  // 워크플로(journal 에는 시각이 없다 — 실측)
  const wf = path.join(sub, 'workflows', 'wf_r-001');
  fs.mkdirSync(wf, { recursive: true });
  write(path.join(wf, 'journal.jsonl'), [
    { type: 'launched' },
    { type: 'started', key: 'v2:a', agentId: 'rwa01', label: 'design:a', phase: 'Design' },
    { type: 'result', key: 'v2:a', agentId: 'rwa01', result: { summary: '설계 끝' } },
    { type: 'started', key: 'v2:b', agentId: 'rwa02', label: 'build:b', phase: 'Build' },
  ]);
  fs.writeFileSync(path.join(wf, 'agent-rwa01.meta.json'), JSON.stringify({ agentType: 'workflow-subagent', description: 'design:a', workflowPhase: 'Design', spawnDepth: 1 }));
  write(path.join(wf, 'agent-rwa01.jsonl'), [
    U(M, 12, '설계하라', SC('rwa01')),
    A(M, 13, { type: 'text', text: '설계 중' }, SC('rwa01')),
    A(M, 20, { type: 'text', text: '설계 끝' }, SC('rwa01')),
  ]);
  fs.writeFileSync(path.join(wf, 'agent-rwa02.meta.json'), JSON.stringify({ agentType: 'workflow-subagent', description: 'build:b', workflowPhase: 'Build', spawnDepth: 1 }));
  write(path.join(wf, 'agent-rwa02.jsonl'), [
    U(M, 21, '만들어라', SC('rwa02')),
    A(M, -5000, { type: 'text', text: '시계가 틀린 기록' }, SC('rwa02')), // 세션 시작 전 시각 → 범위 밖 고정
    A(M, 24, TU('toolu_rwa2_grep', 'Grep', { pattern: 'x' }), SC('rwa02')),
    R(M, 23.5, 'toolu_rwa2_grep', 'found', {}, SC('rwa02')), // 결과가 시작보다 이른 기록 → 인과 순서 보정
    A(M, 25, { type: 'text', text: '빌드 끝' }, SC('rwa02')),
  ]);

  // 옛 claude -p 자식(부모 정보 없음)
  const child = RIDS.child;
  const sdkBase = { sessionId: child, cwd: childCwd, entrypoint: 'sdk-cli' };
  write(path.join(childProj, `${child}.jsonl`), [
    { type: 'user', timestamp: T(41), ...sdkBase, promptSource: 'sdk', message: { role: 'user', content: '옛 자식 프롬프트' } },
    { type: 'assistant', timestamp: T(42), ...sdkBase, message: { model: 'claude-test-1', content: [{ type: 'text', text: '자식 답' }] } },
    { type: 'system', subtype: 'turn_duration', timestamp: T(43), ...sdkBase },
  ]);

  // 다른 프로젝트 세션
  write(path.join(otherProj, `${RIDS.other}.jsonl`), [
    { type: 'user', timestamp: T(0), sessionId: RIDS.other, cwd: otherCwd, entrypoint: 'cli', origin: { kind: 'human' }, message: { role: 'user', content: '다른 프로젝트' } },
    { type: 'assistant', timestamp: T(5), sessionId: RIDS.other, cwd: otherCwd, entrypoint: 'cli', message: { content: [{ type: 'text', text: '응' }] } },
  ]);

  // 모든 파일을 옛 시각으로(생성 시각은 바꿀 수 없으므로 시험이 색인의 birthtimeMs 를 덮어쓴다)
  const old = (P + 300_000) / 1000;
  const touch = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) touch(p); else fs.utimesSync(p, old, old);
    }
  };
  touch(projects);
  touch(tmpClaude);

  return { root, projects, sessions, tmpClaude, proj, childProj, otherProj, T, P, bgOut, monOut, cwd,
    projectDir: enc(cwd), otherProjectDir: enc(otherCwd) };
}

/** 색인 항목의 생성 시각을 mtime 으로(옛 파일처럼) */
export function ageIndex(index) {
  for (const e of index.entries.values()) e.birthtimeMs = e.mtimeMs;
}

export function rmReplayFixture(fx) {
  try { fs.rmSync(fx.root, { recursive: true, force: true }); } catch {}
}
