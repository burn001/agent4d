// 흐름 3D 분리 프로세스 장치 — 세운 상자(chips.js 깃발 3)에 덧붙이는 것: 위에서 도는 로터 · 앞면 계기판(숫자 드럼·처리율 꼬리·과열 눈금) ·
// 열기 아지랑이 · 정체 경고 점 · 끝 정리 파동 · 감독 스캔 빛/기다림 고리/되돌아오는 패킷 · 진행 줄 눈금 패킷 · 마우스 올림 작은 카드.
// 그리기 호출: 효과 인스턴스 1번(로터·아지랑이·고리·파동·점·눈금 패킷 = 셰이더 모드) + 스캔 리본 1번 + 계기판 판(가까운 장치만, 풀 RIG.FACE_MAX).
// 프레임마다 객체를 만들지 않는다(장치 메모는 vis 에, 버퍼는 고정 크기 재사용). 숫자·과열·ETA·펄스는 job-core 공용 함수(proc-rig-core 경유).
import * as THREE from 'three';
import { RIG, rigModel, rotorTarget, spinStep, heatRgb, drumCells, fmtCompact, tickPhase, RateTrail, watchFx, rigLod, alarmBlink, endTone, rigEnded, rigTipHtml, shortDur, tapeStep } from './proc-rig-core.mjs';
import { paletteOf, beamPoint } from './flow-style.mjs';
import { STAND } from './tier-core.mjs';
import { procOf, procJobId, jobOf } from '../job-core.mjs';
import { t as tr } from '../i18n.mjs';

const FX_CAP = 384;
const SW_CAP = 48, SW_SEG = 24, SW_VPR = (SW_SEG + 1) * 2;
const MONO = 'ui-monospace, "Cascadia Mono", "JetBrains Mono", Consolas, monospace';
const FW = 512, FH = 288; // 계기판 캔버스(장치 앞면 1.45:0.82 비율)
const M = { ROTOR: 0, HAZE: 1, RING: 2, WAVE: 3, DOT: 4, TICK: 5 };

const FX_VS = `
attribute vec4 iPos; attribute vec4 iM; attribute vec4 iCol;
uniform vec3 uRight; uniform vec3 uUp;
varying vec2 vUv; varying vec4 vM; varying vec4 vCol;
void main() {
  vUv = position.xy; vM = iM; vCol = iCol;
  float mode = floor(iM.x + 0.5);
  vec3 w;
  if (mode < 0.5 || (mode > 1.5 && mode < 3.5)) w = iPos.xyz + vec3(position.x, 0.0, -position.y) * iPos.w; // 로터·고리·파동: 바닥과 나란히
  else if (mode < 1.5) { vec3 r = normalize(vec3(uRight.x, 0.0, uRight.z) + vec3(1e-5, 0.0, 0.0)); w = iPos.xyz + r * position.x * iPos.w * 0.5 + vec3(0.0, (position.y + 1.0) * iPos.w, 0.0); } // 아지랑이: 세로 빌보드(바닥이 iPos)
  else w = iPos.xyz + (uRight * position.x + uUp * position.y) * iPos.w; // 점·눈금 패킷: 빌보드
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const FX_FS = `
uniform float uTime; uniform float uLight;
varying vec2 vUv; varying vec4 vM; varying vec4 vCol;
void main() {
  float mode = floor(vM.x + 0.5);
  vec2 p = vUv; float l = length(p); float a = 0.0;
  if (mode < 0.5) {            // 로터: 바깥 테 + 허브 + 날개 셋(vM.y = 각) + 날개 뒤 잔상(vM.w = 각속도 비율) + 과열 빛무리(vM.z)
    float ang = atan(p.y, p.x) - vM.y;
    float rim = smoothstep(0.06, 0.0, abs(l - 0.88)) * 0.95;
    float rim2 = smoothstep(0.03, 0.0, abs(l - 0.74)) * 0.35;
    float hub = smoothstep(0.2, 0.13, l) * 0.9 + smoothstep(0.03, 0.0, abs(l - 0.24)) * 0.6;
    float c3 = cos(ang * 1.5);
    float blade = pow(abs(c3), 22.0) * step(l, 0.86) * step(0.18, l) * 0.85;
    // 잔상: 날개 진행 방향 뒤로 옅게(돌 때만)
    float ph = fract(-ang / 2.0943951 + 0.5);
    float trail = vM.w * smoothstep(0.62, 1.0, ph) * 0.28 * step(l, 0.86) * step(0.18, l);
    float glow = exp(-abs(l - 0.88) * 9.0) * 0.18 * vM.z;
    a = max(max(max(rim, rim2), hub), max(blade, max(trail, glow)));
    a *= smoothstep(1.0, 0.94, l);
  } else if (mode < 1.5) {     // 열기 아지랑이: 위로 흔들리며 올라가는 옅은 줄기(vM.y = 씨앗)
    float y = (p.y + 1.0) * 0.5;
    float x = p.x + 0.22 * sin(y * 7.0 - uTime * 2.4 + vM.y) * y;
    float st = smoothstep(0.55, 0.0, abs(x)) * (0.55 + 0.45 * sin(y * 16.0 - uTime * 4.2 + vM.y * 3.0));
    a = st * (1.0 - y) * smoothstep(0.0, 0.18, y) * 0.55;
  } else if (mode < 2.5) {     // 기다림 고리: 도는 점선 고리 + 안쪽 가는 고리
    float ang = atan(p.y, p.x);
    float dash = step(0.45, fract(ang / 6.2831853 * 28.0 - uTime * 0.6));
    a = smoothstep(0.05, 0.0, abs(l - 0.92)) * (0.3 + 0.7 * dash) + smoothstep(0.025, 0.0, abs(l - 0.8)) * 0.3;
  } else if (mode < 3.5) {     // 끝 정리 파동(vM.y = 진행 0..1)
    float r = 0.2 + 0.8 * vM.y;
    a = (smoothstep(0.07, 0.0, abs(l - r)) + smoothstep(0.25, 0.0, abs(l - r)) * 0.3) * (1.0 - vM.y);
  } else if (mode < 4.5) {     // 점(정체 경고)
    a = smoothstep(1.0, 0.45, l) * 0.5 + smoothstep(0.5, 0.35, l);
  } else {                     // 눈금 패킷: 작은 마름모 + 빛무리
    float d = abs(p.x) + abs(p.y);
    a = max(smoothstep(0.55, 0.42, d), exp(-l * 3.2) * 0.45);
  }
  a *= vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb, min(1.0, a));
}`;

const SW_VS = `
attribute float aU; attribute vec4 aC; attribute vec3 aW;
varying float vU; varying vec4 vC; varying vec3 vW;
void main() { vU = aU; vC = aC; vW = aW; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const SW_FS = `
uniform float uTime;
varying float vU; varying vec4 vC; varying vec3 vW;
void main() {
  float head = vW.x, tail = vW.y, mode = floor(vW.z + 0.5), a;
  if (mode < 0.5) { float k = smoothstep(tail, head, vU) * step(vU, head + 0.01); a = k * k * (0.35 + 0.65 * smoothstep(head - 0.08, head, vU)); }  // 스캔: 머리가 가장 밝은 빛 토막
  else if (mode < 1.5) a = step(0.55, fract(vU * 22.0 - uTime * 1.1)) * 0.55;            // 기다림 실: 감독 → 장치로 흐르는 점선
  else { float d = (vU - head) * 16.0; a = exp(-d * d); }                                  // 되돌아오는 패킷
  a *= vC.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vC.rgb, min(1.0, a));
}`;

export class ProcRigs {
  constructor(scene, view) {
    this.view = view;
    this.scene = scene;
    // 효과 인스턴스
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(FX_CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iPos = mk(); this.iM = mk(); this.iCol = mk();
    g.setAttribute('iPos', this.iPos); g.setAttribute('iM', this.iM); g.setAttribute('iCol', this.iCol);
    g.instanceCount = 0;
    this.fxGeo = g;
    this.uni = { uTime: { value: 0 }, uLight: { value: 0 }, uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) } };
    this.fxMat = new THREE.ShaderMaterial({ uniforms: this.uni, vertexShader: FX_VS, fragmentShader: FX_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.fx = new THREE.Mesh(g, this.fxMat);
    this.fx.frustumCulled = false;
    this.fx.renderOrder = 2.6; // 빔(2) 다음·패킷(3) 전
    // 감독 스캔 리본
    const sg = new THREE.BufferGeometry();
    this.swPos = new Float32Array(SW_CAP * SW_VPR * 3); this.swU = new Float32Array(SW_CAP * SW_VPR); this.swC = new Float32Array(SW_CAP * SW_VPR * 4); this.swW = new Float32Array(SW_CAP * SW_VPR * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(this.swPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aU', new THREE.BufferAttribute(this.swU, 1).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aC', new THREE.BufferAttribute(this.swC, 4).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aW', new THREE.BufferAttribute(this.swW, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(SW_CAP * SW_SEG * 6);
    for (let r = 0; r < SW_CAP; r++) for (let i = 0; i < SW_SEG; i++) {
      const v = r * SW_VPR + i * 2, o = (r * SW_SEG + i) * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v + 1; idx[o + 4] = v + 3; idx[o + 5] = v + 2;
    }
    sg.setIndex(new THREE.BufferAttribute(idx, 1));
    sg.setDrawRange(0, 0);
    this.swGeo = sg;
    this.swMat = new THREE.ShaderMaterial({ uniforms: { uTime: this.uni.uTime }, vertexShader: SW_VS, fragmentShader: SW_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.sw = new THREE.Mesh(sg, this.swMat);
    this.sw.frustumCulled = false;
    this.sw.renderOrder = 2.7;
    scene.add(this.fx, this.sw);
    // 계기판 판 풀(가까운 장치부터)
    this.faceGeo = new THREE.PlaneGeometry(1, 1);
    this.faces = [];
    this.ticks = [];   // [{from(proc id), to(parent id), t0(초)}] — 고정 상한 순환
    this._rigs = [];
    this._rgb = [0, 0, 0];
    this._pt = { x: 0, y: 0, z: 0 }; this._pt2 = { x: 0, y: 0, z: 0 };
    this._v3 = new THREE.Vector3();
    this.isLight = false;
    this.P = paletteOf(false);
    this.stats = { rigs: 0, faces: 0, fx: 0, sweeps: 0, ticks: 0 };
    // 마우스 올림 작은 카드(장치 옆)
    this.tip = null;
    this._tipKey = '';
  }

  applyTheme(isLight) {
    this.isLight = !!isLight;
    this.P = paletteOf(this.isLight);
    this.uni.uLight.value = this.isLight ? 1 : 0;
    const blend = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (const m of [this.fxMat, this.swMat]) if (m.blending !== blend) { m.blending = blend; m.needsUpdate = true; }
    for (const f of this.faces) f.key = '';
  }

  clear() { this.ticks.length = 0; for (const f of this.faces) { f.owner = null; f.mesh.visible = false; } if (this.tip) this.tip.hidden = true; }

  /** 진행 줄 눈금 패킷 n 개(장치 → 띄운 노드). flowEvent 의 작업 node-update 에서 */
  emitTicks(v, n) {
    if (!v || !n || this.view.reduced) return;
    const now = performance.now() / 1000;
    for (let i = 0; i < Math.min(2, n); i++) {
      if (this.ticks.length >= RIG.TICK_MAX) this.ticks.shift();
      this.ticks.push({ from: v.id, t0: now + i * 0.18, k: this.ticks.length });
    }
  }

  // ---- 프레임 ----
  update(now, pulses) {
    const view = this.view, cam = view.camera, nowMs = view.clock ? view.clock() : Date.now();
    const dt = this._t != null ? Math.min(0.25, Math.max(0, now - this._t)) : 0; this._t = now;
    this.uni.uTime.value = view.reduced ? 0 : now % 1000;
    // 카메라 오른쪽·위(빌보드)
    const e = cam.matrixWorld.elements;
    this.uni.uRight.value.set(e[0], e[1], e[2]).normalize(); this.uni.uUp.value.set(e[4], e[5], e[6]).normalize();
    const H = view.container.clientHeight || 1, f = H / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const P = this.P, L = this.isLight, rgb = this._rgb;
    const ws = Math.max(1, (view.focusDist || cam.position.length()) / 38); // 멀면 리본·패킷을 키움(빔과 같은 규칙 — 1px 아래로 사라지지 않게)
    const IP = this.iPos.array, IM = this.iM.array, IC = this.iCol.array;
    let k = 0;
    const put = (mode, x, y, z, size, a, b, c, r, g2, bl, al) => {
      if (k >= FX_CAP || al < 0.004) return;
      const o = k * 4;
      IP[o] = x; IP[o + 1] = y; IP[o + 2] = z; IP[o + 3] = size;
      IM[o] = mode; IM[o + 1] = a; IM[o + 2] = b; IM[o + 3] = c;
      IC[o] = r; IC[o + 1] = g2; IC[o + 2] = bl; IC[o + 3] = al;
      k++;
    };
    const rigs = this._rigs; rigs.length = 0;
    const col = this._col || (this._col = new THREE.Color());
    for (const v of view.vis.values()) {
      if (!v.procRig || v.gone || v.hidden) continue;
      const sk = v.scopeK ?? 1;
      const fade = (v.exitF ?? 1) * Math.min(1, sk * 1.3);
      if (fade < 0.02) continue;
      const node = v.node, jv = view.vis.get(procJobId(node));
      const m = rigModel(node, jv ? jv.node : null, nowMs);
      if (!m) continue;
      const R = v._rigR || (v._rigR = { spin: {}, trail: new RateTrail(), st: null, waveT: -1, waveTone: null, ticks: new Map() });
      // 상태 바뀜 → 끝 정리 파동(처음 보는 끝 상태는 파동 없음 — 스냅샷)
      if (R.st !== m.state) {
        if (R.st != null && !rigEnded(R.st) && m.ended) { R.waveT = now; R.waveTone = endTone(m.state); }
        R.st = m.state;
      }
      // 처리율 꼬리(주 레인 갱신마다)
      if (m.primary && jv) { const pl = (jobOf(jv.node).lanes || []).find((x) => x.key === m.primary.key); if (pl) R.trail.push(pl.at + '|' + pl.n, pl.rate); }
      const s = v.mesh.scale.x;
      const p = v.group.position;
      const d = Math.max(0.01, p.distanceTo(cam.position));
      const px = (s * f) / d;
      const lod = rigLod(px);
      const yaw = v._stand && v._stand.yaw != null ? v._stand.yaw : 0;
      const hy = STAND.DEV_HY * s, top = p.y + hy;
      // 색: 돌아가는 중 = 과열 색, 그 밖 상태색(chips 와 같은 값). rgb = 화면(sRGB, 계기판 캔버스용), col = 셰이더용(THREE.Color 작업 공간 — 칩과 같은 밝기 감)
      if (m.code === 0) { heatRgb(m.heat, L, rgb); col.setRGB(rgb[0], rgb[1], rgb[2]); } // 과열 표는 화면 값 그대로(셰이더가 색 변환 없이 씀 — chips 와 같음)
      else { col.set(m.code === 1 ? P.jobStale : m.code === 2 ? P.done : m.code === 3 ? P.error : P.stopped); col.getRGB(this._srgb || (this._srgb = new THREE.Color()), THREE.SRGBColorSpace); rgb[0] = this._srgb.r; rgb[1] = this._srgb.g; rgb[2] = this._srgb.b; }
      const cr = col.r, cg = col.g, cb = col.b;
      // 로터
      const ang = spinStep(R.spin, rotorTarget(m.state, m.heat, view.reduced), dt);
      const wk = Math.min(1, Math.abs(R.spin.w || 0) / RIG.SPIN_RUN);
      const rotA = (m.ended ? 0.4 : 0.62) * fade * (L ? 1.2 : 1);
      put(M.ROTOR, p.x, top + 0.1 * s, p.z, 1.05 * s, ang, m.code === 0 ? m.heat : 0, lod > 0 ? wk : 0, cr, cg, cb, rotA);
      // 열기 아지랑이(다크·움직임 있음·과열 warm 이상)
      if (!L && !view.reduced && m.code === 0 && m.heat >= 0.33 && lod > 0) put(M.HAZE, p.x, top + 0.18 * s, p.z, 1.6 * s, 0, v.seed || 0, 0, cr, cg * 0.85, cb * 0.7, fade * (m.heat - 0.25) * 0.3);
      // 정체 경고 점(오른쪽 위 모서리 위, 깜빡임)
      if (m.code === 1) {
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        put(M.DOT, p.x + rx * 1.32 * s, top + 0.32 * s, p.z + rz * 1.32 * s, 0.26 * s, 0, 0, 0, cr, cg, cb, fade * alarmBlink(now, view.reduced));
      }
      // 끝 정리 파동
      if (R.waveT >= 0) {
        const q = (now - R.waveT) / (RIG.WAVE_MS / 1000);
        if (q >= 1 || view.reduced) R.waveT = -1;
        else {
          col.set(R.waveTone === 'error' ? P.error : R.waveTone === 'stopped' ? P.stopped : P.done);
          put(M.WAVE, p.x, p.y - hy, p.z, 3.4 * s, q, 0, 0, col.r, col.g, col.b, fade * 0.9);
        }
      }
      rigs.push({ v, m, px, lod, yaw, s, R, rgb0: rgb[0], rgb1: rgb[1], rgb2: rgb[2], fade, check: 0 });
    }
    // 감독 펄스: 스캔 리본·기다림 고리·체크·되돌아오는 패킷
    let sr = 0;
    if (pulses && pulses.length) {
      const hc = this._hc || (this._hc = new THREE.Color());
      hc.set(L ? P.holoBright : P.holo);
      for (const pu of pulses) {
        const fv = view.vis.get(pu.from), tv = view.vis.get(pu.to);
        if (!fv || !tv || fv.gone || tv.gone || fv.hidden || tv.hidden) continue;
        const fx = watchFx(pu);
        const fade = Math.min(fv.exitF ?? 1, tv.exitF ?? 1) * Math.min(1, Math.min(fv.scopeK ?? 1, tv.scopeK ?? 1) * 1.3);
        if (fade < 0.05) continue;
        const a = view.linkEnd ? view.linkEnd(fv, true) : fv.group.position, b = view.linkEnd ? view.linkEnd(tv, false) : tv.group.position;
        const al = (L ? 0.85 : 1) * fade;
        if (fx.sweep && sr < SW_CAP) this._ribbon(sr++, a, b, 0.26 * ws, hc, al * fx.sweep.alpha, fx.sweep.head, fx.sweep.tail, 0);
        if (fx.thread > 0 && sr < SW_CAP) this._ribbon(sr++, a, b, 0.06 * ws, hc, al * fx.thread * 0.7, 0, 0, 1);
        if (fx.back != null && sr < SW_CAP) this._ribbon(sr++, a, b, 0.36 * ws, hc, al, fx.back, 0, 2);
        const rs = tv.mesh.scale.x, tp = tv.group.position;
        if (fx.ring > 0 && tv.procRig) put(M.RING, tp.x, tp.y - STAND.DEV_HY * rs - 0.05, tp.z, 2.25 * rs, 0, 0, 0, hc.r, hc.g, hc.b, al * fx.ring * 0.8);
        if (fx.check > 0) for (const rg of rigs) if (rg.v === tv) rg.check = Math.max(rg.check, fx.check);
      }
    }
    // 진행 줄 눈금 패킷: 장치 위로 튀어 올랐다가 흐름선(띄운 노드 → 장치 빔)을 거슬러 띄운 노드까지
    const tc = this._tc || (this._tc = new THREE.Color());
    tc.set(L ? '#b45309' : '#ffd27a');
    let nt = 0;
    for (let i = this.ticks.length - 1; i >= 0; i--) {
      const t = this.ticks[i];
      const ph = tickPhase((now - t.t0) * 1000);
      if (now < t.t0) continue;
      if (!ph) { this.ticks.splice(i, 1); continue; }
      const v = view.vis.get(t.from);
      const pv = v && view.vis.get(v.node.parentId);
      if (!v || !pv || v.gone || pv.gone || v.hidden || pv.hidden) { this.ticks.splice(i, 1); continue; }
      const a = view.linkEnd ? view.linkEnd(pv, true) : pv.group.position, b = view.linkEnd ? view.linkEnd(v, false) : v.group.position;
      const pt = beamPoint(this._pt, a, b, ph.u, 0, true);
      const lift = ph.pop * 1.1 * v.mesh.scale.x * (ph.u >= 1 ? 1 : 0.25);
      put(M.TICK, pt.x, pt.y + lift, pt.z, 0.34 * Math.min(ws, 3), 0, 0, 0, tc.r, tc.g, tc.b, ph.alpha * (L ? 0.95 : 1) * (v.exitF ?? 1));
      nt++;
    }
    this.fxGeo.instanceCount = k;
    if (k) { this.iPos.needsUpdate = true; this.iM.needsUpdate = true; this.iCol.needsUpdate = true; }
    this.swGeo.setDrawRange(0, sr * SW_SEG * 6);
    if (sr) { const A = this.swGeo.attributes; A.position.needsUpdate = true; A.aU.needsUpdate = true; A.aC.needsUpdate = true; A.aW.needsUpdate = true; }
    this._faces(now, nowMs, rigs);
    this._tipPass(rigs, nowMs);
    this.stats.rigs = rigs.length; this.stats.fx = k; this.stats.sweeps = sr; this.stats.ticks = nt;
  }

  /** 스캔 리본 하나: a(감독) → b(장치) 빔과 같은 곡선, 카메라를 향한 너비 w */
  _ribbon(r, a, b, w, c, al, head, tail, mode) {
    const P = this.swPos, U = this.swU, C = this.swC, W = this.swW, cam = this.view.camera.position;
    const pt = this._pt, pn = this._pt2;
    let o = r * SW_VPR;
    for (let i = 0; i <= SW_SEG; i++) {
      const u = i / SW_SEG;
      beamPoint(pt, a, b, u, 0, true);
      beamPoint(pn, a, b, Math.min(1, u + 0.02), 0, true);
      let tx = pn.x - pt.x, ty = pn.y - pt.y, tz = pn.z - pt.z;
      if (u >= 1) { beamPoint(pn, a, b, u - 0.02, 0, true); tx = pt.x - pn.x; ty = pt.y - pn.y; tz = pt.z - pn.z; }
      const vx = cam.x - pt.x, vy = cam.y - pt.y, vz = cam.z - pt.z;
      let nx = ty * vz - tz * vy, ny = tz * vx - tx * vz, nz = tx * vy - ty * vx;
      const nl = Math.hypot(nx, ny, nz) || 1, hw = w / 2;
      nx *= hw / nl; ny *= hw / nl; nz *= hw / nl;
      for (let j = 0; j < 2; j++) {
        const sg = j ? -1 : 1, q = o * 3;
        P[q] = pt.x + nx * sg; P[q + 1] = pt.y + ny * sg; P[q + 2] = pt.z + nz * sg;
        U[o] = u;
        C[o * 4] = c.r; C[o * 4 + 1] = c.g; C[o * 4 + 2] = c.b; C[o * 4 + 3] = al;
        W[o * 3] = head; W[o * 3 + 1] = tail; W[o * 3 + 2] = mode;
        o++;
      }
    }
  }

  // ---- 계기판(캔버스 판) ----
  _face(i) {
    let fc = this.faces[i];
    if (fc) return fc;
    const cv = document.createElement('canvas'); cv.width = FW; cv.height = FH;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.FrontSide, toneMapped: false });
    const mesh = new THREE.Mesh(this.faceGeo, mat);
    mesh.renderOrder = 1.2; // 칩 색(1) 다음 — 장치 앞면 위에
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.scene.add(mesh);
    fc = { cv, ctx: cv.getContext('2d'), tex, mat, mesh, owner: null, at: -1e9, key: '' };
    this.faces[i] = fc;
    return fc;
  }
  _faces(now, nowMs, rigs) {
    // 가까운(화면에 큰) 장치부터 풀 자리를 줌 — 이미 자리가 있는 장치는 그 자리를 지킴(깜빡임 없이)
    const want = rigs.filter((r) => r.lod >= 1).sort((a, b) => b.px - a.px).slice(0, RIG.FACE_MAX);
    const keep = new Set(want.map((r) => r.v.id));
    for (const fc of this.faces) if (fc.owner && !keep.has(fc.owner)) { fc.owner = null; fc.mesh.visible = false; }
    let used = 0;
    for (const r of want) {
      let fc = this.faces.find((x) => x.owner === r.v.id);
      if (!fc) {
        let i = this.faces.findIndex((x) => !x.owner);
        if (i < 0) i = this.faces.length;
        fc = this._face(i); fc.owner = r.v.id; fc.key = ''; fc.at = -1e9;
      }
      used++;
      // 자리: 앞면(방위 yaw, 앞 = (sin, 0, cos)) 바로 앞
      const v = r.v, p = v.group.position, s = r.s;
      const fw = Math.sin(r.yaw), fz = Math.cos(r.yaw);
      const off = RIG.THICK * s * 0.5 + 0.02;
      fc.mesh.position.set(p.x + fw * off, p.y, p.z + fz * off);
      fc.mesh.rotation.set(0, r.yaw, 0);
      fc.mesh.scale.set(2 * STAND.DEV_HX * s * 0.94, 2 * STAND.DEV_HY * s * 0.9, 1);
      fc.mat.opacity = r.fade * (r.v.tierDim ? 1 - r.v.tierDim * 0.5 : 1);
      fc.mesh.visible = true;
      // 다시 그리기: 움직이는 것(돌아가는 중·정체 깜빡임·체크)은 FACE_FPS(먼 것 FACE_FPS_FAR), 끝난 장치는 내용이 바뀔 때만
      const anim = !r.m.ended || r.check > 0;
      const fps = r.lod >= 2 ? RIG.FACE_FPS : RIG.FACE_FPS_FAR;
      const key = `${r.lod}|${r.m.state}|${r.m.code}|${this.isLight ? 1 : 0}|${r.m.lanes.map((l) => Math.floor(l.value)).join(',')}|${r.check > 0 ? 1 : 0}`;
      if ((anim && now - fc.at >= 1 / fps) || key !== fc.key) {
        fc.at = now; fc.key = key;
        this._drawFace(fc.ctx, r, now, nowMs);
        fc.tex.needsUpdate = true;
      }
    }
    this.stats.faces = used;
  }

  _drawFace(g, r, now, nowMs) {
    const m = r.m, L = this.isLight, P = this.P, reduced = this.view.reduced;
    g.clearRect(0, 0, FW, FH);
    const hot = `rgb(${Math.round(r.rgb0 * 255)},${Math.round(r.rgb1 * 255)},${Math.round(r.rgb2 * 255)})`;
    const ink = L ? '#0b2a44' : '#e6fbff', dim = L ? '#3d5f7a' : '#8fc3d6', faint = L ? 'rgba(11,42,68,.18)' : 'rgba(150,220,255,.16)';
    // 상태 등 + 글자
    const led = m.code === 0 ? hot : m.code === 1 ? P.jobStale : m.code === 2 ? P.done : m.code === 3 ? P.error : P.stopped;
    const blink = m.code === 1 ? alarmBlink(now, reduced) : m.code === 0 && !reduced ? 0.7 + 0.3 * Math.sin(now * 6) : 1;
    if (r.lod < 2) { // 먼 장치: 큰 숫자 하나(주 레인) + 등
      g.globalAlpha = blink; g.fillStyle = led; g.beginPath(); g.arc(30, 40, 13, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
      const pv = m.primary;
      g.fillStyle = m.code === 0 ? (L ? ink : this._mixW(r, 0.55)) : ink;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const txt = pv ? fmtCompact(pv.value) : m.ended ? (m.code === 2 ? '✓' : m.code === 3 ? '✕' : '■') : '…';
      g.font = `700 ${txt.length > 6 ? 112 : 136}px ${MONO}`;
      g.fillText(txt, FW / 2, FH / 2 + 12);
      return;
    }
    // 머리줄: 등 · 상태(회차) · 오른쪽 과열 눈금 6칸
    g.globalAlpha = blink; g.fillStyle = led; g.beginPath(); g.arc(26, 30, 10, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = `600 24px ${MONO}`; g.fillStyle = m.code === 0 ? ink : led;
    const pass = m.primary && m.primary.pass > 1 ? ' · ' + tr('cards.lane.pass', { n: m.primary.pass }) : '';
    const rc = procOf(r.v.node).rc;
    g.fillText(tr('cards.proc.st.' + m.state) + (m.ended && rc != null ? ` · rc ${rc}` : '') + pass, 46, 31);
    const segs = 6, hx = FW - 16 - segs * 20;
    for (let i = 0; i < segs; i++) {
      const on = m.heat * segs > i + 0.15;
      heatRgb((i + 0.5) / segs, L, this._rgb);
      g.fillStyle = on ? `rgb(${Math.round(this._rgb[0] * 255)},${Math.round(this._rgb[1] * 255)},${Math.round(this._rgb[2] * 255)})` : faint;
      g.fillRect(hx + i * 20, 18 + (segs - i) * 1.5, 15, 26 - (segs - i) * 1.5);
    }
    // 체크(들여다본 결과에 진행 줄)
    if (r.check > 0) {
      g.globalAlpha = Math.min(1, r.check * 1.4); g.strokeStyle = P.done; g.lineWidth = 7; g.lineCap = 'round';
      g.beginPath(); g.moveTo(hx - 52, 30); g.lineTo(hx - 40, 42); g.lineTo(hx - 18, 16); g.stroke(); g.globalAlpha = 1;
    }
    // 레인 줄(1 = 크게, 2 = 둘로 나눔)
    const lanes = m.lanes, n = Math.max(1, lanes.length);
    const top0 = 58, rowH = n === 1 ? 160 : 86;
    if (!lanes.length) {
      g.fillStyle = dim; g.font = `500 26px ${MONO}`; g.textAlign = 'center';
      g.fillText(m.ended ? '' : '…', FW / 2, top0 + 70);
    }
    for (let i = 0; i < lanes.length; i++) this._laneRow(g, lanes[i], 14, top0 + i * rowH, FW - 28, rowH - 8, n === 1, r, ink, dim, faint);
    if (m.more > 0) { g.fillStyle = dim; g.font = `500 18px ${MONO}`; g.textAlign = 'right'; g.fillText('+' + m.more, FW - 16, top0 + n * rowH - 4); }
    // 바닥줄: 처리율 꼬리 그래프 + 처리율 글자 · ETA 또는 최장 시간
    const fy = FH - 46;
    const hs = r.R.trail.heights(this._hs || (this._hs = []));
    if (hs.length > 1) {
      const gx = 16, gw = FW * 0.5, gh = 34;
      g.strokeStyle = m.code === 0 ? hot : dim; g.lineWidth = 3; g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i < hs.length; i++) { const x = gx + (gw * i) / (RIG.TRAIL_N - 1), y = fy + gh - hs[i] * gh; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
      g.fillStyle = faint; g.fillRect(gx, fy + gh + 1, gw, 2);
    }
    g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.fillStyle = ink; g.font = `600 26px ${MONO}`;
    g.fillText(m.rateText || '', FW - 16, fy + 22);
    const eta = m.etaMs != null && !m.ended ? tr('cards.lane.eta', { t: shortDur(m.etaMs) }) : m.last ? `${m.last.k} ${m.last.v}${m.last.u || ''}` : '';
    if (eta) { g.fillStyle = dim; g.font = `500 19px ${MONO}`; g.fillText(eta, FW - 16, fy + 46); }
  }
  _mixW(r, k) { const f = (x) => Math.round((x + (1 - x) * k) * 255); return `rgb(${f(r.rgb0)},${f(r.rgb1)},${f(r.rgb2)})`; }

  /** 레인 한 줄: 위 왼쪽 열쇠(흐리게) · 오른쪽 정렬 숫자 드럼 + 단위 · 아래 진행 막대(total) 또는 누적 눈금(테이프) */
  _laneRow(g, l, x, y, w, h, big, r, ink, dim, faint) {
    const L = this.isLight;
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = dim; g.font = `500 ${big ? 22 : 19}px ${MONO}`;
    g.fillText(String(l.key).slice(0, 18), x + 2, y + (big ? 24 : 20));
    // 숫자 드럼
    const fs = big ? 86 : 52, cw = fs * 0.6;
    const cells = drumCells(l.value, this._cells || (this._cells = []));
    const unit = l.unit ? String(l.unit).slice(0, 6) : '';
    g.font = `500 ${big ? 22 : 18}px ${MONO}`;
    const uw = unit ? g.measureText(unit).width + 8 : 0;
    const right = x + w - uw;
    const base = y + (big ? 112 : 66), lh = fs * 1.02;
    const top = base - fs * 0.86, bot = base + fs * 0.2;
    g.save();
    g.beginPath(); g.rect(x, top, w, bot - top); g.clip();
    g.font = `700 ${fs}px ${MONO}`; g.textAlign = 'center';
    const digCol = r.m.code === 0 ? (L ? ink : this._mixW(r, 0.6)) : ink;
    let cx = right - cw / 2;
    for (let i = cells.length - 1; i >= 0; i--) {
      const c = cells[i], isD = c.ch >= '0' && c.ch <= '9';
      const ww = isD ? cw : cw * 0.5;
      const mx = isD ? cx : cx + cw * 0.25;
      // 숫자 칸 바탕(드럼 창)
      if (isD) { g.fillStyle = faint; g.fillRect(mx - cw / 2 + 2, top + 2, cw - 4, bot - top - 4); }
      g.fillStyle = digCol;
      const ro = this.view.reduced ? 0 : c.roll;
      if (ro > 0.001) {
        g.globalAlpha = 1 - ro * 0.6; g.fillText(c.ch, mx, base - ro * lh);
        g.globalAlpha = 0.4 + ro * 0.6; g.fillText(c.next, mx, base + (1 - ro) * lh);
        g.globalAlpha = 1;
      } else g.fillText(c.ch, mx, base);
      cx -= ww;
    }
    g.restore();
    if (unit) { g.textAlign = 'left'; g.fillStyle = dim; g.font = `500 ${big ? 22 : 18}px ${MONO}`; g.fillText(unit, right + 6, base); }
    // 아래 띠: total 이면 진행 막대 + %, 아니면 누적 눈금(값이 늘면 왼쪽으로 흐름)
    const by = bot + 6, bh = big ? 8 : 6;
    if (l.ratio != null) {
      g.fillStyle = faint; g.fillRect(x, by, w, bh);
      g.fillStyle = r.m.code === 0 ? `rgb(${Math.round(r.rgb0 * 255)},${Math.round(r.rgb1 * 255)},${Math.round(r.rgb2 * 255)})` : dim;
      g.fillRect(x, by, w * l.ratio, bh);
    } else {
      const step = tapeStep(l.rate), off = ((l.value % (step * 10)) / (step * 10)) * 40;
      g.fillStyle = faint; g.fillRect(x, by + bh - 2, w, 2);
      g.fillStyle = dim;
      for (let tx = x + w - off; tx > x; tx -= 4) { const major = Math.abs(((x + w - off - tx) / 4) % 10) < 0.01; g.fillRect(tx, major ? by - 2 : by + 2, 2, major ? bh + 2 : bh - 2); }
    }
  }

  // ---- 마우스 올림 카드 ----
  _tipPass(rigs, nowMs) {
    const view = this.view;
    const id = view.hoverId;
    let r = null;
    if (id) for (const x of rigs) if (x.v.id === id || procJobId(x.v.node) === id) { r = x; break; }
    if (!r) { if (this.tip && !this.tip.hidden) this.tip.hidden = true; this._tipKey = ''; return; }
    if (!this.tip) {
      this.tip = document.createElement('div');
      this.tip.className = 'proc-tip';
      this.tip.setAttribute('role', 'tooltip');
      (view.labelContainer || document.body).appendChild(this.tip);
    }
    const html = rigTipHtml(r.m, r.v.node);
    if (html !== this._tipKey) { this.tip.innerHTML = html; this._tipKey = html; }
    this.tip.style.setProperty('--hc', `rgb(${Math.round(r.rgb0 * 255)},${Math.round(r.rgb1 * 255)},${Math.round(r.rgb2 * 255)})`);
    // 자리: 장치 오른쪽 화면 좌표
    const v3 = this._v3.copy(r.v.group.position);
    v3.x += Math.cos(r.yaw) * STAND.DEV_HX * r.s; v3.z -= Math.sin(r.yaw) * STAND.DEV_HX * r.s;
    v3.project(view.camera);
    const W = view.container.clientWidth || 1, H = view.container.clientHeight || 1;
    const x = Math.min(W - 240, Math.max(4, (v3.x * 0.5 + 0.5) * W + 14)), y = Math.min(H - 120, Math.max(4, (-v3.y * 0.5 + 0.5) * H - 30));
    this.tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    this.tip.hidden = false;
  }

  dispose() {
    this.fx.removeFromParent(); this.sw.removeFromParent();
    this.fxGeo.dispose(); this.swGeo.dispose(); this.fxMat.dispose(); this.swMat.dispose();
    for (const f of this.faces) { f.mesh.removeFromParent(); f.tex.dispose(); f.mat.dispose(); }
    this.faceGeo.dispose();
    this.faces = [];
    if (this.tip) { this.tip.remove(); this.tip = null; }
  }
}

