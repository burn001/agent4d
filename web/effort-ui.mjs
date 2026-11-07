// 추론 effort — 패널·범례 쪽 DOM 보조(실황 패널 미니 미터 자리 맞춤 · 범례 한 줄). 규칙·문구는 effort-core.mjs.
// 실황 줄(.ln .who i)과 범례(#legend li i)의 기존 '점' 규칙이 미터 막대(<i>)까지 덮으므로 그 두 자리만 되돌린다.
// 범례 줄은 지금 표현(흐름·Planet·복셀·연구소) 설명만 보인다. 표현을 모르면 세 설명을 함께.
import { t as tr } from './i18n.mjs';
import { effortMeterHtml } from './effort-core.mjs';

const CSS = [
  // 실황 줄 머리: 종류색 점 바로 뒤 5칸 미터(점 규칙 width 8px·원형·translate 을 되돌림)
  '.ln .who .eff-meter{margin:0 -1px;align-self:center}',
  '.ln .who .eff-meter>i{width:2px;border-radius:1px;transform:none;display:block}',
  // 범례: li i(10px 사각 견본) 규칙을 미터 막대에서 되돌림
  '#legend li .eff-meter{margin:0 2px 0 1px;flex:none}',
  '#legend li .eff-meter>i{width:2px;border-radius:1px}',
].join('');

export function ensureEffortUiCss() {
  if (typeof document === 'undefined' || document.getElementById('eff-ui-css')) return;
  const s = document.createElement('style'); s.id = 'eff-ui-css'; s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
}

const WHERE = { flow: 'flow', planet: 'planet', voxel: 'voxel', lab: 'lab' };
/** 범례 문구(순수): 표현 id → '추론 effort — 칸이 많을수록 깊게(흐름: 기둥도 높아짐)', 모르면 세 설명 모두 */
export function effortLegendText(mode) {
  const w = WHERE[mode];
  const where = w ? tr('cards.eff.where.' + w) : ['flow', 'planet', 'voxel'].map((k) => tr('cards.eff.where.' + k)).join(' · ');
  return tr('cards.eff.legend', { where });
}

let _mode;
const curMode = () => { try { return globalThis.__ccviz ? globalThis.__ccviz.viewMode : undefined; } catch { return undefined; } };
/**
 * 범례 노드 절(첫 ul) 끝에 미터 견본 + 문구 한 줄을 붙이거나 문구를 지금 표현으로 바꾼다.
 * mode 를 주지 않으면 앱 핸들(window.__ccviz.viewMode)을 본다. 범례가 아직 없으면 false.
 */
export function effortLegend(mode = curMode()) {
  if (typeof document === 'undefined') return true;
  const ul = document.querySelector('#legend ul');
  if (!ul) return false;
  ensureEffortUiCss();
  let li = ul.querySelector('li.eff-legend');
  if (!li) {
    li = document.createElement('li'); li.className = 'eff-legend';
    li.innerHTML = effortMeterHtml({ level: 3 }) + '<span></span>';
    // 흐름 모양 주석(flow-shape-note)보다 앞 — 노드 줄들 바로 뒤
    ul.insertBefore(li, ul.querySelector('li.flow-shape-note'));
    _mode = null;
  }
  if (mode !== _mode) { _mode = mode; li.lastChild.textContent = effortLegendText(mode); }
  return true;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  ensureEffortUiCss();
  // 범례 HTML 은 app.js 가 모듈 평가 뒤 만든다 → 다음 차례에 붙이고, 범례 단추를 누를 때·보이는 동안 표현이 바뀌면 문구를 맞춘다
  setTimeout(() => effortLegend(), 0);
  document.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('#btn-legend')) effortLegend(); }, true);
  setInterval(() => {
    if (document.hidden) return;
    const lg = document.getElementById('legend');
    if (lg && !lg.hidden && curMode() !== _mode) effortLegend();
  }, 1000);
}
