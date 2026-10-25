// 매크로 타임라인의 순수 부분 — DOM 없이 node --test 로 시험한다(web/test/macro.test.mjs).
// 세션 목록(/sessions) → 시간순 막대 · 겹치지 않는 줄 배치 · claude -p 자식 붙이기 · 시간↔화면 변환 · 눈금 · 클릭 의도.

import { t as tr, locale } from '../i18n.mjs';

export const MT = {
  MIN_PX_PER_MS: 1 / 3_600_000 * 2,     // 가장 멀리: 1시간 = 2px(약 4주가 1300px)
  MIN_PX_PER_MS_ARCHIVE: 1 / 3_600_000 * 0.2, // 보관함: 1시간 = 0.2px(약 6개월이 860px) — 4주 넘는 보관함도 '맞춤'이 전체를 담게
  MAX_PX_PER_MS: 1 / 60_000 * 40,       // 가장 가까이: 1분 = 40px
  MAX_INNER_PX: 400_000,                // 안쪽 폭 상한(브라우저 한도 훨씬 아래)
  MIN_BAR_PX: 4,                        // 아주 짧은 세션도 눌리게
  GAP_PX: 6,                            // 같은 줄 막대 사이 최소 간격(화면 기준)
  EDGE_PX: 12,                          // 막대 앞 끝 이만큼 = '처음부터', 실행 중 막대 뒤 끝 = '실시간으로'
  PAD_RATIO: 0.03,
  PRESETS: [
    { key: '1d', label: tr('app.macro.preset.1d'), ms: 86_400_000 },
    { key: '3d', label: tr('app.macro.preset.3d'), ms: 3 * 86_400_000 },
    { key: '1w', label: tr('app.macro.preset.1w'), ms: 7 * 86_400_000 },
    { key: '4w', label: tr('app.macro.preset.4w'), ms: 28 * 86_400_000 },
  ],
};

const H = 3_600_000, D = 86_400_000;
// 요일 약칭은 Intl(지금 언어): ko '수' · en 'Wed'
let wdFmt = null, wdLoc = '';
const weekday = (d) => { const L = locale(); if (!wdFmt || wdLoc !== L) { wdFmt = new Intl.DateTimeFormat(L, { weekday: 'short' }); wdLoc = L; } return wdFmt.format(d); };
const dayLabel = (d) => `${d.getMonth() + 1}/${d.getDate()} (${weekday(d)})`;
const pad2 = (n) => String(n).padStart(2, '0');
const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : NaN; };

/**
 * /sessions 항목 → 막대 항목. 시작 = startedAt(없으면 끝), 끝 = endedAt(첫·마지막 기록), 실행 중(running)이면 끝 = 지금.
 * 시작 오름차순(같으면 id)으로 정렬해 돌려준다. 시각을 못 읽는 항목은 뺀다.
 */
export function normalizeSessions(list, nowMs = Date.now()) {
  const out = [];
  for (const s of list || []) {
    if (!s || !s.sessionId) continue;
    let end = ms(s.endedAt); if (!Number.isFinite(end)) end = ms(s.mtime);
    let start = ms(s.startedAt); if (!Number.isFinite(start)) start = end;
    if (!Number.isFinite(start)) continue;
    const running = !!(s.running ?? false);
    if (running) end = Math.max(end || start, nowMs);
    if (!Number.isFinite(end) || end < start) end = start;
    out.push({
      id: s.sessionId, title: s.title || null, projectId: s.projectDir || null,
      start, end, running, busy: running && s.liveStatus === 'busy',
      child: !!(s.isChild || s.entrypoint === 'sdk-cli'), parent: s.parentSessionId || null,
      events: s.eventCount != null ? s.eventCount : (s.eventCountEst ?? null), exact: s.eventCount != null,
      approx: !!s.endApprox, cached: !!s.replayCached, children: [], lane: 0,
    });
  }
  out.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * claude -p 자식을 부모 막대에 붙인다: parentSessionId 가 목록에 있으면 그 부모, 아니면 자식 시작 시각을 품은 메인 중
 * 가장 늦게 시작한 것. 둘 다 없으면 orphans(따로 줄을 줄 수 있음).
 */
export function attachChildren(items) {
  const mains = items.filter((x) => !x.child);
  const byId = new Map(mains.map((m) => [m.id, m]));
  for (const m of mains) m.children = [];
  const orphans = [];
  for (const c of items) {
    if (!c.child) continue;
    let p = c.parent ? byId.get(c.parent) : null;
    if (!p) {
      for (const m of mains) { if (m.start <= c.start && c.start <= m.end && (!p || m.start > p.start)) p = m; }
    }
    if (p) { p.children.push(c); c.attachedTo = p.id; } else { c.attachedTo = null; orphans.push(c); }
  }
  return { mains, orphans };
}

/**
 * 겹치지 않는 줄 배치(그리디): 시작 순으로, 앞 막대 끝 + gapMs 이후에 시작하는 가장 위 줄. 막대의 화면 최소 폭(minMs)도 끝으로 본다.
 * item.lane 을 채우고 줄 수를 돌려준다. 결과: 같은 줄의 막대는 시간상 겹치지 않는다.
 */
export function packLanes(items, { gapMs = 0, minMs = 0 } = {}) {
  const ends = [];
  const sorted = [...items].sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  for (const it of sorted) {
    const visEnd = Math.max(it.end, it.start + minMs);
    let lane = ends.findIndex((e) => e + gapMs <= it.start);
    if (lane < 0) { lane = ends.length; ends.push(visEnd); } else ends[lane] = visEnd;
    it.lane = lane;
  }
  return ends.length;
}

/** 시간축: 안쪽 원점 d0(ms)·축척 px/ms → x(t)·t(x) */
export function makeScale(d0, pxPerMs) {
  return { d0, pxPerMs, x: (t) => (t - d0) * pxPerMs, t: (x) => d0 + x / pxPerMs };
}

/** 축척 한도. min = 가장 먼 축척(보관함은 MT.MIN_PX_PER_MS_ARCHIVE) */
export function clampPx(pxPerMs, min = MT.MIN_PX_PER_MS) { return Math.max(min, Math.min(MT.MAX_PX_PER_MS, pxPerMs)); }
/** 맥락별 가장 먼 축척: 보관함은 더 멀리(긴 보관함도 한 화면에) */
export const minPxFor = (mode) => (mode === 'archive' ? MT.MIN_PX_PER_MS_ARCHIVE : MT.MIN_PX_PER_MS);

/**
 * 안쪽 범위 [d0, d1]: 가장 이른 시작 ~ 지금(오른쪽 여백). 축척으로 폭이 상한을 넘으면 오래된 쪽을 자른다.
 * viewSpan 은 화면 폭만큼의 시간 — 막대가 적어도 화면 한 폭은 채워 스크롤 위치가 안정되게.
 */
export function domainOf(items, nowMs, pxPerMs, viewSpanMs) {
  const span = Math.max(viewSpanMs || 0, H);
  let lo = nowMs - span;
  for (const it of items) if (it.start < lo) lo = it.start;
  const hi = nowMs + Math.max(span * MT.PAD_RATIO, 10 * 60_000);
  lo -= Math.max((hi - lo) * 0.01, 10 * 60_000);
  const maxSpan = MT.MAX_INNER_PX / pxPerMs;
  if (hi - lo > maxSpan) lo = hi - maxSpan;
  return { d0: lo, d1: hi };
}

/** 커서 기준 확대: 커서 아래 시각이 같은 화면 자리에 남도록 새 축척·스크롤 */
export function zoomAround({ pxPerMs, scrollLeft, d0 }, factor, cursorX, newD0 = d0, minPx = MT.MIN_PX_PER_MS) {
  const anchorT = d0 + (scrollLeft + cursorX) / pxPerMs;
  const np = clampPx(pxPerMs * factor, minPx);
  return { pxPerMs: np, scrollLeft: Math.max(0, (anchorT - newD0) * np - cursorX), anchorT };
}

/**
 * 처음 보일 구간: 최근 7일 안에 끝난 세션이 있으면 그 가장 이른 시작 ~ 지금(1일～3일로 자름), 없으면 마지막 세션 10개를 맞춤.
 * 돌려주는 값: {t0, t1}
 */
export function defaultWindow(items, nowMs) {
  const mains = items.filter((x) => !x.child);
  const recent = mains.filter((x) => x.end >= nowMs - 7 * D);
  let t0;
  if (recent.length) t0 = Math.min(...recent.map((x) => x.start));
  else if (mains.length) { const last = [...mains].sort((a, b) => b.end - a.end).slice(0, 10); t0 = Math.min(...last.map((x) => x.start)); }
  else t0 = nowMs - D;
  let span = Math.min(3 * D, Math.max(D, nowMs - t0)); // 처음엔 최근 1～3일(막대에 제목이 들어갈 만큼), 더 보려면 1주·4주·맞춤
  if (!recent.length && mains.length) {
    // 오래된 세션만 있으면 그 구간을 맞춘다(지금까지 늘리지 않음)
    const last = [...mains].sort((a, b) => b.end - a.end).slice(0, 10);
    const a = Math.min(...last.map((x) => x.start)), b = Math.max(...last.map((x) => x.end));
    const p = Math.max((b - a) * 0.06, 30 * 60_000);
    return { t0: a - p, t1: b + p };
  }
  const p = span * MT.PAD_RATIO;
  return { t0: nowMs - span - p, t1: nowMs + p };
}

/**
 * 시간축 오른쪽 끝 기준 시각: 보관함(archive)은 '지금'이 아니라 보관 세션의 마지막 끝 시각(지난 기록이라 지금까지 늘리지 않음),
 * 그 밖은 지금. 보관 세션이 없으면 지금.
 */
export function refEnd(items, mode, nowMs) {
  if (mode !== 'archive' || !items || !items.length) return nowMs;
  let e = -Infinity;
  for (const it of items) if (Number.isFinite(it.end)) e = Math.max(e, it.end);
  return Number.isFinite(e) ? e : nowMs;
}

/** 모든 메인 막대가 보이는 구간(맞춤): {t0, t1} — 양끝 2% 여백(최소 10분) */
export function fitWindow(items, nowMs) {
  const all = items.filter((x) => !x.child);
  if (!all.length) return { t0: nowMs - D, t1: nowMs };
  const a = Math.min(...all.map((x) => x.start)), b = Math.max(...all.map((x) => x.end));
  const p = Math.max((b - a) * 0.02, 10 * 60_000);
  return { t0: a - p, t1: b + p };
}

/** 로컬 자정 */
export function localMidnight(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

const STEPS = [H, 2 * H, 3 * H, 6 * H, 12 * H, D, 2 * D, 7 * D, 14 * D, 28 * D];
/**
 * 눈금: 화면 간격 minPx 이상이 되는 가장 작은 단계. 시간 단계는 로컬 자정 기준 정렬(0·3·6…시), 날 단계는 자정, 주 단계는 월요일.
 * [{t, day(자정이면 true), label}] — 자정은 '10/21 (화)', 그 밖은 '14시'.
 */
export function ticks(t0, t1, pxPerMs, minPx = 64) {
  let step = STEPS[STEPS.length - 1];
  for (const s of STEPS) { if (s * pxPerMs >= minPx) { step = s; break; } }
  const out = [];
  let t;
  if (step < D) {
    const m = localMidnight(t0);
    t = m + Math.ceil((t0 - m) / step) * step;
  } else {
    t = localMidnight(t0);
    if (step % (7 * D) === 0) { const wd = (new Date(t).getDay() + 6) % 7; t -= wd * D; }
    while (t < t0) t = nextDay(t, step / D);
  }
  for (let guard = 0; t <= t1 && guard < 2000; guard++) {
    const d = new Date(t);
    const day = d.getHours() === 0 && d.getMinutes() === 0;
    out.push({ t, day, label: day ? dayLabel(d) : tr('app.macro.tickHour', { h: d.getHours() }) });
    if (step < D) {
      t += step;
      // 서머타임이 있는 지역에서도 자정 정렬이 밀리지 않게 자정을 넘으면 다시 맞춘다
      const md = localMidnight(t);
      if (md > out[out.length - 1].t && t - md < step && t !== md && (t - md) % step !== 0) t = md;
    } else t = nextDay(t, step / D);
  }
  return { step, ticks: out };
}
function nextDay(t, n) { const d = new Date(t); d.setDate(d.getDate() + n); d.setHours(0, 0, 0, 0); return d.getTime(); }

/**
 * 막대 클릭 의도: 앞 끝 영역 안 → 'start'(처음부터), 실행 중 막대의 뒤 끝 영역 안 → 'live'(실시간으로 그 세션), 그 밖 → 'at'(그 시각부터).
 * 끝 영역 = edgeFor(막대 폭): 넓은 막대는 EDGE_PX, 좁은 막대는 폭의 18%(최소 2px).
 */
export function clickIntent(item, xInBar, barWidth, edge = MT.EDGE_PX) {
  const e = edgeFor(barWidth, edge);
  if (item.running && barWidth - xInBar <= e) return 'live';
  if (xInBar <= e) return 'start';
  return 'at';
}
/** 끝 영역 폭: 막대 폭에 비례해 줄인다(폭의 18%, 2px～edge) — 짧은 막대도 대부분은 '그 시각부터' */
export function edgeFor(barWidth, edge = MT.EDGE_PX) { return Math.min(edge, Math.max(2, barWidth * 0.18)); }

/** 막대 안 x → 시각(막대 범위로 자름) */
export function timeInBar(item, xInBar, barWidth) {
  if (barWidth <= 0) return item.start;
  const f = Math.max(0, Math.min(1, xInBar / barWidth));
  return item.start + f * (item.end - item.start);
}

/**
 * 전체 보기 요약: 프로젝트별 한 줄(메인만). names: Map(projectId → 이름). 최근 끝난 순, 최대 max 줄.
 * [{projectId, name, items, lastEnd, running}]
 */
export function summarizeProjects(items, names = new Map(), max = 8) {
  const by = new Map();
  for (const it of items) {
    if (it.child) continue;
    const k = it.projectId || '?';
    if (!by.has(k)) by.set(k, { projectId: k, name: names.get(k) || shortProject(k), items: [], lastEnd: 0, running: false });
    const g = by.get(k);
    g.items.push(it);
    g.lastEnd = Math.max(g.lastEnd, it.end);
    if (it.running) g.running = true;
  }
  return [...by.values()].sort((a, b) => (b.running - a.running) || (b.lastEnd - a.lastEnd)).slice(0, max);
}
/** 'D--work-Projects-2026' → 'Projects-2026' 정도(이름을 모를 때만) */
export function shortProject(id) {
  const parts = String(id || '').split('-').filter(Boolean);
  return parts.slice(-2).join('-') || String(id || '');
}

/** 툴팁 시각 구간: '10/21 (화) 14:03 – 16:20' (날이 바뀌면 끝에도 날짜) */
export function fmtRange(a, b) {
  const da = new Date(a), db = new Date(b);
  const day = dayLabel;
  const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const same = localMidnight(a) === localMidnight(b);
  return `${day(da)} ${hm(da)} – ${same ? '' : day(db) + ' '}${hm(db)}`;
}
export function fmtHM(t) { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
