// 사이드 패널 크기 조절의 순수 부분 — DOM 없음. panel-resize.js 가 쓴다.
// 배치는 CSS 미디어 질의가 정하고(DOCK_QUERY 가 참이면 아래, 아니면 오른쪽), 여기서는 크기 제한·저장값 해석·두 번 누르기·키보드 가림 계산만 한다.

export const DOCK_QUERY = '(max-width: 719px) and (orientation: portrait)'; // theme.css 의 아래 배치 질의와 같은 글자(시험이 대조)
export const W_KEY = 'ccviz.panelW'; // 오른쪽 배치(가로 화면·넓은 화면) 너비 px
export const H_KEY = 'ccviz.panelH'; // 아래 배치(휴대폰 세로) 높이 px

export const SIDE = { min: 240, maxRatio: 0.6, maxAbs: 900, defMax: 360, defRatio: 0.5, step: 16, stepBig: 64 };
export const DOCK = { min: 120, maxRatio: 0.75, defRatio: 0.45, step: 24, stepBig: 96, reserveTop: 120 }; // 상단 바 아래 최소 120px 은 남김

const fin = (n) => Number.isFinite(n);

/** 오른쪽 배치 너비 한도 [min, max] (vw = 화면 너비) */
export function sideLimits(vw) {
  const max = Math.max(SIDE.min, Math.min(SIDE.maxAbs, Math.floor(vw * SIDE.maxRatio)));
  return { min: Math.min(SIDE.min, max), max };
}
export function clampSide(w, vw) {
  const { min, max } = sideLimits(vw);
  return Math.round(Math.min(max, Math.max(min, fin(w) ? w : sideDefault(vw))));
}
/** 저장값이 없을 때 쓰는 기본 너비(CSS 의 min(360px, 50vw) 와 같다) */
export function sideDefault(vw) { return Math.min(SIDE.defMax, Math.floor(vw * SIDE.defRatio)); }

/** 아래 배치 높이 한도(vh = 화면 높이, top = 상단 바 높이) */
export function dockLimits(vh, top = 48) {
  const max = Math.max(DOCK.min, Math.min(Math.floor(vh * DOCK.maxRatio), vh - top - DOCK.reserveTop));
  return { min: Math.min(DOCK.min, max), max };
}
export function clampDock(h, vh, top = 48) {
  const { min, max } = dockLimits(vh, top);
  return Math.round(Math.min(max, Math.max(min, fin(h) ? h : dockDefault(vh))));
}
export function dockDefault(vh) { return Math.floor(vh * DOCK.defRatio); }

/** localStorage 문자열 → 양수 px 또는 null(깨진 값·0·음수·너무 큰 값) */
export function parseSaved(s) {
  if (s == null || s === '') return null;
  const n = Math.round(Number(s));
  return fin(n) && n > 0 && n < 5000 ? n : null;
}

/** 손잡이 두 번 누르기(마우스 더블클릭이 안 오는 터치용): 직전 누름과 350ms·20px 안 */
export function isDoubleTap(prev, now) {
  return !!prev && now.t - prev.t <= 350 && Math.hypot(now.x - prev.x, now.y - prev.y) <= 20;
}

/** 드래그 → 새 크기. side: 패널 왼쪽 변이 포인터를 따라감(너비 = vw − x), dock: 위쪽 변(높이 = vh − y) */
export function dragSize(dock, p, vw, vh, top = 48, left = false) {
  return dock ? clampDock(vh - p.y, vh, top) : clampSide(left ? p.x : vw - p.x, vw); // 왼쪽 배치: 패널 오른쪽 변이 포인터 x
}

/** 키보드: 손잡이 쪽으로 가는 화살표 = 키움(오른쪽 배치 ←, 왼쪽 배치 →, 아래 배치 ↑), 반대 = 줄임(Shift = 큰 걸음). 해당 없는 키는 null */
export function keySize(dock, key, shift, cur, vw, vh, top = 48, left = false) {
  const L = dock ? DOCK : SIDE, d = shift ? L.stepBig : L.step;
  const grow = dock ? 'ArrowUp' : left ? 'ArrowRight' : 'ArrowLeft', shrink = dock ? 'ArrowDown' : left ? 'ArrowLeft' : 'ArrowRight';
  if (key !== grow && key !== shrink) return null;
  const n = cur + (key === grow ? d : -d);
  return dock ? clampDock(n, vh, top) : clampSide(n, vw);
}

/** 가상 키보드가 가린 아래쪽 px. 주소창 접힘 정도(<100px)는 키보드로 보지 않음 */
export function keyboardInset(innerH, vvH, vvTop = 0) {
  const k = Math.round(innerH - vvH - (vvTop || 0));
  return fin(k) && k >= 100 ? k : 0;
}
/**
 * visualViewport 가 없는 브라우저의 폴백: 입력칸에 초점이 있을 때만, 이 방향에서 본 가장 큰 창 높이(baseH)와 지금 창 높이의 차이
 * (키보드가 창 자체를 줄이는 브라우저). 100px 미만은 주소창 접힘으로 보고 0
 */
export function keyboardFallback(baseH, innerH, focused) {
  if (!focused) return 0;
  const k = Math.round(baseH - innerH);
  return fin(k) && k >= 100 ? k : 0;
}
/** 초점이 들어오고 나갈 때 키보드 값을 다시 재는 짧은 폴링(visualViewport resize 가 늦거나 빠지는 브라우저 대비) */
export const KB_POLL = { MS: 100, N: 15 };
