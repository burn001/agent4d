// — Interactive·실황 남은 한계 처리(웹 쪽 시험). 서버 쪽은 server/test/*.test.mjs 각 파일.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ix from '../i18n/ix.mjs';
import { CONFIRM_MS } from '../interact-core.mjs';

const rd = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('§143.1 -p 확인 안 됨: 목록 표시 · 첫 누름은 확인 단계 · 두 번째에 confirm:true · 409 unverified 면 확인 단계로 · 질문 카드 고른 것 유지', () => {
  assert.equal(CONFIRM_MS, 10_000);
  const js = rd('interact.js');
  assert.match(js, /s\.unverified && !s\.headless \? ` \$\{t\('ix\.session\.unverified'\)\}`/);
  assert.match(js, /if \(why\.length && !this\._armed\(sid\)\) \{ this\._arm\(sid, text, why\); return 'armed'; \}/);
  assert.match(js, /\.\.\.\(target && target\.unverified \? \['unverified'\] : \[\]\)/);
  assert.match(js, /const confirm = !!\(target && target\.unverified\);/);
  assert.match(js, /confirm \? \{ session: sid, text, confirm: true \} : \{ session: sid, text \}/);
  assert.match(js, /status === 409 && j\.error === 'unverified'/);
  assert.match(js, /if \(r === 'armed'\) this\.askSent\.delete\(id\)/); // 확인 단계면 고른 것을 남김
  assert.match(js, /this\.btn\.classList\.toggle\('ix-confirm', armed\)/);
  assert.match(rd('interact.css'), /\.ix-form button\.ix-confirm/);
  for (const k of ['ix.session.unverified', 'ix.note.unverified', 'ix.send.confirm', 'ix.why.unverified']) { assert.ok(ix.en[k], k); assert.ok(ix.ko[k], k); }
});

test('§143.3 슬래시 명령: 내장(클라이언트 전용) 명령만 보내기 보류 + 안내, 스킬·플러그인 명령은 그대로 보내고 꼬리표', async () => {
  const { slashKind, isSlashCommand, CC_BUILTIN_CMDS } = await import('../interact-core.mjs');
  for (const c of ['clear', 'compact', 'model', 'config', 'resume', 'exit', 'quit', 'cost', 'context', 'permissions', 'login', 'logout', 'status', 'help', 'memory', 'init', 'agents', 'hooks', 'mcp', 'ide', 'vim', 'theme', 'terminal-setup', 'doctor', 'bug', 'review', 'remote-control', 'rc', 'new', 'reset', 'settings']) assert.ok(CC_BUILTIN_CMDS.has(c), c);
  assert.equal(slashKind('/clear'), 'builtin'); assert.equal(slashKind('  /Compact 요약만'), 'builtin'); assert.equal(slashKind('/model opus'), 'builtin');
  assert.equal(slashKind('/done'), 'skill', '스킬은 받은 세션이 Skill 도구로 실행'); assert.equal(slashKind('/agent4d:open'), 'skill'); assert.equal(slashKind('/codex:review'), 'skill');
  assert.equal(slashKind('/ 그냥 글'), null); assert.equal(slashKind('경로 /clear'), null); assert.equal(slashKind('/clear/x'), null); assert.equal(slashKind(''), null);
  assert.equal(isSlashCommand('/exit'), true); assert.equal(isSlashCommand('/done'), false);
  const js = rd('interact.js');
  assert.match(js, /const needConfirm = \(text, target\) => \[\.\.\.\(isSlashCommand\(text\) \? \['slash'\] : \[\]\)/);
  assert.match(js, /if \(why\.length && !this\._armed\(sid\)\) \{ this\._arm\(sid, text, why\); return 'armed'; \}/);
  assert.match(js, /why\.includes\('slash'\) \? 'ix\.send\.asText'/);
  assert.match(js, /slashKind\(this\.ta\.value\) === 'skill'/);
  assert.match(js, /<div class="ix-warn" role="alert" hidden><\/div>\s*<form class="ix-form"/, '입력창 바로 위');
  assert.match(js, /this\.warn\.textContent = wt/, '안내는 글자로만(innerHTML 아님)');
  for (const k of ['ix.send.asText', 'ix.warn.slash', 'ix.hint.skill']) { assert.ok(ix.en[k], k); assert.ok(ix.ko[k], k); }
  assert.match(ix.ko['ix.warn.slash'], /슬래시 명령이 실행되지 않습니다/);
  assert.match(rd('interact.css'), /\.ix-warn \{/);
});

test('§143.4 복셀 의뢰인 창구 출처별 연출: 카드에 출처·보낸 세션·첫 몇 단어, 리본 글 ◇/⇄, 리본 수명, 비행 경로, 3D·2D 배선', async () => {
  const { clientOp, ClientDesk, CLIENT, cardLabel, cardGlyph, cardPath } = await import('../voxel/client-core.mjs');
  const isMain = () => true;
  const ev = (ix) => ({ type: 'user', nodeId: 's:m', ix: { cat: 'user', ...ix } });
  assert.deepEqual(clientOp(ev({ op: 'prompt', text: '터미널 글' }), isMain), { op: 'request', lead: 's:m', src: null, from: null, text: '터미널 글' });
  assert.deepEqual(clientOp(ev({ op: 'prompt', src: 'ix', who: 'big-star-parrot', text: '패널  글' }), isMain), { op: 'request', lead: 's:m', src: 'ix', from: null, text: '패널 글' });
  assert.deepEqual(clientOp(ev({ op: 'midturn', src: 'peer', from: 's:x', text: '보고' }), isMain), { op: 'memo', lead: 's:m', mid: true, src: 'peer', from: 's:x', text: '보고' });
  assert.equal(clientOp(ev({ op: 'prompt', src: 'ix', from: 's:x' }), isMain).from, null, 'Interactive 는 보낸 세션 노드가 없음(콘솔에서)');
  assert.equal(cardGlyph({ src: 'ix' }), '◇ '); assert.equal(cardGlyph({ src: 'peer' }), '⇄ '); assert.equal(cardGlyph({}), '');
  assert.equal(cardLabel({ src: 'peer', text: '가나다라마바사아자차카타파하가나다라마' }), '⇄ 가나다라마바사아자차카타파하가나다…');
  assert.equal(cardLabel({ src: 'ix', text: null }), '◇'); assert.equal(cardLabel({ text: null }), null); assert.equal(cardLabel({ text: '짧음' }), '짧음');
  const d = new ClientDesk();
  d.apply(clientOp(ev({ op: 'prompt', src: 'peer', from: 's:x', text: '보고' }), isMain), 10);
  assert.equal(d.liveCards(10.5).length, 1); assert.equal(d.liveTags(10.5)[0].from, 's:x');
  assert.equal(d.liveCards(10 + CLIENT.CARD_DUR + 0.1).length, 0, '카드는 날아가는 동안만');
  assert.equal(d.liveTags(10 + CLIENT.CARD_DUR + 0.1).length, 1, '리본 글은 닿은 뒤 잠깐 더');
  assert.equal(d.liveTags(10 + CLIENT.CARD_DUR + CLIENT.TAG_HOLD + 0.01).length, 0);
  const p0 = cardPath({ x: 0, y: 2, z: 0 }, { x: 4, y: 1, z: 2 }, 0), p1 = cardPath({ x: 0, y: 2, z: 0 }, { x: 4, y: 1, z: 2 }, 3);
  assert.deepEqual([p0.x, p0.y, p0.z], [0, 2, 0]); assert.deepEqual([p1.x, Math.round(p1.y * 1e6) / 1e6, p1.z], [4, 1, 2], '넘으면 도착 자리');
  const v3 = rd('voxel/vx-client.js');
  assert.match(v3, /c\.src !== 'peer' \|\| !c\.from \|\| c\.from === r0\.ownerId\) return a0/);
  assert.match(v3, /v\._isDim && v\._isDim\(c\.from\)/, '보낸 세션이 이 화면에서 흐리면 스크린에서');
  assert.match(v3, /T\.el\.textContent = text/, '리본 글은 글자로만');
  assert.match(v3, /for \(const c of d\.liveTags\(now\)\)/);
  const v2 = rd('flat/vx2d-extra.js');
  assert.match(v2, /c\.src !== 'peer' \|\| !c\.from \|\| c\.from === r\.ownerId\) return sc/);
  assert.match(v2, /for \(const c of d\.liveTags\(now\)\)/);
  assert.match(v2, /ctx\.fillText\(lab, x, y \+ 0\.5, 210\)/);
  assert.match(rd('voxel/voxel.css'), /\.vx-card-tag \{/);
});

test('§143.5 각주 왕복 링크: 범위 id(메시지별 접두)일 때만, href 는 # + 안전한 id 뿐, 같은 각주 여러 번 참조도 id 겹침 없음, XSS', async () => {
  const { renderMarkdown, fnPrefix, MD_FN_ID } = await import('../markdown.mjs');
  const src = '가[^a] 나[^b] 다[^a]\n\n[^a]: 첫 **굵게**\n[^b]: 둘\n[^c]: 안 쓴 각주';
  const h = renderMarkdown(src, { scope: 'ix123' });
  assert.match(h, /<sup class="md-fnref" id="mdfn-ix123-r1"><a class="md-fn" href="#mdfn-ix123-f1">1<\/a><\/sup>/);
  assert.match(h, /id="mdfn-ix123-r1-2"/, '두 번째 참조는 따로');
  assert.match(h, /<li id="mdfn-ix123-f1">첫 <strong>굵게<\/strong> <a class="md-fnback" href="#mdfn-ix123-r1"/);
  assert.match(h, /<li id="mdfn-ix123-f3">안 쓴 각주<\/li>/, '참조 안 된 각주는 되돌아가기 없음');
  const ids = [...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'id 겹침 없음');
  for (const id of ids) assert.match(id, MD_FN_ID);
  for (const m of h.matchAll(/href="([^"]*)"/g)) assert.match(m[1], /^#mdfn-ix123-[rf]\d+$/);
  assert.notEqual(renderMarkdown(src, { scope: 'lv1' }), renderMarkdown(src, { scope: 'lv2' }), '메시지마다 다른 id');
  assert.doesNotMatch(renderMarkdown(src), /id=|href=/, '범위가 없으면 예전처럼 번호만');
  // 나쁜 범위 이름은 링크 없음(속성 탈출 불가)
  for (const bad of ['"><script>', 'a b', 'x'.repeat(41), '../x', 'ü', '']) assert.equal(fnPrefix(bad), null, bad);
  assert.doesNotMatch(renderMarkdown(src, { scope: '"><img src=x onerror=alert(1)>' }), /<img|onerror|id=/);
  // 각주 이름·내용의 태그는 글자로, 속성 화이트리스트
  const x = renderMarkdown('본문[^<b>x</b>] [^"onmouseover=1]\n\n[^<b>x</b>]: <script>alert(1)</script>\n["onmouseover=1]: y', { scope: 'm1' });
  assert.doesNotMatch(x, /<script|<b>|onmouseover="/);
  const ATTR = { a: ['href', 'class', 'aria-label', 'target', 'rel'], sup: ['class', 'id'], li: ['id'], ol: ['class', 'start'] };
  for (const m of h.matchAll(/<([a-z0-9]+)((?:\s[^>]*)?)>/g)) for (const a of m[2].matchAll(/\s([a-zA-Z-]+)=/g)) assert.ok((ATTR[m[1]] || ['class']).includes(a[1]), `${m[1]}.${a[1]}`);
  // 배선: Interactive = 바이트 위치(다시 그려도 같은 HTML), 실황 = 응답마다 번호, 누름 처리는 주소창을 바꾸지 않음
  assert.match(rd('interact-view.mjs'), /const scope = Number\.isFinite\(r\.o\) \? 'ix' \+ r\.o : null;/);
  assert.match(rd('panel.js'), /renderMarkdown\(ev\.md, \{ scope: 'lv' \+ \(\+\+_mdN\) \}\)/);
  const ml = rd('md-links.js');
  assert.match(ml, /if \(!MD_FN_ID\.test\(id\)\) return;\s*e\.preventDefault\(\); e\.stopPropagation\(\)/);
  assert.match(ml, /scrollIntoView/); assert.doesNotMatch(ml, /location\.hash\s*=/);
  assert.match(rd('panel.js'), /import '\.\/md-links\.js'/); assert.match(rd('interact.js'), /import '\.\/md-links\.js'/);
});

test('§143.6 잘린 응답 전체 보기: Interactive(cut → 단추, 받은 원문으로 다시 그림) · 실황(mdRef → 단추, 보기 토큰 쿠키로 /md/full) · 이스케이프', async () => {
  const { assistantBody } = await import('../interact-view.mjs');
  const t = (k) => ({ 'ix.full': '전체 보기', 'ix.full.loading': '불러오는 중', 'ix.full.fail': '실패', 'ix.full.cut': '10만 자까지' }[k] || k);
  const r = { k: 'assistant', o: 120, cut: 1, text: '앞부분 **굵게**…' };
  assert.match(assistantBody(r, { full: new Map() }, t), /<button type="button" class="ix-full" data-o="120">전체 보기<\/button>/);
  assert.match(assistantBody(r, { full: new Map([[120, 'loading']]) }, t), /data-o="120" disabled>불러오는 중/);
  assert.match(assistantBody(r, { full: new Map([[120, 'fail']]) }, t), />실패</);
  const done = assistantBody(r, { full: new Map([[120, { md: '# 전체\n<script>x</script>', cut: true }]]) }, t);
  assert.match(done, /<h3 class="md-h">전체<\/h3>/); assert.doesNotMatch(done, /<script|ix-full/); assert.match(done, /10만 자까지/);
  assert.doesNotMatch(assistantBody({ ...r, cut: 0 }, {}, t), /ix-full/, '잘리지 않으면 단추 없음');
  assert.doesNotMatch(assistantBody({ ...r, o: '1" onclick="x' }, {}, t), /onclick|ix-full/, 'o 는 숫자일 때만');
  const pn = rd('panel.js');
  assert.match(pn, /\$\{escapeHtml\(t\('app\.panel\.mdCut'\)\)\}\$\{fullBtn\(ev\.mdRef\)\}/);
  assert.match(pn, /data-s="\$\{escapeHtml\(r\.s\)\}" data-u="\$\{escapeHtml\(r\.u\)\}" data-b="\$\{r\.b\}"/);
  assert.match(pn, /Number\.isInteger\(r\.b\)/);
  assert.match(pn, /fetch\(`md\/full\?\$\{q\}`, \{ credentials: 'same-origin', cache: 'no-store' \}\)/);
  assert.match(pn, /box\.innerHTML = renderMarkdown\(j\.md, \{ scope: 'lv' \+ \(\+\+_mdN\) \}\)/, '받은 원문도 같은 렌더러(§138 보안 규칙)');
  const js = rd('interact.js');
  assert.match(js, /this\._post\('full', \{ session: sid, o \}\)/); assert.match(js, /full: this\.full/);
  const app = (await import('../i18n/app.mjs')).default;
  for (const k of ['app.panel.mdFull', 'app.panel.mdFullLoading', 'app.panel.mdFullFail', 'app.panel.mdFullCut']) { assert.ok(app.en[k], k); assert.ok(app.ko[k], k); }
  for (const k of ['ix.full', 'ix.full.loading', 'ix.full.fail', 'ix.full.cut']) { assert.ok(ix.en[k], k); assert.ok(ix.ko[k], k); }
});

test('§143.8 휴대폰 키보드 폴백: visualViewport 가 없으면 방향별 최대 창 높이와 비교(입력 초점일 때만) · 초점 들고 날 때 짧은 폴링', async () => {
  const { keyboardFallback, keyboardInset, KB_POLL } = await import('../panel-size.mjs');
  assert.equal(keyboardFallback(844, 520, true), 324);
  assert.equal(keyboardFallback(844, 520, false), 0, '초점이 없으면 0(창 크기 바뀜은 키보드가 아님)');
  assert.equal(keyboardFallback(844, 790, true), 0, '100px 미만 = 주소창');
  assert.equal(keyboardFallback(NaN, 500, true), 0);
  assert.equal(keyboardInset(844, 520, 0), 324, '기존 식 그대로');
  assert.ok(KB_POLL.MS * KB_POLL.N <= 2000);
  const js = rd('panel-resize.js');
  assert.match(js, /vv \? keyboardInset\(innerHeight, vv\.height, vv\.offsetTop\) : keyboardFallback\(baseH\[ori\], innerHeight, editing\(\)\)/);
  assert.match(js, /document\.addEventListener\('focusin', burst\); document\.addEventListener\('focusout', burst\);/);
  assert.match(js, /\(vv \? k : 0\) \+ 'px'/, '폴백(창이 이미 줄어듦)에서는 패널을 더 올리지 않음');
});
