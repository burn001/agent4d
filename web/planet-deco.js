// Planet 3D 행성 연출 — PlanetView 가 노드마다 붙인다. 외부 에셋 없이 three 지오메트리 + 셰이더 주입.
//  · 메인 = 기계 행성: 몸체 셰이더(패널 이음선·패널 명암·해치 여닫이·이음선을 따라 도는 조명 점·이음선 사이 코어 광 맥동),
//    기운 궤도 링(점선 토막 + 밝은 운반체 셋)·적도 기어 띠(톱니), 몸체와 함께 도는 안테나(도구 호출 때 솟고 끝이 깜빡임).
//  · 서브에이전트(구) = 위도 띠·흐르는 구름(위도마다 속도가 다른 차등 회전)·활동 때 표면 발광 맥동 + 대기 테두리 빛 + 작은 위성.
//    워크플로 에이전트·claude -p 는 모양을 그대로 두고 작은 위성만.
//  · 상태(planet-core.mjs MECH·SUB): 도구 호출 > 생각 중 > 대기 > 완료로 링 속도·발광·해치·안테나가 달라지고 부드럽게 넘어간다.
//  · LOD: 노드 반지름이 화면 5px 미만이면 덧붙인 부품을 숨기고(몸체 셰이더만), 16px 미만이면 톱니·안테나를 뺀다.
//  · 투명도는 몸체 재질(퇴장·완료· 프로젝트 페이드가 이미 곱해진 값)을 그대로 따른다.
import * as THREE from 'three';
import { MECH, SUB, planetMode, approach, pxRadius, planetLod } from './planet-core.mjs';

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
    dashRing: mergeBoxes(ringOf(60, 1.62, 0.1, 0.022, 0.05, (i) => i % 20 === 0)), // 궤도 링 점선(운반체 자리는 비움)
    carriers: mergeBoxes(ringOf(3, 1.62, 0.16, 0.06, 0.09)),                     // 링 위 밝은 운반체 셋
    gearBand: new THREE.TorusGeometry(1.035, 0.04, 6, 64),                        // 적도 기어 띠
    teeth: mergeBoxes(ringOf(30, 1.075, 0.07, 0.085, 0.07)),
    mast: new THREE.CylinderGeometry(0.022, 0.03, 1, 6, 1),
    tip: new THREE.SphereGeometry(0.075, 8, 6),
    dish: new THREE.ConeGeometry(0.12, 0.07, 10, 1, true),
    moon: new THREE.SphereGeometry(1, 14, 10),
    atmo: new THREE.SphereGeometry(1, 28, 18),
  };
  GEO.gearBand.rotateX(Math.PI / 2);
  GEO.mast.translate(0, 0.5, 0);
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

const _wp = new THREE.Vector3();
const _c = new THREE.Color();

export class PlanetDeco {
  /** view = PlanetView(SceneView) */
  constructor(view) {
    this.view = view;
    this.map = new Map(); // id → deco
    this.stats = { main: 0, sub: 0, lod: [0, 0, 0] };
  }

  /** 노드 v 에 연출을 붙인다(메인·서브·워크플로 에이전트·claude -p, 배치 장치·백그라운드·모니터·워크플로 제외) */
  attach(v) {
    if (this.map.has(v.id) || v.device) return;
    const k = v.kind;
    let d = null;
    if (k === 'main') d = this._mech(v);
    else if (k === 'subagent') d = this._sub(v, true);
    else if (k === 'workflow-agent' || k === 'claude-p') d = this._sub(v, false);
    if (!d) return;
    d.cur = {}; d.lod = -1; d.spinA = Math.random() * TAU; d.moonA = Math.random() * TAU;
    this.map.set(v.id, d);
    this.applyTheme(d);
  }

  _mech(v) {
    const G = geo();
    v.mesh.geometry = G.body;
    v.mat.flatShading = false;
    const U = mkU();
    inject(v.mat, 'mech', U);
    const metal = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.55, transparent: true });
    const light = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const root = new THREE.Group();          // 몸체 크기를 따르는 묶음
    const tilt = new THREE.Group(); tilt.rotation.set(0.16, 0, 0.36); root.add(tilt);
    const ring = new THREE.Mesh(G.dashRing, metal); tilt.add(ring);
    const carriers = new THREE.Mesh(G.carriers, light); ring.add(carriers);
    const gear = new THREE.Group(); root.add(gear);
    gear.add(new THREE.Mesh(G.gearBand, metal));
    const teeth = new THREE.Mesh(G.teeth, metal); gear.add(teeth);
    const spinG = new THREE.Group(); root.add(spinG); // 몸체 자전과 함께 도는 부품
    const ant = new THREE.Group();
    const la = 0.95, lo = 0.6; // 북위 54° 근처, 법선 방향으로 선다
    ant.position.set(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)).multiplyScalar(0.98);
    ant.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ant.position.clone().normalize());
    const mast = new THREE.Mesh(G.mast, metal); ant.add(mast);
    const dish = new THREE.Mesh(G.dish, metal); dish.rotation.x = Math.PI; ant.add(dish);
    const tip = new THREE.Mesh(G.tip, light); ant.add(tip);
    spinG.add(ant);
    for (const o of [ring, carriers, teeth, mast, dish, tip, ...gear.children]) o.raycast = () => {};
    v.group.add(root);
    return { type: 'mech', U, metal, light, root, tilt, ring, carriers, gear, teeth, spinG, ant, mast, dish, tip };
  }

  _sub(v, surface) {
    const G = geo();
    let U = null;
    if (surface) { U = mkU(); inject(v.mat, 'sub', U); }
    const root = new THREE.Group();
    const orbit = new THREE.Group(); orbit.rotation.set(0.42 + (v.seed % 1) * 0.3, 0, -0.3 + (v.seed % 0.7)); root.add(orbit);
    const moonMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, transparent: true });
    const moon = new THREE.Mesh(G.moon, moonMat); moon.scale.setScalar(0.17); orbit.add(moon);
    moon.raycast = () => {};
    let atmo = null, atmoMat = null;
    if (surface) {
      atmoMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0.5 } },
        vertexShader: ATMO_V, fragmentShader: ATMO_F, transparent: true, depthWrite: false,
      });
      atmo = new THREE.Mesh(G.atmo, atmoMat); atmo.scale.setScalar(1.13); root.add(atmo);
      atmo.raycast = () => {};
    }
    v.group.add(root);
    return { type: 'sub', U, root, orbit, moon, moonMat, atmo, atmoMat, surface };
  }

  detach(v) {
    const d = this.map.get(v.id); if (!d) return;
    this.map.delete(v.id);
    d.root.removeFromParent();
    for (const m of [d.metal, d.light, d.moonMat, d.atmoMat]) if (m) m.dispose();
  }

  /** 테마: 밝은 배경에선 발광을 낮추고 대기 빛은 보통 섞기 */
  applyTheme(only) {
    const t = this.view.tokens || {};
    const L = !!t.isLight;
    for (const d of only ? [only] : this.map.values()) {
      if (d.U) d.U.uLight.value = L ? 1 : 0;
      if (d.atmoMat) {
        const b = L ? THREE.NormalBlending : THREE.AdditiveBlending;
        if (d.atmoMat.blending !== b) { d.atmoMat.blending = b; d.atmoMat.needsUpdate = true; }
      }
      d._colKey = null;
    }
  }

  /** 매 프레임(SceneView._frame 끝, 렌더 직전) */
  update(now, dt) {
    const view = this.view, cam = view.camera;
    const H = view.container.clientHeight || 1, fov = cam.fov;
    const T = now % 3600;
    const st = this.stats; st.main = st.sub = 0; st.lod[0] = st.lod[1] = st.lod[2] = 0;
    const reduced = !!view.reduced;
    for (const [id, d] of this.map) {
      const v = view.vis.get(id);
      if (!v || v.hidden || v.gone || !v.group.visible) continue;
      const s = v.mesh.scale.x;
      v.group.getWorldPosition(_wp);
      const px = pxRadius(s, _wp.distanceTo(cam.position), fov, H);
      const lod = planetLod(px);
      st.lod[lod]++;
      const mode = planetMode(v.node.status, v.icons ? v.icons.size : 0, !!v.scopeRecent);
      const op = v.mat.opacity;
      d.root.scale.setScalar(s);
      if (d.type === 'mech') {
        st.main++;
        const c = approach(d.cur, MECH[mode], dt, 2.5);
        const sp = reduced ? c.spin * 0.2 : c.spin;
        d.spinA += dt * sp;
        d.ring.rotation.y = d.spinA;
        d.gear.rotation.y = -d.spinA * 0.55;
        d.spinG.rotation.y = v.mesh.rotation.y;
        d.U.uT.value = T; d.U.uGlow.value = c.glow; d.U.uLights.value = c.lights; d.U.uHatch.value = c.hatch;
        d.U.uPulse.value = reduced ? 0.2 : c.pulse; d.U.uDetail.value = lod === 0 ? 0 : Math.min(1, (px - 4) / 8);
        if (lod !== d.lod) { d.lod = lod; d.root.visible = lod >= 1; d.teeth.visible = lod >= 2; d.ant.visible = lod >= 2; }
        if (lod >= 1) {
          if (d._colKey !== v.mat.color.getHexString() + view.tokens.isLight) {
            d._colKey = v.mat.color.getHexString() + view.tokens.isLight;
            d.metal.color.copy(v.mat.color).lerp(_c.set(view.tokens.isLight ? 0x8a93a3 : 0x9aa4b6), 0.55);
            d.metal.emissive.copy(v.mat.color).multiplyScalar(0.12);
            d.light.color.copy(v.mat.color).lerp(_c.set(0xffffff), 0.55);
          }
          d.metal.opacity = op; d.metal.depthWrite = op >= 0.99;
          const blink = 0.55 + 0.45 * Math.sin(T * (2 + 6 * c.ant));
          d.light.opacity = op * Math.min(1, 0.25 + c.glow) ;
          d.carriers.visible = c.glow > 0.08;
          if (lod >= 2) {
            const ext = 0.32 + 0.68 * c.ant;
            d.mast.scale.set(1, 0.5 * ext, 1);
            d.dish.position.y = 0.5 * ext; d.tip.position.y = 0.5 * ext + 0.05;
            d.dish.rotation.y += dt * (0.5 + 3 * c.ant);
            d.tip.scale.setScalar(c.ant > 0.5 ? 0.8 + 0.5 * blink : 0.8);
          }
        }
      } else {
        st.sub++;
        const c = approach(d.cur, SUB[mode], dt, 2.5);
        if (d.U) { d.U.uT.value = T; d.U.uGlow.value = c.glow; d.U.uSpin.value = reduced ? 0.1 : c.spin; d.U.uDetail.value = lod === 0 ? 0 : Math.min(1, (px - 3) / 6); }
        if (lod !== d.lod) { d.lod = lod; d.root.visible = lod >= 1; }
        if (lod >= 1) {
          d.moonA += dt * (0.35 + 0.9 * c.spin) * (reduced ? 0.2 : 1);
          d.moon.position.set(Math.cos(d.moonA) * 1.85, 0, Math.sin(d.moonA) * 1.85);
          if (d._colKey !== v.mat.color.getHexString() + view.tokens.isLight) {
            d._colKey = v.mat.color.getHexString() + view.tokens.isLight;
            d.moonMat.color.copy(v.mat.color).lerp(_c.set(view.tokens.isLight ? 0x9aa1ad : 0xb8bfcc), 0.65);
            if (d.atmoMat) d.atmoMat.uniforms.uColor.value.copy(v.mat.color).lerp(_c.set(0xffffff), 0.3);
          }
          d.moonMat.opacity = op; d.moonMat.depthWrite = op >= 0.99;
          if (d.atmoMat) d.atmoMat.uniforms.uOpacity.value = op * (view.tokens.isLight ? 0.35 : 0.55) * (0.6 + 0.6 * c.glow);
        }
      }
    }
  }

  dispose() { for (const id of [...this.map.keys()]) { const v = this.view.vis.get(id); if (v) this.detach(v); } this.map.clear(); }
}
