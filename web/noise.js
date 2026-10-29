// 컨텍스트 노이즈 A안 '신호 열화' 후처리. 표현 모드(도형·복셀)와 무관하게
// view.renderer.render 를 감싸 장면을 렌더 타깃에 그린 뒤 전체 화면 사각형 셰이더 1패스로 화면에 낸다.
// 필요 없을 때(꺼짐·세기 0·모든 대상 문턱 미만·정화·버스트 없음)는 원래 render 를 그대로 불러 비용 0.
// 메인 노드 잔상·윤곽 이중화·끊김과 문턱 버스트도 같은 1패스에서(uMain·uMOff·uBurst).
import * as THREE from 'three';
import { MAX_REGIONS, PurgeBook, GRAIN_PCT, SCAN_PCT, CHROMA_PCT, MOSH_PCT, TOP_PCT, GRAIN_FADE } from './ctx-core.mjs';
// PurgeBook·MAX_REGIONS 는 순수 모듈(ctx-core.mjs)로 옮겼다 — 2D 화면이 three 없이 쓰게. 예전 이름으로 다시 내보냄
export { MAX_REGIONS, PurgeBook };

// 단계 경계(ctx-core 상수, %)를 GLSL 실수 문자열로 — FRAG 템플릿에 끼워 넣는다(MAX_REGIONS 와 같은 방식)
const F = (pct) => (pct / 100).toFixed(2);

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uTime;
uniform float uAmp;
uniform float uAmpG;
uniform float uGrainPx;
uniform float uMotion;
uniform float uFull;
uniform int uCount;
uniform vec4 uReg[${MAX_REGIONS}];
uniform vec4 uPur[${MAX_REGIONS}];
uniform float uBurst[${MAX_REGIONS}];
uniform int uMainN;
uniform vec4 uMain[${MAX_REGIONS}];
uniform vec4 uMOff[${MAX_REGIONS}];
varying vec2 vUv;

// sin 없는 해시(Dave Hoskins "hash without sine"). 예전 fract(sin(dot(p, …)) * 43758) 은 시간에 따라 커지는 인자에서
// GPU(ANGLE D3D11) 정밀도가 무너져 NaN·굵은 무늬를 냈고, NaN × 세기 0 = NaN 이라 사용률이 낮아도 검은 블록·반점이 생겼다(§39.8)
// 예전엔 선형 렌더 타깃에 효과를 더해 sRGB 로 바꿨다 — 어두운 배경에선 sRGB 곡선이 약 10배로 키워 미세 그레인(선형 0.005)도
// 화면에서 13단계 넘는 굵은 반점이 됐다(§39.8 원인). 지금은 화면 복사본(sRGB)에 더한다
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec2 px = vUv * uRes;
  float L = 0.0;
  float glow = 0.0;
  float bu = 0.0;   // 문턱 버스트(§76): 단계가 오르는 순간 0.5초
  for (int i = 0; i < ${MAX_REGIONS}; i++) {
    if (i >= uCount) break;
    vec4 r = uReg[i];
    vec4 p = uPur[i];
    float f;
    float s;
    if (uFull > 0.5) { f = 1.0; s = vUv.x; }
    else {
      float d = distance(px, r.xy);
      f = 1.0 - smoothstep(r.z * 0.55, r.z, d);
      s = (px.x - (r.x - r.z)) / max(1.0, 2.0 * r.z);
    }
    float li = r.w;
    if (p.x >= 0.0) {
      // 정화: 앞머리(p.x) 왼쪽은 새(낮은) 값, 오른쪽은 이전 값. 앞머리에 옅은 빛 띠
      li = s < p.x ? r.w : p.y;
      glow += f * exp(-abs(s - p.x) * 38.0) * (1.0 - p.x) * p.z;
    }
    L = max(L, li * f);
    bu = max(bu, uBurst[i] * f);
  }
  float t = uTime * uMotion;   // uTime 은 JS 에서 600초 주기로 감아 보낸다(정밀도)
  // 단계 경계(ctx-core 상수에서 끼워 넣음): 30 그레인 · 50 주사선·색 바램 · 70 색수차·비네팅·글리치 · 90 데이터모시(98 에서 꽉 참)
  // §76 진폭 재조정: 그레인은 시작부터 보이게(1.5제곱 → 1제곱, 0.022 → 0.034), 주사선 0.22 → 0.34, 색수차 6 → 9px, 글리치 칸 1할 → 2할
  float g = smoothstep(${F(GRAIN_PCT)}, ${F(SCAN_PCT)}, L) * uAmpG;
  float sc = smoothstep(${F(SCAN_PCT)}, ${F(CHROMA_PCT)}, L) * uAmp;
  float ch = max(smoothstep(${F(CHROMA_PCT)}, ${F(MOSH_PCT)}, L) * uAmp, bu * 1.6);
  float mo = max(smoothstep(${F(MOSH_PCT)}, ${F(TOP_PCT)}, L) * min(uAmp, 1.5), bu * 0.9);

  vec2 uv = vUv;
  // 메인 노드 잔상·윤곽 이중화·끊김(§76): 노드 둘레 원 안에서 본체는 흔들리며 가끔 튀고(uMOff.xy), 0.2초 늦은 사본이 겹친다(uMOff.zw)
  float gk = 0.0;
  vec2 offA = vec2(0.0);
  vec2 offB = vec2(0.0);
  for (int i = 0; i < ${MAX_REGIONS}; i++) {
    if (i >= uMainN) break;
    vec4 m = uMain[i];
    float w = (1.0 - smoothstep(m.z * 0.78, m.z, distance(px, m.xy))) * m.w;
    if (w > gk) { gk = w; offA = uMOff[i].xy; offB = uMOff[i].zw; }
  }
  if (gk > 0.002) uv -= offA * min(1.0, gk * 1.6) / uRes;
  // 간헐 글리치(가로 찢김): 0.25초 칸 중 약 2할(버스트 중엔 늘), 움직임 줄이기면 없음. 세기 0 이면 계산 안 함
  if (ch > 0.001 && uMotion > 0.5) {
    float burst = max(step(0.8, hash(vec2(floor(uTime * 4.0), 7.0))), step(0.01, bu));
    float row = floor(px.y / (bu > 0.01 ? 11.0 : 7.0));
    float fr = floor(uTime * 20.0);
    float tearOn = step(bu > 0.01 ? 0.45 : 0.78, hash(vec2(row * 0.37, fr)));
    uv.x += (hash(vec2(row, fr)) - 0.5) * (0.06 * ch + 0.1 * bu) * burst * tearOn;
  }
  // 데이터모시: 24px 블록 일부를 옆 블록에서 끌어와 번지게
  vec2 blk = floor(px / 24.0);
  float moshOn = 0.0;
  if (mo > 0.001) {
    moshOn = step(hash(blk + floor(t * 1.5 + bu * uTime * 9.0) * vec2(1.7, 9.2)), mo * 0.42);
    if (moshOn > 0.5) {
      vec2 disp = (vec2(hash(blk + 3.1), hash(blk + 5.7)) - 0.5) * 48.0 / uRes;
      vec2 snap = (blk * 24.0 + vec2(2.0, mod(px.y, 24.0))) / uRes;
      uv = mix(uv, snap, 0.75) + disp;
    }
  }
  // 색수차(가장자리일수록 큼, 버스트 중엔 화면 가운데도)
  vec2 dir = vUv - 0.5;
  vec3 col;
  float ca = ch * 9.0 + mo * 5.0;
  if (ca > 0.01) {
    vec2 off = (dir * 2.0 + vec2(bu * 0.6, 0.0)) * ca / uRes * 2.0;
    col.r = texture2D(tDiffuse, uv + off).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - off).b;
  } else col = texture2D(tDiffuse, uv).rgb;
  // 잔상: 0.2초 늦은 사본을 반투명으로(빨강·파랑이 조금 갈라진 윤곽)
  if (gk > 0.002) {
    vec2 ob = offB / uRes;
    vec3 gh = vec3(texture2D(tDiffuse, vUv - ob * 1.25).r, texture2D(tDiffuse, vUv - ob).g, texture2D(tDiffuse, vUv - ob * 0.75).b);
    col = mix(col, gh, clamp(gk * 0.55, 0.0, 0.55));
  }
  // 화면 복사본이라 이미 sRGB 값 — 효과는 화면 값에서 더한다
  if (moshOn > 0.5) col = floor(col * 7.0) / 7.0;
  // 색 바램(탈색 + 누렇게 + 대비 줄임)
  if (sc > 0.001) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum) * vec3(1.04, 1.0, 0.92), clamp(sc * 0.5, 0.0, 0.9));
    col = mix(col, vec3(0.5), clamp(sc * 0.08, 0.0, 0.25));
    // 주사선(3px 주기, 천천히 굴러감). §76 평균 밝기를 깎지 않게 위아래로(예전 식은 라이트 테마 섬을 회갈색 원판으로 만들었다)
    col *= 1.0 + clamp(sc * 0.2, 0.0, 0.35) * sin(px.y * 2.094 + t * 3.0);
  }
  // 필름 그레인(§76.8): 입자 uGrainPx(장치 px = max(2, round(dpr×1.5)) — CSS 1.5～2px), 24fps 로 바뀜(움직임 줄이기면 고정).
  // 진폭(degrade-core grainAmp 와 같은 식) 시작(30%) ±10/255 → 70% ±20 → 98% ±30. 밝기 의존: 어두운 화소는 더하기, 밝은 화소는 빼기 쪽 + 옅은 색 입자
  float gA = smoothstep(${F(GRAIN_FADE[0])}, ${F(GRAIN_FADE[1])}, L) * (10.0 + 10.0 * smoothstep(${F(GRAIN_PCT)}, ${F(CHROMA_PCT)}, L) + 10.0 * smoothstep(${F(CHROMA_PCT)}, ${F(TOP_PCT)}, L)) / 255.0 * uAmpG;
  float ga = gA + mo * 0.03 + bu * 0.08;
  if (ga > 0.0005) {
    vec2 cell = floor(px / uGrainPx);
    float fr = floor(uTime * 24.0) * uMotion;
    vec2 q = cell + fr * vec2(17.0, 29.0);
    float n = hash(q) * 2.0 - 1.0;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float d = n * 0.75 + (0.5 - lum) * 0.5;
    vec3 cn = vec3(hash(q + 3.7), hash(q + 9.1), hash(q + 5.3)) - 0.5;
    col += (vec3(d) + cn * 0.35) * ga;
  }
  // 버스트: 가로 띠 몇 줄이 반전·번쩍
  if (bu > 0.01 && uMotion > 0.5) {
    float band = step(0.82, hash(vec2(floor(px.y / 18.0), floor(uTime * 24.0))));
    col = mix(col, 1.0 - col, band * bu * 0.75);
    col += bu * 0.08 * step(0.5, hash(vec2(floor(uTime * 30.0), 1.0)));
  }
  // 비네팅(화면 전체 보기만)
  float vg = smoothstep(0.32, 0.95, length(dir) * 1.45);
  col *= 1.0 - clamp(ch * 0.42, 0.0, 0.8) * vg * uFull;
  // 깜빡임(데이터모시 단계, 움직임 줄이기면 없음)
  if (mo > 0.001) col *= 1.0 - 0.07 * mo * uMotion * step(0.86, hash(vec2(floor(uTime * 12.0), 3.0)));
  col += glow * vec3(0.5, 0.78, 1.0) * 0.55;
  col = clamp(col, 0.0, 1.0);
  // §115 알파는 화면 복사본 그대로 — 계획 보드 자리 구멍(투명 픽셀)이 신호 열화 중에도 뚫린 채로(예전 1.0 이면 판 자리가 검게 덮였다)
  float aOut = texture2D(tDiffuse, vUv).a;
  gl_FragColor = vec4(col * aOut, aOut); // 이미 sRGB(renderer.outputColorSpace 기본값과 같음) · 구멍 밖은 aOut = 1
}
`;

export class SignalNoise {
  constructor() {
    this.view = null;
    this._orig = null;
    this.rt = null;
    this.targets = { full: true, list: [], mains: [] }; // list: [{x, y, r, L, burst, purge:{p, oldL, glow}|null}]  (화면 px, 아래가 0)
    // mains: [{x, y, r, D, ax, ay, bx, by}] 메인 노드 화면 자리·반지름·세기·본체/잔상 오프셋(버퍼 px)
    this.amp = 1;
    this.ampGrain = 1; // 그레인 세기(전체 보기 국소 가중 없음)
    this.motion = 1;
    this.active = false;
    this.renders = 0; // 시험용: 후처리로 그린 프레임 수
    this._size = new THREE.Vector2();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uAmp: { value: 1 }, uAmpG: { value: 1 }, uGrainPx: { value: 2 }, uMotion: { value: 1 },
        uFull: { value: 1 }, uCount: { value: 0 },
        uReg: { value: Array.from({ length: MAX_REGIONS }, () => new THREE.Vector4()) },
        uPur: { value: Array.from({ length: MAX_REGIONS }, () => new THREE.Vector4(-1, 0, 0, 0)) },
        uBurst: { value: new Array(MAX_REGIONS).fill(0) },
        uMainN: { value: 0 },
        uMain: { value: Array.from({ length: MAX_REGIONS }, () => new THREE.Vector4()) },
        uMOff: { value: Array.from({ length: MAX_REGIONS }, () => new THREE.Vector4()) },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.t0 = performance.now();
  }

  /** 표현 모드 장면에 붙인다(전환 때 다시 부름) */
  attach(view) {
    if (this.view === view) return;
    this.detach();
    if (!view || !view.renderer) return;
    this.view = view;
    const r = view.renderer;
    const orig = r.render;
    this._orig = orig;
    const self = this;
    r.render = function (scene, camera) {
      if (!self.active || r.getRenderTarget() !== null || scene === self.qScene) return orig.call(r, scene, camera);
      self._pass(r, orig, scene, camera);
    };
  }

  detach() {
    if (this.view && this.view.renderer && this._orig) {
      try { delete this.view.renderer.render; } catch (e) { /* 무시 */ }
      if (this.view.renderer.render !== this._orig) this.view.renderer.render = this._orig;
    }
    this.view = null; this._orig = null;
    this._freeRT();
  }

  _freeRT() { if (this.rt) { this.rt.dispose(); this.rt = null; } }

  _pass(r, orig, scene, camera) {
    r.getDrawingBufferSize(this._size);
    const w = Math.max(1, this._size.x), h = Math.max(1, this._size.y);
    // 장면은 평소처럼 화면에 그린 뒤(안티에일리어싱·혼합·색 변환이 꺼짐 상태와 똑같음) 그 화면을 텍스처로 복사해 셰이더에 넘긴다.
    // 예전 HalfFloat 렌더 타깃은 반투명·가산 혼합을 선형 공간에서 해 효과 세기 0 에서도 화면이 달라졌다(밝기 +2～3, 픽셀 8%)
    orig.call(r, scene, camera);
    if (!this.rt || this.rt.image.width !== w || this.rt.image.height !== h) {
      this._freeRT();
      this.rt = new THREE.FramebufferTexture(w, h);
      this.rt.minFilter = THREE.LinearFilter; this.rt.magFilter = THREE.LinearFilter;
    }
    r.copyFramebufferToTexture(this.rt);
    const u = this.mat.uniforms;
    u.tDiffuse.value = this.rt;
    u.uRes.value.set(w, h);
    u.uTime.value = this.motion ? ((performance.now() - this.t0) / 1000) % 600 : 0;
    u.uAmp.value = this.amp;
    u.uAmpG.value = this.ampGrain;
    u.uGrainPx.value = Math.max(2, Math.round((r.getPixelRatio ? r.getPixelRatio() : 1) * 1.5)); // 입자 CSS 1.5～2px
    u.uMotion.value = this.motion;
    u.uFull.value = this.targets.full ? 1 : 0;
    const list = this.targets.list;
    const n = Math.min(MAX_REGIONS, list.length);
    u.uCount.value = n;
    for (let i = 0; i < n; i++) {
      const t = list[i];
      u.uReg.value[i].set(t.x || 0, t.y || 0, t.r || 1, t.L || 0);
      if (t.purge) u.uPur.value[i].set(t.purge.p, t.purge.oldL, this.motion ? 1 : 0, 0);
      else u.uPur.value[i].set(-1, 0, 0, 0);
      u.uBurst.value[i] = t.burst || 0;
    }
    const ms = this.targets.mains || [];
    const nm = Math.min(MAX_REGIONS, ms.length);
    u.uMainN.value = nm;
    for (let i = 0; i < nm; i++) {
      const m = ms[i];
      u.uMain.value[i].set(m.x, m.y, m.r, m.D);
      u.uMOff.value[i].set(m.ax, m.ay, m.bx, m.by);
    }
    const ac = r.autoClear;
    r.autoClear = false; // 복사본이 화면 전체를 덮는다(깊이·색 지우기 불필요)
    orig.call(r, this.qScene, this.qCam);
    r.autoClear = ac;
    this.renders++;
  }

  /** 꺼질 때 렌더 타깃까지 돌려줘 비용 0 */
  setActive(on) {
    if (this.active === !!on) return;
    this.active = !!on;
    if (!on) this._freeRT();
  }

  dispose() {
    this.detach();
    this.mat.dispose(); this.quad.geometry.dispose();
  }
}
