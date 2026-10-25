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
