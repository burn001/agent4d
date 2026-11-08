// 재생 일시정지 중 시점 이동(타임라인 끌기·클릭·, . < >) 뒤 카메라 다시 잡기: 이동이 멎으면 새 장면에 맞는 자동 구도로
// 한 번 부드럽게 날아가고 그 자리에 멈춘다(투어 재개 아님). 끄는 중·손 끌기·상세 팝업 중엔 끼어들지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

async function scene() {
  globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
  const { Director2D } = await import('../flat/camera2d.js');
  const vis = new Map();
  for (let i = 0; i < 6; i++) { const x = 100 + (i % 3) * 20, z = 50 + Math.floor(i / 3) * 20; vis.set('n' + i, { id: 'n' + i, node: { id: 'n' + i, rootSessionId: 'S' }, target: { x, y: 0, z }, pos: { x, y: 0, z }, r: 1, icons: { size: 0 } }); }
  const canvas = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  const view = { vis, canvas, W: 800, H: 600, cam: { x: -500, z: -500, D: 400 }, invalidate() {}, has: (id) => vis.has(id), children: () => [], parentOf: new Map(), clusters: () => [], clock: () => Date.now(), pf: { hide: new Set() } };
  const d = new Director2D(view, (id) => vis.get(id) && vis.get(id).node);
  d.setEnabled(false); // 얼림(setReplayFrozen)과 같은 상태
  d.trans = null; d.focusFly = false;
  return { d, view };
}

test('2D settle: 얼린 상태에서 새 장면 맞춤으로 날아가 멈추고, 그 뒤엔 움직이지 않음(투어 재개 아님)', async () => {
  const { d, view } = await scene();
  const t0 = performance.now() / 1000;
  for (let k = 0; k < 5; k++) d.update(0.016, t0 + k * 0.1);
  assert.deepEqual([view.cam.x, view.cam.z, view.cam.D], [-500, -500, 400], '얼린 동안 저절로 움직이지 않음');
  assert.equal(d.settle(1.0), true);
  assert.equal(d.enabled, false, '자동 카메라는 꺼진 채');
  let t = performance.now() / 1000;
  d.update(0.016, t + 0.5);
  assert.ok(view.cam.x > -500 && view.cam.x < 130, '중간: 부드럽게 가는 중');
  d.update(0.016, t + 1.05);
  assert.equal(d.trans, null, '비행 끝');
  assert.ok(Math.abs(view.cam.x - 120) < 30 && Math.abs(view.cam.z - 60) < 40, `노드 무리 쪽(${view.cam.x}, ${view.cam.z})`);
  assert.ok(view.cam.D < 400);
  const after = [view.cam.x, view.cam.z, view.cam.D];
  for (let k = 1; k <= 30; k++) d.update(0.5, t + 1.05 + k);
  assert.deepEqual([view.cam.x, view.cam.z, view.cam.D], after, '잡은 뒤엔 정지 유지(30초 지나도)');
  assert.equal(d.mode, 'manual');
});

test('2D settle: 손 끌기·상세 팝업 중이면 끼어들지 않고, 비행 중 손이 닿으면 멈춤', async () => {
  const { d, view } = await scene();
  d.dragging = true; assert.equal(d.settle(), false); d.dragging = false;
  d.hold = { follow: false }; assert.equal(d.settle(), false); d.hold = null;
  assert.equal(d.settle(1.0), true);
  d._manual(); // 손 조작(휠·끌기)
  const at = [view.cam.x, view.cam.z, view.cam.D];
  d.update(0.016, performance.now() / 1000 + 0.5);
  assert.deepEqual([view.cam.x, view.cam.z, view.cam.D], at);
});

test('배선: 정지 중 스냅샷 → settleReplaySoon(디바운스, 끄는 중 건너뜀) → director.settle, 3D·2D 둘 다', () => {
  const app = src('../app.js'), ui = src('../replay/ui.mjs'), c3 = src('../camera.js'), c2 = src('../flat/camera2d.js');
  assert.match(app, /onSnapshot\(s, replayFrozen \? \{ keepCamera: true \} : \{\}\); thawReplayBriefly\(\); settleReplaySoon\(\);/);
  assert.match(app, /function settleReplaySoon\(\)[\s\S]{0,300}clearTimeout\(replaySettleTimer\)[\s\S]{0,200}!autoCam \|\| \(ui && ui\.scrubbing\)\) return;[\s\S]{0,80}director\.settle\(REPLAY_SETTLE_FLY\)/);
  assert.match(app, /function setReplayFrozen[\s\S]{0,300}clearTimeout\(replaySettleTimer\)/, '정지를 풀면 예약 취소');
  assert.match(ui, /get scrubbing\(\) \{ return dragging; \}/);
  assert.match(c3, /settle\(dur = 1\.0\) \{[\s\S]{0,200}this\.dragging \|\| this\.hold \|\| \(this\.pov && this\.pov\.active\)[\s\S]{0,400}this\.focusFly = true/);
  assert.match(c2, /settle\(dur = 1\.0\) \{[\s\S]{0,400}this\.focusFly = true/);
});

test('자동 카메라를 꺼 두었으면 정지 중 이동 뒤 다시 잡지 않음(재생 중 이동 규칙은 그대로)', () => {
  const app = src('../app.js');
  const fn = app.slice(app.indexOf('function settleReplaySoon()'), app.indexOf('function settleReplaySoon()') + 500);
  assert.match(fn, /if \(!replayFrozen \|\| !autoCam \|\| \(ui && ui\.scrubbing\)\) return;[\s\S]{0,200}director\.settle\(REPLAY_SETTLE_FLY\)/);
  assert.match(app, /onSnapshot\(s, replayFrozen \? \{ keepCamera: true \} : \{\}\)/, '재생 중(얼리지 않음) 이동은 예전처럼 새 장면으로');
});
