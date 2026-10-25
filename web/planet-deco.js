// Planet 3D 행성 연출 — PlanetView 가 노드마다 붙인다. 외부 에셋 없이 three 지오메트리 + 셰이더 주입.
//  · 메인 = 기계 행성: 몸체 셰이더(패널 이음선·패널 명암·해치 여닫이·이음선을 따라 도는 조명 점·이음선 사이 코어 광 맥동),
//    적도 기어 띠(고정된 네 번째 휠) + 다축 뚜르비용(planet-tourb.js — 예전 기운 점선 링·안테나를 대신함).
//  · 서브에이전트(구) = 위도 띠·흐르는 구름(위도마다 속도가 다른 차등 회전)·활동 때 표면 발광 맥동 + 대기 테두리 빛 + 작은 위성.
//    워크플로 에이전트·claude -p 는 모양을 그대로 두고 작은 위성만.
//  · 상태(planet-core.mjs MECH·SUB): 도구 호출 > 생각 중 > 대기 > 완료로 링 속도·발광·해치·안테나가 달라지고 부드럽게 넘어간다.
//  · LOD: 노드 반지름이 화면 5px 미만이면 덧붙인 부품을 숨기고(몸체 셰이더만), 16px 미만이면 톱니·안테나를 뺀다.
//  · 투명도는 몸체 재질(퇴장·완료· 프로젝트 페이드가 이미 곱해진 값)을 그대로 따른다.
//  ·～: 모든 Planet 노드에 궤도계(planet-orbits.js — 종류·유형·id 시드마다 다른 링·위성·소행성대·잔광, 도구 호출 입자),
//    서브에이전트는 유형 8종(planet-sub.js). 예전 '작은 위성 하나'는 궤도계가 대신한다.
import * as THREE from 'three';
import { MECH, SUB, ORBIT, planetMode, approach, pxRadius, planetLod, orbitLod, orbitSpec, hash01, subType, SETTLE_S, settleK } from './planet-core.mjs';
import { OrbitSystem, OrbitSparks } from './planet-orbits.js';
import { injectSubType, mkSubU, buildSubType, stepSubType, setSubTypeColors, disposeSubType } from './planet-sub.js';
import { Escapement, tourbLod, TOURB_LOD } from './tourbillon-core.mjs'; // 뚜르비용
import { TourbMain, SubCages } from './planet-tourb.js';

const TAU = Math.PI * 2;
let GEO = null;

/** 상자 여러 개를 한 지오메트리로(y 축 회전만). list = [{w,h,d,x,y,z,ry}] */
function mergeBoxes(list) {
  const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const P = box.attributes.position.array, N = box.attributes.normal.array;
  const pos = new Float32Array(P.length * list.length), nor = new Float32Array(P.length * list.length);
  let o = 0;
  for (const b of list) {
    const c = Math.cos(b.ry || 0), s = Math.sin(b.ry || 0);
    for (let i = 0; i < P.length; i += 3, o += 3) {
      const x = P[i] * b.w, y = P[i + 1] * b.h, z = P[i + 2] * b.d;
      pos[o] = x * c + z * s + b.x; pos[o + 1] = y + b.y; pos[o + 2] = -x * s + z * c + b.z;
      nor[o] = N[i] * c + N[i + 2] * s; nor[o + 1] = N[i + 1]; nor[o + 2] = -N[i] * s + N[i + 2] * c;
    }
  }
  box.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
/** 반지름 R 원 위에 n 개 토막(접선 방향) */
const ringOf = (n, R, w, h, d, skip = null) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (skip && skip(i)) continue;
    const a = (i / n) * TAU;
    out.push({ w, h, d, x: Math.cos(a) * R, y: 0, z: Math.sin(a) * R, ry: -a - Math.PI / 2 });
  }
  return out;
};

function geo() {
  if (GEO) return GEO;
  GEO = {
    body: new THREE.SphereGeometry(1, 48, 28),            // 메인 몸체(이십면체 대신 — 이음선은 셰이더)
    gearBand: new THREE.TorusGeometry(1.035, 0.04, 6, 64),                        // 적도 기어 띠
    teeth: mergeBoxes(ringOf(30, 1.075, 0.07, 0.085, 0.07)),
    moon: new THREE.SphereGeometry(1, 14, 10),
    atmo: new THREE.SphereGeometry(1, 28, 18),
  };
  GEO.gearBand.rotateX(Math.PI / 2);
  return GEO;
}

// ---------- 셰이더 주입(MeshStandardMaterial onBeforeCompile) ----------
const COMMON_V = /* glsl */`#include <common>
varying vec3 vMP;`;
const BEGIN_V = /* glsl */`#include <begin_vertex>
vMP = position;`;
const COMMON_F = /* glsl */`#include <common>
varying vec3 vMP;
uniform float uT, uGlow, uLights, uHatch, uDetail, uLight, uPulse, uSpin;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`;

// 기계 행성: 위도 9 띠 × 띠마다 경도 칸(극으로 갈수록 적게), 칸마다 명암, 이음선은 화면 1～2px 어두운 선 + 코어 광
const MECH_F = /* glsl */`#include <emissivemap_fragment>
{
  vec3 pn = normalize(vMP);
  float lat = asin(clamp(pn.y, -1.0, 1.0));
  float lon = atan(pn.z, pn.x);
  float la = (lat / 3.14159265 + 0.5) * 9.0;
  float bandI = floor(la);
  float nLon = max(4.0, floor(22.0 * sin((bandI + 0.5) / 9.0 * 3.14159265) + 0.5));
  float lonN = lon / 6.2831853 + 0.5;
  float lo = lonN * nLon + h21(vec2(bandI, 3.0));
  vec2 cell = vec2(floor(lo), bandI);
  vec2 f = vec2(fract(lo), fract(la));
  vec2 w = max(fwidth(vec2(lo, la)), vec2(1e-4));
  vec2 dd = min(f, 1.0 - f) / w;
  float seam = (1.0 - smoothstep(0.5, 1.6, min(dd.x, dd.y))) * uDetail;
  float ph = h21(cell + 0.37);
  vec3 base = diffuseColor.rgb;
  diffuseColor.rgb *= mix(1.0, 0.8 + 0.32 * ph, uDetail);
  diffuseColor.rgb = mix(diffuseColor.rgb, base * 0.3, seam * 0.8);
  float core = uGlow * (0.62 + 0.38 * sin(uT * 6.2831853 * uPulse));
  vec3 gc = mix(emissive, vec3(1.0, 0.92, 0.78), 0.3) * mix(1.05, 0.5, uLight);
  totalEmissiveRadiance += gc * seam * core;
  // 해치: 띠 1..7 의 일부 칸 — 틀 선 + 열리면 안쪽 빛
  float isH = step(0.86, ph) * step(1.0, bandI) * step(bandI, 7.0) * uDetail;
  vec2 c = abs(f - 0.5);
  float m = max(c.x, c.y);
  float frame = isH * (1.0 - smoothstep(0.0, 1.4, abs(m - 0.34) / max(w.x, w.y)));
  diffuseColor.rgb = mix(diffuseColor.rgb, base * 0.45, frame * 0.7);
  float op = isH * uHatch * smoothstep(0.35, 0.75, 0.5 + 0.5 * sin(uT * 1.7 + ph * 40.0));
  float hole = op * (1.0 - smoothstep(0.3 * op - 0.02, 0.3 * op + 0.02, m));
  diffuseColor.rgb = mix(diffuseColor.rgb, base * 0.12, hole);
  totalEmissiveRadiance += gc * hole * (0.9 + 0.6 * core) * 1.4;
  // 표면 조명 점: 띠 경계 이음선을 따라 오가는 작은 빛(띠마다 방향·속도 다름)
  float nearY = (1.0 - smoothstep(0.0, 2.2, min(f.y, 1.0 - f.y) / w.y)) * uDetail;
  float dir = mod(bandI, 2.0) * 2.0 - 1.0;
  float u = fract(lonN * 3.0 + dir * uT * 0.05 * (0.4 + uLights) + h21(vec2(bandI, 7.0)));
  float spot = exp(-pow((u - 0.5) / 0.012, 2.0));
  totalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * spot * nearY * clamp(uLights, 0.0, 1.0) * mix(1.4, 0.7, uLight);
}`;

// 서브 행성: 위도 띠 + 차등 회전으로 흐르는 구름 + 활동 발광 맥동
const SUB_F = /* glsl */`#include <emissivemap_fragment>
{
  vec3 pn = normalize(vMP);
  float lat = pn.y;
  float lon = atan(pn.z, pn.x);
  float flow = uT * (0.12 + 0.3 * uSpin);
  float dl = lon + flow * (1.0 + 0.7 * sin(lat * 3.0));
  float b = sin(lat * 10.0 + 0.8 * sin(dl * 2.0 + lat * 4.0) + 0.45 * sin(dl * 5.0 - lat * 7.0));
  float bands = 0.5 + 0.5 * b;
  diffuseColor.rgb *= mix(1.0, mix(0.74, 1.16, bands), uDetail);
  float cl = smoothstep(0.62, 0.92, 0.5 + 0.5 * sin(dl * 3.0 + lat * 13.0 + 1.7 * sin(lat * 5.0 + uT * 0.25)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), cl * 0.24 * uDetail);
  float pul = uGlow * (0.5 + 0.5 * sin(uT * 3.2 + lat * 6.0 - dl));
  totalEmissiveRadiance += emissive * pul * (0.4 + 0.9 * bands) * mix(1.2, 0.6, uLight);
}`;

function inject(mat, kind, U) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', COMMON_V).replace('#include <begin_vertex>', BEGIN_V);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', COMMON_F).replace('#include <emissivemap_fragment>', kind === 'mech' ? MECH_F : SUB_F);
  };
  mat.customProgramCacheKey = () => 'planet-' + kind;
  mat.needsUpdate = true;
}
const mkU = () => ({ uT: { value: 0 }, uGlow: { value: 0 }, uLights: { value: 0 }, uHatch: { value: 0 }, uDetail: { value: 1 }, uLight: { value: 0 }, uPulse: { value: 1 }, uSpin: { value: 1 } });

// 대기 테두리 빛(프레넬)
const ATMO_V = /* glsl */`varying vec3 vN; varying vec3 vV;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const ATMO_F = /* glsl */`uniform vec3 uColor; uniform float uOpacity;
varying vec3 vN; varying vec3 vV;
void main() { float r = 1.0 - abs(dot(vN, vV)); float a = pow(r, 2.6) * uOpacity; gl_FragColor = vec4(uColor, a); }`;

const _wp = new THREE.Vector3(), _dir = new THREE.Vector3(), _p2 = new THREE.Vector3();
const _c = new THREE.Color(), _c2 = new THREE.Color();

export class PlanetDeco {
  /** view = PlanetView(SceneView) */
  constructor(view) {
    this.view = view;
    this.map = new Map(); // id → deco
    this.stats = { main: 0, sub: 0, lod: [0, 0, 0], olod: [0, 0, 0, 0], ms: 0 };
    this.sparks = new OrbitSparks(view.scene);
    this.cages = new SubCages(view.scene); // 서브 단일 케이지(장면 전체 인스턴싱)
  }

  /** 노드 v 에 연출을 붙인다(메인·서브·워크플로 에이전트·claude -p, 배치 장치·백그라운드·모니터·워크플로 제외) */
  attach(v) {
    if (this.map.has(v.id)) return;
    const k = v.kind;
    let d = null;
    if (v.device) d = { type: 'plain', root: this._root(v) };
    else if (k === 'main') d = this._mech(v);
    else if (k === 'subagent') d = this._sub(v);
    else d = { type: 'plain', root: this._root(v) };
    d.cur = {}; d.ocur = {}; d.lod = -1; d.spinA = Math.random() * TAU;
    d.mode = null; d.settleAt = -1;
    const okind = v.device ? 'device' : k;
    d.orbits = new OrbitSystem(orbitSpec(okind, v.id, d.subType ? { type: d.subType } : {}), hash01(v.id, 'seed'));
    d.oroot = new THREE.Group(); d.oroot.add(d.orbits.group); v.group.add(d.oroot);
    d.emitAcc = 0;
    if (d.type === 'mech' || d.type === 'sub') { d.esc = new Escapement(hash01(v.id, 'tourb')); d.tbx = (hash01(v.id, 'tbx') - 0.5) * 0.9; d.tbz = (hash01(v.id, 'tbz') - 0.5) * 0.9; }
    this.map.set(v.id, d);
    this.applyTheme(d);
  }
  _root(v) { const r = new THREE.Group(); v.group.add(r); return r; }
  /** 궤도계 바깥 반지름(본체 반지름 배) — 홀로그램 자리 */
  extentOf(id) { const d = this.map.get(id); return d ? d.orbits.spec.extent : 1; }
  /** 홀로그램 빔 출발점: i 번째 보이는 위성(없으면 false) */
  satWorld(id, i, out) { const d = this.map.get(id); if (!d) return false; const n = d.orbits.satCount(); return n > 0 && d.orbits.satWorld(i % n, out); }

  _mech(v) {
    const G = geo();
    v.mesh.geometry = G.body;
    v.mat.flatShading = false;
    const U = mkU();
    inject(v.mat, 'mech', U);
    const metal = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.55, transparent: true });
    const light = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const root = new THREE.Group();          // 몸체 크기를 따르는 묶음
    // 예전 기운 점선 링·운반체·안테나 → 다축 뚜르비용. 적도 기어 띠는 고정된 네 번째 휠(케이지가 그 위를 돈다)
    const gear = new THREE.Group(); root.add(gear);
    gear.add(new THREE.Mesh(G.gearBand, metal));
    const teeth = new THREE.Mesh(G.teeth, metal); gear.add(teeth);
    for (const o of [teeth, ...gear.children]) o.raycast = () => {};
    const tb = new TourbMain(root);
    v.group.add(root);
    return { type: 'mech', U, metal, light, root, gear, teeth, tb };
  }

  _sub(v) {
    const G = geo();
    const type = v._ptype || subType(v.id); // _ptype: 확인용 강제 유형(유형 모음 스크린샷)
    const U = injectSubType(v.mat, mkSubU(type));
    const root = new THREE.Group();
    const seed01 = hash01(v.id, 'seed');
    let atmo = null, atmoMat = null;
    if (type !== 'crystal' && type !== 'swarm') {
      atmoMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0.5 } },
        vertexShader: ATMO_V, fragmentShader: ATMO_F, transparent: true, depthWrite: false,
      });
      atmo = new THREE.Mesh(G.atmo, atmoMat); atmo.scale.setScalar(type === 'comet' ? 1.36 : type === 'gas' ? 1.14 : 1.1); root.add(atmo);
      atmo.raycast = () => {};
    }
    v.group.add(root);
    const x = buildSubType(v, type, root, seed01);
    return { type: 'sub', subType: type, U, root, atmo, atmoMat, x };
  }

  detach(v) {
    const d = this.map.get(v.id); if (!d) return;
    this.map.delete(v.id);
    d.root.removeFromParent();
    for (const m of [d.metal, d.light, d.atmoMat]) if (m) m.dispose();
    if (d.tb) d.tb.dispose();
    if (d.x) disposeSubType(d.x, v);
    d.orbits.dispose(); d.oroot.removeFromParent();
  }

  /** 테마: 밝은 배경에선 발광을 낮추고 대기 빛은 보통 섞기 */
  applyTheme(only) {
    const t = this.view.tokens || {};
    const L = !!t.isLight;
    for (const d of only ? [only] : this.map.values()) {
      if (d.U) d.U.uLight.value = L ? 1 : 0;
      if (d.orbits) d.orbits._colKey = null;
      if (d.atmoMat) {
        const b = L ? THREE.NormalBlending : THREE.AdditiveBlending;
        if (d.atmoMat.blending !== b) { d.atmoMat.blending = b; d.atmoMat.needsUpdate = true; }
      }
      d._colKey = null;
    }
    if (this.sparks) this.sparks.setLight(L);
    if (this.cages) this.cages.theme(L);
  }

  /** 매 프레임(SceneView._frame 끝, 렌더 직전) */
  update(now, dt) {
    const t0 = performance.now();
    const view = this.view, cam = view.camera;
    const H = view.container.clientHeight || 1, fov = cam.fov;
    const T = now % 3600;
    const st = this.stats; st.main = st.sub = 0; st.lod[0] = st.lod[1] = st.lod[2] = 0; st.olod.fill(0);
    const reduced = !!view.reduced;
    const L = !!(view.tokens && view.tokens.isLight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pxK = H / (2 * Math.tan((fov * Math.PI) / 360)); // 세계 1 이 거리 1 에서 몇 px
    this.cages.begin();
    for (const [id, d] of this.map) {
      const v = view.vis.get(id);
      if (!v || v.hidden || v.gone || !v.group.visible) continue;
      const s = v.mesh.scale.x;
      v.group.getWorldPosition(_wp);
      const dist = _wp.distanceTo(cam.position);
      const px = pxRadius(s, dist, fov, H);
      const lod = planetLod(px);
      const olod = orbitLod(px);
      st.lod[lod]++; st.olod[olod]++;
      const mode = planetMode(v.node.status, v.icons ? v.icons.size : 0, !!v.scopeRecent);
      // 완료 순간: 짧은 정리 연출(궤도가 모였다 퍼지며 고리 파동)
      if (d.mode !== mode) { if (mode === 'off' && d.mode && d.mode !== 'off') d.settleAt = now; d.mode = mode; }
      const settle = d.settleAt >= 0 && now - d.settleAt < SETTLE_S ? now - d.settleAt : -1;
      const sk = settle >= 0 ? settleK(settle) : 0;
      const op = v.mat.opacity;
      d.root.scale.setScalar(s);
      d.oroot.scale.setScalar(s);
      const oc = approach(d.ocur, ORBIT[mode], dt, 2.5);
      const act = mode === 'tool' ? 1 : 0;
      d.act = (d.act || 0) + (act - (d.act || 0)) * Math.min(1, dt * 3);
      // 위성 군단: 도구 때 산개
      d.orbits.spread = d.subType === 'swarm' ? 1 + 0.32 * d.act : 1;
      if (olod >= 1) d.orbits.setColors(v.mat.color, L);
      d.orbits.step(dt, olod, oc, op, (s * pxK) / Math.max(0.01, dist), reduced, settle, dpr, pxK, s);
      // 도구 입자: 궤도 위성에서 연결선(부모) 쪽으로
      if (oc.emit > 0.5 && olod >= 2 && !reduced && op > 0.3) {
        d.emitAcc += dt * oc.emit * (d.type === 'mech' ? 1.4 : 1);
        while (d.emitAcc >= 1) { d.emitAcc -= 1; this._emit(v, d, s); }
      } else d.emitAcc = 0;
      if (d.esc) d.esc.step(dt, mode, { reduced }); // 이스케이프먼트(박·밸런스·케이지)
      if (d.type === 'mech') {
        st.main++;
        const c = approach(d.cur, MECH[mode], dt, 2.5);
        d.tb.theme(L, v.mat.color);
        d.tb.step(d.esc, tourbLod(px), op);
        d.U.uT.value = T; d.U.uGlow.value = c.glow + sk * 0.6; d.U.uLights.value = c.lights; d.U.uHatch.value = c.hatch;
        d.U.uPulse.value = reduced ? 0.2 : c.pulse; d.U.uDetail.value = lod === 0 ? 0 : Math.min(1, (px - 4) / 8);
        if (lod !== d.lod) { d.lod = lod; d.gear.visible = lod >= 1; d.teeth.visible = lod >= 2; }
        if (lod >= 1) {
          if (d._colKey !== v.mat.color.getHexString() + L) {
            d._colKey = v.mat.color.getHexString() + L;
            d.metal.color.copy(v.mat.color).lerp(_c.set(L ? 0x8a93a3 : 0x9aa4b6), 0.55);
            d.metal.emissive.copy(v.mat.color).multiplyScalar(0.12);
            d.light.color.copy(v.mat.color).lerp(_c.set(0xffffff), 0.55);
          }
          d.metal.opacity = op; d.metal.depthWrite = op >= 0.99;
        }
      } else if (d.type === 'sub') {
        st.sub++;
        const c = approach(d.cur, SUB[mode], dt, 2.5);
        const U = d.U;
        U.uT.value = T; U.uGlow.value = c.glow; U.uSpin.value = reduced ? 0.1 : c.spin; U.uDetail.value = lod === 0 ? 0 : Math.min(1, (px - 3) / 6);
        U.uAct.value = reduced ? 0 : d.act; U.uDim.value = mode === 'wait' ? 1 : mode === 'off' ? 0.5 : 0; U.uSettle.value = sk;
        if (lod !== d.lod) { d.lod = lod; d.root.visible = lod >= 1; }
        if (d._colKey !== v.mat.color.getHexString() + L) {
          d._colKey = v.mat.color.getHexString() + L;
          if (d.atmoMat) d.atmoMat.uniforms.uColor.value.copy(v.mat.color).lerp(_c.set(0xffffff), 0.3);
          setSubTypeColors(d.x, v.mat.color, L);
        }
        if (lod >= 1 && d.atmoMat) d.atmoMat.uniforms.uOpacity.value = op * (L ? 0.3 : 0.42) * (0.55 + 0.6 * c.glow) * (d.subType === 'comet' ? 1.4 : d.subType === 'lava' ? 0.6 : 1);
        stepSubType(d.x, v, T, dt, c, d.act, s, op, lod, L, d.orbits, this._away(v, _dir), this.sparks, reduced);
        if (px >= TOURB_LOD.SUB_PX) this.cages.put(_wp, s, d.tbx, d.tbz, d.esc.cage, op, v.mat.color); // 단일 케이지
        // 용암: 도구 때 표면 분출
        if (d.subType === 'lava' && d.act > 0.3 && olod >= 2 && !reduced && Math.random() < dt * 10 * d.act) {
          _dir.set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize();
          _p2.copy(_wp).addScaledVector(_dir, s * 1.02);
          this.sparks.emit(_p2, _dir, s * 2.2, 0.25, 0.9, _c.copy(v.mat.color).lerp(_c2.set(0xffd9a0), 0.5), 2.2);
        }
      }
    }
    this.cages.end();
    this.sparks.update(dt, pxK * 0.12 * dpr);
    st.ms = performance.now() - t0;
  }

  /** 노드에서 부모 반대쪽(세계, 단위) — 혜성 꼬리. 부모가 없으면 오른쪽 */
  _away(v, out) {
    const pid = v.node.parentId;
    const pv = pid && this.view.vis.get(pid);
    if (pv) { out.copy(v.group.position).sub(pv.group.position); out.y = Math.max(out.y, 0) * 0.3; if (out.lengthSq() > 1e-6) return out.normalize(); }
    return out.set(1, 0.15, 0).normalize();
  }
  /** 도구 입자 하나: 보이는 위성(없으면 궤도 둘레 아무 점)에서 부모 쪽 연결선 방향으로 */
  _emit(v, d, s) {
    const n = d.orbits.satCount();
    if (n > 0) d.orbits.satWorld(Math.floor(Math.random() * n), _p2);
    else { v.group.getWorldPosition(_p2); _p2.x += (Math.random() - 0.5) * s * 3; _p2.z += (Math.random() - 0.5) * s * 3; }
    const pid = v.node.parentId;
    let tv = pid && this.view.vis.get(pid);
    if (!tv) { // 메인: 지금 일하는 자식 쪽, 없으면 바깥으로
      const kids = this.view.childrenOf && this.view.childrenOf.get(v.id);
      if (kids) for (const kid of kids) { const kv = this.view.vis.get(kid); if (kv && !kv.hidden && kv.node.status === 'active') { tv = kv; if (Math.random() < 0.5) break; } }
    }
    if (tv) _dir.copy(tv.group.position).sub(_p2); else _dir.copy(_p2).sub(v.group.position);
    const len = _dir.length();
    _dir.multiplyScalar(1 / Math.max(1e-6, len));
    const reach = tv ? Math.min(len * 0.45, s * 9) : s * 3;
    this.sparks.emit(_p2, _dir, reach * 1.6, 0.12, 0.85, _c.copy(v.mat.color).lerp(_c2.set(0xffffff), 0.45), 1.6);
  }

  dispose() { for (const id of [...this.map.keys()]) { const v = this.view.vis.get(id); if (v) this.detach(v); } this.map.clear(); if (this.sparks) { this.sparks.dispose(); this.sparks = null; } if (this.cages) { this.cages.dispose(); this.cages = null; } }
}
