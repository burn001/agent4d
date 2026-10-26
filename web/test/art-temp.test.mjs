// 작업 대상 층 임시 파일 — 임시 경로 판정·상한에서 먼저 버림·임시 폴더 접기(흐름·Planet·복셀 공용)·팝업 모델
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ART, ArtBook, ArtFx, ArtGeo, ArtState, artGeometry, artPickXZ, artInspectModel, tempFolder, isTempPath, isTempItem, foldTempItems,
  zoneKeyOf, districtKey, TEMP_ZONE,
} from '../artifact-core.mjs';
import { planetArtGeometry } from '../art-meta.mjs';
import { VxArtPlan, voxelArtGeometry } from '../voxel/vx-art-core.mjs';
import { _setLangForTest } from '../i18n.mjs';

const T = Date.parse('2026-10-24T10:00:00Z');
const ref = (id, v = 'modify', o = {}) => ({ k: /\.(png|pdf|csv)$/.test(id) ? 'output' : 'file', id: id.toLowerCase(), p: id, d: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '', n: id.split('/').pop(), v, ...o });
const fill = (book, pid, ids, t0 = T, node = 's:m') => ids.forEach((id, i) => book.touch(pid, ref(id), t0 + i * 1000, node, `tu-${pid}-${id}`));

test('임시 경로 판정: scratch·tmp·temp·.cache·__pycache__·세션 임시 폴더, 접을 폴더 = 가장 깊은 임시 구간 + 한 구간', () => {
  const yes = {
    '.autopilot/scratch/q148/s4/ga/run.jsonl': '.autopilot/scratch/q148',
    '.autopilot/scratch/q151/x.log': '.autopilot/scratch/q151',
    '.autopilot/scratch/notes.json': '.autopilot/scratch',
    '~/AppData/Local/Temp/claude/D--x/uuid/scratchpad/af.mjs': '~/AppData/Local/Temp/claude/D--x/uuid/scratchpad',
    '~/AppData/Local/Temp/claude/D--x/uuid/scratchpad/artifacts/shots/a.png': '~/AppData/Local/Temp/claude/D--x/uuid/scratchpad/artifacts',
    '~/AppData/Local/Temp/claude/D--x/uuid/tasks/b1.output': '~/AppData/Local/Temp/claude',
    'c:/users/me/appdata/local/temp/foo.txt': 'c:/users/me/appdata/local/temp',
    '/tmp/build.log': '/tmp',
    'tmp/a.txt': 'tmp',
    'tmp-3fa9/a.txt': 'tmp-3fa9',
    'work/temp2/a.txt': 'work/temp2',
    'node_modules/.cache/babel/x.json': 'node_modules/.cache/babel',
    'pkg/__pycache__/m.cpython-312.pyc': 'pkg/__pycache__',
    'x/.pytest_cache/v/cache/lastfailed': 'x/.pytest_cache/v',
    'src\\scratch\\a.js': 'src/scratch',
    'docs/draft.tmp': 'docs',
  };
  for (const [p, f] of Object.entries(yes)) { assert.equal(tempFolder(p), f, p); assert.ok(isTempPath(p), p); }
  for (const p of ['src/template/a.js', 'docs/temporal.md', 'web/test/a.test.mjs', 'out/초안.docx', 'build/x.js', 'dist/app.js', 'scratch.md', 'tmp.js', 'src/cache/lru.js', '', null]) {
    assert.equal(tempFolder(p), null, String(p)); assert.equal(isTempPath(p), false, String(p));
  }
  assert.ok(isTempItem({ k: 'file', id: '.autopilot/scratch/q1/a.json' }));
  assert.ok(isTempItem({ k: 'output', id: 'tmp/shot.png', p: 'tmp/shot.png' }));
  assert.equal(isTempItem({ k: 'db', id: 'db:mongo/tmp' }), false, '파일·산출물만');
  assert.equal(isTempItem({ k: 'output', id: 'artifact:tmp/보고' }), false, 'Artifact 도구 산출물 제외');
  // 외부 링크 접기(foldRef)는 폴더를 남기므로 판정이 같다
  assert.ok(isTempItem({ k: 'file', id: '.autopilot/scratch/q1/#3fa21c.json' }));
});

test('상한(§79.16): 임시 파일을 중요도 없는·오래된 것보다도 먼저 버림, 장부 항목에 tmp 표식', () => {
  const book = new ArtBook({ max: 6 });
  fill(book, 'p', ['src/a.js', 'src/b.js', 'docs/c.md'], T - 5 * 86_400_000);               // 오래된 일반 파일 3
  fill(book, 'p', ['.autopilot/scratch/q1/1.json', '.autopilot/scratch/q1/2.json', '.autopilot/scratch/q1/3.json', 'tmp/4.log', 'tmp/5.log'], T); // 방금 만든 임시 5
  book.touch('p', { ...ref('tmp/secret.env'), imp: 'secret' }, T + 9000, 's:m', 'tu-imp');    // 임시지만 중요
  const items = book.items('p');
  assert.equal(items.length, 6);
  for (const id of ['src/a.js', 'src/b.js', 'docs/c.md']) assert.ok(book.get('p', id), `오래된 일반 파일 ${id} 남음`);
  assert.equal(items.filter((it) => it.tmp).length, 3, '임시는 남은 칸만큼만');
  assert.equal(book.get('p', 'src/a.js').tmp, 0);
  // load 는 서버 값을 믿지 않고 다시 판정
  const b2 = new ArtBook(); b2.load('p', [{ id: 'tmp/x.js', k: 'file', p: 'tmp/x.js', tmp: 0, cnt: { modify: 1 } }, { id: 'src/y.js', k: 'file', p: 'src/y.js', tmp: 1, cnt: { modify: 1 } }]);
  assert.equal(b2.get('p', 'tmp/x.js').tmp, 1); assert.equal(b2.get('p', 'src/y.js').tmp, 0);
});

test('접기(§79.16): 임시 폴더에 4개 이상이면 묶음 하나(수·합·대표 파일), 3개 이하는 그대로, 같은 version 이면 캐시', () => {
  const book = new ArtBook();
  fill(book, 'p', ['src/a.js', 'src/b.js']);
  fill(book, 'p', Array.from({ length: 7 }, (_, i) => `.autopilot/scratch/q148/s${i % 2}/r${i}.jsonl`));
  fill(book, 'p', ['.autopilot/scratch/q149/a.json', '.autopilot/scratch/q149/b.json', '.autopilot/scratch/q149/c.json']); // 3개 — 안 접음
  book.touch('p', ref('.autopilot/scratch/q148/s0/r0.jsonl', 'delete'), T + 60_000, 'a:9', 'tu-del');
  const { items, agg } = book.layoutItems('p');
  assert.equal(agg.size, 1);
  const z = agg.get(TEMP_ZONE + '.autopilot/scratch/q148');
  assert.ok(z && z.k === 'zone' && z.tmp === 1);
  assert.equal(z.count, 7); assert.equal(z.n, 'scratch/q148'); assert.equal(z.p, '.autopilot/scratch/q148');
  assert.equal(z.cnt.modify, 7); assert.equal(z.cnt.delete, 1); assert.equal(z.del, 0, '하나만 지워짐');
  assert.equal(z.files.length, ART.TEMP_FOLD_FILES); assert.equal(z.files[0].id, '.autopilot/scratch/q148/s0/r0.jsonl', '최근 것 먼저');
  assert.deepEqual(z.who.map((w) => w.node).sort(), ['a:9', 's:m']);
  assert.ok(z.log.length <= ART.LOG_MAX && z.last === T + 60_000);
  assert.equal(items.length, 2 + 3 + 1, '일반 2 + 안 접힌 임시 3 + 묶음 1');
  assert.equal(districtKey(z), 'f:.autopilot', '묶음은 원래 파일의 구역');
  const f = book.get('p', '.autopilot/scratch/q148/s1/r1.jsonl');
  assert.equal(zoneKeyOf(f), z.id, '접힌 파일 → 그 묶음');
  assert.equal(zoneKeyOf(book.get('p', '.autopilot/scratch/q149/a.json')), '#zone:f:.autopilot', '안 접힌 파일은 구역 묶음 열쇠 그대로');
  assert.equal(book.layoutItems('p').agg, agg, '같은 version 이면 캐시');
  assert.equal(book.foldItem('p', z.id), z); assert.equal(book.foldItem('p', 'src/a.js'), null);
  // 하나 더 → 4개가 되면 q149 도 접힘
  book.touch('p', ref('.autopilot/scratch/q149/d.json'), T + 70_000, 's:m', 'tu-d');
  assert.equal(book.layoutItems('p').agg.size, 2);
  assert.equal(foldTempItems([]).items.length, 0);
});

test('흐름 공용 배치(ArtState): 묶음 칸·집기·팝업 자리·도형 라벨, 접힌 파일의 자리는 묶음', () => {
  const book = new ArtBook();
  fill(book, 'p', ['src/a.js', 'src/b.js', 'web/c.js']);
  fill(book, 'p', Array.from({ length: 40 }, (_, i) => `.autopilot/scratch/q150/v/r${i}.json`));
  const st = new ArtState({ book, fx: new ArtFx() });
  st.frame(['p'], () => ({ x: 0, z: 0, hw: 40, hd: 40 }), 0, 0.016);
  const L = st.lay.get('p');
  const zid = TEMP_ZONE + '.autopilot/scratch/q150';
  assert.equal(L.pos.size, 4, '일반 3 + 묶음 1');
  assert.ok(L.pos.has(zid) && L.agg.get(zid).count === 40);
  const w = st.worldOf('p', zid), wf = st.worldOf('p', '.autopilot/scratch/q150/v/r7.json');
  assert.ok(w && wf && w.x === wf.x && w.z === wf.z, '접힌 파일의 팝업·연출 자리 = 묶음');
  assert.deepEqual(artPickXZ(st.lay, (p) => st.anchor(p), w.x, w.z), { pid: 'p', id: zid }, '묶음도 집힘');
  const env = { anchor: (p) => st.anchor(p), nodePos: () => null, nowMs: T, reduced: false, foot: null, hover: null, cellPx: () => 20, isLight: false };
  const g = artGeometry(book, st.lay, st.fx, 0, env, new ArtGeo());
  assert.ok(g.labels.some((l) => l.text === 'scratch/q150 40'), '묶음 라벨 = 이름 + 수');
  // Planet 도 같은 배치 → 묶음 집기 기준점
  const penv = { ...env, yOf: () => -2.2, hits: [] };
  planetArtGeometry(book, st.lay, st.fx, 0, penv, new ArtGeo());
  assert.ok(penv.hits.some((h) => h.id === zid), 'Planet 묶음 집기');
  // 구역 묶음 LOD(작은 섬)에서도 임시 묶음은 따로
  const st2 = new ArtState({ book, fx: new ArtFx() });
  fill(book, 'p', Array.from({ length: 300 }, (_, i) => `lib/m${i}.js`), T + 100_000);
  st2.frame(['p'], () => ({ x: 0, z: 0, hw: 6, hd: 6 }), 0, 0.016);
  const L2 = st2.lay.get('p');
  assert.ok(L2.agg.has(zid) && L2.agg.has('#zone:f:lib'), '구역 묶음 + 임시 묶음');
});

test('복셀(§81.2): 접힌 임시 폴더 = 서랍 칸 하나(굵은 탭), 집기 기준점', () => {
  const book = new ArtBook();
  fill(book, 'p', ['src/a.js', 'src/b.js']);
  fill(book, 'p', Array.from({ length: 12 }, (_, i) => `tmp/run/r${i}.log`));
  const office = { id: 'o', type: 'office', ownerId: 's:m', projectId: 'p', origin: { x: 0, z: 0 }, size: { w: 24, d: 18 }, ext: 0,
    bounds: { minX: -12, maxX: 12, minZ: -9, maxZ: 9 }, door: { x: 7.8, z: 8.3, out: { x: 7.8, z: 9.8 } } };
  const P = new VxArtPlan().sync('p', book.layoutItems('p').items, office);
  const zid = TEMP_ZONE + 'tmp/run';
  assert.equal(P.slots.size, 3, '일반 2 + 묶음 1');
  assert.ok(P.slots.get(zid) && P.slots.get(zid).k === 'file' && P.agg.get(zid));
  const env = { nodePos: () => null, nowMs: T, reduced: false, foot: null, hover: null, isLight: false, hits: [], unitPx: () => 20 };
  voxelArtGeometry(book, new Map([['p', P]]), new ArtFx(), 0, env, new ArtGeo());
  assert.ok(env.hits.some((h) => h.id === zid));
});

test('팝업 모델(§79.16): 접힌 임시 폴더 — 종류·수·대표 파일·누가 언제', () => {
  const book = new ArtBook();
  fill(book, 'p', Array.from({ length: 6 }, (_, i) => `.autopilot/scratch/q151/f${i}.json`));
  const z = book.layoutItems('p').agg.get(TEMP_ZONE + '.autopilot/scratch/q151');
  _setLangForTest('ko');
  const m = artInspectModel(z, T + 60_000, (id) => id);
  assert.equal(m.kind, '임시 폴더(접음)'); assert.equal(m.title, 'scratch/q151'); assert.equal(m.path, '.autopilot/scratch/q151');
  assert.ok(m.lines[0].includes('6'));
  assert.equal(m.lines.filter((l) => l.startsWith('· ')).length, ART.TEMP_FOLD_FILES);
  assert.ok(m.lines[1].includes('f5.json'), '최근 파일 먼저');
  assert.ok(m.log.length === 6 && m.who.length === 1);
  _setLangForTest('en');
  assert.equal(artInspectModel(z, T, (id) => id).kind, 'Temp folder (folded)');
  _setLangForTest('ko');
});
