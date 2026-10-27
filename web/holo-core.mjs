// 홀로그램 모니터의 순수 부분(three·DOM 없음)
//   도구 종류 → 화면 무늬(mode)·글리프(glyph), 열림·결과 섬광·접힘 단계(holoPhase), 노드 주위 호 자리(holoSlotDir),
//   화면 크기(px)에 따른 단순화 단계(holoLod), 짧은 라벨(holoLabel), 노드별 도구 장부(HoloBook: 자리 배정·대기열·상한).
// 라이브·재생·mock 은 모두 app.onEvent → view.toolStart/toolEnd 를 지나므로 같은 장부를 쓴다. node --test 로 시험(web/test/holo.test.mjs).
import { t as tr } from './i18n.mjs';
import { jobOf, jobCode } from './job-core.mjs';
import { runState, runHead, toMs, RUNW } from './run-core.mjs'; // 실행 중 셸 — 셸 패널 머리줄 경과·백그라운드 꼬리 작은 상태

export const HOLO = {
  MAX: 512,           // 화면 전체 동시에 그리는 패널 상한(인스턴싱) — 넘으면 대기열
  PER_NODE: 8,        // 노드 하나 주위에 동시에 펼치는 패널(넘치면 +N) — 도구 종류별 방향
  STACK: 2,           // 같은 방향(같은 종류)에 겹쳐 쌓는 패널 수(병렬 호출), 넘치면 대기
  OPEN: 0.34,         // 펼침: 가는 빛줄이 옆으로 퍼진 뒤(앞 45%) 위아래로 열림
  MIN_SHOW: 0.9,      // 짧은 도구도 이만큼은 보인다(배속이면 √배속으로 나눔)
  FLASH: 0.32,        // 끝: 결과색(초록·빨강·회색)으로 번쩍
  FOLD: 0.36,         // 그다음 위아래로 접혀 줄 → 점으로 사라짐
  ASPECT: 1.5,        // 폭/높이
  LOD_HIDE_PX: 3,     // 패널 높이가 이보다 작으면 그리지 않는다(아주 먼 전체 보기)
  LOD_DETAIL_PX: 30,  // 이보다 크면 무늬(터미널 줄·페이지 넘김…)까지, 작으면 테두리+큰 글리프만
  LABEL_PX: 40,       // 라벨(도구명·대상·결과)을 패널 안에 붙일 최소 패널 높이
  MAX_LABELS: 12,     // 동시에 띄우는 라벨 수
  // 지속·가시성(2차): 끝난 도구는 '최근 작업 모니터'로 남는다
  LINGER: 7,          // 마지막 패널은 끝난 뒤 최소 이만큼 결과를 보여 준다(그 뒤 노드가 작업 중이면 계속, 아니면 접힘)
  LINGER_END: 1.6,    // 노드가 끝나면(완료·중지·오류) 결과를 이만큼만 보이고 접힘
  LINGER_TINT: 0.14,  // 남아 있는 동안 결과색 옅은 물들임
  SWAP: 0.3,          // 다음 도구가 같은 패널을 이어받을 때 위→아래 갈림 띠 시간
  SOFT_GAP: 0.8,      // 이어받은 지 이 시간 안에 끝나면 섬광을 약하게(짧은 도구 연타 때 깜빡임 폭주 방지)
  TOP_ACTIVE: 6,      // 최근 활동 상위 노드: 거리 무관 최소 크기·라벨
  MIN_PX_ACTIVE: 30,  // 상위·포커스·카메라 대상 노드 패널의 최소 화면 높이(px)
  BOOST_MAX: 10,      // 최소 크기를 맞추려 세계 크기를 키우는 배율 상한
  MINI_K: 0.55,       // 백그라운드 셸 꼬리 패널 작은 상태(마지막 줄 + 경과)의 크기 배율
};

// ---- 패널 안 실제 글(서버 panel → 웹) ----
export const PANEL = {
  LINES: 12, LINE: 100, TITLE: 100,   // 서버 상한과 같게(넘는 값은 웹도 자름)
  TEXT_MAX: 16,       // 글을 그리는 패널 동시 상한(캔버스 텍스처 풀)
  TITLE_PX: 44,       // 패널 높이가 이 이상이면 머리줄(제목)부터 글로(그보다 작으면 예전처럼 글리프 + 짧은 CSS 라벨)
  ROWS: [[72, 3], [120, 6], [170, 9], [230, 13]], // 패널 높이(px) 이상 → 보일 줄 수(13 = 12줄 + 말줄임). 72 미만은 제목만(0)
  HYST: 0.1,          // 줄 수 단계 바꿈 여유(경계에서 다시 그리기 깜빡임 방지)
  SAY_LINGER: 20,     // 말 패널: 마지막 말 뒤 이만큼 머묾
  TAIL_LINGER: 12,    // 작업 노드 자신의 출력 꼬리 패널: 마지막 출력 뒤 이만큼
  SCROLL: 0.24,       // 꼬리 갱신 때 줄이 위로 밀려 올라가는 시간
  CH: 400,            // 캔버스 높이(px), 폭 = CH × asp
};
export const MARKS = '$oe+-@dh';

const CUT = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
const LINE_CTRL_RE = new RegExp('[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\ufeff]', 'g');
/** 서버 panel 객체 → 그리기용 정리본(모양이 틀리면 null). 웹도 줄·줄 수·제목 상한을 다시 건다 */
export function normPanel(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.lines)) return null;
  const line = (s) => String(s ?? '').replace(/\t/g, '  ').replace(/[\r\n]+/g, ' ').replace(LINE_CTRL_RE, '').replace(/\s+$/, '');
  const lines = p.lines.slice(0, PANEL.LINES).map((l) => CUT(line(l), PANEL.LINE));
  const mk = String(p.marks || '');
  let marks = '';
  for (let i = 0; i < lines.length; i++) marks += MARKS.includes(mk[i]) ? mk[i] : 'o';
  const more = Number(p.more);
  const r = p.ref && typeof p.ref === 'object' ? { nodeId: String(p.ref.nodeId || ''), toolUseId: p.ref.toolUseId ? String(p.ref.toolUseId) : null } : null;
  return {
    mode: String(p.mode || 'generic'), part: String(p.part || ''), title: CUT(line(p.title).trim().replace(/\s+/g, ' '), PANEL.TITLE),
    lines, marks, more: Number.isFinite(more) && more > 0 ? Math.floor(more) : 0,
    hidden: p.hidden ? String(p.hidden) : '', thin: !!p.thin, ref: r,
  };
}
export function samePanel(a, b) {
  if (a === b) return true;
  if (!a || !b || a.title !== b.title || a.marks !== b.marks || a.more !== b.more || a.hidden !== b.hidden || a.thin !== b.thin || a.part !== b.part || a.lines.length !== b.lines.length) return false;
  for (let i = 0; i < a.lines.length; i++) if (a.lines[i] !== b.lines[i]) return false;
  return true;
}
/** 꼬리(뒤 남기기)인가: 백그라운드 꼬리·말·셸/모니터 결과는 마지막 줄이 중요 */
export const panelTailish = (p) => !!p && (p.part === 'tail' || p.part === 'say' || ((p.mode === 'shell' || p.mode === 'monitor') && p.part === 'result'));
/**
 * 보일 줄 rows 개로 줄이기 → [{text, mark}]. 넘치면 꼬리는 뒤, 그 밖은 앞을 남기고 말줄임 줄(mark 'm')을
 * 꼬리면 맨 위 `… 앞 N줄`, 아니면 맨 아래 `… N줄 더`. 서버가 이미 잘라 낸 줄(more)도 같은 말줄임에 더한다
 */
export function panelRows(p, rows) {
  if (!p || rows <= 0 || p.hidden === 'secret') return [];
  const tailish = panelTailish(p);
  const L = p.lines.map((text, i) => ({ text, mark: p.marks[i] || 'o' }));
  let out = L, cut = 0;
  if (L.length + (p.more ? 1 : 0) > rows) {
    const keep = Math.max(1, rows - 1);
    out = tailish ? L.slice(L.length - keep) : L.slice(0, keep);
    cut = L.length - keep;
  }
  const hid = (p.more || 0) + cut;
  if (hid > 0) { const m = { text: tr(tailish ? 'cards.holo.earlier' : 'cards.holo.more', { n: hid }), mark: 'm' }; if (tailish) out = [m, ...out]; else out = [...out, m]; }
  return out;
}
/** 패널 화면 높이 → 보일 줄 수(0 = 제목만). prev 가 있으면 경계 ±HYST 안에서는 그대로 */
export function textRows(px, prev = null) {
  const at = (x) => { let r = 0; for (const [p, n] of PANEL.ROWS) if (x >= p) r = n; return r; };
  const r = at(px);
  if (prev != null && r !== prev && at(px * (1 + PANEL.HYST)) >= prev && at(px * (1 - PANEL.HYST)) <= prev) return prev;
  return r;
}
/** 꼬리 창이 갱신될 때 위로 밀려난 줄 수(앞 창의 뒤쪽이 새 창의 앞쪽과 같으면 그 차이, 최대 4). 모르면 0 */
export function tailShift(a, b) {
  if (!a || !b || !a.length || !b.length) return 0;
  for (let k = 1; k <= Math.min(a.length - 1, 12); k++) {
    const n = a.length - k;
    if (n > b.length) continue;
    let ok = true;
    for (let i = 0; i < n; i++) if (a[k + i] !== b[i]) { ok = false; break; }
    if (ok) return Math.min(k, 4);
  }
  return 0;
}
/** 패널 데이터가 없을 때(예전 서버·minimal): 예전 라벨과 같은 요약 — 도구명 머리줄 + 대상 + 결과 한 줄 */
export function fallbackPanel(e) {
  const lines = [], marks = [];
  if (e.label && e.label.target) { lines.push(e.label.target); marks.push('o'); }
  if (e.result) { lines.push('→ ' + e.result); marks.push(e.res === 'error' ? 'e' : 'd'); }
  return { mode: 'generic', part: '', title: (e.label && e.label.tool) || e.tool || '', lines, marks: marks.join(''), more: 0, hidden: '', thin: false, ref: null, fallback: true };
}
/** 글줄 색(줄 표시 글자별). color null = 도구 종류 잉크 색 */
export function markStyle(mark, light) {
  const D = {
    o: ['#d6e2ef', '#1b2433'], $: [null, null], e: ['#ff8a94', '#b3261e'], '+': ['#6ff0a0', '#0f7a3f'], '-': ['#ff8a94', '#b3261e'],
    '@': ['#8ab8ff', '#1f4fb0'], d: ['rgba(190,205,225,0.62)', 'rgba(30,40,60,0.6)'], h: ['#ffd88a', '#7a4a00'], m: ['rgba(190,205,225,0.5)', 'rgba(30,40,60,0.5)'],
  };
  const BG = { '+': ['rgba(80,230,140,0.15)', 'rgba(20,140,70,0.13)'], '-': ['rgba(255,110,120,0.15)', 'rgba(200,40,40,0.11)'], e: ['rgba(255,90,100,0.08)', 'rgba(200,40,40,0.06)'] };
  const i = light ? 1 : 0;
  const c = D[mark] || D.o;
  return { color: c[i], bg: BG[mark] ? BG[mark][i] : null, bold: mark === '$' || mark === '@', dim: mark === 'd' || mark === 'm' };
}
// ---- 주인 꼬리 패널에서 작업을 만든 줄 표시 ----
// 작업 노드(meta.job.line = 마지막 줄, 서버가 공백 접기·160자 자름)와 패널 줄(100자 자름, 웹 normPanel 탭 → 공백)은
// 자르는 길이가 달라 그대로 비교하면 긴 줄이 안 맞는다 — 둘 다 공백을 접고 끝 말줄임을 떼어 '같음 또는 앞부분'으로 판정한다.
const JOB_LINE_MIN = 12; // 앞부분 일치로 볼 최소 글자 수(짧은 줄의 우연 일치 방지)
/** 작업 줄 비교용 정리: 공백 접기 · 앞뒤 공백 · 끝 말줄임(… / ...) 제거 */
export function jobLineNorm(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().replace(/(?:…|\.\.\.)$/, '').trimEnd();
}
/** 패널 줄이 작업의 마지막 줄인가: 같거나, 잘린 쪽(…)이 다른 쪽의 앞부분(정리 뒤 JOB_LINE_MIN 자 이상) */
export function sameJobLine(panelLine, jobLine) {
  const a = jobLineNorm(panelLine), b = jobLineNorm(jobLine);
  if (!a || !b) return false;
  if (a === b) return true;
  const ca = /(?:…|\.\.\.)\s*$/.test(String(panelLine ?? '')), cb = /(?:…|\.\.\.)\s*$/.test(String(jobLine ?? ''));
  if (ca && a.length >= JOB_LINE_MIN && b.startsWith(a)) return true;
  if (cb && b.length >= JOB_LINE_MIN && a.startsWith(b)) return true;
  return false;
}
/**
 * 보일 줄(panelRows 결과 [{text, mark}]) 가운데 작업을 만든 줄: 작업마다 가장 아래(가장 최근) 맞는 줄 하나에 그 작업의 상태 번호.
 * jobs = [{line, code}] (code = job-core JOB_CODE, 표시 상태 — 정체 5 포함). 말줄임 줄(m)은 건너뜀. 한 줄에 둘이 맞으면 앞 작업.
 * @returns {number[]} rows 길이, 표시 없으면 -1
 */
export function jobRowHits(rows, jobs) {
  const out = new Array((rows && rows.length) || 0).fill(-1);
  if (!out.length || !jobs || !jobs.length) return out;
  for (const j of jobs) {
    if (!j || !j.line) continue;
    for (let i = out.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (!r || r.mark === 'm') continue;
      if (sameJobLine(r.text, j.line)) { if (out[i] < 0) out[i] = j.code; break; }
    }
  }
  return out;
}
/**
 * 주인 노드의 자식 노드들 → 작업 줄 목록 [{line, code}](마지막 줄이 있는 작업만, 표시 상태는 렌더러 시계 nowMs 로).
 * 최근 박동 순(가장 최근 작업이 같은 줄을 두고 이김)
 */
export function jobLinesOf(kids, nowMs) {
  const out = [];
  for (const n of kids || []) {
    const j = jobOf(n);
    if (!j || !j.line) continue;
    out.push({ line: j.line, code: jobCode(j, nowMs), at: Date.parse(j.beatAt || '') || 0 });
  }
  out.sort((a, b) => b.at - a.at);
  return out.map(({ line, code }) => ({ line, code }));
}
/** 작업 줄 표시가 바뀌었는지 볼 열쇠(글 칸 다시 그리기 판단) */
export const jobLinesKey = (jobs) => (jobs && jobs.length ? jobs.map((j) => `${j.code}:${j.line}`).join('\n') : '');
/** 작업 상태 번호 → 줄 표시 색(왼쪽 띠·옅은 바탕). 진행 호박 · 대기 파랑 흐림 · 줄 섬 회색 · 끝 초록 · 실패 빨강 · 정체 주황 */
const JOB_INK = [['#9aa3b2', '#6b7280'], ['#facc15', '#b45309'], ['#8fa9e6', '#4b6cb7'], ['#34d399', '#059669'], ['#ef4444', '#dc2626'], ['#fb923c', '#c2410c']];
export function jobLineStyle(code, light) {
  const c = JOB_INK[code] || JOB_INK[1];
  const hex = c[light ? 1 : 0];
  const n = parseInt(hex.slice(1), 16);
  const a = light ? 0.11 : 0.14;
  return { bar: hex, bg: `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})` };
}

/**
 * 실루엣별 글 자리(uv, 0..1, y 위로): hd 머리 띠 아래 끝 · title 제목 칸 [x0,x1,y0,y1] · body 줄 칸 · glyph 글리프 왼쪽 아래(x,y)·크기 s(높이 단위).
 * 셰이더(holo.js glyphAt)의 머리 띠·글리프 자리와 같은 값
 */
export function shapeLayout(shape, asp) {
  const g = (x, y, s) => ({ x, y, s });
  switch (shape) {
    case 1: return { hd: 0.8, glyph: g(0.03, 0.825, 0.15), title: [0.05 + 0.15 / asp, 0.85, 0.8, 1], body: [0.06, 0.94, 0.05, 0.77] };
    case 2: return { hd: 0.76, glyph: g(0.02, 0.77, 0.12), title: [0.04 + 0.12 / asp, 0.8, 0.76, 0.89], body: [0.04, 0.96, 0.05, 0.73] };
    case 3: return { hd: 0.8, glyph: g(0.065 / asp, 0.765, 0.17), title: [0.3 / asp + 0.03, 0.8, 0.8, 1], body: [0.08, 0.965, 0.05, 0.77] };
    case 6: return { hd: 0.66, glyph: g(0.02, 0.665, 0.11), title: [0.04 + 0.11 / asp, 0.82, 0.66, 0.78], body: [0.04, 0.96, 0.05, 0.63] };
    case 8: return { hd: 0.8, glyph: g(0.03, 0.815, 0.11), title: [0.05 + 0.11 / asp, 0.8, 0.8, 0.93], body: [0.04, 0.96, 0.05, 0.77] };
    case 9: return { hd: 0.8, glyph: g(1 - 0.235 / asp, 0.765, 0.17), title: [0.05, 1 - 0.32 / asp, 0.8, 1], body: [0.04, 0.88, 0.05, 0.77] };
    case 10: return { hd: 0.8, glyph: g(0.15 / asp, 0.825, 0.15), title: [0.32 / asp + 0.02, 1 - 0.17 / asp, 0.8, 1], body: [0.18 / asp, 1 - 0.18 / asp, 0.05, 0.77] };
    case 11: return { hd: 0.8, glyph: g(0.5 - 0.08 / asp, 0.82, 0.16), title: [0.04, 0.96, 0.7, 0.79], body: [0.04, 0.96, 0.05, 0.69] };
    case 12: return { hd: 0.8, glyph: g(0.04, 0.825, 0.15), title: [0.06 + 0.15 / asp, 0.92, 0.8, 1], body: [0.05, 0.95, 0.17, 0.77] };
    default: return { hd: 0.8, glyph: g(0.02, 0.825, 0.15), title: [0.035 + 0.15 / asp, 0.8, 0.8, 1], body: [0.035, 0.965, 0.05, 0.77] };
  }
}

// mode: 도구 종류 번호(예전 가짜 무늬 분기 번호, 부터 셰이더는 쓰지 않음 — 패널 안은 실제 글, holo-text.js)
// 글리프 번호(아틀라스 칸) — 0 >_ , 1 문서, 2 펜, 3 돋보기, 4 지구, 5 포털, 6 육각, 7 도구상자, 8 계기, 9 플러그, 10 카드, 11 종, 12 점 셋, 13 말풍선
// shape(실루엣, 셰이더): 0 넓은 터미널 창 · 1 귀퉁이 접힌 세로 문서 · 2 파일 탭 달린 코드 창 · 3 왼쪽 위 렌즈가 붙은 결과 목록 ·
//   6 손잡이 달린 상자 · 8 홈 파인 카드 · 9 오른쪽 위 지구 배지 창 · 10 양옆이 뾰족한 육각 창 · 11 반원 계기 머리 창 · 12 말풍선
//   (4 원판 · 5 육각 · 7 반원은 전 모양 — 글을 담기 어려워 9·10·11 로 바꿈).  asp = 폭/높이
// dir: 노드 주위 방향 무리 — HOLO_DIR 각도
export const HOLO_KIND = {
  shell:    { mode: 0, glyph: 0,  shape: 0,  asp: 1.75, dir: 'shell',  desc: tr('cards.holo.kind.shell') },
  read:     { mode: 1, glyph: 1,  shape: 1,  asp: 0.9,  dir: 'read',   desc: tr('cards.holo.kind.read') },
  write:    { mode: 2, glyph: 2,  shape: 2,  asp: 1.3,  dir: 'edit',   desc: tr('cards.holo.kind.write') },
  edit:     { mode: 3, glyph: 2,  shape: 2,  asp: 1.3,  dir: 'edit',   desc: tr('cards.holo.kind.edit') },
  search:   { mode: 4, glyph: 3,  shape: 3,  asp: 1.35, dir: 'search', desc: tr('cards.holo.kind.search') },
  web:      { mode: 5, glyph: 4,  shape: 9,  asp: 1.35, dir: 'web',    desc: tr('cards.holo.kind.web') },
  agent:    { mode: 6, glyph: 5,  shape: 10, asp: 1.4,  dir: 'agent',  desc: tr('cards.holo.kind.agent') },
  workflow: { mode: 6, glyph: 6,  shape: 10, asp: 1.4,  dir: 'agent',  desc: tr('cards.holo.kind.workflow') },
  skill:    { mode: 8, glyph: 7,  shape: 6,  asp: 1.15, dir: 'skill',  desc: tr('cards.holo.kind.skill') },
  monitor:  { mode: 7, glyph: 8,  shape: 11, asp: 1.4,  dir: 'misc',   desc: tr('cards.holo.kind.monitor') },
  mcp:      { mode: 9, glyph: 9,  shape: 8,  asp: 1.2,  dir: 'misc',   desc: tr('cards.holo.kind.mcp') },
  artifact: { mode: 2, glyph: 10, shape: 8,  asp: 1.2,  dir: 'misc',   desc: tr('cards.holo.kind.card') },
  notify:   { mode: 7, glyph: 11, shape: 11, asp: 1.4,  dir: 'misc',   desc: tr('cards.holo.kind.notify') },
  other:    { mode: 9, glyph: 12, shape: 8,  asp: 1.2,  dir: 'misc',   desc: tr('cards.holo.kind.card') },
  // 노드의 말(text.panel): 위쪽(검색과 같은 쌓임 무리), 아래 꼬리가 노드를 가리키는 말풍선
  say:      { mode: 10, glyph: 13, shape: 12, asp: 1.5, dir: 'say',    desc: tr('cards.holo.kind.say') },
};
// 방향 무리 → 화면 평면 각도(도, 0 = 오른쪽, 90 = 위)
export const HOLO_DIR = { shell: 0, web: 45, search: 90, say: 90, read: 135, edit: 180, skill: 225, agent: 270, misc: 315 };
/** 쌓임 무리: 말은 검색과 같은 위쪽에 겹치지 않게 쌓는다(먼저 온 쪽이 안쪽) */
export const stackGroup = (dir) => (dir === 'say' ? 'search' : dir);
/** 방향 무리의 단위 벡터(화면 평면: x 오른쪽, y 위) */
const DIR_CACHE = new Map(); // 무리 → 고정 벡터(프레임마다 패널당 만들지 않게)
export function holoDir(group) {
  let v = DIR_CACHE.get(group);
  if (!v) {
    const d = ((HOLO_DIR[group] ?? HOLO_DIR.misc) * Math.PI) / 180;
    DIR_CACHE.set(group, v = Object.freeze({ x: Math.cos(d), y: Math.sin(d) }));
  }
  return v;
}
/**
 * 노드 중심에서 패널 중심까지 거리: 노드 반지름 + 여백 + 그 방향으로 본 패널 반폭(상자 지지 함수) + 쌓인 순번만큼 더.
 * labelPush = 그 방향에 노드 라벨이 있으면 더 띄울 거리(세계 단위)
 */
export function holoOffset(dir, rr, W, H, stack = 0, labelPush = 0) {
  const half = Math.abs(dir.x) * W / 2 + Math.abs(dir.y) * H / 2;
  // 대각선 방향은 바깥으로 더(이웃한 위·옆 패널과 겹치지 않게)
  const diag = Math.abs(dir.x) > 0.5 && Math.abs(dir.y) > 0.5 ? 1.32 : 1;
  return (rr + 0.3 + half) * diag + labelPush + stack * (half * 2 + 0.25);
}
export const HOLO_GLYPHS = 14;
export const holoKind = (cat) => HOLO_KIND[cat] || HOLO_KIND.other;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (u) => { u = clamp01(u); return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; };

/**
 * 패널 단계. t = 보이기 시작한 뒤 경과(초), endAt = 끝 신호 시각(같은 기준, 없으면 null), minShow = 최소 표시
 * 반환 {phase:'open'|'hold'|'flash'|'fold'|'gone', sx, sy(0..1 크기 비율), flash(0..1 결과색 섞기), alpha}
 */
export function holoPhase(t, endAt = null, minShow = HOLO.MIN_SHOW, foldAt) {
  const H = HOLO;
  const o1 = H.OPEN * 0.45;
  if (t < H.OPEN) {
    const sx = ease(t / o1);
    const sy = t < o1 ? 0.05 : 0.05 + 0.95 * ease((t - o1) / (H.OPEN - o1));
    return { phase: 'open', sx, sy, flash: 0, alpha: 0.35 + 0.65 * clamp01(t / H.OPEN) };
  }
  const end = endAt == null ? Infinity : Math.max(endAt, minShow, H.OPEN);
  if (t < end) return { phase: 'hold', sx: 1, sy: 1, flash: 0, alpha: 1 };
  const k = t - end;
  if (k < H.FLASH) {
    // 순간 번쩍(앞 25%)한 뒤 결과색으로 머묾, 살짝 부풀었다 돌아온다
    const f = k < H.FLASH * 0.25 ? k / (H.FLASH * 0.25) : 1;
    const bump = 1 + 0.06 * Math.sin(Math.PI * clamp01(k / H.FLASH));
    return { phase: 'flash', sx: bump, sy: bump, flash: f, alpha: 1 };
  }
  // 남김 모드(foldAt 를 넘김): 섬광 뒤 접지 않고 'linger'(결과색 옅게)로 머물다 foldAt 부터 접힘
  const lingerMode = foldAt !== undefined;
  let fk;
  if (lingerMode) {
    if (foldAt == null || t < foldAt) return { phase: 'linger', sx: 1, sy: 1, flash: H.LINGER_TINT, alpha: 0.94 };
    fk = t - Math.max(foldAt, end + H.FLASH);
  } else fk = k - H.FLASH;
  const f = fk / H.FOLD;
  if (f < 1) {
    const sy = f < 0.6 ? 0.04 + 0.96 * (1 - ease(f / 0.6)) : 0.04;
    const sx = f < 0.6 ? 1 : 1 - ease((f - 0.6) / 0.4);
    const f0 = lingerMode ? H.LINGER_TINT + 0.3 : 1;
    return { phase: 'fold', sx: Math.max(0.001, sx), sy, flash: f0 * (1 - f * 0.5), alpha: 1 - f * 0.4, fk: f };
  }
  return { phase: 'gone', sx: 0, sy: 0, flash: 0, alpha: 0 };
}

// 호 자리(화면 평면 각도, 도): 0 = 오른쪽, 90 = 위. 노드 라벨(위 가운데)을 피해 좌우로 벌린 호
export const SLOT_DEG = [16, 164, -26, 206];
/** 자리 i 의 방향(화면 평면 단위 벡터: x 오른쪽, y 위) */
export function holoSlotDir(i) {
  const d = SLOT_DEG[((i % SLOT_DEG.length) + SLOT_DEG.length) % SLOT_DEG.length] * Math.PI / 180;
  return { x: Math.cos(d), y: Math.sin(d) };
}

/** 세계 높이 worldH 인 패널이 거리 dist 에서 화면에 몇 px 로 보이나(원근 카메라) */
export function panelPx(worldH, dist, fovDeg, viewportH) {
  const d = Math.max(0.01, dist);
  return (worldH * viewportH) / (2 * d * Math.tan((fovDeg * Math.PI) / 360));
}

/** 단순화 단계: 0 그리지 않음, 1 테두리+큰 글리프, 2 무늬까지. 포커스·호버 노드는 늘 2 */
export function holoLod(px, focused = false) {
  if (focused) return 2;
  if (px < HOLO.LOD_HIDE_PX) return 0;
  return px < HOLO.LOD_DETAIL_PX ? 1 : 2;
}

// 라벨: 서버가 이미 redact 한 요약(text)만 쓴다. 제어 문자·줄바꿈은 공백으로, 길면 자름
const CTRL_RE = new RegExp('[\u0000-\u001f\u007f-\u009f\u2028\u2029]+', 'g');
export function holoLabel(ev = {}, max = 34) {
  const clean = (s) => String(s ?? '').replace(CTRL_RE, ' ').replace(/\s+/g, ' ').trim();
  const raw = String(ev.tool || '');
  // mcp__서버__도구 는 'MCP' 로(서버.도구는 brief 에 있음)
  const tool = clean(ev.cat === 'skill' || ev.skill ? 'Skill' : raw.startsWith('mcp__') ? 'MCP' : raw || ev.cat || tr('cards.holo.tool'));
  // 서버 작업 요약(brief)이 있으면 그것, 없으면(옛 기록·minimal) 예전 text
  const target = clean(ev.brief || ev.skill || ev.text || '');
  const cut = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
  const t = cut(tool, 18);
  return { tool: t, target: target ? cut(target, Math.max(8, max - t.length - 3)) : '' };
}

/** 노드 라벨의 '지금 하는 일' 한 줄: `Bash · npm test` */
export function actLine(ev = {}, max = 44) {
  const l = holoLabel(ev, max);
  return l.target ? `${l.tool} · ${l.target}` : l.tool;
}

/** 말(assistant text) → 최근 문장 한두 개(서버 brief 가 없을 때 대체, server/brief.mjs textBrief 와 같은 규칙) */
export function sayBrief(text, max = 80) {
  const t = String(text ?? '').replace(CTRL_RE, ' ').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const parts = t.match(/[^.!?。]+[.!?。]+|[^.!?。]+$/g) || [t];
  let out = '';
  for (let i = parts.length - 1; i >= 0 && i >= parts.length - 2; i--) {
    const cand = (parts[i].trim() + (out ? ' ' + out : '')).trim();
    if (cand.length > max) break;
    out = cand;
  }
  return out || '…' + t.slice(t.length - (max - 1));
}

/** 노드별 최근 작업 이력(포커스 라벨용): 새 항목을 앞에, 상한 max. 같은 toolUseId 는 결과로 갱신 */
export function pushHist(arr, item, max = 5) {
  if (item.id) { const i = arr.findIndex((x) => x.id === item.id); if (i >= 0) { arr[i] = { ...arr[i], ...item }; return arr; } }
  arr.unshift(item);
  if (arr.length > max) arr.length = max;
  return arr;
}

export function hashUnit(s) {
  let h = 2166136261 >>> 0;
  s = String(s || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) / 4294967296;
}

/**
 * 노드별 도구 장부. 열린 도구마다 항목 하나, 노드 호 자리(0..PER_NODE-1)를 가장 낮은 빈 칸부터 배정한다.
 * 자리가 없거나 전체 상한이면 대기(slot -1) → 앞 패널이 사라지면 step() 이 자리를 준다(그때부터 펼침).
 * 대기 중에 끝난 도구는 보이지 않고 빠진다(재생 고배속에서 화면이 밀리지 않게).
 * 항목: {id, node, cat, tool, label:{tool,target}, mode, glyph, seed, t0, endAt, minShow, res:'ok'|'error'|'stopped', slot}
 */
export class HoloBook {
  constructor({ max = HOLO.MAX, perNode = HOLO.PER_NODE, stack = HOLO.STACK } = {}) {
    this.max = max;
    this.perNode = perNode;
    this.stack = stack;
    this.byNode = new Map(); // nodeId → [항목…](시작 순)
    this.shown = 0;          // slot ≥ 0 인 항목 수
    // 렌더러가 붙이는 고리: nodeOf(id) → 노드(meta.run 을 읽음) · clock → 렌더러 시계 ms(라이브 = 지금, 재생 = 가상 시계).
    // 없으면 머리줄 경과·꼬리 작은 상태를 쓰지 않는다(예전 그대로)
    this.nodeOf = null;
    this.clock = null;
    this._runAt = -Infinity;
  }
  get size() { let n = 0; for (const a of this.byNode.values()) n += a.length; return n; }
  list(nodeId) { return this.byNode.get(nodeId) || []; }
  /** 아직 끝나지 않은(열린) 도구 수 */
  openCount(nodeId) { let n = 0; for (const e of this.list(nodeId)) if (e.endAt == null) n++; return n; }
  /** 자리를 못 받아 기다리는 수(+N 표시) */
  queued(nodeId) { let n = 0; for (const e of this.list(nodeId)) if (e.slot < 0) n++; return n; }

  /** 방향 무리 dir 안의 빈 쌓임 자리(0..STACK-1). 노드당·전체 상한이면 -1 */
  _freeSlot(arr, dir) {
    if (this.shown >= this.max) return -1;
    let n = 0; for (const e of arr) if (e.slot >= 0 && !e.sticky) n++;
    if (n >= this.perNode) return -1;
    const g = stackGroup(dir);
    for (let s = 0; s < this.stack; s++) if (!arr.some((e) => e.slot === s && stackGroup(e.dir) === g)) return s;
    return -1;
  }

  /** 도구 시작. 같은 toolUseId 가 이미 있으면 null. opts.quiet = 스냅샷(펼침 애니메이션 없이 이미 열린 상태) */
  start(nodeId, ev = {}, now = 0, { quiet = false, minShow = HOLO.MIN_SHOW } = {}) {
    const id = ev.toolUseId || `anon:${nodeId}:${now}:${this.size}`;
    let arr = this.byNode.get(nodeId);
    if (!arr) { arr = []; this.byNode.set(nodeId, arr); }
    if (arr.some((e) => e.id === id)) return null;
    const cat = ev.skill ? 'skill' : ev.cat || 'other';
    const k = holoKind(cat);
    // 같은 방향(같은 종류 무리)에 남아 있는 패널이 있으면 그 패널이 이어받는다(다시 펼치지 않고 내용만 위→아래로 갈림).
    // 다른 종류는 각자 방향에 따로 뜬다
    const lg = quiet ? null : arr.find((x) => x.slot === 0 && x.dir === k.dir && !x.sticky && x.endAt != null && x.foldAt == null)
      || (quiet ? null : arr.find((x) => x.slot >= 0 && x.dir === k.dir && !x.sticky && x.endAt != null && x.foldAt == null));
    const panel = normPanel(ev.panel);
    if (lg) {
      Object.assign(lg, { id, cat, tool: ev.tool || '', label: holoLabel({ ...ev, cat }), mode: k.mode, glyph: k.glyph, shape: k.shape, asp: k.asp,
        t0: now - HOLO.OPEN - 1e-3, endAt: null, minShow: 0, res: 'ok', result: '', swapAt: now, soft: false,
        panel, pv: (lg.pv || 0) + 1, touchAt: null, scrollAt: null, scrollN: 0, jobOwner: null, startMs: toMs(ev.ts ?? ev.startedAt), runHead: '', runLong: false, runMs: 0, runStale: false, _rk: '' });
      // 배열 끝으로(가장 최근)
      arr.splice(arr.indexOf(lg), 1); arr.push(lg);
      return lg;
    }
    const e = {
      id, node: nodeId, cat, tool: ev.tool || '', label: holoLabel({ ...ev, cat }), mode: k.mode, glyph: k.glyph,
      shape: k.shape, asp: k.asp, dir: k.dir,
      seed: hashUnit(id), t0: quiet ? now - HOLO.OPEN - 1 : now, endAt: null, minShow, res: 'ok', slot: -1,
      foldAt: null, swapAt: null, soft: false, result: '',
      panel, pv: 1, touchAt: null, scrollAt: null, scrollN: 0, sticky: null, jobOwner: null,
      startMs: toMs(ev.ts ?? ev.startedAt), runHead: '', runLong: false, runMs: 0, runStale: false, mini: false, _rk: '', // 머리줄 경과(셸)
    };
    e.slot = this._freeSlot(arr, e.dir);
    if (e.slot >= 0) this.shown++;
    arr.push(e);
    return e;
  }

  /** 도구 끝. res = 'ok'|'error'|'stopped'. 못 찾으면 false */
  end(nodeId, toolUseId, res = 'ok', now = 0, result = '') {
    const e = this.list(nodeId).find((x) => x.id === toolUseId);
    if (!e || e.endAt != null) return false;
    e.endAt = now; e.res = res; e.result = String(result || '').replace(CTRL_RE, ' ').trim().slice(0, 60);
    e.soft = e.swapAt != null && now - e.swapAt < HOLO.SOFT_GAP;
    return true;
  }
  /** 노드가 끝남: 열린 도구는 그 결과로 닫고, 모니터는 결과를 잠깐(LINGER_END) 보인 뒤 접힘 */
  endAll(nodeId, res = 'ok', now = 0) {
    for (const e of this.list(nodeId)) {
      if (e.endAt == null) { e.endAt = now; e.res = res; }
      if (e.foldAt == null) e.foldAt = now + HOLO.LINGER_END;
    }
  }

  /**
   * 노드가 물러남(node-remove): 대기 중 항목은 버리고, 보이는 패널은 섬광 없이 지금 접기 시작(노드 쪽으로 미끄러져 들어가며 닫힘).
   * 펼치는 중이던 패널은 다 펼친 뒤 접힌다
   */
  foldNode(nodeId, now = 0) {
    const arr = this.byNode.get(nodeId);
    if (!arr) return;
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i];
      if (e.slot < 0) { arr.splice(i, 1); continue; }
      if (e.endAt == null) e.res = 'stopped'; // 끝나지 않은 도구는 중지 회색으로 닫힘
      if (e.endAt == null || e.endAt > now - HOLO.FLASH) e.endAt = now - HOLO.FLASH;
      e.minShow = 0; e.soft = true;
      if (e.foldAt == null || e.foldAt > now) e.foldAt = now;
    }
  }

  /** (nodeId, toolUseId) 항목 */
  find(nodeId, id) { if (!id) return null; for (const e of this.list(nodeId)) if (e.id === id) return e; return null; }

  /** 패널 내용 교체(같은 내용이면 false). tail = 백그라운드 꼬리 → 밀려 올라간 줄 수(scrollN)로 위로 흐르는 연출 */
  _setPanel(e, p, now, tail = false) {
    if (e.panel && samePanel(e.panel, p)) return false;
    if (tail && e.panel) { const k = tailShift(e.panel.lines, p.lines); if (k > 0) { e.scrollN = k; e.scrollAt = now; } }
    e.panel = p; e.pv = (e.pv || 0) + 1;
    return true;
  }

  /** 노드의 말(say)·작업 노드 자신의 출력 꼬리(tail) 패널: 노드당 하나, 같은 id 로 갱신 */
  sticky(nodeId, kind, p, now = 0, quiet = false) {
    const id = kind + ':' + nodeId;
    let arr = this.byNode.get(nodeId);
    if (!arr) { arr = []; this.byNode.set(nodeId, arr); }
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) {
      const e = arr[i];
      if (e.foldAt == null) { this._setPanel(e, p, now, kind === 'tail'); e.touchAt = now; return e; }
      arr.splice(i, 1); if (e.slot >= 0) this.shown--; // 접히는 중이면 새로 펼침
    }
    const cat = kind === 'say' ? 'say' : p.mode === 'monitor' ? 'monitor' : 'shell';
    const k = holoKind(cat);
    const name = tr(kind === 'say' ? 'cards.holo.say' : 'cards.holo.out');
    const t0 = quiet ? now - HOLO.OPEN - 1 : now;
    const e = {
      id, node: nodeId, cat, tool: name, label: { tool: name, target: p.title || '' }, mode: k.mode, glyph: k.glyph, shape: k.shape, asp: k.asp, dir: k.dir,
      seed: hashUnit(id), t0, endAt: t0, minShow: 0, res: 'ok', slot: -1, foldAt: null, swapAt: null, soft: true, result: '',
      panel: p, pv: 1, touchAt: now, scrollAt: null, scrollN: 0, sticky: kind, jobOwner: kind === 'tail' ? nodeId : null,
      startMs: NaN, runHead: '', runLong: false, runMs: 0, runStale: false, mini: false, _rk: '',
    };
    e.slot = this._freeSlot(arr, e.dir);
    if (e.slot < 0) { if (!arr.length) this.byNode.delete(nodeId); return null; } // 자리가 없으면 기다리지 않는다(다음 갱신 때 다시)
    this.shown++;
    arr.push(e);
    return e;
  }

  /**
   * 이벤트의 패널 내용을 장부에 반영. 반환 = 바뀐 패널 수.
   *  tool-start·tool-end `panel` → 그 도구 패널 전체 교체 · output `panel` → ref 도구 패널(남아 있으면) 아니면 작업 노드 자신의 꼬리 패널 ·
   *  text `panel` → 노드의 말 패널 · 어느 이벤트든 `parentPanel` → ref(부모 Agent 호출) 패널
   */
  panelEvent(ev, now = 0, { quiet = false } = {}) {
    if (!ev || typeof ev !== 'object') return 0;
    let n = 0;
    const p = ev.panel ? normPanel(ev.panel) : null;
    if (p) {
      if (ev.type === 'tool-start' || ev.type === 'tool-end') {
        const e = this.find(ev.nodeId, ev.toolUseId);
        if (e && this._setPanel(e, p, now)) n++;
      } else if (ev.type === 'output') {
        const r = p.ref;
        let e = r && r.toolUseId ? this.find(r.nodeId, r.toolUseId) : null;
        if (e && (e.slot < 0 || e.foldAt != null)) e = null;
        if (e) { if (this._setPanel(e, p, now, true)) n++; e.touchAt = now; e.jobOwner = ev.nodeId; } // 꼬리를 낸 노드 = 작업 주인
        else if (this.sticky(ev.nodeId, 'tail', p, now, quiet)) n++;
      } else if (ev.type === 'text') {
        if (this.sticky(ev.nodeId, 'say', p, now, quiet)) n++;
      }
    }
    if (ev.parentPanel) {
      const pp = normPanel(ev.parentPanel), r = pp && pp.ref;
      const e = r && r.toolUseId ? this.find(r.nodeId, r.toolUseId) : null;
      if (e) { if (this._setPanel(e, pp, now)) n++; e.touchAt = now; }
    }
    return n;
  }

  removeNode(nodeId) {
    for (const e of this.list(nodeId)) if (e.slot >= 0) this.shown--;
    this.byNode.delete(nodeId);
  }
  clear() { this.byNode.clear(); this.shown = 0; }

  /** 단계 계산(보이는 항목) */
  phaseOf(e, now) {
    if (e.slot < 0) return null;
    // 같은 시각에 다시 물으면(step 뒤 그리기) 계산·객체 생성을 건너뜀. 항목이 바뀌면(이어받기·끝·접힘) 키가 달라짐
    const c = e._phc;
    if (c && c.now === now && c.t0 === e.t0 && c.endAt === e.endAt && c.foldAt === e.foldAt && c.soft === e.soft && c.minShow === e.minShow) return c.ph;
    const ph = holoPhase(now - e.t0, e.endAt == null ? null : e.endAt - e.t0, e.minShow, e.foldAt == null ? null : e.foldAt - e.t0);
    if (e.soft && ph.phase === 'flash') ph.flash *= 0.4;
    if (e.sticky && (ph.phase === 'flash' || ph.phase === 'linger')) ph.flash = 0; // 말·꼬리 패널은 결과가 없어 섬광·물들임 없음
    if (c) { c.now = now; c.t0 = e.t0; c.endAt = e.endAt; c.foldAt = e.foldAt; c.soft = e.soft; c.minShow = e.minShow; c.ph = ph; }
    else e._phc = { now, t0: e.t0, endAt: e.endAt, foldAt: e.foldAt, soft: e.soft, minShow: e.minShow, ph };
    return ph;
  }

  /** 이 노드의 꼬리 패널을 작은 상태로 남길까: 끝나지 않은 백그라운드 셸(meta.run kind 'bg') */
  _keepTail(nid) {
    if (!this.nodeOf || !this.clock) return false;
    const s = runState(this.nodeOf(nid), this.clock());
    return !!s && s.kind === 'bg' && !s.ended;
  }
  /**
   * 머리줄 경과: 열린 셸 패널(전경 meta.run.since, 없으면 도구 시작 ts) · 백그라운드 셸의 꼬리 패널(meta.run.since)에
   * e.runHead('3:42')·runLong(30초↑)·runMs·runStale. 글자가 바뀔 때만 판(pv)을 올려 글 칸을 다시 그린다(10분 미만 초마다, 그 위 분마다).
   * 짧은 도구(HEAD_MIN_MS 미만)는 붙이지 않는다(다시 그리기 줄임).
   */
  _runPass(clockMs, changed) {
    for (const [nid, arr] of this.byNode) {
      let rs;
      for (const e of arr) {
        if (e.slot < 0) continue;
        let since = NaN, stale = false;
        if (!e.sticky && e.cat === 'shell' && e.endAt == null) {
          if (rs === undefined) rs = runState(this.nodeOf(nid), clockMs);
          since = rs && rs.kind === 'fg' && !rs.ended && rs.since != null ? rs.since : e.startMs;
          stale = !!(rs && rs.kind === 'fg' && rs.stale);
        } else if (e.sticky === 'tail' && e.foldAt == null) {
          if (rs === undefined) rs = runState(this.nodeOf(nid), clockMs);
          if (rs && rs.kind === 'bg' && !rs.ended && rs.since != null) { since = rs.since; stale = rs.stale; }
        }
        const h = Number.isFinite(since) && clockMs - since >= RUNW.HEAD_MIN_MS ? runHead(since, clockMs) : null;
        const key = h ? h.key + (h.long ? 'L' : '') + (stale ? 'S' : '') : '';
        if (key === e._rk) continue;
        e._rk = key; e.runHead = h ? h.text : ''; e.runLong = !!(h && h.long); e.runMs = h ? h.ms : 0; e.runStale = stale;
        e.pv = (e.pv || 0) + 1;
        changed.add(nid);
      }
    }
  }

  /**
   * 사라진 항목 정리 + 남길 모니터 고르기 + 대기열에 자리 주기. active(nodeId) → 노드가 작업 중인가.
   * 남김 규칙: 방향마다 맨 안쪽(쌓임 0) 패널이 끝난 뒤 최소 LINGER 초 결과를 보이며 남는다(짧은 도구도 화면에 남게).
   * 바깥쪽에 쌓인 병렬 패널은 끝나면 접힌다. LINGER 가 지나면 접히되, 노드가 작업 중이고 열린 도구가 없으면
   * 가장 최근에 끝난 패널 하나는 계속 남긴다(작업 중엔 모니터가 늘 하나는 떠 있게). 반환: 바뀐 노드 id 집합
   */
  step(now, active = null) {
    const changed = new Set();
    if (this.nodeOf && this.clock && now - this._runAt >= 0.25) { this._runAt = now; this._runPass(this.clock(), changed); } // 시계로 바뀌는 머리줄 경과
    for (const [nid, arr] of this.byNode) {
      let dirty = false;
      const anyOpen = arr.some((e) => e.endAt == null);
      let latest = null;
      for (const e of arr) if (e.slot >= 0 && !e.sticky && e.endAt != null && e.foldAt == null && (!latest || e.endAt >= latest.endAt)) latest = e;
      const act = !!(active && active(nid));
      for (const e of arr) {
        if (e.slot < 0 || e.endAt == null || e.foldAt != null) continue;
        // 말·꼬리 패널: 마지막 갱신 뒤 SAY_LINGER·TAIL_LINGER 초 머물다 접힘(쌓임 자리와 무관)
        if (e.sticky) {
          if (now - e.touchAt > (e.sticky === 'say' ? PANEL.SAY_LINGER : PANEL.TAIL_LINGER)) {
            // 끝나지 않은 백그라운드 셸(meta.run bg)의 꼬리는 접지 않고 작은 상태(마지막 줄 + 경과)로 남김
            if (e.sticky === 'tail' && this._keepTail(nid)) { if (!e.mini) { e.mini = true; e.pv++; dirty = true; } }
            else e.foldAt = now;
          } else if (e.mini) { e.mini = false; e.pv++; dirty = true; }
          continue;
        }
        if (e.slot > 0) { e.foldAt = now; continue; }
        // 백그라운드 출력·서브에이전트 진행이 갱신 중인 패널은 그 시각부터 다시 셈(touchAt)
        const since = now - Math.max(e.endAt, e.t0 + e.minShow, e.touchAt ?? -Infinity);
        if (since > HOLO.LINGER && !(act && !anyOpen && e === latest)) e.foldAt = now;
      }
      for (let i = arr.length - 1; i >= 0; i--) {
        const e = arr[i];
        if (e.slot >= 0) {
          if (this.phaseOf(e, now).phase === 'gone') { arr.splice(i, 1); this.shown--; dirty = true; }
        } else if (e.endAt != null) { arr.splice(i, 1); dirty = true; } // 기다리다 끝난 도구는 건너뜀
      }
      for (const e of arr) {
        if (e.slot >= 0) continue;
        // 대기 중인 도구: 같은 방향에 남은(끝난) 패널이 있으면 이어받기, 아니면 빈 쌓임 자리
        const lg = arr.find((x) => x.slot >= 0 && x.dir === e.dir && !x.sticky && x.endAt != null && x.foldAt == null);
        if (lg) { lg.foldAt = now; } // 남은 패널은 접고 그 자리를 다음 step 에 넘김
        const s = this._freeSlot(arr, e.dir);
        if (s < 0) continue;
        e.slot = s; e.t0 = now; this.shown++; dirty = true;
      }
      if (!arr.length) this.byNode.delete(nid);
      if (dirty) changed.add(nid);
    }
    return changed;
  }
}
