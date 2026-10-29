// 계획 보드 — 순수 규칙(three·DOM 없음, 시험·세 표현 공용).
// 서버가 소유 노드 meta.plans 로 낸 계획 = [{id, src, title, doc?, at, by, cy?, n, items:[{k, t, s, at, by?, cy?, hold?}]}].
// 보드: 세션 메인으로 모으기·보드 모델, 앵커 단일화(러너 > 메인)·월드 고정 자리·라벨 장애물, 변경 연출 큐·팝업 모델·⚙ 저장 규칙.

import { t } from './i18n.mjs'; // 다국어

/** 키 → 지금 언어 라벨(읽을 때마다 t) */
const tLabels = (pre, keys) => Object.freeze(Object.defineProperties({}, Object.fromEntries(keys.map((k) => [k, { enumerable: true, get: () => t(pre + k) }]))));

export const PLAN_UI = {
  MAX_BOARDS: 4,      // 화면에 동시에 띄우는 보드 수(메인마다 한 장 — 전체 보기에서 섬 여럿)
  MAX_CELLS: 24,      // 보드 칸 띠 항목 상한
  NEXT_N: 2,          // 판에 보이는 다음 단계 수(지금 단계 뒤)
  BASE_PX: 180,       // 보드 DOM 기준 폭(px) — 화면 크기는 월드 크기 × 원근 배율로 scale(글자도 함께)
  HOLO_H_K: 1.5,      // 보드 높이 = 그 표현 일반 홀로그램 모니터 높이 × 이 배(폭은 모니터와 같음)
  SIZE_K: 2,          // 보드 크기 배수(박사님 "Plan board size -> 2x") — 월드 폭·높이에 곱함 → 화면 배율이 함께 2배라 글자·막대·칸·여백 모두 2배. 앵커 오프셋·모니터 기준(holo·BOOST)은 그대로
  VX_MON_H: 1.0,      // 복셀 모니터(voxel/office-core MON.H·ASP — 시험이 같은지 확인)
  VX_MON_ASP: 1.62,
  BOOST: { flow: [30, 10], voxel: [64, 1.9] }, // 활동 노드 모니터와 같은 최소 크기 키움 [모니터 최소 높이 px, 배율 상한] (holo-core HOLO.MIN_PX_ACTIVE·BOOST_MAX, office-core MON.MIN_PX·BOOST)
  GAP_W: 0.8,         // 앵커 원 바깥 ~ 보드 왼쪽 변(월드 단위, 원 반지름 × 1.3 바깥에서)
  DROP_K: 0.5,        // 보드 아래 변 = 앵커 중심보다 반지름 × 이만큼 아래(3D 는 y, 2D 는 화면 아래 = +z)
  HIDE_PX: 14,        // 화면 폭이 이보다 작으면 숨김(아주 먼 전체 보기 — 홀로그램 LOD 와 같은 뜻)
  LOD_PX: 96,         // 화면 폭이 이보다 작으면 간략(출처 글리프·완료/전체·막대·칸만)
  S_MAX: 8,           // 원근 배율 상한(아주 가까울 때 — 자리는 그대로, 크기만). 크기 2배에 맞춰 4 → 8
  HOT_MS: 6000,       // 바뀐 뒤 이만큼 밝게
  FX_MS: 1600,        // 항목 변경 연출 길이
  DEL_MS: 1100,       // 지운 항목 잔상
  OCC_MARGIN: 0.6,    // v0.4.1 3D 앞뒤: 중심이 보드보다 이만큼(월드) 넘게 카메라에 가까운 노드만 보드를 가린다(나란히 선 이웃은 가리지 않음)
  OCC_MAX: 24,        // 보드 한 장에 뚫는 가림 구멍 상한
};

/**
 * v0.4.1 3D 앞뒤 관계: 보드(DOM 덧층)보다 카메라에 가까운 노드가 그 판을 가리는 자리.
 * box = 보드 화면 상자 {x,y,w,h}(뷰포트 px), s = 판 배율, occ = [{x,y,r(화면 px), d(카메라 거리 — 앞면)}], depth = 보드 카메라 거리.
 * 반환 = 판 안 좌표(배율 전 px)의 원 [{x,y,r}] — 가까운 것부터, OCC_MAX 개까지
 */
export function boardHoles(box, s, occ, depth, { margin = PLAN_UI.OCC_MARGIN, max = PLAN_UI.OCC_MAX } = {}) {
  if (!box || !(s > 0) || !Array.isArray(occ)) return [];
  const hit = [];
  for (const o of occ) {
    if (!o || !(o.r > 0) || !(o.d < depth - margin)) continue;
    if (o.x + o.r <= box.x || o.x - o.r >= box.x + box.w || o.y + o.r <= box.y || o.y - o.r >= box.y + box.h) continue;
    hit.push(o);
  }
  hit.sort((a, b) => a.d - b.d);
  return hit.slice(0, max).map((o) => ({ x: (o.x - box.x) / s, y: (o.y - box.y) / s, r: o.r / s }));
}
/** 구멍들을 뺀 마스크(CSS mask-image, 원마다 한 겹 · intersect — 겹친 구멍도 그대로 구멍). 구멍 없으면 '' */
export function holesMask(holes) {
  if (!holes || !holes.length) return '';
  const n = (v) => String(Math.round(v * 10) / 10);
  return holes.map((h) => `radial-gradient(circle ${n(h.r)}px at ${n(h.x)}px ${n(h.y)}px, transparent ${n(Math.max(0, h.r - 1.5))}px, #000 ${n(h.r)}px)`).join(', ');
}

export const PLAN_SRC_LABEL = tLabels('boards.plan.src.', ['phases', 'axes']); // 자율 루프 판: 러너 단계 설계서 · 축 큐
export const PLAN_SRC_GLYPH = { phases: '▤', axes: '⇶' };
export const PLAN_ST_LABEL = tLabels('boards.plan.stl.', ['pending', 'in_progress', 'done']);
export const PLAN_ST_MARK = { pending: '○', in_progress: '◐', done: '✓' };
/** 보드 줄 기호: 완료 ✓ · 진행 ▶ · 대기 ○ · 외부 대기(보류) ⏸ */
export const PLAN_ST_GLYPH = { done: '✓', in_progress: '▶', pending: '○', hold: '⏸' };

/** ⚙ 저장 열쇠 · 첫 값(URL ?plans=1|0 이 이번 접속에서 우선, 기본 끔) */
export const PLAN_STORE_KEY = 'ccviz.loopboard'; // 새 열쇠(옛 일반 계획판 ccviz.plans 값은 무시)
export function planInitial(urlVal, stored) {
  if (urlVal === '1' || urlVal === '0') return urlVal === '1';
  return stored !== '0'; // 기본 켬
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
export function mainOf(id, nodes, mains = null, depth = 0) {
  if (depth > 4) return null;
  let n = nodes.get(id), top = n;
  for (let i = 0; n && i < 64; i++) {
    if (n.kind === 'main') return n.id;
    top = n;
    n = n.parentId ? nodes.get(n.parentId) : null;
  }
  if (!top) return null;
  // 부모 없는 기동기는 띄운 노드(spawnedBy — /clear 승계면 서버가 새 메인으로 바꿔 보냄)를 따라간다. 예전엔 rootSessionId(옛 recent 메인)로
  // 묶여 보드 크게 보기가 숨은 옛 메인을 대상으로 열렸다가 곧바로 닫혔다(상세가 안 나옴)
  const sp = top.meta && top.meta.spawnedBy;
  if (sp && sp !== top.id && nodes.has(sp)) { const m = mainOf(sp, nodes, mains, (depth || 0) + 1); if (m) return m; }
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
 * 보드 월드 크기·자리(앵커 기준 고정 오프셋, 월드 단위). 크기 = 그 앵커의 **일반 홀로그램 모니터 기준**: 폭은 모니터와 같고
 * 높이는 모니터 높이 × HOLO_H_K(1.5). 모니터 = 흐름·Planet 높이 1.25 + 0.3·r · 폭 × 1.5, 복셀(MON) 높이 1.0 · 폭 × 1.62.
 * holo = 표현이 따로 낸 모니터 크기 {w, h}(view.holoSize — 있으면 그것이 우선). 자리 = 앵커 오른쪽(x 월드) — 왼쪽 변이 앵커 원(반지름 × 1.3)
 * 바깥 GAP_W, 아래 변이 중심보다 r × DROP_K 아래. 카메라·화면과 무관(되먹임 없음).
 * 반환 {w, h, aspect(h/w), holo:{w, h}, off(앵커 중심 → 왼쪽 변 x), drop(앵커 중심 → 아래 변, 아래로)}
 */
export function holoMonitor(worldR, mode = 'flow') {
  const r = Math.max(0.1, worldR || 1);
  if (mode === 'voxel') return { w: PLAN_UI.VX_MON_H * PLAN_UI.VX_MON_ASP, h: PLAN_UI.VX_MON_H };
  const h = 1.25 + 0.3 * r;
  return { w: h * 1.5, h };
}
export function boardWorld(worldR, mode = 'flow', holo = null) {
  const r = Math.max(0.1, worldR || 1);
  const m = holo && holo.w > 0 && holo.h > 0 ? holo : holoMonitor(r, mode);
  const w = m.w * PLAN_UI.SIZE_K, h = m.h * PLAN_UI.HOLO_H_K * PLAN_UI.SIZE_K; // 크기 2배(비율은 그대로)
  return { w, h, aspect: h / w, holo: { w: m.w, h: m.h }, boost: PLAN_UI.BOOST[mode === 'voxel' ? 'voxel' : 'flow'], off: r * 1.3 + PLAN_UI.GAP_W, drop: r * PLAN_UI.DROP_K };
}

/**
 * 화면 그리기 값: 보드 왼쪽 아래 모서리의 화면 투영 p {x, y}·월드 1 단위의 화면 px(ppw) → 원근 배율 s(= 월드 폭 × ppw / BASE_PX),
 * 활동 모니터와 같은 최소 크기 키움(BOOST), 숨김(카메라 뒤·HIDE_PX 미만·판 전체가 화면 밖), 간략(lod: LOD_PX 미만). **화면 안으로 끌어오지 않는다**(가장자리 밀어 넣기 없음).
 */
export function boardScreen(p, ppw, wb, vw, vh) {
  if (!p || p.behind || !(ppw > 0)) return { hidden: true };
  let s0 = (wb.w * ppw) / PLAN_UI.BASE_PX;
  // 활동 노드 모니터처럼 멀리서도 모니터 높이가 최소 px 는 되게 키움(배율 상한까지) — 같은 거리의 모니터와 같은 크기 규칙
  const hp = wb.holo.h * ppw, bo = wb.boost;
  if (bo && hp > 0 && hp < bo[0]) s0 *= Math.min(bo[1], bo[0] / hp);
  if (s0 * PLAN_UI.BASE_PX < PLAN_UI.HIDE_PX) return { hidden: true, s: s0 };
  const s = Math.min(PLAN_UI.S_MAX, s0);
  const w = PLAN_UI.BASE_PX * s, h = w * wb.aspect;
  const box = { x: p.x, y: p.y - h, w, h };
  const off = box.x > vw || box.y > vh || box.x + w < 0 || box.y + h < 0;
  return { hidden: off, s, box, lod: w < PLAN_UI.LOD_PX };
}

/**
 * 메인 옆 보드(작은 판) 모델: 가장 앞 계획 하나(gatherPlans 순서) — 제목·주인·완료/전체·막대·항목 칸 띠(≤MAX_CELLS)·지금 줄(진행 중 ≤2,
 * 없으면 보류 아닌 대기 첫째, 다 끝나면 '모두 완료')·외부 대기 수·다른 계획 수. 칸은 회차 선 끝.
 * opts = {nowMs, fx(PlanFx), labelOf(id), mainId, liveCy(진행 중 회차 번호 — 지금 칸 강조·'회차 N 진행 중' 표시, 선 대신)}
 */
export function boardCard(entries, { nowMs = 0, fx = null, labelOf = null, mainId = '', liveCy = null } = {}) {
  if (!entries || !entries.length) return null;
  const e = entries[0], p = e.plan, pr = planProgress(p);
  // 항목이 칸 상한보다 많으면 지금 항목 둘레 창(앞서 끝난 것은 '+n' 으로) — 156축 큐도 지금 축 근처가 보이게
  const N = p.items.length, M = PLAN_UI.MAX_CELLS;
  const c0 = N > M && pr.cur >= 0 ? Math.max(0, Math.min(N - M, pr.cur - (M - 1 - PLAN_UI.NEXT_N))) : 0;
  const cells = p.items.slice(c0, c0 + M).map((it, j) => {
    const i = c0 + j;
    const f = fx ? fx.cell(e.owner, p.id, it.k, nowMs) : null;
    const st = it.st === 'skipped' ? 'skipped' : it.s === 'pending' && it.hold ? 'hold' : it.s;
    return { k: it.k, s: it.s, st, cur: i === pr.cur, live: liveCy != null && i === pr.cur, cy: e.runner && it.cy != null && it.s !== 'pending' ? it.cy : null, fx: f ? f.kind : null, t: it.t || t('boards.plan.item', { n: i + 1 }) };
  });
  // 판에는 지금 단계 하나(진행 중 첫째, 없으면 보류 아닌 다음 대기) + 그 뒤 대기 단계 NEXT_N 개만 — 나머지는 크게 보기
  const lines = [];
  if (pr.cur >= 0) {
    const it = p.items[pr.cur], prog = it.s === 'in_progress';
    const sp = it.steps && it.steps.total > 0 ? { done: it.steps.done, total: it.steps.total, cur: it.steps.cur || '' } : null; // 지금 항목의 단계 진행
    lines.push({ i: pr.cur, st: prog ? 'in_progress' : 'pending', mark: prog ? PLAN_ST_GLYPH.in_progress : PLAN_ST_GLYPH.pending, t: it.t || t('boards.plan.item', { n: pr.cur + 1 }), cy: prog && e.runner && it.cy != null ? it.cy : null, next: !prog, ...(sp ? { steps: sp } : {}), ...(it.note ? { note: it.note } : {}) });
    for (let i = pr.cur + 1; i < p.items.length && lines.length < 1 + PLAN_UI.NEXT_N; i++) {
      const x = p.items[i];
      if (x.s === 'done') continue;
      const st = x.s === 'pending' && x.hold ? 'hold' : x.s;
      lines.push({ i, st, mark: PLAN_ST_GLYPH[st] || PLAN_ST_GLYPH.pending, t: x.t || t('boards.plan.item', { n: i + 1 }), up: true, ...(x.note ? { note: x.note } : {}) });
    }
  }
  const ownerLabel = e.owner === mainId ? t('boards.plan.main') : (labelOf ? labelOf(e.owner) : '') || e.owner;
  return {
    pid: p.id, owner: e.owner, ownerLabel, src: p.src, srcLabel: PLAN_SRC_LABEL[p.src] || '', glyph: PLAN_SRC_GLYPH[p.src] || '☐', title: p.title || PLAN_SRC_LABEL[p.src] || t('boards.plan.plan'),
    done: pr.done, prog: pr.prog, total: pr.total, count: `${pr.done}/${pr.total}`, frac: pr.frac,
    fracDone: pr.total ? pr.done / pr.total : 0, fracProg: pr.total ? pr.prog / pr.total : 0, allDone: pr.total > 0 && pr.done === pr.total,
    cells, extra: Math.max(0, N - c0 - M), before: c0, lines, hold: p.items.filter((x) => x.s === 'pending' && x.hold).length,
    more: entries.length - 1, runner: e.runner, liveCy: e.runner ? liveCy : null, hot: fx ? entries.some((x) => fx.isHot(x.owner, nowMs)) : false,
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
      items: m.items.map((it) => { const st = it.v2 === 'skipped' ? 'skipped' : it.s === 'pending' && it.hold ? 'hold' : it.s; return { ...it, st, glyph: st === 'skipped' ? '⤼' : PLAN_ST_GLYPH[st] || '○' }; }),
    };
  });
}

/**
 * 라벨이 피할 보드 화면 상자(지금 표현 캔버스 좌표 [x0, y0, x1, y1]) — 보드는 고정 장애물, 라벨이 비킨다.
 * plan-ui 가 매 프레임 채우고 세 표현의 라벨 배치(scene·flat-view·voxel bubbles)가 장애물 사각형에 더한다. 자동 카메라는 보드를 모른다.
 */
export const PLAN_CAM = { rects: [] };
export function planLabelRects(rects) { for (const r of PLAN_CAM.rects) rects.push(r); return rects; }

/** 회차 노드 찾기: 그 노드가 회차(claude-p · meta.cycle)면 그대로, 회차의 하위면 그 회차, 아니면 null */
export function cycleNodeOf(id, nodes) {
  let n = nodes.get(id);
  for (let i = 0; n && i < 32; i++) {
    if (n.kind === 'claude-p' || (n.meta && n.meta.cycle != null)) return n.id;
    n = n.parentId ? nodes.get(n.parentId) : null;
  }
  return null;
}

const TERMINAL = new Set(['done', 'error', 'stopped', 'gone']);
export const isRunnerNode = (n) => !!(n && n.meta && (n.meta.runner || n.meta.launcher));

/**
 * 보드 앵커 단일화: 그 메인에 러너 계획(주인 = 러너·기동기 노드)이 있으면 **그 러너**, 없으면 **메인**. 회차·화면 상태로 바꾸지 않는다.
 * 러너 노드가 기록에 아예 없거나, 끝났고(done·error·stopped) 화면에서도 사라졌으면(shown false) 러너 없음 → 메인(한 번뿐인 전환).
 * 러너가 여럿이면 끝나지 않은 것 > 최근 갱신. 반환 {id, entries(고른 러너 계획을 맨 앞으로)}.
 */
export function boardAnchor(entries, mainId, nodes, shown = () => true) {
  // 자율 루프 판 자리 = **재기동기**(기동기 노드 — 축 큐를 고르는 주체). 축 큐 계획의 주인이 곧 재기동기, 러너 단계 계획이면 그 러너의 기동기 조상.
  // 재기동기가 숨김·접힘·퇴장이면 판도 함께(앵커가 안 보이면 plan-ui 가 판을 숨김 — 다른 노드로 옮기지 않음). /clear 승계면 이어받은 기동기 하나.
  // 맨 앞 계획 = 축 큐 > 끝나지 않은 러너의 단계 계획 > 그 밖 최근. 재기동기를 못 찾으면 메인(예비)
  const L0 = entries || [];
  const isAxes = (e) => !!(e && e.plan && e.plan.src === 'axes');
  const L = [...L0.filter(isAxes), ...L0.filter((e) => !isAxes(e))];
  const nx = L.filter(isAxes).length;
  const lead = L.findIndex((e, i) => i >= nx && e && e.runner && e.owner && isRunnerNode(nodes.get(e.owner)) && !TERMINAL.has(nodes.get(e.owner).status));
  const ord = lead > nx ? [...L.slice(0, nx), L[lead], ...L.slice(nx).filter((e) => e !== L[lead])] : L;
  const launcherOf = (id) => { let n = nodes.get(id); for (let i = 0; n && i < 32; i++) { if (n.meta && n.meta.launcher) return n.id; n = n.parentId ? nodes.get(n.parentId) : null; } return null; };
  let anchor = null;
  for (const e of ord) { if (e && e.owner) { anchor = launcherOf(e.owner); if (anchor) break; } }
  return { id: anchor || mainId, entries: ord };
}

/** 지금 계획을 붙든 진행 중 회차 번호(보드 안 표시용, 없으면 null) — 선은 긋지 않는다 */
export function liveCycleOf(plan, nodes) {
  const cid = plan && plan.by ? cycleNodeOf(plan.by, nodes) : null;
  const cn = cid && nodes.get(cid);
  if (!cn || cn.status !== 'active') return null;
  return cn.meta && cn.meta.cycle != null ? cn.meta.cycle : (plan.cy ?? '');
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
        mark: PLAN_ST_MARK[it.s] || '○', s: it.s, t: it.t || t('boards.plan.item', { n: i + 1 }), hold: !!it.hold, cur: i === pr.cur, v2: it.st || null,
        doc: it.doc || '', note: it.note || '', group: it.group || '', meta: Array.isArray(it.meta) ? it.meta : [], emph: !!it.emph, steps: it.steps && it.steps.total > 0 ? it.steps : null,
        cy: it.cy ?? null, by: it.by || null, byLabel: it.by && labelOf ? labelOf(it.by) : '', ago: it.at && it.s !== 'pending' ? fmtAgo(nowMs - it.at) : '',
      })),
    };
  });
}

/**
 * 흐름·Planet 3D 계획 보드의 깊이: 판 DOM 은 캔버스 **아래**(z -1)에 두고, WebGL 장면에 판 자리 사각형(구멍 사각형)을 월드 깊이로 그려
 * 그 자리 캔버스 픽셀을 투명하게 뚫는다 — 판보다 가까운 노드·흐름선·패널은 깊이 시험으로 구멍을 덮고(판을 가림), 판 뒤의 것은 구멍에 지워진다.
 * 재질 약속(시험 대상): 깊이 시험·쓰기 켬, 불투명 단계 맨 끝(불투명 물체 다음·투명 물체 앞 — 뒤의 불투명 물체를 지움), 안개 없음,
 * 섞기 = dst × (1 − src.a)(색·알파 모두, src.a = 판 불투명도 — 프로젝트 페이드 중엔 판과 장면이 그 비율로 섞임). 둥근 모서리는 셰이더가 버림.
 */
// 불투명 단계(transparent:false)의 맨 끝(renderOrder 큼 — 모든 불투명 물체 다음, 모든 투명 물체 앞): 깊이 시험이 있으니 '늘 위'가 아니다.
//   투명 단계에 두면 물체 자리(원점) 기준 정렬이라 가까운 투명 물체(깊이 안 씀)가 먼저 그려진 뒤 구멍이 그 위를 지울 수 있었다
export const PLAN_PUNCH = { depthTest: true, depthWrite: true, transparent: false, fog: false, renderOrder: 1e6, MAX: 8 };
/**
 * 구멍 사각형 자리(순수): 판 가운데 월드 점의 시야 깊이 zv(카메라 앞 +), 판 화면 상자 box{x,y,w,h}(페이지 px), 캔버스 rect{left,top,width,height},
 * 세로 시야각 fov(도) → 시야 공간 가운데 {x, y, z(= −zv)}·월드 크기 {w, h}. 카메라 뒤·너무 가까우면 null.
 */
export function punchQuad(zv, box, rect, fov, near = 0.1) {
  if (!(zv > near) || !box || !(box.w > 0) || !(box.h > 0) || !rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  const th = Math.tan(((fov || 50) * Math.PI) / 360), aspect = rect.width / rect.height;
  const cx = box.x + box.w / 2 - rect.left, cy = box.y + box.h / 2 - rect.top;
  const nx = (cx / rect.width) * 2 - 1, ny = 1 - (cy / rect.height) * 2;
  const wpp = (2 * zv * th) / rect.height; // 그 깊이의 화면 1px = 월드 길이
  return { x: nx * zv * th * aspect, y: ny * zv * th, z: -zv, w: box.w * wpp, h: box.h * wpp, wpp };
}

/**
 * 판 평면 네 모서리(순수): 판 기준 월드 점의 시야 깊이 zv, 판 화면 상자 box(페이지 px), 캔버스 rect, 세로 시야각 fov, 바깥 여백 pad(px — 그림자 판)
 * → 시야 공간 네 점 [왼위, 오위, 오아래, 왼아래] {x, y, z}. 판은 그 깊이에서 카메라와 나란한 평면이라 GPU 가 픽셀마다 이 평면 깊이로 가린다.
 */
export function punchCorners(zv, box, rect, fov, pad = 0, near = 0.1) {
  if (!(zv > near) || !box || !(box.w > 0) || !(box.h > 0) || !rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  const th = Math.tan(((fov || 50) * Math.PI) / 360), aspect = rect.width / rect.height;
  const at = (px, py) => { const nx = ((px - rect.left) / rect.width) * 2 - 1, ny = 1 - ((py - rect.top) / rect.height) * 2; return { x: nx * zv * th * aspect, y: ny * zv * th, z: -zv }; };
  const x0 = box.x - pad, y0 = box.y - pad, x1 = box.x + box.w + pad, y1 = box.y + box.h + pad;
  return [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
}

/**
 * 판보다 뒤(더 먼 깊이)에 있으면서 화면에서 판 상자와 겹치는 DOM 라벨의 잘라낼 구멍(순수).
 * el = 라벨 화면 상자 {left, top, width, height}, depth = 라벨 월드 점 시야 깊이, boards = [{x0, y0, x1, y1, zv}](페이지 px).
 * 겹치는 가장 앞 판 하나 → 라벨 안쪽 좌표 {x0, y0, x1, y1}(px), 없으면 null. 판보다 앞(depth ≤ zv + eps)이면 null
 */
export function labelBoardCut(el, depth, boards, eps = 0.05) {
  if (!el || !(el.width > 0) || !(el.height > 0) || !boards || !boards.length || !Number.isFinite(depth)) return null;
  let best = null;
  for (const b of boards) {
    if (!(depth > b.zv + eps)) continue;
    const x0 = Math.max(el.left, b.x0), y0 = Math.max(el.top, b.y0), x1 = Math.min(el.left + el.width, b.x1), y1 = Math.min(el.top + el.height, b.y1);
    if (x1 <= x0 || y1 <= y0) continue;
    if (!best || b.zv < best.zv) best = { zv: b.zv, x0: x0 - el.left, y0: y0 - el.top, x1: x1 - el.left, y1: y1 - el.top };
  }
  return best ? { x0: best.x0, y0: best.y0, x1: best.x1, y1: best.y1 } : null;
}
/** 라벨 clip-path: 라벨 전체에서 구멍 사각형을 뺀 다각형(evenodd). 구멍이 라벨 전체면 'inset(50%)'(다 숨김) */
export function labelCutPath(c, w, h) {
  if (!c) return '';
  if (c.x0 <= 0.5 && c.y0 <= 0.5 && c.x1 >= w - 0.5 && c.y1 >= h - 0.5) return 'inset(50%)';
  const f = (v) => Math.round(v * 10) / 10 + 'px';
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${f(c.x0)} ${f(c.y0)}, ${f(c.x1)} ${f(c.y0)}, ${f(c.x1)} ${f(c.y1)}, ${f(c.x0)} ${f(c.y1)}, ${f(c.x0)} ${f(c.y0)})`;
}
/** 판 그림자(CSS box-shadow 0 8px 22px 를 장면 안에서): 여백 PAD px, 아래로 DY px, 흐림 BLUR px, 세기(다크·라이트) */
export const PLAN_SHADOW = { PAD: 34, DY: 8, BLUR: 22, A_DARK: 0.45, A_LIGHT: 0.18 };
