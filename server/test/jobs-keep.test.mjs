// keepEnded: 덧붙여 쓰는 러너 출력 파일의 첫 꼬리(backlog)에는 앞 러너들의 끝난 '분리 프로세스 대기'가 여럿 들어 있다.
// 새 주인 아래 그것을 모두 끝난 노드로 세우던 것(실측 자율 루프 저장소 a3443dd5: 6개)을, 이미 끝난 채로 처음 서는 작업은 주인마다
// 끝난 시각 최근 keepEnded 개만 세우게. 설정 keepEnded 가 기본과 다르면 meta.job.keepEnded 로 실어 웹 jobFold 가 따른다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileJobRules } from '../jobs.mjs';
import { RootRuntime } from '../session.mjs';
import { jobFold } from '../../web/job-core.mjs';

const SID = 'dddddddd-4444-4444-8444-dddddddddddd';
const rules = (keepEnded) => compileJobRules({ ...(keepEnded != null ? { keepEnded } : {}), sets: [{ name: 'loop', files: [{ path: 'runner.out', owner: 'runner' }], rules: [
  { on: 'end', re: '^\\[autopilot (?<time>\\d{2}:\\d{2}:\\d{2})\\] 분리 프로세스 대기 끝 — PID (?<pid>\\d+)', job: 'wait-$<pid>' },
  { on: 'wait', re: '^\\[autopilot (?<time>\\d{2}:\\d{2}:\\d{2})\\] 분리 프로세스 대기 — PID (?<pid>\\d+)', job: 'wait-$<pid>', title: '분리 프로세스 대기 PID $<pid>' },
] }] });

function runtime(R) {
  const rt = new RootRuntime({ sessionId: SID, index: { findSession: () => null, procs: new Map() }, jobRules: R, extJobs: null });
  const g = rt.graph;
  const add = (n) => g.addNode({ sessionId: SID, label: n.id, status: 'active', lastActivityAt: n.startedAt, meta: {}, ...n }, n.startedAt);
  add({ id: `s:${SID}`, parentId: null, kind: 'main', startedAt: '2026-11-04T10:00:00.000Z', meta: { cwd: process.cwd() } });
  add({ id: 'b:L', parentId: null, kind: 'bash-bg', startedAt: '2026-11-04T10:00:01.000Z', meta: { launcher: {} } });
  return rt;
}
// 앞 러너들의 대기 여섯(모두 끝) + 지금 대기 하나(끝나지 않음). 시각은 그날 지역 시각 — 끝 순서 = PID 순서
const BACKLOG = [1, 2, 3, 4, 5, 6].flatMap((k) => [
  `[autopilot 0${k}:00:00] 분리 프로세스 대기 — PID ${1000 + k}`, `[autopilot 0${k}:30:00] 분리 프로세스 대기 끝 — PID ${1000 + k}`,
]).concat(['[autopilot 07:10:00] 분리 프로세스 대기 — PID 2000']).join('\n') + '\n';
const jobsOf = (g) => [...g.nodes.values()].filter((n) => n.meta?.job);

test('첫 꼬리: 끝난 채로 처음 서는 작업은 최근 keepEnded(기본 3)개만 · 끝나지 않은 것은 그대로', () => {
  const rt = runtime(rules());
  try {
    rt.jobFeed('file:runner.out', BACKLOG, '2026-11-04T08:00:00.000Z', { ownerId: 'b:L', file: true, backlog: true });
    const g = rt.graph;
    const ended = jobsOf(g).filter((n) => n.status === 'done').map((n) => n.meta.job.id).sort();
    assert.deepEqual(ended, ['wait-1004', 'wait-1005', 'wait-1006'], '끝난 것은 최근 셋');
    assert.equal(g.get('j:b:L:wait-2000')?.status, 'idle', '지금 대기는 노드');
    assert.equal(g.get('j:b:L:wait-2000').meta.job.keepEnded, undefined, '기본값이면 싣지 않음');
    // 라이브로 이어서 끝난 대기: 새로 끝난 것(가장 최근)은 선다 — 이미 선 노드는 지우지 않는다(웹 jobFold 가 접음)
    rt.jobFeed('file:runner.out', '[autopilot 07:20:00] 분리 프로세스 대기 끝 — PID 2000\n[autopilot 07:21:00] 분리 프로세스 대기 — PID 2001\n[autopilot 07:22:00] 분리 프로세스 대기 끝 — PID 2001\n', '2026-11-04T08:00:00.000Z', { ownerId: 'b:L', file: true });
    assert.equal(g.get('j:b:L:wait-2000').status, 'done');
    assert.equal(g.get('j:b:L:wait-2001')?.status, 'done', '가장 최근에 끝난 것은 처음 서도 노드');
    // 다시 앞 러너의 오래된 끝 줄이 와도(파일 교체 후 다시 읽기 등) 최근 셋 밖이면 세우지 않음
    rt.jobFeed('file:runner.out', '[autopilot 01:00:00] 분리 프로세스 대기 — PID 999\n[autopilot 01:10:00] 분리 프로세스 대기 끝 — PID 999\n', '2026-11-04T08:00:00.000Z', { ownerId: 'b:L', file: true });
    assert.ok(!rt.graph.get('j:b:L:wait-999'));
    const byId = new Map(jobsOf(g).map((n) => [n.id, n]));
    const { hidden } = jobFold(byId);
    assert.equal([...byId.values()].filter((n) => n.status === 'done' && !hidden.has(n.id)).length, 3, '웹에서 보이는 끝난 작업 셋');
  } finally { rt.close(); }
});

test('설정 keepEnded 2: 서버 첫 꼬리도 둘 · meta.job.keepEnded=2 로 웹 jobFold 가 따름', () => {
  const rt = runtime(rules(2));
  try {
    rt.jobFeed('file:runner.out', BACKLOG, '2026-11-04T08:00:00.000Z', { ownerId: 'b:L', file: true, backlog: true });
    const g = rt.graph;
    const ended = jobsOf(g).filter((n) => n.status === 'done');
    assert.deepEqual(ended.map((n) => n.meta.job.id).sort(), ['wait-1005', 'wait-1006']);
    assert.equal(g.get('j:b:L:wait-2000').meta.job.keepEnded, 2);
    rt.jobFeed('file:runner.out', '[autopilot 07:20:00] 분리 프로세스 대기 끝 — PID 2000\n', '2026-11-04T08:00:00.000Z', { ownerId: 'b:L', file: true });
    const byId = new Map(jobsOf(g).map((n) => [n.id, n]));
    const { hidden } = jobFold(byId);
    assert.deepEqual([...byId.values()].filter((n) => !hidden.has(n.id)).map((n) => n.meta.job.id).sort(), ['wait-1006', 'wait-2000']);
  } finally { rt.close(); }
});
