// 흐름 연출의 순수 부분(three·DOM 없음)
//   이벤트 → 패킷 계획(planFlow), 패킷 풀(PacketPool: 상한·노드별 상한·오래된 것 재사용), 경로·잔광 표본(linkPoint·trailUs),
//   (도구 사용은 홀로그램 모니터가 맡는다 — 예전 '도구 가지'는 없앴다)
//   도구 종류별 색(catColor), 완료 노드 퇴장 대상(exitEligible).
// 라이브와 재생은 같은 app.onEvent 를 지나므로 같은 계획을 받는다. node --test 로 시험한다(web/test/flow.test.mjs).

export const FLOW = {
  MAX_PACKETS: 384,   // 화면 전체 동시 패킷(머리) 상한 — 넘으면 가장 오래된 것을 재사용
  PER_NODE: 8,        // 노드 하나가 동시에 가질 수 있는 패킷
  TRAIL: 6,           // 잔광 표본 수(머리 뒤)
  TRAIL_DU: 0.05,     // 잔광 표본 간격(경로 비율)
  LINK_DUR: 0.95,     // 연결선 왕복 패킷 이동 시간(초)
  ARC: 0.9,           // 연결선 위 호 높이: 호출(부모→자식)은 위로, 결과(자식→부모)는 아래로
  OUTPUT_GAP: 0.6,    // 백그라운드 출력 패킷 노드당 최소 간격(초)
  UP_DEDUP: 2.0,      // 결과 패킷을 보낸 뒤 이 시간 안의 상태 종료 패킷은 생략
};

// 도구 종류(cat) 색: 색상(hue)만 정하고 밝기는 테마별(어두운 배경은 밝게, 밝은 배경은 진하게)
export const CAT_HUE = {
  shell: 28, read: 200, write: 330, edit: 282, search: 172, agent: 160, workflow: 258,
  skill: 46, web: 214, monitor: 312, mcp: 118, artifact: 12, notify: 346, other: 225,
};
export const CAT_ORDER = ['shell', 'read', 'write', 'edit', 'search', 'agent', 'workflow', 'skill', 'web', 'monitor', 'mcp', 'artifact', 'notify', 'other'];
export function catColor(cat, isLight = false) {
  const h = CAT_HUE[cat] ?? CAT_HUE.other;
  return isLight ? `hsl(${h}, 72%, 38%)` : `hsl(${h}, 82%, 64%)`;
}

export function hashUnit(s) {
  let h = 2166136261 >>> 0;
  s = String(s || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) / 4294967296;
}

const ENDED = new Set(['done', 'error', 'stopped']);
const UP_COLOR = { done: 'ok', error: 'error', stopped: 'stopped' };

/**
 * 이벤트 하나 → 패킷 계획 목록.
 * ctx = { has(id)→bool, parentOf(id)→id|null, activeChild(id)→id|null, now(초), speed, state:{lastUp:Map, lastOut:Map} }
 * 반환 항목:
 *   {kind:'link', from, to, color:'call'|'ok'|'error'|'stopped'|'output', dir:'down'|'up', size}
 */
export function planFlow(ev, ctx) {
  if (!ev || !ev.type) return [];
  const speed = ctx.speed || 1;
  const now = ctx.now || 0;
  const st = ctx.state || (ctx.state = { lastUp: new Map(), lastOut: new Map() });
  const out = [];
  const id = ev.nodeId;
  const parentOf = (x) => { const p = ctx.parentOf(x); return p && ctx.has(p) ? p : null; };
  switch (ev.type) {
    case 'node-add': {
      const n = ev.node || {};
      const p = n.parentId && ctx.has(n.parentId) ? n.parentId : null;
      if (p) out.push({ kind: 'link', from: p, to: n.id || id, color: 'call', dir: 'down', size: 1 });
      break;
    }
    case 'tool-start': {
      if (!ctx.has(id)) break;
      // 도구 자체는 홀로그램 패널이 그린다. 여기선 노드 사이 흐름만
      // 이미 있는 하위에게 말 걸기(SendMessage·TaskOutput): 새 에이전트(Agent·Task)는 node-add 가 호출 패킷을 낸다
      if (ev.cat === 'agent' && ev.tool !== 'Agent' && ev.tool !== 'Task') {
        const c = ctx.activeChild(id);
        if (c) out.push({ kind: 'link', from: id, to: c, color: 'call', dir: 'down', size: 0.8 });
      }
      break;
    }
    case 'result': {
      const p = parentOf(id);
      if (p) { out.push({ kind: 'link', from: id, to: p, color: ev.ok === false ? 'error' : 'ok', dir: 'up', size: 1.1 }); st.lastUp.set(id, now); }
      break;
    }
    case 'node-update': {
      const s = ev.patch && ev.patch.status;
      if (!ENDED.has(s)) break;
      const p = parentOf(id);
      const last = st.lastUp.get(id);
      if (p && !(last != null && now - last < FLOW.UP_DEDUP)) { out.push({ kind: 'link', from: id, to: p, color: UP_COLOR[s], dir: 'up', size: 0.9 }); st.lastUp.set(id, now); }
      break;
    }
    case 'output': {
      if (speed >= 8) break;
      const p = parentOf(id);
      const last = st.lastOut.get(id);
      if (p && !(last != null && now - last < FLOW.OUTPUT_GAP)) { out.push({ kind: 'link', from: id, to: p, color: 'output', dir: 'up', size: 0.6 }); st.lastOut.set(id, now); }
      break;
    }
    default: break;
  }
  // 상태 맵이 끝없이 크지 않게
  if (st.lastUp.size > 4000) st.lastUp.clear();
  if (st.lastOut.size > 4000) st.lastOut.clear();
  return out;
}

/**
 * 고정 크기 패킷 풀. 슬롯을 다시 쓰므로 프레임마다 객체를 만들지 않는다.
 * alloc(owner, now) → 슬롯 객체(내용은 호출자가 채움). 풀이 차면 가장 오래된 것, 노드별 상한을 넘으면 그 노드의 가장 오래된 것을 재사용
 */
/**
 * 연결선 위 패킷 위치: 살아 있는 패킷 → Map('부모|자식' → [빔 위 위치 0..1(부모 → 자식)]).
 * parentOf(id) 로 어느 쪽이 부모인지 정한다(호출 = 부모 → 자식, 결과 = 거꾸로).
 */
export function linkPackets(active, now, parentOf) {
  const out = new Map();
  for (const s of active || []) {
    if (!s.live || !s.from || !s.to || !(s.dur > 0)) continue;
    const u = (now - s.t0) / s.dur;
    if (u < 0 || u >= 1) continue;
    const e = easeInOut(u);
    let par, kid, t;
    if (parentOf(s.to) === s.from) { par = s.from; kid = s.to; t = e; }
    else if (parentOf(s.from) === s.to) { par = s.to; kid = s.from; t = 1 - e; }
    else continue;
    const k = par + '|' + kid;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(t);
  }
  return out;
}

export class PacketPool {
  constructor(max = FLOW.MAX_PACKETS, perNode = FLOW.PER_NODE) {
    this.max = max;
    this.perNode = perNode;
    this.slots = Array.from({ length: max }, (_, i) => ({ i, live: false, owner: null, t0: 0 }));
    this.free = this.slots.map((s) => s).reverse();
    this.active = [];
    this.byOwner = new Map(); // owner → 살아 있는 개수
    this.recycled = 0;
  }
  get size() { return this.active.length; }
  _oldest(pred) {
    let best = null;
    for (const s of this.active) if ((!pred || pred(s)) && (!best || s.t0 < best.t0)) best = s;
    return best;
  }
  alloc(owner, now) {
    const cnt = this.byOwner.get(owner) || 0;
    let s = null;
    if (cnt >= this.perNode) s = this._oldest((x) => x.owner === owner);
    if (!s && this.free.length) s = this.free.pop();
    if (!s) s = this._oldest();
    if (s.live) { this._unown(s); this.recycled++; } else this.active.push(s);
    for (const k of Object.keys(s)) if (k !== 'i') delete s[k];
    s.live = true; s.owner = owner; s.t0 = now;
    this.byOwner.set(owner, (this.byOwner.get(owner) || 0) + 1);
    return s;
  }
  _unown(s) {
    const c = (this.byOwner.get(s.owner) || 1) - 1;
    if (c <= 0) this.byOwner.delete(s.owner); else this.byOwner.set(s.owner, c);
  }
  release(s) {
    if (!s.live) return;
    this._unown(s);
    s.live = false; s.owner = null;
    const k = this.active.indexOf(s);
    if (k >= 0) { this.active[k] = this.active[this.active.length - 1]; this.active.pop(); }
    this.free.push(s);
  }
  /** 조건에 맞는 살아 있는 슬롯 찾기(도구 가지의 toolUseId 등) */
  find(pred) { for (const s of this.active) if (pred(s)) return s; return null; }
  clear() { for (const s of this.active.slice()) this.release(s); }
}

/** 0..1 이징(가속 후 감속) */
export const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

/**
 * 연결선 위 점: a→b 를 u(0..1)로 보간하고 위(+)·아래(−)로 호를 얹는다. out 은 {x,y,z} 를 채워 돌려준다
 */
export function linkPoint(out, a, b, u, arc) {
  const k = Math.max(0, Math.min(1, u));
  out.x = a.x + (b.x - a.x) * k;
  out.y = a.y + (b.y - a.y) * k + Math.sin(Math.PI * k) * arc;
  out.z = a.z + (b.z - a.z) * k;
  return out;
}

/** 잔광 표본 위치들(머리 u 에서 뒤로 TRAIL 개, 0 보다 작으면 생략). 반환: [u…] */
export function trailUs(u, n = FLOW.TRAIL, du = FLOW.TRAIL_DU) {
  const us = [];
  for (let i = 1; i <= n; i++) { const t = u - i * du; if (t < 0) break; us.push(t); }
  return us;
}

/**
 * 완료 노드 퇴장 대상: 끝난 노드 중 하위 전체도 대상인 것. 작업 중·대기는 남긴다. 모든 종류(작업 노드 포함)가 같은 규칙.
 * 정상 끝(done·stopped)은 바로 대상, 문제 있게 끝난 것(endedBadly)은 opts.nowMs 가 badEndDueAt 을 지났을 때만 대상.
 * 루트(메인·rootIds)는 항상 남긴다. nodes: Map<id,{id,parentId,kind,status}> · seen: Map<id, 처음 본 ms>(끝난 시각이 없는 노드용)
 */
export const EXIT_ERR = { LINGER_SEC: 600 }; // 문제 있게 끝난 노드가 남는 시간(초). app.js 가 /healthz 의 errorLingerSec(config.json)로 바꾼다

/** 문제 있게 끝났나: 오류(error — 에이전트 오류·rc≠0 실패 작업) 또는 정체 표시를 단 채 끝난 작업 */
export function endedBadly(n) {
  if (!n) return false;
  if (n.status === 'error') return true;
  const j = n.meta && n.meta.job;
  return !!(j && j.stale && (n.status === 'done' || n.status === 'stopped'));
}

/** 문제 있게 끝난 노드가 퇴장 대상이 되는 시각(ms, 표시 시계). 끝난 시각 = 작업 endedAt → 노드 endedAt → seenMs(웹이 처음 본 시각) */
export function badEndDueAt(n, seenMs = null, defSec = EXIT_ERR.LINGER_SEC) {
  if (!endedBadly(n)) return null;
  const j = n.meta && n.meta.job;
  let end = Date.parse((j && j.endedAt) || n.endedAt || '');
  if (!Number.isFinite(end)) end = Number.isFinite(seenMs) ? seenMs : NaN;
  if (!Number.isFinite(end)) return null;
  const own = j && j.failLingerSec != null ? +j.failLingerSec : NaN; // 작업은 jobs.json failLingerSec 가 이긴다
  const sec = Number.isFinite(own) && own >= 0 ? own : defSec;
  return end + sec * 1000;
}

/**
 * 퇴장 시각 합치기: 대상 노드마다 자기 끝 시각(own: id → 벽시계 초)과 하위 전체(대상인 것)의 가장 늦은 끝 시각 중 큰 값.
 * 하위가 늦게 끝나면 부모는 그때부터 LINGER 를 센다. 반환 Map<id, 초|null>
 */
export function exitWalls(nodes, elig, own) {
  const kids = new Map();
  for (const n of nodes.values()) if (n.parentId && elig.has(n.id) && elig.has(n.parentId)) { if (!kids.has(n.parentId)) kids.set(n.parentId, []); kids.get(n.parentId).push(n.id); }
  const memo = new Map();
  const w = (id, depth = 0) => {
    if (memo.has(id)) return memo.get(id);
    let r = own.get(id); if (r == null) r = null;
    if (depth < 64) for (const c of kids.get(id) || []) { const cw = w(c, depth + 1); if (cw == null) { r = null; break; } if (r != null && cw > r) r = cw; }
    memo.set(id, r);
    return r;
  };
  const out = new Map();
  for (const id of elig) out.set(id, w(id));
  return out;
}

/**
 * 복셀: '완료 표시' 끔이면 끝난 작업 카드를 뺀다 — 정상 끝은 끝난 뒤 lingerMs(표시 시계), 문제 있는 끝은 badEndDueAt 뒤.
 * 직원·기계는 복셀 고유 퇴장(문으로 나감)을 그대로 쓴다. 반환 Set<id>
 */
export function jobCardsGone(nodes, nowMs, lingerMs = 2500) {
  const out = new Set();
  if (!Number.isFinite(nowMs)) return out;
  for (const n of nodes.values()) {
    const j = n && n.meta && n.meta.job;
    if (!j) continue;
    let due = null;
    if (endedBadly(n)) due = badEndDueAt(n);
    else if (n.status === 'done' || n.status === 'stopped') { const e = Date.parse(j.endedAt || n.endedAt || ''); due = Number.isFinite(e) ? e + lingerMs : -Infinity; }
    if (due != null && nowMs >= due) out.add(n.id);
  }
  return out;
}

/**
 * 복셀 직원·기계: '완료 표시' 끔일 때 끝났지만 아직 퇴장 대상(exitEligible)이 아닌 노드 — 자리에 붙잡는다.
 * 문제 있는 끝은 문턱 전, 일하는 하위가 있으면 하위가 끝날 때까지. 판정은 흐름·평면과 같은 exitEligible 그대로.
 * seen: Map<id, 처음 본 ms>(끝난 시각 없는 오류용, 여기서 갱신 — 뷰가 들고 다님). 반환 Set<id>
 */
export function vxHeldEnded(nodes, rootIds = [], nowMs = null, seen = null) {
  if (seen) for (const [id, n] of nodes) { if (!endedBadly(n)) seen.delete(id); else if (!seen.has(id) && Number.isFinite(nowMs)) seen.set(id, nowMs); }
  const elig = exitEligible(nodes, rootIds, { nowMs, seen });
  const out = new Set();
  for (const n of nodes.values()) if (n && (n.status === 'done' || n.status === 'stopped' || n.status === 'error') && !elig.has(n.id)) out.add(n.id);
  return out;
}

export function exitEligible(nodes, rootIds = [], { nowMs = null, seen = null } = {}) {
  const roots = new Set(rootIds.filter(Boolean));
  const kids = new Map();
  for (const n of nodes.values()) {
    if (n.parentId && nodes.has(n.parentId)) { if (!kids.has(n.parentId)) kids.set(n.parentId, []); kids.get(n.parentId).push(n.id); }
  }
  const memo = new Map();
  const ok = (id, depth = 0) => {
    if (memo.has(id)) return memo.get(id);
    const n = nodes.get(id);
    let r = false;
    if (n && !roots.has(id) && n.kind !== 'main') {
      if (endedBadly(n)) { const due = badEndDueAt(n, seen ? seen.get(id) : null); r = due != null && Number.isFinite(nowMs) && nowMs >= due; }
      else r = n.status === 'done' || n.status === 'stopped';
    }
    if (r && depth < 64) for (const c of kids.get(id) || []) if (!ok(c, depth + 1)) { r = false; break; }
    memo.set(id, r);
    return r;
  };
  const out = new Set();
  for (const id of nodes.keys()) if (ok(id)) out.add(id);
  return out;
}
