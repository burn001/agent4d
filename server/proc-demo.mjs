// --demo 의 분리 프로세스 시나리오. 실제 진행 인식(JobBook auto·progress.mjs)에 가짜 로그 줄을 넣어 라이브와 같은 모양의
// 프로세스 노드(meta.proc)·자동 작업(lanes·rate·eta·heat)·watch 이벤트를 낸다 — 웹 연출 개발·헤드리스 확인용. 경로·이름은 모두 가짜.
// 흐름(되풀이): 서브에이전트 '자료 조사'가 `nohup python probe_branches.py > run1/run.log &` 로 2레인 순회를 띄움 → 처음엔 빠르고 점점
// 느려짐(한 단위 최장도 오름) → 20초마다 포그라운드 Bash 로 들여다봄(실제 사례의 '5분마다') → EXIT 0. 그사이 짧게 실패하는 것 하나.
import { JobBook, jobNodeId, jobNodeStatus, jobLabel, isJobEnded } from './jobs.mjs';
import { scanEnd } from './procs.mjs';

export const PROC_DEMO = { CYCLE_MS: 150_000, WATCH_MS: 20_000 };

export function procDemoStart(rt) {
  const g = rt.graph;
  const N = (id) => (rt.N ? rt.N(id) : id);
  const A = N('a:demo-sub-1');
  const book = new JobBook({ rules: null, privacy: g.privacy });
  const timers = new Set();
  const at = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); try { fn(); } catch { /* 데모 */ } }, ms); t.unref?.(); timers.add(t); };
  const now = () => new Date().toISOString();
  let seq = 0;

  const meta = (p) => ({ v: 1, cmd: p.cmd, prog: 'python', script: p.script, via: 'nohup', log: p.log, pidHint: null, spawnedBy: A,
    watch: [...p.watch.values()], watchCount: p.watchCount, lastWatchAt: p.lastWatchAt, endReason: p.endReason, rc: p.rc });
  const upd = (p) => { if (g.has(p.id)) g.updateNode(p.id, { meta: { proc: meta(p) } }, now()); };

  const emitJob = (p, u) => {
    const ts = now();
    const id = jobNodeId(p.id, u.jobId);
    const job = u.job;
    const status = jobNodeStatus(job.state);
    if (!g.has(id)) {
      g.addNode({ id, parentId: p.id, kind: 'bash-bg', label: jobLabel(job), sessionId: rt.sessionId, startedAt: ts, lastActivityAt: ts, status: 'active',
        meta: { job, title: job.phase || null, background: true, jobOwner: p.id } }, ts);
      if (status !== 'active') g.updateNode(id, { status, endedAt: isJobEnded(job.state) ? ts : null }, ts);
      return;
    }
    g.updateNode(id, { status, label: jobLabel(job), lastActivityAt: ts, endedAt: isJobEnded(job.state) ? (job.endedAt || ts) : null, meta: { job, title: job.phase || null } }, ts);
  };

  const launch = (script, log, desc) => {
    if (!g.has(A)) return null;
    const tu = `toolu_demo_proc_${++seq}`;
    const ts = now();
    const cmd = `nohup ../../venv/Scripts/python.exe -u ../${script} --out ../run1 > ../${log} 2>&1`;
    g.emit({ ts, type: 'tool-start', nodeId: A, toolUseId: tu, tool: 'Bash', cat: 'shell', skill: null, text: desc, brief: desc });
    const p = { id: `b:${tu}`, tu, script, log: `D:/demo/batch/branches/${log}`, cmd, watch: new Map(), watchCount: 0, lastWatchAt: null, endReason: null, rc: null,
      end: { trace: false, failAt: null, exc: null, end: null, lastLine: null }, ended: false };
    g.updateNode(A, { status: 'active', endedAt: null }, ts);
    g.addNode({ id: p.id, parentId: A, kind: 'bash-bg', label: `분리 실행 · ${script}`, sessionId: rt.sessionId, startedAt: ts, lastActivityAt: ts,
      meta: { toolUseId: tu, command: cmd, background: true, detached: true, spawnedBy: A, title: desc, proc: meta(p) } }, ts);
    at(1800, () => g.emit({ ts: now(), type: 'tool-end', nodeId: A, toolUseId: tu, tool: 'Bash', cat: 'shell', ok: true, durationMs: 1800, text: 'exit 0', brief: 'exit 0' }));
    return p;
  };

  // 로그 한 줄 → 출력 이벤트 · 자동 작업(실제 progress.mjs) · 끝 표지(실제 procs.mjs scanEnd)
  const line = (p, text) => {
    if (!p || p.ended || !g.has(p.id)) return;
    const ts = now();
    const n = g.get(p.id);
    if (n.status !== 'active') g.updateNode(p.id, { status: 'active' }, ts);
    n.lastActivityAt = ts;
    g.emit({ ts, type: 'output', nodeId: p.id, text: text + '\n' });
    for (const u of book.feed(p.id, p.id, text + '\n', ts, { owner: n, auto: true, autoTitle: '진행', staleSec: 120 })) emitJob(p, u);
    scanEnd(p.end, text, ts);
    const e = p.end.end;
    if (!e) return;
    p.ended = true; p.rc = e.rc; p.endReason = e.reason;
    const u = book.endAuto(p.id, e.state === 'failed' ? 'failed' : 'done', ts, e.rc);
    if (u) emitJob(p, u);
    g.updateNode(p.id, { status: e.state === 'done' ? 'done' : 'error', endedAt: ts }, ts);
    upd(p);
  };

  const watch = (p, kind, durMs) => {
    if (!p || p.ended || !g.has(A)) return;
    const tu = `toolu_demo_watch_${++seq}`;
    const ts = now();
    const desc = kind === 'wait' ? 'Wait and show walk progress' : 'Read run log';
    g.emit({ ts, type: 'tool-start', nodeId: A, toolUseId: tu, tool: 'Bash', cat: 'shell', skill: null, text: desc, brief: desc });
    p.watch.set(tu, { nodeId: A, kind, via: 'shell', since: ts, toolUseId: tu });
    p.watchCount++; p.lastWatchAt = ts;
    g.emit({ ts, type: 'watch', nodeId: A, peer: p.id, kind, via: 'shell', phase: 'start', toolUseId: tu });
    upd(p);
    at(durMs, () => {
      const t2 = now();
      const lane = book.autoJob(p.id)?.lanes?.find((l) => l.key === '_walk_pairs');
      const out = lane ? `[_walk_pairs] ${lane.n.toLocaleString('en-US')} 바퀴` : '';
      g.emit({ ts: t2, type: 'tool-end', nodeId: A, toolUseId: tu, tool: 'Bash', cat: 'shell', ok: true, durationMs: durMs, text: out, brief: out || 'exit 0' });
      p.watch.delete(tu);
      g.emit({ ts: t2, type: 'watch', nodeId: A, peer: p.id, kind, via: 'shell', phase: 'end', toolUseId: tu, progress: !!lane });
      upd(p);
    });
  };

  const cycle = () => {
    const p = launch('probe_branches.py', 'run1/run.log', 'Launch full probe detached with log');
    if (!p) { at(10_000, cycle); return; }
    at(3000, () => watch(p, 'peek', 600));
    let n1 = 0;
    const fast = () => { n1 += 2000; line(p, `[iter_pairs] ${n1.toLocaleString('en-US')} 바퀴 · 최장 0.14s`); if (n1 < 24000) at(250, fast); else at(1500, () => { line(p, '══ 쌍 모집단 — 137,981쌍 · 16s'); at(2000, slow); }); };
    let k = 0, ni = 0, nw = 0;
    const MAX = [1.58, 1.69, 2.48, 2.48, 4.2, 4.2, 4.2, 4.32];
    const slow = () => {
      if (p.ended) return;
      const mx = MAX[Math.min(MAX.length - 1, k >> 1)];
      if (k % 2 === 0) { ni += 2000; line(p, `[iter_pairs] ${ni.toLocaleString('en-US')} 바퀴 · 최장 ${mx}s`); }
      else { nw += 2000; line(p, `[_walk_pairs] ${nw.toLocaleString('en-US')} 바퀴 · 최장 ${mx}s`); }
      k++;
      if (k < 24) at(2500 + 260 * k, slow); else at(2000, () => line(p, 'EXIT 0'));
    };
    at(800, fast);
    for (let i = 1; i <= 6; i++) at(i * PROC_DEMO.WATCH_MS, () => watch(p, 'wait', 12_000));
    at(30_000, () => {
      const q = launch('smoke_probe.py', 'run1/smoke.log', 'Smoke probe detached');
      [10, 20, 30].forEach((v, i) => at(800 + i * 800, () => line(q, `[smoke] ${v}/50 cases`)));
      at(3600, () => { line(q, 'Traceback (most recent call last):'); line(q, '  File "smoke_probe.py", line 88, in <module>'); line(q, "KeyError: 'law_id'"); line(q, 'EXIT 1'); });
    });
    at(PROC_DEMO.CYCLE_MS, cycle);
  };
  at(5000, cycle);
  return { close() { for (const t of timers) clearTimeout(t); timers.clear(); } };
}
