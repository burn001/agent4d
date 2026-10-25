// 소리 토글: 상단 바 버튼 하나로 배경음악(audio.js Music)과 효과음(sfx.mjs Sfx)을 함께 켜고 끈다.
//   - 켜짐/꺼짐은 localStorage 'ccviz.sound' = {on} 하나에 저장 → 새로고침·재접속·세션/프로젝트·재생↔실시간 전환 뒤에도 유지
//   - 이행: 'ccviz.sound' 가 없으면 예전 'ccviz.music'·'ccviz.sfx' 의 on 중 하나라도 켜져 있으면 켬(볼륨은 각 키에 그대로)
//   - URL ?sound=1|0 은 그 접속에서만 우선하고 저장값은 덮지 않는다(버튼을 직접 누르면 그때 저장)
//   - 자동재생 정책: 켬 상태로 열리면 음악 재생을 한 번 시도하고, 거부(NotAllowedError)·효과음 컨텍스트 suspended 면
//     버튼을 '소리 대기'(점멸 점·툴팁 "화면을 한 번 누르면 소리가 납니다")로 둔다. 페이지 어디든 사용자 동작(capture)에서
//     audio.play()·ctx.resume() 으로 복원하고 표시를 지운다. 대기 중 소리 버튼을 누르면 끄지 않고 복원한다.
//     탭 복귀(visibilitychange)·컨텍스트 statechange(interrupted 등)·일시정지 해제도 같은 복원 경로. 판정은 sound-gate.mjs(순수)

import { soundStatus, restorePlan, soundLabel, GESTURE_EVENTS } from './sound-gate.mjs';

export const KEY = 'ccviz.sound';
const OLD_KEYS = ['ccviz.music', 'ccviz.sfx'];

const readJson = (storage, k) => { try { return JSON.parse((storage && storage.getItem(k)) || 'null'); } catch (e) { return null; } };

/** 저장된 소리 켜짐 여부(+이행). 저장소 접근 실패는 꺼짐 */
export function loadSoundOn(storage) {
  const s = readJson(storage, KEY);
  if (s && typeof s.on === 'boolean') return s.on;
  return OLD_KEYS.some((k) => { const o = readJson(storage, k); return !!(o && o.on); });
}

export function saveSoundOn(storage, on) {
  try { storage && storage.setItem(KEY, JSON.stringify({ on: !!on })); } catch (e) { /* 저장 불가: 이번 접속만 */ }
}

/** URL 의 sound 파라미터: '1'·'on'·'true' → true, '0'·'off'·'false' → false, 없거나 그 밖 → null */
export function urlSoundOverride(search) {
  let v = null;
  try { v = new URLSearchParams(search || '').get('sound'); } catch (e) { return null; }
  if (v == null) return null;
  v = v.toLowerCase();
  if (['1', 'on', 'true', 'yes'].includes(v)) return true;
  if (['0', 'off', 'false', 'no'].includes(v)) return false;
  return null;
}

const CSS = `
#btn-sound.snd-wait::after { content: ''; display: inline-block; width: 7px; height: 7px; margin-left: 6px; border-radius: 50%;
  vertical-align: middle; background: var(--warn, #f59e0b); animation: snd-wait 1.1s ease-in-out infinite; }
@keyframes snd-wait { 0%, 100% { opacity: 1; } 50% { opacity: .2; } }
@media (prefers-reduced-motion: reduce) { #btn-sound.snd-wait::after { animation: none; } }
`;

const ctxState = (c) => (c && typeof c.state === 'string' ? c.state : 'none');

export class Sound {
  /**
   * @param {{music?: object, sfx?: object, button?: HTMLElement, sfxSlider?: HTMLInputElement, storage?: Storage|null, search?: string, win?: EventTarget, doc?: Document, nav?: Navigator}} o
   */
  constructor({ music = null, sfx = null, button = null, sfxSlider = null, storage, search, win, doc, nav } = {}) {
    this.music = music;
    this.sfx = sfx;
    this.button = button;
    this._storage = storage !== undefined ? storage : (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } })();
    this._win = win !== undefined ? win : (typeof window !== 'undefined' ? window : null);
    this._doc = doc !== undefined ? doc : (typeof document !== 'undefined' ? document : null);
    this._nav = nav !== undefined ? nav : (typeof navigator !== 'undefined' ? navigator : null);
    const override = urlSoundOverride(search !== undefined ? search : (typeof location !== 'undefined' ? location.search : ''));
    this.on = override != null ? override : loadSoundOn(this._storage);
    // 이행: 새 키가 없으면 한 번 써 둔다(URL 로 정한 값은 저장하지 않음)
    if (override == null && !(readJson(this._storage, KEY) || {}).hasOwnProperty('on')) saveSoundOn(this._storage, this.on);
    this.held = false; // 시각화 일시정지 중: 소리를 잠시 멈춤 — 사용자 선택(this.on·저장값)은 그대로
    this.musicBlocked = false; // 최근 play() 가 자동재생 정책으로 거부됨
    this._autoplayOk = false;  // 동작 없이 음악이 났다 = 자동재생 허용(효과음 컨텍스트도 만들어 봄)
    this._armed = false;
    this._watched = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    this._onGestureEv = (e) => {
      // 소리 버튼 자체는 click → toggle 이 처리(대기면 복원)
      if (button && e && e.target && typeof button.contains === 'function' && button.contains(e.target)) return;
      this.restore(true);
    };

    if (this._doc && this._doc.head && typeof this._doc.getElementById === 'function' && !this._doc.getElementById('snd-wait-css')) {
      try { const st = this._doc.createElement('style'); st.id = 'snd-wait-css'; st.textContent = CSS; this._doc.head.appendChild(st); } catch (e) {}
    }
    if (music) {
      music.wantOn = this.on; // 켬이면 미리 받아 두기(preload auto)
      music.onChange = () => { this._watch(music.routeCtx); this.render(); };
      music.onAvailable = () => { if (this.on && !this.held) this.restore(false); else this.render(); };
    }
    if (sfxSlider && sfx) {
      sfxSlider.value = String(sfx.volume);
      sfxSlider.addEventListener('input', () => sfx.setVolume(sfxSlider.value));
    }
    if (button) button.addEventListener('click', () => this.toggle());
    if (this._doc && typeof this._doc.addEventListener === 'function') {
      this._doc.addEventListener('visibilitychange', () => { if (!this._doc.hidden) this.restore(false); });
    }
    if (this.on) this.restore(false); // 켬으로 열림: 한 번 시도(거부되면 '대기' → 첫 동작에서 복원)
    else this.render();
  }

  _activated(gesture) {
    if (gesture || this._autoplayOk) return true;
    const ua = this._nav && this._nav.userActivation;
    return !!(ua && ua.hasBeenActive);
  }

  _snapshot(gesture = false) {
    const m = this.music, s = this.sfx;
    return {
      on: this.on, held: this.held, activated: this._activated(gesture),
      musicAvailable: !!(m && m.available), musicOn: !!(m && m.on), musicPaused: !!(m && m.paused),
      musicLoading: !!(m && m.loading), musicBlocked: this.musicBlocked,
      audioPaused: !!(m && m.audio && m.audio.paused),
      routeState: m && m.routeCtx ? ctxState(m.routeCtx) : 'none',
      sfxCapable: !!(s && s._AudioCtx), sfxEnabled: !!(s && s.enabled), sfxState: s ? ctxState(s.ctx) : 'none',
    };
  }

  /** 'off'|'held'|'waiting'|'loading'|'on' */
  status() { return soundStatus(this._snapshot()); }

  /** 컨텍스트가 멈추면(interrupted·suspended) 같은 복원 경로로 */
  _watch(c) {
    if (!c || typeof c.addEventListener !== 'function' || !this._watched || this._watched.has(c)) return;
    this._watched.add(c);
    c.addEventListener('statechange', () => {
      if (this.on && !this.held && c.state !== 'running' && c.state !== 'closed') this.restore(false);
      else this.render();
    });
  }

  /** 켜 둔 소리를 실제로 나게 한다. gesture = 사용자 동작 안에서 부름 */
  restore(gesture = false) {
    const plan = restorePlan(this._snapshot(gesture));
    const m = this.music, s = this.sfx;
    if (plan.sfx === 'enable') s.setEnabled(true); // 사용자 동작 안: AudioContext 만들고 resume
    if (s && s.ctx) {
      this._watch(s.ctx);
      if (plan.sfx && s.ctx.state !== 'running') s.ctx.resume().then(() => this.render(), () => {});
    }
    if (m && m.routeCtx) this._watch(m.routeCtx);
    if (plan.route === 'resume') m.routeCtx.resume().then(() => this.render(), () => {});
    if (plan.music) this.musicBlocked = false; // 다시 시도: 결과(_track)가 거부면 다시 대기
    if (plan.music === 'start') this._track(m.start(), gesture);
    else if (plan.music === 'play' && typeof m.ensurePlaying === 'function') this._track(m.ensurePlaying(), gesture);
    this.render();
  }

  /** play() 결과: 거부면 '대기', 동작 없이 났으면 자동재생 허용으로 보고 효과음도 켬 */
  _track(p, gesture) {
    if (!p || typeof p.then !== 'function') return;
    this._pending = (this._pending || 0) + 1;
    p.then((ok) => {
      this._pending--;
      const m = this.music;
      if (ok === false) this.musicBlocked = !!(this.on && m && m.lastError === 'NotAllowedError');
      else if (ok === true) {
        this.musicBlocked = false;
        if (!gesture && !this._activated(false)) { this._autoplayOk = true; this.restore(false); return; }
      }
      this.render();
    }, () => { this._pending--; this.render(); });
  }

  _arm(on) {
    if (on === this._armed || !this._win) return;
    this._armed = on;
    for (const t of GESTURE_EVENTS) {
      if (on) this._win.addEventListener(t, this._onGestureEv, true);
      else this._win.removeEventListener(t, this._onGestureEv, true);
    }
  }

  toggle() {
    // 대기 중(켜 뒀는데 브라우저가 막음): 끄지 않고 이 클릭으로 복원. 그래도 대기면 다음 클릭은 끄기(못 끄는 일 없게)
    if (this.on && this.status() === 'waiting' && !this._btnRestored) { this._btnRestored = true; this.restore(true); return; }
    this.setOn(!this.on);
  }

  /** 사용자 동작으로 켜고 끔(저장함) */
  setOn(on) {
    this.on = !!on;
    this.musicBlocked = false;
    saveSoundOn(this._storage, this.on);
    // 직접 고른 값이 생겼으니 URL 의 일회성 sound= 는 지운다(새로고침해도 저장값을 따르게)
    try {
      if (typeof location !== 'undefined' && typeof history !== 'undefined') {
        const u = new URL(location.href);
        if (u.searchParams.has('sound')) { u.searchParams.delete('sound'); history.replaceState(history.state, '', u); }
      }
    } catch (e) {}
    if (this.music) this.music.wantOn = this.on;
    if (this.sfx) this.sfx.setEnabled(this.on);
    if (this.held) { if (!this.on && this.music) this.music.stop(); this.render(); return; } // 정지 중: 선택만 저장, 재개 때 재생
    if (this.on) {
      this.restore(true);
      if (this.sfx) this.sfx.play('chime', { priority: 0 });
    } else if (this.music) this.music.stop();
    this.render();
  }

  /**
   * 시각화 일시정지. on: 배경음악은 짧게 줄여 멈추고(위치 유지) 효과음은 막는다. off: 소리 설정이 켜져 있을 때만 이어서
   * 재생(페이드인), 꺼져 있으면 그대로. 정지 중 버튼으로 켜면 저장만 하고 재개 때 재생. 저장값은 바꾸지 않는다
   */
  setHold(on) {
    on = !!on;
    if (on === this.held) return;
    this.held = on;
    const m = this.music, s = this.sfx;
    if (s && typeof s.setHold === 'function') s.setHold(on);
    if (on) { if (m && typeof m.pause === 'function') m.pause(); }
    else if (this.on) {
      if (m && m.paused && m.on) {
        const p = m.resume();
        if (p && typeof p.then === 'function') p.then((ok) => { if (ok === false) this.restore(false); else this.render(); }, () => {});
      }
      this.restore(false);
    } else if (m && m.paused) { m.paused = false; if (m.on) m.stop(); }
    this.render();
  }

  render() {
    const st = this.status();
    this._arm(st === 'waiting');
    if (st !== 'waiting' && !this._pending) this._btnRestored = false; // 시도 결과가 나온 뒤에만(진행 중 '켜짐'으로 잠깐 보이는 것은 무시)
    const b = this.button;
    if (!b) return;
    const noMusic = !!(this.music && this.music.available === false && this.music._probed);
    const l = soundLabel(st, { noMusic });
    b.textContent = l.text;
    b.title = l.title;
    b.setAttribute('aria-pressed', String(this.on));
    b.setAttribute('aria-label', l.aria);
    b.setAttribute('data-sound', st);
    if (b.classList) b.classList.toggle('snd-wait', st === 'waiting');
    if (st === 'loading') b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy');
    const noSfx = !this.sfx || !this.sfx._AudioCtx;
    b.disabled = noSfx && noMusic;
  }
}
