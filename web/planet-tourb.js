// Planet 3D 뚜르비용 — planet-deco.js 가 붙인다. 규칙·박자는 tourbillon-core.mjs(순수).
//  · 메인(TourbMain): 바깥 케이지(극에서 극으로 도는 자오선 호 3 + 극 판 고리, 세로축) 안에 안쪽 케이지(기운 축 고리)가 반대로 돌고,
//    그 안에서 밸런스 휠(금빛 테 + 살 + 타이밍 나사)이 진동, 극에는 헤어스프링(블루 스틸 나선)이 숨 쉬듯 감기고 풀린다.
//    바깥 케이지 적도에 이스케이프 휠(톱니 15)과 앵커가 붙어 박마다 째깍 끊어 돌고, 피벗마다 루비 보석, 판 이음새마다 블루 스크루.
//    적도의 기존 기어 띠는 고정된 네 번째 휠 — 케이지가 그 위를 돈다.
//  · 서브(SubCages): 단일 케이지(자오선 호 3 + 극 판 + 루비 2 + 블루 스크루 3)를 장면 전체 InstancedMesh 하나로(그리기 호출 1),
//    인스턴스마다 기운 축·박마다 째깍 도는 각·투명도(인스턴스 속성 aOp). 유형 8종 몸체·궤도는 그대로.
//  · 지오메트리는 한 번만 만들어 모든 노드가 같이 쓴다(BufferGeometryUtils 없이 직접 합침 — 외부 모듈 SRI 목록을 늘리지 않음).
import * as THREE from 'three';
import { TOURB_GEO as TG } from './tourbillon-core.mjs';

const TAU = Math.PI * 2;
let G = null;

/** 지오메트리 여럿(각자 행렬·정점색)을 비색인 하나로 합침. parts = [{g, m?: Matrix4, c?: [r,g,b]}] */
function merge(parts, withColor = false) {
  let n = 0;
  const flat = parts.map((p) => { const g = p.g.index ? p.g.toNonIndexed() : p.g; n += g.attributes.position.count; return { ...p, g }; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = withColor ? new Float32Array(n * 3) : null;
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let o = 0;
  for (const p of flat) {
    const P = p.g.attributes.position, N = p.g.attributes.normal, m = p.m || new THREE.Matrix4();
    nm.getNormalMatrix(m);
    for (let i = 0; i < P.count; i++, o++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[o * 3] = v.x; nor[o * 3 + 1] = v.y; nor[o * 3 + 2] = v.z;
      if (col) { const c = p.c || [1, 1, 1]; col[o * 3] = c[0]; col[o * 3 + 1] = c[1]; col[o * 3 + 2] = c[2]; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const M = () => new THREE.Matrix4();
const at = (x, y, z) => M().makeTranslation(x, y, z);

/** 극에서 극으로 도는 자오선 호(반지름 R, 오른쪽 반원) 3개 + 극 판 고리 둘 — 바깥 케이지·서브 케이지 공용 뼈대 */
function cageParts(R, tube, arms, poleR, color) {
  const out = [];
  const arc = new THREE.TorusGeometry(R, tube, 5, 44, Math.PI);
  for (let i = 0; i < arms; i++) out.push({ g: arc, m: M().makeRotationY((i * TAU) / arms).multiply(M().makeRotationZ(-Math.PI / 2)), c: color });
  const yp = Math.sqrt(Math.max(0, R * R - poleR * poleR));
  const pole = new THREE.TorusGeometry(poleR, tube * 1.1, 5, 28);
  for (const s of [1, -1]) out.push({ g: pole, m: at(0, s * yp, 0).multiply(M().makeRotationX(Math.PI / 2)), c: color });
  return { out, yp };
}
/** 판 고리와 호가 만나는 자리(나사) — 극 고리 위 arms 개 */
function junctions(poleR, yp, arms, s = 1) { const p = []; for (let i = 0; i < arms; i++) { const a = (i * TAU) / arms; p.push([Math.cos(a) * poleR, s * yp, -Math.sin(a) * poleR]); } return p; }

function geo() {
  if (G) return G;
  const steel = [1, 1, 1];
  // 바깥 케이지
  const oc = cageParts(TG.OUTER_R, 0.016, TG.OUTER_ARMS, TG.POLE_R, steel);
  // 이스케이프 휠: 바깥 케이지 적도, 두 호 사이(60°)에서 바깥을 향한 면. 지역 좌표(바퀴 축 = +z)로 만들어 두고 그룹으로 옮김
  const escRing = new THREE.TorusGeometry(TG.ESC_R, 0.018, 5, 30);
  const tooth = new THREE.BoxGeometry(0.05, 0.03, 0.022);
  const escParts = [{ g: escRing }, { g: new THREE.CylinderGeometry(0.03, 0.03, 0.05, 10), m: M().makeRotationX(Math.PI / 2) }];
  for (let i = 0; i < TG.ESC_TEETH; i++) { const a = (i * TAU) / TG.ESC_TEETH; escParts.push({ g: tooth, m: M().makeRotationZ(a).multiply(at(TG.ESC_R + 0.03, 0, 0)).multiply(M().makeRotationZ(0.5)) }); }
  for (let i = 0; i < 4; i++) { const a = (i * TAU) / 4; escParts.push({ g: new THREE.BoxGeometry(TG.ESC_R * 0.95, 0.016, 0.012), m: M().makeRotationZ(a).multiply(at(TG.ESC_R * 0.48, 0, 0)) }); }
  // 앵커(팔레트 포크): 피벗에서 양쪽 팔 + 끝 갈고리 둘 + 포크 대
  const bar = (w, x, y, r) => ({ g: new THREE.BoxGeometry(w, 0.022, 0.018), m: M().makeRotationZ(r).multiply(at(x, y, 0)) });
  const pal = [bar(0.26, 0, 0, 0), bar(0.07, -0.13, -0.03, 1.2), bar(0.07, 0.13, -0.03, -1.2), bar(0.2, 0, -0.1, Math.PI / 2)];
  // 안쪽 케이지 고리(+ 피벗 둘의 작은 보스)
  const innerParts = [{ g: new THREE.TorusGeometry(TG.INNER_R, 0.013, 5, 72) }];
  for (const s of [1, -1]) innerParts.push({ g: new THREE.CylinderGeometry(0.045, 0.045, 0.06, 10), m: at(0, 0, s * TG.INNER_R).multiply(M().makeRotationX(Math.PI / 2)) });
  // 밸런스 휠: 테 + 살(테 안쪽 짧은 토막 — 안은 몸체에 가려짐) + 타이밍 나사
  const balParts = [{ g: new THREE.TorusGeometry(TG.BAL_R, 0.024, 6, 72), m: M().makeRotationX(Math.PI / 2) }];
  for (let i = 0; i < TG.BAL_SPOKES; i++) { const a = (i * TAU) / TG.BAL_SPOKES; balParts.push({ g: new THREE.BoxGeometry(0.26, 0.02, 0.03), m: M().makeRotationY(a).multiply(at(TG.BAL_R - 0.12, 0, 0)) }); }
  const scr = new THREE.SphereGeometry(0.03, 8, 6);
  const balScrews = [];
  for (let i = 0; i < TG.BAL_SCREWS; i++) { const a = ((i + 0.5) * TAU) / TG.BAL_SCREWS; balScrews.push({ g: scr, m: at(Math.cos(a) * (TG.BAL_R + 0.045), 0, Math.sin(a) * (TG.BAL_R + 0.045)) }); }
  // 헤어스프링: 평평한 나선(선), 극 위
  const hs = [];
  for (let i = 0; i <= 160; i++) { const u = i / 160, a = u * 5.5 * TAU, r = 0.035 + 0.15 * u; hs.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
  // 보석·나사
  const jewel = new THREE.SphereGeometry(0.042, 10, 8);
  const screw = new THREE.SphereGeometry(0.026, 8, 6);
  const oj = [[0, oc.yp + 0.02, 0], [0, -oc.yp - 0.02, 0]];
  const os = [...junctions(TG.POLE_R, oc.yp, TG.OUTER_ARMS, 1), ...junctions(TG.POLE_R, oc.yp, TG.OUTER_ARMS, -1)];
  // 서브 단일 케이지(정점색: 강철·루비·블루)
  const sc = cageParts(TG.SUB_R, 0.011, TG.SUB_ARMS, 0.22, [0.92, 0.94, 0.98]);
  const sub = [...sc.out,
    ...[[0, sc.yp + 0.02, 0], [0, -sc.yp - 0.02, 0]].map((p) => ({ g: jewel, m: at(...p), c: [0.78, 0.07, 0.17] })),
    ...junctions(0.22, sc.yp, TG.SUB_ARMS, 1).map((p) => ({ g: screw, m: at(...p), c: [0.2, 0.34, 0.92] }))];
  G = {
    outer: merge(oc.out), outerYp: oc.yp,
    outerJewels: merge(oj.map((p) => ({ g: jewel, m: at(...p) }))),
    outerScrews: merge(os.map((p) => ({ g: screw, m: at(...p) }))),
    esc: merge(escParts), pallet: merge(pal),
    escJewels: merge([{ g: jewel, m: at(0, 0, 0.035) }, { g: jewel, m: at(0, 0.25, 0.035) }]), // 이스케이프 중심·앵커 피벗(지역)
    inner: merge(innerParts),
    innerJewels: merge([1, -1].map((s) => ({ g: jewel, m: at(0, 0, s * (TG.INNER_R + 0.035)) }))),
    bal: merge(balParts), balScrews: merge(balScrews),
    hair: new THREE.BufferGeometry().setFromPoints(hs),
    sub: merge(sub, true),
  };
  return G;
}

const _c = new THREE.Color();
/** 테마별 금속 색. 다크 = 밝은 로듐·샴페인 금, 라이트 = 한 단 어두운 강철·짙은 금(밝은 바탕에서 윤곽이 서게) */
export function tourbColors(L) {
  return L ? { steel: 0x6f7a8a, gold: 0x9a7a35, ruby: 0x9e0f2c, blue: 0x2346c4, hair: 0x2b4fb8 }
    : { steel: 0xa9b3c1, gold: 0xc9a65c, ruby: 0xc0183c, blue: 0x3f6cff, hair: 0x5b82ff };
}

/** 메인 다축 뚜르비용 부품 묶음(노드 그룹의 몸체 크기 묶음 root 아래) */
export class TourbMain {
  constructor(root) {
    const g = geo();
    const std = (o) => new THREE.MeshStandardMaterial({ transparent: true, ...o });
    this.mSteel = std({ roughness: 0.32, metalness: 0.78 });
    this.mGold = std({ roughness: 0.3, metalness: 0.85 });
    this.mRuby = std({ roughness: 0.12, metalness: 0.0 });
    this.mBlue = std({ roughness: 0.22, metalness: 0.7 });
    this.mHair = new THREE.LineBasicMaterial({ transparent: true });
    this.mats = [this.mSteel, this.mGold, this.mRuby, this.mBlue, this.mHair];
    this.group = new THREE.Group(); root.add(this.group);
    // 바깥 케이지(세로축)
    this.outer = new THREE.Group(); this.group.add(this.outer);
    this.outer.add(new THREE.Mesh(g.outer, this.mSteel), new THREE.Mesh(g.outerJewels, this.mRuby));
    this.screws = new THREE.Mesh(g.outerScrews, this.mBlue); this.outer.add(this.screws);
    // 이스케이프 휠 + 앵커: 적도, 두 호 사이(60°) 바깥 — 바퀴 축이 바깥을 향함
    this.escG = new THREE.Group();
    const a = Math.PI / TG.OUTER_ARMS;
    this.escG.position.set(Math.cos(a) * (TG.OUTER_R + 0.02), 0, -Math.sin(a) * (TG.OUTER_R + 0.02));
    this.escG.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.escG.position.clone().normalize()); // 바퀴 축(+z) = 바깥
    this.outer.add(this.escG);
    this.esc = new THREE.Mesh(g.esc, this.mGold); this.escG.add(this.esc);
    this.pallet = new THREE.Mesh(g.pallet, this.mSteel); this.pallet.position.set(0, 0.25, 0.02); this.escG.add(this.pallet);
    this.escJ = new THREE.Mesh(g.escJewels, this.mRuby); this.escG.add(this.escJ);
    // 안쪽 케이지(기운 축, 바깥 케이지와 반대로) → 그 안의 밸런스
    this.innerTilt = new THREE.Group(); this.innerTilt.rotation.x = TG.INNER_TILT; this.outer.add(this.innerTilt);
    this.inner = new THREE.Group(); this.innerTilt.add(this.inner);
    this.inner.add(new THREE.Mesh(g.inner, this.mSteel));
    this.innerJ = new THREE.Mesh(g.innerJewels, this.mRuby); this.inner.add(this.innerJ);
    this.bal = new THREE.Group(); this.inner.add(this.bal);
    this.balRim = new THREE.Mesh(g.bal, this.mGold); this.bal.add(this.balRim);
    this.balScrews = new THREE.Mesh(g.balScrews, this.mGold); this.bal.add(this.balScrews);
    this.hair = new THREE.Line(g.hair, this.mHair); this.hair.position.y = 1.015; this.bal.add(this.hair);
    this.fine = [this.innerTilt, this.escG, this.screws, this.balScrews, this.hair];
    this.group.traverse((o) => { if (o.isMesh || o.isLine) o.raycast = () => {}; });
    this.lod = -1; this._key = '';
  }
  theme(L, nodeColor) {
    const key = L + '|' + nodeColor.getHexString();
    if (key === this._key) return; this._key = key;
    const C = tourbColors(L);
    // 강철은 노드 색을 아주 조금(세션 색과 어울리게), 금·루비·블루는 고정 — 정밀 기계의 재질감
    this.mSteel.color.set(C.steel).lerp(nodeColor, 0.12); this.mSteel.emissive.copy(nodeColor).multiplyScalar(L ? 0.02 : 0.06);
    this.mGold.color.set(C.gold); this.mGold.emissive.set(C.gold).multiplyScalar(L ? 0.03 : 0.1);
    this.mRuby.color.set(C.ruby); this.mRuby.emissive.set(C.ruby).multiplyScalar(L ? 0.25 : 0.55);
    this.mBlue.color.set(C.blue); this.mBlue.emissive.set(C.blue).multiplyScalar(L ? 0.12 : 0.35);
    this.mHair.color.set(C.hair);
  }
  /** es = Escapement 값, lod = tourbLod, op = 몸체 투명도 */
  step(es, lod, op) {
    if (lod !== this.lod) { this.lod = lod; this.group.visible = lod >= 1; for (const o of this.fine) o.visible = lod >= 2; }
    if (lod < 1) return;
    this.outer.rotation.y = es.cage;
    this.inner.rotation.y = es.cage2;
    this.bal.rotation.y = es.bal;
    if (lod >= 2) {
      this.esc.rotation.z = -es.esc;
      this.pallet.rotation.z = es.pallet;
      this.hair.rotation.y = -es.bal * 0.35;
      const br = 1 + 0.12 * Math.sin(es.bal); this.hair.scale.set(br, 1, br); // 헤어스프링이 감기고 풀림
    }
    for (const m of this.mats) { m.opacity = op; m.depthWrite = op >= 0.99; }
  }
  dispose() { this.group.removeFromParent(); for (const m of this.mats) m.dispose(); }
}

/** 서브 단일 케이지 — 장면 전체 InstancedMesh 하나. begin() → put(...) × n → end() */
export class SubCages {
  constructor(scene, cap = 256) {
    const g = geo();
    this.cap = cap;
    this.op = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    const geom = g.sub.clone(); geom.setAttribute('aOp', this.op);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.7, transparent: true });
    this.mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aOp;\nvarying float vOp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOp = aOp;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vOp;').replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vOp;');
    };
    this.mat.customProgramCacheKey = () => 'tourb-subcage';
    this.mesh = new THREE.InstancedMesh(geom, this.mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.raycast = () => {};
    scene.add(this.mesh);
    this.n = 0; this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.tint = new THREE.Color(1, 1, 1);
  }
  theme(L) { this.tint.set(L ? 0x7d8797 : 0xaab3c0); this.mat.emissive.set(L ? 0x000000 : 0x10141c); }
  begin() { this.n = 0; }
  /** worldPos = 노드 세계 위치, s = 몸체 반지름(세계), tiltX·tiltZ = 축 기울기, ang = 케이지 각, op = 투명도, col = 노드 색(조금 섞음) */
  put(worldPos, s, tiltX, tiltZ, ang, op, col) {
    if (this.n >= this.cap || !(op > 0.02)) return;
    const i = this.n++;
    this._e.set(tiltX, ang, tiltZ, 'XZY'); this._q.setFromEuler(this._e);
    this._m.compose(worldPos, this._q, this._s.setScalar(s));
    this.mesh.setMatrixAt(i, this._m);
    this.mesh.setColorAt(i, _c.copy(this.tint).lerp(col, 0.1));
    this.op.array[i] = op;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.op.needsUpdate = true;
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.dispose?.(); }
}
