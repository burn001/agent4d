// 전체 보기 섬 배치에 넘길 가용 영역 — 브라우저 쪽 얇은 연결. 계산은 fill-pack.mjs(순수).
// 가용 영역 = 무대(그릇) − 위·아래 덮개(이벤트 띠·매크로 타임라인·재생 막대, screen-insets) − 라벨 자리(흐름 = 아래, Planet = 위).
// 사이드 패널은 무대 폭 자체를 줄이므로(#stage right) 그릇 크기에 이미 들어 있다.
import { stageInsets } from '../screen-insets.js';
import { availRect, needRepack } from './fill-pack.mjs';

/**
 * @param el     무대 그릇(container)
 * @param o      { labelBelow, prefs: cameraPrefs, elev: 지금 카메라 고도(도, 없으면 범위 가운데), flat: 2D(위에서 봄),
 *                 yawMin/yawMax/yaw0(복셀: 방위각 범위) }
 * @returns view — computeOverview/computeCampus opts.view
 */
export function packView(el, o = {}) {
  if (legacyPack()) return null;
  const W = (el && el.clientWidth) || 16, H = (el && el.clientHeight) || 10;
  const ins = stageInsets(el);
  // 라벨 자리: 카메라 맞춤 띠(camera.js _band·_labelKx)와 같게 — 기본 + 실제로 노드 밖으로 나간 라벨
  const lr = o.labelReserve || null;
  const labT = Math.max(o.labelBelow ? 0 : 30, lr ? lr.top || 0 : 0), labB = Math.max(o.labelBelow ? 46 : 0, lr ? lr.bottom || 0 : 0);
  const side = lr ? Math.min(W * 0.2, Math.max(lr.left || 0, lr.right || 0)) : 0;
  const a = availRect(W, H, { top: ins.top + labT, bottom: ins.bottom + labB, left: side, right: side });
  if (o.flat) return { aspect: a.aspect, elevMin: 90, elevMax: 90 };
  const p = o.prefs || {};
  const lo = p.elevMin ?? 20, hi = p.elevMax ?? 55;
  const v = { aspect: a.aspect, fov: p.fov ?? 50, elevMin: lo, elevMax: hi, elevDef: Math.max(lo, Math.min(hi, Number.isFinite(o.elev) ? o.elev : (lo + hi) / 2)), hy: o.hy ?? 1.5 };
  if (p.azCenter != null && p.azRange != null) { v.yaw0 = p.azCenter; v.yawMin = p.azCenter - p.azRange; v.yawMax = p.azCenter + p.azRange; }
  return v;
}

/** ?pack=legacy: 이전 배치·카메라(전후 비교용) */
let legacy = null;
export function legacyPack() {
  if (legacy == null) { try { legacy = typeof location !== 'undefined' && new URLSearchParams(location.search).get('pack') === 'legacy'; } catch { legacy = false; } }
  return legacy;
}

/** 지금 배치(ov.packAspect)가 가용 비율과 25% 넘게 어긋났나 — 그때만 다시 배치(평소엔 자리 유지) */
export function packStale(ov, view) { return !!(ov && view && needRepack(ov.packAspect, view.aspect)); }

/** three 카메라의 지금 고도(도) */
export function camElev(camera) {
  if (!camera || !camera.matrixWorld) return NaN;
  const e = camera.matrixWorld.elements; // 시선 = −(3번째 열)
  const dy = -e[9], l = Math.hypot(e[8], e[9], e[10]) || 1;
  return (Math.asin(Math.max(-1, Math.min(1, -dy / l))) * 180) / Math.PI;
}
