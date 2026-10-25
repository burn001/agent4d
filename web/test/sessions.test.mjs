// 여러 live 세션 화면 규칙: 충돌 묶음·칩 글·곡선 제어점·세션 표식·가짜 데이터·테마 토큰
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { conflictPairs, pairChipText, ConflictBook, conflictEvent } from '../conflict-core.mjs';
import { arcControl, bez2, sessBadgeHtml, branchOf } from '../session-core.mjs';
import { sessionColorMap, nodeSessIdx, SESS_PALETTE } from '../multi-core.mjs';
import { createOverviewMock } from '../overview/mock.js';

test('충돌 묶음: 같은 두 메인 사이는 하나(강 우선·파일 여럿이면 외 n), 방향 무관, 모두 흐려질 때만 fading', () => {
  const items = [
    { id: '1', a: 's:A', b: 's:B', file: 'x.js', level: 'weak', k: 1, fading: false },
    { id: '2', a: 's:B', b: 's:A', file: 'y.js', level: 'strong', k: 0.4, fading: true },
    { id: '3', a: 's:A', b: 's:C', file: 'z.js', level: 'weak', k: 0.3, fading: true },
  ];
  const ps = conflictPairs(items);
  assert.equal(ps.length, 2);
  const ab = ps.find((p) => p.id === 's:A|s:B');
  assert.equal(ab.level, 'strong');
  assert.deepEqual(ab.files, ['y.js', 'x.js']);
  assert.equal(ab.k, 1);
  assert.equal(ab.fading, false);
  assert.equal(pairChipText(ab), 'y.js 외 1');
  assert.equal(ps.find((p) => p.id === 's:A|s:C').fading, true);
});

test('곡선 제어점: 두 메인 수직 방향으로 휨, 여러 개면 번갈아 반대쪽, Planet 은 위로', () => {
  const a = { x: 0, y: 0, z: 0 }, b = { x: 10, y: 0, z: 0 };
  const c0 = arcControl(a, b, 0, 'flat'), c1 = arcControl(a, b, 1, 'flat');
  assert.ok(Math.abs(c0.x - 5) < 1e-9 && c0.z > 0 && c1.z < 0);
  assert.ok(arcControl(a, b, 0, 'up').y > c0.y);
  const m = bez2(a, c0, b, 0.5);
  assert.ok(m.z > 0 && Math.abs(m.x - 5) < 1e-9);
});

test('세션 표식: 색 칸·브랜치·컨텍스트 단계, 칸 없으면 빈 글', () => {
  assert.equal(sessBadgeHtml(null, null), '');
  const h = sessBadgeHtml(3, { pct: 82, used: 164000, limit: 200000 }, 'feat/<x>');
  assert.match(h, /sess-badge s3/);
  assert.match(h, /lv-warn/);
  assert.match(h, /feat\/&lt;x&gt;/);
  assert.equal(branchOf({ meta: { git: 'main', worktree: 'wt-1' } }), 'wt-1');
  assert.equal(branchOf({ meta: { git: 'main' } }), 'main');
  const colors = sessionColorMap([{ projectId: 'p', liveList: [{ sessionId: 'a', entrypoint: 'cli' }, { sessionId: 'b', entrypoint: 'cli' }] }]);
  assert.ok(Number.isInteger(nodeSessIdx({ rootSessionId: 'a' }, colors)));
  assert.equal(nodeSessIdx({ rootSessionId: 'zz' }, colors), null);
});

test('ConflictBook: 같은 id 의 on 은 갱신, 강약 바뀜 반영', () => {
  const b = new ConflictBook();
  const c = { id: 'A|B|k', a: 'A', b: 'B', k: 'k', n: 'k.js', level: 'weak' };
  b.apply(conflictEvent(c, 'on', 't'), 0);
  b.apply(conflictEvent({ ...c, level: 'strong' }, 'on', 't'), 10);
  assert.equal(b.size, 1);
  assert.equal(b.items(10)[0].level, 'strong');
});

test('가짜 전체 보기(?multi=1): live 메인 3·2·5, 같은 파일 충돌이 스냅샷에, 같은 메인끼리는 충돌 없음', () => {
  const m = createOverviewMock({ projects: 4, mainsPerProject: [3, 2, 0, 5], seed: 2026, now: () => Date.parse('2026-10-24T05:00:00Z') });
  const snap = m.snapshot();
  const live = (pid) => snap.projects.find((p) => p.projectId === pid).liveList.filter((s) => s.entrypoint === 'cli').length;
  assert.equal(live('demo-alpha'), 3);
  assert.equal(live('demo-beta'), 2);
  assert.equal(live('demo-delta'), 5);
  assert.ok(snap.conflicts.length > 0, '미리 돌린 25초 안에 같은 파일 충돌');
  for (const c of snap.conflicts) { assert.notEqual(c.nodeId, c.peer); assert.ok(c.file && (c.level === 'strong' || c.level === 'weak')); }
  // 파일 도구 tool-start 에 정규화 경로
  assert.ok(snap.recent.some((e) => e.type === 'tool-start' && e.file && /^[a-z]:\//.test(e.file.k)));
  m.stop();
});

test('테마 토큰: 세션 색 8·충돌 주황이 다크·라이트(두 곳)에, 팔레트와 같은 값, 세 표현이 읽음', () => {
  const css = fs.readFileSync(new URL('../theme.css', import.meta.url), 'utf8');
  assert.equal((css.match(/--sess-0:/g) || []).length, 3);
  assert.equal((css.match(/--conflict:/g) || []).length, 3);
  for (let i = 0; i < 8; i++) {
    assert.ok(css.includes(`--sess-${i}: ${SESS_PALETTE.dark[i]}`), `다크 ${i}`);
    assert.ok(css.includes(`--sess-${i}: ${SESS_PALETTE.light[i]}`), `라이트 ${i}`);
  }
  for (const f of ['../scene.js', '../flat/flat-view.js']) assert.match(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), /'sess-7', 'conflict'/);
});

test('리더선(§66.8): 길이 상한을 넘는 먼 자리는 쓰지 않음(숨김), 점선·옅게', async () => {
  const { placeLabels, LEAD_MAX, labelReserve, smoothReserve } = await import('../label-place.mjs');
  // 노드 하나, 바로 아래·조금 먼 자리는 막혀 있고 아주 먼 자리만 비어 있음
  const c = { id: 'n', x: 100, y: 100, up: false, gap: 4, pin: 'soft', modes: [{ w: 60, h: 16, compact: true, mini: true }] };
  const block = [[0, 100, 300, 170]];
  const far = [40, 56, 74, 94];
  const r = placeLabels([c], [], { shifts: [0], farShifts: far, rects: block });
  assert.ok(!r.has('n'), `먼 자리(> ${LEAD_MAX}px)면 숨김`);
  const css = fs.readFileSync(new URL('../theme.css', import.meta.url), 'utf8');
  assert.match(css, /\.node-label\.lead::before \{[^}]*repeating-linear-gradient/);
  // 맞춤 라벨 자리: 맨 위 노드 위로 나간 라벨 높이
  const placed = new Map([['a', { box: [0, 40, 50, 60] }], ['b', { box: [0, 300, 50, 330] }]]);
  const res = labelReserve(placed, [{ id: 'a', x: 25, y: 70 }, { id: 'b', x: 25, y: 290 }], [{ id: 'a', x: 25, y: 70, r: 5 }, { id: 'b', x: 25, y: 290, r: 5 }]);
  assert.deepEqual(res, { top: 25, bottom: 35, left: 20, right: 20 }); // 가로: 노드(20～30) 밖으로 나간 라벨(0～50)
  assert.deepEqual(smoothReserve({ top: 60, bottom: 0, left: 0, right: 30 }, { top: 0, bottom: 40, left: 12, right: 0 }), { top: 48, bottom: 42, left: 12, right: 24 });
});
