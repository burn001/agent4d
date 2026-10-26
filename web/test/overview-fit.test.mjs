// 조망 샷(전체 조망·프로젝트 섬)도 '구도: 전체'와 같은 맞춤 점(활성 노드 + 도구 패널·라벨) — 섬 상자·작업 대상 층은 빼서 노드가 크게
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shotFitScope, refineFit, boxCenter, ZOOM } from '../camera-core.mjs';

const ALL = { mode: 'all', focusProject: null, focusSession: null };

test('조망 샷 범위: 전체 조망 = 전체(선택 프로젝트·세션 따름), 섬 = 그 섬, 노드·맞춤·단일 세션은 해당 없음', () => {
  assert.deepEqual(shotFitScope({ type: 'overview' }, ALL), { pid: null, sid: null });
  assert.deepEqual(shotFitScope({ type: 'overview' }, { ...ALL, focusProject: 'p1' }), { pid: 'p1', sid: null });
  assert.deepEqual(shotFitScope({ type: 'overview' }, { ...ALL, focusProject: 'p1', focusSession: 's1' }), { pid: 'p1', sid: 's1' });
  assert.deepEqual(shotFitScope({ type: 'cluster', pid: 'p2' }, { ...ALL, focusProject: 'p1', focusSession: 's1' }), { pid: 'p2', sid: null });
  assert.equal(shotFitScope({ type: 'cluster' }, ALL), null);
  assert.equal(shotFitScope({ type: 'node', id: 'a' }, ALL), null);
  assert.equal(shotFitScope({ type: 'fit' }, ALL), null);
  assert.equal(shotFitScope({ type: 'overview' }, { mode: 'session' }), null);
  assert.equal(shotFitScope(null, ALL), null);
});

test('노드·패널만 맞추면 섬 상자 꼭짓점까지 담을 때보다 훨씬 가깝다', () => {
  const R = { x: 1, y: 0, z: 0 }, U = { x: 0, y: 0.6, z: 0.8 }, F = { x: 0, y: -0.8, z: 0.6 };
  const nodes = [{ p: { x: 0, y: 1, z: 0 }, r: 1.5 }, { p: { x: 6, y: 1, z: 2 }, r: 1.5 }];
  const box = [[-30, -20], [30, -20], [-30, 20], [30, 20]].map(([x, z]) => ({ p: { x, y: 0, z }, r: 1.2 }));
  const a = refineFit(nodes, boxCenter(nodes), R, U, F, 0.5, 0.4, 4);
  const b = refineFit(nodes.concat(box), boxCenter(nodes.concat(box)), R, U, F, 0.5, 0.4, 4);
  assert.ok(a.D * 3 < b.D, `${a.D} vs ${b.D}`);
});

test('3D·2D 카메라가 조망 샷에 섬 노드 + 작업 대상 층(fitExtra)을 더 이상 담지 않는다', () => {
  const c3 = readFileSync(new URL('../camera.js', import.meta.url), 'utf8');
  const c2 = readFileSync(new URL('../flat/camera2d.js', import.meta.url), 'utf8');
  for (const s of [c3, c2]) {
    assert.ok(!/fitExtra3?d?\(/.test(s), 'fitExtra 호출 없음');
    assert.ok(s.includes('shotFitScope('), 'shotFitScope 사용');
  }
  assert.ok(/_fitFrame\(sc, this\.shotFit\)/.test(c3));
  assert.ok(/_fitFrame\(now, sc, this\.shotFit\)/.test(c2));
  assert.equal(ZOOM.CLUSTER_NODES, undefined);
});
