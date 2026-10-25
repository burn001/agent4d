// 상단 바 겹침 회귀 시험(정적 CSS 검사). 1440px 에서 프로젝트 선택기가 40px 로 눌려 내용이 '재생' 버튼 위로 넘치던 결함:
//  - 넓은 화면도 상단 바가 넘치면 줄바꿈(nowrap 으로 눌리지 않게)
//  - 선택기 버튼은 내용을 잘라(overflow hidden) 이웃 버튼 위로 삐져나오지 않게, 눌려도 최소 폭 유지
//  - 상단 바가 두 줄이 되면 무대·패널·카메라 칩·범례가 --topbar-h 를 따라 내려간다
// 브라우저 실측(1440·1280·1024·720·390, boundingRect 교차 0)은 커밋 메시지 참고.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

/** 아주 작은 CSS 파서: [{ media: {min,max}|null, selectors: [..], decl: {prop: value} }] (주석 제거, @media 한 단계만) */
function parseCss(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0;
  const parseMedia = (q) => {
    if (/prefers-|print/.test(q)) return { skip: true };
    const min = q.match(/min-width:\s*(\d+)px/), max = q.match(/max-width:\s*(\d+)px/);
    return { min: min ? +min[1] : 0, max: max ? +max[1] : Infinity };
  };
  const block = (end, media) => {
    while (i < end) {
      const open = src.indexOf('{', i);
      if (open < 0 || open >= end) break;
      const head = src.slice(i, open).trim();
      if (head.startsWith('@media')) {
        let depth = 1, j = open + 1;
        while (depth && j < src.length) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
        i = open + 1; block(j - 1, parseMedia(head)); i = j; continue;
      }
      if (head.startsWith('@')) { // @keyframes 등: 통째로 건너뜀
        let depth = 1, j = open + 1;
        while (depth && j < src.length) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
        i = j; continue;
      }
      const close = src.indexOf('}', open);
      const decl = {};
      for (const d of src.slice(open + 1, close).split(';')) {
        const k = d.indexOf(':'); if (k < 0) continue;
        decl[d.slice(0, k).trim()] = d.slice(k + 1).trim();
      }
      rules.push({ media, selectors: head.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decl });
      i = close + 1;
    }
  };
  block(src.length, null);
  return rules;
}

/** 폭 w 에서 selector 에 마지막으로 적용되는 prop 값(같은 선택자 문자열만, 원본 순서 = 우선순위) */
function computed(rules, selector, prop, w) {
  let v;
  for (const r of rules) {
    if (r.media && (r.media.skip || w < r.media.min || w > r.media.max)) continue;
    if (r.selectors.includes(selector) && prop in r.decl) v = r.decl[prop];
  }
  return v;
}

const theme = parseCss(read('theme.css'));
const projects = parseCss(read('projects.css'));
const WIDTHS = [1920, 1600, 1440, 1280, 1024, 720];

test('상단 바: 720 이상 모든 폭에서 넘치면 줄바꿈(nowrap 으로 선택기를 누르지 않음)', () => {
  for (const w of WIDTHS) assert.equal(computed(theme, '#topbar', 'flex-wrap', w), 'wrap', `${w}px`);
  for (const w of [390, 360]) assert.equal(computed(theme, '#topbar', 'flex-wrap', w), 'wrap', `${w}px`);
});

test('상단 바 높이가 바뀌면 무대·패널·카메라 칩·범례가 --topbar-h 를 따른다', () => {
  for (const w of [...WIDTHS, 390]) {
    for (const sel of ['#stage', '#panel', '#cam-chip', '#legend']) {
      const top = computed(theme, sel, 'top', w);
      if (sel === '#panel' && w < 720) continue; // 좁은 화면 패널은 아래쪽 시트(top:auto)
      assert.match(top || '', /var\(--topbar-h/, `${sel} @${w}px top=${top}`);
    }
  }
});

test('프로젝트 선택기: 내용은 버튼 안에서 잘리고(overflow hidden), 720 이상에서 최소 폭을 지킨다', () => {
  assert.equal(computed(projects, '.psel-btn', 'overflow', 1440), 'hidden');
  for (const w of [1440, 1280, 1024, 720]) {
    const mw = computed(projects, '.psel', 'min-width', w);
    assert.ok(/^\d+px$/.test(mw) && parseInt(mw, 10) >= 72, `.psel min-width @${w}px = ${mw}`);
  }
  assert.equal(computed(projects, '.psel-btn .psel-meta', 'min-width', 1440), '0');
});
