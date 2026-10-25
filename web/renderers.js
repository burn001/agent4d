// 표현 모드 등록부. 각 항목은 RendererView 클래스를 돌려주는 지연 로더.
import { t } from './i18n.mjs';
export const RENDERERS = {
  flow: () => import('./flowview/flow-view.js').then((m) => m.FlowView),   // Flow(새 기본)
  planet: () => import('./planet-view.js').then((m) => m.PlanetView),      // Planet = 예전 '단순 도형' 그대로(SceneView) + 작업 대상 층(켤 때만)
  voxel: () => import('./voxel/office.js').then((m) => m.VoxelView),
};
export const RENDERER_LABEL = { flow: t('app.renderer.flow'), planet: t('app.renderer.planet'), voxel: t('app.renderer.voxel') };
export const RENDERER_ORDER = ['flow', 'planet', 'voxel']; // 표현 버튼 순환 순서
// 옛 값 호환: URL ?view=shapes|shape|도형 → planet
const ALIAS = { shapes: 'planet', shape: 'planet', '도형': 'planet', agentflow: 'flow', 'agent-flow': 'flow', '흐름': 'flow' };
export const normRenderer = (id) => (id == null ? id : ALIAS[String(id).toLowerCase()] || id);
export const DEFAULT_RENDERER = 'flow';
/** 저장된 선택 해석: 새 키(ccviz.view2) 우선, 옛 키는 복셀만 이어받음(옛 기본 '단순 도형'이 새 기본 '흐름'을 가리지 않게) */
export function storedRenderer(v2, v1) { const n = normRenderer(v2); if (isRenderer(n)) return n; if (v1 === 'voxel') return 'voxel'; return DEFAULT_RENDERER; }
export const nextRenderer = (cur) => RENDERER_ORDER[(RENDERER_ORDER.indexOf(cur) + 1) % RENDERER_ORDER.length];
export const isRenderer = (id) => Object.prototype.hasOwnProperty.call(RENDERERS, id);

// ---- 2D(저사양) 표현 ----
// 3D·2D 는 표현(flow·planet·voxel)과 따로 고른다. 2D 경로는 three.js 를 한 번도 불러오지 않는다(이 파일은 지연 로더만 둔다).
export const DIMS = ['3d', '2d'];
export const DEFAULT_DIM = '3d';
export const DIM_LABEL = { '3d': '3D', '2d': '2D' };
/** '2d'|'3d' 정규화(그 밖 null). 2·flat·low 도 2d 로 */
export function normDim(x) {
  if (x == null) return null;
  const s = String(x).trim().toLowerCase();
  if (s === '2d' || s === '2' || s === 'flat' || s === 'low') return '2d';
  if (s === '3d' || s === '3') return '3d';
  return null;
}
/** 처음 차원: URL ?dim= 이 있으면 그 접속에서만 우선(저장값은 덮지 않음), 없으면 저장값, 없으면 3D */
export function initialDim(urlVal, stored) { return normDim(urlVal) || normDim(stored) || DEFAULT_DIM; }
/** 2D 표현 로더: 세 표현 모두 2D 판이 있다. 없는 id 는 Flow 2D 로 그리고 '준비 중'(pending) 표시 */
export const RENDERERS_2D = {
  flow: () => import('./flat/flow2d.js').then((m) => m.Flow2DView),
  planet: () => import('./flat/planet2d.js').then((m) => m.Planet2DView),
  voxel: () => import('./flat/voxel2d.js').then((m) => m.Voxel2DView),
};
export function renderer2dFor(mode) {
  const own = Object.prototype.hasOwnProperty.call(RENDERERS_2D, mode);
  return { load: own ? RENDERERS_2D[mode] : RENDERERS_2D.flow, pending: own ? null : mode };
}
