// 수식 조판 연결: 사이드 패널(#panel — 실황·Interactive·질문 카드)에 `.md-math` 상자가 생기면 그때만 로컬 KaTeX 를 불러와
// 조판한다(외부 CDN 없음 — web/vendor/katex, script-src 'self'). 실패·너무 긴 수식·모르는 출력이면 원문 고정폭 상자 그대로.
// 조판 결과는 math.mjs 가 화이트리스트로 다시 만든 HTML 만 넣는다. 원문은 title·aria-label 로 남김(setAttribute — 글자).
import { typesetTex, MATH } from './math.mjs';

const BASE = new URL('./vendor/katex/', import.meta.url);
let loading = null; // Promise<katex|null>
const cache = new Map(); // `${d}|${tex}` → html | null

function loadKatex() {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    if (window.katex) return resolve(window.katex);
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = new URL('katex.min.css', BASE).href; css.dataset.katex = '1';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = new URL('katex.min.js', BASE).href; s.async = true; s.dataset.katex = '1';
    s.onload = () => resolve(window.katex && typeof window.katex.renderToString === 'function' ? window.katex : null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return loading;
}

let queued = false;
async function pass(root) {
  queued = false;
  const els = [...root.querySelectorAll('.md-math:not([data-tex])')].slice(0, MATH.PER_PASS);
  if (!els.length) return;
  for (const el of els) el.dataset.tex = 'p'; // 처리 중(다시 잡지 않게)
  const katex = await loadKatex();
  for (const el of els) {
    if (!el.isConnected) continue;
    const display = el.tagName === 'PRE';
    const tex = (el.textContent || '').trim();
    const key = `${display ? 'd' : 'i'}|${tex}`;
    let html = cache.get(key);
    if (html === undefined) {
      html = katex ? typesetTex(katex, tex, display) : null;
      cache.set(key, html);
      if (cache.size > MATH.CACHE) cache.delete(cache.keys().next().value);
    }
    if (!html) { el.dataset.tex = '0'; continue; } // 원문 상자 그대로
    el.innerHTML = html;
    el.dataset.tex = '1';
    el.classList.add('md-math-ok');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', tex.slice(0, 300));
    el.title = tex.slice(0, 500);
  }
  if (root.querySelector('.md-math:not([data-tex])')) schedule(root); // 한 번에 PER_PASS 넘게 생긴 경우
}
function schedule(root) {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { pass(root); });
}

function boot() {
  const root = document.getElementById('panel');
  if (!root || window.__mdMath) return;
  window.__mdMath = true;
  const has = (n) => n.nodeType === 1 && (n.classList.contains('md-math') || !!n.querySelector('.md-math'));
  new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) if (has(n)) { schedule(root); return; }
  }).observe(root, { childList: true, subtree: true });
  if (root.querySelector('.md-math')) schedule(root);
}
if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); }
