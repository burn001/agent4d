// node --test "web/test/sound-gate.test.mjs"   소리 '대기' 상태 머신: 자동재생 거부·컨텍스트 정지 판정과 복원 계획
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundStatus, restorePlan, soundLabel, WAIT_HINT, GESTURE_EVENTS } from '../sound-gate.mjs';

const base = { on: true, held: false, musicAvailable: true, musicOn: true, musicBlocked: false, musicLoading: false,
  sfxCapable: true, sfxEnabled: true, sfxState: 'running', routeState: 'none' };

test('상태: 꺼짐·정지·대기(음악 거부·효과음 미시작·suspended·interrupted·필터 정지)·불러오는 중·켜짐', () => {
  assert.equal(soundStatus({ ...base, on: false, musicBlocked: true }), 'off');
  assert.equal(soundStatus({ ...base, held: true, musicBlocked: true }), 'held');
  assert.equal(soundStatus(base), 'on');
  assert.equal(soundStatus({ ...base, musicBlocked: true }), 'waiting');
  assert.equal(soundStatus({ ...base, sfxEnabled: false, sfxState: 'none' }), 'waiting', '첫 동작 전 효과음');
  assert.equal(soundStatus({ ...base, sfxState: 'suspended' }), 'waiting');
  assert.equal(soundStatus({ ...base, sfxState: 'interrupted' }), 'waiting');
  assert.equal(soundStatus({ ...base, routeState: 'suspended' }), 'waiting', '음악이 이어진 필터 컨텍스트');
  assert.equal(soundStatus({ ...base, musicLoading: true }), 'loading');
  assert.equal(soundStatus({ ...base, musicAvailable: false, musicBlocked: true }), 'on', '음악 파일 없으면 음악 거부는 무관');
  assert.equal(soundStatus({ ...base, sfxCapable: false, sfxEnabled: false }), 'on', 'AudioContext 없는 브라우저');
  assert.equal(soundStatus(null), 'off');
});

test('복원 계획: 효과음 컨텍스트는 사용자 동작(활성화) 뒤에만, 음악은 동작 전에도 시도, 꺼짐·정지면 아무것도', () => {
  const pre = { ...base, activated: false, musicOn: false, sfxEnabled: false, sfxState: 'none' };
  assert.deepEqual(restorePlan(pre), { sfx: null, music: 'start', route: null });
  assert.deepEqual(restorePlan({ ...pre, activated: true }), { sfx: 'enable', music: 'start', route: null });
  assert.deepEqual(restorePlan({ ...pre, on: false, activated: true }), { sfx: null, music: null, route: null });
  assert.deepEqual(restorePlan({ ...pre, held: true, activated: true }), { sfx: null, music: null, route: null });
  // 켜져 있는데 멈춤(탭 복귀·interrupted)
  const run = { ...base, activated: true };
  assert.deepEqual(restorePlan({ ...run, sfxState: 'interrupted', audioPaused: true }), { sfx: 'resume', music: 'play', route: null });
  assert.deepEqual(restorePlan({ ...run, musicPaused: true, audioPaused: true }), { sfx: null, music: null, route: null }, '시각화 정지로 멈춘 음악은 그대로');
  assert.deepEqual(restorePlan({ ...run, routeState: 'suspended' }), { sfx: null, music: null, route: 'resume' });
  assert.deepEqual(restorePlan({ ...run, routeState: 'suspended', activated: false }).route, null);
  assert.deepEqual(restorePlan(run), { sfx: null, music: null, route: null }, '다 돌고 있으면 할 일 없음');
});

test('문구: 대기는 "소리 대기" + 툴팁 안내, 이벤트는 터치 활성화(pointerup·touchend)까지', () => {
  const w = soundLabel('waiting');
  assert.equal(w.text, '소리 대기');
  assert.ok(w.title.startsWith(WAIT_HINT));
  assert.match(w.aria, /켜짐 — 대기/);
  assert.equal(soundLabel('on').text, '소리 켜짐');
  assert.equal(soundLabel('off').aria, '소리(음악·효과음) 꺼짐');
  assert.match(soundLabel('on', { noMusic: true }).title, /효과음만/);
  for (const t of ['pointerdown', 'keydown', 'touchstart', 'pointerup', 'touchend']) assert.ok(GESTURE_EVENTS.includes(t));
});
