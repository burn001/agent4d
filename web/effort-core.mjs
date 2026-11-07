// 추론 effort 시각 차등 — 모든 표현이 함께 쓰는 순수 규칙
// three·DOM 없음(node --test 대상, web/test/effort.test.mjs).
//
// 서버가 보내는 것(문자열만, 단계 숫자는 웹이 만든다 — 새 단계 이름이 생겨도 서버 수정 불필요):
//   meta.effort    적용값(확정) — transcript assistant 기록 effort → perTurnEffort
//   meta.effortReq 요청값       — 부모 Agent input.effort · 서브에이전트 meta.json effort · claude -p --effort
// 공통 척도: effort 는 "개수·높이(구조)"로만 말한다. 색상(hue)·움직임·빛은 쓰지 않는다. 잉크는 무채색(테마 글자색).
//   시각 단계 1～4(low · medium · high · xhigh·max). 확정(적용값) = 채운 칸, 요청값만(응답 전) = 속 빈 칸, 알 수 없음 = 무늬 없음(지금 모습 그대로).
//   사용자 결정(2026-11-06 저녁): xhigh 와 max 는 모든 표현에서 같은 모습(맨 위 단계 = 닫힌 무늬). 묶는 것은 그림뿐 —
//   글(툴팁·팝업 '요청 … · 적용 …', 집계, 꼬리표)은 실제 값(xhigh 또는 max)을 그대로 보인다. 묶음은 effortLevel 한 곳에서만.
// 사용자 결정(2026-11-06): ① 무늬는 하위 노드(subagent·workflow-agent·claude-p)에만, 메인은 글로만
//   (복셀 예외 — 오피스·연구소는 옷차림·자리 분위기로 메인까지 같은 언어, 팀장 이름표 글 없음: voxel/vx-effort-core.mjs)
//   ② 흐름 3D 는 다이얼 눈금 + 기둥 높이  ③ 라벨 옆 'effort X' 글은 무늬가 생긴 노드에서는 빼고, 메인은 medium 이 아닐 때만.

import { t as tr } from './i18n.mjs';

/** 단계 이름(값 순서 1～5 — 글·집계 정렬용). 그림은 이 이름을 시각 단계(EFFORT_TIER)로 바꿔 쓴다 */
export const EFFORT_NAMES = ['low', 'medium', 'high', 'xhigh', 'max'];
/** 이름 → 시각 단계(1～4). xhigh·max 는 같은 맨 위 단계(사용자 결정 2026-11-06) */
export const EFFORT_TIER = Object.freeze({ low: 1, medium: 2, high: 3, xhigh: 4, max: 4 });
/** 맨 위 시각 단계(= 칸 수 · 닫힌 무늬) */
export const EFFORT_MAX = 4;

/** 시각 단계별 표(인덱스 = 단계 1～4, 0 = 알 수 없음·미지정 → 지금 모습) */
export const EFFORT = {
  HEIGHT_K: [1.00, 0.80, 1.00, 1.22, 1.48], // 흐름 기둥 높이 배(medium = 지금 그대로, 단계마다 약 1.22배)
  ARCS: [3, 2, 3, 4, 6],                    // Planet 서브 케이지 자오선 호 수(호 간격 180°·120°·90°·60°, 미상 = 지금 3, 맨 위 = 6 + 안쪽 고리)
  TWEEN_MS: 400,                                   // 단계가 바뀔 때 차오르기·높이 보간 시간
  FAST_RATE: 8,                                    // 재생 이 배속 이상이면 보간 없이 즉시
  GLINT_MS: 6000,                                  // 맨 위 단계(xhigh·max)의 옅은 반짝임 주기(동작 줄이기·LOD·일시정지면 없음)
  REQ_PREVIEW: true,                               // 요청값만 있을 때 속 빈 칸으로 미리 보이기(끄면 확정값만)
};

/** 무늬를 그리는 노드 종류(결정 ①: 메인 제외) */
export const EFFORT_KINDS = new Set(['subagent', 'workflow-agent', 'claude-p']);

/** LOD 문턱(화면 반지름 px). < HIDE: 무늬 숨김 · < FULL: 채운 칸만(빈 칸·닫힘 호 생략) · 그 이상: 전부. 휴대폰은 PHONE_K 배 */
export const EFFORT_LOD = { HIDE: 10, FULL: 18, PHONE_K: 1.3, PHONE_SHORT: 500 };

/**
 * 시각 단계 정규화(모든 표현이 이 값만 본다): 'low'..'max'(대소문자·앞뒤 공백 무시) → 1..4(xhigh·max = 4),
 * 그 밖(미상 문자열·빈 값·숫자 아님) → null
 */
export function effortLevel(v) {
  if (typeof v !== 'string') return null;
  const k = v.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(EFFORT_TIER, k) ? EFFORT_TIER[k] : null;
}
/** 값 순서(글 정렬용, 그림에는 쓰지 않음): 'low'..'max' → 1..5, 그 밖 null */
export function effortRank(v) {
  if (typeof v !== 'string') return null;
  const i = EFFORT_NAMES.indexOf(v.trim().toLowerCase());
  return i < 0 ? null : i + 1;
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 24) : null);

/**
 * 노드의 effort 해석. 적용값이 있으면 그것(확정·채운 칸), 없으면 요청값(속 빈 칸), 둘 다 없으면 null.
 * 반환 { level 시각 단계 1～4|null, name 표시 이름(원문 소문자), confirmed, hollow, req, applied, reqLevel, appliedLevel }
 *   - level null 이고 name 이 있으면 '알 수 없는 단계 이름'(무늬 없이 글만)
 *   - hollow = 요청값만 있고 아직 응답 전(EFFORT.REQ_PREVIEW 가 꺼지면 level null)
 */
export function effortOf(node) {
  const m = (node && node.meta) || {};
  const applied = str(m.effort), req = str(m.effortReq);
  if (!applied && !req) return null;
  const appliedLevel = effortLevel(applied), reqLevel = effortLevel(req);
  if (applied) {
    return { level: appliedLevel, name: applied.toLowerCase(), confirmed: true, hollow: false, req, applied, reqLevel, appliedLevel };
  }
  const level = EFFORT.REQ_PREVIEW ? reqLevel : null;
  return { level, name: req.toLowerCase(), confirmed: false, hollow: level != null, req, applied: null, reqLevel, appliedLevel: null };
}

/** 이 노드 종류에 무늬를 그리나(결정 ①) */
export const effortDrawnKind = (kind) => EFFORT_KINDS.has(kind);
/** 표시 종류: 어떤 메인에도 매칭되지 않은 독립 claude -p 루트(서버 kind 'main' + meta.orphanSdk)는 'claude-p'(scene.js·flat-view.js 와 같은 규칙) */
export const effortKindOf = (node) => (node && node.kind === 'main' && node.meta && node.meta.orphanSdk ? 'claude-p' : node && node.kind);

/**
 * 표현 구현자용 한 줄: 무늬를 그릴 effort(대상 종류 + 단계가 있을 때만), 아니면 null.
 * 반환 effortOf 결과 + { filled: 채운 칸 수(확정이면 level, 요청이면 0), hollowN: 속 빈 칸 수(요청이면 level),
 *   top: 맨 위 단계(xhigh·max, 요청 포함), closed: 맨 위 단계 확정 = 닫힘 }
 */
export function effortGlyph(node) {
  if (!node || !effortDrawnKind(effortKindOf(node))) return null;
  const e = effortOf(node);
  if (!e || e.level == null) return null;
  return { ...e, filled: e.confirmed ? e.level : 0, hollowN: e.confirmed ? 0 : e.level, top: e.level === EFFORT_MAX, closed: e.level === EFFORT_MAX && e.confirmed };
}

/** 셰이더용 숫자 두 개: [시각 단계 0～4, 확정 1 / 요청 0.5 / 없음 0] (흐름 iC.y·iC.z) */
export function effortAttr(node) {
  const g = effortGlyph(node);
  return g ? [g.level, g.confirmed ? 1 : 0.5] : [0, 0];
}

/** 그릴 단계(무늬 없음 = 0). 표 인덱스로 쓴다 */
export const effortDrawLevel = (node) => effortGlyph(node)?.level ?? 0;
/**
 * 흐름 기둥 높이 배. 요청 상태는 지금 높이(1) — 확정 순간 보간(EffortTween)으로 바뀐다.
 * 대상 종류가 아니거나 미상이면 1.
 */
export function effortHeightK(node) {
  const g = effortGlyph(node);
  return g && g.confirmed ? EFFORT.HEIGHT_K[g.level] : 1;
}
/** Planet 서브 케이지 자오선 호 수(요청 상태도 같은 수 — 늘어날 호는 표현이 40% 투명으로) */
export const effortArcs = (node) => EFFORT.ARCS[effortDrawLevel(node)];

/**
 * 라벨 옆 꼬리표 글(결정 ③). 보일 글(적용값 원문) 또는 null.
 *   - 무늬가 생기는 노드(effortGlyph 있음) → null(그림이 대신 말함)
 *   - 메인 → medium 이 아닐 때만
 *   - 그 밖(대상 종류의 알 수 없는 단계 이름 등) → 적용값이 있으면 그대로(요청값만이면 글도 없음)
 */
export function effortTagText(node) {
  if (!node) return null;
  const applied = str(node.meta && node.meta.effort);
  if (!applied) return null;
  if (effortKindOf(node) === 'main') return effortLevel(applied) === 2 ? null : applied;
  if (effortGlyph(node)) return null;
  return applied;
}

/** LOD 단계: 0 숨김 · 1 채운 칸만 · 2 전부. px = 노드 화면 반지름, phone = 짧은 변 < 500px */
export function effortLod(px, { phone = false } = {}) {
  const k = phone ? EFFORT_LOD.PHONE_K : 1;
  if (!(px >= EFFORT_LOD.HIDE * k)) return 0;
  return px < EFFORT_LOD.FULL * k ? 1 : 2;
}
/** 화면 짧은 변으로 휴대폰 여부 */
export const effortPhone = (w, h) => Math.min(w, h) < EFFORT_LOD.PHONE_SHORT;

/** 잉크 토큰(theme.css --effort-ink* 와 같은 값). rgb 0～1 + a. 3D 는 이 값을 uniform 으로, 캔버스는 css 문자열로 */
export const EFFORT_INK = {
  dark: { ink: [230, 233, 239, 0.62], dim: [230, 233, 239, 0.20], glint: [255, 255, 255, 0.85] },
  light: { ink: [21, 26, 35, 0.58], dim: [21, 26, 35, 0.16], glint: [21, 26, 35, 0.85] },
};
/**
 * 테마별 잉크. isLight → { ink, dim, glint } 각 { css:'rgba(…)', rgb:[r,g,b](0～1), a, hex:0xRRGGBB }
 * 다크 = 보통 섞기(가산 아님), 라이트 = 곱하기 잉크 — 섞기 방식은 표현이 정한다.
 */
export function effortInk(isLight) {
  const src = isLight ? EFFORT_INK.light : EFFORT_INK.dark;
  const out = {};
  for (const [k, [r, g, b, a]] of Object.entries(src)) {
    out[k] = { css: `rgba(${r}, ${g}, ${b}, ${a})`, rgb: [r / 255, g / 255, b / 255], a, hex: (r << 16) | (g << 8) | b };
  }
  return out;
}

/**
 * 0.4초 보간 장부(노드 id 별). value(id, target, nowMs) → 지금 그릴 값(단계·높이 배·비율 어느 숫자든).
 * 처음 본 id 는 보간 없이 target. target 이 바뀌면 지금 값에서 TWEEN_MS 동안 선형(끝 부드럽게) 이동.
 * instant(동작 줄이기·재생 8배속 이상·스크럽)면 즉시. forget(id)·prune(liveIds) 로 정리.
 */
let SNAP_EPOCH = 0;
/**
 * 스냅샷 경계 알림(app.js onSnapshot·onSnapshotAll — 재생 스크럽·세션 바꾸기·재연결). 모든 EffortTween 장부를 비워
 * 그 시점 값을 보간 없이 바로 그리게 한다("스크럽·스냅샷은 즉시").
 */
export function effortSnap() { SNAP_EPOCH++; }
export class EffortTween {
  constructor(ms = EFFORT.TWEEN_MS) { this.ms = ms; this.m = new Map(); this.ep = SNAP_EPOCH; }
  value(id, target, nowMs, { instant = false } = {}) {
    if (this.ep !== SNAP_EPOCH) { this.m.clear(); this.ep = SNAP_EPOCH; }
    let s = this.m.get(id);
    if (!s || instant) { this.m.set(id, { from: target, to: target, t0: nowMs }); return target; }
    if (s.to !== target) { s = { from: this._at(s, nowMs), to: target, t0: nowMs }; this.m.set(id, s); }
    return this._at(s, nowMs);
  }
  _at(s, now) {
    const u = this.ms > 0 ? Math.min(1, Math.max(0, (now - s.t0) / this.ms)) : 1;
    const e = u * u * (3 - 2 * u); // smoothstep
    return s.from + (s.to - s.from) * e;
  }
  /** 아직 움직이는 중인가(다시 그리기 요청 판단용) */
  busy(id, nowMs) { if (this.ep !== SNAP_EPOCH) return false; const s = this.m.get(id); return !!s && s.from !== s.to && nowMs - s.t0 < this.ms; }
  forget(id) { this.m.delete(id); }
  prune(liveIds) { for (const id of this.m.keys()) if (!liveIds.has(id)) this.m.delete(id); }
}
/** 보간을 건너뛸 때: 동작 줄이기 또는 재생 배속 ≥ FAST_RATE */
export const effortInstant = ({ reduced = false, rate = 1 } = {}) => !!reduced || rate >= EFFORT.FAST_RATE;

/** 보조: 시각 단계 이름(1～4 → 'low' · 'medium' · 'high' · 'xhigh·max', 그 밖 null) — 실제 값 글은 effortOf().name */
export const EFFORT_TIER_NAMES = ['low', 'medium', 'high', 'xhigh·max'];
export const effortName = (lv) => EFFORT_TIER_NAMES[lv - 1] || null;

/**
 * 툴팁·상세 팝업 한 줄. 예: '추론 effort high — 요청 high · 적용 high' / '추론 effort high — 요청 high · 아직 응답 전'
 *   / '추론 effort high — 요청 없음(기본값) · 적용 high'. effort 가 없으면 null.
 */
export function effortTip(node) {
  const e = effortOf(node);
  if (!e) return null;
  const req = e.req ? tr('cards.eff.req', { v: e.req }) : tr('cards.eff.reqNone');
  const app = e.applied ? tr('cards.eff.applied', { v: e.applied }) : tr('cards.eff.pending');
  return tr('cards.eff.tip', { v: e.name, req, app });
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** 미니 미터 막대 높이(px, 시각 단계 1～4) — 맨 위가 예전 5칸 미터 높이(7px)와 같음 */
export const EFFORT_METER_H = [4, 5, 6, 7];
/**
 * 4칸 미니 미터 HTML(실황 패널·상세 팝업·범례). 신호 막대형: 높이 4·5·6·7px, 폭 2px, 간격 2px(theme.css).
 * 채운 칸 class 'on', 빈 칸 'off', 요청 상태는 줄무늬('hollow'), 맨 위 단계(xhigh·max) 확정은 'closed'. 무늬 없음 → ''.
 * node 대신 { level, confirmed } 꼴(범례 견본)도 받는다. 스타일은 theme.css .eff-meter.
 * opts.title: true(기본)면 effortTip 을 title 로(aria-label 은 늘 effortTip — 실제 값).
 */
export function effortMeterHtml(nodeOrInfo, { title = true } = {}) {
  let lv, confirmed, tip = null;
  if (nodeOrInfo && typeof nodeOrInfo.level === 'number' && !nodeOrInfo.meta) {
    lv = nodeOrInfo.level; confirmed = nodeOrInfo.confirmed !== false;
  } else {
    const g = effortGlyph(nodeOrInfo);
    if (!g) return '';
    lv = g.level; confirmed = g.confirmed;
    tip = effortTip(nodeOrInfo); // 글은 실제 값(xhigh 또는 max) — 미터 그림만 맨 위 단계로 묶임
  }
  if (!(lv >= 1 && lv <= EFFORT_MAX)) return '';
  let bars = '';
  for (let i = 1; i <= EFFORT_MAX; i++) bars += `<i class="${i <= lv ? 'on' : 'off'}" style="height:${EFFORT_METER_H[i - 1]}px"></i>`;
  const cls = `eff-meter${confirmed ? '' : ' hollow'}${confirmed && lv === EFFORT_MAX ? ' closed' : ''}`;
  return `<span class="${cls}" data-lv="${lv}"${tip && title ? ` title="${escAttr(tip)}"` : ''} aria-label="${escAttr(tip || `effort ${effortName(lv)}`)}">${bars}</span>`;
}

/** 세션 줄 툴팁 집계(사이드 패널): 살아 있는 대상 노드 effort 이름별 수. 예 'high 2 · xhigh 1', 없으면 '' */
export function effortCounts(nodes) {
  const c = new Map();
  for (const n of nodes || []) {
    if (!n || !effortDrawnKind(effortKindOf(n)) || n.status === 'done' || n.status === 'error' || n.status === 'stopped') continue;
    const e = effortOf(n);
    if (!e || !e.name) continue;
    c.set(e.name, (c.get(e.name) || 0) + 1);
  }
  const order = (k) => { const l = effortRank(k); return l == null ? 99 : l; }; // 글이므로 실제 값 순서(xhigh < max)
  return [...c.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(' · ');
}
