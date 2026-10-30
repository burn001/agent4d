// Planet 과열 연출 규칙(planet-heat-core.mjs) + 3D·2D 배선 대조
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PHEAT, heatDrawStage, heatLook, heatRgb, heatCss, smokeCap, heatLive, heatOnStep, puff2D, flare2D, farK, heatRingK } from '../planet-heat-core.mjs';
import { heatOfPct, HeatBook, HOT_H, CRIT_H } from '../heat-core.mjs';

const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const h0smoke = () => heatLook(heatOfPct(80)).smoke;

test('그릴 단계: heat-core 문턱(30·70·90%)과 같다', () => {
  for (const pct of [20, 30, 35, 50, 69.9, 70, 80, 89.9, 90, 99]) {
    const h = heatOfPct(pct);
    const want = pct >= 90 ? 3 : pct >= 70 ? 2 : pct > 30 ? 1 : 0;
    assert.equal(heatDrawStage(h), want, `${pct}%`);
  }
  assert.ok(Math.abs(PHEAT.HOT_H - 4 / 7) < 1e-9 && Math.abs(PHEAT.CRIT_H - 6 / 7) < 1e-9);
  assert.equal(PHEAT.HOT_H, HOT_H); assert.equal(PHEAT.CRIT_H, CRIT_H);
});

test('세기: 단계가 오를수록 커지고, 단계별 연출은 그 단계부터', () => {
  const at = (pct) => heatLook(heatOfPct(pct));
  const a = at(30), w0 = at(32), w = at(60), h = at(80), c = at(95);
  assert.equal(a.glow, 0); assert.equal(a.smoke, 0);
  assert.ok(w0.warm >= 0.2 && w0.warm < 0.35 && w0.glow > 0.05, '30% 막 넘으면 바로 보임');
  assert.ok(at(40).warm > 0.4 && at(40).glow > 0.2, '40% 면 한눈에(예전 0.18 의 2.5배쯤, 멀리서 읽히게 더 밝게)');
  assert.ok(at(32).smoke > 0 && at(32).smoke < at(55).smoke, '30% 부터 가는 김(50% 로 갈수록 늘어남)');
  assert.ok(at(55).smoke > 0 && at(55).smoke < h0smoke(), '데움 가닥은 과열보다 적게');
  assert.ok(at(40).warm < at(50).warm && at(50).warm < w.warm && w.warm < at(69).warm, '70% 로 갈수록 짙게');
  assert.ok(w.warm > 0.5 && w.hot === 0 && w.wisp === 1 && w.tail === 0 && w.pulse === 0, '데움 = 표면·테두리·글로우 + 옅은 가닥');
  assert.ok(h.hot === 1 && h.smoke > 0 && h.pulse > 0 && h.tail === 0 && h.ember === 0, '과열 = 맥동·연기 가닥');
  assert.ok(c.crit === 1 && c.tail > 0 && c.ember > 0 && c.flare > 0, '위험 = 꼬리·불티·플레어');
  assert.ok(w.glow < h.glow && h.glow < c.glow);
  assert.ok(w.glowR <= h.glowR && h.glowR < c.glowR);
  assert.ok(h.shade < c.shade && c.shade > 0.9, '위험 연기가 더 짙다(검은 연기)');
});

test('멀리서 읽히는 신호: 후광·연기 화면 px 하한, 몸 색 물듦, 궤도 단계색이 단계마다 커진다', () => {
  const at = (pct) => heatLook(heatOfPct(pct));
  const seq = [32, 40, 60, 80, 95].map(at);
  for (let i = 1; i < seq.length; i++) {
    assert.ok(seq[i].haloPx > seq[i - 1].haloPx, 'haloPx 증가');
    assert.ok(seq[i].tint >= seq[i - 1].tint && seq[i].ring > seq[i - 1].ring, 'tint·ring 증가');
  }
  assert.ok(at(32).haloPx >= 8 && at(32).tint > 0.1, '데움 시작부터 보이는 후광·물듦');
  assert.ok(at(80).haloPx - at(60).haloPx > 6 && at(95).haloPx > 34, '70%·90% 문턱에서 크게 뜀');
  assert.ok(at(95).smokePx > at(80).smokePx && at(80).smokePx > at(60).smokePx);
  for (const pct of [32, 50, 75, 95]) assert.ok(Math.abs(heatRingK(heatOfPct(pct)) - at(pct).ring) < 1e-9, 'heatRingK = heatLook.ring');
  assert.equal(heatRingK(0), 0);
  assert.equal(farK(1440), 1); assert.equal(farK(200), 0.6); assert.equal(farK(4000), 1.4);
});

test('움직임 줄이기 = 정지 글로우만 · 추정 창은 조금 약하게', () => {
  const r = heatLook(0.95, { reduced: true });
  assert.ok(r.glow > 0 && r.warm > 0 && r.hot > 0);
  for (const k of ['pulse', 'smoke', 'tail', 'ember', 'flare']) assert.equal(r[k], 0, k);
  const e = heatLook(0.95, { estimated: true }), n = heatLook(0.95);
  assert.ok(e.glow < n.glow && e.glow > n.glow * 0.7);
});

test('색: 주황 → 빨강, CSS 문자열', () => {
  assert.deepEqual(heatRgb(0).map((x) => +x.toFixed(3)), [...PHEAT.ORANGE]);
  assert.deepEqual(heatRgb(1).map((x) => +x.toFixed(3)), [...PHEAT.RED]);
  assert.ok(heatRgb(0.6)[1] < heatRgb(0.2)[1]);
  assert.match(heatCss(0.5, 0.4), /^rgba\(255,\d+,\d+,0\.400\)$/);
  assert.match(heatCss(0.5, 3), /,1\.000\)$/);
});

test('거리 LOD · 켜짐(완료·퇴장 꺼짐)', () => {
  assert.equal(smokeCap(1), 0);
  assert.equal(smokeCap(2), PHEAT.CAP_FAR, '멀리서도 연기 몇 가닥');
  assert.equal(smokeCap(PHEAT.PX_SMOKE), PHEAT.CAP_MID);
  assert.equal(smokeCap(40), PHEAT.CAP_NEAR);
  const v = (o) => ({ node: { status: 'active' }, hidden: false, gone: false, exiting: null, ...o });
  assert.equal(heatLive(v()), true);
  assert.equal(heatLive(v({ node: { status: 'error' } })), true);
  assert.equal(heatLive(v({ node: { status: 'done' } })), false);
  assert.equal(heatLive(v({ node: { status: 'stopped' } })), false);
  assert.equal(heatLive(v({ exiting: 0.2 })), false);
  assert.equal(heatLive(v({ gone: true })), false);
  assert.equal(heatLive(null), false);
  assert.equal(heatOnStep(0, true, 0.1), 1);
  let o = 1; for (let i = 0; i < 10; i++) o = heatOnStep(o, false, PHEAT.OFF_S / 10);
  assert.ok(o < 1e-9);
});

test('2D 연기: 같은 시각이면 같은 값, 엇갈려 태어나고 수명 안에서 돈다', () => {
  const a = puff2D(12.3, 2, 6, 1.7, 0.4, {}), b = puff2D(12.3, 2, 6, 1.7, 0.4, {});
  assert.deepEqual(a, b);
  assert.ok(a.t >= 0 && a.t < 1 && a.jit >= -1 && a.jit <= 1);
  const ts = Array.from({ length: 6 }, (_, i) => puff2D(5, i, 6, 1.7, 0, {}).t).sort((x, y) => x - y);
  for (let i = 1; i < ts.length; i++) assert.ok(Math.abs(ts[i] - ts[i - 1] - 1 / 6) < 1e-6, '고르게 엇갈림');
  assert.equal(flare2D(10, 0.3, 0).k, 0);
  let seen = 0; for (let t = 0; t < 200; t += 0.05) { const f = flare2D(t, 0.3, 1); assert.ok(f.k >= 0 && f.k <= 1); if (f.k > 0.5) seen++; }
  assert.ok(seen > 0 && seen < 400, '가끔만 플레어');
});

test('compact 급락: HeatBook 으로 몇 초에 걸쳐 식는다(세기도 따라 내려감)', () => {
  const hb = new HeatBook(), n = (pct) => ({ meta: { ctx: { pct } } });
  hb.step('a', n(100), 0);
  let h = hb.step('a', n(12), 0.5);
  assert.ok(heatLook(h).crit > 0, '0.5초 뒤엔 아직 위험');
  h = hb.step('a', n(12), 0.5);
  assert.ok(heatLook(h).hot > 0 && heatLook(h).crit === 0, '1초 뒤엔 과열(연기 꼬리는 먼저 걷힘)');
  for (let i = 0; i < 3; i++) h = hb.step('a', n(12), 1);
  assert.equal(h, 0);
  assert.equal(heatLook(h).glow, 0);
});

test('배선: 3D(PlanetDeco·셰이더·뚜르비용·reset)와 2D(Planet2DView) 모두 연결', () => {
  const deco = src('planet-deco.js'), sub = src('planet-sub.js'), tb = src('planet-tourb.js'), view = src('planet-view.js'), p2 = src('flat/planet2d.js'), h3 = src('planet-heat.js'), h2 = src('flat/planet-heat2d.js');
  assert.match(deco, /new PlanetHeat\(view, this\)/);
  assert.match(deco, /this\.heat\.update\(now, dt,/);
  assert.match(deco, /uHeat: \{ value: 0 \}, uHeatT: \{ value: 0 \}/);
  assert.match(deco, /uniform float [^;]*uHeat, uHeatT;/);
  assert.match(sub, /uniform float [^;]*uHeat, uHeatT;/);
  assert.match(sub, /uHeat: \{ value: 0 \}, uHeatT: \{ value: 0 \}/);
  assert.match(tb, /\n  heat\(h, L\) \{/);
  assert.match(view, /this\.deco\.heat\.clear\(\)/);
  assert.match(h3, /HeatBook/); assert.match(h3, /MultiplyBlending/); assert.match(h3, /reduced/);
  assert.match(p2, /new Heat2D\(this\)/);
  assert.match(p2, /heat2d\.step\(now, dt\)/);
  assert.match(p2, /heat2d\.drawUnder\(/); assert.match(p2, /heat2d\.drawOver\(/);
  assert.match(p2, /this\.heat2d\.clear\(\)/);
  assert.match(h2, /'multiply'/); assert.match(h2, /HeatBook/);
  assert.match(h3, /haloPx \* wpp/); assert.match(h3, /smokePx \* wpp/); assert.match(h3, /tintColor\(id, base, out\)/);
  assert.match(deco, /heat\.tintColor\(v\.id, v\.mat\.color, _hc\)/);
  assert.match(h2, /haloPx \* farK\(view\.H\)/); assert.match(h2, /smokePx \* farK\(view\.H\)/); assert.match(p2, /heat2d\.tintCol\(v, col\)/);
});
