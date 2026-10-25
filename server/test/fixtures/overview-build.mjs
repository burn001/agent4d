// 3차: 전체 보기 합성 fixture (실제 transcript 를 복사하지 않는다)
// 프로젝트 3개 + 임시 폴더 자식 + 독립 sdk-cli + 죽은 pid 세션. live pid 는 이 테스트 프로세스 pid 를 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const OV = {
  a1: 'a1a1a1a1-0000-4000-8000-0000000000a1', // Projects\2026 live busy (claude -p 자식 child 있음)
  aOld: 'a0a0a0a0-0000-4000-8000-0000000000a0', // Projects\2026 recent(30분 전), live 아님
  child: 'c1c1c1c1-0000-4000-8000-0000000000c1', // a1 의 claude -p 자식(임시 폴더 cwd), live sdk-cli
  b1: 'b1b1b1b1-0000-4000-8000-0000000000b1', // demo_api live idle
  orphan: 'd0d0d0d0-0000-4000-8000-0000000000d0', // demo_api 독립 sdk-cli (나중에 b1 이 매칭)
  k1: 'e1e1e1e1-0000-4000-8000-0000000000e1', // 한글 폴더 프로젝트, live
  dead: 'f0f0f0f0-0000-4000-8000-0000000000f0', // pid 파일은 있으나 죽은 pid
};

export const CWD = {
  works: 'D:\\work\\Projects\\2026',
  appdb: 'D:\\DEV_REPOS\\demo_api',
  korean: 'D:\\Cloud\\팀\\과제\\2026\\Research',
  temp: 'C:\\Users\\X\\AppData\\Local\\Temp\\claude\\D--x\\s1\\scratchpad\\probe',
  dead: 'D:\\old\\dead-project',
};

export const enc = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');

/** 죽었다고 볼 수 있는 pid(살아 있지 않은 큰 수) */
function deadPid() {
  for (let p = 4_000_001; p < 4_000_200; p += 7) {
    try { process.kill(p, 0); } catch (e) { if (e.code === 'ESRCH') return p; }
  }
  return 4_000_001;
}

export function makeOverviewFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-ov-'));
  const projects = path.join(root, 'projects');
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const now = Date.now();
  const T = (sec) => new Date(now - 300_000 + sec * 1000).toISOString();
  const pdir = (cwd) => { const d = path.join(projects, enc(cwd)); fs.mkdirSync(d, { recursive: true }); return d; };
  const write = (file, recs) => fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const U = (sid, cwd, sec, content, ep = 'cli') => ({ type: 'user', timestamp: T(sec), sessionId: sid, cwd, version: '2.1.309', entrypoint: ep, origin: { kind: 'human' }, message: { role: 'user', content } });
  const A = (sid, cwd, sec, block, ep = 'cli') => ({ type: 'assistant', timestamp: T(sec), sessionId: sid, cwd, version: '2.1.309', entrypoint: ep, message: { model: 'claude-test-1', role: 'assistant', content: [block] } });
  const R = (sid, cwd, sec, id, content, tur, ep = 'cli') => ({ type: 'user', timestamp: T(sec), sessionId: sid, cwd, version: '2.1.309', entrypoint: ep, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] }, toolUseResult: tur });
  const TU = (id, name, input) => ({ type: 'tool_use', id, name, input });

  const works = pdir(CWD.works), appdb = pdir(CWD.appdb), korean = pdir(CWD.korean), temp = pdir(CWD.temp), deadP = pdir(CWD.dead);
  // a1: 서브에이전트 1 + claude -p 자식(--session-id 힌트)
  write(path.join(works, `${OV.a1}.jsonl`), [
    U(OV.a1, CWD.works, 1, '전체 보기를 만들어 주세요'),
    { type: 'ai-title', aiTitle: '전체 보기 작업', sessionId: OV.a1 },
    A(OV.a1, CWD.works, 2, { type: 'text', text: '시작합니다' }),
    A(OV.a1, CWD.works, 3, TU('toolu_a1_agent', 'Agent', { description: '조사' })),
    R(OV.a1, CWD.works, 4, 'toolu_a1_agent', 'launched', { isAsync: true, status: 'async_launched', agentId: 'agenta1x' }),
    A(OV.a1, CWD.works, 5, TU('toolu_a1_cp', 'Bash', { command: `claude -p "probe" --session-id ${OV.child}`, description: 'claude -p' })),
  ]);
  const sub = path.join(works, OV.a1, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-agenta1x.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: '조사', toolUseId: 'toolu_a1_agent', spawnDepth: 1 }));
  write(path.join(sub, 'agent-agenta1x.jsonl'), [A(OV.a1, CWD.works, 4.5, { type: 'text', text: '조사 중' })]);
  write(path.join(temp, `${OV.child}.jsonl`), [
    U(OV.child, CWD.temp, 6, 'probe', 'sdk-cli'),
    A(OV.child, CWD.temp, 7, { type: 'text', text: 'hi' }, 'sdk-cli'),
  ]);
  // aOld: 30분 전에 끝난 세션
  write(path.join(works, `${OV.aOld}.jsonl`), [U(OV.aOld, CWD.works, 0, '지난 작업'), { type: 'custom-title', customTitle: '지난 작업 세션', sessionId: OV.aOld }]);
  const t30 = (now - 30 * 60_000) / 1000;
  fs.utimesSync(path.join(works, `${OV.aOld}.jsonl`), t30, t30);
  // b1 + 독립 sdk-cli orphan
  const b1File = path.join(appdb, `${OV.b1}.jsonl`);
  write(b1File, [U(OV.b1, CWD.appdb, 1, 'API 점검'), A(OV.b1, CWD.appdb, 2, { type: 'text', text: '점검 중' }), { type: 'system', subtype: 'turn_duration', timestamp: T(3), sessionId: OV.b1, entrypoint: 'cli' }]);
  write(path.join(appdb, `${OV.orphan}.jsonl`), [U(OV.orphan, CWD.appdb, 10, '독립 요약', 'sdk-cli'), A(OV.orphan, CWD.appdb, 11, { type: 'text', text: '요약 중' }, 'sdk-cli')]);
  // 한글 폴더 프로젝트(인코딩은 전부 '-')
  write(path.join(korean, `${OV.k1}.jsonl`), [U(OV.k1, CWD.korean, 1, '한글 폴더 작업'), A(OV.k1, CWD.korean, 2, { type: 'text', text: '진행' })]);
  // 죽은 pid 세션
  write(path.join(deadP, `${OV.dead}.jsonl`), [U(OV.dead, CWD.dead, 0, '죽은 세션')]);
  const old = (now - 40 * 86400_000) / 1000;
  fs.utimesSync(path.join(deadP, `${OV.dead}.jsonl`), old, old);

  const pid = process.pid;
  const pf = (n, o) => fs.writeFileSync(path.join(sessions, `${n}.json`), JSON.stringify(o));
  pf(101, { pid, sessionId: OV.a1, cwd: CWD.works, status: 'busy', entrypoint: 'cli', kind: 'interactive' });
  pf(102, { pid, sessionId: OV.child, cwd: CWD.temp, status: 'busy', entrypoint: 'sdk-cli', kind: 'interactive' });
  pf(103, { pid, sessionId: OV.b1, cwd: CWD.appdb, status: 'idle', entrypoint: 'cli', kind: 'interactive' });
  pf(104, { pid, sessionId: OV.orphan, cwd: CWD.appdb, status: 'busy', entrypoint: 'sdk-cli', kind: 'interactive' });
  pf(105, { pid, sessionId: OV.k1, cwd: CWD.korean, status: 'idle', entrypoint: 'cli', kind: 'interactive' });
  pf(106, { pid: deadPid(), sessionId: OV.dead, cwd: CWD.dead, status: 'busy', entrypoint: 'cli', kind: 'interactive' });
  fs.writeFileSync(path.join(sessions, '101.key'), 'never-read');

  /** b1 이 독립 sdk-cli 를 claude -p 로 실행한 기록을 덧붙인다(→ 매칭 → remove·add) */
  const matchOrphan = () => {
    fs.appendFileSync(b1File, JSON.stringify(A(OV.b1, CWD.appdb, 9, TU('toolu_b1_cp', 'Bash', { command: `claude -p "독립 요약" --session-id ${OV.orphan}`, description: '요약 실행' }))) + '\n');
  };
  const rm = () => fs.rmSync(root, { recursive: true, force: true });
  return { root, projects, sessions, matchOrphan, rm, b1File, T, A, write };
}
