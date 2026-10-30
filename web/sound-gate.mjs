// 소리 '대기' 상태 머신. DOM 없음 — sound.mjs 가 쓰고 web/test/sound-gate.test.mjs 가 검사한다.
//   브라우저 자동재생 정책: 새로고침 직후엔 사용자 동작이 없어 <audio>.play() 가 NotAllowedError 로 거부되고,
//   AudioContext 는 suspended 로 만들어진다(탭 백그라운드·다른 앱 소리로 interrupted 도 됨).
//   저장된 '켜짐'만 보고 '소리 켜짐'이라 쓰면 실제로는 조용하다 → 실제 상태로 '대기'를 판정하고, 첫 사용자 동작에서 복원한다.
import { t as tr } from './i18n.mjs';

/** 부분 토글을 반영: 끈 쪽은 '없음'으로 보아 대기·복원 판정에서 뺀다 */
const parts = (s) => ({ ...s, musicAvailable: !!s.musicAvailable && s.musicPart !== false, sfxCapable: !!s.sfxCapable && s.sfxPart !== false });

/**
 * 지금 소리 상태.
 * @param {object} s
 * @param {boolean} s.on              사용자가 고른 켜짐(저장값)
 * @param {boolean} [s.held]          시각화 일시정지 중
 * @param {boolean} [s.musicAvailable] 배경음악 파일 있음
 * @param {boolean} [s.musicBlocked]  최근 play 가 자동재생 정책(NotAllowedError)으로 거부됨
 * @param {boolean} [s.musicLoading]  play 가 버퍼링을 기다리는 중
 * @param {boolean} [s.sfxCapable]    효과음을 낼 수 있는 브라우저(AudioContext 있음)
 * @param {boolean} [s.sfxEnabled]    효과음이 켜져 있음(첫 동작 전엔 일부러 안 켬)
 * @param {string}  [s.sfxState]      효과음 AudioContext 상태: 'none'(아직 없음)|'suspended'|'running'|'interrupted'|'closed'
 * @param {string}  [s.routeState]    배경음악이 지나가는 AudioContext(audio.js routeCtx) 상태: 'none'|…
 * @param {boolean} [s.musicPart]     팝업 '음악' 토글(기본 켬) — 끄면 음악은 없는 것처럼 본다
 * @param {boolean} [s.sfxPart]       팝업 '효과음' 토글(기본 켬) — 끄면 효과음은 없는 것처럼 본다
 * @returns {'off'|'held'|'waiting'|'loading'|'on'}
 */
export function soundStatus(s0) {
  if (!s0 || !s0.on) return 'off';
  const s = parts(s0);
  if (s.held) return 'held';
  const stalled = (st) => st === 'suspended' || st === 'interrupted';
  if (s.musicAvailable && s.musicBlocked) return 'waiting';
  if (s.musicAvailable && stalled(s.routeState)) return 'waiting'; // WebAudio 경로에 이어진 음악은 그 컨텍스트가 멈추면 소리가 안 난다
  if (s.sfxCapable && (!s.sfxEnabled || stalled(s.sfxState))) return 'waiting';
  if (s.musicAvailable && s.musicLoading) return 'loading';
  return 'on';
}

/**
 * 복원 계획: 무엇을 다시 시도할지. 실제 호출은 sound.mjs 가 한다.
 *   activated = 사용자 동작 안(또는 sticky activation·자동재생 허용 확인) — 효과음 컨텍스트는 이때만 만든다
 *   (동작 전에 만든 suspended 컨텍스트에 소리가 쌓였다가 한꺼번에 나는 것을 막으려고)
 * @returns {{sfx: null|'enable'|'resume', music: null|'start'|'play', route: null|'resume'}}
 */
export function restorePlan(s0) {
  const plan = { sfx: null, music: null, route: null };
  if (!s0 || !s0.on || s0.held) return plan;
  const s = parts(s0);
  const stalled = (st) => st === 'suspended' || st === 'interrupted';
  if (s.sfxCapable && s.activated) {
    if (!s.sfxEnabled) plan.sfx = 'enable';
    else if (stalled(s.sfxState)) plan.sfx = 'resume';
  }
  if (s.musicAvailable) {
    // 음악은 동작 전에도 한 번 시도한다(자동재생이 허용된 브라우저·사이트면 바로 남, 거부되면 '대기')
    if (!s.musicOn) plan.music = 'start';
    else if (!s.musicPaused && s.audioPaused) plan.music = 'play'; // 켜져 있는데 브라우저가 멈춤(백그라운드·중단)
    if (stalled(s.routeState) && s.activated) plan.route = 'resume';
  }
  return plan;
}

export const WAIT_HINT = tr('sound.waitHint'); // 불러올 때 언어

/** 버튼 문구·툴팁·aria-label */
export function soundLabel(status, { noMusic = false, musicOff = false, sfxOff = false } = {}) {
  const hint = tr('sound.waitHint');
  const text = tr(`sound.btn.${['off', 'held', 'waiting', 'loading', 'on'].includes(status) ? status : 'off'}`);
  let title = tr('sound.btn.title');
  if (status === 'held') title += tr('sound.btn.title.held');
  else if (status === 'waiting') title = tr('sound.btn.title.waiting', { hint });
  if (noMusic) title += tr('sound.btn.title.noMusic');
  if (status !== 'off' && (musicOff || sfxOff)) title += tr(musicOff && sfxOff ? 'sound.btn.title.bothOff' : musicOff ? 'sound.btn.title.musicOff' : 'sound.btn.title.sfxOff');
  const aria = status === 'off' ? tr('sound.btn.aria.off')
    : status === 'waiting' ? tr('sound.btn.aria.waiting', { hint }) : tr('sound.btn.aria.on');
  return { text, title, aria };
}

/** 복원 시도에 쓰는 사용자 동작 이벤트(capture). 터치는 pointerup·touchend 에서야 활성화가 붙으므로 둘 다 듣는다 */
export const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'click'];
