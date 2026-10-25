// 배경음악: 곡 여러 개(assets/bgm-tracks.json)를 <audio> 두 개(A/B 덱)로 번갈아 튼다. 기본 꺼짐, 켜면 2초 페이드인.
// 켜고 끄는 버튼은 sound.mjs(소리 토글: 음악·효과음 함께)가 맡는다. 여기는 재생·볼륨·곡 선택·곡 구간·곡 전환만.
//   - 곡 선택기 #bgm-track 은 여기서 만들어 .sound 안 볼륨 슬라이더 뒤에 붙인다(상단 바 공용 — 3D·2D·세 표현 모두 같음)
//   - 선택: 자동(기본 — 활동 단계에 맞는 곡) | 곡 하나(loop) | 순환(곡 끝나면 다음 곡) | 무작위(다른 곡). localStorage 'ccviz.bgm.track'
//   - 자동: setActivitySource(fn) 의 지표를 2초마다 단계(bgm-auto.mjs activityLevel)로, AutoPicker 히스테리시스를 거쳐 곡을 바꾼다
//   - 곡 바꿈(순수 로직 bgm-xfade.mjs): 쉬던 덱에 새 곡을 처음부터 걸고 등전력 크로스페이드.
//       자동 단계 전환 = 마디 경계(최대 1마디 대기) → 4.5초 페이드아웃, 1.5초 뒤 새 곡 4.5초 페이드인(겹침 3초)
//       수동 선택 = 1.5초 크로스페이드 · 곡 끝 = 끝 3초 전에 다음 곡을 미리 시작해 3초 겹침
//       전환 도중 또 바뀌면 지금 값에서 이어 감(되돌아가기·새 곡 바꿔 걸기·세 번째 곡은 나가던 덱이 조용해진 뒤)
//   - 소리 경로: AudioContext 가 돌고 있으면 덱마다 MediaElementSource → 덱 GainNode → 공용 버스(켜기·끄기 페이드) → 볼륨 GainNode
//       → [신호 열화 필터(ctx-ui NoiseAudio 가 setInsert 로 끼움)] → 출력. 컨텍스트가 없거나 아직 멈춰 있으면 같은 곡선을 요소 volume 으로
//   - 다 꺼진 덱은 pause() 만 하고 src·노드는 그대로 두어 다음 전환에 다시 쓴다(요소·노드는 덱 두 개분만 만든다)
//   - 매니페스트가 없으면 예전 한 곡(bgm.mp3·bgm.json)으로 동작

import { TRACK_KEY, LAST_KEY, MIG_KEY, FALLBACK_TRACKS, parseManifest, normalizeSel, initialSel, isMode, firstTrack, nextTrack, loopFor, optionList, modeLabel, stageLabel, sectionName } from './bgm-core.mjs';
import { AutoPicker, activityLevel, pickForLevel, autoLabel, LEVEL_LABEL } from './bgm-auto.mjs';
import { t as tr } from './i18n.mjs';
import { Lane, planXfade, shouldLeadEnd, takeover, XFADE, TAKEOVER_OUT, READY_TIMEOUT, SILENT } from './bgm-xfade.mjs';

const KEY = 'ccviz.music';
const FADE_IN = 2, FADE_STOP = 0.6, FADE_HOLD = 0.4, FADE_RESUME = 1.2; // 공용 버스(켜기·끄기·일시정지) 초
const AUTO_TICK_MS = 2000;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const perfNow = () => performance.now() / 1000;
const sleep = (s) => new Promise((r) => setTimeout(r, Math.max(0, s) * 1000));

const CSS = `
#bgm-track { height: 30px; max-width: 150px; border-radius: 6px; padding: 0 2px; background: var(--chip-bg); border: 1px solid var(--border); }
#bgm-track:disabled { opacity: .5; }
@media (max-width: 719px) { #bgm-track { max-width: 116px; } }
`;

export class Music {
  constructor() {
    const a = document.getElementById('bgm');
    // 두 번째 덱: 첫 덱 바로 뒤에 같은 속성으로(index.html 은 그대로)
    const b = document.createElement('audio');
    b.id = 'bgm-b';
    b.preload = 'none';
    a.after(b);
    this.decks = [a, b].map((el) => ({ el, lane: new Lane(0, 'eq'), gain: null, src: null, leadDone: false }));
    this.decks[0].lane.snap(1);
    this.active = 0;          // 지금 곡 덱(구간 표시·ended·끝 미리 넘기기 기준)
    this.master = new Lane(0, 'lin'); // 켜기·끄기·일시정지 페이드(덱 크로스페이드와 따로)
    this.vol = document.getElementById('vol');
    this.secEl = document.getElementById('music-sec');
    this.on = false;
    this.available = false;
    this.meta = null;
    this.volume = 0.35;
    this.wantOn = false;      // 소리 토글이 켜 둔 상태(파일 확인 전이면 확인 뒤 재생). sound.mjs 가 정한다
    this.loading = false;     // play() 가 버퍼링을 기다리는 중
    this.onChange = null;     // 상태가 바뀌면 부름(소리 토글 문구 갱신)
    this.onAvailable = null;  // 파일 확인이 끝나면 부름
    this.routeCtx = null;     // 음악이 지나가는 AudioContext(ctx-ui NoiseAudio 와 공용, sound.mjs 가 복원 때 resume)
    this.tracks = FALLBACK_TRACKS;
    this.def = 'ambient';
    this.sectionsEn = null;   // 구간 이름 영어 표(매니페스트 sections_en)
    this.sel = null;          // 선택값: 'auto' | 곡 id | 'cycle' | 'shuffle'
    this.cur = null;          // 지금 걸린 곡 id(전환 중이면 들어오는 곡)
    this._metaCache = new Map();
    this._switchId = 0;
    this._xf = null;          // 진행 중 전환 {sid, from, to, fromId, toId, kind, started, plan}
    this._queued = null;      // 세 번째 곡: 나가던 덱이 조용해지면 시작 {id, kind}
    this._graph = null;       // {ctx, bus, volNode, out}
    this._mDone = null;       // 버스 페이드가 끝나면 부를 것
    this._log = [];           // 시험용 전환 기록
    // 자동 선곡: 단계 시계는 시각화 일시정지 동안 멈춘다(_autoT), 탭이 쉬던 시간은 한 번에 5초까지만 센다
    this.picker = new AutoPicker();
    this.autoLevel = null;
    this.metrics = null;
    this._activity = null;
    this._autoT = 0;
    this._autoLast = performance.now();
    this._autoWant = null;
    this._recent = [];        // 최근 건 곡 id(오래된 것 → 최근, 자동이 직전 2곡을 피함)
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && typeof s.volume === 'number') this.volume = Math.max(0, Math.min(1, s.volume));
    } catch (e) {}
    this.vol.value = String(this.volume);
    this.vol.disabled = true;
    this.vol.addEventListener('input', () => {
      this.volume = Number(this.vol.value);
      if (this._graph) this._graph.volNode.gain.setTargetAtTime(this.volume, this._graph.ctx.currentTime, 0.03);
      else this._renderEl();
      this._save();
    });
    this._mountSelect();
    this.decks.forEach((d, i) => {
      d.el.volume = 0;
      d.el.addEventListener('ended', () => { if (i === this.active) this._onEnded(); });
    });
    this._probe();
  }

  /** 지금 곡 덱의 <audio>(sound.mjs 가 paused 를 본다) */
  get audio() { return this.decks[this.active].el; }

  _mountSelect() {
    if (!document.getElementById('bgm-track-css')) {
      const st = document.createElement('style');
      st.id = 'bgm-track-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const s = document.createElement('select');
    s.id = 'bgm-track';
    s.setAttribute('aria-label', tr('sound.sel.aria'));
    s.title = tr('sound.sel.aria');
    s.disabled = true;
    s.addEventListener('change', () => this.select(s.value));
    // 볼륨 슬라이더 바로 뒤(.sound 묶음 안). 좁은 화면에서 슬라이더가 숨어도 선택기는 남는다
    if (this.vol && this.vol.parentNode) this.vol.parentNode.insertBefore(s, this.vol.nextSibling);
    this.selEl = s;
  }

  _renderSelect() {
    const s = this.selEl;
    if (!s) return;
    const opts = optionList(this.tracks);
    if (s.options.length !== opts.length || [...s.options].some((o, i) => o.value !== opts[i].value)) {
      s.textContent = '';
      let grp = null; // 단계별 묶음(optgroup)
      for (const o of opts) {
        const el = document.createElement('option');
        el.value = o.value; el.textContent = o.text; el.title = o.title;
        if (o.group) {
          if (!grp || grp.label !== o.group) { grp = document.createElement('optgroup'); grp.label = o.group; s.appendChild(grp); }
          grp.appendChild(el);
        } else { grp = null; s.appendChild(el); }
      }
    }
    if (this.sel != null) s.value = this.sel;
    s.disabled = !this.available;
    const t = this.track();
    // 자동이면 '자동' 항목 문구에 지금 곡·단계: 자동 · 재즈(보통)
    const ao = [...s.options].find((o) => o.value === 'auto');
    const auto = this.sel === 'auto';
    if (ao) ao.textContent = auto && t && this.autoLevel != null ? autoLabel(t, this.autoLevel) : modeLabel('auto');
    const now = t ? tr('sound.sel.now', { title: `${t.title}${t.bpm ? ` · ${t.bpm} BPM` : ''}${t.key ? ` · ${t.key}` : ''}` }) : '';
    const lv = auto && this.autoLevel != null ? tr('sound.sel.autoLevel', { level: stageLabel(this.autoLevel) }) : '';
    s.title = this.available ? [tr('sound.sel.aria'), now, lv].filter(Boolean).join(' — ') : tr('sound.noFiles');
  }

  async _probe() {
    let ok = false;
    try {
      const r = await fetch('assets/bgm-tracks.json', { cache: 'no-cache' });
      if (r.ok) {
        const m = parseManifest(await r.json());
        if (m) { this.tracks = m.tracks; this.def = m.def; this.sectionsEn = m.sectionsEn; ok = true; }
      }
    } catch (e) {}
    if (!ok) {
      // 예전 한 곡
      try {
        const r = await fetch('assets/bgm.json', { cache: 'no-cache' });
        if (r.ok) { this._metaCache.set('ambient', await r.json()); ok = true; }
      } catch (e) {}
      if (!ok) {
        try {
          const r = await fetch('assets/bgm.mp3', { headers: { Range: 'bytes=0-1' } });
          ok = r.ok || r.status === 206;
          try { r.body && r.body.cancel(); } catch (e) {}
        } catch (e) {}
      }
    }
    this.available = ok;
    this.vol.disabled = !ok;
    this.vol.title = ok ? tr('sound.vol.title') : tr('sound.vol.none');
    const ini = initialSel(lsGet(TRACK_KEY), lsGet(MIG_KEY) === '2', this.tracks); // 이행: 없음·예전 기본 로파이 → 자동
    this.sel = ini.sel;
    if (ini.write) { lsSet(TRACK_KEY, this.sel); lsSet(MIG_KEY, '2'); }
    this._probed = true;
    if (ok) {
      this.decks.forEach((d, i) => d.el.addEventListener('timeupdate', () => { if (i === this.active) this._onTime(); }));
      if (this.sel === 'auto') this._autoTick(true);
      // 외부(Worker·터널) 경유는 4.8MB 를 받는 데 시간이 걸리므로, 켜 둔 사용자라면 미리 받아 둔다
      this._coldLoad(this._firstId(), this.wantOn ? 'auto' : 'metadata');
    }
    this._renderSelect();
    if (this.onAvailable) this.onAvailable(ok);
  }

  _firstId() {
    if (this.sel === 'auto' && this.autoLevel != null) return pickForLevel(this.autoLevel, this.tracks, { recent: this._recent });
    return firstTrack(this.sel, this.tracks, lsGet(LAST_KEY), this.def);
  }

  /** 활동 지표 출처: fn → {events, tools, spawns, working, windowMs}(bgm-auto.mjs ActivityMeter.sample), isHeld → 시각화 일시정지. app.js 가 건다 */
  setActivitySource(fn, isHeld = null) {
    this._activity = typeof fn === 'function' ? fn : null;
    if (typeof isHeld === 'function') this._isHeld = isHeld; // 시각화 일시정지 여부(소리가 꺼져 있어도 단계 시계를 멈추려고)
    if (!this._autoTimer && this._activity) this._autoTimer = setInterval(() => this._autoTick(), AUTO_TICK_MS);
    this._autoTick(true);
  }

  /** 시험용: 히스테리시스 시간 바꾸기({up, down, minHold} 밀리초) */
  autoTune(timing) { this.picker.timing = { ...this.picker.timing, ...timing }; }

  /** 단계 갱신 → 자동이면 그 단계 곡으로. 일시정지 중엔 단계 시계·전환 모두 멈춤 */
  _autoTick(first = false) {
    const now = performance.now();
    const dt = now - this._autoLast;
    this._autoLast = now;
    if (!this._activity) return;
    if ((this.paused || (this._isHeld && this._isHeld())) && !first) return;
    if (!first) this._autoT += Math.max(0, Math.min(dt, 5000));
    let m = null;
    try { m = this._activity(); } catch (e) { return; }
    this.metrics = m;
    const prev = this.autoLevel;
    this.autoLevel = this.picker.step(activityLevel(m), this._autoT);
    if (this.sel !== 'auto' || !this._probed || !this.available) { if (prev !== this.autoLevel) this._renderSelect(); return; }
    if (this.loading) { if (prev !== this.autoLevel) this._renderSelect(); return; } // 켜는 중(play 대기)에 src 를 바꾸면 play() 가 AbortError — 다음 틱에
    // 지금 곡이 새 단계 후보에 있으면 그대로(여러 단계 겸용 곡), 없으면 그 단계 곡 중 직전 2곡을 피해 무작위
    const want = this._autoWant ? null : pickForLevel(this.autoLevel, this.tracks, { recent: this._recent, cur: this.cur, keep: true });
    if (want && want !== this.cur) { this._autoWant = want; this._switchTo(want, { kind: 'auto' }); }
    else if (prev !== this.autoLevel) this._renderSelect();
  }

  /** 지금 곡(매니페스트 항목) */
  track() { return this.tracks.find((t) => t.id === this.cur) || null; }
  _trackOf(id) { return this.tracks.find((t) => t.id === id) || null; }

  /** 효과음 화음 맞춤용(sfx.mjs scaleNotes): 화음표가 같은 앰비언트일 때만 재생 위치, 다른 곡은 NaN(→ D 단조 5음) */
  harmonyTime() { return this.cur === 'ambient' && this.decks[this.active].id === 'ambient' ? this.audio.currentTime : NaN; }

  /** 시험·자동화용 상태 */
  state() {
    const xf = this._xf;
    return { sel: this.sel, cur: this.cur, loop: this.audio.loop, on: this.on, paused: !!this.paused, loading: this.loading,
      src: this.audio.getAttribute('src'), tracks: this.tracks.map((t) => t.id), section: this.secEl.textContent,
      recent: [...this._recent], active: this.active, graph: !!this._graph,
      decks: this.decks.map((d) => ({ id: d.id || null, src: d.el.getAttribute('src'), paused: d.el.paused, pos: d.el.currentTime })),
      xf: xf ? { kind: xf.kind, fromId: xf.fromId, toId: xf.toId, started: xf.started, plan: xf.plan } : null,
      queued: this._queued ? { ...this._queued } : null,
      auto: { level: this.autoLevel, label: this.autoLevel == null ? null : LEVEL_LABEL[this.autoLevel], raw: this.picker.raw, metrics: this.metrics, picker: this.picker.state(this._autoT) },
      selText: this.selEl && this.selEl.selectedOptions[0] ? this.selEl.selectedOptions[0].textContent : null };
  }

  /** 시험용: 지금 음량 — 모델 값과 실제 값(WebAudio 면 gain.value, 아니면 el.volume) */
  levels() {
    const now = this._now();
    const g = this._graph;
    return {
      t: now, perf: performance.now(), mode: g ? 'graph' : 'element', master: this.master.valueAt(now), volume: this.volume,
      masterActual: g ? g.bus.gain.value : null, volActual: g ? g.volNode.gain.value : null,
      decks: this.decks.map((d) => ({ id: d.id || null, model: d.lane.valueAt(now), actual: g ? d.gain.gain.value : d.el.volume, playing: !d.el.paused, pos: d.el.currentTime })),
      active: this.active, xf: this._xf ? { kind: this._xf.kind, started: this._xf.started, toId: this._xf.toId } : null, log: this._log.slice(-20),
    };
  }

  // ───────── 곡 정보 ─────────

  /** 지금 곡 표시(cur·최근·메타·저장)만 바꿈. 덱 src 는 부르는 쪽이 */
  _setCur(id) {
    const t = this._trackOf(id) || this.tracks[0];
    if (!t) return null;
    if (this.cur !== t.id) { this._recent.push(t.id); if (this._recent.length > 4) this._recent.shift(); }
    this.cur = t.id;
    this._autoWant = null;
    this.meta = this._metaCache.get(t.id) || null;
    if (!this.meta && t.meta) {
      const want = t.id;
      fetch('assets/' + t.meta, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((m) => {
        if (!m) return;
        this._metaCache.set(want, m);
        if (this.cur === want) { this.meta = m; this._section(); }
      }).catch(() => {});
    }
    this.secEl.textContent = '';
    lsSet(LAST_KEY, t.id);
    this._renderSelect();
    return t;
  }

  /** 덱에 곡을 건다(처음부터). 이미 그 곡이면 src 는 그대로 두고 위치만 0 */
  _deckLoad(i, id, preload) {
    const d = this.decks[i];
    const t = this._trackOf(id) || this.tracks[0];
    if (!t) return;
    d.id = t.id;
    d.leadDone = false;
    d.el.loop = loopFor(this.sel);
    if (preload) d.el.preload = preload;
    const src = 'assets/' + t.file;
    if (d.el.getAttribute('src') !== src) d.el.src = src;
    else { try { d.el.currentTime = 0; } catch (e) {} }
  }

  /** 재생 중이 아닐 때: 지금 덱에 바로 걸어 둠(꺼짐·일시정지·켜는 중) */
  _coldLoad(id, preload) {
    const t = this._setCur(id);
    if (!t) return;
    const d = this.decks[this.active];
    if (d.id !== t.id || d.el.getAttribute('src') !== 'assets/' + t.file) this._deckLoad(this.active, t.id, preload);
    else if (preload) d.el.preload = preload;
    d.el.loop = loopFor(this.sel);
  }

  /** 선택기에서 고름('auto' | 곡 id | 'cycle' | 'shuffle'). 켜져 있으면 곡을 바꿔 튼다. 곡을 고르면 자동은 풀린다 */
  select(v) {
    if (!this.available) return;
    const sel = normalizeSel(v, this.tracks, this.def);
    this.sel = sel;
    lsSet(TRACK_KEY, sel);
    lsSet(MIG_KEY, '2');
    for (const d of this.decks) d.el.loop = loopFor(sel);
    const autoId = sel === 'auto' && this.autoLevel != null ? pickForLevel(this.autoLevel, this.tracks, { recent: this._recent, cur: this.cur, keep: true }) : null;
    if (autoId && autoId !== this.cur) this._switchTo(autoId, { kind: 'manual' });
    else if (!isMode(sel) && sel !== this.cur) this._switchTo(sel, { kind: 'manual' });
    else this._renderSelect(); // 순환·무작위: 지금 곡은 그대로 두고 끝나면 다음 곡
    this._changed();
  }

  /** 곡이 끝난 뒤 다음 곡 id(자동: 같은 단계의 다른 곡, 하나뿐이면 같은 곡 — 다른 덱에서 처음부터) */
  _nextAfterEnd() {
    if (!isMode(this.sel)) return null;
    if (this.sel === 'auto') return pickForLevel(this.autoLevel != null ? this.autoLevel : 1, this.tracks, { recent: this._recent, cur: this.cur });
    return nextTrack(this.sel, this.tracks, this.cur);
  }

  /** 재생 위치: 구간 표시 + 끝 3초 전 다음 곡 미리 시작 */
  _onTime() {
    this._section();
    const d = this.decks[this.active];
    if (d.leadDone || this._xf || this._queued || !this.on || this.paused || d.el.paused) return;
    if (!shouldLeadEnd({ loop: d.el.loop, mode: isMode(this.sel), pos: d.el.currentTime, duration: d.el.duration })) return;
    d.leadDone = true;
    const id = this._nextAfterEnd();
    if (id) this._switchTo(id, { kind: 'ended', force: true });
  }

  _onEnded() {
    // 보통은 끝 3초 전에 이미 넘어갔다(_onTime). 놓쳤을 때(백그라운드 등)만 여기서
    if (this._xf || !isMode(this.sel)) return;
    const id = this._nextAfterEnd();
    if (id) this._switchTo(id, { kind: 'ended', force: true });
  }

  // ───────── 전환 ─────────

  /** 곡 바꾸기. 재생 중이면 크로스페이드, 꺼져 있거나 일시정지·켜는 중이면 바꿔 걸어만 둔다 */
  _switchTo(id, { kind = 'manual', force = false } = {}) {
    const d = this.decks[this.active];
    const playing = this.on && !this.paused && !this.loading && !d.el.paused;
    if (!playing && !this._xf) {
      this._queued = null;
      this._coldLoad(id, this.on ? 'auto' : 'metadata');
      this._changed();
      return;
    }
    const xf = this._xf;
    const act = takeover(xf ? { fromId: xf.fromId, toId: xf.toId, started: xf.started } : null, id);
    if (act === 'start' && id === this.cur && !force) return;
    this._note({ ev: 'request', id, kind, act });
    if (act === 'same') return;
    if (act === 'reverse') { this._reverse(kind); return; }
    if (act === 'retarget') {
      // 새 곡이 아직 시작 전: 나가던 곡의 페이드는 그대로 두고 덱에 걸 곡만 바꿔 다시 준비
      const from = xf.from;
      this._xf = null;
      this._begin(id, kind, { fromOverride: from, keepOut: true });
      return;
    }
    if (act === 'queue') {
      // 세 번째 곡: 들어오던 곡이 지금 곡, 나가던 덱은 빨리 줄이고 조용해지면 새 전환
      // 더 큰 덱을 지금 곡으로 남기고 작은 덱을 빨리 비운다(들어오던 곡이 아직 작으면 나가던 곡을 다시 올림) — 세기가 꺼지지 않게
      const now = this._now();
      const vFrom = this.decks[xf.from].lane.valueAt(now), vTo = this.decks[xf.to].lane.valueAt(now);
      if (vTo < vFrom) { this._hurryOut(xf.to, now); this._laneTo(xf.from, 1, XFADE.manual.in, now); this.active = xf.from; }
      else this._hurryOut(xf.from, now);
      this._note({ ev: 'keep', id: this.decks[this.active].id });
      this._xf = null;
      this._queued = { id, kind };
      this._setCur(id);
      this._pump();
      return;
    }
    this._begin(id, kind);
  }

  /** 되돌아가기: 나가던 곡으로 — 두 덱 방향만 뒤집어 지금 값에서 이어 감 */
  _reverse(kind) {
    const xf = this._xf;
    const P = XFADE[kind] || XFADE.manual;
    const now = this._now();
    const sid = ++this._switchId;
    const from = xf.to, to = xf.from;
    this._laneTo(to, 1, P.in, now);
    this._laneTo(from, 0, P.out, now);
    this.active = to;
    this._xf = { sid, from, to, fromId: this.decks[from].id, toId: this.decks[to].id, kind, started: true, plan: { ...xf.plan, reversed: true } };
    this._setCur(this.decks[to].id);
    this._note({ ev: 'reverse', to: this.decks[to].id });
    this._changed();
    this._pump();
  }

  /** 새 전환: 쉬던 덱에 곡을 걸고(버퍼링 대기) → 마디 경계 → 나가기 → delay 뒤 들어오기 */
  async _begin(id, kind, { fromOverride = null, keepOut = false } = {}) {
    const from = fromOverride != null ? fromOverride : this.active;
    const to = 1 - from;
    const now0 = this._now();
    const idle = this.decks[to];
    // 쉬던 덱이 아직 소리 나면(앞 전환의 꼬리) 빨리 줄이고 조용해진 뒤 다시
    if (idle.lane.valueAt(now0) > SILENT || (!idle.el.paused && idle.lane.target > 0)) {
      this._hurryOut(to, now0);
      this._queued = { id, kind };
      this._setCur(id);
      this._pump();
      return;
    }
    const sid = ++this._switchId;
    this._queued = null;
    const fromId = this.decks[from].id;
    this._xf = { sid, from, to, fromId, toId: id, kind, started: false, plan: null };
    this._setCur(id);
    this._deckLoad(to, id, 'auto');
    idle.lane.snap(0, now0);
    this._applyDeck(to, now0);
    this._changed();
    this._note({ ev: 'prep', from: fromId, to: id, kind });
    await this._ready(idle.el, READY_TIMEOUT);
    if (sid !== this._switchId) return;
    const out = this.decks[from];
    const tr = this._trackOf(fromId);
    const bpm = (tr && tr.bpm) || (this._metaCache.get(fromId) || {}).bpm || null;
    const plan = planXfade(kind, { pos: out.el.currentTime, bpm, remaining: (out.el.duration || NaN) - out.el.currentTime });
    this._xf.plan = plan;
    if (plan.wait > 0) { this._note({ ev: 'bar-wait', wait: plan.wait, bpm }); await sleep(plan.wait); if (sid !== this._switchId) return; }
    if (!this.on || this.paused) return; // 그 사이 정지: _finalize 가 이미 처리
    // 나가기(이미 retarget 으로 나가는 중이면 그대로 이어 감)
    let t = this._now();
    if (!(keepOut && out.lane.target === 0)) this._laneTo(from, 0, plan.out, t);
    this._note({ ev: 'out', id: fromId, dur: plan.out });
    this._pump();
    if (plan.delay > 0) { await sleep(plan.delay); if (sid !== this._switchId) return; }
    if (!this.on || this.paused) return;
    this.ensureGraph();
    try { await idle.el.play(); } catch (e) {
      if (sid !== this._switchId) return;
      // 새 곡을 못 틀었다: 나가던 곡을 되살림
      this.lastError = (e && e.name) || 'Error';
      this._xf = null;
      this._laneTo(from, 1, plan.out, this._now());
      this._setCur(fromId);
      this._note({ ev: 'play-fail', id, err: this.lastError });
      this._changed();
      this._pump();
      return;
    }
    if (sid !== this._switchId) return;
    t = this._now();
    this._laneTo(to, 1, plan.in, t);
    this.active = to;
    this._xf.started = true;
    this._note({ ev: 'in', id, dur: plan.in });
    this._changed();
    this._pump();
  }

  /** 아직 소리 나는 덱을 빨리 줄임(이미 더 빨리 줄고 있으면 그대로) */
  _hurryOut(i, now) {
    const l = this.decks[i].lane;
    const p = l.phaseAt(now);
    if (l.target === 0 && l.busy(now) && l.endTime - now <= TAKEOVER_OUT * p + 1e-3) return;
    this._laneTo(i, 0, TAKEOVER_OUT, now);
  }

  /** 아직 새 곡이 시작 전인 전환은 버림(켜기·재개 때 — 곡은 _reconcile 이 다시 맞춤) */
  _dropUnstarted() {
    const xf = this._xf;
    if (!xf || xf.started) return;
    this._switchId++;
    this._xf = null;
    const now = this._now();
    const d = this.decks[xf.to];
    d.lane.snap(0, now);
    this._applyDeck(xf.to, now);
    try { d.el.pause(); } catch (e) {}
  }

  /** 지금 곡(cur)과 지금 덱이 다르면(전환을 버렸을 때) 다시 크로스페이드 */
  _reconcile() {
    if (this.on && !this.paused && !this._xf && !this._queued && this.cur && this.cur !== this.decks[this.active].id) this._switchTo(this.cur, { kind: 'manual', force: true });
  }

  /** 요소가 재생할 만큼 받을 때까지(최대 sec 초). 오류도 그냥 진행(play 가 실패를 알려 줌) */
  _ready(el, sec) {
    if (el.readyState >= 3) return Promise.resolve(true);
    if (el.networkState !== 2) { try { el.load(); } catch (e) {} } // 받는 중이 아니면(preload none·metadata 로 멈춤) 다시 받기 — 위치는 0
    return new Promise((res) => {
      const done = (ok) => { clearTimeout(tm); el.removeEventListener('canplay', on); el.removeEventListener('canplaythrough', on); el.removeEventListener('error', er); res(ok); };
      const on = () => done(true), er = () => done(false);
      const tm = setTimeout(() => done(false), sec * 1000);
      el.addEventListener('canplay', on); el.addEventListener('canplaythrough', on); el.addEventListener('error', er);
    });
  }

  /** 전환을 끝 상태로 바로(정지·끄기 때 버스가 0 이 된 뒤): 새 곡 덱이 지금 곡, 다른 덱은 0 */
  _finalize() {
    const now = this._now();
    const xf = this._xf;
    this._switchId++;
    if (xf) this.active = xf.to;
    this._xf = null;
    if (this._queued) { const q = this._queued; this._queued = null; this._coldLoad(q.id, 'auto'); }
    this.decks.forEach((d, i) => { d.lane.snap(i === this.active ? 1 : 0, now); this._applyDeck(i, now); });
    if (xf) { const d = this.decks[this.active]; try { if (!xf.started) d.el.currentTime = 0; } catch (e) {} }
  }

  _note(o) { this._log.push({ t: +(performance.now() / 1000).toFixed(3), ...o }); if (this._log.length > 60) this._log.shift(); }

  // ───────── 음량 적용 ─────────

  _now() { return this._graph ? this._graph.ctx.currentTime : perfNow(); }

  /** 덱 차선을 목표로(지금 값에서) + 예약 */
  _laneTo(i, target, fullDur, now) {
    const dur = this.decks[i].lane.to(target, fullDur, now);
    this._applyDeck(i, now);
    return dur;
  }
  _masterTo(target, fullDur, done = null) {
    const now = this._now();
    this.master.to(target, fullDur, now);
    this._applyParam(this.master, this._graph && this._graph.bus.gain, now);
    this._mDone = done;
    this._pump();
  }

  _applyDeck(i, now) {
    const d = this.decks[i];
    if (this._graph) this._applyParam(d.lane, d.gain.gain, now);
    else this._renderEl(now);
  }

  /** AudioParam 에 차선 예약: 예약 취소 → 지금 값 고정 → 꺾은선. 값이 연속이라 클릭 잡음 없음 */
  _applyParam(lane, param, now) {
    if (!param) { if (!this._graph) this._renderEl(now); return; }
    const pts = lane.points(now, 0.05);
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(pts[0][1], now);
      for (let k = 1; k < pts.length; k++) param.linearRampToValueAtTime(pts[k][1], pts[k][0]);
    } catch (e) { param.value = pts[pts.length - 1][1]; }
  }

  /** WebAudio 가 없을 때: 같은 곡선을 요소 volume 으로 */
  _renderEl(now = this._now()) {
    if (this._graph) return;
    const m = this.master.valueAt(now) * this.volume;
    for (const d of this.decks) {
      const v = Math.max(0, Math.min(1, d.lane.valueAt(now) * m));
      if (Math.abs(d.el.volume - v) > 1e-4) d.el.volume = v;
    }
  }

  /** 페이드 진행·끝 처리: 요소 모드면 40ms 마다 볼륨, 끝난 덱 멈춤, 전환 마무리, 대기 곡 시작 */
  _pump() {
    if (this._pumpT) { clearTimeout(this._pumpT); this._pumpT = null; }
    const now = this._now();
    this._renderEl(now);
    if (this._mDone && !this.master.busy(now)) { const f = this._mDone; this._mDone = null; f(); }
    const xf = this._xf;
    if (xf && xf.started && !this.decks[xf.from].lane.busy(now) && !this.decks[xf.to].lane.busy(now)) {
      this._note({ ev: 'done', id: xf.toId });
      this._xf = null;
    }
    this.decks.forEach((d, i) => {
      if (i === this.active || (this._xf && i === this._xf.to) || d.el.paused) return;
      if (!d.lane.busy(now) && d.lane.valueAt(now) <= SILENT) { try { d.el.pause(); } catch (e) {} } // src·노드는 그대로(다음 전환에 재사용)
    });
    if (!this._xf && this._queued && this.on && !this.paused) {
      const idle = this.decks[1 - this.active];
      if (!idle.lane.busy(now) && idle.lane.valueAt(now) <= SILENT) { const q = this._queued; this._queued = null; this._begin(q.id, q.kind); }
    }
    const busy = this.master.busy(now) || this.decks.some((d) => d.lane.busy(now)) || this._xf || this._queued || this._mDone;
    if (busy) this._pumpT = setTimeout(() => this._pump(), this._graph ? 100 : 40);
  }

  /**
   * WebAudio 경로 연결(한 번). 사용자 동작(또는 자동재생 허용) 뒤 컨텍스트가 돌고 있을 때만 잇는다 — 멈춘 컨텍스트에 이으면 소리가 끊기므로
   * 그 전에는 요소 volume 으로 같은 곡선을 낸다. 반환: 출력 노드(ctx-ui 가 필터를 끼움) 또는 null
   */
  ensureGraph() {
    if (this._graph) return this._graph.out;
    if (this._graphFailed || this._graphPending) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ua = navigator.userActivation;
    if (!this.routeCtx && ua && !ua.hasBeenActive && !this._playedOk) return null;
    let ctx = this.routeCtx;
    if (!ctx) {
      try { ctx = new AC({ latencyHint: 'playback' }); } catch (e) { this._graphFailed = true; return null; }
      this.routeCtx = ctx;
      this._changed();
    }
    if (ctx.state !== 'running') {
      this._graphPending = true;
      const clear = () => { this._graphPending = false; };
      const tm = setTimeout(clear, 3000);
      ctx.resume().then(() => { clearTimeout(tm); clear(); if (ctx.state === 'running' && this.on) this.ensureGraph(); }, () => { clearTimeout(tm); clear(); });
      return null;
    }
    let bus, volNode;
    try {
      bus = ctx.createGain();
      volNode = ctx.createGain();
      bus.connect(volNode);
      volNode.connect(ctx.destination);
      for (const d of this.decks) {
        d.src = ctx.createMediaElementSource(d.el);
        d.gain = ctx.createGain();
        d.src.connect(d.gain);
        d.gain.connect(bus);
      }
    } catch (e) {
      this._graphFailed = true;
      try { bus && bus.disconnect(); volNode && volNode.disconnect(); } catch (e2) {}
      return null;
    }
    // 시계를 요소용 → 컨텍스트로 옮기고 같은 값에서 이어 감
    const oldNow = perfNow(), now = ctx.currentTime;
    this.master.rebase(oldNow, now);
    for (const d of this.decks) d.lane.rebase(oldNow, now);
    this._graph = { ctx, bus, volNode, out: volNode, insert: null };
    volNode.gain.value = this.volume;
    this._applyParam(this.master, bus.gain, now);
    this.decks.forEach((d, i) => { this._applyParam(d.lane, d.gain.gain, now); d.el.volume = 1; });
    this._note({ ev: 'graph' });
    this._pump();
    return volNode;
  }

  /** 출력과 스피커 사이에 노드 끼우기(ctx-ui 신호 열화 로우패스). node 는 부르는 쪽이 destination 에 잇는다. null 이면 바로 출력 */
  setInsert(node) {
    const g = this._graph;
    if (!g) return false;
    try { g.volNode.disconnect(); } catch (e) {}
    g.volNode.connect(node || g.ctx.destination);
    g.insert = node || null;
    return true;
  }

  _changed() { if (this.onChange) this.onChange(); }

  /** 지금 들리는(또는 들어오는) 덱 재생 */
  async _playAudible() {
    const now = this._now();
    const ps = [];
    this.decks.forEach((d, i) => {
      if (!d.el.paused) return;
      if (i === this.active || d.lane.target > 0 || d.lane.valueAt(now) > SILENT) ps.push(d.el.play());
    });
    await Promise.all(ps);
  }

  /** 켜고 페이드인. 결과: true 재생됨 · false 안 됨(this.lastError = 'NotAllowedError' 면 자동재생 정책 — sound.mjs 가 '대기') · undefined 할 일 없음 */
  async start() {
    if (!this.available) return;
    if (this.on) return;
    this.lastError = null;
    this.on = true;
    this._dropUnstarted(); // 끄는 도중 다시 켬: 시작 전 전환은 버리고 켠 뒤 _reconcile
    const d = this.decks[this.active];
    d.el.preload = 'auto';
    if (!this._xf) { const now = this._now(); d.lane.snap(1, now); this._applyDeck(this.active, now); }
    this._renderEl();
    // play() 는 충분히 버퍼링될 때까지 끝나지 않는다(외부 접속에서 수십 초) — 그동안 '불러오는 중' 표시
    this.loading = d.el.readyState < 3;
    this._changed();
    try { await this.audio.play(); } catch (e) {
      // 켜는 사이 곡이 바뀌면(src 교체) play() 가 AbortError — 꺼진 것이 아니니 바뀐 곡으로 한 번 더
      let ok = false;
      if (e && e.name === 'AbortError' && this.on) { try { await this.audio.play(); ok = true; } catch (e2) { e = e2; } }
      if (!ok) {
        this.lastError = (e && e.name) || 'Error';
        this.loading = false; this.on = false; this._changed();
        return false;
      }
    }
    this.loading = false;
    this._playedOk = true;
    if (!this.on) { this._pauseAll(); this._changed(); return true; } // 불러오는 사이에 사용자가 껐다
    this.ensureGraph();
    this._changed();
    this._masterTo(1, FADE_IN);
    this._reconcile();
    return true;
  }

  /** 켜져 있는데 브라우저가 멈춘 경우(탭 복귀·중단 뒤) 이어서 재생. 결과는 start() 와 같은 뜻 */
  async ensurePlaying() {
    if (!this.on || this.paused || !this.audio.paused) return;
    this.lastError = null;
    try { await this._playAudible(); } catch (e) { this.lastError = (e && e.name) || 'Error'; return false; }
    if (!this.on || this.paused) { this._pauseAll(); return true; }
    this.ensureGraph();
    this._masterTo(1, FADE_RESUME);
    return true;
  }

  _pauseAll() { for (const d of this.decks) { try { d.el.pause(); } catch (e) {} } }

  /** 시각화 일시정지: 짧게 줄이고 멈춤 — 재생 위치는 그대로, on(켜 둔 상태)도 그대로. 진행 중 전환은 끝 상태로 */
  pause() {
    if (!this.on || this.paused) return;
    this.paused = true;
    this._masterTo(0, FADE_HOLD, () => { if (this.paused) { this._finalize(); this._pauseAll(); } });
  }
  /** 멈춘 자리에서 이어서(페이드인) */
  async resume() {
    if (!this.paused) return;
    this.paused = false;
    if (!this.on) return;
    this.lastError = null;
    if (this._mDone) { this._mDone = null; this._dropUnstarted(); } // 줄이는 도중 재개: 진행 중 크로스페이드는 그대로 이어 감
    try { await this._playAudible(); } catch (e) { this.lastError = (e && e.name) || 'Error'; return false; }
    if (this.on && !this.paused) { this.ensureGraph(); this._masterTo(1, FADE_RESUME); this._reconcile(); }
    return true;
  }

  stop() {
    this.paused = false;
    if (!this.on) return;
    this.on = false;
    this.loading = false;
    this._switchId++; // 진행 중인 곡 바꿈 취소
    this._changed();
    this._masterTo(0, FADE_STOP, () => { if (!this.on) { this._finalize(); this._pauseAll(); } });
    this.secEl.textContent = '';
  }

  _section() {
    if (!this.on || !this.meta || !this.meta.sections) return;
    const t = this.audio.currentTime;
    let name = '';
    for (const s of this.meta.sections) if (t >= s.start) name = sectionName(s.name, this.sectionsEn); // 영어 화면은 매니페스트 sections_en
    if (this.secEl.textContent !== name) this.secEl.textContent = name;
  }

  _save() { try { localStorage.setItem(KEY, JSON.stringify({ volume: this.volume })); } catch (e) {} }
}
