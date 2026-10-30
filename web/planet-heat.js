// Planet 3D 에이전트 과열 연출 — PlanetDeco.update 끝에서 한 번. 세기 규칙은 planet-heat-core.mjs(순수), 값은 heat-core.mjs HeatBook.
//  · 표면: 메인 기계 행성 셰이더(planet-deco.js MECH_F)·서브/시안 작은 본체 셰이더(planet-sub.js SUBT_F)의 uHeat — 이음선·테두리 주황 → 균열 용암빛.
//    뚜르비용(planet-tourb.js TourbMain.heat)은 프레임·금 부품 발광이 달아오름.
//  · 글로우·코로나: 장면 공용 인스턴스 빌보드 하나(노드 중심, 본체가 앞을 가려 둘레로만 보임) — 맥동·코로나 깜빡임·플레어 엽.
//  · 연기: 장면 공용 인스턴스 빌보드 풀(PHEAT.POOL) — 데움 50%↑ = 옅은 가닥 한두 줄, 과열 = 극·해치에서 오르는 가닥, 위험 = 부모 반대쪽으로 흩날리는 짙은 꼬리.
//    노드당 상한(smokeCap, 본체 화면 px 거리 LOD), 멀면 글로우만.
//  · 불티: 궤도계 도구 입자 풀(OrbitSparks) 재사용.
//  · 다크 = 글로우 더하기·연기 보통 섞기(옅은 회색), 라이트 = 곱하기 잉크(— 글로우 주황 잉크, 연기 회색 잉크).
//  · 움직임 줄이기(view.reduced): 연기·불티·플레어·맥동 없음, 정지 글로우와 표면 색만.
//  · 완료·중지·퇴장 = 연출 꺼짐(PHEAT.OFF_S 에 걸쳐). 재생·보관함은 그 시점 meta.ctx(HeatBook 은 reset 때 비움 → 다음 값은 바로 목표).
import * as THREE from 'three';
import { HeatBook } from './heat-core.mjs';
import { PHEAT, heatLook, heatLive, heatOnStep, smokeCap, farK, heatRingK, heatRgb } from './planet-heat-core.mjs';
import { pxRadius, VARIANT_CORE } from './planet-core.mjs';

const GLOW_V = /* glsl */`attribute vec3 iPos; attribute float iR; attribute vec4 iC; attribute vec4 iP; attribute vec3 iX;
varying vec2 vUv; varying vec4 vC; varying vec4 vP; varying vec3 vX;
void main() { vec4 mv = modelViewMatrix * vec4(iPos, 1.0); mv.xy += position.xy * iR; gl_Position = projectionMatrix * mv; vUv = position.xy; vC = iC; vP = iP; vX = iX; }`;
// iC = 색 rgb + 세기 · iP = (맥동 진폭, 맥동 Hz, 위상, 플레어) · iX = (위험, 본체 몫(빌보드 반지름 대비), 플레어 각)
const GLOW_F = /* glsl */`uniform float uT, uLight;
varying vec2 vUv; varying vec4 vC; varying vec4 vP; varying vec3 vX;
void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  float core = clamp(vX.y, 0.05, 0.95);
  float pul = 1.0 + vP.x * sin(uT * 6.2831853 * vP.y + vP.z);
  float halo = pow(1.0 - smoothstep(core * 0.85, 1.0, r), 2.2);
  float ang = atan(vUv.y, vUv.x);
  float fl = 0.62 + 0.38 * sin(ang * 7.0 + uT * 2.3 + vP.z) * sin(ang * 3.0 - uT * 1.7);
  float ring = exp(-pow((r - core * 1.1) / (0.07 + 0.08 * vX.x), 2.0)) * vX.x * fl;
  float da = abs(mod(ang - vX.z + 3.14159265, 6.2831853) - 3.14159265);
  float flare = vP.w * exp(-da * da * 14.0) * smoothstep(1.0, core, r) * step(core * 0.9, r);
  float rim = exp(-pow((r - 0.8) / 0.1, 2.0)) * (0.22 + 0.3 * vX.x); // 후광 바깥 테 — 멀리서 '빛나는 원'으로 읽히게
  float a = clamp(vC.a * (halo * 0.62 * pul + rim * pul + ring * 0.7 * pul + flare * 1.2), 0.0, 1.0);
  if (uLight > 0.5) gl_FragColor = vec4(mix(vec3(1.0), vC.rgb * vec3(0.95, 0.72, 0.62), a * 0.75), 1.0);
  else gl_FragColor = vec4(vC.rgb, a);
}`;
const SMOKE_V = /* glsl */`attribute vec3 iPos; attribute float iS; attribute vec4 iA;
varying vec2 vUv; varying vec4 vA;
void main() { vec4 mv = modelViewMatrix * vec4(iPos, 1.0); float c = cos(iA.w * 6.28), s = sin(iA.w * 6.28); vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y); mv.xy += q * iS; gl_Position = projectionMatrix * mv; vUv = position.xy; vA = iA; }`;
// iA = (짙기, 알파, 불빛 받음, 시드)
const SMOKE_F = /* glsl */`uniform float uLight;
varying vec2 vUv; varying vec4 vA;
void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  float n = 0.5 + 0.5 * sin(vUv.x * 4.7 + vA.w * 23.0) * sin(vUv.y * 3.9 - vA.w * 17.0);
  float m = 1.0 - smoothstep(0.0, 1.0, r); m *= m; // 가장자리가 또렷한 원반으로 읽히지 않게 가운데만 짙게
  float a = vA.y * m * (0.7 + 0.3 * n) * 1.35;
  vec3 warm = vec3(1.0, 0.42, 0.14);
  if (uLight > 0.5) { vec3 ink = mix(vec3(0.5, 0.5, 0.53), vec3(0.26, 0.26, 0.28), vA.x); ink = mix(ink, vec3(0.75, 0.38, 0.22), vA.z * 0.6); gl_FragColor = vec4(mix(vec3(1.0), ink, clamp(a * 0.85, 0.0, 1.0)), 1.0); }
  else { vec3 c = mix(vec3(0.82, 0.82, 0.85), vec3(0.52, 0.5, 0.5), vA.x); /* 다크: 검은 연기는 어두운 배경에 묻혀 멀리서 안 보임 — 김은 밝은 회색, 위험은 짙은 회색 */ c = mix(c, warm, vA.z * 0.7); gl_FragColor = vec4(c, a); }
}`;

const QUAD = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
const QIDX = [0, 1, 2, 0, 2, 3];
function quadGeo(attrs, cap) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(QUAD, 3));
  g.setIndex(QIDX);
  const out = {};
  for (const [name, n] of attrs) { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); out[name] = a; }
  g.instanceCount = 0;
  return { g, a: out };
}
function blend(mat, L, darkBlend) {
  const b = L ? THREE.MultiplyBlending : darkBlend;
  if (mat.blending === b && mat.premultipliedAlpha === L) return;
  mat.blending = b; mat.premultipliedAlpha = L; mat.needsUpdate = true;
}

const GLOW_ATTRS = [['iPos', 3], ['iR', 1], ['iC', 4], ['iP', 4], ['iX', 3]];
const SMOKE_ATTRS = [['iPos', 3], ['iS', 1], ['iA', 4]];
const _wp = new THREE.Vector3(), _d = new THREE.Vector3(), _away = new THREE.Vector3(), _p = new THREE.Vector3(), _ec = new THREE.Color();
const TAU = Math.PI * 2;
const _rgb = [0, 0, 0];

export class PlanetHeat {
  /** view = PlanetView, deco = PlanetDeco(노드 장식 map·_away·sparks) */
  constructor(view, deco) {
    this.view = view; this.deco = deco;
    this.book = new HeatBook();
    this.rec = new Map(); // id → { on, sAcc, tAcc, eAcc, flare, fa, n, U? }
    this.L = null;
    this.stats = { hot: 0, glow: 0, puffs: 0 };
    // 글로우(용량은 모자라면 두 배로)
    this.gCap = 64;
    const gq = quadGeo(GLOW_ATTRS, this.gCap);
    this.gGeo = gq.g; this.gA = gq.a;
    this.gU = { uT: { value: 0 }, uLight: { value: 0 } };
    this.gMat = new THREE.ShaderMaterial({ uniforms: this.gU, vertexShader: GLOW_V, fragmentShader: GLOW_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glow = new THREE.Mesh(this.gGeo, this.gMat);
    this.glow.frustumCulled = false; this.glow.raycast = () => {}; this.glow.renderOrder = 2; this.glow.visible = false;
    view.scene.add(this.glow);
    // 연기 풀(CPU 시뮬레이션, 살아 있는 것만 앞으로 모아 올림)
    const N = PHEAT.POOL;
    this.P = { pos: new Float32Array(N * 3), base: new Float32Array(N * 3), vel: new Float32Array(N * 3), age: new Float32Array(N), life: new Float32Array(N), s0: new Float32Array(N), s1: new Float32Array(N), a0: new Float32Array(N), shade: new Float32Array(N), warm: new Float32Array(N), seed: new Float32Array(N), lift: new Float32Array(N), own: new Array(N).fill(null) };
    this.next = 0; this.live = 0;
    const sq = quadGeo(SMOKE_ATTRS, N);
    this.sGeo = sq.g; this.sA = sq.a;
    this.sU = { uLight: { value: 0 } };
    this.sMat = new THREE.ShaderMaterial({ uniforms: this.sU, vertexShader: SMOKE_V, fragmentShader: SMOKE_F, transparent: true, depthWrite: false, blending: THREE.NormalBlending });
    this.smoke = new THREE.Mesh(this.sGeo, this.sMat);
    this.smoke.frustumCulled = false; this.smoke.raycast = () => {}; this.smoke.renderOrder = 4; this.smoke.visible = false;
    view.scene.add(this.smoke);
  }

  setLight(L) {
    if (this.L === L) return;
    this.L = L;
    this.gU.uLight.value = this.sU.uLight.value = L ? 1 : 0;
    blend(this.gMat, L, THREE.AdditiveBlending);
    blend(this.sMat, L, THREE.NormalBlending);
    for (const r of this.rec.values()) r.tbKey = -1;
  }

  /** 재생 seek·세션 바꿈·표현 전환(reset): 다음 값은 바로 목표, 떠 있던 연기도 지움 */
  clear() {
    this.book.clear(); this.rec.clear();
    this.P.age.fill(0); this.P.life.fill(0); this.P.own.fill(null); this.live = 0;
    this.sGeo.instanceCount = 0; this.gGeo.instanceCount = 0; this.smoke.visible = this.glow.visible = false;
  }

  _growGlow() {
    const cap = this.gCap * 2;
    for (const [name, n] of GLOW_ATTRS) {
      const old = this.gA[name], a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
      a.array.set(old.array); this.gGeo.setAttribute(name, a); this.gA[name] = a;
    }
    this.gCap = cap;
  }

  /** 매 프레임 — ctx = { now, dt, cam, H, L, reduced, sparks } */
  update(now, dt, { cam, H, L, reduced, sparks }) {
    const view = this.view, deco = this.deco, book = this.book;
    this.setLight(L);
    if ((this._pruneAt = (this._pruneAt || 0) + dt) > 0.5) { this._pruneAt = 0; book.prune(view.vis); for (const id of this.rec.keys()) if (!view.vis.has(id)) this.rec.delete(id); }
    const fov = cam.fov;
    const T = reduced ? 0 : now % 3600;
    this.gU.uT.value = T;
    let gn = 0, hot = 0;
    const gA = this.gA;
    for (const v of view.vis.values()) {
      const node = v.node, ctx = node && node.meta && node.meta.ctx;
      let r = this.rec.get(v.id);
      if (!ctx && !r) continue; // 컨텍스트 값이 없는 노드(백그라운드 명령·작업 등)는 비용 없음
      const h = book.step(v.id, node, dt);
      if (!r) { r = { on: 1, sAcc: 0, tAcc: 0, eAcc: 0, flare: 0, fa: 0, n: 0, tbKey: -1, ph: Math.random() * TAU }; this.rec.set(v.id, r); }
      r.on = heatOnStep(r.on, heatLive(v), dt);
      const d = deco.map.get(v.id);
      const eff = h * r.on * (v.group.visible ? 1 : 0);
      r.eff = eff; r.est = !!(ctx && ctx.estimated); // 궤도 링·위성 단계색(tintColor)이 다음 프레임에 읽음
      // 표면 셰이더(값이 바뀔 때만)
      const U = d && (d.U || (d.var && d.var.U));
      if (U && U.uHeat) { if (Math.abs(U.uHeat.value - eff) > 1e-4) U.uHeat.value = eff; U.uHeatT.value = T; }
      if (d && d.tb) { const q = Math.round(eff * 50); if (q !== r.tbKey) { r.tbKey = q; d.tb.heat(q / 50, L); } }
      if (eff < 0.002 || v.hidden || v.gone || !v.group.visible) { r.sAcc = r.tAcc = r.eAcc = 0; r.flare = 0; continue; }
      const op = v.mat.opacity;
      if (!(op > 0.02)) continue;
      const est = !!(ctx && ctx.estimated);
      const lk = heatLook(eff, { reduced, estimated: est });
      const s = v.mesh.scale.x;
      v.group.getWorldPosition(_wp);
      r.x = _wp.x; r.y = _wp.y; r.z = _wp.z; // 연기는 주인 노드를 따라 움직인다(궤도를 도는 행성 뒤에 공 줄이 남지 않게)
      const dist = _wp.distanceTo(cam.position);
      const px = pxRadius(s, dist, fov, H);
      if (px < PHEAT.PX_GLOW) continue;
      const wpp = (2 * Math.tan((fov * Math.PI) / 360) * dist) / Math.max(1, H) * farK(H); // 화면 px 하한 1px 의 세계 길이(REF_H 기준 배율 포함)
      hot++;
      // 본체 반지름: 시안(서브·claude -p)은 작은 본체 둘레, 메인은 뚜르비용까지
      const coreK = d && d.var ? VARIANT_CORE[d.var.name] || 0.4 : d && d.type === 'mech' ? 1.12 : 1;
      const bodyR = s * coreK;
      const fxR0 = d && d.var ? Math.max(bodyR, s * 0.55) : bodyR; // 연기·불티 크기(시안 작은 본체는 너무 작지 않게)
      const fxR = Math.max(fxR0, lk.smokePx * wpp); // 멀리서도 가닥으로 보이게 화면 px 하한
      // 후광: 본체 배수와 '본체 + 화면 px 하한' 중 큰 쪽 — 전체 보기 기본 거리(행성 몇 px)에서도 단계색 원으로 읽힘
      const gR = Math.max(bodyR * lk.glowR, s * (d && d.var ? 0.7 : 0), bodyR + lk.haloPx * wpp) * (L ? 0.92 : 1);
      // 플레어(위험): 가끔 짧게 한쪽으로 솟음
      if (!reduced && lk.flare > 0 && r.flare < 0.05 && Math.random() < dt * lk.flare) { r.flare = 1; r.fa = Math.random() * TAU; }
      r.flare = Math.max(0, r.flare - dt * 2.2);
      if (gn >= this.gCap) this._growGlow();
      const A = this.gA, i3 = gn * 3, i4 = gn * 4;
      A.iPos.array[i3] = _wp.x; A.iPos.array[i3 + 1] = _wp.y; A.iPos.array[i3 + 2] = _wp.z;
      A.iR.array[gn] = gR;
      A.iC.array[i4] = lk.color[0]; A.iC.array[i4 + 1] = lk.color[1]; A.iC.array[i4 + 2] = lk.color[2]; A.iC.array[i4 + 3] = lk.glow * op * (L ? 1.15 : 1);
      A.iP.array[i4] = lk.pulse; A.iP.array[i4 + 1] = lk.pulseHz; A.iP.array[i4 + 2] = r.ph; A.iP.array[i4 + 3] = reduced ? 0 : r.flare * lk.crit;
      A.iX.array[i3] = lk.crit; A.iX.array[i3 + 1] = bodyR / gR; A.iX.array[i3 + 2] = r.fa;
      gn++;
      // 연기·불티(가까울 때만, 움직임 줄이기면 없음)
      const cap = reduced || op < 0.3 ? 0 : smokeCap(px);
      if (cap > 0 && lk.smoke > 0) {
        r.sAcc += dt * lk.smoke;
        const farA = Math.min(2.2, Math.max(1, 1 + (PHEAT.PX_FULL * 1.5 - px) / 10)); // 멀수록(본체 px 가 작을수록) 연기를 짙게 — 작은 화면에서도 가닥으로(24px↑ 1배 → 2.2배)
        while (r.sAcc >= 1) { r.sAcc -= 1; if (r.n < cap) this._puff(v.id, r, fxR, lk, false, v, farA); }
        if (lk.tail > 0) {
          r.tAcc += dt * lk.tail;
          if (r.tAcc >= 1) deco._away(v, _away);
          while (r.tAcc >= 1) { r.tAcc -= 1; if (r.n < cap) this._puff(v.id, r, fxR, lk, true, v, farA); }
        }
        if (lk.ember > 0 && sparks && px >= PHEAT.PX_SMOKE) {
          r.eAcc += dt * lk.ember;
          while (r.eAcc >= 1) {
            r.eAcc -= 1;
            _d.set(Math.random() - 0.5, 0.7 + Math.random() * 0.5, Math.random() - 0.5).normalize();
            _p.copy(_wp).addScaledVector(_d, bodyR * 1.02);
            sparks.emit(_p, _d, fxR * 2.6, 0.45, 0.8 + Math.random() * 0.5, _ec.setRGB(1, 0.5 + Math.random() * 0.25, 0.15), 1.5);
          }
        }
      } else { r.sAcc = r.tAcc = r.eAcc = 0; }
    }
    this.gGeo.instanceCount = gn;
    this.glow.visible = gn > 0;
    if (gn) for (const k in gA) this.gA[k].needsUpdate = true;
    this._stepSmoke(dt);
    this.stats.hot = hot; this.stats.glow = gn; this.stats.puffs = this.live;
  }

  /** 궤도 링·위성·시안 부품 단계색: base(THREE.Color)를 노드 heat 색 쪽으로(직전 프레임 값). 뜨겁지 않으면 base 그대로 돌려줌 */
  tintColor(id, base, out) {
    const r = this.rec.get(id);
    const e = r ? r.eff || 0 : 0;
    if (!(e > 0.002)) return base;
    const k = heatRingK(e, r.est);
    heatRgb(e, _rgb);
    return out.copy(base).lerp(_ec.setRGB(_rgb[0], _rgb[1] * 0.92, _rgb[2]), Math.round(k * 40) / 40); // 40단계로 끊어 색 키가 매 프레임 바뀌지 않게
  }

  /** 연기 입자 하나: 가닥(극·해치에서 위로) 또는 꼬리(부모 반대쪽 + 위로, 짙고 큼) */
  _puff(id, r, R, lk, tail, v, farA = 1) {
    const P = this.P, N = PHEAT.POOL;
    let i = this.next, tries = 0;
    while (P.life[i] > 0 && P.age[i] < P.life[i] && tries < 8) { i = (i + 1) % N; tries++; } // 살아 있는 것 몇 개는 건너뜀(풀이 꽉 차면 가장 오래된 자리)
    this.next = (i + 1) % N;
    if (P.own[i] && P.age[i] < P.life[i]) { const o = this.rec.get(P.own[i]); if (o) o.n = Math.max(0, o.n - 1); }
    const q = i * 3;
    if (tail) {
      _d.copy(_away).multiplyScalar(0.85).add(_p.set((Math.random() - 0.5) * 0.5, 0.35 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5)).normalize();
      P.pos[q] = _d.x * R * 0.9; P.pos[q + 1] = _d.y * R * 0.9; P.pos[q + 2] = _d.z * R * 0.9;
      const sp = R * (2.4 + Math.random() * 1.1); // 후광 밖까지 흩날려 멀리서도 꼬리로 읽히게
      P.vel[q] = _d.x * sp; P.vel[q + 1] = _d.y * sp; P.vel[q + 2] = _d.z * sp;
      P.life[i] = 2.2 + Math.random() * 1.0; P.s0[i] = R * 0.36; P.s1[i] = R * (1.55 + Math.random() * 0.6);
      P.a0[i] = 0.46 + 0.22 * lk.crit; P.shade[i] = Math.min(1, lk.shade + 0.15); P.warm[i] = 0.55 * lk.crit; P.lift[i] = R * 0.8;
    } else {
      // 극(위) 또는 위쪽 반구의 해치 한 곳
      const pole = Math.random() < 0.45;
      const a = Math.random() * TAU, el = pole ? 1.35 + Math.random() * 0.2 : 0.35 + Math.random() * 0.75;
      _d.set(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
      P.pos[q] = _d.x * R; P.pos[q + 1] = _d.y * R; P.pos[q + 2] = _d.z * R;
      const sp = R * (0.8 + Math.random() * 0.5);
      P.vel[q] = _d.x * sp * 0.6; P.vel[q + 1] = sp * (0.8 + _d.y * 0.4); P.vel[q + 2] = _d.z * sp * 0.6;
      P.life[i] = 1.8 + Math.random() * 0.8; P.s0[i] = R * 0.26; P.s1[i] = R * (1.0 + Math.random() * 0.45);
      P.a0[i] = 0.3 + 0.26 * lk.hot; P.shade[i] = lk.shade; P.warm[i] = 0.25 * lk.crit; P.lift[i] = R * 1.3; // a0: 데움 50%↑ 옅은 가닥 0.3 → 과열 0.56
    }
    P.a0[i] = Math.min(0.95, P.a0[i] * farA);
    if (this.L) P.a0[i] *= 0.8;
    P.base[q] = _wp.x; P.base[q + 1] = _wp.y; P.base[q + 2] = _wp.z; // pos 는 주인 중심 기준 오프셋
    P.age[i] = 0; P.seed[i] = Math.random(); P.own[i] = id;
    r.n++;
  }

  _stepSmoke(dt) {
    const P = this.P, N = PHEAT.POOL, A = this.sA;
    const pos = A.iPos.array, sz = A.iS.array, ia = A.iA.array;
    let n = 0;
    const drag = Math.max(0, 1 - 0.9 * dt);
    for (let i = 0; i < N; i++) {
      if (!(P.life[i] > 0)) continue;
      P.age[i] += dt;
      if (P.age[i] >= P.life[i]) {
        P.life[i] = 0;
        const o = P.own[i] && this.rec.get(P.own[i]); if (o) o.n = Math.max(0, o.n - 1);
        P.own[i] = null;
        continue;
      }
      const q = i * 3;
      P.vel[q] *= drag; P.vel[q + 1] = P.vel[q + 1] * drag + P.lift[i] * dt; P.vel[q + 2] *= drag;
      P.pos[q] += P.vel[q] * dt; P.pos[q + 1] += P.vel[q + 1] * dt; P.pos[q + 2] += P.vel[q + 2] * dt;
      const ow = this.rec.get(P.own[i]);
      if (ow && ow.x !== undefined) { P.base[q] = ow.x; P.base[q + 1] = ow.y; P.base[q + 2] = ow.z; }
      const t = P.age[i] / P.life[i];
      const a = P.a0[i] * (t < 0.15 ? t / 0.15 : 1) * Math.pow(1 - t, 1.3);
      const o3 = n * 3, o4 = n * 4;
      pos[o3] = P.base[q] + P.pos[q]; pos[o3 + 1] = P.base[q + 1] + P.pos[q + 1]; pos[o3 + 2] = P.base[q + 2] + P.pos[q + 2];
      sz[n] = P.s0[i] + (P.s1[i] - P.s0[i]) * Math.sqrt(t);
      ia[o4] = P.shade[i]; ia[o4 + 1] = a; ia[o4 + 2] = P.warm[i] * (1 - t) * (1 - t); ia[o4 + 3] = P.seed[i] + t * 0.08;
      n++;
    }
    this.live = n;
    this.sGeo.instanceCount = n;
    this.smoke.visible = n > 0;
    if (n || this._was) { A.iPos.needsUpdate = true; A.iS.needsUpdate = true; A.iA.needsUpdate = true; }
    this._was = n > 0;
  }

  dispose() {
    this.glow.removeFromParent(); this.gGeo.dispose(); this.gMat.dispose();
    this.smoke.removeFromParent(); this.sGeo.dispose(); this.sMat.dispose();
    this.rec.clear(); this.book.clear();
  }
}
