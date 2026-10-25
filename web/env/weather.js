// 기상 층: 흐르는 안개 · 비(사선 줄기 + 바닥 물방울 튐) · 눈(흔들리며 떨어짐). 세 표현 공통, env.addLayer 로 붙는다.
// 모두 셰이더 기반 — 입자 위치는 시드와 시간(uTime)으로 정점 셰이더가 계산하고 CPU 는 매 프레임 균일값만 바꾼다(그리기: 안개 3 + 비 1 + 튐 1 + 눈 1).
// 세기가 0 인 층은 만들지 않거나(처음) 숨긴 채 갱신을 건너뛰고, '끔'이면 아예 지운다(비용 0).
// 시간은 장면 프레임의 dt 로만 흘러서 실시간 일시정지 중엔 그대로 멈춘다. prefers-reduced-motion 이면 비·눈은 그리지 않고 안개는 멈춘 채.
// 가독성: 모든 층은 노드보다 먼저 그려(renderOrder 음수) 노드·빔이 위에 덮이고, 글자는 DOM 이라 가려지지 않는다.
import { t as _t } from '../i18n.mjs';
import * as THREE from 'three';
import { WEATHER_MODES, WEATHER_LABEL, normWeather, particleCounts, autoWeather, weatherTarget, approach, isErrorEvent } from './env-core.mjs';

const LS_KEY = 'ccviz.weather';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 저장소 없음 */ } };

/** 표현별 크기: 세계 단위 배율(s)·안개 층 높이(바닥 기준 위로, s 배)·안개를 걷어 두는 가운데 반경(카메라 거리 배) */
const TUNE = {
  flow: { s: 1, fogLayers: [0.25, 0.75, 1.0], clear: 0.14 },
  planet: { s: 3, fogLayers: [0.4, 1.4, 2.6], clear: 0.14, splashK: 0.6, splashA: 0.55 }, // 물방울 고리는 작고 옅게 — 원형 궤도계 섬의 고리와 겹쳐 어지럽지 않게
  voxel: { s: 1.4, fogLayers: [0.2, 0.9, 2.2], clear: 0.22 },
};

const NOISE = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int k = 0; k < 3; k++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }`;

const FOG_VS = `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FOG_FS = `
uniform float uTime; uniform vec3 uColor; uniform float uAlpha; uniform vec3 uCam; uniform vec3 uFocus; uniform float uClear; uniform float uScale; uniform float uSeed;
varying vec3 vW;
${NOISE}
void main() {
  vec2 p = vW.xz / (18.0 * uScale) + vec2(uTime * 0.045, uTime * 0.018) + uSeed;
  float n = fbm(p) * 0.65 + fbm(p * 2.7 - vec2(uTime * 0.03, 0.0)) * 0.35;
  n = smoothstep(0.2, 0.8, n);
  float far = smoothstep(uClear * 0.4, uClear * 2.0, length(vW.xz - uFocus.xz));   // 보는 곳 가운데는 걷히고 멀수록 짙게
  float dist = length(vW - uCam);
  float horizon = 1.0 - smoothstep(uClear * 14.0, uClear * 30.0, dist);                // 지평선 끝은 배경색으로
  gl_FragColor = vec4(uColor, (0.25 + 0.75 * n) * far * horizon * uAlpha);
}`;

const RAIN_VS = `
uniform float uTime; uniform vec3 uCenter; uniform float uW; uniform float uH; uniform float uGround; uniform float uLen; uniform vec2 uWind;
attribute vec4 aSeed; attribute float aEnd; varying float vA;
void main() {
  float speed = uH * (1.6 + aSeed.w * 0.8);
  float fall = mod(uTime * speed / uH + aSeed.z, 1.0);              // 0 위 → 1 바닥
  float y = uGround + uH * (1.0 - fall);
  vec2 xz = aSeed.xy * uW;
  xz = mod(xz - (uCenter.xz - uW * 0.5) + uWind * (1.0 - fall) * uH * 0.25, uW) + uCenter.xz - uW * 0.5;
  vec3 dir = normalize(vec3(uWind.x * 0.25, -1.0, uWind.y * 0.25));
  vec3 p = vec3(xz.x, y, xz.y) - dir * uLen * aEnd;
  vA = (1.0 - aEnd * 0.85) * smoothstep(0.0, 0.08, fall) * (1.0 - smoothstep(0.92, 1.0, fall));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RAIN_FS = `uniform vec3 uColor; uniform float uAlpha; varying float vA; void main() { gl_FragColor = vec4(uColor, vA * uAlpha); }`;

const SPLASH_VS = `
uniform float uTime; uniform vec3 uCenter; uniform float uW; uniform float uGround; uniform float uSize; uniform float uPx;
attribute vec3 aSeed; varying float vK;
void main() {
  float k = fract(uTime * (0.9 + aSeed.z * 0.6) + aSeed.z * 7.0);
  float cyc = floor(uTime * (0.9 + aSeed.z * 0.6) + aSeed.z * 7.0);
  vec2 s = fract(aSeed.xy + vec2(cyc * 0.618, cyc * 0.382));
  vec2 xz = s * uW + uCenter.xz - uW * 0.5;
  vK = k;
  vec4 mv = viewMatrix * vec4(xz.x, uGround + 0.02, xz.y, 1.0);
  gl_PointSize = min(48.0, uSize * (0.4 + k * 1.6) * uPx / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const SPLASH_FS = `uniform vec3 uColor; uniform float uAlpha; varying float vK;
void main() { vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0; float ring = smoothstep(0.62, 0.78, d) * (1.0 - smoothstep(0.82, 1.0, d));
  gl_FragColor = vec4(uColor, ring * (1.0 - vK) * uAlpha); }`;

const SNOW_VS = `
uniform float uTime; uniform vec3 uCenter; uniform float uW; uniform float uH; uniform float uGround; uniform float uSize; uniform float uPx;
attribute vec4 aSeed; varying float vA;
void main() {
  float speed = 0.09 + aSeed.w * 0.07;
  float fall = mod(uTime * speed + aSeed.z, 1.0);
  float y = uGround + uH * (1.0 - fall);
  vec2 xz = aSeed.xy * uW + vec2(sin(uTime * (0.6 + aSeed.w) + aSeed.z * 30.0), cos(uTime * (0.5 + aSeed.z) + aSeed.w * 20.0)) * uW * 0.012;
  xz = mod(xz - (uCenter.xz - uW * 0.5), uW) + uCenter.xz - uW * 0.5;
  vA = smoothstep(0.0, 0.06, fall) * (1.0 - smoothstep(0.96, 1.0, fall));          // 바닥에 닿으면 사라짐
  vec4 mv = viewMatrix * vec4(xz.x, y, xz.y, 1.0);
  gl_PointSize = clamp(uSize * (0.6 + aSeed.w * 0.8) * uPx / max(1.0, -mv.z), 1.5, 14.0);
  gl_Position = projectionMatrix * mv;
}`;
const SNOW_FS = `uniform vec3 uColor; uniform float uAlpha; varying float vA;
void main() { vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(uColor, (1.0 - d * d) * vA * uAlpha); }`;

function seeded(n, dim, seed = 11) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const a = new Float32Array(n * dim);
  for (let i = 0; i < a.length; i++) a[i] = rnd();
  return a;
}

export class WeatherLayer {
  constructor({ initial = null } = {}) {
    const fromUrl = normWeather(initial);
    this.mode = fromUrl || normWeather(lsGet(LS_KEY)) || 'auto';
    this.cur = { fog: 0, rain: 0, snow: 0 };
    this.errors = [];
    this.lastEventMs = null;
    this.time = 0;
    this.view = null; this.tune = TUNE.flow; this.isLight = false;
    this.parts = null; // 지금 장면에 만든 three 객체
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.counts = particleCounts({ width: typeof innerWidth === 'number' ? innerWidth : 1440, mobile: typeof navigator !== 'undefined' && /Mobi|Android|iPhone/i.test(navigator.userAgent || '') });
  }
  // ---- env 덧붙임 인터페이스 ----
  attach(view, mode, ground) {
    this.detach();
    this.view = view; this.modeName = mode; this.ground = ground;
    this.tune = TUNE[mode] || TUNE.flow;
  }
  detach() {
    if (this.parts) {
      for (const o of this.parts.all) { o.removeFromParent(); o.geometry.dispose(); o.material.dispose(); }
      this.parts = null;
    }
    this.view = null;
  }
  applyTheme(isLight) {
    this.isLight = !!isLight;
    if (this.parts) this._colors();
  }
  noteEvent(ev, opts = {}) {
    if (!ev || opts.quiet) return;
    const t = Date.now();
    this.lastEventMs = t;
    if (isErrorEvent(ev)) { this.errors.push(t); if (this.errors.length > 40) this.errors.splice(0, this.errors.length - 40); }
  }
  setMode(m) {
    const n = normWeather(m); if (!n) return;
    this.mode = n; lsSet(LS_KEY, n);
    if (n === 'off' && this.parts) { const v = this.view; this.detach(); this.view = v; this.cur = { fog: 0, rain: 0, snow: 0 }; }
    if (this.card) this.bindCard(this.card, true);
  }
  get target() {
    const auto = autoWeather({ nowMs: Date.now(), errorTimes: this.errors, lastEventMs: this.lastEventMs });
    const t = weatherTarget(this.mode, auto);
    if (this.reduced) { t.rain = 0; t.snow = 0; }
    return t;
  }

  _ensure() {
    if (this.parts || !this.view) return;
    const v = this.view, sc = v.scene;
    const all = [];
    // 안개: 바닥 근처 반투명 노이즈 판 3장(세계 좌표 노이즈라 판을 카메라 따라 옮겨도 무늬는 제자리 → 3D 시차)
    const fogs = this.tune.fogLayers.map((h, i) => {
      const u = { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uCam: { value: new THREE.Vector3() }, uFocus: { value: new THREE.Vector3() },
        uClear: { value: 20 }, uScale: { value: this.tune.s * (1 + i * 0.35) }, uSeed: { value: i * 13.7 } };
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: u, vertexShader: FOG_VS, fragmentShader: FOG_FS, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = -1.8 + i * 0.01; m.frustumCulled = false; m.name = 'weather-fog';
      m.userData.h = h; sc.add(m); all.push(m);
      return { m, u };
    });
    // 비: 줄기 N 개 = 정점 2N(LineSegments 1회)
    const N = this.counts.rain;
    const rg = new THREE.BufferGeometry();
    const seed = seeded(N, 4, 21), aSeed = new Float32Array(N * 2 * 4), aEnd = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) for (let e = 0; e < 2; e++) { aSeed.set(seed.subarray(i * 4, i * 4 + 4), (i * 2 + e) * 4); aEnd[i * 2 + e] = e; }
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 4)); rg.setAttribute('aEnd', new THREE.BufferAttribute(aEnd, 1));
    const ru = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uW: { value: 100 }, uH: { value: 60 }, uGround: { value: 0 }, uLen: { value: 1.5 },
      uWind: { value: new THREE.Vector2(0.9, 0.35) }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } };
    const rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({ uniforms: ru, vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false }));
    rain.frustumCulled = false; rain.renderOrder = -1.2; rain.visible = false; rain.name = 'weather-rain'; sc.add(rain); all.push(rain);
    // 물방울 튐: 바닥 위 고리(Points)
    const S = this.counts.splash;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S * 3), 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(seeded(S, 3, 33), 3));
    const su = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uW: { value: 100 }, uGround: { value: 0 }, uSize: { value: 1 }, uPx: { value: 800 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } };
    const splash = new THREE.Points(sg, new THREE.ShaderMaterial({ uniforms: su, vertexShader: SPLASH_VS, fragmentShader: SPLASH_FS, transparent: true, depthWrite: false }));
    splash.frustumCulled = false; splash.renderOrder = -1.7; splash.visible = false; splash.name = 'weather-splash'; sc.add(splash); all.push(splash);
    // 눈
    const M = this.counts.snow;
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3), 3));
    ng.setAttribute('aSeed', new THREE.BufferAttribute(seeded(M, 4, 47), 4));
    const nu = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uW: { value: 100 }, uH: { value: 60 }, uGround: { value: 0 }, uSize: { value: 1 }, uPx: { value: 800 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } };
    const snow = new THREE.Points(ng, new THREE.ShaderMaterial({ uniforms: nu, vertexShader: SNOW_VS, fragmentShader: SNOW_FS, transparent: true, depthWrite: false }));
    snow.frustumCulled = false; snow.renderOrder = -1.1; snow.visible = false; snow.name = 'weather-snow'; sc.add(snow); all.push(snow);
    this.parts = { fogs, rain: { m: rain, u: ru }, splash: { m: splash, u: su }, snow: { m: snow, u: nu }, all };
    this._colors();
  }
  _colors() {
    const L = this.isLight, P = this.parts;
    for (const f of P.fogs) f.u.uColor.value.set(L ? '#c3ccdb' : '#6a7ea8');
    P.rain.u.uColor.value.set(L ? '#5d6f90' : '#9fb6e6');
    P.splash.u.uColor.value.set(L ? '#6f80a0' : '#a9c0ee');
    P.snow.u.uColor.value.set(L ? '#8c9cc0' : '#e8eefc');
    const add = L ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (const o of [P.rain.m, P.splash.m]) if (o.material.blending !== add) { o.material.blending = add; o.material.needsUpdate = true; }
  }

  frame(view, dt, now) {
    if (view !== this.view) return;
    const tg = this.target;
    const c = this.cur;
    c.fog = approach(c.fog, tg.fog, dt, 0.4); c.rain = approach(c.rain, tg.rain, dt, 0.5); c.snow = approach(c.snow, tg.snow, dt, 0.4);
    if (c.fog + c.rain + c.snow < 0.002) { if (this.parts) for (const o of this.parts.all) o.visible = false; return; } // 세기 0: 갱신 생략
    this._ensure();
    if (!this.parts) return;
    if (!this.reduced) this.time += dt;
    const t = this.time % 3600;
    const cam = view.camera, P = this.parts, s = this.tune.s;
    const gy = this.ground ? this.ground.y : 0;
    // 보는 지점(바닥과 시선이 만나는 점)·거리
    const fd = view.focusDist || cam.position.length() || 60;
    const foc = this._foc || (this._foc = new THREE.Vector3());
    let dist = fd;
    if (this.ground) { const r = this.ground.focusOf(cam, fd, foc); dist = r.dist; } else foc.set(0, gy, 0);
    const span = Math.max(30 * s, Math.min(dist * 2.4, 900));
    // 세계 길이 → 화면 픽셀 배율(점 크기를 세계 단위로)
    const hpx = (view.container && view.container.clientHeight) || 800;
    const px = (hpx * Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)) / (2 * Math.tan(((cam.fov || 50) * Math.PI) / 360));
    // 안개
    for (const f of P.fogs) {
      f.m.visible = c.fog > 0.002;
      if (!f.m.visible) continue;
      f.m.position.set(foc.x, gy + f.m.userData.h * s, foc.z);
      f.m.scale.set(span * 6, span * 6, 1);
      f.u.uTime.value = t; f.u.uCam.value.copy(cam.position); f.u.uFocus.value.copy(foc);
      f.u.uClear.value = Math.max(8 * s, dist * this.tune.clear);
      f.u.uAlpha.value = c.fog * (this.isLight ? 0.5 : 0.48); // 판 3장이 겹친다
    }
    // 비·튐
    const rv = c.rain > 0.002;
    P.rain.m.visible = rv; P.splash.m.visible = rv;
    if (rv) {
      const W = Math.min(span * 1.1, 500), H = Math.max(10 * s, W * 0.45);
      P.rain.u.uTime.value = t; P.rain.u.uCenter.value.copy(foc); P.rain.u.uW.value = W; P.rain.u.uH.value = H; P.rain.u.uGround.value = gy;
      P.rain.u.uLen.value = H * 0.045; P.rain.u.uAlpha.value = c.rain * (this.isLight ? 0.42 : 0.32);
      P.splash.u.uTime.value = t; P.splash.u.uCenter.value.copy(foc); P.splash.u.uW.value = W * 0.8; P.splash.u.uGround.value = gy;
      P.splash.u.uSize.value = 0.5 * s * (this.tune.splashK || 1); P.splash.u.uPx.value = px; P.splash.u.uAlpha.value = c.rain * (this.isLight ? 0.5 : 0.42) * (this.tune.splashA || 1);
    }
    const nv = c.snow > 0.002;
    P.snow.m.visible = nv;
    if (nv) {
      const W = Math.min(span * 1.1, 500), H = Math.max(10 * s, W * 0.45);
      P.snow.u.uTime.value = t; P.snow.u.uCenter.value.copy(foc); P.snow.u.uW.value = W; P.snow.u.uH.value = H; P.snow.u.uGround.value = gy;
      P.snow.u.uSize.value = 0.16 * s; P.snow.u.uPx.value = px;
      P.snow.u.uAlpha.value = c.snow * (this.isLight ? 0.95 : 0.75);
    }
  }

  // ---- '배경' 카드 줄 ----
  rowHtml() {
    const cur = this.mode;
    return `<div class="env-row env-wx" style="display:block"><span>${_t('scene.wx.title')}<small>${_t(this.reduced ? 'scene.wx.noteReduced' : 'scene.wx.noteAuto')}</small></span>
      <div class="env-seg">${WEATHER_MODES.map((m) => `<button type="button" data-wx="${m}" aria-pressed="${cur === m}">${WEATHER_LABEL[m]}</button>`).join('')}</div></div>`;
  }
  bindCard(card, rerender = false) {
    this.card = card;
    const seg = card.querySelector('.env-wx .env-seg');
    if (!seg) return;
    if (rerender) for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.wx === this.mode));
    if (seg.dataset.bound) return;
    seg.dataset.bound = '1';
    seg.addEventListener('click', (e) => { const b = e.target.closest('[data-wx]'); if (b) this.setMode(b.dataset.wx); });
  }
  get state() { return { mode: this.mode, cur: { ...this.cur }, target: this.target, built: !!this.parts, reduced: this.reduced, counts: this.counts }; }
}
