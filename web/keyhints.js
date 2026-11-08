// 단축키 안내 풍선: Alt 를 누르고 있는 동안 재생 막대 단추·타임라인(실시간이면 정지 단추·현재로 배지) 옆에 키 풍선 + 전체 목록 카드.
// Alt 단독은 Windows 브라우저에서 놓을 때 메뉴로 포커스가 갈 수 있어 keydown·keyup 에서 preventDefault. Alt+Tab 등으로 창을 떠나면
// (다른 키·blur·visibilitychange·pointerdown) 바로 숨긴다. 입력칸 포커스 중엔 띄우지 않는다. 터치 전용 기기는 해당 없음.
import { t } from './i18n.mjs';
import { hintsFor, altOpens, keyText, escHtml, ALT_TIP_KEY, wantAltTip } from './keyhints-core.mjs';

const SHOW_DELAY = 180; // Alt+Tab 처럼 바로 다른 키가 따라오면 깜박이지 않게

export function mountKeyHints({ isReplaying, anchors }) {
  const root = document.createElement('div');
  root.id = 'key-hints'; root.hidden = true; root.setAttribute('aria-hidden', 'true');
  document.body.appendChild(root);
  let timer = 0, shown = false;

  const visibleRect = (el) => {
    if (!el || el.hidden || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) return null;
    const cs = getComputedStyle(el);
    return cs.visibility === 'hidden' || cs.display === 'none' ? null : r;
  };
  function render() {
    const list = hintsFor({ replaying: !!isReplaying() });
    const card = `<div class="kh-card"><h4>${t('app.keys.title')}</h4><ul>` +
      list.map((h) => `<li><kbd>${escHtml(keyText(h))}</kbd><span>${t(h.label)}</span></li>`).join('') + `</ul><p>${t('app.keys.release')}</p></div>`;
    // 요소마다 풍선 하나(같은 요소의 키는 한 풍선에 줄로)
    const by = new Map();
    for (const h of list) if (h.at) { const a = by.get(h.at) || []; a.push(h); by.set(h.at, a); }
    let tips = '';
    for (const [at, hs] of by) {
      const r = visibleRect(anchors[at] && anchors[at]());
      if (!r) continue;
      const up = r.top > 90; // 위에 자리가 있으면 위로, 아니면 아래로
      const y = up ? r.top - 8 : r.bottom + 8;
      tips += `<div class="kh-tip ${up ? 'up' : 'down'}" data-at="${at}" data-ax="${Math.round(r.left + r.width / 2)}" style="top:${Math.round(y)}px">` +
        hs.map((h) => `<div><kbd>${escHtml(keyText(h))}</kbd> ${t(h.label)}</div>`).join('') + '</div>';
    }
    root.innerHTML = card + tips;
    place();
  }
  /** 풍선 자리: 단추 가운데 위(화면 끝이면 안쪽으로 밀고 꼬리만 단추를 가리킴), 앞 풍선과 겹치면 그 위로 쌓음(꼬리 없음) */
  function place() {
    const done = [];
    for (const el of root.querySelectorAll('.kh-tip')) {
      const ax = Number(el.dataset.ax), w = el.offsetWidth, h = el.offsetHeight, up = el.classList.contains('up');
      const left = Math.max(8, Math.min(innerWidth - 8 - w, ax - w / 2));
      let top = up ? el.offsetTop - h : el.offsetTop;
      const hit = () => done.find((b) => left < b.r && left + w > b.l && top < b.b && top + h > b.t);
      let b, n = 0;
      while ((b = hit()) && n++ < 6) { top = up ? b.t - h - 6 : b.b + 6; el.classList.add('stack'); }
      el.style.left = left + 'px'; el.style.top = top + 'px'; el.style.transform = 'none';
      el.style.setProperty('--ax', Math.max(10, Math.min(w - 10, ax - left)) + 'px');
      done.push({ l: left, r: left + w, t: top, b: top + h });
    }
  }
  function show() { timer = 0; shown = true; root.hidden = false; render(); for (const n of document.querySelectorAll('.kh-once')) n.remove(); // 첫 안내는 할 일을 했으니 치움
    /* 보이게 한 뒤 재야 풍선 크기가 나옴 */ document.body.classList.add('key-hints-on'); }
  function hide() { clearTimeout(timer); timer = 0; if (!shown) return; shown = false; root.hidden = true; document.body.classList.remove('key-hints-on'); }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') {
      const tg = e.target;
      const editable = !!(tg && tg.closest && tg.closest('[contenteditable=""], [contenteditable="true"]'));
      if (!altOpens(e, { editable, tag: tg && tg.tagName })) return;
      e.preventDefault(); // 놓을 때 브라우저 메뉴로 포커스가 가지 않게
      if (!e.repeat && !shown && !timer) timer = setTimeout(show, SHOW_DELAY);
      return;
    }
    hide(); // Alt+Tab·Alt+다른 키 = 안내 아님
  }, true);
  window.addEventListener('keyup', (e) => { if (e.key === 'Alt') { if (shown || timer) e.preventDefault(); hide(); } }, true);
  window.addEventListener('blur', hide);
  document.addEventListener('visibilitychange', hide);
  window.addEventListener('pointerdown', hide, true);
  window.addEventListener('resize', () => { if (shown) render(); });

  /** 첫 재생 때 한 번만: 'Alt 를 누르면 단축키 안내'(다시 안 보임, 터치 전용 기기 제외) */
  function tipOnce() {
    let seen = false, fine = false;
    try { seen = localStorage.getItem(ALT_TIP_KEY) === '1'; } catch (e) { seen = true; } // 저장소를 못 쓰면 매번 띄우지 않게
    try { fine = matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) {}
    if (!wantAltTip(seen, fine)) return false;
    try { localStorage.setItem(ALT_TIP_KEY, '1'); } catch (e) {}
    const n = document.createElement('div');
    n.className = 'kh-once'; n.setAttribute('role', 'status');
    n.innerHTML = t('app.keys.tipOnce');
    document.body.appendChild(n);
    requestAnimationFrame(() => n.classList.add('on'));
    setTimeout(() => { n.classList.remove('on'); setTimeout(() => n.remove(), 400); }, 6000);
    return true;
  }
  return { show, hide, tipOnce, get shown() { return shown; } };
}
