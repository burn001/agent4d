// 홀로그램 패널 안 실제 글: 서버 panel 정리·줄 고르기·갱신 규칙·mock 패널 — 순수 부분만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLO, PANEL, HOLO_KIND, HoloBook, normPanel, panelRows, textRows, tailShift, fallbackPanel, markStyle, shapeLayout, stackGroup } from '../holo-core.mjs';
import { MockPanels } from '../mock-panel.mjs';
import { MockGenerator } from '../mock.js';

const P = (o) => ({ v: 1, mode: 'shell', part: 'input', title: '$ npm test', lines: [], marks: '', ...o });

test('normPanel: 모양 검사·줄/줄 수/제목 상한·줄 표시 채움·제어 문자 제거', () => {
  assert.equal(normPanel(null), null); assert.equal(normPanel({ lines: 'x' }), null);
  const p = normPanel(P({ title: 'a\nb\u0007c', lines: Array.from({ length: 20 }, (_, i) => 'x'.repeat(i === 0 ? 300 : 3) + '\t|\u001b'), marks: 'e?', more: '7', ref: { nodeId: 's:1', toolUseId: 'tu' } }));
  assert.equal(p.lines.length, PANEL.LINES); assert.equal(p.lines[0].length, PANEL.LINE); assert.ok(p.lines[0].endsWith('…'));
  assert.equal(p.lines[1], 'xxx  |', '탭 → 공백 2, 제어 문자 제거');
  assert.equal(p.marks, 'eo' + 'o'.repeat(10), '모르는 표시·빠진 표시는 o');
  assert.equal(p.title, 'a bc'); assert.equal(p.more, 7); assert.deepEqual(p.ref, { nodeId: 's:1', toolUseId: 'tu' });
  assert.equal(normPanel(P({ hidden: 'secret', thin: 1 })).hidden, 'secret');
});

test('panelRows: 꼬리는 뒤·그 밖은 앞, 말줄임 줄에 잘린 줄 수(+more), 비공개는 줄 없음', () => {
  const lines = Array.from({ length: 12 }, (_, i) => 'L' + i);
  const tail = normPanel(P({ part: 'tail', lines, marks: 'o'.repeat(12), more: 30 }));
  const r = panelRows(tail, 6);
  assert.equal(r.length, 6); assert.equal(r[0].mark, 'm'); assert.equal(r[0].text, '… 앞 37줄'); assert.equal(r[5].text, 'L11', '마지막 줄이 남음');
  const head = normPanel(P({ mode: 'read', part: 'result', lines, marks: 'o'.repeat(12) }));
  const h = panelRows(head, 4);
  assert.deepEqual(h.map((x) => x.text), ['L0', 'L1', 'L2', '… 9줄 더']);
  const shellRes = normPanel(P({ part: 'result', lines, marks: 'oooooooooooe' }));
  assert.equal(panelRows(shellRes, 3).at(-1).mark, 'e', '셸 결과는 꼬리(마지막 오류 줄)');
  assert.equal(panelRows(head, 13).length, 12, '다 들어가면 말줄임 없음');
  assert.equal(panelRows(normPanel(P({ lines: ['a'], more: 2 })), 13).at(-1).text, '… 2줄 더', '서버가 자른 줄만 있어도 표시');
  assert.deepEqual(panelRows(normPanel(P({ hidden: 'secret', lines: ['[비밀 경로 — 내용 생략]'] })), 13), []);
  assert.deepEqual(panelRows(head, 0), [], '제목만 단계');
});

test('textRows(거리 LOD) · 경계 여유 · tailShift · 대체 요약 · 줄 색 · 실루엣 글 자리', () => {
  assert.equal(textRows(40), 0, '멀면 제목만'); assert.equal(textRows(80), 3); assert.equal(textRows(130), 6); assert.equal(textRows(200), 9); assert.equal(textRows(400), 13);
  assert.equal(textRows(118, 6), 6, '경계 바로 아래는 앞 단계 유지'); assert.equal(textRows(100, 6), 3, '충분히 멀어지면 바뀜');
  assert.equal(tailShift(['a', 'b', 'c', 'd'], ['c', 'd', 'e', 'f']), 2);
  assert.equal(tailShift(['a', 'b'], ['a', 'b', 'c']), 0, '창이 덜 찼으면 밀림 없음');
  assert.equal(tailShift(['a', 'b'], ['x', 'y']), 0);
  const fb = fallbackPanel({ label: { tool: 'Bash', target: 'npm test' }, result: 'exit 1 · boom', res: 'error' });
  assert.equal(fb.title, 'Bash'); assert.deepEqual(fb.lines, ['npm test', '→ exit 1 · boom']); assert.equal(fb.marks, 'oe'); assert.ok(fb.fallback);
  for (const light of [false, true]) {
    const e = markStyle('e', light), add = markStyle('+', light), del = markStyle('-', light), o = markStyle('o', light);
    assert.notEqual(e.color, o.color); assert.notEqual(add.color, del.color); assert.ok(add.bg && del.bg);
    assert.equal(markStyle('$', light).color, null, '명령 줄은 종류 잉크 색'); assert.ok(markStyle('d', light).dim);
  }
  for (const k of Object.values(HOLO_KIND)) {
    const L = shapeLayout(k.shape, k.asp);
    for (const v of [...L.title, ...L.body]) assert.ok(v >= 0 && v <= 1, k.desc);
    assert.ok(L.body[3] <= L.hd && L.title[2] >= L.body[3], '본문은 머리 띠 아래, 제목은 그 위');
    assert.ok(L.body[1] > L.body[0] && L.title[1] > L.title[0]);
  }
  assert.deepEqual([4, 5, 7].filter((s) => Object.values(HOLO_KIND).some((k) => k.shape === s)), [], '글을 담기 어려운 둥근 실루엣은 안 씀');
});

test('HoloBook.panelEvent: 시작 → 끝 전체 교체 · 같은 내용 무시 · 꼬리는 ref 패널(남김 연장) 또는 작업 노드 자신 · 말 · 부모 Agent 진행', () => {
  const b = new HoloBook();
  const e = b.start('s:m', { toolUseId: 't1', cat: 'shell', tool: 'Bash', panel: P({ lines: ['단위시험'], marks: 'd' }) }, 0);
  assert.equal(e.panel.title, '$ npm test'); assert.equal(e.pv, 1);
  b.end('s:m', 't1', 'ok', 0.5, 'exit 0');
  assert.equal(b.panelEvent({ type: 'tool-end', nodeId: 's:m', toolUseId: 't1', panel: P({ part: 'result', lines: ['ok 1', 'exit 0'], marks: 'od' }) }, 0.5), 1);
  assert.deepEqual(e.panel.lines, ['ok 1', 'exit 0']); assert.equal(e.pv, 2);
  assert.equal(b.panelEvent({ type: 'tool-end', nodeId: 's:m', toolUseId: 't1', panel: P({ part: 'result', lines: ['ok 1', 'exit 0'], marks: 'od' }) }, 0.6), 0, '같은 내용이면 다시 그리지 않음');
  // 백그라운드 꼬리: ref 가 남아 있는 셸 패널 → 그 패널을 갱신하고 남김 시각을 늘림
  const tail = (lines, t) => b.panelEvent({ type: 'output', nodeId: 'b:1', panel: { v: 1, mode: 'shell', part: 'tail', title: '$ npm run dev', lines, marks: 'o'.repeat(lines.length), ref: { nodeId: 's:m', toolUseId: 't1' } } }, t);
  tail(['a', 'b', 'c'], 5); tail(['b', 'c', 'd'], HOLO.LINGER + 4);
  assert.equal(e.panel.part, 'tail'); assert.equal(e.scrollN, 1, '한 줄 밀려 올라감');
  b.step(HOLO.LINGER + 5, () => false);
  assert.equal(e.foldAt, null, '출력이 이어지는 동안은 남김 연장');
  // ref 를 못 찾으면 작업 노드 자신의 꼬리 패널
  b.panelEvent({ type: 'output', nodeId: 'b:2', panel: { v: 1, mode: 'shell', part: 'tail', title: '$ x', lines: ['q'], marks: 'o', ref: { nodeId: 's:m', toolUseId: 'gone' } } }, 6);
  const own = b.list('b:2')[0];
  assert.equal(own.sticky, 'tail'); assert.equal(own.dir, 'shell'); assert.ok(own.slot >= 0);
  b.step(6 + PANEL.TAIL_LINGER + 0.1, () => true); assert.ok(own.foldAt != null, '출력이 멎으면 접힘');
  // 말: 노드당 하나, 위쪽(검색과 같은 쌓임 무리) — 검색 패널이 있으면 그 바깥
  b.start('s:m', { toolUseId: 'g1', cat: 'search', tool: 'Grep' }, 7);
  b.panelEvent({ type: 'text', nodeId: 's:m', panel: { v: 1, mode: 'say', part: 'say', title: '', lines: ['첫 말'], marks: 'o' } }, 7.1);
  const say = b.find('s:m', 'say:s:m');
  assert.equal(say.dir, 'say'); assert.equal(stackGroup(say.dir), 'search'); assert.equal(say.slot, 1, '검색 패널 바깥에 쌓임');
  assert.equal(b.openCount('s:m'), 1, '말은 열린 도구로 세지 않음');
  b.panelEvent({ type: 'text', nodeId: 's:m', panel: { v: 1, mode: 'say', part: 'say', title: '', lines: ['첫 말', '둘째 말'], marks: 'oo' } }, 8);
  assert.equal(b.list('s:m').filter((x) => x.sticky === 'say').length, 1, '같은 말 패널을 갱신'); assert.equal(say.pv, 2);
  const ph = b.phaseOf(say, 9); assert.equal(ph.flash, 0, '말 패널은 결과 섬광 없음');
  b.step(8 + PANEL.SAY_LINGER + 0.1, () => true); assert.ok(say.foldAt != null);
  // 다른 도구가 말 패널을 이어받지 않음
  const g2 = b.start('s:m', { toolUseId: 'g2', cat: 'search' }, 30);
  assert.notEqual(g2, say);
  // 서브에이전트 진행 → 부모 Agent 패널
  const ag = b.start('s:m', { toolUseId: 'ag', cat: 'agent', tool: 'Agent', panel: { v: 1, mode: 'agent', part: 'input', title: '파서', lines: ['x'], marks: 'd' } }, 31);
  b.end('s:m', 'ag', 'ok', 31.2);
  b.panelEvent({ type: 'tool-start', nodeId: 'a:1', toolUseId: 'z', parentPanel: { v: 1, mode: 'agent', part: 'progress', title: '파서', lines: ['p', '진행 · 도구 1회 · 말 0', '› Read a.js'], marks: 'ddh', ref: { nodeId: 's:m', toolUseId: 'ag' } } }, 32);
  assert.equal(ag.panel.part, 'progress'); assert.equal(ag.touchAt, 32);
  // 스냅샷(quiet) 열린 도구의 입력 패널
  const q = new HoloBook(); const qe = q.start('n', { toolUseId: 'o', cat: 'read', panel: { v: 1, mode: 'read', part: 'input', title: 'web/app.js', lines: ['1줄부터'], marks: 'd' } }, 10, { quiet: true });
  assert.equal(qe.panel.title, 'web/app.js'); assert.equal(q.phaseOf(qe, 10).phase, 'hold');
  // 이어받기는 새 도구 내용으로(없으면 비움 → 요약 대체)
  const c = new HoloBook(); const c1 = c.start('k', { toolUseId: 'a', cat: 'shell', panel: P({}) }, 0); c.end('k', 'a', 'ok', 0.1); c.step(1, () => true);
  const c2 = c.start('k', { toolUseId: 'b', cat: 'shell' }, 2);
  assert.equal(c2, c1); assert.equal(c2.panel, null); assert.ok(c2.pv >= 2);
});

test('mock 패널(§52): 모든 도구 시작·끝에 패널, 꼬리 ref = 띄운 호출, 말·서브에이전트 진행, 지어낸 값만', () => {
  const g = new MockGenerator({ seed: 2026, startMs: 0 });
  const evs = [];
  while (g.q.length) { const at = Math.min(...g.q.map((x) => x.at)); if (at > 90000) break; evs.push(...g.next().events); }
  new MockPanels().inject(evs);
  const starts = evs.filter((e) => e.type === 'tool-start'), ends = evs.filter((e) => e.type === 'tool-end');
  assert.ok(starts.length > 50 && starts.every((e) => e.panel && Array.isArray(e.panel.lines) && e.panel.part === 'input'));
  assert.ok(ends.every((e) => e.panel && e.panel.part === 'result'));
  const outs = evs.filter((e) => e.type === 'output');
  assert.ok(outs.length && outs.every((e) => e.panel && e.panel.part === 'tail' && e.panel.ref));
  const firstOut = outs[0], node = evs.find((e) => e.type === 'node-add' && e.nodeId === firstOut.nodeId).node;
  const launch = starts.filter((e) => e.nodeId === node.parentId && (e.tool === 'Bash' || e.tool === 'Monitor') && e.seq < evs.find((x) => x.nodeId === node.id).seq).at(-1);
  assert.equal(firstOut.panel.ref.toolUseId, launch.toolUseId, '꼬리 ref = 그 백그라운드를 띄운 호출');
  assert.ok(evs.some((e) => e.type === 'text' && e.panel && e.panel.mode === 'say'));
  const pp = evs.find((e) => e.parentPanel);
  const sub = evs.find((e) => e.type === 'node-add' && e.nodeId === pp.nodeId).node;
  assert.equal(pp.parentPanel.ref.toolUseId, sub.meta.toolUseId); assert.equal(pp.parentPanel.ref.nodeId, sub.parentId);
  assert.ok(starts.some((e) => e.panel.hidden === 'secret'), '비공개 예시도 있음');
  const all = JSON.stringify(evs.map((e) => [e.panel, e.parentPanel]));
  assert.ok(!/[\w.+-]+@[a-z][\w-]*\.[a-z]{2,}/i.test(all), '메일 꼴 없음'); assert.ok(!/C:\\\\Users|sk-ant|Bearer /.test(all));
  // 스냅샷 seed: 열린 도구에 입력 패널
  const snap = g.snapshot();
  for (const n of snap.nodes) n.openTools.forEach((t) => delete t.panel);
  new MockPanels().seed(snap);
  assert.ok(snap.nodes.flatMap((n) => n.openTools).every((t) => t.panel));
});
