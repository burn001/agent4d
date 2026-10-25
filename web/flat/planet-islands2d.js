// Planet 2D 전체 보기 섬 = 원형 궤도계 — 3D overview/orbit-island.js 와 같은 구도를 Canvas 2D 로:
// 가장자리 링 + 관측 눈금(5°·30°), 항성(메인)마다 실제 노드 거리 단계의 동심 고리(실선·점선 번갈아), 쌍성 공전 고리,
// 가운데 → 가장자리로 아주 옅은 원판, 항성 자리 옅은 빛. 원형이 아닌 섬(흐름·복셀이 쓰는 값)은 예전 drawIslands 그대로.
import { toScreen } from './flat-core.mjs';
import { drawIslands } from './flat-draw.js';
import { islandStyle } from '../overview/pick-core.mjs';

const TAU = Math.PI * 2;

/** 2D 고리 목록(섬 지역 좌표): [{x, z, r, st}] st 0 실선 · 1 점선 · 2 공전 — 3D syncOrbitDisc 와 같은 규칙 */
export function orbitRings2d(c, max = 12) {
  const R = c.round || c.r || 1, out = [];
  const ring = (x, z, r, st) => { if (out.length < max && r > 0 && r <= R * 0.985) out.push({ x, z, r, st }); };
  const stars = c.stars || [];
  if (c.orbit) ring(c.orbit.cx || 0, c.orbit.cz || 0, c.orbit.r, 2);
  const per = stars.length > 1 ? 3 : 4; // 3D 와 같음
  for (const s of stars) (s.rings.length ? s.rings : [R * 0.4, R * 0.66]).slice(0, per).forEach((r, i) => ring(s.x, s.z, r, s.rings.length ? i % 2 : 1 - i));
  return out;
}

export function drawPlanetIslands(view, ctx, now, s) {
  const list = [...view._clusterV.values()];
  if (!list.some((c) => c.round > 0)) { drawIslands(view, ctx, now, s); return; }
  const t = view.tokens, L = !!t.isLight;
  const p = {};
  // 반지름이 바뀌면 그리는 원은 0.6초쯤에 걸쳐 부드럽게(3D islands.js 와 같은 비율) — 처음·새 섬은 바로
  const rr = view._roundR || (view._roundR = new Map());
  const dt = Math.min(0.1, Math.max(0, now - (view._roundAt ?? now)));
  view._roundAt = now;
  const kR = 1 - Math.exp(-dt * 7);
  for (let c of list) {
    if (!(c.round > 0)) continue;
    let r0 = rr.get(c.projectId);
    if (!(r0 > 0) || Math.abs(c.round - r0) <= 0.05) r0 = c.round;
    else r0 += (c.round - r0) * kR;
    rr.set(c.projectId, r0);
    if (r0 !== c.round) c = { ...c, round: r0 };
    toScreen(view.cam, view.W, view.H, c.center.x, c.center.z, p);
    const R = c.round * s;
    if (R < 2 || p.x + R < 0 || p.x - R > view.W || p.y + R < 0 || p.y - R > view.H) continue;
    const fa = view.projAlpha ? view.projAlpha(c.projectId) : 1;
    if (fa <= 0) continue;
    const st = islandStyle({ inactive: c.inactive, hot: c.busy, dimmed: false, light: L });
    // 원판: 가운데 투명 → 가장자리 옅게
    const gr = ctx.createRadialGradient(p.x, p.y, R * 0.3, p.x, p.y, R);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, t.grid);
    ctx.globalAlpha = Math.min(1, st.disc * (L ? 1.4 : 2.2)) * fa;
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.fill();
    // 항성 빛
    for (const sr of c.stars || []) {
      const sx = p.x + sr.x * s, sy = p.y + sr.z * s, gR = Math.max(6, Math.min(R * 0.35, 7 * s));
      const g2 = ctx.createRadialGradient(sx, sy, 0, sx, sy, gR);
      g2.addColorStop(0, t.link); g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = (L ? 0.18 : 0.28) * fa; ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(sx, sy, gR, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = t.link; ctx.lineWidth = 1;
    // 궤도 고리(점선은 아주 천천히 돎 — 2D 는 다시 그릴 때만 움직임)
    const lineA = (c.inactive ? st.ring * 1.4 : L ? 0.72 : 0.62) * fa;
    for (const [i, q] of orbitRings2d(c).entries()) {
      const rr = q.r * s;
      if (rr < 3) continue;
      ctx.globalAlpha = lineA * (q.st === 2 ? 0.85 : q.st === 1 ? 0.8 : 0.55);
      if (q.st === 1) { const seg = Math.max(2, (TAU * rr) / Math.max(12, Math.floor((TAU * q.r) / 1.4))); ctx.setLineDash([seg * 0.42, seg * 0.58]); ctx.lineDashOffset = view.reduced ? 0 : (now * 0.025 * (i % 2 ? 1 : -1) * rr) % (seg * 2); }
      ctx.beginPath(); ctx.arc(p.x + q.x * s, p.y + q.z * s, rr, 0, TAU); ctx.stroke();
      if (q.st === 1) ctx.setLineDash([]);
    }
    // 가장자리 링 + 눈금
    ctx.globalAlpha = (c.inactive ? st.ring * 1.3 : (L ? 0.5 : 0.5) * (st.hot ? 1.15 : 1)) * fa;
    ctx.beginPath(); ctx.arc(p.x, p.y, R - 0.5, 0, TAU); ctx.stroke();
    if (!c.inactive && R > 40) {
      ctx.beginPath();
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * TAU, big = k % 6 === 0, l = big ? Math.max(4, R * 0.05) : Math.max(2, R * 0.02);
        const ca = Math.cos(a), sa = Math.sin(a);
        ctx.moveTo(p.x + ca * (R - 1), p.y + sa * (R - 1)); ctx.lineTo(p.x + ca * (R - 1 - l), p.y + sa * (R - 1 - l));
      }
      ctx.globalAlpha *= 0.75; ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
