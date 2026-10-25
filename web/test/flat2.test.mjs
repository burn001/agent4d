// 2D(저사양) 2단계 시험: Planet 2D 도형·색·연결 감기, 복셀 2D 평면도(벽 문 틈·시설 자리·문패·캐릭터 반지름),
// 순수 모듈로 옮긴 캐릭터 상태 머신(자리 ⇄ 시설 걷기 · 퇴장 때 문으로 걸어 나감)이 3D 배치(computeOffice)와 같이 도는지,
// 그리고 Planet·복셀 2D 경로가 three.js·3D 모듈을 정적으로 끌어오지 않는지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseColor, mixColor, planetColor, planetShape, PLANET_SHAPE, retractPt } from '../flat/flat-core.mjs';
import { wallSegments, yawVec, facilityRect, FACILITY_LABEL, roomKindName, charRadius, isMoving, DOOR_W } from '../flat/plan-core.mjs';
import { computeOffice, CAT_FACILITY } from '../voxel/layout.js';
import { computeCampus } from '../voxel/campus.mjs';
import { Character } from '../voxel/character-core.mjs';
import { DARK, LIGHT, SKIN } from '../voxel/palette-hex.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function staticClosure(entry) {
  const seen = new Set(), bare = [];
  const walk = (f) => {
    if (seen.has(f)) return; seen.add(f);
    const src = readFileSync(f, 'utf8');
    const re = /^\s*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
    let m;
    while ((m = re.exec(src))) {
      const s = m[1] || m[2];
      if (!s.startsWith('.')) { bare.push(`${s} <- ${path.relative(WEB, f)}`); continue; }
      walk(path.resolve(path.dirname(f), s));
    }
  };
  walk(path.join(WEB, entry));
  return { files: [...seen].map((f) => path.relative(WEB, f).replace(/\\/g, '/')), bare };
}

test('Planet 2D·복셀 2D 는 three.js·3D 모듈을 정적으로 끌어오지 않는다 · 옮긴 순수 모듈을 3D 가 그대로 씀', () => {
  for (const e of ['flat/planet2d.js', 'flat/voxel2d.js', 'flat/flat-draw.js']) {
    const { bare, files } = staticClosure(e);
    assert.deepEqual(bare, [], `${e}: ${bare.join(', ')}`);
    for (const f of ['scene.js', 'camera.js', 'voxel/office.js', 'voxel/character.js', 'voxel/palette.js', 'voxel/props.js', 'voxel/bubbles.js', 'overview/islands.js', 'holo.js', 'flow.js'])
      assert.ok(!files.includes(f), `${e} 가 ${f} 를 정적으로`);
  }
  // 3D 복셀은 같은 상태 머신·같은 색 표를 쓴다(옮기기만 함)
  const ch = readFileSync(path.join(WEB, 'voxel/character.js'), 'utf8');
  assert.match(ch, /import \{ Character \} from '\.\/character-core\.mjs'/);
  assert.match(ch, /export \{ Character \}/);
  assert.doesNotMatch(ch, /class Character/);
  const pal = readFileSync(path.join(WEB, 'voxel/palette.js'), 'utf8');
  assert.match(pal, /from '\.\/palette-hex\.mjs'/);
  assert.equal(DARK.floor, '#323d54'); assert.equal(LIGHT.floor, '#eef1f6'); // 바닥 색 assert.equal(SKIN.length, 4);
  // flow2d 는 카드·말풍선·장치·섬 그리기를 공용 모듈에서
  const f2 = readFileSync(path.join(WEB, 'flat/flow2d.js'), 'utf8');
  assert.match(f2, /from '\.\/flat-draw\.js'/);
  assert.doesNotMatch(f2, /_drawCard\(/);
});

test('Planet 2D: 종류별 도형·색(완료 회색·중지 회색)·직선 연결 감기', () => {
  assert.deepEqual(Object.keys(PLANET_SHAPE).sort(), ['bash-bg', 'claude-p', 'main', 'monitor', 'subagent', 'workflow', 'workflow-agent']);
  assert.equal(planetShape('main'), 'ico');
  assert.equal(planetShape('subagent'), 'sphere');
  assert.equal(planetShape('workflow'), 'torus');
  assert.equal(planetShape('workflow-agent'), 'octa');
  assert.equal(planetShape('claude-p'), 'box');
  assert.equal(planetShape('bash-bg'), 'cyl');
  assert.equal(planetShape('monitor'), 'cone');
  assert.equal(planetShape('bash-bg', true), 'device', '배치 장치는 상자');
  assert.equal(planetShape('zzz'), 'sphere');
  assert.deepEqual(parseColor('#7aa2ff'), [0x7a, 0xa2, 0xff]);
  assert.deepEqual(parseColor('#abc'), [0xaa, 0xbb, 0xcc]);
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), [1, 2, 3]);
  assert.equal(mixColor('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixColor('#102030', '#102030', 0.3), '#102030');
  const tok = { bg: '#0b0f17', stopped: '#9aa3b2' };
  const base = '#7aa2ff';
  assert.equal(planetColor(base, 'active', tok), base);
  assert.equal(planetColor(base, 'idle', tok), base);
  const sat = (c) => { const [r, g, b] = parseColor(c); return Math.max(r, g, b) - Math.min(r, g, b); };
  assert.ok(sat(planetColor(base, 'done', tok)) < sat(base) * 0.5, '완료 = 회색 쪽으로');
  const st = parseColor(planetColor(base, 'stopped', tok)), sp = parseColor(tok.stopped);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(st[i] - sp[i]) < 0.25 * 255, '중지됨 = 중지 회색에 가까움');
  // 퇴장 감기: link 0 = 자식 끝, 1 = 부모
  const a = { x: 0, y: 0 }, b = { x: 10, y: 20 };
  assert.deepEqual(retractPt(a, b, 0), { x: 10, y: 20 });
  assert.deepEqual(retractPt(a, b, 1), { x: 0, y: 0 });
  assert.deepEqual(retractPt(a, b, 0.25), { x: 7.5, y: 15 });
});

test('복셀 2D 평면도: 벽 선분의 문 틈(앞 출입문·별관 뒷문·회의실 옆문)·시설 사각·문패·반지름', () => {
  const room = { bounds: { minX: -12, maxX: 12, minZ: -9, maxZ: 9 }, origin: { x: 0, z: 0 }, door: { x: 7.8 }, backDoor: true, leftDoor: null };
  const segs = wallSegments(room);
  const h = DOOR_W / 2;
  // 앞 벽(z=9)은 출입문 자리만 비고, 뒤 벽(z=-9)은 가운데 별관 통로만 비고, 옆 벽은 이어짐
  const front = segs.filter((s) => s[1] === 9 && s[3] === 9), back = segs.filter((s) => s[1] === -9 && s[3] === -9);
  assert.deepEqual(front, [[-12, 9, 7.8 - h, 9], [7.8 + h, 9, 12, 9]]);
  assert.deepEqual(back, [[-12, -9, -h, -9], [h, -9, 12, -9]]);
  assert.equal(segs.filter((s) => s[0] === s[2]).length, 2);
  const meet = { bounds: { minX: 0, maxX: 16, minZ: -6, maxZ: 6 }, origin: { x: 8, z: 0 }, door: { x: 13 }, backDoor: false, leftDoor: 3.5 };
  const left = wallSegments(meet).filter((s) => s[0] === 0 && s[2] === 0);
  assert.deepEqual(left, [[0, -6, 0, 3.5 - h], [0, 3.5 + h, 0, 6]]);
  // 시설 사각: 접근점들이 바라보는 쪽으로 앞에, 줄을 따라 길게 — 접근점(사람 서는 곳)을 덮지 않음
  const lay = computeOffice([{ id: 'm', kind: 'main', order: 0 }], 'm');
  const r = lay.rooms[0];
  for (const [cat, spots] of Object.entries(r.stations)) {
    const rc = facilityRect(spots);
    assert.ok(rc && rc.w > 0 && rc.d > 0, cat);
    for (const sp of spots) assert.ok(!(Math.abs(sp.x - rc.x) < rc.w / 2 && Math.abs(sp.z - rc.z) < rc.d / 2), `${cat} 시설이 접근점을 덮음`);
    assert.ok(FACILITY_LABEL[CAT_FACILITY[cat]], cat);
  }
  assert.ok(near(yawVec(0).z, 1) && near(yawVec(Math.PI / 2).x, 1));
  assert.equal(roomKindName({ type: 'meeting' }, true), '회의실');
  assert.equal(roomKindName({ type: 'office', external: true }, false), '외부 작업');
  assert.equal(roomKindName({ type: 'office', recent: true }, true), '지난 사무실');
  assert.equal(roomKindName({ type: 'office' }, true), '사무실');
  assert.equal(roomKindName({ type: 'office' }, false), '별관');
  assert.ok(charRadius(true) > charRadius(false), '팀장(상급자)이 조금 크게');
  assert.equal(isMoving({ state: 'walk', appearT0: null, vanishT0: null }), true);
  assert.equal(isMoving({ state: 'seated', appearT0: null, vanishT0: null }), false);
});

test('복셀 2D 캐릭터: 3D 와 같은 배치·상태 머신 — 메인은 팀장 책상, 도구면 시설로 걸어가고, 끝나면 문으로 걸어 나감', () => {
  const nodes = [
    { id: 'm', kind: 'main', order: 0, status: 'active' },
    { id: 'a', kind: 'subagent', parentId: 'm', order: 1, status: 'active' },
    { id: 'L', kind: 'bash-bg', parentId: 'm', order: 2, status: 'active', meta: { launcher: { cmd: 'relaunch.sh' } } },
  ];
  const lay = computeOffice(nodes, 'm');
  const room = lay.rooms[0];
  assert.equal(lay.seat.get('m').kind, 'lead', '메인 = 상급자(팀장) 자리');
  assert.equal(lay.machine.get('L').type, 'batch', '기동기 = 복합기(배치 장치)');
  const seat = lay.seat.get('a');
  const ch = new Character('a', nodes[1]);
  ch.spawnFrom = null;
  const use = new Map();
  const ctx = {
    now: 0, dt: 0.05, ts: 1, room, seat,
    stationSpot: (c, cat) => { if (!room.stations[cat]) return null; const sp = room.stations[cat][0]; use.set(c.id, sp); return sp; },
    releaseStation: (c) => use.delete(c.id),
  };
  const run = (sec) => { for (let t = 0; t < sec; t += ctx.dt) { ctx.now += ctx.dt; ch.update(ctx); } };
  run(3); // 처음 자리 잡기(3D 와 같이 책상 옆 통로를 돌아 앉음)
  assert.ok(near(ch.pos.x, seat.x, 1e-3) && near(ch.pos.z, seat.z, 1e-3), '처음엔 자기 책상');
  assert.equal(ch.state, 'seated');
  ch.addTool('t0', 'read', 'Read', ctx.now);
  run(0.3);
  assert.equal(ch.state, 'work', '읽기는 스탠딩 데스크 홀로그램에서(§72, 걷지 않음)');
  ch.endTool('t0', true, ctx.now);
  run(1.5);
  ch.addTool('t1', 'skill', 'Skill', ctx.now);
  run(0.3);
  assert.equal(ch.state, 'walk', '시설로 걷는 중(보간)');
  assert.ok(isMoving(ch));
  run(8);
  const spot = room.stations.skill[0];
  assert.ok(near(ch.pos.x, spot.x, 1e-3) && near(ch.pos.z, spot.z, 1e-3), '도구 상자 앞에 도착');
  assert.equal(ch.state, 'work');
  ch.endTool('t1', true, ctx.now);
  run(8);
  assert.ok(near(ch.pos.x, seat.x, 1e-3) && near(ch.pos.z, seat.z, 1e-3), '자리로 돌아옴');
  nodes[1].status = 'done';
  run(1.2);
  assert.equal(ch.state, 'leave', '끝나면 일어나 문으로');
  run(10);
  assert.equal(ch.state, 'gone');
  assert.ok(near(ch.pos.x, room.door.out.x, 1e-3) && near(ch.pos.z, room.door.out.z, 1e-3), '문 밖에서 사라짐');
});

test('복셀 2D 캠퍼스: 같은 사무실 배치(전체 보기) — 동·방·자리를 평면도 재료로 쓸 수 있음', () => {
  const nodes = [
    { id: 'm1', kind: 'main', order: 0, status: 'active', projectId: 'p1', lastActivityAt: '2026-10-24T00:00:00Z' },
    { id: 'a1', kind: 'subagent', parentId: 'm1', order: 1, status: 'active', projectId: 'p1' },
    { id: 'm2', kind: 'main', order: 2, status: 'active', projectId: 'p2', lastActivityAt: '2026-10-24T00:00:00Z' },
  ];
  const roots = [{ nodeId: 'm1', projectId: 'p1' }, { nodeId: 'm2', projectId: 'p2' }];
  const lay = computeCampus(nodes, roots, [], null, { nowMs: Date.parse('2026-10-24T00:01:00Z') });
  assert.equal(lay.buildings.length, 2);
  for (const b of lay.buildings) assert.ok(b.bounds.maxZ > b.bounds.minZ && b.center);
  assert.equal(lay.seat.get('m1').kind, 'lead');
  assert.equal(lay.seat.get('m2').kind, 'lead');
  assert.equal(lay.projectOf.get('a1'), 'p1');
  for (const r of lay.rooms) assert.ok(wallSegments(r).length >= 4, r.id);
});
