// node --test "web/test/bgm-auto.test.mjs"   배경음악 자동 선곡: 활동 지표·단계·히스테리시스·곡 매핑·이행
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ActivityMeter, openToolNodes, activityLevel, AutoPicker, AUTO_TIMING, stageCandidates, pickForLevel, autoLabel, WINDOW_MS } from '../bgm-auto.mjs';
import { parseManifest, parseStage, initialSel, loopFor, isMode, normalizeSel } from '../bgm-core.mjs';

const T0 = Date.parse('2026-10-24T10:00:00Z');
const iso = (t) => new Date(t).toISOString();
const S = 1000;

test('ActivityMeter: 창 90초 안 이벤트·도구·분기, 시계가 뒤로 가면(재생 되감기) 미래 기록 버림', () => {
  const m = new ActivityMeter();
  m.note({ type: 'tool-start', ts: iso(T0 - 100 * S) }); // 창 밖
  m.note({ type: 'tool-start', ts: iso(T0 - 10 * S) });
  m.note({ type: 'text', ts: iso(T0 - 5 * S) });
  m.note({ type: 'node-add', node: { id: 'a', parentId: 's', kind: 'subagent' }, ts: iso(T0 - 3 * S) });
  m.note({ type: 'node-add', node: { id: 's', parentId: null, kind: 'main' }, ts: iso(T0 - 3 * S) }); // 메인은 분기 아님
  let r = m.sample(T0, []);
  assert.deepEqual([r.events, r.tools, r.spawns, r.windowMs], [4, 1, 1, WINDOW_MS]);
  r = m.sample(T0 - 20 * S, []); // 되감기
  assert.equal(r.events, 0);
  m.note({ type: 'text' }, T0); // ts 없으면 now
  assert.equal(m.sample(T0, []).events, 1);
});

test('작업 중 노드: 최근 30초 이벤트가 온 노드 + 창 안에 연 도구가 열린 노드(스냅샷 status 는 안 믿음)', () => {
  const m = new ActivityMeter();
  m.note({ type: 'text', nodeId: 'a', ts: iso(T0 - 5 * S) });
  m.note({ type: 'text', nodeId: 'a', ts: iso(T0 - 4 * S) });
  m.note({ type: 'text', nodeId: 'b', ts: iso(T0 - 50 * S) }); // 30초 넘음
  const nodes = [
    { id: 'c', status: 'done', openTools: [{ startedAt: iso(T0 - 20 * S) }] },
    { id: 'd', status: 'active', openTools: [{ startedAt: iso(T0 - 600 * S) }] }, // 오래 전 연 채 남은 도구
    { id: 'e', status: 'active', lastActivityAt: iso(T0) }, // 이벤트 없이 스냅샷만 active·방금
    { id: 'a', status: 'active', openTools: [{ startedAt: iso(T0 - 1 * S) }] },
  ];
  assert.deepEqual(openToolNodes(nodes, T0), ['c', 'a']);
  assert.equal(m.sample(T0, nodes).working, 2); // a, c
});

test('activityLevel: 0 한가 · 1 보통 · 2 활발 · 3 매우 활발', () => {
  const L = (o) => activityLevel({ events: 0, tools: 0, spawns: 0, working: 0, windowMs: WINDOW_MS, ...o });
  assert.equal(L({}), 0);
  assert.equal(L({ events: 2 }), 0);
  assert.equal(L({ events: 3 }), 1);
  assert.equal(L({ tools: 1, events: 1 }), 1);
  assert.equal(L({ working: 1 }), 1);
  assert.equal(L({ tools: 17, events: 30 }), 1); // 분당 11.3
  assert.equal(L({ tools: 18, events: 36 }), 2); // 분당 12
  assert.equal(L({ working: 3 }), 2);
  assert.equal(L({ spawns: 2 }), 2);
  assert.equal(L({ events: 90 }), 2); // 분당 60
  assert.equal(L({ working: 6 }), 3);
  assert.equal(L({ spawns: 5 }), 3);
  assert.equal(L({ tools: 60, working: 3 }), 3); // 분당 40 + 동시 3
  assert.equal(L({ tools: 60, working: 2 }), 2);
  assert.equal(activityLevel(null), 0);
});

test('AutoPicker: 처음은 바로, 올림 45초·내림 120초 유지, 전환 뒤 최소 90초, 출렁임 무시', () => {
  assert.deepEqual(AUTO_TIMING, { up: 45000, down: 120000, minHold: 90000, warmup: 20000 });
  // 처음 20초는 바로 따라감(열자마자 0 단계에 묶이지 않게)
  const w = new AutoPicker();
  assert.equal(w.step(0, 0), 0);
  assert.equal(w.step(2, 4 * S), 2);
  assert.equal(w.step(1, 10 * S), 1);
  assert.equal(w.step(3, 22 * S), 1, '워밍업 뒤엔 히스테리시스');
  const p = new AutoPicker({ warmup: 0 });
  assert.equal(p.step(1, 0), 1);
  // 최소 유지 90초 안: 올림 조건이 차도 그대로
  for (let t = 2; t <= 88; t += 2) assert.equal(p.step(2, t * S), 1);
  assert.equal(p.step(2, 90 * S), 2, '90초 지나면(올림 유지 88초 ≥ 45초) 올림');
  // 잠깐 올랐다 내려오면 무시
  for (let t = 92; t < 300; t += 2) assert.equal(p.step(t % 20 === 0 ? 3 : 2, t * S), 2);
  // 내림: 120초 유지 필요
  let t = 300;
  for (; t < 300 + 118; t += 2) assert.equal(p.step(0, t * S), 2);
  assert.equal(p.step(0, (300 + 120) * S), 0);
  // 올림은 그 기간 최저 단계로(3·2 섞이면 2)
  const q = new AutoPicker({ up: 10 * S, down: 20 * S, minHold: 0, warmup: 0 });
  q.step(0, 0);
  q.step(3, 1 * S); q.step(2, 5 * S); q.step(3, 9 * S);
  assert.equal(q.step(3, 11 * S), 2);
  // 내림은 그 기간 최고 단계로
  q.step(1, 12 * S); q.step(0, 20 * S);
  assert.equal(q.step(0, 32 * S), 1);
  // 같은 단계로 돌아오면 타이머 리셋
  const r = new AutoPicker({ up: 10 * S, down: 10 * S, minHold: 0, warmup: 0 });
  r.step(1, 0); r.step(2, 1 * S); r.step(1, 8 * S);
  assert.equal(r.step(2, 12 * S), 1);
  assert.equal(r.step(2, 22 * S), 2);
});

test('단계 → 후보(매니페스트 stage 데이터), 빈 단계는 가까운 단계, 직전 2곡 피해 무작위', () => {
  const m = parseManifest(JSON.parse(readFileSync(new URL('../assets/bgm-tracks.json', import.meta.url), 'utf8')));
  assert.deepEqual(stageCandidates(0, m.tracks), m.tracks.filter((t) => t.stage.includes(0)).map((t) => t.id));
  assert.ok(stageCandidates(0, m.tracks).includes('ambient'));
  for (const id of ['lofi', 'jazz', 'chillhop']) assert.ok(stageCandidates(1, m.tracks).includes(id), id);
  assert.ok(stageCandidates(2, m.tracks).includes('city'));
  assert.ok(stageCandidates(3, m.tracks).length >= 1);
  assert.deepEqual(parseStage([3, 2, 2]), [2, 3]);
  assert.deepEqual(parseStage(null, 0.7), [2]);
  assert.deepEqual(parseStage(undefined, undefined), []);
  // 빈 단계 대체: 같은 거리면 낮은(차분한) 쪽
  const tr = [{ id: 'a', stage: [0] }, { id: 'b', stage: [1] }, { id: 'd', stage: [3] }];
  assert.deepEqual(stageCandidates(2, tr), ['b']);
  assert.deepEqual(stageCandidates(3, [{ id: 'a', stage: [0] }, { id: 'b', stage: [1] }]), ['b']);
  assert.deepEqual(stageCandidates(1, [{ id: 'x' }, { id: 'y' }]), ['x', 'y']);
  assert.deepEqual(stageCandidates(1, []), []);
  // 직전 2곡 회피
  const s1 = [{ id: 'p', stage: [1] }, { id: 'q', stage: [1] }, { id: 'r', stage: [1] }];
  for (const r of [0, 0.5, 0.99]) assert.equal(pickForLevel(1, s1, { recent: ['p', 'q'], rand: () => r }), 'r');
  assert.equal(pickForLevel(1, s1, { recent: ['p'], cur: 'q', rand: () => 0 }), 'r');
  assert.equal(pickForLevel(1, s1, { recent: ['p', 'q'], cur: 'q', rand: () => 0 }), 'r', 'cur 가 최근 끝과 같아도 직전 2곡(p·q) 회피');
  const s2 = [{ id: 'p', stage: [1] }, { id: 'q', stage: [1] }];
  assert.equal(pickForLevel(1, s2, { recent: ['p', 'q'], rand: () => 0 }), 'p', '다 피하면 직전 1곡만 피함');
  assert.equal(pickForLevel(1, [{ id: 'solo', stage: [1] }], { cur: 'solo' }), 'solo');
  // keep: 지금 곡이 새 단계 후보에 있으면 그대로(여러 단계 겸용 곡)
  assert.equal(pickForLevel(3, [{ id: 'c', stage: [2, 3] }, { id: 'z', stage: [3] }], { cur: 'c', keep: true }), 'c');
  assert.equal(autoLabel({ label: '재즈' }, 1), '자동 · 재즈(보통)');
  assert.equal(autoLabel(null, 2), '자동');
});

test('선택값 이행: 없음·예전 기본 로파이 → 자동, 다른 곡·순환은 존중, 이행 뒤 로파이는 그대로', () => {
  const tr = ['ambient', 'lofi', 'jazz', 'city'].map((id) => ({ id }));
  assert.deepEqual(initialSel(null, false, tr), { sel: 'auto', write: true });
  assert.deepEqual(initialSel('lofi', false, tr), { sel: 'auto', write: true });
  assert.deepEqual(initialSel('지워진곡', false, tr), { sel: 'auto', write: true });
  assert.deepEqual(initialSel('jazz', false, tr), { sel: 'jazz', write: true });
  assert.deepEqual(initialSel('cycle', false, tr), { sel: 'cycle', write: true });
  assert.deepEqual(initialSel('lofi', true, tr), { sel: 'lofi', write: false });
  assert.deepEqual(initialSel('auto', true, tr), { sel: 'auto', write: false });
  assert.deepEqual(initialSel(null, true, tr), { sel: 'auto', write: true });
  assert.ok(isMode('auto'));
  assert.equal(loopFor('auto'), false, '자동은 loop 끄고 ended 에서 지금 단계 곡');
  assert.equal(normalizeSel('auto', tr), 'auto');
});

test('audio.js·app.js 연결: 활동 출처·이행 키·일시정지 시 단계 시계 멈춤', () => {
  const a = readFileSync(new URL('../audio.js', import.meta.url), 'utf8');
  assert.match(a, /setActivitySource\(fn\)/);
  assert.match(a, /initialSel\(lsGet\(TRACK_KEY\), lsGet\(MIG_KEY\) === '2'/);
  assert.match(a, /if \(\(this\.paused \|\| \(this\._isHeld && this\._isHeld\(\)\)\) && !first\) return;/);
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /music\.setActivitySource\(\(\) => activity\.sample\(clockFn\(\), store\.nodes\.values\(\)\), \(\) => pauseBuf\.paused\)/);
  assert.match(app, /if \(fx\) \{\n    activity\.note\(ev, clockFn\(\)\);/);
});

test('§67 테마별 풀: 매니페스트 views 가 확정 분류와 같고, 지금 표현의 그 단계 곡만 후보', async () => {
  const { viewCandidates } = await import('../bgm-auto.mjs');
  const m = parseManifest(JSON.parse(readFileSync(new URL('../assets/bgm-tracks.json', import.meta.url), 'utf8')));
  const POOL = {
    // 2026-10-30 표현×단계 2곡씩 24곡 추가(뒤쪽 두 id)
    flow: [['lofi', 'pulse', 'glacier', 'cursor'], ['lofi', 'deephouse', 'circuit', 'refactor', 'queue'], ['drive', 'deephouse', 'stack', 'sprint'],
      ['liquid', 'uplift', 'overclock', 'hotfix', 'deadline']],
    planet: [['orbit', 'ambient', 'aurora', 'deepfield'], ['stardust', 'nebula', 'comet', 'satellite'], ['drive', 'pulsar', 'ionstorm', 'gravity'],
      ['uplift', 'warp', 'supernova', 'hyperspace']],
    voxel: [['dawn', 'bossa', 'rainwindow', 'teatime'], ['jazz', 'chillhop', 'lofi', 'typewriter', 'espresso'], ['city', 'funk', 'meeting', 'copier'],
      ['swing', 'caper', 'pantry', 'mambo']],
  };
  for (const [v, lv] of Object.entries(POOL)) {
    for (let i = 0; i < 4; i++) assert.deepEqual(viewCandidates(i, m.tracks, v).sort(), [...lv[i]].sort(), `${v} ${i}`);
    for (let i = 0; i < 4; i++) for (let k = 0; k < 20; k++) {
      const id = pickForLevel(i, m.tracks, { view: v, recent: ['lofi'], rand: () => k / 20 });
      assert.ok(lv[i].includes(id), `${v} ${i} → ${id}`);
    }
  }
  // 겹치는 곡: lofi 는 흐름 0·1, 복셀 1, Planet 풀엔 없음
  const lofi = m.tracks.find((t) => t.id === 'lofi');
  assert.deepEqual(lofi.views, { flow: [0, 1], voxel: [1] });
  assert.equal(pickForLevel(0, m.tracks, { view: 'flow', cur: 'lofi', keep: true }), 'lofi');
  assert.equal(pickForLevel(1, m.tracks, { view: 'voxel', cur: 'lofi', keep: true }), 'lofi');
  assert.notEqual(pickForLevel(1, m.tracks, { view: 'planet', cur: 'lofi', keep: true }), 'lofi'); // 표현을 바꾸면 그 테마 곡으로
  assert.notEqual(pickForLevel(0, m.tracks, { view: 'voxel', cur: 'lofi', keep: true }), 'lofi');
});

test('§67 테마별 풀 폴백: 표현 없음·views 없음·그 단계에 테마 곡 없음 → 전체 풀(stage)', async () => {
  const { viewCandidates } = await import('../bgm-auto.mjs');
  const tr = parseManifest({ tracks: [
    { id: 'a', file: 'a.mp3', stage: 0, views: { flow: [0] } },
    { id: 'b', file: 'b.mp3', stage: 1, views: { planet: 1 } },
    { id: 'c', file: 'c.mp3', stage: [1, 2], views: { flow: [2], bogus: [1] } },
    { id: 'd', file: 'd.mp3', stage: 3 },
  ] }).tracks;
  assert.deepEqual(tr.find((t) => t.id === 'c').views, { flow: [2] }); // 모르는 표현 버림
  assert.equal(tr.find((t) => t.id === 'd').views, null);
  assert.deepEqual(viewCandidates(0, tr, 'flow'), ['a']);
  assert.deepEqual(viewCandidates(1, tr, 'flow'), ['b', 'c']);   // 흐름 1단계 없음 → 전체 풀 stage 1
  assert.deepEqual(viewCandidates(3, tr, 'voxel'), ['d']);       // 복셀 풀 비어 있음 → 전체 풀
  assert.deepEqual(viewCandidates(1, tr, null), ['b', 'c']);     // 표현 모름 → 예전 규칙
  assert.deepEqual(viewCandidates(2, tr, 'planet'), ['c']);
  const plain = [{ id: 'x', stage: [1] }, { id: 'y', stage: [2] }];
  assert.deepEqual(viewCandidates(2, plain, 'flow'), ['y']);     // views 없는 매니페스트 = 예전 그대로
});

test('§67 곡 목록: 지금 표현 곡이 위에 단계별, 다른 테마 곡은 아래 묶음', async () => {
  const { optionList } = await import('../bgm-core.mjs');
  const m = parseManifest(JSON.parse(readFileSync(new URL('../assets/bgm-tracks.json', import.meta.url), 'utf8')));
  for (const v of ['flow', 'planet', 'voxel']) {
    const o = optionList(m.tracks, v).filter((x) => !isMode(x.value));
    assert.equal(o.length, m.tracks.length);
    const firstOther = o.findIndex((x) => x.other);
    assert.ok(firstOther > 0, v);
    assert.ok(o.slice(firstOther).every((x) => x.other), `${v}: 다른 테마는 끝에 몰림`);
    for (const x of o.slice(0, firstOther)) assert.ok(m.tracks.find((t) => t.id === x.value).views[v], `${v} ${x.value}`);
  }
  const f = optionList(m.tracks, 'flow').filter((x) => !isMode(x.value));
  assert.deepEqual(f.slice(0, 4).map((x) => x.value), ['glacier', 'pulse', 'cursor', 'lofi']); // 흐름 한가: energy 0.18 → 0.22 → 0.25 → 0.35
  assert.ok(f.every((x) => x.value !== 'orbit' || x.other));
  assert.ok(optionList(m.tracks).every((x) => !x.other)); // 표현 없으면 예전 목록
});

test('§67 2026-10-30 24곡: 표현×단계마다 4곡 이상 — 직전 2곡을 피해도 고를 곡이 2곡 이상 남고, 3/4 곡은 beats 3', async () => {
  const { viewCandidates } = await import('../bgm-auto.mjs');
  const m = parseManifest(JSON.parse(readFileSync(new URL('../assets/bgm-tracks.json', import.meta.url), 'utf8')));
  assert.equal(m.tracks.length, 46);
  for (const v of ['flow', 'planet', 'voxel']) for (let i = 0; i < 4; i++) {
    const c = viewCandidates(i, m.tracks, v);
    assert.ok(c.length >= 4, `${v} ${i}: ${c}`);
    const picks = new Set();
    for (let k = 0; k < 40; k++) picks.add(pickForLevel(i, m.tracks, { view: v, recent: c.slice(0, 2), cur: c[1], rand: () => k / 40 }));
    assert.ok(!picks.has(c[0]) && !picks.has(c[1]) && picks.size >= 2, `${v} ${i}: ${[...picks]}`);
  }
  const beats = Object.fromEntries(m.tracks.map((t) => [t.id, t.beats]));
  for (const id of ['queue', 'deepfield', 'teatime']) assert.equal(beats[id], 3, id);
  assert.equal(beats.lofi, 4);
});
