// 단축키 안내(Alt 를 누르고 있는 동안 풍선) — 목록·판정(DOM 없음, 시험용). 범례 '조작' 절의 키 줄도 이 목록에서 만든다(한 출처).
// 키는 실제 바인딩 그대로: 재생 = replay/ui.mjs onKey, 실시간 Space = app.js(spaceForPause), 카메라 = camera.js·flat/camera2d.js _key,
// Esc = app.js escClears·inspector·pov-ui. at = 풍선을 붙일 화면 요소(없거나 안 보이면 안내 카드에만)

export const KEY_HINTS = {
  replay: [
    { keys: ['Space'], label: 'app.keys.playPause', at: 'play' },
    { keys: [',', '.'], label: 'app.keys.step10', at: 'timeline' },
    { keys: ['<', '>'], label: 'app.keys.step60', at: 'timeline' },
    { keys: ['N', 'B'], label: 'app.keys.highlight', at: 'timeline' },
    { keys: ['[', ']'], label: 'app.keys.speed', at: 'speed' },
  ],
  live: [
    { keys: ['Space'], label: 'app.keys.pauseLive', at: 'pause' },
  ],
  camera: [
    { keys: ['W', 'A', 'S', 'D'], also: '← ↑ ↓ →', label: 'app.keys.move' },
    { keys: ['Q', 'E'], also: '− +', label: 'app.keys.zoom' },
    { keys: ['Esc'], label: 'app.keys.esc' },
  ],
};

/** 지금 상황의 안내 목록: 재생 중이면 재생 키, 아니면 실시간 키 + 카메라 키 */
export function hintsFor({ replaying = false } = {}) {
  return [...(replaying ? KEY_HINTS.replay : KEY_HINTS.live), ...KEY_HINTS.camera];
}

/** 이 keydown 이 안내를 띄우는 Alt 단독 누름인가(Ctrl+Alt = AltGr·Shift+Alt 언어 전환은 아님, 입력칸이면 아님) */
export function altOpens(e, { editable = false, tag = '' } = {}) {
  if (!e || e.key !== 'Alt' || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return false;
  if (editable) return false;
  return !/^(INPUT|SELECT|TEXTAREA)$/i.test(tag || '');
}

export const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** 키 묶음 → 표시 글('W A S D / ← ↑ ↓ →') */
export function keyText(h) { return h.keys.join(' ') + (h.also ? ' / ' + h.also : ''); }
/** 범례 한 줄(HTML): '<b>Space</b> 재생/정지 · <b>, .</b> 10초 뒤·앞 …' */
export function legendLine(list, tr) {
  return list.map((h) => `<b>${escHtml(keyText(h))}</b> ${tr(h.label)}`).join(' · ');
}
/** 첫 재생 때 한 번만 알리는가(저장값 없음 + 키보드·마우스 기기) */
export const ALT_TIP_KEY = 'ccviz.altTipSeen';
export function wantAltTip(seen, finePointer) { return !seen && !!finePointer; }
