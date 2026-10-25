// 같은 프로젝트 여러 live 메인: 섬 안 배치(마주 보기·파이·지난 메인 배정·균형 둘레) 순수 시험
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOverview } from '../overview/layout.mjs';
import { nodeExtent } from '../layout.js';

const T0 = Date.parse('2026-10-24T03:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
let ord = 0;
const N = (id, parentId, kind, extra = {}) => ({ id, parentId, kind, projectId: 'P', status: 'active', _order: ord++, startedAt: iso(T0), lastActivityAt: iso(T0), meta: {}, ...extra });

/** live 메인 n 개(자식 k 개씩) + 지난 메인 past 개 */
function world(n, k = 6, past = []) {
  ord = 0;
  const nodes = new Map(), roots = [], liveList = [];
  for (let i = 0; i < n; i++) {
    const sid = `L${i}`, mid = 's:' + sid;
    nodes.set(mid, N(mid, null, 'main', { sessionId: sid, rootSessionId: sid, startedAt: iso(T0 + i * 600_000) }));
    roots.push({ nodeId: mid, projectId: 'P' });
    liveList.push({ sessionId: sid, entrypoint: 'cli', liveStatus: 'busy', activityAt: iso(T0 + 3600_000 - i * 1000) });
    for (let c = 0; c < k; c++) nodes.set(`a:${sid}-${c}`, N(`a:${sid}-${c}`, mid, c % 4 === 3 ? 'bash-bg' : 'subagent', { rootSessionId: sid }));
  }
  for (const p of past) {
    const mid = 's:' + p.sid;
    nodes.set(mid, N(mid, null, 'main', { sessionId: p.sid, rootSessionId: p.sid, status: 'idle', startedAt: iso(p.end - 600_000), lastActivityAt: iso(p.end) }));
    roots.push({ nodeId: mid, projectId: 'P' });
    for (let c = 0; c < 3; c++) nodes.set(`a:${p.sid}-${c}`, N(`a:${p.sid}-${c}`, mid, 'subagent', { rootSessionId: p.sid, lastActivityAt: iso(p.end) }));
  }
  return { nodes, roots, projects: [{ projectId: 'P', name: 'p', live: true, active: true, liveList }] };
}

function overlaps(nodes, pos) {
  const ids = [...pos.keys()], out = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = pos.get(ids[i]), b = pos.get(ids[j]);
    if (Math.hypot(a.x - b.x, a.z - b.z) < nodeExtent(nodes.get(ids[i])) + nodeExtent(nodes.get(ids[j])) - 1e-6) out.push([ids[i], ids[j]]);
  }
  return out;
}
const rootOfId = (id) => (id.startsWith('a:') ? 's:' + id.slice(2).split('-')[0] : id);

test('live 메인 2개(Flow): 좌우 마주 보기, 무리는 각 메인 바깥쪽, 겹침 0, 공전 고리', () => {
  const w = world(2, 8);
  const ov = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: T0 + 3600_000, facing: true, spread: 1.3 });
  const c = ov.clusters[0];
  assert.equal(c.layoutMode, 'facing');
  assert.deepEqual(c.liveMains, ['s:L0', 's:L1']);
  const a = ov.pos.get('s:L0'), b = ov.pos.get('s:L1');
  const ox = c.center.x + (c.orbit.cx || 0), oz = c.center.z + (c.orbit.cz || 0);
  assert.ok(a.x < ox && b.x > ox, '좌·우');
  assert.ok(Math.abs(a.z - oz) < 1e-6 && Math.abs(b.z - oz) < 1e-6);
  for (const [id, p] of ov.pos) {
    if (!id.startsWith('a:')) continue;
    const m = ov.pos.get(rootOfId(id));
    const out = m.x < ox ? -1 : 1;
    assert.ok((p.x - m.x) * out > 0, `${id} 는 자기 메인 바깥쪽`);
  }
  assert.deepEqual(overlaps(w.nodes, ov.pos), []);
  assert.ok(c.orbit && Math.abs(c.orbit.r - Math.abs(a.x - ox)) < 1e-6);
  // 두 메인은 중앙 가까이(무리 반지름보다 가깝게)
  assert.ok(Math.abs(b.x - a.x) < 40, `메인 사이 ${Math.abs(b.x - a.x)}`);
});

test('live 메인 3개: 삼각(위·오른쪽 아래·왼쪽 아래), 겹침 0', () => {
  const w = world(3, 7);
  const ov = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: T0 + 3600_000, facing: true, spread: 1.3 });
  const c = ov.clusters[0];
  assert.equal(c.layoutMode, 'facing');
  const ox = c.center.x + (c.orbit.cx || 0), oz = c.center.z + (c.orbit.cz || 0); // 공전 고리 중심(섬 상자 가운데와 조금 다를 수 있음)
  const ang = (id) => { const p = ov.pos.get(id); return (Math.atan2(p.z - oz, p.x - ox) * 180) / Math.PI; };
  assert.ok(Math.abs(ang('s:L0') + 90) < 1);
  assert.ok(Math.abs(ang('s:L1') - 30) < 1);
  assert.ok(Math.abs(ang('s:L2') - 150) < 1);
  assert.deepEqual(overlaps(w.nodes, ov.pos), []);
});

test('live 메인 5개: 파이 구역(구역 경계 5개), 무리는 자기 구역 쪽, 겹침 0', () => {
  const w = world(5, 6);
  const ov = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: T0 + 3600_000, facing: true, spread: 1.3 });
  const c = ov.clusters[0];
  assert.equal(c.layoutMode, 'pie');
  assert.equal(c.zones.n, 5);
  assert.equal(c.zones.dirs.length, 5);
  assert.deepEqual(overlaps(w.nodes, ov.pos), []);
  let inZone = 0, tot = 0;
  for (const [id, p] of ov.pos) {
    if (!id.startsWith('a:')) continue;
    const m = ov.pos.get(rootOfId(id));
    const zx = c.center.x + (c.zones.cx || 0), zz = c.center.z + (c.zones.cz || 0);
    const am = Math.atan2(m.z - zz, m.x - zx), ap = Math.atan2(p.z - zz, p.x - zx);
    const d = Math.abs(Math.atan2(Math.sin(ap - am), Math.cos(ap - am)));
    tot++; if (d <= Math.PI / 5 + 0.05) inZone++;
  }
  assert.ok(inZone / tot >= 0.9, `구역 안 ${inZone}/${tot}`);
});

test('지난 메인은 /clear 앞 세션으로 추정되는 live 메인 무리에(바깥쪽)', () => {
  // L1 이 T0+10분에 시작 → 그 직전에 끝난 P1 은 L1 무리
  const w = world(2, 5, [{ sid: 'P1', end: T0 + 600_000 - 2000 }]);
  const ov = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: T0 + 3600_000, facing: true, spread: 1.3 });
  const c = ov.clusters[0];
  assert.equal(c.anchorOf['s:P1'], 's:L1');
  const p = ov.pos.get('s:P1'), b = ov.pos.get('s:L1'), ox = c.center.x + (c.orbit.cx || 0);
  assert.ok(p.x > ox && Math.abs(p.x - ox) > Math.abs(b.x - ox) - 1, '오른쪽(L1) 무리 바깥');
  assert.deepEqual(overlaps(w.nodes, ov.pos), []);
});

test('Planet(facing 끔): live 메인 여럿이면 나란히(row), 하나면 가운데·나머지 둘레에 고르게', () => {
  const w = world(2, 5);
  const ov = computeOverview(w.nodes, w.roots, w.projects, null, { nowMs: T0 + 3600_000 });
  assert.equal(ov.clusters[0].layoutMode, 'row');
  assert.deepEqual(overlaps(w.nodes, ov.pos), []);
  // live 1 + 지난 메인 2(같은 크기) → 서로 반대쪽(한쪽 쏠림 없음), 가운데 메인이 섬 중심
  const w1 = world(1, 8, [{ sid: 'P1', end: T0 - 7200_000 }, { sid: 'P2', end: T0 - 3600_000 }]);
  const o1 = computeOverview(w1.nodes, w1.roots, w1.projects, null, { nowMs: T0 + 3600_000 });
  const c = o1.clusters[0];
  assert.equal(c.layoutMode, 'center');
  const m = o1.pos.get('s:L0');
  assert.ok(Math.abs(m.x - c.center.x) <= c.box.hw * 0.4 && Math.abs(m.z - c.center.z) <= c.box.hd * 0.4, `메인 ≈ 섬 중심 ${JSON.stringify(m)} ${JSON.stringify(c.center)} ${JSON.stringify(c.box)}`);
  const a1 = Math.atan2(o1.pos.get('s:P1').z - m.z, o1.pos.get('s:P1').x - m.x), a2 = Math.atan2(o1.pos.get('s:P2').z - m.z, o1.pos.get('s:P2').x - m.x);
  assert.ok(Math.abs(Math.atan2(Math.sin(a1 - a2), Math.cos(a1 - a2))) > Math.PI / 2, '두 루트가 반대쪽');
  // 예전(한쪽 줄)보다 상자가 작다: 섬 긴 변 ≤ 메인 무리 지름 + 둘레 무리 지름 + 여백
  assert.ok(Math.max(c.box.hw, c.box.hd) < 60, `섬 크기 ${JSON.stringify(c.box)}`);
});
