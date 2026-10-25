// Planet 3D 궤도계 — 줄어든 본체 둘레를 노드 종류·유형마다 다른 궤도로 채운다. 외부 에셋 없이 three 지오메트리 + 셰이더.
//  · 궤도선: 단위 타원(이심률별 캐시, 꼭짓점마다 둘레 위치 u) + 궤도마다 ShaderMaterial(무늬 solid·dash·arcs, 점 열은 Points).
//    위성 뒤 잔광 꼬리는 셰이더가 같은 궤도선 위에 그린다(위성 위치 uHead 뒤로 밝게) — 따로 그리는 꼬리 지오메트리 없음.
//  · 위성: 공용 구 지오메트리, 노드마다 재질 둘(달 = 표준 재질, 불꽃·운반체 = 발광). 케플러 근사로 근점 가까이 빠르게.
//  · 소행성대(메인): 노드 id 로 고정된 입자 고리(Points, 거리 감쇠 크기), 천천히 돎.
//  · 도구 입자(OrbitSparks): 장면 하나에 풀 하나(Points 640) — 도구 호출 중 궤도 위성에서 연결선(부모) 쪽으로 튀어 나간다.
//  · 활동(planet-core ORBIT): 도구 > 생각 > 대기 > 완료로 공전 속도·밝기, 완료 순간엔 짧은 정리 연출(settleK — 궤도가 모였다 퍼지며 고리 파동).
//  · LOD(orbitLod): 본체 화면 반지름 5px 미만이면 궤도계 전체 숨김, 위로 갈수록 보조 궤도·소행성대·잔광까지.
import * as THREE from 'three';
import { orbitPoint, keplerRate, settleK, SETTLE_S } from './planet-core.mjs';

const TAU = Math.PI * 2;
const STYLE = { solid: 0, dash: 1, arcs: 2, dots: 3 };
const LINE_N = 160, DOT_N = 64;
const geoCache = new Map();
let SAT_GEO = null;

/** 이심률 e 의 단위 궤도(긴반지름 1, 초점 = 원점). dots 면 점 열 */
function ringGeo(e, dots) {
  const key = (dots ? 'd' : 'l') + e.toFixed(2);
  let g = geoCache.get(key);
  if (g) return g;
  const n = dots ? DOT_N : LINE_N;
  const pos = new Float32Array(n * 3), u = new Float32Array(n);
  const p = { x: 0, z: 0, r: 0 };
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    orbitPoint(1, e, th, p);
    pos[i * 3] = p.x; pos[i * 3 + 2] = p.z;
    u[i] = i / n;
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('u', new THREE.BufferAttribute(u, 1));
  geoCache.set(key, g);
  return g;
}
const satGeo = () => SAT_GEO || (SAT_GEO = new THREE.SphereGeometry(1, 12, 8));

const RING_V = /* glsl */`attribute float u; varying float vU; uniform float uPt;
void main() { vU = u; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPt; }`;
const RING_F = /* glsl */`uniform vec3 uColor, uHot; uniform float uOp, uBright, uTrail, uDir, uStyle, uSeed, uShift;
uniform vec3 uHeads; varying float vU;
float trail(float h) { if (h < 0.0) return 0.0; float d = uDir > 0.0 ? fract(h - vU) : fract(vU - h); return d < uTrail ? pow(1.0 - d / uTrail, 2.2) : 0.0; }
void main() {
  float u = fract(vU + uShift);
  if (uStyle > 0.5 && uStyle < 1.5 && fract(u * 48.0) > 0.55) discard;
  if (uStyle > 1.5 && uStyle < 2.5 && fract(u * 5.0 + uSeed) > 0.62) discard;
  if (uStyle > 2.5) { vec2 c = gl_PointCoord - 0.5; if (dot(c, c) > 0.25) discard; }
  float g = uTrail > 0.0 ? max(trail(uHeads.x), max(trail(uHeads.y), trail(uHeads.z))) : 0.0;
  float a = uOp * (0.55 + 0.45 * uBright) + g * 1.25 * uBright * min(1.0, uOp * 2.2);
  gl_FragColor = vec4(mix(uColor, uHot, g), clamp(a, 0.0, 1.0));
}`;

const BELT_V = /* glsl */`attribute float s; uniform float uPx; varying float vS;
void main() { vS = s; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uPx * s / -mv.z, 1.0, 3.5); }`;
const BELT_F = /* glsl */`uniform vec3 uColor; uniform float uOp; varying float vS;
void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25) discard; gl_FragColor = vec4(uColor * (0.75 + 0.5 * vS), uOp * (0.55 + 0.45 * vS) * (1.0 - d * 2.4)); }`;

function beltGeo(id, belt, rnd) {
  const n = belt.n;
  const pos = new Float32Array(n * 3), s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, t = rnd();
    const r = belt.r0 + (belt.r1 - belt.r0) * (0.5 + 0.5 * Math.sin((t - 0.5) * Math.PI)); // 가운데가 짙게
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = (rnd() - 0.5) * belt.h * 2; pos[i * 3 + 2] = Math.sin(a) * r;
    s[i] = 0.35 + rnd() * rnd() * 1.4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('s', new THREE.BufferAttribute(s, 1));
  return g;
}
/** 결정적 난수(mulberry32) */
export function seeded(x) {
  let a = Math.floor(x * 4294967296) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const _c = new THREE.Color(), _h = new THREE.Color(), _k = new THREE.Color(), _t = new THREE.Color();
const ptOut = { x: 0, z: 0, r: 0 };

/** 노드 하나의 궤도계. root 는 몸체 크기(본체 반지름 = 1)를 따르는 묶음에 붙인다 */
export class OrbitSystem {
  constructor(spec, seed01) {
    this.spec = spec;
    this.group = new THREE.Group();
    this.rings = [];
    this.moonMat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1, transparent: true });
    this.glowMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    this.spread = 1; // 위성 군단 산개 배율(유형 반응)
    for (const r of spec.rings) {
      const grp = new THREE.Group();
      grp.rotation.set(r.inc, r.node, 0, 'YXZ');
      const dots = r.style === 'dots';
      const U = {
        uColor: { value: new THREE.Color() }, uHot: { value: new THREE.Color() }, uOp: { value: r.alpha }, uBright: { value: 0.5 },
        uTrail: { value: r.trail }, uDir: { value: r.dir }, uStyle: { value: STYLE[r.style] ?? 0 }, uSeed: { value: seed01 * 7 + this.rings.length * 0.37 },
        uShift: { value: 0 }, uHeads: { value: new THREE.Vector3(-1, -1, -1) }, uPt: { value: 2 },
      };
      const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: RING_V, fragmentShader: RING_F, transparent: true, depthWrite: false });
      const line = dots ? new THREE.Points(ringGeo(r.e, true), mat) : new THREE.LineLoop(ringGeo(r.e, false), mat);
      line.scale.setScalar(r.a);
      line.raycast = () => {};
      line.frustumCulled = false;
      grp.add(line);
      const sats = r.sats.map((s) => {
        const m = new THREE.Mesh(satGeo(), s.kind === 'moon' ? this.moonMat : this.glowMat);
        m.scale.setScalar(s.size); m.raycast = () => {};
        grp.add(m);
        return { s, m };
      });
      this.group.add(grp);
      this.rings.push({ r, grp, line, mat, U, sats, th: r.ph, dots });
    }
    this.belt = null;
    if (spec.belt) {
      const b = spec.belt;
      const U = { uColor: { value: new THREE.Color() }, uOp: { value: 0.5 }, uPx: { value: 30 } };
      const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: BELT_V, fragmentShader: BELT_F, transparent: true, depthWrite: false });
      const pts = new THREE.Points(beltGeo('', b, seeded(seed01 + 0.123)), mat);
      pts.raycast = () => {}; pts.frustumCulled = false;
      const grp = new THREE.Group(); grp.rotation.set(b.inc, b.node, 0, 'YXZ'); grp.add(pts);
      this.group.add(grp);
      this.belt = { grp, pts, mat, U, b };
    }
    // 완료 정리 연출: 퍼지는 고리 파동 하나(필요할 때만 보임)
    const pU = { uColor: { value: new THREE.Color() }, uHot: { value: new THREE.Color() }, uOp: { value: 0 }, uBright: { value: 1 }, uTrail: { value: 0 }, uDir: { value: 1 }, uStyle: { value: 0 }, uSeed: { value: 0 }, uShift: { value: 0 }, uHeads: { value: new THREE.Vector3(-1, -1, -1) }, uPt: { value: 2 } };
    this.pulse = new THREE.LineLoop(ringGeo(0, false), new THREE.ShaderMaterial({ uniforms: pU, vertexShader: RING_V, fragmentShader: RING_F, transparent: true, depthWrite: false }));
    this.pulse.rotation.x = 0.35; this.pulse.visible = false; this.pulse.raycast = () => {}; this.pulseU = pU;
    this.group.add(this.pulse);
    this.lod = -1; this._colKey = null;
  }

  /** 색: base = 노드 색(종류·세션), light = 라이트 테마 */
  setColors(base, light) {
    const key = base.getHexString() + light;
    if (key === this._colKey) return;
    this._colKey = key;
    const lineC = _c.copy(base).lerp(_h.set(light ? 0x1b2333 : 0xffffff), light ? 0.25 : 0.32);
    const hot = _k.copy(base).lerp(_t.set(light ? 0x0d1420 : 0xffffff), light ? 0.4 : 0.7);
    const blend = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (const R of this.rings) {
      R.U.uColor.value.copy(lineC); R.U.uHot.value.copy(hot);
      if (R.mat.blending !== blend) { R.mat.blending = blend; R.mat.needsUpdate = true; }
    }
    this.pulseU.uColor.value.copy(lineC); this.pulseU.uHot.value.copy(hot);
    if (this.pulse.material.blending !== blend) { this.pulse.material.blending = blend; this.pulse.material.needsUpdate = true; }
    this.moonMat.color.copy(base).lerp(_h.set(light ? 0x8f97a6 : 0xc2c9d6), 0.6);
    this.moonMat.emissive.copy(base).multiplyScalar(light ? 0.02 : 0.08);
    this.glowMat.color.copy(base).lerp(_h.set(0xffffff), light ? 0.25 : 0.6);
    if (this.belt) {
      this.belt.U.uColor.value.copy(base).lerp(_h.set(light ? 0x5a6272 : 0xb6bfcf), 0.6);
      if (this.belt.mat.blending !== blend) { this.belt.mat.blending = blend; this.belt.mat.needsUpdate = true; }
    }
  }

  /** 매 프레임. act = {speed, bright}, op = 몸체 투명도, lod = orbitLod, pxPerUnit = 본체 반지름 1 의 화면 px(점 크기용), settle = 정리 연출 경과(초, 없으면 -1) */
  step(dt, lod, act, op, pxPerUnit, reduced, settle, dpr, pxK = 1000, bodyR = 1) {
    if (lod !== this.lod) {
      this.lod = lod;
      this.group.visible = lod >= 1;
      for (let i = 0; i < this.rings.length; i++) {
        const R = this.rings[i];
        const on = lod >= R.r.lod;
        R.grp.visible = on;
        R.line.visible = on && (lod >= 2 || i === 0);
        R.U.uTrail.value = lod >= 2 ? R.r.trail : 0;
      }
      if (this.belt) this.belt.grp.visible = lod >= this.belt.b.lod;
    }
    if (lod < 1) return;
    const sk = settle >= 0 ? settleK(settle) : 0;
    const k = reduced ? 0.15 : 1;
    const bright = Math.min(1.4, act.bright + sk * 0.8);
    const lightK = 1.25; // 1px 선이라 기본 투명도를 조금 올림(다크·라이트 같음)
    const s0 = 1 - 0.14 * sk;
    for (const R of this.rings) {
      if (!R.grp.visible) continue;
      const r = R.r;
      R.th += dt * r.speed * act.speed * k * r.dir * keplerRate(r.e, R.th);
      R.th %= TAU;
      const sp = this.spread * s0;
      R.line.scale.setScalar(r.a * sp);
      R.U.uOp.value = op * r.alpha * (0.55 + 0.6 * bright) * lightK;
      R.U.uBright.value = bright;
      R.U.uPt.value = Math.max(1.5, Math.min(4, pxPerUnit * 0.045 * dpr));
      if (r.style === 'arcs') R.U.uShift.value = (R.U.uShift.value + dt * 0.02 * act.speed * k * r.dir + 1) % 1;
      const h = R.U.uHeads.value; h.set(-1, -1, -1);
      for (let j = 0; j < R.sats.length; j++) {
        const S = R.sats[j];
        const th = R.th + S.s.off;
        orbitPoint(r.a * sp, r.e, th, ptOut);
        S.m.position.set(ptOut.x, 0, ptOut.z);
        S.m.visible = lod >= 2 || j === 0;
        if (j < 3) h.setComponent(j, (((th / TAU) % 1) + 1) % 1);
      }
    }
    this.moonMat.opacity = op; this.moonMat.depthWrite = op >= 0.99;
    this.glowMat.opacity = op * Math.min(1, 0.45 + 0.6 * bright);
    if (this.belt && this.belt.grp.visible) {
      this.belt.grp.rotation.y += dt * this.belt.b.speed * act.speed * k;
      this.belt.U.uOp.value = op * (0.35 + 0.35 * bright) * lightK;
      this.belt.U.uPx.value = pxK * bodyR * 0.03 * dpr;
    }
    // 정리 파동: 본체 1.2 → 3.2 로 퍼지며 사라짐
    if (settle >= 0 && settle < SETTLE_S) {
      const t = settle / SETTLE_S;
      this.pulse.visible = true;
      this.pulse.scale.setScalar(1.2 + 2.0 * t);
      this.pulseU.uOp.value = op * (1 - t) * (1 - t) * 0.8;
    } else if (this.pulse.visible) this.pulse.visible = false;
  }

  /** 위성 하나의 세계 좌표(도구 입자·홀로그램 빔의 출발점). 없으면 false */
  satWorld(i, out) {
    let n = 0;
    for (const R of this.rings) {
      if (!R.grp.visible) continue;
      for (const S of R.sats) { if (!S.m.visible) continue; if (n++ === i) { S.m.getWorldPosition(out); return true; } }
    }
    return false;
  }
  satCount() { let n = 0; for (const R of this.rings) if (R.grp.visible) for (const S of R.sats) if (S.m.visible) n++; return n; }

  dispose() {
    this.group.removeFromParent();
    for (const R of this.rings) R.mat.dispose();
    if (this.belt) { this.belt.mat.dispose(); this.belt.pts.geometry.dispose(); }
    this.pulse.material.dispose();
    this.moonMat.dispose(); this.glowMat.dispose();
  }
}

// ---------- 도구 입자: 궤도에서 연결선 쪽으로 튀어 나감(장면 하나에 풀 하나) ----------
const SPARK_N = 640;
const SPARK_V = /* glsl */`attribute float a; attribute vec3 col; varying float vA; varying vec3 vC; uniform float uPx;
void main() { vA = a; vC = col; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uPx / -mv.z, 1.5, 7.0) * (0.6 + 0.4 * a); }`;
const SPARK_F = /* glsl */`varying float vA; varying vec3 vC;
void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25) discard; gl_FragColor = vec4(vC, vA * (1.0 - d * 3.2)); }`;

export class OrbitSparks {
  constructor(scene) {
    this.pos = new Float32Array(SPARK_N * 3); this.col = new Float32Array(SPARK_N * 3); this.a = new Float32Array(SPARK_N);
    this.vel = new Float32Array(SPARK_N * 3); this.life = new Float32Array(SPARK_N); this.max = new Float32Array(SPARK_N);
    this.drag = new Float32Array(SPARK_N);
    this.next = 0; this.live = 0;
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('col', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('a', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    this.U = { uPx: { value: 60 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: SPARK_V, fragmentShader: SPARK_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.raycast = () => {};
    this.points.renderOrder = 3;
    scene.add(this.points);
  }
  setLight(light) { const b = light ? THREE.NormalBlending : THREE.AdditiveBlending; if (this.mat.blending !== b) { this.mat.blending = b; this.mat.needsUpdate = true; } }
  /** from 에서 dir(단위) 쪽으로 speed, 퍼짐 spread, 수명 life(초), 색 color, drag(초당 감속 비율) */
  emit(from, dir, speed, spread, life, color, drag = 1.2) {
    const i = this.next; this.next = (this.next + 1) % SPARK_N;
    const q = i * 3;
    this.pos[q] = from.x; this.pos[q + 1] = from.y; this.pos[q + 2] = from.z;
    const rx = (Math.random() - 0.5) * 2 * spread, ry = (Math.random() - 0.5) * 2 * spread, rz = (Math.random() - 0.5) * 2 * spread;
    const sp = speed * (0.7 + Math.random() * 0.6);
    this.vel[q] = (dir.x + rx) * sp; this.vel[q + 1] = (dir.y + ry) * sp; this.vel[q + 2] = (dir.z + rz) * sp;
    this.col[q] = color.r; this.col[q + 1] = color.g; this.col[q + 2] = color.b;
    this.life[i] = life; this.max[i] = life; this.drag[i] = drag; this.a[i] = 1;
  }
  update(dt, pxScale) {
    let live = 0;
    for (let i = 0; i < SPARK_N; i++) {
      if (this.life[i] <= 0) { if (this.a[i] !== 0) this.a[i] = 0; continue; }
      live++;
      this.life[i] -= dt;
      const q = i * 3, dk = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[q] *= dk; this.vel[q + 1] *= dk; this.vel[q + 2] *= dk;
      this.pos[q] += this.vel[q] * dt; this.pos[q + 1] += this.vel[q + 1] * dt; this.pos[q + 2] += this.vel[q + 2] * dt;
      const t = Math.max(0, this.life[i] / this.max[i]);
      this.a[i] = t < 0.7 ? t / 0.7 : 1;
    }
    this.live = live;
    this.U.uPx.value = pxScale;
    this.points.visible = live > 0;
    if (live || this._was) {
      this.geo.attributes.position.needsUpdate = true; this.geo.attributes.a.needsUpdate = true; this.geo.attributes.col.needsUpdate = true;
    }
    this._was = live > 0;
  }
  clear() { this.life.fill(0); this.a.fill(0); }
  dispose() { this.points.removeFromParent(); this.geo.dispose(); this.mat.dispose(); }
}
