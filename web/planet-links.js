// Planet 3D 관계선 — 레이저 통신 링크 ⇄ 궤도 공명 고리. 예전 1px 직선 + 흐르는 점(scene.js _updateLinks)을 대신한다.
//  · 띠(ribbon) 하나를 정점 셰이더가 직선(빔) 또는 원호(고리)로 펴는 인스턴스 1호출: 화면을 향한 띠라 어느 각도에서나 원기둥처럼 보이고,
//    멀어져도 최소 굵기(px)를 지킨다(가늘어진 만큼 옅게). 펄스·밝기 흐름·점선은 조각 셰이더.
//  · 레이저 양 끝 작은 접시 안테나 = InstancedMesh 1호출(전환 때 접시가 줄었다 커짐).
//  · 충돌 섬광 = 구 InstancedMesh 1호출. 칩은 SessionFx 가 그대로 두되 자리만 여기서 정한다(view.confHook).
//  · 상태 박자·전환 시계는 plinks-core.mjs(2D 와 같은 값).
import * as THREE from 'three';
import { PLINKS, plinksMix, stateKey, stepState, laserLook, orbitLook, endGaps, circleMeet } from './plinks-core.mjs';
import { isGuessLink } from './batch-core.mjs';
import { hash01 } from './planet-core.mjs';

const SEG = 64;            // 띠 하나의 토막 수(호가 매끈하게)
const CAP0 = 256;
const FLARE_CAP = 64;
const MSG_DUR = 1.6, MSG_TAIL = 0.6;
const UP = new THREE.Vector3(0, 1, 0);

const VERT = /* glsl */`
uniform vec2 uRes; uniform float uMaxPx;
attribute float aU; attribute float aS;
attribute vec3 iA; attribute vec3 iB; attribute vec3 iC;
attribute vec4 iK; attribute vec4 iCol; attribute vec4 iP; attribute vec4 iD; attribute vec2 iE;
varying float vU; varying float vS; varying float vThin; varying vec4 vCol; varying vec4 vP; varying vec4 vD;
vec3 pt(float u) {
  if (iK.x < 0.5) return mix(iA, iB, u);
  float th = -iE.y - iK.y * (1.0 - u);
  return iA + cos(th) * iB + sin(th) * iC;
}
void main() {
  float u = aU * iE.x;
  vec3 p = pt(u);
  vec3 q = pt(min(1.0, u + 0.004)); vec3 r = pt(max(0.0, u - 0.004));
  mat4 vp = projectionMatrix * viewMatrix;
  vec4 c = vp * vec4(p, 1.0); vec4 cq = vp * vec4(q, 1.0); vec4 cr = vp * vec4(r, 1.0);
  vec2 h = uRes * 0.5;
  vec2 d = cq.xy / max(cq.w, 1e-4) * h - cr.xy / max(cr.w, 1e-4) * h;
  float L = length(d); d = L > 1e-5 ? d / L : vec2(1.0, 0.0);
  float wTrue = iK.z * projectionMatrix[1][1] * h.y / max(c.w, 1e-4);
  float wpx = clamp(wTrue, iK.w, max(iK.w, uMaxPx)); // 카메라 바로 앞을 지나는 큰 호가 굵은 띠가 되지 않게 상한
  vThin = clamp(wTrue / max(iK.w, 1e-3), 0.4, 1.0);
  c.xy += vec2(-d.y, d.x) * aS * wpx * 0.5 / h * c.w;
  gl_Position = c;
  vU = u; vS = aS; vCol = iCol; vP = iP; vD = iD;
}`;
const FRAG = /* glsl */`
uniform float uLight;
varying float vU; varying float vS; varying float vThin; varying vec4 vCol; varying vec4 vP; varying vec4 vD;
void main() {
  if (vD.x > 0.0 && fract(vU * vD.x) > vD.y) discard;
  float x = 1.0 - abs(vS);
  float core = 0.32 * x * x * (3.0 - 2.0 * x) + 0.95 * smoothstep(0.45, 1.0, x); // 옅은 둘레 + 밝은 심(빔)
  float pulse = vP.z > 0.0 ? pow(fract(vU * vP.z - vP.y), vP.w) : 0.0;
  float tail = mix(1.0, 0.1 + 0.9 * vU * vU, vD.w);
  float a = clamp((vCol.a + vP.x * pulse) * tail * core * vThin, 0.0, 1.0);
  if (a < 0.004) discard;
  if (uLight > 0.5) gl_FragColor = vec4(mix(vec3(1.0), vCol.rgb, min(1.0, a * 1.5)), 1.0); // 라이트: 곱하기 잉크는 같은 세기면 옅어 보여 진하게
  else gl_FragColor = vec4(min(vec3(1.0), mix(vCol.rgb, vec3(1.0), 0.25 * smoothstep(0.6, 1.0, x)) * 1.25 + vec3(0.45 * pulse * vP.x)), a);
}`;

export class PlanetLinks {
  constructor(scene, view) {
    this.view = view;
    this.scene = scene;
    this.cap = 0;
    this.n = 0;
    const base = new THREE.BufferGeometry();
    const U = new Float32Array((SEG + 1) * 2), S = new Float32Array((SEG + 1) * 2), P = new Float32Array((SEG + 1) * 2 * 3);
    for (let i = 0; i <= SEG; i++) { U[i * 2] = U[i * 2 + 1] = i / SEG; S[i * 2] = -1; S[i * 2 + 1] = 1; }
    const idx = [];
    for (let i = 0; i < SEG; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    this.geo.setAttribute('aU', new THREE.BufferAttribute(U, 1));
    this.geo.setAttribute('aS', new THREE.BufferAttribute(S, 1));
    base.dispose();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uLight: { value: 0 }, uMaxPx: { value: 4.5 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this._grow(CAP0);
    // 접시 안테나(레이저 양 끝): 열린 원뿔, 넓은 쪽이 상대를 향함
    const dg = new THREE.ConeGeometry(1, 0.55, 16, 1, true);
    dg.rotateX(-Math.PI / 2); // 꼭짓점 -z, 입 +z
    this.dishMat = new THREE.MeshStandardMaterial({ color: 0x9aa6bd, roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide, emissive: 0x111827 });
    this.dishCap = CAP0 * 2;
    this.dishes = new THREE.InstancedMesh(dg, this.dishMat, this.dishCap);
    this.dishes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dishes.count = 0; this.dishes.frustumCulled = false;
    scene.add(this.dishes);
    // 충돌 섬광
    this.flareMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.9 });
    this.flares = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), this.flareMat, FLARE_CAP);
    this.flares.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flares.setColorAt(0, new THREE.Color(1, 1, 1));
    this.flares.count = 0; this.flares.frustumCulled = false; this.flares.renderOrder = 3;
    scene.add(this.flares);
    this.msgs = [];      // 세션 간 메시지 빔(레이저)
    this._conf = [];     // SessionFx 가 이번 프레임 넘긴 충돌(다음 프레임에 그림)
    this._confNext = [];
    this.mix = { mode: 'laser', w: 0, fading: false };
    this._last = performance.now() / 1000;
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3(); this._v4 = new THREE.Vector3();
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this._c = new THREE.Color(); this._c2 = new THREE.Color();
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._z = new THREE.Vector3(0, 0, 1);
    this.applyTheme(view.tokens);
  }

  _grow(n) {
    if (n <= this.cap) return;
    let cap = Math.max(CAP0, this.cap);
    while (cap < n) cap *= 2;
    const mk = (k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.A = { iA: mk(3), iB: mk(3), iC: mk(3), iK: mk(4), iCol: mk(4), iP: mk(4), iD: mk(4), iE: mk(2) };
    for (const [k, a] of Object.entries(this.A)) this.geo.setAttribute(k, a);
    this.cap = cap;
  }

  applyTheme(t) {
    if (!t) return;
    this.tokens = t;
    const light = !!t.isLight;
    this.mat.uniforms.uLight.value = light ? 1 : 0;
    this.mat.blending = light ? THREE.MultiplyBlending : THREE.AdditiveBlending; // 라이트 = 곱하기 잉크, 다크 = 가산
    this.mat.premultipliedAlpha = light;
    this.mat.needsUpdate = true;
    this.flareMat.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending; this.flareMat.needsUpdate = true;
    this.dishMat.color.set(light ? 0x7c8598 : 0x9aa6bd);
  }

  /** 세션 간 메시지: 레이저면 그 순간만 켜지는 빔 */
  message(fromId, toId, color) { this.msgs.push({ from: fromId, to: toId, t0: performance.now() / 1000, col: color.clone() }); if (this.msgs.length > 16) this.msgs.shift(); }

  /** SessionFx 충돌 갈고리: 칩 자리(out)를 정해 주고 곡선 대신 여기서 그린다 */
  confHook(A, B, k, strong, slot, out) {
    const a = A.group.position, b = B.group.position;
    const d = a.distanceTo(b);
    const xl = this._v.copy(a).add(b).multiplyScalar(0.5); xl.y += d * 0.22 + slot * 1.2; // 레이저: 두 빔이 맞는 점
    const r = d * 0.62, m = circleMeet(a.x, a.z, b.x, b.z, r, this._mz || (this._mz = { x: 0, z: 0 }));
    const xo = this._v2.set(m.x, (a.y + b.y) / 2 + slot * 0.8, m.z); // 궤도: 두 바깥 호가 겹치는 점
    if (this._confNext.length < 32) this._confNext.push({ A, B, k, strong, xl: xl.clone(), xo: xo.clone(), r });
    out.copy(xl).lerp(xo, this.mix.w);
    return true;
  }

  // ---- 인스턴스 하나 쓰기 ----
  _put(kind, A, B, C, span, wWorld, wPx, col, alpha, P, D, keep, endOff) {
    if (this.n >= this.cap) this._grow(this.n + 1);
    const i = this.n++, X = this.A;
    X.iA.setXYZ(i, A.x, A.y, A.z); X.iB.setXYZ(i, B.x, B.y, B.z);
    if (C) X.iC.setXYZ(i, C.x, C.y, C.z); else X.iC.setXYZ(i, 0, 0, 0);
    X.iK.setXYZW(i, kind, span, wWorld, wPx);
    X.iCol.setXYZW(i, col.r, col.g, col.b, alpha);
    X.iP.setXYZW(i, P ? P.p : 0, P ? P.ph : 0, P ? P.rep : 0, P ? P.sharp : 4);
    X.iD.setXYZW(i, D ? D.dash : 0, D ? D.on : 0.5, 0, D ? D.tail : 0);
    X.iE.setXY(i, keep, endOff || 0);
  }
  _dish(at, toward, s) {
    if (this.nd >= this.dishCap || s < 1e-3) return;
    this._v4.copy(toward).sub(at); if (this._v4.lengthSq() < 1e-8) return;
    this._q.setFromUnitVectors(this._z, this._v4.normalize());
    this._s.setScalar(s);
    this._m.compose(at, this._q, this._s);
    this.dishes.setMatrixAt(this.nd++, this._m);
  }
  _flare(p, s, col) {
    if (this.nf >= FLARE_CAP) return;
    this._s.setScalar(s); this._q.identity();
    this._m.compose(p, this._q, this._s);
    this.flares.setMatrixAt(this.nf, this._m); this.flares.setColorAt(this.nf, col); this.nf++;
  }
  /** 궤도계 겉 반지름(세계): 본체 그린 크기 × 궤도계 extent */
  _outer(v) { const d = this.view.deco; return v.mesh.scale.x * (d ? Math.min(2.6, d.extentOf(v.id)) : 1.2); }
  /** 호 평면 축: R = 중심 → 자식, Y = R 에 수직(대체로 수평) + 노드별 약간 기울임 */
  _axes(center, child, seed, R, Y) {
    R.copy(child).sub(center);
    const L = R.length() || 1e-6;
    Y.crossVectors(UP, R); if (Y.lengthSq() < 1e-8) Y.set(1, 0, 0);
    Y.normalize();
    const tilt = (seed - 0.5) * 0.5; // ±0.25rad
    Y.applyAxisAngle(this._v3.copy(R).normalize(), tilt).multiplyScalar(L);
    return L;
  }

  update(now, t) {
    const view = this.view;
    const dt = Math.min(0.1, Math.max(0, now - this._last)); this._last = now;
    const busy = !!(view.flow && view.flow.pool.active.length);
    const mx = this.mix = plinksMix(busy, view.reduced);
    const wO = mx.w, wL = 1 - wO;
    const red = !!view.reduced;
    this.n = 0; this.nd = 0; this.nf = 0;
    const el = view.renderer.domElement;
    this.mat.uniforms.uRes.value.set(el.clientWidth || el.width || 1, el.clientHeight || el.height || 1);
    const bg = t.bg, link = t.link;
    const light = !!t.isLight;
    const col = this._c, c2 = this._c2;
    const A = this._a, B = this._b, R = this._v, Y = this._v2;
    const camD = view.focusDist || view.camera.position.length();
    const minPx = light ? 1.7 : 1.6;
    for (const [cv, pv] of view.links) {
      if (cv.gone || pv.gone || cv.hidden || pv.hidden || cv.projGone || pv.projGone) continue;
      const st = cv.node.status;
      const S = cv._plS = stepState(cv._plS, stateKey(st, st === 'error' && cv.stale), dt);
      if (cv._plSeed == null) cv._plSeed = hash01(cv.id, 'pl');
      const seed = cv._plSeed;
      const cp = cv.kind === 'claude-p';
      // 색: 종류(claude -p 금색)·세션·상태
      col.copy(cp ? t['k-claude-p'] : cv.sessC ? c2.copy(cv.sessC).lerp(link, 0.35) : link);
      if (S.done > 0.01) col.lerp(c2.copy(col).lerp(bg, 0.55), S.done * 0.85);
      if (S.stop > 0.01) col.lerp(t.stopped, S.stop * 0.8);
      if (S.err > 0.01) col.lerp(t.error, S.err * (red ? 1 : 0.75 + 0.25 * Math.sin(now * 7)));
      if (light) col.multiplyScalar(0.85);
      // 세기 배율: 희미·페이드, 퇴장
      let m = cv.scopeK != null && cv.scopeK < 1 ? 0.2 + 0.8 * cv.scopeK : 1;
      if (cv.exitF < 1) m *= cv.exiting != null ? 1 - 0.65 * (1 - cv.exitF) : cv.exitF;
      if (m < 0.02) continue;
      const keep = cv._linkK > 0 ? Math.max(0, 1 - cv._linkK) : 1; // 퇴장: 자식 끝부터 감김
      const guess = isGuessLink(cv.node); // 추정 연결은 점선
      const a = pv.group.position, b = cv.group.position;
      const dist = a.distanceTo(b);
      if (dist < 1e-3) continue;
      const [ga, gb] = endGaps(dist, this._outer(pv), this._outer(cv));
      const wBase = Math.max(0.06, Math.min(0.2, dist * 0.012)) * (cp ? 0.6 : 1);
      // ---- 레이저 ----
      if (wL > 0.01) {
        const L = laserLook(S, dist, now, seed, red);
        A.copy(b).sub(a).multiplyScalar(ga / dist).add(a);
        B.copy(a).sub(b).multiplyScalar(gb / dist).add(b);
        const len = Math.max(0.1, dist - ga - gb);
        const al = L.a * m * wL;
        const P = { p: L.p * m * wL, ph: L.ph, rep: L.rep * (len / Math.max(0.5, dist)), sharp: L.sharp };
        const D = { dash: guess ? len * 1.3 : 0, on: 0.55, tail: 0 };
        if (cp) { // 금색 이중 빔
          const side = this._v3.crossVectors(this._v4.copy(B).sub(A), UP); if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
          side.normalize().multiplyScalar(Math.max(0.12, wBase * 2.2));
          for (const sg of [1, -1]) {
            const a2 = R.copy(A).addScaledVector(side, sg), b2 = Y.copy(B).addScaledVector(side, sg);
            this._put(0, a2, b2, null, 0, wBase, minPx, col, al, { ...P, ph: P.ph + (sg > 0 ? 0 : 0.5) }, D, keep, 0);
          }
        } else this._put(0, A, B, null, 0, wBase, minPx, col, al, P, D, keep, 0);
        if (L.guide > 0.01) this._put(0, A, B, null, 0, wBase * 0.6, 1, col, L.guide * m * wL, null, { dash: len * 1.4, on: 0.35, tail: 0 }, keep, 0);
        // 접시: 크기는 전환 무게로(줄었다 커짐), 자식 쪽은 감김을 따라
        const ds = Math.max(0.05, Math.min(0.15, 0.22 * Math.min(ga, gb), wBase * 1.4)) * Math.min(1, wL * 1.6) * (cv.exitF < 1 ? cv.exitF : 1) * (cv.scopeK != null && cv.scopeK < 0.5 ? 0 : 1);
        if (ds > 0.01 && camD < 420) {
          this._dish(A, B, ds);
          if (keep > 0.97) this._dish(B, A, ds * (cp ? 0.85 : 1));
        }
      }
      // ---- 궤도 공명 고리 ----
      if (wO > 0.01) {
        const O = orbitLook(S, now, seed, red);
        const D = { dash: guess ? 40 : O.dash, on: guess ? 0.5 : O.on, tail: O.tail };
        if (cp) { // 자기 초점(부모가 아님)의 금색 점선 호 + 부모에서 초점까지 옅은 실
          const F = this._v4.copy(b).sub(a).multiplyScalar(0.45).add(a);
          const side = this._v3.crossVectors(this._v.copy(b).sub(a), UP); if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
          F.addScaledVector(side.normalize(), dist * 0.18 * (seed < 0.5 ? 1 : -1)); F.y += dist * 0.06;
          const Fc = F.clone();
          const Lr = this._axes(Fc, b, seed, R, Y);
          const g = Math.min(0.6, gb / Math.max(0.1, Lr));
          this._put(1, Fc, R, Y, PLINKS.CP_SPAN, wBase * 0.9, minPx, col, O.a * m * wO * 1.1, { p: O.p * m * wO, ph: O.ph, rep: O.rep, sharp: O.sharp }, { dash: 30, on: 0.55, tail: D.tail }, keep, g);
          A.copy(Fc).sub(a).normalize().multiplyScalar(ga).add(a);
          this._put(0, A, Fc, null, 0, wBase * 0.5, 1, col, 0.22 * m * wO * (1 - S.done * 0.5), null, { dash: Math.max(4, A.distanceTo(Fc) * 1.6), on: 0.3, tail: 0 }, 1, 0);
        } else {
          const Lr = this._axes(a, b, seed, R, Y);
          const g = Math.min(0.6, gb / Math.max(0.1, Lr));
          this._put(1, a, R, Y, PLINKS.ARC_SPAN, wBase, minPx, col, O.a * m * wO, { p: O.p * m * wO, ph: O.ph, rep: O.rep, sharp: O.sharp }, D, keep, g);
        }
      }
    }
    this._spawn(t, wL, wO, now, minPx);
    this._messages(t, wL, now, minPx);
    this._conflicts(t, wL, wO, now, minPx, camD);
    this.geo.instanceCount = this.n;
    if (this.n) for (const a of Object.values(this.A)) { a.needsUpdate = true; a.clearUpdateRanges && a.clearUpdateRanges(); a.addUpdateRange && a.addUpdateRange(0, this.n * a.itemSize); }
    this.mesh.visible = this.n > 0;
    this.dishes.count = this.nd; if (this.nd) this.dishes.instanceMatrix.needsUpdate = true;
    this.flares.count = this.nf; if (this.nf) { this.flares.instanceMatrix.needsUpdate = true; this.flares.instanceColor.needsUpdate = true; }
  }

  /** 띄움(기동기 ↔ 띄운 노드): 레이저 = 가끔 번쩍이는 점선, 궤도 = 기동기 곁 짧은 점선 호 */
  _spawn(t, wL, wO, now, minPx) {
    const view = this.view, bg = t.bg, base = t['link-spawn'];
    const col = this._c;
    let k = 0;
    for (const [lv, sv] of view.spawnLinks || []) {
      if (k++ >= 24) break;
      if (lv.gone || sv.gone || lv.hidden || sv.hidden) continue;
      const fade = Math.min(lv.scopeK ?? 1, sv.scopeK ?? 1) * Math.min(lv.exitF ?? 1, sv.exitF ?? 1);
      if (fade < 0.05) continue;
      col.copy(base).lerp(bg, 1 - 0.85 * fade);
      const a = lv.group.position, b = sv.group.position, dist = a.distanceTo(b);
      if (dist < 1e-3) continue;
      const seed = hash01(sv.id, 'sp');
      const [ga, gb] = endGaps(dist, this._outer(lv), this._outer(sv));
      if (wL > 0.01) {
        const ping = this.view.reduced ? 0 : Math.pow(Math.max(0, Math.sin(now * 0.9 + seed * 6)), 30);
        this._a.copy(b).sub(a).multiplyScalar(ga / dist).add(a); this._b.copy(a).sub(b).multiplyScalar(gb / dist).add(b);
        const len = this._a.distanceTo(this._b);
        this._put(0, this._a, this._b, null, 0, 0.04, 1, col, (0.3 + 0.6 * ping) * fade * wL, null, { dash: Math.max(3, len * 1.2), on: 0.4, tail: 0 }, 1, 0);
      }
      if (wO > 0.01) {
        const Lr = this._axes(a, b, seed, this._v, this._v2);
        this._put(1, a, this._v, this._v2, PLINKS.SPAWN_SPAN, 0.04, 1, col, 0.45 * fade * wO, null, { dash: 16, on: 0.5, tail: 0.5 }, 1, Math.min(0.5, gb / Math.max(0.1, Lr)));
      }
    }
  }

  /** 세션 간 메시지(레이저): 보내는 순간부터 도착 뒤 잠깐까지 켜지는 빔 */
  _messages(t, wL, now, minPx) {
    if (!this.msgs.length) return;
    const keep = [];
    for (const mg of this.msgs) {
      const age = now - mg.t0;
      if (age > MSG_DUR + MSG_TAIL) continue;
      keep.push(mg);
      if (wL < 0.01) continue;
      const fv = this.view.vis.get(mg.from), tv = this.view.vis.get(mg.to);
      if (!fv || !tv || fv.hidden || tv.hidden) continue;
      const k = age < MSG_DUR ? Math.min(1, age / 0.15) : 1 - (age - MSG_DUR) / MSG_TAIL;
      const a = fv.group.position, b = tv.group.position, dist = a.distanceTo(b);
      if (dist < 1e-3) continue;
      const [ga, gb] = endGaps(dist, this._outer(fv), this._outer(tv));
      this._a.copy(b).sub(a).multiplyScalar(ga / dist).add(a); this._b.copy(a).sub(b).multiplyScalar(gb / dist).add(b);
      this._put(0, this._a, this._b, null, 0, 0.09, 1.6, mg.col, 0.35 * k * wL, { p: 0.9 * k * wL, ph: now * 2, rep: 3, sharp: 6 }, null, 1, 0);
    }
    this.msgs = keep;
  }

  /** 같은 파일 충돌: 레이저 = 두 메인의 빔이 한 점에 맞아 간섭 섬광, 궤도 = 두 바깥 호가 겹치는 점 섬광 */
  _conflicts(t, wL, wO, now, minPx, camD) {
    this._conf = this._confNext; this._confNext = [];
    if (!this._conf.length) return;
    const base = t.conflict, bg = t.bg, col = this._c, fc = this._c2;
    const ws = Math.max(1, camD / 38);
    for (const it of this._conf) {
      const k = it.k;
      col.copy(base).lerp(bg, (1 - k) * 0.85 + (it.strong ? 0 : 0.15));
      const fl = (0.5 + 0.4 * Math.abs(Math.sin(now * 13) * Math.sin(now * 7.3))) * (0.6 + k) * (it.strong ? 0.55 : 0.4) * ws;
      fc.copy(col);
      if (wL > 0.01) {
        for (const V of [it.A, it.B]) {
          const a = V.group.position, d = a.distanceTo(it.xl); if (d < 1e-3) continue;
          this._a.copy(it.xl).sub(a).multiplyScalar(Math.min(0.8 * d, this._outer(V)) / d).add(a);
          this._put(0, this._a, it.xl, null, 0, it.strong ? 0.07 : 0.045, minPx, col, 0.25 * k * wL, { p: 0.75 * k * wL, ph: now * 1.4, rep: 3, sharp: 8 }, null, 1, 0);
        }
        this._flare(it.xl, fl * wL, fc);
      }
      if (wO > 0.01) {
        for (const V of [it.A, it.B]) {
          // 두 메인 둘레 바깥 호 중 겹치는 점 쪽 약 70°만(온 원을 그리면 먼 메인끼리 화면을 덮는다)
          const a = V.group.position, phi = Math.atan2(it.xo.z - a.z, it.xo.x - a.x), sp = 1.2;
          this._v.set(it.r, 0, 0); this._v2.set(0, 0, it.r);
          this._put(1, a, this._v, this._v2, sp, 0.05, 1, col, 0.3 * k * wO, null, { dash: 10, on: 0.55, tail: 0 }, 1, -(phi + sp / 2));
        }
        this._flare(it.xo, fl * wO, fc);
      }
    }
  }

  dispose() {
    for (const o of [this.mesh, this.dishes, this.flares]) o.removeFromParent();
    this.geo.dispose(); this.mat.dispose(); this.dishes.geometry.dispose(); this.dishMat.dispose(); this.flares.geometry.dispose(); this.flareMat.dispose();
    this.msgs = []; this._conf = []; this._confNext = [];
  }
}
