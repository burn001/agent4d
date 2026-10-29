// node --test "web/test/plinks.test.mjs"   Planet 관계선: 모드 설정·URL·저장, 전환 시계(미룸·페이드), 상태 박자, 2D·3D 같은 모드
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLINKS, normPlinks, initialPlinks, plinksPref, setPlinksPref, onPlinks, turnOf, PlinksClock, plinksClock, plinksMix,
  stateKey, stepState, laserLook, orbitLook, endGaps, circleMeet } from '../plinks-core.mjs';
import { normalizeCmd, parseCtl, CTL_COMMANDS } from '../control-core.mjs';
import { MESSAGES } from '../i18n.mjs';

const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const store = (o = {}) => ({ d: { ...o }, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = String(v); } });

test('모드 이름: 셋 + 별칭, 그 밖은 null', () => {
  assert.deepEqual(PLINKS.MODES, ['rotate', 'laser', 'orbit']);
  for (const [v, w] of [['rotate', 'rotate'], ['AUTO', 'rotate'], ['alternate', 'rotate'], ['beam', 'laser'], [' Laser ', 'laser'], ['rings', 'orbit'], ['reso', 'orbit'], ['x', null], [null, null]]) assert.equal(normPlinks(v), w, String(v));
});

test('처음 값: URL(이번 접속만) → 저장값 → 번갈아', () => {
  assert.deepEqual(initialPlinks('?plinks=orbit', store({ [PLINKS.KEY]: 'laser' })), { pref: 'orbit', fromUrl: true });
  assert.deepEqual(initialPlinks('?view=planet', store({ [PLINKS.KEY]: 'laser' })), { pref: 'laser', fromUrl: false });
  assert.deepEqual(initialPlinks('?plinks=zzz', store({ [PLINKS.KEY]: 'bogus' })), { pref: 'rotate', fromUrl: false });
  assert.deepEqual(initialPlinks('', null), { pref: 'rotate', fromUrl: false });
  const bad = { getItem() { throw new Error('blocked'); } };
  assert.equal(initialPlinks('', bad).pref, 'rotate'); // 저장소가 막혀도
});

test('설정 바꾸기: 저장(persist)·구독·잘못된 값 거절', () => {
  const ls = store();
  globalThis.localStorage = ls;
  try {
    const seen = [];
    const off = onPlinks((p) => seen.push(p));
    assert.equal(setPlinksPref('nope'), false);
    assert.equal(setPlinksPref('laser'), true);
    assert.equal(plinksPref(), 'laser'); assert.equal(ls.d[PLINKS.KEY], 'laser');
    assert.equal(setPlinksPref('ring', { persist: false }), true); // ctl --temp: 이번 접속만
    assert.equal(plinksPref(), 'orbit'); assert.equal(ls.d[PLINKS.KEY], 'laser');
    setPlinksPref('rotate');
    off();
    setPlinksPref('laser');
    assert.deepEqual(seen, ['laser', 'orbit', 'rotate']);
    setPlinksPref('rotate');
  } finally { delete globalThis.localStorage; }
});

test('번갈아 차례: 벽시계 PERIOD 마다 레이저 ⇄ 궤도', () => {
  const P = PLINKS.PERIOD;
  assert.equal(turnOf(0), 'laser'); assert.equal(turnOf(P - 0.01), 'laser'); assert.equal(turnOf(P), 'orbit'); assert.equal(turnOf(2 * P + 1), 'laser');
  assert.ok(P >= 60 && P <= 120 && PLINKS.FADE >= 1.5 && PLINKS.FADE <= 2);
});

test('전환 시계: 조용하면 바로 크로스페이드, 패킷 비행 중이면 끝날 때까지 미룸', () => {
  const c = new PlinksClock({ period: 90, fade: 2, maxDefer: 30 });
  let r = c.step(10, { pref: 'rotate' });
  assert.deepEqual(r, { mode: 'laser', w: 0, fading: false });
  // 차례가 바뀌었지만 패킷이 날고 있음 → 미룸
  r = c.step(90.5, { pref: 'rotate', busy: true });
  assert.equal(r.mode, 'laser'); assert.equal(r.w, 0); assert.ok(c.deferred > 0);
  r = c.step(95, { pref: 'rotate', busy: true });
  assert.equal(r.mode, 'laser');
  // 패킷이 다 내렸다 → 그때부터 페이드
  r = c.step(96, { pref: 'rotate', busy: false });
  assert.equal(r.mode, 'orbit'); assert.ok(r.fading); assert.equal(r.w, 0);
  r = c.step(97, { pref: 'rotate' }); assert.ok(r.w > 0.3 && r.w < 0.7, String(r.w));
  r = c.step(98.1, { pref: 'rotate' }); assert.deepEqual(r, { mode: 'orbit', w: 1, fading: false });
});

test('전환 시계: 패킷이 끊이지 않아도 MAX_DEFER 뒤엔 바꾼다', () => {
  const c = new PlinksClock({ period: 90, fade: 2, maxDefer: 30 });
  c.step(5, { pref: 'rotate' });
  assert.equal(c.step(91, { pref: 'rotate', busy: true }).mode, 'laser');
  assert.equal(c.step(120, { pref: 'rotate', busy: true }).mode, 'laser');
  assert.equal(c.step(121.5, { pref: 'rotate', busy: true }).mode, 'orbit');
});

test('전환 시계: 고른 모드는 차례와 무관·미룸 없이 페이드, 움직임 줄이기면 즉시', () => {
  const c = new PlinksClock({ period: 90, fade: 2 });
  assert.equal(c.step(10, { pref: 'orbit' }).w, 1); // 처음은 페이드 없이 그 모드
  let r = c.step(11, { pref: 'laser', busy: true });
  assert.equal(r.mode, 'laser'); assert.ok(r.fading); assert.equal(r.w, 1);
  r = c.step(14, { pref: 'laser' }); assert.deepEqual(r, { mode: 'laser', w: 0, fading: false });
  r = c.step(15, { pref: 'orbit', reduced: true }); assert.deepEqual(r, { mode: 'orbit', w: 1, fading: false });
  // 번갈아 + 움직임 줄이기: 차례가 오면 페이드 없이 바로
  const d = new PlinksClock({ period: 90, fade: 2 });
  d.step(1, { pref: 'rotate', reduced: true });
  assert.deepEqual(d.step(90.2, { pref: 'rotate', reduced: true }), { mode: 'orbit', w: 1, fading: false });
});

test('2D·3D 같은 모드: 두 렌더러가 같은 단일 시계(plinksMix)를 읽는다', () => {
  const a = plinksMix(false, false), b = plinksMix(false, false);
  assert.equal(a.mode, b.mode); assert.equal(a.mode, plinksClock.cur);
  const s3 = src('planet-links.js'), s2 = src('flat/planet2d.js'), l2 = src('flat/planet-links2d.js');
  assert.match(s3, /import \{[^}]*plinksMix[^}]*\} from '\.\/plinks-core\.mjs'/);
  assert.match(s3, /plinksMix\(busy, view\.reduced\)/);
  assert.match(s2, /import \{ plinksMix \} from '\.\.\/plinks-core\.mjs'/);
  assert.match(s2, /plinksMix\(this\.pool\.active\.length > 0, this\.reduced\)/); // 2D 도 패킷 비행 중이면 미룸
  assert.match(l2, /laserLook\(/); assert.match(l2, /orbitLook\(/); // 같은 박자 함수
  // 3D Planet 은 예전 직선·점·점선 버퍼를 감추고 패킷 길도 같은 끝(궤도계 바깥)
  const pv = src('planet-view.js');
  assert.match(pv, /new PlanetLinks\(this\.scene, this\)/);
  assert.match(pv, /this\.linkLines, this\.dots, this\.dashLines, this\.spawnLines/);
  assert.match(src('flow.js'), /lp\(pt, a, b, e, s\.arc, fv, tv\)/);
});

test('상태 박자: 레이저 펄스(작업 중 촘촘·대기 핑·완료 안내선·오류 깜빡·중지 고정)', () => {
  const S = (k) => stepState(null, k, 0);
  assert.equal(stateKey('active'), 'act'); assert.equal(stateKey('idle'), 'wait'); assert.equal(stateKey('error', true), 'done'); assert.equal(stateKey('stopped'), 'stop');
  const act = laserLook(S('act'), 10, 1), wait = laserLook(S('wait'), 10, 1), done = laserLook(S('done'), 10, 1), stop = laserLook(S('stop'), 10, 1);
  assert.ok(act.rep > wait.rep * 3, 'act 촘촘');
  assert.equal(wait.rep, 1); // 대기: 빔 하나에 펄스 하나
  assert.ok(laserLook(S('wait'), 10, 3).ph - wait.ph === 1, '대기 2초에 한 번 지나감(0.5 경로/초)');
  assert.ok(done.p < 0.1 && done.guide > 0.2 && done.a < 0.1, '완료 = 빔 꺼지고 안내선');
  assert.equal(stop.p, 0); assert.ok(stop.a > 0.3, '중지 = 회색 고정 빔');
  const flicks = new Set(); for (let t = 0; t < 2; t += 0.013) flicks.add(laserLook(S('err'), 10, t, 0.3).flick);
  assert.ok(flicks.size === 2, '오류 = 끊김');
  assert.equal(laserLook(S('act'), 10, 1, 0, true).p, 0); // 움직임 줄이기: 펄스 없음
});

test('상태 박자: 궤도 호(작업 중 빠른 흐름·완료 점선·중지 흐름 없음) · 섞임은 부드럽게', () => {
  const S = (k) => stepState(null, k, 0);
  const act = orbitLook(S('act'), 2), wait = orbitLook(S('wait'), 2);
  assert.ok(orbitLook(S('act'), 3).ph - act.ph > (orbitLook(S('wait'), 3).ph - wait.ph) * 3);
  assert.ok(orbitLook(S('done'), 2).dash > 0 && act.dash === 0);
  assert.equal(orbitLook(S('stop'), 2).p, 0);
  const m = stepState(null, 'act', 0); stepState(m, 'done', 0.2);
  assert.ok(m.act > 0.3 && m.act < 0.8 && m.done > 0.2);
});

test('끝 간격·충돌 점', () => {
  assert.deepEqual(endGaps(10, 2, 3), [2, 3]);
  const [a, b] = endGaps(4, 3, 3); assert.ok(Math.abs(a + b - 3.2) < 1e-9 && a === b);
  const p = circleMeet(0, 0, 10, 0, 6.2);
  assert.ok(Math.abs(Math.hypot(p.x, p.z) - 6.2) < 1e-9 && Math.abs(Math.hypot(p.x - 10, p.z) - 6.2) < 1e-9);
  const q = circleMeet(0, 0, 10, 0, 2); assert.deepEqual([q.x, q.z], [5, 0]); // 안 만나면 가운데
});

test('ctl plinks: 표·별칭·CLI 인자', () => {
  assert.ok(CTL_COMMANDS.plinks.usage.startsWith('plinks'));
  assert.deepEqual(normalizeCmd('plinks', { value: 'Laser' }), { ok: true, cmd: 'plinks', args: { value: 'laser' } });
  assert.equal(normalizeCmd('plinks', { value: 'ring' }).args.value, 'orbit');
  assert.equal(normalizeCmd('plinks', { value: 'alternate' }).args.value, 'rotate');
  assert.equal(normalizeCmd('plinks', { value: 'zig' }).error, 'bad_value');
  assert.equal(parseCtl(['links', 'orbit']).cmd, 'plinks');
  const app = src('app.js');
  assert.match(app, /plinks: \(\{ value \}\) => \{ setPlinksPref\(value\)/);
  assert.match(app, /plinks: plinksPref\(\)/);
});

test('문구(en·ko): ⚙ 줄·범례', () => {
  for (const L of ['en', 'ko']) for (const k of ['row', 'title', 'rotate', 'laser', 'orbit', 'lg.h', 'lg.laser', 'lg.laser.d', 'lg.laserCp', 'lg.orbit', 'lg.orbitCp', 'lg.now', 'lg.rot', 'lg.fixed']) assert.ok(MESSAGES[L]['scene.plinks.' + k], L + ' ' + k);
  assert.ok(!/[~～]/.test(MESSAGES.ko['scene.plinks.title']));
});
