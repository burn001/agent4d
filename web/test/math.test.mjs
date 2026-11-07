// 수식 조판 — 로컬 KaTeX(trust:false·maxExpand·maxSize·throwOnError) + 출력 화이트리스트 재구성, 실패면 원문
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { typesetTex, sanitizeKatex, KATEX_OPTS, MATH } from '../math.mjs';

const rd = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const katex = createRequire(import.meta.url)('../vendor/katex/katex.min.js');
const TAGS = new Set(['span', 'svg', 'path', 'line']);
const ATTRS = new Set(['class', 'style', 'aria-hidden', 'xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'd', 'x1', 'x2', 'y1', 'y2', 'stroke-width']);
function onlySafe(h, label) {
  for (const m of h.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)>/g)) {
    assert.ok(TAGS.has(m[1]), `${label}: 태그 ${m[1]}`);
    for (const a of m[2].matchAll(/\s([a-zA-Z0-9:-]+)=/g)) assert.ok(ATTRS.has(a[1]), `${label}: 속성 ${a[1]}`);
  }
  assert.doesNotMatch(h, /javascript:|url\(|on[a-z]+=|<a[\s>]|<img|<script|href=|src=/i, label);
}

test('§143.7 로컬 KaTeX: 판·파일 그대로(npm 0.19.0 해시) · MIT 라이선스 · 옵션(trust:false 등)', () => {
  assert.equal(katex.version, '0.19.0');
  const h = (f) => createHash('sha256').update(readFileSync(new URL('../vendor/katex/' + f, import.meta.url))).digest('hex');
  assert.equal(h('katex.min.js'), '103a53763cc033bba8d175bf3f0ba597c3505c9b6747dd3f2c7bc2a6bfcc8ae7');
  assert.equal(h('katex.min.css'), 'd4ab5b8ee16989b070cdb0ea24bd6ad48fc8df1b787f280f29d3ae4f959f2c00');
  assert.match(rd('vendor/katex/LICENSE'), /The MIT License[\s\S]*Khan Academy/);
  assert.match(readFileSync(new URL('../../NOTICE', import.meta.url), 'utf8'), /KaTeX 0\.19\.0[\s\S]*MIT License[\s\S]*web\/vendor\/katex/);
  const fonts = readdirSync(new URL('../vendor/katex/fonts/', import.meta.url));
  assert.ok(fonts.length >= 20 && fonts.every((f) => f.endsWith('.woff2')), 'WOFF2 만');
  const total = ['katex.min.js', 'katex.min.css', ...fonts.map((f) => 'fonts/' + f)].reduce((s, f) => s + statSync(new URL('../vendor/katex/' + f, import.meta.url)).size, 0);
  assert.ok(total < 700 * 1024, `묶음 크기 ${total}`);
  assert.equal(KATEX_OPTS.trust, false); assert.equal(KATEX_OPTS.throwOnError, true); assert.ok(KATEX_OPTS.maxExpand <= 1000); assert.ok(KATEX_OPTS.maxSize <= 50); assert.equal(KATEX_OPTS.output, 'html');
});

test('§143.7 조판: 흔한 수식은 안전한 태그·속성만으로, 신뢰가 필요한 명령·매크로 폭주·오류는 원문(null)', () => {
  const ok = ['E=mc^2', '\\frac{a}{b}+\\sqrt{x^2}', '\\int_0^1 f(x)\\,dx', '\\sum_{i=1}^n i', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', '\\overrightarrow{AB}', '\\cancel{x}', '\\boxed{x}', '\\underbrace{a+b}_{c}', 'x \\xrightarrow{f} y', '\\sqrt[3]{x}', '\\left(\\frac{1}{2}\\right)', '\\text{가나다}', "f'(x)", 'a<b>c', '\\textcolor{red}{x}'];
  for (const t of ok) { const h = typesetTex(katex, t, false); assert.ok(h, t); onlySafe(h, t); assert.match(h, /^<span class="katex/); }
  assert.match(typesetTex(katex, '\\sum_i x_i', true), /katex-display/, '블록 수식 = 표시 모드');
  assert.match(typesetTex(katex, 'a<b>c'), /&lt;/, '글자 < 는 이스케이프');
  // 신뢰가 필요한 명령(trust:false)은 링크·그림·속성 없이 — 출력에도 남지 않음
  for (const t of ['\\href{javascript:alert(1)}{x}', '\\url{javascript:alert(1)}', '\\includegraphics{https://x.example/a.png}', '\\htmlData{onclick=alert(1)}{x}', '\\htmlStyle{background:url(x)}{y}', '\\htmlClass{x" onclick="y}{z}', '\\htmlId{a}{b}']) {
    const h = typesetTex(katex, t);
    if (h) onlySafe(h, t);
  }
  const t0 = Date.now();
  assert.equal(typesetTex(katex, '\\def\\a{\\a\\a}\\a'), null, '매크로 폭주');
  assert.equal(typesetTex(katex, '\\gdef\\b#1{#1#1}\\b{\\b{\\b{\\b{\\b{\\b{\\b{\\b{\\b{\\b{x}}}}}}}}}}'), null, '지수적 매크로 → maxExpand');
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(typesetTex(katex, '\\frac{a'), null, '닫히지 않음 = 오류 → 원문');
  assert.equal(typesetTex(katex, '\\color{url(x)}{y}'), null);
  assert.equal(typesetTex(katex, 'x'.repeat(MATH.TEX_MAX + 1)), null, '너무 김');
  assert.equal(typesetTex(null, 'x'), null, 'KaTeX 를 못 불러옴');
  const big = typesetTex(katex, '\\rule{1000em}{1000em}');
  assert.ok(big && !/height:1000em/.test(big), 'maxSize 로 크기 제한');
});

test('§143.7 출력 화이트리스트 재구성: 모르는 태그·속성·위험한 style·짝 안 맞음·글자 속 < 는 통째로 버림', () => {
  const good = '<span class="katex"><span class="mord" style="height:1em;vertical-align:-0.25em;">x</span><svg xmlns="http://www.w3.org/2000/svg" width="100%" height="0.8em"><path d="M0 0L1 1z"/><line x1="0" y1="100%" x2="100%" y2="0" stroke-width="0.04em"/></svg></span>';
  assert.equal(sanitizeKatex(good), good);
  for (const bad of [
    '<span class="katex"><a href="javascript:x">y</a></span>', '<img src=x onerror=alert(1)>', '<span onclick="x">y</span>', '<span class="a" style="background:url(x)">y</span>',
    '<span style="width:expression(alert(1))">y</span>', '<span style="color:red&quot;onclick">y</span>', '<span>y', '<span>y</span></span>', '<SPAN>y</SPAN>', '<span>a<b</span>',
    '<span title="x">y</span>', '<svg xmlns="http://evil.example">x</svg>', '<path d="M0 0" onload="x"/>', '<script>alert(1)</script>', '<span>&lt;ok&gt; &bogus</span>', '<span class="x\'y">z</span>', '<style>x</style>',
  ]) assert.equal(sanitizeKatex(bad), null, bad);
  assert.equal(sanitizeKatex('<span>&lt;ok&gt;</span>'), '<span>&lt;ok&gt;</span>');
});

test('§143.7 화면 배선: 패널 안 .md-math 가 생길 때만 로컬 KaTeX 지연 로딩 · CDN 없음 · 실패면 원문 · 원문은 title/aria-label 글자로', () => {
  const js = rd('math.js');
  assert.match(js, /new URL\('\.\/vendor\/katex\/', import\.meta\.url\)/);
  assert.doesNotMatch(js, /https?:\/\//, '외부 주소 없음');
  assert.match(js, /document\.getElementById\('panel'\)/); assert.match(js, /new MutationObserver/);
  assert.match(js, /querySelectorAll\('\.md-math:not\(\[data-tex\]\)'\)/);
  assert.match(js, /if \(!html\) \{ el\.dataset\.tex = '0'; continue; \}/);
  assert.match(js, /el\.setAttribute\('aria-label', tex\.slice\(0, 300\)\)/);
  assert.match(js, /typesetTex\(katex, tex, display\)/);
  assert.match(rd('panel.js'), /import '\.\/math\.js'/); assert.match(rd('interact.js'), /import '\.\/math\.js'/);
  assert.doesNotMatch(rd('index.html'), /katex/i, '처음 열 때는 불러오지 않음');
  assert.match(rd('index.html'), /font-src 'self' data:/);
  assert.match(rd('vendor/katex/package.json'), /"type": "commonjs"/);
  assert.match(rd('markdown.css'), /\.md pre\.md-math\.md-math-ok/);
});
