// 작업(Job) 오브젝트 — 세 표현·3D·2D·인스펙터가 함께 쓰는 순수 규칙
// three·DOM 없음(node --test 대상, web/test/jobs.test.mjs).
//
// 서버(server/jobs.mjs)가 보내는 것: 작업 노드 kind 'bash-bg', id `j:<주인 열쇠>:<작업 id>`, parentId = 출력을 낸
// 주인 노드(백그라운드 명령·Monitor·러너/기동기), meta.job = { v, id, title, state(queued|running|waiting|done|failed), phase,
// progress({n,total}|{ratio}|null), host, until(ISO), rc, beatAt(ISO), staleSec, stale(명시 정체), line(마지막 줄), src,
// startedAt, endedAt }, meta.title = 지금 단계(부제), status = running→active · done→done · failed→error · 그 밖 idle.
// 정체(박동 끊김)는 시계에 달려 있어 서버가 아니라 여기서 판정한다(라이브 = 지금, 재생 = 가상 시계 — 같은 규칙).

import { t as tr } from './i18n.mjs';
// batch-core 와 서로 부르지 않게(순환 import) 같은 꼴의 짧은 기간 글자를 따로 둔다
function fmtDur(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return tr('cards.t.s', { n: Math.max(1, Math.round(ms / 1000)) });
  if (m < 60) return tr('cards.t.m', { n: m });
  const h = Math.floor(m / 60), r = m % 60;
  return r ? tr('cards.t.h', { n: h }) + ' ' + tr('cards.t.m', { n: r }) : tr('cards.t.h', { n: h });
}

export const JOBW = {
  KEEP_ENDED: 3,     // 주인마다 남겨 둘 끝난 작업 수(서버 JOB.KEEP_ENDED 와 같은 값). 나머지는 접음(그리지 않음)
  STALE_SEC: 600,    // meta.job.staleSec 가 없을 때 정체 문턱
  WAIT_GRACE_SEC: 300, // 대기(until) 작업은 재확인 시각 + 이만큼 지나야 정체
  LABEL_PX: 4,       // 작업 노드 몸체가 화면에서 이만큼(반지름 px) 넘으면 끝났어도 라벨 후보(가까이서 보는 작업 — 끝난 외부 작업 라벨이 사라지던 것)
};
/** 라벨 후보: 작업 노드이고 화면 반지름 px 가 LABEL_PX 이상(끝남·오래됨과 무관) */
export const jobLabelNear = (n, px) => isJob(n) && px >= JOBW.LABEL_PX;

/** 작업 상태 번호(셰이더·2D 색 고르기용): 0 줄 섬 · 1 진행 · 2 대기 · 3 끝 · 4 실패 · 5 정체(끝나지 않은 작업만) */
export const JOB_CODE = { queued: 0, running: 1, waiting: 2, done: 3, failed: 4, stale: 5 };

const metaOf = (n) => (n && n.meta) || {};
const tsOf = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : NaN; };

/** 작업 노드인가 */
export const isJob = (n) => !!(n && metaOf(n).job && typeof metaOf(n).job === 'object');
export const jobOf = (n) => (isJob(n) ? metaOf(n).job : null);
export const isJobEndedState = (st) => st === 'done' || st === 'failed';

/**
 * 정체 판정 — 끝난 작업은 정체가 아니다.
 *  명시 정체(meta.job.stale, 규칙 'stale' · 규약 stale:true) 이거나, 마지막 박동(beatAt) 뒤 staleSec 이 지남.
 *  대기(waiting) 이고 until 이 있으면 기준은 max(박동, until + WAIT_GRACE_SEC).
 * @returns {{ stale:boolean, sinceMs:number|null }} sinceMs = 마지막 박동 뒤 흐른 시간
 */
export function jobStale(job, nowMs) {
  if (!job || isJobEndedState(job.state)) return { stale: false, sinceMs: null };
  const beat = tsOf(job.beatAt);
  const since = Number.isFinite(beat) && Number.isFinite(nowMs) ? Math.max(0, nowMs - beat) : null;
  if (job.stale) return { stale: true, sinceMs: since };
  if (since == null) return { stale: false, sinceMs: null };
  const lim = (Number(job.staleSec) > 0 ? Number(job.staleSec) : JOBW.STALE_SEC) * 1000;
  let ref = beat;
  if (job.state === 'waiting') {
    const u = tsOf(job.until);
    if (Number.isFinite(u)) ref = Math.max(beat, u + JOBW.WAIT_GRACE_SEC * 1000 - lim);
  }
  return { stale: nowMs - ref > lim, sinceMs: since };
}

/** 표시 상태: 정체가 이기고, 그 밖에는 서버 상태 */
export function jobDisplayState(job, nowMs) {
  if (!job) return null;
  if (jobStale(job, nowMs).stale) return 'stale';
  return JOB_CODE[job.state] != null ? job.state : 'running';
}
export const jobCode = (job, nowMs) => JOB_CODE[jobDisplayState(job, nowMs)] ?? 1;

/** 진행 비율 0..1, 모르면 null */
export function jobProgress(job) {
  const p = job && job.progress;
  if (!p) return null;
  if (Number.isFinite(p.ratio)) return Math.max(0, Math.min(1, p.ratio));
  if (Number.isFinite(p.n) && Number(p.total) > 0) return Math.max(0, Math.min(1, p.n / p.total));
  return null;
}
export function jobProgressText(job) {
  const p = job && job.progress;
  if (!p) return '';
  if (Number.isFinite(p.n) && Number(p.total) > 0) return `${p.n}/${p.total}`;
  if (Number.isFinite(p.ratio)) return `${Math.round(p.ratio * 100)}%`;
  return '';
}

const hhmm = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''; };

/**
 * 꼬리표(라벨 옆 작은 글자): [상태] [n/total] [~재확인] [정체 N분] [rc N]
 * 상태 글자는 표시 상태(정체면 '정체 …' 하나만).
 */
export function jobTags(job, nowMs) {
  if (!job) return [];
  const out = [];
  const s = jobStale(job, nowMs);
  if (s.stale) out.push(tr('cards.job.stale', { t: s.sinceMs != null ? fmtDur(s.sinceMs) || '?' : '?' }));
  else out.push(tr('cards.job.' + (JOB_CODE[job.state] != null ? job.state : 'running')));
  const pt = jobProgressText(job);
  if (pt && !isJobEndedState(job.state)) out.push(pt);
  if (job.state === 'waiting' && job.until) out.push(tr('cards.job.until', { t: hhmm(job.until) }));
  if (job.rc != null && (job.rc !== 0 || isJobEndedState(job.state))) out.push(tr('cards.job.rc', { n: job.rc }));
  return out;
}

/** 한 줄 요약(툴팁·2D 카드·인스펙터 머리): "진행 · 96/101 · DAILY 2단계 · build-01" */
export function jobSummary(job, nowMs) {
  if (!job) return '';
  const parts = jobTags(job, nowMs);
  if (job.phase) parts.splice(1, 0, job.phase);
  if (job.host) parts.push(job.host);
  return parts.join(' · ');
}

/**
 * 라벨을 다시 그려야 하는지 판단할 열쇠: 표시 상태·정체 분 단위가 바뀔 때만 달라진다.
 * 렌더러가 몇 초마다 이것만 비교해 시계로 바뀌는 정체 표시를 갱신한다(이벤트가 없어도).
 */
export function jobLabelKey(job, nowMs) {
  if (!job) return '';
  const s = jobStale(job, nowMs);
  return `${s.stale ? 'S' : job.state}|${s.stale && s.sinceMs != null ? Math.floor(s.sinceMs / 60000) : ''}`;
}

/**
 * 접기: 주인(부모)마다 끝난 작업 중 최근 KEEP_ENDED 개만 남기고 나머지는 숨긴다(회차 접기 와 같은 생각).
 * @param nodes Map id → node (퇴장한 노드 포함해도 됨)
 * @returns {{ hidden:Set<string>, byOwner:Map<string,string[]> }} byOwner = 주인 → 보이는 작업 id(시작 순)
 */
export function jobFold(nodes, { keepEnded = JOBW.KEEP_ENDED } = {}) {
  const hidden = new Set();
  const byOwner = new Map();
  const groups = new Map();
  for (const n of nodes.values()) {
    if (!isJob(n)) continue;
    const p = n.parentId || '';
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(n);
  }
  for (const [p, arr] of groups) {
    const ended = arr.filter((n) => isJobEndedState(jobOf(n).state));
    ended.sort((a, b) => (tsOf(b.endedAt || jobOf(b).endedAt) || 0) - (tsOf(a.endedAt || jobOf(a).endedAt) || 0) || (a.id < b.id ? -1 : 1));
    ended.slice(keepEnded).forEach((n) => hidden.add(n.id));
    const vis = arr.filter((n) => !hidden.has(n.id));
    vis.sort((a, b) => (tsOf(a.startedAt) || 0) - (tsOf(b.startedAt) || 0) || (a.id < b.id ? -1 : 1));
    byOwner.set(p, vis.map((n) => n.id));
  }
  return { hidden, byOwner };
}

/**
 * 인스펙터 내용 모델: 상태·단계·진행·호스트·박동·재확인·rc·출처·마지막 줄
 * @returns {{ title, state, display, stale, summary, rows:[[key,value]], line, progress }}
 */
export function jobInspect(n, nowMs) {
  const job = jobOf(n);
  if (!job) return null;
  const s = jobStale(job, nowMs);
  const rows = [];
  const disp = jobDisplayState(job, nowMs);
  rows.push(['state', tr('cards.job.' + (JOB_CODE[job.state] != null ? job.state : 'running')) + (s.stale ? ' · ' + tr('cards.job.stale', { t: s.sinceMs != null ? fmtDur(s.sinceMs) || '?' : '?' }) : '')]);
  if (job.phase) rows.push(['phase', job.phase]);
  const pt = jobProgressText(job);
  if (pt) rows.push(['progress', pt]);
  if (job.host) rows.push(['host', job.host]);
  if (job.beatAt) rows.push(['beat', job.beatAt]);
  if (job.until) rows.push(['until', job.until]);
  if (job.rc != null) rows.push(['rc', String(job.rc)]);
  if (job.src) rows.push(['src', job.src]);
  return { title: job.title || job.id, id: job.id, state: job.state, display: disp, stale: s.stale, summary: jobSummary(job, nowMs),
    rows, line: job.line || '', progress: jobProgress(job), startedAt: job.startedAt || n.startedAt, endedAt: job.endedAt || n.endedAt || null,
    // 자동 진행 작업: 레인 보간 값·과열·처리율·남은 시간(없으면 빈 배열·0·null)
    lanes: jobLaneValues(job, nowMs), heat: jobHeat(job), rate: job.rate ?? null, etaMs: jobEtaMs(job, nowMs) };
}

// ───────────── 분리 프로세스 · 진행 레인 · 과열(heat) · 들여다보기(watch) ─────────────
// 서버(server/procs.mjs·progress.mjs)가 보내는 것:
//  · 분리 프로세스 노드: kind 'bash-bg', id `b:<띄운 호출 id>`, parentId = 띄운 노드, meta.proc = { v, cmd, prog, script, via, log,
//    pidHint, spawnedBy, watch:[{nodeId, kind, via, since, toolUseId}], watchCount, lastWatchAt, endReason, rc }, meta.procStaleSec,
//    status active(로그가 자람) · idle(정체 — 적응 문턱) · done · error · stopped
//  · 자동 진행 작업: 그 아래 `j:<프로세스 id>:progress`(meta.job.src 'auto'), meta.job 에 lanes·primary·rate·eta·heat
//  · 이벤트 { type:'watch', nodeId: 읽는 노드, peer: 프로세스 노드, kind:'peek'|'wait', via:'shell'|'bg'|'monitor', phase:'start'|'end', toolUseId, progress? }
// 세 표현·2D·인스펙터가 같은 값을 쓰도록 보간·과열 단계·펄스는 여기서만 계산한다.

export const LANEW = {
  AHEAD_SEC: 300,  // 보간 상한: 마지막 관측 뒤 이만큼(또는 작업 staleSec)까지만 처리율로 늘린다
  PULSE_MS: 2400,  // 끝난 들여다보기 펄스가 사라지는 시간
  PULSE_MAX: 64,   // 기억하는 펄스 수
  HEAT_WARM: 0.33, HEAT_HOT: 0.66,
};

/** 분리 프로세스 노드인가 · meta.proc */
export const isProc = (n) => !!(n && n.meta && n.meta.proc && typeof n.meta.proc === 'object');
export const procOf = (n) => (isProc(n) ? n.meta.proc : null);
/** 프로세스의 자동 진행 작업 노드 id(진행 줄이 두 번 넘게 단조 증가해야 생기므로 없을 수 있다) */
export const procJobId = (n) => (n ? `j:${n.id}:progress` : null);
/** 자동 진행 작업(진행 줄 자동 인식)인가 */
export const isAutoJob = (n) => isJob(n) && jobOf(n).src === 'auto';
/** 작업의 레인 배열(없으면 []) */
export const jobLanes = (job) => (job && Array.isArray(job.lanes) ? job.lanes : []);

/** 프로세스 표시 상태: running(로그가 자람) · stale(정체 — 서버가 적응 문턱으로 idle) · done · failed · stopped */
export function procState(n) {
  if (!isProc(n)) return null;
  if (n.status === 'error') return 'failed';
  if (n.status === 'done' || n.status === 'stopped') return n.status;
  return n.status === 'idle' ? 'stale' : 'running';
}
/** 정체 문턱(초) — meta.procStaleSec, 없으면 300 */
export const procStaleSec = (n) => (n && n.meta && Number(n.meta.procStaleSec) > 0 ? Number(n.meta.procStaleSec) : 300);

/** 꼬리표: [정체] [rc N] [들여다봄 N] */
export function procTags(n) {
  const p = procOf(n);
  if (!p) return [];
  const out = [];
  if (procState(n) === 'stale') out.push(tr('cards.proc.stale'));
  if (p.rc != null) out.push(tr('cards.job.rc', { n: p.rc }));
  if (p.watchCount > 0) out.push(tr('cards.proc.watched', { n: p.watchCount }));
  return out;
}

/**
 * 보간된 레인 카운터: 마지막 관측 n + rate × (지금 − at), 최대 aheadSec(기본 300초 — 작업 staleSec 를 넘기면 그것)만큼 앞으로,
 * total 을 넘지 않음. 끝난 작업(ended)·처리율 모름이면 n 그대로.
 */
export function laneValue(lane, nowMs, { ended = false, aheadSec = null } = {}) {
  if (!lane || !Number.isFinite(lane.n)) return 0;
  const at = tsOf(lane.at);
  if (ended || !(lane.rate > 0) || !Number.isFinite(at) || !Number.isFinite(nowMs)) return lane.n;
  const lim = Number(aheadSec) > 0 ? Number(aheadSec) : LANEW.AHEAD_SEC;
  const dt = Math.max(0, Math.min(lim, (nowMs - at) / 1000));
  let v = lane.n + lane.rate * dt;
  if (Number(lane.total) > 0) v = Math.min(v, lane.total);
  return v;
}
/** 레인 진행 비율 0..1(total 이 있을 때만), 없으면 null */
export function laneRatio(lane, nowMs, opts) {
  if (!lane || !(Number(lane.total) > 0)) return null;
  return Math.max(0, Math.min(1, laneValue(lane, nowMs, opts) / lane.total));
}
/** 작업 전체 레인 보간 값 [{key, value, ratio, rate, heat, unit, total, pass, last}] — 세 표현이 같은 숫자를 그리게 */
export function jobLaneValues(job, nowMs) {
  const ended = !!job && isJobEndedState(job.state);
  const ahead = job && Number(job.staleSec) > 0 ? Number(job.staleSec) : null;
  return jobLanes(job).map((l) => ({ key: l.key, value: laneValue(l, nowMs, { ended, aheadSec: ahead }), ratio: laneRatio(l, nowMs, { ended, aheadSec: ahead }),
    rate: l.rate ?? null, heat: Number(l.heat) || 0, unit: l.unit || null, total: l.total ?? null, pass: l.pass || 1, last: l.last || null }));
}

/** 과열 0..1(처리율이 처음보다 떨어지거나 한 단위 최장 시간이 오를수록 큼) */
export const jobHeat = (job) => Math.max(0, Math.min(1, Number(job && job.heat) || 0));
/** 과열 단계: cool(< 0.33) · warm(< 0.66) · hot */
export const heatLevel = (h) => (h >= LANEW.HEAT_HOT ? 'hot' : h >= LANEW.HEAT_WARM ? 'warm' : 'cool');
/** 남은 시간(ms, eta 가 있을 때), 지났으면 0, 없으면 null */
export function jobEtaMs(job, nowMs) {
  const e = tsOf(job && job.eta);
  return Number.isFinite(e) && Number.isFinite(nowMs) ? Math.max(0, e - nowMs) : null;
}

const numText = (v) => {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (a >= 100) return Math.round(v).toLocaleString('en-US');
  return String(Number(v.toPrecision(a >= 10 ? 3 : 2)));
};
/** 처리율 글자: 초당 1 이상이면 '/s', 아니면 '/min' */
export function fmtRate(rate) {
  if (!(rate > 0)) return '';
  return rate >= 1 ? tr('cards.lane.perSec', { v: numText(rate) }) : tr('cards.lane.perMin', { v: numText(rate * 60) });
}
/** 레인 한 줄: "iter_pairs 46,000 바퀴 · 8.6/s" */
export function laneText(lane, nowMs, opts) {
  if (!lane) return '';
  const v = Math.floor(laneValue(lane, nowMs, opts));
  const n = v.toLocaleString('en-US') + (Number(lane.total) > 0 ? '/' + Number(lane.total).toLocaleString('en-US') : '');
  return [`${lane.key} ${n}${lane.unit ? ' ' + lane.unit : ''}`, fmtRate(lane.rate)].filter(Boolean).join(' · ');
}

/**
 * 들여다보기 기억(세 표현 공용). 이벤트 시각(ev.ts)과 시계(nowMs — 라이브 = 지금, 재생 = 가상 시계)로 판정하므로 라이브·재생이 같다.
 * 재생에서 뒤로 감거나 스냅샷을 새로 받으면 clear() 뒤 seed(노드들)로 다시 채운다.
 */
export class WatchTracker {
  constructor({ pulseMs = LANEW.PULSE_MS, max = LANEW.PULSE_MAX } = {}) {
    this.pulseMs = pulseMs;
    this.max = max;
    this.open = new Map(); // `${toolUseId}|${nodeId}|${peer}` → {from, to, kind, via, since}
    this.done = [];        // [{from, to, kind, via, since, at, progress}]
  }
  clear() { this.open.clear(); this.done = []; }
  /** 스냅샷: 프로세스 노드 meta.proc.watch(열린 들여다보기)로 채움 */
  seed(nodes) {
    for (const n of (nodes instanceof Map ? nodes.values() : nodes || [])) {
      const p = procOf(n);
      if (!p || !Array.isArray(p.watch)) continue;
      for (const x of p.watch) this.open.set(`${x.toolUseId}|${x.nodeId}|${n.id}`, { from: x.nodeId, to: n.id, kind: x.kind || 'peek', via: x.via || 'shell', since: tsOf(x.since) });
    }
  }
  /** watch 이벤트 하나(아니면 무시) */
  push(ev) {
    if (!ev || ev.type !== 'watch' || !ev.nodeId || !ev.peer) return;
    const key = `${ev.toolUseId}|${ev.nodeId}|${ev.peer}`;
    const t = tsOf(ev.ts);
    if (ev.phase === 'end') {
      const o = this.open.get(key);
      this.open.delete(key);
      this.done.push({ from: ev.nodeId, to: ev.peer, kind: ev.kind || (o && o.kind) || 'peek', via: ev.via || (o && o.via) || 'shell', since: o ? o.since : t, at: t, progress: !!ev.progress });
      if (this.done.length > this.max) this.done.splice(0, this.done.length - this.max);
    } else {
      this.open.set(key, { from: ev.nodeId, to: ev.peer, kind: ev.kind || 'peek', via: ev.via || 'shell', since: t });
    }
  }
  /**
   * 지금 그릴 것: 열린 들여다보기(open:true, strength 1 — wait 는 계속 흐르는 선, peek 는 짧은 빛) + 끝난 지 pulseMs 안의 펄스
   * (strength 1 → 0, progress = 결과에 진행 줄이 보였음). 시각이 시계보다 1초 넘게 뒤(되감기)인 것은 뺀다.
   * @returns [{from, to, kind, via, open, ageMs, strength, progress}]
   */
  pulses(nowMs) {
    const out = [];
    for (const o of this.open.values()) {
      if (Number.isFinite(o.since) && o.since > nowMs + 1000) continue;
      out.push({ from: o.from, to: o.to, kind: o.kind, via: o.via, open: true, ageMs: Number.isFinite(o.since) ? Math.max(0, nowMs - o.since) : 0, strength: 1, progress: false });
    }
    for (const d of this.done) {
      const age = nowMs - d.at;
      if (!(age >= -1000 && age < this.pulseMs)) continue;
      out.push({ from: d.from, to: d.to, kind: d.kind, via: d.via, open: false, ageMs: Math.max(0, age), strength: Math.max(0, 1 - Math.max(0, age) / this.pulseMs), progress: d.progress });
    }
    return out;
  }
}

/** 순수 함수 꼴: watch 이벤트 배열 → 지금 펄스 목록(WatchTracker 와 같은 규칙) */
export function watchPulses(events, nowMs, opts) {
  const w = new WatchTracker(opts);
  for (const ev of events || []) w.push(ev);
  return w.pulses(nowMs);
}
