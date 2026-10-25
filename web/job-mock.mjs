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
