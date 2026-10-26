// Planet 분리 프로세스 · 장시간 직렬 작업 연출의 순수 규칙 — three·DOM 없음(node --test 대상, web/test/planet-proc.test.mjs).
// 3D(planet-proc.js)·2D(flat/planet-proc2d.js)가 같은 값을 쓰도록 모양·속도·광석 발사·계기 글자·들여다보기 장부를 여기서만 정한다.
//
// 은유: 분리 프로세스(kind 'bash-bg' + meta.proc) = 띄운 서브에이전트 행성 바깥 작은 소행성에 붙은 **채굴 드릴 플랫폼**
//  (갑판·삼각 데릭·회전하는 오거 드릴·굴뚝·상태 등). 자동 진행 작업(`j:<프로세스>:progress`, src 'auto') = 플랫폼 옆 **계기 홀로그램**
//  (레인마다 오도미터 숫자 · 처리율 · 최장 시간 · 과열 막대 · total 이면 진행 호·ETA). 레인마다 **컨베이어 궤도** 하나 — 광석 덩이가
//  플랫폼에서 띄운 행성 쪽 **화물 링**으로 흘러가 쌓인다(로그 진행 줄 하나 = 큰 광석 한 덩이, 그 사이는 처리율만큼 작은 부스러기).
//  드릴 회전 = 처리율, 과열(heat)이면 드릴 끝이 호박 → 주홍으로 달아오르고 열기 입자, 느려지며 가끔 멈칫(최장 시간 길수록).
//  들여다보기(watch): wait = 플랫폼 둘레 대기 궤도 고리 + 그 위를 도는 탐사선, peek·끝난 펄스 = 서브에이전트에서 플랫폼을 훑는 스캔 빔,
//  progress 면 플랫폼 → 서브에이전트로 돌아오는 작은 패킷 + 계기에 체크.
import { isProc, procOf, procState, procJobId, isAutoJob, jobOf, jobLaneValues, jobHeat, heatLevel, jobEtaMs, fmtRate, WatchTracker, isJobEndedState } from './job-core.mjs';
import { t as tr } from './i18n.mjs';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fhash = (x) => { const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

/** 치수·문턱(몸체 반지름 = 1) */
export const PROC = {
  BODY_K: 0.92,          // 분리 프로세스 몸체(소행성) 배율 — 보통 백그라운드 명령(0.74)보다 조금 크게(일하는 만큼 보이게), 서브에이전트(0.68 × 1.6)보다는 작게
  DECK_Y: 0.68,          // 갑판 높이(바위 윗면을 깎은 자리)
  TOP_Y: 2.0,            // 데릭 꼭대기
  WAIT_R: 2.5,           // 대기 궤도 고리 반지름
  CARGO_R: 1.85,         // 화물 링 반지름(띄운 행성 몸체 반지름 배)
  CARGO_SPAN: 0.95,      // 화물 링 반각(rad) — 플랫폼 쪽 호
  CARGO_MAX: 32,         // 레인당 쌓인 광석 상한
  ORE_MAX: 24,           // 레인당 날아가는 광석 상한
  LANES: 4,              // 그리는 레인 상한
  STALL_PX: 3,           // 이보다 작으면 점(LOD 0)
  DETAIL_PX: 10,         // 이보다 크면 오거 날·굴뚝·상태 등까지(LOD 2)
  METER_FULL_PX: 100,    // 계기 판 화면 높이가 이보다 작으면 큰 숫자 하나(먼 LOD — 작은 판은 글자가 안 읽힘)
};

/** 레인 색(다크/라이트) — 레인끼리 구분(구리·청록·보라·초록). 과열은 레인 색이 아니라 드릴 끝·계기 막대로 */
export const LANE_COLORS = {
  dark: ['#fbbf24', '#38bdf8', '#c084fc', '#4ade80'],
  light: ['#b45309', '#0369a1', '#7e22ce', '#15803d'],
};
export const laneColor = (i, light = false) => (light ? LANE_COLORS.light : LANE_COLORS.dark)[((i % 4) + 4) % 4];

/** 분리 프로세스 표시 상태별 모양: spin = 드릴 회전 기준(rad/s, running 은 처리율·과열로 다시 정함), lamp = 상태 등 토큰,
 *  blink = 상태 등 깜빡임, smoke = 굴뚝 연기 세기, tint = 몸체를 물들일 토큰(끝 초록·실패 빨강·중지 회색) */
export const PROC_LOOK = {
  running: { spin: 4.0, lamp: 'ok', blink: 0.6, smoke: 1, tint: null },
  stale: { spin: 0.35, lamp: 'skill', blink: 1.8, smoke: 0.25, tint: null },
  done: { spin: 0, lamp: 'ok', blink: 0, smoke: 0, tint: 'ok' },
  failed: { spin: 0, lamp: 'error', blink: 0, smoke: 0.4, tint: 'error' },
  stopped: { spin: 0, lamp: 'stopped', blink: 0, smoke: 0, tint: 'stopped' },
};
export const procLook = (state) => PROC_LOOK[state] || PROC_LOOK.running;

/**
 * 드릴 회전(rad/s). running: 과열 0 → 7.2, 과열 1 → 1.2(처음보다 100 배 느려진 것이 '천천히 갈리는' 드릴로 보이게),
 * 처리율을 모르면(진행 줄 인정 전) 3. stale 0.35, 끝나면 0. 움직임 줄이기 = 0.2 배.
 */
export function drillSpin(state, heat = 0, rate = null, reduced = false) {
  let w;
  if (state === 'running') w = rate > 0 ? 1.2 + 6.0 * Math.pow(1 - clamp(heat, 0, 1), 1.3) : 3.0;
  else w = procLook(state).spin;
  return reduced ? w * 0.2 : w;
}

/**
 * 멈칫(0..1 회전 배율): 과열이 클수록 몇 초마다 드릴이 잠깐 걸린다. 주기 = 2.2 + 최장 시간(초, 최대 6), 걸림 길이 0.18 + 0.3 × 과열.
 * 결정적(같은 t·seed = 같은 값). 과열 0.2 미만이면 1.
 */
export function drillHitch(t, heat = 0, longest = 0, seed = 0) {
  if (!(heat >= 0.2)) return 1;
  const P = 2.2 + clamp(Number(longest) || 0, 0, 6);
  const c = Math.floor(t / P + seed), x = t - (c - seed) * P;
  const at = P * (0.25 + 0.5 * fhash(c * 7.1 + seed * 3.3));
  const len = 0.18 + 0.3 * heat;
  if (x < at || x > at + len) return 1;
  const k = (x - at) / len;
  return 0.12 + 0.88 * Math.abs(2 * k - 1); // 걸렸다 풀림(V 모양)
}

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const AMBER = hexRgb('#ffb020'), VERM = hexRgb('#ff4a1c'), AMBER_L = hexRgb('#b45309'), VERM_L = hexRgb('#c2260f');
/**
 * 드릴 끝 열 빛: 과열 0..1 → { r, g, b, k(발광 세기 0..1), level }. 색은 호박(≤ 0.33) → 주홍(1), 세기 0.12 → 1.
 * 라이트 테마는 같은 색조의 진한 잉크(흰 바탕에 묻히지 않게 — 곱하기 잉크와 같은 원칙).
 */
export function heatTip(h, light = false) {
  const x = clamp(Number(h) || 0, 0, 1);
  const u = smooth(0.25, 1, x);
  const A = light ? AMBER_L : AMBER, V = light ? VERM_L : VERM;
  return { r: A[0] + (V[0] - A[0]) * u, g: A[1] + (V[1] - A[1]) * u, b: A[2] + (V[2] - A[2]) * u, k: 0.12 + 0.88 * smooth(0.05, 0.95, x), level: heatLevel(x) };
}
/** 열기 입자 초당 개수(과열 · 회전 몫) — 움직임 줄이기면 0 */
export function heatSparkRate(h, spin, reduced = false) {
  if (reduced || !(h > 0.15)) return 0;
  return clamp(h, 0, 1) * (3 + 6 * clamp(spin / 4, 0, 1)) + 1.5 * h;
}

/** 작은 광석 부스러기 사이 간격(초): 처리율이 높을수록 촘촘(초당 1만 → 0.4초, 초당 8 → 1.8초, 처리율 모름 → 2.6초) */
export function oreInterval(rate) {
  if (!(rate > 0)) return 2.6;
  return clamp(2.2 - 0.36 * Math.log10(1 + rate), 0.4, 2.6);
}
/** 광석이 컨베이어 하나를 건너는 시간(초) — 길이(세계 단위)에 비례, 처리율이 높으면 조금 빨리 */
export function oreFlight(len, rate) {
  const base = 1.6 + 0.32 * Math.max(0, Number(len) || 0);
  return clamp(base * (rate > 0 ? 1.15 - 0.08 * Math.min(4, Math.log10(1 + rate)) : 1), 1.2, 7);
}

/**
 * 광석 발사 장부(프로세스 하나): step(작업, dt, running) → 이번 프레임에 쏠 광석 [{lane, big}].
 *  · 레인 n 이 늘면(로그 진행 줄 하나가 관측됨 — 서버가 2초에 한 번 솎아 내므로 여러 줄이 한 번에 올 수 있다) 큰 광석 하나.
 *  · 회차가 바뀌면(pass) 큰 광석 하나 + newPass.
 *  · 그 사이는 처리율에 맞춘 작은 부스러기(running 일 때만) — 몇 분에 한 줄 오는 느린 작업도 컨베이어가 비어 보이지 않게.
 *  처음 본 레인은 쏘지 않는다(스냅샷·재연결 때 한꺼번에 쏟아지지 않게). 결정적(난수 없음).
 */
export class OreFeed {
  constructor() { this.lanes = new Map(); }
  clear() { this.lanes.clear(); }
  step(job, dt, running = true) {
    const out = [];
    const lanes = job && Array.isArray(job.lanes) ? job.lanes : [];
    for (let i = 0; i < lanes.length && i < PROC.LANES; i++) {
      const l = lanes[i];
      let s = this.lanes.get(l.key);
      if (!s) { s = { n: l.n, pass: l.pass || 1, acc: 0.5 }; this.lanes.set(l.key, s); continue; }
      const pass = l.pass || 1;
      if (pass !== s.pass) { s.pass = pass; s.n = l.n; out.push({ lane: i, big: true, newPass: true }); s.acc = 0; continue; }
      if (l.n > s.n) { s.n = l.n; out.push({ lane: i, big: true }); s.acc = 0; continue; }
      if (!running) continue;
      s.acc += dt / oreInterval(l.rate);
      if (s.acc >= 1) { s.acc -= Math.floor(s.acc); out.push({ lane: i, big: false }); }
    }
    return out;
  }
}

/** 레인 i(전체 n)의 컨베이어 곡선 조절: lift = 위로 솟는 높이(두 끝 거리 배), side = 옆 벌림(거리 배) — 레인마다 다른 궤도 */
export function conveyorBend(i, n) {
  const m = Math.max(1, n);
  return { lift: 0.22 + 0.13 * i, side: (i - (m - 1) / 2) * 0.2 };
}
/** 2차 베지어 한 점(x,y,z 객체 셋) → out */
export function quadAt(a, c, b, t, out) {
  const u = 1 - t;
  out.x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
  out.y = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
  out.z = u * u * (a.z || 0) + 2 * u * t * (c.z || 0) + t * t * (b.z || 0);
  return out;
}
/** 광석 진행(0..1 시간 → 곡선 위치): 플랫폼에서 천천히 들려 나가 가운데는 일정, 끝에서 화물 링에 내려앉음 */
export const oreEase = (k) => { const x = clamp(k, 0, 1); return x < 0.15 ? (x * x) / 0.3 : x > 0.85 ? 1 - ((1 - x) * (1 - x)) / 0.3 : 0.075 + (x - 0.15) * (0.85 / 0.7); };

/** 화물 링에 쌓인 광석 수 — 레인 값의 0.3 제곱(2,000 → 10, 68,000 → 28), 상한 CARGO_MAX. 값만으로 정하므로 라이브·재생·스냅샷이 같다 */
export function cargoCount(value) {
  if (!(value > 0)) return 0;
  return Math.min(PROC.CARGO_MAX, Math.max(1, Math.round(Math.pow(value, 0.3))));
}
/** 화물 링 k 번째 덩이 자리: 플랫폼 방향 중심 ±CARGO_SPAN 의 호를 바깥에서 안쪽으로 채움 → { a 각(중심 기준, rad), row 줄(0..) } */
export function cargoSlot(k) {
  const per = 12;
  const row = Math.floor(k / per), j = k % per;
  const u = per <= 1 ? 0.5 : j / (per - 1);
  const a = (u - 0.5) * 2 * PROC.CARGO_SPAN * (1 - 0.12 * row) + (row % 2 ? 0.04 : 0);
  return { a, row };
}

/** 분리 프로세스 LOD(몸체 화면 반지름 px): 0 = 점, 1 = 갑판·데릭·드릴 실루엣, 2 = 오거 날·굴뚝·상태 등·열기 입자 */
export function procLod(px) {
  if (!(px >= PROC.STALL_PX)) return 0;
  return px < PROC.DETAIL_PX ? 1 : 2;
}

/** 큰 숫자 글자: 천 단위 구분(en-US), 소수점 버림 */
export const bigNum = (v) => (Number.isFinite(v) ? Math.floor(v).toLocaleString('en-US') : '—');
/** 남은 시간 글자(언어 무관 시계 꼴): 59s · 12:05 · 1:02:03 */
export function clockText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p2 = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${p2(m)}:${p2(r)}` : `${m}:${p2(r)}`;
}

/**
 * 계기 홀로그램 모델(자동 작업 노드 하나): 레인 줄(보간 값 — job-core laneValue 그대로) · 진행 비율 · ETA · 과열 · 상태.
 * @returns {{ state, ended, rows:[{key, value, text, frac, unit, rate, last, heat, level, ratio, pass, color}], ratio, eta, heat, level, sig }}
 *   sig = 다시 그릴지 비교할 열쇠(보이는 글자가 바뀔 때만 달라짐 — 굴러가는 끝자리 frac 은 빼고 따로)
 */
export function meterModel(job, nowMs, light = false) {
  if (!job) return null;
  const ended = isJobEndedState(job.state);
  const vals = jobLaneValues(job, nowMs).slice(0, PROC.LANES);
  const rows = vals.map((l, i) => ({
    key: l.key, value: l.value, text: bigNum(l.value) + (l.total ? ' / ' + bigNum(l.total) : ''), frac: ended ? 0 : l.value - Math.floor(l.value),
    unit: l.unit || '', rate: fmtRate(l.rate), last: l.last && Number.isFinite(l.last.v) ? `${l.last.k} ${l.last.v}${l.last.u || ''}` : '',
    heat: l.heat, level: heatLevel(l.heat), ratio: l.ratio, pass: l.pass, color: laneColor(i, light),
  }));
  const pri = rows.find((r) => r.key === job.primary) || rows[0] || null;
  const etaMs = ended ? null : jobEtaMs(job, nowMs);
  const heat = jobHeat(job);
  const ratio = pri && pri.ratio != null ? pri.ratio : null;
  const sig = [job.state, rows.map((r) => r.text + '|' + r.rate + '|' + r.last + '|' + r.pass).join(';'), etaMs != null ? Math.round(etaMs / 1000) : '', heat.toFixed(2)].join('#');
  return { state: job.state, ended, rows, primary: pri, ratio, eta: etaMs != null ? clockText(etaMs) : '', heat, level: heatLevel(heat), sig };
}

/** 먼 LOD 의 큰 숫자 하나: 주 레인 보간 값(없으면 첫 레인) */
export function meterBig(job, nowMs) {
  const vals = jobLaneValues(job, nowMs);
  const p = vals.find((l) => l.key === (job && job.primary)) || vals[0];
  return p ? bigNum(p.value) : '';
}

/** 스크립트(없으면 프로그램) 이름 */
export function procName(n) {
  const p = procOf(n);
  if (!p) return '';
  return p.script || p.prog || (n.label || '').replace(/^[^·]*·\s*/, '') || '';
}

/**
 * 감독 한 줄(띄운·들여다보는 서브에이전트 라벨 셋째 줄): `감독 · probe_branches.py · 48,000 바퀴`
 * proc = 프로세스 노드, job = 그 자동 작업 노드의 meta.job(없으면 이름만)
 */
export function superviseLine(proc, job, nowMs) {
  const name = procName(proc);
  let n = '';
  if (job) {
    const vals = jobLaneValues(job, nowMs);
    const p = vals.find((l) => l.key === job.primary) || vals[0];
    if (p) n = bigNum(p.value) + (p.unit ? ' ' + p.unit : '');
  }
  // 문구는 흐름 표현과 같은 키(i18n cards.proc.supervise = '감독 · {name} · {n}') — 숫자가 없으면 끝 ' · ' 를 뗀다
  return tr('cards.proc.supervise', { name: String(name).slice(0, 32), n }).replace(/\s·\s*$/, '');
}

/**
 * 들여다보기 장부(3D·2D 공용): job-core WatchTracker 를 그대로 쓰고, 렌더러가 받는 길(이벤트·노드 추가·노드 갱신·초기화)을 한 곳에.
 *  · event(ev): watch 이벤트(app → view.flowEvent — 스크럽·밀린 이벤트는 오지 않으므로 아래 노드 길로 맞춘다)
 *  · node(n): 프로세스 노드가 들어오거나 meta.proc 이 바뀌면 그 노드의 열린 들여다보기를 meta.proc.watch 로 맞춘다(스냅샷·재생 시크·정지 재개)
 *  · pulses(now) → WatchTracker.pulses 그대로 + 열린 wait 의 탐사선 각 위상
 */
export class ProcWatch {
  constructor(opts) { this.tr = new WatchTracker(opts); this._sig = new Map(); }
  clear() { this.tr.clear(); this._sig.clear(); }
  event(ev) { if (ev && ev.type === 'watch') this.tr.push(ev); }
  node(n) {
    const p = procOf(n);
    if (!p) return;
    const list = Array.isArray(p.watch) ? p.watch : [];
    const sig = list.map((x) => x.toolUseId + '|' + x.nodeId).join(',');
    if (this._sig.get(n.id) === sig) return;
    this._sig.set(n.id, sig);
    const keep = new Set(list.map((x) => `${x.toolUseId}|${x.nodeId}|${n.id}`));
    for (const [k, o] of this.tr.open) if (o.to === n.id && !keep.has(k)) this.tr.open.delete(k);
    this.tr.seed([n]);
  }
  forget(id) { this._sig.delete(id); for (const [k, o] of this.tr.open) if (o.to === id || o.from === id) this.tr.open.delete(k); }
  pulses(nowMs) { return this.tr.pulses(nowMs); }
}

/** 들여다보기 하나 → 그리기 세기: beam(스캔 빔 0..1) · ring(대기 고리 0..1) · sweep(빔이 훑는 위치 0..1) · packet(되돌아오는 패킷 진행 0..1 | -1) */
export function watchLook(p) {
  if (!p) return null;
  const s = clamp(p.strength, 0, 1);
  const age = Math.max(0, p.ageMs || 0) / 1000;
  if (p.open && p.kind === 'wait') return { beam: 0.18 + 0.12 * (0.5 + 0.5 * Math.sin(age * 2.4)), ring: 1, sweep: (age * 0.35) % 1, packet: -1 };
  if (p.open) return { beam: 0.9, ring: 0, sweep: (age * 1.1) % 1, packet: -1 };
  // 끝난 펄스: 빔이 빠르게 옅어지고, progress 면 패킷이 플랫폼 → 읽는 노드로(펄스 앞 70% 동안)
  const k = 1 - s;
  return { beam: Math.pow(s, 1.6) * 0.8, ring: p.kind === 'wait' ? Math.pow(s, 2) : 0, sweep: k, packet: p.progress && k < 0.7 ? k / 0.7 : -1 };
}

/** 자동 작업 노드가 프로세스(분리 실행) 아래 진행 계기인가 */
export function isProcMeter(n, parent) { return isAutoJob(n) && !!parent && isProc(parent); }
export { isProc, procOf, procState, procJobId, jobOf };
