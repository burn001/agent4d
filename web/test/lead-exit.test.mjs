// 끝난 별관 팀장(claude -p) 퇴장
//   사용자 지적(2026-11-02): 이미 끝나 정리된 백그라운드 claude -p 세션(bgtest-p-*)이 복셀 오피스에선 별도 사무실(별관),
//   복셀 연구소에선 구역·유령 팀장으로 남음. 살아 있는 별도 세션은 방을 계속 받아야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { endedLeadsDue, stepLeadExit, LEAD_EXIT } from '../voxel/lead-exit-core.mjs';
import { Character } from '../voxel/character-core.mjs';
import { computeOffice } from '../voxel/layout.js';
import { computeLab } from '../lab/lab-layout-core.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T0 = Date.parse('2026-11-01T23:21:00Z');
const iso = (ms) => new Date(ms).toISOString();

/** 라이브 자율 루프 프로젝트 모양: 메인 → 끝난 서브에이전트 → 끝난 claude -p 넷(bgtest) + 그 아래 끝난 bash, 살아 있는 claude -p 하나 */
function scene({ liveP = true } = {}) {
  const nodes = [
    { id: 's:main', kind: 'main', status: 'active', parentId: null, startedAt: iso(T0 - 3600e3) },
    { id: 'a:tester', kind: 'subagent', status: 'done', parentId: 's:main', endedAt: iso(T0 + 400e3) },
    { id: 's:bg1', kind: 'claude-p', status: 'done', parentId: 'a:tester', endedAt: iso(T0 + 23e3), label: 'bgtest-p-bypass' },
    { id: 's:bg2', kind: 'claude-p', status: 'done', parentId: 'a:tester', endedAt: iso(T0 + 37e3), label: 'bgtest-p-accept' },
    { id: 'b:bg2sh', kind: 'bash-bg', status: 'done', parentId: 's:bg2', endedAt: iso(T0 + 20e3) },
  ];
  // 같은 프로젝트의 살아 있는 별도 세션(메인) — 자기 사무실·연구소 구역을 계속 받아야 함
  nodes.push({ id: 's:other', kind: 'main', status: 'active', parentId: null, startedAt: iso(T0) });
  if (liveP) nodes.push(
    { id: 's:live', kind: 'claude-p', status: 'active', parentId: 's:main', startedAt: iso(T0) },
    { id: 'a:livekid', kind: 'subagent', status: 'active', parentId: 's:live', startedAt: iso(T0) });
  return nodes;
}
const mapOf = (arr) => new Map(arr.map((n) => [n.id, n]));

/** 뷰 없이 VoxelView 의 캐릭터·기계 장부만(addNode 와 같은 팀장 규칙) */
function fakeView(nodes, { spawn = false } = {}) {
  const v = { chars: new Map(), machines: new Map(), _removing: new Set(), layoutDirty: false, rootId: 's:main', layoutRoot: 's:main', scope: { roots: [] } };
  for (const n of nodes) {
    if (n.kind === 'bash-bg') { v.machines.set(n.id, { id: n.id, node: n, endWall: 0, heldUntil: 30, released: false }); continue; }
    const lead = n.kind === 'main' || n.kind === 'claude-p';
    const ch = new Character(n.id, n, { lead });
    ch.kind = n.kind; ch.spawnMode = spawn ? 'enter' : 'place';
    const ended = ['done', 'stopped', 'error'].includes(n.status);
    if (!lead && ended && !spawn) { ch.state = 'gone'; ch.released = true; }
    v.chars.set(n.id, ch);
  }
  return v;
}
/** VoxelView._present 와 같은 거름: 반납한 캐릭터·기계 빼기 */
const present = (v, nodes) => nodes.filter((n) => { const c = v.chars.get(n.id), m = v.machines.get(n.id); return !(c && c.released) && !(m && m.released); });
const officeIds = (lay) => lay.rooms.filter((r) => r.type === 'office').map((r) => r.ownerId).sort();

test('endedLeadsDue: 끝난 claude -p(하위도 끝남) 는 유예 뒤 대상, 살아 있는 claude -p·메인·유예 안은 아님', () => {
  const m = mapOf(scene());
  assert.deepEqual([...endedLeadsDue(m, ['s:main'], T0 + 40e3)].sort(), ['s:bg1']); // bg2 는 끝난 지 3초(유예 안)
  assert.deepEqual([...endedLeadsDue(m, ['s:main'], T0 + 3600e3)].sort(), ['s:bg1', 's:bg2']);
  // 하위가 아직 일하면 대상 아님
  m.get('b:bg2sh').status = 'active';
  assert.deepEqual([...endedLeadsDue(m, ['s:main'], T0 + 3600e3)], ['s:bg1']);
  // 뷰 루트인 claude -p(그 세션만 보기)는 퇴장하지 않음
  assert.deepEqual([...endedLeadsDue(mapOf(scene()), ['s:main', 's:bg1'], T0 + 3600e3)], ['s:bg2']);
  // 기동기 회차는 대상 아님(원래 직원으로 퇴장)
  const cyc = mapOf([{ id: 's:main', kind: 'main', status: 'active' }, { id: 's:c1', kind: 'claude-p', status: 'done', parentId: 's:main', endedAt: iso(T0), meta: { link: { by: 'launcher' } } }]);
  assert.equal(endedLeadsDue(cyc, ['s:main'], T0 + 3600e3).size, 0);
  assert.ok(LEAD_EXIT.GRACE_MS >= 3000 && LEAD_EXIT.GRACE_MS <= 15000, '짧은 유예');
});

test('스냅샷: 오래전 끝난 bg claude -p 의 별관은 첫 배치부터 없음 · 살아 있는 별도 세션 별관은 유지(복셀 오피스)', () => {
  const nodes = scene();
  const v = fakeView(nodes);
  stepLeadExit(v, 0, mapOf(nodes), T0 + 3600e3);
  const ids = officeIds(computeOffice(present(v, nodes), 's:main', null));
  assert.deepEqual(ids, ['s:live', 's:main', 's:other'], '끝난 bgtest 별관 없음, 살아 있는 claude -p 별관·별도 세션 사무실 있음');
  assert.equal(v.chars.get('s:bg1').state, 'gone');
  assert.equal(v.chars.get('s:live').state === 'gone', false);
  assert.equal(v.machines.get('b:bg2sh').heldUntil, 0, '별관 기계 반납 대기도 당김');
});

test('스냅샷: 복셀 연구소에서도 끝난 bg claude -p 구역이 없고 살아 있는 별도 세션 구역은 유지', () => {
  const nodes = scene();
  const v = fakeView(nodes);
  // 연구소는 claude -p 를 구역 책상 직원으로 앉힌다(구역 머리 = 메인) — 스냅샷 첫 배치에서 끝난 bgtest 가 책상을 받아 유령으로 보였다
  const before = computeLab(present(v, nodes), 's:main', null);
  assert.ok(before.seat.has('s:bg1') && before.seat.has('s:bg2'), '수리 전 모양: 끝난 bgtest 가 연구소 자리를 받음');
  stepLeadExit(v, 0, mapOf(nodes), T0 + 3600e3);
  const after = computeLab(present(v, nodes), 's:main', null);
  assert.equal(after.seat.has('s:bg1') || after.seat.has('s:bg2'), false, '끝난 bgtest 자리 없음');
  assert.ok(after.seat.has('s:live') && after.seat.has('a:livekid'), '살아 있는 claude -p·하위는 그대로');
  const zoneOwners = after.rooms.filter((r) => r.type === 'lab').map((r) => r.ownerId).sort();
  assert.deepEqual(zoneOwners, ['s:main', 's:other'], '살아 있는 별도 세션은 자기 구역(브리지) 유지');
});

test('라이브: 끝난 claude -p 는 유예 동안 별관을 지키다 문으로 걸어 나가고, 다 나가면 별관이 바로 걷힘', () => {
  const nodes = scene({ liveP: true }).filter((n) => n.id !== 's:bg2' && n.id !== 'b:bg2sh');
  const p = nodes.find((n) => n.id === 's:bg1');
  const v = fakeView(nodes, { spawn: true });
  const ch = v.chars.get('s:bg1');
  ch.placed = true; ch.state = 'seated';
  const endAt = Date.parse(p.endedAt);
  stepLeadExit(v, 0, mapOf(nodes), endAt + 1000);
  assert.ok(!ch.forceLeave, '유예 안: 그대로');
  assert.ok(officeIds(computeOffice(present(v, nodes), 's:main', null)).includes('s:bg1'));
  stepLeadExit(v, 1, mapOf(nodes), endAt + LEAD_EXIT.GRACE_MS + 10);
  assert.equal(ch.forceLeave, true, '유예 뒤: 문 퇴장(§46 과 같은 길)');
  assert.ok(!ch.released, '걷는 동안 반납 안 함');
  ch.state = 'gone'; // 문 밖에서 사라짐(Character.update)
  stepLeadExit(v, 2, mapOf(nodes), endAt + LEAD_EXIT.GRACE_MS + 5000);
  assert.equal(ch.released, true, 'HOLD 없이 바로 반납');
  assert.equal(v.layoutDirty, true);
  assert.deepEqual(officeIds(computeOffice(present(v, nodes), 's:main', null)), ['s:live', 's:main', 's:other']);
});

test('라이브: 유예 뒤 다시 살아나면(또는 하위가 다시 일하면) 나가던 걸음을 거둠 · 살아 있는 claude -p 는 끝까지 그대로', () => {
  const nodes = scene();
  const v = fakeView(nodes, { spawn: true });
  const ch = v.chars.get('s:bg1');
  ch.placed = true; ch.state = 'seated';
  const m = mapOf(nodes);
  stepLeadExit(v, 0, m, T0 + 3600e3);
  assert.equal(ch.forceLeave, true);
  m.get('s:bg1').status = 'active';
  stepLeadExit(v, 1, m, T0 + 3600e3);
  assert.equal(ch.forceLeave, false);
  for (const id of ['s:live', 's:main', 's:other']) assert.ok(!v.chars.get(id).forceLeave && v.chars.get(id).state !== 'gone', id + ' 그대로');
});

test('배선: 3D VoxelView(오피스·연구소 바탕)와 2D Voxel2DView(오피스·연구소 2D 바탕)가 매 프레임 stepLeadExit 를 부름', () => {
  const o = readFileSync(path.join(WEB, 'voxel/office.js'), 'utf8');
  assert.match(o, /import \{ stepLeadExit \} from '\.\/lead-exit-core\.mjs'/);
  assert.match(o, /layoutNow\(\) \{ stepLeadExit\(this, this\._now, this\.nodes, this\.clock\(\), true\); this\._relayout/, '3D: 스냅샷 직후 layoutNow 도 먼저');
  assert.match(o, /stepLeadExit\(this, now, this\.nodes, this\.clock\(\)\);[^\n]*\n\s*if \(this\.layoutDirty && now - this\.lastLayout > 0\.15\) this\._relayout\(now\);/, '3D: 배치 전에(스냅샷 첫 배치에 끝난 별관이 번쩍이지 않게)');
  const f = readFileSync(path.join(WEB, 'flat/voxel2d.js'), 'utf8');
  assert.match(f, /import \{ stepLeadExit \} from '\.\.\/voxel\/lead-exit-core\.mjs'/);
  assert.match(f, /this\._heldPass\(t\);[^\n]*\n\s*stepLeadExit\(this, t, this\._nodeMap\(\), this\.clock\(\)\);/);
});
