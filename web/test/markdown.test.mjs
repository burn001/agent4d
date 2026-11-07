// Markdown 렌더러(web/markdown.mjs): 표·코드·목록·링크·취소선(반각만)·미완성 글, 그리고 XSS 시도 — 출력은 허용 태그·속성뿐
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMarkdown, renderMarkdownInline, safeUrl, MD_TAGS, MD_LIMITS } from '../markdown.mjs';

const ATTRS = { a: ['href', 'target', 'rel'], th: ['align'], td: ['align'], ol: ['start', 'class'], sup: ['class'], code: ['class'], pre: ['class'], div: ['class'], span: ['class'], h3: ['class'], h4: ['class'], h5: ['class'], h6: ['class'] };
/** 출력이 허용 태그·속성만 쓰는지 */
function assertSafe(html, label = '') {
  for (const m of html.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    assert.ok(MD_TAGS.includes(tag), `${label} 허용 안 된 태그 <${tag}> in ${html}`);
    if (m[0].startsWith('</')) continue;
    for (const a of m[2].matchAll(/\s([a-zA-Z-]+)=/g)) assert.ok((ATTRS[tag] || []).includes(a[1]), `${label} 허용 안 된 속성 ${tag}.${a[1]} in ${html}`);
    assert.ok(!/\son[a-z]+=/i.test(m[2]) && !/style=/i.test(m[2]), `${label} 이벤트·style 속성`);
  }
  for (const h of html.matchAll(/href="([^"]*)"/g)) assert.match(h[1], /^(https?:\/\/|mailto:)/i, `${label} href ${h[1]}`);
}

test('제목·문단·굵게·기울임·인라인 코드', () => {
  const h = renderMarkdown('# 제목\n\n본문 **굵게** *기울임* ***둘다*** `a<b` 끝');
  assert.match(h, /<h3 class="md-h">제목<\/h3>/);
  assert.match(h, /<strong>굵게<\/strong>/);
  assert.match(h, /<em>기울임<\/em>/);
  assert.match(h, /<em><strong>둘다<\/strong><\/em>/);
  assert.match(h, /<code>a&lt;b<\/code>/);
  assertSafe(h);
  assert.match(renderMarkdown('## 둘\n### 셋\n###### 여섯'), /<h4[^>]*>둘<\/h4><h5[^>]*>셋<\/h5><h6[^>]*>여섯<\/h6>/);
});

test('취소선은 반각 ~~ 만, 전각 ～ 범위·단일 ~ 는 글자 그대로', () => {
  assert.equal(renderMarkdownInline('~~지움~~'), '<del>지움</del>');
  assert.equal(renderMarkdownInline('1～3 그리고 5～9 항목'), '1～3 그리고 5～9 항목');
  assert.equal(renderMarkdownInline('～지움～'), '～지움～');
  assert.equal(renderMarkdownInline('약 ~10 에서 ~20'), '약 ~10 에서 ~20');
  assert.equal(renderMarkdownInline('~~~'), '~~~');
  assert.equal(renderMarkdownInline('～～두 개～～'), '～～두 개～～');
});

test('강조 경계: 낱말 속 _, 곱셈 *, 닫히지 않은 강조는 글자', () => {
  assert.equal(renderMarkdownInline('snake_case_name'), 'snake_case_name');
  assert.equal(renderMarkdownInline('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(renderMarkdownInline('**닫히지 않음'), '**닫히지 않음');
  assert.equal(renderMarkdownInline('_기울임_ 과 __굵게__'), '<em>기울임</em> 과 <strong>굵게</strong>');
  assert.equal(renderMarkdownInline('**굵게 *안쪽***'), '<strong>굵게 <em>안쪽</em></strong>');
  assert.equal(renderMarkdownInline('`a*b*c`'), '<code>a*b*c</code>');
  assert.equal(renderMarkdownInline('\\*글자\\*'), '*글자*');
});

test('GFM 표: 머리·정렬·칸 수 맞춤·코드 안 파이프·\\| , 래퍼(가로 스크롤)', () => {
  const h = renderMarkdown('| 이름 | 값 | 비고 |\n|:--|--:|:-:|\n| a | 1 |\n| `x|y` | 2 | z \\| w | 여분 |\n\n뒤 문단');
  assert.match(h, /^<div class="md-tablewrap"><table><thead><tr><th align="left">이름<\/th><th align="right">값<\/th><th align="center">비고<\/th><\/tr><\/thead>/);
  assert.match(h, /<tr><td align="left">a<\/td><td align="right">1<\/td><td align="center"><\/td><\/tr>/); // 모자란 칸은 빈 칸
  assert.match(h, /<td align="left"><code>x\|y<\/code><\/td><td align="right">2<\/td><td align="center">z \| w<\/td><\/tr>/); // 여분 칸은 버림
  assert.match(h, /<\/table><\/div><p>뒤 문단<\/p>$/);
  assertSafe(h);
  // 표 머리만 있고 구분줄이 아직 없으면(스트리밍·잘림) 문단
  assert.doesNotMatch(renderMarkdown('| a | b |'), /<table/);
  assert.doesNotMatch(renderMarkdown('| a | b |\n| 1 | 2 |'), /<table/);
  assert.doesNotMatch(renderMarkdown('a | b\n---'), /<table/); // 칸 수 다름
});

test('코드 블록: 언어 표시·내용 이스케이프·펜스 안은 Markdown 아님·닫히지 않아도 끝까지 코드', () => {
  const h = renderMarkdown('```js\nconst s = "<img src=x onerror=alert(1)>"; // **x**\n```\n다음');
  assert.match(h, /^<pre class="md-pre"><code class="lang-js">const s = &quot;&lt;img src=x onerror=alert\(1\)&gt;&quot;; \/\/ \*\*x\*\*<\/code><\/pre><p>다음<\/p>$/);
  assertSafe(h);
  const open = renderMarkdown('설명\n\n```python\nprint(1)\n# 아직 안 닫힘 | a | b |');
  assert.match(open, /<pre class="md-pre"><code class="lang-python">print\(1\)\n# 아직 안 닫힘 \| a \| b \|<\/code><\/pre>$/);
  assert.match(renderMarkdown('~~~\n```\nx\n~~~'), /<code>```\nx<\/code>/); // 다른 종류 펜스는 안에 그대로
  const odd = renderMarkdown('```"><script>x</script>\nz\n```');
  assert.doesNotMatch(odd, /<script/);
  assertSafe(odd);
});

test('목록: 중첩·번호(시작 번호)·체크·항목 안 문단과 코드', () => {
  assert.equal(renderMarkdown('- a\n  - b\n    - c\n- d'), '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>');
  assert.equal(renderMarkdown('1. 하나\n2. 둘\n   - 안\n3. 셋'), '<ol><li>하나</li><li>둘<ul><li>안</li></ul></li><li>셋</li></ol>');
  assert.match(renderMarkdown('3. 셋\n4. 넷'), /^<ol start="3">/);
  assert.match(renderMarkdown('- [ ] 할 일\n- [x] 한 일'), /<li><span class="md-task">☐<\/span> 할 일<\/li><li><span class="md-task done">☑<\/span> 한 일<\/li>/);
  assert.match(renderMarkdown('- 항목\n\n  이어지는 문단\n- 다음'), /<li><p>항목<\/p><p>이어지는 문단<\/p><\/li><li>다음<\/li>/);
  assert.match(renderMarkdown('- 항목\n  ```sh\n  ls\n  ```'), /<pre class="md-pre"><code class="lang-sh">ls<\/code><\/pre>/);
  assert.match(renderMarkdown('- 줄이\n이어짐'), /<li>줄이<br>이어짐<\/li>/); // 느슨한 이어짐
  assert.equal(renderMarkdown('2 * 3\n\n* 별표 목록'), '<p>2 * 3</p><ul><li>별표 목록</li></ul>');
  assert.equal(renderMarkdown('- - -'), '<hr>');
});

test('인용·수평선·문단 줄바꿈', () => {
  assert.equal(renderMarkdown('> 인용 **굵게**\n> 둘째 줄\n\n---\n\n끝'), '<blockquote><p>인용 <strong>굵게</strong><br>둘째 줄</p></blockquote><hr><p>끝</p>');
  assert.equal(renderMarkdown('가\n나'), '<p>가<br>나</p>');
  assert.equal(renderMarkdown('> 바깥\n> > 안쪽'), '<blockquote><p>바깥</p><blockquote><p>안쪽</p></blockquote></blockquote>');
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
});

test('링크: http(s)·mailto 만, 새 창 rel, 자동 링크·맨 URL·끝 문장부호', () => {
  const h = renderMarkdown('[문서](https://example.com/a?b=1&c=2 "제목") <https://auto.example/x> https://bare.example/p). 끝 (https://paren.example/a_(b)) mailto:x');
  assert.match(h, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">문서<\/a>/);
  assert.match(h, /<a href="https:\/\/auto\.example\/x" target="_blank" rel="noopener noreferrer">https:\/\/auto\.example\/x<\/a>/);
  assert.match(h, /<a href="https:\/\/bare\.example\/p"[^>]*>https:\/\/bare\.example\/p<\/a>\)\./);
  assert.match(h, /<a href="https:\/\/paren\.example\/a_\(b\)"/);
  assertSafe(h);
  assert.equal((h.match(/<a /g) || []).length, 4); // mailto 맨 글자는 링크 아님
  assert.match(renderMarkdown('[메일](mailto:a@b.co)'), /<a href="mailto:a@b\.co"/);
  assert.equal(safeUrl('  https://x.example/ '), 'https://x.example/');
  assert.equal(safeUrl('ftp://x'), null);
  assert.equal(safeUrl('/relative'), null);
  assert.equal(safeUrl('//evil.example'), null);
});

test('XSS 시도: 원문 HTML·위험 링크·속성 탈출·이미지·엔티티는 글자일 뿐', () => {
  const attacks = [
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg onload=alert(1)>', '<iframe src="javascript:alert(1)"></iframe>',
    '[x](javascript:alert(1))', '[x]( JaVaScRiPt:alert(1))', '[x](java\tscript:alert(1))', '[x](&#106;avascript:alert(1))', '[x](javascript&colon;alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)', '[x](vbscript:msgbox(1))', '[x](https://a.example/"onmouseover="alert(1))',
    '[x](https://a.example/ "t" onclick="alert(1)")', '![x](javascript:alert(1))', '![x](https://a.example/p.png "t")', '<https://a.example/><script>',
    '[<img src=x onerror=alert(1)>](https://a.example)', '`<script>`', '**<b onclick=alert(1)>x</b>**', '| <img src=x onerror=1> | b |\n|---|---|\n| <script> | y |',
    '# <script>x</script>', '> <img src=x>', '- <a href="javascript:alert(1)">x</a>', '```\n</code></pre><script>alert(1)</script>\n```', '[a](https://x.example/‮)',
    '<a href="https://x">y</a>', 'https://x.example/"><script>alert(1)</script>', '\u0000<script>', '[x](<javascript:alert(1)>)',
    // 새 문법: 각주 이름·정의, 4칸 코드, 수식, 항목 안 표
    'a[^"><script>]\n\n[^"><script>]: <img src=x onerror=1>', '[^1]: [x](javascript:alert(1)) <iframe>', '    <script>alert(1)</script>', '\t</code></pre><img src=x>',
    '$"><img src=x onerror=1>$', '$$\n"><svg onload=1>\n$$', '- a\n\n  | <img src=x> | b |\n  |---|---|\n  | [x](javascript:1) | <script> |', 'a[^1]\n\n[^1]: $x$ <b onclick=1>',
  ];
  for (const a of attacks) {
    const h = renderMarkdown(a), i = renderMarkdownInline(a);
    assertSafe(h, a); assertSafe(i, a);
    assert.doesNotMatch(h, /<script|<img|<svg|<iframe|<b /i, a); // 글자로 남은 onerror= 는 태그 안이 아니라 무해(assertSafe 가 속성을 봄)
    assert.doesNotMatch(h + i, /href="(?!https?:\/\/|mailto:)/i, a);
    assert.doesNotMatch(h, /href="[^"]*["\s]on/i, a);
  }
  assert.match(renderMarkdown('<script>alert(1)</script>'), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(renderMarkdown('[x](javascript:alert(1))'), /<p>x<\/p>/);
  assert.match(renderMarkdown('![x](https://a.example/p.png)'), /<a href="https:\/\/a\.example\/p\.png"[^>]*>x<\/a>/); // 이미지는 불러오지 않고 링크로만
  assert.doesNotMatch(renderMarkdown('![x](https://a.example/p.png)'), /<img/);
});

test('한도: 아주 긴 글은 이스케이프만, 깊은 중첩·반복 구분자에서도 끝난다', () => {
  const big = 'a'.repeat(MD_LIMITS.chars + 10) + '<script>';
  const h = renderMarkdown(big);
  assert.ok(h.length < MD_LIMITS.chars + 100 && !h.includes('<script'));
  const t0 = Date.now();
  renderMarkdown('*'.repeat(3000) + '_'.repeat(3000) + '['.repeat(2000) + '`'.repeat(1000));
  renderMarkdown('> '.repeat(200) + 'x');
  renderMarkdown(Array.from({ length: 60 }, (_, i) => ' '.repeat(i * 2) + '- x').join('\n'));
  renderMarkdown('**a **'.repeat(2000));
  assert.ok(Date.now() - t0 < 3000, '느린 입력');
  assertSafe(renderMarkdown('> '.repeat(50) + '<b>x'));
});

test('배선: Interactive 는 Claude 응답만 Markdown, 실황은 인라인만, 외부 라이브러리 없음', () => {
  const ix = readFileSync(new URL('../interact-view.mjs', import.meta.url), 'utf8'); // 줄 그리기는 순수 모듈
  assert.match(ix, /r\.k === 'assistant' \? assistantBody\(r, ctx, t\)/); assert.match(ix, /return `<div class="md">\$\{renderMarkdown\(r\.text \|\| '', \{ scope \}\)\}\$\{btn\}<\/div>`/);
  assert.match(ix, /<p class="ix-raw">\$\{escapeHtml\(r\.text \|\| ''\)\}<\/p>/); // 내 글·터미널 입력은 그대로
  const pn = readFileSync(new URL('../panel.js', import.meta.url), 'utf8');
  assert.match(pn, /renderMarkdownInline\(ev\.text/);
  const md = readFileSync(new URL('../markdown.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...md.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]), ['./html-util.mjs']);
  assert.ok(!/innerHTML|eval\(|new Function/.test(md.replace(/\/\/.*$/gm, '')));
  assert.match(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /href="markdown\.css"/);
});

// ── 남은 한계 처리: 항목 안 블록·4칸 코드·각주·수식 ──
test('목록 항목 안의 표·코드·인용(들여쓴 하위 블록), 중첩 항목 아래 표', () => {
  assert.match(renderMarkdown('- 항목\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n- 다음'), /<li><p>항목<\/p><div class="md-tablewrap"><table>.*<td>1<\/td><td>2<\/td>.*<\/table><\/div><\/li><li>다음<\/li>/);
  assert.match(renderMarkdown('- 항목\n  | a | b |\n  |---|---|\n  | 1 | 2 |'), /<li><p>항목<\/p><div class="md-tablewrap">/); // 빈 줄 없이 바로 표
  assert.match(renderMarkdown('1. 단계\n   ```sh\n   ls -la\n   ```\n2. 둘'), /<ol><li><p>단계<\/p><pre class="md-pre"><code class="lang-sh">ls -la<\/code><\/pre><\/li><li>둘<\/li><\/ol>/);
  assert.match(renderMarkdown('- a\n  - b\n\n    | x | y |\n    |---|---|\n    | 1 | 2 |'), /<ul><li>a<ul><li><p>b<\/p><div class="md-tablewrap">/);
  assert.match(renderMarkdown('- 인용\n  > 안쪽 **굵게**'), /<li><p>인용<\/p><blockquote><p>안쪽 <strong>굵게<\/strong><\/p><\/blockquote><\/li>/);
  assert.match(renderMarkdown('> ```js\n> const a = 1;\n> ```'), /<blockquote><pre class="md-pre"><code class="lang-js">const a = 1;<\/code><\/pre><\/blockquote>/);
  assert.match(renderMarkdown('-\tTab 항목\n\n\t```\n\tx\n\t```'), /<pre class="md-pre"><code>x<\/code><\/pre>/);
});

test('4칸 들여쓰기 코드 블록: 블록 시작에서만, 빈 줄 이어짐, 이스케이프, 문단 도중은 이어짐', () => {
  assert.equal(renderMarkdown('문단\n\n    code <b>\n      더 들여씀\n\n    이어짐\n\n끝'), '<p>문단</p><pre class="md-pre"><code>code &lt;b&gt;\n  더 들여씀\n\n이어짐</code></pre><p>끝</p>');
  assert.equal(renderMarkdown('문단\n    이어짐'), '<p>문단<br>이어짐</p>'); // 문단을 끊지 않음(CommonMark)
  assert.equal(renderMarkdown('\tTab 코드'), '<pre class="md-pre"><code>Tab 코드</code></pre>');
  assert.equal(renderMarkdown('- a\n\n      항목 안 코드'), '<ul><li><p>a</p><pre class="md-pre"><code>항목 안 코드</code></pre></li></ul>');
  assert.equal(renderMarkdown('1. a\n\n    이어지는 문단'), '<ol><li><p>a</p><p>이어지는 문단</p></li></ol>'); // 번호 항목 내용 칸(3) 기준이라 코드 아님
});

test('각주: 참조 순서 번호·정의는 글 끝 목록·없는 이름은 글자·코드 안은 각주 아님·이어진 줄', () => {
  const h = renderMarkdown('본문[^b] 그리고[^a] 없음[^x] 다시[^b]\n\n[^a]: 에이 **굵게**\n[^b]: 비\n    이어진 줄\n[^c]: 참조 안 됨');
  assert.equal(h, '<p>본문<sup class="md-fnref">1</sup> 그리고<sup class="md-fnref">2</sup> 없음[^x] 다시<sup class="md-fnref">1</sup></p>'
    + '<ol class="md-footnotes"><li>비<br>이어진 줄</li><li>에이 <strong>굵게</strong></li><li>참조 안 됨</li></ol>');
  assertSafe(h);
  assert.equal(renderMarkdown('```\n[^1]: 코드 안\n```\n참조[^1]'), '<pre class="md-pre"><code>[^1]: 코드 안</code></pre><p>참조[^1]</p>');
  assert.equal(renderMarkdownInline('실황 줄[^1]'), '실황 줄[^1]'); // 정의를 모르는 한 줄 렌더는 글자
  assert.equal(renderMarkdown('[^1]: 정의만'), '<ol class="md-footnotes"><li>정의만</li></ol>');
  const x = renderMarkdown('a[^1]\n\n[^1]: <script>alert(1)</script> [x](javascript:alert(1))');
  assertSafe(x); assert.doesNotMatch(x, /<script/);
});

test('수식: $…$·$$…$$ 는 고정폭 글자로만(조판·HTML 없음), 금액·변수·이스케이프는 글자', () => {
  assert.equal(renderMarkdownInline('식 $E=mc^2$ 끝'), '식 <code class="md-math">E=mc^2</code> 끝');
  assert.equal(renderMarkdownInline('$5 그리고 $10'), '$5 그리고 $10');
  assert.equal(renderMarkdownInline('$HOME/$USER 와 $PATH'), '$HOME/$USER 와 $PATH');
  assert.equal(renderMarkdownInline('US$5 와 $x$y'), 'US$5 와 $x$y');
  assert.equal(renderMarkdownInline('\\$x\\$'), '$x$');
  assert.equal(renderMarkdownInline('`$a$` 코드'), '<code>$a$</code> 코드');
  assert.equal(renderMarkdownInline('a $x_1 * y_2$ b'), 'a <code class="md-math">x_1 * y_2</code> b'); // 수식 안 _ * 는 강조 아님
  assert.equal(renderMarkdownInline('한 줄 $$a+b$$ 표시'), '한 줄 <code class="md-math">a+b</code> 표시');
  assert.equal(renderMarkdown('$$\n\\int_0^1 x\\,dx\n$$\n뒤'), '<pre class="md-pre md-math"><code>\\int_0^1 x\\,dx</code></pre><p>뒤</p>');
  assert.equal(renderMarkdown('$$ a+b $$'), '<pre class="md-pre md-math"><code>a+b</code></pre>');
  assert.equal(renderMarkdown('$$\n안 닫힘 <b>'), '<pre class="md-pre md-math"><code>안 닫힘 &lt;b&gt;</code></pre>'); // 스트리밍 중
  for (const a of ['$<img src=x onerror=alert(1)>$', '$$<script>alert(1)</script>$$', '$$\n</code></pre><script>x</script>\n$$', '$[x](javascript:alert(1))$', '[^1]\n\n[^1]: $<svg onload=1>$'])
    { const h = renderMarkdown(a); assertSafe(h, a); assert.doesNotMatch(h, /<script|<img|<svg/i, a); }
});

test('정의 목록은 지원하지 않음(글자 그대로) — 근거: GFM 아님·실데이터에 없음', () => {
  assert.equal(renderMarkdown('용어\n: 정의'), '<p>용어<br>: 정의</p>');
});

test('§140.2 실황: 원문 md 가 오면 블록 전체·잘림 표시, 없으면 인라인 — 문구 en·ko', () => {
  const pn = readFileSync(new URL('../panel.js', import.meta.url), 'utf8');
  assert.match(pn, /else if \(ev\.md\) msg = `<div class="md md-live">\$\{renderMarkdown\(ev\.md, \{ scope: 'lv' \+ \(\+\+_mdN\) \}\)\}\$\{ev\.mdCut \?/); // 응답마다 각주 범위
  assert.match(pn, /else msg = `<span class="md md-inline">\$\{renderMarkdownInline\(ev\.text/);
  const css = readFileSync(new URL('../markdown.css', import.meta.url), 'utf8');
  assert.match(css, /\.md\.md-live \{[^}]*max-height:[^}]*overflow-y: auto/);
  const src = readFileSync(new URL('../i18n/app.mjs', import.meta.url), 'utf8');
  assert.equal((src.match(/'app\.panel\.mdCut'/g) || []).length, 2, 'en·ko');
});
