// 작업 대상 층 폴더 묶음 문턱 — 대상 수가 ART.LOD_COUNT 를 넘으면 섬 크기·모양과 무관하게 폴더 묶음 배치(흐름·Planet 공용 ArtState)
import test from 'node:test';
import assert from 'node:assert/strict';
import { ART, ArtBook, ArtFx, ArtState, needsAgg } from '../artifact-core.mjs';
import { PLANET_ART } from '../art-meta.mjs';

const T = Date.parse('2026-10-24T10:00:00Z');
/** n개 파일을 폴더 nf 개에 고르게(이름은 일반적인 것만) */
function bookOf(n, nf = 12) {
  const book = new ArtBook();
  for (let i = 0; i < n; i++) {
    const d = `mod${i % nf}/lib`, id = `${d}/file${i}.js`;
    book.touch('p', { k: 'file', id, p: id, d, n: `file${i}.js`, v: 'modify' }, T + i * 1000, 's:m', `tu-${i}`);
  }
  book.touch('p', { k: 'db', id: 'db:mongo/app', n: 'app', v: 'query' }, T, 's:m', 'tu-db');
  return book;
}
// 흐름 섬 = 납작한 직사각형, Planet 섬 = 원의 외접 정사각형 × SHRINK — 둘 다 넉넉해서 섬에 드는 크기
const FLOW = () => ({ x: 0, z: 0, hw: 120, hd: 70 });
const PLANET = () => ({ x: 0, z: 0, hw: 160 * PLANET_ART.SHRINK, hd: 160 * PLANET_ART.SHRINK });
const layOf = (book, target) => { const st = new ArtState({ book, fx: new ArtFx() }); st.frame(['p'], target, 0, 0.016); return st.lay.get('p'); };

test('needsAgg: 대상 수 문턱(LOD_COUNT)은 섬 크기와 무관, 문턱 아래는 섬 맞춤(LOD_SCALE)만', () => {
  assert.equal(ART.LOD_COUNT, 150);
  const B = { x0: -10, z0: -10, x1: 10, z1: 10 };
  assert.equal(needsAgg(ART.LOD_COUNT, B, { hw: 500, hd: 500 }), false);
  assert.equal(needsAgg(ART.LOD_COUNT + 1, B, { hw: 500, hd: 500 }), true);
  assert.equal(needsAgg(ART.LOD_COUNT + 1, B, null), true); // 섬 크기를 몰라도
  assert.equal(needsAgg(10, B, { hw: 5, hd: 5 }), true);   // 작은 섬은 예전처럼
  assert.equal(needsAgg(10, B, null), false);
});

test('문턱 넘음: 넉넉한 섬에서도 흐름·Planet 모두 폴더 묶음, 같은 항목 집합', () => {
  const book = bookOf(200);
  const F = layOf(book, FLOW), P = layOf(book, PLANET);
  assert.ok(F.agg && P.agg, '둘 다 묶음 배치');
  assert.equal(F.pos.size, 12 + 1); // 폴더 12 + DB 하나
  assert.deepEqual([...F.pos.keys()].sort(), [...P.pos.keys()].sort());
  assert.equal([...F.agg.values()].reduce((s, z) => s + z.count, 0), 200);
});

test('문턱 안 넘음: 섬에 들면 흐름·Planet 모두 대상별 배치, 같은 항목 집합', () => {
  const book = bookOf(ART.LOD_COUNT - 1); // 파일 149 + DB 1 = 150(문턱과 같음 → 넘지 않음)
  const F = layOf(book, FLOW), P = layOf(book, PLANET);
  assert.ok(!F.agg && !P.agg, '둘 다 대상별');
  assert.equal(F.pos.size, ART.LOD_COUNT);
  assert.deepEqual([...F.pos.keys()].sort(), [...P.pos.keys()].sort());
});
