// ?mock=1 의 특별 상호작용 시나리오. 서버 분류기(server/interactions.mjs)가 같은 명령에 내는 ix 를 그대로 옮겨 적었다.
// MockGenerator 가 ix:true 일 때 부른다(자기 난수열을 따로 써서 기존 시나리오 순서는 그대로).
const SC = [
  { tool: 'Bash', text: 'git commit && git push origin main', dur: 1800,
    start: { cat: 'github', op: 'push', remote: 'origin', branch: 'main', commitsHere: 1 },
    end: { cat: 'github', op: 'push', remote: 'origin', branch: 'main', repo: 'viz', commits: 3, range: 1, ok: true } },
  { tool: 'Bash', text: 'npm test', dur: 2600,
    start: { cat: 'tests', op: 'run', runner: 'npm' },
    end: { cat: 'tests', op: 'run', runner: 'node', total: 238, pass: 238, fail: 0, skip: 0, suites: 41, ms: 5210, ok: true } },
  { tool: 'Bash', text: 'ssh devbox "uptime"', dur: 2400,
    start: { cat: 'remote', op: 'ssh', host: 'devbox' }, end: { cat: 'remote', op: 'ssh', host: 'devbox', ok: true } },
  { tool: 'Bash', text: 'mongosh appdb --eval "db.cases.countDocuments()"', dur: 1500,
    start: { cat: 'db', op: 'query', engine: 'mongo', db: 'appdb', rw: 'r' }, end: { cat: 'db', op: 'query', engine: 'mongo', db: 'appdb', rw: 'r', rows: 4821, ok: true } },
  { tool: 'Bash', text: 'gh pr create --title "흐름 연출"', dur: 1600,
    start: { cat: 'github', op: 'pr-create', sub: 'create' }, end: { cat: 'github', op: 'pr-create', sub: 'create', pr: 58, ok: true } },
  { tool: 'Bash', text: 'python -m pytest -q', dur: 3000,
    start: { cat: 'tests', op: 'run', runner: 'pytest' }, end: { cat: 'tests', op: 'run', runner: 'pytest', pass: 120, fail: 2, skip: 3, total: 125, ms: 4560, ok: false } },
  { tool: 'Bash', text: 'for i in $(seq 1 40); do node build.mjs --page $i; done', dur: 6000, steps: 8,
    start: { cat: 'batch', op: 'loop', n: 40 }, end: { cat: 'batch', op: 'loop', n: 40, i: 40, ok: true } },
  { tool: 'Bash', text: 'gh pr checks 58 --watch', dur: 4200,
    start: { cat: 'github', op: 'pr-checks', pr: 58, watch: 1 }, end: { cat: 'github', op: 'pr-checks', pr: 58, ci: { pass: 3, fail: 1, pending: 0, skip: 0 }, ok: false } },
  { tool: 'Bash', text: 'scp dist.zip devbox:/srv/www/', dur: 2600,
    start: { cat: 'remote', op: 'scp', host: 'devbox', transfer: 'up' }, end: { cat: 'remote', op: 'scp', host: 'devbox', transfer: 'up', bytes: 12_400_000, ok: true } },
  { tool: 'Bash', text: 'psql -d shop -c "UPDATE orders SET checked = true"', dur: 1300,
    start: { cat: 'db', op: 'query', engine: 'postgres', db: 'shop', rw: 'w' }, end: { cat: 'db', op: 'query', engine: 'postgres', db: 'shop', rw: 'w', rows: 99, ok: true } },
  { tool: 'Bash', text: 'node --test (백그라운드)', dur: 500, stream: 24,
    start: { cat: 'tests', op: 'run', runner: 'node', bg: 1 }, end: { cat: 'tests', op: 'run', runner: 'node', bg: 1, phase: 'progress' } },
  { tool: 'Bash', text: 'git pull --ff-only origin main', dur: 1500,
    start: { cat: 'github', op: 'pull', remote: 'origin', branch: 'main' }, end: { cat: 'github', op: 'pull', remote: 'origin', branch: 'main', files: 5, ok: true } },
  { tool: 'Bash', text: 'gh pr merge 58 --squash', dur: 1500,
    start: { cat: 'github', op: 'pr-merge', pr: 58 }, end: { cat: 'github', op: 'pr-merge', pr: 58, merged: 1, ok: true } },
  { tool: 'Agent', text: '동시 분기', fan: 5 },
  { user: 'turn' },   // 사용자 → 메인 → 답변
  { user: 'ask' },    // AskUserQuestion → 선택
  { user: 'mid' },    // 턴 중 끼어듦 · 자동 알림 · 거부
];

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const IX = (o, phase) => ({ v: 1, ...o, phase: o.phase || phase });

/** gen = MockGenerator. 첫 시나리오 6초 뒤, 그다음 5～9초마다 하나씩(살아 있는 에이전트 중 하나) */
export function ixMockScript(gen, { first = 6000 } = {}) {
  const r = rng(6868);
  let k = 0;
  const tick = (out) => {
    const alive = [...gen.nodes.values()].filter((n) => (n.status === 'active' || n.status === 'idle') && (n.kind === 'main' || n.kind === 'subagent'));
    if (alive.length) playOne(gen, out, SC[k++ % SC.length], alive[Math.floor(r() * alive.length)].id);
    gen.at(5000 + r() * 4000, tick);
  };
  gen.at(first, tick);
}

const U = (o) => ({ v: 1, cat: 'user', phase: 'end', ...o });
function playUser(gen, out, s, M) {
  const say = (o, ix, text) => gen.emit(o, { type: 'user', nodeId: M, origin: 'human', text, ix: U({ ...ix, text }) });
  if (s.user === 'turn') {
    say(out, { op: 'prompt', waitMs: 95000 }, '홀로그램 패널 글자 크기 조금 키워 줘');
    gen.at(5200, (o) => gen.emit(o, { type: 'node-update', nodeId: M, patch: {}, ix: U({ op: 'reply', text: '패널 글자를 12px 로 키웠습니다.', turnMs: 5200 }) }));
  } else if (s.user === 'ask') {
    const toolUseId = gen.tuid();
    gen.emit(out, { type: 'tool-start', nodeId: M, toolUseId, tool: 'AskUserQuestion', cat: 'other', skill: null, text: '어느 쪽으로 할까요?', brief: '어느 쪽으로 할까요?', ix: { v: 1, cat: 'user', op: 'ask', q: 1, opts: 3, text: '배치를 어느 쪽으로 할까요?', phase: 'start' } });
    gen.at(3200, (o) => gen.emit(o, { type: 'tool-end', nodeId: M, toolUseId, tool: 'AskUserQuestion', cat: 'other', ok: true, durationMs: 3200, text: '답함', brief: '답함', ix: U({ op: 'ask', q: 1, opts: 3, pick: 1, answer: '가로로 넓게', ok: true }) }));
  } else {
    gen.emit(out, { type: 'user', nodeId: M, origin: 'task-notification', text: 'Background command completed', ix: U({ op: 'auto', src: 'notify' }) });
    gen.at(900, (o) => say(o, { op: 'midturn' }, '아, 라이트 테마도 같이 봐 줘'));
    gen.at(2600, (o) => gen.emit(o, { type: 'user', nodeId: M, origin: 'human', text: '[Request interrupted by user]', ix: U({ op: 'interrupt', ok: false }) }));
  }
}

function playOne(gen, out, s, nodeId) {
  if (s.user) { const m = [...gen.nodes.values()].find((n) => n.kind === 'main'); if (m) playUser(gen, out, s, m.id); return; }
  if (s.fan) {
    for (let i = 1; i <= s.fan; i++) gen.at(i * 220, (o) => {
      const toolUseId = gen.tuid();
      gen.emit(o, { type: 'tool-start', nodeId, toolUseId, tool: 'Agent', cat: 'agent', skill: null, text: `분기 ${i}`, brief: `분기 ${i}`, ...(i >= 4 ? { ix: IX({ cat: 'batch', op: 'fan', i }, 'progress') } : {}) });
      gen.at(1500 + i * 100, (o2) => gen.emit(o2, { type: 'tool-end', nodeId, toolUseId, tool: 'Agent', cat: 'agent', ok: true, durationMs: 1500, text: '완료', brief: '완료' }));
    });
    return;
  }
  const toolUseId = gen.tuid();
  gen.emit(out, { type: 'tool-start', nodeId, toolUseId, tool: s.tool, cat: 'shell', skill: null, text: s.text, brief: s.text, ix: IX(s.start, 'start') });
  if (s.steps) for (let j = 1; j < s.steps; j++) gen.at((s.dur * j) / s.steps, (o) => { const n = gen.nodes.get(nodeId); if (n && n.openTools.some((x) => x.toolUseId === toolUseId)) gen.emit(o, { type: 'output', nodeId, text: `[${Math.round((s.start.n * j) / s.steps)}/${s.start.n}]`, ix: IX({ ...s.start, i: Math.round((s.start.n * j) / s.steps), ref: toolUseId }, 'progress') }); });
  gen.at(s.dur, (o) => {
    const n = gen.nodes.get(nodeId);
    if (!n || !n.openTools.some((x) => x.toolUseId === toolUseId)) return;
    const ok = s.end.ok !== false;
    gen.emit(o, { type: 'tool-end', nodeId, toolUseId, tool: s.tool, cat: 'shell', ok: ok || !!s.stream, durationMs: s.dur, text: ok ? 'exit 0' : 'exit 1', brief: ok ? 'exit 0' : 'exit 1', ix: IX(s.end, 'end') });
    if (s.stream) { // 백그라운드 출력: 3줄마다 진행, 끝에 요약 → 끝
      let pass = 0, fail = 0;
      const N = s.stream;
      for (let i = 1; i <= N; i += 3) gen.at(400 + i * 140, (o2) => {
        for (let j = i; j < i + 3 && j <= N; j++) { if (j === N - 1) fail++; else pass++; }
        gen.emit(o2, { type: 'output', nodeId, text: '✔ …', ix: IX({ ...s.start, pass, fail, skip: 0, partial: 1, ref: toolUseId }, 'progress') });
      });
      gen.at(600 + N * 140 + 400, (o2) => gen.emit(o2, { type: 'output', nodeId, text: `ℹ tests ${N}`, ix: IX({ ...s.start, total: N, pass: N - 1, fail: 1, skip: 0, ms: 3120, ok: false, ref: toolUseId }, 'end') }));
    }
  });
}
