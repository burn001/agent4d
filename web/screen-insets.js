// 무대(캔버스)를 덮는 화면 아래·위 UI 의 높이(px) — 카메라 맞춤이 그만큼 피한다. 3D·2D 카메라가 같이 쓴다.
import { overlayInsets } from './camera-core.mjs';

const IDS = ['timeline', 'macro-tl', 'replay-bar', 'inspector']; // inspector = 상세 팝업 하단 시트일 때만
let cache = null;

/** el(무대 그릇) 기준 {top, bottom, H} px. 0.5초 캐시(맞춤은 매 프레임 불리지만 덮개는 드물게 바뀜) */
export function stageInsets(el, now = performance.now()) {
  if (cache && cache.el === el && now - cache.at < 500) return cache.v;
  let v = { top: 0, bottom: 0, H: 0 };
  if (el && typeof document !== 'undefined') {
    const st = el.getBoundingClientRect();
    const rects = [];
    for (const id of IDS) {
      const o = document.getElementById(id);
      if (!o || o.hidden) continue;
      if (id === 'inspector' && !o.classList.contains('sheet')) continue;
      const r = o.getBoundingClientRect();
      if (r.height > 0 && getComputedStyle(o).display !== 'none') rects.push(r);
    }
    v = { ...overlayInsets(st, rects), H: st.height };
  }
  cache = { el, at: now, v };
  return v;
}
