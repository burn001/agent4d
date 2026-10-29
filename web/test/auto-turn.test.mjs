// 사용자 아닌 것이 연 메인 턴의 연출(순수) — 예약 시계 · Monitor 패킷 · 작업 결과 패킷 · 출처가 안 보이면 메인 쪽만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IxModel, ixGeometry, ixAutoKind, IX_AUTO, IX_KEYS, ixKeyColor } from '../ix-core.mjs';
import { clientOp } from '../voxel/client-core.mjs';

const U = (ix, nodeId = 's:main') => ({ type: 'user', nodeId, origin: ix.src === 'schedule' ? 'schedule' : 'task-notification', text: 'x', ix: { v: 1, cat: 'user', op: 'auto', phase: 'end', ...ix } });
const POS = { 's:main': { x: 0, y: 0, z: 0 }, 'm:mon1': { x: 8, y: 0, z: 0 }, 'b:bg01': { x: -8, y: 0, z: 0 } };
const env = (hidden = new Set(), theme = 'flow') => ({ theme, pos: (id) => (hidden.has(id) ? null : POS[id] || null), rad: () => 1, root: () => 's:main', reduced: false });
const keyIs = (g, k) => { const i = IX_KEYS.indexOf(k); let n = 0; for (let j = 0; j < g.nl; j++) if (g.LC[j] === i) n++; for (let j = 0; j < g.nq; j++) if (g.QC[j] === i) n++; return n; };
const quadsNear = (g, x, tol = 1.5) => { let n = 0; for (let j = 0; j < g.nq; j++) if (Math.abs(g.Q[j * 4] - x) < tol) n++; return n; };

test('§114 ixAutoKind: 예약·Monitor·작업 결과·그 밖(회색 점)', () => {
  assert.equal(ixAutoKind({ cat: 'user', op: 'auto', src: 'schedule' }), 'schedule');
  assert.equal(ixAutoKind({ cat: 'user', op: 'auto', src: 'monitor', from: 'm:x' }), 'monitor');
  assert.equal(ixAutoKind({ cat: 'user', op: 'auto', src: 'notify', from: 'b:x', st: 'ok' }), 'result');
  assert.equal(ixAutoKind({ cat: 'user', op: 'auto', src: 'notify' }), 'dot');
  assert.equal(ixAutoKind({ cat: 'user', op: 'auto', src: 'system' }), 'dot');
  assert.equal(ixAutoKind({ cat: 'user', op: 'prompt' }), null);
  for (const k of ['sched', 'mon']) for (const L of [false, true]) assert.match(ixKeyColor(k, L), /^#[0-9a-f]{6}$/);
});

test('§114 예약 = 메인 옆 시계(청록) → 메인, 리본 ⏰ · 잔광은 회색 점보다 길다', () => {
  for (const theme of ['flow', 'planet']) {
    const m = new IxModel();
    m.event(U({ src: 'schedule', text: '정시 보고 — /peek 결과로' }), 0, 1, () => 's:main');
    const g0 = ixGeometry(m, 0.5, env(new Set(), theme));
    assert.ok(keyIs(g0, 'sched') > 6, theme + ' 시계 얼굴·바늘');
    assert.ok(g0.labels.some((l) => l.text.startsWith('⏰ 정시 보고')), '리본');
    const g1 = ixGeometry(m, 1.3, env(new Set(), theme));
    assert.ok(keyIs(g1, 'sched') > 6, '시계에서 메인으로');
    m.step(2.5); assert.equal(m.size, 1, '2.5초 뒤에도 남음');
    m.step(IX_AUTO.LINGER_S + 0.1); assert.equal(m.size, 0);
  }
  const d = new IxModel(); d.event(U({ src: 'notify' }), 0); d.step(1.1); assert.equal(d.size, 0, '회색 점은 예전처럼 1초');
});

test('§114 Monitor 출력 = Monitor 노드에서 메인으로 보라 패킷 · 숨으면 메인 쪽만', () => {
  const m = new IxModel();
  m.event(U({ src: 'monitor', from: 'm:mon1', text: '[커밋] e668daf0e fix' }), 0);
  const g = ixGeometry(m, 0.2, env());
  assert.ok(keyIs(g, 'mon') > 3);
  assert.ok(quadsNear(g, 6.5, 2) > 0, '패킷이 Monitor 쪽(x≈8)에서 출발');
  assert.ok(g.labels.some((l) => l.text.startsWith('◎ [커밋]')));
  const h = ixGeometry(m, 0.2, env(new Set(['m:mon1'])));
  assert.equal(quadsNear(h, 6.5, 2), 0, '출처가 숨으면 빔·패킷 없음');
  assert.ok(h.labels.some((l) => l.text.startsWith('◎ [커밋]')), '메인 위 리본은 남음');
  const h2 = ixGeometry(m, 0.4, env(new Set(['m:mon1'])));
  assert.ok(keyIs(h2, 'mon') > 0, '메인 고리');
});

test('§114 작업 결과 = 출처 → 메인 결과 패킷, 닿으면 ✓·✕·■ 배지', () => {
  for (const [st, key, badge] of [['ok', 'ok', '✓'], ['err', 'err', '✕'], ['stop', 'dim', '■']]) {
    const m = new IxModel();
    m.event(U({ src: 'notify', from: 'b:bg01', st, text: 'build 끝' }), 0);
    const g0 = ixGeometry(m, 0.2, env());
    assert.ok(keyIs(g0, key) > 0 && quadsNear(g0, -6.5, 2) > 0, st + ' 패킷');
    assert.ok(!g0.labels.some((l) => l.text === badge), '닿기 전엔 배지 없음');
    const g1 = ixGeometry(m, IX_AUTO.TRAVEL_S + 0.4, env());
    assert.ok(g1.labels.some((l) => l.text === badge && l.cls === 'ix-badge'), st + ' 배지');
    const g2 = ixGeometry(m, 0.3, env(new Set(['b:bg01'])));
    assert.ok(g2.labels.some((l) => l.text === badge), '출처가 퇴장했으면 바로 메인 배지');
  }
});

test('§114 자동 턴은 사용자 콘솔 상태(프롬프트 시각)를 바꾸지 않고 복셀 의뢰인 창구도 열지 않는다', () => {
  const m = new IxModel();
  m.event(U({ src: 'schedule' }), 0, 1, () => 's:main');
  m.event(U({ src: 'monitor', from: 'm:mon1' }), 0.1, 1, () => 's:main');
  assert.equal(m.console.get('s:main').promptAt, null);
  assert.equal(clientOp(U({ src: 'schedule' }), () => true, {}), null);
});
