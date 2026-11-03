// 【모듈 규격 · 플랫폼(작업 대상 층, platform) 담당】 가운데 원형 플랫폼 = 작업 대상 장부의 연구소 그림 — 순수(three·DOM 없음), node --test 대상.
// 3D 는 lab-platform.js(LabPlatform3D), 2D 는 flat/lab2d-platform.js(평면도 담당)가 이 모듈의 계획(plan)을 그대로 쓴다.
//
// ┌ 입력 ───────────────────────────────────────────────────────────────────────────────────────────┐
// │ book: 앱 공용 ArtBook(artifact-core.mjs) — book.layoutItems(pid).items = [{key, kind:'file'|'artifact'|'repo'|'db'|'remote'|    │
// │       'service', path, folder(topFolder), first, last, n, sz, imp, gone, …}], book.version, book.defaultProject            │
// │ fx: 연출 큐 ArtFx(— step(now)·acts) · env: ArtLayerBase3D.update 가 채움 {nowMs, reduced, foot, hover, hits, nodePos, │
// │     style, isLight, pidAlpha} · geo: ArtGeo 버퍼(artifact-core.mjs: box/cyl/line/dot/labels, 상한 ARTGEO)                   │
// │ 좌표: lab-const.mjs — 플랫폼 중심 (cx, cz) = room.lab.cx/cz, 반지름 rP = room.lab.rP, 윗면 y = LAB.PLATFORM.H.            │
// │       구역 각은 θ_B(225°)부터 시계 방향(θ 감소), 칸 = 극좌표 격자(반지름·호 간격 1.15).                                     │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// ┌ 출력 ─ export ──────────────────────────────────────────────────────────────────────────────────┐
// │ labSectorPlan(items, rP, prev) → { rP, sectors:[{key, name, th0, th1, cells:[{key, r, theta, x, z}]}], cellOf:Map key→cell,   │
// │      more:{n} } — 결정적·안정(이미 놓인 대상은 움직이지 않음, 빠지면 칸만 빔). 좌표는 중심 기준(더하기 cx, cz 는 그리는 쪽)  │
// │ labBlockShape(item) → [{dx,dy,dz, sx,sy,sz, c(ART_KEYS 색 번호), a}] — 종류·하위 구분 모양                             │
// │ labPlatformGeometry(book, plans, fx, now, env, geo) → geo  (plans = Map pid → {plan, cx, cz}) — drawActs(th='lab') 호출  │
// │ labPlatformRadius(nVisible, prevR, sinceMs) → R_P (히스테리시스: 커질 때만 바로, 줄 때 10분)                         │
// │ 동적 표현: blockTint(it, nowMs, out) → {key 'new'|'write'|'del'|null, a, d} · sectorHeat(mem, key, t0, now)/sectorHeatA(mem, │
// │      key, now) → 구역 활동 열 알파 · waveLift(r, rFront, k) → 파도 블록 튐. env.actOrigin(e) → {x,y,z}|null(선택 — bg 기자재  │
// │      꼭대기, e.tu === 기자재 node.meta.toolUseId 일 때. 결과 객체는 재사용될 수 있어 바로 읽음) = carry·pour 캡슐 출발점·읽기 │
// │      귀환 도착점·build/edit 공급선 시작. 없거나 null 이면 env.nodePos(e.node)                                                │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// 성능 상한(LAB_PERF): 블록 ≤ 300 + 구역 묶음 13, 선 ≤ 7,000, 라벨 14, 동시 점등 8, 연출 ≤ 160, labSectorPlan 대상 500 < 8ms.
//
// ── 구현 메모(플랫폼 담당, 설계) ─────────────────────────────────────────────────────────────────
// 계획(plan) 추가 필드(2D·시험이 씀): rows(칸 줄 반지름) · rIn/rOut(칸 띠) · sectors[].{n, over, last, more, bundle{r,theta,x,z,ids,n}}
//   · bundleOf:Map id → 구역 열쇠(묶음 블록에 접힌 대상) · rim:Map id → {k, i, r, theta, x, y, z}(테두리 장치·코어) · over:{output,db,remote,service,repo}
//   · nBlocks(칸에 놓인 블록 수) · agg(nBlocks > 300 → 구역 판 LOD) · _s(다음 호출의 prev 상태, 바깥에서 건드리지 않음).
// 구역 = 파일·접힌 임시 폴더(k 'zone')만. 산출물 = 테두리 앞쪽 반출대(θ 30～60), DB = 브리지 쪽 탱크(200～250), 원격 = 바깥 안테나(290～340),
//   서비스 = 테두리 위 +2.4 위성(120～190), 저장소 = 가운데 코어(둘째부터 작은 코어 3).
// 연구소 은유 연출(이 모듈이 직접 그림): 읽기 스캔 고리 · 새로 만들기 3D 프린트 · 고치기 층 교체 · 지우기 파쇄 · 덮어쓰기 가라앉았다 다시 프린트 ·
//   대량 변경 바닥 파도(같은 구역 10초 안 6개 이상) · 위험 동작 붉은 파문 3겹 + 경광등 4 회전 + 구역 붉은 빗금 10분 · push 코어 흡입 + 빛기둥 + 눈금 회전 ·
//   DB 쓰기 수위·파이프 방울 · Grep/Glob 코어 레이더. 그 밖 연출(carry·pour·launch·flash·fail·stop …)은 drawActs(theme 'lab' = 빛 조각 계열).
import { LAB, LAB_PERF, DEG, polar, platformRadius } from './lab-const.mjs';
import { ART, ARTGEO, freshness, dbLevel, fileSub, districtKey, districtLabel, zoneKeyOf } from '../artifact-core.mjs';
import { KI, styleAlpha, litMap, fxState, itemAlpha, shield, beams, ease, extOf, dashed } from '../art-meta.mjs';
import { ActPos, drawActs } from '../art-act-core.mjs';
import { t as _t } from '../i18n.mjs';

/** 플랫폼 그림 상수(값은 설계·LAB_PERF 에서) */
export const LP = {
  CELL: 1.15,                 // 칸 간격(반지름·호)
  BLOCK: 0.8,                 // 블록 바닥 크기(축 정렬 상자 — 대각 1.13 < 칸 간격)
  CORE_GAP: 1.2,              // 코어 가장자리 → 첫 칸 줄 안쪽 끝
  SECTOR_MIN: 18,             // 구역 최소 각(도)
  SECTOR_MAX: LAB.PLATFORM.SECTOR_MAX, // 이름 있는 구역 상한(넘으면 '…')
  RESERVE: 36,                // 처음 나눌 때 새 폴더 몫으로 남기는 각(도)
  PER_SECTOR: 36,             // 구역당 그리는 블록 상한(넘으면 묶음 블록 +n)
  BLOCKS_MAX: LAB_PERF.PLATFORM_BLOCKS, // 전체 블록 상한(넘으면 구역 판)
  H_MIN: 0.15, H_MAX: 1.2,    // 블록 높이
  OUT_MAX: 8, DB_MAX: 4, REMOTE_MAX: 4, SVC_MAX: 6, REPO_MAX: 4,
  SVC_Y: 2.4,                 // 서비스 위성 높이(윗면 위)
  BULK_N: 6, BULK_S: 10, WAVE_S: 3.0, // 대량 변경: 같은 구역 10초 안 6개 이상 → 바닥 파도 3초(가시성: 1.8 → 3.0)
  BEACONS: [0, 90, 180, 270], // 경광등 방위(도)
  // 연출 가시성(기본 고도에서 보이게 — ArtGeo 선 폭 LW: 3D 는 2 이상이면 옆선 1, 3 이상이면 옆선 2 를 더 그림)
  FX_W: 3,                    // 빗금·파문 고리·경계 호·방사선·경광 빔 선 폭
  WAVE_W: 4,                  // 파도 앞 띠 선 폭
  WAVE_GAP: 0.35,             // 파도 앞 띠 3줄 간격
  HATCH_A: 0.6,               // 구역 빗금 알파(0.3 → 0.6)
  ALARM_PLATE_A: 0.5,         // 경보 구역 바닥 판 알파(맥동 ±20%) — 층이 solid 상자라 렌더러가 a·0.5 만큼 붉게 섞음(≈25% 틴트)
  XN_Y: 2.4,                  // ×N 라벨 높이(윗면 위)
  BEACON_R: 0.28, BEACON_H: 0.5, BEACON_DOT: 0.45, BEACON_BEAM: 3.0, // 경광등 기둥·발광 점·회전 빔 길이
  HYST_MS: 10 * 60_000, R_STEP: 0.5, // 반지름 히스테리시스·양자화(바뀔 때마다 배치를 다시 하므로 0.5 단위)
  LINE_SOFT: LAB_PERF.PLATFORM_LINES - 600, // 이 선 수를 넘으면 세부 무늬 생략
  // ── 동적 표현(Artifact Layer 담당 B) ──
  TINT_HOLD: 30_000, TINT_END: 150_000, // 블록 동사 색: 마지막 쓰기 뒤 30초 온전히 → 150초에 0(선형)
  TINT_TH: 0.04,              // 동사 색 윗판 두께
  DEL_GHOST_MS: 30_000,       // 지운 칸 회색 잔상 판(알파 0.25 → 0)
  WAVE_LIFT: 0.25,            // 대량 변경 파도: 파두 근처 블록 튐(m)
  HEAT_WIN: 60, HEAT_HOLD: 60, HEAT_END: 180, HEAT_MAX: 64, HEAT_A: 0.35, HEAT_ARCS: 4, HEAT_LINES: 400, // 구역 활동 열(초 — 연출 시계) · 바닥 빛 호 수·프레임 선 상한
  CORE_RING_S: 0.9, CORE_RING_DR: 1.6, CORE_RINGS: 3, // 코어 쓰기 고리
  CORE_W0: 0.15, CORE_WK: 0.12, CORE_WMAX: 1.2, CORE_WIN: 10, CORE_DT: 0.25, // 코어 눈금 회전(rad/s) = 0.15 + 0.12·최근 10초 쓰기 수, 상한 1.2
  EDGE_S: 1.5,                // 고치기 뒤 호박 테 지속(초)
  CAP_S: 0.18, CAP_LIFT: 1.2, CAP_MAX: 24, // 시료 캡슐(상자 한 변)·포물선 높이·동시 상한
};
const MORE = '#more';
const START = LAB.BRIDGE_THETA; // 구역 시작 각(브리지 쪽)
const H = LAB.PLATFORM.H;

/** 칸 띠: 코어 바깥 ～ 테두리 장치 띠 안쪽. 줄 반지름 목록 */
export function platformRows(rP) {
  const rIn = LAB.PLATFORM.CORE_R + LP.CORE_GAP, rOut = rP - LAB.PLATFORM.RIM_BAND;
  const rows = [];
  for (let r = rIn + LP.CELL / 2; r + LP.CELL / 2 <= rOut + 1e-6; r += LP.CELL) rows.push(+r.toFixed(4));
  return { rIn, rOut, rows };
}

/** 구역 [th0, th1](도, th0 < th1) 칸들 — 안쪽 줄부터, 줄 안에서는 th1 쪽(시작 쪽)부터. 바깥 줄 가운데 칸 하나는 묶음 블록 자리 */
export function sectorCells(th0, th1, rows) {
  const cells = [];
  let bundle = -1;
  const span = th1 - th0, mid = (th0 + th1) / 2;
  for (let j = 0; j < rows.length; j++) {
    const r = rows[j], arc = r * span * DEG - 0.3;
    const n = Math.floor(arc / LP.CELL);
    if (n < 1) continue;
    const d = LP.CELL / r / DEG;
    const row0 = cells.length;
    for (let k = 0; k < n; k++) {
      const theta = mid + ((n - 1) / 2 - k) * d, p = polar(0, 0, r, theta);
      cells.push({ key: null, i: cells.length, row: j, r, theta, x: +p.x.toFixed(4), z: +p.z.toFixed(4) });
    }
    bundle = row0 + Math.floor(n / 2); // 가장 바깥 줄 가운데(마지막 줄이 덮어씀)
  }
  if (!cells.length) { // 칸이 없는 아주 좁은 구역: 묶음 자리만
    const r = rows.length ? rows[rows.length - 1] : 3, p = polar(0, 0, r, mid);
    cells.push({ key: null, i: 0, row: Math.max(0, rows.length - 1), r, theta: mid, x: p.x, z: p.z, virtual: true });
    bundle = 0;
  }
  return { cells, bundle };
}

/** 테두리 장치 자리(중심 기준): 산출물 반출대 두 줄 · DB 탱크 · 원격 안테나 · 서비스 위성(떠 있음) · 저장소 코어(0 = 가운데) */
export function rimSlotsFor(k, rP) {
  const R = LAB.RIM, out = [];
  const at = (r, theta, y = H) => { const p = polar(0, 0, r, theta); return { r, theta, x: p.x, z: p.z, y }; };
  if (k === 'output') {
    const [a, b] = R.BOARD;
    for (let i = 0; i < LP.OUT_MAX; i++) { const row = i % 2, col = Math.floor(i / 2); out.push(at(rP - (row ? 1.2 : 0.5), b - 3 - col * ((b - a - 6) / 3), H + 0.5)); }
  } else if (k === 'db') {
    const [a, b] = R.DB;
    for (let i = 0; i < LP.DB_MAX; i++) out.push(at(rP - 0.8, a + 5 + i * ((b - a - 10) / (LP.DB_MAX - 1))));
  } else if (k === 'remote') {
    const [a, b] = R.REMOTE;
    for (let i = 0; i < LP.REMOTE_MAX; i++) out.push(at(rP - 0.8, a + 5 + i * ((b - a - 10) / (LP.REMOTE_MAX - 1))));
  } else if (k === 'service') {
    for (let i = 0; i < LP.SVC_MAX; i++) out.push(at(rP - 0.8, 120 + i * 14, H + LP.SVC_Y));
  } else if (k === 'repo') {
    out.push({ r: 0, theta: 0, x: 0, z: 0, y: H });
    for (let i = 1; i < LP.REPO_MAX; i++) out.push(at(LAB.PLATFORM.CORE_R + 0.75, LAB.CAM_THETA + (i - 1) * 120));
  }
  return out;
}

const byFirst = (a, b) => (a.first || 0) - (b.first || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const inSector = (it) => it && (it.k === 'file' || it.k === 'zone');
const RIM_KINDS = ['output', 'db', 'remote', 'service', 'repo'];
const RIM_CAP = { output: LP.OUT_MAX, db: LP.DB_MAX, remote: LP.REMOTE_MAX, service: LP.SVC_MAX, repo: LP.REPO_MAX };

/** 자리 안정 배정: map(id → 번호)에서 없어진 것은 비우고 새것은 순서대로 가장 낮은 빈 번호(skip 제외, 번호 < nIdx). 놓인 수 ≤ cap, 넘친 수 반환 */
function assign(map, ids, cap, skip = -1, nIdx = cap) {
  const live = new Set(ids);
  for (const k of [...map.keys()]) if (!live.has(k) || map.get(k) === skip || map.get(k) >= nIdx) map.delete(k);
  const used = new Set(map.values());
  let over = 0, i = 0, placed = map.size;
  for (const id of ids) {
    if (map.has(id)) continue;
    while (used.has(i) || i === skip) i++;
    if (placed >= cap || i >= nIdx) { over++; continue; }
    map.set(id, i); used.add(i); placed++;
  }
  return over;
}

/** 각 나누기(물 채우기): 무게 w → 각, 각자 최소 MIN, 합 = total */
function share(ws, total) {
  const n = ws.length, out = new Array(n).fill(0);
  if (!n) return out;
  if (n * LP.SECTOR_MIN >= total) return out.fill(total / n);
  const fixed = new Array(n).fill(false);
  for (let it = 0; it < n; it++) {
    let left = total, W = 0;
    for (let i = 0; i < n; i++) if (fixed[i]) left -= LP.SECTOR_MIN; else W += ws[i];
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (fixed[i]) { out[i] = LP.SECTOR_MIN; continue; }
      out[i] = W > 0 ? (left * ws[i]) / W : left / n;
      if (out[i] < LP.SECTOR_MIN) { fixed[i] = true; changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

/**
 * 구역 계획(순수·결정적·안정). items = book.layoutItems(pid).items, rP = 플랫폼 반지름, prev = 지난 반환값(없으면 null).
 * 같은 rP 면 구역 각과 대상 칸을 그대로 두고 새 대상만 빈 칸에. rP 가 바뀌면 구역 각을 다시 나눔.
 */
export function labSectorPlan(items, rP = LAB.PLATFORM.R_DEFAULT, prev = null) {
  const list = (items || []).filter(inSector).sort(byFirst);
  const groups = new Map(); // 구역 열쇠 → {list, last}
  for (const it of list) {
    const k = districtKey(it);
    let g = groups.get(k); if (!g) { g = { list: [], last: 0 }; groups.set(k, g); }
    g.list.push(it); g.last = Math.max(g.last, it.last || 0);
  }
  const P0 = prev && prev._s;
  const fresh = !P0 || Math.abs(P0.rP - rP) > 1e-6;
  // 상태 복사(prev 를 바꾸지 않음)
  const S = { rP, cursor: START, sec: new Map(), keyMap: new Map(), rim: {} };
  for (const k of RIM_KINDS) S.rim[k] = new Map(fresh || !P0 ? [] : P0.rim[k]);
  if (!fresh) {
    S.cursor = P0.cursor;
    for (const [k, s] of P0.sec) S.sec.set(k, { key: k, th0: s.th0, th1: s.th1, slot: new Map(s.slot) });
    for (const [k, v] of P0.keyMap) S.keyMap.set(k, v);
  }
  const named = () => [...S.sec.keys()].filter((k) => k !== MORE).length;
  const W = (k) => Math.sqrt(groups.get(k) ? groups.get(k).list.length : 1);
  const newSec = (k, span) => { const th1 = S.cursor, th0 = th1 - span; S.sec.set(k, { key: k, th0, th1, slot: new Map() }); S.cursor = th0; };
  if (fresh) {
    let keys = [...groups.keys()];
    let moreKeys = [];
    if (keys.length > LP.SECTOR_MAX) { // 최근에 손댄 12 개만 이름 구역
      const keep = new Set([...keys].sort((a, b) => groups.get(b).last - groups.get(a).last || (a < b ? -1 : 1)).slice(0, LP.SECTOR_MAX));
      moreKeys = keys.filter((k) => !keep.has(k)); keys = keys.filter((k) => keep.has(k));
    }
    const ws = keys.map(W);
    if (moreKeys.length) ws.push(Math.sqrt(moreKeys.reduce((s, k) => s + groups.get(k).list.length, 0)));
    const total = 360 - (moreKeys.length || keys.length >= LP.SECTOR_MAX || !keys.length ? 0 : LP.RESERVE);
    const spans = share(ws, keys.length ? total : 0);
    keys.forEach((k, i) => { newSec(k, spans[i]); S.keyMap.set(k, k); });
    if (moreKeys.length) { newSec(MORE, spans[keys.length]); for (const k of moreKeys) S.keyMap.set(k, MORE); }
  } else {
    const sumW = [...groups.keys()].reduce((s, k) => s + W(k), 0) || 1;
    for (const k of groups.keys()) {
      if (S.keyMap.has(k)) continue;
      const remaining = S.cursor - (START - 360);
      if (named() < LP.SECTOR_MAX && remaining >= LP.SECTOR_MIN - 1e-6) {
        newSec(k, Math.min(remaining, Math.max(LP.SECTOR_MIN, (360 * W(k)) / sumW))); S.keyMap.set(k, k); continue;
      }
      if (S.sec.has(MORE)) { S.keyMap.set(k, MORE); continue; }
      if (remaining >= LP.SECTOR_MIN - 1e-6) { newSec(MORE, remaining); S.keyMap.set(k, MORE); continue; }
      // 빈 구역이 있으면 그 자리를 새 폴더에 / 없으면 가장 오래 안 건드린 구역을 '…' 로 바꿔 합침
      const live = (sk) => [...groups.keys()].some((g) => S.keyMap.get(g) === sk);
      const cands = [...S.sec.keys()].filter((sk) => sk !== MORE);
      const empty = cands.find((sk) => !live(sk));
      if (empty) {
        const s = S.sec.get(empty); S.sec.delete(empty); S.sec.set(k, { key: k, th0: s.th0, th1: s.th1, slot: new Map() });
        for (const [g, v] of [...S.keyMap]) if (v === empty) S.keyMap.delete(g);
        S.keyMap.set(k, k); continue;
      }
      const lastOf = (sk) => Math.max(0, ...[...groups.keys()].filter((g) => S.keyMap.get(g) === sk).map((g) => groups.get(g).last));
      const old = cands.sort((a, b) => lastOf(a) - lastOf(b) || (a < b ? -1 : 1))[0];
      const s = S.sec.get(old); S.sec.delete(old); S.sec.set(MORE, { key: MORE, th0: s.th0, th1: s.th1, slot: s.slot });
      for (const [g, v] of [...S.keyMap]) if (v === old) S.keyMap.set(g, MORE);
      S.keyMap.set(k, MORE);
    }
  }
  // 칸 배정
  const { rIn, rOut, rows } = platformRows(rP);
  const plan = { rP, rows, rIn, rOut, sectors: [], cellOf: new Map(), bundleOf: new Map(), rim: new Map(), more: { n: 0, folders: 0 }, over: {}, nBlocks: 0, agg: false, _s: S };
  const bySec = new Map();
  for (const [k, g] of groups) { const sk = S.keyMap.get(k); if (sk == null) continue; (bySec.get(sk) || bySec.set(sk, []).get(sk)).push(...g.list); if (sk === MORE) plan.more.folders++; }
  for (const s of [...S.sec.values()].sort((a, b) => b.th1 - a.th1)) {
    const its = (bySec.get(s.key) || []).sort(byFirst);
    const { cells, bundle } = sectorCells(s.th0, s.th1, rows);
    const usable = cells.filter((c) => !c.virtual).length - (bundle >= 0 && !cells[bundle].virtual ? 1 : 0);
    const cap = Math.max(0, Math.min(LP.PER_SECTOR, usable));
    const over = assign(s.slot, its.map((it) => it.id), cap, bundle, cells.length);
    const bundled = [];
    for (const it of its) {
      const ci = s.slot.get(it.id);
      if (ci == null || !cells[ci] || cells[ci].virtual) { s.slot.delete(it.id); bundled.push(it.id); plan.bundleOf.set(it.id, s.key); continue; }
      const c = cells[ci]; c.key = it.id; plan.cellOf.set(it.id, { ...c, sector: s.key }); plan.nBlocks++;
    }
    const b = cells[bundle];
    const sec = {
      key: s.key, name: s.key === MORE ? _t('lab.sector.more') : districtLabel(s.key), th0: s.th0, th1: s.th1, cells, n: its.length, over: bundled.length || over,
      last: its.reduce((m, it) => Math.max(m, it.last || 0), 0), more: s.key === MORE,
      bundle: { r: b.r, theta: b.theta, x: b.x, z: b.z, i: bundle, ids: bundled, n: bundled.length, sector: s.key },
    };
    plan.more.n += bundled.length;
    plan.sectors.push(sec);
  }
  plan.agg = plan.nBlocks > LP.BLOCKS_MAX;
  // 테두리 장치·코어
  for (const k of RIM_KINDS) {
    const its = (items || []).filter((it) => it && it.k === k).sort(byFirst);
    const slots = rimSlotsFor(k, rP);
    plan.over[k] = assign(S.rim[k], its.map((it) => it.id), RIM_CAP[k]);
    for (const it of its) { const i = S.rim[k].get(it.id); if (i == null) continue; plan.rim.set(it.id, { k, i, ...slots[i] }); }
  }
  return plan;
}

/** 대상 블록 높이 0.15～1.2: 접촉(쓰기) 수·누적 변경 줄(log) */
export function labBlockHeight(it) {
  const c = (it && it.cnt) || {};
  const e = (c.create || 0) + (c.modify || 0) + (c.write || 0);
  const h = LP.H_MIN + 0.16 * Math.log2(1 + e) + 0.05 * Math.log2(1 + ((it && it.sz) || 0));
  return Math.max(LP.H_MIN, Math.min(LP.H_MAX, h));
}
/** 블록 하위 종류: code · doc · data · image · plan · secret · fold(접힌 임시 폴더) · del(지워진 잔해) */
export function labBlockSub(it) {
  if (!it) return 'code';
  if (it.del) return 'del';
  if (it.k === 'zone') return 'fold';
  if (it.imp === 'secret') return 'secret';
  return fileSub(it);
}

/** 대상 → 상자 목록(칸 중심 기준, dy = 플랫폼 윗면 위 중심 높이). c = ART_KEYS 색 번호, a = 몸통 섞음 정도(0..1) */
export function labBlockShape(item) {
  const sub = labBlockSub(item), h = labBlockHeight(item), S = LP.BLOCK;
  switch (sub) {
    case 'del': return [{ dx: 0, dy: 0.03, dz: 0, sx: S, sy: 0.06, sz: S, c: KI.del, a: 0.25 }];
    case 'doc': { // 종이 더미 세 장(엇갈림)
      const t = h / 3;
      return [0, 1, 2].map((q) => ({ dx: (q - 1) * 0.03, dy: t * q + t / 2, dz: (1 - q) * 0.02, sx: S * 0.86, sy: Math.max(0.04, t - 0.015), sz: S, c: KI.zone, a: 0.3 + 0.08 * q }));
    }
    case 'data': // 격자 유리 큐브 + 속 알맹이
      return [{ dx: 0, dy: h / 2, dz: 0, sx: S, sy: h, sz: S, c: KI.read, a: 0.16 }, { dx: 0, dy: h / 2, dz: 0, sx: S * 0.45, sy: Math.max(0.06, h * 0.45), sz: S * 0.45, c: KI.read, a: 0.6 }];
    case 'image': // 세운 액자 타일
      return [{ dx: 0, dy: 0.04, dz: 0, sx: S, sy: 0.08, sz: S, c: KI.output, a: 0.3 }, { dx: 0, dy: 0.08 + Math.max(0.35, h) / 2, dz: 0, sx: S * 0.85, sy: Math.max(0.35, h), sz: 0.1, c: KI.output, a: 0.45 }];
    case 'plan': // 청사진 판 + 말린 두루마리
      return [{ dx: 0, dy: 0.05, dz: 0, sx: S * 1.05, sy: 0.06, sz: S * 1.05, c: KI.read, a: 0.5 }, { dx: -S * 0.45, dy: 0.12, dz: 0, sx: 0.12, sy: 0.12, sz: S * 0.9, c: KI.read, a: 0.6 }];
    case 'secret': // 잠금 상자 + 고리
      return [{ dx: 0, dy: h / 2, dz: 0, sx: S * 0.85, sy: h, sz: S * 0.85, c: KI.imp, a: 0.4 }, { dx: 0, dy: h + 0.1, dz: 0, sx: 0.32, sy: 0.2, sz: 0.08, c: KI.imp, a: 0.55 }];
    case 'fold': // 끈 묶은 상자(접힌 임시 폴더)
      return [{ dx: 0, dy: h / 2, dz: 0, sx: S * 1.1, sy: h, sz: S * 1.1, c: KI.zone, a: 0.32 }, { dx: 0, dy: h * 0.55, dz: 0, sx: S * 1.13, sy: 0.06, sz: S * 1.13, c: KI.zone, a: 0.55 }];
    default: // code: 회로 칩(판 + 다이)
      return [{ dx: 0, dy: h / 2, dz: 0, sx: S, sy: h, sz: S, c: KI.file, a: 0.35 }, { dx: 0, dy: h + 0.03, dz: 0, sx: S * 0.5, sy: 0.06, sz: S * 0.5, c: KI.file, a: 0.7 }];
  }
}

/**
 * 플랫폼 반지름(히스테리시스): 목표 = clamp(7 + 0.9·√n, 7, 14) 를 0.5 단위로. 커질 때 바로, 줄 때는 목표가 prevR 아래로
 * sinceMs(ms) 이어졌을 때만(10분). prevR 없으면 목표.
 */
export function labPlatformRadius(nVisible, prevR = null, sinceMs = 0) {
  const raw = nVisible >= 0 ? platformRadius(nVisible) : LAB.PLATFORM.R_DEFAULT;
  const t = Math.max(LAB.PLATFORM.R_MIN, Math.min(LAB.PLATFORM.R_MAX, Math.round(raw / LP.R_STEP) * LP.R_STEP));
  if (!Number.isFinite(prevR)) return t;
  if (t >= prevR) return t;
  return sinceMs >= LP.HYST_MS ? t : prevR;
}
/** 히스테리시스 기억(렌더러·2D 공용): step(n, nowMs) → R_P. 데이터 시계가 뒤로 가면(재생 되감기) 줄어든 시각을 다시 잼 */
export class LabRadiusGate {
  constructor(r0 = null) { this.r = r0; this.below = null; }
  step(n, nowMs) {
    const want = labPlatformRadius(n, null);
    if (this.r == null || want >= this.r) { this.r = want; this.below = null; return this.r; }
    if (this.below == null || nowMs < this.below) this.below = nowMs;
    const r = labPlatformRadius(n, this.r, nowMs - this.below);
    if (r !== this.r) { this.r = r; this.below = null; }
    return this.r;
  }
}

/**
 * 대량 변경 감지(순수 — 시험용 분리): mem = {ts:Map 구역 → [t0…], wave:Map 구역 → {t0, n}, seen:Set}. 쓰기 접촉 t0(초) 를 더하고
 * 같은 구역 BULK_S 안 BULK_N 개 이상이면 파도 시작(쿨다운 = 파도 길이). 반환 = 새 파도면 n, 아니면 0
 */
export function bulkNote(mem, sk, t0, now) {
  let a = mem.ts.get(sk); if (!a) { a = []; mem.ts.set(sk, a); }
  a.push(t0);
  while (a.length && now - a[0] > LP.BULK_S) a.shift();
  const w = mem.wave.get(sk);
  if (a.length >= LP.BULK_N && (!w || now - w.t0 > LP.WAVE_S)) { mem.wave.set(sk, { t0: now, n: a.length }); return a.length; }
  if (w && a.length > w.n && now - w.t0 <= LP.WAVE_S) w.n = a.length;
  return 0;
}
export const newBulkMem = () => ({ ts: new Map(), wave: new Map(), seen: new Set() });

/**
 * 블록 동사 색(순수·할당 0 — out 재사용): 마지막 '쓰기' 동사(log 를 뒤에서부터, 없으면 cnt 로 추정) → out = {key, a, d}.
 * key = 'new'(create) | 'write'(modify·write) | 'del'(delete) | null(읽기만 · 너무 오래됨), a = 0..1(쓰기 뒤 Δ ≤ 30초 1 → 150초 0, 선형),
 * d = Δ(ms). Δ 는 그 쓰기 기록의 시각(log t) 기준 — 읽기가 it.last 를 밀어도 색이 되살아나지 않음(log 에 쓰기가 없을 때만 it.last).
 */
const WRITE_V = { create: 'new', modify: 'write', write: 'write', delete: 'del' };
export function blockTint(it, nowMs, out = { key: null, a: 0, d: 0 }) {
  out.key = null; out.a = 0; out.d = 0;
  if (!it) return out;
  let key = null, t = 0;
  const L = it.log;
  if (L) for (let i = L.length - 1; i >= 0; i--) { const k = WRITE_V[L[i].v]; if (k) { key = k; t = L[i].t || 0; break; } }
  if (!key) {
    const c = it.cnt; if (!c) return out;
    if (it.del && c.delete) key = 'del';
    else if ((c.modify || 0) + (c.write || 0) > 0) key = 'write';
    else if (c.create) key = 'new';
    else return out;
    t = it.last || 0;
  }
  const d = nowMs - t;
  const a = d <= LP.TINT_HOLD ? 1 : d >= LP.TINT_END ? 0 : 1 - (d - LP.TINT_HOLD) / (LP.TINT_END - LP.TINT_HOLD);
  out.d = d;
  if (a > 0) { out.key = key; out.a = a; }
  return out;
}

/**
 * 구역 활동 열(순수 — mem = Map key → {ts:[초…], n, last}, 최대 LP.HEAT_MAX 구역, 오래 안 쓴 것부터 버림).
 * sectorHeat(mem, key, t0, now): 쓰기 하나(t0 = 연출 시계 초) 기록 → 지금 알파. sectorHeatA(mem, key, now): 읽기만.
 * n = 마지막 쓰기까지 60초 안 쓰기 수, a = min(0.35, 0.12·log2(1+n)), 마지막 쓰기 뒤 60～180초에 걸쳐 0(선형). 시계가 뒤로 가면 다시 셈.
 */
export function sectorHeat(mem, key, t0, now) {
  let e = mem.get(key);
  if (e) mem.delete(key); // 최근 쓴 구역을 뒤로(넘치면 맨 앞 = 가장 오래 안 쓴 구역부터 버림)
  else { if (mem.size >= LP.HEAT_MAX) mem.delete(mem.keys().next().value); e = { ts: [], n: 0, last: -1e9 }; }
  mem.set(key, e);
  if (t0 < e.last - 1) { e.ts.length = 0; e.last = -1e9; } // 되감기
  e.ts.push(t0);
  if (t0 > e.last) e.last = t0;
  while (e.ts.length && (e.last - e.ts[0] > LP.HEAT_WIN || e.ts.length > 16)) e.ts.shift();
  e.n = e.ts.length;
  return sectorHeatA(mem, key, now);
}
export function sectorHeatA(mem, key, now) {
  const e = mem && mem.get(key);
  if (!e || !e.n) return 0;
  const d = now - e.last;
  if (d < -1 || d >= LP.HEAT_END) return 0;
  const f = d <= LP.HEAT_HOLD ? 1 : 1 - (d - LP.HEAT_HOLD) / (LP.HEAT_END - LP.HEAT_HOLD);
  return Math.min(LP.HEAT_A, 0.12 * Math.log2(1 + e.n)) * f;
}

// 이 모듈이 연구소 은유로 직접 그리는 연출 — carry(쓰기 시작 = 호박 시료 캡슐)·pour(DB 쓰기 = 탱크로 캡슐)는 동적 표현에서 더함
const OWN_ACTS = new Set(['build', 'edit', 'shatter', 'read', 'radar', 'carry', 'pour']);
const outShape = (it) => { // 산출물 모양
  if (String(it.id || '').startsWith('artifact:')) return 'panel';
  const e = extOf(it.n || it.id).toLowerCase();
  if (/^(pdf|hwpx?|docx?|pptx?|md)$/.test(e)) return 'book';
  if (/^(xlsx?|csv|tsv)$/.test(e)) return 'table';
  if (/^(png|jpe?g|svg|gif|webp)$/.test(e)) return 'frame';
  if (/^(mp3|mp4|wav|mov|webm)$/.test(e)) return 'film';
  if (/^(zip|tar|gz|7z)$/.test(e)) return 'parcel';
  return 'book';
};

/**
 * ArtGeo 에 플랫폼 그림을 채운다. plans = Map pid → {plan, cx, cz, rWall?}. env = {nowMs, reduced, foot, hover, hits, nodePos, style, isLight,
 * pidAlpha, unitPx(pid) → 1m 의 화면 px, labels(false 면 라벨 없음)}. now = 연출 시계(초).
 */
export function labPlatformGeometry(book, plans, fx, now, env, geo) {
  geo.begin();
  if (env.hits) env.hits.length = 0;
  const nowMs = env.nowMs || Date.now();
  const A = styleAlpha(env);
  const BODY = (0.1 + 0.22 * A.B0) * (env.isLight ? 0.9 : 1);
  const M = litMap(fx, now, env._lm || (env._lm = { fxBy: new Map(), litBy: new Map() }));
  const FS = env._fs || (env._fs = {});
  const red = !!env.reduced, t = red ? 0 : now;
  let budget = env.labels === false ? 0 : Math.min(ARTGEO.LABELS, LAB_PERF.PLATFORM_LABELS) - 3;
  // 연출 라벨(×N·⚠) 몫 2개를 구역 이름·대상 이름보다 먼저 떼어 둠 — 모자라면 남은 예산에서
  let fxRes = Math.min(2, budget); budget -= fxRes;
  const fxLabel = () => { if (fxRes > 0) { fxRes--; return true; } if (budget > 0) { budget--; return true; } return false; };
  const AC = fx && fx.acts && fx.acts.list.length ? fx.acts : null;
  const AP = env._ap || (env._ap = new ActPos()); AP.begin();
  const want = AC ? AC.keys(book, zoneKeyOf) : null;
  // 이 모듈이 그리는 연출(대상별 진행도)·나머지(drawActs)
  const own = env._own || (env._own = new Map()); own.clear();
  const ownPool = env._ownPool || (env._ownPool = []); let nOwn = 0;
  const rest = env._rest || (env._rest = { list: [] }); rest.list.length = 0;
  const radar = env._radar || (env._radar = []); let nRadar = 0;
  const trips = env._trips || (env._trips = []); let nTrip = 0; // 캡슐 운반(carry·pour·읽기 귀환) — 위치(AP)가 다 찬 뒤 끝에서 그림
  if (AC) for (const e of AC.list) {
    const k = (now - e.t0) / e.dur;
    if (k < 0 || k >= 1) { if (k < 0) rest.list.push(e); continue; }
    if (!OWN_ACTS.has(e.a)) { rest.list.push(e); continue; }
    if (e.a === 'radar') { const R = radar[nRadar] || (radar[nRadar] = { pid: null, k: 0 }); R.pid = e.pid; R.k = k; nRadar++; continue; }
    if ((e.a === 'carry' || e.a === 'pour' || e.a === 'read') && e.id != null && nTrip < LP.CAP_MAX) { const T = trips[nTrip] || (trips[nTrip] = { e: null, k: 0 }); T.e = e; T.k = k; nTrip++; }
    if (e.a === 'carry' || e.a === 'pour') continue;
    if (e.id != null) {
      const key = e._lpk || (e._lpk = e.pid + '|' + e.id), o = own.get(key);
      if (!o || e.t0 > o.t0) { const q = o || ownPool[nOwn] || (ownPool[nOwn] = { a: null, k: 0, t0: 0, n: 1, sz: 0, e: null }); if (!o) nOwn++; q.a = e.a; q.k = k; q.t0 = e.t0; q.n = e.n; q.sz = e.sz; q.e = e; own.set(key, q); }
    }
  }
  // 대량 변경 감지 기억
  const bulk = env._bulk || (env._bulk = newBulkMem());
  if (fx) for (const e of fx.list) {
    if (e.kind !== 'lit' || (e.amp || 1) < 1) continue;
    const key = e.pid + '|' + e.id + '|' + e.t0;
    if (bulk.seen.has(key)) continue;
    bulk.seen.add(key); if (bulk.seen.size > 400) bulk.seen.delete(bulk.seen.values().next().value);
    const E = plans.get(e.pid); if (!E) continue;
    const c = E.plan.cellOf.get(e.id), sk = c ? c.sector : E.plan.bundleOf.get(e.id);
    if (sk) bulkNote(bulk, e.pid + '|' + sk, e.t0, now);
  }
  // 쓰기 끝(rise·pulse — 쓰기 하나에 하나) → 구역 활동 열 · 코어 최근 10초 쓰기 수(연출 큐 항목마다 한 번 — WeakSet, 문자열 없음)
  const heat = env._heat || (env._heat = new Map());
  const coreM = env._corePh || (env._corePh = new Map()); // pid → {ph(누적 위상), at(지난 시각), ts:[쓰기 t0…]}
  const seenW = env._seenW || (env._seenW = new WeakSet());
  if (fx) for (const e of fx.list) {
    if ((e.kind !== 'rise' && e.kind !== 'pulse') || seenW.has(e)) continue;
    seenW.add(e);
    let ce = coreM.get(e.pid); if (!ce) { ce = { ph: 0, at: null, ts: [] }; coreM.set(e.pid, ce); }
    ce.ts.push(e.t0); if (ce.ts.length > 32) ce.ts.shift();
    const E = plans.get(e.pid); if (!E) continue;
    const c = E.plan.cellOf.get(e.id), sk = c ? c.sector : E.plan.bundleOf.get(e.id);
    if (sk) sectorHeat(heat, e.pid + '|' + sk, e.t0, now);
  }

  for (const [pid, E] of plans) {
    if (!geo.pidStart(env, pid)) continue;
    const P = E.plan, cx = E.cx, cz = E.cz, rP = P.rP;
    const upx = env.unitPx ? env.unitPx(pid) : 20, cellPx = LP.CELL * upx;
    const far = cellPx < ART.LOD_PX, plates = far || P.agg;
    const detail = cellPx >= ART.DETAIL_PX;
    const foot = env.foot && env.foot.pid === pid ? env.foot.set : null;
    const footDim = foot ? 0.5 : 1;
    const Y = H + 0.012, LA = A.LINE_A;
    if (AC) AP.areas.set(pid, { x: cx, y: Y, z: cz, r: rP });
    const W = (x, z, o = _pw) => { o.x = cx + x; o.z = cz + z; return o; };
    const arc = (r, a0, a1, y, c, a, seg = 0, w = 1) => { // 수평 호(도), w = 선 폭
      const n = seg || Math.max(2, Math.ceil(Math.abs(a1 - a0) / 6));
      for (let q = 0; q < n; q++) { const u0 = a0 + ((a1 - a0) * q) / n, u1 = a0 + ((a1 - a0) * (q + 1)) / n; const p = polar(cx, cz, r, u0, _q0), p2 = polar(cx, cz, r, u1, _q1); geo.line(p.x, y, p.z, p2.x, y, p2.z, c, a, w); }
    };
    const radial = (theta, r0, r1, y, c, a, w = 1) => { const p = polar(cx, cz, r0, theta, _q0), q = polar(cx, cz, r1, theta, _q1); geo.line(p.x, y, p.z, q.x, y, q.z, c, a, w); };
    // ── 경보 상태(구역·장치별 최근 10분 파괴적) ──
    const AS = alarmSectors(book, pid, P, nowMs, env), alarmSec = AS.set;
    let alarmFx = null; // 지금 울리는 경보(가장 최근) — 경광등
    for (const [key, fl] of M.fxBy) {
      if (!key.startsWith(pid + '|')) continue;
      for (const e of fl) if (e.kind === 'alarm' && (!alarmFx || e.t0 > alarmFx.t0)) alarmFx = e;
    }
    // ── 구역: 경계 방사선 + 바깥 호 + 이름 ──
    const secByKey = new Map(P.sectors.map((s) => [s.key, s]));
    const named = new Set([...P.sectors].sort((a, b) => b.n - a.n).slice(0, 6).map((s) => s.key));
    for (const s of P.sectors) {
      s._wk = -1; s._ta = 0; s._tk = null; if (!s._hk) s._hk = pid + '|' + s.key; // 프레임 상태(파도 k·구역 최대 동사 색) · 활동 열 열쇠 캐시
      const la = LA * 0.6 * footDim;
      radial(s.th1, P.rIn - 0.2, rP - 0.15, Y, KI.zone, la);
      arc(P.rOut + 0.12, s.th0 + 0.6, s.th1 - 0.6, Y, KI.zone, la * (s.n ? 1 : 0.5));
      if (s.n && !far && named.has(s.key) && cellPx >= 9 && budget > 0) {
        const p = polar(cx, cz, P.rOut + 0.55, (s.th0 + s.th1) / 2);
        geo.label(p.x, Y + 0.05, p.z, s.over ? `${s.name} +${s.over}` : s.name, 'art-zone', 'zone', 0.55); budget--;
      }
    }
    // ── 위험 동작: 구역 바닥 붉은 빗금(굵은 선) + 붉은 판 10분 — 판은 칸 띠 위(블록 바닥보다 살짝 위)라 멀리서도 면으로 보임 ──
    const hp = red ? 1 : 1 + 0.2 * Math.sin(t * 2.4); // 판 맥동(움직임 줄이기면 고정)
    for (const sk of alarmSec) {
      const s = secByKey.get(sk); if (!s) continue;
      const span = s.th1 - s.th0, n = Math.min(12, Math.max(3, Math.round(span / 8)));
      for (let q = 0; q < n; q++) {
        const th = s.th0 + ((q + 0.5) * span) / n;
        const p = polar(cx, cz, P.rIn, th, _q0), p2 = polar(cx, cz, P.rOut, th + (span / n) * 0.8, _q1);
        geo.line(p.x, Y + 0.02, p.z, p2.x, Y + 0.02, p2.z, KI.alarm, LP.HATCH_A, LP.FX_W);
      }
      // 판 = 쐐기를 덮는 작은 축 정렬 상자들(alarmPlateTiles — 상자가 축 정렬이라 큰 정사각형 하나는 대각선 구역에서 코어·테·이웃 구역으로 넘침)
      const nt = alarmPlateTiles(P.rIn, P.rOut, s.th0, s.th1, _tiles);
      for (let q = 0; q < nt; q++) { const T = _tiles[q]; geo.box(cx + T.x, Y + 0.02, cz + T.z, T.s, 0.02, T.s, KI.alarm, LP.ALARM_PLATE_A * hp, null); }
    }
    // ── 구역 활동 열: 최근 60초 쓰기 수(log) → 구역 바닥 호박 빛 호 HEAT_ARCS 줄(가산 선 — 불투명 판은 어두운 바닥에서 흙빛이 되어 선으로).
    //    경보 구역은 경보 판 우선. 원경·구역 판은 판 윗면 안쪽 테(아래 판 절) ──
    const heatL0 = geo.nl;
    for (const s of P.sectors) {
      const ha = alarmSec.has(s.key) ? 0 : sectorHeatA(heat, s._hk, now);
      s._ha = ha;
      if (plates || ha <= 0.01 || geo.nl - heatL0 >= LP.HEAT_LINES || geo.nl >= LP.LINE_SOFT) continue;
      const a = Math.min(0.85, ha * 2.4), w = P.rOut - P.rIn - 0.6;
      for (let q = 0; q < LP.HEAT_ARCS; q++) arc(P.rIn + 0.3 + (w * (q + 0.5)) / LP.HEAT_ARCS, s.th0 + 0.6, s.th1 - 0.6, Y + 0.012, KI.write, a * (q % 2 ? 0.7 : 1), 0, 2);
    }
    // ── 대량 변경 파도(코어 → 테두리, 굵은 띠 3줄) + 지나간 블록 윗면 빛 판 + 경계 호 한 바퀴 빛남 + ×N ──
    for (const s of P.sectors) {
      const w = bulk.wave.get(pid + '|' + s.key); if (!w) continue;
      const k = (now - w.t0) / LP.WAVE_S; if (k < 0 || k >= 1) continue;
      const a = 0.95 * Math.min(1, 1.6 * (1 - k)), xa = k < 0.85 ? 1 : (1 - k) / 0.15;
      const ph = plates && s.n ? 0.12 + 0.18 * Math.log2(1 + s.n) : 0; // 원경·구역 판: 판 윗면 높이
      if (red) arc(P.rOut + 0.12, s.th0, s.th1, Y + ph + 0.02, KI.write, a, 0, LP.WAVE_W);
      else if (plates) { // 원경: 구역 판 윗면 테두리 굵은 호(안·밖 테두리 + 지나가는 호)
        const r0 = P.rIn + 0.1, r1 = P.rOut - 0.1, yy = H + ph + 0.02;
        arc(r0 + (r1 - r0) * k, s.th0 + 0.8, s.th1 - 0.8, yy, KI.write, a, 0, LP.WAVE_W);
        arc(r0, s.th0 + 0.8, s.th1 - 0.8, yy, KI.write, a * 0.7, 0, LP.WAVE_W); arc(r1, s.th0 + 0.8, s.th1 - 0.8, yy, KI.write, a * 0.7, 0, LP.WAVE_W);
      } else {
        const r = P.rIn + (rP - P.rIn) * k; // 고른 속도(ease-out 이면 칸 띠 안쪽을 0.3초 만에 지나가 버림)
        for (let q = 0; q < 3; q++) { const rq = r - q * LP.WAVE_GAP; if (rq < P.rIn) break; arc(rq, s.th0 + 0.5, s.th1 - 0.5, q ? Y + 0.03 : Y + 0.03 + 0.15 * Math.sin(k * Math.PI), KI.write, a * (1 - 0.25 * q), 0, LP.WAVE_W); }
        s._wk = k; // 블록 튐(블록 절에서 waveLift)
        // 파두를 따라 지나가는 구역 바닥 호박 판(반지름 [r − 0.6, r], 한 줄 타일)
        const r0 = Math.max(P.rIn, r - 0.6), r1 = Math.min(P.rOut, r);
        if (r1 - r0 > 0.1) { const nt = alarmPlateTiles(r0, r1, s.th0, s.th1, _tiles, 1); for (let q = 0; q < nt; q++) { const T = _tiles[q]; geo.box(cx + T.x, Y + 0.014, cz + T.z, T.s, 0.016, T.s, KI.write, 0.35, null); } }
        for (const c of s.cells) { // 막 지나간 칸: 블록 윗면 위 얇은 빛 판이 한 번 스침
          if (c.key == null || c.r > r || c.r < r - LP.CELL) continue;
          const it = book.get(pid, c.key); if (!it) continue;
          const pc = W(c.x, c.z);
          geo.box(pc.x, H + shapeOf(env, it).h0 + 0.03 + waveLift(c.r, r, k), pc.z, LP.BLOCK * 1.04, 0.03, LP.BLOCK * 1.04, KI.write, 0.9 * (1 - (r - c.r) / LP.CELL), null);
        }
      }
      if (!red) {
        const u = s.th1 - (s.th1 - s.th0) * Math.min(1, k * 1.3);
        arc(P.rOut + 0.12, u, s.th1, Y + ph + 0.03, KI.write, a, 0, LP.FX_W); // 경계 호가 한 바퀴 빛남
        radial(s.th0, P.rIn, rP, Y + ph + 0.03, KI.write, a * 0.6, LP.FX_W); radial(s.th1, P.rIn, rP, Y + ph + 0.03, KI.write, a * 0.6, LP.FX_W);
      }
      if (fxLabel()) { const p = polar(cx, cz, (P.rIn + P.rOut) / 2, (s.th0 + s.th1) / 2, _q0); geo.label(p.x, Y + ph + LP.XN_Y, p.z, '×' + w.n, 'art-xn', 'write', xa); }
    }
    // ── 구역 판(LOD: 멀거나 블록 300 넘음) ──
    if (plates) {
      for (const s of P.sectors) {
        if (!s.n) continue;
        const h = 0.12 + 0.18 * Math.log2(1 + s.n), mid = (s.th0 + s.th1) / 2, rm = (P.rIn + P.rOut) / 2;
        const p = polar(cx, cz, rm, mid), span = Math.min((s.th1 - s.th0) * DEG * rm, P.rOut - P.rIn) * 0.6;
        geo.box(p.x, H + h / 2, p.z, span, h, span, alarmSec.has(s.key) ? KI.alarm : KI.zone, BODY * 1.2, null);
        const la = LA * 0.9 * footDim;
        arc(P.rIn + 0.1, s.th0 + 0.8, s.th1 - 0.8, H + h, KI.zone, la, 3); arc(P.rOut - 0.1, s.th0 + 0.8, s.th1 - 0.8, H + h, KI.zone, la, 4);
        radial(s.th0 + 0.8, P.rIn + 0.1, P.rOut - 0.1, H + h, KI.zone, la * 0.8); radial(s.th1 - 0.8, P.rIn + 0.1, P.rOut - 0.1, H + h, KI.zone, la * 0.8);
        if (env.hits) env.hits.push({ pid, id: '#zone:' + s.key, x: p.x, y: H + h, z: p.z, r: span / 2 });
        if (!far && budget > 0) { geo.label(p.x, H + h + 0.4, p.z, `${s.name} ${s.n}`, 'art-zone', 'zone', 0.6); budget--; }
      }
    }
    // ── 구역 블록 ──
    const items = env._items || (env._items = []); items.length = 0;
    for (const [id, c] of P.cellOf) items.push(id, c, false);
    for (const s of P.sectors) if (s.bundle.n) items.push(s.bundle.ids[0], s.bundle, true);
    for (let ii = 0; ii < items.length; ii += 3) {
      const id = items[ii], c = items[ii + 1], isBundle = items[ii + 2];
      const it = book.get(pid, id) || (book.foldItem ? book.foldItem(pid, id) : null);
      if (!it) continue;
      const key = pid + '|' + id, lit = M.litBy.get(key) || 0;
      const sel = !!(env.hover && env.hover.pid === pid && env.hover.id === id);
      const fr = freshness(nowMs - (it.last || 0));
      const dim = foot ? (foot.has(id) ? 1.6 : 0.3) : 1;
      const { la } = itemAlpha(A, fr, dim, lit, sel, env.isLight);
      const p = W(c.x, c.z);
      const s = secByKey.get(c.sector);
      if (isBundle) { // 묶음 블록: 쌓인 상자 + '+n'
        const n = s.bundle.n, h = Math.min(1.4, 0.3 + 0.2 * Math.log2(1 + n));
        if (!plates) {
          geo.box(p.x, H + h / 2, p.z, 0.95, h, 0.95, KI.zone, BODY * 1.3, { pid, id: '#zone:' + c.sector });
          for (let q = 1; q < 4; q++) geo.rect(p.x - 0.48, H + (h * q) / 4, p.z - 0.48, p.x + 0.48, p.z + 0.48, KI.zone, la * 0.6);
          if (budget > 0 && (cellPx > 14 || lit > 0.05)) { geo.label(p.x, H + h + 0.35, p.z, '+' + n, 'art-zone', 'zone', 0.7); budget--; }
        }
        // 묶음 안 대상이 점등·선택이면 위로 꺼내 그림(최대 3)
        let q = 0;
        for (const bid of s.bundle.ids) {
          const bk = pid + '|' + bid, bl = M.litBy.get(bk) || 0, bs = !!(env.hover && env.hover.pid === pid && env.hover.id === bid);
          if (!(bl > 0.05 || bs) || q >= 3) continue;
          const y = H + h + 0.5 + q * 0.45; q++;
          geo.box(p.x, y, p.z, 0.45, 0.3, 0.45, KI.file, BODY * 1.4 + 0.4 * bl, { pid, id: bid });
          if (want && want.has(bk)) { const R = AP.put(bk, p.x, y, p.z, y + 0.2, H, 0.6); setOut(R, c.theta); }
          if (env.hits) env.hits.push({ pid, id: bid, x: p.x, y, z: p.z, r: 0.3 });
        }
        if (env.hits) env.hits.push({ pid, id: '#zone:' + c.sector, x: p.x, y: H + h / 2, z: p.z, r: 0.5 });
        continue;
      }
      if (plates) { // 판 위 점등·중요 점만
        if (lit > 0.05 || it.imp || sel) geo.dot(p.x, H + 0.6, p.z, 0.3, it.imp ? KI.imp : KI.file, Math.max(la, 0.5 * lit + 0.2));
        if (s) { const TT = blockTint(it, nowMs, _tint); if (TT.key && TT.key !== 'del' && TT.a > s._ta) { s._ta = TT.a; s._tk = TT.key; } } // 구역 판 윗면 테 색(블록 절 뒤)
        if (want && want.has(key)) { const R = AP.put(key, p.x, H + 0.5, p.z, H + 0.8, H, 0.9); setOut(R, c.theta); }
        if (env.hits) env.hits.push({ pid, id, x: p.x, y: H + 0.4, z: p.z, r: 0.4 });
        continue;
      }
      const fl = M.fxBy.get(key) || null;
      const oa = own.get(key) || null;
      // 연구소 연출 진행도(editT = 새 윗판이 앉는 연출 시각 — 그 뒤 호박 테 EDGE_S)
      let print = -1, editK = -1, shatter = -1, scan = -1, sink = 0, editT = null;
      if (oa) { if (oa.a === 'build') print = oa.k; else if (oa.a === 'edit') { editK = oa.k; editT = oa.e.t0 + 0.8 * oa.e.dur; } else if (oa.a === 'shatter') shatter = oa.k; else if (oa.a === 'read') scan = oa.k; }
      if (fl) for (const e of fl) {
        const k = (now - e.t0) / e.dur; if (k < 0 || k >= 1) continue;
        if (e.kind === 'rise' && print < 0) print = k;
        else if (e.kind === 'pulse' && editK < 0) { editK = k; editT = e.t0 + 0.8 * e.dur; }
        else if (e.kind === 'collapse' && shatter < 0) shatter = k;
        else if (e.kind === 'read' && scan < 0) scan = k;
        else if (e.kind === 'warn') { sink = k < 0.45 ? k / 0.45 : 0; if (k >= 0.45 && print < 0) print = (k - 0.45) / 0.55; }
      }
      if (red) { print = print >= 0 ? 1 : -1; shatter = shatter >= 0 ? 1 : -1; }
      const SH = shapeOf(env, it), shape = SH.shape, h0 = SH.h0;
      const hk = print >= 0 ? ease(Math.min(1, print / 0.85)) : sink > 0 ? 1 - ease(sink) * 0.85 : 1;
      // 대량 변경 파도: 파두 근처 블록이 튐(움직임 줄이기면 0) — 고치기는 들림 대신 윗판 교체(아래)
      const lift = s && s._wk >= 0 && !red ? waveLift(c.r, P.rIn + (rP - P.rIn) * s._wk, s._wk) : 0;
      const gone = shatter >= 0 ? ease(Math.min(1, shatter * 1.6)) : 0;
      const ref = { pid, id };
      if (gone < 1) for (const b of shape) {
        const top = b.dy + b.sy / 2, bot = b.dy - b.sy / 2;
        const ctop = Math.min(top, h0 * hk), cb = Math.min(bot, h0 * hk);
        if (ctop - cb < 0.01) continue;
        const sy = (ctop - cb) * (1 - gone);
        geo.box(p.x + b.dx, H + cb + sy / 2 + lift, p.z + b.dz, b.sx * (1 - gone * 0.4), sy, b.sz * (1 - gone * 0.4), b.c, b.a * BODY * 2.4 + (env.isLight ? 0.5 : 0.35) * lit, ref);
      }
      const topY = H + h0 * hk * (1 - gone) + lift, hb = LP.BLOCK / 2;
      const th = c.theta * DEG, tx = Math.cos(th), tz = -Math.sin(th); // 접선(θ 방향) 단위 벡터 — polar 의 x = r·sinθ, z = r·cosθ
      // 동사 색 윗판(새로 만듦 초록 · 고침 호박, 30초 → 150초에 바탕색으로) — 고치는 동안은 교체 연출이 대신 그림
      const TT = blockTint(it, nowMs, _tint), PB = LP.BLOCK * 0.96, TH = LP.TINT_TH;
      const editing = editK >= 0 && editK < 1;
      if (gone < 1 && TT.key && TT.key !== 'del' && !editing) geo.box(p.x, topY + TH / 2, p.z, PB, TH, PB, KI[TT.key], (0.35 + 0.5 * TT.a) * Math.min(1, TT.a * 10), null);
      // 지우기 잔상: 칸 바닥 회색 판(알파 0.25 → 0, 30초)
      if (it.del && TT.d >= 0 && TT.d < LP.DEL_GHOST_MS) geo.box(p.x, H + 0.012, p.z, LP.BLOCK * 1.05, 0.02, LP.BLOCK * 1.05, KI.del, 0.25 * (1 - TT.d / LP.DEL_GHOST_MS), null);
      // 윗면 윤곽(+ 세부 무늬)
      const tinted = gone < 1 && !it.del && TT.key && TT.key !== 'del' && TT.a > 0.02 && !editing; // 동사 색 윗면 테(가산 선 — 불투명 윗판만으로는 어두워 읽히지 않음)
      if (tinted) geo.rect(p.x - hb, topY + TH + 0.006, p.z - hb, p.x + hb, p.z + hb, KI[TT.key], Math.max(la, 0.3 + 0.6 * TT.a));
      if (gone < 1 && (detail || lit > 0.05 || sel)) {
        const sub = SH.sub, c = it.del ? KI.del : shape[0].c;
        if (sub !== 'image' && !tinted) geo.rect(p.x - hb, topY + 0.004, p.z - hb, p.x + hb, p.z + hb, c, la);
        if (detail && geo.nl < LP.LINE_SOFT) {
          if (sub === 'code') { for (let q = -1; q <= 1; q++) geo.line(p.x - hb * 0.4, topY + 0.01, p.z + q * 0.12, p.x + hb * 0.4, topY + 0.01, p.z + q * 0.12, c, la * 0.7); // 칩 줄
            for (let q = -1; q <= 1; q++) { geo.line(p.x + hb, H + 0.06, p.z + q * 0.2, p.x + hb + 0.08, H + 0.02, p.z + q * 0.2, c, la * 0.6); geo.line(p.x - hb, H + 0.06, p.z + q * 0.2, p.x - hb - 0.08, H + 0.02, p.z + q * 0.2, c, la * 0.6); } } // 핀
          else if (sub === 'doc') geo.line(p.x + hb - 0.16, topY + 0.01, p.z - hb, p.x + hb, topY + 0.01, p.z - hb + 0.16, c, la);      // 귀 접힘
          else if (sub === 'data') { for (let q = -1; q <= 1; q += 2) { geo.line(p.x + q * hb / 3, topY + 0.01, p.z - hb, p.x + q * hb / 3, topY + 0.01, p.z + hb, c, la * 0.6); geo.line(p.x - hb, topY + 0.01, p.z + q * hb / 3, p.x + hb, topY + 0.01, p.z + q * hb / 3, c, la * 0.6); } }
          else if (sub === 'image') { const fy = H + 0.08, fh = Math.max(0.35, labBlockHeight(it)) * hk; geo.line(p.x - hb * 0.85, fy, p.z + 0.06, p.x + hb * 0.85, fy + fh, p.z + 0.06, c, la * 0.8); geo.rect(p.x - hb, H + 0.085, p.z - hb, p.x + hb, p.z + hb, c, la * 0.6); }
          else if (sub === 'plan') { for (let q = -2; q <= 2; q++) geo.line(p.x - hb, H + 0.085, p.z + q * 0.16, p.x + hb, H + 0.085, p.z + q * 0.16, c, la * 0.45); }
        }
      }
      // 기자재발 쓰기(e.tu = bg 기자재 toolUseId): 기자재 꼭대기 → 블록 공급선(사람발은 beams 가 이미 그림)
      if (oa && oa.e && env.actOrigin && (oa.a === 'build' || oa.a === 'edit') && oa.k < 0.5 && !red && geo.nl < LP.LINE_SOFT) {
        const o = env.actOrigin(oa.e);
        if (o) geo.line(o.x, o.y, o.z, p.x, topY + 0.3, p.z, oa.a === 'build' ? KI.new : KI.write, 0.6 * (1 - oa.k / 0.5), 2);
      }
      // 3D 프린트: 칸 바닥 격자 + 프린트 갠트리(양옆 레일 2 · 헤드 상자가 반지름 방향 4줄 래스터 · 헤드 아래 레이저). detail 미만이면 헤드만
      if (print >= 0 && print < 1 && !red) {
        const hy = H + h0 * hk + 0.02 + lift, a = 0.9 * (1 - Math.max(0, print - 0.85) / 0.15);
        if (geo.nl < LP.LINE_SOFT) {
          for (let q = -1; q <= 1; q++) { geo.line(p.x - hb, H + 0.01, p.z + q * hb, p.x + hb, H + 0.01, p.z + q * hb, KI.new, a * 0.4); geo.line(p.x + q * hb, H + 0.01, p.z - hb, p.x + q * hb, H + 0.01, p.z + hb, KI.new, a * 0.4); }
          geo.rect(p.x - hb - 0.06, hy, p.z - hb - 0.06, p.x + hb + 0.06, p.z + hb + 0.06, KI.new, a);
        }
        const rx = -tz, rz = tx; // 반지름(바깥) 방향 = (sinθ, cosθ)
        const u = Math.min(1, print / 0.85), row = Math.min(3, Math.floor(u * 4)), f = u * 4 - row;
        const ro = (row - 1.5) * (hb * 0.5), so = (row % 2 ? 1 - f : f) * 2 * hb - hb; // 줄(반지름 쪽 자리) · 줄 안 위치(접선, 왕복)
        const gy = hy + 0.28, gx = p.x + rx * ro + tx * so, gz = p.z + rz * ro + tz * so;
        geo.box(gx, gy, gz, 0.2, 0.08, 0.2, KI.new, Math.min(1, a + 0.1), null); // 헤드
        if (detail && geo.nl < LP.LINE_SOFT) {
          const RL = hb + 0.15, RO = hb + 0.12;
          for (let q = -1; q <= 1; q += 2) geo.line(p.x + tx * q * RO - rx * RL, gy, p.z + tz * q * RO - rz * RL, p.x + tx * q * RO + rx * RL, gy, p.z + tz * q * RO + rz * RL, KI.new, a, 2); // 레일 2
          geo.line(p.x - tx * RO + rx * ro, gy, p.z - tz * RO + rz * ro, p.x + tx * RO + rx * ro, gy, p.z + tz * RO + rz * ro, KI.new, a * 0.7); // 가로대(헤드가 탄 줄)
          geo.line(gx, gy - 0.04, gz, gx, hy, gz, KI.new, a); // 레이저
        }
      }
      // 고치기: 안쪽 빛 + 바뀌는 얇은 층 · 윗판 교체(k < 0.4 옛 판이 접선으로 0.5m 밀려 나가며 흐려짐 → 0.4～0.8 새 판(호박)이 0.6m 위에서 떨어져 앉음)
      if (editing) {
        const a = 0.85 * Math.sin(editK * Math.PI), nL = Math.min(4, 1 + Math.round(Math.log10(1 + (oa ? oa.sz : 0) + 1) * 2));
        if (geo.nl < LP.LINE_SOFT) for (let q = 0; q < nL; q++) { const ly = topY - 0.05 - q * 0.07; if (ly <= H) break; geo.rect(p.x - hb - 0.02, ly, p.z - hb - 0.02, p.x + hb + 0.02, p.z + hb + 0.02, KI.write, a * (1 - q * 0.2)); }
        if (gone < 1) {
          if (red) geo.box(p.x, topY + TH / 2, p.z, PB, TH, PB, KI.write, 0.85, null);
          else if (editK < 0.4) { const v = ease(editK / 0.4), d = 0.5 * v; geo.box(p.x + tx * d, topY + TH / 2, p.z + tz * d, PB, TH, PB, shape[shape.length - 1].c, 0.85 * (1 - 0.75 * v), null); }
          else { const v = Math.min(1, (editK - 0.4) / 0.4); geo.box(p.x, topY + TH / 2 + 0.6 * (1 - v * v), p.z, PB, TH, PB, KI.write, 0.85, null); }
        }
        if (editK >= 0.8 && editT != null) edgeMark(env, key, editT); // 앉은 뒤 호박 테 1.5초
      }
      // 고친 뒤 호박 테(EDGE_S, 연출 시계)
      const EG = env._edge ? env._edge.get(key) : undefined;
      if (EG !== undefined) { const d = now - EG; if (d >= 0 && d < LP.EDGE_S) geo.rect(p.x - hb - 0.05, topY + 0.006, p.z - hb - 0.05, p.x + hb + 0.05, p.z + hb + 0.05, KI.write, 0.8 * (1 - d / LP.EDGE_S)); else if (d >= LP.EDGE_S || d < -5) env._edge.delete(key); }
      // 지우기: 복셀 조각이 흩어져 칸 바닥 틈으로 떨어짐
      if (shatter >= 0 && shatter < 1 && !red) {
        const k = shatter;
        for (let q = 0; q < 8; q++) {
          const ang = (q / 8) * Math.PI * 2 + 0.4, r = 0.2 + 0.9 * ease(Math.min(1, k * 1.5));
          const y = H + h0 * 0.6 + 0.8 * k - 2.2 * k * k;
          if (y < H - 0.6) continue;
          geo.box(p.x + Math.cos(ang) * r, y, p.z + Math.sin(ang) * r, 0.16, 0.16, 0.16, q % 2 ? KI.del : shape[0].c, 0.8 * (1 - k), null);
        }
        geo.line(p.x - hb, H + 0.01, p.z, p.x + hb, H + 0.01, p.z, KI.del, 0.6 * (1 - k)); // 바닥 틈
      }
      // 읽기: 스캔 고리가 아래 → 위로 · 파란 세로 스캔 막이 윗면을 접선 방향으로 훑음 + 파란 테(0.8 → 0) — 높이·윗판 색은 그대로(쓰기와 구별)
      if (scan >= 0 && scan < 1) {
        const y = H + h0 * hk * (red ? 1 : ease(scan)) + 0.02 + lift, a = 0.85 * (1 - scan * 0.6);
        geo.rect(p.x - hb - 0.08, y, p.z - hb - 0.08, p.x + hb + 0.08, p.z + hb + 0.08, KI.read, a);
        geo.rect(p.x - hb - 0.03, topY + 0.008, p.z - hb - 0.03, p.x + hb + 0.03, p.z + hb + 0.03, KI.read, 0.8 * (1 - scan));
        if (!red) {
          geo.rect(p.x - hb - 0.04, Math.max(H, y - 0.15), p.z - hb - 0.04, p.x + hb + 0.04, p.z + hb + 0.04, KI.read, a * 0.4);
          const alongX = Math.abs(tx) >= Math.abs(tz), sw = (scan * 2 - 1) * hb; // 축 정렬 상자: 접선에 가까운 축으로 훑음
          geo.box(p.x + (alongX ? sw * (tx < 0 ? -1 : 1) : 0), topY + 0.15, p.z + (alongX ? 0 : sw * (tz < 0 ? -1 : 1)), alongX ? 0.03 : 0.9, 0.5, alongX ? 0.9 : 0.03, KI.read, 0.55 * (1 - 0.5 * scan), null);
        }
      }
      if (it.imp) shield(geo, p.x, topY + 0.45, p.z, la, 0.18);
      if (it.x && it.x !== 'overwrite' && nowMs - (it.xAt || 0) < ART.ALARM_MS) geo.rect(p.x - hb - 0.1, H + 0.01, p.z - hb - 0.1, p.x + hb + 0.1, p.z + hb + 0.1, KI.alarm, 0.45 + 0.4 * lit); // 최근 10분 파괴적 = 붉은 테
      if ((sel || lit > 0.3) && budget > 0) { geo.label(p.x, topY + 0.5, p.z, it.n || it.id, 'art-item', it.k === 'zone' ? 'zone' : 'file', sel ? 1 : Math.min(1, lit + 0.2)); budget--; }
      const ay = H + Math.max(0.2, h0 * hk * 0.6);
      if (want && want.has(key)) { const R = AP.put(key, p.x, ay, p.z, topY, H, 0.9); setOut(R, c.theta); }
      beams(geo, it, env, foot, lit, nowMs, LA, p.x, ay, p.z);
      fxRings(geo, fl, now, p.x, H, p.z, 1);
      if (env.hits) env.hits.push({ pid, id, x: p.x, y: ay, z: p.z, r: 0.45 });
    }
    // ── 원경·구역 판: 판 윗면 바깥 테 = 구역 안 가장 진한 동사 색, 안쪽 테 = 활동 열(선 하나씩) ──
    if (plates) for (const s of P.sectors) {
      if (!s.n || (s._ta <= 0.01 && s._ha <= 0.01)) continue;
      const h = 0.12 + 0.18 * Math.log2(1 + s.n), yy = H + h + 0.01;
      if (s._ta > 0.01 && s._tk) arc(P.rOut - 0.1, s.th0 + 0.8, s.th1 - 0.8, yy, KI[s._tk], 0.35 + 0.5 * s._ta, 4, 2);
      if (s._ha > 0.01) arc(P.rIn + 0.1, s.th0 + 0.8, s.th1 - 0.8, yy, KI.write, Math.min(1, s._ha * 2.4), 3, 2);
    }
    // ── 테두리 장치·코어 ──
    const pushes = { n: 0 };
    let coreSpin = 0, pillar = -1, coreAlarm = false;
    for (const [id, s] of P.rim) {
      const it = book.get(pid, id); if (!it) continue;
      const key = pid + '|' + id, lit = M.litBy.get(key) || 0, sel = !!(env.hover && env.hover.pid === pid && env.hover.id === id);
      const fr = freshness(nowMs - (it.last || 0)), dim = foot ? (foot.has(id) ? 1.6 : 0.3) : 1;
      const { la } = itemAlpha(A, fr, dim, lit, sel, env.isLight);
      const fl = M.fxBy.get(key) || null, st = fxState(fl, now, red, FS);
      const p = W(s.x, s.z), col = it.del ? KI.del : KI[it.k] ?? KI.file, ref = { pid, id };
      const alarm = it.x && it.x !== 'overwrite' && nowMs - (it.xAt || 0) < ART.ALARM_MS;
      let ay = s.y + 0.5, top = s.y + 1.5;
      if (far) {
        if (lit > 0.05 || it.imp) geo.dot(p.x, s.y + 0.5, p.z, 0.35, it.imp ? KI.imp : col, Math.max(la, 0.5 * lit + 0.2));
      } else if (s.k === 'repo') {
        pushes.n += (it.cnt && it.cnt.push) || 0;
        if (alarm) coreAlarm = true;
        if (fl) for (const e of fl) { if (e.kind === 'absorb') { const k = (now - e.t0) / e.dur; if (k >= 0 && k < 1) pillar = Math.max(pillar, k); } }
        coreSpin = Math.max(coreSpin, st.spin);
        if (s.i === 0) { ay = H + LAB.PLATFORM.CORE_H * 0.6; top = H + LAB.PLATFORM.CORE_H + 0.4; }
        else { // 작은 코어
          geo.cyl(p.x, H + 0.5, p.z, 0.32, 1.0, col, 0.35 + 0.4 * lit, ref);
          geo.ring(p.x, H + 1.02, p.z, 0.34, col, la, 12);
          ay = H + 0.6; top = H + 1.4;
        }
        if (budget > 0 && (lit > 0.3 || sel)) { geo.label(p.x, top + 0.3, p.z, it.n || id, 'art-item', 'repo', 1); budget--; }
      } else if (s.k === 'db') { // 유리 탱크 + 수위 + 컬렉션 띠 + 코어 파이프
        const tr = 0.55, th = 1.6, lv = dbLevel(it), y0 = H;
        geo.cyl(p.x, y0 + th / 2, p.z, tr, th, col, 0.12 + 0.2 * lit, ref);
        const lift = st.spin > 0 && !red ? 0.15 * st.spin : 0;
        geo.cyl(p.x, y0 + (th * lv + lift) / 2, p.z, tr * 0.9, Math.max(0.05, th * lv + lift), col, 0.45 + 0.35 * lit, ref);
        geo.ring(p.x, y0 + th, p.z, tr, col, la, 16); geo.ring(p.x, y0 + 0.02, p.z, tr, col, la * 0.7, 16);
        const nc = Math.min(4, (it.coll || []).length);
        for (let q = 0; q < nc; q++) geo.ring(p.x, y0 + 0.3 + q * 0.3, p.z, tr + 0.03, col, la * 0.5, 12, true);
        // 파이프(탱크 바닥 → 코어 바닥) + 쓰기 때 빛 방울
        const c0 = polar(cx, cz, LAB.PLATFORM.CORE_R, s.theta);
        geo.line(p.x, y0 + 0.08, p.z, c0.x, y0 + 0.08, c0.z, col, la * 0.6);
        if (st.spin > 0 && !red) for (let q = 0; q < 3; q++) { const u = (1 - st.spin + q * 0.18) % 1; geo.dot(p.x + (c0.x - p.x) * u, y0 + 0.12, p.z + (c0.z - p.z) * u, 0.13, KI.write, 0.9 * st.spin); }
        ay = y0 + th * 0.6; top = y0 + th + 0.4;
        if (budget > 0 && (lit > 0.3 || sel || cellPx > 22)) { geo.label(p.x, top + 0.2, p.z, it.n || id, 'art-item', 'db', Math.max(0.5, la)); budget--; }
      } else if (s.k === 'remote') { // 접시 안테나(바깥 방향) + 외벽 밖으로 점선 빔
        const y0 = H, mh = 1.4, eu = { x: Math.sin(s.theta * DEG), z: Math.cos(s.theta * DEG) }, ev = { x: eu.z, z: -eu.x };
        geo.line(p.x, y0, p.z, p.x, y0 + mh, p.z, col, la);
        geo.box(p.x, y0 + 0.1, p.z, 0.4, 0.2, 0.4, col, BODY * 1.3, ref);
        const dc = { x: p.x + eu.x * 0.15, y: y0 + mh + 0.35, z: p.z + eu.z * 0.15 }, dr = 0.45;
        for (let q = 0; q < 12; q++) { const a0 = (q / 12) * Math.PI * 2, a1 = ((q + 1) / 12) * Math.PI * 2;
          geo.line(dc.x + ev.x * Math.cos(a0) * dr, dc.y + Math.sin(a0) * dr, dc.z + ev.z * Math.cos(a0) * dr, dc.x + ev.x * Math.cos(a1) * dr, dc.y + Math.sin(a1) * dr, dc.z + ev.z * Math.cos(a1) * dr, col, la); }
        const fpt = { x: dc.x + eu.x * 0.5, y: dc.y, z: dc.z + eu.z * 0.5 };
        for (const a0 of [0, 2.1, 4.2]) geo.line(dc.x + ev.x * Math.cos(a0) * dr, dc.y + Math.sin(a0) * dr, dc.z + ev.z * Math.cos(a0) * dr, fpt.x, fpt.y, fpt.z, col, la * 0.6);
        const L = (E.rWall ? E.rWall - rP : 12) + 4;
        dashed(geo, fpt.x, fpt.y, fpt.z, fpt.x + eu.x * L, fpt.y + 0.6, fpt.z + eu.z * L, col, la * (0.5 + 0.5 * lit), 10);
        if (st.pulse > 0 && !red) { const u = 1 - st.pulse; geo.dot(fpt.x + eu.x * L * u, fpt.y + 0.6 * u, fpt.z + eu.z * L * u, 0.16, KI.write, 0.9); }
        if (it.imp === 'prod') geo.ring(p.x, y0 + mh * 0.7, p.z, 0.12, KI.alarm, 0.8, 10);
        ay = dc.y; top = dc.y + 0.6;
        if (budget > 0 && (lit > 0.3 || sel || cellPx > 22)) { geo.label(p.x, top + 0.2, p.z, it.n || id, 'art-item', 'remote', Math.max(0.5, la)); budget--; }
      } else if (s.k === 'service') { // 떠 있는 위성 단말(상자 + 전지판) + 호출 때 맥동·바닥 신호파
        const bob = red ? 0 : 0.08 * Math.sin(t * 1.3 + s.i), y = s.y + bob, ev = { x: Math.cos(s.theta * DEG), z: -Math.sin(s.theta * DEG) };
        geo.box(p.x, y, p.z, 0.32, 0.32, 0.32, col, BODY * 1.5 + 0.4 * lit, ref);
        for (const sg of [-1, 1]) { const a0 = { x: p.x + ev.x * sg * 0.2, z: p.z + ev.z * sg * 0.2 }, a1 = { x: p.x + ev.x * sg * 0.75, z: p.z + ev.z * sg * 0.75 };
          geo.line(a0.x, y + 0.1, a0.z, a1.x, y + 0.1, a1.z, col, la); geo.line(a0.x, y - 0.1, a0.z, a1.x, y - 0.1, a1.z, col, la); geo.line(a1.x, y - 0.1, a1.z, a1.x, y + 0.1, a1.z, col, la); }
        const pr = 0.3 * (1 + 1.4 * st.pulse);
        geo.ring(p.x, y, p.z, pr, col, la * (1 - 0.5 * st.pulse), 12, true, t * 0.6);
        if (st.pulse > 0 && !red) geo.ring(p.x, H + 0.03, p.z, 0.4 + 1.6 * (1 - st.pulse), col, 0.6 * st.pulse, 18);
        if ((cellPx > 14 || lit > 0.05 || sel) && budget > 0) { geo.label(p.x, y + 0.45, p.z, String(it.n || '?').slice(0, 1).toUpperCase(), 'art-glyph', 'service', Math.max(0.5, la)); budget--; }
        ay = y; top = y + 0.6;
      } else if (s.k === 'output') { // 반출대 위 결과물
        const sh = outShape(it), y = s.y, rise = st.rise * 0.6;
        if (sh === 'book') { geo.box(p.x, y + 0.07 + rise, p.z, 0.42, 0.14, 0.32, col, BODY * 1.6, ref); geo.line(p.x - 0.21, y + 0.15 + rise, p.z - 0.16, p.x - 0.21, y + 0.15 + rise, p.z + 0.16, col, la); }
        else if (sh === 'table') { geo.box(p.x, y + 0.03 + rise, p.z, 0.46, 0.05, 0.36, col, BODY * 1.4, ref); for (const q of [-1, 0, 1]) geo.line(p.x - 0.23, y + 0.06 + rise, p.z + q * 0.1, p.x + 0.23, y + 0.06 + rise, p.z + q * 0.1, col, la * 0.7); }
        else if (sh === 'frame') { geo.box(p.x, y + 0.22 + rise, p.z, 0.42, 0.42, 0.05, col, BODY * 1.4, ref); geo.line(p.x - 0.2, y + 0.02 + rise, p.z + 0.03, p.x + 0.2, y + 0.42 + rise, p.z + 0.03, col, la * 0.7); }
        else if (sh === 'film') { geo.cyl(p.x, y + 0.08 + rise, p.z, 0.22, 0.14, col, 0.5, ref); geo.ring(p.x, y + 0.16 + rise, p.z, 0.22, col, la, 12); }
        else if (sh === 'parcel') { geo.box(p.x, y + 0.15 + rise, p.z, 0.32, 0.3, 0.32, col, BODY * 1.5, ref); geo.line(p.x - 0.16, y + 0.31 + rise, p.z, p.x + 0.16, y + 0.31 + rise, p.z, col, la); geo.line(p.x, y + 0.31 + rise, p.z - 0.16, p.x, y + 0.31 + rise, p.z + 0.16, col, la); }
        else { geo.box(p.x, y + 0.3 + rise, p.z, 0.5, 0.55, 0.04, KI.new, 0.5 + 0.4 * lit, ref); geo.rect(p.x - 0.27, y + 0.02, p.z - 0.05, p.x + 0.27, p.z + 0.05, KI.new, la); } // Artifact = 빛나는 유리 패널
        if (it.imp === 'final') geo.line(p.x - 0.25, y + 0.2 + rise, p.z + 0.18, p.x + 0.25, y + 0.2 + rise, p.z - 0.18, KI.imp, Math.min(1, la + 0.3)); // 금빛 리본
        if ((lit > 0.05 || sel || cellPx > 22) && budget > 0 && !String(id).startsWith('artifact:')) { geo.label(p.x, y + 0.7 + rise, p.z, extOf(it.n || it.id) || 'OUT', 'art-ext', 'output', Math.max(0.45, la)); budget--; }
        ay = y + 0.2; top = y + 0.9;
      }
      if (it.imp && s.k !== 'output') shield(geo, p.x, top + 0.2, p.z, la, 0.2);
      if (alarm && s.k !== 'repo') geo.ring(p.x, H + 0.03, p.z, 0.8, KI.alarm, 0.45 + 0.4 * lit, 20);
      if ((sel || lit > 0.3) && budget > 0 && s.k === 'service') { geo.label(p.x, top + 0.3, p.z, it.n || id, 'art-item', it.k, 1); budget--; }
      if (want && want.has(key)) { const R = AP.put(key, p.x, ay, p.z, top, H, 1.0); setOut(R, s.theta); }
      if (!far) beams(geo, it, env, foot, lit, nowMs, LA, p.x, ay, p.z);
      fxRings(geo, fl, now, p.x, H, p.z, 1.2);
      if (env.hits) env.hits.push({ pid, id, x: p.x, y: ay, z: p.z, r: 0.5 });
    }
    // ── 저장소 코어: 커밋 눈금 고리 + push 흡입·빛기둥 ──
    {
      const CR = LAB.PLATFORM.CORE_R, CH = LAB.PLATFORM.CORE_H, ty = H + CH + 0.06;
      // 눈금 고리 회전 = 누적 위상(속도 0.15 + 0.12·최근 10초 쓰기 수, 상한 1.2 rad/s, 쉬면 멈춤 · dt ≤ 0.25 · 되감기면 0)
      let ce = coreM.get(pid); if (!ce) { ce = { ph: 0, at: null, ts: [] }; coreM.set(pid, ce); }
      const cdt = ce.at == null ? 0 : Math.max(0, Math.min(LP.CORE_DT, now - ce.at)); ce.at = now;
      while (ce.ts.length && (now - ce.ts[0] > LP.CORE_WIN || ce.ts[0] > now + 1)) ce.ts.shift();
      const n10 = ce.ts.length, wsp = n10 ? Math.min(LP.CORE_WMAX, LP.CORE_W0 + LP.CORE_WK * n10) : 0;
      if (!red) ce.ph += wsp * cdt;
      const ticks = Math.max(4, Math.min(16, 4 + pushes.n)), ph = red ? 0 : coreSpin * 3 + ce.ph;
      // 쓰기마다 코어 바깥으로 퍼지는 호박 고리(CORE_R → +1.6, 0.9초(배속이면 연출 길이까지), 최근 3겹) — 원경·움직임 줄이기면 생략
      if (fx && !red && !far) {
        let nr = 0;
        for (let i = fx.list.length - 1; i >= 0 && nr < LP.CORE_RINGS; i--) {
          const e = fx.list[i];
          if ((e.kind !== 'rise' && e.kind !== 'pulse') || e.pid !== pid) continue;
          const kk = (now - e.t0) / Math.min(LP.CORE_RING_S, e.dur);
          if (kk < 0 || kk >= 1) continue;
          ringW(geo, cx, Y + 0.06, cz, CR + LP.CORE_RING_DR * ease(kk), KI.write, 0.85 * (1 - kk), 24, 2); nr++;
        }
      }
      for (let q = 0; q < ticks; q++) { const a = ph + (q / ticks) * Math.PI * 2; geo.line(cx + Math.cos(a) * (CR + 0.12), ty, cz + Math.sin(a) * (CR + 0.12), cx + Math.cos(a) * (CR + 0.35), ty, cz + Math.sin(a) * (CR + 0.35), coreAlarm ? KI.alarm : KI.repo, LA * 0.9 + 0.4 * coreSpin); }
      geo.ring(cx, ty, cz, CR + 0.12, KI.repo, LA * 0.7, 24);
      if (pillar >= 0) {
        const a = 0.9 * (1 - pillar);
        if (!red) { // 최근 블록에서 코어로 빨려 드는 빛 조각
          let q = 0;
          for (const [, c] of P.cellOf) {
            if (q >= 6) break;
            const u = ease(Math.min(1, Math.max(0, pillar * 1.5 - q * 0.08))); q++;
            if (u <= 0 || u >= 1) continue;
            const x0 = cx + c.x, z0 = cz + c.z;
            geo.dot(x0 + (cx - x0) * u, H + 0.5 + Math.sin(u * Math.PI) * 1.2 + (CH - 0.5) * u, z0 + (cz - z0) * u, 0.14, KI.repo, 0.9);
          }
          const hgt = 7 * ease(Math.min(1, pillar * 2.5));
          for (let q = 0; q < 6; q++) { const a0 = (q / 6) * Math.PI * 2 + t; geo.line(cx + Math.cos(a0) * 0.5, ty, cz + Math.sin(a0) * 0.5, cx + Math.cos(a0) * 0.3, ty + hgt, cz + Math.sin(a0) * 0.3, KI.repo, a); }
        }
        geo.ring(cx, ty + 0.02, cz, CR + 0.5 + 1.5 * pillar, KI.repo, a * 0.7, 24);
      }
    }
    // ── 레이더(Grep·Glob): 코어에서 고리가 퍼지고 훑는 선 ──
    for (let ri = 0; ri < nRadar; ri++) {
      const R = radar[ri];
      if (R.pid !== pid) continue;
      const k = R.k, r = LAB.PLATFORM.CORE_R + (rP - LAB.PLATFORM.CORE_R) * (red ? 0.6 : ease(k)), a = 0.8 * (1 - k);
      geo.ring(cx, Y + 0.02, cz, r, KI.read, a, 36);
      if (!red) { const sw = k * Math.PI * 4; geo.line(cx, Y + 0.03, cz, cx + Math.cos(sw) * rP, Y + 0.03, cz + Math.sin(sw) * rP, KI.read, a * 0.8); }
    }
    // ── 위험 동작: 붉은 파문 3겹(구역 중심, 굵은 고리) + 경광등 4(기둥 + 발광 점 + 회전 빔) — 연출 dur 동안.
    //    그 뒤 10분(경보 구역·장치가 남은 동안)은 경광등 기둥만 느린 맥동. 원경(far·plates)에서도 같음 ──
    const ak = alarmFx ? (now - alarmFx.t0) / alarmFx.dur : -1, ringing = ak >= 0 && ak < 1;
    if (ringing) {
      const c = P.cellOf.get(alarmFx.id), rim = P.rim.get(alarmFx.id), sk = c ? c.sector : P.bundleOf.get(alarmFx.id);
      const s = sk ? secByKey.get(sk) : null, q0 = _qa;
      if (s) polar(cx, cz, (P.rIn + P.rOut) / 2, (s.th0 + s.th1) / 2, q0); else if (rim) { q0.x = cx + rim.x; q0.z = cz + rim.z; } else { q0.x = cx; q0.z = cz; }
      for (let q = 0; q < (red ? 1 : 3); q++) { const kk = red ? 0.4 : ak * 1.25 - q * 0.18; if (kk <= 0 || kk >= 1) continue; ringW(geo, q0.x, Y + 0.05, q0.z, 0.6 + kk * 6, KI.alarm, 0.95 * (1 - kk), 32, LP.FX_W); }
      if (fxLabel()) { const it = book.get(pid, alarmFx.id); geo.label(q0.x, Y + 2.6, q0.z, '⚠ ' + (it && it.n ? it.n : alarmFx.x || ''), 'art-alarm', 'alarm', 1 - ak * 0.5); }
    }
    if (ringing || AS.any) {
      for (const b of LP.BEACONS) {
        const bp = polar(cx, cz, rP - 0.25, b, _q1), bx = bp.x, bz = bp.z;
        if (ringing) {
          geo.cyl(bx, H + LP.BEACON_H / 2, bz, LP.BEACON_R, LP.BEACON_H, KI.alarm, 0.85, null);
          const by = H + LP.BEACON_H + 0.15;
          geo.dot(bx, by, bz, LP.BEACON_DOT, KI.alarm, red ? 0.9 : 0.6 + 0.4 * Math.abs(Math.sin(ak * 14)));
          if (!red) {
            const a0 = ak * Math.PI * 6 + b * DEG, L = LP.BEACON_BEAM, ba = 0.85 * (1 - 0.6 * ak);
            geo.line(bx, by, bz, bx + Math.cos(a0) * L, by - 0.15, bz + Math.sin(a0) * L, KI.alarm, ba, LP.FX_W);
            geo.line(bx, by, bz, bx - Math.cos(a0) * L, by - 0.15, bz - Math.sin(a0) * L, KI.alarm, ba, LP.FX_W);
          }
        } else geo.cyl(bx, H + LP.BEACON_H / 2, bz, LP.BEACON_R, LP.BEACON_H, KI.alarm, red ? 0.45 : 0.475 + 0.125 * Math.sin(t * 1.6 + b * DEG), null); // 남은 경보: 기둥만 느린 맥동 0.35～0.6
      }
    }
  }
  // ── 캡슐 운반: carry(쓰기 시작 = 호박 시료 캡슐 출발점 → 블록) · pour(DB 쓰기 → 탱크) · 읽기 귀환(블록 → 사람·기자재, 파란 캡슐 2～3) ──
  //    출발점 = env.actOrigin(e)(bg 기자재 꼭대기 — e.tu 가 그 기자재 toolUseId) → 없으면 env.nodePos(e.node) → 없으면 대상 위 하늘
  for (let i = 0; i < nTrip; i++) {
    const TR = trips[i], e = TR.e, k = TR.k;
    const T = AP.get(e._lpk || (e._lpk = e.pid + '|' + e.id)); if (!T) continue;
    if (!geo.pidStart(env, e.pid)) continue;
    const upx = env.unitPx ? env.unitPx(e.pid) : 20, cpx = LP.CELL * upx, farT = cpx < ART.LOD_PX, tail = cpx >= ART.DETAIL_PX ? 3 : 0;
    const o = (env.actOrigin && env.actOrigin(e)) || (e.node && env.nodePos ? env.nodePos(e.node) : null);
    if (o) { _oa.x = o.x; _oa.y = o.y; _oa.z = o.z; } else { _oa.x = T.x; _oa.y = T.top + 6; _oa.z = T.z; }
    _ob.x = T.x; _ob.y = T.top + 0.1; _ob.z = T.z;
    if (e.a === 'read') {
      if (red) continue; // 움직임 줄이기: 스캔 테만(블록 절)
      const n = farT ? 1 : e.n > 1 ? 3 : 2;
      for (let q = 0; q < n; q++) { const u = (k - 0.25 - q * 0.12) / 0.6; if (u > 0 && u < 1) capsule(geo, _ob, _oa, smooth(u), LP.CAP_LIFT * 0.8, KI.read, 0.9 * (1 - 0.6 * u), 0.14, tail ? 2 : 0); }
      continue;
    }
    if (red) { geo.ring(_ob.x, _ob.y, _ob.z, 0.45, KI.write, 0.7 * (1 - k), 16); continue; } // 정지 도형: 도착 자리 고리만
    const n = farT ? 1 : Math.min(3, e.n || 1);
    for (let q = 0; q < n; q++) { const u = (k - q * 0.15) / 0.75; if (u >= 0 && u < 1) capsule(geo, _oa, _ob, smooth(u), LP.CAP_LIFT, KI.write, 1 - 0.7 * u, LP.CAP_S, tail); }
    if (k > 0.75) { const v = (k - 0.75) / 0.25; geo.ring(_ob.x, _ob.y, _ob.z, 0.25 + 0.45 * v, KI.write, 0.7 * (1 - v), farT ? 10 : 16); } // 도착 링
  }
  geo.ka = 1;
  if (AC && rest.list.length) drawActs(geo, rest, now, { theme: 'lab', unitPx: env.unitPx || null, KI, pos: AP, zoneOf: zoneKeyOf, book, nodePos: env.nodePos, reduced: env.reduced, isLight: env.isLight, pidAlpha: env.pidAlpha || null });
  return geo;
}

const _q0 = {}, _q1 = {}, _qa = { x: 0, z: 0 }, _pw = { x: 0, z: 0 };
const smooth = (u) => u * u * (3 - 2 * u); // 떠오름·내려앉음(캡슐 운반)
const _tint = { key: null, a: 0, d: 0 }, _oa = { x: 0, y: 0, z: 0 }, _ob = { x: 0, y: 0, z: 0 };
/** 대량 변경 파도 블록 튐: 0.25·max(0, 1 − |r − 파두|/칸)·sin(π·k) */
export function waveLift(r, rFront, k) {
  const kk = k <= 0 ? 0 : k >= 1 ? 1 : k;
  return LP.WAVE_LIFT * Math.max(0, 1 - Math.abs(r - rFront) / LP.CELL) * Math.sin(Math.PI * kk);
}
/** 고친 뒤 호박 테 시각 기록(env._edge: 'pid|id' → 연출 시각 초, 최대 64) */
function edgeMark(env, key, t) {
  const m = env._edge || (env._edge = new Map());
  if (!m.has(key) && m.size >= 64) m.delete(m.keys().next().value);
  m.set(key, t);
}
/** 시료 캡슐: a → b 포물선(가운데 lift 높이) 위 u 지점 몸 상자 + 꼬리(앞선 자리, 점점 작고 옅게) */
function capsule(geo, a, b, u, lift, c, al, s, tail) {
  for (let q = 0; q <= tail; q++) {
    const uq = u - q * 0.06; if (uq < 0) break;
    const x = a.x + (b.x - a.x) * uq, y = a.y + (b.y - a.y) * uq + Math.sin(Math.PI * uq) * lift, z = a.z + (b.z - a.z) * uq, sq = s * (1 - q * 0.22);
    geo.box(x, y, z, sq, sq, sq, c, al * (1 - q * 0.25), null);
  }
}
/** 굵은 수평 고리(geo.ring 은 선 폭을 넘기지 못하므로 여기서 w 를 줌) */
function ringW(geo, x, y, z, r, c, a, seg, w) {
  for (let s = 0; s < seg; s++) { const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2; geo.line(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, c, a, w); }
}
/** 블록 모양 캐시(대상 항목이 바뀔 때만 다시 — 장부 항목은 접촉 때 last·del·imp 가 바뀜) */
const _shapes = new WeakMap();
function shapeOf(env, it) { // eslint-disable-line no-unused-vars
  let e = _shapes.get(it);
  if (!e || e.last !== it.last || e.del !== it.del || e.imp !== it.imp || e.sz !== it.sz) {
    const shape = labBlockShape(it);
    e = { last: it.last, del: it.del, imp: it.imp, sz: it.sz, shape, sub: labBlockSub(it), hf: labBlockHeight(it), h0: shape.reduce((m, b) => Math.max(m, b.dy + b.sy / 2), 0.05) };
    _shapes.set(it, e);
  }
  return e;
}
/**
 * 경보 구역 바닥 판 조각(순수·할당 0): 칸 띠 [rIn, rOut] × 각 [th0, th1](도)의 쐐기를 극좌표 칸(반지름 ALARM_TILE_ROWS 줄 ×
 * 호 방향 칸 ≈ 정사각)으로 나누고, 칸마다 그 칸 안에 들어가는 가장 큰 축 정렬 정사각형(돌아간 칸 안 — 한 변 = min(깊이, 호 폭) ÷ (|sinθ|+|cosθ|))을
 * out[i] = {x, z(중심 기준), s(한 변)} 로 채운다. 반환 = 개수(≤ ALARM_TILE_MAX). 모든 꼭짓점이 쐐기 안(코어·바깥 테·이웃 구역 침범 0).
 */
export const ALARM_TILE_ROWS = 3, ALARM_TILE_MAX = 48;
export function alarmPlateTiles(rIn, rOut, th0, th1, out, rows = ALARM_TILE_ROWS) { // rows: 파도 판은 1 줄
  const w = rOut - rIn, span = th1 - th0;
  if (!(w > 0) || !span) return 0;
  const dr = w / rows, perRow = Math.floor(ALARM_TILE_MAX / rows);
  let n = 0;
  for (let i = 0; i < rows; i++) {
    const r = rIn + dr * (i + 0.5);
    const nt = Math.max(1, Math.min(perRow, Math.round((Math.abs(span) * DEG * r) / dr)));
    const dth = span / nt;
    for (let j = 0; j < nt; j++) {
      const th = th0 + dth * (j + 0.5), a = th * DEG, sa = Math.abs(Math.sin(a)), ca = Math.abs(Math.cos(a));
      // 칸(반지름 dr × 안쪽 호 현 길이 — 칸 안쪽 가장자리가 가장 좁음)을 그 방향으로 돌린 직사각형으로 보고, 그 안의 축 정렬 정사각형
      const chord = 2 * (r - dr / 2) * Math.sin((Math.abs(dth) * DEG) / 2);
      const side = (0.92 * Math.min(dr, chord)) / (sa + ca);
      if (!(side > 0.05)) continue;
      const T = out[n] || (out[n] = { x: 0, z: 0, s: 0 });
      T.x = r * Math.sin(a); T.z = r * Math.cos(a); T.s = side; n++;
    }
  }
  return n;
}
const _tiles = [];
/** 최근 10분(ART.ALARM_MS) 파괴적(덮어쓰기 제외) 대상인가 */
export const isAlarmItem = (x, nowMs) => !!(x && x.x && x.x !== 'overwrite' && nowMs - (x.xAt || 0) < ART.ALARM_MS);
/**
 * 계획 P 에서 최근 10분 파괴적 대상이 있는 구역 열쇠 + 테두리 장치 경보 여부(3D·2D 공용, 순수). get(id) → 장부 항목.
 * 구역 칸(sectors[].cells[].key)·묶음(sectors[].bundle.ids)을 따라 보므로 cellOf 에 sector 가 없는 계획(2D 시험)도 됨.
 */
export function labAlarmSectors(P, get, nowMs) {
  const set = new Set(); let rim = false;
  for (const s of P.sectors || []) {
    let hit = false;
    for (const c of s.cells || []) if (c.key != null && isAlarmItem(get(c.key), nowMs)) { hit = true; break; }
    if (!hit && s.bundle && s.bundle.ids) for (const id of s.bundle.ids) if (isAlarmItem(get(id), nowMs)) { hit = true; break; }
    if (hit) set.add(s.key);
  }
  if (P.rim instanceof Map) for (const id of P.rim.keys()) if (isAlarmItem(get(id), nowMs)) { rim = true; break; }
  return { set, rim, any: set.size > 0 || rim };
}
/** 경보 상태 캐시(장부·계획이 바뀌거나 10초마다 다시) → {set, rim, any} */
function alarmSectors(book, pid, P, nowMs, env) {
  const C = env._alarm || (env._alarm = new Map());
  const key = book.version + '|' + Math.floor(nowMs / 10_000);
  let e = C.get(pid);
  if (e && e.key === key && e.plan === P) return e.r;
  e = { key, plan: P, r: labAlarmSectors(P, (id) => book.get(pid, id), nowMs) }; C.set(pid, e);
  return e.r;
}
/** 연출 기준점 바깥·앞 방향 = 방위 θ 바깥 */
function setOut(R, theta) { const a = theta * DEG; R.ox = Math.sin(a); R.oz = Math.cos(a); R.fx = R.ox; R.fz = R.oz; }
/** 공용 고리 연출(새 대상 고리·수정 맥동·덮어쓰기 호박 파문) — 경보 3겹은 구역 중심에서 따로 */
function fxRings(geo, fl, now, x, y0, z, C) {
  if (!fl) return;
  for (const e of fl) {
    const k = (now - e.t0) / e.dur; if (k < 0 || k >= 1) continue;
    if (e.kind === 'warn') geo.ring(x, y0 + 0.05, z, 0.5 + k * 2.5, KI.warn, 0.9 * (1 - k), 24);
    else if (e.kind === 'rise') geo.ring(x, y0 + 0.03, z, C * (0.45 + k), KI.new, 0.5 * (1 - k), 18);
  }
}

export { polar };
