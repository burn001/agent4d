// 복셀 생각·말풍선 켬/끔 — 기본 켬. 저장 'ccviz.quips'(1|0), URL ?quips=0|1 은 이번 접속만(저장 안 함).
// ⚙ 메뉴 줄·ctl quips·두 복셀 렌더러가 같은 값을 본다(구독).
const KEY = 'ccviz.quips';
const subs = new Set();

function readUrl() {
  try { const v = new URLSearchParams(location.search).get('quips'); return v === '0' ? false : v === '1' ? true : null; } catch { return null; }
}
function readStored() {
  try { const v = localStorage.getItem(KEY); return v === '0' ? false : v === '1' ? true : null; } catch { return null; }
}

let on = (() => { const u = typeof location !== 'undefined' ? readUrl() : null; if (u != null) return u; const s = typeof localStorage !== 'undefined' ? readStored() : null; return s != null ? s : true; })();

export const quipsOn = () => on;
/** persist false = 이번 접속만(ctl --temp 등) */
export function setQuipsOn(v, { persist = true } = {}) {
  v = !!v;
  if (persist) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* 저장 못 해도 이번 접속은 바뀜 */ } }
  if (v === on) return;
  on = v;
  for (const f of subs) { try { f(on); } catch { /* 구독자 오류 무시 */ } }
}
export function onQuips(f) { subs.add(f); return () => subs.delete(f); }
