// node --test "web/test/sound.test.mjs"   소리 토글 하나(배경음악·효과음 함께): 저장·이행·URL 일회 우선·첫 사용자 동작 처리
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sound, loadSoundOn, urlSoundOverride, KEY, PARTS_KEY } from '../sound.mjs';

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
const j = (o) => JSON.stringify(o);

function fakes({ available = true } = {}) {
  const log = [];
  const music = { available, loading: false, on: false, wantOn: false, _probed: true,
    block: false, ret: undefined, // block: 자동재생 거부(NotAllowedError) 흉내 · ret: start() 가 돌려줄 Promise 값
    start() {
      log.push('music.start');
      if (this.block) { this.on = false; this.lastError = 'NotAllowedError'; return Promise.resolve(false); }
      this.on = true; return this.ret === undefined ? undefined : Promise.resolve(this.ret);
    },
    stop() { this.on = false; log.push('music.stop'); } };
  const sfx = { _AudioCtx: function () {}, enabled: false, volume: 0.5, ctx: null,
    setEnabled(on) { this.enabled = !!on; log.push('sfx.' + (on ? 'on' : 'off')); },
    setVolume(v) { this.volume = Number(v); }, play(n) { log.push('sfx.play:' + n); } };
  const attrs = {};
  const button = { textContent: '', title: '', disabled: false, _h: null,
    setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; }, addEventListener(t, f) { this._h = f; },
    contains(t) { return t === this; }, attrs };
  const listeners = new Map();
  const win = { addEventListener(t, f) { listeners.set(t, f); }, removeEventListener(t, f) { if (listeners.get(t) === f) listeners.delete(t); }, listeners };
  const docL = new Map();
  const doc = { hidden: false, addEventListener(t, f) { docL.set(t, f); }, listeners: docL };
  const nav = { userActivation: { hasBeenActive: false } };
  return { log, music, sfx, button, win, doc, nav };
}

test('이행: 새 키 없으면 예전 음악·효과음 중 하나라도 켜져 있으면 켬, 저장소 실패는 꺼짐', () => {
  assert.equal(loadSoundOn(mem()), false);
  assert.equal(loadSoundOn(mem({ 'ccviz.music': j({ on: true, volume: 0.2 }) })), true);
  assert.equal(loadSoundOn(mem({ 'ccviz.sfx': j({ on: true }) })), true);
  assert.equal(loadSoundOn(mem({ 'ccviz.music': j({ on: false }), 'ccviz.sfx': j({ on: false }) })), false);
  assert.equal(loadSoundOn(mem({ [KEY]: j({ on: false }), 'ccviz.music': j({ on: true }) })), false, '새 키가 우선');
  assert.equal(loadSoundOn(broken), false);
  assert.equal(loadSoundOn(null), false);
});

test('URL sound=1|0 해석', () => {
  assert.equal(urlSoundOverride('?sound=1'), true);
  assert.equal(urlSoundOverride('?x=1&sound=off'), false);
  assert.equal(urlSoundOverride('?sound=maybe'), null);
  assert.equal(urlSoundOverride(''), null);
});

test('버튼 하나로 음악·효과음 함께 켜고 끔, 선택은 ccviz.sound 에 저장', () => {
  const f = fakes(); const storage = mem();
  const s = new Sound({ ...f, storage, search: '' });
  assert.equal(s.on, false);
  assert.equal(f.button.attrs['aria-pressed'], 'false');
  assert.match(f.button.attrs['aria-label'], /소리\(음악·효과음\) 꺼짐/);
  f.button._h();
  assert.equal(s.on, true);
  assert.deepEqual(f.log, ['sfx.on', 'music.start', 'sfx.play:chime']);
  assert.equal(storage.getItem(KEY), j({ on: true }));
  assert.equal(f.button.textContent, '소리 켜짐');
  f.button._h();
  assert.equal(f.music.on, false); assert.equal(f.sfx.enabled, false);
  assert.equal(storage.getItem(KEY), j({ on: false }));
  // 다시 만들면(새로고침) 저장값 유지
  const g = fakes();
  storage.setItem(KEY, j({ on: true }));
  const s2 = new Sound({ ...g, storage, search: '' });
  assert.equal(s2.on, true);
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const ctxFake = (state = 'suspended') => {
  const c = { state, resumed: 0, _h: null, addEventListener(t, f) { if (t === 'statechange') this._h = f; },
    resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); } };
  return c;
};
// 실제 Sfx 처럼 setEnabled 때 컨텍스트를 만든다(새 컨텍스트는 suspended — resume 으로 running)
const realSfx = (f) => { f.sfx.setEnabled = function (on) { this.enabled = !!on; if (on && !this.ctx) this.ctx = ctxFake(); f.log.push('sfx.' + (on ? 'on' : 'off')); }; };

test('저장값 켬 + 자동재생 거부: 버튼은 "소리 대기"(점멸·툴팁), 페이지 어디든 첫 동작에서 음악 play·효과음 resume 후 표시 해제', async () => {
  const f = fakes(); realSfx(f); f.music.block = true;
  const s = new Sound({ ...f, storage: mem({ [KEY]: j({ on: true }) }), search: '' });
  assert.deepEqual(f.log, ['music.start'], '로드 때 음악은 한 번 시도, 효과음 컨텍스트는 동작 전에 만들지 않음');
  await flush();
  assert.equal(s.status(), 'waiting');
  assert.equal(f.button.textContent, '소리 대기');
  assert.equal(f.button.attrs['data-sound'], 'waiting');
  assert.equal(f.button.attrs['aria-pressed'], 'true', '선택은 켜짐 그대로');
  assert.match(f.button.title, /화면을 한 번 누르면 소리가 납니다/);
  assert.match(f.button.attrs['aria-label'], /대기/);
  for (const t of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'click']) assert.ok(f.win.listeners.has(t), t);
  // 첫 동작(사용자 활성화 → 이제 재생 허용)
  f.music.block = false; f.nav.userActivation.hasBeenActive = true;
  f.win.listeners.get('pointerdown')({ target: {} });
  assert.deepEqual(f.log, ['music.start', 'sfx.on', 'music.start']);
  assert.equal(f.sfx.ctx.resumed, 1);
  await flush();
  assert.equal(s.status(), 'on');
  assert.equal(f.button.textContent, '소리 켜짐');
  assert.equal(f.win.listeners.size, 0, '복원되면 듣기 해제');
});

test('대기 중 소리 버튼: 끄지 않고 복원(버튼 위 pointerdown 은 건너뜀). 그래도 대기면 다음 클릭은 끄기', async () => {
  const f = fakes(); realSfx(f); f.music.block = true;
  const s = new Sound({ ...f, storage: mem({ [KEY]: j({ on: true }) }), search: '' });
  await flush();
  f.win.listeners.get('pointerdown')({ target: f.button });
  assert.deepEqual(f.log, ['music.start'], '버튼 위 동작은 click 이 처리');
  f.music.block = false;
  f.button._h();
  assert.equal(s.on, true);
  assert.ok(f.log.includes('sfx.on'));
  await flush();
  assert.equal(s.status(), 'on');
  // 계속 막히는 브라우저: 두 번째 클릭은 끄기
  const g = fakes(); realSfx(g); g.music.block = true;
  const s2 = new Sound({ ...g, storage: mem({ [KEY]: j({ on: true }) }), search: '' });
  await flush();
  g.button._h(); await flush();
  assert.equal(s2.status(), 'waiting');
  g.button._h();
  assert.equal(s2.on, false);
  assert.equal(g.win.listeners.size, 0);
});

test('대기 중 사용자가 끄면 이후 동작에서 재생하지 않음', async () => {
  const f = fakes(); realSfx(f); f.music.block = true;
  const s = new Sound({ ...f, storage: mem({ [KEY]: j({ on: true }) }), search: '' });
  await flush();
  s.setOn(false);
  assert.equal(f.win.listeners.size, 0);
  f.log.length = 0;
  assert.equal(s.status(), 'off');
  assert.ok(!f.log.includes('music.start'));
});

test('자동재생이 허용된 브라우저: 동작 없이 음악이 나면 효과음도 바로 켬(대기 없음)', async () => {
  const f = fakes(); realSfx(f); f.music.ret = true;
  const s = new Sound({ ...f, storage: mem({ [KEY]: j({ on: true }) }), search: '' });
  await flush(); await flush();
  assert.ok(f.log.includes('sfx.on'));
  assert.equal(s.status(), 'on');
  assert.equal(f.win.listeners.size, 0);
});

test('탭 복귀(visibilitychange): 켜져 있는데 멈춘 음악은 이어서, 멈춘 효과음 컨텍스트는 resume. interrupted 도 같은 경로', async () => {
  const f = fakes(); realSfx(f);
  f.nav.userActivation.hasBeenActive = true;
  let ensured = 0;
  Object.assign(f.music, { audio: { paused: false }, ensurePlaying() { ensured++; this.audio.paused = false; return Promise.resolve(true); } });
  const s = new Sound({ ...f, storage: mem({ [KEY]: j({ on: true }) }), search: '' });
  await flush();
  assert.equal(s.status(), 'on');
  f.music.audio.paused = true; f.sfx.ctx.state = 'suspended';
  f.doc.hidden = false; f.doc.listeners.get('visibilitychange')();
  assert.equal(ensured, 1);
  assert.equal(f.sfx.ctx.resumed, 2);
  // AudioContext 가 interrupted 로 → statechange → 복원 시도
  f.sfx.ctx.state = 'interrupted';
  f.sfx.ctx._h();
  assert.equal(f.sfx.ctx.resumed, 3);
  await flush();
  assert.equal(s.status(), 'on');
  // resume 이 안 되면(동작 필요) 대기 표시 + 듣기
  f.sfx.ctx.resume = function () { return new Promise(() => {}); };
  f.sfx.ctx.state = 'interrupted'; f.sfx.ctx._h();
  assert.equal(s.status(), 'waiting');
  assert.ok(f.win.listeners.has('keydown'));
});

test('신호 열화 필터 컨텍스트(routeCtx)가 멈추면 음악은 조용 → 대기, 동작에서 같이 resume', async () => {
  const f = fakes(); realSfx(f);
  const s = new Sound({ ...f, storage: mem({ [KEY]: j({ on: true }) }), search: '' });
  f.nav.userActivation.hasBeenActive = true;
  f.win.listeners.get('keydown')({ target: {} });
  await flush();
  f.music.routeCtx = ctxFake('suspended');
  f.music.routeCtx.resume = function () { this.resumed++; return new Promise(() => {}); };
  s.render();
  assert.equal(s.status(), 'waiting');
  f.win.listeners.get('click')({ target: {} });
  assert.equal(f.music.routeCtx.resumed, 1);
});

test('이행 값은 새 키로 한 번 저장, URL 우선은 저장하지 않음, 저장소 실패도 동작', () => {
  const storage = mem({ 'ccviz.sfx': j({ on: true, volume: 0.3 }) });
  new Sound({ ...fakes(), storage, search: '' });
  assert.equal(storage.getItem(KEY), j({ on: true }));
  const st2 = mem({ [KEY]: j({ on: true }) });
  const s = new Sound({ ...fakes(), storage: st2, search: '?sound=0' });
  assert.equal(s.on, false);
  assert.equal(st2.getItem(KEY), j({ on: true }), 'URL 값은 저장값을 덮지 않음');
  const f = fakes(); const s3 = new Sound({ ...f, storage: broken, search: '' });
  assert.equal(s3.on, false); f.button._h(); assert.equal(s3.on, true);
});

test('음악 파일 없으면 효과음만 켬(버튼은 살아 있음)', () => {
  const f = fakes({ available: false }); f.music.available = false;
  const s = new Sound({ ...f, storage: mem(), search: '' });
  assert.equal(f.button.disabled, false);
  assert.match(f.button.title, /효과음만/);
  f.button._h();
  assert.deepEqual(f.log, ['sfx.on', 'sfx.play:chime']);
  assert.equal(s.on, true);
});

test('index.html: 상단 바 소리 버튼은 하나(btn-sound), 예전 음악·효과음 버튼 없음, 볼륨 둘 유지', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/id="btn-sound"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="btn-music"|id="btn-sfx"/);
  assert.match(html, /id="vol"/); assert.match(html, /id="sfx-vol"/);
});

// 시각화 일시정지 = 소리도 잠시 멈춤
function holdFakes() {
  const f = fakes();
  Object.assign(f.music, {
    paused: false,
    pause() { if (this.on && !this.paused) { this.paused = true; f.log.push('music.pause'); } },
    resume() { if (this.paused) { this.paused = false; f.log.push('music.resume'); } },
    stop() { this.on = false; this.paused = false; f.log.push('music.stop'); },
  });
  f.sfx.setHold = function (on) { this.held = !!on; f.log.push('sfx.hold:' + (on ? 1 : 0)); };
  return f;
}

test('정지: 음악은 멈춤(위치 유지)·효과음 막음, 재개 때 켜져 있으면 이어서. 저장값은 그대로', () => {
  const st = mem({ [KEY]: j({ on: true }) });
  const f = holdFakes();
  const s = new Sound({ ...f, storage: st, search: '' });
  f.win.listeners.get('keydown')({ target: {} }); // 첫 동작 → 재생
  assert.ok(f.music.on);
  f.log.length = 0;
  s.setHold(true);
  assert.deepEqual(f.log, ['sfx.hold:1', 'music.pause']);
  assert.ok(f.music.on && f.music.paused, '켜 둔 상태는 그대로, 멈춤만');
  assert.match(f.button.textContent, /정지 중/);
  assert.match(f.button.title, /재개하면 이어서/);
  s.setHold(false);
  assert.deepEqual(f.log.slice(2), ['sfx.hold:0', 'music.resume']);
  assert.equal(st.getItem(KEY), j({ on: true }), '저장값 안 바뀜');
});

test('정지: 소리가 꺼져 있으면 재개해도 켜지 않음, 정지 중 켜면 저장만 하고 재개 때 재생, 정지 중 끄면 재개해도 조용', () => {
  const st = mem({ [KEY]: j({ on: false }) });
  const f = holdFakes();
  const s = new Sound({ ...f, storage: st, search: '' });
  s.setHold(true); s.setHold(false);
  assert.ok(!f.music.on && !f.log.includes('music.start'));
  // 정지 중 켬
  s.setHold(true);
  f.log.length = 0;
  s.setOn(true);
  assert.equal(st.getItem(KEY), j({ on: true }));
  assert.ok(!f.log.includes('music.start') && !f.log.includes('sfx.play:chime'), '정지 중엔 재생하지 않음');
  s.setHold(false);
  assert.ok(f.log.includes('music.start'), '재개 때 재생');
  // 재생 중 정지 → 정지 중 끔 → 재개해도 조용
  s.setHold(true);
  s.setOn(false);
  assert.ok(!f.music.on && !f.music.paused);
  f.log.length = 0;
  s.setHold(false);
  assert.ok(!f.log.includes('music.start') && !f.log.includes('music.resume'));
});

test('부분 토글(§85): 음악만 끄면 음악 정지·효과음 유지, 저장(ccviz.sound.parts) 후 새로고침·복원·일시정지 해제에도 안 켜짐', async () => {
  const f = fakes(); realSfx(f); f.nav.userActivation.hasBeenActive = true;
  const storage = mem({ [KEY]: j({ on: true }) });
  const s = new Sound({ ...f, storage, search: '' });
  await flush();
  assert.equal(f.music.on, true); assert.equal(f.sfx.enabled, true);
  f.log.length = 0;
  s.setMusicOn(false);
  assert.deepEqual(f.log, ['music.stop']);
  assert.equal(f.sfx.enabled, true, '효과음은 그대로');
  assert.equal(s.on, true, '마스터는 켜진 채');
  assert.equal(storage.getItem(PARTS_KEY), j({ music: false, sfx: true }));
  assert.equal(f.music.wantOn, false);
  assert.match(f.button.title, /음악 끔/);
  s.restore(true); f.doc.listeners.get('visibilitychange')();
  f.music.paused = true; s.setHold(true); s.setHold(false);
  assert.ok(!f.log.includes('music.start'), '복원·탭 복귀·재개가 음악을 다시 켜지 않음');
  // 새로고침: 저장값 유지
  const g = fakes(); realSfx(g); g.nav.userActivation.hasBeenActive = true;
  const s2 = new Sound({ ...g, storage, search: '' });
  assert.equal(s2.musicOn, false); assert.equal(s2.sfxOn, true);
  assert.ok(!g.log.includes('music.start'));
  assert.ok(g.log.includes('sfx.on'));
  assert.equal(s2.status(), 'on');
  // 다시 켜면 음악 시작
  s2.setMusicOn(true);
  assert.ok(g.log.includes('music.start'));
  assert.equal(storage.getItem(PARTS_KEY), j({ music: true, sfx: true }));
});

test('부분 토글(§85): 효과음만 끄면 효과음 끔·음악 유지, 마스터를 껐다 켜도 효과음은 꺼진 채, 둘 다 꺼도 마스터 유지', async () => {
  const f = fakes(); realSfx(f); f.nav.userActivation.hasBeenActive = true;
  const storage = mem({ [KEY]: j({ on: true }) });
  const s = new Sound({ ...f, storage, search: '' });
  await flush();
  s.setSfxOn(false);
  assert.equal(f.sfx.enabled, false); assert.equal(f.music.on, true);
  f.button._h(); // 마스터 끔
  assert.equal(f.music.on, false);
  f.log.length = 0;
  f.button._h(); // 마스터 켬
  assert.deepEqual(f.log, ['sfx.off', 'music.start'], '효과음은 켜지 않고 확인음(chime)도 없음');
  s.setMusicOn(false);
  assert.equal(s.on, true);
  assert.equal(s.status(), 'on');
  assert.match(f.button.title, /모두 끔/);
  // 마스터가 꺼져 있을 때 부분 토글은 선택만 저장
  f.button._h(); f.log.length = 0;
  s.setSfxOn(true); s.setMusicOn(true);
  assert.deepEqual(f.log, []);
  assert.equal(storage.getItem(PARTS_KEY), j({ music: true, sfx: true }));
});
