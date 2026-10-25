// 작업 대상 층 표현별 은유 — Planet 도형·복셀 가구 배정(결정·안정·방 밖·이웃 사무실과 겹침 없음)·도형 상한·계산 시간
import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtBook, ArtFx, ArtState, ArtGeo, ARTGEO, ART } from '../artifact-core.mjs';
import { artMockPayload } from '../art-mock.mjs';
import { planetArtGeometry, pickHits, PLANET_H, cityHeight, KI, planetFloorY, PLANET_ART } from '../art-meta.mjs';
import { VxArtPlan, voxelArtGeometry, vxFrame, bayXs, fixtureSpots, vxFitPoints, VXA } from '../voxel/vx-art-core.mjs';
import { rotateRoom } from '../voxel/xf.mjs';

const T = Date.parse('2026-10-24T10:00:00Z');
const svc = (i) => ({ id: 'svc:s' + i, k: 'service', n: 's' + i, first: T - i * 1000, last: T - i * 1000, cnt: { write: 1 }, who: [{ node: 's:m', c: 1, last: T, v: 'write' }], log: [] });
const mkBook = (n = 36, pid = 'p') => { const b = new ArtBook(); b.load(pid, [...artMockPayload(pid, T, 's:m', n).items, svc(1), svc(2)]); return b; };
const office = (x = 0, z = 0, ext = 0) => ({ id: 'o:' + x, type: 'office', ownerId: 's:m', projectId: 'p', origin: { x, z }, size: { w: 24, d: 18 + ext }, ext,
  bounds: { minX: x - 12, maxX: x + 12, minZ: z - 9, maxZ: z + 9 + ext }, door: { x: x + 7.8, z: z + 9 + ext - 0.7, out: { x: x + 7.8, z: z + 9 + ext + 0.8 } } });
const baseEnv = (extra = {}) => ({ nodePos: () => ({ x: 0, y: 1, z: 0 }), nowMs: T, reduced: false, foot: null, hover: null, isLight: false, hits: [], ...extra });

test('Planet: 종류마다 실루엣 높이(지표·위성·정거장·게이트), 집기 기준점 = 대상 수, 상한 안', () => {
  const book = mkBook(120);
  const st = new ArtState({ book, fx: new ArtFx() });
  st.frame(['p'], () => ({ x: 0, z: 0, hw: 40, hd: 40 }), 0, 0.016);
  const env = baseEnv({ anchor: (p) => st.anchor(p), yOf: () => -2.2, cellPx: () => 20 });
  const g = planetArtGeometry(book, st.lay, st.fx, 0, env, new ArtGeo());
  assert.ok(g.nl > 0 && g.nl <= ARTGEO.LINES && g.nb <= ARTGEO.BOXES);
  assert.equal(env.hits.length, [...st.lay.get('p').pos.keys()].filter((id) => !id.startsWith('#zone:')).length);
  const byK = (k) => env.hits.filter((h) => book.get('p', h.id).k === k);
  for (const h of byK('repo')) assert.ok(h.y >= -2.2 + PLANET_H.repo - 0.5, '저장소 게이트는 궤도 높이');
  for (const h of byK('service')) assert.ok(h.y >= -2.2 + PLANET_H.service - 0.5, '위성은 떠 있음');
  for (const h of byK('file')) assert.ok(h.y < -2.2 + 1.6, '도시 블록은 낮음');
  assert.ok(cityHeight({ cnt: { modify: 200 }, sz: 9000 }) <= 1.6, '낮은 도시(최대 1.5)');
  // 멀리(LOD)면 점만: 선이 훨씬 적음
  const far = planetArtGeometry(book, st.lay, st.fx, 0, { ...env, hits: [], cellPx: () => 2 }, new ArtGeo());
  assert.ok(far.nl < g.nl / 3);
});

test('Planet: 점등 동시 8개 상한·빔은 점등 대상만, 화면 투영 집기', () => {
  const book = mkBook(60);
  const fx = new ArtFx();
  const st = new ArtState({ book, fx });
  st.frame(['p'], () => ({ x: 0, z: 0, hw: 40, hd: 40 }), 0, 0.016);
  const items = book.shownItems('p').slice(0, 12);
  for (const it of items) { fx.list.push({ kind: 'lit', pid: 'p', id: it.id, node: 's:m', t0: 0, dur: 4, amp: 1 }); for (const w of it.who) w.last = T; } // 최근 30분 접촉
  const env = baseEnv({ anchor: (p) => st.anchor(p), yOf: () => -2.2, cellPx: () => 20, nowMs: T });
  const g = planetArtGeometry(book, st.lay, fx, 0.1, env, new ArtGeo());
  let beams = 0; for (let i = 0; i < g.nl; i++) if (g.LC[i] === KI.write || g.LC[i] === KI.read) beams++;
  assert.ok(beams > 0 && beams <= ART.LIT_MAX * 3, `점등 대상(상한 8)만 빔 ${beams}`);
  const h = env.hits[0];
  const proj = (x, y, z) => ({ x: x * 10, y: z * 10, r: 5 });
  assert.deepEqual(pickHits(env.hits, h.x * 10 + 1, h.z * 10, proj), { pid: h.pid, id: h.id });
  assert.equal(pickHits(env.hits, 1e6, 1e6, proj), null);
});

test('복셀: 배정 결정적·안정적(새 대상이 와도 기존 자리 그대로), 폴더 = 칸, 넘친 폴더는 마지막 칸', () => {
  const book = mkBook(80), items = book.shownItems('p');
  const A = new VxArtPlan(), B = new VxArtPlan();
  const pa = A.sync('p', items, office()), pb = B.sync('p', [...items].reverse(), office());
  for (const [id, s] of pa.slots) assert.deepEqual([s.x, s.y, s.z], [pb.slots.get(id).x, pb.slots.get(id).y, pb.slots.get(id).z]);
  const before = new Map([...pa.slots].map(([k, s]) => [k, s.x + ',' + s.y + ',' + s.z]));
  const more = [...items, { id: 'new/x.js', k: 'file', n: 'x.js', d: 'new', first: T + 1, last: T + 1, cnt: { create: 1 }, who: [], log: [] }];
  const p2 = A.sync('p', more, office());
  for (const [id, v] of before) assert.equal(p2.slots.get(id).x + ',' + p2.slots.get(id).y + ',' + p2.slots.get(id).z, v, '기존 자리 그대로');
  const keys = new Set([...p2.slots.values()].map((s) => `${s.k}:${s.x.toFixed(3)},${s.y.toFixed(3)},${s.z.toFixed(3)}`));
  assert.equal(keys.size, p2.slots.size, '자리 겹침 없음');
  // 폴더 30개 → 칸 상한(19 + 넘침 칸)
  const many = [];
  for (let i = 0; i < 30; i++) many.push({ id: `d${i}/a.js`, k: 'file', n: 'a.js', d: `d${i}`, first: T + i, last: T + i, cnt: { modify: 1 }, who: [], log: [] });
  const p3 = new VxArtPlan().sync('p', many, office());
  assert.ok(p3.bays.length <= bayXs(vxFrame(office())).length);
  assert.ok(p3.bays.some((b) => b.dk === '#over'), '넘친 폴더 칸');
});

test('복셀: 가구는 모두 사무실 밖·벽에서 2.6 안(이웃 사무실 간격 4 와 겹치지 않음), 돌린 방도 같은 규칙', () => {
  const book = mkBook(120), items = book.shownItems('p');
  for (const room of [office(), office(28, 0, 7), rotateRoom(office(0, 0), 1, 0, 0), rotateRoom(office(0, 0, 3.5), 2, 0, 0)]) {
    const P = new VxArtPlan().sync('p', items, room), b = room.bounds;
    for (const [id, s] of P.slots) {
      const inside = s.x > b.minX + 0.01 && s.x < b.maxX - 0.01 && s.z > b.minZ + 0.01 && s.z < b.maxZ - 0.01;
      assert.ok(!inside, `${id} 방 밖`);
      const dx = Math.max(b.minX - s.x, 0, s.x - b.maxX), dz = Math.max(b.minZ - s.z, 0, s.z - b.maxZ);
      assert.ok(Math.max(dx, dz) <= 2.6, `${id} 벽 가까이(${dx.toFixed(2)},${dz.toFixed(2)})`);
    }
    const fp = vxFitPoints(P, []);
    assert.equal(fp.length, 8);
  }
  // 오른쪽 벽 바깥(회의실·이웃 쪽)은 비움
  const sp = fixtureSpots(vxFrame(office()));
  for (const k of ['db', 'service', 'repo', 'remote', 'output']) for (const s of sp[k]) assert.ok(s.x <= 12 - 0.2 || s.z > 9, `${k} 오른쪽 벽 밖 아님`);
});

test('복셀: 도형 상한·서류 패킷(상자)·500대상 계산 시간', () => {
  const book = mkBook(500), items = book.shownItems('p');
  const plans = new Map([['p', new VxArtPlan().sync('p', items, office())]]);
  const fx = new ArtFx();
  const tgt = items.find((it) => it.k === 'file');
  fx.list.push({ kind: 'packet', pid: 'p', id: tgt.id, node: 's:m', t0: 0, dur: 0.9, amp: 2, v: 'modify' });
  const env = baseEnv({ unitPx: () => 20 });
  const t0 = performance.now();
  let g;
  for (let i = 0; i < 20; i++) g = voxelArtGeometry(book, plans, fx, 0.4, env, g || new ArtGeo());
  const ms = (performance.now() - t0) / 20;
  assert.ok(ms < 8, `한 번 ${ms.toFixed(2)}ms`);
  assert.ok(g.nb <= ARTGEO.BOXES && g.nl <= ARTGEO.LINES);
  assert.ok(env.hits.length > 0 && env.hits.length <= (VXA.BAYS_MAX * VXA.DRAWERS * VXA.PER_DRAWER) + 40);
});

// Planet 층 분리: 바닥 = 가장 낮은 노드 아랫면 − 틈(기본 −9 안팎, STEP 내림), 떠 있는 대상은 낮은 궤도까지만
test('Planet 층 분리(§93): planetFloorY·낮은 궤도 높이·2D 바닥', () => {
  assert.equal(planetFloorY(Infinity), PLANET_ART.FLOOR, '노드 없으면 기본 바닥');
  assert.equal(planetFloorY(-4 - 2.5 * 0.4), -9, '백그라운드 명령(−4, r 0.4) 아래 −9');
  assert.equal(planetFloorY(5), PLANET_ART.FLOOR, '노드가 높아도 기본 바닥보다 위로 안 감');
  assert.ok(planetFloorY(-12.3) <= -12.3 - PLANET_ART.GAP && Number.isInteger(planetFloorY(-12.3)), '더 낮은 노드면 그만큼 아래(정수 단위)');
  for (const k of ['service', 'remote', 'repo']) assert.ok(PLANET_H[k] + 0.5 < PLANET_ART.GAP + 1, `${k} 떠 있는 높이 < 틈(에이전트 평면까지 안 올라감)`);
  assert.ok(PLANET_ART.FLOOR_2D <= -5 && PLANET_ART.SHRINK < 1 && PLANET_ART.AVOID_K > 1.5);
});
