// 흐름 3D 세운 장치(배치 장치) · 입체 사용자 단말 — 순수 부분
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAND, standYawStep, yawToward } from '../flowview/tier-core.mjs';
import { consoleLook, CON_LOD_PX } from '../flowview/console-core.mjs';
import { IxModel, ixGeometry, CON3D, conBasis } from '../ix-core.mjs';
import { consoleLines } from '../user-core.mjs';
import { beamPoint, beamY } from '../flowview/flow-style.mjs';

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test('세운 장치 방위: 처음엔 바로 목표, 궤도(±16°) 안은 그대로 서 있고, 크게 벗어나면 부드럽게 돌아 맞춤 · 움직임 줄이기면 즉시', () => {
  assert.ok(near(yawToward(0, 0, 0, 10), 0), '+z 쪽 카메라 = 방위 0');
  assert.ok(near(yawToward(0, 0, 10, 0), Math.PI / 2));
  const st = {};
  assert.equal(standYawStep(st, 0.3, 0.016), 0.3);
  // 쉬는 동안 궤도 ±16° — 그대로
  for (const d of [0.2, -0.25, 0.27]) assert.equal(standYawStep(st, 0.3 + d, 0.016), 0.3);
  // 크게(60°) 돌리면 돌기 시작 → 수렴
  const tgt = 0.3 + 1.05;
  const y1 = standYawStep(st, tgt, 0.05);
  assert.ok(y1 > 0.3 && y1 < tgt, '한 걸음은 일부만');
  let y = y1;
  for (let i = 0; i < 60; i++) y = standYawStep(st, tgt, 0.05);
  assert.ok(near(y, tgt, 1e-3) && !st.turning, '수렴 뒤 멈춤');
  // ±π 경계도 최단 방향
  const w = { yaw: 3.0, turning: false };
  const y2 = standYawStep(w, -2.5, 0.05); // 3.0 → -2.5 는 +0.78 rad(π 를 넘어)
  assert.ok(y2 > 3.0 || y2 < -3.0, 'π 넘어 최단 방향으로 돎');
  // 움직임 줄이기: 벗어나면 즉시
  const r = { yaw: 0, turning: false };
  assert.equal(standYawStep(r, 1.2, 0.016, true), 1.2);
  assert.ok(STAND.HYST > (16 * Math.PI) / 180, '히스테리시스 > 쉬는 동안 궤도 진폭');
});

test('세운 장치 빔 끝점: noLift 면 떠오르지 않고 곧장 내려감(빔·패킷 같은 곡선)', () => {
  const a = { x: 0, y: 10, z: 0, noLift: true }, b = { x: 12, y: 2, z: 4 };
  const out = {};
  for (let i = 1; i < 10; i++) { beamPoint(out, a, b, i / 10, 0, true); assert.ok(out.y <= 10 + 1e-9, '장치 아래 변 위로 올라가지 않음'); }
  beamPoint(out, { x: 0, y: 10, z: 0 }, b, 0.1, 0, true);
  assert.ok(out.y > 10, '보통 노드는 예전처럼 떠올랐다 내려감');
  assert.ok(near(beamY(0, 10, 2, 0), 10) && near(beamY(1, 10, 2, 0), 2));
});

test('입체 단말 도형(env.solid): 화면이 방위대로 서서 뒤로 기울고, 집기 모서리·이름표·빔 출발점이 화면 면을 따름 · 2D/Planet 은 그대로', () => {
  const B = conBasis(0);
  assert.ok(near(B.n[1], Math.sin(CON3D.TILT)) && B.n[2] > 0.9, '법선은 앞·약간 위(뒤로 기욺)');
  assert.ok(B.v[2] < 0 && B.v[1] > 0.9, '화면 위쪽은 뒤로');
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  for (const yaw of [0, 0.7, -2.4]) { const b = conBasis(yaw); assert.ok(near(dot(b.r, b.v), 0) && near(dot(b.r, b.n), 0) && near(dot(b.v, b.n), 0), '직교'); }
  const pos = new Map([['a', { x: 0, y: 0, z: 0 }]]);
  const base = { theme: 'flow', pos: (id) => pos.get(id) || null, rad: () => 1, root: (id) => id, consoleRoots: () => ['a'], consoleInfo: () => consoleLines(null, Date.now()) };
  const flat = ixGeometry(new IxModel(), 1, base);
  const solid = ixGeometry(new IxModel(), 1, { ...base, solid: true, conYaw: () => 0.5 });
  const cf = flat.cons[0], cs = solid.cons[0];
  assert.ok(near(cf.x, cs.x) && near(cf.y, cs.y) && near(cf.z, cs.z), '화면 가운데 자리는 예전 그대로');
  assert.equal(cf.r, undefined, '선 단말(2D·예전)은 기저 없음');
  assert.ok(cs.r && cs.v && cs.n && near(cs.yaw, 0.5), '입체는 기저·방위');
  assert.ok(solid.nl < flat.nl, '틀·받침 선은 메시가 그림(선 수 줄어듦)');
  const lab = solid.clabels[0];
  assert.ok(lab.y > cs.y + CON3D.H * Math.cos(CON3D.TILT), '이름표는 기운 화면 윗변 위');
  const planet = ixGeometry(new IxModel(), 1, { ...base, theme: 'planet', solid: true, conYaw: () => 0.5 });
  assert.equal(planet.cons[0].r, undefined, 'Planet 관제소는 입체 단말 아님');
});

test('입체 단말 상태 모양: 대기 옅음 < 작업 중 < 질문, 표시등 색 열쇠, 움직임 줄이기면 깜빡임·스캔라인 없음', () => {
  const L = (state, o = {}) => consoleLook({ state, ...o }, 1.234, !!o.reduced);
  assert.ok(L('idle').glow < L('working').glow && L('working').glow < L('asking').glow);
  assert.equal(L('idle').led, 'dim'); assert.equal(L('working').led, 'read'); assert.equal(L('answered').led, 'ok'); assert.equal(L('asking').led, 'user'); assert.equal(L('alert').led, 'err');
  assert.equal(L('working', { fail: 0.8 }).led, 'err');
  assert.ok(L('answered', { dim: 0.6 }).glow < L('answered').glow, '오래 쉬면 어두워짐');
  const r = L('asking', { reduced: true });
  assert.equal(r.scan, 0); assert.equal(r.ledK, 1);
  assert.ok(CON_LOD_PX >= 20);
});
