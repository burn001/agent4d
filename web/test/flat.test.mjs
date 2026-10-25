// 2D(저사양) 표현 순수 부분 시험: 차원 고르기·저장 규칙, 2D 카메라 기하(좌표 변환·커서 기준 줌·끌기·전체 맞춤),
// 클릭 판정, 육각·베지어 보조, 도구 카드 방향 슬롯, 갱신 간격, 그리고 "2D 경로는 three.js 를 정적으로 끌어오지 않는다" 회귀 검사.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normDim, initialDim, renderer2dFor, DIMS, DEFAULT_DIM, RENDERERS_2D } from '../renderers.js';
import {
  FLAT, capDpr, toScreen, toWorld, zoomAt, panBy, camScale, boxCenterXZ, fitNeed, fitMinD, flyPose, dampTo,
  pickNearest, hexPoints, bezPrefix, cardOffset, cardPx, ctxRingTone, tickInterval,
} from '../flat/flat-core.mjs';
import { PurgeBook, MAX_REGIONS } from '../ctx-core.mjs';
import { escapeHtml } from '../html-util.mjs';
import { islandLabelHtml } from '../overview/island-label.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('차원: 정규화·처음 값(URL 우선·저장값·기본 3D)·2D 로더(세 표현 모두 2D 판, 모르는 id 만 Flow 2D + 준비 중)', () => {
  assert.deepEqual(DIMS, ['3d', '2d']);
  assert.equal(DEFAULT_DIM, '3d');
  for (const x of ['2d', '2D', ' 2d ', '2', 'flat', 'low']) assert.equal(normDim(x), '2d', x);
  for (const x of ['3d', '3D', '3']) assert.equal(normDim(x), '3d', x);
  for (const x of [null, undefined, '', 'x', '4d']) assert.equal(normDim(x), null, String(x));
  assert.equal(initialDim(null, null), '3d');
  assert.equal(initialDim(null, '2d'), '2d');
  assert.equal(initialDim('3d', '2d'), '3d', 'URL 이 저장값보다 우선');
  assert.equal(initialDim('2d', '3d'), '2d');
  assert.equal(initialDim('zz', '2d'), '2d', '모르는 URL 값은 무시');
  assert.equal(renderer2dFor('flow').pending, null);
  assert.equal(renderer2dFor('flow').load, RENDERERS_2D.flow);
  for (const m of ['planet', 'voxel']) { const r = renderer2dFor(m); assert.equal(r.pending, null, m); assert.equal(r.load, RENDERERS_2D[m]); }
  const u = renderer2dFor('zzz'); assert.equal(u.pending, 'zzz'); assert.equal(u.load, RENDERERS_2D.flow);
});

test('2D 카메라: 세계↔화면 왕복, 커서 아래 점을 지키는 줌, 끌기, D 범위', () => {
  const W = 1000, H = 600;
  const cam = { x: 5, z: -3, D: 40 };
  const s = camScale(cam, H);
  assert.ok(near(s, 300 / 40));
  const p = toScreen(cam, W, H, 12, 7);
  const w = toWorld(cam, W, H, p.x, p.y);
  assert.ok(near(w.x, 12) && near(w.z, 7));
  assert.deepEqual(toScreen(cam, W, H, 5, -3), { x: 500, y: 300 }, '시선점 = 화면 가운데');
  const before = toWorld(cam, W, H, 820, 140);
  zoomAt(cam, W, H, 820, 140, 0.5);
  assert.ok(near(cam.D, 20));
  const after = toWorld(cam, W, H, 820, 140);
  assert.ok(near(before.x, after.x, 1e-9) && near(before.z, after.z, 1e-9), '커서 아래 세계 점 그대로');
  zoomAt(cam, W, H, 500, 300, 1e-9); assert.equal(cam.D, FLAT.D_MIN);
  zoomAt(cam, W, H, 500, 300, 1e12); assert.equal(cam.D, FLAT.D_MAX);
  const c2 = { x: 0, z: 0, D: 30 };
  const a = toWorld(c2, W, H, 400, 300);
  panBy(c2, H, 50, -20);
  const b = toWorld(c2, W, H, 450, 280);
  assert.ok(near(a.x, b.x) && near(a.z, b.z), '끈 만큼 세계가 손을 따라 움직임');
  assert.equal(capDpr(3), FLAT.DPR_MAX); assert.equal(capDpr(1.25), 1.25); assert.equal(capDpr(0), 1);
});

test('전체 맞춤(§41.5 2D판): 모든 점(반지름 포함)이 여백 안, 노드 하나면 최소 거리, 비행·감쇠', () => {
  const W = 1280, H = 720, aspect = W / H;
  const pts = [{ p: { x: -30, z: 4 }, r: 3 }, { p: { x: 22, z: -18 }, r: 5 }, { p: { x: 10, z: 26 }, r: 2 }];
  const c = boxCenterXZ(pts);
  assert.ok(near(c.x, (-33 + 27) / 2) && near(c.z, (-23 + 28) / 2));
  const D = fitNeed(pts, c, aspect);
  const cam = { x: c.x, z: c.z, D };
  for (const { p, r } of pts) {
    const s = toScreen(cam, W, H, p.x, p.z), rp = r * camScale(cam, H);
    assert.ok(s.x - rp >= W / 2 - (W / 2) * FLAT.FIT_MH - 1e-6 && s.x + rp <= W / 2 + (W / 2) * FLAT.FIT_MH + 1e-6, 'x 여백');
    assert.ok(s.y - rp >= H / 2 - (H / 2) * FLAT.FIT_MV - 1e-6 && s.y + rp <= H / 2 + (H / 2) * FLAT.FIT_MV + 1e-6, 'y 여백');
  }
  // 한 점이라도 여백 끝에 닿는다(최소 D)
  assert.ok(pts.some(({ p, r }) => near(Math.max((Math.abs(p.x - c.x) + r) / (aspect * FLAT.FIT_MH), (Math.abs(p.z - c.z) + r) / FLAT.FIT_MV), D, 1e-9)));
  assert.ok(fitMinD(aspect) >= FLAT.MIN_R / FLAT.FIT_MV);
  const f = flyPose({ x: 0, z: 0, D: 10 }, { x: 10, z: -4, D: 1000 }, 0.5);
  assert.ok(near(f.x, 5) && near(f.z, -2) && near(f.D, 100), 'D 는 로그 보간');
  assert.deepEqual(flyPose({ x: 1, z: 2, D: 3 }, { x: 4, z: 5, D: 6 }, 1), { x: 4, z: 5, D: 6 });
  const cm = { x: 0, z: 0, D: 50 };
  dampTo(cm, { x: 10, z: 0, D: 50 }, 0.1);
  assert.ok(cm.x > 0 && cm.x < 10);
  const cm2 = { x: 9.99, z: 0, D: 50 };
  dampTo(cm2, { x: 10, z: 0, D: 50 }, 0.016);
  assert.equal(cm2.x, 10, '거의 닿으면 정확히 맞추고 멈춤(다시 그리기 없음)');
});

test('클릭 판정: 가장 가까운(반지름 대비) 칩, 작은 칩은 최소 9px 까지', () => {
  const items = [{ id: 'a', x: 100, y: 100, r: 20 }, { id: 'b', x: 130, y: 100, r: 20 }, { id: 'tiny', x: 300, y: 300, r: 2 }];
  assert.equal(pickNearest(items, 104, 100), 'a');
  assert.equal(pickNearest(items, 127, 101), 'b');
  assert.equal(pickNearest(items, 307, 302), 'tiny', '작은 칩도 9px 안이면');
  assert.equal(pickNearest(items, 320, 320), null);
  assert.equal(pickNearest([], 0, 0), null);
});

test('육각·베지어 보조: 정육각형(꼭짓점 위), 베지어 앞부분 끝점', () => {
  const h = hexPoints(10, 20, 5);
  assert.equal(h.length, 12);
  assert.ok(near(h[0], 10) && near(h[1], 15), '첫 꼭짓점이 위');
  for (let i = 0; i < 6; i++) assert.ok(near(Math.hypot(h[2 * i] - 10, h[2 * i + 1] - 20), 5));
  const P = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  const full = bezPrefix(...P, 1);
  assert.ok(near(full[3].x, 30) && near(full[3].y, 10));
  const half = bezPrefix(...P, 0.5);
  assert.deepEqual(half[0], P[0]);
  // B(0.5) = (P0 + 3P1 + 3P2 + P3)/8
  assert.ok(near(half[3].x, (0 + 30 + 60 + 30) / 8) && near(half[3].y, (0 + 0 + 30 + 10) / 8));
});

test('도구 카드 자리(§38.10 방향 슬롯 2D판): 셸 오른쪽·검색/말 위·읽기 왼쪽 위·편집 왼쪽·에이전트 아래, 쌓임·라벨 밀기', () => {
  const o = (d, st = 0, lp = 0) => cardOffset(d, 20, 120, 60, st, lp);
  const sh = o('shell'); assert.ok(sh.dx > 0 && Math.abs(sh.dy) < 1e-9);
  const se = o('search'); assert.ok(se.dy < 0 && Math.abs(se.dx) < 1e-9);
  const sa = o('say'); assert.ok(near(sa.dx, se.dx) && near(sa.dy, se.dy));
  const rd = o('read'); assert.ok(rd.dx < 0 && rd.dy < 0);
  const ed = o('edit'); assert.ok(ed.dx < 0 && Math.abs(ed.dy) < 1e-9);
  const ag = o('agent'); assert.ok(ag.dy > 0 && Math.abs(ag.dx) < 1e-9);
  const sk = o('skill'); assert.ok(sk.dx < 0 && sk.dy > 0);
  const ms = o('misc'); assert.ok(ms.dx > 0 && ms.dy > 0);
  // 카드가 칩과 겹치지 않음: 셸 카드 왼쪽 끝 > 칩 반지름
  assert.ok(sh.dx - 60 > 20);
  assert.ok(o('shell', 1).dx > sh.dx, '쌓임 순번만큼 더 바깥');
  assert.ok(o('agent', 0, 30).dy > ag.dy, '라벨 밀기');
  assert.equal(cardPx(1, 10), 10);
  assert.equal(cardPx(1, 10, { minPx: 30 }), 30, '상위 노드 최소 높이');
  assert.equal(cardPx(100, 10), 230, '최대 높이');
  assert.equal(ctxRingTone(40), 'thinking'); assert.equal(ctxRingTone(60), 'tool'); assert.equal(ctxRingTone(90), 'error');
});

test('렌더 루프 간격: 움직임 30fps, 배경 움직임만 15fps, 쉬면 4Hz, 숨긴 탭은 멈춤', () => {
  assert.ok(near(tickInterval(2), 1000 / 30));
  assert.ok(near(tickInterval(1), 1000 / 15));
  assert.equal(tickInterval(0), FLAT.IDLE_MS);
  assert.equal(tickInterval(2, true), null);
  assert.equal(FLAT.FPS, 30);
  assert.equal(FLAT.DPR_MAX, 1.5);
});

/** web/ 안 모듈의 정적 import 닫힘(동적 import() 는 따라가지 않음) */
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

test('2D 경로는 three.js 를 정적으로 끌어오지 않는다(app.js·2D 표현·2D 카메라) — 3D 는 동적 import 로만', () => {
  for (const e of ['app.js', 'flat/flow2d.js', 'flat/planet2d.js', 'flat/voxel2d.js', 'flat/camera2d.js']) {
    const { bare } = staticClosure(e);
    assert.deepEqual(bare, [], `${e}: ${bare.join(', ')}`);
  }
  const { files } = staticClosure('app.js');
  for (const f of ['scene.js', 'camera.js', 'noise.js', 'env/ground.js', 'env/weather.js', 'overview/islands.js']) assert.ok(!files.includes(f), `app.js 가 ${f} 를 정적으로`);
  // index.html: three·3D 모듈 미리 받기는 정적 태그가 아니라 3D 일 때만 스크립트가 넣는다
  const html = readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const staticPre = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
  for (const h of staticPre) assert.ok(!/three|scene\.js|camera\.js|flowview\/(flow-view|chips|beams|backdrop|bubbles)\.js|holo\.js|flow\.js|ground\.js|weather\.js|islands\.js/.test(h), h);
  assert.match(html, /ccviz\.dim/);
  assert.match(html, /d === '2d'/);
});

test('공통 순수 모듈로 옮긴 것: escapeHtml·PurgeBook·섬 이름표(3D 결과 같음)', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(MAX_REGIONS, 6);
  const b = new PurgeBook();
  b.start('k', 0.8, 1000);
  assert.ok(b.get('k', 1100).oldL === 0.8);
  assert.equal(b.get('k', 1000 + 1e6), null);
  const html = islandLabelHtml({ projectId: 'p', name: 'Projects\\2026', busy: true, live: true, mains: [1, 2] });
  assert.match(html, /ov-dot busy/); assert.match(html, /세션 2/);
  // 2D 전용 CSS: 배경 흐림 끔은 data-dim="2d" 일 때만
  const css = readFileSync(path.join(WEB, 'flat/flat.css'), 'utf8');
  assert.match(css, /html\[data-dim="2d"\] \* \{ backdrop-filter: none/);
});
