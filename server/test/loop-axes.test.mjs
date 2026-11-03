// 자율 루프 판 — 축 큐 어댑터(내장): relaunch.sh AXIS_QUEUE → 축 env → 설계서 단계 표식 → status.json 지금 축.
// 레이아웃이 없으면 null(조용히). 라이브 런타임은 재기동기(기동기 노드)가 있을 때만 그 노드 meta.plans 에 싣는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopAxesPlan, axisSteps, axisNo } from '../loop-axes.mjs';
import { planFromRaw } from '../plans.mjs';
import { Graph } from '../graph.mjs';
import { PlanTracker } from '../plans.mjs';

const w = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
function layout(root) {
  w(root, '.autopilot/relaunch.sh', '#!/bin/bash\nAXIS_QUEUE=(alpha beta gamma delta)\nAXIS_IDX=0\n');
  const env = (id, label, extra = '') => `AXIS_LABEL="${label}"\nDESIGN_DOC="$REPO_DIR/docs/plans/${id}.md"\n${extra}`;
  w(root, 'scripts/autopilot-axes/alpha.env', env('alpha', '알파 축'));
  w(root, 'scripts/autopilot-axes/beta.env', env('beta', '베타 축'));
  w(root, 'scripts/autopilot-axes/gamma.env', env('gamma', '감마 축', "PHASE_RE='^\\*\\*관문 N[1-5] 상태\\*\\*'\nSETTLED_RE='✅|⏸'\n"));
  // delta 는 축 파일 없음
  w(root, 'docs/plans/alpha.md', '### 단계 0 — 준비\n**단계 0 상태**: ✅ 닫힘\n### 단계 1 — 측정\n**단계 1 상태**: ⏸ 외부 대기\n');
  w(root, 'docs/plans/beta.md', '### 단계 0 — 준비\n**단계 0 상태**: ✅ 닫힘\n### 단계 1 — 측정\n**단계 1 상태**: ◑ 미착지\n### 단계 2 — 배포\n**단계 2 상태**: ◑ 미착지\n');
  w(root, 'docs/plans/gamma.md', '**관문 N1 상태**: ✅\n**관문 N2 상태**: ◑\n');
  w(root, '.autopilot/status.json', JSON.stringify({ axis: 'beta', remaining_phases: 2 }));
}

test('§122 축 큐: 모두 정착 = 끝(✅·⏸) · 지금 축 · 축마다 표식 정규식 · 축 파일 없음 · 레이아웃 없으면 null', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-loop-'));
  try {
    assert.equal(loopAxesPlan(root), null, '레이아웃 없음');
    layout(root);
    const r = loopAxesPlan(root);
    assert.deepEqual(r.items.map((x) => [x.id, x.state]), [['alpha', 'done'], ['beta', 'current'], ['gamma', 'pending'], ['delta', 'pending']]);
    assert.equal(r.items[0].title, '알파 축'); assert.equal(r.items[0].doc, 'docs/plans/alpha.md');
    assert.deepEqual(r.items[1].steps.map((x) => [x.title, x.state]), [['단계 0 — 준비', 'done'], ['단계 1 — 측정', 'pending'], ['단계 2 — 배포', 'pending']]);
    assert.equal(r.items[2].steps.length, 2);
    assert.equal(r.items[3].note, '축 파일 없음');
    const p = planFromRaw(r, { key: 'k' });
    assert.equal(p.src, 'axes'); assert.equal(p.cur, 1);
    assert.deepEqual([p.items[1].steps.done, p.items[1].steps.total], [1, 3]);
    assert.deepEqual(axisSteps('**단계 1 상태**: ✅\n**단계 2 상태**: ⏸\n').map((x) => x.state), ['done', 'blocked']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('§122 주인 = 재기동기: 기동기 노드가 있을 때만 그 노드 meta.plans(같은 내용이면 내지 않음)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-loopw-'));
  try {
    layout(root);
    const { RootRuntime } = await import('../session.mjs');
    // 런타임 sweep 의 판 주인 고르기만 떼어 시험(그래프 + PlanTracker)
    const g = new Graph({ rootSessionId: 'S', localSeq: true });
    g.addNode({ id: 's:S', parentId: null, kind: 'main', label: 'm', sessionId: 'S', meta: { cwd: root } });
    g.finishLoad();
    const fake = { sessionId: 'S', graph: g, privacy: 'summary', _plans() { return this._pt || (this._pt = new PlanTracker({ graph: g })); } };
    const sweep = RootRuntime.prototype._loopAxesSweep;
    sweep.call(fake, 100_000);
    assert.equal(g.get('s:S').meta.plans, undefined, '기동기가 없으면 판 없음');
    g.addNode({ id: 'b:old', parentId: null, kind: 'bash-bg', label: '기동기 · relaunch.sh', sessionId: 'S', status: 'done', startedAt: '2026-10-28T01:00:00Z', meta: { launcher: { script: 'relaunch.sh' } } });
    g.addNode({ id: 'b:adopt-x', parentId: null, kind: 'bash-bg', label: '기동기 · relimit-restart.sh', sessionId: 'S', status: 'active', startedAt: '2026-10-28T00:00:00Z', meta: { launcher: { script: 'relimit-restart.sh' } } });
    fake._loopAt = 0; sweep.call(fake, 200_000);
    const pl = g.get('b:adopt-x').meta.plans;
    assert.ok(pl && pl[0].src === 'axes', '끝나지 않은 재기동기 노드에');
    assert.equal(pl[0].progress.total, 4);
    assert.equal(g.get('b:old').meta.plans, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('§132 축 고유 번호: AXIS_NO 우선 · 자기 축을 정의하는 표식만(다른 축을 말한 줄·범위·언급은 거름) · 표식 없으면 null(추측 없음)', () => {
  const hd = (...ls) => ls.map((l) => '# ' + l).join('\n') + '\nAXIS_LABEL="x"\n';
  // 명시 칸이 머리 주석보다 앞
  assert.equal(axisNo('AXIS_NO=172\n' + hd('★7번 축 — 결정')), 172);
  assert.equal(axisNo('AXIS_NO="41"  # 고유 번호\n'), 41);
  assert.equal(axisNo("AXIS_NO='8'\n"), 8);
  assert.equal(axisNo('AXIS_NO=abc\nAXIS_LABEL="x"\n'), null);
  assert.equal(axisNo('AXIS_NO=0\n'), null);
  // 자기 축 표식
  assert.equal(axisNo(hd('제목', '★172번 축 — 결정 2026-11-01')), 172);
  assert.equal(axisNo(hd('★지시(2026-10-01) — 「그대로 진행」 · 32번 축. 감독 창 측정')), 32);
  assert.equal(axisNo(hd('결정 · 45번 축(코드 이식)')), 45);
  assert.equal(axisNo(hd('결정 · 64번 축 · ADR-0001')), 64);
  // 다른 축·범위·언급 줄은 건너뛰고 뒤의 자기 표식을 씀 / 자기 표식이 없으면 null
  assert.equal(axisNo(hd('앞서 38번 축이 닫혀 큐가 비었다', '31~34번 축 넷으로 세웠다', '후속 · 39번 축.')), 39);
  assert.equal(axisNo(hd('50번 축으로 49번 뒤에', '그 뒤 57번 축 뒤에 이어 세울 축 · 58번 축.')), 58);
  assert.equal(axisNo(hd('11번 축이 멈춰 자리가 비었다', '18번 축 후보 ①을 골랐다', '-5번 축')), null, '언급·후보 문장·표식 없음');
  assert.equal(axisNo(hd('범위 31~34번 축 넷')), null);
  assert.equal(axisNo('AXIS_LABEL="x"\n# 번호 없음\n'), null);
  // 머리 주석 밖(설정 줄 뒤)의 글은 보지 않음
  assert.equal(axisNo('AXIS_LABEL="x"\n# ★9번 축 — 늦은 주석\n'), null);
  assert.equal(axisNo(''), null);
  assert.equal(axisNo(null), null);
});

test('§132 큐 재배치: 줄 순서 = 큐 순서(실행 순서) 그대로, 번호는 위치와 무관하게 고유 번호 · 표식 없는 축은 번호 칸 없음 · 와이어(planFromRaw)까지 유지', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-loopno-'));
  try {
    // 큐: 번호가 뒤섞임(위치 ≠ 번호) + 표식 없는 축 + 파일 없는 축 + AXIS_NO 축
    w(root, '.autopilot/relaunch.sh', 'AXIS_QUEUE=(plain old-late new-early marked noenv)\nAXIS_IDX=0\n');
    const env = (head) => `${head}\nAXIS_LABEL="축"\nDESIGN_DOC="$REPO_DIR/docs/plans/none.md"\n`;
    w(root, 'scripts/autopilot-axes/plain.env', env('# 자율 루프 축 정의 — 번호 없는 옛 축'));
    w(root, 'scripts/autopilot-axes/old-late.env', env('# ★결정 — 지난 큐 재배치 · 163번 축.'));
    w(root, 'scripts/autopilot-axes/new-early.env', env('# ★172번 축 — 결정'));
    w(root, 'scripts/autopilot-axes/marked.env', 'AXIS_NO=5\n# 31번 축이 닫혔다\n' + env(''));
    const r = loopAxesPlan(root);
    assert.deepEqual(r.items.map((x) => x.id), ['plain', 'old-late', 'new-early', 'marked', 'noenv'], '큐 순서 그대로(번호순으로 정렬하지 않음)');
    assert.deepEqual(r.items.map((x) => x.no ?? null), [null, 163, 172, 5, null], '위치 번호(1..5)가 아니라 고유 번호 · 없으면 칸 없음');
    assert.ok(!('no' in r.items[0]) && !('no' in r.items[4]));
    // 와이어: 항목 칸 no 가 잘리지 않고 순서 유지, 쓰레기 값은 거름
    const p = planFromRaw(r, { key: 'k' });
    assert.deepEqual(p.items.map((x) => x.id), ['plain', 'old-late', 'new-early', 'marked', 'noenv']);
    assert.deepEqual(p.items.map((x) => x.no ?? null), [null, 163, 172, 5, null]);
    const mn = planFromRaw(r, { key: 'k', privacy: 'minimal' });
    assert.deepEqual(mn.items.map((x) => x.no ?? null), [null, 163, 172, 5, null], '숫자라 minimal 에서도 유지');
    const bad = planFromRaw({ src: 'axes', title: 't', items: [{ title: 'a', state: 'pending', no: '7' }, { title: 'b', state: 'pending', no: -3 }, { title: 'c', state: 'pending', no: 1.5 }, { title: 'd', state: 'pending', no: 99999 }, { title: 'e', state: 'pending', no: 12 }] }, { key: 'b' });
    assert.deepEqual(bad.items.map((x) => x.no ?? null), [null, null, null, null, 12]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
