// node --test "web/test/bgm-list.test.mjs"   배경음악 플레이리스트·선곡 기준: 무드 태그·시간대·저장/이행·플레이리스트·다음/이전
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseManifest, MOODS as CORE_MOODS } from '../bgm-core.mjs';
import {
  RULES, MOODS, TIME_SLOTS, DEFAULT_TIME_MOODS, RULE_KEY, LIST_KEY, MOOD_KEY, REPEAT_KEY, TIME_KEY,
  timeSlot, trackMoods, loadPrefs, savePrefs, normTimeMoods, playlist, playlistGroups, listView,
  ruleCandidates, nextFor, prevFor, fitsRule, stepInList, activeMood, fmtDur, slotRange,
} from '../bgm-list.mjs';

const manifest = JSON.parse(readFileSync(new URL('../assets/bgm-tracks.json', import.meta.url), 'utf8'));
const M = parseManifest(manifest);
const at = (h) => new Date(2026, 10, 6, h, 30);
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };
const store = () => { const m = new Map(); return { m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, String(v)) }; };

test('매니페스트 무드: 모든 곡에 1～2개(아는 무드만), 무드마다 5곡 이상, tracks.py MOODS 와 같은 순서', () => {
  assert.deepEqual(MOODS, CORE_MOODS);
  const count = Object.fromEntries(MOODS.map((m) => [m, 0]));
  for (const t of M.tracks) {
    assert.ok(Array.isArray(t.moods) && t.moods.length >= 1 && t.moods.length <= 2, `${t.id} moods`);
    for (const m of t.moods) { assert.ok(MOODS.includes(m), `${t.id} ${m}`); count[m]++; }
  }
  for (const m of MOODS) assert.ok(count[m] >= 5, `${m} ${count[m]}곡`);
  const py = readFileSync(new URL('../../music/tracks.py', import.meta.url), 'utf8');
  const mm = py.match(/^MOODS = \(([^)]*)\)/m);
  assert.ok(mm, 'tracks.py MOODS');
  assert.deepEqual(mm[1].split(',').map((x) => x.trim().replace(/"/g, '')).filter(Boolean), MOODS);
});

test('무드 추정·시간대: 매니페스트에 moods 가 없으면 energy 로 하나, 시간대 경계(06·11·17·22시)', () => {
  assert.deepEqual(trackMoods({ id: 'a', energy: 0.1 }), ['calm']);
  assert.deepEqual(trackMoods({ id: 'a', energy: 0.4 }), ['focus']);
  assert.deepEqual(trackMoods({ id: 'a', energy: 0.6 }), ['bright']);
  assert.deepEqual(trackMoods({ id: 'a', energy: 0.9 }), ['drive']);
  assert.deepEqual(trackMoods({ id: 'a', moods: ['warm', 'nope', 'warm'] }), ['warm']);
  assert.deepEqual(trackMoods({ id: 'a' }), []);
  const want = { 0: 'night', 5: 'night', 6: 'morning', 10: 'morning', 11: 'day', 16: 'day', 17: 'evening', 21: 'evening', 22: 'night', 23: 'night' };
  for (const [h, s] of Object.entries(want)) assert.equal(timeSlot(Number(h)), s, `${h}시`);
  assert.equal(timeSlot(at(8)), 'morning');
  assert.equal(TIME_SLOTS.length, 4);
  assert.equal(slotRange('night'), '22–06');
  assert.deepEqual(DEFAULT_TIME_MOODS, { morning: 'warm', day: 'focus', evening: 'dreamy', night: 'calm' });
  assert.equal(activeMood({ rule: 'time', date: at(19) }), 'dreamy');
  assert.equal(activeMood({ rule: 'mood', mood: 'drive' }), 'drive');
  assert.equal(activeMood({ rule: 'shuffle' }), null);
});

test('저장·이행: 기본 작업 상태 · 예전 cycle→순차 루프 · 곡 id→작업 상태+한 곡 반복 · 예전 기본 로파이는 반복 아님 · 읽기 실패는 기본값', () => {
  const T = M.tracks;
  const ld = (o) => loadPrefs((k) => (k in o ? o[k] : null), T);
  assert.deepEqual(ld({}), { rule: 'activity', list: 'view', mood: 'focus', repeat: false, timeMoods: DEFAULT_TIME_MOODS, track: null, migrated: true });
  assert.equal(ld({ 'ccviz.bgm.track': 'cycle' }).rule, 'loop');
  assert.equal(ld({ 'ccviz.bgm.track': 'shuffle' }).rule, 'shuffle');
  assert.deepEqual([ld({ 'ccviz.bgm.track': 'jazz', 'ccviz.bgm.v': '2' })].map((p) => [p.rule, p.repeat, p.track])[0], ['activity', true, 'jazz']);
  assert.deepEqual([ld({ 'ccviz.bgm.track': 'jazz' })].map((p) => [p.rule, p.repeat])[0], ['activity', true]);
  assert.deepEqual([ld({ 'ccviz.bgm.track': 'lofi' })].map((p) => [p.rule, p.repeat])[0], ['activity', false], '§67 이행 전 기본 로파이');
  assert.equal(ld({ 'ccviz.bgm.track': 'lofi', 'ccviz.bgm.v': '2' }).repeat, true);
  assert.equal(ld({ 'ccviz.bgm.track': '지워진곡' }).repeat, false);
  // 새 키가 있으면 예전 키는 보지 않음
  const p = ld({ [RULE_KEY]: 'mood', [MOOD_KEY]: 'warm', [LIST_KEY]: 'all', [REPEAT_KEY]: '1', [TIME_KEY]: '{"night":"dreamy","day":"nope"}', 'ccviz.bgm.track': 'cycle' });
  assert.deepEqual(p, { rule: 'mood', list: 'all', mood: 'warm', repeat: true, timeMoods: { ...DEFAULT_TIME_MOODS, night: 'dreamy' }, track: null, migrated: false });
  assert.equal(ld({ [RULE_KEY]: 'bogus', [LIST_KEY]: 'x', [MOOD_KEY]: 'x' }).list, 'view');
  assert.equal(loadPrefs(() => { throw new Error('denied'); }, T).rule, 'activity');
  assert.deepEqual(normTimeMoods('깨진 json'), DEFAULT_TIME_MOODS);
  // 쓰고 다시 읽기, 쓰기 실패는 조용히
  const s = store();
  savePrefs(s.set, { rule: 'time', list: 'all', mood: 'calm', repeat: false, timeMoods: { morning: 'bright' } });
  const q = loadPrefs(s.get, T);
  assert.deepEqual([q.rule, q.list, q.mood, q.repeat, q.timeMoods.morning, q.timeMoods.night], ['time', 'all', 'calm', false, 'bright', 'calm']);
  assert.doesNotThrow(() => savePrefs(() => { throw new Error('quota'); }, q));
});

test('플레이리스트: 이 표현 = 테마 풀(흐름↔Planet 공유, 연구소 곡이 없으면 복셀 오피스), 전체 = 모든 곡, 순서 = 단계 → energy', () => {
  const T = M.tracks;
  const all = playlist(T, 'all', 'flow');
  assert.equal(all.length, T.length);
  const flow = playlist(T, 'view', 'flow');
  assert.deepEqual(flow.map((r) => r.id), playlist(T, 'view', 'planet').map((r) => r.id), '흐름·Planet 같은 풀');
  assert.ok(flow.length > 10 && flow.length < T.length);
  for (const r of flow) assert.ok(r.t.views && (r.t.views.flow || r.t.views.planet), r.id);
  for (let i = 1; i < flow.length; i++) {
    const a = flow[i - 1], b = flow[i];
    assert.ok(a.stage <= b.stage, `${a.id} → ${b.id}`);
    if (a.stage === b.stage) assert.ok((a.t.energy ?? 0) <= (b.t.energy ?? 0));
  }
  // 복셀 탭 = 복셀 오피스 + 연구소 곡, 연구소 화면도 복셀 탭을 따라감
  const vx = playlist(T, 'view', 'voxel');
  assert.ok(vx.every((r) => r.t.views.voxel || r.t.views.lab));
  assert.ok(vx.some((r) => r.t.views.lab) && vx.some((r) => r.t.views.voxel));
  assert.deepEqual(playlist(T, 'view', 'lab').map((r) => r.id), vx.map((r) => r.id));
  assert.deepEqual(playlist(T, 'voxel', 'flow').map((r) => r.id), vx.map((r) => r.id), '탭 고정은 표현과 무관');
  assert.deepEqual(playlist(T, 'flow', 'voxel').map((r) => r.id), flow.map((r) => r.id));
  const noLab = T.filter((t) => !(t.views && t.views.lab));
  assert.deepEqual(playlist(noLab, 'view', 'lab').map((r) => r.id), playlist(noLab, 'view', 'voxel').map((r) => r.id), '연구소 곡이 없으면 복셀 오피스');
  assert.equal(listView(T, 'all', 'flow'), null);
  assert.equal(listView([{ id: 'a' }], 'view', 'flow'), null, '테마 정보가 없으면 전체');
  const g = playlistGroups(flow);
  assert.deepEqual(g.map((x) => x.stage), [0, 1, 2, 3]);
  assert.equal(g.reduce((n, x) => n + x.rows.length, 0), flow.length);
});

test('선곡 기준 후보: 작업 상태 = 그 단계 곡 · 무드/시간대 = 그 무드(목록에 없으면 전체의 같은 무드) · 셔플/루프 = 목록 전체', () => {
  const T = M.tracks;
  const base = { tracks: T, list: 'view', view: 'flow' };
  const a3 = ruleCandidates({ ...base, rule: 'activity', level: 3 });
  assert.ok(a3.length >= 3);
  for (const id of a3) { const t = T.find((x) => x.id === id); assert.ok((t.views.flow || []).includes(3) || (t.views.planet || []).includes(3), id); }
  const all0 = ruleCandidates({ ...base, list: 'all', rule: 'activity', level: 0 });
  assert.ok(all0.length > ruleCandidates({ ...base, rule: 'activity', level: 0 }).length, '전체 목록이면 모든 표현의 한가 곡');
  const dr = ruleCandidates({ ...base, rule: 'mood', mood: 'dreamy' });
  assert.ok(dr.length >= 3 && dr.every((id) => T.find((t) => t.id === id).moods.includes('dreamy')));
  const flowIds = new Set(playlist(T, 'view', 'flow').map((r) => r.id));
  assert.ok(dr.every((id) => flowIds.has(id)), '플레이리스트 안');
  // 흐름 풀에 포근 곡이 없으면 전체의 포근 곡으로
  const warmFlow = playlist(T, 'view', 'flow').filter((r) => r.moods.includes('warm'));
  const warm = ruleCandidates({ ...base, rule: 'mood', mood: 'warm' });
  assert.ok(warm.length >= 1 && warm.every((id) => T.find((t) => t.id === id).moods.includes('warm')));
  if (!warmFlow.length) assert.ok(warm.some((id) => !flowIds.has(id)));
  const morning = ruleCandidates({ ...base, list: 'all', rule: 'time', date: at(8) });
  assert.ok(morning.every((id) => T.find((t) => t.id === id).moods.includes('warm')));
  const night = ruleCandidates({ ...base, list: 'all', rule: 'time', date: at(23), timeMoods: { night: 'drive' } });
  assert.ok(night.every((id) => T.find((t) => t.id === id).moods.includes('drive')));
  assert.equal(ruleCandidates({ ...base, rule: 'shuffle' }).length, flowIds.size);
  assert.ok(fitsRule({ ...base, rule: 'mood', mood: 'dreamy', cur: dr[0] }));
  assert.ok(!fitsRule({ ...base, rule: 'mood', mood: 'dreamy', cur: 'swing' }));
  assert.ok(!fitsRule({ ...base, rule: 'loop', cur: 'swing' }), '복셀 곡은 흐름 목록 밖');
  assert.ok(fitsRule({ ...base, list: 'all', rule: 'loop', cur: 'swing' }));
  assert.deepEqual(RULES, ['activity', 'shuffle', 'loop', 'mood', 'time']);
});

test('다음·이전: 순차 루프는 목록 순서(끝 → 처음) · 셔플은 지금·최근 곡을 피함 · 무드는 그 무드 안 · 이전은 들은 기록, 없으면 앞 곡', () => {
  const T = M.tracks;
  const base = { tracks: T, list: 'view', view: 'voxel' };
  const ids = playlist(T, 'view', 'voxel').map((r) => r.id);
  assert.equal(nextFor({ ...base, rule: 'loop', cur: ids[0] }), ids[1]);
  assert.equal(nextFor({ ...base, rule: 'loop', cur: ids[ids.length - 1] }), ids[0]);
  assert.equal(nextFor({ ...base, rule: 'loop', cur: 'warp' }), ids[0], '목록 밖 곡이면 처음부터');
  assert.equal(stepInList(ids, ids[0], -1), ids[ids.length - 1]);
  for (let k = 0; k < 20; k++) {
    const r = nextFor({ ...base, rule: 'shuffle', cur: ids[3], recent: [ids[1], ids[2], ids[3]], rand: seq(k / 20) });
    assert.ok(ids.includes(r) && ![ids[1], ids[2], ids[3]].includes(r), `셔플 ${r}`);
  }
  for (let k = 0; k < 10; k++) {
    const r = nextFor({ ...base, rule: 'mood', mood: 'bright', cur: 'swing', rand: seq(k / 10) });
    assert.ok(T.find((t) => t.id === r).moods.includes('bright') && r !== 'swing');
  }
  const one = [{ id: 'x', views: { voxel: [1] }, moods: ['calm'], stage: [1] }];
  assert.equal(nextFor({ rule: 'shuffle', tracks: one, list: 'view', view: 'voxel', cur: 'x' }), 'x', '한 곡뿐이면 그 곡');
  assert.equal(nextFor({ rule: 'loop', tracks: [], list: 'all' }), null);
  assert.deepEqual(prevFor({ ...base, back: ['jazz', 'city', 'bossa'], cur: 'bossa' }), { id: 'city', fromBack: 1 });
  assert.deepEqual(prevFor({ ...base, back: ['jazz', '지워진곡'], cur: 'bossa' }), { id: 'jazz', fromBack: 0 });
  assert.deepEqual(prevFor({ ...base, back: [], cur: ids[2] }), { id: ids[1], fromBack: -1 });
  assert.equal(fmtDur(300), '5:00');
  assert.equal(fmtDur(61.6), '1:02');
  assert.equal(fmtDur(119.7), '2:00');
  assert.equal(fmtDur(null), '');
});

test('연결: audio.js 가 기준 API·호환 sel 을, sound-pop.js 가 탭·기준·재생 제어를, app.js ctl bgm 이 새 기준 낱말을 쓴다', () => {
  const a = readFileSync(new URL('../audio.js', import.meta.url), 'utf8');
  for (const f of ['setRule(r)', 'setList(l)', 'setMood(m)', 'setTimeMood(slot, m)', 'setRepeat(on)', 'playTrack(id)', 'next()', 'prev()', 'get sel()']) assert.ok(a.includes(f), f);
  assert.match(a, /mode: !this\.repeat/, '한 곡 반복이 아니면 끝 3초 전 다음 곡');
  const p = readFileSync(new URL('../sound-pop.js', import.meta.url), 'utf8');
  assert.match(p, /role', 'tablist'/);
  assert.match(p, /music\.playTrack\(r\.id\)/);
  assert.match(p, /sound\.setMusicOn\(!sound\.musicOn\)/, '재생/일시정지 = 음악 켬/끔');
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /bgmCommand\(/);
});

test('ctl bgm 풀이(§146): 기준 낱말 · mood/time 인자 · 목록 · repeat · next/prev · 곡 이름', async () => {
  const { bgmCommand } = await import('../bgm-list.mjs');
  const T = M.tracks;
  assert.deepEqual(bgmCommand('auto', T), { act: 'rule', rule: 'activity' });
  assert.deepEqual(bgmCommand('cycle', T), { act: 'rule', rule: 'loop' });
  assert.deepEqual(bgmCommand('Loop', T), { act: 'rule', rule: 'loop' });
  assert.deepEqual(bgmCommand('shuffle', T), { act: 'rule', rule: 'shuffle' });
  assert.deepEqual(bgmCommand('mood', T), { act: 'rule', rule: 'mood' });
  assert.deepEqual(bgmCommand('mood warm', T), { act: 'mood', mood: 'warm' });
  assert.equal(bgmCommand('mood sad', T).act, 'bad');
  assert.deepEqual(bgmCommand('time', T), { act: 'rule', rule: 'time' });
  assert.deepEqual(bgmCommand('time night drive', T), { act: 'time', slot: 'night', mood: 'drive' });
  assert.equal(bgmCommand('time noon calm', T).act, 'bad');
  assert.deepEqual(bgmCommand('all', T), { act: 'list', list: 'all' });
  assert.deepEqual(bgmCommand('list view', T), { act: 'list', list: 'view' });
  assert.deepEqual(bgmCommand('repeat', T), { act: 'repeat', on: true });
  assert.deepEqual(bgmCommand('repeat off', T), { act: 'repeat', on: false });
  assert.deepEqual(bgmCommand('next', T), { act: 'next' });
  assert.deepEqual(bgmCommand('jazz', T), { act: 'track', id: 'jazz' });
  assert.deepEqual(bgmCommand('Night Drive'.toLowerCase().split(' ')[1], T).act, 'track');
  assert.deepEqual(bgmCommand('없는곡', T), { act: 'not_found' });
});

test('§146.6 탭 세 개: 지금 표현의 탭 따라가기(기본) · 탭 고정 · 작업 상태는 따라가기면 §67 표현 풀(연구소 화면 = 연구소 곡), 복셀 탭 고정이면 오피스+연구소', async () => {
  const { TABS, tabOf, effectiveTab, pickActivity } = await import('../bgm-list.mjs');
  const T = M.tracks;
  assert.deepEqual(TABS, ['flow', 'voxel', 'all']);
  assert.deepEqual(['flow', 'planet', 'voxel', 'lab', null].map(tabOf), ['flow', 'flow', 'voxel', 'voxel', 'all']);
  assert.equal(effectiveTab('view', 'lab'), 'voxel');
  assert.equal(effectiveTab('all', 'lab'), 'all');
  assert.equal(effectiveTab('voxel', 'flow'), 'voxel');
  assert.equal(effectiveTab('bogus', 'planet'), 'flow');
  const labOnly = ruleCandidates({ rule: 'activity', tracks: T, list: 'view', view: 'lab', level: 0 });
  assert.ok(labOnly.length && labOnly.every((id) => T.find((t) => t.id === id).views.lab), '연구소 화면 따라가기 = 연구소 곡');
  const both = ruleCandidates({ rule: 'activity', tracks: T, list: 'voxel', view: 'lab', level: 0 });
  assert.ok(both.some((id) => T.find((t) => t.id === id).views.voxel) && both.some((id) => T.find((t) => t.id === id).views.lab));
  assert.equal(pickActivity({ tracks: T, list: 'view', view: 'lab', level: 0, cur: labOnly[0], keep: true }), labOnly[0]);
  for (let k = 0; k < 8; k++) assert.ok(labOnly.includes(pickActivity({ tracks: T, list: 'view', view: 'lab', level: 0, rand: () => k / 8 })));
  const { bgmCommand } = await import('../bgm-list.mjs');
  assert.deepEqual(bgmCommand('voxel', T), { act: 'list', list: 'voxel' });
  assert.deepEqual(bgmCommand('list flow', T), { act: 'list', list: 'flow' });
  assert.deepEqual(bgmCommand('view', T), { act: 'list', list: 'view' });
  // 저장값: 예전 'view'·'all' 그대로, 새 탭 값도 읽힘, 모르는 값은 따라가기
  const ld = (v) => loadPrefs((k) => (k === LIST_KEY ? v : k === RULE_KEY ? 'shuffle' : null), T).list;
  assert.deepEqual(['view', 'all', 'voxel', 'flow', 'lab', null].map(ld), ['view', 'all', 'voxel', 'flow', 'view', 'view']);
});
