// 복셀 2D 평면도 바닥 스텐실 — 3D vx-stencil.js 와 같은 자리·크기·글(순수 stencil-core.mjs), 같은 마스크(stencil-tex.js)에 색을 입혀 붙인다.
// 정적 층(_drawStatic)에서 방 바닥 뒤·문패 앞에 그린다 — 카메라·배치·테마가 그대로면 다시 그리지 않음(정적 층 캐시).
import { stencilTargets, stencilLines, stencilPlace, stencilStyle } from '../voxel/stencil-core.mjs';
import { stencilTinted } from '../voxel/stencil-tex.js';
import { stencilOn } from '../voxel/stencil-pref.mjs';

export function drawStencils2D(view, ctx, s) {
  const lay = view.layout;
  if (!stencilOn() || !lay || s < 1.2) return;
  const all = view.scope && view.scope.mode === 'all';
  const rv = !all && lay.rootId ? view.vis.get(lay.rootId) : null;
  const targets = stencilTargets(lay, { mode: all ? 'all' : 'session', root: rv ? rv.node : null, projects: view.scope && view.scope.projects });
  const L = !!(view.tokens && view.tokens.isLight);
  for (const tg of targets) {
    const fade = all && tg.projectId ? view.projAlpha(tg.projectId) : 1;
    if (fade <= 0) continue;
    const st = stencilStyle(L, fade, all && tg.projectId && view.pf && view.pf.focus === tg.projectId);
    const lines = stencilLines(tg.text);
    if (!lines.length) continue;
    const img = stencilTinted(lines, st.color);
    const pl = stencilPlace(tg.room, lines, img.aspect);
    if (!pl) continue;
    const X = view._X(pl.x), Y = view._Y(pl.z), w = pl.w * s, h = pl.h * s;
    if (X + w < -20 || X - w > view.W + 20 || Y + w < -20 || Y - w > view.H + 20) continue;
    ctx.save();
    ctx.globalAlpha = Math.min(1, st.alpha * 1.15); // 위에서 본 평면은 비스듬한 3D 보다 옅어 보여 조금 진하게
    ctx.translate(X, Y); ctx.rotate(pl.angle);
    ctx.drawImage(img.canvas, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
