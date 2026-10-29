// 자율 루프 판 — 축 큐 어댑터(내장): relaunch.sh AXIS_QUEUE → 축 env → 설계서 단계 표식 → status.json 지금 축.
// 레이아웃이 없으면 null(조용히). 라이브 런타임은 재기동기(기동기 노드)가 있을 때만 그 노드 meta.plans 에 싣는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopAxesPlan, axisSteps } from '../loop-axes.mjs';
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
