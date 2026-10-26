// 흐름 표현의 분리 프로세스 장치 — 순수 규칙(three·DOM 없음, 시험 web/test/procrig.test.mjs).
// 흐름 3D(procrig.js)·흐름 2D(flat/proc2d.js)가 같은 값을 쓰도록 모양·움직임 규칙만 여기 둔다. 숫자(레인 보간·과열 단계·ETA·들여다보기 펄스)는
// 모두 job-core의 공용 함수 그대로 — 세 표현(흐름·Planet·복셀)이 같은 숫자를 그리게.
//
// 모습 요약: 분리 프로세스(meta.proc) 노드 = 세운 장치(기동기와 같은 상자 어휘) + 위에서 도는 로터 + 앞면 계기판(레인마다 숫자 드럼,
// 처리율 꼬리 그래프, 과열 눈금). 과열(heat)이 오를수록 장치가 달아오르고(다크 = 호박 → 주홍 발광·열기 아지랑이, 라이트 = 곱하기 잉크로 진해짐),
// 감독(watch)은 감독 노드 → 장치로 쓸고 가는 스캔 빛(peek 짧게)·장치 둘레 기다림 고리(wait)·계기판 체크(결과에 진행 줄).
import { isProc, procOf, procState, procJobId, jobOf, jobLaneValues, jobHeat, heatLevel, jobEtaMs, fmtRate, WatchTracker, LANEW } from '../job-core.mjs';
import { t as tr } from '../i18n.mjs';
import { escapeHtml as esc } from '../html-util.mjs';

const TAU = Math.PI * 2;

export const RIG = {
  SCALE: 1.55,        // 프로세스 칩 반지름 배율(백그라운드 명령 칩 대비) — 세운 장치(기동기 1.6 보다 조금 작게)
  THICK: 0.7,         // 앞뒤 깊이(칩 배율 단위, 기동기와 같음)
  FLAG: 3,            // chips iC.x: 0 보통 · 1 배치 장치 · 2 작업 칩 · 3 분리 프로세스 장치
  LOD_SIL_PX: 9,      // 장치 화면 반지름(px)이 이보다 작으면 실루엣만(숫자·로터 무늬 없음)
  LOD_FULL_PX: 30,    // 이 이상이면 계기판 전부(레인 줄·처리율 그래프·과열 눈금), 그 사이는 큰 숫자 하나
  FACE_MAX: 12,       // 계기판 캔버스 풀(동시에 숫자를 그리는 장치 수 상한 — 가까운 것부터)
  FACE_FPS: 12,       // 계기판 다시 그리기(가까운 장치) · 먼 장치(큰 숫자 하나)
  FACE_FPS_FAR: 4,
  SPIN_RUN: 3.4,      // 로터 각속도(rad/s): 돌아가는 중(과열이면 힘겹게 조금 느려짐 ×(1 − 0.35·heat))
  SPIN_STALE: 0.5,    // 정체(로그가 안 자람)
  SPIN_RATE: 1.4,     // 각속도가 목표로 다가가는 빠르기(1/s) — 끝나면 이 빠르기로 멈춰 섬
  SWEEP_MS: 650,      // 감독 스캔 빛이 감독 노드 → 장치를 한 번 쓸고 가는 시간(peek), wait 는 ×1.4
  RETURN_MS: 900,     // 결과에 진행 줄이 보였을 때 장치 → 감독 노드로 되돌아오는 작은 숫자 패킷
  TICK_MS: 1150,      // 진행 줄 눈금 패킷(장치에서 튀어나와 흐름선 위로 띄운 노드까지)
  TICK_POP: 0.22,     // 그중 앞부분은 장치 위로 튀어 오름
  TICK_MAX: 48,
  WAVE_MS: 1700,      // 끝 정리 파동
  TRAIL_N: 32,        // 처리율 꼬리 그래프 표본 수(레인 갱신마다 하나)
  LANES_SHOWN: 2,     // 계기판에 줄로 보이는 레인 수(나머지는 +N)
  ALARM_S: 1.1,       // 정체 경고 점 깜빡임 주기(초)
};

// ───────── 과열 색 ─────────
// 다크: 차분(청록) → 느려짐(호박) → 크게 느려짐(주홍) 발광. 라이트: 같은 색상을 진한 잉크로(곱하기로 바탕을 눌러 진해짐)
const HEAT_STOPS = {
  // 뜨거운 끝은 주홍(#ff6326) — 오류 빨강(#ff5566, 분홍빛)과 헷갈리지 않게 주황 쪽에 둔다
  dark: [[0, [0.36, 0.86, 0.82]], [0.33, [1.0, 0.73, 0.27]], [0.66, [1.0, 0.54, 0.23]], [1, [1.0, 0.39, 0.15]]],
  light: [[0, [0.06, 0.46, 0.43]], [0.33, [0.71, 0.33, 0.04]], [0.66, [0.76, 0.27, 0.05]], [1, [0.72, 0.2, 0.04]]],
};
/** 과열 0..1 → [r,g,b](0..1). out 을 주면 거기에 채움(프레임마다 배열 안 만듦) */
export function heatRgb(h, isLight = false, out = [0, 0, 0]) {
  const S = isLight ? HEAT_STOPS.light : HEAT_STOPS.dark;
  const x = Math.max(0, Math.min(1, Number(h) || 0));
  let i = 0;
  while (i < S.length - 2 && x > S[i + 1][0]) i++;
  const [x0, a] = S[i], [x1, b] = S[i + 1];
  const k = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
  out[0] = a[0] + (b[0] - a[0]) * k; out[1] = a[1] + (b[1] - a[1]) * k; out[2] = a[2] + (b[2] - a[2]) * k;
  return out;
}
export const rgbHex = (c) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');

/** 장치 상태 번호(셰이더·2D 공용): 0 돌아가는 중 · 1 정체 · 2 끝 · 3 실패 · 4 중지됨 */
export const RIG_CODE = { running: 0, stale: 1, done: 2, failed: 3, stopped: 4 };
export const rigCode = (st) => RIG_CODE[st] ?? 0;
export const rigEnded = (st) => st === 'done' || st === 'failed' || st === 'stopped';

// ───────── 장치 모델(그리기 직전 한 번) ─────────
/**
 * 분리 프로세스 노드 + (있으면) 그 자동 진행 작업 노드 → 그릴 값.
 * @param proc  프로세스 노드(meta.proc)
 * @param jobNode  `j:<proc>:progress` 노드(없으면 null — 진행 줄이 인정되기 전)
 * @returns {{state, code, ended, heat, level, lanes:[…], more, rate, rateText, etaMs, last, watchCount, script, unit}|null}
 */
export function rigModel(proc, jobNode, nowMs) {
  if (!isProc(proc)) return null;
  const p = procOf(proc);
  const state = procState(proc);
  const job = jobNode ? jobOf(jobNode) : null;
  const all = job ? jobLaneValues(job, nowMs) : [];
  // 가장 최근에 움직인 레인(primary)을 앞에 — 두 줄이면 원래 순서(서버 레인 순) 그대로 둔다(줄이 자리바꿈하지 않게)
  const lanes = all.slice(0, RIG.LANES_SHOWN);
  const prim = job && job.primary ? all.find((l) => l.key === job.primary) || all[0] : all[0];
  const heat = job ? jobHeat(job) : 0;
  const rate = job && job.rate > 0 ? job.rate : prim && prim.rate > 0 ? prim.rate : null;
  return {
    state, code: rigCode(state), ended: rigEnded(state), heat, level: heatLevel(heat),
    lanes, more: Math.max(0, all.length - lanes.length), primary: prim || null,
    rate, rateText: rate ? fmtRate(rate) : '', etaMs: job ? jobEtaMs(job, nowMs) : null,
    last: prim && prim.last ? prim.last : null, watchCount: p.watchCount || 0,
    script: p.script || p.prog || '', unit: prim ? prim.unit : null,
  };
}

/** 프로세스의 자동 진행 작업 노드(byId: Map 또는 (id)=>node) */
export function rigJob(proc, byId) {
  const id = procJobId(proc);
  return typeof byId === 'function' ? byId(id) || null : (byId && byId.get(id)) || null;
}

// ───────── 로터 ─────────
/** 로터 목표 각속도(rad/s): 돌아가는 중 SPIN_RUN×(1−0.35·heat) · 정체 SPIN_STALE · 끝 0. 움직임 줄이기면 0(정적) */
export function rotorTarget(state, heat = 0, reduced = false) {
  if (reduced) return 0;
  if (state === 'running') return RIG.SPIN_RUN * (1 - 0.35 * Math.max(0, Math.min(1, heat)));
  if (state === 'stale') return RIG.SPIN_STALE;
  return 0;
}
/** 각속도를 목표로 지수 접근시키며 각을 굴림(st = {w, a}). 끝나면 서서히 멈춰 섬. 처음 보는 장치는 바로 목표 속도 */
export function spinStep(st, target, dt) {
  if (st.w == null) { st.w = target; st.a = st.a || 0; }
  const k = 1 - Math.exp(-Math.max(0, dt) * RIG.SPIN_RATE);
  st.w += (target - st.w) * k;
  if (Math.abs(st.w) < 1e-3 && target === 0) st.w = 0;
  st.a = ((st.a || 0) + st.w * Math.max(0, dt)) % TAU;
  return st.a;
}

// ───────── 숫자 드럼(오도미터) ─────────
/** 천 단위 구분 정수 글자 */
export const fmtCount = (v) => Math.floor(Math.max(0, Number(v) || 0)).toLocaleString('en-US');
/** 짧은 숫자(먼 장치의 큰 숫자 하나): 9,999 까지 그대로, 그 위는 48.0k · 1.25M */
export function fmtCompact(v) {
  const n = Math.floor(Math.max(0, Number(v) || 0));
  if (n < 10000) return n.toLocaleString('en-US');
  if (n < 1e6) return (n / 1000).toFixed(n < 1e5 ? 1 : 0) + 'k';
  return (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + 'M';
}
/**
 * 드럼 칸: 왼쪽부터 [{ch, next, roll}] — 숫자 칸은 지금 숫자 ch 가 위로 빠지고 next 가 아래에서 roll(0..1)만큼 올라옴.
 * 일의 자리는 소수부만큼, 그 위 자리는 아래 자리가 모두 9 일 때만 같이 넘어간다(기계식 계수기). 쉼표 칸은 roll 0.
 */
export function drumCells(value, out = []) {
  const v = Math.max(0, Number(value) || 0);
  const I = Math.floor(v), f = v - I;
  const s = I.toLocaleString('en-US');
  out.length = 0;
  let carry = f; // 아래 자리가 모두 9 이면 소수부가 그대로 위로 전해짐
  const tmp = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i];
    if (ch < '0' || ch > '9') { tmp.push({ ch, next: ch, roll: 0 }); continue; }
    const d = ch.charCodeAt(0) - 48;
    tmp.push({ ch, next: String((d + 1) % 10), roll: carry });
    if (d !== 9) carry = 0;
  }
  for (let i = tmp.length - 1; i >= 0; i--) out.push(tmp[i]);
  return out;
}

// ───────── 진행 줄 눈금 패킷 ─────────
/**
 * 레인 값(n·회차)이 바뀐 수 = 새 진행 줄 수. 처음 보는 레인은 세지 않는다(스냅샷·첫 적재에서 패킷이 쏟아지지 않게).
 * memo: Map key → 'n|pass'
 */
export function laneTicks(memo, job) {
  if (!job || !Array.isArray(job.lanes)) return 0;
  let k = 0;
  for (const l of job.lanes) {
    const sig = `${l.n}|${l.pass || 1}`;
    const was = memo.get(l.key);
    if (was != null && was !== sig) k++;
    memo.set(l.key, sig);
  }
  return k;
}
/** 눈금 패킷 위치: 앞 TICK_POP 동안 장치 위로 튀어 오르고(pop 0→1), 그 뒤 흐름선을 따라 띄운 노드까지(u 1→0, 빔 위치). 끝나면 null */
export function tickPhase(ageMs) {
  const k = ageMs / RIG.TICK_MS;
  if (!(k >= 0 && k < 1)) return null;
  if (k < RIG.TICK_POP) { const q = k / RIG.TICK_POP; return { pop: 1 - (1 - q) * (1 - q), u: 1, alpha: Math.min(1, q * 3) }; }
  const q = (k - RIG.TICK_POP) / (1 - RIG.TICK_POP);
  const e = q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2;
  return { pop: 1 - q, u: 1 - e, alpha: q > 0.85 ? (1 - q) / 0.15 : 1 };
}

// ───────── 처리율 꼬리 그래프 ─────────
/** 레인 갱신마다 처리율 표본 하나(같은 갱신은 한 번). 그래프는 로그 눈금(100배 느려짐도 한 화면에) */
export class RateTrail {
  constructor(n = RIG.TRAIL_N) { this.n = n; this.v = []; this.sig = null; }
  clear() { this.v.length = 0; this.sig = null; }
  /** sig = 갱신 표지(주 레인 at), rate = 처리율 */
  push(sig, rate) {
    if (!(rate > 0) || sig === this.sig) return false;
    this.sig = sig;
    this.v.push(rate);
    if (this.v.length > this.n) this.v.splice(0, this.v.length - this.n);
    return true;
  }
  /** 0..1 높이 배열(최근이 끝) — 로그 눈금, 창 안 최대 = 1, 최대의 1/100 이하 = 0 */
  heights(out = []) {
    out.length = 0;
    if (!this.v.length) return out;
    let mx = 0;
    for (const r of this.v) mx = Math.max(mx, r);
    const lo = Math.log10(mx) - 2;
    for (const r of this.v) out.push(Math.max(0, Math.min(1, (Math.log10(r) - lo) / 2)));
    return out;
  }
}

// ───────── 감독(watch) ─────────
/**
 * WatchTracker 를 표현이 쓰기 좋게 감싼 것: 이벤트·스냅샷 씨앗·되감기 정리 + 그릴 때 거르기(끝난 프로세스·보이지 않는 노드로 가는 열린 것,
 * 그리고 장부(meta.proc.watch)에 더는 없는 열린 것 — 조용한(스크럽) 이벤트로 닫힌 경우).
 */
export class RigWatch {
  constructor(opts) { this.tr = new WatchTracker(opts); this._out = []; }
  reset() { this.tr.clear(); }
  event(ev) { if (ev && ev.type === 'watch') this.tr.push(ev); }
  seed(node) { if (isProc(node)) this.tr.seed([node]); }
  /**
   * @param nodeOf (id) => node|null (보이는 노드만)
   * @returns [{from, to, kind, via, open, ageMs, strength, progress}] (공용 배열 — 다음 호출까지 유효)
   */
  pulses(nowMs, nodeOf) {
    const out = this._out;
    out.length = 0;
    for (const p of this.tr.pulses(nowMs)) {
      const pn = nodeOf(p.to);
      if (!pn || !nodeOf(p.from)) continue;
      if (p.open) {
        if (rigEnded(procState(pn))) continue;
        const w = procOf(pn) && procOf(pn).watch;
        if (Array.isArray(w) && !w.some((x) => x.nodeId === p.from)) continue;
      }
      out.push(p);
    }
    return out;
  }
}
/**
 * 펄스 하나 → 그림 몫:
 *  sweep {head, tail, alpha} = 감독 노드(0) → 장치(1) 위 빛 토막(열린 직후 한 번 쓸고 감), ring = 장치 둘레 기다림 고리(wait 열림),
 *  thread = 감독 → 장치 가는 실(wait 열림, 옅게), check = 계기판 체크(끝 + 진행 줄, 사라지는 중), back = 장치 → 감독 되돌아오는 패킷 위치(1 → 0)
 */
export function watchFx(p) {
  const o = { sweep: null, ring: 0, thread: 0, check: 0, back: null };
  if (!p) return o;
  if (p.open) {
    const dur = RIG.SWEEP_MS * (p.kind === 'wait' ? 1.4 : 1);
    if (p.ageMs < dur) {
      const head = p.ageMs / dur;
      o.sweep = { head, tail: Math.max(0, head - 0.35), alpha: head > 0.8 ? 0.4 + 0.6 * (1 - head) / 0.2 : 1 };
    }
    if (p.kind === 'wait') { const fin = Math.min(1, p.ageMs / 500); o.ring = fin; o.thread = 0.5 * fin; }
    return o;
  }
  if (p.kind === 'wait') o.ring = Math.max(0, 1 - p.ageMs / 400); // 닫힐 때 고리가 짧게 걷힘
  if (p.progress) {
    o.check = p.strength;
    if (p.ageMs < RIG.RETURN_MS) o.back = 1 - p.ageMs / RIG.RETURN_MS;
  }
  return o;
}

// ───────── 감독 한 줄(노드 라벨 작업 줄) ─────────
/** nodeId 가 띄웠거나 지금 들여다보는, 끝나지 않은 프로세스들(nodes: Map id → node) */
export function supervisedProcs(nodeId, nodes) {
  const out = [];
  if (!nodeId || !nodes) return out;
  for (const n of nodes.values()) {
    if (!isProc(n)) continue;
    const p = procOf(n), st = procState(n);
    if (rigEnded(st)) continue;
    if (p.spawnedBy === nodeId || n.parentId === nodeId || (Array.isArray(p.watch) && p.watch.some((w) => w.nodeId === nodeId))) out.push(n);
  }
  return out;
}
/**
 * "감독 · probe_branches.py · 48,000 바퀴" — 감독하는 프로세스가 둘 이상이면 가장 최근에 띄운 것 + "+N".
 * 진행 레인이 아직 없으면 숫자 없이. 없으면 ''.
 */
export function superviseText(nodeId, nodes, nowMs) {
  const ps = supervisedProcs(nodeId, nodes);
  if (!ps.length) return '';
  ps.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')) || (a.id < b.id ? 1 : -1));
  const n = ps[0], p = procOf(n);
  const m = rigModel(n, rigJob(n, nodes), nowMs);
  const name = p.script || p.prog || n.label || n.id;
  const lane = m && m.primary;
  const cnt = lane ? `${fmtCount(lane.value)}${lane.unit ? ' ' + lane.unit : ''}` : '';
  const more = ps.length > 1 ? ` +${ps.length - 1}` : '';
  return tr('cards.proc.supervise', { name: String(name).slice(0, 32), n: cnt }).replace(/\s·\s*$/, '') + more;
}

/** 끝 파동 색 이름: done 초록 · failed 빨강 · stopped 회색 · 그 밖 null */
export const endTone = (st) => (st === 'done' ? 'ok' : st === 'failed' ? 'error' : st === 'stopped' ? 'stopped' : null);

/** 화면 반지름(px) → LOD: 0 실루엣 · 1 큰 숫자 하나 · 2 계기판 전부 */
export const rigLod = (px) => (px < RIG.LOD_SIL_PX ? 0 : px < RIG.LOD_FULL_PX ? 1 : 2);

/** 정체 경고 점 밝기(0..1): 깜빡임(움직임 줄이기면 늘 켬) */
export const alarmBlink = (t, reduced = false) => (reduced ? 1 : 0.25 + 0.75 * (Math.sin((t / RIG.ALARM_S) * TAU) > -0.2 ? 1 : 0));

export { LANEW };

/**
 * 감독 관계 집합(라벨 감독 한 줄용): sup = 끝나지 않은 프로세스를 띄웠거나(spawnedBy·부모) 들여다보는 노드, wat = 지금 들여다보기를 열어 둔 노드.
 * @param nodes 노드 반복자(Map.values() 등) — 프로세스 노드만 본다
 */
export function supervisorSets(nodes, sup = new Set(), wat = new Set()) {
  sup.clear(); wat.clear();
  for (const n of nodes) {
    if (!isProc(n) || rigEnded(procState(n))) continue;
    const p = procOf(n);
    if (p.spawnedBy) sup.add(p.spawnedBy);
    if (n.parentId) sup.add(n.parentId);
    if (Array.isArray(p.watch)) for (const w of p.watch) if (w && w.nodeId) { sup.add(w.nodeId); wat.add(w.nodeId); }
  }
  return { sup, wat };
}

/**
 * 진행 줄 눈금 패킷 판정(흐름 3D·2D 공용): 자동 진행 작업의 node-update(조용하지 않은 것 — flowEvent 로 온 것만)마다 레인 값이 바뀐 수.
 * @returns {{procId, n}|null} procId = 그 작업의 주인 프로세스
 */
export class RigTicks {
  constructor(max = 256) { this.memo = new Map(); this.max = max; }
  clear() { this.memo.clear(); }
  fromEvent(ev, nodeOf) {
    if (!ev || ev.type !== 'node-update' || !ev.patch || !ev.patch.meta || !ev.patch.meta.job) return null;
    const jn = nodeOf(ev.nodeId);
    if (!jn || !jn.meta || !jn.meta.job || jn.meta.job.src !== 'auto') return null;
    let mm = this.memo.get(ev.nodeId);
    if (!mm) { mm = new Map(); this.memo.set(ev.nodeId, mm); if (this.memo.size > this.max) this.memo.delete(this.memo.keys().next().value); }
    const k = laneTicks(mm, ev.patch.meta.job);
    const pn = jn.parentId ? nodeOf(jn.parentId) : null;
    return k && pn && isProc(pn) ? { procId: pn.id, n: k } : null;
  }
}

/** 짧은 남은 시간 글자(45초 · 12분 · 1시간 5분) */
export function shortDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return tr('cards.t.s', { n: Math.max(1, s) });
  const m = Math.round(s / 60);
  if (m < 60) return tr('cards.t.m', { n: m });
  const h = Math.floor(m / 60), r = m % 60;
  return r ? tr('cards.t.h', { n: h }) + ' ' + tr('cards.t.m', { n: r }) : tr('cards.t.h', { n: h });
}
/** 누적 눈금 한 칸 단위(처리율에 맞춘 10의 거듭제곱 — 테이프가 보기 좋은 빠르기로 흐르게) */
export function tapeStep(rate) {
  const r = rate > 0 ? rate : 1;
  return Math.pow(10, Math.max(0, Math.floor(Math.log10(r))));
}

/** 마우스 올림 작은 카드 내용(흐름 3D·2D 공용, .proc-tip): 이름·상태 · 레인 줄(값·처리율) · 처리율·과열·남은 시간·들여다봄 · 최장 시간 */
export function rigTipHtml(m, node) {
  if (!m || !node) return '';
  const p = procOf(node) || {};
  const rows = m.lanes.map((l) => `<li><b>${esc(l.key)}</b><span>${esc(fmtCount(l.value) + (l.total ? '/' + fmtCount(l.total) : '') + (l.unit ? ' ' + l.unit : ''))}</span><small>${esc(fmtRate(l.rate))}</small></li>`).join('');
  const parts = [m.rateText ? tr('cards.lane.rate', { v: m.rateText }) : '', tr('cards.lane.heat', { v: m.heat.toFixed(2), lv: tr('cards.heat.' + m.level) }),
    m.etaMs != null && !m.ended ? tr('cards.lane.eta', { t: shortDur(m.etaMs) }) : '', m.watchCount ? tr('cards.proc.watched', { n: m.watchCount }) : ''].filter(Boolean);
  return `<div class="pt-h"><i class="pt-led"></i>${esc(p.script || p.prog || node.label || '')}<small>${esc(tr('cards.proc.st.' + m.state))}</small></div>`
    + (rows ? `<ul>${rows}</ul>` : '') + `<p>${esc(parts.join(' · '))}</p>`
    + (m.last ? `<p class="pt-dim">${esc(`${m.last.k} ${m.last.v}${m.last.u || ''}`)}</p>` : '');
}
