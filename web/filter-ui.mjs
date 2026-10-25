// 실황 노드 필터 해제 규칙(순수): 칩 문구·Esc 키·범위 선택
import { t } from './i18n.mjs';
export const FILTER_HINT = t('app.filter.hint');

/** 칩 문구·툴팁 */
export function filterChip(name) {
  return { text: t('app.filter.text', { name }), title: t('app.filter.title', { name, hint: FILTER_HINT }) };
}

/** Esc 로 필터를 풀까: 필터가 있고, 입력창에 포커스가 없고, 조합 키가 아님 */
export function escClears(e, hasFilter) {
  if (!hasFilter || !e || e.key !== 'Escape') return false;
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
  const t = e.target || {};
  const tag = String(t.tagName || '').toUpperCase();
  return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable);
}

/** 범위 선택이 필터를 풀까: 프로젝트(같은 프로젝트 재선택 포함)·전체 → 예, 세션 → 아니오 */
export function scopeClears(next) {
  return !next || next.scope === 'all' || next.scope === 'project';
}
