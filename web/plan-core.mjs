// 계획 보드 — 순수 규칙(three·DOM 없음, 시험·세 표현 공용).
// 서버가 소유 노드 meta.plans 로 낸 계획 = [{id, src, title, doc?, at, by, cy?, n, items:[{k, t, s, at, by?, cy?, hold?}]}].
// 메인 옆 보드: 세션 메인으로 모으기·줄 창·배치·카메라 맞춤 점, 변경 연출 큐·팝업 모델·⚙ 저장 규칙.

import { t } from './i18n.mjs'; // 다국어

/** 키 → 지금 언어 라벨(읽을 때마다 t) */
const tLabels = (pre, keys) => Object.freeze(Object.defineProperties({}, Object.fromEntries(keys.map((k) => [k, { enumerable: true, get: () => t(pre + k) }]))));

export const PLAN_UI = {
  MAX_BOARDS: 4,      // 화면에 동시에 띄우는 보드 수(메인마다 한 장 — 전체 보기에서 섬 여럿)
  MAX_CELLS: 24,      // 회차 연결 대상 항목 상한
  HOLO_K: 2,          // 보드 = 일반 홀로그램 모니터 크기의 이 배
  BOARD_MIN: 210,     // 보드 폭 하한(px, 제목·진행률·지금 줄이 읽히는 폭)
  BOARD_MAX: 360,     // 보드 폭 상한
  GAP: 16,            // 메인 원과 보드 사이(px)
  HOT_MS: 6000,       // 바뀐 뒤 이만큼 밝게
  FX_MS: 1600,        // 항목 변경 연출 길이
  DEL_MS: 1100,       // 지운 항목 잔상
  LINK_CYCLES: 3,     // 회차 ↔ 항목 연결선: 최근 회차 수
  // 자리 안정: 고른 자리는 '확실히 나빠진 상태'가 WAIT_MS 이어지고 마지막 이동 뒤 MIN_MS 가 지나야 옮김
  HOLD_RATIO: 1.6,    // 지금 자리 비용 > 최선 × 이 배 + HOLD_AREA 면 '확실히 나쁨'
  HOLD_AREA: 2500,    // (px² — 이름표 하나 반쯤 덮는 정도는 참음)
  HOLD_TAU_MS: 3000,  // 후보 비용 평균 시간(걸어 다니는 캐릭터 이름표·잠깐 뜨는 말풍선을 거름)
  HOLD_WAIT_MS: 1500,
  HOLD_MIN_MS: 4000,
  ANCHOR_MS: 2000,    // 앵커(회차·러너·메인) 바꿀 후보가 이만큼 이어져야 바꿈(지금 앵커가 안 보이면 바로)
  DEADBAND: 12,       // 같은 후보 안에서 목표 자리(앵커 기준) 변화가 이 px 미만이면 그대로
  SIZE_STEP: 8,       // 보드 폭이 이 px 넘게 바뀔 때만 다시 그림(확대·축소 중 매 프레임 다시 짓지 않게)
};

export const PLAN_SRC_LABEL = tLabels('boards.plan.src.', ['todo', 'tasks', 'exitplan', 'file', 'phases', 'workflow']);
export const PLAN_SRC_GLYPH = { todo: '☑', tasks: '☷', exitplan: '✎', file: '☐', phases: '▤', workflow: '⧉' };
export const PLAN_ST_LABEL = tLabels('boards.plan.stl.', ['pending', 'in_progress', 'done']);
export const PLAN_ST_MARK = { pending: '○', in_progress: '◐', done: '✓' };
/** 보드 줄 기호: 완료 ✓ · 진행 ▶ · 대기 ○ · 외부 대기(보류) ⏸ */
export const PLAN_ST_GLYPH = { done: '✓', in_progress: '▶', pending: '○', hold: '⏸' };

/** ⚙ 저장 열쇠 · 첫 값(URL ?plans=1|0 이 이번 접속에서 우선, 기본 끔) */
export const PLAN_STORE_KEY = 'ccviz.plans';
export function planInitial(urlVal, stored) {
  if (urlVal === '1' || urlVal === '0') return urlVal === '1';
  return stored === '1';
}

export function plansOf(node) {
  const p = node && node.meta && node.meta.plans;
  return Array.isArray(p) ? p.filter((x) => x && Array.isArray(x.items) && x.items.length) : [];
}

/** 진행 {done, prog, pend, total, frac, cur(지금 항목 index: 진행 중 첫째, 없으면 대기 첫째, 없으면 -1)} */
export function planProgress(plan) {
  const it = (plan && plan.items) || [];
  let done = 0, prog = 0, pend = 0, cur = -1, firstPend = -1;
  it.forEach((x, i) => {
    if (x.s === 'done') done++;
    else if (x.s === 'in_progress') { prog++; if (cur < 0) cur = i; }
    else { pend++; if (firstPend < 0 && !x.hold) firstPend = i; }
  });
  if (cur < 0) cur = firstPend;
  const total = it.length;
  return { done, prog, pend, total, frac: total ? (done + prog * 0.5) / total : 0, cur };
}

/**
 * 이전·다음 meta.plans → 변경 [{pid, k, kind:'add'|'del'|'state', from?, to?, t?}]. 계획이 새로 생기면 그 항목 모두 add,
 * 없어지면 모두 del. 글만 바뀐 것은 변경 아님(연출 없음).
 */
export function diffPlans(prev, next) {
  const out = [];
  const P = new Map((Array.isArray(prev) ? prev : []).map((p) => [p.id, p]));
  const N = new Map((Array.isArray(next) ? next : []).map((p) => [p.id, p]));
  for (const [id, np] of N) {
    const op = P.get(id);
    const om = new Map(((op && op.items) || []).map((x) => [x.k, x]));
    for (const it of np.items || []) {
      const o = om.get(it.k);
      if (!o) out.push({ pid: id, k: it.k, kind: 'add', to: it.s });
      else if (o.s !== it.s) out.push({ pid: id, k: it.k, kind: 'state', from: o.s, to: it.s });
      om.delete(it.k);
    }
    for (const o of om.values()) out.push({ pid: id, k: o.k, kind: 'del', from: o.s, t: o.t });
  }
  for (const [id, op] of P) if (!N.has(id)) for (const o of op.items || []) out.push({ pid: id, k: o.k, kind: 'del', from: o.s, t: o.t });
  return out;
}

/**
 * 변경 연출 큐: note(nodeId, changes, nowMs) → 칸마다 {kind, t0}. 지운 항목은 잔상 목록(del)으로 DEL_MS 동안.
 * 보드마다 마지막 변경 시각(hot) — 바뀐 보드는 HOT_MS 동안 밝게.
 */
export class PlanFx {
  constructor() { this.cells = new Map(); this.dels = new Map(); this.hot = new Map(); }
  note(nodeId, changes, now) {
    if (!changes || !changes.length) return;
    this.hot.set(nodeId, now);
    for (const c of changes) {
      const key = `${nodeId}|${c.pid}|${c.k}`;
      if (c.kind === 'del') {
        const L = this.dels.get(`${nodeId}|${c.pid}`) || [];
        L.push({ k: c.k, s: c.from, t: c.t || '', t0: now });
        if (L.length > 6) L.splice(0, L.length - 6);
        this.dels.set(`${nodeId}|${c.pid}`, L);
        this.cells.delete(key);
      } else {
        const kind = c.kind === 'add' ? 'add' : c.to === 'done' ? 'done' : c.to === 'in_progress' ? 'start' : 'back';
        this.cells.set(key, { kind, t0: now });
      }
    }
  }
  /** 칸 연출(없거나 끝났으면 null) */
  cell(nodeId, pid, k, now) {
    const key = `${nodeId}|${pid}|${k}`;
    const f = this.cells.get(key);
    if (!f) return null;
    if (now - f.t0 > PLAN_UI.FX_MS) { this.cells.delete(key); return null; }
    return f;
  }
  delsOf(nodeId, pid, now) {
    const key = `${nodeId}|${pid}`;
    const L = this.dels.get(key);
    if (!L) return [];
    const live = L.filter((d) => now - d.t0 <= PLAN_UI.DEL_MS);
    if (live.length) this.dels.set(key, live); else this.dels.delete(key);
    return live;
  }
  isHot(nodeId, now) { const t = this.hot.get(nodeId); return t != null && now - t < PLAN_UI.HOT_MS; }
  busy(now) {
    for (const f of this.cells.values()) if (now - f.t0 <= PLAN_UI.FX_MS) return true;
    for (const L of this.dels.values()) if (L.some((d) => now - d.t0 <= PLAN_UI.DEL_MS)) return true;
    return false;
  }
  clear() { this.cells.clear(); this.dels.clear(); this.hot.clear(); }
}

/**
 * 보드 주인 = 그 세션 메인. 노드 → 부모 사슬을 올라 메인(kind 'main')을 찾고, 부모 없는 꼭대기(nohup 기동기 등)면
 * sessionId·rootSessionId 가 같은 메인, 그래도 없고 메인이 하나뿐이면 그 메인. 못 찾으면 null.
 */
export function mainOf(id, nodes, mains = null) {
  let n = nodes.get(id), top = n;
  for (let i = 0; n && i < 64; i++) {
    if (n.kind === 'main') return n.id;
    top = n;
    n = n.parentId ? nodes.get(n.parentId) : null;
  }
  if (!top) return null;
  const ms = mains || [...nodes.values()].filter((x) => x.kind === 'main');
  const sid = top.rootSessionId || top.sessionId;
  if (sid) { const m = ms.find((x) => x.sessionId === sid || x.rootSessionId === sid || x.id === 's:' + sid); if (m) return m.id; }
  return ms.length === 1 ? ms[0].id : null;
}

/**
 * 메인마다 모은 계획: Map(mainId → [{owner, plan, runner}]) — 순서 = 진행 중 항목이 있는 계획 > 최근 갱신(at) > 주인 id.
 * isRunner(node) = 러너·기동기 판단(회차 번호를 칸에 붙임).
 */
export function gatherPlans(nodes, { isRunner = (n) => !!(n && n.meta && (n.meta.runner || n.meta.launcher)) } = {}) {
  const mains = [...nodes.values()].filter((x) => x.kind === 'main');
  const out = new Map();
  for (const n of nodes.values()) {
    const pl = plansOf(n);
    if (!pl.length) continue;
    const m = mainOf(n.id, nodes, mains);
    if (!m) continue;
    const L = out.get(m) || [];
    for (const plan of pl) L.push({ owner: n.id, plan, runner: isRunner(n) || plan.src === 'phases' });
    out.set(m, L);
  }
  // 순서: 지금 도는 회차가 붙든 러너 계획(4) + 진행 중 항목 있음(2) + 메인 자신·러너 계획(1) > 최근 갱신 > 주인 id
  const liveCycle = (e) => { if (!e.runner || !e.plan.by) return false; const c = nodes.get(cycleNodeOf(e.plan.by, nodes)); return !!(c && c.status === 'active'); };
  const rank = (e, m) => (liveCycle(e) ? 4 : 0) + (e.plan.items.some((x) => x.s === 'in_progress') ? 2 : 0) + (e.owner === m || e.runner ? 1 : 0);
  for (const [m, L] of out) L.sort((a, b) => rank(b, m) - rank(a, m) || (b.plan.at || 0) - (a.plan.at || 0) || (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0));
  return out;
}

/**
 * 보드 크기(px) = 그 표현의 일반 홀로그램 모니터(세계 높이 1.25 + 0.3·노드 반지름, 폭 = 높이 × 1.5)의 약 2배.
 * anchorR = 메인 화면 원 반지름(px, anchorOf = 세계 반지름 × 1.3 × 축척), worldR = 메인 세계 반지름.
 * 폭은 읽히는 하한·상한 안, 글자 배율 k(폭 280px = 1).
 */
export function boardSize(anchorR, worldR, vw = 1e4) {
  const wr = Math.max(0.1, worldR || 1);
  const scale = (anchorR || 0) / (1.3 * wr);           // px / 세계 단위
  const holoH = (1.25 + 0.3 * wr) * scale;               // 일반 홀로그램 모니터 높이(px)
  const w = Math.round(Math.min(vw - 32, Math.max(PLAN_UI.BOARD_MIN, Math.min(PLAN_UI.BOARD_MAX, holoH * 1.5 * PLAN_UI.HOLO_K))));
  return { w, k: Math.max(0.9, Math.min(1.2, w / 280)), holoH };
}

/**
 * 메인 옆 보드(작은 판) 모델: 가장 앞 계획 하나(gatherPlans 순서) — 제목·주인·완료/전체·막대·항목 칸 띠(≤MAX_CELLS)·지금 줄(진행 중 ≤2,
 * 없으면 보류 아닌 대기 첫째, 다 끝나면 '모두 완료')·외부 대기 수·다른 계획 수. 칸은 회차 선 끝.
 * opts = {nowMs, fx(PlanFx), labelOf(id), mainId}
 */
export function boardCard(entries, { nowMs = 0, fx = null, labelOf = null, mainId = '' } = {}) {
  if (!entries || !entries.length) return null;
  const e = entries[0], p = e.plan, pr = planProgress(p);
  const cells = p.items.slice(0, PLAN_UI.MAX_CELLS).map((it, i) => {
    const f = fx ? fx.cell(e.owner, p.id, it.k, nowMs) : null;
    const st = it.s === 'pending' && it.hold ? 'hold' : it.s;
    return { k: it.k, s: it.s, st, cur: i === pr.cur, cy: e.runner && it.cy != null && it.s !== 'pending' ? it.cy : null, fx: f ? f.kind : null, t: it.t || t('boards.plan.item', { n: i + 1 }) };
  });
  const lines = [];
  p.items.forEach((it, i) => { if (it.s === 'in_progress' && lines.length < 2) lines.push({ i, st: 'in_progress', mark: PLAN_ST_GLYPH.in_progress, t: it.t || t('boards.plan.item', { n: i + 1 }), cy: e.runner && it.cy != null ? it.cy : null }); });
  if (!lines.length && pr.cur >= 0) { const it = p.items[pr.cur]; lines.push({ i: pr.cur, st: 'pending', mark: PLAN_ST_GLYPH.pending, t: it.t || t('boards.plan.item', { n: pr.cur + 1 }), next: true }); }
  const ownerLabel = e.owner === mainId ? t('boards.plan.main') : (labelOf ? labelOf(e.owner) : '') || e.owner;
  return {
    pid: p.id, owner: e.owner, ownerLabel, src: p.src, srcLabel: PLAN_SRC_LABEL[p.src] || '', glyph: PLAN_SRC_GLYPH[p.src] || '☐', title: p.title || PLAN_SRC_LABEL[p.src] || t('boards.plan.plan'),
    done: pr.done, prog: pr.prog, total: pr.total, count: `${pr.done}/${pr.total}`, frac: pr.frac,
    fracDone: pr.total ? pr.done / pr.total : 0, fracProg: pr.total ? pr.prog / pr.total : 0, allDone: pr.total > 0 && pr.done === pr.total,
    cells, extra: Math.max(0, p.items.length - PLAN_UI.MAX_CELLS), lines, hold: p.items.filter((x) => x.s === 'pending' && x.hold).length,
    more: entries.length - 1, runner: e.runner, hot: fx ? entries.some((x) => fx.isHot(x.owner, nowMs)) : false,
    dels: fx ? fx.delsOf(e.owner, p.id, nowMs) : [],
  };
}

/**
 * 크게 보기(팝업 체계, 보드 전용 넓은 카드) 모델: 그 메인에 모인 계획 전부 — 계획마다 제목·출처·주인·완료/전체·막대·항목 전체(상태 기호·
 * 회차 번호·처리한 노드·얼마 전).
 */
export function sheetInspectModel(entries, { nowMs = Date.now(), labelOf = null, mainId = '' } = {}) {
  return (entries || []).map((e) => {
    const [m] = planInspectModel({ meta: { plans: [e.plan] } }, { nowMs, labelOf });
    const pr = planProgress(e.plan);
    return {
      ...m, owner: e.owner, ownerLabel: e.owner === mainId ? t('boards.plan.main') : (labelOf ? labelOf(e.owner) : '') || e.owner, runner: e.runner,
      done: pr.done, prog: pr.prog, total: pr.total, fracDone: pr.total ? pr.done / pr.total : 0, fracProg: pr.total ? pr.prog / pr.total : 0,
      hold: e.plan.items.filter((x) => x.s === 'pending' && x.hold).length,
      items: m.items.map((it) => ({ ...it, st: it.s === 'pending' && it.hold ? 'hold' : it.s, glyph: PLAN_ST_GLYPH[it.s === 'pending' && it.hold ? 'hold' : it.s] || '○' })),
    };
  });
}

/**
 * 메인 옆 보드 자리(px). anchor = 메인 화면 원 {x,y,r}, size = {w,h}, bounds = 무대, avoid = [{x,y,w,h,k(무게)}].
 * 후보: 오른쪽(가운데·위 맞춤·아래 맞춤) → 왼쪽(같은 셋) → 아래 → 위. 무대 안으로 밀어 넣은 뒤 겹친 넓이 × 무게가 가장 작은 자리,
 * core(메인 원 + 메인 이름표 상자, 없으면 원)는 덮지 않음(무게 1000). prevSide 와 같은 쪽이면 비용을 조금 깎아 쉽게 뒤집히지 않게. 결정적.
 * 반환 {x, y, w, h, side: 1(오른쪽)|-1(왼쪽)|0(아래·위), cost}
 */
export function placeSheet(anchor, size, bounds, { avoid = [], gap = PLAN_UI.GAP, prevSide = null, core = null } = {}) {
  const { x, y } = anchor, r = Math.max(6, anchor.r || 0), { w, h } = size;
  // core = 덮으면 안 되는 메인 상자(원 + 메인 이름표). 후보는 그 상자 바깥 변에 붙인다
  const C = core || { x: x - r, y: y - r, w: 2 * r, h: 2 * r };
  const L = C.x, R = C.x + C.w, T = C.y, B = C.y + C.h;
  const cands = [
    [R + gap, y - h / 2, 1], [R + gap, T, 1], [R + gap, B - h, 1],
    [L - gap - w, y - h / 2, -1], [L - gap - w, T, -1], [L - gap - w, B - h, -1],
    [x - w / 2, B + gap, 0], [x - w / 2, T - gap - h, 0],
  ];
  const ov = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  let best = null;
  const all = [];
  cands.forEach(([bx, by, side], i) => {
    const b = { x: Math.round(Math.max(bounds.left + 4, Math.min(bounds.right - 4 - w, bx))), y: Math.round(Math.max(bounds.top + 4, Math.min(bounds.bottom - 4 - h, by))), w, h };
    const cov = ov(b, C);
    let cost = cov * 1000 + i * 0.5 + (side === 0 ? w * 4 : 0); // 옆(좌우)을 먼저, 아래·위는 옆이 막혔을 때
    for (const q of avoid) cost += ov(b, q) * (q.k ?? 1);
    if (prevSide != null && side === prevSide) cost *= 0.8;
    all.push({ x: b.x, y: b.y, side, cost, i, cov });
    if (!best || cost < best.cost - 1e-6) best = { ...b, side, cost, i, cov };
  });
  best.all = all;
  return best;
}

/**
 * 보드 자리 붙들기: placeSheet 는 매 프레임 기억 없이 최선 후보를 고르므로, 걸어 다니는 캐릭터 이름표·잠깐 뜨는 말풍선·
 * 카메라 이동 중 250ms 묵은 장애물 상자만으로도 좌우를 오갔다(라이브 복셀 3D·2D 5초마다 300px 왕복, Planet 3D 카메라 이동 중 400px).
 * 고른 후보(index)를 기억하고, 후보 비용의 지수 평균(HOLD_TAU_MS)으로 그 자리가 '확실히 나빠진 상태'(평균 > 최선 평균 × HOLD_RATIO + HOLD_AREA)가 HOLD_WAIT_MS 이어지고
 * 마지막 이동 뒤 HOLD_MIN_MS 가 지났을 때만 옮긴다. 같은 후보 안의 작은 변화(이름표 폭 등)는 DEADBAND 로 무시.
 * 반환 = 그릴 후보 {x, y, side, i}(앵커 기준 상대 자리 rel 은 부르는 쪽이 계산).
 */
export class BoardHold {
  constructor() { this.i = null; this.at = -1e9; this.bad = null; this.ema = null; this.t = 0; }
  reset() { this.i = null; this.bad = null; this.ema = null; }
  pick(p, now) {
    const all = p.all || [p];
    // 후보마다 비용의 지수 평균(HOLD_TAU_MS) — 잠깐 지나가는 이름표·말풍선은 평균에 조금만 남고, 계속 있는 장애물만 쌓인다
    if (!this.ema || this.ema.length !== all.length) { this.ema = all.map((c) => c.cost); this.t = now; }
    else { const k = 1 - Math.exp(-Math.max(0, now - this.t) / PLAN_UI.HOLD_TAU_MS); this.t = now; all.forEach((c, i) => { this.ema[i] += (c.cost - this.ema[i]) * k; }); }
    const cur = this.i != null ? all[this.i] : null;
    if (!cur) { this.i = p.i ?? 0; this.at = now; this.bad = null; return all[this.i]; }
    let bi = 0; for (let i = 1; i < all.length; i++) if (this.ema[i] < this.ema[bi] - 1e-6) bi = i;
    const urgent = cur.cov > 400 && !(all[p.i ?? 0].cov > 400); // 지금 자리가 앵커(원·이름표)를 덮게 됐으면(화면 가장자리 밀어 넣기 등) 바로
    if (urgent) { this.i = p.i; this.at = now; this.bad = null; return all[this.i]; }
    if (bi === this.i || !(this.ema[this.i] > this.ema[bi] * PLAN_UI.HOLD_RATIO + PLAN_UI.HOLD_AREA)) { this.bad = null; return cur; }
    if (this.bad == null) this.bad = now;
    if (now - this.bad < PLAN_UI.HOLD_WAIT_MS || now - this.at < PLAN_UI.HOLD_MIN_MS) return cur;
    this.i = bi; this.at = now; this.bad = null;
    return all[bi];
  }
}

/**
 * 앵커 붙들기: 원하는 앵커(boardAnchor)가 지금과 다르면 ANCHOR_MS 동안 이어질 때만 바꾼다. 지금 앵커가 더는 쓸 수 없으면(ok=false) 바로.
 * st = {id, cand, since} (부르는 쪽 보관). 반환 = 쓸 앵커 id.
 */
export function holdAnchor(st, want, now, ok = () => true) {
  if (!st.id || !ok(st.id)) { st.id = want; st.cand = null; return want; }
  if (want === st.id) { st.cand = null; return st.id; }
  if (st.cand !== want) { st.cand = want; st.since = now; }
  if (now - st.since >= PLAN_UI.ANCHOR_MS) { st.id = want; st.cand = null; }
  return st.id;
}

/**
 * 앵커 상자(core)의 이름표 부분 — 앵커 바로 위·아래에 걸친 이름표 중 **앵커 자기 것 하나**(가로 중심이 가장 가까운 것)만,
 * 앵커 중심 기준 상대 상자로. 예전에는 걸친 이름표를 모두 합쳐 지나가는 다른 노드 이름표가 core 를 부풀려 보드가 옆으로 튀었다.
 */
export function anchorLabelRel(a, boxes) {
  let best = null, bd = Infinity;
  for (const q of boxes) {
    if (!(q.x < a.x + 8 && q.x + q.w > a.x - 8 && q.y < a.y + a.r + 40 && q.y + q.h > a.y - a.r - 40)) continue;
    const d = Math.abs(q.x + q.w / 2 - a.x) + 0.5 * Math.max(0, Math.abs(q.y + q.h / 2 - a.y) - a.r);
    if (d < bd) { bd = d; best = q; }
  }
  return best ? { x: best.x - a.x, y: best.y - a.y, w: best.w, h: best.h } : null;
}

/**
 * 자동 카메라가 메인을 잡을 때 보드도 담도록: 보드를 세운 노드(앵커, — 메인 또는 회차·러너) → 쪽(1·-1·0). 카메라(3D·2D)가 planFitPts(id, target, r, right, pts) 로
 * 그 메인 맞춤 점 옆에 보드 자리 점을 더한다(right = 화면 오른쪽 세계 단위 벡터, 2D 는 +x).
 */
export const PLAN_CAM = { boards: new Map() };
export function planFitPts(id, target, r, right, pts) {
  const side = PLAN_CAM.boards.get(id);
  if (side == null || !target) return pts;
  const rr = Math.max(0.1, r || 1);
  const dx = right ? right.x : 1, dz = right ? right.z || 0 : 0;
  // 보드 ≈ 홀로그램 모니터의 2배(세계 높이 2·(1.25 + 0.3r), 폭 1.5배): 중심이 메인 원 바깥 + 반폭만큼 옆, 반지름 = 반대각
  const hh = PLAN_UI.HOLO_K * (1.25 + 0.3 * rr) / 2, hw = hh * 1.5;
  const off = rr * 1.3 + 0.6 + hw, R = Math.hypot(hw, hh * 1.3);
  pts.push(side === 0
    ? { p: { x: target.x, y: target.y || 0, z: target.z + rr * 1.3 + 0.6 + hh * 1.3 }, r: R, must: true }
    : { p: { x: target.x + dx * side * off, y: target.y || 0, z: target.z + dz * side * off }, r: R, must: true });
  return pts;
}

/**
 * 앵커 이름표 상자 갱신: 커지면 바로(덮지 않게), 줄면 HOLD_WAIT_MS × 2 이어진 뒤에 — 작업 줄 글이 바뀔 때마다 이름표 폭이
 * 늘었다 줄었다 해 보드가 옆으로 60px 씩 오가던 것(라이브 Planet 2D). prev = {rel, small, at}. 반환 = 새 상태.
 */
export function nextLabelRel(prev, rel, now) {
  if (!prev || !prev.rel || !rel) return { rel, small: null };
  const o = prev.rel, inside = rel.x >= o.x - 4 && rel.y >= o.y - 4 && rel.x + rel.w <= o.x + o.w + 4 && rel.y + rel.h <= o.y + o.h + 4;
  if (!inside) return { rel, small: null };
  const small = prev.small == null ? now : prev.small;
  if (now - small >= PLAN_UI.HOLD_WAIT_MS * 2) return { rel, small: null };
  return { rel: o, small };
}

/** 회차 노드 찾기: 그 노드가 회차(claude-p · meta.cycle)면 그대로, 회차의 하위면 그 회차, 아니면 null */
export function cycleNodeOf(id, nodes) {
  let n = nodes.get(id);
  for (let i = 0; n && i < 32; i++) {
    if (n.kind === 'claude-p' || (n.meta && n.meta.cycle != null)) return n.id;
    n = n.parentId ? nodes.get(n.parentId) : null;
  }
  return null;
}

/**
 * 보드를 세울 노드(앵커): 러너 계획이면 회차 쪽에 붙여 회차 선을 짧게 — 지금 계획을 붙든 진행 중 회차(화면에 그려진 것) >
 * 계획 주인(러너·기동기, 회차들의 부모라 바로 곁) > 세션 메인. 러너 계획이 아니면 늘 메인. shown(id) = 화면에 그려진 노드인가.
 */
export function boardAnchor(entry, mainId, nodes, shown = () => true) {
  if (!entry || !entry.runner) return mainId;
  const p = entry.plan;
  const cid = p && p.by ? cycleNodeOf(p.by, nodes) : null;
  const cn = cid && nodes.get(cid);
  if (cn && cn.status === 'active' && shown(cid)) return cid;
  if (entry.owner && entry.owner !== mainId && shown(entry.owner)) return entry.owner;
  return mainId;
}

/** 회차 ↔ 항목 연결: 칸 index 마다 처리 회차 노드 id — 최근 LINK_CYCLES 회차만 [{by, cy, idx:[…]}] */
export function cycleLinks(plan) {
  if (!plan) return [];
  const m = new Map();
  plan.items.slice(0, PLAN_UI.MAX_CELLS).forEach((it, i) => {
    if (it.cy == null || !it.by || it.s === 'pending') return;
    const e = m.get(it.by) || { by: it.by, cy: it.cy, idx: [] };
    e.idx.push(i); m.set(it.by, e);
  });
  return [...m.values()].sort((a, b) => b.cy - a.cy).slice(0, PLAN_UI.LINK_CYCLES);
}

const fmtAgo = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); if (s < 60) return t('boards.ago.s', { n: s }); const m = Math.round(s / 60); if (m < 60) return t('boards.ago.m', { n: m }); const h = Math.round(m / 60); if (h < 48) return t('boards.ago.h', { n: h }); return t('boards.ago.d', { n: Math.round(h / 24) }); };

/** 상세 팝업 노드 절 모델: 계획마다 {title, src, count, frac, items:[{mark, s, t, cy, by, hold, ago}]} */
export function planInspectModel(node, { nowMs = Date.now(), labelOf = null } = {}) {
  return plansOf(node).map((p) => {
    const pr = planProgress(p);
    return {
      id: p.id, title: p.title || PLAN_SRC_LABEL[p.src] || t('boards.plan.plan'), doc: p.doc || '', src: PLAN_SRC_LABEL[p.src] || p.src, glyph: PLAN_SRC_GLYPH[p.src] || '☐',
      count: `${pr.done}/${pr.total}`, frac: pr.frac, more: Math.max(0, (p.n || p.items.length) - p.items.length),
      updated: p.at ? fmtAgo(nowMs - p.at) : '',
      items: p.items.map((it, i) => ({
        mark: PLAN_ST_MARK[it.s] || '○', s: it.s, t: it.t || t('boards.plan.item', { n: i + 1 }), hold: !!it.hold, cur: i === pr.cur,
        cy: it.cy ?? null, by: it.by || null, byLabel: it.by && labelOf ? labelOf(it.by) : '', ago: it.at && it.s !== 'pending' ? fmtAgo(nowMs - it.at) : '',
      })),
    };
  });
}
