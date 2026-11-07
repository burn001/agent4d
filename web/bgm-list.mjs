// 배경음악 플레이리스트·선곡 기준 순수 모델. DOM 없음 — audio.js·sound-pop.js 가 쓰고 web/test/bgm-list.test.mjs 가 검사한다.
//   플레이리스트 탭: 'flow' = 흐름 · Planet 곡 · 'voxel' = 복셀(오피스 + 연구소) 곡 · 'all' = 매니페스트 전체.
//   저장값 list: 'view' = 지금 표현의 탭을 따라감(기본 — 흐름·Planet → flow, 복셀 오피스·연구소 → voxel) | 'flow'|'voxel'|'all' = 그 탭에 고정
//   선곡 기준(rule): 'activity' 작업 상태(자동 — 기본) · 'shuffle' 셔플 · 'loop' 순차 루프 · 'mood' 무드 고정 · 'time' 시간대별 무드
//   한 곡 반복(repeat)은 기준과 따로 켜는 토글 — 켜면 지금 곡만 반복하고 기준의 자동 전환은 쉰다(예전 '곡 하나 선택')
//   무드(moods): 매니페스트 곡의 moods 목록(없으면 energy 로 추정). 시간대 → 무드 표는 사용자가 바꿀 수 있다
//   저장(localStorage, 모두 try/catch): ccviz.bgm.rule · ccviz.bgm.list · ccviz.bgm.mood · ccviz.bgm.repeat('1'|'0') · ccviz.bgm.timeMoods(JSON)
//   예전 ccviz.bgm.track(auto|cycle|shuffle|곡 id)은 rule 이 없을 때 한 번 옮긴다(auto→activity, cycle→loop, 곡 id→activity + 한 곡 반복)
import { t as tr } from './i18n.mjs';
import { themed, viewStages, MODES, MOODS, parseMoods } from './bgm-core.mjs';
import { pickAmong, viewCandidates, stageCandidates } from './bgm-auto.mjs';
import { labPoolView } from './lab/lab-audio.mjs';

export const RULE_KEY = 'ccviz.bgm.rule';
export const LIST_KEY = 'ccviz.bgm.list';
export const MOOD_KEY = 'ccviz.bgm.mood';
export const REPEAT_KEY = 'ccviz.bgm.repeat';
export const TIME_KEY = 'ccviz.bgm.timeMoods';

export const RULES = ['activity', 'shuffle', 'loop', 'mood', 'time'];
export const TABS = ['flow', 'voxel', 'all'];
export const LISTS = ['view', ...TABS];
/** 탭 → 그 탭에 드는 표현(매니페스트 views 키). 흐름·Planet 은 자동 선곡 풀도 한 묶음, 복셀 오피스·연구소는 탭만 한 묶음 */
export const TAB_VIEWS = { flow: ['flow', 'planet'], voxel: ['voxel', 'lab'] };
/** 표현 → 그 표현의 탭(모르면 전체) */
export const tabOf = (view) => Object.keys(TAB_VIEWS).find((k) => TAB_VIEWS[k].includes(view)) || 'all';
/** 저장값 list 와 지금 표현 → 보이는 탭 */
export const effectiveTab = (list, view) => (list === 'view' || !TABS.includes(list) ? tabOf(view) : list);
export const DEFAULT_RULE = 'activity';
export const DEFAULT_LIST = 'view';

export { MOODS, parseMoods }; // 무드 6종·정리 함수는 bgm-core(parseManifest 가 씀)
export const DEFAULT_MOOD = 'focus';

/** 시간대(시작 시각 포함 · 끝 시각 제외, 밤은 자정을 넘김) */
export const TIME_SLOTS = [
  { id: 'morning', from: 6, to: 11 },
  { id: 'day', from: 11, to: 17 },
  { id: 'evening', from: 17, to: 22 },
  { id: 'night', from: 22, to: 6 },
];
/** 기본 시간대 무드: 아침 포근(카페·어쿠스틱) · 낮 집중 · 저녁 몽환(노을·우주 앰비언트) · 밤 잔잔 */
export const DEFAULT_TIME_MOODS = { morning: 'warm', day: 'focus', evening: 'dreamy', night: 'calm' };

export const ruleLabel = (r) => tr(`sound.rule.${r}`);
export const moodLabel = (m) => tr(`sound.mood.${m}`);
export const slotLabel = (s) => tr(`sound.slot.${s}`);
export const listLabel = (l) => tr(`sound.list.${l}`);

const pad = (n) => String(n).padStart(2, '0');
/** 시간대 시각 범위 글: 06–11 */
export const slotRange = (s) => { const x = TIME_SLOTS.find((y) => y.id === s); return x ? `${pad(x.from)}–${pad(x.to)}` : ''; };

/** 시각(Date 또는 0～23 시) → 시간대 id */
export function timeSlot(d = new Date()) {
  const h = typeof d === 'number' ? ((Math.floor(d) % 24) + 24) % 24 : d.getHours();
  for (const s of TIME_SLOTS) {
    if (s.from < s.to ? h >= s.from && h < s.to : h >= s.from || h < s.to) return s.id;
  }
  return 'day';
}

/** 곡의 무드 목록: 매니페스트 moods(아는 무드만) — 없으면 energy 로 하나(< .25 잔잔 · < .5 집중 · < .75 경쾌 · 그 위 질주) */
export function trackMoods(t) {
  if (!t) return [];
  const m = Array.isArray(t.moods) ? t.moods.filter((x) => MOODS.includes(x)) : [];
  if (m.length) return [...new Set(m)];
  const e = Number.isFinite(t.energy) ? t.energy : null;
  if (e == null) return [];
  return [e < 0.25 ? 'calm' : e < 0.5 ? 'focus' : e < 0.75 ? 'bright' : 'drive'];
}

/** 저장값 정리 */
export const normRule = (v) => (RULES.includes(v) ? v : DEFAULT_RULE);
export const normList = (v) => (LISTS.includes(v) ? v : DEFAULT_LIST);
export const normMood = (v) => (MOODS.includes(v) ? v : DEFAULT_MOOD);
export function normTimeMoods(v) {
  let o = v;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { o = null; } }
  const out = { ...DEFAULT_TIME_MOODS };
  if (o && typeof o === 'object' && !Array.isArray(o)) for (const s of TIME_SLOTS) if (MOODS.includes(o[s.id])) out[s.id] = o[s.id];
  return out;
}

/**
 * 저장소에서 설정 읽기(+예전 ccviz.bgm.track 이행). get(k) → 문자열|null(실패는 null).
 * @returns {{rule, list, mood, repeat, timeMoods, track: string|null, migrated: boolean}} track = 이행으로 반복할 곡
 */
export function loadPrefs(get, tracks = []) {
  const g = (k) => { try { return get(k); } catch (e) { return null; } };
  const rawRule = g(RULE_KEY);
  let rule = normRule(rawRule), repeat = g(REPEAT_KEY) === '1', track = null, migrated = false;
  if (!RULES.includes(rawRule)) {
    const old = g('ccviz.bgm.track');
    migrated = true;
    if (old === 'cycle') rule = 'loop';
    else if (old === 'shuffle') rule = 'shuffle';
    // 곡 하나를 골라 둔 사용자 → 작업 상태 + 한 곡 반복(이행 전의 기본 로파이는 고른 값이 아니므로 제외)
    else if (old && !MODES.includes(old) && tracks.some((t) => t.id === old) && !(old === 'lofi' && g('ccviz.bgm.v') !== '2')) { rule = 'activity'; repeat = true; track = old; }
    else rule = DEFAULT_RULE;
  }
  return { rule, list: normList(g(LIST_KEY)), mood: normMood(g(MOOD_KEY)), repeat, timeMoods: normTimeMoods(g(TIME_KEY)), track, migrated };
}

/** 설정 쓰기(set(k, v) 실패는 무시) */
export function savePrefs(set, p) {
  const s = (k, v) => { try { set(k, v); } catch (e) {} };
  s(RULE_KEY, normRule(p.rule));
  s(LIST_KEY, normList(p.list));
  s(MOOD_KEY, normMood(p.mood));
  s(REPEAT_KEY, p.repeat ? '1' : '0');
  s(TIME_KEY, JSON.stringify(normTimeMoods(p.timeMoods)));
}

/** 따라가기('view')일 때 작업 상태 기준이 쓰는 표현 풀(연구소 곡이 없으면 복셀 오피스). 탭 고정·테마 정보 없음이면 null */
export function listView(tracks, list, view) {
  if (list !== 'view') return null;
  const v = labPoolView(tracks, view);
  return themed(tracks, v) ? v : null;
}

/**
 * 플레이리스트 행 목록(화면 순서 = 순차 루프 순서): 단계(0 한가 → 3 매우 활발) 다음 energy 다음 매니페스트 순.
 * 탭(effectiveTab)의 표현 곡만 — 단계 = 그 표현들 단계의 합집합, 'all'(또는 테마 정보 없음)은 전체(곡의 stage). 단계가 없는 곡은 맨 뒤(stage = null)
 * @returns {{id, t, stage: number|null, stages: number[], moods: string[], views: string[]}[]}
 */
export function playlist(tracks, list, view) {
  if (!Array.isArray(tracks) || !tracks.length) return [];
  const tab = effectiveTab(list, view);
  const vs = tab !== 'all' && tracks.some((t) => t.views) ? TAB_VIEWS[tab] : null;
  const rows = [];
  tracks.forEach((t, i) => {
    let s;
    if (vs) { const u = new Set(); for (const v of vs) for (const x of (t.views && t.views[v]) || []) u.add(x); s = [...u].sort((a, b) => a - b); if (!s.length) return; }
    else s = Array.isArray(t.stage) ? t.stage : [];
    rows.push({ id: t.id, t, i, stage: s.length ? s[0] : null, stages: s, moods: trackMoods(t), views: t.views ? Object.keys(t.views) : [] });
  });
  rows.sort((a, b) => (a.stage ?? 9) - (b.stage ?? 9) || (a.t.energy ?? 0.5) - (b.t.energy ?? 0.5) || a.i - b.i);
  return rows.map(({ i, ...r }) => r);
}

/** 플레이리스트 묶음(단계별): [{stage, rows}] — 화면 묶음 머리 */
export function playlistGroups(rows) {
  const out = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.stage === r.stage) last.rows.push(r);
    else out.push({ stage: r.stage, rows: [r] });
  }
  return out;
}

/** 무드 기준이 지금 고를 무드: 'mood' = 고른 무드, 'time' = 지금 시간대 무드, 그 밖은 null */
export function activeMood({ rule, mood, timeMoods, date = new Date() } = {}) {
  if (rule === 'mood') return normMood(mood);
  if (rule === 'time') return normTimeMoods(timeMoods)[timeSlot(date)];
  return null;
}

/**
 * 기준의 후보 곡 id(순서 = 플레이리스트 순서). level = 활동 단계(작업 상태 기준).
 *  activity: 따라가기면 그대로 지금 표현 풀의 그 단계 곡(연구소 화면 = 연구소 곡), 탭 고정이면 그 탭 행의 단계(가까운 단계 폴백)
 *  mood·time: 플레이리스트 안 그 무드 곡 → 없으면 전체 곡 중 그 무드 → 그것도 없으면 플레이리스트 전체
 *  shuffle·loop: 플레이리스트 전체
 */
export function ruleCandidates({ rule, tracks, list, view, level = null, mood, timeMoods, date } = {}) {
  const rows = playlist(tracks, list, view);
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  if (rule === 'activity') {
    const lv = Number.isInteger(level) ? level : 1;
    const v = listView(tracks, list, view);
    const c = v ? viewCandidates(lv, tracks, v) : stageCandidates(lv, rows.map((r) => ({ id: r.id, stage: r.stages })));
    const set = new Set(c);
    const inList = ids.filter((id) => set.has(id));
    return inList.length ? inList : c;
  }
  if (rule === 'mood' || rule === 'time') {
    const m = activeMood({ rule, mood, timeMoods, date });
    const inList = rows.filter((r) => r.moods.includes(m)).map((r) => r.id);
    if (inList.length) return inList;
    const any = tracks.filter((t) => trackMoods(t).includes(m)).map((t) => t.id);
    return any.length ? any : ids;
  }
  return ids;
}

/** 작업 상태 기준의 곡 하나(pickForLevel 과 같은 규칙, 후보만 플레이리스트 탭을 따름). keep = 지금 곡이 후보면 그대로 */
export function pickActivity(o = {}) {
  const c = ruleCandidates({ ...o, rule: 'activity' });
  if (!c.length) return null;
  if (o.keep && o.cur && c.includes(o.cur)) return o.cur;
  return pickAmong(c, o.tracks || [], { recent: o.recent || [], cur: o.cur || null, rand: o.rand || Math.random });
}

/** 순차 루프: 플레이리스트에서 cur 다음 곡(끝이면 처음, cur 가 목록에 없으면 처음). dir = -1 이면 앞 곡 */
export function stepInList(ids, cur, dir = 1) {
  if (!ids.length) return null;
  const i = ids.indexOf(cur);
  if (i < 0) return dir > 0 ? ids[0] : ids[ids.length - 1];
  return ids[(i + dir + ids.length) % ids.length];
}

/**
 * 곡이 끝났거나 '다음'을 눌렀을 때 다음 곡 id. recent = 최근 건 곡(오래된 것 → 최근).
 *  loop: 플레이리스트 다음 곡 · shuffle: 최근 곡을 피해 무작위 · activity·mood·time: 후보에서 최근·비슷한 곡을 피해 무작위(pickForLevel 과 같은 규칙)
 */
export function nextFor(o = {}) {
  const { rule, tracks = [], list, view, cur = null, recent = [], rand = Math.random } = o;
  if (rule === 'loop') return stepInList(playlist(tracks, list, view).map((r) => r.id), cur, 1);
  const c = ruleCandidates(o);
  if (!c.length) return null;
  const pool = c.length > 1 ? c.filter((id) => id !== cur) : c; // '다음'은 늘 다른 곡(후보가 하나뿐이면 그 곡)
  return pickAmong(pool, tracks, { recent, cur, rand });
}

/** 지금 곡이 기준에 맞는지(기준을 바꿨을 때 곡을 바꿀지): activity·mood·time 은 후보 안, shuffle·loop 는 플레이리스트 안 */
export function fitsRule(o = {}) {
  if (!o.cur) return false;
  return ruleCandidates(o).includes(o.cur);
}

/** '이전': 되돌아갈 곡 기록(back, 오래된 것 → 최근)에서 지금 곡이 아닌 마지막 곡, 없으면 플레이리스트 앞 곡 */
export function prevFor({ back = [], tracks = [], list, view, cur = null } = {}) {
  for (let i = back.length - 1; i >= 0; i--) if (back[i] !== cur && tracks.some((t) => t.id === back[i])) return { id: back[i], fromBack: i };
  return { id: stepInList(playlist(tracks, list, view).map((r) => r.id), cur, -1), fromBack: -1 };
}

/** 초 → m:ss */
export function fmtDur(s) {
  if (!Number.isFinite(s) || s <= 0) return '';
  const m = Math.floor(s / 60), r = Math.round(s - m * 60);
  return r === 60 ? `${m + 1}:00` : `${m}:${pad(r)}`;
}

/**
 * 원격 조작 `ctl bgm <값>` 풀이. 낱말:
 *   auto|activity → 작업 상태 · shuffle · loop|cycle → 순차 루프 · mood [무드] · time [시간대 무드] · view|flow|voxel|all(list …) 플레이리스트 탭 ·
 *   repeat [on|off|toggle] · next · prev · 그 밖은 곡 id(정확히) 또는 id·이름 일부
 * @returns {{act: string, [k: string]: any}|{act: 'not_found'}}
 */
export function bgmCommand(value, tracks = []) {
  const w = String(value || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const [a, b, c] = w;
  if (!a) return { act: 'not_found' };
  if (a === 'auto' || a === 'activity') return { act: 'rule', rule: 'activity' };
  if (a === 'shuffle') return { act: 'rule', rule: 'shuffle' };
  if (a === 'loop' || a === 'cycle') return { act: 'rule', rule: 'loop' };
  if (a === 'mood') return b ? (MOODS.includes(b) ? { act: 'mood', mood: b } : { act: 'bad', detail: MOODS.join('|') }) : { act: 'rule', rule: 'mood' };
  if (a === 'time') {
    if (!b) return { act: 'rule', rule: 'time' };
    if (!TIME_SLOTS.some((s) => s.id === b) || !MOODS.includes(c)) return { act: 'bad', detail: `time ${TIME_SLOTS.map((s) => s.id).join('|')} ${MOODS.join('|')}` };
    return { act: 'time', slot: b, mood: c };
  }
  if (a === 'list' && LISTS.includes(b)) return { act: 'list', list: b };
  if (a === 'flow' || a === 'planet') return { act: 'list', list: 'flow' };
  if (a === 'voxel' || a === 'lab') return { act: 'list', list: 'voxel' };
  if (LISTS.includes(a) && !b) return { act: 'list', list: a };
  if (a === 'repeat') return { act: 'repeat', on: b === 'off' ? false : b === 'toggle' ? 'toggle' : true };
  if ((a === 'next' || a === 'prev') && !b) return { act: a };
  const v = w.join(' ');
  const t = tracks.find((x) => x.id.toLowerCase() === v) || tracks.find((x) => x.id.toLowerCase().includes(v) || String(x.label || '').toLowerCase().includes(v) || String(x.title || '').toLowerCase().includes(v));
  return t ? { act: 'track', id: t.id } : { act: 'not_found' };
}
