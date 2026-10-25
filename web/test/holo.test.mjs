// 홀로그램 모니터·작업 요약 표시의 순수 부분
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLO, HOLO_KIND, HOLO_DIR, HoloBook, holoPhase, holoDir, holoOffset, panelPx, holoLod, holoLabel, actLine, sayBrief, pushHist, holoKind } from '../holo-core.mjs';
import { CATS } from '../icons.js';
import { markFor } from '../timeline.mjs';
import { mockBrief, mockResult } from '../mock.js';

test('모든 도구 종류에 무늬·글리프, 요구된 묘사 매핑', () => {
  for (const c of CATS) { const k = HOLO_KIND[c]; assert.ok(k, c); assert.ok(k.mode >= 0 && k.mode <= 9); assert.ok(k.glyph >= 0 && k.glyph < 13); }
  assert.equal(HOLO_KIND.shell.mode, 0, 'shell=터미널');
  assert.equal(HOLO_KIND.read.mode, 1, 'read=페이지');
  assert.ok([2, 3].includes(HOLO_KIND.edit.mode) && [2, 3].includes(HOLO_KIND.write.mode), '쓰기·편집=코드 줄');
  assert.equal(HOLO_KIND.search.mode, 4); assert.equal(HOLO_KIND.web.mode, 5); assert.equal(HOLO_KIND.agent.mode, 6); assert.equal(HOLO_KIND.skill.mode, 8);
  assert.equal(holoKind('없는것'), HOLO_KIND.other);
});

test('holoPhase: 펼침 → 유지 → 결과 섬광 → 접힘 → 사라짐, 짧은 도구도 최소 표시', () => {
  const p0 = holoPhase(0.02);
  assert.equal(p0.phase, 'open'); assert.ok(p0.sy <= 0.06, '처음엔 가는 빛줄'); assert.ok(p0.sx < 1);
  assert.equal(holoPhase(HOLO.OPEN * 0.45).sy, 0.05, '옆으로 다 퍼진 뒤 위아래로');
  assert.equal(holoPhase(0.5).phase, 'hold');
  assert.equal(holoPhase(100, null).phase, 'hold', '끝 신호 전엔 계속');
  assert.equal(holoPhase(0.5, 0.1).phase, 'hold', '최소 표시 전엔 유지');
  const f = holoPhase(HOLO.MIN_SHOW + 0.2, 0.1);
  assert.equal(f.phase, 'flash'); assert.equal(f.flash, 1);
  const fo = holoPhase(HOLO.MIN_SHOW + HOLO.FLASH + HOLO.FOLD * 0.3, 0.1);
  assert.equal(fo.phase, 'fold'); assert.ok(fo.sy < 1 && fo.sx === 1, '먼저 위아래로 접힘');
  const fo2 = holoPhase(HOLO.MIN_SHOW + HOLO.FLASH + HOLO.FOLD * 0.9, 0.1);
  assert.ok(fo2.sx < 0.5, '그다음 점으로');
  assert.equal(holoPhase(HOLO.MIN_SHOW + HOLO.FLASH + HOLO.FOLD + 0.01, 0.1).phase, 'gone');
  assert.equal(holoPhase(0.2 + HOLO.FLASH + HOLO.FOLD + 0.4, 0.1, 0.2).phase, 'gone', '배속이면 최소 표시를 줄임');
});

test('라벨: 서버 요약(brief) 우선, 제어 문자 제거, 길이 상한', () => {
  assert.deepEqual(holoLabel({ tool: 'Bash', text: '테스트 실행', brief: 'npm test' }), { tool: 'Bash', target: 'npm test' });
  assert.deepEqual(holoLabel({ tool: 'Bash', text: '테스트 실행' }), { tool: 'Bash', target: '테스트 실행' }, 'brief 없으면 예전 text');
  assert.equal(holoLabel({ tool: 'Skill', cat: 'skill', skill: 'writing-style' }).tool, 'Skill');
  const l = holoLabel({ tool: 'Edit', brief: 'a\nb c\u0007d' });
  assert.equal(l.target, 'a b c d');
  assert.ok(holoLabel({ tool: 'Grep', brief: 'x'.repeat(200) }).target.length <= 34);
  assert.equal(holoLabel({ tool: 'X', text: '' }).target, '');
  assert.equal(actLine({ tool: 'Edit', brief: 'app.js +12 −3' }), 'Edit · app.js +12 −3');
  assert.equal(actLine({ tool: 'TodoWrite' }), 'TodoWrite');
});

test('말 한두 문장·최근 이력', () => {
  assert.equal(sayBrief('짧은 말.'), '짧은 말.');
  const long = '첫 문장은 아주 길게 이어지는 설명입니다 '.repeat(4) + '. 둘째 문장입니다. 마지막으로 시험을 돌립니다.';
  const b = sayBrief(long, 60);
  assert.ok(b.length <= 60); assert.ok(b.endsWith('마지막으로 시험을 돌립니다.'), b);
  const h = [];
  for (let i = 0; i < 8; i++) pushHist(h, { id: 't' + i, label: 'L' + i, res: null }, 5);
  assert.equal(h.length, 5); assert.equal(h[0].id, 't7', '새 항목이 앞');
  pushHist(h, { id: 't6', res: 'error', result: 'exit 1' }, 5);
  assert.equal(h.length, 5); assert.equal(h[1].res, 'error'); assert.equal(h[1].label, 'L6', '같은 도구는 결과로 갱신');
});

test('타임라인 툴팁·mock 도 같은 요약', () => {
  assert.equal(markFor({ type: 'tool-start', cat: 'shell', tool: 'Bash', text: '빌드', brief: 'npm run build' }).label, 'Bash · npm run build');
  assert.equal(markFor({ type: 'tool-start', cat: 'shell', tool: 'Bash', text: '빌드' }).label, 'Bash · 빌드');
  assert.equal(markFor({ type: 'tool-end', ok: false, tool: 'Bash', text: '긴 오류', brief: 'exit 2 · boom' }).label, 'Bash 실패 · exit 2 · boom');
  assert.match(mockBrief('Edit', 'edit', 'app.js', 'toolu_1').brief, /^app\.js \+\d+ −\d+$/);
  assert.equal(mockBrief('Bash', 'shell', 'npm test', 'x').brief, 'npm test');
  assert.match(mockResult('shell', true, 'x'), /^exit 0 · /);
  assert.match(mockResult('search', true, 'x'), /개 파일$/);
});

test('종류별 방향·실루엣(§38.10): 서로 다른 도구는 다른 방향·다른 모양', () => {
  const deg = (c) => HOLO_DIR[HOLO_KIND[c].dir];
  assert.equal(deg('shell'), 0, 'shell 오른쪽'); assert.equal(deg('read'), 135, 'read 왼쪽 위');
  assert.equal(deg('edit'), 180); assert.equal(deg('write'), 180, 'edit/write 왼쪽');
  assert.equal(deg('search'), 90, 'search 위'); assert.equal(deg('web'), 45, 'web 오른쪽 위');
  assert.equal(deg('agent'), 270); assert.equal(deg('workflow'), 270, 'agent/workflow 아래');
  assert.equal(deg('skill'), 225, 'skill 왼쪽 아래'); assert.equal(deg('mcp'), 315); assert.equal(deg('other'), 315);
  // 주요 종류는 실루엣이 모두 다르다(색만 다른 수준 금지)
  const shapes = ['shell', 'read', 'edit', 'search', 'web', 'agent', 'skill', 'monitor', 'mcp'].map((c) => HOLO_KIND[c].shape);
  assert.equal(new Set(shapes).size, shapes.length);
  assert.ok(HOLO_KIND.shell.asp > 1.5 && HOLO_KIND.read.asp < 1, '터미널은 넓게, 문서는 세로');
  const d = holoDir('search'); assert.ok(Math.abs(d.x) < 1e-9 && d.y === 1);
  // 거리: 위아래 방향은 높이, 좌우는 폭 기준 + 쌓임 + 라벨 회피
  const h0 = holoOffset({ x: 1, y: 0 }, 1, 3, 1); const v0 = holoOffset({ x: 0, y: 1 }, 1, 3, 1);
  assert.ok(h0 > v0, '넓은 패널은 좌우로 더 멀리');
  assert.ok(holoOffset({ x: 1, y: 0 }, 1, 3, 1, 1) > h0 + 3, '두 번째 쌓임은 바깥으로');
  assert.equal(holoOffset({ x: 0, y: -1 }, 1, 2, 1, 0, 0.7), holoOffset({ x: 0, y: -1 }, 1, 2, 1) + 0.7);
  assert.equal(panelPx(1, 20, 50, 1000) > panelPx(1, 40, 50, 1000), true);
  assert.equal(holoLod(1), 0); assert.equal(holoLod(20), 1); assert.equal(holoLod(80), 2); assert.equal(holoLod(1, true), 2);
});

test('HoloBook(§38.10): 다른 종류는 각자 방향에 동시에, 같은 종류는 그 방향 패널이 이어받음, 병렬은 2개까지 쌓고 대기', () => {
  const b = new HoloBook();
  const t = (id, cat, now = 0) => b.start('n', { toolUseId: id, tool: cat, cat }, now);
  t('s1', 'shell'); t('r1', 'read'); t('e1', 'edit'); t('g1', 'search');
  const L = () => b.list('n');
  assert.deepEqual(L().map((e) => [e.dir, e.slot]), [['shell', 0], ['read', 0], ['edit', 0], ['search', 0]], '종류마다 자기 방향');
  // 병렬 shell: 같은 방향 바깥에 쌓고, 세 번째는 대기
  t('s2', 'shell'); t('s3', 'shell');
  assert.equal(L().find((e) => e.id === 's2').slot, 1); assert.equal(L().find((e) => e.id === 's3').slot, -1); assert.equal(b.queued('n'), 1);
  // 짧은 read 가 끝나고 또 read: 같은 패널이 이어받음(왼쪽 위 그대로)
  b.end('n', 'r1', 'ok', 0.2, '10줄');
  const r1 = L().find((e) => e.id === 'r1');
  const r2 = t('r2', 'read', 1);
  assert.equal(r2, r1, '같은 방향 패널을 이어받음'); assert.equal(r2.dir, 'read'); assert.equal(r2.swapAt, 1);
  // 다른 종류 도구가 열려 있어도 끝난 비-shell 패널은 최소 LINGER 동안 남는다
  b.end('n', 'g1', 'ok', 1.1, '3개 파일');
  b.step(3, () => true);
  const g1 = L().find((e) => e.id === 'g1');
  assert.equal(g1.foldAt, null, '다른 도구가 열려 있어도 검색 결과는 남음');
  assert.equal(b.phaseOf(g1, 3).phase, 'linger');
  b.step(1.1 + HOLO.LINGER + 0.5, () => true);
  assert.ok(g1.foldAt != null, 'LINGER 뒤엔 접힘(열린 도구가 있으므로)');
  // 쌓임 1(병렬) 패널은 끝나면 바로 접힘
  b.end('n', 's2', 'ok', 9); b.step(9.5, () => true);
  assert.ok(L().find((e) => e.id === 's2').foldAt != null);
  // 대기 shell 은 자리가 나면 받음
  b.step(9.5 + HOLO.FLASH + HOLO.FOLD + 1, () => true);
  assert.ok(L().find((e) => e.id === 's3').slot >= 0);
  // 노드당 상한
  const c = new HoloBook({ perNode: 6 });
  ['shell', 'read', 'edit', 'search', 'web', 'agent', 'skill', 'mcp'].forEach((cat, i) => c.start('m', { toolUseId: 'x' + i, cat }, 0));
  assert.equal(c.shown, 6); assert.equal(c.queued('m'), 2);
  // 전체 상한
  const big = new HoloBook({ max: 512 });
  for (let i = 0; i < 300; i++) for (const cat of ['shell', 'read', 'edit']) big.start('n' + i, { toolUseId: i + cat, cat }, 0);
  assert.equal(big.shown, 512); big.clear(); assert.equal(big.shown, 0);
  // 스냅샷(quiet)은 이미 펼친 상태
  const q = new HoloBook(); const e = q.start('n', { toolUseId: 'x', cat: 'web' }, 10, { quiet: true });
  assert.equal(q.phaseOf(e, 10).phase, 'hold'); assert.equal(e.shape, HOLO_KIND.web.shape);
});

test('최근 작업 모니터: 작업 중이면 마지막 패널 하나는 계속, 유휴·완료면 접힘', () => {
  const b = new HoloBook();
  let active = true;
  b.start('n', { toolUseId: 'a', cat: 'read' }, 0); b.end('n', 'a', 'ok', 0.2, '120줄 읽음');
  b.start('n', { toolUseId: 'b', cat: 'shell' }, 0.3); b.end('n', 'b', 'ok', 0.5, 'exit 0');
  b.step(1.5, () => active);
  assert.equal(b.list('n').length, 2, '둘 다 남음(서로 다른 방향)');
  b.step(30, () => active);
  const left = b.list('n').filter((e) => e.foldAt == null);
  assert.equal(left.length, 1); assert.equal(left[0].id, 'b', '가장 최근 하나만 계속');
  active = false;
  b.step(31, () => active);
  assert.ok(b.list('n').every((e) => e.foldAt != null), '유휴면 접힘');
  const c = new HoloBook();
  c.start('m', { toolUseId: '1', cat: 'edit' }, 0); c.end('m', '1', 'error', 1); c.endAll('m', 'ok', 2);
  assert.equal(c.list('m')[0].foldAt, 2 + HOLO.LINGER_END);
  c.step(2 + HOLO.LINGER_END + HOLO.FOLD + 1, () => false); assert.equal(c.size, 0);
  // 이어받은 직후 끝난 짧은 도구는 섬광 약하게
  const d = new HoloBook();
  d.start('k', { toolUseId: 'p', cat: 'shell' }, 0); d.end('k', 'p', 'ok', 0.1); d.step(2, () => true);
  const e2 = d.start('k', { toolUseId: 'q', cat: 'shell' }, 3); d.end('k', 'q', 'ok', 3.2);
  assert.ok(d.phaseOf(e2, 3.2 + 0.05).flash <= 0.4 + 1e-9);
});
