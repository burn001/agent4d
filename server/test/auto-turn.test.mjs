// 사용자 아닌 것이 연 메인 턴 — 예약 작업(scheduled_task_fire + isMeta 프롬프트) · Monitor 출력 알림 · 작업 끝 알림.
// 실측 꼴(실제 프로젝트 8d31c4c6, Claude Code 2.1.310)을 합성: 라이브 런타임과 재생이 같은 ix 를 낸다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionIndex } from '../discovery.mjs';
import { RootRuntime } from '../session.mjs';
import { buildReplay } from '../replay.mjs';
import { sanitizeIx } from '../interactions.mjs';

test('§114 sanitizeIx: from(노드 id)·st 를 남기고 이상한 값은 버린다', () => {
  assert.deepEqual(sanitizeIx({ cat: 'user', op: 'auto', src: 'notify', from: 'b:bg01', st: 'ok' }), { v: 1, cat: 'user', op: 'auto', src: 'notify', from: 'b:bg01', st: 'ok' });
  assert.equal(sanitizeIx({ cat: 'user', op: 'auto', from: 'rm -rf /' }).from, undefined);
  assert.equal(sanitizeIx({ cat: 'user', op: 'auto', src: 'monitor', from: 'm:mon1', text: 'x' }, 'minimal').text, undefined);
});

test('§114 예약·Monitor 출력·작업 끝 알림 → 출처가 구분된 user 이벤트(라이브 = 재생)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-auto-'));
  const prevTmp = process.env.CCVIZ_CLAUDE_TMP;
  try {
    const cwd = 'D:\\work\\autoturn';
    const enc = (c) => c.replace(/[^A-Za-z0-9]/g, '-');
    const SID = 'abababab-5555-4555-8555-abababababab';
    const projects = path.join(root, 'projects'), sessions = path.join(root, 'sessions'), tmpClaude = path.join(root, 'tmp', 'claude');
    const proj = path.join(projects, enc(cwd));
    const tasks = path.join(tmpClaude, enc(cwd), SID, 'tasks');
    for (const d of [proj, sessions, tasks]) fs.mkdirSync(d, { recursive: true });
    process.env.CCVIZ_CLAUDE_TMP = tmpClaude;
    const P = Date.now() - 3 * 86400_000, T = (s) => new Date(P + s * 1000).toISOString();
    const base = { sessionId: SID, cwd, version: '2.1.310', entrypoint: 'cli' };
    const A = (s, id, name, input) => ({ type: 'assistant', timestamp: T(s), ...base, message: { model: 'm', role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
    const R = (s, id, content, tur) => ({ type: 'user', timestamp: T(s), ...base, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] }, toolUseResult: tur });
    const NOTE = (s, body) => ({ type: 'user', timestamp: T(s), ...base, origin: { kind: 'task-notification', producer: 'session-task' }, message: { role: 'user', content: `<task-notification>\n${body}\n</task-notification>` } });
    const out = path.join(tasks, 'bg01.output');
    fs.writeFileSync(out, 'done\n');
    const recs = [
      { type: 'user', timestamp: T(0), ...base, origin: { kind: 'human' }, promptSource: 'user', message: { role: 'user', content: '루프를 지켜보자' } },
      A(1, 'tu_m', 'Monitor', { command: 'bash watch.sh', description: '세션 모니터' }),
      R(2, 'tu_m', 'Monitor started (task mon1, expires in 30m unless the source ends first)', null),
      A(3, 'tu_b', 'Bash', { command: 'node build.mjs', run_in_background: true }),
      R(4, 'tu_b', `Command running in background with ID: bg01. Output is being written to: ${out}`, { stdout: '', stderr: '', backgroundTaskId: 'bg01' }),
      { type: 'system', subtype: 'turn_duration', durationMs: 1000, timestamp: T(5), ...base },
      NOTE(10, '<task-id>mon1</task-id>\n<summary>Monitor event: "세션 모니터"</summary>\n<event>[커밋] e668daf0e fix: 단계 3 첫 전수</event>'),
      { type: 'system', subtype: 'turn_duration', durationMs: 500, timestamp: T(12), ...base },
      NOTE(20, `<task-id>bg01</task-id>\n<output-file>${out}</output-file>\n<status>completed</status>\n<summary>Background command "node build.mjs" completed (exit code 0)</summary>`),
      { type: 'system', subtype: 'turn_duration', durationMs: 500, timestamp: T(22), ...base },
      { type: 'system', subtype: 'scheduled_task_fire', content: 'Running scheduled task (Oct 28 8:58pm)', isMeta: false, timestamp: T(30), ...base, taskId: 'f5ea6729', cron: '58 20 * * *', prompt: '정시 보고 — /peek 결과로 루프와 회차 상태를 보고한다' },
      { type: 'user', timestamp: T(30), ...base, isMeta: true, message: { role: 'user', content: '정시 보고 — /peek 결과로 루프와 회차 상태를 보고한다' } },
      A(31, 'tu_peek', 'Bash', { command: 'bash peek.sh' }), R(32, 'tu_peek', 'ok', { stdout: 'ok', stderr: '' }),
      { type: 'system', subtype: 'turn_duration', durationMs: 2000, timestamp: T(33), ...base },
    ];
    fs.writeFileSync(path.join(proj, `${SID}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const old = (P + 60_000) / 1000;
    for (const f of [path.join(proj, `${SID}.jsonl`), out]) fs.utimesSync(f, old, old);
    const index = new SessionIndex({ projectsDir: projects, sessionsDir: sessions });
    await index.refresh();
    for (const e of index.entries.values()) e.birthtimeMs = e.mtimeMs;
    const rt = new RootRuntime({ sessionId: SID, index });
    await rt.start();
    rt.close();
    const data = await buildReplay({ sessionId: SID, index });
    const main = `s:${SID}`;
    for (const [name, evs] of [['live', rt.graph.ring], ['replay', data.events.map((x) => x.e || x)]]) {
      const autos = evs.filter((e) => e.type === 'user' && e.origin !== 'human');
      const mon = autos.find((e) => e.ix?.src === 'monitor');
      assert.ok(mon, name + ': Monitor 출력 턴');
      assert.equal(mon.nodeId, main);
      assert.equal(mon.origin, 'task-notification');
      assert.deepEqual([mon.ix.op, mon.ix.from, mon.ix.st], ['auto', 'm:mon1', undefined]);
      assert.match(mon.ix.text, /^\[커밋\] e668daf0e/);
      const res = autos.find((e) => e.ix?.src === 'notify' && e.ix.from === 'b:bg01');
      assert.ok(res, name + ': 작업 끝 알림');
      assert.equal(res.ix.st, 'ok');
      const sch = autos.filter((e) => e.origin === 'schedule');
      assert.equal(sch.length, 1, name + ': 예약 턴은 한 번(뒤따르는 isMeta 프롬프트는 겹치지 않음)');
      assert.equal(sch[0].nodeId, main);
      assert.deepEqual([sch[0].ix.cat, sch[0].ix.op, sch[0].ix.src], ['user', 'auto', 'schedule']);
      assert.match(sch[0].text, /^정시 보고/);
      assert.ok(sch[0].ix.text.length <= 40);
      // 사용자 말과 섞이지 않는다
      assert.equal(evs.filter((e) => e.type === 'user' && e.origin === 'human').length, 1);
    }
  } finally {
    if (prevTmp == null) delete process.env.CCVIZ_CLAUDE_TMP; else process.env.CCVIZ_CLAUDE_TMP = prevTmp;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});
