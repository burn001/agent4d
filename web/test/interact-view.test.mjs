// Interactive 전체 대화: 줄 묶기(시스템 알림 접기·도구 접기)·중복(끼어듦 뒤 같은 글·같은 msgId) 거르기·출처 꼬리표·이스케이프(XSS)·minimal,
// 3D 사용자 콘솔 요약·리본 글리프(출처별), 배선(웹 전부 peer 를 사용자 입력으로)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { viewRows, srcOf, DUP_MS } from '../interact-core.mjs';
import { rowHtml, moreHtml, whoOf } from '../interact-view.mjs';
import { ixSummary, userWho, userGlyph } from '../ix-core.mjs';
import ix from '../i18n/ix.mjs';

const tr = (k, p = {}) => String(ix.ko[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => (p[n] != null ? String(p[n]) : ''));
const ctx = (o = {}) => ({ t: tr, mineAlias: '푸른하늘의고양이', openSys: new Set(), picks: new Map(), canSend: false, cards: new Map(), ...o });

test('§142 줄: 연속 시스템 알림은 한 묶음(n건), 사람 턴 사이 도구는 접힘, 같은 msgId·끼어듦 뒤 같은 글은 한 번', () => {
  const t0 = 1_000_000;
  const items = [
    { k: 'sys', sys: 'notify', ts: t0, o: 10, text: 'a' }, { k: 'sys', sys: 'schedule', ts: t0 + 1, o: 20, text: 'b' },
    { k: 'user', src: 'human', ts: t0 + 2, text: '터미널' },
    { k: 'tool', tools: ['Bash'] },
    { k: 'user', src: 'human', mid: 1, ts: t0 + 3, text: '안나오게 해줘.' },
    { k: 'user', src: 'human', ts: t0 + 4, text: '안나오게 해줘.' }, // 같은 글 user 줄로 다시(대기열 → 다음 턴)
    { k: 'peer', src: 'ix', alias: 'big-star-parrot', name: '사용자 (Agent4D 화면 · big-star-parrot)', msgId: 'm1', ts: t0 + 5, text: '패널', mid: 1 },
    { k: 'peer', src: 'ix', alias: 'big-star-parrot', name: '사용자 (Agent4D 화면 · big-star-parrot)', msgId: 'm1', ts: t0 + 6, text: '패널' },
    { k: 'peer', src: 'peer', who: 'proj-loop-b8', name: 'proj-loop-b8', msgId: 'm2', ts: t0 + 7, text: '보고' },
    { k: 'sys', sys: 'notify', ts: t0 + 8, o: 30, text: 'c' },
    { k: 'assistant', ts: t0 + 9, text: '답' },
    { k: 'user', src: 'human', ts: t0 + 10, text: '터미널' }, // 끼어듦 아님 — 같은 글이라도 다시 보임
  ];
  const { rows } = viewRows(items, [], { aliasEn: 'big-star-parrot', now: t0 });
  assert.deepEqual(rows.map((r) => r.k + (r.k === 'sys' ? r.items.length : '')), ['sys2', 'user', 'tool', 'user', 'mine', 'peer', 'sys1', 'assistant', 'user']);
  assert.equal(rows[0].key, '10:' + t0);
  assert.equal(rows[4].state, 'delivered'); assert.equal(rows[4].mid, 1);
  assert.deepEqual(items.filter((x) => x.k === 'user' || x.k === 'peer').map(srcOf), ['human', 'human', 'human', 'ix', 'ix', 'peer', 'human']);
  assert.ok(DUP_MS >= 60_000);
  // 다른 기기의 Interactive 글은 내 글이 아님(사람 줄로)
  const other = viewRows([items[6]], [], { aliasEn: 'red-sky-cat' }).rows[0];
  assert.equal(other.k, 'peer'); assert.equal(whoOf(other, tr).human, true);
});

test('§142 출처 꼬리표: 터미널·휴대폰 · Interactive: 별칭 · 다른 세션 이름 · SDK · 끼어듦', () => {
  const h = (r) => rowHtml(r, ctx());
  assert.match(h({ k: 'user', src: 'human', text: 'x' }), /<b>사용자<\/b><span class="ix-src">터미널·휴대폰<\/span>/);
  assert.match(h({ k: 'user', src: 'sdk', text: 'x' }), /SDK·-p/);
  assert.match(h({ k: 'user', src: 'human', mid: 1, text: 'x' }), /ix-mid">작업 중 끼어듦/);
  assert.match(h({ k: 'peer', src: 'ix', alias: 'big-star-parrot', text: 'x' }), /k-peer k-human s-ix"><b>사용자<\/b><span class="ix-src">Interactive · big-star-parrot/);
  assert.match(h({ k: 'peer', src: 'peer', who: 'proj-loop-b8', text: 'x' }), /s-peer"><b>다른 세션<\/b><span class="ix-src">proj-loop-b8/);
  assert.match(h({ k: 'mine', state: 'replied', text: 'x' }), /<b>나<\/b><span class="ix-src">Interactive · 푸른하늘의고양이<\/span><em class="ix-st s-replied">응답함/);
  assert.match(h({ k: 'assistant', text: '**굵게**' }), /<div class="md"><p><strong>굵게<\/strong>/);
  assert.equal(h({ k: 'evil', text: 'x' }), '', '모르는 종류는 그리지 않음');
  // 시스템 알림 묶음: 기본 접힘, 펼친 키는 유지
  const sys = { k: 'sys', key: '1:2', items: [{ sys: 'notify', text: '끝' }, { sys: 'zzz', text: '?' }] };
  assert.match(h(sys), /^<details class="ix-sys" data-g="1:2"><summary>시스템 알림 2건<\/summary><ul><li><span class="ix-src">작업 알림<\/span>끝<\/li><li><span class="ix-src">시스템<\/span>\?/);
  assert.match(rowHtml(sys, ctx({ openSys: new Set(['1:2']) })), /data-g="1:2" open>/);
  assert.equal(moreHtml(0, false, tr), ''); assert.match(moreHtml(123, false, tr), /class="ix-more">이전 대화 더 보기/); assert.match(moreHtml(5, true, tr), /disabled>불러오는 중/);
  // minimal: 본문 대신 안내
  assert.match(h({ k: 'user', src: 'human', text: '', hid: 1 }), /<p class="ix-hid">본문 숨김/);
});

test('§142 XSS: 사람·다른 세션 글·이름·별칭·알림·묶음 키·상태는 모두 글자로(Markdown 해석 없음, 줄바꿈 유지)', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>"\'&';
  const rows = [
    { k: 'user', src: 'human', text: evil + '\n**not bold**' },
    { k: 'peer', src: 'peer', who: evil, name: evil, text: evil },
    { k: 'peer', src: 'ix', alias: evil, text: evil },
    { k: 'mine', state: '"><script>', text: evil },
    { k: 'sys', key: '"><img src=x>', items: [{ sys: '"><b>', text: evil }] },
    { k: 'tool', tools: [evil] },
  ];
  for (const r of rows) {
    const html = rowHtml(r, ctx({ mineAlias: evil }));
    assert.ok(!/<(img|script)\b/i.test(html), html);
    assert.ok(!/\son\w+=/i.test(html.replace(/&[a-z#0-9]+;/gi, '')) || !/<[^>]*\son\w+=/i.test(html), html);
    assert.ok(!/<strong>/.test(html), '사람 글은 Markdown 아님');
    const tags = [...html.matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]);
    for (const tg of tags) assert.ok(['div', 'b', 'span', 'em', 'p', 'details', 'summary', 'ul', 'li'].includes(tg), tg);
  }
  assert.match(rowHtml(rows[0], ctx()), /<p class="ix-raw">&lt;img[^<]*\n\*\*not bold\*\*<\/p>/, '줄바꿈 그대로(CSS pre-wrap)');
  assert.match(rowHtml(rows[3], ctx()), /s-sent/, '모르는 상태는 고정 이름으로');
});

test('§142.6 3D 사용자 콘솔: 요약·리본 글리프가 출처를 보인다(터미널 = 나, Interactive = 나 · 별칭 ◇, 다른 세션 = ⇄ 이름)', () => {
  const t = (k) => ({ 'cards.ix.me': '나', 'cards.ix.peer': '다른 세션', 'cards.ix.midturn': '(끼어듦)' }[k] || k);
  assert.equal(userWho({ cat: 'user', op: 'prompt' }, t), '나');
  assert.equal(userWho({ cat: 'user', op: 'prompt', src: 'ix', who: 'big-star-parrot' }, t), '나 · big-star-parrot');
  assert.equal(userWho({ cat: 'user', op: 'prompt', src: 'peer', who: 'proj-loop-b8' }, t), '⇄ proj-loop-b8');
  assert.equal(userWho({ cat: 'user', op: 'prompt', src: 'peer' }, t), '⇄ 다른 세션');
  assert.equal(userGlyph({ src: 'ix' }), '◇ '); assert.equal(userGlyph({ src: 'peer' }), '⇄ '); assert.equal(userGlyph({}), '');
  assert.match(ixSummary({ v: 1, cat: 'user', op: 'prompt', src: 'ix', who: 'a-b-c', text: '안녕', phase: 'end' }), /a-b-c › 안녕/);
  assert.match(ixSummary({ v: 1, cat: 'user', op: 'midturn', src: 'peer', who: 'p1', text: '보고', phase: 'end' }), /^⇄ p1 › /);
});

test('§142.6 배선: 웹 전부(효과음·타임라인·사용자 콘솔 장부·앱 연출·실황 꼬리표)가 peer 를 사용자 입력으로, ix-core 는 보낸 세션 노드에서 빔', () => {
  const rd = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  assert.match(rd('sfx.mjs'), /ev\.origin === 'human' \|\| ev\.origin === 'peer' \? mk\('user', 0\)/);
  assert.match(rd('timeline.mjs'), /case 'user': return ev\.origin === 'human' \|\| ev\.origin === 'peer'/);
  assert.match(rd('user-core.mjs'), /ev\.origin === 'human' \|\| ev\.origin === 'peer'/);
  assert.match(rd('app.js'), /if \(ev\.origin === 'human' \|\| ev\.origin === 'peer'\)/);
  assert.match(rd('panel.js'), /ev\.origin === 'peer' \? t\('app\.panel\.tag\.peer'/);
  assert.match(rd('panel.js'), /ev\.ix\.src === 'ix' \|\| ev\.ix\.src === 'peer' \? userWho\(ev\.ix, t\)/);
  const core = rd('ix-core.mjs');
  assert.match(core, /ix\.src === 'peer' && ix\.from && env && env\.pos \? env\.pos\(ix\.from\)/);
  assert.match(core, /userGlyph\(ix\) \+ \(ix\.text\.length > 18/);
  const js = rd('interact.js');
  assert.match(js, /_loadMore\(\)/); assert.match(js, /addEventListener\('toggle'/); assert.match(js, /optgroup label/);
  for (const k of ['ix.src.human', 'ix.src.ix', 'ix.src.peer', 'ix.sys', 'ix.more', 'ix.session.headless', 'ix.why.headless', 'ix.hid', 'ix.mid']) { assert.ok(ix.en[k], k); assert.ok(ix.ko[k], k); }
});
