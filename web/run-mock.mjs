// 실행 중 셸(meta.run) 가짜 시나리오 — 서버 없이(`?mock=1`) 세 표현·2D·인스펙터·카메라를 확인한다.
// 서버와 약속한 모양: 전경 = 셸 도구가 열린 노드의 meta.run {kind:'fg', tool, since, lastOut, staleAfter, buffered}(도구가 끝나면 null),
// 백그라운드 = bash-bg 노드의 meta.run {kind:'bg', since, lastOut, staleAfter, buffered, rc?, ended?}. 시각은 ms 수.
// 박동 이벤트는 없다(경과·조용함·정체는 웹이 시계로 계산) — 그래서 여기서도 출력이 있을 때만 lastOut 을 갱신한다.
// 시작 시각을 과거로 잡아(이미 4분·2분·20분 돈 것처럼) 첫 화면부터 긴 실행이 보이게 한다. 난수 없음(다른 시나리오 순서 그대로).

const MIN = 60_000;

export function runMockScript(gen) {
  const M = gen.root;
  const now = () => gen.t0 + gen.t;
  const setRun = (o, id, run) => gen.emit(o, { type: 'node-update', nodeId: id, patch: { meta: { run } } });
  const P = (title, lines, ref) => ({ v: 1, mode: 'shell', part: 'tail', title, lines, marks: lines.map((l) => (/Traceback|Error:/.test(l) ? 'e' : 'o')).join(''), ...(ref ? { ref } : {}) });

  // ① 전경 python 4분째 · 출력 없음(버퍼링 추정) — 서브에이전트가 Bash 하나를 오래 붙잡고 있음
  const A1 = 'a:demo-run-fg1';
  const fg1 = (o) => {
    if (!gen.nodes.has(A1)) gen.addNode(o, { id: A1, parentId: M, kind: 'subagent', label: '색인 다시 만들기', meta: { agentType: 'general-purpose', background: false } });
    const tu = gen.tuid();
    const cmd = 'python scripts/build_index.py --all';
    gen.emit(o, { type: 'tool-start', nodeId: A1, toolUseId: tu, tool: 'Bash', cat: 'shell', skill: null, text: cmd, brief: cmd, detail: cmd,
      panel: { v: 1, mode: 'shell', part: 'input', title: '$ ' + cmd, lines: [], marks: '' } });
    const run = { kind: 'fg', tool: 'Bash', since: now() - 4 * MIN, lastOut: null, staleAfter: 15 * MIN, buffered: true };
    setRun(o, A1, run);
    gen.at(6 * MIN, (o2) => { // 끝: 한꺼번에 출력(버퍼가 비워짐) → 도구 끝 → meta.run null → 잠시 뒤 다시
      gen.emit(o2, { type: 'tool-end', nodeId: A1, toolUseId: tu, tool: 'Bash', cat: 'shell', ok: true, durationMs: 10 * MIN, text: 'exit 0', brief: 'indexed 48,211 docs · exit 0' });
      setRun(o2, A1, null);
      gen.at(8000, fg1);
    });
  };
  gen.at(1500, fg1);

  // ② 전경 node 2분째 · 출력 있음(5초마다 한 줄)
  const A2 = 'a:demo-run-fg2';
  gen.at(2500, (o) => {
    gen.addNode(o, { id: A2, parentId: M, kind: 'subagent', label: '데이터 이관', meta: { agentType: 'general-purpose', background: false } });
    const tu = gen.tuid();
    const cmd = 'node scripts/migrate.mjs --batch 500';
    const lines = [];
    gen.emit(o, { type: 'tool-start', nodeId: A2, toolUseId: tu, tool: 'Bash', cat: 'shell', skill: null, text: cmd, brief: cmd, detail: cmd,
      panel: { v: 1, mode: 'shell', part: 'input', title: '$ ' + cmd, lines: [], marks: '' } });
    const run = { kind: 'fg', tool: 'Bash', since: now() - 2 * MIN, lastOut: now() - 4000, staleAfter: 10 * MIN, buffered: false };
    setRun(o, A2, run);
    let k = 120;
    const tick = (o2) => {
      if (!gen.alive(A2)) return;
      k++;
      lines.push(`[migrate] batch ${k} · rows ${(k * 500).toLocaleString('en-US')} · 0 errors`);
      if (lines.length > 12) lines.shift();
      gen.emit(o2, { type: 'output', nodeId: A2, text: lines[lines.length - 1] + '\n', panel: P('$ ' + cmd, lines.slice(), { nodeId: A2, toolUseId: tu }) });
      setRun(o2, A2, { ...run, lastOut: now() });
      // 서버: 전경 셸 진행 줄 → 자동 작업 j:fg:<toolUseId>:progress(부모 = 셸을 연 노드) — Planet 계기·흐름 작업 칩
      const jid = `j:fg:${tu}:progress`;
      const job = { v: 1, id: 'progress', title: '진행', state: 'running', phase: 'batch', progress: { n: k, total: 400 }, host: null, until: null, rc: null,
        beatAt: gen.iso(), staleSec: 300, stale: false, line: lines[lines.length - 1], src: 'auto', startedAt: gen.iso(), endedAt: null,
        lanes: [{ key: 'batch', n: k, total: 400, unit: null, rate: 0.2, last: null, pass: 1, at: gen.iso(), elapsed: null, heat: 0 }], primary: 'batch', rate: 0.2,
        eta: new Date(now() + ((400 - k) / 0.2) * 1000).toISOString(), heat: 0 };
      if (!gen.nodes.has(jid)) gen.addNode(o2, { id: jid, parentId: A2, kind: 'bash-bg', label: '진행', meta: { job, title: job.phase, background: true, jobOwner: A2 } });
      else gen.emit(o2, { type: 'node-update', nodeId: jid, patch: { meta: { job: { ...job, startedAt: gen.nodes.get(jid).meta.job.startedAt } } } });
      gen.at(5000, tick);
    };
    gen.at(1000, tick);
  });

  // ③ 백그라운드 python 20분째 · 3분째 조용함 → staleAfter(2분) 넘어 정체(서버는 정체 판정 뒤 idle)
  const B1 = 'b:demo-run-bg1';
  gen.at(3200, (o) => {
    const tu = gen.tuid();
    const cmd = 'python train.py --epochs 40';
    gen.emit(o, { type: 'tool-start', nodeId: M, toolUseId: tu, tool: 'Bash', cat: 'shell', skill: null, text: cmd + ' &' });
    gen.emit(o, { type: 'tool-end', nodeId: M, toolUseId: tu, tool: 'Bash', cat: 'shell', ok: true, durationMs: 60, text: '백그라운드 실행' });
    gen.addNode(o, { id: B1, parentId: M, kind: 'bash-bg', label: 'python train.py', status: 'idle',
      meta: { command: cmd, toolUseId: tu, run: { kind: 'bg', since: now() - 20 * MIN, lastOut: now() - 3 * MIN, staleAfter: 2 * MIN, buffered: false } } });
    gen.emit(o, { type: 'output', nodeId: B1, text: 'epoch 17/40 · loss 0.4121 · val 0.4388\nepoch 18/40 · loss 0.4097 · val 0.4391\n' });
  });

  // ④ 백그라운드 tqdm 진행(2초마다 한 줄)
  const B2 = 'b:demo-run-tqdm';
  gen.at(4000, (o) => {
    const tu = gen.tuid();
    const cmd = 'python embed.py --model bge-m3';
    gen.emit(o, { type: 'tool-start', nodeId: M, toolUseId: tu, tool: 'Bash', cat: 'shell', skill: null, text: cmd + ' &' });
    gen.emit(o, { type: 'tool-end', nodeId: M, toolUseId: tu, tool: 'Bash', cat: 'shell', ok: true, durationMs: 50, text: '백그라운드 실행' });
    const run = { kind: 'bg', since: now() - 6 * MIN, lastOut: now(), staleAfter: 5 * MIN, buffered: false };
    gen.addNode(o, { id: B2, parentId: M, kind: 'bash-bg', label: 'python embed.py', meta: { command: cmd, toolUseId: tu, run } });
    let n = 430;
    const tick = (o2) => {
      if (!gen.alive(B2)) return;
      n = Math.min(1000, n + 3);
      const pct = Math.floor(n / 10), bar = '█'.repeat(Math.floor(pct / 10)).padEnd(10, ' ');
      gen.emit(o2, { type: 'output', nodeId: B2, text: `embed: ${String(pct).padStart(3)}%|${bar}| ${n}/1000 [06:${String(n % 60).padStart(2, '0')}<08:00, 1.19it/s]\n` });
      setRun(o2, B2, { ...run, lastOut: now() });
      if (n >= 1000) { gen.at(1500, (o3) => { setRun(o3, B2, { ...run, lastOut: now(), rc: 0, ended: now() }); gen.setStatus(o3, B2, 'done'); }); return; }
      gen.at(2000, tick);
    };
    gen.at(800, tick);
  });

  // ⑤ 백그라운드가 rc 1 로 끝남(70초마다 새로)
  let fails = 0;
  const failRun = (o) => {
    const id = `b:demo-run-fail${++fails}`;
    const tu = gen.tuid();
    const cmd = 'python check_links.py docs/';
    gen.emit(o, { type: 'tool-start', nodeId: M, toolUseId: tu, tool: 'Bash', cat: 'shell', skill: null, text: cmd + ' &' });
    gen.emit(o, { type: 'tool-end', nodeId: M, toolUseId: tu, tool: 'Bash', cat: 'shell', ok: true, durationMs: 40, text: '백그라운드 실행' });
    const run = { kind: 'bg', since: now() - 90_000, lastOut: now(), staleAfter: 5 * MIN, buffered: false };
    gen.addNode(o, { id, parentId: M, kind: 'bash-bg', label: 'python check_links.py', meta: { command: cmd, toolUseId: tu, run } });
    gen.emit(o, { type: 'output', nodeId: id, text: 'checking 412 links…\n' });
    gen.at(6000, (o2) => { gen.emit(o2, { type: 'output', nodeId: id, text: 'Traceback (most recent call last):\nConnectionError: docs/api.md → 404\n' }); setRun(o2, id, { ...run, lastOut: now() }); });
    gen.at(9000, (o2) => { setRun(o2, id, { ...run, lastOut: now() - 3000, rc: 1, ended: now() }); gen.setStatus(o2, id, 'error'); });
    gen.at(70_000, failRun);
  };
  gen.at(5000, failRun);
}
