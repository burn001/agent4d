// 흐름(Flow) 표현의 순수 부분
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeVisualState, NODE_STATE, stateColor, paletteOf, kindIcon, KIND_ICON, beamControls, beamPoint, beamWidth, BEAM, breathe, BubbleBook, BUBBLE } from '../flowview/flow-style.mjs';
import { RENDERERS, RENDERER_ORDER, RENDERER_LABEL, DEFAULT_RENDERER, storedRenderer, nextRenderer, isRenderer, normRenderer } from '../renderers.js';
import { KINDS } from '../layout.js';

test('노드 표시 상태: 생각(작업 중·도구 없음)·도구 사용·완료·오류·중지·대기', () => {
  assert.equal(nodeVisualState('active', 0), NODE_STATE.thinking);
  assert.equal(nodeVisualState('active', 2), NODE_STATE.tool);
  assert.equal(nodeVisualState('idle', 3), NODE_STATE.idle);
  assert.equal(nodeVisualState('done'), NODE_STATE.done);
  assert.equal(nodeVisualState('error', 1), NODE_STATE.error);
  assert.equal(nodeVisualState('stopped'), NODE_STATE.stopped);
  // agent-flow 상태색: 생각 하늘·도구 호박·완료 초록·오류 빨강
  assert.equal(stateColor(NODE_STATE.thinking), '#66ccff');
  assert.equal(stateColor(NODE_STATE.tool), '#ffbb44');
  assert.equal(stateColor(NODE_STATE.done), '#66ffaa');
  assert.equal(stateColor(NODE_STATE.error), '#ff5566');
  assert.notEqual(stateColor(NODE_STATE.tool, true), stateColor(NODE_STATE.tool, false), '라이트는 진하게');
  for (const k of ['void', 'holo', 'dispatch', 'ret', 'interior', 'text']) { assert.ok(paletteOf(false)[k]); assert.ok(paletteOf(true)[k]); }
  for (const k of KINDS) assert.ok(KIND_ICON[k] != null, k);
  assert.equal(kindIcon('없음'), KIND_ICON.subagent);
});

test('곡선 빔: 양 끝 일치, 진행 방향 왼쪽으로 휨, 굵기는 끝으로 가늘게, 결과 입자는 같은 빔을 거꾸로', () => {
  const a = { x: 0, y: 0, z: 0 }, b = { x: 10, y: 0, z: 0 }, o = {};
  beamPoint(o, a, b, 0); assert.deepEqual([o.x, o.z], [0, 0]);
  beamPoint(o, a, b, 1); assert.ok(Math.abs(o.x - 10) < 1e-9 && Math.abs(o.z) < 1e-9);
  beamPoint(o, a, b, 0.5); assert.ok(o.z > 0.5, '왼쪽(+z)으로 휨: ' + o.z);
  const c = beamControls(a, b); assert.equal(c.dist, 10);
  assert.equal(beamControls(a, a), null);
  assert.equal(beamWidth(0), BEAM.startW); assert.ok(Math.abs(beamWidth(1) - BEAM.endW) < 1e-12);
  // FlowView.linkPath 와 같은 규칙: 결과(arc<0)는 (부모,자식) 빔을 1-u 로
  const up = {}, down = {};
  beamPoint(down, a, b, 0.3); beamPoint(up, a, b, 1 - 0.7);
  assert.ok(Math.abs(up.x - down.x) < 1e-9 && Math.abs(up.z - down.z) < 1e-9);
  beamPoint(o, a, b, 0.5, 1); assert.ok(o.z > c.dist * 0 + 1, '흔들림은 수직 방향');
});

test('숨쉬기·말풍선 장부', () => {
  assert.equal(breathe(NODE_STATE.done, 1), 1);
  assert.ok(Math.abs(breathe(NODE_STATE.thinking, 0.4) - 1) <= 0.03 + 1e-9);
  const bb = new BubbleBook(2);
  bb.push('a', 'text', '첫 말', 0);
  bb.push('a', 'text', '둘째 말', 1);
  assert.equal(bb.items.length, 1, '같은 노드는 마지막 하나');
  bb.push('b', 'user', 'x'.repeat(500), 1);
  assert.ok(bb.items[1].text.length <= BUBBLE.CHARS);
  bb.push('c', 'result', '끝', 2);
  assert.deepEqual(bb.items.map((x) => x.nodeId), ['b', 'c'], '상한 넘으면 오래된 것부터');
  assert.equal(bb.push('d', 'text', '   ', 3), null);
  const live = bb.live(2 + BUBBLE.HOLD + BUBBLE.FADE / 2);
  assert.ok(live.find((x) => x.nodeId === 'c').alpha < 1 && live.find((x) => x.nodeId === 'c').alpha > 0);
  assert.equal(bb.live(100).length, 0);
});

test('표현 등록: 흐름(기본)·Planet(예전 단순 도형)·복셀, 옛 값 호환', () => {
  assert.equal(DEFAULT_RENDERER, 'flow');
  assert.ok(isRenderer('flow') && isRenderer('planet') && isRenderer('voxel'));
  assert.ok(!isRenderer('shapes'));
  assert.deepEqual(RENDERER_ORDER, ['flow', 'planet', 'voxel']);
  assert.equal(RENDERER_LABEL.flow, '흐름'); assert.equal(RENDERER_LABEL.planet, 'Planet');
  assert.equal(nextRenderer('flow'), 'planet'); assert.equal(nextRenderer('voxel'), 'flow');
  assert.equal(normRenderer('shapes'), 'planet'); assert.equal(normRenderer('shape'), 'planet'); assert.equal(normRenderer('voxel'), 'voxel');
  assert.equal(normRenderer('흐름'), 'flow'); assert.equal(normRenderer('agent-flow'), 'flow'); assert.equal(storedRenderer('flow', null), 'flow', '기존 저장값 flow 그대로');
  assert.equal(storedRenderer(null, 'shapes'), 'flow', '옛 저장값 "도형"은 새 기본(흐름)으로 시작');
  assert.equal(storedRenderer(null, 'voxel'), 'voxel');
  assert.equal(storedRenderer('planet', 'voxel'), 'planet', '새 키가 우선');
  assert.equal(storedRenderer('shapes', null), 'planet', '새 키의 옛 이름도 호환');
  assert.equal(typeof RENDERERS.flow, 'function');
});

test('§67 빔 은은하게: 작업 중 0.2(라이트 ≤0.3) > 대기 > 완료, 패킷 구간만 밝게, 패킷 위치는 부모→자식 기준', async () => {
  const { beamAlpha, packetGlow, BEAM } = await import('../flowview/flow-style.mjs');
  const { linkPackets } = await import('../flow-core.mjs');
  for (const L of [false, true]) {
    const act = beamAlpha('active', L), idle = beamAlpha('idle', L), done = beamAlpha('done', L);
    assert.ok(act >= 0.18 && act <= 0.32, `active ${act}`);
    assert.ok(act > idle && idle > done && done > 0);
  }
  assert.ok(BEAM.glowAlpha <= 0.03);
  assert.equal(packetGlow(0.5, []), 0);
  assert.ok(packetGlow(0.5, [0.5]) > 0.4 && packetGlow(0.9, [0.5]) < 0.01);
  const par = { c: 'p', p: null };
  const m = linkPackets([{ live: true, from: 'p', to: 'c', dur: 1, t0: 0 }, { live: true, from: 'c', to: 'p', dur: 1, t0: 0 }, { live: true, from: 'x', to: 'y', dur: 1, t0: 0 }], 0.25, (id) => par[id] ?? null);
  assert.deepEqual([...m.keys()], ['p|c']);
  const [down, up] = m.get('p|c');
  assert.ok(down < 0.5 && up > 0.5 && Math.abs(down + up - 1) < 1e-9, '결과는 거꾸로');
});

test('§67 흐르는 대시: 작업 중이 대기보다 빠르고 밝음, 끝남·중지는 멈춤, 혜성 모양(머리 뒤 밝음)이 시간에 따라 부모→자식으로 이동', async () => {
  const { flowDash, dashShape, FLOW_DASH, packetWobble } = await import('../flowview/flow-style.mjs');
  const A = flowDash('active'), I = flowDash('idle');
  assert.ok(A.speed > I.speed && A.amp > I.amp);
  assert.equal(flowDash('done').speed, 0); assert.equal(flowDash('stopped').speed, 0);
  assert.equal(dashShape(1, 0, 0), 0);
  // 머리(가장 밝은 곳)가 시간이 지나면 +s 쪽으로
  const peak = (time) => { let best = 0, bs = 0; for (let s = 0; s < FLOW_DASH.gap; s += 0.01) { const v = dashShape(s, time, 2); if (v > best) { best = v; bs = s; } } return bs; };
  const p0 = peak(0.1), p1 = peak(0.4);
  assert.ok(((p1 - p0 + FLOW_DASH.gap) % FLOW_DASH.gap) > 0.3 && ((p1 - p0 + FLOW_DASH.gap) % FLOW_DASH.gap) < 1.0, `${p0}→${p1}`);
  assert.ok(Math.abs(packetWobble(0.5, 1)) <= 0.35 + 1e-9);
});
