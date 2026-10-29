// 복셀 바닥 스텐실(프로젝트 이름) 켬/끔 — 기본 켬. 저장 'ccviz.stencil'(1|0), URL ?stencil=0|1 은 이번 접속만(저장 안 함).
// ⚙ 메뉴 줄·두 복셀 렌더러가 같은 값을 본다(구독).
const KEY = 'ccviz.stencil';
const subs = new Set();

function readUrl() {
  try { const v = new URLSearchParams(location.search).get('stencil'); return v === '0' ? false : v === '1' ? true : null; } catch { return null; }
}
function readStored() {
  try { const v = localStorage.getItem(KEY); return v === '0' ? false : v === '1' ? true : null; } catch { return null; }
}

let on = (() => { const u = typeof location !== 'undefined' ? readUrl() : null; if (u != null) return u; const s = typeof localStorage !== 'undefined' ? readStored() : null; return s != null ? s : true; })();

export const stencilOn = () => on;
/** persist false = 이번 접속만(ctl --temp 등) */
export function setStencilOn(v, { persist = true } = {}) {
  v = !!v;
  if (persist) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* 저장 못 해도 이번 접속은 바뀜 */ } }
  if (v === on) return;
  on = v;
  for (const f of subs) { try { f(on); } catch { /* 구독자 오류 무시 */ } }
}
export function onStencil(f) { subs.add(f); return () => subs.delete(f); }
