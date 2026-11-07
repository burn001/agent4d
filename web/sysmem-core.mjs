// 시스템 메모리 게이지 순수 함수 — DOM 없음(node 시험 대상).
// 서버 SSE `mem` = { used, total, pct } (바이트·%). 색 단계 이름·토큰은 한도·컨텍스트 게이지와 같다(lv-ok·lv-warn·lv-danger),
// 경계만 RAM 에 맞춰 80%↑ 주의, 90%↑ 경고(평소 60～70% 를 쓰는 PC 가 많아 한도 게이지의 70% 는 늘 주황이 된다).
import { t as tr } from './i18n.mjs';

export const MEM_WARN_PCT = 80;
export const MEM_DANGER_PCT = 90;
const GIB = 1024 ** 3;

export function memLevel(p) {
  if (p == null || !isFinite(p)) return 'none';
  return p >= MEM_DANGER_PCT ? 'danger' : p >= MEM_WARN_PCT ? 'warn' : 'ok';
}

/** 바이트 → GB 문구(GiB 기준, 소수 한 자리. 100 이상은 정수) */
export function fmtGB(bytes) {
  if (bytes == null || !isFinite(bytes)) return '—';
  const g = Math.max(0, bytes) / GIB;
  return g >= 100 ? String(Math.round(g)) : (Math.round(g * 10) / 10).toFixed(1);
}

export function memPctText(p) {
  if (p == null || !isFinite(p)) return '—';
  return Math.round(Math.max(0, Math.min(100, p))) + '%';
}

/** 값이 쓸 만한가: total > 0, 0 ≤ used ≤ total */
export function validMem(v) {
  return !!(v && Number(v.total) > 0 && Number(v.used) >= 0 && Number(v.used) <= Number(v.total));
}

/**
 * 화면 모델. 꺼짐·재생 중(실시간 값이라 지난 장면과 섞지 않음)·값 없음이면 visible false.
 * @returns {{ visible, level, pct, pctText, usedText, totalText, availText, title, stale }}
 */
export function memView(v, { on = true, replaying = false, stale = false } = {}) {
  if (!on || replaying || !validMem(v)) return { visible: false, level: 'none', pct: 0, pctText: '—', usedText: '', totalText: '', availText: '', title: '', stale: false };
  const pct = isFinite(v.pct) ? Math.max(0, Math.min(100, Number(v.pct))) : (v.used / v.total) * 100;
  const usedText = fmtGB(v.used), totalText = fmtGB(v.total), availText = fmtGB(v.total - v.used);
  const pctT = memPctText(pct);
  const title = [tr('sound.mem.title'), tr('sound.mem.used', { used: usedText, total: totalText, pct: pctT }), tr('sound.mem.avail', { avail: availText }),
    stale ? tr('sound.mem.stale') : ''].filter(Boolean).join('\n');
  return { visible: true, level: memLevel(pct), pct, pctText: pctT, usedText, totalText, availText, title, stale: !!stale };
}
