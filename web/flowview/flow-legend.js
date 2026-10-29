// 흐름 표현일 때 범례 노드 줄의 모양 설명을 흐름 모양(실루엣 문법·메인 두 모양)으로 바꾸고, 끄면 되돌린다(3D·2D 공용, DOM 만)
import { t } from '../i18n.mjs';

/** 반환: 범례에 적용됐는가(범례가 아직 없으면 false — 그리기 루프에서 다시 부름) */
export function flowLegend(on) {
  if (typeof document === 'undefined') return true;
  const lg = document.getElementById('legend');
  const ul = lg && lg.querySelector('ul');
  if (!ul) return false;
  for (const li of ul.querySelectorAll('li')) {
    const sp = li.querySelector('span'), i = li.querySelector('i');
    const m = i && /--k-([\w-]+)/.exec(i.getAttribute('style') || '');
    if (!sp || !m) continue;
    if (on) { if (sp.dataset.orig == null) sp.dataset.orig = sp.textContent; sp.textContent = t('scene.flowShape.' + m[1]); }
    else if (sp.dataset.orig != null) { sp.textContent = sp.dataset.orig; delete sp.dataset.orig; }
  }
  let note = ul.querySelector('li.flow-shape-note');
  if (on && !note) { note = document.createElement('li'); note.className = 'flow-shape-note'; note.innerHTML = '<span></span>'; note.firstChild.textContent = t('scene.flowShape.note'); ul.appendChild(note); }
  else if (!on && note) note.remove();
  return true;
}
