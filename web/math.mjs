// 수식 조판 — 순수 부분(DOM 없음, node 시험). Markdown 렌더러가 `$…$`·`$$…$$` 를 `.md-math` 고정폭 상자로 내면,
// 화면(math.js)이 그 글을 로컬 KaTeX(web/vendor/katex, MIT, 수식이 있을 때만 불러옴)로 조판해 바꿔 넣는다.
// 보안: KaTeX 는 trust:false(\href·\url·\includegraphics·\html* 꺼짐)·maxExpand·maxSize 제한·throwOnError(오류면 원문 그대로).
// 그래도 KaTeX 출력을 그대로 믿지 않고 이 모듈이 **태그·속성·값 화이트리스트로 다시 만든다**(span·svg·path·line 만, 모르는 것이 하나라도 있으면 버리고 원문).

export const MATH = { TEX_MAX: 2000, OUT_MAX: 200_000, PER_PASS: 200, CACHE: 500 };
export const KATEX_OPTS = Object.freeze({ throwOnError: true, trust: false, strict: 'ignore', maxExpand: 500, maxSize: 20, output: 'html', globalGroup: false });

const CLS = /^[A-Za-z0-9_ -]{0,400}$/;
const NUM = /^[0-9.]{1,12}(?:em|ex|px|%)?$/;
const STYLE = /^(?:[a-z-]{1,24}:[-0-9a-zA-Z.#%(), ]{0,80};?)*$/; // 'height:1em;vertical-align:-0.25em;' 꼴만(url·expression·var·\ 따옴표 없음)
const STYLE_BAD = /url\s*\(|expression|var\s*\(|image|import|behavior|binding|javascript/i;
const ATTRS = {
  span: { class: CLS, style: STYLE, 'aria-hidden': /^true$/ },
  svg: { xmlns: /^http:\/\/www\.w3\.org\/2000\/svg$/, width: NUM, height: NUM, viewBox: /^[0-9. -]{1,60}$/, preserveAspectRatio: /^[A-Za-z ]{1,30}$/, style: STYLE },
  path: { d: /^[A-Za-z0-9 ,.\n-]{0,20000}$/ },
  line: { x1: NUM, x2: NUM, y1: NUM, y2: NUM, 'stroke-width': NUM },
};
const VOID = new Set(['path', 'line']);
const TAG = /<(\/?)([a-zA-Z]{1,10})((?:\s+[a-zA-Z][a-zA-Z0-9:-]{0,23}="[^"<>]*")*)\s*(\/?)>/y;
const ATTR = /\s+([a-zA-Z][a-zA-Z0-9:-]{0,23})="([^"<>]*)"/g;

/** KaTeX HTML → 화이트리스트로 다시 만든 HTML | null(모르는 태그·속성·값, 짝 안 맞음, 너무 김) */
export function sanitizeKatex(html) {
  const s = String(html ?? '');
  if (!s || s.length > MATH.OUT_MAX) return null;
  let out = '', i = 0;
  const stack = [];
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const text = lt < 0 ? s.slice(i) : s.slice(i, lt);
    if (text) { if (/[<>]/.test(text) || /&(?![a-zA-Z]{2,8};|#\d{1,7};|#x[0-9a-fA-F]{1,6};)/.test(text)) return null; out += text; }
    if (lt < 0) break;
    TAG.lastIndex = lt;
    const m = TAG.exec(s);
    if (!m) return null;
    const [, close, tag0, attrs, selfClose] = m;
    const tag = tag0.toLowerCase();
    const allow = ATTRS[tag];
    if (!allow || tag0 !== tag) return null; // 대문자 태그·모르는 태그는 버림
    if (close) {
      if (attrs.trim() || stack.pop() !== tag) return null;
      out += `</${tag}>`;
    } else {
      let a = '';
      for (const x of attrs.matchAll(ATTR)) {
        const [, k, v] = x;
        const re = allow[k];
        if (!re || !re.test(v) || (k === 'style' && STYLE_BAD.test(v))) return null;
        a += ` ${k}="${v}"`;
      }
      if (VOID.has(tag)) { if (!selfClose && s.startsWith(`</${tag}>`, TAG.lastIndex)) TAG.lastIndex += tag.length + 3; out += `<${tag}${a}/>`; }
      else if (selfClose) return null;
      else { stack.push(tag); out += `<${tag}${a}>`; }
    }
    i = TAG.lastIndex;
  }
  return stack.length ? null : out;
}

/** 수식 글 하나 → 안전한 HTML | null(조판 실패·너무 김 — 화면은 원문 상자 그대로). katex = KaTeX 모듈({renderToString}) */
export function typesetTex(katex, tex, display = false) {
  const t = String(tex ?? '').trim();
  if (!t || t.length > MATH.TEX_MAX || !katex || typeof katex.renderToString !== 'function') return null;
  let html;
  try { html = katex.renderToString(t, { ...KATEX_OPTS, displayMode: !!display, macros: {} }); } catch { return null; }
  return sanitizeKatex(html);
}
