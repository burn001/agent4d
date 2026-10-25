// 연속 재생(데모)·보관함 설명 카드의 순수 규칙. DOM 없음 → node 시험.
import { t } from '../i18n.mjs';

/** 연속 재생 속도 단계: 볼거리 근처 1×, 바쁜 구간 2×, 보통 4×, 한산 8×, 조용함 32× */
export const DEMO = {
  NEAR_BEFORE: 5_000, NEAR_AFTER: 20_000, // 하이라이트 [t−5초, t1+20초] 은 제 속도(1×)
  WINDOW: 30_000,                         // 지금 앞뒤 30초 버킷의 이벤트 밀도로 판단
  BUSY: 30, NORMAL: 10, SPARSE: 3,        // 분당 이벤트 수 기준
  NEXT_DELAY_MS: 1500,                    // 한 세션이 끝나면 이만큼 쉬고 다음
};

/** 지금 vt 주변 분당 이벤트 수(타임라인 버킷으로) */
export function rateAt(tl, vt, win = DEMO.WINDOW) {
  const B = tl && tl.buckets;
  if (!B || !B.counts || !B.counts.length || !(B.size > 0)) return 0;
  const start = Date.parse(tl.startTs);
  const i0 = Math.max(0, Math.floor((vt - win - start) / B.size));
  const i1 = Math.min(B.counts.length - 1, Math.floor((vt + win - start) / B.size));
  if (i1 < i0) return 0;
  let n = 0;
  for (let i = i0; i <= i1; i++) n += B.counts[i];
  const spanMs = Math.max(B.size, (i1 - i0 + 1) * B.size);
  return (n / spanMs) * 60_000;
}

/** 연속 재생 중 vt 에서 쓸 속도 */
export function demoSpeedAt(tl, vt) {
  for (const h of (tl && tl.highlights) || []) {
    if (vt >= h.t - DEMO.NEAR_BEFORE && vt <= (h.t1 || h.t) + DEMO.NEAR_AFTER) return 1;
  }
  const r = rateAt(tl, vt);
  if (r >= DEMO.BUSY) return 2;
  if (r >= DEMO.NORMAL) return 4;
  if (r >= DEMO.SPARSE) return 8;
  return 32;
}

/**
 * 연속 재생 속도 제어: 사용자가 속도를 바꾸면(manual) 그 세션 동안 또는 '자동'을 다시 누를 때까지 자동 속도를 걸지 않는다.
 * 돌려주는 값: 걸 속도, 또는 null(손대지 않음)
 */
export function demoTargetSpeed(tl, vt, manual) { return manual ? null : demoSpeedAt(tl, vt); }

/** 재생 목록(메인만, 시작 순)에서 cur 다음 세션. 끝이면 처음으로. 목록이 비면 null */
export function nextInPlaylist(items, cur) {
  const list = (items || []).filter((x) => x && !x.child).slice().sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  if (!list.length) return null;
  const i = list.findIndex((x) => x.id === cur);
  return list[(i + 1) % list.length] || list[0];
}

const pad = (n) => String(n).padStart(2, '0');
/** ISO → 'MM/DD HH:mm' KST(보관 기록 표기와 같은 시간대) */
export function kstShort(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 9 * 3600e3);
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
export function hoursText(h) {
  if (!Number.isFinite(h)) return '';
  if (h < 1) return t('replay.arc.min', { n: Math.max(1, Math.round(h * 60)) });
  return t('replay.arc.hr', { n: Math.round(h * 10) / 10 });
}

/** 보관함 설명 카드 내용: {title, why[], stats:[[이름, 값]…], range} — 지표가 없으면 목록 정보로 */
export function archiveCardModel(s) {
  if (!s) return null;
  const m = s.archiveMeta || {};
  const first = m.first || s.startedAt, last = m.last || s.endedAt;
  const hours = Number.isFinite(m.hours) ? m.hours : (Date.parse(last) - Date.parse(first)) / 3600e3;
  const stats = [];
  if (Number.isFinite(m.tools)) stats.push([t('replay.arc.tools'), String(m.tools)]);
  if (Number.isFinite(m.kinds)) stats.push([t('replay.arc.kinds'), String(m.kinds)]);
  if (Number.isFinite(m.subs)) stats.push([t('replay.arc.subs'), String(m.subs)]);
  if (Number.isFinite(m.bg)) stats.push([t('replay.arc.bg'), String(m.bg)]);
  if (Number.isFinite(hours)) stats.push([t('replay.arc.hours'), hoursText(hours)]);
  return {
    title: s.title || String(s.sessionId || '').replace(/^arc:/, '').slice(0, 8),
    why: Array.isArray(m.why) && m.why.length ? m.why : [],
    stats,
    range: first ? `${kstShort(first)} – ${kstShort(last)} KST` : '',
  };
}
