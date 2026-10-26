// 작업(Job) 노드 가짜 시나리오 — 서버 없이(`?mock=1`) 세 표현·2D·인스펙터를 확인한다.
// 서버(session.mjs _jobEmit)와 같은 모양: kind 'bash-bg', id `j:<주인>:<작업 id>`, meta.job · meta.title(단계) · meta.jobOwner.
// 난수 없음(정해진 시각표) — MockGenerator 의 다른 시나리오 순서를 바꾸지 않는다.

const PHASES = ['DAILY 1단계 시작', 'LAW_UPDATE 3단계 시작', 'LAW_UPDATE 5단계 완료', 'LAW_UPDATE 9-3단계 선행', 'LAW_UPDATE 9-6단계 완료', 'DAILY 2단계 완료'];

export function jobMockScript(gen) {
  const M = gen.root;
  const jobs = new Map(); // nodeId → job
  const emitJob = (out, ownerId, key, jobId, patch, { title = null } = {}) => {
    const id = `j:${key}:${jobId}`;
    const now = gen.iso();
    let job = jobs.get(id);
    const isNew = !job;
    if (isNew) job = { v: 1, id: jobId, title, state: 'running', phase: null, progress: null, host: null, until: null, rc: null, beatAt: now, staleSec: null, stale: false, line: null, src: 'protocol', startedAt: now, endedAt: null };
    const wasEnded = job.state === 'done' || job.state === 'failed';
    job = { ...job, beatAt: patch.stale ? job.beatAt : now, ...patch };
    if ((job.state === 'done' || job.state === 'failed') && !job.endedAt) job.endedAt = now;
    if (job.state !== 'done' && job.state !== 'failed') { job.endedAt = null; if (wasEnded && !('rc' in patch)) { job.rc = null; job.startedAt = now; } } // 되살리기(서버 와 같음)
    jobs.set(id, job);
    // 주인 출력에도 같은 줄(서버에선 이 줄이 작업을 만든다 — 홀로 꼬리 패널의 작업 줄 표시)
    if (patch.line && gen.nodes.has(ownerId)) gen.emit(out, { type: 'output', nodeId: ownerId, text: patch.line });
    const status = job.state === 'running' ? 'active' : job.state === 'done' ? 'done' : job.state === 'failed' ? 'error' : 'idle';
    if (isNew || !gen.nodes.has(id)) {
      gen.addNode(out, { id, parentId: ownerId, kind: 'bash-bg', label: job.title || jobId, meta: { job, title: job.phase, background: true, jobOwner: key } });
      if (status !== 'active') gen.emit(out, { type: 'node-update', nodeId: id, patch: { status, endedAt: job.endedAt } });
      return;
    }
    const n = gen.nodes.get(id);
    const p = { status, endedAt: job.endedAt, label: job.title || jobId, meta: { job, title: job.phase } };
    if (n.parentId !== ownerId) p.parentId = ownerId;
    gen.emit(out, { type: 'node-update', nodeId: id, patch: p });
  };
  const curMonitor = () => {
    let best = null;
    for (const n of gen.nodes.values()) if (n.kind === 'monitor' && n.label === '루프 상태 감시' && (n.status === 'active' || n.status === 'idle')) if (!best || n.startedAt > best.startedAt) best = n;
    return best;
  };

  // ① 재무장 Monitor 가 중계하는 일일 회차(대체 규칙 꼴): 단계 → 정체 → 끝 → 다시
  let round = 0;
  const roundTick = (o, step) => {
    const mon = curMonitor();
    if (!mon) { gen.at(1500, (o2) => roundTick(o2, step)); return; }
    const key = 'm:demo-rearm01';
    const title = '일일 회차 daily_update';
    if (step < PHASES.length) {
      if (step === 4 && round % 2 === 0) {
        // 박동 끊김: 마지막 박동을 40분 전으로 두고 명시 정체
        emitJob(o, mon.id, key, 'daily_update', { state: 'running', stale: true, beatAt: new Date(gen.t0 + gen.t - 40 * 60000).toISOString(), line: '[회차] ⚠생존 신호(heartbeat_at)가 40분째 끊겼다 — 마지막 21:22:00' }, { title });
        gen.at(9000, (o2) => roundTick(o2, step + 1));
        return;
      }
      emitJob(o, mon.id, key, 'daily_update', { state: 'running', stale: false, phase: PHASES[step], host: 'db-host', staleSec: 1500, line: `[회차·팔] runner — ${PHASES[step]}` }, { title });
      gen.at(3200, (o2) => roundTick(o2, step + 1));
      return;
    }
    emitJob(o, mon.id, key, 'daily_update', { state: 'done', rc: 0, stale: false, phase: 'DAILY 끝', line: '[회차] {"job_id":"daily_update","rc":0,"reason":"ok"}' }, { title });
    round++;
    gen.at(7000, (o2) => roundTick(o2, 0));
  };
  gen.at(9000, (o) => roundTick(o, 0));

  // ② 측정 체인 백그라운드 명령: run 진행 n/40 → 끝, judge 진행 → 가끔 실패
  const B = 'b:demo-measure';
  gen.at(4200, (o) => {
    const tu = gen.tuid();
    gen.emit(o, { type: 'tool-start', nodeId: M, toolUseId: tu, tool: 'Bash', cat: 'shell', skill: null, text: 'bash scripts/measure-chain.sh' });
    gen.emit(o, { type: 'tool-end', nodeId: M, toolUseId: tu, tool: 'Bash', cat: 'shell', ok: true, durationMs: 80, text: '백그라운드 실행' });
    gen.addNode(o, { id: B, parentId: M, kind: 'bash-bg', label: '측정 체인', meta: { command: 'bash scripts/measure-chain.sh', toolUseId: tu } });
    let n = 0, pass = 0;
    const run = (o2) => {
      if (!gen.alive(B)) return;
      n += 2;
      if (n < 40) {
        emitJob(o2, B, B, `run-${pass}`, { state: 'running', progress: { n, total: 40 }, phase: `ok ${Math.min(24, n)}/24`, line: `  ${n}/40 · ok 24/24 · 증거 없이 0` }, { title: `측정 run ${pass + 1}` });
        gen.at(1000, run);
        return;
      }
      emitJob(o2, B, B, `run-${pass}`, pass % 3 === 2
        ? { state: 'failed', rc: 4, progress: { n: 40, total: 40 }, phase: '칸 오류 3', line: 'STEP_RC=1 run rc=4' }
        : { state: 'done', rc: 0, progress: { n: 40, total: 40 }, phase: '끝 · 행 40/40', line: 'run 끝 · 행 40/40 · 칸 오류 0' }, { title: `측정 run ${pass + 1}` });
      emitJob(o2, B, B, 'judge', { state: 'waiting', until: new Date(gen.t0 + gen.t + 12 * 60000).toISOString(), phase: '다음 run 기다림', line: '판정 대기' }, { title: '판정' });
      pass++; n = 0;
      gen.at(4000, (o3) => { emitJob(o3, B, B, 'judge', { state: 'running', until: null, phase: '오류 0', progress: { n: 150, total: 198 } }, { title: '판정' }); gen.at(2500, run); });
    };
    gen.at(800, run);
  });

  // ③ 기동기(배치 장치) 출력 파일의 분리 프로세스 대기: 대기(재확인 시각) → 끝, PID 를 바꿔 되풀이(끝난 것 3개만 남음)
  let pid = 34560;
  const wait = (o) => {
    const L = 'b:demo-launch';
    if (!gen.alive(L)) { gen.at(2000, wait); return; }
    const id = `wait-${pid}`;
    emitJob(o, L, L, id, { state: 'waiting', until: new Date(gen.t0 + gen.t + 20 * 60000).toISOString(), phase: '재확인까지 LLM 없이 기다림', line: `[autopilot] 분리 프로세스 대기 — PID ${pid}` }, { title: `분리 프로세스 대기 PID ${pid}` });
    const my = pid;
    gen.at(11000, (o2) => {
      emitJob(o2, L, L, `wait-${my}`, { state: 'done', until: null, phase: '끝 · ended · 12분', line: `[autopilot] 분리 프로세스 대기 끝 — PID ${my} · ended · 12분` }, { title: `분리 프로세스 대기 PID ${my}` });
      pid += 7;
      gen.at(3000, wait);
    });
  };
  gen.at(12000, wait);
}

// ───────────── 분리 프로세스 · 진행 레인 · 들여다보기 ─────────────
// 실제 사례(자율 루프 프로젝트): 서브에이전트가 Python 순회를 `nohup … > run1/run.log 2>&1 &` 로 떼어 띄우고, 몇 분마다 포그라운드 Bash 로
// 로그만 들여다본다. 로그는 두 레인(iter_pairs·_walk_pairs)이 번갈아 늘고 점점 느려진다(한 단위 최장 시간도 오름) → 마지막 EXIT 0.
// 짧게 실패하는 것 하나(Traceback → EXIT 1). 시각 압축: 실제 '5분마다 들여다봄' = 여기서 10초마다. 난수 없음.
// 서버(session.mjs _procLaunch·_jobEmit·_watchOpen)와 같은 모양: 프로세스 kind 'bash-bg' + meta.proc, 자동 작업 `j:<프로세스>:progress`
// (meta.job.src 'auto', lanes·rate·eta·heat), 이벤트 {type:'watch', nodeId, peer, kind, via, phase, toolUseId, progress}.

const PROC_CYCLE_MS = 95_000;

/** 서버 progress.mjs 와 같은 과열 식: max(log10(처음 처리율/지금)/2, log10(지금 최장/처음 최장)/1.5), 0..1 */
export function mockHeat(rate0, rate, last0, last) {
  const c = (x) => Math.max(0, Math.min(1, x));
  const hr = rate0 > 0 && rate > 0 ? c(Math.log10(rate0 / rate) / 2) : 0;
  const hl = last0 > 0 && last > 0 ? c(Math.log10(last / last0) / 1.5) : 0;
  return Math.round(Math.max(hr, hl) * 100) / 100;
}

export function procMockScript(gen) {
  const M = gen.root;
  const A = 'a:demo-probe';
  let cycle = 0;
  const procMeta = (p) => ({ v: 1, cmd: p.cmd, prog: 'python', script: p.script, via: 'nohup', log: p.log, pidHint: null, spawnedBy: A,
    watch: [...p.watch.values()], watchCount: p.watchCount, lastWatchAt: p.lastWatchAt, endReason: p.endReason, rc: p.rc });
  const upd = (o, p) => gen.emit(o, { type: 'node-update', nodeId: p.id, patch: { meta: { proc: procMeta(p) } } });

  const launch = (o, { script, log, cmd, desc }) => {
    const tu = gen.tuid();
    const full = `cd /d/code/acme-batch/.scratch/branches && mkdir -p run1 && cd co && (PYTHONUTF8=1 nohup ../../venv/Scripts/python.exe -u ../${script} ${cmd} > ../${log} 2>&1; echo "EXIT $?" >> ../${log}) > /dev/null 2>&1 &`;
    gen.emit(o, { type: 'tool-start', nodeId: A, toolUseId: tu, tool: 'Bash', cat: 'shell', skill: null, text: desc, brief: desc, detail: full.slice(0, 120) });
    const p = { id: `b:${tu}`, tu, script, log: `D:/code/acme-batch/.scratch/branches/${log}`, cmd: `nohup ../../venv/Scripts/python.exe -u ../${script} ${cmd}`,
      watch: new Map(), watchCount: 0, lastWatchAt: null, endReason: null, rc: null, lanes: new Map(), job: null, ended: false };
    gen.addNode(o, { id: p.id, parentId: A, kind: 'bash-bg', label: `분리 실행 · ${script}`,
      meta: { toolUseId: tu, command: p.cmd, background: true, detached: true, spawnedBy: A, title: desc, proc: procMeta(p) } });
    gen.at(2400, (o2) => gen.emit(o2, { type: 'tool-end', nodeId: A, toolUseId: tu, tool: 'Bash', cat: 'shell', ok: true, durationMs: 2400, text: 'exit 0', brief: 'exit 0' }));
    return p;
  };

  // 로그 한 줄: 출력 이벤트 + (진행 줄이면) 레인 갱신 → 자동 작업
  const line = (o, p, text, prog = null) => {
    if (p.ended) return;
    gen.emit(o, { type: 'output', nodeId: p.id, text: text + '\n' });
    const n = gen.nodes.get(p.id);
    if (n && n.status === 'idle') gen.emit(o, { type: 'node-update', nodeId: p.id, patch: { status: 'active' } });
    if (!prog) return;
    const now = gen.t0 + gen.t;
    let L = p.lanes.get(prog.key);
    if (!L) { L = { key: prog.key, n: 0, total: prog.total ?? null, unit: prog.unit || null, rate: null, rate0: null, last: null, last0: null, pass: 1, at: now, seen: 0, ord: p.lanes.size }; p.lanes.set(prog.key, L); }
    if (prog.n < L.n) { L.pass++; L.seen = 0; }
    const dt = (now - L.at) / 1000;
    if (L.seen > 0 && dt > 0) L.rate = Math.round(((prog.n - L.n) / dt) * 100) / 100;
    if (L.rate0 == null && L.rate != null && L.pass === 1 && L.seen >= 2) L.rate0 = L.rate;
    L.n = prog.n; L.at = now; L.seen++;
    if (prog.max != null) { L.last = { k: '최장', v: prog.max, u: 's' }; if (!L.last0) L.last0 = prog.max; }
    const conf = [...p.lanes.values()].filter((x) => x.seen >= 3 || x.pass > 1);
    if (!conf.length) return;
    const lanes = conf.sort((a, b) => a.ord - b.ord).map((x) => ({ key: x.key, n: x.n, total: x.total, unit: x.unit, rate: x.rate, last: x.last, pass: x.pass,
      at: new Date(x.at).toISOString(), elapsed: null, heat: mockHeat(x.rate0, x.rate, x.last0, x.last ? x.last.v : null) }));
    const primary = conf.reduce((a, b) => (b.at > a.at ? b : a));
    let eta = null;
    for (const x of conf) if (x.total && x.rate > 0 && x.n < x.total) { const e = x.at + ((x.total - x.n) / x.rate) * 1000; if (eta == null || e > eta) eta = e; }
    const job = { v: 1, id: 'progress', title: '진행', state: 'running', phase: primary.key, progress: primary.total ? { n: primary.n, total: primary.total } : null, host: null, until: null, rc: null,
      beatAt: gen.iso(), staleSec: 300, stale: false, line: text, src: 'auto', startedAt: p.job ? p.job.startedAt : gen.iso(), endedAt: null,
      lanes, primary: primary.key, rate: primary.rate, eta: eta != null ? new Date(eta).toISOString() : null, heat: Math.max(...lanes.map((l) => l.heat)) };
    const jid = `j:${p.id}:progress`;
    if (!p.job) gen.addNode(o, { id: jid, parentId: p.id, kind: 'bash-bg', label: '진행', meta: { job, title: job.phase, background: true, jobOwner: p.id } });
    else gen.emit(o, { type: 'node-update', nodeId: jid, patch: { status: 'active', label: '진행', meta: { job, title: job.phase } } });
    p.job = job;
  };

  const end = (o, p, rc, reason = rc === 0 ? 'exit' : 'exit-code') => {
    if (p.ended) return;
    line(o, p, `EXIT ${rc}`);
    p.ended = true; p.rc = rc; p.endReason = reason;
    const st = rc === 0 ? 'done' : 'error';
    if (p.job) {
      const job = { ...p.job, state: rc === 0 ? 'done' : 'failed', rc, endedAt: gen.iso(), line: `EXIT ${rc}` };
      gen.emit(o, { type: 'node-update', nodeId: `j:${p.id}:progress`, patch: { status: st, endedAt: gen.iso(), meta: { job } } });
    }
    gen.emit(o, { type: 'node-update', nodeId: p.id, patch: { status: st, endedAt: gen.iso() } });
    upd(o, p);
  };

  // 들여다보기: 포그라운드 Bash(기다림 wait / 한 번 보기 peek) — 열림 → 결과(진행 줄) → 닫힘
  const watch = (o, p, { kind = 'wait', durMs = 8000, desc = 'Wait and show walk progress' } = {}) => {
    if (p.ended || !gen.alive(A)) return;
    const tu = gen.tuid();
    const cmd = kind === 'wait'
      ? `L=${p.log}; for i in $(seq 1 115); do grep -q "^EXIT" $L && break; sleep 5; done; date -u +%H:%M:%S; grep "^\\[_walk_pairs\\]" $L | tail -1`
      : `cat ${p.log} | head -40`;
    gen.emit(o, { type: 'tool-start', nodeId: A, toolUseId: tu, tool: 'Bash', cat: 'shell', skill: null, text: desc, brief: desc, detail: cmd.slice(0, 120) });
    const since = gen.iso();
    p.watch.set(tu, { nodeId: A, kind, via: 'shell', since, toolUseId: tu });
    p.watchCount++; p.lastWatchAt = since;
    gen.emit(o, { type: 'watch', nodeId: A, peer: p.id, kind, via: 'shell', phase: 'start', toolUseId: tu });
    upd(o, p);
    gen.at(durMs, (o2) => {
      const walk = p.lanes.get('_walk_pairs');
      const out = walk ? `[_walk_pairs] ${walk.n.toLocaleString('en-US')} 바퀴` : '[iter_pairs] …';
      gen.emit(o2, { type: 'tool-end', nodeId: A, toolUseId: tu, tool: 'Bash', cat: 'shell', ok: true, durationMs: durMs, text: out, brief: out });
      p.watch.delete(tu);
      gen.emit(o2, { type: 'watch', nodeId: A, peer: p.id, kind, via: 'shell', phase: 'end', toolUseId: tu, progress: true });
      upd(o2, p);
    });
  };

  const runCycle = (o) => {
    if (!gen.alive(A)) return;
    const c = cycle++;
    // ① 본 순회: 2레인 직렬 작업, 점점 느려짐, 10초(실제 5분)마다 들여다봄, 끝에 EXIT 0
    const p = launch(o, { script: 'probe_branches.py', log: 'run1/run.log', cmd: '--cases ../cases.jsonl --out ../run1 --tag head', desc: 'Launch full probe detached with log' });
    gen.at(3000, (o2) => watch(o2, p, { kind: 'peek', durMs: 500, desc: 'Read run log' }));
    let n1 = 0;
    const fast = (o2) => { // 첫 회차: 1만 바퀴에 1초 남짓
      n1 += 2000;
      line(o2, p, `[iter_pairs] ${n1.toLocaleString('en-US')} 바퀴 · ${Math.floor(n1 / 10000)}s · 최장 0.14s`, { key: 'iter_pairs', n: n1, unit: '바퀴', max: 0.14 });
      if (n1 < 24000) gen.at(250, fast);
      else gen.at(1200, (o3) => { line(o3, p, '══ 쌍 모집단 — 137,981쌍 · 날짜 확정 12,205 · 16s'); line(o3, p, '[census] rc=0 wall=106.631s'); gen.at(2000, slow); });
    };
    let k = 0, ni = 0, nw = 0, e = 277;
    const MAXES = [1.58, 1.69, 2.48, 2.48, 4.2, 4.2, 4.2, 4.32];
    const slow = (o3) => { // 둘째 회차: 두 레인이 번갈아, 간격이 점점 늘어남(느려짐)
      if (p.ended) return;
      const mx = MAXES[Math.min(MAXES.length - 1, k >> 1)];
      if (k % 2 === 0) { ni += 2000; line(o3, p, `[iter_pairs] ${ni.toLocaleString('en-US')} 바퀴 · ${e}s · 최장 ${mx}s`, { key: 'iter_pairs', n: ni, unit: '바퀴', max: mx }); }
      else { nw += 2000; line(o3, p, `[_walk_pairs] ${nw.toLocaleString('en-US')} 바퀴 · ${e + 13}s · 최장 ${mx}s`, { key: '_walk_pairs', n: nw, unit: '바퀴', max: mx }); }
      k++; e += 230 + 12 * k;
      if (k < 22) gen.at(1600 + 90 * k, slow);
      else gen.at(1500, (o4) => end(o4, p, 0));
    };
    gen.at(600, fast);
    for (let i = 1; i <= 6; i++) gen.at(5000 + i * 10_000, (o2) => watch(o2, p));
    // ② 짧게 실패하는 것: 진행 줄 셋 → Traceback → EXIT 1
    gen.at(26_000, (o2) => {
      const q = launch(o2, { script: 'smoke_probe.py', log: 'run1/smoke.log', cmd: '--limit 50', desc: 'Smoke probe detached' });
      [10, 20, 30].forEach((v, i) => gen.at(700 + i * 700, (o3) => line(o3, q, `[smoke] ${v}/50 cases`, { key: 'smoke', n: v, total: 50, unit: 'cases' })));
      gen.at(3200, (o3) => { line(o3, q, 'Traceback (most recent call last):'); line(o3, q, '  File "smoke_probe.py", line 88, in <module>'); line(o3, q, "KeyError: 'law_id'"); });
      gen.at(3600, (o3) => end(o3, q, 1));
      gen.at(1500, (o3) => watch(o3, q, { kind: 'peek', durMs: 400, desc: 'Check smoke log' }));
    });
    gen.at(PROC_CYCLE_MS, runCycle);
    void c;
  };

  gen.at(6500, (o) => {
    gen.addNode(o, { id: A, parentId: M, kind: 'subagent', label: '판 갈래 호출 탐침', meta: { agentType: 'designer', background: false } });
    gen.at(800, runCycle);
  });
}
