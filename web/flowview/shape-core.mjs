// 흐름(Flow) 노드 모양 — 순수 부분(three·DOM 없음). 3D(chips.js·main-rigs.js)와 2D(flat/flow2d.js)가 같은 표를 읽는다.
// 사용자 결정(2026-10-28): 메인 = 반응로 코어·데이터 띠 기둥 두 가지를 노드 id 시드로 결정적 배정, 서브 = '실루엣 문법'(종류마다 몸 모양).
import { HEAT } from '../heat-core.mjs'; // 컨텍스트 색 경계(ctxTone)

/** FNV-1a 32비트 → 0..2^32-1 (같은 id 는 새로고침·재생·보관함·3D⇄2D 어디서나 같은 값) */
export function fnv(s) {
  let h = 2166136261 >>> 0;
  s = String(s ?? '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export const MAIN_SHAPES = ['reactor', 'column'];
/** id 하나만 보고 정하는 기본 모양 */
export const mainShapeBase = (id) => MAIN_SHAPES[(fnv('main-shape:' + id) >>> 7) & 1];

const ENDED = new Set(['done', 'stopped', 'error']);
const tsOf = (x) => { const t = typeof x === 'number' ? x : Date.parse(x || ''); return Number.isFinite(t) ? t : 0; };

/**
 * 메인 모양 배정: mains = [{id, projectId, status, startedAt}] → Map id → 'reactor'|'column'.
 * - 기본은 id 시드(mainShapeBase).
 * - 같은 프로젝트에 끝나지 않은 메인이 둘 이상이면 시작 순서(startedAt, id)로 줄 세워 첫째는 기본 모양, 다음부터 번갈아 —
 *   같은 섬의 live 메인이 섞인다. 새 메인은 뒤에 붙으므로 먼저 있던 메인의 모양은 그대로(앞 메인이 끝나 빠질 때만 바뀔 수 있음).
 * 입력이 같으면 결과가 같다(시각 = 데이터의 시작 시각, 화면 시계 아님).
 */
export function assignMainShapes(mains) {
  const out = new Map(), live = new Map();
  for (const m of mains || []) {
    if (!m || m.id == null) continue;
    out.set(m.id, mainShapeBase(m.id));
    if (ENDED.has(m.status)) continue;
    const k = m.projectId ?? '';
    let a = live.get(k); if (!a) live.set(k, a = []);
    a.push(m);
  }
  for (const a of live.values()) {
    if (a.length < 2) continue;
    a.sort((x, y) => (tsOf(x.startedAt) - tsOf(y.startedAt)) || (String(x.id) < String(y.id) ? -1 : 1));
    let s = mainShapeBase(a[0].id);
    out.set(a[0].id, s);
    for (let i = 1; i < a.length; i++) { s = s === 'reactor' ? 'column' : 'reactor'; out.set(a[i].id, s); }
  }
  return out;
}
/** 배정 입력의 서명(바뀔 때만 다시 계산) */
export const mainSetSig = (mains) => (mains || []).map((m) => `${m.id}:${m.projectId ?? ''}:${ENDED.has(m.status) ? 0 : 1}`).sort().join('|');

// ── 서브 실루엣 ──
// 번호는 셰이더 aMeta.z(모양) — 0 육각(기존 기둥: 배치 장치·작업 칩·분리 프로세스도 이 틀) · 1 모서리 깎인 육각 · 2 두 단 육각 · 3 네모 터미널 · 4 둥근 퍽
export const SIL = { hex: 0, cham: 1, tier2: 2, term: 3, puck: 4 };
export const SIL_NAMES = ['hex', 'cham', 'tier2', 'term', 'puck'];
/**
 * 종류 → 실루엣. kind = 표시 종류(scene displayKind: 독립 claude -p 루트는 'claude-p'), flags = {device, job, proc}.
 * 기동기(배치 장치)·작업 칩·분리 프로세스 장치는 지금 모양이 의미가 있어 그대로(hex 틀 + 셰이더 깃발).
 * 워크플로 루트는 워크플로 에이전트와 같은 가족(깎인 육각, 더 큼), 재무장 Monitor 는 Monitor 퍽, 러너·회차(claude -p)는 두 단.
 */
export function silOf(kind, flags = {}) {
  if (flags.device || flags.job || flags.proc) return 'hex';
  switch (kind) {
    case 'workflow': case 'workflow-agent': return 'cham';
    case 'claude-p': return 'tier2';
    case 'bash-bg': return 'term';
    case 'monitor': return 'puck';
    default: return 'hex';
  }
}
/**
 * 실루엣 치수(노드 반지름 단위) — 3D 기둥 두께 h, 윗면 외곽 크기, 2D 외곽선이 같은 값을 쓴다.
 * top = 윗면 외곽 배율(두 단 육각은 윗단이 작음), cut = 깎은 모서리 거리(꼭짓점 1 기준), box = 네모 반폭·반깊이
 */
export const SIL_DIM = {
  hex: { h: 0.62, top: 1 },
  cham: { h: 0.62, top: 1, cut: 0.7 },
  tier2: { h: 0.92, top: 0.66, lower: 0.42, seam: 0.16 }, // 아랫단 높이 비율 · 이음 틈 비율(윗단 = 나머지)
  term: { h: 0.8, top: 1, box: [1.12, 0.78] },
  puck: { h: 0.5, top: 0.96 },
};

/** 2D 외곽선 꼭짓점(화면 좌표계: x 오른쪽 · y 아래, 반지름 R) — 육각은 꼭짓점이 위. 3D 윗면 그림과 같은 모양 */
export function silOutline(sil, R) {
  const P = [];
  const hex = (r) => { for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (Math.PI / 3) * i; P.push([Math.cos(a) * r, Math.sin(a) * r]); } };
  if (sil === 'term') { const [bx, by] = SIL_DIM.term.box; P.push([-bx * R, -by * R], [bx * R, -by * R], [bx * R, by * R], [-bx * R, by * R]); return P; }
  if (sil === 'puck') { for (let i = 0; i < 24; i++) { const a = (Math.PI * 2 * i) / 24; P.push([Math.cos(a) * R * SIL_DIM.puck.top, Math.sin(a) * R * SIL_DIM.puck.top]); } return P; }
  if (sil === 'cham') {
    // 오른쪽 위 꼭짓점(i = 1, 각 −30°)을 깎는다: 이웃 두 변의 cut 지점으로 대체
    hex(R);
    const c = SIL_DIM.cham.cut, a = P[0], b = P[1], d = P[2];
    const k = 1 - c; // 꼭짓점에서 변을 따라 k 만큼 들어간 점
    const p1 = [b[0] + (a[0] - b[0]) * k, b[1] + (a[1] - b[1]) * k], p2 = [b[0] + (d[0] - b[0]) * k, b[1] + (d[1] - b[1]) * k];
    P.splice(1, 1, p1, p2);
    return P;
  }
  hex(sil === 'tier2' ? R : R);
  return P;
}

// ── 메인 반응로 · 데이터 기둥 공용 값 ──
/** 컨텍스트 사용률 → 단계(0 하늘 <30 · 1 호박 <70 · 2 빨강 맥동) — 과열 단계(HEAT.WARM_PCT 30 데움·HOT_PCT 70 과열)와 같은 경계(예전 50·75) */
export const ctxTone = (f) => (f < HEAT.WARM_PCT / 100 ? 0 : f < HEAT.HOT_PCT / 100 ? 1 : 2);
/** 컨텍스트 비율 0..1 (값이 없으면 null) */
export function ctxFrac(node) {
  const c = node && node.meta && node.meta.ctx;
  if (!c || !c.limit) return null;
  return Math.min(1, Math.max(0, c.used / c.limit));
}
/** 반응로 기둥 여섯 채움(0..1 배열): 한 기둥 ≈ 1/6 */
export function reactorFills(f, out = new Array(6)) {
  const t = Math.max(0, Math.min(1, f || 0)) * 6;
  for (let i = 0; i < 6; i++) out[i] = Math.max(0, Math.min(1, t - i));
  return out;
}
/**
 * 데이터 띠 글: 최근 도구 이력(hist = [{label:'Tool · 대상', res}], 서버가 redact·minimal 처리한 값) → 띠에 흐를 낱말들.
 * privacy minimal 이면 대상이 비어 도구 이름만 남는다. 비면 기본 글리프만.
 */
export function bandWords(hist, max = 6) {
  const out = [];
  for (let i = (hist || []).length - 1; i >= 0 && out.length < max; i--) {
    const l = hist[i] && hist[i].label;
    if (!l) continue;
    const s = String(l).replace(/\s+/g, ' ').trim().slice(0, 40);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
/** 도구 중 가운데 띠 글: 열린 도구 중 마지막(act = 'Tool · 대상') */
export function toolBand(icons) {
  let last = null;
  if (icons) for (const a of icons.values()) last = a;
  return last && last.act ? String(last.act).slice(0, 44) : '';
}

// ── 사용자 콘솔(홀로그램 콘솔 데스크) ──
/** 화면 글이 읽힐 폭(px). 그보다 작으면 화면 글 대신 '나' 배지만 */
export const DESK = { TEXT_PX: 70, BADGE_PX: 14, FPS: 12, TEX_W: 512, TEX_H: 288, SEND_S: 1.3 };
/** 보낸 직후 연출 위상(초 → 0..1, 끝나면 -1): 자판 번쩍(0..0.35) → 글자 빛이 화면으로(0.2..0.9) */
export function sendPhase(sinceSec, dur = DESK.SEND_S) {
  if (sinceSec == null || !(sinceSec >= 0) || sinceSec > dur) return -1;
  return sinceSec / dur;
}
