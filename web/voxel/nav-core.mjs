// 복셀 오피스 길찾기 — 순수 함수, three·DOM 없음. 3D(character.js)·2D 평면도(flat/voxel2d.js)·바닥 조명 라인이 같이 쓴다.
//
// 방마다 가구·벽을 축 정렬 상자(장애물)로 모아 0.2 칸 격자를 한 번 만들고(방 객체에 캐시, 원점 기준 상대 좌표라 이사 보간·평행 이동에도 그대로),
// 4방향 A*(꺾일 때 벌점)로 통로만 따라 가로·세로 꺾은선을 낸다. 돌린 방은 돌리기 전 좌표(room.local)에서 찾고 결과만 돌린다.
//   · 칸이 '빈 칸' = 칸 정사각형 전체가 모든 상자에서 R 이상 떨어짐 → 칸 줄 안 어디로 걸어도 가구·벽과 R 이상(구간 단위로 보장)
//   · 첫 구간은 출발점, 마지막 구간은 도착점의 좌표를 그대로 써서(같은 칸 띠 안) 끝점이 정확히 맞는다
//   · 출발점이 막힌 칸이면(밀어내기로 가구 곁에 섬) 가장 가까운 빈 칸으로 먼저 나오고, 도착점이 막힌 칸이면(가구 안 목표) 그 가구 앞 빈 칸(접근점)에서 멈춘다
//   · 결정적: 같은 방·같은 끝점이면 늘 같은 길(힙 동률은 h → 넣은 순서). 결과는 방 캐시에 끝점 열쇠로 저장(목적지가 바뀔 때만 계산)
// 라운지는 방 밖이라 라운지 둘레(라운지 가구 + 주변 방 상자)로 같은 격자를 따로 만든다(loungeNav·loungePath).
import { OFFICE_FX } from './office-core.mjs';
import { BAY, bayLocal, bayLine, PALLET } from './vx-proc-core.mjs';
import { BATCH } from '../batch-core.mjs';
import { quarter, rotXZ } from './xf.mjs';

export const NAV = {
  CELL: 0.2,     // 격자 칸(m)
  OFF: 0.0137,   // 칸 경계 어긋남(자리 좌표 0.1 배수가 칸 경계에 걸려 부동소수 오차로 칸이 바뀌지 않게)
  R: 0.2,        // 몸 반지름(가구·벽과 떨어질 거리)
  MARGIN: 1.4,   // 방 경계 밖 격자 여유(문 밖 자리 door.out = 0.8)
  TURN: 3,       // 꺾일 때 벌점(칸) — 지그재그 대신 긴 직선
  SNAP: 20,      // 막힌 끝점에서 빈 칸 찾는 반경(칸)
  MAX_EXP: 400000, // A* 펼침 상한(넘으면 null → 예전 꺾은선)
  CACHE: 400,    // 방마다 길 캐시
  BIG_N: 40000,  // 이보다 칸이 많은 격자(복셀 연구소 ~290×290)는 가중 A*
  BIG_W: 1.6,    // 가중치
  SOFT: 4,       // 비싼 칸(softAt) 걸음 벌점
};
const T = 0.12; // 벽 두께(props.js buildRoomStatic)

const box = (cx, cz, w, d, kind) => ({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, kind });
const span = (x0, x1, z0, z1, kind) => ({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), kind });

/** 돌린 방이면 돌리기 전 사본(가구·길은 이 좌표로) */
export const navBase = (room) => (room && room.xf && quarter(room.xf.k) && room.local ? room.local : room);

/**
 * 방 장애물 = 축 정렬 상자 [{minX,maxX,minZ,maxZ,kind}] — 돌리기 전 좌표(navBase(room) 의 세계값).
 * props.js 가 그리는 바닥 가구(높이 0.3 넘는 것)와 네 벽(앞 벽 출입문만 틈 — 뒷문·옆문은 사람이 쓰지 않음)을 그대로 옮겼다.
 * 대기석 벤치·발송대 바닥판·매트(높이 0.1 이하)·벽걸이(보드·스크린)는 넣지 않는다.
 */
export function roomObstacles(room) {
  const base = navBase(room);
  if (!base || !base.origin || !base.bounds) return [];
  if (base.type === 'lab') return base.navBoxes || []; // 복셀 연구소(web/lab/lab-layout-core.mjs computeLab): 원형 연구동 장애물을 배치가 미리 계산
  const o = base.origin, b = base.bounds, out = [];
  const x0 = b.minX, x1 = b.maxX, zb = b.minZ, zf = b.maxZ;
  // 벽
  out.push(span(x0 - T, x1 + T, zb - T, zb, 'wall'));
  out.push(span(x0 - T, x0, zb - T, zf + T, 'wall'));
  out.push(span(x1, x1 + T, zb - T, zf + T, 'wall'));
  const dx = base.door ? base.door.x : o.x, G = 0.75; // 문틀 기둥 ±0.8(폭 0.1) → 틈 1.5
  out.push(span(x0 - T, dx - G, zf, zf + T, 'wall'));
  out.push(span(dx + G, x1 + T, zf, zf + T, 'wall'));
  if (base.type === 'office') {
    const F = OFFICE_FX, ext = base.ext || 0;
    if (base.leadDesk) out.push(box(base.leadDesk.x, base.leadDesk.z, 2.0, 0.9, 'leadDesk'));
    for (const d of base.desks || []) out.push(box(d.x, d.z, d.aux ? 1.1 : 1.3, 0.7, 'desk'));
    out.push(box(o.x + F.pantry.x, o.z + F.pantry.z, 0.76, F.pantry.len + 0.06, 'pantry'));
    out.push(span(o.x + F.shelf.x - 0.46, o.x + F.shelf.x + 0.15, o.z + F.shelf.z0 - 0.04, o.z + F.shelf.z1 + 0.04, 'bookshelf'));
    out.push(span(o.x - 11.92, o.x - 11.18, o.z + F.archive.z - 0.72, o.z + F.archive.z + 0.72, 'cabinet'));
    out.push(span(o.x + F.vault.x - 0.41, o.x + F.vault.x + 0.38, o.z + F.vault.z - 0.7, o.z + F.vault.z + 0.7, 'vault'));
    out.push(box(o.x - 9, zb + 0.55, 1.2, 0.6, 'toolbox'));
    out.push(box(o.x + 11.75, o.z - 3.0, 0.5, 6.4, 'monitorWall'));
    out.push(span(o.x + F.conveyor.x - 0.34, o.x + F.conveyor.x + 0.74, o.z + F.conveyor.z0 - 0.02, o.z + F.conveyor.z1 + 0.02, 'conveyor'));
    out.push(span(o.x + 11.0, o.x + 12.0, o.z + F.booth.z - 0.83, o.z + F.booth.z + 0.83, 'booth'));
    if (base.portal) out.push(box(base.portal.x, base.portal.z, 2.4, 0.9, 'portal'));
    if (base.bell) out.push(box(base.bell.x, base.bell.z, 0.5, 0.5, 'bell'));
    for (const [px, pz] of [[11.1, -8.2], [-11.1, 8.3 + ext], [-7.4, -8.4]]) out.push(box(o.x + px, o.z + pz, 0.66, 0.66, 'plant'));
    const K = BATCH.DEVICE_K;
    for (const m of base.batches || []) out.push(span(m.x - 0.83 * K, m.x + 0.83 * K, m.z - 0.53 * K, m.z + 0.71 * K, 'batch')); // 복합기 + 앞 출력 받침
    for (const m of base.racks || []) out.push(span(m.x - 0.42, m.x + 0.42, m.z - 0.42, m.z + 0.43, 'rack'));
    for (const m of base.screens || []) if (m.x < o.x + 11.4) out.push(box(m.x, m.z, 0.12, 1.44, 'screen')); // 틀 밖으로 나온 둘째 열 화면
    for (const slot of base.bays || []) { // 생산 라인: 기계 몸통 ~ 컨베이어 ~ 팔레트
      const L = bayLocal(slot), mx = o.x + L.x, mz = o.z + L.z, ln = bayLine(mx, slot);
      out.push(span(mx - ln.dir * BAY.MW / 2, ln.px + ln.dir * (PALLET.W / 2 + 0.05), mz - 0.75, mz + 0.75, 'bay'));
    }
  } else {
    const zb6 = o.z - 6;
    for (const t of base.tables || []) out.push(box(t.x, t.z, 11.0, 1.2, 'table'));
    out.push(span(o.x - 7.5 - 0.46, o.x - 7.5 + 0.15, zb6 + 1.16, zb6 + 3.24, 'bookshelf'));
    out.push(span(o.x - 7.92, o.x - 7.18, o.z + 1.7 - 0.72, o.z + 1.7 + 0.72, 'cabinet'));
    out.push(box(o.x - 5, zb6 + 0.55, 1.2, 0.6, 'toolbox'));
    out.push(box(o.x + 7.2, zb6 + 0.6, 0.66, 0.66, 'plant'));
    if (base.board) out.push(span(base.board.x - 1.7, base.board.x + 1.7, zb6, zb6 + 0.33, 'board'));
  }
  return out;
}

/** 라운지 장애물(세계): 소파 둘·탁자·큰 화분 넷·스탠드 조명 둘·서류 캐비닛 + 둘레 방(벽 포함 상자) — props.js buildLounge 와 같은 치수 */
export function loungeObstacles(lg, rooms = []) {
  const out = [];
  const cx = (lg.minX + lg.maxX) / 2, cz = (lg.minZ + lg.maxZ) / 2, w = lg.maxX - lg.minX, d = lg.maxZ - lg.minZ;
  for (const s of [-1, 1]) {
    const x = cx + s * (w / 2 - 1.5);
    out.push(span(x - 0.52, x + 0.52, cz + 1.4 - 1.63, cz + 1.4 + 1.63, 'sofa'));
    const lx = cx + s * (w / 2 - 1.5), lz = cz + d / 2 - 0.6;
    out.push(box(lx, lz, 0.4, 0.4, 'lamp'));
  }
  out.push(box(cx, cz + 2.0, 2.4, 1.1, 'table'));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box(cx + sx * (w / 2 - 0.55), cz + sz * (d / 2 - 0.55), 0.66, 0.66, 'plant'));
  if (lg.cabinet) out.push(span(lg.cabinet.x - 1.23, lg.cabinet.x + 1.23, lg.cabinet.z - 0.43, lg.cabinet.z + 0.46, 'cabinet'));
  for (const r of rooms) if (r && r.bounds) out.push(span(r.bounds.minX - T, r.bounds.maxX + T, r.bounds.minZ - T, r.bounds.maxZ + T, 'room'));
  return out;
}

// ───────────── 격자 ─────────────
/** boxes(세계) · area(세계 범위) · (ox, oz) = 상대 좌표 기준(방 원점) → nav. 칸 경계는 기준점에서 CELL 배수 + OFF */
export function buildNav(boxes, area, ox = 0, oz = 0, softAt = null) {
  const C = NAV.CELL, off = NAV.OFF;
  const gx0 = Math.floor((area.minX - ox - off) / C) * C + off, gz0 = Math.floor((area.minZ - oz - off) / C) * C + off;
  const nx = Math.max(1, Math.ceil((area.maxX - ox - gx0) / C)), nz = Math.max(1, Math.ceil((area.maxZ - oz - gz0) / C));
  const blocked = new Uint8Array(nx * nz);
  const e = NAV.R + C / 2; // 칸 정사각형 전체가 R 밖이려면 칸 중심이 상자 + (R + 반 칸) 밖
  const rel = [];
  for (const b of boxes) {
    const r = { minX: b.minX - ox, maxX: b.maxX - ox, minZ: b.minZ - oz, maxZ: b.maxZ - oz, kind: b.kind };
    rel.push(r);
    const i0 = Math.max(0, Math.floor((r.minX - e - gx0) / C - 0.5) + 1), i1 = Math.min(nx - 1, Math.ceil((r.maxX + e - gx0) / C - 0.5) - 1);
    const j0 = Math.max(0, Math.floor((r.minZ - e - gz0) / C - 0.5) + 1), j1 = Math.min(nz - 1, Math.ceil((r.maxZ + e - gz0) / C - 0.5) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blocked[j * nx + i] = 1;
  }
  // softAt(세계 x, z) → true 인 칸 = 비싼 칸(걸음마다 NAV.SOFT 더함) — 복셀 연구소 브리지 덱·경사로
  let soft = null;
  if (softAt) {
    soft = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (!blocked[j * nx + i] && softAt(gx0 + (i + 0.5) * C + ox, gz0 + (j + 0.5) * C + oz)) soft[j * nx + i] = 1;
  }
  return { nx, nz, gx0, gz0, blocked, soft, boxes: rel, cache: new Map() };
}

const cx_ = (nav, i) => nav.gx0 + (i + 0.5) * NAV.CELL;
const cz_ = (nav, j) => nav.gz0 + (j + 0.5) * NAV.CELL;
const cellOf = (nav, x, z) => {
  const i = Math.floor((x - nav.gx0) / NAV.CELL), j = Math.floor((z - nav.gz0) / NAV.CELL);
  return i < 0 || j < 0 || i >= nav.nx || j >= nav.nz ? -1 : j * nav.nx + i;
};
/** 막힌 칸이면 가장 가까운 빈 칸(칸 거리 BFS 대신 반경 고리 — 유클리드 가까운 것, 같으면 번호 작은 것) */
function nearestFree(nav, x, z) {
  const c = cellOf(nav, x, z);
  if (c >= 0 && !nav.blocked[c]) return c;
  const fi = (x - nav.gx0) / NAV.CELL - 0.5, fj = (z - nav.gz0) / NAV.CELL - 0.5;
  const ci = Math.round(fi), cj = Math.round(fj);
  let best = -1, bd = Infinity;
  for (let r = 0; r <= NAV.SNAP; r++) {
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
      if (i < 0 || j < 0 || i >= nav.nx || j >= nav.nz) continue;
      const k = j * nav.nx + i;
      if (nav.blocked[k]) continue;
      const d = (i - fi) * (i - fi) + (j - fj) * (j - fj);
      if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && k < best)) { bd = d; best = k; }
    }
    if (best >= 0 && Math.sqrt(bd) < r + 0.5) break; // 다음 고리는 더 멂
  }
  return best;
}

// 방향: 0 +x, 1 -x, 2 +z, 3 -z
const DI = [1, -1, 0, 0], DJ = [0, 0, 1, -1];

/** 칸 s → 칸 g 4방향 A*(꺾임 벌점). 칸 번호 배열 또는 null */
function astar(nav, s, g) {
  if (s === g) return [s];
  const { nx, nz, blocked, soft } = nav, N = nx * nz;
  const gi = g % nx, gj = (g / nx) | 0;
  // 작업 배열은 격자마다 한 번만 만들고 세대 번호로 비운 것처럼 씀(큰 격자 — 연구소 ~290×290 — 에서 매번 수 MB 할당·채우기 없앰)
  let S = nav._scratch;
  if (!S || S.n !== N * 4) S = nav._scratch = { n: N * 4, G: new Float64Array(N * 4), P: new Int32Array(N * 4), mark: new Uint32Array(N * 4), gen: 0 };
  if (++S.gen >= 0x7ffffff0) { S.mark.fill(0); S.gen = 1; }
  const gen = S.gen, Gb = S.G, Pb = S.P, mark = S.mark; // mark: gen*2 = 열림(G·P 유효), gen*2+1 = 닫힘 — 세대마다 2 칸 씀
  const OPEN = gen * 2, CLOSED = gen * 2 + 1;
  // 이진 힙(f, h, 순번)
  const hf = [], hh = [], hs = [], hq = [];
  let seq = 0;
  const less = (a, b) => hf[a] < hf[b] || (hf[a] === hf[b] && (hh[a] < hh[b] || (hh[a] === hh[b] && hq[a] < hq[b])));
  const swap = (a, b) => { let t = hf[a]; hf[a] = hf[b]; hf[b] = t; t = hh[a]; hh[a] = hh[b]; hh[b] = t; t = hs[a]; hs[a] = hs[b]; hs[b] = t; t = hq[a]; hq[a] = hq[b]; hq[b] = t; };
  const push = (f, h, st) => {
    let i = hf.length; hf.push(f); hh.push(h); hs.push(st); hq.push(seq++);
    while (i > 0) { const p = (i - 1) >> 1; if (!less(i, p)) break; swap(i, p); i = p; }
  };
  const pop = () => {
    const st = hs[0], last = hf.length - 1;
    if (last > 0) { hf[0] = hf[last]; hh[0] = hh[last]; hs[0] = hs[last]; hq[0] = hq[last]; }
    hf.pop(); hh.pop(); hs.pop(); hq.pop();
    let i = 0;
    for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hf.length && less(l, m)) m = l; if (r < hf.length && less(r, m)) m = r; if (m === i) break; swap(i, m); i = m; }
    return st;
  };
  // 큰 격자(연구소)는 가중 A*(h × BIG_W) — 펼침을 크게 줄이고 길은 그대로 장애물 밖(조금 덜 짧을 수 있음). 사무실 크기 격자는 그대로
  const hw = N > NAV.BIG_N ? NAV.BIG_W : 1;
  const H = (c) => { const i = c % nx, j = (c / nx) | 0, di = Math.abs(i - gi), dj = Math.abs(j - gj); return (di + dj + (di && dj ? NAV.TURN : 0)) * hw; };
  const hs0 = H(s);
  for (let d = 0; d < 4; d++) { const st = s * 4 + d; Gb[st] = 0; Pb[st] = -1; mark[st] = OPEN; push(hs0, hs0, st); }
  let exp = 0, goal = -1;
  while (hf.length) {
    const st = pop();
    if (mark[st] === CLOSED) continue;
    mark[st] = CLOSED;
    const c = st >> 2, d = st & 3;
    if (c === g) { goal = st; break; }
    if (++exp > NAV.MAX_EXP) return null;
    const i = c % nx, j = (c / nx) | 0, g0 = Gb[st];
    for (let e = 0; e < 4; e++) {
      if ((d ^ e) === 1 && (d >> 1) === (e >> 1)) continue; // 되돌아가기 없음
      const ii = i + DI[e], jj = j + DJ[e];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const cc = jj * nx + ii;
      if (blocked[cc]) continue;
      const ns = cc * 4 + e;
      if (mark[ns] === CLOSED) continue;
      const ng = g0 + 1 + (e !== d && c !== s ? NAV.TURN : 0) + (soft && soft[cc] ? NAV.SOFT : 0);
      if (mark[ns] < OPEN || ng < Gb[ns]) { Gb[ns] = ng; Pb[ns] = st; mark[ns] = OPEN; const h = H(cc); push(ng + h, h, ns); }
    }
  }
  if (goal < 0) return null;
  const cells = [];
  for (let st = goal; st >= 0; st = Pb[st]) { const c = st >> 2; if (cells[cells.length - 1] !== c) cells.push(c); }
  cells.reverse();
  return cells;
}

/** 칸 열 → 가로·세로 꺾은선(첫 구간 = a 좌표, 끝 구간 = b 좌표). a·b 는 첫·끝 칸 안의 점 */
function polyline(nav, cells, a, b) {
  const nx = nav.nx;
  if (cells.length === 1) return dedupe([a, { x: b.x, z: a.z }, b]);
  // 구간(run): 같은 방향 걸음 묶음. axis 'x'(z 고정) / 'z'(x 고정)
  const runs = [];
  for (let k = 1; k < cells.length; k++) {
    const p = cells[k - 1], c = cells[k];
    const axis = (c % nx) !== (p % nx) ? 'x' : 'z';
    if (!runs.length || runs[runs.length - 1].axis !== axis) runs.push({ axis, cell: p });
  }
  // 고정 좌표: 칸 줄 가운데, 첫 구간은 a, 끝 구간은 b
  const fix = runs.map((r) => (r.axis === 'x' ? cz_(nav, (r.cell / nx) | 0) : cx_(nav, r.cell % nx)));
  fix[0] = runs[0].axis === 'x' ? a.z : a.x;
  if (runs.length === 1) { // 한 줄: a 좌표로 가서 끝 칸 안에서 b 로 비켜 섬
    return dedupe(runs[0].axis === 'x' ? [a, { x: b.x, z: a.z }, b] : [a, { x: a.x, z: b.z }, b]);
  }
  fix[runs.length - 1] = runs[runs.length - 1].axis === 'x' ? b.z : b.x;
  const pts = [a];
  for (let k = 0; k < runs.length - 1; k++) {
    const r = runs[k];
    pts.push(r.axis === 'x' ? { x: fix[k + 1], z: fix[k] } : { x: fix[k], z: fix[k + 1] });
  }
  pts.push(b);
  return dedupe(pts);
}

// 복셀 연구소(원형 방): 가로·세로 꺾은선을 시선 직선으로 당긴다 — 대각선 통로가 계단(2D 길 선·바닥 라인·걸음)으로 보이지 않게.
// 직선이 지나는 칸이 모두 빈 칸(칸 전체가 가구·벽에서 R 밖)이고 비싼 칸(브리지 덱·경사로)이 아닐 때만 당긴다(덱·경사로 구간은 격자 길 그대로).
// (11.01. 계단 수리) 덱 위만·경사로 위만처럼 비싼 칸끼리(또는 바닥 칸끼리)만 지나는 직선은 당긴다 — 바닥 ↔ 덱·경사로를 섞어 지나는 직선만 막음
// (덱·경사로 위에서 가로·세로로 꺾이며 좌우로 흔들리던 걸음 없앰. 바닥 ↔ 덱 오르내림은 아래 rampRoute 가 경사로 축으로 곧게 잇는다).
function lineFree(nav, p, q, mix = false) {
  const L = Math.hypot(q.x - p.x, q.z - p.z), n = Math.max(1, Math.ceil(L / (NAV.CELL * 0.25)));
  let s0 = -1;
  for (let i = 0; i <= n; i++) {
    const u = i / n, c = cellOf(nav, p.x + (q.x - p.x) * u, p.z + (q.z - p.z) * u);
    if (c < 0 || nav.blocked[c]) return false;
    if (nav.soft && !mix) { const s = nav.soft[c]; if (s0 < 0) s0 = s; else if (s !== s0) return false; }
  }
  return true;
}
function pull(nav, pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1;) {
    let j = i + 1;
    while (j + 1 < pts.length && lineFree(nav, pts[i], pts[j + 1])) j++;
    out.push(pts[j]); i = j;
  }
  return out;
}

// 복셀 연구소 경사로(계단, 11.01. 수리): 4방향 격자는 45° 기운 경사로(폭 1.8)를 1m 남짓 가로·세로 꺾은선으로 올라
// 걸음이 90° 씩 좌우로 꺾이고 몸이 경사로 폭 안에서 흔들렸다(박사님: "지그재그로 계단을 오르내린다").
// nav.ramps(computeLab room.navRamps, 원점 기준 상대) = 경사로마다 축 {b(바닥 쪽 끝 — 경사로 발치에서 EXT 바깥), t(덱 쪽 끝 — 덱 안 EXT),
// dx·dz(b → t 단위), lo·hi(축 위 실제 경사로 구간), half(반폭)}. 격자 길이 경사로 k 를 지나면
//   a → (들어가는 끝) 격자 길 + 들어가는 끝 → 나가는 끝 곧은 축 + (나가는 끝) → b 격자 길 로 다시 짓는다(끝점이 경사로 위면 그 점에서 축 끝으로 곧게).
// 모든 조각이 막힌 칸을 지나지 않을 때만 쓰고, 아니면 예전 길 그대로(null).
function rampAt(nav, x, z) {
  const rs = nav.ramps;
  for (let k = 0; k < rs.length; k++) {
    const r = rs[k], ex = x - r.b.x, ez = z - r.b.z, t = ex * r.dx + ez * r.dz, l = -ex * r.dz + ez * r.dx;
    if (t >= r.lo && t <= r.hi && Math.abs(l) <= r.half) return k;
  }
  return -1;
}
function rampRoute(nav, cells, a, b, depth) {
  const nx = nav.nx, P = (c) => ({ x: cx_(nav, c % nx), z: cz_(nav, (c / nx) | 0) });
  let i0 = -1, k = -1;
  for (let i = 0; i < cells.length && k < 0; i++) { const p = P(cells[i]); k = rampAt(nav, p.x, p.z); i0 = i; }
  if (k < 0) return null;
  let i1 = i0;
  while (i1 + 1 < cells.length) { const p = P(cells[i1 + 1]); if (rampAt(nav, p.x, p.z) !== k) break; i1++; }
  const R = nav.ramps[k];
  const near = (c) => { const p = P(c); return Math.hypot(p.x - R.b.x, p.z - R.b.z) <= Math.hypot(p.x - R.t.x, p.z - R.t.z) ? R.b : R.t; };
  const E = rampAt(nav, a.x, a.z) === k ? null : near(cells[i0]);
  const X = rampAt(nav, b.x, b.z) === k ? null : near(cells[i1]);
  if (E && X && E === X) return null; // 같은 끝으로 들어갔다 나옴(경사로를 지나지 않음)
  // 축 조각(들어가는 끝 또는 a → 나가는 끝 또는 b)만 새로 그음 — 막힌 칸을 지나면 예전 길. 앞뒤 격자 길은 route_ 가 이미 검사
  const p0 = E || a, p1 = X || b;
  if (!lineFree(nav, p0, p1, true)) return null;
  const out = [];
  if (E) { const p = route_(nav, a, E, depth + 1); if (!p) return null; out.push(...p); } else out.push({ x: a.x, z: a.z });
  if (X) { const p = route_(nav, X, b, depth + 1); if (!p) return null; out.push(...p); } else out.push({ x: b.x, z: b.z });
  return dedupe(out);
}

function dedupe(pts) {
  const r = [];
  for (const p of pts) {
    const l = r[r.length - 1];
    if (!l || Math.abs(l.x - p.x) > 1e-9 || Math.abs(l.z - p.z) > 1e-9) r.push({ x: p.x, z: p.z });
  }
  // 한 줄에 놓인 가운데 점 빼기
  for (let i = r.length - 2; i >= 1; i--) {
    const p = r[i - 1], q = r[i], n = r[i + 1];
    if ((Math.abs(p.x - q.x) < 1e-9 && Math.abs(q.x - n.x) < 1e-9) || (Math.abs(p.z - q.z) < 1e-9 && Math.abs(q.z - n.z) < 1e-9)) r.splice(i, 1);
  }
  return r;
}

const rk = (v) => Math.round(v * 1e4);
/**
 * nav 상대 좌표 a → b 길. 반환 = 상대 좌표 점 배열(복사본) 또는 null(격자 밖·길 없음).
 * 끝점이 막힌 칸이면 가장 가까운 빈 칸 가운데(접근점)에서 끝난다 — 가구 안 목적지는 그 가구 앞.
 */
export function navRoute(nav, a, b) {
  const key = rk(a.x) + ',' + rk(a.z) + '>' + rk(b.x) + ',' + rk(b.z);
  const hit = nav.cache.get(key);
  if (hit !== undefined) { nav.cache.delete(key); nav.cache.set(key, hit); return hit && hit.map((p) => ({ x: p.x, z: p.z })); }
  const res = route_(nav, a, b);
  nav.cache.set(key, res);
  if (nav.cache.size > NAV.CACHE) nav.cache.delete(nav.cache.keys().next().value);
  return res && res.map((p) => ({ x: p.x, z: p.z }));
}
function route_(nav, a, b, depth = 0) {
  const ca = cellOf(nav, a.x, a.z), cb = cellOf(nav, b.x, b.z);
  if (ca < 0 || cb < 0) return null;
  const sa = nav.blocked[ca] ? nearestFree(nav, a.x, a.z) : ca;
  const sb = nav.blocked[cb] ? nearestFree(nav, b.x, b.z) : cb;
  if (sa < 0 || sb < 0) return null;
  const cells = astar(nav, sa, sb);
  if (!cells) return null;
  if (nav.ramps && nav.ramps.length && depth < 4) { const r = rampRoute(nav, cells, a, b, depth); if (r) return r; } // 연구소 경사로: 축을 따라 곧게
  const nx = nav.nx;
  const A = sa === ca ? a : { x: cx_(nav, sa % nx), z: cz_(nav, (sa / nx) | 0) };
  const B = sb === cb ? b : { x: cx_(nav, sb % nx), z: cz_(nav, (sb / nx) | 0) };
  const pts = !nav.pull ? polyline(nav, cells, A, B)
    : nav.soft && cells.every((c) => nav.soft[c]) ? pull(nav, [A, ...cells.slice(1, -1).map((c) => ({ x: cx_(nav, c % nx), z: cz_(nav, (c / nx) | 0) })), B]) // 덱 위만: 칸 가운데 줄로 당김(꺾은선 모서리로 덱 뒤 난간까지 돌아가지 않게 — dedupe 는 한 줄 점을 지우므로 거치지 않음)
    : pull(nav, polyline(nav, cells, A, B));
  if (A !== a) pts.unshift(...(link(nav, A, a) || [{ x: a.x, z: a.z }]).reverse()); // 막힌 칸에서 나옴(짧은 걸음)
  if (B !== b) { const l = link(nav, B, b); if (l) pts.push(...l); } // 끝점이 R 밖이면 칸 가장자리에서 이어 정확히 그 자리, 아니면 접근점에서 멈춤
  return dedupe(pts);
}

/** 점 → 가장 가까운 상자 거리 */
function clearance(nav, x, z) {
  let m = Infinity;
  for (const b of nav.boxes) {
    const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    const d = dx > 0 || dz > 0 ? Math.hypot(dx, dz) : -Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
    if (d < m) m = d;
  }
  return m;
}
const segClear = (nav, p, q, r) => {
  const L = Math.hypot(q.x - p.x, q.z - p.z), n = Math.max(1, Math.ceil(L / 0.04));
  for (let i = 0; i <= n; i++) { const u = i / n; if (clearance(nav, p.x + (q.x - p.x) * u, p.z + (q.z - p.z) * u) < r) return false; }
  return true;
};
/** 빈 칸 가운데 F 에서 막힌 칸 안 점 p 로 가는 가로·세로 이음(p 뒤 점들, p 포함). p 가 가구·벽에서 R 안이거나 이음이 R 안을 지나면 null */
function link(nav, F, p) {
  const r = NAV.R - 1e-6;
  if (clearance(nav, p.x, p.z) < r) return null;
  for (const c of [{ x: p.x, z: F.z }, { x: F.x, z: p.z }]) if (segClear(nav, F, c, r) && segClear(nav, c, p, r)) return [c, { x: p.x, z: p.z }];
  return null;
}

// ───────────── 방 ─────────────
const _rooms = new WeakMap(); // navBase(room) → {sig, nav}
function roomSig(base) {
  const o = base.origin, d = base.door;
  return [base.type, base.ext || 0, (base.bounds.maxX - base.bounds.minX).toFixed(3), (base.bounds.maxZ - base.bounds.minZ).toFixed(3),
    d ? (d.x - o.x).toFixed(3) : '', base.leadDesk ? 1 : 0, (base.desks || []).length, (base.racks || []).length, (base.batches || []).length,
    (base.screens || []).length, (base.bays || []).join('.'), (base.tables || []).length, base.navSig || ''].join('|');
}
/** 방 격자(캐시). 원점 기준 상대 좌표 */
export function roomNav(room) {
  const base = navBase(room);
  if (!base || !base.origin || !base.bounds) return null;
  const sig = roomSig(base);
  const c = _rooms.get(base);
  if (c && c.sig === sig) return c.nav;
  const o = base.origin, b = base.bounds, M = NAV.MARGIN;
  // 복셀 연구소: 배치를 다시 할 때마다(_layoutVer) 방 객체가 새로 나와 WeakMap 이 늘 빗나간다 → 상대 장애물 내용으로 격자·길 캐시를 이어 씀
  const lk = base.type === 'lab' ? labNavKey(base) : null;
  if (lk) {
    const hit = _labNavs.get(lk);
    if (hit) { _labNavs.delete(lk); _labNavs.set(lk, hit); _rooms.set(base, { sig, nav: hit }); return hit; }
  }
  const nav = buildNav(roomObstacles(room), { minX: b.minX - M, maxX: b.maxX + M, minZ: b.minZ - M, maxZ: b.maxZ + M }, o.x, o.z, typeof base.navSoftAt === 'function' ? base.navSoftAt : null);
  if (lk) nav.pull = true; // 연구소: 꺾은선을 직선으로 당김(pull)
  if (lk && Array.isArray(base.navRamps)) nav.ramps = base.navRamps.map((r) => ({ ...r, b: { x: r.b.x - o.x, z: r.b.z - o.z }, t: { x: r.t.x - o.x, z: r.t.z - o.z } })); // 연구소 경사로 축(rampRoute)
  _rooms.set(base, { sig, nav });
  if (lk) { _labNavs.set(lk, nav); if (_labNavs.size > LAB_NAV_CAP) _labNavs.delete(_labNavs.keys().next().value); }
  return nav;
}
// 연구소 격자 캐시: 내용 열쇠(원점 기준 상대 장애물·범위) → nav(길 캐시 포함). 캠퍼스 연구동 여럿 + 직전 배치 몇 개
const LAB_NAV_CAP = 24;
const _labNavs = new Map();
const _labKeys = new WeakMap(); // navBoxes 배열 → {ox, oz, key}(구역 방끼리 같은 배열 → 한 번만 계산)
function labNavKey(base) {
  const nb = base.navBoxes;
  if (!Array.isArray(nb)) return null;
  const o = base.origin, b = base.bounds;
  const c = _labKeys.get(nb);
  if (c && c.ox === o.x && c.oz === o.z && c.n === nb.length) return c.key;
  const q = (v) => Math.round(v * 1000);
  const parts = [q(b.minX - o.x), q(b.maxX - o.x), q(b.minZ - o.z), q(b.maxZ - o.z), nb.length];
  for (const x of nb) parts.push(q(x.minX - o.x), q(x.maxX - o.x), q(x.minZ - o.z), q(x.maxZ - o.z));
  const key = parts.join(',');
  _labKeys.set(nb, { ox: o.x, oz: o.z, n: nb.length, key });
  return key;
}
/** 시험용: 연구소 격자 캐시 비우기 */
export function _resetLabNavCache() { _labNavs.clear(); }

const toLocalPt = (room, p) => {
  const xf = room.xf, k = quarter(xf.k);
  return rotXZ(p.x, p.z, -k, xf.px, xf.pz);
};
/**
 * 방 안 a → b 걷는 길(세계 좌표 [{x,z}], 첫 점 = a, 끝 점 = b 또는 b 가 가구 안이면 그 앞 접근점). 격자 밖·길 없음 → null.
 * 돌린 방은 지역 좌표에서 찾아 돌린다.
 */
export function navPath(a, b, room) {
  const nav = roomNav(room);
  if (!nav) return null;
  const base = navBase(room), o = base.origin;
  const rot = base !== room;
  const la = rot ? toLocalPt(room, a) : a, lb = rot ? toLocalPt(room, b) : b;
  const rel = navRoute(nav, { x: la.x - o.x, z: la.z - o.z }, { x: lb.x - o.x, z: lb.z - o.z });
  if (!rel) return null;
  const k = rot ? quarter(room.xf.k) : 0;
  const out = rel.map((p) => {
    const x = p.x + o.x, z = p.z + o.z;
    return k ? rotXZ(x, z, k, room.xf.px, room.xf.pz) : { x, z };
  });
  // 끝점 정확히(회전 부동소수 오차 없이)
  out[0] = { x: a.x, z: a.z };
  const end = rel[rel.length - 1];
  if (Math.abs(end.x - (lb.x - o.x)) < 1e-9 && Math.abs(end.z - (lb.z - o.z)) < 1e-9) out[out.length - 1] = { x: b.x, z: b.z };
  return out;
}

/** 서 있을 자리: b 가 가구·벽 곁(막힌 칸)이면 가장 가까운 빈 칸 가운데(face 등 나머지 필드 유지), 아니면 b 그대로 */
export function navSpot(room, b) {
  const nav = roomNav(room);
  if (!nav || !b) return b;
  const base = navBase(room), o = base.origin, rot = base !== room;
  const lb = rot ? toLocalPt(room, b) : b;
  const x = lb.x - o.x, z = lb.z - o.z;
  const c = cellOf(nav, x, z);
  if (c < 0 || !nav.blocked[c]) return b;
  const f = nearestFree(nav, x, z);
  if (f < 0) return b;
  let p = { x: cx_(nav, f % nav.nx) + o.x, z: cz_(nav, (f / nav.nx) | 0) + o.z };
  if (rot) p = rotXZ(p.x, p.z, quarter(room.xf.k), room.xf.px, room.xf.pz);
  return { ...b, x: p.x, z: p.z };
}

/**
 * (x, z)(세계) 가 가구·벽 상자 '안'인지(몸 반지름 여유 없음) — 밀어내기·길 다시 찾기 판정용(O(1), 칸 가운데 기준 격자를 한 번 만듦).
 * 격자 밖·방 없음 → false
 */
export function navSolid(room, x, z) {
  const nav = roomNav(room);
  if (!nav) return false;
  const base = navBase(room), o = base.origin, rot = base !== room;
  const l = rot ? toLocalPt(room, { x, z }) : { x, z };
  const c = cellOf(nav, l.x - o.x, l.z - o.z);
  if (c < 0) return false;
  if (!nav.solid) {
    const S = new Uint8Array(nav.nx * nav.nz), C = NAV.CELL;
    for (const b of nav.boxes) {
      const i0 = Math.max(0, Math.ceil((b.minX - nav.gx0) / C - 0.5)), i1 = Math.min(nav.nx - 1, Math.floor((b.maxX - nav.gx0) / C - 0.5));
      const j0 = Math.max(0, Math.ceil((b.minZ - nav.gz0) / C - 0.5)), j1 = Math.min(nav.nz - 1, Math.floor((b.maxZ - nav.gz0) / C - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) S[j * nav.nx + i] = 1;
    }
    nav.solid = S;
  }
  return nav.solid[c] === 1;
}
/** 꺾은선 pts(세계) 가운데 상자 안을 지나는 점이 있는지(0.1 간격 표본, from 번째 점부터) */
export function navPathBlocked(room, pts, from = 0) {
  if (!pts || pts.length < 2) return false;
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1));
    for (let k = 0; k <= n; k++) if (navSolid(room, a.x + (b.x - a.x) * (k / n), a.z + (b.z - a.z) * (k / n))) return true;
  }
  return false;
}

// ───────────── 라운지 ─────────────
const _lounges = new WeakMap();
/** 라운지 둘레 격자(라운지 + 주변 방 문 밖까지). rooms = 같은 동 방들(세계 bounds) */
export function loungeNav(lg, rooms = []) {
  if (!lg) return null;
  const pad = 6;
  const area = { minX: lg.minX - pad, maxX: lg.maxX + pad, minZ: lg.minZ - pad, maxZ: lg.maxZ + pad };
  // 라운지 쪽 사무실(문이 라운지를 봄, r.lounge) 문 밖 자리가 격자 안에 들게 넓히고, 그 범위에 걸친 방을 모두 장애물로
  for (const r of rooms) if (r && r.lounge && r.door && r.door.out) {
    area.minX = Math.min(area.minX, r.door.out.x - 1.5); area.maxX = Math.max(area.maxX, r.door.out.x + 1.5);
    area.minZ = Math.min(area.minZ, r.door.out.z - 1.5); area.maxZ = Math.max(area.maxZ, r.door.out.z + 1.5);
  }
  const near = rooms.filter((r) => r && r.bounds && r.bounds.minX < area.maxX && r.bounds.maxX > area.minX && r.bounds.minZ < area.maxZ && r.bounds.maxZ > area.minZ);
  const sig = near.map((r) => `${r.id}@${r.bounds.minX.toFixed(3)},${r.bounds.minZ.toFixed(3)},${r.bounds.maxX.toFixed(3)},${r.bounds.maxZ.toFixed(3)}`).join(';') + `|${lg.minX},${lg.minZ}`;
  const c = _lounges.get(lg);
  if (c && c.sig === sig) return c.nav;
  const nav = buildNav(loungeObstacles(lg, near), area, 0, 0);
  _lounges.set(lg, { sig, nav });
  return nav;
}
/** 라운지 둘레 a → b(세계). 실패하면 곧은 선 */
export function loungePath(nav, a, b) {
  const p = nav ? navRoute(nav, a, b) : null;
  if (!p) return [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
  p[0] = { x: a.x, z: a.z };
  return p;
}
