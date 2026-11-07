// 위험 동작 경고 켬/끔 — 기본 끔. 저장 'ccviz.danger'(1|0), URL ?danger=0|1 은 이번 접속만(저장 안 함).
// 끄면 작업 대상의 파괴적 표시(x: rm·drop·force·overwrite)가 장부에 들어오지 않아 문구·배지·붉은 연출이 모두 사라진다.
const KEY = 'ccviz.danger';
const subs = new Set();

function readUrl() {
  try { const v = new URLSearchParams(location.search).get('danger'); return v === '0' ? false : v === '1' ? true : null; } catch { return null; }
}
function readStored() {
  try { const v = localStorage.getItem(KEY); return v === '0' ? false : v === '1' ? true : null; } catch { return null; }
}

let on = (() => { const u = typeof location !== 'undefined' ? readUrl() : null; if (u != null) return u; const s = typeof localStorage !== 'undefined' ? readStored() : null; return s != null ? s : false; })();

export const dangerAlertsOn = () => on;
export function setDangerAlertsOn(v, { persist = true } = {}) {
  v = !!v;
  if (persist) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* 저장 못 해도 이번 접속은 바뀜 */ } }
  if (v === on) return;
  on = v;
  for (const f of subs) { try { f(on); } catch { /* 구독자 오류 무시 */ } }
}
export function onDangerAlerts(f) { subs.add(f); return () => subs.delete(f); }
