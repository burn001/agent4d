// 여러 live 세션 화면 연출의 순수 계산 — three·DOM 없음(3D·2D·시험 공용).
import { ctxShort, gaugeLevel, pctText } from './ctx-core.mjs';
import { t as tr } from './i18n.mjs';

/**
 * 메인 ↔ 메인 충돌 곡선의 제어점(이차 베지에). 두 점의 수직 방향(x-z 평면)으로 휘고, 같은 두 메인 사이 여러 개면
 * 번갈아 반대쪽·점점 크게(slot). mode 'up'(Planet 3D) = 위로도 들어 올림, 'flat'(Flow·2D) = 평면에서만 휨.
 */
export function arcControl(a, b, slot = 0, mode = 'flat') {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
  const nx = -dz / L, nz = dx / L;
  const side = slot % 2 ? -1 : 1, mag = (0.2 + 0.1 * Math.floor(slot / 2)) * L;
  return {
    x: (a.x + b.x) / 2 + nx * mag * side,
    y: ((a.y || 0) + (b.y || 0)) / 2 + (mode === 'up' ? L * 0.22 : 0.6),
    z: (a.z + b.z) / 2 + nz * mag * side,
  };
}

/** 이차 베지에 점(2D·순수) */
export function bez2(a, c, b, u) {
  const v = 1 - u;
  return { x: v * v * a.x + 2 * v * u * c.x + u * u * b.x, z: v * v * a.z + 2 * v * u * c.z + u * u * b.z };
}

/**
 * 메인 라벨의 세션 표식: 같은 프로젝트에 live 메인이 여럿일 때 세션 색 점 + 컨텍스트 사용률(그 메인 것).
 * @returns {string} HTML(없으면 '')
 */
export function sessBadgeHtml(sessIdx, ctx, branch = null) {
  if (!Number.isInteger(sessIdx)) return '';
  const lv = ctx ? gaugeLevel(ctx.pct) : 'none';
  const c = ctx ? `<span class="sb-ctx lv-${lv}" title="${esc(tr('cards.sess.ctx', { ctx: ctxShort(ctx) }))}">${pctText(ctx.pct)}</span>` : '';
  const br = branch ? `<span class="sb-br">${esc(String(branch).slice(0, 24))}</span>` : '';
  return `<span class="sess-badge s${sessIdx}"><i></i>${br}${c}</span>`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** 메인 노드의 문패 이름: worktree 가 있으면 그것, 아니면 git 브랜치 */
export const branchOf = (n) => (n && n.meta && (n.meta.worktree || n.meta.git)) || null;
