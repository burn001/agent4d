// node --test "web/test/art-lw-key.test.mjs"   [T4-art-lw-key] 2D 선 묶음 열쇠 — 굵기 LW≥4 가 색 번호를 밀지 않음(이슈 6)
// ArtGeo.line 은 굵기를 Uint8 LW 에 그대로 둔다(연구소 파도 띠 LP.WAVE_W 4). 2D 렌더러(flat/art2d.js·flat/art-layer2d.js)의
// 열쇠 (색*4 + 굵기)*16 + 알파단계 는 굵기 칸이 2비트라 4 가 다음 색·1px 로 풀렸다 → artLineKey 가 굵기를 0～3 으로 묶는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ART_KEYS, ART_LW_MAX, artLineKey, artLineKeyParts, ArtBook, ArtFx, ArtGeo } from '../artifact-core.mjs';
import { LP, labSectorPlan, labPlatformGeometry } from '../lab/lab-platform-core.mjs';
import { LAB } from '../lab/lab-const.mjs';
import { KI } from '../art-meta.mjs';

const AB = 10; // 두 렌더러의 선 알파 단계
const oldKey = (c, w, ab) => (c * 4 + w) * 16 + ab;

test('(1) 왕복: 모든 색·굵기 0～6·알파 단계 1～15 — 색 그대로, 굵기 min(3,w), 알파 그대로', () => {
  assert.equal(ART_LW_MAX, 3);
  const out = { c: -1, w: -1, ab: -1 };
  for (let c = 0; c <= ART_KEYS.length; c++)
    for (let w = 0; w <= 6; w++)
      for (let ab = 1; ab <= 15; ab++) {
        const p = artLineKeyParts(artLineKey(c, w, ab), out);
        assert.equal(p, out, 'out 객체를 그대로 채워 돌려줌(할당 없음)');
        assert.deepEqual({ ...p }, { c, w: Math.min(3, w), ab }, `c${c} w${w} ab${ab}`);
      }
  assert.deepEqual(artLineKeyParts(artLineKey(2, 1, 5)), { c: 2, w: 1, ab: 5 }, 'out 없이도 동작');
});

test('(2) 회귀 0: 굵기 0～3 이면 새 열쇠 = 옛 식 (c*4+w)*16+ab', () => {
  for (let c = 0; c <= ART_KEYS.length; c++)
    for (let w = 0; w <= 3; w++)
      for (let ab = 1; ab <= 15; ab++) assert.equal(artLineKey(c, w, ab), oldKey(c, w, ab), `c${c} w${w} ab${ab}`);
  // 옛 식의 밀림(수리 근거): LW 4 는 다음 색·굵기 0 으로 풀렸음
  const k = oldKey(KI.write, 4, 7), rest = (k / 16) | 0;
  assert.equal((rest / 4) | 0, KI.write + 1); assert.equal(rest % 4, 0);
});

// ── 대량 변경 파도 장면(lab-fx-vis.test.mjs (c) 와 같은 방식) ──
const ts = (s) => new Date(Date.UTC(2026, 10, 1, 0, 0, s)).toISOString();
const T3 = Date.parse(ts(3));
const ev = (type, art, s, tu) => ({ type, ts: ts(s), nodeId: 'n1', toolUseId: tu, art });
const F = (path) => { const k = path.lastIndexOf('/'); return { k: 'file', id: path.toLowerCase(), p: path, d: path.slice(0, k), n: path.slice(k + 1), v: 'create', sz: 10 }; };
const env = () => ({ nowMs: T3 + 1000, reduced: false, foot: null, hover: null, hits: [], nodePos: () => ({ x: 0, y: 3, z: 20 }), style: null, isLight: false, unitPx: () => 30 });

test('(3) 파도 장면: 모든 선(LW 4 포함)의 열쇠를 풀면 색 번호 = g.LC[i], 굵기 = min(3, LW)', () => {
  assert.equal(LP.WAVE_W, 4, '파도 띠 값은 그대로(3D·lab-fx-vis 가 w≥4 로 식별)');
  const book = new ArtBook(), pid = book.defaultProject;
  for (let i = 0; i < 20; i++) book.touch(pid, F(`src${i % 2}/f${i}.js`), 1000 + i, 'n1', `tusrc${i}`);
  const plan = labSectorPlan(book.layoutItems(pid).items, 12, null);
  const fx = new ArtFx();
  const ids = [...plan.cellOf.entries()].filter(([, c]) => c.sector === 'f:src0').map(([k]) => k).slice(0, 6);
  assert.equal(ids.length, 6);
  ids.forEach((id, i) => { const it = book.get(pid, id); fx.note(book.apply(ev('tool-end', [{ k: 'file', id, p: it.p, d: it.d, n: it.n, v: 'modify', sz: 1 }], 30 + i, 'tuB' + i), pid), 'n1', 50 + i * 0.3); });
  const plans = new Map([[pid, { plan, cx: 0, cz: 0, rWall: 30 }]]);
  labPlatformGeometry(book, plans, fx, 51.8, env(), new ArtGeo()); // 파도 시작
  const g = labPlatformGeometry(book, plans, fx, 51.8 + 1.5, env(), new ArtGeo()); // 파도 한가운데
  let w4 = 0;
  const out = {};
  for (let i = 0; i < g.nl; i++) {
    const ab = Math.max(1, Math.round(g.LA[i] * AB));
    const p = artLineKeyParts(artLineKey(g.LC[i], g.LW[i], ab), out);
    assert.equal(p.c, g.LC[i], `선 ${i}: 색 ${g.LC[i]} 굵기 ${g.LW[i]}`);
    assert.equal(p.w, Math.min(3, g.LW[i]));
    assert.equal(p.ab, ab);
    if (g.LW[i] >= 4) { w4++; assert.equal(g.LC[i], KI.write); assert.equal(p.w, 3, 'LW≥4 는 2D 에서 가장 굵음(2.6px)'); }
  }
  assert.ok(w4 >= 6, `LW 4 파도 선 ${w4}`);
  assert.ok(LAB.PLATFORM.H > 0);
});

test('(4) 원문 연결: 2D 렌더러 둘이 artLineKey·artLineKeyParts 를 불러 쓰고 맨 식이 남지 않음', () => {
  for (const f of ['../flat/art2d.js', '../flat/art-layer2d.js']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.match(src, /import \{[^}]*\bartLineKey\b[^}]*\} from '\.\.\/artifact-core\.mjs'/, f + ' import artLineKey');
    assert.match(src, /import \{[^}]*\bartLineKeyParts\b[^}]*\} from '\.\.\/artifact-core\.mjs'/, f + ' import artLineKeyParts');
    assert.match(src, /artLineKey\(g\.LC\[i\], g\.LW\[i\],/, f + ' 열쇠 만들기');
    assert.match(src, /artLineKeyParts\(k, KP\)/, f + ' 열쇠 풀기(재사용 객체)');
    assert.ok(!src.includes('g.LC[i] * 4 + g.LW[i]'), f + ' 맨 열쇠 식 없음');
    assert.ok(!/rest % 4/.test(src), f + ' 맨 풀기 식 없음');
    assert.match(src, /w === 3 \? 2\.6 : w === 2 \? 1\.8 : 1/, f + ' 굵기 대응(3 = 2.6px) 그대로');
  }
});
