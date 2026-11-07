// 패널 위치(오른쪽 기본 · 왼쪽). 저장 'ccviz.panelSide'('left' 일 때만 값이 있고 오른쪽은 삭제), 기기별.
// body 에 `panel-left` 클래스를 붙이면 CSS 가 배치를 바꾼다(휴대폰 세로의 아래 배치에서는 CSS 가 무시). ⚙ 메뉴 '패널 위치' 줄과 panel-resize.js 가 쓴다.
// 바꾸는 길: ⚙ 메뉴(저장) · `agent4d ctl panel left|right`(저장, --temp 면 이번 접속만) · URL `?panel=left|right`(이번 접속만 — 저장값은 그대로).
export const SIDE_KEY = 'ccviz.panelSide';
const subs = new Set();

/** 저장값 해석('left' 만 왼쪽, 그 밖·깨진 값은 오른쪽) */
export const parseSide = (v) => (v === 'left' ? 'left' : 'right');
/** URL 쿼리 `panel=left|right`(대소문자 무관) → 'left'|'right', 없거나 다른 값(open 등)이면 null */
export function urlSide(search) {
  try {
    const v = new URLSearchParams(String(search || '')).get('panel');
    const s = String(v || '').trim().toLowerCase();
    return s === 'left' || s === 'right' ? s : null;
  } catch (e) { return null; }
}

function stored() {
  try { return localStorage.getItem(SIDE_KEY); } catch (e) { return null; }
}
let side = (typeof location !== 'undefined' && urlSide(location.search)) || parseSide(typeof localStorage === 'undefined' ? null : stored());

export const panelSide = () => side;
function apply() {
  if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('panel-left', side === 'left');
}
/** 바꾸기. save:false 면 저장값은 건드리지 않음 */
export function setPanelSide(v, { save = true } = {}) {
  v = parseSide(v);
  if (save) { try { if (v === 'left') localStorage.setItem(SIDE_KEY, 'left'); else localStorage.removeItem(SIDE_KEY); } catch (e) { /* 저장 못 해도 이번 접속은 바뀜 */ } }
  if (v === side) return;
  side = v;
  apply();
  for (const f of subs) { try { f(side); } catch (e) { /* 구독자 오류 무시 */ } }
}
export function onPanelSide(f) { subs.add(f); return () => subs.delete(f); }
if (typeof document !== 'undefined') { if (document.body) apply(); else document.addEventListener('DOMContentLoaded', apply); }
