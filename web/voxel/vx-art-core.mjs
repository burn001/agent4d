// 작업 대상 층 — 복셀 오피스 은유. 순수 부분(three·DOM 없음, node --test 대상).
// 사무실(그 프로젝트 메인의 사무실) 벽 바깥 띠에 가구를 둔다 — 방 안(책상·시설)은 그대로라 비좁아지지 않는다.
//   뒤 벽 바깥: 문서 서가(캐비닛 칸) = 파일(폴더 = 칸, 칸마다 서랍 4 × 탭 6), 넘친 폴더는 맨 끝 '…' 칸
//   왼쪽 벽 바깥(뒤): 서버랙 있는 금고실 = DB(랙마다 쓰기 수위 표시등, 둥근 금고문), 왼쪽 벽 바깥(앞): 벽 전화 + 안테나 = 외부 서비스
//   앞 벽 바깥(출입문 왼쪽): git 우편함 = 저장소(push 깃발·편지 눈금), (출입문 오른쪽): 택배 창구 = 원격(상자 + 바깥으로 점선),
//   (가운데): 결재함 트레이 = 산출물(만들 때 서류가 솟았다 내려앉음)
// 좌표는 방의 '돌리기 전'(room.local) 지역 좌표로 짓고 xf(90° 단위)로 세계에 옮긴다. 배정은 결정적·안정적(이미 놓인 대상은 자리를 지킴).
import { ART, ARTGEO, freshness, dbLevel, fileSub, districtKey, districtLabel } from '../artifact-core.mjs';
import { KI, styleAlpha, litMap, fxState, itemAlpha, shield, beams, commonFx, ease, extOf, dashed, boxEdges } from '../art-meta.mjs';
import { toWorld, quarter } from './xf.mjs';
import { ActPos, drawActs } from '../art-act-core.mjs'; // 상호작용 연출

export const VXA = {
  BAY_W: 1.1, BAY_D: 0.66, BAY_H: 2.45, DRAWERS: 4, PER_DRAWER: 6, BAYS_MAX: 20,
  DB_MAX: 6, REPO_MAX: 4, REMOTE_MAX: 4, SVC_MAX: 6, OUT_MAX: 8,
  GAP: 0.25,   // 벽과 가구 사이
};
const PER_BAY = VXA.DRAWERS * VXA.PER_DRAWER;
const KMAX = { db: VXA.DB_MAX, repo: VXA.REPO_MAX, remote: VXA.REMOTE_MAX, service: VXA.SVC_MAX, output: VXA.OUT_MAX };

/** 방의 지역 틀: 원점·뒤/앞/왼/오른 벽·문 x·뒷문 */
export function vxFrame(room) {
  const L = room.local || room;
  const o = L.origin, b = L.bounds;
  return { o, zb: b.minZ, zf: b.maxZ, xl: b.minX, xr: b.maxX, dx: L.door ? L.door.x : o.x + 7.8, backDoor: !!L.backDoor, xf: room.xf && quarter(room.xf.k) ? room.xf : null };
}
/** 서가 칸 x(지역): 왼쪽부터, 뒷문 틈 비움 */
export function bayXs(F) {
  const out = [];
  for (let x = F.xl + 0.75; x <= F.xr - 0.75 + 1e-6 && out.length < VXA.BAYS_MAX; x += VXA.BAY_W) {
    if (F.backDoor && Math.abs(x - F.o.x) < 1.3) continue;
    out.push(x);
  }
  return out;
}
/** 고정 자리(지역): 금고실·서비스·우편함·택배 창구·결재함 */
export function fixtureSpots(F) {
  const zb = F.zb, zf = F.zf, xl = F.xl, dx = F.dx, y = 0;
  const vault = { x: xl - VXA.GAP - 1.0, z: zb + 2.15, w: 2.0, d: 3.7, h: 2.6 };
  return {
    vault,
    db: Array.from({ length: VXA.DB_MAX }, (_, i) => ({ x: vault.x + (i % 2 ? 0.45 : -0.45), z: zb + 0.85 + Math.floor(i / 2) * 1.2, y })),
    service: Array.from({ length: VXA.SVC_MAX }, (_, i) => ({ x: xl - VXA.GAP - 0.12, z: zb + 5.0 + i * 1.4, y })),
    repo: Array.from({ length: VXA.REPO_MAX }, (_, i) => ({ x: dx - 1.9 - i * 0.95, z: zf + 0.75, y })),
    counter: { x: dx + 2.15, z: zf + 0.8, w: 1.7, d: 0.6, h: 0.9 },
    remote: Array.from({ length: VXA.REMOTE_MAX }, (_, i) => ({ x: dx + 1.55 + i * 0.4, z: zf + 0.8, y: 0.9 })),
    tray: { x: F.o.x + 1.0, z: zf + 0.8, w: 1.7, d: 0.6, h: 0.5 },
    output: Array.from({ length: VXA.OUT_MAX }, (_, i) => ({ x: F.o.x + 0.62 + Math.floor(i / 4) * 0.76, z: zf + 0.8, y: 0.55 + (i % 4) * 0.19 })),
  };
}
/** 자리 안정 배정: map(id → 자리) 에서 없어진 것은 비우고 새것은 정렬 순으로 가장 낮은 빈 자리(cap 넘치면 넘침) */
function assign(map, ids, cap) {
  const live = new Set(ids);
  for (const k of [...map.keys()]) if (!live.has(k)) map.delete(k);
  const used = new Set(map.values());
  let over = 0, i = 0;
  for (const id of ids) {
    if (map.has(id)) continue;
    while (used.has(i)) i++;
    if (i >= cap) { over++; continue; }
    map.set(id, i); used.add(i);
  }
  return over;
}
const byFirst = (a, b) => (a.first || 0) - (b.first || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * 프로젝트별 가구 배정(결정적·안정적). sync(pid, items, room) → plan
 * plan = { pid, room, F, bays:[{i, dk, label, x, z, n, over}], slots: Map<id, {k, i, bay?, row?, col?, lx, ly, lz, x, y, z}>, over:{file, folders, db…}, has:{db,…} }
 */
export class VxArtPlan {
  constructor() { this.S = new Map(); }
  sync(pid, items, room) {
    let S = this.S.get(pid);
    if (!S) { S = { bay: new Map(), inBay: new Map(), kind: Object.fromEntries(Object.keys(KMAX).map((k) => [k, new Map()])) }; this.S.set(pid, S); }
    const F = vxFrame(room), xs = bayXs(F), spots = fixtureSpots(F);
    const nBay = Math.max(1, xs.length - 1); // 맨 끝 칸 = 넘친 폴더('…')
    const files = items.filter((it) => it.k === 'file').sort(byFirst);
    const byDk = new Map();
    for (const it of files) { const dk = districtKey(it); (byDk.get(dk) || byDk.set(dk, []).get(dk)).push(it); }
    const folderOver = assign(S.bay, [...byDk.keys()], nBay);
    const plan = { pid, room, F, bays: [], slots: new Map(), over: { file: 0, folders: folderOver }, has: {}, spots };
    const T = (lx, lz) => (F.xf ? toWorld(F.xf, lx, lz) : { x: lx, z: lz });
    const bayAt = (bi, dk, label, list) => {
      const bx = xs[bi];
      const bz = F.zb - VXA.GAP - VXA.BAY_D / 2;
      const m = S.inBay.get(dk) || S.inBay.set(dk, new Map()).get(dk);
      const over = assign(m, list.map((it) => it.id), PER_BAY);
      const w = T(bx, bz);
      plan.bays.push({ i: bi, dk, label, lx: bx, lz: bz, x: w.x, z: w.z, n: list.length, over });
      plan.over.file += over;
      for (const it of list) {
        const s = m.get(it.id); if (s == null) continue;
        const row = Math.floor(s / VXA.PER_DRAWER), col = s % VXA.PER_DRAWER;
        const lx = bx - 0.4 + (col + 0.5) * (0.8 / VXA.PER_DRAWER), ly = 0.2 + row * 0.55 + 0.3, lz = bz + VXA.BAY_D / 2 + 0.02;
        const q = T(lx, lz);
        plan.slots.set(it.id, { k: 'file', i: s, bay: bi, row, col, lx, ly, lz, x: q.x, y: ly, z: q.z });
      }
    };
    const extra = [];
    for (const [dk, list] of byDk) { const bi = S.bay.get(dk); if (bi == null) extra.push(...list); else bayAt(bi, dk, districtLabel(dk), list); }
    if (extra.length && xs.length) bayAt(xs.length - 1, '#over', '…', extra.sort(byFirst));
    for (const k of Object.keys(KMAX)) {
      const list = items.filter((it) => it.k === k).sort(byFirst);
      plan.has[k] = list.length > 0;
      plan.over[k] = assign(S.kind[k], list.map((it) => it.id), KMAX[k]);
      for (const it of list) {
        const i = S.kind[k].get(it.id); if (i == null) continue;
        const sp = spots[k][i];
        const ly = k === 'db' ? 1.0 : k === 'service' ? 1.35 : k === 'repo' ? 1.05 : k === 'remote' ? sp.y + 0.18 : sp.y;
        const q = T(sp.x, sp.z);
        plan.slots.set(it.id, { k, i, lx: sp.x, ly, lz: sp.z, x: q.x, y: ly, z: q.z });
      }
    }
    return plan;
  }
  drop(pid) { this.S.delete(pid); }
}

/** 그 프로젝트 아카이브를 둘 사무실: 단일 세션 = 루트 사무실, 전체 보기 = 동의 첫 사무실(지난 날개 제외) */
export function vxRoomsFor(view, book) {
  const out = new Map(), lay = view.layout;
  if (!lay || !view.rooms) return out;
  const offices = view.rooms.filter((r) => r.type === 'office');
  if (view.scope && view.scope.mode === 'all') {
    for (const b of lay.buildings || []) {
      if (b.recent || !book.projects.has(b.projectId)) continue;
      const ids = (b.offices || []).map((o) => o.mainId);
      const room = offices.find((r) => ids.includes(r.ownerId) && !r.past) || offices.find((r) => r.projectId === b.projectId && !r.past);
      if (room) out.set(b.projectId, room);
    }
  } else {
    const room = offices.find((r) => r.ownerId === lay.rootId) || offices[0];
    if (room) out.set(book.defaultProject, room);
  }
  return out;
}
/** 맞춤 점(세계): 가구 띠의 바깥 모서리 */
export function vxFitPoints(plan, out) {
  const F = plan.F, T = (lx, lz) => (F.xf ? toWorld(F.xf, lx, lz) : { x: lx, z: lz });
  const pts = [[F.xl - 2.5, F.zb - 1.2], [F.xr + 0.2, F.zb - 1.2], [F.xl - 2.5, F.zf + 1.4], [F.xr + 0.2, F.zf + 1.4]];
  for (const [x, z] of pts) { const q = T(x, z); out.push({ p: { x: q.x, y: 0, z: q.z }, r: 0.6 }, { p: { x: q.x, y: 2.6, z: q.z }, r: 0.6 }); }
  return out;
}

/**
 * 복셀 도형(세계 좌표). plans = Map<pid, plan>. env = {nodePos(id), nowMs, reduced, foot, hover, style, isLight, unitPx(pid) → 1m 의 화면 px, hits}
 * 몸통(캐비닛·금고·랙·카운터·트레이)은 상자 BA = 배경과 섞는 비율(불투명한 어두운 가구 — 렌더러 solid), 테두리·표시는 선.
 */
export function voxelArtGeometry(book, plans, fx, nowSec, env, geo) {
  geo.begin();
  if (env.hits) env.hits.length = 0;
  const nowMs = env.nowMs || Date.now();
  const A = styleAlpha(env);
  const BODY = (0.1 + 0.22 * A.B0) * (env.isLight ? 0.9 : 1); // 가구 몸통: 배경과 섞는 비율(기본 0.18 — 어두운 가구)
  const M = litMap(fx, nowSec, env._lm || (env._lm = { fxBy: new Map(), litBy: new Map() }));
  const S = env._fs || (env._fs = {});
  const t = env.reduced ? 0 : nowSec;
  let budget = env.labels === false ? 0 : ARTGEO.LABELS - 3;
  const AC = fx && fx.acts && fx.acts.list.length ? fx.acts : null;
  const AP = env._ap || (env._ap = new ActPos()); AP.begin();
  const want = AC ? AC.keys(book) : null;
  for (const [pid, P] of plans) {
    if (!geo.pidStart(env, pid)) continue; // 프로젝트 페이드
    const F = P.F, k = F.xf ? quarter(F.xf.k) : 0, odd = k % 2 === 1;
    const W = (lx, lz) => (F.xf ? toWorld(F.xf, lx, lz) : { x: lx, z: lz });
    if (AC) { // 검색 손전등이 훑을 서가 줄 + 방 가운데
      const b0 = P.bays[0], b1 = P.bays[P.bays.length - 1], rb = P.room.bounds;
      AP.areas.set(pid, { x: (rb.minX + rb.maxX) / 2, y: 0.02, z: (rb.minZ + rb.maxZ) / 2, r: Math.max(rb.maxX - rb.minX, rb.maxZ - rb.minZ) / 2,
        ...(b0 ? { sx0: b0.x, sz0: b0.z, sx1: b1.x, sz1: b1.z } : {}) });
    }
    // 지역 좌표 그리기 도우미(돌린 방이면 세계로)
    const L = (x0, y0, z0, x1, y1, z1, c, a, w = 1) => { const p = W(x0, z0), q = W(x1, z1); geo.line(p.x, y0, p.z, q.x, y1, q.z, c, a, w); };
    const BX = (x, y, z, sx, sy, sz, c, a, ref) => { const p = W(x, z); geo.box(p.x, y, p.z, odd ? sz : sx, sy, odd ? sx : sz, c, a, ref); };
    const RECT = (x0, y, z0, x1, z1, c, a) => { L(x0, y, z0, x1, y, z0, c, a); L(x1, y, z0, x1, y, z1, c, a); L(x1, y, z1, x0, y, z1, c, a); L(x0, y, z1, x0, y, z0, c, a); };
    const FRONT = (x0, y0, x1, y1, z, c, a) => { L(x0, y0, z, x1, y0, z, c, a); L(x1, y0, z, x1, y1, z, c, a); L(x1, y1, z, x0, y1, z, c, a); L(x0, y1, z, x0, y0, z, c, a); };
    const upx = env.unitPx ? env.unitPx(pid) : 20;
    const far = upx < 4, detail = upx >= 10;
    const foot = env.foot && env.foot.pid === pid ? env.foot.set : null;
    const footDim = foot ? 0.5 : 1;
    // ── 서가(파일): 칸마다 몸통 + 앞면 테두리 + 서랍 4줄 ──
    const sorted = [...P.bays].sort((a, b) => b.n - a.n);
    const named = new Set(sorted.slice(0, 4).map((b) => b.i));
    for (const b of P.bays) {
      const bw = VXA.BAY_W - 0.1, bd = VXA.BAY_D, bh = VXA.BAY_H, fz = b.lz + bd / 2;
      BX(b.lx, bh / 2, b.lz, bw, bh, bd, KI.file, BODY, null);
      const la = A.LINE_A * 0.8 * footDim;
      FRONT(b.lx - bw / 2, 0.05, b.lx + bw / 2, bh, fz, KI.file, la);
      if (!far) for (let r = 1; r < VXA.DRAWERS + 1; r++) L(b.lx - bw / 2, 0.2 + r * 0.55 - 0.02, fz, b.lx + bw / 2, 0.2 + r * 0.55 - 0.02, fz, KI.file, la * 0.7);
      // 칸 채움 정도(넘침 포함): 위 모서리 눈금
      const fill = Math.min(1, (b.n) / PER_BAY);
      L(b.lx - bw / 2, bh + 0.03, fz, b.lx - bw / 2 + bw * fill, bh + 0.03, fz, KI.zone, la * 0.9);
      if (!far && named.has(b.i) && budget > 0) { const p = W(b.lx, b.lz); geo.label(p.x, bh + 0.35, p.z, b.over ? `${b.label} +${b.over}` : b.label, 'art-zone', 'zone', 0.5); budget--; }
    }
    // ── 금고실(DB) ──
    const sp = P.spots;
    if (P.has.db) {
      const v = sp.vault, la = A.LINE_A * footDim;
      BX(v.x, 0.03, v.z, v.w, 0.06, v.d, KI.db, BODY * 0.8, null);
      for (const sy of [0.04, v.h]) RECT(v.x - v.w / 2, sy, v.z - v.d / 2, v.x + v.w / 2, v.z + v.d / 2, KI.db, la * (sy > 1 ? 0.9 : 0.5));
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) L(v.x + (sx * v.w) / 2, 0, v.z + (sz * v.d) / 2, v.x + (sx * v.w) / 2, v.h, v.z + (sz * v.d) / 2, KI.db, la * 0.8);
      // 둥근 금고문(앞면, 바퀴살) — 쓰기 때 돎
      let spin = 0;
      for (const [id, s] of P.slots) if (s.k === 'db') { const f = M.fxBy.get(pid + '|' + id); if (f) spin = Math.max(spin, fxState(f, nowSec, env.reduced, S).spin); }
      const dz = v.z + v.d / 2 + 0.02, dy = 1.2, dr = 0.55, ph = spin * 4;
      for (let q = 0; q < 16; q++) { const a0 = (q / 16) * Math.PI * 2, a1 = ((q + 1) / 16) * Math.PI * 2; L(v.x + Math.cos(a0) * dr, dy + Math.sin(a0) * dr, dz, v.x + Math.cos(a1) * dr, dy + Math.sin(a1) * dr, dz, KI.db, la); }
      for (let q = 0; q < 3; q++) { const aa = ph + (q * Math.PI) / 3; L(v.x - Math.cos(aa) * dr * 0.7, dy - Math.sin(aa) * dr * 0.7, dz, v.x + Math.cos(aa) * dr * 0.7, dy + Math.sin(aa) * dr * 0.7, dz, KI.db, la * 0.7); }
    }
    // ── 결재함 받침(산출물) · 택배 창구(원격) ──
    if (P.has.output) { const tr = sp.tray; BX(tr.x, tr.h / 2, tr.z, tr.w, tr.h, tr.d, KI.output, BODY, null); FRONT(tr.x - tr.w / 2, 0.02, tr.x + tr.w / 2, tr.h, tr.z + tr.d / 2, KI.output, A.LINE_A * 0.7 * footDim); }
    if (P.has.remote) {
      const c = sp.counter, la = A.LINE_A * 0.8 * footDim;
      BX(c.x, c.h / 2, c.z, c.w, c.h, c.d, KI.remote, BODY, null);
      FRONT(c.x - c.w / 2, 0.02, c.x + c.w / 2, c.h, c.z + c.d / 2, KI.remote, la);
      FRONT(c.x - c.w / 2 + 0.1, c.h + 0.1, c.x + c.w / 2 - 0.1, c.h + 1.0, c.z - c.d / 2 + 0.05, KI.remote, la * 0.6); // 창구 틀
      L(c.x - c.w / 2 + 0.1, c.h + 0.75, c.z - c.d / 2 + 0.05, c.x + c.w / 2 - 0.1, c.h + 0.75, c.z - c.d / 2 + 0.05, KI.remote, la * 0.4);
    }
    // ── 대상 하나씩 ──
    for (const [id, s] of P.slots) {
      const it = book.get(pid, id);
      if (!it) continue;
      const fr = freshness(nowMs - (it.last || 0));
      const key = pid + '|' + id;
      const lit = M.litBy.get(key) || 0;
      const sel = !!(env.hover && env.hover.pid === pid && env.hover.id === id);
      const dim = foot ? (foot.has(id) ? 1.6 : 0.3) : 1;
      const { la } = itemAlpha(A, fr, dim, lit, sel, env.isLight);
      const fxs = M.fxBy.get(key) || null;
      const st = fxState(fxs, nowSec, env.reduced, S);
      const col = it.del ? KI.del : KI[it.k] ?? KI.file;
      const ref = { pid, id };
      const lx = s.lx, lz = s.lz;
      let top = 1.6, ay = s.y;
      if (far) {
        if (lit > 0.05 || it.imp) { const p = W(lx, lz); geo.dot(p.x, s.y, p.z, 0.3, it.imp ? KI.imp : col, Math.max(la, 0.5 * lit + 0.2)); }
        continue;
      }
      if (s.k === 'file') {
        // 서랍 앞 탭: 하위 종류 = 탭 모양(코드 가늘고 긴 · 문서 넓고 낮은 + 접힌 귀 · 데이터 가로 두 줄 · 이미지 대각 · 계획 가로 두루마리)
        const sub = it.del ? 'del' : fileSub(it);
        const out = 0.22 * st.pulse + (lit > 0.3 ? 0.06 : 0);                 // 고칠 때 서랍이 열림(탭이 앞으로)
        const drop = (1 - st.hk) * 0.7;                                        // 새 파일: 위에서 꽂힘
        const shrink = 1 - st.gone;
        let tw = 0.075, th = 0.3;
        if (sub === 'doc') { tw = 0.11; th = 0.22; } else if (sub === 'data') { tw = 0.1; th = 0.26; } else if (sub === 'image') { tw = 0.1; th = 0.2; } else if (sub === 'plan') { tw = 0.12; th = 0.09; } else if (sub === 'del') { tw = 0.08; th = 0.08; }
        th *= shrink; const y0 = s.ly - 0.18 + drop, y1 = y0 + th, z = lz + out;
        const c = st.gone ? KI.del : col;
        BX(lx, (y0 + y1) / 2, z - 0.03, tw, Math.max(0.02, th), 0.05, c, BODY * 1.4 + (env.isLight ? 0.6 : 0.35) * lit, ref); // 라이트도 점등한 탭은 잉크 색 쪽으로
        if (detail || lit > 0.05 || sel) {
          FRONT(lx - tw / 2, y0, lx + tw / 2, y1, z, c, la);
          if (detail) {
            if (sub === 'doc') L(lx + tw / 2 - 0.04, y1, z, lx + tw / 2, y1 - 0.04, z, c, la);
            else if (sub === 'data') { L(lx - tw / 2, y0 + th * 0.4, z, lx + tw / 2, y0 + th * 0.4, z, c, la * 0.7); L(lx - tw / 2, y0 + th * 0.7, z, lx + tw / 2, y0 + th * 0.7, z, c, la * 0.7); }
            else if (sub === 'image') L(lx - tw / 2, y0, z, lx + tw / 2, y1, z, c, la * 0.7);
          }
        }
        top = VXA.BAY_H + 0.45; ay = (y0 + y1) / 2;
      } else if (s.k === 'db') {
        // 서버랙: 몸통 + 앞면 표시등(수위 = 쓰기 누적, 쓰기 순간 위로 훑음) + 컬렉션 눈금
        const rw = 0.7, rd = 0.8, rh = 1.9, fz = lz + rd / 2 + 0.01, c = col;
        BX(lx, rh / 2, lz, rw, rh, rd, c, BODY * 1.2, ref);
        FRONT(lx - rw / 2, 0.02, lx + rw / 2, rh, fz, c, la);
        const n = Math.max(1, Math.round(dbLevel(it) * 8)), sweep = st.spin > 0 ? Math.floor((1 - st.spin) * 10) : -1;
        for (let q = 0; q < 8; q++) { const on = q < n, yy = 0.2 + q * 0.2; L(lx - rw * 0.35, yy, fz, lx - rw * 0.35 + rw * (on ? 0.5 : 0.18), yy, fz, q === sweep ? KI.write : c, on ? la * 0.9 + (q === sweep ? 0.4 : 0) : la * 0.35); }
        const nc = Math.min(6, (it.coll || []).length);
        for (let q = 0; q < nc; q++) L(lx + rw * 0.3, 0.3 + q * 0.25, fz, lx + rw * 0.4, 0.3 + q * 0.25, fz, c, la * 0.7);
        top = rh + 0.5; ay = 1.2;
      } else if (s.k === 'service') {
        // 벽 전화(상자) + 안테나 기둥 + 꼭대기 점선 고리(신호). 호출 때 신호 고리가 퍼짐
        const c = col, y = 1.35;
        BX(lx, y, lz, 0.18, 0.42, 0.32, c, BODY * 1.3, ref);
        { const p = W(lx, lz); boxEdges(geo, p.x, y, p.z, odd ? 0.16 : 0.09, 0.21, odd ? 0.09 : 0.16, c, la); }
        L(lx, y + 0.21, lz, lx, 3.0, lz, c, la * 0.8);
        L(lx, 2.6, lz - 0.18, lx, 2.6, lz + 0.18, c, la * 0.6);
        const p = W(lx, lz), r = 0.22 * (1 + 1.4 * st.pulse);
        geo.ring(p.x, 3.0, p.z, r, c, la * (1 - 0.5 * st.pulse), 14, true, t * 0.6);
        if ((upx > 14 || lit > 0.05 || sel) && budget > 0) { geo.label(p.x, 3.3, p.z, String(it.n || '?').slice(0, 1).toUpperCase(), 'art-glyph', 'service', Math.max(0.5, la)); budget--; }
        top = 3.6; ay = y;
      } else if (s.k === 'repo') {
        // git 우편함: 기둥 + 함(상자) + 깃발(최근 push·점등이면 올림) + 편지 눈금(push·쓰기 수)
        const c = col, by = 1.05, bw = 0.34, bd = 0.55, bh = 0.32;
        L(lx, 0, lz, lx, by - bh / 2, lz, c, la * 0.8);
        BX(lx, by, lz, bw, bh, bd, c, BODY * 1.3, ref);
        { const p = W(lx, lz); boxEdges(geo, p.x, by, p.z, odd ? bd / 2 : bw / 2, bh / 2, odd ? bw / 2 : bd / 2, c, la); }
        const recent = lit > 0.05 || st.spin > 0 || (it.cnt?.push && nowMs - (it.last || 0) < 10 * 60_000);
        const fx0 = lx + bw / 2 + 0.02, fy = recent ? by + bh / 2 + 0.35 : by;
        L(fx0, by - 0.1, lz - 0.1, fx0, fy, lz - 0.1, c, la * 0.9);
        L(fx0, fy, lz - 0.1, fx0, fy - 0.12, lz + 0.1, recent ? KI.write : c, la * 0.9);
        const ticks = Math.min(8, Math.max(1, (it.cnt?.push || 0) * 2 + (it.cnt?.write || 0)));
        for (let q = 0; q < ticks; q++) L(lx - bw / 2 + 0.04, by + bh / 2 + 0.02 + q * 0.035, lz - bd / 2 + 0.06 + ((q * 0.06 + st.spin * 0.3) % (bd - 0.12)), lx + bw / 2 - 0.04, by + bh / 2 + 0.02 + q * 0.035, lz - bd / 2 + 0.06 + ((q * 0.06 + st.spin * 0.3) % (bd - 0.12)), c, la * 0.5);
        top = by + 0.9; ay = by;
      } else if (s.k === 'remote') {
        // 택배 상자(창구 위) + 창구에서 바깥으로 뻗는 점선(배송 경로, 멀수록 사라짐)
        const c = col, b = 0.15;
        BX(lx, s.ly, lz, b * 2, b * 2, b * 2, c, BODY * 1.3, ref);
        { const p = W(lx, lz); boxEdges(geo, p.x, s.ly, p.z, b, b, b, c, la); geo.line(p.x - (odd ? 0 : b), s.ly + b, p.z - (odd ? b : 0), p.x + (odd ? 0 : b), s.ly + b, p.z + (odd ? b : 0), c, la * 0.6); }
        for (let q = 0; q < 6; q++) { const d0 = 0.5 + q * 0.6, d1 = d0 + 0.3; L(lx, 0.05, lz + d0, lx, 0.05, lz + d1, c, la * (1 - q / 6) * 0.8); }
        top = s.ly + 0.7; ay = s.ly;
      } else if (s.k === 'output') {
        // 결재함 트레이 + 서류 한 장(만들 때 솟았다가 내려앉음, 꼭짓점 반짝)
        const c = col, ty = s.y, lift = st.rise * 1.1;
        BX(lx, ty, lz, 0.64, 0.05, 0.46, c, BODY * 1.2, ref);
        RECT(lx - 0.32, ty + 0.03, lz - 0.23, lx + 0.32, lz + 0.23, c, la * 0.8);
        RECT(lx - 0.24, ty + 0.06 + lift, lz - 0.17, lx + 0.24, lz + 0.17, c, la);
        if (st.rise > 0 && !env.reduced) { const p = W(lx + 0.24, lz - 0.17); geo.dot(p.x, ty + 0.06 + lift, p.z, 0.2, KI.new, st.rise); }
        if ((lit > 0.05 || sel || upx > 22) && budget > 0 && !String(id).startsWith('artifact:')) { const p = W(lx, lz); geo.label(p.x, ty + 0.4 + lift, p.z, extOf(it.n || it.id) || 'OUT', 'art-ext', 'output', Math.max(0.45, la)); budget--; }
        top = 1.5; ay = ty + 0.1;
      }
      const p = W(lx, lz);
      if (want && want.has(key)) { // 연출 기준점(앞 방향 = 방 지역 +z 를 세계로)
        const R = AP.put(key, p.x, ay, p.z, s.k === 'file' ? ay + 0.15 : ay + 0.25, 0.02, s.k === 'file' ? 0.5 : 0.9);
        const q = W(lx, lz + 1); R.fx = q.x - p.x; R.fz = q.z - p.z; R.ox = R.fx; R.oz = R.fz;
      }
      if (it.imp) shield(geo, p.x, top, p.z, la, 0.2);
      if (it.x && it.x !== 'overwrite' && nowMs - (it.xAt || 0) < ART.ALARM_MS) geo.ring(p.x, 0.04, p.z, 0.6, KI.alarm, 0.45 + 0.4 * lit, 20);
      if ((sel || lit > 0.3) && budget > 0) { geo.label(p.x, top + 0.3, p.z, it.n || it.id, 'art-item', it.k, sel ? 1 : Math.min(1, lit + 0.2)); budget--; }
      beams(geo, it, env, foot, lit, nowMs, A.LINE_A, p.x, ay, p.z);
      commonFx(geo, fxs, env, nowSec, { x: p.x, y: ay, z: p.z, Y0: 0.02, C: 1.2, sk: 0.6, paper: true, ring: true, acts: !!(fx && fx.acts) });
      if (fxs) for (const e of fxs) if (e.kind === 'absorb') { // push: 서가 탭에서 우편함으로 서류가 날아감
        const kk = Math.max(0, (nowSec - e.t0) / e.dur); if (kk >= 1) continue;
        let q = 0;
        for (const [, fs] of P.slots) {
          if (q >= (e.amp || 3)) break;
          if (fs.k !== 'file') continue;
          const u = ease(Math.min(1, Math.max(0, kk * 1.4 - q * 0.08))); q++;
          if (u <= 0 || u >= 1) continue;
          geo.box(fs.x + (p.x - fs.x) * u, fs.y + (ay - fs.y) * u + Math.sin(u * Math.PI) * 1.2, fs.z + (p.z - fs.z) * u, 0.3, 0.03, 0.22, KI.repo, 0.9, null);
        }
      }
      if (env.hits) env.hits.push({ pid, id, x: p.x, y: ay, z: p.z, r: 0.35 });
    }
    if (P.over.file && P.bays.length) { /* 넘친 탭 수는 칸 라벨(+n)로 */ }
  }
  geo.ka = 1;
  if (AC) drawActs(geo, AC, nowSec, { theme: 'voxel', unitPx: env.unitPx || null, KI, pos: AP, zoneOf: null, book, nodePos: env.nodePos, reduced: env.reduced, isLight: env.isLight, pidAlpha: env.pidAlpha || null }); // 장면도 프로젝트 페이드
  return geo;
}
