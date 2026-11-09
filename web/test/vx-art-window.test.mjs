// 복셀: 작업 대상 층 ↔ 창 풍경 · 창 흐림 없앰 · 계획판 높이 · 기동기 이름표와 대시보드 — 순수 함수 + 소스 확인
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAN_UI, boardWorld } from '../plan-core.mjs';
import { VX_DASH, launcherDash } from '../voxel/office-core.mjs';
import { VXA } from '../voxel/vx-art-core.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('작업 대상 층이 켜지면 창 풍경 판 없음(3D·2D), 정적 묶음은 켬/끔에 바로 다시 그림', () => {
  const props = src('../voxel/props.js');
  assert.match(props, /art = false \} = \{\}\) \{/, 'buildRoomStatic 에 art 옵션');
  assert.match(props, /const skyOn = ww && !art && wallHigh\(xf, ww, cam\);/, '층이 켜지면 사분면과 무관하게 풍경 없음(유리)');
  const off = src('../voxel/office.js');
  assert.match(off, /cam: this\._camQ, art: !!this\.vArt \}\)/, '정적 그리기에 층 상태');
  assert.match(off, /\(this\.vArt \? 'A' : ''\) \+ '\|q'/, '정적 서명에 층 켬/끔');
  assert.match(off, /this\.vArt = null; \}\n\s+this\.staticSig = '';/, '켬/끔 즉시 다시 그림');
  const v2 = src('../flat/voxel2d.js');
  assert.match(v2, /if \(ww && !this\.vArt\) \{/, '2D 창 하늘 띠도 층이 켜지면 없음');
  assert.match(v2, /this\._artStatic = !!this\.vArt; this\._staticVer/, '2D 정적 층 다시 그림');
});

test('컨텍스트 창 흐림(젖빛 유리) 없앰 — 서류 더미만 남음(3D·2D)', () => {
  const props = src('../voxel/props.js');
  assert.doesNotMatch(props, /SKY_BY_ID|room\._sky|fogGlass\)\.lerp|pal\.skyMid\)\.lerp/, '창 흐림 상자·하늘 범위 기억 없음');
  assert.match(props, /export function drawCtxWear/, '서류 더미는 그대로');
  const v2 = src('../flat/voxel2d.js');
  assert.doesNotMatch(v2, /pal\.fogGlass : pal\.window/, '2D 창 흐림 없음');
});

test('계획판(복셀 3D) 아래 변은 기동기 대시보드·설비 위 — 바닥에 묻히지 않음', () => {
  const vx = boardWorld(2, 'voxel');
  assert.equal(vx.bottom, PLAN_UI.VX_BOTTOM);
  assert.equal(boardWorld(2).bottom, null, '흐름·Planet 은 그대로');
  const dash = launcherDash({ x: 0, z: 0 }, 0.75);
  assert.ok(PLAN_UI.VX_BOTTOM > dash.top, '대시보드 위 끝보다 높게');
  assert.ok(PLAN_UI.VX_BOTTOM > 2.2 + 0.1 && PLAN_UI.VX_BOTTOM >= VXA.BAY_H, '높은 벽(2.2)·서가(2.45)보다 낮지 않게');
  assert.ok(PLAN_UI.VX_BOTTOM > dash.label.y + 0.6, '§153 판이 기동기 바로 위라 대시보드 위 이름표(label.y ～ 몇 줄)보다도 위');
  const ui = src('../plan-ui.js');
  assert.match(ui, /if \(wb\.bottom != null && w\.y < wb\.bottom\) w\.y = wb\.bottom;/);
});

test('기동기 이름표는 대시보드 위 — 판 글이 읽히는 동안 회차 요약은 판에만', () => {
  const d = launcherDash({ x: 4, z: -2 }, 0.75);
  assert.ok(Math.abs(d.top - (d.y + VX_DASH.H / 2)) < 1e-9);
  assert.ok(d.label.y > d.top, '이름표가 판과 겹치지 않음');
  assert.equal(d.label.x, d.x); assert.equal(d.label.z, d.z);
  const holo = src('../voxel/vx-holo.js');
  assert.match(holo, /launcherDash\(m\.pos, BATCH\.DEVICE_K\)/, '대시보드도 같은 자리 함수');
  assert.match(holo, /for \(const \[mid, de\] of this\._dash\) if \(de\._txf === tf\) dr\.add\(mid\);/);
  const off = src('../voxel/office.js');
  assert.match(off, /this\.holo\.dashRead\.has\(m\.id\) \? '' : `<small class="ndev">/, '읽히면 요약 뺌, 멀면 요약');
});
