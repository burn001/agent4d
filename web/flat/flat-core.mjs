// 2D(저사양) 표현의 순수 부분 — three·DOM 없음, node --test 로 시험(web/test/flat.test.mjs).
//   2D 카메라 = {x, z, D}: 화면 가운데가 보는 세계 점(x, z), D = 화면 세로 반높이에 들어가는 세계 길이(3D 카메라 거리처럼 클수록 멀다).
//   세계 좌표는 3D 배치(layout.js·overview/layout.mjs)의 바닥 평면(x, z)을 그대로 쓴다 — 화면 오른쪽 = +x, 화면 아래 = +z(3D 카메라가 +z 쪽에서 내려다봄).
import { holoDir, holoOffset } from '../holo-core.mjs';

export const FLAT = {
  FPS: 30,            // 그리기 상한(초당)
  AMBIENT_FPS: 15,    // 배경 움직임(숨쉬기·스피너)만 있을 때
  IDLE_MS: 250,       // 움직이는 것이 없을 때 논리 갱신 간격(카메라 복귀 타이머·퇴장 판정용) — 그리기는 바뀐 것이 있을 때만
  DPR_MAX: 1.5,       // devicePixelRatio 상한(고해상 화면에서 픽셀 수 폭증 방지)
  D_MIN: 4,           // 가장 가까이(세로 반높이 4 세계 단위)
  D_MAX: 4000,        // 가장 멀리
  FIT_MH: 0.95, FIT_MV: 0.93, // 전체 맞춤 화면 채움 비율(가로·세로) — 꽉 차게(예전 0.88·0.80)
  FIT_BIAS: 0.08,     // (예전) 맞춤 시선점 아래 치우침 — 부터 camera2d 는 덮개를 잰 safeBand 를 쓴다
  FIT_PAD_K: 1.3, FIT_PAD: 1.6, // 맞춤 점 반지름 = 노드 반지름 × K + PAD(세계 단위)
  MIN_R: 7,           // 노드가 하나뿐일 때 담는 최소 반지름(3D minR 과 같음)
  PICK_MIN_PX: 9,     // 클릭 판정 최소 반지름(px) — 멀어서 작은 칩도 누를 수 있게
  WHEEL_K: 0.0015,    // 휠 한 칸(deltaY 100) ≈ 16% 확대/축소
};

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const capDpr = (d) => clamp(Number(d) || 1, 1, FLAT.DPR_MAX);
export const clampD = (D) => clamp(D, FLAT.D_MIN, FLAT.D_MAX);

/** 세계 1 단위가 화면 몇 px 인가 */
export const camScale = (cam, H) => (H / 2) / Math.max(1e-6, cam.D);

/** 세계(x, z) → 화면 px(왼쪽 위 0). out 재사용 */
export function toScreen(cam, W, H, x, z, out = {}) {
  const s = camScale(cam, H);
  out.x = (x - cam.x) * s + W / 2;
  out.y = (z - cam.z) * s + H / 2;
  return out;
}
/** 화면 px → 세계(x, z) */
export function toWorld(cam, W, H, px, py, out = {}) {
  const s = camScale(cam, H);
  out.x = (px - W / 2) / s + cam.x;
  out.z = (py - H / 2) / s + cam.z;
  return out;
}
/** 화면 점 (px, py) 아래 세계 점을 그 자리에 둔 채 확대/축소. k > 1 = 멀어짐. cam 을 고쳐 돌려줌 */
export function zoomAt(cam, W, H, px, py, k, dmin = FLAT.D_MIN, dmax = FLAT.D_MAX) {
  const w = toWorld(cam, W, H, px, py);
  const D = clamp(cam.D * k, dmin, dmax);
  const s = (H / 2) / D;
  cam.D = D;
  cam.x = w.x - (px - W / 2) / s;
  cam.z = w.z - (py - H / 2) / s;
  return cam;
}
/** 화면에서 (dx, dy) px 끌기 → 세계가 손을 따라 움직임 */
export function panBy(cam, H, dx, dy) {
  const s = camScale(cam, H);
  cam.x -= dx / s; cam.z -= dy / s;
  return cam;
}

/** 점들 {p:{x,z}, r} 의 축 정렬 상자 중심 */
export function boxCenterXZ(pts) {
  if (!pts.length) return { x: 0, y: 0, z: 0 };
  let lx = Infinity, lz = Infinity, hx = -Infinity, hz = -Infinity;
  for (const { p, r = 0 } of pts) {
    if (p.x - r < lx) lx = p.x - r; if (p.x + r > hx) hx = p.x + r;
    if (p.z - r < lz) lz = p.z - r; if (p.z + r > hz) hz = p.z + r;
  }
  return { x: (lx + hx) / 2, y: 0, z: (lz + hz) / 2 };
}
/**
 * 중심 c 에서 모든 점(반지름 r 포함)이 화면 여백 안에 드는 최소 D(세로 반높이).
 * 가로: |dx| + r ≤ D·aspect·mh, 세로: |dz| + r ≤ D·mv  (requiredDist 의 2D판)
 */
export function fitNeed(pts, c, aspect, mh = FLAT.FIT_MH, mv = FLAT.FIT_MV) {
  let D = 0;
  const ax = Math.max(0.2, aspect) * mh;
  for (const { p, r = 0, e } of pts) {
    let need;
    if (!e) need = Math.max((Math.abs(p.x - c.x) + r) / ax, (Math.abs(p.z - c.z) + r) / mv);
    else { // 화면 고정 몫 e(반높이 단위 — px / (H/2)): 그 방향의 화면 끝을 그만큼 당김(z 가 커지면 화면 아래)
      const dx = p.x - c.x, dz = p.z - c.z, m = (v, k) => Math.max(v * 0.15, v - k);
      need = Math.max((dx + r) / m(ax, e.r), (r - dx) / m(ax, e.l), (dz + r) / m(mv, e.b), (r - dz) / m(mv, e.t));
    }
    if (need > D) D = need;
  }
  return D;
}
/** 평행 투영 맞춤: 화면 상자(반지름·화면 고정 몫 포함)의 가운데로 시선점을 옮기고 거리를 다시 — 반환 {c, D} */
export function refineFit2D(pts, c0, aspect, mh = FLAT.FIT_MH, mv = FLAT.FIT_MV, iters = 3) {
  let c = { x: c0.x, y: 0, z: c0.z };
  let D = fitNeed(pts, c, aspect, mh, mv);
  for (let it = 0; it < iters && pts.length; it++) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const { p, r = 0, e } of pts) {
      x0 = Math.min(x0, p.x - r - (e ? e.l * D : 0)); x1 = Math.max(x1, p.x + r + (e ? e.r * D : 0));
      z0 = Math.min(z0, p.z - r - (e ? e.t * D : 0)); z1 = Math.max(z1, p.z + r + (e ? e.b * D : 0));
    }
    const nc = { x: (x0 + x1) / 2, y: 0, z: (z0 + z1) / 2 };
    if (Math.abs(nc.x - c.x) < 1e-4 * D && Math.abs(nc.z - c.z) < 1e-4 * D) break;
    c = nc; D = fitNeed(pts, c, aspect, mh, mv);
  }
  return { c, D };
}
/** 노드가 적을 때 너무 붙지 않게: 최소 반지름 MIN_R 을 담는 D */
export const fitMinD = (aspect, mh = FLAT.FIT_MH, mv = FLAT.FIT_MV) => Math.max(FLAT.MIN_R / (Math.max(0.2, Math.min(1, aspect)) * mh), FLAT.MIN_R / mv);

/** 비행: 시선점은 직선, D 는 로그 보간(멀리 갈 때 줌이 고르게) */
export function flyPose(from, to, e) {
  const k = clamp(e, 0, 1);
  return {
    x: from.x + (to.x - from.x) * k,
    z: from.z + (to.z - from.z) * k,
    D: Math.exp(Math.log(Math.max(1e-6, from.D)) + (Math.log(Math.max(1e-6, to.D)) - Math.log(Math.max(1e-6, from.D))) * k),
  };
}
/** 감쇠 따라가기(dt 초, 속도 rate/초): 중심·D 를 목표 쪽으로 */
export function dampTo(cam, to, dt, rate = 1.2) {
  // 거의 닿았으면 정확히 맞추고 멈춘다(작은 떨림으로 매 프레임 다시 그리지 않게)
  if (Math.abs(to.x - cam.x) < cam.D * 0.002 && Math.abs(to.z - cam.z) < cam.D * 0.002 && Math.abs(Math.log(to.D / cam.D)) < 0.002) {
    cam.x = to.x; cam.z = to.z; cam.D = to.D;
    return cam;
  }
  const a = Math.min(1, dt * rate);
  cam.x += (to.x - cam.x) * a; cam.z += (to.z - cam.z) * a;
  cam.D *= Math.exp((Math.log(to.D) - Math.log(cam.D)) * a);
  return cam;
}

/**
 * 화면 클릭 판정: items = [{id, x, y, r}](화면 px), 가장 가까운(반지름 대비) 것. 반지름이 작으면 minPx 까지 넓혀 준다
 */
export function pickNearest(items, px, py, minPx = FLAT.PICK_MIN_PX) {
  let best = null, bk = Infinity;
  for (const it of items) {
    const R = Math.max(minPx, it.r);
    const d = Math.hypot(px - it.x, py - it.y);
    if (d > R) continue;
    const k = d / R;
    if (k < bk) { bk = k; best = it.id; }
  }
  return best;
}

const HEX_C = [], HEX_S = [];
for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 3; HEX_C.push(Math.cos(a)); HEX_S.push(Math.sin(a)); }
/** 꼭짓점이 위인 정육각형 꼭짓점 6개(화면 px) → out = [x0, y0, x1, y1, …] (배열 재사용, 프레임마다 객체를 만들지 않음) */
export function hexPoints(cx, cy, r, out = new Array(12)) {
  for (let i = 0; i < 6; i++) { out[2 * i] = cx + HEX_C[i] * r; out[2 * i + 1] = cy + HEX_S[i] * r; }
  return out;
}
/** 육각 경로를 ctx 에 그린다(beginPath 포함) */
export function hexPath(ctx, cx, cy, r, buf) {
  const p = hexPoints(cx, cy, r, buf);
  ctx.beginPath(); ctx.moveTo(p[0], p[1]);
  for (let i = 1; i < 6; i++) ctx.lineTo(p[2 * i], p[2 * i + 1]);
  ctx.closePath();
}

/** 3차 베지어 [0, t] 구간의 제어점(de Casteljau) — 퇴장 중 빔을 자식 끝부터 감을 때 */
export function bezPrefix(p0, p1, p2, p3, t) {
  const L = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a = L(p0, p1), b = L(p1, p2), c = L(p2, p3);
  const d = L(a, b), e = L(b, c);
  const f = L(d, e);
  return [p0, a, d, f];
}
/** 3차 베지어 [t, 1] 구간의 제어점(패킷이 지나는 토막) */
export function bezSuffix(pts, t) {
  const [p0, p1, p2, p3] = pts;
  const L = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a = L(p0, p1), b = L(p1, p2), c = L(p2, p3);
  const d = L(a, b), e = L(b, c);
  return [L(d, e), e, c, p3];
}

/**
 * 도구 카드 자리(화면 px, 노드 중심 기준 오프셋, y 아래가). 방향 무리는 HOLO_DIR 그대로(셸 오른쪽·검색 위·읽기 왼쪽 위…).
 * nodePx = 칩 화면 반지름, w·h = 카드 px, stack = 쌓임 순번, labelPush = 그 방향에 노드 라벨이 있을 때 더 띄울 px
 */
export function cardOffset(dirGroup, nodePx, w, h, stack = 0, labelPush = 0) {
  const d = holoDir(dirGroup);
  const dist = holoOffset(d, nodePx + 6, w, h, stack, labelPush);
  return { dx: d.x * dist, dy: -d.y * dist };
}

/** 카드 높이(px): 세계 높이 × 배율, 상위·포커스는 최소 높이까지 키움(3D 규칙의 2D판) */
export function cardPx(worldH, scale, { boost = 1, minPx = 0, maxPx = 230 } = {}) {
  const px = worldH * scale * boost;
  return clamp(Math.max(px, minPx), 0, maxPx);
}

/** 컨텍스트 사용률 고리 색 이름: 50% 이하 하늘·75% 이하 호박·그 위 빨강 */
export const ctxRingTone = (pct) => (pct <= 50 ? 'thinking' : pct <= 75 ? 'tool' : 'error');

/**
 * 다음 갱신까지 기다릴 ms. level 2 = 움직임(스프링·퇴장·패킷·카드 펼침·카메라 비행) 30fps,
 * 1 = 배경 움직임만(숨쉬기·스피너·표시등) 15fps, 0 = 아무것도 없음 → IDLE_MS(4Hz 논리 갱신, 바뀐 것이 없으면 그리지 않음). 숨긴 탭은 null(멈춤)
 */
export function tickInterval(level, hidden = false) {
  if (hidden) return null;
  return level >= 2 ? 1000 / FLAT.FPS : level === 1 ? 1000 / FLAT.AMBIENT_FPS : FLAT.IDLE_MS;
}

// ---------- 색(2D 는 CSS 색 문자열) ----------
/** '#rgb'·'#rrggbb'·'rgb(r,g,b)' → [r, g, b](0..255). 모르면 회색 */
export function parseColor(c) {
  const s = String(c || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  return [136, 136, 136];
}
const hex2 = (x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0');
/** a → b 로 k 만큼 섞은 '#rrggbb' */
export function mixColor(a, b, k) {
  const A = parseColor(a), B = parseColor(b);
  return '#' + hex2(A[0] + (B[0] - A[0]) * k) + hex2(A[1] + (B[1] - A[1]) * k) + hex2(A[2] + (B[2] - A[2]) * k);
}
/**
 * Planet 노드 색(scene.js _styleVis 와 같은 식): 완료 = 밝기 회색으로 55% + 배경 15%, 중지됨 = 중지 회색으로 80%, 그 밖 = 종류 색
 */
export function planetColor(base, status, tok) {
  if (status === 'done') {
    const [r, g, b] = parseColor(base);
    const l = r * 0.3 + g * 0.59 + b * 0.11;
    return mixColor(mixColor(base, '#' + hex2(l) + hex2(l) + hex2(l), 0.55), tok.bg, 0.15);
  }
  if (status === 'stopped') return mixColor(base, tok.stopped, 0.8);
  return mixColor(base, base, 0);
}

// ---------- Planet 2D 도형 ----------
/** 3D Planet 모양(scene.js nodeGeo)의 2D 실루엣 이름 */
export const PLANET_SHAPE = Object.freeze({
  main: 'ico', subagent: 'sphere', workflow: 'torus', 'workflow-agent': 'octa', 'claude-p': 'box', 'bash-bg': 'cyl', monitor: 'cone',
});
export const planetShape = (kind, device = false) => (device ? 'device' : PLANET_SHAPE[kind] || 'sphere');
/** 직선 연결이 퇴장 중 감길 때 끝점: 부모 a 에서 자식 b 로 (1 − link) 만큼 (exit-core retractEnd 의 평면판) */
export function retractPt(a, b, link, out = {}) {
  const k = 1 - clamp(link, 0, 1);
  out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k;
  return out;
}

// ---------- 작업(Job) 칩 2D — 흐름 2D 알약 · Planet 2D 작은 위성 (그리기는 flat/job2d.js) ----------
/**
 * 작업 칩 규칙. 색 번호는 job-core JOB_CODE(0 줄 섬 · 1 진행 · 2 대기 · 3 끝 · 4 실패 · 5 정체) 그대로.
 * 반지름은 백그라운드 명령 칩에 대한 몫(작업은 주인보다 작게), 알약은 반지름 배 폭·높이.
 */
export const JOB2D = Object.freeze({
  R_K: 0.55,         // 흐름 2D: 작업 칩 반지름 = 백그라운드 명령 칩 반지름 × 이 몫
  PLANET_R_K: 0.5,   // Planet 2D: 작은 위성 반지름 = 백그라운드 명령 원통 × 이 몫
  PILL_W: 3.4, PILL_H: 1.2, // 알약 폭·높이(칩 반지름 배)
  DOT_PX: 2.2,       // 칩 반지름이 이보다 작으면 점 하나
  DETAIL_PX: 4,      // 이 이상이면 막대·대기 고리·표시 글리프
  CODE_S: 0.25,      // 표시 상태(정체 판정)를 다시 재는 간격(초) — 프레임마다 날짜를 읽지 않게
  WAIT_REDRAW_S: 1,  // 대기 고리가 차오르는 것만 있을 때 다시 그리는 간격(초)
  STALE_PERIOD: 2.4, // 정체 맥박 한 주기(초) — 느리게
  MARQUEE_S: 1.6,    // 진행 비율을 모르는 진행 중 막대의 왕복 한 번(초)
  ORBIT_ARC: 0.42,   // Planet: 주인 둘레 궤도 흔적 호 반각 상한(라디안)
  ORBIT_ARC_PX: 44,  // Planet: 궤도 흔적 호 반쪽 길이 상한(px) — 멀리 떨어진 작업도 짧은 호만
});
/** 표시 상태 번호 → 색 이름(테마 토큰). 5 정체는 호박과 빨강 사이(jobPalette 가 섞음) */
export const JOB_TONE = Object.freeze(['muted', 'skill', 'flow-call', 'ok', 'error', 'stale']);
/** 표시 상태 번호 → 칩 불투명 몫: 줄 섬·대기는 흐림, 끝은 차분하게 */
export const JOB_ALPHA = Object.freeze([0.55, 1, 0.78, 0.72, 0.9, 1]);
/** 상태마다 움직이는가(1 = 배경 움직임 15fps): 진행(막대·흐름)·정체(맥박). 대기는 WAIT_REDRAW_S 마다만 */
export const jobAnim = (code) => (code === 1 || code === 5 ? 1 : 0);

/** 표시 상태 번호(0..5) → '#rrggbb' 6개. tok = 테마 토큰(readTokens2d) — 테마가 바뀔 때만 다시 만든다 */
export function jobPalette(tok) {
  const g = (k) => (tok && tok[k]) || '#888888';
  return [
    mixColor(g('muted'), g('bg'), 0.2),     // 줄 섬: 회색 흐림
    mixColor(g('skill'), g('skill'), 0),     // 진행: 호박(--skill, 회차 진행 띠와 같은 색)
    mixColor(g('flow-call'), g('bg'), 0.22), // 대기: 파랑 흐림
    mixColor(g('ok'), g('ok'), 0),           // 끝: 초록
    mixColor(g('error'), g('error'), 0),     // 실패: 빨강
    mixColor(g('skill'), g('error'), 0.5),   // 정체: 호박 → 빨강 사이 주황
  ];
}

/** 알약 크기(px): 칩 반지름 R → {w, h, rad}. out 재사용 */
export function jobPill(R, out = {}) {
  out.w = R * JOB2D.PILL_W; out.h = R * JOB2D.PILL_H; out.rad = out.h / 2;
  return out;
}
/** Planet 궤도 흔적 호 반각(라디안): 주인–작업 거리 rr(px) — ORBIT_ARC 와 ORBIT_ARC_PX/rr 중 작은 것 */
export const jobOrbitArc = (rr) => (rr > 0 ? Math.min(JOB2D.ORBIT_ARC, JOB2D.ORBIT_ARC_PX / rr) : 0);

/**
 * 대기 고리 채움 0..1: 대기에 들어선 시각 fromMs → 재확인 시각 untilMs 사이에서 지금(nowMs) 자리. until 이 가까울수록 1.
 * 모르면 -1(시각 없는 대기 — 고리 대신 빈 시계).
 */
export function jobWaitFill(nowMs, fromMs, untilMs) {
  if (!Number.isFinite(untilMs) || !Number.isFinite(nowMs)) return -1;
  const from = Number.isFinite(fromMs) ? Math.min(fromMs, untilMs) : untilMs - 60_000;
  const span = Math.max(1000, untilMs - from);
  return clamp((nowMs - from) / span, 0, 1);
}

/**
 * 정체 맥박(끊긴 심박): t 초 → 밝기 몫 0.35..1. 한 주기(STALE_PERIOD)의 앞 12% 에 박동 하나,
 * 세 번에 한 번은 박동이 빠진다(끊김). seed 로 노드마다 박자를 어긋나게. reduced(동작 줄이기)면 늘 0.7.
 */
export function jobStalePulse(t, seed = 0, reduced = false) {
  if (reduced) return 0.7;
  const u = t / JOB2D.STALE_PERIOD + seed;
  const k = Math.floor(u), f = u - k;
  if (((k % 3) + 3) % 3 === 2) return 0.35; // 빠진 박동
  return f < 0.12 ? 0.35 + 0.65 * Math.sin((f / 0.12) * Math.PI) : 0.35;
}

/** 진행 비율을 모를 때 막대 위를 왕복하는 토막의 [시작, 끝] 0..1(폭 0.3). out 재사용 */
export function jobMarquee(t, seed = 0, out = [0, 0]) {
  const f = (((t / JOB2D.MARQUEE_S + seed) % 2) + 2) % 2;
  const c = f < 1 ? f : 2 - f; // 0 → 1 → 0
  out[0] = c * 0.7; out[1] = c * 0.7 + 0.3;
  return out;
}

/**
 * 정체 맥박 선(끊긴 심전도)의 높이: 선 위 자리 u(0..1)·시각 t → -1..1. 주기마다 박동 하나가 왼쪽 → 오른쪽으로 지나가고,
 * 세 번에 한 번은 평선(빠진 박동 — jobStalePulse 와 같은 박자).
 */
export function jobBeatY(u, t, seed = 0) {
  const ph = t / JOB2D.STALE_PERIOD + seed;
  const k = Math.floor(ph);
  if (((k % 3) + 3) % 3 === 2) return 0;
  const d = u - (ph - k) * 1.3 + 0.15; // 박동 중심에서의 거리
  if (d <= -0.09 || d >= 0.09) return 0;
  // 작은 아래 꺾임 → 높은 뾰족 → 작은 아래 꺾임
  return d < -0.045 ? -0.35 * (1 - Math.abs(d + 0.0675) / 0.0225) : d > 0.045 ? -0.3 * (1 - Math.abs(d - 0.0675) / 0.0225) : 1 - Math.abs(d) / 0.045;
}
