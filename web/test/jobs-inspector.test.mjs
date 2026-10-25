// 작업(Job) 노드 — 인스펙터 내용 모델(작업 노드·주인 노드 목록·숨은 수)과 홀로그램 꼬리 패널의 작업 줄 표시 판정. 합성 노드만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _setLangForTest } from '../i18n.mjs';
import { JOB_CODE } from '../job-core.mjs';
import { kindInfo, jobCardModel, ownerJobsModel, jobSrcText } from '../inspector-core.mjs';
import { HoloBook, normPanel, panelRows, jobLineNorm, sameJobLine, jobRowHits, jobLinesOf, jobLinesKey, jobLineStyle } from '../holo-core.mjs';

_setLangForTest('ko');
const T0 = Date.parse('2026-10-25T12:00:00Z');
const iso = (min) => new Date(T0 + min * 60000).toISOString();
const J = (id, parentId, job) => ({ id, parentId, kind: 'bash-bg', status: job.state === 'running' ? 'active' : job.state === 'done' ? 'done' : job.state === 'failed' ? 'error' : 'idle',
  label: job.title || job.id, startedAt: job.startedAt || iso(0), endedAt: job.endedAt || null, meta: { job: { v: 1, id: id.split(':').pop(), ...job }, title: job.phase || null } });
const map = (arr) => new Map(arr.map((n) => [n.id, n]));

test('작업 노드 인스펙터: 종류 · 배지 · 행(상대 박동·재확인 남은 시간·출처 이름) · 마지막 줄', () => {
  const n = J('j:m:mon:daily', 'm:mon', { title: '일일 회차', state: 'running', phase: 'DAILY 2단계', progress: { n: 96, total: 101 }, host: 'db-host',
    beatAt: iso(-3), rc: null, src: 'rule:round', line: '[회차·팔] runner — DAILY 2단계', startedAt: iso(-20) });
  assert.equal(kindInfo(n).key, 'job', '작업 노드는 백그라운드 명령이 아니라 작업');
  assert.equal(kindInfo(n).name, '작업');
  const m = jobCardModel(n, T0);
  assert.equal(m.title, '일일 회차');
  assert.equal(m.display, 'running');
  assert.equal(m.badge, '진행');
  assert.equal(m.warn, false);
  assert.deepEqual(m.rows.map((r) => r.key), ['state', 'phase', 'progress', 'host', 'beat', 'src']);
  const row = (k) => m.rows.find((r) => r.key === k);
  assert.equal(row('beat').value, '3분 전', '박동은 상대 시간');
  assert.ok(row('beat').title, '툴팁은 절대 시각');
  assert.equal(row('progress').value, '96/101');
  assert.ok(Math.abs(row('progress').ratio - 96 / 101) < 1e-9, '막대 비율');
  assert.equal(row('src').value, '규칙 묶음 round');
  assert.equal(row('phase').label, '단계');
  assert.equal(m.line, '[회차·팔] runner — DAILY 2단계');
  assert.equal(jobSrcText('protocol'), '규약 줄(::agent4d)');

  // 정체: 배지 '정체 N분' + 경고, 상태 행에도 정체가 붙음 — 시계(nowMs)가 바뀌면 같은 노드도 달라진다(재생 시점)
  const st = jobCardModel(n, T0 + 40 * 60000);
  assert.equal(st.display, 'stale');
  assert.equal(st.warn, true);
  assert.equal(st.badge, '정체 43분');
  assert.match(st.rows[0].value, /진행 · 정체 43분/);

  // 대기: 재확인 시각 + 남은 시간 / 지난 시간, rc 행
  const w = J('j:b:x:judge', 'b:x', { title: '판정', state: 'waiting', until: iso(12), beatAt: iso(0), src: 'protocol' });
  const wm = jobCardModel(w, T0);
  assert.equal(wm.badge, '대기');
  assert.match(wm.rows.find((r) => r.key === 'until').value, /· 12분 뒤$/);
  assert.match(jobCardModel(w, T0 + 14 * 60000).rows.find((r) => r.key === 'until').value, /· 2분 지남$/);
  const f = jobCardModel(J('j:b:x:run', 'b:x', { state: 'failed', rc: 4, beatAt: iso(0), endedAt: iso(1) }), T0 + 99 * 60000);
  assert.equal(f.display, 'failed', '끝난 작업은 정체가 아님');
  assert.equal(f.rows.find((r) => r.key === 'rc').value, '4');
  assert.equal(f.ended, true);
  assert.equal(jobCardModel({ id: 'b:x', kind: 'bash-bg', meta: {} }, T0), null, '작업이 아니면 null');
});

test('주인 노드 인스펙터: 작업마다 한 줄(끝나지 않은 것 먼저) · 끝난 작업은 최근 3개만, 나머지는 숨은 수', () => {
  const owner = { id: 'b:launch', kind: 'bash-bg', status: 'active', meta: {} };
  const arr = [owner,
    J('j:b:launch:loop', 'b:launch', { title: '루프', state: 'running', phase: '사이클 8', progress: { ratio: 0.5 }, beatAt: iso(0), startedAt: iso(-30) }),
    J('j:b:launch:w0', 'b:launch', { title: 'w0', state: 'waiting', until: iso(5), beatAt: iso(0), startedAt: iso(-5) })];
  for (let i = 1; i <= 5; i++) arr.push(J(`j:b:launch:d${i}`, 'b:launch', { title: `d${i}`, state: 'done', rc: 0, beatAt: iso(-20 + i), startedAt: iso(-25 + i), endedAt: iso(-20 + i) }));
  arr.push(J('j:b:other:z', 'b:other', { title: 'z', state: 'running', beatAt: iso(0) })); // 다른 주인
  arr.push({ id: 'b:launch-r1', parentId: 'b:launch', kind: 'bash-bg', status: 'active', meta: { runner: {} } }); // 작업이 아닌 자식
  const nodes = map(arr);
  const m = ownerJobsModel(nodes, 'b:launch', T0);
  assert.equal(m.total, 7);
  assert.equal(m.hidden, 2, '끝난 5개 중 최근 3개만');
  assert.deepEqual(m.items.map((x) => x.title), ['루프', 'w0', 'd5', 'd4', 'd3']);
  assert.deepEqual(m.items.map((x) => x.display), ['running', 'waiting', 'done', 'done', 'done']);
  assert.equal(m.items[0].phase, '사이클 8');
  assert.equal(m.items[0].progress, '50%');
  assert.equal(ownerJobsModel(nodes, 'b:launch', T0 + 3 * 3600e3).items[0].display, 'stale', '목록 상태 점도 시계로 정체');
  assert.equal(ownerJobsModel(nodes, 'b:launch-r1', T0), null, '작업이 없으면 null');
});

test('홀로 꼬리 패널: 작업을 만든 줄 판정(같음·잘린 앞부분·공백 차이) · 작업마다 가장 아래 줄 하나 · 말줄임 줄 제외', () => {
  assert.equal(jobLineNorm('  a\t b …'), 'a b');
  assert.ok(sameJobLine('[회차·팔] runner — DAILY 2단계', '[회차·팔]  runner — DAILY 2단계'));
  const long = 'X'.repeat(130);
  assert.ok(sameJobLine(long.slice(0, 99) + '…', long.slice(0, 159)), '패널은 100자에서 잘림 — 앞부분이면 같은 줄');
  assert.ok(!sameJobLine('ok…', 'ok 24/24 · 다른 줄'), '너무 짧은 앞부분은 우연 일치로 보지 않음');
  assert.ok(!sameJobLine('run 끝', 'run 끝 · 행 40/40'), '잘리지 않은 줄은 앞부분이어도 다른 줄');
  const p = normPanel({ mode: 'shell', part: 'tail', title: '$ bash measure.sh', lines: ['  38/40 · ok 24/24', 'run 끝 · 행 40/40 · 칸 오류 0', '판정 대기', 'noise', '판정 대기'], marks: 'ooooo', more: 9 });
  const rows = panelRows(p, 6);
  assert.equal(rows[0].mark, 'm');
  const jobs = [{ line: '판정 대기', code: JOB_CODE.waiting }, { line: 'run 끝 · 행 40/40 · 칸 오류 0', code: JOB_CODE.done }, { line: '없는 줄', code: JOB_CODE.running }];
  const hits = jobRowHits(rows, jobs);
  assert.equal(hits.length, rows.length);
  assert.deepEqual(hits, [-1, -1, JOB_CODE.done, -1, -1, JOB_CODE.waiting], '같은 줄이 둘이면 아래(최근) 것만');
  assert.deepEqual(jobRowHits(rows, null), rows.map(() => -1));
  assert.deepEqual(jobRowHits(panelRows(normPanel({ part: 'tail', lines: ['… 앞 3줄'], marks: 'o', more: 2 }), 6), [{ line: '… 앞 2줄', code: 1 }])[0], -1, '말줄임 줄은 표시 안 함');
  // 자식 노드 → 작업 줄(시계로 정체 5), 줄 없는 작업·작업 아닌 자식 제외, 최근 박동 먼저
  const kids = [J('j:b:x:a', 'b:x', { state: 'running', beatAt: iso(0), line: 'A 줄' }), J('j:b:x:b', 'b:x', { state: 'running', beatAt: iso(-1) }),
    J('j:b:x:c', 'b:x', { state: 'done', beatAt: iso(1), line: 'C 줄' }), { id: 'b:x-r1', kind: 'bash-bg', meta: {} }];
  assert.deepEqual(jobLinesOf(kids, T0), [{ line: 'C 줄', code: JOB_CODE.done }, { line: 'A 줄', code: JOB_CODE.running }]);
  assert.equal(jobLinesOf(kids, T0 + 3 * 3600e3)[1].code, JOB_CODE.stale);
  assert.notEqual(jobLinesKey(jobLinesOf(kids, T0)), jobLinesKey(jobLinesOf(kids, T0 + 3 * 3600e3)), '정체로 바뀌면 다시 그림');
  assert.equal(jobLinesKey(null), '');
  for (const light of [false, true]) for (let c = 0; c <= 5; c++) { const s = jobLineStyle(c, light); assert.match(s.bar, /^#[0-9a-f]{6}$/); assert.match(s.bg, /^rgba\(/); }
  assert.notEqual(jobLineStyle(JOB_CODE.stale, false).bar, jobLineStyle(JOB_CODE.running, false).bar, '정체는 진행과 다른 색');
});

test('HoloBook: 꼬리를 낸 노드를 작업 주인으로 기억(ref 패널·자기 꼬리 패널) · 이어받은 도구 패널은 지움', () => {
  const b = new HoloBook();
  b.start('s:main', { toolUseId: 'tu1', tool: 'Bash', cat: 'shell' }, 0);
  b.end('s:main', 'tu1', 'ok', 0.1);
  const tail = { mode: 'shell', part: 'tail', title: '$ x', lines: ['판정 대기'], marks: 'o' };
  b.panelEvent({ type: 'output', nodeId: 'b:x', panel: { ...tail, ref: { nodeId: 's:main', toolUseId: 'tu1' } } }, 0.5);
  assert.equal(b.find('s:main', 'tu1').jobOwner, 'b:x', 'ref 패널(띄운 호출)의 작업 주인 = 출력 노드');
  b.panelEvent({ type: 'output', nodeId: 'm:y', panel: { ...tail, ref: null } }, 0.6);
  assert.equal(b.find('m:y', 'tail:m:y').jobOwner, 'm:y', '자기 꼬리 패널');
  b.start('s:main', { toolUseId: 'tu2', tool: 'Bash', cat: 'shell' }, 1);
  assert.equal(b.find('s:main', 'tu2').jobOwner, null, '다음 도구가 이어받으면 작업 주인 없음');
});
