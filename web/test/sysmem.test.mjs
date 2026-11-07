// 시스템 메모리 게이지 순수 함수 · ⚙ 켬/끔 저장값 · 상단 바 CSS 토큰
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memLevel, memView, fmtGB, memPctText, validMem, MEM_WARN_PCT, MEM_DANGER_PCT } from '../sysmem-core.mjs';

const GIB = 1024 ** 3;
const V = (usedG, totalG = 64) => ({ used: usedG * GIB, total: totalG * GIB, pct: Math.round((usedG / totalG) * 1000) / 10 });

test('색 경계 79.9 / 80 / 89.9 / 90 (토큰 단계 이름은 한도 게이지와 같음)', () => {
  assert.equal(MEM_WARN_PCT, 80); assert.equal(MEM_DANGER_PCT, 90);
  assert.equal(memLevel(79.9), 'ok');
  assert.equal(memLevel(80), 'warn');
  assert.equal(memLevel(89.9), 'warn');
  assert.equal(memLevel(90), 'danger');
  assert.equal(memLevel(100), 'danger');
  assert.equal(memLevel(null), 'none');
});

test('GB·퍼센트 문구', () => {
  assert.equal(fmtGB(39.55 * GIB), '39.6');
  assert.equal(fmtGB(64 * GIB), '64.0');
  assert.equal(fmtGB(128 * GIB), '128');
  assert.equal(fmtGB(null), '—');
  assert.equal(memPctText(62.46), '62%');
  assert.equal(memPctText(120), '100%');
});

test('memView: 사용/전체 GB 툴팁, 꺼짐·재생 중·값 없음·이상 값이면 숨김', () => {
  const v = memView(V(40));
  assert.equal(v.visible, true);
  assert.equal(v.level, 'ok');
  assert.equal(v.pctText, '63%');
  assert.equal(v.usedText, '40.0'); assert.equal(v.totalText, '64.0'); assert.equal(v.availText, '24.0');
  assert.match(v.title, /40\.0 \/ 64\.0 GB/);
  assert.match(v.title, /가용 24\.0 GB/);
  assert.equal(memView(V(58)).level, 'danger');
  assert.equal(memView(V(52)).level, 'warn');
  assert.equal(memView(V(40), { on: false }).visible, false);
  assert.equal(memView(V(40), { replaying: true }).visible, false);
  assert.equal(memView(null).visible, false);
  assert.equal(memView({ used: 9, total: 8, pct: 100 }).visible, false);
  assert.equal(validMem({ used: 0, total: 0 }), false);
  const s = memView(V(40), { stale: true });
  assert.equal(s.stale, true);
  assert.match(s.title, /연결 끊김/);
});

test('⚙ 켬/끔: 기본 켬, ccviz.mem 저장·구독', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    const m = await import('../sysmem-pref.mjs?t=' + Date.now());
    assert.equal(m.memGaugeOn(), true);
    const seen = [];
    m.onMemGauge((on) => seen.push(on));
    m.setMemGaugeOn(false);
    assert.equal(m.memGaugeOn(), false);
    assert.equal(store.get('ccviz.mem'), '0');
    m.setMemGaugeOn(true, { persist: false });
    assert.equal(store.get('ccviz.mem'), '0');
    assert.deepEqual(seen, [false, true]);
  } finally { delete globalThis.localStorage; }
});

test('CSS: 테마 토큰만(--k-main·--warn·--error), 라이트 대체색, 좁은 화면 카드', () => {
  const css = readFileSync(new URL('../sysmem.css', import.meta.url), 'utf8');
  assert.match(css, /var\(--k-main\)/);
  assert.match(css, /var\(--warn, #f59e0b\)/);
  assert.match(css, /:root\[data-theme="light"\] \.memg-pill \{ --m-warn: var\(--warn, #b45309\)/);
  assert.match(css, /var\(--error\)/);
  assert.match(css, /@media \(max-width: 719px\)/);
  assert.doesNotMatch(css.replace(/var\(--warn, #[0-9a-f]+\)/g, ''), /#[0-9a-f]{3,6}\b/i, '토큰 밖 색 없음');
});
