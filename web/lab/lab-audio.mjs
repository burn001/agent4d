// 【모듈 규격 · 음악·효과음(audio) 담당】 복셀 연구소 소리 — 순수(three·DOM·AudioContext 없음), node --test 대상.
//
// ┌ 배경음악 ────────────────────────────────────────────────────────────────────────────────┐
// │ 매니페스트 web/assets/bgm-tracks.json 에 연구소 전용 13곡(views: {lab: [단계]}) — music/compose_<id>.py + music/labkit.py   │
// │   (연구소 편곡기)로 합성: cleanroom·petri(한가) · titration·oscillo·microscope(3/4)·datalog·fivetubes(5/4)·coolant(6/8)  │
// │   (보통) · centrifuge·spectro·gelrun(활발) · reactor·collider(매우 활발). music/tracks.py VIEWS 에 'lab'.                 │
// │   연구소는 다른 표현과 풀을 나누지 않는다(bgm-core POOL_GROUPS 는 흐름↔Planet 만).                                       │
// │ labPoolView(tracks, view): 그 표현 곡이 매니페스트(파싱 뒤)에 하나도 없으면 LAB_VIEW_FALLBACK(lab → voxel) 풀.                │
// │   bgm-auto.mjs viewCandidates 가 이미 부른다. bgm-core.mjs(리드) VIEWS 에 'lab' 이 들어가야 parseViews 가 views.lab 을 남김 —   │
// │   그 전에는 lab 곡이 파싱에서 빠져 늘 복셀 오피스 풀(안전한 대체).                                                          │
// │ 입력: Music.setView('lab')(app.js switchView 가 이미 부름) · 출력: 자동 선곡이 lab 풀(없으면 voxel 풀)에서 고름.               │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// ┌ 효과음 ───────────────────────────────────────────────────────────────────────────────────────┐
// │ 이름 목록 LAB_SFX(아래) — sfx.mjs SOUNDS·synth 에 같은 이름으로 합성 정의(음계 = 지금 화음, ≤ 0.4초, attack ≥ 5ms).          │
// │ labSoundFor(ev, ctx) → 이름 | null: ev = 앱 이벤트(또는 null), ctx = {view:'lab', rigKind?, rigState?, act?}               │
// │   ctx.act  = 장면 이름(build·edit·shatter·launch·radar …) 또는 연구소 장면('wave' 대량 변경 · 'alarm' 위험 동작)        │
// │   ctx.rigState = 기자재 상태가 막 바뀐 값(lab-rig-core RIG_STATES) · ev.type 'rig-lift' = 퇴장 승강판                       │
// │   null 이면 기존 eventToSound/ixSound/actSound 그대로(연구소에서 덮어쓸 소리만 돌려줌).                                    │
// │ labEventSound(ev, node, ctx) → eventToSound 결과({name, priority, pitchIndex, pan, key, cat}) 에서 이름만 연구소 소리로.     │
// │ LabSoundGate.allow(name, nowMs): 연구소 소리는 같은 이름 0.25초 안 1번(LAB_SFX_GAP_MS). 그 뒤 기존 RateLimiter(초당 8·      │
// │   배속 솎기)·Sfx.play(MAX_VOICES 6) 를 그대로 지난다. 배속 ≥ 8 이면 우선순위 3 소리는 아예 내지 않는다(labSpeedOk).         │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
import { eventToSound } from '../sfx.mjs';

/** 배경음악 풀이 비었을 때 쓸 표현 */
export const LAB_BGM_FALLBACK = 'voxel';
/** 표현 → 그 표현 곡이 없을 때 쓸 표현 */
export const LAB_VIEW_FALLBACK = { lab: LAB_BGM_FALLBACK };
/** 연구소 전용 배경음악(단계 0 한가 ～ 3 매우 활발) — 매니페스트 id. 처음 8곡(단계마다 2곡) + 2026-11-03 보통 4곡·활발 1곡(체류 비중 큰 단계 보강) */
export const LAB_TRACKS = [['cleanroom', 'petri'], ['titration', 'oscillo', 'microscope', 'datalog', 'fivetubes', 'coolant'], ['centrifuge', 'spectro', 'gelrun'], ['reactor', 'collider']];

/**
 * 실제로 고를 풀의 표현: 그 표현 곡이 tracks(parseManifest 뒤)에 하나라도 있으면 그대로, 없으면 대체 표현.
 * 대체 표현이 없는 표현(flow·planet·voxel·null)은 그대로 돌려준다.
 */
export function labPoolView(tracks, view) {
  const fb = LAB_VIEW_FALLBACK[view];
  if (!fb || !Array.isArray(tracks)) return view;
  return tracks.some((t) => t && t.views && t.views[view]) ? view : fb;
}

/** 연구소 효과음 이름(설계 동작· 기자재 상태) — sfx.mjs SOUNDS 키 */
export const LAB_SFX = {
  'lab-print': '3D 프린트(새로 만들기): 짧은 상행 펄스 사다리',
  'lab-edit': '고치기: 얇은 층 바뀜 — 부드러운 클릭 2',
  'lab-shatter': '지우기: 고역 노이즈 흩어짐',
  'lab-wave': '대량 변경 파도: 밴드패스 노이즈 스윕(코어 → 테두리)',
  'lab-alarm': '위험 동작: 낮은 2음 경보(경광등 2.6초 동안 1회)',
  'lab-absorb': 'push: 빨려 드는 하행 글리산도 + 코어 빛기둥 종',
  'lab-radar': 'Grep·Glob: 레이더 핑',
  'lab-rig-on': '기자재 설치·켜짐: 기계 클릭 + 블립',
  'lab-rig-done': '기자재 끝(초록): 짧은 종지',
  'lab-rig-fail': '기자재 실패(빨강): 덜컥 + 낮은 삼각파',
  'lab-rig-stale': '정체: 노랑 두 번 깜빡에 맞춘 작은 틱 2',
  'lab-lift': '퇴장 승강판: 내려가는 모터음',
};
export const LAB_SFX_NAMES = Object.keys(LAB_SFX);

/** 연구소 소리 우선순위(작을수록 중요 — RateLimiter·MAX_VOICES 규칙 그대로). 이벤트 소리를 바꿀 때는 원래 우선순위를 둔다 */
export const LAB_SFX_PRI = {
  'lab-alarm': 1, 'lab-rig-fail': 1, 'lab-absorb': 1, 'lab-print': 2, 'lab-shatter': 2, 'lab-wave': 2, 'lab-radar': 2,
  'lab-rig-on': 2, 'lab-rig-done': 2, 'lab-edit': 3, 'lab-rig-stale': 3, 'lab-lift': 3,
};
/** 연구소 소리 같은 이름 최소 간격(ms) */
export const LAB_SFX_GAP_MS = 250;
/** 연출(장면) 소리 게인 — art-ui actSounds 와 같은 0.55 를 기본으로, 잦은 것은 더 작게 */
export const LAB_SFX_GAIN = { 'lab-edit': 0.4, 'lab-rig-stale': 0.45, 'lab-lift': 0.5 };

/** 장면 이름(연구소 장면) → 연구소 소리 */
const ACT_LAB = {
  build: 'lab-print', edit: 'lab-edit', shatter: 'lab-shatter', launch: 'lab-absorb', radar: 'lab-radar',
  wave: 'lab-wave', alarm: 'lab-alarm', overwrite: 'lab-print',
};
/** 기자재 상태(막 바뀐 값) → 연구소 소리. wait·stop 은 기존 소리(없음·stop) */
const RIG_LAB = { run: 'lab-rig-on', done: 'lab-rig-done', fail: 'lab-rig-fail', stale: 'lab-rig-stale' };
const RIG_NODE = new Set(['bash-bg', 'monitor']);

/**
 * 연구소에서 덮어쓸 효과음 이름. 연구소가 아니거나 덮어쓸 소리가 없으면 null(기존 규칙 그대로).
 * 순서: 연출 장면(ctx.act) → 퇴장 승강판(ev.type 'rig-lift') → 기자재 상태 변화(ctx.rigState) → 앱 이벤트.
 */
export function labSoundFor(ev, ctx = {}) {
  if (!ctx || ctx.view !== 'lab') return null;
  if (ctx.act) return ACT_LAB[ctx.act] || null;
  const type = ev && ev.type;
  if (type === 'rig-lift') return 'lab-lift';
  if (ctx.rigState) return RIG_LAB[ctx.rigState] || null;
  if (!type) return null;
  const kind = (ev.node && ev.node.kind) || ctx.nodeKind || null;
  const ix = ev.ix;
  // push 는 코어로 빨려 드는 소리(실패·최신이면 기존 소리)
  if (ix && ix.cat === 'github' && ix.op === 'push' && ix.phase === 'end' && ix.ok !== false && !ix.upToDate) return 'lab-absorb';
  if (ix) return null; // 그 밖의 특별 상호작용은 기존 소리
  switch (type) {
    case 'node-add': return RIG_NODE.has(kind) ? 'lab-rig-on' : null; // 기자재 설치 = 기존 machine-on 자리
    case 'node-update': {
      if (!RIG_NODE.has(kind)) return null;
      const st = ev.patch && ev.patch.status;
      return st === 'done' ? 'lab-rig-done' : st === 'error' ? 'lab-rig-fail' : null;
    }
    case 'tool-start':
      return ev.cat === 'search' && (ev.tool === 'Grep' || ev.tool === 'Glob') ? 'lab-radar' : null;
    default: return null;
  }
}

/**
 * eventToSound 와 같은 모양에서 이름만 연구소 소리로(우선순위·음높이·팬·합치기 키는 그대로).
 * 기존 규칙이 소리를 안 내는 이벤트(예: bash-bg 의 done)는 연구소 소리가 있으면 새로 만든다. ctx.view 가 lab 이 아니면 eventToSound 그대로.
 */
export function labEventSound(ev, node, ctx = {}) {
  const base = eventToSound(ev, node);
  const kind = (node && node.kind) || (ev && ev.node && ev.node.kind) || null;
  const name = labSoundFor(ev, { ...ctx, nodeKind: kind });
  if (!name) return base;
  if (base) return { ...base, name, cat: base.cat || name };
  const id = (ev && (ev.nodeId || (ev.node && ev.node.id))) || '';
  return { name, priority: LAB_SFX_PRI[name] ?? 2, pitchIndex: 0, pan: 0, key: id, cat: name };
}

/** 배속 솎기: 배속 ≥ 8 이면 우선순위 3(잦은 잔소리), ≥ 16 이면 2 도 내지 않음 — RateLimiter 앞에서 한 번 더 */
export function labSpeedOk(name, speed = 1) {
  const p = LAB_SFX_PRI[name] ?? 2;
  if (speed >= 16) return p <= 1;
  if (speed >= 8) return p <= 2;
  return true;
}

/** 연구소 소리 같은 이름 0.25초 안 1번(그 밖 이름은 통과 — 기존 RateLimiter 가 맡음) */
export class LabSoundGate {
  constructor(gapMs = LAB_SFX_GAP_MS) { this.gapMs = gapMs; this.last = new Map(); }
  allow(name, nowMs) {
    if (!name || !Object.prototype.hasOwnProperty.call(LAB_SFX, name)) return true;
    const t = this.last.get(name);
    if (t != null && nowMs - t < this.gapMs) return false;
    this.last.set(name, nowMs);
    return true;
  }
  clear() { this.last.clear(); }
}
