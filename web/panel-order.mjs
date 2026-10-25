// 실황 패널 줄 순서·스크롤 규칙(순수): 최신 줄이 맨 위, 시각 역순
/** 맨 위에 붙어 있다고 볼 거리(px) */
export const TOP_SLACK = 24;

/**
 * 시각 역순(내림차순)으로 놓인 줄(times)에 t 를 넣을 자리.
 * 같은 시각이면 기존 줄보다 위(나중 도착이 위 — 역순에서의 도착 순서 유지).
 * 늦게 도착한 과거 기록(claude -p 자식의 앞 기록·백그라운드 출력 등)을 맨 위에 붙이면 시각이 뒤섞여 보였다.
 */
export function insertIndexDesc(times, t) {
  let a = 0, b = times.length;
  while (a < b) { const m = (a + b) >> 1; if (times[m] > t) a = m + 1; else b = m; }
  return a;
}

/**
 * 한 번에 비우는 줄 묶음(도착 순 시각 ts[])을 나눈다.
 * - top: 맨 위에 붙일 줄의 인덱스, 표시 순서(위→아래 = 최신→과거, 즉 도착 역순)
 * - late: 앞서 붙인 가장 늦은 시각(lastT)보다 2초 넘게 이른 줄 — 시각 자리에 끼워 넣을 것, 시각 오름차순
 * - lastT: 갱신된 가장 늦은 시각
 */
export function splitArrivals(ts, lastT = 0, lateMs = 2000) {
  const top = [], late = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t && lastT && t < lastT - lateMs) late.push(i);
    else { top.unshift(i); if (t > lastT) lastT = t; }
  }
  late.sort((x, y) => ts[x] - ts[y]);
  return { top, late, lastT };
}

/** 스크롤 위치가 맨 위(최신 보기)인가 */
export const atTop = (scrollTop) => scrollTop < TOP_SLACK;

/**
 * 과거를 읽는 중 위에 줄이 붙거나 끼워졌을 때 읽던 줄을 제자리에 두는 scrollTop.
 * anchorBefore/After = 기준 줄(보던 화면 맨 위 줄)의 offsetTop 변경 전·후.
 */
export const keepAnchor = (scrollTop, anchorBefore, anchorAfter) => Math.max(0, scrollTop + (anchorAfter - anchorBefore));
