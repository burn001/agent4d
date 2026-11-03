// 【모듈 규격 · 연구소 상호작용(Interaction) — 순수】 three·DOM 없음, node --test 대상(web/test/lab-dyn-ix.test.mjs). 3D(lab-ix.js·lab-view.js)·2D(flat/lab2d.js) 공용.
//
// 모든 연출은 세션 사건 하나에 묶여 시작·끝난다(무작위 장식 없음):
//   특별 상호작용 ix(IxModel fx)        → labIxRoute(f, actor, room, rigOf) 길(출발 = bg 기자재 꼭대기 | 책상, 도착 = room.ixSpots[cat])
//   서브에이전트 생성(node-add)             → courierFor 'dispatch' 의뢰서 캡슐(브리지 콘솔 → 새 책상, 1.0초, 세션 색)
//   서브에이전트 끝(status done/error·result) → 'report' 보고 캡슐(책상 → 브리지 콘솔, 1.0초, ok 초록 / 실패 빨강 테)
//   기자재 전이 run → done(rc 0)            → 'pod' 산출 캡슐(기자재 꼭대기 → 플랫폼 반출대 θ45 · 탱크는 DB 탱크 θ225 방울 3)
//   기자재 출력(output → m.flashUntil 상승) → cablePulseEdge 케이블 데이터 펄스(초당 ≤ 2)
//
// ┌ export ─────────────────────────────────────────────────────────────────────────────────────────┐
// │ LAB_IX                       상한·시간 상수                                                                        │
// │ labIxShouldDraw(room)        연구소 방이면 true(vx-ix 가 사무실 은유 대신 LabView._labIxDraw 를 부르는 판정)           │
// │ labIxRoute(f, actor, room, rigOf, out?) → {from, to, dir:'out'|'in', key, rig, m} | null (out 재사용 — 프레임 할당 0)   │
// │ labIxCount(f)                캡슐 수 m(db 2～5 = log 행 수 · github 1 · remote 3 · batch·tests 공급선 3)                │
// │ class LabCouriers(cap 24)    운반 캡슐 풀: add(kind, fx,fy,fz, tx,ty,tz, t0, dur, colorKey, pri) → 항목 | null ·     │
// │                              step(now) → n · list[0..n) · clear(). 넘치면 pri 큰(낮은 우선) 것부터, 같으면 오래된 것    │
// │ courierFor(ev, ctx)          사건 → {kind, from, to, dur, color, pri, m, owner, arrive} | null                              │
// │ courierLod(far, reduced)     'full' | 'body'(중경 'mid' — 꼬리 없음) | 'ring'(원경·움직임 줄이기) | 'none'(원경 + 줄이기) │
// │ courierArc(dist)             포물선 높이 1.0 + 0.1·거리(≤ 3)                                                      │
// │ newPulseMem() · cablePulseEdge(mem, flashUntil, now) · cablePulsePush(mem, now, kind) · cablePulseRead(mem, now, dur, out) │
// │ labPendStep(pend, now, tryFn, wait = 2)  배치를 기다리는 사건 목록(제자리 압축 — 할당 0)                          │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// 성능: 캡슐 동시 ≤ 24(그리기 ≤ 4 상자 → ≤ 96) · 연구소 ix 효과당 ≤ 12 상자, 프레임 합 ≤ 60 · 풀은 생성 때 한 번 만들고 다시 씀.
import { LAB, polar, thetaOf } from './lab-const.mjs';
import { RIG_HEIGHT } from './lab-rig-core.mjs';

export const LAB_IX = {
  FX_MAX: 12,          // 효과 하나 상자 상한
  TOTAL_MAX: 60,       // 프레임 합 상자 상한
  COURIERS: 24,        // 운반 캡슐 동시 상한
  COURIER_BOXES: 4,    // 캡슐 하나 상자(판 + 테 + 꼬리 2)
  RING_S: 0.25,        // 도착 링 퍼짐
  REDUCED_RING_S: 0.5, // 움직임 줄이기: 도착점 정지 링
  PULSE_S: 0.8,        // 케이블 펄스 한 번
  PULSE_GAP: 0.5,      // 케이블 펄스 간격 하한(초당 ≤ 2)
  PEND_S: 2,           // 배치를 기다리는 사건 유효 시간
  CAPSULE_ARC: 0.9,    // ix 캡슐 포물선 높이
  CAPSULE_PERIOD: 1.2, // ix 캡슐 한 바퀴(초)
};
/** 산출 캡슐을 내는 기자재 종류(그 밖 scope·oscillo·antenna 는 산출물 없음 · tank 는 DB 탱크 방울) */
export const POD_KINDS = new Set(['tests', 'reactor', 'incubator', 'meter', 'dispenser', 'sequencer']);
const LIVE = new Set(['run', 'wait', 'stale']);
const SUB = new Set(['subagent', 'workflow-agent']);

/** vx-ix 연구소 분기 판정 — 연구소 방(type 'lab')이면 true */
export function labIxShouldDraw(room) { return !!(room && room.type === 'lab'); }

/** 캡슐 수(효과 범주별) */
export function labIxCount(f) {
  const ix = (f && f.ix) || {};
  switch (f && f.cat) {
    case 'db': return Math.min(5, Math.max(2, Math.round(Math.log10((ix.rows || 10) + 1) * 2)));
    case 'github': return 1;
    case 'remote': return 3;
    case 'batch': case 'tests': return 3;
    default: return 1;
  }
}

/**
 * 연구소 특별 상호작용 길(순수). f = IxModel 효과, actor = {id, x, y, z, floorY?}(VxIx._actor — 책상 쪽 점),
 * room = computeLab 방(ixSpots), rigOf(id) → {x, z, rigKind|kind} | null(연구소 기자재 그리는 자리).
 *   출발: f.bgNode(없으면 actor.id)가 연구소 기자재면 그 꼭대기(RIG_HEIGHT + 0.2), 아니면 actor(높이 1.2 + 바닥 높이)
 *   도착: room.ixSpots[f.cat]. 방향: github push·commit → out(코어로) · pull·fetch·clone → in · 그 밖 out
 *         db rw 'w'/'rw' → out(탱크로) · 그 밖 in · remote transfer 'down' → in · 그 밖 out · batch → out · tests → 신호탑(out)
 *   batch·tests 에 bg 기자재가 있으면 '공급선'(key 'supply'): 책상 → 기자재 꼭대기(분주 로봇 웰·시험관 줄은 기자재가 그림)
 * out 을 넘기면 그 객체(와 from·to)를 다시 씀. 길이 없으면 null.
 */
export function labIxRoute(f, actor, room, rigOf, out = null) {
  if (!f || !room || !room.ixSpots) return null;
  const sp = room.ixSpots[f.cat];
  if (!sp) return null;
  const o = out || { from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 0 }, dir: 'out', key: '', rig: null, m: 1 };
  const ix = f.ix || {}, op = ix.op || f.op || '';
  let rigId = null, rp = null;
  if (rigOf) {
    if (f.bgNode) { rp = rigOf(f.bgNode); if (rp) rigId = f.bgNode; }
    if (!rp && actor && actor.id != null) { rp = rigOf(actor.id); if (rp) rigId = actor.id; }
  }
  const a = o.from, b = o.to;
  const supply = !!rp && (f.cat === 'batch' || f.cat === 'tests');
  if (supply) {
    if (!actor || (rigId === actor.id)) return null; // 공급선은 책상이 있어야
    a.x = actor.x; a.y = (actor.y || 1.2) + (actor.floorY || 0); a.z = actor.z;
    b.x = rp.x; b.y = (RIG_HEIGHT[rp.rigKind || rp.kind] || 1.4) + 0.2; b.z = rp.z;
    o.dir = 'out'; o.key = 'supply'; o.rig = rigId; o.m = labIxCount(f);
    return o;
  }
  if (rp) { a.x = rp.x; a.y = (RIG_HEIGHT[rp.rigKind || rp.kind] || 1.4) + 0.2; a.z = rp.z; }
  else if (actor) { a.x = actor.x; a.y = (actor.y || 1.2) + (actor.floorY || 0); a.z = actor.z; }
  else return null;
  b.x = sp.x; b.y = sp.y != null ? sp.y : 1.0; b.z = sp.z;
  let dir = 'out';
  if (f.cat === 'github') dir = op === 'pull' || op === 'fetch' || op === 'clone' ? 'in' : 'out';
  else if (f.cat === 'db') dir = ix.rw === 'w' || ix.rw === 'rw' ? 'out' : 'in';
  else if (f.cat === 'remote') dir = ix.transfer === 'down' ? 'in' : 'out';
  o.dir = dir; o.key = f.cat + ':' + dir; o.rig = rigId; o.m = labIxCount(f);
  return o;
}

// ───────────────────────────── 운반 캡슐 풀 ─────────────────────────────
const blank = () => ({ kind: '', fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, t0: 0, dur: 1, c: null, c2: null, pri: 1, m: 1, arr: null, act: null, hit: false });
/** 운반 캡슐 풀(순수) — 항목 객체는 생성 때 cap 개를 만들고 다시 씀(워밍 뒤 할당 0) */
export class LabCouriers {
  constructor(cap = LAB_IX.COURIERS) {
    this.cap = Math.max(1, cap | 0);
    this.list = [];
    for (let i = 0; i < this.cap; i++) this.list.push(blank());
    this.n = 0;
  }
  /** 캡슐 하나. 넘치면 pri 가 큰(낮은 우선) 것부터 — 새것보다 우선이 낮거나 같은 것 중 pri 가 가장 크고(같으면 오래된) 것을 바꿈, 없으면 버림(null) */
  add(kind, fx, fy, fz, tx, ty, tz, t0, dur, colorKey, pri = 1) {
    let it;
    if (this.n < this.cap) it = this.list[this.n++];
    else {
      let w = -1;
      for (let i = 0; i < this.n; i++) {
        const q = this.list[i];
        if (q.pri < pri) continue;
        if (w < 0) { w = i; continue; }
        const W = this.list[w];
        if (q.pri > W.pri || (q.pri === W.pri && q.t0 < W.t0)) w = i;
      }
      if (w < 0) return null;
      it = this.list[w];
    }
    it.kind = kind; it.fx = fx; it.fy = fy; it.fz = fz; it.tx = tx; it.ty = ty; it.tz = tz;
    it.t0 = t0; it.dur = dur > 0 ? dur : 1; it.c = colorKey; it.c2 = null; it.pri = pri; it.m = 1; it.arr = null; it.act = null; it.hit = false;
    return it;
  }
  /** 끝난(도착 + 링 RING_S, 움직임 줄이기 링 0.5초 중 긴 쪽 지남) 항목 빼기(뒤 항목과 자리 바꿈) → 남은 수 */
  step(now) {
    const L = this.list;
    for (let i = 0; i < this.n;) {
      const q = L[i];
      if (now > q.t0 + Math.max(q.dur + LAB_IX.RING_S, LAB_IX.REDUCED_RING_S)) {
        const j = --this.n;
        if (i !== j) { L[i] = L[j]; L[j] = q; }
        q.c = null; q.c2 = null; q.arr = null;
        continue;
      }
      i++;
    }
    return this.n;
  }
  clear() { for (let i = 0; i < this.n; i++) { const q = this.list[i]; q.c = null; q.c2 = null; q.arr = null; } this.n = 0; }
}

/** 운반 그리기 수준: 'full'(몸 + 꼬리) · 'body'(중경 — 꼬리 없음) · 'ring'(원경·움직임 줄이기 — 도착 링만) · 'none'(원경 + 움직임 줄이기) */
export function courierLod(far, reduced) {
  if (far === true) return reduced ? 'none' : 'ring';
  if (reduced) return 'ring';
  return far === 'mid' ? 'body' : 'full';
}
/** 캡슐 포물선 높이(거리 m) */
export const courierArc = (dist) => Math.min(3, 1.0 + 0.1 * (dist > 0 ? dist : 0));

// ───────────────────────────── 사건 → 캡슐 ─────────────────────────────
const roomById = (layout, id) => { if (!layout || !layout.rooms) return null; for (const r of layout.rooms) if (r.id === id) return r; return null; };
/** 그 노드 자리(책상) 끝점 {x,y,z}: 팀장 = 브리지 콘솔(덱 1.6 + 1.0), 직원 = 책상(1.0) */
function deskPt(layout, id) {
  const s = layout && layout.seat instanceof Map ? layout.seat.get(id) : null;
  if (!s) return null;
  if (s.kind === 'lead') {
    const r = roomById(layout, s.roomId), ld = r && r.ownerId === id && r.leadDesk;
    const x = ld ? ld.x : s.deskX, z = ld ? ld.z : s.deskZ, fy = ld && Number.isFinite(ld.floorY) ? ld.floorY : s.floorY || LAB.BRIDGE.Y;
    return { x, y: fy + 1.0, z, lead: true, roomId: s.roomId };
  }
  if (!Number.isFinite(s.deskX)) return null;
  return { x: s.deskX, y: (s.floorY || 0) + 1.0, z: s.deskZ, lead: false, roomId: s.roomId };
}
const isLabRoom = (layout, roomId) => { const r = roomById(layout, roomId); return !!(r && r.type === 'lab'); };

/**
 * 사건 → 운반 캡슐(순수). 결과 객체는 사건마다 새로(드묾 — 프레임 경로가 아님). null = 캡슐 없음.
 *   ev = { type: 'node-add', node } · { type: 'node-update', node, patch:{status} } · { type: 'result', node, ok }
 *        · { type: 'rig', node, prev, state, kind?, pos? }(prev·state = rigState 이전·지금)
 *   ctx = { layout(computeLab/Campus 결과), nodeOf(id) → 노드 | null }
 * 결과 { kind:'dispatch'|'report'|'pod', from:{x,y,z}, to:{x,y,z}, dur(초, 배속 전), color:'sess'|'ok'|'fail'|'rig:<종류>',
 *        pri(1 의뢰·보고, 2 산출), m(방울 수), owner(세션 색 주인 = 그 방 메인), arrive(도착 때 몸짓·섬광 대상 id), gesture('dispatch'|'receive'|null), lead }
 */
export function courierFor(ev, ctx) {
  if (!ev || !ctx || !ctx.layout) return null;
  const lay = ctx.layout, n = ev.node;
  if (!n || !n.id) return null;
  const nodeOf = ctx.nodeOf || (() => null);
  if (ev.type === 'node-add' || ev.type === 'node-update' || ev.type === 'result') {
    if (!SUB.has(n.kind) || !n.parentId) return null;
    const p = deskPt(lay, n.parentId), d = deskPt(lay, n.id);
    if (!p || !d || d.lead || !isLabRoom(lay, d.roomId)) return null;
    const owner = ownerOf(lay, d.roomId) || n.parentId;
    // 몸짓(가리킴·보고 받기): 팀장 + 자기 책상에서 서브에이전트를 띄운 claude -p(11.02. — 띄운 쪽과 하위가 이어져 보이게)
    const pn = p.lead ? null : nodeOf(n.parentId), ges = p.lead || !!(pn && pn.kind === 'claude-p');
    if (ev.type === 'node-add') {
      return { kind: 'dispatch', from: { x: p.x, y: p.y, z: p.z }, to: { x: d.x, y: d.y, z: d.z }, dur: 1.0, color: 'sess', pri: 1, m: 1, owner, arrive: n.id, gesture: ges ? 'dispatch' : null, lead: ges ? n.parentId : null };
    }
    let ok;
    if (ev.type === 'result') ok = ev.ok !== false;
    else {
      const st = ev.patch && ev.patch.status;
      if (st !== 'done' && st !== 'error') return null;
      ok = st !== 'error';
    }
    return { kind: 'report', from: { x: d.x, y: d.y, z: d.z }, to: { x: p.x, y: p.y, z: p.z }, dur: 1.0, color: ok ? 'ok' : 'fail', pri: 1, m: 1, owner, arrive: n.parentId, gesture: ges ? 'receive' : null, lead: ges ? n.parentId : null };
  }
  if (ev.type === 'rig') {
    if (ev.state !== 'done' || !LIVE.has(ev.prev)) return null;
    const pos = ev.pos || (lay.machine instanceof Map ? lay.machine.get(n.id) : null);
    if (!pos) return null;
    const kind = ev.kind || pos.rigKind || 'meter';
    if (!POD_KINDS.has(kind) && kind !== 'tank') return null;
    const r = roomById(lay, pos.roomId), lab = r && r.lab;
    if (!lab) return null;
    const tank = kind === 'tank';
    const th = tank ? (LAB.RIM.DB[0] + LAB.RIM.DB[1]) / 2 : (LAB.RIM.BOARD[0] + LAB.RIM.BOARD[1]) / 2;
    const q = polar(lab.cx, lab.cz, lab.rP - 0.8, th);
    const par = nodeOf(n.parentId);
    return {
      kind: 'pod', from: { x: pos.x, y: (RIG_HEIGHT[kind] || 1.4) + 0.2, z: pos.z }, to: { x: q.x, y: tank ? 1.0 : 0.6, z: q.z },
      // 먼 기자재(플랫폼 건너편)는 길게 — 28m ≈ 2.3초
      dur: Math.min(2.4, (tank ? 1.0 : 1.2) + 0.04 * Math.hypot(q.x - pos.x, q.z - pos.z)), color: 'rig:' + kind, pri: 2, m: tank ? 3 : 1, owner: par ? par.id : null, arrive: null, gesture: null, lead: null,
      theta: thetaOf(lab.cx, lab.cz, q.x, q.z),
    };
  }
  return null;
}
const ownerOf = (lay, roomId) => { const r = roomById(lay, roomId); return r ? r.ownerId : null; };

/**
 * 배치를 기다리는 사건 목록 한 번 돌리기(제자리 압축 — 할당 0): tryFn(p) 가 true 면 처리됨(뺌), now − p.at ≥ wait 이면 버림.
 * 남은 수를 돌려줌.
 */
export function labPendStep(pend, now, tryFn, wait = LAB_IX.PEND_S) {
  if (!pend || !pend.length) return 0;
  let w = 0;
  for (let i = 0; i < pend.length; i++) {
    const p = pend[i];
    if (tryFn(p)) continue;
    if (now - p.at >= wait) continue;
    pend[w++] = p;
  }
  pend.length = w;
  return w;
}

// ───────────────────────────── 케이블 데이터 펄스 ─────────────────────────────
/** 기계마다 하나(m._cp): fu = 마지막으로 본 flashUntil · at = 마지막 데이터 펄스 시각 · t/k = 펄스 칸 2개(시작 시각·종류 0 데이터 · 1 끝 · 2 실패 · 3 설치) */
export const newPulseMem = () => ({ fu: 0, at: -1e9, t: [-1e9, -1e9], k: [0, 0] });
/** 출력 상승 가장자리(flashUntil 이 새로 늘어남 + 아직 켜짐)만 true · 초당 2회(PULSE_GAP) 제한 */
export function cablePulseEdge(mem, flashUntil, now) {
  if (!mem || !Number.isFinite(flashUntil)) return false;
  const rise = flashUntil > mem.fu + 1e-6;
  mem.fu = Math.max(mem.fu, flashUntil);
  if (!rise || !(flashUntil > now)) return false;
  if (now - mem.at < LAB_IX.PULSE_GAP) return false;
  mem.at = now;
  return true;
}
/** 펄스 칸에 넣기(더 오래된 칸을 덮음) */
export function cablePulsePush(mem, now, kind = 0) {
  const i = mem.t[0] <= mem.t[1] ? 0 : 1;
  mem.t[i] = now; mem.k[i] = kind;
}
/** 살아 있는 펄스 → out[i] = {u(0..1 진행), k(종류)} 채우고 개수(≤ 2). dur = 한 번 걸리는 시간 */
export function cablePulseRead(mem, now, dur, out) {
  if (!mem) return 0;
  let n = 0;
  for (let i = 0; i < 2; i++) {
    const u = (now - mem.t[i]) / dur;
    if (u < 0 || u >= 1) continue;
    const o = out[n] || (out[n] = { u: 0, k: 0 });
    o.u = u; o.k = mem.k[i]; n++;
  }
  return n;
}
