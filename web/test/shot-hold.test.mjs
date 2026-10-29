// 좁은 구도(노드 샷·초점·따라가기) 목표 붙잡기 — 순수 ShotHold 와 2D 디렉터(3D camera.js 도 같은 ShotHold·같은 규칙)
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function director2d() {
  globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
  const { Director2D } = await import('../flat/camera2d.js');
  const node = (id) => ({ id, label: id, status: 'active', projectId: 'P', rootSessionId: 'S', parentId: id === 'b' ? null : 'b' });
  const mk = (id, x, z) => ({ id, node: node(id), target: { x, y: 0, z }, pos: { x, y: 0, z }, r: 1, icons: { size: 0 } });
  const vis = new Map([['b', mk('b', 40, 0)], ['k1', mk('k1', 44, 0)], ['k2', mk('k2', 40, 4)], ['k3', mk('k3', 37, -3)]]);
  const canvas = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  let lr = { top: 0, bottom: 0, left: 0, right: 0 };
  const view = {
    vis, canvas, W: 800, H: 600, cam: { x: 40, z: 0, D: 12 }, invalidate() {}, has: (id) => vis.has(id) && !vis.get(id).hidden,
    children: (id) => (id === 'b' ? [...vis.keys()].filter((k) => k !== 'b' && !vis.get(k).hidden) : []), parentOf: new Map(),
    nodeCluster: () => 'P', clusters: () => [], clock: () => Date.now(), labelBelow: true, labelReserve: () => lr,
  };
  const d = new Director2D(view, (id) => vis.get(id) && vis.get(id).node);
  return { d, view, vis, setLabels: (b) => { lr = { top: 0, bottom: b, left: 0, right: 0 }; } };
}
/** 노드 샷(따라가기) b 를 자동으로 비추는 중: 8초 순환이 다시 고르지 않게 */
function followB(d, t) {
  d.camMode = 'follow'; d.mode = 'auto'; d.shot = { type: 'node', id: 'b' }; d.lastSwitch = t + 1e6; d.lastEventAt = t + 1e6; d._startTransition(0.5);
}
const run = (d, t, sec, each) => { const n = Math.round(sec / 0.02); for (let i = 0; i < n; i++) { t += 0.02; if (each) each(t, i); d.update(0.02, t); } return t; };

test('§124 ShotHold: 데드밴드 안이면 그대로, 넓어져야 하면 곧바로, 좁혀도 되면 HOLD 초 뒤, 다시 배치(JUMP)는 곧바로', async () => {
  const { ShotHold, SHOT_HOLD, shotKey } = await import('../camera-core.mjs');
  const h = new ShotHold();
  const k = shotKey({ type: 'node', id: 'b' });
  assert.equal(k, 'n:b');
  assert.notEqual(shotKey({ type: 'node', id: 'b', wide: true }), k);
  let r = h.step(0, k, { x: 0, z: 0 }, 10, 5, 0.1);
  assert.equal(r.moved, true);
  // 화면 반높이(unit 5)의 DB_C 안 · 거리 ±3% — 그대로(함께 붙잡는 값 x 도)
  for (let t = 0.1; t < 10; t += 0.1) {
    r = h.step(t, k, { x: (Math.sin(t * 7) * SHOT_HOLD.DB_C * 5) * 0.9, z: 0 }, 10 * (1 + 0.03 * Math.sin(t * 5)), 5, 0.1 + 0.05 * Math.sin(t));
    assert.equal(r.moved, false);
    assert.deepEqual([r.c.x, r.c.z, r.D, r.x], [0, 0, 10, 0.1]);
  }
  // 넓어져야 함(잘림): 곧바로
  r = h.step(10, k, { x: 0, z: 0 }, 10 * (SHOT_HOLD.GROW + 0.02), 5);
  assert.equal(r.moved, true);
  const D1 = r.D;
  // 좁혀도 됨: HOLD 초 동안 이어질 때만
  r = h.step(11, k, { x: 0, z: 0 }, D1 * 0.7, 5);
  assert.equal(r.moved, false);
  r = h.step(11 + SHOT_HOLD.HOLD * 0.5, k, { x: 0, z: 0 }, D1, 5); // 중간에 되돌아오면 타이머 리셋
  r = h.step(11 + SHOT_HOLD.HOLD * 1.2, k, { x: 0, z: 0 }, D1 * 0.7, 5);
  assert.equal(r.moved, false, '되돌아온 뒤 다시 센다');
  r = h.step(11 + SHOT_HOLD.HOLD * 2.3, k, { x: 0, z: 0 }, D1 * 0.7, 5);
  assert.equal(r.moved, true);
  // 다시 배치(화면 반높이의 JUMP 넘게): 곧바로 · 다른 샷: 곧바로
  r = h.step(20, k, { x: 5 * (SHOT_HOLD.JUMP + 0.1), z: 0 }, r.D, 5);
  assert.equal(r.moved, true);
  assert.equal(h.step(20.1, 'n:c', { x: 0, z: 0 }, 3, 3).moved, true);
});

test('§124 2D 따라가기: 상태 변동(라벨 자리·자식 크기)을 연달아 넣어도 데드밴드 안이면 카메라가 안 움직인다', async () => {
  const { d, vis, setLabels } = await director2d();
  let t = performance.now() / 1000;
  followB(d, t);
  t = run(d, t, 4); // 날아가 자리 잡기
  const cam = d.cam;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, D0 = Infinity, D1 = -Infinity;
  run(d, t, 12, (tt, i) => {
    if (i % 35 === 0) { const on = (i / 35) % 2 === 1; setLabels(on ? 120 : 0); vis.get('k2').r = on ? 1.25 : 1; } // 0.7초마다 토글
    x0 = Math.min(x0, cam.x); x1 = Math.max(x1, cam.x); z0 = Math.min(z0, cam.z); z1 = Math.max(z1, cam.z); D0 = Math.min(D0, cam.D); D1 = Math.max(D1, cam.D);
  });
  const shake = Math.max(x1 - x0, z1 - z0, D1 - D0) / cam.D;
  assert.ok(shake < 0.002, `흔들림 ${shake.toFixed(4)} (반높이 대비)`);
});

test('§124 2D 따라가기: 큰 변화(먼 자식 등장)는 곧바로 따라가고, 사라지면 HOLD 뒤 다시 좁힘 · 끌기·휠은 존중', async () => {
  const { d, vis } = await director2d();
  let t = performance.now() / 1000;
  followB(d, t);
  t = run(d, t, 4);
  const Dn = d.cam.D;
  vis.set('far', { id: 'far', node: { id: 'far', status: 'active', parentId: 'b' }, target: { x: 62, y: 0, z: 0 }, pos: { x: 62, y: 0, z: 0 }, r: 1, icons: { size: 0 } });
  t = run(d, t, 3);
  assert.ok(d.cam.D > Dn * 1.3, `넓어짐 ${Dn.toFixed(2)} → ${d.cam.D.toFixed(2)}`);
  assert.ok(d.cam.x > 44, '가운데도 옮김');
  vis.delete('far');
  t = run(d, t, 1);
  assert.ok(d.cam.D > Dn * 1.2, '좁히기는 바로 하지 않음');
  t = run(d, t, 5);
  assert.ok(Math.abs(d.cam.D - Dn) / Dn < 0.05, `HOLD 뒤 다시 좁힘 ${d.cam.D.toFixed(2)}`);
  // 휠 = 수동: 큰 변화가 와도 그대로(10초 규칙)
  d._wheel({ preventDefault() {}, deltaY: 300, deltaMode: 0, clientX: 400, clientY: 300 });
  d.lastInput = t; // 시험 시계(t)는 실제 시계보다 앞서 있음
  const after = { x: d.cam.x, z: d.cam.z, D: d.cam.D };
  assert.ok(Math.abs(after.D - Dn) > 0.5, '휠이 줌을 바꿈');
  vis.set('far', { id: 'far', node: { id: 'far', status: 'active', parentId: 'b' }, target: { x: 62, y: 0, z: 0 }, pos: { x: 62, y: 0, z: 0 }, r: 1, icons: { size: 0 } });
  t = run(d, t, 5);
  assert.deepEqual({ x: d.cam.x, z: d.cam.z, D: d.cam.D }, after, '수동 조작 중엔 움직이지 않음');
});

test('§124 2D 초점(§123 지켜보기): 작은 변화엔 다시 날지 않는다', async () => {
  const { d, vis, setLabels } = await director2d();
  let t = performance.now() / 1000;
  d.focusNode('b');
  t = run(d, t, 1.4);
  const p = { x: d.cam.x, z: d.cam.z, D: d.cam.D };
  let flies = 0;
  run(d, t, 3, (tt, i) => { if (i % 25 === 0) { const on = (i / 25) % 2 === 1; setLabels(on ? 120 : 0); vis.get('k2').r = on ? 1.25 : 1; } if (d.trans) flies++; });
  assert.equal(flies, 0, '다시 비행 없음');
  assert.deepEqual({ x: d.cam.x, z: d.cam.z, D: d.cam.D }, p);
});

test('§124 복셀 캐릭터 가는 자리(goalSpot): 걷는 중이면 도착할 자리, 책상 목표는 좌석, 목표 없으면 좌석 → 지금 위치', async () => {
  const { Character } = await import('../voxel/character-core.mjs');
  const ch = new Character('a:x', { id: 'a:x', kind: 'subagent', status: 'active' });
  ch.pos = { x: 3, z: 4 };
  assert.deepEqual(ch.goalSpot(), { x: 3, z: 4 }, '좌석 없음 → 지금 위치');
  ch.seat = { x: 1, z: 2, face: 0 };
  assert.equal(ch.goalSpot(), ch.seat);
  ch.target = { key: 'st', type: 'station', spot: { x: 9, z: 9 } }; ch.state = 'walk';
  assert.deepEqual(ch.goalSpot(), { x: 9, z: 9 }, '걷는 중 = 작업대 자리');
  ch.target = { key: 'desk:1,2', type: 'desk', spot: null };
  assert.equal(ch.goalSpot(), ch.seat, '책상으로 돌아가는 중 = 좌석');
  ch.target = { key: 'leave', type: 'door', spot: { x: 20, z: 0 } }; ch.state = 'leave';
  assert.equal(ch.goalSpot(), ch.seat, '퇴장(문으로) = 좌석 — 구도를 문까지 넓히지 않음');
});

test('§124 복셀식 노드 샷(2D 디렉터): 캐릭터가 걷는 동안 구도는 가는 자리에 고정, 자리가 바뀌면 한 번만 옮김', async () => {
  const { d, view, vis } = await director2d();
  const goal = new Map([['b', { x: 40, z: 0 }], ['k2', { x: 40, z: 4 }]]);
  view.shotTarget = (id) => { const g = goal.get(id); return g ? { x: g.x, y: 0, z: g.z } : vis.get(id).target; };
  let t = performance.now() / 1000;
  followB(d, t);
  t = run(d, t, 4);
  const p0 = { x: d.cam.x, z: d.cam.z, D: d.cam.D };
  // k2 가 (40,4) → (40,4) 로 돌아오는 길에 이리저리 걸음(지금 위치만 바뀌고 가는 자리는 그대로)
  t = run(d, t, 6, (tt, i) => { vis.get('k2').target.x = 40 + 6 * Math.sin(i / 9); vis.get('k2').target.z = 4 + 5 * Math.cos(i / 7); });
  assert.deepEqual({ x: d.cam.x, z: d.cam.z, D: d.cam.D }, p0, '걸음마다 흔들리지 않음');
  // b 가 다른 자리(60,0)로 가기 시작 — 가는 자리가 바뀜: 한 번 다시 정하고 부드럽게 그쪽으로
  const c0 = d._shotHold.commits;
  goal.set('b', { x: 60, z: 0 }); goal.set('k2', { x: 60, z: 4 });
  let prev = d.cam.x, back = 0;
  t = run(d, t, 5, (tt, i) => { vis.get('b').target.x = 40 + Math.min(20, i * 0.1); if (d.cam.x < prev - 1e-9) back++; prev = d.cam.x; });
  assert.equal(d._shotHold.commits - c0, 1, '한 번만 다시 정함');
  assert.equal(back, 0, '되돌아가지 않고 한 방향으로');
  assert.ok(d.cam.x > p0.x + 6 && Math.abs(d.cam.x - d._shotHold.c.x) < 0.3, `새 자리로 ${p0.x.toFixed(2)} → ${d.cam.x.toFixed(2)}`);
});
