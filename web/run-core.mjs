// 실행 중 셸(meta.run) — 세 표현·3D·2D·인스펙터·카메라가 함께 쓰는 순수 규칙
// three·DOM 없음(node --test 대상, web/test/run.test.mjs).
//
// 서버가 보내는 것:
//  · 전경: 셸 도구(Bash·PowerShell)가 열린 노드에 meta.run = { kind:'fg', tool, since(ms), lastOut(ms|null), staleAfter(ms), buffered }, 도구가 끝나면 null
//  · 백그라운드 bash-bg 노드: meta.run = { kind:'bg', since, lastOut, staleAfter, buffered, rc?, ended?(ms) }
//  · 실행 중이면 status 'active' 를 유지(정체 판정 전까지). 박동 이벤트는 없다 —
//    경과·조용함·정체는 여기서 렌더러 시계로 판정한다(라이브 = 지금, 재생 = 재생 가상 시계 — 작업 정체와 같은 방식).
// 시각은 ms 수(ISO 문자열도 받아 줌), staleAfter 는 길이(ms).

import { t as tr } from './i18n.mjs';

export const RUNW = {
  QUIET_MS: 30_000,     // 마지막 출력(없으면 시작) 뒤 이만큼 지나면 '조용함'
  LONG_MS: 30_000,      // 셸 패널 '장시간 실행' 구분 문턱
  HEAD_MIN_MS: 3_000,   // 셸 패널 머리줄 경과를 붙이기 시작하는 시간(짧은 도구는 다시 그리지 않게)
  SEC_MS: 600_000,      // 경과를 m:ss(초 단위 갱신)로 보이는 상한 — 넘으면 분 단위 글자(분마다 갱신, 부하 줄임)
  CAM_STEP_MS: 30_000,  // 카메라 가산점: 경과 이만큼마다 +1
  CAM_MAX: 6,           // 가산점 상한
  LABEL_FIRST: 3,       // 라벨 후보에서 최근 활동 노드보다 먼저 자리를 받는 실행 중 셸 수(오래 돈 순)
  STALE_MS: 600_000,    // staleAfter 가 없을 때 정체 문턱
};

const metaOf = (n) => (n && n.meta) || {};
const ENDED_ST = new Set(['done', 'error', 'stopped']);
/** ms 수 또는 ISO → ms(모르면 NaN) */
export function toMs(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : NaN;
  if (typeof x === 'string' && x) { const t = Date.parse(x); return Number.isFinite(t) ? t : NaN; }
  return NaN;
}

/** 노드의 meta.run(모양이 틀리면 null) */
export function runOf(n) {
  const r = metaOf(n).run;
  if (!r || typeof r !== 'object') return null;
  if (r.kind !== 'fg' && r.kind !== 'bg') return null;
  return r;
}
/** meta.run 이 끝났나: ended·rc 가 있거나 노드가 끝남 */
export function runEnded(run, n = null) {
  if (!run) return true;
  if (Number.isFinite(toMs(run.ended)) || (run.rc != null && run.rc !== '')) return true;
  return !!(n && ENDED_ST.has(n.status));
}

/**
 * 시계 nowMs 에서 본 실행 상태 → null(meta.run 없음) | {
 *   kind, tool, ended, rc, buffered, bufferWhy('python'|'pipe'|'devnull', 서버가 안 실었으면 'python'), since, lastOut,
 *   elapsedMs  — 시작 뒤 경과(끝났으면 시작～끝), 시계가 시작보다 앞(되감기)이면 0
 *   quietMs    — 마지막 출력(없으면 시작) 뒤 흐른 시간
 *   quiet      — 끝나지 않았고 quietMs ≥ QUIET_MS
 *   stale      — 끝나지 않았고 quietMs > staleAfter(정체)
 *   staleAfter
 * }
 */
export function runState(n, nowMs) {
  const r = runOf(n);
  if (!r) return null;
  const since = toMs(r.since);
  const last = toMs(r.lastOut);
  const endAt = toMs(r.ended);
  const ended = runEnded(r, n);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const tEnd = ended ? (Number.isFinite(endAt) ? Math.min(endAt, now) : now) : now;
  const elapsedMs = Number.isFinite(since) ? Math.max(0, tEnd - since) : 0;
  const ref = Number.isFinite(last) ? last : since;
  const quietMs = Number.isFinite(ref) ? Math.max(0, now - ref) : 0;
  const sa = Number(r.staleAfter) > 0 ? Number(r.staleAfter) : RUNW.STALE_MS;
  // 전경 셸의 lastOut 이 null 이면 '출력 없음'인지 '모름'(재생에서는 늘 null)인지 가릴 수 없다 → 버퍼링 추정(python)일 때만 조용함, 정체는 판정하지 않음
  const blind = r.kind === 'fg' && !Number.isFinite(last);
  return {
    kind: r.kind, tool: r.tool || null, ended, rc: r.rc != null && r.rc !== '' ? r.rc : null, buffered: !!r.buffered, bufferWhy: r.buffered ? bufferWhyOf(r) : null,
    since: Number.isFinite(since) ? since : null, lastOut: Number.isFinite(last) ? last : null, staleAfter: sa,
    elapsedMs, quietMs,
    quiet: !ended && quietMs >= RUNW.QUIET_MS && (!blind || !!r.buffered),
    stale: !ended && !blind && Number.isFinite(ref) && quietMs > sa,
  };
}

/** 표시 모습: null(없음·끝남) | 'run'(실행 중 — 대기 모습이 아니라 작업 중 모습) | 'stale'(정체 — 기존 정체 모습) */
export function runVis(n, nowMs) {
  const s = runState(n, nowMs);
  if (!s || s.ended) return null;
  return s.stale ? 'stale' : 'run';
}
/** 실행 중(정체 아님)인가 */
export const runWorking = (n, nowMs) => runVis(n, nowMs) === 'run';

/**
 * 모습용 상태: 실행 중인데 서버 상태가 idle(예전 서버·판정 차이)이면 'active', 정체인데 active 면 'idle'. 그 밖에는 서버 상태 그대로.
 * 라벨·퇴장 판정에는 쓰지 않는다(그림만).
 */
export function runVisStatus(n, nowMs) {
  const st = n && n.status;
  if (!runOf(n)) return st;
  const v = runVis(n, nowMs);
  if (v === 'run' && st === 'idle') return 'active';
  if (v === 'stale' && st === 'active') return 'idle';
  return st;
}

/** 라벨 둘째 줄 상태 글자: 정체면 '정체', 실행 중인데 서버가 idle 이면 '작업 중'(label(status) 로), 그 밖 label(서버 상태) */
export function runStatusText(n, nowMs, label) {
  const st = n && n.status;
  if (!runOf(n)) return label(st);
  const v = runVis(n, nowMs);
  if (v === 'stale') return tr('cards.proc.stale');
  return label(v === 'run' && st === 'idle' ? 'active' : st);
}

/**
 * 라벨 후보: 끝나지 않은 실행 중 셸(정체 포함) id 를 오래 돈 순으로 — 노드가 많아도 라벨 후보에서 빠지지 않게.
 * 앞 RUNW.LABEL_FIRST 개는 '최근 활동' 노드보다 먼저 자리를 받는다. vis = 렌더러 vis 값들({id, node})
 */
export function runLabelOrder(vis, nowMs) {
  const out = [];
  for (const v of vis) {
    const n = v && v.node;
    if (!n || !n.meta || !n.meta.run) continue;
    const s = runState(n, nowMs);
    if (s && !s.ended) out.push([v.id, s.elapsedMs]);
  }
  out.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return out.map((x) => x[0]);
}

const pad2 = (x) => String(x).padStart(2, '0');
/** 경과 글자: 10분 미만 m:ss, 그 위는 분 단위(내림) '14분'·'1시간 5분' */
export function runClock(ms) {
  const m = Math.max(0, Number(ms) || 0);
  if (m < RUNW.SEC_MS) { const s = Math.floor(m / 1000); return `${Math.floor(s / 60)}:${pad2(s % 60)}`; }
  return minText(m);
}
/** 분 단위 글자(내림): '14분'·'1시간'·'1시간 5분' — 1분 미만이면 30초 단위 '30초' */
export function minText(ms) {
  const m = Math.max(0, Number(ms) || 0);
  if (m < 60_000) return tr('cards.t.s', { n: Math.floor(m / 30_000) * 30 || Math.floor(m / 1000) });
  const mins = Math.floor(m / 60_000);
  if (mins < 60) return tr('cards.t.m', { n: mins });
  const h = Math.floor(mins / 60), r = mins % 60;
  return r ? `${tr('cards.t.h', { n: h })} ${tr('cards.t.m', { n: r })}` : tr('cards.t.h', { n: h });
}

/** 경과 갱신 칸(같으면 글자가 같다): 10분 미만 초, 그 위 분 */
const elapsedStep = (ms) => (ms < RUNW.SEC_MS ? 's' + Math.floor(ms / 1000) : 'm' + Math.floor(ms / 60_000));
const quietStep = (ms) => (ms < 60_000 ? 'q' + Math.floor(ms / 30_000) : 'Q' + Math.floor(ms / 60_000));

/**
 * 꼬리표(라벨 옆 작은 글자): ['실행 3:42', '조용함 2분' | '정체 4분', '출력 버퍼링?'] · 끝나면 ['rc 1'].
 * opts.proc = 분리 프로세스라 정체·rc 꼬리표를 따로 단다 → 여기서는 경과·조용함·버퍼링만.
 */
export function runTags(n, nowMs, { proc = false } = {}) {
  const s = runState(n, nowMs);
  if (!s) return [];
  if (s.ended) return !proc && s.rc != null ? [tr('cards.job.rc', { n: s.rc })] : [];
  const out = [tr('cards.run.elapsed', { t: runClock(s.elapsedMs) })];
  if (s.stale) { if (!proc) out.push(tr('cards.job.stale', { t: minText(s.quietMs) })); }
  else if (s.quiet) out.push(tr('cards.run.quiet', { t: minText(s.quietMs) }));
  if (s.buffered) out.push(tr('cards.run.buffered'));
  return out;
}
/** 버퍼링 추정 이유(meta.run.bufferWhy) → 툴팁·인스펙터 글 열쇠. 모르는 값·없음 = python(예전 서버) */
export const bufferWhyOf = (r) => (r && (r.bufferWhy === 'pipe' || r.bufferWhy === 'devnull') ? r.bufferWhy : 'python');
export const bufferTip = (why) => tr(why === 'pipe' ? 'cards.run.bufferedTipPipe' : why === 'devnull' ? 'cards.run.bufferedTipDevnull' : 'cards.run.bufferedTip');
/** 꼬리표 툴팁(버퍼링 추정 → 이유별: python -u 권고 · 마지막 파이프 · 출력 버림), 없으면 ''. n = 그 노드(없으면 python 권고) */
export function runTagTip(tag, n = null) {
  return tag === tr('cards.run.buffered') ? bufferTip(bufferWhyOf(runOf(n))) : '';
}

/**
 * 라벨 다시 그리기 열쇠: 꼬리표 글자·모습이 바뀔 때만 달라진다(10분 미만 초마다, 그 위 분마다, 조용함은 30초·분 칸).
 * meta.run 이 없으면 ''.
 */
export function runLabelKey(n, nowMs) {
  const s = runState(n, nowMs);
  if (!s) return '';
  if (s.ended) return `E${s.rc}`;
  return `${elapsedStep(s.elapsedMs)}|${s.stale ? 'S' + quietStep(s.quietMs) : s.quiet ? quietStep(s.quietMs) : '-'}|${s.buffered ? 1 : 0}`;
}

/**
 * 자동 카메라 가산점: 실행 중(정체 아님)이면 경과 CAM_STEP_MS 마다 +1, 상한 CAM_MAX. 정체·끝남·없음 0.
 * (열린 도구 ×2 만으로는 짧은 도구를 자주 쓰는 노드에 늘 밀리던 장시간 실행을 비추게)
 */
export function runCamBonus(n, nowMs) {
  const s = runState(n, nowMs);
  if (!s || s.ended || s.stale) return 0;
  return Math.min(RUNW.CAM_MAX, Math.floor(s.elapsedMs / RUNW.CAM_STEP_MS));
}

/**
 * 셸 패널 머리줄 경과: 열린 셸 패널의 시작 시각(전경 meta.run.since, 없으면 도구 시작 ts) → { text:'3:42', long, key }
 * long = 장시간 실행(≥ LONG_MS) — 패널 진행 링·느린 맥동. key 가 바뀔 때만 글 칸을 다시 그린다.
 */
export function runHead(sinceMs, nowMs) {
  if (!Number.isFinite(sinceMs) || !Number.isFinite(nowMs)) return null;
  const ms = Math.max(0, nowMs - sinceMs);
  return { text: runClock(ms), long: ms >= RUNW.LONG_MS, ms, key: elapsedStep(ms) };
}
/** 진행 링 채움(0..1): 10분 미만은 이번 1분 안의 진행(초마다 한 칸), 그 위는 가득(정적) */
export const runRing = (ms) => (ms < RUNW.SEC_MS ? (Math.floor(ms / 1000) % 60) / 60 : 1);

/**
 * 인스펙터 줄: [{key, label, value, title}] — 실행 경과 · 마지막 출력 · 버퍼링 추정 · 정체 · rc. meta.run 이 없으면 null.
 */
export function runCardModel(n, nowMs) {
  const s = runState(n, nowMs);
  if (!s) return null;
  const rows = [];
  rows.push({ key: 'elapsed', label: tr(s.ended ? 'cards.run.r.took' : 'cards.run.r.elapsed'), value: runClock(s.elapsedMs) + (s.tool ? ` · ${s.tool}` : ''), title: s.since ? new Date(s.since).toISOString() : '' });
  rows.push({ key: 'lastOut', label: tr('cards.run.r.lastOut'),
    value: s.lastOut != null ? tr('cards.run.ago', { t: minText(Math.max(0, nowMs - s.lastOut)) }) : tr('cards.run.noOut'),
    title: s.lastOut != null ? new Date(s.lastOut).toISOString() : '' });
  if (s.buffered && !s.ended) rows.push({ key: 'buffered', label: tr('cards.run.r.buffered'), value: bufferTip(s.bufferWhy), title: '' });
  if (s.stale) rows.push({ key: 'stale', label: tr('cards.run.r.stale'), value: tr('cards.run.staleV', { t: minText(s.quietMs), lim: minText(s.staleAfter) }), title: '' });
  if (s.ended && s.rc != null) rows.push({ key: 'rc', label: tr('cards.job.r.rc'), value: String(s.rc), title: '' });
  return { kind: s.kind, ended: s.ended, stale: s.stale, quiet: s.quiet, rows };
}
