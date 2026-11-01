// 메인 에이전트 1인칭 시점(POV): 눈 자리·시선·고개 한계·자동 주시(최소 머묾·히스테리시스)·둘러보기·대상 고르기·이름 찾기·ctl 파싱
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POV, povEye, camFromHead, aimAngles, clampHead, lookDir, angDiff, pickPovMain, resolvePovTarget, GazePicker, LookOffset, gazeGoal, gazeScore, turnStep, povChipText, damp } from '../pov-core.mjs';
import { parseCtl, normalizeCmd, applyControl } from '../control-core.mjs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const D = Math.PI / 180;

test('눈 자리: 머리 높이 + 위, 몸 앞으로 EYE_FWD, 카메라는 시선 반대쪽으로 EYE_BACK(고개 축 둘레)', () => {
  const e = povEye({ pos: { x: 2, z: 3 }, yaw: Math.PI / 2, headY: 1.55 });
  assert.ok(near(e.x, 2 + POV.EYE_FWD) && near(e.z, 3, 1e-12) && near(e.y, 1.55 + POV.EYE_UP));
  const c = camFromHead(e, Math.PI / 2, 0.6);
  assert.ok(near(c.x, e.x - 0.6) && near(c.z, e.z, 1e-12) && c.y === e.y, '+x 를 보면 카메라는 −x 쪽');
  const c2 = camFromHead(e, 0, 0.6);
  assert.ok(near(c2.z, e.z - 0.6), '고개를 돌리면 축 둘레로 돎');
  assert.ok(POV.FOV > 50 && POV.NEAR < 0.2, '사무실 안이라 넓은 화각·가까운 near(복셀 기본 30°·0.5 보다)');
});

test('시선 각·방향: atan2(dx, dz) 규약(character-core 와 같음)·아래는 음수', () => {
  const a = aimAngles({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0.6, z: 1 });
  assert.ok(near(a.yaw, 0) && near(a.pitch, -Math.PI / 4));
  const d = lookDir(Math.PI / 2, 0);
  assert.ok(near(d.x, 1) && near(d.z, 0, 1e-12) && near(d.y, 0));
});

test('고개 한계: 몸 방향에서 limit 까지만(등 뒤 대상은 옆까지만), 안쪽은 그대로', () => {
  assert.ok(near(clampHead(0, 30 * D, 75 * D), 30 * D));
  assert.ok(near(clampHead(0, 170 * D, 75 * D), 75 * D));
  assert.ok(near(clampHead(0, -170 * D, 75 * D), -75 * D));
  assert.ok(near(angDiff(clampHead(Math.PI, 0, 75 * D), Math.PI), -75 * D) || near(angDiff(clampHead(Math.PI, 0, 75 * D), Math.PI), 75 * D), '±π 넘김');
  const eye = { x: 0, y: 1.6, z: 0 };
  const g = gazeGoal(0, eye, { x: 0, y: 1.6, z: -5 }, null, POV);
  assert.ok(Math.abs(g.yaw) <= POV.HEAD_LIMIT + 1e-9, '바로 뒤 → 한계');
  const gd = gazeGoal(0, eye, { x: 5, y: 1.6, z: 0.01 }, null, POV, POV.DESK_LIMIT);
  assert.ok(near(gd.yaw, POV.DESK_LIMIT), '책상(모니터 열림)에서는 DESK_LIMIT 까지만');
  const g0 = gazeGoal(0.3, eye, null, null, POV);
  assert.ok(near(g0.yaw, 0.3) && near(g0.pitch, POV.PITCH_REST), '대상 없음 = 몸 앞, 살짝 아래');
  const gl = gazeGoal(0, eye, null, { yaw: 1.5, pitch: 0.2 }, POV);
  assert.ok(near(gl.yaw, 1.5), '둘러보기는 고개 한계 밖으로도');
});

test('주시 점수: 자기 모니터는 SELF_K, 등 뒤는 BACK_K, 먼 것·쉬는 것은 0', () => {
  assert.equal(gazeScore(0, {}), 0);
  assert.equal(gazeScore(4, { dist: POV.GAZE_RANGE + 1 }), 0);
  assert.equal(gazeScore(4, { self: true }), 4 * POV.SELF_K);
  assert.equal(gazeScore(4, { rel: 0, dist: 3 }), 4);
  assert.equal(gazeScore(4, { rel: 2.5, dist: 3 }), 4 * POV.BACK_K);
});

test('자동 주시: 최소 머묾 동안 붙잡고, 지나면 점수가 HYST 배 넘을 때만 바꿈 · 쉬면 잠깐 뒤 넘어감 · 없으면 앞(null)', () => {
  const g = new GazePicker();
  assert.equal(g.step([], 0), null);
  assert.equal(g.step([{ id: 'a', s: 3 }, { id: 'b', s: 2 }], 0), 'a');
  assert.equal(g.step([{ id: 'a', s: 1 }, { id: 'b', s: 9 }], 1), 'a', '머묾 안 — 더 높은 점수가 와도 그대로');
  assert.equal(g.step([{ id: 'a', s: 3 }, { id: 'b', s: 4 }], POV.GAZE_DWELL + 0.1), 'a', '머묾 지나도 HYST 배 안 넘으면 그대로');
  assert.equal(g.step([{ id: 'a', s: 3 }, { id: 'b', s: 5 }], POV.GAZE_DWELL + 0.2), 'b', 'HYST 배 넘으면 바꿈');
  const t1 = POV.GAZE_DWELL + 0.2;
  assert.equal(g.step([{ id: 'a', s: 3 }], t1 + 0.3), 'b', 'b 가 쉬어도 GAZE_LOST 동안은 계속 봄');
  assert.equal(g.step([{ id: 'a', s: 3 }], t1 + 0.3 + POV.GAZE_LOST + 0.01), 'a', '머묾 안이어도 쉬면 넘어감');
  const h = new GazePicker();
  h.step([{ id: 'x', s: 1 }], 0);
  assert.equal(h.step([], 0.1), 'x');
  assert.equal(h.step([], 0.1 + POV.GAZE_LOST + 0.01), null, '아무도 일하지 않으면 앞·자기 모니터로');
  // 30초 동안 점수가 매 프레임 흔들려도 바꾸는 횟수는 머묾으로 묶임
  const k = new GazePicker();
  for (let t = 0; t < 30; t += 0.05) k.step([{ id: 'p', s: 2 + Math.sin(t * 7) * 1.5 }, { id: 'q', s: 2 + Math.cos(t * 5) * 1.5 }], t);
  assert.ok(k.switches <= Math.ceil(30 / POV.GAZE_DWELL) + 1, `전환 ${k.switches}`);
});

test('둘러보기: 끄는 동안·놓은 뒤 LOOK_RESUME 초는 자동 주시를 쉬고, LOOK_HOLD 뒤 0 으로 돌아옴', () => {
  const l = new LookOffset();
  l.start(); l.move(-100, 20);
  assert.ok(l.yaw > 0 && l.pitch < 0 && l.paused(0));
  l.move(-1e6, 0); assert.ok(near(l.yaw, POV.LOOK_YAW), '한계');
  l.end(10);
  assert.ok(l.paused(10 + POV.LOOK_RESUME - 0.01) && !l.paused(10 + POV.LOOK_RESUME + 0.01));
  l.step(0.1, 10 + POV.LOOK_HOLD - 0.05); assert.ok(near(l.yaw, POV.LOOK_YAW), 'HOLD 동안 머묾');
  for (let t = 10 + POV.LOOK_HOLD; t < 20; t += 0.05) l.step(0.05, t);
  assert.equal(l.yaw, 0); assert.equal(l.pitch, 0);
});

test('고개 돌리기: 각속도 상한(멀미 방지)·넘어가지 않음·가속 완화', () => {
  let s = { v: 0, vel: 0 }, maxW = 0;
  for (let i = 0; i < 600; i++) { const p = s.v; s = turnStep(s.v, Math.PI * 0.9, s.vel, 1 / 60, { rate: POV.YAW_RATE, max: POV.YAW_MAX }); maxW = Math.max(maxW, Math.abs(angDiff(p, s.v)) * 60); }
  assert.ok(maxW <= POV.YAW_MAX * D + 1e-9, `최대 ${(maxW / D).toFixed(1)}°/초`);
  assert.ok(Math.abs(angDiff(s.v, Math.PI * 0.9)) < 0.02, '도착');
  const first = turnStep(0, 1, 0, 1 / 60, { rate: POV.YAW_RATE, max: POV.YAW_MAX });
  assert.ok(Math.abs(first.vel) < POV.YAW_MAX * D * 0.2, '첫 프레임은 천천히(가속 완화)');
  const nf = turnStep(0, 0.001, 50, 1 / 60, { rate: 2, max: 1000 });
  assert.ok(near(nf.v, 0.001), '넘어가지 않음');
  assert.ok(damp(2, 0) === 0 && damp(2, 1e9) === 1);
});

test('POV 대상 고르기: 지정 > 포커스 노드의 루트 메인 > 가장 활발 > id 순', () => {
  const ms = [{ id: 's:b', s: 1, root: 'b' }, { id: 's:a', s: 5, root: 'a' }, { id: 's:c', s: 5, root: 'c' }];
  assert.equal(pickPovMain(ms, null), 's:a', '동률은 id 순');
  assert.equal(pickPovMain(ms, 'b'), 's:b');
  assert.equal(pickPovMain(ms, 'zz'), 's:a');
  assert.equal(pickPovMain(ms, 'b', 's:c'), 's:c');
  assert.equal(pickPovMain([], null), null);
});

test('이름으로 메인 찾기(ctl camera pov <대상>): id·세션 앞부분·라벨·프로젝트, 모호하면 후보', () => {
  const ms = [
    { id: 's:aaaa1111', label: '알파: 화면 개편', sessionId: 'aaaa1111', project: 'alpha' },
    { id: 's:aaaa2222', label: '알파: 문서 갱신', sessionId: 'aaaa2222', project: 'alpha' },
    { id: 's:bbbb3333', label: '베타', sessionId: 'bbbb3333', project: 'beta' },
  ];
  assert.deepEqual(resolvePovTarget(ms, ''), { ok: true, id: null }, '비우면 화면이 고름');
  assert.equal(resolvePovTarget(ms, 'aaaa2222').id, 's:aaaa2222');
  assert.equal(resolvePovTarget(ms, 'bbbb').id, 's:bbbb3333', '세션 앞부분 4자');
  assert.equal(resolvePovTarget(ms, '화면 개편').id, 's:aaaa1111');
  assert.equal(resolvePovTarget(ms, 'BETA').id, 's:bbbb3333', '라벨 대소문자 무시');
  const amb = resolvePovTarget(ms, '알파');
  assert.equal(amb.ok, false); assert.equal(amb.error, 'ambiguous'); assert.equal(amb.candidates.length, 2);
  assert.match(amb.candidates[0], /알파: 화면 개편 @alpha \(aaaa1111\)/);
  assert.equal(resolvePovTarget(ms, 'alpha').error, 'ambiguous', '프로젝트 이름도 모호');
  const nf = resolvePovTarget(ms, 'zzz');
  assert.equal(nf.error, 'not_found'); assert.equal(nf.candidates.length, 3);
});

test('칩 글: POV · 메인 → 보는 대상(길면 줄임)', () => {
  assert.equal(povChipText('메인', null), 'POV · 메인');
  assert.equal(povChipText('메인', '직원 3'), 'POV · 메인 → 직원 3');
  assert.match(povChipText('아주 긴 이름의 메인 에이전트 세션', 'x', 10), /^POV · 아주 긴 이름의 …/);
});

test('ctl camera pov 파싱: 대상(who)·--switch, 별칭, 다른 값은 예전 그대로(서버 resolve 의 target 과 겹치지 않음)', () => {
  assert.deepEqual(parseCtl(['camera', 'pov']), { ok: true, cmd: 'camera', args: { value: 'pov', who: null, switch: false } });
  assert.deepEqual(parseCtl(['camera', 'pov', 'Works', '2026'], { switch: true }), { ok: true, cmd: 'camera', args: { value: 'pov', who: 'Works 2026', switch: true } });
  assert.deepEqual(parseCtl(['camera', 'fpv']).args.value, 'pov');
  assert.deepEqual(parseCtl(['camera', 'auto']), { ok: true, cmd: 'camera', args: { value: 'auto' } });
  assert.deepEqual(parseCtl(['camera', 'follow', 'x']), { ok: true, cmd: 'camera', args: { value: 'follow' } });
  assert.equal(parseCtl(['camera', 'nope']).ok, false);
  // 서버가 다시 정규화해도 같음, 제어 문자·길이 정리
  const n = normalizeCmd('camera', { value: 'POV', who: 'a\u0001b'.padEnd(200, 'x'), switch: true });
  assert.equal(n.args.value, 'pov'); assert.equal(n.args.who.length, 80); assert.ok(!/\u0001/.test(n.args.who)); assert.equal(n.args.target, undefined);
});

test('ctl camera pov 디스패치: hook 이 who·switch 를 받고 실패(not_voxel·ambiguous)를 그대로 돌려줌', async () => {
  let got = null;
  const ok = await applyControl({ cmd: 'camera', args: { value: 'pov', who: 'alpha', switch: true } }, { camera: (a) => { got = a; return { detail: 'POV · x' }; } });
  assert.deepEqual(got, { value: 'pov', who: 'alpha', switch: true });
  assert.equal(ok.ok, true);
  const nv = await applyControl({ cmd: 'camera', args: { value: 'pov' } }, { camera: () => ({ ok: false, error: 'not_voxel' }) });
  assert.deepEqual(nv, { ok: false, error: 'not_voxel' });
});

test('연결(소스): 카메라 위임·몸 숨김·⚙ 줄·카드 버튼·?cam=pov·Esc·i18n', () => {
  const cam = src('../camera.js');
  assert.match(cam, /if \(this\.pov && this\.pov\.active\) \{/);
  assert.match(cam, /this\.pov\.update\(dt, now, this\) === 'lost'/);
  const off = src('../voxel/office.js');
  assert.match(off, /if \(ch\.id === this\.povId\) continue; \/\/ §72\.14 1인칭: 자기 몸/);
  assert.match(off, /if \(id === this\.povId\) return null;/);
  assert.match(src('../settings-menu.js'), /\$\('btn-follow-prompt'\), \$\('btn-pov'\)\]/);
  const ins = src('../inspector.js');
  assert.match(ins, /data-act="pov"/); assert.match(ins, /case 'pov':/);
  const app = src('../app.js');
  assert.match(app, /camQ === 'pov'/); assert.match(app, /canPov: \(n\) => n\.kind === 'main' && !n\.parentId/);
  assert.match(app, /error: 'not_voxel'/);
  const ui = src('../pov-ui.js');
  assert.match(ui, /e\.key !== 'Escape' \|\| !pov\.active/);
  assert.match(ui, /id = 'btn-pov-eye'|eye\.id = 'btn-pov-eye'/);
  const pv = src('../pov.js');
  assert.doesNotMatch(pv, /from 'three'/, '2D 화면에서도 불러오므로 three 를 직접 가져오지 않음');
});
