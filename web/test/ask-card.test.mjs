// 질문·계획 카드 HTML(web/ask-card.mjs): 대기·답함 표시, 추천 강조, 복수 선택, 미리보기 코드 블록, Interactive 선택·메시지 글, XSS, 배선
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderCard, answerText, togglePick, cardState, isRec, badgeHtml, answerPicks } from '../ask-card.mjs';
import { viewRows } from '../interact-core.mjs';
import { MD_TAGS } from '../markdown.mjs';

const T = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k); // 문구 대신 열쇠(언어와 무관하게 대조)
const CARD = { t: 'ask', qs: [
  { h: '배포', q: '배포 방식을 `어떻게` 할까요?', o: [{ l: '새 레포 (추천)', d: '깨끗하게' }, { l: '기존 레포', p: 'a ``` b\n<script>x</script>' }] },
  { h: '기능', q: '함께 넣을 것은?', multi: 1, o: [{ l: '하이라이트' }, { l: '연속 재생' }, { l: '설명' }] },
] };
const TAGS = new Set([...MD_TAGS, 'b', 'button', 'small', 'label', 'input', 'a']);
const ATTR_OK = /^(class|data-tu|data-q|data-o|role|tabindex|aria-pressed|type|disabled|href|target|rel|align|start|maxlength|placeholder)$/;
function assertSafe(html, label = '') {
  for (const m of html.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)>/g)) {
    assert.ok(TAGS.has(m[1].toLowerCase()), `${label} 태그 <${m[1]}>`);
    const rest = m[2].replace(/\s([a-zA-Z-]+)(?:="[^"]*")?/g, (all, name) => { assert.match(name, ATTR_OK, `${label} 속성 ${name} in ${m[0]}`); return ''; });
    assert.equal(rest.trim(), '', `${label} 속성 꼴 이상: ${m[0]}`); // 따옴표 밖 남은 글자 없음(속성 탈출 없음)
  }
  assert.doesNotMatch(html, /<script|<img|<svg|<iframe/i, label);
  assert.doesNotMatch((html.match(/<[^>]*>/g) || []).join('').replace(/"[^"]*"/g, '""'), /\son[a-z]+=|style=/i, label); // 태그 안(따옴표 값 밖)에만 의미가 있음
}

test('대기 중 카드: 머리표·질문(인라인 Markdown)·선택지·추천 강조·복수 선택·미리보기는 코드 블록', () => {
  const h = renderCard(CARD, null, { id: 'tu_1', t: T });
  assert.match(h, /^<div class="ask-card s-pending" data-tu="tu_1">/);
  assert.match(h, /ix\.card\.st\.pending/);
  assert.match(h, /<span class="ask-h">배포<\/span>/);
  assert.match(h, /<p class="ask-qt">배포 방식을 <code>어떻게<\/code> 할까요\?<\/p>/);
  assert.match(h, /<li class="ask-o rec"><span class="ask-mark">○<\/span><span class="ask-ol"><b>새 레포 \(추천\)<\/b><em class="ask-rec">ix\.card\.rec<\/em><small>깨끗하게<\/small>/);
  assert.match(h, /<span class="ask-multi">ix\.card\.multi<\/span>/);
  assert.match(h, /<span class="ask-mark">☐<\/span><span class="ask-ol"><b>하이라이트/);
  assert.match(h, /<div class="md ask-prev"><pre class="md-pre"><code>a ``` b\n&lt;script&gt;x&lt;\/script&gt;<\/code><\/pre><\/div>/); // 안의 ``` 보다 긴 펜스로 감쌈
  assert.match(h, /<\/div><p class="ask-hint ask-only">ix\.card\.terminal<\/p><div class="ask-q">/); // 머리 바로 아래(눈에 띄게)
  assert.doesNotMatch(h, /role="button"/); // 실황(보낼 수 없음)에서는 단추 아님
  assertSafe(h);
  assert.ok(isRec('A (Recommended)') && isRec('가 (권장)') && !isRec('추천 안 함'));
});

test('답한 카드: 고른 선택지 표시(단일 ●·복수 ☑)·직접 입력·메모·답 대신 메시지·거절·계획', () => {
  const res = { st: 'other', a: [{ q: 0, pick: [1] }, { q: 1, pick: [0, 2], other: '그리고 <b>요약</b>', notes: '메모 & 끝' }] };
  const h = renderCard(CARD, res, { id: 'tu_1', t: T });
  assert.match(h, /class="ask-card s-other"/);
  assert.match(h, /<li class="ask-o picked"><span class="ask-mark">●<\/span><span class="ask-ol"><b>기존 레포/);
  assert.match(h, /<li class="ask-o picked"><span class="ask-mark">☑<\/span><span class="ask-ol"><b>하이라이트/);
  assert.match(h, /<li class="ask-o"><span class="ask-mark">☐<\/span><span class="ask-ol"><b>연속 재생/);
  assert.match(h, /<b>ix\.card\.other<\/b> 그리고 &lt;b&gt;요약&lt;\/b&gt;/);
  assert.match(h, /<b>ix\.card\.notes<\/b> 메모 &amp; 끝/);
  assert.doesNotMatch(h, /ask-hint/);
  assertSafe(h);
  assert.equal(cardState(CARD, { st: 'declined', a: [] }), 'declined');
  assert.match(renderCard(CARD, { st: 'instead', a: [{ q: 0, pick: [], instead: 1 }] }, { t: T }), /ix\.card\.st\.instead/);
  const plan = { t: 'plan', md: '## 계획\n\n| a | b |\n|---|---|\n| 1 | <img src=x> |', cut: 1 };
  const ph = renderCard(plan, null, { t: T });
  assert.match(ph, /class="ask-card plan-card s-planPending"/);
  assert.match(ph, /<div class="md plan-md"><h4 class="md-h">계획<\/h4><div class="md-tablewrap">/);
  assert.match(ph, /ix\.card\.cut/);
  assertSafe(ph);
  assert.match(renderCard(plan, { st: 'rejected', fb: '먼저 <i>시험</i>' }, { t: T }), /s-rejected[\s\S]*<b>ix\.card\.fb<\/b> 먼저 &lt;i&gt;시험&lt;\/i&gt;/);
  assert.match(badgeHtml(plan, { st: 'approved', edited: 1 }, T), /s-approvedEdited/);
});

test('Interactive: 보낼 수 있으면 선택지가 단추, 단일은 하나만·복수는 토글, 고른 것만 일반 메시지 글로', () => {
  let pick = togglePick(CARD, null, 0, 0);
  pick = togglePick(CARD, pick, 0, 1); // 단일: 바꿈
  pick = togglePick(CARD, pick, 1, 2);
  pick = togglePick(CARD, pick, 1, 0);
  pick = togglePick(CARD, pick, 1, 2); // 복수: 다시 누르면 뺌
  assert.deepEqual([...pick.get(0)], [1]);
  assert.deepEqual([...pick.get(1)], [0]);
  assert.equal(togglePick(CARD, pick, 9, 0), pick);
  const h = renderCard(CARD, null, { id: 'tu_1', pick, canSend: true, t: T });
  assert.match(h, /<li class="ask-o picked" role="button" tabindex="0" aria-pressed="true" data-q="0" data-o="1">/);
  assert.match(h, /<p class="ask-hint">ix\.card\.ixNote<\/p><div class="ask-btns"><button type="button" class="ask-send">ix\.card\.send<\/button><\/div>/);
  assert.match(h, /ask-only">ix\.card\.terminal/); // Interactive 카드에도 맨 위 안내
  assert.match(renderCard(CARD, null, { id: 'tu_1', pick: new Map(), canSend: true, t: T }), /class="ask-send" disabled/);
  assert.doesNotMatch(renderCard(CARD, { st: 'answered', a: [] }, { pick, canSend: true, t: T }), /role="button"|ask-send/); // 답한 뒤엔 단추 없음
  assert.equal(answerText(CARD, pick, T), 'ix.card.msg:{"q":"배포","a":"기존 레포"}\nix.card.msg:{"q":"기능","a":"하이라이트"}');
  assert.equal(answerText(CARD, new Map(), T), '');
  assertSafe(h);
});

test('viewRows: ask 줄에 결과를 붙이고, 시작 줄이 없으면 결과만으로 한 줄', () => {
  const { rows } = viewRows([
    { k: 'assistant', ts: 1, text: '여쭙니다' }, { k: 'ask', ts: 2, id: 'q1', card: CARD }, { k: 'tool', ts: 3, tools: ['Bash'] },
    { k: 'ask-res', ts: 4, id: 'q1', card: CARD, res: { st: 'answered', a: [{ q: 0, pick: [0] }] } }, { k: 'ask-res', ts: 5, id: 'q9', card: CARD, res: { st: 'declined', a: [] } },
  ], []);
  assert.deepEqual(rows.map((r) => r.k), ['assistant', 'ask', 'tool', 'ask']);
  assert.equal(rows[1].res.st, 'answered');
  assert.equal(rows[3].id, 'q9');
});

test('XSS: 질문·라벨·설명·미리보기·직접 입력·계획·id 의 태그·속성 탈출은 글자', () => {
  const evil = '"><img src=x onerror=alert(1)><script>alert(1)</script>';
  const card = { t: 'ask', qs: [{ h: evil, q: evil + ' [x](javascript:alert(1))', multi: 1, o: [{ l: evil, d: evil, p: evil + '\n```\n' + evil }] }] };
  const res = { st: 'other', a: [{ q: 0, pick: [0], other: evil, notes: evil }] };
  for (const h of [renderCard(card, null, { id: evil, t: T }), renderCard(card, res, { id: evil, t: T }), renderCard(card, null, { id: 'x', canSend: true, pick: new Map([[0, new Set([0])]]), t: T }),
    renderCard({ t: 'plan', md: evil + '\n\n```\n' + evil }, { st: 'rejected', fb: evil }, { id: evil, t: T })]) assertSafe(h, h.slice(0, 80));
  assert.equal(renderCard(null), '');
  assert.equal(renderCard({ t: 'other' }), '');
});

test('배선: 실황은 시작·끝 줄에 카드·대기 카드 표지 갱신, Interactive 는 ask 줄·선택·보내기, CSS·문구', () => {
  const pn = readFileSync(new URL('../panel.js', import.meta.url), 'utf8');
  assert.match(pn, /if \(ev\.card\) msg \+= renderCard\(ev\.card, null, \{ id: ev\.toolUseId, live: true \}\)/);
  assert.match(pn, /if \(ev\.card && ev\.cardRes\) msg \+= renderCard\(ev\.card, ev\.cardRes/);
  assert.match(pn, /querySelectorAll\('\.ask-card\.s-pending, \.ask-card\.s-planPending'\)/);
  const ix = readFileSync(new URL('../interact.js', import.meta.url), 'utf8');
  const iv = readFileSync(new URL('../interact-view.mjs', import.meta.url), 'utf8'); // 줄 그리기는 순수 모듈
  assert.match(iv, /const pick = r\.id && ctx\.picks \? ctx\.picks\.get\(r\.id\) : null;/);
  assert.match(iv, /renderCard\(r\.card, r\.res, \{ id: r\.id, pick, canSend: !!ctx\.canSend && !r\.res && !!r\.id, sent: /);
  assert.match(ix, /picks: this\.picks, asked: this\.askSent, canSend: this\._can, cards: this\._cards/);
  assert.match(ix, /const text = answerText\(this\._cards\.get\(id\), this\.picks\.get\(id\), t, this\.others\.get\(id\)\);\n\s+if \(!text\) return;/); // 선택은 고르기만 — 보내기는 이 단추를 눌렀을 때만, 누른 즉시 askSent 표시
  assert.match(ix, /this\.askSent\.set\(id, \{ state: 'sending' \}\)/);
  assert.match(ix, /this\.askSent\.delete\(id\); \/\/ 고르기를 바꾸면/);
  assert.doesNotMatch(ix.slice(ix.indexOf('const pickAt'), ix.indexOf('this.feed.addEventListener(\'click\'')), /_send\(/, '선택만으로는 보내지 않음');
  assert.match(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /href="ask-card\.css"/);
  const i18n = readFileSync(new URL('../i18n/ix.mjs', import.meta.url), 'utf8');
  for (const k of ['ix.card.ixNote', 'ix.card.send', 'ix.card.terminal', 'ix.card.st.pending', 'ix.card.st.instead']) assert.equal(i18n.split(`'${k}'`).length - 1, 2, k);
  assert.match(i18n, /'ix\.card\.ixNote': '[^']*does not answer the box/); // 오해 없게: 선택 창의 답이 아님
  assert.match(i18n, /'ix\.card\.ixNote': '[^']*선택 창의 답이 되지는 않습니다/);
  assert.match(i18n, /'ix\.card\.send': '메시지로 남기기\(질문 창엔 답이 안 됨\)'/); // 결과가 분명한 단추 문구
  assert.match(i18n, /'ix\.card\.terminal': '이 질문은 그 세션의 터미널·Claude 앱 원격 세션에서만 답할 수 있습니다\.'/);
});

test('§145 보내기 단추: 고른 게 있어야 켜짐 · 누른 뒤에만 보냄 상태(보내는 중·대기열·실패 이유) · 선택만으로는 표시 없음', () => {
  const base = { id: 'tu1', t: T, canSend: true };
  const none = renderCard(CARD, null, { ...base });
  assert.match(none, /class="ask-send" disabled/); assert.ok(!none.includes('ask-sentst'));
  const pick = new Map([[0, new Set([0])]]);
  const ready = renderCard(CARD, null, { ...base, pick });
  assert.ok(!/class="ask-send" disabled/.test(ready)); assert.ok(!ready.includes('ask-sentst'));
  const sending = renderCard(CARD, null, { ...base, pick, sent: { state: 'sending' } });
  assert.match(sending, /st-sending[^>]*>ix\.st\.sending/); assert.match(sending, /class="ask-send" disabled/);
  assert.match(renderCard(CARD, null, { ...base, pick, sent: { state: 'sent' } }), /st-sent[^>]*>ix\.st\.sentAsk/);
  assert.match(renderCard(CARD, null, { ...base, pick, sent: { state: 'failed', why: 'pending' } }), /st-failed[^>]*>ix\.st\.failed:.*ix\.why\.pending/);
});

test('§148 질문창에 답하기(rc): 주 단추·모든 질문 답해야 켜짐·답함 상태·「Claude 앱에서 답하기」 링크(claude.ai 세션 꼴만)·기타(직접 입력)', () => {
  const link = 'https://claude.ai/code/' + 'session_TESTabc123';
  const one = new Map([[0, new Set([1])]]);
  const both = new Map([[0, new Set([1])], [1, new Set([0, 2])]]);
  const half = renderCard(CARD, null, { id: 'tu1', t: T, canSend: true, rc: true, link, pick: one, complete: answerPicks(CARD, one).complete });
  assert.match(half, /ask-only">ix\.card\.rcOnly/);
  assert.match(half, /<p class="ask-hint">ix\.card\.rcNote<\/p>/);
  assert.match(half, /<button type="button" class="ask-answer" disabled>ix\.card\.answer<\/button>/); // 둘째 질문 답 없음
  assert.match(half, new RegExp(`<a class="ask-app" href="${link}" target="_blank" rel="noopener noreferrer">ix\.card\.app</a>`));
  assert.ok(!half.includes('ask-send'), 'rc 면 메시지 단추 대신 질문창 답 단추');
  assert.equal((half.match(/class="ask-other"/g) || []).length, 2); // 질문마다 기타 칸, 값은 HTML 에 넣지 않음
  assert.ok(!/value=/.test(half));
  const full = renderCard(CARD, null, { id: 'tu1', t: T, canSend: true, rc: true, link, pick: both, complete: answerPicks(CARD, both).complete });
  assert.match(full, /<button type="button" class="ask-answer">ix\.card\.answer<\/button>/);
  const done = renderCard(CARD, null, { id: 'tu1', t: T, canSend: true, rc: true, link, pick: both, complete: true, sent: { state: 'answered' } });
  assert.match(done, /ask-sentst st-answered" role="status">ix\.st\.answeredBox/);
  assert.match(done, /class="ask-answer" disabled/); // 답한 뒤 다시 못 누름
  const failed = renderCard(CARD, null, { id: 'tu1', t: T, canSend: true, rc: true, link, pick: both, complete: true, sent: { state: 'failed', why: 'not_pending' } });
  assert.match(failed, /ix\.st\.failed:\{&quot;why&quot;:&quot;ix\.why\.not_pending&quot;\}/);
  assert.match(failed, /class="ask-app"/); // 실패해도 앱 링크로
  // 링크는 Claude 앱 세션 주소 꼴만(다른 주소·javascript: 는 버림)
  for (const bad of ['javascript:alert(1)', 'https://evil.example/code/session_x', 'https://claude.ai/code/' + 'session_x"><b>']) assert.ok(!renderCard(CARD, null, { id: 'tu1', t: T, canSend: true, rc: true, link: bad }).includes('ask-app'), bad);
  // 보낼 수 없는(승인 안 된) 화면에도 대기 중이면 링크만
  assert.match(renderCard(CARD, null, { id: 'tu1', t: T, link }), /<div class="ask-ix"><div class="ask-btns"><a class="ask-app"/);
  assert.ok(!renderCard(CARD, { st: 'answered', a: [] }, { id: 'tu1', t: T, link }).includes('ask-app'), '답한 뒤엔 링크 없음');
});

test('§148 answerPicks·answerText: 단일은 하나·복수는 여럿·기타(직접 입력)·모두 답해야 complete', () => {
  const pick = new Map([[0, new Set([1, 0])], [1, new Set([2, 0])]]);
  assert.deepEqual(answerPicks(CARD, pick), { picks: [{ q: 0, o: [0] }, { q: 1, o: [0, 2] }], complete: true });
  const others = new Map([[1, '  직접 쓴 답 ']]);
  assert.deepEqual(answerPicks(CARD, new Map([[0, new Set([1])]]), others), { picks: [{ q: 0, o: [1] }, { q: 1, o: [], other: '직접 쓴 답' }], complete: true });
  assert.equal(answerPicks(CARD, new Map([[0, new Set([1])]])).complete, false);
  assert.equal(answerPicks({ t: 'plan' }, pick).complete, false);
  assert.equal(answerText(CARD, new Map([[0, new Set([1])]]), T, others), 'ix.card.msg:{"q":"배포","a":"기존 레포"}\nix.card.msg:{"q":"기능","a":"직접 쓴 답"}');
});

test('§148 배선: 화면은 /interact/ask 로 picks 를 보내고, 기타 칸은 다시 그려도 값·포커스를 되살린다', () => {
  const ix = readFileSync(new URL('../interact.js', import.meta.url), 'utf8');
  assert.match(ix, /this\._post\('ask', \{ session: sid, toolUseId: id, picks \}\)/);
  assert.match(ix, /others: this\.others, rc: !!\(tg && tg\.remote\), link: \(tg && tg\.remote\) \|\| null/);
  assert.match(ix, /inp\.focus\(\); try \{ inp\.setSelectionRange/);
  assert.match(ix, /'no_rc', 'no_auth', 'auth', 'not_pending'/);
  const i18n = readFileSync(new URL('../i18n/ix.mjs', import.meta.url), 'utf8');
  for (const k of ['ix.card.rcOnly', 'ix.card.rcNote', 'ix.card.answer', 'ix.card.app', 'ix.card.otherIn', 'ix.card.otherPh', 'ix.st.answeredBox', 'ix.why.no_rc', 'ix.why.no_auth', 'ix.why.auth', 'ix.why.not_pending', 'ix.why.incomplete', 'ix.why.stream', 'ix.why.network', 'ix.why.post'])
    assert.equal(i18n.split(`'${k}'`).length - 1, 2, k);
  assert.match(i18n, /'ix\.card\.app': 'Claude 앱에서 답하기 ↗'/);
  assert.match(i18n, /'ix\.card\.answer': '질문창에 답하기'/);
  assert.match(i18n, /'ix\.st\.answeredBox': '질문창에 답함 ✓'/);
});
