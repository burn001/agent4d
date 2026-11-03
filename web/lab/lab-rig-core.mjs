// 【모듈 규격 · 기자재(equipment) 담당】 연구 기자재 = 백그라운드 작업(설계) — 순수(three·DOM 없음), node --test 대상.
// 3D 그리기는 lab-rigs.js, 2D 는 flat/lab2d-rigs.js(평면도 담당)가 이 모듈의 모델을 그대로 쓴다.
//
// ┌ 입력 ───────────────────────────────────────────────────────────────────────────────────────────┐
// │ node: 앱 노드 {id, kind:'bash-bg'|'monitor', parentId, status, label, startedAt, endedAt, meta:{rearmOf, job, proc, run,   │
// │       batch, toolUseId, command?, launcher?, runner?}}. ix 범주: VoxelView.ix(IxModel)가 meta.toolUseId 로 띄운           │
// │       tool-start 의 ix.cat 을 안다 — rigKindOf(node, ixCat) 의 둘째 인자로 넘긴다(없으면 null → 명령 글 규칙).         │
// │ ix 세부(선택): rigIxOf(ixModel, node) → IxModel.fx 에 쌓인 ix(pass·fail·total·i·n·par·bytes·rows·rw·pct) | null.        │
// │ nowMs: 렌더러 시계(VoxelView.clock() — 재생 = 가상 시계).                                                           │
// │ 좌표: lab-const.mjs 극좌표(θ 도, 중심 room.lab.cx/cz). 고리 반지름 = labRadii(rP).rRig.                              │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// ┌ 출력 ───────────────────────────────────────────────────────────────────────────────────────────┐
// │ rigKindOf → RIG_KINDS 중 하나(노드마다 한 번 정하면 유지 — 호출하는 쪽이 node.id 로 기억, 재생도 같은 답).              │
// │ rigState(node, nowMs, kind?) → RIG_STATES 중 하나('run'|'wait'|'stale'|'done'|'fail'|'stop'). 오실로스코프는 정체 문턱 2배. │
// │ rigGauge(node, kind, nowMs, ix?) → 0..1 | null(진행률 모름).                                                          │
// │ rigRc(node) → 종료 코드 수 | null.  rigStaleMs(node, nowMs) → 조용한 시간 ms(정체 이름표 'N분').                       │
// │ rigModel(node, kind, nowMs, ix?, extra?, out?) → 그리기 모델 {kind, state, gauge, rc, …}(3D·2D 공용, 재사용 객체).      │
// │ rigParts(model, t, out, far?, seed?, dyn?, now?) → 상자 수 n. dyn = RigDyn(없으면 예전 출력 그대로). out[0..n) = {x,y,z,sx,sy,sz,r,c,g,k} 기자재 지역 좌표(+z = 앞 = 중심 쪽,      │
// │       c 'kind' = RIG_KIND_HEX[테마][model.kind]. model.scale(보조 선반 0.6)·model.lift(0..1)는 그리는 쪽이 채움(선택). │
// │       바닥 y 0, 발자국 ±SIZE/2, 높이 ≤ H_MAX), r = 추가 yaw, c = RIG_HEX 색 키, g = 1 발광 묶음, k = 밝기(>1 이면 흰빛). │
// │ RIG_DYN · newRigDyn() · rigDynStep(d, now, flash, state, ts?, reduced?) · rigTransK(d, now) → 기자재 동작(활동 지수 act·누적 위상 ph· │
// │       전이 on/resume/done/fail/stale/stop). 그리는 쪽이 id 마다 newRigDyn 하나를 보관하고 프레임마다 rigDynStep → rigParts(…, d, now).  │
// │ rigLiftK(liftT0, now, ts) → 승강판 내려감 0..1.  rigSlots / rigShelfSlots / assignRigSlots → 자리.                      │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// 성능 상한(LAB_PERF): 고리 ≤ RIGS_RING(32) + 보조 선반 12, 기자재당 상자 ≤ RIG_BOXES(40)(멀면 RIG_BOXES_FAR 6), 합 ≤ 1,800 동적 상자.
// rigParts 는 out 배열의 객체·표시등·표시등 자리·Parts 를 재사용(프레임마다 새 객체 0) — 기자재 30대 × 40 상자 = 1,200 기록, 할당 없음.
import { LAB, LAB_PERF, polar, thetaOf, dTheta, faceIn, labRadii, DEG } from './lab-const.mjs';
import { runVis, runState, runOf, toMs } from '../run-core.mjs';
import { isJob, jobOf, jobDisplayState, jobProgress, isProc, procOf, jobHeat, jobLanes } from '../job-core.mjs';
import { isLauncher, isRunner } from '../batch-core.mjs';

/** 기자재 10종(설계) — i18n 키 lab.rig.<kind> */
export const RIG_KINDS = ['tests', 'reactor', 'tank', 'antenna', 'scope', 'incubator', 'oscillo', 'dispenser', 'meter', 'sequencer'];
/** 상태 6종(설계) — i18n 키 lab.state.<state>. 색 뜻은 jobDisplayState 와 같게 */
export const RIG_STATES = ['run', 'wait', 'stale', 'done', 'fail', 'stop'];
/** 상태 → 표시등 색 이름(3D·2D 공용, 테마 토큰 또는 RIG_HEX 키) */
export const RIG_STATE_COLOR = { run: 'warn', wait: 'link', stale: 'warn2', done: 'ok', fail: 'error', stop: 'muted' };
/** 기자재 색(테마별, 이 모듈 소유) — 3D lab-rigs.js·2D 가 THREE.Color/캔버스 색으로 씀. 상태 색 키 = RIG_STATES */
export const RIG_HEX = {
  dark: {
    body: '#4a5872', trim: '#6a7a94', panel: '#141a24', run: '#f5a524', wait: '#5b8fd6', stale: '#f08c1a', done: '#34d399', fail: '#ef4444', stop: '#6b7280',
    metal: '#7d8aa0', glass: '#8fb7d8', liquid: '#3fa7c9', crystal: '#b38cff', ingot: '#f2c14e', paper: '#e8edf3', smoke: '#59606b', screen: '#0c2a22', trace: '#5ef0b4', accent: '#7aa2f7', kind: '#7aa2f7',
  },
  light: {
    body: '#8a96a8', trim: '#5d6b80', panel: '#1f2733', run: '#c27a06', wait: '#3f74c8', stale: '#d9480f', done: '#059669', fail: '#dc2626', stop: '#9aa5b5',
    metal: '#6b778a', glass: '#7aa6c8', liquid: '#1c86ab', crystal: '#8b5cf6', ingot: '#c9930a', paper: '#ffffff', smoke: '#9ca3af', screen: '#10392d', trace: '#0f9f6e', accent: '#3b63c4', kind: '#3b63c4',
  },
};
/**
 * 종류 악센트 색(테마별 10색, T2) — 받침·상판·원경 띠·2D 링. 서로 구별되고 상태 6색(RIG_HEX 상태 키)과 겹치지 않게 골랐다
 * (RGB 거리 ≥ 55, web/test/lab-rig-vis.test.mjs). 색 키 'kind'(RIG_HEX 의 대체값)를 쓰는 상자는 그리는 쪽이 이 표로 바꾼다.
 */
export const RIG_KIND_HEX = {
  dark: { tests: '#22d3ee', reactor: '#f472b6', tank: '#2563eb', antenna: '#bef264', scope: '#c084fc', incubator: '#d946ef', oscillo: '#fde68a', dispenser: '#b45309', meter: '#94a3b8', sequencer: '#f1f5f9' },
  light: { tests: '#0891b2', reactor: '#db2777', tank: '#1e3a8a', antenna: '#84cc16', scope: '#7e22ce', incubator: '#c026d3', oscillo: '#4d7c0f', dispenser: '#78350f', meter: '#64748b', sequencer: '#4338ca' },
};
/** 종류별 글리프(2D·범례 공용) */
export const RIG_GLYPH = { tests: '⚗', reactor: '⚙', tank: '⛁', antenna: '⌁', scope: '◎', incubator: '⧗', oscillo: '∿', dispenser: '▦', meter: '◔', sequencer: '▤' };

/** 시간 규칙 */
export const RIGW = {
  LIFT_S: 0.8,            // 퇴장: 승강판으로 내려가는 시간(초, 배속 √ 로 줄임)
  VACANT_S: 30,           // 퇴장 뒤 회색 바닥 표시로 자리를 잡아 두는 시간(벽시계 초 / 배속)
  DONE_LIT_MS: 3000,      // 끝: 초록 고정 뒤 꺼짐
  STOP_FADE_MS: 1200,     // 중지: 표시등이 위부터 꺼지는 시간
  SERVER_STALE_K: 2,      // 오실로스코프(서버): 정체 문턱 배수
  LONG_STALE_MS: 900_000, // 장시간 계산 판정(staleAfter ≥ 15분)
  TUBES: 8, WELLS: 12, ARMS_MAX: 3, BEAM_DOTS: 6, TRACE_N: 12, PALLETS: 3,
};

// ───────────────────────────── 종류 판정(설계) ─────────────────────────────
/** ix 범주 → 종류 */
export const IX_TO_RIG = { tests: 'tests', db: 'tank', remote: 'antenna', github: 'antenna', batch: 'dispenser' };
/** 명령·라벨 글 규칙(위에서부터 먼저 맞는 것). 소문자 글에 맞춘다 */
export const RIG_RULES = [
  ['scope', /\btail\s+-[a-z]*f|\bget-content\b[^|;]*-wait\b|^\s*watch\s|[;&|]\s*watch\s|\bjournalctl\b[^|;]*-f\b|\bkubectl\s+logs\b[^|;]*-f\b/],
  ['tests', /\b(pytest|jest|vitest|mocha|tox|nox|unittest|phpunit|rspec)\b|\bplaywright\s+test\b|\bnode\b[^|;&]*\s--test\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(go|cargo|dotnet|deno)\s+test\b|\bcargo\s+nextest\b|\bmake\s+(test|check)\b|\bgradlew?\s+(test|check)\b|\bmvnw?\s+(test|verify)\b/],
  ['reactor', /\b(tsc|webpack|esbuild|rollup|pyinstaller|nuitka|cmake|msbuild|gradlew?|make)\b|\bvite\s+build\b|\b(cargo|go|docker|next|dotnet|swift)\s+build\b|\bdotnet\s+publish\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\bsetup\.py\s+(build|bdist)|\bpython\s+-m\s+build\b/],
  ['oscillo', /\b(uvicorn|gunicorn|hypercorn|nodemon|streamlit|jupyter)\b|\bflask\s+run\b|\bhttp\.server\b|\bnode\s+\S*serve[r]?\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b|\bwrangler\s+dev\b|\bdocker[\s-]compose\s+up\b|\bnext\s+dev\b|\bvite(?!\s+build)\b|\brunserver\b|\bserve\b|--port\b|\blisten\b/],
  ['tank', /\b(mongosh|mongo|mongodump|mongorestore|mongoimport|mongoexport|psql|pg_dump|pg_restore|mysql|mysqldump|sqlite3|redis-cli|clickhouse-client)\b|\bprisma\s+(migrate|db)\b|\balembic\b|\bmanage\.py\s+migrate\b/],
  ['antenna', /\b(ssh|scp|sftp|rsync|autossh|cloudflared|ngrok|rclone)\b|\bgit\s+(push|pull|fetch|clone)\b|\bgh\s+\w|\baws\s+s3\b|\bgsutil\b|\bcurl\b[^|;]*\s-(T|-upload-file)\b/],
  ['dispenser', /\bxargs\b[^|;]*\s-p\s*\d|\bparallel\b|\bfor\s+\w+\s+in\b[^;]*;\s*do\b|\bwhile\b[^;]*;\s*do\b|\bforeach\s*\(|\bforeach-object\b|%\s*\{/],
  ['incubator', /(?<![a-z])(train|training|fit|finetune|fine-tune|measure|bench|benchmark|simulate|simulation|crawl|scrape|sweep|optuna|epochs?)(?![a-z])/],
];

/** 명령 글(meta.command 우선, 없으면 라벨) — 소문자 */
export function rigText(node) {
  const m = (node && node.meta) || {};
  return String(m.command || m.cmd || node && node.label || '').toLowerCase();
}

/**
 * 명령 성격 판정(설계, 순수). ixCat = 띄운 호출의 ix 범주(tests·db·remote·batch·github) | null.
 * 순서: monitor → 감시 스코프 · 기동기·러너 → 시퀀서 · 분리 프로세스 → 배양기 · ix 범주 · 명령 글 규칙 · 장시간(staleAfter ≥ 15분) → 배양기 · 그 밖 범용 계측기.
 * 노드마다 한 번 — 호출하는 쪽(computeLab prev.machine.rigKind)이 처음 답을 지킨다.
 */
export function rigKindOf(node, ixCat = null) {
  if (!node) return 'meter';
  if (node.kind === 'monitor') return 'scope';
  if (isLauncher(node) || isRunner(node)) return 'sequencer';
  if (isProc(node)) return 'incubator';
  const cat = ixCat || (node.meta && node.meta.ix && node.meta.ix.cat) || null;
  if (cat && IX_TO_RIG[cat]) return IX_TO_RIG[cat];
  const s = rigText(node);
  if (s) for (const [kind, re] of RIG_RULES) if (re.test(s)) return kind;
  const r = runOf(node);
  if (r && Number(r.staleAfter) >= RIGW.LONG_STALE_MS) return 'incubator';
  if (r && r.buffered && /\b(python3?|py|node|deno|bun|rscript|julia)\b/.test(s)) return 'incubator';
  return 'meter';
}

// ───────────────────────────── 상태(설계) ─────────────────────────────
/** 종료 코드(meta.run.rc → meta.proc.rc → meta.rc) | null */
export function rigRc(node) {
  const m = (node && node.meta) || {};
  const cand = [m.run && m.run.rc, m.proc && m.proc.rc, m.rc, m.exitCode];
  for (const v of cand) if (v != null && v !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * 상태(설계) — 웹 시계 기준.
 * 작업(meta.job) 은 jobDisplayState, 그 밖: error·rc≠0 → fail, stopped → stop, done → done, 정체 → stale, idle → wait, 나머지 run.
 * kind 'oscillo'(서버)는 조용한 게 정상이라 정체 문턱 2배.
 */
export function rigState(node, nowMs, kind = null) {
  if (!node) return 'stop';
  const job = jobOf(node);
  if (job && isJob(node)) {
    const d = jobDisplayState(job, nowMs);
    return d === 'queued' || d === 'waiting' ? 'wait' : d === 'stale' ? 'stale' : d === 'done' ? 'done' : d === 'failed' ? 'fail' : 'run';
  }
  const st = node.status;
  if (st === 'error') return 'fail';
  if (st === 'stopped') return 'stop';
  if (st === 'done') { const rc = rigRc(node); return rc != null && rc !== 0 ? 'fail' : 'done'; }
  if (kind === 'oscillo') {
    const s = runState(node, nowMs);
    if (s && !s.ended && Number.isFinite(s.lastOut ?? s.since) && s.quietMs > s.staleAfter * RIGW.SERVER_STALE_K) return 'stale';
    return st === 'idle' && !(s && !s.ended) ? 'wait' : 'run';
  }
  if (runVis(node, nowMs) === 'stale') return 'stale';
  if (isProc(node) && st === 'idle') return 'stale'; // 서버가 적응 문턱으로 idle = 정체
  if (st === 'idle') return 'wait';
  return 'run';
}

/** 조용한 시간(ms) — 정체 이름표 'N분'. meta.run 없으면 null */
export function rigStaleMs(node, nowMs) {
  const s = runState(node, nowMs);
  return s && !s.ended ? s.quietMs : null;
}

/**
 * 띄운 호출의 ix 세부(IxModel.fx 에서, 순수 — Map 읽기만). ixModel = VoxelView.ix 의 IxModel(또는 {fx: Map}).
 * bg 노드는 fx.bgNode === node.id 이거나 key === meta.toolUseId. 없으면 null
 */
export function rigIxOf(ixModel, node) {
  const fx = ixModel && (ixModel.fx || (ixModel.model && ixModel.model.fx));
  if (!fx || !node) return null;
  const tu = node.meta && node.meta.toolUseId;
  if (tu && fx.has(tu)) return fx.get(tu).ix || null;
  for (const f of fx.values()) if (f.bgNode === node.id) return f.ix || null;
  return null;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const logK = (v, decades) => (Number(v) > 0 ? clamp01(Math.log10(Number(v) + 1) / decades) : 0);

/**
 * 진행률 0..1 | null(모름). ix = rigIxOf(…) 세부(없으면 null).
 * tests: (pass+fail+skip)/total · dispenser: i/n · tank: log10 행 수 / 6 · antenna: log10 바이트 / 9 · 나머지: ix.pct · 작업 진행률.
 * oscillo·scope·meter 는 진행률이 없는 기자재라 null.
 */
export function rigGauge(node, kind, nowMs, ix = null) { // eslint-disable-line no-unused-vars
  const x = ix || (node && node.meta && node.meta.ix) || null;
  const job = jobOf(node);
  const jp = job ? jobProgress(job) : null;
  if (kind === 'oscillo' || kind === 'scope' || kind === 'meter') return null;
  if (x) {
    if (kind === 'tests' && Number(x.total) > 0) return clamp01(((Number(x.pass) || 0) + (Number(x.fail) || 0) + (Number(x.skip) || 0)) / Number(x.total));
    if (kind === 'dispenser' && Number(x.n) > 0 && Number.isFinite(Number(x.i))) return clamp01(Number(x.i) / Number(x.n));
    if (kind === 'tank' && Number(x.rows) > 0) return logK(x.rows, 6);
    if (kind === 'antenna' && Number(x.bytes) > 0) return logK(x.bytes, 9);
    if (Number.isFinite(Number(x.pct)) && x.pct !== null && x.pct !== '') return clamp01(Number(x.pct) / 100);
  }
  if (jp != null) return jp;
  if (kind === 'incubator' && job) { const l = jobLanes(job)[0]; if (l && Number(l.total) > 0) return clamp01(Number(l.n) / Number(l.total)); }
  return null;
}

/**
 * 그리기 모델(3D·2D 공용, out 재사용). extra = 기계 상태 묶음에서 오는 값 {band, progress, running}(시퀀서 — office deviceInfo).
 * pulseAt = 마지막 출력 시각(ms, 감시·오실로·계측기 박동), age = 끝난 뒤 흐른 ms(끝·중지 연출), staleMs = 조용한 시간.
 */
export function rigModel(node, kind, nowMs, ix = null, extra = null, out = {}) {
  const k = RIG_KINDS.includes(kind) ? kind : 'meter';
  const x = ix || (node && node.meta && node.meta.ix) || null;
  out.kind = k;
  out.state = rigState(node, nowMs, k);
  out.gauge = k === 'sequencer' ? (extra && Number.isFinite(extra.progress) ? clamp01(extra.progress) : null) : rigGauge(node, k, nowMs, x);
  out.rc = rigRc(node);
  out.pass = x && Number(x.pass) || 0; out.fail = x && Number(x.fail) || 0; out.total = x && Number(x.total) || 0;
  out.i = x && Number(x.i) || 0; out.n = x && Number(x.n) || 0;
  out.par = Math.max(1, Math.min(RIGW.ARMS_MAX, x && Number(x.par) > 0 ? Number(x.par) : 1));
  out.rw = x && (x.rw || (x.op === 'restore' || x.op === 'write' ? 'w' : x.op === 'dump' || x.op === 'query' ? 'r' : null)) || null;
  out.bytes = x && Number(x.bytes) || 0;
  out.tunnel = !!(x && (x.op === 'tunnel' || x.tunnel));
  const r = runOf(node), m = (node && node.meta) || {};
  const last = r ? toMs(r.lastOut) : NaN;
  out.pulseAt = Number.isFinite(last) ? last : null;
  out.staleMs = out.state === 'stale' ? rigStaleMs(node, nowMs) : null;
  const end = toMs((r && r.ended) || (node && node.endedAt));
  out.age = Number.isFinite(end) && Number.isFinite(nowMs) ? Math.max(0, nowMs - end) : (out.state === 'done' || out.state === 'fail' || out.state === 'stop' ? 1e9 : 0);
  const job = jobOf(node) || (m.proc && m.proc.job) || null;
  out.heat = job ? jobHeat(job) : 0;
  out.lanes = Math.max(1, Math.min(2, job ? jobLanes(job).length : (procOf(node) && Array.isArray(procOf(node).lanes) ? procOf(node).lanes.length : 1)));
  out.band = extra && Array.isArray(extra.band) ? extra.band : null;
  out.running = extra && Number(extra.running) || 0;
  out.rearm = !!(m.rearmOf);
  out.flash = 0; out.rearmWait = false; // drawRig 가 기계 상태 묶음(st.flash·st.standby)으로 채움
  out.scale = 1; out.lift = 0;          // drawRig 가 pos.scale(보조 선반)·st.lift(승강판)로 채움
  out.mid = false;                      // drawRig 가 st.camD > 60(중경 — 입자 생략)으로 채움
  return out;
}

// ───────────────────────────── 동적 상태 RigDyn(기자재 동작) ─────────────────────────────
/**
 * 기자재 동작 규칙(순수). 활동 지수 act = 출력 펄스의 EMA(반감 ACT_HALF_S) · 부품 속도 = SPEED_MIN + SPEED_K·act(진행) ·
 * 정체 STALE_SPEED · 전이 지속 TRANS_S(초, 배속 √ 로 줄임). PULSE_K = 펄스마다 act 가 1 쪽으로 다가가는 비율, HOLD_S = 출력 뒤 멈칫(스코프).
 */
export const RIG_DYN = Object.freeze({
  ACT_HALF_S: 2, SPEED_MIN: 0.35, SPEED_K: 1.4, STALE_SPEED: 0.15, PULSE_K: 0.35, HOLD_S: 0.3, JERK_S: 2.3, TS_MAX: 8,
  TRANS_S: Object.freeze({ on: 0.9, resume: 0.5, done: 1.4, fail: 1.2, stale: 2.0, stop: 0.8 }),
});
const easeIn = (k) => k * k;
const easeOut = (k) => 1 - (1 - k) * (1 - k);

/**
 * 기자재 한 대의 동적 상태(그리는 쪽이 id 마다 하나 보관). ph = 누적 위상(속도가 바뀌어도 튀지 않음) · act 0..1 ·
 * trans = 진행 중 전이('on'|'resume'|'done'|'fail'|'stale'|'stop'|null), t0 = 전이 시작(초) · pulseAt = 마지막 출력 펄스(초) ·
 * tape = 계측기 기록지 길이(펄스마다 2cm, 0.3 순환). 나머지는 내부(phq = 출력 뒤 멈칫하는 위상, ph2 = 안테나 신호 위상, phS·pqS = 멈춘 자리).
 */
export function newRigDyn() {
  return {
    ph: 0, act: 0, lastT: null, lastFlash: 0, state: null, trans: null, t0: 0, from: null, pulses: 0, pulseAt: -1e9, tape: 0,
    sp: 0, sp0: 0, ts: 1, reduced: false, stAt: 0, jerk: 0, phq: 0, ph2: 0, phS: 0, pqS: 0, lastTrans: null,
    lastPass: -1, lastFail: -1, popAt: -1e9, popI: -1, popFail: false,
  };
}

/**
 * 한 프레임 진행(순수, 할당 0). now = 렌더러 초 · flash = 기계 상태 묶음 st.flash(출력·도구 이벤트 뒤 0.35초 1 → 0) ·
 * state = rigModel(...).state · ts = 배속(위상에 min(ts, 8) 곱, 전이 지속 ÷ √ts) · reduced = 움직임 줄이기(위상·act 고정, 전이 즉시 끝).
 * 전이: 처음 run = 'on'(설치 직후 시동) · wait|stale → run = 'resume' · 그 밖 → run = 'on' · → done|fail|stale|stop = 같은 이름.
 * 속도: run = SPEED_MIN + SPEED_K·act · stale = STALE_SPEED(2초에 걸쳐 늦춤, 2.3초마다 덜컥) · on/resume = × easeIn(k) ·
 * done/stop = 직전 속도 × (1 − easeOut(k)) · 그 밖 0. 반환 d.
 */
export function rigDynStep(d, now, flash = 0, state = 'run', ts = 1, reduced = false) {
  if (!d) return d;
  const D = RIG_DYN, tsv = Number.isFinite(ts) && ts > 0 ? ts : 1;
  d.ts = tsv; d.reduced = !!reduced;
  const okNow = Number.isFinite(now);
  const dt = d.lastT == null || !okNow ? 0 : Math.max(0, Math.min(0.25, now - d.lastT));
  if (okNow) d.lastT = now;
  const fl = flash > 0 ? flash : 0, rise = fl > d.lastFlash + 0.2;
  d.lastFlash = fl;
  if (state !== d.state) {
    const prev = d.state;
    let tr = null;
    if (prev == null) tr = state === 'run' ? 'on' : null;
    else if (state === 'run') tr = prev === 'wait' || prev === 'stale' ? 'resume' : 'on';
    else if (state === 'done' || state === 'fail' || state === 'stale' || state === 'stop') tr = state;
    d.sp0 = d.sp; d.from = prev; d.state = state; d.stAt = okNow ? now : 0; d.jerk = 0;
    d.trans = reduced ? null : tr; d.t0 = okNow ? now : 0;
    if (tr) d.lastTrans = tr;
  }
  if (d.reduced) { d.trans = null; d.sp = 0; d.phS = d.ph; d.pqS = d.phq; return d; }
  if (rise && okNow) { d.act += (1 - d.act) * D.PULSE_K; d.pulseAt = now; d.pulses++; d.tape = (d.tape + 0.02) % 0.3; }
  if (dt > 0) d.act *= Math.pow(0.5, dt / D.ACT_HALF_S);
  let k = 1;
  if (d.trans) { k = rigTransK(d, now); if (k >= 1) d.trans = null; }
  const base = state === 'run' ? D.SPEED_MIN + D.SPEED_K * d.act : state === 'stale' ? D.STALE_SPEED : 0;
  let sp = base;
  if (d.trans === 'on' || d.trans === 'resume') sp = base * easeIn(k);
  else if (d.trans === 'done' || d.trans === 'stop') sp = d.sp0 * (1 - easeOut(k));
  else if (d.trans === 'stale') sp = d.sp0 + (base - d.sp0) * easeOut(k);
  d.sp = sp;
  const m = Math.min(tsv, D.TS_MAX), adv = dt * sp * m;
  d.ph += adv;
  if (!(now - d.pulseAt < D.HOLD_S && now >= d.pulseAt)) d.phq += adv; // 출력 뒤 HOLD_S 동안 멈칫
  if (state === 'run') d.ph2 += dt * (0.3 + d.act) * m;                  // 안테나 신호 고리: 주기 1/(0.3 + act)초
  if (state === 'stale' && okNow) { const j = Math.floor((now - d.stAt) / D.JERK_S); if (j > d.jerk) { d.ph += 0.25; d.phq += 0.25; d.jerk = j; } }
  d.phS = d.ph; d.pqS = d.phq;
  return d;
}

/** 진행 중 전이의 진행률 0..1(전이 없음·움직임 줄이기 = 1). 지속 = TRANS_S[trans] / max(1, √ts) */
export function rigTransK(d, now) {
  if (!d || !d.trans || d.reduced) return 1;
  const dur = (RIG_DYN.TRANS_S[d.trans] || 1) / Math.max(1, Math.sqrt(d.ts || 1));
  return clamp01((now - d.t0) / dur);
}

// ───────────────────────────── 모양(설계) ─────────────────────────────
class Parts {
  constructor() { this.out = null; this.n = 0; this.cap = 0; }
  reset(out, cap) { this.out = out; this.n = 0; this.cap = cap; return this; }
  _p(x, y, z, sx, sy, sz, c, g, k, r) {
    if (this.n >= this.cap) return;
    let o = this.out[this.n];
    if (!o) o = this.out[this.n] = { x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1, r: 0, c: 'body', g: 0, k: 1 };
    o.x = x; o.y = y; o.z = z; o.sx = sx; o.sy = sy; o.sz = sz; o.c = c; o.g = g; o.k = k; o.r = r;
    this.n++;
  }
  box(x, y, z, sx, sy, sz, c, r = 0) { this._p(x, y, z, sx, sy, sz, c, 0, 1, r); }
  glow(x, y, z, sx, sy, sz, c, k = 1, r = 0) { this._p(x, y, z, sx, sy, sz, c, 1, k, r); }
  /** 팔각 기둥(상자 둘을 45° 엇갈려) */
  oct(x, y, z, w, h, c, r = 0) { this.box(x, y, z, w * 0.83, h, w * 0.83, c, r); this.box(x, y, z, w * 0.83, h, w * 0.83, c, r + Math.PI / 4); }
}
const _P = new Parts();                // rigParts 가 out 마다 다시 씀(재진입 없음)
const _B = { x: 0, y: 0, z: 0 };       // SHAPES 가 돌려주는 표시등 자리(재사용)
const beacon = (x, y, z) => { _B.x = x; _B.y = y; _B.z = z; return _B; };
/**
 * rigParts 한 번의 동적 문맥(모듈 재사용 — 할당 0). on = dyn 있음 · pa = 부품 위상(움직이는 상태 = d.ph, 멈춘 상태 = 멈춘 자리) ·
 * pq = 출력 뒤 멈칫하는 위상 · tr·k = 진행 중 전이 · pulse = 마지막 출력 펄스 뒤 초 · lite = 중경·배속 ≥ 8·움직임 줄이기(입자 생략) ·
 * doneK = 끝 배출 진행률(끝 전이 중 k, 끝이면 1)
 */
const X = { on: false, d: null, now: 0, pa: 0, pq: 0, act: 0, tr: null, k: 1, lite: false, pulse: 1e9, doneK: 0 };
function dynCtx(M, d, now) {
  X.on = !!d; X.d = d;
  if (!d) { X.tr = null; X.k = 1; X.lite = false; X.act = 0; X.pulse = 1e9; X.doneK = 0; X.pa = 0; X.pq = 0; return; }
  const k = rigTransK(d, now), tr = k < 1 ? d.trans : null, s = M.state;
  X.now = now; X.k = k; X.tr = tr; X.act = d.act;
  const moving = s === 'run' || s === 'stale' || tr === 'on' || tr === 'resume' || tr === 'done' || tr === 'stop' || tr === 'stale';
  X.pa = moving ? d.ph : d.phS; X.pq = moving ? d.phq : d.pqS;
  const pa = now - d.pulseAt;
  X.pulse = d.reduced || !(pa >= 0) ? 1e9 : pa;
  X.lite = !!M.mid || (d.ts || 1) >= RIG_DYN.TS_MAX || !!d.reduced;
  X.doneK = s === 'done' ? (tr === 'done' ? k : 1) : 0;
}

/**
 * 기자재 한 대의 상자 목록(지역 좌표). model = rigModel(…), t = 초(표시등 깜빡임 시계, 재생 = 가상), far = 멀면 종류 실루엣 6 상자 LOD.
 * dyn = rigDynStep 으로 진행한 RigDyn(없으면 null → 예전 출력 그대로) · now = dyn 시계(초, 기본 t).
 * dyn 이 있으면 부품 애니메이션이 t 대신 누적 위상 dyn.ph(속도 = 활동)를 쓰고, 종류별 가동 부품·전이 연출(시동 김·실패 흔들림/불꽃·
 * 끝 배출·중지 덮개)을 더한다. 모든 종류 공통: 받침 + 표시등(상태) + 앞 표시등 띠, 상태 연출(대기 모래시계·정체 김·실패 스파크/연기·끝 배출물).
 * 반환 상자 수 ≤ LAB_PERF.RIG_BOXES(멀면 RIG_BOXES_FAR). out 의 객체는 재사용(할당 0) — 전이 상자는 맨 뒤라 상한에서 먼저 잘림.
 */
export function rigParts(model, t, out, far = false, seed = 0, dyn = null, now = t) {
  const P = _P.reset(out, far ? LAB_PERF.RIG_BOXES_FAR : LAB_PERF.RIG_BOXES);
  const M = model, H = RIG_HEIGHT[M.kind] || 1.2;
  const sc = M.scale > 0 ? M.scale : 1, lift = M.lift > 0 ? M.lift : 0;
  const L = lamp(M, t, seed);
  dynCtx(M, dyn, now);
  if ((X.tr === 'on' || X.tr === 'resume') && X.k < 0.6) L.k = Math.sin(X.k * Math.PI * 6) > 0 ? 1.2 : 0.2; // 시동: 상태등 깜빡
  if (far) { // LOD(T2): 종류 실루엣 3 + 종류색 띠 + 큰 상태등(세계 ≥ 0.3) + 발광 기둥 = 6
    const top = (FAR_SIL[M.kind] || FAR_SIL.meter)(P);
    if (X.on && M.state === 'run') farMove(P, M);
    P.glow(0, 0.05, 0, 1.38, 0.1, 1.38, 'kind', 0.95);
    const ls = Math.max(0.35, LAMP_MIN_W / sc);
    P.glow(0, top + ls / 2 + 0.06, 0, ls, ls, ls, L.c, Math.max(0.35, L.k) * 1.15);
    lampColumn(P, M, L, 0, top + ls + 0.06, 0, sc, X.on && M.state === 'run' ? 0.6 + 0.8 * X.act : 1);
    return P.n;
  }
  // 공통: 받침(승강판 테두리와 같은 크기, 종류색 테) + 앞 띠(상태색, 높이 0.12)
  P.box(0, 0.04, 0, 1.34, 0.08, 1.34, 'kind');
  P.glow(0, 0.14, 0.655, 1.16, 0.12, 0.04, L.c, M.state === 'done' ? L.k : Math.max(0.3, L.k) * 1.1); // 끝은 3초 뒤 꺼짐
  const draw = SHAPES[M.kind] || SHAPES.meter;
  const b = draw(P, M, t, seed, L);
  // 표시등(종류가 정한 자리) — 중지면 위부터 꺼짐(age 따라). 보조 선반(scale < 1)은 세계 0.3 하한
  const ls = sc < 1 ? Math.max(0.2, LAMP_MIN_W / sc) : 0.2, lim = LAB.RIG.SIZE / 2 - ls / 2;
  const bx = Math.max(-lim, Math.min(lim, b ? b.x : 0)), bz = Math.max(-lim, Math.min(lim, b ? b.z : 0)), by = b ? b.y : H + 0.12;
  P.box(bx, by - 0.07, bz, Math.max(0.2, ls * 1.1), 0.05, Math.max(0.2, ls * 1.1), 'metal');
  P.glow(bx, by - 0.045 + ls / 2, bz, ls, ls, ls, L.c, L.k);
  if (sc < 1 || lift > 0) lampColumn(P, M, L, bx, by - 0.045 + ls, bz, sc);
  statusRim(P, M, t, H, L);
  stateFx(P, M, t, seed, H);
  if (X.on) {
    transFx(P, H);
    if (X.tr === 'fail') { // 실패: 비발광 상자 흔들림(k < 0.5, 지역 x ±0.05, 14Hz) + 붉은 발광이 흰빛 → 빨강
      const sh = X.k < 0.5 ? 0.05 * (1 - 2 * X.k) * Math.sin(X.now * 88) : 0, fl = 1 - X.k;
      for (let i = 0; i < P.n; i++) { const o = out[i]; if (!o.g) o.x += sh; else if (o.c === 'fail') o.k = Math.max(o.k, 1 + 1.2 * fl); }
    }
  }
  return P.n;
}

/** 원경 가동: 실루엣의 종류색 부품 하나를 위상으로 회전(0) 또는 ±0.08 승강(1) — 상자 수 그대로 */
const FAR_MOVE = { tests: 1, reactor: 0, tank: 0, antenna: 0, scope: 0, incubator: 0, oscillo: 1, dispenser: 0, meter: 1, sequencer: 1 };
function farMove(P, M) {
  for (let i = P.n - 1; i >= 0 && i >= P.n - 3; i--) {
    const o = P.out[i];
    if (o.c !== 'kind') continue;
    if (FAR_MOVE[M.kind]) o.y += 0.08 * Math.sin(X.pa * 3);
    else o.r += X.pa * 1.5;
    return;
  }
}

/** 전이 연출(dyn 만, 입자라 중경·배속 ≥ 8 생략): 시동 = 받침 둘레 김 2 · 실패 = 불꽃 6(위로 1.2m/s 포물선) */
function transFx(P, H) {
  const tr = X.tr, k = X.k;
  if (!tr || X.lite) return;
  if (tr === 'on' || tr === 'resume') {
    const s = 0.2 + 0.2 * k;
    for (let i = 0; i < 2; i++) P.glow(i ? -0.45 : 0.45, 0.1 + 0.5 * k, 0.45, s, s * 0.6, s, 'smoke', 0.5 * (1 - k));
  } else if (tr === 'fail') {
    const tau = k * RIG_DYN.TRANS_S.fail, y = Math.max(0.04, H * 0.75 + 1.2 * tau - 1.2 * tau * tau), r = 0.42 * k;
    for (let i = 0; i < 6; i++) { const a = i * (Math.PI / 3) + 0.4; P.glow(Math.cos(a) * r, y, Math.sin(a) * r, 0.06, 0.06, 0.06, i & 1 ? 'fail' : 'run', 0.4 + 1.4 * (1 - k)); }
  }
}

/** 상태등 최소 한 변(세계 m) — 보조 선반 0.6배·원경에서도 점 하나로 사라지지 않게 */
export const LAMP_MIN_W = 0.3;

/** 상태등 위 짧은 발광 기둥(세계 0.5 높이 × hk) — 정체·실패는 깜빡(lamp k 그대로). 원경 진행은 hk = 0.6 + 0.8·act */
function lampColumn(P, M, L, x, y, z, sc, hk = 1) {
  const h = (0.5 * hk) / sc, w = 0.09 / sc;
  const blink = M.state === 'stale' || M.state === 'fail';
  P.glow(x, y + h / 2, z, w, h, w, L.c, blink ? L.k : Math.max(0.35, L.k) * 0.8);
}

/**
 * 상태 테두리(M5 가시성): 실패 = 받침 4변 붉은 발광(깜빡) · 끝 = 초록 링 한 번 퍼짐(DONE_LIT_MS 안) · 중지 = 앞면 회색 덮개
 * (중지 전이 중이면 위에서 내려앉음). 상자 ≤ 4
 */
function statusRim(P, M, t, H, L) {
  const s = M.state;
  if (s === 'fail') {
    const k = Math.max(0.45, L.k) * 1.2, e = 0.64;
    P.glow(0, 0.09, e, 1.36, 0.1, 0.06, 'fail', k); P.glow(0, 0.09, -e, 1.36, 0.1, 0.06, 'fail', k);
    P.glow(e, 0.09, 0, 0.06, 0.1, 1.24, 'fail', k); P.glow(-e, 0.09, 0, 0.06, 0.1, 1.24, 'fail', k);
  } else if (s === 'done' && M.age < RIG_RING_MS) {
    const ph = clamp01(M.age / RIG_RING_MS), r = 0.25 + 0.41 * ph, k = 1.25 - ph * 0.9, w = 0.05;
    P.glow(0, 0.1, r, 2 * r, 0.04, w, 'done', k); P.glow(0, 0.1, -r, 2 * r, 0.04, w, 'done', k);
    P.glow(r, 0.1, 0, w, 0.04, 2 * r - w, 'done', k); P.glow(-r, 0.1, 0, w, 0.04, 2 * r - w, 'done', k);
  } else if (s === 'stop') {
    const y = X.tr === 'stop' ? Math.min(H * 0.5 + (1 - easeOut(X.k)) * H * 0.6, LAB.RIG.H_MAX - H * 0.36) : H * 0.5;
    P.box(0, y, 0.6, 1.12, H * 0.72, 0.04, 'stop'); // 앞면을 덮은 회색 덮개(먼지 덮개)
  }
}
/** 끝 초록 링이 퍼지는 시간(ms, DONE_LIT_MS 안) */
export const RIG_RING_MS = 1400;

/**
 * 원경 실루엣(상자 3, 종류마다 크기 서명이 다름) → 위 끝 높이. 'body' 몸통 + 'kind' 종류색 부품.
 * 상자 한 변은 종류마다 고유(시험 (b): (sx,sy,sz) 서명).
 */
const FAR_SIL = {
  tests(P) { P.box(0, 0.42, 0, 1.3, 0.84, 0.9, 'body'); P.box(0, 0.88, 0.05, 1.18, 0.08, 0.6, 'kind'); P.box(0.52, 1.25, -0.32, 0.14, 0.7, 0.14, 'metal'); return 1.6; },
  reactor(P) { P.box(0, 0.6, 0, 0.92, 1.2, 0.92, 'body'); P.box(0, 0.6, 0, 0.92, 1.2, 0.92, 'kind', Math.PI / 4); P.box(0.3, 1.45, -0.3, 0.22, 0.5, 0.22, 'metal'); return 1.7; },
  tank(P) { P.box(0, 0.3, 0, 0.66, 0.6, 0.66, 'body'); P.box(0, 1.05, 0, 0.5, 1.5, 0.5, 'kind'); P.box(0, 1.05, 0, 0.5, 1.5, 0.5, 'glass', Math.PI / 4); return 1.8; },
  antenna(P) { P.box(0, 0.22, 0, 0.72, 0.44, 0.72, 'body'); P.box(0, 0.9, 0, 0.12, 1.0, 0.12, 'metal'); P.box(0, 1.45, -0.2, 1.0, 0.8, 0.07, 'kind'); return 1.85; },
  scope(P) { P.box(0, 0.38, -0.1, 0.52, 0.76, 0.52, 'body'); P.box(0, 0.98, 0.1, 0.32, 0.32, 1.12, 'kind'); P.box(-0.45, 1.05, -0.42, 0.06, 0.52, 0.56, 'screen'); return 1.32; },
  incubator(P) { P.box(0, 0.24, 0, 0.62, 0.48, 0.62, 'body'); P.box(0, 0.88, 0, 1.16, 0.8, 1.04, 'kind'); P.box(0, 1.32, 0, 0.56, 0.08, 0.56, 'glass'); return 1.36; },
  oscillo(P) { P.box(0, 0.86, -0.05, 1.04, 1.72, 0.76, 'body'); P.box(0, 1.2, 0.34, 0.7, 0.58, 0.04, 'kind'); P.box(0, 0.4, 0.34, 0.9, 0.06, 0.03, 'trim'); return 1.72; },
  dispenser(P) { P.box(0, 0.36, 0, 1.24, 0.72, 1.02, 'body'); P.box(-0.46, 0.98, -0.38, 0.13, 0.56, 0.13, 'metal'); P.box(-0.1, 1.28, -0.1, 0.84, 0.09, 0.11, 'kind', Math.PI / 5); return 1.33; },
  meter(P) { P.box(0, 0.45, 0, 0.9, 0.9, 0.9, 'body'); P.box(-0.16, 0.56, 0.47, 0.34, 0.34, 0.04, 'paper'); P.box(0, 0.94, 0, 0.94, 0.08, 0.94, 'kind'); return 0.98; },
  sequencer(P) { P.box(0, 0.45, -0.05, 1.72, 0.9, 1.2, 'body'); P.box(0, 0.94, -0.05, 1.76, 0.08, 1.24, 'kind'); P.box(0, 1.25, -0.5, 1.4, 0.54, 0.08, 'screen'); return 1.52; },
};

/** 종류별 높이(≤ RIG.H_MAX 2.0 — 브리지에서 플랫폼을 가리지 않게) */
export const RIG_HEIGHT = { tests: 1.25, reactor: 1.55, tank: 1.6, antenna: 1.8, scope: 1.45, incubator: 1.35, oscillo: 1.7, dispenser: 1.3, meter: 1.2, sequencer: 1.5 };

/** 표시등 색·밝기(상태 공통 규칙) — 모듈 객체 재사용(할당 0) */
const _L = { c: 'stop', k: 0 };
function lamp(M, t, seed) {
  const s = M.state;
  let k;
  if (s === 'run') k = 0.6 + 0.4 * Math.max(0, Math.sin(t * 6 + seed)); // 호박 회전등
  else if (s === 'wait') k = 0.55 + 0.3 * Math.sin(t * 1.6 + seed);    // 파랑 느린 숨
  else if (s === 'stale') k = (t % 1.8) < 0.18 || ((t % 1.8) > 0.36 && (t % 1.8) < 0.54) ? 1 : 0.3; // 두 번 깜빡 1.8초
  else if (s === 'fail') k = Math.sin(t * 14) > 0 ? 1 : 0.2;          // 빨강 빠른 깜빡
  else if (s === 'done') k = M.age < RIGW.DONE_LIT_MS ? 1 : 0.18;     // 초록 3초 고정 후 꺼짐
  else k = Math.max(0.12, 1 - M.age / RIGW.STOP_FADE_MS) * 0.5;         // 중지: 꺼짐(회색)
  _L.c = s; _L.k = k;
  return _L;
}
/** 시험용: lamp 가 모듈 객체를 돌려주는지(identity) */
export const _lampForTest = (M, t = 0, seed = 0) => lamp(M, t, seed);

/** 상태 공통 연출(대기 모래시계·정체 김·실패 스파크/연기·중지 없음) — 상자 ≤ 4. dyn 이 있으면 중경·배속 ≥ 8 에서 입자 생략 */
function stateFx(P, M, t, seed, H) {
  const s = M.state, lite = X.on && X.lite;
  if (s === 'wait') { // 모래시계: 위 칸이 줄고 아래 칸이 참(8초 주기)
    const ph = (t / 8 + seed) % 1, x = -0.5, y = Math.min(H + 0.18, LAB.RIG.H_MAX - 0.16);
    P.box(x, y + 0.13, 0.5, 0.14, 0.02, 0.14, 'metal'); P.box(x, y - 0.13, 0.5, 0.14, 0.02, 0.14, 'metal');
    P.glow(x, y + 0.02 + 0.05 * (1 - ph), 0.5, 0.08, 0.1 * (1 - ph) + 0.005, 0.08, 'wait', 0.9);
    P.glow(x, y - 0.12 + 0.05 * ph, 0.5, 0.1, 0.1 * ph + 0.005, 0.1, 'wait', 0.9);
  } else if (s === 'stale') { // 김 두 덩이가 천천히 오름(멈칫)
    if (!lite) for (let i = 0; i < 2; i++) { const ph = (t * 0.35 + i * 0.5 + seed) % 1; P.glow(0.15 - i * 0.3, H + 0.2 + ph * 0.5, -0.1, 0.18 + ph * 0.12, 0.12, 0.18 + ph * 0.12, 'smoke', 0.45 * (1 - ph)); }
  } else if (s === 'fail') { // 스파크 둘(깜빡) + 작은 연기 둘 — 실패 전이 중에는 불꽃 6(transFx)이 스파크를 대신함
    const on = Math.sin(t * 23 + seed) > 0.2 && !(X.on && (lite || X.tr === 'fail'));
    if (on) { P.glow(0.42, H * 0.7, 0.55, 0.07, 0.07, 0.07, 'run', 1.6); P.glow(0.3, H * 0.82, 0.6, 0.05, 0.05, 0.05, 'fail', 1.6); }
    if (!lite) for (let i = 0; i < 2; i++) { const ph = (t * 0.5 + i * 0.5) % 1; P.box(0.1 * i, H + 0.15 + ph * 0.6, 0, 0.16 + ph * 0.14, 0.12, 0.16 + ph * 0.14, 'smoke'); }
  }
}

/** 움직이는 부품 속도(dyn 없을 때): 진행 1 · 정체 가끔 덜컥 · 그 밖 멈춤 */
function spin(M, t) {
  if (M.state === 'run') return t;
  if (M.state === 'stale') return Math.floor(t / 2.3) * 0.25; // 가끔 덜컥
  return 0;
}

const SIG_C = ['fail', 'run', 'done'], SIG_Y = [1.58, 1.45, 1.32];
const SIG_ON = { fail: 0, stale: 1, run: 1, wait: 1, done: 2, stop: -1 };
const LED_K = [1, 0.7, 0.45];
/** 시험대: 끝난 시험 수가 늘면 그 관이 0.4초 펑(dyn 에 지난 pass·fail 기억) → 관 번호 | −1 */
function testsPop(M, nDone, nFail) {
  const d = X.d;
  if (d.lastPass >= 0 && (M.pass > d.lastPass || M.fail > d.lastFail)) {
    d.popAt = X.now; d.popFail = M.fail > d.lastFail;
    d.popI = d.popFail ? nDone - 1 : nDone - nFail - 1;
  }
  d.lastPass = M.pass; d.lastFail = M.fail;
  const age = X.now - d.popAt;
  return !d.reduced && age >= 0 && age < 0.4 && nDone > 0 ? Math.max(0, Math.min(RIGW.TUBES - 1, d.popI)) : -1;
}
// 스코프 망원경 yaw 회전(받침 축 _yp 둘레) — 회전 없으면 예전 좌표 그대로
let _ys = 0, _yc = 1, _yp = 0;
const yawX = (z) => (_ys === 0 ? 0 : (z - _yp) * _ys);
const yawZ = (z) => (_ys === 0 ? z : _yp + (z - _yp) * _yc);

const SHAPES = {
  /** 1. 시험대: 캐비닛 + 상판 + 시험관 8(유리 + 채움) + 신호등 기둥 · dyn: 스캐너 헤드 왕복, 결과 관 펑, 끝 = 결과 카드 밀려 나옴 */
  tests(P, M, t, seed) {
    P.box(0, 0.42, -0.05, 1.2, 0.68, 0.8, 'body');
    P.box(0, 0.8, 0, 1.28, 0.08, 0.92, 'kind'); // 상판 = 종류색
    P.box(-0.08, 0.88, 0.05, 0.98, 0.06, 0.3, 'metal');
    const N = RIGW.TUBES, tot = M.total > 0 ? M.total : 0, a = X.on ? X.pa : t;
    const doneK = tot ? (M.pass + M.fail) / tot : M.gauge;
    const nDone = doneK != null ? Math.round(clamp01(doneK) * N) : -1;
    const nFail = tot && M.fail > 0 ? Math.max(1, Math.round((M.fail / tot) * N)) : M.state === 'fail' ? 1 : 0;
    const pop = X.on ? testsPop(M, nDone, nFail) : -1;
    for (let i = 0; i < N; i++) {
      const x = -0.5 + i * (0.84 / (N - 1)), broken = nDone >= 0 && i < nDone && i >= nDone - nFail;
      P.box(x, 1.03, 0.05, 0.08, broken ? 0.16 : 0.3, 0.08, 'glass');
      let f = 0, c = 'done', kk = 0.9;
      if (nDone >= 0) { if (i < nDone) { f = 1; c = broken ? 'fail' : 'done'; } }
      else if (M.state === 'run') { const b = (a * 1.3 + i * 0.37 + seed) % 1; f = b * 0.9; c = 'liquid'; } // 모르면 도는 거품
      if (M.state === 'done' && nDone < 0) { f = 1; c = 'done'; }
      if (i === pop) { f = 1; c = X.d.popFail ? 'fail' : 'done'; kk = 1.6; }
      if (f > 0) P.glow(x, 0.9 + (broken ? 0.07 : 0.135 * f), 0.05, 0.055, (broken ? 0.12 : 0.27) * f, 0.055, c, kk);
    }
    // 신호등 기둥(오른쪽 뒤): 빨강·호박·초록 — 상태에 맞는 칸만 밝게
    const px = 0.52, pz = -0.35;
    P.box(px, 1.1, pz, 0.06, 0.6, 0.06, 'metal');
    P.box(px, 1.45, pz, 0.16, 0.42, 0.14, 'panel');
    const on = SIG_ON[M.state];
    for (let i = 0; i < 3; i++) P.glow(px, SIG_Y[i], pz + 0.075, 0.1, 0.1, 0.02, SIG_C[i], i === on ? (M.state === 'fail' ? (Math.sin(t * 14) > 0 ? 1.2 : 0.3) : 1) : 0.15);
    // 스캐너 헤드(dyn): 시험관 줄 위를 좌우 왕복(주기 2초 위상) — 줄을 가로지르는 발광 막대
    if (X.on) P.glow(-0.08 + 0.42 * Math.sin(X.pa * Math.PI), 1.22, 0.05, 0.12, 0.05, 1.0, 'trace', M.state === 'run' ? 1.1 : 0.3);
    if (M.state === 'done' && M.age < 6000) P.box(-0.25, 0.86, X.on ? 0.12 + 0.3 * easeOut(X.doneK) : 0.42, 0.34, 0.02, 0.24, 'paper'); // 결과 카드 배출
    return beacon(px, 1.78, pz);
  },

  /** 2. 반응로: 팔각 로 + 앞 창(빛 수위) + 굴뚝(연기) + 압력계(바늘 끝) + 끝이면 주괴 · dyn: 교반 날개 십자 회전, 연기 수 ∝ act */
  reactor(P, M, t, seed) {
    P.oct(0, 0.62, -0.08, 1.05, 1.08, 'body');
    P.oct(0, 1.2, -0.08, 0.9, 0.08, 'kind');
    if (X.on) { const r = X.pa * 7.5; P.box(0, 1.27, -0.08, 0.7, 0.05, 0.08, 'metal', r); P.box(0, 1.27, -0.08, 0.7, 0.05, 0.08, 'metal', r + Math.PI / 2); } // 1.2 rev/s × 속도
    P.box(0, 0.66, 0.38, 0.5, 0.62, 0.04, 'panel');
    const a = X.on ? X.pa : t;
    const lv = M.gauge != null ? M.gauge : M.state === 'run' ? 0.45 + 0.25 * Math.sin(a * 2.1 + seed) : M.state === 'done' ? 1 : 0.1;
    const hot = M.state === 'stop' ? 'stop' : M.state === 'fail' ? 'fail' : 'run';
    const wk = M.state === 'run' ? (X.on ? 0.7 + 0.3 * Math.sin(a * 4) : 0.8 + 0.2 * Math.sin(t * 9)) : 0.6;
    P.glow(0, 0.37 + 0.28 * lv, 0.41, 0.42, 0.56 * lv + 0.01, 0.02, hot, wk);
    P.box(0.28, 1.45, -0.3, 0.2, 0.5, 0.2, 'metal'); // 굴뚝
    if (M.state === 'run' && !(X.on && X.lite)) {
      const ns = X.on ? 1 + Math.round(3 * X.act) : 2;
      for (let i = 0; i < ns; i++) { const ph = (a * 0.6 + i / ns + seed) % 1; P.box(0.28 + ph * 0.1, 1.75 + ph * 0.22, -0.3, 0.14 + ph * 0.1, 0.1, 0.14 + ph * 0.1, 'smoke'); }
    }
    // 압력계: 둥근 판 + 바늘 끝(호 위 위치)
    const gx = -0.36, gy = 1.02;
    P.box(gx, gy, 0.37, 0.24, 0.24, 0.03, 'paper');
    const an = (-0.75 + 1.5 * (M.state === 'run' ? clamp01(lv + 0.08 * Math.sin(a * 7)) : lv)) * Math.PI * 0.5;
    P.glow(gx + Math.sin(an) * 0.08, gy + Math.cos(an) * 0.08, 0.39, 0.03, 0.03, 0.02, 'fail', 1);
    P.box(gx, gy, 0.39, 0.03, 0.03, 0.02, 'panel');
    // 받침 + 주괴(끝 = 밀려 나옴)
    P.box(0.32, 0.12, 0.5, 0.4, 0.06, 0.3, 'metal');
    if (M.state === 'done') { const k = clamp01(M.age / 900); P.glow(0.32, 0.2, 0.3 + 0.2 * k, 0.28, 0.1, 0.16, 'ingot', 0.9); }
    return beacon(-0.35, 1.4, -0.35);
  },

  /** 3. 원심 탱크: 왼쪽 회전 드럼(팔각, 돎) + 오른쪽 유리 탱크(수위 = 행 수) + 관 + 거품/주입 · dyn: 읽기 = 거품 오름, 쓰기 = 방울 떨어짐 */
  tank(P, M, t, seed) {
    const w = M.rw === 'w', sp = (X.on ? X.pa : spin(M, t)) * (w ? 7 : 2.5), a = X.on ? X.pa : t;
    P.box(-0.33, 0.25, 0, 0.62, 0.42, 0.62, 'body');
    P.oct(-0.33, 0.68, 0, 0.56, 0.44, 'metal', sp);
    P.box(-0.33, 0.68, 0, 0.6, 0.06, 0.12, 'trim', sp); // 드럼 날개(회전이 보이게)
    P.box(-0.33, 0.93, 0, 0.3, 0.06, 0.3, 'trim');
    const tx = 0.3;
    P.box(tx, 0.1, 0, 0.6, 0.12, 0.6, 'trim');
    P.box(tx, 0.85, 0, 0.56, 1.4, 0.56, 'glass');
    P.box(tx, 1.58, 0, 0.62, 0.06, 0.62, 'kind');
    const lv = M.gauge != null ? Math.max(0.08, M.gauge) : M.state === 'done' ? 0.85 : 0.3 + (M.state === 'run' ? 0.1 * Math.sin(a * 0.7 + seed) : 0);
    P.glow(tx, 0.16 + 0.65 * lv, 0, 0.48, 1.3 * lv, 0.48, 'liquid', 0.8);
    P.box(0, 1.22, 0, 0.36, 0.07, 0.07, 'metal'); // 관
    if (M.state === 'run') {
      if (w) P.glow(tx - 0.12, 1.15, 0, 0.05, 0.12 + 0.05 * Math.sin(a * 18), 0.05, 'liquid', 1.3); // 주입
      if (!(X.on && X.lite)) {
        const top = 0.16 + 1.3 * lv;
        for (let i = 0; i < 3; i++) {
          const ph = (a * (w ? 0.9 : 0.6) + i / 3 + seed) % 1;
          if (X.on && w) P.glow(tx - 0.12 + 0.12 * i, Math.max(top, 1.15 - ph * Math.max(0, 1.15 - top)), 0.1, 0.05, 0.05, 0.05, 'liquid', 1.1); // 쓰기 = 떨어지는 방울
          else P.glow(tx - 0.12 + 0.12 * i, 0.2 + ph * 1.25 * lv, 0.1, 0.05, 0.05, 0.05, 'paper', 0.8); // 읽기 = 오르는 거품
        }
      }
    }
    return beacon(-0.33, 1.08, 0);
  },

  /** 4. 통신 안테나: 기둥 + 접시(외벽 쪽, 진행 중 방향 잡기) + 송수신 등 + 빔 점(바이트) · 터널은 도는 고리 · dyn: 사각 신호 고리 2(주기 1/(0.3 + act)) */
  antenna(P, M, t, seed) {
    P.box(0, 0.3, 0, 0.7, 0.5, 0.7, 'body');
    P.box(0, 0.57, 0, 0.74, 0.05, 0.74, 'kind');
    P.box(0, 0.98, -0.05, 0.14, 0.9, 0.14, 'metal');
    const a = X.on ? X.pa : t;
    const yaw = X.on ? 0.35 * Math.sin(X.pa * 0.8 + seed) // 멈추면 그 방향 그대로
      : M.state === 'run' ? 0.35 * Math.sin(t * 0.8 + seed) : M.state === 'stale' ? 0.35 * Math.sin(Math.floor(t / 2.3)) : 0; // 접시 방향 잡기
    const dz = -0.28, dy = 1.42;
    P.box(0, dy, dz, 0.9, 0.62, 0.06, 'paper', yaw);
    P.box(0, dy, dz, 0.62, 0.86, 0.06, 'paper', yaw);
    P.box(0, dy, dz + 0.04, 0.5, 0.5, 0.02, 'trim', yaw);
    P.box(0, dy, dz - 0.2, 0.05, 0.05, 0.36, 'metal', yaw); // 급전 막대(바깥 쪽)
    const tx = M.state === 'run' && Math.sin(a * 9 + seed) > 0, rx = M.state === 'run' && Math.sin(a * 7 + 1.3) > 0.3;
    P.glow(-0.24, 0.6, 0.36, 0.08, 0.08, 0.02, 'run', tx ? 1.1 : 0.2);
    P.glow(0.24, 0.6, 0.36, 0.08, 0.08, 0.02, 'wait', rx ? 1.1 : 0.2);
    if (M.state === 'run') {
      const ex = Math.sin(yaw), ez = -Math.cos(yaw);
      if (M.tunnel) { // 끊이지 않는 고리
        for (let i = 0; i < 8; i++) { const an = a * 2 + (i / 8) * Math.PI * 2; P.glow(Math.cos(an) * 0.42, dy + Math.sin(an) * 0.42, dz - 0.12, 0.06, 0.06, 0.06, 'accent', 0.9); }
      } else {
        if (X.on) for (let i = 0; i < 2; i++) { // 사각 신호 고리: 접시에서 바깥으로 퍼짐(0.3 → 1.0, 밝기 1 → 0)
          const q = (X.d.ph2 + i * 0.5) % 1, s = 0.3 + 0.7 * q, d = 0.08 + 0.3 * q;
          P.glow(ex * d, dy, dz + ez * d, s, s, 0.02, 'accent', 1 - q, yaw);
        }
        if (!(X.on && X.lite)) {
          const nd = M.bytes > 0 ? Math.max(1, Math.round(M.gauge * RIGW.BEAM_DOTS)) : 3;
          for (let i = 0; i < nd; i++) { const ph = (a * 0.8 + i / nd) % 1, d = 0.1 + ph * 0.3; P.glow(ex * d, dy + 0.15 + ph * 0.35, dz + ez * d, 0.06, 0.06, 0.06, 'accent', 1 - ph * 0.6); }
        }
      }
    }
    return beacon(0.28, 0.72, 0.2);
  },

  /** 5. 감시 스코프: 받침 + 망원경(중심 쪽) + 렌즈(출력 때 번쩍, 재무장 대기 = 덮개) + 뒤 파형 화면 · dyn: 망원경 ±25° 스윕, 출력 때 멈칫 + 렌즈 섬광 */
  scope(P, M, t, seed) {
    P.box(0, 0.35, -0.1, 0.5, 0.6, 0.5, 'body');
    P.box(0, 0.78, -0.1, 0.12, 0.3, 0.12, 'metal');
    const yaw = X.on ? 0.44 * Math.sin(X.pq * 0.8 + seed) : 0;
    _ys = Math.sin(yaw); _yc = Math.cos(yaw); _yp = -0.1;
    P.box(yawX(0.08), 1.0, yawZ(0.08), 0.26, 0.26, 0.86, 'kind', yaw); // 망원경 통(앞 = 플랫폼 쪽)
    P.box(yawX(-0.38), 1.0, yawZ(-0.38), 0.32, 0.32, 0.12, 'body', yaw);
    const flash = Math.max(M.flash || 0, X.on && X.pulse < 0.3 ? 1 - X.pulse / 0.3 : 0);
    if (M.state === 'wait' || M.rearmWait) P.box(yawX(0.54), 1.0, yawZ(0.54), 0.3, 0.3, 0.04, 'panel', yaw); // 렌즈 덮개
    else P.glow(yawX(0.52), 1.0, yawZ(0.52), 0.2, 0.2, 0.02, 'glass', 0.7 + flash * 1.2, yaw);
    _ys = 0; _yc = 1;
    // 파형 화면(뒤쪽, 바깥에서도 보이게 옆으로 비스듬히): 판 + 막대 N
    const sx = -0.45, sy = 1.15, N = 8, a = X.on ? X.pa : t;
    P.box(sx, sy, -0.42, 0.05, 0.5, 0.6, 'screen');
    for (let i = 0; i < N; i++) {
      const z = -0.66 + i * (0.48 / (N - 1));
      const live = M.state === 'run';
      const spike = live ? Math.max(0, Math.sin(a * 4 - i * 0.9 + seed)) ** 6 * (0.35 + flash) : 0;
      const h = live ? 0.04 + 0.08 * Math.abs(Math.sin(a * 3 + i * 0.7)) + spike : 0.015;
      P.glow(sx + 0.03, sy + Math.min(0.22, h) / 2 - 0.05, z, 0.02, Math.min(0.22, h), 0.035, 'trace', live ? 1 : 0.35);
    }
    return beacon(0.36, 0.82, -0.3);
  },

  /** 6. 배양기: 캐비닛 + 유리 돔(팔각) + 결정(크기 = 진행률, 천천히 돎) + 앞 컨베이어(레인 1～2, 팔레트) + 과열 김 · dyn: 속도 ∝ act, 돔 빛 맥동, 끝 = 결정이 0.3m 떠오름 */
  incubator(P, M, t, seed) {
    P.box(0, 0.3, -0.12, 1.1, 0.5, 0.9, 'body');
    P.oct(0, 0.86, -0.12, 0.86, 0.62, 'glass');
    P.oct(0, 1.2, -0.12, 0.6, 0.06, 'kind');
    const a = X.on ? X.pa : t, sa = X.on ? X.pa : spin(M, t);
    const g = M.gauge != null ? M.gauge : M.state === 'done' ? 1 : 0.35 + (M.state === 'run' ? 0.1 * Math.sin(a * 0.4 + seed) : 0);
    const cs = 0.1 + 0.32 * g, rot = sa * 0.6, up = X.on ? 0.3 * easeOut(X.doneK) : 0;
    const ck = X.on && M.state === 'run' ? 0.85 + 0.25 * Math.sin(X.pa * 2) : 0.85;
    P.glow(0, 0.6 + cs / 2 + up, -0.12, cs, cs * 1.3, cs, 'crystal', ck, rot);
    P.glow(0, 0.6 + cs / 2 + up, -0.12, cs * 0.6, cs * 1.6, cs * 0.6, 'crystal', X.on ? ck + 0.25 : 1.1, rot + Math.PI / 4);
    // 컨베이어(앞): 레인마다 띠 한 줄 + 팔레트 3
    const lanes = M.lanes || 1, mv = sa * 0.35;
    for (let l = 0; l < lanes; l++) {
      const z = 0.44 + l * 0.18;
      P.box(0, 0.12, z, 1.24, 0.05, 0.14, 'panel');
      for (let i = 0; i < RIGW.PALLETS; i++) { const ph = (mv + i / RIGW.PALLETS + l * 0.17) % 1; P.box(-0.55 + ph * 1.1, 0.18, z, 0.12, 0.07, 0.1, 'ingot'); }
    }
    if (M.heat > 0.3 && !(X.on && X.lite)) for (let i = 0; i < 2; i++) { const ph = (t * 0.45 + i * 0.5) % 1; P.glow(-0.1 + 0.2 * i, 1.3 + ph * 0.4, -0.12, 0.16 + ph * 0.1, 0.1, 0.16 + ph * 0.1, 'smoke', 0.5 * M.heat * (1 - ph)); }
    return beacon(0.45, 0.72, -0.45);
  },

  /** 7. 오실로스코프 랙: 랙 + 칸 띠 + 둥근 화면(가는 파형이 흐름, 출력 = 스파이크, 조용하면 평선) + 손잡이 · dyn: 오른쪽 LED 막대 3이 출력마다 튐 */
  oscillo(P, M, t, seed) {
    P.box(0, 0.82, -0.08, 1.0, 1.56, 0.72, 'body');
    for (let i = 0; i < 3; i++) P.box(0, 0.3 + i * 0.22, 0.29, 0.92, 0.05, 0.02, 'kind');
    P.box(0, 1.2, 0.29, 0.66, 0.52, 0.02, 'screen');
    P.box(0, 1.2, 0.29, 0.52, 0.66, 0.02, 'screen'); // 둥근 화면(십자 겹침)
    const N = RIGW.TRACE_N, live = M.state === 'run' || M.state === 'wait';
    const quiet = M.pulseAt == null ? 1 : 0;
    const flash = M.flash || 0, a = X.on && M.state === 'run' ? X.pa : t;
    for (let i = 0; i < N; i++) {
      const x = -0.28 + i * (0.56 / (N - 1));
      const wave = live ? 0.06 * Math.sin(a * 5 - i * 0.8 + seed) * (quiet ? 0.6 : 1) : 0;
      const spike = flash > 0 && Math.abs(i - ((a * 6) % N)) < 1.2 ? 0.16 * flash : 0;
      P.glow(x, 1.2 + wave + spike, 0.31, 0.035, 0.03, 0.01, M.state === 'stale' ? 'stale' : 'trace', live || M.state === 'stale' ? 1 : 0.3);
    }
    for (let i = 0; i < 3; i++) P.box(-0.3 + i * 0.3, 0.9, 0.31, 0.08, 0.08, 0.04, 'metal');
    if (X.on) { // LED 막대 3: 높이 = 0.05 + 0.35·exp(−펄스 뒤 초/0.5)·(1, 0.7, 0.45)
      const e = X.pulse < 4 ? 0.35 * Math.exp(-X.pulse / 0.5) : 0;
      for (let i = 0; i < 3; i++) { const h = 0.05 + e * LED_K[i]; P.glow(0.38 + i * 0.055, 0.95 + h / 2, 0.31, 0.045, h, 0.02, 'trace', 0.5 + e * 2); }
    }
    return beacon(0.36, 1.68, -0.25);
  },

  /** 8. 분주 로봇: 받침대 + 웰 플레이트(4×3, i/N 칸이 참) + 팔(병렬도 만큼, 최대 3: 기둥·붐·끝) · dyn: 출력마다 첫 팔 끝 방울, 끝 = 웰 섬광 */
  dispenser(P, M, t, seed) {
    P.box(0, 0.38, 0, 1.24, 0.6, 1.0, 'body');
    P.box(0, 0.71, 0.12, 0.96, 0.05, 0.62, 'kind');
    const W = RIGW.WELLS, cols = 4, a = X.on ? X.pa : t;
    const filled = M.gauge != null ? Math.round(M.gauge * W) : M.state === 'done' ? W : M.state === 'run' ? Math.floor(a * 1.5 + seed) % (W + 1) : 0;
    const wk = 0.85 + (X.tr === 'done' ? 1.2 * (1 - X.k) : 0);
    for (let k = 0; k < W; k++) {
      const c = k % cols, r = (k / cols) | 0, x = -0.33 + c * 0.22, z = -0.06 + r * 0.18;
      if (k < filled) P.glow(x, 0.76, z, 0.12, 0.04, 0.12, M.state === 'fail' && k === filled - 1 ? 'fail' : 'liquid', wk);
      else P.box(x, 0.745, z, 0.12, 0.02, 0.12, 'panel');
    }
    const arms = M.par || 1, sp = X.on ? X.pa : spin(M, t);
    let tx0 = 0, tz0 = 0;
    for (let ai = 0; ai < arms; ai++) {
      const bx = -0.46 + ai * 0.46, ph = sp * 1.7 + ai * 1.9 + seed;
      const tx = bx * 0.4 + 0.25 * Math.sin(ph), tz = 0.12 + 0.15 * Math.cos(ph * 0.8);
      if (ai === 0) { tx0 = tx; tz0 = tz; }
      P.box(bx, 0.98, -0.4, 0.1, 0.5, 0.1, 'metal');
      P.box((bx + tx) / 2, 1.24, (-0.4 + tz) / 2, Math.abs(tx - bx) + 0.08, 0.07, Math.abs(tz + 0.4) + 0.08, 'trim');
      P.box(tx, 1.08 - (M.state === 'run' ? 0.08 * Math.max(0, Math.sin(ph * 2)) : 0), tz, 0.06, 0.26, 0.06, 'metal');
    }
    if (X.on && !X.lite && X.pulse < 0.4) P.glow(tx0, 0.93 - 0.15 * (X.pulse / 0.4), tz0, 0.05, 0.05, 0.05, 'liquid', 1.2); // 방울 → 웰
    return beacon(0.52, 0.82, -0.4);
  },

  /** 9. 범용 계측기: 작은 랙 + 앞 패널 + 다이얼(출력 박동마다 한 칸) · dyn: 바늘 흔들림, 기록지 띠가 출력마다 2cm 밀려 나옴 + 기록 펜, 끝 = 0.15m 끊어 냄 */
  meter(P, M, t, seed) { // eslint-disable-line no-unused-vars
    P.box(0, 0.6, -0.05, 1.1, 1.08, 0.86, 'body');
    P.box(0, 1.17, -0.05, 1.16, 0.06, 0.92, 'kind');
    P.box(0, 0.74, 0.39, 0.8, 0.42, 0.04, 'panel');
    const run = M.state === 'run', a = X.on ? X.pa : t;
    const step = M.pulseAt != null ? Math.floor(M.pulseAt / 1000) % 8 : run ? Math.floor(a) % 8 : 0;
    const an = (-0.75 + (step / 7) * 1.5) * Math.PI * 0.5 + (X.on && run ? 0.12 * Math.sin(X.pa * 9) : 0);
    P.box(-0.18, 0.76, 0.41, 0.26, 0.26, 0.02, 'paper');
    P.glow(-0.18 + Math.sin(an) * 0.09, 0.76 + Math.cos(an) * 0.09, 0.43, 0.035, 0.035, 0.02, 'fail', 1);
    for (let i = 0; i < 3; i++) P.glow(0.12 + i * 0.1, 0.74, 0.42, 0.05, 0.05, 0.02, i === (step % 3) && run ? 'run' : 'stop', 0.8);
    if (X.on) {
      const len = 0.04 + X.d.tape;
      P.box(0, 0.5, 0.37 + len / 2, 0.3, 0.01, len, 'paper');                  // 기록지 띠(앞 패널 아래)
      P.box(0.12 * Math.sin(X.pa * 3), 0.53, 0.42, 0.03, 0.05, 0.03, 'metal'); // 기록 펜(속도 = 활동)
      if (X.doneK > 0) P.box(0, Math.max(0.09, 0.5 - 0.41 * easeIn(X.doneK)), Math.min(0.64, 0.37 + len + 0.09), 0.3, 0.01, 0.15, 'paper'); // 끊어 낸 기록지
    }
    return null;
  },

  /** 10. 자동 실험 시퀀서(브리지 옆, 넓은 장비 1.8 × 1.3): 몸통 + 대시보드 + 회차 띠 5칸 + 진행 띠 · dyn: 추적등, 로봇 팔이 트레이 ↔ 대시보드 */
  sequencer(P, M, t, seed) {
    P.box(0, 0.5, -0.1, 1.3, 0.92, 1.0, 'body');
    P.box(0, 1.0, -0.1, 1.36, 0.06, 1.06, 'kind');
    P.box(0, 1.25, -0.45, 1.2, 0.5, 0.06, 'screen'); // 대시보드(뒤에서 앞을 봄)
    const band = M.band || EMPTY, nb = band.length, BC = SEQ_BC, a = X.on ? X.pa : t;
    const chase = X.on && M.state === 'run' ? Math.floor(X.pa * 2) % 5 : -1;
    for (let i = 0; i < 5; i++) {
      const bb = i - (5 - nb) >= 0 ? band[i - (5 - nb)] : 0;
      P.glow(-0.4 + i * 0.2, 1.32, -0.41, 0.16, 0.12, 0.02, BC[bb] || 'stop', i === chase ? 1.2 : bb ? (bb === 1 ? 0.6 + 0.4 * Math.sin(t * 5 + i) : 0.9) : 0.15);
    }
    const g = M.gauge != null ? M.gauge : 0;
    P.box(0, 1.14, -0.41, 0.84, 0.05, 0.02, 'panel');
    if (g > 0) P.glow(-0.42 + 0.42 * g, 1.14, -0.4, 0.84 * g, 0.05, 0.02, 'run', 0.9);
    // 시료 트레이(앞): 회차 진행 중이면 한 칸이 미끄러짐
    P.box(0, 0.98, 0.25, 1.0, 0.04, 0.3, 'metal');
    if (M.state === 'run' || M.running > 0) { const ph = (a * 0.3 + seed) % 1; P.box(-0.45 + ph * 0.9, 1.04, 0.25, 0.14, 0.06, 0.14, 'paper'); }
    if (X.on) { // 로봇 팔(기둥 + 붐 + 집게): 붐 끝이 트레이(z 0.25) ↔ 대시보드 앞(z −0.33)
      const u = 0.5 - 0.5 * Math.cos(X.pa * 1.5), zt = 0.25 - 0.58 * u;
      P.box(-0.42, 1.22, -0.08, 0.08, 0.38, 0.08, 'metal');
      P.box(-0.42, 1.43, (-0.08 + zt) / 2, 0.06, 0.05, Math.abs(zt + 0.08) + 0.06, 'trim');
      P.box(-0.42, 1.33, zt, 0.07, 0.16, 0.07, 'metal');
    }
    return beacon(0.55, 1.65, -0.45);
  },
};
const EMPTY = [];
const SEQ_BC = ['stop', 'run', 'done', 'stop', 'fail'];

/** 퇴장 승강판 내려감 0..1. liftT0 = 내려가기 시작(초, 렌더러 now), ts = 배속(√ 로 줄임). null 이면 0 */
export function rigLiftK(liftT0, now, ts = 1) {
  if (liftT0 == null || !Number.isFinite(liftT0)) return 0;
  const d = RIGW.LIFT_S / Math.max(1, Math.sqrt(ts || 1));
  return clamp01((now - liftT0) / d);
}
/** 승강판 시간(초) — 배속 √ */
export const rigLiftSec = (ts = 1) => RIGW.LIFT_S / Math.max(1, Math.sqrt(ts || 1));

// ───────────────────────────── 자리(설계) ─────────────────────────────
/**
 * 기자재 고리 자리(순수). 둘레 / STEP 칸, 방사 통로(GANGWAYS ± 폭/2 + 반 칸)에 걸리는 칸은 뺀다.
 * θ_B 에서 시작해 θ 가 커지는 쪽으로 번호. face = 중심을 봄.
 */
export function rigSlots(cx, cz, rP) {
  const r = labRadii(rP).rRig, n = Math.floor((2 * Math.PI * r) / LAB.RIG.STEP), step = 360 / n;
  const halfGap = ((LAB.GANGWAY_WIDTH / 2 + LAB.RIG.SIZE / 2) / r) / DEG;
  const out = [];
  for (let k = 0; k < n; k++) {
    const th = (LAB.BRIDGE_THETA + k * step) % 360;
    if (LAB.GANGWAYS.some((g) => Math.abs(dTheta(g, th)) < halfGap)) continue;
    const p = polar(cx, cz, r, th);
    out.push({ i: out.length, theta: th, x: p.x, z: p.z, face: faceIn(th) });
  }
  return out;
}

/**
 * 보조 선반 자리(고리가 찼을 때, 작은 기자재 0.6배, 최대 SHELF_MAX 12) — 바깥 순환 통로 안쪽 가장자리(rRigOut + 0.5),
 * 방사 통로 사이 6 구간의 가운데 양옆 두 칸. i 는 1000 부터(고리 번호와 겹치지 않게), scale 0.6.
 */
export function rigShelfSlots(cx, cz, rP) {
  const R = labRadii(rP), r = R.rRigOut + 0.5, out = [];
  const G = LAB.GANGWAYS;
  for (let g = 0; g < G.length && out.length < LAB.RIG.SHELF_MAX; g++) {
    const mid = (G[g] + 30) % 360;
    for (const d of [-9, 9]) {
      const th = (mid + d + 360) % 360, p = polar(cx, cz, r, th);
      out.push({ i: 1000 + out.length, theta: th, x: p.x, z: p.z, face: faceIn(th), shelf: true, scale: 0.6 });
    }
  }
  // θ_B 에서 가까운 순(브리지 쪽 먼저)
  return out.sort((a, b) => Math.abs(dTheta(LAB.BRIDGE_THETA, a.theta)) - Math.abs(dTheta(LAB.BRIDGE_THETA, b.theta)) || a.theta - b.theta).map((s, k) => ({ ...s, i: 1000 + k }));
}

/**
 * 자리 배정(순수): prev(Map id → i) 를 먼저 지키고, 나머지는 주인 각(ownerTheta)에 가장 가까운 빈칸(같으면 번호 작은 칸).
 * 칸이 모자라면 배정하지 않음(그 노드는 Map 에 없음 — 보조 선반 rigShelfSlots 를 slots 로 다시 부르거나 묶음 표지).
 * reserved = 비워 둔 자리 번호 Set(퇴장 뒤 VACANT_S 회색 표시 동안 다른 기자재가 못 씀) — 선택.
 */
export function assignRigSlots(rigs, slots, prev = null, reserved = null) {
  const out = new Map(), used = new Set(reserved || []), taken = new Set();
  const valid = new Set(slots.map((s) => s.i));
  const rest = [];
  for (const g of rigs) { // prev 가 비워 둔 자리보다 우선(재무장 Monitor 가 앞 자리를 이어받음)
    const i = prev && prev.get(g.id);
    if (i != null && valid.has(i) && !taken.has(i)) { taken.add(i); used.add(i); out.set(g.id, i); } else rest.push(g);
  }
  for (const g of rest) {
    let best = -1, bd = Infinity;
    for (const s of slots) {
      if (used.has(s.i)) continue;
      const d = g.ownerTheta == null ? s.i : Math.abs(dTheta(g.ownerTheta, s.theta));
      if (d < bd - 1e-9) { bd = d; best = s.i; }
    }
    if (best < 0) break;
    used.add(best); out.set(g.id, best);
  }
  return out;
}

export { thetaOf };
