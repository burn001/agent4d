// 합성 transcript 트리 생성기 (실제 transcript 를 복사하지 않는다)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const IDS = {
  main: '11111111-1111-4111-8111-111111111111',
  childHint: '22222222-2222-4222-8222-222222222222', // --session-id 로 지정
  childStdout: '33333333-3333-4333-8333-333333333333', // stdout session_id 로만 알 수 있음
  childHeur: '44444444-4444-4444-8444-444444444444', // 휴리스틱(cwd·프롬프트)
  stray: '55555555-5555-4555-8555-555555555555', // 매칭되지 않는 sdk-cli
  other: '66666666-6666-4666-8666-666666666666', // 다른 cli 세션(오래됨)
};

const enc = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');

export function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-test-'));
  const projects = path.join(root, 'projects');
  const sessions = path.join(root, 'sessions');
  const tmpClaude = path.join(root, 'tmp', 'claude');
  fs.mkdirSync(sessions, { recursive: true });
  const cwd = 'D:\\work\\demo';
  const childCwd = 'C:\\scratch\\probe';
  const proj = path.join(projects, enc(cwd));
  const childProj = path.join(projects, enc(childCwd));
  fs.mkdirSync(proj, { recursive: true });
  fs.mkdirSync(childProj, { recursive: true });
  const tasks = path.join(tmpClaude, enc(cwd), IDS.main, 'tasks');
  fs.mkdirSync(tasks, { recursive: true });

  const now = Date.now();
  const T = (sec) => new Date(now - 600_000 + sec * 1000).toISOString();
  const base = (sid, extra = {}) => ({ sessionId: sid, cwd, version: '2.1.309', entrypoint: 'cli', ...extra });
  const A = (sid, sec, block, extra = {}) => ({ type: 'assistant', uuid: `u${sec}`, timestamp: T(sec), ...base(sid, extra), message: { model: 'claude-test-1', role: 'assistant', content: [block] } });
  const TU = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const R = (sid, sec, id, content, tur, extra = {}) => ({ type: 'user', timestamp: T(sec), ...base(sid, extra), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: !!extra.is_error }] }, toolUseResult: tur });
  const U = (sid, sec, content, extra = {}) => ({ type: 'user', timestamp: T(sec), ...base(sid, extra), message: { role: 'user', content } });
  const write = (file, recs) => fs.writeFileSync(file, recs.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');

  const M = IDS.main;
  const bgOut = path.join(tasks, 'bgtask001.output');
  fs.writeFileSync(bgOut, 'line1\nline2\n');
  const monOut = path.join(tasks, 'mon00001.output');
  fs.writeFileSync(monOut, '[메일] 새 알림\n');
  // tasks 에 섞여 있는 무시 대상(포그라운드·에이전트 출력)
  fs.writeFileSync(path.join(tasks, 'afore0001.output'), '');

  write(path.join(proj, `${M}.jsonl`), [
    { type: 'queue-operation', operation: 'enqueue', timestamp: T(0), sessionId: M, content: '안녕' },
    U(M, 1, '시각화 도구를 만들어 주세요 password=hunter2', { origin: { kind: 'human' }, promptSource: 'user' }),
    { type: 'ai-title', aiTitle: '시각화 도구 제작', sessionId: M },
    `{"type":"api-request-blob","sessionId":"${M}","blob":"${'x'.repeat(5000)}"}`,
    A(M, 2, { type: 'thinking', thinking: 'abcdef' }),
    A(M, 3, { type: 'text', text: '시작하겠습니다. 키는 sk-ant-abcdefghijklmnop 입니다' }),
    A(M, 4, TU('toolu_read1', 'Read', { file_path: 'D:\\work\\demo\\src\\app.js' })),
    R(M, 5, 'toolu_read1', 'file contents', { type: 'text', file: {} }),
    // Agent 백그라운드
    A(M, 6, TU('toolu_agent1', 'Agent', { description: '자료 조사', prompt: '...' })),
    R(M, 7, 'toolu_agent1', 'Async agent launched', { isAsync: true, status: 'async_launched', agentId: 'agentaaa1', description: '자료 조사' }),
    // Agent 포그라운드(즉시 완료)
    A(M, 8, TU('toolu_agent2', 'Agent', { description: '빠른 확인' })),
    R(M, 9, 'toolu_agent2', [{ type: 'text', text: '확인 결과: 이상 없음' }], { isAsync: false, status: 'completed', agentId: 'agentbbb2' }),
    // Workflow
    A(M, 10, TU('toolu_wf1', 'Workflow', { script_path: 'x.js' })),
    R(M, 11, 'toolu_wf1', 'launched', { status: 'async_launched', taskId: 'wftask01', taskType: 'local_workflow', workflowName: 'demo-flow', runId: 'wf_test-001', summary: '', transcriptDir: '' }),
    // Background bash
    A(M, 12, TU('toolu_bg1', 'Bash', { command: 'npm run dev --token=abcd1234secret', description: '개발 서버', run_in_background: true })), // gitleaks:allow (시험용 가짜 값)
    R(M, 13, 'toolu_bg1', `Command running in background with ID: bgtask001. Output is being written to: ${bgOut}`, { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false, backgroundTaskId: 'bgtask001' }),
    // Monitor
    A(M, 14, TU('toolu_mon1', 'Monitor', { description: '알림 감시', command: 'tail -f x' })),
    R(M, 15, 'toolu_mon1', 'Monitor started (task mon00001)', { taskId: 'mon00001', timeoutMs: 1800000, persistent: false }),
    // Monitor 2: 만료된 것(출력 파일 없음, 알림 event 만)
    A(M, 16, TU('toolu_mon2', 'Monitor', { description: '옛 감시' })),
    R(M, 17, 'toolu_mon2', 'Monitor started (task mon00002)', { taskId: 'mon00002', timeoutMs: 1800000, persistent: false }),
    U(M, 18, '<task-notification>\n<task-id>mon00002</task-id>\n<summary>Monitor event: &quot;옛 감시&quot;</summary>\n<event>[메일] 홍길동 &lt;a@b.c&gt; 안녕</event>\n</task-notification>', { origin: { kind: 'task-notification' }, promptSource: 'system' }),
    U(M, 19, '<task-notification>\n<task-id>mon00002</task-id>\n<summary>Monitor event</summary>\n<event>[Monitor expired after 30m with 1 event delivered.]</event>\n</task-notification>', { origin: { kind: 'task-notification' } }),
    // claude -p (session-id 힌트)
    A(M, 20, TU('toolu_cp1', 'Bash', { command: `cd /c/scratch/probe && claude -p "say hi" --session-id ${IDS.childHint} --output-format json`, description: 'claude -p 힌트' })),
    R(M, 25, 'toolu_cp1', 'hi', { stdout: 'hi', stderr: '', interrupted: false, isImage: false, noOutputExpected: false }),
    // claude -p (stdout session_id)
    A(M, 30, TU('toolu_cp2', 'PowerShell', { command: 'claude.exe --print "두 번째" --output-format json' })),
    R(M, 34, 'toolu_cp2', `{"type":"result","session_id":"${IDS.childStdout}","result":"ok"}`, { stdout: `{"type":"result","session_id":"${IDS.childStdout}"}`, stderr: '' }),
    // claude -p (휴리스틱)
    A(M, 40, TU('toolu_cp3', 'Bash', { command: 'cd "C:\\scratch\\probe" && claude -p "휴리스틱 프롬프트" | head' })),
    R(M, 45, 'toolu_cp3', 'done', { stdout: 'done', stderr: '' }),
    // bg 완료 알림
    U(M, 50, `<task-notification>\n<task-id>bgtask001</task-id>\n<tool-use-id>toolu_bg1</tool-use-id>\n<output-file>${bgOut}</output-file>\n<status>completed</status>\n<summary>Background command &quot;개발 서버&quot; completed (exit code 0)</summary>\n</task-notification>`, { origin: { kind: 'task-notification' } }),
    // agent1 완료 알림
    { type: 'attachment', timestamp: T(51.9), ...base(M), attachment: { type: 'queued_command', prompt: `<task-notification>
<task-id>agentaaa1</task-id>
<status>completed</status>
<summary>Agent done</summary>
<result>조사 결과 요약 &amp; 정리</result>
</task-notification>` } },
    U(M, 52, '<task-notification>\n<task-id>agentaaa1</task-id>\n<status>completed</status>\n<summary>Agent done</summary>\n<result>조사 결과 요약 &amp; 정리</result>\n</task-notification>', { origin: { kind: 'task-notification' } }),
    // 워크플로 완료 알림
    U(M, 54, '<task-notification>\n<task-id>wftask01</task-id>\n<status>completed</status>\n<summary>Workflow done</summary>\n</task-notification>', { origin: { kind: 'task-notification' } }),
    A(M, 55, TU('toolu_skill1', 'Skill', { skill: 'writing-style' })),
    R(M, 56, 'toolu_skill1', 'Launching skill', { success: true, commandName: 'writing-style' }),
    U(M, 56.5, [{ type: 'text', text: 'skill body' }], { isMeta: true }),
    A(M, 57, { type: 'text', text: '스킬 적용 중' }, { attributionSkill: 'writing-style' }),
    A(M, 58, TU('toolu_mcp1', 'mcp__demo__lookup', { q: 1 })),
    R(M, 59, 'toolu_mcp1', 'err', {}, { is_error: true }),
    { type: 'system', subtype: 'turn_duration', durationMs: 1000, timestamp: T(60), ...base(M) },
  ]);

  // 서브에이전트
  const sub = path.join(proj, M, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-agentaaa1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: '자료 조사', toolUseId: 'toolu_agent1', spawnDepth: 1, requestShape: 'background' }));
  write(path.join(sub, 'agent-agentaaa1.jsonl'), [
    U(M, 7.1, '자료를 조사하라', { isSidechain: true, agentId: 'agentaaa1' }),
    A(M, 7.2, TU('toolu_grand1', 'Agent', { description: '손자 작업' }), { isSidechain: true, agentId: 'agentaaa1' }),
    R(M, 7.3, 'toolu_grand1', 'launched', { isAsync: true, status: 'async_launched', agentId: 'agentccc3' }, { isSidechain: true, agentId: 'agentaaa1' }),
    A(M, 7.4, { type: 'text', text: '조사 중' }, { isSidechain: true, agentId: 'agentaaa1' }),
  ]);
  fs.writeFileSync(path.join(sub, 'agent-agentbbb2.meta.json'), JSON.stringify({ agentType: 'Explore', description: '빠른 확인', toolUseId: 'toolu_agent2', spawnDepth: 1, requestShape: 'foreground', finished: true }));
  write(path.join(sub, 'agent-agentbbb2.jsonl'), [A(M, 8.5, { type: 'text', text: '확인' }, { isSidechain: true, agentId: 'agentbbb2' })]);
  // 손자: 부모 transcript(agentaaa1) 의 tool_use 로 연결 — 메인보다 먼저 정렬되도록 이름을 앞에 둔다
  fs.writeFileSync(path.join(sub, 'agent-agentccc3.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: '손자 작업', toolUseId: 'toolu_grand1', spawnDepth: 2, requestShape: 'background' }));
  write(path.join(sub, 'agent-agentccc3.jsonl'), [A(M, 7.5, { type: 'text', text: '손자 시작' }, { isSidechain: true, agentId: 'agentccc3' })]);
  // fork: toolUseId 미상, parentAgentId 로 연결
  fs.writeFileSync(path.join(sub, 'agent-agentddd4.meta.json'), JSON.stringify({ agentType: 'fork', description: '포크', toolUseId: 'toolu_unknown_x', spawnDepth: 2, isFork: true, parentAgentId: 'agentaaa1' }));
  // 연결 실패(unlinked): toolUseId 미상, parentAgentId 없음 → 루트
  fs.writeFileSync(path.join(sub, 'agent-agenteee5.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: '고아', toolUseId: 'toolu_nowhere', spawnDepth: 1 }));

  // 워크플로
  const wf = path.join(sub, 'workflows', 'wf_test-001');
  fs.mkdirSync(wf, { recursive: true });
  write(path.join(wf, 'journal.jsonl'), [
    { type: 'launched' },
    { type: 'started', key: 'v2:a', agentId: 'wfagent01', label: 'design:x', phase: 'Design' },
    { type: 'result', key: 'v2:a', agentId: 'wfagent01', result: { summary: '설계 완료' } },
    { type: 'started', key: 'v2:b', agentId: 'wfagent02', label: 'build:y', phase: 'Build' },
    { type: 'mystery', foo: 1 },
  ]);
  fs.writeFileSync(path.join(wf, 'agent-wfagent01.meta.json'), JSON.stringify({ agentType: 'workflow-subagent', description: 'design:x', workflowPhase: 'Design', spawnDepth: 1 }));
  write(path.join(wf, 'agent-wfagent01.jsonl'), [A(M, 12, { type: 'text', text: '설계' }, { isSidechain: true, agentId: 'wfagent01' })]);
  const bgwf = path.join(tasks, 'bgwf0002.output');
  fs.writeFileSync(bgwf, 'wf bg out\n');
  // 워크플로 에이전트 transcript 에는 toolUseResult 가 없다(실측) → 본문으로 추정
  const noTur = (sec, id, text) => ({ type: 'user', timestamp: T(sec), ...base(M, { isSidechain: true, agentId: 'wfagent02' }), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
  write(path.join(wf, 'agent-wfagent02.jsonl'), [
    A(M, 13, TU('toolu_wfa2_bash', 'Bash', { command: 'ls' }), { isSidechain: true, agentId: 'wfagent02' }),
    A(M, 14, TU('toolu_wfa2_bg', 'Bash', { command: 'node server.mjs', description: 'wf 서버', run_in_background: true }), { isSidechain: true, agentId: 'wfagent02' }),
    noTur(14.5, 'toolu_wfa2_bg', `Command running in background with ID: bgwf0002. Output is being written to: ${bgwf}`),
    A(M, 15, TU('toolu_wfa2_mon', 'Monitor', { description: 'wf 감시' }), { isSidechain: true, agentId: 'wfagent02' }),
    noTur(15.5, 'toolu_wfa2_mon', 'Monitor started (task monwf003, expires in 30m unless the source ends first)'),
    A(M, 16, TU('toolu_wfa2_grep', 'Bash', { command: 'grep x' }), { isSidechain: true, agentId: 'wfagent02' }),
    noTur(16.5, 'toolu_wfa2_grep', 'match: "Command running in background with ID: fake0001. Output is being written to: x.output"'),
    { type: 'attachment', timestamp: T(17), ...base(M, { isSidechain: true, agentId: 'wfagent02' }), attachment: { type: 'queued_command', prompt: `<task-notification>
<task-id>bgwf0002</task-id>
<status>failed</status>
<summary>Background command &quot;wf 서버&quot; failed with exit code 1</summary>
</task-notification>` } },
  ]);

  // claude -p 자식들 (부모 정보 없음, entrypoint sdk-cli)
  const sdk = (sid, sec, prompt) => [
    { type: 'queue-operation', operation: 'enqueue', timestamp: T(sec - 0.5), sessionId: sid, content: prompt },
    { type: 'user', timestamp: T(sec), sessionId: sid, cwd: childCwd, entrypoint: 'sdk-cli', promptSource: 'sdk', message: { role: 'user', content: prompt } },
    { type: 'assistant', timestamp: T(sec + 1), sessionId: sid, cwd: childCwd, entrypoint: 'sdk-cli', message: { model: 'claude-test-1', content: [{ type: 'text', text: 'hi' }] } },
    { type: 'system', subtype: 'turn_duration', timestamp: T(sec + 2), sessionId: sid, entrypoint: 'sdk-cli' },
  ];
  write(path.join(childProj, `${IDS.childHint}.jsonl`), [
    ...sdk(IDS.childHint, 21, 'say hi'),
    { type: 'assistant', timestamp: T(23.5), sessionId: IDS.childHint, cwd: childCwd, entrypoint: 'sdk-cli', message: { content: [TU('toolu_child_agent', 'Agent', { description: '자식의 서브에이전트' })] } },
    { type: 'user', timestamp: T(23.6), sessionId: IDS.childHint, cwd: childCwd, entrypoint: 'sdk-cli', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_child_agent', content: 'launched' }] }, toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'childagent1' } },
  ]);
  const csub = path.join(childProj, IDS.childHint, 'subagents');
  fs.mkdirSync(csub, { recursive: true });
  fs.writeFileSync(path.join(csub, 'agent-childagent1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: '자식의 서브에이전트', toolUseId: 'toolu_child_agent', spawnDepth: 1 }));
  write(path.join(csub, 'agent-childagent1.jsonl'), [A(IDS.childHint, 23.7, { type: 'text', text: '깊은 곳' }, { isSidechain: true, agentId: 'childagent1' })]);
  write(path.join(childProj, `${IDS.childStdout}.jsonl`), sdk(IDS.childStdout, 31, '두 번째'));
  write(path.join(childProj, `${IDS.childHeur}.jsonl`), sdk(IDS.childHeur, 41, '휴리스틱 프롬프트'));
  write(path.join(childProj, `${IDS.stray}.jsonl`), sdk(IDS.stray, 500, '아무도 부르지 않음'));
  // 자식 파일은 10초 넘게 변화 없음(종료 판정용)
  const quiet = (now - 300_000) / 1000;
  for (const sid of [IDS.childHint, IDS.childStdout, IDS.childHeur]) fs.utimesSync(path.join(childProj, `${sid}.jsonl`), quiet, quiet);
  // 다른 cli 세션
  write(path.join(proj, `${IDS.other}.jsonl`), [U(IDS.other, 0, '옛 세션', { origin: { kind: 'human' } })]);
  const old = (now - 3600_000) / 1000;
  fs.utimesSync(path.join(proj, `${IDS.other}.jsonl`), old, old);

  // 살아 있는 세션 표시 + 읽으면 안 되는 .key
  fs.writeFileSync(path.join(sessions, '1234.json'), JSON.stringify({ pid: 1234, sessionId: M, status: 'busy', entrypoint: 'cli' }));
  fs.writeFileSync(path.join(sessions, '1234.key'), JSON.stringify({ sessionId: '77777777-7777-4777-8777-777777777777', status: 'busy' }));

  return { root, projects, sessions, tmpClaude, proj, childProj, tasks, mainFile: path.join(proj, `${M}.jsonl`), T, base, A, TU, R, U, write, bgOut, monOut, cwd };
}

export function rmFixture(fx) {
  try { fs.rmSync(fx.root, { recursive: true, force: true }); } catch {}
}
