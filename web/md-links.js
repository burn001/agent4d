// 각주 왕복 링크(패널 안에서만): 번호 ↔ 글 끝 각주. 주소창(#)을 바꾸지 않고(보기 토큰·화면 상태 주소를 건드리지 않게) 그 자리로 스크롤·잠깐 강조.
// 렌더러(markdown.mjs)가 만든 href="#mdfn-<범위>-r|f<번호>" 만 받는다 — 그 밖의 # 주소는 손대지 않음.
import { MD_FN_ID } from './markdown.mjs';

if (typeof document !== 'undefined' && !window.__mdFnLinks) {
  window.__mdFnLinks = true;
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a.md-fn, a.md-fnback') : null;
    if (!a) return;
    const id = (a.getAttribute('href') || '').slice(1);
    if (!MD_FN_ID.test(id)) return;
    e.preventDefault(); e.stopPropagation(); // 패널 줄 누름(노드 고르기)으로 새지 않게
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    el.classList.remove('md-fn-hit'); void el.offsetWidth; el.classList.add('md-fn-hit');
    setTimeout(() => el.classList.remove('md-fn-hit'), 1400);
  }, true);
}
