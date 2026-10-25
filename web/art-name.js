// 바닥 글씨 — 프로젝트 이름을 작업 대상 층 바닥에 크게 눕혀 새긴 글씨(스텐실·발자국). 3D·2D 공용 DOM 보조.
// 이름 규칙(마지막 경로 이름·두 줄)은 artifact-core.mjs artNameLines, 판 크기는 artNamePlate.
import { artNameLines } from './artifact-core.mjs';

const FONT_PX = 160;
let uiFont = null;
const fontOf = () => uiFont || (uiFont = (typeof getComputedStyle === 'function' && document.body ? getComputedStyle(document.body).fontFamily : '') || 'system-ui, sans-serif');
export const nameFont = (px) => `800 ${Math.round(px)}px ${fontOf()}`;

/** 섬(프로젝트) 이름: 전체 보기는 섬 이름표와 같은 값(그 노출 규칙 그대로), 단일 세션은 메인 cwd 마지막 이름 */
export function projectNameOf(view, pid) {
  if (view.scope && view.scope.mode === 'all') { const c = view.clusters().find((x) => x.projectId === pid); return c ? c.name || '' : ''; }
  const r = view.vis && view.rootId ? view.vis.get(view.rootId) : null;
  const cwd = r && r.node && r.node.meta ? r.node.meta.cwd : null;
  return cwd ? String(cwd).split(/[\\/]/).filter(Boolean).pop() || '' : '';
}

/**
 * 글씨 캔버스(흰 글자: 아주 옅은 채움 + 윤곽선, 글로우 없음). 색·세기는 쓰는 쪽 재질이 정한다.
 * 반환 {canvas, aspect(높이/너비), lines}
 */
export function nameCanvas(name) {
  const lines = artNameLines(name);
  if (!lines.length) return null;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = nameFont(FONT_PX);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + FONT_PX * 0.4;
  const lh = FONT_PX * 1.1, h = lh * lines.length + FONT_PX * 0.3;
  cv.width = Math.min(2048, Math.ceil(w)); cv.height = Math.ceil(h);
  const k = cv.width / w;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.font = nameFont(FONT_PX);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  lines.forEach((l, i) => {
    const y = FONT_PX * 0.15 + lh * (i + 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillText(l, w / 2, y);
    ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = FONT_PX * 0.045; ctx.strokeText(l, w / 2, y);
  });
  return { canvas: cv, aspect: cv.height / cv.width, lines };
}

/** 바닥 글씨가 읽힐 만큼 크면 떠 있는 섬 이름표를 흐리게(전체 보기, 먼 조망에선 그대로) */
export function dimIslandLabel(root, pid, on) {
  if (!root) return;
  for (const el of root.querySelectorAll('.ov-island')) if (el.dataset.pid === pid) el.classList.toggle('art-dim', !!on);
}
export function undimAll(root) { if (root) for (const el of root.querySelectorAll('.ov-island.art-dim')) el.classList.remove('art-dim'); }
