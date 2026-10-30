// 배경음악 곡 목록·곡 선택 순수 모델. DOM 없음 — audio.js 가 쓰고 web/test/bgm.test.mjs 가 검사한다.
//   선택값(sel): 곡 id 하나 | 'auto'(활동 단계에 맞춰 고름, — 기본) | 'cycle'(곡 끝나면 다음 곡) | 'shuffle'(곡 끝나면 무작위 다른 곡)
//   localStorage 'ccviz.bgm.track' = 선택값 문자열, 'ccviz.bgm.last' = 마지막으로 튼 곡 id(순환·무작위가 이어서 고름)
//   테마별 풀: 매니페스트 views = {flow:[단계…], planet:[…], voxel:[…]} — 지금 표현(ccviz.view2)의 곡만 자동 선곡·팝업 위쪽. stage 는 하위 호환(테마 풀이 빌 때 폴백)
//   다국어: 매니페스트의 label_en·title_en·mood_en·key_en 을 영어 화면에서 label·title·mood·key 로 쓴다(없으면 기존 이름)
import { t as tr, isKo } from './i18n.mjs';

export const TRACK_KEY = 'ccviz.bgm.track';
export const LAST_KEY = 'ccviz.bgm.last';
export const MIG_KEY = 'ccviz.bgm.v'; // 이행 표시: '2' = 자동 기본 이행 끝
export const MODES = ['auto', 'cycle', 'shuffle'];
/** 재생 방식 이름(지금 언어) */
export const modeLabel = (m) => tr(`sound.mode.${m}`);
export const MODE_LABEL = Object.fromEntries(MODES.map((m) => [m, modeLabel(m)])); // 불러올 때 언어(새로고침으로 바뀜)
export const DEFAULT_TRACK = 'lofi'; // 매니페스트 기본 곡(자동·순환이 처음 고를 곳이 없을 때)
export const DEFAULT_SEL = 'auto';   // 선택기 기본값

/** 매니페스트가 없거나 깨졌을 때: 예전 한 곡(bgm.mp3·bgm.json)만 */
export const FALLBACK_TRACKS = [{ id: 'ambient', label: tr('sound.track.ambient'), title: tr('sound.track.ambient'), file: 'bgm.mp3', meta: 'bgm.json' }];

const str = (v) => (typeof v === 'string' && v.trim() ? v : null);
/** 곡 하나의 지금 언어 이름·제목·설명·조: 영어 화면이면 *_en 필드(없으면 기존 값) */
export function localTrackText(t, en = !isKo()) {
  const pick = (k) => (en && str(t[k + '_en'])) || t[k];
  const label = pick('label'), title = pick('title');
  return {
    label: String(label || title || t.label || t.title || t.id),
    title: String(title || label || t.title || t.label || t.id),
    mood: pick('mood') ? String(pick('mood')) : '',
    key: pick('key') ? String(pick('key')) : null,
  };
}

/** bgm-tracks.json → {tracks, def}. id·file 이 없는 항목·중복 id 는 버림. 하나도 안 남으면 null */
export function parseManifest(m) {
  if (!m || !Array.isArray(m.tracks)) return null;
  const seen = new Set();
  const tracks = [];
  for (const t of m.tracks) {
    if (!t || typeof t.id !== 'string' || !t.id || typeof t.file !== 'string' || !t.file) continue;
    if (MODES.includes(t.id) || seen.has(t.id)) continue;
    seen.add(t.id);
    const L = localTrackText(t);
    tracks.push({
      id: t.id,
      label: L.label,
      title: L.title,
      mood: L.mood,
      file: t.file,
      meta: typeof t.meta === 'string' ? t.meta : null,
      bpm: Number.isFinite(t.bpm) ? t.bpm : null,
      beats: Number.isInteger(t.beats) && t.beats >= 2 && t.beats <= 12 ? t.beats : 4, // 마디당 박 수(3/4 곡 = 3, 없으면 4)
      key: L.key,
      duration: Number.isFinite(t.duration) ? t.duration : null,
      stage: parseStage(t.stage, t.energy), // 자동 선곡 단계 목록(0 한가～3 매우 활발)
      views: parseViews(t.views), // 표현(테마)별 단계 {flow:[0,1], voxel:[1]} | null
      energy: Number.isFinite(t.energy) ? Math.max(0, Math.min(1, t.energy)) : null, // 0～1, 같은 단계 안 순서
    });
  }
  if (!tracks.length) return null;
  const def = tracks.some((t) => t.id === m.default) ? m.default : (tracks.some((t) => t.id === DEFAULT_TRACK) ? DEFAULT_TRACK : tracks[0].id);
  // 구간 이름(메타 json sections[].name) 영어 표 — 영어 화면에서만 audio.js 가 바꿔 보인다
  const sectionsEn = m.sections_en && typeof m.sections_en === 'object' && !Array.isArray(m.sections_en) ? m.sections_en : null;
  return { tracks, def, sectionsEn };
}

/** 구간 이름: 영어 화면이고 표에 있으면 영어, 아니면 그대로 */
export function sectionName(name, sectionsEn, en = !isKo()) {
  if (!en || !name || !sectionsEn) return name;
  const v = sectionsEn[name];
  return typeof v === 'string' && v ? v : name;
}

/** stage(정수 | 정수 목록) → 정렬된 단계 목록. 없으면 energy(0～1) 로 round(energy×3), 그것도 없으면 [] */
export function parseStage(stage, energy) {
  const arr = (Array.isArray(stage) ? stage : stage == null ? [] : [stage]).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 3);
  if (arr.length) return [...new Set(arr)].sort((x, y) => x - y);
  if (Number.isFinite(energy)) return [Math.max(0, Math.min(3, Math.round(Math.max(0, Math.min(1, energy)) * 3)))];
  return [];
}

/** 표현(테마) id — app.js 의 ccviz.view2 값 */
export const VIEWS = ['flow', 'planet', 'voxel'];

/** views({표현: 단계 | 단계 목록}) → {표현: 정렬된 단계 목록}. 모르는 표현·빈 목록은 버림, 하나도 없으면 null */
export function parseViews(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const k of VIEWS) {
    if (v[k] == null) continue;
    const s = parseStage(v[k]);
    if (s.length) out[k] = s;
  }
  return Object.keys(out).length ? out : null;
}

/** 그 표현에서 곡의 단계 목록(테마 풀에 없으면 []) */
export const viewStages = (t, view) => (t && t.views && t.views[view]) || [];

/** 테마별 풀을 쓸 수 있는지: 표현이 정해졌고 매니페스트에 views 가 있는 곡이 하나라도 */
export const themed = (tracks, view) => VIEWS.includes(view) && tracks.some((t) => t.views);

/** 활동 단계 이름(0 한가～3 매우 활발, 지금 언어) */
export const stageLabel = (i) => (i >= 0 && i <= 3 ? tr(`sound.stage.${i}`) : '');
export const STAGE_LABEL = [0, 1, 2, 3].map(stageLabel); // 불러올 때 언어

/** 저장값 → 유효한 선택값. 모르는 값이면 기본 곡 */
export function normalizeSel(v, tracks, def = DEFAULT_TRACK) {
  if (typeof v === 'string' && (MODES.includes(v) || tracks.some((t) => t.id === v))) return v;
  return tracks.some((t) => t.id === def) ? def : (tracks[0] ? tracks[0].id : null);
}

export const isMode = (sel) => MODES.includes(sel);

/**
 * 처음 선택값 + 이행. migrated = MIG_KEY 저장값이 '2' 인지.
 *   이행 전: 저장값이 없거나 · 예전 기본 로파이('lofi')거나 · 모르는 값이면 → 'auto'. 다른 곡·순환·무작위는 그대로 존중
 *   이행 뒤: 저장값 그대로(이제 'lofi' 는 사용자가 직접 고른 값), 없거나 모르면 'auto'
 * @returns {{sel: string, write: boolean}} write = 저장값·이행 표시를 써야 함
 */
export function initialSel(stored, migrated, tracks) {
  const valid = typeof stored === 'string' && (MODES.includes(stored) || tracks.some((t) => t.id === stored));
  if (!migrated) return { sel: !valid || stored === DEFAULT_TRACK ? DEFAULT_SEL : stored, write: true };
  return { sel: valid ? stored : DEFAULT_SEL, write: !valid };
}

/** 선택값으로 켤 때 첫 곡: 곡이면 그 곡, 순환·무작위면 마지막 곡(없으면 기본 곡) */
export function firstTrack(sel, tracks, last, def = DEFAULT_TRACK) {
  if (!isMode(sel) && tracks.some((t) => t.id === sel)) return sel;
  if (tracks.some((t) => t.id === last)) return last;
  return normalizeSel(def, tracks, def);
}

/** 곡이 끝났을 때 다음 곡. 순환: 목록 다음(끝이면 처음). 무작위: 지금 곡이 아닌 곡 중 하나(rand ∈ [0,1)) */
export function nextTrack(sel, tracks, cur, rand = Math.random) {
  if (!tracks.length) return null;
  const i = tracks.findIndex((t) => t.id === cur);
  if (sel === 'shuffle') {
    const pool = tracks.filter((t) => t.id !== cur);
    if (!pool.length) return tracks[0].id;
    const k = Math.min(pool.length - 1, Math.floor(Math.max(0, rand()) * pool.length));
    return pool[k].id;
  }
  return tracks[(i + 1) % tracks.length].id;
}

/** 단일 곡 선택이면 <audio loop>, 순환·무작위는 loop 끄고 ended 에서 다음 곡 */
export const loopFor = (sel) => !isMode(sel);

/**
 * 선택기 <option> 목록: 자동 + 단계별 묶음(group = optgroup 이름: 한가·보통·활발·매우 활발) + 순환·무작위.
 * 곡은 가장 낮은 단계 묶음에 한 번만(여러 단계 겸용이면 제목 풍선에 단계들), 묶음 안은 energy 순. 단계가 없는 곡은 '기타'
 * view(테마별 풀): 지금 표현의 곡을 그 표현 단계로 위에, 나머지 곡은 아래 '다른 테마' 묶음(stage 순). other = 다른 테마 곡인지
 */
export function optionList(tracks, view = null) {
  const th = themed(tracks, view);
  const stOf = (t) => (th ? viewStages(t, view) : (t.stage || []));
  const opt = (t) => {
    const s = stOf(t), other = th && !s.length;
    return { value: t.id, text: t.label, other,
      group: other ? tr('sound.group.otherTheme') : (s.length ? stageLabel(s[0]) : tr('sound.group.other')),
      title: [t.title, t.mood, t.bpm ? `${t.bpm} BPM` : '', t.key || '', s.length ? tr('sound.opt.stages', { stages: s.map(stageLabel).join('·') }) : ''].filter(Boolean).join(' · ') };
  };
  const st = (t) => { const s = stOf(t); return s.length ? s[0] : (th ? 10 + (t.stage && t.stage.length ? t.stage[0] : 9) : 9); };
  const sorted = tracks.map((t, i) => ({ t, i })).sort((a, b) => st(a.t) - st(b.t) || ((a.t.energy ?? 0.5) - (b.t.energy ?? 0.5)) || a.i - b.i).map((x) => x.t);
  return [
    { value: 'auto', text: modeLabel('auto'), group: null, title: tr('sound.opt.auto.title') },
    ...sorted.map(opt),
    { value: 'cycle', text: modeLabel('cycle'), group: null, title: tr('sound.mode.cycle.title') },
    { value: 'shuffle', text: modeLabel('shuffle'), group: null, title: tr('sound.mode.shuffle.title') },
  ];
}
