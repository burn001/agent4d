// 화면 잔여 문제 수리 시험: 라벨 장애물(패널·말풍선·섬 이름표)·좁은 화면 겹침 0·섬 최소 크기·연속 재생 수동 속도·띄움 점선. 합성 값만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { placeLabels, boxHit, textWidth, dodgeBox, LABEL_SHIFTS, LABEL_FAR_SHIFTS, LEAD_MIN } from '../label-place.mjs';
import { computeOverview, ISLAND_MIN_K } from '../overview/layout.mjs';
import { demoTargetSpeed, demoSpeedAt } from '../replay/demo-core.mjs';
import { spawnTarget, spawnLinks, spawnTag, dashSpans } from '../spawn-link.mjs';

const full = (w = 200, h = 44) => ({ compact: false, w, h });
const small = (w = 90, h = 30) => ({ compact: true, w, h });
const mini = (w = 60, h = 18) => ({ compact: true, mini: true, w, h });

test('라벨은 장애물 사각형(도구 패널·말풍선·섬 이름표)을 피해 옆·아래로 비킨다', () => {
  // 노드 (100,100) 아래 라벨 자리에 패널이 있으면 → 밀린 자리
  const panel = [90, 108, 110, 128];
  const r = placeLabels([{ id: 'A', x: 100, y: 100, up: false, gap: 8, modes: [{ w: 80, h: 20 }] }], [], { shifts: LABEL_SHIFTS, rects: [panel] });
  const a = r.get('A');
  assert.ok(a && !boxHit(a.box, panel), '패널과 겹치지 않는 자리');
  // 피할 곳이 없으면 고정이 아닌 라벨은 숨김
  const r2 = placeLabels([{ id: 'B', x: 100, y: 100, up: false, gap: 8, modes: [{ w: 80, h: 20 }] }], [], { shifts: [0], rects: [[0, 0, 400, 400]] });
  assert.equal(r2.has('B'), false);
  // 단단한 고정(pin true)도 장애물에 걸친 자리는 흐리게 쓰지 않는다(가려지므로) → 숨김
  const r3 = placeLabels([{ id: 'C', x: 100, y: 100, up: false, gap: 8, pin: true, modes: [{ w: 80, h: 20 }] }], [], { shifts: [0], rects: [[0, 0, 400, 400]] });
  assert.equal(r3.has('C'), false);
});

test('작업 중 라벨(pin soft): 줄임 → 이름만 → 먼 자리(리더선), 그래도 없으면 숨김 — 겹친 채 흐리게 남지 않음', () => {
  const discs = [{ id: 'A', x: 100, y: 100, r: 14 }, { id: 'B', x: 100, y: 128, r: 14 }];
  const c = { id: 'A', x: 100, y: 100, up: false, gap: 18, pin: 'soft', modes: [full(), small(), mini()] };
  // 가까운 자리는 모두 B 에 걸림 → 먼 자리에서 리더선
  const r = placeLabels([c], discs, { shifts: LABEL_SHIFTS, farShifts: LABEL_FAR_SHIFTS }).get('A');
  assert.ok(r, '먼 자리에 놓임');
  assert.equal(r.dim, false);
  assert.ok(r.lead === 0 || r.lead >= LEAD_MIN, '멀리 밀린 자리면 리더선');
  assert.ok(!discs.some((d) => d.id !== 'A' && Math.hypot(Math.max(r.box[0], Math.min(d.x, r.box[2])) - d.x, Math.max(r.box[1], Math.min(d.y, r.box[3])) - d.y) < d.r), '이웃 노드에 안 걸침');
  // 먼 자리도 없으면(화면 전체가 막힘) 숨김 — 예전처럼 흐리게 겹쳐 남지 않는다
  const r2 = placeLabels([c], discs, { shifts: LABEL_SHIFTS, farShifts: LABEL_FAR_SHIFTS, rects: [[-1000, 120, 1000, 1000]] });
  assert.equal(r2.has('A'), false);
  // 루트·메인·장치(pin true)는 빈 자리가 없을 때만 노드에 걸쳐 흐리게(라벨·장애물과는 안 겹침)
  const r3 = placeLabels([{ ...c, pin: true }], discs, { shifts: [0] }).get('A');
  assert.ok(r3 && r3.dim, '빈 자리 없으면 흐리게');
  assert.equal(placeLabels([{ ...c, pin: 'soft' }], discs, { shifts: [0] }).has('A'), false, '작업 중 라벨은 같은 상황에서 숨김');
});

test('좁은 화면(390px) 촘촘한 작업 노드 8개: 놓인 라벨끼리 겹침 0', () => {
  const discs = [], cands = [];
  for (let i = 0; i < 8; i++) {
    const x = 120 + (i % 4) * 50, y = 300 + Math.floor(i / 4) * 40;
    discs.push({ id: 'n' + i, x, y, r: 12 });
    cands.push({ id: 'n' + i, x, y, up: false, gap: 16, pin: 'soft', modes: [full(220, 46), small(120, 30), mini(70, 18)] });
  }
  const r = placeLabels(cands, discs, { shifts: LABEL_SHIFTS, farShifts: LABEL_FAR_SHIFTS, bounds: [0, 390] });
  const boxes = [...r.values()].map((x) => x.box);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!boxHit(boxes[i], boxes[j]), `겹침 ${i}-${j}`);
  for (const x of r.values()) assert.equal(x.dim, false, '작업 중 라벨은 흐리게 겹치지 않음');
  for (const b of boxes) assert.ok(b[0] >= 0 && b[2] <= 390, '화면 안');
  assert.ok(r.size >= 4, '절반 이상은 보임');
});

test('글자 폭 추정: 한글은 글자 크기만큼, 영문은 0.62 배', () => {
  assert.equal(textWidth('가나다', 10), 30);
  assert.equal(textWidth('abc', 10), Math.ceil(18.6));
  assert.ok(textWidth('러너 노드·보관함', 11) > 'abcdefghi'.length * 7.2, '예전 추정(글자 수 × 7.2)보다 넓음');
});

test('말풍선 비킴: 라벨 상자에 걸치면 위아래로 옮긴 dy, 다 막히면 null', () => {
  assert.equal(dodgeBox([0, 0, 50, 20], [[100, 100, 120, 120]]), 0);
  assert.equal(dodgeBox([0, 0, 50, 20], [[0, 0, 50, 10]]), 18);
  assert.equal(dodgeBox([0, 0, 50, 20], [[-100, -100, 100, 100]]), null);
});

test('섬 최소 크기: 작은 섬은 가장 큰 섬 반지름 × ISLAND_MIN_K 이상(섬 안 간격만 넓힘), 끄면 예전과 같음', () => {
  const N = (id, kind, parentId, pid) => ({ id, kind, parentId, status: 'active', projectId: pid, rootSessionId: id.slice(2), label: id, meta: {}, startedAt: '2026-10-24T01:00:00Z', lastActivityAt: '2026-10-24T01:00:00Z' });
  const nodes = new Map();
  nodes.set('s:big', N('s:big', 'main', null, 'BIG'));
  for (let i = 0; i < 24; i++) nodes.set('a:' + i, { ...N('a:' + i, 'subagent', 's:big', 'BIG'), rootSessionId: 'big' });
  nodes.set('s:sm', N('s:sm', 'main', null, 'SM'));
  nodes.set('a:x', { ...N('a:x', 'subagent', 's:sm', 'SM'), rootSessionId: 'sm' });
  const roots = [{ nodeId: 's:big', projectId: 'BIG' }, { nodeId: 's:sm', projectId: 'SM' }];
  const projects = [{ projectId: 'BIG', name: 'big', live: true, active: true }, { projectId: 'SM', name: 'sm', live: true, active: true }];
  const ov = computeOverview(nodes, roots, projects, null, { nowMs: Date.parse('2026-10-24T01:01:00Z') });
  const big = ov.clusters.find((c) => c.projectId === 'BIG'), sm = ov.clusters.find((c) => c.projectId === 'SM');
  const off = computeOverview(nodes, roots, projects, null, { nowMs: Date.parse('2026-10-24T01:01:00Z'), islandMin: 0 });
  const sm0 = off.clusters.find((c) => c.projectId === 'SM');
  // 섬 크기 = 대칭 경계 상자의 긴 변(반너비)
  const S = (c) => Math.max(c.box.hw, c.box.hd);
  const want = Math.max(S(sm0), Math.min(2.2 * S(sm0), S(big) * ISLAND_MIN_K));
  assert.ok(Math.abs(S(sm) - want) < 1e-6, `작은 섬 크기 ${S(sm)} 기대 ${want}(큰 섬 ${S(big)})`);
  // 섬 안 메인 → 자식 거리도 같은 배율
  const d = (o) => Math.hypot(o.pos.get('a:x').x - o.pos.get('s:sm').x, o.pos.get('a:x').z - o.pos.get('s:sm').z);
  assert.ok(Math.abs(d(ov) / d(off) - (sm.scale || 1)) < 1e-6);
  // 섬끼리 겹치지 않음
  assert.ok(Math.abs(big.center.x - sm.center.x) >= big.box.hw + sm.box.hw - 1e-6 || Math.abs(big.center.z - sm.center.z) >= big.box.hd + sm.box.hd - 1e-6);
});

test('연속 재생 속도: 수동이면 손대지 않음(null), 자동이면 demoSpeedAt', () => {
  const tl = { startTs: '2026-10-24T00:00:00Z', buckets: { size: 10_000, counts: new Array(30).fill(0) }, highlights: [] };
  const t = Date.parse(tl.startTs) + 100_000;
  assert.equal(demoTargetSpeed(tl, t, true), null);
  assert.equal(demoTargetSpeed(tl, t, false), demoSpeedAt(tl, t));
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /onSpeed: \(\) => \{ if \(demoOn\) \{ demoManual = true/);
  assert.match(app, /demoManual = false; syncDemoAuto\(\); \/\/ 다음 세션은 다시 자동 속도/);
  const ui = fs.readFileSync(new URL('../replay/ui.mjs', import.meta.url), 'utf8');
  assert.match(ui, /class="rp-auto"/);
  assert.match(ui, /if \(onSpeed\) onSpeed\(eng\.speed\)/, '[ ] 키도 수동으로 침');
});

test('띄움 점선: spawnedBy 가 보이면 그 노드, 퇴장했으면 보이는 가장 가까운 조상(메인), 없으면 같은 세션 메인', () => {
  const L = { id: 'b:L', kind: 'bash-bg', parentId: null, rootSessionId: 'S', meta: { launcher: { command: 'nohup bash relaunch.sh &' }, detached: true, spawnedBy: 'a:sub' } };
  const all = new Map([
    ['s:S', { id: 's:S', kind: 'main', parentId: null, meta: {} }],
    ['a:mid', { id: 'a:mid', kind: 'subagent', parentId: 's:S', meta: {} }],
    ['a:sub', { id: 'a:sub', kind: 'subagent', parentId: 'a:mid', meta: {} }],
    ['b:L', L],
  ]);
  const shownAll = (id) => all.has(id);
  assert.equal(spawnTarget(L, all, shownAll), 'a:sub');
  // a:sub 퇴장(배치에서 빠짐) → a:mid
  const lay = new Map([...all].filter(([id]) => id !== 'a:sub'));
  assert.equal(spawnTarget(L, lay, (id) => lay.has(id), all), 'a:mid');
  // a:mid 도 숨김 → 메인
  const lay2 = new Map([...lay].filter(([id]) => id !== 'a:mid'));
  assert.equal(spawnTarget(L, lay2, (id) => lay2.has(id), all), 's:S');
  assert.deepEqual(spawnLinks(lay2, (id) => lay2.has(id), all), [['b:L', 's:S']]);
  // 분리 기동기가 아니면 없음
  assert.equal(spawnTarget({ ...L, parentId: 's:S' }, all, shownAll), null);
  assert.equal(spawnTag(L), '띄움(nohup)');
  assert.equal(spawnTag({ ...L, meta: { ...L.meta, launcher: { command: 'setsid x' } } }), '띄움(setsid)');
  assert.equal(dashSpans(4, 0.5).length, 4);
  // 테마 토큰: 다크·라이트 모두 정의, 세 표현이 읽음
  const css = fs.readFileSync(new URL('../theme.css', import.meta.url), 'utf8');
  assert.equal((css.match(/--link-spawn:/g) || []).length, 3);
  for (const f of ['../scene.js', '../flat/flat-view.js', '../voxel/palette.js']) assert.match(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), /'link-spawn'/);
  const flow = fs.readFileSync(new URL('../flowview/flow-view.js', import.meta.url), 'utf8');
  assert.match(flow, /_updateSpawnLinks\(this\.tokens\)/, '흐름 표현도 점선을 그린다');
});

test('현재 메인이 섬 중심: live CLI 세션(busy 우선)의 루트 메인, /clear 로 sessionId 가 바뀌면 새 메인으로 교체', async () => {
  const { currentMain } = await import('../overview/layout.mjs');
  const T = (h) => `2026-10-24T0${h}:00:00Z`;
  const M = (sid, h) => ({ id: 's:' + sid, kind: 'main', parentId: null, status: 'idle', projectId: 'P', rootSessionId: sid, label: sid, meta: {}, startedAt: T(h), lastActivityAt: T(h) });
  const nodes = new Map([['s:old', M('old', 1)], ['s:new', M('new', 2)], ['a:k', { id: 'a:k', kind: 'subagent', parentId: 's:old', status: 'idle', projectId: 'P', rootSessionId: 'old', meta: {} }]]);
  const roots = [{ nodeId: 's:old', projectId: 'P' }, { nodeId: 's:new', projectId: 'P' }];
  const proj = (sid) => [{ projectId: 'P', name: 'p', live: true, active: true, liveList: [{ sessionId: sid, liveStatus: 'busy', entrypoint: 'cli', activityAt: T(3) }] }];
  const center = (ov) => ov.clusters[0].center;
  const at = (ov, id) => ov.pos.get(id);
  let ov = computeOverview(nodes, roots, proj('old'), null, { nowMs: Date.parse(T(3)) });
  assert.equal(ov.clusters[0].currentMain, 's:old');
  // 섬 = 실제 경계 상자 — 지금 메인이 무리 기준점(다른 루트는 둘레), 섬 상자 가운데 가까이
  const dc = (o, id) => Math.hypot(at(o, id).x - center(o).x, at(o, id).z - center(o).z);
  const near = (o, id) => dc(o, id) <= dc(o, id === 's:old' ? 's:new' : 's:old') + 1e-6;
  assert.ok(near(ov, 's:old'), '지금 메인(old)이 섬 가운데 쪽(다른 메인보다 가깝게)');
  assert.equal(ov.clusters[0].mains.find((m) => m.nodeId === 's:new').origin.x !== ov.clusters[0].mains.find((m) => m.nodeId === 's:old').origin.x || ov.clusters[0].mains.find((m) => m.nodeId === 's:new').origin.z !== ov.clusters[0].mains.find((m) => m.nodeId === 's:old').origin.z, true);
  // /clear: 같은 pid 의 sessionId 가 new 로 → 중심 교체(이전 메인은 둘레)
  ov = computeOverview(nodes, roots, proj('new'), ov, { nowMs: Date.parse(T(3)) });
  assert.equal(ov.clusters[0].currentMain, 's:new');
  // 새 메인이 무리 기준점(원점 메인), 이전 메인은 그 둘레(경계 원 밖) — 새 메인은 아직 작아 섬 상자 가운데와는 다를 수 있음
  const mo = (id) => ov.clusters[0].mains.find((m) => m.nodeId === id);
  assert.ok(mo('s:new').origin && Math.hypot(mo('s:old').origin.x - mo('s:new').origin.x, mo('s:old').origin.z - mo('s:new').origin.z) > 4, '이전 메인은 둘레(새 메인과 떨어져)');
  const pk = at(ov, 'a:k'), pn = at(ov, 's:new');
  assert.ok(Math.hypot(pk.x - pn.x, pk.z - pn.z) > 3, '이전 메인 무리가 새 메인에 겹치지 않음');
  // live 가 없으면(재생) 가장 최근 활동 메인
  const mains = [{ nodeId: 's:old', act: 1 }, { nodeId: 's:new', act: 2 }, { nodeId: 'b:L', act: 9, detached: true }];
  assert.equal(currentMain(mains, null).nodeId, 's:new');
  // claude -p(sdk-cli) live 는 후보 아님
  assert.equal(currentMain(mains, { liveList: [{ sessionId: 'old', entrypoint: 'sdk-cli', liveStatus: 'busy' }] }).nodeId, 's:new');
});

test('투영 상자 맞춤(refineFit): 한쪽으로 치우친 점들도 화면 가운데·한쪽 꽉 참, 거리는 상자 중심 맞춤보다 멀지 않음', async () => {
  const { refineFit, requiredDist, boxCenter } = await import('../camera-core.mjs');
  // 위에서 비스듬히(시선 아래 45°) 보는 기저
  const s = Math.SQRT1_2;
  const F = { x: 0, y: -s, z: -s }, R = { x: 1, y: 0, z: 0 }, U = { x: 0, y: s, z: -s };
  const pts = [{ p: { x: -20, y: 0, z: 10 }, r: 1 }, { p: { x: 30, y: 0, z: -15 }, r: 1 }, { p: { x: 5, y: 0, z: 25 }, r: 1 }];
  const tanH = 0.6, tanV = 0.4;
  const c0 = boxCenter(pts);
  const D0 = requiredDist(pts, c0, R, U, F, tanH, tanV);
  const { c, D } = refineFit(pts, c0, R, U, F, tanH, tanV, 3);
  assert.ok(D <= D0 + 1e-9, `${D} ≤ ${D0}`);
  // 한쪽(가로 또는 세로)은 여백 끝까지 닿음
  let mx = 0, my = 0;
  for (const { p, r } of pts) {
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    const x = dx * R.x + dy * R.y + dz * R.z, y = dx * U.x + dy * U.y + dz * U.z, z = dx * F.x + dy * F.y + dz * F.z;
    mx = Math.max(mx, (Math.abs(x) + r) / ((D + z) * tanH)); my = Math.max(my, (Math.abs(y) + r) / ((D + z) * tanV));
  }
  assert.ok(Math.max(mx, my) > 0.97 && Math.max(mx, my) <= 1.0001, `채움 ${mx.toFixed(3)} ${my.toFixed(3)}`);
});
