// 복셀 연구소 현장 걷기(설계) 켬/끔 — 기본 켬. 저장 'ccviz.labwalk'(1|0), URL ?labwalk=0|1 은 이번 접속만(저장 안 함).
// ⚙ 메뉴 'Lab' 줄 · ctl labwalk on|off · LabView(FieldPlanner 갈고리)가 같은 값을 본다(구독). quip-pref.mjs 와 같은 모양.
const KEY = 'ccviz.labwalk';
const subs = new Set();
function readUrl() { try { const v = new URLSearchParams(location.search).get('labwalk'); return v === '0' ? false : v === '1' ? true : null; } catch { return null; } }
function readStored() { try { const v = localStorage.getItem(KEY); return v === '0' ? false : v === '1' ? true : null; } catch { return null; } }
let on = (() => { const u = typeof location !== 'undefined' ? readUrl() : null; if (u != null) return u; const s = typeof localStorage !== 'undefined' ? readStored() : null; return s != null ? s : true; })();

export const labWalkOn = () => on;
/** persist false = 이번 접속만 */
export function setLabWalkOn(v, { persist = true } = {}) {
  v = !!v;
  if (persist) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* 저장 못 해도 이번 접속은 바뀜 */ } }
  if (v === on) return;
  on = v;
  for (const f of subs) { try { f(on); } catch { /* 구독자 오류 무시 */ } }
}
export function onLabWalk(f) { subs.add(f); return () => subs.delete(f); }
