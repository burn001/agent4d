// Markdown → 안전한 HTML 문자열(순수, DOM 없음, 외부 라이브러리 없음).
// 보안 원칙: 원문은 어떤 경우에도 HTML 로 해석하지 않는다. 모든 글자는 escapeHtml 을 거쳐 나가고, 출력 태그는 아래 고정 목록뿐이며
// 속성은 우리가 만든 것(href·target·rel·class·align·start)만 — href 는 http(s)·mailto 만(javascript:·data: 등은 링크 아닌 글자로).
// 지원: 제목 · 문단(줄바꿈 유지) · 굵게 · 기울임 · 취소선(반각 ~~ 만, 전각 ～ 은 글자) · 인라인 코드 · 코드 블록(펜스·4칸 들여쓰기) · 링크(마크다운·<자동>·맨 URL)
//       · 이미지(링크 글자로만, 불러오지 않음) · 인용 · 수평선 · 목록(중첩·번호·체크, 항목 안 표·코드·인용) · GFM 표 · 각주([^1] → 글 끝 목록)
//       · 수식($…$ · $$…$$ — 조판하지 않고 고정폭 글자로 구분만).
// 미완성(스트리밍 중·잘린 글): 닫히지 않은 펜스는 끝까지 코드, 닫히지 않은 강조·링크·backtick 은 글자 그대로, 표 머리만 있고 구분줄이 없으면 문단.
import { escapeHtml as esc } from './html-util.mjs';

export const MD_TAGS = ['a', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'];
export const MD_LIMITS = { chars: 40000, depth: 6 };

const ESCAPABLE = '\\`*_{}[]()#+-.!|~<>"\'&:/$^';
const SAFE_URL = /^(?:https?:\/\/|mailto:)[^\s<>"'`\\]+$/i;
const CTRL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g;

/** 링크 주소 점검: 허용 프로토콜이면 정리한 주소, 아니면 null */
export function safeUrl(raw) {
  const u = String(raw ?? '').replace(CTRL, '').trim();
  if (!u || u.length > 2000) return null;
  return SAFE_URL.test(u) ? u : null;
}
const aTag = (href, inner) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;

// ───────────── 인라인 ─────────────
const isWs = (c) => c === undefined || c === '' || /\s/.test(c);
const isAlnum = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** s[i] 의 backtick 줄(run) 길이 */
function runLen(s, i, ch) { let n = 0; while (s[i + n] === ch) n++; return n; }

/** 닫는 ] 위치(중첩 [] 허용, 코드·이스케이프 건너뜀). 없으면 -1 */
function matchBracket(s, i) {
  let d = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') { k++; continue; }
    if (c === '`') { const n = runLen(s, k, '`'); const e = findCodeEnd(s, k + n, n); if (e >= 0) { k = e + n - 1; continue; } k += n - 1; continue; }
    if (c === '[') d++;
    else if (c === ']') { d--; if (d === 0) return k; }
  }
  return -1;
}
function findCodeEnd(s, from, n) {
  for (let k = from; k < s.length; k++) {
    if (s[k] !== '`') continue;
    const m = runLen(s, k, '`');
    if (m === n) return k;
    k += m - 1;
  }
  return -1;
}

/** `(주소 "제목")` 읽기. 성공이면 {url, end} (end = 닫는 ) 다음 위치) */
function readDest(s, i) {
  if (s[i] !== '(') return null;
  let k = i + 1;
  while (s[k] === ' ') k++;
  let url = '';
  if (s[k] === '<') { const e = s.indexOf('>', k); if (e < 0) return null; url = s.slice(k + 1, e); k = e + 1; }
  else {
    let d = 0, st = k;
    for (; k < s.length; k++) {
      const c = s[k];
      if (c === '\\') { k++; continue; }
      if (c === '(') d++;
      else if (c === ')') { if (d === 0) break; d--; }
      else if (c === ' ' || c === '\n') break;
    }
    url = s.slice(st, k);
  }
  while (s[k] === ' ') k++;
  if (s[k] === '"' || s[k] === "'") { const q = s[k]; const e = s.indexOf(q, k + 1); if (e < 0) return null; k = e + 1; while (s[k] === ' ') k++; }
  if (s[k] !== ')') return null;
  return { url: url.replace(/\\([()])/g, '$1'), end: k + 1 };
}

/** 강조 짝 찾기: s[from..] 에서 같은 글자 n 개짜리 닫는 줄. 없으면 -1 */
function findCloser(s, from, ch, n) {
  for (let k = from; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') { k++; continue; }
    if (c === '`') { const m = runLen(s, k, '`'); const e = findCodeEnd(s, k + m, m); if (e >= 0) k = e + m - 1; else k += m - 1; continue; }
    if (c !== ch) continue;
    const m = runLen(s, k, ch);
    // 닫는 줄: 길이가 같거나(또는 3 = 안쪽 1·2 + 바깥 n 이 붙은 꼴), 앞이 공백이 아니고, '_' 는 뒤가 글자·숫자가 아니어야(낱말 속 _ 방지)
    if ((m === n || (m === 3 && n < 3)) && !isWs(s[k - 1]) && (ch !== '_' || !isAlnum(s[k + m]))) return k + (m - n);
    k += m - 1;
  }
  return -1;
}

// 각주 문맥(renderMarkdown 한 번 동안만 — 동기 함수라 안전). defs: 이름(소문자) → 정의, order: 처음 참조한 순서
let FN = null;
const FN_LABEL = /^\[\^([^\]\s]{1,30})\]/;
const FN_DEF = /^ {0,3}\[\^([^\]\s]{1,30})\]:[ \t]?(.*)$/;
/** 인라인 수식 $…$ 의 닫는 $ 위치(없으면 -1). 여는 $ 뒤·닫는 $ 앞은 공백이 아니고, 닫는 $ 뒤는 글자·숫자가 아니어야
 *  ($5 와 $10 같은 금액, $HOME/$USER 같은 변수를 수식으로 오인하지 않게). 조건이 안 맞는 $ 를 먼저 만나면 수식 아님 */
function findMathEnd(s, from) {
  if (isWs(s[from]) || s[from] === '$') return -1;
  for (let k = from; k < s.length; k++) {
    if (s[k] === '\\') { k++; continue; }
    if (s[k] !== '$') continue;
    return k > from && !isWs(s[k - 1]) && !isAlnum(s[k + 1]) && s[k + 1] !== '$' ? k : -1;
  }
  return -1;
}

export function renderInline(s, depth = 0) {
  s = String(s ?? '');
  if (depth > MD_LIMITS.depth) return esc(s);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '$') { // 수식: 조판하지 않고 고정폭 글자(md-math)로만 구분. 한 줄 안의 $$…$$ 도 인라인으로
      if (s[i + 1] === '$') {
        const e = s.indexOf('$$', i + 2);
        if (e > i + 2 && s.slice(i + 2, e).trim()) { out += `<code class="md-math">${esc(s.slice(i + 2, e).trim())}</code>`; i = e + 1; continue; }
        out += '$$'; i++; continue;
      }
      const e = !isAlnum(s[i - 1]) ? findMathEnd(s, i + 1) : -1;
      if (e > i + 1) { out += `<code class="md-math">${esc(s.slice(i + 1, e))}</code>`; i = e; continue; }
      out += '$'; continue;
    }
    if (c === '[' && s[i + 1] === '^' && FN) { // 각주 참조: 정의가 있는 이름만 번호(없으면 글자 그대로). 링크는 걸지 않음(패널 안 여러 응답의 id 충돌·# 주소 없음)
      const m = FN_LABEL.exec(s.slice(i, i + 40));
      const key = m && m[1].toLowerCase();
      if (m && FN.defs.has(key)) {
        if (!FN.order.includes(key)) FN.order.push(key);
        const n = FN.order.indexOf(key) + 1;
        if (FN.p) { // 범위 id(패널 안 메시지마다 다른 접두)가 있으면 번호 ↔ 본문 왕복 링크(href 는 '#'+우리가 만든 id 뿐)
          const k = (FN.refs.get(key) || 0) + 1; FN.refs.set(key, k);
          out += `<sup class="md-fnref" id="${FN.p}r${n}${k > 1 ? '-' + k : ''}"><a class="md-fn" href="#${FN.p}f${n}">${n}</a></sup>`;
        } else out += `<sup class="md-fnref">${n}</sup>`;
        i += m[0].length - 1; continue;
      }
    }
    if (c === '\\' && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) { out += esc(s[i + 1]); i++; continue; }
    if (c === '\\' && s[i + 1] === '\n') { out += '<br>'; i++; continue; }
    if (c === '`') {
      const n = runLen(s, i, '`');
      const e = findCodeEnd(s, i + n, n);
      if (e < 0) { out += esc('`'.repeat(n)); i += n - 1; continue; }
      let code = s.slice(i + n, e).replace(/\n/g, ' ');
      if (code.length > 2 && code[0] === ' ' && code[code.length - 1] === ' ' && code.trim()) code = code.slice(1, -1);
      out += `<code>${esc(code)}</code>`;
      i = e + n - 1; continue;
    }
    if (c === '!' && s[i + 1] === '[') { // 이미지는 불러오지 않는다 — 대체 글자를 링크로(안전한 주소일 때), 아니면 글자만
      const e = matchBracket(s, i + 1);
      const d = e > 0 ? readDest(s, e + 1) : null;
      if (d) {
        const alt = renderInline(s.slice(i + 2, e), depth + 1) || esc(d.url);
        const u = safeUrl(d.url);
        out += u ? aTag(u, alt) : alt;
        i = d.end - 1; continue;
      }
      out += '!'; continue;
    }
    if (c === '[') {
      const e = matchBracket(s, i);
      const d = e > 0 ? readDest(s, e + 1) : null;
      if (d) {
        const inner = renderInline(s.slice(i + 1, e), depth + 1);
        const u = safeUrl(d.url);
        out += u ? aTag(u, inner) : inner; // 위험한 주소는 링크 없이 글자만
        i = d.end - 1; continue;
      }
      out += '['; continue;
    }
    if (c === '<') {
      const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(s.slice(i, i + 2100));
      if (m && safeUrl(m[1])) { out += aTag(safeUrl(m[1]), esc(m[1])); i += m[0].length - 1; continue; }
      out += '&lt;'; continue;
    }
    if ((c === 'h' || c === 'H') && /^https?:\/\//i.test(s.slice(i, i + 8)) && !isAlnum(s[i - 1])) {
      let e = i;
      while (e < s.length && !/[\s<>]/.test(s[e])) e++;
      let url = s.slice(i, e);
      for (;;) { // 끝 문장부호는 주소 밖, 닫는 괄호는 여는 괄호보다 많을 때만 밖
        const last = url[url.length - 1];
        if (last && /[.,;:!?'"”’»\]}]/.test(last)) url = url.slice(0, -1);
        else if (last === ')' && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) url = url.slice(0, -1);
        else break;
      }
      if (url.length > 8 && safeUrl(url)) { out += aTag(url, esc(url)); i += url.length - 1; continue; }
    }
    if (c === '*' || c === '_' || (c === '~' && s[i + 1] === '~')) {
      const run = runLen(s, i, c);
      let n = c === '~' ? (run === 2 ? 2 : 0) : Math.min(run, 3);
      const next = s[i + run];
      const prev = s[i - 1];
      const canOpen = n > 0 && !isWs(next) && (c !== '_' || !isAlnum(prev)) && (c !== '~' || run === 2);
      if (canOpen) {
        const from = i + (c === '~' ? 2 : run);
        // run 이 3 초과면 앞쪽은 글자, 마지막 3 개만 연다
        const open = c === '~' ? i : i + run - n;
        const cl = findCloser(s, from, c, n);
        if (cl > from) {
          const inner = renderInline(s.slice(from, cl), depth + 1);
          if (inner) {
            out += esc(s.slice(i, open)) + (c === '~' ? `<del>${inner}</del>` : n === 3 ? `<em><strong>${inner}</strong></em>` : n === 2 ? `<strong>${inner}</strong>` : `<em>${inner}</em>`);
            i = cl + n - 1; continue;
          }
        }
      }
      out += esc(s.slice(i, i + run)); i += run - 1; continue;
    }
    out += esc(c);
  }
  return out;
}

// ───────────── 블록 ─────────────
const RE = {
  fence: /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/,
  heading: /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/,
  hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
  quote: /^ {0,3}>[ ]?/,
  item: /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/,
  itemEmpty: /^( *)([-*+]|\d{1,9}[.)])[ \t]*$/,
  sep: /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/,
};
const indentOf = (l) => { let n = 0; for (const c of l) { if (c === ' ') n++; else if (c === '\t') n += 4; else break; } return n; };

/** 표 줄 → 칸(이스케이프된 \| 는 칸 안 글자) */
function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const cells = [];
  let cur = '', inCode = false, ticks = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\' && t[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') { const n = runLen(t, i, '`'); if (!inCode) { inCode = true; ticks = n; } else if (n === ticks) inCode = false; cur += '`'.repeat(n); i += n - 1; continue; }
    if (c === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}
const isTableStart = (lines, i) => {
  const h = lines[i], s = lines[i + 1];
  if (h === undefined || s === undefined || !h.includes('|') || !RE.sep.test(s)) return false;
  return splitRow(h).length === splitRow(s).length;
};
const startsBlock = (l) => RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) || isBulletStart(l);
const isBulletStart = (l) => { const m = RE.item.exec(l); return !!m && (/^[-*+]$/.test(m[2]) || /^1[.)]$/.test(m[2])) && m[3].trim() !== ''; };

function tableHtml(lines, i) {
  const head = splitRow(lines[i]);
  const al = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+$/.test(c) ? 'left' : ''));
  const cell = (tag, x, k) => `<${tag}${al[k] ? ` align="${al[k]}"` : ''}>${renderInline(x)}</${tag}>`;
  let html = `<div class="md-tablewrap"><table><thead><tr>${head.map((x, k) => cell('th', x, k)).join('')}</tr></thead><tbody>`;
  let j = i + 2;
  for (; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim() || !l.includes('|') || RE.fence.test(l) || RE.quote.test(l)) break;
    const row = splitRow(l);
    html += `<tr>${head.map((_, k) => cell('td', row[k] ?? '', k)).join('')}</tr>`;
  }
  return { html: html + '</tbody></table></div>', next: j };
}

function listHtml(lines, i, depth) {
  const first = RE.item.exec(lines[i]);
  const base = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const bullet = first[2];
  const startNo = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let j = i;
  while (j < lines.length) {
    const m = RE.item.exec(lines[j]) || RE.itemEmpty.exec(lines[j]);
    if (!m || RE.hr.test(lines[j])) break;
    const ind = indentOf(m[1]);
    if (ind !== base && !(Math.abs(ind - base) <= 1)) break; // 들여쓰기가 다르면 아래 중첩 처리에서 이미 먹었어야 함
    if ((/\d/.test(m[2])) !== ordered || (!ordered && m[2] !== bullet)) break;
    const body = [m[3] ?? ''];
    const mw = base + m[2].length + 1; // 내용 시작 칸
    j++;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) { // 빈 줄: 뒤따르는 첫 비어 있지 않은 줄이 더 들여써졌으면 같은 항목
        let k = j + 1; while (k < lines.length && !lines[k].trim()) k++;
        if (k < lines.length && indentOf(lines[k]) > base) { body.push(''); continue; }
        break;
      }
      if (indentOf(l) > base) { body.push(l.slice(sliceIndent(l, Math.min(mw, indentOf(l))))); continue; }
      // 느슨한 이어짐: 앞 줄이 비어 있지 않고 새 블록·항목이 아니면 같은 문단의 연속
      if (body[body.length - 1].trim() && !startsBlock(l) && !RE.item.test(l) && !isTableStart(lines, j)) { body.push(l.trim()); continue; }
      break;
    }
    items.push(body);
    // 항목 사이 빈 줄 하나는 같은 목록으로
    if (j < lines.length && !lines[j].trim()) {
      let k = j; while (k < lines.length && !lines[k].trim()) k++;
      if (k < lines.length && (RE.item.exec(lines[k]) || [])[1] !== undefined && Math.abs(indentOf(RE.item.exec(lines[k])[1]) - base) <= 1
        && (/\d/.test(RE.item.exec(lines[k])[2]) === ordered) && !RE.hr.test(lines[k])) j = k;
    }
  }
  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNo !== 1 && startNo < 1e6 ? ` start="${startNo}"` : '';
  const lis = items.map((body) => {
    let text0 = body[0];
    let task = '';
    const tm = /^\[([ xX])\][ \t]+/.exec(text0);
    if (tm) { task = tm[1] === ' ' ? '<span class="md-task">☐</span> ' : '<span class="md-task done">☑</span> '; body[0] = text0.slice(tm[0].length); }
    const blocks = parseBlocks(body, depth + 1);
    // 촘촘한 목록: 첫 문단은 <p> 없이(뒤에 중첩 목록만 오거나 문단이 하나뿐일 때)
    const tight = blocks.length && blocks[0].t === 'p' && blocks.slice(1).every((b) => b.t === 'list');
    const inner = tight ? blocks[0].inline + blocks.slice(1).map((b) => b.html).join('') : blocks.map((b) => b.html).join('');
    return `<li>${task}${inner}</li>`;
  });
  return { html: `<${tag}${startAttr}>${lis.join('')}</${tag}>`, next: j };
}
function sliceIndent(l, n) { let k = 0, w = 0; while (k < l.length && w < n && (l[k] === ' ' || l[k] === '\t')) { w += l[k] === '\t' ? 4 : 1; k++; } return k; }

/** 줄 목록 → [{t, html, inline?}] */
function parseBlocks(lines, depth) {
  const out = [];
  if (depth > MD_LIMITS.depth) { const t = lines.join('\n'); return t.trim() ? [{ t: 'p', html: `<p>${esc(t).replace(/\n/g, '<br>')}</p>`, inline: esc(t).replace(/\n/g, '<br>') }] : []; }
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = RE.fence.exec(l))) { // 닫히지 않으면 끝까지 코드(스트리밍·잘린 글)
      const fence = m[1], lang = /^[A-Za-z0-9_+#.-]{1,20}$/.test(m[2]) ? m[2] : '';
      const indent = indentOf(l);
      const body = [];
      i++;
      while (i < lines.length) {
        const cm = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
        if (cm && cm[1][0] === fence[0] && cm[1].length >= fence.length) { i++; break; }
        body.push(lines[i].slice(Math.min(indent, sliceIndent(lines[i], indent))));
        i++;
      }
      out.push({ t: 'code', html: `<pre class="md-pre"><code${lang ? ` class="lang-${lang}"` : ''}>${esc(body.join('\n'))}</code></pre>` });
      continue;
    }
    if (indentOf(l) >= 4) { // 4칸 들여쓰기 코드 — 블록 시작에서만(문단 도중 들여쓴 줄은 아래 문단 고리가 이어짐으로 먹음). 빈 줄 뒤 다시 4칸이면 같은 블록
      const body = [];
      while (i < lines.length && (indentOf(lines[i]) >= 4 || !lines[i].trim())) { body.push(lines[i].slice(sliceIndent(lines[i], 4))); i++; }
      while (body.length && !body[body.length - 1].trim()) body.pop();
      out.push({ t: 'code', html: `<pre class="md-pre"><code>${esc(body.join('\n'))}</code></pre>` });
      continue;
    }
    if (/^ {0,3}\$\$/.test(l)) { // 표시 수식 $$ … $$(여러 줄, 닫히지 않으면 끝까지 — 스트리밍·잘린 글) → 고정폭 블록. 조판하지 않음
      const t0 = l.trim().slice(2);
      const one = t0.indexOf('$$');
      if (one < 0) {
        const body = t0.trim() ? [t0] : [];
        i++;
        while (i < lines.length) {
          const e = lines[i].indexOf('$$');
          if (e >= 0) { if (lines[i].slice(0, e).trim()) body.push(lines[i].slice(0, e)); i++; break; }
          body.push(lines[i]); i++;
        }
        out.push({ t: 'math', html: `<pre class="md-pre md-math"><code>${esc(body.join('\n').trim())}</code></pre>` });
        continue;
      }
      if (t0.slice(0, one).trim() && !t0.slice(one + 2).trim()) { out.push({ t: 'math', html: `<pre class="md-pre md-math"><code>${esc(t0.slice(0, one).trim())}</code></pre>` }); i++; continue; }
      // 그 밖(`$$a$$ 뒤 글`)은 문단 — 인라인이 처리
    }
    if ((m = RE.heading.exec(l))) {
      const lv = Math.min(6, Math.max(3, m[1].length + 2)); // # → h3 … (패널 안이라 한 단계씩 낮춤)
      out.push({ t: 'h', html: `<h${lv} class="md-h">${renderInline(m[2])}</h${lv}>` });
      i++; continue;
    }
    if (RE.hr.test(l)) { out.push({ t: 'hr', html: '<hr>' }); i++; continue; }
    if (isTableStart(lines, i)) { const r = tableHtml(lines, i); out.push({ t: 'table', html: r.html }); i = r.next; continue; }
    if (RE.quote.test(l)) {
      const inner = [];
      while (i < lines.length && RE.quote.test(lines[i])) { inner.push(lines[i].replace(RE.quote, '')); i++; }
      out.push({ t: 'quote', html: `<blockquote>${parseBlocks(inner, depth + 1).map((b) => b.html).join('')}</blockquote>` });
      continue;
    }
    if (RE.item.test(l) && !RE.hr.test(l)) {
      const r = listHtml(lines, i, depth);
      if (r.next > i) { out.push({ t: 'list', html: r.html }); i = r.next; continue; }
    }
    // 문단: 다른 블록이 시작하기 전까지
    const para = [l];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !isTableStart(lines, i)) { para.push(lines[i]); i++; }
    const inline = para.map((x) => renderInline(x.replace(/^[ \t]+/, '').replace(/[ \t]{2,}$/, ''))).join('<br>');
    out.push({ t: 'p', html: `<p>${inline}</p>`, inline });
  }
  return out;
}

/** 각주 정의 줄을 뽑아낸다(펜스 코드 안은 그대로). 정의 = `[^이름]: 글` + 뒤따르는 2칸 이상 들여쓴 줄(빈 줄 하나 사이 허용). @returns {{lines, defs: Map}} */
function takeFootnotes(lines) {
  const out = [], defs = new Map();
  let fence = null;
  const cont = (k) => k < lines.length && lines[k].trim() && indentOf(lines[k]) >= 2;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && /^ {0,3}(`{3,}|~{3,})[ \t]*$/.test(l)) fence = null;
      out.push(l); continue;
    }
    const m = !fence && defs.size < 100 ? FN_DEF.exec(l) : null;
    if (!m) { out.push(l); continue; }
    const body = [m[2]];
    while (cont(i + 1) || (i + 1 < lines.length && !lines[i + 1].trim() && cont(i + 2))) { i++; body.push(lines[i].replace(/^(?: {1,4}|\t)/, '')); }
    const key = m[1].toLowerCase();
    if (!defs.has(key)) defs.set(key, body);
  }
  return { lines: out, defs };
}

/** 각주 범위 id 접두: 'mdfn-' + 안전한 범위 이름 + '-' (영숫자·'-' 1～40자만, 그 밖이면 링크 없음) */
export const MD_FN_ID = /^mdfn-[a-z0-9-]{1,40}-[rf]\d{1,3}(?:-\d{1,3})?$/;
export function fnPrefix(scope) {
  const s = String(scope ?? '').toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(s) ? `mdfn-${s}-` : null;
}

/**
 * 블록 Markdown → HTML 조각(`<div class="md">` 로 감싸 쓴다).
 * opts.scope: 각주 왕복 링크용 범위 이름(메시지마다 달라야 함 — 예 Interactive 'ix<바이트 위치>', 실황 'lv<seq>'). 없으면 번호만(링크·id 없음)
 */
export function renderMarkdown(src, opts = {}) {
  let s = String(src ?? '').replace(/\r\n?/g, '\n');
  if (!s.trim()) return '';
  if (s.length > MD_LIMITS.chars) return `<p>${esc(s.slice(0, MD_LIMITS.chars)).replace(/\n/g, '<br>')}…</p>`;
  const { lines, defs } = takeFootnotes(s.split('\n'));
  const prev = FN;
  FN = defs.size ? { defs, order: [], refs: new Map(), p: fnPrefix(opts && opts.scope) } : null;
  try {
    let html = parseBlocks(lines, 0).map((b) => b.html).join('');
    if (FN) { // 글 끝 각주 목록: 참조된 순서, 그다음 참조 안 된 정의(내용이 사라지지 않게). 각주 안의 참조도 번호만
      for (const k of defs.keys()) if (!FN.order.includes(k)) FN.order.push(k); // 번호 = 이 순서(각주 안 참조도 같은 번호)
      const items = [];
      for (const key of FN.order) {
        const blocks = parseBlocks(defs.get(key), 1);
        const inner = blocks.length === 1 && blocks[0].t === 'p' ? blocks[0].inline : blocks.map((b) => b.html).join('');
        const n = items.length + 1;
        items.push(FN.p ? `<li id="${FN.p}f${n}">${inner}${FN.refs.has(key) ? ` <a class="md-fnback" href="#${FN.p}r${n}" aria-label="↩">↩</a>` : ''}</li>` : `<li>${inner}</li>`);
      }
      html += `<ol class="md-footnotes">${items.join('')}</ol>`;
    }
    return html;
  } finally { FN = prev; }
}

/** 한 줄 Markdown(실황 줄처럼 줄바꿈이 이미 없는 글) — 인라인만 */
export function renderMarkdownInline(src) {
  const s = String(src ?? '');
  return s.length > MD_LIMITS.chars ? esc(s.slice(0, MD_LIMITS.chars)) + '…' : renderInline(s);
}
