// 【모듈 규격 · 연구소 상호작용 3D 그리기】 three 색만 씀(상자는 BoxBatch.box). 순수 판정·풀은 lab-ix-core.mjs.
//
// ┌ export ─────────────────────────────────────────────────────────────────────────────────────────┐
// │ drawLabIx(B, f, route, tt, te, A, ck, s, reduced, pal) → 쓴 상자 수(≤ LAB_IX.FX_MAX 12)                                │
// │     LabView._labIxDraw 가 부름(vx-ix draw 의 연구소 분기). route = labIxRoute 결과, tt·te = 효과 시작·끝 뒤 초,          │
// │     A = vxIxAlpha 잔광, ck = 효과 색(THREE.Color), s = vxIxScale 화면 하한 배율, pal = 색 공급자(VxIx: col(key)·ppu·vip)  │
// │     github(코어) = 캡슐 1 + 코어 링 + PR·CI 신호등 3칸 · db(DB 탱크) = 캡슐 2～5(읽기 파랑 탱크 → 책상, 쓰기 호박 책상 → 탱크) │
// │     + 탱크 위 물결 링 · remote(원격 안테나) = 캡슐 3 + 세로 빔 기둥(3.2·A) + 위/아래 점 · batch·tests 공급선(bg 기자재) = 캡슐 3 │
// │     · 포그라운드 tests(브리지 시험 신호탑) = 신호등 3칸 + 통과/실패 막대 · batch(코어) = 캡슐 3 + 코어 링                    │
// │ drawCouriers(G, L, list, n, now, pal, reduced, far) → 쓴 상자 수(≤ 96)  운반 캡슐(LabCouriers.list) — 판 + 발광 테 + 꼬리 2, │
// │     포물선(courierArc), 도착 0.25초 링. far = true(원경: 도착 링만) | 'mid'(중경: 꼬리 없음) | false. reduced = 도착점 정지 링  │
// │ drawWatchBeam(G, ax, ay, az, bx, by, bz, now, c, reduced) → 상자 수  들여다보기 빛줄(기자재 화면 → 손, 0.4초 맥동)           │
// │ hexColor(hex) → THREE.Color(캐시 — 종류색 캡슐·빛줄)                                                                 │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
// 프레임 할당 0: 색·끝점은 모듈 버퍼. 움직임 줄이기면 캡슐은 길 위 고정 자리, 깜빡임 없음.
import * as THREE from 'three';
import { LAB_IX, courierLod, courierArc } from './lab-ix-core.mjs';

const _c = new THREE.Color(), _c2 = new THREE.Color(), _w = new THREE.Color(0xffffff);
const _hex = new Map();
/** hex 문자열 → THREE.Color(캐시 — 같은 문자열이면 같은 객체, 캡슐 색 열쇠로 그대로 보관해도 됨) */
export function hexColor(h) { let c = _hex.get(h); if (!c) { c = new THREE.Color(h); _hex.set(h, c); } return c; }
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (u) => { u = clamp01(u); return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; };

/** 포물선 위 점(a → b, 진행 u, 높이 h) → 모듈 버퍼 _p */
const _p = { x: 0, y: 0, z: 0 };
function arcAt(ax, ay, az, bx, by, bz, u, h) {
  const e = ease(u);
  _p.x = ax + (bx - ax) * e; _p.y = ay + (by - ay) * e + Math.sin(e * Math.PI) * h; _p.z = az + (bz - az) * e;
  return _p;
}
/** 깜빡임(움직임 줄이기면 늘 켜짐) */
const blink = (red, t, hz) => red || Math.floor(t * hz) % 2 === 0;
/** 바닥 링(중심, 반지름, 상자 수 k) */
function ring(G, x, y, z, r, k, sz, c) {
  for (let i = 0; i < k; i++) { const a = (i / k) * Math.PI * 2; G.box(x + Math.cos(a) * r, y, z + Math.sin(a) * r, sz, 0.03, sz, c); }
  return k;
}

/** 연구소 특별 상호작용 한 효과(문서 머리). 반환 = 쓴 상자 수 */
export function drawLabIx(B, f, route, tt, te, A, ck, s, reduced, pal) {
  if (!route || !(A > 0.01)) return 0;
  const G = B.glow, ix = f.ix || {}, red = !!reduced;
  const a = route.from, b = route.to, out = route.dir !== 'in';
  const F = out ? a : b, T = out ? b : a; // 캡슐은 출발 F → 도착 T
  let used = 0;
  const cap = LAB_IX.FX_MAX;
  // 캡슐 흐름(진행 중 · 끝나면 잔광 A 만큼 남은 자리까지)
  const m = Math.min(5, route.m || 1);
  let cc = ck;
  if (f.cat === 'db') cc = pal.col(ix.rw === 'w' || ix.rw === 'rw' ? 'write' : 'read');
  const cs = 0.16 * (s || 1);
  for (let i = 0; i < m && used < cap; i++) {
    const u = red ? (i + 0.5) / m : (tt * 0.8 + i / m) % 1;
    if (te != null && u > A) continue;
    const p = arcAt(F.x, F.y, F.z, T.x, T.y, T.z, u, LAB_IX.CAPSULE_ARC);
    G.box(p.x, p.y, p.z, cs, cs, cs, cc); used++;
  }
  switch (route.key === 'supply' ? 'supply' : f.cat) {
    case 'github': {
      // 코어 위 링(쓰기마다 퍼지는 고리와 겹치지 않게 조금 위) + PR·CI 신호등 3칸
      const q = red ? 0.5 : (tt * 0.7) % 1;
      used += ring(G, b.x, b.y + 0.25, b.z, 0.5 + q * 0.9, 6, 0.1 * (s || 1), _c.copy(ck).multiplyScalar(0.35 + 0.65 * A * (1 - q)));
      const op = ix.op || f.op;
      if (op === 'pr-checks' || op === 'run' || ix.ci) {
        const ci = ix.ci || {}, running = te == null;
        const ls = 0.2 * Math.min(s || 1, 1.4);
        for (let i = 0; i < 3 && used < cap; i++) {
          // 0 실패 빨강 · 1 대기 노랑(실행 중 깜빡) · 2 통과 초록 — 끝나면 결과 하나만 고정
          const key = i === 0 ? 'err' : i === 1 ? 'warn' : 'ok';
          let on;
          if (running) on = i === 1 ? blink(red, tt, 3) : (i === 0 ? (ci.fail || 0) > 0 : (ci.pass || 0) > 0);
          else on = i === 0 ? f.ok === false || (ci.fail || 0) > 0 : i === 2 ? f.ok !== false && !(ci.fail > 0) : false;
          G.box(b.x - 0.3 + i * 0.3, b.y + 1.0, b.z, ls, ls, ls, on ? pal.col(key) : pal.col('dim'));
          used++;
        }
      }
      break;
    }
    case 'db': { // 탱크 위 물결 링
      const q = red ? 0.5 : (tt * 0.9) % 1;
      used += ring(G, b.x, b.y + 0.7, b.z, 0.35 + q * 0.7, 6, 0.09, _c.copy(ck).multiplyScalar(0.3 + 0.7 * A * (1 - q)));
      break;
    }
    case 'remote': { // 안테나 위 세로 빔 기둥 + 위(올림)/아래(내림) 점
      const up = ix.transfer !== 'down';
      const bw = pal.ppu > 0 ? Math.max(0.03, (pal.vip ? 3 : 2) / pal.ppu) : 0.03; // 가는 조각 화면 하한(vxIxThin 과 같은 식)
      const H = 3.2 * A;
      G.box(b.x, b.y + 0.6 + H / 2, b.z, bw, H, bw, _c.copy(ck).multiplyScalar(0.45)); used++;
      for (let i = 0; i < 4 && used < cap; i++) {
        const u = red ? (i + 0.5) / 4 : (tt * 0.9 + i / 4) % 1, y = b.y + 0.6 + (up ? u : 1 - u) * 3.2;
        const z = (0.09 * (s || 1)) * A * (1 - Math.abs(u - 0.5)) + 0.02;
        G.box(b.x, y, b.z, z, z, z, ck); used++;
      }
      break;
    }
    case 'batch': { // 코어 링(분주 진행)
      if (used < cap - 4) { const q = red ? 0.5 : (tt * 0.6) % 1; used += ring(G, b.x, b.y + 0.25, b.z, 0.5 + q * 0.8, 4, 0.1, _c.copy(ck).multiplyScalar(0.3 + 0.7 * A)); }
      break;
    }
    case 'tests': { // 포그라운드: 브리지 시험 신호탑 3칸 + 통과/실패 막대
      const pass = ix.pass || 0, fail = ix.fail || 0, skip = ix.skip || 0, tot = pass + fail + skip, running = te == null;
      const ls = 0.22 * Math.min(s || 1, 1.4);
      G.box(b.x, b.y + 0.3, b.z, ls, ls, ls, !running && f.ok !== false && fail === 0 ? pal.col('ok') : pal.col('dim'));
      G.box(b.x, b.y + 0.58, b.z, ls, ls, ls, running && blink(red, tt, 3) ? pal.col('warn') : pal.col('dim'));
      G.box(b.x, b.y + 0.86, b.z, ls, ls, ls, fail > 0 && (!running || blink(red, tt, 4)) ? pal.col('err') : pal.col('dim'));
      used += 3;
      const W = 1.4, bh = 0.12 * Math.min(s || 1, 2);
      if (tot > 0) {
        const wp = (W * pass) / tot, wf = (W * fail) / tot;
        if (wp > 0) { G.box(b.x - W / 2 + wp / 2, b.y - 0.15, b.z, wp, bh, 0.06, pal.col('ok')); used++; }
        if (wf > 0) { G.box(b.x - W / 2 + wp + wf / 2, b.y - 0.15, b.z, wf, bh, 0.06, pal.col('err')); used++; }
      } else if (running && !red) { const u = (tt * 0.6) % 1; G.box(b.x - W / 2 + u * W, b.y - 0.15, b.z, 0.2, bh, 0.06, ck); used++; }
      break;
    }
    default: break; // 'supply' — 캡슐만(기자재가 웰·시험관으로 진행을 그림)
  }
  return used;
}

/** 운반 캡슐(문서 머리). 반환 = 쓴 상자 수 */
export function drawCouriers(G, L, list, n, now, pal, reduced, far) {
  if (!n) return 0;
  const lod = courierLod(far, reduced);
  if (lod === 'none') return 0;
  const cap = LAB_IX.COURIERS * LAB_IX.COURIER_BOXES;
  let used = 0;
  const plate = pal && pal.paper;
  for (let i = 0; i < n && used < cap; i++) {
    const it = list[i];
    const c = it.c || _w, c2 = it.c2 || c;
    const tA = now - it.t0, u = tA / it.dur;
    const roomRing = used + 6 <= cap;
    if (lod === 'ring') {
      if (!roomRing) continue; // 원경·움직임 줄이기: 도착 링만(줄이기 = 정지 링 0.5초)
      if (reduced) { if (tA >= 0 && tA < LAB_IX.REDUCED_RING_S) used += ring(G, it.tx, it.ty - 0.4, it.tz, 0.55, 6, 0.1, c2); }
      else if (u >= 1) { const q = (tA - it.dur) / LAB_IX.RING_S; if (q < 1) used += ring(G, it.tx, it.ty - 0.4, it.tz, 0.4 + q * 0.7, 6, 0.12, _c.copy(c2).multiplyScalar(1 - q)); }
      continue;
    }
    if (u < 0) continue;
    if (u >= 1) { // 도착 링
      const q = (tA - it.dur) / LAB_IX.RING_S;
      if (q < 1 && roomRing) used += ring(G, it.tx, it.ty - 0.35, it.tz, 0.3 + q * 0.6, 6, 0.08, _c.copy(c2).multiplyScalar(1 - q));
      continue;
    }
    const dx = it.tx - it.fx, dz = it.tz - it.fz, h = courierArc(Math.hypot(dx, dz)), yaw = Math.atan2(dx, dz);
    if (it.m > 1) { // 방울 m 개(탱크로 가는 산출) — 줄지어
      for (let j = 0; j < it.m && used < cap; j++) {
        const uj = u - j * 0.12;
        if (uj <= 0) continue;
        const p = arcAt(it.fx, it.fy, it.fz, it.tx, it.ty, it.tz, uj, h);
        G.box(p.x, p.y, p.z, 0.14, 0.14, 0.14, c2); used++;
      }
      continue;
    }
    if (used + 2 > cap) continue;
    const p = arcAt(it.fx, it.fy, it.fz, it.tx, it.ty, it.tz, u, h);
    const px = p.x, py = p.y, pz = p.z;
    if (it.kind === 'pod') { // 산출 = 종류색 시료 상자(멀리서도 보이게 판보다 큼) + 발광 띠
      L.box(px, py, pz, 0.42, 0.22, 0.32, c, yaw); used++;
      G.box(px, py + 0.12, pz, 0.46, 0.03, 0.36, c2, yaw); used++;
    } else {
      L.box(px, py, pz, 0.3, 0.04, 0.22, plate ? _c.copy(c).lerp(plate, 0.25) : c, yaw); used++; // 판(의뢰서·보고 = 세션 색 종이)
      G.box(px, py - 0.03, pz, 0.36, 0.02, 0.28, c2, yaw); used++;                                // 발광 테
    }
    if (lod === 'full' && used + 2 <= cap) for (let j = 1; j <= 2; j++) {                                              // 꼬리 2
      const q = arcAt(it.fx, it.fy, it.fz, it.tx, it.ty, it.tz, Math.max(0, u - 0.05 * j), h);
      const s = 0.14 - 0.03 * j;
      G.box(q.x, q.y, q.z, s, s * 0.5, s, _c2.copy(c2).multiplyScalar(0.7 - 0.25 * j)); used++;
    }
  }
  return used;
}

/** 들여다보기 빛줄: 기자재 화면(a) → 사람 손(b), 0.4초 맥동(움직임 줄이기면 고정 밝기). 반환 = 상자 수(5) */
export function drawWatchBeam(G, ax, ay, az, bx, by, bz, now, c, reduced) {
  const k = reduced ? 0.7 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin((now / 0.4) * Math.PI * 2));
  const col = _c.copy(c).multiplyScalar(k);
  for (let i = 0; i < 5; i++) {
    const u = (i + 0.5) / 5;
    G.box(ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u, 0.05, 0.05, 0.05, col);
  }
  return 5;
}
