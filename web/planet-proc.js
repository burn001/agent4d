// Planet 3D 분리 프로세스 · 장시간 직렬 작업 연출 — PlanetDeco 가 소유, 규칙은 planet-proc-core.mjs(순수).
//  · 분리 프로세스(meta.proc) = 작은 소행성 위 채굴 드릴 플랫폼: 갑판 · 삼각 데릭 · 회전 오거 드릴(처리율 = 회전, 과열 = 느려지고 멈칫)
//    · 구멍 둘레 열 고리(과열이면 호박 → 주홍 발광 + 열기 입자) · 굴뚝 연기 · 상태 등(정체 = 호박 깜빡임).
//  · 레인마다 컨베이어 궤도(점선이 흐르는 2차 곡선) — 광석 덩이(인스턴싱 1)가 플랫폼에서 띄운 행성 쪽 화물 링으로 흘러가 쌓인다(인스턴싱 1).
//  · 자동 진행 작업(src 'auto') = 플랫폼 옆 계기 홀로그램(캔버스 스프라이트): 레인 오도미터(끝자리가 굴러감) · 처리율 · 최장 · 과열 막대
//    · total 이면 진행 호·ETA · progress 들여다보기 뒤 체크. 멀면 큰 숫자 하나(화면 크기 고정).
//  · 들여다보기(watch): wait = 플랫폼 둘레 대기 궤도 고리 + 도는 탐사선, peek·끝난 펄스 = 읽는 노드에서 플랫폼을 훑는 스캔 빔,
//    progress = 플랫폼 → 읽는 노드로 돌아오는 작은 패킷.
//  선·궤도·빔은 장면 전체 LineSegments 하나, 광석·화물·탐사선은 InstancedMesh 셋 — 프로세스가 없으면 아무것도 그리지 않는다.
import * as THREE from 'three';
import { PROC, procLook, drillSpin, drillHitch, heatTip, heatSparkRate, OreFeed, oreFlight, oreEase, conveyorBend, quadAt, cargoCount, cargoSlot,
  procLod, meterModel, meterBig, laneColor, ProcWatch, watchLook, procName, isExtRig, extRigState, extRigJob, extMeterModel, extMeterBig } from './planet-proc-core.mjs';
import { isProc, procState, procJobId, isAutoJob, jobOf, laneValue, isJobEndedState } from './job-core.mjs';
import { hash01 } from './planet-core.mjs';
import { MeterCanvas } from './proc-meter.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
let G = null;

/** 지오메트리 여럿(행렬 적용)을 비색인 한 지오메트리로(위치·법선) — BufferGeometryUtils 없이(importmap SRI 목록을 늘리지 않음) */
function mergeGeos(list) {
  let n = 0;
  const parts = list.map(({ geo, m }) => { const g = (geo.index ? geo.toNonIndexed() : geo.clone()); if (m) g.applyMatrix4(m); n += g.attributes.position.count; return g; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); o += g.attributes.position.array.length; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}
const _m = new THREE.Matrix4(), _q0 = new THREE.Quaternion(), _s1 = new THREE.Vector3(1, 1, 1);
/** a → b 를 잇는 가는 상자(굵기 w) 행렬 */
function beamM(a, b, w) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
  return { geo: new THREE.BoxGeometry(w, L, w), m: new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, _s1) };
}

function geo() {
  if (G) return G;
  // 소행성: 이십면체(세분 1)를 위치 해시로 울퉁불퉁하게, 윗면은 갑판 자리로 평평하게 깎음
  const ast = new THREE.IcosahedronGeometry(1, 1);
  const p = ast.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    const k = (0.82 + 0.3 * (h - Math.floor(h))) * 0.8; // 플랫폼이 주인공이 되게 바위는 몸체의 0.8 배
    p.setXYZ(i, x * k, Math.min(y * k, PROC.DECK_Y - 0.04), z * k);
  }
  ast.computeVertexNormals();
  const D = PROC.DECK_Y, T = PROC.TOP_Y;
  // 고정 구조(갑판·데릭 다리 셋·가로대·꼭대기 도르래·굴뚝)
  const fixed = [];
  fixed.push({ geo: new THREE.CylinderGeometry(0.66, 0.74, 0.12, 10), m: new THREE.Matrix4().makeTranslation(0, D, 0) });
  const apex = new THREE.Vector3(0, T, 0);
  const feet = [0, 1, 2].map((i) => { const a = (i / 3) * TAU + 0.5; return new THREE.Vector3(Math.cos(a) * 0.56, D + 0.06, Math.sin(a) * 0.56); });
  for (const f of feet) fixed.push(beamM(f, apex, 0.07));
  for (const h of [0.38, 0.7]) { // 가로대 두 단
    const ring = feet.map((f) => f.clone().lerp(apex, h));
    for (let i = 0; i < 3; i++) fixed.push(beamM(ring[i], ring[(i + 1) % 3], 0.035));
  }
  fixed.push({ geo: new THREE.BoxGeometry(0.2, 0.12, 0.2), m: new THREE.Matrix4().makeTranslation(0, T + 0.02, 0) });
  fixed.push({ geo: new THREE.CylinderGeometry(0.075, 0.09, 0.56, 8), m: new THREE.Matrix4().makeTranslation(0.44, D + 0.32, -0.3) });
  fixed.push({ geo: new THREE.TorusGeometry(0.085, 0.02, 4, 10).rotateX(Math.PI / 2), m: new THREE.Matrix4().makeTranslation(0.44, D + 0.6, -0.3) });
  // 회전 부분(드릴): 축 · 회전 테이블(돌기 넷) · 오거 날(나선 상자 26)
  const drill = [];
  drill.push({ geo: new THREE.CylinderGeometry(0.045, 0.045, T - 0.5, 6), m: new THREE.Matrix4().makeTranslation(0, (T + 0.5) / 2, 0) });
  drill.push({ geo: new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12), m: new THREE.Matrix4().makeTranslation(0, D + 0.1, 0) });
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; drill.push({ geo: new THREE.BoxGeometry(0.1, 0.07, 0.06), m: new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * 0.26, D + 0.16, Math.sin(a) * 0.26), new THREE.Quaternion().setFromAxisAngle(UP, -a), _s1) }); }
  const NF = 26;
  for (let i = 0; i < NF; i++) {
    const u = i / NF, a = u * TAU * 3.2, y = D + 0.26 + u * (T - D - 0.5);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, -a, 0, 'YXZ'));
    drill.push({ geo: new THREE.BoxGeometry(0.26, 0.03, 0.1), m: new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * 0.15, y, Math.sin(a) * 0.15), q, _s1) });
  }
  // 열 고리(구멍 둘레) · 드릴 끝(구멍 안 원뿔 — 소행성 윗면 바로 아래)
  const collar = new THREE.TorusGeometry(0.17, 0.045, 6, 18).rotateX(Math.PI / 2).translate(0, D + 0.07, 0);
  const bit = new THREE.ConeGeometry(0.12, 0.34, 8).rotateX(Math.PI).translate(0, D - 0.08, 0);
  G = {
    ast, fixed: mergeGeos(fixed), drill: mergeGeos(drill), collar, bit,
    lamp: new THREE.SphereGeometry(0.07, 8, 6),
    ore: new THREE.IcosahedronGeometry(1, 0),
    probe: new THREE.OctahedronGeometry(1, 0),
    puck: new THREE.CylinderGeometry(0.55, 0.75, 0.4, 10), // 계기 투사기(작업 노드 몸체 — 클릭 판정)
  };
  return G;
}

// 선(컨베이어·대기 고리·스캔 빔): 꼭짓점마다 색·알파·무늬 u(CPU 가 흐름까지 넣음, u < -0.5 = 실선)
const LINE_V = /* glsl */`attribute vec3 col; attribute float a; attribute float u; varying vec3 vC; varying float vA; varying float vU;
void main() { vC = col; vA = a; vU = u; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const LINE_F = /* glsl */`varying vec3 vC; varying float vA; varying float vU;
void main() {
  float d = vU < -0.5 ? 1.0 : 0.3 + 0.7 * step(0.45, fract(vU));
  float a = vA * d;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vC, a);
  #include <colorspace_fragment>
}`;
const LINE_CAP = 12000;

/** 광석·화물: 표준 재질 + 인스턴스 색이 발광에도 곱해지게(다크에서 은은히 빛남) */
function oreMat() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.25, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0.28 });
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif'); };
  m.customProgramCacheKey = () => 'proc-ore';
  return m;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _col = new THREE.Color(), _col2 = new THREE.Color(), _mm = new THREE.Matrix4(), _qq = new THREE.Quaternion(), _sv = new THREE.Vector3();
const _pa = { x: 0, y: 0, z: 0 }, _pc = { x: 0, y: 0, z: 0 }, _pb = { x: 0, y: 0, z: 0 }, _po = { x: 0, y: 0, z: 0 };

/** 분리 프로세스 하나의 채굴 플랫폼(노드 묶음에 붙음 — 숨김·퇴장·위치를 같이 따른다) */
class ProcRig {
  constructor(fx, v) {
    const g = geo();
    this.fx = fx; this.v = v;
    this.ext = isExtRig(v.node); // 안 C: 외부 작업 노드 자신이 플랫폼 — 레인·계기는 그 작업에서
    this.meter = this.ext ? new ProcMeter(fx, v, { body: false, lift: PROC.TOP_Y + 0.45, model: extMeterModel, big: extMeterBig }) : null;
    v.mesh.geometry = g.ast;
    v.mesh.rotation.set(0, hash01(v.id, 'ry') * TAU, 0);
    this.root = new THREE.Group(); v.group.add(this.root);
    this.metal = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.65, transparent: true, flatShading: true });
    this.steel = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.8, transparent: true, flatShading: true });
    this.hot = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    this.lampMat = new THREE.MeshBasicMaterial({ transparent: true });
    v.mat.roughness = 0.88; v.mat.metalness = 0.04; // 바위: 반사를 줄여 흰 면이 번쩍이지 않게
    this.fixed = new THREE.Mesh(g.fixed, this.metal);
    this.drill = new THREE.Mesh(g.drill, this.steel);
    this.collar = new THREE.Mesh(g.collar, this.hot);
    this.bit = new THREE.Mesh(g.bit, this.hot);
    this.lamp = new THREE.Mesh(g.lamp, this.lampMat); this.lamp.position.set(-0.52, PROC.DECK_Y + 0.12, 0.3);
    this.glowMat = new THREE.SpriteMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glow = new THREE.Sprite(this.glowMat); this.glow.position.set(0, PROC.DECK_Y + 0.1, 0);
    for (const o of [this.fixed, this.drill, this.collar, this.bit, this.lamp, this.glow]) { o.raycast = () => {}; this.root.add(o); }
    this.seed = hash01(v.id, 'pr');
    this.ang = this.seed * TAU;
    this.spin = 0; this.heatK = 0; this.state = null; this.sparkAcc = 0; this.smokeAcc = 0;
    this.feed = new OreFeed();
    this.ores = [];      // 날아가는 광석 {lane, t0, dur, big, s, newPass}
    this.cargo = [];     // 레인별 쌓인 수(보여 주는 값 — 도착할 때 하나씩 늘어 화물 링이 차오름)
    this.lastJob = null;
    this.colKey = '';
  }
  /** 몸체·부품 색(_styleVis 뒤): 바위 = 종류 색을 회갈색 쪽으로, 끝(초록)·실패(빨강)·중지(회색)는 그 색으로 물듦 */
  style(tokens) {
    const v = this.v, L = !!tokens.isLight;
    const st = this.stateNow(), look = procLook(st);
    const base = _col.copy(v.mat.color);
    const rock = _col2.set(L ? 0x8b8378 : 0x3b3631).lerp(base, L ? 0.25 : 0.16);
    if (look.tint && tokens[look.tint]) rock.lerp(tokens[look.tint], st === 'stopped' ? 0.5 : 0.35);
    v.mat.color.copy(rock); v.mat.emissive.copy(rock);
    v.baseEmissive = (st === 'running' ? 0.1 : 0.04) * (L ? 0.5 : 1) * (v.scopeK ?? 1);
    this.metal.color.copy(base).lerp(_col2.set(L ? 0x7c8594 : 0xa3adbd), 0.62);
    this.metal.emissive.copy(base).multiplyScalar(L ? 0.02 : 0.16);
    this.steel.color.set(L ? 0x5b6472 : 0xc8d0dc);
    this.steel.emissive.set(0x000000);
    this.colKey = '';
  }
  /** 플랫폼 상태: 분리 프로세스 = procState, 외부 작업 = 표시 상태(정체·끝·실패, 그 밖 running) */
  stateNow() { return this.ext ? extRigState(jobOf(this.v.node), this.fx.view.clock()) : procState(this.v.node) || 'running'; }
  hide() { if (this.meter) this.meter.hide(); }
  step(now, dt, s, px, op, ctx) {
    const v = this.v, fx = this.fx, t = fx.view.tokens, L = ctx.L;
    const st = this.stateNow(), look = procLook(st);
    if (this.state && this.state !== st ) { // 끝: 초록 파동 · 실패 빨강 · 중지 회색 — 처음 본 상태엔 없음
      const c = st === 'done' ? t.ok : st === 'failed' ? t.error : st === 'stopped' ? t.stopped : null;
      if (c && fx.view.wave) fx.view.wave(v.id, c, st === 'done' ? 1.8 : 1.3);
      if (st !== 'running' && st !== 'stale') this.ores.length = 0;
    }
    if (this.state !== st) { this.state = st; fx.view._styleVis(v); }
    const jv = this.ext ? null : fx.view.vis.get(procJobId(v.node));
    const job = this.ext ? extRigJob(jobOf(v.node)) : jv ? jobOf(jv.node) : null; // 외부 작업: 진행 줄 → 레인 하나
    this.lastJob = job;
    const heat = job ? Math.max(0, Math.min(1, Number(job.heat) || 0)) : 0;
    const pri = job && Array.isArray(job.lanes) ? (job.lanes.find((l) => l.key === job.primary) || job.lanes[0]) : null;
    const longest = pri && pri.last ? pri.last.v : 0;
    const running = st === 'running';
    // 드릴: 처리율·과열로 회전, 과열이면 멈칫. 끝나면 서서히 멈춤
    const target = drillSpin(st, heat, job ? job.rate : null, ctx.reduced) * (running && !ctx.reduced ? drillHitch(now, heat, longest, this.seed) : 1);
    this.spin += (target - this.spin) * Math.min(1, dt * (target > this.spin ? 3 : 1.4));
    this.ang = (this.ang + this.spin * dt) % TAU;
    this.drill.rotation.y = this.ang;
    this.bit.rotation.y = this.ang;
    // 열: 일하는 동안 heat 쪽으로, 끝나면 식음
    const hk = running || st === 'stale' ? heat : 0;
    this.heatK += (hk - this.heatK) * Math.min(1, dt * (hk > this.heatK ? 1.5 : 0.4));
    const lod = procLod(px);
    this.root.scale.setScalar(s);
    this.root.visible = lod >= 1 && op > 0.02;
    const ht = heatTip(this.heatK, L);
    this.hot.color.setRGB(ht.r, ht.g, ht.b, THREE.SRGBColorSpace);
    if (!L) this.hot.color.lerp(_col2.set(0x1f2937), (1 - ht.k) * 0.55); else this.hot.color.lerp(_col2.set(0x4b5563), (1 - ht.k) * 0.6);
    this.hot.opacity = op * (0.55 + 0.45 * ht.k);
    const blend = L ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (this.hot.blending !== blend) { this.hot.blending = blend; this.hot.needsUpdate = true; }
    this.glow.visible = !L && lod >= 1 && this.heatK > 0.08;
    if (this.glow.visible) { this.glowMat.color.setRGB(ht.r, ht.g, ht.b, THREE.SRGBColorSpace); this.glowMat.opacity = op * ht.k * 0.8 * (0.85 + 0.15 * Math.sin(now * 9 + this.seed * 10)); this.glow.scale.setScalar(0.6 + 1.3 * ht.k); }
    for (const m of [this.metal, this.steel]) { m.opacity = op; m.depthWrite = op >= 0.99; }
    // 상태 등: 일함 = 초록 천천히 숨, 정체 = 호박 깜빡, 끝 = 초록 고정, 실패 = 빨강, 중지 = 회색
    const lampC = t[look.lamp] || t.ok;
    this.lampMat.color.copy(lampC);
    const bl = look.blink > 0 && !ctx.reduced ? (st === 'stale' ? (Math.sin((now * TAU) / look.blink) > 0 ? 1 : 0.15) : 0.55 + 0.45 * Math.sin((now * TAU) / look.blink)) : 1;
    this.lampMat.opacity = op * bl;
    this.lamp.visible = lod >= 2;
    this.collar.visible = this.bit.visible = lod >= 1;
    // 열기 입자 · 굴뚝 연기(LOD 2, 움직임 줄이기면 없음)
    if (lod >= 2 && op > 0.3 && !ctx.reduced && fx.sparks) {
      this.sparkAcc += dt * heatSparkRate(this.heatK, this.spin, ctx.reduced);
      while (this.sparkAcc >= 1) {
        this.sparkAcc -= 1;
        _p.set(0, PROC.DECK_Y + 0.12, 0).multiplyScalar(s).add(v.group.position);
        _d.set((Math.random() - 0.5) * 0.8, 1, (Math.random() - 0.5) * 0.8).normalize();
        fx.sparks.emit(_p, _d, s * (1.2 + this.heatK), 0.25, 0.5 + 0.4 * this.heatK, _col.setRGB(ht.r, ht.g, ht.b, THREE.SRGBColorSpace), 1.6);
      }
      this.smokeAcc += dt * look.smoke * (running ? 1.2 + 1.6 * this.heatK : 0.6);
      while (this.smokeAcc >= 1) {
        this.smokeAcc -= 1;
        _p.set(0.44, PROC.DECK_Y + 0.62, -0.3).multiplyScalar(s).add(v.group.position);
        _d.set(0.15 + (Math.random() - 0.5) * 0.2, 1, (Math.random() - 0.5) * 0.2).normalize();
        fx.sparks.emit(_p, _d, s * 0.7, 0.12, 1.4, _col.set(L ? 0x6b7280 : 0x5b6370), 0.9);
      }
    } else { this.sparkAcc = 0; this.smokeAcc = 0; }
    // 광석 발사(레인 값이 늘거나 처리율만큼) — 컨베이어는 fx.update 가 그림
    if (job) {
      for (const o of this.feed.step(job, dt, running && !ctx.reduced)) { // 움직임 줄이기: 처리율 부스러기 없이 진행 줄 덩이만
        if (this.ores.filter((x) => x.lane === o.lane).length >= PROC.ORE_MAX) continue;
        this.ores.push({ lane: o.lane, t0: now, dur: 0, big: o.big, newPass: !!o.newPass, s: o.big ? 1 : 0.55 + 0.25 * Math.random(), spin: Math.random() * TAU });
      }
    }
    if (this.meter) this.meter.step(now, dt, s, px, op, ctx); // 데릭 위 계기
  }
  dispose() {
    if (this.meter) this.meter.dispose();
    this.root.removeFromParent();
    for (const m of [this.metal, this.steel, this.hot, this.lampMat, this.glowMat]) m.dispose();
  }
}

let GLOW_TEX = null;
function glowTex() {
  if (GLOW_TEX) return GLOW_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  GLOW_TEX = new THREE.CanvasTexture(c);
  return GLOW_TEX;
}

// ---------- 계기 홀로그램(자동 진행 작업) — 판 그리기는 proc-meter.js(2D 와 공용) ----------
const css = (c) => '#' + c.getHexString(THREE.SRGBColorSpace);
class ProcMeter {
  /** opts: body = 노드 몸체를 투사기로(자동 진행 계기) · lift = 판 아래 끝 높이(몸체 반지름 배) · model·big = 모델 함수(외부 작업 플랫폼은 데릭 위에 extMeterModel) */
  constructor(fx, v, opts = {}) {
    this.fx = fx; this.v = v;
    this.lift = opts.lift ?? 1.6; this.modelFn = opts.model || meterModel; this.bigFn = opts.big || meterBig; this.rig = opts.body === false;
    if (!this.rig) v.mesh.geometry = geo().puck;
    this.mc = new MeterCanvas();
    this.mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: true });
    this._tex();
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.center.set(0.5, 0);
    this.sprite.raycast = () => {};
    this.sprite.renderOrder = 4;
    v.group.add(this.sprite);
    this.sig = ''; this.drawnAt = -1; this.compact = null; this.flashAt = -1e9; this.light = null;
    this.rect = null; // 화면 사각형(집기·툴팁)
  }
  /** 캔버스 크기가 바뀌면 텍스처를 새로(같은 텍스처에 크기만 바꿔 올리면 WebGL 이 부분 복사 범위 오류) */
  _tex() {
    if (this.tex) this.tex.dispose();
    this.tex = new THREE.CanvasTexture(this.mc.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.minFilter = THREE.LinearFilter; this.tex.generateMipmaps = false;
    this.mat.map = this.tex; this.mat.needsUpdate = true;
  }
  hide() { this.sprite.visible = false; this.rect = null; }
  /** 판 높이(세계 단위): 레인 수에 따라 */
  worldH(rows) { return 0.36 + 0.34 * Math.max(1, rows); }
  step(now, dt, s, px, op, ctx) {
    const v = this.v, fx = this.fx;
    const job = jobOf(v.node);
    if (!job || op < 0.02) { this.hide(); return; }
    const L = ctx.L;
    if (!this.rig) v.mesh.rotation.y += dt * 0.6 * (ctx.reduced ? 0.2 : 1);
    const m = this.modelFn(job, ctx.clockMs, L);
    const rows = Math.max(1, m.rows.length);
    v.group.getWorldPosition(_p);
    const dist = Math.max(0.01, _p.distanceTo(ctx.cam.position));
    const Hw = this.worldH(rows);
    const hpx = (Hw * ctx.pxK) / dist;
    const compact = hpx < PROC.METER_FULL_PX;
    // 진행 들여다보기 결과가 막 왔으면 체크(2.4초)
    const pid = v.node.parentId;
    if (fx.flashOf(pid) > this.flashAt) this.flashAt = fx.flashOf(pid);
    const flash = now - this.flashAt < 2.4 ? 1 - (now - this.flashAt) / 2.4 : 0;
    // 다시 그림: 보이는 글자가 바뀌거나 끝자리가 굴러갈 때(최대 12Hz), 모양이 바뀌면 바로
    const big = compact ? this.bigFn(job, ctx.clockMs) : '';
    const rolling = !compact && MeterCanvas.rolling(m);
    const key = (compact ? 'c|' + big : m.sig) + '|' + L + '|' + (flash > 0 ? 'f' + Math.round(flash * 6) : '');
    if (compact !== this.compact || L !== this.light || (key !== this.sig && now - this.drawnAt > 0.08) || (rolling && now - this.drawnAt > 0.083)) {
      this.compact = compact; this.light = L; this.sig = key; this.drawnAt = now;
      const t = fx.view.tokens || {}, pv = fx.view.vis.get(pid);
      const resized = this.mc.draw({ model: m, light: L, flash, name: pv && isProc(pv.node) ? procName(pv.node) : (v.node.label || ''), compact, big,
        ok: t.ok ? css(t.ok) : '#22c55e', err: t.error ? css(t.error) : '#ef4444' });
      if (resized) this._tex(); else this.tex.needsUpdate = true;
    }
    const cw = this.mc.canvas.width, ch = this.mc.canvas.height;
    let h = Hw, w = (Hw * cw) / ch;
    if (compact) { h = (22 * dist) / ctx.pxK; w = (h * cw) / ch; } // 먼 LOD: 화면에서 글자 높이 약 22px 고정
    this.sprite.scale.set(w, h, 1);
    this.sprite.position.set(0, s * this.lift, 0);
    this.sprite.visible = true;
    this.mat.opacity = op * (m.ended ? 0.75 : 0.95);
    this.w = w; this.h = h; this.s = s; this.op = op;
    // 화면 사각형(집기·툴팁)
    _a.copy(_p).add(_e.set(0, s * this.lift + h * 0.5, 0)).project(ctx.cam);
    if (_a.z < 1) { const cx = (_a.x * 0.5 + 0.5) * ctx.W, cy = (-_a.y * 0.5 + 0.5) * ctx.H; const pw = (w * ctx.pxK) / dist, ph = (h * ctx.pxK) / dist; this.rect = { x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph }; }
    else this.rect = null;
  }
  dispose() { this.sprite.removeFromParent(); this.mat.dispose(); this.tex.dispose(); }
}

/** 장면 전체 관리자: PlanetDeco 가 만들고 노드마다 attach/detach, 프레임마다 update */
export class ProcFx {
  constructor(view, sparks) {
    this.view = view; this.sparks = sparks;
    this.rigs = new Map(); this.meters = new Map();
    this.watch = new ProcWatch();
    this._flash = new Map(); // 프로세스 id → 마지막 progress 들여다보기 끝 시각(애니 초)
    this._seenPulse = new Set();
    const g = geo();
    // 선
    this.lpos = new Float32Array(LINE_CAP * 3); this.lcol = new Float32Array(LINE_CAP * 3); this.la = new Float32Array(LINE_CAP); this.lu = new Float32Array(LINE_CAP);
    const lg = this.lgeo = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.lpos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('col', new THREE.BufferAttribute(this.lcol, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('a', new THREE.BufferAttribute(this.la, 1).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('u', new THREE.BufferAttribute(this.lu, 1).setUsage(THREE.DynamicDrawUsage));
    this.lmat = new THREE.ShaderMaterial({ vertexShader: LINE_V, fragmentShader: LINE_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.lines = new THREE.LineSegments(lg, this.lmat);
    this.lines.frustumCulled = false; this.lines.raycast = () => {}; this.lines.renderOrder = 3; this.lines.visible = false;
    view.world.add(this.lines);
    this.ln = 0;
    // 광석(날아가는 것) · 화물(쌓인 것) · 탐사선
    const mk = (geom, cap, mat) => { const im = new THREE.InstancedMesh(geom, mat, cap); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.setColorAt(0, _col.set(0xffffff)); im.count = 0; im.frustumCulled = false; im.raycast = () => {}; view.world.add(im); return im; };
    this.oreMat = oreMat();
    this.oreIM = mk(g.ore, 640, this.oreMat);
    this.cargoIM = mk(g.ore, 1200, this.oreMat);
    this.probeMat = new THREE.MeshBasicMaterial();
    this.probeIM = mk(g.probe, 96, this.probeMat);
    this.light = null;
    this.stats = { procs: 0, meters: 0, ores: 0, cargo: 0, lines: 0, pulses: 0 };
    this._tipEl = null;
  }
  clear() { this.watch.clear(); this._flash.clear(); this._seenPulse.clear(); for (const r of this.rigs.values()) { r.ores.length = 0; r.feed.clear(); r.cargo = []; } }
  /** 노드 연출 붙이기: 프로세스면 플랫폼, 자동 진행 작업이면 계기 — 붙였으면 deco 객체 */
  attach(v) {
    if (isProc(v.node) || isExtRig(v.node)) { // 외부 작업도 플랫폼(계기는 데릭 위 — 집기용으로 meters 에도)
      const r = new ProcRig(this, v); this.rigs.set(v.id, r); if (r.meter) this.meters.set(v.id, r.meter); else this.watch.node(v.node); r.style(this.view.tokens || {}); return { type: 'proc', proc: r, root: r.root };
    }
    if (isAutoJob(v.node)) { const m = new ProcMeter(this, v); this.meters.set(v.id, m); return { type: 'meter', meter: m, root: m.sprite }; }
    return null;
  }
  detach(v) {
    const r = this.rigs.get(v.id); if (r) { r.dispose(); this.rigs.delete(v.id); this.watch.forget(v.id); if (r.meter) { this.meters.delete(v.id); return; } }
    const m = this.meters.get(v.id); if (m) { m.dispose(); this.meters.delete(v.id); }
  }
  /** 노드 갱신(meta.proc 이 바뀜 — 열린 들여다보기 맞추기) */
  nodeChanged(node) { if (isProc(node)) this.watch.node(node); }
  event(ev) { this.watch.event(ev); }
  style(v) {
    const t = this.view.tokens || {};
    const r = this.rigs.get(v.id); if (r) r.style(t);
    if (this.meters.has(v.id) && !this.meters.get(v.id).rig) { // 계기 투사기(플랫폼 위 계기는 몸체가 바위라 건너뜀): 어두운 금속 + 진행 색 은은한 발광(끝·실패는 그 색)
      const st = v.node.status, c = st === 'done' ? t.ok : st === 'error' ? t.error : t.skill;
      v.mat.color.set(t.isLight ? 0x64748b : 0x2b3442); if (c) v.mat.emissive.copy(c); v.baseEmissive = t.isLight ? 0.12 : 0.35;
    }
  }
  flashOf(procId) { return this._flash.get(procId) ?? -1e9; }

  /** 들여다보는(읽는) 노드 → 열린 들여다보기의 프로세스 id(라벨 '감독' 줄) */
  supervising(nodeId, nowMs) {
    for (const p of this.watch.pulses(nowMs)) if (p.open && p.from === nodeId) return p.to;
    return null;
  }

  _line(ax, ay, az, bx, by, bz, c, a0, a1, u0, u1) {
    if (this.ln + 2 > LINE_CAP) return;
    const i = this.ln, P = this.lpos, C = this.lcol;
    P[i * 3] = ax; P[i * 3 + 1] = ay; P[i * 3 + 2] = az; P[i * 3 + 3] = bx; P[i * 3 + 4] = by; P[i * 3 + 5] = bz;
    C[i * 3] = C[i * 3 + 3] = c.r; C[i * 3 + 1] = C[i * 3 + 4] = c.g; C[i * 3 + 2] = C[i * 3 + 5] = c.b;
    this.la[i] = a0; this.la[i + 1] = a1; this.lu[i] = u0; this.lu[i + 1] = u1;
    this.ln += 2;
  }
  _inst(im, n, x, y, z, sc, c, rot = 0) {
    if (n >= im.instanceMatrix.count) return n;
    _qq.setFromAxisAngle(UP, rot); _sv.setScalar(sc);
    _mm.compose(_p.set(x, y, z), _qq, _sv);
    im.setMatrixAt(n, _mm); im.setColorAt(n, c);
    return n + 1;
  }

  /** 매 프레임(PlanetDeco.update 안): 노드별 step 은 PlanetDeco 가 부르고, 여기서는 장면 전체 선·인스턴스 */
  update(now, dt, ctx) {
    const view = this.view, L = ctx.L, t = view.tokens || {};
    if (this.light !== L) {
      this.light = L;
      this.lmat.blending = L ? THREE.NormalBlending : THREE.AdditiveBlending; this.lmat.needsUpdate = true;
      this.oreMat.emissiveIntensity = L ? 0.05 : 0.3;
    }
    this.ln = 0;
    let no = 0, nc = 0, np = 0;
    const st = this.stats; st.procs = this.rigs.size; st.meters = this.meters.size;
    // 1) 컨베이어 · 광석 · 화물 링
    for (const r of this.rigs.values()) {
      const v = r.v;
      if (!v || v.hidden || v.gone || !v.group.visible || !(v.mat.opacity > 0.02)) continue;
      const pv = view.vis.get(v.node.parentId);
      const job = r.lastJob;
      const lanes = job && Array.isArray(job.lanes) ? job.lanes.slice(0, PROC.LANES) : [];
      if (!pv || pv.hidden || pv.gone || !pv.group.visible || !lanes.length) { r.ores.length = 0; continue; }
      const op = Math.min(v.mat.opacity, pv.mat.opacity * 1.2);
      if (op < 0.03) continue;
      const s = v.mesh.scale.x, ps = pv.mesh.scale.x;
      const P = v.group.position, Q = pv.group.position;
      _d.subVectors(P, Q); _d.y = 0;
      const dl = _d.length(); if (dl < 1e-4) continue;
      _d.multiplyScalar(1 / dl);
      const baseA = Math.atan2(_d.z, _d.x);
      const running = r.state === 'running';
      const vals = lanes.map((l) => l);
      vals.forEach((l, i) => {
        const lc = _col.set(laneColor(i, L));
        // 화물 링: 레인 값(보간)으로 쌓인 수, 도착하는 큰 광석마다 하나씩 차오르게 r.cargo[i] 를 끌어올림
        const want = cargoCount(laneValue(l, ctx.clockMs, { ended: isJobEndedState(job.state), aheadSec: Number(job.staleSec) > 0 ? Number(job.staleSec) : null }));
        if (r.cargo[i] == null) r.cargo[i] = want;
        if (r.cargo[i] > want) r.cargo[i] = want;
        const Rc = ps * (PROC.CARGO_R + 0.34 * i);
        const slot = (k, out) => { const cs = cargoSlot(k); const a = baseA + cs.a; const R = Rc + cs.row * 0.13 * ps; out.set(Q.x + Math.cos(a) * R, Q.y - 0.08 * ps + cs.row * 0.07 * ps, Q.z + Math.sin(a) * R); return out; };
        { // 화물 링 자리(옅은 호) — 점들이 '고리에 쌓인 짐'으로 읽히게
          const N = 18, y = Q.y - 0.08 * ps, a0 = baseA - PROC.CARGO_SPAN * 1.08, da = (PROC.CARGO_SPAN * 2.16) / N, al = op * (L ? 0.3 : 0.22);
          for (let j = 0; j < N; j++) { const x0 = a0 + j * da, x1 = x0 + da, e0 = Math.sin((j / N) * Math.PI), e1 = Math.sin(((j + 1) / N) * Math.PI); this._line(Q.x + Math.cos(x0) * Rc, y, Q.z + Math.sin(x0) * Rc, Q.x + Math.cos(x1) * Rc, y, Q.z + Math.sin(x1) * Rc, lc, al * e0, al * e1, -1, -1); }
        }
        for (let k = 0; k < r.cargo[i]; k++) { slot(k, _e); nc = this._inst(this.cargoIM, nc, _e.x, _e.y, _e.z, ps * 0.09 * op, _col2.copy(lc).multiplyScalar(L ? 1 : 0.75), k * 1.7 + i); }
        // 컨베이어 곡선: 플랫폼 갑판 → 다음 화물 자리
        const bend = conveyorBend(i, vals.length);
        _a.set(P.x, P.y + s * (PROC.DECK_Y + 0.15), P.z);
        slot(Math.min(PROC.CARGO_MAX - 1, r.cargo[i]), _b);
        const D = _a.distanceTo(_b);
        _e.subVectors(_b, _a); _c.crossVectors(UP, _e); if (_c.lengthSq() < 1e-8) _c.set(1, 0, 0); _c.normalize();
        _c.multiplyScalar(bend.side * D).add(_p.addVectors(_a, _b).multiplyScalar(0.5)); _c.y += bend.lift * D;
        _pa.x = _a.x; _pa.y = _a.y; _pa.z = _a.z; _pc.x = _c.x; _pc.y = _c.y; _pc.z = _c.z; _pb.x = _b.x; _pb.y = _b.y; _pb.z = _b.z;
        const flow = running && !ctx.reduced ? now * (0.5 + 1.6 / Math.max(0.4, 2.6 - Math.min(2.2, Math.log10(1 + (l.rate || 0)) * 0.36))) : 0;
        const N = 22, dashN = Math.max(6, Math.round(D * 2.2));
        const al = op * (L ? 0.55 : 0.4) * (running ? 1 : 0.55);
        let px0 = _pa.x, py0 = _pa.y, pz0 = _pa.z;
        for (let j = 1; j <= N; j++) {
          quadAt(_pa, _pc, _pb, j / N, _po);
          const ends = Math.min(1, Math.min(j - 1, N - j + 1) / 3); // 두 끝은 옅게
          this._line(px0, py0, pz0, _po.x, _po.y, _po.z, lc, al * Math.min(1, (j - 1) / 3 + 0.25), al * (0.25 + 0.75 * ends), ((j - 1) / N) * dashN - flow, (j / N) * dashN - flow);
          px0 = _po.x; py0 = _po.y; pz0 = _po.z;
        }
        // 날아가는 광석
        for (let k = r.ores.length - 1; k >= 0; k--) {
          const o = r.ores[k];
          if (o.lane !== i) continue;
          if (!o.dur) o.dur = oreFlight(D, l.rate);
          const kk = (now - o.t0) / o.dur;
          if (kk >= 1) { r.ores.splice(k, 1); if (o.big && r.cargo[i] < want) r.cargo[i]++; continue; }
          quadAt(_pa, _pc, _pb, oreEase(kk), _po);
          const pop = kk < 0.1 ? kk / 0.1 : 1;
          const sc = ps * (o.big ? 0.17 : 0.1) * o.s * pop * op;
          no = this._inst(this.oreIM, no, _po.x, _po.y, _po.z, sc, _col2.copy(lc).multiplyScalar(o.big ? 1.15 : 0.85), o.spin + now * (o.big ? 1.5 : 3));
        }
        // 날아가는 큰 광석으로 못 메우는 빈자리(스냅샷·회차 몰림)는 바로 채움 — 화물 수는 결국 레인 값이 정한다
        const inflight = r.ores.reduce((n, o) => n + (o.lane === i && o.big ? 1 : 0), 0);
        if (r.cargo[i] < want - inflight || !running) r.cargo[i] = Math.max(r.cargo[i], running ? want - inflight : want);
      });
    }
    // 1-b) 계기 투사선: 투사기 → 판 아래 두 모서리(판이 크게 보일 때만)
    const camR = _c.setFromMatrixColumn(ctx.cam.matrixWorld, 0);
    for (const m of this.meters.values()) {
      if (!m.sprite.visible || m.compact || !m.w) continue;
      const P = m.v.group.position, a = m.op * (L ? 0.35 : 0.3), y0 = P.y + m.s * (m.rig ? PROC.TOP_Y : 0.25), y1 = P.y + m.s * m.lift, hw = m.w * 0.42;
      const lc = _col.copy(this.view.tokens.skill || _col.set(0xfacc15));
      this._line(P.x, y0, P.z, P.x + camR.x * hw, y1, P.z + camR.z * hw, lc, a, a * 0.3, -1, -1);
      this._line(P.x, y0, P.z, P.x - camR.x * hw, y1, P.z - camR.z * hw, lc, a, a * 0.3, -1, -1);
    }
    // 2) 들여다보기
    const pulses = this.watch.pulses(ctx.clockMs);
    st.pulses = pulses.length;
    for (const p of pulses) {
      const fv = view.vis.get(p.from), tv = view.vis.get(p.to);
      if (!fv || !tv || fv.hidden || tv.hidden || fv.gone || tv.gone || !fv.group.visible || !tv.group.visible) continue;
      const look = watchLook(p);
      const op = Math.min(fv.mat.opacity, tv.mat.opacity * 1.3, 1);
      if (op < 0.03) continue;
      const s = tv.mesh.scale.x, fs = fv.mesh.scale.x;
      const P = tv.group.position, F = fv.group.position;
      const wc = _col.copy(fv.mat.color).lerp(_col2.set(L ? 0x0b1220 : 0xffffff), L ? 0.25 : 0.35);
      // 진행 결과 펄스 → 계기 체크
      if (!p.open && p.progress) { const k = p.from + '|' + p.to + '|' + Math.round(p.ageMs < 0 ? 0 : (ctx.clockMs - p.ageMs) / 100); if (!this._seenPulse.has(k)) { this._seenPulse.add(k); if (this._seenPulse.size > 256) this._seenPulse.clear(); this._flash.set(p.to, now - p.ageMs / 1000); } }
      // 대기 궤도 고리 + 도는 탐사선
      if (look.ring > 0) {
        const R = s * PROC.WAIT_R, y = P.y + s * (PROC.DECK_Y + 0.5), N = 48;
        const rot = ctx.reduced ? 0 : now * 0.25;
        for (let j = 0; j < N; j++) {
          const a0 = (j / N) * TAU + rot, a1 = ((j + 1) / N) * TAU + rot;
          this._line(P.x + Math.cos(a0) * R, y, P.z + Math.sin(a0) * R, P.x + Math.cos(a1) * R, y, P.z + Math.sin(a1) * R, wc, op * 0.5 * look.ring, op * 0.5 * look.ring, j * 0.5, (j + 1) * 0.5);
        }
        const pa = (ctx.reduced ? 0.3 : now * 0.9) + hash01(p.from + p.to, 'w') * TAU;
        np = this._inst(this.probeIM, np, P.x + Math.cos(pa) * R, y, P.z + Math.sin(pa) * R, s * 0.13 * op, wc, now * 2);
      }
      // 스캔 빔: 읽는 노드 표면 → 플랫폼(위·좌·우) 세 줄 + 플랫폼을 위에서 아래로 훑는 고리
      if (look.beam > 0.01) {
        _d.subVectors(P, F).normalize();
        _a.copy(F).addScaledVector(_d, fs * 1.05);
        _c.crossVectors(UP, _d); if (_c.lengthSq() < 1e-8) _c.set(1, 0, 0); _c.normalize();
        const top = P.y + s * PROC.TOP_Y, bot = P.y + s * 0.2;
        const sy = top + (bot - top) * look.sweep;
        const ba = op * look.beam * (L ? 0.75 : 0.6);
        this._line(_a.x, _a.y, _a.z, P.x, top, P.z, wc, ba, ba * 0.35, -1, -1);
        this._line(_a.x, _a.y, _a.z, P.x + _c.x * s * 0.9, sy, P.z + _c.z * s * 0.9, wc, ba, ba * 0.5, -1, -1);
        this._line(_a.x, _a.y, _a.z, P.x - _c.x * s * 0.9, sy, P.z - _c.z * s * 0.9, wc, ba, ba * 0.5, -1, -1);
        const N = 28, R = s * 0.95;
        for (let j = 0; j < N; j++) { const a0 = (j / N) * TAU, a1 = ((j + 1) / N) * TAU; this._line(P.x + Math.cos(a0) * R, sy, P.z + Math.sin(a0) * R, P.x + Math.cos(a1) * R, sy, P.z + Math.sin(a1) * R, wc, ba * 1.2, ba * 1.2, -1, -1); }
      }
      // 되돌아오는 진행 패킷(플랫폼 → 읽는 노드)
      if (look.packet >= 0) {
        const k = look.packet, e = k * k * (3 - 2 * k);
        _e.copy(P).lerp(F, e); _e.y += Math.sin(k * Math.PI) * s * 1.2;
        np = this._inst(this.probeIM, np, _e.x, _e.y, _e.z, s * 0.16 * op * (1 - 0.3 * k), _col2.set(laneColor(0, L)), now * 4);
      }
    }
    // 반영
    const set = (im, n) => { im.count = n; if (n) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; } };
    set(this.oreIM, no); set(this.cargoIM, nc); set(this.probeIM, np);
    st.ores = no; st.cargo = nc; st.lines = this.ln;
    this.lines.visible = this.ln > 0;
    if (this.ln) {
      const g = this.lgeo;
      g.setDrawRange(0, this.ln);
      for (const k of ['position', 'col', 'a', 'u']) { const at = g.attributes[k]; at.needsUpdate = true; at.clearUpdateRanges && at.clearUpdateRanges(); at.addUpdateRange && at.addUpdateRange(0, this.ln * at.itemSize); }
    }
  }

  /** 화면 집기(계기 판 사각형) → 작업 노드 id */
  pickMeter(x, y) {
    for (const [id, m] of this.meters) { const r = m.rect; if (r && m.sprite.visible && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return id; }
    return null;
  }
  dispose() {
    for (const r of this.rigs.values()) r.dispose();
    for (const m of this.meters.values()) m.dispose();
    this.rigs.clear(); this.meters.clear();
    for (const o of [this.lines, this.oreIM, this.cargoIM, this.probeIM]) o.removeFromParent();
    this.lgeo.dispose(); this.lmat.dispose(); this.oreMat.dispose(); this.probeMat.dispose();
    this.oreIM.dispose(); this.cargoIM.dispose(); this.probeIM.dispose();
  }
}

export { procName };
