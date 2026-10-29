// 배경음악 '자동(상황 맞춤)' 순수 모델. DOM 없음 — audio.js·app.js 가 쓰고 web/test/bgm-auto.test.mjs 가 검사한다.
//   ActivityMeter: 최근 이벤트(재생 중이면 재생 시계 기준)를 창(90초) 안에서 센다 → activitySample
//   activityLevel: 지표 → 0 한가 · 1 보통 · 2 활발 · 3 매우 활발
//   AutoPicker:    단계 히스테리시스(올림 45초·내림 120초 유지, 전환 뒤 최소 90초) — 덜컥거림 방지
//   stageCandidates·pickForLevel: 매니페스트 곡의 stage(0～3, 목록 가능)로 단계 → 후보 → 직전 2곡 피해 무작위
//   viewCandidates: 지금 표현(flow·planet·voxel)의 테마 풀(views)에서 그 단계 곡, 비면 전체 풀(stageCandidates)로 폴백
import { t as tr } from './i18n.mjs';
import { stageLabel, themed, viewStages } from './bgm-core.mjs';

export const WINDOW_MS = 90_000;     // 활동 창(최근 1분 30초)
export const WORK_RECENT_MS = 30_000; // 작업 중 노드: 최근 30초 안 이벤트가 온 노드 + 창 안에 연 도구가 아직 열린 노드
export const levelLabel = stageLabel; // 단계 이름(지금 언어, 사전 sound.stage.N)
export const LEVEL_LABEL = [0, 1, 2, 3].map(stageLabel); // 불러올 때 언어

/** 단계 기준값. 창 90초 기준(분당 값은 창 길이로 환산) */
export const LEVEL_RULES = {
  // 3 매우 활발: 대량 분기·동시 작업 다수
  l3: { working: 6, spawns: 5, toolsPerMin: 40, toolsWithWorking: 3 },
  // 2 활발
  l2: { working: 3, spawns: 2, toolsPerMin: 12, eventsPerMin: 60 },
  // 1 보통: 무엇이든 움직임
  l1: { working: 1, tools: 1, events: 3 },
};

/** 히스테리시스 시간(밀리초) */
export const AUTO_TIMING = { up: 45_000, down: 120_000, minHold: 90_000, warmup: 20_000 };

const tsOf = (ev, fallback) => {
  const t = ev && ev.ts ? Date.parse(ev.ts) : NaN;
  return Number.isFinite(t) ? t : fallback;
};

/** 최근 이벤트 장부. note(ev, now) 로 쌓고 sample(now, nodes) 로 지표 */
export class ActivityMeter {
  constructor({ windowMs = WINDOW_MS } = {}) { this.windowMs = windowMs; this.list = []; }
  reset() { this.list.length = 0; }
  /** 이벤트 하나 기록(quiet·밀린 이벤트는 부르지 않는다). now = 지금 시계(재생이면 가상 시계) */
  note(ev, now = Date.now()) {
    if (!ev || !ev.type) return;
    const t = tsOf(ev, now);
    const kind = ev.type === 'tool-start' ? 't'
      : ev.type === 'node-add' && ev.node && ev.node.parentId && ev.node.kind !== 'main' ? 's'
        : 'e';
    this.list.push({ t, kind, node: ev.nodeId || (ev.node && ev.node.id) || null });
    if (this.list.length > 4000) this.list.splice(0, this.list.length - 4000);
  }
  /** 창 안 지표. 시계가 뒤로 가면(재생 되감기) 창 밖 미래 기록도 버린다 */
  sample(now = Date.now(), nodes = []) {
    const lo = now - this.windowMs;
    this.list = this.list.filter((x) => x.t > lo && x.t <= now + 2000);
    let events = 0, tools = 0, spawns = 0;
    for (const x of this.list) { events++; if (x.kind === 't') tools++; else if (x.kind === 's') spawns++; }
    // 작업 중: 스냅샷의 status·lastActivityAt 는 믿지 않는다(데모·전체 보기 스냅샷은 모든 노드가 active·방금으로 올 수 있음)
    const busy = new Set();
    for (const x of this.list) if (x.node && now - x.t <= WORK_RECENT_MS) busy.add(x.node);
    for (const id of openToolNodes(nodes, now, this.windowMs)) busy.add(id);
    return { events, tools, spawns, working: busy.size, windowMs: this.windowMs };
  }
}

/** 창 안에 연 도구가 아직 열린 노드 id(오래 전에 열린 채 남은 도구는 빼서, 끊긴 기록이 '작업 중'을 부풀리지 않게) */
export function openToolNodes(nodes, now = Date.now(), windowMs = WINDOW_MS) {
  const out = [];
  for (const x of nodes || []) {
    if (!x || !x.openTools || !x.openTools.length) continue;
    if (x.openTools.some((t) => { const s = t && t.startedAt ? Date.parse(t.startedAt) : NaN; return Number.isFinite(s) && now - s <= windowMs && s <= now + 2000; })) out.push(x.id);
  }
  return out;
}

/** 지표 → 단계 0～3 */
export function activityLevel(m, rules = LEVEL_RULES) {
  if (!m) return 0;
  const min = Math.max(1, m.windowMs || WINDOW_MS) / 60_000;
  const toolsPerMin = (m.tools || 0) / min, eventsPerMin = (m.events || 0) / min;
  const w = m.working || 0, s = m.spawns || 0;
  const { l3, l2, l1 } = rules;
  if (w >= l3.working || s >= l3.spawns || (toolsPerMin >= l3.toolsPerMin && w >= l3.toolsWithWorking)) return 3;
  if (w >= l2.working || s >= l2.spawns || toolsPerMin >= l2.toolsPerMin || eventsPerMin >= l2.eventsPerMin) return 2;
  if (w >= l1.working || (m.tools || 0) >= l1.tools || (m.events || 0) >= l1.events) return 1;
  return 0;
}

/**
 * 단계 히스테리시스. step(raw, t) → 지금 정한 단계. t 는 단조 시계(밀리초, 일시정지 동안은 멈춘 시계를 넘긴다).
 *   - 처음 warmup(20초) 동안은 바로 그 단계를 따른다(열자마자 스냅샷·첫 이벤트가 들어오는 사이 0 단계에 묶이지 않게)
 *   - 올림: raw 가 지금보다 높은 상태가 up(45초) 이어지면, 그동안의 최저 단계로
 *   - 내림: raw 가 지금보다 낮은 상태가 down(120초) 이어지면, 그동안의 최고 단계로
 *   - 바꾼 뒤 minHold(90초) 안에는 바꾸지 않는다(조건은 계속 잰다)
 */
export class AutoPicker {
  constructor(timing = AUTO_TIMING) { this.timing = { ...AUTO_TIMING, ...timing }; this.reset(); }
  reset() { this.level = null; this.raw = null; this.t0 = null; this.switchedAt = -Infinity; this._up = null; this._down = null; }
  step(raw, t) {
    raw = Math.max(0, Math.min(3, raw | 0));
    this.raw = raw;
    if (this.t0 == null) this.t0 = t;
    if (this.level == null || t - this.t0 < this.timing.warmup) {
      if (this.level !== raw) { this.level = raw; this.switchedAt = t; }
      this._up = null; this._down = null;
      return raw;
    }
    const cur = this.level;
    if (raw > cur) { this._down = null; if (!this._up) this._up = { since: t, min: raw }; else this._up.min = Math.min(this._up.min, raw); }
    else if (raw < cur) { this._up = null; if (!this._down) this._down = { since: t, max: raw }; else this._down.max = Math.max(this._down.max, raw); }
    else { this._up = null; this._down = null; }
    if (t - this.switchedAt < this.timing.minHold) return cur;
    if (this._up && t - this._up.since >= this.timing.up) return this._commit(this._up.min, t);
    if (this._down && t - this._down.since >= this.timing.down) return this._commit(this._down.max, t);
    return cur;
  }
  _commit(lv, t) { this.level = lv; this.switchedAt = t; this._up = null; this._down = null; return lv; }
  /** 시험·표시용 */
  state(t) {
    return { level: this.level, raw: this.raw, holdLeft: this.level == null ? 0 : Math.max(0, this.timing.minHold - (t - this.switchedAt)),
      up: this._up ? { ...this._up } : null, down: this._down ? { ...this._down } : null };
  }
}

const stagesOf = (t) => (Array.isArray(t.stage) ? t.stage : Number.isInteger(t.stage) ? [t.stage] : []);

/**
 * 단계 → 후보 곡 id 목록(매니페스트 stage 데이터에서). 그 단계 곡이 없으면 가장 가까운 단계의 곡들
 * (거리가 같으면 낮은 단계 = 더 차분한 쪽). 단계 정보가 하나도 없으면 전체 곡
 */
export function stageCandidates(level, tracks) {
  if (!tracks || !tracks.length) return [];
  const has = tracks.filter((t) => stagesOf(t).length);
  if (!has.length) return tracks.map((t) => t.id);
  for (let d = 0; d <= 3; d++) {
    for (const lv of d ? [level - d, level + d] : [level]) {
      if (lv < 0 || lv > 3) continue;
      const c = has.filter((t) => stagesOf(t).includes(lv));
      if (c.length) return c.map((t) => t.id);
    }
  }
  return has.map((t) => t.id);
}

/**
 * 테마별 풀: 지금 표현의 views 단계가 level 인 곡. 표현이 없거나·매니페스트에 views 가 없거나·그 단계에 테마 곡이 없으면
 * 전체 풀(stage, stageCandidates — 가까운 단계 폴백 포함)
 */
export function viewCandidates(level, tracks, view = null) {
  if (tracks && themed(tracks, view)) {
    const c = tracks.filter((t) => viewStages(t, view).includes(level));
    if (c.length) return c.map((t) => t.id);
  }
  return stageCandidates(level, tracks);
}

/**
 * 단계에 맞는 곡 하나(view 를 주면 그 표현의 테마 풀, viewCandidates). recent = 최근 재생 곡 id(오래된 것 → 최근). 후보에서 직전 2곡을 피해 무작위,
 * 다 피하면 직전 1곡만 피하고, 그래도 없으면(후보 하나) 그 곡. keep = 지금 곡이 후보에 있으면 그대로 둘지
 */
export function pickForLevel(level, tracks, { recent = [], cur = null, keep = false, rand = Math.random, view = null } = {}) {
  const c = viewCandidates(level, tracks, view);
  if (!c.length) return null;
  if (keep && cur && c.includes(cur)) return cur;
  const last = [...recent, ...(cur && recent[recent.length - 1] !== cur ? [cur] : [])]; // cur 가 이미 최근 끝이면 두 번 세지 않음
  const tail2 = last.slice(-2), tail1 = last.slice(-1);
  let pool = c.filter((id) => !tail2.includes(id));
  if (!pool.length) pool = c.filter((id) => !tail1.includes(id));
  if (!pool.length) pool = c;
  const k = Math.min(pool.length - 1, Math.floor(Math.max(0, rand()) * pool.length));
  return pool[k];
}

/** 선택기 '자동' 항목 문구: 자동 · 재즈(활발) */
export function autoLabel(track, level) {
  if (!track || level == null) return tr('sound.auto');
  return tr('sound.autoLabel', { track: track.label, level: stageLabel(level) });
}
