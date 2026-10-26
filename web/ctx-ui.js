// 컨텍스트 사용률 게이지 + 신호 열화 연출 + 소리.
//   const cx = mountCtx({ store, getView, getState: () => ({ focusId, streamAll, sel }), music, sfx });
//   cx.noteCtx(ev, prevNode, {quiet})  — node-update 에 meta.ctx 가 있을 때(병합 전) 부른다. 급락이면 정화 연출, ev.ctxNote 를 붙임
//   cx.hover(nodeId|null, pointerEvent) — 노드 툴팁
// 상단 바·설정 DOM 은 이 모듈이 직접 만든다(index.html 무변경). 저장값은 localStorage try/catch.
// 2차: 열화 수준(levelOf) = 창 대비 %. 단계·셰이더·오디오·정화·버스트·재생 모두 같은 값(절대량 기준은 2026-10-26 폐지).
//   메인 노드 잔상(셰이더 uMain·2D FlatDegrade)·글자 깨짐(TextGlitch)·흐름선 끊김(렌더러가 DEG 를 읽음)·문턱 버스트.
import {
  noiseParams, noiseNeeded, ctxNote, ctxShort, ctxTitle, pctText, gaugeLevel, pickGaugeNode, rankRegions, isCtxDrop,
  stageOf, STAGES, RECOMMEND_PCT, NOISE_MIN_PCT, DEFAULT_STRENGTH, fmtTokens, PurgeBook, MAX_REGIONS,
} from './ctx-core.mjs';
// 신호 열화 후처리(noise.js, three)는 3D 장면일 때만 필요할 때 불러온다 — 2D 화면은 three.js 를 받지 않는다
import { nodeSubtitle } from './node-title.mjs';
import {
  DEG, levelOf, stageTable, baseOf, grownOf, degScaled, stageCross, burstWanted, BurstBook, ghostOffsets, seedOf,
} from './degrade-core.mjs';
import { TextGlitch } from './degrade-text.js';
import { FlatDegrade } from './flat/flat-degrade.js';
import { t as tr } from './i18n.mjs';

const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 저장소 없음 */ } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SESSION_KINDS = new Set(['main', 'claude-p']);
const NL = String.fromCharCode(10);

function ensureCss() {
  if (document.querySelector('link[data-ccviz="ctx"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./ctx.css', import.meta.url).href;
  l.dataset.ccviz = 'ctx';
  document.head.appendChild(l);
}

/** 배경음악 로우패스 + 험. 효과음·음악이 하나라도 켜져 있을 때만 소리를 낸다 */
class NoiseAudio {
  constructor(music) {
    this.music = music;
    this.ctx = null;
    this.filter = null;
    this.wired = false;
    this.wireFailed = false;
    this.hum = null;
  }
  _ctx() {
    if (!this.ctx && this.music.routeCtx) this.ctx = this.music.routeCtx; // 배경음악(audio.js)이 먼저 만든 컨텍스트를 같이 씀
    if (this.ctx) return this.ctx.state === 'running' ? this.ctx : (this.ctx.resume().catch(() => {}), null);
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    // 사용자 동작 전에는 만들지 않는다(정지 상태 컨텍스트로 음악을 돌리면 소리가 끊김)
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    try { this.ctx = new AC({ latencyHint: 'playback' }); } catch (e) { return null; }
    this.music.routeCtx = this.ctx; // 음악이 이 컨텍스트로 나가므로 소리 복원(sound.mjs)이 같이 resume 한다
    this.ctx.resume().catch(() => {});
    return this.ctx.state === 'running' ? this.ctx : null;
  }
  update({ lowpassHz = 20000, hum = 0, musicOn = false, sfxOn = false, enabled = true }) {
    const wantLp = enabled && musicOn && lowpassHz < 19000;
    // 배경음악 두 덱은 audio.js 가 MediaElementSource → 덱 Gain → 버스 → 볼륨으로 잇고(ensureGraph), 여기는 그 출력 뒤에 로우패스만 끼운다
    if (musicOn && !this.wired && !this.wireFailed && typeof this.music.ensureGraph === 'function') {
      const out = this.music.ensureGraph();
      const ctx = out && this.music.routeCtx;
      if (ctx && wantLp) {
        try {
          this.ctx = ctx;
          this.filter = ctx.createBiquadFilter();
          this.filter.type = 'lowpass'; this.filter.frequency.value = 20000; this.filter.Q.value = 0.8;
          this.filter.connect(ctx.destination);
          if (!this.music.setInsert(this.filter)) throw new Error('insert');
          this.wired = true;
        } catch (e) { this.wireFailed = true; this.filter = null; }
      }
    }
    if (this.filter && this.ctx) this.filter.frequency.setTargetAtTime(wantLp ? lowpassHz : 20000, this.ctx.currentTime, 0.35);
    const wantHum = enabled && (musicOn || sfxOn) && hum > 0.02;
    if (wantHum) {
      const ctx = this._ctx();
      if (!ctx) return;
      if (!this.hum) {
        const g = ctx.createGain(); g.gain.value = 0; g.connect(ctx.destination);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.connect(g);
        const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
        const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 110;
        const g2 = ctx.createGain(); g2.gain.value = 0.35;
        o1.connect(lp); o2.connect(g2); g2.connect(lp);
        // 느린 떨림(0.3Hz)
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.3;
        const lg = ctx.createGain(); lg.gain.value = 0.25; lfo.connect(lg);
        const trem = ctx.createGain(); trem.gain.value = 1; lg.connect(trem.gain);
        lp.disconnect(); lp.connect(trem); trem.connect(g);
        o1.start(); o2.start(); lfo.start();
        this.hum = { g, nodes: [o1, o2, lfo], stopAt: 0 };
      }
      this.hum.stopAt = 0;
      this.hum.g.gain.setTargetAtTime(0.045 * Math.min(1, hum), ctx.currentTime, 0.6);
    } else if (this.hum && this.ctx) {
      const h = this.hum;
      h.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      if (!h.stopAt) h.stopAt = performance.now() + 2500;
      else if (performance.now() > h.stopAt) {
        for (const o of h.nodes) { try { o.stop(); } catch (e) {} }
        try { h.g.disconnect(); } catch (e) {}
        this.hum = null;
      }
    }
  }
  get humOn() { return !!(this.hum && !this.hum.stopAt); }
}

export function mountCtx({ store, getView, getState, music = null, sfx = null }) {
  ensureCss();
  const reducedMql = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(reducedMql && reducedMql.matches);
  reducedMql && reducedMql.addEventListener && reducedMql.addEventListener('change', () => { reduced = reducedMql.matches; });

  let enabled = lsGet('ccviz.noise') !== 'off';
  let strength = Number(lsGet('ccviz.noiseAmt', String(DEFAULT_STRENGTH)));
  if (!isFinite(strength)) strength = DEFAULT_STRENGTH;
  strength = Math.max(0, Math.min(1, strength));
  // 기준선(첫 응답, 카드·툴팁 표시용): 서버 c.base 우선, 없으면 이 화면에서 본 최솟값(seen), 그것도 없으면 min(지금, 60k)
  const seen = new Map();

  // ── 상단 바: 게이지 알약(한도 게이지 앞). 누르면 설정 카드(신호 열화 켜기/끄기·세기) — 상단 바 폭을 늘리지 않으려고 카드에 넣었다 ──
  const top = document.getElementById('topbar');
  const gauge = document.createElement('div');
  gauge.id = 'ctx-gauge'; gauge.className = 'ctxg';
  const T = (k) => esc(tr(k));
  gauge.innerHTML = `<button type="button" class="ctxg-pill" aria-haspopup="true" aria-expanded="false"><span class="ctxg-name">${T('sound.ctx.pill')}</span><b class="ctxg-pct">—</b><span class="ctxg-who"></span><span class="ctxg-off" hidden>${T('sound.ctx.off')}</span><span class="ctxg-bar"><i></i></span></button>`
    + `<div class="ctxg-card" hidden><h4>${T('sound.ctx.card')} <small class="ctxg-cwho"></small></h4><p class="ctxg-cdet"></p>`
    + `<div class="ctxn"><button id="btn-noise" class="tb" type="button" title="${T('sound.ctx.noise.title')}">${T('sound.ctx.noise')}</button>`
    + `<label class="ctxn-amt"><span>${T('sound.ctx.amt')}</span><input id="noise-amt" type="range" min="0" max="1" step="0.05" aria-label="${T('sound.ctx.amt.aria')}"></label></div>`
    + '<ol class="ctxg-stages"></ol>'
    + '<p class="ctxg-note"></p></div>';
  const limEl = document.getElementById('limits');
  if (limEl && limEl.parentNode) limEl.parentNode.insertBefore(gauge, limEl); else top.appendChild(gauge);
  const pill = gauge.querySelector('.ctxg-pill');
  const card = gauge.querySelector('.ctxg-card');
  pill.addEventListener('click', (e) => { e.stopPropagation(); card.hidden = !card.hidden; pill.setAttribute('aria-expanded', String(!card.hidden)); if (!card.hidden) lastUi = 0; });
  document.addEventListener('pointerdown', (e) => { if (!card.hidden && !gauge.contains(e.target)) { card.hidden = true; pill.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !card.hidden) { card.hidden = true; pill.setAttribute('aria-expanded', 'false'); } });
  const btn = gauge.querySelector('#btn-noise');
  const amt = gauge.querySelector('#noise-amt');
  amt.value = String(strength);
  const label = () => {
    btn.setAttribute('aria-pressed', String(enabled));
    btn.textContent = tr(enabled ? 'sound.ctx.noise.on' : 'sound.ctx.noise.offBtn');
    amt.disabled = !enabled;
    gauge.querySelector('.ctxg-off').hidden = enabled;
  };
  label();
  btn.addEventListener('click', () => { enabled = !enabled; lsSet('ccviz.noise', enabled ? 'on' : 'off'); label(); if (!enabled) { book.clear(); bursts.clear(); noise.setActive(false); } });
  amt.addEventListener('input', () => { strength = Number(amt.value) || 0; lsSet('ccviz.noiseAmt', String(strength)); });
  // 단계표(창 대비 %)
  gauge.querySelector('.ctxg-stages').innerHTML = stageTable().map((x) => `<li><b>${esc(x.at)}</b> ${esc(x.name)}</li>`).join('');
  gauge.querySelector('.ctxg-note').textContent = tr('sound.ctx.note');

  // ── 툴팁·권장 문구 ──
  const tip = document.createElement('div'); tip.id = 'ctx-tip'; tip.hidden = true; document.body.appendChild(tip);
  const banner = document.createElement('div'); banner.id = 'ctx-banner'; banner.hidden = true; banner.setAttribute('role', 'status'); document.body.appendChild(banner);
  const tags = []; // 전체 보기 섬별 권장 문구
  const stage = document.getElementById('stage');
  function tagAt(i) {
    while (tags.length <= i) { const t = document.createElement('div'); t.className = 'ctx-tag'; t.hidden = true; stage.appendChild(t); tags.push(t); }
    return tags[i];
  }

  // three 셰이더(noise.js)를 불러오기 전·2D 화면에서 쓰는 빈 자리(같은 모양, 그리기 없음)
  let noise = { view: null, targets: { full: true, list: [], mains: [] }, amp: 1, ampGrain: 1, motion: 1, active: false, renders: 0,
    attach() {}, detach() {}, setActive(on) { this.active = !!on; } };
  let noiseLoad = null;
  function ensureNoise() {
    if (noiseLoad) return;
    noiseLoad = import('./noise.js').then((m) => { const n = new m.SignalNoise(); n.setActive(noise.active); noise = n; })
      .catch((e) => console.warn('신호 열화 모듈 로드 실패', e));
  }
  let flatView = null, lastFlat = 0; // 2D 표현으로 바뀐 것을 한 번만 처리 · 2D 갱신 간격
  const book = new PurgeBook();
  const bursts = new BurstBook();   // 문턱 버스트(세션 키 'full' | 's:<id>')
  const glitch = new TextGlitch();  // 글자 깨짐(HTML 라벨·실황)
  const flatFx = new FlatDegrade(); // 2D 열화
  flatFx.getBurst = (key, nowMs) => (key ? bursts.get(key, nowMs) : 0);
  const panelEl = document.getElementById('stream');
  const mains = [];                 // 셰이더 메인 대상(재사용) [{x,y,r,D,ax,ay,bx,by,id,lx,ly}]
  const lag = new Map();            // 메인 id → {lx, ly} 화면 자리 0.2초 늦은 값
  const go = { ax: 0, ay: 0, bx: 0, by: 0, stutter: false };
  let lastDegMap = 0, degT = 0;
  const audio = music ? new NoiseAudio(music) : null;
  const disp = new Map();          // key → 화면에 쓰는 L(부드럽게 따라감)
  const bounds = new Map();        // rootSessionId → {c:Vector3, r}
  let boundsAt = 0;
  const v3 = { x: 0, y: 0, z: 0 }, v4 = { x: 0, y: 0, z: 0 }, right = { x: 0, y: 0, z: 0 };
  const size = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; }, floor() { this.x = Math.floor(this.x); this.y = Math.floor(this.y); return this; } }; // renderer.getDrawingBufferSize 가 set(…).floor() 를 부름(THREE.Vector2 모양)
  let lastT = performance.now(), lastUi = 0, gaugeId = null;
  const stat = { mode: 'off', regions: 0, maxPct: 0, maxLevel: 0, purges: 0, bursts: 0, mains: 0, burstSfx: 0 };

  function nodeCtx(id) { const n = id && store.nodes.get(id); return n && n.meta && n.meta.ctx ? n.meta.ctx : null; }

  function smooth(key, target, dt) {
    let L = disp.get(key);
    if (L == null || reduced) L = target;
    else L += (target - L) * Math.min(1, dt * 2.5);
    disp.set(key, L);
    return L;
  }

  function computeBounds(view) {
    bounds.clear();
    const acc = new Map();
    for (const [id, v] of view.vis) {
      const rs = v.node && v.node.rootSessionId;
      if (!rs || v.hidden || !v.target) continue;
      let a = acc.get(rs);
      if (!a) { a = []; acc.set(rs, a); }
      a.push(v);
    }
    for (const [rs, list] of acc) {
      const c = { x: 0, y: 0, z: 0 };
      for (const v of list) { c.x += v.target.x; c.y += v.target.y; c.z += v.target.z; }
      c.x /= list.length; c.y /= list.length; c.z /= list.length;
      let r = 2;
      for (const v of list) r = Math.max(r, Math.hypot(c.x - v.target.x, c.y - v.target.y, c.z - v.target.z) + (v.r || 1) + 0.8);
      bounds.set(rs, { c, r });
    }
  }

  /** p 에 4×4 행렬(열 우선 elements) 적용 + 원근 나눔 — THREE.Vector3.applyMatrix4 와 같은 식 */
  function apply4(o, e) {
    const x = o.x, y = o.y, z = o.z;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    o.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    o.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    o.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return o;
  }
  /** Vector3.project(camera) 와 같은 값(three 없이) */
  function proj(o, cam) { return apply4(apply4(o, cam.matrixWorldInverse.elements), cam.projectionMatrix.elements); }
  /** 화면(px, 아래가 0) 투영. 카메라 뒤면 null. 2D 표현은 view.projectNdc 가 같은 모양을 준다 */
  function project(view, c, r, W, H, minR = 70 * (window.devicePixelRatio || 1)) {
    if (view.flat) return view.projectNdc(c, r, W, H);
    const cam = view.camera;
    v3.x = c.x; v3.y = c.y; v3.z = c.z; proj(v3, cam);
    if (v3.z > 1 || v3.z < -1) return null;
    const m = cam.matrixWorld.elements, rl = Math.hypot(m[0], m[1], m[2]) || 1;
    right.x = m[0] / rl; right.y = m[1] / rl; right.z = m[2] / rl;
    v4.x = c.x + right.x * r; v4.y = c.y + right.y * r; v4.z = c.z + right.z * r; proj(v4, cam);
    const x = (v3.x * 0.5 + 0.5) * W, y = (v3.y * 0.5 + 0.5) * H;
    const rx = Math.abs((v4.x - v3.x) * 0.5 * W);
    return { x, y, r: Math.max(rx * 1.1, minR), ndcX: v3.x, ndcY: v3.y };
  }

  /** 노드 → 세션 키·열화 세기 D 지도(0.25초마다). 렌더러는 degOf(id) 로 읽는다 */
  function rebuildDegMap(st) {
    DEG.base.clear(); DEG.sessOf.clear();
    const on = enabled && strength > 0;
    if (!on) return;
    if (!st.streamAll) {
      const D = degScaled(levelOf(nodeCtx(store.root)), strength);
      if (D <= 0) return;
      for (const id of store.nodes.keys()) { DEG.base.set(id, D); DEG.sessOf.set(id, 'full'); }
      return;
    }
    const sd = new Map();
    for (const r of store.roots || []) { const id = 's:' + r.sessionId; const D = degScaled(levelOf(nodeCtx(id)), strength); if (D > 0) sd.set(r.sessionId, D); }
    if (!sd.size) return;
    for (const [id, n] of store.nodes) {
      const rs = n.rootSessionId || (id.startsWith('s:') ? id.slice(2) : null);
      const D = rs && sd.get(rs);
      if (D) { DEG.base.set(id, D); DEG.sessOf.set(id, 's:' + rs); }
    }
  }

  /** 노드 지금 자리(세계) — 3D 는 group.position, 2D 는 pos, 복셀은 target */
  function nodePos(view, id) {
    const v = view.vis && view.vis.get(id);
    if (!v) return null;
    return v.group ? v.group.position : v.pos || v.target || null;
  }

  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    let dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    const view = getView();
    if (!view || !view.renderer) return;
    const st = getState();
    // 열화 시계(일시정지·움직임 줄이기면 멈춤) · 세션 지도 · 버스트 — 2D 의 4Hz 간격과 무관하게 매 프레임
    if (!(reduced || st.paused)) degT = (degT + dt) % 600;
    DEG.t = degT; DEG.reduced = reduced;
    if (now - lastDegMap > 250) { lastDegMap = now; rebuildDegMap(st); }
    DEG.burst.clear();
    if (bursts.size) for (const k of bursts.m.keys()) { const b = bursts.get(k, now); if (b > 0) DEG.burst.set(k, b); }
    DEG.on = enabled && strength > 0 && (DEG.base.size > 0 || DEG.burst.size > 0);
    glitch.tick(now, { view, store, panelEl, paused: !!st.paused });
    if (view.flat) {
      // 2D 화면: 셰이더 대신 캔버스 덧그림(flat-degrade.js). 대상 계산은 저사양용이라 4Hz(무대 크기 읽기의 강제 레이아웃 줄임), 그리기는 2D 루프가
      if (noise.view) noise.detach();
      if (flatView !== view) { if (flatView) flatView.degradeFx = null; flatView = view; disp.clear(); bounds.clear(); boundsAt = 0; lastFlat = 0; }
      if (view.degradeFx !== flatFx) view.degradeFx = flatFx;
      if (now - lastFlat < 250) return;
      dt = Math.min(0.5, (now - (lastFlat || now)) / 1000);
      lastFlat = now;
    } else {
      if (flatView) { flatView.degradeFx = null; flatView = null; }
      ensureNoise();
      if (noise.view !== view) { noise.attach(view); disp.clear(); bounds.clear(); boundsAt = 0; }
    }
    noise.amp = strength * 2 * (st.streamAll ? 1.35 : 1);
    noise.ampGrain = strength * 2; // 전체 보기 섬은 작으므로 국소 효과를 조금 더 세게
    noise.motion = reduced || st.paused ? 0 : 1; // 일시정지 중엔 노이즈도 멈춘 화면
    const list = [];
    const fRegions = flatFx.regions; fRegions.length = 0;
    let full = true;
    let bannerC = null;
    const shown = [];
    let mainN = 0;
    if (!view.flat) view.renderer.getDrawingBufferSize(size);
    const W0 = view.flat ? view.canvas.width : size.x, H0 = view.flat ? view.canvas.height : size.y;
    const dpr = window.devicePixelRatio || 1;
    /** 메인 노드 잔상 대상 하나(3D 셰이더용 화면 px·오프셋, 2D 는 id·D 만 — 자리는 2D 가 그릴 때 잰다) */
    const addMain = (id, sessKey) => {
      if (!id || mainN >= MAX_REGIONS || !enabled) return;
      const D = Math.min(1, (DEG.base.get(id) || 0) + (DEG.burst.get(sessKey) || 0) * 0.9);
      if (D <= 0.01) return;
      if (view.flat) { const m = mains[mainN] || (mains[mainN] = {}); m.id = id; m.D = D; m.seed = 0; mainN++; return; }
      const c = nodePos(view, id);
      if (!c) return;
      const vr = (view.nodeRadius ? view.nodeRadius(id) : (view.vis.get(id) || {}).r) || 1;
      const p = project(view, c, vr * 1.25, W0, H0, 26 * dpr);
      if (!p) return;
      const m = mains[mainN] || (mains[mainN] = {});
      let lg = lag.get(id);
      if (!lg) { lg = { lx: p.x, ly: p.y }; lag.set(id, lg); }
      const k = reduced ? 1 : Math.min(1, dt / 0.2);
      lg.lx += (p.x - lg.lx) * k; lg.ly += (p.y - lg.ly) * k;
      ghostOffsets(D, degT, seedOf(id), reduced || st.paused, go);
      m.id = id; m.D = D; m.x = p.x; m.y = p.y; m.r = Math.min(220 * dpr, Math.max(26 * dpr, p.r * 1.5));
      m.ax = go.ax * dpr; m.ay = go.ay * dpr;
      m.bx = go.bx * dpr + (lg.lx - p.x) * 0.9; m.by = go.by * dpr + (lg.ly - p.y) * 0.9;
      mainN++;
    };
    if (!st.streamAll) {
      // 단일 세션: 루트(메인) 열화 수준으로 화면 전체
      const id = store.root;
      const c = nodeCtx(id);
      const pur = book.get('full', now) || (id ? book.get(id, now) : null);
      const bu = bursts.get('full', now);
      if (c || pur) {
        const lv = c ? levelOf(c) : 0;
        const L = smooth('full', lv / 100, dt);
        const purge = pur ? { p: pur.p, oldL: pur.oldL } : null;
        list.push({ x: 0, y: 0, r: 1, L, burst: bu, purge, pct: c ? c.pct : 0, lv });
        fRegions.push({ key: 'full', c: null, r: 1, L, burstKey: 'full', purge });
        if (c && lv >= RECOMMEND_PCT) bannerC = c;
      }
      addMain(id, 'full');
    } else {
      // 전체 보기: 세션(섬)마다 그 메인 열화 수준으로 국소적으로
      full = false;
      if (now - boundsAt > 300) { computeBounds(view); boundsAt = now; }
      const ents = [];
      for (const r of store.roots || []) {
        const id = 's:' + r.sessionId;
        const c = nodeCtx(id);
        const pur = book.get(id, now);
        if (!c && !pur) continue;
        ents.push({ id, sid: r.sessionId, pct: c ? levelOf(c) : 0, c, purging: pur ? 1 : 0, pur });
      }
      const ranked = enabled ? rankRegions(ents, MAX_REGIONS) : [];
      for (const e of ranked) {
        const b = bounds.get(e.sid) || (view.has(e.id) && view.nodeTarget(e.id) ? { c: view.nodeTarget(e.id), r: 6 } : null);
        if (!b) continue;
        const p = project(view, b.c, b.r, W0, H0);
        if (!p) continue;
        const L = smooth(e.id, e.pct / 100, dt);
        const bu = bursts.get(e.id, now);
        const purge = e.pur ? { p: e.pur.p, oldL: e.pur.oldL } : null;
        list.push({ x: p.x, y: p.y, r: p.r, L, burst: bu, purge, pct: e.c ? e.c.pct : 0, lv: e.pct });
        fRegions.push({ key: e.id, c: b.c, r: b.r, L, burstKey: e.id, purge });
        if (e.pct >= RECOMMEND_PCT) shown.push({ p, c: e.c, lv: e.pct, id: e.id });
        addMain(e.id, e.id);
      }
    }
    mains.length = mainN;
    if (lag.size > 24) lag.clear();
    noise.targets.full = full;
    noise.targets.list = list;
    noise.targets.mains = view.flat ? [] : mains;
    const need = enabled && strength > 0
      && (noiseNeeded(list.map((t) => t.L * 100), { enabled, strength, purging: list.some((t) => t.purge) }) || mainN > 0 || list.some((t) => t.burst > 0));
    noise.setActive(need && !view.flat);
    // 2D: 같은 은유를 캔버스로(대상 없으면 비움 → 2D 루프 쉼)
    flatFx.full = full; flatFx.amp = noise.amp; flatFx.ampG = noise.ampGrain; flatFx.motion = noise.motion;
    flatFx.mains = view.flat && need ? mains : [];
    if (!(view.flat && need)) fRegions.length = 0;
    flatFx.level = !need ? 0 : bursts.any(now) ? 2 : reduced || st.paused ? 0 : 1;
    if (view.flat && need && (reduced || st.paused) && view.invalidate) view.invalidate(); // 정지 화면이어도 4Hz 로 한 번씩 반영
    stat.mode = need ? (full ? 'full' : 'regions') : 'off';
    stat.regions = list.length; stat.mains = mainN;
    stat.maxPct = list.reduce((m, t) => Math.max(m, t.pct || 0), 0);
    stat.maxLevel = list.reduce((m, t) => Math.max(m, t.lv || 0), 0);

    // 권장 문구: 화면 전체면 띠 하나, 전체 보기면 섬 위마다
    const showBanner = enabled && need && bannerC != null;
    banner.hidden = !showBanner;
    if (showBanner) { const txt = tr('sound.ctx.recommend', { what: recText(bannerC, false) }); if (banner.textContent !== txt) banner.textContent = txt; banner.classList.toggle('still', reduced); }
    const cw = stage.clientWidth, chh = stage.clientHeight;
    let ti = 0;
    const placedTags = []; // 같은 섬 메인 여럿이면 권장 문구가 겹칠 수 있다 — 겹치면 앞(높은 사용률) 것만
    if (enabled && need) for (const s of shown.sort((a, b) => b.lv - a.lv)) {
      const x = (s.p.ndcX * 0.5 + 0.5) * cw, y = (-s.p.ndcY * 0.5 + 0.5) * chh;
      const rCss = s.p.r / (window.devicePixelRatio || 1);
      const ty = Math.max(8, y - rCss * 0.75);
      if (placedTags.some((q) => Math.abs(q.x - x) < 170 && Math.abs(q.y - ty) < 26)) continue;
      placedTags.push({ x, y: ty });
      const t = tagAt(ti++);
      t.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(8, y - rCss * 0.75))}px) translate(-50%, -100%)`;
      const txt = tr('sound.ctx.recommend', { what: recText(s.c, true) });
      if (t.textContent !== txt) t.textContent = txt;
      t.classList.toggle('still', reduced);
      t.hidden = false;
    }
    for (; ti < tags.length; ti++) tags[ti].hidden = true;

    if (now - lastUi > 250) { lastUi = now; updateGauge(st); }
  }
  /** 권장 문구 숫자: 창 대비 % */
  function recText(c, short = false) {
    if (!c) return '';
    return short ? pctText(c.pct) : tr('sound.ctx.recPct', { pct: pctText(c.pct) });
  }

  function updateGauge(st) {
    const pick = pickGaugeNode({ nodes: store.nodes, focusId: st.focusId, root: store.root, streamAll: st.streamAll, sel: st.sel, roots: store.roots || [] });
    gaugeId = pick ? pick.id : null;
    const n = gaugeId ? store.nodes.get(gaugeId) : null;
    const c = n && n.meta && n.meta.ctx;
    if (!c) {
      pill.className = 'ctxg-pill lv-none';
      pill.querySelector('.ctxg-pct').textContent = '—';
      pill.querySelector('.ctxg-who').textContent = '';
      pill.querySelector('.ctxg-bar i').style.width = '0';
      pill.title = tr('sound.ctx.pill.none');
      if (!card.hidden) { gauge.querySelector('.ctxg-cwho').textContent = ''; gauge.querySelector('.ctxg-cdet').textContent = tr('sound.ctx.card.none'); }
    }
    if (c) {
      const lv = gaugeLevel(c.pct);
      pill.className = 'ctxg-pill lv-' + lv + (c.estimated ? ' est' : '');
      const pctEl = pill.querySelector('.ctxg-pct');
      const txt = pctText(c.pct) + (c.estimated ? '?' : '');
      if (pctEl.textContent !== txt) pctEl.textContent = txt;
      const who = pick.why === 'max' ? tr('sound.ctx.who.max') : SESSION_KINDS.has(n.kind) && !n.parentId ? tr('sound.ctx.who.main') : (n.label || '').slice(0, 10);
      const whoEl = pill.querySelector('.ctxg-who');
      if (whoEl.textContent !== who) whoEl.textContent = who;
      pill.querySelector('.ctxg-bar i').style.width = Math.min(100, c.pct) + '%';
      const title = ctxTitle(c, (pick.why === 'max' ? tr('sound.ctx.highest') : '') + (n.label || n.id), levelOf(c), RECOMMEND_PCT) + '\n'
        + tr(enabled ? 'sound.ctx.pill.stateOn' : 'sound.ctx.pill.stateOff');
      if (pill.title !== title) pill.title = title;
      if (!card.hidden) { gauge.querySelector('.ctxg-cwho').textContent = (n.label || n.id).slice(0, 40); gauge.querySelector('.ctxg-cdet').textContent = ctxTitle(c, '', levelOf(c), RECOMMEND_PCT).split(NL).slice(0, 4).join(NL) + NL + baseLine(c, gaugeId); }
    }
    // 소리: 게이지가 보여 주는 세션 기준
    if (audio) {
      const p = noiseParams(c ? levelOf(c) : 0, strength); // 열화 수준(창 대비 %)
      let musicOn = false, sfxOn = false;
      try { musicOn = !!music.on; } catch (e) {}
      try { sfxOn = !!(sfx && sfx.enabled); } catch (e) {}
      audio.update({ lowpassHz: p.lowpassHz, hum: p.hum, musicOn, sfxOn, enabled: enabled && strength > 0 });
    }
  }

  /** 카드·툴팁 한 줄: 시작(기준선) · 늘어난 양 */
  function baseLine(c, id) {
    const sv = id != null ? seen.get(id) : null;
    const known = c.base != null || sv != null;
    return tr(known ? 'sound.ctx.baseLine' : 'sound.ctx.baseLine.est', { base: fmtTokens(baseOf(c, sv)), grown: fmtTokens(grownOf(c, sv)) });
  }

  /** node-update(meta.ctx) 병합 전에 부른다 */
  function noteCtx(ev, prevNode, { quiet = false } = {}) {
    const next = ev.patch && ev.patch.meta && ev.patch.meta.ctx;
    if (!next) return null;
    const prev = prevNode && prevNode.meta ? prevNode.meta.ctx : null;
    let note = ctxNote(prev, next);
    // 정화(급락)·버스트는 열화 수준으로 판정(패널 메모의 50·70·90 은 게이지 % 그대로)
    const nid = (prevNode && prevNode.id) || ev.nodeId;
    const l0 = prev ? levelOf(prev) : null;
    // 기준선 장부: 처음 값이면 그 값, 아니면 지금까지의 기준선과 새 값 중 작은 것(compact 뒤 더 작아지면 낮춤)
    seen.set(nid, prev ? Math.min(baseOf(prev, seen.get(nid)), Number(next.used) || 0) : Number(next.used) || 0);
    const l1 = levelOf(next);
    const dropL = prev ? isCtxDrop({ pct: l0 }, { pct: l1 }) : false;
    if (dropL && (!note || note.kind !== 'drop')) note = { kind: 'drop', from: prev.pct, to: next.pct };
    if (note) ev.ctxNote = note;
    if (!prevNode) return note;
    const st = getState();
    const isRootish = SESSION_KINDS.has(prevNode.kind);
    const key = !st.streamAll ? (prevNode.id === store.root ? 'full' : null) : isRootish && !prevNode.parentId ? prevNode.id : null;
    if (!key) return note;
    if (dropL && !quiet && enabled && !reduced) { book.start(key, l0 / 100); disp.set(key, l1 / 100); stat.purges++; }
    // 문턱 버스트: 단계가 오르는 순간 0.5초 강한 글리치 + 짧은 지직(효과음 켜졌을 때만). 스크럽·quiet·재생 seek·움직임 줄이기는 생략
    const cross = stageCross(l0, l1);
    if (!dropL && burstWanted(cross, { quiet, reduced, enabled, strength }) && bursts.start(key, performance.now())) {
      stat.bursts++;
      try { if (sfx && sfx.enabled && sfx.play('glitch', { priority: 1 })) stat.burstSfx++; } catch (e) { /* 소리 없음 */ }
    }
    return note;
  }

  function hover(id, e) {
    const c = nodeCtx(id);
    if (!c || !e) { tip.hidden = true; return; }
    const n = store.nodes.get(id);
    const lv = levelOf(c);
    const st = STAGES[stageOf(lv)];
    const sub = n ? nodeSubtitle(n) : ''; // 노드 이름 + 자동 제목 부제
    const who = n ? `<span class="ctx-tip-who">${esc(n.label || id)}${sub ? `<i>${esc(sub)}</i>` : ''}</span>` : '';
    tip.innerHTML = `${who}<b class="lv-${gaugeLevel(c.pct)}">${esc(tr('sound.ctx.tip', { v: ctxShort(c) }))}</b><small>${esc(st.name)}${c.estimated ? esc(tr('sound.ctx.tip.est')) : ''}${lv >= RECOMMEND_PCT ? esc(tr('sound.ctx.tip.rec')) : ''}</small>`;
    tip.title = ctxTitle(c, n && n.label, lv, RECOMMEND_PCT) + NL + baseLine(c, id);
    tip.style.transform = `translate(${Math.round(e.clientX + 14)}px, ${Math.round(e.clientY + 16)}px)`;
    tip.hidden = false;
  }

  requestAnimationFrame(frame);
  const api = {
    noteCtx, hover,
    get enabled() { return enabled; }, get strength() { return strength; }, get reduced() { return reduced; },
    setEnabled(on) { if (!!on !== enabled) btn.click(); },
    setStrength(v) { amt.value = String(v); amt.dispatchEvent(new Event('input')); },
    setReduced(on) { reduced = !!on; document.body.classList.toggle('ccv-still', reduced); },
    /** 시험: 세션 키('full'|'s:<id>')에 버스트를 바로 건다(문턱 넘김과 같은 연출) */
    burst(key = 'full') { if (bursts.start(key, performance.now())) { stat.bursts++; return true; } return false; },
    get stat() { return { ...stat, renders: noise.renders, active: noise.active, humOn: audio ? audio.humOn : false, lowpassWired: audio ? audio.wired : false, deg: DEG.on, degNodes: DEG.base.size, glitch: { ...glitch.stat }, flatDraws: flatFx.draws }; },
    get gaugeId() { return gaugeId; },
    get noise() { return noise; }, book, flatFx, glitch,
  };
  window.__ccvizCtx = api;
  return api;
}

export { NOISE_MIN_PCT };
