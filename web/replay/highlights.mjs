// 재생 하이라이트(볼거리 시점) 계산 — 순수 함수, DOM·node 내장 없음.
// 서버(server/replay.mjs timelineOf)와 웹(engine.mjs computeTimeline, mock·demo 재생)이 같은 함수를 쓴다.
//   computeHighlights(events) → [{ t, t1, kind:'fanout'|'bg'|'error', n, label }]  (t 오름차순, 최대 HL.MAX 개)
// events: 정렬된 재생 이벤트(t = epoch ms 또는 ts).

import { t } from '../i18n.mjs';

export const HL = {
  FANOUT_GAP: 60_000, FANOUT_MIN: 3,   // 서브에이전트(워크플로 에이전트 포함) 생성이 60초 간격 안에 3개 이상 이어지면
  BG_GAP: 120_000, BG_MIN: 3,          // 백그라운드 작업(bash-bg·monitor) 생성이 2분 간격 안에 3개 이상
  ERR_GAP: 60_000, ERR_MIN: 3,         // 도구 오류가 60초 간격 안에 3건 이상(노드 오류는 1건이어도)
  MAX_SPAN: 15 * 60_000,               // 한 묶음은 최대 15분(긴 대량 분기는 여러 표시로 나뉨)
  MAX: 40,                             // 표시 상한(넘으면 n 큰 것부터 남김)
};

const FANOUT_KINDS = new Set(['subagent', 'workflow-agent']);
const BG_KINDS = new Set(['bash-bg', 'monitor']);
const tOf = (e) => (typeof e.t === 'number' ? e.t : Date.parse(e.ts));

/** 시각 목록(오름차순)을 간격 gap·최대 폭 maxSpan 으로 묶는다 → [{t, t1, n, w}] (w = 가중치 합) */
export function clusterTimes(items, gap, maxSpan = HL.MAX_SPAN) {
  const out = [];
  let cur = null;
  for (const it of items) {
    const t = it.t, w = it.w ?? 1;
    if (cur && t - cur.t1 <= gap && t - cur.t <= maxSpan) { cur.t1 = t; cur.n++; cur.w += w; if (it.strong) cur.strong = true; continue; }
    cur = { t, t1: t, n: 1, w, strong: !!it.strong };
    out.push(cur);
  }
  return out;
}

/** 볼거리 라벨(지금 언어, 사전 replay.hl.*). 서버가 보낸 label 은 서버 언어(기본 한국어)라 화면은 kind·n 으로 다시 만든다 */
export function highlightLabel(h) {
  if (!h) return '';
  return h.kind === 'fanout' || h.kind === 'bg' || h.kind === 'error' ? t(`replay.hl.${h.kind}`, { n: h.n }) : String(h.label || '');
}

export function computeHighlights(events, opt = {}) {
  const o = { ...HL, ...opt };
  const fan = [], bg = [], err = [];
  for (const e of events || []) {
    if (!e || !e.type) continue;
    const t = tOf(e);
    if (!Number.isFinite(t)) continue;
    if (e.type === 'node-add' && e.node) {
      if (FANOUT_KINDS.has(e.node.kind)) fan.push({ t });
      else if (BG_KINDS.has(e.node.kind)) bg.push({ t });
    } else if ((e.type === 'tool-end' || e.type === 'result') && e.ok === false) err.push({ t });
    else if (e.type === 'node-update' && e.patch && e.patch.status === 'error') err.push({ t, strong: true });
  }
  const out = [];
  for (const c of clusterTimes(fan, o.FANOUT_GAP, o.MAX_SPAN)) if (c.n >= o.FANOUT_MIN) out.push({ t: c.t, t1: c.t1, kind: 'fanout', n: c.n });
  for (const c of clusterTimes(bg, o.BG_GAP, o.MAX_SPAN)) if (c.n >= o.BG_MIN) out.push({ t: c.t, t1: c.t1, kind: 'bg', n: c.n });
  for (const c of clusterTimes(err, o.ERR_GAP, o.MAX_SPAN)) if (c.n >= o.ERR_MIN || c.strong) out.push({ t: c.t, t1: c.t1, kind: 'error', n: c.n });
  let list = out;
  if (list.length > o.MAX) {
    // 많으면 종류마다 큰 것부터 고르게(한 종류가 다 차지하지 않게): 종류별 순위 → 순위 순으로 MAX 개
    const rank = new Map();
    for (const k of ['fanout', 'bg', 'error']) list.filter((h) => h.kind === k).sort((a, b) => b.n - a.n || a.t - b.t).forEach((h, i) => rank.set(h, i));
    list = [...list].sort((a, b) => rank.get(a) - rank.get(b) || b.n - a.n || a.t - b.t).slice(0, o.MAX);
  }
  list.sort((a, b) => a.t - b.t || (a.kind < b.kind ? -1 : 1));
  return list.map((h) => ({ ...h, label: highlightLabel(h) }));
}

/** 재생 막대 x 좌표 근처(±px)의 하이라이트(가장 가까운 것) — 클릭·툴팁용 */
export function highlightNear(list, x, xOf, px = 7) {
  let best = null, bd = Infinity;
  for (const h of list || []) {
    const d = Math.abs(xOf(h.t) - x);
    if (d <= px && d < bd) { best = h; bd = d; }
  }
  return best;
}

/** 하이라이트로 이동할 시각: 묶음 시작 조금 앞(볼거리 직전부터 보이게) */
export const HL_LEAD_MS = 3000;
export function seekTargetOf(h, startT = -Infinity) { return Math.max(startT, h.t - HL_LEAD_MS); }
