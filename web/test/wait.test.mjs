// 입력 대기 배지(web/wait-core.mjs 순수 · wait-ui.js 배선) + 선택 창이 열린 동안 보낸 글의 상태(interact-core viewRows)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nodeWaits, mergeWaits, newWaits, waitKey, ageText, waitHead, waitName, recordWait, askHead } from '../wait-core.mjs';
import { viewRows, localState } from '../interact-core.mjs';
import ix from '../i18n/ix.mjs';

const T = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);
const NOW = Date.parse('2026-11-05T06:00:00Z');
const main = (sid, extra = {}) => ({ id: `s:${sid}`, kind: 'main', sessionId: sid, status: 'active', label: '세션 ' + sid.slice(0, 4), meta: { cwd: 'D:\\work\\proj-' + sid.slice(0, 2) }, openTools: [], ...extra });
const ask = (tu, at, ah = { t: 'ask', h: '방식', q: '어느 쪽?' }) => ({ toolUseId: tu, tool: 'AskUserQuestion', startedAt: new Date(at).toISOString(), ask: ah });
const S1 = 'aaaaaaaa-0000-4000-8000-000000000001', S2 = 'bbbbbbbb-0000-4000-8000-000000000002', S3 = 'cccccccc-0000-4000-8000-000000000003', S4 = 'dddddddd-0000-4000-8000-000000000004';

test('nodeWaits: 메인 노드의 답 없는 AskUserQuestion·ExitPlanMode · 루트 meta.liveWait, 제외(서브에이전트·-p 자식·독립 sdk·끝남·live 아님·재생)', () => {
  const nodes = [
    main(S1, { openTools: [{ toolUseId: 'b', tool: 'Bash', startedAt: new Date(NOW).toISOString() }, ask('tu1', NOW - 120_000)] }),
    main(S2, { openTools: [{ toolUseId: 'p1', tool: 'ExitPlanMode', startedAt: new Date(NOW - 5000).toISOString(), ask: { t: 'plan' } }] }),
    main(S3, { meta: { liveWait: 'input needed', cwd: 'D:\\x\\y' } }),
    main(S4, { meta: { liveWait: 'dialog open' } }), // 채택 안 함
    { id: 'a1', kind: 'subagent', sessionId: S1, openTools: [ask('tu9', NOW)] },
    { id: 's:eeee', kind: 'claude-p', sessionId: 'eeee', openTools: [ask('tu8', NOW)] },
    main('ffffffff-0000-4000-8000-00000000000f', { meta: { orphanSdk: true }, openTools: [ask('tu7', NOW)] }),
    main('99999999-0000-4000-8000-000000000009', { status: 'done', openTools: [ask('tu6', NOW)] }),
    main('88888888-0000-4000-8000-000000000008', { meta: { live: false }, openTools: [ask('tu5', NOW)] }),
  ];
  const w = nodeWaits(nodes);
  assert.deepEqual(w.map((x) => [x.sid, x.k, x.tu || x.why]), [[S1, 'ask', 'tu1'], [S2, 'plan', 'p1'], [S3, 'ask', 'input needed']]);
  assert.equal(w[0].project, 'proj-aa');
  assert.equal(w[0].since, NOW - 120_000);
  assert.deepEqual(nodeWaits(nodes, { replaying: true }), []);
});

test('mergeWaits: 서버 목록(승인 기기)이 있으면 목록 밖·헤드리스 세션은 버리고, 세션 기록만으로 대기인 세션을 더함 · 이름·ready · 정렬(강한 신호 → 오래 기다린 순)', () => {
  const nw = nodeWaits([main(S1, { openTools: [ask('tu1', NOW - 10_000)] }), main(S2, { openTools: [ask('tu2', NOW - 90_000)] }), main(S3, { openTools: [ask('tu3', NOW)] })]);
  assert.equal(mergeWaits(nw, null).length, 3); // 서버 목록 없음 = 화면 신호만
  const sessions = [
    { sessionId: S1, name: 'w-1', project: 'p1', ready: true },
    { sessionId: S2, name: 'w-2', project: 'p2', ready: true, headless: true }, // -p 회차로 확인됨 → 제외
    // S3 없음(끝났거나 범위 밖) → 제외
    { sessionId: S4, name: 'w-4', project: 'p4', ready: true, wait: { k: 'other', why: 'sandbox request', since: NOW - 500_000 } },
    { sessionId: 'eeeeeeee-0000-4000-8000-00000000000e', name: 'w-5', ready: true, waitingFor: 'input needed', statusAt: NOW - 1000 },
  ];
  const m = mergeWaits(nw, sessions);
  assert.deepEqual(m.map((x) => x.k), ['ask', 'ask', 'other']);
  assert.deepEqual(m.map((x) => x.sid.slice(0, 4)), ['aaaa', 'eeee', 'dddd']); // 강한 신호(오래 기다린 aaaa 먼저) → 보조
  assert.equal(m[0].name, 'w-1');
  assert.equal(m[0].ready, true);
  assert.equal(m[2].nodeId, `s:${S4}`);
  assert.equal(recordWait({ waitingFor: 'input needed', headless: true }), null);
});

test('newWaits·waitKey·글자: 새 대기만 깜빡임, 대기 시간·머리표·이름', () => {
  const a = [{ sid: S1, k: 'ask', tu: 'tu1' }];
  const r1 = newWaits(a, new Set());
  assert.equal(r1.fresh, true);
  assert.equal(newWaits(a, r1.keys).fresh, false);
  assert.equal(newWaits([...a, { sid: S2, k: 'ask', tu: 'tu2' }], r1.keys).fresh, true);
  assert.equal(waitKey(a[0]), `${S1}:tu1`);
  assert.equal(ageText(NOW - 10_000, NOW, T), 'ix.wait.age.now');
  assert.equal(ageText(NOW - 185_000, NOW, T), 'ix.wait.age.min:{"n":3}');
  assert.equal(ageText(NOW - 7_300_000, NOW, T), 'ix.wait.age.hour:{"n":2}');
  assert.equal(ageText(null, NOW, T), '');
  assert.equal(waitHead({ k: 'ask', ask: { t: 'ask', h: '방식', q: '어느 쪽?', n: 3 } }, T), '[방식] 어느 쪽? (+2)');
  assert.equal(waitHead({ k: 'plan' }, T), 'ix.wait.plan');
  assert.equal(waitHead({ k: 'other', why: 'sandbox request' }, T), 'ix.wait.why:{"why":"sandbox request"}');
  assert.equal(waitHead({ k: 'ask' }, T), 'ix.wait.ask');
  assert.equal(waitName({ sid: S1, name: null, label: null }), 'aaaaaaaa');
  assert.deepEqual(askHead({ t: 'ask', qs: [{ h: 'h', q: ' a\n b ' }] }), { t: 'ask', h: 'h', q: 'a b' });
});

test('viewRows §144: 선택 창이 열린 동안 보낸 글 = sentAsk → 대기열 도착(enq) = queuedAsk → 답한 뒤 = queued → peer 줄이 오면 전달됨, 새로 열어도 enq 로 대기열 줄', () => {
  const card = { t: 'ask', qs: [{ h: '방식', q: '어느 쪽?', o: [{ l: 'A' }, { l: 'B' }] }] };
  const items = [{ k: 'assistant', ts: 1, text: '여쭙니다' }, { k: 'ask', ts: 2, id: 'q1', card }];
  const local = [{ lid: 'l1', at: NOW - 5000, text: '[질문에 대한 답] 방식: A', state: 'sent', msgId: 'm-1' }];
  let r = viewRows(items, local, { aliasEn: 'big-star-parrot', now: NOW });
  assert.equal(r.rows.at(-1).state, 'sentAsk');
  const enq = { k: 'enq', ts: 3, src: 'ix', alias: 'big-star-parrot', text: '[질문에 대한 답] 방식: A' };
  r = viewRows([...items, enq], local, { aliasEn: 'big-star-parrot', now: NOW });
  assert.deepEqual(r.rows.map((x) => x.k), ['assistant', 'ask', 'mine']);
  assert.equal(r.rows.at(-1).state, 'queuedAsk');
  assert.equal(r.local[0].queued, true);
  const res = { k: 'ask-res', ts: 4, id: 'q1', card, res: { st: 'answered', a: [{ q: 0, pick: [1] }] } };
  r = viewRows([...items, enq, res], r.local, { aliasEn: 'big-star-parrot', now: NOW });
  assert.equal(r.rows.at(-1).state, 'queued'); // 답한 뒤 아직 전달 전(턴 진행 중)
  const peer = { k: 'peer', ts: 5, src: 'ix', alias: 'big-star-parrot', name: '사용자 (Agent4D 화면 · big-star-parrot)', msgId: 'm-1', text: '[질문에 대한 답] 방식: A', mid: 1 };
  r = viewRows([...items, enq, res, peer], r.local, { aliasEn: 'big-star-parrot', now: NOW });
  assert.deepEqual(r.rows.filter((x) => x.k === 'mine').map((x) => x.state), ['delivered']);
  assert.equal(r.local.length, 0);
  // 화면을 새로 열면(로컬 기록 없음) enq 만으로 대기열 줄, peer 가 오면 그 줄은 사라지고 전달됨 한 줄
  r = viewRows([...items, enq], [], { aliasEn: 'big-star-parrot', now: NOW });
  assert.deepEqual(r.rows.at(-1), { k: 'mine', ts: 3, text: '[질문에 대한 답] 방식: A', msgId: null, state: 'queuedAsk', enq: 1, hid: 0 });
  r = viewRows([...items, enq, res, peer], [], { aliasEn: 'big-star-parrot', now: NOW });
  assert.equal(r.rows.filter((x) => x.k === 'mine').length, 1);
  // 다른 기기의 enq 는 줄로 만들지 않음
  assert.equal(viewRows([...items, { ...enq, alias: 'red-moon-fox' }], [], { aliasEn: 'big-star-parrot', now: NOW }).rows.length, 2);
  // 권한 무시 세션(보류)·선택 창 없음은 예전 상태 그대로
  assert.equal(localState({ at: NOW - 1000, state: 'sent' }, NOW, true, true), 'held');
  assert.equal(localState({ at: NOW - 1000, state: 'sent' }, NOW, false, false), 'sent');
});

test('배선·문구: 배지는 패널 머리 전환 칸 옆 · 목록·표식 글자 이스케이프 · 소리·알림 없음 · 앱 openTools 머리표 · 카드 강조 · i18n', () => {
  const ui = readFileSync(new URL('../wait-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /\(ix\.seg \|\| head\.querySelector\('h2'\)\)\.after\(badge\)/);
  assert.doesNotMatch(ui, /Notification|new Audio|sfx|\.play\(/); // 소리·푸시 없음
  for (const m of ui.matchAll(/\$\{([^}]+)\}/g)) if (/waitName|waitHead|w\.project|age|w\.k/.test(m[1])) assert.match(m[1], /escapeHtml|^i$/, m[1]); // 목록 글자는 이스케이프
  assert.match(ui, /el\.textContent = '\?'/); // 표식은 글자 '?' 뿐(이름은 title·aria-label 속성 — setAttribute)
  assert.match(ui, /ix\._status\(\{ register: false \}\)/); // 실황에서 기기 등록·키 생성 안 함
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /\.\.\.\(ev\.card \? \{ ask: askHead\(ev\.card\) \} : \{\}\)/);
  const ixs = readFileSync(new URL('../interact.js', import.meta.url), 'utf8');
  assert.match(ixs, /window\.__ccvizWaits = mountWaits\(window\.__ccvizInteract\)/);
  assert.match(ixs, /if \(!create\) return null;/);
  assert.match(ixs, /this\._applyFlash\(\);\n  \}/);
  const css = readFileSync(new URL('../wait.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /body\.panel-collapsed #panel \.wait-badge/);
  for (const k of ['ix.wait.badge', 'ix.wait.title', 'ix.wait.list', 'ix.wait.ask', 'ix.wait.plan', 'ix.wait.why', 'ix.wait.age.now', 'ix.wait.age.min', 'ix.wait.age.hour', 'ix.wait.mark', 'ix.st.sentAsk', 'ix.st.queued', 'ix.st.queuedAsk']) {
    assert.ok(ix.en[k] && ix.ko[k], k);
  }
  assert.match(ix.ko['ix.st.sentAsk'], /질문 창이 닫히면 전달/);
});
