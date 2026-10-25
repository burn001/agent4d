// 세션 노드 부제: meta.title → 라벨 아래 한 줄, customTitle·중복 생략, 정리·자름 / overview mock 이 서버 규칙(label=역할, meta.title=제목)을 따름
import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeSubtitle as _off, sessionTitleOf as nodeSubtitle } from '../node-title.mjs';
import { createOverviewMock } from '../overview/mock.js';
import { MockGenerator } from '../mock.js';

test('§77 화면 부제는 쓰지 않음: nodeSubtitle 은 늘 빈 문자열', () => {
  assert.equal(_off({ label: '메인 · 2026', meta: { title: '세션 시각화 퇴장 연출' } }), '');
});

test('sessionTitleOf(예전 부제 규칙): meta.title, customTitle·같은 말·빈 값은 생략', () => {
  assert.equal(nodeSubtitle({ label: '메인 · 2026', meta: { title: '세션 시각화 퇴장 연출' } }), '세션 시각화 퇴장 연출');
  assert.equal(nodeSubtitle({ label: '내 이름', meta: { title: '내 이름', customTitle: true } }), '');
  assert.equal(nodeSubtitle({ label: '다른 제목', meta: { title: 'ai 제목', customTitle: true } }), '', 'customTitle 이면 생략');
  assert.equal(nodeSubtitle({ label: '같음', meta: { title: '같음' } }), '');
  assert.equal(nodeSubtitle({ label: 'x', meta: {} }), '');
  assert.equal(nodeSubtitle({ label: 'x' }), '');
  assert.equal(nodeSubtitle(null), '');
  assert.equal(nodeSubtitle({ label: 'x', meta: { title: '  줄\n바꿈\t과\u0007 제어  ' } }), '줄 바꿈 과 제어');
  const long = '가'.repeat(200);
  const s = nodeSubtitle({ label: 'x', meta: { title: long } }, 50);
  assert.equal(s.length, 50); assert.ok(s.endsWith('…'));
});

test('overview mock: 루트 label 은 역할 표기, 세션 목록 제목은 meta.title 로(덮어쓰지 않음)', () => {
  const m = createOverviewMock({ projects: 3, now: () => Date.parse('2026-10-24T03:00:00Z') });
  const snap = m.snapshot();
  const mains = snap.nodes.filter((n) => !n.parentId && n.kind === 'main' && !(n.meta && n.meta.orphanSdk) && n.meta && n.meta.tier === 'live');
  assert.ok(mains.length >= 2);
  for (const n of mains) {
    assert.match(n.label, /^메인 · /, n.label);
    assert.ok(n.meta.title && !n.label.includes(n.meta.title), '제목은 부제로');
    const live = snap.projects.flatMap((p) => p.liveList || []).find((x) => x.sessionId === n.sessionId);
    assert.ok(live, '세션 목록에 있음');
    assert.equal(live.title, n.meta.title, '세션 목록 제목 = meta.title');
  }
  const cp = snap.nodes.find((n) => n.kind === 'claude-p' && !n.parentId);
  if (cp) { assert.match(cp.label, /^claude -p · /); assert.ok(cp.meta.title); }
});

test('mock(단일 세션): 메인·claude -p 노드도 서버 규칙 모양', () => {
  const g = new MockGenerator({ seed: 2026, startMs: Date.parse('2026-10-23T01:00:00Z') });
  const evs = [];
  for (let i = 0; i < 400; i++) { const r = g.next(); if (!r) break; evs.push(...r.events); }
  const adds = evs.filter((e) => e.type === 'node-add').map((e) => e.node);
  const main = adds.find((n) => n.kind === 'main');
  assert.match(main.label, /^메인 · /);
  assert.ok(main.meta.title);
  const cp = adds.find((n) => n.kind === 'claude-p');
  if (cp) { assert.match(cp.label, /^claude -p · .{8}$/); assert.ok(cp.meta.title); }
});
