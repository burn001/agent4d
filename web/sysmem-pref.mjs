// 시스템 메모리 게이지 켬/끔 — 기본 켬. 저장 'ccviz.mem'(1|0), URL ?mem=0|1 은 이번 접속만(저장 안 함).
// ⚙ 메뉴 '표시' 줄 버튼과 상단 바 게이지가 같은 값을 본다(구독).
const KEY = 'ccviz.mem';
const subs = new Set();

function readUrl() {
  try { const v = new URLSearchParams(location.search).get('mem'); return v === '0' ? false : v === '1' ? true : null; } catch { return null; }
}
function readStored() {
  try { const v = localStorage.getItem(KEY); return v === '0' ? false : v === '1' ? true : null; } catch { return null; }
}

let on = (() => { const u = typeof location !== 'undefined' ? readUrl() : null; if (u != null) return u; const s = typeof localStorage !== 'undefined' ? readStored() : null; return s != null ? s : true; })();

export const memGaugeOn = () => on;
export function setMemGaugeOn(v, { persist = true } = {}) {
  v = !!v;
  if (persist) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* 저장 못 해도 이번 접속은 바뀜 */ } }
  if (v === on) return;
  on = v;
  for (const f of subs) { try { f(on); } catch { /* 구독자 오류 무시 */ } }
}
export function onMemGauge(f) { subs.add(f); return () => subs.delete(f); }
