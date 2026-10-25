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
};

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
    rows, line: job.line || '', progress: jobProgress(job), startedAt: job.startedAt || n.startedAt, endedAt: job.endedAt || n.endedAt || null };
}
